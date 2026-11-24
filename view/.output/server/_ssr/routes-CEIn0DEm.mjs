import { __toESM } from "../_runtime.mjs";
import { CopyCommand, duration, fetchDetail, openRun, startRun } from "./router-D1hXzNJ-.mjs";
import { isRedirect, require_jsx_runtime, require_react, useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { useLoaderData } from "../_libs/@tanstack/react-router+[3...].mjs";
// node_modules/.nitro/vite/services/ssr/assets/routes-CEIn0DEm.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function useServerFn(serverFn) {
	const router = useRouter();
	return import_react.useCallback(async (...args) => {
		try {
			const res = await serverFn(...args);
			if (isRedirect(res)) throw res;
			return res;
		} catch (err) {
			if (isRedirect(err)) {
				err.options._fromLocation = router.stores.location.get();
				return router.navigate(router.resolveRedirect(err).options);
			}
			throw err;
		}
	}, [router, serverFn]);
}
var RISK_LABELS = {
	low: "Low risk",
	medium: "Medium risk",
	high: "High risk"
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
function CardButton({ card, columnId, selected, onSelect }) {
	const meta = [card.attempt === void 0 ? void 0 : `attempt ${card.attempt.number}/${card.attempt.limit}`, card.seconds === void 0 ? void 0 : duration(card.seconds)].filter((part) => part !== void 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		type: "button",
		className: `card${selected ? " card--selected" : ""}`,
		"aria-pressed": selected,
		"aria-label": `Open ${card.key} ${card.title}`,
		onClick: () => onSelect({
			column: columnId,
			key: card.key
		}),
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
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "card__provider",
						children: card.provider
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "card__title",
				children: card.title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "card__who",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [card.claimant ?? "Unclaimed", card.run === void 0 ? "" : ` · run ${card.run.number} of ${card.run.limit}`] }), card.risk === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: `risk risk--${card.risk}`,
					children: [RISK_LABELS[card.risk], " (predicted)"]
				})]
			}),
			card.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "attempt",
				"aria-label": `Attempt ${row.number}`,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "attempt__label",
					children: ["A", row.number]
				}), GATES.map((gate) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: `chip chip--${row[gate]}`,
					title: `${gate}: ${CHIP_NAMES[row[gate]]}`,
					children: [gate, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "visually-hidden",
						children: [" ", CHIP_NAMES[row[gate]]]
					})]
				}, gate))]
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
function Board({ columns, selected, onSelect }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
		className: "board",
		"aria-label": "Pipeline",
		children: columns.map((column) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "column",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
					className: column.id === "needs_you" ? "column__name column__name--warn" : "column__name",
					children: [
						column.name,
						" ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "column__count",
							children: column.cards.length
						})
					]
				}),
				column.cards.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "column__empty",
					children: "Nothing here"
				}) : null,
				column.cards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CardButton, {
					card,
					columnId: column.id,
					selected: column.id === selected?.column && card.key === selected.key,
					onSelect
				}, card.key))
			]
		}, column.id))
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
function RunDetailPanel({ card, detail, loading, onClose, copy, openInOrca, startInOrca }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
		className: "detail",
		"aria-label": "Run detail",
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
											children: STATUS_NAMES[step.status]
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
function BoardScreen({ columns, loadDetail, copy, openInOrca, startInOrca }) {
	const [selection, setSelection] = (0, import_react.useState)(void 0);
	const matches = (candidate) => candidate.key === selection?.key;
	const card = columns.find((column) => column.id === selection?.column)?.cards.find(matches) ?? columns.flatMap((column) => column.cards).find(matches);
	const select = async ({ column, key }) => {
		setSelection({
			column,
			key,
			detail: void 0,
			loading: true
		});
		const detail = await loadDetail(key);
		setSelection((current) => current?.column === column && current.key === key ? {
			column,
			key,
			detail,
			loading: false
		} : current);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "screen",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Board, {
			columns,
			onSelect: select,
			...selection === void 0 ? {} : { selected: {
				column: selection.column,
				key: selection.key
			} }
		}), selection === void 0 || card === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RunDetailPanel, {
			card,
			detail: selection.detail,
			loading: selection.loading,
			onClose: () => setSelection(void 0),
			...copy === void 0 ? {} : { copy },
			...openInOrca === void 0 ? {} : { openInOrca },
			...startInOrca === void 0 ? {} : { startInOrca }
		})]
	});
}
function BoardRoute() {
	const view = useLoaderData({ from: "__root__" });
	const loadDetail = useServerFn(fetchDetail);
	const open = useServerFn(openRun);
	const start = useServerFn(startRun);
	if (!view.ok) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BoardScreen, {
		columns: view.data.columns,
		loadDetail: async (key) => await loadDetail({ data: key }) ?? void 0,
		openInOrca: (key) => open({ data: key }),
		startInOrca: (request) => start({ data: request })
	});
}
export { BoardRoute as component };
