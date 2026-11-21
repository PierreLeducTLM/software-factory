import type { Ticket } from '../adapters/ticket-provider.js';
import type { FactoryConfig } from '../config/project-config.js';
import { parseComment, type Attempt, type FactoryState, type Run, type SendBackQuestion, type TicketRecord } from '../record/ticket-record.js';

export type ViewTicket = Ticket & { readonly provider: string };

export type ViewOptions = {
  readonly config: FactoryConfig;
  readonly now: string;
  readonly machine: string;
  readonly repository: string;
};

export type Chip = 'pass' | 'fail' | 'running' | 'pending';

export type AttemptRow = { readonly number: number; readonly build: Chip; readonly gate: Chip; readonly verify: Chip; readonly review: Chip };

export type ColumnId = 'ready' | 'revalidate' | 'build' | 'review' | 'pr' | 'needs_you' | 'done';

export type Card = {
  readonly key: string;
  readonly title: string;
  readonly provider: string;
  readonly note: string;
  readonly claimant?: string;
  readonly risk?: 'low' | 'medium' | 'high';
  readonly run?: { readonly number: number; readonly limit: number };
  readonly attempt?: { readonly number: number; readonly limit: number };
  readonly rows: readonly AttemptRow[];
  readonly earlierAttempts: number;
  readonly seconds?: number;
  readonly interrupted: boolean;
  readonly recordEdited: boolean;
  readonly onThisMachine: boolean;
  readonly pullRequest?: string;
  readonly command?: string;
};

export type Column = { readonly id: ColumnId; readonly name: string; readonly cards: readonly Card[] };

export type NeedsYouCategory = 'blocked' | 'run_limit' | 'interrupted' | 'record_edited' | 'sent_back' | 'merge' | 'approve' | 'not_started';

export type NeedsYouItem = {
  readonly category: NeedsYouCategory;
  readonly key: string;
  readonly title: string;
  readonly provider: string;
  readonly since: string;
  readonly why: string;
  readonly command?: string;
  readonly link?: string;
  readonly questions: readonly SendBackQuestion[];
};

export type DetailStep = { readonly label: string; readonly status: Chip; readonly lines: readonly string[]; readonly links: readonly string[] };

export type RunDetail = {
  readonly key: string;
  readonly title: string;
  readonly sections: readonly { readonly title: string; readonly steps: readonly DetailStep[] }[];
};

type Entry = {
  readonly ticket: ViewTicket;
  readonly state: FactoryState | undefined;
  readonly record: TicketRecord | undefined;
  readonly recordEdited: boolean;
  readonly run: Run | undefined;
  readonly questions: readonly SendBackQuestion[];
  readonly interrupted: boolean;
  readonly stalled: { readonly step: string; readonly startedAt: string; readonly claimant: string } | undefined;
};

const COLUMNS: readonly { readonly id: ColumnId; readonly name: string }[] = [
  { id: 'ready', name: 'Ready' },
  { id: 'revalidate', name: 'Revalidate' },
  { id: 'build', name: 'Build' },
  { id: 'review', name: 'Review' },
  { id: 'pr', name: 'Pull request' },
  { id: 'needs_you', name: 'Needs you' },
  { id: 'done', name: 'Done' },
];

const CATEGORY_ORDER: readonly NeedsYouCategory[] = ['blocked', 'run_limit', 'interrupted', 'record_edited', 'sent_back', 'merge', 'approve', 'not_started'];
const STEP_COLUMNS: Readonly<Record<string, ColumnId>> = { revalidate: 'revalidate', build: 'build', quality: 'build', verify: 'review', review: 'review', diagnose: 'build' };
const VERIFY = 'openspec-verify';
const SHOWN_ATTEMPTS = 2;
const MS_PER_HOUR = 3_600_000;

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const FACTORY_STATES: readonly FactoryState[] = ['to_refine', 'spec_review', 'ready_for_dev', 'in_development', 'in_review', 'blocked', 'done'];

const stateOf = (config: FactoryConfig, status: string): FactoryState | undefined => FACTORY_STATES.find((state) => config.states[state] === status);

const openStepOf = (run: Run | undefined) => run?.steps.find((step) => step.endedAt === undefined);

