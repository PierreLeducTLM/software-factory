import type { Ticket } from '../../src/adapters/ticket-provider.js';
import type { Http, HttpRequest, HttpResponse } from '../../src/adapters/http.js';

type Issue = {
  key: string;
  summary: string;
  status: string;
  labels: readonly string[];
  description: string | null;
  updated: string;
  statusChanged: string;
  properties: Record<string, unknown>;
  comments: { id: string; body: string }[];
};

type Options = {
  readonly baseUrl: string;
  readonly tickets: readonly Ticket[];
  readonly now: () => string;
  readonly pageSize?: number;
};

const jiraTime = (iso: string): string => iso.replace('Z', '.000+0000');

const json = (status: number, body: unknown): HttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });
const empty = (status: number): HttpResponse => ({ status, headers: {}, body: '' });

const fieldsOf = (issue: Issue, wanted: readonly string[]) =>
  Object.fromEntries(
    Object.entries({
      summary: issue.summary,
      status: { name: issue.status },
      labels: issue.labels,
      description: issue.description,
      updated: jiraTime(issue.updated),
      statuscategorychangedate: jiraTime(issue.statusChanged),
    }).filter(([name]) => wanted.includes(name)),
  );

const propertiesOf = (issue: Issue, wanted: readonly string[]) =>
  Object.fromEntries(Object.entries(issue.properties).filter(([name]) => wanted.includes(name)));

const matchesJql = (issue: Issue, jql: string, now: string): boolean => {
  const statuses = /status in \(([^)]*)\)/.exec(jql)?.[1];
  const label = /labels = "([^"]*)"/.exec(jql)?.[1];
  const minutes = /updated >= "-(\d+)m"/.exec(jql)?.[1];
  return (
    (statuses === undefined || statuses.split(',').map((part) => part.trim().slice(1, -1)).includes(issue.status)) &&
    (label === undefined || issue.labels.includes(label)) &&
    (minutes === undefined || Date.parse(issue.updated) >= Date.parse(now) - Number(minutes) * 60_000)
  );
};

export const createFakeJira = ({ baseUrl, tickets, now, pageSize = 100 }: Options) => {
  const issues: Issue[] = tickets.map((ticket) => ({
    key: ticket.key,
    summary: ticket.title,
    status: ticket.status,
    labels: ticket.labels,
    description: ticket.spec ?? null,
    updated: ticket.updatedAt,
    statusChanged: ticket.statusSince,
    properties: {},
    comments: [],
  }));
  const attachments: string[] = [];
  const requests: HttpRequest[] = [];
  const statuses = ['To refine', 'Spec review', 'Ready for Dev', 'In development', 'In review', 'Blocked', 'Done'];
  const counter = { comment: 0 };

  const touch = (issue: Issue): void => {
    issue.updated = now();
  };

  const route = (request: HttpRequest): HttpResponse => {
    const path = request.url.slice(baseUrl.length);
    const isJson = request.headers['content-type'] === 'application/json';
    const body: unknown = request.body !== undefined && isJson ? JSON.parse(request.body) : undefined;
    if (!['GET', 'POST', 'PUT'].includes(request.method)) return empty(405);

    if (path === '/rest/api/3/search/jql' && request.method === 'POST') {
      const { jql, nextPageToken, fields, properties } = body as { jql: string; nextPageToken?: string; fields: string[]; properties: string[] };
      const matching = issues.filter((issue) => matchesJql(issue, jql, now()));
      const start = Number(nextPageToken ?? 0);
      const page = matching.slice(start, start + pageSize);
      return json(200, {
        issues: page.map((issue) => ({ key: issue.key, fields: fieldsOf(issue, fields), properties: propertiesOf(issue, properties) })),
        ...(start + pageSize < matching.length ? { nextPageToken: String(start + pageSize) } : {}),
      });
    }

    const attachment = /^\/rest\/api\/2\/attachment\/content\/(\d+)$/.exec(path);
    if (attachment !== null && request.method === 'GET') {
      const content = attachments[Number(attachment[1])];
      return content === undefined ? empty(404) : { status: 200, headers: {}, body: content };
    }

    const match = /^\/rest\/api\/2\/issue\/([^/?]+)(\/[^?]*)?/.exec(path);
    const issue = issues.find((candidate) => candidate.key === match?.[1]);
    if (match === null || issue === undefined) return empty(404);
    const rest = match[2] ?? '';

    if (rest === '' && request.method === 'GET') {
      const query = new URLSearchParams(path.split('?')[1] ?? '');
      return json(200, {
        key: issue.key,
        fields: fieldsOf(issue, (query.get('fields') ?? '').split(',')),
        properties: propertiesOf(issue, (query.get('properties') ?? '').split(',')),
      });
    }
    if (rest === '/transitions' && request.method === 'GET') {
      return json(200, {
        transitions: statuses.filter((name) => name !== issue.status).map((name) => ({ id: `to:${name}`, to: { name } })),
      });
    }
    if (rest === '/transitions' && request.method === 'POST') {
      const target = (body as { transition: { id: string } }).transition.id.slice('to:'.length);
      if (target === issue.status) return empty(400);
      issue.status = target;
      issue.statusChanged = now();
      touch(issue);
      return empty(204);
    }
    if (rest === '/properties/factory' && request.method === 'GET') {
      return issue.properties['factory'] === undefined ? empty(404) : json(200, { key: 'factory', value: issue.properties['factory'] });
    }
    if (rest === '/properties/factory' && request.method === 'PUT') {
      issue.properties['factory'] = body;
      return empty(204);
    }
    if (rest === '/comment' && request.method === 'POST') {
      counter.comment += 1;
      const comment = { id: String(10_000 + counter.comment), body: (body as { body: string }).body };
      issue.comments.push(comment);
      touch(issue);
      return json(201, comment);
    }
    const commentId = /^\/comment\/(\d+)$/.exec(rest)?.[1];
    const comment = issue.comments.find((candidate) => candidate.id === commentId);
    if (comment !== undefined && request.method === 'GET') return json(200, comment);
    if (comment !== undefined && request.method === 'PUT') {
      comment.body = (body as { body: string }).body;
      touch(issue);
      return json(200, comment);
    }
    if (rest === '/attachments' && request.method === 'POST') {
      if (request.headers['x-atlassian-token'] !== 'no-check') return empty(403);
      const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(request.headers['content-type'] ?? '')?.[1];
      const part = boundary === undefined || boundary === '' ? undefined : (request.body ?? '').split(`--${boundary}`)[1];
      const content = part === undefined ? undefined : /\r\n\r\n([\s\S]*)\r\n$/.exec(part)?.[1];
      if (content === undefined) return empty(400);
      attachments.push(content);
      return json(200, [{ id: String(attachments.length - 1), content: `${baseUrl}/rest/api/2/attachment/content/${attachments.length - 1}` }]);
    }
    return empty(404);
  };

  const http: Http = async (request) => {
    requests.push(request);
    return route(request);
  };

  return {
    http,
    requests,
    commentsOn: (key: string): readonly string[] => issues.find((issue) => issue.key === key)?.comments.map((comment) => comment.body) ?? [],
    editCommentByHand: (key: string, body: string): void => {
      const comment = issues.find((issue) => issue.key === key)?.comments[0];
      if (comment !== undefined) comment.body = body;
    },
  };
};
