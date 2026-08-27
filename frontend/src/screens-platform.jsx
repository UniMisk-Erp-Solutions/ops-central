// ============================================================================
// Platform console — the developer / master-admin dashboard
// ============================================================================
// Manage every organization on the platform from one screen: identity, tenant
// subdomain, feature access, plan & billing, and per-org permissions/workflow.
//
// Everything here goes through opc_admin_* RPCs that authorise on
// is_master_admin() ONLY, so a tenant admin can never reach it — and the whole
// table loads in ONE round trip to keep load off the server.
//
// Feature checkboxes write EXPLICIT rows: ticked = true, unticked = false. There
// is no ambiguous "missing" state, so "not selected" really means the tenant
// cannot see that feature.
// ============================================================================

// Every capability the platform can grant. `route` is what disappears when off.
const PLATFORM_FEATURES = [
  { key: 'presales',          label: 'Pre-sales / Sourcing',  routes: 'sourcing' },
  { key: 'sales_desk',        label: 'Sales desk',            routes: 'sales-orders, customers' },
  { key: 'stores',            label: 'Stores & Godown',       routes: 'godown, grn' },
  { key: 'surplus_pool',      label: 'Master Surplus Pool',   routes: 'pool' },
  { key: 'cross_so_transfer', label: 'Cross-SO transfers',    routes: 'transfers' },
  { key: 'rfq_email',         label: 'RFQ comparison',        routes: 'rfq' },
  { key: 'implementation',    label: 'Implementation / BOQ',  routes: '—' },
  { key: 'partial_invoicing', label: 'Partial invoicing',     routes: '—' },
  { key: 'e_invoice',         label: 'e-Invoice',             routes: '—' },
  { key: 'e_way_bill',        label: 'e-Way Bill',            routes: '—' },
  { key: 'whatsapp',          label: 'WhatsApp alerts',       routes: '—' },
  { key: 'sms',               label: 'SMS alerts',            routes: '—' },
];
const PLANS = ['free-trial', 'starter', 'pro'];
const BILLING = ['active', 'pending', 'overdue', 'suspended', 'cancelled'];

function planBadge(p) {
  const cls = p === 'pro' ? 'success' : p === 'starter' ? 'accent' : '';
  return <span className={`badge ${cls} dot`}>{p}</span>;
}
function billingBadge(b) {
  const cls = b === 'active' ? 'success' : b === 'pending' ? 'accent'
    : b === 'overdue' ? 'warning' : 'danger';
  return <span className={`badge ${cls} dot`}>{b}</span>;
}

