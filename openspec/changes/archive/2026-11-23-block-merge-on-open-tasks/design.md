# Design

## Context

See proposal.md for the motivation. Today:

- After the review passes, `deliver` in `src/factory/build-loop.ts` archives the change on the run branch, then `openPullRequest` decides the merge route (`decideMerge` in `src/factory/risk.ts`), pushes, opens the pull request, maybe enables auto-merge, and records `run.pullRequest`, `run.risk` and `run.merge`.
- The archived `tasks.md` is under `openspec/changes/archive/<date>-<name>/`. The engine finds the change by the names of the ticket's attached files (`changeOf`), and `changeFolders` already lists archived folders.
- Since PIE-19 (requirement "The builder ticks the tasks it completes"), an unchecked task carries an indented note directly under it saying what is missing.
- The dashboard reads only ticket records (`src/view/model.ts`). The Needs you `merge` item and the Pull request card come from `run.merge`.
- The only CI job on GitHub is `record-merge`, on push to main, in `.github/workflows/factory.yml`. Nothing runs on pull requests. The factory never reads or writes branch protection.
- `factory migrate` adds `.github/workflows/factory.yml` only when it is missing, and never rewrites an existing one.

## Goals / Non-Goals

**Goals:**
- A pull request with open tasks cannot be merged, by a person or by auto-merge, until every open task is ticked or accepted, provided the project made the check required.
- The dashboard shows open tasks wherever a pull request is shown, and keeps that current as the pull request changes.

**Non-Goals:**
- Configuring branch protection or Bitbucket merge checks. A person does it (D-002).
- Blocking pull requests from forks. Forked pull requests get no secrets, so the check cannot run there. Factory pull requests are never forks.
- Changing `record-merge`. The record keeps the last task state the check saw.
- Re-gating commits pushed to the pull request after delivery. They are the person's responsibility, because the route is human (D-004).

## Decisions

### D-001: Block with a required status check

- **Question:** How should open tasks block the merge: open the pull request as a draft, force the human route only, a failing required status check, or refuse to deliver?
- **Decision:** A failing required status check. A draft pull request clears as soon as someone marks it ready, without checking the tasks. A human route alone does not stop a person. Refusing to deliver contradicts PIE-19, which lets a build be handed in with noted open tasks.
- **Effect:** The `factory/tasks` status (D-008) and the `check-tasks` command. Delta spec `build-loop`: "Open tasks fail the tasks status". Tasks 2.x and 3.x.

### D-002: A person makes the check required, and doctor verifies it

- **Question:** Who makes the check required on the main branch: a manual step verified by doctor, the factory through the API, or nobody?
- **Decision:** A manual step. Install and migrate add the workflow (or print the Bitbucket step), and the install pull request tells the person to mark `factory/tasks` as required on the main branch. `factory doctor` reads the main branch's required checks, classic protection and rulesets, and reports a `required_check` finding when `factory/tasks` is not required. When doctor cannot read those settings (missing permission, or Bitbucket without admin access), it reports a note that it could not verify, without failing.
- **Effect:** Delta spec `project-setup`: "Tasks workflow on every GitHub install", "Migrate adds the missing tasks workflow" and "Doctor reports a tasks check that is not required". Tasks 5.x.

### D-003: Accepting open tasks is a factory command

- **Question:** How does a person accept tasks as open: a factory command, a pull request label, or a pull request comment?
- **Decision:** `factory accept-tasks <KEY>`. It records `{ by, at }` for each accepted task in the ticket record and posts a passing status straight away. It works the same on GitHub and Bitbucket, which has no pull request labels, and it lets the dashboard show who accepted what.
- **Effect:** Delta spec `build-loop`: "A person accepts open tasks". Task 4.x.

### D-004: Open tasks force the human route

- **Question:** Should the merge route change when tasks are open at delivery, or should auto-merge stay on and fire once the check passes?
- **Decision:** Open tasks force the human route, with `wouldAutoMerge: false`, and auto-merge is never enabled. Otherwise commits pushed after delivery, which the factory never gated, would merge with nobody looking. Also, on Bitbucket "enable auto-merge" merges immediately. The open-tasks rule comes first in `decideMerge`, so its reason, "N of M tasks were open at delivery", wins over the risk policy, the ceiling, the label, suspension and shadow mode. Because `wouldAutoMerge` is false, the run does not count toward the shadow streak that health uses to suggest auto-merge.
- **Effect:** Delta spec `build-loop`: "Open tasks force a human merge". Task 2.3.

### D-005: The check keeps the record current

- **Question:** Should the dashboard follow later pushes, or show only what was open at delivery?
- **Decision:** Every `check-tasks` run writes the task state it read into the latest run's `tasks` and saves the record, but only when the state changed. A pull request whose body has no `Ticket:` line gets a passing status and no record write. A factory pull request whose record, run or `tasks.md` cannot be read gets a failing status with a description saying what could not be read, and the command exits non-zero.
- **Effect:** Delta spec `build-loop`: "CI checks the tasks on every pull request change". Task 3.x.

### D-006: Dashboard display

- **Question:** How does the dashboard show open tasks?
- **Decision:** The Pull request card's note reads "N of M tasks open". A new Needs you category, `open_tasks`, ranks just above `merge` and replaces the merge item while any task is open and not accepted. Its reason is "N of M tasks open. Tick them in a push, or accept them as open.", its command `factory accept-tasks <KEY>`, and its link the pull request. Once every open task is ticked or accepted, the usual merge item comes back. When tasks were accepted, the card and the merge item add "N tasks accepted open by <person>". The run detail gets a Tasks section, "Tasks: D of M done", listing each open task with its note and, when accepted, who accepted it and when. A run whose tasks are all ticked looks as it does today.
- **Effect:** Delta spec `factory-view`. Tasks 6.x.

