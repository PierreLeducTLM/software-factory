# Spec Delta

## ADDED Requirements

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
