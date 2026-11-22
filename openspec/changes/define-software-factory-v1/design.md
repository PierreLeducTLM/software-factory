# Design

## Context

**Sources analyzed (read in full):**
- *Software factory: design doc*, rev 461: all sections, the 3 diagrams (end-to-end process, architecture, implementation plan), the 3 code blocks and the Decisions table.
- *Software factory dashboard* canvas: 3 screens. **Board** has 7 columns and a run-detail drawer with sample runs PAY-151, ENG-90, PAY-149, PAY-142, ENG-87, #231, PAY-138, PAY-133, PAY-147 and PAY-130. **Needs you** has 5 items. **Health** has KPIs, failure reasons, time per station and outcomes by provider.

The repository is greenfield: it has one initial commit and no code and no specs. The baseline is therefore expressed as new capabilities. For motivation and the two adjustments, see proposal.md (Why).

### Analysis: where the two artifacts stand against the adjustments

| # | Finding | Source | Status after this change |
|---|---|---|---|
| A1 | The doc already says there is no running service and that `/factory-run` starts runs (Decisions: "Where the orchestrator runs"). | Doc, Architecture + Decisions | Kept, and made normative in `run-lifecycle` ("No orchestrator") |
| A2 | The canvas still shows an orchestrator: "Auto · queued", "next in line", "picked up by the Orca bot", "bot · drift check", "the bot will not pick it up". | Canvas: Board, run detail, Needs you | Contradiction. Wording replaced (see Migration Plan) |
| A3 | The doc's view "rebuilds the current state from tickets, PRs, factory/* branches and Orca worktrees". | Doc, Architecture | **Changed:** ticket provider only (`factory-view`) |
| A4 | The architecture diagram shows run records "stored in tickets and PRs". | Doc, diagram | The ticket is the source of record. The PR is a mirror the view never reads (`run-record`) |
| A5 | Interrupted runs were inferred from Orca worktrees. | Doc, Architecture | **Changed:** inferred from the current step's start time and timeout (D4) |
| A6 | Health needs merge outcomes ("merged as is vs. changed", time waiting for merge, reverts within 2 weeks), but nothing in a serviceless design writes them to the ticket. | Doc, Shadow mode; Canvas, Health | **Gap closed:** `factory record-merge` CI step |
| A7 | Cost per merge and time per station appear on the Board and in Health, but the doc never says where cost comes from. | Canvas | **Gap closed:** the record holds time and cost per attempt, taken from the agent runtime at step end |
| A8 | Health shows "Outcomes by provider" (Jira, Linear, GitHub at once), but scope says "one repository at a time". | Canvas, Health; Doc, Scope | Compatible: one repository, several ticket providers. The view merges all configured ticket adapters |
| A9 | Comment size limits (for example, Jira's ~32k characters) and 5 attempts of events can collide. | Doc, State without a database | **Gap closed:** size budget plus compaction to an attachment |
| A10 | Anyone with edit rights can hand-edit the factory comment. | Doc, "Only the factory CLI writes" | **Gap closed:** checksum. The view flags the record, and the CLI asks before resuming |
| A11 | Manual reverts (not opened by `factory revert`) are not detected, so the shadow threshold's "no revert" test could never fail. | Doc, Shadow mode aftermath | **Gap closed:** `record-merge` detects revert PRs and `git revert` commits on main (D11) |
| A12 | The canvas column "Ready: label or manual" implies the label starts work. | Canvas, Board | Reworded: the label means *eligible for `/factory-next`* |
| A13 | The canvas uses "Live · sample data" with no freshness indicator. | Canvas | The view shows its last refresh time and marks data stale on failure |
| A14 | "Needs you · 5" counts PRs of every risk level. The doc says medium and high only. | Canvas vs. Doc | Spec: medium and high, or any level while that level is in shadow mode (every level at first) |
| A15 | The canvas has no risk badge on cards, although the doc's Board row lists one. | Canvas vs. Doc | Spec requires the risk badge. The canvas needs it added |
| A16 | Several runs can be "In development" for the same developer, but nothing defines what happens when a session dies. | Doc | Resume rules plus takeover confirmation (`run-lifecycle`) |
| A17 | The CI steps must write to the ticket, but tokens live only in developers' environments. | Doc, Packaging | **Gap closed:** one service account per project, in CI secrets (D12) |
| A18 | The approval stamp is written before the run record exists, by a skill that is not the CLI. | Doc, State without a database | **Gap closed:** the factory comment starts at the first refine session, and the CLI writes the stamp (D13) |
| A19 | A sent-back or Blocked ticket runs again, but the doc defines neither a second run nor a way out of Blocked. | Doc, Build loop; Canvas, PAY-133 | **Gap closed:** new run with fresh attempts, and `/factory-run` retries a Blocked ticket (D14) |
| A20 | The canvas offers "Add auto label", "Start in Orca" and "Retry after fix", which would be writes from a read-only view. | Canvas, Needs you | Buttons open the ticket or copy a command |
| A21 | "Open in Orca" points at a session on one developer's machine. | Canvas, run detail | Offered only on that machine; otherwise the claimant is shown |
| A22 | The canvas shows GitHub Issues tickets, but the plan builds no GitHub Issues adapter. | Canvas; Doc, Implementation plan | Task added in phase 5 |
| A23 | The doc counts "fixes or reverts within 2 weeks". A fix cannot be told apart from ordinary work. | Doc, Shadow mode | Only reverts are counted |
| A24 | "A pass marks the run delivered" has no place on the Board or in the record. | Doc, Post-merge watch | "Delivered" recorded and shown in Done |
| A25 | Running cards carry "Manual" and "Auto" badges that meant "started by the bot or by a person". | Canvas, Board | Replaced by the claimant's name |

## Goals / Non-Goals

**Goals:**
- Each view value can be traced to one field in a ticket's run record or ticket metadata.
- Every factory write is attributable to one CLI invocation: from a developer's session, or from a CI step.
- The design works with nothing running, and it survives a closed laptop at any step.

**Non-Goals:**
- Real-time push to the view. Webhooks would need a receiver, which is a service.
- A cross-repository portfolio view.
- Caching across view sessions. Any persistent cache would be a local database by another name.
- Reading CI dashboards or PR pages to correct the record. If the record is wrong, the fix belongs in the CLI step that wrote it.

## Decisions

### D1. Two kinds of writer, and no third
The only writers are the factory CLI run from a developer's session, and the factory CLI run as a CI step (`record-merge`, `revert`, `watch`). Provider automation (Done on merge) is tolerated but not relied on.
- *Alternative considered:* a small webhook service for merges and CI results. Rejected because it contradicts "no orchestrator", and CI already runs at exactly the moments that matter.

### D2. The ticket is the only source the view reads
The record stores links (PR URL, branch, Orca session) and outcomes rather than asking source control at view time.
- *Alternative considered:* mixed reads (tickets for state, source control for PR state). Rejected because of the adjustment, and because it needs two sets of credentials and two rate limits, and lets the two sources disagree.
- *Cost:* PR state in the view is only as fresh as the last CLI or CI write. That is acceptable because every meaningful PR transition is followed by a factory write (open → CLI; merge → record-merge; revert → revert).

### D3. Record lives in one edited comment, with a fenced machine block
The record is a human summary on top and a fenced, versioned machine block below it, plus a checksum.
- *Alternative considered:* Jira entity properties. They are invisible, structured and bulk-readable in JQL search, but Jira-only. They stay allowed as an adapter-internal optimization: the Jira adapter may mirror the block into a property for faster bulk reads, as long as the comment remains the canonical copy.
- *Alternative considered:* one comment per event. Rejected because it floods the ticket and multiplies reads.

### D4. Interruption = a step past its timeout
The CLI only runs between steps, so nothing can write to the ticket while the agent builds. The CLI therefore writes a start time, an end time and the timeout for each step. The view shows a run as interrupted when its current step has no end time and started longer ago than its timeout plus a 10-minute grace period.
- *Cost:* a session that dies early in a step is only flagged once that step's timeout has passed.
- *Alternative considered:* a session-scoped process refreshing a heartbeat every 5 minutes. Rejected: it is a background process, which is what "no orchestrator" rules out.
- *Alternative considered:* the agent calling `factory heartbeat` while it works. Rejected: it depends on the agent remembering.
- *Alternative considered:* scanning Orca worktrees. Rejected under D2.

### D5. View refresh = incremental search plus in-memory model
- On start, the view runs one full search per ticket adapter: the open factory states, plus Done within the Health window.
- After that, it runs a search for tickets updated since the last refresh every 60 seconds (configurable).
- It keeps everything in an in-memory map and throws it away on close.
- Changing the Health window triggers a new provider search, not a local query.

### D6. Repository scoping
The record carries the repository identifier. Each ticket adapter's search is also narrowed by a per-repository filter in `adapters.yaml` (a JQL fragment, a Linear team or project, or a GitHub repo), so a shared tracker project serves several repositories.

### D7. Merge outcome computation
`record-merge` compares the merged tree with the factory's last pushed commit through the source-control adapter. Health treats any difference as a disagreement. Only CI steps use source control; the view never does.

### D8. Cost source
At each step end, the agent-runtime adapter reports token cost for the session. The CLI writes cost per attempt. Health sums the cost across all attempts of every run of a merged ticket.

This assumes Orca can report a session's cost, which has not been checked. Cost is therefore optional in the record: without it, cards show no cost and the ticket is left out of cost per merge.

### D9. Command surface (CLI)
| Command | Called by | Purpose |
|---|---|---|
| `factory ready-gate` / `factory approve` | the refine skill | ready-gate result, approval stamp |
| `factory run <KEY>` / `factory next` | the skills `/factory-run`, `/factory-next` | claim, revalidate, loop, exits, retry of a Blocked ticket |
| `factory record-merge` | CI, on every merge to main | merge outcome, Done, revert detection |
| `factory revert` | CI, on red main after an auto-merge | revert PR, back to shadow mode, Needs you |
| `factory watch` | deploy pipeline (optional) | smoke checks, delivered or reverted |
| `factory view` | developer | read-only dashboard |
| `factory doctor` / `init` / `workflow` | skills | setup and maintenance |

### D10. One comment from refinement to delivery
The factory comment is created at the first refine session. It holds a refinement section (ready-gate result, approval stamp, predicted risk) and a list of runs. The refine skill calls `factory ready-gate` and `factory approve`, so the CLI stays the only writer and the view reads one place.
- *Alternative considered:* a separate approval comment written by the refine skill. Rejected: two writers and two formats.
- *Alternative considered:* the stamp inside the spec text. Rejected: approving would change the content the fingerprint covers.

### D11. Reverts are detected from main
`record-merge` runs on every merge to main, not only on factory PRs. Besides recording merge outcomes, it recognizes revert PRs and `git revert` commits, which name the change they revert, and marks the original ticket as reverted. This is what makes the shadow threshold's "no revert within 2 weeks" test meaningful while people are still merging.
- *Alternative considered:* a `factory:reverted` label added by hand. Rejected: the safety check would silently depend on people remembering.

### D12. CI writes as a service account
The CI steps use one ticket-provider service account per project, with its token in the CI secret store. The wizard sets it up and checks its permissions, and `factory doctor` flags it when missing or expired. Every event names the identity that wrote it, so a CI write is distinguishable from a developer's.
- *Alternative considered:* CI writes only to the PR and a later developer command copies the outcome into the ticket. Rejected: the view would have to read PRs, or show outcomes late.

### D13. Several runs per ticket
Each claim appends a new run with fresh attempts. A ticket gets at most 3 runs by default, configurable in `factory.yaml`. At the limit, `/factory-run` refuses, `/factory-next` skips the ticket, and Needs you lists it. A developer can start one more run with `--over-limit`, which is confirmed and recorded. This stops an endless send-back or retry loop while leaving a deliberate way through.
- *Alternative considered:* no cap, with Health showing tickets that have 3 or more runs. Rejected: it only makes the loop visible.
- *Alternative considered:* a hard cap with no override. Rejected: a ticket could become impossible to deliver through the factory.

Health's first-pass rate counts only tickets merged on attempt 1 of their first run, while average attempts and cost per merge sum every run.

### D14. Leaving Blocked
`/factory-run <KEY>` on a Blocked ticket asks for confirmation, moves it to In development, revalidates and starts a new run. No new approval is needed because the spec is unchanged, and revalidation still catches drift. `/factory-next` never picks a Blocked ticket.
- *Alternative considered:* a person drags the ticket back to Ready for Dev. Rejected: a status change outside the CLI.
- *Alternative considered:* always back through refinement. Rejected: a human approval to retry after fixing a flaky test.

### D16. The developer's session drives the loop
The agent in the session where `/factory-run` was typed is the builder. The skill calls `factory advance` repeatedly. Each call moves the run one step and says what comes next: build, verify, review, diagnose, or done. The gates run inside the command, and the ticket is written once per call.

| Where the run stands | What `advance` needs | What it does |
|---|---|---|
| Just claimed | nothing | Revalidates. Drift sends the ticket back. Otherwise it asks for the build |
| Build in progress | what was built and the decisions applied, or a question | Runs the quality gate. A question sends the ticket back |
| Verify in progress | the OpenSpec verify verdict | Judges it, then asks for the review |
| Review in progress | the reviewer's verdict, and one per agent check in scope | Judges them, runs the review station's scripts, then opens the pull request |
| Any gate failed | | Starts the next attempt with the failures as feedback, or asks for a diagnosis after the last one |
| Diagnosis needed | one of code, spec, environment | Spec sends the ticket back with questions. Code or environment blocks it with a failure report attached |

- *Alternative considered:* `factory run` staying in the foreground and launching headless Orca sessions for the builder and the reviewer. Rejected for now: it depends on waiting for and reading Orca sessions, which is unverified, and one long command must stay alive.
- *Cost:* the reviewer is a fresh subagent started by the skill, so its verdict passes through the builder's session before the command checks it. The command validates the verdict's format and evidence, but cannot prove who wrote it.
- **Step timeouts are fixed for now:** revalidate 2 minutes, build 30, verify 10, review 15, diagnose 10. The quality step's timeout is the sum of its checks' timeouts. They are not in `factory.yaml` yet.
- **The factory's own attachments start with `factory-`:** the failure report and the record archive. They are never read as spec files. Without the prefix, a failure report changed the spec's fingerprint and the retry was sent back.
- **The pull request is opened without a risk level beyond the predicted one.** Risk assessment before the PR belongs to phase 5.

### D17. The dashboard is a TanStack Start app
`factory view` starts a TanStack Start (React) app from `view/`, built for Node and bound to 127.0.0.1. Server functions read the tickets; the browser never talks to the ticket provider and holds no credentials.

- **Three layers, each tested on its own.** The model turns tickets and their records into columns, cards, the run detail and the Needs you list. The store keeps tickets in memory and asks the provider only for what changed. The components render that data and are tested in a real browser.
- **Refresh.** The page reloads its data every `view.poll_seconds` (60 by default). The server asks the provider at most once per interval, however many pages are open.
- **Sample mode.** `factory view --sample` shows sample tickets through the same model and screens, with no project config and no credentials.
- **Runs record the real machine name.** Orca's host id is "local" on every computer, so it could not tell two machines apart. Runs now record the hostname, which the one-run-per-worktree check and the "on your machine" note use.
- **"Open in Orca" runs on the view's own server.** A web page cannot run the Orca command, but the view's server runs on the developer's machine. For a run recorded on this machine, the run detail offers "Open in Orca", and the server runs `orca worktree activate` on the worktree the record names. The page sends only the ticket key, and a record edited by hand opens nothing. It changes no ticket, so the view stays read-only.
- **Health** is the third page. See D19.
- *Alternative considered:* a server-rendered page with no framework. Rejected in favour of TanStack Start.
- *Alternative considered:* a terminal view. Rejected: it drops the mockup's layout.

### D18. Risk is scored by the factory, and the project can add its own signals
Risk is scored in code from `risk` in `factory.yaml`, so every project gets the same arithmetic.

| Signal | Points | Source |
|---|---|---|
| Sensitive paths | 4 | `risk.sensitive_paths` |
| Kind of change | per kind: migration 3, dependency update 2, CI or infrastructure 2 by default | `risk.kinds` |
| Size | 2 for more files than `size.files`, 2 for more lines than `size.lines`, 1 for more than one capability | the diff and the delta specs |
| Confidence | 1 for 2 attempts, 2 for 3 or more, 1 when an advisory check failed | the run record |
| Project signals | any, including negative | `risk.script` |

The score becomes a level at `risk.thresholds` (medium 3, high 6 by default), so one sensitive path is always at least medium.

- **Predicted risk** applies the same path rules to the "Affected paths" section of the spec, and counts its delta specs.
- **Coverage of changed lines and a feature-flag safety net** are not built in, because both depend on the project's tooling. A project reports them through `risk.script`, which prints `{"signals":[{"name","points","reason"}]}`. A script that fails or prints anything else makes the change high risk.
- **The reviewer raises the level** by adding `risk` and `riskReason` to its verdict. A lower level, or an empty reason, is ignored.
- **The merge route is decided when the pull request opens** and written on the run with its reason: the level's route, then the approval ceiling, the `no_automerge` label, and shadow mode. The dashboard shows that recorded decision; it does not recompute it.
- **Shadow mode per level.** `risk.shadow` applies to every level; a level's own `shadow` overrides it. Turning auto-merge on for a level is one line: `low: { merge: auto, shadow: false, auto_since: <date> }`.
- **"Back to shadow mode" needs no stored switch.** Before turning auto-merge on, the factory searches the tickets updated since the level's `auto_since` date. If one of them was auto-merged at that level and then reverted, the level is treated as in shadow mode. A person turns it back on by moving `auto_since` to a later date, in a reviewed pull request.
- **A refused auto-merge leaves the pull request open.** The refusal reason is written on the run and the pull request, and the ticket shows in Needs you. On Bitbucket, the first merge attempt comes right after the pull request opens, so it is refused whenever a required build has not finished.

### D19. CI steps and Health
`factory record-merge`, `factory revert` and `factory watch` take `--commit` (HEAD by default) and, optionally, `--pull-request`.

- **Finding the pull request.** The step reads the commit message: "Merge pull request #N" and "(#N)" on GitHub, "(pull request #N)" on Bitbucket. A rebase merge names no pull request, so its CI must pass `--pull-request`.
- **Finding the ticket.** A factory pull request starts with `Ticket: <KEY>`. A merge with no such line, or whose ticket has no run for that pull request, writes nothing.
- **Reverts.** A revert pull request names the one it reverts; a `git revert` commit names the commit, whose message names the pull request.
- **A CI step never fails the build.** With no service-account token, or when a provider is down, the step prints the reason and "The factory step was skipped", and exits 0. Only `factory watch` exits 1, when a smoke check fails.
- **A hand-edited record is left alone in CI.** No person is there to confirm it, so the step writes nothing.
- **Watch.** `watch: { enabled, checks, duration, interval }` in `factory.yaml`. The step runs every smoke command each interval for the duration. The first failure opens a revert, or records that one is needed. A pass marks the run delivered, shown as "Delivered" in Done.
- **Needs you** lists a merged change whose revert is still open or still to do, before anything else.
- **Health** reads the tickets updated in the period (7, 30 or 90 days) from the provider on each visit, and computes every metric from their records. "Waiting for merge" runs from the end of the run's last step to the merge time.
- **Cost per merge is shown as "Not reported".** Orca does not report cost (A-finding), so there is nothing to sum.
- **The shadow-mode suggestion counts the latest changes of a level in the chosen period.** A threshold of 20 may need the 30- or 90-day period to be reached.

### D20. Setup commands, the engine pin and upgrades
- **`factory doctor` and `factory migrate` work on a broken setup.** They do not load the configuration up front, since reporting a broken one is their job. They reach the ticket provider or the source control only for the step that needs it: `--ticket` for the doctor, the pull request for migrate.
- **The pin names a release.** `engine: 0.1.0` in `factory.yaml` accepts any 0.1.x engine. Every ticket command and CI step refuses a project pinned to another release, and a CI step then skips without failing the build, as in D19. This is what keeps one project's upgrade from changing another's behavior.
- **`factory migrate` is the upgrade.** It opens one pull request that pins the running engine and applies any schema migration, on a `factory/upgrade-engine-<version>` branch cut from the latest main in a temporary worktree, so the developer's checkout is untouched. Until it is merged, the project keeps its pin. It never moves a project to an older release. When the schema does not change, only the `engine:` line changes, so comments and layout survive. A schema migration rewrites the file.
- **Doctor's exit code.** 0 when nothing drifted, 1 when it found drift, 2 for misuse, so a script or a scheduled CI job can stop on drift.
- **The install wizard is a skill over four commands.** `factory init detect`, `statuses`, `install` and `pull-request` each do one step and answer in JSON. The skill holds the conversation and writes the person's answers to a JSON file outside the repository. Before install, no `adapters.yaml` exists, so the commands build the provider connections from the answers. `install` checks the service account on a real ticket first, and opens nothing when it lacks a permission.
- **An added check is its own pull request, made by the skill.** Adding a type checker means installing a tool and adding a script, which is code the agent writes and runs. The command line only opens the pull request, against the project's source control. The check joins `factory.yaml` through `/factory-workflow` once its pull request is merged.
- **`factory workflow` compares the working tree with main.** The skill edits `.factory/` in a worktree of the latest main, and the command validates the result, diffs the checks against `origin/<main_branch>`, and runs the new and changed checks in that folder. A rubric that changed counts as a change on its own. The branch is named after the title the person gives.
- **The repository is the plugin.** `.claude-plugin/plugin.json` and the `skills/` folder make it installable with `/plugin`. The plugin, the npm package and the engine carry one version, which a test enforces. The plugin does not install the `factory` command: it must be on the PATH, and the pin check catches an install of the wrong release.

### D15. Adapter choices found while building
- **Repository scoping is the adapter's configuration, not a search criterion.** A ticket-provider adapter is created for one repository with one filter, and every ticket it returns names that repository.
- **The refine skill is written from scratch, and there is no revalidate skill.** The first design doc assumed drafts of `openspec-refine` and `openspec-revalidate` existed. They do not, and OpenSpec ships neither. The factory gets one skill, `factory-refine`, named for the factory so it is not mistaken for an OpenSpec skill. Revalidation is a step `factory run` performs through the CLI, not a skill.
- **The command line.** `factory` has `refine`, `status`, `pull`, `push`, `ready-gate`, `approve`, `revalidate`, `run` and `next`. Each takes `--json`. Exit code 0 means done, 1 means refused or a gate failed, 2 means misuse or a project that is not set up. Messages for people go to stdout, refusals to stderr.
- **Predicted risk is "high" for every ticket for now.** The risk script belongs to phase 5. Until it exists, no approval promises an auto-merge.
- **One ticket provider per project for now.** The command line uses the Jira entry of `adapters.yaml`. Several providers feeding one repository, as the dashboard shows, is not wired yet.
- **Attached spec files are named by their path, with `__` in place of `/`.** Tracker attachments cannot hold folders, so `specs/billing/spec.md` is attached as `specs__billing__spec.md`. Only `.md` attachments count as spec files, and the newest copy of a name wins.
- **The ready gate's own checks are structural.** It requires `proposal.md`, `design.md`, `tasks.md` and one delta spec; no TBD marker; a Decisions section; an Affected paths section listing at least one path; no content under Open Questions other than "None"; and the word "verify" (or "verified", "verifies") in every task. Spec validity itself comes from `openspec validate`.
- **Drift is path-based.** Revalidation fails when a file changed on main since the approval commit matches an Affected path (exact, a directory, or a `*` / `**` pattern) or sits under `openspec/specs/<capability>/` for a capability the change touches.
- **Jira: the factory comment is found through an issue property.** The property holds only the comment's id. The comment itself is always read, so a hand edit is seen by a single read and by a search. The cost is one extra request per ticket in a search.
- **Jira: the claim lock relies on the workflow.** Jira has no compare-and-set. A second claim fails only because the workflow offers no transition from In development to In development. The install wizard and `factory doctor --ticket` check it on a real ticket: a global transition into the in-development status, or a transition from it to itself, breaks the lock. The wizard then opens no pull request, and the doctor reports `claim_lock`.
- **The spec lives in two places in the ticket.** The description holds the general spec for people. The official OpenSpec files (proposal, design, delta specs, tasks) are attached to the ticket, and those attachments are what the factory loads, fingerprints at approval and builds from. The ticket-provider contract therefore needs to list a ticket's attachments by name, which it does not do yet.
- **GitHub: "merged as is" means the pull request's head commit at merge is the factory's last pushed commit.** A commit pushed by a person, including a conflict resolution, changes the head.
- **GitHub: branches are not created through the adapter.** The Orca worktree creates the branch and git pushes it.
- **Bitbucket has no per-pull-request auto-merge in its API.** Checked against Bitbucket's published API description: the only related item is a branch restriction that allows the feature in the UI. On Bitbucket, handing a pull request to auto-merge therefore calls the merge endpoint once. It merges if the branch restrictions allow it, joins the merge queue when one is active, and otherwise fails with Bitbucket's reason. The factory must have seen CI green before it calls, because Bitbucket will not wait.
- **Bitbucket has no API to revert a pull request.** `factory revert` cannot open a revert PR there. It flags the ticket in Needs you with a link to the pull request, and a person reverts from Bitbucket's page.
- **Bitbucket details.** It reports short commit hashes, so "merged as is" compares by prefix. It has no merge timestamp, so the merge time is the pull request's last update. A CI job is a build status looked up by key on the branch's head commit.
- **Orca reports no session cost.** Checked against Orca CLI 1.4.265: none of its 413 commands exposes cost or token usage. The adapter always answers "unknown", so cards show no cost and cost per merge stays empty until another source is found.

## Risks / Trade-offs

- [Provider rate limits when many developers keep the view open] → Incremental search, a configurable interval, back-off on throttling, and a visible "stale since" indicator. In Jira, one search with comment expansion per refresh. Consider entity-property mirroring (D3) if this proves costly.
- [Records drift from reality when a CI step is missing or fails] → `factory doctor` checks that the CI steps exist. The view flags tickets In review for longer than N days with no merge outcome as "outcome unknown".
- [An undo written by hand, with no reference to the original change, is not detected as a revert] → Accepted for v1. Revert PRs and `git revert` commits are detected (D11).
- [A dead session is flagged only after its step's timeout (D4)] → Accepted. Timeouts are set from measured durations, so the delay is bounded by how long the step normally takes.
- [The service account can write to any ticket it can reach] → Give it comment and transition rights on the factory's projects only. Every event names its writer.
- [The run limit is reached for reasons outside the ticket, such as a flaky environment] → The `--over-limit` override, recorded with the developer's name.
- [Orca may not report cost] → Cost is optional (D8). Check before building the Health cost tile.
- [Comment size limit] → Size budget plus compaction to an attachment (`run-record`). Large logs always go to attachments.
- [Hand-edited record] → Checksum. The view flags the ticket, and the CLI asks for confirmation before resuming.
- [PR state in the view lags reality] → Accepted (D2). Each PR transition is followed by a factory write within one CI run.
- [Comment edits notify ticket watchers] → Edit the existing comment only, with no new comments, and write only at step start and end. Where the provider supports it, use a notify-suppressed edit.
- [No push updates] → Accepted. Polling at 60 seconds is enough for a board measured in minutes and hours.

## Migration Plan

There is no code to migrate. The two source artifacts need these updates once the change is approved:

1. **Design doc, Architecture.** Replace "rebuilds the current state from tickets, PRs, factory/* branches and Orca worktrees" with "rebuilds the current state from the ticket provider only". Add `factory record-merge` to "Two pieces replace a background orchestrator", and name the run record as the single source of truth. In the architecture diagram, change "stored in tickets and PRs" to "stored in tickets (PR mirrors)".
2. **Design doc, Visibility.** Add the freshness indicator and the interrupted-run rule based on step timeouts.
3. **Design doc, other sections.**
   - State without a database: the factory comment starts at the first refine session and holds a list of runs.
   - Ticket states: Blocked → In development through `/factory-run`.
   - Shadow mode: only reverts are counted, and `record-merge` detects them.
   - Packaging: the CI service account. Implementation plan: a GitHub Issues adapter.
4. **Dashboard, Board.**
   - Change the column subtitles: Ready to "waiting · /factory-run", and Revalidate to "factory CLI · drift check".
   - Change the ENG-90 card from "Auto · queued" / "next in line" to "Eligible for /factory-next".
   - Change the reval-pending detail from "picked up by the Orca bot…" to "Eligible for /factory-next; nothing starts it until a developer runs a command."
   - Add the risk badge to cards, and a "delivered" mark in Done.
   - Replace the "Manual" and "Auto" badges on running cards with the claimant's name.
   - Offer "Open in Orca" only for runs on this machine.
   - Replace "Live" with "Updated <time> ago".
5. **Dashboard, Needs you.**
   - Change PAY-151 from "the bot will not pick it up" to "no developer has started it; add the auto label to make it eligible for /factory-next".
   - Add the categories Interrupted and Reverted.
   - Change the buttons that imply a write: "Add auto label" opens the ticket, "Start in Orca" copies `/factory-run PAY-151`, and "Retry after fix" copies `/factory-run PAY-133`.
   - Change PAY-133's next step from "move the ticket back to Ready for Dev" to "run /factory-run PAY-133".
6. **Dashboard, Health.** Add shadow-mode agreement per level and reverts within 2 weeks, both listed in the doc's Visibility table but missing from the canvas.

Rollback is not applicable: these are planning artifacts only.

## Open Questions

- **Linear and GitHub Issues adapters (task 6.6, postponed).** The shared contract needs stored spec files, statuses, and a claim of which exactly one of two racing attempts wins. Before building them, decide:
  - statuses on GitHub Issues, which has none: a GitHub Projects status field (recommended) or labels;
  - spec files on GitHub Issues, which has no attachment API: one marked issue comment per file (recommended);
  - spec files on Linear, whose attachments are links: Linear's file upload, linked from the issue (recommended);
  - the claim lock, since neither refuses a status change when the ticket has already moved: re-read right after the change and let the later claimer back off (recommended). This narrows the race without closing it, so the racing-claims contract test would be relaxed for these two providers.
- **Default poll interval per provider.** 60 seconds suits Jira Cloud. Linear and GitHub limits may justify different defaults. These can be tuned without changing the specs.
- **Per-adapter comment budget.** The exact size per provider can be set during adapter implementation.
- **Notify-suppressed edits.** Whether each provider supports them affects only notification noise, not the behavior.
