# The Flow hub — post-login landing page

**Who:** everyone — this is the first thing any role sees after signing in
**Code:** `screens-flow.jsx` (`FlowHome`, `FlowStage`, `FLOW_STAGES`)
**Test:** `scripts/uitest/flow-check.js`

---

## What it is

A picture of the order lifecycle this ERP runs — Sales Order → Vendors →
Procurement → Inventory → Dispatch → Billing — drawn as six big clickable
nodes connected in a row. Clicking one opens a small hub listing only the
real, already-existing pages that belong to that stage. It is the new
`flow` route, and it is now what every role lands on right after login (and
on a fresh page load / a cleared URL hash) — `dashboard` is still a real
page, one click away via the top-right button, same as it always was.

It is a navigation layer, nothing else. No new data, no new calculation, no
new capability. Every card on a stage hub just calls `navigate(moduleId)`
with a route that was already there — every existing route and every role's
actual access are completely unchanged; this only changes how you get to
them.

It shipped first as *an additional* way in, alongside the old sidebar. A
follow-up change then removed that sidebar outright, at which point this
became the primary — for a mouse, the only — way to reach most screens.
`Ctrl+K`, `g` then a key and `Alt`+letter still reach every screen too; see
[keyboard-control.md](./keyboard-control.md)'s Traps for what that removal
did and did not change.

## How it works

### One mapping, one source of truth for everything inside it

`FLOW_STAGES` is the only new data in this feature — six entries, each a
short list of module ids:

```js
{ id: 'sales-order',  label: 'Sales Order',  icon: 'receipt', modules: ['client-requests','sourcing','sales-orders','customers'] }
{ id: 'vendors',      label: 'Vendors',       icon: 'factory', modules: ['rfq','vendor-pos','vendors','mapping'] }
{ id: 'procurement',  label: 'Procurement',   icon: 'cart',    modules: ['godown','three-way'] }
{ id: 'inventory',    label: 'Inventory',     icon: 'box',     modules: ['pool','grn','transfers'] }
{ id: 'dispatch',     label: 'Dispatch',      icon: 'truck',   modules: ['scm'] }
{ id: 'billing',      label: 'Billing',       icon: 'cash',    modules: ['invoices','collections'] }
```

Each stage lists only what belongs to it (changed 2026-10: Procurement is Virtual
Godowns + 3-Way Match; Inventory is Master Surplus Pool + GRN + Cross-SO
Transfers; Dispatch is SCM Tracking only). `vendor-pos` now lives only under
Vendors and `godown` only under Procurement. A module may still sit in more than
one stage if the mapping says so — nothing in the code prevents it — but none
does today.

**What each stage hub actually displays — label, icon, badge — is never a
second copy of that data.** `flowModuleIndex(state, role)` calls
`opcNavGroups(state, role)` (`shell.jsx`) — the one definition of every
module's label and icon, also what the command palette searches — flattens
it to one `{id: item}` lookup, and `FlowStage` just looks up each of its
stage's module ids in it. A module the viewing role cannot reach, or that
this organization has switched off by feature flag, is simply absent from
the lookup — it disappears from the stage hub exactly because it already
disappears everywhere else that reads the same function, not a second
filter that could disagree.

### Where you land, and why that changes in three different places

"After login" is actually three separate pieces of logic, found by tracing
every place that currently fell back to `'dashboard'`:

1. **`screens-auth.jsx`'s login success handler** — the actual "you just
   typed your password" moment. Used to read `perm(role).primary.route`
   (Sales → sourcing, Purchase → sourcing, Stores → grn, PM/MD → inbox, …).
   Now always `navigate('flow')`, for every role.
2. **`store.jsx`'s initial `route` state** — what a fresh page load with no
   URL hash resolves to. Was `h || 'dashboard'`, now `h || 'flow'`.
