# Spec Delta

## ADDED Requirements

### Requirement: Joke button shows a joke
The dashboard SHALL show a joke button. Until the button is pressed, the dashboard SHALL show no joke. Pressing the button SHALL display a joke on the dashboard, and the whole joke SHALL be readable. The button is a dummy: pressing it MUST NOT change any ticket status, label or comment, MUST NOT start a refresh or a reload of the board, and MUST NOT change which tickets, items or figures the Board, the Needs you page and the Health page show. A displayed joke MUST NOT make the page scroll sideways at any width.

#### Scenario: Before the first press
- **GIVEN** the dashboard has loaded its data
- **WHEN** the person opens it and has not pressed the joke button
- **THEN** the joke button is shown and enabled, and no joke is displayed

#### Scenario: Press the button
- **WHEN** the person presses the joke button
- **THEN** a joke is displayed on the dashboard

#### Scenario: Pressing the button changes nothing else
- **GIVEN** the Board shows PIE-12 in Build and the freshness line reads "Updated 12 s ago · 1 running · 0 need you"
- **WHEN** the person presses the joke button
- **THEN** no ticket status, label or comment changes, no refresh or reload of the board starts, and the Board still shows PIE-12 in Build with the same freshness line

#### Scenario: Joke on a narrow window
- **WHEN** the person presses the joke button with the dashboard 390px wide
- **THEN** the whole joke is readable and the page does not scroll sideways
