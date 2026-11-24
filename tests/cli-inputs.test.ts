import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCommandRunner, type CommandRunner } from '../src/adapters/orca-agent-runtime.js';
import { createChangeArchive, createFilePublisher, createGitInputs, createRepositoryReader, createScriptRunner, createSpecFolder, createSpecValidator } from '../src/cli/inputs.js';

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', ['-c', 'user.name=Test Dev', '-c', 'user.email=test@example.test', ...args], { cwd, encoding: 'utf8' }).trim();

const commit = (cwd: string, file: string, content: string): string => {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', `change ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
};

const getClone = () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-git-'));
  const origin = join(root, 'origin');
  const clone = join(root, 'clone');
  execFileSync('git', ['init', '-q', '-b', 'main', origin]);
  const first = commit(origin, 'a.txt', 'one');
  execFileSync('git', ['clone', '-q', origin, clone]);
  git(clone, 'config', 'user.name', 'Pierre Dev');
  return { origin, clone, first };
};

const publisherFor = (cwd: string) => {
  const run = createCommandRunner('git');
  return createFilePublisher({ run: (args) => run(args, { cwd }) });
};

const inputsFor = (cwd: string, mainBranch = 'main') => {
  const run = createCommandRunner('git');
  return createGitInputs({ run: (args) => run(args, { cwd }), mainBranch });
};

