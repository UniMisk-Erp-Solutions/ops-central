// OP Central — Store / context / Supabase + localStorage persistence
const STORAGE_KEY = 'opc.state.v3';

// Transactional tables synced to Supabase (master data + config/users handled
// elsewhere). pool is read-only (display) so it's loaded but not write-synced.
const SYNCED_TABLES = {
  sales_orders: 'id', vendor_pos: 'id', grns: 'id', vendor_invoices: 'id',
  payments: 'id', rfqs: 'id', transfer_requests: 'id', notifications: 'id', audit: 'id',
};
const LOADED_TABLES = [
  'sales_orders', 'vendor_pos', 'grns', 'vendor_invoices', 'payments',
  'pool', 'rfqs', 'transfer_requests', 'notifications', 'audit',
];

// Map an arbitrary audit entry onto the audit table's columns (extras → detail).
function __auditRow(a) {
  const { id, action, entity, entity_id, user_id, ts, ...rest } = a;
  return {
    id, action: action || null, entity: entity || null, entity_id: entity_id || null,
    user_id: user_id || null, detail: rest, ts: ts || new Date().toISOString(),
  };
}

// Diff prev vs next for one table and push changes to Supabase (optimistic;
// the UI already updated). Row objects map 1:1 to table columns by design.
async function __syncTable(table, pk, prevArr, nextArr) {
  const sb = window.OPC_SB;
  if (!sb) return;
  const prevMap = new Map((prevArr || []).map(r => [r[pk], r]));
  const next = nextArr || [];
  for (const row of next) {
    const before = prevMap.get(row[pk]);
    if (!before || JSON.stringify(before) !== JSON.stringify(row)) {
      const payload = table === 'audit' ? __auditRow(row) : row;
      const { error } = await sb.from(table).upsert(payload, { onConflict: pk });
      if (error) console.error('[OPC] sync upsert ' + table, error.message);
    }
  }
  const nextIds = new Set(next.map(r => r[pk]));
  const dels = [...prevMap.keys()].filter(id => !nextIds.has(id));
  if (dels.length) {
    const { error } = await sb.from(table).delete().in(pk, dels);
    if (error) console.error('[OPC] sync delete ' + table, error.message);
  }
}

function __syncTables(prev, next) {
  if (!window.OPC_SB) return;
  Object.entries(SYNCED_TABLES).forEach(([t, pk]) => {
    if (prev[t] !== next[t]) __syncTable(t, pk, prev[t], next[t]);
  });
}

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.__version === window.OPC_SEED.version) return parsed;
    }
  } catch (e) {}
  return {
    __version: window.OPC_SEED.version,
    org: { ...window.OPC_SEED.org },
    users: window.OPC_SEED.users,
    categories: window.OPC_SEED.categories,
    products: window.OPC_SEED.products,
    boms: window.OPC_SEED.boms,
    customers: window.OPC_SEED.customers,
    vendors: window.OPC_SEED.vendors,
    sales_orders: window.OPC_SEED.sales_orders,
    vendor_pos: window.OPC_SEED.vendor_pos,
    grns: window.OPC_SEED.grns,
    vendor_invoices: window.OPC_SEED.vendor_invoices,
    payments: window.OPC_SEED.payments,
    pool: window.OPC_SEED.pool,
    rfqs: window.OPC_SEED.rfqs,
    audit: [],
    notifications: [],
    transfer_requests: [],
    config: {
      industry_template: 'Trading',
      teams: ['Sales','Pre-sales','Project Management','Purchase','Stores','Billing','Collections','Managing Director','Org Admin'],
      enabled_modules: {
        presales: true, sales_desk: true, stores: true,
        cross_so_transfer: true, surplus_pool: true, partial_invoicing: true,
        e_invoice: true, e_way_bill: true, whatsapp: true, sms: true,
      },
      approval_gates: [
        { id: 'g1', entity: 'Vendor PO', tier: '< ₹1,00,000', approvers: ['Purchase'] },
        { id: 'g2', entity: 'Vendor PO', tier: '₹1L – ₹5L', approvers: ['Purchase','Managing Director'] },
        { id: 'g3', entity: 'Vendor PO', tier: '> ₹5,00,000', approvers: ['Purchase','Managing Director','Finance'] },
        { id: 'g4', entity: 'Sales Order', tier: 'Customer overdue > ₹1L', approvers: ['Project Manager','Managing Director'] },
        { id: 'g5', entity: 'Inventory Write-off', tier: '> ₹25,000', approvers: ['Stores','Managing Director'] },
      ],
      lpp_threshold: 10,
      three_way_value_tolerance: 2,
      three_way_qty_tolerance: 1,
      pool_first: true,
    },
  };
}

