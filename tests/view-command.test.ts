import { createServer, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { type Dashboard, firstFreePort, viewCommand } from '../src/cli/view-command.js';
import { isPortFree, waitUntilListening } from '../src/cli/view-server.js';

type HarnessOptions = {
  readonly built?: boolean;
  readonly serverEntry?: string;
  readonly taken?: readonly number[];
  readonly listening?: Promise<boolean>;
};

const getHarness = (options?: HarnessOptions) => {
  const started: Dashboard[] = [];
  const checked: number[] = [];
  const waited: { readonly port: number; readonly timeoutMs: number }[] = [];
  const out: string[] = [];
  const errors: string[] = [];
  const stops: (() => void)[] = [];
  const run = (...argv: readonly string[]) =>
    viewCommand({
      argv,
      cwd: '/work/billing-service',
      serverEntry: options?.serverEntry ?? '/pkg/view/.output/server/index.mjs',
      exists: () => options?.built ?? true,
      isPortFree: async (port) => {
        checked.push(port);
        return !(options?.taken ?? []).includes(port);
      },
      startServer: async (dashboard) => void started.push(dashboard),
      waitUntilListening: (wait) => {
        waited.push(wait);
        return options?.listening ?? Promise.resolve(true);
      },
      untilStopped: () => new Promise((resolve) => stops.push(resolve)),
      write: (line) => void out.push(line),
      writeError: (line) => void errors.push(line),
    });
  const stop = () => stops.forEach((resolve) => resolve());
  return { run, stop, started, checked, waited, out, errors };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const holdPort = (port = 0): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(server));
  });

const portOf = (server: Server): number => {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
};

const release = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

const LEFTOVER_NOTICE = 'Port 4790 is in use, possibly by a factory view that was not stopped (lsof -iTCP:4790 -sTCP:LISTEN shows which process).';

describe('factory view', () => {
  it('starts the dashboard for the current project on this computer only, in its own process, and says where it is', async () => {
    const { run, stop, started, out, errors } = getHarness();

    const finished = run();
    await settle();
    stop();

    expect(await finished).toBe(0);
    expect(started).toEqual([
      { entry: '/pkg/view/.output/server/index.mjs', port: 4790, host: '127.0.0.1', projectDir: '/work/billing-service', sample: false },
    ]);
    expect(out).toEqual(['Factory view: http://127.0.0.1:4790 (read-only, press Ctrl+C to stop)']);
    expect(errors).toEqual([]);
  });

  it('uses the port it is given and shows sample data when asked', async () => {
    const { run, stop, started, out } = getHarness();

    const finished = run('--sample', '--port', '5005');
    await settle();
    stop();
    await finished;

    expect(started).toEqual([expect.objectContaining({ port: 5005, sample: true })]);
    expect(out).toEqual(['Factory view: http://127.0.0.1:5005 (read-only, press Ctrl+C to stop)']);
  });

  it('keeps serving until it is stopped, then ends with code 0', async () => {
    const { run, stop } = getHarness();
    const outcome: number[] = [];

    const finished = run().then((code) => void outcome.push(code));
    await settle();
    expect(outcome).toEqual([]);

    stop();
    await finished;
    expect(outcome).toEqual([0]);
  });

  it('prints the URL only once the dashboard listens', async () => {
    const listens: ((listening: boolean) => void)[] = [];
    const { run, stop, out, waited } = getHarness({ listening: new Promise((resolve) => listens.push(resolve)) });

    const finished = run();
    await settle();
    expect(waited).toEqual([{ port: 4790, timeoutMs: 10_000 }]);
    expect(out).toEqual([]);

    listens.forEach((resolve) => resolve(true));
    await settle();
    expect(out).toEqual(['Factory view: http://127.0.0.1:4790 (read-only, press Ctrl+C to stop)']);
    stop();
    await finished;
  });

  it('exits 1 without a URL when the dashboard is not listening 10 seconds after it started', async () => {
    const { run, out, errors, started } = getHarness({ listening: Promise.resolve(false) });

    expect(await run()).toBe(1);
    expect(started).toHaveLength(1);
    expect(out).toEqual([]);
    expect(errors).toEqual(['The factory dashboard did not start on port 4790.']);
  });

  it('moves to the next free port when the default port is taken, and says which one it uses', async () => {
    const { run, stop, started, out, errors, checked } = getHarness({ taken: [4790] });

    const finished = run();
    await settle();
    stop();
    await finished;

    expect(checked).toEqual([4790, 4791]);
    expect(errors).toEqual([`${LEFTOVER_NOTICE} Using 4791.`]);
    expect(started).toEqual([expect.objectContaining({ port: 4791 })]);
    expect(out).toEqual(['Factory view: http://127.0.0.1:4791 (read-only, press Ctrl+C to stop)']);
  });

  it('gives one notice however many ports it skips', async () => {
    const { run, stop, started, out, errors } = getHarness({ taken: [4790, 4791] });

    const finished = run();
    await settle();
    stop();
    await finished;

    expect(errors).toEqual([`${LEFTOVER_NOTICE} Using 4792.`]);
    expect(started).toEqual([expect.objectContaining({ port: 4792 })]);
    expect(out).toEqual(['Factory view: http://127.0.0.1:4792 (read-only, press Ctrl+C to stop)']);
  });

  it('exits 1 without starting a dashboard when 4790 to 4799 are all taken, looking no further', async () => {
    const taken = Array.from({ length: 11 }, (_, index) => 4790 + index);
    const { run, started, out, errors, checked } = getHarness({ taken });

    expect(await run()).toBe(1);
    expect(checked).toEqual(taken.slice(0, 10));
    expect(errors).toEqual(['No free port for the factory dashboard between 4790 and 4799.']);
    expect(started).toEqual([]);
    expect(out).toEqual([]);
  });

  it('exits 1 without starting a dashboard when the port it is given is taken', async () => {
    const { run, started, out, errors, checked } = getHarness({ taken: [5005] });

    expect(await run('--port', '5005')).toBe(1);
    expect(checked).toEqual([5005]);
    expect(errors).toEqual(['Port 5005 is in use (lsof -iTCP:5005 -sTCP:LISTEN shows which process). Choose another with --port <number>.']);
    expect(started).toEqual([]);
    expect(out).toEqual([]);
  });

  it.each([[['--port']], [['--port', 'eighty']], [['--port', '80a']], [['--port', 'a80']]])('exits 2 with usage for %j, starting nothing', async (argv) => {
    const { run, started, errors } = getHarness();

    expect(await run(...argv)).toBe(2);
    expect(errors).toEqual(['Usage: factory view [--sample] [--port <number>]']);
    expect(started).toEqual([]);
  });

  it('exits 2 and says to reinstall the engine when an installed engine is missing its dashboard', async () => {
    const serverEntry = '/work/billing-service/.factory/node_modules/software-factory/view/.output/server/index.mjs';
    const { run, started, errors } = getHarness({ built: false, serverEntry });

    expect(await run()).toBe(2);
    expect(errors).toEqual([
      `The factory dashboard is missing from the installed engine (${serverEntry}). Reinstall it: delete .factory/node_modules and run factory view again.`,
    ]);
    expect(started).toEqual([]);
  });

  it('recognises an installed engine on a Windows path', async () => {
    const serverEntry = 'C:\\work\\.factory\\node_modules\\software-factory\\view\\.output\\server\\index.mjs';
    const { run, errors } = getHarness({ built: false, serverEntry });

    await run();

    expect(errors[0]).toMatch(/^The factory dashboard is missing from the installed engine/);
  });

  it('exits 2 and says how to build the view when a checkout of the factory has not built it', async () => {
    const { run, started, errors } = getHarness({ built: false });

    expect(await run()).toBe(2);
    expect(errors).toEqual(['The factory view is not built (/pkg/view/.output/server/index.mjs is missing). Run: pnpm build:view']);
    expect(started).toEqual([]);
  });
});

