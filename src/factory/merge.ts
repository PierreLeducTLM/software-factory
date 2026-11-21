import { parseComment, type Run } from '../record/ticket-record.js';
import type { RiskLevel } from './risk.js';
import type { FactoryDeps } from './run-lifecycle.js';

export const autoMerged = (run: Run): boolean => run.merge?.route === 'auto' && run.merge.refused === undefined;

export const autoMergeSuspended = async ({ tickets, config }: Pick<FactoryDeps, 'tickets' | 'config'>, level: RiskLevel): Promise<boolean> => {
  const since = config.risk[level].auto_since;
  const candidates = await tickets.search({ statuses: Object.values(config.states), ...(since === undefined ? {} : { updatedSince: `${since}T00:00:00Z` }) });
  return candidates.some((ticket) => {
    const parsed = parseComment(ticket.factoryComment ?? '', { trustEdited: true });
    if (parsed.status !== 'ok') return false;
    return parsed.record.runs.some((run) => run.risk?.level === level && autoMerged(run) && run.revert !== undefined && (since === undefined || run.revert.at >= since));
  });
};
