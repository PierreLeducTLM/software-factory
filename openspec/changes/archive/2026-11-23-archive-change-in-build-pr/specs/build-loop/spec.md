# Spec Delta

## ADDED Requirements

### Requirement: The build pull request archives the change
The engine SHALL archive the ticket's OpenSpec change on the run branch, in a commit, before it opens the run's pull request, so that the pull request archives the change: its delta specs are merged into `openspec/specs/`, and its folder moves under `openspec/changes/archive/`.

#### Scenario: A run opens its pull request
- **WHEN** the review of a run passes for a ticket whose change is `openspec/changes/<name>`
- **THEN** the engine archives the change in a commit on the run branch, then scores the risk and opens the pull request
- **AND** the pull request adds the change's requirements to `openspec/specs/<capability>/spec.md` and moves the change folder to `openspec/changes/archive/`

#### Scenario: The change folder cannot be found
- **WHEN** the review of a run passes, and no folder directly under `openspec/changes/` (outside `archive/`) holds spec files with the names of the ticket's attached spec files, or more than one does
- **THEN** nothing is archived and no pull request is opened
- **AND** the attempt fails, and `factory advance` answers `next: build` with the feedback "The approved spec of <KEY> is not in one folder under openspec/changes/. Pull it with factory pull <KEY> --to openspec/changes/<name> and commit it.", or `next: diagnose` when no attempt is left

#### Scenario: An attempt fails before delivery
- **WHEN** an attempt fails the quality gate, `openspec-verify` or the review
- **THEN** the change stays in `openspec/changes/<name>` on the run branch, and the next attempt builds against it

#### Scenario: The pull request is not merged
- **WHEN** the pull request is closed without being merged
- **THEN** `openspec/specs/` and `openspec/changes/` on main are unchanged

#### Scenario: Archiving fails
- **WHEN** `openspec archive` fails on the run branch, for example because a delta spec does not apply to the canonical specs
- **THEN** no pull request is opened, no archive commit is left on the run branch, and `factory advance` ends with `next: done` and `exit: sent_back`
- **AND** the ticket goes back to refinement with a question that quotes the CLI's error and recommends fixing the delta spec
