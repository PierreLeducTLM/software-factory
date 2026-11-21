# Spec Delta

## Purpose

Gives developers a read-only dashboard (Board, run detail, Needs you, Health) that is populated from the ticket provider alone. It needs no local database, no background service, and no reads of branches, pull requests or agent worktrees.

## ADDED Requirements

### Requirement: Ticket provider is the only data source
The factory view SHALL build every screen from the configured ticket-provider adapters only: ticket fields, statuses, labels, timestamps, factory comments and run records. It MUST NOT query source control, git branches or the agent runtime to work out state.

#### Scenario: Branch exists without a record
- **WHEN** a `factory/pay-160` branch exists but no ticket has a run record for it
- **THEN** the view does not show PAY-160 as running

#### Scenario: PR link shown
- **WHEN** a run record holds a PR link
- **THEN** the view shows the link as recorded, without calling source control

### Requirement: No local database
The view SHALL keep state in memory only while it is open. It MUST NOT create or use any database, cache file or other persistent local store. Closing and reopening the view SHALL rebuild the state from the ticket provider.

#### Scenario: Reopen after closing
- **WHEN** a developer closes the view and opens it again
- **THEN** the view performs a full read from the ticket provider, and no file written by an earlier session is read

### Requirement: Started on demand and read-only
The view SHALL start only when a developer runs `factory view`, and it SHALL stop when closed. It MUST NOT change any ticket, comment, label or status. Each action SHALL do one of two things: open the ticket, PR or Orca session from the recorded link, or copy the skill command to run. Actions that would need a write, such as adding the auto label, SHALL open the ticket in the provider instead.

"Open in Orca" SHALL be offered only when the run's recorded machine is the one the view runs on. For any other run, the view SHALL show the claimant's name.

#### Scenario: Teammate's run
- **WHEN** a developer selects a run claimed by a teammate on another machine
- **THEN** the detail shows "running in <teammate>'s Orca" and offers no "Open in Orca" action

#### Scenario: Add the auto label
- **WHEN** a developer selects "Add auto label" on an unlabelled ticket
- **THEN** the view opens the ticket in the provider and changes nothing itself

#### Scenario: Blocked ticket action
- **WHEN** a developer selects the action on a Blocked ticket
- **THEN** the view copies `/factory-run PAY-133` (or opens the failure report) and changes nothing in the ticket

### Requirement: Refresh by polling with visible freshness
While open, the view SHALL refresh by polling the ticket provider at a configurable interval (default 60 seconds), asking only for tickets updated since the last refresh. It SHALL display the time of the last successful refresh. If a refresh fails, it SHALL mark the data as stale.

#### Scenario: Provider unreachable
- **WHEN** a refresh fails because the provider is unreachable
- **THEN** the view keeps the last data, shows "stale since <time>", and retries at the next interval

### Requirement: Ready for Dev shows eligibility, never a queue
The Ready column and Needs you SHALL show each Ready for Dev ticket either as "eligible for /factory-next" (it carries the auto label) or as "waiting for a developer". The view MUST NOT show a ticket as queued, scheduled or about to be picked up automatically.

#### Scenario: Auto-labelled ticket
- **WHEN** ENG-90 is in Ready for Dev with the auto label
- **THEN** its card reads "Eligible for /factory-next" with the command to copy, not "Auto · queued"

### Requirement: Board shows one column per station
The Board SHALL show these columns: Ready, Revalidate, Build, Review, Pull request, Needs you, Done. Each card shows the ticket's latest run and SHALL show:
- key and provider
- the claimant, once claimed
- the attempt rows with build, gate, verify and review chips, for the last two attempts
- risk badge, time and cost (cost is left out when the record has none).

A merged run whose post-merge watch passed SHALL be marked "delivered" in the Done column. All card data SHALL come from the run record.

#### Scenario: Run with three attempts
- **WHEN** a run is on attempt 3
- **THEN** its card shows rows A2 and A3 and "+1 earlier attempts"

### Requirement: Run detail shows the timeline
Selecting a card SHALL open a run detail listing intake (spec, revalidate), each attempt with its sub-steps, and the delivery or outcome step. Each step SHALL show its recorded output, report or evidence link.

#### Scenario: Failed gate selected
- **WHEN** a developer selects "Quality gate" in attempt 1 of PAY-142
- **THEN** the detail shows the recorded failing tests and what changed for attempt 2

### Requirement: Interrupted runs are detected from the record
A ticket In development whose current step has a start time, no end time, and started longer ago than that step's timeout plus a grace period SHALL be shown as "interrupted", with the resume command `/factory-run <KEY>`. The grace period defaults to 10 minutes.

#### Scenario: Laptop closed mid-build
- **WHEN** PAY-142's build step started 40 minutes ago, has no end time, and its timeout is 25 minutes
- **THEN** the Board marks PAY-142 interrupted and offers `/factory-run PAY-142`

#### Scenario: Step still within its timeout
- **WHEN** a build step started 20 minutes ago and its timeout is 25 minutes
- **THEN** the run is shown as running, even if its session has in fact ended

### Requirement: Needs you lists every human decision
Needs you SHALL list, most urgent first:
- Blocked tickets, with `/factory-run <KEY>` to retry
- tickets in Ready for Dev or Blocked that reached their run limit, with the override command
- sent-back tickets
- PRs waiting for a human merge (medium and high risk, or any level in shadow mode)
- specs whose recorded ready-gate result is a pass and that wait for approval
- reverted or watch-failed tickets
- tickets whose record was edited outside the factory
- interrupted runs
- Ready for Dev tickets without the auto label waiting longer than a configured age.

#### Scenario: Ticket at its run limit
- **WHEN** PAY-133 is Blocked after its third run and the run limit is 3
- **THEN** Needs you shows PAY-133 as "Run limit reached (3 of 3)", with `/factory-run PAY-133 --over-limit` to copy

#### Scenario: Unlabelled ticket waiting
- **WHEN** PAY-151 has been in Ready for Dev without the auto label for 2 days and the threshold is 1 day
- **THEN** Needs you shows PAY-151 as "Not started", with `/factory-run PAY-151` to copy

### Requirement: Health computed from records only
Health SHALL compute these metrics from the run records of tickets in the selected period, broken down by provider:
- merged count
- first-pass rate
- average attempts
- send-backs
- blocked count
- cost per merge
- failure reasons by gate
- median time per station, including waiting for merge
- shadow-mode agreement per level
- reverts within 2 weeks.

For a ticket with several runs:
- first-pass rate SHALL count only tickets merged on attempt 1 of their first run
- average attempts and cost per merge SHALL sum every run of the ticket.

#### Scenario: Ticket merged on its second run
- **WHEN** a ticket was sent back at attempt 2 of its first run and merged on attempt 1 of its second run
- **THEN** it does not count as first-pass, and it adds 3 attempts and the cost of both runs to the averages

#### Scenario: Time waiting for merge
- **WHEN** Health computes "waiting for merge" for a merged ticket
- **THEN** it uses the PR-opened event and the merge time written by record-merge, both read from the run record

#### Scenario: Period switch
- **WHEN** a developer switches Health from 7 days to 30 days
- **THEN** the view fetches records for tickets finished in the last 30 days from the provider and recomputes, without reading any local store

### Requirement: Scoped to the current repository
The view SHALL show only tickets whose run record or factory configuration names the current repository. It SHALL use the developer's own provider credentials, so it never shows a ticket the developer cannot read.

#### Scenario: Shared Jira project
- **WHEN** a Jira project holds tickets for two repositories
- **THEN** the view for repository A shows only tickets whose record names repository A, or that match A's configured search
