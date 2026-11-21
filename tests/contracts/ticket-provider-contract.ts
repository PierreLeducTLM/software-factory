import { describe, expect, it } from 'vitest';
import type { Ticket, TicketProvider } from '../../src/adapters/ticket-provider.js';

export type ContractSetup = {
  readonly provider: TicketProvider;
  readonly advanceClock: (iso: string) => void;
};

export const getMockTicket = (overrides?: Partial<Ticket>): Ticket => ({
  key: 'PAY-142',
  title: 'Bulk invoice export',
  status: 'Ready for Dev',
  labels: [],
  repository: 'acme/billing-service',
  spec: '## Why\nExport invoices in bulk.',
  updatedAt: '2026-11-20T10:00:00Z',
  statusSince: '2026-11-20T10:00:00Z',
  ...overrides,
});

const keysOf = (tickets: readonly Ticket[]): readonly string[] => tickets.map((ticket) => ticket.key).toSorted();

export const describeTicketProviderContract = (
  name: string,
  setup: (seed: readonly Ticket[]) => ContractSetup,
): void => {
  describe(`ticket provider contract: ${name}`, () => {
    it('reads a ticket with its spec and labels', async () => {
      const { provider } = setup([getMockTicket({ labels: ['factory-auto'] })]);

      const ticket = await provider.getTicket('PAY-142');

      expect(ticket?.spec).toContain('Export invoices in bulk');
      expect(ticket?.labels).toEqual(['factory-auto']);
      expect(ticket?.repository).toBe('acme/billing-service');
    });

    it('reads the ticket asked for when several exist', async () => {
      const { provider } = setup([getMockTicket({ key: 'PAY-1', title: 'First' }), getMockTicket({ key: 'PAY-2', title: 'Second' })]);

      expect((await provider.getTicket('PAY-2'))?.title).toBe('Second');
    });

    it('returns nothing for a ticket that does not exist', async () => {
      const { provider } = setup([]);

      expect(await provider.getTicket('PAY-999')).toBeUndefined();
    });

    it('moves a ticket to a new status and records when it changed', async () => {
      const { provider, advanceClock } = setup([getMockTicket()]);
      advanceClock('2026-11-21T09:00:00Z');

      const result = await provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' });

      const ticket = await provider.getTicket('PAY-142');
      expect(result).toEqual({ ok: true });
      expect(ticket?.status).toBe('In development');
      expect(ticket?.statusSince).toBe('2026-11-21T09:00:00Z');
      expect(ticket?.updatedAt).toBe('2026-11-21T09:00:00Z');
    });

    it('refuses a transition when the ticket has already left the expected status', async () => {
      const { provider } = setup([getMockTicket({ status: 'In development' })]);

      const result = await provider.transition({ key: 'PAY-142', from: 'Ready for Dev', to: 'In development' });

      expect(result).toEqual({ ok: false, reason: 'not_in_expected_status', actual: 'In development' });
    });

    it('lets exactly one of two racing claims succeed', async () => {
      const { provider } = setup([getMockTicket()]);
      const claim = { key: 'PAY-142', from: 'Ready for Dev', to: 'In development' };

      const results = await Promise.all([provider.transition(claim), provider.transition(claim)]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
    });

    it('refuses a transition on a ticket that does not exist', async () => {
      const { provider } = setup([]);

      const result = await provider.transition({ key: 'PAY-999', from: 'Ready for Dev', to: 'In development' });

      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    it('has no factory comment on a ticket the factory never touched', async () => {
      const { provider } = setup([getMockTicket()]);

      expect(await provider.getFactoryComment('PAY-142')).toBeUndefined();
    });

    it('creates the factory comment, then edits it in place', async () => {
      const { provider, advanceClock } = setup([getMockTicket()]);

      await provider.putFactoryComment('PAY-142', 'first');
      advanceClock('2026-11-21T09:30:00Z');
      await provider.putFactoryComment('PAY-142', 'second');

      const ticket = await provider.getTicket('PAY-142');
      expect(await provider.getFactoryComment('PAY-142')).toBe('second');
      expect(ticket?.factoryComment).toBe('second');
      expect(ticket?.updatedAt).toBe('2026-11-21T09:30:00Z');
    });

    it('stores an attachment and returns a link that reads it back', async () => {
      const { provider } = setup([getMockTicket()]);

      const link = await provider.addAttachment({ key: 'PAY-142', name: 'archive-1.json', content: '{"a":1}' });

      expect(await provider.readAttachment(link)).toBe('{"a":1}');
    });

    it('keeps two attachments with the same name apart', async () => {
      const { provider } = setup([getMockTicket()]);

      const first = await provider.addAttachment({ key: 'PAY-142', name: 'log.txt', content: 'one' });
      const second = await provider.addAttachment({ key: 'PAY-142', name: 'log.txt', content: 'two' });

      expect(await provider.readAttachment(first)).toBe('one');
      expect(await provider.readAttachment(second)).toBe('two');
    });

    it('lists a ticket\'s attachments by name, oldest first, with links that read them back', async () => {
      const { provider } = setup([getMockTicket(), getMockTicket({ key: 'PAY-2' })]);
      await provider.addAttachment({ key: 'PAY-142', name: 'proposal.md', content: 'first' });
      await provider.addAttachment({ key: 'PAY-2', name: 'other.md', content: 'elsewhere' });
      await provider.addAttachment({ key: 'PAY-142', name: 'tasks.md', content: 'second' });

      const attachments = await provider.listAttachments('PAY-142');

      expect(attachments.map((attachment) => attachment.name)).toEqual(['proposal.md', 'tasks.md']);
      expect(await Promise.all(attachments.map((attachment) => provider.readAttachment(attachment.link)))).toEqual(['first', 'second']);
    });

    it('lists no attachments on a ticket that has none', async () => {
      const { provider } = setup([getMockTicket()]);

      expect(await provider.listAttachments('PAY-142')).toEqual([]);
    });

    it('searches by status, returning each ticket with its factory comment', async () => {
      const { provider } = setup([
        getMockTicket({ key: 'PAY-1', status: 'Ready for Dev' }),
        getMockTicket({ key: 'PAY-2', status: 'Blocked' }),
        getMockTicket({ key: 'PAY-3', status: 'Done' }),
      ]);
      await provider.putFactoryComment('PAY-2', 'record of PAY-2');

      const found = await provider.search({ statuses: ['Ready for Dev', 'Blocked'] });

      expect(keysOf(found)).toEqual(['PAY-1', 'PAY-2']);
      expect(found.find((ticket) => ticket.key === 'PAY-2')?.factoryComment).toBe('record of PAY-2');
    });

    it('searches by label', async () => {
      const { provider } = setup([
        getMockTicket({ key: 'PAY-1', labels: ['factory-auto', 'billing'] }),
        getMockTicket({ key: 'PAY-2', labels: ['billing'] }),
      ]);

      expect(keysOf(await provider.search({ label: 'factory-auto' }))).toEqual(['PAY-1']);
    });

    it('returns only tickets changed after the given time, not at it', async () => {
      const { provider } = setup([
        getMockTicket({ key: 'PAY-1', updatedAt: '2026-11-20T10:00:00Z' }),
        getMockTicket({ key: 'PAY-2', updatedAt: '2026-11-20T10:00:01Z' }),
        getMockTicket({ key: 'PAY-3', updatedAt: '2026-11-20T09:59:59Z' }),
      ]);

      const found = await provider.search({ updatedSince: '2026-11-20T10:00:00Z' });

      expect(keysOf(found)).toEqual(['PAY-2']);
    });

    it('combines criteria, and returns every ticket when none is given', async () => {
      const { provider } = setup([
        getMockTicket({ key: 'PAY-1', status: 'Ready for Dev', labels: ['factory-auto'] }),
        getMockTicket({ key: 'PAY-2', status: 'Ready for Dev' }),
        getMockTicket({ key: 'PAY-3', status: 'Blocked', labels: ['factory-auto'] }),
      ]);

      expect(keysOf(await provider.search({ statuses: ['Ready for Dev'], label: 'factory-auto' }))).toEqual(['PAY-1']);
      expect(keysOf(await provider.search({}))).toEqual(['PAY-1', 'PAY-2', 'PAY-3']);
    });

    it('picks up a ticket in an incremental search once it changes', async () => {
      const { provider, advanceClock } = setup([getMockTicket({ key: 'PAY-1' }), getMockTicket({ key: 'PAY-2' })]);
      advanceClock('2026-11-21T12:00:00Z');
      await provider.putFactoryComment('PAY-2', 'changed');

      expect(keysOf(await provider.search({ updatedSince: '2026-11-21T00:00:00Z' }))).toEqual(['PAY-2']);
    });

    it('lists the statuses a ticket can be in', async () => {
      const { provider } = setup([getMockTicket()]);

      expect((await provider.listStatuses()).map((status) => status.name)).toContain('Ready for Dev');
    });

    it('says what the account may do on a ticket, and fails for a ticket that does not exist', async () => {
      const { provider } = setup([getMockTicket()]);

      expect(await provider.checkAccess('PAY-142')).toEqual({ comment: true, transition: true });
      await expect(provider.checkAccess('PAY-999')).rejects.toThrow();
    });
  });
};
