import { z } from 'zod';
import type { Http, HttpResponse } from './http.js';
import type { ProviderStatus, Ticket, TicketProvider, TicketSearch } from './ticket-provider.js';

type Options = {
  readonly baseUrl: string;
  readonly email: string;
  readonly token: string;
  readonly repository: string;
  readonly filter: string;
  readonly http: Http;
  readonly now: () => string;
};

const FactoryPropertySchema = z.object({ commentId: z.string() });

const IssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    status: z.object({ name: z.string() }),
    labels: z.array(z.string()),
    description: z.string().nullable().optional(),
    updated: z.string(),
    statuscategorychangedate: z.string(),
  }),
  properties: z.object({ factory: FactoryPropertySchema.optional() }).optional(),
});

const SearchPageSchema = z.object({ issues: z.array(IssueSchema), nextPageToken: z.string().optional() });
const TransitionsSchema = z.object({ transitions: z.array(z.object({ id: z.string(), to: z.object({ name: z.string() }) })) });
const CommentSchema = z.object({ id: z.string(), body: z.string() });
const PropertySchema = z.object({ value: FactoryPropertySchema });
const ListedAttachmentsSchema = z.object({
  fields: z.object({ attachment: z.array(z.object({ filename: z.string(), content: z.string() })) }),
});
const AttachmentsSchema = z.tuple([z.object({ content: z.string() })]).rest(z.unknown());

const StatusesSchema = z.array(z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }).optional() }));
const Permission = z.object({ havePermission: z.boolean() });
const PermissionsSchema = z.object({ permissions: z.object({ ADD_COMMENTS: Permission, TRANSITION_ISSUES: Permission }) });

const STATUS_CATEGORIES: Readonly<Record<string, ProviderStatus['category']>> = { new: 'todo', indeterminate: 'in_progress', done: 'done' };

type Issue = z.infer<typeof IssueSchema>;

const ISSUE_FIELDS = ['summary', 'status', 'labels', 'description', 'updated', 'statuscategorychangedate'];
const NOT_FOUND = 404;
const MINUTE = 60_000;
const BOUNDARY = 'factory-attachment-boundary';

const toIso = (jiraTime: string): string => new Date(jiraTime).toISOString().replace('.000Z', 'Z');

const quoted = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;

