// OP Central — Billing screens: Invoice list/detail, e-Way Bill, Collections, Customer Ledger

function InvoiceList() {
  const { state, navigate, getCustomer } = useStore();
  const invoices = state.sales_orders.filter(s => s.invoice_no);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices & e-Way Bills</h1>
          <div className="page-sub">{invoices.length} tax invoices · FY {state.org.fiscal_year}</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="download" size={13}/>GSTR-1 export</button>
          <button className="btn btn-primary"><Icon name="plus" size={13}/>Raise invoice</button>
        </div>
      </div>

      <div className="kpi-grid mb-3">
        <div className="kpi"><div className="kpi-label">Invoiced MTD</div><div className="kpi-value">{inrK(invoices.reduce((s,i) => s + i.invoice_amount, 0))}</div><div className="kpi-delta"><Delta value={8}/></div></div>
        <div className="kpi"><div className="kpi-label">Output GST</div><div className="kpi-value">{inrK(invoices.reduce((s,i) => s + i.invoice_amount, 0) * 0.18 / 1.18)}</div><div className="kpi-delta">May 2026</div></div>
        <div className="kpi"><div className="kpi-label">e-Way Bills</div><div className="kpi-value">{invoices.length}</div><div className="kpi-delta">All active · NIC linked</div></div>
        <div className="kpi"><div className="kpi-label">e-Invoice IRN</div><div className="kpi-value">{invoices.length}</div><div className="kpi-delta">Generated · QR linked</div></div>
      </div>

      <div className="card">
        <div className="filter-bar">
          <input className="input search" placeholder="Search invoice, customer…" style={{ flex: '0 0 220px' }}/>
          <select className="select" style={{ width: 120 }}><option>All customers</option></select>
          <select className="select" style={{ width: 130 }}><option>All FY</option></select>
          <div className="grow"/>
          <span className="muted small">{invoices.length} invoices</span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr>
              <th>Invoice No</th><th>Customer</th><th>SO Ref</th><th>Date</th>
              <th className="num">Taxable</th><th className="num">GST</th><th className="num">Total</th>
              <th>EWB</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {invoices.map(so => {
                const c = getCustomer(so.customer_id);
                const taxable = so.invoice_amount / 1.18;
                const gst = so.invoice_amount - taxable;
                return (
                  <tr key={so.id} onClick={() => navigate(`invoices/${so.id}`)} style={{ cursor: 'pointer' }}>
                    <td><a className="mono">{so.invoice_no}</a></td>
                    <td className="trunc">{c.name}</td>
                    <td className="mono small">{so.so_no}</td>
                    <td className="mono small">{fmtDate(so.invoice_date)}</td>
                    <td className="num">{inr(taxable)}</td>
                    <td className="num">{inr(gst)}</td>
                    <td className="num"><strong>{inr(so.invoice_amount)}</strong></td>
                    <td><span className="badge accent dot">EWB-{(231202310000 + parseInt(so.id.replace('so-',''))).toString().slice(0,12)}</span></td>
                    <td>{so.status === 'Payment Pending' ? <span className="badge warning dot">Payment due</span> : <span className="badge success dot">Paid</span>}</td>
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

function InvoiceDetail({ soId }) {
  const { state, navigate, getSO, getCustomer, getCategory, getProduct, soSubtotal } = useStore();
  const so = getSO(soId);
  if (!so || !so.invoice_no) return <div className="page"><div className="empty">Invoice not found</div></div>;
  const c = getCustomer(so.customer_id);
  const sameState = c.state === state.org.state;
  const subtotal = soSubtotal(so);
  const cgst = sameState ? subtotal * 0.09 : 0;
  const sgst = sameState ? subtotal * 0.09 : 0;
  const igst = sameState ? 0 : subtotal * 0.18;
  const grand = subtotal + cgst + sgst + igst;

  // Indian numbers to words (simplified)
  const toWords = (n) => {
    const cr = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thou = Math.floor((n % 100000) / 1000);
    const rest = Math.floor(n % 1000);
    const parts = [];
    if (cr) parts.push(`${cr} Crore`);
    if (lakh) parts.push(`${lakh} Lakh`);
    if (thou) parts.push(`${thou} Thousand`);
    if (rest) parts.push(`${rest}`);
    return 'Rupees ' + parts.join(' ') + ' Only';
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('invoices')}>
            <Icon name="chevronLeft" size={12}/> Invoices
          </div>
          <h1 className="page-title">
            Tax Invoice — <span className="mono">{so.invoice_no}</span>
            {so.status === 'Payment Pending' ? <span className="badge warning dot" style={{ marginLeft: 8 }}>Payment Due</span> : <span className="badge success dot" style={{ marginLeft: 8 }}>Paid</span>}
          </h1>
          <div className="page-sub">SO Ref <span className="mono">{so.so_no}</span> · {c.name}</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="mail" size={13}/>Email to customer</button>
          <button className="btn"><Icon name="print" size={13}/>Print / Download</button>
          <button className="btn btn-primary"><Icon name="flag" size={13}/>View e-Way Bill</button>
        </div>
      </div>

      <div className="detail-grid">
        <div className="doc-paper">
          <div className="doc-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="brand-mark" style={{ width: 32, height: 32, fontSize: 16 }}>B</div>
                <div>
                  <h1>{state.org.name}</h1>
                  <div className="small muted">{state.org.address}</div>
                  <div className="small mono">GSTIN: {state.org.gstin} · State: {state.org.state}</div>
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.06em' }}>TAX INVOICE</div>
              <div className="small mono">{so.invoice_no}</div>
              <div className="tiny muted">Original for recipient</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 10 }}>
            <div>
              <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Billed to</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
              <div className="small">{c.address}</div>
              <div className="small mono">GSTIN: {c.gstin}</div>
              <div className="small">State: {c.state}</div>
            </div>
            <div>
              <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shipped to</div>
              <div className="small">{so.ship_to}</div>
              <div className="tiny muted mt-2" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reference</div>
              <div className="small">Customer PO: <span className="mono">{so.customer_po}</span></div>
              <div className="small">SO Ref: <span className="mono">{so.so_no}</span></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 8, background: 'var(--bg-subtle)', borderRadius: 4, marginBottom: 10 }}>
            <div><div className="tiny muted">Invoice date</div><div className="mono small">{fmtDate(so.invoice_date)}</div></div>
            <div><div className="tiny muted">Place of supply</div><div className="small">{c.state}</div></div>
            <div><div className="tiny muted">e-Way Bill</div><div className="mono small">EWB-2312-0231-{(45000 + parseInt(so.id.replace('so-','')) * 33).toString()}</div></div>
            <div><div className="tiny muted">IRN</div><div className="mono small">{(so.id + '...e8f9').replace('so-','')}aab2…</div></div>
          </div>

          <table>
            <thead>
              <tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {so.lines.map((l, i) => {
                const cat = getCategory(l.category_id);
                return (
                  <tr key={l.id}>
                    <td>{i+1}</td>
                    <td>
                      <strong>{cat.name}</strong>
                      <div className="tiny muted">{cat.bundle_desc}</div>
                      {/* Internal BOM NOT shown to customer — that's the point */}
                    </td>
                    <td className="mono">{cat.hsn}</td>
                    <td className="num mono">{l.bundle_qty}</td>
                    <td className="num mono">{inr(l.unit_price)}</td>
                    <td className="num mono">{inr(l.bundle_qty * l.unit_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <table className="totals">
            <tbody>
              <tr><td>Subtotal</td><td className="num mono right">{inr(subtotal)}</td></tr>
              {sameState ? (
                <>
                  <tr><td>CGST @ 9%</td><td className="num mono right">{inr(cgst)}</td></tr>
                  <tr><td>SGST @ 9%</td><td className="num mono right">{inr(sgst)}</td></tr>
                </>
              ) : (
                <tr><td>IGST @ 18%</td><td className="num mono right">{inr(igst)}</td></tr>
              )}
              <tr><td>Round-off</td><td className="num mono right">₹0</td></tr>
              <tr className="grand"><td>Grand total</td><td className="num mono right">{inr(grand)}</td></tr>
            </tbody>
          </table>

          <div style={{ marginTop: 14, padding: 8, borderTop: '1px solid var(--border-strong)' }}>
            <div className="tiny" style={{ fontWeight: 600 }}>Amount in words:</div>
            <div className="small">{toWords(grand)}</div>
          </div>

          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'flex-end' }}>
            <div>
              <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bank details</div>
              <div className="small mono">HDFC Bank · Powai Branch</div>
              <div className="small mono">A/c: 0042 9981 12340 · IFSC: HDFC0000042</div>
              <div className="tiny muted mt-2">Terms: {so.payment_terms} from invoice date</div>
            </div>
            <div className="qr-ph" title="IRN QR placeholder"/>
          </div>

          <div className="tiny muted" style={{ marginTop: 12, textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            This is a system-generated invoice. For queries, write to billing@brightline.in
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header"><h3 className="card-title">e-Way Bill</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>EWB No</dt><dd className="mono">EWB-2312-0231-{(45000 + parseInt(so.id.replace('so-','')) * 33).toString()}</dd>
                <dt>Generated via</dt><dd>NIC API · auto</dd>
                <dt>Valid until</dt><dd className="mono">{fmtDate(new Date(new Date(so.invoice_date).getTime() + 3 * 86400000).toISOString().slice(0,10))} 23:59</dd>
                <dt>Vehicle</dt><dd className="mono">MH-04-EZ-9921</dd>
                <dt>Distance</dt><dd>247 km</dd>
                <dt>Type</dt><dd>Outward · Supply</dd>
              </div>
              <button className="btn mt-2" style={{ width: '100%' }}>View on NIC portal ↗</button>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">e-Invoice (IRN)</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>IRN</dt><dd className="mono small">{('a4f9e8a7b3' + so.id).slice(0,20)}…</dd>
                <dt>Ack No</dt><dd className="mono">192600{parseInt(so.id.replace('so-',''))*7}</dd>
                <dt>Ack Date</dt><dd className="mono">{fmtDate(so.invoice_date)}</dd>
                <dt>Status</dt><dd><span className="badge success dot">Accepted</span></dd>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Internal BOM (hidden from customer)</h3></div>
            <div className="card-body small">
              <div className="muted mb-1">Components delivered against this invoice — not on PDF:</div>
              {so.lines.flatMap(l => l.components).map((c, i) => {
                const p = getProduct(c.product_id);
                return <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small">{p.name}</span>
                  <span className="mono small">{c.qty}</span>
                </div>;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Collections =====
function CollectionsDashboard() {
  const { state, navigate, getCustomer } = useStore();
  const toast = useToast();
  const pendingInvoices = state.sales_orders.filter(s => s.status === 'Payment Pending' && s.invoice_no);
  const totalOutstanding = pendingInvoices.reduce((s, i) => s + i.invoice_amount, 0);

  const buckets = [
    { label: '0–30 days', max: 30, color: 'oklch(0.55 0.10 155)' },
    { label: '31–60 days', max: 60, color: 'oklch(0.62 0.13 70)' },
    { label: '61–90 days', max: 90, color: 'oklch(0.55 0.15 40)' },
    { label: '90+ days', max: 9999, color: 'oklch(0.52 0.16 25)' },
  ];
  const bucketed = buckets.map((b, i) => {
    const prev = i === 0 ? -9999 : buckets[i-1].max;
    const items = pendingInvoices.filter(inv => {
      const d = inv.days_overdue || 0;
      return d > prev && d <= b.max;
    });
    return { ...b, items, total: items.reduce((s, i) => s + i.invoice_amount, 0) };
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Collections</h1>
          <div className="page-sub">Total outstanding {inr(totalOutstanding)} across {pendingInvoices.length} invoices</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="download" size={13}/>Export ageing</button>
          <button className="btn"><Icon name="msg" size={13}/>Bulk WhatsApp</button>
        </div>
      </div>

      <div className="kpi-grid mb-3">
        {bucketed.map((b, i) => (
          <div key={i} className="kpi" style={{ borderTop: `3px solid ${b.color}` }}>
            <div className="kpi-label">{b.label}</div>
            <div className="kpi-value">{inrK(b.total)}</div>
            <div className="kpi-delta">{b.items.length} invoice{b.items.length !== 1 ? 's' : ''}</div>
          </div>
        ))}
      </div>

      <div className="card mb-3">
        <div className="card-header">
          <h3 className="card-title">Priority Follow-up</h3>
          <span className="card-sub">Sorted by days overdue · highest value first</span>
        </div>
        <div className="card-body flush">
          <table className="t zebra">
            <thead><tr>
              <th>Invoice</th><th>Customer</th><th className="num">Amount</th><th className="num">Days Overdue</th>
              <th>Last contact</th><th>By</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {[...pendingInvoices].sort((a,b) => (b.days_overdue || 0) - (a.days_overdue || 0)).map(inv => {
                const c = getCustomer(inv.customer_id);
                const overdue = inv.days_overdue || 0;
                return (
                  <tr key={inv.id}>
                    <td>
                      <div className="mono">{inv.invoice_no}</div>
                      <div className="tiny muted mono">{inv.so_no}</div>
                    </td>
                    <td>
                      <div>{c.name}</div>
                      <div className="tiny muted">{c.tier} · {c.terms}</div>
                    </td>
                    <td className="num"><strong>{inr(inv.invoice_amount)}</strong></td>
                    <td className="num">
                      {overdue > 0 ? (
                        <span style={{ color: overdue > 60 ? 'var(--danger)' : overdue > 30 ? 'var(--warning)' : 'var(--text)', fontWeight: 600 }}>
                          {overdue}d
                        </span>
                      ) : <span className="muted">due today</span>}
                    </td>
                    <td className="mono small">{overdue > 0 ? fmtDate(new Date(Date.now() - (overdue - 7) * 86400000 * (overdue > 14 ? 1 : 0)).toISOString().slice(0,10)) : '—'}</td>
                    <td>{overdue > 0 ? <span className="small">Tara P</span> : <span className="muted">—</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm" title="Call" onClick={() => toast(`Calling ${c.contact}…`)}><Icon name="phone" size={11}/></button>
                        <button className="btn btn-sm" title="Email" onClick={() => toast(`Reminder emailed to ${c.contact}`)}><Icon name="mail" size={11}/></button>
                        <button className="btn btn-sm" title="WhatsApp" onClick={() => toast(`WhatsApp sent to ${c.phone}`)}><Icon name="msg" size={11}/></button>
                        <button className="btn btn-sm" onClick={() => navigate(`customers/${c.id}/ledger`)}>Ledger</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="split-2">
        <div className="card">
          <div className="card-header"><h3 className="card-title">Today's follow-up log</h3></div>
          <div className="card-body flush">
            <div className="queue-item">
              <Icon name="phone" size={14} color="var(--accent)"/>
              <div className="grow">
                <div className="small">Called <strong>Hardik Mehta</strong> — Mehta Textiles · INV/FY26/0049</div>
                <div className="tiny muted">"Will release payment by Friday EOD" · logged 09:45</div>
              </div>
              <button className="btn btn-ghost btn-sm">Log next</button>
            </div>
            <div className="queue-item">
              <Icon name="msg" size={14} color="var(--success)"/>
              <div className="grow">
                <div className="small">WhatsApp sent to <strong>Karthik R</strong> — Southern Polymers</div>
                <div className="tiny muted">Auto-reminder template T+0 · seen 11:23</div>
              </div>
              <button className="btn btn-ghost btn-sm">Reply</button>
            </div>
            <div className="queue-item">
              <Icon name="mail" size={14} color="var(--info)"/>
              <div className="grow">
                <div className="small">Email follow-up scheduled — <strong>Reema Saxena</strong> · Orbit Hospitals</div>
                <div className="tiny muted">14:00 today · auto-template "T-7"</div>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Escalation Rules</h3></div>
          <div className="card-body small">
            <div className="dl" style={{ gridTemplateColumns: '1fr auto', rowGap: 8 }}>
              <dt>+7 days before due</dt><dd>Gentle email + SMS</dd>
              <dt>On due date</dt><dd>Email + WhatsApp</dd>
              <dt>+7 days overdue</dt><dd>Escalation email</dd>
              <dt>+30 days overdue</dt><dd>Sales lead notified</dd>
              <dt>+60 days overdue</dt><dd>MD notified · hold new orders</dd>
              <dt>+90 days overdue</dt><dd>Flag for legal action</dd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.InvoiceList = InvoiceList;
window.InvoiceDetail = InvoiceDetail;
window.CollectionsDashboard = CollectionsDashboard;
