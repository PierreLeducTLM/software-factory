#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runCli } from './cli.js';
import { createSpecFolder } from './inputs.js';
import { createRealDeps } from './real-deps.js';

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  deps: () => createRealDeps({ cwd: process.cwd(), env: process.env }),
  folder: createSpecFolder(),
  readFile: (path) => readFile(path, 'utf8'),
  write: (line) => console.log(line),
  writeError: (line) => console.error(line),
});
