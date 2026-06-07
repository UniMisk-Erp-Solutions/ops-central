// OP Central — Procurement screens: RFQ, Vendor PO, GRN, 3-Way Match

// ===== RFQ List + Detail =====
function RFQList() {
  const { state, navigate, currentUser, getUser } = useStore();
  const [showRFQ, setShowRFQ] = React.useState(false);
  const role = getUser(currentUser)?.role;
  const canFloat = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">RFQ Comparison</h1>
          <div className="page-sub">Side-by-side vendor quotes · select the winning vendor</div>
        </div>
        <div className="page-actions">
          {canFloat && <button className="btn btn-primary" onClick={() => setShowRFQ(true)}><Icon name="plus" size={13}/>Float new RFQ</button>}
        </div>
      </div>

      {state.rfqs.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="empty-title">No RFQs yet</div>
          Float an RFQ to selected vendors for an approved SO, record their quotes, then pick the winner.
          {canFloat && <div className="mt-2"><button className="btn btn-primary" onClick={() => setShowRFQ(true)}><Icon name="plus" size={13}/>Float new RFQ</button></div>}
        </div></div>
      ) : state.rfqs.map(rfq => <RFQCard key={rfq.id} rfq={rfq}/>)}

      {showRFQ && <CreateRFQModal onClose={() => setShowRFQ(false)}/>}
    </div>
  );
}

