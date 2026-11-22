import { z } from 'zod';
import type { Http } from './http.js';
import type { ProviderStatus, Ticket, TicketProvider, TicketSearch } from './ticket-provider.js';

type Options = {
  readonly apiUrl: string;
  readonly uploadsUrl: string;
  readonly token: string;
  readonly team: string;
  readonly project?: string;
  readonly repository: string;
  readonly http: Http;
};

const RECORD_TITLE = 'Factory record';
const RECORD_SUBTITLE = 'Kept up to date by the software factory';
const FILE_SUBTITLE = 'Spec file attached by the software factory';
const PAGE_SIZE = 50;

const SPANS = 'nodes { startedAt endedAt }';
const ISSUE_FIELDS = `id identifier title description createdAt updatedAt
  state { name }
  team { id }
  labels(first: 50) { nodes { name } }
  oldestSpan: stateHistory(first: 1) { ${SPANS} }
  newestSpan: stateHistory(last: 1) { ${SPANS} }
  record: attachments(first: 1, filter: { subtitle: { eq: "${RECORD_SUBTITLE}" } }) { nodes { metadata } }`;

const Q = {
  Viewer: 'query Viewer { viewer { id } }',
  Issue: `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
  Issues: `query Issues($filter: IssueFilter!, $after: String) { issues(filter: $filter, first: ${PAGE_SIZE}, after: $after) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
  Claims: `query Claims($id: String!) { issue(id: $id) {
    oldest: history(first: 25) { nodes { createdAt actorId fromState { name } toState { name } } }
    newest: history(last: 25) { nodes { createdAt actorId fromState { name } toState { name } } } } }`,
  Attachments: `query Attachments($id: String!) { issue(id: $id) { attachments(first: 100, filter: { subtitle: { eq: "${FILE_SUBTITLE}" } }) { nodes { title url createdAt } } } }`,
  Comment: 'query Comment($id: String!) { comment(id: $id) { body updatedAt } }',
  States: 'query States($filter: WorkflowStateFilter!) { workflowStates(filter: $filter, first: 100) { nodes { id name type } } }',
  UpdateIssue: 'mutation UpdateIssue($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }',
  CreateComment: 'mutation CreateComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id url } } }',
  UpdateComment: 'mutation UpdateComment($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { success } }',
  CreateAttachment: 'mutation CreateAttachment($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }',
  FileUpload: 'mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }',
} as const;

type Operation = keyof typeof Q;

const Span = z.object({ startedAt: z.string(), endedAt: z.string().nullable() });
const IssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  state: z.object({ name: z.string() }),
  team: z.object({ id: z.string() }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  oldestSpan: z.object({ nodes: z.array(Span) }),
  newestSpan: z.object({ nodes: z.array(Span) }),
  record: z.object({ nodes: z.array(z.object({ metadata: z.object({ commentId: z.string() }).partial() })) }),
});
const Claim = z.object({ createdAt: z.string(), actorId: z.string().nullable(), fromState: z.object({ name: z.string() }).nullable(), toState: z.object({ name: z.string() }).nullable() });
const ClaimsSchema = z.object({ issue: z.object({ oldest: z.object({ nodes: z.array(Claim) }), newest: z.object({ nodes: z.array(Claim) }) }) });
const IssuesSchema = z.object({
  issues: z.object({ nodes: z.array(IssueSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
});
const AttachmentsSchema = z.object({ issue: z.object({ attachments: z.object({ nodes: z.array(z.object({ title: z.string(), url: z.string(), createdAt: z.string() })) }) }) });
const CommentSchema = z.object({ comment: z.object({ body: z.string(), updatedAt: z.string() }) });
const StatesSchema = z.object({ workflowStates: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })) }) });
const ViewerSchema = z.object({ viewer: z.object({ id: z.string() }) });
const Success = z.object({ success: z.literal(true) });
const CreatedCommentSchema = z.object({ commentCreate: Success.extend({ comment: z.object({ id: z.string(), url: z.string() }) }) });
const UploadSchema = z.object({
  fileUpload: Success.extend({ uploadFile: z.object({ uploadUrl: z.string(), assetUrl: z.string(), headers: z.array(z.object({ key: z.string(), value: z.string() })) }) }),
});
const ResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const STATE_CATEGORIES: Readonly<Record<string, ProviderStatus['category']>> = {
  triage: 'todo',
  backlog: 'todo',
  unstarted: 'todo',
  started: 'in_progress',
  completed: 'done',
  canceled: 'done',
};

