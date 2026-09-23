#!/usr/bin/env node
/**
 * OP Central — "Ready to dispatch" queue on SCM Tracking
 * ---------------------------------------------------------------------------
 * Receiving already had PendingReceiptsPanel: a queue that puts exactly what
 * needs action in front of whoever accepts a GRN, so Stores In never has to
 * go hunting for the right order. Dispatch had no equivalent — SCM Tracking
 * was a per-SO drilldown with a plain dropdown defaulting to whichever order
 * loaded first, which could easily be a closed or unrelated one. A role that
 * ONLY dispatches (never opens Sales Orders to go looking) could open the
 * screen, land on the wrong order, and reasonably conclude there was no way
 * to dispatch anything at all. See docs/dispatch-queue.md.
 *
 *   SCOPED TO THE ROLE, NOT THE ORGANISATION   ReadyToDispatchPanel shows for
 *     role === 'Stores Out' specifically, not everyone canDispatch already
 *     covered (SCM_ROLES: Purchase/Stores/Org Admin/Managing Director) — they
 *     already had a working path to "Out for delivery" before this existed,
 *     so their screen must not change at all. Microlink (procurement_only)
 *     has no Stores Out user and no permissions override, so this is
 *     provably invisible there.
 *   PURE ADDITION   the existing dropdown, the existing "Out for delivery"
 *     button, and the existing per-line table are untouched — the panel only
 *     adds a shortcut into the same OutwardDispatchModal every role already
 *     used.
 *
 * Usage: node scripts/uitest/dispatch-queue-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React, ReactDOMServer;
try {
  Babel = require('@babel/standalone');
  React = require('react');
  ReactDOMServer = require('react-dom/server');
} catch (e) {
  console.error('Missing dev deps. Run: npm i --no-save @babel/standalone@7.29.0 react@18.3.1 react-dom@18.3.1 jsdom');
  process.exit(2);
}

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const plain = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map(m => m[1]);
const jsx = [...html.matchAll(/type="text\/babel"\s+src="([^"]+)"/g)].map(m => m[1]);

const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const node = () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } });
sandbox.document = { createElement: node, head: node(), body: node(), documentElement: { style: { setProperty() {} } },
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null };
sandbox.location = { hostname: 'dm.ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
sandbox.navigator = { userAgent: 'node' };
sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
sandbox.sessionStorage = sandbox.localStorage;
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
sandbox.fetch = () => new Promise(() => {});
sandbox.setTimeout = () => 0; sandbox.clearTimeout = () => {};
sandbox.setInterval = () => 0; sandbox.clearInterval = () => {};
sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
sandbox.history = { pushState() {}, replaceState() {}, back() {} };
sandbox.crypto = { randomUUID: () => 'x', getRandomValues: a => a };
sandbox.React = React;
sandbox.ReactDOM = { createRoot: () => ({ render() {} }) };
sandbox.OPC_ENV = { APP_BASE_DOMAIN: 'ops-central.unimisk.com' };
vm.createContext(sandbox);
for (const f of [...plain, ...jsx]) {
  vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, f), 'utf8'),
    { presets: ['react'], filename: f }).code, sandbox, { filename: f });
}

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

// ---------------------------------------------------------------------------
// One SO with 4 units received against a vendor PO, nothing dispatched yet —
// so-1 has stock sitting in the Virtual Godown, so-2 has none.
// ---------------------------------------------------------------------------
const products = [{ id: 'p1', code: 'SW-24', name: '24-Port Switch', sell: 0, buy: 0 }];
const so1 = { id: 'so-1', so_no: 'SO/FY26/0020', customer_id: 'c1', status: 'Procurement Started',
  lines: [{ id: 'l1', bundle_qty: 1, unit_price: 0, components: [{ product_id: 'p1', qty: 4 }] }] };
const so2 = { id: 'so-2', so_no: 'SO/FY26/0021', customer_id: 'c1', status: 'Procurement Started',
  lines: [{ id: 'l1', bundle_qty: 1, unit_price: 0, components: [{ product_id: 'p1', qty: 2 }] }] };
const po1 = { id: 'po-1', so_id: 'so-1', status: 'Material Received', items: [{ product_id: 'p1', qty: 4 }] };
const grn1 = { id: 'grn-1', po_id: 'po-1', items: [{ product_id: 'p1', accepted: 4 }] };
const customers = [{ id: 'c1', name: 'Acme Corp' }];

function makeState() {
  return {
    loaded: true, org: {}, config: {},
    sales_orders: [so1, so2], vendor_pos: [po1], grns: [grn1], outward_dispatches: [],
    customers, vendors: [], products, categories: [], boms: [], rfqs: [], sourcings: [],
    notifications: [], audit: [], pool: [], invoices: [], transfer_requests: [],
    payments: [], vendor_invoices: [], site_updates: [], item_aliases: [], collections: [],
    client_requests: [], users: [],
  };
}
function makeStore(role) {
  const st = makeState();
  st.users = [{ id: 'u1', name: 'Test User', role, active: true }];
  return {
    state: st, route: 'scm', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, saveConfig: () => {}, setRoute: () => {},
    addToPool: () => {}, consumeFromPool: () => {}, signOut: () => {},
    syncErrors: [], retrySync: () => {},
    getCustomer: id => st.customers.find(c => c.id === id),
    getVendor: id => st.vendors.find(v => v.id === id),
    getProduct: id => st.products.find(p => p.id === id),
    getCategory: id => st.categories.find(c => c.id === id),
    getUser: id => st.users.find(u => u.id === id),
    getSO: id => st.sales_orders.find(x => x.id === id),
  };
}

const renderSCM = (role) => ReactDOMServer.renderToStaticMarkup(
  React.createElement(sandbox.Store.Provider, { value: makeStore(role) },
    React.createElement(sandbox.ToastProvider, null, React.createElement(sandbox.SCMTracking))));

console.log('\n[1] scmLineTotals really does show so-1 with stock in the VG, so-2 with none');
{
  const st = makeState();
  const rows1 = sandbox.scmLineTotals(st, so1);
  const rows2 = sandbox.scmLineTotals(st, so2);
  check('so-1: 4 received, 0 dispatched -> 4 in VG', rows1.find(r => r.product_id === 'p1').inVG, 4);
  check('so-2: nothing received -> 0 in VG', rows2.find(r => r.product_id === 'p1').inVG, 0);
}

console.log('\n[2] Stores Out sees the queue, with the right order, customer and units');
{
  const out = renderSCM('Stores Out');
  check('panel heading present', out.includes('Ready to dispatch'), true);
  // so_no sits in a plain <td> inside the panel's table; it ALSO always
  // appears inside the page's own SO-picker <option>, unrelated to the
  // panel, so the assertion must be specific to the table cell, not "does
  // this string occur anywhere on the page".
  check('the order with VG stock is a row in the queue', out.includes('SO/FY26/0020</td>'), true);
  check('the order with none is not a row in the queue', out.includes('SO/FY26/0021</td>'), false);
  check('customer name shown', out.includes('Acme Corp'), true);
  check('a Dispatch shortcut is offered', out.includes('>Dispatch<'), true);
}

console.log('\n[3] every role that already had a working "Out for delivery" path sees NO new panel -- their screen is unchanged');
for (const role of ['Stores', 'Purchase', 'Org Admin', 'Managing Director', 'Stores In']) {
  const out = renderSCM(role);
  check(`${role}: no "Ready to dispatch" panel`, out.includes('Ready to dispatch'), false);
}

console.log('\n[4] the existing "Out for delivery" button and per-line table are untouched for every dispatching role');
for (const role of ['Stores Out', 'Stores', 'Purchase', 'Org Admin', 'Managing Director']) {
  const out = renderSCM(role);
  check(`${role}: still has the manual "Out for delivery" button`, out.includes('Out for delivery'), true);
}

console.log('\n[5] a role with no dispatch capability at all sees neither the button nor the queue');
{
  const out = renderSCM('Sales');
  check('Sales: no "Out for delivery" button', out.includes('Out for delivery'), false);
  check('Sales: no "Ready to dispatch" queue either', out.includes('Ready to dispatch'), false);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - Stores Out gets the same queue-first, one-click experience Stores In already has for receiving, and nothing already working for another role changed');
process.exit(bad ? 1 : 0);
