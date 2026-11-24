# Tasks

## 1. Run skill

- [ ] 1.1 In `skills/factory-run/SKILL.md` step 2, replace "Do not edit it." with a rule that `tasks.md` is the only spec file the builder changes, and only its checkboxes and the notes under them, while the proposal, the design, the delta specs and the ticket's attachments stay as approved; verify `grep -n "Do not edit it" skills/factory-run/SKILL.md` finds nothing and the new rule names `tasks.md`, the three other kinds of spec file, and the attachments
- [ ] 1.2 In the `next: build` step of `skills/factory-run/SKILL.md`, say that the builder ticks a task (`- [ ]` to `- [x]`) once it is done and verified the way the task says, and that a task not done, or only partly done, stays unchecked with an indented note directly under it saying what is missing; verify by reading the step against each scenario of `specs/build-loop/spec.md`
- [ ] 1.3 In the same step, say that the commit made before `factory advance --changed` includes the updated `tasks.md`; verify the step names `tasks.md` in what is committed
- [ ] 1.4 In the `next: build` step, say a build may be handed in with unchecked tasks as long as each has a note (D-001); in the `next: verify` step, say that an unchecked task with a note under it is not a finding, and an unchecked task with no note is a finding that names the task; verify by reading both steps against the scenarios "A noted unchecked task does not fail verification" and "An unchecked task with no note fails verification"
- [ ] 1.5 In the `next: review` step, tell the reviewer to compare the ticks in `tasks.md` with the diff and to raise a finding for a ticked task with no code or test behind it and for an unchecked task whose work is in the diff (D-002); verify by reading the step against the scenarios "The reviewer flags a tick with nothing behind it" and "The reviewer flags done work left unchecked"
- [ ] 1.6 In step 2, say that when the change folder is already committed on the run branch the run does not pull the spec again and keeps the committed `tasks.md`, and otherwise pulls as before (D-003); verify by reading step 2 against the scenarios "A resumed run keeps the ticks" and "A resumed run with nothing committed pulls the spec"
- [ ] 1.7 Verify `pnpm vitest run tests/packaging.test.ts` passes, so the skill's frontmatter still names it and says when to use it

## 2. End-to-end check

- [ ] 2.1 After this change is released, run `/factory-run` on a PIE ticket with at least two tasks; verify that the pull request's archived `tasks.md` has every completed task ticked and an indented note under any unchecked one, and that `factory pull <KEY> --to <scratch folder>` gives a `proposal.md`, `design.md` and delta specs identical to the archived ones and an attached `tasks.md` with no ticks; also interrupt the run after its first build commit, run `/factory-run` again, and verify the ticks committed before the interruption are still in `tasks.md`
