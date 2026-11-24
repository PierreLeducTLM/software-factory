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

### Requirement: Force refresh reloads the board
The dashboard header SHALL show a "Force refresh" button, next to the freshness line, on every page. Pressing it SHALL reload the board from the ticket providers as on the first load: it MUST ignore the poll interval, MUST discard the tickets the view holds, and MUST read every tracked ticket again (every open status, plus Done tickets updated in the last 7 days). The Board and Needs you SHALL then show only the tickets that reload returned. Force refresh MUST NOT change any ticket and MUST NOT re-read the project configuration. If the reload fails, the view SHALL keep the tickets it had and mark the data stale, as for a failed poll. While a reload runs, the button SHALL be disabled and read "Refreshing…".

#### Scenario: Button on every page
- **WHEN** the person opens the Board, Needs you or Health page
- **THEN** the header shows an enabled "Force refresh" button next to the freshness line

#### Scenario: Force refresh removes a ticket that left the board
- **GIVEN** the Board shows PIE-12 in Build, and PIE-12 was since moved to another team so the providers no longer return it
- **WHEN** the person presses "Force refresh"
- **THEN** PIE-12 is no longer on the Board or in Needs you, every other tracked ticket is shown with its current status, and the freshness line reads "Updated 0 s ago"

#### Scenario: Force refresh ignores the poll interval
- **GIVEN** the poll interval is 60 seconds and the last refresh was 10 seconds ago
- **WHEN** the person presses "Force refresh"
- **THEN** the view reads the providers immediately instead of waiting for the next poll

#### Scenario: Force refresh fails
- **GIVEN** the Board shows PIE-12 and PIE-14, last refreshed at 14:02 UTC
- **WHEN** the person presses "Force refresh" and the provider is unreachable
- **THEN** the Board still shows PIE-12 and PIE-14, and the freshness line reads "Stale since 14:02 UTC · <provider error> · retrying"

#### Scenario: Reload in progress
- **WHEN** the person presses "Force refresh" and the reload has not returned yet
- **THEN** the button is disabled and reads "Refreshing…", a second click starts no other reload, and once the reload returns the button reads "Force refresh" and is enabled again

#### Scenario: Force refresh does not touch tickets or config
- **WHEN** the person presses "Force refresh"
- **THEN** no ticket status, label or comment changes, and a change made to `.factory/config.yaml` since `factory view` started is not applied

### Requirement: Start a card's command in a new Orca worktree
The Board's run detail panel SHALL show a "Start in Orca" button on every card that has a command, except a card whose run is on this machine, which SHALL keep "Open in Orca" and SHALL NOT show "Start in Orca". Pressing the button SHALL create a new Orca worktree for the card's project and start Claude in it, with the card's command as its prompt, and SHALL bring Orca to the front on that worktree. When the card's command is `/factory-next`, the prompt SHALL be `/factory-run <card key>` instead. The worktree SHALL be named after the card's key in lowercase. Every press SHALL create a new worktree; when the branch name is taken, Orca's numeric suffix applies. The worktree SHALL be linked to the ticket as a Linear issue for a Linear ticket and as a Jira reference for a Jira ticket. Claude SHALL start with the person's own Orca settings for model, effort and surface, and the worktree SHALL follow the repository's setup policy and default base branch. The prompt, name and link SHALL be worked out by the dashboard server from the ticket, not taken from the browser. When, at the time of the press, the ticket's card has no command, its run is on this machine, or its command differs from the one the panel showed, no worktree SHALL be created and the start SHALL fail. While Orca is starting the worktree, the button SHALL be disabled and read "Starting in Orca…". On success the panel SHALL show `Started in Orca: <worktree>`, where `<worktree>` is the name of the worktree Orca created, and the button SHALL stay disabled until the panel is closed. On failure the panel SHALL show `Orca could not start <KEY>: <message>` with Orca's message, and the button SHALL be enabled again. The button MUST NOT change any ticket. The Needs you page SHALL NOT show the button.

