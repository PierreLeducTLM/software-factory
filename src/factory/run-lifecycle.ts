import type { AgentRuntime, Worktree } from '../adapters/agent-runtime.js';
import type { Ticket, TicketProvider } from '../adapters/ticket-provider.js';
import type { FactoryConfig } from '../config/project-config.js';
import { loadRecord, saveRecord } from '../record/record-store.js';
import { appendEvent, endStep, latestRun, setState, startRun, startStep, takeOverRun, type TicketRecord } from '../record/ticket-record.js';

export type FactoryDeps = {
  readonly tickets: TicketProvider;
  readonly runtime: AgentRuntime;
  readonly config: FactoryConfig;
  readonly user: string;
  readonly now: () => string;
  readonly recordBudget: number;
};

export type RunOptions = { readonly confirmTakeover?: boolean; readonly acceptEditedRecord?: boolean };

type Refusal =
  | 'not_found'
  | 'no_worktree'
  | 'not_approved'
  | 'record_edited'
  | 'not_ready'
  | 'already_claimed'
  | 'worktree_busy'
  | 'needs_takeover_confirmation'
  | 'nothing_eligible';

export type RunResult =
  | { readonly ok: true; readonly action: 'started' | 'resumed'; readonly key: string; readonly run: number; readonly attempt: number; readonly step: string }
  | { readonly ok: false; readonly reason: Refusal; readonly message: string };

const FIRST_STEP = 'revalidate';

const refuse = (reason: Refusal, message: string): RunResult => ({ ok: false, reason, message });

const summaryOf = (record: TicketRecord, note: string): string => {
  const run = latestRun(record);
  return `Run ${record.runs.length} · attempt ${run.attempt} of ${run.attemptLimit} · ${note}`;
};

const withOutsideChangeNoted = (deps: FactoryDeps, record: TicketRecord, ticket: Ticket): TicketRecord => {
  const expected = record.state === undefined ? ticket.status : deps.config.states[record.state];
  return expected === ticket.status
    ? record
    : appendEvent(record, { at: deps.now(), by: deps.user, type: 'status_changed_outside', detail: `expected "${expected}", found "${ticket.status}"` });
};

type Loaded = { readonly ok: true; readonly record: TicketRecord; readonly unsaved: boolean } | { readonly ok: false; readonly refusal: RunResult };

const loadApproved = async (deps: FactoryDeps, key: string, options: RunOptions): Promise<Loaded> => {
  const strict = await loadRecord(deps.tickets, key);
  if (strict.status === 'edited' && options.acceptEditedRecord !== true) {
    return { ok: false, refusal: refuse('record_edited', `The record on ${key} was edited outside the factory`) };
  }
  const loaded = strict.status === 'edited' ? await loadRecord(deps.tickets, key, { trustEdited: true }) : strict;
  if (loaded.status !== 'ok' || loaded.record.refinement.approval === undefined) {
    return { ok: false, refusal: refuse('not_approved', `${key} was not approved through the factory`) };
  }
  return strict.status === 'edited'
    ? { ok: true, unsaved: true, record: appendEvent(loaded.record, { at: deps.now(), by: deps.user, type: 'edited_record_accepted' }) }
    : { ok: true, unsaved: false, record: loaded.record };
};

const runningIn = async (deps: FactoryDeps, worktree: Worktree): Promise<string | undefined> => {
  const inDevelopment = await deps.tickets.search({ statuses: [deps.config.states.in_development] });
  const records = await Promise.all(inDevelopment.map(async (ticket) => ({ key: ticket.key, loaded: await loadRecord(deps.tickets, ticket.key) })));
  return records.find(({ loaded }) => {
    const run = loaded.status === 'ok' ? loaded.record.runs.at(-1) : undefined;
    return run?.status === 'running' && run.worktreeId === worktree.id && run.machine === worktree.host;
  })?.key;
};

const claimantOf = async (deps: FactoryDeps, key: string): Promise<string> => {
  const loaded = await loadRecord(deps.tickets, key);
  const run = loaded.status === 'ok' ? loaded.record.runs.at(-1) : undefined;
  return run?.status === 'running' ? run.claimant : 'another developer';
};

