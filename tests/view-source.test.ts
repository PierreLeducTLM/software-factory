import { describe, expect, it } from 'vitest';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
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

const building = (startedAt: string): TicketRecord =>
  startStep(
    startRun(
      recordApproval(recordReadyGate(createRecord({ repository: 'acme/billing-service' }), { passed: true, fingerprint: 'f1', findings: [], at: '2026-11-20T15:00:00Z', by: 'pierre' }), {
        approver: 'pierre',
        at: '2026-11-20T16:00:00Z',
        mainCommit: 'a41c9e2',
        fingerprint: 'f1',
        predictedRisk: 'low',
      }),
      { claimant: 'pierre', machine: 'pierre-mbp', worktreeId: 'wt-1', at: '2026-11-21T08:00:00Z', attemptLimit: 5 },
    ),
    { name: 'build', at: startedAt, timeoutSeconds: 1500, by: 'pierre' },
  );

const withRecord = (record: TicketRecord, overrides: Partial<Ticket>): Ticket => getMockTicket({ status: 'In development', factoryComment: renderComment({ record, summary: 'x' }), ...overrides });

const getWorld = (seed: readonly Ticket[]) => {
  const clock = { now: '2026-11-21T08:10:00Z' };
  const inner = createInMemoryTicketProvider({ tickets: seed, now: () => clock.now });
  const searches = { count: 0 };
  const failing = { on: false };
  const provider: TicketProvider = {
    ...inner,
    search: async (criteria) => {
      searches.count += 1;
      if (failing.on) throw new Error('Jira is unreachable');
      return inner.search(criteria);
    },
  };
  const source = createViewSource({ providers: [{ name: 'Jira', provider }], config: getConfig(), repository: 'acme/billing-service', machine: 'pierre-mbp', now: () => clock.now });
  return { source, inner, clock, searches, failing };
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
      ['ready', ['PAY-151']],
      ['revalidate', []],
      ['build', ['PAY-142', 'ENG-95']],
      ['review', []],
      ['pr', []],
      ['needs_you', []],
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
    expect(early.columns[0]?.cards.map((card) => card.key)).toEqual(['PAY-151']);
    expect(early.loadedAt).toBe('2026-11-21T08:10:59Z');
    expect(searches.count).toBe(3);
    expect(late.columns[0]?.cards).toEqual([]);
    expect(late.refreshedAt).toBe('2026-11-21T08:11:00Z');
  });

  it('keeps the last data and says it is stale when the provider cannot be reached', async () => {
    const { source, clock, failing } = getWorld([getMockTicket({ key: 'PAY-151', status: 'Ready for Dev' })]);
    await source.load();
    failing.on = true;
    clock.now = '2026-11-21T08:12:00Z';

    const data = await source.load();

    expect(data.columns[0]?.cards.map((card) => card.key)).toEqual(['PAY-151']);
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

  it('loads the tickets before giving a detail when nothing was loaded yet', async () => {
    const { source, searches } = getWorld([withRecord(building('2026-11-21T08:05:00Z'), { key: 'PAY-142' })]);

    expect((await source.detail('PAY-142'))?.key).toBe('PAY-142');
    expect(searches.count).toBe(2);
  });
});
