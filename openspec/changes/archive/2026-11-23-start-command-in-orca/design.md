# Design

## Context

See proposal.md for the motivation. Today:

- `commandFor` and the Needs you reasons in `src/view/model.ts` give each card its command. Every command is a Claude slash command: `/factory-refine KEY`, `/factory-run KEY`, `/factory-run KEY --over-limit` or `/factory-next`. A card in Build, Review or PR that is not interrupted has none.
- `RunDetailPanel` shows "Open in Orca" when `card.onThisMachine`, and `CopyCommand` when the card has a command.
- "Open in Orca" goes browser → `openRun` server function → `ViewSource.openInOrca(key)` → `openWorktree(worktreeId)`, which `createOrcaWorktreeOpener` in `src/adapters/orca-agent-runtime.ts` turns into `orca worktree activate --worktree id:<id> --json`. The view source looks the run up from the ticket itself and returns `{ ok: true }` or `{ ok: false, message }`. The sample source rejects with "This is sample data, with no Orca session behind it."
- `askOrca` in the same adapter runs `orca ... --json` and parses Orca's `{ ok, result | error }` envelope. `orca worktree create --json` answers with `result.worktree` (`id`, `path`, `branch`, `hostId`).
- `factory run` refuses outside an Orca worktree (`no_worktree`) and in a worktree that already hosts a run (`worktree_busy`). A new worktree per start fits both.

## Goals / Non-Goals

**Goals:**
- One click on a Board card turns its command into a Claude session in a new Orca worktree.

**Non-Goals:**
- Starting the command in an existing worktree (`orca agent launch`).
- Choosing model, effort, surface, base branch or host from the dashboard.
- Any change to the Needs you page, the ticket or the factory comment.
- Remote Orca environments: the dashboard calls the local `orca` command, as "Open in Orca" does.

## Decisions

### D-001: The button is on every card with a command, except a run on this machine

- **Question:** Which cards get "Start in Orca"? Every command on the board is a Claude command, but an interrupted run on this machine already has "Open in Orca", and starting its `/factory-run` in a new worktree would resume the run from a different checkout than the one holding its work.
- **Decision:** Every card with a command shows the button, except a card whose run is on this machine (`card.onThisMachine`). That card keeps "Open in Orca" only. A run claimed on another machine gets the button, since starting it here is a takeover in a fresh worktree.
- **Alternatives:** Showing it on every card with a command, no exceptions, makes resuming a local run from the wrong checkout one click away.
- **Effect on the spec:** scenarios "Button on a card with a command", "Run on this machine keeps Open in Orca", "Run on another machine can be started here", and "Card without a command". Tasks 2.1, 2.2 and 4.1.

### D-002: The worktree is named after the ticket key, always new, and linked to the ticket

- **Question:** What is the new worktree called, what happens on a second start for the same ticket, and how is it tied to the ticket?
- **Decision:** The name is the ticket key in lowercase (`pie-21`), matching the project's existing worktree convention. Every start creates a new worktree; when the branch name is taken, Orca's numeric suffix applies. The ticket is linked with `--linear-issue <KEY>` for a Linear ticket and `--reference <KEY>` for a Jira ticket, chosen from the card's provider.
- **Alternatives:** Reusing an existing worktree for the ticket needs a lookup and risks `worktree_busy` when that worktree already hosts a run.
- **Effect on the spec:** scenarios "Start a refinement in Orca", "Jira ticket is linked as a reference" and "A second start for the same ticket gets a new worktree". Tasks 1.1 and 2.1.

### D-003: A `/factory-next` card starts `/factory-run <card key>`

- **Question:** `/factory-next` picks the oldest eligible ticket at run time, which may not be the card clicked. Which prompt does the button start?
- **Decision:** `/factory-run <card key>`, so the button builds the ticket you clicked and the worktree's name and link match what runs in it. The copy box still shows `/factory-next`.
- **Alternatives:** Starting `/factory-next` keeps the copy box and the button identical, but can build a different ticket in a worktree named after the clicked one.
- **Effect on the spec:** scenario "A next card builds the ticket clicked". Task 2.1.

### D-004: Starting, started and failed states, with no double start

- **Question:** What does the panel show after the click, and what stops a double click from creating two worktrees?
- **Decision:** While Orca answers, the button is disabled and reads "Starting in Orca…". On success, Orca comes to the front (`--activate`), the panel shows `Started in Orca: <worktree>`, and the button stays disabled for as long as the panel stays open. Closing and reopening the card enables it again. On failure, the panel shows `Orca could not start <KEY>: <message>` and the button is enabled again. `<worktree>` is the name of the worktree Orca created: the last segment of `result.worktree.path`, which carries Orca's suffix when one was added.
- **Alternatives:** Re-enabling the button after success makes a duplicate worktree one stray click away.
- **Effect on the spec:** scenarios "Start in progress", "No second start while the panel stays open" and "Orca fails to start the worktree". Tasks 3.1 and 3.2.

### D-005: Claude starts with the person's Orca settings and the repository's defaults

- **Question:** Does the dashboard pass a model, effort, surface, setup policy or base branch?
- **Decision:** None of them. The call passes `--agent claude` and no `--model`, `--effort`, `--surface`, `--setup` or `--base-branch`, so the person's Orca settings for Claude, the repository's setup policy and its default base branch apply, exactly as a new agent tab would.
- **Effect on the spec:** the requirement text on settings and defaults. Task 1.1.

