# Proposal

## Why

PIE-24 asks for a dummy button on the dashboard that displays a joke once clicked. The button has no job in the factory: it changes nothing and only shows a joke.

The ticket has no description, so its title is all that is settled. Where the button sits, what it reads, which jokes it shows, and where the joke appears are open questions in design.md (Q1 to Q4). This proposal, the delta spec and the tasks state only what the ticket and the repository already answer.

## What Changes

- The dashboard shows a joke button. Its place and its label are open (Q1, Q2).
- Pressing the button displays a joke on the dashboard. No joke is shown before the first press (D-002). Which jokes, in which order, where the joke appears and how long it stays are open (Q3, Q4).
- The button is a dummy. Pressing it changes no ticket, starts no refresh or reload of the board, and leaves what the Board, the Needs you page and the Health page show as it was (D-001).
- A displayed joke can be read in full and never makes the page scroll sideways (D-003).
- Unchanged: the Board, the run detail drawer, the Needs you page, the Health page and "Force refresh". The view stays read-only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-view`: adds the requirement "Joke button shows a joke" (D-004).

## Impact

- Dashboard: a new button component with its browser test under `view/src/components/`, rendered by the dashboard's layout or by one of its pages under `view/src/routes/` (Q1 decides which), and `view/src/styles.css`.
- The committed dashboard build `view/.output/` is rebuilt. It ships with the engine, so every project that installs the next release gets the button.
- No change to the view data in `src/view/`, the CLI, the ticket providers or the factory comment.
