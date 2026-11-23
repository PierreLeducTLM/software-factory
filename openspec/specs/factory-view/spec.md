# factory-view Specification

## Purpose
TBD - created by archiving change dashboard-available-and-refining. Update Purpose after archive.

## Requirements

### Requirement: Available label marks tickets for the factory
The project config SHALL have a label `labels.available`, defaulting to `factory-available` when the key is missing. `factory init` SHALL write it next to the other labels. A "to refine" ticket SHALL appear on the Board only when it carries this label.

#### Scenario: Config without the key
- **WHEN** `.factory/config.yaml` has `labels.auto` and `labels.no_automerge` but no `labels.available`
- **THEN** the config loads and the available label is `factory-available`

#### Scenario: Unlabelled backlog ticket
- **WHEN** PIE-20 is in "to refine" without the available label
- **THEN** the Board does not show PIE-20 in any column

### Requirement: Board shows available tickets
The Board SHALL show an Available column first. It SHALL hold every "to refine" ticket that carries the available label. Each card SHALL show the note "Available for refinement" and offer `/factory-refine KEY`.

#### Scenario: Labelled backlog ticket
- **WHEN** PIE-21 is in "to refine" with the label `factory-available`
- **THEN** the Board shows PIE-21 in Available with the note "Available for refinement" and the command `/factory-refine PIE-21`

### Requirement: Board shows tickets being refined
The Board SHALL show a Refining column after Available and before Ready. It SHALL hold every "spec review" ticket, labelled or not. Each card SHALL offer `/factory-refine KEY`, and its note SHALL be the first that applies:
- "Sent back · N questions" when the record holds a send-back with N questions
- "Gate passed, waiting for approval" when the recorded ready gate passed
- "Gate failed" when the recorded ready gate failed
- "Refining" otherwise.

#### Scenario: Waiting for approval
- **WHEN** PIE-22 is in "spec review" and its recorded ready gate passed
- **THEN** the Board shows PIE-22 in Refining with the note "Gate passed, waiting for approval" and the command `/factory-refine PIE-22`

#### Scenario: Gate failed
- **WHEN** PIE-23 is in "spec review" and its recorded ready gate failed
- **THEN** the Board shows PIE-23 in Refining with the note "Gate failed"

#### Scenario: Refinement just started
- **WHEN** PIE-24 is in "spec review" and its record has no ready gate and no send-back
- **THEN** the Board shows PIE-24 in Refining with the note "Refining"

#### Scenario: Sent back
- **WHEN** PIE-25 is in "spec review" and its record holds a send-back with 2 questions
- **THEN** the Board shows PIE-25 in Refining with the note "Sent back · 2 questions", and also in Needs you

### Requirement: Needs you column mirrors the Needs you page
The Board's Needs you column SHALL hold one card per item on the Needs you page, in the page's order. Each card's note SHALL be the item's reason and its command the item's command. A ticket SHALL keep its card in its station column as well. The column's count SHALL equal the page's count and the header's count.

#### Scenario: Approval waiting
- **WHEN** the header says "1 need you" because PIE-22 waits for approval
- **THEN** the Board's Needs you column holds PIE-22, and PIE-22 also stays in Refining

#### Scenario: Pull request waiting for a person
- **WHEN** PIE-30 is in review and its pull request waits for a human merge
- **THEN** the Board shows PIE-30 in Pull request and in Needs you

#### Scenario: Blocked ticket
- **WHEN** PIE-31 is Blocked
- **THEN** the Board shows PIE-31 only in Needs you, with the reason the Needs you page gives and `/factory-run PIE-31`

### Requirement: Board column order
The Board SHALL show these columns, in this order: Available, Refining, Ready, Revalidate, Build, Review, Pull request, Needs you, Done. This list replaces the column list in "Board shows one column per station". The card contents that requirement lists are unchanged.

#### Scenario: Column order
- **WHEN** the Board loads
- **THEN** its columns read Available, Refining, Ready, Revalidate, Build, Review, Pull request, Needs you, Done

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

### Requirement: The dashboard stops with factory view
When the `factory view` process ends, for any reason, no process started by it SHALL keep running, and nothing SHALL keep listening on the dashboard port because of it. This SHALL hold for Ctrl+C, for a termination signal sent to the `factory view` process alone, for the terminal being closed, and for a forced kill (`kill -9`). The port SHALL be free again within 5 seconds of the signal. Stopped by Ctrl+C or a termination signal, `factory view` SHALL exit with code 0.

#### Scenario: Ctrl+C
- **WHEN** a developer runs `factory view` and presses Ctrl+C
- **THEN** `factory view` exits with code 0, and within 5 seconds nothing listens on 127.0.0.1:4790

