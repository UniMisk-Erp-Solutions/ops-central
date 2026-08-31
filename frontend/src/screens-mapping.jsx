// ============================================================================
// Item Name Mapping — the 3-name chain
// ============================================================================
//   customer's name   ->   OUR item   ->   vendor's part number
//
// Mapped once against our internal item, then reused forever. With 10 000+
// vendors this is what makes the second PO to a vendor auto-fill: we never
// re-type their part numbers.
//
// Storage: item_aliases (org-scoped, RLS). Loaded on demand per party, never
// all at once, so the table stays fast no matter how many vendors exist.
// ============================================================================

function ItemMapping() {
  const { state, getProduct, getVendor, getCustomer, getUser, currentUser } = useStore();
  const toast = useToast();
  const [scope, setScope] = React.useState('vendor');
  const [partyId, setPartyId] = React.useState('');
  const [aliases, setAliases] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [draft, setDraft] = React.useState({});
  const [busy, setBusy] = React.useState('');
  const [showImport, setShowImport] = React.useState(false);
  const role = (getUser(currentUser) || {}).role;

  const parties = scope === 'vendor' ? (state.vendors || []) : (state.customers || []);

  const load = React.useCallback(async () => {
    if (!window.OPC_SB || !partyId) { setAliases({}); return; }
    setLoading(true);
    const r = await window.OPC_SB.rpc('opc_alias_map', { p_scope: scope, p_party_id: partyId });
    setLoading(false);
    if (r.error) { toast(r.error.message); return; }
    setAliases(r.data || {});
    setDraft({});
  }, [scope, partyId]);
  React.useEffect(() => { load(); }, [load]);

  const products = (state.products || []).filter(p => {
    if (!q.trim()) return true;
    const a = aliases[p.id] || {};
    return `${p.name} ${p.code} ${a.code || ''} ${a.name || ''}`.toLowerCase().includes(q.trim().toLowerCase());
  });

  const setD = (pid, field, val) => setDraft(d => ({ ...d, [pid]: { ...(d[pid] || {}), [field]: val } }));
  const valOf = (pid, field) => {
    const d = draft[pid] || {};
    if (d[field] !== undefined) return d[field];
    return (aliases[pid] || {})[field] || '';
  };

  const save = async (pid) => {
    if (!partyId) { toast('Pick a vendor or customer first'); return; }
    const code = valOf(pid, 'code'), name = valOf(pid, 'name');
    if (!String(code).trim() && !String(name).trim()) { toast('Enter their part number or description'); return; }
    setBusy(pid);
    const r = await window.OPC_SB.rpc('opc_alias_set', {
      p_product_id: pid, p_scope: scope, p_party_id: partyId,
      p_alias_code: String(code || ''), p_alias_name: String(name || ''), p_uom: null });
    setBusy('');
    if (r.error) { toast(r.error.message || 'Could not save'); return; }
    setAliases(a => ({ ...a, [pid]: { code, name, uom: (a[pid] || {}).uom || null } }));
    setDraft(d => { const n = { ...d }; delete n[pid]; return n; });
    toast('Mapping saved — it will auto-fill next time', 'success');
  };

  const mappedCount = Object.keys(aliases).length;
  const partyName = partyId
    ? ((scope === 'vendor' ? getVendor(partyId) : getCustomer(partyId)) || {}).name || partyId
    : '';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Name Mapping</h1>
          <div className="page-sub">
            customer's name → <strong>our item</strong> → vendor's part number · mapped once, reused forever
          </div>
        </div>
        <div className="page-actions">
          {canImportSheet(role) && <button className="btn" onClick={() => setShowImport(true)} title="Turn a customer working sheet into a draft order"><Icon name="upload" size={13}/>Import customer sheet</button>}
        </div>
      </div>

      <div className="card mb-2"><div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ width: 160 }}>
          <label className="field-label">Map for</label>
          <select className="select" value={scope} onChange={e => { setScope(e.target.value); setPartyId(''); }}>
            <option value="vendor">Vendor (PO names)</option>
            <option value="customer">Customer (order names)</option>
          </select>
        </div>
        <div className="field" style={{ width: 280 }}>
          <label className="field-label">{scope === 'vendor' ? 'Vendor' : 'Customer'}</label>
          <select className="select" value={partyId} onChange={e => setPartyId(e.target.value)}>
            <option value="">— select —</option>
            {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field grow" style={{ minWidth: 180 }}>
          <label className="field-label">Search items</label>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="our name, code, or their part no…"/>
        </div>
        {partyId && <span className="badge accent" style={{ marginBottom: 6 }}>{mappedCount} mapped</span>}
      </div></div>

      {!partyId ? (
        <div className="card"><div className="empty">
          <div className="empty-title">Pick a {scope} to map</div>
          Their part numbers are stored against our items, so a PO can be printed in exactly the format they accept.
        </div></div>
      ) : (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">{partyName}</h3>
            <span className="card-sub">{loading ? 'loading…' : `${products.length} item(s)`}</span>
          </div>
          <div className="card-body flush">
            <table className="t">
              <thead><tr>
                <th>Our item</th>
                <th>{scope === 'vendor' ? "Vendor's part no." : "Customer's code"}</th>
                <th>{scope === 'vendor' ? "Vendor's description" : "Customer's description"}</th>
                <th style={{ width: 90 }}></th>
              </tr></thead>
              <tbody>
                {products.map(p => {
                  const mapped = !!aliases[p.id];
                  const dirty = !!draft[p.id];
                  return (
                    <tr key={p.id} style={mapped && !dirty ? { background: 'var(--success-bg)' } : null}>
                      <td>
                        <div className="small">{p.name}</div>
                        <div className="tiny muted mono">{p.code}</div>
                      </td>
                      <td><input className="input mono" value={valOf(p.id, 'code')}
                        onChange={e => setD(p.id, 'code', e.target.value)}
                        placeholder={scope === 'vendor' ? 'C9606R' : '—'} style={{ height: 26 }}/></td>
                      <td><input className="input" value={valOf(p.id, 'name')}
                        onChange={e => setD(p.id, 'name', e.target.value)}
                        placeholder="their description" style={{ height: 26 }}/></td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm" disabled={busy === p.id || !dirty} onClick={() => save(p.id)}>
                          {busy === p.id ? '…' : (mapped ? 'Update' : 'Map')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && <tr><td colSpan="4"><div className="empty">No items match.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showImport && <SheetImportModal onClose={() => setShowImport(false)}/>}
    </div>
  );
}

// The sheet importer lives in screens-import.jsx — it is shared by the
// Sales Orders screen and this one, so there is only ever one parser.

window.ItemMapping = ItemMapping;
