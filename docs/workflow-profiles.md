# Workflow profiles — how each company works

**Tables:** `workflow_profiles`, `organizations.workflow_profile`,
`organization_settings.data->'workflow'`
**Migrations:** `027_org_workflow_profiles.sql`, `031_invoice_on_dispatch.sql`
**Frontend:** `wf()` / `wfOn()` / `wfReceiving()` in `permissions.jsx`

---

## Feature flags vs workflow profiles

Two different questions, deliberately kept apart:

- **Feature flags** — *what can this company SEE?* (`organization_features`)
- **Workflow profile** — *how does this company WORK?*

A trading company and a turnkey integrator can both have the Stores screen
switched on and still receive material in opposite directions.

## How it resolves

```
workflow_profiles.defaults          the preset
  ||  organization_settings.data->'workflow'    that org's overrides
  =   the effective workflow
```

Delivered by `opc_my_context()` as `window.__opcWorkflow`, refreshed on tab
focus. **Every consumer falls back to the historic behaviour when a key is
absent**, so a failed load, an old cached tab, or an org with no profile behaves
exactly as before.

## The switches

| key | values | what it changes |
|---|---|---|
| `receiving_flow` | `purchase_to_stores` / `stores_to_purchase` | who confirms goods arrived and who accepts and posts the GRN |
| `po_item_language` | `ours` / `vendor` | whose part numbers a vendor PO prints in |
| `intransit_tracking` | bool | capture LR / carrier / ETA on the PO, between issuing it and the GRN |
| `customer_language` | bool | show the customer's own wording on orders and challans |
| `outward_dispatch` | bool | stock leaves the VG on a delivery challan |
| `supervisor_signoff` | bool | a final invoice waits for the site supervisor |
| `auto_invoice_on_grn` | bool | raise the client invoice when goods ARRIVE |
| `invoice_on_dispatch` | bool | raise the client invoice when goods SHIP |
| `receiving_requester_roles` | array | WHICH roles confirm what arrived. Absent = the historic pair for the flow above |
| `receiving_approver_roles` | array | WHICH roles accept it and post the GRN. Absent = the historic pair |
| `receiving_requester_label` | text | what to call that side on screen, e.g. `Stores (inward)` |
| `receiving_approver_label` | text | what to call the other side |
| `client_acceptance` | bool | the client accepts/rejects delivered quantities before the order is treated as settled. See [client-acceptance.md](./client-acceptance.md) |
| `client_order_requests` | bool | the client sends a typed item request instead of creating the Sales Order themselves; Purchase matches it to the catalogue and creates the SO. See [client-requests.md](./client-requests.md) |

The four `receiving_*_roles` / `_label` keys exist because a company does not
have to call its stores team `Stores`. One that splits inward from outward has
no role of that name at all, and the hand-off would have had no requester — the
tick boxes simply would not have appeared for anybody. **Absent means the
historic roles**, so every organization without these keys behaves exactly as it
did. A malformed override (an empty array, a string, a list of numbers) falls
back too rather than leaving nobody able to receive.

## The presets

| | `standard` | `procurement_only` | `split_stores` |
|---|---|---|---|
| receiving | Purchase marks → Stores accepts | **Stores confirms → Purchase accepts** | **Stores In confirms → Purchase accepts** |
| PO prints in | our names | **vendor part numbers** | **vendor part numbers** |
| in-transit tracking | off | **on** | **on** |
| customer wording | off | **on** | off |
| outward dispatch | off | **on** | **on** |
| supervisor sign-off | on | off | off |
| invoice on GRN | on | **off** | **off** |
| invoice on dispatch | off | **on** | **on** |
| client accepts/rejects delivery | off | off | **on** |
| client sends a request instead of creating the SO | off | off | **on** |

Live: **Microlink** (`ml`) runs `procurement_only`; **OP Central Demo**
(`unimisk`) runs `standard`; **Demo Org** (`dm`) runs `split_stores` — see
[tenant-dm.md](./tenant-dm.md).

`split_stores` was given `standard`'s billing settings at first — both triggers
off — then explicitly moved to match `procurement_only` exactly
(`035_split_stores_match_microlink.sql`), on the record as a placeholder
("same as Microlink for now, will change later") rather than a considered
decision about this company's own billing.

`client_order_requests` followed the same "preset default, not a per-org
override" pattern as `client_acceptance` (`037_client_order_requests_split_stores.sql`)
once the client-facing side of the flow changed from "creates the SO" to
"sends a request" — see [client-requests.md](./client-requests.md).

## Changing it

Platform console → expand an organization → **Workflow**. Pick a preset, or
override one key. An override is marked and can be reset, after which the org
follows the preset again — including future improvements to it.

Scripted: `scripts/ssh-configure-procurement-org.py <subdomain>`, which prints
every organization before and after so it is visible nothing else moved.

## Adding a third company type

`INSERT` a row into `workflow_profiles` with its `defaults`. It appears in the
console immediately. **No application change** — that is the entire point.
`supabase/migrations/033_split_stores_profile.sql` is the worked example.

A whole new *company* — login, organization, membership, capabilities, profile —
is one run of `scripts/ssh-provision-tenant.py`, which is idempotent and takes
`--dry-run`. See [tenant-dm.md](./tenant-dm.md).

## Rules

- Never hard-code a role name into a receiving / PO / dispatch path. Read the
  setting.
- Absent must always mean "behave as before". A new key must not change any
  existing organization until someone turns it on.
- Verify with `scripts/ssh-verify-workflow-profiles.py`, which checks each org
  resolves its own workflow, an override beats the preset, and a non-master
  cannot change either.
