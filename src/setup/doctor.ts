import { requiresCheck, type RequiredChecks } from '../adapters/source-control.js';
import type { Access } from '../adapters/ticket-provider.js';
import { parseAdaptersConfig, parseFactoryConfig, type AdaptersConfig, type ConfigResult, type FactoryConfig } from '../config/project-config.js';
import type { ScriptRun } from '../factory/checks.js';
import { ENGINE_VERSION, enginePinMatches } from '../version.js';
import { detectProject, FACTORY_WORKFLOWS } from './detect.js';
import { ENGINE_PACKAGE_PATH, enginePackage, LAUNCHER_PATH } from './engine-files.js';
import { TASKS_WORKFLOW_FILE, WORKFLOW_FILE } from './install.js';
import { migrateConfig, type Migration } from './migrate.js';
import type { ProjectFiles } from './project-files.js';
import { isNewerPatch } from './upgrade.js';
import { verifyChecks } from './verify.js';

export type FindingKind = 'config' | 'secret' | 'schema' | 'engine' | 'ci_job' | 'unused_script' | 'ci_step' | 'ci_secret' | 'failing_check' | 'flaky_check' | 'service_account' | 'claim_lock' | 'required_check';

export type Finding = { readonly kind: FindingKind; readonly message: string };

export type DoctorReport = { readonly ok: boolean; readonly findings: readonly Finding[]; readonly notes: readonly string[] };

export type DoctorDeps = {
  readonly files: ProjectFiles;
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly now: () => string;
  readonly checkAccess: (key: string) => Promise<Access>;
  readonly canReenter: (request: { readonly key: string; readonly status: string }) => Promise<boolean>;
  readonly requiredChecks: (branch: string) => Promise<RequiredChecks>;
};

type Upgrade = { readonly migrations: readonly Migration[]; readonly target: number };

type DoctorOptions = { readonly runChecks: boolean; readonly ticket?: string; readonly engine?: string; readonly upgrade?: Upgrade };

const FACTORY_YAML = '.factory/factory.yaml';
const ADAPTERS_YAML = '.factory/adapters.yaml';
const SECRET_MESSAGE = 'Secrets must not be stored in adapters.yaml';
const STEP_WORKFLOWS: Readonly<Record<string, string>> = { 'record-merge': WORKFLOW_FILE, 'check-tasks': TASKS_WORKFLOW_FILE };
const TASKS_CHECK = 'factory/tasks';
const MIGRATE_HINT = '. Run "factory migrate" and merge the pull request it opens';

const finding = (kind: FindingKind, message: string): Finding => ({ kind, message });

const installFindings = async (deps: DoctorDeps, pinned: string): Promise<readonly Finding[]> => {
  const [pin, launcher] = await Promise.all([deps.files.read(ENGINE_PACKAGE_PATH), deps.files.read(LAUNCHER_PATH)]);
  if (pin === undefined || launcher === undefined) return [finding('engine', 'The factory is not installed in the project. Run "factory migrate" and merge the pull request it opens')];
  return pin === enginePackage(pinned) ? [] : [finding('engine', `${ENGINE_PACKAGE_PATH} installs another engine than the ${pinned} pinned in ${FACTORY_YAML}. Run "factory migrate"`)];
};

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

const accountFindings = async (deps: DoctorDeps, ticket: string, claimed: string | undefined): Promise<readonly Finding[]> => {
  try {
    const access = await deps.checkAccess(ticket);
    const reenters = claimed !== undefined && (await deps.canReenter({ key: ticket, status: claimed }));
    return [
      ...(access.comment ? [] : [finding('service_account', `The account cannot comment on ${ticket}`)]),
      ...(access.transition ? [] : [finding('service_account', `The account cannot change the status of ${ticket}`)]),
      ...(reenters ? [finding('claim_lock', `The workflow lets a ticket move from "${claimed}" to "${claimed}", so two developers could claim the same ticket. Remove that transition from the workflow`)] : []),
    ];
  } catch (error) {
    return [finding('service_account', `The account could not be checked on ${ticket}: ${messageOf(error)}`)];
  }
};

