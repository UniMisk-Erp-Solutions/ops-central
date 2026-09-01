#!/usr/bin/env node
/**
 * OP Central — sales order status check
 * ---------------------------------------------------------------------------
 * The lifecycle strip only ever moved when somebody clicked an approval-gate
 * button, and the three places that did advance it were gated on the order being
 * exactly 'Approved'. An imported order is created as Draft and never approved,
 * so it sat on Draft for ever — with purchase orders raised, goods received and
 * an invoice issued against it.
 *
 * Status is now derived from the facts. This asserts it moves forward as things
 * actually happen, never backwards, and never over a decision a person made.
 *
 * Usage: node scripts/uitest/status-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React;
try { Babel = require('@babel/standalone'); React = require('react'); }
catch (e) { console.error('Missing dev deps. Run: npm i --no-save @babel/standalone react'); process.exit(2); }

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
vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, 'src', 'utils.jsx'), 'utf8'),
  { presets: ['react'], filename: 'utils.jsx' }).code, sandbox, { filename: 'utils.jsx' });

const { soDerivedStatus, soEffectiveStatus, soAdvanceStatus } = sandbox;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

// An order needing 1 chassis and 4 power supplies.
const baseSO = () => ({
  id: 'so-1', so_no: 'SO/FY26/0001', status: 'Draft', invoices: [],
  lines: [{ id: 'l1', bundle_qty: 1, unit_price: 300000, components: [
    { product_id: 'p-chassis', qty: 1 }, { product_id: 'p-psu', qty: 4 },
  ] }],
});
const st = (over) => Object.assign({
  vendor_pos: [], grns: [], outward_dispatches: [], payments: [], products: [],
}, over || {});

const PO = { id: 'po-1', po_no: 'VPO/1', so_id: 'so-1', status: 'Issued',
  items: [{ product_id: 'p-chassis', qty: 1, rate: 0 }, { product_id: 'p-psu', qty: 4, rate: 0 }] };

console.log('\n[1] the strip follows what actually happened');
let so = baseSO();
check('nothing done yet, so the stored status stands', soEffectiveStatus(st(), so), 'Draft');

check('a purchase order exists -> Procurement Started',
  soEffectiveStatus(st({ vendor_pos: [PO] }), so), 'Procurement Started');

const partGRN = { id: 'g1', po_id: 'po-1', items: [{ product_id: 'p-chassis', accepted: 1 }] };
check('some goods in -> Material Received',
  soEffectiveStatus(st({ vendor_pos: [PO], grns: [partGRN] }), so), 'Material Received');

const fullGRN = { id: 'g2', po_id: 'po-1',
  items: [{ product_id: 'p-chassis', accepted: 1 }, { product_id: 'p-psu', accepted: 4 }] };
check('everything in -> Ready to Dispatch',
  soEffectiveStatus(st({ vendor_pos: [PO], grns: [fullGRN] }), so), 'Ready to Dispatch');

const dc1 = { id: 'dc-1', so_id: 'so-1', items: [{ product_id: 'p-chassis', qty: 1 }] };
check('one challan out -> Partially Delivered',
  soEffectiveStatus(st({ vendor_pos: [PO], grns: [fullGRN], outward_dispatches: [dc1] }), so),
  'Partially Delivered');

const dc2 = { id: 'dc-2', so_id: 'so-1', items: [{ product_id: 'p-psu', qty: 4 }] };
check('everything out -> Fully Delivered',
  soEffectiveStatus(st({ vendor_pos: [PO], grns: [fullGRN], outward_dispatches: [dc1, dc2] }), so),
  'Fully Delivered');

console.log('\n[2] money moves it the rest of the way');
const invSO = Object.assign(baseSO(), { invoices: [{ no: 'INV/1', total: 354000 }] });
check('an invoice raised -> Invoiced',
  soEffectiveStatus(st({ vendor_pos: [PO], grns: [fullGRN] }), invSO), 'Invoiced');
check('part paid -> Payment Pending',
  soEffectiveStatus(st({ vendor_pos: [PO], payments: [{ so_id: 'so-1', amount: 100000 }] }), invSO),
  'Payment Pending');
check('paid in full -> Fully Paid',
  soEffectiveStatus(st({ vendor_pos: [PO], payments: [{ so_id: 'so-1', amount: 354000 }] }), invSO),
  'Fully Paid');

console.log('\n[3] it never goes backwards, and never overrides a person');
check('a stored status further along is kept',
  soEffectiveStatus(st({ vendor_pos: [PO] }), Object.assign(baseSO(), { status: 'Fully Delivered' })),
  'Fully Delivered');
['Cancelled', 'Rejected', 'Closed'].forEach(m => {
  check(`${m} is left exactly as it is`,
    soEffectiveStatus(st({ vendor_pos: [PO], grns: [fullGRN] }), Object.assign(baseSO(), { status: m })), m);
});
check('advancing to an unknown stage is refused',
  soAdvanceStatus('Approved', 'Nonsense'), 'Approved');
check('advancing backwards is refused',
  soAdvanceStatus('Invoiced', 'Draft'), 'Invoiced');

console.log('\n[4] a rejected purchase order does not count as procurement');
check('a Rejected PO leaves the order on Draft',
  soEffectiveStatus(st({ vendor_pos: [Object.assign({}, PO, { status: 'Rejected' })] }), baseSO()),
  'Draft');

console.log('\n[5] pool stock counts as received, because it is');
check('stock pulled from the surplus pool advances the order',
  soEffectiveStatus(st({ vendor_pos: [PO] }),
    Object.assign(baseSO(), { pool_alloc: [{ product_id: 'p-chassis', qty: 1 }] })),
  'Material Received');

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - the status strip tells the truth');
process.exit(bad ? 1 : 0);
