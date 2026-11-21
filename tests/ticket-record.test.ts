import { describe, expect, it } from 'vitest';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import {
  appendEvent,
  createRecord,
  endRun,
  endStep,
  recordApproval,
  recordReadyGate,
  setState,
  startRun,
  startStep,
  takeOverRun,
  type FactoryEvent,
  type TicketRecord,
} from '../src/record/ticket-record.js';
import { loadRecord, saveRecord } from '../src/record/record-store.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const getMockEvent = (overrides?: Partial<FactoryEvent>): FactoryEvent => ({
  at: '2026-11-21T09:00:00Z',
  by: 'pierre',
  type: 'transition',
  detail: 'In development to In review',
  ...overrides,
});

const getApprovedRecord = (): TicketRecord =>
  recordReadyGate(createRecord({ repository: 'acme/billing-service' }), {
    passed: true,
    findings: [],
    at: '2026-11-20T15:00:00Z',
    by: 'pierre',
  });

const getRunningRecord = (): TicketRecord =>
  startRun(getApprovedRecord(), {
    claimant: 'pierre',
    machine: 'pierre-mbp',
    worktreeId: 'wt-1',
    at: '2026-11-21T08:00:00Z',
    attemptLimit: 5,
  });

const getProvider = () =>
  createInMemoryTicketProvider({ tickets: [getMockTicket()], now: () => '2026-11-21T08:00:00Z' });

const BIG_BUDGET = 100_000;

