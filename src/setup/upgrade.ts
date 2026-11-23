import { parse } from 'yaml';
import { z } from 'zod';
import type { OpenPullRequest } from '../adapters/source-control.js';
import { parseAdaptersConfig } from '../config/project-config.js';
import { ENGINE_VERSION, enginePinMatches } from '../version.js';
import { detectProject, mainBuildWorkflow } from './detect.js';
import { engineFiles, LAUNCHER_PATH } from './engine-files.js';
import { factoryWorkflow, WORKFLOW_FILE, type FactoryWorkflow } from './install.js';
import { migrateConfig, type Migration } from './migrate.js';
import type { ProjectFiles, PublishedChange } from './project-files.js';

export type UpgradeDeps = {
  readonly files: ProjectFiles;
  readonly publishFiles: (change: PublishedChange) => Promise<void>;
  readonly openPullRequest: (request: OpenPullRequest) => Promise<{ readonly url: string }>;
};

type UpgradeOptions = { readonly engine?: string; readonly upgrade?: { readonly migrations: readonly Migration[]; readonly target: number } };

type Version = { readonly engine: string; readonly schema: number };

export type UpgradeResult =
  | { readonly ok: true; readonly action: 'none'; readonly message: string }
  | { readonly ok: true; readonly action: 'opened'; readonly url: string; readonly from: Version; readonly to: Version; readonly applied: readonly string[]; readonly workflowOnly?: true }
  | { readonly ok: false; readonly reason: 'missing' | 'schema' | 'newer_engine'; readonly message: string };

const FACTORY_YAML = '.factory/factory.yaml';
const ADAPTERS_YAML = '.factory/adapters.yaml';
const WORKFLOW_TITLE = 'chore: add the factory workflow';
const WORKFLOW_BRANCH = 'factory/add-workflow';
const NO_MAIN_BUILD = 'The revert step was left out because no workflow builds the main branch.';
const NO_WATCH = 'The watch step was left out: factory.yaml does not record the environment to watch. Add the watch job by hand.';

const PinSchema = z
  .object({ engine: z.string(), main_branch: z.string().default('main'), watch: z.object({ enabled: z.boolean().default(false) }).loose().default({ enabled: false }) })
  .loose();

type Pin = z.infer<typeof PinSchema>;

type AddedWorkflow = FactoryWorkflow & { readonly lines: readonly string[] };

const release = (version: string): readonly number[] => version.split('.').map(Number);

const isNewer = (pinned: string, running: string): boolean => {
  const [pinnedMajor = 0, pinnedMinor = 0] = release(pinned);
  const [runningMajor = 0, runningMinor = 0] = release(running);
  return pinnedMajor > runningMajor || (pinnedMajor === runningMajor && pinnedMinor > runningMinor);
};

const pinned = (text: string, engine: string): string => text.replace(/^engine:.*/m, `engine: ${engine}`);

const schemaLines = (from: number, to: number, applied: readonly string[]): readonly string[] =>
  from === to ? [`The configuration schema stays at version ${from}.`] : [`The configuration schema moves from version ${from} to ${to}:`, ...applied.map((summary) => `- ${summary}`)];

const staleEngineFiles = async (files: ProjectFiles, engine: string): Promise<Readonly<Record<string, string>>> => {
  const found = await Promise.all(Object.entries(engineFiles(engine)).map(async ([path, content]) => ({ path, content, stale: (await files.read(path)) !== content })));
  return Object.fromEntries(found.filter(({ stale }) => stale).map(({ path, content }) => [path, content]));
};

const body = (lines: readonly string[]): string => lines.join('\n');

