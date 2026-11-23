# Dashboard shows tickets that are available or being refined

## Why

The board starts at Ready, so a ticket on its way into the factory shows nowhere on it. A "to refine" ticket meant for the factory appears neither on the board nor in Needs you. A "spec review" ticket waiting for approval appears only on the Needs you page, while the board's Needs you column says "Nothing here". Ticket: PIE-9.

## What changes

- A new label, `factory-available` (config key `labels.available`), marks a "to refine" ticket as allowed to go through the factory. Existing configs default to it.
- An **Available** column comes first on the board. It holds the "to refine" tickets carrying the available label, each with the note "Available for refinement" and `/factory-refine KEY`.
- A **Refining** column comes next, before Ready. It holds every "spec review" ticket, with a note saying where refinement stands and `/factory-refine KEY`.
- The board's Needs you column mirrors the Needs you page: the same items, in the same order, with the same reasons and commands. A ticket can appear both in its station column and in Needs you.
- The column list in the v1 requirement "Board shows one column per station" is replaced by the new requirement "Board column order". It is written as an added requirement, because the v1 factory-view spec is not archived yet.

## Affected paths

- src/view/model.ts
- src/view/demo.ts
- src/config/project-config.ts
- src/setup/install.ts
- view/src/**
- tests/**
- README.md
