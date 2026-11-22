import { describe, expect, it } from 'vitest';
import { parseAdaptersConfig, parseFactoryConfig } from '../src/config/project-config.js';
import { detectProject } from '../src/setup/detect.js';
import { buildInstall, type InstallAnswers } from '../src/setup/install.js';
import { engineFiles } from '../src/setup/engine-files.js';
import { createInMemoryProjectFiles } from '../src/setup/project-files.js';

const getAnswers = (overrides?: Partial<InstallAnswers>): InstallAnswers => ({
  engine: '0.1.0',
  repository: 'acme/billing-service',
  mainBranch: 'main',
  states: { to_refine: 'Backlog', spec_review: 'Spec review', ready_for_dev: 'Ready for Dev', in_development: 'In Progress', in_review: 'In Review', blocked: 'Blocked', done: 'Done' },
  checks: [
    { id: 'test', category: 'tests', source: 'local', run: 'pnpm run test', blocking: true, timeout: '6m' },
    { id: 'lint', category: 'lint', source: 'local', run: 'pnpm run lint', blocking: false, timeout: '30s' },
    { id: 'security-scan', category: 'security', source: 'ci', job: 'security-scan', blocking: true, timeout: '15m' },
    { id: 'test-e2e', category: 'e2e', source: 'local', run: 'pnpm run test:e2e', blocking: true, timeout: '10m' },
  ],
  sensitivePaths: ['src/auth/**', 'src/billing/**'],
  ticketProvider: { kind: 'jira', baseUrl: 'https://acme.atlassian.net', filter: 'project = PAY', tokenEnv: 'JIRA_TOKEN', emailEnv: 'JIRA_EMAIL' },
  sourceControl: { kind: 'github', tokenEnv: 'GH_TOKEN' },
  ci: { system: 'github-actions', workflow: 'CI' },
  ...overrides,
});