describe('git inputs', () => {
  it('reads the developer name from git', async () => {
    const { clone } = getClone();

    expect(await inputsFor(clone).userName()).toBe('Pierre Dev');
  });

  it('reads the newest commit on the main branch of origin, fetching it first', async () => {
    const { origin, clone, first } = getClone();
    const before = await inputsFor(clone).mainCommit();
    const second = commit(origin, 'b.txt', 'two');

    expect(before).toBe(first);
    expect(await inputsFor(clone).mainCommit()).toBe(second);
  });

  it('lists the files changed on main since a commit, and nothing when none changed', async () => {
    const { origin, clone, first } = getClone();
    const inputs = inputsFor(clone);
    const none = await inputs.changedFilesSince(first);
    commit(origin, 'src-billing.ts', 'x');
    commit(origin, 'b.txt', 'two');

    expect(none).toEqual([]);
    expect((await inputs.changedFilesSince(first)).toSorted()).toEqual(['b.txt', 'src-billing.ts']);
  });

  it('lists the files changed on the current branch since it left main, ignoring what main gained since', async () => {
    const { origin, clone } = getClone();
    git(clone, 'checkout', '-q', '-b', 'factory/pay-142');
    const none = await inputsFor(clone).changedFilesOnBranch();
    commit(clone, 'export.ts', 'x');
    commit(origin, 'main-only.txt', 'y');

    expect(none).toEqual([]);
    expect(await inputsFor(clone).changedFilesOnBranch()).toEqual(['export.ts']);
  });

  it('counts the lines added and removed on the current branch, leaving binary files out', async () => {
    const { origin, clone } = getClone();
    git(clone, 'checkout', '-q', '-b', 'factory/pay-142');
    const none = await inputsFor(clone).linesChangedOnBranch();
    commit(clone, 'export.ts', 'one\ntwo\nthree\n');
    commit(clone, 'export.ts', 'one\n2\nthree\nfour\n');
    commit(clone, 'logo.bin', '\u0000\u0001\u0000');
    commit(origin, 'main-only.txt', 'y\ny\n');

    expect(none).toBe(0);
    expect(await inputsFor(clone).linesChangedOnBranch()).toBe(4);
  });

  it('reads the full message of a commit', async () => {
    const { clone } = getClone();
    git(clone, 'commit', '-q', '--allow-empty', '-m', 'Revert "Bulk export"', '-m', 'This reverts commit abc1234.');

    expect(await inputsFor(clone).commitMessage('HEAD')).toBe('Revert "Bulk export"\n\nThis reverts commit abc1234.');
  });

  it('reads a file as it is committed on the current branch, and nothing for a file that is not committed', async () => {
    const { clone } = getClone();
    mkdirSync(join(clone, 'openspec'));
    commit(clone, 'openspec/tasks.md', '- [x] 1.1 Done\n');
    writeFileSync(join(clone, 'openspec/tasks.md'), '- [ ] 1.1 Not committed\n');

    expect(await inputsFor(clone).readFileOnBranch('openspec/tasks.md')).toBe('- [x] 1.1 Done\n');
    expect(await inputsFor(clone).readFileOnBranch('openspec/missing.md')).toBeUndefined();
  });

  it('gives an empty user name when git has none', async () => {
    const { clone } = getClone();
    git(clone, 'config', 'user.name', '');

    expect(await inputsFor(clone).userName()).toBe('');
  });

  it('pushes the branch to origin', async () => {
    const { origin, clone } = getClone();
    git(clone, 'checkout', '-q', '-b', 'factory/pay-142');
    const pushed = commit(clone, 'export.ts', 'x');

    await inputsFor(clone).pushBranch('factory/pay-142');

    expect(git(origin, 'rev-parse', 'factory/pay-142')).toBe(pushed);
  });

  it('publishes one file on a new branch from the latest main, and leaves the checkout as it was', async () => {
    const { origin, clone } = getClone();
    git(clone, 'config', 'user.email', 'pierre@example.test');
    const latest = commit(origin, 'b.txt', 'two');
    writeFileSync(join(clone, 'a.txt'), 'unsaved work');
    const change = { branch: 'factory/upgrade-engine-0.2.0', base: 'main', files: { '.factory/factory.yaml': 'schema: 1\nengine: 0.2.0\n', '.factory/checks/README.md': '# Rubrics\n' }, message: 'chore: upgrade the factory engine to 0.2.0' };

    await publisherFor(clone)(change);

    expect(git(origin, 'show', `${change.branch}:.factory/factory.yaml`)).toBe('schema: 1\nengine: 0.2.0');
    expect(git(origin, 'show', `${change.branch}:.factory/checks/README.md`)).toBe('# Rubrics');
    expect(git(origin, 'log', '-1', '--format=%s %an', change.branch)).toBe('chore: upgrade the factory engine to 0.2.0 Pierre Dev');
    expect(git(origin, 'rev-parse', `${change.branch}~1`)).toBe(latest);
    expect(readFileSync(join(clone, 'a.txt'), 'utf8')).toBe('unsaved work');
    expect(git(clone, 'branch', '--show-current')).toBe('main');
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('records the files it is told are executable as executable, and the others as plain files', async () => {
    const { origin, clone } = getClone();
    git(clone, 'config', 'user.email', 'pierre@example.test');

    await publisherFor(clone)({ branch: 'factory/install', base: 'main', files: { '.factory/bin/factory': '#!/bin/sh\n', '.factory/package.json': '{}' }, executable: ['.factory/bin/factory'], message: 'install' });

    const modes = git(origin, 'ls-tree', 'factory/install', '.factory/bin/factory', '.factory/package.json').split('\n').map((line) => line.split(' ')[0]);
    expect(modes).toEqual(['100755', '100644']);
  });

  it('publishes its files even when the project ignores their folder, as the .NET rule [Bb]in/ ignores .factory/bin', async () => {
    const { origin, clone } = getClone();
    git(clone, 'config', 'user.email', 'pierre@example.test');
    commit(origin, '.gitignore', '[Bb]in/\n');

    await publisherFor(clone)({ branch: 'factory/install', base: 'main', files: { '.factory/bin/factory': '#!/bin/sh\n' }, executable: ['.factory/bin/factory'], message: 'install' });

    expect(git(origin, 'show', 'factory/install:.factory/bin/factory')).toBe('#!/bin/sh');
  });

  it('removes its temporary worktree when the push fails', async () => {
    const { clone } = getClone();
    git(clone, 'config', 'user.email', 'pierre@example.test');
    git(clone, 'remote', 'set-url', '--push', 'origin', join(clone, 'nowhere'));

    await expect(publisherFor(clone)({ branch: 'factory/x', base: 'main', files: { '.factory/checks/x.md': 'x' }, message: 'x' })).rejects.toThrow(/nowhere/);

    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('reads the remote and a file as it is on the latest main, without checking it out', async () => {
    const { origin, clone } = getClone();
    commit(origin, 'b.txt', 'line one\nline two\n');
    const run = createCommandRunner('git');
    const reader = createRepositoryReader({ run: (args) => run(args, { cwd: clone }) });

    expect(await reader.remoteUrl()).toBe(origin);
    expect(await reader.mainFile('b.txt', 'main')).toBe('line one\nline two\n');
    expect(await reader.mainFile('missing.txt', 'main')).toBeUndefined();
    expect(await reader.mainFile('b.txt', 'no-such-branch')).toBeUndefined();
    expect(existsSync(join(clone, 'b.txt'))).toBe(false);
  });

  it('has no remote in a repository that was never pushed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-local-'));
    execFileSync('git', ['init', '-q', root]);
    const run = createCommandRunner('git');

    expect(await createRepositoryReader({ run: (args) => run(args, { cwd: root }) }).remoteUrl()).toBeUndefined();
  });

  it('reads the remote default branch the clone recorded, not the branch checked out, without reaching the remote', async () => {
    const { origin, clone } = getClone();
    git(origin, 'checkout', '-q', '-b', 'trunk');
    git(origin, 'branch', '-q', '-D', 'main');
    git(clone, 'fetch', '-q', 'origin');
    git(clone, 'remote', 'set-head', 'origin', '--auto');
    git(clone, 'checkout', '-q', '-b', 'feature/x');
    git(clone, 'remote', 'set-url', 'origin', join(origin, 'unreachable'));
    const run = createCommandRunner('git');

    expect(await createRepositoryReader({ run: (args) => run(args, { cwd: clone }) }).defaultBranch()).toBe('trunk');
  });

  it('asks the remote for its default branch when the clone does not record it', async () => {
    const { clone } = getClone();
    git(clone, 'remote', 'set-head', 'origin', '--delete');
    git(clone, 'checkout', '-q', '-b', 'feature/x');
    const run = createCommandRunner('git');

    expect(await createRepositoryReader({ run: (args) => run(args, { cwd: clone }) }).defaultBranch()).toBe('main');
  });

  it('has no default branch when the remote is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-empty-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(root, 'origin')]);
    execFileSync('git', ['clone', '-q', join(root, 'origin'), join(root, 'clone')], { stdio: 'ignore' });
    const run = createCommandRunner('git');

    expect(await createRepositoryReader({ run: (args) => run(args, { cwd: join(root, 'clone') }) }).defaultBranch()).toBeUndefined();
  });

  it('has no default branch in a repository that was never pushed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-local-'));
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    const run = createCommandRunner('git');

    expect(await createRepositoryReader({ run: (args) => run(args, { cwd: root }) }).defaultBranch()).toBeUndefined();
  });

  it('follows the main branch the project names', async () => {
    const { origin, clone } = getClone();
    git(origin, 'checkout', '-q', '-b', 'develop');
    const onDevelop = commit(origin, 'c.txt', 'three');

    expect(await inputsFor(clone, 'develop').mainCommit()).toBe(onDevelop);
  });
});

