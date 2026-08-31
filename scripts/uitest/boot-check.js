#!/usr/bin/env node
/**
 * OP Central — boot check
 * ---------------------------------------------------------------------------
 * render-check.js renders components against a state we hand them. This boots
 * the REAL StoreProvider in a real DOM with a mocked Supabase, so the effects
 * actually run: hydrate -> auth -> tenant context -> config -> table load.
 *
 * That sequence is where cross-tenant bleed lives, and server-side rendering
 * cannot reach it because SSR never runs effects.
 *
 * Asserts, for a tenant whose database is EMPTY (a newly created organization):
 *   - no rows from seed.js are ever on screen
 *   - the topbar names THIS organization, not the demo company
 *   - a cache left behind by a different user is never rendered
 *   - nothing is written back to the database
 *
 * Usage: node scripts/uitest/boot-check.js [path-to-frontend]
 * Needs: npm i --no-save jsdom @babel/standalone react react-dom
 */
const fs = require('fs');
const path = require('path');

let JSDOM, Babel;
try {
  ({ JSDOM } = require('jsdom'));
  Babel = require('@babel/standalone');
} catch (e) {
  console.error('Missing dev deps. Run:\n  npm i --no-save jsdom @babel/standalone react react-dom');
  process.exit(2);
}

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');

// The organization the user actually belongs to — with NOTHING in it.
const ORG = { id: 'org-ml', name: 'Microlink', slug: 'ml', subdomain: 'ml' };
const USER = { id: 'u-ml', name: 'ML Admin', email: 'admin@microlink.com', role: 'Org Admin', active: true };

