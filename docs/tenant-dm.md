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

`split_stores`, added by `supabase/migrations/033_split_stores_profile.sql`.

| Key | Value | Why |
|---|---|---|
| `receiving_flow` | `stores_to_purchase` | a dedicated inward team confirms arrivals |
| `receiving_requester_roles` | `['Stores In']` | …and it is *them*, not a role called Stores |
| `receiving_approver_roles` | `['Purchase','Org Admin']` | Purchase accepts and posts the GRN |
| `outward_dispatch` | `true` | outward is a team, so it is a step |
| `intransit_tracking` | `true` | somebody is watching for arrivals |
| `auto_invoice_on_grn` | `false` | **not decided yet** |
| `invoice_on_dispatch` | `false` | **not decided yet** |
| everything else | as `standard` | no reason to differ yet |

Both invoicing triggers are **off**. Nothing bills by itself until the company
says where billing belongs in their flow: off is recoverable, an invoice sent to
a customer by surprise is not.

## Capabilities

On: `sales_desk`, `stores`, `scm_tracking`, `item_mapping`, `surplus_pool`,
`partial_invoicing`, `e_invoice`.
Off: `presales`, `rfq_email`, `implementation`, `cross_so_transfer`,
`e_way_bill`, `whatsapp`, `sms`.

Written as explicit rows rather than left absent. Absent means *inherited*, and
a tenant's capability set should be something you can read rather than infer.

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
