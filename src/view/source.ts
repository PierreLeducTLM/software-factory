import type { TicketProvider } from '../adapters/ticket-provider.js';
import type { FactoryConfig } from '../config/project-config.js';
import { buildBoard, buildNeedsYou, buildRunDetail, type Column, type NeedsYouItem, type RunDetail } from './model.js';
import { createViewStore } from './store.js';

type Options = {
  readonly providers: readonly { readonly name: string; readonly provider: TicketProvider }[];
  readonly config: FactoryConfig;
  readonly repository: string;
  readonly machine: string;
  readonly now: () => string;
};

export type ViewData = {
  readonly repository: string;
  readonly providers: readonly string[];
  readonly columns: readonly Column[];
  readonly needsYou: readonly NeedsYouItem[];
  readonly running: number;
  readonly pollSeconds: number;
  readonly loadedAt: string;
  readonly refreshedAt?: string;
  readonly staleSince?: string;
  readonly problem?: string;
};

export type ViewSource = {
  readonly load: () => Promise<ViewData>;
  readonly detail: (key: string) => Promise<RunDetail | undefined>;
};

const DONE_WINDOW_DAYS = 7;
const RUNNING_COLUMNS = ['revalidate', 'build', 'review'];

export const createViewSource = ({ providers, config, repository, machine, now }: Options): ViewSource => {
  const store = createViewStore({ providers, states: config.states, now, doneWindowDays: DONE_WINDOW_DAYS });
  const state: { attemptedAt?: number } = {};

  const fresh = async (): Promise<void> => {
    const at = Date.parse(now());
    if (state.attemptedAt !== undefined && at - state.attemptedAt < config.view.poll_seconds * 1000) return;
    state.attemptedAt = at;
    await store.refresh();
  };

  return {
    load: async () => {
      await fresh();
      const { tickets, refreshedAt, staleSince, problem } = store.snapshot();
      const options = { config, now: now(), machine, repository };
      const columns = buildBoard(tickets, options);
      return {
        repository,
        providers: providers.map(({ name }) => name),
        columns,
        needsYou: buildNeedsYou(tickets, options),
        running: columns.filter((column) => RUNNING_COLUMNS.includes(column.id)).flatMap((column) => column.cards).filter((card) => !card.interrupted).length,
        pollSeconds: config.view.poll_seconds,
        loadedAt: options.now,
        ...(refreshedAt === undefined ? {} : { refreshedAt }),
        ...(staleSince === undefined ? {} : { staleSince }),
        ...(problem === undefined ? {} : { problem }),
      };
    },

    detail: async (key) => {
      await fresh();
      const ticket = store.snapshot().tickets.find((candidate) => candidate.key === key);
      return ticket === undefined ? undefined : buildRunDetail(ticket, { config, now: now(), machine, repository });
    },
  };
};
