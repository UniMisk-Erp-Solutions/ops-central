# Buying, and pricing what we buy

**Who:** Purchase, Project Manager, Org Admin
**Where:** Vendor POs → *Assign vendors & prices*
**Code:** `frontend/src/screens-alloc.jsx` · **Test:** `scripts/uitest/alloc-check.js`

---

## What it is

A real order is 100+ lines. Picking a vendor and typing a rate on each one is
two hundred interactions, so the job has to be done in bulk or it does not get
done at all. This screen assigns vendors, sets what we pay AND what the customer
pays, and raises every purchase order in one action.

## The insight: the customer's sheet already says how to split it

Their BOQ has a **Po SR No** column — Group A to PO 1, Group B to PO 2. They have
already grouped the items into purchase orders, and the importer keeps that on
every line. So the unit of work here is the **group**, not the line.

## Three ways to assign, by how much they save

| | How | Clicks for 100 lines |
|---|---|---|
| **A. By group** | one dropdown per Po SR group, from the sheet | **~3** |
| **B. Remembered** | the vendor and rate last used are filled in | **0** after the first order |
| **C. Filter + tick** | search, select, apply — for when a group splits | 2–3 per vendor |

A handles the first order, B makes repeat orders nearly free, C is the escape
hatch. They are one screen, not three.

Ticks **clear after Apply**. Leaving them set meant the next Apply silently hit
the same rows again.

## Pricing, both sides

Each row has two boxes side by side:

- **We pay** — the vendor's rate. Pre-filled from `lastBuyOf`: what we actually
  last paid *that vendor* for *that item*, with the date shown.
- **Client pays** — what the customer is charged. Written back onto the order's
  bill of materials.

Plus per-row margin, and a live footer: `client − cost = profit (margin %)`.

Bulk tools, the same as the BOM editor because it is the same job:

- one client price for a whole group, from the group header
- a flat price onto the ticked rows
- **cost + margin %** onto the ticked rows or all of them

Rows with **no vendor rate yet have nothing to mark up**, so they are skipped and
counted in the message rather than silently priced at zero.

## Where the client price lands — the part that had to be right

A row here is one **(order line, component)** pair, so `line_id + product_id`
names the exact BOM component — the same one the SO's own editor edits and the
profit panel reads.

- an item in **two bundles stays two rows**, with their own quantities and
  prices; setting one cannot leak into the other
- the bundle's `unit_price` rolls up with `lineSellOf`, the same rule the BOM
  editor uses, so the two screens cannot disagree
- **only rows actually edited are written** — opening and closing the screen
  changes nothing, so agreed prices are never quietly rewritten
- prices are committed **before** the POs, because they belong to the *order* and
  must stand even if PO generation is abandoned

## Generating the POs

One PO per vendor. The same item in two groups going to the same vendor at the
same rate is merged onto **one** PO line. Existing approval rules still apply —
over the MD threshold still goes to the MD.

Quantities already on a PO, or taken from the surplus pool, are never offered
again.

## Cost, in order of trust

`itemCost(state, product)` returns a number **and where it came from**:

| source | meaning |
|---|---|
| `actual` | we have bought it; this is what we paid |
| `catalogue` | the standard cost on the item |
| `none` | we have no idea yet — and the UI says so |

A guess presented as a fact is worse than a blank, because nobody knows to check
it. Every auto-filled value on this screen shows its origin (`from VPO/0002`,
`last paid 12-Mar-2026`).

## Traps

- A **Rejected** or **Cancelled** PO is never used as a price we paid, and does
  not count as procurement.
- On the very first order nothing has a cost, so `Cost + margin %` will report
  "no vendor rate yet". Type the rates, or raise the POs first.
