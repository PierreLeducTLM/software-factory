import { type ChildProcess, spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const URL_LINE = /^Factory view: http:\/\/127\.0\.0\.1:(\d+) /m;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });

const accepts = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

const freedWithin = async (port: number, deadline: number): Promise<boolean> =>
  !(await accepts(port)) || (Date.now() < deadline && (await new Promise((resolve) => setTimeout(resolve, 100)), freedWithin(port, deadline)));

const startView = (port: number): ChildProcess =>
  spawn(process.execPath, ['--import', join(ROOT, 'tests', 'support', 'run-source.ts'), join(ROOT, 'src', 'cli', 'bin.ts'), 'view', '--sample', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const urlLine = (view: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    const seen: string[] = [];
    view.stdout?.on('data', (chunk: Buffer) => {
      seen.push(chunk.toString());
      const match = URL_LINE.exec(seen.join(''));
      if (match) resolve(Number(match[1]));
    });
    view.once('exit', (code) => reject(new Error(`factory view ended with ${String(code)} before printing its URL: ${seen.join('')}`)));
  });

const ended = (view: ChildProcess): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> =>
  new Promise((resolve) => view.once('exit', (code, signal) => resolve({ code, signal })));

describe('stopping factory view', () => {
  it.each([
    ['SIGTERM', 0],
    ['SIGINT', 0],
    ['SIGHUP', undefined],
    ['SIGKILL', undefined],
  ] as const)('leaves nothing listening on its port within 5 seconds when its process alone gets %s', async (signal, exitCode) => {
    const port = await freePort();
    const view = startView(port);
    const exit = ended(view);

    expect(await urlLine(view)).toBe(port);
    expect(await accepts(port)).toBe(true);

    view.kill(signal);
    const outcome = await exit;

    expect(await freedWithin(port, Date.now() + 5_000)).toBe(true);
    if (exitCode !== undefined) expect(outcome).toEqual({ code: exitCode, signal: null });
  }, 30_000);
});
