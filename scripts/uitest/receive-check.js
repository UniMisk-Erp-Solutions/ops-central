#!/usr/bin/env node
/**
 * OP Central — receiving UI check
 * ---------------------------------------------------------------------------
 * Receiving is where quantities enter the system, so the dialog has to be right
 * about what is still due. It now defaults to "everything outstanding arrived"
 * and offers a one-click select-all, which is only safe if "outstanding"
 * accounts for earlier partial deliveries — otherwise a second receipt would
 * quietly book the same goods twice.
 *
 * Also checks that Stores — the people actually at the gate — can open it.
 *
 * Usage: node scripts/uitest/receive-check.js [path-to-frontend]
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

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

// A PO of 3 lines where ONE has already been received in full on an earlier
// delivery and another was received in part.
const PRODUCTS = [
  { id: 'p1', code: 'C9606R', name: 'Chassis', buy: 0, sell: 0 },
  { id: 'p2', code: 'PWR', name: 'Power supply', buy: 0, sell: 0 },
  { id: 'p3', code: 'SFP', name: 'SFP module', buy: 0, sell: 0 },
];
const PO = { id: 'po-1', po_no: 'VPO/FY26/0041', so_id: 'so-1', vendor_id: 'v1',
  date: '2026-05-01', status: 'Issued',
  dispatch_info: { lr_no: 'DELHIVERY-D88234', carrier: 'Delhivery' },
  items: [{ product_id: 'p1', qty: 1, rate: 0 },
          { product_id: 'p2', qty: 4, rate: 0 },
          { product_id: 'p3', qty: 20, rate: 0 }] };
const STATE = {
  products: PRODUCTS, vendors: [{ id: 'v1', name: 'dykin' }], customers: [], categories: [],
  sales_orders: [{ id: 'so-1', so_no: 'SO/FY26/0001', lines: [] }],
  vendor_pos: [PO], grns: [
    // p1 fully received, p2 partly (1 of 4)
    { id: 'g1', grn_no: 'GRN/0001', po_id: 'po-1', date: '2026-05-10', lr: 'X',
      items: [{ product_id: 'p1', accepted: 1 }, { product_id: 'p2', accepted: 1 }] },
  ],
  notifications: [], audit: [], pool: [], outward_dispatches: [], users: [],
};

function render(role) {
  const store = {
    state: STATE, route: 'vendor-pos', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, saveConfig: () => {}, addToPool: () => {},
    consumeFromPool: () => {}, syncErrors: [], retrySync: () => {},
    getCustomer: () => undefined, getVendor: id => STATE.vendors.find(v => v.id === id),
    getProduct: id => PRODUCTS.find(p => p.id === id), getCategory: () => undefined,
    getUser: () => ({ id: 'u1', name: 'T', role }), getSO: id => STATE.sales_orders.find(s => s.id === id),
  };
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null,
        React.createElement(sandbox.ReceiveModal, { po: PO, onClose: () => {} }))));
}

sandbox.__opcWorkflow = { receiving_flow: 'stores_to_purchase', auto_invoice_on_grn: false };
sandbox.__opcFeatures = {}; sandbox.__opcIsMaster = false; sandbox.OPC_SB = null;

console.log('\n[1] the dialog opens and offers one-click selection');
let html2 = render('Stores');
check('it renders', html2.length > 400, true);
check('"Everything arrived" is offered', /Everything arrived/.test(html2), true);
check('"Clear all" is offered', /Clear all/.test(html2), true);
check('a select-every-line header box exists', /Select every line/.test(html2), true);

console.log('\n[2] it knows what an earlier delivery already took');
check('a "Still due" column is shown', /Still due/.test(html2), true);
check('the fully-received line is marked done, not offered again', /done/.test(html2), true);
// 3 lines: p1 done (0 due), p2 3 due, p3 20 due -> 2 receivable, 23 units
check('the footer counts only what is still due', /2 of 2 line\(s\) · 23 unit\(s\)/.test(html2), true);

console.log('\n[3] the rare case stays out of the way');
check('rejected / surplus columns are hidden by default', /Rejected/.test(html2), false);
check('...behind an explicit opt-in', /rejected \/ is surplus/i.test(html2), true);

console.log('\n[4] the LR already recorded on the PO is carried in');
check('no hard-coded demo tracking number', /DELHIVERY-D88234/.test(html2), true);

console.log('\n[5] Stores can receive, not only Purchase');
['Stores', 'Purchase', 'Org Admin', 'Project Manager'].forEach(r => {
  let ok = true;
  try { render(r); } catch (e) { ok = false; }
  check(`${r} can open the receive dialog`, ok, true);
});

// ---------------------------------------------------------------------------
// A queue nobody can find is a queue nobody clears. Stores confirm a receipt and
// it goes to Purchase — who could only see it on the GRN screen, and only if
// they already knew to look there.
// ---------------------------------------------------------------------------
console.log('\n[6] the pending receipt reaches Purchase wherever they are standing');
const SO_PENDING = {
  id: 'so-1', so_no: 'SO/FY26/0001', customer_id: 'c1', status: 'Draft', lines: [],
  extra: { pending_receipts: [{
    id: 'pr-1', by: 'u-stores', date: '2026-05-21', status: 'Pending', flow: 'stores_to_purchase',
    picks: [{ product_id: 'p1', qty: 1, name: 'Cisco Catalyst 9600 XE 17.12 UNIVERSAL' }],
  }] },
};
function renderAs(Comp, role, props) {
  const st = Object.assign({}, STATE, { sales_orders: [SO_PENDING] });
  const store = {
    state: st, route: 'godown', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, saveConfig: () => {}, addToPool: () => {},
    consumeFromPool: () => {}, syncErrors: [], retrySync: () => {}, soSubtotal: () => 0,
    getCustomer: () => undefined, getVendor: id => STATE.vendors.find(v => v.id === id),
    getProduct: id => PRODUCTS.find(p => p.id === id), getCategory: () => undefined,
    getUser: id => (id === 'u-stores'
      ? { id: id, name: 'Stores Guy', role: 'Stores' }
      : { id: 'u1', name: 'T', role: role }),
    getSO: id => st.sales_orders.find(x => x.id === id),
  };
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(Comp, props || {}))));
}

let out = renderAs(sandbox.PendingReceiptsPanel, 'Purchase', { soId: 'so-1' });
check('Purchase is shown the confirmed receipt', /Awaiting Purchase acceptance/.test(out), true);
check('...naming who confirmed it', /Stores Guy/.test(out), true);
check('...with the items listed', /Cisco Catalyst 9600 XE/.test(out), true);
check('...and an Accept action', /post GRN/.test(out), true);
check('...and a Reject action', /Reject/.test(out), true);

out = renderAs(sandbox.PendingReceiptsPanel, 'Stores', { soId: 'so-1' });
check('Stores see it waiting, with no Accept button of their own',
  /awaiting Purchase/.test(out) && !/post GRN/.test(out), true);

out = renderAs(sandbox.PendingReceiptsPanel, 'Purchase', {});
check('unscoped, it names the order it belongs to', out.indexOf('SO/FY26/0001') !== -1, true);

// The wrapper always renders its own toast host, so check the PANEL added
// nothing rather than that the whole tree is empty.
check('it disappears when nothing is pending',
  /Awaiting|post GRN/.test(renderAs(sandbox.PendingReceiptsPanel, 'Purchase', { soId: 'no-such-order' })), false);

console.log(bad ? `\nFAILED — ${bad} check(s)` : '\nPASS — one-click receiving, no double-counting, and the queue is findable');
process.exit(bad ? 1 : 0);
