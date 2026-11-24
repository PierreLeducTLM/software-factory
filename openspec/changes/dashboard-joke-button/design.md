# Design

## Context

See proposal.md for the motivation. The ticket has no description. Its title settles a button, on the dashboard, that displays a joke when clicked, and calls it a dummy. Today:

- The dashboard is the app under `view/`. `view/src/routes/__root.tsx` renders the header on every page: the title, the tabs, and `HeaderStatus`, which holds the freshness line and "Force refresh". Under it comes the page: Board (`/`), Needs you (`/needs-you`) or Health (`/health`). When the view data cannot be loaded, the header keeps the title and the tabs only, and the page reads "The factory view could not start".
- A button is a small component under `view/src/components/` that keeps its own state with `useState` and has a browser test next to it (`ForceRefresh.tsx`, `StartInOrca.tsx`, `CopyCommand.tsx`). A button reports its result as text beside it, with `role="status"`, as "Started in Orca: pie-21" does. The dashboard has no dialog, popover or toast.
- The view is read-only: no button changes a ticket. The page's data is loaded again by the poll in `__root.tsx` and by "Force refresh".
- The open change `define-software-factory-v1` says each action of the view either opens a link or copies a command ("Started on demand and read-only"). "Force refresh" and "Start in Orca" already do neither, and each states that it changes no ticket. The joke button is in the same position.
- Two layout rules in `openspec/specs/factory-view/spec.md` apply to anything added. The page never scrolls sideways ("The Board fits the screen"). At 720px and wider the run detail drawer starts at the bottom of the header and never covers it ("Run detail opens as a drawer"). The drawer reads the header's bottom edge on scroll and on resize only (`useBelowHeader` in `view/src/components/RunDetailPanel.tsx`).
- The built dashboard `view/.output/` is committed and ships with the engine. `tests/view-build.test.ts` checks its version stamp, not its contents.
- `pnpm test`, which is the factory's `test` check, runs `tests/**` only. The dashboard's browser tests run with `pnpm test:view`.

## Goals / Non-Goals

**Goals:**
- A button on the dashboard that displays a joke when pressed, and does nothing else.

**Non-Goals:**
- Any change to tickets, to the view data in `src/view/`, to the CLI or to the ticket providers.
- Any change to the Board's columns and cards, the contents of the run detail drawer, the Needs you page or the Health page.
- A setting to turn the button off, or to change its jokes, per project.

## Decisions

The ticket and the repository answer these. Nobody was asked. What they could not answer is under Open Questions.

### D-001: The button only shows a joke

- **Question:** Does pressing the button do anything besides displaying a joke?
- **Decision:** No. Pressing it changes no ticket status, label or comment, starts no refresh or reload of the board, and leaves the tickets, items and figures on the Board, the Needs you page and the Health page as they were.
- **Answered by:** the ticket, which calls it a dummy button, and the view's read-only rule, which "Force refresh reloads the board" and "Start a card's command in a new Orca worktree" each repeat for their own button.
- **Effect on the spec:** the requirement's sentence on the dummy button, and the scenario "Pressing the button changes nothing else". Task 1.3.

### D-002: No joke before the first press

- **Question:** Does the dashboard show a joke before the button is pressed?
- **Decision:** No. The joke appears when the button is pressed.
- **Answered by:** the ticket: "display a joke once clicked".
- **Effect on the spec:** the scenario "Before the first press". Task 1.1.

### D-003: The joke is shown in full and never widens the page

- **Question:** What happens to a joke that is wider than the window?
- **Decision:** It wraps onto more lines. The whole joke stays readable, with no ellipsis, and the page does not scroll sideways.
- **Answered by:** "The Board fits the screen", which says the page does not scroll sideways at any width, and the ticket: a joke cut short is not displayed.
- **Effect on the spec:** the requirement's last sentence, and the scenario "Joke on a narrow window". Task 2.1.

### D-004: One requirement added to `factory-view`

- **Question:** Does the button belong to a new capability or to `factory-view`?
- **Decision:** `factory-view`, as one added requirement, "Joke button shows a joke". Every other dashboard behaviour lives there, and a single button does not make a capability.
- **Answered by:** the layout of `openspec/specs/`.
- **Effect on the spec:** one delta spec, `specs/factory-view/spec.md`, with added requirements only.

## Open Questions

Each question is about behaviour a person can observe that neither the ticket nor the repository settles. Until they are answered, the delta spec and the tasks say nothing about these points.

