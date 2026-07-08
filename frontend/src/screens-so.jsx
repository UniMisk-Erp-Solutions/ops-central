// OP Central — Sales Order screens (list, create, detail with timeline)

function SalesOrdersList() {
  const { state, navigate, getCustomer, getUser, currentUser, soSubtotal } = useStore();
  const role = getUser(currentUser).role;
  const allowCreate = canDo(role, 'createSO') || role === 'Org Admin';
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');

  // A Supervisor only ever sees the SOs whose implementation is assigned to them.
  const visibleSOs = role === 'Supervisor'
    ? state.sales_orders.filter(s => s.extra && s.extra.implementation && s.extra.implementation.supervisor_id === currentUser)
    : state.sales_orders;
  const filtered = visibleSOs.filter(s => {
    if (filter === 'open' && ['Closed','Fully Paid','Cancelled'].includes(s.status)) return false;
    if (filter === 'hold' && !s.on_hold) return false;
    if (filter === 'overdue' && !(s.days_overdue > 0)) return false;
    if (filter === 'closed' && !['Closed','Fully Paid'].includes(s.status)) return false;
    if (search) {
      const cust = getCustomer(s.customer_id);
      const blob = `${s.so_no} ${s.customer_po} ${cust.name}`.toLowerCase();
      if (!blob.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const tabs = [
    { id: 'all', label: 'All', count: visibleSOs.length },
    { id: 'open', label: 'Open', count: visibleSOs.filter(s => !['Closed','Fully Paid','Cancelled'].includes(s.status)).length },
    { id: 'hold', label: 'On Hold', count: visibleSOs.filter(s => s.on_hold).length },
    { id: 'overdue', label: 'Overdue', count: visibleSOs.filter(s => s.days_overdue > 0).length },
    { id: 'closed', label: 'Closed', count: visibleSOs.filter(s => ['Closed','Fully Paid'].includes(s.status)).length },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales Orders</h1>
          <div className="page-sub">{state.sales_orders.length} orders · FY {state.org.fiscal_year}</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="filter" size={13}/>Filter</button>
          <button className="btn"><Icon name="download" size={13}/>Export</button>
          {allowCreate && (
            <button className="btn btn-primary" onClick={() => navigate('sales-orders/new')}>
              <Icon name="plus" size={13}/>New Sales Order
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="tabs">
          {tabs.map(t => (
            <button key={t.id} className={`tab ${filter === t.id ? 'active' : ''}`} onClick={() => setFilter(t.id)}>
              {t.label}<span className="count mono">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="filter-bar">
          <input className="input search" placeholder="Search SO no, PO ref, customer…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: '0 0 220px' }}/>
          <select className="select" style={{ width: 130 }}>
            <option>All PMs</option>
            {state.users.filter(u => u.role === 'Project Manager').map(u => <option key={u.id}>{u.name}</option>)}
          </select>
          <select className="select" style={{ width: 130 }}>
            <option>All priorities</option>
            <option>Standard</option><option>Urgent</option><option>Critical</option>
          </select>
          <div className="grow"/>
          <span className="muted small">{filtered.length} shown</span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>SO No</th>
                <th>Customer · PO Ref</th>
                <th>PM</th>
                <th>Pri.</th>
                <th>Status</th>
                <th className="num">Value</th>
                <th>Order Date</th>
                <th>Expected</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(so => {
                const cust = getCustomer(so.customer_id);
                const pm = getUser(so.pm);
                return (
                  <tr key={so.id} onClick={() => navigate(`sales-orders/${so.id}`)} style={{ cursor: 'pointer' }}>
                    <td><a className="mono">{so.so_no}</a></td>
                    <td>
                      <div>{cust.name}</div>
                      <div className="tiny muted mono">PO: {so.customer_po}</div>
                    </td>
                    <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={pm} size={20}/><span className="small">{pm ? pm.name.split(' ')[0] : '—'}</span></div></td>
                    <td><PriorityBadge priority={so.priority}/></td>
                    <td><StatusBadge status={so.status}/>{so.on_hold && <span className="badge dot status-hold" style={{ marginLeft: 4 }}>Hold</span>}</td>
                    <td className="num">{inr(soSubtotal(so))}</td>
                    <td className="mono small">{fmtDate(so.date)}</td>
                    <td className="mono small">{fmtDate(so.expected)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); navigate(`sales-orders/${so.id}`); }}>
                          <Icon name="eye" size={12}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan="9"><div className="empty">No orders match</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===== SO Create =====
// Algorithm 2 — smart Master-Surplus-Pool reuse engine. Suggests pool items that
// are RELEVANT to this order (i.e. the product is part of the SO's BOM) and in
// stock, sized to what's needed, FIFO by receipt date. Irrelevant pool stock is
// never shown for this SO.
function poolSuggestionsForSO(state, lines, getProduct) {
  const need = {};
  (lines || []).forEach(l => (l.components || []).forEach(c => { need[c.product_id] = (need[c.product_id] || 0) + (c.qty || 0) * (l.bundle_qty || 1); }));
  const byProd = {};
  (state.pool || []).forEach(p => {
    const b = (byProd[p.product_id] = byProd[p.product_id] || { qty: 0, srcs: [] });
    b.qty += Number(p.qty) || 0; b.srcs.push({ id: p.id, qty: Number(p.qty) || 0, source_so: p.source_so, date: p.received_date });
  });
  const out = [];
  Object.keys(need).forEach(pid => {
    const pool = byProd[pid];
    if (pool && pool.qty > 0 && need[pid] > 0) {
      pool.srcs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));   // FIFO
      out.push({ product_id: pid, product: getProduct(pid), needed: need[pid], available: pool.qty, suggestUse: Math.min(need[pid], pool.qty), srcs: pool.srcs });
    }
  });
  out.sort((a, b) => (b.suggestUse * ((b.product && b.product.buy) || 0)) - (a.suggestUse * ((a.product && a.product.buy) || 0)));
  return out;
}

function SalesOrderNew() {
  const { state, navigate, mutate, getCustomer, getProduct, getCategory, consumeFromPool } = useStore();
  const toast = useToast();

  const [customer, setCustomer] = React.useState('');
  const [poRef, setPoRef] = React.useState('');
  const [date, setDate] = React.useState(TODAY);
  const [expected, setExpected] = React.useState(() => {
    const d = new Date(TODAY); d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [priority, setPriority] = React.useState('Standard');
  const [orderType, setOrderType] = React.useState('Supply');
  const [paymentTerms, setPaymentTerms] = React.useState('Net 30');
  const [pm, setPm] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState([]);
  const [expandedLines, setExpandedLines] = React.useState({});
  const [poolUse, setPoolUse] = React.useState({});   // product_id -> qty to reuse from pool

  // Admin-defined custom SO fields (Customisation → Sales Order form).
  const customFields = (state.config.so_form_fields || []).filter(f => f.custom);
  const [extra, setExtra] = React.useState({});
  const setExtraVal = (k, v) => setExtra(prev => ({ ...prev, [k]: v }));

  // Billing patterns enabled by the admin (Customisation → Billing patterns).
  const enabledPatterns = (state.config.billing_patterns || []).filter(p => p.on !== false).map(p => p.t);
  const [billingPattern, setBillingPattern] = React.useState('');

  const cust = customer ? getCustomer(customer) : null;
  const orgState = state.org.state;
  const sameState = cust && cust.state === orgState;
  const customerOverdue = cust ? state.sales_orders.filter(s => s.customer_id === cust.id && s.days_overdue > 0).reduce((sum, s) => sum + (s.invoice_amount || 0), 0) : 0;

  React.useEffect(() => {
    if (cust) {
      setPaymentTerms(cust.terms);
    }
  }, [cust]);

  const [catSearch, setCatSearch] = React.useState('');
  // 1-to-1 mapping: match the typed client term against category name + aliases.
  const catResults = catSearch.trim() ? state.categories.map(c => {
    const q = catSearch.trim().toLowerCase();
    const nameHit = c.name.toLowerCase().includes(q);
    const aliasHit = (c.aliases || []).find(a => a.toLowerCase().includes(q));
    return (nameHit || aliasHit) ? { ...c, _aliasHit: nameHit ? null : aliasHit } : null;
  }).filter(Boolean).slice(0, 8) : [];

  const addLine = (categoryId, clientName) => {
    const cat = getCategory(categoryId);
    const bom = state.boms[categoryId] || [];
    // Default unit price = sum of components default sell price
    const defaultPrice = bom.reduce((sum, c) => {
      const p = getProduct(c.product_id);
      return sum + p.sell * c.qty;
    }, 0);
    const newLine = {
      id: 'l' + Date.now() + Math.random().toString(36).slice(2,5),
      category_id: categoryId,
      client_name: (clientName || '').trim(),   // the name the client gave (maps 1:1 to this bundle)
      bundle_qty: 1,
      unit_price: defaultPrice,
      components: bom.map(c => ({ product_id: c.product_id, qty: c.qty, override: false, original_qty: c.qty })),
    };
    setLines([...lines, newLine]);
    setExpandedLines({ ...expandedLines, [newLine.id]: true });
  };

  const updateLine = (id, patch) => setLines(lines.map(l => l.id === id ? { ...l, ...patch } : l));
  const removeLine = (id) => setLines(lines.filter(l => l.id !== id));

  // Per-bundle sell price derived from the components (qty × product sell).
  const compSell = (components) => components.reduce((s, c) => { const p = getProduct(c.product_id); return s + (p ? p.sell : 0) * (c.qty || 0); }, 0);
  // Rebuild a line with new components AND its recomputed unit price → totals live.
  const withComps = (l, components) => ({ ...l, components, unit_price: compSell(components) });

  const updateComponent = (lineId, prodId, patch) => {
    setLines(lines.map(l => l.id !== lineId ? l : withComps(l,
      l.components.map(c => c.product_id !== prodId ? c : { ...c, ...patch, override: patch.qty !== undefined ? patch.qty !== c.original_qty : c.override }))));
  };

  const addComponent = (lineId, prodId) => {
    setLines(lines.map(l => l.id !== lineId ? l : withComps(l,
      [...l.components, { product_id: prodId, qty: 1, override: true, original_qty: 0 }])));
  };

  const removeComponent = (lineId, prodId) => {
    setLines(lines.map(l => l.id !== lineId ? l : withComps(l,
      l.components.filter(c => c.product_id !== prodId))));
  };

  const subtotal = lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0);
  const taxableValue = subtotal; // simplification
  const cgst = sameState ? taxableValue * 0.09 : 0;
  const sgst = sameState ? taxableValue * 0.09 : 0;
  const igst = sameState ? 0 : taxableValue * 0.18;
  const grandTotal = taxableValue + cgst + sgst + igst;

  const customOk = customFields.every(f => !f.required || (extra[f.key] !== undefined && extra[f.key] !== ''));
  const canSubmit = customer && poRef && lines.length > 0 && customOk;

  // Pool reuse is now handled in the Virtual Godown (Purchase adds from the
  // Master Pool there, with smart suggestions), so the New SO no longer
  // auto-allocates pool stock at creation.
  const poolSugg = [];
  const useQtyFor = (s) => Math.max(0, Math.min(poolUse[s.product_id] != null ? Number(poolUse[s.product_id]) : s.suggestUse, s.needed, s.available));
  const poolSavings = poolSugg.reduce((sum, s) => sum + useQtyFor(s) * ((s.product && s.product.buy) || 0), 0);

  const handleSubmit = async () => {
    // Build pool allocations + FIFO consume list from the chosen reuse quantities.
    const pool_alloc = []; const consume = [];
    poolSugg.forEach(s => {
      let q = useQtyFor(s);
      if (q <= 0) return;
      pool_alloc.push({ product_id: s.product_id, qty: q, name: s.product ? s.product.name : s.product_id });
      for (const src of s.srcs) { if (q <= 0) break; const take = Math.min(q, src.qty); if (take > 0) { consume.push({ id: src.id, qty: take }); q -= take; } }
    });
    const newSO = {
      id: 'so-' + Date.now(),
      so_no: `SO/FY26/${String(17 + state.sales_orders.length).padStart(4, '0')}`,
      customer_id: customer, customer_po: poRef, date, expected, priority, order_type: orderType,
      pm, ship_to: cust.address, payment_terms: paymentTerms, status: 'Pending Approval',
      lines, notes, extra: billingPattern ? { ...extra, billing_pattern: billingPattern } : extra, pool_alloc,
    };
    mutate(s => ({
      ...s,
      sales_orders: [newSO, ...s.sales_orders],
      notifications: [
        { id: 'n-so-' + Date.now(), kind: 'so', text: `${newSO.so_no} submitted for approval by Sales · ${cust.name}${pool_alloc.length ? ` · ${pool_alloc.length} item(s) reused from Master Pool` : ''}`, date: TODAY, read: false, role: 'Project Manager' },
        ...s.notifications,
      ],
    }), {
      action: 'create', entity: 'SalesOrder', entity_id: newSO.id, user_id: 'u-sales',
    });
    if (consume.length) await consumeFromPool(consume);   // decrement pool so the same stock isn't reused twice
    toast(`${newSO.so_no} submitted · awaiting PM approval${pool_alloc.length ? ' · pool stock allocated' : ''}`, 'success');
    navigate(`sales-orders/${newSO.id}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('sales-orders')}>
            <Icon name="chevronLeft" size={12}/> Sales Orders
          </div>
          <h1 className="page-title">New Sales Order</h1>
          <div className="page-sub">Customer PO is the unique identifier — never auto-generated</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate('sales-orders')}>Cancel</button>
          <button className="btn" disabled={!canSubmit}>Save as Draft</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
            Submit for Approval <Icon name="arrowRight" size={13}/>
          </button>
        </div>
      </div>

      {cust && customerOverdue > 0 && (
        <div className="mb-2" style={{
          padding: '8px 12px', background: 'var(--danger-bg)', border: '1px solid oklch(0.86 0.08 25)',
          borderRadius: 'var(--radius)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5
        }}>
          <Icon name="alert" size={14} color="var(--danger)"/>
          <span><strong>{inr(customerOverdue)} outstanding</strong> · oldest invoice 33 days overdue. New order allowed but may require MD approval.</span>
        </div>
      )}

      <div className="split-2to1">
        <div className="stack">
          <div className="card">
            <div className="form-section">
              <div className="form-section-title">Customer & Order</div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Customer *</label>
                  <select className="select" value={customer} onChange={e => setCustomer(e.target.value)}>
                    <option value="">Select customer…</option>
                    {state.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {cust && <div className="tiny muted mt-1"><span className="mono">{cust.gstin}</span> · {cust.state} · {cust.terms}</div>}
                </div>
                <div className="field">
                  <label className="field-label">Customer PO Reference (UID) *</label>
                  <input className="input mono" placeholder="e.g. RC/PO/2026/0312" value={poRef} onChange={e => setPoRef(e.target.value)}/>
                  <div className="field-hint">Manually entered · never auto-generated</div>
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
                    {state.users.filter(u => u.role === 'Project Manager').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              {enabledPatterns.length > 0 && (
                <div className="field mt-2">
                  <label className="field-label">Billing pattern</label>
                  <select className="select" value={billingPattern} onChange={e => setBillingPattern(e.target.value)}>
                    <option value="">Default (Lumpsum on delivery)</option>
                    {enabledPatterns.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div className="field-hint">Only patterns enabled in Customisation → Billing patterns are shown.</div>
                </div>
              )}
              {cust && (
                <div className="field mt-2">
                  <label className="field-label">Ship-to address</label>
                  <textarea className="textarea" rows="2" defaultValue={cust.address}/>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Line Items</h3>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <input className="input" style={{ width: 250, height: 28, fontSize: 12.5 }}
                    placeholder="Type the client's item name… e.g. rack server"
                    value={catSearch} onChange={e => setCatSearch(e.target.value)}/>
                  {catSearch.trim() && (
                    <div style={{ position: 'absolute', zIndex: 30, top: 31, left: 0, width: 300, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,.12)', maxHeight: 260, overflow: 'auto' }}>
                      {catResults.length === 0 ? <div className="tiny muted" style={{ padding: 10 }}>No matching item. Try another name.</div> : catResults.map(c => (
                        <div key={c.id} className="queue-item" style={{ cursor: 'pointer' }} onClick={() => { addLine(c.id, catSearch.trim()); setCatSearch(''); }}>
                          <div className="grow"><div className="small"><strong>{c.name}</strong></div><div className="tiny muted">{c._aliasHit ? `matched alias "${c._aliasHit}"` : 'matched name'} · {(state.boms[c.id] || []).length} components</div></div>
                          <Icon name="plus" size={12}/>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <select className="select" style={{ width: 170, height: 28, fontSize: 12 }}
                        value=""
                        onChange={e => { if (e.target.value) addLine(e.target.value); e.target.value = ''; }}>
                  <option value="">or browse…</option>
                  {state.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="card-body flush">
              {lines.length === 0 ? (
                <div className="empty">
                  <div className="empty-title">No lines yet</div>
                  Type the client's item name above (e.g. "rack server") — it maps 1-to-1 to the internal bundle and its BOM auto-loads. You can override quantities per component.
                </div>
              ) : (
                <table className="t">
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th>
                      <th>Category · Bundle</th>
                      <th className="num">Bundle Qty</th>
                      <th className="num">Unit Price</th>
                      <th className="num">GST %</th>
                      <th className="num">Line Total</th>
                      <th style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => {
                      const cat = getCategory(l.category_id);
                      const expanded = expandedLines[l.id];
                      return (
                        <Fragment key={l.id}>
                          <tr>
                            <td style={{ cursor: 'pointer' }} onClick={() => setExpandedLines({ ...expandedLines, [l.id]: !expanded })}>
                              <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12}/>
                            </td>
                            <td>
                              <input className="input" value={l.client_name || ''} onChange={e => updateLine(l.id, { client_name: e.target.value })} placeholder="Client's name for this item" style={{ height: 24, fontSize: 12.5, fontWeight: 500, marginBottom: 3, width: 220 }}/>
                              <div className="tiny muted">Maps to <strong>{cat.name}</strong> · HSN <span className="mono">{cat.hsn}</span> · {l.components.length} components</div>
                            </td>
                            <td className="num">
                              <input type="number" className="input mono" min="1" value={l.bundle_qty}
                                     onChange={e => updateLine(l.id, { bundle_qty: parseInt(e.target.value) || 1 })}
                                     style={{ width: 70, textAlign: 'right' }}/>
                            </td>
                            <td className="num">
                              <input type="number" className="input mono" value={l.unit_price}
                                     onChange={e => updateLine(l.id, { unit_price: parseInt(e.target.value) || 0 })}
                                     style={{ width: 110, textAlign: 'right' }}/>
                            </td>
                            <td className="num">{cat.gst}%</td>
                            <td className="num"><strong>{inr(l.bundle_qty * l.unit_price)}</strong></td>
                            <td>
                              <button className="btn btn-ghost btn-sm" onClick={() => removeLine(l.id)}>
                                <Icon name="trash" size={12} color="var(--danger)"/>
                              </button>
                            </td>
                          </tr>
                          {expanded && (
                            <>
                              <tr className="subrow">
                                <td></td>
                                <td colSpan="6" className="tiny" style={{ paddingTop: 12, color: 'var(--text-3)' }}>
                                  <strong style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-2)' }}>Bill of Materials</strong> — internal · hidden from customer invoice
                                </td>
                              </tr>
                              {l.components.map(c => {
                                const p = getProduct(c.product_id);
                                return (
                                  <tr key={c.product_id} className="subrow">
                                    <td></td>
                                    <td>
                                      <div style={{ fontSize: 12 }}>{p.name}</div>
                                      <div className="tiny muted mono">{p.code}</div>
                                    </td>
                                    <td className="num">
                                      <input type="number" className="input mono" value={Math.round((c.qty || 0) * (l.bundle_qty || 1))} min="0"
                                             onChange={e => { const t = parseInt(e.target.value) || 0; const b = l.bundle_qty || 1; updateComponent(l.id, c.product_id, { qty: t / b }); }}
                                             style={{ width: 80, textAlign: 'right', height: 24 }}/>
                                      {l.bundle_qty > 1 && <div className="tiny muted">{(c.qty || 0)}/bundle</div>}
                                      {c.override && <div className="tiny" style={{ color: 'var(--warning)' }}>was {Math.round((c.original_qty || 0) * (l.bundle_qty || 1))}</div>}
                                    </td>
                                    <td className="num small muted">@ {inr(p.buy)}</td>
                                    <td></td>
                                    <td className="num small muted">{inr(p.buy * c.qty * l.bundle_qty)}</td>
                                    <td>
                                      <button className="btn btn-ghost btn-sm" onClick={() => removeComponent(l.id, c.product_id)}>
                                        <Icon name="x" size={11}/>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                              <tr className="subrow">
                                <td></td>
                                <td colSpan="6" style={{ padding: '6px 28px 12px' }}>
                                  <select className="select" defaultValue="" onChange={e => { if (e.target.value) { addComponent(l.id, e.target.value); e.target.value = ''; }}}
                                          style={{ width: 220, height: 24, fontSize: 11.5 }}>
                                    <option value="">+ Add component…</option>
                                    {state.products.filter(p => !l.components.find(c => c.product_id === p.id))
                                      .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
              <div className="form-section-title">Notes</div>
              <textarea className="textarea" placeholder="Internal notes, dispatch instructions, etc." value={notes} onChange={e => setNotes(e.target.value)}/>
            </div>
          </div>

          {customFields.length > 0 && (
            <div className="card">
              <div className="form-section">
                <div className="form-section-title">Additional details</div>
                <div className="field-row-3">
                  {customFields.map(f => (
                    <div className="field" key={f.key}>
                      <label className="field-label">{f.label}{f.required ? ' *' : ''}</label>
                      {f.type === 'textarea' ? (
                        <textarea className="textarea" value={extra[f.key] || ''} onChange={e => setExtraVal(f.key, e.target.value)}/>
                      ) : f.type === 'select' ? (
                        <select className="select" value={extra[f.key] || ''} onChange={e => setExtraVal(f.key, e.target.value)}>
                          <option value="">Select…</option>
                          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                               value={extra[f.key] || ''} onChange={e => setExtraVal(f.key, e.target.value)}/>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="stack" style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Totals</h3>
            </div>
            <div className="card-body">
              <div className="dl">
                <dt>Subtotal</dt><dd className="num mono right">{inr(subtotal)}</dd>
                <dt>Discount</dt><dd className="num mono right">₹0</dd>
                <dt>Taxable value</dt><dd className="num mono right">{inr(taxableValue)}</dd>
                {sameState ? (
                  <>
                    <dt>CGST 9%</dt><dd className="num mono right">{inr(cgst)}</dd>
                    <dt>SGST 9%</dt><dd className="num mono right">{inr(sgst)}</dd>
                  </>
                ) : (
                  <><dt>IGST 18%</dt><dd className="num mono right">{inr(igst)}</dd></>
                )}
                <dt>Round-off</dt><dd className="num mono right">₹0</dd>
              </div>
              <div className="divider"/>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 14 }}>
                <span>Grand Total</span>
                <span className="num mono">{inr(grandTotal)}</span>
              </div>
              {cust && (
                <div className="tiny muted mt-2">
                  Place of supply: <strong>{cust.state}</strong> · {sameState ? 'Intra-state · CGST+SGST' : 'Inter-state · IGST'}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Approval Flow</h3>
            </div>
            <div className="card-body">
              <div className="timeline">
                <div className="timeline-step done">
                  <div className="timeline-dot"/>
                  <div className="grow">
                    <div className="timeline-label">Sales submits</div>
                    <div className="timeline-meta">Karan Mehra · now</div>
                  </div>
                </div>
                <div className="timeline-step current">
                  <div className="timeline-dot"/>
                  <div className="grow">
                    <div className="timeline-label">PM approval</div>
                    <div className="timeline-meta">Ravi I · auto-routed</div>
                  </div>
                </div>
                {customerOverdue > 100000 && (
                  <div className="timeline-step">
                    <div className="timeline-dot"/>
                    <div className="grow">
                      <div className="timeline-label">MD approval (customer overdue)</div>
                      <div className="timeline-meta">Mukesh D</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== SO Detail =====
function SalesOrderDetail({ soId }) {
  const { state, navigate, mutate, getSO, getCustomer, getUser, getCategory, getProduct, soSubtotal, soBillAdjustment, soBilledSubtotal, currentUser } = useStore();
  const toast = useToast();
  const so = getSO(soId);
  const [tab, setTab] = React.useState('overview');
  const [showHold, setShowHold] = React.useState(false);
  const [showSource, setShowSource] = React.useState(false);
  const [showEdit, setShowEdit] = React.useState(false);
  const role = currentUser ? getUser(currentUser).role : '';
  const canApprove = canDo(role, 'approveSO') || role === 'Org Admin' || role === 'Managing Director';
  const canAdvance = canApprove || canDo(role, 'authDispatch');

  if (!so) return (
    <div className="page">
      <div className="empty">
        <div className="empty-title">Sales Order not found</div>
        <button className="btn mt-2" onClick={() => navigate('sales-orders')}>← Back to list</button>
      </div>
    </div>
  );

  const cust = getCustomer(so.customer_id);
  const pm = getUser(so.pm);
  const orderedSubtotal = soSubtotal(so);
  const billAdj = soBillAdjustment(so);
  const subtotal = soBilledSubtotal(so);   // billed = ordered − items removed at GRN
  const grand = subtotal * 1.18;

  const linkedPOs = state.vendor_pos.filter(p => p.so_id === so.id);
  const sameState = cust.state === state.org.state;

  // Components received into this SO via approved cross-SO transfers (fulfilment,
  // not billing — customer invoice stays as ordered).
  const transferredIn = {};
  (state.transfer_requests || []).filter(t => t.status === 'Approved' && t.to_so === so.id)
    .forEach(t => (t.items || []).forEach(it => { transferredIn[it.product_id] = (transferredIn[it.product_id] || 0) + (it.qty || 0); }));

  // Status-aware notifications
  const NOTIF_ON_TRANSITION = {
    'Approved': { role: 'Purchase', text: `${so.so_no} approved · ready to procure` },
    'Procurement Started': { role: 'Purchase', text: `${so.so_no} procurement started` },
    'Material Received': { role: 'Project Manager', text: `${so.so_no} material received · authorize dispatch` },
    'Ready to Dispatch': { role: 'Billing', text: `${so.so_no} ready · raise invoice` },
    'Invoiced': { role: 'Collections', text: `${so.so_no} invoiced · monitor payment` },
    'Payment Pending': { role: 'Collections', text: `${so.so_no} payment due` },
    'Fully Paid': { role: 'Project Manager', text: `${so.so_no} paid · close & reconcile surplus` },
  };

  // Next-action engine — what THIS role can do at THIS status
  const NEXT_ACTION = {
    'Pending Approval': { roles: ['Project Manager','Managing Director','Org Admin'], label: 'Approve SO', icon: 'check', next: 'Approved', kind: 'success', notify: { role: 'Purchase', text: `${so.so_no} approved · float RFQ to vendors` }, detail: 'Verify customer, line items and pricing. On approval the order moves to Purchase for RFQ.' },
    'Approved': { roles: ['Purchase','Org Admin'], label: 'Start Procurement', icon: 'cart', next: 'Procurement Started', notify: { role: 'Purchase', text: `${so.so_no} procurement in progress` }, detail: 'Open the Procurement tab to raise Vendor PO(s) for the vendors selected during the inquiry — no RFQ needed. (Non-sourced orders can still float an RFQ.)' },
    'Procurement Started': { roles: ['Purchase','Stores','Org Admin'], label: 'Mark Material Received', icon: 'package', next: 'Material Received', notify: { role: 'Project Manager', text: `${so.so_no} material received · authorize dispatch` }, detail: 'Once all vendor POs arrive and GRN is posted, mark material received.' },
    'Material Received': { roles: ['Project Manager','Org Admin'], label: 'Authorize Dispatch', icon: 'truck', next: 'Ready to Dispatch', notify: { role: 'Billing', text: `${so.so_no} ready · raise tax invoice + e-Way Bill` }, detail: 'Confirm items match SO, authorize logistics, hand over to Billing.' },
    'Ready to Dispatch': { roles: ['Billing','Org Admin'], label: 'Raise Tax Invoice + EWB', icon: 'receipt', next: 'Invoiced', notify: { role: 'Collections', text: `${so.so_no} invoiced · awaiting payment` }, detail: 'Generate Tax Invoice with IRN, link e-Way Bill, dispatch material.', generatesInvoice: true },
    'Invoiced': { roles: ['Collections','Billing','Org Admin'], label: 'Mark Payment Pending', icon: 'cash', next: 'Payment Pending', notify: { role: 'Collections', text: `${so.so_no} payment due — monitor` }, detail: 'Move to follow-up queue.' },
    'Payment Pending': { roles: ['Collections','Billing','Org Admin'], label: 'Record Full Payment', icon: 'check', next: 'Fully Paid', notify: { role: 'Project Manager', text: `${so.so_no} paid in full · close & reconcile` }, detail: 'Apply receipt against invoice, close out the financial side.' },
    'Fully Paid': { roles: ['Project Manager','Org Admin'], label: 'Close & Reconcile Surplus', icon: 'check', next: 'Closed', notify: null, detail: 'Stores reconciles any leftover items back to the Master Surplus Pool.' },
  };

  const nextAction = NEXT_ACTION[so.status];
  const canDoNext = nextAction && (nextAction.roles.includes(role) || role === 'Org Admin');

  const advanceStatus = () => {
    if (!nextAction) return;
    // Gate: an SO cannot be closed until every item is received in its Virtual Godown.
    if (nextAction.next === 'Closed' && window.soFullyReceived && !window.soFullyReceived(state, so)) {
      toast('Cannot close — some items are still not received in the Virtual Godown.');
      navigate(`godown/${so.id}`);
      return;
    }
    // Start Procurement → auto-generate the (split) Vendor POs from the inquiry's
    // vendor allocation, so every vendor + the GRN appear immediately.
    if (so.status === 'Approved' && nextAction.next === 'Procurement Started') {
      const sourcing = window.soSourcing ? window.soSourcing(state, so.id) : null;
      const hasPOs = state.vendor_pos.some(p => p.so_id === so.id);
      if (sourcing && !hasPOs && window.generateVendorPOsFromSourcing) {
        window.generateVendorPOsFromSourcing(so, sourcing, { state, mutate, toast, navigate, getProduct });
        return;
      }
    }
    const next = nextAction.next;
    const notif = nextAction.notify;
    mutate(s => {
      let invoiceFields = {};
      if (nextAction.generatesInvoice && !so.invoice_no) {
        invoiceFields = {
          invoice_no: `INV/FY26/${String(73 + s.sales_orders.filter(x => x.invoice_no).length + Math.floor(Math.random() * 30)).padStart(4, '0')}`,
          invoice_date: TODAY,
          invoice_amount: subtotal * 1.18,
        };
      }
      return {
        ...s,
        sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: next, ...invoiceFields } : x),
        ...(notif ? { notifications: [{ id: 'n-act-' + Date.now(), kind: 'so', text: notif.text, date: TODAY, read: false, role: notif.role }, ...s.notifications] } : {}),
      };
    }, {
      action: 'status', entity: 'SalesOrder', entity_id: so.id, from: so.status, to: next,
    });
    toast(`${so.so_no} → ${next}${notif ? ` · ${notif.role} notified` : ''}`, 'success');
  };

  // ===== Edit requirements mid-flow — Sales adjusts requirements; PM/Purchase fulfil =====
  // Locked once billing has been issued (use cancel/credit-note instead).
  const billingLocked = ['Invoiced', 'Payment Pending', 'Partially Paid', 'Fully Paid', 'Closed', 'Cancelled'].includes(so.status);
  const canEditSO = ['Sales', 'Project Manager', 'Purchase', 'Org Admin'].includes(role);

  // ===== On-hold / resume (Op 6/7) — only Project Manager or Purchase (+ Admin) =====
  const canHold = ['Project Manager', 'Purchase', 'Org Admin'].includes(role);
  // Urgent/Critical SOs may source components from other (esp. on-hold) SOs.
  const isUrgent = so.priority === 'Urgent' || so.priority === 'Critical';
  const canSource = ['Project Manager', 'Org Admin'].includes(role);

  const doHold = (reason, notes) => {
    mutate(s => ({
      ...s,
      sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, on_hold: true, hold_reason: reason, hold_notes: notes || null, on_hold_since: new Date().toISOString() } : x),
      notifications: [{ id: 'n-hold-' + Date.now(), kind: 'so', text: `${so.so_no} put ON HOLD · ${reason}`, date: TODAY, read: false, role: 'Project Manager' }, ...s.notifications],
    }), { action: 'hold', entity: 'SalesOrder', entity_id: so.id, reason });
    setShowHold(false);
    toast(`${so.so_no} put on hold · procurement paused`, '');
  };
  const doResume = () => {
    mutate(s => ({
      ...s,
      sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, on_hold: false, hold_reason: null, hold_notes: null, on_hold_since: null } : x),
      notifications: [{ id: 'n-res-' + Date.now(), kind: 'so', text: `${so.so_no} resumed from hold`, date: TODAY, read: false, role: 'Project Manager' }, ...s.notifications],
    }), { action: 'resume', entity: 'SalesOrder', entity_id: so.id });
    toast(`${so.so_no} resumed`, 'success');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('sales-orders')}>
            <Icon name="chevronLeft" size={12}/> Sales Orders
          </div>
          <h1 className="page-title">
            <span className="mono">{so.so_no}</span>
            <span style={{ marginLeft: 10 }}><StatusBadge status={so.status}/></span>
            <span style={{ marginLeft: 6 }}><PriorityBadge priority={so.priority}/></span>
            {so.on_hold && <span className="badge dot status-hold" style={{ marginLeft: 6 }}>On Hold</span>}
          </h1>
          <div className="page-sub">{cust.name} · PO Ref <span className="mono">{so.customer_po}</span> · PM {pm ? pm.name : 'Unassigned'}</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate(`godown/${so.id}`)}><Icon name="box" size={13}/>Virtual Godown</button>
          {canEditSO && !billingLocked && (
            <button className="btn" onClick={() => setShowEdit(true)} title="Add or adjust line items / requirements">
              <Icon name="edit" size={13}/>Edit items
            </button>
          )}
          {canSource && isUrgent && !['Closed','Cancelled','Fully Delivered'].includes(so.status) && (
            <button className="btn" onClick={() => setShowSource(true)} title="Request components from another SO (e.g. an on-hold SO)">
              <Icon name="arrowLeftRight" size={13}/>Source from SO
            </button>
          )}
          {canHold && !so.on_hold && !['Closed','Cancelled'].includes(so.status) && (
            <button className="btn" onClick={() => setShowHold(true)}><Icon name="alert" size={13}/>Put on hold</button>
          )}
          {canHold && so.on_hold && (
            <button className="btn btn-primary" onClick={doResume}><Icon name="repeat" size={13}/>Resume</button>
          )}
          {canDoNext && !so.on_hold && (
            <button className="btn btn-primary" onClick={advanceStatus}>
              <Icon name={nextAction.icon} size={13}/> {nextAction.label}
            </button>
          )}
        </div>
      </div>

      {so.on_hold && (
        <div className="mb-2" style={{ padding: '10px 12px', background: 'var(--warning-bg)', border: '1px solid oklch(0.85 0.09 75)', borderRadius: 'var(--radius)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
          <Icon name="alert" size={14} color="var(--warning)"/>
          <span><strong>On hold</strong>{so.hold_reason ? ` · ${String(so.hold_reason).replace(/_/g, ' ').toLowerCase()}` : ''}{so.hold_notes ? ` — ${so.hold_notes}` : ''}. Advancement & dispatch are paused; this SO can still lend stock to urgent SOs.</span>
        </div>
      )}

      {showHold && <HoldModal soNo={so.so_no} onClose={() => setShowHold(false)} onConfirm={doHold}/>}
      {showSource && <NewTransferModal destSoId={so.id} onClose={() => setShowSource(false)}/>}
      {showEdit && <EditSOModal so={so} role={role} onClose={() => setShowEdit(false)}/>}

      <div className="card mb-2">
        <div className="card-body" style={{ padding: '10px 14px' }}>
          <div className="h-timeline">
            {['Draft','Approved','Procurement Started','Material Received','Ready to Dispatch','Invoiced','Fully Paid','Closed'].map((stage, i) => {
              const reached = SO_LIFECYCLE.indexOf(so.status) >= SO_LIFECYCLE.indexOf(stage);
              const current = so.status === stage;
              return (
                <div key={stage} className={`h-step ${reached ? 'done' : ''} ${current ? 'current' : ''}`}>
                  <Icon name={reached ? 'check' : 'spinner'} size={11}/>
                  {stage}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="tabs mb-2" style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', border: '1px solid var(--border)', borderBottom: 'none' }}>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'lines', label: 'Line Items + BOM', count: so.lines.length },
          { id: 'procurement', label: 'Procurement', count: linkedPOs.length },
          { id: 'vendor-pos', label: 'Vendor POs', count: linkedPOs.length },
          { id: 'grn', label: 'GRN', count: state.grns.filter(g => linkedPOs.some(p => p.id === g.po_id)).length },
          { id: 'invoicing', label: 'Invoicing', count: (so.invoices || []).length },
          { id: 'godown', label: 'Virtual Godown' },
          { id: 'documents', label: 'Documents' },
          { id: 'audit', label: 'Audit Log' },
        ].map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{t.count !== undefined && <span className="count mono">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="detail-grid">
          <div className="stack">
            {nextAction && so.status !== 'Closed' && (
              <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
                <div className="card-body" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'var(--accent-bg)', display: 'grid', placeItems: 'center', flexShrink: 0,
                  }}>
                    <Icon name={nextAction.icon} size={18} color="var(--accent)"/>
                  </div>
                  <div className="grow">
                    <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Next action</div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{nextAction.label}</div>
                    <div className="small muted mt-1">{nextAction.detail}</div>
                    <div className="tiny mt-2" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="muted">Who:</span>
                      {nextAction.roles.map(r => (
                        <span key={r} className={`badge ${r === role ? 'accent' : ''}`}>{r}</span>
                      ))}
                    </div>
                  </div>
                  {so.on_hold ? (
                    <div style={{ textAlign: 'right' }}>
                      <span className="badge dot status-hold">On hold</span>
                      <div className="tiny muted mt-1">Resume to continue</div>
                    </div>
                  ) : canDoNext ? (
                    <button className="btn btn-primary" onClick={advanceStatus}>
                      <Icon name={nextAction.icon} size={13}/>{nextAction.label}
                    </button>
                  ) : (
                    <div style={{ textAlign: 'right' }}>
                      <span className="badge warning">Waiting for {nextAction.roles[0]}</span>
                      <div className="tiny muted mt-1">Switch persona to act</div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-header"><h3 className="card-title">Order Details</h3></div>
              <div className="card-body">
                <div className="dl">
                  <dt>Customer</dt><dd>{cust.name}</dd>
                  <dt>GSTIN</dt><dd className="mono">{cust.gstin}</dd>
                  <dt>Contact</dt><dd>{cust.contact} · {cust.phone}</dd>
                  <dt>Bill to</dt><dd>{cust.address}</dd>
                  <dt>Ship to</dt><dd>{so.ship_to}</dd>
                  <dt>Customer PO</dt><dd className="mono">{so.customer_po}</dd>
                  <dt>Payment terms</dt><dd>{so.payment_terms}</dd>
                  {so.extra && so.extra.billing_pattern && <><dt>Billing pattern</dt><dd>{so.extra.billing_pattern}</dd></>}
                  <dt>Order date</dt><dd className="mono">{fmtDate(so.date)}</dd>
                  <dt>Expected</dt><dd className="mono">{fmtDate(so.expected)}</dd>
                  <dt>PM</dt><dd><Avatar user={pm} size={18}/> {pm ? pm.name : 'Unassigned'}</dd>
                  {so.notes && <><dt>Notes</dt><dd>{so.notes}</dd></>}
                  {so.hold_reason && <><dt>Hold reason</dt><dd style={{ color: 'var(--warning)' }}>{so.hold_reason}</dd></>}
                  {(state.config.so_form_fields || []).filter(f => f.custom && so.extra && so.extra[f.key] !== undefined && so.extra[f.key] !== '').map(f => (
                    <Fragment key={f.key}><dt>{f.label}</dt><dd>{String(so.extra[f.key])}</dd></Fragment>
                  ))}
                </div>
              </div>
            </div>
            {so.extra && so.extra.implementation && (() => {
              const im = so.extra.implementation;
              const sup = getUser(im.supervisor_id);
              return (
                <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
                  <div className="card-header"><h3 className="card-title">Implementation</h3><span className="badge accent dot">{so.order_type}</span></div>
                  <div className="card-body">
                    <div className="dl">
                      <dt>Supervisor</dt><dd>{sup ? <><Avatar user={sup} size={18}/> {sup.name}</> : 'Unassigned'}</dd>
                      <dt>Hourly rate</dt><dd className="mono">{inr(im.hourly_rate || 0)}/hr</dd>
                      <dt>Hours</dt><dd className="mono">{im.hours || 0}</dd>
                      <dt>Implementation value</dt><dd className="mono"><strong>{inr((im.hourly_rate || 0) * (im.hours || 0))}</strong></dd>
                      {im.address && <><dt>Site address</dt><dd>{im.address}</dd></>}
                      {im.description && <><dt>Scope</dt><dd>{im.description}</dd></>}
                      <dt>BOQ status</dt><dd><span className="badge dot">{im.status || 'BOQ Pending'}</span> · {(im.boq || []).length} item(s)</dd>
                    </div>
                  </div>
                </div>
              );
            })()}
            {(so.pool_alloc || []).length > 0 && (
              <div className="card" style={{ borderLeft: '3px solid var(--success)' }}>
                <div className="card-header"><h3 className="card-title">♻ Reused from Master Surplus Pool</h3></div>
                <div className="card-body flush">
                  <table className="t">
                    <thead><tr><th>Item</th><th className="num">Qty from pool</th></tr></thead>
                    <tbody>
                      {(so.pool_alloc || []).map((a, i) => (
                        <tr key={i}><td>{a.name || (getProduct(a.product_id) || {}).name || a.product_id}</td><td className="num"><strong>{a.qty}</strong></td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="tiny muted" style={{ padding: '6px 14px' }}>These were taken from existing surplus stock — procurement does not re-buy them.</div>
                </div>
              </div>
            )}
            {linkedPOs.length > 0 && (
              <div className="card">
                <div className="card-header"><h3 className="card-title">Linked Vendor POs</h3></div>
                <div className="card-body flush">
                  <table className="t">
                    <thead><tr><th>PO No</th><th>Vendor</th><th>Status</th><th className="num">Amount</th><th>Expected</th></tr></thead>
                    <tbody>
                      {linkedPOs.map(po => {
                        const v = state.vendors.find(x => x.id === po.vendor_id);
                        return (
                          <tr key={po.id} onClick={() => navigate(`vendor-pos/${po.id}`)} style={{ cursor: 'pointer' }}>
                            <td><a className="mono">{po.po_no}</a></td>
                            <td>{v.name}</td>
                            <td><span className="badge">{po.status}</span></td>
                            <td className="num">{inr(po.amount)}</td>
                            <td className="mono small">{fmtDate(po.expected)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <div className="stack">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Totals</h3></div>
              <div className="card-body">
                <div className="dl">
                  <dt>{billAdj > 0 ? 'Ordered' : 'Subtotal'}</dt><dd className="num mono right">{inr(orderedSubtotal)}</dd>
                  {billAdj > 0 && <><dt style={{ color: 'var(--danger)' }}>Less: not supplied</dt><dd className="num mono right" style={{ color: 'var(--danger)' }}>−{inr(billAdj)}</dd></>}
                  {billAdj > 0 && <><dt>Billed subtotal</dt><dd className="num mono right"><strong>{inr(subtotal)}</strong></dd></>}
                  {sameState ? (<>
                    <dt>CGST 9%</dt><dd className="num mono right">{inr(subtotal*0.09)}</dd>
                    <dt>SGST 9%</dt><dd className="num mono right">{inr(subtotal*0.09)}</dd>
                  </>) : (
                    <><dt>IGST 18%</dt><dd className="num mono right">{inr(subtotal*0.18)}</dd></>
                  )}
                </div>
                <div className="divider"/>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 14 }}>
                  <span>Grand total</span><span className="num mono">{inr(grand)}</span>
                </div>
              </div>
            </div>
            {so.invoice_no && (
              <div className="card">
                <div className="card-header"><h3 className="card-title">Invoice</h3></div>
                <div className="card-body">
                  <div className="dl">
                    <dt>Invoice no.</dt><dd className="mono">{so.invoice_no}</dd>
                    <dt>Date</dt><dd className="mono">{fmtDate(so.invoice_date)}</dd>
                    <dt>Amount</dt><dd className="mono">{inr(so.invoice_amount)}</dd>
                    {so.days_overdue > 0 && <><dt>Overdue by</dt><dd style={{ color: 'var(--danger)' }}>{so.days_overdue} days</dd></>}
                  </div>
                  <button className="btn mt-2" onClick={() => navigate(`invoices/${so.id}`)} style={{ width: '100%' }}>
                    <Icon name="eye" size={13}/>View Invoice
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'lines' && (() => {
        const bomPOs = state.vendor_pos.filter(p => p.so_id === so.id);
        const vendorsForProd = (pid) => bomPOs.filter(po => (po.items || []).some(it => it.product_id === pid))
          .map(po => { const v = state.vendors.find(x => x.id === po.vendor_id); const it = (po.items || []).find(y => y.product_id === pid); return `${v ? v.name : po.vendor_id} (${it ? it.qty : 0})`; });
        return (
        <div className="stack">
          {canEditSO && !billingLocked && (
            <div className="card"><div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="grow"><strong className="small">Bill of Materials</strong><div className="tiny muted">Purchase / PM can adjust line items, quantities and components here after approval — flows into procurement & the Virtual Godown.</div></div>
              <button className="btn btn-primary" onClick={() => setShowEdit(true)}><Icon name="edit" size={13}/>Edit line items</button>
            </div></div>
          )}
          {typeof VGAddFromPoolPanel !== 'undefined' && <VGAddFromPoolPanel so={so}/>}
          <div className="card">
          <div className="card-body flush">
            <table className="t">
              <thead><tr>
                <th>Bundle / Component · Vendor</th><th className="num">Qty</th><th className="num">Unit ₹</th><th className="num">Line ₹</th>
              </tr></thead>
              <tbody>
                {so.lines.map(l => {
                  const cat = getCategory(l.category_id);
                  return (
                    <Fragment key={l.id}>
                      <tr>
                        <td><div style={{ fontWeight: 500 }}>{l.client_name ? `${l.client_name} ` : ''}{cat.name}</div><div className="tiny muted">HSN {cat.hsn}</div></td>
                        <td className="num">{l.bundle_qty}</td>
                        <td className="num">{inr(l.unit_price)}</td>
                        <td className="num"><strong>{inr(l.bundle_qty * l.unit_price)}</strong></td>
                      </tr>
                      {l.components.map(c => {
                        const p = getProduct(c.product_id);
                        const vs = vendorsForProd(c.product_id);
                        return (
                          <tr key={c.product_id} className="subrow">
                            <td>{p.name} <span className="muted tiny mono">· {p.code}</span> {c.override && <span className="badge warning" style={{ marginLeft: 4 }}>overridden</span>}{transferredIn[c.product_id] ? <span className="badge info" style={{ marginLeft: 4 }} title="Received via cross-SO transfer">+{transferredIn[c.product_id]} transferred in</span> : null}
                              <div className="tiny" style={{ color: vs.length ? 'var(--accent)' : 'var(--text-muted)', marginTop: 1 }}>{vs.length ? <><Icon name="cart" size={10}/> {vs.join(' · ')}</> : 'No vendor assigned yet'}</div>
                            </td>
                            <td className="num">{c.qty * l.bundle_qty} {p.uom}{l.bundle_qty > 1 && <div className="tiny muted">{c.qty} × {l.bundle_qty}</div>}</td>
                            <td className="num muted">@{inr(p.buy)}</td>
                            <td className="num muted">{inr(p.buy * c.qty * l.bundle_qty)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        </div>
        );
      })()}

      {tab === 'procurement' && <ProcurementTab so={so}/>}

      {tab === 'vendor-pos' && <SOVendorPOsTab so={so}/>}

      {tab === 'grn' && <SOGrnTab so={so}/>}

      {tab === 'invoicing' && <SOInvoicingTab so={so}/>}

      {tab === 'godown' && <VirtualGodownView soId={so.id} embedded/>}

      {tab === 'documents' && (
        <div className="card">
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { name: 'Sales Order Acknowledgement', meta: `Generated ${fmtDate(so.date)}`, icon: 'receipt' },
              so.status !== 'Draft' && { name: 'Quotation', meta: 'Pre-SO', icon: 'file' },
              ['Ready to Dispatch','Invoiced','Payment Pending'].includes(so.status) && { name: 'Delivery Challan', meta: 'Auto-generated', icon: 'truck' },
              so.invoice_no && { name: 'Tax Invoice', meta: so.invoice_no, icon: 'receipt', route: `invoices/${so.id}` },
              so.invoice_no && { name: 'e-Way Bill', meta: 'EWB231202310045', icon: 'flag' },
            ].filter(Boolean).map((doc, i) => (
              <div key={i} className="pool-item" onClick={() => doc.route && navigate(doc.route)} style={{ cursor: doc.route ? 'pointer' : 'default' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{doc.name}</div>
                  <div className="tiny muted">{doc.meta}</div>
                </div>
                <Icon name={doc.icon} size={16} color="var(--text-3)"/>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="card-body flush">
            <table className="t">
              <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>
                <tr><td className="mono small">21-May 09:42</td><td>Arun B</td><td><span className="badge success">Posted</span></td><td>GRN/FY26/0028 — 24 items added to VG</td></tr>
                <tr><td className="mono small">17-May 11:20</td><td>Mukesh D</td><td><span className="badge accent">Approved</span></td><td>Vendor selection: TechSource for CPUs</td></tr>
                <tr><td className="mono small">16-May 16:05</td><td>Pooja N</td><td><span className="badge">Floated</span></td><td>RFQ to 4 vendors</td></tr>
                <tr><td className="mono small">15-May 10:30</td><td>Ravi I</td><td><span className="badge accent">Approved</span></td><td>SO submitted by Karan, approved as PM</td></tr>
                <tr><td className="mono small">15-May 09:48</td><td>Karan M</td><td><span className="badge">Created</span></td><td>SO drafted from customer PO {so.customer_po}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ProcurementTab({ so }) {
  const { state, navigate, currentUser, getUser, getProduct, getVendor, mutate } = useStore();
  const toast = useToast();
  const [showPO, setShowPO] = React.useState(false);
  const role = getUser(currentUser)?.role;
  const canProcure = ['Purchase', 'Project Manager', 'Org Admin'].includes(role);
  const linkedPOs = state.vendor_pos.filter(p => p.so_id === so.id);

  // New flow: vendor already chosen during the inquiry → no RFQ; generate the
  // Vendor PO(s) directly from the selected vendors at the sourced prices.
  const sourcing = window.soSourcing ? window.soSourcing(state, so.id) : null;
  const groups = sourcing && window.vendorPOGroups ? window.vendorPOGroups(state, so, sourcing, getProduct) : [];
  const canGenerate = canProcure && sourcing && linkedPOs.length === 0 && ['Approved', 'Procurement Started'].includes(so.status);
  const doGenerate = () => window.generateVendorPOsFromSourcing(so, sourcing, { state, mutate, toast, navigate, getProduct });

  return (
    <div className="stack">
      {canGenerate && groups.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <strong className="small">Vendors already selected during inquiry <span className="mono">{sourcing.src_no}</span></strong>
                <div className="tiny muted">No RFQ needed — generate the Vendor PO(s) below at the sourced prices, then receive material as usual.</div>
              </div>
              <button className="btn btn-primary" onClick={doGenerate}><Icon name="cart" size={13}/>Generate {groups.length} Vendor PO(s)</button>
            </div>
            <table className="t mt-2"><thead><tr><th>Vendor</th><th className="num">Items</th><th className="num">PO amount</th></tr></thead>
              <tbody>{groups.map(g => { const v = getVendor(g.vendor_id); return (
                <tr key={g.vendor_id}><td>{v ? v.name : g.vendor_id}</td><td className="num">{g.items.length}</td><td className="num mono">{inr(g.amount)}</td></tr>
              ); })}</tbody>
            </table>
          </div>
        </div>
      )}
      {canProcure && (
        <div className="card"><div className="card-body" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="grow"><strong className="small">Procure for this SO</strong><div className="tiny muted">{sourcing ? 'Vendor chosen during the inquiry — raise the Vendor PO.' : 'Raise a Vendor PO for this order.'}</div></div>
          <button className="btn btn-primary" onClick={() => setShowPO(true)}><Icon name="cart" size={13}/>Create Vendor PO</button>
        </div></div>
      )}
      {showPO && <CreateVendorPOModal soId={so.id} onClose={() => setShowPO(false)}/>}
      <div className="card">
        <div className="card-header"><h3 className="card-title">Vendor POs</h3>
          {canProcure && <button className="btn btn-primary btn-sm" onClick={() => setShowPO(true)}><Icon name="plus" size={12}/>New Vendor PO</button>}
        </div>
        <div className="card-body flush">
          {linkedPOs.length === 0 ? <div className="empty">No vendor POs yet</div> : (
            <table className="t">
              <thead><tr><th>PO No</th><th>Vendor</th><th className="num">Amount</th><th>Status</th><th>Expected</th></tr></thead>
              <tbody>
                {linkedPOs.map(po => {
                  const v = state.vendors.find(x => x.id === po.vendor_id);
                  return (
                    <tr key={po.id}>
                      <td><a className="mono" onClick={() => navigate(`vendor-pos/${po.id}`)}>{po.po_no}</a></td>
                      <td>{v.name}</td>
                      <td className="num">{inr(po.amount)}</td>
                      <td><span className="badge">{po.status}</span></td>
                      <td className="mono small">{fmtDate(po.expected)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Put-on-hold modal (PM / Purchase) =====
const HOLD_REASONS = [
  ['VENDOR_MATERIAL_DELAY', 'Vendor material delay'],
  ['CUSTOMER_REQUESTED_DELAY', 'Customer requested delay'],
  ['AWAITING_CUSTOMER_CLARIFICATION', 'Awaiting customer clarification / changes'],
  ['CUSTOMER_CREDIT_ISSUE', 'Customer credit issue'],
  ['INTERNAL_CAPACITY_ISSUE', 'Internal capacity issue'],
  ['QUALITY_ISSUE_ON_RECEIVED_MATERIAL', 'Quality issue on received material'],
  ['AWAITING_CUSTOMER_PAYMENT', 'Awaiting customer payment'],
  ['OTHER', 'Other'],
];

function HoldModal({ soNo, onClose, onConfirm }) {
  const [reason, setReason] = React.useState(HOLD_REASONS[0][0]);
  const [notes, setNotes] = React.useState('');
  return (
    <Modal title={`Put ${soNo} on hold`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onConfirm(reason, notes)}>Put on hold</button>
      </>
    }>
      <div className="field">
        <label className="field-label">Reason *</label>
        <select className="select" value={reason} onChange={e => setReason(e.target.value)}>
          {HOLD_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="field mt-2">
        <label className="field-label">Notes</label>
        <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Context for the team…"/>
      </div>
      <div className="tiny muted mt-2" style={{ padding: 10, background: 'var(--warning-bg)', borderRadius: 4 }}>
        Holding pauses procurement & dispatch and blocks invoicing, but keeps the Virtual Godown locked — its stock can still be lent to urgent SOs via a cross-SO transfer. Only a Project Manager or Purchase can hold/resume.
      </div>
    </Modal>
  );
}

// ===== Edit SO line items / requirements mid-flow =====
// Sales adjusts what the customer wants; PM/Purchase fulfil. Changes flow into
// the Virtual Godown (required components) and billing (line subtotal) and
// notify PM + Purchase. Locked once billing is issued (handled by caller).
function EditSOModal({ so, role, onClose }) {
  const { state, mutate, getCategory, getProduct } = useStore();
  const toast = useToast();
  const [lines, setLines] = React.useState(() => JSON.parse(JSON.stringify(so.lines || [])));
  const [expanded, setExpanded] = React.useState({});
  const [notes, setNotes] = React.useState(so.notes || '');
  const [priority, setPriority] = React.useState(so.priority || 'Standard');
  const [saving, setSaving] = React.useState(false);

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

  const subtotal = lines.reduce((s, l) => s + l.bundle_qty * l.unit_price, 0);

  const save = () => {
    if (lines.length === 0) { toast('An SO needs at least one line item'); return; }
    setSaving(true);
    mutate(s => ({
      ...s,
      sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, lines, notes, priority } : x),
      notifications: [
        { id: 'n-edit-' + Date.now(), kind: 'so', text: `${so.so_no} requirements updated (by ${role}) · review & fulfil`, date: TODAY, read: false, role: 'Project Manager' },
        { id: 'n-edit2-' + Date.now(), kind: 'so', text: `${so.so_no} updated · check procurement needs`, date: TODAY, read: false, role: 'Purchase' },
        ...s.notifications,
      ],
    }), { action: 'edit', entity: 'SalesOrder', entity_id: so.id });
    setSaving(false);
    toast(`${so.so_no} updated · PM & Purchase notified`, 'success');
    onClose();
  };

  return (
    <Modal title={`Edit ${so.so_no} — line items & requirements`} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
      </>
    }>
      <div className="field-row mb-2">
        <div className="field">
          <label className="field-label">Priority</label>
          <select className="select" value={priority} onChange={e => setPriority(e.target.value)}>
            <option>Standard</option><option>Urgent</option><option>Critical</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Add line by category</label>
          <select className="select" value="" onChange={e => { if (e.target.value) addLine(e.target.value); e.target.value = ''; }}>
            <option value="">+ Add bundle…</option>
            {state.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="empty">No line items. Add a bundle above.</div>
      ) : (
        <table className="t">
          <thead><tr>
            <th style={{ width: 22 }}></th><th>Bundle</th><th className="num">Qty</th><th className="num">Unit ₹</th><th className="num">Line ₹</th><th style={{ width: 28 }}></th>
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
                    <td className="num"><input type="number" className="input mono" value={l.unit_price} onChange={e => updateLine(l.id, { unit_price: parseInt(e.target.value) || 0 })} style={{ width: 96, textAlign: 'right' }}/></td>
                    <td className="num"><strong>{inr(l.bundle_qty * l.unit_price)}</strong></td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => removeLine(l.id)}><Icon name="trash" size={12} color="var(--danger)"/></button></td>
                  </tr>
                  {open && (
                    <>
                      {l.components.map(c => {
                        const p = getProduct(c.product_id) || { name: c.product_id, code: c.product_id, uom: '' };
                        return (
                          <tr key={c.product_id} className="subrow">
                            <td></td>
                            <td><div style={{ fontSize: 12 }}>{p.name}</div><div className="tiny muted mono">{p.code}</div></td>
                            <td className="num"><input type="number" className="input mono" min="0" value={Math.round((c.qty || 0) * (l.bundle_qty || 1))} onChange={e => { const t = parseInt(e.target.value) || 0; const b = l.bundle_qty || 1; updateComp(l.id, c.product_id, { qty: t / b }); }} style={{ width: 72, textAlign: 'right', height: 24 }}/>{l.bundle_qty > 1 && <div className="tiny muted">{(c.qty || 0)}/bundle</div>}{c.override && <div className="tiny" style={{ color: 'var(--warning)' }}>was {Math.round((c.original_qty || 0) * (l.bundle_qty || 1))}</div>}</td>
                            <td colSpan="2" className="num small muted">@ {inr(p.buy || 0)}</td>
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

      <div className="field mt-2">
        <label className="field-label">Notes</label>
        <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="What changed / customer request…"/>
      </div>
      <div className="mt-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
        <span className="tiny muted">Saving updates the Virtual Godown requirements & notifies PM + Purchase. Customer billing recomputes from line items.</span>
        <span style={{ fontWeight: 600 }}>Subtotal {inr(subtotal)}</span>
      </div>
    </Modal>
  );
}

window.SalesOrdersList = SalesOrdersList;
window.SalesOrderNew = SalesOrderNew;
window.SalesOrderDetail = SalesOrderDetail;
window.HoldModal = HoldModal;
window.EditSOModal = EditSOModal;
