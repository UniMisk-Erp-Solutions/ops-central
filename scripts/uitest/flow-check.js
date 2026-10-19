#!/usr/bin/env node
/**
 * OP Central — the Flow hub: post-login landing page
 * ---------------------------------------------------------------------------
 * A picture of the six-stage lifecycle (Sales Order -> Vendors -> Procurement
 * -> Inventory -> Dispatch -> Billing). Every node just navigates to a small
 * hub listing the real, already-existing pages for that stage — read
 * straight from opcNavGroups(state, role), the sidebar's own single
 * definition, never a second copy of labels/icons that could drift. This
 * proves: every stage node renders; a stage hub lists exactly the modules a
 * role can actually reach (never one it cannot); a role with nothing
 * available in a stage sees it marked unavailable, not a dead link; and
 * login now lands everyone on the flow hub, not each role's old
 * role-specific primary.
 *
 * Usage: node scripts/uitest/flow-check.js [path-to-frontend]
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
const has = (h, re) => re.test(h);

function makeState() {
  return {
    sales_orders: [], vendor_pos: [], grns: [], vendor_invoices: [], transfer_requests: [],
    sourcings: [], client_requests: [], notifications: [], audit: [], pool: [], config: {},
    customers: [], vendors: [], products: [], categories: [], rfqs: [], users: [], dismissed_writeoff: true,
  };
}
function render(Comp, props, role) {
  const st = makeState();
  const store = {
    state: st, route: 'flow', currentUser: 'u1', authReady: true, loaded: true,
    navigate: () => {}, mutate: () => {}, syncErrors: [], retrySync: () => {},
    getUser: () => ({ id: 'u1', name: 'T', role }),
  };
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(sandbox.Store.Provider, { value: store },
      React.createElement(sandbox.ToastProvider, null, React.createElement(Comp, props || {}))));
}

console.log('\n[1] every stage from CLAUDE.md\'s own lifecycle is a node on the hub, for a role that can reach everything');
{
  const htmlOut = render(sandbox.FlowHome, {}, 'Org Admin');
  ['Sales Order', 'Vendors', 'Procurement', 'Inventory', 'Dispatch', 'Billing'].forEach(label => {
    check(`"${label}" node is present`, has(htmlOut, new RegExp(label)), true);
  });
  check('none of Org Admin\'s six nodes are marked unavailable (Org Admin can reach every module)',
    (htmlOut.match(/flow-node-empty/g) || []).length, 0);
  check('Dashboard button is present', has(htmlOut, />Dashboard</), true);
  check('Settings button is present for a role that can reach it', has(htmlOut, />Settings</), true);
}

console.log('\n[2] a role with nothing in a stage sees that node marked unavailable, not a dead link into an empty page');
{
  // Stores' real nav (post role-nav-cleanup): dashboard, vendor-pos, grn,
  // godown, pool, products — no sourcing/sales-orders/customers/client-requests
  // (Sales Order stage) and no invoices/collections (Billing stage).
  const htmlOut = render(sandbox.FlowHome, {}, 'Stores');
  check('exactly two of Stores\' six nodes are marked unavailable (Sales Order, Billing)',
    (htmlOut.match(/flow-node-empty/g) || []).length, 2);
  check('Settings button is correctly absent for Stores (cannot open it)', has(htmlOut, />Settings</), false);
}

console.log('\n[3] a stage hub lists exactly the real modules a role can reach for that stage, reusing the sidebar\'s own labels -- never a second copy that could drift');
{
  const htmlOut = render(sandbox.FlowStage, { stageId: 'vendors' }, 'Purchase');
  // Purchase's literal nav has rfq, vendor-pos, vendors (not 'mapping') --
  // but 'mapping' still reaches them via the same SCM_ROLES bypass the
  // sidebar itself uses (opcNavGroups' own filter checks SCM_ROUTES_SET +
  // canAccess, not just the bare nav array), so the hub must show it too,
  // not disagree with what the sidebar already renders for this role.
  check('RFQ Comparison card is present', has(htmlOut, /RFQ Comparison/), true);
  check('Vendor POs card is present', has(htmlOut, /Vendor POs/), true);
  check('Vendors card is present', has(htmlOut, /factory/) || has(htmlOut, /Vendors</), true);
  check('Item Name Mapping card is present too (reaches Purchase via the SCM_ROLES bypass, same as the sidebar)',
    has(htmlOut, /Item Name Mapping/), true);
  check('exactly 4 cards render -- matching the sidebar\'s own Procurement group for this role exactly',
    (htmlOut.match(/flow-card-label/g) || []).length, 4);
}

console.log('\n[4] a stage a role cannot use at all shows an honest empty state, not a blank grid');
{
  const htmlOut = render(sandbox.FlowStage, { stageId: 'billing' }, 'Stores');
  check('no cards render', (htmlOut.match(/flow-card-label/g) || []).length, 0);
  check('an explanatory empty state is shown instead of nothing', has(htmlOut, /Nothing here for your role/), true);
}

console.log('\n[5] canAccess grants every role the flow hub itself, the same way dashboard always has been -- it only ever links onward to what the role already has');
{
  ['Org Admin', 'Sales', 'Purchase', 'Stores', 'Client Facing', 'Supervisor', 'Managing Director'].forEach(r => {
    check(`${r} can open the flow hub`, sandbox.canAccess(r, 'flow'), true);
    check(`${r} can open a stage sub-route too`, sandbox.canAccess(r, 'flow/inventory'), true);
  });
}

console.log('\n[6] login lands everyone on the flow hub now, not each role\'s old role-specific primary route');
{
  const authSrc = fs.readFileSync(path.join(dir, 'src', 'screens-auth.jsx'), 'utf8');
  check('the post-login navigate call goes straight to \'flow\'', /navigate\('flow'\)/.test(authSrc), true);
  check('the old role-specific primary-route lookup on login is gone',
    /const dest = \(perm\(res\.user\.role\)\.primary/.test(authSrc), false);
}

console.log('\n[7] a fresh page load with no hash, and clearing the hash mid-session, both land on the flow hub too -- not just the login transition');
{
  const storeSrc = fs.readFileSync(path.join(dir, 'src', 'store.jsx'), 'utf8');
  check('the initial route state defaults to \'flow\'', /window\.location\.hash\.slice\(1\);\s*\n\s*return h \|\| 'flow';/.test(storeSrc), true);
  check('the hashchange listener\'s fallback is \'flow\' too, not left disagreeing with the initial default',
    /setRoute\(window\.location\.hash\.slice\(1\) \|\| 'flow'\)/.test(storeSrc), true);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - the flow hub shows every stage, each stage hub lists exactly what the role can reach, and login/reload both land there now');
process.exit(bad ? 1 : 0);
