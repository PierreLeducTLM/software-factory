import { z } from 'zod';
import type { CiResult } from '../adapters/source-control.js';
import type { Check } from '../config/project-config.js';
import { matchesPath } from './paths.js';

export type ScriptRun = { readonly exitCode: number; readonly output: string; readonly timedOut: boolean };

export type CheckDeps = {
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly ciResult: (request: { readonly ref: string; readonly job: string }) => Promise<CiResult>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => string;
};

export type CheckOutcome = {
  readonly id: string;
  readonly station: string;
  readonly status: 'passed' | 'failed' | 'warning' | 'skipped';
  readonly reason?: string;
  readonly detail?: string;
  readonly durationSeconds: number;
  readonly evidence?: readonly string[];
};

export type AgentCheck = {
  readonly id: string;
  readonly station: string;
  readonly blocking: boolean;
  readonly evidence?: string;
};

type ChecksRequest = {
  readonly checks: readonly Check[];
  readonly station: string;
  readonly changedFiles: readonly string[];
  readonly branch: string;
};

type Finding = { readonly reason: string; readonly detail?: string };

const SECONDS_PER = { s: 1, m: 60, h: 3600 } as const;
const CI_POLL_SECONDS = 15;
const DETAIL_LIMIT = 2000;
const SCOPE_PREFIX = 'changed:';

const VerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  findings: z.array(z.string()),
  evidence: z.array(z.string()),
});

const TimeoutSchema = z.tuple([z.string(), z.enum(['s', 'm', 'h'])]);

export const timeoutSecondsOf = (check: Pick<Check, 'timeout'>): number => {
  const [amount, unit] = TimeoutSchema.parse([check.timeout.slice(0, -1), check.timeout.slice(-1)]);
  return Number(amount) * SECONDS_PER[unit];
};

export const inScope = (check: Pick<Check, 'applies_when'>, changedFiles: readonly string[]): boolean => {
  if (check.applies_when === undefined) return true;
  const patterns = check.applies_when.slice(SCOPE_PREFIX.length).split(',').map((pattern) => pattern.trim());
  return changedFiles.some((file) => patterns.some((pattern) => matchesPath(pattern, file)));
};

const secondsBetween = (start: string, end: string): number => Math.round((Date.parse(end) - Date.parse(start)) / 1000);

const settle = (check: Pick<Check, 'id' | 'station' | 'blocking'>, finding: Finding | undefined, durationSeconds: number): CheckOutcome => {
  if (finding === undefined) return { id: check.id, station: check.station, status: 'passed', durationSeconds };
  return { id: check.id, station: check.station, status: check.blocking ? 'failed' : 'warning', ...finding, durationSeconds };
};

const runLocally = async (deps: CheckDeps, check: Check, command: string): Promise<Finding | undefined> => {
  const run = await deps.runScript(command, { timeoutSeconds: timeoutSecondsOf(check) });
  const detail = run.output.slice(-DETAIL_LIMIT);
  if (run.timedOut) return { reason: 'timeout', detail };
  return run.exitCode === 0 ? undefined : { reason: `exit code ${run.exitCode}`, detail };
};

const readFromCi = async (deps: CheckDeps, check: Check, branch: string, waitedSeconds = 0): Promise<Finding | undefined> => {
  const result = await deps.ciResult({ ref: branch, job: check.job ?? check.id });
  if (result === 'passed') return undefined;
  if (result === 'failed') return { reason: 'failed in CI' };
  if (waitedSeconds >= timeoutSecondsOf(check)) return { reason: 'timeout' };
  await deps.sleep(CI_POLL_SECONDS * 1000);
  return readFromCi(deps, check, branch, waitedSeconds + CI_POLL_SECONDS);
};

const runOne = async (deps: CheckDeps, check: Check, { changedFiles, branch }: ChecksRequest): Promise<CheckOutcome> => {
  if (!inScope(check, changedFiles)) return { id: check.id, station: check.station, status: 'skipped', durationSeconds: 0 };
  const startedAt = deps.now();
  const finding = check.kind === 'script' && check.source === 'local' && check.run !== undefined ? await runLocally(deps, check, check.run) : await readFromCi(deps, check, branch);
  return settle(check, finding, secondsBetween(startedAt, deps.now()));
};

export const runScriptChecks = async (deps: CheckDeps, request: ChecksRequest): Promise<readonly CheckOutcome[]> =>
  request.checks
    .filter((check) => check.kind === 'script' && check.station === request.station)
    .reduce<Promise<readonly CheckOutcome[]>>(async (previous, check) => [...(await previous), await runOne(deps, check, request)], Promise.resolve([]));

const parseVerdict = (raw: string | undefined): z.infer<typeof VerdictSchema> | undefined => {
  const json = raw === undefined ? undefined : /\{[\s\S]*\}/.exec(raw)?.[0];
  if (json === undefined) return undefined;
  try {
    const parsed = VerdictSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export const judgeAgentCheck = (check: AgentCheck, raw: string | undefined): CheckOutcome => {
  const verdict = parseVerdict(raw);
  if (verdict === undefined) return settle(check, { reason: 'invalid verdict' }, 0);
  const evidence = verdict.evidence.length === 0 ? {} : { evidence: verdict.evidence };
  if (verdict.verdict === 'fail') return { ...settle(check, { reason: 'findings', detail: verdict.findings.join('\n') }, 0), ...evidence };
  if (check.evidence !== undefined && verdict.evidence.length === 0) return settle(check, { reason: 'missing evidence' }, 0);
  return { ...settle(check, undefined, 0), ...evidence };
};

export const gatePassed = (outcomes: readonly CheckOutcome[]): boolean => outcomes.every((outcome) => outcome.status !== 'failed');