#### Scenario: Button on a card with a command
- **GIVEN** PIE-21 is in Available with the command `/factory-refine PIE-21`
- **WHEN** the person opens PIE-21 on the Board
- **THEN** the detail panel shows the command with "Copy command" and an enabled "Start in Orca" button

#### Scenario: Run on this machine keeps Open in Orca
- **GIVEN** PIE-12's run is interrupted and was claimed on this machine, so its card has the command `/factory-run PIE-12`
- **WHEN** the person opens PIE-12 on the Board
- **THEN** the detail panel shows "Open in Orca" and the command with "Copy command", and no "Start in Orca" button

#### Scenario: Run on another machine can be started here
- **GIVEN** PIE-12's run is interrupted and was claimed on another machine, so its card has the command `/factory-run PIE-12`
- **WHEN** the person opens PIE-12 on the Board
- **THEN** the detail panel shows an enabled "Start in Orca" button and no "Open in Orca" button

#### Scenario: Card without a command
- **WHEN** the person opens a card that has no command, such as one in Build that is not interrupted
- **THEN** the detail panel shows no "Start in Orca" button

#### Scenario: Start a refinement in Orca
- **GIVEN** PIE-21 is a Linear ticket in Available with the command `/factory-refine PIE-21`
- **WHEN** the person presses "Start in Orca" on PIE-21
- **THEN** Orca creates a new worktree named `pie-21` in the project, linked to Linear issue PIE-21, starts Claude in it with the prompt `/factory-refine PIE-21`, and comes to the front on it
- **AND** the panel shows `Started in Orca: pie-21`

#### Scenario: Jira ticket is linked as a reference
- **GIVEN** PAY-142 is a Jira ticket in Ready with the command `/factory-run PAY-142`
- **WHEN** the person presses "Start in Orca" on PAY-142
- **THEN** Orca creates a worktree named `pay-142` linked to the Jira key PAY-142 and starts Claude with the prompt `/factory-run PAY-142`

#### Scenario: A next card builds the ticket clicked
- **GIVEN** PIE-30 is in Ready with the auto label, so its card's command is `/factory-next`
- **WHEN** the person presses "Start in Orca" on PIE-30
- **THEN** Claude starts in the new worktree `pie-30` with the prompt `/factory-run PIE-30`, and the copy box still shows `/factory-next`

#### Scenario: A second start for the same ticket gets a new worktree
- **GIVEN** a worktree `pie-21` already exists from an earlier start
- **WHEN** the person reopens PIE-21 and presses "Start in Orca"
- **THEN** Orca creates another new worktree for PIE-21, with a suffixed branch name, and the existing worktree is left as it was

#### Scenario: Start in progress
- **WHEN** the person presses "Start in Orca" and Orca has not answered yet
- **THEN** the button is disabled and reads "Starting in Orca…", and a second click starts nothing

#### Scenario: No second start while the panel stays open
- **GIVEN** the person pressed "Start in Orca" on PIE-21 and the panel shows `Started in Orca: pie-21`
- **WHEN** the person clicks the button again without closing the panel
- **THEN** nothing starts, because the button is disabled until the panel is closed

#### Scenario: Orca fails to start the worktree
- **GIVEN** the Orca app is not running
- **WHEN** the person presses "Start in Orca" on PIE-21
- **THEN** the panel shows `Orca could not start PIE-21: <Orca's message>` and the button reads "Start in Orca" and is enabled again

#### Scenario: Sample data has no Orca behind it
- **GIVEN** the dashboard runs with sample data (`FACTORY_VIEW_SAMPLE=1`)
- **WHEN** the person presses "Start in Orca" on PAY-142
- **THEN** the panel shows `Orca could not start PAY-142: This is sample data, with no Orca session behind it.`

#### Scenario: The card can no longer be started
- **GIVEN** the panel was opened on PIE-21 while it had a command, and since then PIE-21's run moved to this machine or it no longer has a command
- **WHEN** the person presses "Start in Orca"
- **THEN** no worktree is created and the panel shows `Orca could not start PIE-21: PIE-21 has nothing to start in a new worktree.`

