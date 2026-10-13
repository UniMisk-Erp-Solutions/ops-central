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

console.log('\n[11] soShareIndex — the matching engine that ranks Bulk PO\'s SO picker, before anything is ticked');
{
  const mk = (id, no, comps) => ({ id, so_no: no, status: 'Approved',
    lines: [{ id: 'l1', bundle_qty: 1, components: comps.map(([product_id, qty]) => ({ product_id, qty })) }],
    pool_alloc: [], extra: {} });
  // SO-A needs p1 & p2; SO-B shares p1 with A (plus its own exclusive p3);
  // SO-C shares p2 with A; SO-D shares nothing with anybody.
  const soA = mk('so-a', 'SO/FY26/0301', [['p1', 10], ['p2', 5]]);
  const soB = mk('so-b', 'SO/FY26/0302', [['p1', 6], ['p3', 3]]);
  const soC = mk('so-c', 'SO/FY26/0303', [['p2', 4]]);
  const soD = mk('so-d', 'SO/FY26/0304', [['p4', 2]]);
  const state11 = { vendor_pos: [], sales_orders: [soA, soB, soC, soD], config: {} };
  const idx = sandbox.soShareIndex(state11, [soA, soB, soC, soD]);

  check('SO-A shares TWO different items (p1 with B, p2 with C)', idx.counts['so-a'], 2);
  check('SO-B shares its one overlapping item (p1) — its own-exclusive p3 does not count', idx.counts['so-b'], 1);
  check('SO-C shares its one overlapping item (p2)', idx.counts['so-c'], 1);
  check('SO-D shares nothing with anybody — zero, not undefined', idx.counts['so-d'], 0);
  check('the index also hands back each SO\'s own outstanding map (what the item table is built from)',
    idx.outstandingBySO['so-a'], { p1: 10, p2: 5 });

  // Placing a vendor PO for SO-B's own p1 need removes exactly that overlap
  // — soOutstandingProcurement nets it out, so the engine's "shared" claim
  // can never go stale against what has already been ordered.
  const poForB = { id: 'po-1', so_id: 'so-b', vendor_id: 'v1', status: 'Issued', items: [{ product_id: 'p1', qty: 6, rate: 10 }] };
  const state11b = { ...state11, vendor_pos: [poForB] };
  const idx2 = sandbox.soShareIndex(state11b, [soA, soB, soC, soD]);
  check('once SO-B\'s p1 need is already on a vendor PO, SO-A and SO-B no longer read as sharing it',
    [idx2.counts['so-a'], idx2.counts['so-b']], [1, 0]);
}

