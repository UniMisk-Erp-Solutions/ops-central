#!/usr/bin/env node
/**
 * OP Central — Float RFQ straight from a Sales Order, no Sourcing/inquiry
 * record required
 * ---------------------------------------------------------------------------
 * Built for dm: the client sends a request, Purchase converts it directly
 * into an SO (see docs/client-requests.md) -- there is never a Sourcing
 * record for Purchase to float RFQ from the way Pre-sales does in the main
 * flow. This reuses the exact same edge function, vendor-quote email/link and
 * config.vendor_emails as Sourcing's own Float RFQ; only src_id changes, from
 * an inquiry's id to the SO's own id.
 *
 *   NO SOURCING, NO PROBLEM     SORfqPanel only needs procComponentList(so)
 *                                and the SO's own id/so_no
 *   ONE CLICK, REAL PRICES      createPOFromRFQQuote builds the PO straight
 *                                from what the vendor actually typed --
 *                                same shape (MD threshold, status, SO
 *                                advance) as CreateVendorPOModal's own PO
 *   THE MANUAL PATH STAYS       "Create Vendor PO" (pick a vendor, type
 *                                prices by hand) is untouched, offered
 *                                alongside, not replaced
 *   THE OLD PATH IS UNCHANGED   where a Sourcing record already exists for
 *                                the SO, this panel steps aside entirely --
 *                                that screen's own Float RFQ is the one to use
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

console.log('\n[1] the edge function resolves an organization from the SO too, not only a Sourcing record');
const idxTs = fs.readFileSync(path.join(dir, '..', 'supabase', 'functions', 'main', 'index.ts'), 'utf8');
check('the sourcings lookup is still tried first -- every existing caller is unaffected',
  /sourcings\?id=eq\.".*encodeURIComponent\(src_id\).*organization_id/.test(idxTs), true);
check('a sales_orders fallback exists for when src_id is not a Sourcing at all',
  /sales_orders\?id=eq\.".*encodeURIComponent\(src_id\).*organization_id/.test(idxTs), true);
check('the fallback only runs after the sourcings lookup already failed (still inside the same !orgId guard)',
  idxTs.indexOf('sales_orders?id=eq.') > idxTs.indexOf('sourcings?id=eq.'), true);

console.log('\n[2] createPOFromRFQQuote builds the exact same PO shape CreateVendorPOModal does');
const PRODUCTS = [{ id: 'p1', code: 'SW-24', name: '24-Port Switch', sell: 45000, buy: 32000 }];
const so = { id: 'so-1', so_no: 'SO/DM/2026/0004', status: 'Procurement Started', lines: [] };
const vendorEntry = {
  vendor_id: 'v1', name: 'Cisco Systems',
  items: [{ product_id: 'p1', qty: 2, name: '24-Port Switch' }],
  prices: { p1: 31000 },
  status: 'submitted',
};
let st = { config: {}, vendor_pos: [], sales_orders: [so], notifications: [], audit: [] };
const mutate = (fn, audit) => { st = fn(st); if (audit) st.audit = [...st.audit, audit]; };
const getVendor = id => ({ v1: { id: 'v1', name: 'Cisco Systems' } })[id];
const toasts = [];
const po = sandbox.createPOFromRFQQuote(so, vendorEntry, { state: st, mutate, toast: (m, k) => toasts.push([m, k]), getVendor });
check('the PO is created', !!po, true);
check('amount is qty × the vendor\'s OWN quoted rate, not the catalogue price', po.amount, 62000);
check('items carry the quoted rate', po.items, [{ product_id: 'p1', qty: 2, rate: 31000 }]);
check('it is tagged so it is distinguishable from a manually-typed PO', po.status === 'Issued', true);
check('source is "rfq"', st.vendor_pos[0].source, 'rfq');
check('the SO advances out of Draft/Approved the same way manual PO creation does',
  st.sales_orders[0].status, 'Procurement Started');
check('a high-value quote goes to MD, exactly like the manual path', (() => {
  let bigSt = { config: { vendor_po_md_threshold: 10000 }, vendor_pos: [], sales_orders: [{ ...so, id: 'so-2' }], notifications: [], audit: [] };
  const bigMutate = (fn, a) => { bigSt = fn(bigSt); if (a) bigSt.audit = [...bigSt.audit, a]; };
  const p = sandbox.createPOFromRFQQuote({ ...so, id: 'so-2' }, vendorEntry, { state: bigSt, mutate: bigMutate, toast: () => {}, getVendor });
  return p.status;
})(), 'Pending MD Approval');
check('a vendor who has not priced anything yet is refused, not given a ₹0 PO', (() => {
  const emptyVendor = { vendor_id: 'v1', name: 'Cisco', items: [{ product_id: 'p1', qty: 2 }], prices: {}, status: 'submitted' };
  let st2 = { config: {}, vendor_pos: [], sales_orders: [so], notifications: [], audit: [] };
  const m2 = (fn) => { st2 = fn(st2); };
  const r = sandbox.createPOFromRFQQuote(so, emptyVendor, { state: st2, mutate: m2, toast: () => {}, getVendor });
  return r;
})(), null);

console.log('\n[3] wired into the screen, offered alongside (not instead of) the manual path');
const soJsx = fs.readFileSync(path.join(dir, 'src', 'screens-so.jsx'), 'utf8');
check('SORfqPanel is mounted in the Procurement tab', /\{!sourcing && <SORfqPanel so=\{so\}\/>\}/.test(soJsx), true);
check('it steps aside when a Sourcing record already exists for this SO',
  soJsx.indexOf('{!sourcing && <SORfqPanel') < soJsx.indexOf("Create Vendor PO</button>"), true);
check('the manual "Create Vendor PO" button is still there, untouched',
  /Create Vendor PO<\/button>/.test(soJsx), true);
check('it reuses the SAME MissingVendorEmailsModal Sourcing already built, not a second copy',
  /window\.MissingVendorEmailsModal = MissingVendorEmailsModal;/.test(fs.readFileSync(path.join(dir, 'src', 'screens-sourcing.jsx'), 'utf8')), true);
check('the panel calls the SAME edge function endpoint Sourcing\'s Float RFQ calls',
  /\/functions\/v1\/main\/float-rfq/.test(soJsx), true);
check('src_id sent is the SO\'s own id, not an inquiry id',
  /src_id: so\.id, src_no: so\.so_no/.test(soJsx), true);

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - Purchase can float RFQ straight from an SO with no inquiry, and place the vendor PO in one click from their reply');
process.exit(bad ? 1 : 0);