#### Scenario: The card's command changed
- **GIVEN** the panel was opened on PIE-21 while its command was `/factory-refine PIE-21`, and since then PIE-21 was approved so its command is now `/factory-run PIE-21`
- **WHEN** the person presses "Start in Orca"
- **THEN** no worktree is created and the panel shows `Orca could not start PIE-21: PIE-21 changed since this panel opened. Reopen it to see what to run.`

#### Scenario: Starting changes no ticket
- **WHEN** the person presses "Start in Orca" on any card
- **THEN** no ticket status, label or comment changes because of the button

#### Scenario: Needs you page has no start button
- **WHEN** the person opens the Needs you page
- **THEN** each item shows its command with "Copy command" only, and the page's intro still says the page changes nothing

### Requirement: Pull request cards show open tasks
When the latest run's record has open tasks, its card in the Pull request column SHALL show "N of M tasks open", where N counts open tasks that are not accepted. When some open tasks are accepted, the card SHALL add "K tasks accepted open by <person>". A run with no open task SHALL show its card as it does without this requirement.

#### Scenario: Two tasks open
- **WHEN** PIE-60 is in review and its run's record has 2 of 9 tasks open, none accepted
- **THEN** its Pull request card shows "2 of 9 tasks open"

#### Scenario: Open tasks accepted
- **WHEN** PIE-61 is in review and both of its open tasks were accepted by Pierre
- **THEN** its Pull request card shows "2 tasks accepted open by Pierre" and does not say tasks are open

#### Scenario: All tasks done
- **WHEN** PIE-62 is in review and its run's record has no open task
- **THEN** its Pull request card mentions no tasks

### Requirement: Needs you lists pull requests with open tasks
When a ticket is in review and its latest run has at least one open task that is not accepted, the Needs you page SHALL list it in the category `open_tasks`, ranked just above `merge`, with the reason "N of M tasks open. Tick them in a push, or accept them as open.", the command `factory accept-tasks <KEY>`, and a link to the pull request. That ticket SHALL NOT also have a `merge` item. Once no open task is left unaccepted, the ticket SHALL get the `merge` item it would get without this requirement, and its reason SHALL add "K tasks accepted open by <person>" when tasks were accepted.

#### Scenario: Open tasks waiting
- **WHEN** PIE-63 is in review with 2 of 9 tasks open, none accepted
- **THEN** Needs you lists PIE-63 once, in `open_tasks`, with the reason "2 of 9 tasks open. Tick them in a push, or accept them as open." and the command `factory accept-tasks PIE-63`

#### Scenario: Ranked above merge items
- **WHEN** PIE-64 waits for a human merge with no open task, and PIE-65 is in review with open tasks
- **THEN** Needs you lists PIE-65 before PIE-64

#### Scenario: Tasks accepted
- **WHEN** PIE-66 is in review and its 2 open tasks were accepted by Pierre, and it waits for a human merge
- **THEN** Needs you lists PIE-66 in `merge`, and its reason includes "2 tasks accepted open by Pierre"

### Requirement: Run detail lists the run's tasks
When the latest run's record has tasks, the run detail SHALL show a Tasks section headed "Tasks: D of M done". It SHALL list each open task with its text and its note, and for an accepted task, who accepted it and when.

#### Scenario: Open tasks in the run detail
- **WHEN** a person opens the run detail of PIE-67, whose record has 7 of 9 tasks done and 4.1 open with the note "Not done: the board was not opened against live Linear"
- **THEN** the Tasks section reads "Tasks: 7 of 9 done" and lists 4.1 with that note

#### Scenario: Accepted task in the run detail
- **WHEN** 4.1 of PIE-68 was accepted by Pierre on 2026-11-24
- **THEN** the Tasks section lists 4.1 as accepted by Pierre on 2026-11-24

