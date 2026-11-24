# Spec Delta

## ADDED Requirements

### Requirement: Joke button in the dashboard header
The dashboard header SHALL show a "Tell me a joke" button to the right of "Force refresh", on every page. Where the header is too narrow to show the freshness line and both buttons on one line, the "Tell me a joke" button SHALL still come after "Force refresh", beside it or on the next line. The button SHALL be shown in every project and with sample data alike. It SHALL always be enabled and SHALL always read "Tell me a joke", before and after a press. When the dashboard could not start, the header SHALL NOT show the button.

#### Scenario: Button on every page
- **WHEN** the person opens the Board, Needs you or Health page 1440px wide
- **THEN** the header shows an enabled "Tell me a joke" button to the right of "Force refresh", on the same line

#### Scenario: Sample data
- **GIVEN** the dashboard runs with sample data (`FACTORY_VIEW_SAMPLE=1`)
- **WHEN** the person opens the Board
- **THEN** the header shows the "Tell me a joke" button, and pressing it displays a joke as it does in a project

#### Scenario: Narrow window
- **WHEN** the person opens the Board 390px wide
- **THEN** the "Tell me a joke" button is shown after "Force refresh", entirely inside the window, and the page does not scroll sideways

#### Scenario: Dashboard could not start
- **WHEN** the dashboard reads "The factory view could not start"
- **THEN** the header shows no "Tell me a joke" button and no joke

### Requirement: Each press shows the next joke
Until the "Tell me a joke" button is pressed, the dashboard SHALL show no joke. The first press SHALL display the first joke of the list below, each further press SHALL display the next one in place of the one before, and a press after the fifth joke SHALL display the first joke again. The jokes SHALL be built into the dashboard: a press MUST NOT send a request to the dashboard's server or to any other service, and the button SHALL have no disabled, loading or error state.

1. Why do programmers prefer dark mode? Because light attracts bugs.
2. There are 10 kinds of people: those who understand binary and those who don't.
3. A SQL query walks into a bar, goes up to two tables and asks: may I join you?
4. Why did the pull request go to therapy? It had too many unresolved conflicts.
5. Why did the developer go broke? Because they used up all their cache.

#### Scenario: Before the first press
- **WHEN** the person opens the dashboard and has not pressed "Tell me a joke"
- **THEN** no joke is displayed

#### Scenario: First press
- **WHEN** the person presses "Tell me a joke" for the first time
- **THEN** the dashboard displays "Why do programmers prefer dark mode? Because light attracts bugs.", and the button still reads "Tell me a joke" and is enabled

#### Scenario: Next press
- **GIVEN** the dashboard displays "Why do programmers prefer dark mode? Because light attracts bugs."
- **WHEN** the person presses "Tell me a joke"
- **THEN** the dashboard displays "There are 10 kinds of people: those who understand binary and those who don't." and no longer displays the first joke

#### Scenario: Press after the last joke
- **GIVEN** the person pressed "Tell me a joke" five times, so the dashboard displays "Why did the developer go broke? Because they used up all their cache."
- **WHEN** the person presses "Tell me a joke"
- **THEN** the dashboard displays "Why do programmers prefer dark mode? Because light attracts bugs."

#### Scenario: No request
- **WHEN** the person presses "Tell me a joke"
- **THEN** the joke is displayed, and no request is sent to the dashboard's server or to any other service

### Requirement: The joke stays under the button until the next press
A joke SHALL be displayed as a line of text under the "Tell me a joke" button, in the header, and SHALL be announced to screen readers as a status message. The whole joke SHALL be readable: it SHALL wrap onto more lines where it does not fit on one, and it MUST NOT make the page scroll sideways at any width. When a joke appears or is replaced, the "Tell me a joke" button SHALL stay where it is, so that pressing again at the same spot displays the next joke. The joke SHALL stay displayed until the next press replaces it, and the dashboard SHALL offer no control to close it. Moving between the Board, the Needs you page and the Health page, an automatic refresh and "Force refresh" SHALL leave the joke in place and SHALL NOT change which joke the next press displays. Reloading the page SHALL clear the joke, and the first press after a reload SHALL display the first joke. At 720px and wider, when a joke makes the header taller, the run detail drawer SHALL still start at the bottom of the header and SHALL NOT cover any part of the header.

#### Scenario: Joke under the button
- **WHEN** the person presses "Tell me a joke" on the Board 1440px wide
- **THEN** the joke appears in the header as text under the button, a screen reader announces it as a status message, and the header shows no button to close it

#### Scenario: Pressing again at the same spot
- **GIVEN** the Board is 1440px wide and no joke is displayed
- **WHEN** the person presses "Tell me a joke" twice without moving the pointer
- **THEN** the button is where it was before the first press, and the dashboard displays the second joke

#### Scenario: Joke on a narrow window
- **WHEN** the person presses "Tell me a joke" with the dashboard 390px wide
- **THEN** the whole joke is readable, on more than one line if needed, and the page does not scroll sideways

#### Scenario: Changing page keeps the joke
- **GIVEN** the person pressed "Tell me a joke" once on the Board
- **WHEN** they open the Needs you page, then the Health page
- **THEN** each page's header still displays the first joke, and the next press displays the second joke

#### Scenario: A refresh keeps the joke
- **GIVEN** the header displays a joke
- **WHEN** the automatic refresh runs, or the person presses "Force refresh"
- **THEN** the header still displays the same joke

#### Scenario: Reloading clears the joke
- **GIVEN** the header displays the third joke
- **WHEN** the person reloads the page
- **THEN** no joke is displayed, and the next press displays the first joke

#### Scenario: Drawer open while a joke makes the header taller
- **GIVEN** the Board is 1440px wide and the run detail drawer shows PAY-147
- **WHEN** the person presses "Tell me a joke" and the joke makes the header taller
- **THEN** the whole joke is visible in the header, and the drawer's top edge is at the header's new bottom edge

### Requirement: The joke button changes nothing else
The "Tell me a joke" button is a dummy. Pressing it MUST NOT change any ticket status, label or comment, MUST NOT start a refresh or a reload of the board, and MUST NOT change which tickets, items or figures the Board, the Needs you page and the Health page show.

#### Scenario: Pressing the button changes nothing else
- **GIVEN** the Board shows PIE-12 in Build and the freshness line reads "Updated 12 s ago · 1 running · 0 need you"
- **WHEN** the person presses "Tell me a joke"
- **THEN** no ticket status, label or comment changes, no refresh or reload of the board starts, and the Board still shows PIE-12 in Build with the same freshness line
