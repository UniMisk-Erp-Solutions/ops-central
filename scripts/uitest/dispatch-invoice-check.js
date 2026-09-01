#!/usr/bin/env node
/**
 * OP Central — dispatch invoicing check
 * ---------------------------------------------------------------------------
 * Billing on receipt charges the customer for goods still in our own godown.
 * These orders are billed on what actually SHIPPED, per delivery challan.
 *
 * Two things have to be right, and both are the kind that go wrong quietly:
 *
 *   THE NAME  the customer matches the invoice against their own purchase
 *             order, so the line has to carry THEIR wording for the item
 *   THE MONEY partial dispatch = partial invoice, never more than the order is
 *             worth, and the same challan can never be billed twice
 *
 * Usage: node scripts/uitest/dispatch-invoice-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React;
try { Babel = require('@babel/standalone'); React = require('react'); }
catch (e) { console.error('Missing dev deps. Run: npm i --no-save @babel/standalone react'); process.exit(2); }

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

const PRODUCTS = [
  { id: 'p-chassis', code: 'C9606R', name: 'Cisco Catalyst 9600 6 Slot Chassis', hsn: '8517', buy: 0, sell: 0 },
  { id: 'p-psu', code: 'C9600-PWR-2KWAC', name: 'Cisco Catalyst 9600 2000W AC PSU', hsn: '8504', buy: 0, sell: 0 },
];
const getProduct = id => PRODUCTS.find(p => p.id === id);
const getUser = () => ({ id: 'u1', name: 'Jitendra', role: 'Purchase' });

// One chassis at 200000 and four power supplies at 25000 = 300000
const SO = {
  id: 'so-1', so_no: 'SO/FY26/0001', customer_id: 'c1', status: 'Approved',
  lines: [{ id: 'l1', bundle_qty: 1, unit_price: 300000, components: [
    { product_id: 'p-chassis', qty: 1, sell: 200000 },
    { product_id: 'p-psu', qty: 4, sell: 25000 },
  ] }],
  invoices: [],
};
const STATE = { products: PRODUCTS, sales_orders: [SO], vendor_pos: [], grns: [],
  pool: [], notifications: [], audit: [], outward_dispatches: [] };

// A challan carrying the CUSTOMER's own wording, as the dispatch screen records it.
const DC1 = { id: 'dc-1', so_id: 'so-1', dc_no: 'DC/OUT/0001', date: '2026-05-21',
  items: [{ product_id: 'p-chassis', qty: 1, name: 'Cisco Catalyst 9600 6 Slot Chassis',
            cust_name: 'CORE SWITCH CHASSIS - 6 SLOT', cust_code: 'ABG-NW-001' }] };

console.log('\n[1] the invoice bills what shipped, in the customer wording');
let r = sandbox.buildDispatchInvoice(SO, STATE, DC1, 'u1', getUser, getProduct);
check('an invoice is produced', !!r, true);
check('one line, for the one item dispatched', r.invoice.lines.length, 1);
check('billed at the ORDER price, not the catalogue', r.invoice.lines[0].unit_price, 200000);
check('quantity is what went out', r.invoice.lines[0].qty, 1);
check('the line is named as the CUSTOMER ordered it',
  r.invoice.lines[0].label, 'CORE SWITCH CHASSIS - 6 SLOT');
check('their part number is kept too', r.invoice.lines[0].cust_code, 'ABG-NW-001');
check('...and our own name is kept alongside for the warehouse',
  r.invoice.lines[0].our_name, 'Cisco Catalyst 9600 6 Slot Chassis');
check('it cites the challan', [r.invoice.dc_no, r.invoice.mode], ['DC/OUT/0001', 'dispatch']);

console.log('\n[2] a partial dispatch is a PARTIAL invoice');
check('subtotal is only what shipped', r.invoice.subtotal, 200000);
check('GST at 18%', r.invoice.gst, 36000);
check('total', r.invoice.total, 236000);
check('marked Partial, because 100000 of the order is unshipped', r.invoice.type, 'Partial');

console.log('\n[3] the second dispatch invoices the balance and closes it');
const afterFirst = r.so;
const STATE2 = { ...STATE, sales_orders: [afterFirst] };
const DC2 = { id: 'dc-2', so_id: 'so-1', dc_no: 'DC/OUT/0002', date: '2026-05-25',
  items: [{ product_id: 'p-psu', qty: 4, name: 'PSU', cust_name: 'POWER SUPPLY 2000W', cust_code: 'ABG-NW-009' }] };
const r2 = sandbox.buildDispatchInvoice(afterFirst, STATE2, DC2, 'u1', getUser, getProduct);
check('a second invoice is produced', !!r2, true);
check('4 power supplies at 25000', r2.invoice.subtotal, 100000);
check('in the customer wording again', r2.invoice.lines[0].label, 'POWER SUPPLY 2000W');
check('now marked Final', r2.invoice.type, 'Final');
check('the order is flagged invoiced', r2.so.status, 'Invoiced');
const totalInvoiced = (r2.so.invoices || []).reduce((a, i) => a + i.subtotal, 0);
check('the two invoices add up to the order value exactly', totalInvoiced, 300000);

console.log('\n[4] the same challan can never be billed twice');
check('re-invoicing DC/OUT/0001 is refused',
  sandbox.buildDispatchInvoice(r2.so, { ...STATE, sales_orders: [r2.so] }, DC1, 'u1', getUser, getProduct), null);
check('and nothing is left to invoice anyway',
  sandbox.buildDispatchInvoice(r2.so, { ...STATE, sales_orders: [r2.so] },
    { id: 'dc-3', so_id: 'so-1', dc_no: 'DC/OUT/0003', items: [{ product_id: 'p-psu', qty: 1 }] },
    'u1', getUser, getProduct), null);

console.log('\n[5] it cannot bill more than the order is worth');
const BIG = { id: 'dc-big', so_id: 'so-1', dc_no: 'DC/OUT/9999',
  items: [{ product_id: 'p-chassis', qty: 5, cust_name: 'CHASSIS' }] };   // 5 x 200000 = 1,000,000
const rBig = sandbox.buildDispatchInvoice(SO, STATE, BIG, 'u1', getUser, getProduct);
check('capped at the order value, not 1,000,000', rBig.invoice.subtotal, 300000);
check('...and closed as Final', rBig.invoice.type, 'Final');

console.log('\n[6] nothing priced yet means no invoice, not a zero-rupee one');
const UNPRICED = { ...SO, id: 'so-2', unit_price: 0,
  lines: [{ id: 'l1', bundle_qty: 1, unit_price: 0, components: [{ product_id: 'p-chassis', qty: 1, sell: 0 }] }],
  invoices: [] };
check('no invoice is raised for an unpriced order',
  sandbox.buildDispatchInvoice(UNPRICED, { ...STATE, sales_orders: [UNPRICED] },
    { id: 'dc-u', so_id: 'so-2', dc_no: 'DC/U', items: [{ product_id: 'p-chassis', qty: 1 }] },
    'u1', getUser, getProduct), null);

console.log('\n[7] an item never mapped falls back to our own name');
const NOMAP = { id: 'dc-n', so_id: 'so-1', dc_no: 'DC/OUT/0004',
  items: [{ product_id: 'p-chassis', qty: 1 }] };   // no cust_name / cust_code
const rN = sandbox.buildDispatchInvoice(SO, STATE, NOMAP, 'u1', getUser, getProduct);
check('the line is still named, using our catalogue',
  rN.invoice.lines[0].label, 'Cisco Catalyst 9600 6 Slot Chassis');

console.log('\n[8] the switch decides, per organization');
sandbox.__opcWorkflow = { invoice_on_dispatch: false };
check('with the switch OFF, dispatch raises nothing',
  sandbox.raiseDispatchInvoice('so-1', DC1, { mutate: () => {}, currentUser: 'u1', getUser, getProduct }), null);
sandbox.__opcWorkflow = { invoice_on_dispatch: true };
let committed = null;
const res = sandbox.raiseDispatchInvoice('so-1', DC1, {
  mutate: (fn) => { committed = fn(STATE); },
  currentUser: 'u1', getUser, getProduct,
});
check('with it ON, the invoice is committed to the order', !!res, true);
check('...and lands on the sales order', (committed.sales_orders[0].invoices || []).length, 1);
check('...and Collections is told', /INV\/FY26/.test(committed.notifications[0].text), true);

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - dispatch bills what shipped, in the customer own words');
process.exit(bad ? 1 : 0);
