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

function VirtualGodownView({ soId, embedded }) {
  const { state, navigate, getSO, getCustomer, getProduct } = useStore();
  const so = getSO(soId);
  if (!so) return <div className="empty">Godown not found</div>;
  const cust = getCustomer(so.customer_id);

  // All components flattened
  const allComponents = [];
  so.lines.forEach(l => {
    l.components.forEach(c => {
      const existing = allComponents.find(x => x.product_id === c.product_id);
      if (existing) existing.qty += c.qty;
      else allComponents.push({ product_id: c.product_id, qty: c.qty });
    });
  });

  // Pool check
  const pool = state.pool;
  const enriched = allComponents.map(c => {
    const poolItem = pool.find(p => p.product_id === c.product_id);
    const poolQty = poolItem ? poolItem.qty : 0;
    const fromPool = Math.min(poolQty, c.qty);
    const toProcure = c.qty - fromPool;
    const product = getProduct(c.product_id);
    // Mock fulfilment status
    let received = 0;
    if (so.id === 'so-001' && ['p-cpu-i5','p-mobo-h610','p-ram-16'].includes(c.product_id)) {
      received = c.qty - (c.product_id === 'p-mobo-h610' ? 1 : 0); // 1 rejected
    }
    if (so.id === 'so-002') received = Math.floor(c.qty * 0.4);
    return { ...c, product, poolQty, fromPool, toProcure, received };
  });

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
      <div className="split-2to1">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">VG Contents · {so.so_no}</h3>
            <div style={{ display: 'flex', gap: 12, fontSize: 11.5 }}>
              <span><span className="badge accent" style={{ marginRight: 4 }}>Pool</span>auto-allocated</span>
              <span><span className="badge" style={{ marginRight: 4 }}>Procured</span>via Vendor PO</span>
            </div>
          </div>
          <div className="card-body flush">
            <table className="t zebra">
              <thead><tr>
                <th>Component</th><th>Code</th>
                <th className="num">Required</th><th className="num">From Pool</th><th className="num">Procured</th>
                <th className="num">Received</th><th>Status</th>
              </tr></thead>
              <tbody>
                {enriched.map(c => {
                  const balance = c.qty - c.fromPool - c.received;
                  return (
                    <tr key={c.product_id}>
                      <td>{c.product.name}</td>
                      <td className="mono small muted">{c.product.code}</td>
                      <td className="num">{c.qty}</td>
                      <td className="num"><span className="badge accent" style={{ minWidth: 28, justifyContent: 'center' }}>{c.fromPool}</span></td>
                      <td className="num">{c.toProcure}</td>
                      <td className="num">{c.received}</td>
                      <td>
                        {c.fromPool === c.qty ? <span className="badge success dot">Pool-fulfilled</span> :
                         c.received === c.toProcure ? <span className="badge success dot">Received</span> :
                         c.received > 0 ? <span className="badge warning dot">Partial</span> :
                         <span className="badge dot">Awaiting</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                <Icon name="package" size={14} color="var(--success)"/>
                <div className="grow">
                  <div className="small"><strong>GRN received</strong></div>
                  <div className="tiny muted">From vendor POs</div>
                </div>
                <span className="badge success">{enriched.reduce((s,c) => s + c.received, 0)}</span>
              </div>
              <div className="queue-item">
                <Icon name="cart" size={14} color="var(--text-3)"/>
                <div className="grow">
                  <div className="small"><strong>Awaiting procurement</strong></div>
                  <div className="tiny muted">RFQ or VPO</div>
                </div>
                <span className="badge">{enriched.reduce((s,c) => s + Math.max(0, c.toProcure - c.received), 0)}</span>
              </div>
              <div className="divider" style={{ margin: 0 }}/>
              <div className="queue-item">
                <Icon name="arrowLeftRight" size={14} color="var(--info)"/>
                <div className="grow">
                  <div className="small"><strong>Cross-SO transfers</strong></div>
                  <div className="tiny muted">Backend only</div>
                </div>
                <span className="badge info">0</span>
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

function NewTransferModal({ onClose }) {
  const { state, getSO, getProduct, mutate, currentUser } = useStore();
  const toast = useToast();
  const [fromSO, setFromSO] = React.useState('');
  const [toSO, setToSO] = React.useState('');
  const [productId, setProductId] = React.useState('');
  const [qty, setQty] = React.useState(1);
  const [reason, setReason] = React.useState('');

  const submit = () => {
    if (!fromSO || !toSO || !productId || !reason) return;
    mutate(s => ({
      ...s,
      transfer_requests: [...s.transfer_requests, {
        id: 'tr-' + Date.now(),
        from_so: fromSO, to_so: toSO,
        items: [{ product_id: productId, qty }],
        status: 'Pending', requested_by: currentUser, requested_date: TODAY, reason,
      }]
    }), { action: 'create', entity: 'TransferRequest' });
    toast('Transfer request raised · notification sent', 'success');
    onClose();
  };

  return (
    <Modal title="Request cross-SO transfer" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!fromSO || !toSO || !productId || !reason} onClick={submit}>Send request</button>
      </>
    }>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Lend from (source SO)</label>
          <select className="select" value={fromSO} onChange={e => setFromSO(e.target.value)}>
            <option value="">Pick source SO…</option>
            {state.sales_orders.filter(s => ['On Hold','Procurement Started','Material Received'].includes(s.status)).map(s =>
              <option key={s.id} value={s.id}>{s.so_no} · {s.status}</option>
            )}
          </select>
          <div className="field-hint">Usually on-hold SOs that won't dispatch soon</div>
        </div>
        <div className="field">
          <label className="field-label">Lend to (urgent SO)</label>
          <select className="select" value={toSO} onChange={e => setToSO(e.target.value)}>
            <option value="">Pick destination SO…</option>
            {state.sales_orders.filter(s => s.priority === 'Urgent' || s.priority === 'Critical').map(s =>
              <option key={s.id} value={s.id}>{s.so_no} · {s.priority}</option>
            )}
          </select>
        </div>
      </div>
      <div className="field-row mt-2">
        <div className="field">
          <label className="field-label">Item</label>
          <select className="select" value={productId} onChange={e => setProductId(e.target.value)}>
            <option value="">Pick item…</option>
            {state.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Quantity</label>
          <input type="number" className="input mono" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)}/>
        </div>
      </div>
      <div className="field mt-2">
        <label className="field-label">Reason</label>
        <textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this transfer is needed…"/>
      </div>
      <div className="mt-2 tiny muted" style={{ padding: 10, background: 'var(--info-bg)', borderRadius: 4 }}>
        On approval: items digitally re-allocate · source SO's RFQ auto-re-triggers for replacement · customer-facing documents on either side reference only their own SO.
      </div>
    </Modal>
  );
}

window.VirtualGodownList = VirtualGodownList;
window.VirtualGodownView = VirtualGodownView;
window.MasterPool = MasterPool;
window.CrossSOTransfers = CrossSOTransfers;
