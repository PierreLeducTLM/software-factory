# Software factory

The software factory turns an approved ticket into a merged pull request. A person refines the ticket's spec until it can be built with no further questions and approves it. The factory then builds it in an Orca worktree, runs the project's own checks, has a fresh reviewer check the change against the spec, and opens the pull request. Every step is recorded on the ticket, so the tracker stays the source of truth.

It works with:

- **Ticket trackers:** Jira Cloud and Linear.
- **Source control:** GitHub and Bitbucket.
- **Agent runtime:** Claude Code, in Orca worktrees.

You drive it from Claude Code with five skills. A command line, `factory`, does the bookkeeping underneath.

| Skill | What it does |
|---|---|
| `/factory-init` | Sets a project up: one install pull request, plus one pull request per check you add |
| `/factory-refine <KEY>` | Refines a ticket's spec, then gets it approved to Ready for Dev |
| `/factory-run <KEY>`, `/factory-next` | Builds an approved ticket into a pull request |
| `/factory-doctor` | Checks the project's setup for drift and fixes it through pull requests |
| `/factory-workflow` | Changes the project's factory workflow (checks, risk policy, staging watch) through a pull request |

## The ticket journey

```
To refine → Spec review → Ready for Dev → In development → In review → Done
                                               ↓
                                            Blocked
```

A developer claims an approved ticket with `/factory-run`. The ticket moves to In development and the factory builds it. When every gate passes, the factory opens a pull request and the ticket moves to In review. Once the pull request is merged, a CI step moves the ticket to Done.

Every risk level starts in **shadow mode**: a person merges each factory pull request. Auto-merge is enabled per risk level later, once the factory has earned it.

---

## Setting up a project

Do steps 1 to 3 once per machine or per tracker, then steps 4 to 7 once per project.

### 1. Install the tools on your machine

You need:

