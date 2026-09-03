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

const SO_LIFECYCLE = [
  'Draft','Pending Approval','Approved','Procurement Started','Material Received',
  'Ready to Dispatch','Partially Delivered','Fully Delivered','Invoiced',
  'Payment Pending','Fully Paid','Closed'
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

  const pos = (state.vendor_pos || []).filter(p => p.so_id === so.id
    && ['Rejected', 'Cancelled'].indexOf(p.status) === -1);
  const poIds = new Set(pos.map(p => p.id));

  const received = {};
  (state.grns || []).forEach(g => { if (poIds.has(g.po_id)) (g.items || []).forEach(it => {
    received[it.product_id] = (received[it.product_id] || 0) + (Number(it.accepted) || 0);
  }); });
  (so.pool_alloc || []).forEach(a => {
    received[a.product_id] = (received[a.product_id] || 0) + (Number(a.qty) || 0);
  });
  const anyReceived = Object.keys(received).some(k => received[k] > 0);
  const allReceived = needed > 0 && Object.keys(required).every(k => (received[k] || 0) >= required[k]);

  const dcs = (state.outward_dispatches || []).filter(d => d.so_id === so.id && d.status !== 'Cancelled');
  const dispatched = {};
  dcs.forEach(d => (d.items || []).forEach(it => {
    dispatched[it.product_id] = (dispatched[it.product_id] || 0) + (Number(it.qty) || 0);
  }));
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
  if (invoiced && paid > 0) return 'Payment Pending';
  if (invoiced) return 'Invoiced';
  if (allDispatched) return 'Fully Delivered';
  if (anyDispatched) return 'Partially Delivered';
  if (allReceived) return 'Ready to Dispatch';
  if (anyReceived) return 'Material Received';
  if (pos.length) return 'Procurement Started';
  return null;   // nothing has happened yet — leave the stored status alone
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
    chevronRight: <><path d="M9 6l6 6-6 6"/></>,
    chevronLeft: <><path d="M15 6l-6 6 6 6"/></>,
    arrowRight: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    arrowLeftRight: <><path d="M7 4l-4 4 4 4M3 8h14M17 14l4 4-4 4M21 18H7"/></>,
    pin: <><path d="M12 2v8m-4 0h8l-2 4v8h-4v-8z"/></>,
    download: <><path d="M12 4v12m-4-4l4 4 4-4M4 20h16"/></>,
    upload: <><path d="M12 20V8m-4 4l4-4 4 4M4 4h16"/></>,
    edit: <><path d="M14 4l6 6L8 22H2v-6z"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7v13a2 2 0 002 2h8a2 2 0 002-2V7"/></>,
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
      background: 'oklch(0.92 0.02 250)', color: 'oklch(0.42 0.06 250)',
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
function Modal({ title, children, onClose, footer, size }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${size || ''}`} onClick={e => e.stopPropagation()}>
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

// The tax on one line, and the amount after it.
//   amount   qty x rate, before tax
//   returns  { tax, total, label }  — tax negative for a withholding
function taxOn(amount, key, rate) {
  const k = taxKind(key);
  const r = rate == null ? k.rate : (Number(rate) || 0);
  const tax = Math.round(amount * (r / 100) * k.sign * 100) / 100;
  return { tax, total: Math.round((amount + tax) * 100) / 100, label: taxLabel(key, r), sign: k.sign, rate: r };
}

// What tax applies to one line of a PO, from its tax_config.
// Falls back to the PO default, then to IGST 18 — which is what every existing
// e-Bill was printed with, so nothing already issued changes meaning.
function poLineTax(po, productId) {
  const cfg = (po && po.tax_config) || {};
  const line = (cfg.lines || {})[productId];
  const dflt = cfg.default;
  const pick = line || dflt || { key: 'igst', rate: 18 };
  return { key: pick.key || 'igst', rate: pick.rate == null ? taxKind(pick.key).rate : pick.rate };
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
  qty, TAX_KINDS, GST_RATES, taxKind, taxLabel, taxOn, poLineTax,
  docStem, docNo, vendorPoNo, challanNo, reprefix, vendorInvoiceNo, poEbillNoFor, clientInvoiceNo,
  nextSoNo, soNoTaken, soRequired, soRequiredList, lastBuyOf, itemCost,
  soStageIndex, soAdvanceStatus, soDerivedStatus, soEffectiveStatus, SO_MANUAL_STATES,
  inrFmt, inr, inrK, fmtDate, daysBetween, TODAY, statusClass, SO_LIFECYCLE,
  Icon, StatusBadge, PriorityBadge, Avatar, Delta, Toggle, Modal,
  ToastProvider, useToast,
  useAliasMap, invalidateAliasMap, partyItemName,
});