#### Scenario: Termination signal to factory view alone
- **WHEN** `factory view` is serving on port 4790 and a tool sends SIGTERM to the `factory view` process ID only
- **THEN** `factory view` exits with code 0, within 5 seconds nothing listens on 127.0.0.1:4790, and no dashboard server process is left under PID 1

#### Scenario: Terminal closed
- **WHEN** `factory view` is serving and the terminal it runs in is closed
- **THEN** within 5 seconds nothing listens on the dashboard port

#### Scenario: Forced kill
- **WHEN** `factory view` is serving on port 4790 and its process ID receives SIGKILL
- **THEN** within 5 seconds nothing listens on 127.0.0.1:4790, and no dashboard server process is left under PID 1

### Requirement: A taken port moves the dashboard to the next free port
Before it starts the dashboard, `factory view` SHALL check that it can listen on 127.0.0.1 at the requested port. When no port was given and the default port 4790 is in use, it SHALL try the next port up, one at a time, up to 4799, and start the dashboard on the first free one. Before the URL line, it SHALL write one line to stderr: `Port 4790 is in use, possibly by a factory view that was not stopped (lsof -iTCP:4790 -sTCP:LISTEN shows which process). Using <port>.`, where `<port>` is the port it uses. When 4790 to 4799 are all in use, it SHALL write `No free port for the factory dashboard between 4790 and 4799.` to stderr, start no dashboard, and exit with code 1. It SHALL leave the process holding the taken port running, print no stack trace, and print the URL with the port it actually uses. A port given with `--port` SHALL be used as given: when it is in use, `factory view` SHALL write `Port <port> is in use (lsof -iTCP:<port> -sTCP:LISTEN shows which process). Choose another with --port <number>.` to stderr, start no dashboard, and exit with code 1.

#### Scenario: Default port held by a leftover dashboard
- **WHEN** another process already listens on 127.0.0.1:4790, port 4791 is free, and a developer runs `factory view`
- **THEN** `factory view` writes `Port 4790 is in use, possibly by a factory view that was not stopped (lsof -iTCP:4790 -sTCP:LISTEN shows which process). Using 4791.` to stderr, the dashboard starts on port 4791, `factory view` prints `Factory view: http://127.0.0.1:4791 (read-only, press Ctrl+C to stop)`, and the other process keeps running

#### Scenario: Several ports taken
- **WHEN** other processes listen on 127.0.0.1:4790 and 127.0.0.1:4791, port 4792 is free, and a developer runs `factory view`
- **THEN** `factory view` writes one notice ending `Using 4792.`, the dashboard starts on port 4792, and the printed URL names port 4792

#### Scenario: No free port in the range
- **WHEN** other processes listen on every port from 127.0.0.1:4790 to 127.0.0.1:4799 and a developer runs `factory view`
- **THEN** `factory view` writes `No free port for the factory dashboard between 4790 and 4799.` to stderr, prints no URL line, starts no dashboard, and exits with code 1

#### Scenario: Explicit port taken
- **WHEN** another process listens on 127.0.0.1:5005 and a developer runs `factory view --port 5005`
- **THEN** `factory view` writes `Port 5005 is in use (lsof -iTCP:5005 -sTCP:LISTEN shows which process). Choose another with --port <number>.` to stderr, prints no "Factory view:" URL line and no stack trace, starts no dashboard, leaves the other process running, and exits with code 1

#### Scenario: Requested port is free
- **WHEN** port 5005 is free and a developer runs `factory view --port 5005`
- **THEN** the dashboard starts on port 5005 and `factory view` prints `Factory view: http://127.0.0.1:5005 (read-only, press Ctrl+C to stop)`

### Requirement: The URL is printed once the dashboard listens
`factory view` SHALL print `Factory view: http://127.0.0.1:<port> (read-only, press Ctrl+C to stop)` only after the dashboard is listening on that port, so that the printed URL always points at the dashboard this command started. When the dashboard is not listening 10 seconds after `factory view` started it, `factory view` SHALL write `The factory dashboard did not start on port <port>.` to stderr, print no URL line, and exit with code 1, leaving nothing listening because of it.

#### Scenario: Normal start
- **WHEN** a developer runs `factory view` and port 4790 is free
- **THEN** the "Factory view:" line appears, and a request to http://127.0.0.1:4790 made after it appears gets an answer from the dashboard started by this command

#### Scenario: Dashboard does not start
- **WHEN** the port check passed for port 4790 but the dashboard is still not listening on it 10 seconds later
- **THEN** `factory view` writes `The factory dashboard did not start on port 4790.` to stderr, prints no "Factory view:" line, and exits with code 1