### Requirement: Needs you strip above the Board
When at least one ticket needs a person, the Board SHALL show a Needs you strip between the header and the columns. It SHALL start with "N need you", where N is the Needs you page's count, followed by one item per Needs you page item, in the page's order. Each item SHALL show the ticket key and the item's reason, shortened with an ellipsis when it does not fit. The items SHALL take at most two lines; when some do not fit, the last slot SHALL read "+N more", where N is the number of items not shown, and SHALL link to the Needs you page. Activating an item SHALL open that ticket's Needs you card in the run detail drawer. When nothing needs a person, the strip SHALL NOT be shown. Below 720px wide, the strip SHALL show only "N need you" as a link to the Needs you page. The Needs you column SHALL stay on the Board, unchanged.

#### Scenario: Items that fit
- **GIVEN** the Needs you page lists PAY-147 "Sent back · 1 question" and PAY-155 "Waiting for approval"
- **WHEN** the person opens the Board 1440px wide
- **THEN** a strip above the columns reads "2 need you", then PAY-147 with "Sent back · 1 question", then PAY-155 with "Waiting for approval", and shows no "+N more"

#### Scenario: More items than two lines hold
- **GIVEN** the Needs you page lists 8 items and only 4 fit in two lines of the strip
- **WHEN** the person opens the Board
- **THEN** the strip shows the first 4 items in the page's order, then "+4 more", which links to the Needs you page

#### Scenario: Open a ticket from the strip
- **WHEN** the person activates PAY-155 in the strip
- **THEN** the run detail drawer opens on PAY-155 with the reason and command the Needs you page gives for it

#### Scenario: Nothing needs a person
- **WHEN** the Needs you page is empty
- **THEN** the Board shows no strip, and the Needs you column reads "Needs you 0"

#### Scenario: Phone width
- **GIVEN** 8 tickets need a person
- **WHEN** the person opens the Board 390px wide
- **THEN** the strip shows only "8 need you", and activating it opens the Needs you page

### Requirement: Cards show the latest attempt
A Board card SHALL show the gate chips of the latest attempt only, as one row that does not wrap. Each chip SHALL show the first letter of its gate (b, g, v, r for build, gate, verify, review), and its accessible name and tooltip SHALL be the gate's name and status, such as "build passed". When the run has earlier attempts, the card SHALL show "+N earlier attempts" ("+1 earlier attempt" for one). The card SHALL show the provider name only when the Board reads from more than one provider. The risk badge SHALL read "Low", "Medium" or "High", and its accessible name SHALL be "Low risk (predicted)", "Medium risk (predicted)" or "High risk (predicted)". The run detail SHALL still list every attempt. This replaces the attempt rows (last two attempts) and the "key and provider" item in the card contents of "Board shows one column per station"; the other card contents are unchanged.

#### Scenario: Run on attempt 3
- **WHEN** PAY-142 is on attempt 3 of its run
- **THEN** its card shows one chip row, for attempt 3, and "+2 earlier attempts"

#### Scenario: First attempt
- **WHEN** ENG-87 is on attempt 1
- **THEN** its card shows one chip row and no "earlier attempts" line

#### Scenario: Chips stay on one line
- **WHEN** the Board is 1280px wide and a card shows its chip row
- **THEN** the four chips b, g, v and r sit on a single line, and the chip "b" is named "build passed" when the build passed

#### Scenario: One provider
- **WHEN** the Board reads from Linear only
- **THEN** no card shows the provider name

#### Scenario: Two providers
- **WHEN** the Board reads from Linear and Jira
- **THEN** each card shows its provider name

#### Scenario: Risk badge
- **WHEN** a card's predicted risk is medium
- **THEN** its badge reads "Medium" and is named "Medium risk (predicted)"

