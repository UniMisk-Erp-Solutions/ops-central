# Client requests — what the client wants, before there is an SO

**Who:** Client Facing writes it down and sends it; Purchase matches it and creates the SO
**Where:** a new "Item Requests" screen, in the Sales nav group
**Code:** `frontend/src/screens-client-requests.jsx`, the `client_order_requests`
workflow key, the `client_requests` table
**Test:** `scripts/uitest/client-requests-check.js`

---

## What it is

On an organization running this flow, **the client never creates a Sales
Order.** Client Facing writes down what the client asked for — free text, in
the client's own words, one line per item with a quantity — helped by a list
of what that same customer has ordered before. It gets sent to Purchase, who
matches every typed name to a real catalogue item and is the one who actually
creates the Sales Order.

It is **off for every organization by default**, the same discipline as
[client-acceptance.md](./client-acceptance.md): where
`wf('client_order_requests')` is not switched on, the "Item Requests" route
does not exist — not hidden by a role check, blocked at the route itself, the
same way a disabled feature flag blocks a route — and every function this
document describes is defined but never reached.

Client Facing's whole nav is exactly two pages: **Item Requests** and **SCM
Tracking**. Nothing else — no Sales Orders, Customers, Invoices, Collections
or Products, even though earlier drafts of this role carried some of those.
SCM Tracking is safe for this desk for the same reason the rest of its access
always excluded cost: `scmLineTotals` (`screens-scm.jsx`) is pure quantities —
ordered / on PO / in transit / received / dispatched — with no vendor price or
identity anywhere in it. `PERMISSIONS['Client Facing'].nav` in
`permissions.jsx` is the one place this list is defined; `roles-check.js`
asserts it is exactly `['client-requests', 'scm']`.

This replaces an earlier design (still visible in git history) where Client
Facing created the SO directly by importing the customer's own sheet. The
client-side "import" door is closed again — `canImportSheet` is back to
`['Purchase', 'Org Admin']` — because the client typing a list and Purchase
turning it into an order are now two different steps, done by two different
people.

## How it works

### The request

A `client_requests` row: a customer, a status (`Draft` → `Sent` → `Converted`
| `Cancelled`), and `items: [{id, text, qty, note, product_id, matched_by}]`.
`text` is exactly what the client typed — never edited on the way in.
`product_id`/`matched_by` are empty until Purchase's mapping step; the one
exception is an item added straight from a recommendation, which already
carries its `product_id` because it came from a past order.

Client Facing can save a request as a Draft and keep editing it, or send it —
which notifies Purchase and freezes nothing else; a sent request's items are
still exactly what the client said, ready for Purchase to interpret.

### Recommendations

`clientPastItems(state, customerId, getProduct, limit)` tallies every product
line across that customer's past Sales Orders, ranked by how many times
they've ordered it and, on a tie, how recently. It reads only **this**
customer's history — a name mapping that makes sense for one customer says
nothing about another's. Tapping a recommendation adds it pre-matched
(`matched_by: 'past_order'`), since we already know which catalogue item it
is; Purchase does not have to re-map it.

### Matching — the same algorithm as everywhere else

