# Spec Delta

## ADDED Requirements

### Requirement: The engine install leaves no untracked files
Running the factory through `.factory/bin/factory` SHALL NOT leave an untracked file in the project, including `.factory/package-lock.json`. The engine files SHALL include a `.factory/.gitignore` that lists `node_modules/` and `package-lock.json`, one per line.

#### Scenario: First run of the launcher
- **WHEN** a developer runs `.factory/bin/factory` for the first time in a fresh checkout
- **THEN** `git status` shows no untracked file under `.factory/`

#### Scenario: A lockfile already left untracked
- **WHEN** `.factory/package-lock.json` already exists, untracked, from an earlier run of the launcher, and the project's `.factory/.gitignore` is the one this change writes
- **THEN** `git status` does not show `.factory/package-lock.json`

#### Scenario: Existing install
- **WHEN** `factory migrate` runs on a project whose `.factory/.gitignore` lists only `node_modules/`
- **THEN** it opens a pull request that replaces `.factory/.gitignore` with one that lists `node_modules/` and `package-lock.json`
