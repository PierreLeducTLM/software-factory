# Design

## Context

See proposal.md for the motivation. Today the `no_spec` branch lives only in the refine skill (`skills/factory-refine/SKILL.md`, step 1). The engine already supports the flow this change needs:

- `factory status <KEY>` refuses with `no_spec` when the ticket has no spec attachments (`src/factory/refinement.ts`, `open`). The ticket's title and its tracker description (`Ticket.title` and `Ticket.spec`) are already loaded at that point.
- `factory push <KEY> --from <folder>` attaches files to a ticket that has none yet (covered by "attaches draft files to a ticket that has none yet" in `tests/refinement.test.ts`).
- `factory refine <KEY>` moves the ticket from To refine to Spec review once files are attached.

OpenSpec explore mode is provided by OpenSpec's own skill (`openspec-explore`, or the `/opsx:explore` command). It is a thinking mode: it only writes change artifacts after the person confirms, and it can capture the discussion as a new change folder under `openspec/changes/`.

The v1 change `define-software-factory-v1` (not yet archived) holds the requirement "Refinement starts from a draft spec in the ticket", whose scenario "Ticket has no spec" says the skill stops. That requirement is not in `openspec/specs/refinement/spec.md` on main, so this change adds a new requirement rather than modifying it, and amends the v1 change directly (D-003).

## Goals / Non-Goals

**Goals:**
- A person who runs `/factory-refine` on a ticket with no spec ends the same session with a draft attached and refinement under way.
- Nothing changes on the ticket until a draft is attached.

**Non-Goals:**
- Writing a draft without the person. Explore mode is a conversation, and its capture still needs the person's confirmation.
- Changing the ready gate, the approval or the factory comment.
- Drafting specs in `/factory-run` or `/factory-next`. Those only take approved tickets.

## Decisions

### D-001: The skill reads the ticket's title and description from `factory status`

- **Question:** How does the skill get the ticket's title and description to seed explore mode? No `factory` command showed them.
- **Decision:** For a ticket that exists but has no spec attached, the `no_spec` refusal of `factory status` also carries the ticket's title and description. With `--json` the refusal gains `"ticket": {"title": "…", "description": "…"}`. A ticket whose tracker description is empty gives `"description": ""`. The text output prints the title on one extra line after the refusal message. The `no_spec` refusals of the other commands stay as they are.
- **Effect on the spec:** new requirement "Status shows the ticket of a refusal for a missing spec" in `specs/refinement/spec.md`. The engine gains a small change in `src/factory/refinement.ts` and `src/cli/cli.ts`, test-first, and tasks group 1 covers it. The skill seeds explore mode from that result and makes no other call.

### D-002: Without explore mode, the skill offers propose mode and says how to install explore

- **Question:** What does the skill do when OpenSpec's explore mode is not installed in the project?
- **Decision:** The skill tells the person that explore mode is not available and asks whether they want to draft the spec with OpenSpec's propose mode (`openspec-propose`, `/opsx:propose`) instead, seeded with the same ticket key, title and description. In the same message, it invites them to install explore mode if they want it: `openspec config profile` to add the explore workflow, then `openspec update` in the project. The skill does not run either command. If the person accepts, the change that propose mode writes is attached and refinement continues, as for a captured exploration. If they decline, the skill stops as it did before this change: nothing is attached and the ticket is unchanged. If propose mode is not available either, the skill stops the same way and names the same install commands for both workflows.
- **Effect on the spec:** new scenarios "Explore mode is not available", "Person declines propose mode" and "Neither explore nor propose mode is available" under the explore-mode requirement in `specs/refinement/spec.md`. Tasks 2.1 and 2.3 cover the skill text.

### D-003: This change also amends the v1 refinement spec

- **Question:** Should this change amend the requirement "Refinement starts from a draft spec in the ticket" in the unarchived `define-software-factory-v1` change, which says the skill stops on a ticket with no spec?
- **Decision:** Yes. In `openspec/changes/define-software-factory-v1/specs/refinement/spec.md`, "It MUST NOT write a spec from nothing" becomes "It MUST NOT write a spec without the person", and the "Ticket has no spec" scenario says the skill opens OpenSpec explore mode as the requirement "Refinement drafts a missing spec through OpenSpec explore mode" describes, leaving the ticket's status unchanged until a draft is attached.
- **Effect on the spec:** no new delta in this change, since the v1 requirement is not on main. The v1 change's spec file joins the affected paths, and task 2.5 covers the edit.

Working assumptions in this draft, to confirm during refinement:
- The skill hands off to OpenSpec's explore skill rather than copying its instructions into the refine skill, so explore mode stays the single source of how exploration works.
- The ticket stays in To refine during exploration and only moves to Spec review when `factory refine` runs after the push, so an abandoned exploration leaves no trace.

## Risks / Trade-offs

- [The project has no OpenSpec explore skill installed] → D-002: the skill offers propose mode and names how to install explore.
- [Explore mode is open-ended and can drift from the ticket] → the skill seeds it with the ticket's title and description and names the ticket key, so the captured change stays tied to it.
- [The v1 requirement still says the skill stops on `no_spec`] → D-003: this change amends it.

## Open Questions

None.

## Affected paths

- `src/factory/refinement.ts`
- `src/cli/cli.ts`
- `tests/refinement.test.ts`
- `tests/cli.test.ts`
- `skills/factory-refine/SKILL.md`
- `README.md`
- `openspec/specs/refinement/spec.md`
- `openspec/changes/define-software-factory-v1/specs/refinement/spec.md`
