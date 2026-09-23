// ============================================================================
// Client requests — what the client wants, before there is an SO to want it on
// ============================================================================
// The client never creates a Sales Order here. Client Facing writes down what
// the client asked for — free text, in the client's own words, with a
// quantity each — helped along by a list of what that same customer has
// ordered before. It gets SENT to Purchase, and Purchase is the one who turns
// it into a real Sales Order, matching every typed name to a catalogue item on
// the way.
//
// The matching is the same algorithm used everywhere else in this app: our own
// code, our own name, then this customer's own alias history
// (opc_alias_resolve_bulk — see docs/item-name-mapping.md). A confirmed match
// is learned back as an alias, the same "map once, reused forever" rule the
// importer already follows, so the same wording resolves itself next time.
//
// Everything from "Sales Order now exists" onward — procurement, RFQ, vendor
// PO, GRN, dispatch, client review — is the existing machinery. This file only
// gets the order INTO that machinery, in the client's own words.
// ============================================================================

// One number scheme, the same shape as everything else: prefix + year + month
// + sequence, derived from what already exists rather than a stored counter.
function clientReqNo(state, date) {
  return docNo('CREQ', ((state && state.client_requests) || []).map(r => r.request_no), date);
}

// What has this customer ordered before? Ranked by how many times, most
// recent first among ties. Reads the customer's OWN wording where the order
// recorded it — the same lookup the invoice and the client-review panel both
// use — so a recommendation reads like something the client actually asked
// for last time, not our internal name for it.
function clientPastItems(state, customerId, getProduct, limit) {
  if (!customerId) return [];
  const tally = {};
  (state.sales_orders || []).filter(so => so.customer_id === customerId).forEach(so => {
    const date = so.date || '';
    (so.lines || []).forEach(l => (l.components || []).forEach(c => {
      if (!c.product_id) return;
      const hit = (typeof custRefName === 'function') ? custRefName(c.customer_ref) : null;
      const p = getProduct ? getProduct(c.product_id) : null;
      const label = (hit && hit.label) || (p && p.name) || c.product_id;
      const key = c.product_id;
      if (!tally[key]) tally[key] = { product_id: c.product_id, label, count: 0, lastDate: '' };
      tally[key].count += 1;
      if (date > tally[key].lastDate) tally[key].lastDate = date;
    }));
  });
  return Object.values(tally)
    .sort((a, b) => b.count - a.count || String(b.lastDate || '').localeCompare(String(a.lastDate || '')))
    .slice(0, limit || 8);
}

// Match every typed item to a catalogue product — our code, our name, then
// this customer's own alias history, in that order. The ranking lives in the
// database (opc_alias_resolve_bulk), so this is not a second algorithm: it is
// the SAME one the sheet importer calls, given one row per request item
// instead of one row per sheet line.
async function matchRequestItems(customerId, items) {
  const out = {};
  const rows = (items || [])
    .filter(it => !it.product_id)          // a recommendation already carries one — leave it alone
    .map(it => ({ k: it.id, code: null, name: String(it.text || '').trim() }))
    .filter(r => r.name);
  if (!rows.length || !window.OPC_SB) return out;
  try {
    const r = await window.OPC_SB.rpc('opc_alias_resolve_bulk', {
      p_scope: 'customer', p_party_id: customerId || null, p_rows: rows,
    });
    const map = (!r.error && r.data && typeof r.data === 'object') ? r.data : {};
    Object.keys(map).forEach(k => {
      if (map[k] && map[k].product_id) out[k] = { product_id: map[k].product_id, matched_by: map[k].matched_by };
    });
  } catch (e) { /* unmatched items simply show as needing a new catalogue entry */ }
  return out;
}

function canCreateClientRequest(role) { return canDo(role, 'createClientRequest'); }
function canConvertClientRequest(role) { return canDo(role, 'convertClientRequest') || role === 'Org Admin'; }

