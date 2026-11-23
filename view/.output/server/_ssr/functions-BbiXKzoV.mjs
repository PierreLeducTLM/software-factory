import { TSS_SERVER_FUNCTION, createServerFn } from "./ssr.mjs";
import { _enum, array, boolean, discriminatedUnion, literal, number, object, string, tuple, unknown } from "../_libs/zod.mjs";
import { require_dist } from "../_libs/yaml.mjs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
// node_modules/.nitro/vite/services/ssr/assets/functions-BbiXKzoV.js
var import_dist = require_dist();
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
object({
	id: number(),
	title: string(),
	state: _enum([
		"OPEN",
		"MERGED",
		"DECLINED",
		"SUPERSEDED"
	]),
	summary: object({ raw: string() }).optional(),
	source: object({
		branch: object({ name: string() }),
		commit: object({ hash: string() })
	}),
	links: object({ html: object({ href: string() }) }),
	closed_by: object({
		nickname: string().optional(),
		display_name: string()
	}).nullable().optional(),
	updated_on: string(),
	queued: boolean().optional()
});
object({ target: object({ hash: string() }) });
object({ state: _enum([
	"SUCCESSFUL",
	"FAILED",
	"INPROGRESS",
	"STOPPED"
]) });
object({ error: object({ message: string() }) });
object({
	number: number(),
	html_url: string(),
	node_id: string(),
	state: _enum(["open", "closed"]),
	merged: boolean(),
	merged_at: string().nullable(),
	merged_by: object({ login: string() }).nullable(),
	body: string().nullable(),
	head: object({
		ref: string(),
		sha: string()
	}),
	auto_merge: unknown().nullable()
});
object({ check_runs: array(object({
	status: string(),
	conclusion: string().nullable()
})) });
object({
	errors: array(object({ message: string() })).optional(),
	data: unknown().optional()
});
object({ revertPullRequest: object({ revertPullRequest: object({ number: number() }) }) });
var TOO_MANY_REQUESTS = 429;
var DEFAULT_WAIT_SECONDS = 5;
var waitSeconds = (response) => {
	const indicated = Number(response.headers["retry-after"]);
	return Number.isFinite(indicated) ? indicated : DEFAULT_WAIT_SECONDS;
};
var sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var withRateLimitRetry = (http, { sleep, maxRetries }) => {
	const attempt = async (request, retriesLeft) => {
		const response = await http(request);
		if (response.status !== TOO_MANY_REQUESTS || retriesLeft === 0) return response;
		await sleep(waitSeconds(response) * 1e3);
		return attempt(request, retriesLeft - 1);
	};
	return (request) => attempt(request, maxRetries);
};
var createFetchHttp = () => async ({ method, url, headers, body }) => {
	const response = await fetch(url, {
		method,
		headers,
		body: body ?? null
	});
	return {
		status: response.status,
		headers: Object.fromEntries(response.headers.entries()),
		body: await response.text()
	};
};
var FactoryPropertySchema = object({ commentId: string() });
var IssueSchema$1 = object({
	key: string(),
	fields: object({
		summary: string(),
		status: object({ name: string() }),
		labels: array(string()),
		description: string().nullable().optional(),
		updated: string(),
		statuscategorychangedate: string()
	}),
	properties: object({ factory: FactoryPropertySchema.optional() }).optional()
});
var SearchPageSchema = object({
	issues: array(IssueSchema$1),
	nextPageToken: string().optional()
});
var TransitionsSchema = object({ transitions: array(object({
	id: string(),
	to: object({ name: string() }),
	isGlobal: boolean().optional()
})) });
var CommentSchema$1 = object({
	id: string(),
	body: string()
});
var PropertySchema = object({ value: FactoryPropertySchema });
var ListedAttachmentsSchema = object({ fields: object({ attachment: array(object({
	filename: string(),
	content: string()
})) }) });
var AttachmentsSchema$1 = tuple([object({ content: string() })]).rest(unknown());
var StatusesSchema = array(object({
	name: string(),
	statusCategory: object({ key: string() }).optional()
}));
var Permission = object({ havePermission: boolean() });
var PermissionsSchema = object({ permissions: object({
	ADD_COMMENTS: Permission,
	TRANSITION_ISSUES: Permission
}) });
var STATUS_CATEGORIES = {
	new: "todo",
	indeterminate: "in_progress",
	done: "done"
};
var ISSUE_FIELDS$1 = [
	"summary",
	"status",
	"labels",
	"description",
	"updated",
	"statuscategorychangedate"
];
var NOT_FOUND$1 = 404;
var MINUTE$1 = 6e4;
var BOUNDARY = "factory-attachment-boundary";
var toIso$1 = (jiraTime) => new Date(jiraTime).toISOString().replace(".000Z", "Z");
var quoted = (value) => `"${value.replaceAll("\"", "\\\"")}"`;
var createJiraTicketProvider = ({ baseUrl, email, token, repository, filter, http, now }) => {
	const authorization = `Basic ${btoa(`${email}:${token}`)}`;
	const send = async (method, path, body) => http({
		method,
		url: `${baseUrl}${path}`,
		headers: {
			authorization,
			...body === void 0 ? {} : { "content-type": "application/json" }
		},
		...body === void 0 ? {} : { body: JSON.stringify(body) }
	});
	const failure = (response, method, path) => /* @__PURE__ */ new Error(`Jira answered ${response.status} to ${method} ${path}`);
	const call = async (method, path, body) => {
		const response = await send(method, path, body);
		if (response.status >= 400) throw failure(response, method, path);
		return response;
	};
	const find = async (path) => {
		const response = await send("GET", path);
		if (response.status === NOT_FOUND$1) return void 0;
		if (response.status >= 400) throw failure(response, "GET", path);
		return response;
	};
	const issuePath = (key) => `/rest/api/2/issue/${key}`;
	const readComment = async (key, commentId) => CommentSchema$1.parse(JSON.parse((await call("GET", `${issuePath(key)}/comment/${commentId}`)).body)).body;
	const toTicket = async (issue) => {
		const commentId = issue.properties?.factory?.commentId;
		const spec = issue.fields.description;
		return {
			key: issue.key,
			title: issue.fields.summary,
			status: issue.fields.status.name,
			labels: issue.fields.labels,
			repository,
			updatedAt: toIso$1(issue.fields.updated),
			statusSince: toIso$1(issue.fields.statuscategorychangedate),
			...typeof spec === "string" ? { spec } : {},
			...commentId === void 0 ? {} : { factoryComment: await readComment(issue.key, commentId) }
		};
	};
	const readIssue = async (issueKey) => {
		const response = await find(`${issuePath(issueKey)}?fields=${ISSUE_FIELDS$1.join(",")}&properties=factory`);
		return response === void 0 ? void 0 : IssueSchema$1.parse(JSON.parse(response.body));
	};
	const commentIdOf = async (issueKey) => {
		const response = await find(`${issuePath(issueKey)}/properties/factory`);
		return response === void 0 ? void 0 : PropertySchema.parse(JSON.parse(response.body)).value.commentId;
	};
	const searchPages = async (jql, nextPageToken) => {
		const response = await call("POST", "/rest/api/3/search/jql", {
			jql,
			fields: ISSUE_FIELDS$1,
			properties: ["factory"],
			maxResults: 100,
			...nextPageToken === void 0 ? {} : { nextPageToken }
		});
		const page = SearchPageSchema.parse(JSON.parse(response.body));
		return page.nextPageToken === void 0 ? page.issues : [...page.issues, ...await searchPages(jql, page.nextPageToken)];
	};
	const jqlFor = ({ statuses, label, updatedSince }) => [
		`(${filter})`,
		...statuses === void 0 ? [] : [`status in (${statuses.map(quoted).join(", ")})`],
		...label === void 0 ? [] : [`labels = ${quoted(label)}`],
		...updatedSince === void 0 ? [] : [`updated >= "-${Math.ceil((Date.parse(now()) - Date.parse(updatedSince)) / MINUTE$1) + 1}m"`]
	].join(" AND ") + " ORDER BY key";
	return {
		getTicket: async (issueKey) => {
			const issue = await readIssue(issueKey);
			return issue === void 0 ? void 0 : toTicket(issue);
		},
		transition: async ({ key: issueKey, from, to }) => {
			const issue = await readIssue(issueKey);
			if (issue === void 0) return {
				ok: false,
				reason: "not_found"
			};
			const actual = issue.fields.status.name;
			if (actual !== from) return {
				ok: false,
				reason: "not_in_expected_status",
				actual
			};
			const path = `${issuePath(issueKey)}/transitions`;
			const { transitions } = TransitionsSchema.parse(JSON.parse((await call("GET", path)).body));
			const transition = transitions.find((candidate) => candidate.to.name === to);
			if (transition === void 0) throw new Error(`${issueKey} has no transition from "${from}" to "${to}"`);
			const response = await send("POST", path, { transition: { id: transition.id } });
			if (response.status < 400) return { ok: true };
			const latest = await readIssue(issueKey);
			if (latest === void 0 || latest.fields.status.name === from) throw failure(response, "POST", path);
			return {
				ok: false,
				reason: "not_in_expected_status",
				actual: latest.fields.status.name
			};
		},
		getFactoryComment: async (issueKey) => {
			const commentId = await commentIdOf(issueKey);
			return commentId === void 0 ? void 0 : readComment(issueKey, commentId);
		},
		putFactoryComment: async (issueKey, body) => {
			const commentId = await commentIdOf(issueKey);
			if (commentId !== void 0) {
				await call("PUT", `${issuePath(issueKey)}/comment/${commentId}`, { body });
				return;
			}
			const created = CommentSchema$1.parse(JSON.parse((await call("POST", `${issuePath(issueKey)}/comment`, { body })).body));
			await call("PUT", `${issuePath(issueKey)}/properties/factory`, { commentId: created.id });
		},
		addAttachment: async ({ key: issueKey, name, content }) => {
			const path = `${issuePath(issueKey)}/attachments`;
			const response = await http({
				method: "POST",
				url: `${baseUrl}${path}`,
				headers: {
					authorization,
					"x-atlassian-token": "no-check",
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`
				},
				body: `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`
			});
			if (response.status >= 400) throw failure(response, "POST", path);
			return AttachmentsSchema$1.parse(JSON.parse(response.body))[0].content;
		},
		listAttachments: async (issueKey) => {
			const response = await call("GET", `${issuePath(issueKey)}?fields=attachment`);
			return ListedAttachmentsSchema.parse(JSON.parse(response.body)).fields.attachment.map(({ filename, content }) => ({
				name: filename,
				link: content
			}));
		},
		readAttachment: async (link) => {
			if (!link.startsWith(`${baseUrl}/`)) throw new Error(`Attachment link is not on ${baseUrl}`);
			return (await call("GET", link.slice(baseUrl.length))).body;
		},
		search: async (criteria) => {
			const since = criteria.updatedSince;
			const tickets = await Promise.all((await searchPages(jqlFor(criteria))).map(toTicket));
			return since === void 0 ? tickets : tickets.filter((ticket) => Date.parse(ticket.updatedAt) > Date.parse(since));
		},
		listStatuses: async () => {
			const statuses = StatusesSchema.parse(JSON.parse((await call("GET", "/rest/api/2/status")).body)).map(({ name, statusCategory }) => ({
				name,
				category: STATUS_CATEGORIES[statusCategory?.key ?? ""] ?? "unknown"
			}));
			return statuses.filter((status, index) => statuses.findIndex((other) => other.name === status.name) === index);
		},
		checkAccess: async (issueKey) => {
			const response = await call("GET", `/rest/api/2/mypermissions?issueKey=${encodeURIComponent(issueKey)}&permissions=ADD_COMMENTS,TRANSITION_ISSUES`);
			const { ADD_COMMENTS: comment, TRANSITION_ISSUES: transition } = PermissionsSchema.parse(JSON.parse(response.body)).permissions;
			return {
				comment: comment.havePermission,
				transition: transition.havePermission
			};
		},
		canReenter: async ({ key: issueKey, status }) => {
			const issue = await readIssue(issueKey);
			if (issue === void 0) throw new Error(`Ticket ${issueKey} was not found`);
			const { transitions } = TransitionsSchema.parse(JSON.parse((await call("GET", `${issuePath(issueKey)}/transitions`)).body));
			const inStatus = issue.fields.status.name === status;
			return transitions.some((transition) => transition.to.name === status && (inStatus || transition.isGlobal === true));
		}
	};
};
var RECORD_TITLE = "Factory record";
var RECORD_SUBTITLE = "Kept up to date by the software factory";
var FILE_SUBTITLE = "Spec file attached by the software factory";
var PAGE_SIZE = 50;
var SPANS = "nodes { startedAt endedAt }";
var ISSUE_FIELDS = `id identifier title description createdAt updatedAt
  state { name }
  team { id }
  labels(first: 50) { nodes { name } }
  oldestSpan: stateHistory(first: 1) { ${SPANS} }
  newestSpan: stateHistory(last: 1) { ${SPANS} }
  record: attachments(first: 1, filter: { subtitle: { eq: "${RECORD_SUBTITLE}" } }) { nodes { metadata } }`;
var Q = {
	Viewer: "query Viewer { viewer { id } }",
	Issue: `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`,
	Issues: `query Issues($filter: IssueFilter!, $after: String) { issues(filter: $filter, first: ${PAGE_SIZE}, after: $after) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
	Claims: `query Claims($id: String!) { issue(id: $id) {
    oldest: history(first: 25) { nodes { createdAt actorId fromState { name } toState { name } } }
    newest: history(last: 25) { nodes { createdAt actorId fromState { name } toState { name } } } } }`,
	Attachments: `query Attachments($id: String!) { issue(id: $id) { attachments(first: 100, filter: { subtitle: { eq: "${FILE_SUBTITLE}" } }) { nodes { title url createdAt } } } }`,
	Comment: "query Comment($id: String!) { comment(id: $id) { body updatedAt } }",
	States: "query States($filter: WorkflowStateFilter!) { workflowStates(filter: $filter, first: 100) { nodes { id name type } } }",
	UpdateIssue: "mutation UpdateIssue($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }",
	CreateComment: "mutation CreateComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id url } } }",
	UpdateComment: "mutation UpdateComment($id: String!, $body: String!) { commentUpdate(id: $id, input: { body: $body }) { success } }",
	CreateAttachment: "mutation CreateAttachment($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }",
	FileUpload: "mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size) { success uploadFile { uploadUrl assetUrl headers { key value } } } }"
};
var Span = object({
	startedAt: string(),
	endedAt: string().nullable()
});
var IssueSchema = object({
	id: string(),
	identifier: string(),
	title: string(),
	description: string().nullable(),
	createdAt: string(),
	updatedAt: string(),
	state: object({ name: string() }),
	team: object({ id: string() }),
	labels: object({ nodes: array(object({ name: string() })) }),
	oldestSpan: object({ nodes: array(Span) }),
	newestSpan: object({ nodes: array(Span) }),
	record: object({ nodes: array(object({ metadata: object({ commentId: string() }).partial() })) })
});
var Claim = object({
	createdAt: string(),
	actorId: string().nullable(),
	fromState: object({ name: string() }).nullable(),
	toState: object({ name: string() }).nullable()
});
var ClaimsSchema = object({ issue: object({
	oldest: object({ nodes: array(Claim) }),
	newest: object({ nodes: array(Claim) })
}) });
var IssuesSchema = object({ issues: object({
	nodes: array(IssueSchema),
	pageInfo: object({
		hasNextPage: boolean(),
		endCursor: string().nullable()
	})
}) });
var AttachmentsSchema = object({ issue: object({ attachments: object({ nodes: array(object({
	title: string(),
	url: string(),
	createdAt: string()
})) }) }) });
var CommentSchema = object({ comment: object({
	body: string(),
	updatedAt: string()
}) });
var StatesSchema = object({ workflowStates: object({ nodes: array(object({
	id: string(),
	name: string(),
	type: string()
})) }) });
var ViewerSchema = object({ viewer: object({ id: string() }) });
var Success = object({ success: literal(true) });
var CreatedCommentSchema = object({ commentCreate: Success.extend({ comment: object({
	id: string(),
	url: string()
}) }) });
var UploadSchema = object({ fileUpload: Success.extend({ uploadFile: object({
	uploadUrl: string(),
	assetUrl: string(),
	headers: array(object({
		key: string(),
		value: string()
	}))
}) }) });
var ResponseSchema = object({
	data: unknown().optional(),
	errors: array(object({ message: string() })).optional()
});
var STATE_CATEGORIES = {
	triage: "todo",
	backlog: "todo",
	unstarted: "todo",
	started: "in_progress",
	completed: "done",
	canceled: "done"
};
var NOT_FOUND = "Entity not found";
var toIso = (linearTime) => new Date(linearTime).toISOString().replace(".000Z", "Z");
var latest = (...times) => toIso(new Date(Math.max(...times.map(Date.parse))).toISOString());
var refused = (status) => status >= 400;
var LinearNotFound = class extends Error {};
var jsonOf = (text, failure) => {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(failure);
	}
};
var createLinearTicketProvider = ({ apiUrl, uploadsUrl, token, team, project, repository, http }) => {
	const ask = async (operation, schema, variables) => {
		const response = await http({
			method: "POST",
			url: apiUrl,
			headers: {
				authorization: token,
				"content-type": "application/json"
			},
			body: JSON.stringify({
				operationName: operation,
				query: Q[operation],
				variables
			})
		});
		const parsed = ResponseSchema.safeParse(jsonOf(response.body, `Linear answered ${response.status} to ${operation}, not in JSON`));
		const message = parsed.data?.errors?.[0]?.message;
		if (message?.startsWith(NOT_FOUND) === true) throw new LinearNotFound(message);
		if (message !== void 0) throw new Error(`Linear refused ${operation}: ${message}`);
		if (parsed.data?.data == null) throw new Error(`Linear answered ${response.status} to ${operation}`);
		return schema.parse(parsed.data.data);
	};
	const orUndefined = async (pending) => pending.catch((error) => {
		if (error instanceof LinearNotFound) return void 0;
		throw error;
	});
	const readIssue = async (key) => (await orUndefined(ask("Issue", object({ issue: IssueSchema }), { id: key })))?.issue;
	const existingIssue = async (key) => {
		const issue = await readIssue(key);
		if (issue === void 0) throw new Error(`Ticket ${key} was not found`);
		return issue;
	};
	const viewer = (() => {
		const cached = {};
		return () => {
			cached.id ??= ask("Viewer", ViewerSchema, {}).then((answer) => answer.viewer.id);
			return cached.id;
		};
	})();
	const commentIdOf = (issue) => issue.record.nodes[0]?.metadata.commentId;
	const readComment = async (commentId) => (await ask("Comment", CommentSchema, { id: commentId })).comment;
	const statusSince = (issue) => [...issue.newestSpan.nodes, ...issue.oldestSpan.nodes].find((span) => span.endedAt === null)?.startedAt ?? issue.createdAt;
	const toTicket = async (issue) => {
		const commentId = commentIdOf(issue);
		const comment = commentId === void 0 ? void 0 : await readComment(commentId);
		return {
			key: issue.identifier,
			title: issue.title,
			status: issue.state.name,
			labels: issue.labels.nodes.map((label) => label.name),
			repository,
			updatedAt: comment === void 0 ? toIso(issue.updatedAt) : latest(issue.updatedAt, comment.updatedAt),
			statusSince: toIso(statusSince(issue)),
			...issue.description === null ? {} : { spec: issue.description },
			...comment === void 0 ? {} : { factoryComment: comment.body }
		};
	};
	const statesOf = async (filter) => (await ask("States", StatesSchema, { filter })).workflowStates.nodes;
	const claimantOf = async (key, from, to) => {
		const { issue } = await ask("Claims", ClaimsSchema, { id: key });
		return [...issue.oldest.nodes, ...issue.newest.nodes].filter((entry) => entry.fromState?.name === from && entry.toState?.name === to).toSorted((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))[0]?.actorId;
	};
	const searchFilter = ({ statuses, label, updatedSince }) => ({
		team: { key: { eq: team } },
		...project === void 0 ? {} : { project: { name: { eq: project } } },
		...statuses === void 0 ? {} : { state: { name: { in: statuses } } },
		...label === void 0 ? {} : { labels: { some: { name: { eq: label } } } },
		...updatedSince === void 0 ? {} : { or: [{ updatedAt: { gt: updatedSince } }, { comments: { some: { updatedAt: { gt: updatedSince } } } }] }
	});
	const searchPages = async (filter, after) => {
		const { issues } = await ask("Issues", IssuesSchema, {
			filter,
			after
		});
		return issues.pageInfo.hasNextPage ? [...issues.nodes, ...await searchPages(filter, issues.pageInfo.endCursor)] : issues.nodes;
	};
	return {
		getTicket: async (key) => {
			const issue = await readIssue(key);
			return issue === void 0 ? void 0 : toTicket(issue);
		},
		transition: async ({ key, from, to }) => {
			const issue = await readIssue(key);
			if (issue === void 0) return {
				ok: false,
				reason: "not_found"
			};
			if (issue.state.name !== from) return {
				ok: false,
				reason: "not_in_expected_status",
				actual: issue.state.name
			};
			const state = (await statesOf({
				team: { id: { eq: issue.team.id } },
				name: { eq: to }
			}))[0];
			if (state === void 0) throw new Error(`${team} has no status "${to}"`);
			await ask("UpdateIssue", object({ issueUpdate: Success }), {
				id: issue.id,
				stateId: state.id
			});
			const [claimant, self] = await Promise.all([claimantOf(key, from, to), viewer()]);
			if (claimant === self) return { ok: true };
			return {
				ok: false,
				reason: "not_in_expected_status",
				actual: (await existingIssue(key)).state.name
			};
		},
		getFactoryComment: async (key) => {
			const issue = await readIssue(key);
			const commentId = issue === void 0 ? void 0 : commentIdOf(issue);
			return commentId === void 0 ? void 0 : (await readComment(commentId)).body;
		},
		putFactoryComment: async (key, body) => {
			const issue = await existingIssue(key);
			const commentId = commentIdOf(issue);
			if (commentId !== void 0) {
				await ask("UpdateComment", object({ commentUpdate: Success }), {
					id: commentId,
					body
				});
				return;
			}
			const { comment } = (await ask("CreateComment", CreatedCommentSchema, {
				issueId: issue.id,
				body
			})).commentCreate;
			await ask("CreateAttachment", object({ attachmentCreate: Success }), { input: {
				issueId: issue.id,
				url: comment.url,
				title: RECORD_TITLE,
				subtitle: RECORD_SUBTITLE,
				metadata: { commentId: comment.id }
			} });
		},
		addAttachment: async ({ key, name, content }) => {
			const issue = await existingIssue(key);
			const contentType = "text/markdown";
			const { uploadFile } = (await ask("FileUpload", UploadSchema, {
				contentType,
				filename: name,
				size: new TextEncoder().encode(content).length
			})).fileUpload;
			const stored = await http({
				method: "PUT",
				url: uploadFile.uploadUrl,
				headers: {
					"content-type": contentType,
					"cache-control": "public, max-age=31536000",
					...Object.fromEntries(uploadFile.headers.map(({ key: header, value }) => [header, value]))
				},
				body: content
			});
			if (refused(stored.status)) throw new Error(`The upload of ${name} answered ${stored.status}`);
			await ask("CreateAttachment", object({ attachmentCreate: Success }), { input: {
				issueId: issue.id,
				url: uploadFile.assetUrl,
				title: name,
				subtitle: FILE_SUBTITLE
			} });
			return uploadFile.assetUrl;
		},
		listAttachments: async (key) => {
			const answer = await orUndefined(ask("Attachments", AttachmentsSchema, { id: key }));
			if (answer === void 0) throw new Error(`Ticket ${key} was not found`);
			return answer.issue.attachments.nodes.toSorted((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt)).map(({ title, url }) => ({
				name: title,
				link: url
			}));
		},
		readAttachment: async (link) => {
			if (!link.startsWith(`${uploadsUrl}/`)) throw new Error(`Attachment link is not on ${uploadsUrl}`);
			const response = await http({
				method: "GET",
				url: link,
				headers: { authorization: token }
			});
			if (refused(response.status)) throw new Error(`Linear answered ${response.status} to the attachment ${link}`);
			return response.body;
		},
		search: async (criteria) => {
			const since = criteria.updatedSince;
			const tickets = await Promise.all((await searchPages(searchFilter(criteria), null)).map(toTicket));
			return since === void 0 ? tickets : tickets.filter((ticket) => Date.parse(ticket.updatedAt) > Date.parse(since));
		},
		listStatuses: async () => {
			const listed = (await statesOf({ team: { key: { eq: team } } })).map(({ name, type }) => ({
				name,
				category: STATE_CATEGORIES[type] ?? "unknown"
			}));
			return listed.filter((status, index) => listed.findIndex((other) => other.name === status.name) === index);
		},
		checkAccess: async (key) => {
			await existingIssue(key);
			return {
				comment: true,
				transition: true
			};
		},
		canReenter: async ({ key }) => {
			await existingIssue(key);
			return false;
		}
	};
};
var EnvelopeSchema = discriminatedUnion("ok", [object({
	ok: literal(true),
	result: unknown()
}), object({
	ok: literal(false),
	error: object({
		code: string(),
		message: string()
	})
})]);
object({ worktree: object({
	id: string(),
	path: string(),
	branch: string(),
	hostId: string()
}) });
object({ outcome: object({
	kind: string(),
	handle: unknown()
}) });
var createCommandRunner = (binary) => {
	const run = promisify(execFile);
	return async (args, options) => ({ stdout: (await run(binary, [...args], options === void 0 ? {} : { cwd: options.cwd })).stdout });
};
var askOrca = async (run, args) => {
	const { stdout } = await run([...args, "--json"]);
	const envelope = EnvelopeSchema.safeParse(stdout.trimStart().startsWith("{") ? JSON.parse(stdout) : void 0);
	if (!envelope.success) throw new Error(`Orca did not answer with JSON: ${stdout.slice(0, 200)}`);
	return envelope.data.ok ? {
		ok: true,
		result: envelope.data.result
	} : {
		ok: false,
		code: envelope.data.error.code,
		message: envelope.data.error.message
	};
};
var demandOfOrca = async (run, args) => {
	const reply = await askOrca(run, args);
	if (!reply.ok) throw new Error(reply.message);
	return reply.result;
};
var createOrcaWorktreeOpener = ({ run }) => async (worktreeId) => {
	await demandOfOrca(run, [
		"worktree",
		"activate",
		"--worktree",
		`id:${worktreeId}`
	]);
};
var DEFAULT_ATTEMPTS_PER_RUN = 5;
var DEFAULT_RUNS_PER_TICKET = 3;
var DEFAULT_SHADOW_THRESHOLD = 20;
var DEFAULT_CHANGE_KINDS = [
	{
		name: "schema or data migration",
		paths: ["**/migrations/**", "**/*.sql"],
		points: 3
	},
	{
		name: "dependency update",
		paths: [
			"**/package.json",
			"**/pnpm-lock.yaml",
			"**/package-lock.json",
			"**/yarn.lock",
			"**/requirements*.txt",
			"**/poetry.lock",
			"**/pyproject.toml"
		],
		points: 2
	},
	{
		name: "CI or infrastructure",
		paths: [
			".github/**",
			"infra/**",
			"terraform/**",
			"**/Dockerfile",
			"bitbucket-pipelines.yml"
		],
		points: 2
	}
];
var DEFAULT_POLL_SECONDS = 60;
var DEFAULT_NOT_STARTED_AFTER_HOURS = 24;
var DEFAULT_INTERRUPTED_GRACE_MINUTES = 10;
var DURATION = /^\d+(s|m|h)$/;
var DURATION_MESSAGE = "Use a number followed by s, m or h, such as 90s or 6m";
var checkBase = {
	id: string().min(1),
	station: string().min(1),
	source: _enum(["local", "ci"]).default("local"),
	blocking: boolean(),
	applies_when: string().optional(),
	timeout: string().regex(DURATION, DURATION_MESSAGE),
	job: string().min(1).optional()
};
var CheckSchema = discriminatedUnion("kind", [object({
	...checkBase,
	kind: literal("script"),
	run: string().optional()
}), object({
	...checkBase,
	kind: literal("agent"),
	criteria: string().min(1),
	evidence: string().min(1)
})]);
var RiskRouteSchema = object({
	merge: _enum(["auto", "human"]),
	shadow: boolean().optional(),
	auto_since: string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2026-11-21").optional(),
	require: array(string()).optional(),
	reviewers: number().int().min(1).optional(),
	extra_checks: array(string()).optional()
});
var WatchSchema = object({
	enabled: boolean().default(false),
	checks: array(string().min(1)).default([]),
	duration: string().regex(DURATION, DURATION_MESSAGE).default("10m"),
	interval: string().regex(DURATION, DURATION_MESSAGE).default("1m")
}).refine((watch) => !watch.enabled || watch.checks.length > 0, {
	path: ["checks"],
	message: "An enabled watch needs at least one smoke check"
});
var FactoryConfigSchema = object({
	schema: literal(1),
	engine: string().min(1),
	main_branch: string().min(1).default("main"),
	states: object({
		to_refine: string().min(1),
		spec_review: string().min(1),
		ready_for_dev: string().min(1),
		in_development: string().min(1),
		in_review: string().min(1),
		blocked: string().min(1),
		done: string().min(1)
	}),
	labels: object({
		auto: string().min(1),
		no_automerge: string().min(1),
		available: string().min(1).default("factory-available")
	}),
	limits: object({
		attempts: number().int().min(1).default(DEFAULT_ATTEMPTS_PER_RUN),
		runs: number().int().min(1).default(DEFAULT_RUNS_PER_TICKET)
	}).prefault({}),
	view: object({
		poll_seconds: number().int().min(5).default(DEFAULT_POLL_SECONDS),
		not_started_after_hours: number().min(0).default(DEFAULT_NOT_STARTED_AFTER_HOURS),
		interrupted_grace_minutes: number().min(0).default(DEFAULT_INTERRUPTED_GRACE_MINUTES)
	}).prefault({}),
	checks: array(CheckSchema).superRefine((checks, context) => {
		checks.forEach((check, index) => {
			if (check.kind === "script" && check.source === "local" && check.run === void 0) context.addIssue({
				code: "custom",
				path: [index, "run"],
				message: "A script check run locally needs a command"
			});
			if (checks.findIndex((other) => other.id === check.id) < index) context.addIssue({
				code: "custom",
				path: [index, "id"],
				message: `Duplicate check id "${check.id}"`
			});
		});
	}),
	watch: WatchSchema.prefault({}),
	risk: object({
		low: RiskRouteSchema,
		medium: RiskRouteSchema,
		high: RiskRouteSchema,
		sensitive_paths: array(string()),
		thresholds: object({
			medium: number().int().min(1).default(3),
			high: number().int().min(1).default(6)
		}).prefault({}),
		size: object({
			files: number().int().min(1).default(15),
			lines: number().int().min(1).default(400)
		}).prefault({}),
		kinds: array(object({
			name: string().min(1),
			paths: array(string().min(1)).min(1),
			points: number().int().min(1)
		})).default(DEFAULT_CHANGE_KINDS),
		script: string().min(1).optional(),
		shadow: boolean().default(true),
		shadow_threshold: number().int().min(1).default(DEFAULT_SHADOW_THRESHOLD)
	})
});
var AdaptersConfigSchema = object({
	repository: string().min(1),
	ticket_providers: array(object({
		kind: _enum([
			"jira",
			"linear",
			"github-issues"
		]),
		base_url: string().optional(),
		filter: string().optional(),
		team: string().optional(),
		project: string().optional(),
		token_env: string().optional(),
		email_env: string().optional()
	})).min(1),
	source_control: object({
		kind: _enum(["github", "bitbucket"]),
		repo: string().min(1),
		token_env: string().optional(),
		username_env: string().optional(),
		api_url: string().optional()
	}),
	agent_runtime: object({ kind: literal("orca") })
});
var sampleFactoryConfig = () => FactoryConfigSchema.parse({
	schema: 1,
	engine: "sample",
	states: {
		to_refine: "To refine",
		spec_review: "Spec review",
		ready_for_dev: "Ready for Dev",
		in_development: "In development",
		in_review: "In review",
		blocked: "Blocked",
		done: "Done"
	},
	labels: {
		auto: "factory-auto",
		no_automerge: "factory:no-automerge"
	},
	checks: [],
	risk: {
		low: { merge: "auto" },
		medium: { merge: "human" },
		high: { merge: "human" },
		sensitive_paths: []
	}
});
var TICKET_PROVIDER_NAMES = {
	jira: "Jira",
	linear: "Linear"
};
var SECRET_FIELD_NAME = /(token|secret|password|api[_-]?key)$/i;
var SECRET_VALUE = /^(ghp_|github_pat_|xox[abp]-|ATATT|lin_api_)/;
var SECRET_MESSAGE = "Secrets must not be stored in adapters.yaml";
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var findSecrets = (value, path) => {
	if (Array.isArray(value)) return value.flatMap((item, index) => findSecrets(item, [...path, String(index)]));
	if (isRecord(value)) return Object.entries(value).flatMap(([key, child]) => SECRET_FIELD_NAME.test(key) ? [{
		path: [...path, key].join("."),
		message: SECRET_MESSAGE
	}] : findSecrets(child, [...path, key]));
	return typeof value === "string" && SECRET_VALUE.test(value) ? [{
		path: path.join("."),
		message: SECRET_MESSAGE
	}] : [];
};
var loadYaml = (text) => {
	try {
		return {
			ok: true,
			data: (0, import_dist.parse)(text)
		};
	} catch (error) {
		return {
			ok: false,
			issues: [{
				path: "",
				message: String(error)
			}]
		};
	}
};
var validate = (schema, data) => {
	const parsed = schema.safeParse(data);
	return parsed.success ? {
		ok: true,
		value: parsed.data
	} : {
		ok: false,
		issues: parsed.error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message
		}))
	};
};
var parseFactoryConfig = (text) => {
	const loaded = loadYaml(text);
	return loaded.ok ? validate(FactoryConfigSchema, loaded.data) : loaded;
};
var parseAdaptersConfig = (text) => {
	const loaded = loadYaml(text);
	if (!loaded.ok) return loaded;
	const secrets = findSecrets(loaded.data, []);
	return secrets.length > 0 ? {
		ok: false,
		issues: secrets
	} : validate(AdaptersConfigSchema, loaded.data);
};
var FULL_ACCESS = {
	comment: true,
	transition: true
};
var LINK_PREFIX = "memory://attachment/";
var matches = (ticket, criteria) => (criteria.statuses === void 0 || criteria.statuses.includes(ticket.status)) && (criteria.label === void 0 || ticket.labels.includes(criteria.label)) && (criteria.updatedSince === void 0 || Date.parse(ticket.updatedAt) > Date.parse(criteria.updatedSince));
var createInMemoryTicketProvider = ({ tickets, now, statuses, access = FULL_ACCESS }) => {
	const state = {
		tickets,
		attachments: [],
		listed: []
	};
	const find = (key) => state.tickets.find((ticket) => ticket.key === key);
	const replace = (key, change) => {
		state.tickets = state.tickets.map((ticket) => ticket.key === key ? {
			...ticket,
			...change,
			updatedAt: now()
		} : ticket);
	};
	return {
		getTicket: async (key) => find(key),
		transition: async ({ key, from, to }) => {
			const ticket = find(key);
			if (ticket === void 0) return {
				ok: false,
				reason: "not_found"
			};
			if (ticket.status !== from) return {
				ok: false,
				reason: "not_in_expected_status",
				actual: ticket.status
			};
			replace(key, {
				status: to,
				statusSince: now()
			});
			return { ok: true };
		},
		getFactoryComment: async (key) => find(key)?.factoryComment,
		putFactoryComment: async (key, body) => {
			replace(key, { factoryComment: body });
		},
		addAttachment: async ({ key, name, content }) => {
			state.attachments = [...state.attachments, content];
			const link = `${LINK_PREFIX}${state.attachments.length - 1}/${name}`;
			state.listed = [...state.listed, {
				key,
				name,
				link
			}];
			return link;
		},
		listAttachments: async (key) => state.listed.filter((attachment) => attachment.key === key).map(({ name, link }) => ({
			name,
			link
		})),
		readAttachment: async (link) => {
			const content = state.attachments[Number(link.slice(20).split("/")[0])];
			if (content === void 0) throw new Error(`No attachment at ${link}`);
			return content;
		},
		search: async (criteria) => state.tickets.filter((ticket) => matches(ticket, criteria)),
		listStatuses: async () => statuses ?? [...new Set(state.tickets.map((ticket) => ticket.status))].map((name) => ({
			name,
			category: "unknown"
		})),
		checkAccess: async (key) => {
			if (find(key) === void 0) throw new Error(`Ticket ${key} was not found`);
			return access;
		},
		canReenter: async ({ key }) => {
			if (find(key) === void 0) throw new Error(`Ticket ${key} was not found`);
			return false;
		}
	};
};
var EventSchema = object({
	at: string(),
	by: string(),
	type: string(),
	detail: string().optional()
});
var StepSchema = object({
	name: string(),
	attempt: number().int().min(1),
	startedAt: string(),
	endedAt: string().optional(),
	timeoutSeconds: number().int().min(1)
});
var OutcomeSchema = object({
	id: string(),
	station: string(),
	status: _enum([
		"passed",
		"failed",
		"warning",
		"skipped"
	]),
	reason: string().optional(),
	detail: string().optional(),
	durationSeconds: number(),
	evidence: array(string()).optional()
});
var AttemptSchema = object({
	number: number().int().min(1),
	changed: string(),
	decisions: array(string()),
	outcomes: array(OutcomeSchema)
});
var RiskLevelSchema = _enum([
	"low",
	"medium",
	"high"
]);
var RunRiskSchema = object({
	predicted: RiskLevelSchema,
	actual: RiskLevelSchema,
	level: RiskLevelSchema,
	score: number(),
	signals: array(object({
		name: string(),
		points: number(),
		reason: string()
	})),
	raised: string().optional()
});
var RunMergeSchema = object({
	route: _enum(["auto", "human"]),
	wouldAutoMerge: boolean(),
	reason: string(),
	refused: string().optional(),
	at: string().optional(),
	by: string().optional(),
	asIs: boolean().optional()
});
var RunRevertSchema = object({
	at: string(),
	by: string(),
	pullRequest: string().optional(),
	needed: boolean().optional(),
	merged: boolean().optional()
});
var RunSchema = object({
	claimant: string(),
	machine: string(),
	worktreeId: string(),
	startedAt: string(),
	status: _enum([
		"running",
		"sent_back",
		"blocked",
		"in_review",
		"merged"
	]),
	attempt: number().int().min(1),
	attemptLimit: number().int().min(1),
	steps: array(StepSchema),
	attempts: array(AttemptSchema),
	diagnosis: _enum([
		"code",
		"spec",
		"environment"
	]).optional(),
	report: string().optional(),
	pullRequest: object({
		number: number(),
		url: string(),
		headCommit: string().optional()
	}).optional(),
	risk: RunRiskSchema.optional(),
	merge: RunMergeSchema.optional(),
	revert: RunRevertSchema.optional(),
	watch: object({
		at: string(),
		passed: boolean(),
		detail: string().optional()
	}).optional(),
	compacted: boolean().optional()
});
var FactoryStateSchema = _enum([
	"to_refine",
	"spec_review",
	"ready_for_dev",
	"in_development",
	"in_review",
	"blocked",
	"done"
]);
var ApprovalSchema = object({
	approver: string(),
	at: string(),
	mainCommit: string(),
	fingerprint: string(),
	predictedRisk: RiskLevelSchema,
	mergeCeiling: literal("human").optional()
});
var ReadyGateSchema = object({
	passed: boolean(),
	fingerprint: string(),
	findings: array(string()),
	at: string()
});
var SendBackSchema = object({
	at: string(),
	questions: array(object({
		question: string(),
		recommended: string()
	}))
});
var TicketRecordSchema = object({
	schema: literal(1),
	repository: string(),
	state: FactoryStateSchema.optional(),
	refinement: object({
		readyGate: ReadyGateSchema.optional(),
		approval: ApprovalSchema.optional(),
		sendBack: SendBackSchema.optional()
	}),
	runs: array(RunSchema),
	events: array(EventSchema),
	archives: array(string())
});
var createRecord = ({ repository }) => ({
	schema: 1,
	repository,
	refinement: {},
	runs: [],
	events: [],
	archives: []
});
var appendEvent = (record, event) => ({
	...record,
	events: [...record.events, event]
});
var recordReadyGate = (record, { passed, fingerprint, findings, at, by }) => appendEvent({
	...record,
	refinement: {
		...record.refinement,
		readyGate: {
			passed,
			fingerprint,
			findings: [...findings],
			at
		}
	}
}, {
	at,
	by,
	type: "ready_gate",
	detail: passed ? "passed" : "failed"
});
var startRun = (record, { claimant, machine, worktreeId, at, attemptLimit }) => appendEvent({
	...record,
	runs: [...record.runs, {
		claimant,
		machine,
		worktreeId,
		startedAt: at,
		status: "running",
		attempt: 1,
		attemptLimit,
		steps: [],
		attempts: []
	}]
}, {
	at,
	by: claimant,
	type: "claimed",
	detail: `run ${record.runs.length + 1}`
});
var endRun = (record, { status, at, by }) => appendEvent(changeLatestRun(record, (run) => ({
	...run,
	status
})), {
	at,
	by,
	type: "run_ended",
	detail: status
});
var changeLatestRun = (record, change) => ({
	...record,
	runs: record.runs.map((run, index) => index === record.runs.length - 1 ? change(run) : run)
});
var recordSendBack = (record, { questions, at, by }) => appendEvent({
	...record,
	refinement: {
		...record.refinement,
		sendBack: {
			at,
			questions: [...questions]
		}
	}
}, {
	at,
	by,
	type: "sent_back",
	detail: `${questions.length} question${questions.length === 1 ? "" : "s"}`
});
var recordApproval = (record, approval) => {
	const { sendBack: _answered, ...refinement } = record.refinement;
	return appendEvent({
		...record,
		refinement: {
			...refinement,
			approval
		}
	}, {
		at: approval.at,
		by: approval.approver,
		type: "approved",
		detail: `${approval.predictedRisk} risk`
	});
};
var startStep = (record, { name, at, timeoutSeconds, by }) => appendEvent(changeLatestRun(record, (run) => ({
	...run,
	steps: [...run.steps, {
		name,
		attempt: run.attempt,
		startedAt: at,
		timeoutSeconds
	}]
})), {
	at,
	by,
	type: "step_started",
	detail: name
});
var endStep = (record, { at, by }) => {
	const open = record.runs.at(-1)?.steps.find((step) => step.endedAt === void 0);
	if (open === void 0) return record;
	return appendEvent(changeLatestRun(record, (run) => ({
		...run,
		steps: run.steps.map((step) => step === open ? {
			...step,
			endedAt: at
		} : step)
	})), {
		at,
		by,
		type: "step_ended",
		detail: open.name
	});
};
var checksumOf = (text) => createHash("sha256").update(text).digest("hex");
var BlockPartsSchema = tuple([string(), string()]);
var BLOCK_PATTERN = /```factory-record sha256=([0-9a-f]{64})\n([\s\S]*?)\n```/;
var renderComment = ({ record, summary }) => {
	const json = JSON.stringify(record);
	return `${summary}\n\n\`\`\`factory-record sha256=${checksumOf(json)}\n${json}\n\`\`\`\n`;
};
var parseComment = (comment, options) => {
	const match = BLOCK_PATTERN.exec(comment);
	if (match === null) return { status: "none" };
	const [checksum, json] = BlockPartsSchema.parse(match.slice(1));
	if (checksumOf(json) !== checksum && !options.trustEdited) return { status: "edited" };
	const parsed = TicketRecordSchema.safeParse(JSON.parse(json));
	return parsed.success ? {
		status: "ok",
		record: parsed.data
	} : { status: "invalid" };
};
var LEVELS = [
	"low",
	"medium",
	"high"
];
var MS_PER_DAY$2 = 864e5;
var REVERT_WINDOW_DAYS = 14;
var WAITING_FOR_MERGE = "waiting for merge";
var recordOf = (ticket, repository) => {
	const parsed = ticket.factoryComment === void 0 ? void 0 : parseComment(ticket.factoryComment, { trustEdited: false });
	return parsed?.status === "ok" && parsed.record.repository === repository ? parsed.record : void 0;
};
var median = (values) => {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = sorted.slice(Math.ceil(sorted.length / 2) - 1, Math.floor(sorted.length / 2) + 1);
	return Math.round(middle.reduce((total, value) => total + value, 0) / middle.length);
};
var secondsBetween = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 1e3);
var revertedSoon = ({ run, at }) => run.revert !== void 0 && Date.parse(run.revert.at) - Date.parse(at) <= REVERT_WINDOW_DAYS * MS_PER_DAY$2;
var agreed = (merged) => merged.run.merge?.asIs === true && !revertedSoon(merged);
var levelHealth = (config, level, merges) => {
	const ofLevel = merges.filter((merged) => merged.level === level).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
	const firstDisagreement = ofLevel.findIndex((merged) => !agreed(merged));
	const streak = firstDisagreement === -1 ? ofLevel.length : firstDisagreement;
	const policy = config.risk[level];
	const automatic = policy.merge === "auto" && !(policy.shadow ?? config.risk.shadow);
	return {
		level,
		merged: ofLevel.length,
		mergedAsIs: ofLevel.filter(({ run }) => run.merge?.asIs === true).length,
		changed: ofLevel.filter(({ run }) => run.merge?.asIs !== true).length,
		reverted: ofLevel.filter(revertedSoon).length,
		streak,
		threshold: config.risk.shadow_threshold,
		...streak >= config.risk.shadow_threshold && !automatic ? { suggestion: `/factory-workflow enable auto-merge for ${level} risk` } : {}
	};
};
var providerHealth = (provider, records, { config, now, periodDays }) => {
	const from = Date.parse(now) - periodDays * MS_PER_DAY$2;
	const inPeriod = (at) => Date.parse(at) >= from;
	const merges = records.flatMap((record) => {
		const index = record.runs.findIndex((run) => run.merge?.at !== void 0 && inPeriod(run.merge.at));
		const run = record.runs[index];
		const at = run?.merge?.at;
		return run === void 0 || at === void 0 ? [] : [{
			record,
			index,
			run,
			at,
			level: run.risk?.level
		}];
	});
	const events = records.flatMap((record) => record.events).filter((event) => inPeriod(event.at));
	const runs = records.flatMap((record) => record.runs).filter((run) => inPeriod(run.startedAt));
	const failed = runs.flatMap((run) => run.attempts).flatMap((attempt) => attempt.outcomes).filter((outcome) => outcome.status === "failed");
	const durations = [...runs.flatMap((run) => run.steps).flatMap((step) => step.endedAt === void 0 ? [] : [{
		name: step.name,
		seconds: secondsBetween(step.startedAt, step.endedAt)
	}]), ...merges.flatMap(({ run, at }) => {
		const opened = run.steps.at(-1)?.endedAt;
		return opened === void 0 ? [] : [{
			name: WAITING_FOR_MERGE,
			seconds: secondsBetween(opened, at)
		}];
	})];
	const attempts = merges.reduce((total, { record }) => total + record.runs.reduce((sum, run) => sum + run.attempt, 0), 0);
	const firstPass = merges.filter(({ index, run }) => index === 0 && run.attempt === 1).length;
	return {
		provider,
		merged: merges.length,
		...merges.length === 0 ? {} : {
			firstPassRate: firstPass / merges.length,
			averageAttempts: attempts / merges.length
		},
		sendBacks: events.filter((event) => event.type === "sent_back").length,
		blocked: events.filter((event) => event.type === "run_ended" && event.detail === "blocked").length,
		failures: [...new Set(failed.map((outcome) => outcome.id))].map((gate) => ({
			gate,
			count: failed.filter((outcome) => outcome.id === gate).length
		})).toSorted((a, b) => b.count - a.count || a.gate.localeCompare(b.gate)),
		stations: [...new Set(durations.map(({ name }) => name))].map((name) => ({
			name,
			medianSeconds: median(durations.filter((duration) => duration.name === name).map(({ seconds }) => seconds))
		})),
		levels: LEVELS.map((level) => levelHealth(config, level, merges))
	};
};
var buildHealth = (tickets, options) => {
	const known = tickets.flatMap((ticket) => {
		const record = recordOf(ticket, options.repository);
		return record === void 0 ? [] : [{
			provider: ticket.provider,
			record
		}];
	});
	return {
		periodDays: options.periodDays,
		providers: [...new Set(tickets.map((ticket) => ticket.provider))].map((provider) => providerHealth(provider, known.filter((entry) => entry.provider === provider).map(({ record }) => record), options))
	};
};
var COLUMNS = [
	{
		id: "available",
		name: "Available"
	},
	{
		id: "refining",
		name: "Refining"
	},
	{
		id: "ready",
		name: "Ready"
	},
	{
		id: "revalidate",
		name: "Revalidate"
	},
	{
		id: "build",
		name: "Build"
	},
	{
		id: "review",
		name: "Review"
	},
	{
		id: "pr",
		name: "Pull request"
	},
	{
		id: "needs_you",
		name: "Needs you"
	},
	{
		id: "done",
		name: "Done"
	}
];
var CATEGORY_ORDER = [
	"revert",
	"blocked",
	"run_limit",
	"interrupted",
	"record_edited",
	"sent_back",
	"merge",
	"approve",
	"not_started"
];
var STEP_COLUMNS = {
	revalidate: "revalidate",
	build: "build",
	quality: "build",
	verify: "review",
	review: "review",
	diagnose: "build"
};
var VERIFY = "openspec-verify";
var SHOWN_ATTEMPTS = 2;
var MS_PER_HOUR = 36e5;
var plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
var FACTORY_STATES = [
	"to_refine",
	"spec_review",
	"ready_for_dev",
	"in_development",
	"in_review",
	"blocked",
	"done"
];
var stateOf = (config, status) => FACTORY_STATES.find((state) => config.states[state] === status);
var openStepOf = (run) => run?.steps.find((step) => step.endedAt === void 0);
var describe = (ticket, { config, now }) => {
	const parsed = ticket.factoryComment === void 0 ? void 0 : parseComment(ticket.factoryComment, { trustEdited: false });
	const record = parsed?.status === "ok" ? parsed.record : void 0;
	const state = stateOf(config, ticket.status);
	const run = record?.runs.at(-1);
	const open = openStepOf(run);
	const deadline = open === void 0 ? void 0 : Date.parse(open.startedAt) + (open.timeoutSeconds + config.view.interrupted_grace_minutes * 60) * 1e3;
	const overdue = state === "in_development" && deadline !== void 0 && Date.parse(now) > deadline;
	return {
		ticket,
		state,
		record,
		recordEdited: parsed?.status === "edited" || parsed?.status === "invalid",
		run,
		questions: record?.refinement.sendBack?.questions ?? [],
		interrupted: overdue,
		stalled: overdue && open !== void 0 && run !== void 0 ? {
			step: open.name,
			startedAt: open.startedAt,
			claimant: run.claimant
		} : void 0
	};
};
var entriesFor = (tickets, options) => tickets.map((ticket) => describe(ticket, options)).filter((entry) => entry.record === void 0 || entry.record.repository === options.repository);
var stationOf = ({ state, run, ticket }, config) => {
	if (state === "to_refine") return ticket.labels.includes(config.labels.available) ? "available" : void 0;
	if (state === "spec_review") return "refining";
	if (state === "ready_for_dev") return "ready";
	if (state === "in_development") return STEP_COLUMNS[openStepOf(run)?.name ?? "revalidate"] ?? "build";
	if (state === "in_review") return "pr";
	return state === "done" ? "done" : void 0;
};
var stepChip = (run, attempt, name) => {
	const step = run.steps.find((candidate) => candidate.attempt === attempt && candidate.name === name);
	if (step === void 0) return "pending";
	return step.endedAt === void 0 ? "running" : "pass";
};
var rowFor = (run, number) => {
	const outcomes = run.attempts.find((attempt) => attempt.number === number)?.outcomes ?? [];
	const failed = (matches) => outcomes.some((outcome) => matches(outcome) && outcome.status === "failed");
	const verify = outcomes.find((outcome) => outcome.id === VERIFY);
	return {
		number,
		build: stepChip(run, number, "build"),
		gate: failed((outcome) => outcome.station === "quality") ? "fail" : stepChip(run, number, "quality"),
		verify: verify === void 0 ? stepChip(run, number, "verify") : verify.status === "failed" ? "fail" : "pass",
		review: failed((outcome) => outcome.station === "review" && outcome.id !== VERIFY) ? "fail" : stepChip(run, number, "review")
	};
};
var rowsFor = (run) => run.steps.some((step) => step.name === "build") ? Array.from({ length: run.attempt }, (_, index) => rowFor(run, index + 1)) : [];
var secondsOf = (run) => run.steps.reduce((total, step) => total + (step.endedAt === void 0 ? 0 : Math.round((Date.parse(step.endedAt) - Date.parse(step.startedAt)) / 1e3)), 0);
var AUTO_MERGE_ON = "Auto-merge is on";
var mergeNote = ({ run }) => {
	const merge = run?.merge;
	if (merge === void 0 || !merge.wouldAutoMerge) return "Merge by a person";
	if (merge.refused !== void 0) return "Auto-merge refused";
	return merge.route === "auto" ? AUTO_MERGE_ON : "Would have auto-merged";
};
var doneNote = (run) => {
	const revert = run?.revert;
	if (revert?.merged === true) return "Reverted";
	if (revert !== void 0) return revert.needed === true ? "Revert needed" : "Revert opened";
	return run?.watch?.passed === true ? "Delivered" : "Merged";
};
var refiningNote = ({ record, questions }) => {
	if (record?.refinement.sendBack !== void 0) return `Sent back · ${plural(questions.length, "question")}`;
	const gate = record?.refinement.readyGate;
	if (gate === void 0) return "Refining";
	return gate.passed ? "Gate passed, waiting for approval" : "Gate failed";
};
var noteFor = (entry, column, config) => {
	const { ticket, run } = entry;
	if (entry.interrupted) return "Interrupted";
	if (column === "available") return "Available for refinement";
	if (column === "refining") return refiningNote(entry);
	if (column === "ready") return ticket.labels.includes(config.labels.auto) ? "Eligible for /factory-next" : "Waiting for a developer";
	if (column === "revalidate") return "Checking drift";
	if (column === "build") return "Building";
	if (column === "review") return "Reviewing";
	if (column === "pr") return mergeNote(entry);
	return doneNote(run);
};
var commandFor = (entry, column, config) => {
	const { key } = entry.ticket;
	if (column === "available" || column === "refining") return `/factory-refine ${key}`;
	if (column === "ready") return entry.ticket.labels.includes(config.labels.auto) ? "/factory-next" : `/factory-run ${key}`;
	return entry.interrupted ? `/factory-run ${key}` : void 0;
};
var UNCLAIMED_COLUMNS = [
	"available",
	"refining",
	"ready"
];
var cardFor = (entry, column, { note, command }, { config, machine }) => {
	const { ticket } = entry;
	const record = column === "available" ? void 0 : entry.record;
	const run = record === void 0 ? void 0 : entry.run;
	const claimed = run !== void 0 && !UNCLAIMED_COLUMNS.includes(column);
	const rows = claimed ? rowsFor(run) : [];
	const risk = run?.risk?.level ?? record?.refinement.approval?.predictedRisk;
	return {
		key: ticket.key,
		title: ticket.title,
		provider: ticket.provider,
		note,
		rows: rows.slice(-2),
		earlierAttempts: Math.max(rows.length - SHOWN_ATTEMPTS, 0),
		interrupted: entry.interrupted,
		recordEdited: entry.recordEdited,
		onThisMachine: claimed && run.machine === machine,
		...claimed ? {
			claimant: run.claimant,
			attempt: {
				number: run.attempt,
				limit: run.attemptLimit
			},
			seconds: secondsOf(run)
		} : {},
		...record === void 0 || record.runs.length === 0 ? {} : { run: {
			number: record.runs.length,
			limit: config.limits.runs
		} },
		...risk === void 0 ? {} : { risk },
		...run?.pullRequest === void 0 ? {} : { pullRequest: run.pullRequest.url },
		...command === void 0 ? {} : { command }
	};
};
var reasonFor = (entry, { config, now }) => {
	const { ticket, record, run, state } = entry;
	const { key, statusSince: since } = ticket;
	const runsUsed = record?.runs.length ?? 0;
	const { limits, labels, view } = config;
	const revert = run?.revert;
	if (state === "done" && revert !== void 0 && revert.merged !== true) {
		const link = revert.pullRequest ?? run?.pullRequest?.url;
		const why = revert.needed === true ? `Revert this change by hand: ${revert.by}.` : `Merge the revert pull request: ${revert.by}.`;
		return {
			category: "revert",
			since: revert.at,
			why,
			...link === void 0 ? {} : { link }
		};
	}
	if (entry.recordEdited) return {
		category: "record_edited",
		since,
		why: "The factory comment was edited outside the factory.",
		command: `/factory-run ${key}`
	};
	if ((state === "blocked" || state === "ready_for_dev") && runsUsed >= limits.runs) return {
		category: "run_limit",
		since,
		why: `Used ${runsUsed} of ${plural(limits.runs, "run")}.`,
		command: `/factory-run ${key} --over-limit`
	};
	if (state === "blocked") return {
		category: "blocked",
		since,
		why: run === void 0 ? "Blocked, with no factory record." : `Failed ${run.attempt} of ${plural(run.attemptLimit, "attempt")}. Diagnosis: ${run.diagnosis ?? "none"}.`,
		command: `/factory-run ${key}`,
		...run?.report === void 0 ? {} : { link: run.report }
	};
	if (entry.stalled !== void 0) {
		const { step, startedAt, claimant } = entry.stalled;
		return {
			category: "interrupted",
			since: startedAt,
			why: `The ${step} step never ended. Claimed by ${claimant}.`,
			command: `/factory-run ${key}`
		};
	}
	if (state === "spec_review" && record?.refinement.sendBack !== void 0) {
		const { questions } = record.refinement.sendBack;
		return {
			category: "sent_back",
			since,
			why: `Sent back with ${plural(questions.length, "question")}.`,
			command: `/factory-refine ${key}`,
			questions
		};
	}
	if (state === "in_review") {
		const note = mergeNote(entry);
		if (note === AUTO_MERGE_ON) return void 0;
		const refused = run?.merge?.refused;
		return {
			category: "merge",
			since,
			why: refused === void 0 ? `${note}.` : `${note}: ${refused}.`,
			...run?.pullRequest === void 0 ? {} : { link: run.pullRequest.url }
		};
	}
	if (state === "spec_review" && record?.refinement.readyGate?.passed === true) return {
		category: "approve",
		since,
		why: "The ready gate passed. Waiting for approval.",
		command: `/factory-refine ${key}`
	};
	const waitedHours = (Date.parse(now) - Date.parse(since)) / MS_PER_HOUR;
	if (state === "ready_for_dev" && !ticket.labels.includes(labels.auto) && waitedHours > view.not_started_after_hours) return {
		category: "not_started",
		since,
		why: `Ready for ${plural(Math.floor(waitedHours), "hour")} with no ${labels.auto} label.`,
		command: `/factory-run ${key}`
	};
};
var needingYou = (entries, options) => entries.flatMap((entry) => {
	const reason = reasonFor(entry, options);
	return reason === void 0 ? [] : [{
		entry,
		reason
	}];
}).toSorted((a, b) => CATEGORY_ORDER.indexOf(a.reason.category) - CATEGORY_ORDER.indexOf(b.reason.category) || Date.parse(a.reason.since) - Date.parse(b.reason.since));
var buildNeedsYou = (tickets, options) => needingYou(entriesFor(tickets, options), options).map(({ entry, reason }) => {
	const { key, title, provider } = entry.ticket;
	return {
		key,
		title,
		provider,
		questions: [],
		...reason
	};
});
var buildBoard = (tickets, options) => {
	const entries = entriesFor(tickets, options);
	const stations = entries.flatMap((entry) => {
		const column = stationOf(entry, options.config);
		if (column === void 0) return [];
		return [{
			column,
			card: cardFor(entry, column, {
				note: noteFor(entry, column, options.config),
				command: commandFor(entry, column, options.config)
			}, options)
		}];
	});
	const needsYou = needingYou(entries, options).map(({ entry, reason }) => ({
		...cardFor(entry, "needs_you", {
			note: reason.why,
			command: reason.command
		}, options),
		category: reason.category
	}));
	return COLUMNS.map(({ id, name }) => ({
		id,
		name,
		cards: id === "needs_you" ? needsYou : stations.filter(({ column }) => column === id).map(({ card }) => card)
	}));
};
var outcomeLines = (outcomes) => outcomes.flatMap((outcome) => [`${outcome.id}: ${outcome.status}${outcome.reason === void 0 ? "" : ` (${outcome.reason})`}`, ...outcome.detail === void 0 ? [] : [outcome.detail]]);
var attemptSteps = (run, number) => {
	const row = rowFor(run, number);
	const attempt = run.attempts.find((candidate) => candidate.number === number);
	const of = (matches) => (attempt?.outcomes ?? []).filter(matches);
	const review = of((outcome) => outcome.station === "review" && outcome.id !== VERIFY);
	return [
		{
			label: "Build",
			status: row.build,
			lines: attempt === void 0 ? [] : [attempt.changed, ...attempt.decisions.length === 0 ? [] : [`Decisions applied: ${attempt.decisions.join(", ")}`]],
			links: []
		},
		{
			label: "Quality gate",
			status: row.gate,
			lines: outcomeLines(of((outcome) => outcome.station === "quality")),
			links: []
		},
		{
			label: "Verify",
			status: row.verify,
			lines: outcomeLines(of((outcome) => outcome.id === VERIFY)),
			links: []
		},
		{
			label: "Review",
			status: row.review,
			lines: outcomeLines(review),
			links: review.flatMap((outcome) => outcome.evidence ?? [])
		}
	];
};
var outcomeSteps = (record, run) => {
	if (run.pullRequest !== void 0) {
		const { risk, merge, revert, watch } = run;
		const lines = [
			...risk === void 0 ? [] : [`Risk: ${risk.level} (predicted ${risk.predicted}, actual ${risk.actual}, score ${risk.score})`, ...risk.signals.map((signal) => `${signal.name}: ${signal.reason}`)],
			...risk?.raised === void 0 ? [] : [`Raised by the reviewer: ${risk.raised}`],
			...merge === void 0 ? [] : [`Merge: ${merge.reason}`],
			...merge?.refused === void 0 ? [] : [`Auto-merge refused: ${merge.refused}`],
			...merge?.at === void 0 ? [] : [`Merged by ${merge.by ?? "unknown"} at ${merge.at}, ${merge.asIs === true ? "merged as is" : "changed by a human"}`],
			...watch === void 0 ? [] : [watch.passed ? `Delivered at ${watch.at}: the staging watch passed` : `The staging watch failed at ${watch.at}: ${watch.detail ?? "no detail"}`],
			...revert === void 0 ? [] : [`${doneNote(run)} at ${revert.at}: ${revert.by}`]
		];
		return [{
			label: "Pull request",
			status: revert !== void 0 ? "fail" : run.status === "merged" ? "pass" : "running",
			lines,
			links: [run.pullRequest.url, ...revert?.pullRequest === void 0 ? [] : [revert.pullRequest]]
		}];
	}
	if (run.status === "blocked") return [{
		label: "Failure report",
		status: "fail",
		lines: [`Diagnosis: ${run.diagnosis ?? "none"}`],
		links: run.report === void 0 ? [] : [run.report]
	}];
	if (run.status !== "sent_back") return [];
	return [{
		label: "Sent back",
		status: "fail",
		lines: (record.refinement.sendBack?.questions ?? []).flatMap(({ question, recommended }) => [question, `Recommended: ${recommended}`]),
		links: []
	}];
};
var buildRunDetail = (ticket, options) => {
	const { record, run } = describe(ticket, options);
	if (record === void 0) return void 0;
	const { readyGate, approval } = record.refinement;
	const refinement = [...readyGate === void 0 ? [] : [{
		label: "Ready gate",
		status: readyGate.passed ? "pass" : "fail",
		lines: readyGate.findings,
		links: []
	}], ...approval === void 0 ? [] : [{
		label: "Approval",
		status: "pass",
		lines: [
			`Approved by ${approval.approver} at ${approval.at}`,
			`Predicted risk: ${approval.predictedRisk}`,
			`Main at ${approval.mainCommit}`
		],
		links: []
	}]];
	if (run === void 0) return {
		key: ticket.key,
		title: ticket.title,
		sections: [{
			title: "Refinement",
			steps: refinement
		}]
	};
	const attempts = rowsFor(run).map((row) => ({
		title: `Attempt ${row.number} of ${run.attemptLimit}`,
		steps: attemptSteps(run, row.number)
	}));
	const outcome = outcomeSteps(record, run);
	return {
		key: ticket.key,
		title: ticket.title,
		sections: [
			{
				title: "Refinement",
				steps: refinement
			},
			{
				title: `Run ${record.runs.length} of ${options.config.limits.runs}`,
				steps: [{
					label: "Revalidate",
					status: stepChip(run, 1, "revalidate"),
					lines: [],
					links: []
				}]
			},
			...attempts,
			...outcome.length === 0 ? [] : [{
				title: "Outcome",
				steps: outcome
			}]
		]
	};
};
var MS_PER_DAY$1 = 864e5;
var isoOf = (milliseconds) => new Date(milliseconds).toISOString().replace(".000Z", "Z");
var createViewStore = ({ providers, states, now, doneWindowDays }) => {
	const state = { snapshot: { tickets: [] } };
	const tracked = Object.values(states);
	const open = tracked.filter((status) => status !== states.done);
	const read = async (since, at) => {
		return (await Promise.all(providers.map(async ({ name, provider }) => {
			return (since === void 0 ? (await Promise.all([provider.search({ statuses: open }), provider.search({
				statuses: [states.done],
				updatedSince: isoOf(Date.parse(at) - doneWindowDays * MS_PER_DAY$1)
			})])).flat() : await provider.search({ updatedSince: since })).map((ticket) => ({
				...ticket,
				provider: name
			}));
		}))).flat();
	};
	return {
		snapshot: () => state.snapshot,
		refresh: async () => {
			const at = now();
			const { tickets, refreshedAt } = state.snapshot;
			try {
				const changed = await read(refreshedAt, at);
				const untouched = tickets.filter((ticket) => !changed.some((other) => other.key === ticket.key && other.provider === ticket.provider));
				state.snapshot = {
					tickets: [...untouched, ...changed].filter((ticket) => tracked.includes(ticket.status)),
					refreshedAt: at
				};
			} catch (error) {
				state.snapshot = {
					tickets,
					...refreshedAt === void 0 ? {} : { refreshedAt },
					staleSince: state.snapshot.staleSince ?? refreshedAt ?? at,
					problem: error instanceof Error ? error.message : String(error)
				};
			}
		}
	};
};
var DONE_WINDOW_DAYS = 7;
var MS_PER_DAY = 864e5;
var RUNNING_COLUMNS = [
	"revalidate",
	"build",
	"review"
];
var createViewSource = ({ providers, config, repository, machine, now, openWorktree }) => {
	const store = createViewStore({
		providers,
		states: config.states,
		now,
		doneWindowDays: DONE_WINDOW_DAYS
	});
	const state = {};
	const fresh = async () => {
		const at = Date.parse(now());
		if (state.attemptedAt !== void 0 && at - state.attemptedAt < config.view.poll_seconds * 1e3) return;
		state.attemptedAt = at;
		await store.refresh();
	};
	return {
		load: async () => {
			await fresh();
			const { tickets, refreshedAt, staleSince, problem } = store.snapshot();
			const options = {
				config,
				now: now(),
				machine,
				repository
			};
			const columns = buildBoard(tickets, options);
			return {
				repository,
				providers: providers.map(({ name }) => name),
				columns,
				needsYou: buildNeedsYou(tickets, options),
				running: columns.filter((column) => RUNNING_COLUMNS.includes(column.id)).flatMap((column) => column.cards).filter((card) => !card.interrupted).length,
				pollSeconds: config.view.poll_seconds,
				loadedAt: options.now,
				...refreshedAt === void 0 ? {} : { refreshedAt },
				...staleSince === void 0 ? {} : { staleSince },
				...problem === void 0 ? {} : { problem }
			};
		},
		detail: async (key) => {
			await fresh();
			const ticket = store.snapshot().tickets.find((candidate) => candidate.key === key);
			return ticket === void 0 ? void 0 : buildRunDetail(ticket, {
				config,
				now: now(),
				machine,
				repository
			});
		},
		openInOrca: async (key) => {
			await fresh();
			const comment = store.snapshot().tickets.find((candidate) => candidate.key === key)?.factoryComment;
			const parsed = comment === void 0 ? void 0 : parseComment(comment, { trustEdited: false });
			const run = parsed?.status === "ok" ? parsed.record.runs.at(-1) : void 0;
			if (run?.machine !== machine) return {
				ok: false,
				message: `${key} has no run on this machine.`
			};
			return openWorktree(run.worktreeId).then(() => ({ ok: true }), (error) => ({
				ok: false,
				message: `Orca could not open the run: ${error instanceof Error ? error.message : String(error)}`
			}));
		},
		health: async (periodDays) => {
			const at = now();
			const updatedSince = (/* @__PURE__ */ new Date(Date.parse(at) - periodDays * MS_PER_DAY)).toISOString().replace(".000Z", "Z");
			return buildHealth((await Promise.all(providers.map(async ({ name, provider }) => (await provider.search({ updatedSince })).map((ticket) => ({
				...ticket,
				provider: name
			}))))).flat(), {
				config,
				now: at,
				repository,
				periodDays
			});
		}
	};
};
var REPOSITORY = "acme/billing-service";
var MACHINE = "this-machine";
var MINUTE = 6e4;
var createDemoViewSource = ({ config, now }) => {
	const start = Date.parse(now());
	const ago = (minutes) => (/* @__PURE__ */ new Date(start - minutes * MINUTE)).toISOString().replace(/\.\d{3}Z$/, "Z");
	const approved = (risk) => recordApproval(recordReadyGate(createRecord({ repository: REPOSITORY }), {
		passed: true,
		fingerprint: "demo",
		findings: [],
		at: ago(600),
		by: "pierre"
	}), {
		approver: "pierre",
		at: ago(590),
		mainCommit: "a41c9e2",
		fingerprint: "demo",
		predictedRisk: risk
	});
	const claimed = (record, claimant, machine, minutesAgo) => startRun(record, {
		claimant,
		machine,
		worktreeId: `wt-${claimant}`,
		at: ago(minutesAgo),
		attemptLimit: config.limits.attempts
	});
	const step = (record, name, startedAgo, endedAgo) => {
		const started = startStep(record, {
			name,
			at: ago(startedAgo),
			timeoutSeconds: 1800,
			by: "factory"
		});
		return endedAgo === void 0 ? started : endStep(started, {
			at: ago(endedAgo),
			by: "factory"
		});
	};
	const attempt = (record, entry) => changeLatestRun(record, (run) => ({
		...run,
		attempt: entry.number,
		attempts: [...run.attempts, entry]
	}));
	const passed = (id, station) => ({
		id,
		station,
		status: "passed",
		durationSeconds: 30
	});
	const failed = (id, station, detail) => ({
		id,
		station,
		status: "failed",
		reason: "exit code 1",
		detail,
		durationSeconds: 30
	});
	const firstAttemptFailed = (record) => changeLatestRun(attempt(step(step(step(record, "revalidate", 40, 39), "build", 39, 25), "quality", 25, 22), {
		number: 1,
		changed: "Added the exporter",
		decisions: ["D-001"],
		outcomes: [failed("unit-tests", "quality", "export.test.ts › splits files over 10,000 rows: expected 2 files, got 1")]
	}), (run) => ({
		...run,
		attempt: 2
	}));
	const reviewed = (record, earlier) => attempt(step(step(step(step(step(record, "revalidate", earlier + 60, earlier + 59), "build", earlier + 59, earlier + 45), "quality", earlier + 45, earlier + 40), "verify", earlier + 40, earlier + 36), "review", earlier + 36, earlier + 30), {
		number: 1,
		changed: "Required an amount for partial refunds",
		decisions: ["D-002"],
		outcomes: [
			passed("unit-tests", "quality"),
			passed("openspec-verify", "review"),
			passed("reviewer", "review")
		]
	});
	const decision = (risk) => risk === "low" ? {
		route: "human",
		wouldAutoMerge: true,
		reason: "low risk is in shadow mode"
	} : {
		route: "human",
		wouldAutoMerge: false,
		reason: `${risk} risk is merged by a person`
	};
	const delivered = (risk, number, claimant, startedAgo) => changeLatestRun(reviewed(claimed(approved(risk), claimant, MACHINE, startedAgo + 61), startedAgo), (run) => ({
		...run,
		pullRequest: {
			number,
			url: `https://example.test/pull/${number}`,
			headCommit: "c0ffee1"
		},
		risk: {
			predicted: risk,
			actual: risk,
			level: risk,
			score: risk === "low" ? 0 : 4,
			signals: risk === "low" ? [] : [{
				name: "sensitive paths",
				points: 4,
				reason: "touches src/billing/rounding.ts"
			}]
		},
		merge: decision(risk)
	}));
	const inReview = (risk, number) => endRun(delivered(risk, number, "pierre", 0), {
		status: "in_review",
		at: ago(30),
		by: "pierre"
	});
	const merged = (risk, number, mergedAgo, outcome) => changeLatestRun(endRun(delivered(risk, number, "maya", mergedAgo + 120), {
		status: "merged",
		at: ago(mergedAgo),
		by: "factory-ci"
	}), (run) => ({
		...run,
		merge: {
			...decision(risk),
			at: ago(mergedAgo),
			by: "maya",
			asIs: outcome.asIs
		},
		...outcome.revert === void 0 ? {} : { revert: outcome.revert }
	}));
	const blocked = endRun(changeLatestRun(firstAttemptFailed(claimed(approved("medium"), "pierre", MACHINE, 41)), (run) => ({
		...run,
		attempt: run.attemptLimit,
		diagnosis: "environment",
		report: "https://example.test/report/PAY-133"
	})), {
		status: "blocked",
		at: ago(25),
		by: "pierre"
	});
	const sentBack = recordSendBack(endRun(claimed(approved("medium"), "pierre", MACHINE, 70), {
		status: "sent_back",
		at: ago(60),
		by: "pierre"
	}), {
		questions: [{
			question: "Since PAY-130, billing rounds each line item. Should tax rounding follow per-line rounding too?",
			recommended: "Yes, to stay consistent with Billing rules v2."
		}],
		at: ago(60),
		by: "pierre"
	});
	const ticket = (key, title, status, statusAgo, record, labels = []) => ({
		key,
		title,
		status,
		labels,
		repository: REPOSITORY,
		updatedAt: ago(statusAgo),
		statusSince: ago(statusAgo),
		...record === void 0 ? {} : { factoryComment: renderComment({
			record,
			summary: "Sample data"
		}) }
	});
	const { states, labels } = config;
	return createViewSource({
		providers: [{
			name: "Sample data",
			provider: createInMemoryTicketProvider({
				tickets: [
					ticket("PAY-160", "Late payment reminders", states.to_refine, 1440, void 0, [labels.available]),
					ticket("PAY-161", "Customer portal redesign", states.to_refine, 4300, void 0),
					ticket("PAY-151", "Export invoices to CSV", states.ready_for_dev, 2880, approved("low")),
					ticket("ENG-90", "Rate-limit the public API", states.ready_for_dev, 180, approved("medium"), [labels.auto]),
					ticket("PAY-149", "Validate customer addresses", states.in_development, 1, step(claimed(approved("low"), "pierre", MACHINE, 1), "revalidate", 1)),
					ticket("PAY-142", "Bulk invoice export", states.in_development, 41, step(firstAttemptFailed(claimed(approved("low"), "pierre", MACHINE, 41)), "build", 6)),
					ticket("ENG-87", "Webhook retry policy", states.in_development, 5, step(step(claimed(approved("medium"), "maya", "maya-mbp", 5), "revalidate", 5, 4), "build", 4)),
					ticket("ENG-95", "Audit log export", states.in_development, 95, step(step(claimed(approved("low"), "sam", "sam-mbp", 95), "revalidate", 95, 94), "build", 94)),
					ticket("GH-231", "Dark mode for settings", states.in_development, 20, step(step(step(step(step(claimed(approved("low"), "pierre", MACHINE, 20), "revalidate", 20, 19), "build", 19, 8), "quality", 8, 6), "verify", 6, 3), "review", 3)),
					ticket("PAY-138", "Partial refunds", states.in_review, 30, inReview("medium", 412)),
					ticket("ENG-88", "Retry back-off for exports", states.in_review, 30, inReview("low", 415)),
					ticket("PAY-133", "Multi-currency totals", states.blocked, 25, blocked),
					ticket("PAY-147", "Tax rounding rules", states.spec_review, 60, sentBack),
					ticket("PAY-155", "Credit notes", states.spec_review, 180, recordReadyGate(createRecord({ repository: REPOSITORY }), {
						passed: true,
						fingerprint: "demo",
						findings: [],
						at: ago(180),
						by: "pierre"
					})),
					ticket("PAY-158", "Discount codes", states.spec_review, 45, recordReadyGate(createRecord({ repository: REPOSITORY }), {
						passed: false,
						fingerprint: "demo",
						findings: ["The spec has 1 open question."],
						at: ago(45),
						by: "pierre"
					}), [labels.available]),
					ticket("PAY-130", "Billing rules v2", states.done, 300, merged("high", 398, 300, { asIs: true })),
					ticket("PAY-128", "Invoice footer text", states.done, 1500, merged("low", 396, 1500, { asIs: true })),
					ticket("PAY-127", "Currency symbol placement", states.done, 2900, merged("low", 395, 2900, { asIs: true })),
					ticket("ENG-84", "Pagination for audit log", states.done, 4300, merged("low", 392, 4300, { asIs: false })),
					ticket("ENG-82", "Export file naming", states.done, 5700, merged("low", 390, 5700, {
						asIs: true,
						revert: {
							at: ago(5e3),
							by: "pull request 391",
							merged: true
						}
					})),
					ticket("ENG-85", "Cache invoice totals", states.done, 200, merged("medium", 397, 200, {
						asIs: true,
						revert: {
							at: ago(90),
							by: "the staging watch failed on ./smoke.sh",
							needed: true
						}
					}))
				],
				now
			})
		}],
		config,
		repository: REPOSITORY,
		machine: MACHINE,
		now,
		openWorktree: () => Promise.reject(/* @__PURE__ */ new Error("This is sample data, with no Orca session behind it."))
	});
};
object({ code: number() });
object({ items: tuple([object({ issues: array(object({
	path: string(),
	message: string()
})) })]).rest(unknown()) });
object({ stdout: string().startsWith("{") });
var MAX_RETRIES = 3;
var now = () => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
var loadConfig = async (cwd, name, parse) => {
	const path = `.factory/${name}`;
	const text = await readFile(join(cwd, path), "utf8").catch(() => void 0);
	if (text === void 0) throw new Error(`${path} is missing. Run /factory-init`);
	const parsed = parse(text);
	if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${path}: ${issue.path}: ${issue.message}`).join("\n"));
	return parsed.value;
};
var fromEnv = (env, name) => {
	const value = env[name];
	if (value === void 0 || value === "") throw new Error(`Set the ${name} environment variable`);
	return value;
};
var LINEAR_API = "https://api.linear.app/graphql";
var LINEAR_UPLOADS = "https://uploads.linear.app";
var isSupported = (entry) => entry.kind === "jira" || entry.kind === "linear";
var supportedProvider = (adapters) => {
	const provider = adapters.ticket_providers.find(isSupported);
	if (provider === void 0) throw new Error("No supported ticket provider is configured. Only jira and linear are supported so far");
	return provider;
};
var createLinearProvider = ({ team, project, token_env: tokenEnv }, adapters, env, http) => {
	if (team === void 0 || tokenEnv === void 0) throw new Error("The linear ticket provider needs team and token_env in .factory/adapters.yaml");
	return createLinearTicketProvider({
		apiUrl: LINEAR_API,
		uploadsUrl: LINEAR_UPLOADS,
		token: fromEnv(env, tokenEnv),
		team,
		...project === void 0 ? {} : { project },
		repository: adapters.repository,
		http
	});
};
var createTicketProvider = (adapters, env, http) => {
	const provider = supportedProvider(adapters);
	if (provider.kind === "linear") return createLinearProvider(provider, adapters, env, http);
	const { base_url: baseUrl, filter, token_env: tokenEnv, email_env: emailEnv } = provider;
	if (baseUrl === void 0 || filter === void 0 || tokenEnv === void 0 || emailEnv === void 0) throw new Error("The jira ticket provider needs base_url, filter, token_env and email_env in .factory/adapters.yaml");
	return createJiraTicketProvider({
		baseUrl,
		filter,
		email: fromEnv(env, emailEnv),
		token: fromEnv(env, tokenEnv),
		repository: adapters.repository,
		http,
		now
	});
};
var createSampleViewSource = () => createDemoViewSource({
	config: sampleFactoryConfig(),
	now
});
var createProjectViewSource = async ({ cwd, env }) => {
	const config = await loadConfig(cwd, "factory.yaml", parseFactoryConfig);
	const adapters = await loadConfig(cwd, "adapters.yaml", parseAdaptersConfig);
	const http = withRateLimitRetry(createFetchHttp(), {
		sleep,
		maxRetries: MAX_RETRIES
	});
	return createViewSource({
		providers: [{
			name: TICKET_PROVIDER_NAMES[supportedProvider(adapters).kind],
			provider: createTicketProvider(adapters, env, http)
		}],
		config,
		repository: adapters.repository,
		machine: hostname(),
		now,
		openWorktree: createOrcaWorktreeOpener({ run: createCommandRunner("orca") })
	});
};
var holder = {};
var getSource = () => {
	holder.source ??= process.env["FACTORY_VIEW_SAMPLE"] === "1" ? Promise.resolve(createSampleViewSource()) : createProjectViewSource({
		cwd: process.env["FACTORY_PROJECT_DIR"] ?? process.cwd(),
		env: process.env
	});
	return holder.source;
};
var messageOf = (error) => error instanceof Error ? error.message : String(error);
var fetchView_createServerFn_handler = createServerRpc({
	id: "3d6a23f6b7cc8f8a329e41a209d96587900fec09bccc0f285b40dca86311a67e",
	name: "fetchView",
	filename: "src/server/functions.ts"
}, (opts) => fetchView.__executeServer(opts));
var fetchView = createServerFn({ method: "GET" }).handler(fetchView_createServerFn_handler, async () => {
	try {
		return {
			ok: true,
			data: await (await getSource()).load()
		};
	} catch (error) {
		return {
			ok: false,
			message: messageOf(error)
		};
	}
});
var fetchDetail_createServerFn_handler = createServerRpc({
	id: "556e74f1f6692729f191d3f7ae147ed330525a375e523f7fe97b12869b3d33bc",
	name: "fetchDetail",
	filename: "src/server/functions.ts"
}, (opts) => fetchDetail.__executeServer(opts));
var fetchDetail = createServerFn({ method: "GET" }).validator((key) => key).handler(fetchDetail_createServerFn_handler, async ({ data }) => await (await getSource()).detail(data) ?? null);
var openRun_createServerFn_handler = createServerRpc({
	id: "41567f20a59a8cee49cc031e1b121c88afbc89ed746c1cd6470ecb9c537854ed",
	name: "openRun",
	filename: "src/server/functions.ts"
}, (opts) => openRun.__executeServer(opts));
var openRun = createServerFn({ method: "POST" }).validator((key) => key).handler(openRun_createServerFn_handler, async ({ data }) => (await getSource()).openInOrca(data));
var PERIODS = [
	7,
	30,
	90
];
var fetchHealth_createServerFn_handler = createServerRpc({
	id: "295a6e1eb54f07429317f54f45cb4c252194cfa2417e2f380a0dd37bd5bb6899",
	name: "fetchHealth",
	filename: "src/server/functions.ts"
}, (opts) => fetchHealth.__executeServer(opts));
var fetchHealth = createServerFn({ method: "GET" }).validator((days) => PERIODS.includes(days) ? days : 7).handler(fetchHealth_createServerFn_handler, async ({ data }) => {
	try {
		return {
			ok: true,
			data: await (await getSource()).health(data)
		};
	} catch (error) {
		return {
			ok: false,
			message: messageOf(error)
		};
	}
});
export { fetchDetail_createServerFn_handler, fetchHealth_createServerFn_handler, fetchView_createServerFn_handler, openRun_createServerFn_handler };
