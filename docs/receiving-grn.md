# Goods in — receiving and the GRN

**Who:** Stores confirm, Purchase accept. (Reversed from the standard flow.)
**Code:** `screens-godown.jsx`, `screens-procurement.jsx`
**Tests:** `scripts/uitest/receive-check.js`, `scripts/uitest/receipt-engine-check.js`

---

## The direction is a setting, not code

```
standard          Purchase marks received  →  STORES accepts and posts the GRN
procurement_only  STORES confirms received →  PURCHASE accepts and posts the GRN
```

Microlink's storekeeper is the person at the gate; Purchase reconcile against
the PO. That is `receiving_flow` in the workflow profile — see
[workflow-profiles.md](./workflow-profiles.md).

There is **one** code path. The **acceptor** posts the GRN directly (no point
asking themselves); anyone else raises a request the acceptor approves. Labels,
notifications, audit lines and waiting states all follow the setting rather than
the word "Stores".

## Where the pending queue appears

Confirmed receipts waiting on the acceptor show in **three** places, because a
queue nobody finds is a queue nobody clears:

1. the **GRN screen**, across every order
2. the order's **Virtual Godown**
3. the order's **Vendor POs** tab

Same records, same actions, **one component** (`PendingReceiptsPanel`) — the GRN
screen's private copy was deleted rather than a second one added, so the three
cannot drift apart. Who may accept still comes from the workflow, not from where
the panel is drawn.

## The receive dialog

Reached from a vendor PO. Defaults to *everything still outstanding arrived*,
because that is the common case.

- **Everything arrived** / **Clear all**, and a select-all header box
- it knows what an **earlier partial delivery** already took: a line received in
  full is marked `done` and starts unticked, and the footer counts only what is
  still due. Defaulting to "all arrived" without that would book the same goods
  twice on a second receipt.
- **rejections and pool diversions** sit behind one opt-in. They are the rare
  case and were taking the same room as the common one, which forced a
  horizontal scroll.
- the **LR recorded on the PO** is carried in

## What posting a receipt does

1. creates the **GRN** with accepted / rejected / to-pool quantities
2. stamps the **PO e-Bill** if not already generated
3. auto-books the **vendor payable** for the received value
4. moves the PO to *Material Received* or *Partially Received* — cumulative, per
   line, so a partial receipt stays receivable
5. puts the stock in the order's **Virtual Godown**
6. raises the client invoice **only if `auto_invoice_on_grn` is on**. For
   Microlink it is off; they bill on dispatch instead — see
   [dispatch-invoicing.md](./dispatch-invoicing.md).

Items with no PO line get a PO auto-created for the shortfall, so receiving never
blocks on missing paperwork.

## The Virtual Godown answers "where is my stuff"

| column | meaning |
|---|---|
| Required | what the order needs (`qty × bundle_qty`) |
| On PO | placed on a vendor |
| **In transit** | shipped by the vendor, not yet here — from the LR on the PO |
| From Pool / Transferred | other sources |
| Received | GRN-accepted |
| In hand / Remaining | net stock, still to come |
| Status | Not ordered → On order → In transit → Partial → Fulfilled |

*In transit* is **measured**, not inferred. Something merely ordered shows as
**on order**, which is a different thing.

GRNs raised against the order are listed in the VG too, next to the action that
creates them.

## Traps

> **The bundle-quantity bug.** `allComponents` summed the per-set component
> quantity without multiplying by `bundle_qty`, so the godown asked for a sixth
> of the order and receiving posted a sixth — everything still read as pending.
> Four places had the same fault, including `soFullyReceived`, which would have
> called an order complete on a sixth of the goods. There is now **one**
> definition, `soRequired()`, and `receipt-engine-check` asserts every screen
> agrees.

- `state` inside the receive engine is a **stale snapshot** (see
  [architecture.md](./architecture.md)). The test models that deliberately.
- e-Bill numbers derive from the PO number, so two POs receipted in one action
  cannot share one. They used to.
