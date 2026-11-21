import type { PullRequest } from '../adapters/source-control.js';
import type { Ticket } from '../adapters/ticket-provider.js';
import { loadRecord, saveRecord } from '../record/record-store.js';
import { appendEvent, parseComment, setState, type Run, type TicketRecord } from '../record/ticket-record.js';
import type { LoopDeps } from './build-loop.js';
import { timeoutSecondsOf } from './checks.js';
import type { RiskLevel } from './risk.js';
import type { FactoryDeps } from './run-lifecycle.js';

export const autoMerged = (run: Run): boolean => run.merge?.route === 'auto' && run.merge.refused === undefined;

export const autoMergeSuspended = async ({ tickets, config }: Pick<FactoryDeps, 'tickets' | 'config'>, level: RiskLevel): Promise<boolean> => {
  const since = config.risk[level].auto_since;
  const candidates = await tickets.search({ statuses: Object.values(config.states), ...(since === undefined ? {} : { updatedSince: `${since}T00:00:00Z` }) });
  return candidates.some((ticket) => {
    const parsed = parseComment(ticket.factoryComment ?? '', { trustEdited: true });
    if (parsed.status !== 'ok') return false;
    return parsed.record.runs.some((run) => run.risk?.level === level && autoMerged(run) && run.revert !== undefined && (since === undefined || run.revert.at >= since));
  });
};

type MergedChange = { readonly commit: string; readonly pullRequest?: number };

type Found = { readonly key: string; readonly ticket: Ticket; readonly record: TicketRecord; readonly index: number; readonly run: Run; readonly pullRequest: PullRequest };

export type RecordMergeResult = {
  readonly ok: true;
  readonly merged?: { readonly key: string; readonly by: string; readonly asIs: boolean };
  readonly reverted?: { readonly key: string; readonly by: string };
};

export type RevertResult =
  | { readonly ok: true; readonly action: 'none' }
  | { readonly ok: true; readonly action: 'opened'; readonly key: string; readonly url: string }
  | { readonly ok: true; readonly action: 'needed'; readonly key: string; readonly url: string };

export type WatchResult =
  | { readonly ok: true; readonly action: 'off' }
  | { readonly ok: true; readonly action: 'none' }
  | { readonly ok: true; readonly action: 'delivered'; readonly key: string }
  | { readonly ok: true; readonly action: 'failed'; readonly key: string; readonly check: string; readonly revert: 'opened' | 'needed'; readonly url: string };