const VALID = JSON.stringify({ items: [{ id: 'candidate', valid: true, issues: [] }] });
const INVALID = JSON.stringify({
  items: [
    {
      id: 'candidate',
      valid: false,
      issues: [
        { level: 'ERROR', path: 'billing/spec.md', message: 'ADDED "Bulk export" must include at least one scenario' },
        { level: 'WARNING', path: 'proposal.md', message: 'Why section is brief' },
      ],
    },
  ],
});

const FILES = [
  { name: 'proposal.md', content: '# Proposal' },
  { name: 'specs__identity__user-auth__spec.md', content: '# Spec Delta' },
];

describe('script runner', () => {
  const run = createScriptRunner({ cwd: tmpdir() });

  it('reports exit code 0 and everything the command printed', async () => {
    expect(await run('echo out; echo err 1>&2', { timeoutSeconds: 10 })).toEqual({ exitCode: 0, output: 'out\nerr\n', timedOut: false });
  });

  it('reports the exit code of a command that fails, with its output', async () => {
    expect(await run('echo failing; exit 3', { timeoutSeconds: 10 })).toEqual({ exitCode: 3, output: 'failing\n', timedOut: false });
  });

  it('stops a command that runs past its timeout and says it timed out', async () => {
    const result = await run('echo started; sleep 5', { timeoutSeconds: 0.2 });

    expect(result).toEqual({ exitCode: 1, output: 'started\n', timedOut: true });
  });

  it('runs in the folder it was given', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'factory-script-'));
    writeFileSync(join(folder, 'marker.txt'), 'here');

    expect((await createScriptRunner({ cwd: folder })('cat marker.txt', { timeoutSeconds: 10 })).output).toBe('here');
  });
});

