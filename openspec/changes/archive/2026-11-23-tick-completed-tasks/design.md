# Design

## Context

See proposal.md for the motivation. Today:

- `skills/factory-run/SKILL.md` step 2 pulls the approved spec with `factory pull <KEY> --to openspec/changes/<name>` and says "Do not edit it."
- The `next: build` step says to implement the tasks "as the OpenSpec apply workflow does". That workflow ticks each task in `tasks.md` as it is done.
- `factory pull` overwrites the files in the target folder with the ticket's attachments (`pullSpecFiles` in `src/factory/refinement.ts`, written by the `pull` handler in `src/cli/cli.ts`).
- The approval and ready-gate fingerprints are computed from the ticket's attachments, not from the repository (`fingerprintOf` in `src/factory/refinement.ts`). The engine finds the change folder by the names of the attached files, not their content (`changeOf` in `src/factory/build-loop.ts`). A ticked `tasks.md` on the branch therefore changes neither.
- After the review passes, the engine archives the change on the run branch (requirement "The build pull request archives the change"), so the `tasks.md` the builder leaves is the one kept under `openspec/changes/archive/`.

## Goals / Non-Goals

**Goals:**
- The pull request, and the archived change, show which tasks the run completed and which it did not, with a reason for each one it did not.

**Non-Goals:**
- Any change to the `factory` CLI or the engine.
- Writing the ticks back to the ticket's attachments. The attached `tasks.md` stays the approved one.
- Showing open tasks on the board or blocking the merge on them. That is PIE-20.

## Decisions

### D-001: A build may be handed in with unchecked tasks that carry a note

- **Question:** May a run hand in a build (`factory advance --changed`) while some tasks are unchecked, and should `openspec-verify` fail on an unchecked task that has a note?
- **Decision:** Yes. A build may be handed in with unchecked tasks as long as each one has an indented note under it. In the `openspec-verify` verdict, an unchecked task with a note is a warning: it is not a finding and does not fail the verdict. An unchecked task with no note is a finding, so the verdict fails. Whether open tasks block the merge is decided by PIE-20, not here.
- **Effect:** The `next: build` step lets the builder hand in with noted unchecked tasks. The `next: verify` step tells the verifier how to treat unchecked tasks. The delta spec gains the scenarios "A noted unchecked task does not fail verification" and "An unchecked task with no note fails verification". Task 1.4 is added.

### D-002: The reviewer checks the ticks against the diff

- **Question:** Should the reviewer subagent check that the ticks match the diff?
- **Decision:** Yes. A ticked task with no code or test in the diff behind it is a finding. An unchecked task whose work is in the diff is a finding too.
- **Effect:** The `next: review` step tells the reviewer to compare the ticks in `tasks.md` with the diff. The delta spec gains the scenarios "The reviewer flags a tick with nothing behind it" and "The reviewer flags done work left unchecked". Task 1.5 is added.

### D-003: A resumed run keeps the committed `tasks.md`

- **Question:** When a run resumes, `factory pull` overwrites `tasks.md` and drops the ticks the earlier session committed. What should a resumed run do?
- **Decision:** When the change folder is already committed on the run branch, step 2 does not pull the spec again, and the run keeps the ticked `tasks.md` as committed. When it is not committed yet, step 2 pulls as before.
- **Effect:** Step 2 of the run skill gains the resume rule. The delta spec gains the scenario "A resumed run keeps the ticks". Task 1.6 is added.

## Risks / Trade-offs

- [The builder ticks a task it did not really finish] → The task's own verification step is the bar for ticking. The reviewer also checks the ticks against the diff (D-002).
- [A resumed run pulls the spec again and wipes the ticks already committed] → A resumed run does not pull again once the change folder is committed (D-003).
- [OpenSpec's verify workflow reports unchecked tasks as incomplete, so a run with an honest unchecked task could fail `openspec-verify`] → A noted unchecked task is a warning, not a finding (D-001).

## Affected paths

- skills/factory-run/SKILL.md
- openspec/specs/build-loop/spec.md
- openspec/changes/tick-completed-tasks/**
- openspec/changes/archive/**

## Open Questions

None.
