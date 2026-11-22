import { describe, expect, it } from 'vitest';
import type { OpenPullRequest } from '../src/adapters/source-control.js';
import type { Access, ProviderStatus } from '../src/adapters/ticket-provider.js';
import { setupCommand } from '../src/cli/setup-command.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { createInMemoryProjectFiles } from '../src/setup/project-files.js';
import type { PublishedChange } from '../src/setup/project-files.js';
import { ENGINE_VERSION } from '../src/version.js';

const FACTORY = `
schema: 1
engine: ${ENGINE_VERSION}
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm run test }
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`;

const ADAPTERS = `
repository: acme/billing-service
ticket_providers:
  - { kind: jira, base_url: "https://acme.atlassian.net", filter: project = PAY, token_env: JIRA_TOKEN, email_env: JIRA_EMAIL }
source_control: { kind: github, repo: acme/billing-service, token_env: GH_TOKEN }
agent_runtime: { kind: orca }
`;

const FACTORY_CI = `
env:
  JIRA_TOKEN: \${{ secrets.FACTORY_JIRA_TOKEN }}
  JIRA_EMAIL: \${{ secrets.FACTORY_JIRA_EMAIL }}
jobs:
  record-merge:
    steps:
      - run: factory record-merge
  revert:
    steps:
      - run: factory revert
`;

const USAGE = [
  'Usage:',
  '  factory doctor [--run-checks] [--ticket <KEY>]',
  '  factory migrate',
  '  factory init detect [--verify]',
  '  factory init statuses --answers <file>',
  '  factory init install --answers <file> --ticket <KEY>',
  '  factory init pull-request --answers <file> --branch <name> --title <text> [--body <text>]',
  '  factory workflow --title <text> [--preview]',
  'Add --json to any command for one line of JSON.',
];

const HEALTHY: Readonly<Record<string, string>> = {
  '.factory/factory.yaml': FACTORY,
  '.factory/adapters.yaml': ADAPTERS,
  '.github/workflows/factory.yml': FACTORY_CI,
  'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
  'pnpm-lock.yaml': '',
};

type World = { readonly runs?: readonly ScriptRun[]; readonly access?: Access; readonly broken?: string; readonly main?: Readonly<Record<string, string>>; readonly statuses?: readonly ProviderStatus[] };

const getSetup = (files: Readonly<Record<string, string>>, world: World = {}) => {
  const runs = [...(world.runs ?? [])];
  const accessed: string[] = [];
  const published: PublishedChange[] = [];
  const opened: string[] = [];
  const requests: OpenPullRequest[] = [];
  const run = async (...argv: readonly string[]) => {
    const out: string[] = [];
    const errors: string[] = [];
    const code = await setupCommand({
      argv,
      deps: async () => {
        if (world.broken !== undefined) throw new Error(world.broken);
        return {
          files: createInMemoryProjectFiles(files),
          now: () => '2026-11-21T08:00:00Z',
          runScript: async () => runs.shift() ?? { exitCode: 0, output: 'ok', timedOut: false },
          checkAccess: async (key) => {
            accessed.push(key);
            return world.access ?? { comment: true, transition: true };
          },
          canReenter: async () => false,
          publishFiles: async (change) => void published.push(change),
          openPullRequest: async ({ branch }) => {
            opened.push(branch);
            return { url: 'https://github.com/acme/billing-service/pull/77' };
          },
          readFile: async (path) => {
            const text = files[path];
            if (text === undefined) throw new Error(`No such file: ${path}`);
            return text;
          },
          remoteUrl: async () => 'git@github.com:acme/billing-service.git',
          tickets: () => ({
            listStatuses: async () => world.statuses ?? [{ name: 'Done', category: 'done' as const }],
            checkAccess: async (key) => {
              accessed.push(key);
              return world.access ?? { comment: true, transition: true };
            },
            canReenter: async () => false,
          }),
          sourceControl: () => ({
            openPullRequest: async (request) => {
              requests.push(request);
              opened.push(request.branch);
              return { url: 'https://github.com/acme/billing-service/pull/78' };
            },
          }),
          mainFile: async (path) => world.main?.[path],
        };
      },
      write: (line) => void out.push(line),
      writeError: (line) => void errors.push(line),
    });
    return { code, out, errors };
  };
  return { run, accessed, published, opened, requests };
};

