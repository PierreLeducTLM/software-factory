# Tasks

Phases follow the design doc's implementation plan. A phase starts only once the previous phase's pilot gate (the last task in its group) is met. Every code task is test-driven: write a failing test from the named spec scenario first.

## 1. Align the source artifacts

Delivered as two new artifacts that replace the originals, which are left unchanged: "Software factory: design v2" and "Software factory dashboard v2".

- [x] 1.1 Write the design doc's Architecture section as described in design.md Migration Plan step 1, and verify the doc no longer mentions reading PRs, branches or Orca worktrees to build state
- [x] 1.2 Draw the architecture diagram with the record held in the ticket and the PR as a mirror, and add `factory record-merge` to the command list and the package contents; verify by reading the diagram and the Packaging section
- [x] 1.3 Write the design doc's other sections as described in design.md Migration Plan step 3; verify each of decisions D10 to D14 is reflected in the doc
- [x] 1.4 Reword the dashboard Board, run detail and Needs you screens (Migration Plan steps 4–5); verify that no screen contains "bot", "queued", "next in line" or "picked up", and that no button implies a write
- [x] 1.5 Add the risk badge, the claimant, the delivered mark, the freshness indicator, and the Interrupted, Reverted, Run limit and Record edited categories to the canvas, and add shadow agreement and reverts to Health; verify each `factory-view` requirement has a visible counterpart on the canvas (a failed staging watch has no sample item)

## 2. Phase 1: Foundation

- [x] 2.1 Define the `factory.yaml` and `adapters.yaml` schemas (versioned, no secrets), and verify that schema tests accept the doc's sample config and reject a config containing a token
- [x] 2.2 Implement the record codec (machine block, schema version, checksum, refinement section, list of runs, append-only events naming their writer), and verify the `run-record` scenarios "First refine session", "Later updates", "Status change", "Second run after a send-back" and "Person edits the factory comment" as tests
- [x] 2.3 Implement record size budgeting and compaction to an attachment, and verify the "Record near the Jira limit" scenario with a fake adapter
- [x] 2.4 Implement the ticket-provider adapter contract with an in-memory fake, and verify contract tests for read, transition, comment edit, attachment, labels and incremental search
- [ ] 2.5 Implement the Jira adapter against the contract, and verify that the shared contract tests pass against a recorded Jira sandbox, including rate-limit back-off
- [x] 2.6 Implement the source-control adapter (GitHub) for branches, PRs, CI results, auto-merge, revert and the merged-as-is comparison, and verify that its contract tests pass
- [x] 2.7 Check whether Orca can report a session's cost, then implement the agent-runtime adapter (Orca) for worktree, headless session, progress, session reference and optional cost at step end; verify that its contract tests pass, including the "Runtime without cost reporting" and "Open in Orca" scenarios
- [x] 2.15 Implement the Bitbucket source-control adapter against the shared contract, with a simulated Bitbucket built from Bitbucket's published API description; it merges directly in place of per-PR auto-merge and refuses to open revert PRs, which Bitbucket's API does not offer
- [x] 2.8 Implement the factory states mapping and the claim-by-transition step, and verify the "Two developers race", "Status mapped to a custom name", "Claim without a factory comment" and "Agent tries to transition" scenarios
- [x] 2.9 Implement `factory run` / `factory next` pickup with repository scoping and one run per worktree, and verify the "Run a named ticket", "Next ticket", "Nothing eligible", "Nobody runs a command", "Run after re-approval" and "Second run in the same worktree" scenarios
- [x] 2.10 Implement resume, takeover confirmation and step start and end timestamps, and verify the "Resume after laptop closed", "Resume by a different developer" and "Long build step" scenarios
- [x] 2.11 Add listing a ticket's attachments by name to the ticket-provider contract, the fake and the Jira adapter, so the official OpenSpec files attached to a ticket can be loaded and fingerprinted. Then implement `factory ready-gate` and `factory approve`: ready gate script, approval stamp with fingerprint, predicted risk, and the drift check. Verify every `refinement` scenario and the `gates-and-checks` revalidate scenarios
- [x] 2.12 Verify the "Factory installed with nothing running" scenario with a test that runs a full ticket and asserts no factory process is alive between commands
- [x] 2.16 Add the `factory` command-line entry point with `ready-gate`, `approve`, `revalidate`, `run` and `next`, and wire the real inputs the refinement commands take as parameters today: `openspec validate` on the attached files, the main-branch commit and the files changed since a commit from git, and the predicted risk from the risk script of task 6.1; verify each command end to end against the fakes
- [x] 2.18 Add `factory pull`, `factory push` and `factory status`, so a refine session can get the attached spec files into a change folder, attach what changed, and read the gate result, approval and send-back questions
- [ ] 2.17 Write the `factory-refine` skill from scratch (no earlier draft exists, and OpenSpec ships none): it starts refinement, turns each open question into a recorded decision, attaches the updated spec files, and calls `factory ready-gate` and `factory approve`; verify the "Question answered in session" and "Approval shows the merge route" scenarios in a refine session
- [ ] 2.13 Run the Jira, GitHub, Bitbucket and Orca adapters once against the real services (a Jira sandbox, a test repository on each host, a scratch Orca worktree), and verify the shared contract tests and the create, launch and progress commands behave as the simulated services assume
- [ ] 2.14 Pilot gate: one pilot ticket goes from Ready for Dev to a merged PR, and its run record alone explains every step

## 3. Phase 2: Reliable loop

