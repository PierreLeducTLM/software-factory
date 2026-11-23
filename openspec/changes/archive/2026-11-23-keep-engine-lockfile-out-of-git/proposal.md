# Keep the engine lockfile out of git

## Why

The project launcher `.factory/bin/factory` installs the pinned engine with `npm install --prefix .factory`. npm writes `.factory/package-lock.json`, and `.factory/.gitignore` ignores only `node_modules/`. Every developer and every CI run that runs the factory leaves an untracked `.factory/package-lock.json`, which ends up committed by accident or clutters `git status`. Found on this repository after installing the factory.

## What changes

- `.factory/.gitignore` ignores `package-lock.json` as well as `node_modules/`, so installing the engine no longer leaves an untracked `.factory/package-lock.json` in the project. Lockfiles already left behind disappear from `git status` too.
- A project that has already committed `.factory/package-lock.json` keeps tracking it, because a gitignore entry does not untrack a file. It removes it once with `git rm --cached .factory/package-lock.json`. `factory migrate` does not do this.
- Existing installs get the fix through `factory migrate`, which already updates outdated engine files.

## Affected paths

- src/setup/engine-files.ts
- tests/**
