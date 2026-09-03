# Sales order status

**Code:** `soDerivedStatus` / `soEffectiveStatus` / `soAdvanceStatus` in `utils.jsx`
**Test:** `scripts/uitest/status-check.js`

---

## What it is

The strip across the top of a sales order:

```
Draft → Pending Approval → Approved → Procurement Started → Material Received
     → Ready to Dispatch → Partially Delivered → Fully Delivered
     → Invoiced → Payment Pending → Fully Paid → Closed
```

## Why it was rebuilt

It used to move **only** when somebody clicked an approval-gate button, and the
three places that did advance it were gated on the order being *exactly*
`'Approved'`.

An imported order is created as **Draft** and nobody approves it — so it could
never leave Draft. Meanwhile *Material Received*, *Ready to Dispatch* and
*Partially/Fully Delivered* were set by **nothing at all**. Orders sat on Draft
with purchase orders raised, goods received, a challan out and an invoice issued
against them. The strip was decoration, not status.

## How it works now

Status is **derived from the facts**, each of which a user can point at:

| what happened | stage |
|---|---|
| a vendor PO exists | Procurement Started |
| some goods accepted | Material Received |
| everything required is in | Ready to Dispatch |
| a delivery challan went out | Partially Delivered |
| everything dispatched | Fully Delivered |
| an invoice raised | Invoiced |
| part paid | Payment Pending |
| paid in full | Fully Paid |

Stock pulled from the surplus pool counts as received, because it is. A
**Rejected** or **Cancelled** PO does not count as procurement.

## Three rules that keep it safe

1. **Forward only.** A stored status further along is never pulled back.
2. **Never overrides a person.** `Cancelled`, `Rejected` and `Closed` are
   decisions somebody made; no rule overrules them.
3. **Displayed as the furthest of stored-vs-derived.** Orders that already exist
   read correctly with no data migration.

The three procurement gates now advance from wherever the order is, rather than
only from `Approved`, so the stored status keeps up too.

## The order number

`SO/FY26/nnnn` is only a **suggestion**. Purchase type the customer's own
reference — that is the number quoted in email, on the challan and on the
invoice. Duplicates are refused, compared case- and space-insensitively, because
a repeated order number is worse than an ugly one.
