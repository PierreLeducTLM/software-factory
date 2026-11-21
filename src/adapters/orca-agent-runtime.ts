import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgentRuntime, Worktree } from './agent-runtime.js';

export type CommandRunner = (args: readonly string[]) => Promise<{ readonly stdout: string }>;

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
  return async (args) => ({ stdout: (await run(binary, [...args])).stdout });
};

export const createOrcaAgentRuntime = ({ run }: { readonly run: CommandRunner }): AgentRuntime => {
  const ask = async (args: readonly string[]): Promise<Reply> => {
    const { stdout } = await run([...args, '--json']);
    const envelope = EnvelopeSchema.safeParse(stdout.trimStart().startsWith('{') ? JSON.parse(stdout) : undefined);
    if (!envelope.success) throw new Error(`Orca did not answer with JSON: ${stdout.slice(0, 200)}`);
    return envelope.data.ok
      ? { ok: true, result: envelope.data.result }
      : { ok: false, code: envelope.data.error.code, message: envelope.data.error.message };
  };

  const demand = async (args: readonly string[]): Promise<unknown> => {
    const reply = await ask(args);
    if (!reply.ok) throw new Error(reply.message);
    return reply.result;
  };

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