describe('factory doctor', () => {
  it('says so when the project has no drift', async () => {
    expect(await getSetup(HEALTHY).run('doctor')).toEqual({ code: 0, out: ['No drift found'], errors: [] });
  });

  it('lists each finding and fails, so a script can stop on drift', async () => {
    const { run } = getSetup({ ...HEALTHY, '.factory/adapters.yaml': ADAPTERS.replace('token_env: JIRA_TOKEN', 'token: ATATT3xFf') });

    expect(await run('doctor')).toEqual({
      code: 1,
      out: ['Drift found:', '- .factory/adapters.yaml: ticket_providers.0.token: Secrets must not be stored in adapters.yaml'],
      errors: [],
    });
  });

  it('runs the checks and checks the account only when asked', async () => {
    const setup = getSetup(HEALTHY, { runs: [{ exitCode: 1, output: 'boom', timedOut: false }], access: { comment: true, transition: false } });

    const asked = await setup.run('doctor', '--ticket', 'PAY-142', '--run-checks');

    expect(asked.out).toEqual(['Drift found:', '- Check unit-tests failed, then passed on a second run: it is flaky', '- The account cannot change the status of PAY-142']);
    expect(setup.accessed).toEqual(['PAY-142']);
  });

  it('answers with the report as JSON', async () => {
    const { run } = getSetup({ ...HEALTHY, '.factory/factory.yaml': FACTORY.replace(`engine: ${ENGINE_VERSION}`, 'engine: 9.0.0') });

    const { code, out } = await run('doctor', '--json');

    expect(code).toBe(1);
    expect(JSON.parse(out.join(''))).toEqual({ ok: false, findings: [{ kind: 'engine', message: `.factory/factory.yaml pins engine 9.0.0, and this is engine ${ENGINE_VERSION}` }] });
  });
});

describe('factory migrate', () => {
  const OLD = { ...HEALTHY, '.factory/factory.yaml': FACTORY.replace(`engine: ${ENGINE_VERSION}`, 'engine: 0.0.1') };

  it('opens the upgrade pull request and says where it is', async () => {
    const setup = getSetup(OLD);

    const { code, out, errors } = await setup.run('migrate');

    expect({ code, errors }).toEqual({ code: 0, errors: [] });
    expect(out).toEqual([`Opened https://github.com/acme/billing-service/pull/77, which moves the project from engine 0.0.1 to ${ENGINE_VERSION}. Nothing changes until it is merged.`]);
    expect(setup.opened).toEqual([`factory/upgrade-engine-${ENGINE_VERSION}`]);
  });

  it('says when there is nothing to upgrade, and opens nothing', async () => {
    const setup = getSetup(HEALTHY);

    const { code, out, errors } = await setup.run('migrate');

    expect({ code, errors }).toEqual({ code: 0, errors: [] });
    expect(out[0]).toMatch(/^Nothing to upgrade: /);
    expect(setup.published).toEqual([]);
  });

  it('refuses to move a project back to an older engine', async () => {
    const { code, out, errors } = await getSetup({ ...HEALTHY, '.factory/factory.yaml': FACTORY.replace(`engine: ${ENGINE_VERSION}`, 'engine: 9.0.0') }).run('migrate');

    expect({ code, out }).toEqual({ code: 1, out: [] });
    expect(errors).toEqual([`This project pins factory engine 9.0.0, newer than this engine (${ENGINE_VERSION}). Install engine 9.0.0 instead.`]);
  });

  it('answers with the result as JSON', async () => {
    const { out } = await getSetup(OLD).run('migrate', '--json');

    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, action: 'opened', url: 'https://github.com/acme/billing-service/pull/77' });
  });
});

const ANSWERS = JSON.stringify({
  engine: ENGINE_VERSION,
  repository: 'acme/billing-service',
  mainBranch: 'main',
  states: { to_refine: 'To refine', spec_review: 'Spec review', ready_for_dev: 'Ready for Dev', in_development: 'In development', in_review: 'In review', blocked: 'Blocked', done: 'Done' },
  checks: [{ id: 'unit-tests', category: 'tests', source: 'local', run: 'pnpm run test', blocking: true, timeout: '6m' }],
  sensitivePaths: [],
  ticketProvider: { kind: 'jira', baseUrl: 'https://acme.atlassian.net', filter: 'project = PAY', tokenEnv: 'JIRA_TOKEN', emailEnv: 'JIRA_EMAIL' },
  sourceControl: { kind: 'github', tokenEnv: 'GH_TOKEN' },
  ci: { system: 'github-actions', workflow: 'CI', install: 'npm install --global software-factory' },
});

const NEW_PROJECT: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ scripts: { test: 'vitest run' }, dependencies: { react: '19' }, devDependencies: { typescript: '5' } }),
  'pnpm-lock.yaml': '',
  'answers.json': ANSWERS,
};

