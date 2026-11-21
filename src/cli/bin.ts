#!/usr/bin/env node
import { runCli } from './cli.js';
import { createRealDeps } from './real-deps.js';

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  deps: () => createRealDeps({ cwd: process.cwd(), env: process.env }),
  write: (line) => console.log(line),
  writeError: (line) => console.error(line),
});
