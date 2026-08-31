# Microlink — procurement & dispatch flow

The company on `ml.ops-central.unimisk.com`. No presales, no site implementation:
material comes in against a customer's order and goes out again, and the whole
job is knowing **where every unit is**.

It runs the `procurement_only` workflow profile. Nothing below is hard-coded to
Microlink — it is all resolved from data, so the next company of this kind is a
row, not a release. See [multi-tenancy.md](./multi-tenancy.md) for the mechanism.

---

## The flow

```
  customer's Excel / CSV
          |
          v
  [1] IMPORT  ──────────────  matched to OUR items by alias, then by our own
          |                   code, then by name; unmatched rows are flagged
          v
  [2] SALES ORDER             editable · keeps the customer's own wording
          |
          v
  [3] VENDOR PO ────────────  printed in the VENDOR'S part numbers
          |
          v
  [4] IN TRANSIT ───────────  LR / carrier / ETA · per-line quantities
          |
          v
  [5] STORES confirms         ticks what physically arrived, quantity-wise
          |
          v
  [6] PURCHASE accepts ─────  posts the GRN   (reverse of the standard flow)
          |
          v
  [7] VIRTUAL GODOWN          stock held against this order
          |
          v
  [8] OUT FOR DELIVERY ─────  partial · printable customer delivery challan
```

A line can legitimately read **`Received 10`** and **`Out for delivery 5`** at
the same time. Every number in the system is a quantity, never a status word.

---

## The two hard parts

### 1. Three names for one thing

The customer calls it one thing, we call it another, the vendor calls it a third.
With 10 000+ vendors this cannot be retyped per order.

```
  customer's wording  ──>  OUR item  ──>  vendor's part number
       (import)             (truth)         (what the PO prints)
```

`item_aliases` stores the outer two against our internal `product_id`, keyed by
party. Learned once, reused forever — the second PO to a vendor auto-fills.

- **Forward** (`opc_alias_map`) — "what does this vendor call our items?" Drives
  what the vendor PO prints.
- **Reverse** (`opc_alias_resolve`) — "an imported row says `C9606R`, which of
  our items is that?" Tries alias code → alias name → our code → our name, and
  reports which rule matched so a human can sanity-check it.

Unmapped lines **fall back to our own names and are flagged** — a PO is never
blank and never silently wrong.

Edit mappings on **Item Mapping**.

### 2. Knowing where every unit is

`scmLineTotals()` is the single source of movement maths — every screen uses it,
so no two views can disagree.

| Column | Meaning |
|---|---|
| Ordered | what the customer asked for |
| On PO | placed on a vendor |
| Not shipped yet | on a PO the vendor has not dispatched |
| In transit | actually left the vendor, not arrived |
| Received | GRN posted |
| In stock (VG) | received, not yet dispatched |
| Dispatched | gone to the customer |
| Pending | ordered but not yet received |

**In transit is measured, not inferred.** It used to be `ordered − received`,
which counted material the vendor had not even shipped. It now comes from the
LR recorded on the PO, and what is left becomes *Not shipped yet*.

---

## Why receiving runs backwards here

Standard: Purchase marks material received → **Stores** accepts and posts the GRN.
Microlink: **Stores** confirms what physically arrived → **Purchase** accepts.

Their storekeeper is the one at the gate; Purchase reconciles against the PO.
This is the `receiving_flow` setting, not a second code path — the **acceptor**
posts the GRN directly, anyone else raises a request the acceptor approves.

---

## Settings that define this company

| Key | Value | Effect |
|---|---|---|
| `receiving_flow` | `stores_to_purchase` | Stores confirms, Purchase accepts |
| `po_item_language` | `vendor` | POs print in vendor part numbers |
| `intransit_tracking` | `true` | LR / carrier / ETA captured on the PO |
| `customer_language` | `true` | customer wording on orders and challans |
| `outward_dispatch` | `true` | partial dispatch + delivery challan |
| `supervisor_signoff` | `false` | no site implementation |
| `auto_invoice_on_grn` | `false` | invoicing happens outside this system |

Capabilities **off**: presales, RFQ, implementation, cross-SO transfers,
partial invoicing, e-invoice, e-way bill, WhatsApp, SMS.
**On**: sales desk, stores, SCM tracking, item mapping, surplus pool.

Roles in use: **Purchase**, **Stores**, **Org Admin**.

---

## Onboarding the next company like this

1. Platform console → **New organization** → pick the workflow profile.
2. Tick its capabilities.
3. Load its catalogue, then map items per customer and per vendor as orders arrive
   — mapping is incremental by design, it does not need doing up front.

If a company needs one switch different, override that single key in the console.
It keeps inheriting every future change to the profile. If a genuinely new *kind*
of company appears, add a row to `workflow_profiles` — no application change.

Both scripted:

```bash
SSH_PASSWORD='…' python scripts/ssh-configure-procurement-org.py <subdomain>
SSH_PASSWORD='…' python scripts/ssh-verify-workflow-profiles.py
```

The configure script prints every organization before and after, so it is visible
that nothing else moved.

---

## Not built yet

- **SO → "our BOQ" review step.** The import auto-resolves and flags unmatched
  rows, but there is no dedicated screen to sit and approve the conversion.
- **Invoicing** — deferred; this company invoices outside the system.
- The catalogue is still demo data pending the real one.
