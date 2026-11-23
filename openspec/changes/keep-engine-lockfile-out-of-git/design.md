# Design

## Context

`engineFiles` (`src/setup/engine-files.ts`) writes `.factory/package.json`, the launcher `.factory/bin/factory` and `.factory/.gitignore` (`node_modules/`). The launcher runs `npm install --prefix "$dir"`, which creates `.factory/package-lock.json`. `factory migrate` replaces any engine file whose content differs from `engineFiles`, so a change to the launcher or the gitignore reaches existing installs as an "install the factory engine in the project" pull request.

## Approach

`.factory/.gitignore` ignores the lockfile as well as `node_modules/` (D-001). The launcher is unchanged: npm still writes `.factory/package-lock.json`, and git ignores it.

## Open Questions

None.

## Decisions

### D-001: Ignore the lockfile rather than stop writing it or commit it

- **Question:** Should the lockfile be ignored (add `package-lock.json` to `.factory/.gitignore`), not written at all (`--no-package-lock` in the launcher), or committed so every install resolves the same dependency tree?
- **Decision:** Ignore it. `.factory/.gitignore` becomes `node_modules/` and `package-lock.json`, one per line. The launcher does not change.
- **Effect:** Lockfiles already left on developers' machines, and ones written by a manual `npm install` in `.factory`, also disappear from `git status`. Only `.factory/.gitignore` changes in the engine files, and `factory migrate` brings that change to existing installs. Committing the lockfile was rejected because `factory init` and `factory migrate` cannot produce it without running npm, and different npm versions would keep rewriting it.

### D-002: `factory doctor` does not change

- **Question:** Does `factory doctor` report an outdated `.factory/.gitignore` or launcher as an `engine` finding, so existing installs learn to run `factory migrate`?
- **Decision:** No. `factory doctor` keeps its current engine checks: a missing install, a `.factory/package.json` that installs another engine than the pin, and a pin that differs from the running engine.
- **Effect:** An existing install gets the new `.factory/.gitignore` by moving to the engine release that contains this change. The existing pin check already points those projects to `factory migrate`. A project whose pin was bumped by hand, without the other engine files, gets no finding. Reporting any outdated engine file is out of scope for this ticket. No `doctor` requirement, task or affected path is added.

### D-003: A lockfile that was already committed stays a manual fix

- **Question:** A gitignore entry does not untrack a file already in git. Should `factory migrate` remove a committed `.factory/package-lock.json`, or is that out of scope?
- **Decision:** Out of scope. The change covers the untracked lockfile that the launcher leaves behind. A project that has already committed `.factory/package-lock.json` removes it once with `git rm --cached .factory/package-lock.json`.
- **Effect:** `factory migrate` only updates `.factory/.gitignore` and deletes no file. The proposal gives the manual fix. No requirement or task covers a tracked lockfile.
