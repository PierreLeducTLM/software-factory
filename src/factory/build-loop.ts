import { z } from 'zod';
import type { Worktree } from '../adapters/agent-runtime.js';
import type { SourceControl } from '../adapters/source-control.js';
import type { Ticket } from '../adapters/ticket-provider.js';
import { loadRecord, saveRecord } from '../record/record-store.js';
import {
  changeLatestRun,
  endRun,
  endStep,
  latestRun,
  recordSendBack,
  setState,
  startStep,
  type Approval,
  type Attempt,
  type FactoryState,
  type Run,
  type SendBackQuestion,
  type TicketRecord,
} from '../record/ticket-record.js';
import { gatePassed, inScope, jsonIn, judgeAgentCheck, riskRaiseOf, runScriptChecks, timeoutSecondsOf, type CheckOutcome, type ScriptRun } from './checks.js';
import { autoMergeSuspended } from './merge.js';
import { nextTasks, parseTasks, tasksCommitStatus, withOpenTasksSection, type TaskList } from './open-tasks.js';
import { revalidate, type RefinementDeps } from './refinement.js';
import { assessDiff, capabilitiesIn, decideMerge, higherRisk, raisedRisk, type MergeDecision, type RiskRaise, type RiskSignal } from './risk.js';
import { summaryOf } from './run-lifecycle.js';

export type LoopDeps = RefinementDeps & {
  readonly sourceControl: SourceControl;
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly changedFilesOnBranch: () => Promise<readonly string[]>;
  readonly linesChangedOnBranch: () => Promise<number>;
  readonly pushBranch: (branch: string) => Promise<void>;
  readonly commitMessage: (commit: string) => Promise<string>;
  readonly changeFolders: () => Promise<readonly ChangeFolder[]>;
  readonly archiveChange: (name: string) => Promise<ArchiveResult>;
  readonly readFileOnBranch: (path: string) => Promise<string | undefined>;
};

export type ChangeFolder = { readonly name: string; readonly files: readonly string[]; readonly archived: boolean };

export type ArchiveResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type Diagnosis = {
  readonly kind: 'code' | 'spec' | 'environment';
  readonly nextStep?: string;
  readonly questions?: readonly SendBackQuestion[];
};

export type AdvanceInput = {
  readonly built?: { readonly changed: string; readonly decisions: readonly string[] };
  readonly question?: SendBackQuestion;
  readonly verdicts?: Readonly<Record<string, string>>;
  readonly diagnosis?: Diagnosis;
};

type RecordedOutcome = Attempt['outcomes'][number];

type ReviewCheck = { readonly id: string; readonly criteria?: string; readonly evidence?: string };

type ConfiguredReviewCheck = { readonly id: string; readonly criteria: string; readonly evidence: string; readonly blocking: boolean };

type FailedAttempt = { readonly number: number; readonly changed: string; readonly failures: readonly RecordedOutcome[] };

type Refusal = 'no_worktree' | 'no_run' | 'input_required';

export type AdvanceResult =
  | { readonly ok: true; readonly next: 'build'; readonly attempt: number; readonly feedback: readonly RecordedOutcome[] }
  | { readonly ok: true; readonly next: 'verify'; readonly attempt: number }
  | { readonly ok: true; readonly next: 'review'; readonly attempt: number; readonly checks: readonly ReviewCheck[] }
  | { readonly ok: true; readonly next: 'diagnose'; readonly attempts: readonly FailedAttempt[] }
  | { readonly ok: true; readonly next: 'done'; readonly exit: 'pull_request'; readonly url: string }
  | { readonly ok: true; readonly next: 'done'; readonly exit: 'sent_back'; readonly findings: readonly string[] }
  | { readonly ok: true; readonly next: 'done'; readonly exit: 'blocked'; readonly report: string }
  | { readonly ok: false; readonly reason: Refusal; readonly message: string };

type Context = { readonly deps: LoopDeps; readonly key: string; readonly ticket: Ticket; readonly worktree: Worktree; readonly approval: Approval };

