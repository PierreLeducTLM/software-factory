---
name: factory-workflow
description: Change the factory workflow of a project, such as adding, removing or tuning a check, changing the risk policy or the staging watch, through a validated and reviewed pull request. Use when the user says "/factory-workflow", "factory workflow", "add a check to the factory", "make this check advisory", "change the factory pipeline", or a factory doctor finding suggests /factory-workflow.
---

# Factory workflow

Turn the person's request into a change to `.factory/`, show what the pipeline becomes, try the new checks on main, and open a pull request. The change takes effect only once someone merges it.

**Before you start:** work in a worktree of the latest main, with nothing else changed, because the new checks run in this folder:

```bash
git fetch origin
git worktree add <folder> origin/<main branch>
```

Read the project's `main_branch` in `.factory/factory.yaml`. Run every command below from that folder, and add `--json` to every `factory` command.

## 1. Translate the request

Edit `.factory/factory.yaml` with the smallest change that does what the person asked. A check is one entry under `checks`:

| Field | Meaning |
|---|---|
| `id` | a short unique name |
| `station` | `quality` before the pull request, `review` with the reviewers, or a station of the project's own |
| `kind` | `script` runs a command, `agent` asks a reviewing agent to judge against a rubric |
| `blocking` | `true` stops the change on failure; `false` only reports |
| `timeout` | a number followed by `s`, `m` or `h`, such as `90s` or `6m` |
| `run` | the command of a local script check |
| `source: ci` and `job` | a script check whose result comes from a CI job, named as the CI names it |
| `criteria` and `evidence` | for an agent check: the rubric file under `.factory/checks/`, and the proof the agent must attach, such as `screenshots` |
| `applies_when` | optional: when the check applies |

For a new agent check, also write its rubric at the path in `criteria`: what the agent must check, in plain language, and what proof it must attach.

Never add a token or password to `.factory/`. A provider credential is the name of an environment variable.

## 2. Preview the change

```bash
factory workflow --title "<what the change does>" --preview --json
```

Show the person the new `pipeline`, the `diff` (added, changed, removed checks), the `rubrics` that changed, and each `trials` result. Ask them to confirm. A refusal here means the same as in step 3: act on it before going on.

## 3. Open the pull request

```bash
factory workflow --title "<what the change does>" --json
```

| Result | What to do |
|---|---|
| `action: "opened"` | Share the `url`. Nothing changes until it is merged |
| `reason: "failing_check"` | A new or changed blocking check fails on current main. Show its `detail`, then offer two ways on: fix main first, or make the check advisory (`blocking: false`) and try again. No pull request was opened |
| `reason: "invalid"` | The configuration would not be accepted. Fix each named field and try again |
| `reason: "missing_rubric"` | Write the rubric at the path the message names and try again |
| `reason: "no_change"` | Nothing differs from main. Check that you edited the files in this worktree |

## 4. Finish

Remove the worktree, then end with one line: the pull request, or why none was opened.
