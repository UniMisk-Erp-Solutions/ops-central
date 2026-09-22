// ============================================================================
// Client review — accept or reject what was actually delivered
// ============================================================================
// Off everywhere except an organization running wf('client_acceptance'). Where
// it is off, this file defines functions nobody calls and mounts a panel that
// renders null — zero behaviour change for every other tenant.
//
// The client (through the Client Facing desk) looks at what has gone out on
// delivery challans and, per item, accepts some quantity, rejects some, or
// accepts the whole thing in one click. Purchase sees the outcome and is the
// one who finally closes the order — this panel never closes anything itself.
//
// ONE RULE CARRIES THE WHOLE FEATURE: a unit already decided (accepted OR
// rejected) never comes back into "pending". The same discipline a BOQ uses
// for "already committed" — otherwise a second review could silently reverse
// or double-count the first one.
// ============================================================================

// Apply a decision to one or more line items. `decisions` is
// { [product_id]: { accept?: qty, reject?: qty, note? } } — both accept and
// reject may appear on the same item (part right, part wrong).
//
// Every quantity is CLAMPED to what is still pending for that item at the
// moment this runs (read from the live state inside mutate, never the caller's
// stale snapshot) — the same reason BOQ math and receiving math both compute
// inside the updater rather than trusting what was true when the click fired.
function soApplyClientReview(soId, decisions, ctx) {
  const { mutate, currentUser, getUser, toast } = ctx;
  let outcome = null;
  mutate(s => {
    const so = (s.sales_orders || []).find(x => x.id === soId);
    if (!so) return s;
    const review = soClientReview(s, so);
    const byId = {};
    review.items.forEach(i => { byId[i.product_id] = i; });

    const prevItems = (so.extra && so.extra.client_review && so.extra.client_review.items) || {};
    const nextItems = { ...prevItems };
    let touched = 0;
    Object.keys(decisions || {}).forEach(pid => {
      const row = byId[pid];
      if (!row) return;                                  // nothing of this item was ever dispatched
      const want = decisions[pid] || {};
      const acceptAdd = Math.max(0, Math.min(Number(want.accept) || 0, row.pending));
      const rejectAdd = Math.max(0, Math.min(Number(want.reject) || 0, row.pending - acceptAdd));
      if (acceptAdd <= 0 && rejectAdd <= 0 && !want.note) return;
      const prev = prevItems[pid] || { accepted: 0, rejected: 0, note: '' };
      nextItems[pid] = {
        accepted: (Number(prev.accepted) || 0) + acceptAdd,
        rejected: (Number(prev.rejected) || 0) + rejectAdd,
        note: want.note != null ? want.note : (prev.note || ''),
      };
      touched++;
    });
    if (!touched) return s;

    const role = (getUser && currentUser) ? (getUser(currentUser) || {}).role : '';
    const nextSO = {
      ...so,
      extra: {
        ...(so.extra || {}),
        client_review: {
          items: nextItems,
          decided_by: currentUser || null, decided_role: role, decided_at: TODAY,
        },
      },
    };
    // Whether this leaves the order fully reviewed and clean, for the toast.
    const after = soClientReview(s, nextSO);
    outcome = { fully: after.allReviewed, anyRejected: after.anyRejected };
    const flagged = after.anyRejected
      ? (' - ' + after.items.filter(i => i.rejected > 0).length + ' item(s) flagged')
      : '';
    return {
      ...s,
      sales_orders: s.sales_orders.map(x => x.id === soId ? nextSO : x),
      notifications: [{
        id: 'n-crev-' + Date.now(), kind: 'so',
        text: so.so_no + ': client review recorded' + flagged + (after.allReviewed ? ' - all items decided' : ''),
        date: TODAY, read: false, role: 'Purchase',
      }, ...s.notifications],
    };
  }, { action: 'client-review', entity: 'SalesOrder', entity_id: soId,
       detail: Object.keys(decisions || {}).length + ' item(s)' });
  if (toast && outcome) {
    toast(outcome.anyRejected ? 'Recorded - some item(s) flagged for Purchase' : 'Recorded', 'success');
  }
  return outcome;
}

// Accept everything currently pending, across every item, in one call — the
// "accept whole order" shortcut. Built on soApplyClientReview so it is
// exactly the same write, never a second code path.
function soAcceptWholeOrder(soId, ctx) {
  const { state } = ctx;
  const so = (state.sales_orders || []).find(x => x.id === soId);
  if (!so) return;
  const review = soClientReview(state, so);
  const decisions = {};
  review.items.forEach(i => { if (i.pending > 0.0001) decisions[i.product_id] = { accept: i.pending }; });
  if (!Object.keys(decisions).length) { if (ctx.toast) ctx.toast('Nothing left to accept'); return; }
  return soApplyClientReview(soId, decisions, ctx);
}

