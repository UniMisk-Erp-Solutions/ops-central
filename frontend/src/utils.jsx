// OP Central — shared utilities, formatters, icons
const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, Fragment } = React;

/* ===== Formatters ===== */
// Indian number system: 1,00,000 not 100,000
function inrFmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  const neg = n < 0;
  n = Math.abs(Math.round(n));
  let s = String(n);
  if (s.length <= 3) return (neg ? '-' : '') + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const restF = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + restF + ',' + last3;
}
function inr(n) { return '₹' + inrFmt(n); }
function inrK(n) {
  if (!n && n !== 0) return '₹0';
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2) + 'Cr';
  if (n >= 100000) return '₹' + (n / 100000).toFixed(2) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'k';
  return inr(n);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dd}-${months[dt.getMonth()]}-${dt.getFullYear()}`;
}

// n days after an ISO date, as an ISO date. Empty for anything that is not a
// date: new Date(undefined).toISOString() throws RangeError, and a throw
// during render takes the whole page with it.
function addDays(iso, n) {
  if (!iso) return '';
  const t = new Date(iso + (String(iso).length === 10 ? 'T00:00:00' : '')).getTime();
  if (!isFinite(t)) return '';
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const A = new Date(a + 'T00:00:00');
  const B = new Date(b + 'T00:00:00');
  return Math.round((B - A) / (1000 * 60 * 60 * 24));
}

const TODAY = '2026-05-21';

function statusClass(status) {
  const map = {
    'Draft': 'status-draft',
    'Pending Approval': 'status-pending',
    'Approved': 'status-approved',
    'Procurement Started': 'status-procurement',
    'Material Received': 'status-received',
    'Ready to Dispatch': 'status-ready',
    'Partially Delivered': 'status-ready',
    'Fully Delivered': 'status-delivered',
    'Invoiced': 'status-invoiced',
    'Payment Pending': 'status-pending',
    'Partially Paid': 'status-pending',
    'Fully Paid': 'status-paid',
    'Closed': 'status-closed',
    'On Hold': 'status-hold',
    'Cancelled': 'status-cancelled',
  };
  return map[status] || 'status-draft';
}

// Two stages sit between 'Fully Delivered' and 'Invoiced' for an organization
// that has turned wf('client_acceptance') ON — the client reviews what
// actually arrived (whole order, or line by line with quantities) before the
// order is treated as settled. Absent/false, soDerivedStatus() never produces
// them, so their presence here changes nothing for an org that has not asked
// for it: every existing comparison is RELATIVE (soAdvanceStatus checks
// b > a, never an absolute index), and inserting two names between two
// existing ones does not reorder anything on either side of them.
const SO_LIFECYCLE = [
  'Draft','Pending Approval','Approved','Procurement Started','Material Received',
  'Ready to Dispatch','Partially Delivered','Fully Delivered',
  'Pending Client Acceptance','Client Accepted',
  'Invoiced','Payment Pending','Fully Paid','Closed'
];

// How far along the lifecycle a status sits. -1 for anything not in it
// (Cancelled, Rejected, On Hold), which must never be auto-advanced past.
function soStageIndex(status) { return SO_LIFECYCLE.indexOf(status); }

// States the machine must not touch: they are decisions a person made, and an
// automatic rule has no business overriding them.
const SO_MANUAL_STATES = ['Cancelled', 'Rejected', 'Closed'];

// Move to `target` only if that is genuinely further along. Never backwards, and
// never out of a state somebody chose deliberately.
function soAdvanceStatus(current, target) {
  if (SO_MANUAL_STATES.indexOf(current) !== -1) return current;
  const a = soStageIndex(current), b = soStageIndex(target);
  if (b < 0) return current;
  return b > a ? target : current;
}

// What the ORDER ITSELF says, from what has actually happened to it.
//
// Read bottom-up: the furthest fact wins. Everything here is something the user
// can point at — a purchase order exists, goods were received, a challan went
// out, an invoice was raised, money arrived — so the strip can always be
// explained rather than just believed.
function soDerivedStatus(state, so) {
  if (!so) return 'Draft';
  if (SO_MANUAL_STATES.indexOf(so.status) !== -1) return so.status;

  const required = (typeof soRequired === 'function') ? soRequired(so) : {};
  const needed = Object.keys(required).reduce((a, k) => a + required[k], 0);

  const pos = (state.vendor_pos || []).filter(p => poServesSO(p, so.id)
    && ['Rejected', 'Cancelled'].indexOf(p.status) === -1);
  const posById = {};
  pos.forEach(p => { posById[p.id] = p; });

  const received = {};
  (state.grns || []).forEach(g => { const po = posById[g.po_id]; if (po) (g.items || []).forEach(it => {
    received[it.product_id] = (received[it.product_id] || 0) + grnLineSoQty(it, po, so.id);
  }); });
  (so.pool_alloc || []).forEach(a => {
    received[a.product_id] = (received[a.product_id] || 0) + (Number(a.qty) || 0);
  });
  const anyReceived = Object.keys(received).some(k => received[k] > 0);
  const allReceived = needed > 0 && Object.keys(required).every(k => (received[k] || 0) >= required[k]);

  const dcs = (state.outward_dispatches || []).filter(d => d.so_id === so.id && d.status !== 'Cancelled');
  const dispatched = soDispatchedQty(so, state);
  const anyDispatched = dcs.length > 0;
  const allDispatched = needed > 0 && Object.keys(required).every(k => (dispatched[k] || 0) >= required[k]);

  const invoices = so.invoices || [];
  const invoiced = invoices.length > 0 || !!so.invoice_no;
  const invoicedTotal = invoices.reduce((a, i) => a + (Number(i.total) || 0), 0) || (Number(so.invoice_amount) || 0);
  const paid = (state.payments || [])
    .filter(p => p.so_id === so.id || (so.invoices || []).some(i => i.no === p.invoice_no))
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const fullyPaid = invoicedTotal > 0 && paid >= invoicedTotal - 1;

  if (fullyPaid) return 'Fully Paid';
  // The client reviewing what arrived sits between delivery and invoicing —
  // and only for an organization that has switched it on. Off, this block
  // never runs and the order behaves exactly as it always has.
  //
  // Checked BEFORE invoiced/paid, not after: an organization can legitimately
  // run invoice_on_dispatch and client_acceptance together (invoicing fires
  // the moment goods leave, before anyone has looked at what arrived), and
  // the original ordering here checked `invoiced` first — so the strip jumped
  // straight to "Invoiced" and a real, unreviewed rejection was never visible
  // in the status at all, on any order, for as long as billing kept moving.
  // A review that is still open outranks how far billing has gotten; only a
  // CLEAN review (or the flag being off) falls through to the billing checks
  // below.
  if (anyDispatched && soReviewStillOpen(state, so)) return 'Pending Client Acceptance';
  if (invoiced && paid > 0) return 'Payment Pending';
  if (invoiced) return 'Invoiced';
  if (typeof wfOn === 'function' && wfOn('client_acceptance') && anyDispatched) return 'Client Accepted';
  if (allDispatched) return 'Fully Delivered';
  if (anyDispatched) return 'Partially Delivered';
  if (allReceived) return 'Ready to Dispatch';
  if (anyReceived) return 'Material Received';
  if (pos.length) return 'Procurement Started';
  return null;   // nothing has happened yet — leave the stored status alone
}

// Quantity of each item actually sent out, from the delivery challans —
// the one place this tally is computed, so a figure quoted anywhere else
// (the client-acceptance panel, a report) can never drift from what the
// status strip itself is reading.
function soDispatchedQty(so, state) {
  const out = {};
  (state.outward_dispatches || []).filter(d => d.so_id === so.id && d.status !== 'Cancelled')
    .forEach(d => (d.items || []).forEach(it => {
      out[it.product_id] = (out[it.product_id] || 0) + (Number(it.qty) || 0);
    }));
  return out;
}

// Per item: how much has gone out, how much the client has accepted or
// rejected of that, and how much is still waiting on a decision. Reads
// so.extra.client_review — written by soApplyClientReview() below — and
// never anything else, so this is the one place that answers "has the client
// signed off on this line".
//
// A rejection is never erased by a later acceptance of the SAME units: once
// dispatched quantity is spoken for (accepted OR rejected) it stays spoken
// for, the same rule a BOQ uses for "already committed".
function soClientReview(state, so) {
  const dispatched = soDispatchedQty(so, state);
  const decided = (so.extra && so.extra.client_review && so.extra.client_review.items) || {};
  const items = Object.keys(dispatched).filter(pid => dispatched[pid] > 0.0001).map(pid => {
    const sent = dispatched[pid];
    const d = decided[pid] || {};
    const accepted = Math.max(0, Number(d.accepted) || 0);
    const rejected = Math.max(0, Number(d.rejected) || 0);
    const pending = Math.max(0, sent - accepted - rejected);
    return {
      product_id: pid, dispatched: sent, accepted, rejected, pending,
      note: d.note || '',
      status: pending > 0.0001 ? 'Pending'
            : rejected > 0.0001 ? (accepted > 0.0001 ? 'Partly rejected' : 'Rejected')
            : 'Accepted',
    };
  });
  return {
    items,
    allReviewed: items.length > 0 && items.every(i => i.pending <= 0.0001),
    anyReviewed: items.some(i => i.accepted > 0.0001 || i.rejected > 0.0001),
    anyRejected: items.some(i => i.rejected > 0.0001),
  };
}

// Is there still something on this order for the client to decide? Off (or
// nothing dispatched yet) is never "open" — the same "flag off means exactly
// as before" rule every client_acceptance consumer follows.
//
// Every place that forces an SO's STORED status to 'Invoiced' the moment an
// invoice fully covers the order has to check this first, on an organization
// running client_acceptance: soAdvanceStatus only ever moves forward, so once
// so.status itself says 'Invoiced' — later in SO_LIFECYCLE than Pending
// Client Acceptance — soDerivedStatus's own review check can never be reached
// again for that order, no matter how open the review still is. An
// organization can legitimately invoice at dispatch, before anyone has
// looked at what arrived (invoice_on_dispatch + client_acceptance together),
// so this is not a hypothetical ordering.
function soReviewStillOpen(state, so) {
  if (!(typeof wfOn === 'function' && wfOn('client_acceptance'))) return false;
  const r = soClientReview(state, so);
  if (!r.items.length) return false;   // nothing dispatched yet — nothing to review, so nothing to block
  return !(r.allReviewed && !r.anyRejected);
}

// A rejected unit still owes the client one, until it is replaced and
// accepted. This is what a rejection turns into for Purchase: how much MORE
// needs to be ordered, beyond what the order originally required — netting
// out any replacement vendor PO already placed, so the figure goes back to
// zero the moment Purchase has re-ordered enough, not only once the
// replacement has arrived.
//
//   rejected=4, nothing re-ordered yet          -> owed 4
//   rejected=4, a PO for +4 already exists       -> owed 0 (ordered; the
//                                                    receive/dispatch/review
//                                                    cycle takes it from here)
//   rejected=4, a PO for +2 exists                -> owed 2
//
// Only for an organization running client_acceptance — everywhere else this
// returns {} and no procurement screen sees anything different.
function soRejectedOutstanding(state, so) {
  if (!(typeof wfOn === 'function' && wfOn('client_acceptance'))) return {};
  if (typeof soClientReview !== 'function') return {};
  const review = soClientReview(state, so);
  if (!review.anyRejected) return {};
  const required = (typeof soRequired === 'function') ? soRequired(so) : {};
  const onPO = {};
  ((state && state.vendor_pos) || []).forEach(po => {
    if (!poServesSO(po, so.id) || ['Rejected', 'Cancelled'].includes(po.status)) return;
    (po.items || []).forEach(it => { onPO[it.product_id] = (onPO[it.product_id] || 0) + poLineSoQty(po, it.product_id, so.id); });
  });
  const out = {};
  review.items.forEach(i => {
    if (i.rejected <= 0.0001) return;
    const alreadyReordered = Math.max(0, (onPO[i.product_id] || 0) - (required[i.product_id] || 0));
    const owed = Math.max(0, i.rejected - alreadyReordered);
    if (owed > 0.0001) out[i.product_id] = owed;
  });
  return out;
}

// Has the client actually RECEIVED and ACCEPTED everything the order
// requires? Not the same question as soRejectedOutstanding: that one nets
// against what has been ORDERED (an existing vendor PO satisfies it, even
// before the goods arrive), because its job is to stop Purchase ordering the
// same replacement twice. This one nets against what has been ACCEPTED,
// because its job is to stop the order closing while the client is still
// owed something — placing the replacement PO is not the same as the client
// having it in hand and having said yes to it.
function soUnfulfilled(state, so) {
  if (!(typeof wfOn === 'function' && wfOn('client_acceptance'))) return {};
  const required = (typeof soRequired === 'function') ? soRequired(so) : {};
  const review = (typeof soClientReview === 'function') ? soClientReview(state, so) : { items: [] };
  const acceptedBy = {};
  review.items.forEach(i => { acceptedBy[i.product_id] = i.accepted; });
  const out = {};
  Object.keys(required).forEach(pid => {
    const owed = (Number(required[pid]) || 0) - (Number(acceptedBy[pid]) || 0);
    if (owed > 0.0001) out[pid] = owed;
  });
  return out;
}

// What to SHOW. The stored status and the facts, whichever is further along, so
// an order that was never formally approved still reports honestly once goods
// have moved — and a manual state is never overridden.
function soEffectiveStatus(state, so) {
  if (!so) return '';
  if (SO_MANUAL_STATES.indexOf(so.status) !== -1) return so.status;
  const derived = soDerivedStatus(state, so);
  return derived ? soAdvanceStatus(so.status, derived) : so.status;
}

/* ===== Icons (lucide-style — inline SVG) ===== */
// Where "Back" goes: always UP the app's own hierarchy, never "whatever page was
// open before". The old version called history.back(), and that ping-ponged: an
// invoice's own "< Invoices" link *navigates* (adds a history entry) to the list,
// so Back on the list went to the invoice, whose link went to the list, and so on.
//   a detail / sub-screen   -> its list           invoices/so-1        -> invoices
//   (three levels)          -> its parent record   invoices/so-1/inv-2  -> invoices/so-1
//   a top-level screen      -> its Flow stage hub  invoices             -> flow/billing
//   anything else           -> the Flow hub
function opcParentRoute(route) {
  const parts = String(route || '').split('/').filter(Boolean);
  if (parts.length === 0 || parts[0] === 'flow' && parts.length === 1) return 'flow';
  if (parts[0] === 'flow') return 'flow';                                   // a stage hub -> the Flow hub
  if (parts[0] === 'invoices' && parts.length >= 3) return 'invoices/' + parts[1];
  if (parts.length >= 2) return parts[0];
  const stages = window.FLOW_STAGES || [];
  const st = stages.find(x => x.modules.indexOf(parts[0]) !== -1);
  return st ? 'flow/' + st.id : 'flow';
}
window.opcParentRoute = opcParentRoute;

// "< Back" link. `to` overrides the computed parent (used where a screen has no route of its own).
function OpcBackButton({ to, label = 'Back' }) {
  const { navigate, route } = useStore();
  return (
    <button type="button" className="back-link" onClick={() => navigate(to || opcParentRoute(route))}>
      <Icon name="chevronLeft" size={14}/>{label}
    </button>
  );
}
window.OpcBackButton = OpcBackButton;

// A group of rows under a heading (a project's vendor POs, a project's GRNs).
// Desktop: always open, exactly as before. Phone/tablet: the heading is a
// dropdown — tap to open or close the group's table — so a long list of
// projects is a short list of headings you open as needed. `startOpen` is the
// one open by default on a small screen (the first group). The chevron and the
// hiding are CSS (.grp-*), so a wide window ignores `open` entirely.
function OpcGroup({ title, right, startOpen, children }) {
  const [open, setOpen] = React.useState(!!startOpen);
  return (
    <div className={`grp${open ? ' open' : ''}`}>
      <div className="grp-head" role="button" tabIndex={0} aria-expanded={open}
           onClick={() => setOpen(o => !o)}
           onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpen(o => !o); } }}>
        <div className="grp-title">{title}</div>
        <div className="grp-right">{right}</div>
        <span className="grp-chev"><Icon name={open ? 'chevronUp' : 'chevronDown'} size={16}/></span>
      </div>
      <div className="grp-body">{children}</div>
    </div>
  );
}
window.OpcGroup = OpcGroup;

// Print (or "Save as PDF") exactly what is on screen for one element — the
// invoice paper — in its own window, so the browser does not print the whole app.
// It prints the element AS RENDERED, so the printout cannot differ from the preview.
// Returns false when the browser blocked the pop-up.
function opcPrintElement(el, title) {
  if (!el) return false;
  const w = window.open('', '_blank');
  if (!w) return false;
  const css = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => '<link rel="stylesheet" href="' + l.href + '">').join('');
  const vars = document.documentElement.getAttribute('style') || '';
  w.document.write('<!doctype html><html style="' + vars.replace(/"/g, '&quot;') + '"><head><meta charset="utf-8"><title>' + String(title || 'Document').replace(/</g, '&lt;') + '</title>' + css +
    '<style>body{background:#fff;margin:0;padding:12px}.doc-paper{box-shadow:none!important;border:none!important;max-width:none!important;margin:0 auto}@media print{body{padding:0}}</style></head><body>' +
    el.outerHTML + '<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>');
  w.document.close();
  return true;
}
window.opcPrintElement = opcPrintElement;

function Icon({ name, size = 14, color = "currentColor", strokeWidth = 1.75 }) {
  const paths = {
    home: <><path d="M3 12L12 4l9 8"/><path d="M5 10v10h14V10"/></>,
    cart: <><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l3 12h11l2-8H6"/></>,
    box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/></>,
    truck: <><path d="M2 8h11v9H2z"/><path d="M13 11h5l3 3v3h-8"/><circle cx="6" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/></>,
    receipt: <><path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-1z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    cash: <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 9v6M19 9v6"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2"/><path d="M21 19c0-2-2-3.5-4-3.5"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></>,
    factory: <><path d="M3 21V10l5 3V10l5 3V10l5 3v8z"/><path d="M9 17h2M14 17h2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></>,
    chart: <><path d="M4 19V5M4 19h16"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/></>,
    bell: <><path d="M6 8a6 6 0 0112 0c0 5 2 7 2 7H4s2-2 2-7"/><path d="M10 19a2 2 0 004 0"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    check: <><path d="M5 12l5 5L20 7"/></>,
    x: <><path d="M6 6l12 12M18 6L6 18"/></>,
    chevronDown: <><path d="M6 9l6 6 6-6"/></>,
    chevronUp: <><path d="M6 15l6-6 6 6"/></>,
    chevronRight: <><path d="M9 6l6 6-6 6"/></>,
    chevronLeft: <><path d="M15 6l-6 6 6 6"/></>,
    arrowRight: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    arrowLeftRight: <><path d="M7 4l-4 4 4 4M3 8h14M17 14l4 4-4 4M21 18H7"/></>,
    pin: <><path d="M12 2v8m-4 0h8l-2 4v8h-4v-8z"/></>,
    download: <><path d="M12 4v12m-4-4l4 4 4-4M4 20h16"/></>,
    upload: <><path d="M12 20V8m-4 4l4-4 4 4M4 4h16"/></>,
    edit: <><path d="M14 4l6 6L8 22H2v-6z"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7v13a2 2 0 002 2h8a2 2 0 002-2V7"/></>,
    eyeOff: <><path d="M3 3l18 18"/><path d="M10.6 6.2A10.5 10.5 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.3 3.9M6.6 7.6C3.7 9.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
    phone: <><path d="M5 4h4l2 5-3 2c1 3 4 6 7 7l2-3 5 2v4a2 2 0 01-2 2C9 22 2 15 2 6a2 2 0 012-2"/></>,
    msg: <><path d="M3 6a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2h-7l-5 4v-4H5a2 2 0 01-2-2z"/></>,
    file: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></>,
    layers: <><path d="M12 2L2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/></>,
    package: <><path d="M12 2l9 4v12l-9 4-9-4V6z"/><path d="M3 7l9 4 9-4M12 22V11"/></>,
    repeat: <><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>,
    alert: <><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.5L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.5a2 2 0 00-3.4 0z"/></>,
    star: <><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></>,
    sparkles: <><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/></>,
    grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    move: <><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></>,
    bookmark: <><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></>,
    history: <><path d="M3 3v6h6"/><path d="M3.5 9A9 9 0 1 0 6 5.5L3 9"/><path d="M12 7v5l4 2"/></>,
    filter: <><path d="M3 4h18l-7 9v7l-4-2v-5z"/></>,
    sort: <><path d="M3 7h13M3 12h9M3 17h5M14 15l3 3 3-3M17 6v12"/></>,
    print: <><path d="M6 9V3h12v6M6 18h12v4H6zM6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/></>,
    save: <><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM7 3v6h10V3M7 21v-8h10v8"/></>,
    link: <><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></>,
    arrows: <><path d="M7 4v16M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4"/></>,
    book: <><path d="M4 19V5a2 2 0 012-2h14v18H6a2 2 0 01-2-2zM20 18H6"/></>,
    flag: <><path d="M4 21V4a1 1 0 011-1h10l-1 4 1 4H5"/></>,
    spinner: <><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {paths[name] || null}
    </svg>
  );
}

/* ===== Status badge ===== */
function StatusBadge({ status }) {
  return <span className={`badge dot ${statusClass(status)}`}>{status}</span>;
}

function PriorityBadge({ priority }) {
  const cls = priority === 'Critical' ? 'danger' : priority === 'Urgent' ? 'warning' : '';
  return <span className={`badge ${cls}`}>{priority}</span>;
}

function Avatar({ user, size = 22 }) {
  if (!user) return <span className="muted">—</span>;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))', color: 'var(--accent)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 600, fontFamily: 'var(--mono)',
      flexShrink: 0,
    }}>{user.initials}</span>
  );
}

/* Number with delta arrow */
function Delta({ value }) {
  if (value > 0) return <span className="kpi-delta up"><Icon name="arrowRight" size={11} />+{value}% vs prev</span>;
  if (value < 0) return <span className="kpi-delta down"><Icon name="arrowRight" size={11} />{value}% vs prev</span>;
  return <span className="kpi-delta">— flat vs prev</span>;
}

/* Toggle pill */
function Toggle({ value, onChange }) {
  return <div className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}/>;
}

/* Toast host */
const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-host">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => useContext(ToastCtx);

/* Modal */
// A dialog you can work without a mouse.
//
//   Esc          closes THIS one, and only if it is the top one. Every dialog
//                used to listen on the window, so Escape closed all of them at
//                once and a dialog opened from a dialog took its parent down.
//   Tab          stays inside. Tabbing out of a dialog and into the page behind
//                it is how somebody edits the wrong record.
//   on open      the first field takes focus, so typing can start straight away
//   on close     focus goes back where it came from, not to the top of the page
function Modal({ title, children, onClose, footer, size }) {
  const ref = React.useRef(null);
  const openerRef = React.useRef(null);
  const idRef = React.useRef('modal-' + Math.random().toString(36).slice(2));
  // Read through a ref so the listener is installed once and still calls the
  // caller's current handler — re-installing it on every render would reorder
  // the stack and let a parent dialog close before its child.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    openerRef.current = document.activeElement;
    const pop = window.opcOverlayPush ? window.opcOverlayPush(idRef.current) : null;

    // Focus the first thing worth typing into — but never a field the user has
    // to scroll to find, and never a checkbox they might toggle by pressing
    // space to scroll.
    const t = setTimeout(() => {
      const box = ref.current;
      if (!box) return;
      if (box.contains(document.activeElement)) return;
      const first = box.querySelector(
        '.modal-body input:not([type="checkbox"]):not([type="radio"]):not([disabled]),' +
        '.modal-body textarea:not([disabled]), .modal-body select:not([disabled])');
      if (first && first.focus) { try { first.focus(); if (first.select) first.select(); } catch (e) {} }
      else if (box.focus) { try { box.focus(); } catch (e) {} }
    }, 0);

    // Escape listens on the window, not on the dialog. On the dialog it would
    // only work while focus happened to be inside it, and the one key somebody
    // presses to get out has to work every time.
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (window.opcOverlayTop && window.opcOverlayTop() !== idRef.current) return;  // not the top one
      onCloseRef.current && onCloseRef.current();
    };
    window.addEventListener('keydown', onEsc);

    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onEsc);
      if (pop) pop(); else if (window.opcOverlayPop) window.opcOverlayPop(idRef.current);
      const back = openerRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) {
        try { back.focus(); } catch (e) {}
      }
    };
  }, []);

  const onKeyDown = (e) => {
    // ---- Enter walks the form -------------------------------------------
    // Filling a dialog is the slowest thing anybody does in here, and reaching
    // for Tab between every field is why. Enter goes to the next field and, on
    // the last one, presses the primary button — which is how every accounting
    // package this replaces has worked for thirty years.
    //
    // ONLY from a single-line input. A textarea needs its newline, a select
    // and a button already do something with Enter, and a field can opt out
    // with data-kbd-enter="ignore".
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && ref.current) {
      const el = document.activeElement;
      const tag = el && String(el.tagName || '').toUpperCase();
      const type = el ? String(el.type || 'text').toLowerCase() : '';
      const plain = tag === 'INPUT'
        && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(type)
        && el.getAttribute('data-kbd-enter') !== 'ignore';
      if (plain) {
        const fields = Array.from(ref.current.querySelectorAll(
          '.modal-body input:not([type="checkbox"]):not([type="radio"]):not([type="button"])'
          + ':not([type="submit"]):not([type="file"]):not([disabled]):not([readonly]),'
          + ' .modal-body select:not([disabled]), .modal-body textarea:not([disabled])'))
          .filter(x => x === el || (window.kbdVisible ? window.kbdVisible(x) : x.offsetParent !== null));
        const at = fields.indexOf(el);
        const next = at >= 0 ? fields[at + 1] : null;
        if (next) {
          e.preventDefault();
          try { next.focus(); if (next.select) next.select(); } catch (err) {}
          return;
        }
        // Last field: do what the dialog is for.
        const btn = ref.current.querySelector('.modal-footer .btn-primary:not([disabled])');
        if (btn) { e.preventDefault(); btn.click(); }
        return;
      }
    }

    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = Array.from(ref.current.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
      ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(el => el === document.activeElement
                 || (window.kbdVisible ? window.kbdVisible(el) : el.offsetParent !== null));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${size || ''}`} ref={ref} tabIndex={-1}
           role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
           onKeyDown={onKeyDown}
           onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ===== Party name mapping =====
