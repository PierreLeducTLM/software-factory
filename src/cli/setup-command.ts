import { runDoctor, type DoctorDeps, type DoctorReport } from '../setup/doctor.js';
import { upgradeProject, type UpgradeDeps, type UpgradeResult } from '../setup/upgrade.js';

export type SetupDeps = DoctorDeps & UpgradeDeps;

type Options = {
  readonly argv: readonly string[];
  readonly deps: () => Promise<SetupDeps>;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
};

type Reply = { readonly result: DoctorReport | UpgradeResult; readonly lines: readonly string[]; readonly errors: readonly string[] };

const OK = 0;
const REFUSED = 1;
const USAGE_ERROR = 2;
const USAGE = 'Usage: factory doctor [--run-checks] [--ticket <KEY>] [--json] | factory migrate [--json]';

const doctorReply = (report: DoctorReport): Reply => ({
  result: report,
  lines: report.ok ? ['No drift found'] : ['Drift found:', ...report.findings.map((finding) => `- ${finding.message}`)],
  errors: [],
});

const upgradeReply = (result: UpgradeResult): Reply => {
  if (!result.ok) return { result, lines: [], errors: [result.message] };
  if (result.action === 'none') return { result, lines: [result.message], errors: [] };
  return { result, lines: [`Opened ${result.url}, which moves the project from engine ${result.from.engine} to ${result.to.engine}. Nothing changes until it is merged.`], errors: [] };
};

type DoctorRequest = { readonly runChecks: boolean; readonly ticket?: string };

const doctorRequest = (flags: readonly string[]): DoctorRequest | undefined => {
  const runChecks = flags.includes('--run-checks');
  const [flag, ticket, ...extra] = flags.filter((argument) => argument !== '--run-checks');
  if (flag === undefined) return { runChecks };
  if (flag !== '--ticket' || ticket === undefined || ticket.startsWith('--') || extra.length > 0) return undefined;
  return { runChecks, ticket };
};

const parse = (argv: readonly string[]): ((deps: SetupDeps) => Promise<Reply>) | undefined => {
  const [name, ...rest] = argv;
  const flags = rest.filter((argument) => argument !== '--json');
  if (name === 'migrate' && flags.length === 0) return async (deps) => upgradeReply(await upgradeProject(deps, {}));
  const request = name === 'doctor' ? doctorRequest(flags) : undefined;
  if (request === undefined) return undefined;
  return async (deps) => doctorReply(await runDoctor(deps, request));
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const setupCommand = async ({ argv, deps, write, writeError }: Options): Promise<number> => {
  const command = parse(argv);
  if (command === undefined) {
    writeError(USAGE);
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
