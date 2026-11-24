import { describe, expect, it } from 'vitest';
import { createGitHubSourceControl } from '../src/adapters/github-source-control.js';
import type { Http } from '../src/adapters/http.js';
import { describeSourceControlContract } from './contracts/source-control-contract.js';
import { createFakeGitHub } from './fakes/fake-github.js';

const API_URL = 'https://api.github.test';
const REPOSITORY = 'acme/billing-service';

const getSetup = () => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  const github = createFakeGitHub({ apiUrl: API_URL, repository: REPOSITORY, now: () => clock.now });
  const sourceControl = createGitHubSourceControl({ apiUrl: API_URL, repository: REPOSITORY, token: 'gh-token', http: github.http });
  return { github, sourceControl, clock };
};

const answering = (status: number, body: unknown): Http => async () => ({ status, headers: {}, body: JSON.stringify(body) });

const getDirect = (http: Http) => createGitHubSourceControl({ apiUrl: API_URL, repository: REPOSITORY, token: 'gh-token', http });

describeSourceControlContract('GitHub over a simulated GitHub', () => {
  const { github, sourceControl, clock } = getSetup();
  return {
    sourceControl,
    world: {
      ...github.world,
      advanceClock: (iso) => {
        clock.now = iso;
      },
    },
  };
});

