import { describe, expect, it } from 'vitest';
import type { CiResult } from '../src/adapters/source-control.js';
import { parseFactoryConfig, type Check } from '../src/config/project-config.js';
import { gatePassed, judgeAgentCheck, runScriptChecks, type CheckDeps, type ScriptRun } from '../src/factory/checks.js';

const getChecks = (yaml: string): readonly Check[] => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: a, spec_review: b, ready_for_dev: c, in_development: d, in_review: e, blocked: f, done: g }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks:
${yaml}
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value.checks;
};

const UNIT_TESTS = '  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm test }';
const LINT = '  - { id: lint, station: quality, kind: script, blocking: false, timeout: 90s, run: pnpm lint }';
const UI_E2E = '  - { id: ui-e2e, station: quality, kind: script, blocking: true, timeout: 10m, run: pnpm e2e, applies_when: "changed: src/ui/**, e2e/**" }';
const CI_BUILD = '  - { id: ci-build, station: quality, kind: script, source: ci, blocking: true, timeout: 1m, job: build }';
const SECURITY = '  - { id: security-scan, station: review, kind: script, blocking: true, timeout: 1h, run: pnpm audit }';
const UI_DESIGN = '  - { id: ui-design, station: review, kind: agent, blocking: true, timeout: 10m, criteria: .factory/checks/ui-design.md, evidence: screenshots of changed screens }';
const TONE = '  - { id: tone, station: review, kind: agent, blocking: false, timeout: 5m, criteria: .factory/checks/tone.md, evidence: quotes }';

type World = {
  readonly deps: CheckDeps;
  readonly commands: { command: string; timeoutSeconds: number }[];
  readonly waits: number[];
  readonly asked: { ref: string; job: string }[];
};

const getWorld = (options?: { readonly scripts?: Readonly<Record<string, ScriptRun>>; readonly ci?: readonly CiResult[] }): World => {
  const commands: World['commands'] = [];
  const waits: number[] = [];
  const asked: World['asked'] = [];
  const clock = { seconds: 0 };
  return {
    commands,
    waits,
    asked,
    deps: {
      runScript: async (command, { timeoutSeconds }) => {
        commands.push({ command, timeoutSeconds });
        clock.seconds += 7;
        return options?.scripts?.[command] ?? { exitCode: 0, output: 'ok', timedOut: false };
      },
      ciResult: async (request) => {
        asked.push(request);
        return options?.ci?.[asked.length - 1] ?? 'passed';
      },
      sleep: async (milliseconds) => void waits.push(milliseconds),
      now: () => new Date(Date.UTC(2026, 10, 21, 8, 0, clock.seconds)).toISOString().replace('.000Z', 'Z'),
    },
  };
};

const request = (checks: readonly Check[], changedFiles: readonly string[] = ['src/billing/export.ts']) => ({
  checks,
  station: 'quality',
  changedFiles,
  branch: 'factory/pay-142',
});

