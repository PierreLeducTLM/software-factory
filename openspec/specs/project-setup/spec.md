# project-setup Specification

## Purpose
TBD - created by archiving change fix-init-main-branch. Update Purpose after archive.

## Requirements

### Requirement: Main branch from the remote default
Without `--main-branch`, `factory init` SHALL use the remote's default branch as the main branch, never the branch checked out now unless it is that default. `factory init detect` SHALL report that branch as `mainBranch`.

#### Scenario: Init from a worktree branch
- **WHEN** init runs without `--main-branch` on branch `feature/x`, and the remote's default branch is `main`
- **THEN** `factory.yaml` sets `main_branch: main` and the install pull request targets `main`

#### Scenario: Main branch given
- **WHEN** init runs with `--main-branch develop`
- **THEN** `factory.yaml` sets `main_branch: develop`

#### Scenario: Default branch unknown
- **WHEN** init runs without `--main-branch` and the remote's default branch cannot be read
- **THEN** init returns `reason: "missing"` naming `--main-branch`, and opens no pull request

#### Scenario: Detect shows the main branch
- **WHEN** `factory init detect` runs on branch `feature/x`, and the remote's default branch is `main`
- **THEN** its result has `mainBranch: "main"`

### Requirement: Factory workflow on every GitHub install
On GitHub, the install pull request SHALL add `.github/workflows/factory.yml` with the `record-merge` job, whether or not the repository has other CI, and SHALL list the tracker secrets to store.

#### Scenario: GitHub repository with no CI
- **WHEN** init runs on a GitHub repository with no `.github/workflows`
- **THEN** the install pull request adds `.github/workflows/factory.yml` with the `record-merge` job, and `secrets` lists the tracker's secret names

#### Scenario: No build to watch
- **WHEN** init runs on a GitHub repository where no workflow builds the main branch
- **THEN** the workflow has no `revert` job, the manual steps include "The revert step was left out because no workflow builds the main branch. Add one, then run the install again.", and they do not include the "No CI system was found" step

### Requirement: Doctor expects revert only when a build exists
`factory doctor` SHALL NOT report a missing `factory revert` step when no CI file other than `.github/workflows/factory.yml` defines a job. When another CI file defines a job, doctor SHALL report a missing `factory revert` step as a `ci_step` finding.

#### Scenario: Only the factory workflow exists
- **WHEN** doctor runs on a project whose only CI file is `.github/workflows/factory.yml`, which runs `factory record-merge` and not `factory revert`
- **THEN** the report has no `ci_step` finding about `revert`

#### Scenario: A build workflow exists without revert
- **WHEN** doctor runs on a project with another CI file that defines a job, and no CI file runs `factory revert`
- **THEN** the report has a `ci_step` finding saying the CI pipeline does not run "factory revert"

### Requirement: Migrate adds the missing factory workflow
When `adapters.yaml` names GitHub as the source control and `.github/workflows/factory.yml` is missing, `factory migrate` SHALL open a pull request that adds it, built from `factory.yaml` and `adapters.yaml`, and SHALL list the tracker secrets to store in the pull request body. The added workflow SHALL NOT include the `watch` job, because `factory.yaml` does not record the environment to watch (D-005). Migrate SHALL NOT overwrite an existing `.github/workflows/factory.yml` and SHALL NOT change `factory.yaml` for this purpose.

#### Scenario: Installed on GitHub without the workflow
- **WHEN** `factory migrate` runs on a GitHub project on the current engine and schema, with no `.github/workflows/factory.yml`
- **THEN** it opens a pull request titled "chore: add the factory workflow" that adds `.github/workflows/factory.yml` with the `record-merge` job, and whose body lists the tracker secrets under "Before merging, store these secrets in the CI secret store:"

#### Scenario: Engine upgrade on GitHub without the workflow
- **WHEN** `factory migrate` moves a GitHub project to a newer engine and `.github/workflows/factory.yml` is missing
- **THEN** the upgrade pull request also adds `.github/workflows/factory.yml` and lists the tracker secrets in its body

#### Scenario: Migrate with a workflow that builds main
- **WHEN** `factory migrate` adds the workflow to a GitHub project where one workflow other than `factory.yml` builds the main branch
- **THEN** the added workflow has the `revert` job, triggered when that workflow fails on the main branch, chosen by the same rule init uses

#### Scenario: Migrate with no workflow that builds main
- **WHEN** `factory migrate` adds the workflow to a GitHub project where no workflow builds the main branch
- **THEN** the added workflow has no `revert` job, and the pull request body says "The revert step was left out because no workflow builds the main branch."

