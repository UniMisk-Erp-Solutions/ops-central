// OP Central — Pre-SO Sourcing: inquiry → item-based vendor comparison →
// customer-sell ⟷ vendor-buy margin match → convert to a real Sales Order.
//
// This is the costing stage that runs BEFORE a binding Sales Order. Sales floats
// an inquiry (desired bundles/components); Purchase picks the best vendor per
// item (suggested by price, shown as a benefit %); the system computes the
// margin; Sales then converts the inquiry into a Sales Order in one click.

// ---- helpers ---------------------------------------------------------------

// Aggregate an inquiry's components across all lines into true required qty
// (bundle_qty × component qty), keyed by product.
function srcComponentList(src) {
  const m = {};
  (src.lines || []).forEach(l => (l.components || []).forEach(c => {
    m[c.product_id] = (m[c.product_id] || 0) + (c.qty || 0) * (l.bundle_qty || 1);
  }));
  return Object.entries(m).map(([product_id, qty]) => ({ product_id, qty }));
}

// Customer-sell total of an inquiry (what we'd quote the customer).
function srcSellTotal(src) {
  return (src.lines || []).reduce((s, l) => s + (l.bundle_qty || 0) * (l.unit_price || 0), 0);
}

// Stable 0..1 hash so each (vendor, product) pair gets a consistent quote price
// without persisting a full price catalogue.
function _hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

// Deterministic per-vendor unit price for a product, spread around our baseline
// buy cost. Some vendors come in cheaper (good margin), some pricier.
function vendorUnitPrice(vendorId, product) {
  const base = product ? (product.buy || 0) : 0;
  if (!base) return 0;
  const r = _hash01(vendorId + '|' + (product.id || ''));
  const factor = 0.86 + r * 0.26;           // 0.86 .. 1.12
  return Math.round(base * factor / 10) * 10;
}

// Ranked vendor suggestions for a single item: cheapest first, with a benefit %
// measured against our baseline cost (positive = cheaper than baseline = better).
function vendorSuggestions(product, vendors) {
  return vendors.map(v => {
    const price = vendorUnitPrice(v.id, product);
    const base = product.buy || 0;
    const benefitPct = base ? ((base - price) / base) * 100 : 0;
    return { vendor: v, price, benefitPct };
  }).sort((a, b) => a.price - b.price);
}

// Compute the full margin match for an inquiry given the chosen vendor per item.
// Candidate vendors for a sourcing: the shortlist Purchase added (quote_vendors)
// if any, else all vendors (estimated comparison).
function srcVendorIds(src, allVendors) {
  const qv = (src && src.quote_vendors) || [];
  return qv.length ? qv : allVendors.map(v => v.id);
}
// Unit price for a vendor on a product: the quote Purchase entered if present,
// else the deterministic estimate.
function srcUnitPrice(src, vid, product) {
  const pr = (src && src.prices) ? src.prices[product.id] : null;
  if (pr && pr[vid] != null) return pr[vid];
  return vendorUnitPrice(vid, product);
}

// Algorithm 1 — smart price suggestion for a repeat vendor+product from ALL
// history (issued Vendor POs + recorded sourcing quotes), recency-weighted so
// the latest deals dominate. Returns { price, n, last } or null if no history.
// This only SUGGESTS (prefills an editable field) — it never auto-commits.
function suggestVendorPrice(state, vendorId, productId) {
  const pts = [];
  (state.vendor_pos || []).forEach(po => {
    if (po.vendor_id !== vendorId) return;
    (po.items || []).forEach(it => { if (it.product_id === productId && Number(it.rate) > 0) pts.push({ price: Number(it.rate), date: po.date || '' }); });
  });
  (state.sourcings || []).forEach(s => {
    const pr = (s.prices || {})[productId];
    if (pr && pr[vendorId] != null && Number(pr[vendorId]) > 0) pts.push({ price: Number(pr[vendorId]), date: s.date || '' });
  });
  if (!pts.length) return null;
  pts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));     // newest first
  let wsum = 0, w = 0;
  pts.forEach((p, i) => { const weight = Math.pow(0.6, i); wsum += p.price * weight; w += weight; });   // exp recency decay
  return { price: Math.round(wsum / w), n: pts.length, last: pts[0].price };
}

function computeMargin(src, picks, getProduct) {
  const comps = srcComponentList(src);
  const alloc = src.alloc || {};
  const perItem = comps.map(c => {
    const p = getProduct(c.product_id) || { id: c.product_id, name: c.product_id, buy: 0 };
    const rows = (alloc[c.product_id] || []).filter(r => (Number(r.qty) || 0) > 0);
    let unit, lineBuy, vendorId;
    if (rows.length) {                       // multi-vendor split allocation
      lineBuy = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
      const tq = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
      unit = tq > 0 ? lineBuy / tq : 0;
      vendorId = rows.length === 1 ? rows[0].vendor_id : '__split';
    } else {                                 // fallback: single chosen vendor
      vendorId = picks[c.product_id];
      unit = vendorId ? srcUnitPrice(src, vendorId, p) : (p.buy || 0);
      lineBuy = unit * c.qty;
    }
    const base = p.buy || 0;
    return {
      product_id: c.product_id, qty: c.qty, vendor_id: vendorId || null,
      unit, lineBuy, baseline: base,
      benefitPct: base ? ((base - unit) / base) * 100 : 0,
    };
  });
  // Budget Purchase optimises against: "our price" if set, else the indicative
  // (line-computed) sell total.
  const indicative = srcSellTotal(src);
  const sell = (src.our_price && Number(src.our_price) > 0) ? Number(src.our_price) : indicative;
  const buy = perItem.reduce((s, i) => s + i.lineBuy, 0);
  const marginAmt = sell - buy;
  const marginPct = sell ? (marginAmt / sell) * 100 : 0;
  return {
    sell, indicative, buy, marginAmt, marginPct, perItem,
    client_req: (src.client_req_price != null && src.client_req_price !== '') ? Number(src.client_req_price) : null,
    our_price: (src.our_price != null && src.our_price !== '') ? Number(src.our_price) : null,
  };
}

function pct1(n) { return (n >= 0 ? '+' : '') + (n || 0).toFixed(1) + '%'; }

// Per-vendor roll-up of a sourcing's multi-vendor allocation.
function srcVendorSummary(src, getProduct) {
  const alloc = src.alloc || {};
  const byV = {};
  Object.entries(alloc).forEach(([pid, rows]) => {
    const p = getProduct(pid); const sell = p ? (p.sell || 0) : 0;
    (rows || []).forEach(r => {
      const qty = Number(r.qty) || 0; if (qty <= 0 || !r.vendor_id) return;
      const v = byV[r.vendor_id] = byV[r.vendor_id] || { vendor_id: r.vendor_id, items: 0, qty: 0, cost: 0, our: 0 };
      v.items += 1; v.qty += qty; v.cost += qty * (Number(r.rate) || 0); v.our += qty * sell;
    });
  });
  return Object.values(byV).map(v => ({ ...v, margin: v.our - v.cost, marginPct: v.our > 0 ? (v.our - v.cost) / v.our * 100 : 0 }));
}
function srcHasAlloc(src) { return Object.values(src.alloc || {}).some(rows => (rows || []).some(r => (Number(r.qty) || 0) > 0)); }

// ---- list ------------------------------------------------------------------

