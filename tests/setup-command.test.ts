import { describe, expect, it } from 'vitest';
import type { OpenPullRequest } from '../src/adapters/source-control.js';
import type { Access, ProviderStatus } from '../src/adapters/ticket-provider.js';
import { setupCommand } from '../src/cli/setup-command.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { engineFiles } from '../src/setup/engine-files.js';
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
  '  factory init --ticket <KEY> --team <key> | --base-url <url> --filter <jql> [options]',
  '  factory init detect [--verify]',
  '  options: --project <name> --token-env <name> --email-env <name> --repository <owner/name> --main-branch <name>',
  '           --source-control github|bitbucket --source-token-env <name> --source-username-env <name>',
  '           --statuses "state=Status;state=Status" --sensitive-paths <a,b> --verify',
  '  factory workflow --title <text> [--preview]',
  'Add --json to any command for one line of JSON.',
];

const HEALTHY: Readonly<Record<string, string>> = {
  ...engineFiles(ENGINE_VERSION),
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
          defaultBranch: async () => 'main',
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
    const { run } = getSetup({ ...HEALTHY, ...engineFiles('9.0.0'), '.factory/factory.yaml': FACTORY.replace(`engine: ${ENGINE_VERSION}`, 'engine: 9.0.0') });

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

const NEW_PROJECT: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ scripts: { test: 'vitest run' }, dependencies: { react: '19' }, devDependencies: { typescript: '5' } }),
  'pnpm-lock.yaml': '',
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

  const ALL_STATUSES = ['To refine', 'Spec review', 'Ready for Dev', 'In development', 'In review', 'Blocked', 'Done'].map((name) => ({ name, category: 'todo' as const }));

  it('sets the project up from the Linear team, and says what it settled on', async () => {
    const setup = getSetup(NEW_PROJECT, { statuses: ALL_STATUSES });

    const { out, code, errors } = await setup.run('init', '--ticket', 'PAY-1', '--team', 'PAY');

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(out).toEqual([
      'Opened https://github.com/acme/billing-service/pull/78',
      'Tracker: Linear, team PAY, key in LINEAR_API_KEY',
      'Repository: acme/billing-service on github, branch main, token in GH_TOKEN',
      'Checks, all blocking: test',
      'Statuses: to_refine=To refine, spec_review=Spec review, ready_for_dev=Ready for Dev, in_development=In development, in_review=In review, blocked=Blocked, done=Done',
      'Every risk level starts in shadow mode, with no sensitive paths and no staging watch. Change them later with /factory-workflow.',
      'By hand:',
      expect.stringMatching(/^- No CI system was found\./),
    ]);
    expect(setup.accessed).toEqual(['PAY-1']);
    expect(setup.opened).toEqual(['factory/install']);
  });

  it('lists the secrets to store when the project has CI, and passes every option on', async () => {
    const ci = { ...NEW_PROJECT, 'bitbucket-pipelines.yml': 'pipelines:\n  default:\n    - step:\n        name: Test\n        script:\n          - pnpm test\n' };
    const setup = getSetup(ci, { statuses: ALL_STATUSES, runs: [{ exitCode: 1, output: 'x', timedOut: false }, { exitCode: 1, output: 'x', timedOut: false }] });

    const { out, errors } = await setup.run('init', '--ticket', 'PAY-1', '--base-url', 'https://acme.atlassian.net', '--filter', 'project = PAY', '--token-env', 'T', '--email-env', 'E', '--repository', 'acme/other', '--main-branch', 'develop', '--source-control', 'bitbucket', '--source-token-env', 'BT', '--source-username-env', 'BU', '--sensitive-paths', 'src/auth/**,db/**', '--statuses', 'blocked=Blocked', '--project', 'Billing', '--verify');

    expect(errors).toEqual([]);
    expect(out[1]).toBe('Tracker: Jira, https://acme.atlassian.net, key in T');
    expect(out[2]).toBe('Repository: acme/other on bitbucket, branch develop, token in BT');
    expect(out[3]).toMatch(/^Checks, blocking: .* Advisory, because they fail or are flaky on this branch: test/);
    expect(out).toContain('Store these CI secrets: T, E, BT, BU');
    expect(setup.published[0]?.files['.factory/factory.yaml']).toContain('src/auth/**');
    expect(setup.published[0]?.files['.factory/adapters.yaml']).toContain('base_url: https://acme.atlassian.net');
  });

  it('leaves out the steps by hand when CI does everything, and takes the statuses the person chose', async () => {
    const few = ['To refine', 'Backlog', 'Doing', 'Done', 'Ready for Dev'].map((name) => ({ name, category: 'todo' as const }));
    const ci = { ...NEW_PROJECT, '.github/workflows/ci.yml': 'name: CI\njobs:\n  t:\n    steps:\n      - run: pnpm test\n' };

    const { out, errors } = await getSetup(ci, { statuses: few }).run('init', '--ticket', 'PAY-1', '--team', 'PAY', '--source-control', 'github', '--statuses', 'spec_review=Backlog;in_review=Doing;blocked=Doing');

    expect(errors).toEqual([]);
    expect(out).not.toContain('By hand:');
    expect(out.at(-1)).toMatch(/^Store these CI secrets: FACTORY_/);
    expect(out).toContain('Statuses: to_refine=To refine, spec_review=Backlog, ready_for_dev=Ready for Dev, in_development=Doing, in_review=Doing, blocked=Doing, done=Done');
  });

  it('answers with the result as JSON', async () => {
    const { out } = await getSetup(NEW_PROJECT, { statuses: ALL_STATUSES }).run('init', '--ticket', 'PAY-1', '--team', 'PAY', '--json');

    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, url: 'https://github.com/acme/billing-service/pull/78', summary: expect.any(Array) });
  });

  it('says what is missing, and what to choose from, and opens nothing', async () => {
    const setup = getSetup(NEW_PROJECT);

    const tracker = await setup.run('init', '--ticket', 'PAY-1');
    const statuses = await setup.run('init', '--ticket', 'PAY-1', '--team', 'PAY');

    expect(tracker).toEqual({ code: 1, out: [], errors: ['Missing: --team (Linear), or --base-url and --filter (Jira)'] });
    expect(statuses.code).toBe(1);
    expect(statuses.errors).toEqual([expect.stringMatching(/^No status matches to_refine, spec_review, ready_for_dev, in_development, in_review, blocked\. Choose one for each with --statuses "to_refine=<status>;/)]);
    expect(setup.opened).toEqual([]);
  });

  it('refuses when the service account lacks a permission', async () => {
    const refused = await getSetup(NEW_PROJECT, { statuses: ALL_STATUSES, access: { comment: true, transition: false } }).run('init', '--ticket', 'PAY-1', '--team', 'PAY');

    expect(refused).toEqual({ code: 1, out: [], errors: ['The service account cannot change the status of PAY-1. Grant the missing permission in Linear, then run the install again. No pull request was opened.'] });
  });

  it.each([
    [['--statuses', 'sleeping=Done'], 'Unknown state "sleeping" in --statuses. Use: to_refine, spec_review, ready_for_dev, in_development, in_review, blocked, done'],
    [['--statuses', 'done'], 'The state "done" in --statuses needs a status: done=<status>'],
    [['--statuses', 'done='], 'The state "done" in --statuses needs a status: done=<status>'],
    [['--source-control', 'gitlab'], 'Unknown source control "gitlab". Use github or bitbucket'],
  ])('refuses a wrong option (%j)', async (option, message) => {
    expect(await getSetup(NEW_PROJECT, { statuses: ALL_STATUSES }).run('init', '--ticket', 'PAY-1', '--team', 'PAY', ...option)).toEqual({ code: 1, out: [], errors: [message] });
  });

  it('shows the usage when the ticket is missing', async () => {
    expect((await getSetup(NEW_PROJECT).run('init', '--team', 'PAY')).code).toBe(2);
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
