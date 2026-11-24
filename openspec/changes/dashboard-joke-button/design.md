# Design

## Context

See proposal.md for the motivation. The ticket has no description. Its title settles a button, on the dashboard, that displays a joke when clicked, and calls it a dummy. Today:

- The dashboard is the app under `view/`. `view/src/routes/__root.tsx` renders the header on every page: the title, the tabs, and `HeaderStatus`, which holds the freshness line and "Force refresh". Under it comes the page: Board (`/`), Needs you (`/needs-you`) or Health (`/health`). When the view data cannot be loaded, the header keeps the title and the tabs only, and the page reads "The factory view could not start".
- The header (`.top` in `view/src/styles.css`) is a wrapping flex row with two sides pushed apart and aligned on their bottom edges: the title and tabs on the left, `HeaderStatus` on the right. When the right side does not fit beside the left one, it wraps under it.
- Measured in headless Chromium on the sample data: the two sides share a row from about 825px wide, the header is then 107px tall, and the freshness line and "Force refresh" (388px wide together, 32px tall) end at the header's bottom edge. At 390px the freshness line and "Force refresh" are on two lines.
- A button is a small component under `view/src/components/` that keeps its own state with `useState` and has a browser test next to it (`ForceRefresh.tsx`, `StartInOrca.tsx`, `CopyCommand.tsx`). A button reports its result as text beside it, with `role="status"`, as "Started in Orca: pie-21" does. The dashboard has no dialog, popover or toast.
- The view is read-only: no button changes a ticket. The page's data is loaded again by the poll in `__root.tsx` and by "Force refresh". Both keep the root layout mounted, as moving between the pages does.
- The open change `define-software-factory-v1` says each action of the view either opens a link or copies a command ("Started on demand and read-only"). "Force refresh" and "Start in Orca" already do neither, and each states that it changes no ticket. The joke button is in the same position.
- Two layout rules in `openspec/specs/factory-view/spec.md` apply to anything added. The page never scrolls sideways ("The Board fits the screen"). At 720px and wider the run detail drawer starts at the bottom of the header and never covers it ("Run detail opens as a drawer"). The drawer reads the header's bottom edge on scroll and on resize only (`useBelowHeader` in `view/src/components/RunDetailPanel.tsx`), so today it does not follow a header that grows for another reason.
- `__root.tsx` has no browser test. The layout tests in `view/src/components/BoardLayout.test.tsx` build a header by hand (`PageWithHeader`) around `HeaderStatus`.
- The built dashboard `view/.output/` is committed and ships with the engine. `tests/view-build.test.ts` checks its version stamp, not its contents.
- `pnpm test`, which is the factory's `test` check, runs `tests/**` only. The dashboard's browser tests run with `pnpm test:view`. In this repository `factory view` runs the engine installed under `.factory/`, not this checkout's build.

## Goals / Non-Goals

**Goals:**
- A button in the dashboard header that displays a joke when pressed, and does nothing else.

**Non-Goals:**
- Any change to tickets, to the view data in `src/view/`, to the CLI or to the ticket providers.
- Any change to the Board's columns and cards, the contents of the run detail drawer, the Needs you page or the Health page.
- A setting to turn the button off, or to change its jokes, per project.
- Storing the joke or the place in the list, in the browser or in the address.

## Decisions

D-001 to D-004 are answered by the ticket and by the repository. D-005 to D-008 are the owner's answers, given on 2026-11-24, to the four questions the first draft left open.

### D-001: The button only shows a joke

- **Question:** Does pressing the button do anything besides displaying a joke?
- **Decision:** No. Pressing it changes no ticket status, label or comment, starts no refresh or reload of the board, and leaves the tickets, items and figures on the Board, the Needs you page and the Health page as they were.
- **Answered by:** the ticket, which calls it a dummy button, and the view's read-only rule, which "Force refresh reloads the board" and "Start a card's command in a new Orca worktree" each repeat for their own button.
- **Effect on the spec:** requirement "The joke button changes nothing else" and its scenario. Tasks 2.5 and 5.1.

### D-002: No joke before the first press

- **Question:** Does the dashboard show a joke before the button is pressed?
- **Decision:** No. The joke appears when the button is pressed.
- **Answered by:** the ticket: "display a joke once clicked".
- **Effect on the spec:** the first sentence of "Each press shows the next joke", and its scenario "Before the first press". Task 1.1.

