// ============================================================================
// Assign vendors & prices — a whole BOQ in a handful of clicks
// ============================================================================
// A real order is 100+ lines. Picking a vendor and typing a rate on each one is
// two hundred interactions, so the job has to be done in bulk or it does not get
// done at all.
//
// The customer's own sheet already says how to split it. Its "Po SR No" column
// groups the items into purchase orders — Group A to PO 1, Group B to PO 2 —
// and the importer keeps that on every line. So the unit of work here is the
// GROUP, not the line:
//
//   A. one vendor per group          -> ~3 clicks for the whole order
//   B. remember what we bought last  -> 0 clicks from the second order on
//   C. filter, tick, apply           -> the escape hatch when a group splits
//
// Prices work the same way: what we last paid that vendor is filled in with the
// date it was paid, and a rate typed once can be pushed onto every ticked row.
//
// Nothing here is a guess presented as fact — an auto-filled vendor or price
// always shows where it came from, so Purchase can see what to check.
// ============================================================================

// What we last bought this item as, most recent first. Vendor POs are already
// in memory, so this costs nothing and needs no new table.
function allocLastBuy(state, productId, vendorId) {
  let best = null;
  (state.vendor_pos || []).forEach(po => {
    if (['Rejected', 'Cancelled'].includes(po.status)) return;
    if (vendorId && po.vendor_id !== vendorId) return;
    (po.items || []).forEach(it => {
      if (it.product_id !== productId) return;
      const d = po.date || '';
      if (!best || d > best.date) {
        best = { vendor_id: po.vendor_id, rate: Number(it.rate) || 0, date: d, po_no: po.po_no };
      }
    });
  });
  return best;
}

// One row per (order line, component), so an item appearing in two different
// bundles stays two rows and each keeps its own group. They are merged by
// (vendor, item) only at the moment the POs are generated.
function allocBuildRows(state, so) {
  const onPO = {};
  (state.vendor_pos || []).forEach(po => {
    if (po.so_id !== so.id || ['Rejected', 'Cancelled'].includes(po.status)) return;
    (po.items || []).forEach(it => { onPO[it.product_id] = (onPO[it.product_id] || 0) + (Number(it.qty) || 0); });
  });
  const pooled = {};
  (so.pool_alloc || []).forEach(a => { pooled[a.product_id] = (pooled[a.product_id] || 0) + (Number(a.qty) || 0); });

  const rows = [];
  (so.lines || []).forEach((l, li) => {
    const ref = l.customer_ref || {};
    // The customer's own PO grouping first; then the equipment type; then the line.
    const groupKey = ref.po_sr ? ('po:' + ref.po_sr) : (ref.equip || l.client_name || ('line:' + (l.id || li)));
    const groupLabel = ref.po_sr
      ? `PO Sr ${ref.po_sr}${ref.group ? ' · ' + String(ref.group).replace(/^Group\s*/i, 'Group ') : ''}`
      : (ref.equip || l.client_name || `Line ${li + 1}`);
    (l.components || []).forEach((c, ci) => {
      const need = (Number(c.qty) || 0) * (Number(l.bundle_qty) || 1);
      if (need <= 0) return;
      rows.push({
        key: `${l.id || li}:${c.product_id}:${ci}`,
        line_id: l.id, product_id: c.product_id,
        groupKey, groupLabel,
        equip: ref.equip || l.client_name || '',
        need,
        vendor_id: '', rate: 0, rateSource: '', vendorSource: '',
      });
    });
  });

  // Take off what is already on a PO or came from the pool, oldest row first,
  // so re-opening this screen only ever offers what is still to be bought.
  const left = {};
  rows.forEach(r => { left[r.product_id] = (left[r.product_id] || 0); });
  Object.keys(left).forEach(pid => {
    left[pid] = (onPO[pid] || 0) + (pooled[pid] || 0);
  });
  const out = [];
  rows.forEach(r => {
    let covered = Math.min(left[r.product_id] || 0, r.need);
    left[r.product_id] = (left[r.product_id] || 0) - covered;
    const qty = r.need - covered;
    if (qty > 0) out.push({ ...r, qty });
  });
  return out;
}

