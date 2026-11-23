# Spec Delta

## ADDED Requirements

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
