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
  const { state, getProduct, getVendor, getCustomer } = useStore();
  const toast = useToast();
  const [scope, setScope] = React.useState('vendor');
  const [partyId, setPartyId] = React.useState('');
  const [aliases, setAliases] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [draft, setDraft] = React.useState({});
  const [busy, setBusy] = React.useState('');
  const [showImport, setShowImport] = React.useState(false);

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
          <button className="btn" onClick={() => setShowImport(true)}><Icon name="upload" size={13}/>Import sheet</button>
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

// ===========================================================================
// Import a customer sheet (Excel / CSV) → an editable Sales Order
// ===========================================================================
// Reads the working sheet pre-sales sends. Columns are matched by header name,
// so a slightly different sheet still imports. Each row is resolved back to OUR
// item via opc_alias_resolve (customer alias -> our code -> our name); anything
// unmatched is flagged so Purchase can map it once and never again.
// ===========================================================================
function SheetImportModal({ onClose }) {
  const { state, mutate, getProduct, currentUser } = useStore();
  const toast = useToast();
  const [rows, setRows] = React.useState(null);
  const [custId, setCustId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [fileName, setFileName] = React.useState('');

  // Load SheetJS on demand — only when an .xlsx is actually chosen.
  const ensureXLSX = () => new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Could not load the spreadsheet reader'));
    document.head.appendChild(s);
  });

  const HEAD = {
    sr: ['sr no', 'sr.no', 'srno', 'sr', 's.no', 'sno'],
    code: ['part no', 'part no.', 'partno', 'part number', 'model', 'sku'],
    desc: ['item description', 'description', 'item', 'particulars'],
    unit: ['unit', 'uom'],
    qty: ['qty', 'qty.', 'quantity'],
    rate: ['unit rate', 'rate', 'unit price', 'price'],
    tax: ['tax rate %', 'tax %', 'gst', 'gst %', 'tax'],
    group: ['type of equipments', 'type of equipment', 'group', 'category'],
  };
  const pick = (headers, keys) => {
    const low = headers.map(h => String(h || '').trim().toLowerCase());
    for (const k of keys) { const i = low.indexOf(k); if (i !== -1) return i; }
    for (let i = 0; i < low.length; i++) { if (keys.some(k => low[i].includes(k))) return i; }
    return -1;
  };

  const parseMatrix = async (matrix) => {
    // find the header row (the one containing a qty-ish and a description-ish column)
    let hIdx = 0;
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      const r = matrix[i] || [];
      if (pick(r, HEAD.qty) !== -1 && (pick(r, HEAD.desc) !== -1 || pick(r, HEAD.code) !== -1)) { hIdx = i; break; }
    }
    const headers = matrix[hIdx] || [];
    const col = {
      sr: pick(headers, HEAD.sr), code: pick(headers, HEAD.code), desc: pick(headers, HEAD.desc),
      unit: pick(headers, HEAD.unit), qty: pick(headers, HEAD.qty), rate: pick(headers, HEAD.rate),
      tax: pick(headers, HEAD.tax), group: pick(headers, HEAD.group),
    };
    let group = '';
    const out = [];
    for (let i = hIdx + 1; i < matrix.length; i++) {
      const r = matrix[i] || [];
      const joined = r.map(x => String(x == null ? '' : x)).join(' ').trim();
      if (!joined) continue;
      if (col.group !== -1 && String(r[col.group] || '').trim()) group = String(r[col.group]).trim();
      const desc = col.desc !== -1 ? String(r[col.desc] || '').trim() : '';
      const code = col.code !== -1 ? String(r[col.code] || '').trim() : '';
      const qty = col.qty !== -1 ? Number(String(r[col.qty]).replace(/[^0-9.\-]/g, '')) : NaN;
      // group header / subtotal rows carry a label but no usable qty
      if (!desc && !code) continue;
      if (/total/i.test(joined) && !(qty > 0)) continue;
      out.push({
        sr: col.sr !== -1 ? String(r[col.sr] || '').trim() : String(out.length + 1),
        group,
        code, desc,
        unit: col.unit !== -1 ? String(r[col.unit] || '').trim() : 'Nos.',
        qty: qty > 0 ? qty : 0,
        rate: col.rate !== -1 ? (Number(String(r[col.rate]).replace(/[^0-9.\-]/g, '')) || 0) : 0,
        tax: col.tax !== -1 ? (Number(String(r[col.tax]).replace(/[^0-9.\-]/g, '')) || 0) : 18,
        product_id: null, matched_by: null,
      });
    }
    // resolve each row back to OUR item
    if (window.OPC_SB) {
      for (const row of out) {
        try {
          const r = await window.OPC_SB.rpc('opc_alias_resolve', {
            p_scope: 'customer', p_party_id: custId || null, p_code: row.code || null, p_name: row.desc || null });
          if (r.data && r.data.product_id) { row.product_id = r.data.product_id; row.matched_by = r.data.matched_by; }
        } catch (e) { /* leave unmatched */ }
      }
    }
    return out;
  };

  const onFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      let matrix;
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text();
        matrix = text.split(/\r?\n/).map(line => line.split(',').map(c => c.replace(/^"|"$/g, '')));
      } else {
        const XLSX = await ensureXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      }
      const parsed = await parseMatrix(matrix);
      setRows(parsed);
      if (!parsed.length) toast('No item rows found — check the sheet has a Qty and Description column');
    } catch (e) {
      toast('Could not read that file: ' + String(e.message || e));
    }
    setBusy(false);
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));

  const createSO = () => {
    const usable = (rows || []).filter(r => r.qty > 0);
    if (!usable.length) { toast('Nothing to import'); return; }
    if (!custId) { toast('Pick the customer this sheet is for'); return; }
    setBusy(true);
    const soId = 'so-' + Date.now();
    const seq = 1 + (state.sales_orders || []).length;
    // Each imported row becomes a line carrying BOTH the customer's wording and
    // our item, so Purchase can restructure it into our BOQ afterwards.
    const lines = usable.map((r, i) => ({
      id: 'l' + Date.now() + i,
      category_id: r.group || 'Imported',
      bundle_qty: 1,
      unit_price: Math.round((r.rate || 0) * (r.qty || 0)),
      customer_ref: { sr: r.sr, code: r.code, desc: r.desc, unit: r.unit, tax: r.tax, group: r.group },
      components: r.product_id ? [{ product_id: r.product_id, qty: r.qty }] : [],
    }));
    const so = {
      id: soId,
      so_no: `SO/FY26/${String(seq).padStart(4, '0')}`,
      customer_id: custId,
      date: TODAY,
      status: 'Draft',
      priority: 'Standard',
      lines,
      imported_from: fileName,
      created_by: currentUser,
    };
    mutate(s => ({
      ...s,
      sales_orders: [so, ...(s.sales_orders || [])],
      notifications: [{ id: 'n-imp-' + Date.now(), kind: 'so', text: `${so.so_no} imported from ${fileName} · ${usable.length} line(s)`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications],
    }), { action: 'import-sheet', entity: 'SalesOrder', entity_id: soId, user_id: currentUser,
          detail: `Imported ${usable.length} line(s) from ${fileName}` });
    setBusy(false);
    toast(`${so.so_no} created from ${fileName}`, 'success');
    onClose();
  };

  const matched = (rows || []).filter(r => r.product_id).length;
  const unmatched = (rows || []).filter(r => !r.product_id && r.qty > 0).length;

  return (
    <Modal title="Import customer sheet" size="lg" onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || !rows || !rows.length} onClick={createSO}>
        <Icon name="check" size={13}/>{busy ? 'Working…' : 'Create Sales Order'}</button></>}>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Customer *</label>
          <select className="select" value={custId} onChange={e => setCustId(e.target.value)}>
            <option value="">— select —</option>
            {(state.customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Sheet (.xlsx or .csv)</label>
          <input type="file" accept=".xlsx,.xls,.csv" className="input" onChange={e => onFile(e.target.files && e.target.files[0])}/>
        </div>
      </div>

      {rows && (
        <>
          <div className="tiny muted" style={{ margin: '10px 0 6px' }}>
            {rows.length} row(s) read · <span style={{ color: 'var(--success)' }}>{matched} matched to our items</span>
            {unmatched > 0 && <> · <span style={{ color: 'var(--warning)' }}>{unmatched} need mapping</span></>}
            . Unmatched rows still import — map them once in Item Name Mapping and future sheets match automatically.
          </div>
          <div className="card"><div className="card-body flush" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="t">
              <thead><tr><th>Sr</th><th>Group</th><th>Customer's part / description</th><th className="num">Qty</th><th className="num">Rate</th><th>Our item</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={!r.product_id && r.qty > 0 ? { background: 'var(--warning-bg)' } : null}>
                    <td className="tiny mono">{r.sr}</td>
                    <td className="tiny muted trunc">{r.group}</td>
                    <td><div className="small trunc">{r.desc}</div><div className="tiny muted mono">{r.code}</div></td>
                    <td className="num mono">{r.qty}</td>
                    <td className="num mono">{r.rate ? inr(r.rate) : '—'}</td>
                    <td>
                      <select className="select" value={r.product_id || ''} onChange={e => setRow(i, { product_id: e.target.value || null, matched_by: 'manual' })} style={{ height: 24, fontSize: 11.5, maxWidth: 190 }}>
                        <option value="">— unmatched —</option>
                        {(state.products || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {r.matched_by && r.product_id && <div className="tiny muted">via {r.matched_by}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </>
      )}
    </Modal>
  );
}

window.ItemMapping = ItemMapping;
window.SheetImportModal = SheetImportModal;