const claim = async (deps: FactoryDeps, ticket: Ticket, worktree: Worktree, options: RunOptions): Promise<RunResult> => {
  const { key } = ticket;
  const loaded = await loadApproved(deps, key, options);
  if (!loaded.ok) return loaded.refusal;

  const busyWith = await runningIn(deps, worktree);
  if (busyWith !== undefined) return refuse('worktree_busy', `This worktree is running ${busyWith}. Open a new worktree for ${key}`);

  const { ready_for_dev: from, in_development: to } = deps.config.states;
  const moved = await deps.tickets.transition({ key, from, to });
  if (!moved.ok) return refuse('already_claimed', `${key} is already claimed by ${await claimantOf(deps, key)}`);

  const at = deps.now();
  const record = startRun(setState(withOutsideChangeNoted(deps, loaded.record, ticket), { state: 'in_development', at, by: deps.user }), {
    claimant: deps.user,
    machine: worktree.host,
    worktreeId: worktree.id,
    at,
    attemptLimit: deps.config.limits.attempts,
  });
  await saveRecord(deps.tickets, { key, record, summary: summaryOf(record, `claimed by ${deps.user}`), budget: deps.recordBudget });
  return { ok: true, action: 'started', key, run: record.runs.length, attempt: 1, step: FIRST_STEP };
};

const resume = async (deps: FactoryDeps, ticket: Ticket, worktree: Worktree, options: RunOptions): Promise<RunResult> => {
  const { key } = ticket;
  const loaded = await loadApproved(deps, key, options);
  if (!loaded.ok) return loaded.refusal;

  const run = loaded.record.runs.at(-1);
  if (run?.status !== 'running') return refuse('not_ready', `${key} is in "${ticket.status}" but has no run to resume`);
  if (run.claimant !== deps.user && options.confirmTakeover !== true) {
    return refuse('needs_takeover_confirmation', `${key} is being run by ${run.claimant}. Confirm to take it over`);
  }

  const noted = withOutsideChangeNoted(deps, loaded.record, ticket);
  const record =
    run.claimant === deps.user ? noted : takeOverRun(noted, { by: deps.user, machine: worktree.host, worktreeId: worktree.id, at: deps.now() });
  if (loaded.unsaved || record !== loaded.record) {
    await saveRecord(deps.tickets, { key, record, summary: summaryOf(record, `resumed by ${deps.user}`), budget: deps.recordBudget });
  }
  return { ok: true, action: 'resumed', key, run: record.runs.length, attempt: run.attempt, step: run.steps.at(-1)?.name ?? FIRST_STEP };
};

export const runTicket = async (deps: FactoryDeps, key: string, options: RunOptions = {}): Promise<RunResult> => {
  const worktree = await deps.runtime.currentWorktree();
  if (worktree === undefined) return refuse('no_worktree', 'Run this from inside an Orca worktree');

  const ticket = await deps.tickets.getTicket(key);
  if (ticket === undefined) return refuse('not_found', `${key} does not exist`);

  const { ready_for_dev: ready, in_development: inDevelopment } = deps.config.states;
  if (ticket.status === inDevelopment) return resume(deps, ticket, worktree, options);
  if (ticket.status !== ready) return refuse('not_ready', `${key} is in "${ticket.status}", not "${ready}"`);
  return claim(deps, ticket, worktree, options);
};

export const nextTicket = async (deps: FactoryDeps): Promise<RunResult> => {
  const { auto } = deps.config.labels;
  const ready = deps.config.states.ready_for_dev;
  const eligible = await deps.tickets.search({ statuses: [ready], label: auto });
  const oldest = eligible.toSorted((a, b) => Date.parse(a.statusSince) - Date.parse(b.statusSince))[0];
  return oldest === undefined ? refuse('nothing_eligible', `No ticket with the "${auto}" label is in "${ready}"`) : runTicket(deps, oldest.key);
};

const existingRecord = async (deps: FactoryDeps, key: string): Promise<TicketRecord> => {
  const loaded = await loadRecord(deps.tickets, key);
  if (loaded.status !== 'ok') throw new Error(`${key} has no factory record`);
  return loaded.record;
};

type StepRequest = { readonly name: string; readonly timeoutSeconds: number };

export const beginStep = async (deps: FactoryDeps, key: string, { name, timeoutSeconds }: StepRequest): Promise<void> => {
  const record = startStep(await existingRecord(deps, key), { name, at: deps.now(), timeoutSeconds, by: deps.user });
  await saveRecord(deps.tickets, { key, record, summary: summaryOf(record, `${name} started`), budget: deps.recordBudget });
};

export const finishStep = async (deps: FactoryDeps, key: string): Promise<void> => {
  const before = await existingRecord(deps, key);
  const open = latestRun(before).steps.find((step) => step.endedAt === undefined);
  if (open === undefined) throw new Error(`${key} has no step in progress`);
  const record = endStep(before, { at: deps.now(), by: deps.user });
  await saveRecord(deps.tickets, { key, record, summary: summaryOf(record, `${open.name} ended`), budget: deps.recordBudget });
};
