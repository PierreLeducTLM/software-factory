# Tasks

## 1. Full reload in the view data

- [x] 1.1 Test-first in `tests/view-store.test.ts`: a forced reload after an earlier refresh reads with the first-load queries (open statuses, and Done updated in the last 7 days), not `updatedSince`, and the snapshot holds only the tickets that reload returned, so a ticket the provider no longer returns is gone; verify the new test fails, then passes after the change in `src/view/store.ts`
- [x] 1.2 Test-first in `tests/view-source.test.ts`: a forced load less than `poll_seconds` after the last refresh still reads the providers, and a normal `load` right after it is still throttled; verify the new tests fail, then pass after the change in `src/view/source.ts`
- [x] 1.3 Test-first in `tests/view-store.test.ts`: a forced reload whose provider throws keeps the previous tickets and `refreshedAt`, and sets `staleSince` and `problem` as a failed poll does; verify the new test fails, then passes
- [x] 1.4 Verify `pnpm vitest run` and `pnpm tsc --noEmit` pass, and run mutation testing on the changed lines of `src/view/store.ts` and `src/view/source.ts` with no surviving mutant

## 2. Server function

- [x] 2.1 Add a POST server function in `view/src/server/functions.ts` that runs the forced load and returns the same `{ ok, data }` or `{ ok: false, message }` shape as `fetchView`; verify with `pnpm --filter @software-factory/view typecheck`

## 3. Button in the header

- [x] 3.1 Test-first in `view/src/components/ForceRefresh.test.tsx` (Vitest browser mode): the header shows an enabled "Force refresh" button, and pressing it calls the reload once and then refreshes the page data; verify the new test fails, then passes once the button is added in `view/src/routes/__root.tsx` next to the freshness line
- [x] 3.2 Test-first in the same file: while the reload is pending the button is disabled and reads "Refreshing…", a second click calls nothing, and when the reload resolves or rejects it reads "Force refresh" and is enabled again; verify the tests fail, then pass
- [x] 3.3 Verify `pnpm test:view` and `pnpm --filter @software-factory/view typecheck` pass

## 4. End-to-end check

- [ ] 4.1 Run `pnpm build:view`, start `factory view` on this project, move a tracked PIE ticket to another Linear team (so the incremental poll never removes it), press "Force refresh" within 60 seconds, and verify the ticket leaves the Board and the freshness line reads "Updated 0 s ago"; then disconnect the network, press it again, and verify the board keeps its cards and shows the stale line
  - Partly done: on the live PIE board (Linear) the button was enabled on Board, Needs you and Health, read "Refreshing…" while running, sent one request per click, and the freshness line read "Updated 1 s ago" afterwards (the age counts from the start of the Linear read). No ticket was moved to another team and the network was not cut; those two paths are covered by tests/view-store.test.ts and tests/view-source.test.ts only.
