// OP Central — Dashboard screens (role-aware)

// Real per-SO metrics (no dummy data) — sell, vendor spend, profit margin,
// vendors and lifecycle progress, all computed from app state.
function soMetrics(state, so, soSubtotal) {
  const sell = soSubtotal(so);
  const pos = state.vendor_pos.filter(p => p.so_id === so.id);
  const vendorSpend = pos.reduce((s, p) => s + (p.amount || 0), 0);
  const margin = sell - vendorSpend;
  const vendorIds = [...new Set(pos.map(p => p.vendor_id))];
  const idx = SO_LIFECYCLE.indexOf(so.status);
  const progress = idx >= 0 ? Math.round((idx / (SO_LIFECYCLE.length - 1)) * 100) : 0;
  return { sell, vendorSpend, margin, marginPct: sell > 0 ? (margin / sell) * 100 : 0, vendorIds, progress };
}

// ===== Dashboard shell — 3 switchable views =====
function Dashboard() {
  const { state, currentUser, getUser, navigate } = useStore();
  const user = getUser(currentUser);
  const role = user.role;
  const canCreateSO = canDo(role, 'createSO') || role === 'Org Admin';
  const myTasks = window.tasksForRole(state, role, () => {}, () => {}, () => {});
  const [view, setView] = React.useState('board');
  const views = [
    { id: 'board', label: 'SO Board', icon: 'grid' },
    { id: 'overview', label: 'Overview', icon: 'chart' },
    { id: 'classic', label: 'Classic', icon: 'home' },
  ];
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Good morning, {user.name.split(' ')[0]}</h1>
          <div className="page-sub">{role} workspace · {fmtDate(TODAY)} · {state.org.short}</div>
        </div>
        <div className="page-actions">
          <div className="tabs" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 2 }}>
            {views.map(v => <button key={v.id} className={`tab ${view === v.id ? 'active' : ''}`} onClick={() => setView(v.id)}><Icon name={v.icon} size={12}/> {v.label}</button>)}
          </div>
          {canCreateSO && <button className="btn btn-primary" onClick={() => navigate('sales-orders/new')}><Icon name="plus" size={13}/> New SO</button>}
          {!canCreateSO && myTasks.length > 0 && <button className="btn btn-primary" onClick={() => navigate('inbox')}><Icon name="bell" size={13}/> {myTasks.length} task(s)</button>}
        </div>
      </div>
      {view === 'board' && <SOBoardDashboard/>}
      {view === 'overview' && <SOOverviewDashboard/>}
      {view === 'classic' && <ClassicDashboardBody/>}
    </div>
  );
}