describe('spec folder', () => {
  it('writes attached files into folders and reads them back under their attachment names', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'factory-folder-'));
    const specFolder = createSpecFolder();
    writeFileSync(join(folder, 'notes.txt'), 'not a spec file');

    await specFolder.write(folder, FILES);

    expect(readFileSync(join(folder, 'specs/identity/user-auth/spec.md'), 'utf8')).toBe('# Spec Delta');
    expect(await specFolder.read(folder)).toEqual([
      { name: 'proposal.md', content: '# Proposal' },
      { name: 'specs__identity__user-auth__spec.md', content: '# Spec Delta' },
    ]);
  });

  it('refuses to write a file name that would land outside the folder, writing nothing', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'factory-folder-'));

    await expect(createSpecFolder().write(folder, [...FILES, { name: '..__evil.md', content: 'x' }])).rejects.toThrow('..__evil.md is not a valid spec file name');
    expect(readdirSync(folder)).toEqual([]);
  });

  it('fails when asked to read a folder that does not exist', async () => {
    await expect(createSpecFolder().read(join(tmpdir(), 'factory-folder-missing'))).rejects.toThrow();
  });
});

describe('spec validator', () => {
  it('lays the attached files out as an OpenSpec change, validates it strictly, and cleans up', async () => {
    const seen: { args?: readonly string[]; cwd?: string; proposal?: string; delta?: string; specsFolder?: boolean } = {};
    const run: CommandRunner = async (args, options) => {
      const cwd = options?.cwd ?? '';
      seen.args = args;
      seen.cwd = cwd;
      seen.proposal = readFileSync(join(cwd, 'openspec/changes/candidate/proposal.md'), 'utf8');
      seen.delta = readFileSync(join(cwd, 'openspec/changes/candidate/specs/identity/user-auth/spec.md'), 'utf8');
      seen.specsFolder = existsSync(join(cwd, 'openspec/specs'));
      return { stdout: VALID };
    };

    const findings = await createSpecValidator({ run })(FILES);

    expect(findings).toEqual([]);
    expect(seen.args).toEqual(['validate', 'candidate', '--strict', '--json']);
    expect(seen.proposal).toBe('# Proposal');
    expect(seen.delta).toBe('# Spec Delta');
    expect(seen.specsFolder).toBe(true);
    expect(existsSync(seen.cwd ?? '')).toBe(false);
    expect(basename(seen.cwd ?? '').startsWith('factory-spec-')).toBe(true);
  });

  it('reports every issue with the file it is in', async () => {
    const findings = await createSpecValidator({ run: async () => ({ stdout: INVALID }) })(FILES);

    expect(findings).toEqual(['billing/spec.md: ADDED "Bulk export" must include at least one scenario', 'proposal.md: Why section is brief']);
  });

  it('reads the report when the validator exits with an error because the spec is invalid', async () => {
    const run: CommandRunner = async () => {
      throw Object.assign(new Error('Command failed: openspec validate'), { stdout: INVALID });
    };

    const findings = await createSpecValidator({ run })(FILES);

    expect(findings).toHaveLength(2);
  });

  it('fails when the validator exits with an error and prints no report', async () => {
    const run: CommandRunner = async () => {
      throw Object.assign(new Error('Command failed: openspec validate'), { stdout: 'No OpenSpec root found' });
    };

    await expect(createSpecValidator({ run })(FILES)).rejects.toThrow('Command failed: openspec validate');
  });

  it('refuses a file name that would land outside the change folder, without running anything', async () => {
    const calls = { count: 0 };
    const run: CommandRunner = async () => {
      calls.count += 1;
      return { stdout: VALID };
    };
    const escaping = [...FILES, { name: '..__..__evil.md', content: 'x' }, { name: 'specs__..__x.md', content: 'y' }];

    const findings = await createSpecValidator({ run })(escaping);

    expect(findings).toEqual(['..__..__evil.md is not a valid spec file name', 'specs__..__x.md is not a valid spec file name']);
    expect(calls.count).toBe(0);
  });

  it('cleans up even when the validator cannot be run', async () => {
    const seen: { cwd?: string } = {};
    const run: CommandRunner = async (_args, options) => {
      seen.cwd = options?.cwd ?? '';
      throw new Error('openspec: command not found');
    };

    await expect(createSpecValidator({ run })(FILES)).rejects.toThrow('openspec: command not found');
    expect(existsSync(seen.cwd ?? 'missing')).toBe(false);
  });

  it('fails clearly when the validator prints something unexpected', async () => {
    await expect(createSpecValidator({ run: async () => ({ stdout: '{"items":[]}' }) })(FILES)).rejects.toThrow();
  });

  it('leaves no temporary folder behind', async () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('factory-spec-')).length;

    await createSpecValidator({ run: async () => ({ stdout: VALID }) })(FILES);

    expect(readdirSync(tmpdir()).filter((name) => name.startsWith('factory-spec-'))).toHaveLength(before);
  });
});

