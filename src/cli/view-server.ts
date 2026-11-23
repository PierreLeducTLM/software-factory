import { createConnection, createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import type { Dashboard } from './view-command.js';

const LOCAL_ONLY = '127.0.0.1';
const POLL_MS = 100;

export const isPortFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    try {
      probe.listen({ port, host: LOCAL_ONLY });
    } catch {
      resolve(false);
    }
  });

const accepts = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: LOCAL_ONLY });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const listeningBy = async (port: number, deadline: number): Promise<boolean> => {
  if (await accepts(port)) return true;
  if (Date.now() >= deadline) return false;
  await pause(POLL_MS);
  return listeningBy(port, deadline);
};

export const waitUntilListening = ({ port, timeoutMs }: { readonly port: number; readonly timeoutMs: number }): Promise<boolean> =>
  listeningBy(port, Date.now() + timeoutMs);

export const startDashboard = async ({ entry, port, host, projectDir, sample }: Dashboard): Promise<void> => {
  Object.assign(process.env, {
    FACTORY_PROJECT_DIR: projectDir,
    PORT: String(port),
    HOST: host,
    NITRO_HOST: host,
    ...(sample ? { FACTORY_VIEW_SAMPLE: '1' } : {}),
  });
  await import(pathToFileURL(entry).href);
};

export const untilStopped = (): Promise<void> =>
  new Promise((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