describe('GitHub source control', () => {
  it('authenticates every request with the token', async () => {
    const { github, sourceControl } = getSetup();
    github.world.push('factory/pay-142', 'c1');

    const pullRequest = await sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'T', body: 'B' });
    await sourceControl.enableAutoMerge(pullRequest.number);

    expect(github.requests.length).toBeGreaterThan(1);
    expect(github.requests.every((request) => request.headers['authorization'] === 'Bearer gh-token')).toBe(true);
    expect(github.requests.every((request) => request.headers['accept'] === 'application/vnd.github+json')).toBe(true);
  });

  it('sends the branch, base, title and description when opening a pull request', async () => {
    const { github, sourceControl } = getSetup();
    github.world.push('factory/pay-142', 'c1');

    await sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'PAY-142 Bulk export', body: 'Spec' });

    expect(JSON.parse(github.requests[0]?.body ?? '{}')).toEqual({ head: 'factory/pay-142', base: 'main', title: 'PAY-142 Bulk export', body: 'Spec' });
  });

  it('links to the pull request page people open', async () => {
    const { github, sourceControl } = getSetup();
    github.world.push('factory/pay-142', 'c1');

    const pullRequest = await sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'T', body: 'B' });

    expect(pullRequest.url).toBe(`https://github.test/acme/billing-service/pull/${pullRequest.number}`);
  });

  it('reports a pull request closed without merging as closed, with an empty description when it has none', async () => {
    const closed = {
      number: 7,
      html_url: 'https://github.test/x/pull/7',
      node_id: 'PR_7',
      state: 'closed',
      merged: false,
      merged_at: null,
      merged_by: null,
      body: null,
      head: { ref: 'factory/pay-1', sha: 'c9' },
      auto_merge: null,
    };

    const pullRequest = await getDirect(answering(200, closed)).getPullRequest(7);

    expect(pullRequest?.state).toBe('closed');
    expect(pullRequest?.body).toBe('');
    expect(pullRequest?.mergedAt).toBeUndefined();
    expect(pullRequest?.mergedBy).toBeUndefined();
  });

  it.each([
    ['queued', null, 'pending'],
    ['completed', 'success', 'passed'],
    ['completed', 'cancelled', 'failed'],
    ['completed', 'timed_out', 'failed'],
  ])('reads a check run that is %s with conclusion %s as %s', async (status, conclusion, expected) => {
    const sourceControl = getDirect(answering(200, { check_runs: [{ status, conclusion }] }));

    expect(await sourceControl.getCiResult({ ref: 'main', job: 'unit-tests' })).toBe(expected);
  });

  it('fails with the status and path when GitHub answers with an error', async () => {
    await expect(getDirect(answering(500, {})).getPullRequest(7)).rejects.toThrow(
      'GitHub answered 500 to GET /repos/acme/billing-service/pulls/7',
    );
  });

  it.each([400, 500])('treats a %i answer as a failure, whatever the call', async (status) => {
    const sourceControl = getDirect(answering(status, {}));

    await expect(sourceControl.getPullRequest(7)).rejects.toThrow(`GitHub answered ${status} to GET`);
    await expect(sourceControl.updatePullRequestBody({ number: 7, body: 'x' })).rejects.toThrow(
      `GitHub answered ${status} to PATCH /repos/acme/billing-service/pulls/7`,
    );
  });

  it('fails with GitHub\'s own message when a revert is refused', async () => {
    const { github, sourceControl } = getSetup();
    github.world.push('factory/pay-142', 'c1');
    const pullRequest = await sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'T', body: 'B' });

    await expect(sourceControl.openRevertPullRequest(pullRequest.number)).rejects.toThrow('Pull request is not merged');
  });

  it('fails clearly when asked to act on a pull request that does not exist', async () => {
    const { sourceControl } = getSetup();

    await expect(sourceControl.enableAutoMerge(999)).rejects.toThrow('Pull request 999 does not exist');
    await expect(sourceControl.openRevertPullRequest(999)).rejects.toThrow('Pull request 999 does not exist');
  });

  it('posts a commit status with its context, description and link', async () => {
    const { github, sourceControl } = getSetup();

    await sourceControl.postStatus({ context: 'factory/tasks', state: 'failure', description: `2 of 9 tasks open ${'x'.repeat(200)}`, link: 'https://github.test/pull/7', commit: 'c1' });

    const request = github.requests[0];
    const sent: unknown = JSON.parse(request?.body ?? '{}');
    expect([request?.method, request?.url]).toEqual(['POST', `${API_URL}/repos/acme/billing-service/statuses/c1`]);
    expect(sent).toMatchObject({ state: 'failure', context: 'factory/tasks', target_url: 'https://github.test/pull/7' });
    expect(sent).toHaveProperty('description', `2 of 9 tasks open ${'x'.repeat(122)}`);
  });

  const routes = (answers: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>): Http => async (request) => {
    const answer = Object.entries(answers).find(([path]) => request.url.endsWith(path))?.[1] ?? { status: 404, body: {} };
    return { status: answer.status, headers: {}, body: JSON.stringify(answer.body) };
  };

  it('counts a check required by a ruleset on the branch, alongside branch protection', async () => {
    const sourceControl = getDirect(
      routes({
        '/branches/main/protection/required_status_checks': { status: 200, body: { contexts: ['build'], checks: [{ context: 'build' }] } },
        '/rules/branches/main': { status: 200, body: [{ type: 'pull_request' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'factory/tasks' }] } }] },
      }),
    );

    expect(await sourceControl.requiredChecks('main')).toEqual(['build', 'factory/tasks']);
  });

  it.each([400, 403])('cannot tell the required checks when GitHub answers %i about the rulesets or the protection', async (status) => {
    expect(await getDirect(routes({ '/rules/branches/main': { status, body: {} } })).requiredChecks('main')).toBe('unreadable');
    expect(await getDirect(routes({ '/protection/required_status_checks': { status, body: {} }, '/rules/branches/main': { status: 200, body: [] } })).requiredChecks('main')).toBe('unreadable');
  });

  it.each([400, 500])('fails with the status and path when GitHub answers %i about a file', async (status) => {
    await expect(getDirect(answering(status, {})).readFileAt({ path: 'openspec/tasks.md', commit: 'c1' })).rejects.toThrow(
      `GitHub answered ${status} to GET /repos/acme/billing-service/contents/openspec/tasks.md?ref=c1`,
    );
  });

  it('lists the files of a pull request page by page, leaving out the ones it removes', async () => {
    const requested: string[] = [];
    const http: Http = async (request) => {
      requested.push(request.url);
      const page = Number(new URL(request.url).searchParams.get('page'));
      const files = page === 1 ? Array.from({ length: 100 }, (_, index) => ({ filename: `src/f${index}.ts`, status: 'modified' })) : [{ filename: 'old.ts', status: 'removed' }, { filename: 'tasks.md', status: 'added' }];
      return { status: 200, headers: {}, body: JSON.stringify(files) };
    };

    const files = await getDirect(http).changedFiles(7);

    expect(files).toHaveLength(101);
    expect(files.at(-1)).toBe('tasks.md');
    expect(requested).toEqual([`${API_URL}/repos/acme/billing-service/pulls/7/files?per_page=100&page=1`, `${API_URL}/repos/acme/billing-service/pulls/7/files?per_page=100&page=2`]);
  });
});
