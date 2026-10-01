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

console.log('\n[4] a real, priced bundle still invoices 0 while ONE component is missing -- and now says which one');
// Mirrors a real production order: a 9-component "PC kit" bundle, fully
// priced, eight components received, the keyboard never delivered at all.
// soInvoiceState correctly refuses to bill an incomplete bundle -- that part
// already worked. What it never said was WHY, so "0 invoiceable" on a
// genuinely priced, genuinely valuable order looked identical to the
// no-price dead end this whole file exists to fix.
{
  sandbox.__opcWorkflow = { invoice_on_dispatch: false };
  const kbProduct = { id: 'p-kb', name: 'Keyboard', sell: 0, buy: 0 };
  const products = [
    { id: 'p-cpu', name: 'CPU', sell: 0, buy: 0 },
    kbProduct,
  ];
  const so = {
    id: 'so-kit', so_no: 'SO/FY26/0035', customer_id: 'c1', status: 'Material Received',
    lines: [{ id: 'l1', bundle_qty: 150, unit_price: 68650,
      components: [
        { product_id: 'p-cpu', qty: 1 },
        { product_id: 'p-kb', qty: 1 },
      ] }],
    invoices: [],
  };
  const po = { id: 'po-1', so_id: 'so-kit', status: 'Partially Received',
    items: [{ product_id: 'p-cpu', qty: 150 }, { product_id: 'p-kb', qty: 150 }] };
  // Every CPU arrived; not one keyboard ever did.
  const grn = { id: 'grn-1', po_id: 'po-1', items: [{ product_id: 'p-cpu', accepted: 150 }] };
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
    soBilledSubtotal: (x) => Math.max(0, soSubtotal(x)), soBillAdjustment: () => 0,
  };

  const out = ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(sandbox.SOInvoicingTab, { so }))));

  check('does NOT fall into the "nothing priced" message -- this order has real value',
    out.includes('Nothing to invoice yet'), false);
  check('the raise-invoice card is offered (real balance > 0)', out.includes('Raise invoice'), true);
  check('names the actual missing component', out.includes('Keyboard'), true);
  check('says how much of it has arrived', out.includes('0 of 1 per unit received'), true);
  check('explains the rule, not just the blocker', out.includes('nothing bills until every component'), true);

  // The underlying computation, isolated from rendering: soInvoiceState itself.
  const lineState = sandbox.soInvoiceState(so, st, store.getProduct)[0];
  check('invoiceableNow is correctly 0', lineState.invoiceableNow, 0);
  check('blockedBy names exactly the short component, not the fully-received one',
    lineState.blockedBy.map(b => b.product_id), ['p-kb']);
  check('blockedBy reports what actually arrived (0) vs what one bundle needs (1)',
    [lineState.blockedBy[0].have, lineState.blockedBy[0].need], [0, 1]);
}

console.log('\n[5] a legacy single-invoice order is NOT a third "nothing invoiced" case -- it is already invoiced');
// Four real production orders (OP Central Demo, Closed, real value, real
// invoice_no/invoice_amount) looked identical to the two bugs above at first
// glance -- invoices.length === 0 -- until checking so.invoice_no too. They
// predate the invoices[] array and were invoiced through the older
// single-invoice field. legacyInvoiced must keep intercepting this BEFORE
// the "nothing priced" / generic-empty branches this file added, or a
// perfectly correct closed-and-paid order would start claiming to have no
// price or to be blocked on a missing component.
{
  const [store, so] = makeStore({ priced: true });
  so.invoices = [];
  so.invoice_no = 'INV/FY26/0081';
  so.invoice_amount = 66257;
  const out = ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(sandbox.SOInvoicingTab, { so }))));
  check('shows the legacy-invoice notice', out.includes('invoiced via a single full invoice'), true);
  check('names the real invoice number', out.includes('INV/FY26/0081'), true);
  check('never claims nothing is priced', out.includes('Nothing to invoice yet'), false);
  check('never shows the generic "no invoices yet" wording either', /No invoices yet\. Partial invoices auto-appear/.test(out), false);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : "\nPASS - the Invoicing tab explains WHY nothing is invoiced instead of implying the order is settled, worded for this org's own trigger, for an unpriced order, one blocked on a missing component, and never confuses either with an order already invoiced the legacy way");
process.exit(bad ? 1 : 0);
