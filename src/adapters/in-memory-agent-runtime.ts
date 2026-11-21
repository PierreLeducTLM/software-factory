import type { AgentRuntime, Worktree } from './agent-runtime.js';

type Options = { readonly worktree?: Worktree };

export const createInMemoryAgentRuntime = ({ worktree }: Options): AgentRuntime => ({
  currentWorktree: async () => worktree,
  createWorktree: async ({ name, branch }) => ({ id: `memory-${name}`, path: `/memory/${name}`, branch, host: worktree?.host ?? 'memory' }),
  startSession: async ({ worktree: target }) => ({ worktreeId: target.id, host: target.host, surface: 'terminal' }),
  postProgress: async () => undefined,
  sessionCost: async () => ({ known: false }),
});
