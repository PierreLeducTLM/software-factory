import { expect, it } from 'vitest';
import { createInMemoryAgentRuntime } from '../src/adapters/in-memory-agent-runtime.js';

const worktree = { id: 'wt-1', path: '/work/pay-142', branch: 'factory/pay-142', host: 'pierre-mbp' };

it('reports the worktree it was given, or none', async () => {
  expect(await createInMemoryAgentRuntime({ worktree }).currentWorktree()).toEqual(worktree);
  expect(await createInMemoryAgentRuntime({}).currentWorktree()).toBeUndefined();
});

it('creates a worktree on the same host as the current one', async () => {
  const created = await createInMemoryAgentRuntime({ worktree }).createWorktree({ name: 'PAY-150', branch: 'factory/pay-150' });

  expect(created).toEqual({ id: 'memory-PAY-150', path: '/memory/PAY-150', branch: 'factory/pay-150', host: 'pierre-mbp' });
  expect((await createInMemoryAgentRuntime({}).createWorktree({ name: 'x', branch: 'b' })).host).toBe('memory');
});

it('starts a terminal session in the given worktree, accepts progress, and knows no cost', async () => {
  const runtime = createInMemoryAgentRuntime({ worktree });

  const session = await runtime.startSession({ worktree, agent: 'claude', prompt: 'go' });

  expect(session).toEqual({ worktreeId: 'wt-1', host: 'pierre-mbp', surface: 'terminal' });
  expect(await runtime.postProgress({ worktree, text: 'building' })).toBeUndefined();
  expect(await runtime.sessionCost(session)).toEqual({ known: false });
});
