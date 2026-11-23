# Design

## Context

`buildInstall` adds the workflow only when `ci.system === 'github-actions'`, and returns no secrets when `ci.system === 'none'`. Detection sets `system: 'none'` when no CI files exist, even when the remote is GitHub.

## Approach

Choose the workflow from the source control (GitHub), not from the CI files found.

## Open Questions

None.

## Decisions

### D-001: Doctor and the missing `revert` step when nothing builds main

- **Question:** Does doctor stay silent about `revert` when there is no main build, or report it once as advisory?
- **Decision:** Doctor stays silent. When no CI file other than `.github/workflows/factory.yml` defines a job, doctor does not expect the `revert` step and reports no `ci_step` finding for it. Once another CI file defines a job and the pipeline still does not run `factory revert`, doctor reports the missing step as it does today. No advisory finding level is added.
- **Effect:** New requirement "Doctor expects revert only when a build exists" with two scenarios. Task 3 states the doctor behaviour and its tests. The install pull request summary remains the only place that explains the missing `revert` job.

### D-002: No CI workflow for main is generated

- **Question:** Should init offer to add a minimal CI workflow that runs the project's checks on main, so `revert` has a build to watch? Or is that out of scope?
- **Decision:** Out of scope. Init does not write or offer a build workflow. On GitHub with no workflow that builds main, the install pull request's manual steps say: "The revert step was left out because no workflow builds the main branch. Add one, then run the install again." The "No CI system was found" step, which tells the person to run `record-merge` themselves, is not listed on GitHub, since the factory workflow now does it. A generated build workflow, if wanted, is a separate ticket.
- **Effect:** The "No build to watch" scenario states the exact manual step and that the "No CI system was found" step is absent on GitHub. Task 2 tests both. The proposal lists the build workflow as out of scope.

### D-003: Existing installs get the workflow from `factory migrate`

- **Question:** For an existing install like this repository's, does `factory doctor` propose the missing workflow through a pull request, or does the person rerun init?
- **Decision:** `factory migrate` adds `.github/workflows/factory.yml` when `adapters.yaml` names GitHub as the source control and the file is missing. It never overwrites an existing `factory.yml`. The workflow is built from `factory.yaml` and `adapters.yaml` (main branch, tracker secrets, source control token; the watch job is left out, see D-005), so the person's configuration is kept. The pull request body lists the tracker secrets under "Before merging, store these secrets in the CI secret store:", as the install pull request does. When the workflow is the only thing to add, migrate opens a pull request titled "chore: add the factory workflow" instead of answering "Nothing to upgrade". On GitHub, when `factory.yml` is missing, doctor's missing `record-merge` finding says: "The CI pipeline does not run \"factory record-merge\". Run \"factory migrate\" and merge the pull request it opens". Doctor stays read-only. Rerunning `/factory-init` is not the advised path, because it rebuilds the configuration from detection.
- **Effect:** New requirements "Migrate adds the missing factory workflow" and "Doctor points to migrate for the missing workflow". New tasks 4 and 5. Affected paths gain `src/setup/upgrade.ts` and `src/cli/setup-command.ts`.

### D-004: Migrate finds the main build the way init does

- **Question:** When `factory migrate` adds the workflow to a repository that already has a workflow building main, does it include the `revert` job?
- **Decision:** Yes. Migrate chooses the main build with the same rule as init: the workflow that holds the first CI check, or else the only workflow other than `factory.yml`, named by its `name` field or else its file path. When the rule finds one, the added workflow has the `revert` job triggered by that workflow's failure on main, as a fresh install would. When it finds none, the `revert` job is left out and the pull request body says "The revert step was left out because no workflow builds the main branch." Init and migrate share one rule, so they cannot disagree.
- **Effect:** Two scenarios added to "Migrate adds the missing factory workflow". Task 4 covers them.

### D-005: Migrate leaves out the watch job

- **Question:** When `factory migrate` adds the missing `.github/workflows/factory.yml` and `factory.yaml` has the staging watch enabled, what happens to the watch job? `factory.yaml` does not record the deployment environment the watch job triggers on (the watch configuration has only `enabled`, `checks`, `duration` and `interval`), so migrate cannot rebuild that job from configuration.
- **Decision:** Migrate adds the workflow without the watch job: no `watch` job and no `deployment_status` trigger. When the watch is enabled in `factory.yaml`, the pull request body says: "The watch step was left out: factory.yaml does not record the environment to watch. Add the watch job by hand." When the watch is not enabled, the body says nothing about it. Migrate does not change `factory.yaml` and does not ask for the environment. Recording the environment in `factory.yaml` is a separate ticket.
- **Effect:** Scenario "Migrate with the staging watch enabled" added to "Migrate adds the missing factory workflow". The requirement no longer lists the watch among what the workflow is built from. Task 4 covers it.
