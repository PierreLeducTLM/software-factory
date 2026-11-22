import { parse } from 'yaml';
import { z } from 'zod';
import type { OpenPullRequest } from '../adapters/source-control.js';
import { ENGINE_VERSION, enginePinMatches } from '../version.js';
import { migrateConfig, type Migration } from './migrate.js';
import type { ProjectFiles } from './project-files.js';

export type PublishedFile = { readonly branch: string; readonly base: string; readonly path: string; readonly content: string; readonly message: string };

export type UpgradeDeps = {
  readonly files: ProjectFiles;
  readonly publishFile: (file: PublishedFile) => Promise<void>;
  readonly openPullRequest: (request: OpenPullRequest) => Promise<{ readonly url: string }>;
};

type UpgradeOptions = { readonly engine?: string; readonly upgrade?: { readonly migrations: readonly Migration[]; readonly target: number } };

type Version = { readonly engine: string; readonly schema: number };

export type UpgradeResult =
  | { readonly ok: true; readonly action: 'none'; readonly message: string }
  | { readonly ok: true; readonly action: 'opened'; readonly url: string; readonly from: Version; readonly to: Version; readonly applied: readonly string[] }
  | { readonly ok: false; readonly reason: 'missing' | 'schema' | 'newer_engine'; readonly message: string };

const FACTORY_YAML = '.factory/factory.yaml';

const PinSchema = z.object({ engine: z.string(), main_branch: z.string().default('main') }).loose();

const release = (version: string): readonly number[] => version.split('.').map(Number);

const isNewer = (pinned: string, running: string): boolean => {
  const [pinnedMajor = 0, pinnedMinor = 0] = release(pinned);
  const [runningMajor = 0, runningMinor = 0] = release(running);
  return pinnedMajor > runningMajor || (pinnedMajor === runningMajor && pinnedMinor > runningMinor);
};

const pinned = (text: string, engine: string): string => text.replace(/^engine:.*/m, `engine: ${engine}`);

const schemaLines = (from: number, to: number, applied: readonly string[]): readonly string[] =>
  from === to ? [`The configuration schema stays at version ${from}.`] : [`The configuration schema moves from version ${from} to ${to}:`, ...applied.map((summary) => `- ${summary}`)];

export const upgradeProject = async (deps: UpgradeDeps, { engine = ENGINE_VERSION, upgrade }: UpgradeOptions): Promise<UpgradeResult> => {
  const text = await deps.files.read(FACTORY_YAML);
  if (text === undefined) return { ok: false, reason: 'missing', message: `${FACTORY_YAML} is missing. Run /factory-init` };
  const migrated = migrateConfig(text, upgrade);
  if (!migrated.ok) return { ok: false, reason: 'schema', message: migrated.message };
  const pin = PinSchema.parse(parse(text));
  if (isNewer(pin.engine, engine)) return { ok: false, reason: 'newer_engine', message: `This project pins factory engine ${pin.engine}, newer than this engine (${engine}). Install engine ${pin.engine} instead.` };
  if (migrated.from === migrated.to && enginePinMatches(pin.engine, engine)) {
    return { ok: true, action: 'none', message: `Nothing to upgrade: the project is on engine ${pin.engine} and schema ${migrated.from}, which this engine (${engine}) runs as they are.` };
  }

  const branch = `factory/upgrade-engine-${engine}`;
  const title = `chore: upgrade the factory engine to ${engine}`;
  await deps.publishFile({ branch, base: pin.main_branch, path: FACTORY_YAML, content: pinned(migrated.text, engine), message: title });
  const { url } = await deps.openPullRequest({
    branch,
    base: pin.main_branch,
    title,
    body: [
      `Moves this project from factory engine ${pin.engine} to ${engine}.`,
      '',
      ...schemaLines(migrated.from, migrated.to, migrated.applied),
      '',
      `Nothing changes until this pull request is merged: the project keeps running engine ${pin.engine} until then.`,
    ].join('\n'),
  });
  return { ok: true, action: 'opened', url, from: { engine: pin.engine, schema: migrated.from }, to: { engine, schema: migrated.to }, applied: migrated.applied };
};
