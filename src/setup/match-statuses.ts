import type { ProviderStatus } from '../adapters/ticket-provider.js';
import type { FactoryState } from '../record/ticket-record.js';

export type StatusMatch = { readonly matched: Readonly<Partial<Record<FactoryState, string>>>; readonly unmatched: readonly FactoryState[] };

const NAMES: readonly (readonly [FactoryState, readonly string[]])[] = [
  ['to_refine', ['to refine', 'refinement', 'needs refinement', 'backlog', 'open', 'to do', 'todo']],
  ['spec_review', ['spec review', 'specification review', 'in refinement', 'refining']],
  ['ready_for_dev', ['ready for dev', 'ready for development', 'selected for development', 'ready', 'to do', 'todo']],
  ['in_development', ['in development', 'in progress', 'in dev', 'doing']],
  ['in_review', ['in review', 'code review', 'pr review', 'review']],
  ['blocked', ['blocked', 'on hold', 'impeded']],
  ['done', ['done', 'closed', 'resolved', 'merged']],
];

const BY_CATEGORY: readonly (readonly [FactoryState, ProviderStatus['category']])[] = [
  ['in_development', 'in_progress'],
  ['done', 'done'],
];

const normalised = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type Taken = Readonly<Partial<Record<FactoryState, string>>>;

export const matchStatuses = (statuses: readonly ProviderStatus[]): StatusMatch => {
  const free = (taken: Taken): readonly ProviderStatus[] => statuses.filter((status) => !Object.values(taken).includes(status.name));

  const byName = NAMES.reduce<Taken>((taken, [state, names]) => {
    const available = free(taken);
    const found = names.flatMap((name) => available.filter((status) => normalised(status.name) === name))[0];
    return found === undefined ? taken : { ...taken, [state]: found.name };
  }, {});

  const matched = BY_CATEGORY.reduce<Taken>((taken, [state, category]) => {
    const [only, ...others] = free(taken).filter((status) => status.category === category);
    return state in taken || only === undefined || others.length > 0 ? taken : { ...taken, [state]: only.name };
  }, byName);

  return { matched, unmatched: NAMES.map(([state]) => state).filter((state) => !(state in matched)) };
};
