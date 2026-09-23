// ============================================================================
// SCM — end-to-end in/out tracking, outward dispatch, and item-name mapping
// ============================================================================
// Built for the procurement-only flow:
//   SO (customer names) -> our BOQ -> vendor PO (vendor part no.) -> in transit
//   -> GRN (Stores) -> Purchase accepts -> VG -> OUT FOR DELIVERY -> customer
//
// Everything here is quantity-wise, so one line can legitimately show
// "received 10" AND "dispatched 5" at the same time.
// ============================================================================

// ---------------------------------------------------------------------------
// The single source of truth for movement maths. Every screen uses this so the
// numbers can never disagree between views.
// ---------------------------------------------------------------------------
function scmLineTotals(state, so) {
  if (!so) return [];
  const required = {};
  (so.lines || []).forEach(l => (l.components || []).forEach(c => {
    const q = (Number(c.qty) || 0) * (Number(l.bundle_qty) || 1);
    required[c.product_id] = (required[c.product_id] || 0) + q;
  }));
  const implReq = window.soImplReq ? window.soImplReq(so) : {};
  Object.keys(implReq).forEach(pid => { required[pid] = (required[pid] || 0) + implReq[pid]; });

  const pos = (state.vendor_pos || []).filter(p => p.so_id === so.id &&
    !['Rejected', 'Cancelled'].includes(p.status));
  const onPO = {};
  pos.forEach(p => (p.items || []).forEach(it => {
    onPO[it.product_id] = (onPO[it.product_id] || 0) + (Number(it.qty) || 0);
  }));

  // What has physically LEFT the vendor, from the PO's in-transit record.
  // Without this, "in transit" can only be inferred as (ordered - received),
  // which wrongly counts material the vendor has not even shipped yet. With an
  // LR recorded we know the real split, so the two are reported separately.
  const shippedMap = {};
  pos.forEach(p => {
    const di = p.dispatch_info || {};
    if (!di.lr_no && !di.carrier && !di.shipped_on) return;      // nothing recorded
    const list = Array.isArray(di.items) && di.items.length ? di.items : (p.items || []);
    list.forEach(it => {
      shippedMap[it.product_id] = (shippedMap[it.product_id] || 0) + (Number(it.qty) || 0);
    });
  });
  const trackShipments = typeof wfOn === 'function' ? wfOn('intransit_tracking') : false;

  const poIds = new Set(pos.map(p => p.id));
  const received = {};
  (state.grns || []).forEach(g => { if (poIds.has(g.po_id)) (g.items || []).forEach(it => {
    received[it.product_id] = (received[it.product_id] || 0) + (Number(it.accepted) || 0);
  }); });
  (so.pool_alloc || []).forEach(a => {
    received[a.product_id] = (received[a.product_id] || 0) + (Number(a.qty) || 0);
  });

  const dispatched = {};
  (state.outward_dispatches || []).filter(d => d.so_id === so.id && d.status !== 'Cancelled')
    .forEach(d => (d.items || []).forEach(it => {
      dispatched[it.product_id] = (dispatched[it.product_id] || 0) + (Number(it.qty) || 0);
    }));

  const pooledOut = window.soPoolOut ? window.soPoolOut(so) : {};

  const pids = Array.from(new Set([].concat(
    Object.keys(required), Object.keys(onPO), Object.keys(received), Object.keys(dispatched))));

  return pids.map(pid => {
    const req = required[pid] || 0;
    const po = onPO[pid] || 0;
    const rec = received[pid] || 0;
    const disp = dispatched[pid] || 0;
    const out = pooledOut[pid] || 0;
    const inVG = Math.max(0, rec - disp - out);
    // With shipment tracking on, in-transit is what was actually shipped and has
    // not arrived. Without it, fall back to the historic (ordered - received).
    const shipped = shippedMap[pid] || 0;
    const transit = trackShipments
      ? Math.max(0, Math.min(shipped, po) - rec)
      : Math.max(0, po - rec);
    return {
      product_id: pid,
      required: req,
      onPO: po,
      onOrder: Math.max(0, po - rec - transit),   // ordered, not yet shipped
      shipped,
      inTransit: transit,
      received: rec,
      inVG,
      dispatched: disp,
      pending: Math.max(0, req - rec),
      toDispatch: Math.max(0, req - disp),
      done: req > 0 && disp >= req,
    };
  });
}
window.scmLineTotals = scmLineTotals;

