// OP Central — Dashboard screens (role-aware)

// Real per-SO metrics (no dummy data) — sell, vendor spend, profit margin,
// vendors and lifecycle progress, all computed from app state.
function soMetrics(state, so, soSubtotal) {
  const sell = soSubtotal(so);
  const pos = state.vendor_pos.filter(p => p.so_id === so.id);
  const vendorSpend = pos.reduce((s, p) => s + (p.amount || 0), 0);
  const margin = sell - vendorSpend;
  const vendorIds = [...new Set(pos.map(p => p.vendor_id))];
  // Use the admin-configured workflow stages when present; fall back to the
  // canonical lifecycle (and per-SO fall back if a status isn't in the custom list).
  const cfgStages = (state.config && Array.isArray(state.config.workflow_stages) && state.config.workflow_stages.length) ? state.config.workflow_stages : SO_LIFECYCLE;
  let stages = cfgStages, idx = stages.indexOf(so.status);
  if (idx < 0) { stages = SO_LIFECYCLE; idx = stages.indexOf(so.status); }
  const progress = idx >= 0 ? Math.round((idx / (stages.length - 1)) * 100) : 0;

  // Materials: required (BOM components + implementation BOQ) vs in-hand
  // (GRN-accepted + committed pool stock) — mirrors the Virtual Godown / SO detail.
  const req = {};
  (so.lines || []).forEach(l => (l.components || []).forEach(c => { req[c.product_id] = (req[c.product_id] || 0) + (Number(c.qty) || 0) * (Number(l.bundle_qty) || 1); }));
  const implReq = window.soImplReq ? window.soImplReq(so) : {};
  Object.keys(implReq).forEach(pid => { req[pid] = (req[pid] || 0) + implReq[pid]; });
  const poIds = new Set(pos.map(p => p.id));
  const recv = {};
  (state.grns || []).forEach(g => { if (poIds.has(g.po_id)) (g.items || []).forEach(it => { recv[it.product_id] = (recv[it.product_id] || 0) + (Number(it.accepted) || 0); }); });
  (so.pool_alloc || []).forEach(a => { recv[a.product_id] = (recv[a.product_id] || 0) + (Number(a.qty) || 0); });
  const reqUnits = Object.values(req).reduce((a, b) => a + b, 0);
  const recvUnits = Object.keys(req).reduce((a, pid) => a + Math.min(recv[pid] || 0, req[pid]), 0);
  const remainingUnits = Math.max(0, reqUnits - recvUnits);
  const distinctReq = Object.keys(req).length;
  const distinctDone = Object.keys(req).filter(pid => (recv[pid] || 0) >= req[pid]).length;

  // Client invoicing raised so far (partials + final), vs the SO value.
  const invoices = so.invoices || [];
  const invoicedAmt = invoices.length ? invoices.reduce((s, i) => s + (Number(i.total) || 0), 0) : (Number(so.invoice_amount) || 0);

  return {
    sell, vendorSpend, margin, marginPct: sell > 0 ? (margin / sell) * 100 : 0, vendorIds, pos, progress,
    reqUnits, recvUnits, remainingUnits, distinctReq, distinctDone, invoicedAmt, invoiceCount: invoices.length,
  };
}

// SVG donut / circle chart — data: [{label, value, color}]
function DonutChart({ data, size = 168, thickness = 24, centerLabel = 'Total' }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: '0 0 auto' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-subtle)" strokeWidth={thickness}/>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.filter(d => d.value > 0).map((d, i) => {
            const len = (d.value / total) * circ;
            const seg = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={thickness} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-off} strokeLinecap="butt"/>;
            off += len;
            return seg;
          })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 26, fontWeight: 700, fill: 'var(--text)' }}>{total}</text>
        <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 10, fill: 'var(--text-muted)' }}>{centerLabel}</text>
      </svg>
      <div className="stack" style={{ gap: 6, minWidth: 120 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flex: '0 0 auto' }}/>
            <span className="muted" style={{ flex: 1, whiteSpace: 'nowrap' }}>{d.label}</span>
            <span className="mono" style={{ fontWeight: 600 }}>{d.value}</span>
            <span className="muted tiny">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Vertical "standing" column chart — data: [{label, value, color}]
