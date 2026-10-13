# Goods in — receiving and the GRN

**Who:** Stores confirm, Purchase accept. (Reversed from the standard flow.)
**Code:** `screens-godown.jsx`, `screens-procurement.jsx`
**Tests:** `scripts/uitest/receive-check.js`, `scripts/uitest/receipt-engine-check.js`,
`scripts/uitest/grn-list-check.js` (the grouped-by-project list),
`scripts/uitest/multi-so-po-check.js` (the preview/execution-agree guarantee below),
`scripts/uitest/grn-approval-e2e-sim.js` (the full journey, below — not one of
the required pre-deploy 22, but run it whenever this flow is doubted)

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
the word "Stores". This is enforced at **every** receiving door, not only VG's
own "mark received" — see [Traps](#traps) for the gap where it briefly wasn't.

## Finding a GRN — grouped by project, same as Vendor POs

The GRN screen's own table (below the pending queues, and the Master-Pool
panels on a split-stores organization) is **grouped by Sales Order by
default**, laid out identically to `VendorPOList` — the same header row
(`SO/FY26/0021 · Customer · N GRN(s)`), the same "Grouped by project / Flat
list" toggle, the same filter bar. One project's GRNs used to sit scattered
through a single flat table with nothing to tell them apart; now they read
the same way its Vendor POs already do, right down to clicking the SO number
to jump to the order.

The search box matches GRN no, vendor PO no, vendor name, SO no, customer
name, and LR no — one box, not a separate filter per field, same convention
`VendorPOList`'s search already uses. A vendor filter sits next to it.

This is layout only: which GRNs exist, how one is accepted, and everything
under [What posting a receipt does](#what-posting-a-receipt-does) is
untouched. The three pending-queue mounts above this table
(`PendingReceiptsPanel`) did not move and are not grouped — they are already
a queue of exactly what needs action, not a browsing list.

## Where the pending queue appears

Confirmed receipts waiting on the acceptor show in **three** places, because a
queue nobody finds is a queue nobody clears:

1. the **GRN screen**, across every order
2. the order's **Virtual Godown**
3. the order's **Vendor POs** tab

Same records, same actions, **one component** (`PendingReceiptsPanel`) — the GRN
screen's private copy was deleted rather than a second one added, so the three
cannot drift apart. Who may accept still comes from the workflow, not from where
the panel is drawn. This whole mechanism is driven entirely by `receiving_flow`
(and the `receiving_*_roles`/`_label` overrides) — not hard-coded to one
organization. Any tenant can run it simply by setting `receiving_flow:
'stores_to_purchase'`; an org that doesn't (`standard`, today's default)
behaves exactly as before, Purchase marking received and Stores accepting.

### The request shows exactly what Accept will post — not a flat item list

Confirming a receipt used to show the acceptor a flat "4× Chassis" string —
no PO, no idea which PO line it would actually land on. Now, for every item
in the request, Purchase sees:

- the **line item name and qty** that Stores confirmed
- the exact **Vendor PO number** it will post against — several, if the qty
  needed more than one PO line to cover
- for a PO **combined across several SOs**: a *"combined · also SO/FY26/0071
  (3)"* note naming every other SO sharing that line and its own share, so a
  combined PO's mapping is visible before Accept is even clicked, not
  discovered afterward in the GRN it produces

**`previewReceivePOMapping(so, picks, state)`** (`screens-godown.jsx`) computes
this — the identical greedy PO-matching `vgReceiveComponents` itself runs to
actually post, extracted into one pure function both call. `PendingReceiptsPanel`
calls it live, at render time, rather than freezing a snapshot into the
request record: state can change between a request being raised and being
accepted (another delivery posted against the same PO, say), and the live
preview always matches what Accept will *actually* do, never a stale guess.
A pick with no PO line left to cover it shows *"no PO line left — Accept will
auto-create one"* instead of inventing a PO number that doesn't exist yet.

### Two shapes of pending receipt, one normalized display

A pending receipt is raised from two different places, carrying two different
shapes:

- **VG's own "mark received"** (`doMarkReceived`) — a flat `picks` array
  (`{product_id, qty, name}`); which PO(s) it will post against is
  *discovered* at Accept time via `previewReceivePOMapping`.