type Issue = z.infer<typeof IssueSchema>;

const NOT_FOUND = 'Entity not found';

const toIso = (linearTime: string): string => new Date(linearTime).toISOString().replace('.000Z', 'Z');

const latest = (...times: readonly string[]): string => toIso(new Date(Math.max(...times.map(Date.parse))).toISOString());

const refused = (status: number): boolean => status >= 400;


class LinearNotFound extends Error {}

const jsonOf = (text: string, failure: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(failure);
  }
};

export const createLinearTicketProvider = ({ apiUrl, uploadsUrl, token, team, project, repository, http }: Options): TicketProvider => {
  const ask = async <T>(operation: Operation, schema: z.ZodType<T>, variables: Readonly<Record<string, unknown>>): Promise<T> => {
    const response = await http({
      method: 'POST',
      url: apiUrl,
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ operationName: operation, query: Q[operation], variables }),
    });
    const parsed = ResponseSchema.safeParse(jsonOf(response.body, `Linear answered ${response.status} to ${operation}, not in JSON`));
    const message = parsed.data?.errors?.[0]?.message;
    if (message?.startsWith(NOT_FOUND) === true) throw new LinearNotFound(message);
    if (message !== undefined) throw new Error(`Linear refused ${operation}: ${message}`);
    if (parsed.data?.data == null) throw new Error(`Linear answered ${response.status} to ${operation}`);
    return schema.parse(parsed.data.data);
  };

  const orUndefined = async <T>(pending: Promise<T>): Promise<T | undefined> =>
    pending.catch((error: unknown) => {
      if (error instanceof LinearNotFound) return undefined;
      throw error;
    });

  const readIssue = async (key: string): Promise<Issue | undefined> => (await orUndefined(ask('Issue', z.object({ issue: IssueSchema }), { id: key })))?.issue;

  const existingIssue = async (key: string): Promise<Issue> => {
    const issue = await readIssue(key);
    if (issue === undefined) throw new Error(`Ticket ${key} was not found`);
    return issue;
  };

  const viewer = (() => {
    const cached: { id?: Promise<string> } = {};
    return (): Promise<string> => {
      cached.id ??= ask('Viewer', ViewerSchema, {}).then((answer) => answer.viewer.id);
      return cached.id;
    };
  })();

  const commentIdOf = (issue: Issue): string | undefined => issue.record.nodes[0]?.metadata.commentId;

  const readComment = async (commentId: string) => (await ask('Comment', CommentSchema, { id: commentId })).comment;

  const statusSince = (issue: Issue): string =>
    [...issue.newestSpan.nodes, ...issue.oldestSpan.nodes].find((span) => span.endedAt === null)?.startedAt ?? issue.createdAt;

  const toTicket = async (issue: Issue): Promise<Ticket> => {
    const commentId = commentIdOf(issue);
    const comment = commentId === undefined ? undefined : await readComment(commentId);
    return {
      key: issue.identifier,
      title: issue.title,
      status: issue.state.name,
      labels: issue.labels.nodes.map((label) => label.name),
      repository,
      updatedAt: comment === undefined ? toIso(issue.updatedAt) : latest(issue.updatedAt, comment.updatedAt),
      statusSince: toIso(statusSince(issue)),
      ...(issue.description === null ? {} : { spec: issue.description }),
      ...(comment === undefined ? {} : { factoryComment: comment.body }),
    };
  };

  const statesOf = async (filter: Readonly<Record<string, unknown>>) => (await ask('States', StatesSchema, { filter })).workflowStates.nodes;

  const claimantOf = async (key: string, from: string, to: string): Promise<string | null | undefined> => {
    const { issue } = await ask('Claims', ClaimsSchema, { id: key });
    return [...issue.oldest.nodes, ...issue.newest.nodes]
      .filter((entry) => entry.fromState?.name === from && entry.toState?.name === to)
      .toSorted((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))[0]?.actorId;
  };

  const searchFilter = ({ statuses, label, updatedSince }: TicketSearch) => ({
    team: { key: { eq: team } },
    ...(project === undefined ? {} : { project: { name: { eq: project } } }),
    ...(statuses === undefined ? {} : { state: { name: { in: statuses } } }),
    ...(label === undefined ? {} : { labels: { some: { name: { eq: label } } } }),
    ...(updatedSince === undefined ? {} : { or: [{ updatedAt: { gt: updatedSince } }, { comments: { some: { updatedAt: { gt: updatedSince } } } }] }),
  });

  const searchPages = async (filter: ReturnType<typeof searchFilter>, after: string | null): Promise<readonly Issue[]> => {
    const { issues } = await ask('Issues', IssuesSchema, { filter, after });
    return issues.pageInfo.hasNextPage ? [...issues.nodes, ...(await searchPages(filter, issues.pageInfo.endCursor))] : issues.nodes;
  };

  return {
    getTicket: async (key) => {
      const issue = await readIssue(key);
      return issue === undefined ? undefined : toTicket(issue);
    },

    transition: async ({ key, from, to }) => {
      const issue = await readIssue(key);
      if (issue === undefined) return { ok: false, reason: 'not_found' };
      if (issue.state.name !== from) return { ok: false, reason: 'not_in_expected_status', actual: issue.state.name };
      const state = (await statesOf({ team: { id: { eq: issue.team.id } }, name: { eq: to } }))[0];
      if (state === undefined) throw new Error(`${team} has no status "${to}"`);
      await ask('UpdateIssue', z.object({ issueUpdate: Success }), { id: issue.id, stateId: state.id });
      const [claimant, self] = await Promise.all([claimantOf(key, from, to), viewer()]);
      if (claimant === self) return { ok: true };
      return { ok: false, reason: 'not_in_expected_status', actual: (await existingIssue(key)).state.name };
    },

    getFactoryComment: async (key) => {
      const issue = await readIssue(key);
      const commentId = issue === undefined ? undefined : commentIdOf(issue);
      return commentId === undefined ? undefined : (await readComment(commentId)).body;
    },

    putFactoryComment: async (key, body) => {
      const issue = await existingIssue(key);
      const commentId = commentIdOf(issue);
      if (commentId !== undefined) {
        await ask('UpdateComment', z.object({ commentUpdate: Success }), { id: commentId, body });
        return;
      }
      const { comment } = (await ask('CreateComment', CreatedCommentSchema, { issueId: issue.id, body })).commentCreate;
      await ask('CreateAttachment', z.object({ attachmentCreate: Success }), {
        input: { issueId: issue.id, url: comment.url, title: RECORD_TITLE, subtitle: RECORD_SUBTITLE, metadata: { commentId: comment.id } },
      });
    },

    addAttachment: async ({ key, name, content }) => {
      const issue = await existingIssue(key);
      const contentType = 'text/markdown';
      const { uploadFile } = (await ask('FileUpload', UploadSchema, { contentType, filename: name, size: new TextEncoder().encode(content).length })).fileUpload;
      const stored = await http({
        method: 'PUT',
        url: uploadFile.uploadUrl,
        headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000', ...Object.fromEntries(uploadFile.headers.map(({ key: header, value }) => [header, value])) },
        body: content,
      });
      if (refused(stored.status)) throw new Error(`The upload of ${name} answered ${stored.status}`);
      await ask('CreateAttachment', z.object({ attachmentCreate: Success }), {
        input: { issueId: issue.id, url: uploadFile.assetUrl, title: name, subtitle: FILE_SUBTITLE },
      });
      return uploadFile.assetUrl;
    },

    listAttachments: async (key) => {
      const answer = await orUndefined(ask('Attachments', AttachmentsSchema, { id: key }));
      if (answer === undefined) throw new Error(`Ticket ${key} was not found`);
      return answer.issue.attachments.nodes
        .toSorted((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
        .map(({ title, url }) => ({ name: title, link: url }));
    },

    readAttachment: async (link) => {
      if (!link.startsWith(`${uploadsUrl}/`)) throw new Error(`Attachment link is not on ${uploadsUrl}`);
      const response = await http({ method: 'GET', url: link, headers: { authorization: token } });
      if (refused(response.status)) throw new Error(`Linear answered ${response.status} to the attachment ${link}`);
      return response.body;
    },

    search: async (criteria) => {
      const since = criteria.updatedSince;
      const tickets = await Promise.all((await searchPages(searchFilter(criteria), null)).map(toTicket));
      return since === undefined ? tickets : tickets.filter((ticket) => Date.parse(ticket.updatedAt) > Date.parse(since));
    },

    listStatuses: async () => {
      const listed = (await statesOf({ team: { key: { eq: team } } })).map(({ name, type }) => ({ name, category: STATE_CATEGORIES[type] ?? ('unknown' as const) }));
      return listed.filter((status, index) => listed.findIndex((other) => other.name === status.name) === index);
    },

    checkAccess: async (key) => {
      await existingIssue(key);
      return { comment: true, transition: true };
    },

    canReenter: async ({ key }) => {
      await existingIssue(key);
      return false;
    },
  };
};
