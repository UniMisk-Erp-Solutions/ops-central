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

function InvoiceDetail({ soId, invId }) {
  const { state, navigate, getSO, getCustomer, getCategory, getProduct, soSubtotal, soBillAdjustment, soBilledSubtotal } = useStore();
  const so = getSO(soId);
  if (!so) return <div className="page"><div className="empty">Invoice not found</div></div>;
  // When an invoice id is given, render THAT specific invoice (partial / consolidated);
  // otherwise fall back to the order-level (legacy) full invoice.
  const inv = invId ? (so.invoices || []).find(i => i.id === invId) : null;
  if (invId && !inv) return <div className="page"><div className="empty">Invoice not found</div></div>;
  if (!invId && !so.invoice_no) return <div className="page"><div className="empty">Invoice not found</div></div>;
  const c = getCustomer(so.customer_id);
  const sameState = c.state === state.org.state;
  const docNo = inv ? inv.no : so.invoice_no;
  const docDate = inv ? inv.date : so.invoice_date;
  const docType = inv ? (inv.consolidated ? 'Consolidated' : inv.type) : 'Full';
  const docLines = inv ? (inv.lines || []) : null;     // null → render full so.lines
  const orderedSubtotal = soSubtotal(so);
  const billAdj = inv ? 0 : soBillAdjustment(so);
  const subtotal = inv ? (inv.subtotal || 0) : soBilledSubtotal(so);   // billed = ordered − items removed at GRN
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
            Tax Invoice — <span className="mono">{docNo}</span>
            {inv ? <span className={`badge ${inv.consolidated ? 'success' : 'accent'} dot`} style={{ marginLeft: 8 }}>{docType}</span> : (so.status === 'Payment Pending' ? <span className="badge warning dot" style={{ marginLeft: 8 }}>Payment Due</span> : <span className="badge success dot" style={{ marginLeft: 8 }}>Paid</span>)}
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
              <div className="small mono">{docNo}</div>
              <div className="tiny muted">{inv && !inv.consolidated ? `${docType} · qty-proportional` : 'Original for recipient'}</div>
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
            <div><div className="tiny muted">Invoice date</div><div className="mono small">{fmtDate(docDate)}</div></div>
            <div><div className="tiny muted">Place of supply</div><div className="small">{c.state}</div></div>
            <div><div className="tiny muted">e-Way Bill</div><div className="mono small">EWB-2312-0231-{(45000 + parseInt(so.id.replace('so-','')) * 33).toString()}</div></div>
            <div><div className="tiny muted">IRN</div><div className="mono small">{(so.id + '...e8f9').replace('so-','')}aab2…</div></div>
          </div>

          <table>
            <thead>
              <tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {docLines ? docLines.map((l, i) => {
                const cat = l.category_id ? getCategory(l.category_id) : null;
                const prod = !cat && l.ref_id ? getProduct(l.ref_id) : null;
                const soLine = l.ref_id ? (so.lines || []).find(x => x.id === l.ref_id) : null;
                const clientName = soLine && soLine.client_name;
                const name = clientName || (cat ? cat.name : (l.label || (prod && prod.name) || 'Item'));
                const hsn = cat ? cat.hsn : (prod && prod.hsn) || '—';
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td><strong>{name}</strong>{cat && <div className="tiny muted">{cat.bundle_desc}</div>}</td>
                    <td className="mono">{hsn}</td>
                    <td className="num mono">{l.qty}</td>
                    <td className="num mono">{inr(l.unit_price)}</td>
                    <td className="num mono">{inr(l.amount)}</td>
                  </tr>
                );
              }) : so.lines.map((l, i) => {
                const cat = getCategory(l.category_id);
                return (
                  <tr key={l.id}>
                    <td>{i+1}</td>
                    <td>
                      <strong>{l.client_name || cat.name}</strong>
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
              {billAdj > 0 && <tr><td>Ordered value</td><td className="num mono right">{inr(orderedSubtotal)}</td></tr>}
              {billAdj > 0 && <tr><td style={{ color: 'var(--danger)' }}>Less: items not supplied</td><td className="num mono right" style={{ color: 'var(--danger)' }}>−{inr(billAdj)}</td></tr>}
              <tr><td>{billAdj > 0 ? 'Net subtotal' : 'Subtotal'}</td><td className="num mono right">{inr(subtotal)}</td></tr>
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
              {so.lines.flatMap(l => l.components.map(c => ({ c, bundle: l.bundle_qty || 1 }))).map(({ c, bundle }, i) => {
                const p = getProduct(c.product_id);
                return <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small">{p.name}</span>
                  <span className="mono small">{c.qty * bundle}{bundle > 1 && <span className="muted"> ({c.qty}×{bundle})</span>}</span>
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

// ===== Partial / Final invoicing engine =====
// Pure helpers (usable inside a mutate updater with the latest state).
function _soSub(so) { return (so.lines || []).reduce((a, l) => a + (l.bundle_qty || 0) * (l.unit_price || 0), 0); }
function _soBilled(so) { return Math.max(0, _soSub(so) - (so.bill_adjustments || []).reduce((a, x) => a + (Number(x.amount) || 0), 0)); }

// Accepted material received against this SO (GRNs of its POs) + pool stock in hand,
// minus any units later diverted to the Master Pool (so the client is never billed
// for items sent away). The matching bill_adjustment reconciles the order value.
function soReceivedQty(so, state) {
  const acc = {};
  const poIds = new Set((state.vendor_pos || []).filter(p => p.so_id === so.id).map(p => p.id));
  (state.grns || []).forEach(g => { if (poIds.has(g.po_id)) (g.items || []).forEach(it => { acc[it.product_id] = (acc[it.product_id] || 0) + (it.accepted || 0); }); });
  (so.pool_alloc || []).forEach(a => { acc[a.product_id] = (acc[a.product_id] || 0) + (Number(a.qty) || 0); });
  const out = (window.soPoolOut ? window.soPoolOut(so) : {});
  Object.keys(out).forEach(pid => { acc[pid] = Math.max(0, (acc[pid] || 0) - out[pid]); });
  return acc;
}

// Component-level invoiced ledger (works for both bundle- and component-mode
// invoices, so the two reconcile exactly against received material).
function soInvoicedComp(so) {
  const inv = {};
  (so.invoices || []).forEach(i => Object.entries(i.comp_consumed || {}).forEach(([pid, q]) => { inv[pid] = (inv[pid] || 0) + (Number(q) || 0); }));
  return inv;
}

// Per-component: received vs invoiced vs invoiceable (for component-level billing).
function soComponentState(so, state, getProduct) {
  const recv = soReceivedQty(so, state);
  const invd = soInvoicedComp(so);
  return Object.keys(recv).filter(pid => (recv[pid] || 0) > 0).map(pid => {
    const p = getProduct ? getProduct(pid) : null;
    const received = recv[pid] || 0, invoiced = invd[pid] || 0;
    return { product_id: pid, product: p, received, invoiced, invoiceable: Math.max(0, received - invoiced), sell: p ? (p.sell || 0) : 0 };
  });
}

// Per-line fulfilment: complete bundles the *not-yet-invoiced* received components
// support (greedy allocation) → invoiceable bundles now.
function soInvoiceState(so, state) {
  const recv = soReceivedQty(so, state);
  const invd = soInvoicedComp(so);
  const avail = {};
  Object.keys(recv).forEach(pid => { avail[pid] = (recv[pid] || 0) - (invd[pid] || 0); });
  return (so.lines || []).map(l => {
    let completable = l.bundle_qty || 0;
    (l.components || []).forEach(c => { const per = c.qty || 0; if (per > 0) completable = Math.min(completable, Math.floor((avail[c.product_id] || 0) / per)); });
    completable = Math.max(0, Math.min(completable, l.bundle_qty || 0));
    (l.components || []).forEach(c => { avail[c.product_id] = (avail[c.product_id] || 0) - completable * (c.qty || 0); });
    return { line_id: l.id, category_id: l.category_id, ordered: l.bundle_qty || 0, unit_price: l.unit_price || 0, components: l.components || [], invoiceableNow: completable };
  });
}

// Fraction of each bundle currently fulfilled, measured BY ITEM COUNT
// (distinct components fully received ÷ total distinct components), allocated
// greedily across bundles when a product is shared.
function soBundleFraction(so, state) {
  const avail = { ...soReceivedQty(so, state) };   // already nets out pool-out
  const out = {};
  (so.lines || []).forEach(l => {
    const comps = l.components || [];
    if (!comps.length) { out[l.id] = 1; return; }
    let count = 0;
    comps.forEach(c => {
      const req = (c.qty || 0) * (l.bundle_qty || 1);
      if (req <= 0) { count++; return; }
      if ((avail[c.product_id] || 0) >= req) { count++; avail[c.product_id] = (avail[c.product_id] || 0) - req; }
    });
    out[l.id] = count / comps.length;
  });
  return out;
}
// Cumulative fraction of each bundle already billed (non-consolidated invoices).
function soLineInvoicedFraction(so) {
  const qty = {};
  (so.invoices || []).filter(i => !i.consolidated).forEach(inv => (inv.lines || []).forEach(ln => { if (ln.ref_id) qty[ln.ref_id] = (qty[ln.ref_id] || 0) + (Number(ln.qty) || 0); }));
  const out = {};
  (so.lines || []).forEach(l => { const bq = l.bundle_qty || 1; out[l.id] = bq > 0 ? (qty[l.id] || 0) / bq : 0; });
  return out;
}
const _nonConsolidatedTotal = (invs) => (invs || []).filter(i => !i.consolidated).reduce((a, i) => a + (i.total || 0), 0);

// Item-count fractional invoice: bills the newly-fulfilled fraction of each
// bundle (e.g. 0.8 then 0.2). Always type 'Partial'; the consolidated final is
// raised separately once everything is in.
function buildFractionInvoice(so, state, currentUser, getUser) {
  if ((so.invoices || []).length === 0 && so.invoice_no) return null;   // legacy full invoice
  const frac = soBundleFraction(so, state);
  const invF = soLineInvoicedFraction(so);
  const lines = []; const comp = {}; let subtotal = 0;
  (so.lines || []).forEach(l => {
    const newF = Math.max(0, (frac[l.id] || 0) - (invF[l.id] || 0));
    if (newF <= 0.0005) return;
    const qty = Math.round(newF * (l.bundle_qty || 1) * 1000) / 1000;
    if (qty <= 0) return;
    const amount = Math.round(qty * (l.unit_price || 0));
    if (amount <= 0) return;
    lines.push({ kind: 'bundle', ref_id: l.id, category_id: l.category_id, qty, unit_price: l.unit_price || 0, amount });
    subtotal += amount;
    (l.components || []).forEach(c => { comp[c.product_id] = (comp[c.product_id] || 0) + (c.qty || 0) * qty; });
  });
  if (subtotal <= 0.5) return null;
  // Never bill beyond the order's remaining billable value (guards against mixed
  // manual/auto invoicing and rounding drift).
  const invoicedSub = (so.invoices || []).filter(i => !i.consolidated).reduce((a, i) => a + (i.subtotal || 0), 0);
  const remainingBilled = Math.max(0, _soBilled(so) - invoicedSub);
  if (remainingBilled <= 0.5) return null;
  subtotal = Math.min(subtotal, Math.round(remainingBilled));
  const total = Math.round(subtotal * 1.18);
  const seqBase = (state.sales_orders || []).reduce((a, x) => a + ((x.invoices || []).length || (x.invoice_no ? 1 : 0)), 0);
  const role = (getUser && currentUser) ? (getUser(currentUser)?.role || '') : '';
  const invoice = { id: 'inv-' + Date.now() + Math.random().toString(36).slice(2, 5), no: `INV/FY26/${String(73 + seqBase).padStart(4, '0')}`, date: TODAY, type: 'Partial', mode: 'itemfraction', lines, comp_consumed: comp, subtotal, gst: total - subtotal, total, created_by: currentUser || null, role };
  const invoices = [...(so.invoices || []), invoice];
  const nextSO = { ...so, invoices, invoice_no: invoice.no, invoice_date: TODAY, invoice_amount: _nonConsolidatedTotal(invoices) };
  return { so: nextSO, invoice, fully: false };
}
// Consolidated final tax invoice: the whole order at full qty (e.g. qty 1), as a
// single shareable document. Raised automatically once every bundle is fully
// received AND fully billed by the partials. NOT added to the SO total again.
function buildConsolidatedInvoice(so, state, currentUser, getUser) {
  if ((so.invoices || []).some(i => i.consolidated)) return null;
  if ((so.invoices || []).length === 0 && so.invoice_no) return null;
  const frac = soBundleFraction(so, state);
  const invF = soLineInvoicedFraction(so);
  const lines = so.lines || [];
  if (!lines.length) return null;
  const allDone = lines.every(l => (frac[l.id] || 0) >= 0.999 && (invF[l.id] || 0) >= 0.999);
  if (!allDone) return null;
  const invLines = lines.map(l => ({ kind: 'bundle', ref_id: l.id, category_id: l.category_id, qty: l.bundle_qty || 1, unit_price: l.unit_price || 0, amount: Math.round((l.bundle_qty || 1) * (l.unit_price || 0)) }));
  const subtotal = invLines.reduce((a, x) => a + x.amount, 0);
  if (subtotal <= 0.5) return null;
  const total = Math.round(subtotal * 1.18);
  const seqBase = (state.sales_orders || []).reduce((a, x) => a + ((x.invoices || []).length || (x.invoice_no ? 1 : 0)), 0);
  const role = (getUser && currentUser) ? (getUser(currentUser)?.role || '') : '';
  const invoice = { id: 'inv-' + Date.now() + Math.random().toString(36).slice(2, 5), no: `INV/FY26/${String(73 + seqBase).padStart(4, '0')}`, date: TODAY, type: 'Final', mode: 'consolidated', consolidated: true, lines: invLines, comp_consumed: {}, subtotal, gst: total - subtotal, total, created_by: currentUser || null, role };
  const invoices = [...(so.invoices || []), invoice];
  const nextSO = { ...so, invoices, status: 'Invoiced', invoice_no: invoice.no, invoice_date: TODAY, invoice_amount: _nonConsolidatedTotal(invoices) };
  return { so: nextSO, invoice, fully: true };
}

// Build (don't commit) the next invoice. opts.mode: 'bundle' | 'component' | 'final'.
// opts.selections optionally caps qty per line (bundle) or per product (component);
// default = everything invoiceable. Records comp_consumed for the ledger.
function buildInvoice(so, state, opts, currentUser, getUser, getProduct) {
  const mode = (opts && opts.mode) || 'bundle';
  if (mode === 'itemfraction') return buildFractionInvoice(so, state, currentUser, getUser);
  if (mode === 'consolidated') return buildConsolidatedInvoice(so, state, currentUser, getUser);
  if ((so.invoices || []).length === 0 && so.invoice_no) return null;   // legacy direct invoice → done
  const sel = opts && opts.selections;
  const invoicedSub = (so.invoices || []).filter(i => !i.consolidated).reduce((a, i) => a + (i.subtotal || 0), 0);
  const remainingBilled = Math.max(0, _soBilled(so) - invoicedSub);
  if (remainingBilled <= 0.5) return null;

  const lines = []; const comp = {}; let subtotal = 0;
  if (mode === 'component') {
    soComponentState(so, state, getProduct).forEach(r => {
      const want = sel ? (Number(sel[r.product_id]) || 0) : r.invoiceable;
      const qty = Math.max(0, Math.min(want, r.invoiceable));
      if (qty > 0) { lines.push({ kind: 'component', ref_id: r.product_id, label: r.product ? r.product.name : r.product_id, qty, unit_price: r.sell, amount: qty * r.sell }); comp[r.product_id] = (comp[r.product_id] || 0) + qty; subtotal += qty * r.sell; }
    });
  } else if (mode === 'final') {
    soComponentState(so, state, getProduct).forEach(r => { if (r.invoiceable > 0) comp[r.product_id] = (comp[r.product_id] || 0) + r.invoiceable; });
    subtotal = remainingBilled;
    lines.push({ kind: 'balance', ref_id: 'balance', label: 'Balance of order', qty: 1, unit_price: Math.round(subtotal), amount: Math.round(subtotal) });
  } else { // bundle
    soInvoiceState(so, state).forEach(x => {
      const want = sel ? (Number(sel[x.line_id]) || 0) : x.invoiceableNow;
      const qty = Math.max(0, Math.min(want, x.invoiceableNow));
      if (qty > 0) {
        lines.push({ kind: 'bundle', ref_id: x.line_id, category_id: x.category_id, qty, unit_price: x.unit_price, amount: qty * x.unit_price });
        (x.components || []).forEach(c => { comp[c.product_id] = (comp[c.product_id] || 0) + (c.qty || 0) * qty; });
        subtotal += qty * x.unit_price;
      }
    });
  }
  if (subtotal <= 0.5) return null;
  subtotal = Math.min(Math.round(subtotal), Math.round(remainingBilled));
  const total = Math.round(subtotal * 1.18);
  const fully = (remainingBilled - subtotal) <= 0.5;
  const seqBase = (state.sales_orders || []).reduce((a, x) => a + ((x.invoices || []).length || (x.invoice_no ? 1 : 0)), 0);
  const role = (getUser && currentUser) ? (getUser(currentUser)?.role || '') : '';
  const invoice = {
    id: 'inv-' + Date.now() + Math.random().toString(36).slice(2, 5),
    no: `INV/FY26/${String(73 + seqBase).padStart(4, '0')}`, date: TODAY,
    type: fully ? 'Final' : 'Partial', mode, lines, comp_consumed: comp,
    subtotal, gst: total - subtotal, total, created_by: currentUser || null, role,
  };
  const invoices = [...(so.invoices || []), invoice];
  const nextSO = { ...so, invoices, invoice_no: invoice.no, invoice_date: TODAY, invoice_amount: _nonConsolidatedTotal(invoices), status: fully ? 'Invoiced' : so.status };
  return { so: nextSO, invoice, fully };
}

// Commit an invoice (computed against the latest state inside the updater).
function raiseSOInvoice(soId, opts, ctx, uiOpts) {
  const { mutate, toast, currentUser, getUser, getProduct } = ctx; uiOpts = uiOpts || {};
  let made = null;
  mutate(s => {
    const so = (s.sales_orders || []).find(x => x.id === soId);
    if (!so) return s;
    const built = buildInvoice(so, s, opts || { mode: 'bundle' }, currentUser, getUser, getProduct);
    if (!built) return s;
    made = built;
    return {
      ...s,
      sales_orders: s.sales_orders.map(x => x.id === soId ? built.so : x),
      notifications: [{ id: 'n-inv-' + Date.now(), kind: 'invoice', text: `${built.invoice.no} (${built.invoice.type}) for ${so.so_no} · ${inrK(built.invoice.total)}${built.fully ? ' · fully invoiced' : ''}`, date: TODAY, read: false, role: 'Collections' }, ...s.notifications],
    };
  }, { action: 'invoice', entity: 'SalesOrder', entity_id: soId });
  if (made) { if (toast) toast(`${made.invoice.no} (${made.invoice.type}) · ${inrK(made.invoice.total)}${made.fully ? ' · fully invoiced' : ''}`, 'success'); }
  else if (toast && !uiOpts.silent) toast((opts && opts.mode === 'final') ? 'Nothing left to invoice' : 'Nothing received & un-invoiced for that selection');
  return made;
}

// SO detail → Invoicing tab: live fulfilment + partial/final invoices, billed by
// BUNDLE or by COMPONENT (user's choice). Both reconcile via the component ledger.
function SOInvoicingTab({ so }) {
  const { state, mutate, navigate, currentUser, getUser, getCategory, getProduct, soBilledSubtotal, soBillAdjustment } = useStore();
  const toast = useToast();
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canInvoice = ['Purchase', 'Billing', 'Collections', 'Org Admin'].includes(role);
  const [mode, setMode] = React.useState('bundle');
  const [bundleSel, setBundleSel] = React.useState({});
  const [compSel, setCompSel] = React.useState({});
  const ctx = { mutate, toast, currentUser, getUser, getProduct };

  const st = soInvoiceState(so, state);
  const comps = soComponentState(so, state, getProduct);
  const invoices = so.invoices || [];
  const billed = soBilledSubtotal(so);
  const legacyInvoiced = invoices.length === 0 && so.invoice_no;
  const invoicedSub = legacyInvoiced ? billed : invoices.filter(i => !i.consolidated).reduce((a, i) => a + (i.subtotal || 0), 0);
  const remaining = legacyInvoiced ? 0 : Math.max(0, billed - invoicedSub);
  const invoiceableBundles = st.reduce((a, x) => a + x.invoiceableNow, 0);
  const invoiceableComps = comps.reduce((a, x) => a + x.invoiceable, 0);

  return (
    <div className="stack">
      <div className="mb-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Billed value</div><div style={{ fontSize: 18, fontWeight: 700 }} className="mono">{inr(billed)}</div>{soBillAdjustment(so) > 0 && <div className="tiny muted">after −{inr(soBillAdjustment(so))} removed</div>}</div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Invoiced so far</div><div style={{ fontSize: 18, fontWeight: 700 }} className="mono">{inr(invoicedSub)}</div><div className="tiny muted">{invoices.length} invoice(s)</div></div></div>
        <div className="card" style={{ borderColor: remaining > 0 ? 'oklch(0.85 0.09 75)' : 'oklch(0.85 0.06 155)' }}><div className="card-body" style={{ textAlign: 'center', background: remaining > 0 ? 'var(--warning-bg)' : 'var(--success-bg)' }}><div className="tiny muted">Balance to invoice</div><div style={{ fontSize: 18, fontWeight: 700 }} className="mono">{inr(remaining)}</div></div></div>
      </div>

      {legacyInvoiced && <div className="card"><div className="card-body small muted">This SO was invoiced via a single full invoice ({so.invoice_no}). Partial invoicing is closed.</div></div>}

      {canInvoice && remaining > 0.5 && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Raise invoice</h3>
            <div className="tabs" style={{ border: 'none' }}>
              <button className={`tab ${mode === 'bundle' ? 'active' : ''}`} onClick={() => setMode('bundle')}>By bundle</button>
              <button className={`tab ${mode === 'component' ? 'active' : ''}`} onClick={() => setMode('component')}>By component</button>
            </div>
          </div>
          <div className="card-body flush">
            {mode === 'bundle' ? (
              <table className="t">
                <thead><tr><th>Bundle</th><th className="num">Ordered</th><th className="num">Invoiceable now</th><th className="num">Invoice qty</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {st.map(x => { const cat = getCategory(x.category_id) || { name: x.category_id }; const q = bundleSel[x.line_id] != null ? bundleSel[x.line_id] : x.invoiceableNow; return (
                    <tr key={x.line_id}>
                      <td>{cat.name}</td><td className="num">{x.ordered}</td>
                      <td className="num">{x.invoiceableNow}</td>
                      <td className="num"><input type="number" min="0" max={x.invoiceableNow} className="input mono" value={q} onChange={e => setBundleSel(m => ({ ...m, [x.line_id]: e.target.value }))} style={{ width: 64, textAlign: 'right', height: 24 }}/></td>
                      <td className="num mono">{inr(Math.max(0, Math.min(Number(q) || 0, x.invoiceableNow)) * x.unit_price)}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            ) : (
              <table className="t">
                <thead><tr><th>Component</th><th className="num">Received</th><th className="num">Invoiced</th><th className="num">Invoiceable</th><th className="num">Invoice qty</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {comps.map(r => { const q = compSel[r.product_id] != null ? compSel[r.product_id] : r.invoiceable; return (
                    <tr key={r.product_id}>
                      <td>{r.product ? r.product.name : r.product_id}<div className="tiny muted mono">@ {inr(r.sell)}</div></td>
                      <td className="num">{r.received}</td><td className="num">{r.invoiced}</td><td className="num">{r.invoiceable}</td>
                      <td className="num"><input type="number" min="0" max={r.invoiceable} className="input mono" value={q} onChange={e => setCompSel(m => ({ ...m, [r.product_id]: e.target.value }))} style={{ width: 64, textAlign: 'right', height: 24 }}/></td>
                      <td className="num mono">{inr(Math.max(0, Math.min(Number(q) || 0, r.invoiceable)) * r.sell)}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            )}
          </div>
          <div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border)' }}>
            <div className="grow tiny muted">{mode === 'bundle' ? `${invoiceableBundles} bundle(s) ready` : `${invoiceableComps} component unit(s) ready`} · partial bills your selection; final bills the whole balance.</div>
            <button className="btn" disabled={mode === 'bundle' ? invoiceableBundles === 0 : invoiceableComps === 0} onClick={() => { raiseSOInvoice(so.id, { mode, selections: mode === 'bundle' ? bundleSel : compSel }, ctx); setBundleSel({}); setCompSel({}); }}><Icon name="receipt" size={13}/>Create partial invoice</button>
            <button className="btn btn-primary" onClick={() => raiseSOInvoice(so.id, { mode: 'final' }, ctx)}><Icon name="receipt" size={13}/>Final / full invoice</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><h3 className="card-title">Invoices raised</h3></div>
        <div className="card-body flush">
          {invoices.length === 0 && legacyInvoiced ? (
            <table className="t"><thead><tr><th>Invoice</th><th>Type</th><th>Date</th><th className="num">Total</th></tr></thead>
              <tbody><tr><td className="mono">{so.invoice_no}</td><td><span className="badge success dot">Full</span></td><td className="mono small">{fmtDate(so.invoice_date)}</td><td className="num"><strong>{inr(so.invoice_amount)}</strong></td></tr></tbody>
            </table>
          ) : invoices.length === 0 ? <div className="empty">No invoices yet. Partial invoices auto-appear as material is received; or raise one above.</div> : (
            <table className="t">
              <thead><tr><th>Invoice</th><th>Type</th><th className="num">Qty</th><th>Date</th><th className="num">Subtotal</th><th className="num">Total</th></tr></thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} onClick={() => navigate(`invoices/${so.id}/${inv.id}`)} style={{ cursor: 'pointer' }}>
                    <td className="mono">{inv.no}</td>
                    <td>{inv.consolidated ? <span className="badge success dot">Consolidated</span> : inv.type === 'Final' ? <span className="badge success dot">Final</span> : <span className="badge accent dot">Partial</span>}</td>
                    <td className="num mono">{(inv.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0) || '—'}</td>
                    <td className="mono small">{fmtDate(inv.date)}</td>
                    <td className="num">{inr(inv.subtotal)}</td>
                    <td className="num"><strong>{inr(inv.total)}</strong>{inv.consolidated && <div className="tiny muted">summary</div>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan="5" className="right small">Total billed (excl. consolidated)</td><td className="num mono"><strong>{inr(_nonConsolidatedTotal(invoices))}</strong></td></tr></tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// SO detail → GRN tab: this SO's GRNs, an invoice-creation button, and the
// client invoices (partial + consolidated), each opening in the shareable template.
function SOGrnTab({ so }) {
  const { state, navigate, mutate, currentUser, getUser, getProduct } = useStore();
  const toast = useToast();
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canInvoice = ['Purchase', 'Billing', 'Collections', 'Project Manager', 'Org Admin'].includes(role);
  const soPOs = (state.vendor_pos || []).filter(p => p.so_id === so.id);
  const soPoIds = new Set(soPOs.map(p => p.id));
  const grns = (state.grns || []).filter(g => soPoIds.has(g.po_id));
  const invoices = so.invoices || [];
  const frac = window.soBundleFraction ? window.soBundleFraction(so, state) : {};
  const overallFrac = (so.lines || []).length ? (so.lines.reduce((a, l) => a + (frac[l.id] || 0), 0) / so.lines.length) : 0;
  const createInvoice = () => {
    const made = window.autoInvoiceSO ? window.autoInvoiceSO(so.id, { mutate, toast: null, currentUser, getUser, getProduct }) : null;
    toast(made ? `${made.invoice.no} created (${made.invoice.type})` : 'Nothing new to invoice yet — receive more items first', made ? 'success' : '');
  };
  return (
    <div className="stack">
      <div className="mb-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">GRNs posted</div><div style={{ fontSize: 18, fontWeight: 700 }} className="mono">{grns.length}</div></div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Received (by item count)</div><div style={{ fontSize: 18, fontWeight: 700 }} className="mono">{Math.round(overallFrac * 100)}%</div></div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}><div className="tiny muted">Client invoices</div><div style={{ fontSize: 18, fontWeight: 700 }} className="mono">{invoices.length}</div></div></div>
      </div>
      {canInvoice && (
        <div className="card"><div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="grow"><strong className="small">Create client invoice for received items</strong><div className="tiny muted">Bills the newly-received fraction (e.g. 0.8 then 0.2); the consolidated qty-1 final auto-creates once everything is in. Saved here and in the Invoicing tab.</div></div>
          <button className="btn btn-primary" onClick={createInvoice}><Icon name="receipt" size={13}/>Create client invoice</button>
        </div></div>
      )}
      <div className="card">
        <div className="card-header"><h3 className="card-title">GRNs for this SO</h3></div>
        <div className="card-body flush">
          {grns.length === 0 ? <div className="empty">No GRNs yet — receive items in the Virtual Godown.</div> : (
            <table className="t">
              <thead><tr><th>GRN</th><th>Vendor PO</th><th>Date</th><th className="num">Lines</th><th></th></tr></thead>
              <tbody>{grns.map(g => { const po = soPOs.find(p => p.id === g.po_id); return (
                <tr key={g.id} onClick={() => navigate(`grn/${g.id}`)} style={{ cursor: 'pointer' }}>
                  <td className="mono">{g.grn_no}</td><td className="mono small">{po ? po.po_no : ''}</td><td className="mono small">{fmtDate(g.date)}</td><td className="num">{(g.items || []).length}</td><td><Icon name="chevronRight" size={12}/></td>
                </tr>); })}</tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Client Invoices</h3><span className="card-sub">partial + consolidated · click to open the template</span></div>
        <div className="card-body flush">
          {invoices.length === 0 ? <div className="empty">No invoices yet.</div> : (
            <table className="t">
              <thead><tr><th>Invoice</th><th>Type</th><th className="num">Qty</th><th>Date</th><th className="num">Total</th></tr></thead>
              <tbody>{invoices.map(inv => (
                <tr key={inv.id} onClick={() => navigate(`invoices/${so.id}/${inv.id}`)} style={{ cursor: 'pointer' }}>
                  <td className="mono">{inv.no}</td>
                  <td>{inv.consolidated ? <span className="badge success dot">Consolidated</span> : inv.type === 'Final' ? <span className="badge success dot">Final</span> : <span className="badge accent dot">Partial</span>}</td>
                  <td className="num mono">{(inv.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0)}</td>
                  <td className="mono small">{fmtDate(inv.date)}</td>
                  <td className="num"><strong>{inr(inv.total)}</strong>{inv.consolidated && <div className="tiny muted">summary</div>}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan="4" className="right small">Billed (excl. consolidated)</td><td className="num mono"><strong>{inr(_nonConsolidatedTotal(invoices))}</strong></td></tr></tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Auto client invoicing on receipt: raise the item-count fractional partial
// (0.8, then 0.2…), then — if the order is now fully received & billed — raise
// the consolidated qty-1 final. Both are separate, real, shareable invoices.
function autoInvoiceSO(soId, ctx) {
  const made = raiseSOInvoice(soId, { mode: 'itemfraction' }, ctx, { silent: true });
  raiseSOInvoice(soId, { mode: 'consolidated' }, ctx, { silent: true });
  return made;
}

window.soBundleFraction = soBundleFraction;
window.soInvoiceState = soInvoiceState;
window.raiseSOInvoice = raiseSOInvoice;
window.autoInvoiceSO = autoInvoiceSO;
window.SOGrnTab = SOGrnTab;
window.SOInvoicingTab = SOInvoicingTab;
window.InvoiceList = InvoiceList;
window.InvoiceDetail = InvoiceDetail;
window.CollectionsDashboard = CollectionsDashboard;
