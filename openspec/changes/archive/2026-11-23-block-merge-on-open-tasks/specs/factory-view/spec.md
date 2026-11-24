# Spec Delta

## ADDED Requirements

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
