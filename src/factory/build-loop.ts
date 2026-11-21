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
import { gatePassed, inScope, judgeAgentCheck, runScriptChecks, timeoutSecondsOf, type CheckOutcome, type ScriptRun } from './checks.js';
import { revalidate, type RefinementDeps } from './refinement.js';
import { summaryOf } from './run-lifecycle.js';

export type LoopDeps = RefinementDeps & {
  readonly sourceControl: SourceControl;
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly changedFilesOnBranch: () => Promise<readonly string[]>;
  readonly pushBranch: (branch: string) => Promise<void>;
};

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

const pullRequestBody = ({ key, approval }: Context, record: TicketRecord): string => {
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
    `Risk: predicted ${approval.predictedRisk}`,
  ].join('\n');
};

const deliver = async (context: Context, record: TicketRecord): Promise<AdvanceResult> => {
  const { deps, key, ticket, worktree } = context;
  await deps.pushBranch(worktree.branch);
  const pullRequest = await deps.sourceControl.openPullRequest({
    branch: worktree.branch,
    base: deps.config.main_branch,
    title: `${key} ${ticket.title}`,
    body: pullRequestBody(context, record),
  });
  const linked = changeLatestRun(record, (run) => ({ ...run, pullRequest: { number: pullRequest.number, url: pullRequest.url } }));
  await leave(context, linked, 'in_review', 'in_review', 'pull request opened');
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
  return gatePassed(outcomes) ? deliver(context, reviewed) : failAttempt(context, reviewed);
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