describe('the dashboard port check', () => {
  it('skips a port another process listens on and returns the next one', async () => {
    const held = await holdPort();
    const port = portOf(held);

    const found = await firstFreePort({ from: port, to: port + 9, isFree: isPortFree });
    await release(held);

    expect(found).toBe(port + 1);
  });

  it('treats a port it cannot listen on at all as taken', async () => {
    expect(await isPortFree(70_000)).toBe(false);
  });

  it('finds no port when every port in the range is taken', async () => {
    expect(await firstFreePort({ from: 4790, to: 4799, isFree: async () => false })).toBeUndefined();
  });
});

describe('waiting for the dashboard to listen', () => {
  it('reports a port that accepts connections as listening', async () => {
    const held = await holdPort();

    const listening = await waitUntilListening({ port: portOf(held), timeoutMs: 1_000 });
    await release(held);

    expect(listening).toBe(true);
  });

  it('waits for a dashboard that starts listening a moment later', async () => {
    const held = await holdPort();
    const port = portOf(held);
    await release(held);

    const listening = waitUntilListening({ port, timeoutMs: 3_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const late = await holdPort(port);

    expect(await listening).toBe(true);
    await release(late);
  });

  it('leaves no connection open to the dashboard once it sees it listening', async () => {
    const held = await holdPort();
    const closed = new Promise<string>((resolve) => held.once('connection', (socket) => socket.once('close', () => resolve('closed'))));

    await waitUntilListening({ port: portOf(held), timeoutMs: 1_000 });
    const outcome = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve('still open'), 1_000))]);
    await release(held);

    expect(outcome).toBe('closed');
  });

  it('gives up when nothing listens before the timeout', async () => {
    const held = await holdPort();
    const port = portOf(held);
    await release(held);

    expect(await waitUntilListening({ port, timeoutMs: 300 })).toBe(false);
  });
});
