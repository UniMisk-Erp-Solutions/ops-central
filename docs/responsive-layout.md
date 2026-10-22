# Responsive layout

## What it is

The app works on a phone (≈375px), a tablet (≈768px) and a desktop. All of it
lives in one block at the end of `frontend/src/styles.css`, headed
"Responsive", plus three class names in `shell.jsx` (`org-pill-fy`,
`topbar-switcher`, `topbar-user-text`) so the topbar can drop its optional parts.

Two breakpoints: **900px** (tablet / narrow laptop) and **600px** (phone), plus
`pointer: coarse` for touch screens.

## How it works

| Width | What changes |
|---|---|
| ≤ 900 | `split-*` and `detail-grid` stack; `field-row-3/4` and `kpi-grid` go to 2 columns; brand name, org fiscal year and the user's name/role text leave the topbar; the topbar's right side scrolls sideways instead of widening the page; the notifications drawer is at most the screen wide. |
| ≤ 600 | Breadcrumbs and the admin "act as" switcher are hidden; every `field-row` is one column; dialogs become full-width bottom sheets and their footer buttons wrap; filter bars let each control fill the row; card headers wrap; inline 3/4/5-column and `1fr 1fr` grids become 2 columns; a task row's buttons drop under its text; toasts span the screen. |
| touch | Buttons ≥ 34px tall; inputs are 16px (iOS zooms into anything smaller on focus). |

**Customisation** (`screens-config.jsx`) has a 13-item section list. On desktop it is a
220px column; at ≤ 900 it collapses behind a hamburger button (`.cfg-menu-btn`)
that names the current section, and picking an item closes it. `.nav-item` had
no styles of its own after the sidebar was removed (the list rendered as bare
stacked text on a phone), so they are defined under `.cfg-nav`.

Wide tables are **not** reflowed — they scroll sideways inside their card
(`.table-wrap`, and `.card-body.flush`). Turning an 11-column ledger into cards
would be a different screen per table; scrolling keeps every column.

## Why it is that way — the traps

- **One wide child widened the whole page.** The shell grid column used to be
  `1fr`, which is `minmax(auto, 1fr)`: it grows to its widest child. The topbar
  alone was ~740px, so on a 375px phone every screen was laid out 740px wide and
  pushed off-screen. The column is now `minmax(0, 1fr)` and the topbar,
  `.main`, `.card` and `.page` have `min-width: 0`. **If a new screen makes the
  page scroll sideways, look for a flex/grid ancestor missing `min-width: 0`
  before adding any width rule.**
- **Screens write layouts inline.** Many use `style={{ gridTemplateColumns: … }}`,
  which a stylesheet beats only with an attribute selector and `!important`. Those
  selectors (`[style*="grid-template-columns: repeat(3"]` …) are scoped to
  ≤ 600px and match React's serialised output exactly — **change the spelling in
  a screen (`repeat(3,1fr)` without the space) and the rule stops matching.**
  New screens should use the `.field-row*`, `.split-*` or `.kpi-grid` classes
  instead, which already collapse.
- **Inline `display` beats a class.** Hiding `.topbar-user-text` needs
  `!important` because that element sets `display: flex` inline.
- **Hiding is not free.** The admin role switcher (impersonation, a testing tool)
  is hidden at ≤ 600. Do not hide anything a role needs to do their job — a task
  row's Approve button used to hang off the edge of the card, reachable only by a
  sideways scroll, so rows now wrap.

## How it was checked

There is no automated check: the suite runs in Node with no layout engine, so it
cannot see overflow. It was verified in a real browser at 375 and 768 by
measuring `scrollWidth` on `.main` and `documentElement` across the main routes
(they must equal the viewport) and listing any element whose right edge passes
the viewport and is not inside a scroller. Data was empty, so tables were judged
by their scroll containers, not their rows — look at a populated screen on a
real phone when changing one.

## Customisation screen details