const VERIFY = 'openspec-verify';
const REVIEWER = 'reviewer';
const REVIEW_STATION = 'review';
const QUALITY_STATION = 'quality';
const RISK_SCRIPT_TIMEOUT_SECONDS = 120;
const PERSON_MERGES = 'A person merges this pull request.';
const ARCHIVE = 'archive';
const FACTORY_PREFIX = 'factory-';
const CANONICAL_SPECS = 'openspec/specs/';
const STEP_TIMEOUT_SECONDS = { revalidate: 120, build: 1800, verify: 600, review: 900, diagnose: 600 } as const;

const refuse = (reason: Refusal, message: string): AdvanceResult => ({ ok: false, reason, message });

const failuresOf = (attempt: Attempt): readonly RecordedOutcome[] => attempt.outcomes.filter((outcome) => outcome.status === 'failed');

const currentAttempt = (record: TicketRecord): Attempt => {
  const attempt = latestRun(record).attempts.at(-1);
  if (attempt === undefined) throw new Error('The run has no attempt');
  return attempt;
};

const withOutcomes = (record: TicketRecord, outcomes: readonly CheckOutcome[]): TicketRecord =>
  changeLatestRun(record, (run) => ({
    ...run,
    attempts: run.attempts.map((attempt, index) =>
      index === run.attempts.length - 1
        ? { ...attempt, outcomes: [...attempt.outcomes, ...outcomes.map(({ evidence, ...outcome }) => (evidence === undefined ? outcome : { ...outcome, evidence: [...evidence] }))] }
        : attempt,
    ),
  }));

const save = ({ deps, key }: Context, record: TicketRecord, note: string): Promise<void> =>
  saveRecord(deps.tickets, { key, record, summary: summaryOf(record, note), budget: deps.recordBudget });

const begin = ({ deps }: Context, record: TicketRecord, name: string, timeoutSeconds: number): TicketRecord =>
  startStep(record, { name, at: deps.now(), timeoutSeconds, by: deps.user });

const finish = ({ deps }: Context, record: TicketRecord): TicketRecord => endStep(record, { at: deps.now(), by: deps.user });

const leave = async (context: Context, record: TicketRecord, status: Exclude<Run['status'], 'running'>, state: FactoryState, note: string): Promise<void> => {
  const { deps, key } = context;
  const at = deps.now();
  const closed = setState(endRun(finish(context, record), { status, at, by: deps.user }), { state, at, by: deps.user });
  await deps.tickets.transition({ key, from: deps.config.states.in_development, to: deps.config.states[state] });
  await save(context, closed, note);
};

const sendBack = async (context: Context, record: TicketRecord, questions: readonly SendBackQuestion[]): Promise<AdvanceResult> => {
  const { deps } = context;
  await leave(context, recordSendBack(record, { questions, at: deps.now(), by: deps.user }), 'sent_back', 'spec_review', 'sent back to refinement');
  return { ok: true, next: 'done', exit: 'sent_back', findings: questions.map(({ question }) => question) };
};

const failAttempt = async (context: Context, record: TicketRecord): Promise<AdvanceResult> => {
  const run = latestRun(record);
  const closed = finish(context, record);
  if (run.attempt < run.attemptLimit) {
    const next = begin(context, changeLatestRun(closed, (current) => ({ ...current, attempt: current.attempt + 1 })), 'build', STEP_TIMEOUT_SECONDS.build);
    await save(context, next, 'build started');
    return { ok: true, next: 'build', attempt: run.attempt + 1, feedback: failuresOf(currentAttempt(record)) };
  }
  await save(context, begin(context, closed, 'diagnose', STEP_TIMEOUT_SECONDS.diagnose), 'diagnosis needed');
  return { ok: true, next: 'diagnose', attempts: run.attempts.map((attempt) => ({ number: attempt.number, changed: attempt.changed, failures: failuresOf(attempt) })) };
};

const resultLine = (outcome: RecordedOutcome): string =>
  `- ${outcome.id} (${outcome.station}): ${outcome.status}${outcome.reason === undefined ? '' : ` (${outcome.reason})`}`;

const ScriptSignalsSchema = z.object({ signals: z.array(z.object({ name: z.string().min(1), points: z.number().int(), reason: z.string() })) });

type RunRisk = NonNullable<Run['risk']>;