### D-003: The joke is shown in full and never widens the page

- **Question:** What happens to a joke that is wider than the window?
- **Decision:** It wraps onto more lines. The whole joke stays readable, with no ellipsis, and the page does not scroll sideways.
- **Answered by:** "The Board fits the screen", which says the page does not scroll sideways at any width, and the ticket: a joke cut short is not displayed.
- **Effect on the spec:** the second sentence of "The joke stays under the button until the next press", and its scenario "Joke on a narrow window". Tasks 2.3 and 5.2.

### D-004: The requirements are added to `factory-view`

- **Question:** Does the button belong to a new capability or to `factory-view`?
- **Decision:** `factory-view`, as four added requirements. Every other dashboard behaviour lives there, and a single button does not make a capability.
- **Answered by:** the layout of `openspec/specs/`.
- **Effect on the spec:** one delta spec, `specs/factory-view/spec.md`, with added requirements only.

### D-005: The button sits in the header, to the right of "Force refresh"

- **Question:** Where does the button sit, and on which pages?
- **Decision:** In the header, to the right of "Force refresh". It therefore shows on the Board, the Needs you page and the Health page, in every project and with sample data alike. Like "Force refresh", it is not shown when the dashboard could not start. Where the header is too narrow to show the freshness line and both buttons on one line, the joke button still comes after "Force refresh", beside it or on the next line.
- **Answered by:** the owner, who took the recommended answer. The narrow header follows from "The Board fits the screen", which allows no sideways scroll at any width: on the sample data the freshness line and the two buttons need about 540px of window to share a line.
- **Alternatives:** On the Board only, above the columns. That hides the button on two of the three pages and adds an element to the Board's own layout rules.
- **Effect on the spec:** requirement "Joke button in the dashboard header" and its four scenarios. Tasks 2.1 to 2.3, 5.1 and 5.3.

### D-006: The button reads "Tell me a joke"

- **Question:** What does the button read?
- **Decision:** "Tell me a joke", before and after a press.
- **Answered by:** the owner, who took the recommended answer.
- **Alternatives:** "Joke"; or a label that becomes "Another one" after the first press, which adds a state for no gain.
- **Effect on the spec:** every requirement names the button by this label. "Joke button in the dashboard header" says it never changes, and the scenario "First press" checks it. Tasks 1.1 and 1.2.

### D-007: Five built-in jokes, shown in order

- **Question:** Which jokes can a press show, and which one does each press show?
- **Decision:** Five jokes built into the dashboard, in English, listed in the requirement "Each press shows the next joke". The first press shows the first joke, each further press shows the next one, and a press after the fifth shows the first again. No request is sent to any service. The jokes ship in the dashboard's page, so a press does not call the dashboard's own server either, and the button is never disabled and has no loading or error state.
- **Answered by:** the owner, who took the recommended answer.
- **Alternatives:** One joke only, after which a second press looks like a button that does nothing. A random pick, which can show the same joke twice in a row and needs its randomness controlled in tests. A public joke service, which adds a network call, a wait, an error state, and a data source other than the ticket providers.
- **Effect on the spec:** requirement "Each press shows the next joke" and its five scenarios. Tasks 1.2, 1.3 and 1.5.

### D-008: The joke shows under the button and stays until the next press

- **Question:** Where does the joke appear, and how long does it stay?
- **Decision:** As a line of text under the button, in the header, announced to screen readers as a status message. It stays until the next press replaces it, and there is no close button. Changing page, the automatic refresh and "Force refresh" leave it in place, and they do not change which joke comes next. Reloading the page clears it. Nothing is stored, so the first press after a reload shows the first joke again. The button does not move when a joke appears or changes: the header grows downward by the joke's height, and at 720px and wider the run detail drawer follows the header's height and never covers it.
- **Answered by:** the owner, who took the recommended answer, including that the drawer follows the header's height. That the button stays in place follows from D-007 and from a measurement: the header's right side is aligned on its bottom edge, so a line added inside it would push the buttons up by 26px on the first press, and a second press at the same spot would usually land under the button and show no next joke.
- **Alternatives:** A dialog the person closes; a line under the header's rule, which the drawer would partly cover; or a joke that disappears after a few seconds.
- **Effect on the spec:** requirement "The joke stays under the button until the next press" and its seven scenarios. Tasks 1.4, 1.6, 2.2 to 2.4, 3.1, 3.2, 5.1 and 5.2.

