# Design

## Context

See proposal.md (Why) for the problem as measured.

- `view/src/styles.css` sets `.board` to `grid-template-columns: repeat(9, minmax(220px, 1fr))`, so the Board is about 2,100px wide whatever the window. It has no `@media` rule.
- `.screen` is a wrapping flex row holding the Board and the run detail (`<aside class="detail">`). The detail is a sibling of the Board, not an overlay, which is why it squeezes the Board on wide screens and wraps under it on narrow ones.
- `BoardScreen` keeps the selected card in React state. The route `/` has no search parameters.
- `src/view/model.ts` keeps the last two attempt rows per card (`SHOWN_ATTEMPTS = 2`) and counts the rest in `earlierAttempts`. `Card.provider` is always set.
- The browser tests in `view/src/components/*.test.tsx` render components with `vitest-browser-react` and do not load `styles.css`, so they cannot check layout today.
- The card contents rule ("Board shows one column per station") lives in the open change `define-software-factory-v1`, not in `openspec/specs/factory-view/spec.md`. As "Board column order" already did for the column list, the new requirement "Cards show the latest attempt" states which parts of it it replaces.

## Goals / Non-Goals

**Goals:**
- One layout that works at phone, tablet, laptop and wide widths, with the breakpoints 720px and 1280px.
- The run detail behaves the same wherever the person has scrolled.

**Non-Goals:**
- No new colours, fonts or visual style. A visual refresh, and a `PRODUCT.md`/`DESIGN.md` for the dashboard, are separate work.
- No change to the Needs you page or the Health page, except that they no longer scroll sideways.
- No change to what the run detail contains, or to its buttons.

## Approach

**Layout.** `.screen` stops being a wrapping flex row. The Board takes the full width of the page. Columns become `minmax(0, 1fr)` for a column with cards and a fixed narrow track (about 44px) for an empty one, chosen per column from its card count. At 1280px and wider no minimum width forces overflow, so all nine fit. From 720px to 1279px a column with cards keeps a minimum width of about 220px, and the Board, not the page, scrolls sideways with `scroll-snap-type: x mandatory` and `scroll-snap-align: start` on each column. Below 720px the Board becomes a single column of sections. The empty-column strip shows its name and count rotated or stacked, keeping the heading's accessible name ("Revalidate 0") so existing tests and screen readers read it the same.

**Cards.** `SHOWN_ATTEMPTS` becomes 1 in the model, so `rows` holds the latest attempt and `earlierAttempts` counts the others. The chip label becomes the first letter of the gate; the visually hidden status text and the `title` carry the full name and status. The Board component receives the number of providers from the view data and hides `card__provider` when it is 1. The risk badge shows the short label with an `aria-label` for the long one.

**Needs you strip.** A new component under `view/src/components/` reads `needsYou` from the view data (the same list the Needs you page and the Needs you column use, so all counts agree). It lays out items in a container limited to two lines and measures which items fit, replacing the overflow with "+N more" linking to `/needs-you`. Below 720px it renders only the count link. Activating an item selects that ticket in the `needs_you` column.

**Drawer.** `RunDetailPanel` keeps its contents and moves into a `position: fixed` container on the right (`width: min(520px, 100vw)`, own `overflow-y: auto`). At 720px and wider its top edge is the bottom of the header while the header is in view, and the top of the window once the header has scrolled away, so `HeaderStatus` (status line and Force refresh) is never covered; its bottom edge is the bottom of the window. Below 720px it takes the whole window. It has no backdrop, so the Board stays clickable. On open, focus moves to the drawer's heading; Escape and the close button close it and focus the element that opened it, when still in the document. Motion is limited to a short slide or fade (about 200ms, ease-out), turned off under `prefers-reduced-motion`.

**Address.** The `/` route validates optional `card` and `column` search parameters, `column` being one of the Board's column ids (`available` … `done`). Selection is derived from them instead of React state: the open card is the card with key `card` in column `column`; when `column` is missing, invalid, or no longer holds that ticket, it is the ticket's `needs_you` card if it has one, otherwise its card in the first other column that holds it. Opening a card sets both parameters; the navigation pushes an entry when no card was open and replaces it when one was. Closing navigates back when the entry was pushed by the drawer, or replaces it to drop `card` and `column` when the page was loaded with it. A `card` that matches no card on the Board renders no drawer. The router keeps `scrollRestoration: true`; only the navigations that open, switch or close the drawer pass `resetScroll: false`, so they leave the page's scroll where it is, and the back navigation that closes the drawer restores the position the person scrolled to rather than the one saved when the drawer opened. A fresh load of `/`, `/?card=…`, `/needs-you` or `/health` starts at the top as today. When focus returns to the opener on close, the opener is brought into view with the smallest scroll that shows it (`scrollIntoView({ block: 'nearest' })`), and only when it is out of view.

## Open Questions

None.

## Decisions

### D-001: How Needs you gets above the fold

- **Question:** At 1440px Needs you is off-screen. Should it move first in the column order, get a strip above the Board, or stay where it is and rely on the Board fitting?
- **Decision:** A strip above the Board. The Needs you column stays where "Board column order" puts it.
- **Effect:** New requirement "Needs you strip above the Board". "Board column order" and "Needs you column mirrors the Needs you page" are unchanged.

### D-002: What the Needs you strip holds

- **Question:** What does the strip show, how does it overflow, and what does it show when nothing needs a person or on a phone?
- **Decision:** "N need you", then key and reason per item in the Needs you page's order, at most two lines, then "+N more" linking to the Needs you page. Activating an item opens its drawer. No strip when nothing needs a person. Below 720px only "N need you", linking to the Needs you page.
- **Effect:** Scenarios for fitting items, overflow, opening from the strip, empty and phone width in "Needs you strip above the Board".

