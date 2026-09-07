#!/usr/bin/env node
/**
 * OP Central — every screen, reachable from the keyboard
 * ---------------------------------------------------------------------------
 * The keyboard checks prove the ENGINE is right. This proves it is right on the
 * screens people actually use, with an order in the database.
 *
 * That distinction matters more than it sounds. render-check renders every
 * screen against a tenant with no transactional data, so the detail screens all
 * render their "not found" placeholder and are never really exercised. The
 * first time a Sales Order, a Vendor PO, a GRN and an inquiry were put in front
 * of them, SourcingDetail threw `Cannot access 'locked' before initialization`
 * — a const read thirty lines above its declaration, which whited out the page
 * for every role that can convert an inquiry. It had been there for months.
 *
 * For every screen, with real work in the tenant:
 *
 *   IT RENDERS      with an order, a PO, a GRN, an invoice and a BOQ present
 *   NOTHING IS LOST every element carrying a pointer cursor ends up reachable
 *   DOWN WORKS      a screen with rows you can act on responds to the arrows
 *   ONE STOP        the sidebar, a tab strip and a list are one tab stop each
 *
 * Usage: node scripts/uitest/reach-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React, ReactDOMServer, JSDOM;
try {
  Babel = require('@babel/standalone');
  React = require('react');
  ReactDOMServer = require('react-dom/server');
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
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
s.location = { hostname: 'ml.ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
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
const fail = (m) => { bad++; console.log('  X  ' + m); };
const ok = (m) => console.log('  ok  ' + m);

// ---------------------------------------------------------------------------
// A tenant with real work in it. Without this the detail screens all render
// "not found" and prove nothing at all.
// ---------------------------------------------------------------------------
const seed = s.OPC_SEED || {};
const P = (seed.products || []).length >= 3 ? seed.products.slice(0, 3) : [
  { id: 'p1', code: 'C9300-24T', name: 'Catalyst 9300 24 Port', buy: 80000, sell: 100000, unit: 'Nos' },
  { id: 'p2', code: 'PWR-2KWAC', name: '2000W AC PSU', buy: 40000, sell: 50000, unit: 'Nos' },
  { id: 'p3', code: 'SFP-10G', name: '10G SFP Module', buy: 15000, sell: 20000, unit: 'Nos' },
];
const customers = (seed.customers || []).length ? seed.customers
  : [{ id: 'c1', name: 'Relience Net', code: 'RN' }];
const vendors = (seed.vendors || []).length ? seed.vendors
  : [{ id: 'v1', name: 'Cisco' }, { id: 'v2', name: 'dykin' }];

const SO = {
  id: 'so-1', so_no: 'SO/FY26/0002', customer_id: customers[0].id, status: 'Approved',
  date: '2026-05-21', expected_date: '2026-05-28',
  lines: [
    { id: 'l1', bundle_qty: 2, unit_price: 500000, client_name: 'Core switching stack',
      customer_ref: { po_sr: '1', equip: 'Core switching', group: 'Group A' },
      components: [
        { product_id: P[0].id, qty: 4, sell: 100000, buy: 80000,
          customer_ref: { sr: '1.1', code: 'CS-24', desc: 'CORE SWITCH 24P', unit: 'Nos' } },
        { product_id: P[1].id, qty: 2, sell: 50000, buy: 40000,
          customer_ref: { sr: '1.2', code: 'PSU-2K', desc: 'REDUNDANT PSU', unit: 'Nos' } },
      ] },
    { id: 'l2', bundle_qty: 1, unit_price: 120000, client_name: 'Optics',
      customer_ref: { po_sr: '2', equip: 'Optics' },
      components: [
        { product_id: P[2].id, qty: 6, sell: 20000, buy: 15000,
          customer_ref: { sr: '2.1', code: 'OPT-10G', desc: '10G OPTICAL MODULE', unit: 'Nos' } },
      ] },
  ],
  invoices: [{ id: 'inv-1', no: 'INVSOFY260002', date: '2026-05-21', type: 'Partial',
               lines: [{ kind: 'component', ref_id: P[0].id, label: 'CORE SWITCH 24P',
                         cust_label: 'CORE SWITCH 24P', qty: 2, unit_price: 100000, amount: 200000 }],
               comp_consumed: { [P[0].id]: 2 }, subtotal: 200000, gst: 36000, total: 236000 }],
  extra: { boqs: [{ id: 'boq-1', no: 'BOQ202605001', date: '2026-05-21', status: 'Open',
                    label: 'Phase 1',
                    items: [{ line_id: 'l1', product_id: P[0].id, qty: 8 },
                            { line_id: 'l1', product_id: P[1].id, qty: 4 }] }] },
};
const DATA = {
  products: P, customers, vendors, categories: seed.categories || [], boms: seed.boms || [],
  sales_orders: [SO],
  vendor_pos: [
    { id: 'po-1', po_no: 'PO202605001', so_id: 'so-1', vendor_id: vendors[0].id,
      date: '2026-05-21', expected_date: '2026-05-28', status: 'Partially Received',
      dispatch_info: { lr_no: 'DELHIVERY-D88234', carrier: 'Delhivery' },
      tax_config: { lines: { [P[0].id]: [{ key: 'cgst_sgst' }] } },
      items: [{ product_id: P[0].id, qty: 8, rate: 80000 }, { product_id: P[1].id, qty: 4, rate: 40000 }] },
    { id: 'po-2', po_no: 'PO202605002', so_id: 'so-1', vendor_id: vendors[1].id,
      date: '2026-05-21', expected_date: '2026-05-28', status: 'Issued',
      items: [{ product_id: P[2].id, qty: 6, rate: 15000 }] },
  ],
  grns: [{ id: 'grn-1', grn_no: 'GRN/0001', po_id: 'po-1', date: '2026-05-25',
           lr: 'DELHIVERY-D88234', status: 'Accepted',
           items: [{ product_id: P[0].id, accepted: 4, rejected: 0 },
                   { product_id: P[1].id, accepted: 2, rejected: 0 }] }],
  vendor_invoices: [{ id: 'vi-1', invoice_no: 'INV202605001', po_id: 'po-1', grn_id: 'grn-1',
                      vendor_id: vendors[0].id, date: '2026-05-26', amount: 400000,
                      status: 'Pending 3-Way Match' }],
  // 'Responses In' with a role that can convert is exactly the state that used
  // to throw before the const was moved above its first read.
  sourcings: [{ id: 'src-1', src_no: 'SRC/FY26/0001', customer_id: customers[0].id,
                status: 'Responses In', date: '2026-05-01',
                lines: [{ id: 'sl1', bundle_qty: 1, unit_price: 0,
                          components: [{ product_id: P[0].id, qty: 8 }] }],
                components: [{ product_id: P[0].id, qty: 8 }], prices: {} }],
  outward_dispatches: [{ id: 'dc-1', so_id: 'so-1', dc_no: 'DC202605001', date: '2026-05-26',
                         items: [{ product_id: P[0].id, qty: 2 }] }],
  payments: [], rfqs: [], transfer_requests: [], notifications: [], audit: [], pool: [],
  invoices: [], site_updates: [], item_aliases: [], collections: [],
};

const st = { loaded: true, org: { ...(seed.org || {}) }, config: { ...(seed.config || {}) },
  platform: { ready: true, isMaster: false, orgId: 'org-1', org: { id: 'org-1', name: 'Microlink' } } };
Object.keys(DATA).forEach(k => { st[k] = DATA[k]; });
st.users = [{ id: 'u1', name: 'Test User', email: 't@e.com', role: 'Org Admin', active: true }];

const subtotal = (so) => (so.lines || []).reduce((n, l) => n + (l.bundle_qty || 1) * (l.unit_price || 0), 0);
const store = {
  state: st, route: 'dashboard', currentUser: 'u1', realUserId: 'u1', authReady: true, loaded: true,
  navigate: () => {}, mutate: () => {}, saveConfig: () => {}, setRoute: () => {}, resetData: () => {},
  addToPool: () => {}, consumeFromPool: () => {}, signOut: () => {}, logout: () => {}, login: () => {},
  signupAdmin: () => {}, createUser: () => {}, setUserActive: () => {}, removeUser: () => {},
  addVendor: () => {}, addCustomer: () => {}, impersonate: () => {}, stopImpersonating: () => {},
  setCurrentUser: () => {}, roleFilter: null, setRoleFilter: () => {},
  syncErrors: [], retrySync: () => {},
  getCustomer: id => st.customers.find(c => c.id === id),
  getVendor: id => st.vendors.find(v => v.id === id),
  getProduct: id => st.products.find(p => p.id === id),
  getCategory: id => st.categories.find(c => c.id === id),
  getUser: id => st.users.find(u => u.id === id),
  getSO: id => st.sales_orders.find(x => x.id === id),
  soSubtotal: subtotal, soBillAdjustment: () => 0, soBilledSubtotal: subtotal,
  soTotalWithGST: (so) => Math.round(subtotal(so) * 1.18),
};
s.__opcFeatures = { presales: true, rfq_email: true, implementation: true, cross_so_transfer: true,
  partial_invoicing: true, e_invoice: true, e_way_bill: true, sales_desk: true, stores: true,
  scm_tracking: true, item_mapping: true, surplus_pool: true };
s.__opcWorkflow = { receiving_flow: 'stores_to_purchase', po_item_language: 'vendor',
  intransit_tracking: true, customer_language: true, outward_dispatch: true, auto_invoice_on_grn: false };
s.__opcIsMaster = false; s.OPC_SB = null;

const SCREENS = [
  ['Dashboard', {}], ['ApprovalInbox', {}], ['SCMTracking', {}], ['ItemMapping', {}],
  ['SalesOrdersList', {}], ['SalesOrderNew', {}], ['SalesOrderDetail', { soId: 'so-1' }],
  ['SourcingList', {}], ['SourcingNew', {}], ['SourcingDetail', { srcId: 'src-1' }],
  ['CustomersList', {}], ['CustomerLedger', { custId: customers[0].id }],
  ['VendorsList', {}], ['ProductsList', {}],
  ['VirtualGodownList', {}], ['VirtualGodownView', { soId: 'so-1' }],
  ['MasterPool', {}], ['CrossSOTransfers', {}], ['RFQList', {}],
  ['VendorPOList', {}], ['VendorPODetail', { poId: 'po-1' }],
  ['GRNList', {}], ['GRNNew', {}], ['GRNDetail', { grnId: 'grn-1' }],
  ['ThreeWayMatchList', {}], ['ThreeWayMatchDetail', { viId: 'vi-1' }],
  ['InvoiceList', {}], ['InvoiceDetail', { soId: 'so-1', invId: 'inv-1' }],
  ['CollectionsDashboard', {}], ['AuditLog', {}], ['Settings', {}],
];

console.log('\n[1] every screen renders with real work in the tenant');
const rendered = {};
let renderedCount = 0;
for (const [name, props] of SCREENS) {
  const C = s[name];
  if (typeof C !== 'function') { fail(`${name} — not a component`); continue; }
  try {
    rendered[name] = ReactDOMServer.renderToStaticMarkup(
      React.createElement(s.Store.Provider, { value: store },
        React.createElement(s.ToastProvider, null, React.createElement(C, props))));
    renderedCount++;
  } catch (e) {
    fail(`${name} threw — ${e.name}: ${e.message.split('\n')[0]}`);
  }
}
if (renderedCount === SCREENS.length) ok(`all ${renderedCount} screens, with an order, POs, a GRN, an invoice and a BOQ`);

console.log('\n[2] nothing on any screen is left unreachable');
// Every element carrying the app's own mark for "you can click this" has to end
// up reachable. A control nobody can Tab to may as well not be on the page.
const stranded = [];
const withRows = [];
const deadArrows = [];
for (const [name] of SCREENS) {
  const markup = rendered[name];
  if (markup == null) continue;
  const d = new JSDOM(`<!doctype html><html><body><div class="app"><main class="main">${markup}</main></div></body></html>`);
  s.document = d.window.document;
  s.getComputedStyle = d.window.getComputedStyle.bind(d.window);
  s.kbdEnhance();
  const D = d.window.document;

  D.querySelectorAll('main *').forEach(el => {
    const tag = el.tagName.toUpperCase();
    if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'TR', 'TD', 'TH'].includes(tag)) return;
    if (!/cursor:\s*pointer/i.test(el.getAttribute('style') || '')) return;
    if (el.getAttribute('tabindex') != null) return;
    stranded.push(`${name}: <${tag.toLowerCase()} class="${String(el.className || '').slice(0, 30)}">`);
  });

  // The arrows, from a standing start — nothing focused, press Down.
  const rows = s.kbdRows(null, D.body).length;
  if (rows > 0) {
    withRows.push(name);
    s.kbdClearCursor();
    if (!s.kbdMove(1, null, D.body)) deadArrows.push(`${name} (${rows} rows)`);
  }
}
if (stranded.length) stranded.slice(0, 8).forEach(x => fail('unreachable — ' + x));
else ok('every clickable element on every screen is in the tab order');

console.log('\n[3] the arrows move on every screen that has rows to move through');
if (deadArrows.length) deadArrows.forEach(x => fail('Down does nothing on ' + x));
else ok(`Down selects a row on all ${withRows.length}: ${withRows.slice(0, 6).join(', ')}…`);

// The screens this was reported broken on, by name. Each has to have rows the
// arrows can reach, or the report is still true.
console.log('\n[4] the screens this was reported broken on');
[['VirtualGodownView', 'Virtual Godown detail'], ['VendorPODetail', 'Vendor PO detail'],
 ['SCMTracking', 'SCM Tracking'], ['SalesOrderDetail', 'Sales Order detail'],
 ['GRNList', 'GRN']].forEach(([name, label]) => {
  const markup = rendered[name];
  if (markup == null) { fail(`${label} did not render`); return; }
  const d = new JSDOM(`<!doctype html><html><body><div class="app"><main class="main">${markup}</main></div></body></html>`);
  s.document = d.window.document;
  s.getComputedStyle = d.window.getComputedStyle.bind(d.window);
  s.kbdEnhance();
  const rows = s.kbdRows(null, d.window.document.body);
  if (!rows.length) fail(`${label} — the arrows still have nothing to move through`);
  else ok(`${label} — ${rows.length} row(s) the arrows reach`);
});

console.log('\n[5] the blue button on every screen can be reached');
// Every screen has one obvious primary action. If the tab order ever hides one
// — a roving group swallowing it, say — the screen loses the thing it is for.
const blueScreens = [];
for (const [name] of SCREENS) {
  const markup = rendered[name];
  if (markup == null || !/btn-primary/.test(markup)) continue;
  const d = new JSDOM(`<!doctype html><html><body><div class="app"><main class="main">${markup}</main></div></body></html>`);
  s.document = d.window.document;
  s.getComputedStyle = d.window.getComputedStyle.bind(d.window);
  s.kbdEnhance();
  const all = Array.from(d.window.document.querySelectorAll('.main .btn-primary:not([disabled])'));
  const reachable = all.filter(b => b.getAttribute('tabindex') !== '-1');
  if (all.length && !reachable.length) fail(`${name} — its blue button is not in the tab order`);
  else if (all.length) blueScreens.push(`${name}(${all.length})`);
}
ok(`reachable on all ${blueScreens.length}: ${blueScreens.slice(0, 8).join(', ')}…`);

console.log('\n[6] a group is one tab stop, on the real screens');
// A record with nine tabs must cost one press to get past, not nine.
const withTabs = [];
for (const [name] of SCREENS) {
  const markup = rendered[name];
  if (markup == null || !/class="tabs/.test(markup)) continue;
  const d = new JSDOM(`<!doctype html><html><body><div class="app"><main class="main">${markup}</main></div></body></html>`);
  s.document = d.window.document;
  s.getComputedStyle = d.window.getComputedStyle.bind(d.window);
  s.kbdEnhance();
  d.window.document.querySelectorAll('.tabs').forEach(strip => {
    const all = strip.querySelectorAll('button, [data-kbd-click]');
    const stops = Array.from(all).filter(x => x.getAttribute('tabindex') !== '-1');
    if (all.length > 1 && stops.length !== 1) {
      fail(`${name} — a strip of ${all.length} tabs is ${stops.length} tab stops`);
    } else if (all.length > 1) withTabs.push(`${name} (${all.length}→1)`);
  });
}
ok(withTabs.length ? `tab strips collapse to one stop: ${withTabs.join(', ')}`
                   : 'no multi-tab strip on these screens');

console.log(bad ? `\nFAILED - ${bad} problem(s)` : '\nPASS - every screen renders with real data, and every control on it can be reached');
process.exit(bad ? 1 : 0);
