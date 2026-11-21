import type { Check, FactoryConfig } from '../config/project-config.js';
import { timeoutSecondsOf, type ScriptRun } from '../factory/checks.js';

export type CheckDiff = { readonly added: readonly Check[]; readonly changed: readonly Check[]; readonly removed: readonly string[] };

export type Trial = { readonly id: string; readonly blocking: boolean; readonly status: 'pass' | 'fail' | 'in_ci' | 'agent'; readonly detail?: string };

export type TrialReport = { readonly ok: boolean; readonly trials: readonly Trial[] };

const FIRST_STATIONS = ['quality', 'review'];
const DETAIL_LIMIT = 500;

const describeCheck = (check: Check): string => {
  const what = check.kind === 'agent' ? `agent, rubric ${check.criteria}` : check.source === 'ci' ? `CI job ${check.job ?? check.id}` : String(check.run);
  const scope = check.applies_when === undefined ? '' : `, when ${check.applies_when}`;
  return `  - ${check.id}: ${check.blocking ? 'blocking' : 'advisory'}, ${what}, timeout ${check.timeout}${scope}`;
};

export const describePipeline = (config: FactoryConfig): readonly string[] => {
  const stations = [...new Set([...FIRST_STATIONS, ...config.checks.map((check) => check.station)])];
  return [
    'build',
    ...stations.flatMap((station) => [
      station,
      ...(station === 'review' ? ['  - openspec-verify: blocking, built in', '  - reviewer: blocking, built in'] : []),
      ...config.checks.filter((check) => check.station === station).map(describeCheck),
    ]),
    'pull request',
  ];
};

export const diffChecks = (before: FactoryConfig | undefined, after: FactoryConfig): CheckDiff => {
  const earlier = before?.checks ?? [];
  const same = (check: Check): boolean => earlier.some((other) => JSON.stringify(other) === JSON.stringify(check));
  const known = (check: Check): boolean => earlier.some((other) => other.id === check.id);
  return {
    added: after.checks.filter((check) => !known(check)),
    changed: after.checks.filter((check) => known(check) && !same(check)),
    removed: earlier.filter((check) => !after.checks.some((other) => other.id === check.id)).map((check) => check.id),
  };
};

type TrialDeps = { readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun> };

const tryOne = async ({ runScript }: TrialDeps, check: Check): Promise<Trial> => {
  const { id, blocking } = check;
  if (check.kind === 'agent') return { id, blocking, status: 'agent', detail: check.criteria };
  if (check.source === 'ci' || check.run === undefined) return { id, blocking, status: 'in_ci' };
  const run = await runScript(check.run, { timeoutSeconds: timeoutSecondsOf(check) });
  if (run.exitCode === 0 && !run.timedOut) return { id, blocking, status: 'pass' };
  return { id, blocking, status: 'fail', detail: run.timedOut ? `timed out after ${check.timeout}` : run.output.slice(-DETAIL_LIMIT) };
};

export const tryChecks = async (deps: TrialDeps, checks: readonly Check[]): Promise<TrialReport> => {
  const trials = await checks.reduce<Promise<readonly Trial[]>>(async (previous, check) => [...(await previous), await tryOne(deps, check)], Promise.resolve([]));
  return { ok: trials.every((trial) => trial.status !== 'fail' || !trial.blocking), trials };
};
