# Tasks

## 1. Compact cards

- [x] 1.1 The view model keeps only the latest attempt row per card and counts the others as earlier attempts. Verified by a `buildBoard` test in `tests/view-model.test.ts` where a run on attempt 3 gives one row (attempt 3) and `earlierAttempts` 2.
- [x] 1.2 A card shows its chip row on one line with the letters b, g, v, r, each named with the gate and its status, and "+N earlier attempts" ("+1 earlier attempt" for one). Verified by tests in `view/src/components/Board.test.tsx`, plus a layout test at 1280px in `view/src/components/BoardLayout.test.tsx` checking the four chips share one line.
- [x] 1.3 A card shows the provider name only when the Board reads from more than one provider. Verified by two tests in `view/src/components/Board.test.tsx`, one with a single provider and one with two.
- [x] 1.4 The risk badge reads "Low", "Medium" or "High" and is named "<Level> risk (predicted)". Verified by a test in `view/src/components/Board.test.tsx`.

## 2. The Board fits the screen

- [x] 2.1 At 1440px with the sample data, all nine column headings are inside the window and neither the page nor the Board scrolls sideways. Verified by a layout test in `view/src/components/BoardLayout.test.tsx` that loads `styles.css`, sets the viewport and compares scroll widths with client widths.
- [x] 2.2 At 720px and wider, an empty column is a narrow strip showing its name and count without "Nothing here", and its heading keeps the accessible name "<Name> 0". Verified by a layout test in `view/src/components/BoardLayout.test.tsx` and the existing column-heading test in `view/src/components/Board.test.tsx`.
- [x] 2.3 At 900px the page does not scroll sideways, the Board alone does, with scroll snapping to columns, and the header and strip stay in place. Verified by a layout test in `view/src/components/BoardLayout.test.tsx`.
- [x] 2.4 At 390px the columns stack in Board column order and the page does not scroll sideways. Verified by a layout test in `view/src/components/BoardLayout.test.tsx` checking the headings' vertical order and the page's scroll width.

## 3. Needs you strip

- [x] 3.1 The strip shows "N need you" and one item per Needs you page item, in its order, with key and reason, and is absent when nothing needs a person. Verified by tests in `view/src/components/NeedsYouStrip.test.tsx`.
- [x] 3.2 When items do not fit in two lines, the strip shows the ones that fit, then "+N more" linking to the Needs you page. Verified by a test in `view/src/components/NeedsYouStrip.test.tsx` at a fixed viewport width with 8 items.
- [x] 3.3 Activating a strip item opens that ticket's Needs you card in the drawer. Verified by a test in `view/src/components/NeedsYouStrip.test.tsx`.
- [x] 3.4 Below 720px the strip shows only "N need you", linking to the Needs you page. Verified by a test in `view/src/components/NeedsYouStrip.test.tsx` at 390px.

## 4. Run detail drawer

- [x] 4.1 At 1440px, opening a card shows the run detail in a drawer at most 520px wide on the right, starting below the header, and the column headings keep their positions. Verified by a layout test in `view/src/components/BoardLayout.test.tsx` comparing heading positions before and after opening and checking that the drawer's top is at or below the header's bottom.
- [x] 4.1a With the drawer open at 1440px, the header's Force refresh button is visible and clickable, and after the page scrolls past the header the drawer's top is the top of the window. Verified by a layout test in `view/src/components/BoardLayout.test.tsx` that clicks Force refresh with the drawer open and checks the drawer's bounds after scrolling.
- [x] 4.2 With the drawer open, activating a card it does not cover shows that card in the drawer. Verified by a test in `view/src/components/Board.test.tsx`.
- [x] 4.3 At 390px, opening a card from the bottom of the Board shows a full-window drawer from its top, with the close button at the top. Verified by a layout test in `view/src/components/BoardLayout.test.tsx` checking the drawer's bounds and the close button's position.
- [x] 4.4 Opening moves focus into the drawer; Escape or the close button closes it and returns focus to the card or strip item that opened it. Verified by tests in `view/src/components/Board.test.tsx` and `view/src/components/NeedsYouStrip.test.tsx`.
- [x] 4.5 The drawer closes when a refresh removes its ticket from the Board. Verified by a test in `view/src/components/Board.test.tsx` that rerenders without the ticket.
- [x] 4.6 The drawer still shows "Copy command", "Start in Orca" and "Open in Orca" as before. Verified by the existing tests in `view/src/components/Board.test.tsx` and `view/src/components/StartInOrca.test.tsx` passing unchanged.

## 5. The open card is in the address

- [x] 5.1 Opening a card adds `card=<KEY>` and `column=<column id>` with one history entry, switching cards replaces it, back closes the drawer, and closing with Escape or the button removes `card` and `column` so back does not reopen it. Verified by tests of the Board route with a memory history in `view/src/components/Board.test.tsx`.
- [x] 5.2 Loading `/?card=<KEY>&column=<id>` opens the drawer on that ticket's card in that column when the ticket is on the Board, and shows the Board with no drawer and no error when it is not. Verified by tests in `view/src/components/Board.test.tsx`.
- [x] 5.3 For a ticket shown in its station and in Needs you, opening it from the Needs you strip and reloading reopens its Needs you card; a missing or stale `column` opens its Needs you card if it has one, otherwise its station card. Verified by tests in `view/src/components/Board.test.tsx` with a fixture ticket in both Ready and Needs you.
- [x] 5.4 Loading `/?card=<KEY>&column=<id>` starts the page at the top; opening, switching and closing the drawer with the close button, Escape or back leave the page's scroll where the person put it. Verified by layout tests of the Board route with a memory history in `view/src/components/BoardLayout.test.tsx` comparing `window.scrollY` before and after each step, at 390px and 1440px.
- [x] 5.5 When focus returns to a card scrolled out of view, the page scrolls just enough to show it. Verified by a layout test in `view/src/components/BoardLayout.test.tsx` checking the card is inside the window and `window.scrollY` changed by no more than needed to show it.

## 6. Release

- [x] 6.1 The committed dashboard build matches the engine version. Verified by running `pnpm build:view`, committing `view/.output`, and the release test in `tests/view-build.test.ts` passing.
- [x] 6.2 The whole suite and type checks pass. Verified by `pnpm test`, `pnpm test:view`, `pnpm typecheck` and `pnpm --filter @software-factory/view typecheck` exiting with code 0.
