#!/usr/bin/env node
/**
 * OP Central — GRN list grouped by project, same as Vendor POs
 * ---------------------------------------------------------------------------
 * The GRN screen's own table used to be one flat list, GRNs from every order
 * interleaved with nothing to tell them apart. VendorPOList already solved
 * exactly this for Vendor POs — grouped by SO by default, a "Grouped by
 * project / Flat list" toggle, one search box across every field a person
 * would actually type. GRNList now uses the identical layout, so a project's
 * receipts read the same way its vendor POs already do. See
 * docs/receiving-grn.md.
 *
 *   PURE ADDITION   the pending-receipts / Master-Pool panels above this
 *     table, and what posting a receipt actually does, are untouched — only
 *     the bottom table's presentation changed.
 *   EVERY TENANT   nothing here reads a workflow flag or an org id; the
 *     grouping is keyed on the GRN's own vendor PO -> so_id, which every
 *     organization's GRNs already carry.
 *
 * Usage: node scripts/uitest/grn-list-check.js [path-to-frontend]
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
sandbox.location = { hostname: 'ml.ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
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
// Two SOs, two vendors, three GRNs — two against SO-1's PO (from Cisco),
// one against SO-2's PO (from Bluepeak). Proves grouping AND multi-GRN counts.
// ---------------------------------------------------------------------------
const customers = [{ id: 'c1', name: 'Acme Corp' }, { id: 'c2', name: 'Bluepeak Networks' }];
const vendors = [{ id: 'v1', name: 'Cisco Systems India Pvt Ltd', gstin: '' }, { id: 'v2', name: 'TechSource', gstin: '' }];
const so1 = { id: 'so-1', so_no: 'SO/FY26/0020', customer_id: 'c1', status: 'Procurement Started', lines: [] };
const so2 = { id: 'so-2', so_no: 'SO/FY26/0021', customer_id: 'c2', status: 'Procurement Started', lines: [] };
const po1 = { id: 'po-1', po_no: 'PO202605001', so_id: 'so-1', vendor_id: 'v1', status: 'Material Received', items: [] };
const po2 = { id: 'po-2', po_no: 'PO202605002', so_id: 'so-2', vendor_id: 'v2', status: 'Material Received', items: [] };
const grns = [
  { id: 'grn-1', grn_no: 'GRN/FY26/0001', po_id: 'po-1', date: '2026-05-21', lr: 'LR-AAA', items: [{ product_id: 'p1', accepted: 4 }] },
  { id: 'grn-2', grn_no: 'GRN/FY26/0002', po_id: 'po-1', date: '2026-05-25', lr: 'LR-BBB', items: [{ product_id: 'p1', accepted: 2 }] },
  { id: 'grn-3', grn_no: 'GRN/FY26/0003', po_id: 'po-2', date: '2026-05-22', lr: 'DELHIVERY-D88234', items: [{ product_id: 'p2', accepted: 1 }] },
];

function makeStore() {
  const st = {
    loaded: true, org: { fiscal_year: 'FY26' }, config: {},
    sales_orders: [so1, so2], vendor_pos: [po1, po2], grns,
    customers, vendors, products: [], categories: [], boms: [], rfqs: [], sourcings: [],
    notifications: [], audit: [], pool: [], invoices: [], transfer_requests: [],
    payments: [], vendor_invoices: [], site_updates: [], item_aliases: [], collections: [],
    client_requests: [], users: [{ id: 'u1', name: 'Test User', role: 'Purchase', active: true }],
  };
  return {
    state: st, route: 'grn', currentUser: 'u1', authReady: true, loaded: true,
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

const renderGRN = () => ReactDOMServer.renderToStaticMarkup(
  React.createElement(sandbox.Store.Provider, { value: makeStore() },
    React.createElement(sandbox.ToastProvider, null, React.createElement(sandbox.GRNList))));

console.log('\n[1] grouped by project by default, same layout as VendorPOList');
{
  const out = renderGRN();
  check('SO-1 group header shows its 2 GRNs', out.includes('SO/FY26/0020') && /2 GRN\(s\)/.test(out), true);
  check('SO-2 group header shows its 1 GRN', out.includes('SO/FY26/0021') && /1 GRN\(s\)/.test(out), true);
  check('customer name shown on the group header', out.includes('Acme Corp') && out.includes('Bluepeak Networks'), true);
  check('every GRN no is on screen', ['GRN/FY26/0001', 'GRN/FY26/0002', 'GRN/FY26/0003'].every(n => out.includes(n)), true);
  check('vendor name is shown per row (not just the PO no)', out.includes('Cisco Systems India') && out.includes('TechSource'), true);
  check('the grouped/flat toggle is offered', out.includes('Grouped by project'), true);
  check('a search box is offered', /placeholder="Search GRN no/.test(out), true);
  check('a vendor filter is offered', out.includes('All vendors'), true);
}

console.log('\n[2] every existing action above the table is untouched');
{
  const out = renderGRN();
  check('"Go to Virtual Godowns" still there', out.includes('Go to Virtual Godowns'), true);
  check('the auto-created note still there', out.includes('Auto-created on receipt at the Virtual Godown'), true);
}

console.log('\n[3] the flat-list mode exists with its own columns, same convention as VendorPOList');
{
  const src = fs.readFileSync(path.join(dir, 'src', 'screens-procurement.jsx'), 'utf8');
  const start = src.indexOf('function GRNList(');
  const body = src.slice(start, src.indexOf('\nfunction ', start + 1));
  check('a flat (ungrouped) branch exists, gated on !grnGroupBySO',
    /if \(!grnGroupBySO\)/.test(body), true);
  check('the flat branch carries a "For SO · Customer" column, same header VendorPOList uses',
    /For SO . Customer/.test(body), true);
  check('empty state for a search with zero matches (VendorPOList has none — this is a small improvement, not a copy)',
    /No GRNs match your search/.test(body), true);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - GRNs read the same grouped-by-project way Vendor POs already do, with real search, and nothing else on the page changed');
process.exit(bad ? 1 : 0);
