import { describe, expect, it } from 'vitest';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import type { Ticket, TicketProvider, TicketSearch } from '../src/adapters/ticket-provider.js';
import { createViewStore } from '../src/view/store.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const STATUSES = { to_refine: 'To refine', spec_review: 'Spec review', ready_for_dev: 'Ready for Dev', in_development: 'In development', in_review: 'In review', blocked: 'Blocked', done: 'Done' };

const getWorld = (seed: readonly Ticket[]) => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  const inner = createInMemoryTicketProvider({ tickets: seed, now: () => clock.now });
  const searches: TicketSearch[] = [];
  const calls: string[] = [];
  const failing = { on: false };
  const gone = new Set<string>();
  const spy = <A extends unknown[], R>(name: string, method: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    calls.push(name);
    return method(...args);
  };
  const provider: TicketProvider = {
    getTicket: spy('getTicket', inner.getTicket),
    transition: spy('transition', inner.transition),
    getFactoryComment: spy('getFactoryComment', inner.getFactoryComment),
    putFactoryComment: spy('putFactoryComment', inner.putFactoryComment),
    addAttachment: spy('addAttachment', inner.addAttachment),
    listAttachments: spy('listAttachments', inner.listAttachments),
    readAttachment: spy('readAttachment', inner.readAttachment),
    listStatuses: spy('listStatuses', inner.listStatuses),
    checkAccess: spy('checkAccess', inner.checkAccess),
    canReenter: spy('canReenter', inner.canReenter),
    search: async (criteria) => {
      searches.push(criteria);
      if (failing.on) throw new Error('Jira answered 503 to POST /rest/api/3/search/jql');
      return (await inner.search(criteria)).filter((ticket) => !gone.has(ticket.key));
    },
  };
  const store = createViewStore({ providers: [{ name: 'Jira', provider }], states: STATUSES, now: () => clock.now, doneWindowDays: 7 });
  return { store, inner, clock, searches, calls, failing, gone };
};

const keys = (tickets: readonly { readonly key: string }[]): readonly string[] => tickets.map((ticket) => ticket.key).toSorted();