const factoryOf = (answers: InstallAnswers) => {
  const parsed = parseFactoryConfig(buildInstall(answers).files['.factory/factory.yaml'] ?? '');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

describe('the files of an install', () => {
  it('writes a factory.yaml the factory accepts, with every chosen check at its station and every level in shadow mode', () => {
    const config = factoryOf(getAnswers());

    expect(config).toMatchObject({ schema: 1, engine: '0.1.0', main_branch: 'main', states: { to_refine: 'Backlog', in_development: 'In Progress' }, labels: { auto: 'factory-auto', no_automerge: 'factory:no-automerge' } });
    expect(config.checks).toEqual([
      { id: 'test', station: 'quality', kind: 'script', source: 'local', blocking: true, timeout: '6m', run: 'pnpm run test' },
      { id: 'lint', station: 'quality', kind: 'script', source: 'local', blocking: false, timeout: '30s', run: 'pnpm run lint' },
      { id: 'security-scan', station: 'review', kind: 'script', source: 'ci', blocking: true, timeout: '15m', job: 'security-scan' },
      { id: 'test-e2e', station: 'review', kind: 'script', source: 'local', blocking: true, timeout: '10m', run: 'pnpm run test:e2e' },
    ]);
    expect(config.risk).toMatchObject({ low: { merge: 'auto' }, medium: { merge: 'human', reviewers: 1 }, high: { merge: 'human', reviewers: 2 }, sensitive_paths: ['src/auth/**', 'src/billing/**'], shadow: true });
    expect(config.watch.enabled).toBe(false);
  });

  it.each([
    ['types', 'quality'],
    ['format', 'quality'],
    ['build', 'quality'],
  ] as const)('puts a %s check at the %s station', (category, station) => {
    const config = factoryOf(getAnswers({ checks: [{ id: 'x', category, source: 'local', run: 'x', blocking: true, timeout: '1m' }] }));

    expect(config.checks[0]?.station).toBe(station);
  });

  it('keeps the labels the project chose', () => {
    expect(factoryOf(getAnswers({ labels: { auto: 'auto-build', no_automerge: 'hands-off' } })).labels).toEqual({ auto: 'auto-build', no_automerge: 'hands-off' });
  });

  it('writes an adapters.yaml with the names of the environment variables, and no secret', () => {
    const { files } = buildInstall(getAnswers({ sourceControl: { kind: 'bitbucket', tokenEnv: 'BB_TOKEN', usernameEnv: 'BB_USER' } }));
    const parsed = parseAdaptersConfig(files['.factory/adapters.yaml'] ?? '');

    expect(parsed).toEqual({
      ok: true,
      value: {
        repository: 'acme/billing-service',
        ticket_providers: [{ kind: 'jira', base_url: 'https://acme.atlassian.net', filter: 'project = PAY', token_env: 'JIRA_TOKEN', email_env: 'JIRA_EMAIL' }],
        source_control: { kind: 'bitbucket', repo: 'acme/billing-service', token_env: 'BB_TOKEN', username_env: 'BB_USER' },
        agent_runtime: { kind: 'orca' },
      },
    });
    expect(buildInstall(getAnswers()).files['.factory/adapters.yaml']).not.toContain('username_env');
  });

  it('writes a Linear connection with its team, its project when one is set, and only the API key to store', () => {
    const linear = getAnswers({ ticketProvider: { kind: 'linear', team: 'PAY', project: 'Billing service', tokenEnv: 'LINEAR_API_KEY' } });
    const { files, secrets } = buildInstall(linear);
    const parsed = parseAdaptersConfig(files['.factory/adapters.yaml'] ?? '');
    const teamOnly = buildInstall(getAnswers({ ticketProvider: { kind: 'linear', team: 'PAY', tokenEnv: 'LINEAR_API_KEY' } }));

    expect(parsed.ok && parsed.value.ticket_providers).toEqual([{ kind: 'linear', team: 'PAY', project: 'Billing service', token_env: 'LINEAR_API_KEY' }]);
    expect(teamOnly.files['.factory/adapters.yaml']).not.toContain('project');
    expect(secrets).toEqual(['FACTORY_REPO_TOKEN', 'FACTORY_LINEAR_API_KEY']);
    expect(files['.github/workflows/factory.yml']).toContain('  LINEAR_API_KEY: ${{ secrets.FACTORY_LINEAR_API_KEY }}');
    expect(buildInstall(getAnswers({ ...linear, ci: { system: 'bitbucket-pipelines' } })).secrets).toEqual(['FACTORY_REPO_TOKEN', 'LINEAR_API_KEY', 'GH_TOKEN']);
  });

  it('installs the engine in the project: its pin, a launcher that runs it, and a gitignore for its install', () => {
    const install = buildInstall(getAnswers({ engine: '0.3.1' }));

    expect(install.files).toMatchObject(engineFiles('0.3.1'));
    expect(JSON.parse(install.files['.factory/package.json'] ?? '').dependencies['software-factory']).toMatch(/#v0\.3\.1$/);
    expect(install.executable).toEqual(['.factory/bin/factory']);
  });

  it('adds the folder for agent check rubrics', () => {
    expect(buildInstall(getAnswers()).files['.factory/checks/README.md']).toContain('# Agent check rubrics');
  });

  it('refuses answers that would give an invalid configuration, naming the file and the field', () => {
    const secret = getAnswers({ ticketProvider: { kind: 'jira', baseUrl: 'https://acme.atlassian.net', filter: 'ATATT3xFfGF0-secret', tokenEnv: 'JIRA_TOKEN', emailEnv: 'JIRA_EMAIL' } });
    const noRun = getAnswers({ checks: [{ id: 'test', category: 'tests', source: 'local', blocking: true, timeout: '6m' }] });

    expect(() => buildInstall(secret)).toThrow('.factory/adapters.yaml: ticket_providers.0.filter: Secrets must not be stored in adapters.yaml');
    expect(() => buildInstall(noRun)).toThrow(/^\.factory\/factory\.yaml: checks\.0/);
  });
});

describe('the CI steps of an install on GitHub', () => {
  it('adds record-merge on every push to main and revert when the main build fails, under the service account', async () => {
    const install = buildInstall(getAnswers());
    const workflow = install.files['.github/workflows/factory.yml'] ?? '';
    const detection = await detectProject({ files: createInMemoryProjectFiles({ '.github/workflows/factory.yml': workflow }) });

    expect(detection.ci.factorySteps).toEqual(['record-merge', 'revert']);
    expect(detection.ci.jobs.map((job) => [job.name, job.commands])).toEqual([
      ['record-merge', ['.factory/bin/factory record-merge --commit ${{ github.sha }}']],
      ['revert', ['.factory/bin/factory revert --commit ${{ github.event.workflow_run.head_sha }}']],
    ]);
    expect(workflow).toContain('  push:\n    branches: [main]\n  workflow_run:\n    workflows: ["CI"]\n    types: [completed]\n    branches: [main]\npermissions:');
    expect(workflow).toContain("    if: github.event_name == 'push'\n");
    expect(workflow).toContain("    if: github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'failure'\n");
    expect(workflow).toContain('env:\n  FACTORY_REPO_TOKEN: ${{ secrets.FACTORY_REPO_TOKEN }}\n  JIRA_TOKEN: ${{ secrets.FACTORY_JIRA_TOKEN }}\n  JIRA_EMAIL: ${{ secrets.FACTORY_JIRA_EMAIL }}\n  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\njobs:');
    expect(workflow).toContain('          fetch-depth: 0\n');
    expect(install.secrets).toEqual(['FACTORY_REPO_TOKEN', 'FACTORY_JIRA_TOKEN', 'FACTORY_JIRA_EMAIL']);
    expect(install.manual).toEqual([]);
  });

  it('adds the watch step only when the project has a staging watch', async () => {
    const watch = { checks: ['./smoke.sh'], duration: '10m', interval: '1m', environment: 'staging' };
    const workflow = buildInstall(getAnswers({ watch, mainBranch: 'trunk' })).files['.github/workflows/factory.yml'] ?? '';
    const detection = await detectProject({ files: createInMemoryProjectFiles({ '.github/workflows/factory.yml': workflow }) });

    expect(detection.ci.factorySteps).toEqual(['record-merge', 'revert', 'watch']);
    expect(workflow).toContain('    branches: [trunk]\n  deployment_status:\npermissions:');
    expect(workflow).toContain("    if: github.event_name == 'deployment_status' && github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'staging'\n");
    expect(workflow).toContain('.factory/bin/factory watch --commit ${{ github.event.deployment.sha }}');
    expect(factoryOf(getAnswers({ watch })).watch).toEqual({ enabled: true, checks: ['./smoke.sh'], duration: '10m', interval: '1m' });
    expect(buildInstall(getAnswers()).files['.github/workflows/factory.yml']).not.toContain('watch');
  });

  it('leaves the revert step out, and says so, when the main build workflow is not named', () => {
    const install = buildInstall(getAnswers({ ci: { system: 'github-actions' } }));

    expect(install.files['.github/workflows/factory.yml']).not.toContain('revert');
    expect(install.files['.github/workflows/factory.yml']).not.toContain('workflow_run');
    expect(install.manual).toEqual(['The revert step was left out: name the workflow that builds the main branch, then run the install again.']);
  });
});

describe('the CI steps of an install elsewhere', () => {
  it('gives the steps to add to the Bitbucket pipeline by hand, and the variables to create', () => {
    const answers = getAnswers({ ci: { system: 'bitbucket-pipelines' }, sourceControl: { kind: 'bitbucket', tokenEnv: 'BB_TOKEN', usernameEnv: 'BB_USER' } });
    const install = buildInstall(answers);
    const watched = buildInstall({ ...answers, watch: { checks: ['./smoke.sh'], duration: '10m', interval: '1m', environment: 'staging' } });

    expect(Object.keys(install.files)).not.toContain('.github/workflows/factory.yml');
    expect(install.manual).toEqual([
      'Add this step to bitbucket-pipelines.yml, under pipelines > branches > main:\n- step:\n    name: Factory record-merge\n    script:\n      - .factory/bin/factory record-merge --commit $BITBUCKET_COMMIT',
      'Add this after-script to the step that builds main:\nafter-script:\n  - if [ "$BITBUCKET_EXIT_CODE" != "0" ]; then .factory/bin/factory revert --commit $BITBUCKET_COMMIT; fi',
    ]);
    expect(watched.manual[2]).toBe('Add this step after the deployment to staging:\n- step:\n    name: Factory watch\n    script:\n      - .factory/bin/factory watch --commit $BITBUCKET_COMMIT');
    expect(install.secrets).toEqual(['FACTORY_REPO_TOKEN', 'JIRA_TOKEN', 'JIRA_EMAIL', 'BB_TOKEN', 'BB_USER']);
    expect(buildInstall({ ...answers, sourceControl: { kind: 'bitbucket', tokenEnv: 'BB_TOKEN' } }).secrets).toEqual(['FACTORY_REPO_TOKEN', 'JIRA_TOKEN', 'JIRA_EMAIL', 'BB_TOKEN']);
  });

  it('says what to run when the project has no CI', () => {
    const install = buildInstall(getAnswers({ ci: { system: 'none' } }));

    expect(Object.keys(install.files)).not.toContain('.github/workflows/factory.yml');
    expect(install.manual).toEqual(['No CI system was found. Run "factory record-merge" on every merge to the main branch, and "factory revert" when the main build fails, from whatever builds this project.']);
    expect(install.secrets).toEqual([]);
  });
});
