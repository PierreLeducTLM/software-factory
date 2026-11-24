# Design

## Context

See proposal.md for the motivation. Today:

- `view/src/server/source.ts` builds one `ViewSource` per `factory view` process and keeps it for the process lifetime. The configuration and providers are read once.
- `ViewSource.load` (`src/view/source.ts`) calls `fresh()`, which skips the refresh when the last attempt was less than `view.poll_seconds` ago.
- `ViewStore.refresh` (`src/view/store.ts`) does a full read (every open status, plus Done updated in the last 7 days) only when it has never refreshed. After that it asks for tickets `updatedSince` the last refresh and merges them into the snapshot. A ticket that no longer comes back from the provider is never removed.
- On failure, the store keeps its tickets and sets `staleSince` and `problem`. `Freshness` renders them as "Stale since <time> UTC · <problem> · retrying".
- The browser polls with `router.invalidate()` every `pollSeconds` (`view/src/routes/__root.tsx`). Board, Needs you and run detail all read from the same snapshot. Health reads the providers directly on each load.

## Goals / Non-Goals

**Goals:**
- One click brings the board back in line with the ticket providers, without restarting `factory view`.

**Non-Goals:**
- Reloading `.factory/config.yaml` or rebuilding the providers.
- Changing the automatic poll interval or how polling works.
- Changing the Health page, which already reads live.

## Decisions

### D-001: Force refresh is a full reload, not an early poll

- **Question:** What should "repopulate the board data" do: only skip the poll wait, reload all tickets from the providers, or also re-read the project configuration?
- **Decision:** A full reload. It ignores the poll interval, discards the tickets the store holds, and reads every tracked ticket again with the same queries as the first load: every open status, plus Done tickets updated in the last 7 days. The configuration and the providers are not rebuilt. Restarting `factory view` remains the way to pick up config changes.
- **Alternatives:** An early incremental poll fixes the wait but leaves ghost tickets on the board. Re-reading the config means rebuilding the source in a running process, which a restart already does.
- **Effect on the spec:** requirement "Force refresh reloads the board", scenarios "Force refresh removes a ticket that left the board" and "Force refresh ignores the poll interval". Tasks 1.1, 1.2 and 2.1.

### D-002: The button is always visible, in the header

- **Question:** Is the button only for developers of the factory (dev build or `--sample`), or always visible?
- **Decision:** Always visible, in the dashboard header next to the freshness line, so it is on Board, Needs you and Health alike. Ghost tickets affect every user, not only developers. The button changes no ticket, so the view stays read-only.
- **Alternatives:** Showing it only in dev or sample mode keeps the header quieter, but leaves users with ghost cards and needs a definition of "dev mode".
- **Effect on the spec:** scenario "Button on every page". Task 3.1.

### D-003: A failed reload behaves like a failed poll

- **Question:** What does the board show when the forced reload fails, for example because the provider is unreachable?
- **Decision:** The board keeps the tickets it had before the click, and the freshness line shows "Stale since <time> UTC · <problem> · retrying", as for a failed poll. The next automatic poll, or another click, retries. Because the reload only replaces the snapshot after it succeeds, a failure never empties the board.
- **Alternatives:** Clearing the board and showing the error would let one failed click wipe out a working board.
- **Effect on the spec:** scenario "Force refresh fails". Task 1.3.

### D-004: The button is disabled while a reload runs

- **Question:** What does the button show during a reload, and what happens on a second click?
- **Decision:** From the click until the reload returns, successfully or not, the button is disabled and reads "Refreshing…". Afterwards it reads "Force refresh" again and the board shows the new data or the stale line.
- **Effect on the spec:** scenario "Reload in progress". Task 3.2.

## Risks / Trade-offs

- [A full reload issues more provider queries than a poll (two searches per provider instead of one)] → It only runs on a click, and the button is disabled while it runs.
- [The next automatic poll after a force refresh is an incremental poll from the new refresh time] → This is the existing poll behaviour, so no change is needed.

## Affected paths

- `src/view/store.ts`
- `src/view/source.ts`
- `view/src/server/functions.ts`
- `view/src/routes/__root.tsx`
- `view/src/components/Freshness.tsx`
- `view/src/components/ForceRefresh.tsx`
- `view/src/components/ForceRefresh.test.tsx`
- `view/src/styles.css`
- `tests/view-store.test.ts`
- `tests/view-source.test.ts`

## Open Questions

None.
