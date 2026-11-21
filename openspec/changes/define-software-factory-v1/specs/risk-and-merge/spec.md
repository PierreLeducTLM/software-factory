# Spec Delta

## Purpose

Assigns every ticket a risk level that decides who merges, starts auto-merge in shadow mode, and records merge outcomes, reverts and staging checks from the project's own CI, since there is no orchestrator.

## ADDED Requirements

### Requirement: Risk is assessed twice and the higher level wins
The factory SHALL assign a predicted risk level at approval (from the spec) and an actual risk level before the PR (from the diff and the run history). The final level SHALL be the higher of the two.

#### Scenario: Diff riskier than predicted
- **WHEN** the predicted level is low and the diff touches a path listed in `sensitive_paths`
- **THEN** the actual level is at least medium, and the final level equals the actual level

### Requirement: Risk is scored by a script
Risk signals SHALL be scored by a script configured per project. The signals are:
- sensitive paths
- kind of change
- size
- confidence (attempts used, non-blocking findings, coverage of changed lines)
- a feature-flag safety net.

The risk report (signals, score, level, reasons) SHALL be written to the PR description and the run record.

#### Scenario: Risk report present
- **WHEN** a PR is opened
- **THEN** its description contains the risk signals, score, level and reasons

### Requirement: Reviewer can only raise risk
A reviewer agent MAY raise the risk level, but only with a written reason. It MUST NOT lower the level.

#### Scenario: Reviewer attempts to lower
- **WHEN** a reviewer verdict proposes lowering the level from medium to low
- **THEN** the level stays medium and the proposal is ignored

### Requirement: Merge policy by level
Each risk level SHALL map to a merge route configured in `.factory/factory.yaml`. The defaults are:

| Level | Route |
|---|---|
| low | auto-merge, once all gates pass and CI is green |
| medium | human merge, 1 reviewer |
| high | human merge, 2 reviewers, plus extra checks |

Auto-merge SHALL use source control's own auto-merge, so branch protection still applies. Where source control offers no auto-merge for a single pull request, the factory SHALL call its merge once, and only after all gates passed and CI is green, so branch restrictions still apply.

#### Scenario: Source control without per-PR auto-merge
- **WHEN** a low-risk PR on Bitbucket is eligible for auto-merge and Bitbucket refuses the merge because a build has not passed
- **THEN** the PR stays open, the refusal reason is recorded, and the ticket waits for a person to merge

#### Scenario: Ticket-level override
- **WHEN** a low-risk ticket carries the `factory:no-automerge` label or a human-merge ceiling in its approval stamp
- **THEN** the factory does not enable auto-merge for it

### Requirement: Shadow mode on every install
Every risk level SHALL start in shadow mode. In shadow mode, the factory SHALL write "would have auto-merged" on the PR and leave the merge to a person.

#### Scenario: Low risk in shadow mode
- **WHEN** a low-risk PR is opened while low is in shadow mode
- **THEN** auto-merge is not enabled, and the PR and run record say "would have auto-merged"

### Requirement: Merge outcome recorded from CI
Because no service watches pull requests, the project's CI SHALL run `factory record-merge` on every merge to main, using the project's service account. For a factory PR, that step SHALL write into the ticket's run record:
- the merge time
- the merger
- whether the merged diff equals the factory's last pushed commit ("merged as is") or was changed by a human
- the shadow-mode verdict ("would have auto-merged": yes or no).

If the provider did not already move the ticket to Done, the step SHALL do so.

#### Scenario: Human edits before merge
- **WHEN** a person pushes a commit to a factory PR and then merges it
- **THEN** record-merge writes "changed by a human" to the run record, and Health counts it as a shadow-mode disagreement

#### Scenario: Provider already moved to Done
- **WHEN** the provider's own automation moved the ticket to Done on merge
- **THEN** record-merge still writes the merge outcome, and it does not attempt another status transition

### Requirement: Reverts are detected on main
On every merge to main, `factory record-merge` SHALL check whether the merged change reverts an earlier factory PR. It SHALL recognize the source control's revert PRs and `git revert` commits, both of which name the change they revert. On a match, it SHALL write "reverted", the time and the reverting change into the original ticket's run record. This applies whether the original was merged by a person or by auto-merge.

An undo written by hand, with no reference to the original change, is not detected.

#### Scenario: Person reverts a shadow-mode merge
- **WHEN** a person merges a revert PR for a factory PR that a person had merged 3 days earlier in shadow mode
- **THEN** the original ticket's record shows "reverted", and Health counts a revert within 2 weeks for that risk level

#### Scenario: Ordinary merge
- **WHEN** a merge to main is neither a factory PR nor a revert of one
- **THEN** record-merge writes nothing

### Requirement: Shadow threshold suggests enabling a level
For each level, Health SHALL count tickets merged as is and reverts within 2 weeks. Follow-up fixes that are not reverts are not counted. When a level reaches its threshold (by default 20 tickets with no disagreement or revert), Health SHALL suggest enabling auto-merge for that level. Enabling SHALL be a one-line PR made with the workflow-modification skill.

#### Scenario: Threshold reached
- **WHEN** the last 20 low-risk tickets were merged as is, and none was reverted within 2 weeks of its merge
- **THEN** Health shows a suggestion to enable auto-merge for low, with the command that opens the PR

### Requirement: Auto-revert from CI
If CI on main fails after an auto-merge, the project's CI SHALL run `factory revert`, which:
- opens a revert PR
- records the revert in the run record
- returns that risk level to shadow mode.

The ticket SHALL then appear in Needs you.

Where source control has no way to open a revert PR, `factory revert` SHALL record that a revert is needed, link the original pull request, and leave the revert to a person. The risk level still returns to shadow mode.

#### Scenario: Source control that cannot open a revert
- **WHEN** main's CI fails after an auto-merged PR on Bitbucket
- **THEN** no revert PR is opened, the ticket appears in Needs you as "revert needed" with a link to the pull request, and low returns to shadow mode

#### Scenario: Red main after auto-merge
- **WHEN** main's CI fails on the commit produced by an auto-merged factory PR
- **THEN** a revert PR is opened, the ticket's record shows "reverted", low returns to shadow mode, and the ticket appears in Needs you

### Requirement: Optional post-merge watch from CI
Projects with staging MAY enable a watch in `.factory/factory.yaml`. After a deploy to staging, the deployment pipeline SHALL run `factory watch`, which runs the configured smoke checks for the configured duration.
- On failure, it opens a revert PR and flags the ticket in Needs you.
- On a pass, it marks the run delivered.

#### Scenario: Watch disabled
- **WHEN** a project has no staging environment and the watch is off
- **THEN** a merged run is final at merge and no watch step is expected