// One physical item carries three names: the customer's, ours, and the vendor's.
// This hook fetches the outer name for ONE party, as { product_id: {code,name,uom} }.
//
// Cached per (scope, party) for the life of the tab: a vendor's part numbers do
// not change while a PO is open, and the box is small — re-fetching on every
// render of every line would be the expensive way to be correct.
const __aliasCache = {};
function useAliasMap(scope, partyId) {
  const key = String(scope || '') + '|' + String(partyId || '');
  const [map, setMap] = React.useState(() => __aliasCache[key] || {});
  React.useEffect(() => {
    let dead = false;
    if (!window.OPC_SB || !scope || !partyId) { setMap({}); return; }
    if (__aliasCache[key]) { setMap(__aliasCache[key]); return; }
    (async () => {
      try {
        const r = await window.OPC_SB.rpc('opc_alias_map', { p_scope: scope, p_party_id: partyId });
        if (dead) return;
        const m = (!r.error && r.data && typeof r.data === 'object') ? r.data : {};
        __aliasCache[key] = m;
        setMap(m);
      } catch (e) { if (!dead) setMap({}); }   // fail open -> our own names
    })();
    return () => { dead = true; };
  }, [key]);
  return map;
}
// Call after writing a mapping so open screens pick it up.
function invalidateAliasMap(scope, partyId) {
  if (scope == null) { Object.keys(__aliasCache).forEach(k => delete __aliasCache[k]); return; }
  delete __aliasCache[String(scope) + '|' + String(partyId || '')];
}

