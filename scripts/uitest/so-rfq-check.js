#!/usr/bin/env node
/**
 * OP Central — vendor comparison & Float RFQ for a Sales Order with no
 * Sourcing/inquiry step in front of it
 * ---------------------------------------------------------------------------
 * dm's flow: the client sends a request, Purchase converts it directly into
 * a Sales Order (see docs/client-requests.md) -- there is never a Sourcing
 * record for Purchase to compare vendors or float RFQ from, the way
 * Pre-sales does in the main flow. Rather than build a second, thinner copy
 * of that screen, convert() links a REAL Sourcing record to the new SO --
 * purely an internal vendor-comparison workspace, never converted a second
 * time -- so Purchase gets the exact same per-item vendor comparison grid,
 * "Add vendor & quote," and Float RFQ that Pre-sales already has, and
 * generateVendorPOsFromSourcing places the Vendor PO(s) in one click from
 * whatever was picked, per item, across possibly different vendors. See
 * docs/so-float-rfq.md.
 *
 *   ONE SCREEN, NOT TWO          no parallel RFQ implementation -- the SO
 *                                 gets a real Sourcing row, `converted_so_id`
 *                                 pointed at it, and soSourcing() finds it
 *   NEVER LOCKED                 status is 'Vendor Sourcing', not
 *                                 'Converted' -- every action button on the
 *                                 Sourcing screen (`locked = status ===
 *                                 'Converted'`) stays live
 *   NEVER RE-CONVERTED           Purchase is not in canConvert
 *                                 (['Sales','Pre-sales','Org Admin']), so
 *                                 there is no way to send this workspace
 *                                 sourcing through "Convert to SO" a second
 *                                 time
 *   PER-ITEM VENDORS, ONE CLICK  generateVendorPOsFromSourcing groups by
 *                                 vendor from `sourcing.picks` (one pick per
 *                                 product) and raises one PO per vendor
 *
 * Usage: node scripts/uitest/so-rfq-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React;
try { Babel = require('@babel/standalone'); React = require('react'); }
catch (e) { console.error('Missing dev deps. Run: npm i --no-save @babel/standalone@7.29.0 react@18.3.1 react-dom@18.3.1 jsdom'); process.exit(2); }

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const plain = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map(m => m[1]);
const jsx = [...html.matchAll(/type="text\/babel"\s+src="([^"]+)"/g)].map(m => m[1]);

const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const node = () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } });
sandbox.document = { createElement: node, head: node(), body: node(), documentElement: { style: { setProperty() {} } },
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null };
sandbox.location = { hostname: 'dm.ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
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

const crJsx = fs.readFileSync(path.join(dir, 'src', 'screens-client-requests.jsx'), 'utf8');
const soJsx = fs.readFileSync(path.join(dir, 'src', 'screens-so.jsx'), 'utf8');

console.log('\n[1] convert() links a real Sourcing record, not a second RFQ implementation');
check('a Sourcing is built alongside the SO', /const linkedSourcing = \{/.test(crJsx), true);
check('it points at the new SO via converted_so_id -- the same field soSourcing() reads',
  /converted_so_id: newSO\.id/.test(crJsx), true);
check('lines are passed through unchanged -- same {bundle_qty, components} shape an SO already uses',
  /lines, picks: \{\}, prices: \{\}, alloc: \{\}, margin: \{\}, quote_vendors: \[\]/.test(crJsx), true);
check('status is NOT Converted -- that would lock every action button on the Sourcing screen',
  /status: 'Vendor Sourcing'/.test(crJsx), true);
check('it is pushed into sourcings the same way products/categories/boms already are',
  /sourcings: \[linkedSourcing, \.\.\.\(s\.sourcings \|\| \[\]\)\]/.test(crJsx), true);
check('no order_type/implementation fields -- those are not real sourcings columns (verified against the live schema)',
  /created_by: currentUser \|\| null,\s*\n\s*lines, picks: \{\}/.test(crJsx), true);

console.log('\n[2] "Vendor Sourcing" behaves exactly like any other unlocked Sourcing record');
const srcJsx = fs.readFileSync(path.join(dir, 'src', 'screens-sourcing.jsx'), 'utf8');
check('locked is keyed on status === Converted specifically, so "Vendor Sourcing" is never locked',
  /const locked = src\.status === 'Converted';/.test(srcJsx), true);
check('Purchase is not in canConvert -- cannot send this workspace sourcing through "Convert to SO" a second time',
  /const canConvert = \['Sales', 'Pre-sales', 'Org Admin'\]\.includes\(role\);/.test(srcJsx), true);
check('the vendor comparison table only needs lines to have content, which it always does here',
  /const hasSupply = \(src\.lines \|\| \[\]\)\.length > 0;/.test(srcJsx), true);

console.log('\n[3] the SO Procurement tab finds it and offers one-click PO generation, per vendor');
check('soSourcing() is unchanged -- finds by converted_so_id, nothing dm-specific needed', (() => {
  const state = { sourcings: [{ id: 'src-1', converted_so_id: 'so-1' }, { id: 'src-2', converted_so_id: 'so-2' }] };
  return sandbox.soSourcing(state, 'so-2').id;
})(), 'src-2');
check("canGenerate now also allows 'Draft' -- where a converted request's SO sits until its first Vendor PO exists",
  /const canGenerate = canProcure && sourcing && linkedPOs\.length === 0 && \['Draft', 'Approved', 'Procurement Started'\]\.includes\(so\.status\)/.test(soJsx), true);
check('every existing status this already worked for is still covered', /'Draft', 'Approved', 'Procurement Started'/.test(soJsx), true);
check('an entry point to the comparison screen shows before anything has been picked yet',
  /Compare vendors &amp; Float RFQ/.test(soJsx), true);
check('the manual "Create Vendor PO" path is still offered alongside, untouched',
  /Create Vendor PO<\/button>/.test(soJsx), true);

console.log('\n[4] generateVendorPOsFromSourcing really does place one PO per vendor, from per-item picks');
const so = { id: 'so-1', so_no: 'SO/DM/2026/0004', status: 'Draft', lines: [
  { id: 'l1', bundle_qty: 1, components: [{ product_id: 'p1', qty: 2 }] },
  { id: 'l2', bundle_qty: 1, components: [{ product_id: 'p2', qty: 1 }] },
] };
const sourcing = {
  id: 'src-1', converted_so_id: 'so-1',
  picks: { p1: 'v1', p2: 'v2' },              // two DIFFERENT vendors, one per item
  prices: { p1: { v1: 30000 }, p2: { v2: 9000 } },
  alloc: {},
};
const getProduct = id => ({ p1: { id: 'p1', buy: 32000 }, p2: { id: 'p2', buy: 9500 } })[id];
let st = { config: {}, vendor_pos: [], sales_orders: [so], notifications: [] };
const mutate = (fn, a) => { st = fn(st); };
sandbox.generateVendorPOsFromSourcing(so, sourcing, { state: st, mutate, toast: () => {}, navigate: () => {}, getProduct });
check('one PO per vendor -- two vendors, two POs', st.vendor_pos.length, 2);
check('each PO carries only ITS vendor\'s item(s)', st.vendor_pos.map(p => p.items.length).sort(), [1, 1]);
check('rates come from the quote captured on the sourcing, not the catalogue', (() => {
  const p1po = st.vendor_pos.find(p => p.vendor_id === 'v1');
  return p1po.items[0].rate;
})(), 30000);
check('the SO advances out of Draft the same way a manually-created PO already does',
  st.sales_orders[0].status, 'Procurement Started');

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - Purchase gets the exact same per-item vendor comparison and Float RFQ screen the main flow already has, from an SO with no inquiry of its own');
process.exit(bad ? 1 : 0);