| Tool | Why | How to get it |
|---|---|---|
| Node.js 22 or later | runs `factory` | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | builds the factory from this repository | `npm install --global pnpm` |
| git | worktrees and branches | |
| Claude Code | runs the skills | [claude.com/claude-code](https://claude.com/claude-code) |
| Orca | builds each ticket in its own worktree, through the `orca` command | the Orca app, which puts `orca` on your `PATH` |
| OpenSpec | validates the spec files | `npm install --global @fission-ai/openspec` |

Then install `factory` from a checkout of this repository:

```bash
git clone <this repository's URL> software-factory
cd software-factory
pnpm install         # also builds the factory command
pnpm build:view      # builds the dashboard
npm link             # puts `factory` on your PATH, pointing at this checkout
```

Check it:

```bash
factory              # prints the list of commands
factory view --sample
```

`factory view --sample` opens the dashboard on sample data at http://127.0.0.1:4790. Press Ctrl+C to stop it.

To update the factory later, run `git pull && pnpm install && pnpm build:view` in the checkout.

### 2. Add the plugin to Claude Code

In Claude Code:

```
/plugin marketplace add /path/to/software-factory
/plugin install software-factory@software-factory
```

The five `/factory-…` skills are now available in every project. If they do not show up, restart Claude Code.

### 3. Prepare the tracker

**Statuses.** The factory needs seven statuses. Your names can differ: the install wizard matches them by name and category, and asks only about the ones it cannot match.

| Factory state | Typical name | Category |
|---|---|---|
| to refine | To refine | to do (Linear: Backlog) |
| spec review | Spec review | to do |
| ready for dev | Ready for Dev | to do |
| in development | In development | in progress (Linear: Started) |
| in review | In review | in progress |
| blocked | Blocked | in progress |
| done | Done | done (Linear: Completed) |

On **Jira**, the claim of a ticket relies on the workflow. A ticket must not be able to move from In development to In development, so remove any global transition into In development. The wizard and `factory doctor --ticket` check this.

On **Linear**, add the statuses to the team's workflow. Ticket keys start with the team key, such as `PAY-142`. Linear accepts any status change, so the factory checks each claim itself.

**Labels.** Two labels are optional:

- `factory-auto` marks a ticket that `/factory-next` may pick up.
- `factory:no-automerge` keeps a ticket's pull request away from auto-merge.

**A service account.** The CI steps write to the tickets as a dedicated account, never as a person. Create it now:

- **Jira:** an account that can comment on and transition the project's issues, with an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
- **Linear:** a member of the team, with a personal API key created in Linear's settings, under API keys.

### 4. Export the credentials

The project's `.factory/adapters.yaml` holds only the **names** of environment variables, never a secret. Export the values in the shell you start Claude Code from. The names below are examples: you choose them, and give them to the wizard.

For Jira:

```bash
export JIRA_TOKEN=…        # API token
export JIRA_EMAIL=…        # the account's email
```

For Linear:

```bash
export LINEAR_API_KEY=…    # personal API key
```

And for source control:

```bash
export GH_TOKEN=…          # GitHub: a token that can open pull requests
# or, for Bitbucket:
export BB_TOKEN=…          # Bitbucket app password or access token
export BB_USER=…           # Bitbucket username, when the token needs one
```

Use the service account's credentials while you set the project up: the wizard checks what that account may do. Once the project is set up, each developer exports their own credentials. `/factory-run` writes to the ticket as whoever runs it.

### 5. Run the install wizard

Open the project in Claude Code, on an up-to-date checkout of the main branch with no local changes, and run:

```
/factory-init
```

The wizard:

1. **Detects** the stack, the CI system, the checks the project already has (tests, lint, types, format, build, security, end-to-end), OpenSpec and the git remote. It runs each local check once, twice when it fails, to measure it and set its timeout.
2. **Asks** you, per category, to keep the existing check, add the recommended one, or skip it. It also asks for the paths that always need a person (such as `src/auth/**`) and whether a staging deploy should be watched.
3. **Asks for the tracker connection.** On Jira: the site URL and a JQL filter that selects this repository's tickets, such as `project = PAY`. On Linear: the team key, and optionally a project name when the team serves several repositories.
4. **Matches the statuses** with the tracker's own.
5. **Checks the service account** on one real ticket. It stops, opening nothing, if the account cannot comment or change a status, or if a Jira workflow lets a claimed ticket be claimed again.
6. **Opens the install pull request.** It holds `.factory/factory.yaml`, `.factory/adapters.yaml`, `.factory/checks/` and, on GitHub, the workflow `.github/workflows/factory.yml`.
7. **Opens one pull request per check you chose to add.**

For a Linear project, the resulting `.factory/adapters.yaml` looks like this:

```yaml
repository: acme/billing-service
ticket_providers:
  - kind: linear
    team: PAY
    project: Billing service   # only when you gave one
    token_env: LINEAR_API_KEY
source_control:
  kind: github
  repo: acme/billing-service
  token_env: GH_TOKEN
agent_runtime:
  kind: orca
```

For Jira, the ticket provider entry is:

```yaml
  - kind: jira
    base_url: https://acme.atlassian.net
    filter: project = PAY
    token_env: JIRA_TOKEN
    email_env: JIRA_EMAIL
```

### 6. Let CI run the factory steps, then merge

The install pull request adds CI steps that run as the service account:

- `factory record-merge` on every merge to main: records the merge and moves the ticket to Done;
- `factory revert` when the main build fails after an auto-merge;
- `factory watch` after a deploy to staging, when you asked for a watch.

On GitHub Actions they are in the workflow file. On Bitbucket Pipelines, the pull request description lists the steps to add by hand.

**Store the secrets** that the pull request description lists, in the CI secret store, before you merge. On GitHub they are named `FACTORY_<variable>`, such as `FACTORY_LINEAR_API_KEY`. The source control token comes from GitHub itself.

**Make `factory` installable in CI.** Each CI step first runs the install command you gave the wizard. The wizard suggests `npm install --global software-factory@<version>`. That works only once the package is published to an npm registry, and it is not published yet. Until it is, install it from this repository's git URL into a folder, and put that folder on the `PATH`.

On GitHub Actions, give the wizard this install command:

```bash
npm install --prefix "$HOME/.factory" git+https://github.com/<owner>/software-factory.git#v0.1.0 && echo "$HOME/.factory/node_modules/.bin" >> "$GITHUB_PATH"
```

On Bitbucket Pipelines, use this one:

```bash
npm install --prefix "$HOME/.factory" git+https://bitbucket.org/<workspace>/software-factory.git#v0.1.0 && export PATH="$HOME/.factory/node_modules/.bin:$PATH"
```

Replace `v0.1.0` with the tag or commit of the engine the project pins. If this repository is private, CI also needs read access to it, for example a token in the URL. Do not drop `--prefix` to install globally: npm builds a package installed globally from git without its build tools, and the install fails.

Then **merge the install pull request**. Until it is merged, nothing changes in the project.

### 7. Check the setup

```bash
factory doctor --ticket PAY-142
```

The `--ticket` option names any real ticket the factory can see. The command reports drift, such as a renamed CI job, a secret the CI workflow no longer passes, a check that fails on main, an engine pin that does not match, or a service account that lost a permission. `/factory-doctor` does the same and offers fixes through pull requests. Add `--run-checks` to run every check once more.

---

## Building your first ticket

1. **Write the ticket** in the tracker and put it in To refine. The description holds the spec in plain words, for people.
2. **Attach a draft spec.** Refinement starts from a draft OpenSpec change; it never writes one from nothing. Draft the change in the project, for example with OpenSpec's `/opsx:propose`, then attach its files to the ticket:

   ```bash
   factory push PAY-142 --from openspec/changes/<change-name>
   ```

3. **Refine it** in Claude Code with `/factory-refine PAY-142`. The skill works through the open questions with you, tightens the spec files, runs the ready gate and asks for your approval. The ticket moves to Ready for Dev.
4. **Build it** with `/factory-run PAY-142`, or `/factory-next` to take the next ticket labelled `factory-auto`. The factory claims the ticket, builds it, runs the gates and the review, and opens the pull request. The ticket moves to In review. If the build cannot succeed, the ticket moves to Blocked and its factory comment says why and what to do.
5. **Review and merge** the pull request. In shadow mode, a person always merges.
6. **CI records the merge** and moves the ticket to Done.

Follow every ticket on the dashboard:

```bash
factory view          # from the project folder; http://127.0.0.1:4790
```

The dashboard is read-only. It reads the tickets through the same credentials as the command line, refreshes on its own, and can open a run that is on your machine in Orca.

## Changing the setup later

- **Add, remove or tune a check, the risk policy or the staging watch:** `/factory-workflow`. It validates the change and opens a pull request.
- **Move a project to a newer factory engine:** `factory migrate` opens one upgrade pull request. A project pins its engine in `factory.yaml`, and a factory command refuses to run on a project pinned to another release.
- **Something stopped working:** `/factory-doctor`.

Run `factory` with no arguments for every command. Add `--json` to any command for one line of JSON.

## Developing the factory

```bash
pnpm install
pnpm test            # unit and contract tests
pnpm typecheck
pnpm mutation        # Stryker mutation testing
pnpm test:view       # dashboard tests
```

The design, the specs and the task list are in `openspec/changes/define-software-factory-v1/`.
