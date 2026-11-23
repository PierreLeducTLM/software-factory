# Design

## Context

`src/cli/view-command.ts` spawns `node view/.output/server/index.mjs` as a child process with `stdio: 'inherit'`, passes the port and host through the environment, prints the URL straight after spawning, and resolves with the child's exit code. The parent installs no signal handlers.

What this was checked against on 2026-11-23, engine 0.2.5, macOS, Node 22:

- Ctrl+C sends SIGINT to the whole foreground process group, so both processes stop. The Nitro server handles SIGINT and SIGTERM itself, with a graceful close of up to 5 seconds.
- `kill -TERM <factory view pid>` ends the parent at once. The server child moves under PID 1 and keeps listening on the port. `kill -9` does the same.
- A second `factory view` on a taken port prints the URL line, then `[nitro] Failed to start server: Error: listen EADDRINUSE ...` with a stack trace, and keeps running without serving.
- Importing `view/.output/server/index.mjs` in the same process, with `PORT`, `HOST`, `NITRO_HOST` and `FACTORY_VIEW_SAMPLE` set in `process.env` first, starts the dashboard (HTTP 200). SIGTERM then closes it gracefully and the process exits with code 0. With the port taken, the in-process server also logs `EADDRINUSE` and the process stays alive, so a taken port needs its own check whichever way the server runs.

See proposal.md for why this matters.

## Goals / Non-Goals

**Goals:**

- No dashboard server outlives `factory view`, however `factory view` ends.
- A taken port moves the dashboard to the next free port, and the printed URL names the port actually used.

**Non-Goals:**

- Finding or stopping servers already left behind by older engines.
- Any change to the dashboard (`view/`) or its built output.

## Approach

Run the dashboard server inside the `factory view` process instead of spawning a child. `factory view` sets the dashboard's environment on its own process and imports the server entry. With one process, every way of ending `factory view` ends the server too, `kill -9` included, and the exit code is the process's own.

Before importing the server, `factory view` binds a probe socket to 127.0.0.1 at the requested port and closes it. When the bind fails with `EADDRINUSE` on the default port, it probes the next port up, and so on, until one binds, stopping after 4799 with an error and exit code 1 (D-002, D-004). On a port given with `--port`, it writes the taken-port error instead and exits with code 1 without importing the server (D-003). With a free port found, it imports the server with that port, waits until the port accepts a connection, and prints the URL line with that port.

The startup seam in `view-command.ts` changes from `spawn` to injected functions that check the port, start the server and wait for it to listen. That keeps `tests/view-command.test.ts` free of real sockets, except for one test that probes a port it holds itself and gets the next one.

Alternatives considered:

- **Keep the child, forward SIGTERM and SIGHUP to it.** This fixes the reported case but not `kill -9`, and the parent still needs exit-code plumbing.
- **Keep the child, give it an IPC channel and a small wrapper that exits when the channel disconnects.** This covers `kill -9` but adds a second entry file and still has two processes for no benefit.

## Risks / Trade-offs

- [The server entry may read its configuration when it is imported, not when the process starts] → The environment is set before the dynamic import, which was checked to work with the current Nitro build. A test that starts the real built dashboard on a free port and stops it guards against a Nitro upgrade breaking this.
- [Probe then listen leaves a short window in which another process can take the port] → Acceptable for a local developer tool. If it happens, the Nitro error appears as it does today, and after 10 seconds `factory view` exits with code 1 and `The factory dashboard did not start on port <port>.` instead of hanging (D-006).
- [Setting `process.env` in place goes against the repository's immutability rule] → It happens once, at the CLI edge in `bin.ts` or the start function it injects, never inside the command logic.

## Open Questions

None.

## Decisions

### D-001: A forced kill also frees the port

- **Question:** Must a forced kill (`kill -9`) of `factory view` also free the dashboard port, or only Ctrl+C, SIGTERM and a closed terminal?
- **Decision:** Yes. Every way of ending `factory view`, SIGKILL included, leaves nothing listening on the port within 5 seconds.
- **Effect:** The "Forced kill" scenario states its outcome. Task 1.3 tests SIGKILL. This rules out the signal-forwarding alternative and favours running the server inside the `factory view` process.

### D-002: A taken port moves the dashboard to the next free port

- **Question:** When the dashboard port is taken, what exit code and message does `factory view` give?
- **Decision:** It gives no error. It tries the next port up and starts the dashboard on the first free one.
- **Effect:** The requirement "A taken dashboard port stops factory view" becomes "A taken port moves the dashboard to the next free port", and the printed URL names the port actually used. "Choosing a free port automatically" is no longer a non-goal. Whether an explicit `--port` also moves is D-003.

### D-003: An explicit port is used as given

- **Question:** When a port is given with `--port` and it is taken, does `factory view` also move to the next free port?
- **Decision:** No. Only the default port 4790 moves. A taken explicit port is an error: one line on stderr naming the port, no dashboard, exit code 1.
- **Effect:** The "A taken port moves the dashboard" requirement applies only when no port was given, and a new "Explicit port taken" scenario covers the error. Task 2.3 tests it.

### D-004: Ten ports, then an error

- **Question:** When no port is given and 4790 is taken, how far up does `factory view` look, and what happens when none is free?
- **Decision:** It tries 4790 to 4799. When all ten are taken, it writes `No free port for the factory dashboard between 4790 and 4799.` to stderr, starts no dashboard, and exits with code 1.
- **Effect:** A "No free port in the range" scenario is added. Task 2.4 tests it.

### D-005: Taken-port messages point at the leftover process

- **Question:** Does `factory view` say that the default port was taken, and what does the error for a taken explicit `--port` say?
- **Decision:** When the default port moves, one line goes to stderr before the URL: `Port 4790 is in use, possibly by a factory view that was not stopped (lsof -iTCP:4790 -sTCP:LISTEN shows which process). Using <port>.` When an explicit port is taken, the error is `Port <port> is in use (lsof -iTCP:<port> -sTCP:LISTEN shows which process). Choose another with --port <number>.`
- **Effect:** The notice names 4790 and the port actually used, once, however many ports were skipped. Both lines show the `lsof` command that finds the process holding the port. Tasks 2.1 and 2.3 assert the exact text.

### D-006: Ten seconds to start, then an error

- **Question:** If the dashboard never starts listening after the port check passed, how long does `factory view` wait, and what does it say?
- **Decision:** It waits 10 seconds. Then it writes `The factory dashboard did not start on port <port>.` to stderr, prints no URL line, and exits with code 1.
- **Effect:** The requirement "The URL is printed once the dashboard listens" gains a "Dashboard does not start" scenario. Task 2.2 tests it. Since the server runs in the same process, exiting also stops a server that starts late.