function SourcingList() {
  const { state, navigate, getCustomer, getUser, currentUser, getProduct } = useStore();
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canCreate = ['Sales', 'Pre-sales', 'Org Admin'].includes(role);
  // A Supervisor only sees the inquiries whose implementation is assigned to them.
  const rows = role === 'Supervisor'
    ? (state.sourcings || []).filter(x => x.implementation && x.implementation.supervisor_id === currentUser)
    : (state.sourcings || []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sourcing / Inquiries</h1>
          <div className="page-sub">Pre-SO costing · compare vendors per item, see the margin, then raise the SO</div>
        </div>
        <div className="page-actions">
          {canCreate && <button className="btn btn-primary" onClick={() => navigate('sourcing/new')}><Icon name="plus" size={13}/>New Inquiry</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr>
              <th>Inquiry No</th><th>Customer</th><th>Date</th>
              <th className="num">Sell value</th><th className="num">Margin</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map(src => {
                const cust = getCustomer(src.customer_id);
                const sell = srcSellTotal(src);
                const m = src.margin && src.margin.marginPct !== undefined ? src.margin : null;
                return (
                  <tr key={src.id} onClick={() => navigate(`sourcing/${src.id}`)} style={{ cursor: 'pointer' }}>
                    <td><a className="mono">{src.src_no}</a></td>
                    <td>{cust ? cust.name : '—'}{src.ref && <div className="tiny muted mono">Ref: {src.ref}</div>}</td>
                    <td className="mono small">{fmtDate(src.date)}</td>
                    <td className="num">{inr(sell)}</td>
                    <td className="num">{m ? <span style={{ color: m.marginPct >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{pct1(m.marginPct)}</span> : <span className="muted">—</span>}</td>
                    <td><StatusBadge status={src.status}/></td>
                    <td><Icon name="chevronRight" size={12}/></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan="7"><div className="empty">
                  <div className="empty-title">No inquiries yet</div>
                  Sales floats an inquiry here; Pre-sales compares vendors and returns a margin; then you raise the Sales Order.
                  {canCreate && <div className="mt-2"><button className="btn btn-primary" onClick={() => navigate('sourcing/new')}><Icon name="plus" size={13}/>New Inquiry</button></div>}
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- create inquiry (Sales) ------------------------------------------------

function SourcingNew() {
  const { state, navigate, mutate, getCustomer, getProduct, getCategory, currentUser } = useStore();
  const toast = useToast();
  const [customer, setCustomer] = React.useState('');
  const [ref, setRef] = React.useState('');
  const [clientReqPrice, setClientReqPrice] = React.useState('');
  const [ourPrice, setOurPrice] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState([]);
  const [expanded, setExpanded] = React.useState({});
  const [orderType, setOrderType] = React.useState('Supply');
  const [impl, setImpl] = React.useState({ description: '', address: '', supervisor_id: '', hourly_rate: '', hours: '' });
  const hasImpl = orderType !== 'Supply';   // Supply+Implementation or Implementation-only
  const supervisors = state.users.filter(u => u.role === 'Supervisor');
  const setImplF = (k, v) => setImpl(m => ({ ...m, [k]: v }));

  const addLine = (categoryId) => {
    const bom = state.boms[categoryId] || [];
    const defaultPrice = bom.reduce((s, c) => { const p = getProduct(c.product_id); return s + (p ? p.sell : 0) * c.qty; }, 0);
    const nl = {
      id: 'l' + Date.now() + Math.random().toString(36).slice(2, 5),
      category_id: categoryId, bundle_qty: 1, unit_price: defaultPrice,
      components: bom.map(c => ({ product_id: c.product_id, qty: c.qty, override: false, original_qty: c.qty })),
    };
    setLines(ls => [...ls, nl]);
    setExpanded(e => ({ ...e, [nl.id]: true }));
  };
  const updateLine = (id, patch) => setLines(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l));
  const removeLine = (id) => setLines(ls => ls.filter(l => l.id !== id));
  const compSell = (components) => components.reduce((s, c) => { const p = getProduct(c.product_id); return s + (p ? p.sell : 0) * (c.qty || 0); }, 0);
  const withComps = (l, components) => ({ ...l, components, unit_price: compSell(components) });
  const updateComp = (lid, pid, patch) => setLines(ls => ls.map(l => l.id !== lid ? l : withComps(l,
    l.components.map(c => c.product_id !== pid ? c : { ...c, ...patch, override: patch.qty !== undefined ? patch.qty !== c.original_qty : c.override }))));
  const addComp = (lid, pid) => setLines(ls => ls.map(l => l.id !== lid ? l : withComps(l, [...l.components, { product_id: pid, qty: 1, override: true, original_qty: 0 }])));
  const removeComp = (lid, pid) => setLines(ls => ls.map(l => l.id !== lid ? l : withComps(l, l.components.filter(c => c.product_id !== pid))));

  const cust = customer ? getCustomer(customer) : null;
  const sell = lines.reduce((s, l) => s + l.bundle_qty * l.unit_price, 0);
  const implOnly = orderType === 'Service / Implementation';
  const canSubmit = customer && (lines.length > 0 || implOnly);

  const submit = () => {
    if (!canSubmit) { toast(implOnly ? 'Pick a customer' : 'Pick a customer and add at least one bundle'); return; }
    if (hasImpl && !impl.supervisor_id) { toast('Select a supervisor for the implementation'); return; }
    if (hasImpl && !(Number(impl.hourly_rate) > 0)) { toast('Set the implementation hourly rate'); return; }
    const implementation = hasImpl ? {
      description: impl.description || '', address: impl.address || '',
      supervisor_id: impl.supervisor_id, hourly_rate: Number(impl.hourly_rate) || 0, hours: Number(impl.hours) || 0,
      status: 'BOQ Pending', boq: [], daily_logs: [], requests: [],
    } : null;
    const src = {
      id: 'src-' + Date.now(),
      src_no: `INQ/FY26/${String(1 + (state.sourcings || []).length).padStart(4, '0')}`,
      customer_id: customer, ref: ref || null, date: TODAY, status: implOnly ? 'Sent to Supervisor' : 'Sent to Pre-sales',
      client_req_price: clientReqPrice === '' ? null : Number(clientReqPrice),
      our_price: ourPrice === '' ? null : Number(ourPrice),
      notes: notes || null, created_by: currentUser || null,
      order_type: orderType, implementation,
      lines, picks: {}, prices: {}, alloc: {}, margin: {}, converted_so_id: null,
    };
    const supName = implementation ? (state.users.find(u => u.id === implementation.supervisor_id)?.name || 'Supervisor') : '';
    mutate(s => ({
      ...s,
      sourcings: [src, ...(s.sourcings || [])],
      notifications: [
        ...(implOnly ? [] : [{ id: 'n-src-' + Date.now(), kind: 'sourcing', text: `${src.src_no} sent to Pre-sales for vendor sourcing · ${cust.name}`, date: TODAY, read: false, role: 'Pre-sales' }]),
        ...(implementation ? [{ id: 'n-sup-' + Date.now(), kind: 'sourcing', text: `${src.src_no}: implementation assigned to you · prepare the site BOQ · ${cust.name}`, date: TODAY, read: false, user_id: implementation.supervisor_id }] : []),
      ].concat(s.notifications),
    }), { action: 'create', entity: 'Sourcing', entity_id: src.id });
    toast(implOnly ? `${src.src_no} created · ${supName} to prepare BOQ` : `${src.src_no} sent to Pre-sales`, 'success');
    navigate(`sourcing/${src.id}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('sourcing')}>
            <Icon name="chevronLeft" size={12}/> Sourcing
          </div>
          <h1 className="page-title">New Inquiry</h1>
          <div className="page-sub">{implOnly ? 'Implementation only — assign a supervisor to prepare the site BOQ' : "Float the customer's requirement to Pre-sales for vendor costing — no commitment yet"}</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate('sourcing')}>Cancel</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{implOnly ? 'Send to Supervisor' : 'Send to Pre-sales'} <Icon name="arrowRight" size={13}/></button>
        </div>
      </div>

      <div className="split-2to1">
        <div className="stack">
          <div className="card">
            <div className="form-section">
              <div className="form-section-title">Customer & Inquiry</div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Customer *</label>
                  <select className="select" value={customer} onChange={e => setCustomer(e.target.value)}>
                    <option value="">Select customer…</option>
                    {state.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {cust && <div className="tiny muted mt-1"><span className="mono">{cust.gstin}</span> · {cust.state}</div>}
                </div>
                <div className="field">
                  <label className="field-label">Inquiry / customer ref</label>
                  <input className="input mono" placeholder="e.g. email dated 03-Jun / RFQ-882" value={ref} onChange={e => setRef(e.target.value)}/>
                  <div className="field-hint">Optional — for your reference only</div>
                </div>
              </div>
              <div className="field-row mt-2">
                <div className="field">
                  <label className="field-label">Client's req price</label>
                  <input type="number" min="0" className="input mono" placeholder="what the client asked (optional)" value={clientReqPrice} onChange={e => setClientReqPrice(e.target.value)}/>
                  <div className="field-hint">Shown to Pre-sales as the client's target</div>
                </div>
                <div className="field">
                  <label className="field-label">Our price</label>
                  <input type="number" min="0" className="input mono" placeholder="our intended quote (optional)" value={ourPrice} onChange={e => setOurPrice(e.target.value)}/>
                  <div className="field-hint">If set, Pre-sales uses this as the quote budget (else the indicative total)</div>
                </div>
              </div>
            </div>
          </div>

          {!implOnly && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Requirement</h3>
              <select className="select" style={{ width: 210, height: 26, fontSize: 12 }} value="" onChange={e => { if (e.target.value) addLine(e.target.value); e.target.value = ''; }}>
                <option value="">+ Add bundle by category…</option>
                {state.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="card-body flush">
              {lines.length === 0 ? (
                <div className="empty"><div className="empty-title">No items yet</div>Pick a category above — its BOM components load automatically; adjust quantities as needed.</div>
              ) : (
                <table className="t">
                  <thead><tr>
                    <th style={{ width: 22 }}></th><th>Bundle</th><th className="num">Qty</th><th style={{ width: 28 }}></th>
                  </tr></thead>
                  <tbody>
                    {lines.map(l => {
                      const cat = getCategory(l.category_id) || { name: l.category_id, hsn: '' };
                      const open = expanded[l.id];
                      return (
                        <Fragment key={l.id}>
                          <tr>
                            <td style={{ cursor: 'pointer' }} onClick={() => setExpanded(e => ({ ...e, [l.id]: !open }))}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={12}/></td>
                            <td><div style={{ fontWeight: 500 }}>{cat.name}</div><div className="tiny muted">{l.components.length} components</div></td>
                            <td className="num"><input type="number" className="input mono" min="1" value={l.bundle_qty} onChange={e => updateLine(l.id, { bundle_qty: parseInt(e.target.value) || 1 })} style={{ width: 64, textAlign: 'right' }}/></td>
                            <td><button className="btn btn-ghost btn-sm" onClick={() => removeLine(l.id)}><Icon name="trash" size={12} color="var(--danger)"/></button></td>
                          </tr>
                          {open && (
                            <>
                              {l.components.map(c => {
                                const p = getProduct(c.product_id) || { name: c.product_id, code: c.product_id };
                                return (
                                  <tr key={c.product_id} className="subrow">
                                    <td></td>
                                    <td><div style={{ fontSize: 12 }}>{p.name}</div><div className="tiny muted mono">{p.code}</div></td>
                                    <td className="num"><input type="number" className="input mono" min="0" value={Math.round((c.qty || 0) * (l.bundle_qty || 1))} onChange={e => { const t = parseInt(e.target.value) || 0; const b = l.bundle_qty || 1; updateComp(l.id, c.product_id, { qty: t / b }); }} style={{ width: 72, textAlign: 'right', height: 24 }}/>{l.bundle_qty > 1 && <div className="tiny muted">{(c.qty || 0)}/bundle</div>}{c.override && <div className="tiny" style={{ color: 'var(--warning)' }}>was {Math.round((c.original_qty || 0) * (l.bundle_qty || 1))}</div>}</td>
                                    <td><button className="btn btn-ghost btn-sm" onClick={() => removeComp(l.id, c.product_id)}><Icon name="x" size={11}/></button></td>
                                  </tr>
                                );
                              })}
                              <tr className="subrow">
                                <td></td>
                                <td colSpan="3" style={{ padding: '6px 0 12px' }}>
                                  <select className="select" value="" onChange={e => { if (e.target.value) { addComp(l.id, e.target.value); e.target.value = ''; } }} style={{ width: 220, height: 24, fontSize: 11.5 }}>
                                    <option value="">+ Add component…</option>
                                    {state.products.filter(p => !l.components.find(c => c.product_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                </td>
                              </tr>
                            </>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          )}

          <div className="card">
            <div className="form-section">
              <div className="form-section-title">Order type</div>
              <select className="select" value={orderType} onChange={e => setOrderType(e.target.value)} style={{ maxWidth: 320 }}>
                <option>Supply</option>
                <option>Supply + Implementation</option>
                <option>Service / Implementation</option>
              </select>
              <div className="field-hint">{orderType === 'Supply' ? 'Goods only — the normal supply flow.' : orderType === 'Supply + Implementation' ? 'Goods + on-site implementation by a supervisor.' : 'Implementation only — no supply bundles needed.'}</div>
            </div>
          </div>

          {hasImpl && (
            <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
              <div className="form-section">
                <div className="form-section-title">Implementation brief</div>
                <div className="field-row">
                  <div className="field">
                    <label className="field-label">Supervisor *</label>
                    <select className="select" value={impl.supervisor_id} onChange={e => setImplF('supervisor_id', e.target.value)}>
                      <option value="">Select supervisor…</option>
                      {supervisors.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    {supervisors.length === 0 && <div className="field-hint" style={{ color: 'var(--warning)' }}>No supervisors yet — create one in Settings → Users (role Supervisor).</div>}
                  </div>
                  <div className="field">
                    <label className="field-label">Hourly rate (₹) *</label>
                    <input type="number" min="0" className="input mono" value={impl.hourly_rate} onChange={e => setImplF('hourly_rate', e.target.value)} placeholder="e.g. 1200"/>
                    <div className="field-hint">The client is billed for implementation by the hour.</div>
                  </div>
                  <div className="field">
                    <label className="field-label">Estimated hours</label>
                    <input type="number" min="0" className="input mono" value={impl.hours} onChange={e => setImplF('hours', e.target.value)} placeholder="optional"/>
                  </div>
                </div>
                <div className="field mt-2">
                  <label className="field-label">Site address</label>
                  <textarea className="textarea" rows="2" value={impl.address} onChange={e => setImplF('address', e.target.value)} placeholder="Where the implementation happens…"/>
                </div>
                <div className="field mt-2">
                  <label className="field-label">Implementation description / scope</label>
                  <textarea className="textarea" rows="3" value={impl.description} onChange={e => setImplF('description', e.target.value)} placeholder="What needs to be done on site…"/>
                </div>
                <div className="tiny muted mt-1">On submit, the supervisor is assigned and asked to prepare the site BOQ. {impl.hourly_rate && impl.hours ? `Est. implementation value: ${inr((Number(impl.hourly_rate) || 0) * (Number(impl.hours) || 0))}.` : ''}</div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="form-section">
              <div className="form-section-title">{implOnly ? 'Notes for the Supervisor' : 'Notes for Pre-sales'}</div>
              <textarea className="textarea" placeholder={implOnly ? 'Anything the supervisor should know (site access, deadline, constraints…)' : 'Anything Pre-sales should know (target price, deadline, preferred vendor…)'} value={notes} onChange={e => setNotes(e.target.value)}/>
            </div>
          </div>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <div className="card">
            <div className="card-header"><h3 className="card-title">{implOnly ? 'Implementation estimate' : 'Indicative quote'}</h3></div>
            <div className="card-body">
              {implOnly ? (
                <>
                  <div className="dl">
                    <dt>Hourly rate</dt><dd className="num mono right">{inr(Number(impl.hourly_rate) || 0)}</dd>
                    <dt>Estimated hours</dt><dd className="num mono right">{Number(impl.hours) || 0}</dd>
                    <dt>Estimated value</dt><dd className="num mono right"><strong>{inr((Number(impl.hourly_rate) || 0) * (Number(impl.hours) || 0))}</strong></dd>
                  </div>
                  <div className="tiny muted mt-2">The supervisor prepares the site BOQ and logs daily hours. The client is billed by the hour — the final value comes from the hours actually logged.</div>
                </>
              ) : (
                <>
                  <div className="dl">
                    <dt>Bundles</dt><dd className="num mono right">{lines.length}</dd>
                    <dt>Indicative sell value</dt><dd className="num mono right">{inr(sell)}</dd>
                    {clientReqPrice !== '' && <><dt>Client's req price</dt><dd className="num mono right">{inr(Number(clientReqPrice))}</dd></>}
                    {ourPrice !== '' && <><dt>Our price (budget)</dt><dd className="num mono right"><strong>{inr(Number(ourPrice))}</strong></dd></>}
                  </div>
                  <div className="tiny muted mt-2">Pre-sales sees the quote budget ({ourPrice !== '' ? 'your "our price"' : 'the indicative total'}) and sources each component from vendors to hit a good margin. Nothing is committed until you raise the Sales Order.</div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- detail: vendor comparison + margin match (Purchase) + convert (Sales) --

function SourcingDetail({ srcId }) {
  const { state, navigate, mutate, getCustomer, getProduct, getCategory, getVendor, getUser, currentUser, addVendor } = useStore();
  const toast = useToast();
  const src = (state.sourcings || []).find(x => x.id === srcId);
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canSource = ['Pre-sales', 'Purchase', 'Org Admin'].includes(role);
  const canConvert = ['Sales', 'Pre-sales', 'Org Admin'].includes(role);
  const [showConvert, setShowConvert] = React.useState(false);
  const [showAddVendor, setShowAddVendor] = React.useState(false);
  const [rfqBusy, setRfqBusy] = React.useState(false);
  // Float RFQ: email every shortlisted vendor (that has an email) a private quote
  // link with these line items. Prices come back into src.prices automatically.
  const floatRFQ = async () => {
    const vids = src.quote_vendors || [];
    if (!vids.length) { toast('Add vendors first via “Add vendor & quote”'); return; }
    const emails = (state.config && state.config.vendor_emails) || {};
    const vendors = vids.map(vid => ({ vendor_id: vid, name: (getVendor(vid) || {}).name || vid, email: (emails[vid] || '').trim() }));
    const missing = vendors.filter(v => !v.email);
    if (missing.length) { toast(`No email set for: ${missing.map(v => v.name).join(', ')} — add it in “Add vendor & quote”`); return; }
    const itemsPayload = (src ? srcComponentList(src) : []).map(c => { const p = getProduct(c.product_id) || {}; return { product_id: c.product_id, name: p.name || c.product_id, code: p.code || '', qty: c.qty }; });
    if (!itemsPayload.length) { toast('No line items to quote'); return; }
    setRfqBusy(true);
    try {
      const r = await fetch('/api/float-rfq', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src_id: src.id, src_no: src.src_no, customer_name: (cust && cust.name) || '', org_name: (state.org && state.org.name) || '', vendors, items: itemsPayload }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        const okc = (j.sent || []).filter(s => s.ok).length;
        toast(`RFQ floated · emailed ${okc}/${vendors.length} vendor(s) · prices will appear here as they reply`, okc ? 'success' : '');
        mutate(s => s, { action: 'float-rfq', entity: 'Sourcing', entity_id: src.id, user_id: currentUser, detail: `Floated RFQ to ${okc} vendor(s) · ${src.src_no}` });
      } else { toast(j.error || 'Could not float RFQ (is the mailer configured?)'); }
    } catch (e) { toast('Network error floating RFQ'); }
    setRfqBusy(false);
  };
  const [showAllocate, setShowAllocate] = React.useState(false);

  const comps = src ? srcComponentList(src) : [];
  // Local vendor picks — default to the previously-saved picks, else the cheapest
  // candidate vendor (shortlist quotes if added, else estimates).
  const [picks, setPicks] = React.useState(() => {
    if (!src) return {};
    const init = { ...(src.picks || {}) };
    const ids = srcVendorIds(src, state.vendors);
    srcComponentList(src).forEach(c => {
      if (!init[c.product_id]) {
        const p = getProduct(c.product_id);
        if (p && ids.length) {
          let best = null;
          ids.forEach(vid => { const pr = srcUnitPrice(src, vid, p); if (best === null || pr < best.pr) best = { vid, pr }; });
          if (best) init[c.product_id] = best.vid;
        }
      }
    });
    return init;
  });

  if (!src) return <div className="page"><div className="empty"><div className="empty-title">Inquiry not found</div><button className="btn mt-2" onClick={() => navigate('sourcing')}>← Back</button></div></div>;

  const cust = getCustomer(src.customer_id);
  const margin = computeMargin(src, picks, getProduct);
  const locked = src.status === 'Converted';
  const hasQuotes = (src.quote_vendors || []).length > 0;
  // Implementation-only inquiries have no supply bundles → no vendor sourcing step.
  const hasSupply = (src.lines || []).length > 0;

  // Per-item vendor options from the candidate set, priced by entered quote
  // (or estimate), cheapest first.
  const candIds = srcVendorIds(src, state.vendors);
  const suggFor = (p) => candIds.map(vid => {
    const v = getVendor(vid) || { id: vid, name: vid };
    const price = srcUnitPrice(src, vid, p);
    const base = p.buy || 0;
    return { vendor: v, price, benefitPct: base ? ((base - price) / base) * 100 : 0 };
  }).sort((a, b) => a.price - b.price);

  const persist = (patch, audit, msg) => {
    mutate(s => ({ ...s, sourcings: (s.sourcings || []).map(x => x.id === src.id ? { ...x, ...patch } : x) }), audit);
    if (msg) toast(msg, 'success');
  };

  // Preserve entered quotes; fill estimates only where a candidate has none.
  const buildPrices = () => {
    const out = JSON.parse(JSON.stringify(src.prices || {}));
    comps.forEach(c => {
      const p = getProduct(c.product_id); if (!p) return;
      out[c.product_id] = out[c.product_id] || {};
      candIds.forEach(vid => { if (out[c.product_id][vid] == null) out[c.product_id][vid] = srcUnitPrice(src, vid, p); });
    });
    return out;
  };

  const saveQuotation = () => {
    persist({ picks, prices: buildPrices(), margin, status: (src.status === 'Sent to Pre-sales' || src.status === 'Sent to Purchase') ? 'Sourced' : src.status },
      { action: 'source', entity: 'Sourcing', entity_id: src.id }, 'Vendor quotation saved');
  };

  const sendToSales = () => {
    mutate(s => ({
      ...s,
      sourcings: (s.sourcings || []).map(x => x.id === src.id ? { ...x, picks, prices: buildPrices(), margin, status: 'Sent to Sales' } : x),
      notifications: [{ id: 'n-src2-' + Date.now(), kind: 'sourcing', text: `${src.src_no} costed · margin ${pct1(margin.marginPct)} · ready to raise SO`, date: TODAY, read: false, role: 'Sales' }, ...s.notifications],
    }), { action: 'send', entity: 'Sourcing', entity_id: src.id });
    toast(`${src.src_no} sent to Sales · margin ${pct1(margin.marginPct)}`, 'success');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('sourcing')}>
            <Icon name="chevronLeft" size={12}/> Sourcing
          </div>
          <h1 className="page-title"><span className="mono">{src.src_no}</span><span style={{ marginLeft: 10 }}><StatusBadge status={src.status}/></span></h1>
          <div className="page-sub">{cust ? cust.name : '—'}{src.ref ? ` · Ref ${src.ref}` : ''} · floated {fmtDate(src.date)}</div>
        </div>
        <div className="page-actions">
          {hasSupply && canSource && !locked && <button className="btn btn-primary" onClick={() => setShowAddVendor(true)}><Icon name="plus" size={13}/>Add vendor &amp; quote</button>}
          {hasSupply && canSource && !locked && <button className="btn" disabled={rfqBusy} onClick={floatRFQ} title="Email each shortlisted vendor a private link to quote these items"><Icon name="mail" size={13}/>{rfqBusy ? 'Floating…' : 'Float RFQ'}</button>}
          {hasSupply && canSource && !locked && <button className="btn" onClick={() => setShowAllocate(true)}><Icon name="arrowLeftRight" size={13}/>Allocate across vendors</button>}
          {hasSupply && canSource && !locked && <button className="btn" onClick={saveQuotation}><Icon name="save" size={13}/>Save vendor quotation</button>}
          {hasSupply && canSource && !locked && <button className="btn btn-primary" onClick={sendToSales}><Icon name="mail" size={13}/>Send to Sales</button>}
          {canConvert && !locked && (src.status === 'Sent to Sales' || src.status === 'Sourced') && (
            <button className="btn btn-primary" onClick={() => setShowConvert(true)}><Icon name="receipt" size={13}/>Create Sales Order</button>
          )}
          {src.converted_so_id && <button className="btn" onClick={() => navigate(`sales-orders/${src.converted_so_id}`)}><Icon name="arrowRight" size={13}/>View Sales Order</button>}
        </div>
      </div>

      {/* Margin match — Customer sell ⟷ Vendor buy ⟷ Margin (supply only) */}
      {hasSupply && (
      <div className="split-3 mb-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}>
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Quote budget</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="mono">{inr(margin.sell)}</div>
          <div className="tiny muted">
            {margin.our_price ? 'our price' : 'indicative quote'}
            {margin.our_price && margin.indicative !== margin.our_price ? ` · indicative ${inr(margin.indicative)}` : ''}
            {margin.client_req ? ` · client asked ${inr(margin.client_req)}` : ''}
          </div>
        </div></div>
        <div className="card"><div className="card-body" style={{ textAlign: 'center' }}>
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Vendor (PO quotation)</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="mono">{inr(margin.buy)}</div>
          <div className="tiny muted">best vendor cost selected</div>
        </div></div>
        <div className="card" style={{ borderColor: margin.marginPct >= 0 ? 'oklch(0.85 0.06 155)' : 'oklch(0.86 0.08 25)' }}><div className="card-body" style={{ textAlign: 'center', background: margin.marginPct >= 0 ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
          <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Margin</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: margin.marginPct >= 0 ? 'var(--success)' : 'var(--danger)' }} className="mono">{inr(margin.marginAmt)}</div>
          <div className="small" style={{ fontWeight: 600, color: margin.marginPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>{pct1(margin.marginPct)} margin</div>
        </div></div>
      </div>
      )}

      {src.implementation && <ImplBOQPanel src={src}/>}

      {/* Multi-vendor allocation summary (per-vendor margin + grand total) */}
      {srcHasAlloc(src) && (() => {
        const sum = srcVendorSummary(src, getProduct);
        const tot = sum.reduce((a, v) => ({ cost: a.cost + v.cost, our: a.our + v.our, qty: a.qty + v.qty }), { cost: 0, our: 0, qty: 0 });
        return (
          <div className="card mb-2">
            <div className="card-header"><h3 className="card-title">Vendor allocation — split across {sum.length} vendor(s)</h3>{canSource && !locked && <button className="btn btn-sm" onClick={() => setShowAllocate(true)}><Icon name="edit" size={12}/>Edit allocation</button>}</div>
            <div className="card-body flush"><table className="t">
              <thead><tr><th>Vendor</th><th className="num">Items</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Our value</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {sum.map(v => { const ven = getVendor(v.vendor_id); return (
                  <tr key={v.vendor_id}><td>{ven ? ven.name : v.vendor_id}</td><td className="num">{v.items}</td><td className="num">{v.qty}</td><td className="num mono">{inr(v.cost)}</td><td className="num mono">{inr(v.our)}</td><td className="num mono" style={{ color: v.margin >= 0 ? 'var(--success)' : 'var(--danger)' }}>{inr(v.margin)}<div className="tiny">{pct1(v.marginPct)}</div></td></tr>
                ); })}
              </tbody>
              <tfoot><tr><td className="right small">Grand total</td><td></td><td className="num">{tot.qty}</td><td className="num mono"><strong>{inr(tot.cost)}</strong></td><td className="num mono">{inr(tot.our)}</td><td className="num mono" style={{ color: (tot.our - tot.cost) >= 0 ? 'var(--success)' : 'var(--danger)' }}><strong>{inr(tot.our - tot.cost)}</strong><div className="tiny">{tot.our > 0 ? pct1((tot.our - tot.cost) / tot.our * 100) : '+0.0%'}</div></td></tr></tfoot>
            </table></div>
          </div>
        );
      })()}

      {/* Per-item vendor comparison */}
      <div className="card mb-2">
        <div className="card-header">
          <h3 className="card-title">Vendor comparison — per item</h3>
          <div className="tiny muted">{hasQuotes ? `Comparing ${(src.quote_vendors || []).length} quoted vendor(s) · best price suggested ★` : 'Estimated across all vendors — use “Add vendor & quote” to enter real quotes'}</div>
        </div>
        <div className="card-body flush">
          <table className="t">
            <thead><tr>
              <th>Item</th><th className="num">Req qty</th><th>Vendor options (cheapest first)</th><th className="num">Chosen</th><th className="num">Line cost</th>
            </tr></thead>
            <tbody>
              {comps.map(c => {
                const p = getProduct(c.product_id) || { id: c.product_id, name: c.product_id, code: c.product_id, buy: 0 };
                const sugg = suggFor(p);
                const chosen = picks[c.product_id];
                const chosenSug = sugg.find(s => s.vendor.id === chosen);
                return (
                  <tr key={c.product_id}>
                    <td><div style={{ fontWeight: 500 }}>{p.name}</div><div className="tiny muted mono">{p.code} · baseline {inr(p.buy)}</div></td>
                    <td className="num">{c.qty}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {sugg.map((s, idx) => {
                          const sel = chosen === s.vendor.id;
                          return (
                            <button key={s.vendor.id} type="button" disabled={locked || !canSource}
                              onClick={() => setPicks(pk => ({ ...pk, [c.product_id]: s.vendor.id }))}
                              className="btn btn-sm"
                              style={{
                                borderColor: sel ? 'var(--accent)' : 'var(--border)',
                                background: sel ? 'var(--accent-bg)' : 'var(--surface)',
                                fontWeight: sel ? 600 : 400, cursor: (locked || !canSource) ? 'default' : 'pointer',
                                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '4px 8px', height: 'auto',
                              }}>
                              <span style={{ fontSize: 11.5 }}>{idx === 0 ? '★ ' : ''}{s.vendor.name}</span>
                              <span className="tiny" style={{ fontFamily: 'var(--mono)' }}>
                                {inr(s.price)} · <span style={{ color: s.benefitPct >= 0 ? 'var(--success)' : 'var(--text-3)' }}>{pct1(s.benefitPct)}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="num">{chosenSug ? <span style={{ color: chosenSug.benefitPct >= 0 ? 'var(--success)' : 'var(--text-2)', fontWeight: 600 }}>{pct1(chosenSug.benefitPct)}</span> : '—'}</td>
                    <td className="num mono">{inr((chosenSug ? chosenSug.price : (p.buy || 0)) * c.qty)}</td>
                  </tr>
                );
              })}
              {comps.length === 0 && <tr><td colSpan="5"><div className="empty">This inquiry has no components.</div></td></tr>}
            </tbody>
            <tfoot>
              <tr><td colSpan="4" className="right small">Vendor quotation total</td><td className="num mono"><strong>{inr(margin.buy)}</strong></td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Inquiry lines (customer-facing) */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">Inquiry — customer requirement</h3></div>
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Bundle</th><th className="num">Qty</th><th className="num">Unit sell ₹</th><th className="num">Line ₹</th></tr></thead>
            <tbody>
              {(src.lines || []).map(l => {
                const cat = getCategory(l.category_id) || { name: l.category_id, hsn: '' };
                return (
                  <tr key={l.id}>
                    <td><div style={{ fontWeight: 500 }}>{cat.name}</div><div className="tiny muted">{(l.components || []).length} components</div></td>
                    <td className="num">{l.bundle_qty}</td>
                    <td className="num">{inr(l.unit_price)}</td>
                    <td className="num"><strong>{inr(l.bundle_qty * l.unit_price)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan="3" className="right small">Customer sell value</td><td className="num mono"><strong>{inr(margin.sell)}</strong></td></tr></tfoot>
          </table>
        </div>
        {src.notes && <div className="card-body small" style={{ borderTop: '1px solid var(--border)' }}><strong className="tiny muted">Notes:</strong> {src.notes}</div>}
      </div>

      {showConvert && <ConvertToSOModal src={src} margin={margin} onClose={() => setShowConvert(false)}/>}
      {showAddVendor && <AddVendorQuoteModal src={src} comps={comps} onClose={() => setShowAddVendor(false)}/>}
      {showAllocate && <AllocateVendorsModal src={src} onClose={() => setShowAllocate(false)}/>}
    </div>
  );
}

// ---- add a vendor (master or custom) + per-line-item quote -----------------

function AddVendorQuoteModal({ src, comps, onClose }) {
  const { state, mutate, getProduct, getVendor, addVendor, saveConfig } = useStore();
  const toast = useToast();
  const already = new Set(src.quote_vendors || []);
  const available = state.vendors.filter(v => !already.has(v.id));
  const [mode, setMode] = React.useState(available[0] ? available[0].id : '__custom');
  const [customName, setCustomName] = React.useState('');
  const [customCity, setCustomCity] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  // Vendor email is stored once (config.vendor_emails) and reused every time —
  // prefill it whenever the selected vendor changes.
  React.useEffect(() => {
    const em = ((state.config && state.config.vendor_emails) || {})[mode] || '';
    setEmail(mode && mode !== '__custom' ? em : '');
  }, [mode]);
  const [prices, setPrices] = React.useState(() => {
    const init = {}; comps.forEach(c => { const p = getProduct(c.product_id); init[c.product_id] = p ? (p.buy || 0) : 0; });
    return init;
  });
  // Suggest (prefill) prices from this vendor's history when a real vendor is
  // chosen — editable, never auto-committed. Custom vendors → baseline.
  React.useEffect(() => {
    const next = {};
    comps.forEach(c => {
      const p = getProduct(c.product_id);
      let v = p ? (p.buy || 0) : 0;
      if (mode !== '__custom') { const sug = suggestVendorPrice(state, mode, c.product_id); if (sug) v = sug.price; }
      next[c.product_id] = v;
    });
    setPrices(next);
  }, [mode]);
  const setPrice = (pid, v) => setPrices(s => ({ ...s, [pid]: v }));
  // Our price per item (editable here for live margin) — defaults to product sell.
  const [ourPrices, setOurPrices] = React.useState(() => {
    const init = {}; comps.forEach(c => { const p = getProduct(c.product_id); init[c.product_id] = p ? (p.sell || 0) : 0; });
    return init;
  });
  const setOur = (pid, v) => setOurPrices(s => ({ ...s, [pid]: v }));
  const total = comps.reduce((s, c) => s + (Number(prices[c.product_id]) || 0) * c.qty, 0);
  const ourTotal = comps.reduce((s, c) => s + (Number(ourPrices[c.product_id]) || 0) * c.qty, 0);
  const marginTotal = ourTotal - total;

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    let vid = mode, label = '';
    if (mode === '__custom') {
      if (!customName.trim()) { toast('Enter the custom vendor name'); setSaving(false); return; }
      const res = await addVendor({ name: customName.trim(), city: customCity.trim() || '—' });
      if (!res || !res.ok) { toast((res && res.error) || 'Could not add vendor'); setSaving(false); return; }
      vid = res.vendor.id; label = customName.trim();
    } else {
      label = getVendor(vid)?.name || 'Vendor';
    }
    mutate(s => ({
      ...s,
      sourcings: (s.sourcings || []).map(x => {
        if (x.id !== src.id) return x;
        const np = JSON.parse(JSON.stringify(x.prices || {}));
        comps.forEach(c => { np[c.product_id] = np[c.product_id] || {}; np[c.product_id][vid] = Number(prices[c.product_id]) || 0; });
        return { ...x, prices: np, quote_vendors: Array.from(new Set([...(x.quote_vendors || []), vid])) };
      }),
    }), { action: 'add-vendor-quote', entity: 'Sourcing', entity_id: src.id });
    // Persist the vendor's email for lifetime reuse (editable next time).
    if (email.trim() && vid && saveConfig) {
      const cur = (state.config && state.config.vendor_emails) || {};
      if (cur[vid] !== email.trim()) await saveConfig({ vendor_emails: { ...cur, [vid]: email.trim() } });
    }
    toast(`${label} quote added`, 'success');
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="Add vendor & quote" onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? 'Adding…' : `Add vendor · ${inr(total)}`}</button>
      </>
    }>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Vendor *</label>
          <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
            {available.map(v => <option key={v.id} value={v.id}>{v.name}{v.city ? ` · ${v.city}` : ''}</option>)}
            <option value="__custom">+ Add custom vendor…</option>
          </select>
        </div>
        {mode === '__custom' && (
          <div className="field">
            <label className="field-label">Custom vendor name *</label>
            <input className="input" placeholder="e.g. Sai Traders" value={customName} onChange={e => setCustomName(e.target.value)} autoFocus/>
          </div>
        )}
        {mode === '__custom' && (
          <div className="field">
            <label className="field-label">City</label>
            <input className="input" placeholder="optional" value={customCity} onChange={e => setCustomCity(e.target.value)}/>
          </div>
        )}
      </div>
      <div className="field mt-2">
        <label className="field-label">Vendor email <span className="tiny muted">(for RFQ · saved for next time)</span></label>
        <input className="input" type="email" placeholder="vendor@example.com" value={email} onChange={e => setEmail(e.target.value)}/>
        <div className="tiny muted mt-1">Stored on this vendor and reused automatically — you won't need to type it again. Used when you Float RFQ.</div>
      </div>
      <div className="field mt-2">
        <label className="field-label">This vendor's quote per item</label>
        <div className="card"><div className="card-body flush">
          <table className="t">
            <thead><tr><th>Item</th><th className="num">Req qty</th><th className="num">Our price ₹</th><th className="num">Vendor rate ₹</th><th className="num">Margin</th><th className="num">Line</th></tr></thead>
            <tbody>
              {comps.map(c => {
                const p = getProduct(c.product_id) || { name: c.product_id, code: c.product_id, buy: 0, sell: 0 };
                const sug = mode !== '__custom' ? suggestVendorPrice(state, mode, c.product_id) : null;
                const our = Number(ourPrices[c.product_id]) || 0;
                const vr = Number(prices[c.product_id]) || 0;
                const mLine = (our - vr) * c.qty;
                const mPct = our > 0 ? ((our - vr) / our) * 100 : 0;
                const mColor = mLine >= 0 ? 'var(--success)' : 'var(--danger)';
                return (
                  <tr key={c.product_id}>
                    <td>{p.name}<div className="tiny muted mono">{p.code}</div></td>
                    <td className="num">{c.qty}</td>
                    <td className="num">
                      <input type="number" min="0" className="input mono" value={ourPrices[c.product_id]} onChange={e => setOur(c.product_id, e.target.value)} style={{ width: 100, textAlign: 'right', height: 26 }}/>
                    </td>
                    <td className="num">
                      <input type="number" min="0" className="input mono" value={prices[c.product_id]} onChange={e => setPrice(c.product_id, e.target.value)} style={{ width: 100, textAlign: 'right', height: 26 }}/>
                      {sug && <div className="tiny" style={{ color: 'var(--accent)' }} title={`Recency-weighted from ${sug.n} past quote(s); last ${inr(sug.last)}`}>≈ {inr(sug.price)} · {sug.n} past</div>}
                    </td>
                    <td className="num mono" style={{ color: mColor }}>
                      <strong>{inr(mLine)}</strong>
                      <div className="tiny" style={{ color: mColor }}>{mPct >= 0 ? '+' : ''}{mPct.toFixed(1)}%</div>
                    </td>
                    <td className="num mono">{inr(vr * c.qty)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td colSpan="2" className="right small">Totals</td>
              <td className="num mono">{inr(ourTotal)}</td>
              <td className="num mono">{inr(total)}</td>
              <td className="num mono" style={{ color: marginTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}><strong>{inr(marginTotal)}</strong><div className="tiny">{ourTotal > 0 ? ((marginTotal / ourTotal) * 100).toFixed(1) : '0.0'}%</div></td>
              <td className="num mono"><strong>{inr(total)}</strong></td>
            </tr></tfoot>
          </table>
        </div></div>
      </div>
      <div className="tiny muted mt-2">Add more vendors the same way — each appears as an option on every line item, and the cheapest is auto-suggested (★). You then pick per item as usual.</div>
    </Modal>
  );
}

// ---- convert inquiry → Sales Order (one click) -----------------------------

// Site BOQ (bill of quantities) built by the assigned Supervisor on the inquiry,
// then sent to Sales. Mobile-friendly (wraps, no wide fixed tables).
function ImplBOQPanel({ src }) {
  const { state, mutate, getUser, currentUser } = useStore();
  const toast = useToast();
  const im = src.implementation || {};
  const boq = im.boq || [];
  const role = getUser(currentUser)?.role;
  const isSupervisor = currentUser === im.supervisor_id;
  const canEdit = (isSupervisor || role === 'Org Admin') && src.status !== 'Converted';
  const sup = getUser(im.supervisor_id);
  const [q, setQ] = React.useState('');
  const [customName, setCustomName] = React.useState('');
  const [qty, setQty] = React.useState(1);
  const results = q.trim() ? state.products.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];

  const saveBoq = (nextBoq, extra) => mutate(s => ({ ...s, sourcings: (s.sourcings || []).map(x => x.id === src.id ? { ...x, implementation: { ...(x.implementation || {}), boq: nextBoq, ...(extra || {}) } } : x) }), { action: 'boq', entity: 'Sourcing', entity_id: src.id });
  const addProduct = (p) => { saveBoq([...boq, { id: 'b' + Date.now(), product_id: p.id, name: p.name, qty: Math.max(1, Number(qty) || 1), uom: p.uom || '' }]); setQ(''); setQty(1); toast(`${p.name} added to BOQ`, 'success'); };
  const addCustom = () => { if (!customName.trim()) return; saveBoq([...boq, { id: 'b' + Date.now(), product_id: null, name: customName.trim(), qty: Math.max(1, Number(qty) || 1), uom: '' }]); setCustomName(''); setQty(1); toast('Item added to BOQ', 'success'); };
  const setItemQty = (id, v) => saveBoq(boq.map(b => b.id === id ? { ...b, qty: Math.max(0, Number(v) || 0) } : b));
  const removeItem = (id) => saveBoq(boq.filter(b => b.id !== id));
  // Implementation-only inquiries never pass through Pre-sales vendor sourcing, so
  // handing the BOQ back to Sales also moves the inquiry itself to 'Sent to Sales'
  // (that's what unlocks "Create Sales Order"). Supply inquiries are untouched.
  const implOnlySrc = (src.lines || []).length === 0;
  const sendToSales = () => {
    if (!boq.length) { toast('Add at least one BOQ item'); return; }
    mutate(s => ({ ...s, sourcings: (s.sourcings || []).map(x => x.id === src.id ? { ...x, implementation: { ...(x.implementation || {}), status: 'BOQ Ready' }, ...(implOnlySrc ? { status: 'Sent to Sales' } : {}) } : x), notifications: [{ id: 'n-boq-' + Date.now(), kind: 'sourcing', text: `${src.src_no}: site BOQ ready (${boq.length} item(s)) from ${sup ? sup.name : 'Supervisor'}`, date: TODAY, read: false, role: 'Sales' }, ...s.notifications] }), { action: 'boq-send', entity: 'Sourcing', entity_id: src.id });
    toast('BOQ sent to Sales', 'success');
  };

  return (
    <div className="card mb-2" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div className="card-header">
        <div><h3 className="card-title">Implementation BOQ</h3><span className="card-sub">Supervisor: {sup ? sup.name : '—'} · {im.status || 'BOQ Pending'} · {boq.length} item(s)</span></div>
        {canEdit && <button className="btn btn-sm btn-primary" onClick={sendToSales}><Icon name="mail" size={12}/>Send BOQ to Sales</button>}
      </div>
      <div className="card-body">
        {(im.address || im.description) && <div className="tiny muted mb-2">{im.address && <div><strong>Site:</strong> {im.address}</div>}{im.description && <div><strong>Scope:</strong> {im.description}</div>}<div><strong>Billing:</strong> {inr(im.hourly_rate || 0)}/hr (hours from daily logs)</div></div>}
        {boq.length === 0 ? <div className="empty">No BOQ items yet.{canEdit ? ' Add what the site needs below.' : ''}</div> : (
          <table className="t"><thead><tr><th>Item</th><th className="num">Qty</th>{canEdit && <th style={{ width: 28 }}></th>}</tr></thead>
            <tbody>{boq.map(b => (
              <tr key={b.id}><td>{b.name}{b.product_id ? '' : <span className="badge tiny" style={{ marginLeft: 4 }}>custom</span>}{b.uom ? <span className="tiny muted"> · {b.uom}</span> : ''}</td>
                <td className="num">{canEdit ? <input type="number" min="0" className="input mono" value={b.qty} onChange={e => setItemQty(b.id, e.target.value)} style={{ width: 64, height: 24, textAlign: 'right' }}/> : b.qty}</td>
                {canEdit && <td><button className="btn btn-ghost btn-sm" onClick={() => removeItem(b.id)}><Icon name="x" size={11} color="var(--danger)"/></button></td>}
              </tr>))}</tbody>
          </table>
        )}
        {canEdit && (
          <div className="mt-2" style={{ display: 'grid', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" placeholder="Search catalogue item…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 180px', minWidth: 0 }}/>
                <input type="number" min="1" className="input mono" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 70 }} title="Qty"/>
              </div>
              {results.length > 0 && <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: 4 }}>{results.map(p => (<div key={p.id} className="queue-item" style={{ cursor: 'pointer' }} onClick={() => addProduct(p)}><div className="grow"><div className="small">{p.name}</div><div className="tiny muted mono">{p.code}</div></div><Icon name="plus" size={12}/></div>))}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" placeholder="…or type a custom item (labour, cement…)" value={customName} onChange={e => setCustomName(e.target.value)} style={{ flex: '1 1 180px', minWidth: 0 }}/>
              <button className="btn btn-sm" disabled={!customName.trim()} onClick={addCustom}><Icon name="plus" size={11}/>Add custom</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConvertToSOModal({ src, margin, onClose }) {
  const { state, mutate, navigate, getCustomer, currentUser } = useStore();
  const toast = useToast();
  const cust = getCustomer(src.customer_id);
  const pms = state.users.filter(u => u.role === 'Project Manager');
  const [poRef, setPoRef] = React.useState('');
  const [date, setDate] = React.useState(TODAY);
  const [expected, setExpected] = React.useState(() => { const d = new Date(TODAY); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); });
  const [priority, setPriority] = React.useState('Standard');
  const [orderType, setOrderType] = React.useState(src.order_type || 'Supply');
  const [paymentTerms, setPaymentTerms] = React.useState(['Advance', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60'].includes(cust && cust.terms) ? cust.terms : 'Net 30');
  const [pm, setPm] = React.useState('');
  const [shipTo, setShipTo] = React.useState((src.implementation && src.implementation.address) || (cust ? cust.address : ''));

  const create = () => {
    if (!poRef.trim()) { toast('Customer PO reference is required (the SO unique id)'); return; }
    // Deep-copy lines with fresh ids so the SO is independent of the inquiry.
    const lines = JSON.parse(JSON.stringify(src.lines || [])).map(l => ({ ...l, id: 'l' + Date.now() + Math.random().toString(36).slice(2, 5) }));
    const newSO = {
      id: 'so-' + Date.now(),
      so_no: `SO/FY26/${String(17 + state.sales_orders.length).padStart(4, '0')}`,
      customer_id: src.customer_id, customer_po: poRef.trim(), date, expected,
      priority, order_type: orderType, pm, ship_to: shipTo,
      payment_terms: paymentTerms, status: 'Pending Approval',
      lines, notes: src.notes || `Raised from inquiry ${src.src_no} · expected margin ${pct1(margin.marginPct)}`,
      // Carry the implementation brief (supervisor, site, hourly rate, BOQ) into the SO.
      extra: src.implementation ? { implementation: src.implementation } : {},
    };
    mutate(s => ({
      ...s,
      sales_orders: [newSO, ...s.sales_orders],
      sourcings: (s.sourcings || []).map(x => x.id === src.id ? { ...x, status: 'Converted', converted_so_id: newSO.id } : x),
      notifications: [{ id: 'n-conv-' + Date.now(), kind: 'so', text: `${newSO.so_no} submitted for approval (from inquiry ${src.src_no}) · ${cust ? cust.name : ''}`, date: TODAY, read: false, role: 'Project Manager' }, ...s.notifications],
    }), { action: 'convert', entity: 'Sourcing', entity_id: src.id, to: newSO.id });
    toast(`${newSO.so_no} created from ${src.src_no} · awaiting PM approval`, 'success');
    onClose();
    navigate(`sales-orders/${newSO.id}`);
  };

  return (
    <Modal title={`Create Sales Order from ${src.src_no}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={create}>Create Sales Order</button>
      </>
    }>
      <div className="tiny muted mb-2" style={{ padding: 10, background: 'var(--info-bg, var(--accent-bg))', borderRadius: 4 }}>
        Copies this inquiry's {(src.lines || []).length} bundle(s) into a new Sales Order at the quoted prices (margin {pct1(margin.marginPct)}). It enters the normal flow at <strong>Pending Approval</strong>.
      </div>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Customer</label>
          <input className="input" value={cust ? cust.name : '—'} readOnly disabled/>
          {cust && <div className="tiny muted mt-1"><span className="mono">{cust.gstin}</span> · {cust.state} · {cust.terms}</div>}
        </div>
        <div className="field">
          <label className="field-label">Customer PO Reference (UID) *</label>
          <input className="input mono" placeholder="e.g. RC/PO/2026/0312" value={poRef} onChange={e => setPoRef(e.target.value)} autoFocus/>
          <div className="field-hint">The Sales Order's unique identifier — never auto-generated</div>
        </div>
      </div>
      <div className="field-row-3 mt-2">
        <div className="field">
          <label className="field-label">SO Date</label>
          <input type="date" className="input mono" value={date} onChange={e => setDate(e.target.value)}/>
        </div>
        <div className="field">
          <label className="field-label">Expected Delivery</label>
          <input type="date" className="input mono" value={expected} onChange={e => setExpected(e.target.value)}/>
        </div>
        <div className="field">
          <label className="field-label">Order Type</label>
          <select className="select" value={orderType} onChange={e => setOrderType(e.target.value)}>
            <option>Supply</option><option>Supply + Implementation</option><option>Service / Implementation</option>
          </select>
        </div>
      </div>
      <div className="field-row-3 mt-2">
        <div className="field">
          <label className="field-label">Priority</label>
          <select className="select" value={priority} onChange={e => setPriority(e.target.value)}>
            <option>Standard</option><option>Urgent</option><option>Critical</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Payment Terms</label>
          <select className="select" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}>
            <option>Advance</option><option>Net 7</option><option>Net 15</option><option>Net 30</option><option>Net 45</option><option>Net 60</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Project Manager</label>
          <select className="select" value={pm} onChange={e => setPm(e.target.value)}>
            <option value="">Unassigned</option>
            {pms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field mt-2">
        <label className="field-label">Ship-to address</label>
        <textarea className="textarea" rows="2" value={shipTo} onChange={e => setShipTo(e.target.value)} placeholder="Delivery address for this order"/>
      </div>
      <div className="tiny muted mt-2">Prefer to start fresh? Close this and use <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { onClose(); navigate('sales-orders/new'); }}>New Sales Order</a> instead.</div>
    </Modal>
  );
}

// ---- allocate item quantities across multiple quoted vendors (sourcing) ------
function AllocateVendorsModal({ src, onClose }) {
  const { state, mutate, getProduct, getVendor } = useStore();
  const toast = useToast();
  const comps = srcComponentList(src);
  const candIds = src.quote_vendors || [];
  const rateOf = (vid, p) => (src.prices && src.prices[p.id] && src.prices[p.id][vid] != null) ? Number(src.prices[p.id][vid]) : (window.vendorUnitPrice ? window.vendorUnitPrice(vid, p) : (p ? (p.buy || 0) : 0));
  const cheapest = (p) => { let best = null; candIds.forEach(vid => { const r = rateOf(vid, p); if (best === null || r < best.r) best = { vid, r }; }); return best; };
  const [alloc, setAlloc] = React.useState(() => {
    const a = {};
    comps.forEach(c => {
      const ex = (src.alloc && src.alloc[c.product_id]) || null;
      if (ex && ex.length) { a[c.product_id] = ex.map(r => ({ ...r })); return; }
      const p = getProduct(c.product_id); const ch = cheapest(p);
      a[c.product_id] = [{ vendor_id: ch ? ch.vid : (candIds[0] || ''), qty: c.qty, rate: ch ? ch.r : 0 }];
    });
    return a;
  });
  const setRow = (pid, ri, patch) => setAlloc(a => ({ ...a, [pid]: a[pid].map((r, i) => i === ri ? { ...r, ...patch } : r) }));
  const addRow = (pid) => { const p = getProduct(pid); const ch = cheapest(p); setAlloc(a => ({ ...a, [pid]: [...(a[pid] || []), { vendor_id: ch ? ch.vid : (candIds[0] || ''), qty: 0, rate: ch ? ch.r : 0 }] })); };
  const removeRow = (pid, ri) => setAlloc(a => ({ ...a, [pid]: a[pid].filter((_, i) => i !== ri) }));
  const autoCheapest = (c) => { const p = getProduct(c.product_id); const rows = alloc[c.product_id] || []; const rem = c.qty - rows.reduce((s, r) => s + (Number(r.qty) || 0), 0); if (rem <= 0) return; const ch = cheapest(p); setAlloc(a => ({ ...a, [c.product_id]: [...(a[c.product_id] || []), { vendor_id: ch ? ch.vid : (candIds[0] || ''), qty: rem, rate: ch ? ch.r : 0 }] })); };

  const save = () => {
    const clean = {};
    Object.entries(alloc).forEach(([pid, rows]) => { const rr = (rows || []).filter(r => (Number(r.qty) || 0) > 0 && r.vendor_id).map(r => ({ vendor_id: r.vendor_id, qty: Number(r.qty) || 0, rate: Number(r.rate) || 0 })); if (rr.length) clean[pid] = rr; });
    mutate(s => ({ ...s, sourcings: (s.sourcings || []).map(x => x.id === src.id ? { ...x, alloc: clean } : x) }), { action: 'allocate', entity: 'Sourcing', entity_id: src.id });
    toast('Vendor allocation saved', 'success');
    onClose();
  };

  if (!candIds.length) return (
    <Modal title="Allocate across vendors" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="empty"><div className="empty-title">Add vendors first</div>Use “Add vendor &amp; quote” to add vendors with prices, then split quantities here.</div>
    </Modal>
  );

  return (
    <Modal title={`Allocate quantities across vendors — ${src.src_no}`} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save allocation</button></>}>
      <div className="tiny muted mb-2" style={{ padding: 10, background: 'var(--accent-bg)', borderRadius: 4 }}>Split each item's quantity across your quoted vendors. Margin is live (our sell − vendor rate). “Auto-fill cheapest” assigns the remaining quantity to the cheapest vendor. This flows straight into the Vendor POs — no re-entry.</div>
      {comps.map(c => {
        const p = getProduct(c.product_id) || { name: c.product_id, code: c.product_id, sell: 0, buy: 0 };
        const our = p.sell || 0;
        const rows = alloc[c.product_id] || [];
        const remain = c.qty - rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
        return (
          <div className="card mb-2" key={c.product_id}>
            <div className="card-header">
              <div><strong>{p.name}</strong><div className="tiny muted mono">{p.code} · need {c.qty} · our {inr(our)}</div></div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className={`badge ${remain === 0 ? 'success' : remain < 0 ? 'danger' : 'warning'} dot`}>{remain === 0 ? 'balanced' : remain < 0 ? `over ${-remain}` : `${remain} left`}</span>
                {remain > 0 && <button className="btn btn-sm" onClick={() => autoCheapest(c)}>Auto-fill cheapest</button>}
              </div>
            </div>
            <div className="card-body flush"><table className="t">
              <thead><tr><th>Vendor</th><th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Margin</th><th className="num">Line cost</th><th style={{ width: 28 }}></th></tr></thead>
              <tbody>{rows.map((r, ri) => { const q = Number(r.qty) || 0; const rate = Number(r.rate) || 0; const mLine = (our - rate) * q; const mPct = our > 0 ? ((our - rate) / our * 100) : 0; return (
                <tr key={ri}>
                  <td><select className="select" value={r.vendor_id} onChange={e => setRow(c.product_id, ri, { vendor_id: e.target.value, rate: rateOf(e.target.value, p) })} style={{ height: 26, fontSize: 12 }}>{candIds.map(vid => { const v = getVendor(vid); return <option key={vid} value={vid}>{v ? v.name : vid}</option>; })}</select></td>
                  <td className="num"><input type="number" min="0" className="input mono" value={r.qty} onChange={e => setRow(c.product_id, ri, { qty: e.target.value })} style={{ width: 80, textAlign: 'right', height: 26 }}/></td>
                  <td className="num"><input type="number" min="0" className="input mono" value={r.rate} onChange={e => setRow(c.product_id, ri, { rate: e.target.value })} style={{ width: 90, textAlign: 'right', height: 26 }}/></td>
                  <td className="num mono" style={{ color: mLine >= 0 ? 'var(--success)' : 'var(--danger)' }}>{inr(mLine)}<div className="tiny">{pct1(mPct)}</div></td>
                  <td className="num mono">{inr(q * rate)}</td>
                  <td>{rows.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => removeRow(c.product_id, ri)}><Icon name="x" size={11}/></button>}</td>
                </tr>
              ); })}</tbody>
            </table>
            <div style={{ padding: '6px 14px' }}><button className="btn btn-sm" onClick={() => addRow(c.product_id)}><Icon name="plus" size={11}/>Add vendor</button></div>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

window.AllocateVendorsModal = AllocateVendorsModal;
window.SourcingList = SourcingList;
window.SourcingNew = SourcingNew;
window.SourcingDetail = SourcingDetail;
