# Demo Org (`dm`) — a company whose stores is two teams

**Host:** `dm.ops-central.unimisk.com` *(and the shared host — see below)*
**Slug:** `demo` · **Profile:** `split_stores` · **Created:** 22 Sep 2026
**Provisioned by:** `scripts/ssh-provision-tenant.py`
**Verify:** `python scripts/verify-tenant-isolation.py`

---

## What it is

The third organization on this deployment, and the first with **five** roles
rather than the usual ten. It exists to try a flow that the other two do not
run: one where the stores team is split in two, inward and outward.

| Role | Does |
|---|---|
| **Org Admin** | everything — customisation, users, billing |
| **Purchase** | vendor POs, and accepts what the inward team reports |
| **Stores In** | receives against POs — confirms what physically arrived |
| **Stores Out** | picks and dispatches to the customer |
| **Client Facing** | sends the client's item request, tracks it through SCM Tracking. Exactly two pages — **no cost, no margin, nothing else.** |

There is deliberately no Sales, Pre-sales, Project Manager, Managing Director or
Supervisor here. Those roles still exist for the companies that use them.

**The company's own flow has not been given yet.** What is below is the
scaffolding: a real login, a real organization, no data, and a profile that
asserts only what the five roles already imply. Everything else is left at the
behaviour the other companies have, because a wrong default that does something
is worse than one that does nothing.

## Fresh, and provably so

Zero rows. Not "no demo data on screen" — zero rows in the database, read back
over the public API as that admin, with their own JWT:

```
[3] a fresh tenant reads zero rows — and no other company's
  ok  all 17 tables read 0 rows
```

The other two organizations were counted before and after provisioning and did
not move: OP Central Demo kept its 41 orders / 66 POs / 53 products, Microlink
its 6 / 11 / 50.

This matters more than it sounds. A tenant seeing another company's catalogue
has happened here before — `products`, `categories` and `boms` were missing from
the store's `LOADED_TABLES`, so every tenant silently ran on the demo company's
products. That is fixed, and `verify-tenant-isolation.py` is how it stays fixed.

## Test data

That "zero rows" state was true at provisioning. `scripts/sql/dm-dummy-test-data.sql`
(2026-09-23) has since added sample master data so the client-requests flow —
and everything downstream of it — has something real to work against:

- **5 vendors** (`v-dm-01`..`05`): Cisco Systems India, Juniper Networks India,
  Redington, Ingram Micro, Rashi Peripherals.
- **5 customers** (`c-dm-01`..`05`): Relience Infotech, Bluepeak Networks,
  Orion Retail Chain, Nimbus Hospitality, Anchor Manufacturing.
- **13 products** (`p-dm-01`..`13`): the individually-priced items — switches,
  PSUs, SFP modules, a router, patch cables, an access point, a firewall, a
  UPS, etc.
- **5 categories with a BOM each** (`cat-dm-01`..`05`): "Core Switching
  Stack," "Edge Router Kit," "Wireless Access Kit," "Firewall Appliance Kit,"
  "UPS Backup Kit" — each a kit a client can order as one thing, decomposing
  into 3 of the products above via `boms.components`, the same
  `state.boms[categoryId]` structure every Sales Order bundle line already
  reads (`screens-sourcing.jsx`).

Idempotent (`ON CONFLICT DO NOTHING`) and scoped to Demo Org's `organization_id`
only — re-running it is safe and never touches Microlink or OP Central Demo.
Re-apply with `SSH_PASSWORD='...' python scripts/ssh-apply-sql.py
scripts/sql/dm-dummy-test-data.sql`.

Three more scripts, same idempotent/dm-only pattern, each fills a hole the
first pass left for testing:

- **`scripts/sql/dm-vendor-emails-and-aliases.sql`** — an email per vendor, on
  the `.example` domain (RFC 2606, reserved, never resolves), so **Float RFQ**
  can be exercised without any risk of a real inbox being emailed; and a
  vendor-scope `item_aliases` row per (vendor, product) — each vendor's own
  invented part number — so a Vendor PO prints real vendor part numbers
  (`po_item_language: 'vendor'`) instead of falling back to ours with every
  line flagged "unmapped". Testing this surfaced a gap worth fixing for every
  organization, not only dm: Float RFQ used to dead-end on a missing email
  with a toast naming the vendor and pointing at "Add vendor & quote" — a
  screen the user then had to go find. It now opens
  `MissingVendorEmailsModal` right there (`screens-sourcing.jsx`), collects
  the email(s), saves them to the same `config.vendor_emails` every other
  vendor-email save already uses, and retries immediately with the value just
  typed rather than waiting on state to round-trip through a save.