// Resolve the name to PRINT for one line, honouring the org's po_item_language.
// Always returns both, so a screen can show the counterpart underneath and
// nobody has to guess which catalogue a code belongs to.
function partyItemName(aliasMap, product, mode) {
  const a = (aliasMap || {})[product ? product.id : ''] || null;
  const ourCode = product ? (product.code || '') : '';
  const ourName = product ? (product.name || '') : '';
  const useTheirs = mode === 'vendor' || mode === 'customer';
  const theirCode = a && a.code ? a.code : '';
  const theirName = a && a.name ? a.name : '';
  const mapped = !!(theirCode || theirName);
  if (useTheirs && mapped) {
    return { code: theirCode || ourCode, name: theirName || ourName,
             altCode: ourCode, altName: ourName, mapped: true, uom: a.uom || null };
  }
  return { code: ourCode, name: ourName,
           altCode: theirCode, altName: theirName, mapped: mapped, uom: a ? a.uom : null };
}

// A quantity as a person would write it. 1 rather than 1.0000, 2.5 rather than
// 2.5000, and a value that is a hair off a whole number — the residue of
// dividing by a bundle size — shown as the whole number it is meant to be.
function qty(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return String(Math.round(v * 1000) / 1000);
}

// ===========================================================================
// Tax on a purchase order line
// ===========================================================================
// A flat 18% on everything is not how purchasing works. Within one state a line
// is CGST+SGST (9+9); across states it is IGST (18). Labour and professional
// charges carry TDS, which is WITHHELD from what we pay the vendor rather than
// added to it. TCS is collected on top.
//
// `sign` is the whole point: getting it backwards turns a deduction into a
// surcharge and the vendor is paid the wrong amount.
const TAX_KINDS = [
  { key: 'none',      label: 'No tax',            short: 'None',      rate: 0,  sign: 0,  split: false },
  { key: 'cgst_sgst', label: 'CGST + SGST',       short: 'CGST+SGST', rate: 18, sign: 1,  split: true  },
  { key: 'igst',      label: 'IGST',              short: 'IGST',      rate: 18, sign: 1,  split: false },
  { key: 'tds_labour',label: 'TDS — Labour',      short: 'TDS (Lab)', rate: 2,  sign: -1, split: false },
  { key: 'tds_prof',  label: 'TDS — Professional',short: 'TDS (Prof)',rate: 10, sign: -1, split: false },
  { key: 'tcs',       label: 'TCS',               short: 'TCS',       rate: 0.1,sign: 1,  split: false },
];
const taxKind = (key) => TAX_KINDS.find(t => t.key === key) || TAX_KINDS[0];

