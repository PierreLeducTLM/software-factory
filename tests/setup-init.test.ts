import { describe, expect, it } from 'vitest';
import type { OpenPullRequest } from '../src/adapters/source-control.js';
import type { Access, ProviderStatus } from '../src/adapters/ticket-provider.js';
import type { AdaptersConfig } from '../src/config/project-config.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { detectForInit, installFactory } from '../src/setup/init.js';
import type { InstallAnswers } from '../src/setup/install.js';
import { createInMemoryProjectFiles, type PublishedChange } from '../src/setup/project-files.js';
import { ENGINE_VERSION } from '../src/version.js';

const getAnswers = (overrides?: Partial<InstallAnswers>): InstallAnswers => ({
  engine: ENGINE_VERSION,
  repository: 'acme/billing-service',
  mainBranch: 'main',
  states: { to_refine: 'Backlog', spec_review: 'Spec review', ready_for_dev: 'Ready for Dev', in_development: 'In Progress', in_review: 'In Review', blocked: 'Blocked', done: 'Done' },
  checks: [{ id: 'test', category: 'tests', source: 'local', run: 'pnpm run test', blocking: true, timeout: '6m' }],
  sensitivePaths: [],
  ticketProvider: { kind: 'jira', baseUrl: 'https://acme.atlassian.net', filter: 'project = PAY', tokenEnv: 'JIRA_TOKEN', emailEnv: 'JIRA_EMAIL' },
  sourceControl: { kind: 'github', tokenEnv: 'GH_TOKEN' },
  ci: { system: 'github-actions', workflow: 'CI' },
  ...overrides,
});

const PROJECT: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' }, devDependencies: { typescript: '5' } }),
  'pnpm-lock.yaml': '',
};

type World = { readonly statuses?: readonly ProviderStatus[]; readonly access?: Access; readonly reenter?: boolean; readonly runs?: Readonly<Record<string, ScriptRun>>; readonly remoteUrl?: string };

