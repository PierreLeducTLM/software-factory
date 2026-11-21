import { expect, it } from 'vitest';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import { describeTicketProviderContract } from './contracts/ticket-provider-contract.js';

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