`matchRequestItems(customerId, items)` calls `opc_alias_resolve_bulk` — the
identical server-side matching cascade the sheet importer uses (our code, our
name, then this customer's own alias history), given one row per free-typed
item instead of one row per sheet line. There is no second matching
algorithm in this app; every entry point into it — sheet import, RFQ vendor
mapping, and now this — calls the same function. See
[item-name-mapping.md](./item-name-mapping.md).

On the request's detail page, once it is `Sent`, Purchase sees every item with
its suggested match (or "add as a new catalogue item" if nothing matched) and
can override any of them from a dropdown before converting.

### Converting — Purchase creates the SO

`ClientRequestDetail`'s convert step:

1. Every item must resolve to either an existing product or "create new item"
   — the same fallback the sheet importer already uses, at
   `p-creq-<timestamp>-<index>`.
2. Purchase enters the Sales Order number by hand (`soNoTaken` flags a
   collision live, same input pattern as `SalesOrderNew`) and the customer PO
   reference.
3. The SO is written directly — same shape `SalesOrderNew` builds (`status:
   'Draft'`, one line per requested item) — and the request is marked
   `Converted`, carrying `converted_so_id`.
4. Every matched item is learned back via `opc_alias_set_bulk` — **name-only**
   rows, since a client request never has a separate "code" field, only the
   client's own wording. The database accepts this: `code` is nullable
   (`nullif(trim(...), '')`), only `product_id` is required. So the next time
   this customer types the same words, it resolves itself.

From here on it is the existing machinery, completely unchanged: procurement,
RFQ, vendor PO, GRN, dispatch, client review, close.

### "View Sales Order" goes wherever that role can actually see it

A `Converted` request shows a "View Sales Order" button. It does not send
every role to the same place: Client Facing cannot open the SO detail page
(see [client-acceptance.md](./client-acceptance.md)'s note on their two-page
nav), so for them it navigates to `scm/<soId>` — SCM Tracking, pre-selected on
that order — instead of `sales-orders/<soId>`. Every other role still gets the
full detail page. `SCMTracking` accepts an optional `soId` prop for exactly
this; without it, it falls back to the first order, as it always has.

## Why it is that way

**Why is Purchase's capability `convertClientRequest`, not the general
`createSO`?** Because Purchase creating a Sales Order here is not "Purchase
gets a New Sales Order button" — it is one specific action, converting one
specific request, with its own mapping step in front of it. Giving Purchase
`createSO` would also open the generic `SalesOrderNew` screen, which makes no
sense for a role whose only source of an order is a client's request.

**Why is the whole route gated on a workflow key rather than a feature
flag?** Because "does this company's client type a request instead of
creating the SO" is a fact about how the company works, not a switch for
whether a screen is visible — the same reasoning as every other `wf()` key.
`WORKFLOW_ROUTES`/`workflowBlocks()` in `permissions.jsx` is the workflow-key
analogue of the existing `FEATURE_ROUTES`/`featureBlocks()` pair: a route that
belongs to one company's process rather than an optional module.

**Why is `nav`/`can` changed in the shared `PERMISSIONS` table this time,
instead of a per-organization `config` override** (the way Purchase's
`createSourcing` grant was done for this same tenant)? Because the route
itself is invisible to every other organization regardless — `client_order_requests`
defaults to `false` everywhere, so `workflowBlocks('client-requests')` returns
`true` and the route never renders, no matter what a role's `nav` array says.
`createSourcing` was different: it granted a button on a screen
(`screens-sourcing.jsx`) that **already exists and is visible** for every
organization, so it had to be scoped per-organization to avoid changing what
every other company's Purchase role sees. There is no such existing, always-visible
screen here to protect.

## Traps

- **A role's `primary` route must never be workflow-gated.** Client Facing's
  `primary` was briefly set to `client-requests` itself — reads naturally, "the
  role's main page is the one it exists for" — but that route is blocked by
  `workflowBlocks` for every organization where `client_order_requests` is off,
  which includes the sandboxed default `roles-check.js` runs under. The result
  was the exact bug this feature shipped with: **the App's route guard
  redirects to `primary` whenever the current route is inaccessible, and if
  `primary` is *itself* inaccessible, the role lands nowhere reachable** — from
  the outside this looks exactly like "the page won't open," because the
  redirect fires immediately, silently, before anything renders. `primary` is
  `scm` instead — a route with no workflow gate — precisely so this can never
  happen again. `roles-check.js`'s "no role lands on a screen it may not open"
  check exists to catch exactly this.
- **`can` is a whole-object override, not a merge** — the same rule every
  other permissions change in this app has to respect. Not relevant to this
  change specifically (it edits the shared `PERMISSIONS` table, not a
  per-organization override), but the next person who *does* need an
  organization-specific tweak to Client Facing or Purchase here must repeat
  the whole `can` object, not just the new key.
- **A decided design got reversed mid-build.** An earlier version of this
  flow had the client import their own sheet and create the SO directly
  (`canImportSheet` briefly admitted `'Client Facing'`). That is gone —
  reverted to `['Purchase', 'Org Admin']` — because the client no longer
  creates anything that becomes an order; they only describe what they want.
  `client-review-check.js` asserts the importer's role list directly so this
  cannot regress silently.
- **A client request's items have no "code," only free text.** The alias
  learn-back has to pass `code: null` and rely on `name` alone — unlike the
  sheet importer, which usually has both. `opc_alias_set_bulk` (029) already
  supports this; the trap is assuming every caller of it has a code to offer.

## Where the code is

| Thing | Where |
|---|---|
| `client_requests` table, RLS, sync-columns registration | `supabase/migrations/036_client_requests.sql` |
| `client_order_requests` preset default for `split_stores` | `supabase/migrations/037_client_order_requests_split_stores.sql` |
| `clientReqNo`, `clientPastItems`, `matchRequestItems` | `frontend/src/screens-client-requests.jsx` |
| `ClientRequestList`, `ClientRequestNew`, `ClientRequestDetail` | `frontend/src/screens-client-requests.jsx` |
| `createClientRequest` (Client Facing), `convertClientRequest` (Purchase) | `PERMISSIONS` in `frontend/src/permissions.jsx` |
| `WORKFLOW_ROUTES` / `workflowBlocks()` — the workflow-key route gate | `frontend/src/permissions.jsx` |
| Routes (`client-requests`, `client-requests/new`, `client-requests/:id`) | `frontend/src/app.jsx` |
| Nav entry ("Item Requests", Sales group) | `frontend/src/shell.jsx` |
| `client_requests` in the sync/load table lists | `frontend/src/store.jsx` |
| Checks | `scripts/uitest/client-requests-check.js` |
