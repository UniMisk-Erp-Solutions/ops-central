#!/usr/bin/env node
/**
 * OP Central — SO Invoicing tab never implies "settled" when nothing is priced
 * ---------------------------------------------------------------------------
 * A real order (Microlink, procurement_only -- invoices on DISPATCH) was
 * dispatched twice, in full, and the Invoicing tab showed Billed/Invoiced/
 * Balance all at ₹0 with "No invoices yet. Partial invoices auto-appear as
 * material is received" -- wrong trigger word for this org (dispatch, not
 * receipt) and no reason given. The ACTUAL cause: every product on the order
 * had sell = 0, so buildDispatchInvoice correctly refused to raise a ₹0
 * invoice (see dispatch-invoicing.md). Nothing in the invoicing engine was
 * broken -- the tab just never said so, which from a storekeeper's chair
 * looks exactly like a bug.
 *
 * Usage: node scripts/uitest/invoicing-tab-check.js [path-to-frontend]
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
// Fixture mirrors the real SO202600 shape: one line, one component, received
// and dispatched in full, nothing priced (sell = 0 / unit_price = 0).
// ---------------------------------------------------------------------------
function makeStore({ priced }) {
  const products = [{ id: 'p1', name: 'Core Switch', sell: priced ? 5000 : 0, buy: priced ? 4000 : 0 }];
  const so = {
    id: 'so-1', so_no: 'SO202600', customer_id: 'c1', status: 'Material Received',
    lines: [{ id: 'l1', bundle_qty: 1, unit_price: priced ? 5000 : 0,
      components: [{ product_id: 'p1', qty: 1, sell: priced ? 5000 : 0 }] }],
    invoices: [],
  };
  const po = { id: 'po-1', so_id: 'so-1', status: 'Material Received', items: [{ product_id: 'p1', qty: 1 }] };
  const grn = { id: 'grn-1', po_id: 'po-1', items: [{ product_id: 'p1', accepted: 1 }] };
  const st = {
    loaded: true, org: {}, config: {},
    sales_orders: [so], vendor_pos: [po], grns: [grn], outward_dispatches: [],
    customers: [{ id: 'c1', name: 'Acme Corp' }], vendors: [], products, categories: [],
    boms: [], rfqs: [], sourcings: [], notifications: [], audit: [], pool: [], invoices: [],
    transfer_requests: [], payments: [], vendor_invoices: [], site_updates: [],
    item_aliases: [], collections: [], client_requests: [],
    users: [{ id: 'u1', name: 'Test User', role: 'Purchase', active: true }],
  };
  const soSubtotal = (x) => x.lines.reduce((s, l) => s + l.bundle_qty * l.unit_price, 0);
  const soBillAdjustment = (x) => (x.bill_adjustments || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const soNonBillable = (x) => (x.lines || []).filter(l => l.non_billable).reduce((s, l) => s + (l.bundle_qty || 0) * (l.unit_price || 0), 0);
  const soBilledSubtotal = (x) => Math.max(0, soSubtotal(x) - soNonBillable(x) - soBillAdjustment(x));
  const store = {
    state: st, route: 'sales-orders', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, saveConfig: () => {}, setRoute: () => {},
    addToPool: () => {}, consumeFromPool: () => {}, signOut: () => {},
    syncErrors: [], retrySync: () => {},
    getCustomer: id => st.customers.find(c => c.id === id),
    getVendor: id => st.vendors.find(v => v.id === id),
    getProduct: id => st.products.find(p => p.id === id),
    getCategory: id => st.categories.find(c => c.id === id),
    getUser: id => st.users.find(u => u.id === id),
    getSO: id => st.sales_orders.find(x => x.id === id),
    soBilledSubtotal, soBillAdjustment,
  };
  return [store, so];
}

const renderTab = (priced, workflow) => {
  sandbox.__opcWorkflow = workflow;
  const [store, so] = makeStore({ priced });
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(sandbox.SOInvoicingTab, { so }))));
};

console.log('\n[1] dispatched, received, nothing priced, invoice_on_dispatch org -- the real SO202600 shape');
{
  const out = renderTab(false, { invoice_on_dispatch: true });
  check('does NOT show the old, unconditional "no invoices yet" wording',
    /No invoices yet\. Partial invoices auto-appear/.test(out), false);
  check('explains that nothing is priced, not that the order is settled',
    out.includes('Nothing to invoice yet'), true);
  check('names the fix', out.includes('Edit line items'), true);
  check('names the RIGHT trigger for this org -- dispatch, not receipt',
    out.includes('the next dispatch will invoice automatically'), true);
  check('does not also claim the receipt-trigger wording', out.includes('the next receipt will invoice'), false);
}

console.log('\n[2] same (nothing priced), on a receipt-triggered org (auto_invoice_on_grn, standard profile)');
{
  const out = renderTab(false, { invoice_on_dispatch: false });
  check('names the RIGHT trigger for THIS org -- receipt, not dispatch',
    out.includes('the next receipt will invoice automatically'), true);
  check('does not claim the dispatch-trigger wording here', out.includes('the next dispatch will invoice'), false);
}

console.log('\n[3] a genuinely priced order with nothing invoiced YET still gets the real empty-state message, correctly worded');
{
  const outDispatch = renderTab(true, { invoice_on_dispatch: true });
  check('the "nothing priced" message is NOT shown once there is real value to invoice',
    outDispatch.includes('Nothing to invoice yet'), false);
  check('the raise-invoice card is offered (real balance > 0)',
    outDispatch.includes('Raise invoice'), true);

  const outReceipt = renderTab(true, { invoice_on_dispatch: false });
  check('on a receipt-triggered org, the fallback empty-state message says "received", not "dispatched"',
    outReceipt.includes('material is received'), true);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : "\nPASS - the Invoicing tab explains WHY nothing is invoiced instead of implying the order is settled, worded for this org's own trigger");
process.exit(bad ? 1 : 0);
