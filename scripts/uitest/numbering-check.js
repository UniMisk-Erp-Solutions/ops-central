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

console.log('\n[6] the e-Bill takes the vendor invoice number');
check('a PO, its invoice and its e-Bill are one number',
  [sandbox.vendorInvoiceNo('PO202609001'), sandbox.poEbillNoFor('PO202609001')],
  ['INV202609001', 'EB202609001']);

console.log('\n[7] quantities read as people write them');
check('1.0000 is 1', sandbox.qty(1.0000), '1');
check('the bundle-division residue is 1, not 1.0002', sandbox.qty((1 / 6) * 6), '1');
check('1.0002 is 1', sandbox.qty(1.0002), '1');
check('a real fraction survives', sandbox.qty(2.5), '2.5');
check('20 is 20', sandbox.qty(20), '20');
check('nothing is 0', sandbox.qty(null), '0');

console.log('\n[8] tax: the sign is the thing that matters');
const t = (amt, k, r) => sandbox.taxOn(amt, k, r);
check('CGST+SGST adds', [t(10000, 'cgst_sgst', 18).tax, t(10000, 'cgst_sgst', 18).total], [1800, 11800]);
check('IGST adds', [t(10000, 'igst', 18).tax, t(10000, 'igst', 18).total], [1800, 11800]);
check('TDS on labour is WITHHELD, not added',
  [t(10000, 'tds_labour', 2).tax, t(10000, 'tds_labour', 2).total], [-200, 9800]);
check('TDS on professional charges likewise',
  [t(10000, 'tds_prof', 10).tax, t(10000, 'tds_prof', 10).total], [-1000, 9000]);
check('TCS adds', [t(10000, 'tcs', 0.1).tax, t(10000, 'tcs', 0.1).total], [10, 10010]);
check('no tax leaves the amount alone', [t(10000, 'none').tax, t(10000, 'none').total], [0, 10000]);

console.log('\n[9] the tax column says what it is, in per cent');
check('a split tax shows both halves', sandbox.taxLabel('cgst_sgst', 18), 'CGST+SGST 9+9%');
check('...at any rate', sandbox.taxLabel('cgst_sgst', 5), 'CGST+SGST 2.5+2.5%');
check('IGST reads plainly', sandbox.taxLabel('igst', 18), 'IGST 18%');
check('TDS names which kind', sandbox.taxLabel('tds_prof', 10), 'TDS (Prof) 10%');
check('no tax shows a dash', sandbox.taxLabel('none', 0), '—');

console.log('\n[10] a PO can carry a different tax on every line');
const taxedPO = { po_no: 'PO202609001', tax_config: {
  default: { key: 'igst', rate: 18 },
  lines: { 'p-labour': { key: 'tds_labour', rate: 2 }, 'p-svc': { key: 'cgst_sgst', rate: 18 } },
} };
check('a line with its own tax uses it', sandbox.poLineTax(taxedPO, 'p-labour'), { key: 'tds_labour', rate: 2 });
check('another line, another tax', sandbox.poLineTax(taxedPO, 'p-svc'), { key: 'cgst_sgst', rate: 18 });
check('everything else falls to the PO default', sandbox.poLineTax(taxedPO, 'p-other'), { key: 'igst', rate: 18 });
check('a PO with no tax set at all still prints as it always did',
  sandbox.poLineTax({ po_no: 'PO1' }, 'p-x'), { key: 'igst', rate: 18 });

console.log('\n[11] the totals follow the lines, not a flat rate');
const lines = [
  { amount: 10000, key: 'igst', rate: 18 },       // +1800
  { amount: 20000, key: 'cgst_sgst', rate: 18 },  // +3600
  { amount: 5000, key: 'tds_labour', rate: 2 },   //  -100
];
const sum = lines.reduce((a, l) => {
  const c = t(l.amount, l.key, l.rate);
  return { base: a.base + l.amount, tax: a.tax + c.tax, total: a.total + c.total };
}, { base: 0, tax: 0, total: 0 });
check('taxable value', sum.base, 35000);
check('net tax, with the withholding netted off', sum.tax, 5300);
check('grand total', sum.total, 40300);
check('a flat 18% would have been wrong by', Math.round(35000 * 0.18) - sum.tax, 1000);