#### Scenario: Migrate with the staging watch enabled
- **WHEN** `factory migrate` adds the workflow to a GitHub project whose `factory.yaml` has the watch enabled
- **THEN** the added workflow has no `watch` job and no `deployment_status` trigger, `factory.yaml` is not changed, and the pull request body says "The watch step was left out: factory.yaml does not record the environment to watch. Add the watch job by hand."

#### Scenario: Migrate with the staging watch disabled
- **WHEN** `factory migrate` adds the workflow to a GitHub project whose `factory.yaml` does not enable the watch
- **THEN** the added workflow has no `watch` job, and the pull request body does not mention the watch step

#### Scenario: Workflow already present
- **WHEN** `factory migrate` runs and `.github/workflows/factory.yml` exists
- **THEN** the file is not changed, and with nothing else to upgrade migrate answers "Nothing to upgrade"

#### Scenario: Bitbucket project
- **WHEN** `factory migrate` runs on a project whose source control is Bitbucket
- **THEN** no workflow file is added

### Requirement: Doctor points to migrate for the missing workflow
On a GitHub project with no `.github/workflows/factory.yml`, doctor's finding for the missing `record-merge` step SHALL tell the person to run `factory migrate`.

#### Scenario: GitHub project without the workflow
- **WHEN** doctor runs on a project whose source control is GitHub and which has no `.github/workflows/factory.yml`
- **THEN** the report has the `ci_step` finding "The CI pipeline does not run \"factory record-merge\". Run \"factory migrate\" and merge the pull request it opens"

### Requirement: The engine install leaves no untracked files
Running the factory through `.factory/bin/factory` SHALL NOT leave an untracked file in the project, including `.factory/package-lock.json`. The engine files SHALL include a `.factory/.gitignore` that lists `node_modules/` and `package-lock.json`, one per line.

#### Scenario: First run of the launcher
- **WHEN** a developer runs `.factory/bin/factory` for the first time in a fresh checkout
- **THEN** `git status` shows no untracked file under `.factory/`

#### Scenario: A lockfile already left untracked
- **WHEN** `.factory/package-lock.json` already exists, untracked, from an earlier run of the launcher, and the project's `.factory/.gitignore` is the one this change writes
- **THEN** `git status` does not show `.factory/package-lock.json`

#### Scenario: Existing install
- **WHEN** `factory migrate` runs on a project whose `.factory/.gitignore` lists only `node_modules/`
- **THEN** it opens a pull request that replaces `.factory/.gitignore` with one that lists `node_modules/` and `package-lock.json`

### Requirement: Migrate moves the pin to a newer patch
When the running engine has the same major and minor version as the pinned engine and a higher patch version, `factory migrate` SHALL open a pull request that pins the running engine in `.factory/factory.yaml` and `.factory/package.json`. The pull request SHALL use the same title and body as any other engine upgrade (D-001). When the running engine is the same patch or an older patch of the pinned release, migrate SHALL NOT move the pin (D-004).

#### Scenario: Newer patch
- **WHEN** `factory migrate` runs with engine 0.2.4 on a project that pins 0.2.3, on the current schema
- **THEN** it opens a pull request titled `chore: upgrade the factory engine to 0.2.4` whose body starts "Moves this project from factory engine 0.2.3 to 0.2.4."
- **AND** the pull request changes `engine: 0.2.3` to `engine: 0.2.4` in `.factory/factory.yaml` and pins `#v0.2.4` in `.factory/package.json`
- **AND** the command prints "Opened <url>, which moves the project from engine 0.2.3 to 0.2.4. Nothing changes until it is merged."

#### Scenario: Same patch
- **WHEN** `factory migrate` runs with engine 0.2.4 on a project that pins 0.2.4, with nothing else to change
- **THEN** it answers "Nothing to upgrade: the project is on engine 0.2.4 and schema 1, which this engine (0.2.4) runs as they are." and opens nothing

#### Scenario: Older patch
- **WHEN** `factory migrate` runs with engine 0.2.3 on a project that pins 0.2.4, with nothing else to change
- **THEN** it answers "Nothing to upgrade: the project is on engine 0.2.4 and schema 1, which this engine (0.2.3) runs as they are." and opens nothing

### Requirement: Doctor notes a newer patch without failing
When the running engine has the same major and minor version as the pinned engine and a higher patch version, `factory doctor` SHALL print a note in its text output. The note SHALL NOT count as drift and SHALL NOT appear in `--json` output (D-002, D-003).

