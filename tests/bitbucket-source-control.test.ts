import { describe, expect, it } from 'vitest';
import { createBitbucketSourceControl } from '../src/adapters/bitbucket-source-control.js';
import type { Http } from '../src/adapters/http.js';
import { describeSourceControlContract } from './contracts/source-control-contract.js';
import { createFakeBitbucket } from './fakes/fake-bitbucket.js';

const API_URL = 'https://api.bitbucket.test/2.0';
const REPOSITORY = 'acme/billing-service';

const getSetup = (credentials: { readonly username?: string } = { username: 'factory@acme.test' }) => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  const bitbucket = createFakeBitbucket({ apiUrl: API_URL, repository: REPOSITORY, now: () => clock.now });
  const sourceControl = createBitbucketSourceControl({ apiUrl: API_URL, repository: REPOSITORY, token: 'bb-token', http: bitbucket.http, ...credentials });
  return { bitbucket, sourceControl, clock };
};

const answering = (status: number, body: unknown): Http => async () => ({ status, headers: {}, body: JSON.stringify(body) });

const getDirect = (http: Http) => createBitbucketSourceControl({ apiUrl: API_URL, repository: REPOSITORY, token: 'bb-token', http });

const getPullJson = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  title: 'PAY-1',
  state: 'OPEN',
  summary: { raw: 'Spec' },
  source: { branch: { name: 'factory/pay-1' }, commit: { hash: '1a2b3c4d5e6f' } },
  links: { html: { href: 'https://bitbucket.test/acme/billing-service/pull-requests/7' } },
  closed_by: null,
  updated_on: '2026-11-21T15:00:00.123456+00:00',
  queued: false,
  ...overrides,
});

const openOne = async ({ bitbucket, sourceControl }: ReturnType<typeof getSetup>) => {
  bitbucket.world.push('factory/pay-142', 'c1');
  return sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'PAY-142 Bulk export', body: 'Spec' });
};

describeSourceControlContract(
  'Bitbucket over a simulated Bitbucket',
  () => {
    const { bitbucket, sourceControl, clock } = getSetup();
    return {
      sourceControl,
      world: {
        ...bitbucket.world,
        advanceClock: (iso) => {
          clock.now = iso;
        },
      },
    };
  },
  { revert: false },
);