const scriptSignals = async ({ config, runScript }: LoopDeps): Promise<readonly RiskSignal[]> => {
  const { script, thresholds } = config.risk;
  if (script === undefined) return [];
  const run = await runScript(script, { timeoutSeconds: RISK_SCRIPT_TIMEOUT_SECONDS });
  const parsed = ScriptSignalsSchema.safeParse(run.exitCode === 0 && !run.timedOut ? jsonIn(run.output) : undefined);
  return parsed.success ? parsed.data.signals : [{ name: 'risk script', points: thresholds.high, reason: 'the risk script failed, so the change is treated as high risk' }];
};

const assessRun = async ({ deps, key, approval }: Context, record: TicketRecord, raise: RiskRaise | undefined): Promise<RunRisk> => {
  const actual = assessDiff(
    deps.config.risk,
    {
      paths: await deps.changedFilesOnBranch(),
      lines: await deps.linesChangedOnBranch(),
      capabilities: capabilitiesIn((await deps.tickets.listAttachments(key)).map(({ name }) => name)),
      attempts: latestRun(record).attempt,
      warnings: currentAttempt(record).outcomes.filter((outcome) => outcome.status === 'warning').length,
    },
    await scriptSignals(deps),
  );
  const scored = higherRisk(approval.predictedRisk, actual.level);
  const level = raisedRisk(scored, raise);
  return {
    predicted: approval.predictedRisk,
    actual: actual.level,
    level,
    score: actual.score,
    signals: actual.signals.map((signal) => ({ ...signal })),
    ...(raise !== undefined && level !== scored ? { raised: raise.reason } : {}),
  };
};

const signed = (points: number): string => (points < 0 ? String(points) : `+${points}`);

const mergeLine = (decision: MergeDecision, refused?: string): string => {
  if (refused !== undefined) return `Auto-merge refused: ${refused}. ${PERSON_MERGES}`;
  if (decision.route === 'auto') return `Auto-merge enabled: ${decision.reason}`;
  return decision.wouldAutoMerge ? `Would have auto-merged: ${decision.reason}. ${PERSON_MERGES}` : `Merged by a person: ${decision.reason}`;
};