describe('script checks', () => {
  it('passes a check whose command exits 0, with how long it took', async () => {
    const world = getWorld();

    const outcomes = await runScriptChecks(world.deps, request(getChecks(UNIT_TESTS)));

    expect(outcomes).toEqual([{ id: 'unit-tests', station: 'quality', status: 'passed', durationSeconds: 7 }]);
    expect(world.commands).toEqual([{ command: 'pnpm test', timeoutSeconds: 360 }]);
    expect(gatePassed(outcomes)).toBe(true);
  });

  it('fails a check whose command exits with anything else, keeping its output as the key error', async () => {
    const world = getWorld({ scripts: { 'pnpm test': { exitCode: 1, output: 'export.test.ts › splits files: expected 2, got 1', timedOut: false } } });

    const outcomes = await runScriptChecks(world.deps, request(getChecks(UNIT_TESTS)));

    expect(outcomes).toEqual([
      { id: 'unit-tests', station: 'quality', status: 'failed', reason: 'exit code 1', detail: 'export.test.ts › splits files: expected 2, got 1', durationSeconds: 7 },
    ]);
    expect(gatePassed(outcomes)).toBe(false);
  });

  it('keeps only the end of a very long output', async () => {
    const output = `${'x'.repeat(5000)}THE END`;
    const world = getWorld({ scripts: { 'pnpm test': { exitCode: 2, output, timedOut: false } } });

    const [outcome] = await runScriptChecks(world.deps, request(getChecks(UNIT_TESTS)));

    expect(outcome?.detail).toHaveLength(2000);
    expect(outcome?.detail?.endsWith('THE END')).toBe(true);
  });

  it('fails a check that runs past its timeout, saying so', async () => {
    const world = getWorld({ scripts: { 'pnpm test': { exitCode: 0, output: 'partial', timedOut: true } } });

    const outcomes = await runScriptChecks(world.deps, request(getChecks(UNIT_TESTS)));

    expect(outcomes).toMatchObject([{ status: 'failed', reason: 'timeout', detail: 'partial' }]);
  });

  it('records a failing advisory check as a warning that does not fail the gate', async () => {
    const world = getWorld({ scripts: { 'pnpm lint': { exitCode: 1, output: '3 problems', timedOut: false } } });

    const outcomes = await runScriptChecks(world.deps, request(getChecks(`${UNIT_TESTS}\n${LINT}`)));

    expect(outcomes.map((outcome) => [outcome.id, outcome.status])).toEqual([['unit-tests', 'passed'], ['lint', 'warning']]);
    expect(outcomes[1]).toMatchObject({ reason: 'exit code 1', detail: '3 problems' });
    expect(world.commands[1]).toEqual({ command: 'pnpm lint', timeoutSeconds: 90 });
    expect(gatePassed(outcomes)).toBe(true);
  });

  it('skips a check when nothing in its scope changed, without running it', async () => {
    const world = getWorld();

    const outcomes = await runScriptChecks(world.deps, request(getChecks(UI_E2E), ['src/billing/export.ts', 'src/uix/a.ts']));

    expect(outcomes).toEqual([{ id: 'ui-e2e', station: 'quality', status: 'skipped', durationSeconds: 0 }]);
    expect(world.commands).toEqual([]);
    expect(gatePassed(outcomes)).toBe(true);
  });

  it('skips a scoped check when only a top-level file changed', async () => {
    const world = getWorld();

    expect(await runScriptChecks(world.deps, request(getChecks(UI_E2E), ['README.md']))).toMatchObject([{ status: 'skipped' }]);
  });

  it('fails the gate when one check failed among others that passed', async () => {
    const world = getWorld({ scripts: { 'pnpm test': { exitCode: 1, output: 'boom', timedOut: false } } });

    const outcomes = await runScriptChecks(world.deps, request(getChecks(`${UNIT_TESTS}\n${UI_E2E}`), ['src/ui/a.tsx']));

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'passed']);
    expect(gatePassed(outcomes)).toBe(false);
  });

  it.each([['src/ui/button.tsx'], ['e2e/login.spec.ts']])('runs a scoped check when %s changed', async (changed) => {
    const world = getWorld();

    const outcomes = await runScriptChecks(world.deps, request(getChecks(UI_E2E), ['README.md', changed]));

    expect(outcomes).toMatchObject([{ id: 'ui-e2e', status: 'passed' }]);
    expect(world.commands).toEqual([{ command: 'pnpm e2e', timeoutSeconds: 600 }]);
  });

  it('runs only the script checks of the station asked for, in the order configured', async () => {
    const world = getWorld();
    const checks = getChecks(`${LINT}\n${SECURITY}\n${UI_DESIGN}\n${UNIT_TESTS}`);

    const quality = await runScriptChecks(world.deps, request(checks));
    const review = await runScriptChecks(world.deps, { ...request(checks), station: 'review' });

    expect(quality.map((outcome) => outcome.id)).toEqual(['lint', 'unit-tests']);
    expect(review.map((outcome) => outcome.id)).toEqual(['security-scan']);
    expect(world.commands.at(-1)).toEqual({ command: 'pnpm audit', timeoutSeconds: 3600 });
  });
});

describe('checks read from CI', () => {
  it('reads the result of the matching CI job for the run\'s branch instead of running anything', async () => {
    const world = getWorld({ ci: ['passed'] });

    const outcomes = await runScriptChecks(world.deps, request(getChecks(CI_BUILD)));

    expect(outcomes).toMatchObject([{ id: 'ci-build', status: 'passed' }]);
    expect(world.asked).toEqual([{ ref: 'factory/pay-142', job: 'build' }]);
    expect(world.commands).toEqual([]);
    expect(world.waits).toEqual([]);
  });

  it('uses the check id as the job name when none is given', async () => {
    const world = getWorld();

    await runScriptChecks(world.deps, request(getChecks('  - { id: ci-lint, station: quality, kind: script, source: ci, blocking: true, timeout: 1m }')));

    expect(world.asked).toEqual([{ ref: 'factory/pay-142', job: 'ci-lint' }]);
  });

  it('reads CI even when the check also names a command', async () => {
    const world = getWorld({ ci: ['failed'] });
    const check = '  - { id: ci-build, station: quality, kind: script, source: ci, blocking: true, timeout: 1m, run: pnpm build }';

    const outcomes = await runScriptChecks(world.deps, request(getChecks(check)));

    expect(outcomes).toMatchObject([{ status: 'failed', reason: 'failed in CI' }]);
    expect(world.commands).toEqual([]);
  });

  it('waits for a job that has not finished, then fails it when CI says it failed', async () => {
    const world = getWorld({ ci: ['missing', 'pending', 'failed'] });

    const outcomes = await runScriptChecks(world.deps, request(getChecks(CI_BUILD)));

    expect(outcomes).toMatchObject([{ id: 'ci-build', status: 'failed', reason: 'failed in CI' }]);
    expect(world.waits).toEqual([15_000, 15_000]);
  });

  it('gives up on a job that is still not finished when the timeout is reached', async () => {
    const world = getWorld({ ci: Array.from({ length: 20 }, () => 'pending' as const) });

    const outcomes = await runScriptChecks(world.deps, request(getChecks(CI_BUILD)));

    expect(outcomes).toMatchObject([{ id: 'ci-build', status: 'failed', reason: 'timeout' }]);
    expect(world.waits).toEqual([15_000, 15_000, 15_000, 15_000]);
    expect(world.asked).toHaveLength(5);
  });
});

