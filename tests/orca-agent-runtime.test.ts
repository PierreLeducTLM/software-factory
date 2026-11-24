import { describe, expect, it } from 'vitest';
import { createCommandRunner, createOrcaAgentRuntime, createOrcaWorktreeOpener, createOrcaWorktreeStarter, type CommandRunner } from '../src/adapters/orca-agent-runtime.js';

const WORKTREE = {
  id: '42023d6c::/work/billing/pay-142',
  path: '/work/billing/pay-142',
  branch: 'refs/heads/factory/pay-142',
  hostId: 'local',
  displayName: 'PAY-142',
};

const ok = (result: unknown): string => JSON.stringify({ id: 'r1', ok: true, result, _meta: {} });
const failed = (code: string, message: string): string => JSON.stringify({ id: 'local', ok: false, error: { code, message } });

const COMMON_DIR_QUESTION = 'rev-parse --path-format=absolute --git-common-dir';

const gitReporting = (commonDir: string): CommandRunner => async (args) => {
  if (args.join(' ') !== COMMON_DIR_QUESTION) throw new Error(`Unexpected git call: ${args.join(' ')}`);
  return { stdout: `${commonDir}\n` };
};

const getRuntime = (replies: Readonly<Record<string, string>>, { commonDir = '/work/billing/.git' }: { readonly commonDir?: string } = {}) => {
  const calls: (readonly string[])[] = [];
  const run: CommandRunner = async (args) => {
    calls.push(args);
    return { stdout: replies[`${args[0]} ${args[1]}`] ?? failed('unknown_command', 'Unknown command') };
  };
  return { runtime: createOrcaAgentRuntime({ run }), open: createOrcaWorktreeOpener({ run }), start: createOrcaWorktreeStarter({ run, git: gitReporting(commonDir) }), calls };
};

const exitingWith = (stdout: string): CommandRunner => {
  const node = createCommandRunner(process.execPath);
  return (args) => node(['-e', `process.stdout.write(${JSON.stringify(stdout)}); process.exit(1)`, ...args]);
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

  it('brings a recorded worktree to the front on its host', async () => {
    const { open, calls } = getRuntime({ 'worktree activate': ok({ worktree: WORKTREE }) });

    await open('42023d6c::/work/billing/pay-142');

    expect(calls).toEqual([['worktree', 'activate', '--worktree', 'id:42023d6c::/work/billing/pay-142', '--json']]);
  });

  it('fails with Orca\'s message when the worktree cannot be opened', async () => {
    const { open } = getRuntime({ 'worktree activate': failed('selector_not_found', 'No worktree matches id:gone') });

    await expect(open('gone')).rejects.toThrow('No worktree matches id:gone');
  });

  it('starts Claude with the prompt in a new worktree named for a Linear ticket, linked to the issue, and brings Orca to the front', async () => {
    const { start, calls } = getRuntime({ 'worktree create': ok({ worktree: { ...WORKTREE, path: '/work/workspaces/billing/pie-21', branch: 'pie-21' } }) });

    const name = await start({ name: 'pie-21', prompt: '/factory-refine PIE-21', ticket: { key: 'PIE-21', tracker: 'linear' } });

    expect(name).toBe('pie-21');
    expect(calls).toEqual([
      ['worktree', 'create', '--repo', 'path:/work/billing', '--name', 'pie-21', '--no-parent', '--linear-issue', 'PIE-21', '--agent', 'claude', '--prompt', '/factory-refine PIE-21', '--activate', '--json'],
    ]);
  });

  it('links a Jira ticket to the new worktree as a reference', async () => {
    const { start, calls } = getRuntime({ 'worktree create': ok({ worktree: WORKTREE }) });

    await start({ name: 'pay-142', prompt: '/factory-run PAY-142', ticket: { key: 'PAY-142', tracker: 'jira' } });

    expect(calls).toEqual([
      ['worktree', 'create', '--repo', 'path:/work/billing', '--name', 'pay-142', '--no-parent', '--reference', 'PAY-142', '--agent', 'claude', '--prompt', '/factory-run PAY-142', '--activate', '--json'],
    ]);
  });

  it('names the started worktree as Orca created it, with the suffix Orca added', async () => {
    const { start } = getRuntime({ 'worktree create': ok({ worktree: { ...WORKTREE, path: '/work/workspaces/billing/pie-21-2', branch: 'pie-21-2' } }) });

    expect(await start({ name: 'pie-21', prompt: '/factory-refine PIE-21', ticket: { key: 'PIE-21', tracker: 'linear' } })).toBe('pie-21-2');
  });

  it('starts the worktree in the main checkout Orca knows, even when the dashboard runs from one of its worktrees', async () => {
    const { start, calls } = getRuntime({ 'worktree create': ok({ worktree: WORKTREE }) }, { commonDir: '/Users/dev/projects/billing/.git' });

    await start({ name: 'pay-142', prompt: '/factory-run PAY-142', ticket: { key: 'PAY-142', tracker: 'jira' } });

    expect(calls[0]?.slice(2, 4)).toEqual(['--repo', 'path:/Users/dev/projects/billing']);
  });

  it('says which repo Orca does not know and how to fix it', async () => {
    const { start } = getRuntime({ 'worktree create': failed('repo_not_found', 'repo_not_found') });

    await expect(start({ name: 'pay-142', prompt: '/factory-run PAY-142', ticket: { key: 'PAY-142', tracker: 'jira' } })).rejects.toThrow(
      new Error('Orca does not know the repo at /work/billing. Add it in Orca, or run the dashboard from a worktree of a repo Orca knows.'),
    );
  });

  it('keeps Orca\'s message when Orca exits with an error', async () => {
    const run = exitingWith(failed('runtime_unreachable', 'Orca is not running'));

    await expect(createOrcaWorktreeStarter({ run, git: gitReporting('/work/billing/.git') })({ name: 'pie-21', prompt: 'go', ticket: { key: 'PIE-21', tracker: 'linear' } })).rejects.toThrow(
      new Error('Orca is not running'),
    );
  });

  it('keeps Orca\'s answer when a question exits with an error', async () => {
    const run = exitingWith(failed('selector_not_found', 'No Orca workspace contains the current directory: /private/tmp'));

    expect(await createOrcaAgentRuntime({ run }).currentWorktree()).toBeUndefined();
  });

  it('still fails with the command\'s own error when Orca exits with an error and prints no JSON', async () => {
    const run = exitingWith('');

    await expect(createOrcaAgentRuntime({ run }).currentWorktree()).rejects.toThrow('Command failed');
  });

  it('fails with Orca\'s message when the worktree cannot be started', async () => {
    const { start } = getRuntime({ 'worktree create': failed('runtime_unreachable', 'Orca is not running') });

    await expect(start({ name: 'pie-21', prompt: '/factory-refine PIE-21', ticket: { key: 'PIE-21', tracker: 'linear' } })).rejects.toThrow('Orca is not running');
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
