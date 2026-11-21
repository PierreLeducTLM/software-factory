import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export type ConfigIssue = { readonly path: string; readonly message: string };

export type ConfigResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

const DEFAULT_ATTEMPTS_PER_RUN = 5;
const DEFAULT_RUNS_PER_TICKET = 3;
const DEFAULT_SHADOW_THRESHOLD = 20;

const checkBase = {
  id: z.string().min(1),
  station: z.string().min(1),
  source: z.enum(['local', 'ci']).default('local'),
  blocking: z.boolean(),
  applies_when: z.string().optional(),
  timeout: z.string().min(1),
};

const CheckSchema = z.discriminatedUnion('kind', [
  z.object({ ...checkBase, kind: z.literal('script'), run: z.string().optional() }),
  z.object({ ...checkBase, kind: z.literal('agent'), criteria: z.string().min(1), evidence: z.string().min(1) }),
]);

const RiskRouteSchema = z.object({
  merge: z.enum(['auto', 'human']),
  require: z.array(z.string()).optional(),
  reviewers: z.number().int().min(1).optional(),
  extra_checks: z.array(z.string()).optional(),
});

const FactoryConfigSchema = z.object({
  schema: z.literal(1),
  engine: z.string().min(1),
  main_branch: z.string().min(1).default('main'),
  states: z.object({
    to_refine: z.string().min(1),
    spec_review: z.string().min(1),
    ready_for_dev: z.string().min(1),
    in_development: z.string().min(1),
    in_review: z.string().min(1),
    blocked: z.string().min(1),
    done: z.string().min(1),
  }),
  labels: z.object({ auto: z.string().min(1), no_automerge: z.string().min(1) }),
  limits: z
    .object({
      attempts: z.number().int().min(1).default(DEFAULT_ATTEMPTS_PER_RUN),
      runs: z.number().int().min(1).default(DEFAULT_RUNS_PER_TICKET),
    })
    .prefault({}),
  checks: z.array(CheckSchema).superRefine((checks, context) => {
    checks.forEach((check, index) => {
      if (checks.findIndex((other) => other.id === check.id) < index) {
        context.addIssue({ code: 'custom', path: [index, 'id'], message: `Duplicate check id "${check.id}"` });
      }
    });
  }),
  risk: z.object({
    low: RiskRouteSchema,
    medium: RiskRouteSchema,
    high: RiskRouteSchema,
    sensitive_paths: z.array(z.string()),
    shadow: z.boolean().default(true),
    shadow_threshold: z.number().int().min(1).default(DEFAULT_SHADOW_THRESHOLD),
  }),
});

const AdaptersConfigSchema = z.object({
  repository: z.string().min(1),
  ticket_providers: z
    .array(
      z.object({
        kind: z.enum(['jira', 'linear', 'github-issues']),
        base_url: z.string().optional(),
        filter: z.string().optional(),
        token_env: z.string().optional(),
        email_env: z.string().optional(),
      }),
    )
    .min(1),
  source_control: z.object({ kind: z.enum(['github', 'bitbucket']), repo: z.string().min(1) }),
  agent_runtime: z.object({ kind: z.literal('orca') }),
});

export type FactoryConfig = z.infer<typeof FactoryConfigSchema>;
export type AdaptersConfig = z.infer<typeof AdaptersConfigSchema>;

const SECRET_FIELD_NAME = /(token|secret|password|api[_-]?key)$/i;
const SECRET_VALUE = /^(ghp_|github_pat_|xox[abp]-|ATATT|lin_api_)/;
const SECRET_MESSAGE = 'Secrets must not be stored in adapters.yaml';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const findSecrets = (value: unknown, path: readonly string[]): readonly ConfigIssue[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSecrets(item, [...path, String(index)]));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      SECRET_FIELD_NAME.test(key)
        ? [{ path: [...path, key].join('.'), message: SECRET_MESSAGE }]
        : findSecrets(child, [...path, key]),
    );
  }
  return typeof value === 'string' && SECRET_VALUE.test(value)
    ? [{ path: path.join('.'), message: SECRET_MESSAGE }]
    : [];
};

type Loaded = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

const loadYaml = (text: string): Loaded => {
  try {
    return { ok: true, data: parseYaml(text) };
  } catch (error) {
    return { ok: false, issues: [{ path: '', message: String(error) }] };
  }
};

const validate = <T>(schema: z.ZodType<T>, data: unknown): ConfigResult<T> => {
  const parsed = schema.safeParse(data);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) };
};

export const parseFactoryConfig = (text: string): ConfigResult<FactoryConfig> => {
  const loaded = loadYaml(text);
  return loaded.ok ? validate(FactoryConfigSchema, loaded.data) : loaded;
};

export const parseAdaptersConfig = (text: string): ConfigResult<AdaptersConfig> => {
  const loaded = loadYaml(text);
  if (!loaded.ok) return loaded;
  const secrets = findSecrets(loaded.data, []);
  return secrets.length > 0 ? { ok: false, issues: secrets } : validate(AdaptersConfigSchema, loaded.data);
};