// One definition of what each status means in plain words, so the list badge,
// its hover text and the detail page's status line never say three different
// things about the same request. `label` is short enough for a table cell;
// `detail` is the full sentence for a title/subtitle.
function clientReqStatusCopy(status) {
  switch (status) {
    case 'Draft':     return { label: 'Draft', detail: 'Not sent yet — keep editing or send it to Purchase' };
    case 'Sent':      return { label: 'Being matched', detail: 'Purchase is matching your items to our catalogue — usually done within a day' };
    case 'Converted': return { label: 'Order placed', detail: 'This became a Sales Order — open it to track delivery' };
    case 'Cancelled': return { label: 'Cancelled', detail: 'This request will not be actioned' };
    default:          return { label: status || '', detail: '' };
  }
}

// ============================================================================
// List — Client Facing sees their own; Purchase sees the queue plus history
// ============================================================================
function ClientRequestList() {
  const { state, navigate, getCustomer, getUser, currentUser } = useStore();
  const role = currentUser ? (getUser(currentUser) || {}).role : '';
  const isClient = role === 'Client Facing';
  const all = state.client_requests || [];
  const mine = isClient ? all.filter(r => r.created_by === currentUser) : all;
  const sent = mine.filter(r => r.status === 'Sent');
  const drafts = mine.filter(r => r.status === 'Draft');
  const done = mine.filter(r => ['Converted', 'Cancelled'].includes(r.status));

  const Row = (r) => {
    const cust = getCustomer(r.customer_id);
    return (
      <tr key={r.id} onClick={() => navigate(`client-requests/${r.id}`)} style={{ cursor: 'pointer' }}>
        <td className="mono small">{r.request_no || '(draft)'}</td>
        <td className="small">{cust ? cust.name : '—'}</td>
        <td className="num mono small">{(r.items || []).length}</td>
        <td>
          {(() => {
            const sc = clientReqStatusCopy(r.status);
            const cls = r.status === 'Sent' ? 'badge accent dot' : r.status === 'Converted' ? 'badge success dot' : 'badge dot';
            return <span className={cls} title={sc.detail}>{sc.label}</span>;
          })()}
        </td>
        <td className="tiny muted">{fmtDate(r.sent_at || r.created_at)}</td>
      </tr>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Requests</h1>
          <div className="page-sub">
            {isClient
              ? "What the client wants, in their own words — sent to Purchase, who turns it into a Sales Order."
              : "Incoming requests from Client Facing, waiting to be matched and turned into a Sales Order."}
          </div>
        </div>
        {canCreateClientRequest(role) && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => navigate('client-requests/new')}>
              <Icon name="plus" size={13}/>New Request
            </button>
          </div>
        )}
      </div>

      {!isClient && (
        <div className="card mb-2">
          <div className="card-header"><h3 className="card-title">Waiting on Purchase</h3>
            {sent.length > 0 && <span className="badge accent dot">{sent.length}</span>}</div>
          <div className="card-body flush">
            {sent.length === 0 ? <div className="empty">Nothing sent yet.</div> : (
              <table className="t"><thead><tr>
                <th>Request</th><th>Customer</th><th className="num">Items</th><th>Status</th><th>Sent</th>
              </tr></thead><tbody>{sent.map(Row)}</tbody></table>
            )}
          </div>
        </div>
      )}

      {isClient && (
        <div className="card mb-2">
          <div className="card-header"><h3 className="card-title">Drafts</h3></div>
          <div className="card-body flush">
            {drafts.length === 0 ? <div className="empty">No drafts — start a new request.</div> : (
              <table className="t"><thead><tr>
                <th>Request</th><th>Customer</th><th className="num">Items</th><th>Status</th><th>Started</th>
              </tr></thead><tbody>{drafts.map(Row)}</tbody></table>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><h3 className="card-title">{isClient ? 'Sent & history' : 'History'}</h3></div>
        <div className="card-body flush">
          {(isClient ? sent.concat(done) : done).length === 0 ? <div className="empty">Nothing here yet.</div> : (
            <table className="t"><thead><tr>
              <th>Request</th><th>Customer</th><th className="num">Items</th><th>Status</th><th>Date</th>
            </tr></thead><tbody>{(isClient ? sent.concat(done) : done).map(Row)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// New — Client Facing builds the list: recommendations + free text
// ============================================================================
function ClientRequestNew() {
  const { state, navigate, mutate, getCustomer, getProduct, currentUser } = useStore();
  const toast = useToast();
  const [customerId, setCustomerId] = React.useState('');
  const [items, setItems] = React.useState([]);           // [{id, text, qty, note, product_id?, from?}]
  const [text, setText] = React.useState('');
  const [qty, setQty] = React.useState('1');
  const [note, setNote] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const recs = React.useMemo(
    () => clientPastItems(state, customerId, getProduct, 8), [state.sales_orders, customerId]);
  const alreadyAdded = new Set(items.map(i => i.product_id).filter(Boolean));

  const addFree = () => {
    const t = text.trim();
    if (!t) { toast('Type what the item is called'); return; }
    const n = Math.max(0, Number(qty) || 0);
    if (n <= 0) { toast('Quantity must be more than zero'); return; }
    setItems(list => [...list, { id: 'i-' + Date.now() + '-' + list.length, text: t, qty: n, note: note.trim() || null }]);
    setText(''); setQty('1'); setNote('');
  };
  const addRecommended = (r) => {
    if (alreadyAdded.has(r.product_id)) { toast('Already on the list'); return; }
    setItems(list => [...list, {
      id: 'i-' + Date.now() + '-' + list.length, text: r.label, qty: 1, note: null,
      product_id: r.product_id, from: 'past_order',   // we already know this one — Purchase does not need to re-map it
    }]);
  };
  const removeItem = (id) => setItems(list => list.filter(i => i.id !== id));
  const setItemQty = (id, v) => setItems(list => list.map(i => i.id === id ? { ...i, qty: Math.max(0, Number(v) || 0) } : i));

  const save = async (send) => {
    if (!customerId) { toast('Pick a customer'); return; }
    if (!items.length) { toast('Add at least one item'); return; }
    setBusy(true);
    // Same call-time pattern boqNo/vendorPoNo/challanNo already use (see
    // screens-boq.jsx's create()) — derived from what exists right now, not
    // re-verified inside the updater, because the number is also needed
    // immediately below for the toast and the URL.
    const req = {
      id: 'creq-' + Date.now(),
      request_no: clientReqNo(state, TODAY),
      customer_id: customerId,
      status: send ? 'Sent' : 'Draft',
      items: items.map(i => ({ id: i.id, text: i.text, qty: i.qty, note: i.note || null,
                                product_id: i.product_id || null, matched_by: i.from || null })),
      notes: notes.trim() || null,
      created_by: currentUser || null,
      sent_at: send ? TODAY : null,
      converted_so_id: null,
    };
    mutate(s => ({
      ...s,
      client_requests: [req, ...(s.client_requests || [])],
      notifications: send ? [{
        id: 'n-creq-' + Date.now(), kind: 'so', role: 'Purchase',
        text: `${req.request_no}: new item request from ${(getCustomer(customerId) || {}).name || 'a customer'} · ${items.length} item(s)`,
        date: TODAY, read: false,
      }, ...s.notifications] : s.notifications,
    }), { action: 'create', entity: 'ClientRequest', entity_id: req.id,
          detail: `${req.request_no} · ${items.length} item(s)${send ? ' · sent to Purchase' : ' · draft'}` });
    setBusy(false);
    toast(send ? `${req.request_no} sent to Purchase` : `${req.request_no} saved as a draft`, 'success');
    navigate(`client-requests/${req.id}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('client-requests')}>
            <Icon name="chevronLeft" size={12}/> Item Requests
          </div>
          <h1 className="page-title">New Request</h1>
          <div className="page-sub">What the client wants, in their own words — Purchase matches it to our catalogue and creates the Sales Order.</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => navigate('client-requests')}>Cancel</button>
          <button className="btn" disabled={busy || !customerId || !items.length} onClick={() => save(false)}>Save Draft</button>
          <button className="btn btn-primary" disabled={busy || !customerId || !items.length} onClick={() => save(true)}>
            Send to Purchase <Icon name="arrowRight" size={13}/>
          </button>
        </div>
      </div>

      <div className="card mb-2"><div className="card-body">
        <div className="field" style={{ maxWidth: 340 }}>
          <label className="field-label">Customer *</label>
          <select className="select" value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">— select —</option>
            {(state.customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div></div>

      {/* Recommendations come first and are the prominent option — tapping one
          needs no typing and Purchase never has to map it, since it already
          carries its product_id. The free-text form below is the fallback,
          labelled and styled as the secondary path once there is something to
          compare it against. */}
      {customerId && (
        <div className="card mb-2" style={recs.length ? { borderLeft: '3px solid var(--accent)' } : null}>
          <div className="card-header">
            <h3 className="card-title">Quick add — ordered before</h3>
            {recs.length > 0 && <span className="tiny muted">tap to add instantly — nothing to type, nothing for Purchase to match</span>}
          </div>
          <div className="card-body">
            {recs.length === 0 ? (
              <div className="empty" style={{ padding: '6px 0' }}>
                No past orders for this customer yet. Once Purchase completes their first order, it shows up here so reordering is one tap.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
                {recs.map(r => {
                  const added = alreadyAdded.has(r.product_id);
                  return (
                    <button key={r.product_id} className="pool-item" disabled={added}
                      onClick={() => addRecommended(r)}
                      title={`Ordered ${r.count} time(s), most recently ${fmtDate(r.lastDate)}`}
                      style={{ width: '100%', textAlign: 'left', cursor: added ? 'default' : 'pointer', opacity: added ? 0.55 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-bg)',
                          display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          <Icon name={added ? 'check' : 'plus'} size={14} color="var(--accent)"/>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="small trunc" style={{ fontWeight: 500 }}>{r.label}</div>
                          <div className="tiny muted">ordered {r.count}× · last {fmtDate(r.lastDate)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card mb-2">
        <div className="card-header">
          <h3 className="card-title" style={recs.length ? { color: 'var(--text-2)', fontWeight: 500 } : null}>
            {recs.length ? "Can't find it above? Type it in" : 'What do they want?'}
          </h3>
        </div>
        <div className="card-body">
          <div className="field-row">
            <div className="field grow">
              <label className="field-label">What is it called?</label>
              <input className="input" value={text} onChange={e => setText(e.target.value)}
                placeholder="type it the way the client said it" onKeyDown={e => { if (e.key === 'Enter') addFree(); }}/>
            </div>
            <div className="field" style={{ width: 100 }}>
              <label className="field-label">Qty</label>
              <input className="input num" type="number" min="0" value={qty} onChange={e => setQty(e.target.value)}/>
            </div>
            <div className="field grow">
              <label className="field-label">Note <span className="tiny muted">(optional)</span></label>
              <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="colour, size, anything else"/>
            </div>
            <div className="field" style={{ alignSelf: 'flex-end' }}>
              <button className="btn btn-primary" onClick={addFree}><Icon name="plus" size={13}/>Add</button>
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-2">
        <div className="card-header"><h3 className="card-title">This request</h3>
          <span className="tiny muted">{items.length} item(s)</span></div>
        <div className="card-body flush">
          {items.length === 0 ? <div className="empty">Nothing added yet.</div> : (
            <table className="t"><thead><tr>
              <th>Item</th><th className="num" style={{ width: 90 }}>Qty</th><th>Note</th><th style={{ width: 50 }}></th>
            </tr></thead><tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td>
                    <div className="small">{i.text}</div>
                    {i.from === 'past_order' && <div className="tiny" style={{ color: 'var(--success)' }}>ordered before — already matched</div>}
                  </td>
                  <td className="num"><input className="input num" type="number" min="0" value={i.qty}
                    onChange={e => setItemQty(i.id, e.target.value)} style={{ height: 26, width: 70 }}/></td>
                  <td className="tiny muted">{i.note || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => removeItem(i.id)}><Icon name="x" size={12}/></button>
                  </td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>

      <div className="card"><div className="card-body">
        <div className="field">
          <label className="field-label">Anything else Purchase should know? <span className="tiny muted">(optional)</span></label>
          <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} rows={2}/>
        </div>
      </div></div>
    </div>
  );
}

// ============================================================================
// Detail — Client Facing edits a draft; Purchase matches and converts
// ============================================================================
function ClientRequestDetail({ reqId }) {
  const { state, mutate, navigate, getCustomer, getProduct, getUser, currentUser } = useStore();
  const toast = useToast();
  const req = (state.client_requests || []).find(r => r.id === reqId);
  const role = currentUser ? (getUser(currentUser) || {}).role : '';
  const cust = req ? getCustomer(req.customer_id) : null;

  const [matches, setMatches] = React.useState({});        // itemId -> {product_id, matched_by} | 'create'
  const [matched, setMatched] = React.useState(false);
  const [soNo, setSoNo] = React.useState(() => nextSoNo(state));
  const [poRef, setPoRef] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!req || req.status !== 'Sent' || !canConvertClientRequest(role)) return;
    let dead = false;
    (async () => {
      const pre = {};
      (req.items || []).forEach(i => { if (i.product_id) pre[i.id] = { product_id: i.product_id, matched_by: i.matched_by || 'past_order' }; });
      const found = await matchRequestItems(req.customer_id, req.items || []);
      if (dead) return;
      setMatches({ ...pre, ...found });
      setMatched(true);
    })();
    return () => { dead = true; };
  }, [req && req.id, req && req.status]);

  if (!req) return <div className="page"><div className="empty">{state.loaded ? 'Request not found' : 'Loading…'}</div></div>;

  const send = () => {
    mutate(s => ({
      ...s,
      client_requests: (s.client_requests || []).map(x => x.id === req.id ? { ...x, status: 'Sent', sent_at: TODAY } : x),
      notifications: [{
        id: 'n-creq-' + Date.now(), kind: 'so', role: 'Purchase',
        text: `${req.request_no}: new item request from ${cust ? cust.name : 'a customer'} · ${(req.items || []).length} item(s)`,
        date: TODAY, read: false,
      }, ...s.notifications],
    }), { action: 'send', entity: 'ClientRequest', entity_id: req.id });
    toast(`${req.request_no} sent to Purchase`, 'success');
  };

  const setMatch = (itemId, val) => setMatches(m => ({ ...m, [itemId]: val }));

  const allDecided = (req.items || []).every(i => {
    const m = matches[i.id];
    return m === 'create' || (m && m.product_id);
  });

  const convert = async () => {
    const num = String(soNo || '').trim();
    if (!num) { toast('Enter a Sales Order number'); return; }
    if (soNoTaken(state, num)) { toast('That Sales Order number is already used'); return; }
    if (!poRef.trim()) { toast('Enter the customer PO reference'); return; }
    if (!allDecided) { toast('Every item needs a match, or "create new item"'); return; }
    setBusy(true);

    const stamp = Date.now();
    const madeProducts = [];
    const idFor = {};
    (req.items || []).forEach((i, idx) => {
      if (matches[i.id] !== 'create') return;
      const pid = 'p-creq-' + stamp + '-' + idx;
      idFor[i.id] = pid;
      madeProducts.push({ id: pid, code: 'CREQ-' + (idx + 1), name: i.text, hsn: '', uom: 'Nos.', gst: 18, sell: 0, buy: 0 });
    });
    if (madeProducts.length && window.OPC_SB) {
      const { error } = await window.OPC_SB.from('products').insert(madeProducts);
      if (error) { setBusy(false); toast('Could not save the new item(s): ' + error.message); return; }
    }

    const lines = (req.items || []).map((i, idx) => {
      const pid = idFor[i.id] || (matches[i.id] && matches[i.id].product_id);
      const p = getProduct(pid) || madeProducts.find(mp => mp.id === pid) || {};
      return {
        id: 'l-' + stamp + '-' + idx, bundle_qty: 1, unit_price: 0, client_name: i.text,
        customer_ref: { desc: i.text },
        components: [{ product_id: pid, qty: Number(i.qty) || 0, sell: Number(p.sell) || 0,
                       customer_ref: { desc: i.text, unit: p.uom || '' } }],
      };
    });

    const newSO = {
      id: 'so-' + stamp, so_no: num, customer_id: req.customer_id, customer_po: poRef.trim(),
      date: TODAY, expected: TODAY, priority: 'Standard', order_type: 'Supply',
      status: 'Draft',          // same starting point the sheet importer already uses
      lines, notes: req.notes || '', extra: { from_client_request: req.id },
    };

    mutate(s => ({
      ...s,
      sales_orders: [newSO, ...s.sales_orders],
      client_requests: (s.client_requests || []).map(x => x.id === req.id
        ? { ...x, status: 'Converted', converted_so_id: newSO.id } : x),
      notifications: [{
        id: 'n-creq-conv-' + Date.now(), kind: 'so', role: 'Purchase',
        text: `${newSO.so_no} created from ${req.request_no} · ${lines.length} item(s)`,
        date: TODAY, read: false,
      },
      // The requester has no "My Tasks" page to check for this — the topbar
      // bell is the only passive way they find out their request moved.
      // Without this, they would never see it at all.
      ...(req.created_by ? [{
        id: 'n-creq-conv-req-' + Date.now(), kind: 'client-request', user_id: req.created_by,
        text: `${req.request_no} is now Sales Order ${newSO.so_no} — Purchase is on it`,
        date: TODAY, read: false,
      }] : []),
      ...s.notifications],
    }), { action: 'convert', entity: 'ClientRequest', entity_id: req.id,
          detail: `${req.request_no} -> ${newSO.so_no} · ${lines.length} item(s), ${madeProducts.length} new` });

    // Learn the wording — the same customer typing "24 port switch" next time
    // resolves itself. Best-effort: the order already exists either way.
    if (window.OPC_SB) {
      const learn = (req.items || []).map((i, idx) => ({
        product_id: idFor[i.id] || (matches[i.id] && matches[i.id].product_id), code: null, name: i.text, uom: null,
      })).filter(x => x.product_id);
      if (learn.length) {
        try { await window.OPC_SB.rpc('opc_alias_set_bulk', { p_scope: 'customer', p_party_id: req.customer_id, p_rows: learn }); }
        catch (e) { /* the order exists; mapping can be finished on Item Mapping */ }
      }
      if (window.invalidateAliasMap) window.invalidateAliasMap('customer', req.customer_id);
    }

    setBusy(false);
    toast(`${newSO.so_no} created from ${req.request_no}`, 'success');
    navigate(`sales-orders/${newSO.id}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="muted tiny mb-1" style={{ cursor: 'pointer' }} onClick={() => navigate('client-requests')}>
            <Icon name="chevronLeft" size={12}/> Item Requests
          </div>
          <h1 className="page-title"><span className="mono">{req.request_no || '(draft)'}</span></h1>
          <div className="page-sub">{cust ? cust.name : ''} · {(req.items || []).length} item(s)</div>
          {req.status !== 'Draft' && (
            <div className="tiny" style={{ marginTop: 3, color: req.status === 'Converted' ? 'var(--success)' : 'var(--text-2)' }}>
              {clientReqStatusCopy(req.status).detail}
            </div>
          )}
        </div>
        {req.status === 'Draft' && req.created_by === currentUser && (
          <div className="page-actions"><button className="btn btn-primary" onClick={send}>Send to Purchase</button></div>
        )}
        {req.status === 'Converted' && (
          <div className="page-actions">
            {/* Client Facing cannot open the SO detail page (see
                docs/client-acceptance.md) — send them to SCM Tracking,
                pre-selected on this order, where the review panel lives too.
                Every other role goes to the full detail page as before. */}
            <button className="btn" onClick={() => navigate(role === 'Client Facing'
              ? `scm/${req.converted_so_id}` : `sales-orders/${req.converted_so_id}`)}>
              <Icon name="arrowRight" size={13}/>View Sales Order
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header"><h3 className="card-title">Items</h3></div>
        <div className="card-body flush">
          <table className="t"><thead><tr>
            <th>The client asked for</th>
            <th className="num" style={{ width: 80 }}>Qty</th>
            <th>Note</th>
            {req.status === 'Sent' && canConvertClientRequest(role) && <th style={{ width: 280 }}>Matched to</th>}
          </tr></thead><tbody>
            {(req.items || []).map(i => {
              const p = getProduct(i.product_id);
              const m = matches[i.id];
              return (
                <tr key={i.id}>
                  <td className="small">{i.text}</td>
                  <td className="num mono small">{qty(i.qty)}</td>
                  <td className="tiny muted">{i.note || '—'}</td>
                  {req.status === 'Sent' && canConvertClientRequest(role) && (
                    <td>
                      {!matched ? <span className="tiny muted">matching…</span> : (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select className="select" style={{ height: 26, fontSize: 11.5 }}
                            value={m === 'create' ? '__new' : (m && m.product_id) || ''}
                            onChange={e => setMatch(i.id, e.target.value === '__new' ? 'create' : { product_id: e.target.value, matched_by: 'manual' })}>
                            <option value="">— choose —</option>
                            <option value="__new">+ Create new item</option>
                            {(state.products || []).map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                          </select>
                          {m && m !== 'create' && m.matched_by && m.matched_by !== 'manual' && (
                            <span className="tiny" style={{ color: 'var(--success)' }} title="matched automatically">
                              {({ our_code: 'our code', our_name: 'our name', alias_code: 'their code, on file',
                                  alias_name: 'their wording, on file', past_order: 'ordered before' }[m.matched_by]) || 'matched'}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody></table>
        </div>
      </div>

      {req.status === 'Sent' && canConvertClientRequest(role) && (
        <div className="card mt-2">
          <div className="card-header"><h3 className="card-title">Create the Sales Order</h3></div>
          <div className="card-body">
            <div className="field-row mb-2">
              <div className="field">
                <label className="field-label">Sales Order No. *</label>
                <input className="input mono" value={soNo} onChange={e => setSoNo(e.target.value)} placeholder="e.g. ABG/2026/0117"/>
                <div className="field-hint">
                  {soNoTaken(state, soNo)
                    ? <span style={{ color: 'var(--danger)' }}>Already used by another order</span>
                    : 'Manually entered · used on the challan and invoice'}
                </div>
              </div>
              <div className="field">
                <label className="field-label">Customer PO Reference *</label>
                <input className="input mono" value={poRef} onChange={e => setPoRef(e.target.value)} placeholder="e.g. RC/PO/2026/0312"/>
              </div>
            </div>
            <button className="btn btn-primary" disabled={busy || !allDecided || soNoTaken(state, soNo) || !soNo.trim() || !poRef.trim()}
              onClick={convert}>
              <Icon name="check" size={13}/>Create Sales Order
            </button>
            {!allDecided && <div className="tiny muted mt-1">Every item needs a match, or "Create new item", before this can proceed.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

window.clientReqNo = clientReqNo;
window.clientPastItems = clientPastItems;
window.matchRequestItems = matchRequestItems;
window.canCreateClientRequest = canCreateClientRequest;
window.canConvertClientRequest = canConvertClientRequest;
window.ClientRequestList = ClientRequestList;
window.ClientRequestNew = ClientRequestNew;
window.ClientRequestDetail = ClientRequestDetail;
