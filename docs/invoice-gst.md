# Client invoice GST — the real per-line rate, not one flat 18%

**Who:** Billing, Purchase, Collections, Org Admin — anyone who raises or reads a client invoice
**Code:** `invoiceLineGstPct` / `invoiceSameState` / `invoiceTaxFromLines` / `soWeightedGstPct`
/ `soInvoicedTaxable` / `soInvoicedGst` in `screens-billing.jsx`
**Test:** `scripts/uitest/gst-check.js`

---

## What it is

Every category and product carries its own real `gst` field — 5, 12, 18 or
28, the actual Indian GST slabs — populated from a customer's own imported
sheet when their "tax rate %" column says so (`screens-import.jsx`), and
shown back to the user on the product/category list (`{p.gst}%`). Every
client invoice ignored it anyway: six separate invoice-building functions
each independently charged a flat 18% on the whole subtotal, and five more
places (the invoice list, the invoice document itself, a dashboard KPI, the
GSTR export, two separate "raise invoice" actions) each independently
re-derived or re-displayed that same wrong number their own way. Wrong by
however much a real line's rate differed from 18% — invisible for as long
as every product in the catalogue happened to carry exactly 18%, live the
moment one doesn't.

The vendor PO side already got this right (see [po-tax.md](./po-tax.md)) —
real per-line rates, stacked, summed once. This is the client-invoice half
of the same idea, scoped down: GST only, no TDS/TCS (see po-tax.md's own
"Not covered" — withholding tax is a vendor-payment concept, not a
customer-invoice one).

## How it works

### One rate lookup, one tax sum — called from every builder

```js
invoiceLineGstPct(state, refId, categoryId)   // a bundle line's category, or a component line's product — 18 if neither resolves
invoiceSameState(so, state)                   // CGST+SGST within the seller's own state, IGST across states
invoiceTaxFromLines(lines, sameState)         // sums each line's OWN gst_pct × amount, rounds once, splits CGST+SGST or IGST
soWeightedGstPct(so, state)                   // for the one shape with no per-line detail — the order's own lines weighted by value
```

Every line pushed by every builder is stamped with its own `gst_pct` at
build time — read once, from the category or product, never looked up
again later. An issued invoice's tax must not change because a product's
catalogue rate was edited afterward (the same "documents are stamped, not
looked up" rule document-numbering and GRN e-Bills already follow).

**Six builders, same two calls at the end, instead of six copies of
`Math.round(subtotal * 1.18)`:**

| Builder | Reached from |
|---|---|
| `buildInvoice` (bundle / component / final modes) | the Invoicing tab's manual "Raise invoice" |
| `buildFractionInvoice` | `autoInvoiceSO`, fired on every GRN post (when `auto_invoice_on_grn` is on) |
| `buildConsolidatedInvoice` | same auto-invoice call, once supply + implementation are fully billed |
| `buildDispatchInvoice` | a delivery challan, when `outward_dispatch` billing is on |
| `buildBoqInvoice` | a BOQ completing |
| `buildBoqFinalInvoice` | the remainder once every BOQ on an order has billed |

```js
const tax = invoiceTaxFromLines(lines, invoiceSameState(so, state));
const total = subtotal + tax.gst;
// invoice.{subtotal, cgst, sgst, igst, gst, total} — all stamped, all stored
```

`'final'` mode and a true legacy (pre-invoice-object) SO have no per-line
detail to read a rate from — `soWeightedGstPct` instead weights the order's
own lines by value, so a mixed-rate order still lands close to its true
blended rate rather than a flat 18% that ignores every rate on the order.

### Reading, not recomputing

`InvoiceDetail` (the actual tax-invoice document) now reads the STORED
`inv.cgst`/`inv.sgst`/`inv.igst`/`inv.total` when a real invoice object
exists, instead of recomputing `subtotal * 0.09`/`0.18` at view time. Before
this, the printed document independently re-derived its own total from a
live `subtotal` — meaning the moment the builders' math changed (exactly
what this change does), the displayed total could have silently drifted
from what was actually stamped and stored. Only the genuinely legacy case
(an SO invoiced before the invoice-object system existed, nothing stored to
read) computes live, via the same `soWeightedGstPct`, never a flat divisor.