### Requirement: The Board fits the screen
The page SHALL NOT scroll sideways at any width. At 720px and wider, a column with no cards SHALL shrink to a narrow strip that shows its name and count, without "Nothing here". At 1280px and wider, the Board SHALL show all nine columns without scrolling sideways. From 720px to 1279px, only the Board SHALL scroll sideways when its columns do not fit, the header and the Needs you strip SHALL stay in place, and the scroll SHALL stop at column edges. Below 720px, the columns SHALL stack top to bottom in Board column order, each a section headed by its name and count, and an empty column SHALL show only that heading. The column order SHALL stay as "Board column order" sets it.

#### Scenario: Laptop width
- **WHEN** the person opens the Board 1440px wide with the sample data
- **THEN** all nine column headings are inside the window, and neither the page nor the Board scrolls sideways

#### Scenario: Empty column
- **WHEN** Revalidate has no cards and the Board is at least 720px wide
- **THEN** Revalidate shows as a narrow strip reading its name and "0", and the text "Nothing here" is not shown

#### Scenario: Tablet width
- **WHEN** the person opens the Board 900px wide and the columns do not fit
- **THEN** the page does not scroll sideways, the Board alone scrolls sideways, and the header and the Needs you strip stay in place while it does

#### Scenario: Phone width
- **WHEN** the person opens the Board 390px wide
- **THEN** the page does not scroll sideways, and the columns appear one under another in the order Available, Refining, Ready, Revalidate, Build, Review, Pull request, Needs you, Done

### Requirement: Run detail opens as a drawer
Activating a card SHALL open the run detail as a drawer over the right side of the Board, with the same contents and buttons the run detail has today. At 720px and wider, the drawer SHALL be at most 520px wide, SHALL NOT cover the header: its top edge SHALL be the bottom of the header while the header is in view, and the top of the window once the header has scrolled out of view, so the header's status line and Force refresh button stay visible and usable, the Board's columns SHALL keep their size and position under it, and the cards outside it SHALL stay clickable: activating another card SHALL show that card in the drawer. Below 720px, the drawer SHALL fill the window, with its close button at the top. The drawer SHALL scroll on its own, from its top, whatever the Board's scroll position. Opening it SHALL move keyboard focus into the drawer. Pressing Escape or the close button SHALL close it and return focus to the card or strip item that opened it, when that element is still shown. When a refresh removes the drawer's ticket from the Board, the drawer SHALL close.

#### Scenario: Open a card on a laptop
- **GIVEN** the Board is 1440px wide
- **WHEN** the person activates PAY-147
- **THEN** a drawer at most 520px wide opens on the right showing PAY-147, and the column headings are where they were before

#### Scenario: Header stays usable with the drawer open
- **GIVEN** the Board is 1440px wide and the drawer shows PAY-147
- **WHEN** the person looks at the top of the page and activates Force refresh
- **THEN** the drawer starts below the header, the header's status line is fully visible, and the refresh runs with the drawer still showing PAY-147

#### Scenario: Switch cards with the drawer open
- **GIVEN** the drawer shows PAY-147 on a 1440px Board
- **WHEN** the person activates PAY-151, which the drawer does not cover
- **THEN** the drawer shows PAY-151

#### Scenario: Open a card on a phone
- **GIVEN** the Board is 390px wide and scrolled down to Done
- **WHEN** the person activates a Done card
- **THEN** the drawer fills the window, shows that card from its top, and has its close button at the top

#### Scenario: Close with Escape
- **GIVEN** the person opened PAY-147 from its card
- **WHEN** they press Escape
- **THEN** the drawer closes and keyboard focus is on the PAY-147 card

#### Scenario: Ticket leaves the Board
- **GIVEN** the drawer shows PIE-12
- **WHEN** a refresh no longer returns PIE-12
- **THEN** the drawer closes

