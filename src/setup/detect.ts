import { parse } from 'yaml';
import { z } from 'zod';
import type { ProjectFiles } from './project-files.js';

export const CATEGORIES = ['tests', 'lint', 'types', 'format', 'security', 'build', 'e2e'] as const;

export type Category = (typeof CATEGORIES)[number];

export type Candidate = {
  readonly id: string;
  readonly category: Category;
  readonly source: 'local' | 'ci';
  readonly run?: string;
  readonly job?: string;
  readonly from: string;
};

export type Recommendation = { readonly id: string; readonly run: string; readonly how: string };

export type CiJob = { readonly name: string; readonly file: string; readonly commands: readonly string[] };

export type Detection = {
  readonly stack: { readonly kind: 'typescript' | 'django' | 'other'; readonly framework?: string; readonly inDepth: boolean; readonly note?: string };
  readonly ci: { readonly system: 'github-actions' | 'bitbucket-pipelines' | 'none'; readonly files: readonly string[]; readonly jobs: readonly CiJob[]; readonly factorySteps: readonly string[] };
  readonly candidates: readonly Candidate[];
  readonly coverage: readonly { readonly category: Category; readonly candidates: readonly string[]; readonly recommended?: Recommendation }[];
  readonly openspec: boolean;
  readonly designSystem?: string;
  readonly remote?: { readonly kind: 'github' | 'bitbucket'; readonly repository: string };
  readonly mainBranch?: string;
};

type Options = { readonly files: ProjectFiles; readonly remoteUrl?: string; readonly mainBranch?: string };

const PackageSchema = z.object({
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});

const StepsSchema = z.array(z.object({ run: z.string().optional() }).loose()).default([]);
const WorkflowSchema = z.object({ jobs: z.record(z.string(), z.object({ name: z.string().optional(), steps: StepsSchema }).loose()).default({}) });

const BitbucketStepSchema = z.object({ step: z.object({ name: z.string().optional(), script: z.array(z.unknown()).default([]), 'after-script': z.array(z.unknown()).default([]) }).loose() });
const BitbucketItemSchema = z.union([BitbucketStepSchema, z.object({ parallel: z.union([z.array(BitbucketStepSchema), z.object({ steps: z.array(BitbucketStepSchema) })]) })]);
const BitbucketSectionSchema = z.record(z.string(), z.array(z.unknown())).default({});
const BitbucketSchema = z.object({
  pipelines: z.object({ default: z.array(z.unknown()).default([]), branches: BitbucketSectionSchema, 'pull-requests': BitbucketSectionSchema, custom: BitbucketSectionSchema, tags: BitbucketSectionSchema }),
});

const SCRIPT_NAMES: Readonly<Record<Category, readonly string[]>> = {
  tests: ['test', 'test:unit', 'test:ci', 'unit'],
  lint: ['lint', 'eslint', 'lint:check'],
  types: ['typecheck', 'type-check', 'check-types', 'types', 'tsc'],
  format: ['format:check', 'prettier:check', 'fmt:check', 'check-format'],
  security: ['audit', 'security'],
  build: ['build'],
  e2e: ['e2e', 'test:e2e', 'playwright', 'cypress'],
};

const COMMAND_HINTS: readonly (readonly [Category, RegExp])[] = [
  ['e2e', /\b(e2e|playwright|cypress)\b/i],
  ['security', /\b(audit|bandit|snyk|trivy|gosec|pip-audit|govulncheck|safety)\b/i],
  ['types', /\b(tsc|typecheck|type-check|mypy|pyright|go vet)\b/i],
  ['format', /\b(prettier|gofmt|black|fmt|format)\b/i],
  ['lint', /\b(lint|eslint|ruff|flake8|golangci-lint|clippy|rubocop)\b/i],
  ['tests', /\b(test|tests|pytest|jest|vitest|rspec|phpunit)\b/i],
  ['build', /\b(build|compile)\b/i],
];

