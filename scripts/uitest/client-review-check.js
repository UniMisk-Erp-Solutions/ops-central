#!/usr/bin/env node
/**
 * OP Central — client review (accept / reject what was delivered)
 * ---------------------------------------------------------------------------
 * Off everywhere except an organization running wf('client_acceptance'). Every
 * assertion here has a twin: what happens when the flag is OFF (must be
 * nothing — the historic statuses, the historic strip, no stray function
 * throwing because it assumed the flag was on).
 *
 *   NEVER UN-DECIDE A UNIT   once a dispatched unit is accepted or rejected it
 *                            never returns to "pending" — the same rule a BOQ
 *                            uses for "already committed elsewhere"
 *   CLAMPED TO WHAT SHIPPED  a decision can never exceed what is still pending
 *                            for that item, computed from live state inside
 *                            the write, never the caller's stale snapshot
 *   THE LIFECYCLE IS SHARED  SO_LIFECYCLE is one array for every organization;
 *                            inserting two names into it must not move any
 *                            other name relative to any other name
 *   A REJECTION IS TWO QUESTIONS, NOT ONE   "has Purchase ordered a
 *                            replacement" (nets against what is on a vendor
 *                            PO) and "has the client actually got it and said
 *                            yes" (nets against what the client accepted) are
 *                            different facts with different consumers, and
 *                            conflating them either double-orders or closes
 *                            an order the client is still owed something on
 *
 * Usage: node scripts/uitest/client-review-check.js [path-to-frontend]
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

// ---------------------------------------------------------------------------
// One order, two dispatches: 8 of an item sent on the first challan, 2 on the
// second — 10 required, 10 dispatched.
// ---------------------------------------------------------------------------
const PRODUCTS = [
  { id: 'p1', code: 'C9300-24T', name: 'Catalyst 9300 24 Port', sell: 0, buy: 0 },
  { id: 'p2', code: 'PWR-2KWAC', name: '2000W AC PSU', sell: 0, buy: 0 },
];
const getProduct = id => PRODUCTS.find(p => p.id === id);
const getUser = () => ({ id: 'u1', name: 'Priya', role: 'Client Facing' });

const baseSO = () => ({
  id: 'so-1', so_no: 'SO/FY26/0001', customer_id: 'c1', status: 'Ready to Dispatch',
  lines: [{ id: 'l1', bundle_qty: 1, unit_price: 0,
    components: [
      { product_id: 'p1', qty: 10, sell: 0, customer_ref: { desc: 'CORE SWITCH 24P' } },
      { product_id: 'p2', qty: 5, sell: 0 },
    ] }],
  invoices: [], extra: {},
});
const mkState = (so, dispatches, vendorPos, wfObj) => {
  sandbox.__opcWorkflow = wfObj;
  return { products: PRODUCTS, sales_orders: [so], vendor_pos: vendorPos || [], grns: [],
    notifications: [], audit: [], outward_dispatches: dispatches || [],
    payments: [] };
};
// A synchronous stand-in for the app's real mutate(): runs the updater against
// the given state and returns the next one, exactly the shape soApplyClientReview
// expects to call.
function mkCtx(state) {
  const box = { state };
  const mutate = (fn) => { box.state = fn(box.state); };
  return { ctx: { mutate, currentUser: 'u1', getUser, toast: () => {}, state: box.state,
                  get state() { return box.state; } }, box };
}

const ON = { client_acceptance: true, receiving_flow: 'stores_to_purchase' };
const OFF = { client_acceptance: false, receiving_flow: 'purchase_to_stores' };

console.log('\n[1] what was dispatched, and what is still pending a decision');
const DISPATCHES = [
  { id: 'dc1', so_id: 'so-1', items: [{ product_id: 'p1', qty: 8 }, { product_id: 'p2', qty: 5 }] },
  { id: 'dc2', so_id: 'so-1', items: [{ product_id: 'p1', qty: 2 }] },
];
let st = mkState(baseSO(), DISPATCHES, [], ON);
let review = sandbox.soClientReview(st, st.sales_orders[0]);
check('two items were dispatched, each summed across both challans',
  review.items.map(i => [i.product_id, i.dispatched]).sort(), [['p1', 10], ['p2', 5]]);
check('nothing decided yet, everything is pending',
  review.items.map(i => i.pending), [10, 5]);
check('so nothing is reviewed', review.allReviewed, false);
check('and nothing is rejected', review.anyRejected, false);
check('a totals-only row (nothing dispatched) never appears',
  sandbox.soClientReview(mkState(baseSO(), [], [], ON), baseSO()).items, []);

console.log('\n[2] accepting part of an item leaves the rest pending');
let { ctx, box } = mkCtx(st);
sandbox.soApplyClientReview('so-1', { p1: { accept: 6 } }, ctx);
review = sandbox.soClientReview(box.state, box.state.sales_orders[0]);
check('6 accepted', review.items.find(i => i.product_id === 'p1').accepted, 6);
check('4 still pending', review.items.find(i => i.product_id === 'p1').pending, 4);
check('the other item is untouched', review.items.find(i => i.product_id === 'p2').pending, 5);
check('a notification went to Purchase',
  box.state.notifications[0].role, 'Purchase');

console.log('\n[3] a decision can never exceed what is still pending');
({ ctx, box } = mkCtx(st));
sandbox.soApplyClientReview('so-1', { p1: { accept: 999 } }, ctx);
review = sandbox.soClientReview(box.state, box.state.sales_orders[0]);
check('accepting "999" clamps to the 10 that actually shipped',
  review.items.find(i => i.product_id === 'p1').accepted, 10);
check('nothing is left pending on that item', review.items.find(i => i.product_id === 'p1').pending, 0);

console.log('\n[4] once a unit is decided, it never comes back to pending');
({ ctx, box } = mkCtx(st));
sandbox.soApplyClientReview('so-1', { p1: { accept: 6 } }, ctx);
sandbox.soApplyClientReview('so-1', { p1: { reject: 10, note: 'wrong model' } }, ctx);
review = sandbox.soClientReview(box.state, box.state.sales_orders[0]);
const p1After = review.items.find(i => i.product_id === 'p1');
check('the 6 already accepted stay accepted', p1After.accepted, 6);
check('the reject request clamps to the 4 that were still free, not the 10 asked for',
  p1After.rejected, 4);
check('pending is exhausted, not negative', p1After.pending, 0);
check('the note is kept', p1After.note, 'wrong model');
check('the item reads as partly rejected', p1After.status, 'Partly rejected');

console.log('\n[5] "accept whole order" is the same write, not a second path');
({ ctx, box } = mkCtx(st));
sandbox.soAcceptWholeOrder('so-1', Object.assign({}, ctx, { state: box.state }));
review = sandbox.soClientReview(box.state, box.state.sales_orders[0]);
check('every pending unit is accepted', review.items.map(i => i.pending), [0, 0]);
check('so the order reads fully reviewed', review.allReviewed, true);
check('and cleanly, nothing rejected', review.anyRejected, false);
sandbox.soAcceptWholeOrder('so-1', Object.assign({}, ctx, { state: box.state }));
check('a second "accept whole order" with nothing left to accept does not throw, and leaves the review exactly as it was',
  sandbox.soClientReview(box.state, box.state.sales_orders[0]).allReviewed, true);

console.log('\n[6] partial acceptance rejects nothing, and blocks nothing by itself');
({ ctx, box } = mkCtx(mkState(baseSO(), DISPATCHES, [], ON)));
sandbox.soApplyClientReview('so-1', { p1: { accept: 10 } }, ctx);
review = sandbox.soClientReview(box.state, box.state.sales_orders[0]);
check('p1 fully accepted', review.items.find(i => i.product_id === 'p1').status, 'Accepted');
check('p2 still pending, so the order is not fully reviewed yet',
  review.allReviewed, false);

console.log('\n[7] the order status is gated behind the workflow key, not assumed on');
// wf() reads window.__opcWorkflow at CALL TIME — it is a fact about the
// organization the whole session is in, not something carried on a state
// object — so the flag has to be set immediately before each call, exactly
// the way a real session only ever has one org's workflow loaded at once.
const dispatchedSO = () => Object.assign({}, baseSO(), { status: 'Ready to Dispatch' });
const stOn = mkState(dispatchedSO(), DISPATCHES, [], ON);
sandbox.__opcWorkflow = ON;
check('with the flag ON and nothing reviewed yet, the strip shows Pending Client Acceptance',
  sandbox.soDerivedStatus(stOn, stOn.sales_orders[0]), 'Pending Client Acceptance');
const stOff = mkState(dispatchedSO(), DISPATCHES, [], OFF);
sandbox.__opcWorkflow = OFF;
check('with the flag OFF, the exact same facts read as they always did (Fully Delivered)',
  sandbox.soDerivedStatus(stOff, stOff.sales_orders[0]), 'Fully Delivered');
sandbox.__opcWorkflow = ON;
({ ctx, box } = mkCtx(stOn));
sandbox.soAcceptWholeOrder('so-1', ctx);
check('once fully accepted (flag on), the derived status moves on',
  sandbox.soDerivedStatus(box.state, box.state.sales_orders[0]), 'Client Accepted');
check('a rejection keeps it at Pending Client Acceptance, not Client Accepted', (() => {
  const st2 = mkState(dispatchedSO(), DISPATCHES, [], ON);
  sandbox.__opcWorkflow = ON;
  const c2 = mkCtx(st2);
  sandbox.soApplyClientReview('so-1', { p1: { reject: 10 }, p2: { accept: 5 } }, c2.ctx);
  return sandbox.soDerivedStatus(c2.box.state, c2.box.state.sales_orders[0]);
})(), 'Pending Client Acceptance');

console.log('\n[8] the shared lifecycle array — nothing else moved');
const L = sandbox.SO_LIFECYCLE;
const idx = s => L.indexOf(s);
check('the two new stages exist', [idx('Pending Client Acceptance'), idx('Client Accepted')].every(i => i >= 0), true);
check('both sit strictly between Fully Delivered and Invoiced',
  idx('Fully Delivered') < idx('Pending Client Acceptance')
    && idx('Pending Client Acceptance') < idx('Client Accepted')
    && idx('Client Accepted') < idx('Invoiced'), true);
const HISTORIC_ORDER = ['Draft','Pending Approval','Approved','Procurement Started','Material Received',
  'Ready to Dispatch','Partially Delivered','Fully Delivered','Invoiced','Payment Pending','Fully Paid','Closed'];
let pairsOk = true;
for (let i = 0; i < HISTORIC_ORDER.length; i++) for (let j = i + 1; j < HISTORIC_ORDER.length; j++) {
  if (!(idx(HISTORIC_ORDER[i]) < idx(HISTORIC_ORDER[j]))) pairsOk = false;
}
check('every historic status pair keeps its original relative order', pairsOk, true);

console.log('\n[9] a rejection is TWO questions — has Purchase re-ordered, and has the client got it');
// 10 required, all dispatched, 6 accepted, 4 rejected. Nothing re-ordered yet.
const rejSO = () => Object.assign({}, baseSO(), { status: 'Ready to Dispatch' });
const stR = mkState(rejSO(), DISPATCHES, [], ON);
sandbox.__opcWorkflow = ON;
let cR = mkCtx(stR);
// p2 is also part of this fixture's DISPATCHES (5 units) — decide it cleanly
// first so the outstanding/unfulfilled figures below are about p1 alone.
sandbox.soApplyClientReview('so-1', { p2: { accept: 5 } }, cR.ctx);
sandbox.soApplyClientReview('so-1', { p1: { accept: 6, reject: 4 } }, cR.ctx);
let outstanding = sandbox.soRejectedOutstanding(cR.box.state, cR.box.state.sales_orders[0]);
check('Purchase still needs to order 4 more of p1', outstanding, { p1: 4 });
let unfulfilled = sandbox.soUnfulfilled(cR.box.state, cR.box.state.sales_orders[0]);
check('and the client is owed 4 of p1', unfulfilled, { p1: 4 });

// Purchase places a replacement PO for exactly the 4 rejected — before it has
// arrived, ordering is satisfied but fulfilment is NOT. The original PO that
// covered the first 10 units has to be in the fixture too, or "onPO" never
// reaches the required baseline and the netting has nothing to net against.
const ORIGINAL_AND_REPLACEMENT_PO = [
  { id: 'po-1', so_id: 'so-1', status: 'Issued', items: [{ product_id: 'p1', qty: 10 }] },
  { id: 'po-r1', so_id: 'so-1', status: 'Issued', items: [{ product_id: 'p1', qty: 4 }] },
];
let stR2 = Object.assign({}, cR.box.state, { vendor_pos: ORIGINAL_AND_REPLACEMENT_PO });
outstanding = sandbox.soRejectedOutstanding(stR2, stR2.sales_orders[0]);
check('once the replacement PO exists, Purchase does not need to order again',
  outstanding, {});
unfulfilled = sandbox.soUnfulfilled(stR2, stR2.sales_orders[0]);
check('but the client still does not have it — closing must still be blocked',
  unfulfilled, { p1: 4 });

// The replacement is received and dispatched — a THIRD challan for the same
// product against the same SO. The in/out cycle must not be capped by what
// was already sent once.
const stR3 = Object.assign({}, stR2, {
  outward_dispatches: DISPATCHES.concat([{ id: 'dc3', so_id: 'so-1', items: [{ product_id: 'p1', qty: 4 }] }]),
});
const reviewR3 = sandbox.soClientReview(stR3, stR3.sales_orders[0]);
check('the replacement shipment is visible — dispatched climbs to 14',
  reviewR3.items.find(i => i.product_id === 'p1').dispatched, 14);
check('and it shows up as freshly pending, not swallowed by the earlier decision',
  reviewR3.items.find(i => i.product_id === 'p1').pending, 4);
let cR3 = mkCtx(stR3);
sandbox.soApplyClientReview('so-1', { p1: { accept: 4 } }, cR3.ctx);
unfulfilled = sandbox.soUnfulfilled(cR3.box.state, cR3.box.state.sales_orders[0]);
check('the client has now had every unit accepted — nothing left owed',
  unfulfilled, {});
check('the rejection stays on the permanent record even after remediation',
  sandbox.soClientReview(cR3.box.state, cR3.box.state.sales_orders[0]).anyRejected, true);

console.log('\n[10] the extra ordering need lands on exactly one row, never doubled');
({ ctx, box } = mkCtx(stR));                                // 4 owed on p1, nothing ordered
sandbox.__opcWorkflow = ON;
const twoLineSO = {
  id: 'so-2', so_no: 'SO/FY26/0002', customer_id: 'c1', status: 'Ready to Dispatch',
  lines: [
    { id: 'la', bundle_qty: 1, unit_price: 0, components: [{ product_id: 'p1', qty: 6, sell: 0 }] },
    { id: 'lb', bundle_qty: 1, unit_price: 0, components: [{ product_id: 'p1', qty: 4, sell: 0 }] },
  ], invoices: [], extra: {},
};
const stTwoLine = mkState(twoLineSO, [{ id: 'dcx', so_id: 'so-2', items: [{ product_id: 'p1', qty: 10 }] }], [], ON);
sandbox.__opcWorkflow = ON;
const cTwo = mkCtx(stTwoLine);
sandbox.soApplyClientReview('so-2', { p1: { accept: 6, reject: 4 } }, cTwo.ctx);
const twoLineRows = sandbox.allocBuildRows(cTwo.box.state, cTwo.box.state.sales_orders[0]);
check('one row for the item on each line', twoLineRows.length, 2);
check('the whole rejection lands on exactly one of them, not both',
  twoLineRows.filter(r => r.replacementQty > 0).length, 1);
check('and the total extra offered across both rows is exactly 4, not 8',
  twoLineRows.reduce((a, r) => a + (r.replacementQty || 0), 0), 4);

console.log('\n[11] with the flag off, none of this exists');
check('soRejectedOutstanding is empty with the flag off',
  sandbox.soRejectedOutstanding(mkState(baseSO(), DISPATCHES, [], OFF), baseSO()), {});
check('soUnfulfilled is empty with the flag off',
  sandbox.soUnfulfilled(mkState(baseSO(), DISPATCHES, [], OFF), baseSO()), {});

console.log('\n[12] wfOn is guarded — this file must survive being loaded without permissions.jsx');
// status-check.js sandboxes utils.jsx alone; a bare `wfOn(...)` reference
// there threw ReferenceError and failed every status assertion, not just the
// ones about this feature.
const utilsSrc = fs.readFileSync(path.join(dir, 'src', 'utils.jsx'), 'utf8');
check("soDerivedStatus never calls wfOn without checking it exists first",
  /if \(typeof wfOn === 'function' && wfOn\('client_acceptance'\)/.test(utilsSrc), true);
check("soRejectedOutstanding guards the same way",
  (utilsSrc.match(/typeof wfOn === 'function' && wfOn\('client_acceptance'\)/g) || []).length >= 3, true);

console.log('\n[13] wired into the screens, gated the same way everywhere');
const soJsx = fs.readFileSync(path.join(dir, 'src', 'screens-so.jsx'), 'utf8');
check('the panel is mounted', /ClientReviewPanel\s+so=\{so\}/.test(soJsx), true);
check('the historic 8-badge strip literal is untouched',
  /\['Draft','Approved','Procurement Started','Material Received','Ready to Dispatch','Invoiced','Fully Paid','Closed'\]/.test(soJsx), true);
check('the extended strip only ever appears behind the workflow flag',
  /wfOn\('client_acceptance'\)\s*\n\s*\? \[/.test(soJsx), true);
check('Confirm & Close is gated behind the same flag', /wfOn\('client_acceptance'\) && \['Purchase', 'Org Admin'\]/.test(soJsx), true);
check('Confirm & Close gates on fulfilment (soUnfulfilled), not merely on review',
  /soUnfulfilled/.test(soJsx), true);
const allocJsx = fs.readFileSync(path.join(dir, 'src', 'screens-alloc.jsx'), 'utf8');
check('the allocator asks about rejection-driven extra need',
  /soRejectedOutstanding/.test(allocJsx), true);
const idxHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
check('the file is actually loaded by the page', /src\/screens-client-review\.jsx/.test(idxHtml), true);
check('the importer is Purchase/Org Admin only -- Client Facing sends a request instead, see client-requests-check',
  /\['Purchase', 'Org Admin'\]/.test(fs.readFileSync(path.join(dir, 'src', 'screens-import.jsx'), 'utf8')), true);
check('the panel is ALSO mounted on SCM Tracking -- a role whose only two pages are Item Requests and SCM Tracking still has somewhere to decide',
  /ClientReviewPanel\s+so=\{so\}/.test(fs.readFileSync(path.join(dir, 'src', 'screens-scm.jsx'), 'utf8')), true);

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - the client can accept or reject what shipped, a rejection can be re-procured, and no other org ever sees any of it');
process.exit(bad ? 1 : 0);
