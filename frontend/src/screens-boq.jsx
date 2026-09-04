// ============================================================================
// BOQ — Billing Order Quantity
// ============================================================================
// The BOM says what the order CONTAINS. A BOQ says what gets BILLED TOGETHER.
//
// Purchase carve the bill of materials into billing groups — tick some lines, a
// whole group, or a mix — and each group becomes BOQ 001, BOQ 002, and so on.
// One order has as many as it needs.
//
// A BOQ bills when it is COMPLETE, never before:
//
//   BOQ 001 holds 10 items · all 10 dispatched  -> partial invoice raised
//   BOQ 001 holds 10 items ·  7 dispatched      -> nothing, it waits
//
// That is the whole point of the thing. Billing per delivery challan invoices
// whatever happened to be on the lorry; billing per BOQ invoices what the
// customer agreed to be billed for, whenever the last piece of it goes out.
//
// Two rules make the arithmetic safe:
//
//   AN ITEM BELONGS TO AT MOST ONE BOQ. Otherwise the same goods are billed
//   twice. What is already committed elsewhere is subtracted from what a new
//   BOQ may claim, and the screen shows the remainder live.
//
//   DISPATCHES ARE ALLOCATED IN BOQ ORDER. A dispatch is per item, not per BOQ,
//   so 6 units of an item shared by BOQ 001 (needs 5) and BOQ 002 (needs 3)
//   fill 001 completely and 002 by one. First created, first satisfied —
//   deterministic, and it never leaves a BOQ complete by accident.
// ============================================================================

// Every (line, component) pair on the order, with its full required quantity.
// Keyed by line AND product, so the same item in two bundles stays two rows and
// can be billed in two different BOQs.
function boqOrderRows(so) {
  const rows = [];
  ((so && so.lines) || []).forEach((l, li) => {
    const sets = Number(l.bundle_qty) || 1;
    const ref = l.customer_ref || {};
    ((l.components) || []).forEach((c, ci) => {
      const need = (Number(c.qty) || 0) * sets;
      if (need <= 0) return;
      rows.push({
        key: (l.id || li) + '|' + c.product_id,
        line_id: l.id || String(li),
        product_id: c.product_id,
        groupKey: ref.po_sr ? ('po:' + ref.po_sr) : (ref.equip || l.client_name || ('line:' + (l.id || li))),
        groupLabel: ref.po_sr
          ? `PO Sr ${ref.po_sr}${ref.group ? ' · ' + String(ref.group).replace(/^Group\s*/i, 'Group ') : ''}`
          : (ref.equip || l.client_name || `Line ${li + 1}`),
        qty: need,
        sell: (typeof compSellOf === 'function') ? compSellOf(c, null) : (Number(c.sell) || 0),
        customer_ref: c.customer_ref || null,
      });
    });
  });
  return rows;
}

const soBoqs = (so) => ((so && so.extra && so.extra.boqs) || []);

// How much of each (line, product) is already committed to a BOQ.
// `exceptId` lets the edit case ignore its own claim.
function boqCommitted(so, exceptId) {
  const used = {};
  soBoqs(so).forEach(b => {
    if (b.id === exceptId || b.status === 'Cancelled') return;
    (b.items || []).forEach(it => {
      const k = it.line_id + '|' + it.product_id;
      used[k] = (used[k] || 0) + (Number(it.qty) || 0);
    });
  });
  return used;
}

// What a new BOQ may still claim, per row. This is what the create screen shows,
// and it is recomputed on every tick so the numbers can never drift from what
// will actually be saved.
function boqAvailable(so, exceptId) {
  const used = boqCommitted(so, exceptId);
  return boqOrderRows(so).map(r => {
    const taken = used[r.key] || 0;
    return { ...r, taken, available: Math.max(0, r.qty - taken) };
  });
}

// Dispatched quantity per (line, product).
//
// A delivery challan records the ITEM, not the order line it came from, so a
// product spanning two lines has one dispatched figure to share out. It is
// allocated across that product's rows in order, which is the same rule used
// for BOQs themselves.
function boqDispatched(state, so) {
  const perProduct = {};
  ((state && state.outward_dispatches) || []).forEach(d => {
    if (d.so_id !== so.id || d.status === 'Cancelled') return;
    (d.items || []).forEach(it => {
      perProduct[it.product_id] = (perProduct[it.product_id] || 0) + (Number(it.qty) || 0);
    });
  });
  return perProduct;
}