// Common GST rates, offered rather than typed.
const GST_RATES = [0, 5, 12, 18, 28];

// How the tax reads on the document: "CGST+SGST 9+9%", "IGST 18%",
// "TDS (Lab) 2%". A split tax shows both halves, because that is what the
// invoice has to show.
function taxLabel(key, rate) {
  const k = taxKind(key);
  const r = rate == null ? k.rate : Number(rate);
  if (k.key === 'none') return '—';
  if (k.split) {
    const half = Math.round((r / 2) * 100) / 100;
    return `${k.short} ${half}+${half}%`;
  }
  return `${k.short} ${r}%`;
}

// One tax, on one amount. `tax` is negative for a withholding.
function taxOn(amount, key, rate) {
  const k = taxKind(key);
  const r = rate == null ? k.rate : (Number(rate) || 0);
  const tax = Math.round(amount * (r / 100) * k.sign * 100) / 100;
  return { tax, total: Math.round((amount + tax) * 100) / 100, label: taxLabel(key, r), sign: k.sign, rate: r };
}

// A LIST of taxes on one amount.
//
// A line routinely carries more than one: IGST and TDS together, or GST and TCS.
// They are not alternatives, so they stack.
//
// Every tax is computed on the TAXABLE VALUE — the amount before any tax — not
// on a running total. Compounding one tax onto another would make the result
// depend on the order they were added in, which is both wrong and impossible to
// explain to whoever checks the invoice.
function taxesOn(amount, taxes) {
  const list = normaliseTaxes(taxes);
  const parts = list.map(t => {
    const k = taxKind(t.key);
    const r = t.rate == null ? k.rate : (Number(t.rate) || 0);
    return { key: t.key, rate: r, sign: k.sign, label: taxLabel(t.key, r),
             amount: Math.round(amount * (r / 100) * k.sign * 100) / 100 };
  });
  const tax = Math.round(parts.reduce((a, p) => a + p.amount, 0) * 100) / 100;
  return {
    parts, tax,
    total: Math.round((amount + tax) * 100) / 100,
    label: parts.length ? parts.map(p => p.label).join(' · ') : '—',
  };
}

