---
name: factory-init
description: Set the software factory up in this project with one pull request. Use when the user asks to install or set up the factory, or says /factory-init.
---

# Factory init

Set the factory up in this project with one command. It opens one install pull request and never commits to the main branch. The command finds the checks, the CI, the repository and the statuses by itself, so you ask the person almost nothing.

**Before you start:** be on an up-to-date checkout of the main branch with no local changes.

**The `factory` command** comes with this plugin. If you just installed the plugin in this session, it is not on the PATH yet: run it by its path instead, `<installPath>/bin/factory`, where `installPath` is the one `claude plugin list --json` gives for `software-factory`. Everywhere below, `factory` means that command.

Add `--json` to every `factory` command and read its result.

## 1. Ask for what only the person knows

Ask these together, in one message, and nothing more:

- **The tracker.** Linear: the team key that prefixes the ticket keys, such as `PAY`, and a project name only if the team serves several repositories. Jira: the site URL, such as `https://acme.atlassian.net`, and a JQL filter that selects this repository's tickets, such as `project = PAY`.
- **One real ticket key** from that tracker, to check the account on.
- **The API key,** which the person must export before you go on. Linear: `LINEAR_API_KEY`. Jira: `JIRA_TOKEN` and `JIRA_EMAIL`. It must be in the environment Claude Code runs in. Never ask for the key itself, and never write it into a file.

The person can name other variables: pass them with `--token-env` and `--email-env`.

## 2. Run it

Linear:

```bash
factory init --ticket PAY-142 --team PAY --json
```

Jira:

```bash
factory init --ticket PAY-142 --base-url https://acme.atlassian.net --filter "project = PAY" --json
```

Everything else is settled from the project, and the result's `summary` says what.

| Result | What to do |
|---|---|
| `ok: true` | Go to step 3 |
| `reason: "missing"` | The `missing` list names what could not be found. Ask for it, then run the command again with the matching option |
| `reason: "statuses"` | `unmatched` lists the factory states with no matching status, and `available` the tracker's statuses. Ask the person to pick one per state, then run again with `--statuses "state=Status;state=Status"` |
| `reason: "service_account"` | Show the `message`: it names the missing permission. No pull request was opened. Run again once it is granted |
| `reason: "claim_lock"` | The Jira workflow lets a claimed ticket be claimed again. Ask the Jira admin to remove that transition, then run again. No pull request was opened. Linear never gives this answer |
| an error | Show it. `Set the X environment variable` means the key is not exported |

Options, only when the person asks for them:

| Option | Effect |
|---|---|
| `--verify` | Runs each check on this checkout, makes the failing and flaky ones advisory, and sets each timeout from the measure. Slow: it runs the project's tests |
| `--sensitive-paths a,b` | Paths whose changes always need a person, such as `src/auth/**` |
| `--main-branch`, `--repository`, `--source-control github\|bitbucket` | When they cannot be read from git |
| `--token-env`, `--email-env`, `--source-token-env` | Other names for the variables |

To look at what the command would find before it changes anything, run `factory init detect`.

## 3. Report

Share the pull request `url`, then the `summary` lines, so the person can say if something is wrong: the tracker, the repository, the checks and which are advisory, the statuses.

Then give the two things to do before merging:

1. **Store the `secrets` in the CI secret store** (when the list is not empty). `FACTORY_REPO_TOKEN` is a read-only token for the factory's repository, so that CI can install the factory. The others are the tracker's credentials, for a dedicated service account.
2. **Do the `manual` steps,** if any.

The pull request holds `.factory/factory.yaml`, `.factory/adapters.yaml`, `.factory/package.json` (which pins the engine), `.factory/bin/factory` (which installs and runs it) and, on GitHub, the factory workflow. Every risk level starts in shadow mode, so a person merges each factory pull request.

Finish by saying what comes next: merge the install pull request, then `factory doctor --ticket PAY-142` to check the setup, then `/factory-refine` on a first ticket. To add a check or change the risk policy, use `/factory-workflow`.