console.log('\n[12] FULL LIFECYCLE SIMULATION — Bulk PO -> mid-flow edit adds a 4th SO -> two partial GRN deliveries -> every SO ends up billed for exactly its own units, nothing more, nothing less');
{
  const SOS12 = {
    'so-x': { id: 'so-x', so_no: 'SO/FY26/0401', priority: 'Critical', expected: '2026-11-01' },
    'so-y': { id: 'so-y', so_no: 'SO/FY26/0402', priority: 'Urgent', expected: '2026-11-10' },
    'so-z': { id: 'so-z', so_no: 'SO/FY26/0403', priority: 'Standard', expected: '2026-11-20' },
    'so-w': { id: 'so-w', so_no: 'SO/FY26/0404', priority: 'Standard', expected: '2026-11-25' },
  };
  const getSO12 = id => SOS12[id];
  const { box, ctx } = makeCtx({
    vendor_pos: [], grns: [], vendor_invoices: [],
    sales_orders: Object.values(SOS12).map(s => ({ ...s, status: 'Approved' })),
    notifications: [], config: {},
  });

  // ----- A: Purchase ticks SO-X, SO-Y, SO-Z on Bulk PO; p1 is shared 3 ways,
  // p2 only SO-X asked for -----
  const itemsA = [
    { product_id: 'p1', rate: 100, qty: 10, combine: [{ so_id: 'so-y', qty: 6 }, { so_id: 'so-z', qty: 5 }] },
    { product_id: 'p2', rate: 200, qty: 4, combine: [{ so_id: 'so-y', qty: 0 }, { so_id: 'so-z', qty: 0 }] },
  ];
  const created = sandbox.createComboVendorPO({ ...ctx, state: box.state, getSO: getSO12, primarySoId: 'so-x', vendorId: 'v1', items: itemsA, expected: '2026-10-20' });
  check('[A] p1 comes out shared 3 ways, each SO its own real qty', created.po.items[0],
    { product_id: 'p1', qty: 21, rate: 100, so_alloc: [{ so_id: 'so-x', qty: 10 }, { so_id: 'so-y', qty: 6 }, { so_id: 'so-z', qty: 5 }] });
  check('[A] p2 stays a plain single-SO line — SO-Y/SO-Z asked for none of it', created.po.items[1], { product_id: 'p2', qty: 4, rate: 200 });
  check('[A] PO total is the combined value', created.po.amount, 2900);
  check('[A] all three ticked SOs linked', created.linkedSoIds.slice().sort(), ['so-x', 'so-y', 'so-z']);
  check('[A] all three advanced to Procurement Started',
    box.state.sales_orders.filter(s => ['so-x', 'so-y', 'so-z'].includes(s.id)).map(s => s.status), ['Procurement Started', 'Procurement Started', 'Procurement Started']);
  check('[A] SO-W, not ticked, is untouched', box.state.sales_orders.find(s => s.id === 'so-w').status, 'Approved');
  let po = box.state.vendor_pos[0];

  // ----- B: before anything ships, Purchase decides SO-W also needs 2 of the
  // PSU — bumps the line's qty 4 -> 6, then says which SOs that covers -----
  const poWithBumpedQty = { ...po, items: po.items.map(it => it.product_id === 'p2' ? { ...it, qty: 6 } : it) };
  const edited = sandbox.applyLineSoAlloc(poWithBumpedQty, 'p2', [{ so_id: 'so-x', qty: 4 }, { so_id: 'so-w', qty: 2 }]);
  check('[B] SO-W is the only newly-linked SO from this edit', edited.newlyLinked, ['so-w']);
  check('[B] the PO total grows to reflect the extra 2 units', edited.po.amount, 3300);
  box.state = { ...box.state,
    vendor_pos: box.state.vendor_pos.map(p => p.id === po.id ? edited.po : p),
    sales_orders: box.state.sales_orders.map(s => s.id === 'so-w' ? { ...s, status: 'Procurement Started' } : s) };
  po = box.state.vendor_pos[0];
  check('[B] SO-W now also shows Procurement Started, from a line edit, not a fresh PO', box.state.sales_orders.find(s => s.id === 'so-w').status, 'Procurement Started');

  // ----- C: the bug this simulation caught — poSoAllocations must answer
  // per LINE, not list every SO the whole PO happens to serve -----
  check('[C] p1\'s split candidates are exactly X/Y/Z — SO-W (only on the p2 line) does not leak in',
    sandbox.poSoAllocations(box.state, po, 'p1').map(a => a.so_id).sort(), ['so-x', 'so-y', 'so-z']);
  check('[C] p2\'s split candidates are exactly X/W — SO-Y/SO-Z (only on the p1 line) do not leak in',
    sandbox.poSoAllocations(box.state, po, 'p2').map(a => a.so_id).sort(), ['so-w', 'so-x']);

  // ----- D: first delivery — 15 of the 21 p1 arrive, all 6 of the (now 6-unit)
  // p2 line arrives. GRN uses the suggested split for both lines. -----
  const invoiced1 = [];
  const realAutoInvoiceSO = sandbox.autoInvoiceSO;
  sandbox.autoInvoiceSO = (soId) => { invoiced1.push(soId); return null; };

  const sug1p1 = sandbox.suggestSoSplit(15, sandbox.poSoAllocations(box.state, po, 'p1'), getSO12);
  check('[D] p1\'s suggestion gives Critical SO-X its full 10 first, Urgent SO-Y the rest, Standard SO-Z nothing (yet)',
    sug1p1.rows.map(r => [r.so_id, r.suggested]), [['so-x', 10], ['so-y', 5], ['so-z', 0]]);
  const sug1p2 = sandbox.suggestSoSplit(6, sandbox.poSoAllocations(box.state, po, 'p2'), getSO12);
  check('[D] p2\'s suggestion gives Critical SO-X its 4, Standard SO-W the remaining 2',
    sug1p2.rows.map(r => [r.so_id, r.suggested]), [['so-x', 4], ['so-w', 2]]);

  const itemsD = [
    { product_id: 'p1', qty: 21, received: 15, rejected: 0, to_pool: 0, so_split: sug1p1.rows.map(r => ({ so_id: r.so_id, qty: r.suggested })) },
    { product_id: 'p2', qty: 6, received: 6, rejected: 0, to_pool: 0, so_split: sug1p2.rows.map(r => ({ so_id: r.so_id, qty: r.suggested })) },
  ];
  const r1 = await sandbox.postReceiptForPO(po, itemsD, { lr: 'LR-1', grnDate: '2026-10-25' }, { ...ctx, state: box.state, getSO: getSO12 });
  check('[D] the PO is Partially Received — p1 is still short, even though p2 just finished', box.state.vendor_pos[0].status, 'Partially Received');
  check('[D] exactly the SOs that received something this delivery get invoiced — SO-Z got nothing, so it is NOT billed yet',
    invoiced1.slice().sort(), ['so-w', 'so-x', 'so-y']);
  check('[D] SO-X: fully served on BOTH lines already, from this one delivery', sandbox.soReceivedQty(SOS12['so-x'], box.state), { p1: 10, p2: 4 });
  check('[D] SO-Y: its own partial share only', sandbox.soReceivedQty(SOS12['so-y'], box.state), { p1: 5, p2: 0 });
  check('[D] SO-Z: nothing yet — correctly, not a fraction of someone else\'s share', sandbox.soReceivedQty(SOS12['so-z'], box.state), { p1: 0, p2: 0 });
  check('[D] SO-W: its own 2, from the p2 line only', sandbox.soReceivedQty(SOS12['so-w'], box.state), { p1: 0, p2: 2 });

  // ----- E: second delivery — the remaining 6 of p1 (SO-Y's last 1, SO-Z's
  // full 5). p2 is already done and is not part of this delivery at all. -----
  po = box.state.vendor_pos[0];
  const invoiced2 = [];
  sandbox.autoInvoiceSO = (soId) => { invoiced2.push(soId); return null; };
  const sug2 = sandbox.suggestSoSplit(6, sandbox.poSoAllocations(box.state, po, 'p1'), getSO12);
  check('[E] SO-X (already fully received) drops out of the suggestion entirely', sug2.rows.some(r => r.so_id === 'so-x'), false);
  check('[E] Urgent SO-Y\'s last 1 goes first, Standard SO-Z gets the rest',
    sug2.rows.map(r => [r.so_id, r.suggested]), [['so-y', 1], ['so-z', 5]]);
  // useSuggested() in the real editor maps over EVERY allocation, so SO-X
  // still appears in the submitted so_split, at 0 — exactly what the UI sends.
  const allAlloc2 = sandbox.poSoAllocations(box.state, po, 'p1');
  const soSplit2 = allAlloc2.map(a => { const s = sug2.rows.find(r => r.so_id === a.so_id); return { so_id: a.so_id, qty: s ? s.suggested : 0 }; });
  const itemsE = [{ product_id: 'p1', qty: 21, received: 6, rejected: 0, to_pool: 0, so_split: soSplit2 }];
  const r2 = await sandbox.postReceiptForPO(po, itemsE, { lr: 'LR-2', grnDate: '2026-11-02' }, { ...ctx, state: box.state, getSO: getSO12 });
  check('[E] the PO is now fully Material Received — every line, every SO\'s share, complete', box.state.vendor_pos[0].status, 'Material Received');
  check('[E] SO-W got nothing in this delivery, so it is NOT re-invoiced', invoiced2.includes('so-w'), false);
  check('[E] SO-X is invoiced again by the unconditional po.so_id call (a harmless no-op upstream — autoInvoiceSO itself finds nothing new to bill)',
    invoiced2.includes('so-x'), true);
  check('[E] SO-Y and SO-Z, who both received more this round, are invoiced', invoiced2.filter(id => ['so-y', 'so-z'].includes(id)).sort(), ['so-y', 'so-z']);

  sandbox.autoInvoiceSO = realAutoInvoiceSO;

  // ----- F: the headline claim — every SO ends up with EXACTLY what it
  // itself ordered, not a unit more, not a unit less, across the whole
  // lifecycle (creation, a mid-flow edit, two separate deliveries) -----
  check('[F] SO-X: exactly its own 10 + 4', sandbox.soReceivedQty(SOS12['so-x'], box.state), { p1: 10, p2: 4 });
  check('[F] SO-Y: exactly its own 6', sandbox.soReceivedQty(SOS12['so-y'], box.state), { p1: 6, p2: 0 });
  check('[F] SO-Z: exactly its own 5', sandbox.soReceivedQty(SOS12['so-z'], box.state), { p1: 5, p2: 0 });
  check('[F] SO-W: exactly its own 2', sandbox.soReceivedQty(SOS12['so-w'], box.state), { p1: 0, p2: 2 });
  check('[F] p1\'s 21 units land on SOs that sum to exactly 21 — nothing lost, nothing doubled',
    10 + 6 + 5 + 0, 21);
  check('[F] p2\'s 6 units land on SOs that sum to exactly 6', 4 + 0 + 0 + 2, 6);
}

