---
name: factory-doctor
description: Check a project's factory setup for drift and fix what it finds through reviewed pull requests. Use when the user says "/factory-doctor", "factory doctor", asks whether the factory setup is healthy, renamed a CI job, sees a factory CI step skipped, upgraded the factory engine, or gets "This project pins factory engine" from a factory command.
---

# Factory doctor

Find where the project's factory setup no longer matches the project, explain each finding, and offer the fix. You never edit `.factory/` directly: every change reaches main through a pull request someone reviews.

## 1. Run the doctor

```bash
factory doctor --json
```

Add `--run-checks` when the person wants to know whether the local checks still pass on the current code. It runs each one, twice when it fails, so it can take as long as the test suite.

Add `--ticket <KEY>` to check what the ticket-provider account may do on that ticket. The command uses the token in the current environment, so to check the CI service account, run it with the service account's variables set, as the CI does.

The exit code is 0 when nothing drifted, 1 when it found drift, and 2 when the arguments are wrong. The JSON is `{ "ok": boolean, "findings": [{ "kind", "message" }] }`.

## 2. Explain each finding and offer its fix

Group the findings by kind. Quote each message as it is: it names the file, field, check or job.

| Kind | What it means | The fix to offer |
|---|---|---|
| `config` | `factory.yaml` or `adapters.yaml` is missing or invalid | Missing: run `/factory-init`. Invalid: fix the named field with `/factory-workflow` |
| `secret` | A token is written in `adapters.yaml` | Treat the token as leaked: ask the person to revoke it now. Then replace the value with a `*_env` variable name through `/factory-workflow`, and store the new token in the CI secret store |
| `schema` | The configuration uses an older schema than this engine | Run `factory migrate` (see step 3) |
| `engine` | The project pins another engine release | Pinned release older: run `factory migrate`. Pinned release newer: install that engine version; never move a project back |
| `ci_job` | A `source: ci` check reads a CI job that no CI file defines | Ask whether the job was renamed or removed. Renamed: point the check's `job` at the new name with `/factory-workflow`. Removed: remove the check or make it local, also with `/factory-workflow` |
| `unused_script` | The project has a script that no gate runs | Offer to add it as a check with `/factory-workflow`. It is fine to leave it out: say so and move on |
| `ci_step` | The pipeline does not run a factory CI step | Show where the step goes and open a pull request that adds it. Without `record-merge`, merges are never recorded |
| `ci_secret` | No CI file passes a provider variable to the factory steps | Ask the person to store the token as the named CI secret, then pass it to the factory steps in a pull request |
| `failing_check` | A local check fails on the current code | Main is red, or the check is wrong. Fix main, or make the check advisory with `/factory-workflow` |
| `flaky_check` | A local check failed, then passed | Fix the flaky test, or make the check advisory with `/factory-workflow` until it is fixed |
| `service_account` | The account cannot comment on or change the status of a ticket, or could not be checked | Ask the provider's admin for the missing permission, or renew the token if it expired |

Ask the person which fixes to make, then make them one pull request at a time.

## 3. Upgrade the engine

```bash
factory migrate --json
```

It opens one pull request that pins this engine in `factory.yaml` and runs any schema migration, and it never touches the current checkout. Until that pull request is merged, the project keeps running its pinned engine, so nothing changes for anyone else.

| Result | What to do |
|---|---|
| `action: "opened"` | Share the `url`, and list the `applied` migrations if there are any. Ask the person to review and merge it |
| `action: "none"` | Say that the project is already on this engine |
| `reason: "newer_engine"` | The project is ahead of this engine. Tell the person to install the pinned engine instead |
| any other refusal | Show the `message` |

## 4. Finish

End with one line per finding: fixed (with the pull request), left as it is (with the reason), or waiting on someone (with who).
