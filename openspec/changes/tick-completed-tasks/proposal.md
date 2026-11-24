# Proposal

## Why

A factory run never ticks the tasks it completes. The pull request shows `tasks.md` with every task unchecked even when all of them are done, so a reviewer cannot tell what was done, and once the engine archives the change the unchecked list stays in `openspec/changes/archive/` for good. PIE-17 (PR #23) is an example: its tasks were ticked by hand afterwards, in commit `d453caa`.

The cause is `skills/factory-run/SKILL.md`. Step 2 says the pulled spec "is the spec that was approved. Do not edit it.", while the `next: build` step tells the builder to implement the tasks "as the OpenSpec apply workflow does", and that workflow ticks each task as it is done. The skill contradicts itself, and the builder follows the stricter rule.

## What Changes

- During a build, the builder ticks a task in `openspec/changes/<name>/tasks.md` on the run branch once that task is done and verified as the task says.
- A task that is not done, or only partly done, stays unchecked and gets an indented note under it saying what is missing.
- The builder still never edits the proposal, the design, the delta specs or the ticket's attachments. `tasks.md` on the branch is the only spec file it may change, and only its checkboxes and those notes.
- Step 2 of the run skill no longer forbids every edit to the pulled spec. It names what may change and what may not.
- Nothing changes in the engine. The approval fingerprint is computed from the ticket's attachments, not the repository files (`fingerprintOf` in `src/factory/refinement.ts`), and the change folder is matched by file names, not content (`changeOf` in `src/factory/build-loop.ts`), so a ticked `tasks.md` affects neither.
- A build may be handed in with unchecked tasks as long as each has a note. The verify step treats a noted unchecked task as a warning and an unchecked task with no note as a failure (D-001). Whether open tasks block the merge is PIE-20.
- The reviewer checks the ticks against the diff: a tick with nothing behind it, or done work left unchecked, is a finding (D-002).
- A resumed run does not pull the spec again once the change folder is committed on the run branch, so the ticks already committed are kept (D-003).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-loop`: adds the requirement "The builder ticks the tasks it completes".

## Impact

- `skills/factory-run/SKILL.md`: step 2 (the "Do not edit it" rule and the resume rule), the `next: build` step, the `next: verify` step and the `next: review` step.
- `openspec/specs/build-loop/spec.md`: gains the new requirement when the change is archived.
- No change to the `factory` CLI, the ticket provider, the factory comment, the ready gate or the approval.
- Related: PIE-20 (open tasks show on the card and block the merge) depends on this change.
