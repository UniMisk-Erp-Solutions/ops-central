// OP Central — Masters: Customers, Vendors, Products, BOMs, Audit Log, My Approvals

function CustomersList() {
  const { state, navigate } = useStore();
  const [showNew, setShowNew] = React.useState(false);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <div className="page-sub">{state.customers.length} customer{state.customers.length !== 1 ? 's' : ''} · GSTIN validated</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="upload" size={13}/>Import (Excel / Tally)</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="plus" size={13}/>New customer</button>
        </div>
      </div>
      {showNew && <NewCustomerModal onClose={() => setShowNew(false)}/>}

      <div className="card">
        <div className="filter-bar">
          <input className="input search" placeholder="Search customer, GSTIN, state…" style={{ flex: '0 0 240px' }}/>
          <select className="select" style={{ width: 110 }}><option>All tiers</option><option>Platinum</option><option>Gold</option><option>Silver</option></select>
          <select className="select" style={{ width: 130 }}><option>All states</option></select>
          <div className="grow"/>
        </div>
        <div className="table-wrap">
          <table className="t zebra">
            <thead><tr>
              <th>Code</th><th>Name</th><th>GSTIN</th><th>State</th><th>Contact</th>
              <th>Terms</th><th className="num">Credit Limit</th><th>Tier</th>
            </tr></thead>
            <tbody>
              {state.customers.map(c => {
                const overdue = state.sales_orders.filter(s => s.customer_id === c.id && s.days_overdue > 0);
                const outstanding = state.sales_orders.filter(s => s.customer_id === c.id && s.status === 'Payment Pending').reduce((sum, s) => sum + (s.invoice_amount || 0), 0);
                return (
                  <tr key={c.id} onClick={() => navigate(`customers/${c.id}/ledger`)} style={{ cursor: 'pointer' }}>
                    <td className="mono small">{c.code}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{c.name}</span>
                        {overdue.length > 0 && <span className="badge danger" title={`${overdue.length} overdue`}>!</span>}
                      </div>
                      <div className="tiny muted">Outstanding {inr(outstanding)}</div>
                    </td>
                    <td className="mono small">{c.gstin}</td>
                    <td>{c.state}</td>
                    <td><div className="small">{c.contact}</div><div className="tiny muted mono">{c.phone}</div></td>
                    <td>{c.terms}</td>
                    <td className="num">{inrK(c.credit_limit)}</td>
                    <td>
                      <span className={`badge ${c.tier === 'Platinum' ? 'accent' : c.tier === 'Gold' ? 'warning' : ''}`}>{c.tier}</span>
                    </td>
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

function CustomerLedger({ custId }) {
  const { state, navigate, getCustomer } = useStore();
  const c = getCustomer(custId);
  if (!c) return <div className="page"><div className="empty">Customer not found</div></div>;
  const sos = state.sales_orders.filter(s => s.customer_id === custId);
  const outstanding = sos.filter(s => s.status === 'Payment Pending').reduce((sum, s) => sum + (s.invoice_amount || 0), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('customers')}>
            <Icon name="chevronLeft" size={12}/> Customers
          </div>
          <h1 className="page-title">{c.name}</h1>
          <div className="page-sub"><span className="mono">{c.gstin}</span> · {c.state} · {c.tier} tier</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="edit" size={13}/>Edit</button>
          <button className="btn btn-primary"><Icon name="plus" size={13}/>New Sales Order</button>
        </div>
      </div>

      <div className="kpi-grid mb-3">
        <div className="kpi"><div className="kpi-label">Lifetime sales</div><div className="kpi-value">{inrK(sos.reduce((s,o) => s + (o.invoice_amount || 0), 0) * 3.2)}</div><div className="kpi-delta">3-year value</div></div>
        <div className="kpi"><div className="kpi-label">Outstanding</div><div className="kpi-value">{inrK(outstanding)}</div><div className="kpi-delta">{sos.filter(s => s.status === 'Payment Pending').length} invoices</div></div>
        <div className="kpi"><div className="kpi-label">Credit limit</div><div className="kpi-value">{inrK(c.credit_limit)}</div><div className="kpi-delta">{Math.round((outstanding / c.credit_limit) * 100)}% utilised</div></div>
        <div className="kpi"><div className="kpi-label">Avg DSO</div><div className="kpi-value">42d</div><div className="kpi-delta">Days sales outstanding</div></div>
      </div>

      <div className="split-2to1">
        <div className="card">
          <div className="card-header"><h3 className="card-title">Transactions</h3></div>
          <div className="card-body flush">
            <table className="t">
              <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {sos.filter(s => s.invoice_no).map((s, i) => (
                  <Fragment key={s.id}>
                    <tr>
                      <td className="mono small">{fmtDate(s.invoice_date)}</td>
                      <td><span className="badge">Invoice</span></td>
                      <td className="mono small">{s.invoice_no}</td>
                      <td className="num">{inr(s.invoice_amount)}</td>
                      <td></td>
                      <td className="num">{inr(s.invoice_amount * (i + 1) * 0.7)}</td>
                    </tr>
                    {s.status === 'Fully Paid' && (
                      <tr>
                        <td className="mono small">{fmtDate(new Date(new Date(s.invoice_date).getTime() + 25 * 86400000).toISOString().slice(0,10))}</td>
                        <td><span className="badge success">Receipt</span></td>
                        <td className="mono small">RCP-{1000 + i}</td>
                        <td></td>
                        <td className="num">{inr(s.invoice_amount)}</td>
                        <td className="num">{inr(s.invoice_amount * i * 0.7)}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Profile</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>Code</dt><dd className="mono">{c.code}</dd>
                <dt>GSTIN</dt><dd className="mono">{c.gstin}</dd>
                <dt>Address</dt><dd>{c.address}</dd>
                <dt>Contact</dt><dd>{c.contact}</dd>
                <dt>Phone</dt><dd className="mono">{c.phone}</dd>
                <dt>Payment terms</dt><dd>{c.terms}</dd>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Open SOs</h3></div>
            <div className="card-body flush">
              {sos.filter(s => !['Closed','Fully Paid','Cancelled'].includes(s.status)).map(s => (
                <div key={s.id} className="queue-item" onClick={() => navigate(`sales-orders/${s.id}`)}>
                  <div className="grow">
                    <div className="small mono">{s.so_no}</div>
                    <div className="tiny muted">{s.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VendorsList() {
  const { state, navigate } = useStore();
  const [showNew, setShowNew] = React.useState(false);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendors</h1>
          <div className="page-sub">{state.vendors.length} vendors · used by Purchase when floating RFQs / POs</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="upload" size={13}/>Import</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}><Icon name="plus" size={13}/>New vendor</button>
        </div>
      </div>
      {showNew && <NewVendorModal onClose={() => setShowNew(false)}/>}

      <div className="card">
        <div className="filter-bar">
          <input className="input search" placeholder="Search vendor, GSTIN, city…" style={{ flex: '0 0 240px' }}/>
        </div>
        <div className="table-wrap">
          <table className="t zebra">
            <thead><tr>
              <th>Code</th><th>Name</th><th>GSTIN</th><th>City</th><th>Contact</th>
              <th>Type</th><th>Terms</th><th className="num">Rating</th><th>Last LPP</th>
            </tr></thead>
            <tbody>
              {state.vendors.map(v => (
                <tr key={v.id}>
                  <td className="mono small">{v.code}</td>
                  <td>{v.name}</td>
                  <td className="mono small">{v.gstin}</td>
                  <td>{v.city}</td>
                  <td><div className="small">{v.contact}</div><div className="tiny muted mono">{v.phone}</div></td>
                  <td>{v.type}</td>
                  <td>{v.terms}</td>
                  <td className="num">
                    <span style={{ color: v.rating >= 4.3 ? 'var(--success)' : v.rating < 4 ? 'var(--warning)' : 'var(--text)' }}>
                      ★ {v.rating}
                    </span>
                  </td>
                  <td className="mono small">{fmtDate((() => { const dt = new Date(TODAY); dt.setDate(dt.getDate() - 8); return dt.toISOString().slice(0,10); })())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProductsList() {
  const { state, navigate, getProduct } = useStore();
  const [tab, setTab] = React.useState('products');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Products & BOM Templates</h1>
          <div className="page-sub">Product catalogue · category BOMs auto-load when picked in SO line</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="upload" size={13}/>Import</button>
          <button className="btn btn-primary"><Icon name="plus" size={13}/>New {tab === 'products' ? 'product' : tab === 'bom' ? 'BOM' : 'category'}</button>
        </div>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={`tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>Products <span className="count mono">{state.products.length}</span></button>
          <button className={`tab ${tab === 'categories' ? 'active' : ''}`} onClick={() => setTab('categories')}>Categories <span className="count mono">{state.categories.length}</span></button>
          <button className={`tab ${tab === 'bom' ? 'active' : ''}`} onClick={() => setTab('bom')}>BOM Templates <span className="count mono">{Object.keys(state.boms).length}</span></button>
        </div>
        <div className="card-body flush">
          {tab === 'products' && (
            <table className="t zebra">
              <thead><tr><th>Code</th><th>Product</th><th>HSN</th><th>UOM</th><th className="num">GST</th><th className="num">Buy</th><th className="num">Sell</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {state.products.map(p => (
                  <tr key={p.id}>
                    <td className="mono small">{p.code}</td>
                    <td>{p.name}</td>
                    <td className="mono small">{p.hsn}</td>
                    <td>{p.uom}</td>
                    <td className="num">{p.gst}%</td>
                    <td className="num">{inr(p.buy)}</td>
                    <td className="num">{inr(p.sell)}</td>
                    <td className="num"><span style={{ color: 'var(--success)' }}>{Math.round((p.sell - p.buy) / p.buy * 100)}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'categories' && (
            <table className="t">
              <thead><tr><th>Category</th><th>HSN</th><th className="num">GST</th><th>Default bundle description</th><th className="num">Components</th></tr></thead>
              <tbody>
                {state.categories.map(c => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td className="mono small">{c.hsn}</td>
                    <td className="num">{c.gst}%</td>
                    <td className="small">{c.bundle_desc}</td>
                    <td className="num">{(state.boms[c.id] || []).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'bom' && (
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {state.categories.map(cat => {
                const bom = state.boms[cat.id] || [];
                return (
                  <div key={cat.id} className="card">
                    <div className="card-header">
                      <div>
                        <h3 className="card-title">{cat.name}</h3>
                        <div className="tiny muted">HSN <span className="mono">{cat.hsn}</span> · GST {cat.gst}%</div>
                      </div>
                      <button className="btn btn-ghost btn-sm"><Icon name="edit" size={11}/></button>
                    </div>
                    <div className="card-body flush">
                      <table className="t">
                        <tbody>
                          {bom.map((c, i) => {
                            const p = getProduct(c.product_id);
                            return (
                              <tr key={i}>
                                <td><span className="small">{p.name}</span></td>
                                <td className="num mono small">× {c.qty}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Approval Inbox =====
function ApprovalInbox() {
  const { state, navigate, currentUser, getUser, mutate } = useStore();
  const toast = useToast();
  const u = getUser(currentUser);
  const tasks = window.tasksForRole(state, u.role, mutate, navigate, toast);

  const groupedByKind = {};
  tasks.forEach(t => {
    groupedByKind[t.kind] = groupedByKind[t.kind] || [];
    groupedByKind[t.kind].push(t);
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Tasks</h1>
          <div className="page-sub">{tasks.length} item{tasks.length !== 1 ? 's' : ''} pending for <strong>{u.role}</strong> · {u.name}</div>
        </div>
        <div className="page-actions">
          <span className="muted small">Real-time · driven by workflow state</span>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <div className="empty">
            <Icon name="check" size={28} color="var(--success)"/>
            <div className="empty-title mt-2">All clear</div>
            No tasks waiting on you. As work flows through the system, items will land here.
            <div className="mt-2"><button className="btn btn-primary" onClick={() => navigate('dashboard')}>Go to dashboard</button></div>
          </div>
        </div>
      ) : (
        Object.entries(groupedByKind).map(([kind, items]) => (
          <div key={kind} className="card mb-2">
            <div className="card-header">
              <h3 className="card-title">{kind} <span className="muted small">· {items.length}</span></h3>
            </div>
            <div className="card-body flush">
              {items.map(it => (
                <div key={it.id} className="queue-item" style={{ padding: '12px 14px' }}>
                  <Icon name={it.icon} size={16} color="var(--text-3)"/>
                  <div className="grow">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong className="small">{it.kind}</strong>
                      <span className="badge mono">{it.ref}</span>
                      {it.amount > 0 && <span className="muted small">· {inr(it.amount)}</span>}
                    </div>
                    <div className="small mt-1">{it.detail}</div>
                    <div className="tiny muted mt-1">From {it.by} · gate: {it.gate}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {it.navigateTo && (
                      <button className="btn btn-sm" onClick={() => navigate(it.navigateTo)}>
                        <Icon name="eye" size={11}/>View
                      </button>
                    )}
                    {it.reject && (
                      <button className="btn btn-sm btn-danger" onClick={it.reject}>
                        <Icon name="x" size={11}/>Reject
                      </button>
                    )}
                    {it.approve && (
                      <button className="btn btn-sm btn-primary" onClick={it.approve}>
                        <Icon name="check" size={11}/>{it.approveLabel || 'Approve'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ===== Audit Log =====
function AuditLog() {
  const { state } = useStore();
  const entries = [
    { ts: '21-May-2026 09:42:12', user: 'Arun Bhatia', role: 'Stores', action: 'POST', entity: 'GRN', ref: 'GRN/FY26/0028', detail: '24 items received against VPO/FY26/0040', ip: '10.0.0.42' },
    { ts: '21-May-2026 09:18:55', user: 'Divya Shah', role: 'Project Manager', action: 'CREATE', entity: 'TransferRequest', ref: 'TR-001', detail: 'Cross-SO transfer · 4×RAM from SO/0016 → SO/0015', ip: '10.0.0.18' },
    { ts: '21-May-2026 08:55:31', user: 'Pooja Nair', role: 'Purchase', action: 'CREATE', entity: 'RFQ', ref: 'RFQ/FY26/0023', detail: 'Floated to TechSource, Compworld, Rapid Networks, Prime Computech', ip: '10.0.0.27' },
    { ts: '20-May-2026 16:05:09', user: 'Mukesh Desai', role: 'Managing Director', action: 'APPROVE', entity: 'VendorPO', ref: 'VPO/FY26/0041', detail: 'Tier ₹1L-₹5L · 285600 INR', ip: '49.205.x.x' },
    { ts: '20-May-2026 14:30:00', user: 'Tara Pillai', role: 'Collections', action: 'LOG', entity: 'FollowUp', ref: 'INV/FY26/0049', detail: 'WhatsApp sent to Mehta Textiles · auto-template T+30', ip: '10.0.0.55' },
    { ts: '20-May-2026 11:48:22', user: 'Sneha Rao', role: 'Billing', action: 'CREATE', entity: 'Invoice', ref: 'INV/FY26/0072', detail: 'For SO/FY26/0011 · ₹1,50,450 · IRN generated · EWB linked', ip: '10.0.0.34' },
    { ts: '19-May-2026 17:22:14', user: 'Aanya Kapoor', role: 'Org Admin', action: 'UPDATE', entity: 'Configuration', ref: 'approval_gates.g2', detail: 'Vendor PO ₹1L-₹5L threshold adjusted', ip: '10.0.0.2' },
    { ts: '19-May-2026 10:15:00', user: 'Karan Mehra', role: 'Sales', action: 'CREATE', entity: 'SalesOrder', ref: 'SO/FY26/0014', detail: 'Rana Constructions · PO RC/PO/2026/0312', ip: '10.0.0.61' },
    { ts: '15-May-2026 14:09:48', user: 'Ravi Iyer', role: 'Project Manager', action: 'OVERRIDE', entity: 'SOLine', ref: 'SO/FY26/0015 / RAM-DDR4-16', detail: 'Bundle qty override 8 → 10', ip: '10.0.0.71' },
  ];
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <div className="page-sub">Every write is logged · before/after diff · 7-year retention (GST)</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={13}/>Filter</button>
          <button className="btn"><Icon name="download" size={13}/>Export</button>
        </div>
      </div>

      <div className="card">
        <div className="filter-bar">
          <input className="input search" placeholder="Search user, entity, ref…" style={{ flex: '0 0 240px' }}/>
          <select className="select" style={{ width: 130 }}><option>All actions</option><option>CREATE</option><option>UPDATE</option><option>APPROVE</option><option>DELETE</option></select>
          <select className="select" style={{ width: 130 }}><option>All entities</option></select>
          <div className="grow"/>
          <span className="muted small">last 7 days</span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr>
              <th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Entity · Ref</th><th>Detail</th><th>IP</th>
            </tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="mono small">{e.ts}</td>
                  <td>{e.user}</td>
                  <td className="small muted">{e.role}</td>
                  <td>
                    <span className={`badge ${e.action === 'APPROVE' ? 'success' : e.action === 'OVERRIDE' ? 'warning' : 'accent'}`}>{e.action}</span>
                  </td>
                  <td>
                    <div className="small">{e.entity}</div>
                    <div className="tiny muted mono">{e.ref}</div>
                  </td>
                  <td className="small">{e.detail}</td>
                  <td className="mono tiny muted">{e.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===== Add Vendor / Add Customer modals =====
function NewVendorModal({ onClose }) {
  const { addVendor } = useStore();
  const toast = useToast();
  const [f, setF] = React.useState({ name: '', code: '', gstin: '', city: '', contact: '', phone: '', terms: 'Net 30', type: 'Goods', rating: 4.0 });
  const [busy, setBusy] = React.useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const submit = async () => {
    if (!f.name.trim()) { toast('Vendor name is required'); return; }
    setBusy(true);
    const res = await addVendor({ ...f, rating: Number(f.rating) || 4.0 });
    setBusy(false);
    if (!res.ok) { toast('Add failed: ' + (res.error || ''), ''); return; }
    toast(`${f.name} added`, 'success');
    onClose();
  };
  return (
    <Modal title="New vendor" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={submit}>{busy ? 'Adding…' : 'Add vendor'}</button>
      </>
    }>
      <div className="field-row">
        <div className="field"><label className="field-label">Vendor name *</label><input className="input" value={f.name} onChange={e => set('name', e.target.value)}/></div>
        <div className="field"><label className="field-label">Code</label><input className="input mono" value={f.code} onChange={e => set('code', e.target.value)} placeholder="V0006"/></div>
      </div>
      <div className="field-row mt-2">
        <div className="field"><label className="field-label">GSTIN</label><input className="input mono" value={f.gstin} onChange={e => set('gstin', e.target.value)}/></div>
        <div className="field"><label className="field-label">City</label><input className="input" value={f.city} onChange={e => set('city', e.target.value)}/></div>
      </div>
      <div className="field-row mt-2">
        <div className="field"><label className="field-label">Contact person</label><input className="input" value={f.contact} onChange={e => set('contact', e.target.value)}/></div>
        <div className="field"><label className="field-label">Phone</label><input className="input mono" value={f.phone} onChange={e => set('phone', e.target.value)}/></div>
      </div>
      <div className="field-row-3 mt-2">
        <div className="field"><label className="field-label">Payment terms</label>
          <select className="select" value={f.terms} onChange={e => set('terms', e.target.value)}>
            <option>Advance</option><option>Net 15</option><option>Net 30</option><option>Net 45</option><option>Net 60</option>
          </select>
        </div>
        <div className="field"><label className="field-label">Type</label>
          <select className="select" value={f.type} onChange={e => set('type', e.target.value)}><option>Goods</option><option>Services</option></select>
        </div>
        <div className="field"><label className="field-label">Rating</label><input type="number" step="0.1" min="0" max="5" className="input mono" value={f.rating} onChange={e => set('rating', e.target.value)}/></div>
      </div>
    </Modal>
  );
}

function NewCustomerModal({ onClose }) {
  const { addCustomer } = useStore();
  const toast = useToast();
  const [f, setF] = React.useState({ name: '', code: '', gstin: '', state: '', address: '', contact: '', phone: '', terms: 'Net 30', credit_limit: 0, tier: 'Silver' });
  const [busy, setBusy] = React.useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const submit = async () => {
    if (!f.name.trim()) { toast('Customer name is required'); return; }
    setBusy(true);
    const res = await addCustomer({ ...f, credit_limit: Number(f.credit_limit) || 0 });
    setBusy(false);
    if (!res.ok) { toast('Add failed: ' + (res.error || ''), ''); return; }
    toast(`${f.name} added`, 'success');
    onClose();
  };
  return (
    <Modal title="New customer" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={submit}>{busy ? 'Adding…' : 'Add customer'}</button>
      </>
    }>
      <div className="field-row">
        <div className="field"><label className="field-label">Customer name *</label><input className="input" value={f.name} onChange={e => set('name', e.target.value)}/></div>
        <div className="field"><label className="field-label">Code</label><input className="input mono" value={f.code} onChange={e => set('code', e.target.value)} placeholder="C0006"/></div>
      </div>
      <div className="field-row mt-2">
        <div className="field"><label className="field-label">GSTIN</label><input className="input mono" value={f.gstin} onChange={e => set('gstin', e.target.value)}/></div>
        <div className="field"><label className="field-label">State</label><input className="input" value={f.state} onChange={e => set('state', e.target.value)}/></div>
      </div>
      <div className="field mt-2"><label className="field-label">Address</label><textarea className="textarea" rows="2" value={f.address} onChange={e => set('address', e.target.value)}/></div>
      <div className="field-row mt-2">
        <div className="field"><label className="field-label">Contact person</label><input className="input" value={f.contact} onChange={e => set('contact', e.target.value)}/></div>
        <div className="field"><label className="field-label">Phone</label><input className="input mono" value={f.phone} onChange={e => set('phone', e.target.value)}/></div>
      </div>
      <div className="field-row-3 mt-2">
        <div className="field"><label className="field-label">Payment terms</label>
          <select className="select" value={f.terms} onChange={e => set('terms', e.target.value)}>
            <option>Advance</option><option>Net 15</option><option>Net 30</option><option>Net 45</option><option>Net 60</option>
          </select>
        </div>
        <div className="field"><label className="field-label">Credit limit (₹)</label><input type="number" className="input mono" value={f.credit_limit} onChange={e => set('credit_limit', e.target.value)}/></div>
        <div className="field"><label className="field-label">Tier</label>
          <select className="select" value={f.tier} onChange={e => set('tier', e.target.value)}><option>Silver</option><option>Gold</option><option>Platinum</option></select>
        </div>
      </div>
    </Modal>
  );
}

window.CustomersList = CustomersList;
window.CustomerLedger = CustomerLedger;
window.VendorsList = VendorsList;
window.ProductsList = ProductsList;
window.ApprovalInbox = ApprovalInbox;
window.AuditLog = AuditLog;
window.NewVendorModal = NewVendorModal;
window.NewCustomerModal = NewCustomerModal;
