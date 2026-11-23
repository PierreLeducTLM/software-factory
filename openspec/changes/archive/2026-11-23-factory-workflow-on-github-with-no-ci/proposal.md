# Factory workflow on GitHub with no CI

## Why

On a GitHub repository with no `.github/workflows`, `factory init` adds no factory workflow and lists no secrets. Merges are never recorded, tickets never reach Done, and `factory doctor` reports the missing `record-merge` and `revert` steps forever. GitHub Actions is available on every GitHub repository, and the README promises the workflow. Ticket: PIE-8.

## What changes

- On GitHub, init always adds `.github/workflows/factory.yml` with the `record-merge` job, and lists the tracker secrets to store.
- With no workflow that builds the main branch, the `revert` job is left out and the summary says why.
- Doctor does not report a missing `revert` step when there is no build to watch.
- For existing installs, `factory migrate` adds the missing workflow through a pull request, and doctor points to it.

## Out of scope

- Generating or offering a CI workflow that builds the main branch (D-002).
- Recording the staging watch environment in `factory.yaml`. Migrate leaves the watch job out and says so (D-005).

## Affected paths

- src/setup/install.ts
- src/setup/init.ts
- src/setup/detect.ts
- src/setup/doctor.ts
- src/setup/upgrade.ts
- src/cli/setup-command.ts
- tests/**
