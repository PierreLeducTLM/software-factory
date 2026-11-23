# Design

## Context

A factory run pulls the approved spec into `openspec/changes/<name>` (`factory pull`), builds it, commits it on the run branch, then goes through verify and review. After the review passes, `factory advance` pushes the branch and opens the pull request (`src/factory/build-loop.ts`). The `factory-run` skill (`skills/factory-run/SKILL.md`) drives these steps. No step runs `openspec archive`, so delta specs never reach `openspec/specs/`.

`openspec archive <name>` merges a change's delta specs into `openspec/specs/<capability>/spec.md` and moves the change folder to `openspec/changes/archive/<date>-<name>/`.

`deliver()` in `src/factory/build-loop.ts` runs when the review passes: it scores the risk, pushes the run branch and opens the pull request. The engine already requires the `openspec` CLI: the ready gate runs `openspec validate` through it (`src/cli/real-deps.ts`).

The ready gate validates a spec by copying it into a temporary folder that holds an empty `openspec/specs/` and running `openspec validate` there (`createSpecValidator` in `src/cli/inputs.ts`). A delta that does not fit the canonical specs therefore passes the gate, and `MODIFIED` or `REMOVED` deltas find nothing to apply to.

## Approach

The engine archives the change on the run branch inside `factory advance`, as part of delivering the run, and commits the archive before it pushes the branch and opens the pull request (D-001). It archives when the review has passed, at the start of delivery, before the run's risk is scored (D-002). If the archive fails, the run is sent back to refinement instead of opening a pull request (D-003). The engine finds the change as the one folder under `openspec/changes/`, outside `archive/`, whose spec files have the names of the ticket's attached spec files; without exactly one such folder, the attempt fails (D-005). The ready gate copies the canonical specs from the main branch into its temporary folder before it validates, so archive conflicts surface in refinement (D-006). The builder agent and the `factory-run` skill do nothing new.

## Open Questions

None.

## Decisions

### D-001: The engine archives, not the builder agent

- **Question:** Who archives: the builder agent, following a new step in the `factory-run` skill, or the engine inside `factory advance`, so that every run archives whatever the agent does?
- **Decision:** The engine. `factory advance` archives the ticket's change on the run branch and commits it before it pushes the branch and opens the pull request.
- **Effect:** Every factory run that opens a pull request archives its change, whatever agent or runtime built it. The `factory-run` skill does not change, so `skills/factory-run/SKILL.md` leaves the affected paths. The engine runs the `openspec` CLI it already requires for the ready gate, so no new tool is needed and the draft question about projects without the CLI is closed: they cannot pass the ready gate today either.

### D-002: Archive after the review passes, before the risk is scored

- **Question:** When in the run: right after the build commit (verify and review then read the archived folder and the updated canonical specs), or after the review passes, just before the pull request opens (verify and review see the change folder as it is today)?
- **Decision:** After the review passes, at the start of delivery, before the run's risk is scored and the branch is pushed.
- **Effect:** The quality gate, `openspec-verify` and the reviewer see the change folder in `openspec/changes/<name>` as they do today. Archiving happens once per run, only on the attempt that delivers, never after a failed attempt. The archive commit holds only the spec files the `openspec` CLI writes. The run's risk score counts the files and lines of the archive commit, because it is scored afterwards. No gate checks that the change was archived: the engine archives it itself, so the draft question about such a check is closed.

### D-003: A failed archive sends the ticket back to refinement

- **Question:** What happens when `openspec archive` fails, for example when a delta spec conflicts with the canonical spec: does the attempt fail and go through the build loop, or is the ticket sent back to refinement as a spec problem?
- **Decision:** The run is sent back to refinement, as for a `spec` diagnosis. No pull request is opened. The send-back question quotes the error the `openspec` CLI printed and recommends fixing the delta spec so it applies to the canonical specs.
- **Effect:** `factory advance` ends with `next: done` and `exit: sent_back`, and the ticket goes back to refinement with that question. The run branch keeps the built and reviewed commits, and no archive commit is left on it. The attempt is not retried by the build loop.

### D-004: Archiving the existing backlog is a separate one-off cleanup

- **Question:** Are the changes already merged but never archived (the five listed in the proposal, plus `define-software-factory-v1`) archived as part of this ticket, or in a separate one-off pull request?
- **Decision:** Out of scope. After this ticket merges, a person archives them by hand with `openspec archive`, oldest first, starting with `define-software-factory-v1`, and ending with this ticket's own change. The engine that builds this ticket does not archive yet, so this change is not archived by its own run. The cleanup lands in its own pull request.
- **Effect:** This ticket's pull request archives nothing already in `openspec/changes/` and stays a small engine change. The proposal lists the cleanup steps. No requirement or task covers the backlog.

### D-005: The engine finds the change folder by its files, and a missing folder fails the attempt

- **Question:** The builder chooses the change folder name when it pulls the spec, so the engine does not know it. How does the engine find the change, and what happens when it cannot?
- **Decision:** The change is the one folder directly under `openspec/changes/`, outside `openspec/changes/archive/`, whose spec files (`proposal.md`, `design.md`, `tasks.md`, `specs/<capability>/spec.md`) have the same names as the ticket's attached spec files. File names are compared, not contents, so ticked task boxes do not matter. When no folder matches, or more than one does, the attempt fails before anything is archived, with this feedback: "The approved spec of <KEY> is not in one folder under openspec/changes/. Pull it with factory pull <KEY> --to openspec/changes/<name> and commit it."
- **Effect:** The failure goes through the build loop like any failed attempt: it uses an attempt, `factory advance` answers `next: build` with that feedback, and the run ends in diagnosis if no attempts remain. No pull request is opened and nothing is sent back to refinement. The rule that the approved spec is committed in `openspec/changes/<name>` is now enforced by the engine.

### D-006: The ready gate validates against the canonical specs on main

- **Question:** The ready gate validates the spec against an empty `openspec/specs/`. Once runs archive their changes, a delta that clashes with a canonical spec passes the gate and is only caught at delivery, and `MODIFIED` or `REMOVED` deltas keep failing the gate. Should the gate validate against the real canonical specs in this ticket?
- **Decision:** Yes, in this ticket. Before it runs `openspec validate`, the ready gate copies `openspec/specs/` as it is on the main branch on the remote (`origin/<main_branch>`, the branch the pull request will merge into) into its temporary folder.
- **Effect:** Deltas that would not apply at archive time fail the ready gate with the CLI's finding, so the D-003 send-back becomes the exception rather than the rule. `MODIFIED` and `REMOVED` deltas of canonical requirements can pass the gate. A project with no canonical specs is validated as today. The change now touches two capabilities, `build-loop` and `refinement`, adds `src/cli/**` to the affected paths, and adds a delta spec for `refinement`.
