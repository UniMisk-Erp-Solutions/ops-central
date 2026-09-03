# Customer sheet → Sales Order

**Who:** Purchase, and Org Admin. Nobody else.
**Where:** Sales Orders → *Import customer sheet*, and Item Name Mapping → same button.
**Code:** `frontend/src/screens-import.jsx` · **Test:** `scripts/uitest/import-check.js`

---

## What it is

Microlink's customer sends a BOQ as an Excel sheet. Purchase turn that sheet
into an order of ours. Typing a hundred lines by hand is not a workflow, so the
sheet is read directly.

## The sheet

```
Type of Equipements │ Sr. No. │ Part No.        │ Item Description         │ Unit │ Qty │ … │ Po SR No
────────────────────┼─────────┼─────────────────┼──────────────────────────┼──────┼─────┼───┼─────────
Group A: Core Switch - Cisco Catalyst C9600 Series                              ← banner
Cisco Catalyst 9600 │ 1       │ C9606R          │ 9600 Series 6 Slot …     │ Nos. │  1  │   │    1
Series 6 Slot        │ 1.0.1   │ CON-SNTP-C9606R │ SNTC-24X7X4 …            │ Nos. │  1  │   │
Chassis (merged ↕)   │ 1.15    │ C9600-PWR-2KWAC │ 2000W AC Power Supply    │ Nos. │  4  │   │
                     │ 2       │ C9606-RACK-KIT= │ Rack Mount               │ Nos. │  1  │   │
                              Group A - Total                                   ← subtotal
```

## How it works

**Columns are matched by NAME, not position.** Exact match first, then
substring, all case-insensitive. A sheet with the columns in a different order,
or spelled slightly differently, still imports. The header row is found by
looking for a Qty column plus a Part No. or Description column, so title rows
above it are skipped.

**The Sr. No. is a hierarchy.** `1` is the chassis; `1.0.1` … `1.17` are the
licences, modules, fans and cables inside it. A leading integer starts an order
line; every `1.x` under it becomes a component of that line. Flattening them
into separate lines would destroy the bill of materials, which is the entire
point of the sheet.

**Merged cells arrive blank.** *Type of Equipements* and *Po SR No* are written
once and merged downwards, so every row after the first reads as `''`. Both are
carried forward.

**Banners and subtotals are not items.** `Group A: …` sets the current group;
`Group A - Total`, `Sub Total` and `Grand Total` are skipped.

### The quantity trap — read this one

Group A is **one** chassis whose parts read 1 / 2 / 4 / 20.
Group B is **six** switches whose every sub-line **also** reads 6.

Those are *6 sets of 1*, not 36 units. The line stores `bundle_qty` = the
parent's quantity and each component **per set**:

```
bundle_qty = parent qty          component qty = row qty / bundle_qty
```

Group A → bundle 1, quantities unchanged. Group B → bundle 6, each child 1.
Getting this wrong silently multiplies an order by six, so it is asserted
explicitly in the test.

### Numbers

`₹  -  ` reads as **0**, not NaN — the accounting dash for nil is everywhere in
these sheets. `18%` reads as `18`. CSV is split honouring quotes, because
descriptions contain commas.

---

## Matching items — and building the catalogue

Each Part No. is resolved to one of our items: **their part number → their
description → our code → our name** (see
[item-name-mapping.md](./item-name-mapping.md)).

This runs as **one batch call**, not one per row. It used to be a round trip per
row, awaited in sequence — a 500-line BOQ meant 500 trips over the tunnel, then
500 more to write the mappings back. Identical rows collapse to one lookup,
anything already in our catalogue is settled locally with no call at all, and
the rest goes to `opc_alias_resolve_bulk`. `ssh-verify-alias-bulk.py` proves the
batch matcher returns the same answers as the one-at-a-time version.

**Nothing is guessed silently.** Every row shows **matched / new item / skip** in
a preview and can be repointed at an existing item before anything is created.

Because Microlink started with an empty catalogue, the import can **build** it:

- an unmatched Part No. becomes an item, with the Part No. as our code
- each *Type of Equipements* becomes a category with a reusable BOM
- every row is written back as **that customer's alias**, so the same sheet next
  quarter matches itself

## The order number

Typed in, not generated. The suggested `SO/FY26/nnnn` is offered as a starting
point but Purchase overwrite it with the customer's own reference — that is the
number quoted in email, on the challan and on the invoice. Duplicates are
refused (case- and space-insensitive).

## What you get

A **Draft** order whose lines mirror the sheet's own structure, each carrying a
`customer_ref` — their Sr. No., part number and description, verbatim. That is
what later prints on their invoice, so it is stored, not looked up.

---

## Traps

- **The customer must be chosen or created.** A brand-new organization has no
  customers, so the dialog offers *"+ Add a new customer"*. It once required a
  customer before the file input would enable, with an empty list — a dead end.
- **Choosing the customer after loading the file re-runs the match**, because
  their own part numbers are the strongest signal available.
- Excel stores `1.10` as the number `1.1`. Two sub-rows can therefore arrive
  with the same Sr. No.; both still belong to their parent, which is what
  matters.