## Implementation notes

These follow from the decisions above and the repository's conventions.

- **State.** `view/src/components/JokeButton.tsx` holds the five jokes as a constant, in the spec's order, and keeps the place in the list in `useState`, with no joke before the first press. A press moves to the next joke and wraps after the fifth. It takes nothing from the page and calls nothing, which is what keeps D-001 and D-007 true. No dependency is added.
- **Button.** `__root.tsx` renders the button after `HeaderStatus`, in the branch shown when the dashboard loaded, and outside the "Board freshness" group. `HeaderStatus` and the button share one container on the header's right side, so that the header's first row still has two sides to push apart.
- **Joke line.** The line takes no room until the first press, and no empty line is reserved for it. It must not sit inside the bottom-aligned side that holds the buttons, or the buttons move up when it appears (D-008). The simplest layout that keeps them in place makes the line the last row of the header, under both of its sides, with its text ending at the header's right edge: the header then grows downward by the joke's height. How the button and the line share the state, as one component whose wrapper is laid out with `display: contents` or as two parts under a small provider, is the builder's choice, as long as the tests render them as the header does.
- **Status message.** The joke line is an element with `role="status"`, so that screen readers announce the joke when it appears or changes.
- **Lifetime.** The root layout stays mounted while the person moves between pages and while the poll or "Force refresh" reloads the data, so the state survives both. A page reload starts it again, empty. Nothing is written to storage or to the address.
- **Drawer.** `useBelowHeader` in `RunDetailPanel.tsx` also observes the header with a `ResizeObserver`, and places the drawer when the header's size changes, as it does on scroll and on resize.
- **Styles.** In `view/src/styles.css`: the button reuses `.button` at the size of `.force-refresh`, and the joke line wraps and never exceeds the header's width.
- **Tests.** The joke's layout tests use their own header fixture next to `PageWithHeader` in `BoardLayout.test.tsx`, so the existing drawer tests stay as they are.
- **Build.** `view/.output/` is rebuilt with `pnpm build:view` and committed with the change.

## Risks / Trade-offs

- [The header gets taller by the joke's height on the first press, which moves the page's content down once per page load] → The page's scroll position is not touched, the buttons stay where they are, and the drawer follows the header (task 3.1).
- [On the sample data, between about 825px and 940px wide, the freshness line and the two buttons no longer fit beside the tabs, so they sit under them and the header is 48px taller than today, before any press] → This is the header's existing wrapping. No layout rule is broken: the page does not scroll sideways and the Board's own rules are unchanged.
- [`__root.tsx` has no browser test, so the button's place in the real header, its absence when the dashboard could not start, and the joke surviving a change of page are only seen in the running app] → Tasks 5.1 to 5.3 check them in this checkout's built dashboard. The component and layout tests cover the rest, with a header built like the real one.
- [The `ResizeObserver` also fires when the header's size changes for another reason, such as a longer stale line] → It runs the same placement as the scroll listener, and the drawer following the header there too is the existing rule applied.
- [The `HeaderStatus` tests and the drawer tests expect one status message in their header] → The joke line is outside the "Board freshness" group, and the joke's layout tests use their own header fixture.
- [The factory's `test` check does not run the dashboard's browser tests] → Task 4.2 runs `pnpm test:view`.
- [A dashboard build that was not rebuilt still passes `tests/view-build.test.ts`, because the engine version did not change] → Task 4.1 looks for the button in the built files, and task 5.1 presses it in the built dashboard.
- [The button ships to every project with the next engine release, although it is a dummy] → It changes nothing and reads nothing, and it is four requirements and one component to remove.

## Affected paths

- `view/src/components/JokeButton.tsx`
- `view/src/components/JokeButton.test.tsx`
- `view/src/components/BoardLayout.test.tsx`
- `view/src/components/RunDetailPanel.tsx`
- `view/src/routes/__root.tsx`
- `view/src/styles.css`
- `view/.output/**`

## Open Questions

None.
