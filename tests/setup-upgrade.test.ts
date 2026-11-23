import { parse } from 'yaml';
import { detectProject } from '../src/setup/detect.js';
import { describe, expect, it } from 'vitest';
import { engineFiles, enginePackage } from '../src/setup/engine-files.js';
import type { Migration } from '../src/setup/migrate.js';
import { createInMemoryProjectFiles, type PublishedChange } from '../src/setup/project-files.js';
import { upgradeProject } from '../src/setup/upgrade.js';

const FACTORY = `# Owned by the platform team. To move to another engine: run factory migrate
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm run test }
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`;

const RENAME_RISK: Migration = {
  from: 1,
  summary: 'risk is now called routing',
  apply: ({ risk, ...rest }) => ({ ...rest, routing: risk }),
};

const PROJECT = { '.factory/factory.yaml': FACTORY, ...engineFiles('0.1.0') };

type Options = Parameters<typeof upgradeProject>[1];

const upgrade = async (files: Readonly<Record<string, string>>, options: Options) => {
  const published: PublishedChange[] = [];
  const opened: { branch: string; base: string; title: string; body: string }[] = [];
  const result = await upgradeProject(
    {
      files: createInMemoryProjectFiles(files),
      publishFiles: async (change) => void published.push(change),
      openPullRequest: async (request) => {
        opened.push(request);
        return { url: `https://github.com/acme/billing-service/pull/${opened.length + 40}` };
      },
    },
    options,
  );
  return { result, published, opened };
};

