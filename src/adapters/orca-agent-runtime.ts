import { execFile } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgentRuntime, Worktree } from './agent-runtime.js';

export type CommandRunner = (args: readonly string[], options?: { readonly cwd: string }) => Promise<{ readonly stdout: string }>;

const EnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

const WorktreeResultSchema = z.object({
  worktree: z.object({ id: z.string(), path: z.string(), branch: z.string(), hostId: z.string() }),
});

const LaunchResultSchema = z.object({ outcome: z.object({ kind: z.string(), handle: z.unknown() }) });

type Reply = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly code: string; readonly message: string };

const NOT_IN_A_WORKTREE = 'selector_not_found';
const BRANCH_PREFIX = 'refs/heads/';

const toWorktree = (result: unknown): Worktree => {
  const { worktree } = WorktreeResultSchema.parse(result);
  return {
    id: worktree.id,
    path: worktree.path,
    branch: worktree.branch.startsWith(BRANCH_PREFIX) ? worktree.branch.slice(BRANCH_PREFIX.length) : worktree.branch,
    host: worktree.hostId,
  };
};

export const createCommandRunner = (binary: string): CommandRunner => {
  const run = promisify(execFile);
  return async (args, options) => ({ stdout: (await run(binary, [...args], options === undefined ? {} : { cwd: options.cwd })).stdout });
};

const looksLikeJson = (text: string): boolean => text.trimStart().startsWith('{');

const printedOnFailure = (error: unknown): string | undefined =>
  error instanceof Error && 'stdout' in error && typeof error.stdout === 'string' && looksLikeJson(error.stdout) ? error.stdout : undefined;

const printedBy = async (run: CommandRunner, args: readonly string[]): Promise<string> => {
  try {
    return (await run(args)).stdout;
  } catch (error) {
    const stdout = printedOnFailure(error);
    if (stdout === undefined) throw error;
    return stdout;
  }
};

const askOrca = async (run: CommandRunner, args: readonly string[]): Promise<Reply> => {
  const stdout = await printedBy(run, [...args, '--json']);
  const envelope = EnvelopeSchema.safeParse(looksLikeJson(stdout) ? JSON.parse(stdout) : undefined);
  if (!envelope.success) throw new Error(`Orca did not answer with JSON: ${stdout.slice(0, 200)}`);
  return envelope.data.ok ? { ok: true, result: envelope.data.result } : { ok: false, code: envelope.data.error.code, message: envelope.data.error.message };
};

const demandOfOrca = async (run: CommandRunner, args: readonly string[]): Promise<unknown> => {
  const reply = await askOrca(run, args);
  if (!reply.ok) throw new Error(reply.message);
  return reply.result;
};

export const createOrcaWorktreeOpener =
  ({ run }: { readonly run: CommandRunner }) =>
  async (worktreeId: string): Promise<void> => {
    await demandOfOrca(run, ['worktree', 'activate', '--worktree', `id:${worktreeId}`]);
  };

export type TicketTracker = 'linear' | 'jira';

export type WorktreeStart = {
  readonly name: string;
  readonly prompt: string;
  readonly ticket: { readonly key: string; readonly tracker: TicketTracker };
};

const TICKET_LINKS: Readonly<Record<TicketTracker, string>> = { linear: '--linear-issue', jira: '--reference' };
const COMMON_GIT_DIR = ['rev-parse', '--path-format=absolute', '--git-common-dir'];
const REPO_NOT_FOUND = 'repo_not_found';

const unknownRepo = (repoDir: string): string =>
  `Orca does not know the repo at ${repoDir}. Add it in Orca, or run the dashboard from a worktree of a repo Orca knows.`;

export const createOrcaWorktreeStarter =
  ({ run, git }: { readonly run: CommandRunner; readonly git: CommandRunner }) =>
  async ({ name, prompt, ticket }: WorktreeStart): Promise<string> => {
    const repoDir = dirname((await git(COMMON_GIT_DIR)).stdout.trim());
    const link = [TICKET_LINKS[ticket.tracker], ticket.key];
    const reply = await askOrca(run, ['worktree', 'create', '--repo', `path:${repoDir}`, '--name', name, '--no-parent', ...link, '--agent', 'claude', '--prompt', prompt, '--activate']);
    if (!reply.ok) throw new Error(reply.code === REPO_NOT_FOUND ? unknownRepo(repoDir) : reply.message);
    return basename(WorktreeResultSchema.parse(reply.result).worktree.path);
  };

export const createOrcaAgentRuntime = ({ run }: { readonly run: CommandRunner }): AgentRuntime => {
  const ask = (args: readonly string[]): Promise<Reply> => askOrca(run, args);
  const demand = (args: readonly string[]): Promise<unknown> => demandOfOrca(run, args);

  return {
    currentWorktree: async () => {
      const reply = await ask(['worktree', 'current']);
      if (reply.ok) return toWorktree(reply.result);
      if (reply.code === NOT_IN_A_WORKTREE) return undefined;
      throw new Error(reply.message);
    },

    createWorktree: async ({ name, branch, reference }) =>
      toWorktree(
        await demand(['worktree', 'create', '--name', name, '--branch', branch, ...(reference === undefined ? [] : ['--reference', reference])]),
      ),

    startSession: async ({ worktree, agent, prompt }) => {
      const result = await demand(['agent', 'launch', '--agent', agent, '--worktree', `path:${worktree.path}`, '--prompt', prompt, '--surface', 'terminal']);
      const { outcome } = LaunchResultSchema.parse(result);
      return {
        worktreeId: worktree.id,
        host: worktree.host,
        surface: outcome.kind,
        ...(typeof outcome.handle === 'string' ? { handle: outcome.handle } : {}),
      };
    },

    postProgress: async ({ worktree, text }) => {
      await demand(['worktree', 'set', '--worktree', `path:${worktree.path}`, '--comment', text]);
    },

    sessionCost: async () => ({ known: false }),
  };
};
