import { describe, expect, it } from 'vitest';
import type { Access } from '../src/adapters/ticket-provider.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { runDoctor } from '../src/setup/doctor.js';
import { createInMemoryProjectFiles } from '../src/setup/project-files.js';

const FACTORY = `
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm run test }
  - { id: lint, station: quality, kind: script, blocking: false, timeout: 90s, run: pnpm run lint }
  - { id: security-scan, station: review, kind: script, source: ci, blocking: true, timeout: 5m, job: Security scan }
  - { id: e2e, station: review, kind: script, source: ci, blocking: true, timeout: 5m }
  - { id: ui-design, station: review, kind: agent, blocking: true, timeout: 10m, criteria: .factory/checks/ui-design.md, evidence: screenshots }
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`;

const ADAPTERS = `
repository: acme/billing-service
ticket_providers:
  - { kind: jira, base_url: "https://acme.atlassian.net", filter: project = PAY, token_env: JIRA_TOKEN, email_env: JIRA_EMAIL }
source_control: { kind: github, repo: acme/billing-service, token_env: GH_TOKEN }
agent_runtime: { kind: orca }
`;

const CI = `
jobs:
  security:
    name: Security scan
    steps:
      - run: trivy fs .
  e2e:
    steps:
      - run: pnpm exec playwright test
`;

const FACTORY_CI = `
env:
  JIRA_TOKEN: \${{ secrets.FACTORY_JIRA_TOKEN }}
  JIRA_EMAIL: \${{ secrets.FACTORY_JIRA_EMAIL }}
jobs:
  record-merge:
    steps:
      - run: factory record-merge --commit \${{ github.sha }}
  revert:
    steps:
      - run: factory revert --commit \${{ github.event.workflow_run.head_sha }}
`;

const PACKAGE = JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' }, devDependencies: { typescript: '5' } });

const HEALTHY: Readonly<Record<string, string>> = {
  '.factory/factory.yaml': FACTORY,
  '.factory/adapters.yaml': ADAPTERS,
  '.github/workflows/ci.yml': CI,
  '.github/workflows/factory.yml': FACTORY_CI,
  'package.json': PACKAGE,
  'pnpm-lock.yaml': '',
};

type Options = Parameters<typeof runDoctor>[1];

const examine = async (files: Readonly<Record<string, string>>, options: Partial<Options> = {}, world: { readonly runs?: Readonly<Record<string, readonly ScriptRun[]>>; readonly access?: Access | Error; readonly reenter?: boolean } = {}) => {
  const reentered: { key: string; status: string }[] = [];
  const queues = Object.fromEntries(Object.entries(world.runs ?? {}).map(([command, runs]) => [command, [...runs]]));
  const commands: string[] = [];
  const report = await runDoctor(
    {
      files: createInMemoryProjectFiles(files),
      now: () => '2026-11-21T08:00:00Z',
      runScript: async (command) => {
        commands.push(command);
        return queues[command]?.shift() ?? { exitCode: 0, output: 'ok', timedOut: false };
      },
      checkAccess: async () => {
        const access = world.access ?? { comment: true, transition: true };
        if (access instanceof Error) throw access;
        return access;
      },
      canReenter: async (request) => {
        reentered.push(request);
        return world.reenter ?? false;
      },
    },
    { runChecks: false, ...options },
  );
  return { report, commands, reentered, messages: report.findings.map((finding) => `${finding.kind}: ${finding.message}`) };
};

const without = (files: Readonly<Record<string, string>>, name: string): Readonly<Record<string, string>> => Object.fromEntries(Object.entries(files).filter(([path]) => path !== name));

