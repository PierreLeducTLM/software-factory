# Design

## Context

`initProject` sets `mainBranch = input.mainBranch ?? deps.currentBranch() ?? 'main'`. `currentBranch` runs `git branch --show-current`.

## Approach

Add a `defaultBranch` dependency that reads the remote's default branch, and use it in place of `currentBranch`. It reads `git symbolic-ref --short refs/remotes/origin/HEAD` first, which needs no network, and falls back to `git ls-remote --symref origin HEAD` when that ref is missing, as in some clones and worktrees.

## Open Questions

None.

## Decisions

- **D-001** When the default branch cannot be read, does init fall back to `main` or stop?
  Decision: init stops. It returns `ok: false`, `reason: "missing"`, with `--main-branch` in `missing`, and opens no pull request. It never guesses a branch.
  Effect: new scenario "Default branch unknown" in the delta spec; task 3 states the behaviour and its test.
- **D-002** Does `factory init detect` report the main branch it found?
  Decision: yes. The detection result gains a `mainBranch` field holding the remote's default branch, the same value init uses without `--main-branch`. It is absent when the default cannot be read.
  Effect: new scenario "Detect shows the main branch" in the delta spec; task 4 added.
