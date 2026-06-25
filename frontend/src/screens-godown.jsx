// OP Central — Virtual Godown, Master Surplus Pool, Cross-SO Transfer

function VirtualGodownList() {
  const { state, navigate, getCustomer, soSubtotal, getProduct } = useStore();
  const orders = state.sales_orders.filter(s => !['Closed','Cancelled'].includes(s.status));

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

function VirtualGodownView({ soId, embedded }) {
  const { state, navigate, getSO, getCustomer, getProduct } = useStore();
  const so = getSO(soId);
  if (!so) return <div className="empty">Godown not found</div>;
  const cust = getCustomer(so.customer_id);

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
        <VGReceivePanel so={so}/>
        <VGPoolSendPanel so={so}/>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">VG Contents · {so.so_no}</h3>
            <div style={{ display: 'flex', gap: 12, fontSize: 11.5 }}>
              <span><span className="badge accent" style={{ marginRight: 4 }}>Pool</span>auto-allocated</span>
              <span><span className="badge info" style={{ marginRight: 4 }}>Transfer</span>cross-SO</span>
            </div>
          </div>
          <div className="card-body flush">
            <table className="t zebra">
              <thead><tr>
                <th>Component</th><th>Code</th>
                <th className="num">Required</th><th className="num">From Pool</th><th className="num">Transferred</th>
                <th className="num">Received</th><th className="num">→ Pool</th><th className="num">In hand</th><th className="num">Remaining</th><th>Status</th>
              </tr></thead>
              <tbody>
                {enriched.map(c => {
                  const net = c.transferredIn - c.transferredOut;
                  return (
                    <tr key={c.product_id}>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>

        <div className="stack">
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
    </Wrap>
  );
}

// ===== Master Pool =====
function MasterPool() {
  const { state, getProduct, getCustomer } = useStore();
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
          <button className="btn"><Icon name="filter" size={13}/>Filter by age</button>
          <button className="btn"><Icon name="download" size={13}/>Export</button>
        </div>
      </div>

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
window.VGPoolSendPanel = VGPoolSendPanel;
window.VirtualGodownList = VirtualGodownList;
window.VirtualGodownView = VirtualGodownView;
window.MasterPool = MasterPool;
window.CrossSOTransfers = CrossSOTransfers;
window.NewTransferModal = NewTransferModal;
