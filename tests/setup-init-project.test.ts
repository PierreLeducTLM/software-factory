import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { OpenPullRequest } from '../src/adapters/source-control.js';
import type { Access, ProviderStatus } from '../src/adapters/ticket-provider.js';
import { parseAdaptersConfig, parseFactoryConfig, type AdaptersConfig } from '../src/config/project-config.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { initProject, type InitInput } from '../src/setup/init.js';
import { createInMemoryProjectFiles, type PublishedChange } from '../src/setup/project-files.js';
import { ENGINE_VERSION } from '../src/version.js';

const STATUSES: readonly ProviderStatus[] = ['Backlog', 'Spec review', 'Ready for Dev', 'In Progress', 'In Review', 'Blocked', 'Done'].map((name) => ({ name, category: 'todo' }));

const PROJECT: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit', build: 'tsc', 'test:e2e': 'playwright test', format: 'prettier --write .', 'format:check': 'prettier --check .', audit: 'pnpm audit' }, devDependencies: { typescript: '5' } }),
  'pnpm-lock.yaml': '',
};

const CI = (name: string | undefined) => `${name === undefined ? '' : `name: ${name}\n`}on: push\njobs:\n  tests:\n    steps:\n      - run: pnpm test\n  security:\n    name: Security scan\n    steps:\n      - run: trivy fs .\n`;

const WITH_CI: Readonly<Record<string, string>> = { ...PROJECT, '.github/workflows/ci.yml': CI('CI') };

type World = {
  readonly files?: Readonly<Record<string, string>>;
  readonly statuses?: readonly ProviderStatus[];
  readonly access?: Access;
  readonly reenter?: boolean;
  readonly runs?: Readonly<Record<string, readonly ScriptRun[]>>;
  readonly remoteUrl?: string | undefined;
  readonly branch?: string | undefined;
};

const PASS: ScriptRun = { exitCode: 0, output: 'ok', timedOut: false };
const FAIL: ScriptRun = { exitCode: 1, output: 'broken', timedOut: false };

const getInit = (world: World = {}) => {
  const reached: string[] = [];
  const published: PublishedChange[] = [];
  const opened: OpenPullRequest[] = [];
  const connections: AdaptersConfig[] = [];
  const queues = Object.fromEntries(Object.entries(world.runs ?? {}).map(([command, runs]) => [command, [...runs]]));
  const deps = {
    files: createInMemoryProjectFiles(world.files ?? PROJECT),
    remoteUrl: async () => ('remoteUrl' in world ? world.remoteUrl : 'git@github.com:acme/billing-service.git'),
    currentBranch: async () => ('branch' in world ? world.branch : 'main'),
    now: () => '2026-11-21T08:00:00Z',
    runScript: async (command: string) => {
      reached.push(command);
      return queues[command]?.shift() ?? PASS;
    },
    tickets: (adapters: AdaptersConfig) => {
      connections.push(adapters);
      return {
        listStatuses: async () => world.statuses ?? STATUSES,
        checkAccess: async () => world.access ?? { comment: true, transition: true },
        canReenter: async () => world.reenter ?? false,
      };
    },
    sourceControl: (adapters: AdaptersConfig) => {
      connections.push(adapters);
      return {
        openPullRequest: async (request: OpenPullRequest) => {
          opened.push(request);
          return { url: `https://github.com/acme/billing-service/pull/${opened.length}` };
        },
      };
    },
    publishFiles: async (change: PublishedChange) => void published.push(change),
  };
  return { deps, reached, published, opened, connections };
};

const JIRA_NO_FILTER: InitInput = { ticket: 'PAY-1', baseUrl: 'https://acme.atlassian.net', verify: false };
const LINEAR: InitInput = { ticket: 'PAY-1', team: 'PAY', verify: false };
const JIRA: InitInput = { ticket: 'PAY-1', baseUrl: 'https://acme.atlassian.net', filter: 'project = PAY', verify: false };