// Per BOQ: what it needs, what has reached it, and whether it is complete.
//
// BOQs are walked oldest first and each takes what it needs from the dispatched
// pool before the next one sees any. That is what stops a later BOQ being
// closed by goods that belong to an earlier one.
function boqProgress(state, so) {
  const pool = boqDispatched(state, so);
  const remaining = { ...pool };
  return soBoqs(so).map(b => {
    let need = 0, got = 0;
    const items = (b.items || []).map(it => {
      const want = Number(it.qty) || 0;
      const take = Math.min(want, Math.max(0, remaining[it.product_id] || 0));
      remaining[it.product_id] = (remaining[it.product_id] || 0) - take;
      need += want; got += take;
      return { ...it, need: want, dispatched: take, short: Math.max(0, want - take) };
    });
    const complete = items.length > 0 && items.every(x => x.short <= 0.0001);
    return {
      ...b, items, need, got,
      complete,
      invoiced: !!b.invoice_no,
      pct: need > 0 ? Math.round((got / need) * 100) : 0,
      readyToInvoice: complete && !b.invoice_no && b.status !== 'Cancelled',
    };
  });
}

// Everything there is to say about one line inside a BOQ: what it is called,
// how much of it the group holds, how much has gone out, what is left, what it
// is worth, and where it stands.
//
// ONE definition. The row total, the expanded detail and the invoice all read
// this, so the figure in the summary can never disagree with the figures that
// add up to it.
//
// Works on a raw BOQ as well as on a boqProgress row — a raw one simply has
// nothing dispatched against it yet.
function boqItemDetail(so, boq, getProduct) {
  return ((boq && boq.items) || []).map(it => {
    const l = ((so && so.lines) || []).find(x => x.id === it.line_id);
    const c = l && (l.components || []).find(x => x.product_id === it.product_id);
    const p = getProduct ? getProduct(it.product_id) : null;
    const need = Number(it.need != null ? it.need : it.qty) || 0;
    const dispatched = Number(it.dispatched) || 0;
    const remaining = Math.max(0, need - dispatched);
    const rate = c ? ((typeof compSellOf === 'function') ? compSellOf(c, p) : (Number(c.sell) || 0)) : 0;
    // Their wording for the item, from the exact order line this BOQ names.
    const ref = (c && c.customer_ref) || {};
    const custLabel = String(ref.desc || ref.code || '').trim();
    return {
      line_id: it.line_id, product_id: it.product_id,
      name: (p && p.name) || it.product_id,
      code: (p && p.code) || '',
      cust_label: custLabel, cust_code: String(ref.code || '').trim(),
      unit: String(ref.unit || (p && p.unit) || '').trim(),
      group: (l && l.customer_ref && l.customer_ref.po_sr)
        ? `PO Sr ${l.customer_ref.po_sr}`
        : ((l && (l.client_name || (l.customer_ref || {}).equip)) || ''),
      need, dispatched, remaining, rate, amount: need * rate,
      priced: rate > 0,
      status: remaining <= 0.0001 ? 'Dispatched'
            : dispatched > 0 ? 'Partly out'
            : 'Pending',
    };
  });
}

// The value of a BOQ, at the order's own per-item prices.
function boqValue(so, boq, getProduct) {
  return boqItemDetail(so, boq, getProduct).reduce((a, d) => a + d.amount, 0);
}

window.boqOrderRows = boqOrderRows;
window.soBoqs = soBoqs;
window.boqCommitted = boqCommitted;
window.boqAvailable = boqAvailable;
window.boqDispatched = boqDispatched;
window.boqProgress = boqProgress;
window.boqItemDetail = boqItemDetail;
window.boqValue = boqValue;

