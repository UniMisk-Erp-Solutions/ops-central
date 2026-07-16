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
    mutate(s => {
      // Pool now covers this qty, so pull it off any UN-received vendor PO for this
      // SO (no GRN yet) — reduce the line qty, recompute the PO amount, drop lines/
      // POs that hit zero. Received/invoiced POs are never touched, so vendor
      // invoices stay correct. Amounts recompute automatically.
      const grnPoIds = new Set((s.grns || []).map(g => g.po_id));
      const viPoIds = new Set((s.vendor_invoices || []).map(v => v.po_id));   // never disturb an invoiced PO
      let cut = n;
      let removedFromPO = 0;
      const vendor_pos = s.vendor_pos.map(po => {
        if (cut <= 0 || po.so_id !== so.id || grnPoIds.has(po.id) || viPoIds.has(po.id) || ['Material Received', 'Partially Received', 'Rejected', 'Pending MD Approval'].includes(po.status)) return po;
        if (!(po.items || []).some(it => it.product_id === pid)) return po;
        const items = (po.items || []).map(it => {
          if (it.product_id !== pid || cut <= 0) return it;
          const take = Math.min(cut, it.qty || 0); cut -= take; removedFromPO += take;
          return { ...it, qty: (it.qty || 0) - take };
        }).filter(it => (it.qty || 0) > 0);
        return { ...po, items, amount: Math.round(items.reduce((a, it) => a + (it.qty || 0) * (it.rate || 0), 0)) };
      }).filter(po => !(po.so_id === so.id && (po.items || []).length === 0));   // drop emptied POs
      return {
        ...s,
        vendor_pos,
        sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, pool_alloc: [...(x.pool_alloc || []), { product_id: pid, qty: n, name: p ? p.name : pid, from_pool: true }] } : x),
        notifications: [{ id: 'n-pa-' + Date.now(), kind: 'transfer', text: `${n}× ${p ? p.name : pid} taken from Master Pool for ${so.so_no}${removedFromPO ? ` · ${removedFromPO} removed from vendor PO(s)` : ''}`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications],
      };
    }, { action: 'pool-allocate', entity: 'SalesOrder', entity_id: so.id });
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
  const grnByProd = {};
  (state.grns || []).forEach(g => { if (soPoIds.has(g.po_id)) (g.items || []).forEach(it => { grnByProd[it.product_id] = (grnByProd[it.product_id] || 0) + (it.accepted || 0); }); });
  // Pool stock committed to this SO ("Add from Master Pool") is already in hand for
  // the site, so it counts as received AND as handed over → the item reads Fulfilled.
  const poolAllocByProd = {};
  (so.pool_alloc || []).forEach(a => { poolAllocByProd[a.product_id] = (poolAllocByProd[a.product_id] || 0) + (Number(a.qty) || 0); });
  const usedByBoq = {};
  logs.forEach(lg => (lg.items || []).forEach(it => { usedByBoq[it.boq_id] = (usedByBoq[it.boq_id] || 0) + (Number(it.qty) || 0); }));
  const totalHours = logs.reduce((a, l) => a + (Number(l.hours) || 0), 0);
  // Qty manually handed to the supervisor. (Legacy rows used a boolean `sent`.)
  const sentOf = (b) => { const n = Number(b.sent_qty); if (n > 0) return n; return b.sent === true ? (Number(b.qty) || 0) : 0; };
  const rows = boq.map(b => {
    const required = Number(b.qty) || 0;
    const procurable = !!b.product_id;
    const grn = procurable ? (grnByProd[b.product_id] || 0) : 0;        // GRN-accepted by Purchase (info)
    const fromPool = procurable ? (poolAllocByProd[b.product_id] || 0) : 0;  // taken from the Master Pool (auto-sent)
    const received = grn + fromPool;
    const sentManual = sentOf(b);
    // Total handed to the supervisor = manual sends + pool stock (already at the site).
    const sentQty = Math.min(required, sentManual + fromPool);
    const used = usedByBoq[b.id] || 0;
    // Purchase can hand over anything still outstanding (not gated on GRN receipt).
    const available = Math.max(0, required - sentQty);
    const onSite = Math.max(0, sentQty - used);   // what the supervisor holds now
    return { ...b, required, procurable, grn, fromPool, received, sentManual, sentQty, used, available, onSite };
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

  const markDone = () => {
    if (!window.confirm(`Mark implementation done? This bills ${totalHours} logged hour(s) at ${inr(im ? im.hourly_rate || 0 : 0)}/hr to the client and finalises the invoice once supply is complete.`)) return;
    mutate(s => ({ ...s, sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, extra: { ...(x.extra || {}), implementation: { ...((x.extra && x.extra.implementation) || {}), status: 'Done' } } } : x), notifications: [{ id: 'n-impldone-' + Date.now(), kind: 'so', text: `${so.so_no}: implementation marked done by ${sup ? sup.name : 'supervisor'} · ${totalHours}h · billing raised`, date: TODAY, read: false, role: 'Billing' }, ...s.notifications] }), { action: 'impl-done', entity: 'SalesOrder', entity_id: so.id });
    if (window.autoInvoiceSO) window.autoInvoiceSO(so.id, { mutate, toast: null, currentUser, getUser, getProduct });
    toast(`Implementation done · ${totalHours}h billed to the client`, 'success');
  };
  // Purchase ticks items (any qty still outstanding) and sends them to the
  // supervisor, who then holds them on site. Not gated on GRN receipt.
  const [sel, setSel] = React.useState({});
  const sendable = rows.filter(r => r.available > 0);
  const allTicked = sendable.length > 0 && sendable.every(r => sel[r.id] != null);
  const toggleAllSend = () => setSel(allTicked ? {} : Object.fromEntries(sendable.map(r => [r.id, r.available])));
  const toggleSend = (r) => setSel(m => { const n = { ...m }; if (n[r.id] != null) delete n[r.id]; else n[r.id] = r.available; return n; });
  const setSendQty = (r, v) => setSel(m => ({ ...m, [r.id]: Math.max(0, Math.min(Number(v) || 0, r.available)) }));
  const picked = rows.filter(r => sel[r.id] != null && Number(sel[r.id]) > 0);
  // Commit a set of {r, n} handovers in one mutate.
  const commitSend = (handovers) => {
    const map = {}; let units = 0;
    handovers.forEach(({ r, n }) => { const q = Math.max(0, Math.min(Number(n) || 0, r.available)); if (q > 0) { map[r.id] = q; units += q; } });
    if (units <= 0) { toast('Set a quantity to send'); return; }
    const nextBoq = boq.map(x => {
      if (map[x.id] == null) return x;
      const r = rows.find(y => y.id === x.id);
      const next = r.sentManual + map[x.id];
      return { ...x, sent_qty: next, sent: (next + r.fromPool) >= (Number(x.qty) || 0) };
    });
    updImpl({ boq: nextBoq }, 'boq-sent',
      [{ id: 'n-boqs-' + Date.now(), kind: 'so', text: `${so.so_no}: ${units} unit(s) across ${Object.keys(map).length} item(s) sent to you · marked received on site`, date: TODAY, read: false, user_id: im && im.supervisor_id }]);
    toast(`${units} unit(s) sent to supervisor`, 'success');
  };
  const sendSelected = () => { if (!picked.length) { toast('Tick the items you are sending'); return; } commitSend(picked.map(r => ({ r, n: sel[r.id] }))); setSel({}); };
  const sendOne = (r) => { commitSend([{ r, n: sel[r.id] != null ? sel[r.id] : r.available }]); setSel(m => { const c = { ...m }; delete c[r.id]; return c; }); };
  const editBoqQty = (b, v) => updImpl({ boq: boq.map(x => x.id === b.id ? { ...x, qty: Math.max(0, Number(v) || 0) } : x) }, 'boq-qty');
  const removeBoq = (b) => updImpl({ boq: boq.filter(x => x.id !== b.id) }, 'boq-remove');
  const [pAddSearch, setPAddSearch] = React.useState('');
  const [pAddQty, setPAddQty] = React.useState(1);
  const pAddResults = pAddSearch.trim() ? state.products.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(pAddSearch.trim().toLowerCase())).slice(0, 5) : [];
  const purchaseAddBoq = (product) => {
    const name = product ? product.name : pAddSearch.trim();
    if (!name) { toast('Enter an item to add'); return; }
    updImpl({ boq: [...boq, { id: 'b' + Date.now(), product_id: product ? product.id : null, name, qty: Math.max(1, Number(pAddQty) || 1), uom: product ? product.uom || '' : '' }] }, 'boq-add', [{ id: 'n-boqa-' + Date.now(), kind: 'so', text: `${so.so_no}: ${name} added to the site BOQ`, date: TODAY, read: false, user_id: im && im.supervisor_id }]);
    setPAddSearch(''); setPAddQty(1);
    toast(`${name} added to BOQ`, 'success');
  };
  const openReqs = requests.filter(r => r.status !== 'Fulfilled');
  const isDone = im && im.status === 'Done';
  return (
    <div className="card mt-2" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div className="card-header">
        <div><h3 className="card-title">Implementation — site tracking</h3><span className="card-sub">Supervisor: {sup ? sup.name : '—'} · {totalHours}h logged · billed {inr(im ? im.hourly_rate || 0 : 0)}/hr = {inr((im ? im.hourly_rate || 0 : 0) * totalHours)}</span></div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="badge accent dot">{im ? im.status || 'BOQ Pending' : ''}</span>
          {canFulfil && sendable.length > 0 && <button className="btn btn-sm btn-primary" disabled={picked.length === 0} onClick={sendSelected}><Icon name="arrowRight" size={12}/>Send to supervisor ({picked.length})</button>}
          {canLog && !isDone && <button className="btn btn-sm btn-primary" onClick={markDone}><Icon name="check" size={12}/>Mark done &amp; bill</button>}
        </div>
      </div>
      <div className="card-body flush">
        {rows.length === 0 ? <div className="empty">No BOQ items yet — the supervisor prepares the BOQ on the inquiry.</div> : (
          <table className="t">
            <thead><tr>{canFulfil && <th style={{ width: 40 }}><input type="checkbox" checked={allTicked} onChange={toggleAllSend} title="Select all to send"/></th>}<th>Site item</th><th className="num">Required</th><th className="num">Received</th><th className="num">Sent</th><th className="num">Used</th><th className="num">On site</th><th>Status</th>{canFulfil && <th></th>}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                {canFulfil && <td>{r.available > 0
                  ? <input type="checkbox" checked={sel[r.id] != null} onChange={() => toggleSend(r)}/>
                  : <Icon name="check" size={12} color="var(--success)"/>}</td>}
                <td>{r.name}{r.procurable ? '' : <span className="badge tiny" style={{ marginLeft: 4 }}>service</span>}{r.fromPool > 0 && <span className="badge accent tiny" style={{ marginLeft: 4 }} title="Taken from the Master Surplus Pool — off the vendor PO"><Icon name="layers" size={9}/> {r.fromPool} from master pool</span>}</td>
                <td className="num">{canFulfil && r.sentQty === 0 ? <input type="number" min="0" className="input mono" value={r.qty} onChange={e => editBoqQty(r, e.target.value)} style={{ width: 56, height: 24, textAlign: 'right' }}/> : r.required}</td>
                <td className="num">{r.procurable ? <>{r.received}{r.fromPool > 0 && <div className="tiny muted">{r.fromPool} from pool</div>}</> : <span className="muted">—</span>}</td>
                <td className="num">{r.sentQty || <span className="muted">0</span>}</td>
                <td className="num">{r.used || <span className="muted">0</span>}</td>
                <td className="num"><strong style={{ color: r.onSite > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{r.onSite}</strong></td>
                <td>{r.required > 0 && r.sentQty >= r.required ? <span className="badge success dot">Fulfilled</span>
                  : r.sentQty > 0 ? <span className="badge accent dot">Pending {r.sentQty}/{r.required}</span>
                    : <span className="badge warning dot">Procuring</span>}</td>
                {canFulfil && <td style={{ whiteSpace: 'nowrap' }}>
                  {r.available > 0 && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input type="number" min="1" max={r.available} className="input mono" placeholder={String(r.available)} value={sel[r.id] != null ? sel[r.id] : ''} onChange={e => setSendQty(r, e.target.value)} style={{ width: 46, height: 24, textAlign: 'right' }} title={`Up to ${r.available}`}/>
                    <button className="btn btn-sm btn-primary" title="Send to supervisor" onClick={() => sendOne(r)}><Icon name="arrowRight" size={11}/>Send</button>
                  </span>}
                  {r.sentQty === 0 && r.available > 0 && <button className="btn btn-ghost btn-sm" title="Remove from BOQ" onClick={() => removeBoq(r)}><Icon name="x" size={11} color="var(--danger)"/></button>}
                </td>}
              </tr>
            ))}</tbody>
          </table>
        )}
        {canFulfil && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
              <input className="input" placeholder="Add an item to the site BOQ (search or type)…" value={pAddSearch} onChange={e => setPAddSearch(e.target.value)} style={{ width: '100%' }}/>
              {pAddResults.length > 0 && <div style={{ position: 'absolute', zIndex: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2, width: '100%' }}>{pAddResults.map(p => <div key={p.id} className="queue-item" style={{ cursor: 'pointer' }} onClick={() => purchaseAddBoq(p)}><div className="grow small">{p.name}<span className="tiny muted mono"> · {p.code}</span></div><Icon name="plus" size={11}/></div>)}</div>}
            </div>
            <input type="number" min="1" className="input mono" value={pAddQty} onChange={e => setPAddQty(e.target.value)} style={{ width: 64 }} title="Qty"/>
            <button className="btn btn-sm" onClick={() => purchaseAddBoq(null)}><Icon name="plus" size={11}/>Add item</button>
          </div>
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

  // Cross-SO transfers that have actually moved: the destination PM confirmed
  // receipt against the delivery challan ('Confirmed'). Legacy one-step approvals
  // (no challan) still count so nothing already in flight breaks. In = received
  // into this VG; Out = lent away.
  const approved = (state.transfer_requests || []).filter(t => t.status === 'Confirmed' || (t.status === 'Approved' && !t.challan));
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
  // Pool stock COMMITTED to this SO (via "Add from Master Pool"). Merely having a
  // product sitting in the global Master Pool must NOT count as in-hand here —
  // that made components show as fulfilled without ever being allocated/received.
  const poolAllocByProd = {};
  (so.pool_alloc || []).forEach(a => { poolAllocByProd[a.product_id] = (poolAllocByProd[a.product_id] || 0) + (Number(a.qty) || 0); });

  // Pool check + transfer reflection
  const pool = state.pool;
  const enriched = allComponents.map(c => {
    const poolItem = pool.find(p => p.product_id === c.product_id);
    const poolQty = poolItem ? poolItem.qty : 0;              // global availability (informational only)
    const tIn = transferredIn[c.product_id] || 0;
    const tOut = transferredOut[c.product_id] || 0;
    const fromPool = poolAllocByProd[c.product_id] || 0;      // allocated to this SO (already inside grossReceived)
    const toProcure = Math.max(0, c.qty - fromPool - tIn);    // pool alloc + transfer-in reduce fresh procurement
    const product = getProduct(c.product_id) || { name: c.product_id, code: c.product_id };
    const grossReceived = recvByProd[c.product_id] || 0;      // GRN-accepted + committed pool stock
    const sentToPool = pooledOut[c.product_id] || 0;          // later diverted to Master Pool
    const received = Math.max(0, grossReceived - sentToPool);
    const available = Math.max(0, tIn - tOut);                // transfers only; pool alloc already counted above
    const inHand = Math.max(0, available + received);         // net stock this VG holds for the customer
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
  const { state, mutate, getSO, getProduct, getUser, getCustomer, navigate, currentUser } = useStore();
  const toast = useToast();
  const role = getUser(currentUser).role;
  const canInitiate = canDo(role, 'initiateTransfer') || role === 'Org Admin';
  // Approval is by the SOURCE SO's PM (auto-detected from the SO) or an MD; the
  // DESTINATION SO's PM confirms receipt. If a SO has no PM assigned, any PM may
  // act so it never blocks. Same PM on both SOs → both steps come back to them.
  const isSoPM = (soId) => { const s = getSO(soId); return s && s.pm ? s.pm === currentUser : role === 'Project Manager'; };
  const canApproveT = (t) => ['Managing Director', 'Org Admin'].includes(role) || (role === 'Project Manager' && isSoPM(t.from_so));
  const canConfirmT = (t) => role === 'Org Admin' || (role === 'Project Manager' && isSoPM(t.to_so));
  const [showNew, setShowNew] = React.useState(false);
  const [approveT, setApproveT] = React.useState(null);
  const [viewChallan, setViewChallan] = React.useState(null);

  const requests = state.transfer_requests || [];
  const pending = requests.filter(t => ['Pending', 'Approved'].includes(t.status));
  const history = requests.filter(t => ['Confirmed', 'Rejected'].includes(t.status));

  const txLabel = (t) => `${getSO(t.from_so)?.so_no || t.from_so} → ${getSO(t.to_so)?.so_no || t.to_so}`;
  const itemsLabel = (t) => (t.items || []).map(it => `${it.qty}× ${getProduct(it.product_id)?.name || it.product_id}`).join(', ');
  const reject = (t) => {
    mutate(s => ({ ...s, transfer_requests: s.transfer_requests.map(x => x.id === t.id ? { ...x, status: 'Rejected', rejected_by: currentUser, rejected_role: role, rejected_date: TODAY } : x), notifications: [{ id: 'n-txr-' + Date.now(), kind: 'transfer', text: `Transfer ${txLabel(t)} rejected by ${role}`, date: TODAY, read: false, user_id: t.requested_by }, ...s.notifications] }), { action: 'reject', entity: 'TransferRequest', entity_id: t.challan ? t.challan.no : t.id, user_id: currentUser, detail: `Transfer rejected by ${role} · ${txLabel(t)} · ${itemsLabel(t)}` });
    toast('Transfer rejected', '');
  };
  const confirm = (t) => {
    const destPm = getSO(t.to_so)?.pm;
    mutate(s => ({ ...s, transfer_requests: s.transfer_requests.map(x => x.id === t.id ? { ...x, status: 'Confirmed', confirmed_by: currentUser, confirmed_date: TODAY } : x), notifications: [{ id: 'n-txc-' + Date.now(), kind: 'transfer', text: `Transfer ${t.challan ? t.challan.no + ' ' : ''}confirmed · stock moved ${txLabel(t)}`, date: TODAY, read: false, user_id: t.approved_by || t.requested_by }, ...s.notifications] }), { action: 'confirm', entity: 'TransferRequest', entity_id: t.challan ? t.challan.no : t.id, user_id: currentUser, detail: `Receipt confirmed by ${role}${destPm && destPm === currentUser ? ' (destination SO PM)' : ''} · stock moved ${txLabel(t)} · ${itemsLabel(t)}` });
    toast('Receipt confirmed · stock moved to the destination SO', 'success');
  };

  const txRow = (t) => {
    const fromSO = getSO(t.from_so); const toSO = getSO(t.to_so);
    const byUser = getUser(t.requested_by); const appr = getUser(t.approved_by); const conf = getUser(t.confirmed_by);
    return (
      <tr key={t.id}>
        <td><div className="mono">{fromSO?.so_no || '—'}</div>{fromSO && <div className="tiny muted trunc">{getCustomer(fromSO.customer_id)?.name}</div>}</td>
        <td><div className="mono">{toSO?.so_no || '—'}</div>{toSO && <div className="tiny muted trunc">{getCustomer(toSO.customer_id)?.name}</div>}</td>
        <td>{t.items.map((it, i) => { const p = getProduct(it.product_id); return <div key={i} className="small">{p?.name || it.product_id} <span className="mono muted">× {it.qty}</span></div>; })}</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Avatar user={byUser} size={18}/> <span className="tiny">{byUser?.name?.split(' ')[0] || '—'}</span></div>
          {appr && <div className="tiny muted mt-1" title={`Approved ${fmtDate(t.approved_date)}`}>✓ {appr.name?.split(' ')[0]} ({t.approved_role})</div>}
          {conf && <div className="tiny" style={{ color: 'var(--success)' }} title={`Confirmed ${fmtDate(t.confirmed_date)}`}>↓ received by {conf.name?.split(' ')[0]}</div>}
        </td>
        <td>{t.status === 'Pending' ? <span className="badge warning dot">Awaiting approval</span> : t.status === 'Approved' ? <span className="badge accent dot">Approved · awaiting receipt</span> : t.status === 'Confirmed' ? <span className="badge success dot">Confirmed · moved</span> : <span className="badge danger dot">Rejected</span>}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {t.challan && <button className="btn btn-ghost btn-sm" title="View delivery challan" onClick={() => setViewChallan(t)}><Icon name="file" size={11}/>Challan</button>}
          {t.status === 'Pending' && (canApproveT(t) ? <><button className="btn btn-sm btn-primary" onClick={() => setApproveT(t)}><Icon name="check" size={11}/>Approve</button><button className="btn btn-sm" onClick={() => reject(t)}><Icon name="x" size={11}/>Reject</button></> : <span className="tiny muted">awaiting {getSO(t.from_so)?.pm ? getUser(getSO(t.from_so).pm)?.name?.split(' ')[0] + ' / MD' : 'source PM / MD'}</span>)}
          {t.status === 'Approved' && (canConfirmT(t) ? <><button className="btn btn-sm btn-primary" onClick={() => confirm(t)}><Icon name="check" size={11}/>Confirm receipt</button><button className="btn btn-sm" onClick={() => reject(t)}><Icon name="x" size={11}/>Reject</button></> : <span className="tiny muted">awaiting {getSO(t.to_so)?.pm ? getUser(getSO(t.to_so).pm)?.name?.split(' ')[0] : 'destination PM'}</span>)}
        </td>
      </tr>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cross-SO Transfers</h1>
          <div className="page-sub">Move line items between orders · PM/MD approves + issues a delivery challan · destination PM confirms receipt</div>
        </div>
        <div className="page-actions">
          {canInitiate && <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="plus" size={13}/>Request transfer</button>}
        </div>
      </div>

      <div style={{ background: 'var(--info-bg)', border: '1px solid oklch(0.86 0.05 260)', padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 12.5, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="alert" size={14} color="var(--info)"/>
        <span><strong>Two-way approval:</strong> the source PM <em>or</em> an MD approves (either one) and issues a delivery challan; the destination PM checks the challan &amp; goods and confirms receipt — only then does the stock move (added to the destination SO, removed from the source). Customer tax invoices never reference the other SO.</span>
      </div>

      <div className="card">
        <div className="card-header"><h3 className="card-title">Open transfers ({pending.length})</h3></div>
        <div className="card-body flush">
          {pending.length === 0 ? <div className="empty">No open transfers.</div> : (
            <table className="t">
              <thead><tr><th>From SO</th><th>To SO</th><th>Items</th><th>Requested / approved</th><th>Status</th><th></th></tr></thead>
              <tbody>{pending.map(txRow)}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mt-2">
        <div className="card-header"><h3 className="card-title">History ({history.length})</h3><span className="card-sub">confirmed &amp; rejected transfers</span></div>
        <div className="card-body flush">
          {history.length === 0 ? <div className="empty">No completed transfers yet.</div> : (
            <table className="t">
              <thead><tr><th>From SO</th><th>To SO</th><th>Items</th><th>Requested / approved</th><th>Status</th><th></th></tr></thead>
              <tbody>{history.map(txRow)}</tbody>
            </table>
          )}
        </div>
      </div>

      {showNew && <NewTransferModal onClose={() => setShowNew(false)}/>}
      {approveT && <ApproveTransferModal transfer={approveT} onClose={() => setApproveT(null)}/>}
      {viewChallan && <DeliveryChallanModal transfer={viewChallan} onClose={() => setViewChallan(null)}/>}
    </div>
  );
}

// Source PM/MD approves a transfer and fills the delivery challan (rates, delivery
// cost, transport). Generates a structured challan; the destination PM then confirms.
function ApproveTransferModal({ transfer, onClose }) {
  const { state, mutate, getSO, getProduct, getUser, getCustomer, currentUser } = useStore();
  const toast = useToast();
  const role = getUser(currentUser).role;
  const fromSO = getSO(transfer.from_so); const toSO = getSO(transfer.to_so);
  const [items, setItems] = React.useState(transfer.items.map(it => { const p = getProduct(it.product_id); return { product_id: it.product_id, name: p ? p.name : it.product_id, code: p ? p.code : '', hsn: p ? p.hsn || '' : '', qty: Number(it.qty) || 0, rate: p ? (p.buy || 0) : 0 }; }));
  const [deliveryCost, setDeliveryCost] = React.useState('');
  const [transport, setTransport] = React.useState('Road');
  const [vehicle, setVehicle] = React.useState('');
  const [lr, setLr] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [applyGst, setApplyGst] = React.useState(false);
  const setItem = (i, patch) => setItems(its => its.map((x, j) => j === i ? { ...x, ...patch } : x));
  const subtotal = items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const dc = Number(deliveryCost) || 0;
  const gst = applyGst ? Math.round((subtotal + dc) * 0.18) : 0;
  const total = subtotal + dc + gst;

  const submit = () => {
    if (items.some(it => (Number(it.qty) || 0) <= 0)) { toast('Every item needs a quantity'); return; }
    const seq = (state.transfer_requests || []).filter(t => t.challan).length;
    const challan = {
      no: `DC/FY26/${String(1 + seq).padStart(4, '0')}`, date: TODAY,
      reason: 'Cross-SO stock transfer — internal re-allocation (not a sale)',
      transport, vehicle, lr, delivery_cost: dc, notes,
      items: items.map(it => ({ ...it, qty: Number(it.qty) || 0, rate: Number(it.rate) || 0, amount: Math.round((Number(it.qty) || 0) * (Number(it.rate) || 0)) })),
      subtotal: Math.round(subtotal), gst, total: Math.round(total), apply_gst: applyGst,
    };
    const destPm = toSO && toSO.pm;   // confirmation goes to the DESTINATION SO's PM (auto-detected)
    const label = `${fromSO?.so_no} → ${toSO?.so_no}`;
    mutate(s => ({
      ...s,
      transfer_requests: s.transfer_requests.map(t => t.id === transfer.id ? { ...t, status: 'Approved', approved_by: currentUser, approved_role: role, approved_date: TODAY, items: challan.items.map(it => ({ product_id: it.product_id, qty: it.qty })), challan } : t),
      notifications: [{ id: 'n-txa-' + Date.now(), kind: 'transfer', text: `Confirm receipt: transfer ${challan.no} · ${label} · check the challan & goods`, date: TODAY, read: false, ...(destPm ? { user_id: destPm } : { role: 'Project Manager' }) }, ...s.notifications],
    }), { action: 'approve', entity: 'TransferRequest', entity_id: challan.no, user_id: currentUser, detail: `Transfer approved by ${role} · challan ${challan.no} issued · ${label} · ${challan.items.map(it => `${it.qty}× ${it.name}`).join(', ')}` });
    toast(`Approved · ${challan.no} generated`, 'success');
    onClose();
  };

  return (
    <Modal title={`Approve transfer & issue delivery challan`} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}><Icon name="check" size={13}/>Approve &amp; generate challan</button></>}>
      <div className="tiny muted mb-2">{fromSO?.so_no} <Icon name="arrowRight" size={10}/> {toSO?.so_no} · approving as <strong>{role}</strong>. Fill the movement details; the destination PM confirms receipt against this challan.</div>
      <table className="t">
        <thead><tr><th>Item</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Value</th></tr></thead>
        <tbody>{items.map((it, i) => (
          <tr key={i}>
            <td>{it.name}<div className="tiny muted mono">{it.code}</div></td>
            <td><input className="input mono" value={it.hsn} onChange={e => setItem(i, { hsn: e.target.value })} style={{ width: 72, height: 24 }}/></td>
            <td className="num"><input type="number" min="0" className="input mono" value={it.qty} onChange={e => setItem(i, { qty: e.target.value })} style={{ width: 60, height: 24, textAlign: 'right' }}/></td>
            <td className="num"><input type="number" min="0" className="input mono" value={it.rate} onChange={e => setItem(i, { rate: e.target.value })} style={{ width: 84, height: 24, textAlign: 'right' }}/></td>
            <td className="num mono">{inr((Number(it.qty) || 0) * (Number(it.rate) || 0))}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="field-row-3 mt-2">
        <div className="field"><label className="field-label">Transport mode</label><select className="select" value={transport} onChange={e => setTransport(e.target.value)}><option>Road</option><option>Rail</option><option>Hand delivery</option><option>Courier</option></select></div>
        <div className="field"><label className="field-label">Vehicle no.</label><input className="input mono" value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="MH-04-AB-1234"/></div>
        <div className="field"><label className="field-label">LR / docket</label><input className="input mono" value={lr} onChange={e => setLr(e.target.value)}/></div>
      </div>
      <div className="field-row mt-2">
        <div className="field"><label className="field-label">Delivery / freight cost (₹)</label><input type="number" min="0" className="input mono" value={deliveryCost} onChange={e => setDeliveryCost(e.target.value)} placeholder="0"/></div>
        <div className="field"><label className="field-label">Apply 18% GST on the challan</label><div style={{ marginTop: 6 }}><label style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}><input type="checkbox" checked={applyGst} onChange={e => setApplyGst(e.target.checked)}/> Charge GST (leave off for a pure internal transfer)</label></div></div>
      </div>
      <div className="field mt-2"><label className="field-label">Notes</label><textarea className="textarea" rows="2" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason / handling instructions…"/></div>
      <div className="dl mt-2" style={{ gridTemplateColumns: '1fr auto', maxWidth: 320, marginLeft: 'auto', fontSize: 12.5 }}>
        <dt>Goods value</dt><dd className="num mono right">{inr(subtotal)}</dd>
        <dt>Delivery cost</dt><dd className="num mono right">{inr(dc)}</dd>
        {applyGst && <><dt>GST @ 18%</dt><dd className="num mono right">{inr(gst)}</dd></>}
        <dt style={{ fontWeight: 700 }}>Challan total</dt><dd className="num mono right" style={{ fontWeight: 700 }}>{inr(total)}</dd>
      </div>
    </Modal>
  );
}

// The delivery challan document (structured, GST-aware) for an internal transfer.
function DeliveryChallanModal({ transfer, onClose }) {
  const { state, getSO, getCustomer, getProduct, getUser } = useStore();
  const ch = transfer.challan; if (!ch) return null;
  const fromSO = getSO(transfer.from_so); const toSO = getSO(transfer.to_so);
  const fromCust = fromSO ? getCustomer(fromSO.customer_id) : null;
  const toCust = toSO ? getCustomer(toSO.customer_id) : null;
  const appr = getUser(transfer.approved_by); const conf = getUser(transfer.confirmed_by);
  return (
    <Modal title={`Delivery Challan — ${ch.no}`} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn"><Icon name="print" size={13}/>Print</button></>}>
      <div className="doc-paper" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--border-strong)', paddingBottom: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="brand-mark" style={{ width: 30, height: 30, fontSize: 15 }}>B</div><div><h2 style={{ margin: 0, fontSize: 16 }}>{state.org.name}</h2><div className="small muted">{state.org.address}</div><div className="small mono">GSTIN: {state.org.gstin} · State: {state.org.state}</div></div></div>
          </div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em' }}>DELIVERY CHALLAN</div><div className="small mono">{ch.no}</div><div className="tiny muted">Not a tax invoice</div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: '10px 0' }}>
          <div><div className="tiny muted" style={{ textTransform: 'uppercase' }}>Consign from (source order)</div><div className="small mono">{fromSO?.so_no}</div><div className="small">{fromCust?.name}</div></div>
          <div><div className="tiny muted" style={{ textTransform: 'uppercase' }}>Consign to (destination order)</div><div className="small mono">{toSO?.so_no}</div><div className="small">{toCust?.name}</div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 8, background: 'var(--bg-subtle)', borderRadius: 4, marginBottom: 10 }}>
          <div><div className="tiny muted">Date</div><div className="mono small">{fmtDate(ch.date)}</div></div>
          <div><div className="tiny muted">Transport</div><div className="small">{ch.transport}</div></div>
          <div><div className="tiny muted">Vehicle</div><div className="mono small">{ch.vehicle || '—'}</div></div>
          <div><div className="tiny muted">LR / docket</div><div className="mono small">{ch.lr || '—'}</div></div>
        </div>
        <div className="tiny muted mb-1">Reason for transportation: <strong>{ch.reason}</strong></div>
        <table style={{ width: '100%', fontSize: 12 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>#</th><th style={{ textAlign: 'left' }}>Description</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Value</th></tr></thead>
          <tbody>{(ch.items || []).map((it, i) => (<tr key={i}><td>{i + 1}</td><td>{it.name}<div className="tiny muted mono">{it.code}</div></td><td className="mono">{it.hsn || '—'}</td><td className="num mono">{it.qty}</td><td className="num mono">{inr(it.rate)}</td><td className="num mono">{inr(it.amount)}</td></tr>))}</tbody>
        </table>
        <table className="totals" style={{ marginTop: 8 }}><tbody>
          <tr><td>Goods value</td><td className="num mono right">{inr(ch.subtotal)}</td></tr>
          <tr><td>Delivery / freight</td><td className="num mono right">{inr(ch.delivery_cost || 0)}</td></tr>
          {ch.apply_gst && <tr><td>GST @ 18%</td><td className="num mono right">{inr(ch.gst || 0)}</td></tr>}
          <tr className="grand"><td>Total</td><td className="num mono right">{inr(ch.total)}</td></tr>
        </tbody></table>
        {ch.notes && <div className="tiny muted mt-2"><strong>Notes:</strong> {ch.notes}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div><div className="tiny muted">Approved by</div><div className="small">{appr ? `${appr.name} (${transfer.approved_role})` : '—'} · {fmtDate(transfer.approved_date)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="tiny muted">Received &amp; confirmed by</div><div className="small">{conf ? `${conf.name}` : 'Pending confirmation'}{conf ? ` · ${fmtDate(transfer.confirmed_date)}` : ''}</div></div>
        </div>
        <div className="tiny muted" style={{ marginTop: 10, textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 6 }}>Internal delivery challan (CGST Rule 55) — documents movement of goods between sales orders, not a sale. No input tax credit passes on this document.</div>
      </div>
    </Modal>
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
    const trId = 'tr-' + Date.now();
    const srcPm = getSO(fromSO)?.pm;   // approval goes to the SOURCE SO's PM (auto-detected)
    const label = `${getSO(fromSO)?.so_no} → ${getSO(toSO)?.so_no}`;
    const pn = getProduct(productId)?.name;
    mutate(s => ({
      ...s,
      transfer_requests: [...s.transfer_requests, {
        id: trId,
        from_so: fromSO, to_so: toSO,
        items: [{ product_id: productId, qty }],
        status: 'Pending', requested_by: currentUser, requested_date: TODAY, reason,
      }],
      notifications: [
        // Source SO's PM (specific user if assigned, else any PM) + MD — either approves.
        { id: 'n-tr-' + Date.now(), kind: 'transfer', text: `Approve transfer: ${qty}× ${pn} · ${label}`, date: TODAY, read: false, ...(srcPm ? { user_id: srcPm } : { role: 'Project Manager' }) },
        { id: 'n-trm-' + Date.now(), kind: 'transfer', text: `Transfer awaiting approval: ${qty}× ${pn} · ${label}`, date: TODAY, read: false, role: 'Managing Director' },
        ...s.notifications,
      ],
    }), { action: 'request', entity: 'TransferRequest', entity_id: trId, user_id: currentUser, detail: `Cross-SO transfer requested · ${qty}× ${pn} · ${label}` });
    toast('Transfer request raised · source SO PM notified', 'success');
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
