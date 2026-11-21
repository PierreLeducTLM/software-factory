import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCommandRunner, type CommandRunner } from '../src/adapters/orca-agent-runtime.js';
import { createGitInputs, createSpecValidator } from '../src/cli/inputs.js';

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
