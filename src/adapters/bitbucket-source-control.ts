import { z } from 'zod';
import type { Http, HttpResponse } from './http.js';
import type { CiResult, PullRequest, SourceControl } from './source-control.js';

type Options = {
  readonly apiUrl: string;
  readonly repository: string;
  readonly token: string;
  readonly username?: string;
  readonly http: Http;
};

const PullSchema = z.object({
  id: z.number(),
  title: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']),
  summary: z.object({ raw: z.string() }).optional(),
  source: z.object({ branch: z.object({ name: z.string() }), commit: z.object({ hash: z.string() }) }),
  links: z.object({ html: z.object({ href: z.string() }) }),
  closed_by: z.object({ nickname: z.string().optional(), display_name: z.string() }).nullable().optional(),
  updated_on: z.string(),
  queued: z.boolean().optional(),
});

const BranchSchema = z.object({ target: z.object({ hash: z.string() }) });
const BuildSchema = z.object({ state: z.enum(['SUCCESSFUL', 'FAILED', 'INPROGRESS', 'STOPPED']) });
const ErrorSchema = z.object({ error: z.object({ message: z.string() }) });

type Pull = z.infer<typeof PullSchema>;

const NOT_FOUND = 404;

const STATES: Readonly<Record<Pull['state'], PullRequest['state']>> = {
  OPEN: 'open',
  MERGED: 'merged',
  DECLINED: 'closed',
  SUPERSEDED: 'closed',
};

const BUILDS: Readonly<Record<z.infer<typeof BuildSchema>['state'], CiResult>> = {
  SUCCESSFUL: 'passed',
  INPROGRESS: 'pending',
  FAILED: 'failed',
  STOPPED: 'failed',
};

const toIso = (time: string): string => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');

const toPullRequest = (pull: Pull): PullRequest => {
  const merged = pull.state === 'MERGED';
  const mergedBy = pull.closed_by?.nickname ?? pull.closed_by?.display_name;
  return {
    number: pull.id,
    url: pull.links.html.href,
    branch: pull.source.branch.name,
    state: STATES[pull.state],
    headCommit: pull.source.commit.hash,
    body: pull.summary?.raw ?? '',
    autoMerge: pull.queued === true,
    ...(merged ? { mergedAt: toIso(pull.updated_on) } : {}),
    ...(merged && mergedBy !== undefined ? { mergedBy } : {}),
  };
};

export const createBitbucketSourceControl = ({ apiUrl, repository, token, username, http }: Options): SourceControl => {
  const authorization = username === undefined ? `Bearer ${token}` : `Basic ${btoa(`${username}:${token}`)}`;
  const base = `/repositories/${repository}`;

  const send = async (method: string, path: string, body?: unknown): Promise<HttpResponse> =>
    http({
      method,
      url: `${apiUrl}${path}`,
      headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const failure = (response: HttpResponse, method: string, path: string): Error =>
    new Error(`Bitbucket answered ${response.status} to ${method} ${path}`);

  const call = async (method: string, path: string, body?: unknown): Promise<HttpResponse> => {
    const response = await send(method, path, body);
    if (response.status >= 400) throw failure(response, method, path);
    return response;
  };

  const find = async (path: string): Promise<HttpResponse | undefined> => {
    const response = await send('GET', path);
    if (response.status === NOT_FOUND) return undefined;
    if (response.status >= 400) throw failure(response, 'GET', path);
    return response;
  };

  const pullPath = (number: number): string => `${base}/pullrequests/${number}`;

  const readPull = async (number: number): Promise<Pull | undefined> => {
    const response = await find(pullPath(number));
    return response === undefined ? undefined : PullSchema.parse(JSON.parse(response.body));
  };

  const headOf = async (ref: string): Promise<string> => {
    const response = await find(`${base}/refs/branches/${ref}`);
    return response === undefined ? ref : BranchSchema.parse(JSON.parse(response.body)).target.hash;
  };

  return {
    openPullRequest: async ({ branch, base: destination, title, body }) => {
      const response = await call('POST', `${base}/pullrequests`, {
        title,
        description: body,
        source: { branch: { name: branch } },
        destination: { branch: { name: destination } },
      });
      return toPullRequest(PullSchema.parse(JSON.parse(response.body)));
    },

    getPullRequest: async (number) => {
      const pull = await readPull(number);
      return pull === undefined ? undefined : toPullRequest(pull);
    },

    updatePullRequestBody: async ({ number, body }) => {
      const pull = await readPull(number);
      if (pull === undefined) throw new Error(`Pull request ${number} does not exist`);
      await call('PUT', pullPath(number), { title: pull.title, description: body });
    },

    getCiResult: async ({ ref, job }) => {
      const response = await find(`${base}/commit/${encodeURIComponent(await headOf(ref))}/statuses/build/${encodeURIComponent(job)}`);
      return response === undefined ? 'missing' : BUILDS[BuildSchema.parse(JSON.parse(response.body)).state];
    },

    enableAutoMerge: async (number) => {
      const response = await send('POST', `${pullPath(number)}/merge`);
      if (response.status < 400) return;
      const reason = ErrorSchema.safeParse(JSON.parse(response.body));
      throw new Error(
        `Bitbucket refused to merge pull request ${number}: ${reason.success ? reason.data.error.message : `status ${response.status}`}`,
      );
    },

    openRevertPullRequest: async (number) => {
      throw new Error(`Bitbucket has no API to revert a pull request. Revert pull request ${number} from its page in Bitbucket.`);
    },

    wasMergedAsIs: async ({ number, commit }) => {
      const pull = await readPull(number);
      if (pull === undefined || pull.state !== 'MERGED') return false;
      const head = pull.source.commit.hash;
      return head.startsWith(commit) || commit.startsWith(head);
    },
  };
};
