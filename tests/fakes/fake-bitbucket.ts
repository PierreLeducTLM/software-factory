import type { Http, HttpRequest, HttpResponse } from '../../src/adapters/http.js';
import { createInMemorySourceControl } from '../../src/adapters/in-memory-source-control.js';
import type { CiResult, PullRequest } from '../../src/adapters/source-control.js';

type Options = { readonly apiUrl: string; readonly repository: string; readonly now: () => string };

const json = (status: number, body: unknown): HttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });

const STATUS_STATES = { SUCCESSFUL: 'success', FAILED: 'failure' } as const;

const BUILD_STATES = { pending: 'INPROGRESS', passed: 'SUCCESSFUL', failed: 'FAILED' } as const;

export const createFakeBitbucket = ({ apiUrl, repository, now }: Options) => {
  const { sourceControl: backend, world: backendWorld } = createInMemorySourceControl({ now });
  const requests: HttpRequest[] = [];
  const branches = new Map<string, string>();
  const titles = new Map<number, string>();
  const base = `/repositories/${repository}`;

  const toJson = (pullRequest: PullRequest) => ({
    type: 'pullrequest',
    id: pullRequest.number,
    title: titles.get(pullRequest.number) ?? '',
    state: pullRequest.state === 'open' ? 'OPEN' : 'MERGED',
    summary: { raw: pullRequest.body, markup: 'markdown' },
    source: { branch: { name: pullRequest.branch }, commit: { hash: pullRequest.headCommit } },
    links: { html: { href: `https://bitbucket.test/${repository}/pull-requests/${pullRequest.number}` } },
    closed_by: pullRequest.mergedBy === undefined ? null : { nickname: pullRequest.mergedBy, display_name: 'Display Name' },
    updated_on: pullRequest.mergedAt === undefined ? now() : pullRequest.mergedAt.replace('Z', '.000000+00:00'),
    queued: false,
  });

  const route = async (request: HttpRequest): Promise<HttpResponse> => {
    const path = request.url.slice(apiUrl.length);
    const isJson = request.headers['content-type'] === 'application/json';
    const body: unknown = request.body !== undefined && isJson ? JSON.parse(request.body) : undefined;
    const pulls = `${base}/pullrequests`;

    if (path === pulls && request.method === 'POST') {
      const sent = body as { title?: string; description?: string; source?: { branch: { name: string } }; destination?: { branch: { name: string } } };
      if (sent.title === undefined || sent.source === undefined || sent.destination === undefined) return json(400, {});
      try {
        const created = await backend.openPullRequest({ branch: sent.source.branch.name, base: sent.destination.branch.name, title: sent.title, body: sent.description ?? '' });
        titles.set(created.number, sent.title);
        return json(201, toJson(created));
      } catch {
        return json(400, { error: { message: 'There are no changes to be pulled' } });
      }
    }

    const diffstat = new RegExp(`^${pulls}/(\\d+)/diffstat\\?pagelen=(\\d+)(?:&page=(\\d+))?$`).exec(path);
    if (diffstat !== null && request.method === 'GET') {
      const all = await backend.changedFiles(Number(diffstat[1]));
      const size = Number(diffstat[2]);
      const page = Number(diffstat[3] ?? '1');
      const values = all.slice((page - 1) * size, page * size).map((path) => ({ status: 'added', old: null, new: { path } }));
      const next = page * size < all.length ? { next: `${apiUrl}${pulls}/${diffstat[1]}/diffstat?pagelen=${size}&page=${page + 1}` } : {};
      return json(200, { values, ...next });
    }

    const pull = new RegExp(`^${pulls}/(\\d+)(/merge)?$`).exec(path);
    if (pull !== null) {
      const number = Number(pull[1]);
      const existing = await backend.getPullRequest(number);
      if (existing === undefined) return json(404, {});
      if (pull[2] === '/merge' && request.method === 'POST') {
        backendWorld.merge(number, 'factory-bot');
      } else if (request.method === 'PUT') {
        const sent = body as { title?: string; description?: string };
        if (sent.title === undefined || sent.title === '') return json(400, { error: { message: 'title: This field is required.' } });
        titles.set(number, sent.title);
        await backend.updatePullRequestBody({ number, body: sent.description ?? '' });
      } else if (request.method !== 'GET' || pull[2] !== undefined) {
        return json(405, {});
      }
      const latest = await backend.getPullRequest(number);
      return latest === undefined ? json(404, {}) : json(200, toJson(latest));
    }

    const branch = path.startsWith(`${base}/refs/branches/`) ? path.slice(`${base}/refs/branches/`.length) : undefined;
    if (branch !== undefined && request.method === 'GET') {
      const hash = branches.get(branch);
      return hash === undefined ? json(404, {}) : json(200, { type: 'branch', name: branch, target: { hash } });
    }

    const posted = new RegExp(`^${base}/commit/([^/]+)/statuses/build$`).exec(path);
    if (posted !== null && request.method === 'POST') {
      const sent = body as { key: string; state: keyof typeof STATUS_STATES; description: string; url: string };
      await backend.postStatus({ context: sent.key, state: STATUS_STATES[sent.state], description: sent.description, link: sent.url, commit: decodeURIComponent(posted[1] ?? '') });
      return json(201, { type: 'build', key: sent.key, state: sent.state });
    }

    const source = new RegExp(`^${base}/src/([^/]+)/(.+)$`).exec(path);
    if (source !== null && request.method === 'GET') {
      const file = await backend.readFileAt({ commit: decodeURIComponent(source[1] ?? ''), path: (source[2] ?? '').split('/').map(decodeURIComponent).join('/') });
      return file === undefined ? json(404, { error: { message: 'No such file' } }) : { status: 200, headers: {}, body: file };
    }

    if (path === `${base}/branch-restrictions?kind=require_passing_builds_to_merge` && request.method === 'GET') {
      const required = await backend.requiredChecks('main');
      if (required === 'unreadable') return json(403, { error: { message: 'Access denied' } });
      const values = required.length === 0 ? [] : [{ kind: 'require_passing_builds_to_merge', pattern: 'main', branch_match_kind: 'glob', value: 1 }];
      return json(200, { values });
    }

    const status = new RegExp(`^${base}/commit/([^/]+)/statuses/build/(.+)$`).exec(path);
    if (status !== null && request.method === 'GET') {
      const commit = decodeURIComponent(status[1] ?? '');
      const job = decodeURIComponent(status[2] ?? '');
      const refs = [commit, ...[...branches].filter(([, hash]) => hash === commit).map(([name]) => name)];
      const results = await Promise.all(refs.map((ref) => backend.getCiResult({ ref, job })));
      const result = results.find((candidate): candidate is Exclude<CiResult, 'missing'> => candidate !== 'missing');
      return result === undefined ? json(404, {}) : json(200, { type: 'build', key: job, state: BUILD_STATES[result] });
    }

    return json(404, {});
  };

  const http: Http = async (request) => {
    requests.push(request);
    return route(request);
  };

  return {
    http,
    requests,
    titleOf: (number: number): string | undefined => titles.get(number),
    world: {
      ...backendWorld,
      push: (branch: string, commit: string): void => {
        branches.set(branch, commit);
        backendWorld.push(branch, commit);
      },
    },
  };
};
