# Init reads the main branch from the remote

## Why

`factory init` without `--main-branch` takes the branch checked out now as the main branch. In an Orca worktree that is a feature branch, so init fails on `git fetch origin <feature-branch>`, or, if the branch was pushed, installs the factory against the wrong branch. Ticket: PIE-7.

## What changes

- Without `--main-branch`, init uses the remote's default branch.
- `--main-branch` still wins when given.
- `factory init detect` shows the main branch it would use.

## Affected paths

- src/setup/init.ts
- src/setup/detect.ts
- src/cli/inputs.ts
- src/cli/real-deps.ts
- tests/**