// Accepts a list, a single {key,rate}, or nothing — so a PO saved before taxes
// could stack still reads correctly.
function normaliseTaxes(v) {
  if (Array.isArray(v)) return v.filter(t => t && t.key && t.key !== 'none');
  if (v && v.key) return v.key === 'none' ? [] : [v];
  return [];
}

// The taxes on one line of a PO. Falls back to the PO default, then to IGST 18
// — what every existing e-Bill was printed with, so nothing already issued
// changes meaning.
function poLineTaxes(po, productId) {
  const cfg = (po && po.tax_config) || {};
  const lines = cfg.lines || {};
  if (Object.prototype.hasOwnProperty.call(lines, productId)) return normaliseTaxes(lines[productId]);
  if (cfg.default !== undefined) return normaliseTaxes(cfg.default);
  return [{ key: 'igst', rate: 18 }];
}

// Kept for the single-tax callers; the plural is the one to use.
function poLineTax(po, productId) {
  const list = poLineTaxes(po, productId);
  return list.length ? list[0] : { key: 'none', rate: 0 };
}

// The PO's real grand total, summed from each line's own real tax config —
// never a flat rate. The one calculation poEbillHtml's own printable
// document already does line by line; a caller that needs just the number
// (not the document) uses this instead of re-deriving it with a flat
// constant, which is exactly how VendorPODetail's header and the e-Bill
// "Amount" field used to drift from what the Document tab actually prints.
function poGrandTotal(po) {
  let total = 0;
  (po.items || []).forEach(it => {
    const base = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    total += taxesOn(base, poLineTaxes(po, it.product_id)).total;
  });
  return Math.round(total * 100) / 100;
}

// A total per tax kind, for the summary at the foot of a document. An invoice
// has to show how much GST and how much TDS, not one blended figure.
function taxSummary(rows) {
  const by = {};
  (rows || []).forEach(r => {
    taxesOn(r.amount, r.taxes).parts.forEach(p => {
      const id = p.key + '@' + p.rate;
      if (!by[id]) by[id] = { key: p.key, rate: p.rate, label: p.label, amount: 0 };
      by[id].amount = Math.round((by[id].amount + p.amount) * 100) / 100;
    });
  });
  return Object.keys(by).map(k => by[k]);
}

