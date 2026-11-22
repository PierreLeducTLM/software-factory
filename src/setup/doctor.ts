import type { Access } from '../adapters/ticket-provider.js';
import { parseAdaptersConfig, parseFactoryConfig, type AdaptersConfig, type ConfigResult, type FactoryConfig } from '../config/project-config.js';
import type { ScriptRun } from '../factory/checks.js';
import { ENGINE_VERSION, enginePinMatches } from '../version.js';
import { detectProject } from './detect.js';
import { migrateConfig, type Migration } from './migrate.js';
import type { ProjectFiles } from './project-files.js';
import { verifyChecks } from './verify.js';

export type FindingKind = 'config' | 'secret' | 'schema' | 'engine' | 'ci_job' | 'unused_script' | 'ci_step' | 'ci_secret' | 'failing_check' | 'flaky_check' | 'service_account';

export type Finding = { readonly kind: FindingKind; readonly message: string };

export type DoctorReport = { readonly ok: boolean; readonly findings: readonly Finding[] };

export type DoctorDeps = {
  readonly files: ProjectFiles;
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly now: () => string;
  readonly checkAccess: (key: string) => Promise<Access>;
};

type Upgrade = { readonly migrations: readonly Migration[]; readonly target: number };

type DoctorOptions = { readonly runChecks: boolean; readonly ticket?: string; readonly engine?: string; readonly upgrade?: Upgrade };

const FACTORY_YAML = '.factory/factory.yaml';
const ADAPTERS_YAML = '.factory/adapters.yaml';
const SECRET_MESSAGE = 'Secrets must not be stored in adapters.yaml';

const finding = (kind: FindingKind, message: string): Finding => ({ kind, message });

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const configFindings = <T>(path: string, text: string | undefined, parse: (text: string) => ConfigResult<T>): { readonly value?: T; readonly findings: readonly Finding[] } => {
  if (text === undefined) return { findings: [finding('config', `${path} is missing. Run /factory-init`)] };
  const parsed = parse(text);
  if (parsed.ok) return { value: parsed.value, findings: [] };
  return { findings: parsed.issues.map((issue) => finding(issue.message === SECRET_MESSAGE ? 'secret' : 'config', `${path}: ${issue.path}: ${issue.message}`)) };
};

const schemaFindings = (text: string | undefined, upgrade: Upgrade | undefined): readonly Finding[] => {
  const migrated = text === undefined ? undefined : migrateConfig(text, upgrade);
  if (migrated === undefined || (migrated.ok && migrated.from === migrated.to)) return [];
  return [finding('schema', migrated.ok ? `${FACTORY_YAML} uses schema ${migrated.from}. Run "factory migrate" and open a pull request with the result` : migrated.message)];
};

const envNames = ({ ticket_providers: providers }: AdaptersConfig): readonly string[] =>
  providers.flatMap((provider) => [provider.token_env, provider.email_env]).flatMap((name) => (name === undefined ? [] : [name]));

const accountFindings = async (deps: DoctorDeps, ticket: string): Promise<readonly Finding[]> => {
  try {
    const access = await deps.checkAccess(ticket);
    return [
      ...(access.comment ? [] : [finding('service_account', `The account cannot comment on ${ticket}`)]),
      ...(access.transition ? [] : [finding('service_account', `The account cannot change the status of ${ticket}`)]),
    ];
  } catch (error) {
    return [finding('service_account', `The account could not be checked on ${ticket}: ${messageOf(error)}`)];
  }
};

const driftFindings = async (deps: DoctorDeps, config: FactoryConfig, adapters: AdaptersConfig | undefined, { runChecks, engine = ENGINE_VERSION }: DoctorOptions): Promise<readonly Finding[]> => {
  const detection = await detectProject({ files: deps.files });
  const jobs = detection.ci.jobs.map((job) => job.name);
  const gated = (run: string): boolean => config.checks.some((check) => check.kind === 'script' && check.run === run);
  const expected = ['record-merge', 'revert', ...(config.watch.enabled ? ['watch'] : [])];
  const ciTexts = await Promise.all(detection.ci.files.map((file) => deps.files.read(file)));
  const local = config.checks.flatMap((check) => (check.kind === 'script' && check.source === 'local' && check.run !== undefined ? [{ id: check.id, category: 'tests' as const, source: 'local' as const, run: check.run, from: FACTORY_YAML }] : []));
  const verified = runChecks ? await verifyChecks(deps, local) : [];

  return [
    ...(enginePinMatches(config.engine, engine) ? [] : [finding('engine', `${FACTORY_YAML} pins engine ${config.engine}, and this is engine ${engine}`)]),
    ...config.checks.flatMap((check) => {
      const job = check.job ?? check.id;
      return check.source === 'ci' && !jobs.includes(job) ? [finding('ci_job', `Check ${check.id} reads the CI job "${job}", which no CI file defines`)] : [];
    }),
    ...detection.candidates.flatMap((candidate) => (candidate.run === undefined || gated(candidate.run) ? [] : [finding('unused_script', `No gate uses "${candidate.run}" (${candidate.category})`)])),
    ...expected.flatMap((step) => (detection.ci.factorySteps.includes(step) ? [] : [finding('ci_step', `The CI pipeline does not run "factory ${step}"`)])),
    ...(adapters === undefined || detection.ci.files.length === 0 ? [] : envNames(adapters).flatMap((name) => (ciTexts.some((text) => text?.includes(name)) ? [] : [finding('ci_secret', `No CI file passes ${name} to the factory steps: the service account is not set up`)]))),
    ...verified.flatMap((check): readonly Finding[] => {
      if (check.status === 'flaky') return [finding('flaky_check', `Check ${check.id} failed, then passed on a second run: it is flaky`)];
      return check.status === 'fail' ? [finding('failing_check', `Check ${check.id} fails on the current code`)] : [];
    }),
  ];
};

export const runDoctor = async (deps: DoctorDeps, options: DoctorOptions): Promise<DoctorReport> => {
  const factoryText = await deps.files.read(FACTORY_YAML);
  const schema = schemaFindings(factoryText, options.upgrade);
  const factory: { readonly value?: FactoryConfig; readonly findings: readonly Finding[] } = schema.length > 0 ? { findings: schema } : configFindings(FACTORY_YAML, factoryText, parseFactoryConfig);
  const adapters = configFindings(ADAPTERS_YAML, await deps.files.read(ADAPTERS_YAML), parseAdaptersConfig);
  const drift = factory.value !== undefined ? await driftFindings(deps, factory.value, adapters.value, options) : [];
  const account = options.ticket === undefined ? [] : await accountFindings(deps, options.ticket);
  const findings = [...factory.findings, ...adapters.findings, ...drift, ...account];
  return { ok: findings.length === 0, findings };
};