describe('upgrading a project to a newer engine', () => {
  it('opens a pull request that pins the new engine, keeps the comments, and leaves the project as it is until merged', async () => {
    const files = PROJECT;

    const { result, published, opened } = await upgrade(files, { engine: '0.2.0' });

    expect(result).toEqual({ ok: true, action: 'opened', url: 'https://github.com/acme/billing-service/pull/41', from: { engine: '0.1.0', schema: 1 }, to: { engine: '0.2.0', schema: 1 }, applied: [] });
    expect(published).toEqual([
      {
        branch: 'factory/upgrade-engine-0.2.0',
        base: 'main',
        files: { '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', 'engine: 0.2.0'), '.factory/package.json': enginePackage('0.2.0') },
        executable: [],
        message: 'chore: upgrade the factory engine to 0.2.0',
      },
    ]);
    expect(opened).toEqual([
      {
        branch: 'factory/upgrade-engine-0.2.0',
        base: 'main',
        title: 'chore: upgrade the factory engine to 0.2.0',
        body: [
          'Moves this project from factory engine 0.1.0 to 0.2.0.',
          '',
          'The configuration schema stays at version 1.',
          '',
          'Updates .factory/package.json, which install and run the engine inside the project.',
          '',
          'Nothing changes until this pull request is merged: the project keeps running engine 0.1.0 until then.',
        ].join('\n'),
      },
    ]);
    expect(files['.factory/factory.yaml']).toBe(FACTORY);
  });

  it('migrates the schema in the same pull request, and lists each migration', async () => {
    const { result, published, opened } = await upgrade({ ...PROJECT, '.factory/factory.yaml': FACTORY.replace('schema: 1\n', 'schema: 1\nmain_branch: develop\n') }, { engine: '0.2.0', upgrade: { target: 2, migrations: [RENAME_RISK] } });

    expect(result).toMatchObject({ ok: true, action: 'opened', from: { schema: 1 }, to: { schema: 2 }, applied: ['risk is now called routing'] });
    expect(published.map(({ branch, base }) => ({ branch, base }))).toEqual([{ branch: 'factory/upgrade-engine-0.2.0', base: 'develop' }]);
    expect(parse(published[0]?.files['.factory/factory.yaml'] ?? '')).toMatchObject({ schema: 2, engine: '0.2.0', main_branch: 'develop', routing: { low: { merge: 'auto' } } });
    expect(parse(published[0]?.files['.factory/factory.yaml'] ?? '')).not.toHaveProperty('risk');
    expect(opened[0]?.base).toBe('develop');
    expect(opened[0]?.body.split('\n').slice(2, 5)).toEqual(['The configuration schema moves from version 1 to 2:', '- risk is now called routing', '']);
    expect(Object.keys(published[0]?.files ?? {})).toEqual(['.factory/factory.yaml', '.factory/package.json']);
  });

  it('opens a pull request for a schema change alone', async () => {
    const { result } = await upgrade(PROJECT, { engine: '0.1.4', upgrade: { target: 2, migrations: [RENAME_RISK] } });

    expect(result).toMatchObject({ ok: true, action: 'opened', from: { engine: '0.1.0', schema: 1 }, to: { engine: '0.1.4', schema: 2 } });
  });

  it('does nothing for a project already on this engine release and schema', async () => {
    const { result, published, opened } = await upgrade({ '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', 'engine: 0.1.2'), ...engineFiles('0.1.2') }, { engine: '0.1.7' });

    expect(result).toEqual({ ok: true, action: 'none', message: 'Nothing to upgrade: the project is on engine 0.1.2 and schema 1, which this engine (0.1.7) runs as they are.' });
    expect(published).toEqual([]);
    expect(opened).toEqual([]);
  });

  it.each([
    ['0.3.0', '0.2.9'],
    ['1.0.0', '0.9.0'],
    ['0.10.0', '0.9.0'],
  ])('never moves a project pinned to %s back to engine %s', async (pinned, running) => {
    const { result, published } = await upgrade({ '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', `engine: ${pinned}`) }, { engine: running });

    expect(result).toEqual({ ok: false, reason: 'newer_engine', message: `This project pins factory engine ${pinned}, newer than this engine (${running}). Install engine ${pinned} instead.` });
    expect(published).toEqual([]);
  });

  it.each([
    ['0.2.0', '0.10.0'],
    ['0.9.0', '1.0.0'],
  ])('moves a project pinned to %s forward to engine %s', async (pinned, running) => {
    const { result } = await upgrade({ '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', `engine: ${pinned}`) }, { engine: running });

    expect(result).toMatchObject({ ok: true, action: 'opened' });
  });

  it('installs the engine in a project that ran it from elsewhere, leaving its configuration alone', async () => {
    const { result, published, opened } = await upgrade({ '.factory/factory.yaml': FACTORY }, { engine: '0.1.5' });

    expect(result).toMatchObject({ ok: true, action: 'opened', from: { engine: '0.1.0' }, to: { engine: '0.1.0' } });
    expect(published[0]?.files).toEqual(engineFiles('0.1.0'));
    expect(published[0]?.executable).toEqual(['.factory/bin/factory']);
    expect(opened[0]?.title).toBe('chore: install the factory engine in the project');
    expect(opened[0]?.body).toBe(
      [
        'Updates .factory/package.json, .factory/bin/factory, .factory/.gitignore, which install and run the engine 0.1.0 inside the project.',
        '',
        'The project keeps its configuration and its engine pin. Nothing changes until this pull request is merged.',
      ].join('\n'),
    );
  });

  it('moves the pin alone when the project already installs the new engine, and says nothing about engine files', async () => {
    const { opened } = await upgrade({ '.factory/factory.yaml': FACTORY, ...engineFiles('0.2.0') }, { engine: '0.2.0' });

    expect(opened[0]?.body).toBe(
      [
        'Moves this project from factory engine 0.1.0 to 0.2.0.',
        '',
        'The configuration schema stays at version 1.',
        '',
        'Nothing changes until this pull request is merged: the project keeps running engine 0.1.0 until then.',
      ].join('\n'),
    );
  });

  it('brings an outdated launcher up to date and marks it executable, without touching the pin', async () => {
    const { published } = await upgrade({ ...PROJECT, '.factory/bin/factory': '#!/bin/sh\necho old\n' }, { engine: '0.1.5' });

    expect(Object.keys(published[0]?.files ?? {})).toEqual(['.factory/bin/factory']);
    expect(published[0]?.executable).toEqual(['.factory/bin/factory']);
  });

  it('refuses a project with no configuration, or one on a schema this engine does not know', async () => {
    const missing = await upgrade({}, { engine: '0.2.0' });
    const ahead = await upgrade({ '.factory/factory.yaml': FACTORY.replace('schema: 1', 'schema: 3') }, { engine: '0.2.0', upgrade: { target: 2, migrations: [RENAME_RISK] } });

    expect(missing.result).toEqual({ ok: false, reason: 'missing', message: '.factory/factory.yaml is missing. Run /factory-init' });
    expect(ahead.result).toEqual({ ok: false, reason: 'schema', message: 'factory.yaml uses schema 3, newer than this engine understands (2). Upgrade the engine.' });
    expect([...missing.published, ...ahead.published]).toEqual([]);
  });
});

const ADAPTERS = `
repository: acme/billing-service
ticket_providers:
  - { kind: jira, base_url: "https://acme.atlassian.net", filter: project = PAY, token_env: JIRA_TOKEN, email_env: JIRA_EMAIL }
source_control: { kind: github, repo: acme/billing-service, token_env: GH_TOKEN }
agent_runtime: { kind: orca }
`;

const BITBUCKET_ADAPTERS = ADAPTERS.replace('source_control: { kind: github, repo: acme/billing-service, token_env: GH_TOKEN }', 'source_control: { kind: bitbucket, repo: acme/billing-service, token_env: BB_TOKEN, username_env: BB_USER }');

const BUILD = 'name: CI\non: push\njobs:\n  test:\n    steps:\n      - run: pnpm run test\n';

const CURRENT = { '.factory/factory.yaml': FACTORY, '.factory/adapters.yaml': ADAPTERS, ...engineFiles('0.1.0') };

const WORKFLOW = '.github/workflows/factory.yml';

