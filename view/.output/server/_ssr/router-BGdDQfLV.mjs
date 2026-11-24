import { __toESM } from "../_runtime.mjs";
import { require_jsx_runtime, require_react, useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { TSS_SERVER_FUNCTION, createServerFn, getServerFnById } from "./ssr.mjs";
import { HeadContent, Link, Scripts, createFileRoute, createRootRoute, createRouter, lazyRouteComponent, useNavigate, useSearch } from "../_libs/@tanstack/react-router+[3...].mjs";
import { Outlet } from "../_libs/@tanstack/react-router+[2...].mjs";
// node_modules/.nitro/vite/services/ssr/assets/CopyCommand-D-XfUN29.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var MINUTE = 60;
var HOUR = 3600;
var DAY = 86400;
var duration = (seconds) => {
	if (seconds < MINUTE) return `${seconds}s`;
	if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
	const minutes = Math.floor(seconds % HOUR / MINUTE);
	return minutes === 0 ? `${Math.floor(seconds / HOUR)}h` : `${Math.floor(seconds / HOUR)}h ${minutes}m`;
};
var count = (amount, unit) => `${amount} ${unit}${amount === 1 ? "" : "s"}`;
var waiting = (since, now) => {
	const seconds = Math.max(Math.round((Date.parse(now) - Date.parse(since)) / 1e3), 0);
	if (seconds < HOUR) return count(Math.floor(seconds / MINUTE), "min");
	if (seconds < DAY) return count(Math.floor(seconds / HOUR), "hour");
	return count(Math.floor(seconds / DAY), "day");
};
var clockTime = (iso) => iso.slice(11, 16);
var LABELS = {
	idle: "Copy command",
	copied: "Copied",
	failed: "Copy failed: select the text"
};
var toClipboard = (text) => navigator.clipboard.writeText(text);
function CopyCommand({ command, copy = toClipboard }) {
	const [state, setState] = (0, import_react.useState)("idle");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "command",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: command }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "button button--primary",
			onClick: () => copy(command).then(() => setState("copied"), () => setState("failed")),
			children: LABELS[state]
		})]
	});
}
// node_modules/.nitro/vite/services/ssr/assets/functions-CeekdkTQ.js
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var fetchView = createServerFn({ method: "GET" }).handler(createSsrRpc("3d6a23f6b7cc8f8a329e41a209d96587900fec09bccc0f285b40dca86311a67e"));
var reloadView = createServerFn({ method: "POST" }).handler(createSsrRpc("9626c782228982b94e45134c43ed37990be326a9d948c83165234ac1facbb9b8"));
var fetchDetail = createServerFn({ method: "GET" }).validator((key) => key).handler(createSsrRpc("556e74f1f6692729f191d3f7ae147ed330525a375e523f7fe97b12869b3d33bc"));
var openRun = createServerFn({ method: "POST" }).validator((key) => key).handler(createSsrRpc("41567f20a59a8cee49cc031e1b121c88afbc89ed746c1cd6470ecb9c537854ed"));
var startRun = createServerFn({ method: "POST" }).validator((request) => ({
	key: String(request.key),
	command: String(request.command)
})).handler(createSsrRpc("d2af39f86abab94aaeb8033b5f23f8fa0de3c2e25186d97758dad4cbf0fad499"));
var PERIODS$1 = [
	7,
	30,
	90
];
var fetchHealth = createServerFn({ method: "GET" }).validator((days) => PERIODS$1.includes(days) ? days : 7).handler(createSsrRpc("295a6e1eb54f07429317f54f45cb4c252194cfa2417e2f380a0dd37bd5bb6899"));
// node_modules/.nitro/vite/services/ssr/assets/router-BGdDQfLV.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
function ForceRefresh({ reload, refresh }) {
	const [running, setRunning] = (0, import_react.useState)(false);
	const start = () => {
		setRunning(true);
		reload().catch(() => void 0).then(refresh).catch(() => void 0).finally(() => setRunning(false));
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type: "button",
		className: "button force-refresh",
		disabled: running,
		onClick: start,
		children: running ? "Refreshing…" : "Force refresh"
	});
}
function Freshness({ loadedAt, refreshedAt, staleSince, problem, running, needsYou }) {
	if (staleSince !== void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "freshness freshness--stale",
		role: "status",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "dot dot--waiting",
				"aria-hidden": "true"
			}),
			"Stale since ",
			clockTime(staleSince),
			" UTC",
			problem === void 0 ? "" : ` · ${problem}`,
			" · retrying"
		]
	});
	const seconds = refreshedAt === void 0 ? 0 : Math.max(Math.round((Date.parse(loadedAt) - Date.parse(refreshedAt)) / 1e3), 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "freshness",
		role: "status",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "dot dot--pass",
				"aria-hidden": "true"
			}),
			"Updated ",
			seconds,
			" s ago · ",
			running,
			" running · ",
			needsYou,
			" need you"
		]
	});
}
function HeaderStatus({ reload, refresh, ...freshness }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "top__status",
		role: "group",
		"aria-label": "Board freshness",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Freshness, { ...freshness }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ForceRefresh, {
			reload,
			refresh
		})]
	});
}
var JOKES = [
	"Why do programmers prefer dark mode? Because light attracts bugs.",
	"There are 10 kinds of people: those who understand binary and those who don't.",
	"A SQL query walks into a bar, goes up to two tables and asks: may I join you?",
	"Why did the pull request go to therapy? It had too many unresolved conflicts.",
	"Why did the developer go broke? Because they used up all their cache."
];
function JokeButton({ children }) {
	const [shown, setShown] = (0, import_react.useState)(void 0);
	const next = () => setShown((current) => current === void 0 ? 0 : (current + 1) % JOKES.length);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "top__actions",
		children: [children, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "button joke-button",
			onClick: next,
			children: "Tell me a joke"
		})]
	}), shown === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "top__joke",
		role: "status",
		children: JOKES[shown]
	})] });
}
var styles_default = "/assets/styles-B2c9rFYS.css";
var Route$3 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: "Software factory" }
		],
		links: [{
			rel: "stylesheet",
			href: styles_default
		}]
	}),
	loader: () => fetchView(),
	component: RootComponent
});
var DEFAULT_POLL_SECONDS = 60;
function RootComponent() {
	const view = Route$3.useLoaderData();
	const router = useRouter();
	const pollSeconds = view.ok ? view.data.pollSeconds : DEFAULT_POLL_SECONDS;
	(0, import_react.useEffect)(() => {
		const timer = setInterval(() => void router.invalidate(), pollSeconds * 1e3);
		return () => clearInterval(timer);
	}, [router, pollSeconds]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "top",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "top__title",
						children: "Software factory"
					}),
					view.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "top__sub",
						children: [
							view.data.repository,
							" · read from ",
							view.data.providers.join(", "),
							" · read-only"
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
						className: "tabs",
						"aria-label": "Views",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/",
								className: "tab",
								activeProps: { className: "tab tab--active" },
								activeOptions: {
									exact: true,
									includeSearch: false
								},
								children: "Board"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
								to: "/needs-you",
								className: "tab",
								activeProps: { className: "tab tab--active" },
								children: ["Needs you", view.ok ? ` · ${view.data.needsYou.length}` : ""]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/health",
								search: { days: 7 },
								className: "tab",
								activeProps: { className: "tab tab--active" },
								children: "Health"
							})
						]
					})
				] }), view.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(JokeButton, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeaderStatus, {
					loadedAt: view.data.loadedAt,
					running: view.data.running,
					needsYou: view.data.needsYou.length,
					...view.data.refreshedAt === void 0 ? {} : { refreshedAt: view.data.refreshedAt },
					...view.data.staleSince === void 0 ? {} : { staleSince: view.data.staleSince },
					...view.data.problem === void 0 ? {} : { problem: view.data.problem },
					reload: () => reloadView(),
					refresh: () => router.invalidate()
				}) }) : null]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "rule" }),
			view.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
				className: "screen screen--list",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "list__title",
					children: "The factory view could not start"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					role: "alert",
					children: view.message
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})
		] })]
	});
}
var RISK_LABELS = {
	low: "Low",
	medium: "Medium",
	high: "High"
};
var CHIP_NAMES = {
	pass: "passed",
	fail: "failed",
	running: "running",
	pending: "not started"
};
var GATES = [
	"build",
	"gate",
	"verify",
	"review"
];
var FAILED_CATEGORIES = [
	"blocked",
	"run_limit",
	"revert"
];
var NOT_STARTED_COLUMNS = ["available", "ready"];
var statusOf = (card, columnId) => {
	if (card.interrupted || columnId === "pr") return "waiting";
	if (columnId === "done") return "pass";
	if (columnId === "needs_you") return FAILED_CATEGORIES.includes(card.category) ? "fail" : "waiting";
	return NOT_STARTED_COLUMNS.includes(columnId) ? "pending" : "running";
};
function CardButton({ card, columnId, showProvider, selected, onSelect }) {
	const meta = [card.attempt === void 0 ? void 0 : `attempt ${card.attempt.number}/${card.attempt.limit}`, card.seconds === void 0 ? void 0 : duration(card.seconds)].filter((part) => part !== void 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		type: "button",
		className: `card${selected ? " card--selected" : ""}`,
		"aria-pressed": selected,
		"aria-label": `Open ${card.key} ${card.title}`,
		onClick: (event) => onSelect({
			column: columnId,
			key: card.key
		}, event.currentTarget),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "card__top",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: `dot dot--${statusOf(card, columnId)}`,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "card__key",
						children: card.key
					}),
					showProvider ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "card__provider",
						children: card.provider
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "card__title",
				children: card.title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "card__who",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [card.claimant ?? "Unclaimed", card.run === void 0 ? "" : ` · run ${card.run.number} of ${card.run.limit}`] }), card.risk === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: `risk risk--${card.risk}`,
					role: "img",
					"aria-label": `${RISK_LABELS[card.risk]} risk (predicted)`,
					children: RISK_LABELS[card.risk]
				})]
			}),
			card.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "attempt",
				"aria-label": `Attempt ${row.number}`,
				children: GATES.map((gate) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: `chip chip--${row[gate]}`,
					title: `${gate} ${CHIP_NAMES[row[gate]]}`,
					children: [gate.charAt(0), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "visually-hidden",
						children: ` ${gate} ${CHIP_NAMES[row[gate]]}`
					})]
				}, gate))
			}, row.number)),
			card.earlierAttempts === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "card__more",
				children: [
					"+",
					card.earlierAttempts,
					" earlier ",
					card.earlierAttempts === 1 ? "attempt" : "attempts"
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "card__bottom",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: card.interrupted ? "note note--warn" : "note",
					children: card.note
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "card__meta",
					children: meta.join(" · ")
				})]
			}),
			card.recordEdited ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "note note--warn",
				children: "Record edited outside the factory"
			}) : null
		]
	});
}
function Board({ columns, providers, selected, onSelect }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
		className: "board",
		"aria-label": "Pipeline",
		children: columns.map((column) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: column.cards.length === 0 ? "column column--empty" : "column",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
				className: column.id === "needs_you" ? "column__name column__name--warn" : "column__name",
				children: [
					column.name,
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "column__count",
						children: column.cards.length
					})
				]
			}), column.cards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardButton, {
				card,
				columnId: column.id,
				showProvider: providers > 1,
				selected: column.id === selected?.column && card.key === selected.key,
				onSelect
			}, card.key))]
		}, column.id))
	});
}
var MAX_LINES = 2;
var useWidth = (element) => {
	const [width, setWidth] = (0, import_react.useState)(0);
	(0, import_react.useEffect)(() => {
		if (element === null) return void 0;
		const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return width;
};
var lineIndexes = (elements) => elements.map((element) => element.getBoundingClientRect()).reduce(({ line, indexes }, rect, index) => {
	const next = index === 0 ? {
		count: 1,
		top: rect.top
	} : rect.top >= line.top + rect.height / 2 ? {
		count: line.count + 1,
		top: rect.top
	} : line;
	return {
		line: next,
		indexes: [...indexes, next.count]
	};
}, {
	line: {
		count: 0,
		top: 0
	},
	indexes: []
}).indexes;
var fittingCount = (list, shown) => {
	const lines = lineIndexes([...list.children]);
	if ((lines.at(-1) ?? 0) <= MAX_LINES) return void 0;
	const fitting = lines.slice(1, shown + 1).filter((line) => line <= MAX_LINES).length;
	return Math.max(Math.min(shown - 1, fitting), 0);
};
function NeedsYouStrip({ items, onOpen }) {
	const [list, setList] = (0, import_react.useState)(null);
	const width = useWidth(list);
	const [shown, setShown] = (0, import_react.useState)(items.length);
	(0, import_react.useLayoutEffect)(() => setShown(items.length), [
		items,
		width,
		list
	]);
	(0, import_react.useLayoutEffect)(() => {
		if (list === null || !list.isConnected) return;
		const fitting = fittingCount(list, shown);
		if (fitting !== void 0) setShown(fitting);
	});
	if (items.length === 0) return null;
	const count = `${items.length} need you`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
		className: "strip",
		"aria-label": "Needs you",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
			className: "strip__items",
			ref: setList,
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "strip__count",
					children: count
				}),
				items.slice(0, shown).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "strip__slot",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "strip__item",
						onClick: (event) => onOpen(item.key, event.currentTarget),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "strip__key",
								children: item.key
							}),
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "strip__why",
								children: item.why
							})
						]
					})
				}, `${item.category}-${item.key}`)),
				shown < items.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "strip__slot",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/needs-you",
						className: "strip__more",
						children: [
							"+",
							items.length - shown,
							" more"
						]
					})
				}) : null
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: "/needs-you",
			className: "strip__count strip__count--link strip__phone",
			children: count
		})]
	});
}
function OpenInOrca({ runKey, open }) {
	const [state, setState] = (0, import_react.useState)({ kind: "idle" });
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "command",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "button button--primary",
				onClick: () => open(runKey).then((result) => setState(result.ok ? { kind: "opened" } : {
					kind: "failed",
					message: result.message
				})),
				children: "Open in Orca"
			}),
			state.kind === "opened" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Opened in Orca." }) : null,
			state.kind === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: state.message }) : null
		]
	});
}
var messageOf = (error) => error instanceof Error ? error.message : String(error);
function StartInOrca({ runKey, command, start }) {
	const [state, setState] = (0, import_react.useState)({ kind: "idle" });
	const press = () => {
		setState({ kind: "starting" });
		start({
			key: runKey,
			command
		}).catch((error) => ({
			ok: false,
			message: `Orca could not start ${runKey}: ${messageOf(error)}`
		})).then((result) => setState(result.ok ? {
			kind: "started",
			worktree: result.worktree
		} : {
			kind: "failed",
			message: result.message
		}));
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "command",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "button start-in-orca",
				disabled: state.kind === "starting" || state.kind === "started",
				onClick: press,
				children: state.kind === "starting" ? "Starting in Orca…" : "Start in Orca"
			}),
			state.kind === "started" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "start-in-orca__status",
				role: "status",
				children: ["Started in Orca: ", state.worktree]
			}) : null,
			state.kind === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "start-in-orca__status",
				role: "status",
				children: state.message
			}) : null
		]
	});
}
var STATUS_NAMES = {
	pass: "passed",
	fail: "failed",
	running: "in progress",
	pending: "not started"
};
var isLink = (text) => /^https?:\/\//.test(text);
var useEscape = (onEscape) => (0, import_react.useEffect)(() => {
	const listener = (event) => {
		if (event.key === "Escape") onEscape();
	};
	document.addEventListener("keydown", listener);
	return () => document.removeEventListener("keydown", listener);
}, [onEscape]);
var HEADER = "header.top";
var useBelowHeader = (drawer) => (0, import_react.useLayoutEffect)(() => {
	const place = () => {
		const bottom = document.querySelector(HEADER)?.getBoundingClientRect().bottom ?? 0;
		drawer.current?.style.setProperty("--drawer-top", `${Math.max(Math.round(bottom), 0)}px`);
	};
	place();
	const header = document.querySelector(HEADER);
	const resized = new ResizeObserver(place);
	if (header !== null) resized.observe(header);
	window.addEventListener("scroll", place, { passive: true });
	window.addEventListener("resize", place);
	return () => {
		resized.disconnect();
		window.removeEventListener("scroll", place);
		window.removeEventListener("resize", place);
	};
}, [drawer]);
function RunDetailPanel({ card, detail, loading, onClose, copy, openInOrca, startInOrca }) {
	const title = (0, import_react.useRef)(null);
	const drawer = (0, import_react.useRef)(null);
	useBelowHeader(drawer);
	(0, import_react.useEffect)(() => title.current?.focus({ preventScroll: true }), []);
	useEscape(onClose);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
		className: "detail",
		"aria-label": "Run detail",
		ref: drawer,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "detail__header",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "detail__key",
					children: [
						card.key,
						" · ",
						card.provider
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "icon-button",
					"aria-label": "Close run detail",
					onClick: onClose,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
							d: "M2 2L12 12M12 2L2 12",
							stroke: "currentColor",
							strokeWidth: "1.8",
							strokeLinecap: "round",
							fill: "none"
						})
					})
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "detail__title",
				ref: title,
				tabIndex: -1,
				children: card.title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "detail__note",
				children: card.note
			}),
			card.claimant === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "detail__where",
				children: card.onThisMachine ? "This run is on your machine, in Orca." : `This run is in ${card.claimant}'s Orca.`
			}),
			card.onThisMachine && openInOrca !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OpenInOrca, {
				runKey: card.key,
				open: openInOrca
			}, card.key) : null,
			card.command === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyCommand, {
				command: card.command,
				...copy === void 0 ? {} : { copy }
			}),
			card.command === void 0 || card.onThisMachine || startInOrca === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StartInOrca, {
				runKey: card.key,
				command: card.command,
				start: startInOrca
			}, card.key),
			card.pullRequest === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
				className: "button",
				href: card.pullRequest,
				children: "Open pull request"
			}) }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "detail__source",
				children: [
					"Everything below is read from the factory comment on ",
					card.key,
					"."
				]
			}),
			loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				role: "status",
				children: "Loading the run…"
			}) : null,
			!loading && detail === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "This ticket has no factory record yet." }) : null,
			detail?.sections.map((section) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "detail__section",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: section.title }),
					section.steps.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "detail__empty",
						children: "Nothing recorded."
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "steps",
						children: section.steps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "step",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "step__head",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: `dot dot--${step.status}`,
											"aria-hidden": "true"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: step.label }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "step__status",
											children: step.statusName ?? STATUS_NAMES[step.status]
										})
									]
								}),
								step.lines.map((line, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "step__line",
									children: line
								}, `${index}-${line}`)),
								step.links.map((link) => isLink(link) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
									href: link,
									children: link
								}) }, link) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "step__line",
									children: link
								}, link))
							]
						}, step.label))
					})
				]
			}, section.title))
		]
	});
}
var COLUMN_IDS = {
	available: true,
	refining: true,
	ready: true,
	revalidate: true,
	build: true,
	review: true,
	pr: true,
	needs_you: true,
	done: true
};
var isColumnId = (value) => typeof value === "string" && Object.hasOwn(COLUMN_IDS, value);
var cardSearch = (search) => {
	const card = search["card"];
	const column = search["column"];
	if (typeof card !== "string") return {};
	return isColumnId(column) ? {
		card,
		column
	} : { card };
};
var locate = (columns, key, preferred) => {
	const placed = columns.flatMap((column) => column.cards.filter((card) => card.key === key).map((card) => ({
		column: column.id,
		card
	})));
	return placed.find(({ column }) => column === preferred) ?? placed.find(({ column }) => column === "needs_you") ?? placed[0];
};
var useDetail = (key, loadDetail) => {
	const [loaded, setLoaded] = (0, import_react.useState)(void 0);
	const load = (0, import_react.useRef)(loadDetail);
	(0, import_react.useLayoutEffect)(() => {
		load.current = loadDetail;
	});
	(0, import_react.useEffect)(() => {
		if (key === void 0) return void 0;
		const request = new AbortController();
		load.current(key).then((detail) => {
			if (!request.signal.aborted) setLoaded({
				key,
				detail
			});
		});
		return () => request.abort();
	}, [key]);
	return loaded?.key === key ? loaded : void 0;
};
var useMemoryAddress = () => {
	const [selected, setSelected] = (0, import_react.useState)(void 0);
	const clear = () => setSelected(void 0);
	const close = (closed) => {
		clear();
		closed();
	};
	return {
		card: selected?.key,
		column: selected?.column,
		show: setSelected,
		close,
		forget: clear
	};
};
var isDrawerClose = (from, to) => from?.pathname === "/" && from.search.card !== void 0 && to.pathname === "/" && to.search.card === void 0;
var useScrollKeptOnClose = (router) => (0, import_react.useEffect)(() => {
	const kept = { current: void 0 };
	const leave = router.subscribe("onBeforeLoad", ({ fromLocation, toLocation }) => {
		kept.current = isDrawerClose(fromLocation, toLocation) ? {
			x: window.scrollX,
			y: window.scrollY
		} : void 0;
	});
	const arrive = router.subscribe("onRendered", () => {
		if (kept.current === void 0) return;
		window.scrollTo(kept.current.x, kept.current.y);
		kept.current = void 0;
	});
	return () => {
		leave();
		arrive();
	};
}, [router]);
var useCardAddress = () => {
	const { card, column } = useSearch({ from: "/" });
	const navigate = useNavigate();
	const router = useRouter();
	const pushed = (0, import_react.useRef)(false);
	useScrollKeptOnClose(router);
	const show = (selected, replace) => {
		pushed.current = pushed.current || !replace;
		navigate({
			to: "/",
			search: {
				card: selected.key,
				column: selected.column
			},
			replace,
			resetScroll: false
		});
	};
	const forget = () => {
		pushed.current = false;
		navigate({
			to: "/",
			search: {},
			replace: true,
			resetScroll: false
		});
	};
	const close = (closed) => {
		const unsubscribe = router.subscribe("onRendered", () => {
			unsubscribe();
			closed();
		});
		return pushed.current ? router.history.back() : forget();
	};
	return {
		card,
		column,
		show,
		close,
		forget
	};
};
function BoardScreen({ address: routed, columns, needsYou = [], providers = 1, loadDetail, copy, openInOrca, startInOrca }) {
	const memory = useMemoryAddress();
	const address = routed ?? memory;
	const opener = (0, import_react.useRef)(null);
	const open = locate(columns, address.card, address.column);
	const loaded = useDetail(open?.card.key, loadDetail);
	const missing = address.card !== void 0 && open === void 0;
	const { forget } = address;
	(0, import_react.useEffect)(() => {
		if (missing) forget();
	}, [missing, forget]);
	const select = (selected, element) => {
		opener.current = element;
		address.show(selected, open !== void 0);
	};
	const returnFocus = () => {
		const element = opener.current;
		if (element === null || !element.isConnected) return;
		element.focus({ preventScroll: true });
		element.scrollIntoView({ block: "nearest" });
	};
	const close = () => address.close(returnFocus);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "screen",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NeedsYouStrip, {
				items: needsYou,
				onOpen: (key, element) => select({
					column: "needs_you",
					key
				}, element)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Board, {
				columns,
				providers,
				onSelect: select,
				...open === void 0 ? {} : { selected: {
					column: open.column,
					key: open.card.key
				} }
			}),
			open === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RunDetailPanel, {
				card: open.card,
				detail: loaded?.detail,
				loading: loaded === void 0,
				onClose: close,
				...copy === void 0 ? {} : { copy },
				...openInOrca === void 0 ? {} : { openInOrca },
				...startInOrca === void 0 ? {} : { startInOrca }
			}, `${open.column}-${open.card.key}`)
		]
	});
}
var $$splitComponentImporter$2 = () => import("./routes-6n39iCz6.mjs");
var Route$2 = createFileRoute("/")({
	validateSearch: cardSearch,
	component: lazyRouteComponent($$splitComponentImporter$2, "component")
});
var PERIODS = [
	7,
	30,
	90
];
var NONE = "–";
var capitalised = (text) => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
function Stat({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "stat",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
			className: "stat__label",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
			className: "stat__value",
			children: value
		})]
	});
}
function Provider({ health, copy }) {
	const id = `health-${health.provider.replace(/\W+/g, "-")}`;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "health",
		"aria-labelledby": id,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "health__provider",
				id,
				children: health.provider
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "stats",
				role: "group",
				"aria-label": "Totals",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Merged",
						value: String(health.merged)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "First-pass rate",
						value: health.firstPassRate === void 0 ? NONE : `${Math.round(health.firstPassRate * 100)}%`
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Average attempts",
						value: health.averageAttempts === void 0 ? NONE : health.averageAttempts.toFixed(1)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Send-backs",
						value: String(health.sendBacks)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Blocked",
						value: String(health.blocked)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Cost per merge",
						value: "Not reported"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "health__note",
				children: "The agent runtime does not report cost."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "health__tables",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
					className: "table",
					"aria-label": "Failure reasons by gate",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Gate"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Failures"
					})] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: health.failures.map(({ gate, count }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: gate }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: count })] }, gate)) })]
				}), health.failures.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "health__note",
					children: "No gate failed in this period."
				}) : null] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
					className: "table",
					"aria-label": "Median time per station",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Station"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Median"
					})] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: health.stations.map(({ name, medianSeconds }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: duration(medianSeconds) })] }, name)) })]
				}), health.stations.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "health__note",
					children: "No step finished in this period."
				}) : null] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "table",
				"aria-label": "Shadow mode by risk level",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Level"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Merged"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Merged as is"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Changed by a person"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "Reverted within 2 weeks"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						scope: "col",
						children: "In a row"
					})
				] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: health.levels.map((level) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: level.level }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: level.merged }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: level.mergedAsIs }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: level.changed }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: level.reverted }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { children: [
						level.streak,
						" of ",
						level.threshold
					] })
				] }, level.level)) })]
			}),
			health.levels.map((level) => level.suggestion === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "health__suggestion",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
					capitalised(level.level),
					" risk reached ",
					level.streak,
					" changes in a row with no disagreement and no revert. To turn auto-merge on, run:"
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyCommand, {
					command: level.suggestion,
					...copy === void 0 ? {} : { copy }
				})]
			}, level.level))
		]
	});
}
function Health({ health, onPeriod, copy }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "screen screen--list",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "list__title",
				children: "Health"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "list__lead",
				children: [
					"Computed from the run records of tickets updated in the last ",
					health.periodDays,
					" days, read from the ticket provider each time. Nothing is stored."
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "filters",
				role: "group",
				"aria-label": "Period",
				children: PERIODS.map((days) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "filter",
					"aria-pressed": health.periodDays === days,
					onClick: () => onPeriod(days),
					children: [days, " days"]
				}, days))
			}),
			health.providers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "list__empty",
				children: [
					"No ticket with a factory record changed in the last ",
					health.periodDays,
					" days."
				]
			}) : null,
			health.providers.map((provider) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Provider, {
				health: provider,
				copy
			}, provider.provider))
		]
	});
}
var $$splitComponentImporter$1 = () => import("./health-CkkYO4SJ.mjs");
var DEFAULT_PERIOD = 7;
var periodOf = (value) => PERIODS.find((days) => days === Number(value)) ?? DEFAULT_PERIOD;
var Route$1 = createFileRoute("/health")({
	validateSearch: (search) => ({ days: periodOf(search["days"]) }),
	loaderDeps: ({ search }) => ({ days: search.days }),
	loader: ({ deps }) => fetchHealth({ data: deps.days }),
	component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
var $$splitComponentImporter = () => import("./needs-you-DokJMIeX.mjs");
var Route = createFileRoute("/needs-you")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
var rootRouteChildren = {
	IndexRoute: Route$2.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$3
	}),
	HealthRoute: Route$1.update({
		id: "/health",
		path: "/health",
		getParentRoute: () => Route$3
	}),
	NeedsYouRoute: Route.update({
		id: "/needs-you",
		path: "/needs-you",
		getParentRoute: () => Route$3
	})
};
var routeTree = Route$3._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		scrollRestoration: true
	});
}
export { BoardScreen, CopyCommand, Health, Route$1, fetchDetail, openRun, router_exports, startRun, useCardAddress, waiting };
