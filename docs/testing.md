# The check suite

```bash
for t in render boot import alloc pricing receive receipt-engine dispatch-invoice status numbering boq keyboard reach; do
  node scripts/uitest/$t-check.js frontend
done
```

Needs `npm i --no-save @babel/standalone@7.29.0 react@18.3.1 react-dom@18.3.1 jsdom`
once, at the repository root.

Pin those versions, and install them **in one command**. Two traps:

- `index.html` loads `@babel/standalone@7.29.0`. Babel 8 defaults to the
  automatic JSX runtime and emits `import ... from "react/jsx-runtime"`, which
  the sandbox cannot execute — the checks die with *"Cannot use import statement
  outside a module"* on a file that is perfectly fine in the browser.
- `--no-save` **prunes** whatever is not named in that command. Installing one
  package on its own removes the rest, and the suite then reports
  *"Missing dev deps"* or *"Cannot find module 'react-dom/client'"*.

---

## Why these exist

This app has **no build step**. `esbuild --bundle=false` proves a file *parses*;
it cannot tell you a global is missing or a field is undefined. Those are
runtime errors, and a runtime error in a component that sits on every page turns
the whole app white. Every check below was written after something shipped
broken.

| Check | Guards | Written after |
|---|---|---|
| `render-check` | every file executes under real Babel; every screen and all 174 role/route combinations render | the app went white on every route — one tenant's partial permissions blob crashed the Sidebar |
| `boot-check` | boots the real store in jsdom: no demo data on screen, right organization named, nothing written | a tenant saw the demo company's 39 orders and "Brightline" in the topbar |
| `import-check` | the real BOQ layout — hierarchy, merged cells, banners, totals, 6 sets vs 36 units | the importer flattened the bill of materials |
| `alloc-check` | grouping by Po SR, price history, remainders, client price mapping | — |
| `pricing-check` | price cascade both ways, actual cost beating catalogue, committed vs estimated profit | — |
| `receive-check` | one-click receiving, no double-counting, the pending queue is findable | the dialog needed a tick per line and hid half its columns |
| `receipt-engine-check` | every screen agrees on `soRequired`; a bundled order receives in full; invoicing obeys the workflow; e-Bill columns | receiving posted a **sixth** of the order |
| `dispatch-invoice-check` | customer wording, partial→final adding to the order value, no double billing, the over-dispatch cap | — |
| `status-check` | every lifecycle transition, forward-only, manual states untouched, order numbering | orders sat on Draft with goods received against them |
| `numbering-check` | every document number's format and uniqueness; quantity formatting; per-line tax including the TDS sign | two POs shared one e-Bill number; quantities read "1.0000" |
| `keyboard-check` | that no shortcut fires while somebody is typing, that the browser keeps its own, row movement and its ends, that every clickable div is reachable by Tab while a row's children are not, that up/down drive the list while Home/End stay with the page until a row is picked, that focus can always get back out of the sidebar, that the record tabs answer from anywhere and step from whichever tab is really active, that a group of buttons is one tab stop rather than one each, that Enter walks a dialog's fields while a textarea keeps it, that a focused button is pressed even with a row selected, that left reaches the sidebar from anywhere on the page including off the first tab of a strip, that every screen's blue button stays in the tab order, that Alt gives every button on every screen a letter of its own with no two the same, that a screen's Alt letter is the same as its g jump, that nothing behind an open dialog can be moved or navigated, that nothing touches browser history, and that the palette cannot offer a screen the sidebar hides | a stray key mid-entry loses an accountant's work, and a palette is a permissions hole if it is a second list |
| `reach-check` | that all 31 screens render **with real work in the tenant**, that nothing carrying a pointer cursor is left out of the tab order, that Down moves on every screen with rows, and that a tab strip is one stop | the engine was right in isolation while the arrows did nothing on half the app. Its first run found two page-whiting crashes: a `const` read above its declaration in `SourcingDetail`, and `new Date(undefined).toISOString()` on an invoice with no date |
| `boq-check` | free quantity per billing group, oldest-first dispatch allocation, seven-of-ten raises nothing, one invoice per BOQ ever, the Final sweep, and that the expanded per-item figures sum to the summary row | a BOQ that bills twice, or one closed by goods belonging to an earlier BOQ, is money out of the door |

## How to write one

**Make it fail first.** A test that cannot fail is worse than none — it is
false confidence. Every check above was verified by re-introducing the bug and
watching it go red.

**Model the harsh world, not the kind one.** `receipt-engine-check` gives the
receive engine a *stale* state snapshot, because that is what React does. The
forgiving version passed while the real app was broken.

**Assert the thing the user cares about**, not the implementation. "6 switches
= 6 sets, not 36 units" survives a refactor; "calls `_buildLines` twice" does
not.

**Say why in the test name.** `the fully-received line is marked done, not
offered again` explains itself when it breaks at 11pm.

## Server-side checks

| Script | Proves |
|---|---|
| `ssh-verify-workflow-profiles.py` | each org resolves its own workflow; overrides win; non-masters are refused |
| `ssh-verify-sync-columns.py` | the old payload inserts 0 rows, the new one lands, another user of the same org sees it, another org does not |
| `ssh-verify-alias-bulk.py` | the batch matcher returns exactly what the one-at-a-time matcher did |
| `ssh-test-tenant-isolation.py` | one organization cannot see another's rows |

Run these **as a real tenant user** (`role=authenticated` plus that user's JWT
claim), never as superuser — superuser bypasses RLS, so a test that bypasses the
thing it is testing always passes.
