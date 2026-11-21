import { describe, expect, it } from 'vitest';
import { createCommandRunner, createOrcaAgentRuntime, type CommandRunner } from '../src/adapters/orca-agent-runtime.js';

const WORKTREE = {
  id: '42023d6c::/work/billing/pay-142',
  path: '/work/billing/pay-142',
  branch: 'refs/heads/factory/pay-142',
  hostId: 'local',
  displayName: 'PAY-142',
};

const ok = (result: unknown): string => JSON.stringify({ id: 'r1', ok: true, result, _meta: {} });
const failed = (code: string, message: string): string => JSON.stringify({ id: 'local', ok: false, error: { code, message } });

const getRuntime = (replies: Readonly<Record<string, string>>) => {
  const calls: (readonly string[])[] = [];
  const run: CommandRunner = async (args) => {
    calls.push(args);
    return { stdout: replies[`${args[0]} ${args[1]}`] ?? failed('unknown_command', 'Unknown command') };
  };
  return { runtime: createOrcaAgentRuntime({ run }), calls };
};

describe('Orca agent runtime', () => {
  it('finds the worktree the developer is in, with a plain branch name and its host', async () => {
    const { runtime, calls } = getRuntime({ 'worktree current': ok({ worktree: WORKTREE }) });

    const worktree = await runtime.currentWorktree();

    expect(worktree).toEqual({ id: '42023d6c::/work/billing/pay-142', path: '/work/billing/pay-142', branch: 'factory/pay-142', host: 'local' });
    expect(calls).toEqual([['worktree', 'current', '--json']]);
  });

  it('keeps a branch name that Orca already reports in plain form', async () => {
    const { runtime } = getRuntime({ 'worktree current': ok({ worktree: { ...WORKTREE, branch: 'factory/pay-142' } }) });

    expect((await runtime.currentWorktree())?.branch).toBe('factory/pay-142');
  });

  it('reports no worktree when the directory is not inside one', async () => {
    const { runtime } = getRuntime({
      'worktree current': failed('selector_not_found', 'No Orca workspace contains the current directory: /private/tmp'),
    });

    expect(await runtime.currentWorktree()).toBeUndefined();
  });

  it('fails with Orca\'s message on any other error', async () => {
    const { runtime } = getRuntime({ 'worktree current': failed('runtime_unreachable', 'Orca is not running') });

    await expect(runtime.currentWorktree()).rejects.toThrow('Orca is not running');
  });

  it('creates a worktree on a named branch, linked to the ticket', async () => {
    const { runtime, calls } = getRuntime({ 'worktree create': ok({ worktree: WORKTREE }) });

    const worktree = await runtime.createWorktree({ name: 'PAY-142', branch: 'factory/pay-142', reference: 'PAY-142' });

    expect(worktree.path).toBe('/work/billing/pay-142');
    expect(calls).toEqual([['worktree', 'create', '--name', 'PAY-142', '--branch', 'factory/pay-142', '--reference', 'PAY-142', '--json']]);
  });

  it('creates a worktree with no ticket link when none is given', async () => {
    const { runtime, calls } = getRuntime({ 'worktree create': ok({ worktree: WORKTREE }) });

    await runtime.createWorktree({ name: 'scratch', branch: 'factory/scratch' });

    expect(calls).toEqual([['worktree', 'create', '--name', 'scratch', '--branch', 'factory/scratch', '--json']]);
  });

  it('starts a session in the background and returns a reference naming the worktree and its host', async () => {
    const { runtime, calls } = getRuntime({
      'agent launch': ok({ outcome: { kind: 'terminal', handle: 'term-7' }, receipt: { detail: 'terminal requested' } }),
    });
    const worktree = { id: WORKTREE.id, path: WORKTREE.path, branch: 'factory/pay-142', host: 'local' };

    const session = await runtime.startSession({ worktree, agent: 'claude', prompt: '/opsx:apply bulk-invoice-export' });

    expect(session).toEqual({ worktreeId: WORKTREE.id, host: 'local', surface: 'terminal', handle: 'term-7' });
    expect(calls).toEqual([
      ['agent', 'launch', '--agent', 'claude', '--worktree', 'path:/work/billing/pay-142', '--prompt', '/opsx:apply bulk-invoice-export', '--surface', 'terminal', '--json'],
    ]);
  });

  it('returns a reference without a handle when Orca gives none it can name', async () => {
    const { runtime } = getRuntime({ 'agent launch': ok({ outcome: { kind: 'chat', handle: { tab: 3 } } }) });
    const worktree = { id: WORKTREE.id, path: WORKTREE.path, branch: 'factory/pay-142', host: 'ssh:build-box' };

    const session = await runtime.startSession({ worktree, agent: 'claude', prompt: 'go' });

    expect(session).toEqual({ worktreeId: WORKTREE.id, host: 'ssh:build-box', surface: 'chat' });
  });

  it('posts progress as the worktree comment', async () => {
    const { runtime, calls } = getRuntime({ 'worktree set': ok({ worktree: WORKTREE }) });
    const worktree = { id: WORKTREE.id, path: WORKTREE.path, branch: 'factory/pay-142', host: 'local' };

    await runtime.postProgress({ worktree, text: 'Attempt 2 of 5 · quality gate' });

    expect(calls).toEqual([['worktree', 'set', '--worktree', 'path:/work/billing/pay-142', '--comment', 'Attempt 2 of 5 · quality gate', '--json']]);
  });

  it('fails when posting progress is refused', async () => {
    const { runtime } = getRuntime({ 'worktree set': failed('selector_not_found', 'No such worktree') });
    const worktree = { id: WORKTREE.id, path: WORKTREE.path, branch: 'factory/pay-142', host: 'local' };

    await expect(runtime.postProgress({ worktree, text: 'x' })).rejects.toThrow('No such worktree');
  });

  it('reports a session\'s cost as unknown without asking Orca, which cannot tell', async () => {
    const { runtime, calls } = getRuntime({});

    const cost = await runtime.sessionCost({ worktreeId: WORKTREE.id, host: 'local', surface: 'terminal' });

    expect(cost).toEqual({ known: false });
    expect(calls).toEqual([]);
  });

  it('reads an answer that starts with a blank line', async () => {
    const run: CommandRunner = async () => ({ stdout: `\n${ok({ worktree: WORKTREE })}\n` });

    expect((await createOrcaAgentRuntime({ run }).currentWorktree())?.path).toBe('/work/billing/pay-142');
  });

  it('quotes only the start of a long unexpected answer', async () => {
    const run: CommandRunner = async () => ({ stdout: 'x'.repeat(5000) });

    await expect(createOrcaAgentRuntime({ run }).currentWorktree()).rejects.toThrow(/^Orca did not answer with JSON: x{200}$/);
  });

  it('fails clearly when Orca prints something that is not its JSON envelope', async () => {
    const run: CommandRunner = async () => ({ stdout: 'Unknown command: worktree current' });

    await expect(createOrcaAgentRuntime({ run }).currentWorktree()).rejects.toThrow('Orca did not answer with JSON');
  });
});

describe('command runner', () => {
  it('runs a program with its arguments and returns what it printed', async () => {
    const run = createCommandRunner(process.execPath);

    const { stdout } = await run(['-e', 'console.log(process.argv.slice(1).join("+"))', 'a', 'b c']);

    expect(stdout.trim()).toBe('a+b c');
  });

  it('runs in the folder it is given', async () => {
    const run = createCommandRunner(process.execPath);

    const { stdout } = await run(['-e', 'console.log(process.cwd())'], { cwd: '/' });

    expect(stdout.trim()).toBe('/');
  });
});
