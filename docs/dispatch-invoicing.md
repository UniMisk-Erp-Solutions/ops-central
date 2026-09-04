# Goods out — dispatch, challan and the client invoice

**Who:** Stores / Purchase / Org Admin
**Where:** SCM Tracking → *Out for delivery*
**Code:** `screens-scm.jsx`, `screens-billing.jsx`
**Test:** `scripts/uitest/dispatch-invoice-check.js`

---

## Out for delivery

Tick the lines that are going, set the quantity — capped at what the Virtual
Godown actually holds — add transport details, and a **delivery challan**
(`DC/OUT/nnnn`) is created.

Dispatch is **partial by nature**. A line can legitimately read
`Received 10` and `Out for delivery 5` at the same time, and SCM Tracking shows
both chips together.

The customer's own wording for each item is **captured onto the challan at
dispatch**, not looked up when printing. A delivery note is a historical
document and must not change if a mapping is edited next month.

## The invoice is raised on DISPATCH

```
invoice_on_dispatch = false   standard — bills on GRN, unchanged
invoice_on_dispatch = true    procurement-only — bills per delivery challan
```

Invoicing on receipt charges the customer for goods still sitting in our own
godown. A trading company bills what it actually **shipped** — and a dispatch is
the only point where the quantity is final.

Absent reads as false, so an organization that has never heard of the key
behaves exactly as it does today.

### Unless the order has billing groups

If the order carries **BOQs**, they decide what is invoiced, not the challan. A
dispatch bills every BOQ that has just become complete, and bills nothing at all
if none has. An order with no BOQ bills per challan exactly as described here.
See [boq-billing.md](./boq-billing.md).

### The name

Each line is named as **the customer ordered it** — their description and part
number — with our name kept alongside for the warehouse. They reconcile our
invoice against their own purchase order; billing in our wording makes that
document unmatchable at their end.

This applies to **every** invoice, not only the dispatch one. The receiving-path
invoice (`qty-proportional`) had to be fixed for the same reason.

Names are **stamped when the invoice is built**. Invoices raised before that
existed have no stamp, so the renderer resolves them live from the order — which
is why documents already issued still read correctly.

### The money

- priced from **the order's own per-item prices**, so it agrees with the profit
  panel
- **partial dispatch → Partial invoice**; the last one closes as **Final**
- **capped** at what is still uninvoiced — a fat-fingered dispatch cannot bill
  more than the order is worth
- the **same challan can never be billed twice** (`dc_id` on the invoice)
- an **unpriced** order raises **no** invoice, not a ₹0 one, and the toast says
  which of the two happened

The invoice is raised **after** the challan is committed. If invoicing fails or
there is nothing to bill, the dispatch still stands — goods left the building
either way and that fact must not depend on the paperwork.

## Traps

- Prices must exist first. On a fresh order the toast reads *"no invoice: these
  items have no price yet"*. Set them in **Edit line items**, or via
  [vendor-po-pricing.md](./vendor-po-pricing.md).
- The delivery challan explicitly prints *"not a tax invoice"*. It is proof of
  delivery, not a bill.