const factoryOf = (published: readonly PublishedChange[]) => {
  const parsed = parseFactoryConfig(published[0]?.files['.factory/factory.yaml'] ?? '');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const adaptersOf = (published: readonly PublishedChange[]) => {
  const parsed = parseAdaptersConfig(published[0]?.files['.factory/adapters.yaml'] ?? '');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

describe('setting a project up in one step', () => {
  it('opens the install pull request from the Linear team alone, taking everything else from the project', async () => {
    const { deps, published, opened, reached } = getInit({ branch: 'trunk', files: WITH_CI });

    const result = await initProject(deps, LINEAR);

    expect(result).toMatchObject({ ok: true, url: 'https://github.com/acme/billing-service/pull/1', secrets: ['FACTORY_LINEAR_API_KEY'] });
    expect(opened).toHaveLength(1);
    expect(adaptersOf(published)).toEqual({
      repository: 'acme/billing-service',
      ticket_providers: [{ kind: 'linear', team: 'PAY', token_env: 'LINEAR_API_KEY' }],
      source_control: { kind: 'github', repo: 'acme/billing-service', token_env: 'GH_TOKEN' },
      agent_runtime: { kind: 'orca' },
    });
    expect(factoryOf(published)).toMatchObject({
      engine: ENGINE_VERSION,
      main_branch: 'trunk',
      states: { to_refine: 'Backlog', spec_review: 'Spec review', ready_for_dev: 'Ready for Dev', in_development: 'In Progress', in_review: 'In Review', blocked: 'Blocked', done: 'Done' },
      risk: { sensitive_paths: [], shadow: true },
    });
    expect(published[0]?.base).toBe('trunk');
    expect(reached).toEqual([]);
  });

  it('keeps every check the project already has, blocking, with a timeout for its kind, and runs none of them', async () => {
    const { deps, published } = getInit();

    await initProject(deps, LINEAR);

    expect(factoryOf(published).checks.map((check) => ({ id: check.id, blocking: check.blocking, timeout: check.timeout, run: 'run' in check ? check.run : undefined }))).toEqual([
      { id: 'test', blocking: true, timeout: '10m', run: 'pnpm run test' },
      { id: 'lint', blocking: true, timeout: '5m', run: 'pnpm run lint' },
      { id: 'typecheck', blocking: true, timeout: '5m', run: 'pnpm run typecheck' },
      { id: 'format-check', blocking: true, timeout: '2m', run: 'pnpm run format:check' },
      { id: 'audit', blocking: true, timeout: '10m', run: 'pnpm run audit' },
      { id: 'build', blocking: true, timeout: '10m', run: 'pnpm run build' },
      { id: 'test-e2e', blocking: true, timeout: '15m', run: 'pnpm run test:e2e' },
    ]);
  });

  it('keeps the checks of the CI as they are, by job, with the timeout of a CI job', async () => {
    const { deps, published } = getInit({ files: WITH_CI });

    await initProject(deps, LINEAR);

    const ci = factoryOf(published).checks.filter((check) => 'source' in check && check.source === 'ci');
    expect(ci.map((check) => ({ id: check.id, blocking: check.blocking, timeout: check.timeout, job: 'job' in check ? check.job : undefined }))).toEqual([
      { id: 'tests', blocking: true, timeout: '15m', job: 'tests' },
      { id: 'security-scan', blocking: true, timeout: '15m', job: 'Security scan' },
    ]);
  });

  it('keeps one check when a CI job and a script of the project share a name, the script first', async () => {
    const { deps, published } = getInit({ files: { ...PROJECT, '.github/workflows/ci.yml': 'name: CI\non: push\njobs:\n  test:\n    name: Test\n    steps:\n      - run: pnpm test\n' } });

    const result = await initProject(deps, LINEAR);

    expect(result).toMatchObject({ ok: true });
    const checks = factoryOf(published).checks.filter((check) => check.id === 'test');
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ source: 'local', run: 'pnpm run test' });
  });

  it('connects Jira from its site and filter, with the usual names for its two variables', async () => {
    const { deps, published } = getInit({ files: WITH_CI });

    const result = await initProject(deps, JIRA);

    expect(result).toMatchObject({ ok: true, secrets: ['FACTORY_JIRA_TOKEN', 'FACTORY_JIRA_EMAIL'] });
    expect(adaptersOf(published).ticket_providers).toEqual([{ kind: 'jira', base_url: 'https://acme.atlassian.net', filter: 'project = PAY', token_env: 'JIRA_TOKEN', email_env: 'JIRA_EMAIL' }]);
  });

  it('uses the variable names it is given, a Linear project, and the sensitive paths', async () => {
    const { deps, published } = getInit();

    await initProject(deps, { ...LINEAR, project: 'Billing', tokenEnv: 'MY_LINEAR_KEY', sourceTokenEnv: 'MY_GH', sensitivePaths: ['src/auth/**', 'db/**'] });

    expect(adaptersOf(published)).toMatchObject({ ticket_providers: [{ kind: 'linear', team: 'PAY', project: 'Billing', token_env: 'MY_LINEAR_KEY' }], source_control: { token_env: 'MY_GH' } });
    expect(factoryOf(published).risk.sensitive_paths).toEqual(['src/auth/**', 'db/**']);
  });

  it('takes Bitbucket and its two variables from the remote', async () => {
    const { deps, published } = getInit({ remoteUrl: 'git@bitbucket.org:acme/billing-service.git' });

    await initProject(deps, LINEAR);

    expect(adaptersOf(published).source_control).toEqual({ kind: 'bitbucket', repo: 'acme/billing-service', token_env: 'BITBUCKET_TOKEN', username_env: 'BITBUCKET_USERNAME' });
  });

  it('asks for what only the person knows, and reaches nothing before it has it', async () => {
    const none = getInit();
    const partial = getInit();
    const jira = getInit();

    expect(await initProject(none.deps, { ticket: 'PAY-1', verify: false })).toEqual({ ok: false, reason: 'missing', missing: ['--team (Linear), or --base-url and --filter (Jira)'], message: 'Missing: --team (Linear), or --base-url and --filter (Jira)' });
    expect(await initProject(getInit({ remoteUrl: undefined }).deps, JIRA_NO_FILTER)).toMatchObject({ message: 'Missing: --filter (Jira); --repository; --source-control github|bitbucket' });
    expect(await initProject(jira.deps, { ticket: 'PAY-1', baseUrl: 'https://acme.atlassian.net', verify: false })).toMatchObject({ ok: false, reason: 'missing', missing: ['--filter (Jira)'] });
    expect(await initProject(partial.deps, { ...LINEAR, baseUrl: 'https://acme.atlassian.net' })).toMatchObject({ ok: false, reason: 'missing', missing: ['--team or --base-url, not both'] });
    expect([...none.connections, ...jira.connections, ...partial.connections]).toEqual([]);
  });

  it('asks for the repository and the source control when the project has no remote to read them from', async () => {
    const { deps, published } = getInit({ remoteUrl: undefined });

    expect(await initProject(deps, LINEAR)).toMatchObject({ ok: false, reason: 'missing', missing: ['--repository', '--source-control github|bitbucket'] });

    await initProject(deps, { ...LINEAR, repository: 'acme/other', sourceControl: 'bitbucket' });

    expect(adaptersOf(published)).toMatchObject({ repository: 'acme/other', source_control: { kind: 'bitbucket', repo: 'acme/other' } });
  });

  it('falls back to main when git reports no branch', async () => {
    const { deps, published } = getInit({ branch: undefined });

    await initProject(deps, LINEAR);

    expect(published[0]?.base).toBe('main');
  });

  it('prefers the main branch it is given to the one it is on', async () => {
    const { deps, published } = getInit({ branch: 'feature' });

    await initProject(deps, { ...LINEAR, mainBranch: 'develop' });

    expect(published[0]?.base).toBe('develop');
  });
});

