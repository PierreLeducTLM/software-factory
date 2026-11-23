import type { TicketProvider } from '../adapters/ticket-provider.js';
import type { FactoryConfig } from '../config/project-config.js';
import type { ViewTicket } from './model.js';

type Options = {
  readonly providers: readonly { readonly name: string; readonly provider: TicketProvider }[];
  readonly states: FactoryConfig['states'];
  readonly now: () => string;
  readonly doneWindowDays: number;
};

export type Snapshot = {
  readonly tickets: readonly ViewTicket[];
  readonly refreshedAt?: string;
  readonly staleSince?: string;
  readonly problem?: string;
};

export type ViewStore = { readonly refresh: () => Promise<void>; readonly reload: () => Promise<void>; readonly snapshot: () => Snapshot };

const MS_PER_DAY = 86_400_000;

const isoOf = (milliseconds: number): string => new Date(milliseconds).toISOString().replace('.000Z', 'Z');

export const createViewStore = ({ providers, states, now, doneWindowDays }: Options): ViewStore => {
  const state: { snapshot: Snapshot } = { snapshot: { tickets: [] } };
  const tracked = Object.values(states);
  const open = tracked.filter((status) => status !== states.done);

  const read = async (since: string | undefined, at: string): Promise<readonly ViewTicket[]> => {
    const perProvider = await Promise.all(
      providers.map(async ({ name, provider }) => {
        const found =
          since === undefined
            ? (await Promise.all([provider.search({ statuses: open }), provider.search({ statuses: [states.done], updatedSince: isoOf(Date.parse(at) - doneWindowDays * MS_PER_DAY) })])).flat()
            : await provider.search({ updatedSince: since });
        return found.map((ticket) => ({ ...ticket, provider: name }));
      }),
    );
    return perProvider.flat();
  };

  const update = async (merge: (held: Snapshot, at: string) => Promise<readonly ViewTicket[]>): Promise<void> => {
    const at = now();
    const held = state.snapshot;
    const { tickets, refreshedAt } = held;
    try {
      const merged = await merge(held, at);
      state.snapshot = { tickets: merged.filter((ticket) => tracked.includes(ticket.status)), refreshedAt: at };
    } catch (error) {
      state.snapshot = {
        tickets,
        ...(refreshedAt === undefined ? {} : { refreshedAt }),
        staleSince: state.snapshot.staleSince ?? refreshedAt ?? at,
        problem: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    snapshot: () => state.snapshot,

    refresh: () =>
      update(async ({ tickets, refreshedAt }, at) => {
        const changed = await read(refreshedAt, at);
        const untouched = tickets.filter((ticket) => !changed.some((other) => other.key === ticket.key && other.provider === ticket.provider));
        return [...untouched, ...changed];
      }),

    reload: () => update((_held, at) => read(undefined, at)),
  };
};