### Requirement: The open card is in the address
Opening a card SHALL add `card=<KEY>` and `column=<column id>` to the Board's address, where the column id names the column the opened card is in (`needs_you` for a card opened from the Needs you column or the Needs you strip), adding one browser history entry. Showing another card while the drawer is open SHALL change `card` without adding a history entry. Pressing the browser's back button with the drawer open SHALL close the drawer and leave the person on the Board. Closing the drawer with Escape or the close button SHALL remove `card` and `column` from the address, and pressing back afterwards SHALL NOT reopen it. Loading the Board with `card=<KEY>` and `column=<column id>` SHALL open the drawer on that ticket's card in that column. When `column` is missing or not a column id, or that column no longer holds the ticket, the drawer SHALL open on the ticket's Needs you card if it has one, otherwise on its card in the other column that holds it. When the ticket is nowhere on the Board, the Board SHALL show with no drawer and no error, whatever `column` says.

#### Scenario: Back closes the drawer
- **GIVEN** the person is on the Board and opens PAY-147
- **WHEN** they press the browser's back button
- **THEN** the drawer closes and the Board stays shown

#### Scenario: Switching cards adds no history
- **GIVEN** the person opened PAY-147, then PAY-151 in the same drawer
- **WHEN** they press back once
- **THEN** the drawer closes and the Board stays shown

#### Scenario: Reload reopens the card
- **WHEN** the person loads the Board at `/?card=PAY-147&column=build` and PAY-147 is in Build
- **THEN** the drawer opens on PAY-147's Build card

#### Scenario: Reload reopens the Needs you card of a ticket shown twice
- **GIVEN** PAY-155 shows in Ready and in Needs you
- **WHEN** the person opens PAY-155 from the Needs you strip and reloads the page
- **THEN** the address reads `/?card=PAY-155&column=needs_you`, and the drawer opens on PAY-155's Needs you card, with the reason and command the Needs you page gives for it

#### Scenario: Column missing or out of date
- **GIVEN** PAY-155 shows in Ready and in Needs you
- **WHEN** the person loads the Board at `/?card=PAY-155`, or at `/?card=PAY-155&column=build`
- **THEN** the drawer opens on PAY-155's Needs you card

#### Scenario: Ticket left Needs you
- **GIVEN** PAY-147 shows only in Build
- **WHEN** the person loads the Board at `/?card=PAY-147&column=needs_you`
- **THEN** the drawer opens on PAY-147's Build card

#### Scenario: Ticket no longer on the Board
- **WHEN** the person loads the Board at `/?card=PIE-99&column=build` and PIE-99 is not on the Board
- **THEN** the Board shows with no drawer and no error message

### Requirement: Opening and closing the drawer keeps the page's scroll
Loading the Board, the Needs you page or the Health page fresh, including the Board with `card` in its address, SHALL start the page at the top. Opening the drawer, showing another card in it, and closing it with Escape, the close button or the browser's back button SHALL NOT change the page's scroll position: after closing, the page SHALL be where the person last scrolled it, including scrolling done while the drawer was open. The one exception: when focus returns on close to a card or strip item that is out of view, the page SHALL scroll by the smallest amount that brings it into view. Navigating between the Board, the Needs you page and the Health page SHALL behave as it does today.

#### Scenario: Fresh load starts at the top
- **WHEN** the person loads the Board at `/?card=PAY-147&column=build` on a 390px window
- **THEN** the page is scrolled to the top and the drawer opens on PAY-147

#### Scenario: Opening a card keeps the page where it is
- **GIVEN** the Board is 390px wide and scrolled down to Done
- **WHEN** the person activates a Done card and then closes the drawer with its close button
- **THEN** the page is still scrolled to Done, and focus is on that Done card

#### Scenario: Back keeps scrolling done while the drawer was open
- **GIVEN** the Board is 1440px wide, the drawer shows PAY-147, and the person scrolls the page down 600px behind the drawer
- **WHEN** they press the browser's back button
- **THEN** the drawer closes and the page stays scrolled 600px down

#### Scenario: Focus returns to a card out of view
- **GIVEN** the person opened PAY-147 from its card, then scrolled the page until the PAY-147 card is out of view
- **WHEN** they press Escape
- **THEN** the drawer closes, focus is on the PAY-147 card, and the page has scrolled just enough to show it
