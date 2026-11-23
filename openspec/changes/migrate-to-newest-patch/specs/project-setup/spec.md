# Spec Delta

## ADDED Requirements

### Requirement: Migrate moves the pin to a newer patch
When the running engine has the same major and minor version as the pinned engine and a higher patch version, `factory migrate` SHALL open a pull request that pins the running engine in `.factory/factory.yaml` and `.factory/package.json`. The pull request SHALL use the same title and body as any other engine upgrade (D-001). When the running engine is the same patch or an older patch of the pinned release, migrate SHALL NOT move the pin (D-004).

#### Scenario: Newer patch
- **WHEN** `factory migrate` runs with engine 0.2.4 on a project that pins 0.2.3, on the current schema
- **THEN** it opens a pull request titled `chore: upgrade the factory engine to 0.2.4` whose body starts "Moves this project from factory engine 0.2.3 to 0.2.4."
- **AND** the pull request changes `engine: 0.2.3` to `engine: 0.2.4` in `.factory/factory.yaml` and pins `#v0.2.4` in `.factory/package.json`
- **AND** the command prints "Opened <url>, which moves the project from engine 0.2.3 to 0.2.4. Nothing changes until it is merged."

#### Scenario: Same patch
- **WHEN** `factory migrate` runs with engine 0.2.4 on a project that pins 0.2.4, with nothing else to change
- **THEN** it answers "Nothing to upgrade: the project is on engine 0.2.4 and schema 1, which this engine (0.2.4) runs as they are." and opens nothing

#### Scenario: Older patch
- **WHEN** `factory migrate` runs with engine 0.2.3 on a project that pins 0.2.4, with nothing else to change
- **THEN** it answers "Nothing to upgrade: the project is on engine 0.2.4 and schema 1, which this engine (0.2.3) runs as they are." and opens nothing

### Requirement: Doctor notes a newer patch without failing
When the running engine has the same major and minor version as the pinned engine and a higher patch version, `factory doctor` SHALL print a note in its text output. The note SHALL NOT count as drift and SHALL NOT appear in `--json` output (D-002, D-003).

#### Scenario: Newer patch, no drift
- **WHEN** `factory doctor` runs with engine 0.2.4 on a project that pins 0.2.3 and has no drift
- **THEN** it prints "No drift found", then "Notes:", then `- Engine 0.2.4 is a newer patch than the 0.2.3 pinned in .factory/factory.yaml. Run "factory migrate" to move the project to it`
- **AND** the report passes

#### Scenario: Newer patch with drift
- **WHEN** `factory doctor` runs with engine 0.2.4 on a project that pins 0.2.3 and has drift findings
- **THEN** it prints "Drift found:" and the findings as today, then the "Notes:" block with the newer-patch note

#### Scenario: JSON output
- **WHEN** `factory doctor --json` runs with engine 0.2.4 on a project that pins 0.2.3 and has no drift
- **THEN** the JSON is the same as without the note: `ok` is true, `findings` is empty, and there is no `notes` field

#### Scenario: Same or older patch
- **WHEN** `factory doctor` runs with engine 0.2.4 on a project that pins 0.2.4 or 0.2.5
- **THEN** it prints no "Notes:" block
