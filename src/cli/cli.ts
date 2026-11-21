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
  type RefinementDeps,
  type StatusResult,
} from '../factory/refinement.js';
import { nextTicket, runTicket, type RunResult } from '../factory/run-lifecycle.js';
import type { SpecFolder } from './inputs.js';

type CliOptions = {
  readonly argv: readonly string[];
  readonly deps: () => Promise<RefinementDeps>;
  readonly folder: SpecFolder;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
};

type Outcome = { readonly result: { readonly ok: boolean }; readonly lines: readonly string[]; readonly succeeded: boolean };

type Command = (deps: RefinementDeps, folder: SpecFolder) => Promise<Outcome>;

const USAGE = [
  'Usage: factory <command> <KEY> [options]',
  '  refine <KEY>                    start refinement',
  '  status <KEY>                    show the ready gate, approval and open questions',
  '  pull <KEY> --to <folder>        write the attached spec files to a folder',
  '  push <KEY> --from <folder>      attach the spec files that changed',
  '  ready-gate <KEY>                run the ready gate',
  '  approve <KEY> [--preview] [--ceiling human]',
  '  run <KEY> [--confirm-takeover] [--accept-edited-record]',
  '  revalidate <KEY>                check the spec and main for drift',
  '  next                            claim the next eligible ticket',
  'Add --json to any command for one line of JSON.',
];

const OK = 0;
const REFUSED = 1;
const USAGE_ERROR = 2;
const VALUED = ['--ceiling', '--to', '--from'];

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

const parse = (argv: readonly string[]): Command | undefined => {
  const [name, ...rest] = argv;
  const valueOf = (flag: string): string | undefined => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined);
  const isValue = (index: number): boolean => VALUED.includes(rest[index - 1] ?? '');
  const [key] = rest.filter((argument, index) => !argument.startsWith('--') && !isValue(index));
  const has = (flag: string): boolean => rest.includes(flag);
  const to = valueOf('--to');
  const from = valueOf('--from');

  if (name === 'next') return async (deps) => runOutcome(await nextTicket(deps));
  if (key === undefined) return undefined;
  if (name === 'refine') return async (deps) => outcome(await startRefinement(deps, key), [`Refinement started on ${key}`]);
  if (name === 'status') return async (deps) => statusOutcome(await refinementStatus(deps, key));
  if (name === 'ready-gate') return async (deps) => gateOutcome(await runReadyGate(deps, key), 'Ready gate passed', 'Ready gate failed');
  if (name === 'revalidate') return async (deps) => gateOutcome(await revalidate(deps, key), 'No drift since approval', 'Sent back to refinement');
  if (name === 'run') {
    return async (deps) => runOutcome(await runTicket(deps, key, { confirmTakeover: has('--confirm-takeover'), acceptEditedRecord: has('--accept-edited-record') }));
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

export const runCli = async ({ argv, deps, folder, write, writeError }: CliOptions): Promise<number> => {
  const command = parse(argv);
  if (command === undefined) {
    USAGE.forEach(writeError);
    return USAGE_ERROR;
  }

  const built = await deps().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, message: messageOf(error) }),
  );
  if (!built.ok) {
    writeError(built.message);
    return USAGE_ERROR;
  }

  const ran = await command(built.value, folder).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, message: messageOf(error) }),
  );
  if (!ran.ok) {
    writeError(ran.message);
    return REFUSED;
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
