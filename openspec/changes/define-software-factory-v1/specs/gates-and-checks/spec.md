# Spec Delta

## Purpose

Defines the ordered gates a ticket passes and the single contract every check follows, so the factory CLI treats unit tests, scanners and agent reviews the same way and decides pass or fail deterministically.

## ADDED Requirements

### Requirement: Gates run in a fixed order
The gates SHALL run in this order:
1. Ready (during refinement)
2. Revalidate (at the start of development)
3. Quality (after each build)
4. Verify and review
5. Risk assessment (before the PR).

A later gate MUST NOT run before an earlier one passes within the same attempt.

#### Scenario: Quality gate fails
- **WHEN** the quality gate fails in attempt 1
- **THEN** verify and review do not run in attempt 1

### Requirement: Revalidate checks fingerprint and drift
At the start of development, the revalidate gate SHALL confirm two things:
- the spec's fingerprint still matches the approval stamp
- no change merged to main since the approval commit touches the spec's Affected paths or the canonical specs of its capabilities.

#### Scenario: Spec edited after approval
- **WHEN** the spec in the ticket was edited after approval and its fingerprint no longer matches
- **THEN** revalidate fails and the ticket is sent back to Spec review with a finding that the approved spec changed

#### Scenario: Relevant drift on main
- **WHEN** a ticket merged after approval changed a file under this spec's Affected paths
- **THEN** revalidate fails, the build does not start, and a send-back report names the drifting change and asks a question with a recommended answer

#### Scenario: No drift
- **WHEN** nothing under the Affected paths or related canonical specs changed since the approval commit
- **THEN** revalidate passes and attempt 1 starts

### Requirement: Uniform check contract
Every check SHALL be declared in `.factory/factory.yaml` with these fields:

| Field | Meaning |
|---|---|
| `id` | slug used in reports and the dashboard |
| `station` | where the check runs |
| `kind` | `script` or `agent` |
| `source` | `local` or `ci` |
| `blocking` | boolean |
| `applies_when` | path patterns |
| `timeout` | duration |
| `criteria` | rubric (agent checks only) |
| `evidence` | proof to attach (agent checks only) |

#### Scenario: Check outside its scope
- **WHEN** a check has `applies_when: "changed: src/ui/**"` and the diff touches no file under `src/ui/`
- **THEN** the check is recorded as skipped and does not affect the gate

#### Scenario: Advisory check fails
- **WHEN** a check with `blocking: false` fails
- **THEN** the gate still passes, and the failure is recorded as a warning in the run record and the PR description

#### Scenario: Check times out
- **WHEN** a check exceeds its `timeout`
- **THEN** the check is recorded as failed with reason "timeout"

#### Scenario: CI-sourced check
- **WHEN** a check has `source: ci`
- **THEN** the CLI reads the result of the matching CI job for the run's branch instead of running the check in the worktree

### Requirement: Script checks are decided by exit code
A script check SHALL pass if and only if its process exits with code 0.

#### Scenario: Non-zero exit
- **WHEN** a script check exits with code 1
- **THEN** the check fails, and its output is captured as the failure's key error

### Requirement: Agent checks return a structured verdict
An agent check SHALL return a verdict in a fixed format: `pass` or `fail`, a list of findings, and the evidence its declaration requires. Any other output SHALL count as a failure of the check itself.

#### Scenario: Free-text answer
- **WHEN** an agent check returns prose without a structured verdict
- **THEN** the check fails with reason "invalid verdict"

#### Scenario: Missing evidence
- **WHEN** the UI design check returns `pass` without the screenshots its declaration requires
- **THEN** the check fails with reason "missing evidence"

### Requirement: Reviewer is independent of the builder
The review station SHALL use a reviewer agent that did not write the code under review. It SHALL run OpenSpec verify before the reviewer agent.

#### Scenario: Verify finds an uncovered scenario
- **WHEN** OpenSpec verify reports a spec scenario not covered by the change
- **THEN** the review station fails without running the reviewer agent