function ColumnChart({ data, height = 180, fmt }) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const plot = height - 38;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, padding: '4px 2px 0' }}>
      {data.map((d, i) => {
        const h = Math.max(3, (Math.abs(d.value) / max) * plot);
        return (
          <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 5, height: '100%' }}>
            <span className="tiny mono" style={{ color: d.color || 'var(--accent)', fontWeight: 600 }}>{fmt ? fmt(d.value) : d.value}</span>
            <div title={`${d.label}: ${d.value}`} style={{ width: '64%', maxWidth: 40, height: h, background: d.color || 'var(--accent)', borderRadius: '4px 4px 0 0', transition: 'height .3s' }}/>
            <span className="tiny muted" style={{ maxWidth: '100%', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
          </div>
        );
      })}
      {data.length === 0 && <div className="empty" style={{ margin: 'auto' }}>No data</div>}
    </div>
  );
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

// Persist each card's stretched size + the board scroll across navigation. These
// are module-level so they survive unmount/remount within the SPA session (hash
// routing → no page reload), so the browser Back button returns you to the board
// exactly as you left it — same stretched cards, same scroll.
const cardSizes = {};   // { [so.id]: { w, h } } — only for cards stretched taller than default
let boardScroll = 0;

// One SO card. Restores its saved size on mount, remembers it on resize, and makes
// every section clickable to the relevant detail page.
function SOCard({ so, m, cust, navigate, getUser, getVendor, getCategory, getProduct }) {
  const mColor = m.margin >= 0 ? 'var(--success)' : 'var(--danger)';
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const saved = cardSizes[so.id];
    if (saved) { el.style.width = saved.w + 'px'; el.style.height = saved.h + 'px'; }
    const ro = new ResizeObserver(() => {
      if (el.offsetHeight > 165) cardSizes[so.id] = { w: el.offsetWidth, h: el.offsetHeight };
      else delete cardSizes[so.id];   // collapsed back to default → forget it
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [so.id]);
  const go = (r) => (e) => { e.stopPropagation(); navigate(r); };
  const impl = so.extra && so.extra.implementation;
  const supervisor = impl ? getUser(impl.supervisor_id) : null;
  const matPct = m.reqUnits > 0 ? Math.round((m.recvUnits / m.reqUnits) * 100) : 0;
  const clk = { cursor: 'pointer' };
  return (
    <div ref={ref} className="so-card" onDoubleClick={() => navigate(`sales-orders/${so.id}`)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...clk }} onClick={go(`sales-orders/${so.id}`)}>{cust ? cust.name : '—'}</div>
          <a className="mono tiny muted" style={clk} onClick={go(`sales-orders/${so.id}`)}>{so.so_no}</a>
        </div>
        <PriorityBadge priority={so.priority}/>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, margin: '8px 0 5px' }}>
        <StatusBadge status={so.status}/>
        <span className="tiny mono muted">{m.progress}%</span>
      </div>
      <div style={{ height: 5, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${m.progress}%`, height: '100%', background: m.progress >= 100 ? 'var(--success)' : 'var(--accent)', transition: 'width .3s' }}/>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 9 }}>
        <div style={{ background: 'var(--bg-subtle)', borderRadius: 5, padding: '5px 8px', ...clk }} onClick={go(`sales-orders/${so.id}`)} title="Open Sales Order">
          <div className="tiny muted">Value</div>
          <div className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{inr(m.sell)}</div>
        </div>
        <div style={{ background: 'var(--bg-subtle)', borderRadius: 5, padding: '5px 8px', ...clk }} onClick={go(`sales-orders/${so.id}`)} title="Open Sales Order">
          <div className="tiny muted">Margin</div>
          <div className="mono" style={{ fontWeight: 600, fontSize: 12.5, color: mColor }}>{m.marginPct >= 0 ? '+' : ''}{m.marginPct.toFixed(1)}%</div>
        </div>
      </div>
      <div className="so-extra" style={{ gridTemplateColumns: 'auto 1fr', rowGap: 4, columnGap: 8, fontSize: 11.5, marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
        <span className="muted">PM</span><span className="right trunc">{getUser(so.pm)?.name || 'Unassigned'}</span>
        <span className="muted">Order type</span><span className="right trunc">{so.order_type || 'Supply'}{impl ? ' + Implementation' : ''}</span>
        {supervisor && <><span className="muted">Supervisor</span><span className="right trunc">{supervisor.name}</span></>}
        <span className="muted">Created</span><span className="mono right">{fmtDate(so.date)}</span>
        <span className="muted">Delivery</span><span className="mono right">{fmtDate(so.expected)}</span>
        <span className="muted">Vendors</span><span className="right trunc">{m.vendorIds.length ? m.vendorIds.map(id => getVendor(id)?.name || id).join(', ') : '—'}</span>
      </div>
      <div className="so-extra-2" style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 4, columnGap: 8, fontSize: 11.5, ...clk }} onClick={go(`sales-orders/${so.id}`)} title="Open Sales Order">
          <span className="muted">Client quotation</span><span className="mono right">{inr(m.sell)}</span>
          <span className="muted">Vendor cost</span><span className="mono right">{inr(m.vendorSpend)}</span>
          <span className="muted" style={{ fontWeight: 600 }}>Our profit</span><span className="mono right" style={{ color: mColor, fontWeight: 600 }}>{inr(m.margin)} · {m.marginPct >= 0 ? '+' : ''}{m.marginPct.toFixed(1)}%</span>
          <span className="muted">Billed to client</span><span className="mono right">{inr(m.invoicedAmt)}{m.invoiceCount ? <span className="tiny muted"> ({m.invoiceCount})</span> : ''}</span>
        </div>
        <div style={{ marginTop: 9, ...clk }} onClick={go(`godown/${so.id}`)} title="Open Virtual Godown">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
            <span className="muted">Material received</span>
            <span className="mono">{m.recvUnits}/{m.reqUnits} units · {m.remainingUnits} left</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden', marginTop: 3 }}>
            <div style={{ width: `${matPct}%`, height: '100%', background: matPct >= 100 ? 'var(--success)' : 'var(--accent)' }}/>
          </div>
          <div className="tiny muted" style={{ marginTop: 2 }}>{m.distinctDone}/{m.distinctReq} item(s) fully in hand</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="tiny muted" style={{ marginBottom: 5, fontWeight: 600 }}>Vendor POs ({m.pos.length})</div>
          {m.pos.length === 0 && <div className="tiny muted">No POs raised yet.</div>}
          {m.pos.slice(0, 10).map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11, padding: '2px 0' }}>
              <a className="trunc" style={clk} onClick={go(`vendor-pos/${p.id}`)}>{getVendor(p.vendor_id)?.name || p.vendor_id}</a>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto' }}>
                <StatusBadge status={p.status}/>
                <span className="mono">{inr(p.amount || 0)}</span>
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="tiny muted" style={{ marginBottom: 5, fontWeight: 600 }}>Invoices ({(so.invoices || []).length})</div>
          {(so.invoices || []).length === 0 && <div className="tiny muted">None raised yet.</div>}
          {(so.invoices || []).map(inv => (
            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11, padding: '2px 0' }}>
              <a className="trunc mono" style={{ cursor: 'pointer', color: (inv.consolidated || inv.type === 'Final') ? 'var(--success)' : 'var(--accent)' }} onClick={go(`invoices/${so.id}/${inv.id}`)}>{inv.no}</a>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto' }}>
                <span className="tiny muted">{inv.consolidated ? 'Final' : (inv.type || 'Partial')}</span>
                <span className="mono">{inr(inv.total || 0)}</span>
              </span>
            </div>
          ))}
          {(so.invoices || []).length === 0 && so.status !== 'Draft' && (
            <a className="tiny" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={go(`invoices/${so.id}`)}>Open invoicing →</a>
          )}
        </div>
      </div>
      <div className="so-extra-3" style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)', ...clk }} onClick={go(`sales-orders/${so.id}`)} title="Open Sales Order">
        <div className="tiny muted" style={{ marginBottom: 5, fontWeight: 600 }}>Bill of materials · {(so.lines || []).length} line(s)</div>
        {(so.lines || []).map(l => {
          const cat = getCategory(l.category_id) || { name: l.category_id };
          return (
            <div key={l.id} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 500, gap: 8 }}>
                <span className="trunc">{cat.name} <span className="tiny muted">×{l.bundle_qty}</span></span>
                <span className="mono" style={{ flex: '0 0 auto' }}>{inr((Number(l.bundle_qty) || 0) * (Number(l.unit_price) || 0))}</span>
              </div>
              {(l.components || []).map(c => {
                const p = getProduct(c.product_id);
                return (
                  <div key={c.product_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', paddingLeft: 8, gap: 8 }}>
                    <span className="trunc">{p ? p.name : c.product_id}</span>
                    <span className="mono" style={{ flex: '0 0 auto' }}>×{(Number(c.qty) || 0) * (Number(l.bundle_qty) || 1)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {(so.lines || []).length === 0 && <div className="tiny muted">No line items.</div>}
      </div>
    </div>
  );
}

// ===== View 1 — Excel-like board of resizable SO cards =====
function SOBoardDashboard() {
  const { state, navigate, soSubtotal, getCustomer, getUser, getVendor, getCategory, getProduct } = useStore();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [priority, setPriority] = React.useState('');
  const [pmF, setPmF] = React.useState('');
  const [sort, setSort] = React.useState('date');
  const [dir, setDir] = React.useState('desc');
  const [page, setPage] = React.useState(0);
  const PER = 48;

  // Restore the board scroll on return (Back button) and remember it while scrolling.
  React.useEffect(() => {
    const main = document.querySelector('.main');
    if (!main) return;
    const raf = requestAnimationFrame(() => { if (boardScroll) main.scrollTop = boardScroll; });
    const onScroll = () => { boardScroll = main.scrollTop; };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); main.removeEventListener('scroll', onScroll); };
  }, []);

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
      <div className="card"><div className="card-body" style={{ padding: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, alignItems: 'center', width: '100%' }}>
          <div style={{ flex: '2 1 130px', minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 9, color: 'var(--text-muted)', display: 'flex', pointerEvents: 'none' }}><Icon name="search" size={14}/></span>
            <input className="input" placeholder="Search SO, customer, PO…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} style={{ width: '100%', minWidth: 0, height: 30, fontSize: 12.5, paddingLeft: 28 }}/>
          </div>
          {[
            { v: status, set: setStatus, opts: [['', 'All statuses'], ...statuses.map(s => [s, s])] },
            { v: priority, set: setPriority, opts: [['', 'All priorities'], ['Standard', 'Standard'], ['Urgent', 'Urgent'], ['Critical', 'Critical']] },
            { v: pmF, set: setPmF, opts: [['', 'All PMs'], ...pms.map(id => [id, getUser(id)?.name || id])] },
            { v: sort, set: setSort, reset: false, opts: [['date', 'Sort: Created'], ['expected', 'Sort: Delivery'], ['value', 'Sort: Value'], ['margin', 'Sort: Margin %'], ['so', 'Sort: SO No']] },
          ].map((f, i) => (
            <select key={i} className="select" value={f.v} onChange={e => { f.set(e.target.value); if (f.reset !== false) setPage(0); }}
              style={{ flex: '1 1 60px', minWidth: 0, height: 30, fontSize: 12, padding: '0 22px 0 8px' }}>
              {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <button className="btn btn-sm" title={dir === 'asc' ? 'Ascending' : 'Descending'} onClick={() => setDir(d => d === 'asc' ? 'desc' : 'asc')} style={{ flex: '0 0 auto', height: 30, padding: '0 11px', fontSize: 13, lineHeight: 1 }}>{dir === 'asc' ? '↑' : '↓'}</button>
        </div>
        <div className="tiny muted" style={{ marginTop: 7 }}>{rows.length} SO(s) · drag a card's bottom-right corner to expand for more detail</div>
      </div></div>

      <style>{`
        .so-card { container-type: size; container-name: socard; flex: 0 0 auto; width: calc(25% - 9px); min-width: 200px; height: 152px; min-height: 120px; max-width: 100%; resize: both; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); padding: 11px; cursor: default; transition: border-color .15s, box-shadow .15s; scrollbar-width: thin; scrollbar-color: #e8e8e8 transparent; }
        .so-card::-webkit-scrollbar { width: 3px; height: 3px; }
        .so-card::-webkit-scrollbar-track { background: transparent; }
        .so-card::-webkit-scrollbar-thumb { background: #ececec; border-radius: 10px; }
        .so-card::-webkit-scrollbar-thumb:hover { background: #dcdcdc; }
        .so-card:hover { border-color: var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,.05); }
        .so-card .so-extra, .so-card .so-extra-2, .so-card .so-extra-3 { display: none; }
        @container socard (min-height: 232px) { .so-card .so-extra { display: grid; } }
        @container socard (min-height: 320px) { .so-card .so-extra-2 { display: block; } }
        @container socard (min-height: 450px) { .so-card .so-extra-3 { display: block; } }
      `}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {slice.map(({ so, m, cust }) => (
          <SOCard key={so.id} so={so} m={m} cust={cust} navigate={navigate} getUser={getUser} getVendor={getVendor} getCategory={getCategory} getProduct={getProduct}/>
        ))}
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

  // Circle chart — SO count by priority
  const prioColor = { Critical: 'var(--danger)', Urgent: 'var(--warning)', Standard: 'var(--accent)' };
  const donutData = prioCounts.map(c => ({ label: c.p, value: c.n, color: prioColor[c.p] }));

  // Standing chart — new SOs by creation month
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const byMonth = {};
  state.sales_orders.forEach(s => { const k = (s.date || '').slice(0, 7); if (k) byMonth[k] = (byMonth[k] || 0) + 1; });
  const monthData = Object.keys(byMonth).sort().slice(-8).map(k => ({ label: `${MN[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}`, value: byMonth[k], color: 'var(--accent)' }));

  return (
    <div className="stack">
      <div className="kpi-grid mb-1">
        <div className="kpi"><div className="kpi-label">Sales Orders</div><div className="kpi-value">{state.sales_orders.length}</div><div className="kpi-delta"><span>{open.length} open</span></div></div>
        <div className="kpi"><div className="kpi-label">Pipeline value</div><div className="kpi-value">{inrK(totalSell)}</div><div className="kpi-delta"><span>sum of SO value</span></div></div>
        <div className="kpi"><div className="kpi-label">Total profit margin</div><div className="kpi-value" style={{ color: totalMargin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{inrK(totalMargin)}</div><div className="kpi-delta"><span>sell − vendor spend</span></div></div>
        <div className="kpi"><div className="kpi-label">Blended margin %</div><div className="kpi-value">{blendedPct.toFixed(1)}%</div><div className="kpi-delta"><span>real, current</span></div></div>
      </div>

      <div className="split-2">
        <div className="card"><div className="card-header"><h3 className="card-title">Priority mix</h3><span className="card-sub">share of all SOs</span></div><div className="card-body"><DonutChart data={donutData} centerLabel="SOs"/></div></div>
        <div className="card"><div className="card-header"><h3 className="card-title">New SOs by month</h3><span className="card-sub">by creation date</span></div><div className="card-body"><ColumnChart data={monthData}/></div></div>
      </div>

      <div className="card"><div className="card-header"><h3 className="card-title">Status funnel</h3><span className="card-sub">all SOs across the pipeline</span></div><div className="card-body"><FunnelChart orders={state.sales_orders}/></div></div>

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
  // LPP variance alerts driven by the admin-configured threshold (Customisation → Virtual Godown rules).
  const lppThreshold = state.config && state.config.lpp_threshold != null ? state.config.lpp_threshold : 10;
  const lppAlerts = (state.rfqs || []).reduce((n, r) => n + (r.quotes || []).filter(q => Math.abs(Number(q.lpp_variance) || 0) > lppThreshold).length, 0);

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
      { label: 'LPP Variance Alerts', value: lppAlerts, sub: `Above ${lppThreshold}% threshold` },
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
