import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFactoryConfig, type FactoryConfig } from '../src/config/project-config.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { migrateConfig, type Migration } from '../src/setup/migrate.js';
import { describePipeline, diffChecks, tryChecks } from '../src/setup/pipeline.js';
import { ENGINE_VERSION, enginePinMatches, enginePinMessage } from '../src/version.js';

const BASE_CHECKS = [
  '  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm test }',
  '  - { id: lint, station: quality, kind: script, blocking: false, timeout: 90s, run: pnpm lint }',
];

const yamlWith = (checks: readonly string[] = BASE_CHECKS, schema = 1): string => `
schema: ${schema}
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks:${checks.length === 0 ? ' []' : `\n${checks.join('\n')}`}
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`;

const getConfig = (checks: readonly string[] = BASE_CHECKS): FactoryConfig => {
  const parsed = parseFactoryConfig(yamlWith(checks));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const SECURITY = '  - { id: security-scan, station: review, kind: script, source: ci, blocking: true, timeout: 5m, job: Security scan }';
const UI = '  - { id: ui-design, station: review, kind: agent, blocking: true, timeout: 10m, applies_when: "changed: src/ui/**", criteria: .factory/checks/ui-design.md, evidence: screenshots }';
const DEPLOY = '  - { id: smoke, station: staging, kind: script, source: ci, blocking: false, timeout: 5m }';

describe('showing a pipeline', () => {
  it('lists every station in order, with the built-in checks and the project ones', () => {
    expect(describePipeline(getConfig([...BASE_CHECKS, SECURITY, UI, DEPLOY]))).toEqual([
      'build',
      'quality',
      '  - unit-tests: blocking, pnpm test, timeout 6m',
      '  - lint: advisory, pnpm lint, timeout 90s',
      'review',
      '  - openspec-verify: blocking, built in',
      '  - reviewer: blocking, built in',
      '  - security-scan: blocking, CI job Security scan, timeout 5m',
      '  - ui-design: blocking, agent, rubric .factory/checks/ui-design.md, timeout 10m, when changed: src/ui/**',
      'staging',
      '  - smoke: advisory, CI job smoke, timeout 5m',
      'pull request',
    ]);
    expect(describePipeline(getConfig([]))).toEqual(['build', 'quality', 'review', '  - openspec-verify: blocking, built in', '  - reviewer: blocking, built in', 'pull request']);
  });

  it('says which checks were added, changed and removed since main', () => {
    const before = getConfig();
    const after = getConfig(['  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 8m, run: pnpm test }', SECURITY]);

    const diff = diffChecks(before, after);

    expect(diff.added.map((check) => check.id)).toEqual(['security-scan']);
    expect(diff.changed.map((check) => [check.id, check.timeout])).toEqual([['unit-tests', '8m']]);
    expect(diff.removed).toEqual(['lint']);
    expect(diffChecks(before, before)).toEqual({ added: [], changed: [], removed: [] });
    expect(diffChecks(undefined, before).added.map((check) => check.id)).toEqual(['unit-tests', 'lint']);
  });
});

describe('trying new checks on main', () => {
  const getRunner = (runs: Readonly<Record<string, ScriptRun>>) => {
    const calls: { command: string; timeoutSeconds: number }[] = [];
    return {
      calls,
      runScript: async (command: string, { timeoutSeconds }: { readonly timeoutSeconds: number }): Promise<ScriptRun> => {
        calls.push({ command, timeoutSeconds });
        return runs[command] ?? { exitCode: 0, output: 'ok', timedOut: false };
      },
    };
  };

  it('runs each local check with its own timeout, and leaves CI and agent checks to others', async () => {
    const runner = getRunner({});

    const report = await tryChecks(runner, getConfig([...BASE_CHECKS, SECURITY, UI]).checks);

    expect(report).toEqual({
      ok: true,
      trials: [
        { id: 'unit-tests', blocking: true, status: 'pass' },
        { id: 'lint', blocking: false, status: 'pass' },
        { id: 'security-scan', blocking: true, status: 'in_ci' },
        { id: 'ui-design', blocking: true, status: 'agent', detail: '.factory/checks/ui-design.md' },
      ],
    });
    expect(runner.calls).toEqual([{ command: 'pnpm test', timeoutSeconds: 360 }, { command: 'pnpm lint', timeoutSeconds: 90 }]);
  });

  it('stops the change when a new blocking check fails on main, with the end of its output', async () => {
    const runner = getRunner({ 'pnpm test': { exitCode: 1, output: `${'x'.repeat(600)}2 tests failed`, timedOut: false } });

    const report = await tryChecks(runner, getConfig().checks);

    expect(report.ok).toBe(false);
    expect(report.trials[0]).toEqual({ id: 'unit-tests', blocking: true, status: 'fail', detail: `${'x'.repeat(486)}2 tests failed` });
  });

  it('lets an advisory check fail, and reports a timeout as a failure', async () => {
    const runner = getRunner({ 'pnpm lint': { exitCode: 0, output: 'slow', timedOut: true } });

    const report = await tryChecks(runner, getConfig().checks);

    expect(report.ok).toBe(true);
    expect(report.trials[1]).toEqual({ id: 'lint', blocking: false, status: 'fail', detail: 'timed out after 90s' });
  });

  it('has nothing to try when no check changed', async () => {
    expect(await tryChecks(getRunner({}), [])).toEqual({ ok: true, trials: [] });
  });
});

describe('migrating the config schema', () => {
  const toV2: Migration = { from: 1, summary: 'Rename labels.auto to labels.eligible', apply: ({ labels, ...rest }) => ({ ...rest, labels: { eligible: 'factory-auto', kept: labels !== undefined } }) };
  const toV3: Migration = { from: 2, summary: 'Add limits.minutes', apply: (config) => ({ ...config, limits: { minutes: 90 } }) };

  it('leaves a config on the current schema untouched', () => {
    const text = yamlWith();

    expect(migrateConfig(text)).toEqual({ ok: true, from: 1, to: 1, applied: [], text });
  });

  it('rewrites the config through every migration up to the engine schema', () => {
    const result = migrateConfig(yamlWith(), { migrations: [toV3, toV2], target: 3 });

    expect(result).toMatchObject({ ok: true, from: 1, to: 3, applied: ['Rename labels.auto to labels.eligible', 'Add limits.minutes'] });
    expect(result.ok && result.text).toContain('schema: 3\n');
    expect(result.ok && result.text).toContain('labels:\n  eligible: factory-auto\n  kept: true\n');
    expect(result.ok && result.text).toContain('limits:\n  minutes: 90\n');
    expect(result.ok && result.text).toContain('engine: 0.1.0\n');
  });

  it('explains why it cannot migrate', () => {
    expect(migrateConfig(yamlWith(BASE_CHECKS, 3))).toEqual({ ok: false, message: 'factory.yaml uses schema 3, newer than this engine understands (1). Upgrade the engine.' });
    expect(migrateConfig(yamlWith(), { migrations: [toV2], target: 3 })).toEqual({ ok: false, message: 'No migration leads from schema 1 to schema 3' });
    expect(migrateConfig('engine: 0.1.0\n')).toEqual({ ok: false, message: 'factory.yaml has no schema number' });
    expect(migrateConfig('schema: 0\n')).toEqual({ ok: false, message: 'factory.yaml has no schema number' });
  });
});

describe('the engine a project pins', () => {
  it('is the version of the package', () => {
    expect(ENGINE_VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  });

  it.each([
    ['0.1.0', '0.1.0', true],
    ['0.1.0', '0.1.7', true],
    ['0.1.0', '0.2.0', false],
    ['1.1.0', '0.1.0', false],
  ])('pinned %s against engine %s matches: %s', (pinned, running, matches) => {
    expect(enginePinMatches(pinned, running)).toBe(matches);
  });

  it('accepts the running engine by default, and says how to fix a mismatch', () => {
    expect(enginePinMatches(ENGINE_VERSION)).toBe(true);
    expect(enginePinMessage('0.3.0', '0.1.0')).toBe('This project pins factory engine 0.3.0 in .factory/factory.yaml, and this is engine 0.1.0. Install engine 0.3.0, or upgrade the project with /factory-doctor.');
    expect(enginePinMessage('0.3.0')).toContain(`this is engine ${ENGINE_VERSION}`);
  });
});