// ===========================================================================
// Document numbers
// ===========================================================================
// One scheme, one place. Every document number in the system is built here so
// two screens cannot invent two different formats for the same kind of paper —
// which is how VPO/FY26/0043 and 0044 ended up sharing one e-Bill number.
//
//   Vendor PO          PO202609001     prefix + year + month + sequence
//   Delivery challan   DC202609001     same shape
//   Vendor invoice     INV202609001    the PO's own number, re-prefixed
//   PO e-Bill          EB202609001     likewise
//   Client invoice     INV<SO number>  the customer's own order reference
//
// The sequence runs within a year+month, because the prefix already carries
// both. A new month starts again at 001.

// Just the digits and letters, upper-cased — for turning "VPO/FY26/0044" or
// "ABG/2026/0117" into something that can sit inside a document number.
function docStem(v) {
  return String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// PREFIX + YYYYMM + NNN, continuing from the highest already issued this month.
//
// Derived from what exists rather than from a stored counter, so it is
// self-healing: an import, a restore or a row deleted by hand cannot leave the
// counter pointing at a number already in use.
function docNo(prefix, existing, dateStr) {
  const src = String(dateStr || TODAY);
  const stem = String(prefix).toUpperCase() + src.slice(0, 4) + src.slice(5, 7);
  let max = 0;
  (existing || []).forEach(v => {
    const n = docStem(v);
    if (n.indexOf(stem) !== 0) return;
    const tail = parseInt(n.slice(stem.length).replace(/\D/g, ''), 10);
    if (isFinite(tail) && tail > max) max = tail;
  });
  return stem + String(max + 1).padStart(3, '0');
}

// A billing group carved out of an order's bill of materials.
const boqNo        = (state, date) => docNo('BOQ', ((state && state.sales_orders) || [])
  .flatMap(so => ((so.extra && so.extra.boqs) || []).map(b => b.no)), date);
const vendorPoNo   = (state, date) => docNo('PO', ((state && state.vendor_pos) || []).map(p => p.po_no), date);
const challanNo    = (state, date) => docNo('DC', ((state && state.outward_dispatches) || []).map(d => d.dc_no), date);

// A vendor's invoice and the PO e-Bill both belong to ONE purchase order, so
// they are that PO's number wearing a different prefix. No counter, no
// collision, and the three documents read against each other at a glance.
function reprefix(poNo, prefix) {
  const n = docStem(poNo).replace(/^PO/, '');
  return prefix + (n || docStem(poNo));
}
const vendorInvoiceNo = (poNo) => reprefix(poNo, 'INV');
const poEbillNoFor    = (poNo) => reprefix(poNo, 'EB');

// The client's invoice carries THEIR order number, because that is what they
// will match it against.
//
// An order can carry several invoices — with invoicing on dispatch that is the
// normal case, not the exception — so the first takes the plain number and any
// further one is suffixed. Two invoices sharing a number is a compliance
// problem, not a cosmetic one.
function clientInvoiceNo(soNo, existingNos) {
  const base = 'INV' + docStem(soNo);
  const taken = new Set((existingNos || []).map(v => String(v || '')));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + '-' + n)) n++;
  return base + '-' + n;
}

// ===== Sales order numbers =====
// A suggestion only. Purchase overwrite it with the customer's own reference,
// which is the number everybody actually quotes.
function nextSoNo(state) {
  const n = ((state && state.sales_orders) || []).length;
  return `SO/FY26/${String(17 + n).padStart(4, '0')}`;
}

// Is this number free? Compared case-insensitively and ignoring surrounding
// space, because "so/fy26/0003 " and "SO/FY26/0003" are the same order to a
// human and would be two to a database.
function soNoTaken(state, no, exceptId) {
  const want = String(no || '').trim().toLowerCase();
  if (!want) return false;
  return ((state && state.sales_orders) || []).some(
    s => s.id !== exceptId && String(s.so_no || '').trim().toLowerCase() === want);
}

// ===== What an order needs =====
// A line holds `bundle_qty` sets of its components, and each component's `qty`
// is PER SET. The total is therefore qty x bundle_qty, and forgetting the
// multiplication silently under-states the requirement by the bundle factor.
// Everything that asks "how much of this item does this order need" must come
// through here so the answer cannot differ between screens.
function soRequired(so) {
  const m = {};
  ((so && so.lines) || []).forEach(l => {
    const sets = Number(l.bundle_qty) || 1;
    ((l.components) || []).forEach(c => {
      m[c.product_id] = (m[c.product_id] || 0) + (Number(c.qty) || 0) * sets;
    });
  });
  return m;
}
// The same thing as a list, for screens that render rows.
function soRequiredList(so) {
  const m = soRequired(so);
  return Object.keys(m).map(product_id => ({ product_id, qty: m[product_id] }));
}

// ===== A vendor PO shared across more than one Sales Order =====
// A PO's `so_id` has always meant "the whole PO belongs to this one order."
// Most POs still do — these five functions are the ONLY place that changes,
// and only when a line explicitly says so. `it.so_alloc` / grnItem.so_split
// are optional: [{ so_id, qty }], written ONLY when ≥2 SOs genuinely share a
// line (never a 1-entry array — that would just be a second, redundant way
// to say "100% to one SO"). Absent means exactly what it always meant: the
// whole line/receipt belongs to po.so_id. Every caller below degrades to
// that historic behaviour automatically, so a single-SO PO — still the
// overwhelming majority, forever — is provably unaffected.
// See docs/multi-so-vendor-po.md.

// How much of ONE PO LINE's ordered qty belongs to ONE SO.
function poLineSoQty(po, productId, soId) {
  const it = ((po && po.items) || []).find(x => x.product_id === productId);
  if (!it) return 0;
  if (Array.isArray(it.so_alloc) && it.so_alloc.length) {
    const a = it.so_alloc.find(x => x.so_id === soId);
    return a ? (Number(a.qty) || 0) : 0;
  }
  return soId === po.so_id ? (Number(it.qty) || 0) : 0;
}

// How much of ONE GRN LINE's accepted qty (one receipt event) belongs to ONE
// SO. `grnItem` is one entry of grn.items; `po` is that GRN's own PO (needed
// only for the po.so_id fallback — a GRN itself never stores so_id).
function grnLineSoQty(grnItem, po, soId) {
  if (!grnItem) return 0;
  if (Array.isArray(grnItem.so_split) && grnItem.so_split.length) {
    const a = grnItem.so_split.find(x => x.so_id === soId);
    return a ? (Number(a.qty) || 0) : 0;
  }
  return soId === (po && po.so_id) ? (Number(grnItem.accepted) || 0) : 0;
}

// Every SO this PO currently serves. DERIVED from po.so_id ∪ every line's
// so_alloc, never stored separately — so it can never drift from the
// per-line truth the way a cached list could.
function poLinkedSoIds(po) {
  const ids = new Set([po && po.so_id].filter(Boolean));
  ((po && po.items) || []).forEach(it => (it.so_alloc || []).forEach(a => { if (a.so_id) ids.add(a.so_id); }));
  return Array.from(ids);
}
function poServesSO(po, soId) { return poLinkedSoIds(po).indexOf(soId) !== -1; }

// This SO's own share of the PO's value — never the whole PO's amount,
// which is what reading po.amount directly would wrongly attribute to every
// SO sharing it.
function poSoAmount(po, soId) {
  return ((po && po.items) || []).reduce((s, it) => s + poLineSoQty(po, it.product_id, soId) * (Number(it.rate) || 0), 0);
}