function RFQCard({ rfq }) {
  const { state, navigate, getSO, getVendor, mutate, currentUser, getUser } = useStore();
  const toast = useToast();
  const so = getSO(rfq.so_id);
  const role = getUser(currentUser).role;
  const canSelectWinner = canDo(role, 'selectVendor') || role === 'Org Admin';
  const [selected, setSelected] = React.useState(rfq.selected_vendor);
  const [showPO, setShowPO] = React.useState(false);
  const [draft, setDraft] = React.useState(() => rfq.quotes.reduce((m, q) => { m[q.vendor_id] = { total: q.total || '', delivery_days: q.delivery_days || '', terms: q.terms || '' }; return m; }, {}));
  const locked = rfq.status === 'Vendor Approved';
  const setQ = (vid, patch) => setDraft(d => ({ ...d, [vid]: { ...d[vid], ...patch } }));

  const saveQuotes = () => {
    mutate(s => ({
      ...s,
      rfqs: s.rfqs.map(r => r.id !== rfq.id ? r : {
        ...r, quotes: r.quotes.map(q => { const d = draft[q.vendor_id] || {}; const total = Number(d.total) || 0; return { ...q, total, delivery_days: Number(d.delivery_days) || 0, terms: d.terms || '', responded: total > 0 }; }),
      }),
    }), { action: 'quotes', entity: 'RFQ', entity_id: rfq.id });
    toast('Quotes recorded', 'success');
  };

  const bestQuote = rfq.quotes.filter(q => q.responded).reduce((b, q) => !b || q.total < b.total ? q : b, null);

  const confirmWinner = () => {
    const dq = draft[selected] || {};
    const total = Number(dq.total) || (rfq.quotes.find(x => x.vendor_id === selected)?.total || 0);
    const v = getVendor(selected);
    const needsMD = total > 500000;
    mutate(s => ({
      ...s,
      rfqs: s.rfqs.map(r => r.id === rfq.id ? { ...r, selected_vendor: selected, status: needsMD ? 'Responses In' : 'Vendor Approved' } : r),
      notifications: needsMD ? [
        { id: 'n-rfq-md-' + Date.now(), kind: 'po', text: `${rfq.rfq_no} · ${v.name} selected · ${inrK(total)} · awaiting MD approval`, date: TODAY, read: false, role: 'Managing Director' },
        ...s.notifications,
      ] : [
        { id: 'n-rfq-' + Date.now(), kind: 'po', text: `${rfq.rfq_no} · ${v.name} approved · draft Vendor PO`, date: TODAY, read: false, role: 'Purchase' },
        ...s.notifications,
      ],
    }));
    toast(needsMD ? `Selection sent to MD for approval (> ₹5L)` : `Vendor selected · draft Vendor PO`, 'success');
  };

  return (
    <div className="card mb-3">
      <div className="card-header">
        <div>
          <h3 className="card-title">
            <span className="mono">{rfq.rfq_no}</span> — {rfq.items_label}
          </h3>
          <div className="tiny muted">For SO <span className="mono">{so?.so_no}</span> · floated {fmtDate(rfq.floated_date)} · closes {fmtDate(rfq.closes_date)}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canSelectWinner && !locked && <button className="btn" onClick={saveQuotes}><Icon name="save" size={12}/>Record quotes</button>}
          {canSelectWinner && <button className="btn btn-primary" disabled={!selected || locked} onClick={confirmWinner}>
            {locked ? 'Vendor selected' : 'Select winner'}
          </button>}
        </div>
      </div>
      <div className="card-body flush">
        <table className="t">
          <thead>
            <tr>
              <th>Vendor</th>
              <th className="num">Total Quote</th>
              <th className="num">Delivery</th>
              <th>Terms</th>
              <th className="num">LPP Variance</th>
              <th>Status</th>
              <th>Pick</th>
            </tr>
          </thead>
          <tbody>
            {rfq.quotes.map(q => {
              const v = getVendor(q.vendor_id);
              const isBest = bestQuote && q.vendor_id === bestQuote.vendor_id;
              const lppWarn = q.lpp_variance > 10;
              return (
                <tr key={q.vendor_id} className={selected === q.vendor_id ? 'selected' : ''}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong>{v.name}</strong>
                      {isBest && <Icon name="star" size={12} color="var(--warning)"/>}
                    </div>
                    <div className="tiny muted">{v.city} · ★ {v.rating}</div>
                  </td>
                  <td className="num">
                    {locked ? <strong style={{ fontFamily: 'var(--mono)' }}>{inr(q.total)}</strong> :
                      <input type="number" className="input mono" min="0" placeholder="total" value={(draft[q.vendor_id] || {}).total} onChange={e => setQ(q.vendor_id, { total: e.target.value })} style={{ width: 100, textAlign: 'right', height: 26 }}/>}
                  </td>
                  <td className="num">
                    {locked ? (q.responded ? `${q.delivery_days} days` : '—') :
                      <input type="number" className="input mono" min="0" placeholder="days" value={(draft[q.vendor_id] || {}).delivery_days} onChange={e => setQ(q.vendor_id, { delivery_days: e.target.value })} style={{ width: 60, textAlign: 'right', height: 26 }}/>}
                  </td>
                  <td>
                    {locked ? (q.terms || <span className="muted">—</span>) :
                      <input className="input" placeholder="terms" value={(draft[q.vendor_id] || {}).terms} onChange={e => setQ(q.vendor_id, { terms: e.target.value })} style={{ width: 90, height: 26 }}/>}
                  </td>
                  <td className="num">
                    {q.responded ? (
                      lppWarn ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>+{q.lpp_variance}% ⚠</span> :
                      q.lpp_variance === 0 ? <span className="muted">LPP</span> :
                      <span style={{ color: q.lpp_variance > 0 ? 'var(--warning)' : 'var(--success)' }}>{q.lpp_variance > 0 ? '+' : ''}{q.lpp_variance}%</span>
                    ) : '—'}
                  </td>
                  <td>
                    {q.responded ? <span className="badge success dot">Responded</span> : <span className="badge dot">Awaiting</span>}
                  </td>
                  <td>
                    {(Number((draft[q.vendor_id] || {}).total) > 0 || q.responded) && (
                      <input type="radio" name={`pick-${rfq.id}`} checked={selected === q.vendor_id} disabled={locked} onChange={() => setSelected(q.vendor_id)}/>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected && (
        <div style={{ padding: '10px 14px', background: 'var(--accent-bg)', borderTop: '1px solid var(--accent-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="small">
            <strong>{getVendor(selected)?.name}</strong> selected
            {(Number((draft[selected] || {}).total) || 0) > 500000 && <span style={{ color: 'var(--warning)' }}> · ⚠ Requires MD approval (above ₹5L)</span>}
          </div>
          {canSelectWinner && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowPO(true)}>
              Draft Vendor PO <Icon name="arrowRight" size={11}/>
            </button>
          )}
        </div>
      )}
      {showPO && <CreateVendorPOModal soId={rfq.so_id} vendorId={selected} onClose={() => setShowPO(false)}/>}
    </div>
  );
}

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
  const { state, navigate, mutate, getVendor, getSO, getCustomer, getProduct } = useStore();
  const toast = useToast();
  const po = state.vendor_pos.find(p => p.id === poId);
  if (!po) return <div className="page"><div className="empty">PO not found</div></div>;
  const v = getVendor(po.vendor_id);
  const so = getSO(po.so_id);
  const cust = so ? getCustomer(so.customer_id) : null;

  const subtotal = po.items.reduce((s,i) => s + i.qty * i.rate, 0);
  const gst = subtotal * 0.18;
  const grand = subtotal + gst;
  const ebilled = po.ebill && po.ebill.generated;

  // Sibling POs for the same project (SO) — the vendors selected for this order.
  const siblings = state.vendor_pos.filter(p => p.so_id === po.so_id);
  // Vendor invoice booked against this PO (payables / 3-way side).
  const vInv = (state.vendor_invoices || []).find(x => x.po_id === po.id);

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
          {ebilled
            ? <button className="btn" onClick={() => window.print()}><Icon name="print" size={13}/>Print e-Bill</button>
            : <button className="btn btn-primary" onClick={genEbill}><Icon name="receipt" size={13}/>Generate PO e-Bill</button>}
          <button className="btn"><Icon name="mail" size={13}/>Resend to vendor</button>
          <button className="btn btn-primary" onClick={() => navigate('grn')}><Icon name="package" size={13}/>Create GRN</button>
        </div>
      </div>

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
          <button className="btn btn-primary" onClick={() => navigate('grn/new')}><Icon name="plus" size={13}/>New GRN</button>
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
            <div className="card-header"><h3 className="card-title">Receipt Lines</h3></div>
            <div className="card-body flush">
              <table className="t zebra">
                <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Accepted</th><th className="num">Rejected</th><th>Reason</th></tr></thead>
                <tbody>
                  {g.items.map((it, i) => {
                    const p = getProduct(it.product_id);
                    return (
                      <tr key={i}>
                        <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                        <td className="num">{it.ordered}</td>
                        <td className="num">{it.received}</td>
                        <td className="num"><span style={{ color: 'var(--success)' }}>{it.accepted}</span></td>
                        <td className="num">{it.rejected || <span className="muted">0</span>}</td>
                        <td className="small muted">{it.reject_reason || '—'}</td>
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

function GRNNew() {
  const { navigate, state, getVendor, getProduct } = useStore();
  const toast = useToast();
  // Receive against the first PO that is still awaiting/in-transit material.
  const po = state.vendor_pos.find(p => p.status === 'In Transit')
    || state.vendor_pos.find(p => p.status !== 'Material Received')
    || state.vendor_pos[0];
  const [items, setItems] = React.useState(
    po ? po.items.map(it => ({ ...it, received: it.qty, accepted: it.qty, rejected: 0, reason: '' })) : []
  );

  if (!po) return (
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

  const v = getVendor(po.vendor_id);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('grn')}>
            <Icon name="chevronLeft" size={12}/> GRN
          </div>
          <h1 className="page-title">New GRN</h1>
          <div className="page-sub">Receiving material against <span className="mono">{po.po_no}</span> · {v.name}</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate('grn')}>Cancel</button>
          <button className="btn">Save Draft</button>
          <button className="btn btn-primary" onClick={() => { toast('GRN posted · items added to VG', 'success'); navigate('grn'); }}>
            <Icon name="check" size={13}/>Post GRN
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Receipt Lines</h3></div>
            <div className="card-body flush">
              <table className="t">
                <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Accepted</th><th className="num">Rejected</th><th>Reject reason</th></tr></thead>
                <tbody>
                  {items.map((it, i) => {
                    const p = getProduct(it.product_id);
                    return (
                      <tr key={i}>
                        <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                        <td className="num">{it.qty}</td>
                        <td className="num">
                          <input type="number" className="input mono" value={it.received}
                                 onChange={e => { const v = parseInt(e.target.value) || 0; const next=[...items]; next[i] = {...it, received: v, accepted: v - it.rejected}; setItems(next); }}
                                 style={{ width: 70, textAlign: 'right' }}/>
                        </td>
                        <td className="num">
                          <input type="number" className="input mono" value={it.accepted} readOnly style={{ width: 70, textAlign: 'right', background: 'var(--bg-subtle)' }}/>
                        </td>
                        <td className="num">
                          <input type="number" className="input mono" value={it.rejected}
                                 onChange={e => { const v = parseInt(e.target.value) || 0; const next=[...items]; next[i] = {...it, rejected: v, accepted: it.received - v}; setItems(next); }}
                                 style={{ width: 70, textAlign: 'right' }}/>
                        </td>
                        <td><input className="input" placeholder={it.rejected > 0 ? 'Reason required' : ''} disabled={!it.rejected}/></td>
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
              <div className="field"><label className="field-label">LR / tracking no.</label><input className="input mono" defaultValue="DELHIVERY-D88234"/></div>
              <div className="field mt-2"><label className="field-label">Received date</label><input type="date" className="input mono" defaultValue={TODAY}/></div>
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

// ===== 3-Way Match =====
function ThreeWayMatchList() {
  const { state, navigate } = useStore();
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">3-Way Match</h1>
          <div className="page-sub">Vendor invoice ⟷ Vendor PO ⟷ GRN · auto-tolerance check</div>
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
                const v = state.vendors.find(x => x.id === vi.vendor_id);
                const po = state.vendor_pos.find(p => p.id === vi.po_id);
                return (
                  <tr key={vi.id} onClick={() => navigate(`three-way/${vi.id}`)} style={{ cursor: 'pointer' }}>
                    <td className="mono">{vi.vendor_invoice_no}</td>
                    <td>{v.name}</td>
                    <td className="mono">{po?.po_no}</td>
                    <td>{vi.grn_id ? <span className="badge success dot">Received</span> : <span className="badge warning dot">Pending</span>}</td>
                    <td className="num">{inr(vi.amount)}</td>
                    <td>{vi.tolerance === 'within' ? <span className="badge success">Within ±2%</span> : <span className="badge danger">Outside</span>}</td>
                    <td><span className="badge warning dot">{vi.status}</span></td>
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

function ThreeWayMatchDetail({ viId }) {
  const { state, navigate, getVendor, getProduct } = useStore();
  const toast = useToast();
  const vi = state.vendor_invoices.find(v => v.id === viId);
  if (!vi) return <div className="page"><div className="empty">Not found</div></div>;
  const po = state.vendor_pos.find(p => p.id === vi.po_id);
  const grn = state.grns.find(g => g.id === vi.grn_id);
  const v = getVendor(vi.vendor_id);
  const within = vi.tolerance === 'within';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('three-way')}>
            <Icon name="chevronLeft" size={12}/> 3-Way Match
          </div>
          <h1 className="page-title">3-Way Match — <span className="mono">{vi.vendor_invoice_no}</span></h1>
          <div className="page-sub">{v.name} · invoice amount {inr(vi.amount)}</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-danger" onClick={() => { toast('Invoice rejected · email sent to vendor'); navigate('three-way'); }}>Reject</button>
          <button className="btn" onClick={() => { toast('Parked for PM review'); navigate('three-way'); }}>Park for review</button>
          <button className="btn btn-primary" onClick={() => { toast('Booked in payables · payment scheduled', 'success'); navigate('three-way'); }}>
            <Icon name="check" size={13}/>Approve & Book
          </button>
        </div>
      </div>

      <div className="mb-2" style={{ padding: 10, background: within ? 'var(--success-bg)' : 'var(--danger-bg)', border: '1px solid', borderColor: within ? 'oklch(0.85 0.06 155)' : 'oklch(0.86 0.08 25)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
        <Icon name={within ? 'check' : 'alert'} size={14} color={within ? 'var(--success)' : 'var(--danger)'}/>
        <span><strong>{within ? 'Within tolerance' : 'Outside tolerance'}</strong> · Value tolerance ±2% · Qty tolerance ±1 unit · {!within && 'PM review recommended before booking'}</span>
      </div>

      <div className="compare">
        <div className="compare-h">Field</div>
        <div className="compare-h">Vendor PO · {po.po_no}</div>
        <div className="compare-h">GRN · {grn?.grn_no || 'Pending'}</div>
        <div className="compare-h">Vendor Invoice · {vi.vendor_invoice_no}</div>

        <div className="compare-row-label">Vendor</div>
        <div>{v.name}</div><div>{v.name}</div><div className="ok">{v.name} <Icon name="check" size={11}/></div>

        <div className="compare-row-label">Date</div>
        <div className="mono">{fmtDate(po.date)}</div><div className="mono">{grn ? fmtDate(grn.date) : '—'}</div><div className="mono">{fmtDate(vi.date)}</div>

        {po.items.map((it, i) => {
          const p = getProduct(it.product_id);
          const grnLine = grn?.items.find(x => x.product_id === it.product_id);
          const qtyMatch = grnLine && grnLine.accepted === it.qty;
          return (
            <Fragment key={i}>
              <div className="compare-row-label">{p.name}</div>
              <div className="num">Qty {it.qty} @ {inr(it.rate)}</div>
              <div className="num">{grnLine ? `Acc ${grnLine.accepted} / Rej ${grnLine.rejected}` : '—'}</div>
              <div className={`num ${within ? 'ok' : 'warn'}`}>{it.qty} @ {inr(it.rate * (within ? 1 : 1.025))} {!within && <Icon name="alert" size={11}/>}</div>
            </Fragment>
          );
        })}

        <div className="compare-row-label">Subtotal</div>
        <div className="num">{inr(po.amount)}</div>
        <div className="num">—</div>
        <div className={`num ${within ? 'ok' : 'warn'}`}>{inr(vi.amount)}</div>

        <div className="compare-row-label">Variance</div>
        <div>—</div>
        <div>—</div>
        <div className={within ? 'ok' : 'warn'}>{within ? '+0.0% (within ±2%)' : '+2.1% (outside ±2%)'}</div>
      </div>

      <div className="mt-3 split-2">
        <div className="card">
          <div className="card-header"><h3 className="card-title">TDS & RCM</h3></div>
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
          <div className="card-header"><h3 className="card-title">Payment Schedule</h3></div>
          <div className="card-body">
            <div className="dl">
              <dt>Vendor terms</dt><dd>{v.terms}</dd>
              <dt>Invoice date</dt><dd className="mono">{fmtDate(vi.date)}</dd>
              <dt>Due date</dt><dd className="mono">{fmtDate(new Date(new Date(vi.date).getTime() + 30*86400000).toISOString().slice(0,10))}</dd>
              <dt>Bank A/c</dt><dd className="mono small">HDFC ·0042 — TechSource Dist.</dd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  return m;
}

// Group an SO's required components by the vendor chosen during sourcing, each at
// the sourced unit price. Components without a saved pick fall back to the
// cheapest vendor / baseline so nothing is left unsourced.
function vendorPOGroups(state, so, sourcing, getProduct) {
  const req = soReqComponents(so);
  const picks = (sourcing && sourcing.picks) || {};
  const prices = (sourcing && sourcing.prices) || {};
  const groups = {};
  Object.entries(req).forEach(([pid, qty]) => {
    const p = getProduct(pid);
    let vid = picks[pid];
    if (!vid && p && window.vendorSuggestions) { const sug = window.vendorSuggestions(p, state.vendors); if (sug[0]) vid = sug[0].vendor.id; }
    if (!vid) return;
    let rate = prices[pid] && prices[pid][vid];
    if (rate === undefined || rate === null) rate = window.vendorUnitPrice ? window.vendorUnitPrice(vid, p) : (p ? p.buy : 0);
    (groups[vid] = groups[vid] || []).push({ product_id: pid, qty, rate });
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
    status: g.amount > 500000 ? 'Pending MD Approval' : 'Issued',
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

// ===== Float RFQ to selected vendors (Purchase) =====
function CreateRFQModal({ soId, onClose }) {
  const { state, mutate, getSO, getProduct } = useStore();
  const toast = useToast();
  const [so, setSo] = React.useState(soId || '');
  const soObj = so ? getSO(so) : null;
  const comps = soObj ? procComponentList(soObj) : [];
  const [picked, setPicked] = React.useState({});
  const [vendors, setVendors] = React.useState({});
  const [closes, setCloses] = React.useState(() => { const d = new Date(TODAY); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10); });

  React.useEffect(() => {
    if (soObj) { const m = {}; procComponentList(soObj).forEach(c => { m[c.product_id] = true; }); setPicked(m); }
  }, [so]);

  const selectedComps = comps.filter(c => picked[c.product_id]);
  const selectedVendors = Object.keys(vendors).filter(v => vendors[v]);

  const submit = () => {
    if (!so || selectedComps.length === 0 || selectedVendors.length === 0) { toast('Pick an SO, at least one component, and at least one vendor'); return; }
    const rfqNo = `RFQ/FY26/${String(23 + state.rfqs.length).padStart(4, '0')}`;
    const names = selectedComps.map(c => getProduct(c.product_id)?.name || c.product_id);
    const items_label = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
    const rfq = {
      id: 'rfq-' + Date.now(), rfq_no: rfqNo, so_id: so, items_label,
      floated_date: TODAY, closes_date: closes, status: 'Responses In',
      vendors: selectedVendors,
      quotes: selectedVendors.map(vid => ({ vendor_id: vid, total: 0, delivery_days: 0, terms: '', lpp_variance: 0, responded: false })),
      selected_vendor: null,
      items: selectedComps.map(c => ({ product_id: c.product_id, qty: c.qty })),
    };
    mutate(s => ({
      ...s,
      rfqs: [rfq, ...s.rfqs],
      sales_orders: s.sales_orders.map(x => x.id === so && x.status === 'Approved' ? { ...x, status: 'Procurement Started' } : x),
      notifications: [{ id: 'n-rfq-' + Date.now(), kind: 'po', text: `${rfqNo} floated to ${selectedVendors.length} vendor(s) for ${getSO(so)?.so_no}`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications],
    }), { action: 'create', entity: 'RFQ', entity_id: rfq.id });
    toast(`${rfqNo} floated to ${selectedVendors.length} vendor(s)`, 'success');
    onClose();
  };

  return (
    <Modal title="Float RFQ to vendors" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!so || selectedComps.length === 0 || selectedVendors.length === 0} onClick={submit}>Float RFQ</button>
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
          <label className="field-label">Responses close by</label>
          <input type="date" className="input mono" value={closes} onChange={e => setCloses(e.target.value)}/>
        </div>
      </div>

      {soObj && (
        <div className="field mt-2">
          <label className="field-label">Components to source ({selectedComps.length}/{comps.length})</label>
          <div className="card"><div className="card-body" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {comps.map(c => {
              const p = getProduct(c.product_id) || { name: c.product_id, code: c.product_id };
              return (
                <label key={c.product_id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                  <input type="checkbox" checked={!!picked[c.product_id]} onChange={e => setPicked(m => ({ ...m, [c.product_id]: e.target.checked }))}/>
                  {p.name} <span className="muted tiny mono">{p.code}</span> <span className="muted">· qty {c.qty}</span>
                </label>
              );
            })}
          </div></div>
        </div>
      )}

      <div className="field mt-2">
        <label className="field-label">Invite vendors * ({selectedVendors.length} selected)</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {state.vendors.map(v => (
            <label key={v.id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!vendors[v.id]} onChange={e => setVendors(m => ({ ...m, [v.id]: e.target.checked }))}/>
              <span>{v.name} <span className="muted tiny">· ★ {v.rating} · {v.city}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-2 tiny muted" style={{ padding: 10, background: 'var(--info-bg)', borderRadius: 4 }}>
        After floating, record each vendor's quote on the RFQ, then select the winning vendor — that vendor flows into the Vendor PO. Above ₹5L the selection needs MD approval.
      </div>
    </Modal>
  );
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
  const needsMD = amount > 500000;

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

window.CreateRFQModal = CreateRFQModal;
window.CreateVendorPOModal = CreateVendorPOModal;
window.RFQList = RFQList;
window.VendorPOList = VendorPOList;
window.VendorPODetail = VendorPODetail;
window.GRNList = GRNList;
window.GRNDetail = GRNDetail;
window.GRNNew = GRNNew;
window.ThreeWayMatchList = ThreeWayMatchList;
window.ThreeWayMatchDetail = ThreeWayMatchDetail;
