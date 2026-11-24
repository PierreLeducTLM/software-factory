import { describe, expect, it } from 'vitest';
import { withRateLimitRetry, type Http } from '../src/adapters/http.js';
import { createJiraTicketProvider } from '../src/adapters/jira-ticket-provider.js';
import type { Ticket } from '../src/adapters/ticket-provider.js';
import { describeTicketProviderContract, getMockTicket } from './contracts/ticket-provider-contract.js';
import { createFakeJira } from './fakes/fake-jira.js';

const BASE_URL = 'https://acme.atlassian.net';

type FakeOptions = Omit<Parameters<typeof createFakeJira>[0], 'baseUrl' | 'tickets' | 'now'>;

const getSetup = (tickets: readonly Ticket[], options?: { readonly pageSize?: number; readonly wrap?: (http: Http) => Http; readonly fake?: FakeOptions }) => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  const jira = createFakeJira({ baseUrl: BASE_URL, tickets, now: () => clock.now, ...(options?.pageSize === undefined ? {} : { pageSize: options.pageSize }), ...options?.fake });
  const provider = createJiraTicketProvider({
    baseUrl: BASE_URL,
    email: 'factory@acme.test',
    token: 'secret-token',
    repository: 'acme/billing-service',
    filter: 'project = PAY',
    http: options?.wrap === undefined ? jira.http : options.wrap(jira.http),
    now: () => clock.now,
  });
  return { jira, provider, clock };
};

describeTicketProviderContract('Jira over a simulated Jira', (seed) => {
  const { provider, clock } = getSetup(seed);
  return {
    provider,
    advanceClock: (iso) => {
      clock.now = iso;
    },
  };
});

