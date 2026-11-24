import { __toESM } from "../_runtime.mjs";
import { BoardScreen, fetchDetail, openRun, startRun, useCardAddress } from "./router-Bi3COU6h.mjs";
import { isRedirect, require_jsx_runtime, require_react, useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { useLoaderData } from "../_libs/@tanstack/react-router+[3...].mjs";
// node_modules/.nitro/vite/services/ssr/assets/routes-DMrbmSZO.js
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
function BoardRoute() {
	const view = useLoaderData({ from: "__root__" });
	const loadDetail = useServerFn(fetchDetail);
	const open = useServerFn(openRun);
	const start = useServerFn(startRun);
	const address = useCardAddress();
	if (!view.ok) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BoardScreen, {
		address,
		columns: view.data.columns,
		needsYou: view.data.needsYou,
		providers: view.data.providers.length,
		loadDetail: async (key) => await loadDetail({ data: key }) ?? void 0,
		openInOrca: (key) => open({ data: key }),
		startInOrca: (request) => start({ data: request })
	});
}
export { BoardRoute as component };
