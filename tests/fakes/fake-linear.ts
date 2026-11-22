import type { Http, HttpRequest, HttpResponse } from '../../src/adapters/http.js';
import type { Ticket } from '../../src/adapters/ticket-provider.js';

type State = { readonly id: string; readonly name: string; readonly type: string; readonly team: string };
type Span = { readonly startedAt: string; endedAt: string | null };
type History = { readonly createdAt: string; readonly actorId: string; readonly fromState: string; readonly toState: string };
type Comment = { readonly id: string; body: string; updatedAt: string };
type LinkedAttachment = { readonly issueId: string; readonly url: string; readonly title: string; readonly subtitle: string; readonly metadata: unknown; readonly createdAt: string };

type Issue = {
  readonly id: string;
  readonly identifier: string;
  readonly team: string;
  readonly project: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly labels: readonly string[];
  readonly createdAt: string;
  state: string;
  updatedAt: string;
  readonly spans: Span[];
  readonly history: History[];
};

type Options = {
  readonly tickets: readonly Ticket[];
  readonly now: () => string;
  readonly accounts?: Readonly<Record<string, string>>;
  readonly projects?: Readonly<Record<string, string>>;
  readonly extraStates?: readonly { readonly name: string; readonly type: string; readonly team?: string }[];
  readonly pageSize?: number;
  readonly uploadStatus?: number;
  readonly unsuccessful?: readonly string[];
};

export const LINEAR_API = 'https://api.linear.app/graphql';
export const LINEAR_UPLOADS = 'https://uploads.linear.app';
const STORAGE = 'https://storage.googleapis.test/linear-uploads';

const TEAM_STATES: readonly (readonly [string, string])[] = [
  ['To refine', 'backlog'],
  ['Spec review', 'unstarted'],
  ['Ready for Dev', 'unstarted'],
  ['In development', 'started'],
  ['In review', 'started'],
  ['Blocked', 'started'],
  ['Done', 'completed'],
];

const json = (status: number, body: unknown): HttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });
const data = (value: unknown): HttpResponse => json(200, { data: value });
const failure = (message: string): HttpResponse => json(200, { data: null, errors: [{ message, extensions: { code: 'INPUT_ERROR' } }] });
const NOT_FOUND = (entity: string): HttpResponse => failure(`Entity not found: ${entity} - Could not find referenced ${entity}.`);

const teamOf = (identifier: string): string => identifier.split('-')[0] ?? '';

type Filter = Readonly<Record<string, unknown>>;

const isFilter = (value: unknown): value is Filter => typeof value === 'object' && value !== null && !Array.isArray(value);

const filterAt = (filter: Filter, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => (isFilter(value) ? value[key] : undefined), filter);

const compare = (comparator: unknown, value: string): boolean => {
  if (!isFilter(comparator) || Object.keys(comparator).length === 0) throw new Error(`Fake Linear cannot read the comparator ${JSON.stringify(comparator)}`);
  return Object.entries(comparator).every(([operator, expected]) => {
    if (operator === 'eq') return value === expected;
    if (operator === 'in' && Array.isArray(expected)) return expected.includes(value);
    if (operator === 'gt' && typeof expected === 'string') return Date.parse(value) > Date.parse(expected);
    throw new Error(`Fake Linear does not support the operator ${operator}`);
  });
};

const LEAVES = new Set(['metadata']);
const PAYLOADS: Readonly<Record<string, string>> = { UpdateIssue: 'issueUpdate', CreateComment: 'commentCreate', UpdateComment: 'commentUpdate', CreateAttachment: 'attachmentCreate', FileUpload: 'fileUpload' };

const asked = (value: unknown, query: string): unknown => {
  if (Array.isArray(value)) return value.map((item) => asked(item, query));
  if (!isFilter(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => new RegExp(`\\b${key}\\b`).test(query))
      .map(([key, field]) => [key, LEAVES.has(key) ? field : asked(field, query)]),
  );
};

