// OP Central — Procurement screens: RFQ, Vendor PO, GRN, 3-Way Match

// ===== Auto comparison engine =====
// For one project (SO): compare the chosen vendor per item against the cheapest
// available across all vendors, and roll up revenue / spend / savings.
function projectComparison(state, soId, getProduct) {
  const so = state.sales_orders.find(x => x.id === soId);
  if (!so) return null;
  const sourcing = soSourcing(state, soId);
  const pos = state.vendor_pos.filter(p => p.so_id === soId);
  const req = soReqComponents(so);
  const picks = (sourcing && sourcing.picks) || {};
  const sprices = (sourcing && sourcing.prices) || {};
  const priceFor = (vid, p) => (sprices[p.id] && sprices[p.id][vid] != null)
    ? sprices[p.id][vid]
    : (window.vendorUnitPrice ? window.vendorUnitPrice(vid, p) : (p.buy || 0));
  const poLineVendor = (pid) => {
    for (const po of pos) { const it = (po.items || []).find(x => x.product_id === pid); if (it) return { vid: po.vendor_id, rate: it.rate }; }
    return null;
  };
  const rows = Object.entries(req).map(([pid, qty]) => {
    const p = getProduct(pid) || { id: pid, name: pid, code: pid, buy: 0 };
    const all = state.vendors.map(v => ({ v, price: priceFor(v.id, p) })).sort((a, b) => a.price - b.price);
    const cheapest = all[0] || null;
    const fromPO = poLineVendor(pid);
    const chosenVid = fromPO ? fromPO.vid : (picks[pid] || (cheapest && cheapest.v.id));
    const chosenRate = fromPO ? fromPO.rate : priceFor(chosenVid, p);
    const cheapestRate = cheapest ? cheapest.price : chosenRate;
    return { pid, p, qty, all, chosenVid, chosenRate, cheapestVid: cheapest && cheapest.v.id, cheapestRate, lineSpend: chosenRate * qty, lineBest: cheapestRate * qty, saving: (chosenRate - cheapestRate) * qty };
  });
  const spend = rows.reduce((s, r) => s + r.lineSpend, 0);
  const best = rows.reduce((s, r) => s + r.lineBest, 0);
  const indicative = (so.lines || []).reduce((s, l) => s + (l.bundle_qty || 0) * (l.unit_price || 0), 0);
  const revenue = (sourcing && sourcing.our_price) ? Number(sourcing.our_price) : indicative;
  return { so, sourcing, pos, rows, spend, best, potentialSaving: spend - best, revenue, poTotal: pos.reduce((s, p) => s + (p.amount || 0), 0), marginPct: revenue ? ((revenue - spend) / revenue) * 100 : 0 };
}
window.projectComparison = projectComparison;