// ===========================================================================
// The BOQ section on a sales order, beside its bill of materials
// ===========================================================================
function BOQPanel({ so }) {
  const { state, mutate, navigate, getProduct, getUser, currentUser } = useStore();
  const toast = useToast();
  const [showNew, setShowNew] = React.useState(false);
  const [open, setOpen] = React.useState({});          // BOQ id -> expanded
  const toggleOpen = (id) => setOpen(o => ({ ...o, [id]: !o[id] }));
  const role = currentUser ? (getUser(currentUser) || {}).role : '';
  const canManage = ['Purchase', 'Project Manager', 'Org Admin', 'Billing'].includes(role);

  const rows = boqProgress(state, so);
  const avail = boqAvailable(so, null);
  const unassigned = avail.reduce((a, r) => a + r.available, 0);
  // Every BOQ has billed, and something outside them has shipped since. The
  // closing invoice is due — normally raised by the dispatch itself, but shown
  // here too so it is never left hanging.
  const sweepDue = !!(window.buildBoqFinalInvoice
    && window.buildBoqFinalInvoice(so, state, currentUser, getUser, getProduct));
  const due = rows.filter(b => b.readyToInvoice);

  const cancel = (b) => {
    if (b.invoice_no) { toast('Already invoiced — a BOQ that has billed cannot be cancelled'); return; }
    mutate(s => ({
      ...s,
      sales_orders: s.sales_orders.map(x => x.id !== so.id ? x : {
        ...x,
        extra: { ...(x.extra || {}), boqs: soBoqs(x).map(z => z.id === b.id ? { ...z, status: 'Cancelled' } : z) },
      }),
    }), { action: 'boq-cancel', entity: 'SalesOrder', entity_id: so.id, detail: `${b.no} cancelled` });
    toast(`${b.no} cancelled · its items are free to bill again`, '');
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Billing groups (BOQ)</h3>
          <div className="tiny muted">
            Each BOQ bills as one invoice, the moment its LAST item is dispatched — never before.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {unassigned > 0
            ? <span className="badge warning dot" title="Units on this order not in any BOQ, so nothing will bill them">{qty(unassigned)} unit(s) not in a BOQ</span>
            : rows.length > 0 && <span className="badge success dot">every unit is in a BOQ</span>}
          {canManage && <button className="btn btn-primary btn-sm" disabled={unassigned <= 0} onClick={() => setShowNew(true)}>
            <Icon name="plus" size={12}/>Create BOQ
          </button>}
        </div>
      </div>

      {showNew && <CreateBOQModal so={so} onClose={() => setShowNew(false)}/>}

      <div className="card-body flush">
        {rows.length === 0 ? (
          <div className="empty">
            No billing groups yet. Create one to decide what gets invoiced together.
          </div>
        ) : (
          <table className="t">
            <thead><tr>
              <th style={{ width: 28 }}></th>
              <th>BOQ</th><th className="num">Items</th><th className="num">Units</th>
              <th style={{ width: 160 }}>Dispatched</th><th className="num">Value</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map(b => {
                const det = boqItemDetail(so, b, getProduct);
                const val = det.reduce((a, d) => a + d.amount, 0);
                const isOpen = !!open[b.id];
                return (
                  <React.Fragment key={b.id}>
                  <tr style={Object.assign({ cursor: 'pointer' },
                        b.status === 'Cancelled' ? { opacity: 0.5 } : null)}
                      onClick={() => toggleOpen(b.id)}>
                    <td title={isOpen ? 'Hide the items' : 'Show every item in this BOQ'}
                        style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13}/>
                    </td>
                    <td>
                      <div className="mono small">{b.no}</div>
                      <div className="tiny muted">{fmtDate(b.date)}{b.label ? ` · ${b.label}` : ''}</div>
                    </td>
                    <td className="num mono small">{(b.items || []).length}</td>
                    <td className="num mono small">{qty(b.got)}/{qty(b.need)}</td>
                    <td>
                      <div style={{ height: 6, background: 'var(--bg-subtle)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: b.pct + '%', height: '100%',
                          background: b.complete ? 'var(--success)' : 'var(--info)' }}/>
                      </div>
                      <div className="tiny muted">{b.pct}%</div>
                    </td>
                    <td className="num mono small">{inr(val)}</td>
                    <td>
                      {b.status === 'Cancelled' ? <span className="badge dot">Cancelled</span>
                        : b.invoiced ? <span className="badge success dot" title={b.invoice_no}>Invoiced</span>
                        : b.complete ? <span className="badge accent dot">Ready — billing</span>
                        : <span className="badge warning dot">{qty(b.need - b.got)} still to dispatch</span>}
                      {b.invoice_no && <div className="tiny muted mono">{b.invoice_no}</div>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}
                        onClick={e => e.stopPropagation()}>
                      {b.invoice_no
                        ? <button className="btn btn-sm" onClick={() => navigate(`invoices/${so.id}`)}>Invoice</button>
                        : canManage && b.status !== 'Cancelled'
                          && <button className="btn btn-sm" onClick={() => cancel(b)}>Cancel</button>}
                    </td>
                  </tr>

                  {/* Every item in this BOQ, and exactly where each one stands.
                      Derived from the live state on every render, so a dispatch
                      posted anywhere moves these figures with it. */}
                  {isOpen && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--bg-subtle)', padding: '8px 12px 12px' }}>
                        {det.length === 0 ? (
                          <div className="tiny muted">This BOQ has no items.</div>
                        ) : (
                          <>
                            <div className="tiny muted mb-1">
                              {det.length} item(s) in <strong className="mono">{b.no}</strong>
                              {b.label ? ' \u00b7 ' + b.label : ''}
                              {' \u2014 '}{qty(b.got)} of {qty(b.need)} unit(s) dispatched.
                              {b.status === 'Cancelled'
                                ? ' This BOQ is cancelled, so it will not bill.'
                                : b.invoiced
                                  ? ' Billed on ' + b.invoice_no + '.'
                                  : b.complete
                                    ? ' All of it is out, so its invoice is due.'
                                    : ' It bills once the last ' + qty(b.need - b.got) + ' unit(s) go out.'}
                            </div>
                            <table className="t">
                              <thead><tr>
                                <th style={{ width: 26 }}>#</th>
                                <th>Item</th>
                                <th className="num" style={{ width: 66 }}>Qty</th>
                                <th className="num" style={{ width: 82 }}>Dispatched</th>
                                <th className="num" style={{ width: 78 }}>Remaining</th>
                                <th className="num" style={{ width: 92 }}>Rate</th>
                                <th className="num" style={{ width: 104 }}>Amount</th>
                                <th style={{ width: 110 }}>Status</th>
                              </tr></thead>
                              <tbody>
                                {det.map((d, i) => (
                                  <tr key={d.line_id + '|' + d.product_id + '|' + i}>
                                    <td className="tiny muted">{i + 1}</td>
                                    <td>
                                      <div className="small trunc" style={{ maxWidth: 380 }}>
                                        {d.cust_label || d.name}
                                      </div>
                                      <div className="tiny muted trunc" style={{ maxWidth: 380 }}>
                                        {d.cust_label ? d.name : ''}
                                        {d.code ? (d.cust_label ? ' \u00b7 ' : '') + d.code : ''}
                                        {d.group ? ' \u00b7 ' + d.group : ''}
                                      </div>
                                    </td>
                                    <td className="num mono small">
                                      {qty(d.need)}
                                      {d.unit ? <span className="tiny muted"> {d.unit}</span> : null}
                                    </td>
                                    <td className="num mono small"
                                        style={d.dispatched > 0 ? { color: 'var(--success)' } : null}>
                                      {d.dispatched > 0 ? qty(d.dispatched) : '\u2014'}
                                    </td>
                                    <td className="num mono small"
                                        style={d.remaining > 0 ? { fontWeight: 600 } : { color: 'var(--text-muted)' }}>
                                      {d.remaining > 0 ? qty(d.remaining) : '\u2014'}
                                    </td>
                                    <td className="num mono small">
                                      {d.priced ? inr(d.rate)
                                        : <span className="tiny" style={{ color: 'var(--warning)' }}>not priced</span>}
                                    </td>
                                    <td className="num mono small">{d.priced ? inr(d.amount) : '\u2014'}</td>
                                    <td>
                                      {b.status === 'Cancelled' ? <span className="badge dot">Cancelled</span>
                                        : b.invoiced ? <span className="badge success dot">Invoiced</span>
                                        : d.status === 'Dispatched' ? <span className="badge success dot">Dispatched</span>
                                        : d.status === 'Partly out' ? <span className="badge info dot">Partly out</span>
                                        : <span className="badge warning dot">Pending</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot><tr>
                                <td></td>
                                <td className="small" style={{ fontWeight: 600 }}>Total</td>
                                <td className="num mono small" style={{ fontWeight: 600 }}>{qty(b.need)}</td>
                                <td className="num mono small" style={{ fontWeight: 600 }}>{qty(b.got)}</td>
                                <td className="num mono small" style={{ fontWeight: 600 }}>{qty(b.need - b.got)}</td>
                                <td></td>
                                <td className="num mono small" style={{ fontWeight: 600 }}>{inr(val)}</td>
                                <td></td>
                              </tr></tfoot>
                            </table>
                            {det.some(d => !d.priced) && (
                              <div className="tiny mt-1" style={{ color: 'var(--warning)' }}>
                                <Icon name="alert" size={11}/>{' '}
                                {det.filter(d => !d.priced).length} item(s) have no client price yet, so this BOQ
                                is worth {inr(val)} so far. Set the price per unit in the Bill of Materials
                                above \u2014 the invoice bills what is priced there.
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(due.length > 0 || sweepDue) && (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="tiny" style={{ color: 'var(--success)' }}>
            <Icon name="check" size={12}/>{' '}
            {due.length > 0
              ? `${due.length} BOQ(s) complete`
              : 'every BOQ has billed, and dispatched items remain outside them'}
            {' — the invoice is raised automatically on the next dispatch, or press '}
            <strong>{due.length > 0 ? 'Bill ready BOQs' : 'Raise final invoice'}</strong> below.
          </div>
          <div className="mt-1">
            <button className="btn btn-sm btn-primary" onClick={() => {
              const made = window.invoiceReadyBoqs
                ? window.invoiceReadyBoqs(so.id, { state, mutate, currentUser, getUser, getProduct }) : [];
              toast(made.length
                ? `${made.length} invoice(s) raised · ${made.map(m => m.invoice.no).join(', ')}`
                : 'Nothing ready to bill', made.length ? 'success' : '');
            }}>{due.length > 0 ? 'Bill ready BOQs' : 'Raise final invoice'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
window.BOQPanel = BOQPanel;

// ===========================================================================
// Create a BOQ
// ===========================================================================
// The common case is "bill this whole group", so that is one click. Ticking a
// group heading takes every remaining unit in it; a line can then be adjusted or
// dropped. Everything recalculates as you go, and the dialog will not let you
// claim a unit another BOQ already holds.
function CreateBOQModal({ so, onClose }) {
  const { state, mutate, getProduct, currentUser } = useStore();
  const toast = useToast();
  const rows = boqAvailable(so, null).filter(r => r.available > 0);
  const [sel, setSel] = React.useState({});          // key -> units claimed
  const [label, setLabel] = React.useState('');
  const [q, setQ] = React.useState('');

  const visible = rows.filter(r => {
    if (!q.trim()) return true;
    const p = getProduct(r.product_id) || {};
    return `${p.name || ''} ${p.code || ''} ${r.groupLabel}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const groups = [];
  const byGroup = {};
  visible.forEach(r => {
    if (!byGroup[r.groupKey]) { byGroup[r.groupKey] = { key: r.groupKey, label: r.groupLabel, rows: [] }; groups.push(byGroup[r.groupKey]); }
    byGroup[r.groupKey].rows.push(r);
  });

  const claim = (r) => (sel[r.key] != null ? Number(sel[r.key]) : 0);
  const setClaim = (r, v) => setSel(s => {
    const n = { ...s };
    const val = Math.max(0, Math.min(Number(v) || 0, r.available));
    if (val <= 0) delete n[r.key]; else n[r.key] = val;
    return n;
  });
  const toggle = (r) => setSel(s => {
    const n = { ...s };
    if (n[r.key] != null) delete n[r.key]; else n[r.key] = r.available;
    return n;
  });
  const toggleGroup = (g) => {
    const all = g.rows.every(r => sel[r.key] != null);
    setSel(s => {
      const n = { ...s };
      g.rows.forEach(r => { if (all) delete n[r.key]; else n[r.key] = r.available; });
      return n;
    });
  };
  const takeAll = () => setSel(Object.fromEntries(rows.map(r => [r.key, r.available])));

  const chosen = rows.filter(r => claim(r) > 0);
  const units = chosen.reduce((a, r) => a + claim(r), 0);
  const value = chosen.reduce((a, r) => {
    const l = (so.lines || []).find(x => x.id === r.line_id);
    const c = l && (l.components || []).find(x => x.product_id === r.product_id);
    const price = c ? compSellOf(c, getProduct(r.product_id)) : 0;
    return a + claim(r) * price;
  }, 0);

  const create = () => {
    if (!chosen.length) { toast('Tick what this BOQ should bill'); return; }
    const no = boqNo(state, TODAY);
    const boq = {
      id: 'boq-' + Date.now(),
      no, label: label.trim(), date: TODAY, status: 'Open',
      created_by: currentUser || null,
      items: chosen.map(r => ({ line_id: r.line_id, product_id: r.product_id, qty: claim(r) })),
    };
    mutate(s => ({
      ...s,
      sales_orders: s.sales_orders.map(x => x.id !== so.id ? x : {
        ...x, extra: { ...(x.extra || {}), boqs: [...soBoqs(x), boq] },
      }),
      notifications: [{
        id: 'n-boq-' + Date.now(), kind: 'so',
        text: `${no} created on ${so.so_no} · ${chosen.length} item(s) · ${inr(value)} — bills when all of it is dispatched`,
        date: TODAY, read: false, role: 'Billing',
      }, ...s.notifications],
    }), { action: 'boq-create', entity: 'SalesOrder', entity_id: so.id,
          detail: `${no} · ${chosen.length} item(s) · ${qty(units)} unit(s) · ${inr(value)}` });
    toast(`${no} created · ${chosen.length} item(s) · ${inr(value)}`, 'success');
    onClose();
  };

  return (
    <Modal title={`New billing group — ${so.so_no}`} size="xl" onClose={onClose} footer={
      <>
        <span className="tiny muted" style={{ marginRight: 'auto' }}>
          {chosen.length} item(s) · {qty(units)} unit(s) · <strong>{inr(value)}</strong>
          {value === 0 && chosen.length > 0 && <span style={{ color: 'var(--warning)' }}> · nothing priced yet</span>}
        </span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!chosen.length} onClick={create}>
          <Icon name="check" size={13}/>Create BOQ
        </button>
      </>
    }>
      {rows.length === 0 ? (
        <div className="empty">Every unit on this order is already in a BOQ.</div>
      ) : (
        <>
          <div className="field-row mb-2">
            <div className="field">
              <label className="field-label">Name <span className="tiny muted">(optional)</span></label>
              <input className="input" value={label} onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Phase 1 — core switches"/>
            </div>
            <div className="field">
              <label className="field-label">Filter</label>
              <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Find an item…"/>
            </div>
          </div>

          <div className="card mb-2"><div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px' }}>
            <button className="btn btn-sm" onClick={takeAll}>Everything still unbilled</button>
            <button className="btn btn-sm" onClick={() => setSel({})}>Clear</button>
            <span className="tiny muted">or tick a group heading to take all of it</span>
          </div></div>

          <div className="card">
            <div className="card-body flush" style={{ maxHeight: '48vh', overflow: 'auto' }}>
              <table className="t">
                <thead><tr>
                  <th style={{ width: 30 }}></th>
                  <th>Item</th>
                  <th className="num" style={{ width: 70 }}>On order</th>
                  <th className="num" style={{ width: 82 }}>In other BOQs</th>
                  <th className="num" style={{ width: 70 }}>Free</th>
                  <th className="num" style={{ width: 92 }}>Bill now</th>
                </tr></thead>
                <tbody>
                  {groups.map(g => {
                    const gAll = g.rows.every(r => sel[r.key] != null);
                    const gFree = g.rows.reduce((a, r) => a + r.available, 0);
                    const gTake = g.rows.reduce((a, r) => a + claim(r), 0);
                    return (
                      <React.Fragment key={g.key}>
                        <tr style={{ background: 'var(--bg-subtle)' }}>
                          <td><input type="checkbox" checked={gAll} onChange={() => toggleGroup(g)}/></td>
                          <td className="small" style={{ fontWeight: 600 }}>
                            {g.label}
                            <span className="tiny muted" style={{ fontWeight: 400 }}> · {g.rows.length} item(s)</span>
                          </td>
                          <td></td><td></td>
                          <td className="num tiny muted">{qty(gFree)}</td>
                          <td className="num small" style={{ fontWeight: 600 }}>{gTake > 0 ? qty(gTake) : '—'}</td>
                        </tr>
                        {g.rows.map(r => {
                          const p = getProduct(r.product_id) || {};
                          const on = sel[r.key] != null;
                          return (
                            <tr key={r.key}>
                              <td><input type="checkbox" checked={on} onChange={() => toggle(r)}/></td>
                              <td>
                                <div className="small trunc" style={{ maxWidth: 340 }}>{p.name || r.product_id}</div>
                                <div className="tiny muted mono">{p.code || ''}</div>
                              </td>
                              <td className="num mono small muted">{qty(r.qty)}</td>
                              <td className="num mono small muted">{r.taken > 0 ? qty(r.taken) : '—'}</td>
                              <td className="num mono small"><strong>{qty(r.available)}</strong></td>
                              <td className="num">
                                <input className="input num" type="number" min="0" max={r.available}
                                  value={on ? sel[r.key] : ''} placeholder="—"
                                  onChange={e => setClaim(r, e.target.value)}
                                  style={{ height: 26, width: '100%', textAlign: 'right' }}/>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="tiny muted mt-2">
            Only what is <strong>free</strong> can be claimed — units another BOQ already holds are
            excluded, so nothing is billed twice. This BOQ raises its invoice automatically once
            every unit in it has been dispatched.
          </div>
        </>
      )}
    </Modal>
  );
}
window.CreateBOQModal = CreateBOQModal;
