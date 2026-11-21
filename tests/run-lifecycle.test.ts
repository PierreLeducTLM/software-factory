import { describe, expect, it } from 'vitest';
import type { Worktree } from '../src/adapters/agent-runtime.js';
import { createInMemoryAgentRuntime } from '../src/adapters/in-memory-agent-runtime.js';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import type { Ticket, TicketProvider } from '../src/adapters/ticket-provider.js';
import { parseFactoryConfig, type FactoryConfig } from '../src/config/project-config.js';
import { beginStep, finishStep, nextTicket, runTicket, type FactoryDeps } from '../src/factory/run-lifecycle.js';
import { loadRecord, saveRecord } from '../src/record/record-store.js';
import { createRecord, recordApproval, recordReadyGate, renderComment, setState, type TicketRecord } from '../src/record/ticket-record.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const getConfig = (inDevelopment = 'In development'): FactoryConfig => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states:
  to_refine: To refine
  spec_review: Spec review
  ready_for_dev: Ready for Dev
  in_development: ${inDevelopment}
  in_review: In review
  blocked: Blocked
  done: Done
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks: []
risk:
  low: { merge: auto }
  medium: { merge: human }
  high: { merge: human }
  sensitive_paths: []
`);
  if (!parsed.ok) throw new Error('invalid test config');
  return parsed.value;
};

const getApprovedRecord = (): TicketRecord =>
  setState(
    recordApproval(
      recordReadyGate(createRecord({ repository: 'acme/billing-service' }), { passed: true, fingerprint: 'f1', findings: [], at: '2026-11-20T15:00:00Z', by: 'pierre' }),
      { approver: 'pierre', at: '2026-11-20T16:00:00Z', mainCommit: 'a41c9e2', fingerprint: 'f1', predictedRisk: 'low' },
    ),
    { state: 'ready_for_dev', at: '2026-11-20T16:00:00Z', by: 'pierre' },
  );

const approved = (overrides?: Partial<Ticket>): Ticket =>
  getMockTicket({ factoryComment: renderComment({ record: getApprovedRecord(), summary: 'Approved' }), ...overrides });

const getWorktree = (overrides?: Partial<Worktree>): Worktree => ({ id: 'wt-1', path: '/work/pay-142', branch: 'factory/pay-142', host: 'pierre-mbp', ...overrides });

type World = { readonly tickets: TicketProvider; readonly clock: { now: string } };

const getWorld = (seed: readonly Ticket[]): World => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  return { tickets: createInMemoryTicketProvider({ tickets: seed, now: () => clock.now }), clock };
};

const depsFor = (world: World, overrides?: Partial<FactoryDeps>): FactoryDeps => ({
  tickets: world.tickets,
  runtime: createInMemoryAgentRuntime({ worktree: getWorktree() }),
  config: getConfig(),
  user: 'pierre',
  now: () => world.clock.now,
  recordBudget: 100_000,
  ...overrides,
});

const recordOf = async (world: World, key: string): Promise<TicketRecord> => {
  const loaded = await loadRecord(world.tickets, key);
  if (loaded.status !== 'ok') throw new Error(`no record on ${key}: ${loaded.status}`);
  return loaded.record;
};

describe('starting a run on a named ticket', () => {
  it('claims the ticket, records the claim and starts at revalidation in the current worktree', async () => {
    const world = getWorld([approved()]);

    const result = await runTicket(depsFor(world), 'PAY-142');

    const record = await recordOf(world, 'PAY-142');
    expect(result).toEqual({ ok: true, action: 'started', key: 'PAY-142', run: 1, attempt: 1, step: 'revalidate' });
    expect((await world.tickets.getTicket('PAY-142'))?.status).toBe('In development');
    expect(record.state).toBe('in_development');
    expect(record.runs).toEqual([
      { claimant: 'pierre', machine: 'pierre-mbp', worktreeId: 'wt-1', startedAt: '2026-11-21T08:00:00Z', status: 'running', attempt: 1, attemptLimit: 5, steps: [] },
    ]);
    expect((await world.tickets.getFactoryComment('PAY-142'))?.startsWith('Run 1 · attempt 1 of 5 · claimed by pierre\n')).toBe(true);
  });

  it('moves the ticket to whatever the project calls In development', async () => {
    const world = getWorld([approved()]);

    await runTicket(depsFor(world, { config: getConfig('Doing') }), 'PAY-142');

    expect((await world.tickets.getTicket('PAY-142'))?.status).toBe('Doing');
  });

  it('uses the attempt limit the project configured', async () => {
    const world = getWorld([approved()]);
    const config = { ...getConfig(), limits: { attempts: 4, runs: 3 } };

    await runTicket(depsFor(world, { config }), 'PAY-142');

    expect((await recordOf(world, 'PAY-142')).runs[0]?.attemptLimit).toBe(4);
  });

  it('lets exactly one of two developers racing for a ticket claim it, and tells the other who has it', async () => {
    const world = getWorld([approved()]);
    const pierre = depsFor(world, { user: 'pierre' });
    const maya = depsFor(world, { user: 'maya', runtime: createInMemoryAgentRuntime({ worktree: getWorktree({ id: 'wt-2', host: 'maya-mbp' }) }) });

    const first = await runTicket(pierre, 'PAY-142');
    const record = await recordOf(world, 'PAY-142');
    const second = await claimFromStaleRead(world, maya);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'already_claimed', message: 'PAY-142 is already claimed by pierre' });
    expect(await recordOf(world, 'PAY-142')).toEqual(record);
  });

  it('says another developer has the ticket when the winner has not written the claim yet', async () => {
    const world = getWorld([approved({ status: 'In development' })]);

    const result = await claimFromStaleRead(world, depsFor(world));

    expect(result).toEqual({ ok: false, reason: 'already_claimed', message: 'PAY-142 is already claimed by another developer' });
  });

  it('refuses a ticket that was never approved through the factory, changing nothing', async () => {
    const world = getWorld([getMockTicket()]);

    const result = await runTicket(depsFor(world), 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'not_approved', message: 'PAY-142 was not approved through the factory' });
    expect((await world.tickets.getTicket('PAY-142'))?.status).toBe('Ready for Dev');
    expect(await world.tickets.getFactoryComment('PAY-142')).toBeUndefined();
  });

  it('refuses a ticket whose record has a ready gate but no approval stamp', async () => {
    const gated = recordReadyGate(createRecord({ repository: 'acme/billing-service' }), { passed: true, fingerprint: 'f1', findings: [], at: '2026-11-20T15:00:00Z', by: 'pierre' });
    const world = getWorld([getMockTicket({ factoryComment: renderComment({ record: gated, summary: 'Gate passed' }) })]);

    expect((await runTicket(depsFor(world), 'PAY-142')).ok).toBe(false);
    expect((await world.tickets.getTicket('PAY-142'))?.status).toBe('Ready for Dev');
  });

  it('refuses a ticket whose record was edited by hand until the developer accepts it', async () => {
    const comment = renderComment({ record: getApprovedRecord(), summary: 'Approved' }).replace('"fingerprint":"f1"', '"fingerprint":"f9"');
    const world = getWorld([getMockTicket({ factoryComment: comment })]);

    const refused = await runTicket(depsFor(world), 'PAY-142');
    const accepted = await runTicket(depsFor(world), 'PAY-142', { acceptEditedRecord: true });

    expect(refused).toEqual({ ok: false, reason: 'record_edited', message: 'The record on PAY-142 was edited outside the factory' });
    expect(accepted.ok).toBe(true);
    expect((await recordOf(world, 'PAY-142')).events.some((event) => event.type === 'edited_record_accepted' && event.by === 'pierre')).toBe(true);
  });

  it('refuses a ticket that does not exist', async () => {
    const result = await runTicket(depsFor(getWorld([])), 'PAY-999');

    expect(result).toEqual({ ok: false, reason: 'not_found', message: 'PAY-999 does not exist' });
  });

  it('refuses a ticket that is neither ready nor in development, naming its status', async () => {
    const world = getWorld([approved({ status: 'Spec review' })]);

    const result = await runTicket(depsFor(world), 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'not_ready', message: 'PAY-142 is in "Spec review", not "Ready for Dev"' });
  });

  it('refuses to run outside an Orca worktree', async () => {
    const world = getWorld([approved()]);

    const result = await runTicket(depsFor(world, { runtime: createInMemoryAgentRuntime({}) }), 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'no_worktree', message: 'Run this from inside an Orca worktree' });
    expect((await world.tickets.getTicket('PAY-142'))?.status).toBe('Ready for Dev');
  });

  it('refuses a second run in a worktree that already hosts one, and suggests a new worktree', async () => {
    const world = getWorld([approved(), approved({ key: 'ENG-87' })]);
    await runTicket(depsFor(world), 'PAY-142');

    const result = await runTicket(depsFor(world), 'ENG-87');

    expect(result).toEqual({ ok: false, reason: 'worktree_busy', message: 'This worktree is running PAY-142. Open a new worktree for ENG-87' });
    expect((await world.tickets.getTicket('ENG-87'))?.status).toBe('Ready for Dev');
  });

  it('allows a second run in another worktree, or on another machine with the same worktree id', async () => {
    const world = getWorld([approved(), approved({ key: 'ENG-87' }), approved({ key: 'ENG-90' })]);
    await runTicket(depsFor(world), 'PAY-142');

    const otherWorktree = await runTicket(depsFor(world, { runtime: createInMemoryAgentRuntime({ worktree: getWorktree({ id: 'wt-2' }) }) }), 'ENG-87');
    const otherMachine = await runTicket(depsFor(world, { runtime: createInMemoryAgentRuntime({ worktree: getWorktree({ host: 'maya-mbp' }) }) }), 'ENG-90');

    expect(otherWorktree.ok).toBe(true);
    expect(otherMachine.ok).toBe(true);
  });

  it('notes in the record when the status was changed outside the factory before the claim', async () => {
    const stale = setState(getApprovedRecord(), { state: 'spec_review', at: '2026-11-20T17:00:00Z', by: 'pierre' });
    const world = getWorld([getMockTicket({ factoryComment: renderComment({ record: stale, summary: 'Sent back' }) })]);

    await runTicket(depsFor(world), 'PAY-142');

    expect((await recordOf(world, 'PAY-142')).events).toContainEqual({
      at: '2026-11-21T08:00:00Z',
      by: 'pierre',
      type: 'status_changed_outside',
      detail: 'expected "Spec review", found "Ready for Dev"',
    });
  });

  it('adds no such note for a record that never held a factory state', async () => {
    const { state: _unused, ...stateless } = getApprovedRecord();
    const world = getWorld([getMockTicket({ factoryComment: renderComment({ record: stateless, summary: 'Approved' }) })]);

    await runTicket(depsFor(world), 'PAY-142');

    expect((await recordOf(world, 'PAY-142')).events.some((event) => event.type === 'status_changed_outside')).toBe(false);
  });

  it('is not blocked by a ticket in development that has no factory record', async () => {
    const world = getWorld([approved(), getMockTicket({ key: 'OLD-1', status: 'In development' })]);

    expect((await runTicket(depsFor(world), 'PAY-142')).ok).toBe(true);
  });

  it('says another developer has the ticket when the record cannot be read after losing the race', async () => {
    const world = getWorld([approved({ status: 'In development' })]);
    const reads = { count: 0 };
    const tickets: TicketProvider = {
      ...world.tickets,
      getTicket: async () => ({ ...approved(), status: 'Ready for Dev' }),
      getFactoryComment: async (key) => {
        reads.count += 1;
        return reads.count === 1 ? world.tickets.getFactoryComment(key) : 'no record here';
      },
    };

    const result = await runTicket(depsFor(world, { tickets }), 'PAY-142');

    expect(result).toMatchObject({ ok: false, reason: 'already_claimed', message: 'PAY-142 is already claimed by another developer' });
  });

  it('adds no such note when the status is the one the factory last set', async () => {
    const world = getWorld([approved()]);

    await runTicket(depsFor(world), 'PAY-142');

    expect((await recordOf(world, 'PAY-142')).events.some((event) => event.type === 'status_changed_outside')).toBe(false);
  });

  it('starts a second run at attempt 1 after a re-approval, keeping the first', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');
    const first = await recordOf(world, 'PAY-142');
    const sentBack = setState(
      { ...first, runs: first.runs.map((run) => ({ ...run, status: 'sent_back' as const, attempt: 3 })) },
      { state: 'ready_for_dev', at: '2026-11-22T09:00:00Z', by: 'pierre' },
    );
    await saveRecord(world.tickets, { key: 'PAY-142', record: sentBack, summary: 'Approved again', budget: 100_000 });
    await world.tickets.transition({ key: 'PAY-142', from: 'In development', to: 'Ready for Dev' });

    const result = await runTicket(depsFor(world), 'PAY-142');

    expect(result).toMatchObject({ ok: true, action: 'started', run: 2, attempt: 1 });
    expect((await recordOf(world, 'PAY-142')).runs.map((run) => [run.status, run.attempt])).toEqual([['sent_back', 3], ['running', 1]]);
  });
});

const claimFromStaleRead = async (world: World, deps: FactoryDeps) => {
  const stale: Ticket = { ...approved(), status: 'Ready for Dev' };
  const tickets: TicketProvider = { ...world.tickets, getTicket: async () => stale };
  return runTicket({ ...deps, tickets }, 'PAY-142');
};

describe('taking the next ticket', () => {
  it('claims the auto-labelled ticket that has been ready the longest', async () => {
    const world = getWorld([
      approved({ key: 'PAY-1', labels: ['factory-auto'], statusSince: '2026-11-20T12:00:00Z' }),
      approved({ key: 'PAY-2', labels: ['factory-auto'], statusSince: '2026-11-19T12:00:00Z' }),
      approved({ key: 'PAY-3', labels: [], statusSince: '2026-11-01T12:00:00Z' }),
    ]);

    const result = await nextTicket(depsFor(world));

    expect(result).toMatchObject({ ok: true, action: 'started', key: 'PAY-2' });
    expect((await world.tickets.getTicket('PAY-1'))?.status).toBe('Ready for Dev');
    expect((await world.tickets.getTicket('PAY-3'))?.status).toBe('Ready for Dev');
  });

  it('reports that nothing is eligible and changes no ticket', async () => {
    const world = getWorld([approved({ key: 'PAY-1' }), approved({ key: 'PAY-2', labels: ['factory-auto'], status: 'Blocked' })]);

    const result = await nextTicket(depsFor(world));

    expect(result).toEqual({ ok: false, reason: 'nothing_eligible', message: 'No ticket with the "factory-auto" label is in "Ready for Dev"' });
    expect((await world.tickets.search({})).map((ticket) => ticket.status)).toEqual(['Ready for Dev', 'Blocked']);
  });
});

describe('resuming a run', () => {
  it('resumes from the step and attempt in the record without starting a new run', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');
    await beginStep(depsFor(world), 'PAY-142', { name: 'build', timeoutSeconds: 1500 });
    const before = await recordOf(world, 'PAY-142');
    await saveRecord(world.tickets, {
      key: 'PAY-142',
      record: { ...before, runs: before.runs.map((run) => ({ ...run, attempt: 2 })) },
      summary: 'Building',
      budget: 100_000,
    });

    const result = await runTicket(depsFor(world), 'PAY-142');

    const after = await recordOf(world, 'PAY-142');
    expect(result).toEqual({ ok: true, action: 'resumed', key: 'PAY-142', run: 1, attempt: 2, step: 'build' });
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]?.attempt).toBe(2);
  });

  it('resumes at revalidation when the run has not started a step yet', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');

    expect(await runTicket(depsFor(world), 'PAY-142')).toMatchObject({ ok: true, action: 'resumed', step: 'revalidate' });
  });

  it('writes nothing when the same developer resumes and nothing changed', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');
    const before = await world.tickets.getFactoryComment('PAY-142');

    await runTicket(depsFor(world), 'PAY-142');

    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(before);
  });

  it('asks another developer to confirm before taking the run over, then records the takeover', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');
    const maya = depsFor(world, { user: 'maya', runtime: createInMemoryAgentRuntime({ worktree: getWorktree({ id: 'wt-9', host: 'maya-mbp' }) }) });

    const asked = await runTicket(maya, 'PAY-142');
    const untouched = await recordOf(world, 'PAY-142');
    world.clock.now = '2026-11-21T10:00:00Z';
    const confirmed = await runTicket(maya, 'PAY-142', { confirmTakeover: true });

    const record = await recordOf(world, 'PAY-142');
    expect(asked).toEqual({ ok: false, reason: 'needs_takeover_confirmation', message: 'PAY-142 is being run by pierre. Confirm to take it over' });
    expect(untouched.runs[0]?.claimant).toBe('pierre');
    expect(confirmed).toMatchObject({ ok: true, action: 'resumed', attempt: 1 });
    expect(record.runs[0]).toMatchObject({ claimant: 'maya', machine: 'maya-mbp', worktreeId: 'wt-9' });
    expect(record.events.at(-1)).toEqual({ at: '2026-11-21T10:00:00Z', by: 'maya', type: 'takeover', detail: 'from pierre' });
    expect((await world.tickets.getFactoryComment('PAY-142'))?.startsWith('Run 1 · attempt 1 of 5 · resumed by maya\n')).toBe(true);
  });

  it('refuses to resume a record edited by hand until the developer accepts it', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');
    const comment = (await world.tickets.getFactoryComment('PAY-142')) ?? '';
    await world.tickets.putFactoryComment('PAY-142', comment.replace('"attempt":1', '"attempt":4'));

    const refused = await runTicket(depsFor(world), 'PAY-142');
    const accepted = await runTicket(depsFor(world), 'PAY-142', { acceptEditedRecord: true });

    expect(refused).toMatchObject({ ok: false, reason: 'record_edited' });
    expect(accepted).toMatchObject({ ok: true, action: 'resumed', attempt: 4 });
    expect((await loadRecord(world.tickets, 'PAY-142')).status).toBe('ok');
  });

  it('refuses to resume a ticket in development that has no running run', async () => {
    const world = getWorld([approved({ status: 'In development' })]);

    const result = await runTicket(depsFor(world), 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'not_ready', message: 'PAY-142 is in "In development" but has no run to resume' });
  });

  it('notes a status changed outside the factory when resuming', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');
    const record = await recordOf(world, 'PAY-142');
    await saveRecord(world.tickets, { key: 'PAY-142', record: { ...record, state: 'in_review' }, summary: 'x', budget: 100_000 });

    await runTicket(depsFor(world), 'PAY-142');

    expect((await recordOf(world, 'PAY-142')).events.at(-1)).toMatchObject({ type: 'status_changed_outside', detail: 'expected "In review", found "In development"' });
  });
});

describe('step times', () => {
  it('writes the ticket once when a step starts and once when it ends, and not in between', async () => {
    const world = getWorld([approved()]);
    await runTicket(depsFor(world), 'PAY-142');
    const writes: string[] = [];
    const counting: TicketProvider = {
      ...world.tickets,
      putFactoryComment: async (key, body) => {
        writes.push(body.split('\n')[0] ?? '');
        await world.tickets.putFactoryComment(key, body);
      },
    };
    const deps = depsFor(world, { tickets: counting });

    await beginStep(deps, 'PAY-142', { name: 'build', timeoutSeconds: 1500 });
    world.clock.now = '2026-11-21T08:18:00Z';
    await finishStep(deps, 'PAY-142');

    expect(writes).toEqual(['Run 1 · attempt 1 of 5 · build started', 'Run 1 · attempt 1 of 5 · build ended']);
    expect((await recordOf(world, 'PAY-142')).runs[0]?.steps).toEqual([
      { name: 'build', attempt: 1, startedAt: '2026-11-21T08:00:00Z', timeoutSeconds: 1500, endedAt: '2026-11-21T08:18:00Z' },
    ]);
  });

  it('names the step that ended when an earlier one is already closed', async () => {
    const world = getWorld([approved()]);
    const deps = depsFor(world);
    await runTicket(deps, 'PAY-142');
    await beginStep(deps, 'PAY-142', { name: 'revalidate', timeoutSeconds: 120 });
    await finishStep(deps, 'PAY-142');
    await beginStep(deps, 'PAY-142', { name: 'build', timeoutSeconds: 1500 });

    await finishStep(deps, 'PAY-142');

    expect((await world.tickets.getFactoryComment('PAY-142'))?.startsWith('Run 1 · attempt 1 of 5 · build ended\n')).toBe(true);
  });

  it('refuses to end a step when none is in progress, or to start one before the ticket is claimed', async () => {
    const world = getWorld([approved()]);
    const deps = depsFor(world);

    await expect(beginStep(deps, 'PAY-142', { name: 'build', timeoutSeconds: 1500 })).rejects.toThrow('The record has no run');
    await runTicket(deps, 'PAY-142');
    await expect(finishStep(deps, 'PAY-142')).rejects.toThrow('PAY-142 has no step in progress');
  });

  it('refuses to record a step on a ticket with no readable record', async () => {
    const world = getWorld([getMockTicket()]);

    await expect(beginStep(depsFor(world), 'PAY-142', { name: 'build', timeoutSeconds: 1500 })).rejects.toThrow('PAY-142 has no factory record');
    await expect(finishStep(depsFor(world), 'PAY-142')).rejects.toThrow('PAY-142 has no factory record');
  });
});

describe('nothing running', () => {
  it('leaves a ready ticket alone when nobody runs a command, and leaves nothing running after one', async () => {
    const world = getWorld([approved({ labels: ['factory-auto'] }), approved({ key: 'ENG-90', labels: ['factory-auto'] })]);
    const deps = depsFor(world);
    const timersBefore = process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;

    await runTicket(deps, 'PAY-142');
    await beginStep(deps, 'PAY-142', { name: 'build', timeoutSeconds: 1500 });
    world.clock.now = '2026-11-28T08:00:00Z';

    expect(process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout')).toHaveLength(timersBefore);
    expect((await world.tickets.getTicket('ENG-90'))?.status).toBe('Ready for Dev');
    expect((await world.tickets.getTicket('ENG-90'))?.updatedAt).toBe('2026-11-20T10:00:00Z');
    expect((await recordOf(world, 'PAY-142')).runs[0]?.steps[0]?.endedAt).toBeUndefined();
  });
});