// ===== What an item costs us =====
// In order of trust: what we actually last paid a vendor, then the catalogue's
// standard cost. Vendor POs are already in memory, so this needs no round trip.
// `vendorId` narrows it to one vendor's own last price.
function lastBuyOf(state, productId, vendorId) {
  let best = null;
  ((state && state.vendor_pos) || []).forEach(po => {
    if (['Rejected', 'Cancelled'].indexOf(po.status) !== -1) return;
    if (vendorId && po.vendor_id !== vendorId) return;
    (po.items || []).forEach(it => {
      if (it.product_id !== productId) return;
      const d = po.date || '';
      if (!best || d > best.date) {
        best = { vendor_id: po.vendor_id, rate: Number(it.rate) || 0, date: d, po_no: po.po_no };
      }
    });
  });
  return best;
}

// A single number for cost, with where it came from — never a bare guess.
//   actual    we have bought it; this is what we paid
//   catalogue the standard cost on the item
//   none      we have no idea yet, and the UI must say so
function itemCost(state, productId) {
  const last = lastBuyOf(state, productId, null);
  if (last && last.rate > 0) return { cost: last.rate, source: 'actual', po_no: last.po_no, date: last.date };
  const p = ((state && state.products) || []).find(x => x.id === productId);
  if (p && Number(p.buy) > 0) return { cost: Number(p.buy), source: 'catalogue' };
  return { cost: 0, source: 'none' };
}

Object.assign(window, {
  qty, TAX_KINDS, GST_RATES, taxKind, taxLabel, taxOn, taxesOn, normaliseTaxes,
  poLineTax, poLineTaxes, taxSummary,
  docStem, docNo, boqNo, vendorPoNo, challanNo, reprefix, vendorInvoiceNo, poEbillNoFor, clientInvoiceNo,
  nextSoNo, soNoTaken, soRequired, soRequiredList, lastBuyOf, itemCost,
  poLineSoQty, grnLineSoQty, poLinkedSoIds, poServesSO, poSoAmount,
  soStageIndex, soAdvanceStatus, soDerivedStatus, soEffectiveStatus, SO_MANUAL_STATES,
  soDispatchedQty, soClientReview, soRejectedOutstanding, soUnfulfilled,
  inrFmt, inr, inrK, fmtDate, addDays, daysBetween, TODAY, statusClass, SO_LIFECYCLE,
  Icon, StatusBadge, PriorityBadge, Avatar, Delta, Toggle, Modal,
  ToastProvider, useToast,
  useAliasMap, invalidateAliasMap, partyItemName,
});

// ===== Phone/tablet: a page with several table sections gets dropdown cards ====
// When a page shows two or more cards that each hold a heading and a table
// (RFQ comparison per project, a godown's sections, an order's linked POs…),
// on a small screen each heading becomes a dropdown: tap to open/close that
// card; the first starts open. Done with data-* attributes + one delegated click
// handler, never by changing React's elements, so no screen is edited and a
// re-render cannot undo or crash it (React does not manage attributes it did not
// set). A page with a single table card is left alone, and so is anything inside
// a dialog or drawer. styles.css (.card[data-collapsible]) does the drawing.
(function opcCollapsibleCards() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body || !window.matchMedia) return;
  if (window.__opcCollapsibleCards) return;
  window.__opcCollapsibleCards = true;
  const mq = window.matchMedia('(max-width: 900px)');
  const eligible = (card) => {
    const head = card.firstElementChild;
    if (!head || !head.classList.contains('card-header')) return false;
    if (card.closest('.modal, .drawer, .grp-body, .kbd-palette')) return false;
    return !!card.querySelector('table');
  };
  const run = () => {
    const main = document.querySelector('.main');
    if (!main) return;
    const cards = Array.from(main.querySelectorAll('.card')).filter(eligible);
    const on = mq.matches && cards.length >= 2;
    main.querySelectorAll('.card[data-collapsible]').forEach(c => {
      if (!on || cards.indexOf(c) < 0) { c.removeAttribute('data-collapsible'); c.removeAttribute('data-collapsed'); const h = c.firstElementChild; if (h) { h.removeAttribute('tabindex'); h.removeAttribute('role'); h.removeAttribute('aria-expanded'); } }
    });
    if (!on) return;
    let first = !main.querySelector('.card[data-collapsible]');
    cards.forEach(c => {
      const h = c.firstElementChild;
      if (!c.hasAttribute('data-collapsible')) {
        c.setAttribute('data-collapsible', '1');
        if (first) first = false; else c.setAttribute('data-collapsed', '1');
        h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0');
      }
      h.setAttribute('aria-expanded', c.hasAttribute('data-collapsed') ? 'false' : 'true');
    });
  };
  const toggle = (card) => {
    if (card.hasAttribute('data-collapsed')) card.removeAttribute('data-collapsed'); else card.setAttribute('data-collapsed', '1');
    const h = card.firstElementChild; if (h) h.setAttribute('aria-expanded', card.hasAttribute('data-collapsed') ? 'false' : 'true');
  };
  document.addEventListener('click', (e) => {
    const head = e.target.closest && e.target.closest('.card[data-collapsible] > .card-header');
    if (!head || e.target.closest('button, a, input, select, textarea, label')) return;
    toggle(head.parentElement);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const head = e.target.closest && e.target.closest('.card[data-collapsible] > .card-header');
    if (!head || e.target !== head) return;
    e.preventDefault(); toggle(head.parentElement);
  });
  let q = 0;
  const sched = () => { if (!q) q = setTimeout(() => { q = 0; run(); }, 40); };
  new MutationObserver(sched).observe(document.body, { childList: true, subtree: true });   // attributes are not observed, so this cannot loop
  if (mq.addEventListener) mq.addEventListener('change', sched);
  sched();
})();

