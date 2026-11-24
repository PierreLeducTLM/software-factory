# Proposal

## Why

When you open a ticket on the Board, the detail panel shows the command to run next, such as `/factory-refine PIE-21` or `/factory-run PIE-21`, with a "Copy command" button. To act on it, you open a new Orca worktree by hand, start Claude in it and paste the command. Orca's `orca worktree create` can do all of that in one call. PIE-21 asks for a button on the dashboard that starts the command in a new Orca worktree directly.

## What Changes

- The Board's run detail panel shows a "Start in Orca" button next to "Copy command" on every card that has a command, except when the card's run is on this machine. That card keeps "Open in Orca", which returns to the worktree the run lives in (D-001).
- Pressing it creates a new Orca worktree for the ticket and starts Claude in it with the card's command as its prompt. Orca comes to the front on the new worktree.
- The worktree is named after the ticket key in lowercase, such as `pie-21`. Every press creates a new worktree, never reusing an existing one, and Orca suffixes a branch name that is taken. The worktree is linked to the ticket: `--linear-issue` for Linear, `--reference` for Jira (D-002).
- On a card whose command is `/factory-next`, the button starts `/factory-run <card key>`, so it builds the ticket you clicked. The copy box still shows `/factory-next` (D-003).
- While Orca is starting the worktree, the button is disabled and reads "Starting in Orca…". On success the panel shows `Started in Orca: <worktree>` and the button stays disabled while the panel is open. On failure the panel shows `Orca could not start <KEY>: <Orca's message>` and the button is enabled again (D-004).
- The dashboard server checks the ticket at the moment of the press. When the card has no command any more or its run is now on this machine, nothing starts and the panel shows `Orca could not start <KEY>: <KEY> has nothing to start in a new worktree.` (D-007). When the card's command differs from the one the panel showed, nothing starts and the panel shows `Orca could not start <KEY>: <KEY> changed since this panel opened. Reopen it to see what to run.` (D-008).
- Claude starts with your own Orca settings for model, effort and surface. Setup hooks follow the repository's setup policy, and the worktree starts from the repository's default base branch (D-005).
- The Needs you page is unchanged. In sample mode (`FACTORY_VIEW_SAMPLE=1`), the button fails with `Orca could not start <KEY>: This is sample data, with no Orca session behind it.` (D-006).
- The button changes no ticket. Moving the ticket is still done by the command Claude runs in the new worktree.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-view`: adds the requirement "Start a card's command in a new Orca worktree".

## Impact

- Orca adapter: a worktree-starting call next to `createOrcaWorktreeOpener` in `src/adapters/orca-agent-runtime.ts`, wired in `src/cli/real-deps.ts`.
- View data: `ViewSource` in `src/view/source.ts` gains a start action that works out the prompt, name and ticket link from the ticket; the sample source in `src/view/demo.ts` refuses it.
- Dashboard: a POST server function in `view/src/server/functions.ts`, wired through `view/src/routes/index.tsx` and `view/src/components/BoardScreen.tsx`; a new button component shown by `view/src/components/RunDetailPanel.tsx`.
- Tests: `tests/orca-agent-runtime.test.ts`, `tests/view-source.test.ts`, `tests/view-demo.test.ts`, and browser tests under `view/src/components/`.
- No change to the ticket providers, the factory comment, the CLI or the Needs you page.
