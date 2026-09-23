# Goods out — dispatch, challan and the client invoice

**Who:** Stores / Purchase / Org Admin / Stores Out
**Where:** SCM Tracking → *Out for delivery*
**Code:** `screens-scm.jsx`, `screens-billing.jsx`
**Test:** `scripts/uitest/dispatch-invoice-check.js`, `scripts/uitest/dispatch-queue-check.js`

---

## Finding what needs to go out: the "Ready to dispatch" queue

Receiving already put a queue in front of whoever accepts it
(`PendingReceiptsPanel` — see [receiving-grn.md](./receiving-grn.md)): exactly
what confirmed as arrived, right at the top of the GRN screen, one Accept
click away. Dispatch had no equivalent. SCM Tracking is a per-order
drilldown with a plain dropdown that defaults to whichever order happens to
load first — nothing on the page said *which* order actually had stock
sitting in the Virtual Godown, waiting to go out.

That is invisible to a role whose whole job is dispatch and nothing else,
with no reason to open Sales Orders and go looking. They open SCM Tracking,
land on an unrelated or already-closed order, see nothing to do, and
reasonably conclude there is no way to dispatch anything at all.

`ReadyToDispatchPanel` (`screens-scm.jsx`) is the outward twin of
`PendingReceiptsPanel`: every non-cancelled sales order with at least one
product actually in the Virtual Godown (`scmLineTotals(...).inVG > 0`),
listed with the customer, the items and quantities ready, and a **Dispatch**
button that opens the same `OutwardDispatchModal` the manual flow already
uses, pre-selected onto that order. It changes nothing about how a dispatch
is actually made — same checkboxes, same quantity caps, same challan — it
only removes the need to already know which order to pick.

**Scoped to `role === 'Stores Out'`, not to `canDispatch` in general.**
Purchase, Stores, Org Admin and Managing Director (`SCM_ROLES`) already had a
working path to *Out for delivery* before this panel existed — their screen
is untouched, byte for byte, whatever organization they are on. Scoping by
role rather than by organization means this is not hard-coded to any one
tenant: any organization that creates a **Stores Out** role (the
`split_stores` workflow profile's dedicated outward team — see
[tenant-dm.md](./tenant-dm.md)) gets the same queue for free. Microlink
(`procurement_only`) has no Stores Out user and no permissions override at
all, so nothing on its screen changes — proved in
`dispatch-queue-check.js` by rendering the same screen for both role sets and
asserting the panel's own text is present for one and absent for the other.

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
  more than the order is worth. This is also what stops a client-review
  rejection's replacement shipment from ever billing the customer twice —
  see [client-acceptance.md](./client-acceptance.md#the-replacement-never-re-bills-the-customer)
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
- `ReadyToDispatchPanel` is a **shortcut into the existing modal, not a second
  write path.** It has no logic of its own for picking items or quantities —
  clicking *Dispatch* just pre-selects the order and opens
  `OutwardDispatchModal` exactly as the manual dropdown + button already did.
  Anything added to the real dispatch flow needs no matching change here.