describe('agent checks', () => {
  const [uiDesign, tone] = getChecks(`${UI_DESIGN}\n${TONE}`);
  if (uiDesign === undefined || tone === undefined) throw new Error('missing fixture');
  const verdict = (value: unknown): string => JSON.stringify(value);

  it('passes on a structured pass verdict that carries the required evidence', () => {
    const outcome = judgeAgentCheck(uiDesign, verdict({ verdict: 'pass', findings: [], evidence: ['shots/settings.png'] }));

    expect(outcome).toEqual({ id: 'ui-design', station: 'review', status: 'passed', durationSeconds: 0, evidence: ['shots/settings.png'] });
  });

  it('fails on a structured fail verdict, keeping the findings', () => {
    const outcome = judgeAgentCheck(uiDesign, verdict({ verdict: 'fail', findings: ['Button uses the wrong colour', 'Spacing is off'], evidence: ['shots/a.png'] }));

    expect(outcome).toEqual({
      id: 'ui-design',
      station: 'review',
      status: 'failed',
      reason: 'findings',
      detail: 'Button uses the wrong colour\nSpacing is off',
      durationSeconds: 0,
      evidence: ['shots/a.png'],
    });
  });

  it.each([
    ['Looks good to me, nothing blocking.'],
    [verdict({ verdict: 'maybe', findings: [], evidence: [] })],
    [verdict({ verdict: 'pass' })],
    [verdict(['pass'])],
    ['{ not json }'],
    ['{ not closed'],
  ])('fails with "invalid verdict" on %s', (raw) => {
    expect(judgeAgentCheck(uiDesign, raw)).toMatchObject({ status: 'failed', reason: 'invalid verdict' });
  });

  it('fails with "invalid verdict" when no verdict was handed in at all', () => {
    expect(judgeAgentCheck(uiDesign, undefined)).toEqual({ id: 'ui-design', station: 'review', status: 'failed', reason: 'invalid verdict', durationSeconds: 0 });
  });

  it('fails a pass verdict that lacks the evidence the check requires', () => {
    const outcome = judgeAgentCheck(uiDesign, verdict({ verdict: 'pass', findings: [], evidence: [] }));

    expect(outcome).toMatchObject({ status: 'failed', reason: 'missing evidence' });
  });

  it('passes a check that requires no evidence on a pass verdict with none', () => {
    const builtIn = { id: 'reviewer', station: 'review', blocking: true };

    const outcome = judgeAgentCheck(builtIn, verdict({ verdict: 'pass', findings: [], evidence: [] }));

    expect(outcome).toEqual({ id: 'reviewer', station: 'review', status: 'passed', durationSeconds: 0 });
    expect('evidence' in outcome).toBe(false);
  });

  it('records a failing advisory agent check as a warning', () => {
    const outcome = judgeAgentCheck(tone, verdict({ verdict: 'fail', findings: ['Too formal'], evidence: ['"Dear user"'] }));

    expect(outcome).toMatchObject({ id: 'tone', status: 'warning', reason: 'findings', detail: 'Too formal' });
    expect(gatePassed([outcome])).toBe(true);
  });

  it('reads a verdict wrapped in a fenced block or surrounded by prose', () => {
    const raw = `Here is my verdict:\n\n\`\`\`json\n${verdict({ verdict: 'pass', findings: [], evidence: ['shots/a.png'] })}\n\`\`\`\n`;

    expect(judgeAgentCheck(uiDesign, raw).status).toBe('passed');
  });
});
