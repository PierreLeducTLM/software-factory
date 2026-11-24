import type { Http, HttpRequest, HttpResponse } from '../../src/adapters/http.js';
import { createInMemorySourceControl } from '../../src/adapters/in-memory-source-control.js';
import type { PullRequest } from '../../src/adapters/source-control.js';

type Options = { readonly apiUrl: string; readonly repository: string; readonly now: () => string };

const json = (status: number, body: unknown): HttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });

const CHECK_RUNS = {
  pending: { status: 'in_progress', conclusion: null },
  passed: { status: 'completed', conclusion: 'success' },
  failed: { status: 'completed', conclusion: 'failure' },
  missing: undefined,
} as const;

export const createFakeGitHub = ({ apiUrl, repository, now }: Options) => {
  const { sourceControl: backend, world } = createInMemorySourceControl({ now });
  const requests: HttpRequest[] = [];

  const toJson = (pullRequest: PullRequest) => ({
    number: pullRequest.number,
    html_url: `https://github.test/${repository}/pull/${pullRequest.number}`,
    node_id: `PR_${pullRequest.number}`,
    state: pullRequest.state === 'open' ? 'open' : 'closed',
    merged: pullRequest.state === 'merged',
    merged_at: pullRequest.mergedAt ?? null,
    merged_by: pullRequest.mergedBy === undefined ? null : { login: pullRequest.mergedBy },
    body: pullRequest.reverts === undefined ? pullRequest.body : `Reverts ${repository}#${pullRequest.reverts}`,
    head: { ref: pullRequest.branch, sha: pullRequest.headCommit },
    auto_merge: pullRequest.autoMerge ? { merge_method: 'squash' } : null,
  });

  const route = async (request: HttpRequest): Promise<HttpResponse> => {
    const path = request.url.slice(apiUrl.length);
    const body: unknown = request.body === undefined ? undefined : JSON.parse(request.body);
    const pulls = `/repos/${repository}/pulls`;

    if (path === pulls && request.method === 'POST') {
      const { head, base, title, body: text } = body as { head: string; base: string; title: string; body: string };
      try {
        return json(201, toJson(await backend.openPullRequest({ branch: head, base, title, body: text })));
      } catch {
        return json(422, { message: 'Validation Failed' });
      }
    }

    const files = new RegExp(`^${pulls}/(\\d+)/files\\?per_page=(\\d+)&page=(\\d+)$`).exec(path);
    if (files !== null && request.method === 'GET') {
      const all = await backend.changedFiles(Number(files[1]));
      const size = Number(files[2]);
      const page = Number(files[3]);
      return json(200, all.slice((page - 1) * size, page * size).map((filename) => ({ filename, status: 'added' })));
    }

    const number = Number(path.startsWith(`${pulls}/`) ? path.slice(pulls.length + 1) : Number.NaN);
    if (Number.isInteger(number)) {
      if (!['GET', 'PATCH'].includes(request.method)) return json(405, {});
      if (request.method === 'PATCH') await backend.updatePullRequestBody({ number, body: (body as { body: string }).body });
      const pullRequest = await backend.getPullRequest(number);
      return pullRequest === undefined ? json(404, { message: 'Not Found' }) : json(200, toJson(pullRequest));
    }

    const checks = new RegExp(`^/repos/${repository}/commits/([^/]+)/check-runs\\?check_name=(.+)$`).exec(path);
    if (checks !== null && request.method === 'GET') {
      const run = CHECK_RUNS[await backend.getCiResult({ ref: decodeURIComponent(checks[1] ?? ''), job: decodeURIComponent(checks[2] ?? '') })];
      return json(200, { check_runs: run === undefined ? [] : [run] });
    }

    const status = new RegExp(`^/repos/${repository}/statuses/([^/]+)$`).exec(path);
    if (status !== null && request.method === 'POST') {
      const sent = body as { state: 'success' | 'failure'; context: string; description: string; target_url: string };
      await backend.postStatus({ context: sent.context, state: sent.state, description: sent.description, link: sent.target_url, commit: decodeURIComponent(status[1] ?? '') });
      return json(201, { state: sent.state, context: sent.context });
    }

    const content = new RegExp(`^/repos/${repository}/contents/(.+)\\?ref=(.+)$`).exec(path);
    if (content !== null && request.method === 'GET') {
      const file = await backend.readFileAt({ path: (content[1] ?? '').split('/').map(decodeURIComponent).join('/'), commit: decodeURIComponent(content[2] ?? '') });
      return file === undefined ? json(404, { message: 'Not Found' }) : json(200, { type: 'file', encoding: 'base64', content: Buffer.from(file).toString('base64') });
    }

    const protection = new RegExp(`^/repos/${repository}/branches/([^/]+)/protection/required_status_checks$`).exec(path);
    if (protection !== null && request.method === 'GET') {
      const required = await backend.requiredChecks(decodeURIComponent(protection[1] ?? ''));
      if (required === 'unreadable') return json(403, { message: 'Resource not accessible by integration' });
      return required.length === 0 ? json(404, { message: 'Branch not protected' }) : json(200, { strict: false, contexts: required, checks: required.map((context) => ({ context, app_id: null })) });
    }

    if (new RegExp(`^/repos/${repository}/rules/branches/[^/]+$`).test(path) && request.method === 'GET') return json(200, []);

    if (path === '/graphql' && request.method === 'POST') {
      const { query, variables } = body as { query: string; variables: { id: string } };
      const target = Number(variables.id.slice('PR_'.length));
      if (query.includes('enablePullRequestAutoMerge')) {
        await backend.enableAutoMerge(target);
        return json(200, { data: { enablePullRequestAutoMerge: { pullRequest: { number: target } } } });
      }
      if (!query.includes('revertPullRequest(input')) return json(400, {});
      try {
        const revert = await backend.openRevertPullRequest(target);
        return json(200, { data: { revertPullRequest: { revertPullRequest: { number: revert.number } } } });
      } catch {
        return json(200, { errors: [{ message: 'Pull request is not merged' }] });
      }
    }

    return json(404, { message: 'Not Found' });
  };

  const http: Http = async (request) => {
    requests.push(request);
    return route(request);
  };

  return { http, world, requests };
};
