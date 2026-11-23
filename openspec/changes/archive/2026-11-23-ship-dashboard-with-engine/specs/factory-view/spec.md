# Spec Delta

## ADDED Requirements

### Requirement: The installed engine serves the dashboard
`factory view`, run through a project's installed engine, SHALL start the dashboard with no build step in the project.

#### Scenario: Installed project
- **WHEN** a developer runs `factory view` in a project whose engine was installed from a release tag
- **THEN** the dashboard starts and the command prints its address

#### Scenario: Dashboard missing from an installed engine
- **WHEN** `factory view` runs from an engine installed under a `node_modules/` directory and the built dashboard is missing
- **THEN** the command exits with code 2 and prints `The factory dashboard is missing from the installed engine (<path>). Reinstall it: delete .factory/node_modules and run factory view again.`
- **AND** the message does not mention `pnpm build:view`

#### Scenario: Dashboard missing in a checkout of the factory
- **WHEN** `factory view` runs from an engine outside any `node_modules/` directory and the built dashboard is missing
- **THEN** the command exits with code 2 and prints `The factory view is not built (<path> is missing). Run: pnpm build:view`

### Requirement: The release ships a dashboard built for its version
The engine's test suite SHALL fail when the committed dashboard build is missing or was built for a different engine version.

#### Scenario: Package includes the dashboard
- **WHEN** the engine package's file list is computed (`npm pack --dry-run`)
- **THEN** it includes `view/.output/server/index.mjs` and `view/.output/engine-version`

#### Scenario: Build stamped with the engine version
- **WHEN** a developer runs `pnpm build:view`
- **THEN** `view/.output/engine-version` contains the version in `src/version.ts`

#### Scenario: Stale build
- **WHEN** the engine's test suite runs and `view/.output/engine-version` differs from the version in `src/version.ts`
- **THEN** a test fails and its message says to run `pnpm build:view` and commit `view/.output`

#### Scenario: Missing build
- **WHEN** the engine's test suite runs and `view/.output/server/index.mjs` or `view/.output/engine-version` is missing
- **THEN** a test fails and its message says to run `pnpm build:view` and commit `view/.output`
