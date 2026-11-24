# Tasks

## 1. Record and adapters

- [x] 1.1 Add an optional `tasks` field to a run in `src/record/ticket-record.ts`: the total, the commit read, each open task with its text and optional note, and the acceptances, each with the task text, who and when; verify in `tests/ticket-record.test.ts` that a record with `tasks` round-trips through `renderComment`/`parseComment` and that a record without it still parses
- [x] 1.2 Add a pure parser of `tasks.md` text that returns the total and the open tasks with their notes (ticked tasks are done, indented lines under an unchecked task are its note, and lines without a checkbox are ignored), and a function that combines it with acceptances into the status state and description (D-007, D-008); verify with tests covering a ticked task, an unchecked task with and without a note, `- [ x]`, a non-checkbox line, an accepted task, and a reworded accepted task
- [x] 1.3 Add `postStatus` (context, state, description, link, commit), `readFileAt` (path, commit) and `requiredChecks` (branch, which returns the contexts or "unreadable") to `SourceControl`, and implement them in the in-memory, GitHub (commit statuses; branch protection plus rulesets) and Bitbucket (build statuses; branch restrictions) adapters; verify with the adapter contract tests in `tests/contracts/` and the HTTP-level tests in `tests/github-source-control.test.ts` and `tests/bitbucket-source-control.test.ts`

## 2. Delivery

- [x] 2.1 In `openPullRequest`, read the archived `tasks.md` of the change on the run branch and record the run's tasks; verify in `tests/build-loop.test.ts` with the scenarios "Two tasks left open" and "Every task ticked"
- [x] 2.2 Add the "## Open tasks" section to the pull request body when tasks are open (D-010); verify in `tests/build-loop.test.ts` that the body lists each open task with its note, and has no section when every task is ticked
- [x] 2.3 Give `decideMerge` the open task count as its first rule: human route, `wouldAutoMerge` false, reason "N of M tasks were open at delivery" (D-004); verify in `tests/risk.test.ts` with "Low risk with open tasks", "Shadow mode with open tasks" and "No open tasks", and in `tests/build-loop.test.ts` that `enableAutoMerge` is not called
- [x] 2.4 Post the `factory/tasks` status on the head commit when the pull request opens; verify in `tests/build-loop.test.ts` with "Delivered with open tasks" and "Delivered with every task done", reading the statuses from the in-memory source control

## 3. check-tasks

- [x] 3.1 Add `factory check-tasks --pull-request <N>` and list it among the CI commands in `src/cli/cli.ts` and `src/cli/inputs.ts`, wired through `src/cli/real-deps.ts`; verify in `tests/cli.test.ts` that it parses, prints its result with `--json`, and exits non-zero on a read failure
- [x] 3.2 Implement the check (D-005, D-010): pass "No factory ticket" with no `Ticket:` line, read `tasks.md` at the head commit, post the status, and, only when the task state changed, save the record and rewrite the body's "## Open tasks" section; verify in a new `tests/check-tasks.test.ts` with "The body follows the ticks", "A push ticks the last open tasks", "A push that leaves the tasks unchanged", "Pull request with no factory ticket", "The change folder is missing", "A new open task after an acceptance", "A reworded accepted task" and "Ticking an accepted task"

## 4. accept-tasks

- [x] 4.1 Add `factory accept-tasks <KEY>` (D-003, D-007): read `tasks.md` at the pull request's head commit, record an acceptance for each open task, post the passing status and save; refuse when nothing is open or the pull request is merged or closed; verify in `tests/cli.test.ts` and `tests/check-tasks.test.ts` with "Accept two open tasks", "Nothing to accept" and "Pull request already merged"
- [x] 4.2 In `skills/factory-run/SKILL.md`, say in the delivery report that open tasks block the merge until they are ticked or accepted with `factory accept-tasks <KEY>`; verify by reading the step, and verify `pnpm vitest run tests/packaging.test.ts` passes

## 5. Setup

- [x] 5.1 Generate `.github/workflows/factory-tasks.yml` in `src/setup/install.ts` (D-009), add it to the install pull request with the required-check instruction, and add the Bitbucket pipeline and merge-check steps; verify in `tests/setup-install.test.ts` and `tests/setup-init-project.test.ts` with "GitHub install" and "Bitbucket install"
- [x] 5.2 Make `factory migrate` add the missing tasks workflow in `src/setup/upgrade.ts`; verify in `tests/setup-upgrade.test.ts` with "Installed on GitHub without the tasks workflow", "Tasks workflow already present" and "Bitbucket project"
- [x] 5.3 Add `check-tasks` to the factory steps in `src/setup/detect.ts` and `src/setup/doctor.ts`, and add the `required_check` finding and the "could not verify" note (D-002); verify in `tests/setup-doctor.test.ts` with "Check not required", "Check required by a ruleset", "Settings not readable" and "No CI step runs check-tasks"
- [x] 5.4 Mention the `required_check` finding and how to fix it in `skills/factory-doctor/SKILL.md`; verify by reading it, and verify `pnpm vitest run tests/packaging.test.ts` passes
- [x] 5.5 Add `.github/workflows/factory-tasks.yml` to this repository, as migrate would write it; verify with a test that reads the committed file and compares it with the generator's output for this repository's `.factory/factory.yaml` and `.factory/adapters.yaml`

## 6. Dashboard

- [x] 6.1 In `src/view/model.ts`, add the card note "N of M tasks open" / "K tasks accepted open by <person>" and the `open_tasks` Needs you category ranked above `merge`, replacing the merge item while tasks are open (D-006); verify in `tests/view-model.test.ts` with the scenarios of "Pull request cards show open tasks" and "Needs you lists pull requests with open tasks"
- [x] 6.2 Add the Tasks section to the run detail; verify in `tests/view-model.test.ts` with "Open tasks in the run detail" and "Accepted task in the run detail"
- [x] 6.3 Render the new category, note and Tasks section in `view/src/components` (NeedsYou, Board, RunDetailPanel), and add a demo ticket with open tasks in `src/view/demo.ts`; verify with `view/src/components/NeedsYou.test.tsx` and `Board.test.tsx` showing the accept command and the open task count, and `tests/view-demo.test.ts`

## 7. End-to-end check

- [ ] 7.1 After release and migrate in this repository, with `factory/tasks` required on main: deliver a PIE ticket with one task left open, and verify that the pull request shows a failing `factory/tasks` status, the merge button is blocked, no auto-merge is enabled, and the dashboard shows the card note and the `open_tasks` item; then run `factory accept-tasks <KEY>` and verify the status passes and the dashboard shows the merge item with the acceptance; then verify a non-factory pull request gets "No factory ticket" and can merge
  - Not done: it needs this change released and migrated into this repository, and `factory/tasks` made required on main by a person, none of which a run can do. Every step of it is covered offline by the tests of 2.x, 3.x, 4.x and 6.x.