console.log('\n[12] several taxes on ONE line');
const many = sandbox.taxesOn(100000, [
  { key: 'igst', rate: 18 }, { key: 'tds_prof', rate: 10 }, { key: 'tcs', rate: 0.1 },
]);
check('each tax is listed separately', many.parts.map(p => p.label),
  ['IGST 18%', 'TDS (Prof) 10%', 'TCS 0.1%']);
check('each on the TAXABLE value, not on a running total',
  many.parts.map(p => p.amount), [18000, -10000, 100]);
check('the net is their sum, withholding included', many.tax, 8100);
check('and the total follows', many.total, 108100);
check('the label reads as one string', many.label, 'IGST 18% · TDS (Prof) 10% · TCS 0.1%');

console.log('\n[13] order of addition cannot change the answer');
const a = sandbox.taxesOn(100000, [{ key: 'igst', rate: 18 }, { key: 'tds_prof', rate: 10 }]);
const b = sandbox.taxesOn(100000, [{ key: 'tds_prof', rate: 10 }, { key: 'igst', rate: 18 }]);
check('GST then TDS equals TDS then GST', [a.tax, a.total], [b.tax, b.total]);
check('...which compounding would have broken', a.total, 108000);

console.log('\n[14] GST and TDS together, the common real case');
const gstTds = sandbox.taxesOn(50000, [{ key: 'cgst_sgst', rate: 18 }, { key: 'tds_labour', rate: 2 }]);
check('CGST+SGST adds 9000, TDS withholds 1000',
  gstTds.parts.map(p => p.amount), [9000, -1000]);
check('net 8000 on 50000', gstTds.tax, 8000);
check('payable 58000', gstTds.total, 58000);

console.log('\n[15] old configurations still read');
check('a single object becomes a one-item list',
  sandbox.normaliseTaxes({ key: 'igst', rate: 18 }), [{ key: 'igst', rate: 18 }]);
check('an explicit empty list is no tax', sandbox.normaliseTaxes([]), []);
check('"none" is dropped rather than charged at 0',
  sandbox.normaliseTaxes([{ key: 'none', rate: 0 }, { key: 'igst', rate: 18 }]),
  [{ key: 'igst', rate: 18 }]);
check('nothing at all is no tax', sandbox.normaliseTaxes(null), []);
check('a PO saved with the old single-tax shape still works',
  sandbox.poLineTaxes({ tax_config: { lines: { p1: { key: 'cgst_sgst', rate: 18 } } } }, 'p1'),
  [{ key: 'cgst_sgst', rate: 18 }]);

console.log('\n[16] the document foots each tax KIND separately');
const kindSum = sandbox.taxSummary([
  { amount: 100000, taxes: [{ key: 'igst', rate: 18 }] },
  { amount: 50000, taxes: [{ key: 'igst', rate: 18 }, { key: 'tds_prof', rate: 10 }] },
  { amount: 20000, taxes: [{ key: 'cgst_sgst', rate: 18 }] },
]);
check('one row per kind and rate', kindSum.map(x => x.label),
  ['IGST 18%', 'TDS (Prof) 10%', 'CGST+SGST 9+9%']);
check('IGST across two lines is summed', kindSum[0].amount, 27000);
check('TDS is shown as the deduction it is', kindSum[1].amount, -5000);
check('CGST+SGST on its own line', kindSum[2].amount, 3600);
check('the three add to the net tax',
  Math.round(kindSum.reduce((a2, x) => a2 + x.amount, 0)), 25600);

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - numbering, quantities and stacked per-line tax all hold');
process.exit(bad ? 1 : 0);
