# The Virtual Godown — one inventory bucket per Sales Order

**Who:** everyone who touches stock — Stores receiving it in, Purchase tracking
it, PM/Supervisor watching a site job draw against it
**Code:** `screens-godown.jsx` — `VirtualGodownList` (the landing page),
`VirtualGodownView` (one SO's own godown, both standalone at `/godown/:id` and
embedded in the SO detail page's own tab)
**Tests:** `scripts/uitest/vg-redesign-check.js`, `scripts/uitest/receipt-engine-check.js`,
`scripts/uitest/receive-check.js` (the receiving logic these screens call)

---

## What it is

Every Sales Order gets its own **Virtual Godown** — a single page answering
"where is this order's stock, right now." Not a real warehouse location:
components for one SO are never mixed with another's, even if they sit in the
same physical bin, because an order's stock is reserved the moment it is
procured or pool-allocated. Isolation is the whole point — a shortage on one
order can never silently eat into a delivery promised to another.

Required quantity reconciles against **six independent sources** per
component: what's been GRN-accepted, what's committed from the Master Pool,
what arrived via a cross-SO transfer, what's on a vendor PO but not shipped,
what's shipped but not yet received, and what's since been diverted back to
the pool. `VirtualGodownView` computes all six (the `enriched` array) in one
place — this is the one definition of "how much does this order still need,"
reused by `soFullyReceived`, `VGImplPanel`, `VGPoolSendPanel`, and the Master
Pool's own "Add from Pool" suggestions. Do not recompute it a second way
elsewhere.

## How it works

### The redesign (2026-10): calm at a glance, nothing removed

The page used to be a single dense table — twelve always-visible numeric
columns, every one wrapped in its own colored badge pill — correct, but
unreadable in under a few seconds. The fix was **presentation only**: every
number, column, panel and interaction the original had is still here, same
data, same handlers, same role gates. What changed:

- A **hero summary** (`.vg-hero` + a `.vg-stats` strip) leads both pages —
  Required / In hand / Remaining / Locked value / Fulfilled %, so the state
  of an order reads in one glance before anyone touches the detail table.
- The dense table's badge-pill overuse is gone — a plain, color-coded number
  (`.vg-num-plain`) replaces a bordered pill wherever the number itself was
  never actually urgent; badges stay only where they're carrying real
  signal (Status, Remaining when non-zero).
- Each row grows a thin, purely **additive** fulfillment bar (`.vg-bar`)
  under the component name — a glance-level summary that sits *alongside*
  the exact numbers, never instead of them.
- `VirtualGodownList`'s dense table became a row list (`.vg-list-row`) with
  the same per-SO fulfillment bar, so scanning many orders feels like
  scanning one.
- Every rule lives under **`.vg-page`**, a class added once to each
  screen's own root element. Nothing in `styles.css` outside that prefix
  changed, so no other screen in the app was touched by this — confirmed by
  the full 22-check suite passing unchanged. `VirtualGodownView`'s embedded
  mode (inside the SO detail page's own tab) gets the `.vg-page` class too,
  even though it skips the page header, so the same look applies whether
  you got here from `/godown` or from an SO's own tab — see
  [Traps](#traps) for the one place this was nearly missed.
- No new libraries, no images, no blur/filter effects — gradients and
  borders only, built from the color tokens `styles.css` already defines
  (`--accent-bg`, `--success-bg`, …). Deliberate: this page is reached
  constantly, often alongside several other tabs on modest hardware, and a
  heavier visual language would have cost real paint time for a page whose
  entire point is to be read in seconds.

### Round 2: responsive, centered, and a real sense of flow

The first pass shipped to a review branch; three things came back from
actually using it — not responsive on tablet/phone, not centered on a wide
monitor, and still reading as "everything in one line." All three fixed:

- **`.page { margin: 0 auto; }`** — global, not `.vg-page`-scoped. A
  `max-width` with no auto margin hugs the sidebar and leaves a dead gap on
  a wide monitor; this is true on every screen in the app, just most
  visible on the one with the boldest new header. Zero risk: centering a
  block that was already width-capped changes nothing about its content.
- **`.split-2to1` gets a real breakpoint** (also global — it's the
  two-column layout six different screens share) — below 860px the 2fr/1fr
  split stacks instead of squeezing both columns unreadably thin. The app
  had **no responsive breakpoints anywhere** before this; a full responsive
  pass on the fixed 220px sidebar shell itself is separate, larger work
  this did not attempt.
- The main table (11+ columns) cannot become phone-width and stay
  readable — no redesign changes that. What it does now is stay contained:
  `.vg-table-scroll` gives it its own horizontal scroll instead of blowing
  out the whole page's layout, and three more `.vg-page`-scoped breakpoints
  (1100/860/600px) reflow the hero, stats and list rows underneath it.
- **A flow diagram was tried and removed.** A `.vg-flow` strip (Master Pool
  → Receiving → *this SO* → Dispatch, four icon nodes on an animated line)
  shipped first, purely decorative, meant to answer "what is this page,
  structurally" in one glance. Seen live on the preview deploy, it read as
  clutter rather than clarity and was deleted — JSX and CSS both, nothing
  left behind. The lesson stays even though the component doesn't: a
  decorative diagram that doesn't read live data earns its space by being
  judged live, not by how it sounds described.
- **The left column stopped being one long vertical line.** The small
  cards (Pending Receipts, Add from Pool above the table; Send to Pool,
  GRN history, Pool history below it) now sit in `.vg-cluster` — a
  `flex-wrap` row, not a rigid grid, specifically because several of these
  panels conditionally render `null` (no pending receipts, no pool stock to
  add) and a flex row collapses gracefully where a fixed grid would leave a
  gap.
- **Pool-first Engine** (right column) is the same six static steps it
  always was, now drawn as a connected vertical timeline (`.vg-steps`) — the
  same "connected nodes" idea the flow diagram tried, applied here to an
  explainer that was already describing a pipeline in words. This one
  stayed; unlike the flow diagram it's labeling real static content, not
  standing alone as pure decoration.
- **A brief flash on success** — receiving a row, adding from the pool, or
  sending to the pool each briefly highlight the row/item that changed
  (`.vg-row-flash` / `.vg-pulse`, ~1.1s, one CSS transition, cleared from
  React state on a timeout so it can never get stuck "on"). No new
  dependency, no animation loop running when nothing just happened.
- Two new icons (`warehouse`, `boxes`) added to the shared `Icon` component
  — purely additive, every existing icon name is untouched. `warehouse`
  stayed in the hero eyebrow on both pages; `boxes` was only used as the
  removed flow diagram's hub icon and is currently unused, left in place
  since it's harmless and may get used again.

### Reading the main table

| column | meaning |
|---|---|
| Component | name, code, and a thin fulfillment bar — all three in one cell now, previously code had its own column |
| Required | `qty × bundle_qty` — see the bundle-quantity trap below |
| On PO | placed on a vendor, this SO's own share only |
| In transit | **measured** from the PO's own LR, not inferred — shipped but not yet received |
| From Pool | committed via "Add from Master Pool" (already counted inside Received) |
| Transferred | net of cross-SO transfers in/out |
| Received | GRN-accepted |
| → Pool | later diverted back out to the Master Pool |
| In hand | net stock this VG actually holds right now |
| Remaining | still to physically receive — this SO cannot close while any row has one |
| Status | Fulfilled → Partial → In transit → On order → Not ordered, derived, never stored |

### Receiving from here

The checkbox + qty column only appears for a role inside this org's
`receiving_flow` (`wfCanReceive`/`wfReceiving`) — see
[receiving-grn.md](./receiving-grn.md) for the full acceptor/requester
mechanics `doMarkReceived` here shares with the PO-centric Receive dialogs.

## Why it is that way

**Why additive (a bar next to the numbers) instead of replacing the numbers
with a picture?** A picture that hides the real figure behind a hover is a
guess presented as fact the moment someone can't hover — a phone, a screen
reader, a screenshot pasted into a WhatsApp message to a vendor. The numbers
stay the primary source; the bar is a reading aid, never the only copy of
the truth.

**Why scope every new rule under `.vg-page` instead of editing the shared
`.card`/`.kpi` classes directly?** Those classes are used on every other
screen in the app. A nicer card here at the cost of a quieter, denser page
like Vendor POs or GRN looking inconsistent elsewhere would have been a
worse trade than the one actually asked for — this page specifically,
nothing else touched.

## Traps

- **The bundle-quantity bug.** Already documented in
  [receiving-grn.md](./receiving-grn.md#traps) — `soRequiredList()` is the
  one definition of "required," multiplying by `bundle_qty`. Do not read
  `line.components[].qty` directly anywhere in this file; every past bug in
  this page came from exactly that shortcut.
- **`VirtualGodownList`'s "from pool" column used to be a hard-coded mock**
  (`so.id === 'so-002' ? 4 : so.id === 'so-001' ? 0 : totalComp * 0.15` —
  three fake branches, none reading real data) — found and fixed while
  rebuilding this page's visuals. It now reads `so.pool_alloc` directly,
  the same field `VirtualGodownView`'s own `enriched` computation already
  trusted. `vg-redesign-check.js` section [1] pins the real number so this
  can't quietly regress back to a guess.
- **Embedded mode needs the `.vg-page` class on its OWN wrapper, not just
  the standalone route's.** The first draft of this redesign made `Wrap`
  `React.Fragment` when `embedded` is true (preserving the original
  no-duplicate-header behavior) but forgot that `React.Fragment` can't
  carry a className — the embedded view (inside an SO's own "Virtual
  Godown" tab) would have silently kept the old look while the standalone
  `/godown/:id` route got the new one. Fixed by giving `embedded` mode its
  own `<div className="vg-page">` wrapper that renders only its children,
  no header. `vg-redesign-check.js` section [4] renders both modes and
  checks the embedded one for the new stats strip specifically, so this
  can't come back silently.
- **A clickable element needs `cursor: pointer` as its own inline `style`,
  not only in `styles.css`.** The keyboard-shortcut layer's "every
  clickable carries a pointer cursor" pass (`keyboard-check.js`) reads an
  element's own `style` attribute, deliberately never the computed/cascaded
  style — checking computed style for every node on every screen would be
  real, measurable cost for a system that runs on every page. The redesign's
  two new clickable `<div>`s (`vg-list-row`, `vg-hero-back`) set the cursor
  in CSS only on the first pass and failed this check immediately — fixed
  by adding the inline `style={{ cursor: 'pointer' }}` alongside the class,
  matching the convention every other clickable row/div in this codebase
  already follows.
- **A class-name assertion that just checks "does this string appear" can
  pass right through a real regression if the class is used more than
  once.** `vg-redesign-check.js` originally asserted `/vg-cluster/` appears
  in `VirtualGodownView`'s markup to prove the card layout changed — but
  there are two clusters (inflow, above the table; outflow, below it), so
  removing ONE of them left the regex still matching the other and the
  check still passing. Caught only by deliberately breaking it and watching
  the check stay green when it should not have — the discipline this
  project already follows for every check, which is exactly what caught
  this one. Fixed by counting occurrences (`.match(/vg-cluster/g).length`)
  instead of testing presence. Worth remembering for any future assertion
  on a class/string that a redesign might legitimately use more than once.
- **A decorative visual that sounds right in text can still read as clutter
  live.** The Round 2 flow diagram was built to spec (connected icon nodes,
  the exact ask) and shipped clean, but the first time it was actually seen
  running — on the branch's own preview deployment, not a description of
  it — it was rejected outright. Removed in full (JSX in
  `screens-godown.jsx`, CSS in `styles.css`, assertions in
  `vg-redesign-check.js`), nothing partial left behind. Don't treat a
  purely-decorative addition as done until it's been seen live; "matches
  what was asked for" and "actually reads well on screen" are not the same
  check.
