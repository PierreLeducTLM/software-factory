import { __toESM } from "../_runtime.mjs";
import { CopyCommand, waiting } from "./router-D1hXzNJ-.mjs";
import { require_jsx_runtime, require_react } from "../_libs/@tanstack/react-router+[...].mjs";
import { useLoaderData } from "../_libs/@tanstack/react-router+[3...].mjs";
// node_modules/.nitro/vite/services/ssr/assets/needs-you-BnXCbT7g.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var CATEGORIES = [
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
var LABELS = {
	revert: "Revert",
	blocked: "Blocked",
	run_limit: "Run limit reached",
	interrupted: "Interrupted",
	record_edited: "Record edited",
	sent_back: "Sent back",
	merge: "Ready to merge",
	approve: "Approve spec",
	not_started: "Not started"
};
var TONES = {
	revert: "fail",
	blocked: "fail",
	run_limit: "fail",
	interrupted: "warn",
	record_edited: "warn",
	sent_back: "warn",
	merge: "info",
	approve: "good",
	not_started: "muted"
};
function NeedsYou({ items, now, copy }) {
	const [filter, setFilter] = (0, import_react.useState)("all");
	const present = CATEGORIES.filter((category) => items.some((item) => item.category === category));
	const shown = items.filter((item) => filter === "all" || item.category === filter);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "screen screen--list",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "list__title",
				children: "Needs you"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "list__lead",
				children: "Everything waiting on a person, most urgent first. This page changes nothing: each button opens a link or copies a command for you to run in the project."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "filters",
				role: "group",
				"aria-label": "Filter",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "filter",
					"aria-pressed": filter === "all",
					onClick: () => setFilter("all"),
					children: ["All ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "filter__count",
						children: items.length
					})]
				}), present.map((category) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "filter",
					"aria-pressed": filter === category,
					onClick: () => setFilter(category),
					children: [
						LABELS[category],
						" ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "filter__count",
							children: items.filter((item) => item.category === category).length
						})
					]
				}, category))]
			}),
			items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "list__empty",
				children: "Nothing needs you right now."
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "items",
				children: shown.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "item",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "item__kind",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: `item__label tone--${TONES[item.category]}`,
								children: LABELS[item.category]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "item__age",
								children: ["waiting ", waiting(item.since, now)]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "item__body",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "item__head",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "item__key",
											children: item.key
										}),
										" ",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.title }),
										" ",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "item__provider",
											children: item.provider
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.why }),
								item.questions.map(({ question, recommended }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "question",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
											className: "question__label",
											children: "Question"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: question }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
											className: "question__recommended",
											children: ["Recommended: ", recommended]
										})
									]
								}, question))
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "item__actions",
							children: [item.command === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyCommand, {
								command: item.command,
								...copy === void 0 ? {} : { copy }
							}), item.link === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
								className: "button",
								href: item.link,
								children: item.category === "merge" || item.category === "revert" ? "Open pull request" : "Open report"
							})]
						})
					]
				}, `${item.category}-${item.key}`))
			})
		]
	});
}
function NeedsYouRoute() {
	const view = useLoaderData({ from: "__root__" });
	if (!view.ok) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NeedsYou, {
		items: view.data.needsYou,
		now: view.data.loadedAt
	});
}
export { NeedsYouRoute as component };
