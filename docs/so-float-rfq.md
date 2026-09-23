# Vendor comparison & Float RFQ for an SO with no inquiry step

**Who:** Purchase (and PM/Org Admin) — for an organization with no Sourcing/
inquiry step in front of the SO
**Where:** the SO detail page → Procurement tab → "Compare vendors & Float
RFQ," which opens the same per-item vendor comparison screen Pre-sales
already uses
**Code:** the linked-Sourcing block in `ClientRequestDetail.convert()`
(`frontend/src/screens-client-requests.jsx`); the `canGenerate`/"Compare
vendors" additions to `ProcurementTab` (`frontend/src/screens-so.jsx`); the
org-lookup fallback in `supabase/functions/main/index.ts`
**Test:** `scripts/uitest/so-rfq-check.js`

---

## What it is

In the main flow, Pre-sales floats RFQ from a **Sourcing** record (an
inquiry): a per-item grid comparing every candidate vendor's price —
estimated, or real once quoted — cheapest first, with the chosen vendor
highlighted; "Add vendor & quote" for a price typed in by hand; "Float RFQ"
to email a shortlist a private quote link (no login needed on their side);
their reply lands back in the same grid automatically.

Demo Org's flow has no Sourcing step: the client sends a request, Purchase
converts it **directly** into a Sales Order (see
[client-requests.md](./client-requests.md)). There was never an inquiry for
Purchase to compare vendors or float RFQ from — this gives them the exact
same screen anyway, by linking a real Sourcing record to the SO the moment
it is created.

## How it works

### One real screen, not a second one

`ClientRequestDetail.convert()` builds a `sourcings` row alongside the new
SO — same `lines` shape an SO's own bundle lines already use (`{bundle_qty,
components: [{product_id, qty}]}`, so every existing reader of a Sourcing's
lines needs no change at all) — and sets `converted_so_id` to the new SO's
id. `soSourcing(state, soId)` (`screens-procurement.jsx`) already finds a
Sourcing by exactly that field; nothing about that lookup is dm-specific.

Two things make it a genuine **workspace**, not a second customer-facing
inquiry:

- **`status: 'Vendor Sourcing'`, never `'Converted'`.** `locked = src.status
  === 'Converted'` (`screens-sourcing.jsx`) hides every action button —
  Add vendor & quote, Float RFQ, Allocate, Save quotation — the instant a
  Sourcing is marked Converted. Using any other status keeps the whole
  screen live.
- **Purchase is not in `canConvert`** (`['Sales', 'Pre-sales', 'Org
  Admin']`), so there is no path from this screen back through "Convert to
  SO" a second time — the real SO already exists.

### "Send to Sales" becomes "Create Vendor PO(s)"

On a normal inquiry, once vendors are compared and priced the next step is
handing it to Sales to raise the order. Here the order already exists, so
that button would be a dead end — it now reads **"Create Vendor PO(s)"**
instead, and does the SO Procurement tab's own one-click generation *from
this screen*, without navigating away: it saves whatever was just picked
(same write "Save vendor quotation" already does), then calls the identical
`generateVendorPOsFromSourcing` the Procurement tab's own button calls.

The swap is keyed on one thing: `isSoWorkspace = !!src.converted_so_id`. In
the main flow, `converted_so_id` is only ever set together with `status:
'Converted'` (`ConvertToSOModal`) — which already hides every action button
via `locked`. So a *visible* "Send to Sales" button with `converted_so_id`
already set can only happen on the record this feature itself builds; no
tenant or organization check was needed to scope it correctly. The normal
"Create Sales Order" convert button is hidden the same way, for the same
reason — the SO it would create already exists.

From the SO's Procurement tab, a **"Compare vendors & Float RFQ"** card
appears whenever the linked Sourcing exists and nothing has been picked on
it yet, opening `sourcing/<id>` — the identical screen shown for the main
flow's own inquiries. Purchase can tick a different vendor **per line
item** there exactly as Pre-sales already can, either by typing a price in
("Add vendor & quote") or by floating RFQ and waiting for a reply.

### One click, per vendor, from whatever was picked

Once vendors are chosen (`sourcing.picks[product_id] = vendor_id`, one pick
per item — different items can go to different vendors) or split across
several (`sourcing.alloc`), the Procurement tab's **"Generate N Vendor
PO(s)"** button calls the exact function the main flow already uses,
unmodified: `generateVendorPOsFromSourcing` groups every required product by
its chosen vendor and raises **one PO per vendor**, each carrying only that
vendor's items, at the price captured on the Sourcing — the same MD-approval
threshold and SO-status advance every other Vendor PO already gets.

### Falling back gracefully

`canGenerate` now also allows the SO to be at `'Draft'` — where a converted
request's SO sits until its first Vendor PO exists (see
[client-requests.md](./client-requests.md)'s note on the approval stage
being bypassed by design). Every organization that creates SOs at `'Pending
Approval'` directly (`SalesOrderNew`) never has one sitting at `Draft`, so
this changes nothing for them. The manual **"Create Vendor PO"** button —
pick one vendor, type prices by hand — stays right next to all of this,
completely unchanged; Float RFQ is another door into the same room, not a
replacement.