function run(scenario) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="probe"></div></body></html>',
    { url: 'https://ml.ops-central.unimisk.com/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;

  const cacheStore = {};
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: k => (k in cacheStore ? cacheStore[k] : null),
    setItem: (k, v) => { cacheStore[k] = String(v); },
    removeItem: k => { delete cacheStore[k]; },
    clear: () => { Object.keys(cacheStore).forEach(k => delete cacheStore[k]); },
  } });

  const writes = [];
  const CTX = {
    active_org_id: ORG.id, is_master_admin: false, organization: ORG,
    features: { presales: false, rfq_email: false, implementation: false },
    workflow: { receiving_flow: 'stores_to_purchase', po_item_language: 'vendor',
                intransit_tracking: true, customer_language: true, outward_dispatch: true },
    workflow_profile: 'procurement_only',
  };
  const rpc = { opc_my_context: CTX, opc_my_features: CTX.features, opc_my_workflow: CTX.workflow,
                opc_get_config: null, opc_alias_map: {}, opc_admin_list_organizations: [],
                opc_admin_list_workflow_profiles: [] };

  // 'empty-tenant' scenarios: a newly created organization owns nothing.
  // 'populated' : the organization has its OWN rows and must see every one.
  const OWN = scenario === 'populated' ? {
    sales_orders: [{ id: 'own-so-1', so_no: 'ML/SO/0001', customer_id: 'own-cust-1', lines: [], status: 'Draft' }],
    customers: [{ id: 'own-cust-1', name: 'Microlink Customer', gstin: '', city: '' }],
    vendors: [{ id: 'own-vend-1', name: 'Microlink Vendor', gstin: '', city: '', terms: '' }],
    products: [{ id: 'own-prod-1', code: 'ML-001', name: 'Microlink Item', hsn: '', uom: 'Nos', gst: 18, sell: 100, buy: 80 }],
    categories: [{ id: 'own-cat-1', name: 'Microlink Category', hsn: '', gst: 18 }],
    boms: [{ category_id: 'own-cat-1', components: [] }],
  } : {};
  const rowsFor = (t) => (t === 'users' ? [USER] : (OWN[t] || []));

  const query = (tableName) => {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      upsert: async (row) => { writes.push({ table: tableName, op: 'upsert', row }); return { data: null, error: null }; },
      insert: async (row) => { writes.push({ table: tableName, op: 'insert', row }); return { data: null, error: null }; },
      update: () => q, delete: () => q,
      then: (res) => res({ data: rowsFor(tableName), error: null }),
    };
    return q;
  };
  const client = {
    rpc: async (n) => ({ data: (n in rpc ? rpc[n] : null), error: null }),
    from: query,
    auth: {
      getSession: async () => ({ data: { session: { user: { id: USER.id, email: USER.email } } }, error: null }),
      getUser: async () => ({ data: { user: { id: USER.id, email: USER.email } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  };
  // config.js builds OPC_SB from window.supabase — go through that real path so
  // the harness exercises the same wiring the browser does.
  window.supabase = { createClient: () => client };
  window.OPC_SB = client;
  window.OPC_ENV = { APP_BASE_DOMAIN: 'ops-central.unimisk.com', SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'k' };
  window.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  window.console.error = () => {}; window.console.warn = () => {}; window.console.info = () => {};

  global.window = window; global.document = window.document; global.navigator = window.navigator;
  global.HTMLElement = window.HTMLElement; global.Element = window.Element; global.Node = window.Node;
  global.Event = window.Event; global.MutationObserver = window.MutationObserver;
  // jsdom implements neither; every real browser does. Without them the app's
  // resize/scroll observers throw and mask whatever we were actually testing.
  const NoopObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.ResizeObserver = NoopObserver;
  window.IntersectionObserver = NoopObserver;
  global.ResizeObserver = NoopObserver;
  global.IntersectionObserver = NoopObserver;
  window.scrollTo = () => {};
  global.requestAnimationFrame = cb => setTimeout(cb, 0);
  global.cancelAnimationFrame = id => clearTimeout(id);
  global.IS_REACT_ACT_ENVIRONMENT = true;

  const React = require('react');
  const ReactDOMClient = require('react-dom/client');
  window.React = React; window.ReactDOM = ReactDOMClient;

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const plain = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map(m => m[1]);
  const jsxFiles = [...html.matchAll(/type="text\/babel"\s+src="([^"]+)"/g)].map(m => m[1]);

  // A cache left by a DIFFERENT company, holding their orders and catalogue.
  if (scenario === 'foreign-cache') {
    const seedSrc = fs.readFileSync(path.join(dir, 'src', 'seed.js'), 'utf8');
    const tmp = { window: {} }; tmp.window = tmp;
    try { new Function('window', seedSrc)(tmp); } catch (e) {}
    const seed = tmp.OPC_SEED || {};
    cacheStore['opc.state.v3'] = JSON.stringify({
      __version: seed.version, __uid: 'a-different-user', __orgId: 'org-SOMEONE-ELSE',
      org: { name: 'Brightline Systems Pvt Ltd', fiscal_year: '2025-26' },
      sales_orders: seed.sales_orders || [], customers: seed.customers || [],
      products: seed.products || [], categories: seed.categories || [],
      vendors: seed.vendors || [], vendor_pos: seed.vendor_pos || [], grns: seed.grns || [],
      config: {},
    });
  }

  for (const f of [...plain, ...jsxFiles]) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const code = f.endsWith('.jsx') ? Babel.transform(src, { presets: ['react'], filename: f }).code : src;
    window.eval(code);
  }

  const seedIds = new Set(
    Object.keys(window.OPC_SEED || {})
      .filter(k => Array.isArray(window.OPC_SEED[k]))
      .flatMap(k => window.OPC_SEED[k].map(r => r && r.id).filter(Boolean)));

  let captured = null;
  function Probe() {
    const st = window.useStore();
    captured = st;
    return null;
  }

  const root = ReactDOMClient.createRoot(window.document.getElementById('probe'));
  const { act } = React;

  return (async () => {
    await act(async () => {
      root.render(React.createElement(window.StoreProvider, null,
        React.createElement(window.ToastProvider, null, React.createElement(Probe))));
    });
    for (let i = 0; i < 10; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });

    const st = captured ? captured.state : {};
    const problems = [];
    // boms is intentionally a MAP { category_id: [components] }, not a list.
    const TENANT_TABLES = ['sales_orders', 'customers', 'vendors', 'products', 'categories',
      'vendor_pos', 'grns', 'vendor_invoices', 'payments', 'rfqs', 'sourcings'];
    const count = (v) => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0);

    for (const t of TENANT_TABLES) {
      const rows = st[t];
      if (rows == null) continue;
      if (!Array.isArray(rows)) { problems.push(`${t}: expected an array, got ${typeof rows}`); continue; }
      const fromSeed = rows.filter(r => r && seedIds.has(r.id));
      if (fromSeed.length) {
        problems.push(`${t}: ${fromSeed.length} demo row(s) on screen (e.g. ${fromSeed[0].so_no || fromSeed[0].name || fromSeed[0].id})`);
      }
    }
    const orgName = (st.org && st.org.name) || '';
    if (/brightline/i.test(orgName)) problems.push(`org name shows the demo company: "${orgName}"`);
    if (orgName !== ORG.name) problems.push(`org name is "${orgName}", expected "${ORG.name}"`);
    if (writes.length) problems.push(`${writes.length} write(s) to the database: ` +
      writes.slice(0, 3).map(w => `${w.op} ${w.table}`).join(', '));

    const totalRows = TENANT_TABLES.reduce((a, t) => a + count(st[t]), 0) + count(st.boms);
    // A BOM whose key is a category from seed.js would mean demo data on screen.
    const seedCats = new Set((window.OPC_SEED.categories || []).map(c => c.id));
    Object.keys(st.boms || {}).forEach(k => {
      if (seedCats.has(k)) problems.push(`boms: demo BOM "${k}" on screen`);
    });
    if (scenario === 'populated') {
      Object.keys(OWN).forEach(t => {
        const got = count(st[t]);
        if (got !== OWN[t].length) problems.push(`${t}: this org owns ${OWN[t].length} but ${got} reached the screen`);
      });
    }

    console.log(`\nSCENARIO: ${scenario}`);
    console.log(`  organization on screen : ${orgName || '(blank)'}`);
    console.log(`  tenant rows on screen  : ${totalRows}` +
      (scenario === 'populated' ? ' (this org owns 6)' : ' (database is empty, so this must be 0)'));
    console.log(`  writes to the database : ${writes.length} (must be 0)`);
    if (problems.length) { problems.forEach(p => console.log('  X  ' + p)); return 1; }
    console.log('  ok  no demo data, correct organization, nothing written');
    return 0;
  })();
}

(async () => {
  let bad = 0;
  for (const sc of ['fresh-browser', 'foreign-cache', 'populated']) {
    try { bad += await run(sc); }
    catch (e) { console.log(`\nSCENARIO: ${sc}\n  X  threw: ${e.message}`); bad++; }
  }
  console.log(bad ? `\nFAILED — ${bad} scenario(s)` : '\nPASS — tenants see only their own data');
  process.exit(bad ? 1 : 0);
})();
