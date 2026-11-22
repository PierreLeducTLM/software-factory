import { runDoctor, type DoctorDeps, type DoctorReport } from '../setup/doctor.js';
import { detectForInit, installFactory, matchProjectStatuses, openCheckPullRequest, type InitDeps, type InitDetection, type InstallResult } from '../setup/init.js';
import { parseConnection, parseInstallAnswers } from '../setup/install.js';
import type { StatusMatch } from '../setup/match-statuses.js';
import { upgradeProject, type UpgradeDeps, type UpgradeResult } from '../setup/upgrade.js';
import { changeLines, proposeWorkflowChange, type Proposal, type WorkflowDeps, type WorkflowResult } from '../setup/workflow.js';

export type SetupDeps = DoctorDeps & UpgradeDeps & InitDeps & WorkflowDeps & { readonly readFile: (path: string) => Promise<string> };

type Options = {
  readonly argv: readonly string[];
  readonly deps: () => Promise<SetupDeps>;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
};

type Reply = { readonly result: { readonly ok: boolean }; readonly lines: readonly string[]; readonly errors: readonly string[] };

type Flags = { readonly values: Readonly<Record<string, string>>; readonly switches: readonly string[] };

type Spec = { readonly valued: readonly string[]; readonly required: readonly string[]; readonly switches: readonly string[] };

type Run = (flags: Flags, deps: SetupDeps) => Promise<Reply>;

const OK = 0;
const REFUSED = 1;
const USAGE_ERROR = 2;
const USAGE = [
  'Usage:',
  '  factory doctor [--run-checks] [--ticket <KEY>]',
  '  factory migrate',
  '  factory init detect [--verify]',
  '  factory init statuses --answers <file>',
  '  factory init install --answers <file> --ticket <KEY>',
  '  factory init pull-request --answers <file> --branch <name> --title <text> [--body <text>]',
  '  factory workflow --title <text> [--preview]',
  'Add --json to any command for one line of JSON.',
];

const reply = (result: { readonly ok: boolean }, lines: readonly string[], errors: readonly string[] = []): Reply => ({ result, lines, errors });

const doctorReply = (report: DoctorReport): Reply => reply(report, report.ok ? ['No drift found'] : ['Drift found:', ...report.findings.map((finding) => `- ${finding.message}`)]);

const upgradeReply = (result: UpgradeResult): Reply => {
  if (!result.ok) return reply(result, [], [result.message]);
  if (result.action === 'none') return reply(result, [result.message]);
  return reply(result, [`Opened ${result.url}, which moves the project from engine ${result.from.engine} to ${result.to.engine}. Nothing changes until it is merged.`]);
};

const detectReply = (found: InitDetection): Reply => {
  const { stack, coverage } = found.detection;
  return reply({ ok: true, ...found }, [
    `Stack: ${stack.kind}${stack.framework === undefined ? '' : ` (${stack.framework})`}`,
    ...(stack.note === undefined ? [] : [stack.note]),
    'Coverage:',
    ...coverage.map(({ category, candidates, recommended }) =>
      candidates.length > 0 ? `- ${category}: ${candidates.join(', ')}` : `- ${category}: none${recommended === undefined ? '' : `. Recommended: ${recommended.id} (${recommended.how})`}`,
    ),
    ...(found.verification.length === 0 ? [] : ['Verified on this checkout:', ...found.verification.map((check) => `- ${check.id}: ${check.status} in ${check.durationSeconds}s, timeout ${check.timeout}`)]),
  ]);
};

const statusesReply = (match: StatusMatch): Reply =>
  reply({ ok: true, ...match }, [
    ...Object.entries(match.matched).map(([state, status]) => `- ${state}: ${status}`),
    ...(match.unmatched.length === 0 ? [] : [`Not matched: ${match.unmatched.join(', ')}`]),
  ]);

const installReply = (result: InstallResult): Reply => {
  if (!result.ok) return reply(result, [], [result.message]);
  return reply(result, [
    `Opened ${result.url}`,
    ...(result.secrets.length === 0 ? [] : [`Store these CI secrets: ${result.secrets.join(', ')}`]),
    ...(result.manual.length === 0 ? [] : ['By hand:', ...result.manual.map((step) => `- ${step}`)]),
  ]);
};

const proposalLines = (proposal: Proposal): readonly string[] => [
  ...proposal.pipeline,
  ...changeLines(proposal),
  ...(proposal.trials.length === 0 ? [] : ['Tried on main:', ...proposal.trials.map((trial) => `- ${trial.id}: ${trial.status}`)]),
];