describe('matching the statuses while setting up', () => {
  const FEW: readonly ProviderStatus[] = ['Backlog', 'Ready for Dev', 'Doing', 'Done'].map((name) => ({ name, category: 'todo' }));

  it('stops, with what to choose from, when a status cannot be matched, and opens nothing', async () => {
    const { deps, published, opened } = getInit({ statuses: FEW });

    const result = await initProject(deps, LINEAR);

    expect(result).toMatchObject({ ok: false, reason: 'statuses', unmatched: ['spec_review', 'in_review', 'blocked'], available: ['Backlog', 'Ready for Dev', 'Doing', 'Done'] });
    expect(result).toMatchObject({ message: 'No status matches spec_review, in_review, blocked. Choose one for each with --statuses "spec_review=<status>;in_review=<status>;blocked=<status>". The tracker has: Backlog, Ready for Dev, Doing, Done.' });
    expect([...published, ...opened]).toEqual([]);
  });

  it('asks only about the states the person did not already choose', async () => {
    const { deps } = getInit({ statuses: FEW });

    const result = await initProject(deps, { ...LINEAR, statuses: { spec_review: 'Backlog' } });

    expect(result).toMatchObject({ ok: false, unmatched: ['in_review', 'blocked'], message: expect.stringContaining('No status matches in_review, blocked. Choose one for each with --statuses "in_review=<status>;blocked=<status>"') });
  });

  it('goes on with the statuses the person chose for the ones it could not match', async () => {
    const { deps, published } = getInit({ statuses: FEW });

    const result = await initProject(deps, { ...LINEAR, statuses: { spec_review: 'Backlog', in_review: 'Doing', blocked: 'Doing', in_development: 'Doing' } });

    expect(result).toMatchObject({ ok: true });
    expect(factoryOf(published).states).toMatchObject({ spec_review: 'Backlog', in_review: 'Doing', blocked: 'Doing', in_development: 'Doing', to_refine: 'Backlog' });
  });

  it('refuses a status the tracker does not have', async () => {
    const { deps, published } = getInit();

    const result = await initProject(deps, { ...LINEAR, statuses: { blocked: 'On ice' } });

    expect(result).toEqual({ ok: false, reason: 'statuses', unmatched: [], available: STATUSES.map((status) => status.name), message: 'The tracker has no status "On ice". It has: Backlog, Spec review, Ready for Dev, In Progress, In Review, Blocked, Done.' });
    expect(published).toEqual([]);
  });
});

