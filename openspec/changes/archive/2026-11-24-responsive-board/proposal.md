# Proposal

## Why

PIE-22 says the dashboard is hard to read: the Board gives no overview, its many columns force scrolling, and the card detail behaves oddly on small screens. Measured with the sample data, the page is 2,092px wide at every screen size, so at 1440px only five and a half of the nine columns show and Needs you, the one column that asks for action, is off-screen. Cards grow a row per attempt, with four gate chips that wrap onto two lines. The run detail panel is a block next to the board: on a wide screen it squeezes the board, and below about 1,180px it wraps under the whole board, about 2,000px down, so clicking a card seems to do nothing.

## What Changes

- A Needs you strip above the Board lists the tickets that need a person, with the key and reason of each, up to two lines, then "+N more" linking to the Needs you page. Each item opens that card. The strip is hidden when nothing needs a person, and on a phone it shows only the count and links to the Needs you page (D-001, D-002).
- Cards are compact: only the latest attempt's gate chips, on one line, with "+N earlier attempts"; the provider name only when the Board reads from more than one provider; the risk badge reads "Low", "Medium" or "High". This replaces the card contents set by "Board shows one column per station" (last two attempts, key and provider) (D-003).
- The Board fits the screen: at 1280px and wider all nine columns show with no sideways scroll, and an empty column shrinks to a narrow strip with its name and count. From 720px to 1279px only the Board scrolls sideways, snapping to columns. Below 720px the columns stack top to bottom. The page never scrolls sideways (D-004).
- The run detail becomes a drawer over the right side of the Board, below the header so the status line and Force refresh stay usable, and full screen below 720px. The Board does not reflow under it, the drawer scrolls on its own, Escape or the close button closes it, and focus returns to the card. It is not modal: another card can be clicked while it is open (D-005, D-007).
- The open card is in the Board's address as `?card=KEY&column=ID`: the browser's back button closes the drawer, and reloading or sharing the address reopens the same card, even for a ticket shown both in its station and in Needs you (D-006, D-008).
- Opening, switching and closing the drawer never move the page; a fresh load starts at the top (D-009).
- Unchanged: the column order, the colours and fonts, the Needs you page, and every command and button in the detail panel.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `factory-view`: adds the requirements "Needs you strip above the Board", "Cards show the latest attempt", "The Board fits the screen", "Run detail opens as a drawer", "The open card is in the address" and "Opening and closing the drawer keeps the page's scroll".

## Impact

- Dashboard UI: `view/src/components/Board.tsx`, `BoardScreen.tsx`, `RunDetailPanel.tsx`, a new Needs you strip component, `view/src/routes/index.tsx` (the `card` and `column` search parameters), `view/src/router.tsx` (scroll on drawer navigation), `view/src/styles.css`.
- View model: `src/view/model.ts` keeps one attempt row per card instead of two.
- Tests: `view/src/components/Board.test.tsx`, a new browser test for the strip and drawer, `tests/view-model.test.ts`.
- The committed dashboard build `view/.output/` is rebuilt.
- No change to the ticket providers, the CLI, the factory comment or the Needs you page.
