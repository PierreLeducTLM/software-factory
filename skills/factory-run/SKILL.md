---
name: factory-run
description: Build an approved ticket into a pull request. Use when the user says /factory-run or /factory-next, or wants to build or retry a ticket.
argument-hint: "[KEY]"
---

# Factory run

Deliver one approved ticket. You are the builder. The `factory` command decides what happens next: it runs the gates, counts the attempts, and tells you whether to build, fix, hand in a verdict, diagnose, or stop.

**Input:** a ticket key such as `PAY-142`, or "next" to take the next eligible ticket.

**One rule above the others:** once the run has started, never ask the person a question. Questions go back through the ticket.

**How you change the ticket:** only through `factory`. Never edit the factory comment, a ticket status or a label, and never open the pull request yourself. Add `--json` to every command and read its result.

## 1. Start or resume the run

```bash
factory run <KEY> --json
factory next --json
```

Use the second form when asked for the next ticket. If the command is refused, act on its `reason`:

| Reason | What to do |
|---|---|
| `needs_takeover_confirmation` | Another developer has the run. Ask the person to confirm, then rerun with `--confirm-takeover` |
| `needs_retry_confirmation` | The ticket is Blocked. Ask the person to confirm the retry, then rerun with `--confirm-retry` |
| `run_limit` | The ticket used all its runs. Say so, ask the person, then rerun with `--over-limit` only on a yes |
| `record_edited` | The factory comment was edited by hand. Show the message, ask the person, then rerun with `--accept-edited-record` only on a yes |
| `worktree_busy` | This worktree already hosts a run. Tell the person to open a new Orca worktree, and stop |
| anything else | Show the message and stop |

These confirmations are the only questions you may ask. They come before the run starts.

## 2. Get the spec

```bash
factory pull <KEY> --to openspec/changes/<name>
```

Use the change name from the proposal for `<name>`. This is the spec that was approved.

When the run resumes and `openspec/changes/<name>` is already committed on the run branch, do not pull again: keep the committed `tasks.md` and the ticks it holds. Pull only when the change folder is not committed yet.

`tasks.md` is the only spec file you change, and only its checkboxes and the notes under them. The proposal, the design and the delta specs stay as approved, and so do the spec files attached to the ticket.

## 3. Follow the loop

Call `factory advance <KEY> --json` and do what its `next` field says. Repeat until `next` is `done`.

### `next: build`

Implement the change's tasks in this worktree, as the OpenSpec apply workflow does. If `feedback` is not empty, the previous attempt failed: fix exactly those failures first.

Tick each task in `tasks.md` (`- [ ]` becomes `- [x]`) once it is done and verified the way the task says. A task that is not done, or only partly done, stays `- [ ]` with an indented note directly under it that says what was done and what is missing, or why it was not started:

```markdown
- [ ] 2.1 Run the end-to-end check after the release
  - Not done: needs the released engine, which this run cannot publish.
```

You may hand in a build with unchecked tasks, as long as each one has such a note.

When something in the spec is open, look for the answer in this order, and take the first one you find:

1. the "Decisions" section of `design.md`
2. the delta specs of the change
3. the canonical specs under `openspec/specs/`

Note the id of each decision you applied, such as `D-002`.

- A choice nobody can observe, such as a private name or a helper's structure, is yours. Follow the repository's conventions.
- A question about behaviour someone can observe, which none of the three sources answers, stops the build. Do not guess and do not ask the person. Hand it in with a recommended answer:

```bash
factory advance <KEY> --question "<the question>" --recommended "<your recommended answer>" --json
```

When the build is done, commit the work on the branch, including the updated `tasks.md`, then report it in one line with the decisions you applied:

```bash
factory advance <KEY> --changed "<what changed in this attempt>" --decision D-001 --decision D-004 --json
```

The quality gate runs inside that command. Do not run it yourself to decide whether to report.

### `next: verify`

Run the OpenSpec verify workflow on the change. An unchecked task in `tasks.md` with an indented note under it is a warning, not a finding: it does not fail the verdict. An unchecked task with no note is a finding that names the task. Write the verdict to a file in the format below, then hand it in:

```bash
factory advance <KEY> --verdict openspec-verify=<file> --json
```

### `next: review`

`checks` lists every verdict needed: always `reviewer`, plus any agent check with its `criteria` file and the `evidence` it requires.

For each check, start a fresh subagent that did not write the code. Give it the diff against main, the spec, and for an agent check its criteria file. Ask it for a verdict in the format below and nothing else.

- The reviewer compares the diff with the spec: every requirement and scenario honoured, nothing built that the spec does not ask for.
- The reviewer compares the ticks in `tasks.md` with the diff. A ticked task with no code or test in the diff behind it is a finding that names the task, and so is an unchecked task whose work is in the diff.
- Ask the reviewer to raise the risk when the change is riskier than it looks, for example when it touches behaviour that many features depend on.
- An agent check applies its criteria file, and attaches the evidence the check requires.

Save each verdict to its own file exactly as the subagent returned it. Never write, edit or summarise a verdict yourself. Then hand them all in together:

```bash
factory advance <KEY> --verdict reviewer=<file> --verdict <check-id>=<file> --json
```

### `next: diagnose`

Every attempt failed. `attempts` shows what failed and what changed each time. Choose exactly one diagnosis:

- `code`: the change itself is wrong and you could not make it right
- `environment`: the failures do not depend on the change, for example a test that passes and fails on the same code
- `spec`: the spec is missing something or contradicts itself

For `code` or `environment`, add the next step you suggest:

```bash
factory advance <KEY> --diagnosis environment --next-step "<what a person should do next>" --json
```

For `spec`, state each gap as a question with a recommended answer. The ticket goes back to refinement instead of being blocked:

```bash
factory advance <KEY> --diagnosis spec --question "<question>" --recommended "<answer>" --json
```

### `next: done`

Stop and report the `exit`:

- `pull_request`: give the pull request link, and say who merges it (the pull request's "Merge" section says so). If you left tasks unchecked in `tasks.md`, list them, and say that they block the merge: the `factory/tasks` check fails until each one is ticked in a push or accepted as open with `factory accept-tasks <KEY>`
- `sent_back`: the ticket is back in refinement; list the questions
- `blocked`: give the link to the failure report

## Verdict format

A verdict is one JSON object and nothing else. Anything else counts as a failed check.

```json
{
  "verdict": "pass",
  "findings": [],
  "evidence": ["path/or/link/to/proof"]
}
```

- `verdict` is `pass` or `fail`.
- `findings` lists what is wrong, one string each. It is empty on a pass.
- `evidence` lists the proof the check requires, such as screenshot paths. A pass without required evidence fails.

The reviewer, and only the reviewer, may also raise the risk of the change. It adds two fields to its verdict:

```json
{ "verdict": "pass", "findings": [], "evidence": [], "risk": "high", "riskReason": "Changes how invoices are rounded" }
```

- `risk` is `low`, `medium` or `high`. A level lower than the one the factory computed is ignored.
- `riskReason` says why, in one sentence. Without it the raise is ignored.

## Guardrails

- If `factory advance` answers `input_required`, its message says what it is waiting for. Provide that; do not skip the step.
- If the session is interrupted, running this skill again resumes from where the ticket's record says the run is.
- If a `factory` command exits with code 2, the project is not set up or the command was misused. Show its message and stop.
