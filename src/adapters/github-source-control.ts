import { z } from 'zod';
import type { Http, HttpResponse } from './http.js';
import type { CiResult, PullRequest, RequiredChecks, SourceControl } from './source-control.js';

type Options = {
  readonly apiUrl: string;
  readonly repository: string;
  readonly token: string;
  readonly http: Http;
};

const PullSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  node_id: z.string(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  merged_at: z.string().nullable(),
  merged_by: z.object({ login: z.string() }).nullable(),
  body: z.string().nullable(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  auto_merge: z.unknown().nullable(),
});

const CheckRunsSchema = z.object({
  check_runs: z.array(z.object({ status: z.string(), conclusion: z.string().nullable() })),
});

const GraphQlSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z.unknown().optional(),
});

const ContentSchema = z.object({ content: z.string(), encoding: z.literal('base64') });

const ProtectionChecksSchema = z.object({
  contexts: z.array(z.string()).default([]),
  checks: z.array(z.object({ context: z.string() })).default([]),
});

const BranchRulesSchema = z.array(
  z.object({
    type: z.string(),
    parameters: z.object({ required_status_checks: z.array(z.object({ context: z.string() })).optional() }).optional(),
  }),
);

const PullFilesSchema = z.array(z.object({ filename: z.string(), status: z.string() }));

const RevertedSchema = z.object({ revertPullRequest: z.object({ revertPullRequest: z.object({ number: z.number() }) }) });

type Pull = z.infer<typeof PullSchema>;

const NOT_FOUND = 404;
const DESCRIPTION_LIMIT = 140;
const FILES_PER_PAGE = 100;
const REVERTS = /Reverts \S*#(\d+)/;

const ENABLE_AUTO_MERGE = 'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id }) { pullRequest { number } } }';
const REVERT = 'mutation($id: ID!) { revertPullRequest(input: { pullRequestId: $id }) { revertPullRequest { number } } }';

const stateOf = (pull: Pull): PullRequest['state'] => (pull.merged ? 'merged' : pull.state);

const toPullRequest = (pull: Pull): PullRequest => {
  const body = pull.body ?? '';
  const reverts = REVERTS.exec(body)?.[1];
  return {
    number: pull.number,
    url: pull.html_url,
    branch: pull.head.ref,
    state: stateOf(pull),
    headCommit: pull.head.sha,
    body,
    autoMerge: pull.auto_merge !== null,
    ...(pull.merged_at === null ? {} : { mergedAt: pull.merged_at }),
    ...(pull.merged_by === null ? {} : { mergedBy: pull.merged_by.login }),
    ...(reverts === undefined ? {} : { reverts: Number(reverts) }),
  };
};

const pathIn = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

const toCiResult = (run: { readonly status: string; readonly conclusion: string | null } | undefined): CiResult => {
  if (run === undefined) return 'missing';
  if (run.status !== 'completed') return 'pending';
  return run.conclusion === 'success' ? 'passed' : 'failed';
};

