import type { TicketProvider } from '../adapters/ticket-provider.js';
import { parseComment, renderComment, type ParsedComment, type TicketRecord } from './ticket-record.js';

const ARCHIVE_LINK_ALLOWANCE = 200;

export const loadRecord = async (provider: TicketProvider, key: string): Promise<ParsedComment> => {
  const comment = await provider.getFactoryComment(key);
  return comment === undefined ? { status: 'none' } : parseComment(comment);
};

type SaveRequest = {
  readonly key: string;
  readonly record: TicketRecord;
  readonly summary: string;
  readonly budget: number;
};

const withoutOldest = (record: TicketRecord, count: number, link: string): TicketRecord => ({
  ...record,
  events: record.events.slice(count),
  archives: [...record.archives, link],
});

export const saveRecord = async (provider: TicketProvider, { key, record, summary, budget }: SaveRequest): Promise<void> => {
  const fits = (candidate: TicketRecord): boolean => renderComment({ record: candidate, summary }).length <= budget;

  if (fits(record)) {
    await provider.putFactoryComment(key, renderComment({ record, summary }));
    return;
  }

  const newestOnly = record.events.length - 1;
  const placeholder = 'x'.repeat(ARCHIVE_LINK_ALLOWANCE);
  const count =
    Array.from({ length: newestOnly }, (_, index) => index + 1).find((candidate) =>
      fits(withoutOldest(record, candidate, placeholder)),
    ) ?? newestOnly;

  const link = await provider.addAttachment({
    key,
    name: `factory-record-archive-${record.archives.length + 1}.json`,
    content: JSON.stringify({ events: record.events.slice(0, count) }),
  });

  await provider.putFactoryComment(key, renderComment({ record: withoutOldest(record, count, link), summary }));
};
