import {
  approvalPreview,
  approve,
  pullSpecFiles,
  pushSpecFiles,
  refinementStatus,
  revalidate,
  runReadyGate,
  startRefinement,
  type ApprovalResult,
  type GateResult,
  type StatusResult,
} from '../factory/refinement.js';
import { advance, type AdvanceInput, type AdvanceResult, type LoopDeps } from '../factory/build-loop.js';
import { recordMerge, revertMerge, watchRun, type RecordMergeResult, type RevertResult, type WatchResult } from '../factory/merge.js';
import { nextTicket, runTicket, type RunResult } from '../factory/run-lifecycle.js';
import type { SpecFolder } from './inputs.js';

type CliOptions = {
  readonly argv: readonly string[];
  readonly deps: () => Promise<LoopDeps>;
  readonly folder: SpecFolder;
  readonly readFile: (path: string) => Promise<string>;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
};

type Outcome = { readonly result: { readonly ok: boolean }; readonly lines: readonly string[]; readonly succeeded: boolean };

type Command = (deps: LoopDeps, folder: SpecFolder, readFile: CliOptions['readFile']) => Promise<Outcome>;

const USAGE = [
  'Usage: factory <command> <KEY> [options]',
  '  refine <KEY>                    start refinement',
  '  status <KEY>                    show the ready gate, approval and open questions',
  '  pull <KEY> --to <folder>        write the attached spec files to a folder',
  '  push <KEY> --from <folder>      attach the spec files that changed',
  '  ready-gate <KEY>                run the ready gate',
  '  approve <KEY> [--preview] [--ceiling human]',
  '  run <KEY> [--confirm-takeover] [--accept-edited-record] [--confirm-retry] [--over-limit]',
  '  advance <KEY> [--changed <text>] [--decision <id>] [--question <text> --recommended <text>]',
  '                [--verdict <id>=<file>] [--diagnosis code|spec|environment] [--next-step <text>]',
  '  revalidate <KEY>                check the spec and main for drift',
  '  next                            claim the next eligible ticket',
  '  view [--sample] [--port <n>]    open the read-only dashboard',
  'Setting the project up:',
  '  doctor [--run-checks] [--ticket <KEY>]   check the setup for drift',
  '  migrate                         open a pull request that moves the project to this engine',
  '  init detect|statuses|install|pull-request   the install wizard steps (see factory init)',
  '  workflow --title <text> [--preview]          propose a change to the factory workflow',
  'In CI, with the service account:',
  '  record-merge [--commit <sha>] [--pull-request <n>]   on every merge to main',
  '  revert [--commit <sha>] [--pull-request <n>]         when main fails after an auto-merge',
  '  watch [--commit <sha>] [--pull-request <n>]          after a deploy to staging',
  'Add --json to any command for one line of JSON.',
];

const OK = 0;
const REFUSED = 1;
const USAGE_ERROR = 2;
const CI_COMMANDS = ['record-merge', 'revert', 'watch'];
const SKIPPED = 'The factory step was skipped. The build is not affected.';
const VALUED = ['--commit', '--pull-request', '--ceiling', '--to', '--from', '--changed', '--decision', '--question', '--recommended', '--verdict', '--diagnosis', '--next-step'];
const DIAGNOSES = ['code', 'spec', 'environment'] as const;

const outcome = (result: { readonly ok: boolean }, lines: readonly string[], succeeded: boolean = result.ok): Outcome => ({ result, lines, succeeded });

const gateOutcome = (result: GateResult, passed: string, failed: string): Outcome => {
  if (!result.ok) return outcome(result, []);
  return outcome(result, result.passed ? [passed] : [failed, ...result.findings.map((finding) => `- ${finding}`)], result.passed);
};

const runOutcome = (result: RunResult): Outcome =>
  outcome(
    result,
    result.ok ? [`${result.action === 'started' ? 'Started' : 'Resumed'} run ${result.run} of ${result.key} at attempt ${result.attempt}. Next step: ${result.step}`] : [],
  );

const approvalOutcome = (result: ApprovalResult, prefix: string): Outcome => outcome(result, result.ok ? [`${prefix}${result.route}`] : []);

const gateLine = (gate: Extract<StatusResult, { ok: true }>['gate']): string => {
  if (gate === undefined) return 'Ready gate: not run';
  return `Ready gate: ${gate.passed ? 'passed' : 'failed'}${gate.current ? '' : ' (out of date: the spec changed since)'}`;
};

