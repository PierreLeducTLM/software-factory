import { describe, expect, it } from 'vitest';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import type { WorktreeStart } from '../src/adapters/orca-agent-runtime.js';
import type { Ticket, TicketProvider } from '../src/adapters/ticket-provider.js';
import { parseFactoryConfig } from '../src/config/project-config.js';
import { createRecord, recordApproval, recordReadyGate, renderComment, startRun, startStep, type TicketRecord } from '../src/record/ticket-record.js';
import { createViewSource } from '../src/view/source.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const getConfig = () => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks: []
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`);
  if (!parsed.ok) throw new Error('invalid test config');
  return parsed.value;
};

const building = (startedAt: string, machine = 'pierre-mbp'): TicketRecord =>
  startStep(
    startRun(
      recordApproval(recordReadyGate(createRecord({ repository: 'acme/billing-service' }), { passed: true, fingerprint: 'f1', findings: [], at: '2026-11-20T15:00:00Z', by: 'pierre' }), {
        approver: 'pierre',
        at: '2026-11-20T16:00:00Z',
        mainCommit: 'a41c9e2',
        fingerprint: 'f1',
        predictedRisk: 'low',
      }),
      { claimant: 'pierre', machine, worktreeId: 'wt-1', at: '2026-11-21T08:00:00Z', attemptLimit: 5 },
    ),
    { name: 'build', at: startedAt, timeoutSeconds: 1500, by: 'pierre' },
  );

const withRecord = (record: TicketRecord, overrides: Partial<Ticket>): Ticket => getMockTicket({ status: 'In development', factoryComment: renderComment({ record, summary: 'x' }), ...overrides });

const getWorld = (seed: readonly Ticket[], orca: { readonly down?: string; readonly created?: string } = {}, providerName = 'Jira') => {
  const opened: string[] = [];
  const started: WorktreeStart[] = [];
  const clock = { now: '2026-11-21T08:10:00Z' };
  const inner = createInMemoryTicketProvider({ tickets: seed, now: () => clock.now });
  const searches = { count: 0 };
  const failing = { on: false };
  const gone = new Set<string>();
  const provider: TicketProvider = {
    ...inner,
    search: async (criteria) => {
      searches.count += 1;
      if (failing.on) throw new Error('Jira is unreachable');
      return (await inner.search(criteria)).filter((ticket) => !gone.has(ticket.key));
    },
  };
  const source = createViewSource({
    providers: [{ name: providerName, provider }],
    config: getConfig(),
    repository: 'acme/billing-service',
    machine: 'pierre-mbp',
    now: () => clock.now,
    openWorktree: async (worktreeId) => {
      if (orca.down !== undefined) throw new Error(orca.down);
      opened.push(worktreeId);
    },
    startWorktree: async (start) => {
      if (orca.down !== undefined) throw new Error(orca.down);
      started.push(start);
      return orca.created ?? start.name;
    },
  });
  return { source, inner, clock, searches, failing, opened, started, gone };
};

describe('view source', () => {
  it('loads the board and the needs-you list with how fresh they are', async () => {
    const { source } = getWorld([
      withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142' }),
      withRecord(building('2026-11-21T07:00:00Z'), { key: 'ENG-95' }),
      getMockTicket({ key: 'PAY-151', status: 'Ready for Dev', statusSince: '2026-11-19T08:00:00Z' }),
    ]);

    const data = await source.load();

    expect(data.repository).toBe('acme/billing-service');
    expect(data.providers).toEqual(['Jira']);
    expect(data.columns.map((column) => [column.id, column.cards.map((card) => card.key)])).toEqual([
      ['available', []],
      ['refining', []],
      ['ready', ['PAY-151']],
      ['revalidate', []],
      ['build', ['PAY-142', 'ENG-95']],
      ['review', []],
      ['pr', []],
      ['needs_you', ['ENG-95', 'PAY-151']],
      ['done', []],
    ]);
    expect(data.needsYou.map((item) => [item.category, item.key])).toEqual([['interrupted', 'ENG-95'], ['not_started', 'PAY-151']]);
    expect(data.running).toBe(1);
    expect(data.pollSeconds).toBe(60);
    expect(data.loadedAt).toBe('2026-11-21T08:10:00Z');
    expect(data.refreshedAt).toBe('2026-11-21T08:10:00Z');
    expect('staleSince' in data).toBe(false);
    expect('problem' in data).toBe(false);
  });

  it('marks a run as on this machine by the machine it was given', async () => {
    const { source } = getWorld([withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142' })]);

    expect((await source.load()).columns.find((column) => column.id === 'build')?.cards[0]?.onThisMachine).toBe(true);
  });

  it('asks the provider again only once the poll interval has passed', async () => {
    const { source, inner, clock, searches } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);
    await source.load();
    const afterFirst = searches.count;
    clock.now = '2026-11-21T08:10:59Z';
    await inner.transition({ key: 'PAY-151', from: 'Ready for Dev', to: 'Blocked' });
    const early = await source.load();
    clock.now = '2026-11-21T08:11:00Z';

    const late = await source.load();

    expect(afterFirst).toBe(2);
    expect(early.columns.find((column) => column.id === 'ready')?.cards.map((card) => card.key)).toEqual(['PAY-151']);
    expect(early.loadedAt).toBe('2026-11-21T08:10:59Z');
    expect(searches.count).toBe(3);
    expect(late.columns.find((column) => column.id === 'ready')?.cards).toEqual([]);
    expect(late.refreshedAt).toBe('2026-11-21T08:11:00Z');
  });

  it('reads every ticket again when forced, within the poll interval, and the board shows only what that read returned', async () => {
    const waiting = { status: 'Ready for Dev', statusSince: '2026-11-19T08:00:00Z' };
    const { source, clock, searches, gone } = getWorld([getMockTicket({ key: 'PAY-151', ...waiting }), getMockTicket({ key: 'PAY-152', ...waiting })]);
    expect((await source.load()).needsYou.map((item) => item.key)).toEqual(['PAY-151', 'PAY-152']);
    clock.now = '2026-11-21T08:10:10Z';
    gone.add('PAY-152');

    const forced = await source.reload();

    expect(searches.count).toBe(4);
    expect(forced.columns.find((column) => column.id === 'ready')?.cards.map((card) => card.key)).toEqual(['PAY-151']);
    expect(forced.needsYou.map((item) => item.key)).toEqual(['PAY-151']);
    expect(forced.refreshedAt).toBe('2026-11-21T08:10:10Z');
    expect(forced.loadedAt).toBe('2026-11-21T08:10:10Z');
  });

  it('waits the whole poll interval after a forced reload before asking the provider again', async () => {
    const { source, clock, searches } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);
    await source.load();
    clock.now = '2026-11-21T08:10:30Z';
    await source.reload();
    clock.now = '2026-11-21T08:11:29Z';

    const early = await source.load();
    clock.now = '2026-11-21T08:11:30Z';
    await source.load();

    expect(early.refreshedAt).toBe('2026-11-21T08:10:30Z');
    expect(searches.count).toBe(5);
  });

  it('keeps the board it had and says it is stale when a forced reload cannot reach the provider', async () => {
    const { source, clock, failing } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);
    await source.load();
    failing.on = true;
    clock.now = '2026-11-21T08:10:10Z';

    const data = await source.reload();

    expect(data.columns.find((column) => column.id === 'ready')?.cards.map((card) => card.key)).toEqual(['PAY-151']);
    expect(data).toMatchObject({ refreshedAt: '2026-11-21T08:10:00Z', staleSince: '2026-11-21T08:10:00Z', problem: 'Jira is unreachable' });
  });

  it('keeps the last data and says it is stale when the provider cannot be reached', async () => {
    const { source, clock, failing } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);
    await source.load();
    failing.on = true;
    clock.now = '2026-11-21T08:12:00Z';

    const data = await source.load();

    expect(data.columns.find((column) => column.id === 'ready')?.cards.map((card) => card.key)).toEqual(['PAY-151']);
    expect(data).toMatchObject({ refreshedAt: '2026-11-21T08:10:00Z', staleSince: '2026-11-21T08:10:00Z', problem: 'Jira is unreachable' });
  });

  it('shows an empty, stale board when the provider has never answered', async () => {
    const { source, failing } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);
    failing.on = true;

    const data = await source.load();

    expect(data.columns.flatMap((column) => column.cards)).toEqual([]);
    expect(data).toMatchObject({ staleSince: '2026-11-21T08:10:00Z', problem: 'Jira is unreachable' });
    expect('refreshedAt' in data).toBe(false);
  });

  it('gives the detail of one run, and nothing for a ticket it does not hold', async () => {
    const { source } = getWorld([withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142' })]);

    const detail = await source.detail('PAY-142');

    expect(detail?.sections.map((section) => section.title)).toEqual(['Refinement', 'Run 1 of 3', 'Attempt 1 of 5']);
    expect(await source.detail('PAY-999')).toBeUndefined();
  });

  it('computes health from the tickets updated in the period it is asked for, read from the provider each time', async () => {
    const merged = (at: string): TicketRecord => {
      const record = building('2026-11-21T08:05:00Z');
      return { ...record, runs: record.runs.map((run) => ({ ...run, status: 'merged' as const, merge: { route: 'human' as const, wouldAutoMerge: true, reason: 'x', at, by: 'sam', asIs: true } })) };
    };
    const { source, searches } = getWorld([
      withRecord(merged('2026-11-20T10:00:00Z'), { key: 'PAY-1', status: 'Done', updatedAt: '2026-11-20T10:00:00Z' }),
      withRecord(merged('2026-11-01T10:00:00Z'), { key: 'PAY-2', status: 'Done', updatedAt: '2026-11-01T10:00:00Z' }),
      withRecord(merged('2026-11-14T08:10:01Z'), { key: 'PAY-3', status: 'Done', updatedAt: '2026-11-14T08:10:01Z' }),
    ]);

    const week = await source.health(7);
    const month = await source.health(30);

    expect(week).toMatchObject({ periodDays: 7, providers: [{ provider: 'Jira', merged: 2 }] });
    expect(month).toMatchObject({ periodDays: 30, providers: [{ provider: 'Jira', merged: 3 }] });
    expect(searches.count).toBe(2);
  });

  it('opens the recorded Orca worktree of a run on this machine', async () => {
    const { source, opened } = getWorld([withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142' })]);

    expect(await source.openInOrca('PAY-142')).toEqual({ ok: true });
    expect(opened).toEqual(['wt-1']);
  });

  it('opens nothing for a run on another machine, a ticket with no run, or one it does not hold', async () => {
    const { source, opened } = getWorld([withRecord(building('2026-11-21T08:05:00Z', 'anna-mbp'), { key: 'PAY-142' }), getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);

    const answers = await Promise.all(['PAY-142', 'PAY-151', 'PAY-999'].map((key) => source.openInOrca(key)));

    expect(answers).toEqual([
      { ok: false, message: 'PAY-142 has no run on this machine.' },
      { ok: false, message: 'PAY-151 has no run on this machine.' },
      { ok: false, message: 'PAY-999 has no run on this machine.' },
    ]);
    expect(opened).toEqual([]);
  });

  it('opens nothing from a record edited by hand, which could name any worktree', async () => {
    const comment = renderComment({ record: building('2026-11-21T08:05:00Z'), summary: 'x' }).replace('"wt-1"', '"wt-other"');
    const { source, opened } = getWorld([withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142', factoryComment: comment })]);

    expect(await source.openInOrca('PAY-142')).toEqual({ ok: false, message: 'PAY-142 has no run on this machine.' });
    expect(opened).toEqual([]);
  });

  it('says why Orca could not open the run', async () => {
    const { source } = getWorld([withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142' })], { down: 'Orca is not running' });

    expect(await source.openInOrca('PAY-142')).toEqual({ ok: false, message: 'Orca could not open the run: Orca is not running' });
  });

  it('starts a card\'s command in a new Orca worktree named after the key and linked to the Jira ticket', async () => {
    const { source, started } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);

    expect(await source.startInOrca({ key: 'PAY-151', command: '/factory-run PAY-151' })).toEqual({ ok: true, worktree: 'pay-151' });
    expect(started).toEqual([{ name: 'pay-151', prompt: '/factory-run PAY-151', ticket: { key: 'PAY-151', tracker: 'jira' } }]);
  });

  it('links a Linear ticket as a Linear issue and reports the worktree Orca created', async () => {
    const { source, started } = getWorld([getMockTicket({ key: 'PIE-21', status: 'To refine', labels: ['factory-available'] })], { created: 'pie-21-2' }, 'Linear');

    expect(await source.startInOrca({ key: 'PIE-21', command: '/factory-refine PIE-21' })).toEqual({ ok: true, worktree: 'pie-21-2' });
    expect(started).toEqual([{ name: 'pie-21', prompt: '/factory-refine PIE-21', ticket: { key: 'PIE-21', tracker: 'linear' } }]);
  });

  it('starts the clicked ticket, not the next one, from a card that shows /factory-next', async () => {
    const { source, started } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev', labels: ['factory-auto'] })]);

    expect(await source.startInOrca({ key: 'PAY-151', command: '/factory-next' })).toEqual({ ok: true, worktree: 'pay-151' });
    expect(started.map(({ prompt }) => prompt)).toEqual(['/factory-run PAY-151']);
  });

  it('starts an interrupted run claimed on another machine, as a takeover here', async () => {
    const { source, started } = getWorld([withRecord(building('2026-11-21T07:00:00Z', 'anna-mbp'), { key: 'ENG-95' })]);

    expect(await source.startInOrca({ key: 'ENG-95', command: '/factory-run ENG-95' })).toEqual({ ok: true, worktree: 'eng-95' });
    expect(started.map(({ prompt }) => prompt)).toEqual(['/factory-run ENG-95']);
  });

  it('says why Orca could not start the worktree', async () => {
    const { source } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })], { down: 'Orca is not running' });

    expect(await source.startInOrca({ key: 'PAY-151', command: '/factory-run PAY-151' })).toEqual({ ok: false, message: 'Orca could not start PAY-151: Orca is not running' });
  });

  it('starts nothing for a card with no command, a run on this machine, or a ticket it does not hold', async () => {
    const { source, started } = getWorld([
      withRecord(building('2026-11-21T08:05:00Z', 'anna-mbp'), { key: 'PAY-142' }),
      withRecord(building('2026-11-21T07:00:00Z'), { key: 'ENG-95' }),
      getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' }),
    ]);

    const noCommand = await source.startInOrca({ key: 'PAY-142', command: '/factory-run PAY-142' });
    const onThisMachine = await source.startInOrca({ key: 'ENG-95', command: '/factory-run ENG-95' });
    const unknown = await source.startInOrca({ key: 'PAY-999', command: '/factory-run PAY-999' });

    expect([noCommand, onThisMachine, unknown]).toEqual([
      { ok: false, message: 'Orca could not start PAY-142: PAY-142 has nothing to start in a new worktree.' },
      { ok: false, message: 'Orca could not start ENG-95: ENG-95 has nothing to start in a new worktree.' },
      { ok: false, message: 'Orca could not start PAY-999: PAY-999 has nothing to start in a new worktree.' },
    ]);
    expect(started).toEqual([]);
  });

  it('starts nothing when the card\'s command changed since the panel showed it', async () => {
    const { source, started } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' }), getMockTicket({ key: 'PAY-152', status: 'Ready for Dev', labels: ['factory-auto'] })]);

    const refine = await source.startInOrca({ key: 'PAY-151', command: '/factory-refine PAY-151' });
    const run = await source.startInOrca({ key: 'PAY-152', command: '/factory-run PAY-152' });

    expect([refine, run]).toEqual([
      { ok: false, message: 'Orca could not start PAY-151: PAY-151 changed since this panel opened. Reopen it to see what to run.' },
      { ok: false, message: 'Orca could not start PAY-152: PAY-152 changed since this panel opened. Reopen it to see what to run.' },
    ]);
    expect(started).toEqual([]);
  });

  it('starts the command of whichever card the panel showed when the ticket is on two cards', async () => {
    const record = building('2026-11-21T08:05:00Z', 'anna-mbp');
    const spent = { ...record, runs: [...record.runs, ...record.runs, ...record.runs] };
    const { source, started } = getWorld([withRecord(spent, { key: 'PAY-151', status: 'Ready for Dev' })]);

    const ready = await source.startInOrca({ key: 'PAY-151', command: '/factory-run PAY-151' });
    const overLimit = await source.startInOrca({ key: 'PAY-151', command: '/factory-run PAY-151 --over-limit' });

    expect([ready, overLimit]).toEqual([{ ok: true, worktree: 'pay-151' }, { ok: true, worktree: 'pay-151' }]);
    expect(started.map(({ prompt }) => prompt)).toEqual(['/factory-run PAY-151', '/factory-run PAY-151 --over-limit']);
  });

  it('loads the tickets before giving a detail when nothing was loaded yet', async () => {
    const { source, searches } = getWorld([withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142' })]);

    expect((await source.detail('PAY-142'))?.key).toBe('PAY-142');
    expect(searches.count).toBe(2);
  });
});