- **Q1. Where does the button sit, and on which pages?** "On the dashboard" does not say. The dashboard has one header, shared by its three pages: Board, Needs you and Health.
  - Recommended answer: in the header, to the right of "Force refresh", so that it shows on the Board, the Needs you page and the Health page, in every project and with sample data alike. Like "Force refresh", it is not shown when the dashboard could not start.
  - Why: the header is the only place every page shares, and "Force refresh" is the precedent for a button that belongs to the dashboard and not to one page. The Board's own layout rules are left alone. Sitting after "Force refresh" keeps that button "next to the freshness line", as its requirement says.
  - Other answers: on the Board only, above the columns.
  - Once answered: the requirement names the place and the pages, the scenario "Before the first press" names them too, and the design says which file renders the button.

- **Q2. What does the button read?**
  - Recommended answer: "Tell me a joke", and it reads the same after a press.
  - Why: it says what a press does, in the plain wording of the other buttons ("Force refresh", "Copy command", "Start in Orca"). A label that changes after the first press adds a state for no gain.
  - Other answers: "Joke"; or "Tell me a joke", then "Another one" after the first press.
  - Once answered: the requirement and its scenarios name the label.

- **Q3. Which jokes can a press show, and which one does each press show?**
  - Recommended answer: five jokes built into the dashboard, in English like the rest of it. The first press shows the first joke, each further press shows the next one, and a press after the fifth shows the first again. No request is made to any service, so the button is never disabled and has no loading or error state. The jokes, in order:
    1. Why do programmers prefer dark mode? Because light attracts bugs.
    2. There are 10 kinds of people: those who understand binary and those who don't.
    3. A SQL query walks into a bar, goes up to two tables and asks: may I join you?
    4. Why did the pull request go to therapy? It had too many unresolved conflicts.
    5. Why did the developer go broke? Because they used up all their cache.
  - Why: built-in jokes keep the dashboard working offline and reading nothing but the ticket providers, which "Ticket provider is the only data source" in `define-software-factory-v1` asks of every screen. A fixed order means every press changes the joke, and it can be tested without controlling randomness. With a single joke, a second press would look like a button that does nothing.
  - Other answers: one joke only; a random pick in the list, which can show the same joke twice in a row; or jokes fetched from a public joke service, which adds a network call, a wait and an error state to a dummy button.
  - Once answered: the requirement lists the jokes and their order, with scenarios for the first press, the next press and the press after the last joke.

- **Q4. Where does the joke appear, and how long does it stay?**
  - Recommended answer: as a line of text under the button, in the header if Q1 is answered as recommended, announced to screen readers as a status message. It stays until the next press replaces it. Moving between the Board, the Needs you page and the Health page, the automatic refresh and "Force refresh" leave it in place. Reloading the page clears it. There is no close button.
  - Why: the dashboard already reports what a button did as text beside it ("Started in Orca: pie-21"), and it has no dialog or toast to reuse. Text in the header stays visible while the run detail drawer is open; a line under the header would be partly covered by it. Nothing is stored, in line with "No local database" in `define-software-factory-v1`.
  - Other answers: a dialog the person closes; a line under the header's rule, above the page; or a joke that disappears after a few seconds.
  - Once answered: the requirement says where the joke shows and when it goes away, with scenarios for a second press, a change of page, a refresh and a reload. If the joke is in the header, a task makes the drawer follow the header's height (see Risks).

## Implementation notes

These follow the repository's conventions and change no observable behaviour.

- The button is a component under `view/src/components/`, written test-first with a browser test next to it, as `ForceRefresh.tsx` is. Its state lives in `useState`. No dependency is added.
- Its styles go in `view/src/styles.css` and reuse `.button`.
- `view/.output/` is rebuilt with `pnpm build:view` and committed with the change.
- Which file renders the component, and whether `RunDetailPanel.tsx` changes, follow from Q1 and Q4.

## Risks / Trade-offs

- [A joke displayed in the header makes the header taller, and an open drawer would overlap it until the next scroll or resize, against "Run detail opens as a drawer"] → If Q1 and Q4 put the joke in the header, `useBelowHeader` also follows changes of the header's size, and a layout test presses the button with the drawer open at 1440px.
- [The `HeaderStatus` tests expect one status message in the "Board freshness" group] → The joke is rendered outside that group.
- [The factory's `test` check does not run the dashboard's browser tests] → Task 3.2 runs `pnpm test:view`.
- [A dashboard build that was not rebuilt still passes `tests/view-build.test.ts`, because the engine version did not change] → Task 3.1 looks for the button in the built files, and task 3.3 presses it in the built dashboard.
- [The button ships to every project with the next engine release, although it is a dummy] → It changes nothing and reads nothing, and it is one requirement and one component to remove.

## Affected paths

The last two entries hold if Q1 and Q4 are answered as recommended. The list is corrected when they are answered.

- `view/src/components/JokeButton.tsx`
- `view/src/components/JokeButton.test.tsx`
- `view/src/components/BoardLayout.test.tsx`
- `view/src/styles.css`
- `view/.output/**`
- `view/src/routes/__root.tsx`
- `view/src/components/RunDetailPanel.tsx`
