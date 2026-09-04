# Document numbering

**Code:** all of it in `frontend/src/utils.jsx`
**Test:** `scripts/uitest/numbering-check.js`

---

## The scheme

| Document | Format | Example |
|---|---|---|
| Vendor PO | `PO` + YYYY + MM + NNN | `PO202609001` |
| Delivery challan | `DC` + YYYY + MM + NNN | `DC202609001` |
| Vendor invoice | the PO's number, re-prefixed | `INV202609001` |
| PO e-Bill | **the same number as the vendor invoice** | `INV202609001` |
| Client invoice | `INV` + the customer's own order number | `INVABG20260117` |
| Billing group (BOQ) | `BOQ` + YYYY + MM + NNN | `BOQ202609001` |
| Sales order | **typed in** — the customer's reference | `ABG/2026/0117` |

## How each one works

### Vendor PO and delivery challan — `PREFIX + YYYYMM + NNN`

The sequence runs **within a year and month**, because the prefix already
carries both. September starts at `001`, October starts at `001` again.

It is derived from **what already exists**, not from a stored counter:

```js
docNo('PO', state.vendor_pos.map(p => p.po_no), TODAY)
```

It scans the numbers already issued for that month and continues from the
**highest**, not from a count. That makes it self-healing — an import, a restore,
or a row deleted by hand cannot leave a counter pointing at a number already in
use.

Numbers are handed out **one at a time**, each aware of the ones issued moments
earlier in the same action:

```js
const nextPo = () => { const n = vendorPoNo(...); __issued.push(n); return n; };
```

Ten POs raised together get ten different numbers. The old code took
`base + i` from a count read once, which is how two POs came to share one
e-Bill number.

### Vendor invoice and PO e-Bill — the PO's own number

Both belong to **one** purchase order, so they are that PO's number wearing a
different prefix:

```
PO202609001  →  INV202609001   (the vendor's invoice AND our e-Bill for it)
```

No counter, so no collision however many are issued at once, stable if
regenerated, and the three documents read against each other at a glance.

An old-format PO still yields something unique
(`VPO/FY26/0044` → `INVVPOFY260044`) rather than failing.

### Client invoice — their order number

`INV` + the sales order number with separators stripped and upper-cased:

```
ABG/2026/0117  →  INVABG20260117
```

The customer matches our invoice against **their** paperwork, so the number they
already use is the one that belongs on it.

> **Multiple invoices per order.** With invoicing on dispatch that is the normal
> case, not the exception — each partial delivery bills separately. The first
> invoice takes the plain number; any further one is suffixed `-2`, `-3`.
> Two invoices sharing a number is a compliance problem, not a cosmetic one, so
> a suffix was unavoidable. **If you want a different separator, say so** — it
> is one line in `clientInvoiceNo`.

### Sales order — not generated at all

Purchase type the customer's own reference. `SO/FY26/nnnn` is offered as a
starting point so nobody is forced to invent one, and duplicates are refused
(case- and space-insensitive). See
[sales-order-lifecycle.md](./sales-order-lifecycle.md).

---

## Rules for any new number

- **Build it in `utils.jsx`.** Two screens inventing two formats for the same
  paper is how the duplicate e-Bill happened.
- **Derive from what exists, never from a count** read out of a stale snapshot.
- **Prefer deriving from a parent document** (the PO, the order) over a counter.
  A derived number cannot collide and needs no coordination.
- **Hand out one at a time** if several are issued in one action.

## What is NOT in this scheme

GRN numbers still use `GRN/FY26/nnnn`. They were not part of the change; say the
word and they become `GRN202609001` alongside the rest.

## Existing records

Numbers already issued are **untouched** — renumbering live documents is a
decision for you, not a side effect of a code change. Two POs still share
`VPO-EB/FY26/5005` from before the fix. Everything issued from now on follows
the scheme above.
