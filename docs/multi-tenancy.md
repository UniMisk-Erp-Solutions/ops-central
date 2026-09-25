# Multi-tenancy — one deployment, many companies

One database, one frontend, many organizations. Two questions are kept separate
because they are genuinely different:

| Question | Answered by |
|---|---|
| What can this company **see**? | feature flags (`organization_features`) |
| How does this company **work**? | workflow profile (`workflow_profiles`) |
| What can this company **read/write**? | **RLS**, on membership — never on hostname |

---

## Isolation

Data access is decided **server-side** by row-level security against
`organization_memberships` joined on `auth.uid()`. The subdomain is a
branding/UX signal only and is never trusted.

```sql
create policy tenant_all_<table> on public.<table> for all to authenticated
  using      (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
```

Everyone — including platform admins — works in **one organization at a time**
(`active_org_id()`), and column defaults stamp it automatically.

**Rules for every new table:**
1. `organization_id uuid not null references organizations(id) on delete cascade
   default public.active_org_id()`
2. Enable RLS and add the `tenant_all_` policy above.
3. `revoke all from anon`.
4. Any service-key insert must set `organization_id` explicitly — the default
   only works for a real signed-in user.

Master data uses composite keys `(organization_id, id)` so two organizations can
legitimately hold the same product code without colliding.

---

## Users: one identity, scoped by membership — not by a column on `users`

`public.users` has **no `organization_id` column**. A login's organization(s)
come entirely from `organization_memberships` (`user_id`, `organization_id`),
because one email can legitimately belong to more than one org. RLS on
`users` reflects that: *"see profiles of people you share an org with — a
master admin sees everyone"* (`shares_org_with`, `021_phase3_tenant_rls.sql`).
That second half is deliberate — it is what lets the Platform Console assign
an existing login as a brand-new organization's first admin.

**The trap this created:** the frontend's bulk user load used to be a bare
`.from('users').select(...)`, trusting RLS alone to scope it. For an ordinary
single-org user that happened to look fine — but the very first admin
account ever created automatically becomes a **master admin**
(`opc_bootstrap_org_for`), and RLS correctly hands a master admin *every*
active row in the whole platform. That became `state.users` — the array
`getUser()` and the topbar's "Act as" role-switcher (`shell.jsx`) both read —
so a master admin's own "test another role" bar showed every organization's
users mixed into one flat list: initials clashing, a Purchase from one
tenant sitting next to a Purchase from another.

**Fixed with a scoped RPC, not a stricter RLS policy** — tightening RLS would
have broken the Platform Console's legitimate cross-org need. Two functions
now exist (`038_org_scoped_users.sql`):

```
opc_org_users()        the CALLER's own active_org_id() roster — the new
                        source for state.users, used everywhere ordinary
opc_admin_all_users()   every login on the platform, master-admin only —
                        the one legitimate cross-org read, used ONLY by
                        NewOrgModal's "assign an existing login as this
                        org's first admin" picker (screens-platform.jsx),
                        never leaned on from the general app
```

Both are scoped through `active_org_id()` / `is_master_admin()`, the same
functions config/features/workflow already resolve through — "which org am I
looking at" is answered once, not reinvented per table.

`scripts/uitest/boot-check.js` locks this in: its mocked `.from('users')`
fallback deliberately answers with a user from a *different* organization
(`FOREIGN_USER`), and every scenario asserts `state.users` never contains it
— proving the real code path is the scoped RPC, not the raw table, regardless
of which mock a future change happens to call.

---

## Workflow profiles

Behaviour lives in data, so a new kind of company is an INSERT, not a release.

```
workflow_profiles                       preset catalogue
organizations.workflow_profile          which preset an org runs
organization_settings.data->'workflow'  per-org overrides

effective = preset defaults || overrides        (override wins)
```

Delivered to the browser by `opc_my_context()` as `window.__opcWorkflow`, read
through the `wf()` / `wfOn()` / `wfReceiving()` helpers.

**Every consumer must fall back to the historic behaviour when a key is absent.**
A failed context load, an old cached tab, or an org with no profile must behave
exactly as before — never blank, never a new behaviour by accident.

Never hard-code a role name into a receiving / PO / dispatch path. Read the
setting. See [microlink-procurement-flow.md](./microlink-procurement-flow.md) for
a company whose receiving runs in the opposite direction.

---

## Feature flags

`featureOn(key)` — **absent means inherited (on)**, only an explicit `false`
switches something off. A deliberate deviation from "default deny": a brand-new
tenant with no rows must not open to an empty application.

---

## Things that are per-organization and easy to forget

These are not table rows, so RLS does not protect them. They live on `window`
and **must be cleared when the user or the organization changes**:

| Global | Holds |
|---|---|
| `__opcFeatures` | capability flags |
| `__opcWorkflow` | workflow settings |
| `__opcPerms` | nav / capability customisations |
| `__opcOrg`, `__opcIsMaster` | tenant context |

Cached state in `localStorage` is stamped with `__uid` / `__orgId` and purged
when either changes.

> This bit has bitten twice. `__opcPerms` was left in place across a sign-out, so
> one company's menu applied to the next user's session — and because the config
> effect returns early for an org that has no config row yet (every brand-new
> organization), it never got overwritten. When that stale object was missing a
> field, the shell threw and **every page went white**. The lesson is not "add a
> null check": anything cached per-organization outside the database needs an
> explicit reset path, and that path needs a test.

`scripts/uitest/render-check.js` renders the whole app for every role and route,
including with a previous tenant's partial blob still present.

---

## Subdomains

`<slug>.ops-central.unimisk.com`, assigned from the platform console, which also
provisions the host with Vercel and Cloudflare. Hosts are registered
per-subdomain: a wildcard would require moving nameservers to Vercel.

TLS for tenant hosts is issued by **Vercel**, not Cloudflare — those records are
DNS-only, so Cloudflare's one-level Universal SSL limit does not apply.

---

## Provisioning one

A company is an INSERT, not a release. One script does the whole thing — login,
organization, membership, capabilities, profile — in one transaction, and it is
idempotent, so a re-run repairs a half-finished attempt rather than duplicating
it:

```bash
SSH_PASSWORD='…' python scripts/ssh-provision-tenant.py   --name "Acme Pvt Ltd" --slug acme --subdomain acme   --admin-email admin@acme.com --admin-password '…'   --profile standard --dry-run          # drop --dry-run to commit
```

It prints every organization's row counts before and after, because the thing
most worth proving about a new tenant is that the existing ones did not move.
See [tenant-dm.md](./tenant-dm.md) for a worked example, and for the two traps
that cost an hour: a hand-made `auth.users` row needs empty strings rather than
NULLs in its token columns, and a user with no `auth.identities` row cannot sign
in however right the password is.

## Verifying

```bash
SSH_PASSWORD='…' python scripts/ssh-test-tenant-isolation.py
SSH_PASSWORD='…' python scripts/ssh-verify-workflow-profiles.py
python  scripts/verify-tenant-isolation.py          # as the tenant, over the API
node scripts/uitest/render-check.js frontend
node scripts/uitest/roles-check.js frontend
```

Run isolation checks **as a real tenant user** (`role=authenticated` plus that
user's JWT claim), never as superuser — superuser bypasses RLS, and a test that
bypasses the thing it is testing always passes.
