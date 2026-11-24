# Proposal

## Why

Since PIE-19, a factory run may deliver a pull request with tasks still unchecked in `tasks.md`, each with a note saying what is missing. Nothing records them: the card moves to Pull request, Needs you shows "Ready to merge", and a person or auto-merge can merge the pull request like a finished change. PIE-17 (PR #23) was merged that way with its end-to-end check only partly done.

## What Changes

- At delivery, the engine reads the archived `tasks.md` and records the run's tasks in the ticket record: how many there are, and each open task with its note.
- Open tasks at delivery force the human merge route. Auto-merge is never enabled for such a pull request, and the run does not count as one that would have auto-merged.
- The engine posts a commit status named `factory/tasks` on the pull request's head commit. It fails while any task is open and not accepted, and passes otherwise. A project marks it as a required check, so neither a person nor auto-merge can merge until it passes.
- New command `factory check-tasks --pull-request <N>`, run by CI on every pull request event. It reads `tasks.md` at the head commit, updates the record, and posts the status. Pull requests with no factory ticket get a passing status.
- New command `factory accept-tasks <KEY>`. A person runs it to accept the tasks open at the head commit. It records who accepted which tasks and when, and posts a passing status.
- Install and migrate add `.github/workflows/factory-tasks.yml`, which runs `check-tasks` on pull requests. On Bitbucket, install prints the pipeline step to add. The install pull request tells the person to make `factory/tasks` a required check. `factory doctor` reports a finding when it is not required.
- Dashboard: the Pull request card says "N of M tasks open". A new Needs you category, `open_tasks`, replaces the merge item while tasks are open and offers `factory accept-tasks <KEY>`. The run detail gets a Tasks section listing each open task with its note and any acceptance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-loop`: delivery records the run's tasks, forces the human route when tasks are open, and posts the `factory/tasks` status. New requirements cover `check-tasks` and `accept-tasks`.
- `factory-view`: the Pull request card, a new Needs you category for open tasks, and a Tasks section in the run detail.
- `project-setup`: install and migrate add the tasks workflow, the Bitbucket step and the required-check instruction. Doctor reports a `factory/tasks` check that is not required.

## Impact

- Ticket record schema: optional `tasks` on a run. Schema version 1 is unchanged, and older records still parse.
- Source-control adapters (GitHub, Bitbucket, in memory): post a commit status, read a file at a commit, and read whether a status context is required on the main branch.
- CLI: two new commands, `check-tasks` and `accept-tasks`. `check-tasks` joins the CI commands.
- Setup: a new GitHub workflow file, a new Bitbucket manual step, a new doctor finding, and migrate adds the workflow when it is missing.
- Dashboard: model, Needs you page, Board and run detail panel.
- Depends on PIE-19 (merged): runs tick the tasks they complete.
