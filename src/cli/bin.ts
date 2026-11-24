#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli.js';
import { createSpecFolder } from './inputs.js';
import { createRealDeps, createRealSourceControl, createSetupDeps } from './real-deps.js';
import { setupCommand } from './setup-command.js';
import { viewCommand } from './view-command.js';
import { isPortFree, startDashboard, untilStopped, waitUntilListening } from './view-server.js';

const [command, ...rest] = process.argv.slice(2);
const SETUP_COMMANDS = ['doctor', 'migrate', 'init', 'workflow'];

process.exitCode =
  SETUP_COMMANDS.includes(command ?? '')
    ? await setupCommand({
        argv: process.argv.slice(2),
        deps: async () => createSetupDeps({ cwd: process.cwd(), env: process.env }),
        write: (line) => console.log(line),
        writeError: (line) => console.error(line),
      })
    : command === 'view'
    ? process.exit(
        await viewCommand({
          argv: rest,
          cwd: process.cwd(),
          serverEntry: fileURLToPath(new URL('../../view/.output/server/index.mjs', import.meta.url)),
          exists: existsSync,
          isPortFree,
          startServer: startDashboard,
          waitUntilListening,
          untilStopped,
          write: (line) => console.log(line),
          writeError: (line) => console.error(line),
        }),
      )
    : await runCli({
  argv: process.argv.slice(2),
  deps: () => createRealDeps({ cwd: process.cwd(), env: process.env }),
  sourceControl: () => createRealSourceControl({ cwd: process.cwd(), env: process.env }),
  folder: createSpecFolder(),
  readFile: (path) => readFile(path, 'utf8'),
  write: (line) => console.log(line),
  writeError: (line) => console.error(line),
});
