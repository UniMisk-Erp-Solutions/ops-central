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
