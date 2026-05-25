// OP Central — Procurement screens: RFQ, Vendor PO, GRN, 3-Way Match

// ===== RFQ List + Detail =====
function RFQList() {
  const { state, navigate, getSO, getVendor } = useStore();
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">RFQ Comparison</h1>
          <div className="page-sub">Side-by-side vendor quotes · LPP variance alerts · winner selection</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary"><Icon name="plus" size={13}/>Float new RFQ</button>
        </div>
      </div>

      {state.rfqs.map(rfq => <RFQCard key={rfq.id} rfq={rfq}/>)}
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

  const bestQuote = rfq.quotes.filter(q => q.responded).reduce((b, q) => !b || q.total < b.total ? q : b, null);

  const confirmWinner = () => {
    const q = rfq.quotes.find(x => x.vendor_id === selected);
    const v = getVendor(selected);
    const needsMD = q.total > 500000;
    mutate(s => ({
      ...s,
      rfqs: s.rfqs.map(r => r.id === rfq.id ? { ...r, selected_vendor: selected, status: needsMD ? 'Responses In' : 'Vendor Approved' } : r),
      notifications: needsMD ? [
        { id: 'n-rfq-md-' + Date.now(), kind: 'po', text: `${rfq.rfq_no} · ${v.name} selected · ${inrK(q.total)} · awaiting MD approval`, date: TODAY, read: false, role: 'Managing Director' },
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
          <button className="btn"><Icon name="mail" size={12}/>Request revision</button>
          <button className="btn"><Icon name="download" size={12}/>Export</button>
          {canSelectWinner && <button className="btn btn-primary" disabled={!selected || rfq.status === 'Vendor Approved'} onClick={confirmWinner}>
            {rfq.status === 'Vendor Approved' ? 'Vendor selected' : 'Select winner'}
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
                    {q.responded ? (
                      <strong style={{ fontFamily: 'var(--mono)' }}>{inr(q.total)}</strong>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="num">{q.responded ? `${q.delivery_days} days` : '—'}</td>
                  <td>{q.terms || <span className="muted">—</span>}</td>
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
                    {q.responded && (
                      <input type="radio" name={`pick-${rfq.id}`} checked={selected === q.vendor_id} onChange={() => setSelected(q.vendor_id)}/>
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
            <strong>{getVendor(selected).name}</strong> selected · {rfq.quotes.find(q => q.vendor_id === selected).total > 500000 && <span style={{ color: 'var(--warning)' }}>⚠ Requires MD approval (above ₹5L)</span>}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { toast('PO drafted · sent for MD approval', 'success'); navigate('vendor-pos'); }}>
            Draft Vendor PO <Icon name="arrowRight" size={11}/>
          </button>
        </div>
      )}
    </div>
  );
}

// ===== Vendor PO List =====
function VendorPOList() {
  const { state, navigate, getVendor, getSO } = useStore();
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendor Purchase Orders</h1>
          <div className="page-sub">{state.vendor_pos.length} POs · FY {state.org.fiscal_year}</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="download" size={13}/>Export</button>
          <button className="btn btn-primary"><Icon name="plus" size={13}/>Create Vendor PO</button>
        </div>
      </div>

      <div className="card">
        <div className="filter-bar">
          <input className="input search" placeholder="Search PO no, vendor…" style={{ flex: '0 0 220px' }}/>
          <select className="select" style={{ width: 130 }}><option>All vendors</option></select>
          <select className="select" style={{ width: 130 }}><option>All statuses</option></select>
          <div className="grow"/>
          <span className="muted small">{state.vendor_pos.length} shown</span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr>
              <th>PO No</th><th>Vendor</th><th>For SO</th><th>Date</th><th>Expected</th>
              <th className="num">Amount</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {state.vendor_pos.map(po => {
                const v = getVendor(po.vendor_id);
                const so = getSO(po.so_id);
                return (
                  <tr key={po.id} onClick={() => navigate(`vendor-pos/${po.id}`)} style={{ cursor: 'pointer' }}>
                    <td><a className="mono">{po.po_no}</a></td>
                    <td>{v.name}<div className="tiny muted mono">{v.gstin}</div></td>
                    <td className="mono small">{so?.so_no}</td>
                    <td className="mono small">{fmtDate(po.date)}</td>
                    <td className="mono small">{fmtDate(po.expected)}</td>
                    <td className="num">{inr(po.amount)}</td>
                    <td>
                      {po.status === 'Material Received' ? <span className="badge success dot">Received</span> :
                       po.status === 'In Transit' ? <span className="badge accent dot">In transit</span> :
                       <span className="badge dot">{po.status}</span>}
                    </td>
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

function VendorPODetail({ poId }) {
  const { state, navigate, getVendor, getSO, getProduct } = useStore();
  const po = state.vendor_pos.find(p => p.id === poId);
  if (!po) return <div className="page"><div className="empty">PO not found</div></div>;
  const v = getVendor(po.vendor_id);
  const so = getSO(po.so_id);

  const subtotal = po.items.reduce((s,i) => s + i.qty * i.rate, 0);
  const gst = subtotal * 0.18;
  const grand = subtotal + gst;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('vendor-pos')}>
            <Icon name="chevronLeft" size={12}/> Vendor POs
          </div>
          <h1 className="page-title">
            <span className="mono">{po.po_no}</span>
            <span className="badge ml-2" style={{ marginLeft: 8 }}>{po.status}</span>
          </h1>
          <div className="page-sub">{v.name} · For SO <span className="mono">{so?.so_no}</span></div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="print" size={13}/>Print</button>
          <button className="btn"><Icon name="mail" size={13}/>Resend to vendor</button>
          <button className="btn btn-primary" onClick={() => navigate('grn')}><Icon name="package" size={13}/>Create GRN</button>
        </div>
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

window.RFQList = RFQList;
window.VendorPOList = VendorPOList;
window.VendorPODetail = VendorPODetail;
window.GRNList = GRNList;
window.GRNDetail = GRNDetail;
window.GRNNew = GRNNew;
window.ThreeWayMatchList = ThreeWayMatchList;
window.ThreeWayMatchDetail = ThreeWayMatchDetail;