export const createFakeLinear = ({ tickets, now, accounts = { 'lin_api_factory': 'user-factory' }, projects = {}, extraStates = [], pageSize = 50, uploadStatus, unsuccessful = [] }: Options) => {
  const states: State[] = [
    ...['PAY', 'OPS'].flatMap((team) => TEAM_STATES.map(([name, type]) => ({ id: `${team}-${name}`, name, type, team }))),
    ...extraStates.map(({ name, type, team = 'PAY' }) => ({ id: `${team}-${name}`, name, type, team })),
  ];
  const issues: Issue[] = tickets.map((ticket, index) => ({
    id: `issue-${index + 1}`,
    identifier: ticket.key,
    team: teamOf(ticket.key),
    project: projects[ticket.key] ?? null,
    title: ticket.title,
    description: ticket.spec ?? null,
    labels: ticket.labels,
    createdAt: '2026-11-01T09:00:00.000Z',
    state: ticket.status,
    updatedAt: ticket.updatedAt,
    spans: [{ startedAt: ticket.statusSince, endedAt: null }],
    history: [],
  }));
  const comments: (Comment & { readonly issueId: string })[] = [];
  const attachments: LinkedAttachment[] = [];
  const uploads = new Map<string, { readonly assetUrl: string; readonly contentType: string; readonly range: string; content?: string }>();
  const requests: HttpRequest[] = [];
  const counter = { next: 0 };
  const nextId = (prefix: string): string => {
    counter.next += 1;
    return `${prefix}-${counter.next}`;
  };

  const findIssue = (id: unknown): Issue | undefined => issues.find((issue) => issue.identifier === id || issue.id === id);

  const issueNode = (issue: Issue) => {
    const spans = issue.spans.map(({ startedAt, endedAt }) => ({ startedAt, endedAt }));
    const record = attachments.filter((attachment) => attachment.issueId === issue.id && attachment.subtitle === 'Kept up to date by the software factory');
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      state: { name: issue.state },
      team: { id: issue.team },
      labels: { nodes: issue.labels.map((name) => ({ name })) },
      oldestSpan: { nodes: spans.slice(0, 1) },
      newestSpan: { nodes: spans.slice(-1) },
      record: { nodes: record.slice(0, 1).map(({ metadata }) => ({ metadata })) },
    };
  };

  const matchesIssue = (issue: Issue, filter: Filter): boolean =>
    Object.entries(filter).every(([key, value]) => {
      if (key === 'team') return compare(filterAt(filter, 'team', 'key'), issue.team);
      if (key === 'project') return issue.project !== null && compare(filterAt(filter, 'project', 'name'), issue.project);
      if (key === 'state') return compare(filterAt(filter, 'state', 'name'), issue.state);
      if (key === 'labels') return issue.labels.some((label) => compare(filterAt(filter, 'labels', 'some', 'name'), label));
      if (key === 'updatedAt') return compare(value, issue.updatedAt);
      if (key === 'comments') return comments.some((comment) => comment.issueId === issue.id && compare(filterAt(filter, 'comments', 'some', 'updatedAt'), comment.updatedAt));
      if (key === 'or' && Array.isArray(value)) return value.some((part) => isFilter(part) && matchesIssue(issue, part));
      throw new Error(`Fake Linear does not support the issue filter ${key}`);
    });

  const matchesState = (state: State, filter: Filter): boolean =>
    Object.keys(filter).every((key) => {
      if (key === 'team') {
        const byKey = filterAt(filter, 'team', 'key');
        return byKey === undefined ? compare(filterAt(filter, 'team', 'id'), state.team) : compare(byKey, state.team);
      }
      if (key === 'name') return compare(filter['name'], state.name);
      throw new Error(`Fake Linear does not support the state filter ${key}`);
    });

  const operations: Readonly<Record<string, (variables: Filter, actor: string) => HttpResponse>> = {
    Viewer: (_variables, actor) => data({ viewer: { id: actor } }),

    Issue: ({ id }) => {
      const issue = findIssue(id);
      return issue === undefined ? NOT_FOUND('Issue') : data({ issue: issueNode(issue) });
    },

    Issues: ({ filter, after }) => {
      const matching = issues.filter((issue) => matchesIssue(issue, isFilter(filter) ? filter : {}));
      const start = typeof after === 'string' ? Number(after) : 0;
      const page = matching.slice(start, start + pageSize);
      const hasNextPage = start + pageSize < matching.length;
      return data({ issues: { nodes: page.map(issueNode), pageInfo: { hasNextPage, endCursor: page.length === 0 ? null : String(start + page.length) } } });
    },

    Claims: ({ id }) => {
      const issue = findIssue(id);
      if (issue === undefined) return NOT_FOUND('Issue');
      const nodes = issue.history.map(({ createdAt, actorId, fromState, toState }) => ({ createdAt, actorId, fromState: { name: fromState }, toState: { name: toState } }));
      return data({ issue: { oldest: { nodes: nodes.slice(0, 25) }, newest: { nodes: nodes.slice(-25) } } });
    },

    Attachments: ({ id }) => {
      const issue = findIssue(id);
      if (issue === undefined) return NOT_FOUND('Issue');
      const files = attachments.filter((attachment) => attachment.issueId === issue.id && attachment.subtitle === 'Spec file attached by the software factory');
      return data({ issue: { attachments: { nodes: files.map(({ title, url, createdAt }) => ({ title, url, createdAt })).toReversed() } } });
    },

    Comment: ({ id }) => {
      const comment = comments.find((candidate) => candidate.id === id);
      return comment === undefined ? NOT_FOUND('Comment') : data({ comment: { body: comment.body, updatedAt: comment.updatedAt } });
    },

    States: ({ filter }) => data({ workflowStates: { nodes: states.filter((state) => matchesState(state, isFilter(filter) ? filter : {})).map(({ id, name, type }) => ({ id, name, type })) } }),

    UpdateIssue: ({ id, stateId }, actor) => {
      const issue = findIssue(id);
      const state = states.find((candidate) => candidate.id === stateId);
      if (issue === undefined) return NOT_FOUND('Issue');
      if (state === undefined) return NOT_FOUND('WorkflowState');
      if (state.name !== issue.state) {
        const at = now();
        issue.history.push({ createdAt: at, actorId: actor, fromState: issue.state, toState: state.name });
        issue.spans.forEach((span) => {
          if (span.endedAt === null) span.endedAt = at;
        });
        issue.spans.push({ startedAt: at, endedAt: null });
        issue.state = state.name;
        issue.updatedAt = at;
      }
      return data({ issueUpdate: { success: true } });
    },

    CreateComment: ({ issueId, body }) => {
      const issue = findIssue(issueId);
      if (issue === undefined || typeof body !== 'string') return NOT_FOUND('Issue');
      const id = nextId('comment');
      comments.push({ id, issueId: issue.id, body, updatedAt: now() });
      return data({ commentCreate: { success: true, comment: { id, url: `https://linear.app/acme/issue/${issue.identifier}#comment-${id}` } } });
    },

    UpdateComment: ({ id, body }) => {
      const comment = comments.find((candidate) => candidate.id === id);
      if (comment === undefined || typeof body !== 'string') return NOT_FOUND('Comment');
      comment.body = body;
      comment.updatedAt = now();
      return data({ commentUpdate: { success: true } });
    },

    CreateAttachment: ({ input }) => {
      const issue = findIssue(filterAt(isFilter(input) ? input : {}, 'issueId'));
      if (!isFilter(input) || issue === undefined) return NOT_FOUND('Issue');
      const { url, title, subtitle, metadata } = input;
      if (typeof url !== 'string' || typeof title !== 'string' || typeof subtitle !== 'string') return failure('Argument Validation Error');
      nextId('attachment');
      const kept = attachments.filter((attachment) => !(attachment.issueId === issue.id && attachment.url === url));
      attachments.splice(0, attachments.length, ...kept, { issueId: issue.id, url, title, subtitle, metadata: metadata ?? {}, createdAt: new Date(Date.parse(now()) + counter.next).toISOString() });
      return data({ attachmentCreate: { success: true } });
    },

    FileUpload: ({ filename, size, contentType }) => {
      if (typeof filename !== 'string' || typeof size !== 'number' || typeof contentType !== 'string') return failure('Argument Validation Error');
      const id = nextId('upload');
      const uploadUrl = `${STORAGE}/${id}?signature=abc`;
      uploads.set(uploadUrl, { assetUrl: `${LINEAR_UPLOADS}/org-1/${id}/${encodeURIComponent(filename)}`, contentType, range: `${size},${size}` });
      return data({ fileUpload: { success: true, uploadFile: { uploadUrl, assetUrl: uploads.get(uploadUrl)?.assetUrl, headers: [{ key: 'x-goog-content-length-range', value: `${size},${size}` }] } } });
    },
  };

  const graphql = (request: HttpRequest): HttpResponse => {
    const actor = accounts[request.headers['authorization'] ?? ''];
    if (actor === undefined) return json(400, { errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] });
    const parsed: unknown = JSON.parse(request.body ?? '{}');
    const name = filterAt(isFilter(parsed) ? parsed : {}, 'operationName');
    const variables = filterAt(isFilter(parsed) ? parsed : {}, 'variables');
    const query = filterAt(isFilter(parsed) ? parsed : {}, 'query');
    const operation = typeof name === 'string' ? operations[name] : undefined;
    if (operation === undefined || typeof query !== 'string') return failure(`Fake Linear has no operation ${String(name)}`);
    const payload = PAYLOADS[String(name)];
    if (payload !== undefined && unsuccessful.includes(String(name))) return data(Object.fromEntries([[payload, { success: false }]]));
    const response = operation(isFilter(variables) ? variables : {}, actor);
    const answer: unknown = JSON.parse(response.body);
    return isFilter(answer) && answer['data'] !== undefined ? json(response.status, { ...answer, data: asked(answer['data'], query) }) : response;
  };

  const storage = (request: HttpRequest): HttpResponse => {
    const upload = uploads.get(request.url);
    const signed = request.headers['content-type'] === upload?.contentType && request.headers['cache-control'] === 'public, max-age=31536000' && request.headers['x-goog-content-length-range'] === upload?.range;
    if (upload === undefined || !signed || uploadStatus !== undefined) return { status: uploadStatus ?? 403, headers: {}, body: 'SignatureDoesNotMatch' };
    upload.content = request.body ?? '';
    return { status: 200, headers: {}, body: '' };
  };

  const asset = (request: HttpRequest): HttpResponse => {
    if (accounts[request.headers['authorization'] ?? ''] === undefined) return { status: 401, headers: {}, body: 'Unauthorized' };
    const found = [...uploads.values()].find((upload) => upload.assetUrl === request.url && upload.content !== undefined);
    return found === undefined ? { status: 404, headers: {}, body: 'Not found' } : { status: 200, headers: {}, body: found.content ?? '' };
  };

  const http: Http = async (request) => {
    requests.push(request);
    await Promise.resolve();
    if (request.url === LINEAR_API && request.method === 'POST') return graphql(request);
    if (request.url.startsWith(`${STORAGE}/`) && request.method === 'PUT') return storage(request);
    if (request.url.startsWith(`${LINEAR_UPLOADS}/`) && request.method === 'GET') return asset(request);
    return { status: 404, headers: {}, body: 'Not found' };
  };

  return { http, requests, issues, comments };
};
