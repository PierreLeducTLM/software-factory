# Archive the OpenSpec change in the build pull request

## Why

Nothing in the factory archives an OpenSpec change. Each change the factory builds stays in `openspec/changes/<name>` after its pull request merges, and `openspec/specs/` stays empty. As a result:

- The build step's third source of answers, "the canonical specs under `openspec/specs/`", is always empty.
- Refinement cannot check a new spec against behaviour that already shipped, so conflicts between changes go unseen.
- `openspec/changes/` keeps growing with changes that are already done. On this repository: `dashboard-available-and-refining`, `factory-workflow-on-github-with-no-ci`, `fix-init-main-branch`, `ship-dashboard-with-engine`, `keep-engine-lockfile-out-of-git`.

Found after PIE-11 (PR #15) merged with its change folder left in `openspec/changes/`.

## What changes

- When a factory run delivers, the engine (`factory advance`) archives the change on the run branch and commits it, so the pull request it opens also archives the change: the delta specs are merged into `openspec/specs/`, and the change folder moves to `openspec/changes/archive/`. When the pull request merges, the canonical specs and the code reach main together. A rejected pull request leaves the canonical specs untouched.

- The ready gate validates the spec against the canonical specs on the main branch instead of an empty `openspec/specs/`. A delta that would not apply at archive time fails the gate during refinement, and `MODIFIED` and `REMOVED` deltas of canonical requirements can pass it (D-006).

## Out of scope

- Changes already in `openspec/changes/` are not archived by this change (D-004). After it merges, a person archives them in one separate pull request with `openspec archive <name>`, oldest first: `define-software-factory-v1`, then the factory-built changes in the order they merged, then `archive-change-in-build-pr` itself, which its own run does not archive.

## Affected paths

- src/factory/**
- src/cli/**
- tests/**