### D-003: How far cards shrink

- **Question:** Keep the last two attempts with four wrapping chips, or show only the latest attempt with chips on one line?
- **Decision:** The latest attempt only, chips on one line with single-letter labels (b, g, v, r) and full names for tooltips and screen readers, "+N earlier attempts", the provider only when the Board reads from more than one provider, and risk badges reading "Low", "Medium" or "High" with "(predicted)" in the accessible name.
- **Effect:** New requirement "Cards show the latest attempt", which replaces the attempt rows and "key and provider" items of "Board shows one column per station". The model keeps one row instead of two.

### D-004: What happens at each width

- **Question:** Nine columns cannot fit between a phone and 1280px. Should the Board scroll sideways there, wrap into rows, or stack as on a phone?
- **Decision:** At 1280px and wider all nine columns fit, with empty columns as narrow strips. From 720px to 1279px only the Board scrolls sideways, snapping to column edges, with the header and strip fixed. Below 720px columns stack. The page never scrolls sideways.
- **Effect:** New requirement "The Board fits the screen", with scenarios at 1440, 900 and 390px.

### D-005: The run detail is a drawer

- **Question:** The run detail is a block next to the Board that ends up off-screen on narrow windows. What should it be?
- **Decision:** A drawer over the right side of the Board, at most 520px wide, full window below 720px. It is not modal: the Board does not reflow, other cards stay clickable and swap the drawer's contents. It scrolls on its own, moves focus in on open, closes on Escape or the close button, returns focus to the opener, and closes when its ticket leaves the Board.
- **Effect:** New requirement "Run detail opens as a drawer". The contents and buttons of the run detail, including "Start in Orca" and "Open in Orca", are unchanged.

### D-006: The open card is in the address

- **Question:** With a full-window drawer on a phone, the back button leaves the Board. Should the open card live in the URL?
- **Decision:** Yes, as `card=<KEY>`. Opening adds one history entry, switching cards replaces it, back closes the drawer, closing removes `card` without leaving a way back into the drawer, and a `card` not on the Board shows the Board with no drawer and no error.
- **Effect:** New requirement "The open card is in the address". The Needs you page is unchanged and does not link to cards.

### D-007: The header stays usable while the drawer is open

- **Question:** A full-height drawer covers the header status line and the Force refresh button. Should the header stay visible and usable while the drawer is open at 720px and wider?
- **Decision:** Yes. At 720px and wider the drawer starts below the header, and at the top of the window once the header has scrolled away, so the status line and Force refresh stay visible and clickable. Below 720px the drawer still fills the window.
- **Effect:** "Run detail opens as a drawer" states where the drawer's top edge is, with a scenario for refreshing while it is open. Task 4.1 checks that the drawer does not overlap the header.

### D-008: The address names the column as well as the card

- **Question:** A ticket can show twice on the Board, in its station and in Needs you, with different notes and commands, but the address holds only `card=<KEY>`. Which card should reloading or sharing the address reopen?
- **Decision:** The address also names the column, for example `/?card=PAY-155&column=needs_you`, so a reload reopens exactly the card that was open. When `column` is missing or the ticket is no longer in that column, the drawer opens the ticket's Needs you card if it has one, otherwise its station card.
- **Effect:** "The open card is in the address" adds `column`, with scenarios for reloading a Needs you card and for a missing or stale column. Tasks 5.1 to 5.3 check it. Extends D-006.

### D-009: Opening and closing the drawer never moves the page

- **Question:** The router restores and resets scroll on navigation, and opening the drawer now navigates. Should a fresh load start at the top, and should opening, switching and closing the drawer leave the page where the person scrolled it?
- **Decision:** Yes to both. A fresh load of the Board, the Needs you page or the Health page starts at the top as before. Opening, switching and closing the drawer (close button, Escape or the browser's back button) never move the page, except that when focus returns to a card the person scrolled out of view, the page scrolls just enough to show it. This is scoped to the Board's card navigation, not to the router as a whole.
- **Effect:** New requirement "Opening and closing the drawer keeps the page's scroll", with scenarios for a fresh load, opening, back after scrolling, and focus returning to a card out of view. Tasks 5.4 and 5.5 check it.

## Risks / Trade-offs

- [At 1280px with all nine columns holding cards, each column is about 124px wide] → Card text wraps rather than truncates, the chip row uses single letters so it fits, and in practice Revalidate and Review are often empty and shrink to strips.
- [Measuring which strip items fit in two lines depends on rendered widths] → Measure after layout and on resize; the browser test pins the window width so the count is deterministic.
- [Layout tests need real CSS] → The new browser tests import `../styles.css` and set the window size with the Vitest browser `page.viewport`.
- [Deriving selection from the URL changes how `BoardScreen` is driven] → `BoardScreen` takes the selected key and an `onSelect`/`onClose` pair from the route, so its existing tests keep passing with a small in-memory wrapper.
- [The committed `view/.output` must match the engine version] → Rebuild with `pnpm build:view` and commit it, as the release test requires.

## Affected paths

- `view/src/components/Board.tsx`
- `view/src/components/BoardScreen.tsx`
- `view/src/components/RunDetailPanel.tsx`
- `view/src/components/NeedsYouStrip.tsx`
- `view/src/components/NeedsYouStrip.test.tsx`
- `view/src/components/Board.test.tsx`
- `view/src/components/BoardLayout.test.tsx`
- `view/src/components/fixtures.ts`
- `view/src/routes/index.tsx`
- `view/src/router.tsx`
- `view/src/routeTree.gen.ts`
- `view/src/styles.css`
- `src/view/model.ts`
- `tests/view-model.test.ts`
- `view/.output/**`