- **The PO-centric Receive dialogs** (`ReceiveModal`/`GRNNew`, via
  `submitPOReceipt` — see [Traps](#traps)) — `po_id` + the **exact** `items`
  Stores already decided in the dialog (rejected / to-pool / a combined
  line's `so_split`, all already filled in). The PO here is not up for
  discovery; it's already fixed.

**`pendingReceiptRows(pr, so, state, getProduct)`** (`screens-godown.jsx`)
normalizes either shape into one row list — `{product_id, name, qty,
poRows}` — so `PendingReceiptsPanel` renders both identically, and `accept`/
`reject`'s own audit/notification text describes either the same way. A
`po_id` request reads its mapping straight from that PO's own `so_alloc`,
never through `previewReceivePOMapping` — running the general preview here
could land on a *different* PO than the one already chosen, if more than
one PO on this SO happens to carry the same product.

## The receive dialog

Three doors, same `ReceiveModal`, same engine — no "which screen has the real
receive button" guessing:

1. **The Vendor PO's own detail page** — its own primary action button reads
   **Receive** the moment the PO is `Issued`/`In Transit`/`Partially Received`
   and opens `ReceiveModal` for exactly that PO. It used to read "Create GRN"
   and just navigate to the bare GRN list with nothing selected — a dead end
   that forced a second, separate hunt for the right PO. Fixed directly, not
   worked around.
2. **The GRN screen's own New GRN button**, which didn't exist before — the
   page had a link *away*, to the Virtual Godowns, but no action of its own.
   Opens `GRNNew`, the PO-picker version of the same dialog.
3. **The SO's own Vendor POs tab** — unchanged, "Receive" per row, same as
   always.

Defaults to *everything still outstanding arrived*, because that is the
common case.

A PO that combines several Sales Orders (see
[multi-so-vendor-po.md](./multi-so-vendor-po.md)) is tagged **combined · N
SOs** on `VendorPOList`'s own row and in the title of the PO's own detail
page — but the title badge is only a cue, not the answer. **`VendorPODetail`
itself carries the full `ComboPOSummary` section** — "This PO combines N
Sales Orders" plus an Item/SO/Qty table — right on the page, before Receive
is even opened. The same card repeats as the first thing inside
`ReceiveModal` and `GRNNew`, so which SOs and how much of what is answered
up front wherever you're looking, not one line at a time as each split
editor is reached. It renders nothing for an ordinary single-SO PO.
`GRNNew`'s own PO picker and page-sub, and `ReceiveModal`'s title, name
every linked SO the same way.

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

## Proving the whole journey, not just each piece

`grn-approval-e2e-sim.js` walks the real user story end to end against the
actual source — Stores confirms (via the PO-centric Receive dialog, a PO
combined across two SOs the same way, and the Virtual Godown's own flat
"mark received") → the request **actually renders** on a server-side render
of Purchase's own `PendingReceiptsPanel` (not just an inspection of the
underlying `pending_receipts` array) → Purchase accepts → the GRN posts with
exactly what Stores confirmed. It exists because unit-level proof that
`submitPOReceipt` gates correctly, and unit-level proof that the panel
displays a hand-built pending receipt, can both be green while the two never
actually connect — this script is the connection, proven, not assumed. Run
it whenever this flow is doubted; it is not one of the required pre-deploy
22 because it duplicates coverage those already carry individually.

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
- **A working feature with no door into it is not a working feature.**
  `ReceiveModal` has always correctly handled a shared, multi-SO line — the
  split editor was built and tested long before anyone could actually reach
  it from the Vendor PO's own page, because that page's action button
  silently navigated away to the bare GRN list instead of opening the
  dialog. Reported directly as "I can't find where to mark received."
  Correctness and discoverability are different bugs; this was the second
  kind, and the engine underneath needed no change at all.
- **`vgReceiveComponents`'s own PO-matching loop and `previewReceivePOMapping`
  must stay the ONE algorithm, not two that happen to agree today.** The
  preview was built by extracting the executor's existing greedy fill
  verbatim, not by writing a second implementation next to it — a future
  change to the matching rule (e.g. a different tie-break across PO lines)
  that touches only one of them would make Accept silently post something
  different from what the request told Purchase it would. `multi-so-po-check.js`
  section [17] proves the preview's own numbers (`take`, `shortfall`) and
  what Accept actually posts are the same numbers, not just "both reasonable."
- **The request/approve gate only ever covered VG's "mark received" — the
  PO-centric `ReceiveModal`/`GRNNew` dialogs called `postReceiptForPO`
  directly, no matter who clicked Receive.** A requester role (Stores, under
  `stores_to_purchase`) could open Receive from the Vendor PO's own page and
  post the GRN straight through — the request that was supposed to land in
  the acceptor's GRN dashboard was never raised at all, and the acceptor had
  no idea anything had arrived. Reported directly as "the accept request
  isn't appearing." **`submitPOReceipt`** is the one gate both dialogs now
  call through: the acceptor posts directly exactly as before; anyone else's
  items — already fully decided in the dialog — are stashed as a `po_id`
  pending receipt instead, for the acceptor's Accept to replay verbatim.
  `receive-check.js` section [8] proves both directions, and that Accept's
  replay produces the identical GRN a direct receive would have.
- A near-identical, **orphaned** copy of the accept/reject logic
  (`acceptReceipt`/`rejectReceipt`, reading `pr.picks` only) sat unused
  inside `GRNList` from before `PendingReceiptsPanel` was extracted as the
  shared component — the render call had already moved to
  `<PendingReceiptsPanel/>`, but the dead functions and the `pending` array
  feeding them were never deleted. Left alone, updating the pending-receipt
  shape (for the fix above) would have meant either missing a second place
  that silently assumed the old flat shape, or knowingly leaving a landmine.
  Deleted rather than updated — it had no caller to preserve.
- A SECOND dead receiving component, `VGReceivePanel`, had the exact same
  "no approval gate" bug as `ReceiveModal`/`GRNNew` above — its own
  `markReceived()` called `postReceiptForPO` straight through, gated only on
  `wfCanReceive(role)` (can this role use a receiving screen AT ALL, the
  union of both requester and approver roles) rather than "is this role the
  configured ACCEPTOR." Found while auditing every call site of
  `postReceiptForPO`/`vgReceiveComponents` after a bug report that a request
  wasn't appearing. It was never reachable — grepped for `<VGReceivePanel`
  and found no mount anywhere; `VirtualGodownView`'s own `doMarkReceived` is
  the real, correctly-gated live path (confirmed mounted at the `godown/:id`
  route and embedded in the SO detail page) — so this specific bug never
  actually fired for anyone. Deleted rather than fixed, same reasoning as
  `acceptReceipt`/`rejectReceipt`: a second, unreachable implementation of
  "receive material at the VG" is a landmine regardless of whether its own
  gate is correct, and `vgReceiveComponents`/`doMarkReceived` is the one
  definition this file already relies on elsewhere. **The lesson, not just
  the fix:** a bug search that stops at "found one, fixed it" can still miss
  a sibling with the identical shape sitting a few hundred lines away —
  grep every call site of the function being gated, not just the ones a
  stack trace or a bug report points at.
