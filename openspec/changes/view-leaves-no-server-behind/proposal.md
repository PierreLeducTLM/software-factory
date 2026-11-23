# Stopping factory view leaves no dashboard server behind

## Why

`factory view` starts the dashboard server as a separate child process. Ctrl+C reaches both processes, so it works. But when only the `factory view` process is ended, for example by `kill <pid>`, by a tool that stops the process it started, or by `kill -9`, the child moves under PID 1 and keeps serving on port 4790. Nothing tells the developer about it. The next `factory view` then prints the dashboard URL as if it had started, prints a Nitro `EADDRINUSE` stack trace, and keeps running without serving anything. The URL it printed now shows the leftover server, which can be running an older engine and an older project directory. We hit this while dogfooding (PIE-15).

## What Changes

- Ending the `factory view` process in any way leaves no process listening on the dashboard port.
- When the default port 4790 is already in use, `factory view` says so in one line and starts the dashboard on the next free port up to 4799, instead of printing the URL, a stack trace and then hanging. A taken port given with `--port`, or no free port in 4790 to 4799, is a one-line error with exit code 1.
- When the dashboard does not start listening within 10 seconds, `factory view` exits with an error instead of hanging.
- The URL line is printed only once the dashboard is actually listening.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-view`: adds requirements on how the dashboard process stops, and on what `factory view` does when its port is taken. They are written as ADDED requirements, because the v1 `factory-view` spec is not yet archived into `openspec/specs/`.

## Impact

- `src/cli/view-command.ts` and its wiring in `src/cli/bin.ts`: how the dashboard server is started and stopped.
- `tests/view-command.test.ts`: the current tests use a fake `spawn` and need to change with the startup seam.
- README section on `factory view`: the dashboard can start on a port other than 4790.
- No change to the dashboard itself (`view/`) or to its built output.

## Affected paths

- src/cli/view-command.ts
- src/cli/bin.ts
- tests/view-command.test.ts
- README.md
- openspec/changes/view-leaves-no-server-behind/**
