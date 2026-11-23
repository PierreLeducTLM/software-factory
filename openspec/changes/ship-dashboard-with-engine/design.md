# Design

## Context

`src/cli/bin.ts` resolves the dashboard server at `../../view/.output/server/index.mjs` from `dist/cli/bin.js`, so inside an installed package it looks for `node_modules/software-factory/view/.output/`. The package ships only `dist`, and `.output/` is git-ignored, so a tag never contains it. `view/.output` is a Nitro build: its server bundles its dependencies (`_libs/`, `_chunks/`), about 1.9 MB, and runs with Node alone, without the `view/` dependencies (React, TanStack Start).

## Approach

Make the built dashboard part of what a project installs, and keep the error for the case where it is still missing. The release builds the dashboard and commits `view/.output` into the tagged commit, and `package.json` lists `view/.output` in `files`, so `npm install` of the git tag ships it with no build step (D-001). `.gitignore` stops ignoring `view/.output`, so the build lives on `main`. `pnpm build:view` stamps the build with the engine version, and a test in the engine's suite refuses a missing or stale build, so a release PR cannot merge with an old dashboard (D-003).

## Open Questions

None.

## Decisions

### D-001: How the built dashboard reaches an installed engine

- **Question:** Is the dashboard built at release and committed to the tag, built by `prepare` on install, or published to a registry by a release job?
- **Decision:** It is built at release time and committed into the tagged commit, and `view/.output` is added to `files` in `package.json`.
- **Effect:** npm ships `view/.output` when it installs the git tag, so `factory view` needs no build in the project. `prepare` stays as it is, the install source in `src/setup/engine-files.ts` does not change, and each release adds about 1.9 MB of build output to git.

### D-002: The error when the dashboard is missing

- **Question:** When the dashboard is missing, what does `factory view` say, given that `pnpm build:view` only applies in a checkout of the factory?
- **Decision:** The exit code stays 2, and the message depends on where the engine runs. When the server entry path is inside a `node_modules/` directory (an installed engine), the error reads: `The factory dashboard is missing from the installed engine (<path>). Reinstall it: delete .factory/node_modules and run factory view again.` In any other location (a checkout of the factory), the current message stays: `The factory view is not built (<path> is missing). Run: pnpm build:view`.
- **Effect:** The "Dashboard missing" scenario splits into an installed-engine scenario and a checkout scenario. `tests/view-command.test.ts` covers both messages. The README section on `factory view` stops saying that the installed engine lacks the dashboard.

### D-003: Refusing a stale dashboard build at release

- **Question:** Does the release check that the shipped dashboard matches the engine version, so a stale build cannot be tagged?
- **Decision:** Yes. `pnpm build:view` writes the engine version from `src/version.ts` into `view/.output/engine-version`. A test in the engine's suite fails when `view/.output/server/index.mjs` or `view/.output/engine-version` is missing, or when the stamp differs from `src/version.ts`. `.gitignore` stops ignoring `view/.output`, and this ticket's pull request commits a freshly built, stamped dashboard.
- **Effect:** CI runs the suite on every pull request, including the version bump PR, so a release whose dashboard was not rebuilt cannot merge or be tagged. The stamp catches a forgotten rebuild at release. It does not catch dashboard source edits made without a version bump. A new requirement covers the check, and the affected paths add `.gitignore`, `view/.output/**` and the build script.