const pullRequestBody = ({ key, approval }: Context, record: TicketRecord, risk: RunRisk, merge: string): string => {
  const run = latestRun(record);
  const decisions = [...new Set(run.attempts.flatMap((attempt) => attempt.decisions))];
  return [
    `Ticket: ${key}`,
    `Spec: approved by ${approval.approver} at ${approval.at}`,
    '',
    '## Decisions applied',
    ...(decisions.length === 0 ? ['None recorded'] : decisions.map((decision) => `- ${decision}`)),
    '',
    '## Gate results',
    ...currentAttempt(record).outcomes.map(resultLine),
    '',
    `Attempts: ${run.attempt}`,
    '',
    '## Risk',
    `Level: ${risk.level} (predicted ${risk.predicted}, actual ${risk.actual}, score ${risk.score})`,
    ...(risk.signals.length === 0 ? ['No risk signal'] : risk.signals.map((signal) => `- ${signal.name} (${signed(signal.points)}): ${signal.reason}`)),
    ...(risk.raised === undefined ? [] : [`Raised by the reviewer: ${risk.raised}`]),
    '',
    '## Merge',
    merge,
  ].join('\n');
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const markdownOf = (files: readonly string[]): readonly string[] => files.filter((file) => file.endsWith('.md')).toSorted();

const sameFiles = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((file, index) => file === right[index]);

type Change = { readonly name: string; readonly archived: boolean };

const onlyOne = (folders: readonly ChangeFolder[]): Change | undefined => {
  const [folder] = folders;
  return folders.length === 1 && folder !== undefined ? { name: folder.name, archived: folder.archived } : undefined;
};

const changeOf = async ({ deps, key }: Context): Promise<Change | undefined> => {
  const attached = (await deps.tickets.listAttachments(key)).map(({ name }) => name).filter((name) => !name.startsWith(FACTORY_PREFIX));
  const spec = markdownOf([...new Set(attached)].map((name) => name.replaceAll('__', '/')));
  const matching = (await deps.changeFolders()).filter((folder) => sameFiles(markdownOf(folder.files), spec));
  const open = matching.filter((folder) => !folder.archived);
  return open.length > 0 ? onlyOne(open) : onlyOne(matching);
};

const notFound = (key: string): string =>
  `The approved spec of ${key} is not in one folder under openspec/changes/. Pull it with factory pull ${key} --to openspec/changes/<name> and commit it.`;

const archiveRefused = (name: string, error: string): SendBackQuestion => ({
  question: `openspec archive ${name} failed:\n${error}\nHow should the delta spec change so that it applies to the canonical specs in ${CANONICAL_SPECS}?`,
  recommended: `Fix the delta spec so that it applies to the canonical specs in ${CANONICAL_SPECS}, then run the ready gate again.`,
});

const deliver = async (context: Context, record: TicketRecord, raise: RiskRaise | undefined): Promise<AdvanceResult> => {
  const { deps, key } = context;
  const change = await changeOf(context);
  if (change === undefined) {
    return failAttempt(context, withOutcomes(record, [{ id: ARCHIVE, station: REVIEW_STATION, status: 'failed', reason: notFound(key), durationSeconds: 0 }]));
  }
  if (change.archived) return openPullRequest(context, record, raise);
  const archived = await deps.archiveChange(change.name);
  if (!archived.ok) return sendBack(context, record, [archiveRefused(change.name, archived.error)]);
  return openPullRequest(context, record, raise);
};

type ReadTasks = { readonly path: string; readonly list: TaskList };

const tasksPathOf = (change: Change): string => `openspec/changes/${change.archived ? `${ARCHIVE}/` : ''}${change.name}/tasks.md`;

const readTasks = async (context: Context): Promise<ReadTasks | undefined> => {
  const change = await changeOf(context);
  if (change === undefined) return undefined;
  const path = tasksPathOf(change);
  const text = await context.deps.readFileOnBranch(path);
  return text === undefined ? undefined : { path, list: parseTasks(text) };
};

const openPullRequest = async (context: Context, record: TicketRecord, raise: RiskRaise | undefined): Promise<AdvanceResult> => {
  const { deps, key, ticket, worktree, approval } = context;
  const risk = await assessRun(context, record, raise);
  const read = await readTasks(context);
  const decision = decideMerge(deps.config.risk, risk.level, {
    ...(approval.mergeCeiling === undefined ? {} : { ceiling: approval.mergeCeiling }),
    noAutomergeLabel: ticket.labels.includes(deps.config.labels.no_automerge),
    suspended: deps.config.risk[risk.level].merge === 'auto' && (await autoMergeSuspended(deps, risk.level)),
    ...(read === undefined ? {} : { openTasks: { open: read.list.open.length, total: read.list.total } }),
  });
  const bodyWith = (merge: string): string => {
    const body = pullRequestBody(context, record, risk, merge);
    return read === undefined ? body : withOpenTasksSection(body, { ...read.list, accepted: [] });
  };
  await deps.pushBranch(worktree.branch);
  const pullRequest = await deps.sourceControl.openPullRequest({
    branch: worktree.branch,
    base: deps.config.main_branch,
    title: `${key} ${ticket.title}`,
    body: bodyWith(mergeLine(decision)),
  });
  const refused = decision.route === 'auto' ? await deps.sourceControl.enableAutoMerge(pullRequest.number).then(() => undefined, messageOf) : undefined;
  if (refused !== undefined) {
    await deps.sourceControl.updatePullRequestBody({ number: pullRequest.number, body: bodyWith(mergeLine(decision, refused)) });
  }
  const tasks = read === undefined ? undefined : nextTasks(undefined, read.list, { path: read.path, commit: pullRequest.headCommit });
  const linked = changeLatestRun(record, (run) => ({
    ...run,
    pullRequest: { number: pullRequest.number, url: pullRequest.url, headCommit: pullRequest.headCommit },
    risk,
    merge: { ...decision, ...(refused === undefined ? {} : { refused }) },
    ...(tasks === undefined ? {} : { tasks }),
  }));
  await leave(context, linked, 'in_review', 'in_review', 'pull request opened');
  if (tasks !== undefined) await deps.sourceControl.postStatus(tasksCommitStatus(tasks, pullRequest));
  return { ok: true, next: 'done', exit: 'pull_request', url: pullRequest.url };
};

const failureReport = ({ key, worktree }: Context, record: TicketRecord, diagnosis: Diagnosis): string =>
  [
    `# Failure report: ${key}, run ${record.runs.length}`,
    '',
    `Diagnosis: ${diagnosis.kind}`,
    '',
    ...latestRun(record).attempts.flatMap((attempt) => [
      `## Attempt ${attempt.number}`,
      ...failuresOf(attempt).flatMap((failure) => [
        `- Failed: ${failure.id} (${failure.station}): ${String(failure.reason)}`,
        ...(failure.detail === undefined ? [] : [`  ${failure.detail.split('\n', 1).join('')}`]),
      ]),
      `- Changed: ${attempt.changed}`,
      '',
    ]),
    `Branch: ${worktree.branch}`,
    ...(diagnosis.nextStep === undefined ? [] : [`Suggested next step: ${diagnosis.nextStep}`]),
    '',
  ].join('\n');

const afterBuild = async (context: Context, record: TicketRecord, input: AdvanceInput): Promise<AdvanceResult> => {
  const { deps, worktree } = context;
  if (input.question !== undefined) return sendBack(context, record, [input.question]);
  if (input.built === undefined) return refuse('input_required', 'Say what was built, or hand in a question the spec does not answer');

  const { changed, decisions } = input.built;
  const run = latestRun(record);
  const built = changeLatestRun(finish(context, record), (current) => ({
    ...current,
    attempts: [...current.attempts, { number: run.attempt, changed, decisions: [...decisions], outcomes: [] }],
  }));
  const qualityChecks = deps.config.checks.filter((check) => check.station === QUALITY_STATION);
  const gating = begin(context, built, QUALITY_STATION, qualityChecks.reduce((total, check) => total + timeoutSecondsOf(check), 0));
  const outcomes = await runScriptChecks(
    { runScript: deps.runScript, ciResult: deps.sourceControl.getCiResult, sleep: deps.sleep, now: deps.now },
    { checks: deps.config.checks, station: QUALITY_STATION, changedFiles: await deps.changedFilesOnBranch(), branch: worktree.branch },
  );
  const gated = withOutcomes(gating, outcomes);
  if (!gatePassed(outcomes)) return failAttempt(context, gated);

  await save(context, begin(context, finish(context, gated), 'verify', STEP_TIMEOUT_SECONDS.verify), 'verify started');
  return { ok: true, next: 'verify', attempt: run.attempt };
};

const reviewChecksFor = async ({ deps }: Context): Promise<readonly ConfiguredReviewCheck[]> => {
  const changedFiles = await deps.changedFilesOnBranch();
  return deps.config.checks.flatMap((check) => {
    if (check.kind !== 'agent' || check.station !== REVIEW_STATION || !inScope(check, changedFiles)) return [];
    return [{ id: check.id, criteria: check.criteria, evidence: check.evidence, blocking: check.blocking }];
  });
};

const afterVerify = async (context: Context, record: TicketRecord, input: AdvanceInput): Promise<AdvanceResult> => {
  const raw = input.verdicts?.[VERIFY];
  if (raw === undefined) return refuse('input_required', `Hand in the verdict of ${VERIFY}`);
  const outcome = judgeAgentCheck({ id: VERIFY, station: REVIEW_STATION, blocking: true }, raw);
  const judged = withOutcomes(record, [outcome]);
  if (!gatePassed([outcome])) return failAttempt(context, judged);

  await save(context, begin(context, finish(context, judged), REVIEW_STATION, STEP_TIMEOUT_SECONDS.review), 'review started');
  const checks = (await reviewChecksFor(context)).map(({ id, criteria, evidence }) => ({ id, criteria, evidence }));
  return { ok: true, next: 'review', attempt: latestRun(record).attempt, checks: [{ id: REVIEWER }, ...checks] };
};

const afterReview = async (context: Context, record: TicketRecord, input: AdvanceInput): Promise<AdvanceResult> => {
  const { deps, worktree } = context;
  const verdicts = input.verdicts ?? {};
  if (verdicts[REVIEWER] === undefined) return refuse('input_required', `Hand in the verdict of ${REVIEWER}`);

  const agentChecks = await reviewChecksFor(context);
  const outcomes = [
    judgeAgentCheck({ id: REVIEWER, station: REVIEW_STATION, blocking: true }, verdicts[REVIEWER]),
    ...agentChecks.map((check) => judgeAgentCheck({ id: check.id, station: REVIEW_STATION, blocking: check.blocking, evidence: check.evidence }, verdicts[check.id])),
    ...(await runScriptChecks(
      { runScript: deps.runScript, ciResult: deps.sourceControl.getCiResult, sleep: deps.sleep, now: deps.now },
      { checks: deps.config.checks, station: REVIEW_STATION, changedFiles: await deps.changedFilesOnBranch(), branch: worktree.branch },
    )),
  ];
  const reviewed = withOutcomes(record, outcomes);
  return gatePassed(outcomes) ? deliver(context, reviewed, riskRaiseOf(verdicts[REVIEWER])) : failAttempt(context, reviewed);
};

const afterDiagnosis = async (context: Context, record: TicketRecord, input: AdvanceInput): Promise<AdvanceResult> => {
  const { deps, key } = context;
  const diagnosis = input.diagnosis;
  if (diagnosis === undefined) return refuse('input_required', 'Give one diagnosis: code, spec or environment');
  const diagnosed = changeLatestRun(record, (run) => ({ ...run, diagnosis: diagnosis.kind }));

  if (diagnosis.kind === 'spec') {
    const questions = diagnosis.questions ?? [];
    if (questions.length === 0) return refuse('input_required', 'A spec diagnosis needs at least one question with a recommended answer');
    return sendBack(context, diagnosed, questions);
  }

  const report = await deps.tickets.addAttachment({
    key,
    name: `factory-failure-report-run-${record.runs.length}.md`,
    content: failureReport(context, record, diagnosis),
  });
  await leave(context, changeLatestRun(diagnosed, (run) => ({ ...run, report })), 'blocked', 'blocked', `blocked (${diagnosis.kind})`);
  return { ok: true, next: 'done', exit: 'blocked', report };
};

const start = async (context: Context, record: TicketRecord): Promise<AdvanceResult> => {
  const { deps, key } = context;
  const checking = begin(context, record, 'revalidate', STEP_TIMEOUT_SECONDS.revalidate);
  const checked = await revalidate(deps, key);
  if (checked.ok && !checked.passed) return { ok: true, next: 'done', exit: 'sent_back', findings: checked.findings };

  await save(context, begin(context, finish(context, checking), 'build', STEP_TIMEOUT_SECONDS.build), 'build started');
  return { ok: true, next: 'build', attempt: latestRun(record).attempt, feedback: [] };
};

export const advance = async (deps: LoopDeps, key: string, input: AdvanceInput): Promise<AdvanceResult> => {
  const worktree = await deps.runtime.currentWorktree();
  if (worktree === undefined) return refuse('no_worktree', 'Run this from inside an Orca worktree');

  const ticket = await deps.tickets.getTicket(key);
  const loaded = await loadRecord(deps.tickets, key);
  const run = loaded.status === 'ok' ? loaded.record.runs.at(-1) : undefined;
  const approval = loaded.status === 'ok' ? loaded.record.refinement.approval : undefined;
  const inDevelopment = ticket?.status === deps.config.states.in_development;
  if (ticket === undefined || loaded.status !== 'ok' || approval === undefined || run?.status !== 'running' || !inDevelopment) {
    return refuse('no_run', `${key} has no run in progress`);
  }

  const context: Context = { deps, key, ticket, worktree, approval };
  const open = run.steps.find((step) => step.endedAt === undefined)?.name;
  if (open === 'build') return afterBuild(context, loaded.record, input);
  if (open === 'verify') return afterVerify(context, loaded.record, input);
  if (open === REVIEW_STATION) return afterReview(context, loaded.record, input);
  if (open === 'diagnose') return afterDiagnosis(context, loaded.record, input);
  return start(context, loaded.record);
};
