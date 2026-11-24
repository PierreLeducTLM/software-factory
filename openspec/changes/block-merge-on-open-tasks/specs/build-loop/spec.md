# Spec Delta

## ADDED Requirements

### Requirement: Delivery records the run's tasks
When it opens the run's pull request, the engine SHALL read the archived change's `tasks.md` on the run branch and record the run's tasks in the ticket record: the number of tasks, the commit it read, and each unchecked task with its text (the task line after the checkbox) and its note (the indented lines directly under it, if any). A ticked task SHALL count as done. A line without a checkbox SHALL NOT count as a task. When the record has open tasks, the pull request body SHALL list them under "## Open tasks", each with its note.

#### Scenario: Two tasks left open
- **WHEN** a run delivers PIE-40 and its archived `tasks.md` has 9 tasks, 7 ticked, and 4.1 and 4.2 unchecked, each with a note
- **THEN** the run's record says 9 tasks, with 4.1 and 4.2 open, each with its note, and the pull request body lists both under "## Open tasks"

#### Scenario: Every task ticked
- **WHEN** a run delivers PIE-41 and every task in its archived `tasks.md` is ticked
- **THEN** the run's record says all tasks are done, with no open task, and the pull request body has no "## Open tasks" section

### Requirement: Open tasks force a human merge
When the run has at least one open task at delivery, the merge decision SHALL be the human route with `wouldAutoMerge` false and the reason "N of M tasks were open at delivery", whatever the risk policy, the merge ceiling, the `no-automerge` label, suspension or shadow mode say. The engine SHALL NOT enable auto-merge on that pull request. The pull request body's Merge section SHALL state that reason.

#### Scenario: Low risk with open tasks
- **WHEN** low risk merges automatically and a run delivers PIE-42 with 2 of 9 tasks open
- **THEN** the run's merge route is human, `wouldAutoMerge` is false, the reason is "2 of 9 tasks were open at delivery", and auto-merge is not enabled

#### Scenario: Shadow mode with open tasks
- **WHEN** low risk is in shadow mode and a run delivers PIE-43 with 1 of 5 tasks open
- **THEN** the run's merge reason is "1 of 5 tasks were open at delivery" and `wouldAutoMerge` is false

#### Scenario: No open tasks
- **WHEN** low risk merges automatically and a run delivers PIE-44 with every task ticked
- **THEN** the merge decision is the same as it would be without this requirement

### Requirement: Open tasks fail the tasks status
The engine SHALL post a commit status with context `factory/tasks` on the pull request's head commit, linking to the pull request: failing with the description "N of M tasks open" while any open task is not accepted, passing with "All M tasks done" when no task is open, and passing with "All open tasks accepted by <person>" when every open task is accepted. Delivery SHALL post it when the pull request opens.

#### Scenario: Delivered with open tasks
- **WHEN** a run opens the pull request of PIE-45 with 2 of 9 tasks open
- **THEN** the pull request's head commit has a failing `factory/tasks` status described "2 of 9 tasks open"

#### Scenario: Delivered with every task done
- **WHEN** a run opens the pull request of PIE-46 with all 6 tasks ticked
- **THEN** the head commit has a passing `factory/tasks` status described "All 6 tasks done"

### Requirement: CI checks the tasks on every pull request change
`factory check-tasks --pull-request <N>` SHALL read pull request N. When its body has no `Ticket:` line, the command SHALL post a passing `factory/tasks` status described "No factory ticket" and change no record. Otherwise it SHALL read the change's `tasks.md` at the head commit, compare it with the run's recorded acceptances, post the `factory/tasks` status as "Open tasks fail the tasks status" says, and save the new task state in the run's record only when it differs from the recorded one. When it saves a changed state, it SHALL also rewrite the pull request body's "## Open tasks" section, leaving the rest of the body unchanged: the section lists each open task that is not accepted, with its note, lists accepted tasks under "Accepted open by <person>", and is removed when no open task is left unaccepted. When the ticket's record, the run linked to N, or `tasks.md` cannot be read, it SHALL post a failing status whose description says what could not be read, and exit non-zero.

#### Scenario: A push ticks the last open tasks
- **WHEN** PIE-47's pull request had 2 of 9 tasks open, and a push ticks both, and `check-tasks` runs
- **THEN** the head commit gets a passing status "All 9 tasks done", and the run's record says no task is open

#### Scenario: The body follows the ticks
- **WHEN** PIE-47's pull request body lists 4.1 and 4.2 under "## Open tasks", and a push ticks 4.1, and `check-tasks` runs
- **THEN** the body's "## Open tasks" section lists only 4.2, and every other section of the body is unchanged

#### Scenario: A push that leaves the tasks unchanged
- **WHEN** a push to PIE-48's pull request changes code but not `tasks.md`, and `check-tasks` runs
- **THEN** the new head commit gets the same status as before, and the ticket record is not saved again

#### Scenario: Pull request with no factory ticket
- **WHEN** `check-tasks` runs on a pull request whose body has no `Ticket:` line
- **THEN** the head commit gets a passing status "No factory ticket", and no ticket is read or written

#### Scenario: The change folder is missing
- **WHEN** `check-tasks` runs on PIE-49's pull request and no change folder for PIE-49 holds a `tasks.md` at the head commit
- **THEN** the head commit gets a failing status saying `tasks.md` could not be read, and the command exits non-zero

### Requirement: A person accepts open tasks
`factory accept-tasks <KEY>` SHALL read the `tasks.md` of the ticket's latest run at its pull request's head commit, record an acceptance with the person and the time for each task open there, matched by text, post a passing `factory/tasks` status on the head commit, and save the record. An acceptance SHALL cover only the tasks it named: an open task whose text matches no acceptance SHALL fail the status again. The command SHALL refuse when no task is open and not accepted, and when the pull request is merged or closed.

#### Scenario: Accept two open tasks
- **WHEN** Pierre runs `factory accept-tasks PIE-50` while 4.1 and 4.2 are open on its pull request
- **THEN** the record holds an acceptance by Pierre for 4.1 and 4.2, and the head commit gets a passing status "All open tasks accepted by Pierre"

#### Scenario: A new open task after an acceptance
- **WHEN** 4.1 and 4.2 of PIE-51 were accepted, and a push adds task 5.1 unchecked, and `check-tasks` runs
- **THEN** the head commit gets a failing status "1 of 10 tasks open"

#### Scenario: A reworded accepted task
- **WHEN** 4.1 of PIE-52 was accepted, and a push rewords 4.1 and leaves it unchecked, and `check-tasks` runs
- **THEN** the reworded 4.1 counts as open and not accepted, and the status fails

#### Scenario: Ticking an accepted task
- **WHEN** 4.1 and 4.2 of PIE-53 were accepted, and a push ticks 4.1, and `check-tasks` runs
- **THEN** the status passes and the record says 1 task is open, accepted

#### Scenario: Nothing to accept
- **WHEN** a person runs `factory accept-tasks PIE-54` and every task is ticked or accepted
- **THEN** the command refuses, saying no task is open, and changes nothing

#### Scenario: Pull request already merged
- **WHEN** a person runs `factory accept-tasks PIE-55` and its pull request is merged
- **THEN** the command refuses, saying the pull request is merged, and changes nothing