## Why it is that way

**Why link a real Sourcing instead of building a smaller RFQ panel directly
on the SO?** The first attempt at this was exactly that — a compact panel
with its own vendor-selection state, calling the Float RFQ edge function
directly. It worked, but it was a second, thinner implementation of
something the app already does well: per-item vendor comparison, multiple
vendors at once, a price typed in or a real quote either way. Linking a real
Sourcing record means Purchase gets the *exact* screen shown in the main
flow — the same layout, the same "cheapest first" ordering, the same "Add
vendor & quote" — for the cost of one object built at conversion time, and
any future improvement to that screen reaches dm for free too.

**Why does the edge function still have the `sales_orders` org-lookup
fallback, if RFQ is always floated from a real Sourcing now?** It is no
longer on the critical path for this feature — a real Sourcing id resolves
through the original `sourcings` lookup exactly like any other inquiry — but
the fallback is harmless (only reached when that lookup already returned
nothing) and worth keeping as a safety net for whatever floats RFQ from
something else next.

**Why is `order_type`/`implementation` left off the linked Sourcing's
object, when `SourcingNew` sets them?** They are not real columns on
`sourcings` — checked directly against the live schema. `SourcingNew`
setting them costs nothing (the sync layer silently drops columns that
don't exist), but there is no reason to carry fields that mean nothing here.

## Where the code is

| Thing | Where |
|---|---|
| The linked Sourcing, built at conversion | `ClientRequestDetail.convert()`, `frontend/src/screens-client-requests.jsx` |
| `soSourcing`, `vendorPOGroups`, `generateVendorPOsFromSourcing` (unmodified, reused) | `frontend/src/screens-procurement.jsx` |
| `canGenerate`'s `'Draft'` allowance, "Compare vendors & Float RFQ" entry point | `ProcurementTab`, `frontend/src/screens-so.jsx` |
| The vendor comparison grid, "Add vendor & quote," Float RFQ (unmodified, reused) | `SourcingDetail`, `frontend/src/screens-sourcing.jsx` |
| `isSoWorkspace`, `generateFromHere` — "Create Vendor PO(s)" in place of "Send to Sales" | `SourcingDetail`, `frontend/src/screens-sourcing.jsx` |
| The org-lookup fallback (defensive, not on the critical path) | `supabase/functions/main/index.ts`, `/float-rfq` |
| Checks | `scripts/uitest/so-rfq-check.js` |

## Traps

- **`locked` is keyed on the literal string `'Converted'`.** Any other
  status value keeps the screen fully interactive — which is exactly what
  makes this workspace pattern possible, but also means a typo in the
  status string here would silently either lock a workspace that should
  stay open, or leave a *genuinely* converted inquiry editable. `'Vendor
  Sourcing'` is deliberately not a status any other part of the app writes.
- **`sourcings.lines` and an SO's `lines` share a shape, not a table.**
  They are independent copies from the moment `convert()` runs — editing
  one does not touch the other. That is correct here (the Sourcing is a
  point-in-time comparison workspace, not a live mirror of the order), but
  is worth remembering if the SO's own lines are edited later.
- **`order_type` and `implementation` are not real `sourcings` columns** —
  confirmed against the live schema (`information_schema.columns`), not
  assumed from `SourcingNew`'s own object literal, which sets them anyway
  (harmlessly filtered out by the sync layer before the write).
- **Every hook `SourcingDetail` owns must be declared before its `if (!src)
  return <div>...` guard, with no exception.** The component has that one
  early return partway through its body; a hook added anywhere after it (as
  `genBusy` briefly was, next to `generateFromHere`) is skipped on every
  render until `src` loads, then suddenly called once it does — React throws
  "Rendered more hooks than during the previous render" and the page whites
  out, every single refresh. `so-rfq-check.js` section [7] statically checks
  this: no `React.use*()` call may appear in the component's source after
  that guard. Add new state to the hook block already sitting at the top of
  the component, never further down near the feature that uses it.