// ===== View 1 — Excel-like board of resizable SO cards =====
function SOBoardDashboard() {
  const { state, navigate, soSubtotal, getCustomer, getUser, getVendor } = useStore();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [priority, setPriority] = React.useState('');
  const [pmF, setPmF] = React.useState('');
  const [sort, setSort] = React.useState('date');
  const [dir, setDir] = React.useState('desc');
  const [page, setPage] = React.useState(0);
  const PER = 48;

  const statuses = [...new Set(state.sales_orders.map(s => s.status))];
  const pms = [...new Set(state.sales_orders.map(s => s.pm).filter(Boolean))];

  let rows = state.sales_orders.map(so => ({ so, m: soMetrics(state, so, soSubtotal), cust: getCustomer(so.customer_id) }));
  rows = rows.filter(r => {
    if (status && r.so.status !== status) return false;
    if (priority && r.so.priority !== priority) return false;
    if (pmF && r.so.pm !== pmF) return false;
    if (q) { const blob = `${r.so.so_no} ${r.cust?.name || ''} ${r.so.customer_po || ''}`.toLowerCase(); if (!blob.includes(q.toLowerCase())) return false; }
    return true;
  });
  const cmp = { date: (a, b) => (a.so.date || '').localeCompare(b.so.date || ''), value: (a, b) => a.m.sell - b.m.sell, margin: (a, b) => a.m.marginPct - b.m.marginPct, expected: (a, b) => (a.so.expected || '').localeCompare(b.so.expected || ''), so: (a, b) => (a.so.so_no || '').localeCompare(b.so.so_no || '') };
  rows.sort(cmp[sort] || cmp.date); if (dir === 'desc') rows.reverse();
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const pg = Math.min(page, pages - 1);
  const slice = rows.slice(pg * PER, pg * PER + PER);

  return (
    <div className="stack">
      <div className="card"><div className="filter-bar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <input className="input search" placeholder="Search SO, customer, PO…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} style={{ flex: '0 0 200px' }}/>
        <select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select className="select" value={priority} onChange={e => { setPriority(e.target.value); setPage(0); }}><option value="">All priorities</option><option>Standard</option><option>Urgent</option><option>Critical</option></select>
        <select className="select" value={pmF} onChange={e => { setPmF(e.target.value); setPage(0); }}><option value="">All PMs</option>{pms.map(id => <option key={id} value={id}>{getUser(id)?.name || id}</option>)}</select>
        <select className="select" value={sort} onChange={e => setSort(e.target.value)}><option value="date">Sort: Created</option><option value="expected">Delivery</option><option value="value">Value</option><option value="margin">Margin %</option><option value="so">SO No</option></select>
        <button className="btn btn-sm" onClick={() => setDir(d => d === 'asc' ? 'desc' : 'asc')}><Icon name="sort" size={12}/>{dir === 'asc' ? 'Asc' : 'Desc'}</button>
        <div className="grow"/>
        <span className="muted small">{rows.length} SO(s) · drag any card's bottom-right corner to resize</span>
      </div></div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {slice.map(({ so, m, cust }) => {
          const mColor = m.margin >= 0 ? 'var(--success)' : 'var(--danger)';
          return (
            <div key={so.id} onDoubleClick={() => navigate(`sales-orders/${so.id}`)}
              style={{ flex: '0 0 auto', width: 'calc(25% - 8px)', minWidth: 210, height: 196, minHeight: 150, maxWidth: '100%', resize: 'both', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', padding: 10, cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust ? cust.name : '—'}</div>
                  <a className="mono tiny" style={{ cursor: 'pointer' }} onClick={() => navigate(`sales-orders/${so.id}`)}>{so.so_no}</a>
                </div>
                <PriorityBadge priority={so.priority}/>
              </div>
              <div style={{ margin: '6px 0' }}><StatusBadge status={so.status}/></div>
              <div style={{ height: 6, background: 'var(--bg-subtle)', borderRadius: 4, overflow: 'hidden', margin: '2px 0 6px' }}>
                <div style={{ width: `${m.progress}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }}/>
              </div>
              <div className="dl" style={{ gridTemplateColumns: 'auto 1fr', rowGap: 3, columnGap: 8, fontSize: 11.5 }}>
                <dt className="muted">Value</dt><dd className="mono right">{inr(m.sell)}</dd>
                <dt className="muted">Margin</dt><dd className="mono right" style={{ color: mColor, fontWeight: 600 }}>{inr(m.margin)} · {m.marginPct >= 0 ? '+' : ''}{m.marginPct.toFixed(1)}%</dd>
                <dt className="muted">PM</dt><dd className="right trunc">{getUser(so.pm)?.name || 'Unassigned'}</dd>
                <dt className="muted">Created</dt><dd className="mono right">{fmtDate(so.date)}</dd>
                <dt className="muted">Delivery</dt><dd className="mono right">{fmtDate(so.expected)}</dd>
                <dt className="muted">Vendors</dt><dd className="right trunc">{m.vendorIds.length ? m.vendorIds.map(id => getVendor(id)?.name || id).join(', ') : '—'}</dd>
              </div>
            </div>
          );
        })}
        {slice.length === 0 && <div className="card" style={{ flex: 1 }}><div className="empty">No SOs match the filters.</div></div>}
      </div>

      {pages > 1 && (
        <div className="card"><div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <button className="btn btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>← Prev</button>
          <span className="small muted">Page {pg + 1} / {pages} · showing {slice.length} of {rows.length}</span>
          <button className="btn btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next →</button>
        </div></div>
      )}
    </div>
  );
}

// ===== View 2 — Overview: progress + real charts =====
function SOOverviewDashboard() {
  const { state, navigate, soSubtotal, getCustomer } = useStore();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('');
  const rows = state.sales_orders.map(so => ({ so, m: soMetrics(state, so, soSubtotal), cust: getCustomer(so.customer_id) }))
    .filter(r => (!status || r.so.status === status) && (!q || `${r.so.so_no} ${r.cust?.name || ''}`.toLowerCase().includes(q.toLowerCase())));
  const statuses = [...new Set(state.sales_orders.map(s => s.status))];
  const open = state.sales_orders.filter(s => !['Closed', 'Fully Paid', 'Cancelled'].includes(s.status));
  const totalSell = rows.reduce((s, r) => s + r.m.sell, 0);
  const totalMargin = rows.reduce((s, r) => s + r.m.margin, 0);
  const blendedPct = totalSell > 0 ? (totalMargin / totalSell) * 100 : 0;
  const prioCounts = ['Critical', 'Urgent', 'Standard'].map(p => ({ p, n: state.sales_orders.filter(s => s.priority === p).length }));
  const prioMax = Math.max(1, ...prioCounts.map(c => c.n));
  const topMargin = [...rows].sort((a, b) => b.m.margin - a.m.margin).slice(0, 8);
  const mMax = Math.max(1, ...topMargin.map(r => Math.abs(r.m.margin)));

  return (
    <div className="stack">
      <div className="kpi-grid mb-1">
        <div className="kpi"><div className="kpi-label">Sales Orders</div><div className="kpi-value">{state.sales_orders.length}</div><div className="kpi-delta"><span>{open.length} open</span></div></div>
        <div className="kpi"><div className="kpi-label">Pipeline value</div><div className="kpi-value">{inrK(totalSell)}</div><div className="kpi-delta"><span>sum of SO value</span></div></div>
        <div className="kpi"><div className="kpi-label">Total profit margin</div><div className="kpi-value" style={{ color: totalMargin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{inrK(totalMargin)}</div><div className="kpi-delta"><span>sell − vendor spend</span></div></div>
        <div className="kpi"><div className="kpi-label">Blended margin %</div><div className="kpi-value">{blendedPct.toFixed(1)}%</div><div className="kpi-delta"><span>real, current</span></div></div>
      </div>

      <div className="split-2">
        <div className="card"><div className="card-header"><h3 className="card-title">Status funnel</h3><span className="card-sub">all SOs</span></div><div className="card-body"><FunnelChart orders={state.sales_orders}/></div></div>
        <div className="card"><div className="card-header"><h3 className="card-title">Priority mix</h3></div><div className="card-body"><div className="stack" style={{ gap: 7 }}>
          {prioCounts.map(c => (
            <div key={c.p} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 30px', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
              <span className="muted">{c.p}</span>
              <div style={{ height: 9, background: 'var(--bg-subtle)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${(c.n / prioMax) * 100}%`, height: '100%', background: c.p === 'Critical' ? 'var(--danger)' : c.p === 'Urgent' ? 'var(--warning)' : 'var(--accent)' }}/></div>
              <span className="mono num right">{c.n}</span>
            </div>
          ))}
        </div></div></div>
      </div>

      <div className="card"><div className="card-header"><h3 className="card-title">Profit margin — top SOs</h3><span className="card-sub">sell − vendor spend</span></div><div className="card-body"><div className="stack" style={{ gap: 6 }}>
        {topMargin.map(r => (
          <div key={r.so.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 110px', gap: 8, alignItems: 'center', fontSize: 11.5, cursor: 'pointer' }} onClick={() => navigate(`sales-orders/${r.so.id}`)}>
            <span className="trunc"><span className="mono">{r.so.so_no}</span> · {r.cust?.name}</span>
            <div style={{ height: 9, background: 'var(--bg-subtle)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${(Math.abs(r.m.margin) / mMax) * 100}%`, height: '100%', background: r.m.margin >= 0 ? 'var(--success)' : 'var(--danger)' }}/></div>
            <span className="mono num right" style={{ color: r.m.margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{inrK(r.m.margin)} · {r.m.marginPct.toFixed(0)}%</span>
          </div>
        ))}
        {topMargin.length === 0 && <div className="empty">No SOs yet.</div>}
      </div></div></div>

      <div className="card">
        <div className="card-header"><h3 className="card-title">SO progress</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input search" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ height: 26, width: 160 }}/>
            <select className="select" style={{ height: 26, fontSize: 12 }} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select>
          </div>
        </div>
        <div className="card-body flush"><div className="table-wrap"><table className="t">
          <thead><tr><th>SO · Customer</th><th>Priority</th><th>Status</th><th style={{ width: '30%' }}>Progress</th><th className="num">Value</th><th className="num">Margin</th></tr></thead>
          <tbody>
            {rows.slice(0, 200).map(r => (
              <tr key={r.so.id} onClick={() => navigate(`sales-orders/${r.so.id}`)} style={{ cursor: 'pointer' }}>
                <td><span className="mono">{r.so.so_no}</span><div className="tiny muted trunc">{r.cust?.name}</div></td>
                <td><PriorityBadge priority={r.so.priority}/></td>
                <td><StatusBadge status={r.so.status}/></td>
                <td><div style={{ height: 7, background: 'var(--bg-subtle)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${r.m.progress}%`, height: '100%', background: 'var(--accent)' }}/></div></td>
                <td className="num mono">{inrK(r.m.sell)}</td>
                <td className="num mono" style={{ color: r.m.margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{r.m.marginPct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table></div>{rows.length > 200 && <div className="tiny muted" style={{ padding: '6px 14px' }}>Showing first 200 · refine with filters.</div>}</div>
      </div>
    </div>
  );
}

// ===== View 3 — Classic (unchanged) =====
function ClassicDashboardBody() {
  const { state, currentUser, getUser, navigate, soSubtotal, getCustomer, getUser: gu } = useStore();
  const user = getUser(currentUser);
  const role = user.role;
  const allowedNav = perm(role).nav;
  const canCreateSO = canDo(role, 'createSO') || role === 'Org Admin';
  const myTasks = window.tasksForRole(state, role, () => {}, () => {}, () => {});

  // Compute KPIs from real data
  const allOrders = state.sales_orders;
  const openOrders = allOrders.filter(s => !['Closed','Fully Paid','Cancelled'].includes(s.status));
  const pipelineValue = openOrders.reduce((sum, s) => sum + soSubtotal(s), 0);
  const invoicedThisMonth = allOrders.filter(s => s.invoice_amount).reduce((sum, s) => sum + s.invoice_amount, 0);
  const totalOutstanding = allOrders.filter(s => s.status === 'Payment Pending').reduce((sum, s) => sum + (s.invoice_amount || 0), 0);
  const overdueOrders = allOrders.filter(s => (s.days_overdue || 0) > 0);
  const overdueAmount = overdueOrders.reduce((sum, s) => sum + (s.invoice_amount || 0), 0);
  const pendingPOs = state.vendor_pos.filter(p => p.status !== 'Material Received').length;
  const pendingGRNs = state.vendor_pos.filter(p => p.status === 'In Transit').length;
  const poolValue = state.pool.reduce((sum, p) => {
    const pr = state.products.find(x => x.id === p.product_id);
    return sum + (pr ? pr.buy * p.qty : 0);
  }, 0);

  const kpisByRole = {
    'Org Admin': [
      { label: 'Active SOs', value: openOrders.length, sub: `${allOrders.length} total this FY` },
      { label: 'Pipeline Value', value: inrK(pipelineValue), sub: 'Across open SOs', delta: 12 },
      { label: 'Invoiced (MTD)', value: inrK(invoicedThisMonth), sub: 'May 2026', delta: 8 },
      { label: 'Outstanding', value: inrK(totalOutstanding), sub: `${state.sales_orders.filter(s => s.status === 'Payment Pending').length} invoices`, delta: -3 },
    ],
    'Managing Director': [
      { label: 'Revenue MTD', value: inrK(invoicedThisMonth), sub: 'May 2026', delta: 14 },
      { label: 'Approval Queue', value: 3, sub: 'Vendor POs + write-offs pending' },
      { label: 'Margin %', value: '21.4%', sub: 'Blended · current quarter', delta: 1.2 },
      { label: 'Outstanding > 30d', value: inrK(overdueAmount), sub: `${overdueOrders.length} customers` },
    ],
    'Sales': [
      { label: 'Open Quotes', value: 4, sub: 'Submitted this week' },
      { label: 'Pipeline Value', value: inrK(pipelineValue), sub: '6 active SOs', delta: 9 },
      { label: 'Win Rate', value: '68%', sub: 'Last 90 days', delta: 4 },
      { label: 'My SOs (open)', value: openOrders.length, sub: 'Assigned to me' },
    ],
    'Project Manager': [
      { label: 'My Active SOs', value: openOrders.filter(s => s.pm === currentUser).length, sub: 'Owned by me' },
      { label: 'Pending Approvals', value: 2, sub: 'Awaiting me' },
      { label: 'Transfer Requests', value: state.transfer_requests.filter(t => t.status === 'Pending').length, sub: 'Cross-SO' },
      { label: 'Upcoming Dispatches', value: 3, sub: 'Next 7 days' },
    ],
    'Purchase': [
      { label: 'Open RFQs', value: state.rfqs.filter(r => r.status === 'Responses In').length, sub: 'Awaiting decision' },
      { label: 'Active Vendor POs', value: pendingPOs, sub: 'Material in transit' },
      { label: 'LPP Variance Alerts', value: 1, sub: 'Above 10% threshold' },
      { label: 'Vendor Performance', value: '4.3 ★', sub: 'Avg this month' },
    ],
    'Stores': [
      { label: 'Pending GRNs', value: pendingGRNs, sub: 'Material expected' },
      { label: 'QC Failures', value: 1, sub: 'This week' },
      { label: 'Surplus Recon Tasks', value: 2, sub: 'Awaiting count' },
      { label: 'Pool Stock Value', value: inrK(poolValue), sub: `${state.pool.length} SKUs in pool` },
    ],
    'Billing': [
      { label: '3-Way Match Queue', value: state.vendor_invoices.filter(v => v.status === 'Pending 3-Way Match').length, sub: 'Vendor invoices' },
      { label: 'Pending Invoices', value: allOrders.filter(s => s.status === 'Ready to Dispatch').length, sub: 'To be raised' },
      { label: 'e-Way Bills Today', value: 2, sub: 'Generated · valid' },
      { label: 'GST Liability MTD', value: inrK(invoicedThisMonth * 0.18), sub: 'Output GST' },
    ],
    'Collections': [
      { label: 'Total Outstanding', value: inrK(totalOutstanding), sub: `${state.sales_orders.filter(s => s.status === 'Payment Pending').length} invoices` },
      { label: 'Overdue > 30d', value: inrK(overdueAmount), sub: `${overdueOrders.length} customers`, delta: -8 },
      { label: 'Today\'s Follow-ups', value: 5, sub: 'Calls scheduled' },
      { label: 'Collection Rate', value: '87%', sub: 'Last 30 days', delta: 3 },
    ],
  };

  const kpis = kpisByRole[role] || kpisByRole['Org Admin'];

  return (
    <div className="stack">
      <div className="kpi-grid mb-3">
        {kpis.map((k, i) => (
          <div key={i} className="kpi">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-delta">
              {k.delta !== undefined ? <Delta value={k.delta}/> : <span>{k.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="split-2to1">
        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Active Sales Orders</h3>
              <a href="#sales-orders" className="tiny muted" style={{ textDecoration: 'none' }}>View all →</a>
            </div>
            <div className="card-body flush">
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>SO No</th>
                      <th>Customer</th>
                      <th>PM</th>
                      <th>Status</th>
                      <th className="num">Value</th>
                      <th>Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openOrders.slice(0, 7).map(so => {
                      const cust = getCustomer(so.customer_id);
                      const pm = gu(so.pm);
                      return (
                        <tr key={so.id} onClick={() => navigate(`sales-orders/${so.id}`)} style={{ cursor: 'pointer' }}>
                          <td><a href={`#sales-orders/${so.id}`} className="mono">{so.so_no}</a></td>
                          <td className="trunc">{cust.name}</td>
                          <td><Avatar user={pm} size={20}/></td>
                          <td><StatusBadge status={so.status}/></td>
                          <td className="num">{inr(soSubtotal(so))}</td>
                          <td className="mono small">{fmtDate(so.expected)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="split-2">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Status Funnel</h3>
                <span className="card-sub">All open SOs</span>
              </div>
              <div className="card-body">
                <FunnelChart orders={openOrders}/>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Ageing — Outstanding</h3>
                <span className="card-sub">Customer invoices</span>
              </div>
              <div className="card-body">
                <AgeingBars orders={allOrders.filter(s => s.status === 'Payment Pending')}/>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          {myTasks.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">My Tasks <span className="muted small">· {myTasks.length}</span></h3>
                <a href="#inbox" className="tiny muted" style={{ textDecoration: 'none' }}>Open inbox →</a>
              </div>
              <div className="card-body flush">
                {myTasks.slice(0, 4).map(t => (
                  <div key={t.id} className="queue-item" onClick={() => navigate('inbox')}>
                    <Icon name={t.icon} size={13} color="var(--accent)"/>
                    <div className="grow">
                      <div className="small"><strong>{t.kind}</strong> · <span className="mono">{t.ref}</span></div>
                      <div className="tiny muted trunc">{t.detail}</div>
                    </div>
                    {t.amount > 0 && <span className="mono tiny">{inrK(t.amount)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Activity</h3>
            </div>
            <div className="card-body flush">
              <ActivityFeed />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Quick Actions</h3>
            </div>
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { id: 'sales-orders/new', label: 'New SO', icon: 'plus', cap: 'createSO' },
                { id: 'rfq', label: 'Float RFQ', icon: 'grid', cap: 'createRFQ' },
                { id: 'grn', label: 'Create GRN', icon: 'package', cap: 'createGRN' },
                { id: 'three-way', label: '3-Way Match', icon: 'check', cap: 'do3way' },
                { id: 'invoices', label: 'Invoices', icon: 'file', cap: 'raiseInvoice' },
                { id: 'collections', label: 'Collections', icon: 'cash', cap: 'logFollowup' },
                { id: 'transfers', label: 'Transfers', icon: 'arrowLeftRight', cap: 'initiateTransfer' },
                { id: 'settings', label: 'Customisation', icon: 'settings', cap: 'all' },
              ].filter(a => canDo(role, a.cap) || role === 'Org Admin')
                .filter(a => allowedNav.includes(a.id.split('/')[0]))
                .map(a => (
                <button key={a.id} className="btn" onClick={() => navigate(a.id)}>
                  <Icon name={a.icon} size={13}/>{a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Pool Snapshot</h3>
              <a href="#pool" className="tiny muted" style={{ textDecoration: 'none' }}>View pool →</a>
            </div>
            <div className="card-body flush">
              {state.pool.slice(0, 5).map((p, i) => {
                const pr = state.products.find(x => x.id === p.product_id);
                return (
                  <div key={i} className="queue-item" style={{ padding: '8px 14px' }}>
                    <div className="grow">
                      <div style={{ fontSize: 12 }}>{pr.name}</div>
                      <div className="muted tiny mono">{pr.code} · from {p.source_so}</div>
                    </div>
                    <span className="mono small">{p.qty} {pr.uom}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelChart({ orders }) {
  const stages = [
    { key: 'Pending Approval', color: 'oklch(0.7 0.13 70)' },
    { key: 'Approved', color: 'oklch(0.55 0.09 260)' },
    { key: 'Procurement Started', color: 'oklch(0.5 0.12 290)' },
    { key: 'Material Received', color: 'oklch(0.48 0.09 235)' },
    { key: 'Ready to Dispatch', color: 'oklch(0.5 0.1 220)' },
    { key: 'Invoiced', color: 'oklch(0.52 0.10 155)' },
    { key: 'Payment Pending', color: 'oklch(0.7 0.13 70)' },
    { key: 'On Hold', color: 'oklch(0.6 0.1 40)' },
  ];
  const counts = stages.map(s => ({ ...s, n: orders.filter(o => o.status === s.key).length }));
  const max = Math.max(1, ...counts.map(c => c.n));
  return (
    <div className="stack" style={{ gap: 5 }}>
      {counts.map(c => (
        <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 30px', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
          <span className="muted">{c.key}</span>
          <div style={{ height: 8, background: 'var(--bg-subtle)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(c.n / max) * 100}%`, height: '100%', background: c.color, transition: 'width 0.3s' }}/>
          </div>
          <span className="mono num right" style={{ fontSize: 11 }}>{c.n}</span>
        </div>
      ))}
    </div>
  );
}

function AgeingBars({ orders }) {
  const buckets = [
    { label: '0–30 days', max: 30 },
    { label: '31–60 days', max: 60 },
    { label: '61–90 days', max: 90 },
    { label: '90+ days', max: 9999 },
  ];
  const computed = buckets.map((b, i) => {
    const prev = i === 0 ? -9999 : buckets[i-1].max;
    const items = orders.filter(o => {
      const d = o.days_overdue || (o.status === 'Payment Pending' ? 0 : -1);
      return d > prev && d <= b.max;
    });
    return { ...b, total: items.reduce((s, o) => s + (o.invoice_amount || 0), 0), n: items.length };
  });
  const max = Math.max(1, ...computed.map(c => c.total));
  const colors = ['oklch(0.7 0.07 155)', 'oklch(0.7 0.1 80)', 'oklch(0.65 0.13 40)', 'oklch(0.55 0.16 25)'];
  return (
    <div className="stack" style={{ gap: 7 }}>
      {computed.map((c, i) => (
        <div key={c.label} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
          <span className="muted">{c.label}</span>
          <div style={{ height: 10, background: 'var(--bg-subtle)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(c.total / max) * 100}%`, height: '100%', background: colors[i] }}/>
          </div>
          <span className="mono num right" style={{ fontSize: 11 }}>{inrK(c.total)} <span className="muted">· {c.n}</span></span>
        </div>
      ))}
    </div>
  );
}

function ActivityFeed() {
  const items = [
    { t: '09:42', icon: 'package', text: <><strong>Arun B</strong> posted GRN <span className="mono">GRN/FY26/0028</span> for <span className="mono">VPO/FY26/0040</span></> },
    { t: '09:18', icon: 'arrowLeftRight', text: <><strong>Divya S</strong> requested cross-SO transfer · 4 RAM from <span className="mono">SO/0016</span></> },
    { t: '08:55', icon: 'cart', text: <><strong>Pooja N</strong> floated RFQ <span className="mono">RFQ/FY26/0023</span> to 4 vendors</> },
    { t: 'Yest.', icon: 'check', text: <><strong>Mukesh D</strong> approved Vendor PO <span className="mono">VPO/FY26/0041</span></> },
    { t: 'Yest.', icon: 'cash', text: <><strong>Tara P</strong> logged WhatsApp follow-up · Mehta Textiles · 33d overdue</> },
    { t: 'Yest.', icon: 'file', text: <><strong>Sneha R</strong> raised invoice <span className="mono">INV/FY26/0072</span> · ₹1,50,450</> },
  ];
  return (
    <div className="stack" style={{ gap: 0 }}>
      {items.map((it, i) => (
        <div key={i} className="queue-item" style={{ padding: '7px 14px' }}>
          <Icon name={it.icon} size={13} color="var(--text-3)"/>
          <div className="grow" style={{ fontSize: 12 }}>{it.text}</div>
          <span className="mono tiny muted">{it.t}</span>
        </div>
      ))}
    </div>
  );
}

window.Dashboard = Dashboard;