describe('view store', () => {
  it('starts empty and never refreshed', () => {
    const { store } = getWorld([getMockTicket()]);

    expect(store.snapshot()).toEqual({ tickets: [] });
  });

  it('reads every open factory ticket, and done tickets of the last days only, on the first refresh', async () => {
    const { store, searches } = getWorld([
      getMockTicket({ key: 'A-1', status: 'Ready for Dev' }),
      getMockTicket({ key: 'A-2', status: 'Blocked' }),
      getMockTicket({ key: 'A-3', status: 'Done', updatedAt: '2026-11-20T10:00:00Z' }),
      getMockTicket({ key: 'A-4', status: 'Done', updatedAt: '2026-11-10T10:00:00Z' }),
      getMockTicket({ key: 'A-5', status: 'Archived' }),
    ]);

    await store.refresh();

    const snapshot = store.snapshot();
    expect(keys(snapshot.tickets)).toEqual(['A-1', 'A-2', 'A-3']);
    expect(snapshot.tickets.every((ticket) => ticket.provider === 'Jira')).toBe(true);
    expect(snapshot.refreshedAt).toBe('2026-11-21T08:00:00Z');
    expect('staleSince' in snapshot).toBe(false);
    expect(searches).toEqual([
      { statuses: ['To refine', 'Spec review', 'Ready for Dev', 'In development', 'In review', 'Blocked'] },
      { statuses: ['Done'], updatedSince: '2026-11-14T08:00:00Z' },
    ]);
  });

  it('asks only for tickets changed since the last refresh afterwards, and merges them in', async () => {
    const { store, inner, clock, searches } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' }), getMockTicket({ key: 'A-2', status: 'Ready for Dev' })]);
    await store.refresh();
    clock.now = '2026-11-21T08:01:00Z';
    await inner.transition({ key: 'A-2', from: 'Ready for Dev', to: 'In development' });
    clock.now = '2026-11-21T08:02:00Z';

    await store.refresh();

    const snapshot = store.snapshot();
    expect(searches.at(-1)).toEqual({ updatedSince: '2026-11-21T08:00:00Z' });
    expect(snapshot.tickets.map((ticket) => [ticket.key, ticket.status]).toSorted()).toEqual([['A-1', 'Ready for Dev'], ['A-2', 'In development']]);
    expect(snapshot.refreshedAt).toBe('2026-11-21T08:02:00Z');
  });

  it('drops a ticket that moved to a status the factory does not track', async () => {
    const { store, inner, clock } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);
    await store.refresh();
    clock.now = '2026-11-21T08:01:00Z';
    await inner.transition({ key: 'A-1', from: 'Ready for Dev', to: 'Archived' });

    await store.refresh();

    expect(store.snapshot().tickets).toEqual([]);
  });

  it('keeps the last data and says since when it is stale when the provider cannot be reached', async () => {
    const { store, clock, failing } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);
    await store.refresh();
    failing.on = true;
    clock.now = '2026-11-21T08:01:00Z';
    await store.refresh();
    clock.now = '2026-11-21T08:02:00Z';

    await store.refresh();

    expect(store.snapshot()).toMatchObject({ refreshedAt: '2026-11-21T08:00:00Z', staleSince: '2026-11-21T08:00:00Z', problem: 'Jira answered 503 to POST /rest/api/3/search/jql' });
    expect(keys(store.snapshot().tickets)).toEqual(['A-1']);
  });

  it('is fresh again, and catches up on what changed meanwhile, once the provider answers', async () => {
    const { store, inner, clock, failing, searches } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);
    await store.refresh();
    failing.on = true;
    clock.now = '2026-11-21T08:01:00Z';
    await inner.transition({ key: 'A-1', from: 'Ready for Dev', to: 'In development' });
    await store.refresh();
    failing.on = false;
    clock.now = '2026-11-21T08:02:00Z';

    await store.refresh();

    const snapshot = store.snapshot();
    expect(searches.at(-1)).toEqual({ updatedSince: '2026-11-21T08:00:00Z' });
    expect(snapshot.tickets[0]?.status).toBe('In development');
    expect(snapshot.refreshedAt).toBe('2026-11-21T08:02:00Z');
    expect('staleSince' in snapshot).toBe(false);
    expect('problem' in snapshot).toBe(false);
  });

  it('says it is stale since the first try when it has never managed to refresh', async () => {
    const { store, failing } = getWorld([]);
    failing.on = true;

    await store.refresh();

    expect(store.snapshot()).toEqual({ tickets: [], staleSince: '2026-11-21T08:00:00Z', problem: 'Jira answered 503 to POST /rest/api/3/search/jql' });
  });

  it('reports a failure that is not an error object as it is', async () => {
    const provider = { ...createInMemoryTicketProvider({ tickets: [], now: () => '2026-11-21T08:00:00Z' }), search: () => Promise.reject('network down') };
    const store = createViewStore({ providers: [{ name: 'Jira', provider }], states: STATUSES, now: () => '2026-11-21T08:00:00Z', doneWindowDays: 7 });

    await store.refresh();

    expect(store.snapshot().problem).toBe('network down');
  });

  it('only ever searches: it reads no ticket one by one and writes nothing', async () => {
    const { store, calls } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);

    await store.refresh();
    await store.refresh();

    expect(calls).toEqual([]);
  });

  it('rebuilds from the provider when started again, keeping nothing from an earlier session', async () => {
    const world = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);
    await world.store.refresh();
    const reopened = createViewStore({ providers: [{ name: 'Jira', provider: world.inner }], states: STATUSES, now: () => world.clock.now, doneWindowDays: 7 });

    expect(reopened.snapshot()).toEqual({ tickets: [] });
    await reopened.refresh();
    expect(keys(reopened.snapshot().tickets)).toEqual(['A-1']);
  });

  it('forgets what it holds and reads every tracked ticket again, as on the first load, when reloaded', async () => {
    const { store, clock, searches, gone } = getWorld([
      getMockTicket({ key: 'A-1', status: 'Ready for Dev' }),
      getMockTicket({ key: 'A-2', status: 'In development' }),
      getMockTicket({ key: 'A-3', status: 'Done', updatedAt: '2026-11-20T10:00:00Z' }),
    ]);
    await store.refresh();
    clock.now = '2026-11-21T08:00:10Z';
    gone.add('A-2');

    await store.reload();

    const snapshot = store.snapshot();
    expect(keys(snapshot.tickets)).toEqual(['A-1', 'A-3']);
    expect(snapshot.tickets.every((ticket) => ticket.provider === 'Jira')).toBe(true);
    expect(snapshot.refreshedAt).toBe('2026-11-21T08:00:10Z');
    expect(searches.slice(2)).toEqual([
      { statuses: ['To refine', 'Spec review', 'Ready for Dev', 'In development', 'In review', 'Blocked'] },
      { statuses: ['Done'], updatedSince: '2026-11-14T08:00:10Z' },
    ]);
  });

  it('is fresh again after a reload that follows a failed refresh', async () => {
    const { store, clock, failing } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);
    await store.refresh();
    failing.on = true;
    clock.now = '2026-11-21T08:01:00Z';
    await store.refresh();
    failing.on = false;
    clock.now = '2026-11-21T08:02:00Z';

    await store.reload();

    expect(store.snapshot()).toEqual({ tickets: [expect.objectContaining({ key: 'A-1' })], refreshedAt: '2026-11-21T08:02:00Z' });
  });

  it('keeps the tickets it had and says since when it is stale when a reload cannot reach the provider', async () => {
    const { store, clock, failing } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' }), getMockTicket({ key: 'A-2', status: 'Blocked' })]);
    await store.refresh();
    failing.on = true;
    clock.now = '2026-11-21T08:00:10Z';

    await store.reload();

    expect(store.snapshot()).toMatchObject({ refreshedAt: '2026-11-21T08:00:00Z', staleSince: '2026-11-21T08:00:00Z', problem: 'Jira answered 503 to POST /rest/api/3/search/jql' });
    expect(keys(store.snapshot().tickets)).toEqual(['A-1', 'A-2']);
  });

  it('reloads without reading any ticket one by one or writing anything', async () => {
    const { store, calls } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);

    await store.refresh();
    await store.reload();

    expect(calls).toEqual([]);
  });

  it('merges in several changed tickets at once without showing any of them twice', async () => {
    const { store, inner, clock } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' }), getMockTicket({ key: 'A-2', status: 'Ready for Dev' }), getMockTicket({ key: 'A-3', status: 'Ready for Dev' })]);
    await store.refresh();
    clock.now = '2026-11-21T08:01:00Z';
    await inner.transition({ key: 'A-2', from: 'Ready for Dev', to: 'In development' });
    await inner.transition({ key: 'A-3', from: 'Ready for Dev', to: 'Blocked' });

    await store.refresh();

    expect(store.snapshot().tickets.map((ticket) => [ticket.key, ticket.status]).toSorted()).toEqual([['A-1', 'Ready for Dev'], ['A-2', 'In development'], ['A-3', 'Blocked']]);
  });

  it('keeps a ticket of one provider when a ticket with the same key changes in another provider', async () => {
    const clock = { now: '2026-11-21T08:00:00Z' };
    const jira = createInMemoryTicketProvider({ tickets: [getMockTicket({ key: 'X-1', status: 'Ready for Dev' })], now: () => clock.now });
    const linear = createInMemoryTicketProvider({ tickets: [getMockTicket({ key: 'X-1', status: 'Ready for Dev' })], now: () => clock.now });
    const store = createViewStore({ providers: [{ name: 'Jira', provider: jira }, { name: 'Linear', provider: linear }], states: STATUSES, now: () => clock.now, doneWindowDays: 7 });
    await store.refresh();
    clock.now = '2026-11-21T08:01:00Z';
    await linear.transition({ key: 'X-1', from: 'Ready for Dev', to: 'Blocked' });

    await store.refresh();

    expect(store.snapshot().tickets.map((ticket) => [ticket.provider, ticket.status]).toSorted()).toEqual([['Jira', 'Ready for Dev'], ['Linear', 'Blocked']]);
  });

  it('has no refresh time when its very first read, a reload, fails', async () => {
    const { store, failing } = getWorld([getMockTicket({ key: 'A-1', status: 'Ready for Dev' })]);
    failing.on = true;

    await store.reload();

    expect('refreshedAt' in store.snapshot()).toBe(false);
    expect(store.snapshot()).toMatchObject({ tickets: [], staleSince: '2026-11-21T08:00:00Z' });
  });

  it('merges several ticket providers, naming each ticket\'s provider', async () => {
    const jira = createInMemoryTicketProvider({ tickets: [getMockTicket({ key: 'PAY-1', status: 'Ready for Dev' })], now: () => '2026-11-21T08:00:00Z' });
    const linear = createInMemoryTicketProvider({ tickets: [getMockTicket({ key: 'ENG-1', status: 'Blocked' })], now: () => '2026-11-21T08:00:00Z' });
    const store = createViewStore({ providers: [{ name: 'Jira', provider: jira }, { name: 'Linear', provider: linear }], states: STATUSES, now: () => '2026-11-21T08:00:00Z', doneWindowDays: 7 });

    await store.refresh();

    expect(store.snapshot().tickets.map((ticket) => [ticket.key, ticket.provider]).toSorted()).toEqual([['ENG-1', 'Linear'], ['PAY-1', 'Jira']]);
  });
});