const PULL_REQUEST_REFERENCES = [/^Merge pull request #(\d+)\b/, /\(pull request #(\d+)\)/i, /\(#(\d+)\)\s*$/];
const REVERTED_COMMIT = /This reverts commit ([0-9a-f]{7,40})/;
const TICKET_LINE = /^Ticket: (\S+)$/m;
const UNKNOWN_MERGER = 'unknown';
const SMOKE_CHECK_TIMEOUT_SECONDS = 300;
const DETAIL_LIMIT = 500;

const numberIn = (message: string): number | undefined => {
  const [title = ''] = message.split('\n');
  const found = PULL_REQUEST_REFERENCES.flatMap((pattern) => pattern.exec(title)?.[1] ?? [])[0];
  return found === undefined ? undefined : Number(found);
};

const changeRun = (record: TicketRecord, index: number, change: (run: Run) => Run): TicketRecord => ({
  ...record,
  runs: record.runs.map((run, position) => (position === index ? change(run) : run)),
});

const findRun = async (deps: LoopDeps, number: number | undefined): Promise<Found | undefined> => {
  const pullRequest = number === undefined ? undefined : await deps.sourceControl.getPullRequest(number);
  const key = pullRequest === undefined ? undefined : TICKET_LINE.exec(pullRequest.body)?.[1];
  if (pullRequest === undefined || key === undefined) return undefined;
  const ticket = await deps.tickets.getTicket(key);
  const loaded = await loadRecord(deps.tickets, key);
  if (ticket === undefined || loaded.status !== 'ok') return undefined;
  const index = loaded.record.runs.findIndex((run) => run.pullRequest?.number === pullRequest.number);
  const run = loaded.record.runs[index];
  return run === undefined ? undefined : { key, ticket, record: loaded.record, index, run, pullRequest };
};

const save = (deps: LoopDeps, key: string, record: TicketRecord, summary: string): Promise<void> =>
  saveRecord(deps.tickets, { key, record, summary, budget: deps.recordBudget });

const writeMerge = async (deps: LoopDeps, found: Found): Promise<RecordMergeResult['merged']> => {
  const { key, ticket, record, index, run, pullRequest } = found;
  if (pullRequest.state !== 'merged' || run.merge?.at !== undefined) return undefined;
  const at = pullRequest.mergedAt ?? deps.now();
  const by = pullRequest.mergedBy ?? UNKNOWN_MERGER;
  const headCommit = run.pullRequest?.headCommit;
  const asIs = headCommit !== undefined && (await deps.sourceControl.wasMergedAsIs({ number: pullRequest.number, commit: headCommit }));
  const outcome = asIs ? 'merged as is' : 'changed by a human';
  const merged = changeRun(record, index, (current) => ({
    ...current,
    status: 'merged',
    merge: { route: 'human', wouldAutoMerge: false, reason: 'not recorded when the pull request opened', ...current.merge, at, by, asIs },
  }));
  const { in_review: from, done: to } = deps.config.states;
  if (ticket.status === from) await deps.tickets.transition({ key, from, to });
  const closed = appendEvent(setState(merged, { state: 'done', at: deps.now(), by: deps.user }), { at: deps.now(), by: deps.user, type: 'merged', detail: `by ${by}, ${outcome}` });
  await save(deps, key, closed, `Merged by ${by} · ${outcome}`);
  return { key, by, asIs };
};

const revertedNumber = async (deps: LoopDeps, message: string, pullRequest: PullRequest | undefined): Promise<number | undefined> => {
  if (pullRequest?.reverts !== undefined) return pullRequest.reverts;
  const commit = REVERTED_COMMIT.exec(message)?.[1];
  return commit === undefined ? undefined : numberIn(await deps.commitMessage(commit));
};

const writeRevert = async (deps: LoopDeps, original: Found | undefined, by: string): Promise<RecordMergeResult['reverted']> => {
  if (original === undefined || original.run.revert?.merged === true) return undefined;
  const { key, record, index } = original;
  const at = deps.now();
  const reverted = changeRun(record, index, (run) => {
    const { needed: _needed, ...earlier } = run.revert ?? { at, by };
    return { ...run, revert: { ...earlier, by, merged: true } };
  });
  await save(deps, key, appendEvent(reverted, { at, by: deps.user, type: 'reverted', detail: by }), `Reverted by ${by}`);
  return { key, by };
};

export const recordMerge = async (deps: LoopDeps, { commit, pullRequest: given }: MergedChange): Promise<RecordMergeResult> => {
  const message = await deps.commitMessage(commit);
  const number = given ?? numberIn(message);
  const pullRequest = number === undefined ? undefined : await deps.sourceControl.getPullRequest(number);
  const found = await findRun(deps, number);
  const merged = found === undefined ? undefined : await writeMerge(deps, found);
  const target = await revertedNumber(deps, message, pullRequest);
  const reverted = target === undefined ? undefined : await writeRevert(deps, await findRun(deps, target), number === undefined ? `commit ${commit}` : `pull request ${number}`);
  return { ok: true, ...(merged === undefined ? {} : { merged }), ...(reverted === undefined ? {} : { reverted }) };
};

const openRevert = async (deps: LoopDeps, found: Found, cause: string): Promise<{ readonly action: 'opened' | 'needed'; readonly url: string; readonly record: TicketRecord }> => {
  const { record, index, pullRequest } = found;
  const at = deps.now();
  const opened = await deps.sourceControl.openRevertPullRequest(pullRequest.number).then(
    (revert) => revert.url,
    () => undefined,
  );
  const revert = opened === undefined ? { at, by: cause, needed: true } : { at, by: cause, pullRequest: opened };
  const changed = appendEvent(changeRun(record, index, (run) => ({ ...run, revert })), {
    at,
    by: deps.user,
    type: opened === undefined ? 'revert_needed' : 'revert_opened',
    detail: cause,
  });
  return { action: opened === undefined ? 'needed' : 'opened', url: opened ?? pullRequest.url, record: changed };
};

export const revertMerge = async (deps: LoopDeps, { commit, pullRequest: given }: MergedChange): Promise<RevertResult> => {
  const found = await findRun(deps, given ?? numberIn(await deps.commitMessage(commit)));
  if (found === undefined || !autoMerged(found.run) || found.run.merge?.at === undefined || found.run.revert !== undefined) return { ok: true, action: 'none' };
  const { action, url, record } = await openRevert(deps, found, `main failed at ${commit}`);
  await save(deps, found.key, record, action === 'opened' ? 'Revert opened: main failed after the auto-merge' : 'Revert needed: main failed after the auto-merge');
  return { ok: true, action, key: found.key, url };
};

type SmokeFailure = { readonly check: string; readonly detail: string };

const smoke = async (deps: LoopDeps, rounds: number, intervalSeconds: number): Promise<SmokeFailure | undefined> => {
  const failed = await deps.config.watch.checks.reduce<Promise<SmokeFailure | undefined>>(async (previous, check) => {
    const earlier = await previous;
    if (earlier !== undefined) return earlier;
    const run = await deps.runScript(check, { timeoutSeconds: SMOKE_CHECK_TIMEOUT_SECONDS });
    return run.exitCode === 0 && !run.timedOut ? undefined : { check, detail: run.output.slice(-DETAIL_LIMIT) };
  }, Promise.resolve(undefined));
  if (failed !== undefined || rounds <= 1) return failed;
  await deps.sleep(intervalSeconds * 1000);
  return smoke(deps, rounds - 1, intervalSeconds);
};

export const watchRun = async (deps: LoopDeps, { commit, pullRequest: given }: MergedChange): Promise<WatchResult> => {
  const { enabled, duration, interval } = deps.config.watch;
  if (!enabled) return { ok: true, action: 'off' };
  const found = await findRun(deps, given ?? numberIn(await deps.commitMessage(commit)));
  if (found === undefined || found.run.watch !== undefined) return { ok: true, action: 'none' };

  const intervalSeconds = timeoutSecondsOf({ timeout: interval });
  const failure = await smoke(deps, Math.ceil(timeoutSecondsOf({ timeout: duration }) / intervalSeconds), intervalSeconds);
  const at = deps.now();
  if (failure === undefined) {
    const delivered = changeRun(found.record, found.index, (run) => ({ ...run, watch: { at, passed: true } }));
    await save(deps, found.key, appendEvent(delivered, { at, by: deps.user, type: 'delivered', detail: 'the staging watch passed' }), 'Delivered · the staging watch passed');
    return { ok: true, action: 'delivered', key: found.key };
  }

  const reverting = found.run.revert === undefined ? await openRevert(deps, found, `the staging watch failed on ${failure.check}`) : undefined;
  const base = reverting?.record ?? found.record;
  const watched = changeRun(base, found.index, (run) => ({ ...run, watch: { at, passed: false, detail: `${failure.check}: ${failure.detail}` } }));
  const action = reverting?.action ?? (found.run.revert?.needed === true ? 'needed' : 'opened');
  await save(deps, found.key, watched, action === 'opened' ? 'Revert opened: the staging watch failed' : 'Revert needed: the staging watch failed');
  return { ok: true, action: 'failed', key: found.key, check: failure.check, revert: action, url: reverting?.url ?? found.run.revert?.pullRequest ?? found.pullRequest.url };
};
