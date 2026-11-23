# Tasks

## 1. Status of a ticket with no spec

- [ ] 1.1 Test-first in `tests/refinement.test.ts`: `refinementStatus` on a ticket with no spec attachments returns the `no_spec` refusal with `ticket.title` and `ticket.description`, and `""` when the description is empty; verify the new tests fail, then pass after the change in `src/factory/refinement.ts`
- [ ] 1.2 Test-first in `tests/refinement.test.ts`: `pullSpecFiles`, `runReadyGate`, `approvalPreview` and `revalidate` keep a `no_spec` refusal with no `ticket` field; verify the tests pass
- [ ] 1.3 Test-first in `tests/cli.test.ts`: `factory status <KEY> --json` prints the refusal with the `ticket` object and exits 1, and the text form prints the message then the title on the next line; verify the new tests fail, then pass after the change in `src/cli/cli.ts`
- [ ] 1.4 Verify `pnpm vitest run` and `pnpm tsc --noEmit` pass, and run mutation testing on the changed lines with no surviving mutant

## 2. Refine skill

- [ ] 2.1 Rewrite step 1's `no_spec` branch in `skills/factory-refine/SKILL.md`: offer a local draft folder if one exists, otherwise open OpenSpec explore mode, or, when explore mode is not installed, ask whether to use propose mode and name `openspec config profile` then `openspec update` to install explore, seeding either with the ticket's key and the `ticket.title` and `ticket.description` of the `factory status --json` refusal; verify by reading the step against each scenario of `specs/refinement/spec.md`
- [ ] 2.2 Add the hand-back in `skills/factory-refine/SKILL.md`: once exploration or propose mode produces a change folder, run `factory push <KEY> --from <folder>` and continue at step 2; verify the step names both commands and the folder comes from the captured change
- [ ] 2.3 Add the abandon path in `skills/factory-refine/SKILL.md`: if the person stops before a change folder exists, declines propose mode, or neither mode is installed, attach nothing, leave the ticket as it is, and say it still has no draft spec; verify the guardrails section states it
- [ ] 2.4 Replace the opening rule "do not write one from nothing" so it no longer contradicts the new branch; verify `grep -n "from nothing" skills/factory-refine/SKILL.md` finds no contradicting rule
- [ ] 2.5 In `openspec/changes/define-software-factory-v1/specs/refinement/spec.md`, change "It MUST NOT write a spec from nothing" to "It MUST NOT write a spec without the person" and rewrite the "Ticket has no spec" scenario so the skill opens OpenSpec explore mode and the status stays unchanged until a draft is attached; verify `openspec validate define-software-factory-v1` passes and `grep -n "stops, explains that a draft spec is required" openspec/changes/define-software-factory-v1/specs/refinement/spec.md` finds nothing
- [ ] 2.6 Verify `pnpm vitest run tests/packaging.test.ts` passes, so the skill's frontmatter still names it and says when to use it

## 3. Documentation

- [ ] 3.1 Update the "Attach a draft spec" step in `README.md` to say `/factory-refine` builds the draft through OpenSpec explore mode when none is attached; verify the README no longer says refinement never writes a draft

## 4. End-to-end check

- [ ] 4.1 Run `/factory-refine` on a PIE ticket in To refine with no spec attached; verify that explore mode opens, then, in a scratch project without the explore workflow, that the skill offers propose mode and names the install commands; verify that the ticket stays in To refine until the push, and that after capture `factory status <KEY> --json` returns `ok: true` with the ticket in Spec review