### D-007: An acceptance covers the tasks it named

- **Question:** If `tasks.md` changes after an acceptance, what does the acceptance cover?
- **Decision:** It covers the tasks it named, matched by the task line's text after the checkbox. The status passes only when every open task is ticked or accepted. A new task, a reopened task or a reworded task that is open blocks again and needs its own acceptance. `accept-tasks` refuses when no task is open and not accepted, and when the pull request is merged or closed.
- **Effect:** Delta spec `build-loop`: scenarios under "A person accepts open tasks". Task 4.x.

### D-008: The check is a commit status the engine posts

- **Question:** Should the check be a red or green CI job, or a commit status that the engine posts?
- **Decision:** A commit status with context `factory/tasks`, posted through the source-control adapter: a commit status on GitHub, a build status on Bitbucket (which its merge checks count). Delivery posts it when the pull request opens, `check-tasks` posts it on every pull request event, and `accept-tasks` posts it straight away, so accepting turns it green without re-running CI. Descriptions: "N of M tasks open" (failing), "All M tasks done" (passing), "All open tasks accepted by <person>" (passing), "No factory ticket" (passing). The status links to the pull request.
- **Effect:** A new `postStatus` adapter method on GitHub, Bitbucket and in memory. Task 1.x.

### D-009: The tasks check has its own workflow file

- **Question:** Should the pull request job go into `factory.yml` or into a separate workflow?
- **Decision:** A separate `.github/workflows/factory-tasks.yml`, triggered by `pull_request` (opened, synchronize, reopened), with `statuses: write`. Migrate never rewrites `factory.yml`, so a separate file lets migrate add the check to existing installs by adding a missing file, the same rule it already uses for `factory.yml`.
- **Effect:** Delta spec `project-setup`. Tasks 5.1 and 5.2.

### D-010: The pull request body lists the open tasks and stays current

- **Question:** Should the pull request body list the open tasks, and if so, should it follow later pushes?
- **Decision:** Yes. Delivery adds a "## Open tasks" section listing each open task that is not accepted, with its note. When `check-tasks` saves a changed task state, it rewrites that section too: it removes the section when no open task is left unaccepted, and lists accepted tasks under "Accepted open by <person>". The rest of the body is left as it is.
- **Effect:** Delta spec `build-loop`: "Delivery records the run's tasks" and "CI checks the tasks on every pull request change" gain the section rules, plus the scenario "The body follows the ticks". Tasks 2.2 and 3.2.

### D-011: The 0.2.7 release change to `tests/cli.test.ts` leaves the spec as it is

- **Question:** `tests/cli.test.ts` changed on main after the spec was approved. Does the spec still hold?
- **Decision:** Yes. The only change was the 0.2.7 release commit (#28), which bumps the engine version expected in a config error message from 0.2.6 to 0.2.7. No requirement of this change depends on the engine version, and the file is covered only by the `tests/**` affected path.
- **Effect:** None. The delta specs, tasks and proposal are unchanged.

## Risks / Trade-offs

- [The project never makes the check required, so the block is only advisory] → The install pull request says how. Doctor reports `required_check` until it is done (D-002). The dashboard and Needs you still show the open tasks.
- [Pull requests already open when the check becomes required have no `factory/tasks` status and stay pending] → Pushing to them, or re-running the tasks workflow, posts the status. The migration plan says so.
- [Non-factory pull requests are blocked if the workflow does not run on them] → The workflow runs on every pull request and passes the ones with no `Ticket:` line.
- [Forked pull requests cannot post a status, so a required check blocks them] → Out of scope. Factory pull requests are never forks. A project with fork contributions can merge those by admin override.
- [A person clicks the accept command without reading the tasks] → The acceptance names each task and is shown with the person's name on the dashboard and in the record.
- [Saving the record from CI on every push floods the ticket's history] → `check-tasks` saves only when the task state changes (D-005).
- [Rewording an accepted task blocks again] → Intended: the acceptance was for the old text (D-007).

## Migration Plan

1. Release the engine with this change, then `factory migrate` on each project. On GitHub, migrate adds `.github/workflows/factory-tasks.yml`. On Bitbucket, `factory doctor` lists the missing step.
2. A person marks `factory/tasks` as required on the main branch. `factory doctor` confirms it.
3. Push to, or re-run the tasks workflow on, any factory pull request that was already open, so it gets a status.

Rollback: remove `factory/tasks` from the required checks. The record field is optional and older engines ignore it.

## Affected paths

- src/record/ticket-record.ts
- src/factory/build-loop.ts
- src/factory/risk.ts
- src/factory/merge.ts
- src/factory/open-tasks.ts
- src/adapters/source-control.ts
- src/adapters/github-source-control.ts
- src/adapters/bitbucket-source-control.ts
- src/adapters/in-memory-source-control.ts
- src/cli/cli.ts
- src/cli/inputs.ts
- src/cli/real-deps.ts
- src/setup/install.ts
- src/setup/upgrade.ts
- src/setup/doctor.ts
- src/setup/detect.ts
- src/view/model.ts
- src/view/demo.ts
- view/src/components/**
- view/src/routes/**
- tests/**
- skills/factory-run/SKILL.md
- skills/factory-doctor/SKILL.md
- .github/workflows/factory-tasks.yml
- openspec/specs/build-loop/spec.md
- openspec/specs/factory-view/spec.md
- openspec/specs/project-setup/spec.md
- openspec/changes/block-merge-on-open-tasks/**
- openspec/changes/archive/**

## Open Questions

None.
