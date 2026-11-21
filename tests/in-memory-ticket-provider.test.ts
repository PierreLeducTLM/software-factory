import { expect, it } from 'vitest';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import { describeTicketProviderContract, getMockTicket } from './contracts/ticket-provider-contract.js';

describeTicketProviderContract('in-memory fake', (seed) => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  return {
    provider: createInMemoryTicketProvider({ tickets: seed, now: () => clock.now }),
    advanceClock: (iso) => {
      clock.now = iso;
    },
  };
});

it('fails to read an attachment link that was never issued', async () => {
  const provider = createInMemoryTicketProvider({ tickets: [], now: () => '2026-11-21T08:00:00Z' });

  await expect(provider.readAttachment('memory://attachment/0/log.txt')).rejects.toThrow(
    'No attachment at memory://attachment/0/log.txt',
  );
});

it('lists the statuses its tickets are in once each, or the ones it is given', async () => {
  const now = () => '2026-11-21T08:00:00Z';
  const tickets = [getMockTicket({ key: 'A' }), getMockTicket({ key: 'B' }), getMockTicket({ key: 'C', status: 'Done' })];
  const statuses = [{ name: 'Backlog', category: 'todo' as const }];

  expect(await createInMemoryTicketProvider({ tickets, now }).listStatuses()).toEqual([{ name: 'Ready for Dev', category: 'unknown' }, { name: 'Done', category: 'unknown' }]);
  expect(await createInMemoryTicketProvider({ tickets, now, statuses }).listStatuses()).toEqual(statuses);
});

it('reports the access it is given', async () => {
  const provider = createInMemoryTicketProvider({ tickets: [getMockTicket()], now: () => '2026-11-21T08:00:00Z', access: { comment: true, transition: false } });

  expect(await provider.checkAccess('PAY-142')).toEqual({ comment: true, transition: false });
  await expect(provider.checkAccess('PAY-999')).rejects.toThrow('Ticket PAY-999 was not found');
});
