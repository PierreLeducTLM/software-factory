# Spec Delta

## ADDED Requirements

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
