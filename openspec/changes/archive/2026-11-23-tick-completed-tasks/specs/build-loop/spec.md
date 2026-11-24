# Spec Delta

## ADDED Requirements

### Requirement: The builder ticks the tasks it completes
During a factory run, the builder SHALL tick a task in the change's `tasks.md` on the run branch (`- [ ]` becomes `- [x]`) once the task is done and verified the way the task says. A task that is not done, or only partly done, SHALL stay unchecked, with an indented note directly under it that says what is missing.

A build MAY be handed in with unchecked tasks as long as each one has such a note. In the `openspec-verify` verdict, an unchecked task with a note SHALL NOT be a finding, and an unchecked task with no note SHALL be a finding. The reviewer SHALL compare the ticks with the diff: a ticked task with no code or test in the diff behind it is a finding, and so is an unchecked task whose work is in the diff. When a run resumes and the change folder is already committed on the run branch, the run SHALL NOT pull the spec again and SHALL keep the committed `tasks.md`.

`tasks.md` on the run branch SHALL be the only spec file the builder changes, and only its checkboxes and those notes. The builder MUST NOT edit the change's proposal, design or delta specs, and MUST NOT change the spec files attached to the ticket.

#### Scenario: Every task is done
- **WHEN** a run opens its pull request and the builder completed and verified every task of the change
- **THEN** every task in the change's `tasks.md` on the run branch reads `- [x]`
- **AND** the archived copy under `openspec/changes/archive/` that the pull request adds has every task ticked

#### Scenario: A task is only partly done
- **WHEN** the builder completes part of a task but cannot verify all of it
- **THEN** the task stays `- [ ]` in `tasks.md` on the run branch
- **AND** an indented line directly under it says what was done and what is missing

#### Scenario: A task is not started
- **WHEN** the builder hands in a build without having worked on a task
- **THEN** the task stays `- [ ]` in `tasks.md` on the run branch, with an indented note that says it was not done and why

#### Scenario: Other spec files stay as approved
- **WHEN** a run opens its pull request
- **THEN** the change's `proposal.md`, `design.md` and delta specs on the run branch are identical to the spec files attached to the ticket at approval
- **AND** the ticket's attached spec files are unchanged, including its `tasks.md`

#### Scenario: Ticking does not disturb the run
- **WHEN** the builder has ticked tasks in `tasks.md` on the run branch
- **THEN** `factory advance` still finds the change folder, the approval still holds, and the run continues as it would with an unticked `tasks.md`

#### Scenario: A noted unchecked task does not fail verification
- **WHEN** the builder hands in a build where a task is `- [ ]` with an indented note under it
- **THEN** the hand-in is accepted
- **AND** the `openspec-verify` verdict has no finding for that task, and does not fail because of it

#### Scenario: An unchecked task with no note fails verification
- **WHEN** a build is handed in where a task is `- [ ]` with no indented note under it
- **THEN** the `openspec-verify` verdict is `fail`, with a finding that names the task

#### Scenario: The reviewer flags a tick with nothing behind it
- **WHEN** a task is `- [x]` in `tasks.md` on the run branch but the diff against main has no code or test that does that task
- **THEN** the reviewer verdict is `fail`, with a finding that names the task

#### Scenario: The reviewer flags done work left unchecked
- **WHEN** a task is `- [ ]` in `tasks.md` on the run branch but the diff against main does that task
- **THEN** the reviewer verdict is `fail`, with a finding that names the task

#### Scenario: A resumed run keeps the ticks
- **WHEN** a run resumes and the change folder, with some tasks ticked, is already committed on the run branch
- **THEN** the run does not call `factory pull` for the ticket
- **AND** the ticks committed by the earlier session are still in `tasks.md`

#### Scenario: A resumed run with nothing committed pulls the spec
- **WHEN** a run resumes and the change folder is not yet committed on the run branch
- **THEN** the run pulls the spec with `factory pull` as on a first start
