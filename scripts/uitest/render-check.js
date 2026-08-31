#!/usr/bin/env node
/**
 * OP Central — UI render check
 * ---------------------------------------------------------------------------
 * This app has no bundler: the browser transforms every .jsx with Babel at
 * runtime and all files share one global scope. That means a typo becomes a
 * RUNTIME error, not a build error, and a single bad field in a component that
 * sits on every page (the shell) unmounts the whole tree — a white screen with
 * nothing in it.
 *
 * `esbuild --bundle=false` only proves a file PARSES. This proves it RUNS, and
 * that every screen and route actually renders.
 *
 * Three phases:
 *   1. load    — transform each file with the SAME Babel the browser loads and
 *                execute them in order in one shared scope; then assert the
 *                cross-file globals really landed on window.
 *   2. screens — render every screen on its own, against a BRAND-NEW EMPTY
 *                tenant (a freshly created organization has no data at all).
 *   3. app     — render the WHOLE app at every route, for every role, including
 *                with a previous tenant's partial permissions blob still on
 *                window. That last case is a real regression: it used to crash
 *                the Sidebar and blank all 24 routes.
 *
 * Usage:
 *   node scripts/uitest/render-check.js [path-to-frontend]
 *
 * Needs: npm i @babel/standalone react react-dom   (dev-only, not shipped)
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
  console.error('Missing dev deps. Run:\n  npm i --no-save @babel/standalone react react-dom');
  process.exit(2);
}

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
// Plain <script src> files (config, tenant context, seed) load BEFORE the babel
// ones and define globals the app depends on — OPC_SEED among them.
const plain = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map(m => m[1]);
const jsx = [...html.matchAll(/type="text\/babel"\s+src="([^"]+)"/g)].map(m => m[1]);

function freshSandbox() {
  const s = {};
  s.window = s; s.globalThis = s;
  s.console = { log() {}, warn() {}, error() {}, info() {} };
  const node = () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {},
    classList: { add() {}, remove() {} } });
  s.document = { createElement: node, head: node(), body: node(),
    documentElement: { style: { setProperty() {} } },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, getElementById: () => null };
  s.location = { hostname: 'ml.ops-central.unimisk.com',
    href: 'https://ml.ops-central.unimisk.com/', pathname: '/', search: '', hash: '' };
  s.navigator = { userAgent: 'node' };
  s.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
  s.sessionStorage = s.localStorage;
  s.addEventListener = () => {}; s.removeEventListener = () => {}; s.postMessage = () => {};
  s.fetch = () => new Promise(() => {});
  s.setTimeout = () => 0; s.clearTimeout = () => {};
  s.setInterval = () => 0; s.clearInterval = () => {};
  s.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  s.history = { pushState() {}, replaceState() {}, back() {} };
  s.crypto = { randomUUID: () => 'x', getRandomValues: a => a };
  s.React = React;
  s.ReactDOM = { createRoot: () => ({ render() {} }) };
  s.OPC_ENV = { APP_BASE_DOMAIN: 'ops-central.unimisk.com' };
  vm.createContext(s);
  return s;
}

function loadAll(s) {
  for (const f of [...plain, ...jsx]) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const code = f.endsWith('.jsx')
      ? Babel.transform(src, { presets: ['react'], filename: f }).code
      : src;
    vm.runInContext(code, s, { filename: f });
  }
}

let failures = 0;
const fail = (msg) => { failures++; console.log('  X  ' + msg); };

// ---------------------------------------------------------------- 1. load ----
console.log('\n[1/3] every file transforms and executes');
const base = freshSandbox();
for (const f of [...plain, ...jsx]) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  let code;
  try {
    code = f.endsWith('.jsx') ? Babel.transform(src, { presets: ['react'], filename: f }).code : src;
  } catch (e) { fail(`${f} — BABEL: ${e.message.split('\n')[0]}`); continue; }
  try { vm.runInContext(code, base, { filename: f }); }
  catch (e) { fail(`${f} — ${e.name}: ${e.message}`); }
}
const NEEDED = ['useStore', 'StoreProvider', 'App', 'useAliasMap', 'partyItemName', 'wf', 'wfOn',
  'wfReceiving', 'featureOn', 'canAccess', 'perm', 'Icon', 'Modal', 'useToast', 'inr', 'fmtDate',
  'InTransitModal', 'OrgWorkflowPanel', 'PlatformConsole', 'scmLineTotals', 'SCMTracking',
  'ItemMapping', 'SheetImportModal', 'VendorPODetail', 'GRNList', 'CustomerChallanModal',
  'OutwardDispatchModal', 'CrashBoundary'];
const missing = NEEDED.filter(n => typeof base[n] === 'undefined');
if (missing.length) fail('globals never reached window: ' + missing.join(', '));
else console.log('  ok  all files execute · all cross-file globals present');

// ------------------------------------------------------------- fixtures -----
const LISTS = ['customers', 'vendors', 'products', 'categories', 'boms', 'sales_orders',
  'vendor_pos', 'grns', 'vendor_invoices', 'payments', 'rfqs', 'sourcings',
  'transfer_requests', 'notifications', 'audit', 'outward_dispatches', 'pool', 'invoices',
  'site_updates', 'item_aliases', 'collections'];

function makeStore(s, { role = 'Org Admin', seeded = false, mixed = false, route = 'dashboard' } = {}) {
  const seed = s.OPC_SEED || {};
  const user = { id: 'u1', name: 'Test User', email: 't@e.com', role, active: true };
  const st = { loaded: true, org: { ...(seed.org || {}) }, config: { ...(seed.config || {}) },
    platform: { ready: true, isMaster: false, orgId: 'org-1', org: { id: 'org-1', name: 'Microlink' } } };
  LISTS.forEach(n => { st[n] = []; });
  if (seeded) Object.keys(seed).forEach(k => { if (Array.isArray(seed[k])) st[k] = seed[k]; });
  if (mixed) {
    // Transactional rows whose every product / customer / category reference is
    // DANGLING. A tenant hit this whenever orders were present but the catalogue
    // belonged to a different organization (or had not loaded yet).
    ['sales_orders', 'vendor_pos', 'grns', 'invoices', 'rfqs', 'sourcings',
     'vendor_invoices', 'payments', 'pool', 'transfer_requests', 'outward_dispatches']
      .forEach(k => { if (Array.isArray(seed[k])) st[k] = seed[k]; });
    st.products = []; st.categories = []; st.boms = []; st.customers = []; st.vendors = [];
  }
  st.users = [user];
  return {
    state: st, route, currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, saveConfig: () => {}, setRoute: () => {},
    addToPool: () => {}, consumeFromPool: () => {}, signOut: () => {},
    getCustomer: id => st.customers.find(c => c.id === id),
    getVendor: id => st.vendors.find(v => v.id === id),
    getProduct: id => st.products.find(p => p.id === id),
    getCategory: id => st.categories.find(c => c.id === id),
    getUser: id => st.users.find(u => u.id === id),
    getSO: id => st.sales_orders.find(x => x.id === id),
  };
}

// Microlink's real capability set: most things off.
const ML_FEATURES = { presales: false, rfq_email: false, implementation: false,
  cross_so_transfer: false, partial_invoicing: false, e_invoice: false, e_way_bill: false,
  whatsapp: false, sms: false, sales_desk: true, stores: true, scm_tracking: true,
  item_mapping: true, surplus_pool: true };
const ML_WORKFLOW = { receiving_flow: 'stores_to_purchase', po_item_language: 'vendor',
  intransit_tracking: true, customer_language: true, outward_dispatch: true,
  supervisor_signoff: false, auto_invoice_on_grn: false };

// ------------------------------------------------------------- 2. screens ---
const SCREENS = ['Dashboard', 'ApprovalInbox', 'SCMTracking', 'ItemMapping', 'SalesOrdersList',
  'SalesOrderNew', 'SourcingList', 'SourcingNew', 'CustomersList', 'VendorsList', 'ProductsList',
  'VirtualGodownList', 'MasterPool', 'CrossSOTransfers', 'RFQList', 'VendorPOList',
  'GRNList', 'GRNNew', 'ThreeWayMatchList', 'AuditLog', 'Settings', 'PlatformConsole'];

for (const mode of ['empty', 'seeded', 'mixed']) {
  const label = { empty: 'BRAND-NEW EMPTY', seeded: 'seeded', mixed: 'MIXED (orders present, catalogue missing)' }[mode];
  console.log(`\n[2/3] every screen renders · ${label} tenant`);
  const s = freshSandbox(); loadAll(s);
  s.__opcFeatures = ML_FEATURES; s.__opcWorkflow = ML_WORKFLOW;
  s.__opcIsMaster = false; s.OPC_SB = null;
  const store = makeStore(s, { seeded: mode === 'seeded', mixed: mode === 'mixed' });
  let n = 0;
  for (const name of SCREENS) {
    const C = s[name];
    if (typeof C !== 'function') continue;
    try {
      ReactDOMServer.renderToStaticMarkup(
        React.createElement(s.Store.Provider, { value: store },
          React.createElement(s.ToastProvider, null, React.createElement(C))));
      n++;
    } catch (e) { fail(`${name} — ${e.name}: ${e.message}`); }
  }
  if (n) console.log(`  ok  ${n} screens`);
}

// ----------------------------------------------------------------- 3. app ---
const LIST_ROUTES = ['dashboard', 'inbox', 'scm', 'mapping', 'sales-orders', 'sales-orders/new',
  'godown', 'pool', 'transfers', 'vendor-pos', 'grn', 'grn/new', 'three-way',
  'invoices', 'customers', 'vendors', 'products', 'settings', 'audit', 'collections',
  'sourcing', 'rfq', 'platform', 'unknown-route'];

// DETAIL routes matter more than lists here: a list renders an empty state when
// data is missing, but a detail screen dereferences one specific record and
// everything hanging off it. Opening a card is exactly how a user hits this.
function detailRoutes(st) {
  const first = (arr) => (Array.isArray(arr) && arr[0] ? arr[0].id : null);
  const r = [];
  const so = first(st.sales_orders);
  if (so) { r.push('sales-orders/' + so, 'godown/' + so, 'invoices/' + so); }
  const po = first(st.vendor_pos);   if (po) r.push('vendor-pos/' + po);
  const grn = first(st.grns);        if (grn) r.push('grn/' + grn);
  const src = first(st.sourcings);   if (src) r.push('sourcing/' + src);
  const vi = first(st.vendor_invoices); if (vi) r.push('three-way/' + vi);
  const cust = first(st.customers);  if (cust) r.push('customers/' + cust + '/ledger');
  // Ids that do not exist at all — a stale bookmark, or a link to a record that
  // belongs to another organization. Must say "not found", never crash.
  r.push('sales-orders/does-not-exist', 'godown/does-not-exist',
         'vendor-pos/does-not-exist', 'grn/does-not-exist', 'invoices/does-not-exist');
  return r;
}
const ROLES = ['Purchase', 'Stores', 'Org Admin', 'Managing Director', 'Sales', 'Billing'];

function renderApp(s, role, route, store) {
  const out = ReactDOMServer.renderToStaticMarkup(
    React.createElement(s.Store.Provider, { value: store },
      React.createElement(s.ToastProvider, null, React.createElement(s.App))));
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(out);
  if (!out.trim()) throw new Error('nothing rendered');
  if (main && main[1].trim().length < 40) throw new Error('<main> is empty');
  return out;
}

const APP_CASES = [
  { label: ' · empty tenant', partialPerms: false, mixed: false, seeded: false },
  { label: ' · seeded tenant', partialPerms: false, mixed: false, seeded: true },
  { label: " · with a PREVIOUS tenant's partial permissions blob", partialPerms: true, mixed: false, seeded: false },
  { label: ' · MIXED state (orders present, catalogue missing)', partialPerms: false, mixed: true, seeded: false },
];
for (const c of APP_CASES) {
  console.log(`\n[3/3] whole app · every route x every role${c.label}`);
  const s = freshSandbox(); loadAll(s);
  s.__opcFeatures = ML_FEATURES; s.__opcWorkflow = ML_WORKFLOW;
  s.__opcIsMaster = false; s.OPC_SB = null;
  let n = 0;
  for (const role of ROLES) {
    // A customisation carrying `can` but no `nav`: perm() must degrade, not throw.
    s.__opcPerms = c.partialPerms ? { [role]: { can: { all: true } } } : null;
    // Build one store to discover which detail ids exist in this scenario.
    const probe = makeStore(s, { role, mixed: c.mixed, seeded: c.seeded });
    const routes = [...LIST_ROUTES, ...detailRoutes(probe.state)];
    for (const route of routes) {
      const store = makeStore(s, { role, route, mixed: c.mixed, seeded: c.seeded });
      try { renderApp(s, role, route, store); n++; }
      catch (e) { fail(`${role} @ ${route} — ${e.name}: ${e.message}`); }
    }
  }
  if (n) console.log(`  ok  ${n} role/route combinations`);
}

console.log(failures ? `\nFAILED — ${failures} problem(s)` : '\nPASS — nothing blanks');
process.exit(failures ? 1 : 0);
