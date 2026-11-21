import { parse, stringify } from 'yaml';
import { z } from 'zod';

export type Migration = { readonly from: number; readonly summary: string; readonly apply: (config: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> };

export type MigrationResult =
  | { readonly ok: true; readonly from: number; readonly to: number; readonly applied: readonly string[]; readonly text: string }
  | { readonly ok: false; readonly message: string };

export const CURRENT_SCHEMA = 1;

export const MIGRATIONS: readonly Migration[] = [];

const VersionedSchema = z.object({ schema: z.number().int().min(1) }).loose();

type Options = { readonly migrations?: readonly Migration[]; readonly target?: number };

const step = (config: Readonly<Record<string, unknown>>, version: number, target: number, migrations: readonly Migration[], applied: readonly string[]): { readonly config: Readonly<Record<string, unknown>>; readonly applied: readonly string[] } | undefined => {
  if (version === target) return { config, applied };
  const migration = migrations.find((candidate) => candidate.from === version);
  if (migration === undefined) return undefined;
  return step({ ...migration.apply(config), schema: version + 1 }, version + 1, target, migrations, [...applied, migration.summary]);
};

export const migrateConfig = (text: string, { migrations = MIGRATIONS, target = CURRENT_SCHEMA }: Options = {}): MigrationResult => {
  const parsed = VersionedSchema.safeParse(parse(text));
  if (!parsed.success) return { ok: false, message: 'factory.yaml has no schema number' };
  const from = parsed.data.schema;
  if (from > target) return { ok: false, message: `factory.yaml uses schema ${from}, newer than this engine understands (${target}). Upgrade the engine.` };
  const migrated = step(parsed.data, from, target, migrations, []);
  if (migrated === undefined) return { ok: false, message: `No migration leads from schema ${from} to schema ${target}` };
  return { ok: true, from, to: target, applied: migrated.applied, text: from === target ? text : stringify(migrated.config) };
};