const statusOutcome = (result: StatusResult): Outcome => {
  if (!result.ok) return outcome(result, []);
  const { approval } = result;
  return outcome(result, [
    `Status: ${result.status}`,
    gateLine(result.gate),
    ...(result.gate?.findings ?? []).map((finding) => `- ${finding}`),
    approval === undefined ? 'Approval: none' : `Approval: by ${approval.approver} at ${approval.at}, ${approval.predictedRisk} risk`,
    ...result.questions.flatMap(({ question, recommended }) => [`Question: ${question}`, `  Recommended: ${recommended}`]),
  ]);
};

const failureLines = (failures: readonly { readonly id: string; readonly station: string; readonly reason?: string | undefined; readonly detail?: string | undefined }[]): readonly string[] =>
  failures.flatMap((failure) => [`- ${failure.id} (${failure.station}): ${String(failure.reason)}`, ...(failure.detail === undefined ? [] : [`  ${failure.detail.split('\n', 1).join('')}`])]);

const advanceOutcome = (result: AdvanceResult): Outcome => {
  if (!result.ok) return outcome(result, []);
  if (result.next === 'build') return outcome(result, [`Next: build (attempt ${result.attempt})`, ...failureLines(result.feedback)]);
  if (result.next === 'verify') return outcome(result, [`Next: verify (attempt ${result.attempt}). Hand in the verdict of openspec-verify`]);
  if (result.next === 'review') return outcome(result, [`Next: review (attempt ${result.attempt}). Hand in a verdict for: ${result.checks.map((check) => check.id).join(', ')}`]);
  if (result.next === 'diagnose') {
    return outcome(result, ['Next: diagnose. Every attempt failed:', ...result.attempts.flatMap((attempt) => [`Attempt ${attempt.number}: ${attempt.changed}`, ...failureLines(attempt.failures)])]);
  }
  if (result.exit === 'pull_request') return outcome(result, [`Pull request opened: ${result.url}`]);
  if (result.exit === 'blocked') return outcome(result, [`Blocked. Failure report: ${result.report}`], false);
  return outcome(result, ['Sent back to refinement', ...result.findings.map((finding) => `- ${finding}`)], false);
};

const mergeOutcome = (result: RecordMergeResult): Outcome => {
  const { merged, reverted } = result;
  return outcome(result, [
    ...(merged === undefined ? [] : [`Recorded the merge of ${merged.key} by ${merged.by} (${merged.asIs ? 'merged as is' : 'changed by a human'})`]),
    ...(reverted === undefined ? [] : [`Recorded the revert of ${reverted.key} by ${reverted.by}`]),
    ...(merged === undefined && reverted === undefined ? ['Nothing to record'] : []),
  ]);
};

const revertOutcome = (result: RevertResult): Outcome => {
  if (result.action === 'none') return outcome(result, ['Nothing to revert']);
  if (result.action === 'opened') return outcome(result, [`Revert opened for ${result.key}: ${result.url}`]);
  return outcome(result, [`Revert needed for ${result.key}. Revert this pull request by hand: ${result.url}`]);
};

const watchOutcome = (result: WatchResult): Outcome => {
  if (result.action === 'off') return outcome(result, ['The watch is off']);
  if (result.action === 'none') return outcome(result, ['Nothing to watch']);
  if (result.action === 'delivered') return outcome(result, [`${result.key} delivered: the staging watch passed`]);
  const revert = result.revert === 'opened' ? `Revert opened: ${result.url}` : `Revert this pull request by hand: ${result.url}`;
  return outcome(result, [`The staging watch failed for ${result.key} on ${result.check}. ${revert}`], false);
};

