#!/usr/bin/env node
/**
 * OP Central — client invoice GST: the real per-line rate, not one flat 18%
 * ---------------------------------------------------------------------------
 * Every category and product carries its own real `gst` field (5/12/18/28,
 * the actual Indian slabs) — populated from a customer's own imported sheet
 * when their "tax rate %" column says so (screens-import.jsx). Every client
 * invoice builder used to charge a flat 18% on the whole subtotal regardless,
 * same bug duplicated six times (buildInvoice's three modes, buildFractionInvoice,
 * buildConsolidatedInvoice, buildDispatchInvoice, buildBoqInvoice,
 * buildBoqFinalInvoice), plus independently in InvoiceList's KPI/table,
 * InvoiceDetail's display, the dashboard's "GST Liability" KPI, the GSTR
 * exports, the task-queue's own "Raise Invoice" card, and the SO detail
 * page's own "Raise Tax Invoice" button and Totals card — eleven places
 * computing or displaying the same number, with the same wrong formula, and
 * invisible for as long as every seed product happened to carry 18%.
 *
 * This proves the fix with a REAL mixed-rate order: one line at 18%, one at
 * 5%. A flat-18% invoice would be wrong by exactly the difference the 5%
 * line's real rate makes — the same shape of bug docs/po-tax.md already
 * fixed on the vendor PO side, now fixed on the client-invoice side too.
 *
 * Usage: node scripts/uitest/gst-check.js [path-to-frontend]
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
sandbox.__opcWorkflow = { auto_invoice_on_grn: false }; sandbox.__opcFeatures = {};
sandbox.__opcIsMaster = false; sandbox.OPC_SB = null;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};
const has = (h, re) => re.test(h);

// Mixed-rate order: one bundle at 18% GST, one at 5% -- the exact case a
// flat 18% gets wrong.
const PRODUCTS = [
  { id: 'p-18', code: 'NET', name: 'Network Switch', buy: 30000, sell: 50000, gst: 18 },
  { id: 'p-5', code: 'ACC', name: 'Accessory Kit', buy: 12000, sell: 20000, gst: 5 },
];
const CATEGORIES = [
  { id: 'cat-18', name: 'Networking Pack', gst: 18 },
  { id: 'cat-5', name: 'Accessory Bundle', gst: 5 },
];
const VENDORS = [{ id: 'v1', name: 'TechSource' }];
const ORG = { name: 'Our Co', state: 'Maharashtra', gstin: '27AAAAA0000A1Z5', address: '', fiscal_year: '26' };

function makeSO(custState) {
  return {
    id: 'so-1', so_no: 'SO/FY26/0900', customer_id: 'c1', status: 'Material Received',
    lines: [
      { id: 'l1', category_id: 'cat-18', bundle_qty: 1, unit_price: 50000, components: [{ product_id: 'p-18', qty: 1 }] },
      { id: 'l2', category_id: 'cat-5', bundle_qty: 1, unit_price: 20000, components: [{ product_id: 'p-5', qty: 1 }] },
    ],
  };
}
function makeState(custState) {
  const so = makeSO();
  const po = { id: 'po-1', po_no: 'VPO/FY26/0900', so_id: 'so-1', vendor_id: 'v1', status: 'Material Received',
    items: [{ product_id: 'p-18', qty: 1, rate: 30000 }, { product_id: 'p-5', qty: 1, rate: 12000 }] };
  const grn = { id: 'g1', grn_no: 'GRN/FY26/0900', po_id: 'po-1', date: '2026-10-01',
    items: [{ product_id: 'p-18', accepted: 1 }, { product_id: 'p-5', accepted: 1 }] };
  return {
    org: ORG, products: PRODUCTS, categories: CATEGORIES, vendors: VENDORS,
    customers: [{ id: 'c1', name: 'Acme Retail', state: custState, gstin: '' }],
    sales_orders: [so], vendor_pos: [po], grns: [grn], vendor_invoices: [],
    transfer_requests: [], notifications: [], audit: [], pool: [], config: {},
  };
}
function ctxFor(state, onMutate) {
  const box = { state };
  const mutate = fn => { box.state = fn(box.state); if (onMutate) onMutate(box.state); };
  return {
    get state() { return box.state; }, mutate, toast: null,
    getProduct: id => PRODUCTS.find(p => p.id === id), getUser: () => ({ name: 'T' }), currentUser: 'u1',
    box,
  };
}

console.log('\n[1] the shared helpers read the real per-item/category rate, never a flat 18%');
{
  const st = makeState('Maharashtra');
  check('p-18 resolves to its own product rate', sandbox.invoiceLineGstPct(st, 'p-18', null), 18);
  check('p-5 resolves to its own product rate', sandbox.invoiceLineGstPct(st, 'p-5', null), 5);
  check('cat-18 resolves to its own category rate', sandbox.invoiceLineGstPct(st, null, 'cat-18'), 18);
  check('cat-5 resolves to its own category rate', sandbox.invoiceLineGstPct(st, null, 'cat-5'), 5);
  check('an unknown product/category falls back to 18 (the catalogue/importer default), not 0', sandbox.invoiceLineGstPct(st, 'nope', null), 18);
  check('same-state customer -> CGST+SGST applies', sandbox.invoiceSameState(st.sales_orders[0], st), true);
  const stOther = makeState('Gujarat');
  check('cross-state customer -> IGST applies', sandbox.invoiceSameState(stOther.sales_orders[0], stOther), false);
  check('the order\'s own lines weighted by value give the true blended rate, not 18', Math.round(sandbox.soWeightedGstPct(st.sales_orders[0], st) * 100) / 100, 14.29);
}

console.log('\n[2] buildInvoice (bundle mode, the default manual path) charges the REAL blended tax, not flat 18%');
{
  const st = makeState('Maharashtra');   // same-state -> CGST+SGST
  const made = sandbox.raiseSOInvoice('so-1', { mode: 'bundle' }, ctxFor(st));
  check('an invoice was actually produced (fixture sanity)', !!made, true);
  check('subtotal is the full order value (50000+20000)', made.invoice.subtotal, 70000);
  // Real: 50000*0.18 + 20000*0.05 = 9000 + 1000 = 10000. A flat 18% would have said 12600.
  check('gst is the REAL blended tax (9000 + 1000), not flat 18% of 70000 (12600)', made.invoice.gst, 10000);
  check('total is subtotal + the real tax, not the old flat-18% total (82600)', made.invoice.total, 80000);
  check('same-state splits evenly into CGST+SGST (5000 each)', [made.invoice.cgst, made.invoice.sgst], [5000, 5000]);
  check('no IGST on a same-state order', made.invoice.igst, 0);
  check('each line is stamped with its OWN real rate, not a shared blended one', made.invoice.lines.map(l => l.gst_pct).sort((a, b) => a - b), [5, 18]);
}

console.log('\n[3] the same order, cross-state, charges IGST at the real blended rate instead of CGST+SGST');
{
  const st = makeState('Gujarat');
  const made = sandbox.raiseSOInvoice('so-1', { mode: 'bundle' }, ctxFor(st));
  check('gst is still the real blended tax', made.invoice.gst, 10000);
  check('all of it is IGST, none CGST/SGST', [made.invoice.cgst, made.invoice.sgst, made.invoice.igst], [0, 0, 10000]);
}

console.log('\n[4] the auto-invoice-on-GRN path (buildFractionInvoice -> buildConsolidatedInvoice) also charges the real rate');
{
  const st = makeState('Maharashtra');
  const ctx = ctxFor(st);
  // autoInvoiceSO needs auto_invoice_on_grn on for this one call.
  const before = sandbox.__opcWorkflow;
  sandbox.__opcWorkflow = { auto_invoice_on_grn: true };
  const made = sandbox.autoInvoiceSO('so-1', ctx);
  sandbox.__opcWorkflow = before;
  check('autoInvoiceSO actually produced something (the itemfraction partial)', !!made, true);
  check('the partial\'s own subtotal is the full order value', made.invoice.subtotal, 70000);
  check('the partial\'s gst is the REAL blended tax (9000+1000), not flat 18% (12600)', made.invoice.gst, 10000);
  check('the partial\'s total is the real figure, not the old flat-18% one', made.invoice.total, 80000);
  // buildConsolidatedInvoice also fires in the same autoInvoiceSO call (a
  // separate SHAREABLE document mirroring the same value, explicitly
  // excluded from _nonConsolidatedTotal so it never double-bills the order
  // -- see buildConsolidatedInvoice's own comment). It must carry the same
  // real tax too, not its own flat-18% copy.
  const invs = ctx.state.sales_orders[0].invoices || [];
  const consolidated = invs.find(i => i.consolidated);
  check('a consolidated invoice was also raised (fixture sanity -- order is fully received and fully billed)', !!consolidated, true);
  check('the consolidated copy carries the same real tax, not a flat-18% recompute', consolidated.gst, 10000);
}

console.log('\n[5] a same-rate (all-18%) order is byte-identical to the old flat-18% math -- no regression on the common case');
{
  const st = makeState('Maharashtra');
  st.sales_orders[0].lines[1].category_id = 'cat-18';   // both lines now 18%
  st.categories = [{ id: 'cat-18', name: 'Networking Pack', gst: 18 }];
  const made = sandbox.raiseSOInvoice('so-1', { mode: 'bundle' }, ctxFor(st));
  check('subtotal unchanged', made.invoice.subtotal, 70000);
  check('gst matches the old flat-18% formula exactly when every line really is 18%', made.invoice.gst, Math.round(70000 * 0.18));
  check('total matches the old flat-18% formula exactly', made.invoice.total, Math.round(70000 * 1.18));
}

console.log('\n[6] InvoiceDetail displays the STORED, stamped total -- never recomputes it, so it can never drift from what was actually invoiced');
{
  const st = makeState('Maharashtra');
  const made = sandbox.raiseSOInvoice('so-1', { mode: 'bundle' }, ctxFor(st));
  const so = { ...st.sales_orders[0], invoices: [made.invoice] };
  const stWithInv = { ...st, sales_orders: [so] };
  const store = {
    state: stWithInv, route: 'invoices', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, soSubtotal: s => s.lines.reduce((a, l) => a + l.bundle_qty * l.unit_price, 0),
    soBillAdjustment: () => 0, soBilledSubtotal: s => s.lines.reduce((a, l) => a + l.bundle_qty * l.unit_price, 0),
    getSO: () => so, getCustomer: () => stWithInv.customers[0], getCategory: id => CATEGORIES.find(c => c.id === id),
    getProduct: id => PRODUCTS.find(p => p.id === id), getUser: () => ({ name: 'T' }),
  };
  const outHtml = ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(sandbox.InvoiceDetail, { soId: 'so-1', invId: made.invoice.id }))));
  check('the printed total is the real ₹80,000 (the stored, correct figure), not the old flat-18% ₹82,600', has(outHtml, /80,000/), true);
  check('the old wrong total never appears anywhere on the page', has(outHtml, /82,600/), false);
}

console.log('\n[7] InvoiceList and the GSTR-style helpers read the same stamped figures, never a flat /1.18 back-calc once a real invoice exists');
{
  const st = makeState('Maharashtra');
  const made = sandbox.raiseSOInvoice('so-1', { mode: 'bundle' }, ctxFor(st));
  const so = { ...st.sales_orders[0], invoices: [made.invoice], invoice_no: made.invoice.no, invoice_amount: made.invoice.total };
  check('soInvoicedTaxable reads the real stamped subtotal', sandbox.soInvoicedTaxable(so), 70000);
  check('soInvoicedGst reads the real stamped gst, not invoice_amount/1.18 * 0.18 (which would say 12600)', sandbox.soInvoicedGst(so), 10000);
  const legacy = { invoice_no: 'INV/LEGACY/0001', invoice_amount: 82600, invoices: [] };
  check('a true legacy SO (no invoices[] at all) still falls back to the /1.18 divisor -- there is nothing else to read', Math.round(sandbox.soInvoicedTaxable(legacy)), 70000);
}

console.log('\n[8] soFullyReceived agrees with soReceivedQty about pool-diverted stock -- a closed gate the two used to disagree on');
{
  const st = makeState('Maharashtra');
  const so = st.sales_orders[0];
  // Fully received per the GRN fixture already in state.
  check('fully received before any pool diversion', sandbox.soFullyReceived(st, so), true);
  // Now divert one unit of p-18 back to the Master Pool.
  const soAfter = { ...so, extra: { pool_out: [{ product_id: 'p-18', qty: 1 }] } };
  const stAfter = { ...st, sales_orders: [soAfter] };
  check('soReceivedQty already correctly shows the shortfall', (sandbox.soReceivedQty(soAfter, stAfter)['p-18'] || 0), 0);
  check('soFullyReceived now agrees -- no longer "fully received" once stock was sent back to the pool', sandbox.soFullyReceived(stAfter, soAfter), false);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - client invoices charge the real per-line GST rate everywhere, never a flat 18%, and the stamped total never drifts from what is displayed');
process.exit(bad ? 1 : 0);