const describe = (ticket: ViewTicket, { config, now }: ViewOptions): Entry => {
  const parsed = ticket.factoryComment === undefined ? undefined : parseComment(ticket.factoryComment, { trustEdited: false });
  const record = parsed?.status === 'ok' ? parsed.record : undefined;
  const state = stateOf(config, ticket.status);
  const run = record?.runs.at(-1);
  const open = openStepOf(run);
  const deadline = open === undefined ? undefined : Date.parse(open.startedAt) + (open.timeoutSeconds + config.view.interrupted_grace_minutes * 60) * 1000;
  const overdue = state === 'in_development' && deadline !== undefined && Date.parse(now) > deadline;
  return {
    ticket,
    state,
    record,
    recordEdited: parsed?.status === 'edited' || parsed?.status === 'invalid',
    run,
    questions: record?.refinement.sendBack?.questions ?? [],
    interrupted: overdue,
    stalled: overdue && open !== undefined && run !== undefined ? { step: open.name, startedAt: open.startedAt, claimant: run.claimant } : undefined,
  };
};

const entriesFor = (tickets: readonly ViewTicket[], options: ViewOptions): readonly Entry[] =>
  tickets.map((ticket) => describe(ticket, options)).filter((entry) => entry.record === undefined || entry.record.repository === options.repository);

const columnOf = ({ state, run, record }: Entry): ColumnId | undefined => {
  if (state === 'ready_for_dev') return 'ready';
  if (state === 'in_development') return STEP_COLUMNS[openStepOf(run)?.name ?? 'revalidate'] ?? 'build';
  if (state === 'in_review') return 'pr';
  if (state === 'blocked') return 'needs_you';
  if (state === 'done') return 'done';
  return state === 'spec_review' && record?.refinement.sendBack !== undefined ? 'needs_you' : undefined;
};

const stepChip = (run: Run, attempt: number, name: string): Chip => {
  const step = run.steps.find((candidate) => candidate.attempt === attempt && candidate.name === name);
  if (step === undefined) return 'pending';
  return step.endedAt === undefined ? 'running' : 'pass';
};

const rowFor = (run: Run, number: number): AttemptRow => {
  const outcomes = run.attempts.find((attempt) => attempt.number === number)?.outcomes ?? [];
  const failed = (matches: (outcome: Attempt['outcomes'][number]) => boolean): boolean => outcomes.some((outcome) => matches(outcome) && outcome.status === 'failed');
  const verify = outcomes.find((outcome) => outcome.id === VERIFY);
  return {
    number,
    build: stepChip(run, number, 'build'),
    gate: failed((outcome) => outcome.station === 'quality') ? 'fail' : stepChip(run, number, 'quality'),
    verify: verify === undefined ? stepChip(run, number, 'verify') : verify.status === 'failed' ? 'fail' : 'pass',
    review: failed((outcome) => outcome.station === 'review' && outcome.id !== VERIFY) ? 'fail' : stepChip(run, number, 'review'),
  };
};

const rowsFor = (run: Run): readonly AttemptRow[] =>
  run.steps.some((step) => step.name === 'build') ? Array.from({ length: run.attempt }, (_, index) => rowFor(run, index + 1)) : [];

const secondsOf = (run: Run): number =>
  run.steps.reduce((total, step) => total + (step.endedAt === undefined ? 0 : Math.round((Date.parse(step.endedAt) - Date.parse(step.startedAt)) / 1000)), 0);

const mergeNote = (config: FactoryConfig, risk: 'low' | 'medium' | 'high' | undefined): string => {
  if (risk === undefined || config.risk[risk].merge === 'human') return 'Merge by a person';
  return config.risk.shadow ? 'Would have auto-merged' : 'Auto-merge is on';
};

const noteFor = (entry: Entry, column: ColumnId, config: FactoryConfig): string => {
  const { ticket, record, run } = entry;
  if (entry.interrupted) return 'Interrupted';
  if (column === 'ready') return ticket.labels.includes(config.labels.auto) ? 'Eligible for /factory-next' : 'Waiting for a developer';
  if (column === 'revalidate') return 'Checking drift';
  if (column === 'build') return 'Building';
  if (column === 'review') return 'Reviewing';
  if (column === 'pr') return mergeNote(config, record?.refinement.approval?.predictedRisk);
  if (column === 'done') return 'Merged';
  return entry.state === 'blocked' ? `Blocked · ${run?.diagnosis ?? 'no diagnosis'}` : `Sent back · ${plural(entry.questions.length, 'question')}`;
};

const commandFor = (entry: Entry, column: ColumnId, config: FactoryConfig): string | undefined => {
  const { key } = entry.ticket;
  if (column === 'ready') return entry.ticket.labels.includes(config.labels.auto) ? '/factory-next' : `/factory-run ${key}`;
  if (entry.interrupted || entry.state === 'blocked') return `/factory-run ${key}`;
  return entry.state === 'spec_review' ? `/factory-refine ${key}` : undefined;
};