const parse = (argv: readonly string[]): Command | undefined => {
  const [name, ...rest] = argv;
  const valuesOf = (flag: string): readonly string[] => rest.flatMap((argument, index) => (argument === flag ? [rest[index + 1] ?? ''] : []));
  const valueOf = (flag: string): string | undefined => valuesOf(flag)[0];
  const isValue = (index: number): boolean => VALUED.includes(rest[index - 1] ?? '');
  const [key] = rest.filter((argument, index) => !argument.startsWith('--') && !isValue(index));
  const has = (flag: string): boolean => rest.includes(flag);
  const to = valueOf('--to');
  const from = valueOf('--from');

  if (name === 'next') return async (deps) => runOutcome(await nextTicket(deps));
  if (CI_COMMANDS.includes(name ?? '')) {
    const given = valueOf('--pull-request');
    if (given !== undefined && !/^\d+$/.test(given)) return undefined;
    const change = { commit: valueOf('--commit') ?? 'HEAD', ...(given === undefined ? {} : { pullRequest: Number(given) }) };
    if (name === 'record-merge') return async (deps) => mergeOutcome(await recordMerge(deps, change));
    if (name === 'revert') return async (deps) => revertOutcome(await revertMerge(deps, change));
    return async (deps) => watchOutcome(await watchRun(deps, change));
  }
  if (key === undefined) return undefined;
  if (name === 'refine') return async (deps) => outcome(await startRefinement(deps, key), [`Refinement started on ${key}`]);
  if (name === 'status') return async (deps) => statusOutcome(await refinementStatus(deps, key));
  if (name === 'ready-gate') return async (deps) => gateOutcome(await runReadyGate(deps, key), 'Ready gate passed', 'Ready gate failed');
  if (name === 'revalidate') return async (deps) => gateOutcome(await revalidate(deps, key), 'No drift since approval', 'Sent back to refinement');
  if (name === 'run') {
    return async (deps) =>
      runOutcome(
        await runTicket(deps, key, {
          confirmTakeover: has('--confirm-takeover'),
          acceptEditedRecord: has('--accept-edited-record'),
          confirmRetry: has('--confirm-retry'),
          overLimit: has('--over-limit'),
        }),
      );
  }
  if (name === 'advance') {
    const kind = DIAGNOSES.find((candidate) => candidate === valueOf('--diagnosis'));
    const recommended = valuesOf('--recommended');
    const questions = valuesOf('--question').map((question, index) => ({ question, recommended: recommended[index] ?? '' }));
    const verdictFiles = valuesOf('--verdict').map((pair) => ({ id: pair.slice(0, Math.max(pair.indexOf('='), 0)), path: pair.slice(pair.indexOf('=') + 1) }));
    const changed = valueOf('--changed');
    const nextStep = valueOf('--next-step');
    const [question] = questions;
    if (has('--diagnosis') && kind === undefined) return undefined;
    if (verdictFiles.some(({ id, path }) => id === '' || path === '') || questions.some((asked) => asked.recommended === '')) return undefined;
    return async (deps, _folder, readFile) => {
      const verdicts = Object.fromEntries(await Promise.all(verdictFiles.map(async ({ id, path }) => [id, await readFile(path)] as const)));
      const input: AdvanceInput = {
        ...(changed === undefined ? {} : { built: { changed, decisions: valuesOf('--decision') } }),
        ...(kind === undefined && question !== undefined ? { question } : {}),
        ...(verdictFiles.length === 0 ? {} : { verdicts }),
        ...(kind === undefined ? {} : { diagnosis: { kind, questions, ...(nextStep === undefined ? {} : { nextStep }) } }),
      };
      return advanceOutcome(await advance(deps, key, input));
    };
  }
  if (name === 'pull' && to !== undefined) {
    return async (deps, folder) => {
      const pulled = await pullSpecFiles(deps, key);
      if (pulled.ok) await folder.write(to, pulled.files);
      return outcome(pulled, pulled.ok ? [`Wrote ${pulled.files.length} spec files to ${to}`] : []);
    };
  }
  if (name === 'push' && from !== undefined) {
    return async (deps, folder) => {
      const pushed = await pushSpecFiles(deps, key, await folder.read(from));
      if (!pushed.ok) return outcome(pushed, []);
      return outcome(pushed, [pushed.attached.length === 0 ? 'Nothing changed' : `Attached ${pushed.attached.length} spec files to ${key}: ${pushed.attached.join(', ')}`]);
    };
  }
  if (name !== 'approve') return undefined;
  if (has('--preview')) return async (deps) => approvalOutcome(await approvalPreview(deps, key), '');
  if (!has('--ceiling')) return async (deps) => approvalOutcome(await approve(deps, key), 'Approved. ');
  if (valueOf('--ceiling') === 'human') return async (deps) => approvalOutcome(await approve(deps, key, { mergeCeiling: 'human' }), 'Approved. ');
  return undefined;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const runCli = async ({ argv, deps, folder, readFile, write, writeError }: CliOptions): Promise<number> => {
  const command = parse(argv);
  if (command === undefined) {
    USAGE.forEach(writeError);
    return USAGE_ERROR;
  }

  const built = await deps().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, message: messageOf(error) }),
  );
  const inCi = CI_COMMANDS.some((name) => name === argv[0]);
  if (!built.ok) {
    writeError(built.message);
    if (inCi) writeError(SKIPPED);
    return inCi ? OK : USAGE_ERROR;
  }

  const ran = await command(built.value, folder, readFile).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, message: messageOf(error) }),
  );
  if (!ran.ok) {
    writeError(ran.message);
    if (inCi) writeError(SKIPPED);
    return inCi ? OK : REFUSED;
  }

  const { result, lines, succeeded } = ran.value;
  if (argv.includes('--json')) {
    write(JSON.stringify(result));
  } else if ('message' in result && typeof result.message === 'string') {
    writeError(result.message);
  } else {
    lines.forEach(write);
  }
  return succeeded ? OK : REFUSED;
};
