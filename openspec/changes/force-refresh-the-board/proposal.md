# Proposal

## Why

The factory view loads every tracked ticket once, then only merges in tickets updated since the last refresh, and it ignores any request that comes within the poll interval (60 seconds by default) of the last one. A ticket that is deleted, moved out of the team, or changed without its update time moving stays on the board until `factory view` is restarted, and reloading the page fetches nothing new. While developing the tool, PIE-17 asks for a "Force refresh" button that repopulates the board on demand.

## What Changes

- The dashboard header shows a "Force refresh" button next to the freshness line, on every page (D-002).
- Pressing it reloads the board from scratch: it ignores the poll interval, forgets the tickets it holds, and reads every tracked ticket from the ticket providers again, as on the first load (D-001). Tickets that no longer match are gone from the Board and from Needs you.
- The project configuration is not read again. Changes to `.factory/config.yaml` still need a restart of `factory view` (D-001).
- If the reload fails, the board keeps the tickets it had and shows "Stale since <time> · <problem> · retrying", as a failed poll does (D-003).
- While a reload runs, the button is disabled and reads "Refreshing…" (D-004).
- The button changes no ticket. The view stays read-only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-view`: adds the requirement "Force refresh reloads the board".

## Impact

- View data: `src/view/store.ts` (full reload), `src/view/source.ts` (a forced load that skips the poll interval).
- Dashboard: a server function for the forced reload in `view/src/server/functions.ts`, and the button in the header (`view/src/routes/__root.tsx`, `view/src/components/Freshness.tsx` or a new header component).
- Tests: `tests/view-store.test.ts`, `tests/view-source.test.ts`, and a browser test for the button under `view/src/components/`.
- No change to the ticket providers, the CLI or the factory comment.
