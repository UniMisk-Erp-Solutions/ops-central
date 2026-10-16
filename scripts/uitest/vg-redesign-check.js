#!/usr/bin/env node
/**
 * OP Central — Virtual Godown visual redesign: nothing lost
 * ---------------------------------------------------------------------------
 * render-check.js already proves the whole app renders without crashing for
 * every role/route; it does not prove any PARTICULAR number, control or
 * sub-panel is still on screen. This file renders VirtualGodownList and
 * VirtualGodownView with a realistic fixture and checks every original data
 * point and interactive control the redesign touched is still present —
 * the actual safety net for "don't break any flow or feature."
 *
 * Usage: node scripts/uitest/vg-redesign-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React, ReactDOMServer;
try {
  Babel = require('@babel/standalone');
  React = require('react');
  ReactDOMServer = require('react-dom/server');
} catch (e) {
  console.error('Missing dev deps. Run: npm i --no-save @babel/standalone react react-dom');
  process.exit(2);
}

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
sandbox.__opcWorkflow = {}; sandbox.__opcFeatures = {}; sandbox.__opcIsMaster = false; sandbox.OPC_SB = null;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};
const has = (html, re) => re.test(html);

const PRODUCTS = [
  { id: 'p1', code: 'CPU', name: 'Server CPU', buy: 1000, sell: 1500 },
  { id: 'p2', code: 'PSU', name: 'Power Supply', buy: 200, sell: 300 },
];
const VENDORS = [{ id: 'v1', name: 'TechSource' }];
const SO = {
  id: 'so-1', so_no: 'SO/FY26/0801', customer_id: 'c1', status: 'Procurement Started',
  lines: [{ id: 'l1', bundle_qty: 1, components: [{ product_id: 'p1', qty: 10 }, { product_id: 'p2', qty: 6 }] }],
  pool_alloc: [{ product_id: 'p1', qty: 2, name: 'Server CPU' }],
  extra: { implementation: { supervisor_id: 'u1', hourly_rate: 500, boq: [], daily_logs: [], requests: [] } },
};
const PO = { id: 'po-1', po_no: 'VPO/FY26/0801', so_id: 'so-1', vendor_id: 'v1', status: 'Issued', amount: 8000,
  items: [{ product_id: 'p1', qty: 8, rate: 1000 }, { product_id: 'p2', qty: 6, rate: 200 }] };
const GRN = { id: 'g1', grn_no: 'GRN/FY26/0801', po_id: 'po-1', date: '2026-10-01',
  items: [{ product_id: 'p1', accepted: 4 }, { product_id: 'p2', accepted: 6 }] };

function makeState(overrides) {
  return Object.assign({
    products: PRODUCTS, vendors: VENDORS, customers: [{ id: 'c1', name: 'Zenith Retail' }], categories: [],
    sales_orders: [SO], vendor_pos: [PO], grns: [GRN], vendor_invoices: [],
    pool: [{ product_id: 'p1', qty: 3 }], transfer_requests: [{ id: 't1', status: 'Pending', items: [] }],
    outward_dispatches: [], notifications: [], audit: [], config: {},
  }, overrides || {});
}

function render(Comp, props, role, state) {
  const st = state || makeState();
  const store = {
    state: st, route: 'godown', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, saveConfig: () => {}, addToPool: async () => {},
    consumeFromPool: () => {}, syncErrors: [], retrySync: () => {},
    soSubtotal: so => (so.lines || []).reduce((s, l) => s + (l.components || []).reduce((a, c) => a + c.qty, 0) * 100, 0),
    getCustomer: id => st.customers.find(c => c.id === id), getVendor: id => VENDORS.find(v => v.id === id),
    getProduct: id => PRODUCTS.find(p => p.id === id), getCategory: () => undefined,
    getUser: () => ({ id: 'u1', name: 'T', role }), getSO: id => st.sales_orders.find(s => s.id === id),
  };
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(Comp, props || {}))));
}

console.log('\n[1] VirtualGodownList -- every original number survives the redesign, and the old per-id mock is gone');
{
  const listHtml = render(sandbox.VirtualGodownList, {}, 'Purchase');
  check('the SO itself is listed', has(listHtml, /SO\/FY26\/0801/), true);
  check('the customer name is shown', has(listHtml, /Zenith Retail/), true);
  check('"from pool" reads the REAL pool_alloc (2), not a hard-coded guess tied to a specific so.id', has(listHtml, />2 from pool</), true);
  check('required total (10+6=16) is shown', has(listHtml, />16 required</), true);
  check('Active VGs stat is present', has(listHtml, /Active VGs/), true);
  check('Pool SKUs stat is present', has(listHtml, /Pool SKUs/), true);
  check('Pending Transfers stat is present', has(listHtml, /Pending Transfers/), true);
  check('Master Pool button still present', has(listHtml, /Master Pool/), true);
  check('Transfers button still present', has(listHtml, />Transfers</), true);
}

console.log('\n[2] VirtualGodownView -- every original column\'s number is still on the page, nothing silently dropped');
{
  const soHtml = render(sandbox.VirtualGodownView, { soId: 'so-1' }, 'Stores');
  // p1: required 10, pool 2, on PO 8 (full line), received 4 (GRN) -> in hand 6, remaining 4
  check('component name shown', has(soHtml, /Server CPU/), true);
  check('component code shown', has(soHtml, /CPU</), true);
  check('Required column total for p1 (10) present', has(soHtml, />10</), true);
  check('On PO for p1 (8) present', has(soHtml, />8</), true);
  check('From Pool for p1 (2) present', has(soHtml, />2</), true);
  check('Received (GRN-accepted) for p1 (4) present', has(soHtml, />4</), true);
  check('the hero stat labels are all present', ['Required', 'In hand', 'Remaining', 'Locked value', 'Fulfilled']
    .every(l => has(soHtml, new RegExp(l))), true);
  check('Status column still renders a badge', has(soHtml, /badge (success|warning|info) dot/), true);
  check('the receive checkbox column is present for a role that can receive', has(soHtml, /type="checkbox"/), true);
  check('"Mark Received"/accept action text is present', has(soHtml, /Receive &amp; post GRN|Confirm &amp; send to/), true);
}

console.log('\n[3] VirtualGodownView -- every sub-panel is still mounted, not silently dropped during the redesign');
{
  const soHtml = render(sandbox.VirtualGodownView, { soId: 'so-1' }, 'Purchase');
  check('VGGrnCard (goods received / GRN history) still mounts', has(soHtml, /Goods received/), true);
  check('VGInvoicesCard still mounts (its own empty/invoice state text)', has(soHtml, /Client Invoices|invoice/i), true);
  check('"Inflows & Outflows" card still present', has(soHtml, /Inflows &amp; Outflows|Inflows & Outflows/), true);
  check('"Pool-first Engine" explainer card still present', has(soHtml, /Pool-first Engine/), true);
  check('VGImplPanel mounts when the SO has implementation tracking', has(soHtml, /Implementation — site tracking/), true);
  check('VGAddFromPoolPanel\'s own heading still present for a role that can edit', has(soHtml, /Add from Master Pool/), true);
}

console.log('\n[4] embedded mode (inside the SO detail page\'s own tab) still works and gets the same redesign');
{
  const embeddedHtml = render(sandbox.VirtualGodownView, { soId: 'so-1', embedded: true }, 'Stores');
  check('no duplicate page header/back-link when embedded (the host page already has one)', has(embeddedHtml, /Virtual Godowns<\/div>/), false);
  check('the stats strip still renders when embedded', has(embeddedHtml, /Required/), true);
  check('the main contents table still renders when embedded', has(embeddedHtml, /Server CPU/), true);
}

console.log('\n[5] a role that cannot receive or edit the BOM sees the data with no edit affordances -- the gate itself is untouched by the restyle');
{
  const viewOnly = render(sandbox.VirtualGodownView, { soId: 'so-1' }, 'Billing');
  check('no receive checkbox for a role outside the receiving flow', has(viewOnly, /type="checkbox"/), false);
  check('the data itself is still fully visible', has(viewOnly, /Server CPU/), true);
}

console.log('\n[6] the repositioned card clusters are actually in the markup, not just in the CSS (round 2 dropped the flow diagram after live review)');
{
  const soHtml = render(sandbox.VirtualGodownView, { soId: 'so-1' }, 'Stores');
  check('the flow diagram is gone -- rejected after the user saw it live on the preview deploy', has(soHtml, /vg-flow/), false);
  check('both the inflow AND outflow cards sit in a cluster, not the old single-column stack', (soHtml.match(/vg-cluster/g) || []).length, 2);
  check('the Pool-first Engine is now a connected step timeline, same six steps as before', has(soHtml, /vg-steps/) && ['Check Master Pool', 'Allocate available qty', 'Route balance to RFQ', 'GRN', 'Outflow to customer', 'Surplus'].every(l => has(soHtml, new RegExp(l))), true);
  check('the table is wrapped for contained horizontal scroll on narrow screens', has(soHtml, /vg-table-scroll/), true);
}

console.log('\n[7] VirtualGodownList also carries the redesign\'s row styling, same data as section [1] already proved');
{
  const listHtml = render(sandbox.VirtualGodownList, {}, 'Purchase');
  check('rows use the new vg-list-row treatment, not the old plain table row', has(listHtml, /vg-list-row/), true);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - the redesigned Virtual Godown screens keep every number, control and sub-panel the originals had');
process.exit(bad ? 1 : 0);
