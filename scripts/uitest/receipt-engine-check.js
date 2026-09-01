#!/usr/bin/env node
/**
 * OP Central — receipt engine check
 * ---------------------------------------------------------------------------
 * Runs the REAL vgReceiveComponents against a realistic order and asserts that
 * every item confirmed as received actually lands in a GRN.
 *
 * Stores ticked every line, Purchase accepted, and only one line came through.
 * Rendering tests cannot catch that: the fault is in the engine that turns a
 * confirmed receipt into goods receipt notes, so this drives that function
 * directly with a mutate() that behaves like the store's.
 *
 * Usage: node scripts/uitest/receipt-engine-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React;
try { Babel = require('@babel/standalone'); React = require('react'); }
catch (e) { console.error('Missing dev deps. Run: npm i --no-save @babel/standalone react'); process.exit(2); }

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
sandbox.setTimeout = (f) => { if (typeof f === 'function') f(); return 0; };
sandbox.clearTimeout = () => {}; sandbox.setInterval = () => 0; sandbox.clearInterval = () => {};
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
sandbox.__opcWorkflow = { receiving_flow: 'stores_to_purchase', auto_invoice_on_grn: false };
sandbox.__opcFeatures = {}; sandbox.OPC_SB = null;

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

// --- an order shaped like the imported BOQ ---------------------------------
const PRODUCTS = [];
for (let i = 1; i <= 8; i++) {
  PRODUCTS.push({ id: 'p' + i, code: 'CODE-' + i, name: 'Item ' + i, buy: 0, sell: 0, uom: 'Nos.' });
}
const getProduct = id => PRODUCTS.find(p => p.id === id);

function freshState(poItems) {
  return {
    products: PRODUCTS,
    vendors: [{ id: 'v1', name: 'dykin' }, { id: 'v2', name: 'Cisco' }],
    customers: [{ id: 'c1', name: 'Aditya Birla' }],
    categories: [], boms: {},
    users: [{ id: 'u1', name: 'Jitendra', role: 'Purchase' }],
    sales_orders: [{
      id: 'so-1', so_no: 'SO/FY26/0001', customer_id: 'c1', status: 'Draft',
      lines: [{ id: 'l1', bundle_qty: 1, unit_price: 0,
        components: PRODUCTS.map(p => ({ product_id: p.id, qty: p.id === 'p2' ? 4 : 1 })) }],
      extra: {},
    }],
    vendor_pos: [{
      id: 'po-1', po_no: 'VPO/FY26/0041', so_id: 'so-1', vendor_id: 'v1',
      date: '2026-05-01', status: 'Issued', amount: 0, ebill: {},
      items: poItems,
    }],
    grns: [], vendor_invoices: [], payments: [], notifications: [], audit: [],
    pool: [], outward_dispatches: [], rfqs: [], sourcings: [], transfer_requests: [],
    config: { vendor_po_md_threshold: 500000 },
    org: {},
  };
}

// A mutate() that behaves like the store's.
//
// `stale` reproduces REACT: ctx.state is the snapshot captured when the handler
// started and does NOT change as mutate() runs, because setState is asynchronous.
// A live getter is a kinder world than the app actually runs in, so the default
// is the harsh one.
function makeCtx(state, live) {
  const box = { state };
  const snapshot = state;
  const ctx = {
    get state() { return live ? box.state : snapshot; },
    mutate: (fn) => { box.state = fn(box.state); },
    toast: null,
    addToPool: () => {},
    getProduct,
    getVendor: id => box.state.vendors.find(v => v.id === id),
    getUser: id => box.state.users.find(u => u.id === id),
    currentUser: 'u1',
  };
  return { box, ctx };
}

async function run(poItems, picks, live) {
  const { box, ctx } = makeCtx(freshState(poItems), live);
  const res = await sandbox.vgReceiveComponents(box.state.sales_orders[0], picks, ctx);
  const accepted = {};
  (box.state.grns || []).forEach(g => (g.items || []).forEach(it => {
    accepted[it.product_id] = (accepted[it.product_id] || 0) + (Number(it.accepted) || 0);
  }));
  return { res, accepted, state: box.state };
}

(async () => {
  const allPicks = PRODUCTS.map(p => ({ product_id: p.id, qty: p.id === 'p2' ? 4 : 1, name: p.name }));

  console.log('\n[1] every item is on the PO — ticking all must receive all');
  let poItems = PRODUCTS.map(p => ({ product_id: p.id, qty: p.id === 'p2' ? 4 : 1, rate: 0 }));
  let r = await run(poItems, allPicks);
  check('a GRN was posted', r.res.posted > 0, true);
  check('total units received', r.res.units, 11);
  const missing = allPicks.filter(p => (r.accepted[p.product_id] || 0) !== p.qty)
    .map(p => `${p.product_id}: got ${r.accepted[p.product_id] || 0}, wanted ${p.qty}`);
  check('EVERY ticked item reached a GRN', missing, []);

  console.log('\n[2] the PO covers only some items — the rest must still be received');
  poItems = [{ product_id: 'p1', qty: 1, rate: 0 }, { product_id: 'p2', qty: 4, rate: 0 }];
  r = await run(poItems, allPicks);
  check('units received still cover everything', r.res.units, 11);
  const missing2 = allPicks.filter(p => (r.accepted[p.product_id] || 0) !== p.qty)
    .map(p => `${p.product_id}: got ${r.accepted[p.product_id] || 0}, wanted ${p.qty}`);
  check('items with no PO line are received too', missing2, []);
  check('a PO was auto-created for the shortfall', r.state.vendor_pos.length, 2);

  console.log('\n[3] GRN numbers must be unique across one action');
  const nos = (r.state.grns || []).map(g => g.grn_no);
  check('no duplicate GRN numbers', nos.length - new Set(nos).size, 0);
  const ids = (r.state.grns || []).map(g => g.id);
  check('no duplicate GRN ids', ids.length - new Set(ids).size, 0);

  console.log('\n[4] receiving twice must not double-count');
  // Two SEPARATE user actions, so each starts from fresh state — `live` models
  // the re-render between them. Sharing one stale snapshot across both would be
  // testing a sequence the app cannot produce.
  const { box, ctx } = makeCtx(freshState(PRODUCTS.map(p => ({ product_id: p.id, qty: p.id === 'p2' ? 4 : 1, rate: 0 }))), true);
  const so = box.state.sales_orders[0];
  await sandbox.vgReceiveComponents(so, [{ product_id: 'p1', qty: 1, name: 'Item 1' }], ctx);
  await sandbox.vgReceiveComponents(box.state.sales_orders[0], [{ product_id: 'p1', qty: 1, name: 'Item 1' }], ctx);
  const acc = {};
  box.state.grns.forEach(g => (g.items || []).forEach(it => {
    acc[it.product_id] = (acc[it.product_id] || 0) + (Number(it.accepted) || 0);
  }));
  check('the PO only had 1, so the second receipt cannot accept another',
    acc.p1 <= 1 || box.state.vendor_pos.length > 1, true);

  // -------------------------------------------------------------------------
  // The bug that started this file.
  //
  // A line holds bundle_qty SETS and each component qty is PER SET, so the real
  // requirement is qty x bundle_qty. Five places worked this out independently
  // and four forgot the multiplication. Invisible while every bundle was 1;
  // the moment the sheet importer produced bundles of 6, 20 and 30 the godown
  // asked for a sixth of the order and receiving posted a sixth, so everything
  // still read as pending.
  //
  // They must now all agree, because they all call soRequired().
  // -------------------------------------------------------------------------
  console.log('\n[5] every screen agrees on what the order needs');
  const BUNDLED_SO = {
    id: 'so-b', so_no: 'SO/FY26/0002', customer_id: 'c1', status: 'Draft', lines: [
      { id: 'l1', bundle_qty: 1,  unit_price: 0, components: [{ product_id: 'p1', qty: 1 }, { product_id: 'p2', qty: 4 }] },
      { id: 'l2', bundle_qty: 6,  unit_price: 0, components: [{ product_id: 'p3', qty: 1 }, { product_id: 'p2', qty: 1 }] },
      { id: 'l3', bundle_qty: 20, unit_price: 0, components: [{ product_id: 'p4', qty: 1 }] },
    ],
  };
  // p1 = 1        p2 = 4 + (1 x 6) = 10
  // p3 = 1 x 6    p4 = 1 x 20
  const WANT = { p1: 1, p2: 10, p3: 6, p4: 20 };

  check('soRequired is the arithmetic everyone should get', sandbox.soRequired(BUNDLED_SO), WANT);
  check('the Virtual Godown agrees',
    Object.fromEntries(sandbox.soRequiredList(BUNDLED_SO).map(r => [r.product_id, r.qty])), WANT);
  check('procurement agrees (soReqComponents)', sandbox.soReqComponents(BUNDLED_SO), WANT);
  check('creating a single PO agrees (procComponentList)',
    Object.fromEntries(sandbox.procComponentList(BUNDLED_SO).map(r => [r.product_id, r.qty])), WANT);
  check('cross-SO transfers agree (soComponentMap)', sandbox.soComponentMap(BUNDLED_SO), WANT);

  const allocState = { vendor_pos: [], products: PRODUCTS };
  const allocRows = sandbox.allocBuildRows(allocState, BUNDLED_SO);
  const allocTotals = {};
  allocRows.forEach(r => { allocTotals[r.product_id] = (allocTotals[r.product_id] || 0) + r.qty; });
  check('the vendor allocator agrees', allocTotals, WANT);

  const scmState = { vendor_pos: [], grns: [], outward_dispatches: [], products: PRODUCTS };
  const scmTotals = {};
  sandbox.scmLineTotals(scmState, BUNDLED_SO).forEach(r => { scmTotals[r.product_id] = r.required; });
  check('SCM tracking agrees', scmTotals, WANT);

  console.log('\n[6] and a bundled order actually receives in full');
  const bundledPO = Object.keys(WANT).map(pid => ({ product_id: pid, qty: WANT[pid], rate: 0 }));
  const { box: bBox, ctx: bCtx } = makeCtx({
    ...freshState(bundledPO),
    sales_orders: [BUNDLED_SO],
    vendor_pos: [{ id: 'po-b', po_no: 'VPO/FY26/0099', so_id: 'so-b', vendor_id: 'v1',
      date: '2026-05-01', status: 'Issued', amount: 0, ebill: {}, items: bundledPO }],
  });
  const bPicks = sandbox.soRequiredList(BUNDLED_SO).map(r => ({ ...r, name: r.product_id }));
  const bRes = await sandbox.vgReceiveComponents(BUNDLED_SO, bPicks, bCtx);
  const bAcc = {};
  (bBox.state.grns || []).forEach(g => (g.items || []).forEach(it => {
    bAcc[it.product_id] = (bAcc[it.product_id] || 0) + (Number(it.accepted) || 0);
  }));
  check('all 37 units are received, not 4', bRes.units, 37);
  check('every item received in full', bAcc, WANT);
  check('the order now counts as fully received',
    sandbox.soFullyReceived(bBox.state, BUNDLED_SO), true);

  // -------------------------------------------------------------------------
  // Receiving goods was raising a CUSTOMER TAX INVOICE for an organization whose
  // workflow says auto_invoice_on_grn = false — Microlink, who invoice outside
  // this system entirely. Money leaving the door on a setting that asked for
  // none is the worst kind of default.
  // -------------------------------------------------------------------------
  console.log('\n[7] auto-invoicing obeys the organization workflow');

  async function receiveAndCountInvoices(autoInvoice) {
    sandbox.__opcWorkflow = { receiving_flow: 'stores_to_purchase', auto_invoice_on_grn: autoInvoice };
    const poItems = PRODUCTS.map(p => ({ product_id: p.id, qty: p.id === 'p2' ? 4 : 1, rate: 1000 }));
    const st = freshState(poItems);
    // Price the order so there is something to invoice.
    st.sales_orders[0].lines[0].unit_price = 50000;
    st.sales_orders[0].status = 'Approved';
    const { box, ctx } = makeCtx(st, true);
    await sandbox.vgReceiveComponents(box.state.sales_orders[0],
      PRODUCTS.map(p => ({ product_id: p.id, qty: p.id === 'p2' ? 4 : 1, name: p.name })), ctx);
    const so = box.state.sales_orders[0];
    return ((so.invoices || []).length) + (so.invoice_no ? 1 : 0);
  }

  check('with auto_invoice_on_grn OFF, receiving raises no customer invoice',
    await receiveAndCountInvoices(false), 0);
  check('with it ON, the invoice is still raised as before',
    (await receiveAndCountInvoices(true)) > 0, true);
  sandbox.__opcWorkflow = { receiving_flow: 'stores_to_purchase', auto_invoice_on_grn: false };

  console.log('\n[8] the PO e-Bill is a real document, not a screenshot of the page');
  check('a printable e-Bill exists', typeof sandbox.printPOEbill, 'function');
  const opened = [];
  const realOpen = sandbox.open;
  sandbox.open = () => {
    const doc = { html: '', open() {}, close() {}, write(h) { this.html = h; } };
    opened.push(doc);
    return { document: doc };
  };
  sandbox.printPOEbill(
    { po_no: 'VPO/FY26/0044', date: '2026-05-21',
      ebill: { no: 'VPO-EB/FY26/5005', irn: 'ABC123', date: '2026-05-21', generated: true },
      items: [{ product_id: 'p1', qty: 2, rate: 5000 }] },
    { name: 'Cisco', gstin: '27AAA', city: 'Mumbai' },
    { so_no: 'SO/FY26/0002' },
    { name: 'Microlink', address: 'Mumbai', gstin: '27BBB' },
    getProduct);
  sandbox.open = realOpen;
  const doc = opened[0] ? opened[0].html : '';
  check('it opens its own window', opened.length, 1);
  check('...titled as a PO e-Bill', /PURCHASE ORDER e-BILL/.test(doc), true);
  check('...carrying the e-Bill number', /VPO-EB\/FY26\/5005/.test(doc), true);
  check('...the IRN', /ABC123/.test(doc), true);
  check('...the vendor', /Cisco/.test(doc), true);
  check('...our own organisation, not the demo company', /Microlink/.test(doc) && !/Brightline/.test(doc), true);
  check('...the order it belongs to', /SO\/FY26\/0002/.test(doc), true);
  check('...and the line items with a total', /Item 1/.test(doc) && /Total/.test(doc), true);

  console.log('\n[9] e-Bill numbers cannot collide');
  const nA = sandbox.poEbillNo({ po_no: 'VPO/FY26/0043' });
  const nB = sandbox.poEbillNo({ po_no: 'VPO/FY26/0044' });
  check('two POs get two different numbers', nA !== nB, true);
  check('...derived from the PO so the two documents read together',
    [nA, nB], ['VPO-EB/FY26/0043', 'VPO-EB/FY26/0044']);
  check('the same PO always gets the same number',
    sandbox.poEbillNo({ po_no: 'VPO/FY26/0044' }), nB);

  console.log('\n[10] the e-Bill preview IS the printed document');
  const ebPO = {
    id: 'po-x', po_no: 'VPO/FY26/0044', so_id: 'so-1', vendor_id: 'v1', date: '2026-05-21',
    ebill: { no: 'VPO-EB/FY26/0044', irn: 'IRN9988', date: '2026-05-21', generated: true },
    items: [{ product_id: 'p1', qty: 2, rate: 5000 }],
  };
  const vend = { name: 'Cisco', gstin: '27AAA', city: 'Mumbai' };
  const ord = { so_no: 'SO/FY26/0002' };
  const orgn = { name: 'Microlink', address: 'Mumbai', gstin: '27BBB' };

  const preview = sandbox.poEbillHtml(ebPO, vend, ord, orgn, getProduct, { autoPrint: false });
  const paper = sandbox.poEbillHtml(ebPO, vend, ord, orgn, getProduct, { autoPrint: true });

  check('a preview document is produced', preview.length > 500, true);
  check('the preview does NOT print itself', /window\.print\(\)/.test(preview), false);
  check('the printed copy does', /window\.print\(\)/.test(paper), true);
  // The only difference between what is on screen and what comes out of the
  // printer must be the auto-print script — otherwise the preview is a lie.
  check('screen and paper are otherwise byte-identical',
    paper.replace(/<script>[\s\S]*?<\/script>/, ''), preview);

  ['VPO-EB/FY26/0044', 'IRN9988', 'Cisco', 'Microlink', 'SO/FY26/0002', 'Item 1']
    .forEach(t => check(`the preview carries ${t}`, preview.indexOf(t) !== -1, true));
  check('...and does not name the demo company', /Brightline/.test(preview), false);

  console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - quantities, invoicing and the e-Bill follow each org flow');
  process.exit(bad ? 1 : 0);
})();
