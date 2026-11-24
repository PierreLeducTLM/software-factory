## ADDED Requirements

### Requirement: Needs you strip above the Board
When at least one ticket needs a person, the Board SHALL show a Needs you strip between the header and the columns. It SHALL start with "N need you", where N is the Needs you page's count, followed by one item per Needs you page item, in the page's order. Each item SHALL show the ticket key and the item's reason, shortened with an ellipsis when it does not fit. The items SHALL take at most two lines; when some do not fit, the last slot SHALL read "+N more", where N is the number of items not shown, and SHALL link to the Needs you page. Activating an item SHALL open that ticket's Needs you card in the run detail drawer. When nothing needs a person, the strip SHALL NOT be shown. Below 720px wide, the strip SHALL show only "N need you" as a link to the Needs you page. The Needs you column SHALL stay on the Board, unchanged.

#### Scenario: Items that fit
- **GIVEN** the Needs you page lists PAY-147 "Sent back · 1 question" and PAY-155 "Waiting for approval"
- **WHEN** the person opens the Board 1440px wide
- **THEN** a strip above the columns reads "2 need you", then PAY-147 with "Sent back · 1 question", then PAY-155 with "Waiting for approval", and shows no "+N more"

#### Scenario: More items than two lines hold
- **GIVEN** the Needs you page lists 8 items and only 4 fit in two lines of the strip
- **WHEN** the person opens the Board
- **THEN** the strip shows the first 4 items in the page's order, then "+4 more", which links to the Needs you page

#### Scenario: Open a ticket from the strip
- **WHEN** the person activates PAY-155 in the strip
- **THEN** the run detail drawer opens on PAY-155 with the reason and command the Needs you page gives for it

#### Scenario: Nothing needs a person
- **WHEN** the Needs you page is empty
- **THEN** the Board shows no strip, and the Needs you column reads "Needs you 0"

#### Scenario: Phone width
- **GIVEN** 8 tickets need a person
- **WHEN** the person opens the Board 390px wide
- **THEN** the strip shows only "8 need you", and activating it opens the Needs you page

### Requirement: Cards show the latest attempt
A Board card SHALL show the gate chips of the latest attempt only, as one row that does not wrap. Each chip SHALL show the first letter of its gate (b, g, v, r for build, gate, verify, review), and its accessible name and tooltip SHALL be the gate's name and status, such as "build passed". When the run has earlier attempts, the card SHALL show "+N earlier attempts" ("+1 earlier attempt" for one). The card SHALL show the provider name only when the Board reads from more than one provider. The risk badge SHALL read "Low", "Medium" or "High", and its accessible name SHALL be "Low risk (predicted)", "Medium risk (predicted)" or "High risk (predicted)". The run detail SHALL still list every attempt. This replaces the attempt rows (last two attempts) and the "key and provider" item in the card contents of "Board shows one column per station"; the other card contents are unchanged.

#### Scenario: Run on attempt 3
- **WHEN** PAY-142 is on attempt 3 of its run
- **THEN** its card shows one chip row, for attempt 3, and "+2 earlier attempts"

#### Scenario: First attempt
- **WHEN** ENG-87 is on attempt 1
- **THEN** its card shows one chip row and no "earlier attempts" line

#### Scenario: Chips stay on one line
- **WHEN** the Board is 1280px wide and a card shows its chip row
- **THEN** the four chips b, g, v and r sit on a single line, and the chip "b" is named "build passed" when the build passed

#### Scenario: One provider
- **WHEN** the Board reads from Linear only
- **THEN** no card shows the provider name

#### Scenario: Two providers
- **WHEN** the Board reads from Linear and Jira
- **THEN** each card shows its provider name

#### Scenario: Risk badge
- **WHEN** a card's predicted risk is medium
- **THEN** its badge reads "Medium" and is named "Medium risk (predicted)"

