# Client review — accept or reject what actually arrived

**Who:** Client Facing decides; Purchase re-procures a rejection and closes
**Where:** the SO detail page's Line Items tab (and SCM Tracking, for a role
that cannot reach that page — see below); a rejection also lands in
Purchase's Inbox and reopens the SO Procurement tab / linked Sourcing
**Code:** `frontend/src/screens-client-review.jsx`, the `client_acceptance`
workflow key, `soClientReview`/`soDispatchedQty`/`soReviewStillOpen`/
`soRejectedOutstanding`/`soUnfulfilled` in `frontend/src/utils.jsx`,
`soOutstandingProcurement` in `frontend/src/screens-procurement.jsx`, the
Inbox task in `buildTasks` (`frontend/src/permissions.jsx`)
**Test:** `scripts/uitest/client-review-check.js`,
`scripts/uitest/client-requests-check.js` (the invoicing-vs-review ordering),
`scripts/uitest/so-rfq-check.js` (`canGenerate` reopening after a rejection)

---

## What it is

Some orders end with the customer checking what they actually received against
what they ordered, before the order is treated as settled. Item by item, they
can accept a quantity, reject a quantity, or accept the whole thing in one
click. Purchase sees the outcome and is the one who finally closes the order —
this feature never closes anything by itself.

It is **off for every organization by default**. Where `wf('client_acceptance')`
is not switched on, none of this exists: the status strip is the eight badges it
has always been, the SO detail page shows nothing new, and every function this
document describes is defined but never called.

## How it works

### What counts as "delivered"

`soDispatchedQty(so, state)` sums the item quantities across every delivery
challan raised against the order — the same tally the status strip already
reads to decide "Fully Delivered". One definition, read by both.

### The review itself

`soClientReview(state, so)` is the one function that answers "has the client
signed off on this line". Per item:

```
dispatched   — how much has gone out, ever
accepted     — how much the client has confirmed is right
rejected     — how much the client has confirmed is wrong
pending      — dispatched - accepted - rejected
```

**A unit already decided never comes back to pending.** Accept 6 of 10, then
reject "10" — the reject clamps to the 4 that were still free, not the 10 asked
for. This is the same discipline a BOQ uses for "already committed elsewhere":
a second review can neither reverse nor double-count the first one.

`soApplyClientReview(soId, decisions, ctx)` is the only way any of this gets
written. It reads `soClientReview` **inside the update**, against the live
state, and clamps every requested quantity to what is actually still pending at
that moment — never trusting a number computed before the click. It writes into
`so.extra.client_review.items[product_id] = { accepted, rejected, note }` and
notifies Purchase.

`soAcceptWholeOrder(soId, ctx)` — the one-click "accept whole order" button — is
built on the exact same write: it reads what is pending across every item and
calls `soApplyClientReview` with all of it. There is no second code path for
"the easy case".

### The order status

Two new stages sit in `SO_LIFECYCLE`, strictly between `Fully Delivered` and
`Invoiced`: `Pending Client Acceptance` and `Client Accepted`. `soDerivedStatus`
only ever produces them when `wfOn('client_acceptance')` is true and something
has been dispatched — for every other organization this branch never runs, and
the order's status is computed exactly as it always was.

```
anyDispatched, nothing decided yet         → Pending Client Acceptance
anyDispatched, everything decided,
  nothing rejected                         → Client Accepted
anyDispatched, everything decided,
  something rejected                       → Pending Client Acceptance
                                              (stays — Purchase needs to look)
```

