# Spec Delta

## Purpose

Makes the factory installable in any project from the checks it already has, keeps all project-specific behavior in one versioned configuration, and ships every workflow change as a reviewed pull request.

## ADDED Requirements

### Requirement: Install wizard detects, verifies, and delivers PRs
`/factory-init` SHALL work in five steps:
1. Detect the project's CI files, scripts, linters, test runners, security tools, OpenSpec, design system and git remote.
2. Run each detected check once on main and record pass, fail or flaky, and its duration.
3. Show coverage per category.
4. Let the person choose, per category, to use the existing check, add a recommended one, or skip.
5. Deliver one PR that installs the factory, and one separate PR per added check.

#### Scenario: Missing type checker
- **WHEN** the wizard finds no type checker in a TypeScript project and the person chooses to add one
- **THEN** the install PR does not include it, and a separate PR adds the type checker

#### Scenario: Timeouts from measurements
- **WHEN** the wizard verifies a test suite that takes 4 minutes on main
- **THEN** that check's timeout in `factory.yaml` is set from the measured duration with a safety margin

### Requirement: Status and label mapping by matching
The wizard SHALL match the provider's existing statuses and labels to factory states automatically, by name and status category. It SHALL ask the person only where no match is found.

#### Scenario: All statuses match
- **WHEN** every factory state has a matching provider status
- **THEN** the wizard asks no mapping questions

### Requirement: CI steps installed for the no-orchestrator flow
The install PR SHALL add the factory's CI steps to the project pipeline:
- `factory record-merge`, on merge to main
- `factory revert`, on a failed main build after an auto-merge
- `factory watch`, after a staging deploy, only when the watch is enabled.

These steps write to the ticket provider, so the wizard SHALL ask for a ticket-provider service account, tell the person which CI secret to store its token in, and check that the account can comment on and transition a ticket.

#### Scenario: Service account cannot transition
- **WHEN** the service account given to the wizard lacks permission to change a ticket's status
- **THEN** the wizard reports the missing permission and does not open the install PR

#### Scenario: Project without staging
- **WHEN** the person turns the watch off
- **THEN** the install PR adds record-merge and revert steps only

### Requirement: Project holds only the .factory folder and a pinned version
After install, a project SHALL hold:
- `.factory/factory.yaml` (stations, checks, statuses, limits, risk policy, engine version)
- `.factory/checks/` (agent rubrics)
- `.factory/adapters.yaml` (provider connections, no secrets).

#### Scenario: Engine pinned
- **WHEN** a second project upgrades its engine version
- **THEN** the first project's behavior is unchanged because its `factory.yaml` pins its own version

### Requirement: First supported stacks
Detection SHALL understand two stacks in depth:
- TypeScript with React, Next.js or TanStack Start
- Python with Django.

Any other stack SHALL fall back to reading its CI files only.

#### Scenario: Unsupported stack
- **WHEN** the wizard runs in a Go project
- **THEN** it derives checks from the CI files only, and says that in-depth detection is not available

### Requirement: Workflow modification ships as a PR
`/factory-workflow` SHALL work in five steps:
1. Translate a plain-language request into edits to `factory.yaml`, plus a rubric file for a new agent check.
2. Validate the result against the config schema.
3. Show the new pipeline and the diff.
4. Run every new or changed check on current main.
5. Open a PR.

#### Scenario: New check fails on main
- **WHEN** a requested new blocking check fails on current main
- **THEN** the skill reports the failure and does not open a PR until the person makes the check advisory or fixes main

### Requirement: Doctor flags configuration drift
`/factory-doctor` SHALL rerun detection and report drift:
- a renamed CI job
- a script no gate uses
- a check that became flaky
- missing factory CI steps
- a missing, expired or under-privileged CI service account
- secrets in configuration.

#### Scenario: Renamed CI job
- **WHEN** a CI job used by a `source: ci` check was renamed
- **THEN** doctor names the check and the missing job

### Requirement: Versioned config schema with migrations
The config schema SHALL be versioned. An engine upgrade that changes the schema SHALL run a migration that rewrites `factory.yaml` and opens a PR with the diff.

#### Scenario: Upgrade with schema change
- **WHEN** a project upgrades from an engine on schema v1 to one on schema v2
- **THEN** a PR is opened containing the migrated `factory.yaml`, and nothing changes until it is merged
