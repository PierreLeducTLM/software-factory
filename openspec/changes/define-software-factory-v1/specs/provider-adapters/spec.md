# Spec Delta

## Purpose

Keeps the factory core provider-neutral. The core speaks one standard model, and each ticket provider, source control system and agent runtime is translated at the boundary by one adapter.

## ADDED Requirements

### Requirement: Core speaks one standard model
The factory core SHALL operate only on the standard model: Work item, Run, Step, Attempt, Gate result, Event. Provider-specific fields SHALL be translated by adapters.

#### Scenario: Same pipeline for Jira and Linear
- **WHEN** one ticket comes from Jira and another from Linear
- **THEN** both go through identical stations, gates and record formats

### Requirement: Ticket-provider adapter contract
A ticket-provider adapter SHALL support these operations:
- read a ticket and its spec
- change its status
- read and edit the factory comment
- add attachments
- read labels
- search tickets by factory state, label, repository and updated-since time.

#### Scenario: Incremental search
- **WHEN** the view asks for tickets updated since its last refresh
- **THEN** the adapter returns only tickets changed after that time, each with its factory comment

### Requirement: Bulk read of records
The ticket-provider adapter SHALL return tickets together with their run records for a whole search. It SHALL page through results, and it SHALL stay within the provider's documented rate limits by backing off when throttled.

#### Scenario: Provider throttles
- **WHEN** the provider returns a rate-limit response during a refresh
- **THEN** the adapter waits for the indicated time and retries, and the view shows the data as stale instead of failing

### Requirement: Source-control adapter contract
A source-control adapter SHALL support:
- branches and PRs
- CI results for a branch
- the provider's own auto-merge
- revert PRs
- comparing a merged diff with a given commit.

#### Scenario: Merged-as-is comparison
- **WHEN** record-merge asks whether the merged diff equals the factory's last pushed commit
- **THEN** the adapter answers yes or no from source control

### Requirement: Agent-runtime adapter contract
An agent-runtime adapter SHALL support:
- creating a worktree
- starting a headless session
- posting progress to the worktree
- returning a session reference the view can open on the machine that hosts the session
- reporting the session's cost at the end of a step, when the runtime can. A runtime that cannot SHALL report "unknown", and the factory SHALL carry on without a cost.

#### Scenario: Runtime without cost reporting
- **WHEN** the agent runtime reports "unknown" cost for a step
- **THEN** the run continues, the record holds no cost for that attempt, and Health leaves the ticket out of cost per merge

#### Scenario: Open in Orca
- **WHEN** a run record holds an Orca session reference and the view runs on the machine that hosts the session
- **THEN** the view's "Open in Orca" action opens that session

### Requirement: New provider without pipeline change
Adding a provider SHALL require only a new adapter and its entry in `.factory/adapters.yaml`. The pipeline, skills and view MUST NOT change.

#### Scenario: GitHub Issues added
- **WHEN** a project adds a GitHub Issues adapter
- **THEN** GitHub tickets appear on the Board and in Health with no change to the stations or the view

### Requirement: Secrets stay outside the repository
Adapter credentials MUST NOT be stored in the repository. They SHALL come from one of two places:
- in a developer's session: the developer's own environment or secret store
- in CI: one ticket-provider service account per project, whose token is held in the CI system's secret store.

`.factory/adapters.yaml` MUST NOT contain secrets.

#### Scenario: CI step without a service account
- **WHEN** `factory record-merge` runs in CI and no service-account token is available
- **THEN** the step fails with a message naming the missing secret, and it does not fail the project's build

#### Scenario: Token in config
- **WHEN** `factory doctor` finds a token-like value in `.factory/adapters.yaml`
- **THEN** it reports an error and names the field
