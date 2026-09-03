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

Purchase can now **stack as many taxes as a line needs** — GST *and* TDS, or GST
*and* TCS — set per line, on ticked lines, or on the whole PO in one press, with
the document and Grand Total following as they type.

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

## Taxes stack

A line is not limited to one. `IGST 18% + TDS (Prof) 10% + TCS 0.1%` on ₹1,00,000:

| | |
|---|---|
| IGST 18% | +18,000 |
| TDS (Prof) 10% | −10,000 |
| TCS 0.1% | +100 |
| **net tax** | **8,100** |
| **total** | **1,08,100** |

**Every tax is worked out on the taxable value** — the amount before any tax —
never on a running total.

> Compounding one tax onto another would make the answer depend on the order
> they were added in. GST-then-TDS would differ from TDS-then-GST, and neither
> would be explicable to whoever checks the invoice. The test asserts the two
> orderings give the identical result.

The same kind twice on one line is refused; choosing a kind already present
updates its rate instead. Two IGST rows would silently double the charge.

## How to use it

1. Open a vendor PO → **View e-Bill** → **Tax** tab.
2. **Whole PO:** with nothing ticked, press **+ IGST** (or any kind). It is
   *added* to every line, keeping whatever they already carry.
3. **Some lines:** tick them, then press **+ TDS — Labour**. Only those change.
4. **One line:** use its own **+ add tax…** dropdown; adjust the rate beside each;
   press **✕** to remove one.
5. **Clear taxes** strips them from the ticked lines, or from all if none ticked.
6. **Save tax.** Nothing is committed by opening the dialog — the footer says
   *unsaved tax changes* until you do.

The **Document** tab shows the printed page live, including edits not yet saved,
and printing prints exactly that.

## How it is stored

```json
{ "lines": { "<product_id>": [ { "key": "igst", "rate": 18 },
                               { "key": "tds_labour", "rate": 2 } ] },
  "default": [ { "key": "igst", "rate": 18 } ] }
```

A PO saved before taxes could stack holds a single object rather than a list;
`normaliseTaxes()` reads either, so nothing already issued changes meaning.

in `vendor_pos.tax_config`, deliberately **not** inside `items`. The quantities
and rates in `items` are read by receiving, GRN matching and the profit maths;
an editorial change to a tax code must not disturb them.

A line with no entry falls back to the PO default, and a PO with no config at
all falls back to **IGST 18** — which is what every existing e-Bill was printed
with, so nothing already issued changes meaning.

## Totals

The footer sums the **lines**, never a flat rate, and shows **one row per tax
kind** — an invoice has to say how much GST and how much TDS, not one blended
figure:

```
Taxable value        1,70,000
IGST 18%               27,000
TDS (Prof) 10%         −5,000
CGST+SGST 9+9%          3,600
Grand Total          1,95,600
```

A flat 18% on a mixed PO is wrong by whatever the withholding comes to — the
test carries a three-line example where the difference is 1,000, so it stays
visible.

## Not covered

- **The client invoice still uses a flat 18%.** Only the PO e-Bill has per-line
  tax so far; say the word and the same model goes there.
- Every tax is computed on the taxable value. If your accountant needs TCS on
  the GST-inclusive amount, that is one line in `taxesOn()` — tell me and it
  becomes a per-kind setting.