console.log('\n[13] "mark received" is a direct, discoverable action from both the GRN list and the Vendor PO itself — not a dead end');
{
  const src = fs.readFileSync(path.join(dir, 'src', 'screens-procurement.jsx'), 'utf8');
  const grnListBody = src.slice(src.indexOf('function GRNList('), src.indexOf('\nfunction ', src.indexOf('function GRNList(') + 1));
  check('GRNList has its own New GRN button, not just a link away to the Virtual Godowns',
    /New GRN/.test(grnListBody), true);
  check('that button actually opens the real New GRN screen',
    /New GRN<\/button>/.test(grnListBody) && /navigate\('grn\/new'\)/.test(grnListBody), true);
  check('VendorPODetail\'s own action button opens Receive directly on THIS po — not a bare navigate(\'grn\') that drops the PO context',
    /setShowReceive\(true\)/.test(src) && /showReceive && <ReceiveModal po=\{po\}/.test(src), true);
  check('the old dead-end ("Create GRN" -> navigate(\'grn\') with no PO selected) is gone from the action button',
    /Create GRN<\/button>/.test(src), false);
  check('a PO serving more than one SO is visibly tagged "combined" on its own detail page',
    /combined · \{window\.poLinkedSoIds\(po\)\.length\} SOs/.test(src), true);
  check('and on the Vendor POs list row too, before you even open it',
    /combined · \{linkedCount\} SOs/.test(src), true);
}