describe('factory init', () => {
  it('describes the project, its coverage and what to add, and verifies the checks when asked', async () => {
    const setup = getSetup(NEW_PROJECT, { runs: [{ exitCode: 1, output: 'boom', timedOut: false }] });

    const detected = await setup.run('init', 'detect');
    const verified = await setup.run('init', 'detect', '--verify', '--json');

    expect(detected.code).toBe(0);
    expect(detected.out).toEqual([
      'Stack: typescript (React)',
      'Coverage:',
      '- tests: test',
      expect.stringMatching(/^- lint: none\. Recommended: lint \(pnpm add --dev eslint, /),
      expect.stringMatching(/^- types: none\. Recommended: typecheck \(/),
      expect.stringMatching(/^- format: none\. Recommended: format \(/),
      expect.stringMatching(/^- security: none\. Recommended: audit \(/),
      '- build: none',
      '- e2e: none',
    ]);
    expect(JSON.parse(verified.out.join(''))).toMatchObject({ engine: ENGINE_VERSION, detection: { remote: { repository: 'acme/billing-service' } }, verification: [{ id: 'test', status: 'flaky' }] });
    expect((await setup.run('init', 'detect', '--verify')).out.slice(-2)).toEqual(['Verified on this checkout:', expect.stringMatching(/^- test: pass in \d+s, timeout 30s$/)]);
  });

  it('lists every check found for a category', async () => {
    const { out } = await getSetup({ ...NEW_PROJECT, 'package.json': JSON.stringify({ scripts: { test: 'vitest run', 'test:unit': 'vitest run unit' }, devDependencies: { typescript: '5' } }) }).run('init', 'detect');

    expect(out).toContain('- tests: test, test-unit');
  });

  it('says when it only read the CI files of a stack it does not know', async () => {
    const { out } = await getSetup({ 'go.mod': 'module acme', '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: go test ./...\n' }).run('init', 'detect');

    expect(out.slice(0, 4)).toEqual(['Stack: other', 'In-depth detection is not available for this stack. Checks come from the CI files only.', 'Coverage:', '- tests: test']);
  });

  it('matches the statuses through the connection in the answers', async () => {
    const { out, code } = await getSetup(NEW_PROJECT).run('init', 'statuses', '--answers', 'answers.json');

    expect(code).toBe(0);
    expect(out).toEqual(['- done: Done', 'Not matched: to_refine, spec_review, ready_for_dev, in_development, in_review, blocked']);
  });

  it('asks nothing when every state found its status', async () => {
    const names = ['To refine', 'Spec review', 'Ready for Dev', 'In development', 'In review', 'Blocked', 'Done'];
    const statuses = names.map((name) => ({ name, category: 'todo' as const }));

    const { out } = await getSetup(NEW_PROJECT, { statuses }).run('init', 'statuses', '--answers', 'answers.json');

    expect(out).toEqual(['- to_refine: To refine', '- spec_review: Spec review', '- ready_for_dev: Ready for Dev', '- in_development: In development', '- in_review: In review', '- blocked: Blocked', '- done: Done']);
  });

  it('opens the install pull request, and says which secrets to store', async () => {
    const setup = getSetup(NEW_PROJECT);

    const { out, code } = await setup.run('init', 'install', '--answers', 'answers.json', '--ticket', 'PAY-1');

    expect(code).toBe(0);
    expect(out).toEqual(['Opened https://github.com/acme/billing-service/pull/78', 'Store these CI secrets: FACTORY_JIRA_TOKEN, FACTORY_JIRA_EMAIL']);
    expect(setup.accessed).toEqual(['PAY-1']);
    expect(setup.opened).toEqual(['factory/install']);
  });

  it('lists the steps to make by hand, and refuses when the service account lacks a permission', async () => {
    const manual = { ...NEW_PROJECT, 'answers.json': ANSWERS.replace('"system":"github-actions","workflow":"CI"', '"system":"none"') };

    const done = await getSetup(manual).run('init', 'install', '--answers', 'answers.json', '--ticket', 'PAY-1');
    const refused = await getSetup(NEW_PROJECT, { access: { comment: true, transition: false } }).run('init', 'install', '--answers', 'answers.json', '--ticket', 'PAY-1');

    expect(done.out).toEqual(['Opened https://github.com/acme/billing-service/pull/78', 'By hand:', expect.stringMatching(/^- No CI system was found\./)]);
    expect(refused).toEqual({ code: 1, out: [], errors: ['The service account cannot change the status of PAY-1. Grant the missing permission in Jira, then run the install again. No pull request was opened.'] });
  });

  it('opens the pull request of an added check', async () => {
    const setup = getSetup(NEW_PROJECT);

    const plain = await setup.run('init', 'pull-request', '--answers', 'answers.json', '--branch', 'factory/add-typecheck', '--title', 'chore: add a type check');
    const json = await setup.run('init', 'pull-request', '--answers', 'answers.json', '--branch', 'factory/add-lint', '--title', 'chore: add lint', '--body', 'Adds eslint.', '--json');

    expect(plain).toEqual({ code: 0, out: ['Opened https://github.com/acme/billing-service/pull/78'], errors: [] });
    expect(JSON.parse(json.out.join(''))).toEqual({ ok: true, url: 'https://github.com/acme/billing-service/pull/78' });
    expect(setup.requests).toEqual([
      { branch: 'factory/add-typecheck', base: 'main', title: 'chore: add a type check', body: '' },
      { branch: 'factory/add-lint', base: 'main', title: 'chore: add lint', body: 'Adds eslint.' },
    ]);
  });

  it('says which answers file it could not read', async () => {
    expect(await getSetup(NEW_PROJECT).run('init', 'statuses', '--answers', 'missing.json')).toEqual({ code: 1, out: [], errors: ['No such file: missing.json'] });
  });
});

describe('factory workflow', () => {
  const PROPOSED = { ...HEALTHY, '.factory/factory.yaml': FACTORY.replace('checks:\n', 'checks:\n  - { id: lint, station: quality, kind: script, blocking: true, timeout: 1m, run: pnpm run lint }\n') };

  it('shows the new pipeline and what it tried, and opens the pull request', async () => {
    const setup = getSetup(PROPOSED, { main: { '.factory/factory.yaml': FACTORY } });

    const preview = await setup.run('workflow', '--title', 'Add lint', '--preview');
    const opened = await setup.run('workflow', '--title', 'Add lint');

    expect(preview.code).toBe(0);
    expect(preview.out).toEqual([
      'build',
      'quality',
      '  - lint: blocking, pnpm run lint, timeout 1m',
      '  - unit-tests: blocking, pnpm run test, timeout 6m',
      'review',
      '  - openspec-verify: blocking, built in',
      '  - reviewer: blocking, built in',
      'pull request',
      'Added: lint',
      'Tried on main:',
      '- lint: pass',
      'Preview only: nothing was opened',
    ]);
    expect(opened.out.at(-1)).toBe('Opened https://github.com/acme/billing-service/pull/77');
    expect(setup.opened).toEqual(['factory/workflow-add-lint']);
  });

  it('shows what failed and opens nothing when a new blocking check fails on main', async () => {
    const setup = getSetup(PROPOSED, { main: { '.factory/factory.yaml': FACTORY }, runs: [{ exitCode: 1, output: 'lint error', timedOut: false }] });

    const { code, out, errors } = await setup.run('workflow', '--title', 'Add lint');

    expect(code).toBe(1);
    expect(out).toContain('- lint: fail');
    expect(errors).toEqual(['The blocking check lint fails on main. Fix main, or make the check advisory, then try again. No pull request was opened.']);
    expect(setup.opened).toEqual([]);
  });

  it('refuses a configuration the factory would not accept', async () => {
    const { code, errors } = await getSetup({ ...HEALTHY, '.factory/factory.yaml': 'schema: 1' }).run('workflow', '--title', 'x');

    expect(code).toBe(1);
    expect(errors[0]).toMatch(/^\.factory\/factory\.yaml: /);
    expect((await getSetup({ ...HEALTHY, '.factory/factory.yaml': 'schema: 1' }).run('workflow', '--title', 'x')).out).toEqual([]);
  });

  it('tries nothing when no check was added or changed', async () => {
    const setup = getSetup(HEALTHY, { main: { '.factory/factory.yaml': PROPOSED['.factory/factory.yaml'] ?? '' } });

    const { out } = await setup.run('workflow', '--title', 'Drop lint', '--preview');

    expect(out.slice(-2)).toEqual(['Removed: lint', 'Preview only: nothing was opened']);
  });
});

describe('setup commands', () => {
  it.each([[[]], [['init']], [['init', 'detect', '--answers', 'a.json']], [['init', 'statuses']], [['init', 'install', '--answers', 'a.json']], [['init', 'pull-request', '--answers', 'a.json', '--branch', 'b']], [['workflow']], [['workflow', '--title', 'x', '--title', 'y']], [['doctor', '--ticket']], [['doctor', '--ticket', '--frobnicate']], [['doctor', '--ticket', 'PAY-1', 'PAY-2']], [['doctor', '--frobnicate', 'PAY-142']], [['migrate', 'PAY-142']], [['install']]])('shows the usage for %j', async (argv) => {
    const { code, out, errors } = await getSetup(HEALTHY).run(...argv);

    expect({ code, out }).toEqual({ code: 2, out: [] });
    expect(errors).toEqual(USAGE);
  });

  it('reports a failure on its own line', async () => {
    expect(await getSetup(HEALTHY, { broken: 'Set the GH_TOKEN environment variable' }).run('migrate')).toEqual({ code: 1, out: [], errors: ['Set the GH_TOKEN environment variable'] });
  });
});
