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
function computeMargin(src, picks, getProduct) {
  const comps = srcComponentList(src);
  const perItem = comps.map(c => {
    const p = getProduct(c.product_id) || { id: c.product_id, name: c.product_id, buy: 0 };
    const vendorId = picks[c.product_id];
    const unit = vendorId ? vendorUnitPrice(vendorId, p) : (p.buy || 0);
    const base = p.buy || 0;
    return {
      product_id: c.product_id, qty: c.qty, vendor_id: vendorId || null,
      unit, lineBuy: unit * c.qty, baseline: base,
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

// ---- list ------------------------------------------------------------------

function SourcingList() {
  const { state, navigate, getCustomer, getUser, currentUser, getProduct } = useStore();
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canCreate = ['Sales', 'Pre-sales', 'Org Admin'].includes(role);
  const rows = state.sourcings || [];

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
                  Sales floats an inquiry here; Purchase compares vendors and returns a margin; then you raise the Sales Order.
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
  const updateComp = (lid, pid, patch) => setLines(ls => ls.map(l => l.id !== lid ? l : {
    ...l, components: l.components.map(c => c.product_id !== pid ? c : { ...c, ...patch, override: patch.qty !== undefined ? patch.qty !== c.original_qty : c.override }),
  }));
  const addComp = (lid, pid) => setLines(ls => ls.map(l => l.id !== lid ? l : { ...l, components: [...l.components, { product_id: pid, qty: 1, override: true, original_qty: 0 }] }));
  const removeComp = (lid, pid) => setLines(ls => ls.map(l => l.id !== lid ? l : { ...l, components: l.components.filter(c => c.product_id !== pid) }));

  const cust = customer ? getCustomer(customer) : null;
  const sell = lines.reduce((s, l) => s + l.bundle_qty * l.unit_price, 0);
  const canSubmit = customer && lines.length > 0;

  const submit = () => {
    if (!canSubmit) { toast('Pick a customer and add at least one bundle'); return; }
    const src = {
      id: 'src-' + Date.now(),
      src_no: `INQ/FY26/${String(1 + (state.sourcings || []).length).padStart(4, '0')}`,
      customer_id: customer, ref: ref || null, date: TODAY, status: 'Sent to Purchase',
      client_req_price: clientReqPrice === '' ? null : Number(clientReqPrice),
      our_price: ourPrice === '' ? null : Number(ourPrice),
      notes: notes || null, created_by: currentUser || null,
      lines, picks: {}, prices: {}, margin: {}, converted_so_id: null,
    };
    mutate(s => ({
      ...s,
      sourcings: [src, ...(s.sourcings || [])],
      notifications: [{ id: 'n-src-' + Date.now(), kind: 'sourcing', text: `${src.src_no} sent to Purchase for vendor sourcing · ${cust.name}`, date: TODAY, read: false, role: 'Purchase' }, ...s.notifications],
    }), { action: 'create', entity: 'Sourcing', entity_id: src.id });
    toast(`${src.src_no} sent to Purchase`, 'success');
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
          <div className="page-sub">Float the customer's requirement to Purchase for vendor costing — no commitment yet</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate('sourcing')}>Cancel</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>Send to Purchase <Icon name="arrowRight" size={13}/></button>
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
                  <div className="field-hint">Shown to Purchase as the client's target</div>
                </div>
                <div className="field">
                  <label className="field-label">Our price</label>
                  <input type="number" min="0" className="input mono" placeholder="our intended quote (optional)" value={ourPrice} onChange={e => setOurPrice(e.target.value)}/>
                  <div className="field-hint">If set, Purchase uses this as the quote budget (else the indicative total)</div>
                </div>
              </div>
            </div>
          </div>

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
                    <th style={{ width: 22 }}></th><th>Bundle</th><th className="num">Qty</th><th className="num">Unit sell ₹</th><th className="num">Line ₹</th><th style={{ width: 28 }}></th>
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
                            <td className="num"><input type="number" className="input mono" value={l.unit_price} onChange={e => updateLine(l.id, { unit_price: parseInt(e.target.value) || 0 })} style={{ width: 100, textAlign: 'right' }}/></td>
                            <td className="num"><strong>{inr(l.bundle_qty * l.unit_price)}</strong></td>
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
                                    <td className="num"><input type="number" className="input mono" min="0" value={c.qty} onChange={e => updateComp(l.id, c.product_id, { qty: parseInt(e.target.value) || 0 })} style={{ width: 64, textAlign: 'right', height: 24 }}/>{c.override && <div className="tiny" style={{ color: 'var(--warning)' }}>was {c.original_qty}</div>}</td>
                                    <td colSpan="2" className="num small muted">baseline @ {inr(p.buy || 0)}</td>
                                    <td><button className="btn btn-ghost btn-sm" onClick={() => removeComp(l.id, c.product_id)}><Icon name="x" size={11}/></button></td>
                                  </tr>
                                );
                              })}
                              <tr className="subrow">
                                <td></td>
                                <td colSpan="5" style={{ padding: '6px 0 12px' }}>
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

          <div className="card">
            <div className="form-section">
              <div className="form-section-title">Notes for Purchase</div>
              <textarea className="textarea" placeholder="Anything Purchase should know (target price, deadline, preferred vendor…)" value={notes} onChange={e => setNotes(e.target.value)}/>
            </div>
          </div>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Indicative quote</h3></div>
            <div className="card-body">
              <div className="dl">
                <dt>Bundles</dt><dd className="num mono right">{lines.length}</dd>
                <dt>Indicative sell value</dt><dd className="num mono right">{inr(sell)}</dd>
                {clientReqPrice !== '' && <><dt>Client's req price</dt><dd className="num mono right">{inr(Number(clientReqPrice))}</dd></>}
                {ourPrice !== '' && <><dt>Our price (budget)</dt><dd className="num mono right"><strong>{inr(Number(ourPrice))}</strong></dd></>}
              </div>
              <div className="tiny muted mt-2">Purchase sees the quote budget ({ourPrice !== '' ? 'your "our price"' : 'the indicative total'}) and sources each component from vendors to hit a good margin. Nothing is committed until you raise the Sales Order.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- detail: vendor comparison + margin match (Purchase) + convert (Sales) --

function SourcingDetail({ srcId }) {
  const { state, navigate, mutate, getCustomer, getProduct, getCategory, getVendor, getUser, currentUser } = useStore();
  const toast = useToast();
  const src = (state.sourcings || []).find(x => x.id === srcId);
  const role = currentUser ? getUser(currentUser)?.role : '';
  const canSource = ['Purchase', 'Org Admin'].includes(role);
  const canConvert = ['Sales', 'Pre-sales', 'Org Admin'].includes(role);
  const [showConvert, setShowConvert] = React.useState(false);

  const comps = src ? srcComponentList(src) : [];
  // Local vendor picks — default to the previously-saved picks, else the
  // cheapest vendor per item.
  const [picks, setPicks] = React.useState(() => {
    if (!src) return {};
    const init = { ...(src.picks || {}) };
    srcComponentList(src).forEach(c => {
      if (!init[c.product_id]) {
        const p = getProduct(c.product_id);
        if (p) { const sug = vendorSuggestions(p, state.vendors); if (sug[0]) init[c.product_id] = sug[0].vendor.id; }
      }
    });
    return init;
  });

  if (!src) return <div className="page"><div className="empty"><div className="empty-title">Inquiry not found</div><button className="btn mt-2" onClick={() => navigate('sourcing')}>← Back</button></div></div>;

  const cust = getCustomer(src.customer_id);
  const margin = computeMargin(src, picks, getProduct);
  const locked = src.status === 'Converted';

  const persist = (patch, audit, msg) => {
    mutate(s => ({ ...s, sourcings: (s.sourcings || []).map(x => x.id === src.id ? { ...x, ...patch } : x) }), audit);
    if (msg) toast(msg, 'success');
  };

  const buildPrices = () => {
    const out = {};
    comps.forEach(c => {
      const p = getProduct(c.product_id); if (!p) return;
      out[c.product_id] = {};
      state.vendors.forEach(v => { out[c.product_id][v.id] = vendorUnitPrice(v.id, p); });
    });
    return out;
  };

  const saveQuotation = () => {
    persist({ picks, prices: buildPrices(), margin, status: src.status === 'Sent to Purchase' ? 'Sourced' : src.status },
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
          {canSource && !locked && <button className="btn" onClick={saveQuotation}><Icon name="save" size={13}/>Save vendor quotation</button>}
          {canSource && !locked && <button className="btn btn-primary" onClick={sendToSales}><Icon name="mail" size={13}/>Send to Sales</button>}
          {canConvert && !locked && (src.status === 'Sent to Sales' || src.status === 'Sourced') && (
            <button className="btn btn-primary" onClick={() => setShowConvert(true)}><Icon name="receipt" size={13}/>Create Sales Order</button>
          )}
          {src.converted_so_id && <button className="btn" onClick={() => navigate(`sales-orders/${src.converted_so_id}`)}><Icon name="arrowRight" size={13}/>View Sales Order</button>}
        </div>
      </div>

      {/* Margin match — Customer sell ⟷ Vendor buy ⟷ Margin */}
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

      {/* Per-item vendor comparison */}
      <div className="card mb-2">
        <div className="card-header">
          <h3 className="card-title">Vendor comparison — per item</h3>
          <div className="tiny muted">Suggested by best price · benefit % vs our baseline cost</div>
        </div>
        <div className="card-body flush">
          <table className="t">
            <thead><tr>
              <th>Item</th><th className="num">Req qty</th><th>Vendor options (cheapest first)</th><th className="num">Chosen</th><th className="num">Line cost</th>
            </tr></thead>
            <tbody>
              {comps.map(c => {
                const p = getProduct(c.product_id) || { id: c.product_id, name: c.product_id, code: c.product_id, buy: 0 };
                const sugg = vendorSuggestions(p, state.vendors);
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
    </div>
  );
}

// ---- convert inquiry → Sales Order (one click) -----------------------------

function ConvertToSOModal({ src, margin, onClose }) {
  const { state, mutate, navigate, getCustomer, currentUser } = useStore();
  const toast = useToast();
  const cust = getCustomer(src.customer_id);
  const [poRef, setPoRef] = React.useState('');
  const [expected, setExpected] = React.useState(() => { const d = new Date(TODAY); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); });
  const [priority, setPriority] = React.useState('Standard');

  const create = () => {
    if (!poRef.trim()) { toast('Customer PO reference is required (the SO unique id)'); return; }
    // Deep-copy lines with fresh ids so the SO is independent of the inquiry.
    const lines = JSON.parse(JSON.stringify(src.lines || [])).map(l => ({ ...l, id: 'l' + Date.now() + Math.random().toString(36).slice(2, 5) }));
    const newSO = {
      id: 'so-' + Date.now(),
      so_no: `SO/FY26/${String(17 + state.sales_orders.length).padStart(4, '0')}`,
      customer_id: src.customer_id, customer_po: poRef.trim(), date: TODAY, expected,
      priority, order_type: 'Supply', pm: '', ship_to: cust ? cust.address : '',
      payment_terms: cust ? cust.terms : 'Net 30', status: 'Pending Approval',
      lines, notes: src.notes || `Raised from inquiry ${src.src_no} · expected margin ${pct1(margin.marginPct)}`, extra: {},
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
      <div className="field">
        <label className="field-label">Customer PO Reference (UID) *</label>
        <input className="input mono" placeholder="e.g. RC/PO/2026/0312" value={poRef} onChange={e => setPoRef(e.target.value)} autoFocus/>
        <div className="field-hint">The Sales Order's unique identifier — never auto-generated</div>
      </div>
      <div className="field-row mt-2">
        <div className="field">
          <label className="field-label">Expected delivery</label>
          <input type="date" className="input mono" value={expected} onChange={e => setExpected(e.target.value)}/>
        </div>
        <div className="field">
          <label className="field-label">Priority</label>
          <select className="select" value={priority} onChange={e => setPriority(e.target.value)}>
            <option>Standard</option><option>Urgent</option><option>Critical</option>
          </select>
        </div>
      </div>
      <div className="tiny muted mt-2">Prefer to start fresh? Close this and use <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { onClose(); navigate('sales-orders/new'); }}>New Sales Order</a> instead.</div>
    </Modal>
  );
}

window.SourcingList = SourcingList;
window.SourcingNew = SourcingNew;
window.SourcingDetail = SourcingDetail;