### D-006: Board panel only; sample mode fails clearly

- **Question:** Does the Needs you page get the button too, and what does sample mode do?
- **Decision:** Only the Board's detail panel gets the button. The Needs you page keeps "Copy command" only and its promise that it changes nothing; its items are one click away on the Board's Needs you column, which opens the same panel. In sample mode the start is refused with `Orca could not start <KEY>: This is sample data, with no Orca session behind it.`, as "Open in Orca" is today.
- **Effect on the spec:** scenarios "Needs you page has no start button" and "Sample data has no Orca behind it". Tasks 2.3 and 4.1.

### D-007: A card that can no longer be started is refused

- **Question:** The panel can be older than the ticket: between two board refreshes, the run may have been claimed on this machine or the ticket may have lost its command. The server works the prompt out from the ticket's current state. What happens when that state no longer allows a start?
- **Decision:** No worktree is created. The panel shows `Orca could not start <KEY>: <KEY> has nothing to start in a new worktree.` and the button is enabled again, as for any failure. The next board refresh shows the card's real state.
- **Alternatives:** Starting whatever the ticket allows now is more forgiving, but a click could launch something other than what was on screen.
- **Effect on the spec:** scenario "The card can no longer be started". Task 2.2.

### D-008: A card whose command changed is refused

- **Question:** Between two board refreshes the card's command can change while still existing, for example from `/factory-refine PIE-21` to `/factory-run PIE-21` after approval. Does the button start the new command?
- **Decision:** No, consistent with D-007. The browser sends the command the panel showed along with the key. When the ticket's current command differs, no worktree is created and the panel shows `Orca could not start <KEY>: <KEY> changed since this panel opened. Reopen it to see what to run.` The command sent is only compared; the prompt is still worked out by the server from the ticket. On a `/factory-next` card the comparison is against `/factory-next`, the command shown, not the `/factory-run <KEY>` prompt (D-003).
- **Alternatives:** Starting the current command launches something other than what was on screen.
- **Effect on the spec:** scenario "The card's command changed". Tasks 2.2, 3.1 and 4.2.

## Implementation notes

These follow from the decisions above and the repository's conventions; none changes observable behaviour.

- **Orca call.** A `createOrcaWorktreeStarter({ run })` next to `createOrcaWorktreeOpener` runs, through `demandOfOrca`:
  `orca worktree create --repo path:<project dir> --name <name> --no-parent <--linear-issue|--reference> <KEY> --agent claude --prompt <prompt> --activate --json`
  and returns the created worktree's name. `--repo path:<project dir>` targets the project `factory view` serves (`FACTORY_PROJECT_DIR` or the current directory) instead of relying on Orca inferring it. `--no-parent` keeps Orca from recording the new worktree as a child of whatever worktree the dashboard server was started from. The command runs through `execFile` with an argument array, so the prompt never goes through a shell.
- **Server decides.** `ViewSource.startInOrca({ key, command })` refreshes as `openInOrca` does, rebuilds the card from the ticket, refuses with `<KEY> has nothing to start in a new worktree.` when the card has no command or its run is on this machine (D-007), and with `<KEY> changed since this panel opened. Reopen it to see what to run.` when the card's command is not the `command` sent (D-008). Otherwise it works out the prompt (D-003), the name and link (D-002), and calls the starter. The browser sends only the key and the command it showed, and the command is only compared. Errors become `{ ok: false, message: 'Orca could not start <KEY>: <message>' }`; success is `{ ok: true, worktree }`.
- **Dashboard.** A `startRun` POST server function mirrors `openRun`, taking `{ key, command }`. A `StartInOrca` component, keyed by the card key like `OpenInOrca`, owns the idle / starting / started / failed state, so closing the panel or switching cards resets it.

## Risks / Trade-offs

- [The worktree name shown is read from the worktree path; if Orca ever lays out paths differently, the message shows a different segment] → The path's last segment is the worktree folder Orca creates today; the adapter test pins the parsing, and the end-to-end check in task 5.1 confirms it on a real Orca.
- [Orca setup hooks can make a start take tens of seconds] → The button reads "Starting in Orca…" and stays disabled for the whole wait.
- [Starting on a run claimed on another machine leads to a takeover] → `factory run` itself asks for `--confirm-takeover` in the new session, so nothing is taken over without a person's yes.
- [The project is not added to Orca] → Orca's error is shown as is, after "Orca could not start <KEY>:".

## Affected paths

- `src/adapters/orca-agent-runtime.ts`
- `src/cli/real-deps.ts`
- `src/view/source.ts`
- `src/view/demo.ts`
- `view/src/server/functions.ts`
- `view/src/routes/index.tsx`
- `view/src/components/BoardScreen.tsx`
- `view/src/components/RunDetailPanel.tsx`
- `view/src/components/StartInOrca.tsx`
- `view/src/components/StartInOrca.test.tsx`
- `view/src/components/Board.test.tsx`
- `view/src/components/fixtures.ts`
- `view/src/styles.css`
- `tests/orca-agent-runtime.test.ts`
- `tests/view-source.test.ts`
- `tests/view-demo.test.ts`

## Open Questions

None.
