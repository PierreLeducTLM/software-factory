# Spec Delta

## Purpose

Bounds the build-and-check loop to five attempts per run, forbids questions during development, and guarantees that every way out of the loop leaves an explanatory report in the ticket.

## ADDED Requirements

### Requirement: An attempt spans build to review
One attempt SHALL consist of build, quality gate, and verify and review, in that order. A failure in any of them SHALL end the attempt, and the next attempt SHALL receive the failure output as input.

#### Scenario: Gate failure feeds the next attempt
- **WHEN** attempt 1 fails the quality gate with two failing tests
- **THEN** attempt 2 starts with the two test failures provided to the builder

### Requirement: At most five attempts per run
The factory SHALL count attempts per run, not per gate. A run SHALL use at most 5 attempts. The limit SHALL be configurable in `.factory/factory.yaml`, with a default of 5.

#### Scenario: Alternating failures
- **WHEN** a run fails the quality gate, then review, then the quality gate, then review
- **THEN** those count as attempts 1 to 4, and a fifth failure ends the run

### Requirement: No questions during development
During the loop, an agent MUST NOT ask a person anything. It SHALL resolve open points from these sources, in this order:
1. the spec's Decisions
2. the delta specs
3. the canonical specs.

Choices no one can observe (private names, helper structure) SHALL follow repository conventions.

#### Scenario: Answer found in Decisions
- **WHEN** the builder needs to know how partial refunds handle a missing amount and decision D-002 answers it
- **THEN** the builder applies D-002 without prompting anyone, and the run record notes the decision as applied

#### Scenario: Unanswered observable question
- **WHEN** the builder meets a question about observable behavior that none of the three sources answers
- **THEN** the run stops and the ticket is sent back with the question and a recommended answer

### Requirement: Pull request exit
When every gate passes, the factory SHALL open a pull request whose description contains:
- the spec link
- the decisions applied
- the gate results
- the attempts used
- the risk report.

The ticket SHALL move to In review, or be merged if the merge policy allows it.

#### Scenario: All gates pass on attempt 2
- **WHEN** attempt 2 passes every gate
- **THEN** a PR is opened with "attempts: 2" in its description, and the ticket moves to In review

### Requirement: Send-back exit
The factory SHALL send the ticket back to Spec review when any of these happens:
- revalidate finds drift
- an attempt finds a spec gap
- the failure diagnosis after the last attempt is "spec".

The send-back report SHALL state each finding as a question with a recommended answer.

#### Scenario: Spec diagnosis after five failures
- **WHEN** the fifth attempt fails and the diagnosis is "spec"
- **THEN** the ticket goes to Spec review, not Blocked, with each finding as a question

### Requirement: Blocked exit
When the last allowed attempt fails and the diagnosis is "code" or "environment", the factory SHALL move the ticket to Blocked and post a failure report. The report SHALL hold:
- per attempt: the failed gate, the key error and what changed
- one diagnosis
- a link to the branch that keeps the last attempt.

#### Scenario: Flaky end-to-end test
- **WHEN** five attempts fail on the same end-to-end test that passed and failed on identical code
- **THEN** the ticket moves to Blocked with diagnosis "environment" and a suggested next step

### Requirement: Diagnosis is one of three values
Every failure report SHALL carry exactly one diagnosis from {code, spec, environment}.

#### Scenario: Report without diagnosis
- **WHEN** the CLI composes a failure report
- **THEN** it refuses to post the report until exactly one diagnosis is set
