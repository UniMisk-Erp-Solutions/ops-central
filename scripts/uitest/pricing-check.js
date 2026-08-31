#!/usr/bin/env node
/**
 * OP Central — pricing & profit check
 * ---------------------------------------------------------------------------
 * Prices get quoted to customers, so the arithmetic behind them has to be
 * right and the provenance has to be honest. This covers:
 *
 *   cascade  — typing a price on a bundle spreads it over the items inside,
 *              and typing prices on the items rolls back up to the bundle
 *   cost     — what we actually last paid beats the catalogue figure, and a
 *              rejected PO is never treated as a price we paid
 *   profit   — revenue vs vendor cost, with COMMITTED (real POs) kept separate
 *              from ESTIMATED, and anything uncostable flagged rather than
 *              quietly counted as free
 *
 * Usage: node scripts/uitest/pricing-check.js [path-to-frontend]
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
sandbox.React = { createElement: () => null, Fragment: 'F', useState: () => [null, () => {}],
  useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({ current: null }),
  useCallback: (f) => f, useContext: () => null, createContext: () => ({ Provider: 'P' }) };
sandbox.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} };
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
vm.createContext(sandbox);
for (const f of ['utils.jsx', 'screens-so.jsx']) {
  vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, 'src', f), 'utf8'),
    { presets: ['react'], filename: f }).code, sandbox, { filename: f });
}
const { compSellOf, lineSellOf, spreadLinePrice, soProfit, itemCost, lastBuyOf } = sandbox;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

const PRODUCTS = [
  { id: 'p-chassis', code: 'C9606R', name: 'Chassis', buy: 100000, sell: 0 },
  { id: 'p-psu', code: 'PWR', name: 'Power supply', buy: 20000, sell: 0 },
  { id: 'p-lic', code: 'LIC', name: 'Licence', buy: 0, sell: 0 },   // never purchased
];
const getProduct = id => PRODUCTS.find(p => p.id === id);

console.log('\n[1] a price typed on the BUNDLE spreads over the items inside');
let comps = [{ product_id: 'p-chassis', qty: 1 }, { product_id: 'p-psu', qty: 4 }];
let out = spreadLinePrice(comps, 200000, getProduct);
check('nothing was priced, so the main item carries it', out.map(c => c.sell), [200000, 0]);
check('...and the bundle totals what was typed', lineSellOf(out, getProduct), 200000);

console.log('\n[2] once items ARE priced, the bundle scales them proportionally');
comps = [{ product_id: 'p-chassis', qty: 1, sell: 150000 }, { product_id: 'p-psu', qty: 1, sell: 50000 }];
check('starting total', lineSellOf(comps, getProduct), 200000);
out = spreadLinePrice(comps, 300000, getProduct);
check('each item scaled by the same factor', out.map(c => c.sell), [225000, 75000]);
check('the new total is what was typed', lineSellOf(out, getProduct), 300000);
check('the 75/25 split the buyer agreed is preserved',
  Math.round(out[0].sell / lineSellOf(out, getProduct) * 100), 75);

console.log('\n[3] quantities are respected when rolling up');
check('4 power supplies at 20000 = 80000',
  lineSellOf([{ product_id: 'p-psu', qty: 4, sell: 20000 }], getProduct), 80000);
check('an unpriced component falls back to the catalogue price',
  compSellOf({ product_id: 'p-chassis', qty: 1 }, { sell: 5555 }), 5555);
check('an explicit zero is a real price, not "unset"',
  compSellOf({ product_id: 'p-lic', qty: 1, sell: 0 }, { sell: 999 }), 0);

console.log('\n[4] cost: what we actually paid beats the catalogue');
const STATE = {
  products: PRODUCTS,
  vendor_pos: [
    { id: 'po1', po_no: 'VPO/0001', so_id: 'so-1', vendor_id: 'v1', date: '2026-02-01', status: 'Issued',
      items: [{ product_id: 'p-chassis', qty: 1, rate: 90000 }] },
    { id: 'po2', po_no: 'VPO/0002', so_id: 'so-1', vendor_id: 'v2', date: '2026-06-01', status: 'Rejected',
      items: [{ product_id: 'p-chassis', qty: 1, rate: 500000 }] },
  ],
};
check('the real purchase price wins over the catalogue', itemCost(STATE, 'p-chassis'), { cost: 90000, source: 'actual', po_no: 'VPO/0001', date: '2026-02-01' });
check('a REJECTED PO is never treated as a price we paid', itemCost(STATE, 'p-chassis').cost !== 500000, true);
check('never purchased falls back to the catalogue cost', itemCost(STATE, 'p-psu'), { cost: 20000, source: 'catalogue' });
check('no cost anywhere is reported as none, not as zero-cost',
  itemCost(STATE, 'p-lic'), { cost: 0, source: 'none' });

console.log('\n[5] profit: committed cost and estimated cost stay separate');
const SO = {
  id: 'so-1', so_no: 'SO/1', lines: [
    { id: 'l1', bundle_qty: 1, unit_price: 300000,
      components: [{ product_id: 'p-chassis', qty: 1, sell: 250000 },
                   { product_id: 'p-psu', qty: 2, sell: 25000 }] },
  ],
};
let f = soProfit(STATE, SO, getProduct);
check('revenue is the order value', f.revenue, 300000);
check('committed = the real PO already raised', f.committed, 90000);
check('estimated = 2 power supplies still to buy at 20000', f.estimated, 40000);
check('cost is the two added', f.cost, 130000);
check('profit', f.profit, 170000);
check('margin %', Math.round(f.margin * 10) / 10, 56.7);
check('nothing uncostable, so the figure is complete', f.complete, true);

console.log('\n[6] an item we cannot cost makes the figure PROVISIONAL');
const SO2 = { id: 'so-1', so_no: 'SO/1', lines: [
  { id: 'l1', bundle_qty: 1, unit_price: 300000,
    components: [{ product_id: 'p-chassis', qty: 1, sell: 250000 },
                 { product_id: 'p-lic', qty: 3, sell: 50000 }] },
] };
f = soProfit(STATE, SO2, getProduct);
check('the licence is flagged, not silently costed at zero', f.unknownItems, 1);
check('...and its units are counted', f.unknownUnits, 3);
check('the panel must call the figure provisional', f.complete, false);
check('cost only counts what is actually known', f.cost, 90000);

console.log('\n[7] a loss is reported as a loss');
const SO3 = { id: 'so-1', so_no: 'SO/1', lines: [
  { id: 'l1', bundle_qty: 1, unit_price: 50000,
    components: [{ product_id: 'p-chassis', qty: 1, sell: 50000 }] },
] };
f = soProfit(STATE, SO3, getProduct);
check('selling below cost gives a negative profit', f.profit, -40000);
check('...and a negative margin', f.margin < 0, true);

console.log(bad ? `\nFAILED — ${bad} check(s)` : '\nPASS — pricing, cost and profit all hold');
process.exit(bad ? 1 : 0);
