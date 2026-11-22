---
name: factory-refine
description: Refine a ticket's draft spec and get it approved. Use when the user wants to refine a ticket or answer a spec's open questions.
argument-hint: "[KEY]"
---

# Factory refine

Take one ticket from a draft spec to an approved spec in Ready for Dev. This is the only place where a person answers questions about the ticket. Once it is approved, the factory builds it without asking anything.

**Input:** a ticket key, such as `PAY-142`. If none is given, ask for one.

**What you change:** the spec files, and nothing else. Do not write or edit production code or tests.

**How you change the ticket:** only through the `factory` command. Never edit the factory comment, a ticket status or a label yourself. Add `--json` to any command when you need to read its result.

## Steps

### 1. Look at where the ticket stands

```bash
factory status <KEY> --json
```

- If it is refused with `no_spec`, the ticket has no OpenSpec files attached. Refinement starts from a draft, so do not write one from nothing. If the user has a draft change folder locally, offer to attach it with `factory push <KEY> --from <folder>`. Otherwise stop and say a draft spec is needed.
- If it is refused with `record_edited`, stop and tell the user the factory comment was edited by hand.
- If `questions` is not empty, the factory sent this ticket back. Those questions come first, in step 4.

### 2. Start refinement and get the spec files

```bash
factory refine <KEY>
factory pull <KEY> --to openspec/changes/<name>
```

Use the change name from the proposal for `<name>`, in kebab-case. The files land as a normal OpenSpec change folder: `proposal.md`, `design.md`, `tasks.md` and `specs/<capability>/spec.md`.

### 3. Read before asking

Read every pulled file. Then read the code, tests and existing specs the change touches, so that you only ask what the repository cannot answer.

### 4. Find every open question

Start with the send-back questions from step 1, if any. Then look for:

- `TBD` markers, and anything under "Open Questions" in `design.md`
- requirements with no scenario, or scenarios whose outcome is not stated
- behaviour a user or another system could observe that the spec leaves open: inputs, outputs, errors, limits, ordering, permissions
- conflicts with existing specs or with what the code does today
- an "Affected paths" section that is missing or does not match the code the change will touch
- tasks that do not say how they will be verified

Only ask about behaviour someone can observe. Choices nobody can observe, such as private names or helper structure, are not questions. They follow the repository's conventions.

### 5. Ask one question at a time

For each question, give the context in a sentence or two and a recommended answer, then wait for the person's answer. Do not batch questions, and do not answer on the person's behalf.

### 6. Record each answer as a decision

As soon as a question is answered:

1. Add an entry to the "Decisions" section of `design.md`, numbered `D-001`, `D-002` and so on: the question, the decision, and its effect on the spec.
2. Change the delta specs, the tasks and the proposal so they say what was decided.
3. Remove the question from "Open Questions". When none are left, the section says "None" or is removed.

A question is closed only when it has a recorded decision.

### 7. Make the spec pass the ready gate

Before pushing, check that:

- `design.md` has a "Decisions" section
- one file has an "Affected paths" section listing each path or pattern the change will touch, one per line
- every task says how it is verified
- no `TBD` remains

Then attach what changed and run the gate:

```bash
factory push <KEY> --from openspec/changes/<name>
factory ready-gate <KEY>
```

If the gate fails, it lists its findings. Fix the ones that need no decision, ask about the ones that do, then push and run it again. Repeat until it passes.

### 8. Get the approval

Show the merge route first:

```bash
factory approve <KEY> --preview
```

Tell the person the route it prints, for example "Low risk, would auto-merge", and ask whether they approve. Offer the option to require a human merge for this ticket.

Approve only after an explicit yes:

```bash
factory approve <KEY>
factory approve <KEY> --ceiling human
```

Use the second form when the person asked for a human merge. The ticket moves to Ready for Dev.

### 9. Report

Say that the ticket is in Ready for Dev, list the decisions recorded in this session, and give the merge route.

## Guardrails

- Never approve without the person's explicit yes in this session.
- Never invent the answer to a question about observable behaviour. Recommend one, then ask.
- If the person stops before the gate passes, push what is done so nothing is lost, and say which findings remain.
- If a `factory` command exits with code 2, the project is not set up or the command was misused. Show its message and stop.
