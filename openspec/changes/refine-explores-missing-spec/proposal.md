# Proposal

## Why

When `/factory-refine` starts on a ticket with no OpenSpec files attached, it stops and says a draft spec is required. The person then has to leave the skill, draft a change somewhere else, attach it by hand with `factory push`, and start refinement again. That is the most common way a ticket enters refinement, so the handoff costs time every time and loses the context of the session. PIE-16 asks the skill to go straight into OpenSpec explore mode instead, build the draft with the person, and keep going.

## What Changes

- `factory status <KEY>` on a ticket with no spec attached still refuses with `no_spec`, and the refusal now also carries the ticket's title and description (D-001).
- `/factory-refine` no longer stops when `factory status <KEY>` refuses with `no_spec`. It opens an OpenSpec explore session about the ticket, using the ticket's title and description as the starting point.
- When explore mode is not installed in the project, the skill offers OpenSpec's propose mode instead and says how to install explore mode (D-002).
- When the exploration is captured as an OpenSpec change folder, the skill attaches it with `factory push <KEY> --from <folder>` and continues refinement from step 2, as for any ticket that arrived with a draft.
- The ticket's status and factory comment do not change until the draft is attached and `factory refine <KEY>` runs. A person who stops during exploration leaves the ticket as it was.
- The existing path stays: if the person already has a draft change folder locally, the skill offers to attach it instead of exploring.
- The README's "Attach a draft spec" step says the refine skill can now build the draft itself.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `refinement`: adds a requirement for what `factory status` returns on a ticket with no spec, and a requirement for how refinement behaves on a ticket with no spec attached. It drafts one through OpenSpec explore mode instead of stopping. This replaces the "Ticket has no spec" scenario of the v1 requirement "Refinement starts from a draft spec in the ticket", which is still in the unarchived `define-software-factory-v1` change and not yet in `openspec/specs/refinement/spec.md`.

## Impact

- `skills/factory-refine/SKILL.md`: step 1's `no_spec` branch, and the opening rule "do not write one from nothing".
- `README.md`: the workflow step "Attach a draft spec".
- `openspec/specs/refinement/spec.md`: gains the new requirements on archive.
- `openspec/changes/define-software-factory-v1/specs/refinement/spec.md`: its "Ticket has no spec" scenario and its "from nothing" rule now match this change (D-003).
- `src/factory/refinement.ts` and `src/cli/cli.ts`: the `no_spec` refusal of `factory status` carries the ticket's title and description, with tests in `tests/refinement.test.ts` and `tests/cli.test.ts`.
- No change to the ticket workflow, the factory comment or the ready gate. Callers that read the `no_spec` refusal of `factory status` see one extra field.
