# Tax on a purchase order

**Who:** Purchase, PM, MD, Org Admin
**Where:** a vendor PO → **View e-Bill** → the **Tax** tab
**Code:** `TAX_KINDS` / `taxOn` / `poLineTax` in `utils.jsx`; the editor in `screens-procurement.jsx`
**Migration:** `032_po_tax_config.sql` · **Test:** `scripts/uitest/numbering-check.js` (sections 8–11)

---

## What it is

The e-Bill used to charge a flat **18% IGST** on every line. Real purchasing is
not that tidy: within one state a line is **CGST+SGST**, across states it is
**IGST**, and labour or professional charges carry **TDS**, which is *withheld*
from what we pay the vendor rather than added to it.

Purchase can now set the tax **per line**, on **ticked lines**, or on the
**whole PO** in one click, and the document and Grand Total follow as they type.

## The tax kinds

| Key | Shows as | Default | Effect |
|---|---|---|---|
| `cgst_sgst` | `CGST+SGST 9+9%` | 18 | **added** |
| `igst` | `IGST 18%` | 18 | **added** |
| `tds_labour` | `TDS (Lab) 2%` | 2 | **withheld** |
| `tds_prof` | `TDS (Prof) 10%` | 10 | **withheld** |
| `tcs` | `TCS 0.1%` | 0.1 | **added** |
| `none` | `—` | 0 | nothing |

The rate is editable per line — GST is 5 / 12 / 18 / 28 depending on the item —
and a split tax always displays **both halves** (`9+9%`, `2.5+2.5%`), because
that is what the document has to show.

> **The sign is the whole point.** TDS is a deduction. Treating it as a
> surcharge pays the vendor 4% more than they are owed on a labour line and the
> error compounds across every PO. `taxOn()` carries a `sign` per kind, and the
> test asserts TDS *reduces* the total while GST and TCS increase it.

## How to use it

1. Open a vendor PO → **View e-Bill** → **Tax** tab.
2. **Whole PO:** leave the selector on *every line* and press a tax button.
3. **Some lines:** tick them, switch the selector to *ticked lines*, press a tax
   button.
4. **One line:** use its own dropdown, and adjust its rate if needed.
5. **Save tax.** Nothing is committed by opening the dialog or by looking around
   — the footer says *unsaved tax changes* until you do.

The **Document** tab shows the printed page live, including edits not yet saved,
and printing prints exactly that.

## How it is stored

```json
{ "lines": { "<product_id>": { "key": "tds_labour", "rate": 2 } },
  "default": { "key": "igst", "rate": 18 } }
```

in `vendor_pos.tax_config`, deliberately **not** inside `items`. The quantities
and rates in `items` are read by receiving, GRN matching and the profit maths;
an editorial change to a tax code must not disturb them.

A line with no entry falls back to the PO default, and a PO with no config at
all falls back to **IGST 18** — which is what every existing e-Bill was printed
with, so nothing already issued changes meaning.

## Totals

The footer sums the **lines**, never a flat rate:

```
Taxable value   35,000
Tax              5,300     (1,800 + 3,600 − 100 withheld)
Grand Total     40,300
```

A flat 18% would have read 6,300 — wrong by 1,000 on three lines. That
comparison is in the test, so the difference stays visible.

## Not covered

- One tax kind per line. A line carrying both GST *and* TDS is not modelled; say
  if that occurs in practice.
- The client invoice still uses a single 18%. Only the PO e-Bill has per-line
  tax so far.