### Requirement: The Board fits the screen
The page SHALL NOT scroll sideways at any width. At 720px and wider, a column with no cards SHALL shrink to a narrow strip that shows its name and count, without "Nothing here". At 1280px and wider, the Board SHALL show all nine columns without scrolling sideways. From 720px to 1279px, only the Board SHALL scroll sideways when its columns do not fit, the header and the Needs you strip SHALL stay in place, and the scroll SHALL stop at column edges. Below 720px, the columns SHALL stack top to bottom in Board column order, each a section headed by its name and count, and an empty column SHALL show only that heading. The column order SHALL stay as "Board column order" sets it.

#### Scenario: Laptop width
- **WHEN** the person opens the Board 1440px wide with the sample data
- **THEN** all nine column headings are inside the window, and neither the page nor the Board scrolls sideways

#### Scenario: Empty column
- **WHEN** Revalidate has no cards and the Board is at least 720px wide
- **THEN** Revalidate shows as a narrow strip reading its name and "0", and the text "Nothing here" is not shown

#### Scenario: Tablet width
- **WHEN** the person opens the Board 900px wide and the columns do not fit
- **THEN** the page does not scroll sideways, the Board alone scrolls sideways, and the header and the Needs you strip stay in place while it does

#### Scenario: Phone width
- **WHEN** the person opens the Board 390px wide
- **THEN** the page does not scroll sideways, and the columns appear one under another in the order Available, Refining, Ready, Revalidate, Build, Review, Pull request, Needs you, Done

### Requirement: Run detail opens as a drawer
Activating a card SHALL open the run detail as a drawer over the right side of the Board, with the same contents and buttons the run detail has today. At 720px and wider, the drawer SHALL be at most 520px wide, SHALL NOT cover the header: its top edge SHALL be the bottom of the header while the header is in view, and the top of the window once the header has scrolled out of view, so the header's status line and Force refresh button stay visible and usable, the Board's columns SHALL keep their size and position under it, and the cards outside it SHALL stay clickable: activating another card SHALL show that card in the drawer. Below 720px, the drawer SHALL fill the window, with its close button at the top. The drawer SHALL scroll on its own, from its top, whatever the Board's scroll position. Opening it SHALL move keyboard focus into the drawer. Pressing Escape or the close button SHALL close it and return focus to the card or strip item that opened it, when that element is still shown. When a refresh removes the drawer's ticket from the Board, the drawer SHALL close.

#### Scenario: Open a card on a laptop
- **GIVEN** the Board is 1440px wide
- **WHEN** the person activates PAY-147
- **THEN** a drawer at most 520px wide opens on the right showing PAY-147, and the column headings are where they were before

#### Scenario: Header stays usable with the drawer open
- **GIVEN** the Board is 1440px wide and the drawer shows PAY-147
- **WHEN** the person looks at the top of the page and activates Force refresh
- **THEN** the drawer starts below the header, the header's status line is fully visible, and the refresh runs with the drawer still showing PAY-147

#### Scenario: Switch cards with the drawer open
- **GIVEN** the drawer shows PAY-147 on a 1440px Board
- **WHEN** the person activates PAY-151, which the drawer does not cover
- **THEN** the drawer shows PAY-151

#### Scenario: Open a card on a phone
- **GIVEN** the Board is 390px wide and scrolled down to Done
- **WHEN** the person activates a Done card
- **THEN** the drawer fills the window, shows that card from its top, and has its close button at the top

#### Scenario: Close with Escape
- **GIVEN** the person opened PAY-147 from its card
- **WHEN** they press Escape
- **THEN** the drawer closes and keyboard focus is on the PAY-147 card

#### Scenario: Ticket leaves the Board
- **GIVEN** the drawer shows PIE-12
- **WHEN** a refresh no longer returns PIE-12
- **THEN** the drawer closes

