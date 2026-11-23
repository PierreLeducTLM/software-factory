# Software factory

The software factory turns an approved ticket into a merged pull request. A person refines the ticket's spec until it can be built with no further questions and approves it. The factory then builds it in an Orca worktree, runs the project's own checks, has a fresh reviewer check the change against the spec, and opens the pull request. Every step is recorded on the ticket, so the tracker stays the source of truth.

It works with Jira Cloud or Linear for tickets, GitHub or Bitbucket for source control, and Claude Code in Orca worktrees as the builder.

## Install it in your project

> [!IMPORTANT]
> Open Claude Code in your project, and paste this:
>
> ```
> Install the software-factory from this repo: https://github.com/PierreLeducTLM/software-factory
> ```

Claude installs the plugin, asks you three things (your tracker, a ticket to test with, and where your API key is), and opens one install pull request. Nothing else is asked: it finds the checks, the CI, the repository and the statuses by itself.

**Before you paste it, have these ready:**

1. **Your tracker's API key is exported in the shell Claude Code runs in.** Never paste the key into the chat.
   - Linear: `export LINEAR_API_KEY=…`, a personal API key from Linear's settings, under API keys.
   - Jira: `export JIRA_TOKEN=…` and `export JIRA_EMAIL=…`, from [an Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens).
   - Use a dedicated service account, not your own. The factory's CI steps write to tickets as that account.
2. **Your source control token is available.** The install opens its pull request through the API of GitHub or Bitbucket.
   - GitHub: `export GH_TOKEN=$(gh auth token)`. Claude does this for you when `gh` is logged in.
   - Bitbucket: `export BITBUCKET_TOKEN=…` and `export BITBUCKET_USERNAME=…`, an app password.
3. **Your tracker has the seven statuses.** Names can differ, and the factory matches them by name and category. It asks only about the ones it cannot match.

   | Factory state | Typical name |
   |---|---|
   | to refine | To refine |
   | spec review | Spec review |
   | ready for dev | Ready for Dev |
   | in development | In development |
   | in review | In review |
   | blocked | Blocked |
   | done | Done |

   On **Jira**, a ticket must not be able to move from In development to In development, since that is what stops two people claiming one ticket. Remove any global transition into In development. The install checks it. On **Linear**, add the statuses to the team's workflow. Linear accepts any status change, so the factory checks each claim itself.
4. **The tools are installed:** Node.js 22 or later, git, Claude Code, Orca (its `orca` command) and OpenSpec (`npm install --global @fission-ai/openspec`). Claude checks and tells you what is missing.

**After the pull request is open,** you have two things to do:

1. **Store the secrets it lists in your CI secret store.** They are your tracker's credentials. On Bitbucket, store them as secured repository variables.
2. **Merge the install pull request.** Until it is merged, nothing changes in the project.

Then check it with `factory doctor --ticket PAY-142`, using a real ticket key. That command is available once the plugin is installed and Claude Code is restarted. Claude can run it for you right away.

### Instructions for Claude

If you are Claude and the user asked you to install the software factory from this repository, follow these steps. Do not ask the user anything beyond what step 3 says.

1. **Check the tools.** Run `node --version` (22 or later), `git --version`, `claude --version`, `orca --version` and `openspec --version`. If one is missing, tell the user what to install and stop. Check that the user is on an up-to-date checkout of the main branch with no local changes.
2. **Install the plugin.**

   ```bash
   claude plugin marketplace add PierreLeducTLM/software-factory
   claude plugin install software-factory@software-factory
   ```

   If the marketplace is already added, run `claude plugin marketplace update software-factory` instead.
3. **Set the project up.** Run `claude plugin list --json`, and read the `installPath` of `software-factory@software-factory`. Read `<installPath>/skills/factory-init/SKILL.md` and follow it. It tells you what to ask, and the `factory` command it uses is `<installPath>/bin/factory`, since the plugin is not on the PATH until Claude Code restarts.
4. **Finish** as that skill says: share the pull request and what it settled on, the secrets to store, and the steps to do by hand.

## What the install adds to your project

The install pull request adds a `.factory/` folder, and on GitHub a workflow. Nothing is installed globally.