describe('measuring the checks while setting up', () => {
  it('runs each check when asked, makes the failing and the flaky ones advisory, and sets timeouts from the measure', async () => {
    const { deps, published, reached } = getInit({ files: WITH_CI, runs: { 'pnpm run lint': [FAIL, FAIL], 'pnpm run build': [FAIL, PASS] } });

    await initProject(deps, { ...LINEAR, verify: true });

    expect(factoryOf(published).checks.map(({ id, blocking, timeout }) => ({ id, blocking, timeout }))).toEqual([
      { id: 'test', blocking: true, timeout: '30s' },
      { id: 'lint', blocking: false, timeout: '30s' },
      { id: 'typecheck', blocking: true, timeout: '30s' },
      { id: 'format-check', blocking: true, timeout: '30s' },
      { id: 'audit', blocking: true, timeout: '30s' },
      { id: 'build', blocking: false, timeout: '30s' },
      { id: 'test-e2e', blocking: true, timeout: '30s' },
      { id: 'tests', blocking: true, timeout: '15m' },
      { id: 'security-scan', blocking: true, timeout: '15m' },
    ]);
    expect(reached).toContain('pnpm run lint');
  });
});

describe('the CI of the project while setting up', () => {
  const GITHUB = WITH_CI;

  it('names the workflow that builds main, so the revert step follows it', async () => {
    const { deps, published } = getInit({ files: GITHUB });

    const result = await initProject(deps, LINEAR);

    const workflow = published[0]?.files['.github/workflows/factory.yml'] ?? '';
    expect(workflow).toContain('workflows: ["CI"]');
    expect(result).toMatchObject({ ok: true, manual: [] });
    expect(parse(workflow).jobs).toHaveProperty('revert');
  });

  it('names a workflow without a name by its file, as GitHub does', async () => {
    const { deps, published } = getInit({ files: { ...PROJECT, '.github/workflows/ci.yml': CI(undefined) } });

    await initProject(deps, LINEAR);

    expect(published[0]?.files['.github/workflows/factory.yml']).toContain('workflows: [".github/workflows/ci.yml"]');
  });

  it('uses the workflow that holds the checks when the project has several', async () => {
    const { deps, published } = getInit({ files: { ...PROJECT, '.github/workflows/docs.yml': 'name: Docs\non: push\njobs:\n  site:\n    steps:\n      - run: echo hi\n', '.github/workflows/ci.yml': CI('CI') } });

    await initProject(deps, LINEAR);

    expect(published[0]?.files['.github/workflows/factory.yml']).toContain('workflows: ["CI"]');
  });

  it('does not mistake its own workflow for the one that builds main, when it is installed again', async () => {
    const { deps, published } = getInit({ files: { ...PROJECT, '.github/workflows/factory.yml': 'name: Factory\non: push\njobs:\n  record-merge:\n    steps:\n      - run: factory record-merge\n', '.github/workflows/build.yml': 'name: Build\non: push\njobs:\n  site:\n    steps:\n      - run: echo hi\n' } });

    await initProject(deps, LINEAR);

    expect(published[0]?.files['.github/workflows/factory.yml']).toContain('workflows: ["Build"]');
  });

  it('follows the only workflow of the project even when none of its jobs is a check', async () => {
    const { deps, published } = getInit({ files: { ...PROJECT, '.github/workflows/build.yml': 'name: Build\non: push\njobs:\n  site:\n    steps:\n      - run: echo hi\n' } });

    await initProject(deps, LINEAR);

    expect(published[0]?.files['.github/workflows/factory.yml']).toContain('workflows: ["Build"]');
  });

  it('leaves the revert step out, and says so, when it cannot tell which workflow builds main', async () => {
    const { deps, published } = getInit({ files: { ...PROJECT, '.github/workflows/a.yml': 'name: A\non: push\njobs:\n  x:\n    steps:\n      - run: echo a\n', '.github/workflows/b.yml': 'name: B\non: push\njobs:\n  y:\n    steps:\n      - run: echo b\n' } });

    const result = await initProject(deps, LINEAR);

    expect(published[0]?.files['.github/workflows/factory.yml']).not.toContain('workflow_run');
    expect(result).toMatchObject({ ok: true, manual: ['The revert step was left out: name the workflow that builds the main branch, then run the install again.'] });
  });

  it('adds nothing to a project without CI, and says what to run by hand', async () => {
    const { deps, published } = getInit();

    const result = await initProject(deps, LINEAR);

    expect(Object.keys(published[0]?.files ?? {})).not.toContain('.github/workflows/factory.yml');
    expect(result).toMatchObject({ ok: true, secrets: [] });
  });
});

