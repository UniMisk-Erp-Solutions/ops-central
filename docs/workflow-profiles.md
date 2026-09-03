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

## The two presets

| | `standard` | `procurement_only` |
|---|---|---|
| receiving | Purchase marks → Stores accepts | **Stores confirms → Purchase accepts** |
| PO prints in | our names | **vendor part numbers** |
| in-transit tracking | off | **on** |
| customer wording | off | **on** |
| outward dispatch | off | **on** |
| supervisor sign-off | on | off |
| invoice on GRN | on | **off** |
| invoice on dispatch | off | **on** |

Live: **Microlink** (`ml`) runs `procurement_only`; **OP Central Demo**
(`unimisk`) runs `standard`.

## Changing it

Platform console → expand an organization → **Workflow**. Pick a preset, or
override one key. An override is marked and can be reset, after which the org
follows the preset again — including future improvements to it.

Scripted: `scripts/ssh-configure-procurement-org.py <subdomain>`, which prints
every organization before and after so it is visible nothing else moved.

## Adding a third company type

`INSERT` a row into `workflow_profiles` with its `defaults`. It appears in the
console immediately. **No application change** — that is the entire point.

## Rules

- Never hard-code a role name into a receiving / PO / dispatch path. Read the
  setting.
- Absent must always mean "behave as before". A new key must not change any
  existing organization until someone turns it on.
- Verify with `scripts/ssh-verify-workflow-profiles.py`, which checks each org
  resolves its own workflow, an override beats the preset, and a non-master
  cannot change either.
