# Spec Delta

## ADDED Requirements

### Requirement: The dashboard stops with factory view
When the `factory view` process ends, for any reason, no process started by it SHALL keep running, and nothing SHALL keep listening on the dashboard port because of it. This SHALL hold for Ctrl+C, for a termination signal sent to the `factory view` process alone, for the terminal being closed, and for a forced kill (`kill -9`). The port SHALL be free again within 5 seconds of the signal. Stopped by Ctrl+C or a termination signal, `factory view` SHALL exit with code 0.

#### Scenario: Ctrl+C
- **WHEN** a developer runs `factory view` and presses Ctrl+C
- **THEN** `factory view` exits with code 0, and within 5 seconds nothing listens on 127.0.0.1:4790

#### Scenario: Termination signal to factory view alone
- **WHEN** `factory view` is serving on port 4790 and a tool sends SIGTERM to the `factory view` process ID only
- **THEN** `factory view` exits with code 0, within 5 seconds nothing listens on 127.0.0.1:4790, and no dashboard server process is left under PID 1

#### Scenario: Terminal closed
- **WHEN** `factory view` is serving and the terminal it runs in is closed
- **THEN** within 5 seconds nothing listens on the dashboard port

#### Scenario: Forced kill
- **WHEN** `factory view` is serving on port 4790 and its process ID receives SIGKILL
- **THEN** within 5 seconds nothing listens on 127.0.0.1:4790, and no dashboard server process is left under PID 1

### Requirement: A taken port moves the dashboard to the next free port
Before it starts the dashboard, `factory view` SHALL check that it can listen on 127.0.0.1 at the requested port. When no port was given and the default port 4790 is in use, it SHALL try the next port up, one at a time, up to 4799, and start the dashboard on the first free one. Before the URL line, it SHALL write one line to stderr: `Port 4790 is in use, possibly by a factory view that was not stopped (lsof -iTCP:4790 -sTCP:LISTEN shows which process). Using <port>.`, where `<port>` is the port it uses. When 4790 to 4799 are all in use, it SHALL write `No free port for the factory dashboard between 4790 and 4799.` to stderr, start no dashboard, and exit with code 1. It SHALL leave the process holding the taken port running, print no stack trace, and print the URL with the port it actually uses. A port given with `--port` SHALL be used as given: when it is in use, `factory view` SHALL write `Port <port> is in use (lsof -iTCP:<port> -sTCP:LISTEN shows which process). Choose another with --port <number>.` to stderr, start no dashboard, and exit with code 1.

#### Scenario: Default port held by a leftover dashboard
- **WHEN** another process already listens on 127.0.0.1:4790, port 4791 is free, and a developer runs `factory view`
- **THEN** `factory view` writes `Port 4790 is in use, possibly by a factory view that was not stopped (lsof -iTCP:4790 -sTCP:LISTEN shows which process). Using 4791.` to stderr, the dashboard starts on port 4791, `factory view` prints `Factory view: http://127.0.0.1:4791 (read-only, press Ctrl+C to stop)`, and the other process keeps running

#### Scenario: Several ports taken
- **WHEN** other processes listen on 127.0.0.1:4790 and 127.0.0.1:4791, port 4792 is free, and a developer runs `factory view`
- **THEN** `factory view` writes one notice ending `Using 4792.`, the dashboard starts on port 4792, and the printed URL names port 4792

#### Scenario: No free port in the range
- **WHEN** other processes listen on every port from 127.0.0.1:4790 to 127.0.0.1:4799 and a developer runs `factory view`
- **THEN** `factory view` writes `No free port for the factory dashboard between 4790 and 4799.` to stderr, prints no URL line, starts no dashboard, and exits with code 1

#### Scenario: Explicit port taken
- **WHEN** another process listens on 127.0.0.1:5005 and a developer runs `factory view --port 5005`
- **THEN** `factory view` writes `Port 5005 is in use (lsof -iTCP:5005 -sTCP:LISTEN shows which process). Choose another with --port <number>.` to stderr, prints no "Factory view:" URL line and no stack trace, starts no dashboard, leaves the other process running, and exits with code 1

#### Scenario: Requested port is free
- **WHEN** port 5005 is free and a developer runs `factory view --port 5005`
- **THEN** the dashboard starts on port 5005 and `factory view` prints `Factory view: http://127.0.0.1:5005 (read-only, press Ctrl+C to stop)`

### Requirement: The URL is printed once the dashboard listens
`factory view` SHALL print `Factory view: http://127.0.0.1:<port> (read-only, press Ctrl+C to stop)` only after the dashboard is listening on that port, so that the printed URL always points at the dashboard this command started. When the dashboard is not listening 10 seconds after `factory view` started it, `factory view` SHALL write `The factory dashboard did not start on port <port>.` to stderr, print no URL line, and exit with code 1, leaving nothing listening because of it.

#### Scenario: Normal start
- **WHEN** a developer runs `factory view` and port 4790 is free
- **THEN** the "Factory view:" line appears, and a request to http://127.0.0.1:4790 made after it appears gets an answer from the dashboard started by this command

#### Scenario: Dashboard does not start
- **WHEN** the port check passed for port 4790 but the dashboard is still not listening on it 10 seconds later
- **THEN** `factory view` writes `The factory dashboard did not start on port 4790.` to stderr, prints no "Factory view:" line, and exits with code 1
