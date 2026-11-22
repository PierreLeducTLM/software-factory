import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export type ConfigIssue = { readonly path: string; readonly message: string };

export type ConfigResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

const DEFAULT_ATTEMPTS_PER_RUN = 5;
const DEFAULT_RUNS_PER_TICKET = 3;
const DEFAULT_SHADOW_THRESHOLD = 20;
const DEFAULT_CHANGE_KINDS = [
  { name: 'schema or data migration', paths: ['**/migrations/**', '**/*.sql'], points: 3 },
  { name: 'dependency update', paths: ['**/package.json', '**/pnpm-lock.yaml', '**/package-lock.json', '**/yarn.lock', '**/requirements*.txt', '**/poetry.lock', '**/pyproject.toml'], points: 2 },
  { name: 'CI or infrastructure', paths: ['.github/**', 'infra/**', 'terraform/**', '**/Dockerfile', 'bitbucket-pipelines.yml'], points: 2 },
];
const DEFAULT_POLL_SECONDS = 60;
const DEFAULT_NOT_STARTED_AFTER_HOURS = 24;
const DEFAULT_INTERRUPTED_GRACE_MINUTES = 10;

const DURATION = /^\d+(s|m|h)$/;
const DURATION_MESSAGE = 'Use a number followed by s, m or h, such as 90s or 6m';

const checkBase = {
  id: z.string().min(1),
  station: z.string().min(1),
  source: z.enum(['local', 'ci']).default('local'),
  blocking: z.boolean(),
  applies_when: z.string().optional(),
  timeout: z.string().regex(DURATION, DURATION_MESSAGE),
  job: z.string().min(1).optional(),
};

const CheckSchema = z.discriminatedUnion('kind', [
  z.object({ ...checkBase, kind: z.literal('script'), run: z.string().optional() }),
  z.object({ ...checkBase, kind: z.literal('agent'), criteria: z.string().min(1), evidence: z.string().min(1) }),
]);

const RiskRouteSchema = z.object({
  merge: z.enum(['auto', 'human']),
  shadow: z.boolean().optional(),
  auto_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-11-21').optional(),
  require: z.array(z.string()).optional(),
  reviewers: z.number().int().min(1).optional(),
  extra_checks: z.array(z.string()).optional(),
});

const WatchSchema = z
  .object({
    enabled: z.boolean().default(false),
    checks: z.array(z.string().min(1)).default([]),
    duration: z.string().regex(DURATION, DURATION_MESSAGE).default('10m'),
    interval: z.string().regex(DURATION, DURATION_MESSAGE).default('1m'),
  })
  .refine((watch) => !watch.enabled || watch.checks.length > 0, { path: ['checks'], message: 'An enabled watch needs at least one smoke check' });

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
  view: z
    .object({
      poll_seconds: z.number().int().min(5).default(DEFAULT_POLL_SECONDS),
      not_started_after_hours: z.number().min(0).default(DEFAULT_NOT_STARTED_AFTER_HOURS),
      interrupted_grace_minutes: z.number().min(0).default(DEFAULT_INTERRUPTED_GRACE_MINUTES),
    })
    .prefault({}),
  checks: z.array(CheckSchema).superRefine((checks, context) => {
    checks.forEach((check, index) => {
      if (check.kind === 'script' && check.source === 'local' && check.run === undefined) {
        context.addIssue({ code: 'custom', path: [index, 'run'], message: 'A script check run locally needs a command' });
      }
      if (checks.findIndex((other) => other.id === check.id) < index) {
        context.addIssue({ code: 'custom', path: [index, 'id'], message: `Duplicate check id "${check.id}"` });
      }
    });
  }),
  watch: WatchSchema.prefault({}),
  risk: z.object({
    low: RiskRouteSchema,
    medium: RiskRouteSchema,
    high: RiskRouteSchema,
    sensitive_paths: z.array(z.string()),
    thresholds: z.object({ medium: z.number().int().min(1).default(3), high: z.number().int().min(1).default(6) }).prefault({}),
    size: z.object({ files: z.number().int().min(1).default(15), lines: z.number().int().min(1).default(400) }).prefault({}),
    kinds: z.array(z.object({ name: z.string().min(1), paths: z.array(z.string().min(1)).min(1), points: z.number().int().min(1) })).default(DEFAULT_CHANGE_KINDS),
    script: z.string().min(1).optional(),
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
        team: z.string().optional(),
        project: z.string().optional(),
        token_env: z.string().optional(),
        email_env: z.string().optional(),
      }),
    )
    .min(1),
  source_control: z.object({
    kind: z.enum(['github', 'bitbucket']),
    repo: z.string().min(1),
    token_env: z.string().optional(),
    username_env: z.string().optional(),
    api_url: z.string().optional(),
  }),
  agent_runtime: z.object({ kind: z.literal('orca') }),
});

export type FactoryConfig = z.infer<typeof FactoryConfigSchema>;

export const sampleFactoryConfig = (): FactoryConfig =>
  FactoryConfigSchema.parse({
    schema: 1,
    engine: 'sample',
    states: { to_refine: 'To refine', spec_review: 'Spec review', ready_for_dev: 'Ready for Dev', in_development: 'In development', in_review: 'In review', blocked: 'Blocked', done: 'Done' },
    labels: { auto: 'factory-auto', no_automerge: 'factory:no-automerge' },
    checks: [],
    risk: { low: { merge: 'auto' }, medium: { merge: 'human' }, high: { merge: 'human' }, sensitive_paths: [] },
  });
export type Check = z.infer<typeof CheckSchema>;
export type AdaptersConfig = z.infer<typeof AdaptersConfigSchema>;

export type SupportedTicketProvider = 'jira' | 'linear';

export const TICKET_PROVIDER_NAMES: Readonly<Record<SupportedTicketProvider, string>> = { jira: 'Jira', linear: 'Linear' };

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
