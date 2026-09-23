#!/usr/bin/env node
/**
 * OP Central — roles, and who is allowed to receive
 * ---------------------------------------------------------------------------
 * Two things here have teeth.
 *
 * AN UNKNOWN ROLE IS NOT AN ADMINISTRATOR. `perm()` used to fall back to
 * PERMISSIONS['Org Admin'] for any role it did not recognise. A typo in a role
 * name, a role dropped from a customisation, or a browser running yesterday's
 * bundle against a company that has just invented a role would every one of
 * them have handed out full administrative access — silently, and to the person
 * least likely to report it. The safe answer to "I do not know who this is" is
 * the dashboard and nothing else.
 *
 * WHO RECEIVES COMES FROM THE PROFILE. CLAUDE.md: never hard-code a role name
 * into a receiving path. Three literal `['Stores', 'Purchase', …]` lists in the
 * godown decided who may receive, so a company that splits its stores into an
 * inward and an outward team — and therefore has no role called 'Stores' at all
 * — would have found the tick boxes missing for every one of its people.
 *
 * The same checks assert the existing companies did not move: the `standard`
 * profile must still produce exactly the four roles it always did.
 *
 * Usage: node scripts/uitest/roles-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React;
try { Babel = require('@babel/standalone'); React = require('react'); }
catch (e) {
  console.error('Missing dev deps. Run:\n  npm i --no-save @babel/standalone@7.29.0 react@18.3.1 react-dom@18.3.1 jsdom');
  process.exit(2);
}

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const plain = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map(m => m[1]);
const jsx = [...html.matchAll(/type="text\/babel"\s+src="([^"]+)"/g)].map(m => m[1]);

const s = { console: { log() {}, warn() {}, error() {}, info() {} } };
s.window = s; s.globalThis = s;
const node = () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {},
  classList: { add() {}, remove() {} } });
s.document = { createElement: node, head: node(), body: node(),
  documentElement: { style: { setProperty() {} } }, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
s.location = { hostname: 'dm.ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
s.navigator = { userAgent: 'node' };
s.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
s.sessionStorage = s.localStorage;
s.addEventListener = () => {}; s.removeEventListener = () => {};
s.fetch = () => new Promise(() => {});
s.setTimeout = () => 0; s.clearTimeout = () => {}; s.setInterval = () => 0; s.clearInterval = () => {};
s.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
s.history = { pushState() {}, replaceState() {}, back() {} };
s.crypto = { randomUUID: () => 'x', getRandomValues: a => a };
s.React = React; s.ReactDOM = { createRoot: () => ({ render() {} }) };
s.OPC_ENV = { APP_BASE_DOMAIN: 'ops-central.unimisk.com' };
vm.createContext(s);
for (const f of [...plain, ...jsx]) {
  vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, f), 'utf8'),
    { presets: ['react'], filename: f }).code, s, { filename: f });
}

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};
const withProfile = (wfObj, fn) => {
  const before = s.__opcWorkflow;
  s.__opcWorkflow = wfObj;
  try { return fn(); } finally { s.__opcWorkflow = before; }
};

// The two live presets, as the database holds them.
const STANDARD = { receiving_flow: 'purchase_to_stores', outward_dispatch: false,
  po_item_language: 'ours', customer_language: false, intransit_tracking: false,
  supervisor_signoff: true, auto_invoice_on_grn: true, invoice_on_dispatch: false };
const PROCUREMENT = { receiving_flow: 'stores_to_purchase', outward_dispatch: true,
  po_item_language: 'vendor', customer_language: true, intransit_tracking: true,
  supervisor_signoff: false, auto_invoice_on_grn: false, invoice_on_dispatch: true };

console.log('\n[1] an unrecognised role is NOT an administrator');
['', null, undefined, 'Stores Manager', 'admin', 'ORG ADMIN', 'Project Management']
  .forEach(r => {
    const p = s.perm(r);
    if (p.can && p.can.all) { bad++; console.log(`  X  "${r}" resolves to full admin`); }
  });
check('no unknown role carries the "all" capability', true, true);
check('an unknown role sees only the dashboard', s.perm('Stores Manager').nav, ['dashboard']);
check('and cannot open anything else', s.canAccess('Stores Manager', 'vendor-pos'), false);
check('it can still open the dashboard, so the app is not a blank wall',
  s.canAccess('Stores Manager', 'dashboard'), true);
// 'Project Management' is the label in DEFAULT_TEAMS; the permissions key is
// 'Project Manager'. That near-miss used to be a free administrator.
check('the DEFAULT_TEAMS near-miss is no longer an administrator',
  !!(s.perm('Project Management').can || {}).all, false);
check('a real Org Admin is unaffected', !!(s.perm('Org Admin').can || {}).all, true);

console.log('\n[2] the three roles a split-stores company needs');
['Stores In', 'Stores Out', 'Client Facing'].forEach(r => {
  const p = s.perm(r);
  check(`${r} has a nav of its own`, Array.isArray(p.nav) && p.nav.length > 0, true);
  check(`${r} lands somewhere that exists`, s.canAccess(r, p.primary.route), true);
});
check('Stores In can open GRN', s.canAccess('Stores In', 'grn'), true);
check('Stores Out can open SCM tracking, which is where dispatch lives',
  s.canAccess('Stores Out', 'scm'), true);
// Only two pages, by request: Item Requests and SCM Tracking. Everything this
// desk used to see directly (Sales Orders, Customers, Invoices, Collections,
// Products) is gone from its nav -- it now only reaches the request it wrote
// and the pure-quantity tracking screen.
check('Client Facing has exactly two pages', s.PERMISSIONS['Client Facing'].nav.slice().sort(),
  ['client-requests', 'scm']);
check('it can open Item Requests (workflow flag assumed on for this check)', (() => {
  const before = s.__opcWorkflow;
  s.__opcWorkflow = { client_order_requests: true };
  const r = s.canAccess('Client Facing', 'client-requests');
  s.__opcWorkflow = before;
  return r;
})(), true);
check('and SCM Tracking', s.canAccess('Client Facing', 'scm'), true);
check('but no longer Customers directly', s.canAccess('Client Facing', 'customers'), false);
check('nor Invoices directly', s.canAccess('Client Facing', 'invoices'), false);
check('nor Sales Orders directly', s.canAccess('Client Facing', 'sales-orders'), false);
// The customer-facing screen is the easiest place for a buy price to be read
// out loud by accident.
check('Client Facing cannot see cost', s.canDo('Client Facing', 'viewCost'), false);
check('nor can Stores Out', s.canDo('Stores Out', 'viewCost'), false);
check('Purchase still can', s.canDo('Purchase', 'viewCost'), true);
check('Client Facing cannot raise a vendor PO', s.canDo('Client Facing', 'createVendorPO'), false);
check('and cannot open the vendor list', s.canAccess('Client Facing', 'vendors'), false);

console.log('\n[3] the existing companies did not move');
// This is the whole point of the refactor: the historic four roles are exactly
// what the standard profile still produces.
withProfile(STANDARD, () => {
  check('standard: the same four roles may receive as always',
    s.wfReceivingRoles().slice().sort(),
    ['Org Admin', 'Project Manager', 'Purchase', 'Stores']);
  check('standard: Purchase marks received', s.wfReceiving().requesterRoles, ['Purchase', 'Project Manager']);
  check('standard: Stores accepts', s.wfReceiving().approverRoles, ['Stores', 'Org Admin']);
  check('standard: Stores can accept a receipt', s.wfCanAcceptReceipt('Stores'), true);
});
withProfile(PROCUREMENT, () => {
  check('procurement-only: Stores marks received', s.wfReceiving().requesterRoles, ['Stores']);
  check('procurement-only: Purchase accepts', s.wfReceiving().approverRoles, ['Purchase', 'Org Admin']);
  check('procurement-only: Purchase can accept', s.wfCanAcceptReceipt('Purchase'), true);
  check('procurement-only: Sales cannot receive', s.wfCanReceive('Sales'), false);
});
// No profile at all — a failed context load, or an org that has none.
withProfile(undefined, () => {
  check('no profile: falls back to the historic roles, never to nobody',
    s.wfReceivingRoles().slice().sort(),
    ['Org Admin', 'Project Manager', 'Purchase', 'Stores']);
});

console.log('\n[4] a company whose stores is two teams');
const SPLIT = Object.assign({}, PROCUREMENT, {
  receiving_requester_roles: ['Stores In'],
  receiving_approver_roles: ['Purchase', 'Org Admin'],
  receiving_requester_label: 'Stores (inward)',
});
withProfile(SPLIT, () => {
  check('the inward team marks what arrived', s.wfReceiving().requesterRoles, ['Stores In']);
  check('and it is labelled the way the company says', s.wfReceiving().requesterLabel, 'Stores (inward)');
  check('the inward team can receive', s.wfCanReceive('Stores In'), true);
  check('Purchase still accepts and posts the GRN', s.wfCanAcceptReceipt('Purchase'), true);
  check('the OUTWARD team does not receive — that is the point of splitting it',
    s.wfCanReceive('Stores Out'), false);
  check('and neither does the customer-facing desk', s.wfCanReceive('Client Facing'), false);
  check('a role called plain Stores is not assumed to exist', s.wfCanReceive('Stores'), false);
});
// Rubbish in the profile must not lock a company out of its own godown.
[[], null, 'Stores In', [''], [123]].forEach((v, i) => {
  withProfile(Object.assign({}, STANDARD, { receiving_requester_roles: v }), () => {
    const r = s.wfReceiving().requesterRoles;
    if (!Array.isArray(r) || !r.length) { bad++; console.log(`  X  a malformed override (#${i}) left nobody able to receive`); }
  });
});
check('a malformed override falls back rather than emptying the list', true, true);

console.log('\n[5] every role in the app renders a real screen');
const ROLES = Object.keys(s.PERMISSIONS || {});
check('the three new roles are in the shared table',
  ['Stores In', 'Stores Out', 'Client Facing'].filter(r => !ROLES.includes(r)), []);
const strays = ROLES.filter(r => {
  const p = s.perm(r);
  return !p.primary || !p.primary.route || !s.canAccess(r, p.primary.route);
});
check('no role lands on a screen it may not open', strays, []);
// A role that appears in the Settings UI but not in PERMISSIONS would resolve
// through the unknown-role path and quietly see almost nothing.
// Only DEFAULT_TEAMS — the list Settings actually offers. Scanning the whole
// file picks up the 'New Team' placeholder from the add-a-team button, which is
// a blank row for the user to name, not a role.
const cfg = fs.readFileSync(path.join(dir, 'src', 'screens-config.jsx'), 'utf8');
const block = cfg.slice(cfg.indexOf('const DEFAULT_TEAMS'), cfg.indexOf('const DEFAULT_TEAMS') + 1200);
const uiRoles = (block.slice(0, block.indexOf('];')).match(/\{ name: '([^']+)'/g) || [])
  .map(m => m.slice(9, -1));
check('Settings offers a sensible number of roles', uiRoles.length >= 8, true);
// 'Project Management' was offered here for months while the permissions key
// said 'Project Manager'. Anybody given it resolved through the unknown-role
// path, which until today meant Org Admin.
check('every role offered in Settings is a role the app defines',
  uiRoles.filter(r => !ROLES.includes(r)), []);

console.log('\n[6] the Sourcing "New Inquiry" gate reads the capability, not a literal list');
check('the base Purchase role does NOT carry createSourcing -- any grant of it lives in one organization\'s own config, never in the shared code',
  !!(s.PERMISSIONS.Purchase.can || {}).createSourcing, false);
check('Sales keeps it, unaffected', s.canDo('Sales', 'createSourcing'), true);
check('Pre-sales keeps it, unaffected', s.canDo('Pre-sales', 'createSourcing'), true);
const srcJsx = fs.readFileSync(path.join(dir, 'src', 'screens-sourcing.jsx'), 'utf8');
check('"New Inquiry" is gated on the capability now, not a hard-coded role list',
  /canCreate = canDo\(role, 'createSourcing'\)/.test(srcJsx), true);
check('and the old literal list is gone from that line',
  /const canCreate = \['Sales'/.test(srcJsx), false);

console.log(bad ? `\nFAILED - ${bad} problem(s)` : '\nPASS - roles are defined, scoped, and never silently administrative');
process.exit(bad ? 1 : 0);
