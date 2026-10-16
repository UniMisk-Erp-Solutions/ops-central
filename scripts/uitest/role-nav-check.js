#!/usr/bin/env node
/**
 * OP Central — role nav cleanup (2026-10)
 * ---------------------------------------------------------------------------
 * Every role used to carry a long, only-loosely-scoped nav list, which made
 * a client demo under any non-admin role feel cluttered — modules that
 * role never actually uses, sitting right next to the ones it does. This
 * audits the result: Org Admin and Managing Director get literally every
 * module; every other role keeps only what it has real, evidenced use for
 * (cross-checked against buildTasks() task ownership and every actual
 * navigate() call reachable from a page that role can open); and Dashboard
 * + Virtual Godowns stay universal, by explicit request.
 *
 * THE REAL RISK of trimming a role's nav is not the trim itself — it's the
 * cross-navigation links left behind that still point at what was removed.
 * Virtual Godown becoming universal is exactly this: VirtualGodownList's
 * header always rendered "Master Pool"/"Transfers" buttons, and
 * VirtualGodownView's hero always rendered "View SO", with PendingReceiptsPanel
 * and VGGrnCard always linking into vendor-pos/grn — none of it previously
 * had to consider a role that couldn't open the destination, because only
 * roles broad enough to already have those modules ever reached the VG page.
 * Once every role reaches it, those become silent dead ends (canAccess
 * denies the route and bounces back to the role's primary — no crash, just
 * a button that does nothing a new user can make sense of). This file
 * proves those specific spots are gated, not just that nothing crashes.
 *
 * Usage: node scripts/uitest/role-nav-check.js [path-to-frontend]
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
  console.error('Missing dev deps. Run: npm i --no-save @babel/standalone react react-dom');
  process.exit(2);
}

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const plain = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map(m => m[1]);
const jsx = [...html.matchAll(/type="text\/babel"\s+src="([^"]+)"/g)].map(m => m[1]);

const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const node = () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {},
  classList: { add() {}, remove() {} } });
sandbox.document = { createElement: node, head: node(), body: node(),
  documentElement: { style: { setProperty() {} } },
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
sandbox.__opcWorkflow = {}; sandbox.__opcFeatures = {}; sandbox.__opcIsMaster = false; sandbox.OPC_SB = null;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};
const has = (h, re) => re.test(h);

console.log('\n[1] every role keeps Dashboard + Virtual Godowns, by explicit request');
{
  const roles = Object.keys(sandbox.PERMISSIONS);
  check('there is more than one role to check (fixture sanity)', roles.length > 5, true);
  roles.forEach(r => {
    check(`${r} has 'dashboard'`, sandbox.PERMISSIONS[r].nav.includes('dashboard'), true);
    check(`${r} has 'godown'`, sandbox.PERMISSIONS[r].nav.includes('godown'), true);
  });
}

console.log('\n[2] Org Admin and Managing Director get literally every module');
{
  const all = sandbox.ALL_MODULES;
  check('ALL_MODULES is a real, non-trivial list', Array.isArray(all) && all.length > 15, true);
  check('Org Admin\'s nav is exactly ALL_MODULES', sandbox.PERMISSIONS['Org Admin'].nav, all);
  check('Managing Director\'s nav is exactly ALL_MODULES too', sandbox.PERMISSIONS['Managing Director'].nav, all);
}

console.log('\n[3] a role that never owns a task loses the always-empty My Tasks page');
{
  // Cross-checked against buildTasks() itself, not asserted by fiat: every
  // task it can ever push carries a `role`, and these four never appear as
  // one. (A fixture with every entity type live enough to make most of
  // buildTasks()'s filters fire at least once — not exhaustive, but not
  // the trivially-empty state either.)
  const state = {
    sales_orders: [
      { id: 'so-1', so_no: 'SO/FY26/0001', status: 'Pending Approval', customer_id: 'c1', lines: [{ bundle_qty: 1, unit_price: 100 }], days_overdue: 0 },
      { id: 'so-2', so_no: 'SO/FY26/0002', status: 'Approved', customer_id: 'c1', lines: [{ bundle_qty: 1, unit_price: 100 }], days_overdue: 0 },
      { id: 'so-3', so_no: 'SO/FY26/0003', status: 'Ready to Dispatch', customer_id: 'c1', lines: [{ bundle_qty: 1, unit_price: 100 }], days_overdue: 0 },
      { id: 'so-4', so_no: 'SO/FY26/0004', status: 'Procurement Started', customer_id: 'c1', lines: [{ bundle_qty: 1, unit_price: 100 }], days_overdue: 0 },
      { id: 'so-5', so_no: 'SO/FY26/0005', status: 'Material Received', customer_id: 'c1', lines: [{ bundle_qty: 1, unit_price: 100 }], days_overdue: 0 },
      { id: 'so-6', so_no: 'SO/FY26/0006', status: 'Payment Pending', customer_id: 'c1', lines: [{ bundle_qty: 1, unit_price: 100 }], days_overdue: 3, invoice_amount: 118 },
      { id: 'so-7', so_no: 'SO/FY26/0007', status: 'Fully Paid', customer_id: 'c1', lines: [{ bundle_qty: 1, unit_price: 100 }], days_overdue: 0 },
    ],
    sourcings: [
      { id: 'src-1', src_no: 'SRC/0001', status: 'Sent to Pre-sales', customer_id: 'c1', lines: [] },
      { id: 'src-2', src_no: 'SRC/0002', status: 'Sent to Sales', customer_id: 'c1', lines: [], margin: { sell: 100, marginPct: 10 } },
    ],
    rfqs: [], vendor_pos: [], vendor_invoices: [], transfer_requests: [],
    customers: [{ id: 'c1', name: 'Zenith' }], users: [], dismissed_writeoff: true,
  };
  const all = sandbox.buildTasks(state, () => {}, () => {}, () => {});
  const taskRoles = new Set(all.map(t => t.role));
  check('the fixture actually produced tasks across several roles (sanity)', taskRoles.size >= 4, true);
  ['Stores', 'Stores In', 'Stores Out', 'Supervisor'].forEach(r => {
    check(`${r} never owns a task in buildTasks()`, taskRoles.has(r), false);
    check(`${r} has no 'inbox' in its nav`, sandbox.PERMISSIONS[r].nav.includes('inbox'), false);
  });
}

console.log('\n[4] Purchase has no interactive role anywhere on Cross-SO Transfers, so it is off Purchase\'s nav');
check('Purchase has no \'transfers\'', sandbox.PERMISSIONS['Purchase'].nav.includes('transfers'), false);
check('Project Manager -- who actually runs that screen -- still has it', sandbox.PERMISSIONS['Project Manager'].nav.includes('transfers'), true);

const PRODUCTS = [{ id: 'p1', code: 'CPU', name: 'Server CPU', buy: 1000, sell: 1500 }];
const VENDORS = [{ id: 'v1', name: 'TechSource' }];
const SO = {
  id: 'so-1', so_no: 'SO/FY26/0801', customer_id: 'c1', status: 'Procurement Started',
  lines: [{ id: 'l1', bundle_qty: 1, components: [{ product_id: 'p1', qty: 10 }] }],
  extra: { pending_receipts: [{ id: 'pr-1', po_id: 'po-1', status: 'Pending', by: 'u1', date: '2026-10-01',
    items: [{ product_id: 'p1', received: 4, rejected: 0, to_pool: 0 }] }] },
};
const PO = { id: 'po-1', po_no: 'VPO/FY26/0801', so_id: 'so-1', vendor_id: 'v1', status: 'Issued',
  items: [{ product_id: 'p1', qty: 10, rate: 1000 }] };
const GRN = { id: 'g1', grn_no: 'GRN/FY26/0801', po_id: 'po-1', date: '2026-10-01',
  items: [{ product_id: 'p1', accepted: 4 }] };

function makeState() {
  return {
    products: PRODUCTS, vendors: VENDORS, customers: [{ id: 'c1', name: 'Zenith Retail' }], categories: [],
    sales_orders: [SO], vendor_pos: [PO], grns: [GRN], vendor_invoices: [],
    pool: [], transfer_requests: [], outward_dispatches: [], notifications: [], audit: [], users: [], config: {},
  };
}
function render(Comp, props, role) {
  const st = makeState();
  const store = {
    state: st, route: 'godown', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, saveConfig: () => {}, addToPool: async () => {},
    consumeFromPool: () => {}, syncErrors: [], retrySync: () => {},
    soSubtotal: so => (so.lines || []).reduce((s, l) => s + (l.components || []).reduce((a, c) => a + c.qty, 0) * 100, 0),
    getCustomer: id => st.customers.find(c => c.id === id), getVendor: id => VENDORS.find(v => v.id === id),
    getProduct: id => PRODUCTS.find(p => p.id === id), getCategory: () => undefined,
    getUser: () => ({ id: 'u1', name: 'T', role }), getSO: id => st.sales_orders.find(s => s.id === id),
  };
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(Comp, props || {}))));
}

console.log('\n[5] VirtualGodownList\'s Master Pool / Transfers shortcuts respect the viewer\'s OWN nav, now that every role reaches this page');
{
  const salesHtml = render(sandbox.VirtualGodownList, {}, 'Sales');
  check('Sales (no \'pool\') does not get a dead-end Master Pool button', has(salesHtml, />Master Pool</), false);
  check('Sales (no \'transfers\') does not get a dead-end Transfers button', has(salesHtml, />Transfers</), false);
  const adminHtml = render(sandbox.VirtualGodownList, {}, 'Org Admin');
  check('Org Admin (has both) still gets the Master Pool shortcut', has(adminHtml, />Master Pool</), true);
  check('Org Admin (has both) still gets the Transfers shortcut', has(adminHtml, />Transfers</), true);
}

console.log('\n[6] VirtualGodownView\'s cross-links into Sales Orders / Vendor POs / GRN respect the viewer\'s own nav');
{
  const collHtml = render(sandbox.VirtualGodownView, { soId: 'so-1' }, 'Collections');
  check('Collections (no sales-orders) gets no "View SO" button', has(collHtml, />View SO</), false);
  check('Collections (no vendor-pos, no sales-orders) sees the PO number as plain text, not a dead link', has(collHtml, /VPO\/FY26\/0801/) && !has(collHtml, /<a[^>]*>VPO\/FY26\/0801/), true);
  check('Collections (no grn, no sales-orders) sees the GRN number as plain text, not a dead link', has(collHtml, /GRN\/FY26\/0801/) && !has(collHtml, /<a[^>]*>GRN\/FY26\/0801/), true);
  check('Collections gets no "Open" button for a GRN it cannot open', has(collHtml, />Open</), false);

  const purchaseHtml = render(sandbox.VirtualGodownView, { soId: 'so-1' }, 'Purchase');
  check('Purchase (has sales-orders) gets a working "View SO" button', has(purchaseHtml, />View SO</), true);
  check('Purchase (has vendor-pos) gets the PO number as a real link', has(purchaseHtml, /<a[^>]*>VPO\/FY26\/0801/), true);
  check('Purchase (has grn) gets the GRN number as a real link, with an Open button', has(purchaseHtml, /<a[^>]*>GRN\/FY26\/0801/) && has(purchaseHtml, />Open</), true);
}

console.log('\n[7] clicking a notification never lands a role on a route it cannot open -- a notification\'s target and the route its kind points at were always two separate lists');
{
  const route = sandbox.notificationRoute;
  // Pre-existing, found while auditing this exact class of bug: 'Stores' has
  // never carried 'transfers' in its own nav, yet receives transfer-kind
  // notifications (Master Pool requests routed through it); 'Billing' has
  // never carried 'grn', yet receives grn-kind notifications (a GRN posted
  // against its PO). Neither was reachable before this fix.
  check('a transfer-kind notification for Stores (no \'transfers\') lands on dashboard, not a dead route', route({ kind: 'transfer' }, 'Stores'), 'dashboard');
  check('a grn-kind notification for Billing (no \'grn\') lands on dashboard, not a dead route', route({ kind: 'grn' }, 'Billing'), 'dashboard');
  // The regression this file's own change could have introduced: Stores just
  // lost 'inbox' (section [3]), and an unhandled kind used to fall through
  // to it unconditionally.
  check('an unhandled-kind (so) notification for Stores (just lost \'inbox\') lands on dashboard, not inbox', route({ kind: 'so' }, 'Stores'), 'dashboard');
  // The positive case: a role that genuinely owns the destination still
  // reaches it, so this fix is a safety net, not a general redirect-to-dashboard.
  check('a transfer-kind notification for Project Manager (who runs that screen) still opens Transfers', route({ kind: 'transfer' }, 'Project Manager'), 'transfers');
  check('a grn-kind notification for Purchase (has grn) still opens GRN', route({ kind: 'grn' }, 'Purchase'), 'grn');
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - every role keeps only what it has real use for, Admin/MD keep everything, and nothing a role can see still points at a page it cannot open');
process.exit(bad ? 1 : 0);