#### Scenario: Newer patch, no drift
- **WHEN** `factory doctor` runs with engine 0.2.4 on a project that pins 0.2.3 and has no drift
- **THEN** it prints "No drift found", then "Notes:", then `- Engine 0.2.4 is a newer patch than the 0.2.3 pinned in .factory/factory.yaml. Run "factory migrate" to move the project to it`
- **AND** the report passes

#### Scenario: Newer patch with drift
- **WHEN** `factory doctor` runs with engine 0.2.4 on a project that pins 0.2.3 and has drift findings
- **THEN** it prints "Drift found:" and the findings as today, then the "Notes:" block with the newer-patch note

#### Scenario: JSON output
- **WHEN** `factory doctor --json` runs with engine 0.2.4 on a project that pins 0.2.3 and has no drift
- **THEN** the JSON is the same as without the note: `ok` is true, `findings` is empty, and there is no `notes` field

#### Scenario: Same or older patch
- **WHEN** `factory doctor` runs with engine 0.2.4 on a project that pins 0.2.4 or 0.2.5
- **THEN** it prints no "Notes:" block

### Requirement: Tasks workflow on every GitHub install
On GitHub, the install pull request SHALL add `.github/workflows/factory-tasks.yml`, which runs `factory check-tasks --pull-request <N>` on every pull request opened, pushed to or reopened, with permission to write commit statuses and the tracker secrets in its environment. The install pull request body SHALL tell the person to mark `factory/tasks` as a required status check on the main branch. On Bitbucket, the manual steps SHALL include a `pull-requests` pipeline step that runs `factory check-tasks --pull-request $BITBUCKET_PR_ID`, and a step telling the person to require a passing `factory/tasks` build in the main branch's merge checks.

#### Scenario: GitHub install
- **WHEN** init runs on a GitHub repository
- **THEN** the install pull request adds `.github/workflows/factory-tasks.yml` triggered by `pull_request`, and its body says to mark `factory/tasks` as a required status check on the main branch

#### Scenario: Bitbucket install
- **WHEN** init runs on a Bitbucket repository
- **THEN** the manual steps include the `check-tasks` pipeline step and the merge-check step for `factory/tasks`

### Requirement: Migrate adds the missing tasks workflow
When `adapters.yaml` names GitHub as the source control and `.github/workflows/factory-tasks.yml` is missing, `factory migrate` SHALL add it, in the same pull request as any other change it makes, and its body SHALL tell the person to mark `factory/tasks` as a required status check. Migrate SHALL NOT overwrite an existing `.github/workflows/factory-tasks.yml`.

#### Scenario: Installed on GitHub without the tasks workflow
- **WHEN** `factory migrate` runs on a GitHub project on the current engine and schema, with `.github/workflows/factory.yml` but no `.github/workflows/factory-tasks.yml`
- **THEN** it opens a pull request that adds `.github/workflows/factory-tasks.yml`, and whose body says to mark `factory/tasks` as a required status check

#### Scenario: Tasks workflow already present
- **WHEN** `factory migrate` runs and both workflow files exist
- **THEN** neither file is changed

#### Scenario: Bitbucket project
- **WHEN** `factory migrate` runs on a Bitbucket project
- **THEN** no tasks workflow file is added

### Requirement: Doctor reports a tasks check that is not required
`factory doctor` SHALL read the main branch's required status checks, from both branch protection and rulesets. When it can read them and `factory/tasks` is not among them, it SHALL report a `required_check` finding: "factory/tasks is not a required check on <main branch>, so open tasks do not block the merge". When it cannot read them, it SHALL report a note saying it could not verify the required checks, without failing. Doctor SHALL also report a `ci_step` finding when no CI file runs `factory check-tasks`.

#### Scenario: Check not required
- **WHEN** doctor runs on a GitHub project whose main branch protection does not require `factory/tasks`
- **THEN** the report has the `required_check` finding naming the main branch

#### Scenario: Check required by a ruleset
- **WHEN** doctor runs on a GitHub project where a ruleset on the main branch requires `factory/tasks`
- **THEN** the report has no `required_check` finding

#### Scenario: Settings not readable
- **WHEN** doctor runs and the source control refuses to return the main branch's required checks
- **THEN** the report has a note that the required checks could not be verified, and doctor does not fail because of it

#### Scenario: No CI step runs check-tasks
- **WHEN** doctor runs on a project where no CI file runs `factory check-tasks`
- **THEN** the report has a `ci_step` finding saying the CI pipeline does not run "factory check-tasks"
