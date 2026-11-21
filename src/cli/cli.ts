import {
  approvalPreview,
  approve,
  revalidate,
  runReadyGate,
  startRefinement,
  type ApprovalResult,
  type GateResult,
  type RefinementDeps,
} from '../factory/refinement.js';
import { nextTicket, runTicket, type RunResult } from '../factory/run-lifecycle.js';

type CliOptions = {
  readonly argv: readonly string[];
  readonly deps: () => Promise<RefinementDeps>;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
};

type Outcome = { readonly result: { readonly ok: boolean }; readonly lines: readonly string[]; readonly succeeded: boolean };

type Command = (deps: RefinementDeps) => Promise<Outcome>;

const USAGE = 'Usage: factory <refine|ready-gate|approve|revalidate|run> <KEY> [options], or factory next';
const OK = 0;
const REFUSED = 1;
const USAGE_ERROR = 2;

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

const parse = (argv: readonly string[]): Command | undefined => {
  const [name, ...rest] = argv;
  const ceilingAt = rest.indexOf('--ceiling');
  const ceiling = ceilingAt === -1 ? undefined : rest[ceilingAt + 1];
  const [key] = rest.filter((argument, index) => !argument.startsWith('--') && (ceilingAt === -1 || index !== ceilingAt + 1));
  const has = (flag: string): boolean => rest.includes(flag);

  if (name === 'next') return async (deps) => runOutcome(await nextTicket(deps));
  if (key === undefined) return undefined;
  if (name === 'refine') return async (deps) => outcome(await startRefinement(deps, key), [`Refinement started on ${key}`]);
  if (name === 'ready-gate') return async (deps) => gateOutcome(await runReadyGate(deps, key), 'Ready gate passed', 'Ready gate failed');
  if (name === 'revalidate') return async (deps) => gateOutcome(await revalidate(deps, key), 'No drift since approval', 'Sent back to refinement');
  if (name === 'run') {
    return async (deps) => runOutcome(await runTicket(deps, key, { confirmTakeover: has('--confirm-takeover'), acceptEditedRecord: has('--accept-edited-record') }));
  }
  if (name !== 'approve') return undefined;
  if (has('--preview')) return async (deps) => approvalOutcome(await approvalPreview(deps, key), '');
  if (ceilingAt === -1) return async (deps) => approvalOutcome(await approve(deps, key), 'Approved. ');
  if (ceiling === 'human') return async (deps) => approvalOutcome(await approve(deps, key, { mergeCeiling: 'human' }), 'Approved. ');
  return undefined;
};

export const runCli = async ({ argv, deps, write, writeError }: CliOptions): Promise<number> => {
  const json = argv.includes('--json');
  const command = parse(argv);
  if (command === undefined) {
    writeError(USAGE);
    return USAGE_ERROR;
  }

  const built = await deps().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }),
  );
  if (!built.ok) {
    writeError(built.message);
    return USAGE_ERROR;
  }

  const outcome = await command(built.value);
  if (json) {
    write(JSON.stringify(outcome.result));
  } else if ('message' in outcome.result && typeof outcome.result.message === 'string') {
    writeError(outcome.result.message);
  } else {
    outcome.lines.forEach(write);
  }
  return outcome.succeeded ? OK : REFUSED;
};