const driftFindings = async (deps: DoctorDeps, config: FactoryConfig, adapters: AdaptersConfig | undefined, { runChecks, engine = ENGINE_VERSION }: DoctorOptions): Promise<readonly Finding[]> => {
  const detection = await detectProject({ files: deps.files });
  const jobs = detection.ci.jobs.map((job) => job.name);
  const gated = (run: string): boolean => config.checks.some((check) => check.kind === 'script' && check.run === run);
  const builds = detection.ci.jobs.some((job) => !FACTORY_WORKFLOWS.includes(job.file));
  const expected = ['record-merge', ...(builds ? ['revert'] : []), ...(config.watch.enabled ? ['watch'] : []), 'check-tasks'];
  const workflows = adapters?.source_control.kind === 'github' ? Object.values(STEP_WORKFLOWS) : [];
  const missing = (await Promise.all(workflows.map(async (path) => ((await deps.files.read(path)) === undefined ? [path] : [])))).flat();
  const hint = (step: string): string => (missing.includes(STEP_WORKFLOWS[step] ?? '') ? MIGRATE_HINT : '');
  const ciTexts = await Promise.all(detection.ci.files.map((file) => deps.files.read(file)));
  const local = config.checks.flatMap((check) => (check.kind === 'script' && check.source === 'local' && check.run !== undefined ? [{ id: check.id, category: 'tests' as const, source: 'local' as const, run: check.run, from: FACTORY_YAML }] : []));
  const verified = runChecks ? await verifyChecks(deps, local) : [];

  return [
    ...(await installFindings(deps, config.engine)),
    ...(enginePinMatches(config.engine, engine) ? [] : [finding('engine', `${FACTORY_YAML} pins engine ${config.engine}, and this is engine ${engine}`)]),
    ...config.checks.flatMap((check) => {
      const job = check.job ?? check.id;
      return check.source === 'ci' && !jobs.includes(job) ? [finding('ci_job', `Check ${check.id} reads the CI job "${job}", which no CI file defines`)] : [];
    }),
    ...detection.candidates.flatMap((candidate) => (candidate.run === undefined || gated(candidate.run) ? [] : [finding('unused_script', `No gate uses "${candidate.run}" (${candidate.category})`)])),
    ...expected.flatMap((step) => (detection.ci.factorySteps.includes(step) ? [] : [finding('ci_step', `The CI pipeline does not run "factory ${step}"${hint(step)}`)])),
    ...(adapters === undefined || detection.ci.files.length === 0 ? [] : envNames(adapters).flatMap((name) => (ciTexts.some((text) => text?.includes(name)) ? [] : [finding('ci_secret', `No CI file passes ${name} to the factory steps: the service account is not set up`)]))),
    ...verified.flatMap((check): readonly Finding[] => {
      if (check.status === 'flaky') return [finding('flaky_check', `Check ${check.id} failed, then passed on a second run: it is flaky`)];
      return check.status === 'fail' ? [finding('failing_check', `Check ${check.id} fails on the current code`)] : [];
    }),
  ];
};

type Verdict = { readonly findings: readonly Finding[]; readonly notes: readonly string[] };

const couldNotVerify = (branch: string, reason: string): Verdict => ({ findings: [], notes: [`Could not verify the required checks on ${branch}: ${reason}. Check by hand that ${TASKS_CHECK} is required there`] });

const requiredCheckVerdict = async (deps: DoctorDeps, branch: string): Promise<Verdict> => {
  try {
    const required = await deps.requiredChecks(branch);
    if (required === 'unreadable') return couldNotVerify(branch, 'the token cannot read its branch protection, rulesets or merge checks');
    return { findings: requiresCheck(required, TASKS_CHECK) ? [] : [finding('required_check', `${TASKS_CHECK} is not a required check on ${branch}, so open tasks do not block the merge`)], notes: [] };
  } catch (error) {
    return couldNotVerify(branch, messageOf(error));
  }
};

const patchNotes = (pinned: string, engine: string = ENGINE_VERSION): readonly string[] =>
  isNewerPatch(pinned, engine) ? [`Engine ${engine} is a newer patch than the ${pinned} pinned in ${FACTORY_YAML}. Run "factory migrate" to move the project to it`] : [];

export const runDoctor = async (deps: DoctorDeps, options: DoctorOptions): Promise<DoctorReport> => {
  const factoryText = await deps.files.read(FACTORY_YAML);
  const schema = schemaFindings(factoryText, options.upgrade);
  const factory: { readonly value?: FactoryConfig; readonly findings: readonly Finding[] } = schema.length > 0 ? { findings: schema } : configFindings(FACTORY_YAML, factoryText, parseFactoryConfig);
  const adapters = configFindings(ADAPTERS_YAML, await deps.files.read(ADAPTERS_YAML), parseAdaptersConfig);
  const drift = factory.value !== undefined ? await driftFindings(deps, factory.value, adapters.value, options) : [];
  const required = factory.value !== undefined && adapters.value !== undefined ? await requiredCheckVerdict(deps, factory.value.main_branch) : { findings: [], notes: [] };
  const account = options.ticket === undefined ? [] : await accountFindings(deps, options.ticket, factory.value?.states.in_development);
  const findings = [...factory.findings, ...adapters.findings, ...drift, ...required.findings, ...account];
  return { ok: findings.length === 0, findings, notes: [...(factory.value === undefined ? [] : patchNotes(factory.value.engine, options.engine)), ...required.notes] };
};