describe('Jira ticket provider', () => {
  it('lists the statuses of the workflow once each, with their category', async () => {
    const extraStatuses = [{ name: 'Done', statusCategory: { key: 'done' } }, { name: 'Parked' }, { name: 'Odd', statusCategory: { key: 'undefined' } }];
    const { provider } = getSetup([getMockTicket()], { fake: { extraStatuses } });

    expect(await provider.listStatuses()).toEqual([
      { name: 'To refine', category: 'todo' },
      { name: 'Spec review', category: 'todo' },
      { name: 'Ready for Dev', category: 'todo' },
      { name: 'In development', category: 'in_progress' },
      { name: 'In review', category: 'in_progress' },
      { name: 'Blocked', category: 'in_progress' },
      { name: 'Done', category: 'done' },
      { name: 'Parked', category: 'unknown' },
      { name: 'Odd', category: 'unknown' },
    ]);
  });

  it('sees that a global transition lets a claimed ticket be claimed again', async () => {
    const { provider } = getSetup([getMockTicket({ status: 'In development' }), getMockTicket({ key: 'PAY-151' })], { fake: { globalTransitionsTo: ['In development'] } });

    expect(await provider.canReenter({ key: 'PAY-142', status: 'In development' })).toBe(true);
    expect(await provider.canReenter({ key: 'PAY-151', status: 'In development' })).toBe(true);
    expect(await provider.canReenter({ key: 'PAY-151', status: 'Done' })).toBe(false);
  });

  it('sees a transition from a status to itself on a ticket in that status', async () => {
    const { provider } = getSetup([getMockTicket({ status: 'In development' })], { fake: { loopingStatuses: ['In development'] } });

    expect(await provider.canReenter({ key: 'PAY-142', status: 'In development' })).toBe(true);
  });

  it('says whether the account can comment on and transition a ticket', async () => {
    const full = getSetup([getMockTicket()]);
    const readOnly = getSetup([getMockTicket()], { fake: { permissions: { comment: true, transition: false } } });
    const silent = getSetup([getMockTicket()], { fake: { permissions: { comment: false, transition: true } } });

    expect(await full.provider.checkAccess('PAY-142')).toEqual({ comment: true, transition: true });
    expect(await readOnly.provider.checkAccess('PAY-142')).toEqual({ comment: true, transition: false });
    expect(await silent.provider.checkAccess('PAY-142')).toEqual({ comment: false, transition: true });
    await expect(full.provider.checkAccess('PAY-999')).rejects.toThrow('Jira answered 404 to GET /rest/api/2/mypermissions?issueKey=PAY-999&permissions=ADD_COMMENTS,TRANSITION_ISSUES');
  });

  it('keeps exactly one factory comment on the ticket however often it is written', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);

    await provider.putFactoryComment('PAY-142', 'first');
    await provider.putFactoryComment('PAY-142', 'second');
    await provider.putFactoryComment('PAY-142', 'third');

    expect(jira.commentsOn('PAY-142')).toEqual(['third']);
  });

  it('reads the comment itself, so a hand edit is seen by a single read and by a search', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);
    await provider.putFactoryComment('PAY-142', 'written by the factory');

    jira.editCommentByHand('PAY-142', 'edited by a person');

    expect(await provider.getFactoryComment('PAY-142')).toBe('edited by a person');
    expect((await provider.getTicket('PAY-142'))?.factoryComment).toBe('edited by a person');
    expect((await provider.search({}))[0]?.factoryComment).toBe('edited by a person');
  });

  it('authenticates every request with the account email and token', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);

    await provider.getTicket('PAY-142');

    expect(jira.requests.every((request) => request.headers['authorization'] === `Basic ${btoa('factory@acme.test:secret-token')}`)).toBe(true);
    expect(jira.requests.length).toBeGreaterThan(0);
  });

  it('finds tickets that have a description, and reads it as plain text', async () => {
    const { provider } = getSetup([getMockTicket({ spec: '## Why\nRemind patients of late doses.' })]);

    const found = await provider.search({});

    expect(found.map((ticket) => ticket.spec)).toEqual(['## Why\nRemind patients of late doses.']);
  });

  it('follows pages until every matching ticket is returned', async () => {
    const tickets = ['PAY-1', 'PAY-2', 'PAY-3', 'PAY-4', 'PAY-5'].map((key) => getMockTicket({ key }));
    const { jira, provider } = getSetup(tickets, { pageSize: 2 });

    const found = await provider.search({});

    expect(found.map((ticket) => ticket.key)).toEqual(['PAY-1', 'PAY-2', 'PAY-3', 'PAY-4', 'PAY-5']);
    expect(jira.requests.filter((request) => request.url.endsWith('/search/jql'))).toHaveLength(3);
  });

  it('scopes every search to the configured filter', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);

    await provider.search({ statuses: ['Ready for Dev'], label: 'factory-auto' });

    const sent: { jql: string } = JSON.parse(jira.requests.at(-1)?.body ?? '{}');
    expect(sent.jql).toBe('(project = PAY) AND status in ("Ready for Dev") AND labels = "factory-auto" ORDER BY key');
  });

  it('escapes quotes in a label so it cannot change the query', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);

    await provider.search({ label: 'a" OR project = HR OR labels = "b' });

    const sent: { jql: string } = JSON.parse(jira.requests.at(-1)?.body ?? '{}');
    expect(sent.jql).toBe('(project = PAY) AND labels = "a\\" OR project = HR OR labels = \\"b" ORDER BY key');
  });

  it('asks Jira only for recent changes on an incremental search, with a minute of margin', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);

    await provider.search({ updatedSince: '2026-11-21T07:57:30Z' });

    const sent: { jql: string } = JSON.parse(jira.requests.at(-1)?.body ?? '{}');
    expect(sent.jql).toBe('(project = PAY) AND updated >= "-4m" ORDER BY key');
  });

  it('has no spec on a ticket with an empty description', async () => {
    const { spec: _unused, ...withoutSpec } = getMockTicket();
    const { provider } = getSetup([withoutSpec]);

    const ticket = await provider.getTicket('PAY-142');

    expect(ticket).toBeDefined();
    expect(ticket?.spec).toBeUndefined();
  });

  it('fails clearly when the workflow has no transition to the target status', async () => {
    const { provider } = getSetup([getMockTicket()]);

    await expect(provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'Archived' })).rejects.toThrow(
      'PAY-142 has no transition from "Ready for Dev" to "Archived"',
    );
  });

  it('refuses to read an attachment link that points outside the configured Jira', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);

    await expect(provider.readAttachment('https://evil.test/rest/api/2/attachment/content/0')).rejects.toThrow(
      'Attachment link is not on https://acme.atlassian.net',
    );
    expect(jira.requests).toEqual([]);
  });

  it('fails with the status and path when Jira answers with an error', async () => {
    const failing: Http = async () => ({ status: 503, headers: {}, body: 'down' });
    const { provider } = getSetup([getMockTicket()], { wrap: () => failing });

    await expect(provider.getTicket('PAY-142')).rejects.toThrow('Jira answered 503 to GET /rest/api/2/issue/PAY-142');
  });

  it('waits and retries when Jira throttles a refresh, then returns the tickets', async () => {
    const waits: number[] = [];
    const throttleFirst = (http: Http): Http => {
      const seen = { count: 0 };
      return async (request) => {
        seen.count += 1;
        return seen.count === 1 ? { status: 429, headers: { 'retry-after': '2' }, body: '' } : http(request);
      };
    };
    const { provider } = getSetup([getMockTicket()], {
      wrap: (http) => withRateLimitRetry(throttleFirst(http), { sleep: async (ms) => void waits.push(ms), maxRetries: 3 }),
    });

    const found = await provider.search({});

    expect(found.map((ticket) => ticket.key)).toEqual(['PAY-142']);
    expect(waits).toEqual([2000]);
  });

  it('treats a 400 answer as a failure too', async () => {
    const failing: Http = async () => ({ status: 400, headers: {}, body: '' });
    const { provider } = getSetup([getMockTicket()], { wrap: () => failing });

    await expect(provider.getTicket('PAY-142')).rejects.toThrow('Jira answered 400 to GET');
    await expect(provider.putFactoryComment('PAY-142', 'x')).rejects.toThrow('Jira answered 400 to GET');
    await expect(provider.search({})).rejects.toThrow('Jira answered 400 to POST /rest/api/2/search/jql');
  });

  it('reads times that Jira reports in another time zone', async () => {
    const issue = {
      key: 'PAY-142',
      fields: {
        summary: 'Bulk invoice export',
        status: { name: 'Ready for Dev' },
        labels: [],
        description: null,
        updated: '2026-11-20T05:00:00.000-0500',
        statuscategorychangedate: '2026-11-20T11:30:00.000+0200',
      },
      properties: {},
    };
    const { provider } = getSetup([], { wrap: () => async () => ({ status: 200, headers: {}, body: JSON.stringify(issue) }) });

    const ticket = await provider.getTicket('PAY-142');

    expect(ticket?.updatedAt).toBe('2026-11-20T10:00:00Z');
    expect(ticket?.statusSince).toBe('2026-11-20T09:30:00Z');
  });

  it('fails when Jira rejects a transition and the ticket has not moved', async () => {
    const rejectTransitions = (http: Http): Http => async (request) =>
      request.method === 'POST' && request.url.endsWith('/transitions') ? { status: 500, headers: {}, body: '' } : http(request);
    const { provider } = getSetup([getMockTicket()], { wrap: rejectTransitions });

    await expect(provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' })).rejects.toThrow(
      'Jira answered 500 to POST /rest/api/2/issue/PAY-142/transitions',
    );
  });

  it.each([400, 500])('fails when Jira refuses an attachment with %i', async (status) => {
    const rejectAttachments = (http: Http): Http => async (request) =>
      request.url.endsWith('/attachments') ? { status, headers: {}, body: '' } : http(request);
    const { provider } = getSetup([getMockTicket()], { wrap: rejectAttachments });

    await expect(provider.addAttachment({ key: 'PAY-142', name: 'a.json', content: '{}' })).rejects.toThrow(
      `Jira answered ${status} to POST /rest/api/2/issue/PAY-142/attachments`,
    );
  });

  it('names the attachment file when it uploads it', async () => {
    const { jira, provider } = getSetup([getMockTicket()]);

    await provider.addAttachment({ key: 'PAY-142', name: 'factory-record-archive-1.json', content: '{}' });

    expect(jira.requests.at(-1)?.body).toContain('filename="factory-record-archive-1.json"');
  });

  it('fails the same way when Jira keeps throttling', async () => {
    const throttled: Http = async () => ({ status: 429, headers: {}, body: '' });
    const { provider } = getSetup([getMockTicket()], { wrap: () => throttled });

    await expect(provider.search({})).rejects.toThrow('Jira answered 429 to POST /rest/api/2/search/jql');
  });
});
