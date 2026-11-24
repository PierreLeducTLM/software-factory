import { __toESM } from "../_runtime.mjs";
import { require_jsx_runtime, require_react, useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { TSS_SERVER_FUNCTION, createServerFn, getServerFnById } from "./ssr.mjs";
import { HeadContent, Link, Scripts, createFileRoute, createRootRoute, createRouter, lazyRouteComponent } from "../_libs/@tanstack/react-router+[3...].mjs";
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
// node_modules/.nitro/vite/services/ssr/assets/router-D1hXzNJ-.js
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
var styles_default = "/assets/styles-DbaZTOM_.css";
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
								activeOptions: { exact: true },
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
				] }), view.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeaderStatus, {
					loadedAt: view.data.loadedAt,
					running: view.data.running,
					needsYou: view.data.needsYou.length,
					...view.data.refreshedAt === void 0 ? {} : { refreshedAt: view.data.refreshedAt },
					...view.data.staleSince === void 0 ? {} : { staleSince: view.data.staleSince },
					...view.data.problem === void 0 ? {} : { problem: view.data.problem },
					reload: () => reloadView(),
					refresh: () => router.invalidate()
				}) : null]
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
var $$splitComponentImporter$2 = () => import("./routes-CEIn0DEm.mjs");
var Route$2 = createFileRoute("/")({ component: lazyRouteComponent($$splitComponentImporter$2, "component") });
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
var $$splitComponentImporter$1 = () => import("./health-T9xSuxnr.mjs");
var DEFAULT_PERIOD = 7;
var periodOf = (value) => PERIODS.find((days) => days === Number(value)) ?? DEFAULT_PERIOD;
var Route$1 = createFileRoute("/health")({
	validateSearch: (search) => ({ days: periodOf(search["days"]) }),
	loaderDeps: ({ search }) => ({ days: search.days }),
	loader: ({ deps }) => fetchHealth({ data: deps.days }),
	component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
var $$splitComponentImporter = () => import("./needs-you-BnXCbT7g.mjs");
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
export { CopyCommand, Health, Route$1, duration, fetchDetail, openRun, router_exports, startRun, waiting };
