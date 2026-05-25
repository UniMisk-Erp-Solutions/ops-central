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

Object.assign(window, {
  inrFmt, inr, inrK, fmtDate, daysBetween, TODAY, statusClass, SO_LIFECYCLE,
  Icon, StatusBadge, PriorityBadge, Avatar, Delta, Toggle, Modal,
  ToastProvider, useToast,
});
