import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import type { CommandRunner } from '../adapters/orca-agent-runtime.js';
import type { ScriptRun } from '../factory/checks.js';
import type { SpecFile } from '../factory/refinement.js';
import type { PublishedFile } from '../setup/upgrade.js';

type GitOptions = { readonly run: CommandRunner; readonly mainBranch: string };

export const createGitInputs = ({ run, mainBranch }: GitOptions) => {
  const remoteMain = `origin/${mainBranch}`;
  const fetched = async (args: readonly string[]): Promise<string> => {
    await run(['fetch', '--quiet', 'origin', mainBranch]);
    return (await run(args)).stdout.trim();
  };

  return {
    userName: async (): Promise<string> => (await run(['config', '--default', '', '--get', 'user.name'])).stdout.trim(),
    mainCommit: (): Promise<string> => fetched(['rev-parse', remoteMain]),
    changedFilesSince: async (commit: string): Promise<readonly string[]> =>
      (await fetched(['diff', '--name-only', commit, remoteMain])).split('\n').filter((line) => line !== ''),
    changedFilesOnBranch: async (): Promise<readonly string[]> =>
      (await fetched(['diff', '--name-only', `${remoteMain}...HEAD`])).split('\n').filter((line) => line !== ''),
    linesChangedOnBranch: async (): Promise<number> =>
      (await fetched(['diff', '--numstat', `${remoteMain}...HEAD`]))
        .split('\n')
        .flatMap((line) => line.split('\t').slice(0, 2))
        .reduce((total, count) => total + (Number(count) || 0), 0),
    commitMessage: async (commit: string): Promise<string> => (await run(['log', '-1', '--format=%B', commit])).stdout.trim(),
    pushBranch: async (branch: string): Promise<void> => {
      await run(['push', '--quiet', '--set-upstream', 'origin', branch]);
    },
  };
};

export const createFilePublisher =
  ({ run }: { readonly run: CommandRunner }) =>
  async ({ branch, base, path, content, message }: PublishedFile): Promise<void> => {
    const folder = await mkdtemp(join(tmpdir(), 'factory-publish-'));
    await run(['fetch', '--quiet', 'origin', base]);
    await run(['worktree', 'add', '--quiet', '-b', branch, folder, `origin/${base}`]);
    try {
      const target = join(folder, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      await run(['-C', folder, 'add', path]);
      await run(['-C', folder, 'commit', '--quiet', '-m', message]);
      await run(['-C', folder, 'push', '--quiet', '--set-upstream', 'origin', branch]);
    } finally {
      await run(['worktree', 'remove', '--force', folder]);
    }
  };

const OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;

const ExitSchema = z.object({ code: z.number() });

export const createScriptRunner =
  ({ cwd }: { readonly cwd: string }) =>
  (command: string, { timeoutSeconds }: { readonly timeoutSeconds: number }): Promise<ScriptRun> =>
    new Promise((resolve) => {
      execFile('sh', ['-c', command], { cwd, timeout: timeoutSeconds * 1000, maxBuffer: OUTPUT_LIMIT_BYTES }, (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        if (error === null) return resolve({ exitCode: 0, output, timedOut: false });
        const exit = ExitSchema.safeParse(error);
        return resolve(exit.success ? { exitCode: exit.data.code, output, timedOut: false } : { exitCode: 1, output, timedOut: true });
      });
    });

const ValidationSchema = z.object({
  items: z.tuple([z.object({ issues: z.array(z.object({ path: z.string(), message: z.string() })) })]).rest(z.unknown()),
});

const CHANGE = 'candidate';

const FailedCommandSchema = z.object({ stdout: z.string().startsWith('{') });

const reportOf = async (run: CommandRunner, cwd: string): Promise<string> => {
  try {
    return (await run(['validate', CHANGE, '--strict', '--json'], { cwd })).stdout;
  } catch (error) {
    const failed = FailedCommandSchema.safeParse(error);
    if (!failed.success) throw error;
    return failed.data.stdout;
  }
};

const pathOf = (name: string): string => name.replaceAll('__', '/');

const escapes = (name: string): boolean => pathOf(name).split('/').includes('..');

export type SpecFolder = {
  readonly read: (folder: string) => Promise<readonly SpecFile[]>;
  readonly write: (folder: string, files: readonly SpecFile[]) => Promise<void>;
};

export const createSpecFolder = (): SpecFolder => ({
  read: async (folder) => {
    const entries = await readdir(folder, { recursive: true, withFileTypes: true });
    const markdown = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => join(entry.parentPath, entry.name));
    const files = await Promise.all(
      markdown.map(async (path) => ({ name: relative(folder, path).split(sep).join('__'), content: await readFile(path, 'utf8') })),
    );
    return files.toSorted((a, b) => a.name.localeCompare(b.name));
  },

  write: async (folder, files) => {
    const invalid = files.find((file) => escapes(file.name));
    if (invalid !== undefined) throw new Error(`${invalid.name} is not a valid spec file name`);
    await Promise.all(
      files.map(async (file) => {
        const target = join(folder, pathOf(file.name));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }),
    );
  },
});

export const createSpecValidator =
  ({ run }: { readonly run: CommandRunner }) =>
  async (files: readonly SpecFile[]): Promise<readonly string[]> => {
    const invalid = files.filter((file) => escapes(file.name));
    if (invalid.length > 0) return invalid.map((file) => `${file.name} is not a valid spec file name`);

    const root = await mkdtemp(join(tmpdir(), 'factory-spec-'));
    try {
      await mkdir(join(root, 'openspec', 'specs'), { recursive: true });
      await Promise.all(
        files.map(async (file) => {
          const target = join(root, 'openspec', 'changes', CHANGE, pathOf(file.name));
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, file.content);
        }),
      );
      return ValidationSchema.parse(JSON.parse(await reportOf(run, root))).items[0].issues.map((issue) => `${issue.path}: ${issue.message}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
