# Role permissions — who sees which module

**Who:** anyone adding a role, a screen, or a nav item
**Code:** `permissions.jsx` (`PERMISSIONS`, `ALL_MODULES`, `perm()`, `canAccess()`),
`shell.jsx` (`opcNavGroups()`, the Sidebar, `notificationRoute()`)
**Tests:** `scripts/uitest/role-nav-check.js`, `scripts/uitest/roles-check.js`

---

## What it is

`PERMISSIONS` is one object, keyed by role, that answers two separate
questions for each role: **`nav`** — which sidebar modules it sees — and
**`can`** — which specific actions it may take once it's on a screen. `nav`
is also the access-control list: `canAccess(role, route)` is driven by the
same array the Sidebar filters on (see `shell.jsx`'s `opcNavGroups()`), so
there is exactly one definition of "what can this role reach," not a
sidebar list and a separate guard list that could drift apart.

Per-organization customisation reads the same shape. `perm(role)` merges a
DB-backed override (`window.__opcPerms`, loaded from Supabase, edited from
Settings) over the built-in `PERMISSIONS[role]` — **absent still means the
code default**, so a tenant that has never touched role permissions behaves
exactly as described here, and only a tenant whose admin has actually
edited a role sees anything different. This file documents the shared
*default*; a given organization can diverge from it without touching code.

## How it works

### 2026-10: every role trimmed to what it actually uses

Before this, roles carried whatever nav list seemed reasonable at the time
they were added — mostly right, but with no evidenced check against
whether a role really used every module it could see, which made a client
demo under any non-admin role feel cluttered: modules that role never
touches, sitting next to the ones it does.

The rule applied, uniformly:

- **Org Admin and Managing Director get literally every module.** Both
  carry `ALL_MODULES` — one array, so the two lists can never quietly drift
  apart, and adding a new screen to the sidebar means adding it to this one
  list, not two.
- **Every other role keeps `dashboard` and `godown`, always.** Non-negotiable,
  by explicit request — these are the two screens new to the company and
  familiar to everyone at once.
- **Everything else is evidenced, not guessed.** A module stays in a role's
  nav only if something concrete ties it there: a `can` capability, a real
  role-array check inside that module's own screen (`['Purchase', 'Project
  Manager', ...].includes(role)`), or `buildTasks()` actually assigning that
  role a task that lives on that screen. A module with none of the three
  came out.

What actually moved (see `permissions.jsx` for the per-role comments):

| Role | Removed | Why |
|---|---|---|
| Stores, Stores In, Stores Out, Supervisor | `inbox` | None of the four ever appears as a `role` in `buildTasks()` — My Tasks would always be empty |
| Purchase | `transfers` | Zero interactive role anywhere in `CrossSOTransfers` (grepped the whole component) — initiate/approve/confirm is Project Manager + MD/Org Admin only |

And what was added: `godown` to every role that lacked it (Sales, Pre-sales,
Billing, Collections, Client Facing), `dashboard` to Client Facing (the only
role missing it), and `ALL_MODULES` to Managing Director (previously a
dozen hand-picked routes, now identical to Org Admin's list).

**Everything else stayed.** Several items that looked, on first read, like
plausible trims turned out to have a real cross-navigation dependency once
checked — see Traps below. The lesson generalized: a role's own `can`
object is necessary evidence but not sufficient; a page it can reach might
still *link into* a module it doesn't otherwise have nav access to.

### The real risk wasn't the trim — it was Virtual Godown becoming universal

`VirtualGodownList` and `VirtualGodownView` were written when only roles
broad enough to already carry `pool`, `transfers`, `vendor-pos`, `grn` and
`sales-orders` could ever reach the Virtual Godown page — so their header
buttons and cross-reference links never had to consider a role that
couldn't open the destination. The moment `godown` became universal, every
one of those assumptions became live for roles that lack the destination
module: Sales (no `pool`/`transfers`) would have hit a dead-end "Master
Pool" button; Collections (no `sales-orders`/`vendor-pos`/`grn`) would have
hit a dead-end "View SO" button and dead PO/GRN links.

**canAccess failing is not a crash — it's silent.** The app-level route
guard (`app.jsx`) catches a denied route and redirects to the role's
primary, with no error shown. That makes this class of bug *worse* to
leave in, not better: a user clicks a button, nothing visibly breaks, and
they're just somewhere else — the kind of thing a QA pass can miss and a
client demo can't.

Fixed at each exact spot, not by broadening access:

- `VirtualGodownList`'s "Master Pool"/"Transfers" header buttons now check
  `perm(role).nav.includes('pool' | 'transfers')` before rendering at all.
- `PendingReceiptsPanel`'s PO-number and `VGGrnCard`'s GRN-number render as
  a real link only if the viewer has `vendor-pos`/`grn` (or `sales-orders`,
  which already drills into both from the SO's own tabs) — otherwise plain
  text. The information (which PO, which GRN) stays visible either way;
  only the dead click-through is removed.
- `VirtualGodownView`'s "View SO" button is gated the same way, on
  `sales-orders`.

### Why not just broaden `canAccess` instead?

There's already a precedent for "a role without a module's own list page
can still open a *specific record* it was led to" — the existing exception
for `invoices/<id>`, reachable by anyone with `sales-orders` or `godown`.
Generalizing that same exception to `vendor-pos`/`grn`/`sales-orders` was
the first approach tried here, and it was wrong: an invoice shows the
customer-facing sell price, but `SalesOrderDetail`'s own Overview tab
already renders `@{inr(p.buy)}` — **vendor buy price — unconditionally**,
to any role that can open it, not gated by `viewCost` at all. Client
Facing is explicitly designed to never see a buy price ("the easiest place
for a buy price to be read out loud by accident," per its own code
comment). Broadening the exception would have handed that role a working
click-path to exactly the number it was built to keep from them, the
instant it gained `godown`. Gating the individual links instead — rather
than the destination routes — was the only fix that doesn't reopen that
hole. See Traps.

## Why it is that way

**Why evidence (grep for real usage) instead of reasoning from `can`
alone?** Two trims that looked obviously safe from `can` alone turned out
to be wrong on inspection: Billing lacks `createVendorPO`-adjacent
capabilities but opens a PO's full detail page from its own SO's Vendor
POs tab (`SOVendorPOsTab`'s "Open PO" button) — removing `vendor-pos` from
its nav would have broken that. Pre-sales has no `can` flag tying it to
Sales Orders, but the Sourcing detail screen it already uses renders a
"View Sales Order" button the moment an inquiry converts — same break.
`can` describes what a role may *do*; it says nothing about what a page
that role *can already see* might link into. Only grepping every
`navigate()` call actually reachable from a role's existing nav settles it.

**Why gate individual links/buttons instead of the destination route?**
Because the destination route is shared risk surface — broadening
`canAccess` for `vendor-pos`/`grn` would have fixed the dead-link problem
for every role at once, but also handed URL-guessing access to vendor cost
to roles explicitly designed not to see it (see the Client Facing case
above). Gating the UI element that LINKS to the record costs a few more
lines per spot, but keeps the actual access boundary exactly where it was.

## Traps

- **A role's own `can` capabilities are necessary evidence, not sufficient
  evidence, for whether it needs a nav item.** Billing/`vendor-pos` and
  Pre-sales/`sales-orders` both looked like safe removals by `can` alone
  and both were real regressions, caught only by grepping every
  `navigate()` call reachable from a page that role already has. Before
  removing a module from any role, grep the whole app for
  `navigate(\`<module>` and `navigate('<module>'` and check whether any
  hit is reachable from a page the role keeps.
- **`canAccess` failing redirects silently — it does not crash, error, or
  show "access denied."** `app.jsx`'s route guard bounces a denied route
  straight to the role's primary. This makes broken cross-navigation links
  genuinely easy to ship unnoticed (`render-check.js`'s "nothing blanks"
  sweep will not catch it either, since nothing blanks — it silently
  redirects). The only reliable check is a markup assertion that the link
  or button is simply absent for a role that cannot open its destination,
  which is exactly what `role-nav-check.js` sections [5]/[6] do.
- **A page becoming universal exposes every assumption every OTHER screen
  made about who could reach it.** This is the core lesson here: nothing
  about `VirtualGodownList`/`VirtualGodownView`'s own code changed in a way
  that should have mattered — the only change was `godown` joining more
  roles' nav lists, and that alone was enough to turn four previously-dead
  code paths live. Any future "make X universal" change needs the same
  audit: grep every unconditional `navigate()` inside that module for a
  route the newly-added roles might not have.
- **A fix that broadens access instead of gating the UI element can reopen
  a deliberately-closed hole.** `SalesOrderDetail`'s Overview tab renders
  vendor buy price (`p.buy`) unconditionally to any role that can open the
  page — not gated on `viewCost`. Client Facing is specifically designed
  (see its comment block in `permissions.jsx`) to never see that number.
  The first fix attempted here — extending the existing `invoices`-style
  canAccess exception to also cover `sales-orders`/`vendor-pos`/`grn` via
  `godown` membership — would have handed Client Facing (and any other
  cost-blind role) a working URL straight to it. Caught only by actually
  reading what the destination page renders before broadening who can
  reach it, not by assuming a precedent (the invoices exception) that
  looked structurally identical was equally safe to generalize. It wasn't:
  invoices carry sell price only; vendor PO/GRN pages carry vendor
  cost/rate as their primary content.
- **Notification routing and nav access are two separate lists that have
  never been cross-checked.** `NotificationsDrawer`'s click handler
  (`shell.jsx`) routes a notification by its `kind` to a fixed destination
  route, entirely independent of whether the notification's role TARGET
  actually carries that route in its own nav. Auditing this file's own
  change surfaced three live instances: a `transfer`-kind notification to
  Stores (who has never had `transfers`, even before this change — a
  pre-existing bug), a `grn`-kind notification to Billing (who has never
  had `grn` — also pre-existing), and an unhandled-kind notification to
  Stores now that it lost `inbox` in this same change (the one genuinely
  new regression). Fixed once, generally, via `notificationRoute(n, role)`
  falling back to `dashboard` — the one route every role keeps — whenever
  `canAccess(role, dest)` is false, rather than patching each kind
  individually. `role-nav-check.js` section [7] proves both the
  pre-existing cases and the one this change could have introduced.
