# Tasks

These tasks cover what the ticket and the repository settle (D-001 to D-003). The tasks that depend on the place, the label, the jokes and where the joke shows are written when Q1 to Q4 in design.md are answered.

## 1. Joke button

- [ ] 1.1 Test-first in `view/src/components/JokeButton.test.tsx` (Vitest browser mode): before any press, the joke button is shown enabled and no joke is displayed; verify the new test fails, then passes once `view/src/components/JokeButton.tsx` exists
- [ ] 1.2 Test-first in the same file: pressing the button displays a joke; verify the new test fails, then passes
- [ ] 1.3 Render the joke button on the dashboard (Q1 says where) and, test-first in a browser test that renders it together with the forced reload and the page-data refresh of "Force refresh" as spies, check that pressing the joke button calls neither and leaves the freshness line as it was; verify the new test fails, then passes

## 2. Layout

- [ ] 2.1 With the real `styles.css` and a viewport 390px wide, a displayed joke is entirely inside the window and the page does not scroll sideways. Verified by a layout test in `view/src/components/BoardLayout.test.tsx` that presses the button, then compares the joke's bounding box with the window and the page's scroll width with its client width
- [ ] 2.2 The dashboard's existing layout rules still hold with the button on it. Verified by the existing tests in `view/src/components/BoardLayout.test.tsx` and `view/src/components/HeaderStatus.test.tsx` passing unchanged

## 3. Release

- [ ] 3.1 Rebuild the committed dashboard with `pnpm build:view` and commit `view/.output`. Verified by `tests/view-build.test.ts` passing and by the joke button's label being found in the built files under `view/.output/`
- [ ] 3.2 The whole suite and the type checks pass. Verified by `pnpm test`, `pnpm test:view`, `pnpm typecheck` and `pnpm --filter @software-factory/view typecheck` exiting with code 0
- [ ] 3.3 End to end on sample data, with this checkout's own build: run `pnpm build`, then `node dist/cli/bin.js view --sample` (`factory view` would serve the dashboard of the installed engine instead), press the joke button, and verify that a joke is displayed, that the Board shows the same cards as before the press, and that the page does not scroll sideways at 390px and at 1440px wide