describe('the record on a ticket', () => {
  it('is created at the first refine session with a refinement section and no runs', async () => {
    const provider = getProvider();
    const before = await loadRecord(provider, 'PAY-142');

    await saveRecord(provider, { key: 'PAY-142', record: getApprovedRecord(), summary: 'Ready gate passed', budget: BIG_BUDGET });
    const after = await loadRecord(provider, 'PAY-142');

    expect(before).toEqual({ status: 'none' });
    expect(after.status).toBe('ok');
    if (after.status !== 'ok') return;
    expect(after.record.schema).toBe(1);
    expect(after.record.repository).toBe('acme/billing-service');
    expect(after.record.runs).toEqual([]);
    expect(after.record.refinement.readyGate).toEqual({ passed: true, findings: [], at: '2026-11-20T15:00:00Z' });
  });

  it('shows people a progress summary above the machine-readable block', async () => {
    const provider = getProvider();

    await saveRecord(provider, { key: 'PAY-142', record: getApprovedRecord(), summary: 'Ready gate passed', budget: BIG_BUDGET });

    expect((await provider.getFactoryComment('PAY-142'))?.startsWith('Ready gate passed\n')).toBe(true);
  });

  it('is updated in place by later saves', async () => {
    const provider = getProvider();

    await saveRecord(provider, { key: 'PAY-142', record: getApprovedRecord(), summary: 'Ready gate passed', budget: BIG_BUDGET });
    await saveRecord(provider, { key: 'PAY-142', record: getRunningRecord(), summary: 'Building', budget: BIG_BUDGET });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record.runs).toHaveLength(1);
    expect((await provider.getFactoryComment('PAY-142'))?.startsWith('Building\n')).toBe(true);
  });

  it('records a failed ready gate with its findings and an event naming who ran it', () => {
    const record = recordReadyGate(createRecord({ repository: 'acme/billing-service' }), {
      passed: false,
      findings: ['TBD marker at tasks.md:12'],
      at: '2026-11-20T14:00:00Z',
      by: 'maya',
    });

    expect(record.refinement.readyGate).toEqual({ passed: false, findings: ['TBD marker at tasks.md:12'], at: '2026-11-20T14:00:00Z' });
    expect(record.events).toEqual([{ at: '2026-11-20T14:00:00Z', by: 'maya', type: 'ready_gate', detail: 'failed' }]);
  });

  it('records a passed ready gate as passed', () => {
    expect(getApprovedRecord().events.at(-1)?.detail).toBe('passed');
  });

  it('appends an event without touching earlier ones', () => {
    const before = getRunningRecord();

    const after = appendEvent(before, getMockEvent());

    expect(after.events.slice(0, before.events.length)).toEqual(before.events);
    expect(after.events.at(-1)).toEqual(getMockEvent());
    expect(after.events).toHaveLength(before.events.length + 1);
  });

  it('starts a run at attempt 1, claimed by a named person on a named machine', () => {
    const record = getRunningRecord();

    expect(record.runs).toEqual([
      {
        claimant: 'pierre',
        machine: 'pierre-mbp',
        worktreeId: 'wt-1',
        startedAt: '2026-11-21T08:00:00Z',
        status: 'running',
        attempt: 1,
        attemptLimit: 5,
        steps: [],
      },
    ]);
    expect(record.events.at(-1)).toEqual({ at: '2026-11-21T08:00:00Z', by: 'pierre', type: 'claimed', detail: 'run 1' });
  });

  it('keeps the first run and starts the second at attempt 1 after a send-back', () => {
    const sentBack = endRun(getRunningRecord(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' });

    const record = startRun(sentBack, { claimant: 'maya', machine: 'maya-mbp', worktreeId: 'wt-2', at: '2026-11-22T10:00:00Z', attemptLimit: 5 });

    expect(record.runs.map((run) => [run.claimant, run.status, run.attempt])).toEqual([
      ['pierre', 'sent_back', 1],
      ['maya', 'running', 1],
    ]);
    expect(record.events.at(-1)?.detail).toBe('run 2');
  });

  it('ends only the latest run and says so in an event', () => {
    const twoRuns = startRun(
      endRun(getRunningRecord(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' }),
      { claimant: 'maya', machine: 'maya-mbp', worktreeId: 'wt-2', at: '2026-11-22T10:00:00Z', attemptLimit: 5 },
    );

    const record = endRun(twoRuns, { status: 'blocked', at: '2026-11-22T11:00:00Z', by: 'maya' });

    expect(record.runs.map((run) => run.status)).toEqual(['sent_back', 'blocked']);
    expect(record.events.at(-1)).toEqual({ at: '2026-11-22T11:00:00Z', by: 'maya', type: 'run_ended', detail: 'blocked' });
  });

  it.each(['sent_back', 'blocked', 'in_review', 'merged'] as const)('keeps a run that ended as %s when saved and read back', async (status) => {
    const provider = getProvider();
    const record = endRun(getRunningRecord(), { status, at: '2026-11-21T08:40:00Z', by: 'pierre' });

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Ended', budget: BIG_BUDGET });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record.runs[0]?.status).toBe(status);
  });

  it('never changes the record it was given', () => {
    const original = getApprovedRecord();
    const snapshot = structuredClone(original);

    startRun(original, { claimant: 'pierre', machine: 'pierre-mbp', worktreeId: 'wt-1', at: '2026-11-21T08:00:00Z', attemptLimit: 5 });
    appendEvent(original, getMockEvent());

    expect(original).toEqual(snapshot);
  });
});

describe('factory state, approval and steps in the record', () => {
  it('remembers the factory state the CLI last set, with an event saying from where', () => {
    const first = setState(getApprovedRecord(), { state: 'spec_review', at: '2026-11-20T15:01:00Z', by: 'pierre' });
    const second = setState(first, { state: 'ready_for_dev', at: '2026-11-20T15:02:00Z', by: 'pierre' });

    expect(second.state).toBe('ready_for_dev');
    expect(first.events.at(-1)).toEqual({ at: '2026-11-20T15:01:00Z', by: 'pierre', type: 'state', detail: 'none to spec_review' });
    expect(second.events.at(-1)).toEqual({ at: '2026-11-20T15:02:00Z', by: 'pierre', type: 'state', detail: 'spec_review to ready_for_dev' });
  });

  it('holds the approval stamp and replaces it on a new approval', () => {
    const stamp = { approver: 'pierre', at: '2026-11-20T16:00:00Z', mainCommit: 'a41c9e2', fingerprint: 'f1', predictedRisk: 'low' as const };
    const first = recordApproval(getApprovedRecord(), stamp);

    const second = recordApproval(first, { ...stamp, at: '2026-11-22T09:00:00Z', mainCommit: 'b52d0f3', fingerprint: 'f2', mergeCeiling: 'human' });

    expect(first.refinement.approval).toEqual(stamp);
    expect(first.events.at(-1)).toEqual({ at: '2026-11-20T16:00:00Z', by: 'pierre', type: 'approved', detail: 'low risk' });
    expect(second.refinement.approval?.fingerprint).toBe('f2');
    expect(second.refinement.approval?.mergeCeiling).toBe('human');
    expect(second.refinement.readyGate).toEqual(first.refinement.readyGate);
  });

  it('writes when a step starts and when it ends, on the latest run only', () => {
    const started = startStep(getRunningRecord(), { name: 'build', at: '2026-11-21T08:05:00Z', timeoutSeconds: 1500, by: 'pierre' });

    const ended = endStep(started, { at: '2026-11-21T08:23:00Z', by: 'pierre' });

    expect(started.runs[0]?.steps).toEqual([{ name: 'build', attempt: 1, startedAt: '2026-11-21T08:05:00Z', timeoutSeconds: 1500 }]);
    expect(ended.runs[0]?.steps).toEqual([
      { name: 'build', attempt: 1, startedAt: '2026-11-21T08:05:00Z', timeoutSeconds: 1500, endedAt: '2026-11-21T08:23:00Z' },
    ]);
    expect(started.events.at(-1)).toEqual({ at: '2026-11-21T08:05:00Z', by: 'pierre', type: 'step_started', detail: 'build' });
    expect(ended.events.at(-1)).toEqual({ at: '2026-11-21T08:23:00Z', by: 'pierre', type: 'step_ended', detail: 'build' });
  });

  it('ends only the step that is still open', () => {
    const one = endStep(startStep(getRunningRecord(), { name: 'revalidate', at: '2026-11-21T08:01:00Z', timeoutSeconds: 120, by: 'pierre' }), {
      at: '2026-11-21T08:02:00Z',
      by: 'pierre',
    });
    const two = startStep(one, { name: 'build', at: '2026-11-21T08:05:00Z', timeoutSeconds: 1500, by: 'pierre' });

    const ended = endStep(two, { at: '2026-11-21T08:23:00Z', by: 'pierre' });

    expect(ended.runs[0]?.steps.map((step) => step.endedAt)).toEqual(['2026-11-21T08:02:00Z', '2026-11-21T08:23:00Z']);
  });

  it('leaves the record as it is when no step is in progress', () => {
    const record = getRunningRecord();

    expect(endStep(record, { at: '2026-11-21T08:23:00Z', by: 'pierre' })).toBe(record);
  });

  it('cannot hand over a run that does not exist', () => {
    expect(() => takeOverRun(getApprovedRecord(), { by: 'maya', machine: 'maya-mbp', worktreeId: 'wt-9', at: '2026-11-21T10:00:00Z' })).toThrow(
      'The record has no run',
    );
  });

  it.each(['low', 'medium', 'high'] as const)('keeps a %s predicted risk when saved and read back', async (predictedRisk) => {
    const provider = getProvider();
    const record = recordApproval(getApprovedRecord(), { approver: 'pierre', at: '2026-11-20T16:00:00Z', mainCommit: 'a41c9e2', fingerprint: 'f1', predictedRisk });

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Approved', budget: BIG_BUDGET });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record.refinement.approval?.predictedRisk).toBe(predictedRisk);
  });

  it('keeps a run on a later attempt when saved and read back', async () => {
    const provider = getProvider();
    const running = getRunningRecord();
    const record = { ...running, runs: running.runs.map((run) => ({ ...run, attempt: 3 })) };

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget: BIG_BUDGET });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record.runs[0]?.attempt).toBe(3);
  });

  it('hands a run to another developer and worktree, and says so in an event', () => {
    const record = takeOverRun(getRunningRecord(), { by: 'maya', machine: 'maya-mbp', worktreeId: 'wt-9', at: '2026-11-21T10:00:00Z' });

    expect(record.runs[0]?.claimant).toBe('maya');
    expect(record.runs[0]?.machine).toBe('maya-mbp');
    expect(record.runs[0]?.worktreeId).toBe('wt-9');
    expect(record.runs[0]?.attempt).toBe(1);
    expect(record.events.at(-1)).toEqual({ at: '2026-11-21T10:00:00Z', by: 'maya', type: 'takeover', detail: 'from pierre' });
  });
});

