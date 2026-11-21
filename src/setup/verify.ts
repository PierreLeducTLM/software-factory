import type { ScriptRun } from '../factory/checks.js';
import type { Candidate, Category } from './detect.js';

export type Verification = {
  readonly id: string;
  readonly category: Category;
  readonly status: 'pass' | 'fail' | 'flaky' | 'not_run';
  readonly durationSeconds: number;
  readonly timeout: string;
  readonly detail?: string;
};

type VerifyDeps = {
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly now: () => string;
};

const RUN_LIMIT_SECONDS = 1800;
const SAFETY_MARGIN = 1.5;
const SHORTEST_TIMEOUT_SECONDS = 30;
const DEFAULT_CI_TIMEOUT = '15m';
const DETAIL_LIMIT = 500;

export const timeoutFor = (measuredSeconds: number): string => {
  const seconds = Math.max(measuredSeconds * SAFETY_MARGIN, SHORTEST_TIMEOUT_SECONDS);
  return seconds <= 60 ? `${Math.ceil(seconds / 10) * 10}s` : `${Math.ceil(seconds / 60)}m`;
};

const timed = async ({ runScript, now }: VerifyDeps, command: string): Promise<{ readonly passed: boolean; readonly seconds: number; readonly output: string }> => {
  const startedAt = Date.parse(now());
  const run = await runScript(command, { timeoutSeconds: RUN_LIMIT_SECONDS });
  return { passed: run.exitCode === 0 && !run.timedOut, seconds: Math.round((Date.parse(now()) - startedAt) / 1000), output: run.output };
};

const verifyOne = async (deps: VerifyDeps, { id, category, run }: Candidate): Promise<Verification> => {
  if (run === undefined) return { id, category, status: 'not_run', durationSeconds: 0, timeout: DEFAULT_CI_TIMEOUT };
  const first = await timed(deps, run);
  if (first.passed) return { id, category, status: 'pass', durationSeconds: first.seconds, timeout: timeoutFor(first.seconds) };
  const second = await timed(deps, run);
  const slowest = Math.max(first.seconds, second.seconds);
  return { id, category, status: second.passed ? 'flaky' : 'fail', durationSeconds: slowest, timeout: timeoutFor(slowest), detail: first.output.slice(-DETAIL_LIMIT) };
};

export const verifyChecks = (deps: VerifyDeps, candidates: readonly Candidate[]): Promise<readonly Verification[]> =>
  candidates.reduce<Promise<readonly Verification[]>>(async (previous, candidate) => [...(await previous), await verifyOne(deps, candidate)], Promise.resolve([]));
