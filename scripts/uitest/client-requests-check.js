#!/usr/bin/env node
/**
 * OP Central — client requests (what the client wants, before there is an SO)
 * ---------------------------------------------------------------------------
 * The client never creates a Sales Order. They type a list of what they want
 * — helped by recommendations from past orders — and send it to Purchase, who
 * matches every name to the catalogue and creates the real SO. See
 * docs/client-requests.md.
 *
 *   THE CLIENT NEVER CREATES AN SO   Client Facing's base `can` carries no
 *                                    createSO/editOwnDraft; the only thing
 *                                    they can create is a request
 *   PURCHASE CREATES IT, NOT BY THE GENERAL BUTTON   Purchase gets
 *                                    convertClientRequest, not createSO — the
 *                                    "New Sales Order" screen stays closed to
 *                                    them; the only door is a request
 *   OFF EVERYWHERE ELSE              the whole route is gated behind
 *                                    wf('client_order_requests'), same
 *                                    discipline as client_acceptance
 *   RECOMMENDATIONS RANK BY FREQUENCY, THEN RECENCY   what a customer has
 *                                    ordered most, tie-broken by most recent
 *
 * Usage: node scripts/uitest/client-requests-check.js [path-to-frontend]
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
const node = () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {},
  classList: { add() {}, remove() {} } });
sandbox.document = { createElement: node, head: node(), body: node(),
  documentElement: { style: { setProperty() {} } },
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

console.log('\n[1] the client cannot create a Sales Order -- only a request');
check('Client Facing has no createSO', sandbox.canDo('Client Facing', 'createSO'), false);
check('Client Facing has no editOwnDraft', sandbox.canDo('Client Facing', 'editOwnDraft'), false);
check('Client Facing can create a request', sandbox.canDo('Client Facing', 'createClientRequest'), true);
check("Sales (a different tenant's role) is unaffected -- still creates SOs directly",
  sandbox.canDo('Sales', 'createSO'), true);

console.log('\n[2] Purchase creates the SO only by converting a request, never by the general button');
check('Purchase has no createSO', sandbox.canDo('Purchase', 'createSO'), false);
check('Purchase can convert a request', sandbox.canDo('Purchase', 'convertClientRequest'), true);
check('Org Admin can always convert (universal admin capability)', sandbox.canConvertClientRequest('Org Admin'), true);
check('Client Facing cannot convert', sandbox.canConvertClientRequest('Client Facing'), false);

console.log('\n[3] the whole feature is invisible off the workflow key -- same discipline as client_acceptance');
sandbox.__opcWorkflow = { client_order_requests: false };
sandbox.__opcPerms = null; sandbox.__opcFeatures = null;
check('the route is blocked for the role that owns it', sandbox.canAccess('Client Facing', 'client-requests'), false);
check('and for Purchase too', sandbox.canAccess('Purchase', 'client-requests'), false);
sandbox.__opcWorkflow = { client_order_requests: true };
check('the route opens once the org turns the key on', sandbox.canAccess('Client Facing', 'client-requests'), true);
check('for Purchase too', sandbox.canAccess('Purchase', 'client-requests'), true);
sandbox.__opcWorkflow = null;
check('absent workflow context means off, same as every other key here', sandbox.canAccess('Client Facing', 'client-requests'), false);

console.log('\n[4] numbering -- derived from what exists, same scheme as every other document');
const stNum = { client_requests: [{ request_no: 'CREQ202605001' }, { request_no: 'CREQ202605002' }] };
check('the next number continues the sequence for that month',
  sandbox.clientReqNo(stNum, sandbox.TODAY), 'CREQ202605003');
check('a brand-new tenant with no requests starts at 001',
  sandbox.clientReqNo({ client_requests: [] }, sandbox.TODAY), 'CREQ202605001');

console.log('\n[5] recommendations -- ranked by how often, then most recent');
const PRODUCTS = [
  { id: 'p1', code: 'C9300', name: 'Catalyst 9300', sell: 0, buy: 0 },
  { id: 'p2', code: 'PWR', name: '2000W PSU', sell: 0, buy: 0 },
  { id: 'p3', code: 'CAB', name: 'Patch Cable', sell: 0, buy: 0 },
];
const getProduct = id => PRODUCTS.find(p => p.id === id);
const soWith = (id, custId, date, items) => ({
  id, customer_id: custId, date,
  lines: [{ id: id + '-l', components: items.map(it => ({ product_id: it, qty: 1, sell: 0 })) }],
});
const stRec = {
  sales_orders: [
    soWith('so-a', 'c1', '2026-01-10', ['p1', 'p2']),
    soWith('so-b', 'c1', '2026-02-15', ['p1']),
    soWith('so-c', 'c1', '2026-03-01', ['p1']),
    soWith('so-d', 'c1', '2026-03-20', ['p2']),
    soWith('so-e', 'c2', '2026-03-25', ['p3']),   // a different customer -- must not leak in
  ],
};
const recs = sandbox.clientPastItems(stRec, 'c1', getProduct, 8);
check('only this customer\'s own history is considered', recs.map(r => r.product_id).includes('p3'), false);
check('p1 (ordered 3x) ranks above p2 (ordered 2x)', recs[0].product_id, 'p1');
check('counts are correct', recs.map(r => [r.product_id, r.count]).sort(), [['p1', 3], ['p2', 2]]);
check('no customer means no recommendations, not a crash', sandbox.clientPastItems(stRec, '', getProduct, 8), []);
check('an unknown customer returns nothing', sandbox.clientPastItems(stRec, 'nope', getProduct, 8), []);

console.log('\n[6] wired into the screens, gated the same way everywhere');
const permsJsx = fs.readFileSync(path.join(dir, 'src', 'permissions.jsx'), 'utf8');
check('client_order_requests defaults off in code, same as client_acceptance',
  /client_order_requests:\s*false/.test(permsJsx), true);
check('the route is registered behind a WORKFLOW_ROUTES gate, the same idiom as FEATURE_ROUTES',
  /WORKFLOW_ROUTES\s*=\s*\{\s*client_order_requests:\s*\['client-requests'\]/.test(permsJsx), true);
const appJsx = fs.readFileSync(path.join(dir, 'src', 'app.jsx'), 'utf8');
check('all three routes are wired', [
  /route === 'client-requests'\) Content = <ClientRequestList\/>/.test(appJsx),
  /route === 'client-requests\/new'\) Content = <ClientRequestNew\/>/.test(appJsx),
  /parts\[0\] === 'client-requests' && parts\[1\]\) Content = <ClientRequestDetail/.test(appJsx),
].every(Boolean), true);
const shellJsx = fs.readFileSync(path.join(dir, 'src', 'shell.jsx'), 'utf8');
check('a nav entry exists in the Sales group', /id: 'client-requests', label: 'Item Requests'/.test(shellJsx), true);
const idxHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
check('the file is actually loaded by the page', /src\/screens-client-requests\.jsx/.test(idxHtml), true);
const storeJsx = fs.readFileSync(path.join(dir, 'src', 'store.jsx'), 'utf8');
check('client_requests syncs to the database', /client_requests:\s*'id'/.test(storeJsx), true);
check('and loads from it on boot', /'outward_dispatches',\s*'client_requests'/.test(storeJsx), true);
const importJsx = fs.readFileSync(path.join(dir, 'src', 'screens-import.jsx'), 'utf8');
check('the sheet importer reverted to Purchase/Org Admin only',
  /return \['Purchase', 'Org Admin'\]\.indexOf\(role\) !== -1;/.test(importJsx), true);

console.log('\n[7] "can" is a whole-object override -- Client Facing base keeps every OTHER capability it should');
check('viewCustomers survives', sandbox.canDo('Client Facing', 'viewCustomers'), true);
check('viewProducts survives', sandbox.canDo('Client Facing', 'viewProducts'), true);
check('logFollowup survives', sandbox.canDo('Client Facing', 'logFollowup'), true);

console.log('\n[8] "View Sales Order" on a converted request goes somewhere the viewer can actually open');
const crJsx = fs.readFileSync(path.join(dir, 'src', 'screens-client-requests.jsx'), 'utf8');
check("Client Facing (who cannot open the SO detail page) is sent to SCM Tracking instead",
  /navigate\(role === 'Client Facing'\s*\n?\s*\? `scm\/\$\{req\.converted_so_id\}`/.test(crJsx), true);
check('every other role still gets the full SO detail page',
  /: `sales-orders\/\$\{req\.converted_so_id\}`/.test(crJsx), true);
check('SCM Tracking accepts a soId to pre-select, rather than always defaulting to the first order',
  /function SCMTracking\(\{ soId: soIdFromRoute \}/.test(fs.readFileSync(path.join(dir, 'src', 'screens-scm.jsx'), 'utf8')), true);
check("app.jsx wires a scm/:id route",
  /parts\[0\] === 'scm' && parts\[1\]\) Content = <SCMTracking soId=\{parts\[1\]\}\/>/.test(appJsx), true);

console.log('\n[9] a converted SO can actually be invoiced -- unit_price is a real rollup, not 0');
// _soBilled/buildDispatchInvoice (screens-billing.jsx) read line.unit_price,
// NOT the component's own sell value, to decide how much of the order is
// billable. convert() used to hard-code unit_price: 0 on every line -- the
// component carried the real price, the LINE did not -- so _soSub(so) was
// always 0 and no client-request-converted order could ever be invoiced, no
// matter how its items were priced. lineSellOf is the same bundle_qty*sell
// rollup the sheet importer and EditSOModal already use.
check('convert() prices the line from its components, not a hard-coded 0',
  /unit_price: lineSellOf\(components, getProduct\)/.test(crJsx), true);
check('the old bug pattern is gone', /unit_price: 0, client_name: i\.text/.test(crJsx), false);
const realComponents = [{ product_id: 'p1', qty: 2, sell: 45000 }];
check('lineSellOf actually rolls up to a non-zero price for a real item',
  sandbox.lineSellOf(realComponents, id => ({ sell: 45000 })), 90000);
const newItemComponents = [{ product_id: 'p2', qty: 1, sell: 0 }];
check('a brand-new item created on the fly correctly prices at 0, not invented',
  sandbox.lineSellOf(newItemComponents, id => ({ sell: 0 })), 0);

console.log('\n[10] invoicing at dispatch does not silently outrun an open client review');
// Discovered by actually running the whole flow end to end: dm runs
// invoice_on_dispatch AND client_acceptance together, so an invoice can raise
// the INSTANT goods leave, before the client has looked at anything.
// buildDispatchInvoice/buildInvoice/buildBoqInvoice/buildBoqFinalInvoice all
// used to force the SO's STORED status to 'Invoiced' the moment an invoice
// fully covered the order -- and because soAdvanceStatus only ever moves
// forward, once so.status itself said 'Invoiced' (later in SO_LIFECYCLE than
// Pending Client Acceptance), soDerivedStatus's own review check could never
// be reached again for that order, no matter how open the review still was.
// A live end-to-end run (client request -> convert -> vendor PO -> GRN ->
// dispatch) showed the status strip jump straight from "Ready to Dispatch" to
// "Invoiced" -- skipping the review stage the org had switched on -- because
// of exactly this.
const billingJsx = fs.readFileSync(path.join(dir, 'src', 'screens-billing.jsx'), 'utf8');
check('every invoice-building function checks soReviewStillOpen before forcing status to Invoiced',
  (billingJsx.match(/\(fully && !soReviewStillOpen\(state, so\)\)/g) || []).length, 4);
check('no build*Invoice function still force-writes Invoiced unconditionally',
  /status: fully \? 'Invoiced' : so\.status/.test(billingJsx), false);
const utilsSrc2 = fs.readFileSync(path.join(dir, 'src', 'utils.jsx'), 'utf8');
check('soDerivedStatus checks the review BEFORE the invoiced/paid checks, not after',
  utilsSrc2.indexOf('soReviewStillOpen(state, so)) return \'Pending Client Acceptance\'')
    < utilsSrc2.indexOf("if (invoiced && paid > 0) return 'Payment Pending'"), true);
check('soReviewStillOpen is off (never blocks) for every organization without client_acceptance',
  /if \(!\(typeof wfOn === 'function' && wfOn\('client_acceptance'\)\)\) return false;/.test(utilsSrc2), true);
check('and it does not block when nothing has been dispatched yet -- nothing to review, nothing to block',
  /if \(!r\.items\.length\) return false;/.test(utilsSrc2), true);

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - the client sends a request, Purchase maps it and creates the SO, and every other organization never sees any of it');
process.exit(bad ? 1 : 0);
