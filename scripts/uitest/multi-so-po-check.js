#!/usr/bin/env node
/**
 * OP Central — a vendor PO shared across more than one Sales Order
 * ---------------------------------------------------------------------------
 * Five SOs can independently need the same item; today Purchase would place
 * five separate POs to the same vendor for it. This lets one PO carry every
 * SO's own quantity (`it.so_alloc`), and lets GRN decide — with a smart
 * suggestion, never an automatic decision — how a receipt splits across them
 * (`grnItem.so_split`). See docs/multi-so-vendor-po.md.
 *
 *   ADDITIVE, NOT A MIGRATION   so_alloc/so_split are optional keys on
 *     existing jsonb array elements. Absent means exactly what it always
 *     meant — the whole line/receipt belongs to po.so_id — so a single-SO PO
 *     (the overwhelming majority, forever) is provably unaffected. This file
 *     proves that identity directly: every helper, run with no so_alloc/
 *     so_split anywhere, must match the historic it.qty / po.so_id===so.id
 *     math exactly.
 *   NEVER A 1-ENTRY ARRAY   so_alloc/so_split only exist when ≥2 SOs
 *     genuinely share a line — a second, redundant way to say "100% to one
 *     SO" would violate "one definition per question."
 *   THE SUGGESTION NEVER DECIDES   suggestSoSplit only ranks and proposes;
 *     nothing in this file (or the feature) writes so_alloc/so_split from a
 *     suggestion without a human submitting it.
 *
 * This is Phase 1 (foundation) of a larger rollout — see the plan this was
 * built from. At this point nothing in the real UI can yet create a shared
 * PO; these are hand-built fixtures, exactly how receipt-engine-check.js
 * already builds its own.
 *
 * Usage: node scripts/uitest/multi-so-po-check.js [path-to-frontend]
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

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

console.log("\n[1] fallback identity -- a plain single-SO PO/GRN answers exactly as it.qty / po.so_id===so.id always did");
{
  const po = { id: 'po-1', so_id: 'so-1', vendor_id: 'v1', items: [{ product_id: 'p1', qty: 10, rate: 100 }] };
  check('poLineSoQty for the owning SO is the raw qty', sandbox.poLineSoQty(po, 'p1', 'so-1'), 10);
  check('poLineSoQty for any OTHER so is 0 -- never leaks', sandbox.poLineSoQty(po, 'p1', 'so-2'), 0);
  check('poLinkedSoIds is just the one so_id', sandbox.poLinkedSoIds(po), ['so-1']);
  check('poServesSO true for the owner', sandbox.poServesSO(po, 'so-1'), true);
  check('poServesSO false for anyone else', sandbox.poServesSO(po, 'so-2'), false);
  check('poSoAmount is the whole PO value for the owning SO', sandbox.poSoAmount(po, 'so-1'), 1000);
  check('poSoAmount is 0 for any other SO', sandbox.poSoAmount(po, 'so-2'), 0);

  const grnItem = { product_id: 'p1', ordered: 10, received: 10, accepted: 10, rejected: 0, to_pool: 0 };
  check('grnLineSoQty for the PO\'s own so_id is the accepted qty', sandbox.grnLineSoQty(grnItem, po, 'so-1'), 10);
  check('grnLineSoQty for any other so is 0', sandbox.grnLineSoQty(grnItem, po, 'so-2'), 0);
}

console.log('\n[2] a genuinely shared line -- so_alloc / so_split are read correctly, never a 1-entry array assumed elsewhere');
{
  const po = {
    id: 'po-2', so_id: 'so-a', vendor_id: 'v1',
    items: [{ product_id: 'p1', qty: 16, rate: 50, so_alloc: [{ so_id: 'so-a', qty: 10 }, { so_id: 'so-b', qty: 6 }] }],
  };
  check('poLineSoQty splits correctly for so-a', sandbox.poLineSoQty(po, 'p1', 'so-a'), 10);
  check('poLineSoQty splits correctly for so-b', sandbox.poLineSoQty(po, 'p1', 'so-b'), 6);
  check('poLineSoQty is 0 for an unrelated so', sandbox.poLineSoQty(po, 'p1', 'so-c'), 0);
  check('poLinkedSoIds lists both, so_id first', sandbox.poLinkedSoIds(po), ['so-a', 'so-b']);
  check('poSoAmount for so-a is its own share only, not the whole PO', sandbox.poSoAmount(po, 'so-a'), 500);
  check('poSoAmount for so-b is its own share only', sandbox.poSoAmount(po, 'so-b'), 300);
  check('the two shares add up to the PO total (16 * 50)', sandbox.poSoAmount(po, 'so-a') + sandbox.poSoAmount(po, 'so-b'), 800);

  const grnItem = { product_id: 'p1', ordered: 16, received: 16, accepted: 16, rejected: 0, to_pool: 0,
    so_split: [{ so_id: 'so-a', qty: 10 }, { so_id: 'so-b', qty: 6 }] };
  check('grnLineSoQty reads the real split for so-a', sandbox.grnLineSoQty(grnItem, po, 'so-a'), 10);
  check('grnLineSoQty reads the real split for so-b', sandbox.grnLineSoQty(grnItem, po, 'so-b'), 6);
}

console.log('\n[3] suggestSoSplit ranks by priority then delivery date then SO no -- a suggestion, nothing is written');
{
  const SOS = {
    'so-std': { so_no: 'SO/FY26/0010', priority: 'Standard', expected: '2026-10-01' },
    'so-urg': { so_no: 'SO/FY26/0020', priority: 'Urgent', expected: '2026-10-15' },
    'so-crit-late': { so_no: 'SO/FY26/0030', priority: 'Critical', expected: '2026-10-20' },
    'so-crit-early': { so_no: 'SO/FY26/0005', priority: 'Critical', expected: '2026-10-03' },
  };
  const getSO = id => SOS[id];
  const allocations = [
    { so_id: 'so-std', orderedQty: 10, alreadyReceived: 0 },
    { so_id: 'so-urg', orderedQty: 5, alreadyReceived: 0 },
    { so_id: 'so-crit-late', orderedQty: 4, alreadyReceived: 0 },
    { so_id: 'so-crit-early', orderedQty: 6, alreadyReceived: 0 },
  ];
  const { rows, leftover } = sandbox.suggestSoSplit(20, allocations, getSO);
  check('both Critical SOs rank ahead of Urgent and Standard',
    rows.slice(0, 2).map(r => r.so_id), ['so-crit-early', 'so-crit-late']);
  check('between the two Criticals, the earlier delivery date goes first',
    rows[0].so_id, 'so-crit-early');
  check('Urgent ranks ahead of Standard', rows[2].so_id, 'so-urg');
  check('Standard is last', rows[3].so_id, 'so-std');
  check('every SO fully fits inside the 20 accepted -- nothing left over', leftover, 0);
  check('each row is suggested exactly its own full remaining need',
    rows.map(r => r.suggested), [6, 4, 5, 5]);
  check('Standard only gets what is left after everyone ahead of it (20-6-4-5=5 of 10 needed)',
    rows.find(r => r.so_id === 'so-std').suggested, 5);
  check('the reasoning names the SO, its priority and its delivery date',
    rows[0].reason, 'SO/FY26/0005 — Critical, expected 2026-10-03 → suggested 6');

  console.log('\n[3b] an SO with no delivery date is never given a fabricated one');
  const r2 = sandbox.suggestSoSplit(1, [{ so_id: 'so-x', orderedQty: 1, alreadyReceived: 0 }],
    () => ({ so_no: 'SO/FY26/0099', priority: 'Standard', expected: '' }));
  check('says "no delivery date set"', r2.rows[0].reason.includes('no delivery date set'), true);

  console.log('\n[3c] a SO already fully received is dropped, not offered more');
  const r3 = sandbox.suggestSoSplit(5, [
    { so_id: 'so-done', orderedQty: 4, alreadyReceived: 4 },
    { so_id: 'so-open', orderedQty: 3, alreadyReceived: 1 },
  ], id => SOS[id] || { so_no: id, priority: 'Standard', expected: '' });
  check('the fulfilled SO never appears in the suggestion at all',
    r3.rows.some(r => r.so_id === 'so-done'), false);
  check('the open SO gets exactly its remaining 2', r3.rows[0].suggested, 2);
  check('the rest is visible as leftover, not silently dropped', r3.leftover, 3);
}

console.log('\n[4] the real migrated call sites agree, on one shared PO spanning two SOs');
{
  const PRODUCTS = [{ id: 'p1', name: 'Switch', code: 'SW-1', buy: 50, sell: 0 }];
  const getProduct = id => PRODUCTS.find(p => p.id === id) || null;

  const soX = { id: 'so-x', so_no: 'SO/FY26/0100', status: 'Procurement Started', customer_id: 'c1',
    lines: [{ id: 'l1', bundle_qty: 1, unit_price: 100, components: [{ product_id: 'p1', qty: 10 }] }],
    pool_alloc: [], invoices: [], extra: {} };
  const soY = { id: 'so-y', so_no: 'SO/FY26/0101', status: 'Procurement Started', customer_id: 'c1',
    lines: [{ id: 'l1', bundle_qty: 1, unit_price: 60, components: [{ product_id: 'p1', qty: 6 }] }],
    pool_alloc: [], invoices: [], extra: {} };
  const poShared = {
    id: 'po-shared', po_no: 'VPO/FY26/0001', so_id: 'so-x', vendor_id: 'v1', status: 'Issued', amount: 800,
    items: [{ product_id: 'p1', qty: 16, rate: 50, so_alloc: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }] }],
  };
  const grn1 = {
    id: 'grn-1', grn_no: 'GRN/FY26/0001', po_id: 'po-shared', date: '2026-10-01',
    items: [{ product_id: 'p1', qty: 16, received: 16, accepted: 16, rejected: 0, to_pool: 0,
      so_split: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }] }],
  };
  const state = {
    vendor_pos: [poShared], grns: [grn1], sales_orders: [soX, soY],
    outward_dispatches: [], payments: [], pool: [], config: {},
  };
  const soSubtotal = so => (so.lines || []).reduce((a, l) => a + (Number(l.bundle_qty) || 0) * (Number(l.unit_price) || 0), 0);

  check("soReceivedQty gives SO-X only its own 10, never SO-Y's 6",
    sandbox.soReceivedQty(soX, state).p1, 10);
  check("soReceivedQty gives SO-Y only its own 6, never SO-X's 10",
    sandbox.soReceivedQty(soY, state).p1, 6);

  check('soDerivedStatus sees SO-X as fully received from its own 10/10 share',
    sandbox.soDerivedStatus(state, soX), 'Ready to Dispatch');
  check("soDerivedStatus ALSO sees SO-Y as fully received, from the same shared PO's 6/6 share",
    sandbox.soDerivedStatus(state, soY), 'Ready to Dispatch');

  check('soOutstandingProcurement says SO-X needs nothing more — its 10 is already on the shared PO',
    sandbox.soOutstandingProcurement(state, soX), {});
  check("soOutstandingProcurement says SO-Y needs nothing more either — not fooled into reordering its 6",
    sandbox.soOutstandingProcurement(state, soY), {});

  check("allocBuildRows never re-offers SO-Y's item — its whole need is already on the shared PO",
    sandbox.allocBuildRows(state, soY), []);

  const profX = sandbox.soProfit(state, soX, getProduct);
  check('soProfit commits SO-X to only its own 10×50 = 500, not the whole 16×50 PO',
    profX.committed, 500);
  const profY = sandbox.soProfit(state, soY, getProduct);
  check('soProfit commits SO-Y to only its own 6×50 = 300',
    profY.committed, 300);

  const metX = sandbox.soMetrics(state, soX, soSubtotal);
  check("soMetrics' vendor spend for SO-X is its own 500 share of the shared PO, not the full 800",
    metX.vendorSpend, 500);
  const metY = sandbox.soMetrics(state, soY, soSubtotal);
  check("soMetrics' vendor spend for SO-Y is its own 300 share",
    metY.vendorSpend, 300);

  check('soFullyReceived is true for SO-X from its own share', sandbox.soFullyReceived(state, soX), true);
  check('soFullyReceived is true for SO-Y from its own share too', sandbox.soFullyReceived(state, soY), true);
}

console.log('\n[5] a client rejection replaced through a PO combined with ANOTHER SO is correctly recognized as already reordered');
{
  sandbox.__opcWorkflow = { client_acceptance: true };
  const soR = { id: 'so-r', so_no: 'SO/FY26/0102', status: 'Pending Client Acceptance', customer_id: 'c1',
    lines: [{ id: 'l1', bundle_qty: 1, unit_price: 40, components: [{ product_id: 'p2', qty: 4 }] }],
    pool_alloc: [], invoices: [], extra: { client_review: { items: { p2: { accepted: 2, rejected: 2 } } } } };
  const soZ = { id: 'so-z', so_no: 'SO/FY26/0103', status: 'Procurement Started', customer_id: 'c1',
    lines: [{ id: 'l1', bundle_qty: 1, unit_price: 30, components: [{ product_id: 'p2', qty: 3 }] }],
    pool_alloc: [], invoices: [], extra: {} };
  const poOrigR = { id: 'po-orig-r', po_no: 'VPO/FY26/0002', so_id: 'so-r', vendor_id: 'v1', status: 'Material Received', amount: 80,
    items: [{ product_id: 'p2', qty: 4, rate: 20 }] };
  const poReplace = {
    id: 'po-replace', po_no: 'VPO/FY26/0003', so_id: 'so-z', vendor_id: 'v1', status: 'Issued', amount: 100,
    items: [{ product_id: 'p2', qty: 5, rate: 20, so_alloc: [{ so_id: 'so-z', qty: 3 }, { so_id: 'so-r', qty: 2 }] }],
  };
  const state = {
    vendor_pos: [poOrigR, poReplace], grns: [], sales_orders: [soR, soZ],
    outward_dispatches: [{ id: 'd1', so_id: 'so-r', status: 'Delivered', items: [{ product_id: 'p2', qty: 4 }] }],
    payments: [], pool: [], config: {},
  };

  check("soRejectedOutstanding sees SO-R's 2 rejected units as already replaced by the combined PO, not still owed",
    sandbox.soRejectedOutstanding(state, soR), {});
  check("soOutstandingProcurement agrees — SO-R needs nothing more ordered",
    sandbox.soOutstandingProcurement(state, soR), {});
  check("soOutstandingProcurement for SO-Z isn't confused by SO-R's rejection riding the same PO — SO-Z's own 3 is covered too",
    sandbox.soOutstandingProcurement(state, soZ), {});
  sandbox.__opcWorkflow = null;
}

console.log('\n[6] shrinkPOLineForSO touches only the calling SO\'s own share — Phase 3\'s "subtlest" write path');
{
  const poXY = { id: 'po-xy', so_id: 'so-x', items: [] };   // so_id used only for the collapse rule below
  const shared = { product_id: 'p1', qty: 16, rate: 50, so_alloc: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }] };

  let r = sandbox.shrinkPOLineForSO(shared, poXY, 'so-x', 4);
  check('shrinking SO-X by 4 takes exactly 4', r.taken, 4);
  check("SO-X's own share drops to 6, SO-Y's 6 is untouched", r.item.so_alloc, [{ so_id: 'so-x', qty: 6 }, { so_id: 'so-y', qty: 6 }]);
  check('the line total drops by the same 4 (16 -> 12)', r.item.qty, 12);

  r = sandbox.shrinkPOLineForSO(shared, poXY, 'so-x', 999);
  check("asking for more than SO-X's 10 share only ever takes SO-X's 10", r.taken, 10);
  check("SO-Y's 6 is never touched by SO-X's own shrink, even when SO-X's ask is unbounded", r.item.so_alloc.find(a => a.so_id === 'so-y').qty, 6);
  check("the sole survivor isn't po.so_id (so-y, not so-x) — stays an explicit entry, never silently falls back",
    r.item.so_alloc, [{ so_id: 'so-y', qty: 6 }]);

  r = sandbox.shrinkPOLineForSO(shared, poXY, 'so-y', 999);
  check("shrinking SO-Y's whole 6, leaving SO-X (the PO's own so_id) alone, collapses back to the plain default",
    r.item.so_alloc, undefined);
  check('its qty still correctly drops to just SO-X\'s remaining 10', r.item.qty, 10);

  const plain = { product_id: 'p2', qty: 8, rate: 20 };
  r = sandbox.shrinkPOLineForSO(plain, { id: 'po-plain', so_id: 'so-x', items: [] }, 'so-x', 3);
  check('an ordinary (non-shared) line shrinks exactly as it always did', [r.taken, r.item.qty], [3, 5]);
}

// A ctx whose mutate() applies synchronously to a boxed state, same convention
// receipt-engine-check.js uses, so postReceiptForPO/vgReceiveComponents can be
// driven directly without a React store.
function makeCtx(state) {
  const box = { state };
  const ctx = {
    state: box.state, mutate: (fn) => { box.state = fn(box.state); }, toast: null,
    addToPool: async () => {}, getProduct: () => null,
    getVendor: () => ({ name: 'Vendor' }), getUser: () => ({ name: 'User' }), currentUser: 'u1',
  };
  return { box, ctx };
}

(async () => {

console.log('\n[7] postReceiptForPO stamps the real split and invoices EVERY linked SO that received units this event');
{
  const poShared = {
    id: 'po-shared2', po_no: 'VPO/FY26/0010', so_id: 'so-x', vendor_id: 'v1', status: 'Issued', amount: 800, ebill: {},
    items: [{ product_id: 'p1', qty: 16, rate: 50, so_alloc: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }] }],
  };
  const { box, ctx } = makeCtx({
    vendor_pos: [poShared], grns: [], vendor_invoices: [],
    sales_orders: [{ id: 'so-x', so_no: 'SO/FY26/0100' }, { id: 'so-y', so_no: 'SO/FY26/0101' }],
    notifications: [],
  });
  const invoiced = [];
  const realAutoInvoiceSO = sandbox.autoInvoiceSO;
  sandbox.autoInvoiceSO = (soId) => { invoiced.push(soId); return null; };
  const items = [{ product_id: 'p1', qty: 16, received: 16, rejected: 0, to_pool: 0,
    so_split: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }] }];
  const res = await sandbox.postReceiptForPO(poShared, items, { grnDate: '2026-10-05', lr: '' }, ctx);
  sandbox.autoInvoiceSO = realAutoInvoiceSO;

  check('the GRN item carries the real split, not a trivial default', res.grn.items[0].so_split,
    [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }]);
  check('BOTH linked SOs are invoiced from this one GRN event — not just po.so_id',
    invoiced.slice().sort(), ['so-x', 'so-y']);
  check('the PO itself still resolves PO-centric, unaffected by the split', box.state.vendor_pos[0].status, 'Material Received');
}

console.log('\n[8] vgReceiveComponents caps a shared line to the calling SO\'s own share — never dips into another linked SO\'s');
{
  const poShared = {
    id: 'po-shared3', po_no: 'VPO/FY26/0011', so_id: 'so-x', vendor_id: 'v1', status: 'Issued', amount: 140, ebill: {},
    items: [{ product_id: 'p1', qty: 7, rate: 20, so_alloc: [{ so_id: 'so-x', qty: 4 }, { so_id: 'so-y', qty: 3 }] }],
  };
  const soX = { id: 'so-x', so_no: 'SO/FY26/0100', extra: {} };
  const { box, ctx } = makeCtx({
    vendor_pos: [poShared], grns: [], vendor_invoices: [],
    sales_orders: [soX, { id: 'so-y', so_no: 'SO/FY26/0101', extra: {} }],
    notifications: [], vendors: [{ id: 'v1', name: 'Vendor' }], config: {},
  });
  const realAutoInvoiceSO = sandbox.autoInvoiceSO;
  sandbox.autoInvoiceSO = () => null;
  // SO-X asks for 10 — far more than its own 4 share of the shared line.
  const r = await sandbox.vgReceiveComponents(soX, [{ product_id: 'p1', qty: 10, name: 'Item 1' }], ctx);
  sandbox.autoInvoiceSO = realAutoInvoiceSO;

  check('exactly 10 units were received in total (4 from the shared PO + a 6-unit shortfall PO)', r.units, 10);
  check('a second PO was auto-created for the 6 SO-X could not take from the shared line', box.state.vendor_pos.length, 2);
  const sharedGrnItem = box.state.grns.flatMap(g => (g.items || []).map(it => ({ it, po_id: g.po_id })))
    .find(x => x.po_id === 'po-shared3');
  check('the shared PO\'s own GRN line is capped to SO-X\'s 4, never SO-Y\'s 3',
    sharedGrnItem.it.accepted, 4);
  check('it is stamped with a trivial one-entry split naming SO-X — this event was 100% SO-X\'s',
    sharedGrnItem.it.so_split, [{ so_id: 'so-x', qty: 4 }]);
  check("SO-Y's own share is untouched — grnLineSoQty for so-y on this line is still 0",
    sandbox.grnLineSoQty(sharedGrnItem.it, poShared, 'so-y'), 0);
  check('the shared PO\'s own ordered split is unmodified by a GRN-sourced receive (only pool diversion shrinks a line)',
    box.state.vendor_pos.find(p => p.id === 'po-shared3').items[0].so_alloc, [{ so_id: 'so-x', qty: 4 }, { so_id: 'so-y', qty: 3 }]);
}

console.log('\n[9] buildComboPOItems — CreateVendorPOModal\'s "combine with other SOs?" turns rows into real PO lines');
{
  const plainRows = [{ product_id: 'p1', qty: 10, rate: 50, combine: [] }];
  check('an uncombined row stays today\'s exact single-SO shape (no so_alloc at all)',
    sandbox.buildComboPOItems('so-x', plainRows), [{ product_id: 'p1', qty: 10, rate: 50 }]);

  const zeroedCombine = [{ product_id: 'p1', qty: 10, rate: 50, combine: [{ so_id: 'so-y', qty: 0 }] }];
  check('a ticked-but-zeroed combine row never produces a redundant so_alloc',
    sandbox.buildComboPOItems('so-x', zeroedCombine), [{ product_id: 'p1', qty: 10, rate: 50 }]);

  const combined = [{ product_id: 'p1', qty: 10, rate: 50, combine: [{ so_id: 'so-y', qty: 6 }] }];
  check('a real combine produces a 2-entry so_alloc (primary + the combined SO) and sums the qty',
    sandbox.buildComboPOItems('so-x', combined), [{ product_id: 'p1', qty: 16, rate: 50, so_alloc: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }] }]);

  const threeWay = [{ product_id: 'p1', qty: 10, rate: 50, combine: [{ so_id: 'so-y', qty: 6 }, { so_id: 'so-z', qty: 4 }] }];
  check('combining with TWO other SOs produces all three in so_alloc, summed correctly',
    sandbox.buildComboPOItems('so-x', threeWay),
    [{ product_id: 'p1', qty: 20, rate: 50, so_alloc: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }, { so_id: 'so-z', qty: 4 }] }]);

  const mixedRows = [
    { product_id: 'p1', qty: 10, rate: 50, combine: [{ so_id: 'so-y', qty: 6 }] },
    { product_id: 'p2', qty: 3, rate: 20, combine: [] },
  ];
  check('a combined row and a plain row on the SAME PO each keep their own correct shape',
    sandbox.buildComboPOItems('so-x', mixedRows),
    [{ product_id: 'p1', qty: 16, rate: 50, so_alloc: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }] }, { product_id: 'p2', qty: 3, rate: 20 }]);

  check('a row with no quantity at all (own qty 0, nothing combined) is dropped from the PO entirely',
    sandbox.buildComboPOItems('so-x', [{ product_id: 'p3', qty: 0, rate: 10, combine: [] }]), []);
}

console.log('\n[10] Bulk PO — Purchase ticks several SOs up front and places ONE PO for all of them');
{
  const src = fs.readFileSync(path.join(dir, 'src', 'screens-procurement.jsx'), 'utf8');
  check('VendorPOList offers a Bulk PO button', /Bulk PO</.test(src), true);
  check('it opens the dedicated BulkVendorPOModal, not the Single-PO modal', /showBulkPO && <BulkVendorPOModal/.test(src), true);
  check('BulkVendorPOModal is a real, registered component', typeof sandbox.BulkVendorPOModal, 'function');
  check('both Bulk PO and Single PO commit through the same shared path (one definition, not two)',
    /BulkVendorPOModal[\s\S]*?createComboVendorPO\(/.test(src) && /function CreateVendorPOModal[\s\S]*?createComboVendorPO\(/.test(src), true);

  // createComboVendorPO is the function BulkVendorPOModal's submit() calls —
  // exercise it directly the way ticking 3 SOs and a vendor would build it.
  const soA = { id: 'so-a', so_no: 'SO/FY26/0201' };
  const soB = { id: 'so-b', so_no: 'SO/FY26/0202' };
  const soC = { id: 'so-c', so_no: 'SO/FY26/0203' };
  const getSO10 = id => ({ 'so-a': soA, 'so-b': soB, 'so-c': soC })[id];
  const getVendor10 = () => ({ name: 'Acme' });
  const box10 = { state: {
    vendor_pos: [], sales_orders: [
      { ...soA, status: 'Approved' }, { ...soB, status: 'Approved' }, { ...soC, status: 'Approved' },
    ],
    notifications: [], config: {},
  } };
  const ctx10 = { state: box10.state, mutate: fn => { box10.state = fn(box10.state); }, getVendor: getVendor10, getSO: getSO10 };
  // SO-A (primary, ticked first) needs 10, SO-B needs 6, SO-C needs 0 of this
  // item (ticked, but the item isn't shared with it) — exactly what the
  // modal's own `items.map` assembly produces from 3 ticked SOs.
  const items10 = [{ product_id: 'p1', rate: 50, qty: 10, combine: [{ so_id: 'so-b', qty: 6 }, { so_id: 'so-c', qty: 0 }] }];
  const result10 = sandbox.createComboVendorPO({ ...ctx10, primarySoId: 'so-a', vendorId: 'v1', items: items10, expected: '2026-10-20' });
  check('one PO is created', !!result10, true);
  check('it is linked to exactly the SOs that actually had quantity (SO-C contributed 0, so it is not linked)',
    result10.linkedSoIds.sort(), ['so-a', 'so-b']);
  check('its so_alloc carries each real SO\'s own qty, SO-C\'s zero dropped', result10.po.items[0].so_alloc,
    [{ so_id: 'so-a', qty: 10 }, { so_id: 'so-b', qty: 6 }]);
  check('the amount is the combined 16 units at the shared rate', result10.amount, 800);
  check('both linked SOs actually advanced to Procurement Started',
    box10.state.sales_orders.filter(s => ['so-a', 'so-b'].includes(s.id)).map(s => s.status), ['Procurement Started', 'Procurement Started']);
  check('SO-C (never actually allocated anything) is untouched',
    box10.state.sales_orders.find(s => s.id === 'so-c').status, 'Approved');

  // Ticking just ONE SO degrades to an ordinary single-SO PO — Bulk PO works
  // even when "several" turns out to be one.
  box10.state = { ...box10.state, vendor_pos: [], sales_orders: box10.state.sales_orders.map(s => ({ ...s, status: 'Approved' })) };
  const singleResult = sandbox.createComboVendorPO({ ...ctx10, state: box10.state, primarySoId: 'so-a', vendorId: 'v1',
    items: [{ product_id: 'p1', rate: 50, qty: 10, combine: [] }], expected: '2026-10-20' });
  check('a single ticked SO produces a plain PO with no so_alloc at all', singleResult.po.items[0].so_alloc, undefined);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - a shared PO degrades to exactly the historic single-SO behaviour when unused, and the GRN suggestion ranks correctly without ever deciding anything itself');
process.exit(bad ? 1 : 0);

})();
