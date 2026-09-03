#!/usr/bin/env node
/**
 * OP Central — document numbering check
 * ---------------------------------------------------------------------------
 * Every document number in the system is built in one place. This asserts the
 * format, and — more importantly — that numbers cannot collide.
 *
 *   Vendor PO          PO202609001     prefix + year + month + sequence
 *   Delivery challan   DC202609001     same shape
 *   Vendor invoice     INV202609001    the PO's own number, re-prefixed
 *   PO e-Bill          EB202609001     likewise
 *   Client invoice     INV<SO number>  the customer's own order reference
 *
 * Collisions are what this is really for: two POs raised in one action once
 * shared an e-Bill number, and a duplicate on a document sent to a vendor or a
 * customer is not a cosmetic problem.
 *
 * Usage: node scripts/uitest/numbering-check.js [path-to-frontend]
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
vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, 'src', 'utils.jsx'), 'utf8'),
  { presets: ['react'], filename: 'utils.jsx' }).code, sandbox, { filename: 'utils.jsx' });

const { docNo, vendorPoNo, challanNo, vendorInvoiceNo, poEbillNoFor, clientInvoiceNo, docStem } = sandbox;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

console.log('\n[1] the shape');
check('the first PO of the month', vendorPoNo({ vendor_pos: [] }, '2026-09-03'), 'PO202609001');
check('the next one continues',
  vendorPoNo({ vendor_pos: [{ po_no: 'PO202609001' }] }, '2026-09-03'), 'PO202609002');
check('it continues from the HIGHEST, not the count',
  vendorPoNo({ vendor_pos: [{ po_no: 'PO202609007' }] }, '2026-09-03'), 'PO202609008');
check('a new month starts again at 001',
  vendorPoNo({ vendor_pos: [{ po_no: 'PO202609042' }] }, '2026-10-01'), 'PO202610001');
check('a new year too',
  vendorPoNo({ vendor_pos: [{ po_no: 'PO202612009' }] }, '2027-01-04'), 'PO202701001');
check('delivery challans use the same shape',
  challanNo({ outward_dispatches: [{ dc_no: 'DC202609004' }] }, '2026-09-03'), 'DC202609005');
check('another month\'s numbers do not affect this one',
  vendorPoNo({ vendor_pos: [{ po_no: 'PO202608099' }] }, '2026-09-03'), 'PO202609001');

console.log('\n[2] a PO, its e-Bill and its vendor invoice read together');
check('vendor invoice', vendorInvoiceNo('PO202609001'), 'INV202609001');
check('PO e-Bill', poEbillNoFor('PO202609001'), 'EB202609001');
check('two different POs give two different e-Bills',
  poEbillNoFor('PO202609043') !== poEbillNoFor('PO202609044'), true);
check('the same PO always gives the same e-Bill',
  poEbillNoFor('PO202609044'), poEbillNoFor('PO202609044'));
check('an old-format PO still yields something usable',
  vendorInvoiceNo('VPO/FY26/0044'), 'INVVPOFY260044');

console.log('\n[3] the client invoice carries THEIR order number');
check('separators are stripped', clientInvoiceNo('ABG/2026/0117', []), 'INVABG20260117');
check('so are dashes', clientInvoiceNo('ABG-2026-0117', []), 'INVABG20260117');
check('and spaces', clientInvoiceNo(' abg 2026 0117 ', []), 'INVABG20260117');
check('a second invoice on the same order is suffixed',
  clientInvoiceNo('ABG/2026/0117', ['INVABG20260117']), 'INVABG20260117-2');
check('and a third',
  clientInvoiceNo('ABG/2026/0117', ['INVABG20260117', 'INVABG20260117-2']), 'INVABG20260117-3');
check('a different order is unaffected',
  clientInvoiceNo('ABG/2026/0118', ['INVABG20260117']), 'INVABG20260118');

console.log('\n[4] nothing can collide');
// Ten POs raised in one action, each aware of the ones before it.
const issued = [];
for (let i = 0; i < 10; i++) {
  issued.push(vendorPoNo({ vendor_pos: issued.map(n => ({ po_no: n })) }, '2026-09-03'));
}
check('ten POs in one action are ten different numbers', new Set(issued).size, 10);
check('...running in order', [issued[0], issued[9]], ['PO202609001', 'PO202609010']);
check('...and their e-Bills are ten different numbers too',
  new Set(issued.map(poEbillNoFor)).size, 10);
check('...as are their vendor invoices',
  new Set(issued.map(vendorInvoiceNo)).size, 10);

// Ten invoices against ONE order.
let invs = [];
for (let i = 0; i < 10; i++) invs.push(clientInvoiceNo('ABG/2026/0117', invs));
check('ten invoices on one order are ten different numbers', new Set(invs).size, 10);
check('...the first being the plain one', invs[0], 'INVABG20260117');

console.log('\n[5] it survives odd input');
check('a blank existing list is fine', docNo('PO', [], '2026-09-03'), 'PO202609001');
check('rubbish in the existing list is ignored',
  docNo('PO', [null, '', 'not-a-number', 'PO'], '2026-09-03'), 'PO202609001');
check('lower case is normalised', docStem('abg/2026/0117'), 'ABG20260117');
check('past 999 it keeps counting rather than wrapping',
  docNo('PO', ['PO202609999'], '2026-09-03'), 'PO2026091000');

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - every document number is unique and reads with its siblings');
process.exit(bad ? 1 : 0);