| File | What it is |
|---|---|
| `.factory/factory.yaml` | The checks, the risk policy, the statuses and the engine pin |
| `.factory/adapters.yaml` | The tracker and the source control, by the **names** of the environment variables that hold their keys. Never a secret |
| `.factory/package.json` | Pins the factory engine to a release of this repository |
| `.factory/bin/factory` | Installs the pinned engine on first use, then runs it. Git ignores the install |
| `.factory/checks/` | Rubrics for agent checks |
| `.github/workflows/factory.yml` | The CI steps that record each merge and revert a bad one, on GitHub. On Bitbucket, the pull request lists the steps to add by hand |

Each project runs the engine it pins. To move a project to a newer engine, run `factory migrate`: it opens one pull request.

## The skills

The plugin gives Claude Code five skills.

| Skill | What it does |
|---|---|
| `/factory-init` | Sets the project up, with one pull request |
| `/factory-refine [KEY]` | Refines a ticket's draft spec, then gets it approved to Ready for Dev |
| `/factory-run [KEY]`, `/factory-next` | Builds an approved ticket into a pull request |
| `/factory-doctor` | Checks the setup for drift and fixes it through pull requests |
| `/factory-workflow` | Changes the checks, the risk policy or the staging watch through a pull request |

In a terminal, `.factory/bin/factory` from the project runs the same `factory` command. Run it with no arguments for the list of commands, and add `--json` to any command for one line of JSON.

## The ticket journey

```
To refine → Spec review → Ready for Dev → In development → In review → Done
                                               ↓
                                            Blocked
```

1. **Write the ticket** in your tracker and put it in To refine. Its description holds the spec in plain words, for people.
2. **Attach a draft spec.** Refinement starts from a draft OpenSpec change and never writes one from nothing. Draft the change in the project, for example with OpenSpec's `/opsx:propose`, then attach it:

   ```bash
   factory push PAY-142 --from openspec/changes/<change-name>
   ```

3. **Refine it** with `/factory-refine PAY-142`. The skill works through the open questions with you, tightens the spec, runs the ready gate and asks for your approval. The ticket moves to Ready for Dev.
4. **Build it** with `/factory-run PAY-142`, or `/factory-next` for the next ticket labelled `factory-auto`. The factory claims the ticket, builds it, runs the gates and the review, and opens the pull request. The ticket moves to In review. If the build cannot succeed, the ticket moves to Blocked, and its factory comment says why and what to do.
5. **Review and merge** the pull request. Every risk level starts in **shadow mode**: a person merges each factory pull request. You enable auto-merge per risk level later, once the factory has earned it.
6. **CI records the merge** and moves the ticket to Done.

Three labels are optional: `factory-available` marks a ticket in "to refine" as allowed to go through the factory, so the dashboard shows it in its Available column; `factory-auto` marks a ticket that `/factory-next` may pick up; and `factory:no-automerge` keeps a ticket's pull request away from auto-merge. A project can rename them under `labels` in `.factory/factory.yaml` (`available`, `auto` and `no_automerge`).

## Changing the setup later

- **Add, remove or tune a check, the risk policy or the staging watch:** `/factory-workflow`. It validates the change and opens a pull request.
- **Move to a newer engine:** `factory migrate`.
- **Something stopped working:** `/factory-doctor`, or `factory doctor --ticket PAY-142` in a terminal.

## The dashboard

`factory view` opens a read-only dashboard of the project's tickets at http://127.0.0.1:4790. `factory view --sample` shows it on sample data. It needs the dashboard built, which the project's copy of the engine does not include. Build it once from a checkout of this repository:

```bash
git clone https://github.com/PierreLeducTLM/software-factory.git
cd software-factory
pnpm install
pnpm build:view
npm link          # puts a `factory` command on your PATH that can open the dashboard
```

## Developing the factory

```bash
pnpm install
pnpm test            # unit and contract tests
pnpm typecheck
pnpm mutation        # Stryker mutation testing
pnpm test:view       # dashboard tests
```

The design, the specs and the task list are in `openspec/changes/define-software-factory-v1/`. A release is a tag `vX.Y.Z` on `main`. The plugin, the package and `src/version.ts` carry the same version, and a project pins it in `.factory/package.json`.

## License

[MIT](LICENSE).