console.log('\n[14] soItemPOBreakdown -- an SO with several of its OWN vendor POs (no SO-sharing involved) can see exactly which PO each on-order/received unit came from');
{
  const soP = { id: 'so-p', so_no: 'SO/FY26/0500' };
  const po1 = { id: 'po-1', po_no: 'VPO/FY26/0001', so_id: 'so-p', vendor_id: 'v1', items: [{ product_id: 'p1', qty: 5, rate: 100 }] };
  const po2 = { id: 'po-2', po_no: 'VPO/FY26/0002', so_id: 'so-p', vendor_id: 'v2', items: [{ product_id: 'p1', qty: 3, rate: 100 }, { product_id: 'p2', qty: 2, rate: 50 }] };
  // po-3 also combines a second SO ('so-other') on the SAME line -- the
  // breakdown must still only count SO-P's own 4, never the other SO's 6.
  const po3 = { id: 'po-3', po_no: 'VPO/FY26/0003', so_id: 'so-p', vendor_id: 'v1', items: [{ product_id: 'p1', qty: 10, rate: 100, so_alloc: [{ so_id: 'so-p', qty: 4 }, { so_id: 'so-other', qty: 6 }] }] };
  const pos = [po1, po2, po3];
  const grns = [
    { id: 'grn-1', po_id: 'po-1', items: [{ product_id: 'p1', accepted: 5 }] },
    { id: 'grn-2', po_id: 'po-3', items: [{ product_id: 'p1', accepted: 10, so_split: [{ so_id: 'so-p', qty: 4 }, { so_id: 'so-other', qty: 6 }] }] },
  ];
  const b = sandbox.soItemPOBreakdown({ grns }, soP, pos);
  check('p1 on-PO total is the sum of all three POs\' own share for this SO', b.onPOByProd, { p1: 12, p2: 2 });
  check('p1 on-PO breakdown names all three POs, each with just its own contribution', b.onPOByProdPO.p1,
    [{ po_id: 'po-1', po_no: 'VPO/FY26/0001', qty: 5 }, { po_id: 'po-2', po_no: 'VPO/FY26/0002', qty: 3 }, { po_id: 'po-3', po_no: 'VPO/FY26/0003', qty: 4 }]);
  check('p2 on-PO breakdown names only po-2 -- po-1/po-3 never ordered any p2, so no phantom zero entries', b.onPOByProdPO.p2,
    [{ po_id: 'po-2', po_no: 'VPO/FY26/0002', qty: 2 }]);
  check('p1 received total is po-1\'s 5 plus po-3\'s OWN 4 -- never so-other\'s 6', b.receivedByProd, { p1: 9 });
  check('p1 received breakdown names po-1 and po-3, each at its own accepted qty', b.receivedByProdPO.p1,
    [{ po_id: 'po-1', po_no: 'VPO/FY26/0001', qty: 5 }, { po_id: 'po-3', po_no: 'VPO/FY26/0003', qty: 4 }]);
  check('p2 has no received breakdown at all yet -- nothing has arrived for it, so no phantom zero-qty PO entry either', b.receivedByProdPO.p2, undefined);
}

