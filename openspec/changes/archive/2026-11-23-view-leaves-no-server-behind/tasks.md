# Tasks

## 1. One process for factory view

- [ ] 1.1 `factory view` starts the dashboard server inside its own process with the same port, host, project directory and sample environment as today, and no longer spawns a child. Verified by `tests/view-command.test.ts` tests that the injected start function receives the port, `127.0.0.1`, the project directory and the sample flag, and that `--port` usage errors and the missing-dashboard messages are unchanged.
- [ ] 1.2 Sent SIGTERM to its own process ID, `factory view` exits with code 0 and nothing listens on its port within 5 seconds. Verified by a test that starts `factory view --port <free port>` as a real process with the committed built dashboard, waits for the URL line, sends SIGTERM to that process ID only, and checks that the port accepts no connection within 5 seconds.
- [ ] 1.3 A forced kill (SIGKILL) of `factory view` leaves nothing listening on the port within 5 seconds (D-001). Verified by the test of 1.2 run with SIGKILL.
- [ ] 1.4 Ctrl+C (SIGINT) and a closed terminal (SIGHUP) end `factory view` and leave nothing listening on the port within 5 seconds, and SIGINT exits with code 0. Verified by the test of 1.2 run with SIGINT and with SIGHUP.

## 2. Taken port

- [ ] 2.1 When no port was given and 4790 is in use on 127.0.0.1, `factory view` writes the D-005 notice naming 4790 and the port used, starts the dashboard on the next free port up, prints the URL with that port and no stack trace, and leaves the process holding the taken port running (D-002, D-005). Verified by `tests/view-command.test.ts` tests whose port check reports 4790, or 4790 and 4791, as taken, and by one test that holds a real socket on a port and checks that the port check returns the next one.
- [ ] 2.2 When the server is not listening 10 seconds after it was started, `factory view` writes `The factory dashboard did not start on port <port>.` to stderr, prints no URL, and exits with code 1 (D-006). Verified by a `tests/view-command.test.ts` test whose wait function reports a timeout.
- [ ] 2.3 When a port given with `--port` is in use, `factory view` writes `Port 5005 is in use (lsof -iTCP:5005 -sTCP:LISTEN shows which process). Choose another with --port <number>.` to stderr, prints no URL, starts no server, and exits with code 1 (D-003, D-005). Verified by a `tests/view-command.test.ts` test with `--port 5005` whose port check reports 5005 as taken, asserting that the start function is never called.
- [ ] 2.4 When no port was given and 4790 to 4799 are all in use, `factory view` writes `No free port for the factory dashboard between 4790 and 4799.` to stderr, prints no URL, starts no server, and exits with code 1 (D-004). Verified by a `tests/view-command.test.ts` test whose port check reports all ten ports as taken, asserting that 4800 is never checked and the start function is never called.

## 3. URL line

- [ ] 3.1 The `Factory view: http://127.0.0.1:<port> (read-only, press Ctrl+C to stop)` line is printed only after the server listens. Verified by a `tests/view-command.test.ts` test that nothing is written before the wait function resolves and the line is written after it.

## 4. Docs

- [ ] 4.1 The README section on `factory view` says that when port 4790 is taken, the dashboard starts on the next free port and the printed URL names it (D-002). Verified by reading the README diff in the pull request.
