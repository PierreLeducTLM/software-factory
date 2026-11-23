# Spec Delta

## ADDED Requirements

### Requirement: Main branch from the remote default
Without `--main-branch`, `factory init` SHALL use the remote's default branch as the main branch, never the branch checked out now unless it is that default. `factory init detect` SHALL report that branch as `mainBranch`.

#### Scenario: Init from a worktree branch
- **WHEN** init runs without `--main-branch` on branch `feature/x`, and the remote's default branch is `main`
- **THEN** `factory.yaml` sets `main_branch: main` and the install pull request targets `main`

#### Scenario: Main branch given
- **WHEN** init runs with `--main-branch develop`
- **THEN** `factory.yaml` sets `main_branch: develop`

#### Scenario: Default branch unknown
- **WHEN** init runs without `--main-branch` and the remote's default branch cannot be read
- **THEN** init returns `reason: "missing"` naming `--main-branch`, and opens no pull request

#### Scenario: Detect shows the main branch
- **WHEN** `factory init detect` runs on branch `feature/x`, and the remote's default branch is `main`
- **THEN** its result has `mainBranch: "main"`
