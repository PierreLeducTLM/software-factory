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
});