- **Headings use the theme colour.** `.page-title`, `.card-title` and
  `.modal-title` are `var(--accent)`, so they follow the brand colour an org picks
  in Identity & branding. Small uppercase labels stay grey on purpose.
- **Tables scroll inside their card.** The settings pane (`.cfg-pane`) is a grid
  item, and grid items default to `min-width: auto`, so a wide table stretched the
  pane instead of scrolling — the table's own scrollbar never appeared.
  `.cfg-layout > *` and `.cfg-pane` now have `min-width: 0`. Tables in this screen
  carry `.cfg-table` (`.cfg-table-compact` for Custom fields, 11.5px text); their
  inputs set a 12px font with `!important` because the touch rule above would
  otherwise make them 16px and truncate the values.
- **Logo.** Identity & branding takes an image (click or drop), shrinks it in the
  browser to ≤ 256px and stores it as a data URL in `org.logo` inside the org's
  config blob — no storage bucket, no schema change. It replaces the "B" mark in
  the topbar (`shell.jsx`). Remove it and the letter returns.
- **Back.** `OpcBackButton` (`utils.jsx`) is the "< Back" link for a screen
  reached from another one: `history.back()` when there is history, else its
  `fallback` route. Used by Products & BOM and by the Onboarding wizard
  ("< Customisation"; the wizard's own Back still steps between its six steps).

## Dashboard and the "< Flow" link

- **SO Board.** The filter row was forced onto one line (`flex-wrap: nowrap`), so on
  a phone the four dropdowns were ~50px wide and unreadable. At ≤ 900 it wraps:
  search on its own line, dropdowns at least 130px (two per row on a phone). The
  SO cards are two per row at ≤ 900 and full width at ≤ 600. A card the user has
  dragged larger stores an inline `width`, so the rule uses `!important`; on a
  phone only the height can be dragged (`resize: vertical`). Cards still expand
  to show more detail by height, via container queries.
- **Overview / Classic** already use `kpi-grid` / `split-*`, which collapse.
- **Back.** Dashboard and Customisation show `< Flow` (`OpcBackButton`, see above),
  so the Flow hub is always one tap away now that there is no sidebar.
- **SO card height.** On desktop a card has a dragged, fixed height and shows more
  the taller it is (container queries) — so a card dragged taller than its content
  is just blank space. On a phone the card is as tall as its content (container
  query off, `!important` over the saved inline size) and a "Show details" button
  reveals the rest.
- **Phone filters work like a shopping app** (≤ 600): the board shows **search + [Sort] +
  [Filter n]**. Filter opens a bottom sheet of tappable chips (Status, Priority, Project
  manager) with **Clear all** and **Show N SO(s)**; Sort opens a sheet of radio rows plus
  newest/oldest. What is applied shows as removable chips under the search row. Both
  sheets are the shared `Modal`, which is already a bottom sheet on phones (so Escape,
  focus and the keyboard layer behave as for any dialog). The inline dropdowns remain on
  desktop and are hidden on a phone (`.dash-phone-only` / `.dash-filter-sel`).

## Sales Order detail

- **Status strip.** `.h-step + .h-step` used a negative left margin so each pill
  tucked under the previous one; with long labels the green "reached" pills and the
  blue "current" one overlapped. Pills now sit in a wrapping row with a gap.
- **Order Details** uses `.dl dl-cols`: at ≥ 1000px two label/value pairs per row,
  so the card is about half as tall and the cards under it (implementation, linked
  POs…) are on screen without scrolling. Below 1000px it is one pair per row.

## Topbar and tables (later pass)

- **Act-as is a dropdown of roles** (`.role-select`, `shell.jsx`), replacing the row
  of initials chips (BO, DU, GR…). Two users with the same role are told apart as
  "Role — Name". It stays on a phone, narrower.
- **Switching role always lands on the Flow hub** ("Workspace"), and so does "Exit"
  from acting-as. It used to jump to the role's own home screen, which could be a
  page the previous role was already on; the Flow hub lists exactly what the new
  role can reach.
- **Topbar icons** (bell, tweaks, sign out) are 19px in 36px buttons; the avatar 28px.
- **Tables on a phone** (≤ 600): text 11px, headers 9.5px, cell padding 5px, and
  cells **wrap** (they were `white-space: nowrap`, which forced a sideways scroll for
  anything past ~3 columns). Numbers, mono cells and badges stay on one line. A
  table that is still too wide keeps its scroll container as a last resort. Checked
  on a six-column table; the real Invoice tables were not available with data, so
  look at them on a phone.
- **Topbar** — one row at every width: **[logo] page … [role ▾] [bell] [tweaks] [profile ▾]**.
  An earlier version moved the role dropdown and tweaks into a menu on small screens;
  that was wrong — controls the user relies on must stay in the bar. Now the *profile*
  button (avatar) opens a small menu (`.tb-menu`) with **Sign out** (and **Exit** when
  acting as another role). Below 900px only the org name, the "Acting as" badge and the
  user's name text drop out; below 480px the page title does too, so the dropdown,
  bell, tweaks and profile still fit at 320–360px. There is deliberately **no second
  logo** next to the org name — the brand mark on the left is the org's logo.
  - Trap: the breadcrumb spans set `display` inline, so hiding them needs
    `!important`; and `.topbar-right .btn-ghost` sets size, so rules for `.tb-more`
    must come after it.

## Tables on a phone / tablet

**What it is.** Tables stay tables: compact, readable and horizontal. They are never turned
into one card per row.

**How it works** (all in `styles.css`, no per-screen edits):
- ≤ 1100px: text 12px, headers 10.5px, cell padding 7×8, text cells **wrap** (numbers,
  badges and buttons stay whole). Six rows of the Sales Orders list fit one phone screen.
- ≤ 900px: the table's **first column is pinned** (`position: sticky; left: 0`) so the PO/SO
  number or name stays in view when you scroll sideways to the other columns; the header
  row is tinted.
- A table that still cannot fit scrolls sideways **inside its own card**, never the page.
- A table in a narrow card (a side panel, a half-width column) wraps its text by the card's
  own width (container query on `.card-body.flush` / `.table-wrap`).
- RFQ comparison puts project cards two across on a wide screen (`.rfq-grid`); card headers
  wrap; the 3-way-match comparison (`.compare`, a div grid) shows each field as a heading
  with the three sources side by side.
- The Filter/Sort bottom sheets, phone filter bars (30px / 13px) and the dashboard layout
  described above are unchanged.

**Why it is that way — a mistake worth remembering.** A "label | value" card per row was
built (a script labelled every `<td>` from its column heading, CSS drew each row as a
bordered card) and then **removed**: it made every list several times longer — 50 orders
became hundreds of screens of scrolling — which is worse than a sideways scroll. The brief
was *readable*, not *card-shaped*. Do not rebuild it; if a screen needs a card layout, give
that one screen its own markup.
- Trap: `overflow-wrap: anywhere` lets a column shrink to one letter; use `break-word`.
- Trap: a sticky first column needs an opaque background or the scrolled cells show through.

## Collapsible project cards (phone / tablet)

Vendor POs and GRNs are listed grouped by project (SO). \`OpcGroup\` (\`utils.jsx\`) wraps
each group: on a wide screen it is the same plain heading band over an always-visible
table; at ≤ 900px the heading becomes a **dropdown card** (SO number · customer · count on
the left, total and a chevron on the right) and tapping it opens or closes that project's
table. The first project is open by default, the rest closed, so a long list is a short
list of headings. Enter/Space on the focused heading toggles it too.

- Whether a group is open is React state, but what it *does* is CSS only (\`.grp:not(.open)
  > .grp-body { display: none }\` inside the ≤ 900 media query) — so resizing a window never
  hides a desktop table.
- Tapping the SO number inside the heading still opens that order (the click does not also
  toggle the group).
- To use it on another grouped list, wrap the group in \`<OpcGroup title=… right=…
  startOpen={index === 0}>\`. The RFQ comparison project cards are the obvious next one.

## Back arrow, dropdown table cards, smaller forms

- **Back link above every page title** (not in the top bar). `app.jsx` renders
  `<div class="page-back">` with `OpcBackButton` above the page on every route except the Flow
  hub. A page that already shows its own "‹ Parent" link above its title (Sales Order detail,
  GRN detail, …) hides the global one in CSS (`.page-back:has(~ .page .muted.tiny.mb-1 >
  svg:first-child)`), so there is never a pair. The Onboarding wizard has no `<main>`, so it
  keeps its own "‹ Customisation" (`to="settings"`).
  - **Back goes UP the hierarchy, never "to the previous page".** `opcParentRoute(route)`
    (`utils.jsx`): a detail → its list (`invoices/so-1` → `invoices`); a third level → its
    record (`invoices/so-1/inv-2` → `invoices/so-1`); a top-level screen → its Flow stage hub
    (`invoices` → `flow/billing`, via `FLOW_STAGES`); a stage hub or anything else → the Flow hub.
  - **Why not `history.back()`:** it ping-ponged. A detail page's own "‹ Invoices" link
    *navigates* (adds a history entry) to the list, so Back on the list returned to the invoice,
    whose link went to the list again, forever. A parent-based Back cannot loop, and agrees with
    those in-page links. `flow-check.js` section [8] pins this (and was made to fail first).
- **Dropdown cards wherever a page has several table sections.** \`opcCollapsibleCards()\`
  (\`utils.jsx\`): at ≤ 900px, if a page has two or more cards that each have a
  \`.card-header\` and a table, every such card's heading becomes a dropdown (chevron; the first
  open, the rest closed). It works with \`data-collapsible\` / \`data-collapsed\` attributes and one
  delegated click handler — React's elements are never moved or re-classed, so no screen was
  edited and a re-render cannot undo it. A page with only one table card is left alone, as is
  anything inside a dialog, drawer or an \`OpcGroup\`. Header buttons/links/inputs still work
  (clicks on them do not toggle). \`OpcGroup\` (Vendor POs, GRN) is the hand-wired version of the
  same idea. Trap: it only runs when the \`.main\` area has been rendered; \`setTimeout\`, not rAF,
  so it also runs in a background tab.
- **Forms on a phone are smaller:** controls 32px / 13px, labels 10px, tighter card padding.
  The earlier 16px/36px "touch" sizing (there to stop iOS zooming into a field) made a
  three-field form fill the screen; the trade-off is that iOS will zoom in on focus.
- **Spacing in dropdown cards:** the open group has 10px of padding around its table (the
  table sits in a thin bordered frame, not flush against the heading), and phone/tablet table
  cells have 10px side padding so columns do not run together.

## Invoices & e-Way Bills on a phone

The list has ten columns (invoice, customer, SO, date, taxable, GST, total, EWB, status),
which no phone table can show readably. At ≤ 600px it is replaced by a purpose-built list
(\`.inv-list\`, \`screens-billing.jsx\`): each invoice is a three-line row — **number and
total**, **customer**, then **SO · date · taxable · GST**, with the **e-way bill** and
**Paid / Payment due** badges beneath. Tapping a row opens the invoice. Both the list and the
table are rendered and CSS picks (\`.show-phone\` / \`.hide-phone\`, reusable on any screen whose
table deserves a custom phone layout); above 600px nothing changed.

## "My profile"

The user row at the top of the account menu used to be inert text — clicking it did nothing.
It is now a button that opens **My profile** (\`ProfileModal\`, \`shell.jsx\`): avatar, name,
role, email, organisation and GSTIN, plus **Change password** and **Sign out**.

- Name, role and organisation are read-only here; an Org Admin sets them in Customisation →
  Users. Only the password is self-service.
- **Change password** is a folded row ("Change password ›") that unfolds into the form — it was an
  always-open pair of boxes under a disabled button, which looked like a login form. The form has
  a show/hide eye, a live "at least 8 characters / do not match yet" hint, and **Update password**
  stays disabled until the entry is valid and matches; Cancel folds it away again. It calls \`OPC_SB.auth.updateUser({ password })\` — the signed-in session's own
  account, nothing else. Minimum 8 characters, the two entries must match. It is hidden when
  there is no backend (offline/demo) and while an admin is *acting as* another role (that
  persona is not the admin's account); the modal says so. It could not be exercised against the
  real Supabase from the test harness — try it once with a throwaway password.

## Phone: S-shaped Flow hub, and tables that show only the key columns

**Flow hub (≤ 600px).** The six stage boxes were one tall column that needed scrolling. They are
now an **S**: three rows of two — Sales Order → Vendors, then Procurement ← under Vendors with
Inventory beside it, then Dispatch → Billing — joined by →, ↓, ←, ↓, → arrows drawn with CSS
(\`.flow-node:nth-child(n)::after\`, grid placement by \`nth-child\`, because the markup puts a hidden
arrow element between nodes). It fits a phone screen with no scroll. Desktop is unchanged.

**Tables (≤ 600px): key columns + a per-row dropdown** (\`opcMobileTables\`, \`utils.jsx\`; CSS
\`table.t[data-mt]\`). This replaces the earlier full-card layout, which made lists too long and
which was removed: now a row is one compact line, and the other columns are one tap away.
- A row shows 2–3 columns. A chevron strip at its right edge opens the rest beneath it as
  **label | value** lines; tap again to close. Tapping the row itself still opens the record.
- **Which columns:** a screen names them with \`data-keep\` on the table (header text, comma
  separated) — Inquiries \`Inquiry No,Customer\`; Sales Orders \`SO No,Customer · PO Ref,Pri.\`;
  Customers \`Code,Contact,Tier\`; RFQ comparison \`Item,Qty,Chosen vendor\`. Every other table with
  more than three labelled columns uses a default: the first column plus the best two by header
  (name/customer/vendor/item → action/event/entity → status → amount/value → qty → date).
  To change a table's choice, add \`data-keep\` to it; to exempt a table, \`className="t t-keep"\`.
- Mechanism, and the traps: it only sets \`data-*\` attributes (\`data-mt\`, \`data-m="x|h"\`,
  \`data-label\`, \`data-mx\`, \`data-open\`) — it never adds, moves or re-classes an element, so React
  is untouched. The chevron is \`tr::after\`, so a tap on it has \`target === <tr>\` while a tap on a
  cell does not; one capture-phase listener stops the row's own click only for the chevron. Opened
  rows rely on \`order: 5\` for the folded cells: they sit between the kept cells in the DOM, and
  without \`order\` the kept cells split across lines. The value column's left padding is
  \`calc(38% + 25px)\`, not 38% + 10, because the row's right padding is cancelled by a negative
  margin and percentages resolve against different boxes. Icon-only cells (the row's ">", a
  trash can) are treated as decoration and not shown.
- RFQ's three summary boxes (projects compared, total spend, potential saving) stay on one
  line (\`.kpi3\`).

## Fix: opened rows were squashed (Inquiries), and the iPad Flow hub

- **Bug:** on the Inquiries list, opening a row squeezed Inquiry No and Customer to a few pixels
  wide (one letter per line). The kept cells had \`flex: 1 1 0\` (zero basis) and the first folded
  cell is \`flex: 1 1 100%\`; 0 + 0 + 100% still *fits one line*, so the folded cell shared line 1
  and the kept cells collapsed. It only showed on tables where the first folded column came
  straight after the kept ones. Kept cells now have a real basis (\`60px\`, the first \`70px\`), so any
  100% cell must wrap to its own line. **Never use a zero flex-basis for cells that sit beside a
  100%-wide sibling.** Found by reproducing it with sample inquiries — not visible with Sales
  Orders data.
- **iPad (601–1024px) Flow hub:** the S is three across, two rows — Sales Order → Vendors →
  Procurement, then Inventory under Procurement, Dispatch ←, Billing ← (\`@media (min-width:601px)
  and (max-width:1024px)\`), arrows drawn the same way as the phone's. Above 1024px it is the
  original single row.

## Fixes: three boxes on one line, and no empty dropdowns

- **Any three summary boxes stay on one line on a phone** — the inquiry page's Quote budget /
  Vendor / Margin, billing's three totals, RFQ's three. The rule is generic: an inline
  \`repeat(3, …)\` grid whose direct children are \`.card\`s (\`:has(> .card)\`) keeps three columns, with
  tighter padding, 9.5px labels and the big number shrunk to 14px. Before, such a grid collapsed to two
  columns and the third box wrapped alone (the older "repeat(3 → 2 columns" rule still covers grids of
  plain, non-card children). \`.kpi3\` on RFQ is now redundant but harmless.
- **A row with nothing folded away has no chevron.** The per-row dropdown used to show a ⌄ on any row
  that had a non-kept column, even when every such cell was empty — opening it showed nothing. A folded
  cell with no text and nothing to press is now treated as absent (\`data-m="h"\`), and \`data-mx\` (the
  chevron) is only set when at least one folded cell really has content.

## Fixes: overlap, scroll trap, tap anywhere (Cross-SO Transfers)

- **Status badge ran under the chevron** ("Approved · awaiting receipt" on Cross-SO). Cells now
  clip their own content and badges wrap onto two lines inside their column, so nothing reaches the
  chevron strip.
- **Possible scroll trap.** The card around a dropdown-row table kept \`overflow-x: auto\` (computed
  \`overflow-y: auto\` too) even though the table no longer needs to scroll sideways — a nested scroll
  area, which can swallow a vertical swipe that starts on it. Its overflow is now released
  (\`.card-body.flush:has(> table.t[data-mt])\`). The page's own scrolling was verified to work (the
  \`.main\` area scrolled to the bottom with a History group and a row open); the nested scroller was
  the only candidate left that could eat a touch drag, so this is a likely-cause fix — if a page still
  will not scroll on a phone, say which and with what open.
- **Tap anywhere on a row** opens or closes its details, not only the chevron. Real controls inside
  the row still do their own job: a link (the SO/PO number opens the record), a button, a field. The
  row's own click (which used to open the record) is stopped for the toggle, so a record is now opened
  from its number/link, not from tapping empty row space.

## Sourcing / Inquiries (list, New Inquiry, inquiry detail)

Audited with three sample inquiries (Draft, Quoted with a split allocation, Converted) at 414, 820
and 1440 wide: no crashes, no sideways overflow, and the detail page is 1.4 screens tall on desktop,
1 on iPad.

- **Inquiry list:** key columns Inquiry No + Customer, the rest (date, sell value, margin, status) in the
  row dropdown (\`data-keep\`).
- **Vendor comparison — per item** (the busy one): the vendor options are tappable chips with a tick box and
  were cut off in a narrow column. Each row now shows **Item / Req qty / Line cost** on one line; tap the row
  and the **Vendor options open as a dropdown** beneath it — full width, two chips per row — together with
  **Chosen**. This uses `data-wide="Vendor options (cheapest first)"`: a column that is folded into the row's
  dropdown but, once open, spans the whole row with its heading above instead of sitting in the narrow
  "label | value" column. (The chips are `[role=button]`, so the tap-anywhere toggle leaves them alone and
  picking a vendor does not fold the row.) `data-full` — a column that is *always* shown on its own full-width
  line — also exists, and was tried first; it was replaced because the user wanted this one in a dropdown.
- **Total rows** (\`<tfoot>\`: "Grand total", "Vendor quotation total", "Customer sell value") were being
  squeezed so \`₹6,23,200\` broke across lines. On a phone a tfoot row is one tidy band with whole numbers.
- **Page action buttons** (Add vendor & quote, Float RFQ, Allocate, Save, Send to Sales…) were ragged
  wrapped rows; on a phone \`.page-actions\` is now equal tiles, two to a row (any page).
- **The dropdown chevron is only 48px tall**, top-aligned with the row's first line, instead of running
  the full height of the row — otherwise full-width content under the row ran across its divider line.
- **Breadcrumb names the record:** it showed the raw id (\`src-1\`); it now shows the document number
  (\`INQ/FY26/0002\`; the same for sales orders, invoices, godowns, SCM, vendor POs and GRNs), and
  Sourcing / Item Name Mapping / SCM Tracking / Item Requests have proper names.
- Form fields in a card fill the card on a phone (the Order type select was narrower than the rest).
- One trap hit while testing: right after a hash change the in-app browser's screenshot sometimes shows a
  stale, clipped paint (content cut off on the right) while the DOM measures correctly. A fresh load
  (\`?r=n\` on the URL) shows the truth — measure before believing a single screenshot.

## SO card progress: a container truck

The dashboard's SO Board cards show progress as a small **container truck** (`DashTruckProgress`,
`screens-dashboard.jsx`; `.truck-*` in `styles.css`), not a plain blue bar. The cab is at the
**right**; the flatbed carries **one ribbed shipping container** that fills from its back (left) towards
the cab as the order progresses — empty at 0%, full at 100%, when the fill and cab turn green. The
**percentage is written inside the container, centred in the coloured part, in white** (`.truck-pct-in`, real HTML laid over the SVG so it stays readable instead of shrinking with the drawing). When the filled part is too narrow for it (under ~14%) it sits just past the fill in the normal text colour, so `0%` and `15%` stay legible.
One inline SVG (viewBox 300×43 starting at y=-5, so the cab can stand taller than the container; the the wheels r=5.6, no image files, scales with the card) with `role="progressbar"` and a
"n% complete" label. Card default height 174px (was 152) for the taller graphic.

History, so it is not rebuilt wrongly: the brief went plain bar → "a truck with 10 bars at its back" (ten
bars + a truck icon) → "container … cab at the right" (ten small containers) → **"just one container,
filled inside it, percentage right next to it"**, which is what ships. The Overview tab's table bars are
unchanged.

## Round of fixes: dashboard header, tab dropdowns, notes, assign-vendors, password, avatar

- **Dashboard header (phone):** the view tabs (SO Board / Overview / Classic) are one full-width row and
  **New SO** is a normal-sized button under it. It used to stretch edge to edge because \`.page-actions\`
  became a grid whose single column filled the row; \`.dash-actions\` is now a flex column and the button
  is \`align-self: flex-start\`.
- **Tab strips are a dropdown on a phone** (\`opcTabDropdowns\`, \`utils.jsx\`; \`.tabs[data-tdd]\`): any
  \`.tabs\` with 4+ tabs — Overview / Line Items + BOM / Procurement / Vendor POs / GRN / Invoicing / Virtual
  Godown / Documents / Audit Log, and the list filters — shows only the **active** tab with a chevron;
  tapping it lists the others, picking one closes the list. DOM attributes (\`data-tdd\`, \`data-open\`) and one
  capture-phase click handler; the tab buttons stay React's, so choosing a tab runs the same code as before.
  Trap: the active tab's own click is swallowed (it would do nothing anyway) to toggle the list; another
  tab's click is left alone and the list is folded by a \`setTimeout(0)\` after React has switched.
- **A page header's small note gets its own line** ("Auto-created on receipt at the Virtual Godown" on GRN),
  the two buttons in a row beneath: \`.page-actions > :not(.btn):not(button)\` spans the grid.
- **Invoicing footer** (\`.inv-foot\`): the "N bundle(s) ready · partial bills your selection…" note takes the
  full width (two short lines at phone width — the sentence is too long for one), then the two buttons share
  the next row.
- **Assign vendors & prices** (\`screens-alloc.jsx\`): the dozen bulk controls (filter, tick, set vendor, we pay,
  client pays, margin %) fold into one **"Filter & bulk edit · N selected"** dropdown (\`OpcGroup\`; always
  open on desktop). The table keeps **Item / Qty / PO amount**; tapping a row opens its **checkbox, Vendor
  select, We pay, Client pays, Margin**. The nested \`max-height\` scroller inside the dialog is released on a
  phone (the dialog is the only scroller) and the footer's totals sentence takes its own lines above the
  buttons. The first dialog (pick an order) wraps its cells so nothing scrolls sideways.
- **Avatar uses the app theme:** the round initials/profile mark was a fixed blue-grey; it is now
  \`color-mix(accent 16%, surface)\` with the accent as text, so it follows the brand colour chosen in
  Customisation.
- **Change password now asks for the current password**, and offers **"Forgot your current password? E-mail
  me a reset link"**:
  - Current password is verified with \`signInWithPassword\` before \`updateUser({password})\`, so a left-open
    session cannot quietly take over the account; the new one must differ and match its confirmation.
  - The reset link is \`auth.resetPasswordForEmail(email, {redirectTo: <this page>})\`. **It only works if the
    self-hosted Supabase (GoTrue) has outgoing e-mail/SMTP configured and this app's address is in its allowed
    redirect URLs** — this could not be tested against the real server. If it is not set up, the error text is
    shown instead of a false "sent".
  - The link returns as \`<page>#access_token=…&type=recovery\`. The URL hash is also the app's router, so
    \`config.js\` catches it first (\`window.__opcRecovery\`), cleans the URL, and \`App\` shows \`RecoveryScreen\`
    (\`screens-auth.jsx\`): sign in with the link's tokens, new password + confirmation (min 8), save, then
    reload into the normal app. An expired/used link says so. Tested with a stand-in auth object, not a real
    e-mail.
- **"Pick the order to buy for" (first Assign vendors & prices dialog):** its third column ("Still to buy") wrapped
  into "all / on / PO" and a right-aligned mono block. On a phone that column is hidden (\`hide-phone\`) and its
  value is shown as a line under the customer's name (\`show-phone\`) — "2 item(s) · 9 unit(s) to buy" in the accent
  colour, or "all on PO" in grey — so the row reads Order | Customer + what is left | Open. Desktop keeps the
  four columns. (\`.hide-phone\` / \`.show-phone\` are the generic pair for this trade.)
- **SO card details block alignment** (PM / Order type / Supervisor / Created / Delivery / Vendors): values were a
  mix of right- and left-aligned and the long ones were cut ("Supply + Implementation + I…"). Cause: the values had
  the \`.trunc\` class (\`max-width: 240px; nowrap\`), so a short value's box stopped short of the column and sat at
  the left of it, while a mono value (no \`.trunc\`) filled the column and went right. The grid is now
  \`auto minmax(0, 1fr)\` and every value (\`.so-extra > span:nth-child(even)\`) is right-aligned to the same edge as
  the figures below, wrapping instead of truncating.

- **Not static:** the fill is the order's own progress (`soMetrics().progress` = the order's stage ÷ the number of
  stages, from its status), recomputed on every render, so a card's container fills further as the order moves
  from Draft → Approved → Procurement … → Closed (0% → 100%). Nothing about the truck is hard-coded per order.
- A hand-supplied HTML/CSS semi truck (blue trailer "FREIGHT", white cab, `<foreignObject>`-scaled) was tried as
  a replacement and **reverted at the user's request**: they wanted the SVG truck's cab ("engine") kept, with the
  container and wheels exactly as they were. Do not swap it in again without asking.
