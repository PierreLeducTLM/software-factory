# Tasks

- [ ] 1. The project config has `labels.available`, defaulting to `factory-available`, and `factory init` writes it. Verified by tests in `tests/project-config.test.ts` and `tests/setup-install.test.ts`.
- [ ] 2. The Board's columns read Available, Refining, Ready, Revalidate, Build, Review, Pull request, Needs you, Done. Verified by a test of `buildBoard` in `tests/view-model.test.ts`.
- [ ] 3. A "to refine" ticket with the available label shows in Available with "Available for refinement" and `/factory-refine KEY`, and one without the label shows nowhere. Verified by tests of `buildBoard`.
- [ ] 4. Every "spec review" ticket shows in Refining with the note for its state (sent back, gate passed, gate failed, refining) and `/factory-refine KEY`. Verified by one `buildBoard` test per note.
- [ ] 5. The Needs you column holds exactly the Needs you page's items, in the page's order, with their reasons and commands, while the tickets keep their station cards. Verified by `buildBoard` tests comparing the column with `buildNeedsYou`, including approval, merge and Blocked cases.
- [ ] 6. The board UI renders the two new columns and gives Available and Refining cards a status dot, and Needs you cards keep the fail tone for Blocked, run-limit and revert items. Verified by tests in `view/src/components/Board.test.tsx`.
- [ ] 7. The demo data includes an Available ticket and a Refining ticket. Verified by `tests/view-demo.test.ts`.
- [ ] 8. The README documents the `factory-available` label next to the other two. Verified by reading the README section on labels in the pull request review.
