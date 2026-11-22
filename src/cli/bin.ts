#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli.js';
import { createSpecFolder } from './inputs.js';
import { createRealDeps, createSetupDeps } from './real-deps.js';
import { setupCommand } from './setup-command.js';
import { viewCommand } from './view-command.js';

const [command, ...rest] = process.argv.slice(2);
const SETUP_COMMANDS = ['doctor', 'migrate'];

process.exitCode =
  SETUP_COMMANDS.includes(command ?? '')
    ? await setupCommand({
        argv: process.argv.slice(2),
        deps: async () => createSetupDeps({ cwd: process.cwd(), env: process.env }),
        write: (line) => console.log(line),
        writeError: (line) => console.error(line),
      })
    : command === 'view'
    ? await viewCommand({
        argv: rest,
        cwd: process.cwd(),
        env: process.env,
        serverEntry: fileURLToPath(new URL('../../view/.output/server/index.mjs', import.meta.url)),
        exists: existsSync,
        spawn,
        write: (line) => console.log(line),
        writeError: (line) => console.error(line),
      })
    : await runCli({
  argv: process.argv.slice(2),
  deps: () => createRealDeps({ cwd: process.cwd(), env: process.env }),
  folder: createSpecFolder(),
  readFile: (path) => readFile(path, 'utf8'),
  write: (line) => console.log(line),
  writeError: (line) => console.error(line),
});
