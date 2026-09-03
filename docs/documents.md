# The documents we print

Three documents leave the building. All are generated from live data; none is a
template anybody edits by hand.

---

## Vendor PO e-Bill

**Where:** a vendor PO → *View e-Bill* (header), or the **PO e-Bill** card.
**Gated on:** the `e_invoice` capability.
**Code:** `poEbillHtml` / `POEbillModal` in `screens-procurement.jsx`

Columns, matching the layout the team already works in:

```
Sr No. | Part No. | Description | Due on | Unit | Qty | Rate | Tax | Amount with tax
                                                              Grand Total
```

**Tax is the RATE and the amount is INCLUSIVE** — the same pair their own BOQ
uses ("Tax Rate %" / "Total with Taxes"), so the two documents read against each
other line for line. *Due on* is the PO's expected delivery date.

### The preview IS the document

The delivery challan writes its layout twice — once as JSX for the screen, once
as HTML for the printer — which is exactly how a preview stops matching the
paper. The e-Bill keeps **one source**: `poEbillHtml()` produces the markup, the
modal shows *that markup* in an iframe, printing prints the frame. The only
difference between screen and paper is the auto-print script, and the test
asserts they are otherwise byte-identical.

### Numbering

`VPO/FY26/0044 → VPO-EB/FY26/0044` — derived from the PO's own number.

> It used to be a counter over "how many POs already have one", read from a
> stale snapshot, so two POs e-Billed in one action got the **same number**.
> `VPO/FY26/0043` and `0044` are both `VPO-EB/FY26/5005` in the live data.
> Deriving from the PO cannot collide however many are issued at once.

## Delivery challan

**Where:** SCM Tracking → a dispatch → *Delivery Challan*.

Prints in the **customer's** item names, captured at dispatch. Carries the DC
number, the order, transport and LR, and signature blocks. Explicitly prints
*"not a tax invoice"* — it is proof of delivery.

## Tax invoice

**Where:** Invoices, or the order's Invoicing tab.

Prints in the **customer's** item names, with their part number beneath and our
own name below that when the two differ. Raised on dispatch or on receipt
depending on the organization — see [dispatch-invoicing.md](./dispatch-invoicing.md).

---

## Rules for any new document

- **One source for screen and paper.** If you write the layout twice they will
  drift, and the preview becomes a lie.
- **Number from something already unique** (a PO number, an order number), never
  from a count of existing rows read out of a stale snapshot.
- **Name items as the reader knows them** — the vendor's part numbers on a
  vendor document, the customer's on a customer document.
- **Never print our own organisation from the seed.** It named the demo company
  on every tenant's paperwork once already.