3. **`store.jsx`'s `hashchange` listener** — the same fallback, for when the
   hash is cleared mid-session rather than on first load. Was the same
   `'dashboard'` default; left disagreeing with (1) and (2) would have meant
   "land on Flow when you log in, but land on Dashboard if you refresh with
   no hash" — an inconsistency nobody asked for, so all three now agree.

**`perm(role).primary` itself is untouched.** It still does its original,
narrower job: the route `app.jsx`'s own guard falls back to when the
CURRENTLY OPEN route becomes denied mid-session (a feature toggled off
under you, for instance) — a rare, different moment from "where do you
land after login," and not something this change needed to touch.

### Reachability

`canAccess()` gets one new line: `if (root === 'flow') return true;` — the
same shape as the existing `'platform'` special case, not a new general
pattern. Every role can open the hub itself, same as `dashboard`/`godown`
already are universal. This grants nothing new: a stage hub only ever links
onward to routes the viewer's own role could already reach, so making the
hub itself universally reachable doesn't expand anyone's real access — it
only changes what greets them first.

### A role with nothing in a stage

A stage whose every module is denied or feature-blocked for the viewing
role renders with `.flow-node-empty` — visibly dimmed, not clickable, no
`tabIndex`, a tooltip explaining why. This matters more than it looks:
Stores (post `docs/role-permissions.md`'s nav cleanup) has nothing in
Sales Order or Billing at all. Without this, those two nodes would be
ordinary-looking clickable squares that silently open to an empty page —
exactly the kind of "nothing happened" dead end CLAUDE.md's own testing
philosophy exists to catch. If a role somehow still lands on an empty
stage's hub directly (a stale bookmark, a typed URL), `FlowStage` shows the
same honest "Nothing here for your role" message instead of a blank grid.

## Why it is that way

**Why reuse `opcNavGroups` instead of writing the hub's own role-check?**
Because a second filter is a second place to get the rules wrong, and
exactly the mistake this project's own `role-permissions.md` already
documents at length (a page becoming reachable by more roles exposed
cross-navigation links nobody had audited for the new audience). Calling
the one nav function means every future nav change — a module added,
a role's access trimmed, a feature flag introduced — reaches the flow hub
automatically, with nothing to remember to update here.

**Why not also change `perm(role).primary`?** Because that field already
has a real, narrower job (the safe fallback when an open route goes bad
mid-session), and conflating "where you land after login" with "where you
land when something breaks" would have meant two different concerns
sharing one field — the first new instance of exactly the "one definition,
two different questions" shape this project's rules already warn against,
just inverted.

## Traps

- **"After login" is not one piece of code.** Grepping only for
  `'dashboard'` as a hash fallback misses the actual login-transition
  logic, which reads `primary.route` through a completely different code
  path in `screens-auth.jsx`. All three had to be found and changed
  together, or the three ways to reach the app (login, fresh load, cleared
  hash) would have disagreed about where "home" is.
- **A module filtered in two different places (nav array + the
  `SCM_ROLES`/`SCM_ROUTES_SET` bypass) must be filtered the same way on a
  stage hub as it is by `opcNavGroups` itself, or the two disagree.**
  `mapping` reaches Purchase through the bypass, not through Purchase's own
  `nav` array — `flow-check.js` section [3] was first written assuming the
  nav array alone, undercounted by one, and was wrong until it called the
  real `opcNavGroups` and matched what it actually returned.
- **This was built assuming a sidebar would still be there as a fallback.**
  "Making the hub itself universally reachable doesn't expand anyone's real
  access — it only changes what greets them first" was true only as long as
  the sidebar was still the actual way to reach every other screen. A later
  change removed it, at which point this hub (plus `Ctrl+K`, `g`, and
  `Alt`+letter) became the ONLY way most roles reach most screens — a
  gap in this hub now means a module nobody can get to, not a module one
  click further away. Re-reading `flow-check.js` after that change rather
  than assuming "pure navigation, nothing changed" still held was exactly
  right: the hub's *content* didn't change, but what hinged on it did.
