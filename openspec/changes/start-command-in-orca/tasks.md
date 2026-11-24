# Tasks

## 1. Orca adapter

- [ ] 1.1 Test-first in `tests/orca-agent-runtime.test.ts`: the worktree starter runs `orca worktree create --repo path:<project dir> --name <name> --no-parent --linear-issue <KEY> --agent claude --prompt <prompt> --activate --json` for a Linear ticket and `--reference <KEY>` instead for a Jira ticket, passes no `--model`, `--effort`, `--surface`, `--setup` or `--base-branch`, and returns the last segment of `result.worktree.path` as the worktree name (including a suffixed one such as `pie-21-2`); an Orca error envelope rejects with Orca's message; verify the new tests fail, then pass after adding the starter in `src/adapters/orca-agent-runtime.ts`
- [ ] 1.2 Wire the starter into `createProjectViewSource` in `src/cli/real-deps.ts` with the project directory; verify with `pnpm typecheck`

## 2. View source

- [ ] 2.1 Test-first in `tests/view-source.test.ts`: `startInOrca` with a key and the card's current command calls the starter with the lowercase key as name, the card's provider link and the card's command as prompt; on a Ready card with the auto label the prompt is `/factory-run <KEY>`; on success it returns `{ ok: true, worktree }`; when the starter rejects it returns `{ ok: false, message: 'Orca could not start <KEY>: <message>' }`; verify the new tests fail, then pass after the change in `src/view/source.ts`
- [ ] 2.2 Test-first in `tests/view-source.test.ts`: `startInOrca` on a card with no command, on a card whose run is on this machine, and on an unknown key returns `{ ok: false, message: 'Orca could not start <KEY>: <KEY> has nothing to start in a new worktree.' }` and never calls the starter; `startInOrca` with a command that differs from the card's current one (such as `/factory-refine <KEY>` on a Ready card) returns `{ ok: false, message: 'Orca could not start <KEY>: <KEY> changed since this panel opened. Reopen it to see what to run.' }` and never calls the starter, while `/factory-next` sent for a Ready card with the auto label is accepted and starts `/factory-run <KEY>`; verify the tests fail, then pass
- [ ] 2.3 Test-first in `tests/view-demo.test.ts`: the sample source's `startInOrca` returns `{ ok: false, message: 'Orca could not start <KEY>: This is sample data, with no Orca session behind it.' }`; verify the test fails, then passes after the change in `src/view/demo.ts`
- [ ] 2.4 Verify `pnpm vitest run` and `pnpm typecheck` pass, and run mutation testing on the changed lines of `src/adapters/orca-agent-runtime.ts` and `src/view/source.ts` with no surviving mutant

## 3. Button

- [ ] 3.1 Test-first in `view/src/components/StartInOrca.test.tsx` (Vitest browser mode): pressing "Start in Orca" calls the start action once with the card key and the command the panel shows; while it is pending the button is disabled and reads "Starting in Orca…" and a second click calls nothing; on success the panel shows `Started in Orca: <worktree>` and the button stays disabled; on failure it shows the returned message and the button reads "Start in Orca" and is enabled again; verify the tests fail, then pass once `view/src/components/StartInOrca.tsx` exists
- [ ] 3.2 Test-first in `view/src/components/StartInOrca.test.tsx`: after a success, closing the panel and reopening the same card shows an enabled "Start in Orca" button again; verify the test fails, then passes

## 4. Detail panel and wiring

- [ ] 4.1 Test-first in `view/src/components/Board.test.tsx`: the detail panel shows "Start in Orca" on a card with a command that is not on this machine, shows "Open in Orca" and no "Start in Orca" on a card whose run is on this machine, and shows no "Start in Orca" on a card with no command; verify the tests fail, then pass after the change in `view/src/components/RunDetailPanel.tsx` and `view/src/components/BoardScreen.tsx`
- [ ] 4.2 Add the `startRun` POST server function taking `{ key, command }` in `view/src/server/functions.ts` and pass it from `view/src/routes/index.tsx` to `BoardScreen`; verify with `pnpm --filter @software-factory/view typecheck`
- [ ] 4.3 Verify `pnpm test:view` and `pnpm --filter @software-factory/view typecheck` pass, and that `view/src/components/NeedsYou.tsx` is unchanged (`git diff --stat main -- view/src/components/NeedsYou.tsx` prints nothing)

## 5. End-to-end check

- [ ] 5.1 Run `pnpm build:view`, start `factory view` on this project with Orca running, open a PIE ticket in Available and press "Start in Orca"; verify Orca comes to the front on a new worktree named after the key, linked to the Linear issue, with Claude running the card's command, and that the panel shows `Started in Orca: <that worktree>`; press it again after reopening the card and verify a second worktree with a suffixed branch; quit Orca, press it once more and verify the failure message and that the button is enabled again
