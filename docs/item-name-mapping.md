# The three-name chain

**Where:** Item Name Mapping (Purchase, Org Admin)
**Code:** `item_aliases` table + `opc_alias_*` RPCs · `frontend/src/screens-mapping.jsx`
**Migrations:** `026_scm_mapping_dispatch.sql`, `029_alias_bulk.sql`

---

## What it is

One physical item carries three different names:

```
customer's wording  ──▶  OUR item  ──▶  vendor's part number
  (their BOQ)          (the truth)      (what the PO prints)
```

The customer orders "CORE SWITCH CHASSIS - 6 SLOT" under their code
`ABG-NW-001`. We call it `C9606R`. The vendor invoices it as `C9606R=`. All
three are the same box. With 10 000+ vendors this cannot be retyped per order.

## How it works

`item_aliases` stores the **outer two** names against our internal `product_id`,
keyed by party:

| column | meaning |
|---|---|
| `product_id` | OUR item |
| `scope` | `customer` or `vendor` |
| `party_id` | which customer / which vendor (null = generic) |
| `alias_code` | their part number |
| `alias_name` | their description |
| `uom` | their unit, if it differs |

One row per `(organization, product, scope, party)`, with indexes for both
directions.

### Forward — "what does this party call our item?"

`opc_alias_map(scope, party_id)` → `{ product_id: { code, name, uom } }`

Used by the **vendor PO** when the organization runs `po_item_language: vendor`,
and by the **delivery challan** to print in the customer's words.

### Reverse — "an imported row says C9606R, which of our items is that?"

`opc_alias_resolve(scope, party, code, name)` tries, in order:

1. this party's own part number
2. this party's own description
3. our code
4. our name

and reports **which rule matched** (`matched_by`), so a person can sanity-check
it rather than trusting a black box.

`opc_alias_resolve_bulk` does the same for a whole sheet in one call. The
ranking is identical — `scripts/ssh-verify-alias-bulk.py` runs both matchers over
the same rows and asserts they agree, because a faster matcher that matches
differently is worse than a slow one.

`opc_alias_set_bulk` writes many at once. It uses `DISTINCT ON` because one
sheet legitimately lists the same item twice, and a single INSERT hitting the
same unique key twice aborts the whole statement.

---

## Where each name is used

| Document | Whose name | Why |
|---|---|---|
| Sales order | customer's, ours alongside | they raised it |
| Vendor PO | **vendor's**, ours alongside | they have to fulfil it |
| PO e-Bill | ours | our document to the vendor |
| Delivery challan | **customer's** | they receive it |
| Tax invoice | **customer's** | they reconcile it against their own PO |

**Unmapped never means blank.** Every one of these falls back to our own name and
flags the row instead — a PO with an empty line is worse than a PO in the wrong
language.

---

## How mappings get learned

- **Automatically, on import.** Every matched row is written back as that
  customer's alias, so the same sheet next quarter matches itself.
- **By hand**, on the Item Name Mapping screen: pick a scope and a party, then
  edit codes and names per item.

## Why the design is this way

**Aliases are per party, not global.** Two vendors call the same module
different things and both are right.

**The invoice does not look it up.** Names are *stamped* onto the document when
it is raised. If they were resolved at render time, editing a mapping next month
would silently rewrite an invoice already sent to a customer. Documents already
issued read from what was stored; only documents not yet raised see the new
mapping.

**The map is cached per (scope, party) for the life of the tab.** A vendor's part
numbers do not change while a PO is open, and re-fetching per line would be the
expensive way to be correct. `invalidateAliasMap(scope, party)` clears it after a
write.