function scmStatusChips(r) {
  const chips = [];
  if (r.received > 0) chips.push(<span key="r" className="badge success tiny" style={{ marginRight: 4 }}>Received {r.received}</span>);
  if (r.inTransit > 0) chips.push(<span key="t" className="badge tiny" style={{ marginRight: 4 }}>In transit {r.inTransit}</span>);
  if (r.dispatched > 0) chips.push(<span key="d" className="badge info tiny" style={{ marginRight: 4 }}>Out for delivery {r.dispatched}</span>);
  if (r.onOrder > 0) chips.push(<span key="o" className="badge tiny" style={{ marginRight: 4 }} title="On a vendor PO, not dispatched by the vendor yet">On order {r.onOrder}</span>);
  if (r.pending > 0 && r.received === 0 && r.inTransit === 0 && !r.onOrder) chips.push(<span key="p" className="badge warning tiny" style={{ marginRight: 4 }}>Pending {r.pending}</span>);
  if (!chips.length) chips.push(<span key="n" className="tiny muted">—</span>);
  return chips;
}

// ===========================================================================
// Ready to dispatch — the outward twin of PendingReceiptsPanel (screens-
// godown.jsx). Receiving already lands a role on a queue of exactly what
// needs action; dispatch only ever had a per-SO drilldown with a plain
// dropdown defaulting to whichever order happened to load first — nothing
// told a dispatcher WHICH order actually had stock sitting in the VG. A
// role that only dispatches (never opens Sales Orders to go hunting) could
// open SCM Tracking, land on an unrelated/closed order, and reasonably
// conclude there was no way to dispatch anything at all.
//
// Scoped to `role === 'Stores Out'` specifically — the explicit dispatch-
// only role a split-stores organization creates for this — rather than
// canDispatch's broader SCM_ROLES list. Purchase/Stores/Org Admin/Managing
// Director already had a working path to "Out for delivery" on every
// organization before this existed, so leaving them exactly as they were
// (no new panel on their screen) means this changes nothing for any
// organization that does not use the Stores Out role, including Microlink
// (procurement_only, no Stores Out user, no permissions override at all).
function ReadyToDispatchPanel({ role, onDispatch }) {
  const { state, getCustomer, getProduct } = useStore();
  if (role !== 'Stores Out') return null;

  const ready = [];
  (state.sales_orders || []).filter(so => so.status !== 'Cancelled').forEach(so => {
    const rows = scmLineTotals(state, so).filter(r => r.inVG > 0);
    if (rows.length) ready.push({ so, rows });
  });
  if (!ready.length) return null;

  return (
    <div className="card mb-2" style={{ borderColor: 'var(--info)' }}>
      <div className="card-header">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="package" size={14} color="var(--info)"/>
          Ready to dispatch
          <span className="badge info dot">{ready.length}</span>
        </div>
        <div className="tiny muted">In the Virtual Godown, waiting to go out — pick items and quantity on the next screen</div>
      </div>
      <div className="card-body flush">
        <table className="t">
          <thead><tr><th>Sales order</th><th>Customer</th><th>Items in stock</th><th className="num">Units</th><th></th></tr></thead>
          <tbody>
            {ready.map(({ so, rows }) => {
              const cust = getCustomer(so.customer_id);
              const units = rows.reduce((a, r) => a + r.inVG, 0);
              return (
                <tr key={so.id}>
                  <td className="mono small">{so.so_no}</td>
                  <td className="small">{cust ? cust.name : '—'}</td>
                  <td className="small" style={{ maxWidth: 380 }}>
                    {rows.map(r => `${qty(r.inVG)}× ${(getProduct(r.product_id) || {}).name || r.product_id}`).join(', ')}
                  </td>
                  <td className="num mono">{units}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-primary" onClick={() => onDispatch(so)}>
                      <Icon name="package" size={12}/>Dispatch</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
window.ReadyToDispatchPanel = ReadyToDispatchPanel;

// ===========================================================================
// SCM Tracking — the whole cycle for one SO, quantity by quantity
// ===========================================================================
function SCMTracking({ soId: soIdFromRoute } = {}) {
  const { state, navigate, getProduct, getCustomer, getSO, getUser, currentUser } = useStore();
  // A link into a specific order (e.g. "View Sales Order" on a converted
  // client request, for a role that cannot open the SO detail page itself)
  // pre-selects it here instead of always defaulting to the first order.
  const [soId, setSoId] = React.useState(soIdFromRoute || '');
  const [q, setQ] = React.useState('');
  const [showDispatch, setShowDispatch] = React.useState(false);
  const [viewDC, setViewDC] = React.useState(null);

  // Picking up goods and shipping them is a WRITE, not a read of the tracker —
  // it needs its own gate, separate from who may simply open this screen.
  // SCM_ROLES stays exactly as it always has (Purchase/Stores/Org
  // Admin/Managing Director keep the access they already had, on every
  // organization, unaffected by any per-org customisation); dispatch:true is
  // the explicit door for a role like Stores Out that is not in that list.
  // Without this, ANY role that can merely open SCM Tracking — including one
  // deliberately given no operational authority, like Client Facing on a
  // split-stores organization — could physically ship inventory.
  const role = currentUser ? (getUser(currentUser) || {}).role : '';
  const canDispatch = role === 'Org Admin' || (window.SCM_ROLES && window.SCM_ROLES.includes(role))
    || (typeof canDo === 'function' && canDo(role, 'dispatch'));

  const orders = (state.sales_orders || []).filter(s => s.status !== 'Cancelled');
  const so = soId ? getSO(soId) : (orders[0] || null);
  React.useEffect(() => { if (!soId && orders[0]) setSoId(orders[0].id); }, [orders.length]);

  const rows = so ? scmLineTotals(state, so) : [];
  const filtered = rows.filter(r => {
    if (!q.trim()) return true;
    const p = getProduct(r.product_id) || {};
    return `${p.name || ''} ${p.code || ''} ${r.product_id}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const tot = rows.reduce((a, r) => ({
    required: a.required + r.required, onPO: a.onPO + r.onPO, onOrder: a.onOrder + (r.onOrder || 0),
    inTransit: a.inTransit + r.inTransit,
    received: a.received + r.received, inVG: a.inVG + r.inVG,
    dispatched: a.dispatched + r.dispatched, pending: a.pending + r.pending,
  }), { required: 0, onPO: 0, onOrder: 0, inTransit: 0, received: 0, inVG: 0, dispatched: 0, pending: 0 });

  const dcs = (state.outward_dispatches || []).filter(d => so && d.so_id === so.id);
  const cust = so ? getCustomer(so.customer_id) : null;
  const pct = tot.required > 0 ? Math.round((tot.dispatched / tot.required) * 100) : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">SCM Tracking</h1>
          <div className="page-sub">Ordered → on PO → in transit → received → in stock → out for delivery · every number is a quantity</div>
        </div>
        <div className="page-actions">
          <select className="select" value={so ? so.id : ''} onChange={e => setSoId(e.target.value)} style={{ minWidth: 220 }}>
            {orders.map(o => <option key={o.id} value={o.id}>{o.so_no} · {(getCustomer(o.customer_id) || {}).name || ''}</option>)}
          </select>
          {so && canDispatch && <button className="btn btn-primary" onClick={() => setShowDispatch(true)}><Icon name="package" size={13}/>Out for delivery</button>}
        </div>
      </div>

      <ReadyToDispatchPanel role={role} onDispatch={pick => { setSoId(pick.id); setShowDispatch(true); }}/>

      {!so ? <div className="card"><div className="empty">No orders yet.</div></div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[
              ['Ordered', tot.required, ''],
              ['On PO', tot.onPO, ''],
              ['In transit', tot.inTransit, 'var(--text-2)'],
              ...(wfOn('intransit_tracking') ? [['Not shipped yet', tot.onOrder, tot.onOrder ? 'var(--warning)' : '']] : []),
              ['Received', tot.received, 'var(--success)'],
              ['In stock (VG)', tot.inVG, 'var(--accent)'],
              ['Dispatched', tot.dispatched, 'var(--info)'],
              ['Pending', tot.pending, tot.pending ? 'var(--warning)' : ''],
            ].map(([label, val, color]) => (
              <div key={label} className="card"><div className="card-body" style={{ textAlign: 'center', padding: '10px 8px' }}>
                <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
                <div className="mono" style={{ fontSize: 19, fontWeight: 700, color: color || 'inherit' }}>{val}</div>
              </div></div>
            ))}
          </div>

          <div className="card mb-2"><div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div className="small"><strong>{so.so_no}</strong> · {cust ? cust.name : '—'}</div>
              <div className="tiny muted">{dcs.length} dispatch note(s) issued</div>
            </div>
            <div style={{ flex: 1, height: 6, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? 'var(--success)' : 'var(--info)' }}/>
            </div>
            <span className="mono small">{pct}% delivered</span>
            <input className="input" placeholder="Filter items…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 180, height: 28 }}/>
          </div></div>

          {/* Self-gated on wfOn('client_acceptance') — renders null for every
              organization that has not turned it on. Mounted here (not only on
              the SO detail page) so a role whose nav is SCM Tracking + Item
              Requests and nothing else — Client Facing on a split-stores org —
              can still reach the one screen where they decide anything. See
              docs/client-acceptance.md. */}
          {window.ClientReviewPanel && <div className="mb-2"><ClientReviewPanel so={so}/></div>}

          <div className="card">
            <div className="card-body flush">
              <table className="t">
                <thead><tr>
                  <th>Item</th>
                  <th className="num">Ordered</th><th className="num">On PO</th><th className="num">In transit</th>
                  <th className="num">Received</th><th className="num">In stock</th><th className="num">Dispatched</th>
                  <th className="num">Pending</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {filtered.map(r => {
                    const p = getProduct(r.product_id) || { name: r.product_id, code: '' };
                    return (
                      <tr key={r.product_id} style={r.done ? { background: 'var(--success-bg)' } : null}>
                        <td><div className="small">{p.name}</div><div className="tiny muted mono">{p.code || r.product_id}</div></td>
                        <td className="num mono">{qty(r.required)}</td>
                        <td className="num mono">{qty(r.onPO)}</td>
                        <td className="num mono">{r.inTransit || '—'}</td>
                        <td className="num mono" style={{ color: r.received ? 'var(--success)' : '' }}>{r.received || '—'}</td>
                        <td className="num mono"><strong>{r.inVG || '—'}</strong></td>
                        <td className="num mono" style={{ color: r.dispatched ? 'var(--info)' : '' }}>{r.dispatched || '—'}</td>
                        <td className="num mono" style={{ color: r.pending ? 'var(--warning)' : '' }}>{r.pending || '—'}</td>
                        <td>{scmStatusChips(r)}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><td colSpan="9"><div className="empty">No items.</div></td></tr>}
                </tbody>
                <tfoot><tr>
                  <td className="right small">Total</td>
                  <td className="num mono"><strong>{tot.required}</strong></td>
                  <td className="num mono">{tot.onPO}</td>
                  <td className="num mono">{tot.inTransit}</td>
                  <td className="num mono">{tot.received}</td>
                  <td className="num mono"><strong>{tot.inVG}</strong></td>
                  <td className="num mono">{tot.dispatched}</td>
                  <td className="num mono">{tot.pending}</td>
                  <td></td>
                </tr></tfoot>
              </table>
            </div>
          </div>

          {dcs.length > 0 && (
            <div className="card mt-2">
              <div className="card-header"><h3 className="card-title">Delivery notes</h3><span className="card-sub">{dcs.length} issued · click to print</span></div>
              <div className="card-body flush">
                <table className="t">
                  <thead><tr><th>DC No</th><th>Date</th><th>Items</th><th className="num">Units</th><th>Transport</th></tr></thead>
                  <tbody>
                    {dcs.slice().reverse().map(d => (
                      <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setViewDC(d)}>
                        <td className="mono small"><a>{d.dc_no}</a></td>
                        <td className="mono small">{fmtDate(d.date)}</td>
                        <td className="small trunc">{(d.items || []).map(i => `${qty(i.qty)}× ${(wfOn('customer_language') && (i.cust_name || i.cust_code)) || i.name}`).join(', ')}</td>
                        <td className="num">{(d.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0)}</td>
                        <td className="tiny muted">{(d.transport || {}).mode || '—'}{(d.transport || {}).lr ? ' · LR ' + d.transport.lr : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showDispatch && so && <OutwardDispatchModal so={so} onClose={() => setShowDispatch(false)}/>}
      {viewDC && <CustomerChallanModal dc={viewDC} onClose={() => setViewDC(null)}/>}
    </div>
  );
}

// ===========================================================================
// Out for delivery — tick lines + quantity, straight out of the VG
// ===========================================================================
function OutwardDispatchModal({ so, onClose }) {
  const { state, mutate, getProduct, getCustomer, getUser, currentUser } = useStore();
  const toast = useToast();
  // The customer's own wording for these items, so the challan they receive
  // reads in THEIR language. Captured onto the challan at dispatch time rather
  // than looked up when printing: a delivery note is a historical document and
  // must not silently change if the mapping is edited next month.
  const custAliases = useAliasMap('customer', so.customer_id);
  const rows = scmLineTotals(state, so).filter(r => r.inVG > 0);
  const [sel, setSel] = React.useState({});
  const [tr, setTr] = React.useState({ mode: 'Road', vehicle: '', lr: '', carrier: '', tracking: '', contact: '', notes: '' });
  const [busy, setBusy] = React.useState(false);

  const toggle = (r) => setSel(s => { const n = { ...s }; if (n[r.product_id] != null) delete n[r.product_id]; else n[r.product_id] = r.inVG; return n; });
  const setQty = (r, v) => setSel(s => ({ ...s, [r.product_id]: Math.max(0, Math.min(Number(v) || 0, r.inVG)) }));
  const picked = rows.filter(r => sel[r.product_id] > 0);
  const units = picked.reduce((a, r) => a + sel[r.product_id], 0);

  const submit = () => {
    if (!picked.length) { toast('Tick at least one item and set a quantity'); return; }
    setBusy(true);
    const dc = {
      id: 'dc-' + Date.now(),
      so_id: so.id,
      dc_no: challanNo(state, TODAY),
      date: TODAY,
      items: picked.map(r => {
        const p = getProduct(r.product_id) || {};
        const a = custAliases[r.product_id] || {};
        return { product_id: r.product_id, name: p.name || r.product_id, code: p.code || '',
                 cust_name: a.name || '', cust_code: a.code || '', qty: sel[r.product_id] };
      }),
      transport: { ...tr },
      status: 'Dispatched',
      created_by: currentUser,
    };
    mutate(s => ({
      ...s,
      outward_dispatches: [...(s.outward_dispatches || []), dc],
      notifications: [{ id: 'n-out-' + Date.now(), kind: 'so', text: `${so.so_no}: ${units} unit(s) dispatched to customer · ${dc.dc_no}`, date: TODAY, read: false, role: 'Stores' }, ...s.notifications],
    }), { action: 'dispatch-out', entity: 'SalesOrder', entity_id: so.id, user_id: currentUser,
          detail: `${units} unit(s) out for delivery · ${dc.dc_no} · ${dc.items.map(i => `${qty(i.qty)}× ${i.name}`).join(', ')}` });
    // Bill what actually went out. Only where the workflow asks for it — the
    // standard profile still invoices on receipt and is untouched.
    //
    // Deliberately AFTER the challan is committed: if invoicing fails or there
    // is nothing to bill, the dispatch still stands. Goods left the building
    // either way, and that fact must not depend on the paperwork.
    // If the order has billing groups, THEY decide what is invoiced — a BOQ
    // bills only when its last item is out. An order with no BOQ falls back to
    // billing the challan itself, which is what it did before BOQs existed.
    let inv = null;
    let boqInvoices = [];
    const hasBoqs = (window.soBoqs ? window.soBoqs(so) : []).filter(b => b.status !== 'Cancelled').length > 0;
    if (wfOn('invoice_on_dispatch') && hasBoqs && window.invoiceReadyBoqs) {
      boqInvoices = window.invoiceReadyBoqs(so.id, { state, mutate, currentUser, getUser, getProduct }) || [];
    } else if (wfOn('invoice_on_dispatch') && window.raiseDispatchInvoice) {
      inv = window.raiseDispatchInvoice(so.id, dc, { mutate, currentUser, getUser, getProduct });
    }
    setBusy(false);
    if (boqInvoices.length) {
      toast(`${dc.dc_no} created · ${units} unit(s) out · ${boqInvoices.length} BOQ invoice(s): ${boqInvoices.map(b => b.invoice.no).join(', ')}`, 'success');
      onClose();
      return;
    }
    if (hasBoqs) {
      const pending = (window.boqProgress ? window.boqProgress(state, so) : [])
        .filter(b => !b.invoiced && b.status !== 'Cancelled' && !b.complete).length;
      toast(`${dc.dc_no} created · ${units} unit(s) out` +
        (pending ? ` · ${pending} BOQ(s) not complete yet, so nothing billed` : ''), 'success');
      onClose();
      return;
    }
    if (inv) {
      toast(`${dc.dc_no} created · ${units} unit(s) out · invoice ${inv.invoice.no} raised for ${inr(inv.invoice.total)}`, 'success');
    } else if (wfOn('invoice_on_dispatch')) {
      // Say WHY there is no invoice rather than leaving them to wonder.
      const priced = (so.lines || []).some(l => (l.components || []).some(c => {
        const p = getProduct(c.product_id);
        return (window.compSellOf ? window.compSellOf(c, p) : 0) > 0;
      }));
      toast(priced
        ? `${dc.dc_no} created · ${units} unit(s) out · nothing left to invoice on this order`
        : `${dc.dc_no} created · ${units} unit(s) out · no invoice: these items have no price yet (Edit line items)`,
        priced ? 'success' : '');
    } else {
      toast(`${dc.dc_no} created · ${units} unit(s) out for delivery`, 'success');
    }
    onClose();
  };

  return (
    <Modal title={`Out for delivery — ${so.so_no}`} size="lg" onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || !picked.length} onClick={submit}>
        <Icon name="package" size={13}/>{busy ? 'Creating…' : `Dispatch ${units} unit(s)`}</button></>}>
      <div className="tiny muted mb-2">Only stock actually in the Virtual Godown can go out. Quantities are capped at what is in hand, so you can dispatch partially and come back for the rest.</div>
      {rows.length === 0 ? <div className="empty">Nothing in stock to dispatch yet.</div> : (
        <div className="card"><div className="card-body flush">
          <table className="t">
            <thead><tr><th style={{ width: 30 }}></th><th>Item</th><th className="num">In stock</th><th className="num">Already sent</th><th className="num">Send now</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const p = getProduct(r.product_id) || { name: r.product_id, code: '' };
                const on = sel[r.product_id] != null;
                return (
                  <tr key={r.product_id}>
                    <td><input type="checkbox" checked={on} onChange={() => toggle(r)}/></td>
                    <td><div className="small">{p.name}</div><div className="tiny muted mono">{p.code}</div></td>
                    <td className="num"><strong>{qty(r.inVG)}</strong></td>
                    <td className="num mono muted">{r.dispatched || '—'}</td>
                    <td className="num"><input type="number" min="0" max={r.inVG} className="input mono" disabled={!on}
                      value={on ? sel[r.product_id] : ''} onChange={e => setQty(r, e.target.value)}
                      style={{ width: 70, height: 26, textAlign: 'right' }}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      )}
      <div className="field-row-3 mt-2">
        <div className="field"><label className="field-label">Transport mode</label>
          <select className="select" value={tr.mode} onChange={e => setTr({ ...tr, mode: e.target.value })}>
            <option>Road</option><option>Courier</option><option>Rail</option><option>Air</option><option>Hand delivery</option><option>Customer pickup</option>
          </select></div>
        <div className="field"><label className="field-label">Vehicle no.</label>
          <input className="input mono" value={tr.vehicle} onChange={e => setTr({ ...tr, vehicle: e.target.value })} placeholder="MH-04-AB-1234"/></div>
        <div className="field"><label className="field-label">LR / docket</label>
          <input className="input mono" value={tr.lr} onChange={e => setTr({ ...tr, lr: e.target.value })}/></div>
      </div>
      <div className="field-row-3 mt-2">
        <div className="field"><label className="field-label">Carrier</label>
          <input className="input" value={tr.carrier} onChange={e => setTr({ ...tr, carrier: e.target.value })} placeholder="BlueDart, self…"/></div>
        <div className="field"><label className="field-label">Tracking link / AWB</label>
          <input className="input" value={tr.tracking} onChange={e => setTr({ ...tr, tracking: e.target.value })} placeholder="https://… or AWB"/></div>
        <div className="field"><label className="field-label">Driver / contact</label>
          <input className="input mono" value={tr.contact} onChange={e => setTr({ ...tr, contact: e.target.value })} placeholder="+91 …"/></div>
      </div>
      <div className="field mt-2"><label className="field-label">Notes</label>
        <textarea className="textarea" rows="2" value={tr.notes} onChange={e => setTr({ ...tr, notes: e.target.value })}/></div>
    </Modal>
  );
}

// ===========================================================================
// Printable customer delivery challan
// ===========================================================================
function CustomerChallanModal({ dc, onClose }) {
  const { state, getSO, getCustomer, getUser } = useStore();
  const so = getSO(dc.so_id);
  const cust = so ? getCustomer(so.customer_id) : null;
  const org = state.org || {};
  const by = getUser(dc.created_by);
  const t = dc.transport || {};
  const units = (dc.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);

  const printIt = () => {
    const esc = (x) => String(x == null ? '' : x).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // Print in the customer's wording when the org works that way and a mapping
    // was captured on this challan; otherwise print ours. Our own code is always
    // shown underneath so the storekeeper can still find the item.
    const useCust = wfOn('customer_language');
    const rows = (dc.items || []).map((i, n) => {
      const head = (useCust && (i.cust_name || i.cust_code)) ? (i.cust_name || i.cust_code) : i.name;
      const sub = [];
      if (useCust && i.cust_code && i.cust_code !== head) sub.push(esc(i.cust_code));
      if (i.code) sub.push(esc(i.code));
      if (useCust && (i.cust_name || i.cust_code) && i.name && i.name !== head) sub.push(esc(i.name));
      return `<tr><td>${n + 1}</td><td>${esc(head)}${sub.length ? `<div class="mut mono">${sub.join(' · ')}</div>` : ''}</td><td class="r mono">${esc(i.qty)}</td></tr>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(dc.dc_no)}</title><style>
      *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a;margin:0;padding:26px;font-size:12.5px}
      .paper{max-width:720px;margin:0 auto;border:1px solid #e2e2e2;border-radius:10px;padding:24px}
      .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:10px}
      h1{font-size:16px;margin:0}.mut{color:#777}.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
      .title{font-size:14px;font-weight:800;letter-spacing:.07em;text-align:right}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:14px 0}
      .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#888}
      table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #eee;font-size:12px}
      th{background:#fafafa;font-size:10px;text-transform:uppercase;color:#666}.r{text-align:right}
      .sign{display:flex;justify-content:space-between;margin-top:36px}.sign div{width:45%;border-top:1px solid #bbb;padding-top:6px;font-size:11px;color:#555}
      .foot{margin-top:16px;font-size:10.5px;color:#999;text-align:center}
      @media print{body{padding:0}.paper{border:none}}
    </style></head><body><div class="paper">
      <div class="top"><div><h1>${esc(org.name || 'Organisation')}</h1><div class="mut">${esc(org.address || '')}</div>
        <div class="mono mut">GSTIN: ${esc(org.gstin || '—')}</div></div>
        <div><div class="title">DELIVERY CHALLAN</div><div class="mono">${esc(dc.dc_no)}</div><div class="mut">${esc(fmtDate(dc.date))}</div></div></div>
      <div class="grid">
        <div><div class="lbl">Deliver to</div><div><strong>${esc(cust ? cust.name : '—')}</strong></div>
          <div class="mut">${esc((cust && (cust.address || cust.city)) || '')}</div></div>
        <div><div class="lbl">Against order</div><div class="mono">${esc(so ? so.so_no : '')}</div>
          <div class="lbl" style="margin-top:8px">Total units</div><div class="mono">${units}</div></div>
      </div>
      <div class="grid">
        <div><div class="lbl">Transport</div><div>${esc(t.mode || '—')}${t.carrier ? ' · ' + esc(t.carrier) : ''}</div></div>
        <div><div class="lbl">Vehicle / LR</div><div class="mono">${esc(t.vehicle || '—')}${t.lr ? ' · ' + esc(t.lr) : ''}</div></div>
      </div>
      <table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th></tr></thead><tbody>${rows}</tbody></table>
      ${t.notes ? `<p class="mut" style="margin-top:10px">${esc(t.notes)}</p>` : ''}
      <div class="sign"><div>Dispatched by${by ? ' — ' + esc(by.name) : ''}</div><div>Received by (customer)</div></div>
      <div class="foot">Goods delivered against the order above — not a tax invoice.</div>
    </div><script>window.onload=function(){setTimeout(function(){window.print()},200)}</script></body></html>`;
    const w = window.open('', '_blank', 'width=820,height=920');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  };

  // A plain-text summary for WhatsApp/email — neither can carry the printable
  // HTML without a file host, so this is the next best thing: everything the
  // customer needs to recognise the delivery, in one message, one tap.
  const shareText = () => {
    const lines = (dc.items || []).map(i => `• ${i.qty}× ${i.name}`).join('\n');
    return `Delivery Challan ${dc.dc_no}\n`
      + `Against order: ${so ? so.so_no : '—'}\n`
      + `Date: ${fmtDate(dc.date)}\n\n${lines}\n\n`
      + `${t.mode ? 'Transport: ' + t.mode + (t.carrier ? ' · ' + t.carrier : '') + '\n' : ''}`
      + `— ${org.name || ''}`;
  };
  const whatsappHref = () => {
    const digits = String((cust && cust.phone) || '').replace(/\D/g, '');
    const to = digits.length === 10 ? '91' + digits : digits.length > 10 ? digits : '';
    return `https://wa.me/${to}?text=${encodeURIComponent(shareText())}`;
  };
  const mailHref = () => `mailto:?subject=${encodeURIComponent('Delivery Challan ' + dc.dc_no)}&body=${encodeURIComponent(shareText())}`;

  return (
    <Modal title={`Delivery Challan — ${dc.dc_no}`} size="lg" onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>Close</button>
      <a className="btn" href={mailHref()} title="Open your email app with the details pre-filled">
        <Icon name="mail" size={13}/>Email</a>
      <a className="btn" href={whatsappHref()} target="_blank" rel="noopener noreferrer"
        title={cust && cust.phone ? `Open WhatsApp to ${cust.phone}` : 'Open WhatsApp — pick who to send it to'}>
        <Icon name="msg" size={13}/>WhatsApp</a>
      <button className="btn btn-primary" onClick={printIt}><Icon name="print" size={13}/>Print / Download PDF</button></>}>
      <div className="doc-paper" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid var(--border-strong)', paddingBottom: 10 }}>
          <div><h2 style={{ margin: 0, fontSize: 16 }}>{org.name}</h2><div className="small muted">{org.address}</div>
            <div className="small mono">GSTIN: {org.gstin}</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '.07em' }}>DELIVERY CHALLAN</div>
            <div className="small mono">{dc.dc_no}</div><div className="tiny muted">{fmtDate(dc.date)}</div></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, margin: '12px 0' }}>
          <div><div className="tiny muted" style={{ textTransform: 'uppercase' }}>Deliver to</div>
            <div className="small"><strong>{cust ? cust.name : '—'}</strong></div></div>
          <div><div className="tiny muted" style={{ textTransform: 'uppercase' }}>Against order</div>
            <div className="small mono">{so ? so.so_no : ''}</div></div>
          <div><div className="tiny muted" style={{ textTransform: 'uppercase' }}>Transport</div>
            <div className="small">{t.mode || '—'}{t.carrier ? ' · ' + t.carrier : ''}</div></div>
          <div><div className="tiny muted" style={{ textTransform: 'uppercase' }}>Vehicle / LR</div>
            <div className="small mono">{t.vehicle || '—'}{t.lr ? ' · ' + t.lr : ''}</div></div>
        </div>
        <table style={{ width: '100%', fontSize: 12 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>#</th><th style={{ textAlign: 'left' }}>Description</th><th className="num">Qty</th></tr></thead>
          <tbody>{(dc.items || []).map((i, n) => (
            <tr key={n}><td>{n + 1}</td><td>{i.name}{i.code ? <div className="tiny muted mono">{i.code}</div> : null}</td><td className="num mono">{i.qty}</td></tr>
          ))}</tbody>
        </table>
        <div className="tiny muted" style={{ marginTop: 14, textAlign: 'center' }}>Goods delivered against the order above — not a tax invoice.</div>
      </div>
    </Modal>
  );
}

window.SCMTracking = SCMTracking;
window.OutwardDispatchModal = OutwardDispatchModal;
window.CustomerChallanModal = CustomerChallanModal;