export const createJiraTicketProvider = ({ baseUrl, email, token, repository, filter, http, now }: Options): TicketProvider => {
  const authorization = `Basic ${btoa(`${email}:${token}`)}`;

  const send = async (method: string, path: string, body?: unknown): Promise<HttpResponse> =>
    http({
      method,
      url: `${baseUrl}${path}`,
      headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const failure = (response: HttpResponse, method: string, path: string): Error =>
    new Error(`Jira answered ${response.status} to ${method} ${path}`);

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

  const issuePath = (key: string): string => `/rest/api/2/issue/${key}`;

  const readComment = async (key: string, commentId: string): Promise<string> =>
    CommentSchema.parse(JSON.parse((await call('GET', `${issuePath(key)}/comment/${commentId}`)).body)).body;

  const toTicket = async (issue: Issue): Promise<Ticket> => {
    const commentId = issue.properties?.factory?.commentId;
    const spec = issue.fields.description;
    return {
      key: issue.key,
      title: issue.fields.summary,
      status: issue.fields.status.name,
      labels: issue.fields.labels,
      repository,
      updatedAt: toIso(issue.fields.updated),
      statusSince: toIso(issue.fields.statuscategorychangedate),
      ...(typeof spec === 'string' ? { spec } : {}),
      ...(commentId === undefined ? {} : { factoryComment: await readComment(issue.key, commentId) }),
    };
  };

  const readIssue = async (issueKey: string): Promise<Issue | undefined> => {
    const response = await find(`${issuePath(issueKey)}?fields=${ISSUE_FIELDS.join(',')}&properties=factory`);
    return response === undefined ? undefined : IssueSchema.parse(JSON.parse(response.body));
  };

  const commentIdOf = async (issueKey: string): Promise<string | undefined> => {
    const response = await find(`${issuePath(issueKey)}/properties/factory`);
    return response === undefined ? undefined : PropertySchema.parse(JSON.parse(response.body)).value.commentId;
  };

  const searchPages = async (jql: string, nextPageToken?: string): Promise<readonly Issue[]> => {
    const response = await call('POST', '/rest/api/3/search/jql', {
      jql,
      fields: ISSUE_FIELDS,
      properties: ['factory'],
      maxResults: 100,
      ...(nextPageToken === undefined ? {} : { nextPageToken }),
    });
    const page = SearchPageSchema.parse(JSON.parse(response.body));
    return page.nextPageToken === undefined ? page.issues : [...page.issues, ...(await searchPages(jql, page.nextPageToken))];
  };

  const jqlFor = ({ statuses, label, updatedSince }: TicketSearch): string =>
    [
      `(${filter})`,
      ...(statuses === undefined ? [] : [`status in (${statuses.map(quoted).join(', ')})`]),
      ...(label === undefined ? [] : [`labels = ${quoted(label)}`]),
      ...(updatedSince === undefined
        ? []
        : [`updated >= "-${Math.ceil((Date.parse(now()) - Date.parse(updatedSince)) / MINUTE) + 1}m"`]),
    ].join(' AND ') + ' ORDER BY key';

  return {
    getTicket: async (issueKey) => {
      const issue = await readIssue(issueKey);
      return issue === undefined ? undefined : toTicket(issue);
    },

    transition: async ({ key: issueKey, from, to }) => {
      const issue = await readIssue(issueKey);
      if (issue === undefined) return { ok: false, reason: 'not_found' };
      const actual = issue.fields.status.name;
      if (actual !== from) return { ok: false, reason: 'not_in_expected_status', actual };
      const path = `${issuePath(issueKey)}/transitions`;
      const { transitions } = TransitionsSchema.parse(JSON.parse((await call('GET', path)).body));
      const transition = transitions.find((candidate) => candidate.to.name === to);
      if (transition === undefined) throw new Error(`${issueKey} has no transition from "${from}" to "${to}"`);
      const response = await send('POST', path, { transition: { id: transition.id } });
      if (response.status < 400) return { ok: true };
      const latest = await readIssue(issueKey);
      if (latest === undefined || latest.fields.status.name === from) throw failure(response, 'POST', path);
      return { ok: false, reason: 'not_in_expected_status', actual: latest.fields.status.name };
    },

    getFactoryComment: async (issueKey) => {
      const commentId = await commentIdOf(issueKey);
      return commentId === undefined ? undefined : readComment(issueKey, commentId);
    },

    putFactoryComment: async (issueKey, body) => {
      const commentId = await commentIdOf(issueKey);
      if (commentId !== undefined) {
        await call('PUT', `${issuePath(issueKey)}/comment/${commentId}`, { body });
        return;
      }
      const created = CommentSchema.parse(JSON.parse((await call('POST', `${issuePath(issueKey)}/comment`, { body })).body));
      await call('PUT', `${issuePath(issueKey)}/properties/factory`, { commentId: created.id });
    },

    addAttachment: async ({ key: issueKey, name, content }) => {
      const path = `${issuePath(issueKey)}/attachments`;
      const response = await http({
        method: 'POST',
        url: `${baseUrl}${path}`,
        headers: { authorization, 'x-atlassian-token': 'no-check', 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body: `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`,
      });
      if (response.status >= 400) throw failure(response, 'POST', path);
      return AttachmentsSchema.parse(JSON.parse(response.body))[0].content;
    },

    listAttachments: async (issueKey) => {
      const response = await call('GET', `${issuePath(issueKey)}?fields=attachment`);
      return ListedAttachmentsSchema.parse(JSON.parse(response.body)).fields.attachment.map(({ filename, content }) => ({ name: filename, link: content }));
    },

    readAttachment: async (link) => {
      if (!link.startsWith(`${baseUrl}/`)) throw new Error(`Attachment link is not on ${baseUrl}`);
      return (await call('GET', link.slice(baseUrl.length))).body;
    },

    search: async (criteria) => {
      const since = criteria.updatedSince;
      const tickets = await Promise.all((await searchPages(jqlFor(criteria))).map(toTicket));
      return since === undefined ? tickets : tickets.filter((ticket) => Date.parse(ticket.updatedAt) > Date.parse(since));
    },

    listStatuses: async () => {
      const listed = StatusesSchema.parse(JSON.parse((await call('GET', '/rest/api/2/status')).body));
      const statuses = listed.map(({ name, statusCategory }) => ({ name, category: STATUS_CATEGORIES[statusCategory?.key ?? ''] ?? ('unknown' as const) }));
      return statuses.filter((status, index) => statuses.findIndex((other) => other.name === status.name) === index);
    },

    checkAccess: async (issueKey) => {
      const response = await call('GET', `/rest/api/2/mypermissions?issueKey=${encodeURIComponent(issueKey)}&permissions=ADD_COMMENTS,TRANSITION_ISSUES`);
      const { ADD_COMMENTS: comment, TRANSITION_ISSUES: transition } = PermissionsSchema.parse(JSON.parse(response.body)).permissions;
      return { comment: comment.havePermission, transition: transition.havePermission };
    },
  };
};
