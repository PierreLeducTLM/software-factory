import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import type { CommandRunner } from '../adapters/orca-agent-runtime.js';
import type { ArchiveResult, ChangeFolder } from '../factory/build-loop.js';
import type { ScriptRun } from '../factory/checks.js';
import type { SpecFile } from '../factory/refinement.js';
import type { PublishedChange } from '../setup/project-files.js';

type GitOptions = { readonly run: CommandRunner; readonly mainBranch: string };

export type CanonicalSpec = { readonly path: string; readonly content: string };

const CANONICAL_SPECS = 'openspec/specs';
const CHANGES = 'openspec/changes';
const ARCHIVE_FOLDER = 'archive';

const linesOf = (text: string): readonly string[] => text.split('\n').filter((line) => line !== '');

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
    canonicalSpecs: async (): Promise<readonly CanonicalSpec[]> => {
      const paths = linesOf(await fetched(['ls-tree', '-r', '--name-only', remoteMain, '--', CANONICAL_SPECS]));
      return Promise.all(
        paths.map(async (path) => ({ path: path.slice(CANONICAL_SPECS.length + 1), content: (await run(['show', `${remoteMain}:${path}`])).stdout })),
      );
    },
  };
};

const RefusalSchema = z.object({ code: z.number(), stdout: z.string().default(''), stderr: z.string().default('') });

const refusalOf = (error: unknown): string => {
  const refusal = RefusalSchema.safeParse(error);
  if (!refusal.success) throw error;
  const printed = [refusal.data.stdout, refusal.data.stderr].map((output) => output.trim()).find((output) => output !== '');
  return printed ?? (error instanceof Error ? error.message : String(error));
};

type Entry = { readonly folder: string; readonly file: string };

const entriesOf = (paths: readonly string[], prefix: string): readonly Entry[] =>
  paths.flatMap((path) => {
    const [folder = '', ...rest] = path.slice(prefix.length + 1).split('/');
    return rest.length === 0 ? [] : [{ folder, file: rest.join('/') }];
  });

const foldersOf = (entries: readonly Entry[], archived: boolean): readonly ChangeFolder[] =>
  [...new Set(entries.map(({ folder }) => folder))]
    .toSorted()
    .map((name) => ({ name, files: entries.filter((entry) => entry.folder === name).map(({ file }) => file).toSorted(), archived }));

type ArchiveOptions = { readonly git: CommandRunner; readonly openspec: CommandRunner; readonly mainBranch: string };

export const createChangeArchive = ({ git, openspec, mainBranch }: ArchiveOptions) => ({
  changeFolders: async (): Promise<readonly ChangeFolder[]> => {
    const archive = `${CHANGES}/${ARCHIVE_FOLDER}`;
    const listed = async (path: string): Promise<readonly string[]> => linesOf((await git(['ls-tree', '-r', '--name-only', 'HEAD', '--', path])).stdout);
    await git(['fetch', '--quiet', 'origin', mainBranch]);
    const added = linesOf((await git(['diff', '--name-only', '--no-renames', '--diff-filter=A', `origin/${mainBranch}...HEAD`, '--', archive])).stdout);
    const archivedOnBranch = new Set(entriesOf(added, archive).map(({ folder }) => folder));
    const open = entriesOf(await listed(CHANGES), CHANGES).filter(({ folder }) => folder !== ARCHIVE_FOLDER);
    const archived = entriesOf(await listed(archive), archive).filter(({ folder }) => archivedOnBranch.has(folder));
    return [...foldersOf(archived, true), ...foldersOf(open, false)];
  },
  archiveChange: async (name: string): Promise<ArchiveResult> => {
    const folder = await mkdtemp(join(tmpdir(), 'factory-archive-'));
    await git(['worktree', 'add', '--quiet', '--detach', folder, 'HEAD']);
    try {
      const refused = await openspec(['archive', name, '--yes'], { cwd: folder }).then(
        () => undefined,
        (error: unknown) => refusalOf(error),
      );
      if (refused !== undefined) return { ok: false, error: refused };
      await git(['-C', folder, 'add', '--all', '--', 'openspec']);
      await git(['-C', folder, 'commit', '--quiet', '-m', `chore: archive the ${name} OpenSpec change`]);
      const commit = (await git(['-C', folder, 'rev-parse', 'HEAD'])).stdout.trim();
      await git(['merge', '--ff-only', '--quiet', commit]);
      return { ok: true };
    } finally {
      await git(['worktree', 'remove', '--force', folder]);
    }
  },
});

export const createFilePublisher =
  ({ run }: { readonly run: CommandRunner }) =>
  async ({ branch, base, files, message, executable }: PublishedChange): Promise<void> => {
    const folder = await mkdtemp(join(tmpdir(), 'factory-publish-'));
    await run(['fetch', '--quiet', 'origin', base]);
    await run(['worktree', 'add', '--quiet', '-b', branch, folder, `origin/${base}`]);
    try {
      await Promise.all(
        Object.entries(files).map(async ([path, content]) => {
          const target = join(folder, path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, content);
          if (executable?.includes(path) === true) await chmod(target, 0o755);
        }),
      );
      await run(['-C', folder, 'add', '--', ...Object.keys(files)]);
      await run(['-C', folder, 'commit', '--quiet', '-m', message]);
      await run(['-C', folder, 'push', '--quiet', '--set-upstream', 'origin', branch]);
    } finally {
      await run(['worktree', 'remove', '--force', folder]);
    }
  };

const orUndefined = (read: () => Promise<string>): Promise<string | undefined> => read().catch(() => undefined);

export const createRepositoryReader = ({ run }: { readonly run: CommandRunner }) => ({
  remoteUrl: (): Promise<string | undefined> => orUndefined(async () => (await run(['remote', 'get-url', 'origin'])).stdout.trim()),
  defaultBranch: async (): Promise<string | undefined> =>
    (await orUndefined(async () => (await run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).stdout.trim().replace(/^origin\//, ''))) ??
    run(['ls-remote', '--symref', 'origin', 'HEAD']).then(
      ({ stdout }) => /ref: refs\/heads\/(\S+)\tHEAD/.exec(stdout)?.[1],
      () => undefined,
    ),
  mainFile: (path: string, branch: string): Promise<string | undefined> =>
    orUndefined(async () => {
      await run(['fetch', '--quiet', 'origin', branch]);
      return (await run(['show', `origin/${branch}:${path}`])).stdout;
    }),
});

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

const outside = (path: string): boolean => path.startsWith('/') || path.split('/').includes('..');

type ValidatorOptions = { readonly run: CommandRunner; readonly canonicalSpecs?: () => Promise<readonly CanonicalSpec[]> };

export const createSpecValidator =
  ({ run, canonicalSpecs = async () => [] }: ValidatorOptions) =>
  async (files: readonly SpecFile[]): Promise<readonly string[]> => {
    const invalid = files.filter((file) => escapes(file.name));
    if (invalid.length > 0) return invalid.map((file) => `${file.name} is not a valid spec file name`);
    const canonical = await canonicalSpecs();
    const unsafe = canonical.find((spec) => outside(spec.path));
    if (unsafe !== undefined) throw new Error(`${unsafe.path} is not a valid canonical spec path`);

    const root = await mkdtemp(join(tmpdir(), 'factory-spec-'));
    try {
      await mkdir(join(root, 'openspec', 'specs'), { recursive: true });
      await Promise.all(
        canonical.map(async (spec) => {
          const target = join(root, CANONICAL_SPECS, spec.path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, spec.content);
        }),
      );
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