const commitFiles = (cwd: string, files: Readonly<Record<string, string>>, message = 'add files'): string => {
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  });
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
};

describe('canonical specs on main', () => {
  it('reads every file under openspec/specs on the main branch of origin, fetching it first', async () => {
    const { origin, clone } = getClone();
    commitFiles(origin, { 'openspec/specs/billing/spec.md': '# Billing\n', 'openspec/specs/identity/user-auth/spec.md': '# Auth\n', 'openspec/changes/x/proposal.md': '# X\n' });
    mkdirSync(join(clone, 'openspec/specs/local'), { recursive: true });
    writeFileSync(join(clone, 'openspec/specs/local/spec.md'), '# Not on main');

    const specs = await inputsFor(clone).canonicalSpecs();

    expect(specs).toEqual([
      { path: 'billing/spec.md', content: '# Billing\n' },
      { path: 'identity/user-auth/spec.md', content: '# Auth\n' },
    ]);
  });

  it('reads nothing when main has no canonical specs', async () => {
    const { clone } = getClone();

    expect(await inputsFor(clone).canonicalSpecs()).toEqual([]);
  });
});

describe('spec validator with canonical specs', () => {
  it('lays the canonical specs out under openspec/specs before it validates the change', async () => {
    const seen: { billing?: string; auth?: string } = {};
    const run: CommandRunner = async (_args, options) => {
      const cwd = options?.cwd ?? '';
      seen.billing = readFileSync(join(cwd, 'openspec/specs/billing/spec.md'), 'utf8');
      seen.auth = readFileSync(join(cwd, 'openspec/specs/identity/user-auth/spec.md'), 'utf8');
      return { stdout: VALID };
    };
    const canonicalSpecs = async () => [
      { path: 'billing/spec.md', content: '# Billing' },
      { path: 'identity/user-auth/spec.md', content: '# Auth' },
    ];

    const findings = await createSpecValidator({ run, canonicalSpecs })(FILES);

    expect(findings).toEqual([]);
    expect(seen).toEqual({ billing: '# Billing', auth: '# Auth' });
  });

  it('reports the finding of a delta that would not apply to the canonical specs', async () => {
    const refused = JSON.stringify({
      items: [{ id: 'candidate', valid: true, issues: [{ level: 'INFO', path: 'billing/spec.md', message: 'Archive would refuse this delta: billing MODIFIED failed for header "### Requirement: Bulk export" - not found' }] }],
    });

    const findings = await createSpecValidator({ run: async () => ({ stdout: refused }), canonicalSpecs: async () => [{ path: 'billing/spec.md', content: '# Billing' }] })(FILES);

    expect(findings).toEqual(['billing/spec.md: Archive would refuse this delta: billing MODIFIED failed for header "### Requirement: Bulk export" - not found']);
  });

  it('refuses a canonical spec path that would land outside openspec/specs, without running anything', async () => {
    const calls = { count: 0 };
    const run: CommandRunner = async () => {
      calls.count += 1;
      return { stdout: VALID };
    };

    await expect(createSpecValidator({ run, canonicalSpecs: async () => [{ path: '../evil.md', content: 'x' }] })(FILES)).rejects.toThrow('../evil.md is not a valid canonical spec path');
    await expect(createSpecValidator({ run, canonicalSpecs: async () => [{ path: '/etc/evil.md', content: 'x' }] })(FILES)).rejects.toThrow('/etc/evil.md is not a valid canonical spec path');
    expect(calls.count).toBe(0);
  });
});

