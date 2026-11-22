import { describe, expect, it } from 'vitest';
import { createLinearTicketProvider } from '../src/adapters/linear-ticket-provider.js';
import type { Ticket, TicketProvider } from '../src/adapters/ticket-provider.js';
import { describeTicketProviderContract, getMockTicket } from './contracts/ticket-provider-contract.js';
import { createFakeLinear, LINEAR_API, LINEAR_UPLOADS } from './fakes/fake-linear.js';

type FakeOptions = Omit<Parameters<typeof createFakeLinear>[0], 'tickets' | 'now'>;

const ACCOUNTS = { lin_api_factory: 'user-factory', lin_api_maya: 'user-maya' };

const getSetup = (tickets: readonly Ticket[], options?: { readonly fake?: FakeOptions; readonly project?: string; readonly token?: string }) => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  const linear = createFakeLinear({ tickets, now: () => clock.now, accounts: ACCOUNTS, ...options?.fake });
  const providerFor = (token: string) =>
    createLinearTicketProvider({
      apiUrl: LINEAR_API,
      uploadsUrl: LINEAR_UPLOADS,
      token,
      team: 'PAY',
      repository: 'acme/billing-service',
      http: linear.http,
      ...(options?.project === undefined ? {} : { project: options.project }),
    });
  return { linear, clock, provider: providerFor(options?.token ?? 'lin_api_factory'), rival: providerFor('lin_api_maya') };
};

const keysOf = (tickets: readonly Ticket[]): readonly string[] => tickets.map((ticket) => ticket.key).toSorted();

describeTicketProviderContract('Linear over a simulated Linear', (seed) => {
  const { provider, rival, clock } = getSetup(seed);
  return {
    provider,
    rival,
    advanceClock: (iso) => {
      clock.now = iso;
    },
  };
});

