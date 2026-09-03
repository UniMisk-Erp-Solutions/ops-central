# How this app is put together

Read this before editing any `.jsx`. It explains a few decisions that are
unusual, and the failure modes they cause.

---

## There is no build step

`index.html` loads React, ReactDOM and **Babel standalone** from a CDN, then
loads every `src/*.jsx` as `<script type="text/babel">`. Vercel serves the files
as they are.

Three consequences, all of which have bitten:

**1. `import` does not exist.** No ES modules, no bundler, no `import.meta.env`.
Files share things by assigning to `window` at the bottom, and read them as bare
globals. A `.ts`/`.tsx` file simply would not run.

**2. Every file shares ONE global scope.** Two files declaring the same
top-level `const` break each other. Prefix helpers that belong to one screen
(`imp*` for the importer, `alloc*` for the allocator).

**3. A mistake is a RUNTIME error, not a build error.** `esbuild --bundle=false`
only proves a file *parses*. It cannot tell you a global is missing or that a
field is undefined — the page just goes white. That is why
[testing.md](./testing.md) exists and why `render-check` actually executes every
file and renders every screen.

Runtime config comes from `window.OPC_ENV` in `src/config.js`, **not** from
environment variables. Vercel env vars do nothing here; change `config.js` and
redeploy.

---

## The store

`StoreProvider` (`src/store.jsx`) holds all application state in one object and
exposes it through `useStore()`.

```js
const { state, mutate, navigate, getProduct, ... } = useStore();
mutate(s => ({ ...s, sales_orders: [...] }), { action: 'create', entity: 'SalesOrder' });
```

`mutate` applies the updater, writes an audit entry, and **optimistically syncs
to Supabase**. Two tables lists govern that:

- `SYNCED_TABLES` — written back on change, keyed by primary key
- `LOADED_TABLES` — read on login (master data included; see below)

### Rows are sent as-is, filtered to real columns

The store upserts its in-memory row objects straight to PostgREST. If a screen
puts an extra field on a row, PostgREST rejects **the whole row**.

That happened: the importer set `imported_from`, `po_ref` and `created_by` on a
sales order, none of which are columns, so the order lived in one browser and
nowhere else. Now `opc_sync_columns()` tells the client what each table actually
has and every row is trimmed to that. **Anything extra belongs in `extra`**,
which is a `jsonb` column.

### A failed write is never silent

It used to be a `console.error`, which nobody reads, so a rejected record looked
saved. Any sync failure now raises a banner in the page — table, row, reason,
and Retry.

### `state` inside an async handler is a SNAPSHOT

`mutate` is `setState`; it does not update the `state` you already destructured.
Anything that loops and mutates must compute from the updater argument, not from
the captured `state`. `scripts/uitest/receipt-engine-check.js` deliberately
models the stale snapshot, because the forgiving version hides real bugs.

---

## Per-organization state that is NOT in a table

These live on `window` and are **not** protected by RLS, so they must be cleared
when the user or organization changes:

| Global | Holds |
|---|---|
| `__opcFeatures` | capability flags |
| `__opcWorkflow` | workflow settings |
| `__opcPerms` | nav / capability customisations |
| `__opcOrg`, `__opcIsMaster` | tenant context |

> Leaving `__opcPerms` in place across a sign-out once applied one company's menu
> to the next user — and, being partial, crashed the shell so every page went
> white. Anything cached per-organization outside the database needs an explicit
> reset path and a test.

`localStorage` is a **recovery buffer, not a render source**. Which user wrote it
cannot be known at boot, so with a backend its rows are held aside in `__cached`
and only used to rescue work created during an outage.

---

## Shared helpers — use them, do not re-derive

When two screens answer the same question differently, one of them is wrong. The
following are single definitions and everything must go through them:

| Helper | Question | Where |
|---|---|---|
| `soRequired(so)` | How much of each item does this order need? | `utils.jsx` |
| `itemCost(state, pid)` | What does this item cost us? | `utils.jsx` |
| `lastBuyOf(state, pid, vendorId)` | What did we last pay, to whom? | `utils.jsx` |
| `compSellOf` / `lineSellOf` | What does the customer pay? | `screens-so.jsx` |
| `soEffectiveStatus(state, so)` | What stage is this order at? | `utils.jsx` |
| `nextSoNo` / `soNoTaken` | Order numbering | `utils.jsx` |
| `wf()` / `wfOn()` / `wfReceiving()` | How does this company work? | `permissions.jsx` |

> `soRequired` exists because **five** places computed "what this order needs" and
> **four** forgot to multiply by `bundle_qty`. Invisible while every bundle was 1;
> the moment the importer produced bundles of 6, 20 and 30, the godown asked for
> a sixth of the order.

---

## File map

| File | Holds |
|---|---|
| `config.js` | runtime config, Supabase client |
| `tenant-context.js` | subdomain → organization |
| `seed.js` | demo data — **offline/demo only**, never shown to a real tenant |
| `utils.jsx` | formatting, icons, `Modal`, and the shared helpers above |
| `store.jsx` | state, sync, auth, tenant context |
| `permissions.jsx` | roles, feature flags, workflow helpers |
| `shell.jsx` | topbar, sidebar |
| `screens-so.jsx` | sales orders, BOM editor, pricing, profit panel |
| `screens-import.jsx` | customer sheet importer |
| `screens-alloc.jsx` | vendor assignment and pricing |
| `screens-godown.jsx` | virtual godowns, receiving, pool, transfers |
| `screens-procurement.jsx` | vendor POs, GRN, e-Bill, 3-way match |
| `screens-scm.jsx` | SCM tracking, outward dispatch, delivery challan |
| `screens-billing.jsx` | invoices, collections |
| `screens-platform.jsx` | master admin console |
| `app.jsx` | router, crash boundary, unsaved-changes banner |
