# Ship the dashboard with the engine

## Why

`factory view` fails in every installed project: "The factory view is not built (.factory/node_modules/software-factory/view/.output/server/index.mjs is missing). Run: pnpm build:view". The engine is installed from its git tag, and the package ships only `dist` (`"files": ["dist"]`). Its `prepare` script compiles the TypeScript but not the dashboard, a separate pnpm workspace package (`view/`). The suggested `pnpm build:view` only works in a checkout of the factory itself. Found on this repository after releasing 0.2.4.

## What changes

- An installed engine can run `factory view` with no build step in the project. The release builds the dashboard and commits `view/.output` into the tagged commit, and `package.json` ships it through `files` (D-001).
- When the dashboard is missing anyway, the error says something the person can act on. In an installed engine, it says to delete `.factory/node_modules` and run `factory view` again. In a checkout of the factory, it still says `pnpm build:view` (D-002).
- The README stops saying the installed engine lacks the dashboard.
- `pnpm build:view` stamps the build with the engine version, `view/.output` is committed to `main`, and the engine's test suite fails on a missing or stale build, so a release cannot ship an old dashboard (D-003).

## Affected paths

- package.json
- .gitignore
- view/package.json
- view/.output/**
- scripts/**
- src/cli/view-command.ts
- src/cli/bin.ts
- README.md
- tests/**