### Requirement: The open card is in the address
Opening a card SHALL add `card=<KEY>` and `column=<column id>` to the Board's address, where the column id names the column the opened card is in (`needs_you` for a card opened from the Needs you column or the Needs you strip), adding one browser history entry. Showing another card while the drawer is open SHALL change `card` without adding a history entry. Pressing the browser's back button with the drawer open SHALL close the drawer and leave the person on the Board. Closing the drawer with Escape or the close button SHALL remove `card` and `column` from the address, and pressing back afterwards SHALL NOT reopen it. Loading the Board with `card=<KEY>` and `column=<column id>` SHALL open the drawer on that ticket's card in that column. When `column` is missing or not a column id, or that column no longer holds the ticket, the drawer SHALL open on the ticket's Needs you card if it has one, otherwise on its card in the other column that holds it. When the ticket is nowhere on the Board, the Board SHALL show with no drawer and no error, whatever `column` says.

#### Scenario: Back closes the drawer
- **GIVEN** the person is on the Board and opens PAY-147
- **WHEN** they press the browser's back button
- **THEN** the drawer closes and the Board stays shown

#### Scenario: Switching cards adds no history
- **GIVEN** the person opened PAY-147, then PAY-151 in the same drawer
- **WHEN** they press back once
- **THEN** the drawer closes and the Board stays shown

#### Scenario: Reload reopens the card
- **WHEN** the person loads the Board at `/?card=PAY-147&column=build` and PAY-147 is in Build
- **THEN** the drawer opens on PAY-147's Build card

#### Scenario: Reload reopens the Needs you card of a ticket shown twice
- **GIVEN** PAY-155 shows in Ready and in Needs you
- **WHEN** the person opens PAY-155 from the Needs you strip and reloads the page
- **THEN** the address reads `/?card=PAY-155&column=needs_you`, and the drawer opens on PAY-155's Needs you card, with the reason and command the Needs you page gives for it

#### Scenario: Column missing or out of date
- **GIVEN** PAY-155 shows in Ready and in Needs you
- **WHEN** the person loads the Board at `/?card=PAY-155`, or at `/?card=PAY-155&column=build`
- **THEN** the drawer opens on PAY-155's Needs you card

#### Scenario: Ticket left Needs you
- **GIVEN** PAY-147 shows only in Build
- **WHEN** the person loads the Board at `/?card=PAY-147&column=needs_you`
- **THEN** the drawer opens on PAY-147's Build card

#### Scenario: Ticket no longer on the Board
- **WHEN** the person loads the Board at `/?card=PIE-99&column=build` and PIE-99 is not on the Board
- **THEN** the Board shows with no drawer and no error message

### Requirement: Opening and closing the drawer keeps the page's scroll
Loading the Board, the Needs you page or the Health page fresh, including the Board with `card` in its address, SHALL start the page at the top. Opening the drawer, showing another card in it, and closing it with Escape, the close button or the browser's back button SHALL NOT change the page's scroll position: after closing, the page SHALL be where the person last scrolled it, including scrolling done while the drawer was open. The one exception: when focus returns on close to a card or strip item that is out of view, the page SHALL scroll by the smallest amount that brings it into view. Navigating between the Board, the Needs you page and the Health page SHALL behave as it does today.

#### Scenario: Fresh load starts at the top
- **WHEN** the person loads the Board at `/?card=PAY-147&column=build` on a 390px window
- **THEN** the page is scrolled to the top and the drawer opens on PAY-147

#### Scenario: Opening a card keeps the page where it is
- **GIVEN** the Board is 390px wide and scrolled down to Done
- **WHEN** the person activates a Done card and then closes the drawer with its close button
- **THEN** the page is still scrolled to Done, and focus is on that Done card

#### Scenario: Back keeps scrolling done while the drawer was open
- **GIVEN** the Board is 1440px wide, the drawer shows PAY-147, and the person scrolls the page down 600px behind the drawer
- **WHEN** they press the browser's back button
- **THEN** the drawer closes and the page stays scrolled 600px down

#### Scenario: Focus returns to a card out of view
- **GIVEN** the person opened PAY-147 from its card, then scrolled the page until the PAY-147 card is out of view
- **WHEN** they press Escape
- **THEN** the drawer closes, focus is on the PAY-147 card, and the page has scrolled just enough to show it
