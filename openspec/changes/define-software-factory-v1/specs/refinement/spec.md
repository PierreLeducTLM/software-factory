# Spec Delta

## Purpose

Turns a ticket's draft spec into an approved, question-free contract before development starts, so that nothing asked after Ready for Dev ever needs a human answer.

## ADDED Requirements

### Requirement: Refinement starts from a draft spec in the ticket
The refine skill SHALL start only from a ticket that already holds a draft OpenSpec change, and it SHALL read and write that spec in the ticket. It MUST NOT write a spec from nothing.

#### Scenario: Ticket has a draft spec
- **WHEN** a person starts a refine session on a ticket in To refine that carries a draft spec
- **THEN** the skill loads the spec from the ticket and moves the ticket to Spec review

#### Scenario: Ticket has no spec
- **WHEN** a person starts a refine session on a ticket with no draft spec
- **THEN** the skill stops, explains that a draft spec is required, and leaves the ticket's status unchanged

### Requirement: Every open question becomes a recorded decision
During refinement the skill SHALL turn each open question into an entry in the spec's Decisions section: the question, the answer, and its effect on the spec. A question only counts as closed once it has a recorded decision.

#### Scenario: Question answered in session
- **WHEN** a person answers a question during a refine session
- **THEN** the spec's Decisions section gains an entry with the question, the decision and its effect, and the question is no longer listed as open

### Requirement: Ready gate is a script
The ready gate SHALL be a script with an exit code, run through the factory CLI, which writes its result to the refinement section of the ticket's factory comment. It passes only when all of these hold:
- the spec is valid
- no question is open
- the spec contains no TBD markers
- the Decisions and Affected paths sections are present
- every task is verifiable.

#### Scenario: Spec with a TBD marker
- **WHEN** the ready gate runs on a spec containing a TBD marker
- **THEN** the gate fails, lists the location of each marker, and the ticket stays in Spec review

#### Scenario: Complete spec
- **WHEN** the ready gate runs on a spec that meets every condition
- **THEN** the gate exits with success and the skill offers approval

### Requirement: Approval stamps the spec and predicts risk
Approving a spec that passed the ready gate SHALL go through the factory CLI, which writes an approval stamp to the refinement section of the ticket's factory comment. The refine skill MUST NOT write the stamp itself. The stamp holds:
- the approver
- the approval time
- the commit on the main branch at approval
- a fingerprint of the spec content
- the predicted risk level and the merge route that level implies.

The ticket then moves to Ready for Dev.

#### Scenario: Approval shows the merge route
- **WHEN** a person approves a spec whose predicted risk is low
- **THEN** the approval prompt states "Low risk, will auto-merge" (or "would auto-merge" while shadow mode is on) before the approval is recorded

#### Scenario: Approval without a passing ready gate
- **WHEN** a person tries to approve a spec whose last ready-gate run failed or is older than the latest spec edit
- **THEN** the skill reruns the ready gate and refuses approval if it fails

#### Scenario: Approval sets a merge ceiling
- **WHEN** the approver sets a merge ceiling (for example "human merge only") at approval
- **THEN** the ceiling is stored in the approval stamp and overrides the merge policy for this ticket

### Requirement: Send-back resumes refinement with recommended answers
When a ticket comes back from development, the refine skill SHALL present each finding as a question with a recommended answer. A new approval SHALL replace the previous approval stamp.

#### Scenario: Ticket sent back for drift
- **WHEN** a person opens a refine session on a ticket sent back with one drift question
- **THEN** the session shows the question and its recommended answer, and approving after the answer writes a new stamp with a new fingerprint and main-branch commit
