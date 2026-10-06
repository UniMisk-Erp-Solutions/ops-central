# A vendor PO shared across more than one Sales Order

**Who:** Purchase creates and edits it; GRN decides how a receipt splits
**Where:** `CreateVendorPOModal` (the "Create Vendor PO" button on any SO's
Procurement tab), `SOVendorPOsTab`'s per-line editor, `ReceiveModal`/`GRNNew`
(the two PO-centric receive screens)
**Code:** `poLineSoQty`/`grnLineSoQty`/`poLinkedSoIds`/`poServesSO`/
`poSoAmount` (`frontend/src/utils.jsx`); `suggestSoSplit`/`poSoAllocations`/
`SoSplitEditor`/`LinePoSplitEditor`/`buildComboPOItems`/`shrinkPOLineForSO`/
`postReceiptForPO` (`frontend/src/screens-procurement.jsx`,
`frontend/src/screens-godown.jsx`)
**Test:** `scripts/uitest/multi-so-po-check.js` (all nine sections — see
below); the full existing suite proves every one of these call sites is a
zero-diff refactor for a PO that is *not* shared, which is every PO that
exists today

---

## What it is

A vendor PO has always belonged to exactly one Sales Order. When five SOs
independently need the same item from the same vendor, Purchase had no way
to combine that into one PO — they would place five separate POs for the
same thing, which is not how a real purchasing team works.

