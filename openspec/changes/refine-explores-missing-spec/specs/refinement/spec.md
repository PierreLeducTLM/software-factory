# Spec Delta

## ADDED Requirements

### Requirement: Refinement drafts a missing spec through OpenSpec explore mode
When a person starts a refine session on a ticket with no OpenSpec files attached, the refine skill SHALL open an OpenSpec explore session about that ticket instead of stopping. When explore mode is not installed, the skill SHALL offer OpenSpec's propose mode instead. The skill SHALL start the exploration from the ticket's title and description, as `factory status` returns them. Once the exploration is captured as an OpenSpec change folder, the skill SHALL attach it to the ticket with `factory push` and continue refinement as it does for a ticket that arrived with a draft spec.

The skill MUST NOT change the ticket's status or its factory comment before the draft is attached. If the person already has a draft change folder for the ticket, the skill SHALL offer to attach that folder instead of exploring.

#### Scenario: Ticket with no spec goes into explore mode
- **WHEN** a person starts a refine session on a ticket with no OpenSpec files attached and has no local draft for it
- **THEN** the skill opens an OpenSpec explore session that starts from the ticket's title and description, and the ticket's status stays unchanged

#### Scenario: Exploration is captured as a draft
- **WHEN** the explore session is captured as an OpenSpec change folder
- **THEN** the skill attaches the folder with `factory push <KEY> --from <folder>`, runs `factory refine <KEY>`, and continues refinement from the attached files

#### Scenario: Person stops during exploration
- **WHEN** the person ends the session before the exploration is captured as a change folder
- **THEN** nothing is attached to the ticket, its status and factory comment are unchanged, and the skill says that the ticket still has no draft spec

#### Scenario: Explore mode is not available
- **WHEN** a person starts a refine session on a ticket with no OpenSpec files attached, has no local draft for it, and OpenSpec's explore mode is not installed in the project
- **THEN** the skill says explore mode is not available, asks whether to draft the spec with OpenSpec's propose mode instead, starting from the ticket's title and description, and names `openspec config profile` followed by `openspec update` as the way to install explore mode, without running them

#### Scenario: Person accepts propose mode
- **WHEN** the person accepts propose mode and it writes an OpenSpec change folder
- **THEN** the skill attaches the folder with `factory push <KEY> --from <folder>`, runs `factory refine <KEY>`, and continues refinement from the attached files

#### Scenario: Person declines propose mode
- **WHEN** the person declines propose mode
- **THEN** the skill stops and says a draft spec is needed; nothing is attached, and the ticket's status and factory comment are unchanged

#### Scenario: Neither explore nor propose mode is available
- **WHEN** neither OpenSpec's explore mode nor its propose mode is installed in the project
- **THEN** the skill stops, says a draft spec is needed and names `openspec config profile` followed by `openspec update` as the way to install them; nothing is attached and the ticket is unchanged

#### Scenario: Person already has a local draft
- **WHEN** a person starts a refine session on a ticket with no OpenSpec files attached and has a draft change folder for it locally
- **THEN** the skill offers to attach that folder with `factory push` and continues refinement from it if the person accepts

### Requirement: Status shows the ticket of a refusal for a missing spec
When `factory status <KEY>` refuses a ticket that exists but has no OpenSpec files attached, the refusal SHALL carry the ticket's title and description, so that a draft can be started from them. The `no_spec` refusals of the other `factory` commands SHALL stay unchanged.

#### Scenario: JSON status of a ticket with no spec
- **WHEN** `factory status <KEY> --json` runs on a ticket that exists and has no OpenSpec files attached
- **THEN** it exits with code 1 and prints `{"ok":false,"reason":"no_spec","message":"<KEY> has no OpenSpec files attached. A draft spec is required","ticket":{"title":"<title>","description":"<description>"}}`

#### Scenario: Ticket with an empty description
- **WHEN** `factory status <KEY> --json` runs on a ticket with no OpenSpec files attached whose tracker description is empty
- **THEN** the refusal's `ticket.description` is `""` and `ticket.title` is the ticket's title

#### Scenario: Text status of a ticket with no spec
- **WHEN** `factory status <KEY>` runs without `--json` on a ticket that exists and has no OpenSpec files attached
- **THEN** it prints the refusal message, then the ticket's title on the next line, and exits with code 1

#### Scenario: Other commands keep their refusal
- **WHEN** `factory pull`, `factory ready-gate`, `factory approve --preview` or `factory revalidate` runs on a ticket with no OpenSpec files attached
- **THEN** the refusal has `reason`, `message` and no `ticket` field, as before
