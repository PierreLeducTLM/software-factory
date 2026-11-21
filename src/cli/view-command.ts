import type { ChildProcess, SpawnOptions } from 'node:child_process';

type Options = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly serverEntry: string;
  readonly exists: (path: string) => boolean;
  readonly spawn: (command: string, args: readonly string[], options: SpawnOptions) => Pick<ChildProcess, 'on'>;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
};

const DEFAULT_PORT = '4790';
const LOCAL_ONLY = '127.0.0.1';
const USAGE_ERROR = 2;

export const viewCommand = ({ argv, cwd, env, serverEntry, exists, spawn, write, writeError }: Options): Promise<number> => {
  const portAt = argv.indexOf('--port');
  const port = portAt === -1 ? DEFAULT_PORT : (argv[portAt + 1] ?? '');
  if (!/^\d+$/.test(port)) {
    writeError('Usage: factory view [--sample] [--port <number>]');
    return Promise.resolve(USAGE_ERROR);
  }
  if (!exists(serverEntry)) {
    writeError(`The factory view is not built (${serverEntry} is missing). Run: pnpm build:view`);
    return Promise.resolve(USAGE_ERROR);
  }

  const child = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    env: {
      ...env,
      FACTORY_PROJECT_DIR: cwd,
      PORT: port,
      HOST: LOCAL_ONLY,
      NITRO_HOST: LOCAL_ONLY,
      ...(argv.includes('--sample') ? { FACTORY_VIEW_SAMPLE: '1' } : {}),
    },
  });
  write(`Factory view: http://${LOCAL_ONLY}:${port} (read-only, press Ctrl+C to stop)`);
  return new Promise((resolve) => child.on('exit', (code: number | null) => resolve(code ?? 0)));
};
