import { createHash } from 'node:crypto';
import { z } from 'zod';

const EventSchema = z.object({
  at: z.string(),
  by: z.string(),
  type: z.string(),
  detail: z.string().optional(),
});

const StepSchema = z.object({
  name: z.string(),
  attempt: z.number().int().min(1),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  timeoutSeconds: z.number().int().min(1),
});

const OutcomeSchema = z.object({
  id: z.string(),
  station: z.string(),
  status: z.enum(['passed', 'failed', 'warning', 'skipped']),
  reason: z.string().optional(),
  detail: z.string().optional(),
  durationSeconds: z.number(),
  evidence: z.array(z.string()).optional(),
});

const AttemptSchema = z.object({
  number: z.number().int().min(1),
  changed: z.string(),
  decisions: z.array(z.string()),
  outcomes: z.array(OutcomeSchema),
});

const RiskLevelSchema = z.enum(['low', 'medium', 'high']);

const RunRiskSchema = z.object({
  predicted: RiskLevelSchema,
  actual: RiskLevelSchema,
  level: RiskLevelSchema,
  score: z.number(),
  signals: z.array(z.object({ name: z.string(), points: z.number(), reason: z.string() })),
  raised: z.string().optional(),
});

const RunMergeSchema = z.object({
  route: z.enum(['auto', 'human']),
  wouldAutoMerge: z.boolean(),
  reason: z.string(),
  refused: z.string().optional(),
  at: z.string().optional(),
  by: z.string().optional(),
  asIs: z.boolean().optional(),
});

const RunRevertSchema = z.object({
  at: z.string(),
  by: z.string(),
  pullRequest: z.string().optional(),
  needed: z.boolean().optional(),
  merged: z.boolean().optional(),
});

const RunTasksSchema = z.object({
  total: z.number().int().min(0),
  path: z.string(),
  commit: z.string(),
  open: z.array(z.object({ text: z.string(), note: z.string().optional() })),
  accepted: z.array(z.object({ text: z.string(), by: z.string(), at: z.string() })),
});

const RunSchema = z.object({
  claimant: z.string(),
  machine: z.string(),
  worktreeId: z.string(),
  startedAt: z.string(),
  status: z.enum(['running', 'sent_back', 'blocked', 'in_review', 'merged']),
  attempt: z.number().int().min(1),
  attemptLimit: z.number().int().min(1),
  steps: z.array(StepSchema),
  attempts: z.array(AttemptSchema),
  diagnosis: z.enum(['code', 'spec', 'environment']).optional(),
  report: z.string().optional(),
  pullRequest: z.object({ number: z.number(), url: z.string(), headCommit: z.string().optional() }).optional(),
  risk: RunRiskSchema.optional(),
  merge: RunMergeSchema.optional(),
  revert: RunRevertSchema.optional(),
  watch: z.object({ at: z.string(), passed: z.boolean(), detail: z.string().optional() }).optional(),
  tasks: RunTasksSchema.optional(),
  compacted: z.boolean().optional(),
});

const FactoryStateSchema = z.enum(['to_refine', 'spec_review', 'ready_for_dev', 'in_development', 'in_review', 'blocked', 'done']);

const ApprovalSchema = z.object({
  approver: z.string(),
  at: z.string(),
  mainCommit: z.string(),
  fingerprint: z.string(),
  predictedRisk: RiskLevelSchema,
  mergeCeiling: z.literal('human').optional(),
});

const ReadyGateSchema = z.object({
  passed: z.boolean(),
  fingerprint: z.string(),
  findings: z.array(z.string()),
  at: z.string(),
});

const SendBackSchema = z.object({
  at: z.string(),
  questions: z.array(z.object({ question: z.string(), recommended: z.string() })),
});

const TicketRecordSchema = z.object({
  schema: z.literal(1),
  repository: z.string(),
  state: FactoryStateSchema.optional(),
  refinement: z.object({ readyGate: ReadyGateSchema.optional(), approval: ApprovalSchema.optional(), sendBack: SendBackSchema.optional() }),
  runs: z.array(RunSchema),
  events: z.array(EventSchema),
  archives: z.array(z.string()),
});

export type FactoryEvent = Readonly<z.infer<typeof EventSchema>>;
export type Run = Readonly<z.infer<typeof RunSchema>>;
export type RunTasks = Readonly<z.infer<typeof RunTasksSchema>>;
export type Attempt = Readonly<z.infer<typeof AttemptSchema>>;
export type FactoryState = z.infer<typeof FactoryStateSchema>;
export type Approval = Readonly<z.infer<typeof ApprovalSchema>>;
export type TicketRecord = Readonly<z.infer<typeof TicketRecordSchema>>;

export type ParsedComment =
  | { readonly status: 'ok'; readonly record: TicketRecord }
  | { readonly status: 'none' }
  | { readonly status: 'edited' }
  | { readonly status: 'invalid' };

export const createRecord = ({ repository }: { readonly repository: string }): TicketRecord => ({
  schema: 1,
  repository,
  refinement: {},
  runs: [],
  events: [],
  archives: [],
});

export const appendEvent = (record: TicketRecord, event: FactoryEvent): TicketRecord => ({
  ...record,
  events: [...record.events, event],
});

type ReadyGateResult = {
  readonly passed: boolean;
  readonly fingerprint: string;
  readonly findings: readonly string[];
  readonly at: string;
  readonly by: string;
};