describe('Bitbucket source control', () => {
  it('authenticates with the username and token when a username is given', async () => {
    const setup = getSetup();

    await openOne(setup);

    expect(setup.bitbucket.requests.every((request) => request.headers['authorization'] === `Basic ${btoa('factory@acme.test:bb-token')}`)).toBe(true);
  });

  it('authenticates with an access token alone when no username is given', async () => {
    const setup = getSetup({});

    await openOne(setup);

    expect(setup.bitbucket.requests.every((request) => request.headers['authorization'] === 'Bearer bb-token')).toBe(true);
  });

  it('sends the title, description, source and destination when opening a pull request', async () => {
    const setup = getSetup();

    await openOne(setup);

    expect(JSON.parse(setup.bitbucket.requests[0]?.body ?? '{}')).toEqual({
      title: 'PAY-142 Bulk export',
      description: 'Spec',
      source: { branch: { name: 'factory/pay-142' } },
      destination: { branch: { name: 'main' } },
    });
  });

  it('links to the pull request page people open', async () => {
    const pullRequest = await openOne(getSetup());

    expect(pullRequest.url).toBe(`https://bitbucket.test/acme/billing-service/pull-requests/${pullRequest.number}`);
  });

  it('keeps the title when it replaces the description', async () => {
    const setup = getSetup();
    const pullRequest = await openOne(setup);

    await setup.sourceControl.updatePullRequestBody({ number: pullRequest.number, body: 'Risk: low' });

    expect(setup.bitbucket.titleOf(pullRequest.number)).toBe('PAY-142 Bulk export');
  });

  it('merges straight away when asked to hand a pull request to Bitbucket\'s own merge', async () => {
    const setup = getSetup();
    const pullRequest = await openOne(setup);

    await setup.sourceControl.enableAutoMerge(pullRequest.number);

    expect((await setup.sourceControl.getPullRequest(pullRequest.number))?.state).toBe('merged');
    expect(setup.bitbucket.requests.some((request) => request.method === 'POST' && request.url.endsWith(`/pullrequests/${pullRequest.number}/merge`))).toBe(true);
  });

  it('fails with Bitbucket\'s reason when the merge is refused', async () => {
    const refusing: Http = async () => ({ status: 400, headers: {}, body: JSON.stringify({ error: { message: 'You cannot merge until 1 build passes' } }) });

    await expect(getDirect(refusing).enableAutoMerge(7)).rejects.toThrow(
      'Bitbucket refused to merge pull request 7: You cannot merge until 1 build passes',
    );
  });

  it('fails with the status when a refused merge gives no reason', async () => {
    await expect(getDirect(answering(403, {})).enableAutoMerge(7)).rejects.toThrow('Bitbucket refused to merge pull request 7: status 403');
  });

  it('shows a pull request waiting in the merge queue as handed to auto-merge', async () => {
    const pullRequest = await getDirect(answering(200, getPullJson({ queued: true }))).getPullRequest(7);

    expect(pullRequest?.autoMerge).toBe(true);
    expect(pullRequest?.state).toBe('open');
  });

  it.each(['DECLINED', 'SUPERSEDED'])('reports a %s pull request as closed', async (state) => {
    const pullRequest = await getDirect(answering(200, getPullJson({ state }))).getPullRequest(7);

    expect(pullRequest?.state).toBe('closed');
    expect(pullRequest?.mergedAt).toBeUndefined();
    expect(pullRequest?.mergedBy).toBeUndefined();
  });

  it('reads who merged from the nickname, falling back to the display name, and when from the last update', async () => {
    const merged = { state: 'MERGED', closed_by: { nickname: 'maya', display_name: 'Maya R.' } };
    const noNickname = { state: 'MERGED', closed_by: { display_name: 'Maya R.' } };

    const first = await getDirect(answering(200, getPullJson(merged))).getPullRequest(7);
    const second = await getDirect(answering(200, getPullJson(noNickname))).getPullRequest(7);

    expect(first?.mergedBy).toBe('maya');
    expect(first?.mergedAt).toBe('2026-11-21T15:00:00Z');
    expect(second?.mergedBy).toBe('Maya R.');
  });

  it('reads an empty description when Bitbucket sends none', async () => {
    const { summary: _unused, ...withoutSummary } = getPullJson();

    expect((await getDirect(answering(200, withoutSummary)).getPullRequest(7))?.body).toBe('');
  });

  it('matches the short commit hash Bitbucket reports against the full one the factory pushed', async () => {
    const sourceControl = getDirect(answering(200, getPullJson({ state: 'MERGED' })));

    expect(await sourceControl.wasMergedAsIs({ number: 7, commit: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' })).toBe(true);
    expect(await sourceControl.wasMergedAsIs({ number: 7, commit: '1a2b3c4d' })).toBe(true);
    expect(await sourceControl.wasMergedAsIs({ number: 7, commit: '9f9f9f9f9f9f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' })).toBe(false);
  });

  it.each([
    ['SUCCESSFUL', 'passed'],
    ['INPROGRESS', 'pending'],
    ['FAILED', 'failed'],
    ['STOPPED', 'failed'],
  ])('reads a %s build as %s', async (state, expected) => {
    const http: Http = async (request) =>
      request.url.includes('/refs/branches/') ? { status: 404, headers: {}, body: '{}' } : { status: 200, headers: {}, body: JSON.stringify({ key: 'unit-tests', state }) };

    expect(await getDirect(http).getCiResult({ ref: '1a2b3c4d', job: 'unit-tests' })).toBe(expected);
  });

  it('looks a build up by the branch\'s head commit, with the job name as the build key', async () => {
    const setup = getSetup();
    setup.bitbucket.world.push('factory/pay-142', 'c1');
    setup.bitbucket.world.setCi('factory/pay-142', 'unit tests', 'passed');

    const result = await setup.sourceControl.getCiResult({ ref: 'factory/pay-142', job: 'unit tests' });

    expect(result).toBe('passed');
    expect(setup.bitbucket.requests.map((request) => request.url.slice(API_URL.length))).toEqual([
      '/repositories/acme/billing-service/refs/branches/factory/pay-142',
      '/repositories/acme/billing-service/commit/c1/statuses/build/unit%20tests',
    ]);
  });

  it('explains what to do instead of opening a revert pull request', async () => {
    const setup = getSetup();

    await expect(setup.sourceControl.openRevertPullRequest(7)).rejects.toThrow(
      'Bitbucket has no API to revert a pull request. Revert pull request 7 from its page in Bitbucket.',
    );
    expect(setup.bitbucket.requests).toEqual([]);
  });

  it.each([400, 500])('treats a %i answer as a failure, whatever the call', async (status) => {
    const sourceControl = getDirect(answering(status, {}));

    await expect(sourceControl.getPullRequest(7)).rejects.toThrow(`Bitbucket answered ${status} to GET /repositories/acme/billing-service/pullrequests/7`);
    await expect(sourceControl.openPullRequest({ branch: 'b', base: 'main', title: 't', body: 'x' })).rejects.toThrow(
      `Bitbucket answered ${status} to POST /repositories/acme/billing-service/pullrequests`,
    );
    await expect(sourceControl.getCiResult({ ref: 'main', job: 'j' })).rejects.toThrow(`Bitbucket answered ${status} to GET`);
  });

  it('fails clearly when asked to change a pull request that does not exist', async () => {
    const setup = getSetup();

    await expect(setup.sourceControl.updatePullRequestBody({ number: 999, body: 'x' })).rejects.toThrow('Pull request 999 does not exist');
  });

  it('posts a commit status as a build status Bitbucket counts in its merge checks', async () => {
    const { bitbucket, sourceControl } = getSetup();

    await sourceControl.postStatus({ context: 'factory/tasks', state: 'success', description: 'All 6 tasks done', link: 'https://bitbucket.test/pr/7', commit: 'c1' });

    const request = bitbucket.requests[0];
    expect([request?.method, request?.url]).toEqual(['POST', `${API_URL}/repositories/acme/billing-service/commit/c1/statuses/build`]);
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ key: 'factory/tasks', name: 'factory/tasks', state: 'SUCCESSFUL', description: 'All 6 tasks done', url: 'https://bitbucket.test/pr/7' });
  });

  it.each([
    [{ kind: 'require_passing_builds_to_merge', pattern: 'main', branch_match_kind: 'glob' }, true],
    [{ kind: 'require_passing_builds_to_merge', pattern: '*', branch_match_kind: 'glob' }, true],
    [{ kind: 'require_passing_builds_to_merge', pattern: 'release/*', branch_match_kind: 'glob' }, false],
    [{ kind: 'require_approvals_to_merge', pattern: 'main', branch_match_kind: 'glob' }, false],
  ])('requires every build on main when a passing-builds merge check covers it: %o', async (restriction, required) => {
    const sourceControl = getDirect(answering(200, { values: [restriction] }));

    expect(await sourceControl.requiredChecks('main')).toEqual(required ? ['*'] : []);
  });

  const routes = (restriction: Record<string, unknown>, model: { readonly status: number; readonly body: unknown }): Http => async (request) => {
    const answer = request.url.endsWith('/branching-model') ? model : { status: 200, body: { values: [restriction] } };
    return { status: answer.status, headers: {}, body: JSON.stringify(answer.body) };
  };

  const MODEL = { status: 200, body: { development: { branch: { name: 'develop' }, use_mainbranch: false }, production: { branch: { name: 'main' }, use_mainbranch: true, enabled: true } } };

  it.each([
    ['production', true],
    ['development', false],
    ['release', false],
  ])('counts a passing-builds merge check on the %s branch type only when the branching model puts main there', async (branchType, required) => {
    const restriction = { kind: 'require_passing_builds_to_merge', branch_match_kind: 'branching_model', branch_type: branchType };

    expect(await getDirect(routes(restriction, MODEL)).requiredChecks('main')).toEqual(required ? ['*'] : []);
  });

  it.each([400, 403])('cannot tell the required checks when the branching model answers %i', async (status) => {
    const restriction = { kind: 'require_passing_builds_to_merge', branch_match_kind: 'branching_model', branch_type: 'production' };

    expect(await getDirect(routes(restriction, { status, body: {} })).requiredChecks('main')).toBe('unreadable');
  });

  it.each([400, 403])('cannot tell the required checks when Bitbucket answers %i about the branch restrictions', async (status) => {
    expect(await getDirect(answering(status, {})).requiredChecks('main')).toBe('unreadable');
  });

  it('lists the files of a pull request, following the next page and leaving out the ones it removes', async () => {
    const next = `${API_URL}/repositories/acme/billing-service/pullrequests/7/diffstat?pagelen=500&page=2`;
    const http: Http = async (request) => {
      const body = request.url === next
        ? { values: [{ status: 'removed', old: { path: 'old.ts' }, new: null }, { status: 'renamed', old: { path: 'a.md' }, new: { path: 'tasks.md' } }] }
        : { values: [{ status: 'modified', old: { path: 'src/x.ts' }, new: { path: 'src/x.ts' } }], next };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    };

    expect(await getDirect(http).changedFiles(7)).toEqual(['src/x.ts', 'tasks.md']);
  });
});