- [x] 3.1 Implement the check contract runner (script exit code, `applies_when`, blocking or advisory, timeout, `source: ci`) and the fixed gate order, and verify each "Uniform check contract" scenario plus the "Non-zero exit" and "Quality gate fails" scenarios
- [x] 3.2 Implement agent-check verdict validation (structured verdict, required evidence), and verify the "Free-text answer" and "Missing evidence" scenarios
- [x] 3.3 Implement the attempt loop with a per-run limit (default 5) and the failure output fed forward, and verify the "Alternating failures" and "Gate failure feeds the next attempt" scenarios
- [ ] 3.4 Implement the Decisions → delta → canonical lookup and the send-back on an unanswered observable question, and verify both "No questions during development" scenarios
- [ ] 3.5 Implement the review station (OpenSpec verify, then an independent reviewer agent), and verify the "Verify finds an uncovered scenario" scenario
- [x] 3.6 Implement the three exits and their reports, with the diagnosis limited to {code, spec, environment}, and verify the "All gates pass on attempt 2", "Spec diagnosis after five failures", "Flaky end-to-end test" and "Report without diagnosis" scenarios
- [x] 3.7 Implement the retry of a Blocked ticket through `factory run`, and verify the "Retry after fixing a flaky test", "Drift since the ticket was blocked" and "Blocked ticket with the auto label" scenarios
- [x] 3.8 Implement the run limit per ticket (default 3, configurable) and the `--over-limit` override, and verify the "Fourth run refused", "Override" and "Next skips a ticket at its limit" scenarios
- [x] 3.9 Compact the oldest runs' attempt details to the archive attachment when the record is over budget, keeping each run's outcome, attempts used, time, cost and report link, and verify with a record holding three runs
- [ ] 3.10 Pilot gate: 10 pilot tickets processed, and every failure is explained by its report

## 4. Phase 3: Visibility (ticket provider only)

- [ ] 4.1 Build the view's in-memory model from adapter search results, and verify the "Branch exists without a record", "PR link shown" and "Board card rendered from the record" scenarios with a test that the view issues no source-control or agent-runtime calls and writes no files (filesystem spy)
- [ ] 4.2 Implement polling with incremental search, the "updated <time> ago" indicator and the stale state, and verify the "Provider unreachable" and "Reopen after closing" scenarios
- [ ] 4.3 Implement the Board (7 columns, claimant, last two attempt rows, risk badge, time, optional cost, delivered mark) and the Ready eligibility wording, and verify the "Run with three attempts" and "Auto-labelled ticket" scenarios
- [ ] 4.4 Implement the run detail timeline from the record, with "Open in Orca" only for runs on this machine, and verify the "Failed gate selected" and "Teammate's run" scenarios
- [ ] 4.5 Implement interrupted detection (step started longer ago than its timeout plus grace, with no end time), and verify the "Laptop closed mid-build" and "Step still within its timeout" scenarios
- [ ] 4.6 Implement Needs you with every category and urgency ordering, and verify the "Unlabelled ticket waiting" and "Ticket at its run limit" scenarios and the read-only "Blocked ticket action" and "Add the auto label" scenarios
- [ ] 4.7 Implement repository scoping and per-developer credentials, and verify the "Shared Jira project" scenario
- [ ] 4.8 Write the human progress summary in the factory comment and the PR description mirror, and verify the "PR and record agree" scenario
- [ ] 4.9 Pilot gate: the pilot is followed in the view with no manual status updates, and with source-control access disabled for the view

## 5. Phase 4: Portability

- [ ] 5.1 Implement `/factory-init` detect, verify and coverage for the TypeScript and Django stacks, with a CI-files fallback, and verify the "Timeouts from measurements" and "Unsupported stack" scenarios
- [ ] 5.2 Implement status and label matching, and verify the "All statuses match" scenario
- [ ] 5.3 Deliver the install PR (with the record-merge and revert CI steps, and watch when enabled) and one PR per added check, including the service-account setup and permission check, and verify the "Missing type checker", "Project without staging" and "Service account cannot transition" scenarios
- [ ] 5.4 Implement `/factory-workflow` (translate, validate, diff, run on main, PR), and verify the "New check fails on main" scenario
- [ ] 5.5 Implement `/factory-doctor` drift checks, including missing CI steps, the CI service account and secrets, and verify the "Renamed CI job" and "Token in config" scenarios
- [ ] 5.6 Package as a Claude Code plugin with version pinning and schema migrations, and verify the "Engine pinned" and "Upgrade with schema change" scenarios
- [ ] 5.7 Pilot gate: a second project on the other stack is installed with no hand edits

## 6. Phase 5: Risk and auto-merge

- [ ] 6.1 Implement the risk scoring script (signals, score, level, reasons, the higher of predicted and actual), and verify the "Diff riskier than predicted", "Reviewer attempts to lower" and "Risk report present" scenarios
- [ ] 6.2 Implement the merge policy, the overrides and shadow mode, and verify the "Ticket-level override", "Source control without per-PR auto-merge" and "Low risk in shadow mode" scenarios
- [ ] 6.3 Implement the `factory record-merge` CI step under the service account, with revert detection on every merge to main, and verify the "Human edits before merge", "Provider already moved to Done", "Person reverts a shadow-mode merge", "Ordinary merge" and "CI step without a service account" scenarios
- [ ] 6.4 Implement the `factory revert` and `factory watch` CI steps, and verify the "Red main after auto-merge", "Source control that cannot open a revert" and "Watch disabled" scenarios
- [ ] 6.5 Implement Health from records only (all metrics, by provider, period switch, several runs per ticket, shadow threshold suggestion), and verify the "Time waiting for merge", "Period switch", "Ticket merged on its second run" and "Threshold reached" scenarios
- [ ] 6.6 Implement the Linear and GitHub Issues ticket adapters against the shared contract tests, and verify the "Same pipeline for Jira and Linear" and "GitHub Issues added" scenarios
- [ ] 6.7 Pilot gate: low risk meets its shadow threshold, and auto-merge is enabled through a `/factory-workflow` PR