describe('record integrity', () => {
  const saveRunning = async () => {
    const provider = getProvider();
    await saveRecord(provider, { key: 'PAY-142', record: getRunningRecord(), summary: 'Building', budget: BIG_BUDGET });
    return provider;
  };

  it('flags a record whose machine block was edited by hand', async () => {
    const provider = await saveRunning();
    const comment = (await provider.getFactoryComment('PAY-142')) ?? '';

    await provider.putFactoryComment('PAY-142', comment.replace('"attempt":1', '"attempt":4'));

    expect(await loadRecord(provider, 'PAY-142')).toEqual({ status: 'edited' });
  });

  it('accepts a record when only the summary for people was edited', async () => {
    const provider = await saveRunning();
    const comment = (await provider.getFactoryComment('PAY-142')) ?? '';

    await provider.putFactoryComment('PAY-142', comment.replace('Building', 'Building (checked by Maya)'));

    expect((await loadRecord(provider, 'PAY-142')).status).toBe('ok');
  });

  it('treats a comment with no machine block as having no record', async () => {
    const provider = getProvider();
    await provider.putFactoryComment('PAY-142', 'just a note');

    expect(await loadRecord(provider, 'PAY-142')).toEqual({ status: 'none' });
  });

  it('rejects a block whose checksum matches but whose content is not a record', async () => {
    const provider = getProvider();
    const { renderComment } = await import('../src/record/ticket-record.js');
    const forged = renderComment({ record: { ...getApprovedRecord(), schema: 2 } as unknown as TicketRecord, summary: 'x' });

    await provider.putFactoryComment('PAY-142', forged);

    expect(await loadRecord(provider, 'PAY-142')).toEqual({ status: 'invalid' });
  });
});