export const createGitHubSourceControl = ({ apiUrl, repository, token, http }: Options): SourceControl => {
  const send = async (method: string, path: string, body?: unknown): Promise<HttpResponse> =>
    http({
      method,
      url: `${apiUrl}${path}`,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const call = async (method: string, path: string, body?: unknown): Promise<HttpResponse> => {
    const response = await send(method, path, body);
    if (response.status >= 400) throw new Error(`GitHub answered ${response.status} to ${method} ${path}`);
    return response;
  };

  const pullPath = (number: number): string => `/repos/${repository}/pulls/${number}`;

  const readPull = async (number: number): Promise<Pull | undefined> => {
    const response = await send('GET', pullPath(number));
    if (response.status === NOT_FOUND) return undefined;
    if (response.status >= 400) throw new Error(`GitHub answered ${response.status} to GET ${pullPath(number)}`);
    return PullSchema.parse(JSON.parse(response.body));
  };

  const existingPull = async (number: number): Promise<Pull> => {
    const pull = await readPull(number);
    if (pull === undefined) throw new Error(`Pull request ${number} does not exist`);
    return pull;
  };

  const mutate = async (query: string, id: string): Promise<unknown> => {
    const result = GraphQlSchema.parse(JSON.parse((await call('POST', '/graphql', { query, variables: { id } })).body));
    const message = result.errors?.[0]?.message;
    if (message !== undefined) throw new Error(message);
    return result.data;
  };

  const readable = async <T>(path: string, read: (body: string) => readonly T[]): Promise<readonly T[] | 'unreadable'> => {
    const response = await send('GET', path);
    if (response.status === NOT_FOUND) return [];
    return response.status >= 400 ? 'unreadable' : read(response.body);
  };

  const requiredChecks = async (branch: string): Promise<RequiredChecks> => {
    const name = encodeURIComponent(branch);
    const protection = await readable(`/repos/${repository}/branches/${name}/protection/required_status_checks`, (body) => {
      const checks = ProtectionChecksSchema.parse(JSON.parse(body));
      return [...checks.contexts, ...checks.checks.map(({ context }) => context)];
    });
    const rules = await readable(`/repos/${repository}/rules/branches/${name}`, (body) =>
      BranchRulesSchema.parse(JSON.parse(body)).flatMap((rule) => rule.parameters?.required_status_checks?.map(({ context }) => context) ?? []),
    );
    if (protection === 'unreadable' || rules === 'unreadable') return 'unreadable';
    return [...new Set([...protection, ...rules])];
  };

  const changedFiles = async (number: number, page = 1): Promise<readonly string[]> => {
    const files = PullFilesSchema.parse(JSON.parse((await call('GET', `${pullPath(number)}/files?per_page=${FILES_PER_PAGE}&page=${page}`)).body));
    const rest = files.length < FILES_PER_PAGE ? [] : await changedFiles(number, page + 1);
    return [...files.filter((file) => file.status !== 'removed').map((file) => file.filename), ...rest];
  };

  return {
    openPullRequest: async ({ branch, base, title, body }) =>
      toPullRequest(PullSchema.parse(JSON.parse((await call('POST', `/repos/${repository}/pulls`, { head: branch, base, title, body })).body))),

    getPullRequest: async (number) => {
      const pull = await readPull(number);
      return pull === undefined ? undefined : toPullRequest(pull);
    },

    updatePullRequestBody: async ({ number, body }) => {
      await call('PATCH', pullPath(number), { body });
    },

    getCiResult: async ({ ref, job }) => {
      const path = `/repos/${repository}/commits/${encodeURIComponent(ref)}/check-runs?check_name=${encodeURIComponent(job)}`;
      return toCiResult(CheckRunsSchema.parse(JSON.parse((await call('GET', path)).body)).check_runs[0]);
    },

    enableAutoMerge: async (number) => {
      await mutate(ENABLE_AUTO_MERGE, (await existingPull(number)).node_id);
    },

    openRevertPullRequest: async (number) => {
      const reverted = RevertedSchema.parse(await mutate(REVERT, (await existingPull(number)).node_id));
      return toPullRequest(await existingPull(reverted.revertPullRequest.revertPullRequest.number));
    },

    wasMergedAsIs: async ({ number, commit }) => {
      const pull = await readPull(number);
      return pull !== undefined && pull.merged && pull.head.sha === commit;
    },

    postStatus: async ({ context, state, description, link, commit }) => {
      await call('POST', `/repos/${repository}/statuses/${encodeURIComponent(commit)}`, {
        state,
        context,
        description: description.slice(0, DESCRIPTION_LIMIT),
        target_url: link,
      });
    },

    readFileAt: async ({ path, commit }) => {
      const location = `/repos/${repository}/contents/${pathIn(path)}?ref=${encodeURIComponent(commit)}`;
      const response = await send('GET', location);
      if (response.status === NOT_FOUND) return undefined;
      if (response.status >= 400) throw new Error(`GitHub answered ${response.status} to GET ${location}`);
      return Buffer.from(ContentSchema.parse(JSON.parse(response.body)).content, 'base64').toString('utf8');
    },

    requiredChecks,

    changedFiles: (number) => changedFiles(number),
  };
};
