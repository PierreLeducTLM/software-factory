# refinement Specification

## Purpose
TBD - created by archiving change archive-change-in-build-pr. Update Purpose after archive.

## Requirements

### Requirement: The ready gate validates the spec against the canonical specs on main
The ready gate SHALL validate the ticket's spec against the canonical specs that `openspec/specs/` holds on the project's main branch on the remote (`origin/<main_branch>`), so that a delta which would not apply when the change is archived fails the gate.

#### Scenario: A MODIFIED delta of a canonical requirement
- **WHEN** the ready gate runs on a spec with a `MODIFIED` delta of a requirement that `openspec/specs/<capability>/spec.md` holds on main
- **THEN** the spec counts as valid, and the gate passes if every other condition holds

#### Scenario: A delta that does not apply
- **WHEN** the ready gate runs on a spec whose delta does not apply to the canonical specs on main, for example an `ADDED` requirement that already exists or a `MODIFIED` requirement that does not exist
- **THEN** the gate fails and lists the `openspec` CLI's finding for that delta

#### Scenario: A project with no canonical specs
- **WHEN** `openspec/specs/` on main is empty or missing
- **THEN** the gate validates the spec as it does today, against no canonical spec
