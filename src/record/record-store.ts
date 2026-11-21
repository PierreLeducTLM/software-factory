import type { TicketProvider } from '../adapters/ticket-provider.js';
import { parseComment, renderComment, type ParsedComment, type TicketRecord } from './ticket-record.js';

const ARCHIVE_LINK_ALLOWANCE = 200;

export const loadRecord = async (
  provider: TicketProvider,
  key: string,
  options: { readonly trustEdited: boolean } = { trustEdited: false },
): Promise<ParsedComment> => {
  const comment = await provider.getFactoryComment(key);
  return comment === undefined ? { status: 'none' } : parseComment(comment, options);
};

type SaveRequest = {
  readonly key: string;
  readonly record: TicketRecord;
  readonly summary: string;
  readonly budget: number;
};

type Plan = { readonly events: number; readonly runs: number };

const compacted = (record: TicketRecord, { events, runs }: Plan, link: string): TicketRecord => ({
  ...record,
  events: record.events.slice(events),
  runs: record.runs.map((run, index) => (index < runs ? { ...run, steps: [], attempts: [], compacted: true } : run)),
  archives: [...record.archives, link],
});

const plansFor = (record: TicketRecord): readonly Plan[] => {
  const allButNewestEvent = Math.max(record.events.length - 1, 0);
  const allButLatestRun = Math.max(record.runs.length - 1, 0);
  return [
    ...Array.from({ length: allButNewestEvent }, (_, index) => ({ events: index + 1, runs: 0 })),
    ...Array.from({ length: allButLatestRun }, (_, index) => ({ events: allButNewestEvent, runs: index + 1 })),
  ];
};

export const saveRecord = async (provider: TicketProvider, { key, record, summary, budget }: SaveRequest): Promise<void> => {
  const fits = (candidate: TicketRecord): boolean => renderComment({ record: candidate, summary }).length <= budget;
  const plans = plansFor(record);
  const last = plans.at(-1);

  if (fits(record) || last === undefined) {
    await provider.putFactoryComment(key, renderComment({ record, summary }));
    return;
  }

  const placeholder = 'x'.repeat(ARCHIVE_LINK_ALLOWANCE);
  const plan = plans.find((candidate) => fits(compacted(record, candidate, placeholder))) ?? last;

  const link = await provider.addAttachment({
    key,
    name: `factory-record-archive-${record.archives.length + 1}.json`,
    content: JSON.stringify({
      events: record.events.slice(0, plan.events),
      runs: record.runs.slice(0, plan.runs).map((run, index) => ({ run: index + 1, steps: run.steps, attempts: run.attempts })),
    }),
  });

  await provider.putFactoryComment(key, renderComment({ record: compacted(record, plan, link), summary }));
};