- **`scripts/sql/dm-historical-orders.sql`** — 3 `Closed` Sales Orders, one
  each for 3 of the 5 customers, so `clientPastItems()`
  (`screens-client-requests.jsx`) has something to recommend the very first
  time someone tries the Item Requests screen — a customer with zero past
  orders correctly shows zero recommendations, which means the feature could
  never be demonstrated on a brand-new tenant without this.
- **`scripts/sql/dm-purchase-invoicing-access.sql`** — the expanded Purchase
  override, see below.

## The login

```
https://ops-central.unimisk.com        (works today)
https://dm.ops-central.unimisk.com     (needs the host provisioning step below)

admin@demo.com  /  qwertyui
```

**The hostname is not the security boundary** and never has been. After signing
in on the shared host this admin lands in Demo Org, because their *membership*
says so. The subdomain is branding: it decides which company's name the login
screen shows, nothing more.

### The host still needs one step

DNS already resolves — the wildcard CNAME covers it — but Vercel issues a
certificate **per registered host**, so `dm.ops-central.unimisk.com` currently
fails its TLS handshake. Registering it is one call to the platform console's
*provision* action (Platform → the org → subdomain), which:

1. adds the host to the Vercel project,
2. writes the `_vercel` TXT challenge into Cloudflare — the endpoint is
   hard-limited to TXT records whose name starts with `_vercel`, and refuses
   anything else,
3. asks Vercel to verify.

It needs a platform-admin session, which is why it is not done from a script
here. Until then, use the shared host; everything works.

## The workflow profile

`split_stores`, added by `supabase/migrations/033_split_stores_profile.sql`,
extended by `034_client_acceptance_split_stores.sql`,
`035_split_stores_match_microlink.sql` and
`037_client_order_requests_split_stores.sql`.

| Key | Value | Why |
|---|---|---|
| `receiving_flow` | `stores_to_purchase` | a dedicated inward team confirms arrivals |
| `receiving_requester_roles` | `['Stores In']` | …and it is *them*, not a role called Stores |
| `receiving_approver_roles` | `['Purchase','Org Admin']` | Purchase accepts and posts the GRN |
| `outward_dispatch` | `true` | outward is a team, so it is a step — and it creates the delivery challan in the same action |
| `intransit_tracking` | `true` | somebody is watching for arrivals |
| `client_acceptance` | `true` | the client accepts/rejects delivered quantities before the order is settled |
| `client_order_requests` | `true` | the client sends a typed item request instead of creating the SO themselves — Purchase matches it to the catalogue and creates the SO. See [client-requests.md](./client-requests.md) |
| `po_item_language` | `vendor` | the vendor PO prints their own part numbers — **same as Microlink**, per request |
| `auto_invoice_on_grn` | `false` | matches Microlink |
| `invoice_on_dispatch` | `true` | the client invoice raises on dispatch — **same as Microlink, "for now, will change later"** |
| everything else | as `standard` | no reason to differ yet |

Both invoicing keys now match `procurement_only` exactly — explicitly requested
as a placeholder ("same as Microlink for now"), not a considered decision about
this company's own billing, which is still open.

## Capabilities

On: `sales_desk`, `stores`, `scm_tracking`, `item_mapping`, `surplus_pool`,
`partial_invoicing`, `e_invoice`, `presales`.
Off: `rfq_email`, `implementation`, `cross_so_transfer`, `e_way_bill`,
`whatsapp`, `sms`.

Written as explicit rows rather than left absent. Absent means *inherited*, and
a tenant's capability set should be something you can read rather than infer.

`presales` is on **not** because Demo Org has a Pre-sales team — it does not —
but because it is the flag that unlocks the Sourcing / RFQ module's *route*.
Purchase already carries `doSourcing`/`selectVendor` in the shared code; the one
capability missing was `createSourcing`, granted to Purchase **for this
organization only** — see below.

## The order flow