const cardFor = (entry: Entry, column: ColumnId, { config, machine }: ViewOptions): Card => {
  const { ticket, record, run } = entry;
  const claimed = run !== undefined && column !== 'ready';
  const rows = claimed ? rowsFor(run) : [];
  const risk = record?.refinement.approval?.predictedRisk;
  const command = commandFor(entry, column, config);
  return {
    key: ticket.key,
    title: ticket.title,
    provider: ticket.provider,
    note: noteFor(entry, column, config),
    rows: rows.slice(-SHOWN_ATTEMPTS),
    earlierAttempts: Math.max(rows.length - SHOWN_ATTEMPTS, 0),
    interrupted: entry.interrupted,
    recordEdited: entry.recordEdited,
    onThisMachine: claimed && run.machine === machine,
    ...(claimed ? { claimant: run.claimant, attempt: { number: run.attempt, limit: run.attemptLimit }, seconds: secondsOf(run) } : {}),
    ...(record === undefined || record.runs.length === 0 ? {} : { run: { number: record.runs.length, limit: config.limits.runs } }),
    ...(risk === undefined ? {} : { risk }),
    ...(run?.pullRequest === undefined ? {} : { pullRequest: run.pullRequest.url }),
    ...(command === undefined ? {} : { command }),
  };
};

export const buildBoard = (tickets: readonly ViewTicket[], options: ViewOptions): readonly Column[] => {
  const placed = entriesFor(tickets, options).flatMap((entry) => {
    const column = columnOf(entry);
    return column === undefined ? [] : [{ column, card: cardFor(entry, column, options) }];
  });
  return COLUMNS.map(({ id, name }) => ({ id, name, cards: placed.filter(({ column }) => column === id).map(({ card }) => card) }));
};

type Reason = Omit<NeedsYouItem, 'key' | 'title' | 'provider' | 'questions'> & { readonly questions?: readonly SendBackQuestion[] };

const reasonFor = (entry: Entry, { config, now }: ViewOptions): Reason | undefined => {
  const { ticket, record, run, state } = entry;
  const { key, statusSince: since } = ticket;
  const runsUsed = record?.runs.length ?? 0;
  const { limits, labels, view } = config;

  if (entry.recordEdited) return { category: 'record_edited', since, why: 'The factory comment was edited outside the factory.', command: `/factory-run ${key}` };
  if ((state === 'blocked' || state === 'ready_for_dev') && runsUsed >= limits.runs) {
    return { category: 'run_limit', since, why: `Used ${runsUsed} of ${plural(limits.runs, 'run')}.`, command: `/factory-run ${key} --over-limit` };
  }
  if (state === 'blocked') {
    const why = run === undefined ? 'Blocked, with no factory record.' : `Failed ${run.attempt} of ${plural(run.attemptLimit, 'attempt')}. Diagnosis: ${run.diagnosis ?? 'none'}.`;
    return { category: 'blocked', since, why, command: `/factory-run ${key}`, ...(run?.report === undefined ? {} : { link: run.report }) };
  }
  if (entry.stalled !== undefined) {
    const { step, startedAt, claimant } = entry.stalled;
    return { category: 'interrupted', since: startedAt, why: `The ${step} step never ended. Claimed by ${claimant}.`, command: `/factory-run ${key}` };
  }
  if (state === 'spec_review' && record?.refinement.sendBack !== undefined) {
    const { questions } = record.refinement.sendBack;
    return { category: 'sent_back', since, why: `Sent back with ${plural(questions.length, 'question')}.`, command: `/factory-refine ${key}`, questions };
  }
  if (state === 'in_review') {
    const risk = record?.refinement.approval?.predictedRisk;
    const note = mergeNote(config, risk);
    if (note === 'Auto-merge is on') return undefined;
    return { category: 'merge', since, why: `${note}.`, ...(run?.pullRequest === undefined ? {} : { link: run.pullRequest.url }) };
  }
  if (state === 'spec_review' && record?.refinement.readyGate?.passed === true) {
    return { category: 'approve', since, why: 'The ready gate passed. Waiting for approval.', command: `/factory-refine ${key}` };
  }
  const waitedHours = (Date.parse(now) - Date.parse(since)) / MS_PER_HOUR;
  if (state === 'ready_for_dev' && !ticket.labels.includes(labels.auto) && waitedHours > view.not_started_after_hours) {
    return { category: 'not_started', since, why: `Ready for ${plural(Math.floor(waitedHours), 'hour')} with no ${labels.auto} label.`, command: `/factory-run ${key}` };
  }
  return undefined;
};

