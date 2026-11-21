import { describe, expect, it } from 'vitest';
import type { ScriptRun } from '../src/factory/checks.js';
import type { Candidate } from '../src/setup/detect.js';
import { timeoutFor, verifyChecks } from '../src/setup/verify.js';

const getCandidate = (overrides?: Partial<Candidate>): Candidate => ({ id: 'test', category: 'tests', source: 'local', run: 'pnpm run test', from: 'package.json', ...overrides });

const getWorld = (runs: Readonly<Record<string, readonly (ScriptRun & { readonly seconds: number })[]>>) => {
  const clock = { seconds: 0 };
  const calls: { command: string; timeoutSeconds: number }[] = [];
  const queues = Object.fromEntries(Object.entries(runs).map(([command, queue]) => [command, [...queue]]));
  return {
    calls,
    deps: {
      now: () => new Date(Date.UTC(2026, 10, 21, 8, 0, clock.seconds)).toISOString(),
      runScript: async (command: string, { timeoutSeconds }: { readonly timeoutSeconds: number }): Promise<ScriptRun> => {
        calls.push({ command, timeoutSeconds });
        const { seconds, ...run } = queues[command]?.shift() ?? { exitCode: 0, output: 'ok', timedOut: false, seconds: 1 };
        clock.seconds += seconds;
        return run;
      },
    },
  };
};

const ok = (seconds: number) => ({ exitCode: 0, output: 'ok', timedOut: false, seconds });
const failing = (seconds: number, output = 'boom') => ({ exitCode: 1, output, timedOut: false, seconds });

describe('verifying the detected checks on main', () => {
  it('runs each check once and sets its timeout from the measured duration, with a margin', async () => {
    const world = getWorld({ 'pnpm run test': [ok(240)], 'pnpm run lint': [ok(12)] });

    const result = await verifyChecks(world.deps, [getCandidate(), getCandidate({ id: 'lint', category: 'lint', run: 'pnpm run lint' })]);

    expect(result).toEqual([
      { id: 'test', category: 'tests', status: 'pass', durationSeconds: 240, timeout: '6m' },
      { id: 'lint', category: 'lint', status: 'pass', durationSeconds: 12, timeout: '30s' },
    ]);
    expect(world.calls).toEqual([
      { command: 'pnpm run test', timeoutSeconds: 1800 },
      { command: 'pnpm run lint', timeoutSeconds: 1800 },
    ]);
  });

  it('runs a failing check a second time: failing twice is a failure, passing once is flaky', async () => {
    const world = getWorld({ 'pnpm run test': [failing(20, `${'x'.repeat(600)}first`), failing(50, 'second')], 'pnpm run e2e': [failing(90), ok(30)] });

    const result = await verifyChecks(world.deps, [getCandidate(), getCandidate({ id: 'e2e', category: 'e2e', run: 'pnpm run e2e' })]);

    expect(result).toEqual([
      { id: 'test', category: 'tests', status: 'fail', durationSeconds: 50, timeout: '2m', detail: `${'x'.repeat(495)}first` },
      { id: 'e2e', category: 'e2e', status: 'flaky', durationSeconds: 90, timeout: '3m', detail: 'boom' },
    ]);
    expect(world.calls).toHaveLength(4);
  });

  it('counts a check that times out as failing', async () => {
    const world = getWorld({ 'pnpm run test': [{ exitCode: 0, output: 'hung', timedOut: true, seconds: 1800 }, { exitCode: 0, output: 'hung', timedOut: true, seconds: 1800 }] });

    expect((await verifyChecks(world.deps, [getCandidate()]))[0]).toMatchObject({ status: 'fail', timeout: '45m' });
  });

  it('does not run a check that only exists in CI', async () => {
    const world = getWorld({});
    const { run: _run, ...ciOnly } = getCandidate({ id: 'security-scan', category: 'security', source: 'ci', job: 'security-scan' });

    expect(await verifyChecks(world.deps, [ciOnly])).toEqual([{ id: 'security-scan', category: 'security', status: 'not_run', durationSeconds: 0, timeout: '15m' }]);
    expect(world.calls).toEqual([]);
  });

  it.each([
    [0, '30s'],
    [20, '30s'],
    [21, '40s'],
    [40, '60s'],
    [41, '2m'],
    [80, '2m'],
    [81, '3m'],
    [240, '6m'],
  ])('gives a check measured at %ss a timeout of %s', (seconds, timeout) => {
    expect(timeoutFor(seconds)).toBe(timeout);
  });
});
