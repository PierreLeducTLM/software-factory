import type { WorktreeStart } from '../adapters/orca-agent-runtime.js';
import type { TicketProvider } from '../adapters/ticket-provider.js';
import { TICKET_PROVIDER_NAMES, type FactoryConfig } from '../config/project-config.js';
import { parseComment } from '../record/ticket-record.js';
import { buildHealth, type Health } from './health.js';
import { buildBoard, buildNeedsYou, buildRunDetail, type Column, type NeedsYouItem, type RunDetail } from './model.js';
import { createViewStore } from './store.js';

type Options = {
  readonly providers: readonly { readonly name: string; readonly provider: TicketProvider }[];
  readonly config: FactoryConfig;
  readonly repository: string;
  readonly machine: string;
  readonly now: () => string;
  readonly openWorktree: (worktreeId: string) => Promise<void>;
  readonly startWorktree: (start: WorktreeStart) => Promise<string>;
};

export type OpenResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export type StartRequest = { readonly key: string; readonly command: string };

export type StartResult = { readonly ok: true; readonly worktree: string } | { readonly ok: false; readonly message: string };

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
  readonly reload: () => Promise<ViewData>;
  readonly detail: (key: string) => Promise<RunDetail | undefined>;
  readonly health: (periodDays: number) => Promise<Health>;
  readonly openInOrca: (key: string) => Promise<OpenResult>;
  readonly startInOrca: (request: StartRequest) => Promise<StartResult>;
};

const DONE_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;
const RUNNING_COLUMNS = ['revalidate', 'build', 'review'];
const NEXT_COMMAND = '/factory-next';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const createViewSource = ({ providers, config, repository, machine, now, openWorktree, startWorktree }: Options): ViewSource => {
  const store = createViewStore({ providers, states: config.states, now, doneWindowDays: DONE_WINDOW_DAYS });
  const state: { attemptedAt?: number } = {};

  const fresh = async (): Promise<void> => {
    const at = Date.parse(now());
    if (state.attemptedAt !== undefined && at - state.attemptedAt < config.view.poll_seconds * 1000) return;
    state.attemptedAt = at;
    await store.refresh();
  };

  const reloaded = async (): Promise<void> => {
    state.attemptedAt = Date.parse(now());
    await store.reload();
  };

  const view = (): ViewData => {
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
  };

  return {
    load: async () => {
      await fresh();
      return view();
    },

    reload: async () => {
      await reloaded();
      return view();
    },

    detail: async (key) => {
      await fresh();
      const ticket = store.snapshot().tickets.find((candidate) => candidate.key === key);
      return ticket === undefined ? undefined : buildRunDetail(ticket, { config, now: now(), machine, repository });
    },

    openInOrca: async (key) => {
      await fresh();
      const comment = store.snapshot().tickets.find((candidate) => candidate.key === key)?.factoryComment;
      const parsed = comment === undefined ? undefined : parseComment(comment, { trustEdited: false });
      const run = parsed?.status === 'ok' ? parsed.record.runs.at(-1) : undefined;
      if (run?.machine !== machine) return { ok: false, message: `${key} has no run on this machine.` };
      return openWorktree(run.worktreeId).then(
        () => ({ ok: true }),
        (error: unknown) => ({ ok: false, message: `Orca could not open the run: ${messageOf(error)}` }),
      );
    },

    startInOrca: async ({ key, command }) => {
      await fresh();
      const refused = (message: string): StartResult => ({ ok: false, message: `Orca could not start ${key}: ${message}` });
      const startable = buildBoard(store.snapshot().tickets, { config, now: now(), machine, repository })
        .flatMap((column) => column.cards)
        .filter((card) => card.key === key && card.command !== undefined && !card.onThisMachine);
      if (startable.length === 0) return refused(`${key} has nothing to start in a new worktree.`);
      const card = startable.find((candidate) => candidate.command === command);
      if (card === undefined) return refused(`${key} changed since this panel opened. Reopen it to see what to run.`);
      const start: WorktreeStart = {
        name: key.toLowerCase(),
        prompt: command === NEXT_COMMAND ? `/factory-run ${key}` : command,
        ticket: { key, tracker: card.provider === TICKET_PROVIDER_NAMES.linear ? 'linear' : 'jira' },
      };
      return startWorktree(start).then(
        (worktree): StartResult => ({ ok: true, worktree }),
        (error: unknown) => refused(messageOf(error)),
      );
    },

    health: async (periodDays) => {
      const at = now();
      const updatedSince = new Date(Date.parse(at) - periodDays * MS_PER_DAY).toISOString().replace('.000Z', 'Z');
      const perProvider = await Promise.all(providers.map(async ({ name, provider }) => (await provider.search({ updatedSince })).map((ticket) => ({ ...ticket, provider: name }))));
      return buildHealth(perProvider.flat(), { config, now: at, repository, periodDays });
    },
  };
};
