import { createHash } from 'node:crypto';
import { z } from 'zod';

const EventSchema = z.object({
  at: z.string(),
  by: z.string(),
  type: z.string(),
  detail: z.string().optional(),
});

const RunSchema = z.object({
  claimant: z.string(),
  machine: z.string(),
  startedAt: z.string(),
  status: z.enum(['running', 'sent_back', 'blocked', 'in_review', 'merged']),
  attempt: z.number().int().min(1),
  attemptLimit: z.number().int().min(1),
});

const ReadyGateSchema = z.object({
  passed: z.boolean(),
  findings: z.array(z.string()),
  at: z.string(),
});

const TicketRecordSchema = z.object({
  schema: z.literal(1),
  repository: z.string(),
  refinement: z.object({ readyGate: ReadyGateSchema.optional() }),
  runs: z.array(RunSchema),
  events: z.array(EventSchema),
  archives: z.array(z.string()),
});

export type FactoryEvent = Readonly<z.infer<typeof EventSchema>>;
export type Run = Readonly<z.infer<typeof RunSchema>>;
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
  readonly findings: readonly string[];
  readonly at: string;
  readonly by: string;
};

export const recordReadyGate = (record: TicketRecord, { passed, findings, at, by }: ReadyGateResult): TicketRecord =>
  appendEvent(
    { ...record, refinement: { ...record.refinement, readyGate: { passed, findings: [...findings], at } } },
    { at, by, type: 'ready_gate', detail: passed ? 'passed' : 'failed' },
  );

type RunStart = {
  readonly claimant: string;
  readonly machine: string;
  readonly at: string;
  readonly attemptLimit: number;
};

export const startRun = (record: TicketRecord, { claimant, machine, at, attemptLimit }: RunStart): TicketRecord =>
  appendEvent(
    {
      ...record,
      runs: [...record.runs, { claimant, machine, startedAt: at, status: 'running', attempt: 1, attemptLimit }],
    },
    { at, by: claimant, type: 'claimed', detail: `run ${record.runs.length + 1}` },
  );

type RunEnd = { readonly status: Exclude<Run['status'], 'running'>; readonly at: string; readonly by: string };

export const endRun = (record: TicketRecord, { status, at, by }: RunEnd): TicketRecord =>
  appendEvent(
    {
      ...record,
      runs: record.runs.map((run, index) => (index === record.runs.length - 1 ? { ...run, status } : run)),
    },
    { at, by, type: 'run_ended', detail: status },
  );

const checksumOf = (text: string): string => createHash('sha256').update(text).digest('hex');

const BLOCK_PATTERN = /```factory-record sha256=([0-9a-f]{64})\n([\s\S]*?)\n```/;

export const renderComment = ({ record, summary }: { readonly record: TicketRecord; readonly summary: string }): string => {
  const json = JSON.stringify(record);
  return `${summary}\n\n\`\`\`factory-record sha256=${checksumOf(json)}\n${json}\n\`\`\`\n`;
};

export const parseComment = (comment: string): ParsedComment => {
  const match = BLOCK_PATTERN.exec(comment);
  if (match === null) return { status: 'none' };
  const [, checksum, json] = match;
  if (json === undefined || checksumOf(json) !== checksum) return { status: 'edited' };
  const parsed = TicketRecordSchema.safeParse(JSON.parse(json));
  return parsed.success ? { status: 'ok', record: parsed.data } : { status: 'invalid' };
};
