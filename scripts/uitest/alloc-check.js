#!/usr/bin/env node
/**
 * OP Central — vendor allocation check
 * ---------------------------------------------------------------------------
 * A 100-line BOQ has to be assigned to vendors and priced in a handful of
 * clicks, and the shortcuts that make that possible are exactly the places
 * where quantities can quietly go wrong. This checks the three that matter:
 *
 *   grouping   — rows collapse onto the customer's own "Po SR No", so ONE
 *                dropdown covers a whole group
 *   history    — the vendor and rate we last used are offered, per vendor
 *   remainder  — what is already on a purchase order is never offered twice
 *
 * Usage: node scripts/uitest/alloc-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel;
try { Babel = require('@babel/standalone'); }
catch (e) { console.error('Missing dev dep. Run: npm i --no-save @babel/standalone'); process.exit(2); }

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');
const sandbox = { console: { log() {}, warn() {}, error() {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
// utils.jsx destructures these off React at load time, so the stub has to
// carry every one it names — not just the hooks this test happens to call.
sandbox.React = { createElement: () => null, Fragment: 'F',
  useState: () => [null, () => {}], useEffect: () => {}, useMemo: (f) => f(),
  useRef: () => ({ current: null }), useCallback: (f) => f,
  useContext: () => null, createContext: () => ({ Provider: 'P' }) };
vm.createContext(sandbox);
// utils.jsx first: the cost lookup lives there now, and screens-alloc.jsx
// delegates to it rather than keeping a second copy.
sandbox.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} };
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
// screens-so.jsx defines compSellOf / lineSellOf, which the allocator uses to
// read and roll up client prices.
for (const f of ['utils.jsx', 'screens-so.jsx', 'screens-alloc.jsx']) {
  vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, 'src', f), 'utf8'),
    { presets: ['react'], filename: f }).code, sandbox, { filename: f });
}

const { allocBuildRows, allocLastBuy } = sandbox;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

// An order shaped exactly as the importer produces one: two PO groups from the
// sheet, the second being 6 identical sets.
const SO = {
  id: 'so-1', so_no: 'SO/FY26/0001', customer_id: 'c1', lines: [
    { id: 'l1', bundle_qty: 1, client_name: 'Cisco Catalyst 9600 Chassis',
      customer_ref: { po_sr: '1', group: 'Group A: Core Switch', equip: 'Cisco Catalyst 9600 Chassis' },
      components: [
        { product_id: 'p-chassis', qty: 1 },
        { product_id: 'p-psu', qty: 4 },
        { product_id: 'p-ssd-none', qty: 1 },
      ] },
    { id: 'l2', bundle_qty: 20, client_name: 'SFP Module',
      customer_ref: { po_sr: '1', group: 'Group A: Core Switch', equip: 'Cisco Catalyst 9600 Chassis' },
      components: [{ product_id: 'p-sfp', qty: 1 }] },
    { id: 'l3', bundle_qty: 6, client_name: '24 Port',
      customer_ref: { po_sr: '2', group: 'Group B: Distribution Switch', equip: '24 Port' },
      components: [
        { product_id: 'p-9300', qty: 1 },
        { product_id: 'p-ssd-none', qty: 1 },   // the SAME item as in group A
      ] },
  ],
};

const STATE_EMPTY = { vendor_pos: [], vendors: [] };

console.log('\n[1] the sheet\'s own PO grouping drives the screen');
let rows = allocBuildRows(STATE_EMPTY, SO);
const groups = [...new Set(rows.map(r => r.groupKey))];
check('two groups, from Po SR No — not one per line', groups, ['po:1', 'po:2']);
check('group A holds chassis, psu, ssd and the SFP line',
  rows.filter(r => r.groupKey === 'po:1').length, 4);
check('group label names the customer\'s own PO',
  rows[0].groupLabel, 'PO Sr 1 · Group A: Core Switch');
check('one dropdown per group covers every line in it',
  groups.length, 2);

console.log('\n[2] quantities are the real ones');
const qty = (pid, gk) => rows.filter(r => r.product_id === pid && (!gk || r.groupKey === gk))
  .reduce((a, r) => a + r.qty, 0);
check('4 power supplies in one chassis', qty('p-psu'), 4);
check('20 SFPs (20 sets of 1)', qty('p-sfp'), 20);
check('6 switches (6 sets of 1)', qty('p-9300'), 6);
check('the shared item keeps BOTH groups separate',
  [qty('p-ssd-none', 'po:1'), qty('p-ssd-none', 'po:2')], [1, 6]);
check('...and 7 in total', qty('p-ssd-none'), 7);

console.log('\n[3] what we last bought is offered back');
const STATE_HIST = {
  vendors: [{ id: 'v1', name: 'Alpha' }, { id: 'v2', name: 'Beta' }],
  vendor_pos: [
    { id: 'po-old', po_no: 'VPO/0001', so_id: 'so-0', vendor_id: 'v1', date: '2026-01-10',
      status: 'Issued', items: [{ product_id: 'p-psu', qty: 2, rate: 40000 }] },
    { id: 'po-new', po_no: 'VPO/0002', so_id: 'so-0', vendor_id: 'v2', date: '2026-03-01',
      status: 'Issued', items: [{ product_id: 'p-psu', qty: 2, rate: 38000 }] },
    { id: 'po-rej', po_no: 'VPO/0003', so_id: 'so-0', vendor_id: 'v1', date: '2026-06-01',
      status: 'Rejected', items: [{ product_id: 'p-psu', qty: 2, rate: 99999 }] },
  ],
};
check('the most recent purchase wins', allocLastBuy(STATE_HIST, 'p-psu', null).po_no, 'VPO/0002');
check('...at its rate', allocLastBuy(STATE_HIST, 'p-psu', null).rate, 38000);
check('a rejected PO is never used as a price', allocLastBuy(STATE_HIST, 'p-psu', null).rate !== 99999, true);
check('asking for ONE vendor gives THAT vendor\'s last price',
  allocLastBuy(STATE_HIST, 'p-psu', 'v1').rate, 40000);
check('an item never bought has no history', allocLastBuy(STATE_HIST, 'p-chassis', null), null);

console.log('\n[4] what is already ordered is not offered again');
const STATE_PARTIAL = {
  vendors: [], vendor_pos: [
    { id: 'po-1', po_no: 'VPO/0009', so_id: 'so-1', vendor_id: 'v1', date: '2026-05-01',
      status: 'Issued', items: [{ product_id: 'p-sfp', qty: 12, rate: 100 }] },
  ],
};
rows = allocBuildRows(STATE_PARTIAL, SO);
check('12 of the 20 SFPs already ordered leaves 8',
  rows.filter(r => r.product_id === 'p-sfp').reduce((a, r) => a + r.qty, 0), 8);
check('untouched items are unaffected',
  rows.filter(r => r.product_id === 'p-psu').reduce((a, r) => a + r.qty, 0), 4);

const STATE_DONE = {
  vendors: [], vendor_pos: [
    { id: 'po-2', po_no: 'VPO/0010', so_id: 'so-1', vendor_id: 'v1', date: '2026-05-01', status: 'Issued',
      items: [{ product_id: 'p-chassis', qty: 1 }, { product_id: 'p-psu', qty: 4 },
              { product_id: 'p-ssd-none', qty: 7 }, { product_id: 'p-sfp', qty: 20 },
              { product_id: 'p-9300', qty: 6 }] },
  ],
};
check('a fully ordered SO offers nothing', allocBuildRows(STATE_DONE, SO).length, 0);

console.log('\n[5] stock taken from the surplus pool is not re-bought');
const SO_POOLED = { ...SO, pool_alloc: [{ product_id: 'p-psu', qty: 3 }] };
rows = allocBuildRows(STATE_EMPTY, SO_POOLED);
check('3 of the 4 power supplies came from the pool, so buy 1',
  rows.filter(r => r.product_id === 'p-psu').reduce((a, r) => a + r.qty, 0), 1);

console.log('\n[6] the client price rides along with the vendor price');
// Purchase now sets BOTH on this screen: what the vendor charges and what the
// customer pays. The second must land on the exact BOM component the sales
// order's own editor and profit panel read, or the margin silently disagrees.
const PRICED_SO = {
  id: 'so-p', so_no: 'SO/FY26/0003', customer_id: 'c1', lines: [
    { id: 'lA', bundle_qty: 1, unit_price: 0,
      customer_ref: { po_sr: '1', equip: 'Core Switch' },
      components: [
        { product_id: 'p-chassis', qty: 1, sell: 111 },
        { product_id: 'p-shared', qty: 1 },
      ] },
    { id: 'lB', bundle_qty: 6, unit_price: 0,
      customer_ref: { po_sr: '2', equip: '24 Port' },
      components: [
        { product_id: 'p-switch', qty: 1 },
        { product_id: 'p-shared', qty: 1 },   // the SAME item, in another bundle
      ] },
  ],
};
const PRODS = [
  { id: 'p-chassis', code: 'C9606R', name: 'Chassis', buy: 0, sell: 0 },
  { id: 'p-switch', code: 'C9300', name: 'Switch', buy: 0, sell: 0 },
  { id: 'p-shared', code: 'SSD-NONE', name: 'No SSD', buy: 0, sell: 0 },
];
const priceState = { vendor_pos: [], products: PRODS };
const pr = allocBuildRows(priceState, PRICED_SO);

check('a row exists per (order line, component)', pr.length, 4);
check('each row names the line it belongs to',
  pr.every(r => r.line_id === 'lA' || r.line_id === 'lB'), true);
check('an existing client price is carried in, not reset',
  pr.find(r => r.product_id === 'p-chassis').sell, 111);
check('an unpriced component starts at 0', pr.find(r => r.product_id === 'p-switch').sell, 0);
check('nothing is marked as edited on open',
  pr.some(r => r.sellTouched), false);

// The shared item appears in BOTH bundles and must stay two separate rows, so a
// price set on one cannot leak into the other.
const shared = pr.filter(r => r.product_id === 'p-shared');
check('an item in two bundles stays two rows', shared.length, 2);
check('...one per line', shared.map(r => r.line_id).sort(), ['lA', 'lB']);
check('...and their quantities differ (1 set vs 6)',
  shared.map(r => r.qty).sort((a, b) => a - b), [1, 6]);

console.log(bad ? `\nFAILED — ${bad} check(s)` : '\nPASS — grouping, history, remainders and client pricing all hold');
process.exit(bad ? 1 : 0);
