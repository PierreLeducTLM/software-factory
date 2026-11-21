# Spec Delta

## Purpose

Stores all durable run state in the ticket itself, complete enough that the factory CLI can resume any run and the factory view can draw every screen from the ticket provider alone, with no database.

## ADDED Requirements

### Requirement: One factory comment per ticket holds the record
Each ticket the factory touches SHALL carry exactly one factory comment, edited in place. The comment SHALL contain:
- a short human-readable progress summary
- a machine-readable run record block with a declared schema version.

The comment SHALL be created at the ticket's first refine session, not at its first claim, so that refinement data and runs live in one place.

#### Scenario: First refine session
- **WHEN** the CLI records a ready-gate result for a ticket that has no factory comment
- **THEN** it creates the factory comment with a record at schema version 1 holding a refinement section and an empty list of runs

#### Scenario: Claim without a factory comment
- **WHEN** the CLI is asked to claim a ticket in Ready for Dev that has no factory comment or no approval stamp
- **THEN** it refuses the claim and reports that the ticket was not approved through the factory

#### Scenario: Later updates
- **WHEN** the CLI records a new step
- **THEN** it edits the existing factory comment rather than adding a new one

### Requirement: Record is complete enough for every view
The record SHALL contain everything the factory view needs, with no other source:

- **Ticket context:** the repository.
- **Refinement:** the latest ready-gate result, the approval stamp (approver, time, main-branch commit, spec fingerprint, merge ceiling) and the predicted risk.
- **Runs:** a list of runs, newest last. Each run holds:
  - its claimant, the machine it runs on, its status, current step, attempt number and limit
  - per step: start time, end time and timeout
  - per attempt: the result of each gate with duration, the key error, what changed, time and cost (cost is omitted when the agent runtime cannot report it)
  - the risk report and the decisions applied
  - the branch name, the PR link and state, and the Orca session reference
  - the merge outcome, and the revert, watch and delivered results.
- **Activity:** an append-only list of events.

#### Scenario: Board card rendered from the record
- **WHEN** the view renders the card for PAY-142
- **THEN** every value on the card (attempt rows, gate chips, time, cost, risk badge, PR link) comes from PAY-142's ticket fields and run record

### Requirement: Events are append-only
Events in the record SHALL be timestamped and appended. An existing event MUST NOT be edited or removed, except by the compaction rule.

#### Scenario: Status change
- **WHEN** the CLI moves a ticket from In development to In review
- **THEN** a new event with the transition and its time is appended, and earlier events are unchanged

### Requirement: Only the factory CLI writes the record
Only the factory CLI SHALL write the record or change a ticket's factory state. Skills SHALL call the CLI, including the refine skill, which records ready-gate results and approvals through it. Agents MUST NOT write the record or change a status directly.

The CLI writes under one of two identities: the developer's own credentials in a session, or the project's service account in CI. Each event SHALL name the identity that wrote it.

#### Scenario: Agent tries to transition
- **WHEN** an agent session attempts to change a ticket's status outside the CLI
- **THEN** the change is not part of the factory flow, and the next CLI action detects the mismatch and records it as an event

### Requirement: Record stays within provider limits
The record SHALL stay within the ticket provider's comment size limit, using these rules:
- Full logs and diffs SHALL be stored as ticket attachments or CI artifacts and linked from the record.
- When the record approaches the limit, the CLI SHALL compact the oldest event details into a linked attachment and keep the summary fields intact.

#### Scenario: Record near the Jira limit
- **WHEN** appending an event would push the factory comment past the configured size budget
- **THEN** the CLI moves the oldest events' details to an attachment, links it from the record, and appends the new event

### Requirement: Record integrity is verifiable
The record SHALL carry a checksum of its machine-readable block. A reader that finds a checksum mismatch SHALL treat the record as edited outside the factory.

#### Scenario: Person edits the factory comment
- **WHEN** a person edits the machine-readable block by hand
- **THEN** the view marks the ticket "record edited outside the factory", and the CLI refuses to resume until a developer confirms

### Requirement: Step timestamps for interruption detection
The CLI SHALL write a start time when each step begins and an end time when it finishes, together with the step's timeout. It MUST NOT write to the ticket while a step is in progress, because no factory process runs during a step.

#### Scenario: Long build step
- **WHEN** a build step runs for 18 minutes
- **THEN** the record is written once when the step starts and once when it ends, and not in between

### Requirement: One record holds every run of a ticket
Each claim SHALL append a new run to the record's list of runs. Earlier runs MUST NOT be overwritten. When the record approaches its size budget, the oldest runs SHALL be compacted first, keeping for each compacted run its outcome, attempts used, time, cost and report link.

#### Scenario: Second run after a send-back
- **WHEN** a ticket that was sent back is approved again and claimed
- **THEN** the record holds two runs: the first with outcome "sent back", and the new one at attempt 1

### Requirement: Pull request mirrors the delivery
The PR description SHALL mirror the delivery part of the record: spec link, decisions applied, gate results, attempts and the risk report. The PR is a mirror only. The ticket record SHALL remain the source the view reads.

#### Scenario: PR and record agree
- **WHEN** a PR is opened
- **THEN** its gate results and risk level equal those in the ticket's run record at that moment