const missingWorkflow = async (files: ProjectFiles, pin: Pin): Promise<AddedWorkflow | undefined> => {
  const adaptersText = await files.read(ADAPTERS_YAML);
  const adapters = adaptersText === undefined ? undefined : parseAdaptersConfig(adaptersText);
  if (adapters === undefined || !adapters.ok || adapters.value.source_control.kind !== 'github') return undefined;
  const { ticket_providers: providers, source_control: sourceControl } = adapters.value;
  if ((await files.read(WORKFLOW_FILE)) !== undefined) return undefined;
  const mainBuild = await mainBuildWorkflow(files, await detectProject({ files }));
  const workflow = factoryWorkflow({
    mainBranch: pin.main_branch,
    providerEnvs: providers.flatMap((provider) => [provider.token_env, provider.email_env]).flatMap((name) => (name === undefined ? [] : [name])),
    ...(sourceControl.token_env === undefined ? {} : { tokenEnv: sourceControl.token_env }),
    ...(mainBuild === undefined ? {} : { mainBuild }),
  });
  return {
    ...workflow,
    lines: [
      `Adds ${workflow.path}, which runs the factory steps in GitHub Actions.`,
      ...(mainBuild === undefined ? [NO_MAIN_BUILD] : []),
      ...(pin.watch.enabled ? [NO_WATCH] : []),
      '',
      ...(workflow.secrets.length === 0 ? [] : ['Before merging, store these secrets in the CI secret store:', ...workflow.secrets.map((secret) => `- ${secret}`), '']),
    ],
  };
};

export const upgradeProject = async (deps: UpgradeDeps, { engine = ENGINE_VERSION, upgrade }: UpgradeOptions): Promise<UpgradeResult> => {
  const text = await deps.files.read(FACTORY_YAML);
  if (text === undefined) return { ok: false, reason: 'missing', message: `${FACTORY_YAML} is missing. Run /factory-init` };
  const migrated = migrateConfig(text, upgrade);
  if (!migrated.ok) return { ok: false, reason: 'schema', message: migrated.message };
  const pin = PinSchema.parse(parse(text));
  if (isNewer(pin.engine, engine)) return { ok: false, reason: 'newer_engine', message: `This project pins factory engine ${pin.engine}, newer than this engine (${engine}). Install engine ${pin.engine} instead.` };
  const moving = !(migrated.from === migrated.to && enginePinMatches(pin.engine, engine));
  const target = moving ? engine : pin.engine;
  const installed = await staleEngineFiles(deps.files, target);
  const paths = Object.keys(installed);
  const workflow = await missingWorkflow(deps.files, pin);
  if (!moving && paths.length === 0 && workflow === undefined) {
    return { ok: true, action: 'none', message: `Nothing to upgrade: the project is on engine ${pin.engine} and schema ${migrated.from}, which this engine (${engine}) runs as they are.` };
  }

  const workflowOnly = !moving && paths.length === 0;
  const branch = workflowOnly ? WORKFLOW_BRANCH : `factory/upgrade-engine-${engine}`;
  const title = moving ? `chore: upgrade the factory engine to ${engine}` : workflowOnly ? WORKFLOW_TITLE : 'chore: install the factory engine in the project';
  const workflowLines = workflow?.lines ?? [];
  const installLine = `Updates ${paths.join(', ')}, which install and run the engine${moving ? '' : ` ${target}`} inside the project.`;
  await deps.publishFiles({
    branch,
    base: pin.main_branch,
    files: { ...(moving ? { [FACTORY_YAML]: pinned(migrated.text, engine) } : {}), ...installed, ...(workflow === undefined ? {} : { [workflow.path]: workflow.text }) },
    executable: paths.filter((path) => path === LAUNCHER_PATH),
    message: title,
  });
  const { url } = await deps.openPullRequest({
    branch,
    base: pin.main_branch,
    title,
    body: moving
      ? body([
          `Moves this project from factory engine ${pin.engine} to ${engine}.`,
          '',
          ...schemaLines(migrated.from, migrated.to, migrated.applied),
          '',
          ...(paths.length === 0 ? [] : [installLine, '']),
          ...workflowLines,
          `Nothing changes until this pull request is merged: the project keeps running engine ${pin.engine} until then.`,
        ])
      : body([...(workflowOnly ? [] : [installLine, '']), ...workflowLines, 'The project keeps its configuration and its engine pin. Nothing changes until this pull request is merged.']),
  });
  return { ok: true, action: 'opened', url, from: { engine: pin.engine, schema: migrated.from }, to: { engine: target, schema: migrated.to }, applied: migrated.applied, ...(workflowOnly ? { workflowOnly: true } : {}) };
};