`InvoiceList`'s table and KPI, the dashboard's "GST Liability MTD" KPI, and
the GSTR-1/GSTR-3B exports (`screens-config.jsx`'s Reports pane) all now
read `soInvoicedTaxable(so)`/`soInvoicedGst(so)` — the real sum of each
order's stored invoice `subtotal`/`gst` — instead of backing a taxable
value out of the inclusive total via `/1.18`. The dashboard KPI had a
second, compounding bug on top: it applied `* 0.18` to `invoice_amount`,
which is already GST-**inclusive** — overstating liability by the rate
error and then again by taxing the wrong base.

### Two more "raise invoice" actions, now the same one action

Two places built their own THIRD and FOURTH invoice entirely — not just a
wrong rate, no `so.invoices[]` entry at all, and (on the SO detail page's
own button) a **random, non-deterministic invoice number**
(`Math.floor(Math.random() * 20)`), violating this project's own numbering
rule (see [document-numbering.md](./document-numbering.md)):

- `SalesOrderDetail`'s big "Raise Tax Invoice + EWB" button (the obvious
  next-action on the SO page itself — plausibly the single most-clicked
  invoicing entry point in the app) used to hand-set
  `invoice_amount: subtotal * 1.18` directly, bypassing every builder.
- The "My Tasks" inbox's "Raise invoice" card did the same, with its own
  separate `billedSub` formula that additionally forgot to subtract
  non-billable line/component value — overstating the task card's own
  preview amount on any order carrying a non-billable item.

Both now call `raiseSOInvoice(so.id, { mode: 'final' }, ctx)` — the exact
same entry point the Invoicing tab's manual button uses — and let it decide
the resulting status and notification itself (it already respects
`soReviewStillOpen`, which the SO-detail button's old inline version did
not re-check after raising).

## Why it is that way

**Why GST only, not the PO side's full TDS/TCS stack?** TDS/TCS are
amounts a buyer withholds from or adds to what it pays a *vendor* — they
have no meaning on a document billing a *customer*. Giving the client
invoice the PO e-Bill's full tax-kind picker would add controls for taxes
that structurally cannot apply here. GST (CGST+SGST or IGST) is the whole
of what a client invoice needs.

**Why a weighted average for `'final'` mode instead of per-line detail?**
That mode deliberately collapses the whole remaining balance into one
"Balance of order" line with no component breakdown — it has no single
category or product to read a rate from. A weighted average across the
order's own lines is strictly more correct than a flat 18% guess, without
requiring a deeper restructure of a mode that's an edge path to begin with.

**Why read the stored invoice fields instead of broadening who can
compute tax from a route?** A short-lived earlier version of this fix
considered letting any role with `godown` access open a Sales Order's full
detail page to see its real total. `SalesOrderDetail`'s own Overview tab
renders vendor buy price (`p.buy`) unconditionally, not gated on
`viewCost` — Client Facing, deliberately cost-blind by design (see its own
comment block in `permissions.jsx`), would have gained a working URL
straight to it. Fixed by keeping access exactly where it already was and
only changing what the invoice math itself computes — see
[role-permissions.md](./role-permissions.md) for the general version of
this lesson.

## Traps

- **A presence-only grep for `1.18` will find new instances forever if one
  ever creeps back in.** There is no single switch that proves "nothing
  still hardcodes 18%" — `gst-check.js` instead proves the OUTCOME (a
  mixed-rate order's real total) against six call paths and the display
  layer, which catches a reintroduced flat rate no matter which of the
  eleven places it shows up in again.
- **The consolidated invoice is a second document with the SAME value, not
  additional billing.** `buildConsolidatedInvoice` builds a fresh, full-value
  invoice object even when a partial already billed the same amount —
  correct, because `_nonConsolidatedTotal` explicitly excludes
  `consolidated: true` invoices when summing `so.invoice_amount`. Don't sum
  `so.invoices[].subtotal` across ALL invoices expecting it to equal the
  order value; filter `!i.consolidated` first, the same way the app's own
  total already does.
- **`soFullyReceived` and `soReceivedQty` were two definitions of the same
  question, and had drifted.** Found auditing this exact class of bug:
  `soReceivedQty` (screens-billing.jsx, used for billing/display) subtracts
  units later diverted back to the Master Pool; `soFullyReceived`
  (screens-godown.jsx, gates SO closure) did not. An order that received
  everything and then sent some back to the pool could be closed as "fully
  received" when it no longer held its full requirement. Fixed to subtract
  `soPoolOut` the same way — `gst-check.js` section [8] proves the two now
  agree.