window.allocLastBuy = allocLastBuy;
window.allocBuildRows = allocBuildRows;

// ===========================================================================
function VendorAllocator({ soId, onClose }) {
  const { state, mutate, navigate, getSO, getProduct, getVendor } = useStore();
  const toast = useToast();
  const so = getSO(soId);
  const vendors = state.vendors || [];

  const [rows, setRows] = React.useState(() => {
    if (!so) return [];
    // B — pre-fill from history. Silent auto-fill is how wrong data gets
    // ordered, so each filled value records where it came from and the row says so.
    return allocBuildRows(state, so).map(r => {
      const last = allocLastBuy(state, r.product_id, null);
      if (!last) return r;
      return { ...r, vendor_id: last.vendor_id, rate: last.rate,
               vendorSource: last.po_no, rateSource: last.date };
    });
  });
  const [sel, setSel] = React.useState({});
  const [q, setQ] = React.useState('');
  const [bulkVendor, setBulkVendor] = React.useState('');
  const [bulkRate, setBulkRate] = React.useState('');

  if (!so) return null;

  const visible = rows.filter(r => {
    if (!q.trim()) return true;
    const p = getProduct(r.product_id) || {};
    return `${p.name || ''} ${p.code || ''} ${r.groupLabel}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const groups = [];
  const byGroup = {};
  visible.forEach(r => {
    if (!byGroup[r.groupKey]) { byGroup[r.groupKey] = { key: r.groupKey, label: r.groupLabel, rows: [] }; groups.push(byGroup[r.groupKey]); }
    byGroup[r.groupKey].rows.push(r);
  });

  const patch = (keys, p) => {
    const set = new Set(keys);
    setRows(rs => rs.map(r => {
      if (!set.has(r.key)) return r;
      const next = { ...r, ...p };
      // Changing vendor re-prices from what THAT vendor last charged.
      if (p.vendor_id !== undefined && p.rate === undefined) {
        const last = allocLastBuy(state, r.product_id, p.vendor_id);
        next.rate = last ? last.rate : 0;
        next.rateSource = last ? last.date : '';
        next.vendorSource = 'manual';
      }
      if (p.rate !== undefined) next.rateSource = 'manual';
      return next;
    }));
  };

  const selKeys = Object.keys(sel).filter(k => sel[k]);
  const toggleAllVisible = () => {
    const all = visible.every(r => sel[r.key]);
    const next = { ...sel };
    visible.forEach(r => { if (all) delete next[r.key]; else next[r.key] = true; });
    setSel(next);
  };

  const assigned = rows.filter(r => r.vendor_id).length;
  const priced = rows.filter(r => r.rate > 0).length;
  const vendorCount = new Set(rows.filter(r => r.vendor_id).map(r => r.vendor_id)).size;
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);

  const generate = () => {
    const ready = rows.filter(r => r.vendor_id && r.qty > 0);
    if (!ready.length) { toast('Assign a vendor to at least one item'); return; }
    // Merge by (vendor, item) — the same item in two groups going to the same
    // vendor belongs on one PO line, not two.
    const alloc = {};
    ready.forEach(r => {
      const list = (alloc[r.product_id] = alloc[r.product_id] || []);
      const hit = list.find(x => x.vendor_id === r.vendor_id && Number(x.rate) === Number(r.rate));
      if (hit) hit.qty += r.qty;
      else list.push({ vendor_id: r.vendor_id, qty: r.qty, rate: Number(r.rate) || 0 });
    });
    window.generateSplitVendorPOs(so, alloc, { state, mutate, toast, navigate, getVendor });
    onClose();
  };

  const unassigned = rows.length - assigned;

  return (
    <Modal title={`Assign vendors & prices — ${so.so_no}`} size="xl" onClose={onClose} footer={
      <>
        <span className="tiny muted" style={{ marginRight: 'auto' }}>
          {rows.length} item(s) · {assigned} with a vendor{unassigned ? ` · ${unassigned} still to assign` : ''} · {priced} priced
        </span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!assigned} onClick={generate}>
          <Icon name="check" size={13}/>Generate {vendorCount} PO(s) · {inr(total)}
        </button>
      </>
    }>
      {rows.length === 0 ? (
        <div className="empty">Everything on this order is already on a purchase order.</div>
      ) : (
        <>
          {/* C — filter, tick, apply to the selection */}
          <div className="card mb-2"><div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px' }}>
            <input className="input" placeholder="Filter items…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 190, height: 28 }}/>
            <button className="btn btn-sm" onClick={toggleAllVisible}>
              {visible.length && visible.every(r => sel[r.key]) ? 'Clear' : 'Select'} {visible.length} shown
            </button>
            <span className="tiny muted" style={{ minWidth: 78 }}>{selKeys.length} selected</span>
            <span style={{ width: 1, height: 22, background: 'var(--border)' }}/>
            <select className="select" value={bulkVendor} onChange={e => setBulkVendor(e.target.value)} style={{ height: 28, width: 180 }}>
              <option value="">Set vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button className="btn btn-sm" disabled={!bulkVendor || !selKeys.length}
              onClick={() => patch(selKeys, { vendor_id: bulkVendor })}>Apply</button>
            <span style={{ width: 1, height: 22, background: 'var(--border)' }}/>
            <input className="input num" type="number" min="0" placeholder="Rate ₹" value={bulkRate}
              onChange={e => setBulkRate(e.target.value)} style={{ width: 110, height: 28 }}/>
            <button className="btn btn-sm" disabled={bulkRate === '' || !selKeys.length}
              onClick={() => patch(selKeys, { rate: Number(bulkRate) || 0 })}>Apply to {selKeys.length}</button>
          </div></div>

          <div className="card">
            <div className="card-body flush" style={{ maxHeight: 430, overflow: 'auto' }}>
              <table className="t">
                <thead><tr>
                  <th style={{ width: 28 }}></th>
                  <th>Item</th>
                  <th className="num" style={{ width: 64 }}>Qty</th>
                  <th style={{ width: 190 }}>Vendor</th>
                  <th className="num" style={{ width: 130 }}>Unit rate</th>
                  <th className="num" style={{ width: 110 }}>Amount</th>
                </tr></thead>
                <tbody>
                  {groups.map(g => {
                    const gk = g.rows.map(r => r.key);
                    const gTotal = g.rows.reduce((a, r) => a + r.qty * (Number(r.rate) || 0), 0);
                    const gv = new Set(g.rows.map(r => r.vendor_id).filter(Boolean));
                    return (
                      <React.Fragment key={g.key}>
                        {/* A — one vendor for the whole group, as the sheet intends */}
                        <tr style={{ background: 'var(--bg-subtle)' }}>
                          <td>
                            <input type="checkbox" checked={g.rows.every(r => sel[r.key])}
                              onChange={() => {
                                const all = g.rows.every(r => sel[r.key]);
                                setSel(s => { const n = { ...s }; gk.forEach(k => all ? delete n[k] : n[k] = true); return n; });
                              }}/>
                          </td>
                          <td className="small" style={{ fontWeight: 600 }}>
                            {g.label}
                            <span className="tiny muted" style={{ fontWeight: 400 }}> · {g.rows.length} item(s)
                              {gv.size > 1 ? ` · ${gv.size} vendors` : ''}</span>
                          </td>
                          <td className="num tiny muted">{g.rows.reduce((a, r) => a + r.qty, 0)}</td>
                          <td>
                            <select className="select" style={{ height: 26, fontSize: 11.5, width: '100%' }}
                              value={gv.size === 1 ? [...gv][0] : ''}
                              onChange={e => patch(gk, { vendor_id: e.target.value })}>
                              <option value="">Set for whole group…</option>
                              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                          </td>
                          <td></td>
                          <td className="num small" style={{ fontWeight: 600 }}>{inr(gTotal)}</td>
                        </tr>
                        {g.rows.map(r => {
                          const p = getProduct(r.product_id) || {};
                          const lastAny = allocLastBuy(state, r.product_id, r.vendor_id || null);
                          return (
                            <tr key={r.key}>
                              <td><input type="checkbox" checked={!!sel[r.key]}
                                onChange={() => setSel(s => ({ ...s, [r.key]: !s[r.key] }))}/></td>
                              <td>
                                <div className="small trunc" style={{ maxWidth: 330 }}>{p.name}</div>
                                <div className="tiny muted mono">{p.code}</div>
                              </td>
                              <td className="num mono small">{r.qty}</td>
                              <td>
                                <select className="select" style={{ height: 26, fontSize: 11.5, width: '100%' }}
                                  value={r.vendor_id} onChange={e => patch([r.key], { vendor_id: e.target.value })}>
                                  <option value="">— pick —</option>
                                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                                {r.vendorSource && r.vendorSource !== 'manual' &&
                                  <div className="tiny muted" title="Filled in from the last purchase order for this item">from {r.vendorSource}</div>}
                              </td>
                              <td className="num">
                                <input className="input num" type="number" min="0" value={r.rate}
                                  onChange={e => patch([r.key], { rate: Number(e.target.value) || 0 })}
                                  style={{ height: 26, width: '100%', textAlign: 'right' }}/>
                                {r.rateSource && r.rateSource !== 'manual'
                                  ? <div className="tiny muted" title="What we last paid this vendor">last paid {fmtDate(r.rateSource)}</div>
                                  : (!r.rate && lastAny
                                      ? <div className="tiny" style={{ color: 'var(--warning)' }}>no price yet</div>
                                      : null)}
                              </td>
                              <td className="num mono small">{inr(r.qty * (Number(r.rate) || 0))}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tiny muted mt-2">
            One PO is created per vendor. The same item in two groups going to the same vendor
            at the same rate is merged onto a single PO line.
          </div>
        </>
      )}
    </Modal>
  );
}

window.VendorAllocator = VendorAllocator;

// Opened from the Vendor POs list: which order are we buying for?
// Orders already fully on PO are shown as done rather than hidden, so nobody
// wonders where an order went.
function AllocSOPicker({ onClose, onPick }) {
  const { state, getCustomer } = useStore();
  const orders = (state.sales_orders || []).filter(s => !['Cancelled', 'Closed', 'Fully Paid'].includes(s.status));
  return (
    <Modal title="Assign vendors & prices" size="lg" onClose={onClose} footer={
      <button className="btn" onClick={onClose}>Cancel</button>
    }>
      <div className="tiny muted mb-2">Pick the order to buy for. Vendors and prices are set for every line at once.</div>
      {orders.length === 0 ? <div className="empty">No open orders.</div> : (
        <table className="t">
          <thead><tr><th>Order</th><th>Customer</th><th className="num">Still to buy</th><th></th></tr></thead>
          <tbody>
            {orders.map(so => {
              const left = allocBuildRows(state, so);
              const units = left.reduce((a, r) => a + r.qty, 0);
              return (
                <tr key={so.id}>
                  <td className="mono small">{so.so_no}<div className="tiny muted">{so.status}</div></td>
                  <td className="small">{(getCustomer(so.customer_id) || {}).name || '—'}</td>
                  <td className="num small">{units ? `${left.length} item(s) · ${units} unit(s)` : <span className="muted">all on PO</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-primary" disabled={!units} onClick={() => onPick(so.id)}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

window.AllocSOPicker = AllocSOPicker;