describe('factory doctor', () => {
  it('finds nothing wrong in a healthy project, and runs nothing unless asked', async () => {
    const { report, commands } = await examine(HEALTHY);

    expect(report).toEqual({ ok: true, findings: [] });
    expect(commands).toEqual([]);
  });

  it('names the check and the job when a CI job was renamed', async () => {
    const renamed = { ...HEALTHY, '.github/workflows/ci.yml': CI.replace('name: Security scan', 'name: Security').replace('  e2e:', '  end-to-end:') };

    const { report, messages } = await examine(renamed);

    expect(report.ok).toBe(false);
    expect(messages).toEqual([
      'ci_job: Check security-scan reads the CI job "Security scan", which no CI file defines',
      'ci_job: Check e2e reads the CI job "e2e", which no CI file defines',
    ]);
  });

  it('lists a script that no gate uses', async () => {
    const more = { ...HEALTHY, 'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit' }, devDependencies: { typescript: '5' } }) };

    expect((await examine(more)).messages).toEqual(['unused_script: No gate uses "pnpm run typecheck" (types)']);
  });

  it('does not take a CI job for an unused script', async () => {
    const localOnly = { ...HEALTHY, '.factory/factory.yaml': FACTORY.split('\n').filter((line) => !line.includes('source: ci')).join('\n') };

    expect((await examine(localOnly)).messages).toEqual([]);
  });

  it('says which factory CI steps are missing, counting the watch only when it is on', async () => {
    const noSteps = without(HEALTHY, '.github/workflows/factory.yml');
    const watching = { ...HEALTHY, '.factory/factory.yaml': `${FACTORY}watch: { enabled: true, checks: [./smoke.sh] }\n` };

    expect((await examine(noSteps)).messages).toEqual([
      'ci_step: The CI pipeline does not run "factory record-merge"',
      'ci_step: The CI pipeline does not run "factory revert"',
      'ci_secret: No CI file passes JIRA_TOKEN to the factory steps: the service account is not set up',
      'ci_secret: No CI file passes JIRA_EMAIL to the factory steps: the service account is not set up',
    ]);
    expect((await examine(watching)).messages).toEqual(['ci_step: The CI pipeline does not run "factory watch"']);
  });

  it('does not ask for CI secrets in a project with no CI file, or with a provider that names none', async () => {
    const noCi = without(without(HEALTHY, '.github/workflows/factory.yml'), '.github/workflows/ci.yml');
    const bare = { ...HEALTHY, '.github/workflows/factory.yml': FACTORY_CI.replace(/env:[\s\S]*?jobs:/, 'jobs:'), '.factory/adapters.yaml': ADAPTERS.replace(', token_env: JIRA_TOKEN, email_env: JIRA_EMAIL', '') };

    expect((await examine(noCi)).messages.filter((message) => message.startsWith('ci_secret'))).toEqual([]);
    expect((await examine(bare)).messages).toEqual([]);
  });

  it('reports a secret written in the configuration', async () => {
    const leaked = { ...HEALTHY, '.factory/adapters.yaml': ADAPTERS.replace('token_env: JIRA_TOKEN', 'token: ATATT3xFfGF0abc') };

    expect((await examine(leaked)).messages).toEqual(['secret: .factory/adapters.yaml: ticket_providers.0.token: Secrets must not be stored in adapters.yaml']);
  });

  it('reports a configuration that is missing or invalid, and stops there for factory.yaml', async () => {
    const invalid = { ...HEALTHY, '.factory/factory.yaml': FACTORY.replace('timeout: 6m', 'timeout: soon'), '.factory/adapters.yaml': ADAPTERS.replace('kind: orca', 'kind: other') };

    expect((await examine({})).messages).toEqual(['config: .factory/factory.yaml is missing. Run /factory-init', 'config: .factory/adapters.yaml is missing. Run /factory-init']);
    expect((await examine(invalid)).messages).toEqual([
      'config: .factory/factory.yaml: checks.0.timeout: Use a number followed by s, m or h, such as 90s or 6m',
      'config: .factory/adapters.yaml: agent_runtime.kind: Invalid input: expected "orca"',
    ]);
  });

  it('still checks the pipeline when only adapters.yaml is broken', async () => {
    const broken = { ...without(HEALTHY, '.github/workflows/factory.yml'), '.factory/adapters.yaml': 'repository: [' };

    const { messages } = await examine(broken);

    expect(messages[0]).toMatch(/^config: \.factory\/adapters\.yaml: /);
    expect(messages.slice(1)).toEqual(['ci_step: The CI pipeline does not run "factory record-merge"', 'ci_step: The CI pipeline does not run "factory revert"']);
  });

  it('says when the project pins another engine', async () => {
    expect((await examine(HEALTHY, { engine: '0.2.0' })).messages).toEqual(['engine: .factory/factory.yaml pins engine 0.1.0, and this is engine 0.2.0']);
    expect((await examine(HEALTHY, { engine: '0.1.9' })).messages).toEqual([]);
  });

  it('asks for a migration when the engine has a newer schema, and for an upgrade when the project is ahead', async () => {
    const upgrade = { target: 2, migrations: [{ from: 1, summary: 'x', apply: (config: Readonly<Record<string, unknown>>) => config }] };
    const ahead = { ...HEALTHY, '.factory/factory.yaml': FACTORY.replace('schema: 1', 'schema: 2') };

    expect((await examine(HEALTHY, { upgrade })).messages).toEqual(['schema: .factory/factory.yaml uses schema 1. Run "factory migrate" and open a pull request with the result']);
    expect((await examine(ahead)).messages).toEqual(['schema: factory.yaml uses schema 2, newer than this engine understands (1). Upgrade the engine.']);
  });

  it('runs the local checks when asked, and tells a flaky check from a failing one', async () => {
    const failed: ScriptRun = { exitCode: 1, output: 'boom', timedOut: false };

    const { messages, commands } = await examine(HEALTHY, { runChecks: true }, { runs: { 'pnpm run test': [failed], 'pnpm run lint': [failed, failed] } });

    expect(messages).toEqual(['flaky_check: Check unit-tests failed, then passed on a second run: it is flaky', 'failing_check: Check lint fails on the current code']);
    expect(commands).toEqual(['pnpm run test', 'pnpm run test', 'pnpm run lint', 'pnpm run lint']);
    expect((await examine(HEALTHY, { runChecks: true })).messages).toEqual([]);
  });

  it('leaves the checks that run in CI to CI', async () => {
    const withCiRun = { ...HEALTHY, '.factory/factory.yaml': FACTORY.replace('source: ci, blocking: true, timeout: 5m, job: Security scan', 'source: ci, blocking: true, timeout: 5m, job: Security scan, run: trivy fs .') };

    const { commands } = await examine(withCiRun, { runChecks: true });

    expect(commands).toEqual(['pnpm run test', 'pnpm run lint']);
  });

  it('checks what the account may do on a ticket when given one', async () => {
    const lacking = await examine(HEALTHY, { ticket: 'PAY-142' }, { access: { comment: false, transition: false } });
    const readOnly = await examine(HEALTHY, { ticket: 'PAY-142' }, { access: { comment: true, transition: false } });
    const expired = await examine(HEALTHY, { ticket: 'PAY-142' }, { access: new Error('Jira answered 401 to GET /rest/api/2/mypermissions') });
    const missing = await examine({}, { ticket: 'PAY-142' }, { access: new Error('Set the JIRA_TOKEN environment variable') });

    expect(lacking.messages).toEqual(['service_account: The account cannot comment on PAY-142', 'service_account: The account cannot change the status of PAY-142']);
    expect(readOnly.messages).toEqual(['service_account: The account cannot change the status of PAY-142']);
    expect(expired.messages).toEqual(['service_account: The account could not be checked on PAY-142: Jira answered 401 to GET /rest/api/2/mypermissions']);
    expect(missing.messages.at(-1)).toBe('service_account: The account could not be checked on PAY-142: Set the JIRA_TOKEN environment variable');
    expect((await examine(HEALTHY, { ticket: 'PAY-142' })).report.ok).toBe(true);
  });

  it('checks that a claimed ticket cannot be claimed again, by the status the project calls in development', async () => {
    const broken = await examine(HEALTHY, { ticket: 'PAY-142' }, { reenter: true });
    const sound = await examine(HEALTHY, { ticket: 'PAY-142' });
    const unconfigured = await examine({}, { ticket: 'PAY-142' }, { reenter: true });

    expect(broken.messages).toEqual(['claim_lock: The workflow lets a ticket move from "In development" to "In development", so two developers could claim the same ticket. Remove that transition from the workflow']);
    expect(sound.reentered).toEqual([{ key: 'PAY-142', status: 'In development' }]);
    expect(unconfigured.reentered).toEqual([]);
    expect((await examine(HEALTHY)).reentered).toEqual([]);
  });

  it('reports a failure that is not an error object too', async () => {
    const report = await runDoctor(
      { files: createInMemoryProjectFiles(HEALTHY), now: () => '2026-11-21T08:00:00Z', runScript: async () => ({ exitCode: 0, output: '', timedOut: false }), checkAccess: () => Promise.reject('offline'), canReenter: async () => false },
      { runChecks: false, ticket: 'PAY-142' },
    );

    expect(report.findings).toEqual([{ kind: 'service_account', message: 'The account could not be checked on PAY-142: offline' }]);
  });
});