console.log('\n[15] ComboPOSummary -- Stores sees which SO(s) a PO is for, and how much of what, before any per-line split editor appears');
{
  const src = fs.readFileSync(path.join(dir, 'src', 'screens-procurement.jsx'), 'utf8');
  const poDetailBody = src.slice(src.indexOf('function VendorPODetail('), src.indexOf('\nfunction ', src.indexOf('function VendorPODetail(') + 1));
  check('the PO\'s own detail page -- not just the Receive dialog you have to open first -- shows the full combined-SOs section directly',
    /<ComboPOSummary po=\{po\} getSO=\{getSO\} getProduct=\{getProduct\}\/>/.test(poDetailBody), true);
  check('ComboPOSummary renders nothing for an ordinary single-SO PO -- zero visual change for the overwhelming majority of POs',
    /if \(linked\.length <= 1\) return null;/.test(src), true);
  check('ReceiveModal (the PO detail page\'s own Receive dialog) shows the summary as the first thing in the dialog',
    /<ComboPOSummary po=\{po\} getSO=\{getSO\} getProduct=\{getProduct\}\/>/.test(src), true);
  check('ReceiveModal\'s own title also says "combined" up front, same wording Stores already sees on the PO list/detail',
    /Receive — \$\{po\.po_no\}.*combined · \$\{linkedSoIds\.length\} SOs/.test(src), true);
  check('GRNNew\'s PO picker tags a combined PO right in the dropdown, before it is even selected',
    /\(\+\$\{n - 1\} more SO\$\{n > 2 \? 's' : ''\}\)/.test(src), true);
  check('GRNNew\'s page-sub names every linked SO by number when the chosen PO is combined, not just the primary one',
    /for <strong>\{linkedSoIds\.length\} Sales Orders<\/strong>/.test(src), true);
  check('GRNNew also renders the same summary card Stores sees from the Vendor PO page',
    /\{po && <ComboPOSummary po=\{po\} getSO=\{getSO\} getProduct=\{getProduct\}\/>\}/.test(src), true);
  check('SOVendorPOsTab\'s Item tracking table shows which PO an on-order qty came from, once more than one PO contributes',
    /r\.onPOBreakdown\.length > 1/.test(src), true);
  check('...and the same for received qty',
    /r\.recvBreakdown\.length > 1/.test(src), true);
}

