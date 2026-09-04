# BOQ — Billing Order Quantity

## What it is

The **BOM** says what an order *contains*. The **BOQ** says what gets *billed
together*.

Purchase carve the bill of materials into billing groups — `BOQ202609001`,
`BOQ202609002`, and so on, as many as the order needs. Each group becomes one
client invoice, and it is raised **only when every item in that group has been
dispatched**.

> BOQ 001 holds 10 items · all 10 dispatched → partial invoice raised
> BOQ 001 holds 10 items · &nbsp;7 dispatched → **nothing**, it waits

That last line is the whole reason the feature exists. Billing per delivery
challan invoices whatever happened to be on the lorry that morning. Billing per
BOQ invoices what the customer *agreed to be billed for*, at the moment the last
piece of it goes out the door.

It lives in the same section as the Bill of Materials on the sales-order detail
page, directly under the profit panel — the place where somebody looking at what
the order contains will also decide how it should be billed.

## How it works

### Creating one

`Create BOQ` opens a picker over everything on the order that is not already in
a BOQ. It is built for the hundred-line case:

- items are grouped under the customer's own PO serial and equipment heading, so
  **ticking one heading takes the whole group**
- a single row can then be adjusted or dropped; the quantity box is capped at
  what is free
- **Everything still unbilled** takes the entire remainder in one click
- a filter box narrows a long sheet
- the footer counts `items · units · value` live, and warns when nothing in the
  selection has been priced yet

The BOQ is saved onto the order at `so.extra.boqs`:

```js
{ id, no: 'BOQ202609001', label, date, status: 'Open', created_by,
  items: [{ line_id, product_id, qty }] }
```

Purchase, Project Manager, Billing and Org Admin can create and cancel one.

### The two rules that make the arithmetic safe

**An item belongs to at most one BOQ.** Otherwise the same goods are billed
twice. Whatever is committed elsewhere is subtracted from what a new BOQ may
claim, and the picker shows `On order · In other BOQs · Free` on every row so the
number can never drift from what will actually be saved. Cancelling a BOQ
releases its units back.

**Dispatches are allocated oldest BOQ first.** A delivery challan records the
*item*, not the BOQ it was meant for. So when six switches arrive and BOQ 001
needs five while BOQ 002 needs three, 001 is filled completely and 002 gets the
one left over. First created, first satisfied — deterministic, and a later BOQ is
never closed by goods that belong to an earlier one.

### Billing

A dispatch (`OutwardDispatchModal`) calls `invoiceReadyBoqs`, which walks the
order's BOQs oldest-first and bills each one that has just become complete. One
BOQ, one invoice, priced at the order's own per-component rates and written in
**the customer's wording** — the same rule the rest of the billing code follows,
taken from the exact order line the BOQ item names.

The invoice is stamped with `boq_id`/`boq_no`, and the BOQ is stamped back with
`invoice_no`. Either stamp alone is enough to stop it billing twice.

When every BOQ on the order has fired, `buildBoqFinalInvoice` sweeps up whatever
else has been **dispatched** and never billed — items Purchase left out of every
billing group — into one closing invoice. Goods still sitting in the godown are
not in it; nothing is billed before it ships. If the BOQs covered the whole
order there is no remainder, and the last BOQ invoice is itself already typed
`Final`.

An order with **no** BOQs bills per delivery challan exactly as it did before
this feature existed. Nothing changed for those orders.

### Where the numbers come from

`boqNo()` in `utils.jsx`, on the one document-numbering scheme:
`BOQ` + year + month + sequence → `BOQ202609001`, restarting each month, derived
from the numbers that already exist rather than from a count. See
[document-numbering.md](./document-numbering.md).

## Why it is that way

**Why not bill a partially-dispatched BOQ pro-rata?** Because the customer
raised their purchase order against a package. Seven of ten switches is not
seventy per cent of a working core; billing it invites a dispute and a credit
note. The group is the unit of agreement, so the group is the unit of billing.

**Why can an item sit in no BOQ at all?** Forcing full coverage would mean
Purchase could not create the first BOQ until they had decided the shape of every
later one. The panel shows `N unit(s) not in a BOQ` as a warning badge, and the
Final sweep catches the remainder, so nothing is silently lost.

**Why oldest-first rather than proportional allocation?** Proportional leaves
two BOQs each at ninety per cent and neither billable, which is the worst
outcome for cash flow. Oldest-first always closes something.

**Why is progress shown for an incomplete BOQ?** Because "not billed" and
"nothing is happening" look identical otherwise, and somebody would go looking
for a bug. The bar reads 90% and stays unbilled, which is the intended behaviour
made visible.

**Why compute the billing run inside `mutate`?** `state` captured in an async
handler is a stale snapshot, and each invoice changes what is left to bill for
the next one. The whole run happens against the live state, one BOQ at a time.
This is the trap that produced duplicate invoice numbers before.

## Where the code is

| Thing | Where |
|---|---|
| Engine — free quantity, allocation, progress, value | `frontend/src/screens-boq.jsx` |
| `BOQPanel`, `CreateBOQModal` | `frontend/src/screens-boq.jsx` |
| `buildBoqInvoice`, `buildBoqFinalInvoice`, `invoiceReadyBoqs` | `frontend/src/screens-billing.jsx` |
| Dispatch trigger | `frontend/src/screens-scm.jsx` (`OutwardDispatchModal`) |
| `boqNo` | `frontend/src/utils.jsx` |
| Panel mount, beside the BOM | `frontend/src/screens-so.jsx` |
| Checks | `scripts/uitest/boq-check.js` |

## Traps

- **`boqOrderRows` multiplies by `bundle_qty`.** A component quantity on a line
  is *per set*. Four switches on a two-set line is eight switches. This is the
  same bug that once made receiving post a sixth of an order — see
  [receiving-grn.md](./receiving-grn.md).
- **A row is keyed by line *and* product.** The same item in two bundles is two
  rows and can go into two different BOQs, with two different customer
  descriptions.
- **`boqDispatched` sums per product, not per line**, because a challan does not
  record the line. The per-line split is then re-derived by the same oldest-first
  rule.
- **Over-dispatch does not inflate a BOQ's `got`.** Each BOQ takes at most what
  it needs from the pool.
- **The invoice cap still applies.** A BOQ invoice is clamped to what the order
  has left to bill, so BOQs that overlap a manual adjustment can never bill more
  than the order is worth.