// ===== Phone tables: keep the 2-3 columns that matter, the rest one tap away ====
// A list with ten columns cannot be read on a phone, and a card per row makes lists
// very long. So on a phone (<= 600px) each table shows only its key columns, and every
// row has a chevron at its right edge: tap it and the other columns open beneath that row
// as "Label | value" lines; tap again to close.
//   * Which columns stay: table.dataset.keep ("Item,Qty,Chosen vendor", matched on the
//     header text) when a screen names them; otherwise the first column plus the best
//     two by header (name/customer/vendor/item, then status, then amount, then qty).
//   * Done with data-* attributes and CSS only — no element is added, moved or re-classed,
//     so React is never disturbed and a re-render cannot undo it (the observer re-stamps).
//   * The chevron is tr::after, so a tap on it has target === the <tr>; a tap on any cell
//     still reaches the row's own click (open the record). One capture listener tells them
//     apart and stops the row click when it is the chevron.
//   * A table with <= 3 labelled columns, a colspan banner row, or className "t-keep" is
//     left exactly as it was.
(function opcMobileTables() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body || !window.matchMedia) return;
  if (window.__opcMobileTables) return;
  window.__opcMobileTables = true;
  const mq = window.matchMedia('(max-width: 600px)');
  const score = (h, i, first) => {
    if (i === first) return 100;
    if (/customer|vendor|party|name|item|description|product|component|bundle|category/i.test(h)) return 60;
    if (/action|event|activity|entity|reference|type/i.test(h)) return 55;
    if (/status/i.test(h)) return 50;
    if (/total|amount|value|price|cost|rate|balance|margin/i.test(h)) return 40;
    if (/qty|quantity|units/i.test(h)) return 35;
    if (/date/i.test(h)) return 20;
    return 0;
  };
  const run = () => {
    document.querySelectorAll('table.t').forEach(t => {
      const head = t.tHead && t.tHead.rows.length === 1 ? t.tHead.rows[0] : null;
      const off = () => { if (t.hasAttribute('data-mt')) { t.removeAttribute('data-mt'); t.querySelectorAll('[data-m],[data-label],[data-mx],[data-open]').forEach(e => { e.removeAttribute('data-m'); e.removeAttribute('data-label'); e.removeAttribute('data-mx'); e.removeAttribute('data-open'); }); } };
      if (!mq.matches || !head || t.classList.contains('t-keep')) { off(); return; }
      const heads = Array.from(head.cells).map(c => c.textContent.trim());
      const labelled = heads.map((h, i) => i).filter(i => heads[i]);
      if (labelled.length <= 3) { off(); return; }
      // data-full: columns that stay visible but take the row's full width on their own line
      // (a cell of tappable vendor options, a long note) instead of being squeezed into a column.
      // data-wide: a folded column that, when its row is opened, takes the whole row width (and not the
      // narrow "label | value" column) — for a cell too big to fit beside its label.
      const wideNames = (t.getAttribute('data-wide') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      const fullNames = (t.getAttribute('data-full') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      let keep;
      const named = (t.getAttribute('data-keep') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      if (named.length) keep = labelled.filter(i => named.indexOf(heads[i].toLowerCase()) !== -1);
      const fullIdx = labelled.filter(i => fullNames.indexOf(heads[i].toLowerCase()) !== -1);
      if (!keep || !keep.length) {
        const first = labelled[0];
        keep = labelled.map(i => ({ i, s: score(heads[i], i, first) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 3).map(x => x.i).sort((a, b) => a - b);
      }
      t.setAttribute('data-mt', '1');
      const mark = (cells, isHead) => {
        let col = 0;
        Array.from(cells).forEach(td => {
          const i = col; col += td.colSpan || 1;
          if ((td.colSpan || 1) > 1) return;
          const label = heads[i];
          if (label) td.setAttribute('data-label', label);
          // kept column: shown. A column with a heading that is not kept: folded away.
          // A column with no heading and nothing to press (the row's ">"): never shown.
          let m = '';
          if (label) m = fullIdx.indexOf(i) !== -1 ? 'f' : (keep.indexOf(i) === -1 ? 'x' : '');
          else m = (td.querySelector('button, input, select, textarea') && (td.textContent.trim() || td.querySelector('input, select, textarea'))) ? 'x' : 'h';   // icon-only cells (the row's ">", a trash can) are decoration here
          if (isHead && !label) m = 'h';
          // A folded cell with nothing in it (no text, nothing to press) has nothing to show, so it is
          // never shown; a row whose folded cells are ALL like that gets no chevron (data-mx below).
          if (m === 'x' && !isHead && !td.textContent.trim() && !td.querySelector('button, input, select, textarea, img')) m = 'h';
          if (m) td.setAttribute('data-m', m); else td.removeAttribute('data-m');
          if (label && wideNames.indexOf(label.toLowerCase()) !== -1) td.setAttribute('data-w', '1'); else td.removeAttribute('data-w');
        });
      };
      mark(head.cells, true);
      Array.from(t.tBodies).forEach(b => Array.from(b.rows).forEach(tr => {
        if (Array.from(tr.cells).some(td => (td.colSpan || 1) > 1)) { tr.setAttribute('data-span', '1'); return; }
        mark(tr.cells, false);
        if (tr.querySelector('[data-m="x"]')) tr.setAttribute('data-mx', '1'); else tr.removeAttribute('data-mx');
      }));
    });
  };
  // Tapping anywhere on a row opens/closes its details — not only the chevron. The exceptions are
  // real controls: a link (the SO / PO number), a button, a field. Those do what they always did, so
  // the record still opens from its number, and the folded lines (once open) stay selectable.
  document.addEventListener('click', (e) => {
    if (!mq.matches || !e.target.closest) return;
    const tr = e.target.closest('table.t[data-mt] > tbody > tr[data-mx]');
    if (!tr) return;
    if (e.target.closest('a, button, input, select, textarea, label, [role="button"]') && e.target.closest('a, button, input, select, textarea, label, [role="button"]') !== tr) return;
    e.stopPropagation(); e.preventDefault();
    if (tr.hasAttribute('data-open')) tr.removeAttribute('data-open'); else tr.setAttribute('data-open', '1');
  }, true);
  let q = 0;
  const sched = () => { if (!q) q = setTimeout(() => { q = 0; run(); }, 40); };
  new MutationObserver(sched).observe(document.body, { childList: true, subtree: true });   // attributes are not observed, so this cannot loop
  if (mq.addEventListener) mq.addEventListener('change', sched);
  sched();
})();

// ===== Phone: a strip of 4+ tabs becomes ONE dropdown ===========================
// Overview | Line items | Procurement | Vendor POs | GRN | Invoicing | … scrolled sideways on a
// phone and hid most of itself. At <= 600px a .tabs strip with four or more tabs shows only the
// ACTIVE tab, with a chevron; tapping it lists the rest, and picking one closes the list. Done with
// data-tdd / data-open on the strip and one capture-phase click handler — the tab buttons stay React's
// own, so choosing a tab runs exactly the code it always did.
(function opcTabDropdowns() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body || !window.matchMedia) return;
  if (window.__opcTabDropdowns) return;
  window.__opcTabDropdowns = true;
  const mq = window.matchMedia('(max-width: 600px)');
  const run = () => {
    document.querySelectorAll('.tabs').forEach(t => {
      const n = t.querySelectorAll(':scope > .tab').length;
      if (mq.matches && n >= 4) t.setAttribute('data-tdd', '1');
      else { t.removeAttribute('data-tdd'); t.removeAttribute('data-open'); }
    });
  };
  document.addEventListener('click', (e) => {
    if (!mq.matches || !e.target.closest) return;
    const tab = e.target.closest('.tabs[data-tdd] > .tab');
    if (!tab) return;
    const strip = tab.parentElement;
    if (tab.classList.contains('active')) {                 // the shown one: open / close the list
      e.preventDefault(); e.stopPropagation();
      if (strip.hasAttribute('data-open')) strip.removeAttribute('data-open'); else strip.setAttribute('data-open', '1');
    } else {                                                // another tab: React switches to it, then fold the list
      setTimeout(() => strip.removeAttribute('data-open'), 0);
    }
  }, true);
  let q = 0;
  const sched = () => { if (!q) q = setTimeout(() => { q = 0; run(); }, 30); };
  new MutationObserver(sched).observe(document.body, { childList: true, subtree: true });
  if (mq.addEventListener) mq.addEventListener('change', sched);
  sched();
})();
