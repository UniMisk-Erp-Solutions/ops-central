// OP Central — Virtual Godown, Master Surplus Pool, Cross-SO Transfer

function VirtualGodownList() {
  const { state, navigate, getCustomer, soSubtotal, getProduct, getUser, currentUser } = useStore();
  const role = getUser(currentUser)?.role;
  const orders = state.sales_orders.filter(s => !['Closed','Cancelled'].includes(s.status))
    .filter(s => role !== 'Supervisor' || (s.extra && s.extra.implementation && s.extra.implementation.supervisor_id === currentUser));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Virtual Godowns</h1>
          <div className="page-sub">One inventory bucket per SO · isolated from other orders · checks Master Pool first</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate('pool')}><Icon name="layers" size={13}/>Master Pool</button>
          <button className="btn" onClick={() => navigate('transfers')}><Icon name="arrowLeftRight" size={13}/>Transfers</button>
        </div>
      </div>

      <div className="kpi-grid mb-3">
        <div className="kpi">
          <div className="kpi-label">Active VGs</div>
          <div className="kpi-value">{orders.length}</div>
          <div className="kpi-delta">Per open SO</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total Locked Value</div>
          <div className="kpi-value">{inrK(orders.reduce((s,o) => s + soSubtotal(o), 0))}</div>
          <div className="kpi-delta">Across active VGs</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Pool SKUs</div>
          <div className="kpi-value">{state.pool.length}</div>
          <div className="kpi-delta">Available for next SO</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Pending Transfers</div>
          <div className="kpi-value">{state.transfer_requests.filter(t => t.status === 'Pending').length}</div>
          <div className="kpi-delta">Cross-SO requests</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="card-title">Active Virtual Godowns</h3></div>
        <div className="card-body flush">
          <table className="t">
            <thead><tr>
              <th>SO No</th><th>Customer</th><th>Status</th><th className="num">Components</th>
              <th className="num">Pool-fulfilled</th><th className="num">Procured</th><th className="num">Locked Value</th><th></th>
            </tr></thead>
            <tbody>
              {orders.map(so => {
                const cust = getCustomer(so.customer_id);
                const totalComp = so.lines.reduce((sum, l) => sum + l.components.reduce((s,c) => s + c.qty, 0), 0);
                // mock: assume some % from pool
                const fromPool = so.id === 'so-002' ? 4 : so.id === 'so-001' ? 0 : Math.floor(totalComp * 0.15);
                const procured = totalComp - fromPool;
                return (
                  <tr key={so.id} onClick={() => navigate(`godown/${so.id}`)} style={{ cursor: 'pointer' }}>
                    <td><a className="mono">{so.so_no}</a></td>
                    <td className="trunc">{cust.name}</td>
                    <td><StatusBadge status={so.status}/></td>
                    <td className="num">{totalComp}</td>
                    <td className="num"><span className="badge accent">{fromPool}</span></td>
                    <td className="num">{procured}</td>
                    <td className="num">{inr(soSubtotal(so))}</td>
                    <td><Icon name="chevronRight" size={12}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Centralised receiving — tick what physically arrived for this SO and post it.
// Reuses postReceiptForPO (GRN + vendor invoice + pool + e-Bill) per affected PO,
// then raises ONE consolidated client invoice (bundle-level, BOM excluded).
function VGReceivePanel({ so }) {
  const { state, mutate, addToPool, getProduct, getVendor, getUser, currentUser } = useStore();
  const toast = useToast();
  const role = getUser(currentUser)?.role;
  const canReceive = ['Stores', 'Purchase', 'Project Manager', 'Org Admin'].includes(role);

  const soPOs = (state.vendor_pos || []).filter(p => p.so_id === so.id && !['Pending MD Approval', 'Rejected', 'On Hold'].includes(p.status));
  const acceptedKey = {};
  (state.grns || []).forEach(g => (g.items || []).forEach(it => { acceptedKey[g.po_id + '|' + it.product_id] = (acceptedKey[g.po_id + '|' + it.product_id] || 0) + (it.accepted || 0); }));
  const outstanding = [];
  soPOs.forEach(po => (po.items || []).forEach(it => {
    const recv = acceptedKey[po.id + '|' + it.product_id] || 0;
    const remaining = Math.max(0, (it.qty || 0) - recv);
    if (remaining > 0) outstanding.push({ key: po.id + '|' + it.product_id, po, product_id: it.product_id, ordered: it.qty, received: recv, remaining, rate: it.rate });
  }));

  const [sel, setSel] = React.useState({});   // key -> receiveNow qty (presence = checked)
  const [busy, setBusy] = React.useState(false);
  const checkedKeys = Object.keys(sel).filter(k => sel[k] != null);
  const toggle = (row) => setSel(s => { const n = { ...s }; if (n[row.key] != null) delete n[row.key]; else n[row.key] = row.remaining; return n; });
  const setQty = (row, v) => setSel(s => ({ ...s, [row.key]: Math.max(0, Math.min(Number(v) || 0, row.remaining)) }));
  const allChecked = outstanding.length > 0 && outstanding.every(r => sel[r.key] != null);
  const selectAll = () => setSel(allChecked ? {} : Object.fromEntries(outstanding.map(r => [r.key, r.remaining])));

  if (!outstanding.length) {
    return (
      <div className="card"><div className="card-body" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Icon name="check" size={16} color="var(--success)"/>
        <div><strong className="small">All material received</strong><div className="tiny muted">Every ordered item for this SO has been received into the Virtual Godown.</div></div>
      </div></div>
    );
  }

  const markReceived = async () => {
    const rows = outstanding.filter(r => sel[r.key] != null && sel[r.key] > 0);
    if (!rows.length) { toast('Tick the items you received (and set a quantity)'); return; }
    setBusy(true);
    const byPo = {};
    rows.forEach(r => { (byPo[r.po.id] = byPo[r.po.id] || { po: r.po, items: [] }).items.push(r); });
    const ctx = { state, mutate, toast: null, addToPool, getProduct, getVendor, currentUser, getUser };
    let i = 0, posted = 0, units = 0;
    for (const { po, items } of Object.values(byPo)) {
      const recvItems = items.map(r => ({ product_id: r.product_id, qty: r.ordered, rate: r.rate, received: sel[r.key], rejected: 0, to_pool: 0 }));
      units += recvItems.reduce((s, x) => s + (x.received || 0), 0);
      await window.postReceiptForPO(po, recvItems, { grnDate: TODAY, lr: '', seqOffset: i, skipInvoice: true }, ctx);
      i++; posted++;
    }
    // One consolidated client partial/final invoice for everything now receivable.
    if (window.raiseSOInvoice) window.raiseSOInvoice(so.id, { mode: 'bundle' }, { mutate, toast: null, currentUser, getUser, getProduct });
    setBusy(false); setSel({});
    toast(`Received ${units} unit(s) · ${posted} GRN(s) posted · client invoice auto-raised`, 'success');
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Receive material</h3>
        <span className="card-sub">Tick what arrived → auto GRN + client invoice</span>
      </div>
      <div className="card-body flush">
        <table className="t">
          <thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" checked={allChecked} onChange={selectAll} title="Select all"/></th>
            <th>Component</th><th>Vendor PO</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Remaining</th><th className="num">Receive now</th>
          </tr></thead>
          <tbody>
            {outstanding.map(r => {
              const p = getProduct(r.product_id) || { name: r.product_id, code: r.product_id };
              const on = sel[r.key] != null;
              return (
                <tr key={r.key} style={{ opacity: on ? 1 : 0.85 }}>
                  <td><input type="checkbox" checked={on} onChange={() => toggle(r)}/></td>
                  <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                  <td className="mono small">{r.po.po_no}<div className="tiny muted">{getVendor(r.po.vendor_id)?.name || ''}</div></td>
                  <td className="num">{r.ordered}</td>
                  <td className="num">{r.received || <span className="muted">0</span>}</td>
                  <td className="num"><strong style={{ color: 'var(--warning)' }}>{r.remaining}</strong></td>
                  <td className="num"><input type="number" min="0" max={r.remaining} className="input mono" disabled={!on} value={on ? sel[r.key] : ''} onChange={e => setQty(r, e.target.value)} style={{ width: 64, textAlign: 'right', height: 26 }}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border)' }}>
        <span className="tiny muted grow">{checkedKeys.length} of {outstanding.length} selected · posting creates the GRN, books the vendor invoice, routes surplus to pool, and raises the client partial invoice (BOM components never appear on the client invoice).</span>
        {canReceive
          ? <button className="btn btn-primary" disabled={busy || checkedKeys.length === 0} onClick={markReceived}><Icon name="check" size={13}/>{busy ? 'Posting…' : `Mark Received (${checkedKeys.length})`}</button>
          : <span className="tiny muted">Only Stores / Purchase / PM can receive.</span>}
      </div>
    </div>
  );
}

// Receive BOM components directly from the VG. picks: [{product_id, qty}].
// Each pick is filled against this SO's existing receivable vendor POs; any
// shortfall auto-creates ONE vendor PO (sourced vendor if known, else best
// guess) so a GRN always posts and the 3-way match stays intact. Then a single
// consolidated client invoice is raised. Returns a short summary.
async function vgReceiveComponents(so, picks, ctx) {
  const { state, mutate, getProduct } = ctx;
  const soPOs = (state.vendor_pos || []).filter(p => p.so_id === so.id && !['Pending MD Approval', 'Rejected', 'On Hold'].includes(p.status));
  const acceptedKey = {};
  (state.grns || []).forEach(g => (g.items || []).forEach(it => { acceptedKey[g.po_id + '|' + it.product_id] = (acceptedKey[g.po_id + '|' + it.product_id] || 0) + (it.accepted || 0); }));

  const perPo = {};            // po.id -> { po, items:[{product_id, qty, rate, received}] }
  const newLines = [];         // shortfall lines for an auto PO
  for (const pick of picks) {
    let need = Math.max(0, pick.qty);
    for (const po of soPOs) {
      if (need <= 0) break;
      const line = (po.items || []).find(it => it.product_id === pick.product_id);
      if (!line) continue;
      const cap = (line.qty || 0) - (acceptedKey[po.id + '|' + pick.product_id] || 0);
      if (cap <= 0) continue;
      const take = Math.min(need, cap);
      (perPo[po.id] = perPo[po.id] || { po, items: [] }).items.push({ product_id: pick.product_id, qty: line.qty, rate: line.rate, received: take });
      acceptedKey[po.id + '|' + pick.product_id] = (acceptedKey[po.id + '|' + pick.product_id] || 0) + take;   // reserve
      need -= take;
    }
    if (need > 0) { const p = getProduct(pick.product_id); newLines.push({ product_id: pick.product_id, qty: need, rate: p ? (p.buy || 0) : 0 }); }
  }

  // Auto-create one PO for any shortfall (so receiving never blocks on missing POs).
  let createdPONeedsMD = false;
  if (newLines.length) {
    const sourcing = window.soSourcing ? window.soSourcing(state, so.id) : null;
    let vendorId = '';
    if (sourcing && sourcing.picks) { const counts = {}; Object.values(sourcing.picks).forEach(v => { counts[v] = (counts[v] || 0) + 1; }); const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; vendorId = top ? top[0] : ''; }
    if (!vendorId) vendorId = (state.vendors[0] && state.vendors[0].id) || '';
    const amount = newLines.reduce((s, l) => s + l.qty * l.rate, 0);
    const mdT = state.config.vendor_po_md_threshold != null ? state.config.vendor_po_md_threshold : 500000;
    const needsMD = amount > mdT;
    createdPONeedsMD = needsMD;
    const po = { id: 'po-' + Date.now() + '-vg', po_no: `VPO/FY26/${String(40 + state.vendor_pos.length).padStart(4, '0')}`, so_id: so.id, vendor_id: vendorId, date: TODAY, expected: TODAY, status: needsMD ? 'Pending MD Approval' : 'Issued', amount, items: newLines.map(l => ({ product_id: l.product_id, qty: l.qty, rate: l.rate })), ebill: {}, source: 'vg-receive' };
    mutate(s => ({ ...s, vendor_pos: [po, ...s.vendor_pos], notifications: [{ id: 'n-vgpo-' + Date.now(), kind: 'po', text: `${po.po_no} auto-created from VG receive for ${so.so_no}${needsMD ? ' · needs MD approval before receiving' : ''}`, date: TODAY, read: false, role: needsMD ? 'Managing Director' : 'Stores' }, ...s.notifications] }), { action: 'create', entity: 'VendorPO', entity_id: po.id });
    if (!needsMD) perPo[po.id] = { po, items: po.items.map(l => ({ product_id: l.product_id, qty: l.qty, rate: l.rate, received: l.qty })) };
  }

  let i = 0, posted = 0, units = 0;
  for (const grp of Object.values(perPo)) {
    const items = grp.items.map(it => ({ product_id: it.product_id, qty: it.qty, rate: it.rate, received: it.received, rejected: 0, to_pool: 0 }));
    units += items.reduce((s, x) => s + (x.received || 0), 0);
    await window.postReceiptForPO(grp.po, items, { grnDate: TODAY, lr: '', seqOffset: i, skipInvoice: true }, ctx);
    i++; posted++;
  }
  if (posted && window.autoInvoiceSO) window.autoInvoiceSO(so.id, { mutate, toast: null, currentUser: ctx.currentUser, getUser: ctx.getUser, getProduct });
  return { posted, units, createdPONeedsMD };
}

// Add components to this SO from the Master Pool — smart suggestions (pool stock
// the SO's BOM needs) + free search. Allocates pool stock to the SO (pool_alloc)
// and decrements the pool. Replaces the old New-SO pool-reuse step.
function VGAddFromPoolPanel({ so }) {
  const { state, mutate, consumeFromPool, getProduct, getUser, currentUser } = useStore();
  const toast = useToast();
  const role = getUser(currentUser)?.role;
  const canEdit = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const [q, setQ] = React.useState('');
  const [qty, setQty] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  if (!canEdit) return null;

  const poolByProd = {};
  (state.pool || []).forEach(p => { const b = (poolByProd[p.product_id] = poolByProd[p.product_id] || { qty: 0, srcs: [] }); b.qty += Number(p.qty) || 0; b.srcs.push({ id: p.id, qty: Number(p.qty) || 0, date: p.received_date }); });
  const need = {}; (so.lines || []).forEach(l => (l.components || []).forEach(c => { need[c.product_id] = (need[c.product_id] || 0) + (c.qty || 0) * (l.bundle_qty || 1); }));
  const _impl = window.soImplReq ? window.soImplReq(so) : {}; Object.keys(_impl).forEach(pid => { need[pid] = (need[pid] || 0) + _impl[pid]; });   // include implementation BOQ
  // What this SO already holds (GRN-accepted + committed pool − diverted), so we
  // only suggest filling the real remaining gap, ranked by cost saved.
  const soPoIds = new Set((state.vendor_pos || []).filter(p => p.so_id === so.id).map(p => p.id));
  const have = {};
  (state.grns || []).forEach(g => { if (soPoIds.has(g.po_id)) (g.items || []).forEach(it => { have[it.product_id] = (have[it.product_id] || 0) + (it.accepted || 0); }); });
  (so.pool_alloc || []).forEach(a => { have[a.product_id] = (have[a.product_id] || 0) + (Number(a.qty) || 0); });
  const out = window.soPoolOut ? window.soPoolOut(so) : {};
  Object.keys(out).forEach(pid => { have[pid] = Math.max(0, (have[pid] || 0) - out[pid]); });
  const suggestions = Object.keys(need).map(pid => {
    const inPool = (poolByProd[pid] && poolByProd[pid].qty) || 0;
    const gap = Math.max(0, need[pid] - (have[pid] || 0));
    const fill = Math.min(gap, inPool);
    const p = getProduct(pid);
    return { pid, need: need[pid], gap, inPool, fill, product: p, save: fill * ((p && p.buy) || 0) };
  }).filter(s => s.fill > 0).sort((a, b) => b.save - a.save);
  const results = q.trim() ? Object.keys(poolByProd).filter(pid => poolByProd[pid].qty > 0).map(pid => ({ pid, inPool: poolByProd[pid].qty, product: getProduct(pid) })).filter(x => ((x.product && x.product.name) || x.pid).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];

  const add = async (pid, want) => {
    const inPool = (poolByProd[pid] && poolByProd[pid].qty) || 0;
    const n = Math.max(0, Math.min(Number(want) || 0, inPool));
    if (n <= 0) { toast('Enter a quantity available in the pool'); return; }
    const srcs = [...((poolByProd[pid] && poolByProd[pid].srcs) || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let rem = n; const consume = []; for (const s of srcs) { if (rem <= 0) break; const take = Math.min(rem, s.qty); if (take > 0) { consume.push({ id: s.id, qty: take }); rem -= take; } }
    const p = getProduct(pid);
    setBusy(true);
    mutate(s => ({
      ...s,
      sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, pool_alloc: [...(x.pool_alloc || []), { product_id: pid, qty: n, name: p ? p.name : pid }] } : x),
      notifications: [{ id: 'n-pa-' + Date.now(), kind: 'transfer', text: `${n}× ${p ? p.name : pid} allocated to ${so.so_no} from Master Pool`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications],
    }), { action: 'pool-allocate', entity: 'SalesOrder', entity_id: so.id });
    await consumeFromPool(consume);
    setBusy(false); setQty(m => ({ ...m, [pid]: '' })); setQ('');
    toast(`Added ${n}× ${p ? p.name : pid} from Master Pool`, 'success');
  };

  return (
    <div className="card">
      <div className="card-header"><h3 className="card-title">Add from Master Pool</h3><span className="card-sub">Smart suggestions + search</span></div>
      <div className="card-body">
        {suggestions.length > 0 && (
          <div className="mb-2">
            <div className="tiny muted mb-1">Suggested for this SO · fills the remaining gap, best savings first</div>
            {suggestions.map(s => (
              <div key={s.pid} className="queue-item">
                <div className="grow"><div className="small">{s.product ? s.product.name : s.pid}</div><div className="tiny muted">gap {s.gap} · {s.inPool} in pool · saves ~{inr(s.save)}</div></div>
                <input type="number" min="0" max={Math.min(s.gap, s.inPool)} className="input mono" placeholder={String(s.fill)} value={qty[s.pid] || ''} onChange={e => setQty(m => ({ ...m, [s.pid]: e.target.value }))} style={{ width: 58, height: 26, textAlign: 'right' }}/>
                <button className="btn btn-sm" disabled={busy} onClick={() => add(s.pid, qty[s.pid] || s.fill)}><Icon name="plus" size={11}/>Add</button>
              </div>
            ))}
          </div>
        )}
        <div className="field"><label className="field-label">Search the pool</label>
          <input className="input" placeholder="Search any pool component…" value={q} onChange={e => setQ(e.target.value)}/>
        </div>
        {results.map(r => (
          <div key={r.pid} className="queue-item">
            <div className="grow"><div className="small">{r.product ? r.product.name : r.pid}</div><div className="tiny muted">{r.inPool} in pool</div></div>
            <input type="number" min="0" max={r.inPool} className="input mono" value={qty[r.pid] || ''} onChange={e => setQty(m => ({ ...m, [r.pid]: e.target.value }))} style={{ width: 58, height: 26, textAlign: 'right' }}/>
            <button className="btn btn-sm" disabled={busy} onClick={() => add(r.pid, qty[r.pid])}><Icon name="plus" size={11}/>Add</button>
          </div>
        ))}
        {q.trim() && results.length === 0 && <div className="tiny muted mt-1">No matching pool stock.</div>}
      </div>
    </div>
  );
}

// Client invoices saved against this SO (partial + final) — shown in the VG too.
function VGInvoicesCard({ so }) {
  const { navigate } = useStore();
  const invoices = so.invoices || [];
  if (!invoices.length && !so.invoice_no) return null;
  return (
    <div className="card">
      <div className="card-header"><h3 className="card-title">Client Invoices</h3><span className="card-sub">{invoices.length || (so.invoice_no ? 1 : 0)} saved</span></div>
      <div className="card-body flush">
        {invoices.length ? invoices.map(inv => (
          <div key={inv.id} className="queue-item" style={{ cursor: 'pointer' }} onClick={() => navigate(`invoices/${so.id}/${inv.id}`)}>
            <Icon name="receipt" size={14} color={inv.consolidated || inv.type === 'Final' ? 'var(--success)' : 'var(--accent)'}/>
            <div className="grow"><div className="small mono">{inv.no}</div><div className="tiny muted">{inv.consolidated ? 'Consolidated' : inv.type} · qty {(inv.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0)} · {fmtDate(inv.date)}</div></div>
            <span className="mono small">{inr(inv.total)}</span>
          </div>
        )) : (
          <div className="queue-item" style={{ cursor: 'pointer' }} onClick={() => navigate(`invoices/${so.id}`)}>
            <Icon name="receipt" size={14}/><div className="grow"><div className="small mono">{so.invoice_no}</div><div className="tiny muted">{fmtDate(so.invoice_date)}</div></div>
            <span className="mono small">{inr(so.invoice_amount || 0)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Purchase/PM can divert held stock (procured or pool-allocated) from this SO's
// VG to the shared Master Pool — at any time, even after dispatch/invoice. The
// pool gains the units, the SO's bill is auto-reduced (so the client isn't billed
// for what left), and every connected view recomputes in real time.
function VGPoolSendPanel({ so }) {
  const { state, mutate, addToPool, getProduct, getUser, currentUser } = useStore();
  const toast = useToast();
  const role = getUser(currentUser)?.role;
  const canPool = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);

  const soPoIds = new Set((state.vendor_pos || []).filter(p => p.so_id === so.id).map(p => p.id));
  const recv = {};
  (state.grns || []).forEach(g => { if (soPoIds.has(g.po_id)) (g.items || []).forEach(it => { recv[it.product_id] = (recv[it.product_id] || 0) + (it.accepted || 0); }); });
  (so.pool_alloc || []).forEach(a => { recv[a.product_id] = (recv[a.product_id] || 0) + (Number(a.qty) || 0); });
  const out = window.soPoolOut ? window.soPoolOut(so) : {};
  const held = Object.keys(recv).map(pid => ({ product_id: pid, held: Math.max(0, (recv[pid] || 0) - (out[pid] || 0)) })).filter(x => x.held > 0);

  const [sel, setSel] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  const checked = Object.keys(sel).filter(k => sel[k] != null);
  const toggle = (h) => setSel(s => { const n = { ...s }; if (n[h.product_id] != null) delete n[h.product_id]; else n[h.product_id] = h.held; return n; });
  const setQty = (h, v) => setSel(s => ({ ...s, [h.product_id]: Math.max(0, Math.min(Number(v) || 0, h.held)) }));
  const allChecked = held.length > 0 && held.every(h => sel[h.product_id] != null);
  const selectAll = () => setSel(allChecked ? {} : Object.fromEntries(held.map(h => [h.product_id, h.held])));

  if (!canPool || !held.length) return null;

  const send = async () => {
    const rows = held.filter(h => sel[h.product_id] != null && sel[h.product_id] > 0).map(h => ({ product_id: h.product_id, qty: Math.min(sel[h.product_id], h.held) }));
    if (!rows.length) { toast('Tick items and set a quantity to send to the pool'); return; }
    setBusy(true);
    const ts = TODAY;
    const poolRows = rows.map(r => ({ product_id: r.product_id, qty: r.qty, source_so: so.id, received_date: ts }));
    const adjustments = rows.map(r => { const p = getProduct(r.product_id); return { product_id: r.product_id, qty: r.qty, amount: Math.round((p ? (p.sell || 0) : 0) * r.qty), reason: `Sent to Master Pool by ${role}`, date: ts }; });
    const ledger = rows.map(r => ({ product_id: r.product_id, qty: r.qty, date: ts, by: currentUser }));
    const units = rows.reduce((a, b) => a + b.qty, 0);
    mutate(s => ({
      ...s,
      sales_orders: s.sales_orders.map(x => x.id === so.id ? {
        ...x,
        extra: { ...(x.extra || {}), pool_out: [...((x.extra && x.extra.pool_out) || []), ...ledger] },
        bill_adjustments: [...(x.bill_adjustments || []), ...adjustments],
      } : x),
      notifications: [{ id: 'n-poolout-' + Date.now(), kind: 'transfer', text: `${units} unit(s) from ${so.so_no} sent to Master Pool by ${role} · client bill auto-reduced`, date: ts, read: false, role: 'Stores' }, ...s.notifications],
    }), { action: 'pool-send', entity: 'SalesOrder', entity_id: so.id });
    await addToPool(poolRows);
    setBusy(false); setSel({});
    toast(`Sent ${units} unit(s) to Master Pool · client bill auto-reduced`, 'success');
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Send to Master Pool</h3>
        <span className="card-sub">Divert surplus/held stock to the shared pool</span>
      </div>
      <div className="card-body flush">
        <table className="t">
          <thead><tr>
            <th style={{ width: 30 }}><input type="checkbox" checked={allChecked} onChange={selectAll} title="Select all"/></th>
            <th>Component</th><th className="num">Held</th><th className="num">Send qty</th>
          </tr></thead>
          <tbody>
            {held.map(h => {
              const p = getProduct(h.product_id) || { name: h.product_id, code: h.product_id };
              const on = sel[h.product_id] != null;
              return (
                <tr key={h.product_id} style={{ opacity: on ? 1 : 0.85 }}>
                  <td><input type="checkbox" checked={on} onChange={() => toggle(h)}/></td>
                  <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                  <td className="num"><strong>{h.held}</strong></td>
                  <td className="num"><input type="number" min="0" max={h.held} className="input mono" disabled={!on} value={on ? sel[h.product_id] : ''} onChange={e => setQty(h, e.target.value)} style={{ width: 64, textAlign: 'right', height: 26 }}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border)' }}>
        <span className="tiny muted grow">{checked.length} selected · units move to the Master Pool (sourced from {so.so_no}), the client bill auto-reduces, and the BOM in-hand updates live. Already-invoiced amounts may need a credit note.</span>
        <button className="btn" disabled={busy || checked.length === 0} onClick={send}><Icon name="layers" size={13}/>{busy ? 'Sending…' : `Send to Master Pool (${checked.length})`}</button>
      </div>
    </div>
  );
}

// Implementation section on the same VG page: BOQ items (received/used/remaining),
// the supervisor's daily usage logs (item + qty + hours + date), and mid-flow item
// requests to Purchase. Mobile-friendly. Realtime via synced state.
function VGImplPanel({ so }) {
  const { state, mutate, getProduct, getUser, currentUser } = useStore();
  const toast = useToast();
  const im = so.extra && so.extra.implementation;
  const role = getUser(currentUser)?.role;
  const isSup = currentUser === (im && im.supervisor_id);
  const canLog = isSup || role === 'Org Admin';
  const canFulfil = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const boq = (im && im.boq) || [];
  const logs = (im && im.daily_logs) || [];
  const requests = (im && im.requests) || [];
  const sup = getUser(im && im.supervisor_id);

  const soPoIds = new Set((state.vendor_pos || []).filter(p => p.so_id === so.id).map(p => p.id));
  const recvByProd = {};
  (state.grns || []).forEach(g => { if (soPoIds.has(g.po_id)) (g.items || []).forEach(it => { recvByProd[it.product_id] = (recvByProd[it.product_id] || 0) + (it.accepted || 0); }); });
  const usedByBoq = {};
  logs.forEach(lg => (lg.items || []).forEach(it => { usedByBoq[it.boq_id] = (usedByBoq[it.boq_id] || 0) + (Number(it.qty) || 0); }));
  const totalHours = logs.reduce((a, l) => a + (Number(l.hours) || 0), 0);
  const rows = boq.map(b => {
    const required = Number(b.qty) || 0;
    const received = b.product_id ? (recvByProd[b.product_id] || 0) : required;
    const used = usedByBoq[b.id] || 0;
    return { ...b, required, received, used, onSite: Math.max(0, received - used), procurable: !!b.product_id };
  });

  const updImpl = (patch, action, notifs) => mutate(s => ({
    ...s,
    sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, extra: { ...(x.extra || {}), implementation: { ...((x.extra && x.extra.implementation) || {}), ...patch } } } : x),
    ...(notifs ? { notifications: [...notifs, ...s.notifications] } : {}),
  }), { action, entity: 'SalesOrder', entity_id: so.id });

  const [logDate, setLogDate] = React.useState(TODAY);
  const [logHours, setLogHours] = React.useState('');
  const [logNotes, setLogNotes] = React.useState('');
  const [logItems, setLogItems] = React.useState({});
  const setLI = (id, v) => setLogItems(m => ({ ...m, [id]: v }));
  const postLog = () => {
    const items = boq.filter(b => Number(logItems[b.id]) > 0).map(b => ({ boq_id: b.id, name: b.name, qty: Number(logItems[b.id]) }));
    if (!items.length && !(Number(logHours) > 0)) { toast('Add hours worked and/or items used today'); return; }
    const log = { id: 'dl' + Date.now(), date: logDate, hours: Number(logHours) || 0, notes: logNotes || '', by: currentUser, items };
    updImpl({ daily_logs: [log, ...logs] }, 'daily-log', [{ id: 'n-dl-' + Date.now(), kind: 'so', text: `${so.so_no}: site update by ${sup ? sup.name : 'supervisor'} · ${Number(logHours) || 0}h · ${items.length} item(s) used`, date: TODAY, read: false, role: 'Project Manager' }]);
    setLogHours(''); setLogNotes(''); setLogItems({});
    toast('Daily update posted · VG updated', 'success');
  };

  const [reqName, setReqName] = React.useState('');
  const [reqQty, setReqQty] = React.useState(1);
  const [reqSearch, setReqSearch] = React.useState('');
  const reqResults = reqSearch.trim() ? state.products.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(reqSearch.trim().toLowerCase())).slice(0, 5) : [];
  const addRequest = (product) => {
    const name = product ? product.name : reqName.trim();
    if (!name) { toast('Enter an item to request'); return; }
    const rq = { id: 'rq' + Date.now(), date: TODAY, name, product_id: product ? product.id : null, qty: Math.max(1, Number(reqQty) || 1), status: 'Requested', by: currentUser };
    updImpl({ requests: [rq, ...requests] }, 'impl-request', [{ id: 'n-rq-' + Date.now(), kind: 'so', text: `${so.so_no}: supervisor requested ${rq.qty}× ${name} for the site`, date: TODAY, read: false, role: 'Purchase' }]);
    setReqName(''); setReqSearch(''); setReqQty(1);
    toast('Item requested · Purchase notified', 'success');
  };
  const fulfilRequest = (rq) => {
    const newBoq = [...boq, { id: 'b' + Date.now(), product_id: rq.product_id, name: rq.name, qty: rq.qty, uom: '' }];
    updImpl({ boq: newBoq, requests: requests.map(r => r.id === rq.id ? { ...r, status: 'Fulfilled' } : r) }, 'impl-req-fulfil', [{ id: 'n-rqf-' + Date.now(), kind: 'so', text: `${so.so_no}: ${rq.qty}× ${rq.name} added to BOQ for procurement`, date: TODAY, read: false, user_id: im && im.supervisor_id }]);
    toast('Added to BOQ · procure via the Vendor PO tab (pool-first)', 'success');
  };

  const openReqs = requests.filter(r => r.status !== 'Fulfilled');
  return (
    <div className="card mt-2" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div className="card-header">
        <div><h3 className="card-title">Implementation — site tracking</h3><span className="card-sub">Supervisor: {sup ? sup.name : '—'} · {totalHours}h logged · billed {inr(im ? im.hourly_rate || 0 : 0)}/hr</span></div>
        <span className="badge accent dot">{im ? im.status || 'BOQ Pending' : ''}</span>
      </div>
      <div className="card-body flush">
        {rows.length === 0 ? <div className="empty">No BOQ items yet — the supervisor prepares the BOQ on the inquiry.</div> : (
          <table className="t">
            <thead><tr><th>Site item</th><th className="num">Required</th><th className="num">Received</th><th className="num">Used</th><th className="num">On site</th><th>Status</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                <td>{r.name}{r.procurable ? '' : <span className="badge tiny" style={{ marginLeft: 4 }}>service</span>}</td>
                <td className="num">{r.required}</td>
                <td className="num">{r.procurable ? r.received : <span className="muted">—</span>}</td>
                <td className="num">{r.used || <span className="muted">0</span>}</td>
                <td className="num"><strong style={{ color: r.onSite > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{r.onSite}</strong></td>
                <td>{r.procurable && r.received < r.required ? <span className="badge warning dot">Procuring</span> : r.onSite > 0 ? <span className="badge success dot">On site</span> : r.used >= r.required && r.required > 0 ? <span className="badge dot">Consumed</span> : <span className="badge dot">—</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {/* Item requests (supervisor → Purchase) */}
      <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Item requests {openReqs.length > 0 && <span className="badge warning">{openReqs.length} open</span>}</div>
        {requests.length > 0 && (
          <div className="stack" style={{ gap: 4, marginBottom: 8 }}>
            {requests.map(r => (
              <div key={r.id} className="queue-item">
                <div className="grow"><div className="small">{r.qty}× {r.name}</div><div className="tiny muted">{fmtDate(r.date)} · {r.status}</div></div>
                {r.status !== 'Fulfilled' && canFulfil && <button className="btn btn-sm btn-primary" onClick={() => fulfilRequest(r)}><Icon name="plus" size={11}/>Add to BOQ</button>}
                {r.status === 'Fulfilled' && <span className="badge success dot">Fulfilled</span>}
              </div>
            ))}
          </div>
        )}
        {canLog && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 0 }}>
              <input className="input" placeholder="Request an item (search catalogue or type)…" value={reqSearch || reqName} onChange={e => { setReqSearch(e.target.value); setReqName(e.target.value); }} style={{ width: '100%' }}/>
              {reqResults.length > 0 && <div style={{ position: 'absolute', zIndex: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2, width: '100%' }}>{reqResults.map(p => <div key={p.id} className="queue-item" style={{ cursor: 'pointer' }} onClick={() => addRequest(p)}><div className="grow small">{p.name}</div><Icon name="plus" size={11}/></div>)}</div>}
            </div>
            <input type="number" min="1" className="input mono" value={reqQty} onChange={e => setReqQty(e.target.value)} style={{ width: 64 }} title="Qty"/>
            <button className="btn btn-sm" onClick={() => addRequest(null)}><Icon name="plus" size={11}/>Request</button>
          </div>
        )}
      </div>

      {/* Daily usage log (supervisor) */}
      {canLog && (
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Post today's update</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <input type="date" className="input mono" value={logDate} onChange={e => setLogDate(e.target.value)} style={{ width: 150 }}/>
            <input type="number" min="0" className="input mono" placeholder="hours worked" value={logHours} onChange={e => setLogHours(e.target.value)} style={{ width: 120 }}/>
          </div>
          {rows.length > 0 && (
            <div className="stack" style={{ gap: 4, marginBottom: 6 }}>
              {rows.map(r => (
                <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="small grow trunc">{r.name} <span className="tiny muted">(on site {r.onSite})</span></span>
                  <input type="number" min="0" className="input mono" placeholder="used" value={logItems[r.id] || ''} onChange={e => setLI(r.id, e.target.value)} style={{ width: 72, height: 26 }}/>
                </div>
              ))}
            </div>
          )}
          <textarea className="textarea" rows="2" placeholder="Notes (optional)…" value={logNotes} onChange={e => setLogNotes(e.target.value)} style={{ marginBottom: 6 }}/>
          <button className="btn btn-primary btn-sm" onClick={postLog}><Icon name="check" size={12}/>Post daily update</button>
        </div>
      )}

      {/* Day-by-day report */}
      <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Daily reports ({logs.length}) · {totalHours}h total</div>
        {logs.length === 0 ? <div className="tiny muted">No updates yet.</div> : (
          <div className="stack" style={{ gap: 6 }}>
            {logs.map(lg => {
              const by = getUser(lg.by);
              return (
                <div key={lg.id} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong className="small mono">{fmtDate(lg.date)}</strong>
                    <span className="badge accent tiny">{lg.hours || 0}h</span>
                    {by && <span className="tiny muted">· {by.name}</span>}
                  </div>
                  {(lg.items || []).length > 0 && <div className="tiny" style={{ marginTop: 3 }}>Used: {lg.items.map(it => `${it.qty}× ${it.name}`).join(' · ')}</div>}
                  {lg.notes && <div className="tiny muted" style={{ marginTop: 2 }}>{lg.notes}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function VirtualGodownView({ soId, embedded }) {
  const { state, navigate, getSO, getCustomer, getProduct, mutate, getUser, currentUser, addToPool, getVendor } = useStore();
  const toast = useToast();
  const [recvSel, setRecvSel] = React.useState({});   // product_id -> receive-now qty
  const [recvBusy, setRecvBusy] = React.useState(false);
  const so = getSO(soId);
  if (!so) return <div className="empty">Godown not found</div>;
  const cust = getCustomer(so.customer_id);
  const role = getUser(currentUser)?.role;
  const canEditBOM = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const canReceive = ['Stores', 'Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const removeComponent = (pid) => {
    const p = getProduct(pid);
    if (!window.confirm(`Remove ${p ? p.name : pid} from this SO's requirements? Procurement & receiving will no longer expect it.`)) return;
    mutate(s => ({ ...s, sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, lines: (x.lines || []).map(l => ({ ...l, components: (l.components || []).filter(c => c.product_id !== pid) })) } : x) }), { action: 'remove-component', entity: 'SalesOrder', entity_id: so.id });
    toast(`${p ? p.name : pid} removed from requirements`);
  };
  const toggleRecv = (c) => setRecvSel(m => { const n = { ...m }; if (n[c.product_id] != null) delete n[c.product_id]; else n[c.product_id] = c.remaining; return n; });
  const setRecvQty = (c, v) => setRecvSel(m => ({ ...m, [c.product_id]: Math.max(0, Math.min(Number(v) || 0, c.remaining)) }));

  // Approved cross-SO transfers touching this SO — single source of truth,
  // persisted in transfer_requests. In = received into this VG; Out = lent away.
  const approved = (state.transfer_requests || []).filter(t => t.status === 'Approved');
  const transferredIn = {};
  const transferredOut = {};
  approved.forEach(t => (t.items || []).forEach(it => {
    if (t.to_so === so.id) transferredIn[it.product_id] = (transferredIn[it.product_id] || 0) + (it.qty || 0);
    if (t.from_so === so.id) transferredOut[it.product_id] = (transferredOut[it.product_id] || 0) + (it.qty || 0);
  }));

  // All required components flattened
  const allComponents = [];
  so.lines.forEach(l => {
    l.components.forEach(c => {
      const existing = allComponents.find(x => x.product_id === c.product_id);
      if (existing) existing.qty += c.qty;
      else allComponents.push({ product_id: c.product_id, qty: c.qty });
    });
  });
  // Include transferred-in products even if not part of the BOM (edge case)
  Object.keys(transferredIn).forEach(pid => {
    if (!allComponents.find(x => x.product_id === pid)) allComponents.push({ product_id: pid, qty: 0 });
  });

  // Material physically received against this SO's vendor POs (cumulative GRN accepted).
  const soPOs = (state.vendor_pos || []).filter(p => p.so_id === so.id);
  const soPoIds = new Set(soPOs.map(p => p.id));
  const recvByProd = {};
  (state.grns || []).forEach(g => { if (soPoIds.has(g.po_id)) (g.items || []).forEach(it => { recvByProd[it.product_id] = (recvByProd[it.product_id] || 0) + (it.accepted || 0); }); });
  (so.pool_alloc || []).forEach(a => { recvByProd[a.product_id] = (recvByProd[a.product_id] || 0) + (Number(a.qty) || 0); });   // committed pool stock counts as in-hand
  const pooledOut = window.soPoolOut ? window.soPoolOut(so) : {};   // units diverted to the Master Pool

  // Pool check + transfer reflection
  const pool = state.pool;
  const enriched = allComponents.map(c => {
    const poolItem = pool.find(p => p.product_id === c.product_id);
    const poolQty = poolItem ? poolItem.qty : 0;
    const tIn = transferredIn[c.product_id] || 0;
    const tOut = transferredOut[c.product_id] || 0;
    const fromPool = Math.min(poolQty, c.qty);
    const toProcure = Math.max(0, c.qty - fromPool - tIn);   // transfer-in reduces fresh procurement
    const product = getProduct(c.product_id) || { name: c.product_id, code: c.product_id };
    const grossReceived = recvByProd[c.product_id] || 0;     // procured + GRN-accepted into this VG
    const sentToPool = pooledOut[c.product_id] || 0;         // later diverted to Master Pool
    const received = Math.max(0, grossReceived - sentToPool);
    const available = Math.max(0, fromPool + tIn - tOut);    // pool/transfer stock this VG holds
    const inHand = Math.max(0, available + received);        // net stock this VG holds for the customer
    const remaining = Math.max(0, c.qty - grossReceived - available);   // still to physically receive
    return { ...c, product, poolQty, fromPool, toProcure, transferredIn: tIn, transferredOut: tOut, available, received, grossReceived, sentToPool, inHand, remaining };
  });
  const allReceived = enriched.every(c => c.remaining <= 0);
  const receivable = enriched.filter(c => c.remaining > 0);
  const recvPicks = Object.keys(recvSel).filter(pid => recvSel[pid] > 0).map(pid => ({ product_id: pid, qty: recvSel[pid] }));
  const allTicked = receivable.length > 0 && receivable.every(c => recvSel[c.product_id] != null);
  const toggleAllRecv = () => setRecvSel(allTicked ? {} : Object.fromEntries(receivable.map(c => [c.product_id, c.remaining])));
  const doMarkReceived = async () => {
    if (!recvPicks.length) { toast('Tick the items you received'); return; }
    setRecvBusy(true);
    const r = await vgReceiveComponents(so, recvPicks, { state, mutate, toast: null, addToPool, getProduct, getVendor, getUser, currentUser });
    setRecvBusy(false); setRecvSel({});
    toast(`Received ${r.units} unit(s) · ${r.posted} GRN(s) posted · client invoice auto-raised${r.createdPONeedsMD ? ' · a high-value PO needs MD approval before it can be received' : ''}`, 'success');
  };
  const totalIn = Object.values(transferredIn).reduce((a, b) => a + b, 0);
  const totalOut = Object.values(transferredOut).reduce((a, b) => a + b, 0);

  const Wrap = embedded ? React.Fragment : ({ children }) => (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('godown')}>
            <Icon name="chevronLeft" size={12}/> Virtual Godowns
          </div>
          <h1 className="page-title">VG — <span className="mono">{so.so_no}</span></h1>
          <div className="page-sub">{cust.name} · {so.lines.length} bundle{so.lines.length > 1 ? 's' : ''} · isolated from other SOs</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate(`sales-orders/${so.id}`)}><Icon name="receipt" size={13}/>View SO</button>
          <button className="btn"><Icon name="arrowLeftRight" size={13}/>Request transfer</button>
        </div>
      </div>
      {children}
    </div>
  );

  return (
    <Wrap>
      {so.on_hold && (
        <div className="mb-2" style={{ padding: '8px 12px', background: 'var(--warning-bg)', border: '1px solid oklch(0.85 0.09 75)', borderRadius: 'var(--radius)', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="alert" size={14} color="var(--warning)"/>
          <span><strong>{so.so_no} is on hold</strong> — its stock stays locked here but can be lent to an urgent SO via a cross-SO transfer.</span>
        </div>
      )}
      {!allReceived && enriched.some(c => c.remaining > 0) && (
        <div className="mb-2" style={{ padding: '8px 12px', background: 'var(--info-bg)', border: '1px solid oklch(0.86 0.05 260)', borderRadius: 'var(--radius)', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="alert" size={14} color="var(--info)"/>
          <span><strong>Still to receive:</strong> {enriched.filter(c => c.remaining > 0).map(c => `${c.remaining}× ${c.product.name}`).join(' · ')}. This SO cannot be closed until every item is received.</span>
        </div>
      )}
      <div className="split-2to1">
        <div className="stack">
        <VGAddFromPoolPanel so={so}/>
        <VGPoolSendPanel so={so}/>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">VG Contents · {so.so_no}</h3>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {allReceived
                ? <span className="badge success dot">All received</span>
                : canReceive
                  ? <><span className="tiny muted">Tick what arrived →</span><button className="btn btn-primary btn-sm" disabled={recvBusy || recvPicks.length === 0} onClick={doMarkReceived}><Icon name="check" size={12}/>{recvBusy ? 'Posting…' : `Mark Received (${recvPicks.length})`}</button></>
                  : <span className="tiny muted">{receivable.length} remaining</span>}
            </div>
          </div>
          <div className="card-body flush">
            <table className="t zebra">
              <thead><tr>
                {canReceive && <th style={{ width: 60 }}><input type="checkbox" checked={allTicked} onChange={toggleAllRecv} title="Select all to receive"/></th>}
                <th>Component</th><th>Code</th>
                <th className="num">Required</th><th className="num">From Pool</th><th className="num">Transferred</th>
                <th className="num">Received</th><th className="num">→ Pool</th><th className="num">In hand</th><th className="num">Remaining</th><th>Status</th>{canEditBOM && <th></th>}
              </tr></thead>
              <tbody>
                {enriched.map(c => {
                  const net = c.transferredIn - c.transferredOut;
                  return (
                    <tr key={c.product_id}>
                      {canReceive && <td>{c.remaining > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <input type="checkbox" checked={recvSel[c.product_id] != null} onChange={() => toggleRecv(c)}/>
                          {recvSel[c.product_id] != null && <input type="number" min="0" max={c.remaining} value={recvSel[c.product_id]} onChange={e => setRecvQty(c, e.target.value)} className="input mono" style={{ width: 44, height: 22, textAlign: 'right', padding: '0 4px' }}/>}
                        </div>
                      ) : <Icon name="check" size={12} color="var(--success)"/>}</td>}
                      <td>{c.product.name}</td>
                      <td className="mono small muted">{c.product.code}</td>
                      <td className="num">{c.qty}</td>
                      <td className="num"><span className="badge accent" style={{ minWidth: 28, justifyContent: 'center' }}>{c.fromPool}</span></td>
                      <td className="num">{net !== 0 ? <span className="badge info" style={{ minWidth: 28, justifyContent: 'center' }} title={`In ${c.transferredIn} · Out ${c.transferredOut}`}>{net > 0 ? '+' : ''}{net}</span> : <span className="muted">—</span>}</td>
                      <td className="num">{c.grossReceived > 0 ? <span className="badge success" style={{ minWidth: 28, justifyContent: 'center' }}>{c.grossReceived}</span> : <span className="muted">0</span>}</td>
                      <td className="num">{c.sentToPool > 0 ? <span className="badge info" style={{ minWidth: 28, justifyContent: 'center' }} title="Sent to Master Pool">{c.sentToPool}</span> : <span className="muted">0</span>}</td>
                      <td className="num"><strong>{c.inHand}</strong>{c.qty ? <span className="muted">/{c.qty}</span> : null}</td>
                      <td className="num">{c.remaining > 0 ? <strong style={{ color: 'var(--warning)' }}>{c.remaining}</strong> : <span className="muted">0</span>}</td>
                      <td>
                        {c.qty > 0 && c.remaining <= 0 ? <span className="badge success dot">Fulfilled</span> :
                         c.inHand > 0 ? <span className="badge warning dot">Partial</span> :
                         <span className="badge dot">Remaining</span>}
                      </td>
                      {canEditBOM && <td><button className="btn btn-ghost btn-sm" title="Remove component" onClick={() => removeComponent(c.product_id)}><Icon name="trash" size={11} color="var(--danger)"/></button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>

        <div className="stack">
          <VGInvoicesCard so={so}/>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Inflows & Outflows</h3></div>
            <div className="card-body flush">
              <div className="queue-item">
                <Icon name="layers" size={14} color="var(--accent)"/>
                <div className="grow">
                  <div className="small"><strong>Pool allocation</strong></div>
                  <div className="tiny muted">{enriched.filter(c => c.fromPool > 0).length} items · auto</div>
                </div>
                <span className="badge accent">{enriched.reduce((s,c) => s + c.fromPool, 0)}</span>
              </div>
              <div className="queue-item">
                <Icon name="arrowRight" size={14} color="var(--info)"/>
                <div className="grow">
                  <div className="small"><strong>Transferred in</strong></div>
                  <div className="tiny muted">Received from other SOs</div>
                </div>
                <span className="badge info">{totalIn}</span>
              </div>
              <div className="queue-item">
                <Icon name="cart" size={14} color="var(--text-3)"/>
                <div className="grow">
                  <div className="small"><strong>Awaiting procurement</strong></div>
                  <div className="tiny muted">RFQ or VPO</div>
                </div>
                <span className="badge">{enriched.reduce((s,c) => s + c.toProcure, 0)}</span>
              </div>
              <div className="divider" style={{ margin: 0 }}/>
              <div className="queue-item">
                <Icon name="arrowLeftRight" size={14} color="var(--info)"/>
                <div className="grow">
                  <div className="small"><strong>Lent to other SOs</strong></div>
                  <div className="tiny muted">Backend only · invisible to customer</div>
                </div>
                <span className="badge info">{totalOut}</span>
              </div>
              <div className="queue-item">
                <Icon name="truck" size={14} color="var(--text-3)"/>
                <div className="grow">
                  <div className="small"><strong>Customer dispatch</strong></div>
                  <div className="tiny muted">Outflow → customer</div>
                </div>
                <span className="badge">0</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Pool-first Engine</h3></div>
            <div className="card-body">
              <div className="tiny muted mb-2">Per-line allocation rule</div>
              <div className="dl" style={{ gridTemplateColumns: '1fr auto', fontSize: 12 }}>
                <dt>1. Check Master Pool</dt><dd><Icon name="check" size={12} color="var(--success)"/></dd>
                <dt>2. Allocate available qty</dt><dd><Icon name="check" size={12} color="var(--success)"/></dd>
                <dt>3. Route balance to RFQ</dt><dd><Icon name="check" size={12} color="var(--success)"/></dd>
                <dt>4. GRN → into this VG</dt><dd><Icon name="spinner" size={12} color="var(--accent)"/></dd>
                <dt>5. Outflow to customer</dt><dd className="muted"><Icon name="spinner" size={12}/></dd>
                <dt>6. Surplus → back to Pool</dt><dd className="muted"><Icon name="spinner" size={12}/></dd>
              </div>
              <div className="divider"/>
              <div className="tiny muted">Pool-first toggle: <strong style={{ color: 'var(--text)' }}>ON</strong> · admin can override per line</div>
            </div>
          </div>
        </div>
      </div>
      {so.extra && so.extra.implementation && <VGImplPanel so={so}/>}
    </Wrap>
  );
}

// ===== Master Pool =====
function MasterPool() {
  const { state, getProduct, getCustomer, getUser, currentUser } = useStore();
  const [showAdd, setShowAdd] = React.useState(false);
  const role = getUser(currentUser)?.role;
  const canAdd = ['Stores', 'Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const pool = state.pool;
  const enriched = pool.map(p => ({ ...p, product: getProduct(p.product_id), age: daysBetween(p.received_date, TODAY) }));
  const totalValue = enriched.reduce((s, p) => s + p.product.buy * p.qty, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Master Surplus Pool</h1>
          <div className="page-sub">Leftover inventory from closed SOs · checked first by every new VG before procurement</div>
        </div>
        <div className="page-actions">
          {canAdd && <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={13}/>Add to pool</button>}
          <button className="btn"><Icon name="filter" size={13}/>Filter by age</button>
          <button className="btn"><Icon name="download" size={13}/>Export</button>
        </div>
      </div>

      {showAdd && <AddToPoolModal onClose={() => setShowAdd(false)}/>}

      <div className="kpi-grid mb-3">
        <div className="kpi"><div className="kpi-label">Pool SKUs</div><div className="kpi-value">{pool.length}</div><div className="kpi-delta">distinct products</div></div>
        <div className="kpi"><div className="kpi-label">Pool Units</div><div className="kpi-value">{pool.reduce((s,p) => s + p.qty, 0)}</div><div className="kpi-delta">total quantity</div></div>
        <div className="kpi"><div className="kpi-label">Pool Value</div><div className="kpi-value">{inrK(totalValue)}</div><div className="kpi-delta">at last buy price</div></div>
        <div className="kpi"><div className="kpi-label">Avg Ageing</div><div className="kpi-value">{Math.round(enriched.reduce((s,p) => s + p.age, 0) / enriched.length)}d</div><div className="kpi-delta">days since receipt</div></div>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="card-title">Pool Inventory</h3>
          <span className="card-sub">Sorted by ageing (oldest first)</span>
        </div>
        <div className="card-body flush">
          <table className="t zebra">
            <thead><tr>
              <th>Product</th><th>Code</th><th>HSN</th>
              <th className="num">Qty</th><th className="num">Unit Cost</th><th className="num">Total Value</th>
              <th>Source SO</th><th>Received</th><th className="num">Age</th><th>Status</th>
            </tr></thead>
            <tbody>
              {enriched.sort((a,b) => b.age - a.age).map((p, i) => (
                <tr key={i}>
                  <td>{p.product.name}</td>
                  <td className="mono small muted">{p.product.code}</td>
                  <td className="mono small muted">{p.product.hsn}</td>
                  <td className="num"><strong>{p.qty}</strong> {p.product.uom}</td>
                  <td className="num">{inr(p.product.buy)}</td>
                  <td className="num">{inr(p.product.buy * p.qty)}</td>
                  <td className="mono small">{p.source_so}</td>
                  <td className="mono small">{fmtDate(p.received_date)}</td>
                  <td className="num">{p.age}d</td>
                  <td>
                    {p.age > 60 ? <span className="badge warning dot">Slow-moving</span> :
                     p.age > 30 ? <span className="badge dot">Ageing</span> :
                     <span className="badge success dot">Fresh</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3">
        <div className="card">
          <div className="card-header"><h3 className="card-title">How allocation works</h3></div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { n: 1, t: 'SO Approved', d: 'Virtual Godown auto-opens · system iterates each BOM component' },
                { n: 2, t: 'Pool Query', d: 'For each component, system checks Master Pool for available qty' },
                { n: 3, t: 'Allocate', d: 'If pool ≥ required, fully allocate. Else partial allocate, balance routes to RFQ' },
                { n: 4, t: 'Replenish', d: 'When SO closes, any leftover items flow back into pool with audit trail' },
              ].map(s => (
                <div key={s.n} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>STEP {s.n}</div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{s.t}</div>
                  <div className="tiny muted mt-1">{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Manually add stock to the Master Pool — pick a catalogue product, or create a
// custom component (persisted as a custom product in config, no schema change).
function AddToPoolModal({ onClose }) {
  const { state, mutate, addToPool, saveConfig, getProduct, getUser, currentUser } = useStore();
  const toast = useToast();
  // Custom components persist to the config singleton, which is admin-write-only
  // (RLS). So only Org Admin can create reusable custom components; everyone can
  // add catalogue items to the pool.
  const canCustom = getUser(currentUser)?.role === 'Org Admin';
  const [mode, setMode] = React.useState('catalogue');
  const [q, setQ] = React.useState('');
  const [pid, setPid] = React.useState('');
  const [qty, setQty] = React.useState(1);
  const [source, setSource] = React.useState('Manual add');
  const [cust, setCust] = React.useState({ name: '', code: '', unit_cost: '', sell: '', hsn: '', uom: 'Piece' });
  const [busy, setBusy] = React.useState(false);
  const results = q.trim() ? state.products.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const chosen = pid ? getProduct(pid) : null;
  const setC = (k, v) => setCust(c => ({ ...c, [k]: v }));

  const submit = async () => {
    const n = Math.max(0, Number(qty) || 0);
    if (n <= 0) { toast('Enter a quantity'); return; }
    setBusy(true);
    if (mode === 'catalogue') {
      if (!pid) { setBusy(false); toast('Pick a product'); return; }
      await addToPool([{ product_id: pid, qty: n, source_so: source || null, received_date: TODAY }]);
      setBusy(false); onClose();
      toast(`${n}× ${chosen ? chosen.name : pid} added to the Master Pool`, 'success');
    } else {
      if (!canCustom) { setBusy(false); toast('Only an Org Admin can create custom components'); return; }
      if (!cust.name.trim()) { setBusy(false); toast('Component name is required'); return; }
      const cp = { id: 'cp-' + Date.now().toString(36), code: cust.code.trim() || ('CP-' + Date.now().toString(36).slice(-4).toUpperCase()), name: cust.name.trim(), hsn: cust.hsn.trim() || '', uom: cust.uom || 'Piece', gst: 18, sell: Number(cust.sell) || Number(cust.unit_cost) || 0, buy: Number(cust.unit_cost) || 0, custom: true };
      // Persist the custom product in config (merged into the catalogue on load)…
      const res = await saveConfig({ custom_products: [...(state.config.custom_products || []), cp] });
      if (res && res.ok === false) { setBusy(false); toast('Could not save the custom component (config write denied)'); return; }
      // …and add it locally now so it resolves immediately (products aren't diff-synced).
      mutate(s => ({ ...s, products: s.products.some(p => p.id === cp.id) ? s.products : [...s.products, cp] }), { action: 'add-custom-product', entity: 'Product', entity_id: cp.id });
      await addToPool([{ product_id: cp.id, qty: n, source_so: source || null, received_date: TODAY }]);
      setBusy(false); onClose();
      toast(`Custom component ${cp.name} created & ${n} added to the pool`, 'success');
    }
  };

  return (
    <Modal title="Add to Master Pool" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Adding…' : 'Add to pool'}</button>
      </>
    }>
      <div className="tabs mb-2" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 2, width: 'fit-content' }}>
        <button className={`tab ${mode === 'catalogue' ? 'active' : ''}`} onClick={() => setMode('catalogue')}>From catalogue</button>
        {canCustom && <button className={`tab ${mode === 'custom' ? 'active' : ''}`} onClick={() => setMode('custom')}>Custom component</button>}
      </div>

      {mode === 'catalogue' ? (
        <div className="stack">
          <div className="field">
            <label className="field-label">Search product</label>
            <input className="input" placeholder="Search by name or code…" value={q} onChange={e => { setQ(e.target.value); setPid(''); }}/>
            {results.length > 0 && !pid && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4, maxHeight: 200, overflow: 'auto' }}>
                {results.map(p => (
                  <div key={p.id} className="queue-item" style={{ cursor: 'pointer' }} onClick={() => { setPid(p.id); setQ(p.name); }}>
                    <div className="grow"><div className="small">{p.name}</div><div className="tiny muted mono">{p.code} · buy {inr(p.buy)}</div></div>
                    <Icon name="check" size={12}/>
                  </div>
                ))}
              </div>
            )}
            {chosen && <div className="tiny muted mt-1">Selected: <strong>{chosen.name}</strong> · {chosen.code} · unit cost {inr(chosen.buy)}</div>}
          </div>
        </div>
      ) : (
        <div className="field-row-3">
          <div className="field"><label className="field-label">Component name *</label><input className="input" value={cust.name} onChange={e => setC('name', e.target.value)}/></div>
          <div className="field"><label className="field-label">Code</label><input className="input mono" value={cust.code} onChange={e => setC('code', e.target.value)} placeholder="auto if blank"/></div>
          <div className="field"><label className="field-label">HSN</label><input className="input mono" value={cust.hsn} onChange={e => setC('hsn', e.target.value)}/></div>
          <div className="field"><label className="field-label">Unit cost (buy) *</label><input type="number" min="0" className="input mono" value={cust.unit_cost} onChange={e => setC('unit_cost', e.target.value)}/></div>
          <div className="field"><label className="field-label">Sell price</label><input type="number" min="0" className="input mono" value={cust.sell} onChange={e => setC('sell', e.target.value)} placeholder="optional"/></div>
          <div className="field"><label className="field-label">UOM</label><input className="input" value={cust.uom} onChange={e => setC('uom', e.target.value)}/></div>
        </div>
      )}

      <div className="field-row mt-2">
        <div className="field"><label className="field-label">Quantity *</label><input type="number" min="1" className="input mono" value={qty} onChange={e => setQty(e.target.value)}/></div>
        <div className="field"><label className="field-label">Source / note</label><input className="input" value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. Manual add, surplus from SO/…"/></div>
      </div>
      <div className="tiny muted mt-2">Catalogue items use the product's cost; custom components are saved to your catalogue and reusable across SOs. Added stock becomes available to every SO's pool suggestions.</div>
    </Modal>
  );
}

// ===== Cross-SO Transfers =====
function CrossSOTransfers() {
  const { state, mutate, getSO, getProduct, getUser, navigate, currentUser } = useStore();
  const toast = useToast();
  const role = getUser(currentUser).role;
  const canInitiate = canDo(role, 'initiateTransfer') || role === 'Org Admin';
  const [showNew, setShowNew] = React.useState(false);

  const requests = state.transfer_requests;

  const decide = (id, decision) => {
    mutate(s => ({
      ...s,
      transfer_requests: s.transfer_requests.map(t => t.id === id ? {...t, status: decision} : t)
    }), { action: decision, entity: 'TransferRequest', entity_id: id });
    toast(`Transfer ${decision.toLowerCase()}`, decision === 'Approved' ? 'success' : '');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cross-SO Transfers</h1>
          <div className="page-sub">Backend-only · on-hold SOs lend stock to urgent SOs · customer-facing documents never reference</div>
        </div>
        <div className="page-actions">
          {canInitiate && <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="plus" size={13}/>Request transfer</button>}
        </div>
      </div>

      <div style={{
        background: 'var(--info-bg)', border: '1px solid oklch(0.86 0.05 260)',
        padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 12.5, marginBottom: 14,
        display: 'flex', alignItems: 'center', gap: 8
      }}>
        <Icon name="alert" size={14} color="var(--info)"/>
        <span><strong>Visibility rule:</strong> Cross-SO transfers are an internal-only audit trail. The customer's Delivery Challan, Tax Invoice, and e-Way Bill show only their own SO — never the lending SO.</span>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="card-title">Pending Requests</h3></div>
        <div className="card-body flush">
          {requests.length === 0 ? <div className="empty">No transfers</div> : (
            <table className="t">
              <thead><tr>
                <th>Req ID</th><th>From SO</th><th>To SO</th><th>Items</th><th>Reason</th><th>Requested by</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {requests.map(t => {
                  const fromSO = getSO(t.from_so);
                  const toSO = getSO(t.to_so);
                  const byUser = getUser(t.requested_by);
                  return (
                    <tr key={t.id}>
                      <td className="mono small">{t.id}</td>
                      <td><div className="mono">{fromSO?.so_no}</div><div className="tiny muted">On Hold</div></td>
                      <td><div className="mono">{toSO?.so_no}</div><div className="tiny muted">Urgent</div></td>
                      <td>
                        {t.items.map((it, i) => {
                          const p = getProduct(it.product_id);
                          return <div key={i} className="small">{p?.name} <span className="mono muted">× {it.qty}</span></div>;
                        })}
                      </td>
                      <td className="trunc small" title={t.reason}>{t.reason}</td>
                      <td><Avatar user={byUser} size={20}/> <span className="small">{byUser?.name.split(' ')[0]}</span></td>
                      <td>{t.status === 'Pending' ? <span className="badge warning dot">Pending</span> :
                          t.status === 'Approved' ? <span className="badge success dot">Approved</span> :
                          <span className="badge danger dot">Rejected</span>}</td>
                      <td>
                        {t.status === 'Pending' && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-primary" onClick={() => decide(t.id, 'Approved')}><Icon name="check" size={11}/>Approve</button>
                            <button className="btn btn-sm" onClick={() => decide(t.id, 'Rejected')}><Icon name="x" size={11}/>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-3 split-2">
        <div className="card">
          <div className="card-header"><h3 className="card-title">Recent transfers</h3></div>
          <div className="card-body flush">
            <table className="t">
              <thead><tr><th>Date</th><th>From → To</th><th>Items</th><th>Approver</th></tr></thead>
              <tbody>
                <tr><td className="mono small">12-May</td><td className="mono small">SO/0007 → SO/0010</td><td className="small">3× SSD-NVME-512</td><td><span className="small">Ravi I</span></td></tr>
                <tr><td className="mono small">08-May</td><td className="mono small">SO/0006 → SO/0009</td><td className="small">2× SW-24P-GE</td><td><span className="small">Divya S</span></td></tr>
                <tr><td className="mono small">02-May</td><td className="mono small">SO/0005 → SO/0008</td><td className="small">8× CAB-CAT6</td><td><span className="small">Ravi I</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">How it works</h3></div>
          <div className="card-body">
            <div className="timeline">
              <div className="timeline-step done"><div className="timeline-dot"/><div className="timeline-label">Urgent SO's PM initiates request</div></div>
              <div className="timeline-step done"><div className="timeline-dot"/><div className="timeline-label">Source SO's PM notified (in-app + email)</div></div>
              <div className="timeline-step current"><div className="timeline-dot"/><div className="timeline-label">Source PM approves or rejects with reason</div></div>
              <div className="timeline-step"><div className="timeline-dot"/><div className="timeline-label">Items digitally re-allocated · audit logged</div></div>
              <div className="timeline-step"><div className="timeline-dot"/><div className="timeline-label">Source SO's procurement auto-re-triggered</div></div>
              <div className="timeline-step"><div className="timeline-dot"/><div className="timeline-label">Customer docs hide the transfer entirely</div></div>
            </div>
          </div>
        </div>
      </div>

      {showNew && <NewTransferModal onClose={() => setShowNew(false)}/>}
    </div>
  );
}

// Sum component quantities held in an SO's Virtual Godown (from its BOM lines).
function soComponentMap(so) {
  const m = {};
  (so.lines || []).forEach(l => (l.components || []).forEach(c => { m[c.product_id] = (m[c.product_id] || 0) + (c.qty || 0); }));
  return m;
}

function NewTransferModal({ onClose, destSoId }) {
  const { state, getSO, getProduct, mutate, currentUser } = useStore();
  const toast = useToast();
  const [fromSO, setFromSO] = React.useState('');
  const [toSO, setToSO] = React.useState(destSoId || '');
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState(1);
  const [reason, setReason] = React.useState('');

  const destLocked = !!destSoId;
  const dest = toSO ? getSO(toSO) : null;
  const destNeeds = dest ? soComponentMap(dest) : null;
  // Products to offer: what the destination SO needs (else any product).
  const productOptions = destNeeds ? Object.keys(destNeeds) : state.products.map(p => p.id);

  // Source candidates: other SOs (not the destination, not cancelled/closed) that
  // actually hold the chosen component — on-hold SOs listed first (they lend best).
  const sources = state.sales_orders
    .filter(s => s.id !== toSO && !['Cancelled', 'Closed'].includes(s.status))
    .map(s => ({ s, have: soComponentMap(s)[productId] || 0 }))
    .filter(x => productId ? x.have > 0 : (x.s.on_hold || ['Approved', 'Procurement Started', 'Material Received'].includes(x.s.status)))
    .sort((a, b) => (b.s.on_hold ? 1 : 0) - (a.s.on_hold ? 1 : 0));

  // If the chosen source no longer holds the product, clear it.
  React.useEffect(() => {
    if (fromSO && productId && !(soComponentMap(getSO(fromSO) || {})[productId] > 0)) setFromSO('');
  }, [productId]);

  const submit = () => {
    if (!fromSO || !toSO || !productId || !reason) return;
    mutate(s => ({
      ...s,
      transfer_requests: [...s.transfer_requests, {
        id: 'tr-' + Date.now(),
        from_so: fromSO, to_so: toSO,
        items: [{ product_id: productId, qty }],
        status: 'Pending', requested_by: currentUser, requested_date: TODAY, reason,
      }],
      notifications: [{ id: 'n-tr-' + Date.now(), kind: 'transfer', text: `Transfer requested: ${getSO(toSO)?.so_no} needs ${qty}× ${getProduct(productId)?.name} from ${getSO(fromSO)?.so_no}`, date: TODAY, read: false, role: 'Project Manager' }, ...s.notifications],
    }), { action: 'create', entity: 'TransferRequest' });
    toast('Transfer request raised · source PM notified', 'success');
    onClose();
  };

  return (
    <Modal title="Request components from another SO" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!fromSO || !toSO || !productId || !reason} onClick={submit}>Send request to source PM</button>
      </>
    }>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Lend to (this urgent SO)</label>
          {destLocked ? (
            <input className="input mono" value={`${dest?.so_no} · ${dest?.priority}`} disabled/>
          ) : (
            <select className="select" value={toSO} onChange={e => { setToSO(e.target.value); setProductId(''); setFromSO(''); }}>
              <option value="">Pick destination SO…</option>
              {state.sales_orders.filter(s => s.priority === 'Urgent' || s.priority === 'Critical').map(s =>
                <option key={s.id} value={s.id}>{s.so_no} · {s.priority}</option>
              )}
            </select>
          )}
        </div>
        <div className="field">
          <label className="field-label">Component needed</label>
          <select className="select" value={productId} onChange={e => { setProductId(e.target.value); setFromSO(''); }}>
            <option value="">Pick component…</option>
            {productOptions.map(pid => {
              const p = getProduct(pid);
              return <option key={pid} value={pid}>{p ? p.name : pid}{destNeeds ? ` · needs ${destNeeds[pid]}` : ''}</option>;
            })}
          </select>
          {destNeeds && <div className="field-hint">Components this SO requires</div>}
        </div>
      </div>

      <div className="field-row mt-2">
        <div className="field">
          <label className="field-label">Source SO (who has it)</label>
          <select className="select" value={fromSO} onChange={e => setFromSO(e.target.value)} disabled={!productId}>
            <option value="">{productId ? 'Pick a source SO…' : 'Pick a component first'}</option>
            {sources.map(({ s, have }) =>
              <option key={s.id} value={s.id}>{s.so_no} · {s.on_hold ? 'ON HOLD' : s.status}{have ? ` · has ${have}` : ''}</option>
            )}
          </select>
          <div className="field-hint">On-hold SOs are listed first — they can lend without affecting their dispatch.</div>
        </div>
        <div className="field">
          <label className="field-label">Quantity</label>
          <input type="number" className="input mono" min="1" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)}/>
        </div>
      </div>

      {productId && sources.length === 0 && (
        <div className="mt-2 tiny" style={{ padding: 10, background: 'var(--warning-bg)', borderRadius: 4 }}>
          No other SO currently holds this component. It will need fresh procurement.
        </div>
      )}

      <div className="field mt-2">
        <label className="field-label">Reason *</label>
        <textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this transfer is needed…"/>
      </div>
      <div className="mt-2 tiny muted" style={{ padding: 10, background: 'var(--info-bg)', borderRadius: 4 }}>
        The source SO's PM must approve (PM-to-PM agreement). On approval, items re-allocate to this SO and the source SO's procurement re-triggers for replacements. Customer-facing documents on either side never reference the other SO.
      </div>
    </Modal>
  );
}

// Units this SO has diverted to the Master Pool (ledger in so.extra.pool_out).
window.soPoolOut = function (so) {
  const m = {};
  ((so && so.extra && so.extra.pool_out) || []).forEach(e => { m[e.product_id] = (m[e.product_id] || 0) + (Number(e.qty) || 0); });
  return m;
};

// True only when every BOM component for the SO is fully in hand (GRN-accepted +
// committed pool stock). Used to gate SO closure. Mirrors billing's soReceivedQty.
window.soFullyReceived = function (state, so) {
  if (!so) return false;
  const req = {}; (so.lines || []).forEach(l => (l.components || []).forEach(c => { req[c.product_id] = (req[c.product_id] || 0) + (c.qty || 0); }));
  const poIds = new Set((state.vendor_pos || []).filter(p => p.so_id === so.id).map(p => p.id));
  const recv = {}; (state.grns || []).forEach(g => { if (poIds.has(g.po_id)) (g.items || []).forEach(it => { recv[it.product_id] = (recv[it.product_id] || 0) + (it.accepted || 0); }); });
  (so.pool_alloc || []).forEach(a => { recv[a.product_id] = (recv[a.product_id] || 0) + (Number(a.qty) || 0); });
  return Object.keys(req).every(pid => (recv[pid] || 0) >= req[pid]);
};

window.VGReceivePanel = VGReceivePanel;
window.VGAddFromPoolPanel = VGAddFromPoolPanel;
window.VGImplPanel = VGImplPanel;
window.VGInvoicesCard = VGInvoicesCard;
window.VGPoolSendPanel = VGPoolSendPanel;
window.VirtualGodownList = VirtualGodownList;
window.VirtualGodownView = VirtualGodownView;
window.MasterPool = MasterPool;
window.AddToPoolModal = AddToPoolModal;
window.CrossSOTransfers = CrossSOTransfers;
window.NewTransferModal = NewTransferModal;
