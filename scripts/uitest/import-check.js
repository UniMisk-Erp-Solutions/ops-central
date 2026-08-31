#!/usr/bin/env node
/**
 * OP Central — customer sheet import check
 * ---------------------------------------------------------------------------
 * Parses a faithful reproduction of the customer's real working sheet and
 * asserts the structure survives. Built from the actual BOQ: merged
 * "Type of Equipements" and "Po SR No" columns, "Group A:" banners,
 * "Group A - Total" subtotals, and a Sr. No. hierarchy where 1.0.1 … 1.17 are
 * the licences and modules that belong inside chassis 1.
 *
 * The subtle one is quantity. Group A is one chassis whose parts are 1/2/4/20.
 * Group B is SIX identical switches whose every sub-line also reads 6 — those
 * are 6 sets of 1, not 36 units. Getting that wrong silently multiplies an
 * order, so it is asserted explicitly.
 *
 * Usage: node scripts/uitest/import-check.js [path-to-frontend]
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
  useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f };
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(dir, 'src', 'screens-import.jsx'), 'utf8');
vm.runInContext(Babel.transform(src, { presets: ['react'], filename: 'screens-import.jsx' }).code,
  sandbox, { filename: 'screens-import.jsx' });

const { impParseMatrix, impBuildLines } = sandbox;

// --- the sheet, exactly as SheetJS hands it over -----------------------------
// A merged cell carries its value on the FIRST row of the merge and '' after,
// which is why Type of Equipements and Po SR No are blank on continuation rows.
const R = '₹                    -   ';
const H = ['Type of Equipements', 'Sr. No.', 'Part No.', 'Item Description', 'Unit', 'Qty.',
           'Unit Rate', 'Total W/O Tax', 'Tax Rate %', 'Total with Taxes', '', 'Po  SR No'];
const item = (equip, sr, code, desc, qty, posr) =>
  [equip, sr, code, desc, 'Nos.', qty, R, R, '18%', R, '', posr];

const SHEET = [
  ['Company Confidential — Bill of Quantities', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  H,
  ['', 'Group A: Core Switch - Cisco Catalyst C9600 Series', '', '', '', '', '', '', '', '', '', ''],
  item('Cisco Catalyst 9600 Series 6 Slot Chassis', '1', 'C9606R', 'Cisco Catalyst 9600 Series 6 Slot Chassis', 1, '1'),
  item('', '1.0.1', 'CON-SNTP-C9606R', 'SNTC-24X7X4 Cisco Catalyst 9600 (36 Months)', 1, ''),
  item('', '1.0.2', 'C9600-DNA-A', 'Cisco Catalyst 9600 DNA Advantage Term License', 1, ''),
  item('', '1.1.1', 'C9600-DNA-A-3Y', 'Cisco Catalyst 9600 DNA Advantage 3 Year License', 1, ''),
  item('', '1.2', 'C9600-NW-A', 'Cisco Catalyst 9600 Network Advantage License', 2, ''),
  item('', '1.3', 'S9600UK9-1712', 'Cisco Catalyst 9600 XE 17.12 UNIVERSAL', 1, ''),
  item('', '1.4', 'C9606-SLOT-BLANK', 'Cisco Catalyst 9600 Series Blank for Chassis Module Slot', 1, ''),
  item('', '1.5', 'C9600-CAMPUS-CORE', 'Catalyst 9600 Campus Core Deployment; For Tracking Only', 1, ''),
  item('', '1.6', 'C9606-FAN', 'Cisco Catalyst 9600 Series C9606 Chassis Fan Tray', 1, ''),
  item('', '1.7', 'CAB-CONSOLE-USB', 'Console Cable 6ft with USB Type A and mini-B', 1, ''),
  item('', '1.8', 'C9600-SUP-1', 'Cisco Catalyst 9600 Series Supervisor 1 Module', 1, ''),
  item('', '1.9', 'C9600-SSD-NONE', 'No SSD Memory Selected', 1, ''),
  item('', '1.1', 'C9600-SUP-1/2', 'Cisco Catalyst 9600 Series Redundant Supervisor 1 Module', 1, ''),
  item('', '1.11', 'C9600-SSD-NONE', 'No SSD Memory Selected', 1, ''),
  item('', '1.12', 'C9600-LC-48YL', 'Cisco Catalyst 9600 Series 48-Port 25GE/10GE/1GE', 1, ''),
  item('', '1.13', 'C9600-LC-48TX', 'Cisco Catalyst 9600 Series 48-Port Copper', 1, ''),
  item('', '1.14', 'C9600-LC-48YL', 'Cisco Catalyst 9600 Series 48-Port 25GE/10GE/1GE', 1, ''),
  item('', '1.15', 'C9600-PWR-2KWAC', 'Cisco Catalyst 9600 Series 2000W AC Power Supply', 4, ''),
  item('', '1.16', 'CAB-C15-CBN-IN', 'AC Power Cord, Type C15 Cable, India', 4, ''),
  item('', '1.17', 'NETWORK-PNP-LIC', 'Network Plug-n-Play Connect for zero-touch device deployment', 1, ''),
  item('', '2', 'C9606-RACK-KIT=', 'Cisco Catalyst 9600 Series 6 slot chassis Rack Mount', 1, ''),
  item('', '3', 'C9606-ACC-KIT=', 'Cisco Catalyst 9600 Series 6 slot chassis Accessory Kit', 1, ''),
  item('', '4', 'SFP-10/25G-LR-S=', '10/25GBASE-LR SFP28 Module', 20, ''),
  ['', '', '', 'Group A - Total', '', '', '', R, '', R, '', ''],
  ['', 'Group B:  Distribution Switch - Cisco Catalyst C9300 Series 24 Port', '', '', '', '', '', '', '', '', '', ''],
  item('24 Port', '5', 'C9300-24T-E', 'Catalyst 9300 24-port data only, Network Essentials', 6, '2'),
  item('', '5.0.1', 'CON-SNT-C93002TE', 'SNTC-8X5XNBD Catalyst 9300 24-port data only (36 months.)', 6, ''),
  item('', '5.1', 'C9300-DNA-E-24', 'C9300 DNA Essentials, 24-Port Term Licenses', 6, ''),
  item('', '5.1.1', 'C9300-DNA-E-24-3Y', 'C9300 DNA Essentials, 24-Port, 3 Year Term License', 6, ''),
  item('24-port data', '5.2', 'C9300-NW-E-24', 'C9300 Network Essentials, 24-port license', 6, ''),
  item('', '5.3', 'SC9300UK9-1712', 'Cisco Catalyst 9300 XE 17.12 UNIVERSAL', 6, ''),
  item('', '5.4', 'PWR-C1-350WAC-P', '350W AC 80+ platinum Config 1 Power Supply', 6, ''),
  item('', '5.5', 'C9300-SPS-NONE', 'No Secondary Power Supply Selected', 6, ''),
  item('', '5.6', 'CAB-TA-IN', 'India AC Type A Power Cable', 6, ''),
  item('', '5.7', 'C9300-SSD-NONE', 'No SSD Card Selected', 6, ''),
  ['', '', '', 'Group B - Total', '', '', '', R, '', R, '', ''],
  ['', '', '', 'Grand Total', '', '', '', R, '', R, '', ''],
];

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

const res = impParseMatrix(SHEET);
if (res.error) { console.log('  X  parse failed: ' + res.error); process.exit(1); }

console.log('\n[1] reading the sheet');
check('header row found (row 3, after two title rows)', res.headerRow, 2);
// 23 in Group A (chassis 1 + its 19 sub-rows, then 2, 3, 4) + 10 in Group B.
check('banners and the three Total rows are not items', res.rows.length, 33);
check('Type of Equipements column located', res.columns.equip, 0);
check('Po SR No column located', res.columns.posr, 11);

console.log('\n[2] merged cells carried down');
const r1015 = res.rows.find(r => r.sr === '1.15');
check('sub-row inherits the equipment type', r1015.equip, 'Cisco Catalyst 9600 Series 6 Slot Chassis');
check('sub-row inherits the PO Sr No', r1015.posr, '1');
check('sub-row inherits its group banner', r1015.group.startsWith('Group A:'), true);
const r53 = res.rows.find(r => r.sr === '5.3');
check('equipment type updates at Group B', r53.equip, '24-port data');
check('PO Sr No updates at Group B', r53.posr, '2');

console.log('\n[3] quantities and rupee columns');
check('quantity 20 read as a number', res.rows.find(r => r.sr === '4').qty, 20);
check('the accounting dash reads as 0, not NaN', res.rows[0].rate, 0);
check('"18%" reads as 18', res.rows[0].tax, 18);

console.log('\n[4] Sr. No. hierarchy -> order lines');
const lines = impBuildLines(res.rows);
check('five order lines (1, 2, 3, 4, 5)', lines.map(l => l.top), ['1', '2', '3', '4', '5']);
// 1 parent + 19 sub-rows. Note the sheet shows "1.1" twice: Excel stores 1.10
// as the number 1.1, so the second one arrives already collapsed. Both still
// belong to chassis 1, which is what matters.
check('chassis 1 holds all 19 of its sub-items', lines[0].members.length, 20);
check('chassis 1 is one set', lines[0].bundleQty, 1);
check('its 4 power supplies stay 4', lines[0].members.find(m => m.row.sr === '1.15').qty, 4);
check('rack kit is a line of its own', lines[1].members.length, 1);
check('20 SFP modules = 20 sets of 1', [lines[3].bundleQty, lines[3].members[0].qty], [20, 1]);

console.log('\n[5] the multiplication trap');
check('6 switches = 6 sets, not 36 units', lines[4].bundleQty, 6);
check('each set holds ONE of each sub-item', lines[4].members.every(m => m.qty === 1), true);
const units = lines[4].members.reduce((a, m) => a + m.qty * lines[4].bundleQty, 0);
check('total units across the bundle', units, 6 * 10);
check('line named from the equipment type', lines[4].equip, '24 Port');
check('PO Sr No kept on the line', lines[4].posr, '2');

console.log('\n[6] nothing invented');
check('every parsed row has a part number', res.rows.every(r => !!r.code), true);
check('no row is a banner or a total',
  res.rows.some(r => /^group\b/i.test(r.code) || /total/i.test(r.code)), false);

// ---------------------------------------------------------------------------
// The dialog itself, for the case that actually failed: an organization with NO
// customers. The file input was disabled until a customer was chosen, and the
// customer list was empty — so the screen could never be used at all.
// ---------------------------------------------------------------------------
console.log('\n[7] the dialog works for an organization with no customers');
try {
  const React = require('react');
  const ReactDOMServer = require('react-dom/server');

  const sb2 = { console: { log() {}, warn() {}, error() {} } };
  sb2.window = sb2; sb2.globalThis = sb2; sb2.React = React;
  sb2.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} };
  sb2.addEventListener = () => {}; sb2.removeEventListener = () => {};
  sb2.OPC_SB = null;
  vm.createContext(sb2);
  for (const f of ['utils.jsx', 'screens-import.jsx']) {
    const code = Babel.transform(fs.readFileSync(path.join(dir, 'src', f), 'utf8'),
      { presets: ['react'], filename: f }).code;
    vm.runInContext(code, sb2, { filename: f });
  }

  // An empty tenant: no customers, no products — exactly Microlink.
  const st = { customers: [], products: [], categories: [], boms: {}, sales_orders: [], notifications: [] };
  sb2.useStore = () => ({ state: st, mutate: () => {}, navigate: () => {},
    getUser: () => ({ role: 'Purchase' }), currentUser: 'u1' });
  sb2.useToast = () => (() => {});
  sb2.TODAY = '2026-01-01';

  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(sb2.SheetImportModal, { onClose: () => {} }));
  const fileInput = /<input[^>]*type="file"[^>]*>/.exec(html);

  check('the dialog renders', html.length > 500, true);
  check('a file input is present', !!fileInput, true);
  check('the file input is NOT disabled', !!(fileInput && /disabled/.test(fileInput[0])), false);
  check('an "Add a new customer" option is offered', /Add a new customer/.test(html), true);
  check('it explains that there are no customers yet', /No customers yet/.test(html), true);
  check('the fields use a grid class the stylesheet has', /class="field-row"/.test(html), true);
  check('the invented grid-2 class is gone', /grid-2/.test(html), false);

  check('Purchase may import', sb2.canImportSheet('Purchase'), true);
  check('Org Admin may import', sb2.canImportSheet('Org Admin'), true);
  check('Sales may not', sb2.canImportSheet('Sales'), false);
  check('Stores may not', sb2.canImportSheet('Stores'), false);
} catch (e) {
  bad++; console.log('  X  dialog render threw: ' + e.message);
}

console.log(bad ? `\nFAILED — ${bad} check(s)` : '\nPASS — the sheet imports with its structure intact');
process.exit(bad ? 1 : 0);