const workflowReply = (result: WorkflowResult): Reply => {
  if (!result.ok) return reply(result, 'pipeline' in result ? proposalLines(result) : [], [result.message]);
  return reply(result, [...proposalLines(result), result.action === 'opened' ? `Opened ${result.url}` : 'Preview only: nothing was opened']);
};

const value = (flags: Flags, flag: string): string => String(flags.values[flag]);

const optional = (flags: Flags, flag: string): string | undefined => flags.values[flag];

const NONE: readonly string[] = [];

const COMMANDS: Readonly<Record<string, Spec & { readonly run: Run }>> = {
  doctor: {
    valued: ['--ticket'],
    required: NONE,
    switches: ['--run-checks'],
    run: async (flags, deps) => {
      const ticket = optional(flags, '--ticket');
      return doctorReply(await runDoctor(deps, { runChecks: flags.switches.includes('--run-checks'), ...(ticket === undefined ? {} : { ticket }) }));
    },
  },
  migrate: { valued: NONE, required: NONE, switches: NONE, run: async (_flags, deps) => upgradeReply(await upgradeProject(deps, {})) },
  'init detect': { valued: NONE, required: NONE, switches: ['--verify'], run: async (flags, deps) => detectReply(await detectForInit(deps, { verify: flags.switches.includes('--verify') })) },
  'init statuses': {
    valued: NONE,
    required: ['--answers'],
    switches: NONE,
    run: async (flags, deps) => statusesReply(await matchProjectStatuses(deps, parseConnection(await deps.readFile(value(flags, '--answers'))))),
  },
  'init install': {
    valued: NONE,
    required: ['--answers', '--ticket'],
    switches: NONE,
    run: async (flags, deps) => installReply(await installFactory(deps, parseInstallAnswers(await deps.readFile(value(flags, '--answers'))), { ticket: value(flags, '--ticket') })),
  },
  'init pull-request': {
    required: ['--answers', '--branch', '--title'],
    valued: ['--body'],
    switches: NONE,
    run: async (flags, deps) => {
      const connection = parseConnection(await deps.readFile(value(flags, '--answers')));
      const url = await openCheckPullRequest(deps, connection, { branch: value(flags, '--branch'), title: value(flags, '--title'), body: optional(flags, '--body') ?? '' });
      const opened = { ok: true, url };
      return reply(opened, [`Opened ${url}`]);
    },
  },
  workflow: {
    valued: NONE,
    required: ['--title'],
    switches: ['--preview'],
    run: async (flags, deps) => workflowReply(await proposeWorkflowChange(deps, { title: value(flags, '--title'), preview: flags.switches.includes('--preview') })),
  },
};

const parseFlags = (args: readonly string[], spec: Spec, flags: Flags = { values: {}, switches: [] }): Flags | undefined => {
  const [flag, given, ...rest] = args;
  if (flag === undefined) return spec.required.every((name) => name in flags.values) ? flags : undefined;
  if (spec.switches.includes(flag)) return parseFlags(args.slice(1), spec, { ...flags, switches: [...flags.switches, flag] });
  const valued = [...spec.required, ...spec.valued];
  if (!valued.includes(flag) || given === undefined || given.startsWith('--') || flag in flags.values) return undefined;
  return parseFlags(rest, spec, { ...flags, values: { ...flags.values, [flag]: given } });
};

const parse = (argv: readonly string[]): ((deps: SetupDeps) => Promise<Reply>) | undefined => {
  const words = argv[0] === 'init' ? 2 : 1;
  const command = COMMANDS[argv.slice(0, words).join(' ')];
  const flags = command === undefined ? undefined : parseFlags(argv.slice(words).filter((argument) => argument !== '--json'), command);
  if (command === undefined || flags === undefined) return undefined;
  return (deps) => command.run(flags, deps);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const setupCommand = async ({ argv, deps, write, writeError }: Options): Promise<number> => {
  const command = parse(argv);
  if (command === undefined) {
    USAGE.forEach(writeError);
    return USAGE_ERROR;
  }
  try {
    const { result, lines, errors } = await command(await deps());
    if (argv.includes('--json')) write(JSON.stringify(result));
    else {
      lines.forEach(write);
      errors.forEach(writeError);
    }
    return result.ok ? OK : REFUSED;
  } catch (error) {
    writeError(messageOf(error));
    return REFUSED;
  }
};
