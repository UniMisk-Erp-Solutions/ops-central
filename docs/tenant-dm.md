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
| **Client Facing** | takes the order, chases the invoice. **No cost, no margin.** |

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
extended by `034_client_acceptance_split_stores.sql` and
`035_split_stores_match_microlink.sql`.

| Key | Value | Why |
|---|---|---|
| `receiving_flow` | `stores_to_purchase` | a dedicated inward team confirms arrivals |
| `receiving_requester_roles` | `['Stores In']` | …and it is *them*, not a role called Stores |
| `receiving_approver_roles` | `['Purchase','Org Admin']` | Purchase accepts and posts the GRN |
| `outward_dispatch` | `true` | outward is a team, so it is a step — and it creates the delivery challan in the same action |
| `intransit_tracking` | `true` | somebody is watching for arrivals |
| `client_acceptance` | `true` | the client accepts/rejects delivered quantities before the order is settled |
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

Client Facing takes down what the client ordered and imports it the same way
Purchase or Microlink always have — the sheet importer now also admits
`Client Facing` (`canImportSheet`), running the identical matching algorithm:
our code, our name, then the customer's own alias history
([item-name-mapping.md](./item-name-mapping.md)). An unmatched row still
defaults to "add as a new catalogue item" rather than sitting unmapped — nothing
about the algorithm changed with who runs it.

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

## Purchase's one extra capability, scoped to this organization only

Purchase needs `createSourcing` to float RFQ here, and **only** here — granting
it in the shared `PERMISSIONS` table would hand every organization's Purchase
role a "New Inquiry" button that makes no sense in their flow. Instead it is
written into Demo Org's own `config` row (`config.data.permissions.Purchase`),
the same per-organization override mechanism the Settings → "Screen access by
role" editor already uses:

```sql
-- config.data.permissions.Purchase.can, for this organization's config row only
{"createRFQ": true, "selectVendor": true, "createVendorPO": true,
 "doSourcing": true, "viewVendors": true, "viewCost": true,
 "viewProducts": true, "createSourcing": true}
```

One trap in `perm()`'s merge rule made this easy to get wrong: **`can` is a
whole-object override, not a merge.** Write only `{"createSourcing": true}` and
every other capability Purchase had disappears — `doSourcing`, `selectVendor`,
the lot. The override above repeats Purchase's entire base `can` object and adds
the one new key. `roles-check` asserts the base `PERMISSIONS.Purchase` in the
shared code carries **no** `createSourcing` — proving this grant lives only in
Demo Org's own row, never in anything another organization could inherit.

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