const stepsOf = async (workflow: string | undefined) => (await detectProject({ files: createInMemoryProjectFiles({ [WORKFLOW]: workflow ?? '' }) })).ci.factorySteps;

describe('adding the missing factory workflow', () => {
  it('opens a pull request that adds the workflow and lists the secrets to store, on a GitHub project otherwise up to date', async () => {
    const { result, published, opened } = await upgrade(CURRENT, { engine: '0.1.5' });

    expect(result).toMatchObject({ ok: true, action: 'opened', url: 'https://github.com/acme/billing-service/pull/41', workflowOnly: true });
    expect(Object.keys(published[0]?.files ?? {})).toEqual([WORKFLOW]);
    expect(await stepsOf(published[0]?.files[WORKFLOW])).toEqual(['record-merge']);
    expect(published[0]?.files[WORKFLOW]).toContain('  JIRA_TOKEN: ${{ secrets.FACTORY_JIRA_TOKEN }}\n  JIRA_EMAIL: ${{ secrets.FACTORY_JIRA_EMAIL }}\n  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n');
    expect(published[0]?.message).toBe('chore: add the factory workflow');
    expect(opened[0]?.title).toBe('chore: add the factory workflow');
    expect(opened[0]?.branch).toBe(published[0]?.branch);
    expect(opened[0]?.body.split('\n')).toEqual(expect.arrayContaining(['Before merging, store these secrets in the CI secret store:', '- FACTORY_JIRA_TOKEN', '- FACTORY_JIRA_EMAIL']));
  });

  it('adds the workflow to the engine upgrade pull request too', async () => {
    const { result, published, opened } = await upgrade(CURRENT, { engine: '0.2.0' });

    expect(result).not.toHaveProperty('workflowOnly');
    expect(opened[0]?.title).toBe('chore: upgrade the factory engine to 0.2.0');
    expect(Object.keys(published[0]?.files ?? {})).toContain(WORKFLOW);
    expect(opened[0]?.body.split('\n')).toEqual(expect.arrayContaining(['Before merging, store these secrets in the CI secret store:', '- FACTORY_JIRA_TOKEN', '- FACTORY_JIRA_EMAIL']));
  });

  it('adds the revert job, triggered by the workflow that builds main, chosen as init chooses it', async () => {
    const { published, opened } = await upgrade({ ...CURRENT, '.factory/factory.yaml': `${FACTORY}main_branch: trunk\n`, '.github/workflows/ci.yml': BUILD }, { engine: '0.1.5' });
    const workflow = published[0]?.files[WORKFLOW];

    expect(await stepsOf(workflow)).toEqual(['record-merge', 'revert']);
    expect(workflow).toContain('  workflow_run:\n    workflows: ["CI"]\n    types: [completed]\n    branches: [trunk]\n');
    expect(opened[0]?.body).not.toContain('revert step');
  });

  it('leaves the revert job out, and says why, when no workflow builds main', async () => {
    const { published, opened } = await upgrade(CURRENT, { engine: '0.1.5' });

    expect(published[0]?.files[WORKFLOW]).not.toContain('workflow_run');
    expect(opened[0]?.body.split('\n')).toContain('The revert step was left out because no workflow builds the main branch.');
  });

  it('leaves the watch job out, and says why, when the staging watch is on, without touching factory.yaml', async () => {
    const watching = `${FACTORY}watch: { enabled: true, checks: [./smoke.sh] }\n`;

    const { published, opened } = await upgrade({ ...CURRENT, '.factory/factory.yaml': watching }, { engine: '0.1.5' });

    expect(published[0]?.files[WORKFLOW]).not.toContain('watch');
    expect(published[0]?.files[WORKFLOW]).not.toContain('deployment_status');
    expect(Object.keys(published[0]?.files ?? {})).not.toContain('.factory/factory.yaml');
    expect(opened[0]?.body.split('\n')).toContain('The watch step was left out: factory.yaml does not record the environment to watch. Add the watch job by hand.');
  });

  it('says nothing about the watch when it is off', async () => {
    const { opened } = await upgrade(CURRENT, { engine: '0.1.5' });

    expect(opened[0]?.body).not.toContain('watch');
  });

  it('never overwrites a factory workflow that is there', async () => {
    const { result, published } = await upgrade({ ...CURRENT, [WORKFLOW]: 'name: Mine\n' }, { engine: '0.1.5' });

    expect(result).toMatchObject({ ok: true, action: 'none', message: expect.stringMatching(/^Nothing to upgrade: /) });
    expect(published).toEqual([]);
  });

  it('adds no workflow on Bitbucket', async () => {
    const { result, published } = await upgrade({ ...CURRENT, '.factory/adapters.yaml': BITBUCKET_ADAPTERS }, { engine: '0.1.5' });

    expect(result).toMatchObject({ ok: true, action: 'none' });
    expect(published).toEqual([]);
  });
});
