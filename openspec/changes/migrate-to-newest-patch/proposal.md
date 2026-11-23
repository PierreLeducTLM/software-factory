# Migrate moves a project to the newest patch of its engine

## Why

`factory migrate` treats two engines with the same major and minor version as the same release. A project that pins 0.2.3 stays on 0.2.3 when engine 0.2.4 runs migrate: the pin in `factory.yaml` and `.factory/package.json` do not move. Fixes shipped in a patch release never reach an installed project. Found on this repository: after 0.2.4 shipped PIE-8, migrate added the factory workflow but left the engine at 0.2.3, so a local `factory doctor` still runs the old checks.

## What changes

- When the running engine is a newer patch of the release the project pins, `factory migrate` opens a pull request that moves the pin in `.factory/factory.yaml` and `.factory/package.json` to the running engine. It uses the same title and body as any engine upgrade (D-001).
- When the running engine is the same patch or an older patch, migrate answers "Nothing to upgrade" as today (D-004).
- When the running engine is a newer patch, `factory doctor` prints a non-failing note in its text output that points to `factory migrate`. The note is not drift and does not appear in `--json` output (D-002, D-003).

## Affected paths

- src/setup/upgrade.ts
- src/setup/doctor.ts
- src/cli/setup-command.ts
- tests/**