A rejection is not remediated automatically, but it is not a dead end
either: it is recorded with a quantity and an optional note, the order stays
at `Pending Client Acceptance` so it keeps Purchase's attention, and — see
["After a rejection" below](#after-a-rejection--purchase-re-procures-through-the-tools-they-already-use)
— it lands in Purchase's own Inbox and reopens the exact Float RFQ / Vendor
PO screens they already used for the original order, not a manual process
outside the system.

### Confirm & Close

A standalone button next to Hold/Resume on the SO detail page — **not** part of
the shared `NEXT_ACTION` engine that drives the standard lifecycle, so it cannot
affect any other organization's next-action buttons. Visible only when
`wfOn('client_acceptance')` is on, to Purchase and Org Admin. It goes straight to
the existing manual `Closed` state (the same target `Fully Paid → Closed`
already uses) — for an organization running this flow, billing is not yet
decided (see below), so there is nothing to wait for between review and close.

Clicking it when review is incomplete does not silently do the wrong thing: it
toasts and stops, the same soft-block pattern the standard lifecycle already
uses for "cannot close — items not received".

## Why it is that way

**Why gate on a workflow key rather than a role?** Because "does this company
review deliveries before closing" is a fact about the company, not about who is
logged in — the same reasoning behind every other `wf()` key in this app.
Absent means off, so a brand-new organization with no profile behaves exactly as
every organization did before this feature existed.

**Why can two new statuses sit inside the one shared `SO_LIFECYCLE` array without
risking every other organization's lifecycle?** Every comparison in this
codebase is *relative* — `soAdvanceStatus` checks `indexOf(b) > indexOf(a)`,
never an absolute position — so inserting two names between two existing ones
does not reorder anything on either side of them. `client-review-check.js`
asserts this directly: it walks every pair of the original twelve statuses and
checks their relative order is unchanged.

**Why is the panel unconditionally mounted, gated inside itself, rather than
gated at the call site?** The same reason `BOQPanel` was written that way — one
place decides whether the feature is on, so there is exactly one thing to get
right, not one per mount point. This paid off directly: the panel is now
mounted in **two** places — the SO detail page, and `SCMTracking` — and
neither call site had to know or care whether the feature is on. A role whose
entire nav is Item Requests and SCM Tracking (Client Facing on a split-stores
organization) has no way to open an SO detail page at all, so without the
second mount point `client_acceptance` would have been unreachable for the one
role it exists for. Because the panel gates itself, adding the second mount
was a one-line change with no new logic to get wrong.

## Where the code is

| Thing | Where |
|---|---|
| `soDispatchedQty`, `soClientReview` | `frontend/src/utils.jsx` |
| `soReviewStillOpen` — is there still something for the client to decide | `frontend/src/utils.jsx` |
| `soRejectedOutstanding` — how much more to order | `frontend/src/utils.jsx` |
| `soUnfulfilled` — how much the client is still owed | `frontend/src/utils.jsx` |
| `soApplyClientReview`, `soAcceptWholeOrder`, `ClientReviewPanel` | `frontend/src/screens-client-review.jsx` |
| The two new lifecycle stages | `SO_LIFECYCLE` in `frontend/src/utils.jsx` |
| The gated status-strip badges | `frontend/src/screens-so.jsx` |
| Confirm & Close (gated on `soUnfulfilled`) | `frontend/src/screens-so.jsx`, next to Hold/Resume |
| The panel, also mounted on SCM Tracking (for a role that cannot reach the SO detail page) | `frontend/src/screens-scm.jsx`, inside `SCMTracking` |
| The reappearing row, and its badge (no linked Sourcing) | `allocBuildRows`, `VendorAllocator` in `frontend/src/screens-alloc.jsx` |
| `soOutstandingProcurement` — the linked-Sourcing path's version of "how much more, right now" | `frontend/src/screens-procurement.jsx`, feeding `vendorPOGroups` |
| `canGenerate` reopening the SO Procurement tab's Float RFQ / Generate cards past their normal status window | `ProcurementTab` in `frontend/src/screens-so.jsx` |
| The Purchase Inbox task, clearing itself once re-ordered | `buildTasks` in `frontend/src/permissions.jsx` |
| Checks | `scripts/uitest/client-review-check.js` (sections 9–10 for `soRejectedOutstanding`/`soUnfulfilled`/`allocBuildRows`, 14–15 for the linked-Sourcing cycle and the Inbox task), `scripts/uitest/so-rfq-check.js` |

## Traps

- **`utils.jsx` loads before `permissions.jsx`**, and at least one existing
  check sandboxes `utils.jsx` alone. A bare `wfOn(...)` call inside
  `soDerivedStatus` threw `ReferenceError` and failed *every* status assertion
  in the suite, not only the ones about this feature. Guarded the same way
  `soRequired` already is: `typeof wfOn === 'function' && wfOn(...)`.
- **`wf()` reads a global (`window.__opcWorkflow`), not something carried on a
  state object.** A test that builds two fixture states for "flag on" and "flag
  off" has to set the global immediately before each call it makes, or the
  second fixture's construction silently overwrites the flag the first one
  needed. This bit the check's own first draft.
- **`can` is a whole-object override, not a merge.** Granting one extra
  capability to a role, per-organization, means writing out that role's entire
  `can` object in the config override — omit an existing key and it is gone,
  not inherited.
- **"Ordered" and "fulfilled" are different facts, and conflating them breaks
  in opposite directions.** Gate re-ordering on `soUnfulfilled` (nets against
  *accepted*) and Purchase can never place the replacement PO in the first
  place — it never stops reporting the full rejected amount as needed, even
  after the PO exists. Gate closing on `soRejectedOutstanding` (nets against
  *onPO*) and the order becomes closeable the moment a replacement PO is
  merely placed, before the client has it. Each function answers exactly one
  of the two questions; neither may stand in for the other.
- **The extra quantity has to land on exactly one row per product.** A product
  spanning two bundles produces two rows in `allocBuildRows`; adding the same
  `soRejectedOutstanding` figure onto both would double it. It is consumed
  from a shared pool as rows are built, oldest first — the same pattern
  `allocBuildRows` already uses for `onPO`/`pooled`.
- **Invoicing can legitimately outrun the review, and four different places
  used to let it win permanently.** An organization can run
  `invoice_on_dispatch` alongside `client_acceptance` — dm does — so an
  invoice can raise the instant goods leave, before the client has looked at
  anything. `buildDispatchInvoice`/`buildInvoice`/`buildBoqInvoice`/
  `buildBoqFinalInvoice` (`screens-billing.jsx`) all force the SO's *stored*
  status to `'Invoiced'` once an invoice fully covers the order — and because
  `soAdvanceStatus` only ever moves forward, once `so.status` itself said
  `'Invoiced'` (later in `SO_LIFECYCLE` than `Pending Client Acceptance`),
  `soDerivedStatus`'s own review check could never be reached again for that
  order, no matter how open the review still was. An actual end-to-end run —
  client request → convert → vendor PO → GRN → dispatch — caught it directly:
  the status strip jumped straight from "Ready to Dispatch" to "Invoiced,"
  skipping the review stage entirely even though nothing had been reviewed
  yet. `soReviewStillOpen(state, so)` is the one function all four now check
  first; every other organization is unaffected, since it returns `false`
  immediately when `client_acceptance` is off, or when nothing has been
  dispatched yet (nothing to review, so nothing to block).
- **`generateVendorPOsFromSourcing` prepends, it does not append** —
  `vendor_pos: [...pos, ...s.vendor_pos]`. A replacement PO for a rejection
  always lands at index 0, ahead of the original order it is replacing part
  of, not after it. Fine for every real reader (everything here is looked up
  by `so_id`/`product_id`, never by array position) but `client-review-
  check.js`'s own fixtures had to account for it explicitly, and any future
  test asserting "the Nth Vendor PO" needs to as well.

## After a rejection — Purchase re-procures through the tools they already use

A reject is not a dead end. The item's status badge in this panel reads
**Rejected** (or **Partly rejected**) to whoever is looking — Purchase
included — a notification goes to Purchase the moment it is recorded, and a
task lands in Purchase's own **Inbox** (`buildTasks`, `frontend/src/
permissions.jsx`) naming the order, the item and the quantity, with a button
straight into whichever screen actually re-procures it. The task clears
itself the moment a replacement is ordered — nothing to dismiss by hand.

From there Purchase does exactly what they would for any other outstanding
requirement, through whichever of these two doors this organization's order
went through in the first place:

- **A linked Sourcing (dm's flow, [so-float-rfq.md](./so-float-rfq.md))** —
  the SO Procurement tab's "Vendors already selected" card reappears (with an
  amber note explaining why — *"Includes N unit(s) to replace what the client
  rejected"*), pre-priced at the same vendor already chosen, or Purchase can
  open the linked Sourcing and **float RFQ again** / pick a different vendor
  through the identical per-item vendor comparison screen used the first
  time. Nothing about that screen changes for a rejection — it is the same
  screen, reopened.
- **No linked Sourcing** — the manual Procurement / Vendor Allocation screen
  (`VendorAllocator`, `frontend/src/screens-alloc.jsx`) every order can use
  regardless.

Nothing about either screen is specific to a rejection — it is specific to
this: the row (or vendor group) for a fully-covered item **reappears**,
because a rejection is treated as one more unit the order needs.

Two different, deliberately separate questions make this safe:

**`soRejectedOutstanding(state, so)`** — *how much more does Purchase need to
order?* Nets the rejected quantity against what is already on a vendor PO for
that product, beyond the order's original requirement. Placing a replacement
PO satisfies it immediately, even before the goods arrive — its only job is to
stop Purchase ordering the same replacement twice. `allocBuildRows` adds this
onto exactly **one** row per product (never every row a product happens to
span), so the extra quantity is offered once, not multiplied by however many
bundles that product appears in. The row carries `replacementQty`, and
`VendorAllocator` shows a small amber note — *"includes N unit(s) to replace a
rejection"* — so Purchase understands why an apparently-fulfilled item is
asking to be bought again.

**`soOutstandingProcurement(state, so)`** (`frontend/src/screens-procurement.jsx`)
— the same question for the linked-Sourcing path, since `vendorPOGroups` (what
`generateVendorPOsFromSourcing` actually raises) had no such netting at all
before this existed: it grouped the order's raw, original requirement every
time it was called, with nothing stopping it from re-raising the *entire*
original quantity a second time. It nets the original requirement against
whatever is already on a vendor PO for this SO (closing the gap up to that
original amount) and then adds `soRejectedOutstanding` on top (a replacement
PO placed *beyond* that original amount) — the two never overlap, so nothing
is double-subtracted or double-owed. On an SO's very first pass, with no
vendor PO yet, this returns exactly what `soReqComponents` always did — every
existing caller of `generateVendorPOsFromSourcing`, on every organization,
only ever calls it once, so this changes nothing about today's behaviour and
only matters the second time it runs.

**`soUnfulfilled(state, so)`** — *does the client actually have everything the
order requires, accepted?* Nets against what the client has **accepted**, not
against what has been ordered or even dispatched. Placing the replacement PO
does *not* satisfy this — only a fresh delivery challan for the replacement,
reviewed and accepted, does. This is what **Confirm & Close** gates on: a
rejection blocks closing until it is genuinely made good, not merely
re-ordered.

The in/out cycle needs nothing special to run a second time for the same
product against the same SO: receiving is capped by what a specific vendor PO
itself ordered, dispatch is capped by what currently sits in the Virtual
Godown, and `soDispatchedQty`/`soClientReview` already sum **every** challan
ever raised — so a third delivery for a product that has shipped twice before
is visible, and reviewable, exactly like the first.

## Still undecided, tracked elsewhere

- **What happens if the replacement is rejected too** — a second round of the
  same cycle, which the design above already supports without change, but has
  not been exercised.
- **Invoicing** now matches Microlink's `procurement_only` preset
  (`invoice_on_dispatch: true`) — "for now, will change later," per the
  request. See [tenant-dm.md](./tenant-dm.md).