function PlatformConsole() {
  const { state } = useStore();
  const toast = useToast();
  const [orgs, setOrgs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [open, setOpen] = React.useState({});          // expanded org rows
  const [subEdit, setSubEdit] = React.useState({});    // inline subdomain edits
  const [showNew, setShowNew] = React.useState(false);
  const isMaster = typeof window !== 'undefined' && window.__opcIsMaster;
  const baseDomain = (window.OPC_TENANT && window.OPC_TENANT.getAppBaseDomain()) || '';

  const load = React.useCallback(async () => {
    if (!window.OPC_SB) { setLoading(false); return; }
    const r = await window.OPC_SB.rpc('opc_admin_list_organizations');
    if (r.error) { setErr(r.error.message); setLoading(false); return; }
    setOrgs(Array.isArray(r.data) ? r.data : []);
    setErr(''); setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  if (!isMaster) {
    return <div className="page"><div className="empty">
      <div className="empty-title">Platform console</div>
      This area is for platform administrators only.
    </div></div>;
  }

  // ---- mutations (each patches local state so the table stays instant) ----
  const patch = (id, fields) => setOrgs(list => list.map(o => o.id === id ? { ...o, ...fields } : o));

  const toggleFeature = async (org, key, next) => {
    setBusy(org.id + key);
    const r = await window.OPC_SB.rpc('opc_admin_set_feature',
      { p_org_id: org.id, p_key: key, p_enabled: next });
    setBusy('');
    if (r.error) { toast(r.error.message || 'Could not change feature'); return; }
    patch(org.id, { features: r.data || {} });
    // If it's my own active org, apply immediately without a reload.
    if (window.__opcOrg && window.__opcOrg.id === org.id) window.__opcFeatures = r.data || {};
    toast(`${key} ${next ? 'enabled' : 'disabled'} for ${org.name}`, 'success');
  };

  const saveSubdomain = async (org) => {
    const val = subEdit[org.id];
    if (val === undefined) return;
    setBusy(org.id + 'sub');
    const r = await window.OPC_SB.rpc('opc_admin_set_subdomain',
      { p_org_id: org.id, p_subdomain: val.trim() });
    setBusy('');
    if (r.error) { toast(r.error.message || 'Could not set subdomain'); return; }
    patch(org.id, { subdomain: (r.data && r.data.subdomain) || null });
    setSubEdit(s => { const n = { ...s }; delete n[org.id]; return n; });
    toast('Subdomain saved', 'success');
  };

  const setBilling = async (org, plan, billing) => {
    setBusy(org.id + 'bill');
    const r = await window.OPC_SB.rpc('opc_admin_set_billing',
      { p_org_id: org.id, p_plan: plan, p_billing_status: billing });
    setBusy('');
    if (r.error) { toast(r.error.message || 'Could not update billing'); return; }
    patch(org.id, { plan: r.data.plan, billing_status: r.data.billing_status });
    toast('Billing updated', 'success');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform console</h1>
          <div className="page-sub">
            Every organization on this deployment · {orgs.length} tenant(s) ·
            base domain <span className="mono">{baseDomain}</span>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={load}><Icon name="repeat" size={13}/>Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="plus" size={13}/>New organization</button>
        </div>
      </div>

      {err && <div className="card mb-2" style={{ borderColor: 'var(--danger)' }}><div className="card-body">
        <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>
      </div></div>}

      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr>
              <th style={{ width: 22 }}></th>
              <th>Organization</th>
              <th>Slug</th>
              <th>Tenant subdomain</th>
              <th className="num">Members</th>
              <th className="num">SOs</th>
              <th>Plan</th>
              <th>Payment</th>
              <th className="num">Features</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan="9"><div className="empty">Loading…</div></td></tr>}
              {!loading && orgs.length === 0 && <tr><td colSpan="9"><div className="empty">No organizations yet.</div></td></tr>}
              {orgs.map(o => {
                const feats = o.features || {};
                const onCount = PLATFORM_FEATURES.filter(f => feats[f.key] === true).length;
                const editing = subEdit[o.id] !== undefined;
                const isOpen = !!open[o.id];
                const blocked = ['suspended', 'cancelled'].includes(o.billing_status) || o.status !== 'active';
                return (
                  <React.Fragment key={o.id}>
                    <tr style={blocked ? { background: 'var(--danger-bg)' } : null}>
                      <td style={{ cursor: 'pointer' }} onClick={() => setOpen(s => ({ ...s, [o.id]: !isOpen }))}>
                        <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12}/>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{o.name}</div>
                        <div className="tiny muted mono" title="Organization ID">{o.id}</div>
                      </td>
                      <td className="mono small">{o.slug}</td>
                      <td>
                        {editing ? (
                          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input className="input mono" value={subEdit[o.id]} autoFocus
                              onChange={e => setSubEdit(s => ({ ...s, [o.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') saveSubdomain(o); if (e.key === 'Escape') setSubEdit(s => { const n={...s}; delete n[o.id]; return n; }); }}
                              placeholder="acme" style={{ width: 110, height: 26 }}/>
                            <button className="btn btn-sm btn-primary" disabled={busy === o.id + 'sub'} onClick={() => saveSubdomain(o)}>Save</button>
                            <button className="btn btn-sm" onClick={() => setSubEdit(s => { const n={...s}; delete n[o.id]; return n; })}>✕</button>
                          </span>
                        ) : (
                          <span style={{ cursor: 'pointer' }} onClick={() => setSubEdit(s => ({ ...s, [o.id]: o.subdomain || '' }))}>
                            {o.subdomain
                              ? <span className="mono small">{o.subdomain}<span className="tiny muted">.{baseDomain}</span></span>
                              : <span className="tiny muted">shared host — click to assign</span>}
                            <Icon name="edit" size={10} color="var(--text-muted)"/>
                          </span>
                        )}
                      </td>
                      <td className="num">{o.members}</td>
                      <td className="num">{o.sales_orders}</td>
                      <td>
                        <select className="select" value={o.plan} disabled={busy === o.id + 'bill'}
                          onChange={e => setBilling(o, e.target.value, null)}
                          style={{ height: 26, fontSize: 12 }}>
                          {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="select" value={o.billing_status} disabled={busy === o.id + 'bill'}
                          onChange={e => setBilling(o, null, e.target.value)}
                          style={{ height: 26, fontSize: 12 }}>
                          {BILLING.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                      <td className="num">
                        <span className="badge accent">{onCount}/{PLATFORM_FEATURES.length}</span>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="subrow"><td></td><td colSpan="8" style={{ padding: '10px 8px 16px' }}>
                        {blocked && (
                          <div className="tiny" style={{ color: 'var(--danger)', marginBottom: 8, fontWeight: 600 }}>
                            ⚠ This organization is {o.status !== 'active' ? o.status : o.billing_status} — its users currently have NO access.
                          </div>
                        )}
                        <div className="tiny muted" style={{ marginBottom: 6 }}>
                          Tick a capability to grant it. Unticked means the tenant cannot see it at all —
                          the nav item disappears and its routes are blocked. Takes effect for that tenant on their next page load.
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
                          {PLATFORM_FEATURES.map(f => {
                            const on = feats[f.key] === true;
                            const unset = !(f.key in feats);
                            return (
                              <label key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 8px',
                                border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
                                background: on ? 'var(--success-bg)' : 'var(--surface)' }}>
                                <input type="checkbox" checked={on} disabled={busy === o.id + f.key}
                                  onChange={e => toggleFeature(o, f.key, e.target.checked)} style={{ marginTop: 2 }}/>
                                <span style={{ minWidth: 0 }}>
                                  <span className="small" style={{ fontWeight: 500 }}>{f.label}</span>
                                  {unset && <span className="tiny muted"> · not set</span>}
                                  <div className="tiny muted mono trunc">{f.key}</div>
                                  <div className="tiny muted">hides: {f.routes}</div>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <OrgLoginsPanel org={o}/>
                        <OrgConfigPanel org={o}/>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="tiny muted mt-2">
        A tenant subdomain works as soon as the wildcard DNS + Vercel domain exist —
        assigning it here needs no Vercel change per organization.
      </div>

      {showNew && <NewOrgModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }}/>}
    </div>
  );
}

// ---- per-org permissions / workflow / structure -----------------------------
// Writes the SAME config blob the tenant app reads, but for any org — so roles
// and workflow stages can be shaped per tenant without switching into it.
function OrgConfigPanel({ org }) {
  const toast = useToast();
  const [cfg, setCfg] = React.useState(null);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [show, setShow] = React.useState(false);

  const load = async () => {
    const r = await window.OPC_SB.rpc('opc_admin_get_org_config', { p_org_id: org.id });
    if (r.error) { toast(r.error.message); return; }
    setCfg(r.data || {});
    setText(JSON.stringify(r.data || {}, null, 2));
    setShow(true);
  };
  const save = async () => {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { toast('Not valid JSON — fix it before saving'); return; }
    setBusy(true);
    const r = await window.OPC_SB.rpc('opc_admin_set_org_config', { p_org_id: org.id, p_data: parsed });
    setBusy(false);
    if (r.error) { toast(r.error.message || 'Could not save'); return; }
    toast(`Config saved for ${org.name}`, 'success');
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong className="small">Permissions · workflow stages · org structure</strong>
        {!show
          ? <button className="btn btn-sm" onClick={load}><Icon name="settings" size={11}/>Open config</button>
          : <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}><Icon name="save" size={11}/>{busy ? 'Saving…' : 'Save config'}</button>}
      </div>
      {show && (
        <>
          <div className="tiny muted" style={{ margin: '6px 0' }}>
            This is {org.name}'s own config row — the same keys the tenant's Customisation
            screen edits (<span className="mono">permissions</span>, <span className="mono">workflow_stages</span>,
            <span className="mono"> teams</span>, <span className="mono">approval_gates</span>…). Editing here never
            touches another organization.
          </div>
          <textarea className="textarea mono" rows="12" value={text} onChange={e => setText(e.target.value)}
            style={{ fontSize: 11.5, width: '100%' }}/>
        </>
      )}
    </div>
  );
}

// ---- create organization ----------------------------------------------------
function NewOrgModal({ onClose, onCreated }) {
  const toast = useToast();
  const { state } = useStore();
  const [name, setName] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [sub, setSub] = React.useState('');
  const [plan, setPlan] = React.useState('free-trial');
  const [admin, setAdmin] = React.useState('');
  const [feats, setFeats] = React.useState(() =>
    Object.fromEntries(PLATFORM_FEATURES.map(f => [f.key, true])));
  const [busy, setBusy] = React.useState(false);
  const baseDomain = (window.OPC_TENANT && window.OPC_TENANT.getAppBaseDomain()) || '';

  const autoSlug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

  const create = async () => {
    if (!name.trim()) { toast('Name is required'); return; }
    const s = (slug || autoSlug(name)).trim();
    setBusy(true);
    const r = await window.OPC_SB.rpc('opc_admin_create_org', {
      p_name: name.trim(), p_slug: s, p_subdomain: sub.trim() || null,
      p_plan: plan, p_features: feats, p_admin_user_id: admin || null,
    });
    setBusy(false);
    if (r.error) { toast(r.error.message || 'Could not create organization'); return; }
    toast(`${name} created`, 'success');
    onCreated();
  };

  return (
    <Modal title="New organization" size="lg" onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={create}>
        <Icon name="plus" size={13}/>{busy ? 'Creating…' : 'Create organization'}</button></>}>
      <div className="field-row">
        <div className="field"><label className="field-label">Organization name *</label>
          <input className="input" value={name} autoFocus
            onChange={e => { setName(e.target.value); if (!slug) setSlug(autoSlug(e.target.value)); }}
            placeholder="Acme Pvt Ltd"/></div>
        <div className="field"><label className="field-label">Slug * <span className="tiny muted">(unique id)</span></label>
          <input className="input mono" value={slug} onChange={e => setSlug(autoSlug(e.target.value))} placeholder="acme"/></div>
      </div>
      <div className="field-row mt-2">
        <div className="field"><label className="field-label">Tenant subdomain <span className="tiny muted">(optional)</span></label>
          <input className="input mono" value={sub} onChange={e => setSub(e.target.value.toLowerCase())} placeholder="acme"/>
          <div className="tiny muted mt-1">{sub ? `https://${sub}.${baseDomain}` : `blank = lives on ${baseDomain}`}</div></div>
        <div className="field"><label className="field-label">Plan</label>
          <select className="select" value={plan} onChange={e => setPlan(e.target.value)}>
            {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
          </select></div>
      </div>
      <div className="field mt-2"><label className="field-label">First admin <span className="tiny muted">(optional — an existing login)</span></label>
        <select className="select" value={admin} onChange={e => setAdmin(e.target.value)}>
          <option value="">— assign later —</option>
          {(state.users || []).map(u => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
        </select>
        <div className="tiny muted mt-1">The login must already exist. Create it in Settings → Users, then assign it here.</div>
      </div>
      <div className="field mt-2">
        <label className="field-label">Features this organization gets</label>
        <div className="tiny muted mb-1">Unticked capabilities are written as an explicit “off” — the tenant will not see them at all.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 5 }}>
          {PLATFORM_FEATURES.map(f => (
            <label key={f.key} style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '5px 7px',
              border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
              background: feats[f.key] ? 'var(--success-bg)' : 'var(--surface)' }}>
              <input type="checkbox" checked={!!feats[f.key]}
                onChange={e => setFeats(s => ({ ...s, [f.key]: e.target.checked }))}/>
              <span className="small">{f.label}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}


// ---- logins for one organization -------------------------------------------
// Create a tenant's login, change its email, or reset its password.
// Data is tied to the user id, never the email address — changing either
// credential leaves every row, membership and audit entry exactly where it was.
function OrgLoginsPanel({ org }) {
  const toast = useToast();
  const [rows, setRows] = React.useState(null);
  const [busy, setBusy] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [f, setF] = React.useState({ name: '', email: '', password: '', role: 'Sales', org_role: 'member' });
  const [edit, setEdit] = React.useState({});

  const load = React.useCallback(async () => {
    const r = await window.OPC_SB.rpc('opc_admin_org_members', { p_org_id: org.id });
    if (r.error) { toast(r.error.message); return; }
    setRows(Array.isArray(r.data) ? r.data : []);
  }, [org.id]);
  React.useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!f.email.trim() || f.password.length < 8) { toast('Email and a password of 8+ characters are required'); return; }
    setBusy('new');
    const r = await window.OPC_SB.rpc('opc_admin_create_user', {
      p_org_id: org.id, p_name: f.name.trim() || f.email.trim(), p_email: f.email.trim(),
      p_password: f.password, p_role: f.role, p_org_role: f.org_role,
    });
    setBusy('');
    if (r.error) { toast(r.error.message || 'Could not create login'); return; }
    toast('Login created for ' + f.email, 'success');
    setF({ name: '', email: '', password: '', role: 'Sales', org_role: 'member' });
    setAdding(false); load();
  };

  const saveEmail = async (u) => {
    const v = (edit[u.user_id] || {}).email;
    if (!v) return;
    setBusy(u.user_id + 'e');
    const r = await window.OPC_SB.rpc('opc_admin_set_user_email', { p_user_id: u.user_id, p_new_email: v.trim() });
    setBusy('');
    if (r.error) { toast(r.error.message || 'Could not change email'); return; }
    toast('Email changed — their data is untouched', 'success');
    setEdit(s => ({ ...s, [u.user_id]: {} })); load();
  };

  const savePassword = async (u) => {
    const v = (edit[u.user_id] || {}).password;
    if (!v || v.length < 8) { toast('Password must be at least 8 characters'); return; }
    setBusy(u.user_id + 'p');
    const r = await window.OPC_SB.rpc('opc_admin_set_user_password', { p_user_id: u.user_id, p_new_password: v });
    setBusy('');
    if (r.error) { toast(r.error.message || 'Could not reset password'); return; }
    toast('Password reset · existing sessions revoked', 'success');
    setEdit(s => ({ ...s, [u.user_id]: {} }));
  };

  const toggleActive = async (u) => {
    setBusy(u.user_id + 'a');
    const r = await window.OPC_SB.rpc('opc_admin_set_user_active', { p_user_id: u.user_id, p_active: !u.is_active });
    setBusy('');
    if (r.error) { toast(r.error.message); return; }
    load();
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong className="small">Logins</strong>
        <span className="tiny muted grow">
          Changing an email or password never moves data — every row is tied to the user id.
        </span>
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(a => !a)}>
          <Icon name="plus" size={11}/>{adding ? 'Cancel' : 'New login'}
        </button>
      </div>

      {adding && (
        <div className="card mb-2"><div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
          <div className="field"><label className="field-label">Name</label>
            <input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Full name"/></div>
          <div className="field"><label className="field-label">Email *</label>
            <input className="input mono" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="user@acme.com"/></div>
          <div className="field"><label className="field-label">Password * <span className="tiny muted">(8+)</span></label>
            <input className="input mono" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} placeholder="8+ characters"/></div>
          <div className="field"><label className="field-label">App role</label>
            <select className="select" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
              {Object.keys(window.PERMISSIONS || {}).map(r => <option key={r} value={r}>{r}</option>)}
            </select></div>
          <div className="field"><label className="field-label">Org role</label>
            <select className="select" value={f.org_role} onChange={e => setF({ ...f, org_role: e.target.value })}>
              <option value="member">member</option><option value="admin">admin</option>
            </select></div>
          <button className="btn btn-primary" disabled={busy === 'new'} onClick={create}>
            {busy === 'new' ? 'Creating…' : 'Create login'}</button>
        </div></div>
      )}

      {rows === null ? <div className="tiny muted">Loading…</div> : rows.length === 0 ? (
        <div className="tiny muted">No logins in this organization yet.</div>
      ) : (
        <table className="t">
          <thead><tr><th>User</th><th>Email</th><th>Org role</th><th>Status</th><th style={{ width: 260 }}>Change credentials</th></tr></thead>
          <tbody>
            {rows.map(u => {
              const e = edit[u.user_id] || {};
              return (
                <tr key={u.user_id}>
                  <td><div className="small">{u.name || '-'}</div><div className="tiny muted mono trunc">{u.user_id}</div></td>
                  <td className="mono small">{u.email}</td>
                  <td className="small">{u.role}{u.app_role ? <div className="tiny muted">{u.app_role}</div> : null}</td>
                  <td>{u.is_active ? <span className="badge success dot">active</span> : <span className="badge dot">disabled</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input className="input mono" placeholder="new email" value={e.email || ''}
                        onChange={ev => setEdit(s => ({ ...s, [u.user_id]: { ...e, email: ev.target.value } }))}
                        style={{ height: 24, fontSize: 11.5 }}/>
                      <button className="btn btn-sm" disabled={busy === u.user_id + 'e' || !e.email} onClick={() => saveEmail(u)}>Set</button>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input className="input mono" placeholder="new password (8+)" value={e.password || ''}
                        onChange={ev => setEdit(s => ({ ...s, [u.user_id]: { ...e, password: ev.target.value } }))}
                        style={{ height: 24, fontSize: 11.5 }}/>
                      <button className="btn btn-sm" disabled={busy === u.user_id + 'p' || !e.password} onClick={() => savePassword(u)}>Reset</button>
                      <button className="btn btn-sm" disabled={busy === u.user_id + 'a'} onClick={() => toggleActive(u)}>
                        {u.is_active ? 'Disable' : 'Enable'}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

window.PlatformConsole = PlatformConsole;
