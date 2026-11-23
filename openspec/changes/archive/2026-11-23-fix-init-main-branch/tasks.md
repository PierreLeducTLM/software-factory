# Tasks

- [ ] 1. Init without `--main-branch` from a feature branch installs against the remote default branch. Verified by a test of `initProject` with a current branch that differs from the default.
- [ ] 2. `--main-branch` overrides the default. Verified by a test.
- [ ] 3. When the remote's default branch cannot be read and `--main-branch` is not given, init returns `reason: "missing"` with `--main-branch` in `missing` and opens no pull request. Verified by a test of `initProject` whose default-branch lookup returns nothing.
- [ ] 4. `factory init detect --json` includes `mainBranch` with the remote's default branch, and omits it when the default cannot be read. Verified by tests of the detection result in both cases.
