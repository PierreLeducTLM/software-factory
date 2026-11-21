# Proposal

## Why

The software factory design doc (rev 461) and the dashboard canvas (Board, Needs you, Health) describe a pipeline that turns an approved spec in any ticket tracker into a merged pull request. Neither is a spec yet, and they contradict each other: the doc has already dropped the background service, but the canvas still shows an "Orca bot" that queues and claims tickets. The doc also lets the factory view rebuild state from four sources (tickets, PRs, `factory/*` branches, Orca worktrees). This change turns both artifacts into one testable OpenSpec baseline for version 1 and applies two decisions:

1. **There is no orchestrator.** Nothing runs in the background, nothing claims a ticket on its own, and no process watches a queue. Every run starts because a developer typed a command, and every later update comes from that command or from a step in the project's own CI.
2. **The factory dashboard is populated from the ticket provider only, with no local database.** The view reads tickets, and the run records stored in them, through the ticket-provider adapter. It keeps state only in memory while it is open. It does not read branches, PRs or Orca worktrees to work out state, and it writes nothing to disk.

## What Changes

- Define the factory as a deterministic **factory CLI** called by skills (`/factory-run`, `/factory-next`) and by CI steps (`factory record-merge`, `factory revert`, `factory watch`). There is no service, daemon, bot, queue or scheduler.
- **BREAKING (vs. canvas):** remove every "bot", "queued", "next in line" and "picked up automatically" state from the dashboard. A ticket in Ready for Dev is either *waiting for a developer* or *eligible for `/factory-next`* (it has the auto label).
- **BREAKING (vs. design doc):** the factory view no longer reads source control, `factory/*` branches or Orca worktrees to build its state. Everything it shows comes from the ticket provider:
  - the factory state, the run record in the factory comment, labels and timestamps
  - links to the PR, branch and Orca session that the CLI wrote into the record.
- Make the **run record** complete enough to drive every view. It starts at the first refine session and holds the approval stamp and every run of the ticket: steps with start and end times, attempts, gate results, cost, risk, PR link, merge outcome and the Orca session reference. It also gets a defined size budget and an integrity check.
- Add a **`factory record-merge` CI step** that writes the merge outcome into the ticket ("merged as is" vs. "changed by a human", and the merge time) and detects reverts of factory changes. Without a service, nothing else would record them, and Health needs both. CI writes to the ticket as a per-project service account.
- Detect **interrupted runs** from the run record alone (a step past its timeout with no end time) instead of scanning Orca worktrees.
- Let a ticket have **several runs**, each with fresh attempts, and retry a Blocked ticket with `/factory-run`.
- Specify everything else in the design doc unchanged: refinement and the ready gate, revalidation, the check contract, the 5-attempt build loop and its three exits, risk assessment and shadow mode, adapters, the install wizard, the workflow-modification skill, the doctor command, and packaging.

## Capabilities

### New Capabilities
- `refinement`: refine session, decisions, ready gate, approval stamp with spec fingerprint and predicted risk, send-back intake.
- `run-lifecycle`: ticket states, developer-started pickup (`/factory-run`, `/factory-next`), claim by status transition, resume, interruption. No orchestrator.
- `gates-and-checks`: the gate sequence (ready, revalidate, quality, verify and review, risk) and the uniform check contract for script and agent checks.
- `build-loop`: the attempt loop (at most 5 per run), the no-questions rule, and the three exits (PR, send-back, Blocked) with their reports.
- `risk-and-merge`: risk signals and levels, merge policy, shadow mode, merge recording, auto-revert and the optional post-merge watch, all run from CI.
- `run-record`: the machine-readable record stored in the ticket. Covers its schema, single-writer rule, size budget, integrity and the PR mirror.
- `provider-adapters`: the standard model and the ticket-provider, source-control and agent-runtime adapter contracts, including the read queries the view depends on.
- `factory-view`: the read-only dashboard (Board, run detail, Needs you, Health), populated from the ticket provider only, with in-memory state, polling and no local database.
- `project-setup`: install wizard, `.factory/` configuration, workflow-modification skill, doctor, packaging, version pinning and schema migrations.

### Modified Capabilities
None. The repository has no specs yet, so this change establishes the baseline.

## Impact

- **Design doc (Software factory: design doc):** the Architecture section ("rebuilds the current state from tickets, PRs, factory/* branches and Orca worktrees") and the Visibility section have to be updated to match `factory-view` and `run-record`. Add `factory record-merge` to the CLI commands and the package contents.
- **Dashboard canvas (Software factory dashboard):** the Board's Ready column ("label or manual"), the Revalidate column ("bot · drift check"), the `ENG-90` card ("Auto · queued", "next in line"), the "picked up by the Orca bot" detail text, and the Needs you item "the bot will not pick it up" all need new wording. The Health view needs a data-freshness indicator in place of "Live".
- **Ticket provider load:** the view polls the provider's search API. Rate limits and comment size limits become design constraints (see design.md).
- **Project CI:** each installed project gains up to three factory steps: record-merge on merge to main, revert on red main after an auto-merge, and watch after a staging deploy. It also needs one ticket-provider service account, with its token in the CI secret store.
- **No new infrastructure:** no database, queue, server or hosted service is introduced.