const Store = React.createContext(null);

function StoreProvider({ children }) {
  const [state, setState] = React.useState(loadInitialState);
  const [route, setRoute] = React.useState(() => {
    const h = window.location.hash.slice(1);
    return h || 'dashboard';
  });
  const [roleFilter, setRoleFilter] = React.useState('All');
  // realUserId = who is actually logged in (Supabase auth session → drives admin
  // rights + the session). currentUser = the persona being acted as (differs only
  // while an admin impersonates another user to test the flow). Both are the
  // auth user's uuid. supabase-js owns session persistence + JWT attachment.
  const [realUserId, setRealUserId] = React.useState(null);
  const [currentUser, setCurrentUser] = React.useState(null);
  const [authReady, setAuthReady] = React.useState(false);

  // Drive identity from the Supabase auth session.
  React.useEffect(() => {
    if (!window.OPC_SB) { setAuthReady(true); return; }
    let mounted = true;
    window.OPC_SB.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const uid = data.session?.user?.id || null;
      setRealUserId(uid); setCurrentUser(uid); setAuthReady(true);
    });
    const { data: sub } = window.OPC_SB.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id || null;
      setRealUserId(uid);
      if (event === 'SIGNED_OUT') setCurrentUser(null);
      else if (event === 'SIGNED_IN') setCurrentUser(uid);
      // TOKEN_REFRESHED: leave currentUser as-is (preserves impersonation)
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  // Persist app state locally (offline cache; source of truth is Supabase).
  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }, [state]);

  // Load customization config from Supabase (singleton row). Falls back to the
  // seeded defaults already in state if the instance is unreachable. The config
  // blob stores { org, ...configFields, permissions, so_form_fields, ... }.
  // The loads below run once we have an authenticated session (RLS now requires
  // a JWT). They re-run whenever the real identity changes (login/logout).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.OPC_SB || !realUserId) return;
      try {
        const { data, error } = await window.OPC_SB
          .from('config').select('data').eq('id', 'singleton').maybeSingle();
        if (error || !data || cancelled) return;
        const blob = data.data || {};
        const { org, ...rest } = blob;
        if (rest.permissions) window.__opcPerms = rest.permissions;
        setState(prev => ({
          ...prev,
          org: { ...prev.org, ...(org || {}) },
          config: { ...prev.config, ...rest },
        }));
      } catch (e) {
        console.warn('[OPC] config load failed; using local defaults', e);
      }
    })();
    return () => { cancelled = true; };
  }, [realUserId]);

  // Load user profiles (admin + any created). Members can read all profiles.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.OPC_SB || !realUserId) return;
      try {
        const { data, error } = await window.OPC_SB
          .from('users').select('id,email,name,role,initials,active').eq('active', true);
        if (error || !data || cancelled) return;
        if (data.length) setState(prev => ({ ...prev, users: data }));
      } catch (e) {
        console.warn('[OPC] users load failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [realUserId]);

  // Load all transactional data from the DB (Phase 3). The app runs off these
  // rows; mutations are synced back via mutate() → __syncTables.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.OPC_SB || !realUserId) return;
      try {
        const results = await Promise.all(LOADED_TABLES.map(t => window.OPC_SB.from(t).select('*')));
        if (cancelled) return;
        setState(prev => {
          const next = { ...prev };
          LOADED_TABLES.forEach((t, i) => {
            const { data, error } = results[i];
            if (!error && Array.isArray(data)) next[t] = data;
          });
          return next;
        });
      } catch (e) {
        console.warn('[OPC] transactional load failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [realUserId]);

  // Hash routing
  React.useEffect(() => {
    const h = () => setRoute(window.location.hash.slice(1) || 'dashboard');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  const navigate = React.useCallback((r) => {
    window.location.hash = r;
    setRoute(r);
  }, []);

  // Helpers
  const getCustomer = (id) => state.customers.find(c => c.id === id);
  const getVendor = (id) => state.vendors.find(v => v.id === id);
  const getProduct = (id) => state.products.find(p => p.id === id);
  const getCategory = (id) => state.categories.find(c => c.id === id);
  const getUser = (id) => state.users.find(u => u.id === id);
  const getSO = (id) => state.sales_orders.find(s => s.id === id);

  // Computed: SO line subtotal
  const soSubtotal = (so) => so.lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0);
  const soTotalWithGST = (so) => {
    const sub = soSubtotal(so);
    const gst = sub * 0.18;
    return sub + gst;
  };

  // Mutations
  const mutate = React.useCallback((fn, auditEntry) => {
    setState(prev => {
      const next = fn(prev);
      if (auditEntry) {
        next.audit = [...(next.audit || []), { id: 'a' + Date.now(), ...auditEntry, ts: new Date().toISOString() }];
      }
      __syncTables(prev, next);   // optimistic write-through to Supabase
      return { ...next };
    });
  }, []);

  // Persist customization to the Supabase config singleton. `configPatch` merges
  // into state.config (industry_template, teams, gates, permissions, so_form_fields, …);
  // `orgPatch` merges into state.org. The DB blob is rebuilt as { org, ...config }.
  const saveConfig = React.useCallback(async (configPatch = {}, orgPatch = null) => {
    let snapshot = null;
    setState(prev => {
      const nextConfig = { ...prev.config, ...configPatch };
      const nextOrg = orgPatch ? { ...prev.org, ...orgPatch } : prev.org;
      snapshot = { org: nextOrg, ...nextConfig };
      if (nextConfig.permissions) window.__opcPerms = nextConfig.permissions;
      return { ...prev, config: nextConfig, org: nextOrg };
    });
    if (window.OPC_SB && snapshot) {
      try {
        await window.OPC_SB.from('config')
          .update({ data: snapshot, updated_at: new Date().toISOString() })
          .eq('id', 'singleton');
      } catch (e) {
        console.error('[OPC] saveConfig failed (kept local change)', e);
        return { ok: false, error: e };
      }
    }
    return { ok: true };
  }, []);

  // ===== Auth (real Supabase Auth / GoTrue — see migration 005) =====
  const login = React.useCallback(async (email, password) => {
    if (!window.OPC_SB) return { ok: false, error: 'Cannot reach the server.' };
    try {
      const { data, error } = await window.OPC_SB.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) return { ok: false, error: error.message };
      const uid = data.user?.id;
      // Fetch the caller's profile (role drives the dashboard).
      const { data: prof } = await window.OPC_SB.from('users')
        .select('id,email,name,role,initials,active').eq('id', uid).maybeSingle();
      if (!prof) { await window.OPC_SB.auth.signOut(); return { ok: false, error: 'No profile for this account. Contact your admin.' }; }
      setState(prev => ({ ...prev, users: prev.users.find(x => x.id === uid) ? prev.users.map(x => x.id === uid ? prof : x) : [...prev.users, prof] }));
      setRealUserId(uid); setCurrentUser(uid);
      return { ok: true, user: prof };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }, []);

  const logout = React.useCallback(async () => {
    try { await window.OPC_SB?.auth.signOut(); } catch (e) {}
    setRealUserId(null); setCurrentUser(null);
  }, []);

  // Admin-only persona impersonation for flow testing. Does NOT change the real
  // auth session (the admin JWT still authorizes all data), so you can always
  // switch back (or reload to reset).
  const impersonate = React.useCallback((uid) => { setCurrentUser(uid); }, []);
  const stopImpersonating = React.useCallback(() => { setCurrentUser(realUserId); }, [realUserId]);

  // One-time admin self-signup (server enforces: only if no admin exists yet),
  // then sign in to establish the session.
  const signupAdmin = React.useCallback(async ({ name, email, password }) => {
    if (!window.OPC_SB) return { ok: false, error: 'Cannot reach the server.' };
    try {
      const { data, error } = await window.OPC_SB.rpc('opc_signup_admin', { p_name: name, p_email: String(email).trim(), p_password: password });
      if (error) return { ok: false, error: error.message };
      const u = Array.isArray(data) ? data[0] : data;
      if (!u) return { ok: false, error: 'Signup failed.' };
      const signin = await window.OPC_SB.auth.signInWithPassword({ email: String(email).trim(), password });
      if (signin.error) return { ok: false, error: signin.error.message };
      setState(prev => ({ ...prev, users: [...prev.users.filter(x => x.id !== u.id), u] }));
      setRealUserId(u.id); setCurrentUser(u.id);
      return { ok: true, user: u };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }, []);

  // Admin creates a user (server-side opc_create_user makes the auth user + profile).
  const createUser = React.useCallback(async ({ name, email, password, role }) => {
    if (!window.OPC_SB) return { ok: false, error: 'Cannot reach the server.' };
    try {
      const { data, error } = await window.OPC_SB.rpc('opc_create_user',
        { p_name: name, p_email: String(email).trim(), p_password: password, p_role: role });
      if (error) return { ok: false, error: error.message };
      const u = Array.isArray(data) ? data[0] : data;
      if (!u) return { ok: false, error: 'Create failed.' };
      setState(prev => ({ ...prev, users: [...prev.users.filter(x => x.id !== u.id), u] }));
      return { ok: true, user: u };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }, []);

  const setUserActive = React.useCallback(async (id, active) => {
    setState(prev => ({ ...prev, users: prev.users.map(u => u.id === id ? { ...u, active } : u) }));
    if (window.OPC_SB) { const { error } = await window.OPC_SB.from('users').update({ active }).eq('id', id); if (error) console.error('[OPC] setUserActive failed', error.message); }
  }, []);

  const removeUser = React.useCallback(async (id) => {
    if (id === realUserId) return { ok: false, error: 'You cannot remove your own account.' };
    if (!window.OPC_SB) return { ok: false, error: 'Cannot reach the server.' };
    const { error } = await window.OPC_SB.rpc('opc_delete_user', { p_id: id });
    if (error) return { ok: false, error: error.message };
    setState(prev => ({ ...prev, users: prev.users.filter(u => u.id !== id) }));
    return { ok: true };
  }, [realUserId]);

  const resetData = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  const ctx = {
    state, setState, mutate, resetData, saveConfig,
    login, logout, signupAdmin, createUser, setUserActive, removeUser,
    impersonate, stopImpersonating, realUserId, authReady,
    route, navigate,
    roleFilter, setRoleFilter,
    currentUser, setCurrentUser,
    getCustomer, getVendor, getProduct, getCategory, getUser, getSO,
    soSubtotal, soTotalWithGST,
  };

  return <Store.Provider value={ctx}>{children}</Store.Provider>;
}

const useStore = () => React.useContext(Store);

window.Store = Store;
window.StoreProvider = StoreProvider;
window.useStore = useStore;