// ===== RFQ / Vendor Comparison page (auto engine) =====
function RFQList() {
  const { state, navigate, getProduct, getVendor, getCustomer } = useStore();

  // Auto-fetch every project that has sourcing and/or vendor POs.
  const ids = new Set();
  (state.sourcings || []).forEach(s => { if (s.converted_so_id) ids.add(s.converted_so_id); });
  state.vendor_pos.forEach(p => { if (p.so_id) ids.add(p.so_id); });
  const comps = [...ids].map(id => projectComparison(state, id, getProduct)).filter(Boolean);
  const totSpend = comps.reduce((s, c) => s + c.spend, 0);
  const totSaving = comps.reduce((s, c) => s + c.potentialSaving, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">RFQ / Vendor Comparison</h1>
          <div className="page-sub">Automatic cross-vendor comparison across all projects · chosen vs cheapest, mapped per item · live from real PO + sourcing data</div>
        </div>
      </div>

      <div className="mb-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Projects compared</div><div style={{ fontSize: 20, fontWeight: 700 }}>{comps.length}</div></div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Total vendor spend</div><div style={{ fontSize: 20, fontWeight: 700 }} className="mono">{inr(totSpend)}</div></div></div>
        <div className="card" style={{ borderColor: totSaving > 0 ? 'oklch(0.85 0.09 75)' : undefined }}><div className="card-body" style={{ textAlign: 'center', background: totSaving > 0 ? 'var(--warning-bg)' : undefined }}><div className="tiny muted">Potential extra savings</div><div style={{ fontSize: 20, fontWeight: 700, color: totSaving > 0 ? 'var(--warning)' : 'var(--success)' }} className="mono">{inr(totSaving)}</div></div></div>
      </div>

      {comps.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="empty-title">Nothing to compare yet</div>
          Once inquiries are converted to SOs and vendors are chosen, every project's vendor comparison appears here automatically.
        </div></div>
      ) : comps.map(c => {
        const cust = getCustomer(c.so.customer_id);
        return (
          <div className="card mb-2" key={c.so.id}>
            <div className="card-header">
              <div>
                <h3 className="card-title"><span className="mono" onClick={() => navigate(`sales-orders/${c.so.id}`)} style={{ cursor: 'pointer' }}>{c.so.so_no}</span> — {cust ? cust.name : ''}</h3>
                <div className="tiny muted">revenue {inr(c.revenue)} · vendor spend {inr(c.spend)} · margin <strong style={{ color: c.marginPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>{c.marginPct >= 0 ? '+' : ''}{c.marginPct.toFixed(1)}%</strong>{c.potentialSaving > 0 ? <> · <span style={{ color: 'var(--warning)' }}>save {inr(c.potentialSaving)} more if all-cheapest</span></> : ' · already optimal'}</div>
              </div>
              <span className="badge dot">{c.pos.length} PO(s)</span>
            </div>
            <div className="card-body flush">
              <table className="t">
                <thead><tr><th>Item</th><th className="num">Qty</th><th>Chosen vendor</th><th className="num">Rate</th><th>Cheapest</th><th className="num">Best rate</th><th className="num">Δ / line</th></tr></thead>
                <tbody>
                  {c.rows.map(r => {
                    const cv = getVendor(r.chosenVid); const bv = getVendor(r.cheapestVid);
                    const optimal = r.chosenVid === r.cheapestVid || r.saving <= 0;
                    return (
                      <tr key={r.pid}>
                        <td>{r.p.name}<div className="tiny muted mono">{r.p.code}</div></td>
                        <td className="num">{r.qty}</td>
                        <td>{cv ? cv.name : '—'}</td>
                        <td className="num mono">{inr(r.chosenRate)}</td>
                        <td>{optimal ? <span className="muted">— same</span> : (bv ? bv.name : '—')}</td>
                        <td className="num mono">{inr(r.cheapestRate)}</td>
                        <td className="num">{optimal ? <span style={{ color: 'var(--success)' }}>best</span> : <span style={{ color: 'var(--warning)', fontWeight: 600 }}>+{inr(r.saving)}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><td colSpan="3" className="right small">Totals</td><td className="num mono">{inr(c.spend)}</td><td></td><td className="num mono">{inr(c.best)}</td><td className="num">{c.potentialSaving > 0 ? <strong style={{ color: 'var(--warning)' }}>+{inr(c.potentialSaving)}</strong> : <span style={{ color: 'var(--success)' }}>optimal</span>}</td></tr></tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Our (sell) value of a PO's items — for per-vendor margin.
function poOurValue(po, getProduct) {
  return (po.items || []).reduce((s, it) => { const p = getProduct(it.product_id); return s + (p ? (p.sell || 0) : 0) * (it.qty || 0); }, 0);
}

// Resolve an MD review of a PO. If a vendor-change is pending, approve swaps the
// vendor/items/amount in automatically; reject discards it (old vendor kept). For
// a plain over-threshold PO: approve → Issued, reject → Rejected.
function applyPOReview(po, approve) {
  if (po.pending_change) {
    if (approve) { const c = po.pending_change; return { ...po, vendor_id: c.vendor_id, items: c.items, amount: c.amount, status: 'Issued', pending_change: null }; }
    return { ...po, status: 'Issued', pending_change: null };
  }
  return { ...po, status: approve ? 'Issued' : 'Rejected' };
}
window.applyPOReview = applyPOReview;

// Purchase proposes switching a PO to a CHEAPER vendor → goes to MD for approval.
function ChangeVendorModal({ po, onClose }) {
  const { state, mutate, getVendor, getProduct, currentUser } = useStore();
  const toast = useToast();
  const sourcing = window.soSourcing ? window.soSourcing(state, po.so_id) : null;
  const candIds = ((sourcing && (sourcing.quote_vendors || []).length) ? sourcing.quote_vendors : state.vendors.map(v => v.id)).filter(vid => vid !== po.vendor_id);
  const rateOf = (vid, p) => (sourcing && sourcing.prices && sourcing.prices[p.id] && sourcing.prices[p.id][vid] != null) ? Number(sourcing.prices[p.id][vid]) : (window.vendorUnitPrice ? window.vendorUnitPrice(vid, p) : (p ? (p.buy || 0) : 0));
  const [vid, setVid] = React.useState(candIds[0] || '');
  const [rates, setRates] = React.useState({});
  React.useEffect(() => { const r = {}; (po.items || []).forEach(it => { const p = getProduct(it.product_id); r[it.product_id] = vid ? rateOf(vid, p) : it.rate; }); setRates(r); }, [vid]);
  const newAmount = (po.items || []).reduce((s, it) => s + (it.qty || 0) * (Number(rates[it.product_id]) || 0), 0);
  const cheaper = newAmount > 0 && newAmount < po.amount;

  const submit = () => {
    if (!vid) { toast('Pick a new vendor'); return; }
    if (!cheaper) { toast('The new vendor total must be LESS than the current PO'); return; }
    const items = (po.items || []).map(it => ({ product_id: it.product_id, qty: it.qty, rate: Number(rates[it.product_id]) || 0 }));
    const change = { vendor_id: vid, items, amount: Math.round(newAmount), old_vendor_id: po.vendor_id, old_amount: po.amount, requested_by: currentUser || null, date: TODAY };
    mutate(s => ({ ...s, vendor_pos: s.vendor_pos.map(p => p.id === po.id ? { ...p, pending_change: change, status: 'Pending MD Approval' } : p), notifications: [{ id: 'n-vchg-' + Date.now(), kind: 'po', text: `${po.po_no}: vendor change → ${getVendor(vid)?.name} (${inrK(newAmount)} < ${inrK(po.amount)}) — awaiting MD approval`, date: TODAY, read: false, role: 'Managing Director' }, ...s.notifications] }), { action: 'vendor-change', entity: 'VendorPO', entity_id: po.id });
    toast('Vendor change sent to MD for approval', 'success');
    onClose();
  };

  return (
    <Modal title={`Change vendor — ${po.po_no}`} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!cheaper} onClick={submit}>Send to MD · {inr(newAmount)}</button></>}>
      {candIds.length === 0 ? (
        <div className="empty">No alternative vendors available for this order.</div>
      ) : (
        <>
          <div className="field-row mb-2">
            <div className="field"><label className="field-label">Current vendor</label><div className="input mono" style={{ background: 'var(--bg-subtle)' }}>{getVendor(po.vendor_id)?.name} · {inr(po.amount)}</div></div>
            <div className="field"><label className="field-label">New vendor *</label><select className="select" value={vid} onChange={e => setVid(e.target.value)}>{candIds.map(id => { const v = getVendor(id); return <option key={id} value={id}>{v ? v.name : id}</option>; })}</select></div>
          </div>
          <table className="t">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Old rate</th><th className="num">New rate ₹</th><th className="num">Line</th></tr></thead>
            <tbody>
              {(po.items || []).map(it => { const p = getProduct(it.product_id) || { name: it.product_id }; return (
                <tr key={it.product_id}>
                  <td>{p.name}</td><td className="num">{it.qty}</td><td className="num small muted">{inr(it.rate)}</td>
                  <td className="num"><input type="number" min="0" className="input mono" value={rates[it.product_id] != null ? rates[it.product_id] : ''} onChange={e => setRates(r => ({ ...r, [it.product_id]: e.target.value }))} style={{ width: 90, textAlign: 'right', height: 26 }}/></td>
                  <td className="num mono">{inr((it.qty || 0) * (Number(rates[it.product_id]) || 0))}</td>
                </tr>
              ); })}
            </tbody>
            <tfoot><tr><td colSpan="4" className="right small">New total</td><td className="num mono" style={{ color: cheaper ? 'var(--success)' : 'var(--danger)' }}><strong>{inr(newAmount)}</strong></td></tr></tfoot>
          </table>
          <div className="mt-2" style={{ padding: 10, borderRadius: 4, background: cheaper ? 'var(--success-bg)' : 'var(--danger-bg)', fontSize: 12.5 }}>
            {cheaper ? `Saves ${inr(po.amount - newAmount)} vs the current vendor — allowed.` : `Must be lower than the current PO (${inr(po.amount)}). A more expensive switch isn't allowed.`}
          </div>
        </>
      )}
    </Modal>
  );
}
window.ChangeVendorModal = ChangeVendorModal;

// ===== Per-SO Vendor POs tab — every vendor mapped to ONE SO, with margins,
// item tracking (ordered → received → remaining) and payable status, in one
// place. Read-only consolidation; actions reuse the existing GRN / 3-way flow. =====
function SOVendorPOsTab({ so }) {
  const { state, navigate, mutate, getVendor, getProduct, soSubtotal, currentUser, getUser } = useStore();
  const toast = useToast();
  const [vF, setVF] = React.useState('');
  const [sF, setSF] = React.useState('');
  const [q, setQ] = React.useState('');
  const [showSplit, setShowSplit] = React.useState(false);
  const [receivePo, setReceivePo] = React.useState(null);
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canProcure = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const canApprove = ['Managing Director', 'Org Admin'].includes(role);
  const sourcing = window.soSourcing ? window.soSourcing(state, so.id) : null;
  const setPoStatus = (po, status, msg) => {
    mutate(s => ({ ...s, vendor_pos: s.vendor_pos.map(p => p.id === po.id ? { ...p, status } : p), notifications: [{ id: 'n-poapp-' + Date.now(), kind: 'po', text: `${po.po_no} ${status === 'Issued' ? 'resumed' : status === 'Rejected' ? 'rejected by MD' : 'put on hold by MD'}`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications] }), { action: 'po-status', entity: 'VendorPO', entity_id: po.id });
    toast(msg, status === 'Rejected' ? '' : 'success');
  };
  const reviewPo = (po, approve) => {
    const changed = !!po.pending_change;
    mutate(s => ({ ...s, vendor_pos: s.vendor_pos.map(p => p.id === po.id ? applyPOReview(p, approve) : p), notifications: [{ id: 'n-porev-' + Date.now(), kind: 'po', text: `${po.po_no} ${approve ? (changed ? 'vendor change approved → ' + (getVendor(po.pending_change.vendor_id)?.name || '') : 'approved') : (changed ? 'vendor change declined' : 'rejected')} by MD`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications] }), { action: 'po-review', entity: 'VendorPO', entity_id: po.id });
    toast(approve ? `${po.po_no} approved` : `${po.po_no} ${changed ? 'change declined' : 'rejected'}`, approve ? 'success' : '');
  };

  const pos = state.vendor_pos.filter(p => p.so_id === so.id);
  const grnsFor = (poId) => state.grns.filter(g => g.po_id === poId);
  const viFor = (poId) => (state.vendor_invoices || []).filter(v => v.po_id === poId);
  const PoolPanel = window.VGAddFromPoolPanel;   // smart pool-suggestion panel (reused)

  // ===== Inline Vendor-PO editing (Purchase, after procurement starts) =====
  // Editable only while a PO hasn't been received and isn't awaiting MD — so no
  // GRN/e-Bill/3-way history is ever disturbed. Amount + MD gate recompute live.
  const [expanded, setExpanded] = React.useState({});
  const [addSel, setAddSel] = React.useState({});   // po.id -> product_id to add
  const mdThreshold = state.config.vendor_po_md_threshold != null ? state.config.vendor_po_md_threshold : 500000;
  const editablePO = (po) => canProcure && ['Issued', 'In Transit'].includes(po.status) && grnsFor(po.id).length === 0;
  const recalc = (items) => items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const savePOItems = (po, items, vendorId) => {
    const amount = Math.round(recalc(items));
    const needsMD = amount > mdThreshold;
    mutate(s => ({
      ...s,
      vendor_pos: s.vendor_pos.map(p => p.id === po.id ? { ...p, items, amount, status: needsMD ? 'Pending MD Approval' : po.status, ...(vendorId ? { vendor_id: vendorId } : {}) } : p),
      notifications: [{ id: 'n-poedit-' + Date.now(), kind: 'po', text: `${po.po_no} edited by Purchase · ${inrK(amount)}${needsMD ? ' · needs MD approval' : ''}`, date: TODAY, read: false, role: needsMD ? 'Managing Director' : 'Stores' }, ...s.notifications],
    }), { action: 'po-edit', entity: 'VendorPO', entity_id: po.id });
  };
  const setItemQty = (po, pid, qty) => savePOItems(po, (po.items || []).map(it => it.product_id === pid ? { ...it, qty: Math.max(0, Number(qty) || 0) } : it));
  const setItemRate = (po, pid, rate) => savePOItems(po, (po.items || []).map(it => it.product_id === pid ? { ...it, rate: Math.max(0, Number(rate) || 0) } : it));
  const removeItem = (po, pid) => savePOItems(po, (po.items || []).filter(it => it.product_id !== pid));
  const addItemToPO = (po) => { const pid = addSel[po.id]; if (!pid || (po.items || []).some(it => it.product_id === pid)) return; const p = getProduct(pid); const rate = window.vendorUnitPrice ? window.vendorUnitPrice(po.vendor_id, p) : (p ? p.buy || 0 : 0); savePOItems(po, [...(po.items || []), { product_id: pid, qty: 1, rate }]); setAddSel(m => ({ ...m, [po.id]: '' })); };
  const changePOVendor = (po, vid) => { if (!vid || vid === po.vendor_id) return; const items = (po.items || []).map(it => { const p = getProduct(it.product_id); const rate = window.vendorUnitPrice ? window.vendorUnitPrice(vid, p) : it.rate; return { ...it, rate }; }); savePOItems(po, items, vid); };

  // Aggregate received / on-PO / required per product across this SO.
  const receivedByProd = {}, onPOByProd = {};
  pos.forEach(po => {
    (po.items || []).forEach(it => { onPOByProd[it.product_id] = (onPOByProd[it.product_id] || 0) + (it.qty || 0); });
    grnsFor(po.id).forEach(g => (g.items || []).forEach(it => { receivedByProd[it.product_id] = (receivedByProd[it.product_id] || 0) + (it.accepted || 0); }));
  });
  const required = soReqComponents(so);

  // Grand totals — project profit margin = our sell value − vendor spend.
  const vendorSpend = pos.reduce((s, p) => s + (p.amount || 0), 0);
  const projectSell = soSubtotal(so);
  const projectMargin = projectSell - vendorSpend;
  const marginPct = projectSell > 0 ? (projectMargin / projectSell) * 100 : 0;
  const payableBooked = pos.reduce((s, p) => s + viFor(p.id).filter(v => v.status === 'Booked').reduce((a, v) => a + (v.amount || 0), 0), 0);

  const prodIds = Array.from(new Set([...Object.keys(required), ...Object.keys(onPOByProd), ...Object.keys(receivedByProd)]));
  const track = prodIds.map(pid => {
    const p = getProduct(pid);
    const req = required[pid] || 0, onPO = onPOByProd[pid] || 0, recv = receivedByProd[pid] || 0;
    return { pid, p, req, onPO, recv, remaining: Math.max(0, onPO - recv), shortfall: Math.max(0, req - onPO) };
  }).filter(r => !q || (r.p && (r.p.name.toLowerCase().includes(q.toLowerCase()) || (r.p.code || '').toLowerCase().includes(q.toLowerCase()))));
  const shortfalls = track.filter(r => r.shortfall > 0).length;
  const awaiting = track.filter(r => r.remaining > 0).length;

  const statuses = [...new Set(pos.map(p => p.status))];
  const vRows = pos.filter(po => (!vF || po.vendor_id === vF) && (!sF || po.status === sF));

  const poStatusBadge = (st) => st === 'Material Received' ? <span className="badge success dot">Received</span>
    : st === 'Pending MD Approval' ? <span className="badge warning dot">MD approval</span>
    : st === 'Rejected' ? <span className="badge danger dot">Rejected</span>
    : st === 'On Hold' ? <span className="badge warning dot">On hold</span>
    : <span className="badge dot">{st}</span>;

  // Before POs exist: show the PLANNED vendors from the inquiry allocation so the
  // SO already lists its vendors, with one-click generate.
  if (pos.length === 0) {
    const planned = sourcing && window.vendorPOGroups ? window.vendorPOGroups(state, so, sourcing, getProduct) : [];
    if (planned.length === 0) return (
      <div className="card"><div className="empty">
        <div className="empty-title">No vendors yet</div>
        Vendors come from the inquiry. Add them in Sourcing (Add vendor &amp; quote → Allocate across vendors); they'll appear here and POs auto-generate when you click Start Procurement.
      </div></div>
    );
    return (
      <div className="stack">
        <div className="card"><div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="grow"><strong className="small">Planned vendors from inquiry {sourcing.src_no}</strong><div className="tiny muted">{planned.length} vendor(s) · POs auto-generate on “Start Procurement”, or generate now.</div></div>
          {canProcure && <button className="btn btn-primary" onClick={() => window.generateVendorPOsFromSourcing(so, sourcing, { state, mutate, toast, navigate, getProduct })}><Icon name="cart" size={13}/>Generate {planned.length} Vendor PO(s)</button>}
        </div></div>
        <div className="card"><div className="card-body flush"><table className="t">
          <thead><tr><th>Vendor (planned)</th><th className="num">Items</th><th className="num">Planned cost</th></tr></thead>
          <tbody>{planned.map(g => { const v = getVendor(g.vendor_id); return <tr key={g.vendor_id}><td>{v ? v.name : g.vendor_id}</td><td className="num">{g.items.length}</td><td className="num mono">{inr(g.amount)}</td></tr>; })}</tbody>
          <tfoot><tr><td className="right small">Planned total</td><td></td><td className="num mono"><strong>{inr(planned.reduce((s, g) => s + g.amount, 0))}</strong></td></tr></tfoot>
        </table></div></div>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* Grand totals */}
      <div className="mb-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Vendors</div><div style={{ fontSize: 18, fontWeight: 700 }}>{pos.length}</div></div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Our value</div><div style={{ fontSize: 16, fontWeight: 700 }} className="mono">{inrK(projectSell)}</div></div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Vendor spend</div><div style={{ fontSize: 16, fontWeight: 700 }} className="mono">{inrK(vendorSpend)}</div></div></div>
        <div className="card" style={{ borderColor: projectMargin >= 0 ? 'oklch(0.85 0.06 155)' : 'oklch(0.86 0.08 25)' }}><div className="card-body" style={{ textAlign: 'center', background: projectMargin >= 0 ? 'var(--success-bg)' : 'var(--danger-bg)' }}><div className="tiny muted">Profit margin</div><div style={{ fontSize: 16, fontWeight: 700, color: projectMargin >= 0 ? 'var(--success)' : 'var(--danger)' }} className="mono">{inrK(projectMargin)}</div><div className="tiny" style={{ fontWeight: 600, color: projectMargin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{marginPct >= 0 ? '+' : ''}{marginPct.toFixed(1)}%</div></div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Payable booked</div><div style={{ fontSize: 16, fontWeight: 700 }} className="mono">{inrK(payableBooked)}</div></div></div>
      </div>

      {/* Engine summary */}
      <div className="card"><div className="card-body small" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong className="small">Tracking engine:</strong>
        <span>{shortfalls === 0 ? <span style={{ color: 'var(--success)' }}>✓ all required items are on a PO</span> : <span style={{ color: 'var(--warning)' }}>⚠ {shortfalls} item(s) still need a vendor PO</span>}</span>
        <span>·</span>
        <span>{awaiting === 0 ? <span style={{ color: 'var(--success)' }}>✓ nothing awaiting receipt</span> : <span style={{ color: 'var(--accent)' }}>{awaiting} item(s) awaiting receipt (GRN)</span>}</span>
      </div></div>

      {/* Smart pool suggestions — add stock from the Master Pool & cut vendor need */}
      {PoolPanel && canProcure && <PoolPanel so={so}/>}

      {/* Vendor mapping */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Vendors on this order ({vRows.length})</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="select" style={{ height: 26, fontSize: 12 }} value={vF} onChange={e => setVF(e.target.value)}>
              <option value="">All vendors</option>
              {[...new Set(pos.map(p => p.vendor_id))].map(vid => { const v = getVendor(vid); return <option key={vid} value={vid}>{v ? v.name : vid}</option>; })}
            </select>
            <select className="select" style={{ height: 26, fontSize: 12 }} value={sF} onChange={e => setSF(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Vendor · PO</th><th className="num">Cost</th><th className="num">Our value</th><th className="num">Margin</th><th className="num">Received</th><th>e-Bill</th><th>Payable</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {vRows.map(po => {
                const v = getVendor(po.vendor_id);
                const our = poOurValue(po, getProduct);
                const m = our - (po.amount || 0); const mp = our > 0 ? (m / our) * 100 : 0;
                const ordered = (po.items || []).reduce((a, it) => a + (it.qty || 0), 0);
                const rec = grnsFor(po.id).reduce((a, g) => a + (g.items || []).reduce((b, it) => b + (it.accepted || 0), 0), 0);
                const recPct = ordered > 0 ? Math.round(rec / ordered * 100) : 0;
                const vis = viFor(po.id); const booked = vis.filter(x => x.status === 'Booked').length;
                const open = !!expanded[po.id]; const canEdit = editablePO(po);
                return (
                  <Fragment key={po.id}>
                  <tr onClick={() => setExpanded(e => ({ ...e, [po.id]: !open }))} style={{ cursor: 'pointer' }}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12}/><div><strong>{v ? v.name : po.vendor_id}</strong><div className="tiny muted mono">{po.po_no} · {(po.items || []).length} item(s)</div></div></div></td>
                    <td className="num mono">{inr(po.amount)}</td>
                    <td className="num mono">{inr(our)}</td>
                    <td className="num mono" style={{ color: m >= 0 ? 'var(--success)' : 'var(--danger)' }}>{inr(m)}<div className="tiny">{mp >= 0 ? '+' : ''}{mp.toFixed(1)}%</div></td>
                    <td className="num">{recPct}%</td>
                    <td>{po.ebill && po.ebill.generated ? <span className="badge success dot">e-Bill</span> : <span className="badge dot">—</span>}</td>
                    <td>{vis.length === 0 ? <span className="muted tiny">awaiting</span> : booked ? <span className="badge success dot">{booked} booked</span> : <span className="badge warning dot">{vis.length} pending</span>}</td>
                    <td>{poStatusBadge(po.status)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      {po.status === 'Pending MD Approval'
                        ? (canApprove
                            ? <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {po.pending_change && <div className="tiny" style={{ width: '100%', textAlign: 'right', color: 'var(--accent)' }}>→ {getVendor(po.pending_change.vendor_id)?.name} ({inrK(po.pending_change.amount)})</div>}
                                <button className="btn btn-sm btn-primary" onClick={() => reviewPo(po, true)}>Approve</button>
                                {!po.pending_change && <button className="btn btn-sm" onClick={() => setPoStatus(po, 'On Hold', `${po.po_no} on hold`)}>Hold</button>}
                                <button className="btn btn-sm btn-danger" onClick={() => reviewPo(po, false)}>Reject</button>
                              </div>
                            : <span className="badge warning dot">awaiting MD{po.pending_change ? ' · vendor change' : ''}</span>)
                        : po.status === 'On Hold'
                          ? (canApprove ? <button className="btn btn-sm btn-primary" onClick={() => setPoStatus(po, 'Issued', `${po.po_no} resumed`)}>Resume</button> : <span className="muted tiny">on hold</span>)
                          : po.status === 'Rejected'
                            ? <span className="muted tiny">rejected</span>
                            : canProcure && rec < ordered
                              ? <button className="btn btn-sm btn-primary" onClick={() => setReceivePo(po)}><Icon name="package" size={11}/>Receive</button>
                              : rec >= ordered && ordered > 0 ? <span className="badge success dot">Received</span> : null}
                    </td>
                  </tr>
                  {open && (
                    <tr className="subrow"><td colSpan="9" style={{ background: 'var(--surface-2)', padding: 0 }}>
                      <div style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <strong className="small">Line items on {po.po_no} → {v ? v.name : po.vendor_id}</strong>
                          {canEdit ? <span className="badge accent tiny">editable</span> : <span className="badge tiny" title="Locked once received / awaiting MD">read-only</span>}
                          <div className="grow"/>
                          {canEdit && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="tiny muted">Replace vendor:</span>
                              <select className="select" style={{ height: 24, fontSize: 12 }} value={po.vendor_id} onChange={e => changePOVendor(po, e.target.value)}>
                                {state.vendors.map(vd => <option key={vd.id} value={vd.id}>{vd.name}</option>)}
                              </select>
                            </span>
                          )}
                          <button className="btn btn-sm btn-ghost" onClick={() => navigate(`vendor-pos/${po.id}`)}><Icon name="arrowRight" size={11}/>Open PO</button>
                        </div>
                        <table className="t" style={{ background: 'var(--surface)' }}>
                          <thead><tr><th>Line item</th><th>Code</th><th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Line ₹</th><th className="num">Received</th>{canEdit && <th style={{ width: 28 }}></th>}</tr></thead>
                          <tbody>
                            {(po.items || []).map(it => {
                              const p = getProduct(it.product_id) || { name: it.product_id, code: it.product_id };
                              const itRec = grnsFor(po.id).reduce((a, g) => a + (g.items || []).filter(y => y.product_id === it.product_id).reduce((b, y) => b + (y.accepted || 0), 0), 0);
                              return (
                                <tr key={it.product_id}>
                                  <td><strong>{p.name}</strong></td>
                                  <td className="mono small muted">{p.code}</td>
                                  <td className="num">{canEdit ? <input type="number" min="0" className="input mono" value={it.qty} onChange={e => setItemQty(po, it.product_id, e.target.value)} style={{ width: 64, height: 24, textAlign: 'right' }}/> : it.qty}</td>
                                  <td className="num">{canEdit ? <input type="number" min="0" className="input mono" value={it.rate} onChange={e => setItemRate(po, it.product_id, e.target.value)} style={{ width: 84, height: 24, textAlign: 'right' }}/> : inr(it.rate)}</td>
                                  <td className="num mono">{inr((Number(it.qty) || 0) * (Number(it.rate) || 0))}</td>
                                  <td className="num">{itRec || <span className="muted">0</span>}</td>
                                  {canEdit && <td><button className="btn btn-ghost btn-sm" title="Remove item from this PO" onClick={() => removeItem(po, it.product_id)}><Icon name="x" size={11} color="var(--danger)"/></button></td>}
                                </tr>
                              );
                            })}
                            {(po.items || []).length === 0 && <tr><td colSpan={canEdit ? 7 : 6}><div className="empty">No items.</div></td></tr>}
                          </tbody>
                        </table>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                            <select className="select" style={{ height: 26, fontSize: 12, width: 240 }} value={addSel[po.id] || ''} onChange={e => setAddSel(m => ({ ...m, [po.id]: e.target.value }))}>
                              <option value="">+ Add line item to this vendor…</option>
                              {state.products.filter(p => !(po.items || []).some(it => it.product_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <button className="btn btn-sm" disabled={!addSel[po.id]} onClick={() => addItemToPO(po)}><Icon name="plus" size={11}/>Add</button>
                            <span className="tiny muted">Edits recompute the PO amount & re-check the MD approval threshold. Received POs are locked.</span>
                          </div>
                        )}
                      </div>
                    </td></tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot><tr><td className="right small">Totals</td><td className="num mono"><strong>{inr(vendorSpend)}</strong></td><td className="num mono">{inr(pos.reduce((a, p) => a + poOurValue(p, getProduct), 0))}</td><td className="num mono" style={{ color: projectMargin >= 0 ? 'var(--success)' : 'var(--danger)' }}><strong>{inr(pos.reduce((a, p) => a + poOurValue(p, getProduct), 0) - vendorSpend)}</strong></td><td colSpan="5"></td></tr></tfoot>
          </table>
        </div>
        {canProcure && <div className="card-body" style={{ borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}><button className="btn btn-sm btn-primary" onClick={() => setShowSplit(true)}><Icon name="arrowLeftRight" size={12}/>Split across vendors</button><button className="btn btn-sm" onClick={() => navigate('grn/new')}><Icon name="package" size={12}/>Receive material (GRN)</button><button className="btn btn-sm" onClick={() => navigate('three-way')}><Icon name="check" size={12}/>Vendor invoices / 3-way</button></div>}
      </div>

      {/* Item tracking */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Item tracking</h3>
          <input className="input search" placeholder="Search item…" value={q} onChange={e => setQ(e.target.value)} style={{ height: 26, width: 200 }}/>
        </div>
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Item</th><th className="num">Required</th><th className="num">On PO</th><th className="num">Received</th><th className="num">Remaining</th><th>Status</th></tr></thead>
            <tbody>
              {track.map(r => (
                <tr key={r.pid}>
                  <td>{r.p ? r.p.name : r.pid}<div className="tiny muted mono">{r.p ? r.p.code : ''}</div></td>
                  <td className="num">{r.req}</td>
                  <td className="num">{r.onPO}{r.shortfall > 0 && <div className="tiny" style={{ color: 'var(--warning)' }}>short {r.shortfall}</div>}</td>
                  <td className="num">{r.recv}</td>
                  <td className="num">{r.remaining > 0 ? <strong style={{ color: 'var(--accent)' }}>{r.remaining}</strong> : <span className="muted">0</span>}</td>
                  <td>{r.shortfall > 0 ? <span className="badge warning dot">Add PO</span> : r.remaining > 0 ? <span className="badge accent dot">Awaiting</span> : <span className="badge success dot">Complete</span>}</td>
                </tr>
              ))}
              {track.length === 0 && <tr><td colSpan="6"><div className="empty">No items match.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showSplit && <SplitAllocatorModal so={so} onClose={() => setShowSplit(false)}/>}
      {receivePo && <ReceiveModal po={receivePo} onClose={() => setReceivePo(null)}/>}
    </div>
  );
}

window.SOVendorPOsTab = SOVendorPOsTab;

// Create one Vendor PO per vendor from a split allocation { product_id: [{vendor_id, qty, rate}] }.
function generateSplitVendorPOs(so, alloc, ctx) {
  const { state, mutate, toast, navigate } = ctx;
  const groups = {};
  Object.entries(alloc || {}).forEach(([pid, rows]) => (rows || []).forEach(r => {
    const qty = Number(r.qty) || 0; if (qty <= 0 || !r.vendor_id) return;
    (groups[r.vendor_id] = groups[r.vendor_id] || []).push({ product_id: pid, qty, rate: Number(r.rate) || 0 });
  }));
  const entries = Object.entries(groups);
  if (!entries.length) { toast('Allocate at least one item to a vendor'); return; }
  const base = 40 + state.vendor_pos.length;
  const expected = (() => { const d = new Date(TODAY); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const pos = entries.map(([vid, items], i) => {
    const amount = items.reduce((s, it) => s + it.qty * it.rate, 0);
    return { id: 'po-' + Date.now() + '-' + i, po_no: `VPO/FY26/${String(base + i).padStart(4, '0')}`, so_id: so.id, vendor_id: vid, date: TODAY, expected, status: amount > (state.config.vendor_po_md_threshold ?? 500000) ? 'Pending MD Approval' : 'Issued', amount, items, ebill: {}, source: 'sourcing-split' };
  });
  const anyMD = pos.some(p => p.status === 'Pending MD Approval');
  mutate(s => ({
    ...s,
    vendor_pos: [...pos, ...s.vendor_pos],
    sales_orders: s.sales_orders.map(x => x.id === so.id && x.status === 'Approved' ? { ...x, status: 'Procurement Started' } : x),
    notifications: [{ id: 'n-split-' + Date.now(), kind: 'po', text: `${pos.length} split Vendor PO(s) raised for ${so.so_no}${anyMD ? ' · some need MD approval' : ''}`, date: TODAY, read: false, role: anyMD ? 'Managing Director' : 'Stores' }, ...s.notifications],
  }), { action: 'split-po', entity: 'SalesOrder', entity_id: so.id });
  toast(`${pos.length} Vendor PO(s) created — quantity split across vendors`, 'success');
  navigate(`sales-orders/${so.id}`);
}

// Split each still-to-order item's quantity across multiple vendors → split POs.
function SplitAllocatorModal({ so, onClose }) {
  const { state, mutate, navigate, getVendor, getProduct } = useStore();
  const toast = useToast();
  const sourcing = window.soSourcing ? window.soSourcing(state, so.id) : null;
  const candIds = (sourcing && (sourcing.quote_vendors || []).length) ? sourcing.quote_vendors : state.vendors.map(v => v.id);
  const required = soReqComponents(so);
  const onPO = {};
  state.vendor_pos.filter(p => p.so_id === so.id).forEach(po => (po.items || []).forEach(it => { onPO[it.product_id] = (onPO[it.product_id] || 0) + (it.qty || 0); }));
  const items = Object.keys(required).map(pid => ({ pid, p: getProduct(pid), required: required[pid], onPO: onPO[pid] || 0, toOrder: Math.max(0, required[pid] - (onPO[pid] || 0)) })).filter(x => x.toOrder > 0);
  const rateOf = (vid, p) => (sourcing && sourcing.prices && sourcing.prices[p.id] && sourcing.prices[p.id][vid] != null) ? sourcing.prices[p.id][vid] : (window.vendorUnitPrice ? window.vendorUnitPrice(vid, p) : (p ? (p.buy || 0) : 0));
  const [alloc, setAlloc] = React.useState(() => {
    const a = {};
    items.forEach(x => { const def = (sourcing && sourcing.picks && sourcing.picks[x.pid]) || candIds[0]; a[x.pid] = [{ vendor_id: def, qty: x.toOrder, rate: rateOf(def, x.p) }]; });
    return a;
  });
  const setRow = (pid, ri, patch) => setAlloc(a => ({ ...a, [pid]: a[pid].map((r, i) => i === ri ? { ...r, ...patch } : r) }));
  const addRow = (pid) => setAlloc(a => ({ ...a, [pid]: [...(a[pid] || []), { vendor_id: candIds[0], qty: 0, rate: rateOf(candIds[0], items.find(x => x.pid === pid).p) }] }));
  const removeRow = (pid, ri) => setAlloc(a => ({ ...a, [pid]: a[pid].filter((_, i) => i !== ri) }));

  const vendorSet = new Set();
  let totalAmt = 0;
  Object.values(alloc).forEach(rows => rows.forEach(r => { const q = Number(r.qty) || 0; if (q > 0 && r.vendor_id) { vendorSet.add(r.vendor_id); totalAmt += q * (Number(r.rate) || 0); } }));

  return (
    <Modal title={`Split across vendors — ${so.so_no}`} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={vendorSet.size === 0} onClick={() => { generateSplitVendorPOs(so, alloc, { state, mutate, toast, navigate, getVendor }); onClose(); }}>Generate {vendorSet.size} PO(s) · {inr(totalAmt)}</button>
      </>
    }>
      {items.length === 0 ? (
        <div className="empty"><div className="empty-title">Nothing left to order</div>Every required item is already on a Vendor PO.</div>
      ) : (
        <>
          <div className="tiny muted mb-2" style={{ padding: 10, background: 'var(--accent-bg)', borderRadius: 4 }}>
            For each item, give each vendor a quantity (and rate). The split is auto-grouped into one Vendor PO per vendor. Rate prefills from the inquiry quote / estimate.
          </div>
          {items.map(x => {
            const rows = alloc[x.pid] || [];
            const allocated = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
            const remain = x.toOrder - allocated;
            return (
              <div className="card mb-2" key={x.pid}>
                <div className="card-header">
                  <div><strong>{x.p ? x.p.name : x.pid}</strong><div className="tiny muted mono">{x.p ? x.p.code : ''} · required {x.required} · on PO {x.onPO} · to allocate {x.toOrder}</div></div>
                  <span className={`badge ${remain === 0 ? 'success' : remain < 0 ? 'danger' : 'warning'} dot`}>{remain === 0 ? 'balanced' : remain < 0 ? `over ${-remain}` : `${remain} left`}</span>
                </div>
                <div className="card-body flush">
                  <table className="t">
                    <thead><tr><th>Vendor</th><th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Line</th><th style={{ width: 28 }}></th></tr></thead>
                    <tbody>
                      {rows.map((r, ri) => (
                        <tr key={ri}>
                          <td><select className="select" value={r.vendor_id} onChange={e => setRow(x.pid, ri, { vendor_id: e.target.value, rate: rateOf(e.target.value, x.p) })} style={{ height: 26, fontSize: 12 }}>{candIds.map(vid => { const v = getVendor(vid); return <option key={vid} value={vid}>{v ? v.name : vid}</option>; })}</select></td>
                          <td className="num"><input type="number" min="0" className="input mono" value={r.qty} onChange={e => setRow(x.pid, ri, { qty: e.target.value })} style={{ width: 80, textAlign: 'right', height: 26 }}/></td>
                          <td className="num"><input type="number" min="0" className="input mono" value={r.rate} onChange={e => setRow(x.pid, ri, { rate: e.target.value })} style={{ width: 90, textAlign: 'right', height: 26 }}/></td>
                          <td className="num mono">{inr((Number(r.qty) || 0) * (Number(r.rate) || 0))}</td>
                          <td>{rows.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => removeRow(x.pid, ri)}><Icon name="x" size={11}/></button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ padding: '6px 14px' }}><button className="btn btn-sm" onClick={() => addRow(x.pid)}><Icon name="plus" size={11}/>Add vendor</button></div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </Modal>
  );
}

window.SplitAllocatorModal = SplitAllocatorModal;

// ===== Vendor PO List ===== (payables side — kept separate from client billing)
function VendorPOList() {
  const { state, navigate, getVendor, getSO, getCustomer, currentUser, getUser } = useStore();
  const [showPO, setShowPO] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [vendorF, setVendorF] = React.useState('');
  const [statusF, setStatusF] = React.useState('');
  const [groupBySO, setGroupBySO] = React.useState(true);
  const role = getUser(currentUser)?.role;
  const canCreate = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);

  const poStatusBadge = (st) => st === 'Material Received' ? <span className="badge success dot">Received</span>
    : st === 'In Transit' ? <span className="badge accent dot">In transit</span>
    : st === 'Pending MD Approval' ? <span className="badge warning dot">MD approval</span>
    : <span className="badge dot">{st}</span>;

  const rows = state.vendor_pos.filter(po => {
    if (vendorF && po.vendor_id !== vendorF) return false;
    if (statusF && po.status !== statusF) return false;
    if (search) {
      const v = getVendor(po.vendor_id); const so = getSO(po.so_id); const cust = so && getCustomer(so.customer_id);
      const blob = `${po.po_no} ${v?.name || ''} ${so?.so_no || ''} ${cust?.name || ''}`.toLowerCase();
      if (!blob.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const statuses = [...new Set(state.vendor_pos.map(p => p.status))];

  const Row = (po) => {
    const v = getVendor(po.vendor_id);
    const so = getSO(po.so_id);
    const cust = so ? getCustomer(so.customer_id) : null;
    const ebilled = po.ebill && po.ebill.generated;
    return (
      <tr key={po.id} onClick={() => navigate(`vendor-pos/${po.id}`)} style={{ cursor: 'pointer' }}>
        <td><a className="mono">{po.po_no}</a>{po.source === 'sourcing' && <div className="tiny muted">from inquiry</div>}</td>
        <td>{v ? v.name : '—'}<div className="tiny muted mono">{v?.gstin}</div></td>
        {!groupBySO && <td className="mono small">{so?.so_no}<div className="tiny muted">{cust?.name}</div></td>}
        <td className="mono small">{fmtDate(po.date)}</td>
        <td className="num">{inr(po.amount)}</td>
        <td>{poStatusBadge(po.status)}</td>
        <td>{ebilled ? <span className="badge success dot" title={po.ebill.no}>e-Bill</span> : <span className="badge dot">—</span>}</td>
        <td><Icon name="chevronRight" size={12}/></td>
      </tr>
    );
  };

  // Group by SO (project) so each project's selected vendors read clearly.
  const groups = {};
  rows.forEach(po => { (groups[po.so_id || '—'] = groups[po.so_id || '—'] || []).push(po); });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendor Purchase Orders</h1>
          <div className="page-sub">Money we pay vendors (payables) · {state.vendor_pos.length} POs · FY {state.org.fiscal_year} · client invoices live separately under Invoices</div>
        </div>
        <div className="page-actions">
          <button className={`btn ${groupBySO ? 'btn-primary' : ''}`} onClick={() => setGroupBySO(g => !g)}><Icon name="layers" size={13}/>{groupBySO ? 'Grouped by project' : 'Flat list'}</button>
          {canCreate && <button className="btn btn-primary" onClick={() => setShowPO(true)}><Icon name="plus" size={13}/>Create Vendor PO</button>}
        </div>
      </div>
      {showPO && <CreateVendorPOModal onClose={() => setShowPO(false)}/>}

      <div className="card">
        <div className="filter-bar">
          <input className="input search" placeholder="Search PO no, vendor, SO, customer…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: '0 0 240px' }}/>
          <select className="select" style={{ width: 150 }} value={vendorF} onChange={e => setVendorF(e.target.value)}>
            <option value="">All vendors</option>
            {state.vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select className="select" style={{ width: 150 }} value={statusF} onChange={e => setStatusF(e.target.value)}>
            <option value="">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="grow"/>
          <span className="muted small">{rows.length} shown</span>
        </div>

        {state.vendor_pos.length === 0 ? (
          <div className="card-body"><div className="empty"><div className="empty-title">No Vendor POs yet</div>Approve a sourced Sales Order, then generate POs for the selected vendors — they appear here, grouped by project.</div></div>
        ) : groupBySO ? (
          Object.entries(groups).map(([soId, pos]) => {
            const so = getSO(soId); const cust = so ? getCustomer(so.customer_id) : null;
            const total = pos.reduce((s, p) => s + (p.amount || 0), 0);
            return (
              <div key={soId} style={{ borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: 'var(--bg-subtle, var(--surface))' }}>
                  <div className="small"><strong className="mono" onClick={() => so && navigate(`sales-orders/${soId}`)} style={{ cursor: so ? 'pointer' : 'default' }}>{so ? so.so_no : 'Unlinked'}</strong>{cust && <span className="muted"> · {cust.name}</span>} <span className="muted">· {pos.length} vendor PO(s)</span></div>
                  <div className="small mono">{inr(total)}</div>
                </div>
                <div className="table-wrap"><table className="t"><thead><tr>
                  <th>PO No</th><th>Vendor</th><th>Date</th><th className="num">Amount</th><th>Status</th><th>e-Bill</th><th></th>
                </tr></thead><tbody>{pos.map(Row)}</tbody></table></div>
              </div>
            );
          })
        ) : (
          <div className="table-wrap"><table className="t"><thead><tr>
            <th>PO No</th><th>Vendor</th><th>For SO · Customer</th><th>Date</th><th className="num">Amount</th><th>Status</th><th>e-Bill</th><th></th>
          </tr></thead><tbody>{rows.map(Row)}</tbody></table></div>
        )}
      </div>
    </div>
  );
}

function VendorPODetail({ poId }) {
  const { state, navigate, mutate, getVendor, getSO, getCustomer, getProduct, currentUser, getUser } = useStore();
  const toast = useToast();
  const po = state.vendor_pos.find(p => p.id === poId);
  if (!po) return <div className="page"><div className="empty">PO not found</div></div>;
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canApprovePO = ['Managing Director', 'Org Admin'].includes(role);
  const canProcurePO = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const blocked = ['Pending MD Approval', 'Rejected', 'On Hold'].includes(po.status);
  const setPoStatus = (status, msg) => {
    mutate(s => ({ ...s, vendor_pos: s.vendor_pos.map(p => p.id === po.id ? { ...p, status } : p), notifications: [{ id: 'n-poapp-' + Date.now(), kind: 'po', text: `${po.po_no} ${status === 'Issued' ? 'resumed' : status === 'Rejected' ? 'rejected' : 'on hold'} by MD`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications] }), { action: 'po-status', entity: 'VendorPO', entity_id: po.id });
    toast(msg, status === 'Rejected' ? '' : 'success');
  };
  const reviewPo = (approve) => {
    const changed = !!po.pending_change;
    mutate(s => ({ ...s, vendor_pos: s.vendor_pos.map(p => p.id === po.id ? applyPOReview(p, approve) : p), notifications: [{ id: 'n-porev-' + Date.now(), kind: 'po', text: `${po.po_no} ${approve ? (changed ? 'vendor change approved' : 'approved · ready to receive') : (changed ? 'vendor change declined' : 'rejected')} by MD`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications] }), { action: 'po-review', entity: 'VendorPO', entity_id: po.id });
    toast(approve ? `${po.po_no} approved` : `${po.po_no} ${changed ? 'change declined' : 'rejected'}`, approve ? 'success' : '');
  };
  const v = getVendor(po.vendor_id);
  const so = getSO(po.so_id);
  const cust = so ? getCustomer(so.customer_id) : null;

  const subtotal = po.items.reduce((s,i) => s + i.qty * i.rate, 0);
  const gst = subtotal * 0.18;
  const grand = subtotal + gst;
  const ebilled = po.ebill && po.ebill.generated;
  const [showVI, setShowVI] = React.useState(false);
  const [showChange, setShowChange] = React.useState(false);

  // Sibling POs for the same project (SO) — the vendors selected for this order.
  const siblings = state.vendor_pos.filter(p => p.so_id === po.so_id);
  // Vendor invoice booked against this PO (payables / 3-way side).
  const vInv = (state.vendor_invoices || []).find(x => x.po_id === po.id);
  const grn = state.grns.find(g => g.po_id === po.id);
  // Simple, mostly-automatic lifecycle for non-tech users.
  const stages = [
    { label: 'Issued', done: true },
    { label: 'Received', done: po.status === 'Material Received' || !!grn },
    { label: 'e-Bill', done: !!ebilled },
    { label: 'Vendor Invoice', done: !!vInv },
    { label: 'Booked', done: !!(vInv && vInv.status === 'Booked') },
  ];

  const genEbill = () => {
    const seq = String(5001 + state.vendor_pos.filter(p => p.ebill && p.ebill.generated).length).padStart(4, '0');
    const ebill = {
      no: `VPO-EB/FY26/${seq}`,
      irn: (po.id + po.po_no).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toUpperCase(),
      date: TODAY, amount: grand, generated: true,
    };
    mutate(s => ({ ...s, vendor_pos: s.vendor_pos.map(p => p.id === po.id ? { ...p, ebill } : p) }),
      { action: 'ebill', entity: 'VendorPO', entity_id: po.id });
    toast('Vendor PO e-Bill generated & stored on this PO', 'success');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('vendor-pos')}>
            <Icon name="chevronLeft" size={12}/> Vendor POs
          </div>
          <h1 className="page-title">
            <span className="mono">{po.po_no}</span>
            <span className="badge dot ml-2" style={{ marginLeft: 8 }}>{po.status}</span>
            {po.source === 'sourcing' && <span className="badge accent" style={{ marginLeft: 6 }}>from inquiry</span>}
          </h1>
          <div className="page-sub">Payable to <strong>{v.name}</strong> · For project <span className="mono">{so?.so_no}</span>{cust ? ` · ${cust.name}` : ''}</div>
        </div>
        <div className="page-actions">
          {po.status === 'Pending MD Approval' && canApprovePO && <>
            <button className="btn btn-primary" onClick={() => reviewPo(true)}><Icon name="check" size={13}/>{po.pending_change ? 'Approve change' : 'Approve'}</button>
            {!po.pending_change && <button className="btn" onClick={() => setPoStatus('On Hold', `${po.po_no} on hold`)}><Icon name="alert" size={13}/>Hold</button>}
            <button className="btn btn-danger" onClick={() => reviewPo(false)}>Reject</button>
          </>}
          {po.status === 'On Hold' && canApprovePO && <button className="btn btn-primary" onClick={() => setPoStatus('Issued', `${po.po_no} resumed`)}><Icon name="repeat" size={13}/>Resume</button>}
          {canProcurePO && ['Issued', 'In Transit'].includes(po.status) && !po.pending_change && !grn && <button className="btn" onClick={() => setShowChange(true)}><Icon name="arrowLeftRight" size={13}/>Change vendor</button>}
          {ebilled
            ? <button className="btn" onClick={() => window.print()}><Icon name="print" size={13}/>Print e-Bill</button>
            : !blocked && <button className="btn btn-primary" onClick={genEbill}><Icon name="receipt" size={13}/>Generate PO e-Bill</button>}
          <button className="btn"><Icon name="mail" size={13}/>Resend to vendor</button>
          {!blocked && (po.status !== 'Material Received'
            ? <button className="btn btn-primary" onClick={() => navigate('grn')}><Icon name="package" size={13}/>Create GRN</button>
            : !vInv
              ? <button className="btn btn-primary" onClick={() => setShowVI(true)}><Icon name="receipt" size={13}/>Record vendor invoice</button>
              : <button className="btn" onClick={() => navigate(`three-way/${vInv.id}`)}><Icon name="check" size={13}/>View 3-way match</button>)}
        </div>
      </div>
      {po.status === 'Pending MD Approval' && <div className="mb-2" style={{ padding: '10px 12px', background: 'var(--warning-bg)', border: '1px solid oklch(0.85 0.09 75)', borderRadius: 'var(--radius)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}><Icon name="alert" size={14} color="var(--warning)"/><span>{po.pending_change
        ? <><strong>Vendor change awaiting MD approval</strong> · switch to <strong>{getVendor(po.pending_change.vendor_id)?.name}</strong> at {inr(po.pending_change.amount)} (was {inr(po.pending_change.old_amount)}, saves {inr(po.pending_change.old_amount - po.pending_change.amount)}). On approval the vendor swaps in automatically and the flow continues.</>
        : <><strong>Awaiting MD approval</strong> · this PO is over the approval threshold ({inr(grand)}). Receiving is blocked until approved.</>}{!canApprovePO && ' Only the Managing Director / Org Admin can approve.'}</span></div>}
      {po.status === 'Rejected' && <div className="mb-2" style={{ padding: '10px 12px', background: 'var(--danger-bg)', borderRadius: 'var(--radius)', fontSize: 12.5 }}><Icon name="alert" size={14} color="var(--danger)"/> <strong>Rejected by MD.</strong> Re-create a PO via the Vendor POs tab if needed.</div>}
      {showVI && <RecordVendorInvoiceModal poId={po.id} onClose={() => setShowVI(false)}/>}
      {showChange && <ChangeVendorModal po={po} onClose={() => setShowChange(false)}/>}

      <div className="card mb-2"><div className="card-body" style={{ padding: '10px 14px' }}>
        <div className="h-timeline">
          {stages.map((st, i) => {
            const current = !st.done && (i === 0 || stages[i - 1].done);
            return <div key={st.label} className={`h-step ${st.done ? 'done' : ''} ${current ? 'current' : ''}`}><Icon name={st.done ? 'check' : 'spinner'} size={11}/>{st.label}</div>;
          })}
        </div>
        <div className="tiny muted mt-1">Ordered → received → e-Billed → vendor invoice 3-way matched → booked for payment. Receiving auto-creates the e-Bill; a matching invoice auto-books.</div>
      </div></div>

      {/* Client vs vendor billing — kept explicitly separate */}
      <div className="mb-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}><div className="card-body">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Vendor side · we pay (payable)</div>
          <div className="mono" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{inr(grand)}</div>
          <div className="tiny muted">{ebilled ? <>e-Bill <span className="mono">{po.ebill.no}</span> · {fmtDate(po.ebill.date)}</> : 'PO e-Bill not generated yet'} · {vInv ? `vendor invoice ${vInv.vendor_invoice_no} (3-way)` : 'no vendor invoice yet'}</div>
        </div></div>
        <div className="card"><div className="card-body">
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Client side · customer pays (receivable)</div>
          <div className="mono" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{so && so.invoice_amount ? inr(so.invoice_amount) : '—'}</div>
          <div className="tiny muted">
            {so && so.invoice_no
              ? <>Tax invoice <span className="mono">{so.invoice_no}</span> · <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => navigate(`invoices/${so.id}`)}>view</a></>
              : 'Customer not invoiced yet — billed on the SO, separate from this PO'}
          </div>
        </div></div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">PO Items</h3></div>
            <div className="card-body flush">
              <table className="t">
                <thead><tr><th>Product</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {po.items.map((it, i) => {
                    const p = getProduct(it.product_id);
                    return (
                      <tr key={i}>
                        <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                        <td className="mono small">{p.hsn}</td>
                        <td className="num">{it.qty} {p.uom}</td>
                        <td className="num">{inr(it.rate)}</td>
                        <td className="num">{inr(it.qty * it.rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr><td colSpan="4" className="right small">Subtotal</td><td className="num">{inr(subtotal)}</td></tr>
                  <tr><td colSpan="4" className="right small">IGST 18%</td><td className="num">{inr(gst)}</td></tr>
                  <tr><td colSpan="4" className="right"><strong>Grand Total</strong></td><td className="num"><strong>{inr(grand)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Terms & Conditions</h3></div>
            <div className="card-body small">
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Material to be delivered to {state.org.address} unless otherwise specified.</li>
                <li>Payment terms: {v.terms} from invoice date.</li>
                <li>Defective material to be replaced free of cost within 7 days of intimation.</li>
                <li>All disputes subject to Mumbai jurisdiction.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Vendor</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>Name</dt><dd>{v.name}</dd>
                <dt>GSTIN</dt><dd className="mono">{v.gstin}</dd>
                <dt>Contact</dt><dd>{v.contact} · {v.phone}</dd>
                <dt>City</dt><dd>{v.city}</dd>
                <dt>Rating</dt><dd>★ {v.rating}</dd>
                <dt>Terms</dt><dd>{v.terms}</dd>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Delivery</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>Expected</dt><dd className="mono">{fmtDate(po.expected)}</dd>
                <dt>LR / Tracking</dt><dd className="mono">TCI-MUM-99821</dd>
                <dt>Ship to</dt><dd className="small">Brightline Godown · Powai · Mumbai 400076</dd>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">PO e-Bill</h3></div>
            <div className="card-body">
              {ebilled ? (
                <div className="dl">
                  <dt>e-Bill no.</dt><dd className="mono">{po.ebill.no}</dd>
                  <dt>IRN</dt><dd className="mono small">{po.ebill.irn}</dd>
                  <dt>Generated</dt><dd className="mono">{fmtDate(po.ebill.date)}</dd>
                  <dt>Amount</dt><dd className="mono">{inr(po.ebill.amount || grand)}</dd>
                </div>
              ) : (
                <div className="small muted">No e-Bill yet. Generate it to issue an official PO document, stored on this Vendor PO. <div className="mt-2"><button className="btn btn-sm btn-primary" onClick={genEbill}><Icon name="receipt" size={12}/>Generate PO e-Bill</button></div></div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Project vendor history</h3></div>
            <div className="card-body flush">
              <div className="small muted" style={{ padding: '6px 14px' }}>All vendors selected for <span className="mono">{so?.so_no}</span></div>
              <table className="t">
                <thead><tr><th>PO</th><th>Vendor</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {siblings.map(s => {
                    const sv = getVendor(s.vendor_id);
                    return (
                      <tr key={s.id} className={s.id === po.id ? 'selected' : ''} onClick={() => navigate(`vendor-pos/${s.id}`)} style={{ cursor: 'pointer' }}>
                        <td><a className="mono">{s.po_no}</a></td>
                        <td className="small">{sv?.name}</td>
                        <td className="num">{inr(s.amount)}</td>
                        <td>{s.ebill && s.ebill.generated ? <span className="badge success dot">e-Bill</span> : <span className="badge dot">{s.status}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== GRN =====
function GRNList() {
  const { state, navigate, getVendor } = useStore();
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Goods Receipt Notes (GRN)</h1>
          <div className="page-sub">Stores' record of material received · auto-allocated to source SO's Virtual Godown</div>
        </div>
        <div className="page-actions">
          <span className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={12} color="var(--success)"/>Auto-created on receipt at the Virtual Godown</span>
          <button className="btn" onClick={() => navigate('godown')}><Icon name="box" size={13}/>Go to Virtual Godowns</button>
        </div>
      </div>

      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr>
              <th>GRN No</th><th>Vendor PO</th><th>Received Date</th><th>LR No</th>
              <th className="num">Lines</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {state.grns.map(g => {
                const po = state.vendor_pos.find(p => p.id === g.po_id);
                return (
                  <tr key={g.id} onClick={() => navigate(`grn/${g.id}`)} style={{ cursor: 'pointer' }}>
                    <td><a className="mono">{g.grn_no}</a></td>
                    <td className="mono">{po?.po_no}</td>
                    <td className="mono small">{fmtDate(g.date)}</td>
                    <td className="mono small">{g.lr}</td>
                    <td className="num">{g.items.length}</td>
                    <td><span className="badge success dot">Posted</span></td>
                    <td><Icon name="chevronRight" size={12}/></td>
                  </tr>
                );
              })}
              {state.grns.length === 0 && (
                <tr><td colSpan="7"><div className="empty">No GRNs yet — they appear here once Stores receives material against a Vendor PO.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GRNDetail({ grnId }) {
  const { state, navigate, getVendor, getProduct } = useStore();
  const g = state.grns.find(x => x.id === grnId);
  if (!g) return <div className="page"><div className="empty">GRN not found</div></div>;
  const po = state.vendor_pos.find(p => p.id === g.po_id);
  const v = getVendor(po.vendor_id);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('grn')}>
            <Icon name="chevronLeft" size={12}/> GRN
          </div>
          <h1 className="page-title"><span className="mono">{g.grn_no}</span> <span className="badge success dot ml-2" style={{ marginLeft: 8 }}>Posted</span></h1>
          <div className="page-sub">For VPO <span className="mono">{po.po_no}</span> · {v.name} · received {fmtDate(g.date)}</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="print" size={13}/>Print</button>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Receipt Lines</h3><span className="card-sub">Status reflects cumulative receipts against this PO</span></div>
            <div className="card-body flush">
              <table className="t zebra">
                <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Accepted</th><th className="num">Rejected</th><th className="num">Remaining</th><th>Status</th></tr></thead>
                <tbody>
                  {g.items.map((it, i) => {
                    const p = getProduct(it.product_id);
                    // Cumulative accepted for this product across ALL GRNs of the PO → live remaining.
                    const cumAcc = state.grns.filter(x => x.po_id === g.po_id).reduce((a, x) => a + (x.items || []).filter(y => y.product_id === it.product_id).reduce((b, y) => b + (y.accepted || 0), 0), 0);
                    const ordered = (po.items || []).filter(y => y.product_id === it.product_id).reduce((a, y) => a + (y.qty || 0), 0) || it.ordered || 0;
                    const remaining = Math.max(0, ordered - cumAcc);
                    return (
                      <tr key={i}>
                        <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                        <td className="num">{it.ordered}</td>
                        <td className="num">{it.received}</td>
                        <td className="num"><span style={{ color: 'var(--success)' }}>{it.accepted}</span></td>
                        <td className="num">{it.rejected || <span className="muted">0</span>}</td>
                        <td className="num">{remaining > 0 ? <strong style={{ color: 'var(--warning)' }}>{remaining}</strong> : <span className="muted">0</span>}</td>
                        <td>{remaining > 0 ? <span className="badge warning dot">Remaining</span> : <span className="badge success dot">Fulfilled</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">QC Checklist</h3></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {[
                  ['Outer packaging intact', true],
                  ['Quantity matches PO', true],
                  ['Serial numbers recorded', true],
                  ['Visual inspection passed', true],
                  ['Documentation (LR, invoice) attached', true],
                  ['Damage report (if any)', false],
                ].map(([label, ok], i) => (
                  <div key={i} className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, border: '1px solid var(--border)', borderRadius: 4 }}>
                    <Icon name={ok ? 'check' : 'x'} size={13} color={ok ? 'var(--success)' : 'var(--text-3)'}/>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Receipt Info</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>Vendor</dt><dd>{v.name}</dd>
                <dt>LR / tracking</dt><dd className="mono">{g.lr}</dd>
                <dt>Received by</dt><dd>Arun Bhatia</dd>
                <dt>Receipt date</dt><dd className="mono">{fmtDate(g.date)}</dd>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Auto-routed to VG</h3></div>
            <div className="card-body">
              <div className="small muted mb-2">Items added to Virtual Godown of:</div>
              <div className="pool-item">
                <div>
                  <div style={{ fontWeight: 500, fontSize: 12.5 }} className="mono">{state.sales_orders.find(s => s.id === po.so_id)?.so_no}</div>
                  <div className="tiny muted">23 components added</div>
                </div>
                <button className="btn btn-sm" onClick={() => navigate(`godown/${po.so_id}`)}>View VG</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared receipt poster — used by the single-PO GRN screen AND the per-vendor
// Receive modal. Creates the GRN, auto-stamps the PO e-Bill, auto-books the
// vendor (payable) invoice for the received value, routes surplus to the Master
// Pool, auto-reduces the client bill for removed items, and auto-raises the
// client partial invoice. items: [{product_id, qty(ordered), received, rejected, reason, to_pool}].
async function postReceiptForPO(po, items, meta, ctx) {
  const { state, mutate, toast, addToPool, getProduct, getVendor, currentUser, getUser } = ctx;
  const grnDate = (meta && meta.grnDate) || TODAY; const lr = (meta && meta.lr) || '';
  const seqOff = (meta && meta.seqOffset) || 0;   // keeps numbering unique when posting several POs in one action
  const norm = items.map(it => ({ ...it, accepted: Math.max(0, (it.received || 0) - (it.rejected || 0) - (it.to_pool || 0)) }));
  const surplus = norm.filter(it => (it.to_pool || 0) > 0).map(it => ({ product_id: it.product_id, qty: it.to_pool, source_so: po.so_id, received_date: grnDate }));
  const surplusUnits = surplus.reduce((s, x) => s + x.qty, 0);
  const grnNo = `GRN/FY26/${String(28 + state.grns.length + seqOff).padStart(4, '0')}`;
  const rnd = Math.random().toString(36).slice(2, 5);
  const grn = {
    id: 'grn-' + Date.now() + rnd, grn_no: grnNo, po_id: po.id, date: grnDate, lr, received_by: 'Stores', status: 'Posted',
    items: norm.map(it => ({ product_id: it.product_id, ordered: it.qty, received: it.received, accepted: it.accepted, rejected: it.rejected || 0, reject_reason: it.reason || null, to_pool: it.to_pool || 0 })),
  };
  const adjustments = norm.filter(it => (it.to_pool || 0) > 0).map(it => { const p = getProduct(it.product_id); return { product_id: it.product_id, qty: it.to_pool, amount: Math.round((p ? (p.sell || 0) : 0) * it.to_pool), reason: 'Removed at GRN — not supplied to customer', grn_id: grn.id, date: grnDate }; });
  const billCut = adjustments.reduce((s, a) => s + a.amount, 0);
  const ebillSeq = String(5001 + state.vendor_pos.filter(p => p.ebill && p.ebill.generated).length + seqOff).padStart(4, '0');
  const ebill = po.ebill && po.ebill.generated ? po.ebill : { no: `VPO-EB/FY26/${ebillSeq}`, irn: (po.id + po.po_no).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toUpperCase(), date: grnDate, amount: Math.round((po.amount || 0) * 1.18), generated: true, auto: true };
  const rateOf = {}; (po.items || []).forEach(it => { rateOf[it.product_id] = it.rate; });
  const recvValue = norm.reduce((s, it) => s + (it.accepted || 0) * (rateOf[it.product_id] || 0), 0);
  const autoVI = recvValue > 0 ? { id: 'vi-' + Date.now() + rnd, vendor_invoice_no: `VINV/FY26/${String(1 + (state.vendor_invoices || []).length + seqOff).padStart(4, '0')}`, po_id: po.id, grn_id: grn.id, vendor_id: po.vendor_id, date: grnDate, amount: Math.round(recvValue), status: 'Booked', tolerance: 'within' } : null;
  // A PO is only fully received when cumulative accepted >= ordered for EVERY line
  // (prior GRNs for this PO + this receipt). Otherwise it stays 'Partially Received'
  // so it remains receivable for the rest. Whole-PO receipts still resolve to complete.
  const cumAcc = {};
  state.grns.filter(g => g.po_id === po.id).forEach(g => (g.items || []).forEach(it => { cumAcc[it.product_id] = (cumAcc[it.product_id] || 0) + (it.accepted || 0); }));
  norm.forEach(it => { cumAcc[it.product_id] = (cumAcc[it.product_id] || 0) + (it.accepted || 0); });
  const poComplete = (po.items || []).every(it => (cumAcc[it.product_id] || 0) >= (it.qty || 0));
  const newPoStatus = poComplete ? 'Material Received' : 'Partially Received';
  const so = state.sales_orders.find(x => x.id === po.so_id);
  mutate(s => ({
    ...s,
    grns: [grn, ...s.grns],
    vendor_pos: s.vendor_pos.map(p => p.id === po.id ? { ...p, status: newPoStatus, ebill } : p),
    vendor_invoices: autoVI ? [autoVI, ...s.vendor_invoices] : s.vendor_invoices,
    sales_orders: (po.so_id && adjustments.length) ? s.sales_orders.map(x => x.id === po.so_id ? { ...x, bill_adjustments: [...(x.bill_adjustments || []), ...adjustments] } : x) : s.sales_orders,
    notifications: [
      { id: 'n-grn-' + Date.now() + rnd, kind: 'grn', text: `${grnNo} posted for ${po.po_no}${so ? ' · ' + so.so_no : ''} · received + e-Bill auto-saved`, date: TODAY, read: false, role: 'Billing' },
      ...(autoVI ? [{ id: 'n-payv-' + Date.now() + rnd, kind: 'match', text: `${autoVI.vendor_invoice_no} auto-booked · ${inrK(autoVI.amount)} payable to ${getVendor(po.vendor_id)?.name || 'vendor'} (${po.po_no})`, date: TODAY, read: false, role: 'Billing' }] : []),
      ...(surplusUnits ? [{ id: 'n-pool-' + Date.now() + rnd, kind: 'transfer', text: `${surplusUnits} surplus unit(s) → Master Pool from ${po.po_no}`, date: TODAY, read: false, role: 'Stores' }] : []),
      ...(billCut ? [{ id: 'n-bill-' + Date.now() + rnd, kind: 'so', text: `${so ? so.so_no : po.po_no}: customer bill auto-reduced by ${inrK(billCut)} (items not supplied)`, date: TODAY, read: false, role: 'Billing' }] : []),
    ],
  }), { action: 'create', entity: 'GRN', entity_id: grn.id });
  if (surplus.length) await addToPool(surplus);
  // Skip the per-PO client invoice when the caller will raise one consolidated
  // invoice after posting several POs (VG "Mark Received"). Default behaviour
  // (single-PO receive) is unchanged.
  if (!(meta && meta.skipInvoice) && po.so_id && window.autoInvoiceSO) window.autoInvoiceSO(po.so_id, { mutate, toast: null, currentUser, getUser, getProduct });
  return { grn, surplusUnits, billCut, poComplete };
}
window.postReceiptForPO = postReceiptForPO;

// Per-vendor receive modal (used from the SO Vendor POs tab — scalable to many vendors).
function ReceiveModal({ po, onClose }) {
  const { state, mutate, addToPool, getProduct, getVendor, currentUser, getUser } = useStore();
  const toast = useToast();
  const v = getVendor(po.vendor_id);
  const [items, setItems] = React.useState(po.items.map(it => ({ ...it, recv: true, received: it.qty, rejected: 0, reason: '', to_pool: 0 })));
  const [lr, setLr] = React.useState('DELHIVERY-D88234');
  const [grnDate, setGrnDate] = React.useState(TODAY);
  const submit = async () => {
    if (items.some(it => it.rejected > 0 && !it.reason)) { toast('Add a reason for each rejected line'); return; }
    await postReceiptForPO(po, items, { lr, grnDate }, { state, mutate, toast, addToPool, getProduct, getVendor, currentUser, getUser });
    toast(`Receipt posted for ${po.po_no}`, 'success');
    onClose();
  };
  return (
    <Modal title={`Receive — ${po.po_no} · ${v ? v.name : ''}`} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}><Icon name="check" size={13}/>Post receipt</button></>}>
      <div className="field-row mb-2">
        <div className="field"><label className="field-label">LR / tracking</label><input className="input mono" value={lr} onChange={e => setLr(e.target.value)}/></div>
        <div className="field"><label className="field-label">Received date</label><input type="date" className="input mono" value={grnDate} onChange={e => setGrnDate(e.target.value)}/></div>
      </div>
      <table className="t">
        <thead><tr><th style={{ width: 30 }}>Recv</th><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Accepted</th><th className="num">Rejected</th><th className="num">→ Pool</th></tr></thead>
        <tbody>
          {items.map((it, i) => {
            const p = getProduct(it.product_id) || { name: it.product_id, code: it.product_id };
            const off = !it.recv; const acc = it.recv ? Math.max(0, (it.received || 0) - (it.rejected || 0) - (it.to_pool || 0)) : 0;
            return (
              <tr key={i} style={{ opacity: off ? 0.5 : 1 }}>
                <td><input type="checkbox" checked={!!it.recv} onChange={e => { const on = e.target.checked; const n = [...items]; n[i] = on ? { ...it, recv: true, received: it.qty, rejected: 0, to_pool: 0 } : { ...it, recv: false, received: 0, rejected: 0, to_pool: 0 }; setItems(n); }}/></td>
                <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                <td className="num">{it.qty}</td>
                <td className="num"><input type="number" min="0" className="input mono" disabled={off} value={it.received} onChange={e => { const n = [...items]; n[i] = { ...it, received: parseInt(e.target.value) || 0 }; setItems(n); }} style={{ width: 60, textAlign: 'right' }}/></td>
                <td className="num"><input type="number" className="input mono" readOnly value={acc} style={{ width: 56, textAlign: 'right', background: 'var(--bg-subtle)' }}/></td>
                <td className="num"><input type="number" min="0" className="input mono" disabled={off} value={it.rejected} onChange={e => { const n = [...items]; n[i] = { ...it, rejected: parseInt(e.target.value) || 0 }; setItems(n); }} style={{ width: 56, textAlign: 'right' }}/></td>
                <td className="num"><input type="number" min="0" className="input mono" disabled={off} value={it.to_pool} onChange={e => { const n = [...items]; n[i] = { ...it, to_pool: parseInt(e.target.value) || 0 }; setItems(n); }} style={{ width: 56, textAlign: 'right' }}/></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="tiny muted mt-2">Posting auto-creates the GRN + e-Bill, books the vendor payable invoice for the received value, and raises the client partial invoice. Rejected/▸Pool quantities auto-route as configured.</div>
    </Modal>
  );
}
window.ReceiveModal = ReceiveModal;

function GRNNew() {
  const { navigate, state, mutate, getVendor, getProduct, getSO, addToPool, currentUser, getUser } = useStore();
  const toast = useToast();
  // Receivable = POs not yet fully received.
  const blockedPo = (st) => ['Pending MD Approval', 'Rejected', 'On Hold'].includes(st);
  const receivable = state.vendor_pos.filter(p => p.status !== 'Material Received' && !blockedPo(p.status));
  const [poId, setPoId] = React.useState(() => {
    const d = state.vendor_pos.find(p => p.status === 'In Transit') || receivable[0] || state.vendor_pos[0];
    return d ? d.id : '';
  });
  const po = state.vendor_pos.find(p => p.id === poId) || null;
  const [items, setItems] = React.useState([]);
  const [lr, setLr] = React.useState('DELHIVERY-D88234');
  const [grnDate, setGrnDate] = React.useState(TODAY);
  React.useEffect(() => {
    setItems(po ? po.items.map(it => ({ ...it, recv: true, received: it.qty, accepted: it.qty, rejected: 0, reason: '', to_pool: 0 })) : []);
  }, [poId]);

  if (state.vendor_pos.length === 0) return (
    <div className="page">
      <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('grn')}>
        <Icon name="chevronLeft" size={12}/> GRN
      </div>
      <div className="empty">
        <div className="empty-title">No vendor PO to receive against</div>
        A GRN records material received against a Vendor PO. Create a Vendor PO first.
        <div className="mt-2"><button className="btn" onClick={() => navigate('vendor-pos')}>Go to Vendor POs</button></div>
      </div>
    </div>
  );

  const v = po ? getVendor(po.vendor_id) : null;
  const so = po ? getSO(po.so_id) : null;

  const post = async () => {
    if (!po) { toast('Pick a Vendor PO to receive against'); return; }
    if (items.some(it => it.rejected > 0 && !it.reason)) { toast('Add a reason for each rejected line'); return; }
    const r = await postReceiptForPO(po, items, { lr, grnDate }, { state, mutate, toast, addToPool, getProduct, getVendor, currentUser, getUser });
    toast(`${r.grn.grn_no} posted · ${po.po_no} received${r.surplusUnits ? ` · ${r.surplusUnits} → Master Pool` : ''}${r.billCut ? ` · bill −${inrK(r.billCut)}` : ''}`, 'success');
    navigate(`vendor-pos/${po.id}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('grn')}>
            <Icon name="chevronLeft" size={12}/> GRN
          </div>
          <h1 className="page-title">New GRN</h1>
          <div className="page-sub">Receiving material against <span className="mono">{po ? po.po_no : '—'}</span>{v ? ` · ${v.name}` : ''}</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate('grn')}>Cancel</button>
          <button className="btn btn-primary" onClick={post}>
            <Icon name="check" size={13}/>Post GRN
          </button>
        </div>
      </div>

      <div className="card mb-2"><div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="field" style={{ minWidth: 280 }}>
          <label className="field-label">Receive against Vendor PO</label>
          <select className="select" value={poId} onChange={e => setPoId(e.target.value)}>
            {state.vendor_pos.filter(p => !blockedPo(p.status)).map(p => { const vv = getVendor(p.vendor_id); const ss = getSO(p.so_id); return (
              <option key={p.id} value={p.id}>{p.po_no} · {vv?.name} · {ss?.so_no || '—'} · {p.status}</option>
            ); })}
          </select>
        </div>
        <div className="field"><label className="field-label">LR / tracking</label><input className="input mono" value={lr} onChange={e => setLr(e.target.value)}/></div>
        <div className="field"><label className="field-label">Received date</label><input type="date" className="input mono" value={grnDate} onChange={e => setGrnDate(e.target.value)}/></div>
      </div></div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Receipt Lines</h3></div>
            <div className="card-body flush">
              <table className="t">
                <thead><tr><th style={{ width: 30 }}>Recv</th><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Accepted</th><th className="num">Rejected</th><th className="num">Not needed → Pool</th><th>Reject reason</th></tr></thead>
                <tbody>
                  {items.map((it, i) => {
                    const p = getProduct(it.product_id);
                    const acc = it.recv ? Math.max(0, (it.received || 0) - (it.rejected || 0) - (it.to_pool || 0)) : 0;
                    const off = !it.recv;
                    return (
                      <tr key={i} style={{ opacity: off ? 0.5 : 1 }}>
                        <td><input type="checkbox" checked={!!it.recv} onChange={e => { const on = e.target.checked; const next=[...items]; next[i] = on ? {...it, recv:true, received: it.qty, accepted: it.qty, rejected:0, to_pool:0} : {...it, recv:false, received:0, accepted:0, rejected:0, to_pool:0}; setItems(next); }}/></td>
                        <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                        <td className="num">{it.qty}</td>
                        <td className="num">
                          <input type="number" className="input mono" min="0" value={it.received} disabled={off}
                                 onChange={e => { const v = parseInt(e.target.value) || 0; const next=[...items]; next[i] = {...it, received: v, accepted: Math.max(0, v - it.rejected - (it.to_pool||0))}; setItems(next); }}
                                 style={{ width: 64, textAlign: 'right' }}/>
                        </td>
                        <td className="num">
                          <input type="number" className="input mono" value={acc} readOnly style={{ width: 64, textAlign: 'right', background: 'var(--bg-subtle)' }}/>
                        </td>
                        <td className="num">
                          <input type="number" className="input mono" min="0" value={it.rejected} disabled={off}
                                 onChange={e => { const v = parseInt(e.target.value) || 0; const next=[...items]; next[i] = {...it, rejected: v, accepted: Math.max(0, it.received - v - (it.to_pool||0))}; setItems(next); }}
                                 style={{ width: 64, textAlign: 'right' }}/>
                        </td>
                        <td className="num">
                          <input type="number" className="input mono" min="0" value={it.to_pool || 0} disabled={off}
                                 onChange={e => { const v = parseInt(e.target.value) || 0; const next=[...items]; next[i] = {...it, to_pool: v, accepted: Math.max(0, it.received - it.rejected - v)}; setItems(next); }}
                                 style={{ width: 70, textAlign: 'right' }}/>
                          {(it.to_pool||0) > 0 && <div className="tiny" style={{ color: 'var(--accent)' }}>→ Master Pool</div>}
                        </td>
                        <td><input className="input" placeholder={it.rejected > 0 ? 'Reason required' : ''} disabled={off || !it.rejected} value={it.reason || ''} onChange={e => { const next = [...items]; next[i] = { ...it, reason: e.target.value }; setItems(next); }}/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">QC Checklist</h3></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {['Outer packaging intact','Quantity matches PO','Serial numbers recorded','Visual inspection passed','Documentation attached','No damage observed'].map((c, i) => (
                  <label key={i} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked/>
                    {c}
                  </label>
                ))}
              </div>
              <div className="field mt-2">
                <label className="field-label">Stores remarks</label>
                <textarea className="textarea" placeholder="Any observations…"/>
              </div>
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Receipt Info</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>Vendor PO</dt><dd className="mono">{po ? po.po_no : '—'}</dd>
                <dt>For SO</dt><dd className="mono">{so?.so_no || '—'}</dd>
                <dt>LR / tracking</dt><dd className="mono">{lr}</dd>
                <dt>Received</dt><dd className="mono">{fmtDate(grnDate)}</dd>
              </div>
              <div className="field mt-2"><label className="field-label">Vehicle no.</label><input className="input mono" defaultValue="MH-04-EZ-9921"/></div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Photos</h3></div>
            <div className="card-body">
              <div className="ph-block">Drop photos here · up to 10</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 3-Way Match (real routing: GRN → record vendor invoice → match → book) =====
function ThreeWayMatchList() {
  const { state, navigate, currentUser, getUser, getVendor } = useStore();
  const [showRecord, setShowRecord] = React.useState(false);
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canRecord = ['Billing', 'Purchase', 'Org Admin'].includes(role);
  const stBadge = (st) => st === 'Booked' ? <span className="badge success dot">Booked</span>
    : st === 'Rejected' ? <span className="badge danger dot">Rejected</span>
    : st === 'Parked' ? <span className="badge warning dot">Parked</span>
    : <span className="badge accent dot">{st}</span>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">3-Way Match</h1>
          <div className="page-sub">Vendor Invoice ⟷ Vendor PO ⟷ GRN · auto tolerance check before booking payables</div>
        </div>
        <div className="page-actions">
          {canRecord && <button className="btn btn-primary" onClick={() => setShowRecord(true)}><Icon name="plus" size={13}/>Record vendor invoice</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr>
              <th>Vendor Invoice</th><th>Vendor</th><th>PO</th><th>GRN</th>
              <th className="num">Amount</th><th>Tolerance</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {state.vendor_invoices.map(vi => {
                const v = getVendor(vi.vendor_id);
                const po = state.vendor_pos.find(p => p.id === vi.po_id);
                return (
                  <tr key={vi.id} onClick={() => navigate(`three-way/${vi.id}`)} style={{ cursor: 'pointer' }}>
                    <td className="mono">{vi.vendor_invoice_no}</td>
                    <td>{v?.name}</td>
                    <td className="mono">{po?.po_no}</td>
                    <td>{vi.grn_id ? <span className="badge success dot">Received</span> : <span className="badge warning dot">Pending</span>}</td>
                    <td className="num">{inr(vi.amount)}</td>
                    <td>{vi.tolerance === 'within' ? <span className="badge success">Within</span> : <span className="badge danger">Outside</span>}</td>
                    <td>{stBadge(vi.status)}</td>
                    <td><Icon name="chevronRight" size={12}/></td>
                  </tr>
                );
              })}
              {state.vendor_invoices.length === 0 && (
                <tr><td colSpan="8"><div className="empty">
                  <div className="empty-title">No vendor invoices yet</div>
                  Post a GRN against a Vendor PO, then record the vendor's invoice here — it's auto-checked against the PO &amp; GRN, then booked.
                  {canRecord && <div className="mt-2"><button className="btn btn-primary" onClick={() => setShowRecord(true)}><Icon name="plus" size={13}/>Record vendor invoice</button></div>}
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showRecord && <RecordVendorInvoiceModal onClose={() => setShowRecord(false)}/>}
    </div>
  );
}

// Record a vendor's invoice against a received PO; tolerance auto-computed.
function RecordVendorInvoiceModal({ onClose, poId }) {
  const { state, mutate, getVendor, getSO } = useStore();
  const toast = useToast();
  const tol = state.config.three_way_value_tolerance != null ? state.config.three_way_value_tolerance : 2;
  // Eligible: POs with a posted GRN and no invoice recorded yet.
  const eligible = state.vendor_pos.filter(p => state.grns.find(g => g.po_id === p.id) && !state.vendor_invoices.find(vi => vi.po_id === p.id));
  const [pid, setPid] = React.useState(poId || (eligible[0] ? eligible[0].id : ''));
  const po = state.vendor_pos.find(p => p.id === pid) || null;
  const grn = po ? state.grns.find(g => g.po_id === po.id) : null;
  const [invNo, setInvNo] = React.useState('');
  const [amount, setAmount] = React.useState(po ? po.amount : 0);
  const [date, setDate] = React.useState(TODAY);
  React.useEffect(() => { setAmount(po ? po.amount : 0); }, [pid]);

  const valueVar = po && po.amount ? ((Number(amount) - po.amount) / po.amount) * 100 : 0;
  const within = Math.abs(valueVar) <= tol;

  const submit = () => {
    if (!po) { toast('Pick a received Vendor PO'); return; }
    // Invoice number is optional — auto-number if left blank.
    const finalNo = invNo.trim() || `VINV/FY26/${String(1 + state.vendor_invoices.length).padStart(4, '0')}`;
    // Auto-book clean matches; only out-of-tolerance invoices stop for review.
    const vendorName = getVendor(po.vendor_id)?.name || 'vendor';
    const vi = {
      id: 'vi-' + Date.now(), vendor_invoice_no: finalNo, po_id: po.id, grn_id: grn ? grn.id : null,
      vendor_id: po.vendor_id, date, amount: Number(amount) || 0,
      status: within ? 'Booked' : 'Pending 3-Way Match',
      tolerance: within ? 'within' : 'outside',
    };
    mutate(s => ({
      ...s,
      vendor_invoices: [vi, ...s.vendor_invoices],
      notifications: [{
        id: 'n-vi-' + Date.now(), kind: 'match',
        text: within
          ? `${vi.vendor_invoice_no} auto-matched & booked · ${inrK(vi.amount)} payable to ${vendorName} (${po.po_no})`
          : `${vi.vendor_invoice_no} OUTSIDE tolerance · needs review · ${po.po_no}`,
        date: TODAY, read: false, role: within ? 'Managing Director' : 'Billing',
      }, ...s.notifications],
    }), { action: 'create', entity: 'VendorInvoice', entity_id: vi.id });
    toast(within ? `${vi.vendor_invoice_no} matched & booked automatically` : `${vi.vendor_invoice_no} flagged — needs review`, within ? 'success' : '');
    onClose();
  };

  return (
    <Modal title="Record vendor invoice" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!po} onClick={submit}>Record &amp; run match</button>
      </>
    }>
      {eligible.length === 0 && !poId ? (
        <div className="empty">No received POs awaiting an invoice. Post a GRN against a Vendor PO first.</div>
      ) : (
        <>
          <div className="field">
            <label className="field-label">Vendor PO (received) *</label>
            <select className="select" value={pid} onChange={e => setPid(e.target.value)} disabled={!!poId}>
              {(poId ? state.vendor_pos.filter(p => p.id === poId) : eligible).map(p => {
                const v = getVendor(p.vendor_id); const so = getSO(p.so_id);
                return <option key={p.id} value={p.id}>{p.po_no} · {v?.name} · {so?.so_no || '—'} · {inr(p.amount)}</option>;
              })}
            </select>
          </div>
          <div className="field-row mt-2">
            <div className="field"><label className="field-label">Vendor invoice no.</label><input className="input mono" placeholder="optional — auto-numbered if blank" value={invNo} onChange={e => setInvNo(e.target.value)}/></div>
            <div className="field"><label className="field-label">Invoice date</label><input type="date" className="input mono" value={date} onChange={e => setDate(e.target.value)}/></div>
          </div>
          <div className="field mt-2">
            <label className="field-label">Invoice amount</label>
            <input type="number" min="0" className="input mono" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 180 }}/>
          </div>
          {po && (
            <div className="mt-2" style={{ padding: 10, borderRadius: 4, background: within ? 'var(--success-bg)' : 'var(--danger-bg)', fontSize: 12.5 }}>
              PO amount {inr(po.amount)} · invoice {inr(Number(amount) || 0)} · variance <strong>{valueVar >= 0 ? '+' : ''}{valueVar.toFixed(1)}%</strong> — {within ? `within ±${tol}% tolerance` : `OUTSIDE ±${tol}% tolerance (will flag for review)`}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function ThreeWayMatchDetail({ viId }) {
  const { state, navigate, mutate, getVendor, getProduct } = useStore();
  const toast = useToast();
  const vi = state.vendor_invoices.find(v => v.id === viId);
  if (!vi) return <div className="page"><div className="empty">Not found</div></div>;
  const po = state.vendor_pos.find(p => p.id === vi.po_id);
  const grn = state.grns.find(g => g.id === vi.grn_id);
  const v = getVendor(vi.vendor_id);
  const tol = state.config.three_way_value_tolerance != null ? state.config.three_way_value_tolerance : 2;
  const valueVar = po && po.amount ? ((vi.amount - po.amount) / po.amount) * 100 : 0;
  const within = Math.abs(valueVar) <= tol;
  const done = ['Booked', 'Rejected'].includes(vi.status);

  const setStatus = (status, msg, kind, notify) => {
    mutate(s => ({
      ...s,
      vendor_invoices: s.vendor_invoices.map(x => x.id === vi.id ? { ...x, status } : x),
      ...(notify ? { notifications: [{ id: 'n-3w-' + Date.now(), kind: 'po', text: notify, date: TODAY, read: false, role: 'Managing Director' }, ...s.notifications] } : {}),
    }), { action: status.toLowerCase(), entity: 'VendorInvoice', entity_id: vi.id });
    toast(msg, kind || '');
    navigate('three-way');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('three-way')}>
            <Icon name="chevronLeft" size={12}/> 3-Way Match
          </div>
          <h1 className="page-title">3-Way Match — <span className="mono">{vi.vendor_invoice_no}</span>
            <span style={{ marginLeft: 8 }}><span className={`badge dot ${vi.status === 'Booked' ? 'success' : vi.status === 'Rejected' ? 'danger' : 'accent'}`}>{vi.status}</span></span>
          </h1>
          <div className="page-sub">{v?.name} · invoice amount {inr(vi.amount)} · PO {po?.po_no} · GRN {grn?.grn_no || 'pending'}</div>
        </div>
        <div className="page-actions">
          {!done && <button className="btn btn-danger" onClick={() => setStatus('Rejected', 'Invoice rejected · vendor notified', '', `${vi.vendor_invoice_no} REJECTED at 3-way match`)}>Reject</button>}
          {!done && <button className="btn" onClick={() => setStatus('Parked', 'Parked for PM review')}>Park for review</button>}
          {!done && <button className="btn btn-primary" onClick={() => setStatus('Booked', 'Booked in payables · payment scheduled', 'success', `${vi.vendor_invoice_no} booked · ${inrK(vi.amount)} payable to ${v?.name}`)}><Icon name="check" size={13}/>Approve &amp; Book</button>}
          {done && <span className="badge dot">{vi.status}</span>}
        </div>
      </div>

      <div className="mb-2" style={{ padding: 10, background: within ? 'var(--success-bg)' : 'var(--danger-bg)', border: '1px solid', borderColor: within ? 'oklch(0.85 0.06 155)' : 'oklch(0.86 0.08 25)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
        <Icon name={within ? 'check' : 'alert'} size={14} color={within ? 'var(--success)' : 'var(--danger)'}/>
        <span><strong>{within ? 'Within tolerance' : 'Outside tolerance'}</strong> · value variance {valueVar >= 0 ? '+' : ''}{valueVar.toFixed(1)}% (±{tol}% allowed){!within && ' · PM review recommended before booking'}</span>
      </div>

      <div className="compare">
        <div className="compare-h">Field</div>
        <div className="compare-h">Vendor PO · {po?.po_no}</div>
        <div className="compare-h">GRN · {grn?.grn_no || 'Pending'}</div>
        <div className="compare-h">Vendor Invoice · {vi.vendor_invoice_no}</div>

        <div className="compare-row-label">Vendor</div>
        <div>{v?.name}</div><div>{v?.name}</div><div className="ok">{v?.name} <Icon name="check" size={11}/></div>

        <div className="compare-row-label">Date</div>
        <div className="mono">{fmtDate(po?.date)}</div><div className="mono">{grn ? fmtDate(grn.date) : '—'}</div><div className="mono">{fmtDate(vi.date)}</div>

        {(po?.items || []).map((it, i) => {
          const p = getProduct(it.product_id);
          const grnLine = grn?.items.find(x => x.product_id === it.product_id);
          const qtyMatch = !grnLine || grnLine.accepted === it.qty;
          return (
            <Fragment key={i}>
              <div className="compare-row-label">{p ? p.name : it.product_id}</div>
              <div className="num">Qty {it.qty} @ {inr(it.rate)}</div>
              <div className={`num ${qtyMatch ? 'ok' : 'warn'}`}>{grnLine ? `Acc ${grnLine.accepted} / Rej ${grnLine.rejected || 0}` : '—'} {!qtyMatch && <Icon name="alert" size={11}/>}</div>
              <div className="num">{inr(it.qty * it.rate)}</div>
            </Fragment>
          );
        })}

        <div className="compare-row-label">Subtotal</div>
        <div className="num">{inr(po?.amount || 0)}</div>
        <div className="num">—</div>
        <div className={`num ${within ? 'ok' : 'warn'}`}>{inr(vi.amount)}</div>

        <div className="compare-row-label">Variance</div>
        <div>—</div>
        <div>—</div>
        <div className={within ? 'ok' : 'warn'}>{valueVar >= 0 ? '+' : ''}{valueVar.toFixed(1)}% ({within ? `within ±${tol}%` : `outside ±${tol}%`})</div>
      </div>

      <div className="mt-3 split-2">
        <div className="card">
          <div className="card-header"><h3 className="card-title">TDS &amp; RCM</h3></div>
          <div className="card-body">
            <div className="dl">
              <dt>TDS rate</dt><dd>2% (194Q)</dd>
              <dt>TDS amount</dt><dd className="mono">{inr(vi.amount * 0.02)}</dd>
              <dt>Net payable</dt><dd className="mono"><strong>{inr(vi.amount - vi.amount * 0.02)}</strong></dd>
              <dt>RCM applicable</dt><dd>No (vendor is registered)</dd>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Payment Schedule (vendor / payable)</h3></div>
          <div className="card-body">
            <div className="dl">
              <dt>Vendor terms</dt><dd>{v?.terms}</dd>
              <dt>Invoice date</dt><dd className="mono">{fmtDate(vi.date)}</dd>
              <dt>Due date</dt><dd className="mono">{fmtDate(new Date(new Date(vi.date + 'T00:00:00').getTime() + 30 * 86400000).toISOString().slice(0, 10))}</dd>
              <dt>Status</dt><dd>{vi.status === 'Booked' ? <span className="badge success">Scheduled</span> : <span className="badge">{vi.status}</span>}</dd>
            </div>
            <div className="tiny muted mt-2">This is the <strong>vendor payable</strong> — separate from the customer invoice/collections on the Sales Order.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.RecordVendorInvoiceModal = RecordVendorInvoiceModal;

// ===== Sourcing → Vendor PO bridge =====
// In the new flow the vendor is already chosen during the inquiry, so there is
// NO RFQ: once the SO is approved, Purchase generates the Vendor PO(s) straight
// from the inquiry's selected vendors at the sourced prices.

function soSourcing(state, soId) {
  return (state.sourcings || []).find(s => s.converted_so_id === soId) || null;
}

// True required component qty for an SO (bundle_qty × component qty), per product.
function soReqComponents(so) {
  const m = {};
  (so.lines || []).forEach(l => (l.components || []).forEach(c => {
    m[c.product_id] = (m[c.product_id] || 0) + (c.qty || 0) * (l.bundle_qty || 1);
  }));
  // Subtract anything fulfilled from the Master Surplus Pool so we never re-buy it.
  (so.pool_alloc || []).forEach(a => { if (m[a.product_id] != null) m[a.product_id] = m[a.product_id] - (Number(a.qty) || 0); });
  Object.keys(m).forEach(k => { if (m[k] <= 0) delete m[k]; });
  return m;
}

// Group an SO's required components by the vendor chosen during sourcing, each at
// the sourced unit price. Components without a saved pick fall back to the
// cheapest vendor / baseline so nothing is left unsourced.
function vendorPOGroups(state, so, sourcing, getProduct) {
  const req = soReqComponents(so);
  const alloc = (sourcing && sourcing.alloc) || {};
  const picks = (sourcing && sourcing.picks) || {};
  const prices = (sourcing && sourcing.prices) || {};
  const rateFor = (vid, p, pid) => (prices[pid] && prices[pid][vid] != null) ? prices[pid][vid] : (window.vendorUnitPrice ? window.vendorUnitPrice(vid, p) : (p ? p.buy : 0));
  const groups = {};
  Object.entries(req).forEach(([pid, qty]) => {
    const p = getProduct(pid);
    const rows = (alloc[pid] || []).filter(r => (Number(r.qty) || 0) > 0);
    if (rows.length) {                       // multi-vendor split allocation (clamped to required)
      let remaining = qty;
      rows.forEach(r => {
        const take = Math.min(Number(r.qty) || 0, remaining); if (take <= 0) return; remaining -= take;
        (groups[r.vendor_id] = groups[r.vendor_id] || []).push({ product_id: pid, qty: take, rate: (Number(r.rate) || rateFor(r.vendor_id, p, pid)) });
      });
    } else {                                 // single chosen vendor (or cheapest)
      let vid = picks[pid];
      if (!vid && p && window.vendorSuggestions) { const sug = window.vendorSuggestions(p, state.vendors); if (sug[0]) vid = sug[0].vendor.id; }
      if (!vid) return;
      (groups[vid] = groups[vid] || []).push({ product_id: pid, qty, rate: rateFor(vid, p, pid) });
    }
  });
  return Object.entries(groups).map(([vendor_id, items]) => ({
    vendor_id, items, amount: items.reduce((s, i) => s + i.qty * i.rate, 0),
  }));
}

// Create one Vendor PO per selected vendor and move the SO into procurement.
function generateVendorPOsFromSourcing(so, sourcing, ctx) {
  const { state, mutate, toast, navigate, getProduct } = ctx;
  const groups = vendorPOGroups(state, so, sourcing, getProduct);
  if (groups.length === 0) { toast('No vendor selections found to generate POs'); return; }
  const base = 40 + state.vendor_pos.length;
  const expected = (() => { const d = new Date(TODAY); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
  const pos = groups.map((g, i) => ({
    id: 'po-' + Date.now() + '-' + i,
    po_no: `VPO/FY26/${String(base + i).padStart(4, '0')}`,
    so_id: so.id, vendor_id: g.vendor_id, date: TODAY, expected,
    status: g.amount > (state.config.vendor_po_md_threshold ?? 500000) ? 'Pending MD Approval' : 'Issued',
    amount: g.amount, items: g.items, ebill: {}, source: 'sourcing',
  }));
  const anyMD = pos.some(p => p.status === 'Pending MD Approval');
  mutate(s => ({
    ...s,
    vendor_pos: [...pos, ...s.vendor_pos],
    sales_orders: s.sales_orders.map(x => x.id === so.id && x.status === 'Approved' ? { ...x, status: 'Procurement Started' } : x),
    notifications: [
      { id: 'n-genpo-' + Date.now(), kind: 'po', text: `${pos.length} Vendor PO(s) raised for ${so.so_no} from selected vendors${anyMD ? ' · some need MD approval' : ''}`, date: TODAY, read: false, role: anyMD ? 'Managing Director' : 'Stores' },
      ...s.notifications,
    ],
  }), { action: 'generate-po', entity: 'SalesOrder', entity_id: so.id });
  toast(`${pos.length} Vendor PO(s) created from inquiry`, 'success');
  navigate('vendor-pos');
}

window.soSourcing = soSourcing;
window.vendorPOGroups = vendorPOGroups;
window.generateVendorPOsFromSourcing = generateVendorPOsFromSourcing;

// ===== Shared: aggregate an SO's required components =====
function procComponentList(so) {
  const m = {};
  (so.lines || []).forEach(l => (l.components || []).forEach(c => { m[c.product_id] = (m[c.product_id] || 0) + (c.qty || 0); }));
  return Object.entries(m).map(([product_id, qty]) => ({ product_id, qty }));
}

// ===== Create Vendor PO for an SO (Purchase) =====
function CreateVendorPOModal({ soId, vendorId, onClose }) {
  const { state, mutate, getSO, getProduct, getVendor } = useStore();
  const toast = useToast();
  const [so, setSo] = React.useState(soId || '');
  const [vendor, setVendor] = React.useState(vendorId || '');
  const soObj = so ? getSO(so) : null;
  const [items, setItems] = React.useState([]);
  const [expected, setExpected] = React.useState(() => { const d = new Date(TODAY); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); });

  // Default to the vendor chosen during the inquiry (most-picked), if any.
  React.useEffect(() => {
    if (vendorId || !soObj) return;
    const sourcing = window.soSourcing ? window.soSourcing(state, so) : null;
    if (sourcing && sourcing.picks) {
      const counts = {}; Object.values(sourcing.picks).forEach(vid => { counts[vid] = (counts[vid] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top) setVendor(top[0]);
    }
  }, [so]);

  // Load items with sourced prices for the chosen vendor (falls back to baseline).
  React.useEffect(() => {
    if (!soObj) { setItems([]); return; }
    const sourcing = window.soSourcing ? window.soSourcing(state, so) : null;
    const prices = (sourcing && sourcing.prices) || {};
    setItems(procComponentList(soObj).map(c => {
      const p = getProduct(c.product_id);
      let rate = p ? p.buy : 0;
      if (vendor && prices[c.product_id] && prices[c.product_id][vendor] != null) rate = prices[c.product_id][vendor];
      else if (vendor && window.vendorUnitPrice && p) rate = window.vendorUnitPrice(vendor, p);
      return { product_id: c.product_id, qty: c.qty, rate };
    }));
  }, [so, vendor]);

  const setItem = (i, patch) => setItems(its => its.map((x, j) => j === i ? { ...x, ...patch } : x));
  const amount = items.reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0);
  const needsMD = amount > (state.config.vendor_po_md_threshold ?? 500000);

  const submit = () => {
    const real = items.filter(i => i.qty > 0);
    if (!so || !vendor || real.length === 0) { toast('Pick SO, vendor and at least one item'); return; }
    const poNo = `VPO/FY26/${String(40 + state.vendor_pos.length).padStart(4, '0')}`;
    const po = { id: 'po-' + Date.now(), po_no: poNo, so_id: so, vendor_id: vendor, date: TODAY, expected, status: needsMD ? 'Pending MD Approval' : 'Issued', amount, items: real, ebill: {}, source: 'manual' };
    mutate(s => ({
      ...s,
      vendor_pos: [po, ...s.vendor_pos],
      sales_orders: s.sales_orders.map(x => x.id === so && x.status === 'Approved' ? { ...x, status: 'Procurement Started' } : x),
      notifications: [{ id: 'n-po-' + Date.now(), kind: 'po', text: `${poNo} ${needsMD ? 'awaiting MD approval' : 'issued'} → ${getVendor(vendor)?.name} for ${getSO(so)?.so_no} · ${inrK(amount)}`, date: TODAY, read: false, role: needsMD ? 'Managing Director' : 'Stores' }, ...s.notifications],
    }), { action: 'create', entity: 'VendorPO', entity_id: po.id });
    toast(`${poNo} created${needsMD ? ' · sent to MD' : ''}`, 'success');
    onClose();
  };

  return (
    <Modal title="Create Vendor PO" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!so || !vendor || amount <= 0} onClick={submit}>Create PO {amount > 0 ? `· ${inr(amount)}` : ''}</button>
      </>
    }>
      <div className="field-row">
        <div className="field">
          <label className="field-label">For Sales Order *</label>
          <select className="select" value={so} onChange={e => setSo(e.target.value)} disabled={!!soId}>
            <option value="">Pick SO…</option>
            {state.sales_orders.filter(s => !['Closed', 'Cancelled'].includes(s.status)).map(s => <option key={s.id} value={s.id}>{s.so_no} · {s.status}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Vendor *</label>
          <select className="select" value={vendor} onChange={e => setVendor(e.target.value)}>
            <option value="">Pick vendor…</option>
            {state.vendors.map(v => <option key={v.id} value={v.id}>{v.name} · ★ {v.rating}</option>)}
          </select>
        </div>
      </div>
      <div className="field mt-2">
        <label className="field-label">Expected delivery</label>
        <input type="date" className="input mono" value={expected} onChange={e => setExpected(e.target.value)} style={{ width: 180 }}/>
      </div>

      {items.length > 0 ? (
        <div className="card mt-2"><div className="card-body flush">
          <table className="t">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {items.map((it, i) => {
                const p = getProduct(it.product_id) || { name: it.product_id, code: it.product_id };
                return (
                  <tr key={it.product_id}>
                    <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                    <td className="num"><input type="number" className="input mono" min="0" value={it.qty} onChange={e => setItem(i, { qty: parseInt(e.target.value) || 0 })} style={{ width: 64, textAlign: 'right', height: 24 }}/></td>
                    <td className="num"><input type="number" className="input mono" min="0" value={it.rate} onChange={e => setItem(i, { rate: parseInt(e.target.value) || 0 })} style={{ width: 90, textAlign: 'right', height: 24 }}/></td>
                    <td className="num">{inr((it.qty || 0) * (it.rate || 0))}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan="3" className="right small">Total {needsMD && <span style={{ color: 'var(--warning)' }}>· &gt; ₹5L needs MD</span>}</td><td className="num"><strong>{inr(amount)}</strong></td></tr></tfoot>
          </table>
        </div></div>
      ) : <div className="empty mt-2">{so ? 'This SO has no components' : 'Pick an SO to load its components'}</div>}
    </Modal>
  );
}

window.CreateVendorPOModal = CreateVendorPOModal;
window.RFQList = RFQList;
window.VendorPOList = VendorPOList;
window.VendorPODetail = VendorPODetail;
window.GRNList = GRNList;
window.GRNDetail = GRNDetail;
window.GRNNew = GRNNew;
window.ThreeWayMatchList = ThreeWayMatchList;
window.ThreeWayMatchDetail = ThreeWayMatchDetail;