Now, when creating a PO (or editing one that's already issued), Purchase can
fold in another open SO's own outstanding need for the same item — one PO,
one vendor relationship, each SO's own quantity tracked correctly inside it.
GRN still decides, line by line, how a physical receipt splits across the
SOs that share it — **with a smart suggestion, never an automatic decision**
— and nothing here changes a PO that only ever served one SO, which is still
the overwhelming majority and will stay that way.

**Nothing about this is reachable until Purchase deliberately clicks
"combine."** A plain, single-SO PO — created, edited, received, invoiced —
is byte-for-byte what it always was.

## How it works

### The data model — additive only, no migration

Everything rides as **optional extra keys on existing `jsonb` array
elements** — the same technique `pending_change`/`tax_config`/`dispatch_info`
already use to extend `vendor_pos` without a backfill.

- `po.items[i].so_alloc?: [{ so_id, qty }]` — how this ordered line is split
  across SOs. **Absent means the line belongs 100% to `po.so_id`** — today's
  rule, unchanged. Never written with a single entry: that would just be a
  second, redundant way to say "100% to one SO."
- `grn.items[i].so_split?: [{ so_id, qty }]` — how *this specific receiving
  event's* accepted quantity splits across SOs. Same absent-means-100%-to-
  `po.so_id` default. Unlike `so_alloc`, a one-entry `so_split` is normal and
  correct: a shared line can receive in several separate deliveries, and one
  delivery can easily be 100% for just one of the SOs that share the line —
  see [Traps](#traps).
- `po.so_id` never changes shape or meaning. A combined PO is simply a
  normal PO whose `so_id` is whichever SO it was created from (its
  "original"), plus `so_alloc` on the lines that are genuinely shared.
- **Rejected and to-pool quantities stay attributed 100% to `po.so_id`**,
  even on a shared line. GRN makes one quality call (accepted / rejected /
  to-pool) for the whole delivery, same as today; only the **accepted** pool
  is ever split across SOs. A deliberate v1 simplification, not an
  oversight.

### Five functions answer every "which SO does this belong to" question

```
poLineSoQty(po, productId, soId)   // this SO's own share of an ordered line
grnLineSoQty(grnItem, po, soId)    // this SO's own share of a GRN's accepted qty
poLinkedSoIds(po)                  // every SO this PO serves, so_id first
poServesSO(po, soId)               // is this SO one of them
poSoAmount(po, soId)               // this SO's own ₹ share of the PO
```

For a PO that only ever served one SO, all five answer exactly what
`it.qty`/`po.so_id===so.id` always did — that identity is the whole
backward-compatibility argument, and `multi-so-po-check.js` sections [1]–[2]
prove it mechanically. **Every** existing call site that used to compare
`po.so_id === so.id` or read `it.qty`/`it.accepted` directly for a per-SO
number now goes through one of these five — `soDerivedStatus`,
`soRejectedOutstanding`, `soOutstandingProcurement`, `allocBuildRows`,
`soReceivedQty`, `soMetrics`, `soProfit`, `soFullyReceived`, every Virtual
Godown panel that tallies "what has this SO received" — so a shared PO is
provably invisible to all of them until one actually exists, and correctly
scoped to each SO once it does. Section [4]/[5] of the test file drive a
hand-built shared PO through every one of these and check each SO sees only
its own number.

### Moment 1 — creating or combining a PO

`CreateVendorPOModal` loads an SO's required components as it always has.
Per item row, if any *other* open SO has its own outstanding need for the
same product — `soOutstandingProcurement(state, otherSO)[productId] > 0`,
already netted against whatever that SO has on its own PO — a small button
appears: *"N other SO(s) also need this — combine?"* Expanding it lists
each candidate SO with its own outstanding quantity, pre-filled and
editable; ticking one adds it, and the row's total becomes the sum.

`buildComboPOItems(primarySoId, items)` turns those rows into real PO line
items on submit: a row nobody combined into stays a plain `{product_id, qty,
rate}` — no `so_alloc` key at all. A row with at least one real combine
becomes `{..., so_alloc: [{so_id: primary, qty}, {so_id: other, qty}, ...]}`.
Every linked SO's status advances to `Procurement Started`, same as today's
single-SO PO, and the notification names every one of them.

### Moment 2 — GRN-time: a suggestion, never a decision

`ReceiveModal` and `GRNNew` (the PO-centric receive screens) show a
**`SoSplitEditor`** under any line whose PO carries `so_alloc` for it: one
row per linked SO with a fully editable quantity, a live balance against the
accepted total, and a one-click "use suggested split." Submitting either
screen is blocked until a shared line's split actually sums to what was
accepted for it — nothing auto-commits a suggestion.

`suggestSoSplit(accepted, allocations, getSO)` is the suggestion itself —
pure, and it writes nothing. It drops any SO already fully received, ranks
the rest by priority (`Critical` → `Urgent` → `Standard` — the database's own
two literal values, not a new hardcode) then delivery date then SO number,
and hands each one `min(remaining need, what's left of the accepted qty)` in
that order. `poSoAllocations(state, po, productId)` builds its input
straight from app state — every linked SO's own ordered share and what it
has already received on earlier GRNs against this same PO.

**`postReceiptForPO`** stamps the submitted `so_split` onto the GRN line,
then — after its existing single-PO invoice call for `po.so_id` — loops
every *other* linked SO and invoices it too, if it received units in this
same event. A PO's own completion/status logic stays entirely PO-level,
unaffected: a line is "fully received" when its total accepted reaches its
total ordered, regardless of how that total is split across SOs.

`VGReceivePanel` and `vgReceiveComponents` (the SO-scoped Virtual Godown
receive paths) never show the split editor — they're already scoped to one
SO. Instead they **cap** what's receivable from a shared line to that SO's
own remaining `so_alloc` share, and post a trivial one-entry `so_split`
naming just that SO — correct, because that specific receiving *event*
really is 100% one SO's, even though the PO's line is shared (see
[Traps](#traps)).

### Moment 3 — editing an issued PO later

The existing inline editor on `SOVendorPOsTab` (Purchase, after procurement
starts) gets two changes:

- **The lock moved from per-PO to per-line.** `'Partially Received'` is now
  an editable PO status (it used to lock the whole PO the instant any GRN
  existed); a specific line locks only once *that* line has itself received
  something — `lineReceived(po, pid)`. A PO three-tenths received stays
  editable on its other seven lines.
- **"Split this line across SOs"** opens `LinePoSplitEditor` on any
  unlocked line: the same candidate-discovery `CreateVendorPOModal` uses
  (every other open SO still outstanding for this product), plus whoever is
  already on the line's `so_alloc` even at zero outstanding (since this very
  PO is what already covers them). Saving calls `setItemSoAlloc`, which
  advances any *newly* added SO to `Procurement Started` and notifies it —
  exactly like creating a PO for it would have.

A member already GRN'd on this PO can never be edited below what it has
actually received — the same "can't un-receive" rule the rest of this screen
already follows for a PO as a whole, now enforced per SO on a shared line.
Reducing a split down to one surviving SO drops `so_alloc` back to the plain
default (if that survivor is `po.so_id`) — see [Traps](#traps) for the one
case where it must NOT collapse.

Vendor replacement (`changePOVendor`) keeps its original, stricter gate
unchanged: a PO with *any* GRN at all, shared or not, can never have its
vendor swapped — doing so after stock has physically arrived from the old
vendor would corrupt the GRN/invoice trail.

## Why it is that way

**Why can a GRN event's `so_split` legally have one entry when `so_alloc`
never can?** They answer different questions. `so_alloc` describes the
*line's own total split* — if only one SO were in it, that's just the
default, so a one-entry array would be a second way to say nothing. 
`so_split` describes *one delivery's* split, and a delivery can
legitimately be 100% for one SO while another SO's share of the same line
is still outstanding (two separate lorries, two separate GRN events). Coding
"never a 1-entry array" as a blanket rule across both would have made
`VGReceivePanel`'s SO-scoped receiving either wrong (attribute the whole
GRN's accepted qty to `po.so_id`, stealing from the real recipient) or
impossible. `multi-so-po-check.js` section [8] drives this exact case.

**Why does `shrinkPOLineForSO`'s collapse rule check `po.so_id`
specifically, not just "one survivor left"?** Pool stock can shrink a
shared line down to a single remaining claimant from either side. If that
survivor is `po.so_id`, dropping `so_alloc` is correct — it's back to the
plain default. If the survivor is the *other* SO, dropping `so_alloc` would
be silently wrong: every reader falls back to "100% belongs to `po.so_id`,"
and the real survivor's units would vanish from its own tracking entirely.
So a lone survivor that isn't `po.so_id` stays an explicit one-entry
`so_alloc` — the one place in this whole feature where "never a 1-entry
array" is deliberately broken, because the alternative is data loss, not
redundancy. `multi-so-po-check.js` section [6] proves both directions.

**Why is the read-side migration (Phase 2) and the write-side split engine
(Phase 3) separated from exposing creation/editing (this phase) at all?**
No shared PO could exist in real data until this phase shipped, so every
earlier phase was a *provably* zero-diff refactor — the full existing
22-check suite had to pass unchanged, and did. Shipping the write-side
capping (`VGReceivePanel`, `vgReceiveComponents`, `shrinkPOLineForSO`)
*before* anything could create a shared PO meant it could be proven correct
against hand-built fixtures with zero risk of a half-finished feature being
reachable through the UI in a broken state.

**Why does rejected/to-pool quantity stay 100% attributed to the PO's own
SO, even on a shared line?** Confirmed with the user rather than guessed: it
keeps the quality decision (accept/reject/pool) exactly where it already is
— one call, for the whole delivery — instead of asking GRN to make a second,
harder judgment call ("whose units were the bad ones?") that the physical
goods usually can't actually answer. Documented as a deliberate v1
simplification, not hidden.

## Where the code is

| Thing | Where |
|---|---|
| The five SO-scoping functions | `frontend/src/utils.jsx` |
| `suggestSoSplit`, `poSoAllocations`, `SoSplitEditor` | `frontend/src/screens-procurement.jsx` |
| `postReceiptForPO`'s `so_split` stamping + multi-SO invoice fan-out | `frontend/src/screens-procurement.jsx` |
| `buildComboPOItems`, `CreateVendorPOModal`'s combine picker | `frontend/src/screens-procurement.jsx` |
| `SOVendorPOsTab`'s per-line lock (`poOpenForEdit`/`lineReceived`/`lineEditable`), `LinePoSplitEditor`, `setItemSoAlloc` | `frontend/src/screens-procurement.jsx` |
| `VGReceivePanel`, `vgReceiveComponents` — capped per-SO, trivial one-entry `so_split` | `frontend/src/screens-godown.jsx` |
| `shrinkPOLineForSO`, used by `poolAllocateToSO` | `frontend/src/screens-godown.jsx` |
| Every migrated read path (`soDerivedStatus`, `soRejectedOutstanding`, `soOutstandingProcurement`, `allocBuildRows`, `soReceivedQty`, `SOGrnTab`, `soMetrics`, `VGAddFromPoolPanel`, `VGGrnCard`, `VGPoolSendPanel`, `VGImplPanel`, the VG main stock panel, `soFullyReceived`, `hasPOs`, `ProcurementTab.linkedPOs`, `soProfit`) | `frontend/src/utils.jsx`, `frontend/src/screens-procurement.jsx`, `frontend/src/screens-alloc.jsx`, `frontend/src/screens-billing.jsx`, `frontend/src/screens-dashboard.jsx`, `frontend/src/screens-godown.jsx`, `frontend/src/screens-so.jsx` |
| Checks | `scripts/uitest/multi-so-po-check.js` — [1]/[2] the five helpers' fallback identity and shared-line reads; [3] `suggestSoSplit`'s ranking; [4]/[5] every migrated read path against one hand-built shared PO (and a rejection replaced through a combined PO); [6] `shrinkPOLineForSO`'s shrink/collapse rules; [7] `postReceiptForPO`'s split stamping + multi-SO invoice fan-out; [8] `vgReceiveComponents` capped per-SO; [9] `buildComboPOItems` |

## Traps

- **A GRN event's `so_split` is allowed to have one entry; a PO line's
  `so_alloc` never is.** They answer different questions — see
  [Why it is that way](#why-it-is-that-way). Do not "fix" `VGReceivePanel`'s
  trivial one-entry `so_split` into something more symmetrical with
  `so_alloc`; it is correct as written.
- **`shrinkPOLineForSO`'s collapse-to-default check is `so_alloc[0].so_id
  === po.so_id`, not just "array length 1."** Collapsing on length alone
  silently reattributes the survivor's units to whichever SO happens to be
  `po.so_id`, which is wrong whenever the survivor is a *different* SO.
  `multi-so-po-check.js` section [6] exists specifically to catch a
  regression here.
- **`soOutstandingProcurement` (the candidate-discovery function both
  `CreateVendorPOModal` and `LinePoSplitEditor` use) already nets against
  existing POs.** An SO that's already fully covered — by this very PO or
  any other — simply never appears as a candidate. Nothing about the
  combine UI needs its own "already covered" check; duplicating that logic
  would risk disagreeing with the one place it's actually computed.
- **`rowTotalQty`/`buildComboPOItems` compute the same total two different
  ways on purpose** — one feeds the live UI (price/amount as you type), the
  other is what actually gets submitted. They are small enough that forcing
  them to share one implementation would cost more clarity than it saves,
  but a future change to one almost certainly needs the same change in the
  other; `multi-so-po-check.js` section [9] tests the submit-time one
  directly.
- **Vendor-invoice booking, e-Bill generation, and PO completion/status are
  PO-centric or vendor-centric by design and were never migrated.** A
  shared PO still gets exactly one e-Bill, one vendor invoice per GRN event,
  and one completion state — splitting those per SO would double-bill the
  vendor relationship for a single physical delivery. Only the *client-facing*
  side (which SO gets invoiced, which SO's dashboard shows which spend) is
  SO-scoped.
- **Dispatch-side `dispatch_info` (vendor shipment tracking: LR, carrier,
  ETA) has no per-SO split of its own** — it isn't one of the two places
  (`so_alloc`/`so_split`) this feature extends. On a shared PO, "in transit"
  figures stay whole-PO, same as before this feature existed; only the
  *ordered* and *received* figures either side of it are SO-scoped. Not an
  oversight — there is no way to attribute a specific lorry to a specific
  SO without inventing scope this feature doesn't need yet.