const getInit = (world: World = {}) => {
  const commands: string[] = [];
  const connections: AdaptersConfig[] = [];
  const published: PublishedChange[] = [];
  const opened: OpenPullRequest[] = [];
  const deps = {
    files: createInMemoryProjectFiles(PROJECT),
    remoteUrl: async () => world.remoteUrl,
    defaultBranch: async () => 'main',
    now: () => '2026-11-21T08:00:00Z',
    runScript: async (command: string) => {
      commands.push(command);
      return world.runs?.[command] ?? { exitCode: 0, output: 'ok', timedOut: false };
    },
    tickets: (adapters: AdaptersConfig) => {
      connections.push(adapters);
      return {
        listStatuses: async () => world.statuses ?? [],
        checkAccess: async () => world.access ?? { comment: true, transition: true },
        canReenter: async ({ status }: { readonly status: string }) => (world.reenter ?? false) && status === 'In Progress',
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
  return { deps, commands, connections, published, opened };
};

describe('the install wizard', () => {
  it('detects the project and names the engine to pin, running nothing unless asked to verify', async () => {
    const { deps, commands } = getInit({ remoteUrl: 'git@github.com:acme/billing-service.git' });

    const found = await detectForInit(deps, { verify: false });

    expect(found.engine).toBe(ENGINE_VERSION);
    expect(found.detection.remote).toEqual({ kind: 'github', repository: 'acme/billing-service' });
    expect(found.detection.candidates.map((candidate) => candidate.run)).toEqual(['pnpm run test', 'pnpm run lint']);
    expect(found.verification).toEqual([]);
    expect(commands).toEqual([]);
  });

  it('runs every detected check when asked to verify, and sets its timeout from the measure', async () => {
    const { deps, commands } = getInit({ runs: { 'pnpm run lint': { exitCode: 1, output: 'lint error', timedOut: false } } });

    const found = await detectForInit(deps, { verify: true });

    expect(found.detection.remote).toBeUndefined();
    expect(found.verification.map(({ id, status, timeout }) => ({ id, status, timeout }))).toEqual([
      { id: 'test', status: 'pass', timeout: '30s' },
      { id: 'lint', status: 'fail', timeout: '30s' },
    ]);
    expect(commands).toEqual(['pnpm run test', 'pnpm run lint', 'pnpm run lint']);
  });

  it('opens one install pull request with every file, and says which secrets to store', async () => {
    const { deps, published, opened } = getInit();

    const result = await installFactory(deps, getAnswers({ mainBranch: 'develop' }), { ticket: 'PAY-1' });

    const required = 'After this pull request is merged, mark factory/tasks as a required status check on develop, in its branch protection or a ruleset, so open tasks block the merge.';
    expect(result).toEqual({ ok: true, url: 'https://github.com/acme/billing-service/pull/1', secrets: ['FACTORY_JIRA_TOKEN', 'FACTORY_JIRA_EMAIL'], manual: [required] });
    expect(published.map(({ branch, base, message }) => ({ branch, base, message }))).toEqual([{ branch: 'factory/install', base: 'develop', message: 'chore: install the software factory' }]);
    expect(Object.keys(published[0]?.files ?? {})).toEqual(['.factory/factory.yaml', '.factory/adapters.yaml', '.factory/checks/README.md', '.factory/package.json', '.factory/bin/factory', '.factory/.gitignore', '.github/workflows/factory.yml', '.github/workflows/factory-tasks.yml']);
    expect(published[0]?.executable).toEqual(['.factory/bin/factory']);
    expect(opened).toEqual([
      {
        branch: 'factory/install',
        base: 'develop',
        title: 'chore: install the software factory',
        body: [
          'Installs the software factory in this project.',
          '',
          'Before merging, store these secrets in the CI secret store:',
          '- FACTORY_JIRA_TOKEN',
          '- FACTORY_JIRA_EMAIL',
          '',
          'Then, by hand:',
          `- ${required}`,
          '',
          'Every risk level starts in shadow mode: a person merges each factory pull request until the factory has earned auto-merge.',
        ].join('\n'),
      },
    ]);
  });

  it('lists the steps to make by hand in the pull request, and leaves out an empty secrets list', async () => {
    const { deps, opened } = getInit();

    const result = await installFactory(deps, getAnswers({ ci: { system: 'none' }, sourceControl: { kind: 'bitbucket', tokenEnv: 'BB_TOKEN', usernameEnv: 'BB_USER' } }), { ticket: 'PAY-1' });

    expect(result).toMatchObject({ ok: true, secrets: [] });
    const lines = opened[0]?.body.split('\n') ?? [];
    expect(lines.slice(0, 4)).toEqual(['Installs the software factory in this project.', '', 'Then, by hand:', expect.stringMatching(/^- No CI system was found\./)]);
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^- No CI system was found\./),
      expect.stringMatching(/^- Add this step to bitbucket-pipelines.yml, under pipelines > pull-requests/),
      expect.stringMatching(/^- After this pull request is merged, turn on the merge check/),
    ]));
    expect(lines.slice(-2)).toEqual(['', 'Every risk level starts in shadow mode: a person merges each factory pull request until the factory has earned auto-merge.']);
    expect(lines).not.toContain('Secrets:');
  });

  it.each([
    [{ comment: true, transition: false }, 'change the status of'],
    [{ comment: false, transition: true }, 'comment on'],
    [{ comment: false, transition: false }, 'comment on or change the status of'],
  ])('reports what the service account may not do, and opens no pull request (%j)', async (access, missing) => {
    const { deps, published, opened } = getInit({ access });

    const result = await installFactory(deps, getAnswers(), { ticket: 'PAY-1' });

    expect(result).toEqual({
      ok: false,
      reason: 'service_account',
      message: `The service account cannot ${missing} PAY-1. Grant the missing permission in Jira, then run the install again. No pull request was opened.`,
    });
    expect([...published, ...opened]).toEqual([]);
  });

  it('names Linear when the Linear account may not write to the ticket', async () => {
    const { deps } = getInit({ access: { comment: false, transition: true } });

    const result = await installFactory(deps, getAnswers({ ticketProvider: { kind: 'linear', team: 'PAY', tokenEnv: 'LINEAR_API_KEY' } }), { ticket: 'PAY-1' });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Grant the missing permission in Linear') });
  });

  it('opens no pull request while the workflow lets a claimed ticket be claimed again', async () => {
    const { deps, published, opened } = getInit({ reenter: true });

    const result = await installFactory(deps, getAnswers(), { ticket: 'PAY-1' });

    expect(result).toEqual({
      ok: false,
      reason: 'claim_lock',
      message: 'The Jira workflow lets a ticket move from "In Progress" to "In Progress", so two developers could claim the same ticket. Remove that transition, then run the install again. No pull request was opened.',
    });
    expect([...published, ...opened]).toEqual([]);
  });
});
