# Proposal

## Why

PIE-24 asks for a dummy button on the dashboard that displays a joke once clicked. The button has no job in the factory: it changes nothing and only shows a joke.

The ticket has no description. Its title settles the button, the joke and the word "dummy" (D-001 to D-004). The owner settled the rest by answering four questions (D-005 to D-008).

## What Changes

- The dashboard header shows a "Tell me a joke" button to the right of "Force refresh", on the Board, Needs you and Health pages, in every project and with sample data. It is not shown when the dashboard could not start (D-005).
- The button always reads "Tell me a joke" and is always enabled (D-006).
- No joke is shown before the first press (D-002). Each press shows the next of five jokes built into the dashboard, in a fixed order, and a press after the fifth shows the first again. No request is sent to any service, so the button has no loading or error state (D-007).
- The joke shows as a line of text under the button, announced to screen readers as a status message. It stays until the next press replaces it: changing page, the automatic refresh and "Force refresh" leave it in place, reloading the page clears it, and there is no close button (D-008).
- A joke can be read in full and never makes the page scroll sideways (D-003). The button stays where it is when a joke appears: the header grows downward, and the run detail drawer follows the header and never covers it (D-008).
- The button is a dummy. Pressing it changes no ticket, starts no refresh or reload of the board, and leaves what the Board, the Needs you page and the Health page show as it was (D-001).
- Unchanged: the Board, the contents of the run detail drawer, the Needs you page, the Health page and "Force refresh". The view stays read-only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-view`: adds the requirements "Joke button in the dashboard header", "Each press shows the next joke", "The joke stays under the button until the next press" and "The joke button changes nothing else" (D-004).

## Impact

- Dashboard: a new button component with its browser test under `view/src/components/`, rendered in the header by `view/src/routes/__root.tsx`; `view/src/components/RunDetailPanel.tsx`, so that the drawer follows the header's height; `view/src/styles.css`; and layout tests in `view/src/components/BoardLayout.test.tsx`.
- The committed dashboard build `view/.output/` is rebuilt. It ships with the engine, so every project that installs the next release gets the button.
- No change to the view data in `src/view/`, the CLI, the ticket providers or the factory comment.
