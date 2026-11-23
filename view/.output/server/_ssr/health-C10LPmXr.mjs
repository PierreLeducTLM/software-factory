import { Health, Route$1 } from "./router-CwKO00rL.mjs";
import { useNavigate } from "../_libs/@tanstack/react-router+[3...].mjs";
import { require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
// node_modules/.nitro/vite/services/ssr/assets/health-C10LPmXr.js
var import_jsx_runtime = require_jsx_runtime();
function HealthRoute() {
	const result = Route$1.useLoaderData();
	const navigate = useNavigate({ from: "/health" });
	if (!result.ok) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "screen screen--list",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "list__title",
			children: "Health"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			role: "alert",
			children: result.message
		})]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Health, {
		health: result.data,
		onPeriod: (days) => void navigate({ search: { days } })
	});
}
export { HealthRoute as component };
