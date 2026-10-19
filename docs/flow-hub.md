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
with the exact route the sidebar already offers — opening one is
indistinguishable from clicking the matching sidebar link. The sidebar
itself, every existing route, and every role's actual access are completely
unchanged; this only changes what greets you first.

## How it works

### One mapping, one source of truth for everything inside it

`FLOW_STAGES` is the only new data in this feature — six entries, each a
short list of module ids:

```js
{ id: 'sales-order',  label: 'Sales Order',  icon: 'receipt', modules: ['client-requests','sourcing','sales-orders','customers'] }
{ id: 'vendors',      label: 'Vendors',       icon: 'factory', modules: ['rfq','vendor-pos','vendors','mapping'] }
{ id: 'procurement',  label: 'Procurement',   icon: 'cart',    modules: ['vendor-pos','three-way','pool'] }
{ id: 'inventory',    label: 'Inventory',     icon: 'box',     modules: ['grn','godown','pool'] }
{ id: 'dispatch',     label: 'Dispatch',      icon: 'truck',   modules: ['godown','scm','transfers'] }
{ id: 'billing',      label: 'Billing',       icon: 'cash',    modules: ['invoices','collections'] }
```

A module can legitimately sit in more than one stage — `vendor-pos` is both
where a PO gets issued (Vendors) and what you watch until it arrives
(Procurement); `godown` is both where goods land (Inventory) and where they
leave from (Dispatch); `pool` is checked before buying (Procurement) and is
where surplus comes back to (Inventory). That overlap is the real workflow,
not a bug in the mapping.

**What each stage hub actually displays — label, icon, badge — is never a
second copy of that data.** `flowModuleIndex(state, role)` calls
`opcNavGroups(state, role)` (`shell.jsx`), the sidebar's own single
definition of every module's label and icon, flattens it to one `{id:
item}` lookup, and `FlowStage` just looks up each of its stage's module ids
in it. A module the viewing role cannot reach, or that this organization
has switched off by feature flag, is simply absent from the lookup — it
disappears from the stage hub exactly because it already disappears from
the sidebar, via the identical filter, not a second one that could
disagree.

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
onward to routes the viewer's own role could already reach by using the
sidebar, so making the hub itself universally reachable doesn't expand
anyone's real access — it only changes whether they see a curated starting
point or the raw sidebar first.

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
the sidebar's own function means every future nav change — a module added,
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
  stage hub as it is in the sidebar, or the two disagree.** `mapping`
  reaches Purchase through the bypass, not through Purchase's own `nav`
  array — `flow-check.js` section [3] was first written assuming the nav
  array alone, undercounted by one, and was wrong until it called the real
  `opcNavGroups` and matched what it actually returned.
