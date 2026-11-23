export type Dashboard = {
  readonly entry: string;
  readonly port: number;
  readonly host: string;
  readonly projectDir: string;
  readonly sample: boolean;
};

type Options = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly serverEntry: string;
  readonly exists: (path: string) => boolean;
  readonly isPortFree: (port: number) => Promise<boolean>;
  readonly startServer: (dashboard: Dashboard) => Promise<void>;
  readonly waitUntilListening: (wait: { readonly port: number; readonly timeoutMs: number }) => Promise<boolean>;
  readonly untilStopped: () => Promise<void>;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
};

const DEFAULT_PORT = 4790;
const LAST_DEFAULT_PORT = 4799;
const LOCAL_ONLY = '127.0.0.1';
const START_TIMEOUT_MS = 10_000;
const USAGE_ERROR = 2;
const FAILED = 1;
const STOPPED = 0;

const missingDashboard = (serverEntry: string): string =>
  /[\\/]node_modules[\\/]/.test(serverEntry)
    ? `The factory dashboard is missing from the installed engine (${serverEntry}). Reinstall it: delete .factory/node_modules and run factory view again.`
    : `The factory view is not built (${serverEntry} is missing). Run: pnpm build:view`;

const lsof = (port: number): string => `lsof -iTCP:${port} -sTCP:LISTEN shows which process`;

export const firstFreePort = async ({
  from,
  to,
  isFree,
}: {
  readonly from: number;
  readonly to: number;
  readonly isFree: (port: number) => Promise<boolean>;
}): Promise<number | undefined> => {
  if (from > to) return undefined;
  return (await isFree(from)) ? from : firstFreePort({ from: from + 1, to, isFree });
};

type PortChoice = { readonly port: number } | { readonly error: string };

const choosePort = async (
  requested: string | undefined,
  isPortFree: Options['isPortFree'],
  writeError: Options['writeError'],
): Promise<PortChoice> => {
  if (requested !== undefined) {
    const port = Number(requested);
    return (await isPortFree(port))
      ? { port }
      : { error: `Port ${port} is in use (${lsof(port)}). Choose another with --port <number>.` };
  }
  const port = await firstFreePort({ from: DEFAULT_PORT, to: LAST_DEFAULT_PORT, isFree: isPortFree });
  if (port === undefined) return { error: `No free port for the factory dashboard between ${DEFAULT_PORT} and ${LAST_DEFAULT_PORT}.` };
  if (port !== DEFAULT_PORT) {
    writeError(`Port ${DEFAULT_PORT} is in use, possibly by a factory view that was not stopped (${lsof(DEFAULT_PORT)}). Using ${port}.`);
  }
  return { port };
};

export const viewCommand = async ({
  argv,
  cwd,
  serverEntry,
  exists,
  isPortFree,
  startServer,
  waitUntilListening,
  untilStopped,
  write,
  writeError,
}: Options): Promise<number> => {
  const portAt = argv.indexOf('--port');
  const requested = portAt === -1 ? undefined : (argv[portAt + 1] ?? '');
  if (requested !== undefined && !/^\d+$/.test(requested)) {
    writeError('Usage: factory view [--sample] [--port <number>]');
    return USAGE_ERROR;
  }
  if (!exists(serverEntry)) {
    writeError(missingDashboard(serverEntry));
    return USAGE_ERROR;
  }

  const choice = await choosePort(requested, isPortFree, writeError);
  if ('error' in choice) {
    writeError(choice.error);
    return FAILED;
  }

  const { port } = choice;
  const stopped = untilStopped();
  await startServer({ entry: serverEntry, port, host: LOCAL_ONLY, projectDir: cwd, sample: argv.includes('--sample') });
  if (!(await waitUntilListening({ port, timeoutMs: START_TIMEOUT_MS }))) {
    writeError(`The factory dashboard did not start on port ${port}.`);
    return FAILED;
  }
  write(`Factory view: http://${LOCAL_ONLY}:${port} (read-only, press Ctrl+C to stop)`);
  await stopped;
  return STOPPED;
};