const CHANGE_FILES = {
  'openspec/changes/billing-export/proposal.md': '# Proposal\n',
  'openspec/changes/billing-export/design.md': '# Design\n',
  'openspec/changes/billing-export/tasks.md': '# Tasks\n\n- [x] 1. Done. Verified by a test.\n',
  'openspec/changes/billing-export/specs/billing/spec.md': '# Spec Delta\n',
  'openspec/changes/billing-export/.openspec.yaml': 'schema: spec-driven\n',
  'openspec/changes/.gitkeep': '',
  'openspec/changes/ledger/proposal.md': '# Ledger\n',
};

const ARCHIVE_FAILURE = 'Task status: 1/1 tasks\nbilling MODIFIED failed for header "### Requirement: Bulk export" - not found\nAborted. No files were changed.\n';

const getRunBranch = () => {
  const { origin, clone } = getClone();
  git(clone, 'config', 'user.email', 'pierre@example.test');
  commitFiles(origin, { 'openspec/changes/archive/2026-11-01-old/proposal.md': '# Old\n' }, 'archive an old change');
  git(clone, 'pull', '-q', '--ff-only');
  git(clone, 'checkout', '-q', '-b', 'factory/pay-142');
  const reviewed = commitFiles(clone, { ...CHANGE_FILES, 'src/export.ts': 'export {}\n' }, 'PAY-142 add the exporter');
  return { clone, reviewed };
};

const fakeOpenSpec = (calls: { args: readonly string[]; cwd: string }[], failure?: string): CommandRunner => async (args, options) => {
  const cwd = options?.cwd ?? '';
  calls.push({ args, cwd });
  if (failure !== undefined) throw Object.assign(new Error('Command failed: openspec archive'), { code: 1, stdout: failure, stderr: '' });
  const name = args[1] ?? '';
  mkdirSync(join(cwd, 'openspec/specs/billing'), { recursive: true });
  writeFileSync(join(cwd, 'openspec/specs/billing/spec.md'), '# Billing\n');
  mkdirSync(join(cwd, 'openspec/changes/archive'), { recursive: true });
  renameSync(join(cwd, 'openspec/changes', name), join(cwd, 'openspec/changes/archive', `2026-11-23-${name}`));
  return { stdout: `Change '${name}' archived as '2026-11-23-${name}'.` };
};

const archiveFor = (cwd: string, openspec: CommandRunner) => {
  const run = createCommandRunner('git');
  return createChangeArchive({ git: (args) => run(args, { cwd }), openspec, mainBranch: 'main' });
};