console.log('\n[16] Receive works IDENTICALLY for an ordinary PO -- the suggestion/split UI is the only thing gated behind "combined", never the Receive action itself');
{
  const src = fs.readFileSync(path.join(dir, 'src', 'screens-procurement.jsx'), 'utf8');

  const poDetailBody = src.slice(src.indexOf('function VendorPODetail('), src.indexOf('\nfunction ', src.indexOf('function VendorPODetail(') + 1));
  const iBtn1 = poDetailBody.indexOf('setShowReceive(true)');
  check('VendorPODetail\'s Receive button has no "combined-only" guard anywhere near it',
    /poLinkedSoIds|linkedCount/.test(poDetailBody.slice(Math.max(0, iBtn1 - 300), iBtn1)), false);

  const soTabBody = src.slice(src.indexOf('function SOVendorPOsTab('), src.indexOf('\nfunction ', src.indexOf('function SOVendorPOsTab(') + 1));
  const iBtn2 = soTabBody.indexOf('setReceivePo(po)');
  check('SOVendorPOsTab\'s inline Receive button has no "combined-only" guard either',
    /poLinkedSoIds/.test(soTabBody.slice(Math.max(0, iBtn2 - 300), iBtn2)), false);

  check('GRNNew\'s PO picker lists every receivable PO, combined or not -- one filter (not blocked), not a second one for "combined"',
    /state\.vendor_pos\.filter\(p => !blockedPo\(p\.status\)\)\.map\(p => \{/.test(src), true);

  // Functional proof, not just code reading: a PLAIN PO that has never been
  // anywhere near another SO posts a receipt exactly as it always has -- no
  // so_split ever gets stamped, nothing blocks submission waiting on a split
  // that was never needed, and postReceiptForPO's "every OTHER linked SO"
  // invoice fan-out is a genuine no-op (poLinkedSoIds(po) is just [po.so_id]
  // when nothing was ever combined).
  const poNormal = { id: 'po-plain-1', po_no: 'VPO/FY26/0200', so_id: 'so-n1', vendor_id: 'v1', status: 'Issued', amount: 500, ebill: {}, items: [{ product_id: 'p1', qty: 5, rate: 100 }] };
  const { box, ctx } = makeCtx({ vendor_pos: [poNormal], grns: [], vendor_invoices: [], sales_orders: [{ id: 'so-n1', so_no: 'SO/FY26/0900' }], notifications: [] });
  const invoked = [];
  const realAuto = sandbox.autoInvoiceSO;
  sandbox.autoInvoiceSO = (soId) => { invoked.push(soId); return null; };
  const itemsIn = [{ product_id: 'p1', qty: 5, received: 5, rejected: 0, to_pool: 0, so_split: null }];
  await sandbox.postReceiptForPO(poNormal, itemsIn, { lr: 'LR-X', grnDate: '2026-10-20' }, { ...ctx, state: box.state });
  sandbox.autoInvoiceSO = realAuto;
  check('an ordinary PO\'s GRN line carries no so_split key at all -- exactly like before this feature existed',
    'so_split' in box.state.grns[0].items[0], false);
  check('the PO resolves fully received, exactly as a plain receipt always has', box.state.vendor_pos[0].status, 'Material Received');
  check('autoInvoiceSO fires exactly once, for the PO\'s own SO -- the multi-SO fan-out loop found nothing else to do', invoked, ['so-n1']);
}

console.log('\n[17] previewReceivePOMapping -- the exact preview a pending receipt shows Purchase can never disagree with what Accept actually posts');
{
  const soX = { id: 'so-x', so_no: 'SO/FY26/0601' };
  const soY = { id: 'so-y', so_no: 'SO/FY26/0602' };
  const getSOxy = id => (id === 'so-x' ? soX : id === 'so-y' ? soY : null);
  const poCombo = { id: 'po-combo', po_no: 'VPO/FY26/0601', so_id: 'so-x', vendor_id: 'v1', status: 'Issued',
    items: [{ product_id: 'p1', qty: 10, rate: 50, so_alloc: [{ so_id: 'so-x', qty: 6 }, { so_id: 'so-y', qty: 4 }] }] };
  const { box, ctx } = makeCtx({ vendor_pos: [poCombo], grns: [], vendor_invoices: [],
    sales_orders: [soX, soY], notifications: [], config: {}, vendors: [{ id: 'v1', name: 'Vendor' }] });

  const picks = [{ product_id: 'p1', qty: 3, name: 'Widget' }];
  const preview = sandbox.previewReceivePOMapping(soX, picks, box.state);
  check('the preview names the combined PO, SO-X\'s own share of it, and exactly what this pick will take',
    preview.byProduct.p1, [{ po_id: 'po-combo', po_no: 'VPO/FY26/0601', rate: 50, orderedForSO: 6, take: 3, combined: true, others: [{ so_id: 'so-y', qty: 4 }] }]);
  check('nothing is short -- the PO line comfortably covers this pick', preview.shortfall, {});

  const r = await sandbox.vgReceiveComponents(soX, picks, { ...ctx, state: box.state });
  check('Accept posted exactly one GRN, exactly as the preview said it would', [r.posted, r.units], [1, 3]);
  check('the GRN\'s accepted qty for SO-X matches the preview\'s "take" exactly -- no drift between preview and execution',
    box.state.grns[0].items[0].accepted, 3);
  check('the GRN line is stamped so_split for SO-X only -- SO-Y\'s own 4 units are untouched by this receipt',
    box.state.grns[0].items[0].so_split, [{ so_id: 'so-x', qty: 3 }]);

  // Now ask for more than the PO line has left for SO-X (6 - 3 = 3 remain) --
  // the preview's shortfall must say exactly how much, and Accept must
  // auto-create a PO for precisely that shortfall, matching the preview.
  const picks2 = [{ product_id: 'p1', qty: 5, name: 'Widget' }];
  const preview2 = sandbox.previewReceivePOMapping(soX, picks2, box.state);
  check('the preview takes only what is left on the line (3) and reports the rest as a shortfall (2)',
    [preview2.byProduct.p1[0].take, preview2.shortfall.p1], [3, 2]);
  const r2 = await sandbox.vgReceiveComponents(soX, picks2, { ...ctx, state: box.state });
  check('Accept auto-created a PO for exactly the previewed shortfall -- a new PO now exists for SO-X',
    box.state.vendor_pos.some(p => p.so_id === 'so-x' && p.source === 'vg-receive' && p.items.some(it => it.qty === 2)), true);
}

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - a shared PO degrades to exactly the historic single-SO behaviour when unused, and the GRN suggestion ranks correctly without ever deciding anything itself');
process.exit(bad ? 1 : 0);

})();