**The client never creates a Sales Order here — they send a request.** Client
Facing writes down what the client wants as a plain typed list (helped by
recommendations from that customer's own past orders), and sends it to
Purchase. Purchase is the one who matches every typed name to the catalogue —
our code, our name, then the customer's own alias history
([item-name-mapping.md](./item-name-mapping.md)), the same algorithm the sheet
importer uses elsewhere — and creates the real Sales Order. An unmatched item
still defaults to "add as a new catalogue item" rather than sitting unmapped.
See [client-requests.md](./client-requests.md) for the mechanics; it replaces
an earlier version of this flow where Client Facing imported the customer's
own sheet directly (`canImportSheet` briefly admitted `Client Facing` — it no
longer does).

Purchase then floats RFQ to vendors by email from the Sourcing module — the
same "vendor selection + Float RFQ" feature Sales/Pre-sales use elsewhere,
reused here as an **internal vendor-comparison workspace**, not as a customer
quote. Purchase can create the Sourcing record itself (a per-organization
`createSourcing` grant — see below); it never converts one into a second Sales
Order (`canConvert` stays `['Sales','Pre-sales','Org Admin']`, deliberately
unchanged, because the SO already exists — the client already ordered).
Vendor responses land in `sourcings.prices`, exactly as everywhere else the
feature is used.

Purchase picks a vendor per line and raises the Vendor PO from the real SO via
`VendorAllocator` — the same screen, same layout, same e-Bill template every
other organization uses; nothing about the Vendor PO's UI is tenant-specific
code.

Stores In posts the GRN. Stores Out dispatches and the delivery challan is
created in the same action (`outward_dispatch: true`) — unconditional, the same
as Microlink.

The client, through Client Facing, then reviews what arrived: accept the whole
order in one click, or accept/reject each line by quantity. A rejected item is
not a dead end — Purchase sees it flagged, and re-procures through the exact
same RFQ/vendor-selection/PO tools, which offer the item again for exactly the
rejected quantity. It runs the in/out cycle a second time: GRN, dispatch,
challan, review. See [client-acceptance.md](./client-acceptance.md) for the
mechanics. Once the client has actually accepted everything the order
requires — including any replacement — Purchase presses **Confirm & Close**.

## Why the code had to change at all

Three things, and two of them were bugs that predate this tenant.

**A role name was hard-coded into the receiving path.** Three literal
`['Stores', 'Purchase', 'Project Manager', 'Org Admin']` lists in the Virtual
Godown decided who may receive. A company whose stores is two teams has no role
called `Stores`, so not one of its people would have seen a tick box. Those now
read `wfCanReceive(role)`, which comes from the profile — which is what
CLAUDE.md said all along. The `standard` profile still produces exactly those
four roles, and `roles-check` asserts it.

**An unrecognised role was an administrator.** `perm()` fell back to
`PERMISSIONS['Org Admin']` for any role it did not know. A typo, a role dropped
from a customisation, or a browser running yesterday's bundle against a company
that has just invented a role would all have handed out full administrative
access, silently. It now falls back to the dashboard and nothing else.

**Settings offered a role the app did not define.** The team list said
`Project Management`; the permissions key is `Project Manager`. Anybody given
that role resolved through the unknown-role path — which, until the fix above,
meant Org Admin. The label now matches the key, and `roles-check` fails if
Settings ever offers a role again that the app does not define.

**"New Inquiry" was gated on a hard-coded role list too**, not on the
`createSourcing` capability the code already declares for exactly this purpose.
`canCreate` in `screens-sourcing.jsx` was `['Sales','Pre-sales','Org Admin'].
includes(role)` — a literal list no per-organization grant could ever reach. It
now reads `canDo(role, 'createSourcing')`, which is what let Purchase be granted
the capability for this organization alone (below) and have the button actually
appear.

## Purchase's extra capabilities, scoped to this organization only

Purchase does three things here that the base `PERMISSIONS.Purchase` in the
shared code does not grant — each deliberately kept OUT of the shared table,
because granting it there would hand every organization's Purchase role a
button that makes no sense in their own flow:

- **`createSourcing`** — to float RFQ, since this org has no Pre-sales.
- **`raiseInvoice`, `generateEWB`, `logFollowup`, `viewCustomers`**, plus
  `invoices` and `collections` in `nav` — dm has no Billing, Collections or
  Managing Director role, and Client Facing's own nav is deliberately just two
  pages (below), so with `invoice_on_dispatch` + `e_invoice` +
  `partial_invoicing` all on, nobody could see, e-invoice or chase a bill that
  raised itself automatically until this was added. Purchase already "watches
  and closes" the order (see [client-acceptance.md](./client-acceptance.md));
  this lets that same role see it through to payment.

All of it lives in Demo Org's own `config` row
(`config.data.permissions.Purchase`), the same per-organization override
mechanism the Settings → "Screen access by role" editor already uses:

```sql
-- config.data.permissions.Purchase, for this organization's config row only
{"can": {"createRFQ": true, "selectVendor": true, "createVendorPO": true,
         "doSourcing": true, "viewVendors": true, "viewCost": true,
         "viewProducts": true, "createSourcing": true,
         "convertClientRequest": true,
         "raiseInvoice": true, "generateEWB": true, "logFollowup": true,
         "viewCustomers": true},
 "nav": ["dashboard","inbox","client-requests","sourcing","sales-orders",
         "godown","transfers","rfq","vendor-pos","grn","vendors","pool",
         "products","invoices","collections"]}
```

Two traps, one already learned the hard way here and one just repeated:

- **`can` and `nav` are both whole-object overrides, not a merge.** Write only
  `{"createSourcing": true}` and every other capability Purchase had
  disappears — `doSourcing`, `selectVendor`, the lot. Both blocks above repeat
  Purchase's entire base shape and add only the new keys.
- **An override freezes at whatever the base role had the day it was
  written, and silently falls behind every capability added to the base role
  afterward.** This is exactly what happened: the original `createSourcing`
  grant above pre-dated `convertClientRequest` being added to the base
  `PERMISSIONS.Purchase.can`, so Purchase silently lost the only door into
  converting a client's request into a Sales Order — the "Create Sales Order"
  button never appeared, for no error a person could see. `roles-check`
  asserts the base `PERMISSIONS.Purchase` in the shared code carries none of
  Demo Org's org-specific extras — proving this grant lives only in Demo
  Org's own row — but it cannot catch THIS class of bug, because the base role
  gaining a capability is not itself a code change to this org's files.
  `scripts/ssh-audit-permission-drift.py` exists for exactly that: run it
  after adding any capability to a base role, and it reports every
  organization whose override is now missing something the base role has —
  read-only, for a human to judge (an override can also be a *deliberate*
  restriction, which only a human can tell apart from an accident).

## Two more gaps a full read-only audit found

An end-to-end walk of every role against the live tenant (not just the code)
surfaced two more things worth recording.

**Client Facing's two pages didn't include anywhere to review a delivery.**
`client_acceptance` is on for dm — the client accepts or rejects what arrived,
and that panel has always lived on the SO detail page. But Client Facing's nav
is deliberately just `client-requests` and `scm` (below), and `sales-orders`
is not one of them — so the review panel, and the "View Sales Order" button on
a Converted request, both led somewhere Client Facing could not open.
`ClientReviewPanel` is self-gated (see
[client-acceptance.md](./client-acceptance.md)), so the fix was one line:
mount it a second time, inside `SCMTracking`. Every other organization is
unaffected — the panel still renders nothing unless `client_acceptance` is on.

**Dispatch had no capability check at all.** The "Out for delivery" button on
SCM Tracking opened straight to `OutwardDispatchModal` for any role that could
merely open the screen — true on every organization, not only this one, and
harmless everywhere else because only Purchase, Stores, Org Admin and Managing
Director (`SCM_ROLES`) could reach the screen in the first place. Once Client
Facing gained SCM Tracking, that stopped being harmless: a desk with
deliberately no cost, no margin and no operational authority could physically
ship inventory. `screens-scm.jsx` now gates the button on
`canDo(role,'dispatch') || SCM_ROLES.includes(role) || Org Admin` —
`SCM_ROLES` unchanged, so Microlink and OP Central Demo see no difference at
all; Stores Out reaches it through its own `dispatch` capability; Client
Facing and Stores In (receiving is not dispatching) do not.

**The formal SO approval stage is bypassed here, and that is correct for this
org.** An SO from the sheet importer or a converted client request starts at
`Draft`; nothing in the app moves `Draft → Pending Approval → Approved` —
Purchase goes straight to the Procurement tab and raises a Vendor PO, and the
status label self-corrects to `Procurement Started` once that PO exists
(`soDerivedStatus` in `utils.jsx`). This has always been true for the sheet
importer too. dm has no Project Manager or Sales role, so there is no one who
would ever press an "Approve" button anyway — the bypass matches the org's
own role structure rather than working around it.

## Traps

- **A hand-made `auth.users` row needs `''`, not `NULL`,** in
  `confirmation_token`, `recovery_token`, `email_change`,
  `email_change_token_new` and friends. GoTrue reads those varchars into Go
  strings and a NULL fails the scan — the sign-in then returns
  `500 Database error querying schema`, which says nothing about the real cause
  and sends you looking at the password. It cost an hour here. The provisioner
  now writes empty strings and repairs an older row on a re-run.
- **A user without an `auth.identities` row cannot sign in**, however correct
  the password is. Email sign-in resolves the user through it.
- **Cloudflare fronts the API host** and refuses a default `urllib` user agent
  with its own `1010` before the request reaches Supabase. A check that talks to
  the API has to look like a browser.
- **Test isolation as the tenant, never as superuser.** Superuser bypasses RLS,
  so a test that connects that way passes whether isolation works or not.
- **There are several Supabase stacks on that host.** Everything here is scoped
  to `spfohj2m4ij61p4riaup006i`; the other stacks are other products and must
  not be touched.

## Adding the next company

One run, no release:

```bash
SSH_PASSWORD='…' python scripts/ssh-provision-tenant.py \
  --name "Acme Pvt Ltd" --slug acme --subdomain acme \
  --admin-email admin@acme.com --admin-password '…' \
  --profile standard \
  --features-on  "sales_desk,stores,scm_tracking" \
  --features-off "presales,implementation" \
  --dry-run
```

`--dry-run` rolls the whole transaction back and shows exactly what it would do.
Drop it to commit. Re-running is safe: every step is idempotent, and a re-run
repairs a half-finished attempt rather than duplicating it.

Then `python scripts/verify-tenant-isolation.py --email admin@acme.com
--password '…' --expect-org "Acme Pvt Ltd"`.
