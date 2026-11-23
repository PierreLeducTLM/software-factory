# Design

## Context

`columnOf` in `src/view/model.ts` places only `ready_for_dev` and later states on the board. A `spec_review` ticket goes to the Needs you column only when it was sent back. `buildNeedsYou` lists more categories (approve, merge, not started, run limit) than the board's Needs you column. The store already reads tickets in every mapped status, `to_refine` included.

`to_refine` is often mapped to a wide status such as Backlog, which can hold many tickets that will never go through the factory.

## Approach

Add two columns at the front of `COLUMNS`: Available and Refining. `columnOf` places a "to refine" ticket that carries the available label in Available (D-001, D-002), and places every "spec review" ticket in Refining (D-003). The Needs you column is no longer filled by `columnOf`. `buildBoard` fills it from the same reasons that `buildNeedsYou` uses, so the column, the page and the header always count the same tickets (D-004). A Refining card's note comes from the record (send-back, then ready gate). An Available card has no record yet, so it shows a fixed note (D-005).

The view still reads only from the ticket provider. The store already searches every mapped status, "to refine" included, and the search results already carry labels.

## Open Questions

None.

## Decisions

### D-001: Which "to refine" tickets appear on the board

- **Question:** Which "to refine" tickets does the board show: every one, only those with a factory record, or only those with spec files attached? With Backlog as "to refine", showing every one floods the column.
- **Decision:** Only "to refine" tickets carrying the available label. The label is a new config key `labels.available`, and it defaults to `factory-available`, so an existing `.factory/config.yaml` without the key still loads. `factory init` writes it next to the other labels.
- **Effect:** `FactoryConfigSchema` gains `labels.available` with a default, and the install defaults gain `available: factory-available`. `columnOf` places a `to_refine` ticket on the board only when `ticket.labels` includes `config.labels.available`. The store's search already returns labels, so no adapter changes.

### D-002: The first column is "Available"

- **Question:** What does the new first column mean, and what is it called?
- **Decision:** The column is named "Available", with the id `available`. It holds the tickets that are allowed to go through the factory, meaning the "to refine" tickets carrying the available label (D-001). It comes first, before Ready.
- **Effect:** `ColumnId` gains `available`, and `COLUMNS` starts with `{ id: 'available', name: 'Available' }`. Proposal, delta spec and tasks say "Available" instead of "Refine".

### D-003: Spec Review tickets sit in a "Refining" column

- **Question:** Where do "spec review" tickets go on the board?
- **Decision:** In their own column, "Refining" (id `refining`), between Available and Ready. Every "spec review" ticket appears there, labelled or not. Its note comes from the record, checked in this order: "Sent back · N questions" when the record has a send-back, "Gate passed, waiting for approval" when the recorded ready gate passed, "Gate failed" when it failed, and otherwise "Refining". Every Refining card offers `/factory-refine KEY`.
- **Effect:** The columns are Available, Refining, Ready, Revalidate, Build, Review, Pull request, Needs you, Done. `columnOf` places `spec_review` in `refining`. A sent-back ticket now shows in Refining, not only in Needs you (see D-004 for the Needs you column).

### D-004: The Needs you column mirrors the Needs you page

- **Questions:** When a ticket is in a station column and also needs a person, where is it shown? Does the Needs you column list every category the Needs you page lists, or only some?
- **Decision:** The Needs you column shows one card per item on the Needs you page, in the page's order. A ticket keeps its station card as well, so it can appear twice: an approval-waiting or sent-back ticket in Refining and Needs you, a PR waiting for a person in Pull request and Needs you, an unlabelled ticket past the not-started age in Ready and Needs you, an interrupted run in its step's column and Needs you, a revert in Done and Needs you. A Needs you card's note is the page item's reason, and its command is the page item's command. The column's count equals the page's count and the header's count.
- **Effect:** `buildBoard` fills the `needs_you` column from the same reasons as `buildNeedsYou`, not from `columnOf`. `columnOf` no longer returns `needs_you`, and a Blocked ticket appears only in Needs you, since it has no station column.



### D-005: What an Available card shows

- **Question:** What note and command does an Available card show?
- **Decision:** The note "Available for refinement" and the command `/factory-refine KEY`. The card shows no risk, run or attempt rows, because the ticket has no factory record yet. If the ticket has no draft spec attached, `/factory-refine` refuses it with `no_spec`, which is how a person finds out.
- **Effect:** `noteFor` and `commandFor` gain the `available` case.