const FACTORY_STEPS = ['record-merge', 'revert', 'watch'];
const LOCK_FILES: readonly (readonly [string, string])[] = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun']];
const FRAMEWORKS: readonly (readonly [string, string])[] = [['next', 'Next.js'], ['@tanstack/react-start', 'TanStack Start'], ['react', 'React']];
const REMOTE = /(github\.com|bitbucket\.org)[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/;
const NOT_IN_DEPTH = 'In-depth detection is not available for this stack. Checks come from the CI files only.';

const yamlOf = (text: string | undefined): unknown => {
  try {
    return text === undefined ? undefined : parse(text);
  } catch {
    return undefined;
  }
};

const jsonOf = (text: string | undefined): unknown => {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

const githubJobs = async (files: ProjectFiles): Promise<readonly CiJob[]> => {
  const folder = '.github/workflows';
  const names = (await files.list(folder)).filter((name) => /\.ya?ml$/.test(name));
  const perFile = await Promise.all(
    names.map(async (name) => {
      const file = `${folder}/${name}`;
      const parsed = WorkflowSchema.safeParse(yamlOf(await files.read(file)));
      if (!parsed.success) return [];
      return Object.entries(parsed.data.jobs).map(([id, job]) => ({ name: job.name ?? id, file, commands: job.steps.flatMap((step) => step.run?.split('\n') ?? []).filter((line) => line.trim() !== '') }));
    }),
  );
  return perFile.flat();
};

const bitbucketSteps = (item: unknown): readonly z.infer<typeof BitbucketStepSchema>[] => {
  const parsed = BitbucketItemSchema.safeParse(item);
  if (!parsed.success) return [];
  if ('step' in parsed.data) return [parsed.data];
  return Array.isArray(parsed.data.parallel) ? parsed.data.parallel : parsed.data.parallel.steps;
};

const bitbucketJobs = async (files: ProjectFiles): Promise<readonly CiJob[]> => {
  const file = 'bitbucket-pipelines.yml';
  const parsed = BitbucketSchema.safeParse(yamlOf(await files.read(file)));
  if (!parsed.success) return [];
  const { default: always, branches, 'pull-requests': pullRequests, custom, tags } = parsed.data.pipelines;
  const items = [...always, ...[branches, pullRequests, custom, tags].flatMap((section) => Object.values(section).flat())];
  const jobs = items.flatMap(bitbucketSteps).map(({ step }, index) => ({
    name: step.name ?? `step ${index + 1}`,
    file,
    commands: [...step.script, ...step['after-script']].filter((line): line is string => typeof line === 'string'),
  }));
  return jobs.filter((job, index) => jobs.findIndex((other) => other.name === job.name) === index);
};

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const ciCandidates = (jobs: readonly CiJob[]): readonly Candidate[] =>
  jobs.flatMap((job) => {
    const category = COMMAND_HINTS.find(([, hint]) => job.commands.some((command) => hint.test(command)) || hint.test(job.name))?.[0];
    return category === undefined || job.commands.some((command) => /\bfactory (record-merge|revert|watch)\b/.test(command)) ? [] : [{ id: slug(job.name), category, source: 'ci' as const, job: job.name, from: job.file }];
  });

type Stack = { readonly stack: Detection['stack']; readonly candidates: readonly Candidate[]; readonly recommended: Partial<Record<Category, Recommendation>>; readonly designSystem?: string };

const typescriptStack = async (files: ProjectFiles, manifest: z.infer<typeof PackageSchema>): Promise<Stack> => {
  const present = await Promise.all(LOCK_FILES.map(async ([file, manager]) => ((await files.read(file)) === undefined ? undefined : manager)));
  const manager = present.find((name) => name !== undefined) ?? 'npm';
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const framework = FRAMEWORKS.find(([name]) => name in dependencies)?.[1];
  const candidates = CATEGORIES.flatMap((category) =>
    SCRIPT_NAMES[category].flatMap((script) => (script in manifest.scripts ? [{ id: slug(script), category, source: 'local' as const, run: `${manager} run ${script}`, from: 'package.json' }] : [])),
  );
  const add = manager === 'npm' ? 'npm install --save-dev' : `${manager} add --dev`;
  const designSystem = 'storybook' in dependencies || (await files.list('.storybook')).length > 0 ? 'Storybook' : 'tailwindcss' in dependencies ? 'Tailwind CSS' : undefined;
  return {
    stack: { kind: 'typescript', inDepth: true, ...(framework === undefined ? {} : { framework }) },
    candidates,
    recommended: {
      tests: { id: 'unit-tests', run: `${manager} run test`, how: `${add} vitest, then add "test": "vitest run" to the scripts` },
      lint: { id: 'lint', run: `${manager} run lint`, how: `${add} eslint, then add "lint": "eslint ." to the scripts` },
      types: { id: 'typecheck', run: `${manager} run typecheck`, how: `${add} typescript, then add "typecheck": "tsc --noEmit" to the scripts` },
      format: { id: 'format', run: `${manager} run format:check`, how: `${add} prettier, then add "format:check": "prettier --check ." to the scripts` },
      security: { id: 'audit', run: `${manager} audit`, how: 'No install needed: the package manager audits dependencies' },
    },
    ...(designSystem === undefined ? {} : { designSystem }),
  };
};

const PYTHON_TOOLS: readonly { readonly id: string; readonly category: Category; readonly run: string; readonly signs: readonly RegExp[]; readonly files: readonly string[] }[] = [
  { id: 'pytest', category: 'tests', run: 'pytest', signs: [/\[tool\.pytest/, /^pytest\b/m, /["']pytest/], files: ['pytest.ini'] },
  { id: 'ruff', category: 'lint', run: 'ruff check .', signs: [/\[tool\.ruff/, /^ruff\b/m, /["']ruff/], files: ['ruff.toml', '.ruff.toml'] },
  { id: 'flake8', category: 'lint', run: 'flake8', signs: [/^\[flake8\]/m, /^flake8\b/m, /["']flake8/], files: ['.flake8'] },
  { id: 'mypy', category: 'types', run: 'mypy .', signs: [/\[tool\.mypy/, /^\[mypy\]/m, /^mypy\b/m, /["']mypy/], files: ['mypy.ini'] },
  { id: 'black', category: 'format', run: 'black --check .', signs: [/\[tool\.black/, /^black\b/m, /["']black/], files: [] },
  { id: 'bandit', category: 'security', run: 'bandit -r .', signs: [/\[tool\.bandit/, /^bandit\b/m, /["']bandit/], files: ['.bandit'] },
  { id: 'pip-audit', category: 'security', run: 'pip-audit', signs: [/^pip-audit\b/m, /["']pip-audit/], files: [] },
];

const PYTHON_CONFIG = ['pyproject.toml', 'setup.cfg', 'requirements.txt', 'requirements-dev.txt', 'requirements/dev.txt', 'requirements/base.txt'];

const djangoStack = async (files: ProjectFiles, config: string): Promise<Stack> => {
  const found = await Promise.all(
    PYTHON_TOOLS.map(async (tool) => {
      const byFile = (await Promise.all(tool.files.map((file) => files.read(file)))).some((content) => content !== undefined);
      return byFile || tool.signs.some((sign) => sign.test(config)) ? [{ id: tool.id, category: tool.category, source: 'local' as const, run: tool.run, from: 'the Python configuration' }] : [];
    }),
  );
  const tools = found.flat();
  const tests = tools.some((tool) => tool.category === 'tests') ? [] : [{ id: 'django-tests', category: 'tests' as const, source: 'local' as const, run: 'python manage.py test', from: 'manage.py' }];
  return {
    stack: { kind: 'django', framework: 'Django', inDepth: true },
    candidates: [...tests, ...tools, { id: 'django-check', category: 'build', source: 'local', run: 'python manage.py check', from: 'manage.py' }],
    recommended: {
      lint: { id: 'ruff', run: 'ruff check .', how: 'pip install ruff, and add it to the development requirements' },
      types: { id: 'mypy', run: 'mypy .', how: 'pip install mypy django-stubs, and add them to the development requirements' },
      format: { id: 'ruff-format', run: 'ruff format --check .', how: 'pip install ruff, and add it to the development requirements' },
      security: { id: 'pip-audit', run: 'pip-audit', how: 'pip install pip-audit, and add it to the development requirements' },
    },
  };
};

const stackOf = async (files: ProjectFiles): Promise<Stack> => {
  const manifest = PackageSchema.safeParse(jsonOf(await files.read('package.json')));
  const python = (await Promise.all(PYTHON_CONFIG.map((file) => files.read(file)))).filter((content) => content !== undefined).join('\n');
  const django = (await files.read('manage.py')) !== undefined || /\bdjango\b/i.test(python);
  if (django) return djangoStack(files, python);
  const typescript = manifest.success && ((await files.read('tsconfig.json')) !== undefined || 'typescript' in { ...manifest.data.dependencies, ...manifest.data.devDependencies });
  if (typescript) return typescriptStack(files, manifest.data);
  return { stack: { kind: 'other', inDepth: false, note: NOT_IN_DEPTH }, candidates: [], recommended: {} };
};

export const detectProject = async ({ files, remoteUrl, mainBranch }: Options): Promise<Detection> => {
  const github = await githubJobs(files);
  const bitbucket = await bitbucketJobs(files);
  const jobs = [...github, ...bitbucket];
  const { stack, candidates: local, recommended, designSystem } = await stackOf(files);
  const candidates = [...local, ...ciCandidates(jobs)];
  const remote = REMOTE.exec(remoteUrl ?? '');
  const commands = jobs.flatMap((job) => job.commands);
  return {
    stack,
    ci: {
      system: github.length > 0 ? 'github-actions' : bitbucket.length > 0 ? 'bitbucket-pipelines' : 'none',
      files: [...new Set(jobs.map((job) => job.file))],
      jobs,
      factorySteps: FACTORY_STEPS.filter((step) => commands.some((command) => new RegExp(`\\bfactory ${step}\\b`).test(command))),
    },
    candidates,
    coverage: CATEGORIES.map((category) => {
      const covering = candidates.filter((candidate) => candidate.category === category).map((candidate) => candidate.id);
      const suggestion = recommended[category];
      return { category, candidates: covering, ...(covering.length === 0 && suggestion !== undefined ? { recommended: suggestion } : {}) };
    }),
    openspec: (await files.list('openspec')).length > 0,
    ...(designSystem === undefined ? {} : { designSystem }),
    ...(remote === null ? {} : { remote: { kind: remote[1] === 'github.com' ? ('github' as const) : ('bitbucket' as const), repository: String(remote[2]) } }),
    ...(mainBranch === undefined ? {} : { mainBranch }),
  };
};

const FACTORY_WORKFLOW = '.github/workflows/factory.yml';
const NamedSchema = z.object({ name: z.string() });

export const mainBuildWorkflow = async (files: ProjectFiles, detection: Detection): Promise<string | undefined> => {
  if (detection.ci.system !== 'github-actions') return undefined;
  const others = detection.ci.files.filter((file) => file !== FACTORY_WORKFLOW);
  const holding = detection.candidates.find((candidate) => candidate.source === 'ci')?.from;
  const file = holding ?? (others.length === 1 ? others[0] : undefined);
  if (file === undefined) return undefined;
  const named = NamedSchema.safeParse(yamlOf(await files.read(file)));
  return named.success ? named.data.name : file;
};
