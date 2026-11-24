# Spec Delta

## ADDED Requirements

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
