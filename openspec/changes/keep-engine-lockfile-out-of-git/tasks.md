# Tasks

- [ ] 1. A fresh install writes a `.factory/.gitignore` that lists `node_modules/` and `package-lock.json`. Verified by a `buildInstall` test of the engine files and by the engine-files test in `tests/engine-launcher.test.ts`.
- [ ] 2. After the launcher's first run in a git repository, `git status --porcelain` shows nothing under `.factory/`, even when the stub npm writes `.factory/package-lock.json`. Verified by a launcher test in `tests/engine-launcher.test.ts`.
- [ ] 3. `factory migrate` on an install whose `.factory/.gitignore` lists only `node_modules/` opens a pull request that updates `.factory/.gitignore`. Verified by an `upgradeProject` test.
