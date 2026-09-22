# Client review — accept or reject what actually arrived

**Who:** Client Facing decides; Purchase watches and closes
**Where:** the SO detail page's Line Items tab, below the Bill of Materials
**Code:** `frontend/src/screens-client-review.jsx`, the `client_acceptance`
workflow key, `soClientReview`/`soDispatchedQty` in `frontend/src/utils.jsx`
**Test:** `scripts/uitest/client-review-check.js`

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

A rejection is not remediated automatically — there is no return/replace flow
here yet. It is recorded with a quantity and an optional note, the order stays
at `Pending Client Acceptance` so it keeps Purchase's attention, and Purchase
decides what to do about it outside the system for now.

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
right, not one per mount point.

## Where the code is

| Thing | Where |
|---|---|
| `soDispatchedQty`, `soClientReview` | `frontend/src/utils.jsx` |
| `soRejectedOutstanding` — how much more to order | `frontend/src/utils.jsx` |
| `soUnfulfilled` — how much the client is still owed | `frontend/src/utils.jsx` |
| `soApplyClientReview`, `soAcceptWholeOrder`, `ClientReviewPanel` | `frontend/src/screens-client-review.jsx` |
| The two new lifecycle stages | `SO_LIFECYCLE` in `frontend/src/utils.jsx` |
| The gated status-strip badges | `frontend/src/screens-so.jsx` |
| Confirm & Close (gated on `soUnfulfilled`) | `frontend/src/screens-so.jsx`, next to Hold/Resume |
| The reappearing row, and its badge | `allocBuildRows`, `VendorAllocator` in `frontend/src/screens-alloc.jsx` |
| Checks | `scripts/uitest/client-review-check.js` |

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

## After a rejection — Purchase re-procures through the tools they already use

A reject is not a dead end. The item's status badge in this panel reads
**Rejected** (or **Partly rejected**) to whoever is looking — Purchase
included — and from there Purchase does exactly what they would for any other
outstanding requirement: float RFQ, or pick a vendor directly and place the PO
again, through the same Procurement / Vendor Allocation screen every order
uses. Nothing about *that* screen is specific to a rejection — it is specific
to this: the row for a fully-covered item **reappears**, because a rejection
is treated as one more unit the order needs.

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
