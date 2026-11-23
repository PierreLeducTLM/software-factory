# Spec Delta

## ADDED Requirements

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