function ClientReviewPanel({ so }) {
  const { state, mutate, getProduct, getUser, currentUser } = useStore();
  const toast = useToast();
  const [qty, setQty] = React.useState({});                // product_id -> typed accept qty
  if (!wfOn('client_acceptance')) return null;             // off for this org — nothing to show

  const review = soClientReview(state, so);
  const role = currentUser ? (getUser(currentUser) || {}).role : '';
  const canDecide = ['Client Facing', 'Org Admin'].includes(role);

  if (!review.items.length) {
    return (
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Client review</h3>
            <div className="tiny muted">Nothing has been dispatched yet - there is nothing for the client to look at.</div>
          </div>
        </div>
      </div>
    );
  }

  const acceptOne = (pid, row, label) => {
    const typed = qty[pid];
    const n = typed === undefined || typed === '' ? row.pending : Math.max(0, Math.min(Number(typed) || 0, row.pending));
    if (n <= 0) return;
    soApplyClientReview(so.id, { [pid]: { accept: n } }, { mutate, currentUser, getUser, toast });
    setQty(q => ({ ...q, [pid]: '' }));
  };
  const rejectOne = (pid, row, label) => {
    const typed = qty[pid];
    const n = typed === undefined || typed === '' ? row.pending : Math.max(0, Math.min(Number(typed) || 0, row.pending));
    if (n <= 0) return;
    const note = (typeof window.prompt === 'function')
      ? (window.prompt('Reason for rejecting ' + label + ' (optional, helps Purchase follow up)') || '')
      : '';
    soApplyClientReview(so.id, { [pid]: { reject: n, note } }, { mutate, currentUser, getUser, toast });
    setQty(q => ({ ...q, [pid]: '' }));
  };
  const acceptAll = () => soAcceptWholeOrder(so.id, { state, mutate, currentUser, getUser, toast });

  const anyPending = review.items.some(i => i.pending > 0.0001);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Client review</h3>
          <div className="tiny muted">
            What has been delivered so far - accepted, rejected, or still waiting on a decision.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {review.anyRejected && <span className="badge warning dot">
            {review.items.filter(i => i.rejected > 0).length} item(s) flagged
          </span>}
          {review.allReviewed
            ? <span className="badge success dot">fully reviewed</span>
            : <span className="badge dot">{review.items.filter(i => i.pending > 0.0001).length} item(s) pending</span>}
          {canDecide && anyPending && (
            <button className="btn btn-primary btn-sm" onClick={acceptAll}>
              <Icon name="check" size={12}/>Accept whole order
            </button>
          )}
        </div>
      </div>
      <div className="card-body flush">
        <table className="t">
          <thead><tr>
            <th>Item</th>
            <th className="num" style={{ width: 90 }}>Dispatched</th>
            <th className="num" style={{ width: 90 }}>Accepted</th>
            <th className="num" style={{ width: 90 }}>Rejected</th>
            <th className="num" style={{ width: 90 }}>Pending</th>
            <th style={{ width: 110 }}>Status</th>
            {canDecide && <th style={{ width: 200 }}></th>}
          </tr></thead>
          <tbody>
            {review.items.map(row => {
              const p = getProduct(row.product_id) || {};
              // The line this component belongs to may carry the customer's own
              // wording — the same lookup the invoice uses, so this reads the
              // way the client actually ordered it.
              let label = p.name || row.product_id;
              (so.lines || []).some(l => (l.components || []).some(c => {
                if (c.product_id !== row.product_id) return false;
                const hit = window.custRefName ? window.custRefName(c.customer_ref) : null;
                if (hit) label = hit.label;
                return true;
              }));
              return (
                <tr key={row.product_id}>
                  <td>
                    <div className="small trunc" style={{ maxWidth: 320 }}>{label}</div>
                    {p.code && <div className="tiny muted mono">{p.code}</div>}
                  </td>
                  <td className="num mono small">{qty_(row.dispatched)}</td>
                  <td className="num mono small" style={row.accepted > 0 ? { color: 'var(--success)' } : null}>
                    {row.accepted > 0 ? qty_(row.accepted) : '—'}
                  </td>
                  <td className="num mono small" style={row.rejected > 0 ? { color: 'var(--danger)' } : null}>
                    {row.rejected > 0 ? qty_(row.rejected) : '—'}
                  </td>
                  <td className="num mono small" style={row.pending > 0 ? { fontWeight: 600 } : null}>
                    {row.pending > 0 ? qty_(row.pending) : '—'}
                  </td>
                  <td>
                    {row.status === 'Accepted' && <span className="badge success dot">Accepted</span>}
                    {row.status === 'Rejected' && <span className="badge danger dot" title={row.note}>Rejected</span>}
                    {row.status === 'Partly rejected' && <span className="badge warning dot" title={row.note}>Partly rejected</span>}
                    {row.status === 'Pending' && <span className="badge dot">Pending</span>}
                  </td>
                  {canDecide && (
                    <td style={{ textAlign: 'right' }}>
                      {row.pending > 0 ? (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <input className="input num" type="number" min="0" max={row.pending}
                            placeholder={qty_(row.pending)}
                            value={qty[row.product_id] || ''}
                            onChange={e => setQty(q => ({ ...q, [row.product_id]: e.target.value }))}
                            style={{ height: 26, width: 64 }}/>
                          <button className="btn btn-sm" onClick={() => acceptOne(row.product_id, row, label)} title="Accept this quantity">
                            <Icon name="check" size={12}/>
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => rejectOne(row.product_id, row, label)} title="Reject this quantity">
                            <Icon name="x" size={12}/>
                          </button>
                        </div>
                      ) : (row.note ? <span className="tiny muted">{row.note}</span> : null)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canDecide && (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="tiny muted">Only Client Facing records the client's decision here.</div>
        </div>
      )}
    </div>
  );
}

// Local alias — utils.jsx's qty() formatter, under a name that cannot collide
// with the `qty` state variable this component also needs.
function qty_(n) { return (typeof window.qty === 'function') ? window.qty(n) : n; }

window.soApplyClientReview = soApplyClientReview;
window.soAcceptWholeOrder = soAcceptWholeOrder;
window.ClientReviewPanel = ClientReviewPanel;
