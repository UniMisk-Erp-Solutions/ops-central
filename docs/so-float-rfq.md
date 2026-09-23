# Float RFQ straight from a Sales Order

**Who:** Purchase (and PM/Org Admin) — for an organization with no Sourcing/
inquiry step in front of the SO
**Where:** the SO detail page → Procurement tab, above "Create Vendor PO"
**Code:** `SORfqPanel`, `createPOFromRFQQuote` in `frontend/src/screens-so.jsx`;
the `/float-rfq`, `/quote-load`, `/quote-submit` edge function routes in
`supabase/functions/main/index.ts` (unchanged except the org-lookup fallback
below); `rfqs` table
**Test:** `scripts/uitest/so-rfq-check.js`

---

## What it is

In the main flow, Pre-sales floats RFQ from a **Sourcing** record (an
inquiry) — email a shortlist of vendors a private quote link, they price the
items with no login needed, and their numbers land back on the Sourcing
screen for comparison.

Demo Org's flow has no Sourcing step at all: the client sends a request,
Purchase converts it **directly** into a Sales Order (see
[client-requests.md](./client-requests.md)). There was never an inquiry
record to float RFQ from, so Purchase had no way to email vendors for
quotes from inside this app at all — this closes that gap, on the SO
itself: pick vendors, float RFQ, vendors reply, one click turns a reply into
a real Vendor PO.

## How it works

### Floating

`SORfqPanel` (mounted in `ProcurementTab`, gated on `!sourcing` — see below)
lists every vendor and every item still required on the SO
(`procComponentList(so)`, the same list `CreateVendorPOModal` already reads).
Purchase ticks vendors, presses **Float RFQ**, and it calls the *exact* same
edge function endpoint Sourcing's own Float RFQ calls
(`POST /functions/v1/main/float-rfq`) — same vendor-quote email, same
`config.vendor_emails` (an email missing here opens the same
`MissingVendorEmailsModal` Sourcing's screen built, reused rather than
copied), same `rfqs` table row. The only thing that differs is what `src_id`
points at: **this SO's own `id`**, not an inquiry's.

### Where the response lands

A vendor's reply is stored on the `rfqs` row exactly as it always has been
(`vendors[].prices`, `vendors[].status`). `SORfqPanel` reads
`state.rfqs.find(r => r.so_id === so.id)` directly — there is no
Sourcing-specific reconciliation step to wire up, because the row was never
tied to a Sourcing record to begin with. A vendor who has replied shows their
quoted total and a **Create Vendor PO** button; one still waiting shows
"Waiting on reply."

### One click, real prices

`createPOFromRFQQuote(so, vendorEntry, ctx)` builds the Vendor PO straight
from what the vendor actually typed (`vendorEntry.items` × `vendorEntry.prices`)
— the exact same shape `CreateVendorPOModal.submit()` builds by hand: the MD
threshold, `Procurement Started` advance on the SO, the same notification
target. The only difference is `source: 'rfq'` on the PO, so it stays
distinguishable from one typed in manually. A vendor who has not priced
anything yet is refused outright rather than handed a ₹0 PO.

### The manual path is untouched

"Create Vendor PO" — pick a vendor, type prices by hand — is offered right
next to this panel, unchanged. Float RFQ is not a replacement for it; it is
another way to get to the same place, useful when Purchase does not already
know what a vendor will charge.

## Why it is that way

**Why extend the existing edge function instead of writing a second one?**
Because the vendor-facing half — the emailed link, the quote form, "no login
needed," buyer-locked fields — is identical either way; only the question
"which organization does this belong to" needed a second answer. The
function already derives the organization from whatever `src_id` points at
(never from the request body, which is never trusted for tenancy); it now
tries `sourcings` first — **every existing caller, on every organization, is
completely unaffected** — and only falls back to `sales_orders` when that
comes back empty, which only happens when `src_id` was never a Sourcing id in
the first place.

**Why does `SORfqPanel` step aside when a Sourcing record already exists for
the SO?** Because that organization already has a working Float RFQ screen
for that inquiry, and showing a second one on the SO itself would just be two
places quoting the same vendors for the same items. `!sourcing` is the exact
condition "does an RFQ path already exist for this order" — for the main
flow, where every SO comes from a converted Sourcing, this naturally never
shows; for dm, where none do, it is the only path there is.

**Why is `createPOFromRFQQuote` a stand-alone function rather than a button
that just opens `CreateVendorPOModal` pre-filled?** Because "in one click" was
the actual request — pre-filling a modal still asks Purchase to open it,
check it, and press Create. Building the PO directly, with the same shape and
the same safety checks (MD threshold, a vendor who quoted nothing is refused)
gets there in the one click it says it does, without a second, thinner copy
of `CreateVendorPOModal`'s own logic to keep in sync.

## Where the code is

| Thing | Where |
|---|---|
| `SORfqPanel` — vendor pick, float, response table | `frontend/src/screens-so.jsx` |
| `createPOFromRFQQuote` — one-click PO from a quote | `frontend/src/screens-so.jsx` |
| Mounted in `ProcurementTab`, gated on `!sourcing` | `frontend/src/screens-so.jsx` |
| `MissingVendorEmailsModal` (shared, not duplicated) | `frontend/src/screens-sourcing.jsx`, exported on `window` |
| The org-lookup fallback | `supabase/functions/main/index.ts`, `/float-rfq` |
| `rfqs` table (unchanged schema) | `supabase/migrations/` (pre-existing) |
| Checks | `scripts/uitest/so-rfq-check.js` |

## Traps

- **`procComponentList` shows the SO's full required quantity, not what is
  still remaining after existing vendor POs** — the same characteristic
  `CreateVendorPOModal` already has. Floating RFQ a second time after some
  items are already on a PO will ask vendors to quote the full amount again,
  not the shortfall. Not a regression introduced here; consistent with the
  screen it sits next to. Worth revisiting if it becomes a real point of
  confusion, but changing it touches `CreateVendorPOModal` too.
- **The edge function's org-lookup order matters.** The `sourcings` fallback
  must run — and fail — before the `sales_orders` one is even attempted, or a
  `src_id` that happens to collide between the two id spaces would resolve to
  the wrong organization's data. Both use `id text`, and Sourcing ids
  (`src-…`) and SO ids (`so-…`) do not overlap in practice, but the order is
  deliberate, not incidental.
- **Deploying this required restarting the shared SO-PO edge-functions
  container** (`scripts/ssh-deploy-rfq-edge.py`), which serves Float RFQ for
  every organization, not only dm. The change itself is additive (a new
  fallback branch only reached when the existing lookup already returned
  nothing), and the restart only affects the SO-PO service — verified healthy
  immediately after via the script's own health probe.
