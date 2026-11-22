---
name: factory-init
description: Install the software factory in a project from the checks it already has, through one install pull request and one pull request per added check. Use when the user says "/factory-init", "factory init", "install the factory", "set the factory up in this project", or a factory command says ".factory/factory.yaml is missing".
---

# Factory init

Set the factory up in this project in five steps: detect, verify, show coverage, let the person choose, deliver pull requests. You never commit to main: the install and every added check arrive as pull requests.

**Before you start:** work in an up-to-date checkout of the main branch with no local changes. The wizard runs the project's checks, and their results only mean something on main. `factory` must be on the PATH.

Add `--json` to every `factory` command and read its result.

## 1. Detect and verify

```bash
factory init detect --verify --json
```

It finds the stack, the CI system and jobs, the checks the project already has, OpenSpec, the design system and the git remote. Then it runs each local check once, twice when it fails, and measures it. This can take as long as the test suites.

Show the person:
- the stack. When `detection.stack.note` is set, the stack is not one the factory knows in depth: say that the checks come from the CI files only.
- the coverage per category (`detection.coverage`): the checks found, or the recommended one when there is none.
- each verified check: pass, fail or flaky, its duration and the timeout derived from it.

## 2. Let the person choose, per category

For each category, offer three choices: use the existing check, add the recommended one, or skip. A check that failed or was flaky on main can still be used, but suggest it as advisory (`blocking: false`) until main is fixed.

Also ask:
- the paths whose changes always need a person (`sensitivePaths`), such as `src/auth/**`;
- whether a staging deploy exists and should be watched after each merge. Without staging, leave `watch` out: the install then adds no watch step.

## 3. Write the answers

Write the answers to a JSON file outside the repository, such as `$TMPDIR/factory-init-answers.json`. It is never committed.

| Field | Where it comes from |
|---|---|
| `engine` | `engine` from step 1 |
| `repository` | `detection.remote.repository`, or ask |
| `mainBranch` | the branch you are on |
| `checks` | each kept check: `{ id, category, source, run or job, blocking, timeout }`, with the timeout from step 1. Leave out the checks to add: they come in their own pull requests |
| `sensitivePaths` | step 2 |
| `ticketProvider` | `{ kind: "jira", baseUrl, filter, tokenEnv, emailEnv }`. The filter selects this repository's tickets. The two `*Env` fields are names of environment variables, never the token itself |
| `sourceControl` | `{ kind: "github" or "bitbucket", tokenEnv, usernameEnv? }` |
| `ci` | `{ system, workflow, install }`: `system` from `detection.ci.system`; `workflow`, the name of the CI workflow that builds main, which the revert step follows; `install`, `npm install --global software-factory@<engine>` |
| `watch` | only with a staging deploy: `{ checks, duration, interval, environment }` |
| `states` | step 4 |

## 4. Match the statuses

```bash
factory init statuses --answers <file> --json
```

It reads the provider's statuses and matches each factory state by name and category. Put `matched` into `states`. Ask only about the states in `unmatched`, offering the provider's `statuses` as choices. When nothing is unmatched, ask nothing.

## 5. Check the service account and open the install pull request

The CI steps write to the tickets as a service account. Ask the person for the account, and to export its token and email into the variables named in `ticketProvider`. Ask for one ticket key the filter returns.

```bash
factory init install --answers <file> --ticket <KEY> --json
```

| Result | What to do |
|---|---|
| `ok: true` | Share the `url`. List the `secrets` to store in the CI secret store before merging, and the `manual` steps |
| `reason: "service_account"` | Show the `message`: it names the missing permission. No pull request was opened. Run the command again once the permission is granted |
| an error | Show it. An `answers: <field>` error names the field to fix in the answers file |

The install pull request holds `.factory/factory.yaml`, `.factory/adapters.yaml`, `.factory/checks/` and, on GitHub, the factory workflow. Every risk level starts in shadow mode.

## 6. One pull request per added check

For each check the person chose to add, in its own branch from main:

1. `git worktree add -b factory/add-<id> <folder> origin/<mainBranch>`
2. In that folder, follow the recommendation's `how`, and run the check until it passes.
3. Commit, push the branch, and remove the worktree.
4. Open the pull request:

```bash
factory init pull-request --answers <file> --branch factory/add-<id> --title "chore: add the <id> check" --body "<what it adds and how to run it>"
```

Once that pull request is merged, add the check to the factory with `/factory-workflow`.

## 7. Finish

End with: the install pull request, each added-check pull request, the secrets to store, and the manual steps that are left.
