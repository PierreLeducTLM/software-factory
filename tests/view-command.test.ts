import type { SpawnOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { viewCommand } from '../src/cli/view-command.js';

const getHarness = (options?: { readonly built?: boolean; readonly serverEntry?: string }) => {
  const spawned: { command: string; args: readonly string[]; options: SpawnOptions }[] = [];
  const out: string[] = [];
  const errors: string[] = [];
  const exits: ((code: number | null) => void)[] = [];
  const run = (...argv: readonly string[]) =>
    viewCommand({
      argv,
      cwd: '/work/billing-service',
      env: { JIRA_TOKEN: 'secret', PATH: '/usr/bin' },
      serverEntry: options?.serverEntry ?? '/pkg/view/.output/server/index.mjs',
      exists: () => options?.built ?? true,
      spawn: (command, args, spawnOptions) => {
        spawned.push({ command, args, options: spawnOptions });
        return {
          on: (_event: string, listener: (code: number | null) => void) => {
            exits.push(listener);
            return undefined as never;
          },
        };
      },
      write: (line) => void out.push(line),
      writeError: (line) => void errors.push(line),
    });
  return { run, spawned, out, errors, exits };
};

describe('factory view', () => {
  it('starts the dashboard for the current project on this computer only, and says where it is', async () => {
    const { run, spawned, out, exits } = getHarness();

    const finished = run();
    exits[0]?.(0);

    expect(await finished).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.command).toBe(process.execPath);
    expect(spawned[0]?.args).toEqual(['/pkg/view/.output/server/index.mjs']);
    expect(spawned[0]?.options.stdio).toBe('inherit');
    expect(spawned[0]?.options.env).toEqual({
      JIRA_TOKEN: 'secret',
      PATH: '/usr/bin',
      FACTORY_PROJECT_DIR: '/work/billing-service',
      PORT: '4790',
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1',
    });
    expect(out).toEqual(['Factory view: http://127.0.0.1:4790 (read-only, press Ctrl+C to stop)']);
  });

  it('uses the port it is given and shows sample data when asked', async () => {
    const { run, spawned, out, exits } = getHarness();

    const finished = run('--sample', '--port', '5005');
    exits[0]?.(0);
    await finished;

    expect(spawned[0]?.options.env).toMatchObject({ PORT: '5005', FACTORY_VIEW_SAMPLE: '1' });
    expect(out).toEqual(['Factory view: http://127.0.0.1:5005 (read-only, press Ctrl+C to stop)']);
  });

  it('ends with the code the dashboard ended with, or 0 when it was stopped', async () => {
    const failed = getHarness();
    const stopped = getHarness();

    const first = failed.run();
    failed.exits[0]?.(3);
    const second = stopped.run();
    stopped.exits[0]?.(null);

    expect(await first).toBe(3);
    expect(await second).toBe(0);
  });

  it.each([[['--port']], [['--port', 'eighty']], [['--port', '80a']]])('exits 2 with usage for %j, starting nothing', async (argv) => {
    const { run, spawned, errors } = getHarness();

    expect(await run(...argv)).toBe(2);
    expect(errors).toEqual(['Usage: factory view [--sample] [--port <number>]']);
    expect(spawned).toEqual([]);
  });

  it('exits 2 and says to reinstall the engine when an installed engine is missing its dashboard', async () => {
    const serverEntry = '/work/billing-service/.factory/node_modules/software-factory/view/.output/server/index.mjs';
    const { run, spawned, errors } = getHarness({ built: false, serverEntry });

    expect(await run()).toBe(2);
    expect(errors).toEqual([
      `The factory dashboard is missing from the installed engine (${serverEntry}). Reinstall it: delete .factory/node_modules and run factory view again.`,
    ]);
    expect(spawned).toEqual([]);
  });

  it('recognises an installed engine on a Windows path', async () => {
    const serverEntry = 'C:\\work\\.factory\\node_modules\\software-factory\\view\\.output\\server\\index.mjs';
    const { run, errors } = getHarness({ built: false, serverEntry });

    await run();

    expect(errors[0]).toMatch(/^The factory dashboard is missing from the installed engine/);
  });

  it('exits 2 and says how to build the view when a checkout of the factory has not built it', async () => {
    const { run, spawned, errors } = getHarness({ built: false });

    expect(await run()).toBe(2);
    expect(errors).toEqual(['The factory view is not built (/pkg/view/.output/server/index.mjs is missing). Run: pnpm build:view']);
    expect(spawned).toEqual([]);
  });
});