export const recordReadyGate = (record: TicketRecord, { passed, fingerprint, findings, at, by }: ReadyGateResult): TicketRecord =>
  appendEvent(
    { ...record, refinement: { ...record.refinement, readyGate: { passed, fingerprint, findings: [...findings], at } } },
    { at, by, type: 'ready_gate', detail: passed ? 'passed' : 'failed' },
  );

type RunStart = {
  readonly claimant: string;
  readonly machine: string;
  readonly worktreeId: string;
  readonly at: string;
  readonly attemptLimit: number;
};

export const startRun = (record: TicketRecord, { claimant, machine, worktreeId, at, attemptLimit }: RunStart): TicketRecord =>
  appendEvent(
    {
      ...record,
      runs: [...record.runs, { claimant, machine, worktreeId, startedAt: at, status: 'running', attempt: 1, attemptLimit, steps: [], attempts: [] }],
    },
    { at, by: claimant, type: 'claimed', detail: `run ${record.runs.length + 1}` },
  );

type RunEnd = { readonly status: Exclude<Run['status'], 'running'>; readonly at: string; readonly by: string };

export const endRun = (record: TicketRecord, { status, at, by }: RunEnd): TicketRecord =>
  appendEvent(
    changeLatestRun(record, (run) => ({ ...run, status })),
    { at, by, type: 'run_ended', detail: status },
  );

export const latestRun = (record: TicketRecord): Run => {
  const run = record.runs.at(-1);
  if (run === undefined) throw new Error('The record has no run');
  return run;
};

export const changeLatestRun = (record: TicketRecord, change: (run: Run) => Run): TicketRecord => ({
  ...record,
  runs: record.runs.map((run, index) => (index === record.runs.length - 1 ? change(run) : run)),
});

type StateChange = { readonly state: FactoryState; readonly at: string; readonly by: string };

export const setState = (record: TicketRecord, { state, at, by }: StateChange): TicketRecord =>
  appendEvent({ ...record, state }, { at, by, type: 'state', detail: `${record.state ?? 'none'} to ${state}` });

export type SendBackQuestion = { readonly question: string; readonly recommended: string };

type SendBack = { readonly questions: readonly SendBackQuestion[]; readonly at: string; readonly by: string };

export const recordSendBack = (record: TicketRecord, { questions, at, by }: SendBack): TicketRecord =>
  appendEvent(
    { ...record, refinement: { ...record.refinement, sendBack: { at, questions: [...questions] } } },
    { at, by, type: 'sent_back', detail: `${questions.length} question${questions.length === 1 ? '' : 's'}` },
  );

export const recordApproval = (record: TicketRecord, approval: Approval): TicketRecord => {
  const { sendBack: _answered, ...refinement } = record.refinement;
  return appendEvent(
    { ...record, refinement: { ...refinement, approval } },
    { at: approval.at, by: approval.approver, type: 'approved', detail: `${approval.predictedRisk} risk` },
  );
};

type StepStart = { readonly name: string; readonly at: string; readonly timeoutSeconds: number; readonly by: string };

export const startStep = (record: TicketRecord, { name, at, timeoutSeconds, by }: StepStart): TicketRecord =>
  appendEvent(
    changeLatestRun(record, (run) => ({ ...run, steps: [...run.steps, { name, attempt: run.attempt, startedAt: at, timeoutSeconds }] })),
    { at, by, type: 'step_started', detail: name },
  );

export const endStep = (record: TicketRecord, { at, by }: { readonly at: string; readonly by: string }): TicketRecord => {
  const open = record.runs.at(-1)?.steps.find((step) => step.endedAt === undefined);
  if (open === undefined) return record;
  return appendEvent(
    changeLatestRun(record, (run) => ({ ...run, steps: run.steps.map((step) => (step === open ? { ...step, endedAt: at } : step)) })),
    { at, by, type: 'step_ended', detail: open.name },
  );
};

type Takeover = { readonly by: string; readonly machine: string; readonly worktreeId: string; readonly at: string };

export const takeOverRun = (record: TicketRecord, { by, machine, worktreeId, at }: Takeover): TicketRecord =>
  appendEvent(
    changeLatestRun(record, (run) => ({ ...run, claimant: by, machine, worktreeId })),
    { at, by, type: 'takeover', detail: `from ${latestRun(record).claimant}` },
  );

const checksumOf = (text: string): string => createHash('sha256').update(text).digest('hex');

const BlockPartsSchema = z.tuple([z.string(), z.string()]);

const BLOCK_PATTERN = /```factory-record sha256=([0-9a-f]{64})\n([\s\S]*?)\n```/;

export const renderComment = ({ record, summary }: { readonly record: TicketRecord; readonly summary: string }): string => {
  const json = JSON.stringify(record);
  return `${summary}\n\n\`\`\`factory-record sha256=${checksumOf(json)}\n${json}\n\`\`\`\n`;
};

export const parseComment = (comment: string, options: { readonly trustEdited: boolean }): ParsedComment => {
  const match = BLOCK_PATTERN.exec(comment);
  if (match === null) return { status: 'none' };
  const [checksum, json] = BlockPartsSchema.parse(match.slice(1));
  if (checksumOf(json) !== checksum && !options.trustEdited) return { status: 'edited' };
  const parsed = TicketRecordSchema.safeParse(JSON.parse(json));
  return parsed.success ? { status: 'ok', record: parsed.data } : { status: 'invalid' };
};