describe('record size budget', () => {
  const withEvents = (count: number): TicketRecord =>
    Array.from({ length: count }, (_, index) => index).reduce(
      (record, index) =>
        appendEvent(record, getMockEvent({ at: `2026-11-21T09:${String(index).padStart(2, '0')}:00Z`, detail: `event ${index} ${'x'.repeat(200)}` })),
      getRunningRecord(),
    );

  it('leaves a record that fits the budget untouched and adds no attachment', async () => {
    const provider = getProvider();
    const record = withEvents(3);

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget: BIG_BUDGET });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record).toEqual(record);
    expect(loaded.status === 'ok' && loaded.record.archives).toEqual([]);
  });

  it('moves the oldest events to an attachment, links it, and keeps the newest event', async () => {
    const provider = getProvider();
    const record = withEvents(20);
    const budget = 3000;

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget });
    const loaded = await loadRecord(provider, 'PAY-142');
    const comment = (await provider.getFactoryComment('PAY-142')) ?? '';

    expect(comment.length).toBeLessThanOrEqual(budget);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.record.events.at(-1)).toEqual(record.events.at(-1));
    expect(loaded.record.archives).toHaveLength(1);
    const archived: readonly FactoryEvent[] = JSON.parse(await provider.readAttachment(loaded.record.archives[0] ?? '')).events;
    expect([...archived, ...loaded.record.events]).toEqual(record.events);
    expect(archived.length).toBeGreaterThan(0);
    expect(loaded.record.archives[0]?.endsWith('factory-record-archive-1.json')).toBe(true);
  });

  it('keeps as many events in the ticket as the budget allows', async () => {
    const provider = getProvider();
    const record = withEvents(20);
    const budget = 3000;
    const { renderComment } = await import('../src/record/ticket-record.js');

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget });
    const loaded = await loadRecord(provider, 'PAY-142');
    if (loaded.status !== 'ok') throw new Error('expected a record');
    const lastArchived = record.events.at(-loaded.record.events.length - 1);
    if (lastArchived === undefined) throw new Error('expected an archived event');
    const oneMore = { ...loaded.record, events: [lastArchived, ...loaded.record.events] };

    expect(loaded.record.events.length).toBeGreaterThan(1);
    expect(renderComment({ record: oneMore, summary: 'Building' }).length).toBeGreaterThan(budget);
  });

  it('stays within the budget whatever the budget is, once the archive link is added', async () => {
    const record = withEvents(20);
    const budgets = Array.from({ length: 300 }, (_, index) => 2800 + index);

    const sizes = await Promise.all(
      budgets.map(async (budget) => {
        const provider = getProvider();
        await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget });
        return ((await provider.getFactoryComment('PAY-142')) ?? '').length - budget;
      }),
    );

    expect(Math.max(...sizes)).toBeLessThanOrEqual(0);
  });

  it('keeps every run and the refinement section when it compacts', async () => {
    const provider = getProvider();
    const record = withEvents(20);

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget: 3000 });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record.runs).toEqual(record.runs);
    expect(loaded.status === 'ok' && loaded.record.refinement).toEqual(record.refinement);
  });

  it('moves no more events than it needs to', async () => {
    const provider = getProvider();
    const record = withEvents(20);
    const { renderComment } = await import('../src/record/ticket-record.js');
    const fullSize = renderComment({ record, summary: 'Building' }).length;

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget: fullSize });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record.events).toHaveLength(record.events.length);
  });

  it('always keeps the newest event in the ticket, even when the budget is too small for it', async () => {
    const provider = getProvider();
    const record = withEvents(5);

    await saveRecord(provider, { key: 'PAY-142', record, summary: 'Building', budget: 10 });
    const loaded = await loadRecord(provider, 'PAY-142');

    expect(loaded.status === 'ok' && loaded.record.events).toEqual([record.events.at(-1)]);
  });

  it('adds a second archive link on a later compaction instead of replacing the first', async () => {
    const provider = getProvider();
    await saveRecord(provider, { key: 'PAY-142', record: withEvents(20), summary: 'Building', budget: 3000 });
    const first = await loadRecord(provider, 'PAY-142');
    if (first.status !== 'ok') throw new Error('expected a record');
    const grown = Array.from({ length: 20 }, (_, index) => index).reduce(
      (record, index) => appendEvent(record, getMockEvent({ detail: `later ${index} ${'y'.repeat(200)}` })),
      first.record,
    );

    await saveRecord(provider, { key: 'PAY-142', record: grown, summary: 'Building', budget: 3000 });
    const second = await loadRecord(provider, 'PAY-142');

    expect(second.status === 'ok' && second.record.archives).toHaveLength(2);
    expect(second.status === 'ok' && second.record.archives[0]).toBe(first.record.archives[0]);
    expect(second.status === 'ok' && second.record.archives[1]?.endsWith('factory-record-archive-2.json')).toBe(true);
  });
});