export const buildNeedsYou = (tickets: readonly ViewTicket[], options: ViewOptions): readonly NeedsYouItem[] =>
  entriesFor(tickets, options)
    .flatMap((entry) => {
      const reason = reasonFor(entry, options);
      const { key, title, provider } = entry.ticket;
      return reason === undefined ? [] : [{ key, title, provider, questions: [], ...reason }];
    })
    .toSorted((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || Date.parse(a.since) - Date.parse(b.since));

const outcomeLines = (outcomes: Attempt['outcomes']): readonly string[] =>
  outcomes.flatMap((outcome) => [
    `${outcome.id}: ${outcome.status}${outcome.reason === undefined ? '' : ` (${outcome.reason})`}`,
    ...(outcome.detail === undefined ? [] : [outcome.detail]),
  ]);

const attemptSteps = (run: Run, number: number): readonly DetailStep[] => {
  const row = rowFor(run, number);
  const attempt = run.attempts.find((candidate) => candidate.number === number);
  const of = (matches: (outcome: Attempt['outcomes'][number]) => boolean): Attempt['outcomes'] => (attempt?.outcomes ?? []).filter(matches);
  const review = of((outcome) => outcome.station === 'review' && outcome.id !== VERIFY);
  return [
    {
      label: 'Build',
      status: row.build,
      lines: attempt === undefined ? [] : [attempt.changed, ...(attempt.decisions.length === 0 ? [] : [`Decisions applied: ${attempt.decisions.join(', ')}`])],
      links: [],
    },
    { label: 'Quality gate', status: row.gate, lines: outcomeLines(of((outcome) => outcome.station === 'quality')), links: [] },
    { label: 'Verify', status: row.verify, lines: outcomeLines(of((outcome) => outcome.id === VERIFY)), links: [] },
    { label: 'Review', status: row.review, lines: outcomeLines(review), links: review.flatMap((outcome) => outcome.evidence ?? []) },
  ];
};

const outcomeSteps = (record: TicketRecord, run: Run): readonly DetailStep[] => {
  if (run.pullRequest !== undefined) {
    return [{ label: 'Pull request', status: run.status === 'merged' ? 'pass' : 'running', lines: [], links: [run.pullRequest.url] }];
  }
  if (run.status === 'blocked') {
    return [{ label: 'Failure report', status: 'fail', lines: [`Diagnosis: ${run.diagnosis ?? 'none'}`], links: run.report === undefined ? [] : [run.report] }];
  }
  if (run.status !== 'sent_back') return [];
  const questions = record.refinement.sendBack?.questions ?? [];
  return [{ label: 'Sent back', status: 'fail', lines: questions.flatMap(({ question, recommended }) => [question, `Recommended: ${recommended}`]), links: [] }];
};

export const buildRunDetail = (ticket: ViewTicket, options: ViewOptions): RunDetail | undefined => {
  const { record, run } = describe(ticket, options);
  if (record === undefined) return undefined;
  const { readyGate, approval } = record.refinement;
  const refinement: readonly DetailStep[] = [
    ...(readyGate === undefined ? [] : [{ label: 'Ready gate', status: readyGate.passed ? ('pass' as const) : ('fail' as const), lines: readyGate.findings, links: [] }]),
    ...(approval === undefined
      ? []
      : [{ label: 'Approval', status: 'pass' as const, lines: [`Approved by ${approval.approver} at ${approval.at}`, `Predicted risk: ${approval.predictedRisk}`, `Main at ${approval.mainCommit}`], links: [] }]),
  ];
  if (run === undefined) return { key: ticket.key, title: ticket.title, sections: [{ title: 'Refinement', steps: refinement }] };

  const attempts = rowsFor(run).map((row) => ({ title: `Attempt ${row.number} of ${run.attemptLimit}`, steps: attemptSteps(run, row.number) }));
  const outcome = outcomeSteps(record, run);
  return {
    key: ticket.key,
    title: ticket.title,
    sections: [
      { title: 'Refinement', steps: refinement },
      { title: `Run ${record.runs.length} of ${options.config.limits.runs}`, steps: [{ label: 'Revalidate', status: stepChip(run, 1, 'revalidate'), lines: [], links: [] }] },
      ...attempts,
      ...(outcome.length === 0 ? [] : [{ title: 'Outcome', steps: outcome }]),
    ],
  };
};
