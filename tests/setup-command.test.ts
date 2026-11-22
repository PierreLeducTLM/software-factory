import { describe, expect, it } from 'vitest';
import type { Access } from '../src/adapters/ticket-provider.js';
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

const HEALTHY: Readonly<Record<string, string>> = {
  '.factory/factory.yaml': FACTORY,
  '.factory/adapters.yaml': ADAPTERS,
  '.github/workflows/factory.yml': FACTORY_CI,
  'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
  'pnpm-lock.yaml': '',
};

type World = { readonly runs?: readonly ScriptRun[]; readonly access?: Access; readonly broken?: string };

const getSetup = (files: Readonly<Record<string, string>>, world: World = {}) => {
  const runs = [...(world.runs ?? [])];
  const accessed: string[] = [];
  const published: PublishedChange[] = [];
  const opened: string[] = [];
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
          publishFiles: async (change) => void published.push(change),
          openPullRequest: async ({ branch }) => {
            opened.push(branch);
            return { url: 'https://github.com/acme/billing-service/pull/77' };
          },
        };
      },
      write: (line) => void out.push(line),
      writeError: (line) => void errors.push(line),
    });
    return { code, out, errors };
  };
  return { run, accessed, published, opened };
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

describe('setup commands', () => {
  it.each([[['doctor', '--ticket']], [['doctor', '--ticket', '--frobnicate']], [['doctor', '--ticket', 'PAY-1', 'PAY-2']], [['doctor', '--frobnicate', 'PAY-142']], [['migrate', 'PAY-142']], [['install']]])('shows the usage for %j', async (argv) => {
    const { code, out, errors } = await getSetup(HEALTHY).run(...argv);

    expect({ code, out }).toEqual({ code: 2, out: [] });
    expect(errors[0]).toBe('Usage: factory doctor [--run-checks] [--ticket <KEY>] [--json] | factory migrate [--json]');
  });

  it('reports a failure on its own line', async () => {
    expect(await getSetup(HEALTHY, { broken: 'Set the GH_TOKEN environment variable' }).run('migrate')).toEqual({ code: 1, out: [], errors: ['Set the GH_TOKEN environment variable'] });
  });
});
