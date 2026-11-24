# Tasks

## 1. The button and its jokes

- [x] 1.1 Test-first in `view/src/components/JokeButton.test.tsx` (Vitest browser mode): before any press, the "Tell me a joke" button is shown enabled and no joke is displayed; verify the new test fails, then passes once `view/src/components/JokeButton.tsx` exists
- [x] 1.2 Test-first in the same file: the first press displays "Why do programmers prefer dark mode? Because light attracts bugs.", and the button still reads "Tell me a joke" and is enabled; verify the new test fails, then passes
- [x] 1.3 Test-first in the same file: five presses display the five jokes of "Each press shows the next joke", word for word and in its order, each one replacing the one before, and a sixth press displays the first joke again; verify the new test fails, then passes
- [x] 1.4 Test-first in the same file: the displayed joke is the text of a status message (`role="status"`), and after a press there is still no button other than "Tell me a joke"; verify the new test fails, then passes
- [x] 1.5 A press sends no request. Verified by a test in the same file that spies on `fetch` and on `XMLHttpRequest.prototype.send`, presses the button, and finds neither called
- [x] 1.6 A fresh page starts over. Verified by a test in the same file that presses the button three times, unmounts what it rendered, renders it again, finds no joke, and finds the first joke after one press

## 2. The button in the header

- [x] 2.1 Render the joke button and its joke line in the header of `view/src/routes/__root.tsx`, the button after `HeaderStatus`, only when the dashboard loaded, and outside the "Board freshness" group; verify with `pnpm --filter @software-factory/view typecheck` and with the tests in `view/src/components/HeaderStatus.test.tsx` passing unchanged
- [x] 2.2 Layout test-first in `view/src/components/BoardLayout.test.tsx` (real `styles.css`, with a header fixture built as `__root.tsx` builds the header): at 1440px, before any press, the "Tell me a joke" button is to the right of "Force refresh" on the same line and the header ends at the buttons' bottom edge; after a press, both buttons are where they were, the joke is inside the header with its top edge at or below the button's bottom edge, and a second press at the same spot displays the second joke; verify the new test fails, then passes
- [x] 2.3 Layout test-first in the same file: at 390px the button is entirely inside the window and comes after "Force refresh", and after a press the whole joke is inside the window and the page does not scroll sideways; verify the new test fails, then passes
  - Note: this test already passed before any joke CSS existed, because the unstyled blocks stacked. It was shown able to fail by breaking the new CSS: a joke set to `white-space: nowrap` and a `.top__actions` that does not wrap each made it fail.
- [x] 2.4 The joke survives a change of page and a refresh. Verified by a browser test in `view/src/components/JokeButton.test.tsx` with a memory-history router whose root renders the joke button and its line above the page: after one press, moving to another route and invalidating the router leave the first joke displayed, and the next press displays the second joke
- [x] 2.5 Pressing the button changes nothing else. Verified by a browser test in `view/src/components/JokeButton.test.tsx` that renders the joke button next to `HeaderStatus` with spy `reload` and `refresh` callbacks, presses "Tell me a joke", and finds neither spy called and the freshness line unchanged

## 3. The drawer follows the header

- [x] 3.1 Layout test-first in `view/src/components/BoardLayout.test.tsx`: at 1440px, with the run detail drawer open, pressing "Tell me a joke" moves the header's bottom edge down and leaves the drawer's top edge at or below it; verify the new test fails, then passes once `useBelowHeader` in `view/src/components/RunDetailPanel.tsx` also follows changes of the header's size
- [x] 3.2 The drawer's existing rules still hold. Verified by the tests under "the drawer leaves the header usable" in `view/src/components/BoardLayout.test.tsx` passing unchanged

## 4. Release

- [x] 4.1 Rebuild the committed dashboard with `pnpm build:view` and commit `view/.output`. Verified by `tests/view-build.test.ts` passing and by "Tell me a joke" being found in the built files under `view/.output/`
- [x] 4.2 The whole suite and the type checks pass. Verified by `pnpm test`, `pnpm test:view`, `pnpm typecheck` and `pnpm --filter @software-factory/view typecheck` exiting with code 0

## 5. End-to-end check

- [x] 5.1 On sample data, with this checkout's own build: run `pnpm build`, then `node dist/cli/bin.js view --sample` (`factory view` would serve the dashboard of the installed engine instead). Verify at 1440px that the Board, Needs you and Health pages show "Tell me a joke" to the right of "Force refresh"; that two presses on the Board without moving the pointer display the first joke, then the second, under the button; that the joke is still displayed on the Needs you and Health pages, and after "Force refresh"; that the next press displays the third joke; that the Board shows the same cards as before the presses; and that after a page reload no joke is displayed and a press displays the first joke
- [x] 5.2 In the same dashboard, verify at 390px that a displayed joke is readable in full and the page does not scroll sideways, and at 1440px, with a card's drawer open, that pressing "Tell me a joke" leaves the header, joke included, uncovered by the drawer
- [x] 5.3 Could not start: from an empty folder, run this checkout's `dist/cli/bin.js view` with `node`, open the address it prints, and verify that the page reads "The factory view could not start" and that the header shows no "Tell me a joke" button
