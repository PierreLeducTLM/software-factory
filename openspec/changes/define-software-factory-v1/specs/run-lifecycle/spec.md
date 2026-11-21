# Spec Delta

## Purpose

Defines how a run starts, is claimed, resumes and ends without any orchestrator. Every run is started by a developer command and driven by the factory CLI, and nothing runs in the background.

## ADDED Requirements

### Requirement: No orchestrator
The factory SHALL NOT include or require any long-running process to deliver tickets: no service, daemon, bot, scheduler, queue worker or webhook receiver. Every state change SHALL be caused by one of:
- a developer command (`/factory-run`, `/factory-next`, a refine or approve action)
- a factory CLI step run by the project's own CI
- the ticket provider's own automation (for example, Done on merge).

#### Scenario: Nobody runs a command
- **WHEN** a ticket sits in Ready for Dev with the auto label and no developer runs a factory command
- **THEN** the ticket stays in Ready for Dev indefinitely and no run is created

#### Scenario: Factory installed with nothing running
- **WHEN** a project has the factory installed and no factory process is running on any machine
- **THEN** every factory capability other than an in-progress run remains available on demand, and no ticket is lost or left half-claimed

### Requirement: Factory states map to provider statuses
The factory SHALL use these factory states: To refine, Spec review, Ready for Dev, In development, In review, Blocked, Done. Each SHALL map to one provider status as configured in `.factory/factory.yaml`.

| State | Who moves the ticket there |
|---|---|
| To refine | people |
| Spec review | the refine skill, or the factory CLI on send-back |
| Ready for Dev | the refine skill, on approval |
| In development | the factory CLI, from Ready for Dev or from Blocked |
| In review | the factory CLI |
| Blocked | the factory CLI |
| Done | the provider, or the factory CLI's record-merge step |

#### Scenario: Status mapped to a custom name
- **WHEN** a project maps In development to the Jira status "Doing"
- **THEN** every factory transition to In development moves the Jira ticket to "Doing"

### Requirement: Developer starts a run explicitly
A run SHALL start only when a developer runs `/factory-run <KEY>` or `/factory-next` in the project.

`/factory-next` SHALL pick the oldest ticket in Ready for Dev that carries the configured auto label, and it SHALL only pick tickets for the current repository.

#### Scenario: Run a named ticket
- **WHEN** a developer runs `/factory-run PAY-142` and PAY-142 is in Ready for Dev
- **THEN** the factory CLI claims PAY-142 and starts revalidation in the developer's current Orca worktree

#### Scenario: Next ticket
- **WHEN** a developer runs `/factory-next` and two auto-labelled tickets for this repository are in Ready for Dev
- **THEN** the CLI claims the one that entered Ready for Dev first

#### Scenario: Nothing eligible
- **WHEN** a developer runs `/factory-next` and no auto-labelled ticket for this repository is in Ready for Dev
- **THEN** the CLI reports that nothing is eligible and changes no ticket

### Requirement: Each claim starts a new run with fresh attempts
Every claim SHALL start a new run with its own attempt count starting at 1. A ticket MAY have several runs over its life, up to the run limit.

#### Scenario: Run after re-approval
- **WHEN** a ticket whose first run was sent back at attempt 3 is approved again and claimed
- **THEN** a second run starts at attempt 1 of 5, and the first run stays in the record

### Requirement: Runs per ticket are capped
A ticket SHALL have at most a configured number of runs. The limit SHALL be set in `.factory/factory.yaml`, with a default of 3. Every run counts, whatever its outcome.

Once a ticket has reached the limit:
- `/factory-run <KEY>` SHALL refuse to claim it and explain why
- `/factory-next` SHALL skip it
- the ticket's status SHALL stay unchanged.

A developer MAY start one more run with `/factory-run <KEY> --over-limit`. The CLI SHALL ask for confirmation and record the override, with the developer's name, as an event. Each run beyond the limit needs its own override.

#### Scenario: Fourth run refused
- **WHEN** a developer runs `/factory-run PAY-133` on a ticket that already has 3 runs and the limit is 3
- **THEN** the CLI refuses, states that the ticket reached its run limit, and changes nothing

#### Scenario: Override
- **WHEN** a developer runs `/factory-run PAY-133 --over-limit` on that ticket and confirms
- **THEN** a fourth run starts at attempt 1, and the record holds an override event naming the developer

#### Scenario: Next skips a ticket at its limit
- **WHEN** a developer runs `/factory-next` and the oldest auto-labelled ticket in Ready for Dev already has 3 runs
- **THEN** the CLI claims the next eligible ticket instead

### Requirement: A Blocked ticket is retried with /factory-run
A developer SHALL retry a Blocked ticket by running `/factory-run <KEY>` on it. The CLI SHALL ask for confirmation, move the ticket from Blocked to In development, revalidate, and start a new run. No new approval is needed, because the approved spec is unchanged. `/factory-next` MUST NOT pick a Blocked ticket.

#### Scenario: Retry after fixing a flaky test
- **WHEN** a developer runs `/factory-run PAY-133` on a Blocked ticket and confirms
- **THEN** PAY-133 moves to In development, revalidation runs, and a new run starts at attempt 1

#### Scenario: Drift since the ticket was blocked
- **WHEN** a Blocked ticket is retried and revalidation finds relevant drift on main
- **THEN** the ticket is sent back to Spec review instead of being built

#### Scenario: Blocked ticket with the auto label
- **WHEN** a developer runs `/factory-next` and the only auto-labelled ticket is Blocked
- **THEN** the CLI reports that nothing is eligible

### Requirement: Claim is the transition to In development
Before doing any work, the factory CLI SHALL claim the ticket by moving it to In development and recording the claim in the run record. If the transition fails because the ticket is no longer in Ready for Dev, the run SHALL stop without doing any work.

#### Scenario: Two developers race
- **WHEN** two developers run `/factory-run PAY-142` at the same moment
- **THEN** exactly one claim succeeds, and the other run stops with "already claimed by <developer>" and changes nothing

### Requirement: Resume from the run record
`/factory-run <KEY>` on a ticket already In development SHALL resume from the step and attempt held in its run record. It MUST NOT start a new run or reset the attempt count.

#### Scenario: Resume after laptop closed
- **WHEN** a developer runs `/factory-run PAY-142` on a ticket In development whose record shows attempt 2 at the build step
- **THEN** the run continues attempt 2 at the build step, and the attempt count stays at 2

#### Scenario: Resume by a different developer
- **WHEN** a developer other than the original claimant runs `/factory-run` on a ticket In development
- **THEN** the CLI asks for explicit confirmation to take over, then records the takeover as an event before resuming

### Requirement: Concurrency is per worktree
The factory SHALL allow at most one active run per Orca worktree. It SHALL impose no global limit on the number of runs.

#### Scenario: Second run in the same worktree
- **WHEN** a developer runs `/factory-run ENG-87` in a worktree that already hosts an active run for PAY-142
- **THEN** the CLI refuses and suggests opening a new worktree
