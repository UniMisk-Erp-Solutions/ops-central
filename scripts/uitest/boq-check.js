#!/usr/bin/env node
/**
 * OP Central — BOQ (Billing Order Quantity) check
 * ---------------------------------------------------------------------------
 * The BOM says what the order CONTAINS. A BOQ says what gets BILLED TOGETHER,
 * and it bills only when it is COMPLETE:
 *
 *   BOQ 001 holds 10 items, all 10 dispatched  ->  partial invoice raised
 *   BOQ 001 holds 10 items,  7 dispatched      ->  nothing, it waits
 *
 * Everything here is arithmetic that goes wrong quietly, so it is asserted:
 *
 *   FREE QUANTITY  a unit already committed to one BOQ can never be claimed by
 *                  another, or the customer is billed for it twice
 *   ALLOCATION     dispatches are per item, not per BOQ. Oldest BOQ first, so a
 *                  later one is never closed by goods that belong to an earlier
 *   THE THRESHOLD  short by one unit is not "nearly complete", it is not billed
 *   THE CLOSE      when every BOQ has fired, whatever else shipped is swept
 *                  into one Final invoice
 *
 * Usage: node scripts/uitest/boq-check.js [path-to-frontend]
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

// ---------------------------------------------------------------------------
// An order carved the way Purchase actually carve one: two bundles, priced per
// component, with the customer own wording recorded against each item.
// ---------------------------------------------------------------------------
const PRODUCTS = [
  { id: 'p-sw',  code: 'C9300-24T', name: 'Catalyst 9300 24 Port Switch', sell: 0, buy: 0 },
  { id: 'p-psu', code: 'PWR-2KWAC', name: '2000W AC Power Supply',        sell: 0, buy: 0 },
  { id: 'p-sfp', code: 'SFP-10G',   name: '10G SFP Module',               sell: 0, buy: 0 },
];
const getProduct = id => PRODUCTS.find(p => p.id === id);
const getUser = () => ({ id: 'u1', name: 'Jitendra', role: 'Purchase' });

// Line 1 is TWO sets of {4 switches, 2 PSUs} -> 8 switches, 4 PSUs
// Line 2 is one set of {6 SFPs}
const baseSO = () => ({
  id: 'so-1', so_no: 'SO/FY26/0001', customer_id: 'c1', status: 'Approved',
  lines: [
    { id: 'l1', bundle_qty: 2, unit_price: 500000,
      customer_ref: { po_sr: '1', equip: 'Core switching', group: 'Group A' },
      components: [
        { product_id: 'p-sw',  qty: 4, sell: 100000, customer_ref: { sr: '1.1', code: 'CS-24', desc: 'CORE SWITCH 24P' } },
        { product_id: 'p-psu', qty: 2, sell: 50000,  customer_ref: { sr: '1.2', code: 'PSU-2K', desc: 'REDUNDANT PSU 2KW' } },
      ] },
    { id: 'l2', bundle_qty: 1, unit_price: 120000,
      customer_ref: { po_sr: '2', equip: 'Optics' },
      components: [
        { product_id: 'p-sfp', qty: 6, sell: 20000, customer_ref: { sr: '2.1', code: 'OPT-10G', desc: '10G OPTICAL MODULE' } },
      ] },
  ],
  invoices: [],
});
// 8 x 100000 + 4 x 50000 + 6 x 20000 = 1,120,000
const stateWith = (so, dispatched) => ({
  products: PRODUCTS, sales_orders: [so], vendor_pos: [], grns: [], pool: [],
  notifications: [], audit: [], outward_dispatches: (dispatched || []).map((items, i) => ({
    id: 'dc' + i, so_id: so.id, dc_no: 'DC20260900' + (i + 1), items,
  })),
});
const boq = (id, no, items, extra) => Object.assign(
  { id, no, date: '2026-09-04', status: 'Open', items }, extra || {});
const withBoqs = (so, boqs) => ({ ...so, extra: { ...(so.extra || {}), boqs } });

console.log('\n[1] the BOM is expanded to what is actually billable');
const rows = sandbox.boqOrderRows(baseSO());
check('one row per (line, item), not per line', rows.length, 3);
check('quantity is per-set x sets, not the per-set figure',
  rows.map(r => [r.product_id, r.qty]), [['p-sw', 8], ['p-psu', 4], ['p-sfp', 6]]);
check('rows carry the customer PO grouping so a whole group can be ticked at once',
  rows.map(r => r.groupKey), ['po:1', 'po:1', 'po:2']);
check('a row is keyed by line AND item, so the same item in two bundles stays separable',
  rows.map(r => r.key), ['l1|p-sw', 'l1|p-psu', 'l2|p-sfp']);

console.log('\n[2] a unit committed to one BOQ cannot be claimed by another');
const so2 = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [{ line_id: 'l1', product_id: 'p-sw', qty: 5 }]),
]);
const avail = sandbox.boqAvailable(so2, null);
check('5 of the 8 switches are spoken for', avail.find(r => r.product_id === 'p-sw').taken, 5);
check('only 3 are free for the next BOQ', avail.find(r => r.product_id === 'p-sw').available, 3);
check('untouched items are entirely free', avail.find(r => r.product_id === 'p-sfp').available, 6);
check('editing a BOQ ignores its own claim, so its units stay editable',
  sandbox.boqAvailable(so2, 'b1').find(r => r.product_id === 'p-sw').available, 8);
const cancelled = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [{ line_id: 'l1', product_id: 'p-sw', qty: 5 }], { status: 'Cancelled' }),
]);
check('a cancelled BOQ releases what it held',
  sandbox.boqAvailable(cancelled, null).find(r => r.product_id === 'p-sw').available, 8);

console.log('\n[3] SEVEN OF TEN IS NOT BILLED - the rule this feature exists for');
const tenSO = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [
    { line_id: 'l1', product_id: 'p-sw', qty: 8 },
    { line_id: 'l1', product_id: 'p-psu', qty: 2 },
  ]),
]);
const short = sandbox.boqProgress(
  stateWith(tenSO, [[{ product_id: 'p-sw', qty: 7 }, { product_id: 'p-psu', qty: 2 }]]), tenSO)[0];
check('one switch short leaves it incomplete', short.complete, false);
check('and therefore not ready to invoice', short.readyToInvoice, false);
check('progress is still shown honestly, so nobody thinks it is stuck', short.pct, 90);
const done = sandbox.boqProgress(
  stateWith(tenSO, [[{ product_id: 'p-sw', qty: 8 }, { product_id: 'p-psu', qty: 2 }]]), tenSO)[0];
check('the last unit completes it', done.complete, true);
check('and it becomes ready to invoice', done.readyToInvoice, true);
const over = sandbox.boqProgress(
  stateWith(tenSO, [[{ product_id: 'p-sw', qty: 20 }, { product_id: 'p-psu', qty: 9 }]]), tenSO)[0];
check('over-dispatch does not inflate what the BOQ counts as received', over.got, 10);

console.log('\n[4] dispatches are allocated oldest BOQ first');
// Both BOQs want switches. Six arrive: 001 needs 5, 002 needs 3.
const twoSO = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [{ line_id: 'l1', product_id: 'p-sw', qty: 5 }]),
  boq('b2', 'BOQ202609002', [{ line_id: 'l1', product_id: 'p-sw', qty: 3 }]),
]);
const prog = sandbox.boqProgress(stateWith(twoSO, [[{ product_id: 'p-sw', qty: 6 }]]), twoSO);
check('the first BOQ is filled completely', [prog[0].got, prog[0].complete], [5, true]);
check('the second gets only the leftover and waits', [prog[1].got, prog[1].complete], [1, false]);
check('so exactly one invoice is due, not two',
  prog.filter(b => b.readyToInvoice).map(b => b.no), ['BOQ202609001']);
const allIn = sandbox.boqProgress(stateWith(twoSO, [[{ product_id: 'p-sw', qty: 8 }]]), twoSO);
check('when everything arrives both become due, in order',
  allIn.filter(b => b.readyToInvoice).map(b => b.no), ['BOQ202609001', 'BOQ202609002']);

console.log('\n[5] an order carries as many BOQs as it needs');
const many = withBoqs(baseSO(), Array.from({ length: 8 }, (_, i) =>
  boq('b' + i, 'BOQ20260900' + (i + 1), [{ line_id: 'l2', product_id: 'p-sfp', qty: 0.75 }])));
check('eight BOQs on one order all track', sandbox.boqProgress(stateWith(many, []), many).length, 8);
check('together they may not exceed what the order holds',
  sandbox.boqAvailable(many, null).find(r => r.product_id === 'p-sfp').available, 0);

console.log('\n[6] a complete BOQ bills, in the customer own wording, once');
const billSO = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [
    { line_id: 'l1', product_id: 'p-sw', qty: 8 },
    { line_id: 'l1', product_id: 'p-psu', qty: 4 },
  ]),
  boq('b2', 'BOQ202609002', [{ line_id: 'l2', product_id: 'p-sfp', qty: 6 }]),
]);
const st6 = stateWith(billSO, [[{ product_id: 'p-sw', qty: 8 }, { product_id: 'p-psu', qty: 4 }]]);
const ready6 = sandbox.boqProgress(st6, billSO).filter(b => b.readyToInvoice);
check('only the completed BOQ is due', ready6.map(b => b.no), ['BOQ202609001']);
const inv1 = sandbox.buildBoqInvoice(billSO, st6, ready6[0], 'u1', getUser, getProduct);
check('an invoice is raised', !!inv1, true);
check('it bills 8 switches + 4 PSUs = 1,000,000', inv1.invoice.subtotal, 1000000);
check('it is Partial, because the SFP BOQ has not shipped', inv1.invoice.type, 'Partial');
check('every line carries the customer wording, not ours',
  inv1.invoice.lines.map(l => l.cust_label), ['CORE SWITCH 24P', 'REDUNDANT PSU 2KW']);
check('their own item code travels with it, so they can match their PO',
  inv1.invoice.lines.map(l => l.cust_code), ['CS-24', 'PSU-2K']);
check('and our own code is kept alongside, for the warehouse',
  inv1.invoice.lines.map(l => l.our_code), ['C9300-24T', 'PWR-2KWAC']);
check('the invoice is stamped with the BOQ it settles', inv1.invoice.boq_no, 'BOQ202609001');
check('the BOQ is stamped back, so it can never bill twice',
  sandbox.soBoqs(inv1.so).find(b => b.id === 'b1').invoice_no, inv1.invoice.no);
check('a second attempt on the same BOQ raises nothing',
  sandbox.buildBoqInvoice(inv1.so, { ...st6, sales_orders: [inv1.so] },
    sandbox.boqProgress(st6, inv1.so)[0], 'u1', getUser, getProduct), null);
check('the invoice number follows the client scheme, off the SO number',
  /^INVSOFY260001/.test(inv1.invoice.no), true);

console.log('\n[7] the last BOQ closes the order');
const so7 = inv1.so;
const st7 = stateWith(so7, [[{ product_id: 'p-sw', qty: 8 }, { product_id: 'p-psu', qty: 4 },
                             { product_id: 'p-sfp', qty: 6 }]]);
st7.sales_orders = [so7];
const ready7 = sandbox.boqProgress(st7, so7).filter(b => b.readyToInvoice);
check('now the SFP BOQ is due', ready7.map(b => b.no), ['BOQ202609002']);
const inv2 = sandbox.buildBoqInvoice(so7, st7, ready7[0], 'u1', getUser, getProduct);
check('it bills the remaining 120,000', inv2.invoice.subtotal, 120000);
check('and is typed Final, because nothing is left to bill', inv2.invoice.type, 'Final');
check('the order is marked Invoiced', inv2.so.status, 'Invoiced');
check('the two invoices together equal the order, never more',
  inv2.so.invoices.reduce((a, i) => a + i.subtotal, 0), 1120000);
check('no extra closing invoice when the BOQs covered everything',
  sandbox.buildBoqFinalInvoice(inv2.so, { ...st7, sales_orders: [inv2.so] }, 'u1', getUser, getProduct), null);

console.log('\n[8] items left out of every BOQ are swept into a Final invoice');
// Only the switches are put in a BOQ. The PSUs and SFPs belong to no BOQ.
const partSO = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [{ line_id: 'l1', product_id: 'p-sw', qty: 8 }]),
]);
const st8 = stateWith(partSO, [[{ product_id: 'p-sw', qty: 8 }, { product_id: 'p-psu', qty: 4 }]]);
const b8 = sandbox.buildBoqInvoice(partSO, st8, sandbox.boqProgress(st8, partSO)[0], 'u1', getUser, getProduct);
check('the BOQ bills its switches', b8.invoice.subtotal, 800000);
const st8b = { ...st8, sales_orders: [b8.so] };
const fin = sandbox.buildBoqFinalInvoice(b8.so, st8b, 'u1', getUser, getProduct);
check('every BOQ has fired, so the remainder is swept up', !!fin, true);
check('it bills the 4 dispatched PSUs and nothing else', fin.invoice.subtotal, 200000);
check('the 6 SFPs still in the godown are NOT billed',
  fin.invoice.lines.some(l => l.ref_id === 'p-sfp'), false);
check('it is Partial, because those SFPs are still owed', fin.invoice.type, 'Partial');
check('the sweep runs once only',
  sandbox.buildBoqFinalInvoice(fin.so, { ...st8, sales_orders: [fin.so] }, 'u1', getUser, getProduct), null);

console.log('\n[9] an open BOQ holds the close back');
const openSO = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [{ line_id: 'l1', product_id: 'p-sw', qty: 8 }], { invoice_no: 'INVSOFY260001' }),
  boq('b2', 'BOQ202609002', [{ line_id: 'l2', product_id: 'p-sfp', qty: 6 }]),
]);
const st9 = stateWith(openSO, [[{ product_id: 'p-psu', qty: 4 }]]);
check('one BOQ still unbilled -> no Final invoice, even with stock dispatched',
  sandbox.buildBoqFinalInvoice(openSO, st9, 'u1', getUser, getProduct), null);

console.log('\n[10] the value shown on screen is the value that gets billed');
const vSO = withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', [
    { line_id: 'l1', product_id: 'p-sw', qty: 8 },
    { line_id: 'l1', product_id: 'p-psu', qty: 4 },
  ]),
]);
check('the panel figure matches the invoice subtotal exactly',
  sandbox.boqValue(vSO, sandbox.soBoqs(vSO)[0], getProduct), 1000000);

console.log('\n[11] BOQ numbers follow the one document-numbering scheme');
const numState = { sales_orders: [withBoqs(baseSO(), [
  boq('b1', 'BOQ202609001', []), boq('b2', 'BOQ202609002', []),
])] };
check('the next number continues from what exists',
  sandbox.boqNo(numState, '2026-09-04'), 'BOQ202609003');
check('a new month restarts the sequence',
  sandbox.boqNo(numState, '2026-10-01'), 'BOQ202610001');
check('an order with no BOQs starts at 001',
  sandbox.boqNo({ sales_orders: [baseSO()] }, '2026-09-04'), 'BOQ202609001');

console.log('\n[12] the screens are wired up');
check('the create dialog is registered', typeof sandbox.CreateBOQModal, 'function');
check('the panel is registered', typeof sandbox.BOQPanel, 'function');
check('the dispatch path can reach the biller', typeof sandbox.invoiceReadyBoqs, 'function');
const soJsx = fs.readFileSync(path.join(dir, 'src', 'screens-so.jsx'), 'utf8');
check('the panel sits with the bill of materials on the order page',
  /BOQPanel\s+so=\{so\}/.test(soJsx), true);
const scm = fs.readFileSync(path.join(dir, 'src', 'screens-scm.jsx'), 'utf8');
check('a dispatch triggers BOQ billing', /invoiceReadyBoqs\(/.test(scm), true);
check('an order with no BOQ still bills per challan, as it always did',
  /raiseDispatchInvoice\(/.test(scm), true);

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - a BOQ bills when it is complete, once, and never twice');
process.exit(bad ? 1 : 0);
