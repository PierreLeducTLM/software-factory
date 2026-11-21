import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { CommandRunner } from '../adapters/orca-agent-runtime.js';
import type { SpecFile } from '../factory/refinement.js';

type GitOptions = { readonly run: CommandRunner; readonly mainBranch: string };

export const createGitInputs = ({ run, mainBranch }: GitOptions) => {
  const remoteMain = `origin/${mainBranch}`;
  const fetched = async (args: readonly string[]): Promise<string> => {
    await run(['fetch', '--quiet', 'origin', mainBranch]);
    return (await run(args)).stdout.trim();
  };

  return {
    userName: async (): Promise<string> => (await run(['config', 'user.name'])).stdout.trim(),
    mainCommit: (): Promise<string> => fetched(['rev-parse', remoteMain]),
    changedFilesSince: async (commit: string): Promise<readonly string[]> =>
      (await fetched(['diff', '--name-only', commit, remoteMain])).split('\n').filter((line) => line !== ''),
  };
};

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