describe('what setting up refuses', () => {
  it('passes on the refusals of the service account check, with no pull request', async () => {
    const { deps, published, opened } = getInit({ access: { comment: true, transition: false } });

    expect(await initProject(deps, LINEAR)).toMatchObject({ ok: false, reason: 'service_account' });
    expect(await initProject(getInit({ reenter: true }).deps, JIRA)).toMatchObject({ ok: false, reason: 'claim_lock' });
    expect([...published, ...opened]).toEqual([]);
  });

  it('tells what it settled on, so the person can say if something is wrong', async () => {
    const { deps } = getInit({ branch: 'trunk' });

    const result = await initProject(deps, LINEAR);

    expect(result).toMatchObject({
      ok: true,
      summary: [
        'Tracker: Linear, team PAY, key in LINEAR_API_KEY',
        'Repository: acme/billing-service on github, branch trunk, token in GH_TOKEN',
        'Checks, all blocking: test, lint, typecheck, format-check, audit, build, test-e2e',
        'Statuses: to_refine=Backlog, spec_review=Spec review, ready_for_dev=Ready for Dev, in_development=In Progress, in_review=In Review, blocked=Blocked, done=Done',
        'Every risk level starts in shadow mode, with no sensitive paths and no staging watch. Change them later with /factory-workflow.',
      ],
    });
  });

  it('names the advisory checks in the summary', async () => {
    const { deps } = getInit({ runs: { 'pnpm run lint': [FAIL, FAIL], 'pnpm run build': [FAIL, PASS] } });

    const result = await initProject(deps, { ...LINEAR, verify: true });

    expect(result).toMatchObject({ ok: true, summary: expect.arrayContaining(['Checks, blocking: test, typecheck, format-check, audit, test-e2e. Advisory, because they fail or are flaky on this branch: lint, build']) });
  });
});