describe('Linear ticket provider', () => {
  it('lists the workflow states of its team once each, with their category', async () => {
    const extraStates = [
      { name: 'Triage', type: 'triage' },
      { name: 'Canceled', type: 'canceled' },
      { name: 'Odd', type: 'archived-ish' },
      { name: 'Done', type: 'completed' },
      { name: 'Elsewhere', type: 'started', team: 'OPS' },
    ];
    const { provider } = getSetup([getMockTicket()], { fake: { extraStates } });

    expect(await provider.listStatuses()).toEqual([
      { name: 'To refine', category: 'todo' },
      { name: 'Spec review', category: 'todo' },
      { name: 'Ready for Dev', category: 'todo' },
      { name: 'In development', category: 'in_progress' },
      { name: 'In review', category: 'in_progress' },
      { name: 'Blocked', category: 'in_progress' },
      { name: 'Done', category: 'done' },
      { name: 'Triage', category: 'todo' },
      { name: 'Canceled', category: 'done' },
      { name: 'Odd', category: 'unknown' },
    ]);
  });

  it('searches only its team, and only its project when one is set', async () => {
    const tickets = [getMockTicket({ key: 'PAY-1' }), getMockTicket({ key: 'PAY-2' }), getMockTicket({ key: 'OPS-3' })];
    const projects = { 'PAY-1': 'Billing service', 'PAY-2': 'Mobile app', 'OPS-3': 'Billing service' };

    expect(keysOf(await getSetup(tickets, { fake: { projects } }).provider.search({}))).toEqual(['PAY-1', 'PAY-2']);
    expect(keysOf(await getSetup(tickets, { fake: { projects }, project: 'Billing service' }).provider.search({}))).toEqual(['PAY-1']);
  });

  it('reads every page of a search', async () => {
    const tickets = ['PAY-1', 'PAY-2', 'PAY-3', 'PAY-4', 'PAY-5'].map((key) => getMockTicket({ key }));
    const { provider } = getSetup(tickets, { fake: { pageSize: 2 } });

    expect(keysOf(await provider.search({}))).toEqual(['PAY-1', 'PAY-2', 'PAY-3', 'PAY-4', 'PAY-5']);
  });

  it('lets the same account claim twice when it races itself, which only another account can stop', async () => {
    const { provider } = getSetup([getMockTicket()]);
    const claim = { key: 'PAY-142', from: 'Ready for Dev', to: 'In development' };

    const results = await Promise.all([provider.transition(claim), provider.transition(claim)]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
  });

  it('wins a claim that another account made earlier and lost', async () => {
    const { provider, rival, clock } = getSetup([getMockTicket()]);
    await rival.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' });
    clock.now = '2026-11-21T09:00:00Z';
    await rival.transition({ key: 'PAY-142', from: 'In development', to: 'Ready for Dev' });
    clock.now = '2026-11-21T10:00:00Z';

    expect(await provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' })).toEqual({ ok: true });
  });

  it('judges a claim by the latest move into the claimed status, even when the ticket moves on right after', async () => {
    const clock = { now: '2026-11-21T08:00:00Z' };
    const linear = createFakeLinear({ tickets: [getMockTicket()], now: () => clock.now, accounts: ACCOUNTS });
    const options = { apiUrl: LINEAR_API, uploadsUrl: LINEAR_UPLOADS, team: 'PAY', repository: 'acme/billing-service' };
    const rival = createLinearTicketProvider({ ...options, token: 'lin_api_maya', http: linear.http });
    const bounced = { done: false };
    const provider = createLinearTicketProvider({
      ...options,
      token: 'lin_api_factory',
      http: async (request) => {
        if (request.body?.includes('"operationName":"Claims"') === true && !bounced.done) {
          bounced.done = true;
          const moves = [['In development', 'Ready for Dev'], ['Ready for Dev', 'Blocked'], ['Blocked', 'In development']] as const;
          for (const [from, to] of moves) {
            clock.now = new Date(Date.parse(clock.now) + 60_000).toISOString();
            await rival.transition({ key: 'PAY-142', from, to });
          }
        }
        return linear.http(request);
      },
    });

    expect(await provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' })).toEqual({ ok: true });
  });

  it.each([
    ['UpdateIssue', (provider: TicketProvider) => provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' })],
    ['CreateComment', (provider: TicketProvider) => provider.putFactoryComment('PAY-142', 'first')],
    ['CreateAttachment', (provider: TicketProvider) => provider.putFactoryComment('PAY-142', 'first')],
    ['UpdateComment', async (provider: TicketProvider) => {
      await provider.putFactoryComment('PAY-142', 'first');
      await provider.putFactoryComment('PAY-142', 'second');
    }],
    ['FileUpload', (provider: TicketProvider) => provider.addAttachment({ key: 'PAY-142', name: 'tasks.md', content: 'x' })],
    ['CreateAttachment', (provider: TicketProvider) => provider.addAttachment({ key: 'PAY-142', name: 'tasks.md', content: 'x' })],
  ])('fails when Linear says %s did not succeed', async (operation, write) => {
    const { provider } = getSetup([getMockTicket()], { fake: { unsuccessful: [operation] } });

    await expect(write(provider)).rejects.toThrow();
  });

  it('dates a ticket by its latest change, whether to the issue or to the factory comment', async () => {
    const { provider, clock } = getSetup([getMockTicket()]);
    clock.now = '2026-11-21T09:00:00Z';
    await provider.putFactoryComment('PAY-142', 'record');
    clock.now = '2026-11-21T09:30:00Z';
    await provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' });

    expect((await provider.getTicket('PAY-142'))?.updatedAt).toBe('2026-11-21T09:30:00Z');
  });

  it('asks Linear only for the issues or comments changed since an incremental search', async () => {
    const { provider, linear } = getSetup([getMockTicket()]);

    await provider.search({ updatedSince: '2026-11-21T00:00:00Z' });

    const asked = linear.requests.find((request) => request.body?.includes('"operationName":"Issues"'));
    expect(asked?.body).toContain('"or":[{"updatedAt":{"gt":"2026-11-21T00:00:00Z"}},{"comments":{"some":{"updatedAt":{"gt":"2026-11-21T00:00:00Z"}}}}]');
  });

  it('leaves out of an incremental search a ticket whose only change since is a person\'s comment', async () => {
    const { provider, linear } = getSetup([getMockTicket({ key: 'PAY-1', updatedAt: '2026-11-21T00:00:00Z' }), getMockTicket({ key: 'PAY-2' })]);
    linear.comments.push({ id: 'comment-person', issueId: 'issue-1', body: 'Looks good', updatedAt: '2026-11-21T12:00:00Z' });

    expect(await provider.search({ updatedSince: '2026-11-21T00:00:00Z' })).toEqual([]);
  });

  it('refuses a status the team does not have', async () => {
    const { provider } = getSetup([getMockTicket()]);

    await expect(provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'Shipped' })).rejects.toThrow('PAY has no status "Shipped"');
  });

  it('dates the status from the issue creation when Linear has no state history for it', async () => {
    const { provider, linear } = getSetup([getMockTicket()]);
    linear.issues[0]?.spans.splice(0);

    expect((await provider.getTicket('PAY-142'))?.statusSince).toBe('2026-11-01T09:00:00Z');
  });

  it('dates the status from the open state span, whichever end of the history Linear returns it at', async () => {
    const { provider, linear } = getSetup([getMockTicket({ statusSince: '2026-11-20T10:00:00Z' })]);
    linear.issues[0]?.spans.splice(0, 1, { startedAt: '2026-11-15T10:00:00Z', endedAt: null }, { startedAt: '2026-11-10T10:00:00Z', endedAt: '2026-11-15T10:00:00Z' });

    expect((await provider.getTicket('PAY-142'))?.statusSince).toBe('2026-11-15T10:00:00Z');
  });

  it('links the factory comment from the issue so people can jump to it', async () => {
    const { provider, linear } = getSetup([getMockTicket()]);

    await provider.putFactoryComment('PAY-142', 'record');

    const linked = linear.requests.filter((request) => request.body?.includes('"operationName":"CreateAttachment"'));
    expect(linked).toHaveLength(1);
    expect(linked[0]?.body).toContain('"url":"https://linear.app/acme/issue/PAY-142#comment-');
    expect(linked[0]?.body).toContain('"title":"Factory record"');
  });

  it('sends the API key as it is, without a scheme', async () => {
    const { provider, linear } = getSetup([getMockTicket()]);

    await provider.getTicket('PAY-142');

    expect(linear.requests[0]?.headers).toMatchObject({ authorization: 'lin_api_factory', 'content-type': 'application/json' });
  });

  it('fails with Linear\'s message when Linear refuses the request', async () => {
    const { provider } = getSetup([getMockTicket()], { token: 'lin_api_revoked' });

    await expect(provider.getTicket('PAY-142')).rejects.toThrow('Linear refused Issue: Authentication required, not authenticated');
  });

  it('fails when Linear answers without data or a JSON body', async () => {
    const answers = [
      { status: 502, headers: {}, body: '<html>Bad gateway</html>' },
      { status: 200, headers: {}, body: '{"data":null}' },
    ];
    const tickets = answers.map((answer) =>
      createLinearTicketProvider({ apiUrl: LINEAR_API, uploadsUrl: LINEAR_UPLOADS, token: 't', team: 'PAY', repository: 'r', http: async () => answer }).getTicket('PAY-142'),
    );

    await expect(tickets[0]).rejects.toThrow('Linear answered 502 to Issue, not in JSON');
    await expect(tickets[1]).rejects.toThrow('Linear answered 200 to Issue');
  });

  it('fails when the file storage refuses an upload', async () => {
    const { provider } = getSetup([getMockTicket()], { fake: { uploadStatus: 400 } });

    await expect(provider.addAttachment({ key: 'PAY-142', name: 'tasks.md', content: 'x' })).rejects.toThrow('The upload of tasks.md answered 400');
  });

  it('sends the size of the content in bytes when it asks for an upload', async () => {
    const { provider, linear } = getSetup([getMockTicket()]);

    await provider.addAttachment({ key: 'PAY-142', name: 'notes.md', content: 'é' });

    const asked = linear.requests.find((request) => request.body?.includes('"operationName":"FileUpload"'));
    expect(asked?.body).toContain('"size":2');
    expect(asked?.body).toContain('"contentType":"text/markdown"');
  });

  it('fails to attach to or list the attachments of a ticket that does not exist', async () => {
    const { provider } = getSetup([]);

    await expect(provider.addAttachment({ key: 'PAY-999', name: 'tasks.md', content: 'x' })).rejects.toThrow('Ticket PAY-999 was not found');
    await expect(provider.listAttachments('PAY-999')).rejects.toThrow('Ticket PAY-999 was not found');
  });

  it('reads only attachment links on Linear\'s upload storage, and fails on a missing file', async () => {
    const { provider } = getSetup([getMockTicket()]);

    await expect(provider.readAttachment('https://evil.test/steal')).rejects.toThrow(`Attachment link is not on ${LINEAR_UPLOADS}`);
    await expect(provider.readAttachment(`${LINEAR_UPLOADS}.evil.test/x`)).rejects.toThrow(`Attachment link is not on ${LINEAR_UPLOADS}`);
    await expect(provider.readAttachment(`${LINEAR_UPLOADS}/org-1/missing/tasks.md`)).rejects.toThrow('Linear answered 404 to the attachment');
  });

  it('has no factory comment on a ticket that does not exist, and fails to write one there', async () => {
    const { provider } = getSetup([]);

    expect(await provider.getFactoryComment('PAY-999')).toBeUndefined();
    await expect(provider.putFactoryComment('PAY-999', 'x')).rejects.toThrow('Ticket PAY-999 was not found');
  });
});