describe('change archive', () => {
  it('lists the committed change folders outside archive/, with their files relative to the folder, whatever the files hold', async () => {
    const { clone } = getRunBranch();
    mkdirSync(join(clone, 'openspec/changes/uncommitted'), { recursive: true });
    writeFileSync(join(clone, 'openspec/changes/uncommitted/proposal.md'), '# Not committed');

    const folders = await archiveFor(clone, fakeOpenSpec([])).changeFolders();

    expect(readFileSync(join(clone, 'openspec/changes/billing-export/tasks.md'), 'utf8')).toContain('- [x] 1.');
    expect(folders).toEqual([
      { name: 'billing-export', files: ['.openspec.yaml', 'design.md', 'proposal.md', 'specs/billing/spec.md', 'tasks.md'], archived: false },
      { name: 'ledger', files: ['proposal.md'], archived: false },
    ]);
  });

  it('lists a change archived on the run branch, but not the archives already on main', async () => {
    const { clone } = getRunBranch();
    const archive = archiveFor(clone, fakeOpenSpec([]));
    await archive.archiveChange('billing-export');

    const folders = await archive.changeFolders();

    expect(folders).toEqual([
      { name: '2026-11-23-billing-export', files: ['.openspec.yaml', 'design.md', 'proposal.md', 'specs/billing/spec.md', 'tasks.md'], archived: true },
      { name: 'ledger', files: ['proposal.md'], archived: false },
    ]);
  });

  it('lists no folder when the branch has no change', async () => {
    const { clone } = getClone();

    expect(await archiveFor(clone, fakeOpenSpec([])).changeFolders()).toEqual([]);
  });

  it('archives the change in a separate checkout and adds the archive to the run branch as one commit', async () => {
    const { clone, reviewed } = getRunBranch();
    writeFileSync(join(clone, 'notes.txt'), 'unsaved work');
    const calls: { args: readonly string[]; cwd: string }[] = [];

    const result = await archiveFor(clone, fakeOpenSpec(calls)).archiveChange('billing-export');

    expect(result).toEqual({ ok: true });
    expect(calls.map(({ args }) => args)).toEqual([['archive', 'billing-export', '--yes']]);
    expect(calls[0]?.cwd).not.toBe(clone);
    expect(git(clone, 'branch', '--show-current')).toBe('factory/pay-142');
    expect(git(clone, 'rev-parse', 'HEAD~1')).toBe(reviewed);
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('chore: archive the billing-export OpenSpec change');
    expect(git(clone, 'show', '--name-status', '--format=', 'HEAD').split('\n').toSorted()).toEqual([
      'A\topenspec/specs/billing/spec.md',
      'R100\topenspec/changes/billing-export/.openspec.yaml\topenspec/changes/archive/2026-11-23-billing-export/.openspec.yaml',
      'R100\topenspec/changes/billing-export/design.md\topenspec/changes/archive/2026-11-23-billing-export/design.md',
      'R100\topenspec/changes/billing-export/proposal.md\topenspec/changes/archive/2026-11-23-billing-export/proposal.md',
      'R100\topenspec/changes/billing-export/specs/billing/spec.md\topenspec/changes/archive/2026-11-23-billing-export/specs/billing/spec.md',
      'R100\topenspec/changes/billing-export/tasks.md\topenspec/changes/archive/2026-11-23-billing-export/tasks.md',
    ]);
    expect(existsSync(join(clone, 'openspec/specs/billing/spec.md'))).toBe(true);
    expect(readFileSync(join(clone, 'notes.txt'), 'utf8')).toBe('unsaved work');
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('gives the CLI output and leaves the run branch as it was when the archive fails', async () => {
    const { clone, reviewed } = getRunBranch();

    const result = await archiveFor(clone, fakeOpenSpec([], ARCHIVE_FAILURE)).archiveChange('billing-export');

    expect(result).toEqual({ ok: false, error: ARCHIVE_FAILURE.trim() });
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(reviewed);
    expect(git(clone, 'status', '--porcelain')).toBe('');
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('fails with the error, leaving the run branch as it was, when the CLI cannot be started at all', async () => {
    const { clone, reviewed } = getRunBranch();
    const missing: CommandRunner = async () => {
      throw Object.assign(new Error('spawn openspec ENOENT'), { code: 'ENOENT', stdout: '', stderr: '' });
    };

    await expect(archiveFor(clone, missing).archiveChange('billing-export')).rejects.toThrow('spawn openspec ENOENT');
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(reviewed);
    expect(git(clone, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('gives what the CLI printed on stderr when it fails with nothing on stdout', async () => {
    const { clone, reviewed } = getRunBranch();
    const refused: CommandRunner = async () => {
      throw Object.assign(new Error('Command failed: openspec archive billing-export --yes'), { code: 1, stdout: '', stderr: "Change 'billing-export' not found.\n" });
    };

    const result = await archiveFor(clone, refused).archiveChange('billing-export');

    expect(result).toEqual({ ok: false, error: "Change 'billing-export' not found." });
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(reviewed);
  });

  it('gives the error message when the CLI fails and prints nothing', async () => {
    const { clone } = getRunBranch();
    const silent: CommandRunner = async () => {
      throw Object.assign(new Error('Command failed: openspec archive billing-export --yes'), { code: 1 });
    };

    expect(await archiveFor(clone, silent).archiveChange('billing-export')).toEqual({ ok: false, error: 'Command failed: openspec archive billing-export --yes' });
  });
});
