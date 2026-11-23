# Design

## Context

In `upgradeProject` (`src/setup/upgrade.ts`), `moving` is false when the schema is current and `enginePinMatches(pin.engine, engine)` holds. `enginePinMatches` compares major and minor only. When not moving, the target engine is the pinned one, so neither the pin nor `.factory/package.json` change.

`enginePinMatches` also decides whether an engine may run a project at all (`enginePinMessage`). That rule is right: patches are compatible. Only migrate's decision to move the pin is wrong.

`runDoctor` (`src/setup/doctor.ts`) flags the engine only when `enginePinMatches` fails, so it says nothing about a newer patch. Every doctor finding fails the report. Doctor has no non-failing output today.

## Approach

Migrate moves the pin whenever the running engine is newer than the pin, including a newer patch. Running a project on a compatible patch stays allowed. Migrate run by an older patch keeps answering "Nothing to upgrade" (D-004).

Doctor gains a non-failing note, printed only in its text output, when the running engine is a newer patch of the pinned release (D-002, D-003). `enginePinMatches` and `enginePinMessage` do not change.

The existing test "does nothing for a project already on this engine release and schema" (`tests/setup-upgrade.test.ts`, pin 0.1.2, engine 0.1.7) asserts the behaviour this change fixes. Its expectation is replaced by a same-patch case.

## Open Questions

None.

## Decisions

### D-001: Pull request text for a patch move
- **Question:** What is the pull request title and body for a patch move: the existing upgrade text, or a shorter patch text?
- **Decision:** Reuse the existing upgrade text. The title is `chore: upgrade the factory engine to <engine>`, and the body starts "Moves this project from factory engine <pin> to <engine>.", followed by the schema line, the updated engine files and "Nothing changes until this pull request is merged".
- **Effect:** The "Newer patch" scenario states the title and the first body line. Task 1 checks both. No new text is added.

### D-002: Doctor reports a newer patch, without failing
- **Question:** Should `factory doctor` report that a newer patch is available, or stay silent as it does today? If it reports it, does a newer patch count as drift?
- **Decision:** Doctor reports it as a non-failing note. A newer patch is not drift: on its own it leaves the report passing ("No drift found", `ok` true). It does not change the existing check that flags a different release.
- **Effect:** A new doctor requirement with scenarios. `src/setup/doctor.ts` and `src/cli/setup-command.ts` join the affected paths. A new task covers the note.

### D-003: Where the doctor note appears
- **Question:** How does doctor's non-failing note appear in the text and `--json` output?
- **Decision:** In the text output only. After the usual first line ("No drift found", or "Drift found:" followed by the list), doctor prints `Notes:` and then `- Engine <running> is a newer patch than the <pinned> pinned in .factory/factory.yaml. Run "factory migrate" to move the project to it`. The `Notes:` block appears only when there is a note. `--json` output does not change: no `notes` field, and `ok` ignores the note. The note appears only when the running engine is a newer patch of the pinned release. A same or older patch adds nothing.
- **Effect:** The doctor requirement's scenarios state the exact text, that it is absent from `--json`, and that it is absent for a same or older patch.

### D-004: Migrate run by an older patch than the pin
- **Question:** When the running engine is an older patch than the pin (pin 0.2.4, engine 0.2.3), does migrate answer "Nothing to upgrade" as today, or refuse as it does for an older release?
- **Decision:** It answers "Nothing to upgrade" as today, opens nothing and never moves the pin backwards.
- **Effect:** An "Older patch" scenario with the exact message. Task 3 verifies it.
