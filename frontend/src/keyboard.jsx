// ============================================================================
// Keyboard control
// ============================================================================
// This software is used by accountants, who are faster and more accurate on a
// keyboard than on a mouse. Every screen can be driven without one.
//
//   arrows      move down and up a list; left goes back, right opens
//   Enter       open the row under the cursor
//   Space       tick the box on it
//   Ctrl+K, /   the command palette — every screen and record, by name
//   g then key  jump straight to a screen
//   ?           the list of every shortcut
//   Esc         close whatever is on top
//   in a dialog Tab stays inside it, Ctrl+Enter is the primary button
//
// THE WHOLE THING HANGS ON ONE RULE: a shortcut must never fire while somebody
// is typing. An accountant entering a quantity presses every letter on this
// list, and a stray "g" that navigates away mid-entry loses their work. So the
// decision of what a keystroke means is a PURE FUNCTION — kbdResolve — and it
// is tested against every guard rather than trusted.
//
// The second rule: the row cursor is DOM state, not React state. Rows come from
// forty screens written before this existed, none of which know about it.
// Reading them from the DOM means no screen had to change, and a screen written
// tomorrow gets keyboard control for free.
// ============================================================================

// --- What counts as "typing" ------------------------------------------------
// Text fields, dropdowns and anything contenteditable. A checkbox is NOT typing
// — Space must still tick it, and the arrows must still move the list.
function kbdIsTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = String(el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(t);
  }
  return false;
}

// --- What the browser already handles ---------------------------------------
// A focused button, link or checkbox acts on Enter and Space by itself. If this
// layer acted too, one press of Enter on a "Create" button would also open
// whatever row the cursor happened to be on — two things from one keystroke,
// and the second one invisible.
function kbdIsControl(el) {
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
  if (tag === 'INPUT') return true;                       // checkbox, radio, button
  const role = el.getAttribute ? el.getAttribute('role') : null;
  if (role === 'button' || role === 'link' || role === 'checkbox') return true;
  // Anything the app has deliberately put in the tab order, such as a nav item.
  const ti = el.getAttribute ? el.getAttribute('tabindex') : null;
  return ti != null && ti !== '-1';
}

// --- The resolver -----------------------------------------------------------
// e   { key, ctrlKey, metaKey, altKey, shiftKey, target }
// ctx { typing, overlay, pending }
//       typing   the focus is in a text field
//       overlay  the command palette or the help sheet is open, and owns the keys
//       control  focus is on a button, link or checkbox — it answers Enter and
//                Space itself, and this layer must not answer them as well
//       group    focus is inside a strip of tabs ('horizontal') or the sidebar
//                ('vertical'), where the arrows should move along it
//       pending  the previous keystroke was "g", so this one names a screen
//
// Returns null for anything the app should keep its hands off — which is most
// keystrokes, and deliberately so.
function kbdResolve(e, ctx) {
  const key = e.key;
  if (!key) return null;
  const mod = e.ctrlKey || e.metaKey;
  const typing = !!(ctx && ctx.typing);
  const overlay = !!(ctx && ctx.overlay);
  const control = !!(ctx && ctx.control);
  const group = ctx && ctx.group;                  // 'horizontal' | 'vertical' | null
  const pending = ctx && ctx.pending;

  // Ctrl+K opens the palette from anywhere at all, mid-word included: it is the
  // one key an accountant reaches for when they are lost, so it always answers.
  if (mod && !e.altKey && (key === 'k' || key === 'K')) return { action: 'palette' };

  // Escape closes the top thing, and gets out of a field, from anywhere.
  if (key === 'Escape') return { action: 'escape' };

  // Ctrl+Enter is "do the thing" — submit the dialog from inside any field.
  if (mod && key === 'Enter') return { action: 'primary' };

  // Everything below is a bare keystroke. Never while typing, and never as
  // part of a browser or OS combination (Ctrl+C, Alt+Tab, Cmd+R...).
  if (typing) return null;
  if (mod || e.altKey) return null;

  // The palette and the help sheet drive their own keys while they are open —
  // the list behind them must not move under a keystroke aimed at the overlay.
  // (Checked BEFORE the "g" sequence, so a jump can never start behind one.)
  if (overlay) return null;

  // "g" then a letter, for people who would rather not reach for the palette.
  if (pending === 'g') {
    const dest = KBD_GOTO[String(key).toLowerCase()];
    return dest ? { action: 'goto', route: dest } : { action: 'clear-pending' };
  }
  if (key === 'g') return { action: 'pending', pending: 'g' };

  // Enter and Space belong to whatever is focused, if anything is. A div that
  // was put in the tab order has no built-in Enter, so it is pressed here; a
  // real button has one, and the handler checks before pressing it twice.
  if (control && (key === 'Enter' || key === ' ')) return { action: 'activate' };

  // Inside a strip of tabs or the sidebar, the arrows move along it.
  if (group === 'horizontal' && key === 'ArrowRight') return { action: 'group-move', delta: 1 };
  if (group === 'horizontal' && key === 'ArrowLeft') return { action: 'group-move', delta: -1 };
  if (group === 'vertical' && key === 'ArrowDown') return { action: 'group-move', delta: 1 };
  if (group === 'vertical' && key === 'ArrowUp') return { action: 'group-move', delta: -1 };

  // With something focused, left and right belong to it. Going back in history
  // because somebody pressed left on a button is the kind of surprise that
  // loses work.
  if (control && (key === 'ArrowLeft' || key === 'ArrowRight')) return null;

  switch (key) {
    case 'ArrowDown':  return { action: 'row-move', delta: 1 };
    case 'ArrowUp':    return { action: 'row-move', delta: -1 };
    case 'PageDown':   return { action: 'row-move', delta: 10 };
    case 'PageUp':     return { action: 'row-move', delta: -10 };
    case 'Home':       return { action: 'row-first' };
    case 'End':        return { action: 'row-last' };
    case 'ArrowRight': return { action: 'row-open' };
    case 'Enter':      return { action: 'row-open' };
    case 'ArrowLeft':  return { action: 'back' };
    case ' ':          return { action: 'row-tick' };
    case '/':          return { action: 'search' };
    case '?':          return { action: 'help' };
    default:           return null;
  }
}

// "g" then this key. Only screens that exist; the handler still checks the role
// may see one, so this table can never widen anybody's access.
const KBD_GOTO = {
  d: 'dashboard',    t: 'inbox',        s: 'sales-orders', c: 'customers',
  q: 'sourcing',     g: 'godown',       m: 'scm',          l: 'pool',
  x: 'transfers',    r: 'rfq',          p: 'vendor-pos',   n: 'grn',
  w: 'three-way',    v: 'vendors',      i: 'invoices',     o: 'collections',
  b: 'products',     k: 'mapping',      a: 'audit',        u: 'settings',
};

// ============================================================================
// The row cursor
// ============================================================================
// Read from the DOM on every keystroke, never cached. Rows appear, disappear
// and re-render underneath this as the user filters and as data syncs; a cached
// list would go stale and move the cursor to the wrong row, which for somebody
// approving payments is the worst possible bug.

// The rows a person can actually act on. Every clickable row in this app is
// marked the same way — an inline cursor:pointer — so no screen needed changing
// to take part, and a screen written tomorrow joins in for free.
function kbdRows(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return [];
  const scope = d.querySelector('.modal-body') || d.querySelector('.main') || d.body;
  if (!scope || !scope.querySelectorAll) return [];
  const out = [];
  scope.querySelectorAll('table.t tbody tr').forEach(tr => {
    if (tr.getAttribute('data-kbd-skip') != null) return;
    let pointer = false;
    try {
      const styleAttr = String(tr.getAttribute('style') || '');
      pointer = /cursor\s*:\s*pointer/i.test(styleAttr);
      if (!pointer && typeof getComputedStyle === 'function') {
        pointer = getComputedStyle(tr).cursor === 'pointer';
      }
    } catch (err) { pointer = false; }
    if (pointer) out.push(tr);
  });
  return out;
}

// Where the cursor is now. Held as an attribute rather than a class because
// React rewrites className when a row re-renders and would wipe it; it does not
// touch attributes it never set.
function kbdCursorIndex(rows, doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!rows.length) return -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-kbd-cursor') != null) return i;
  }
  return -1;
}

function kbdSetCursor(rows, idx, doc) {
  rows.forEach(r => r.removeAttribute('data-kbd-cursor'));
  if (idx < 0 || idx >= rows.length) return null;
  const row = rows[idx];
  row.setAttribute('data-kbd-cursor', '1');
  if (typeof row.scrollIntoView === 'function') {
    try { row.scrollIntoView({ block: 'nearest' }); } catch (err) { /* jsdom */ }
  }
  return row;
}

// Move by delta, clamped. Starting from nothing lands on the first row going
// down and the last going up, which is what every list in every other program
// does.
function kbdMove(delta, doc) {
  const rows = kbdRows(doc);
  if (!rows.length) return null;
  const cur = kbdCursorIndex(rows, doc);
  let next;
  if (cur < 0) next = delta > 0 ? 0 : rows.length - 1;
  else next = Math.min(rows.length - 1, Math.max(0, cur + delta));
  return kbdSetCursor(rows, next, doc);
}

function kbdJump(where, doc) {
  const rows = kbdRows(doc);
  if (!rows.length) return null;
  return kbdSetCursor(rows, where === 'first' ? 0 : rows.length - 1, doc);
}

function kbdCurrentRow(doc) {
  const rows = kbdRows(doc);
  const i = kbdCursorIndex(rows, doc);
  return i >= 0 ? rows[i] : null;
}

// Open the row under the cursor. A real click, so the screen's own handler runs
// — this layer knows nothing about what any particular row does, and must not.
function kbdOpenRow(doc) {
  const row = kbdCurrentRow(doc);
  if (!row) return false;
  if (typeof row.click === 'function') { row.click(); return true; }
  return false;
}

// Space ticks the box on the row under the cursor, if it has one. Clicking the
// input itself fires the screen's onChange exactly as a mouse would.
function kbdTickRow(doc) {
  const row = kbdCurrentRow(doc);
  if (!row || !row.querySelector) return false;
  const box = row.querySelector('input[type="checkbox"]:not([disabled])');
  if (!box || typeof box.click !== 'function') return false;
  box.click();
  return true;
}

function kbdClearCursor(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return;
  d.querySelectorAll('[data-kbd-cursor]').forEach(r => r.removeAttribute('data-kbd-cursor'));
}

// ============================================================================
// Everything else you can click
// ============================================================================
// Half the controls in this app are a div with an onClick — tabs, cards, the
// colour swatches, the vendor chips, a document in a list, an order number
// rendered as text. A div is invisible to Tab, so none of them could be reached
// without a mouse, however many shortcuts existed.
//
// Rather than edit seventy of them by hand, they are found and fixed at runtime
// through the signal the app already uses to mean "you can click this": the
// pointer cursor.
//
// THE TRAP: `cursor` INHERITS. Every div inside a clickable row computes as
// pointer too, so getComputedStyle would put half the page in the tab order.
// What is read here is the element's OWN inline style — which React has already
// resolved, so `cursor: x ? 'pointer' : 'default'` reads as exactly one of them
// and a disabled control is correctly left out.
const KBD_CLICK_CLASSES = '.nav-item, .queue-item, .radio-card, .toggle, .kbd-palette-row';

function kbdIsClickable(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  // Already reachable, or not a control at all.
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY'].includes(tag)) return false;
  // Rows are driven by the arrow cursor, not by Tab — a hundred-row list would
  // otherwise take a hundred presses to get past. Cells go with them.
  if (['TR', 'TD', 'TH'].includes(tag)) return false;
  if (el.getAttribute('tabindex') != null) return false;         // already placed by hand
  // A dialog box and its backdrop take a click only to stop it propagating.
  // That is not something anybody wants to focus.
  if (el.classList && (el.classList.contains('modal') || el.classList.contains('modal-backdrop')
      || el.classList.contains('kbd-palette'))) return false;
  const own = !!(el.style && el.style.cursor === 'pointer');
  const byClass = el.matches ? el.matches(KBD_CLICK_CLASSES) : false;
  return own || byClass;
}

// Put them in the tab order. Idempotent, so it can run as often as it likes.
function kbdEnhance(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.querySelectorAll) return 0;
  let n = 0;
  d.querySelectorAll('[style*="cursor"], ' + KBD_CLICK_CLASSES).forEach(el => {
    if (el.getAttribute('data-kbd-click') != null) return;
    if (!kbdIsClickable(el)) return;
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-kbd-click', '1');
    if (!el.getAttribute('role')) el.setAttribute('role', 'button');
    n++;
  });
  return n;
}

// Enter and Space press one, exactly as a click would.
function kbdActivate(el) {
  if (!el || !el.getAttribute || el.getAttribute('data-kbd-click') == null) return false;
  if (typeof el.click !== 'function') return false;
  el.click();
  return true;
}

// ============================================================================
// Groups — the sidebar, and a strip of tabs
// ============================================================================
// Once focus is on a tab, left and right should move along the tabs, not go
// back in history the way they mean everywhere else. Same for the sidebar with
// up and down.
function kbdGroupOf(el) {
  if (!el || !el.closest) return null;
  const tabs = el.closest('.tabs, .role-switcher');
  if (tabs) return { el: tabs, orientation: 'horizontal', activate: true };
  const side = el.closest('.sidebar');
  // The sidebar MOVES but does not open: navigating leaves the page, and an
  // arrow key must never do that on its own. A tab only swaps a panel that is
  // already here, so it is safe to switch as focus lands on it.
  if (side) return { el: side, orientation: 'vertical', activate: false };
  return null;
}

// Is it on screen? offsetParent is the quick answer in a browser, but it is
// null for anything positioned fixed — and null for EVERYTHING in a test, which
// has no layout at all. So it is a fast path, not the whole answer.
function kbdVisible(el) {
  if (!el) return false;
  if (el.hidden) return false;
  if (el.offsetParent) return true;
  try {
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (!cs) return true;
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  } catch (e) { return true; }
}

function kbdGroupMove(el, delta) {
  const g = kbdGroupOf(el);
  if (!g) return null;
  const items = Array.from(g.el.querySelectorAll(
    'button:not([disabled]), a[href], [data-kbd-click], [tabindex]:not([tabindex="-1"])'))
    .filter(x => x === el || kbdVisible(x));
  if (!items.length) return null;
  const at = items.indexOf(el);
  const next = items[Math.min(items.length - 1, Math.max(0, (at < 0 ? 0 : at) + delta))];
  if (!next) return null;
  if (next.focus) { try { next.focus(); } catch (e) {} }
  if (g.activate && next !== el && typeof next.click === 'function') next.click();
  return next;
}

// ============================================================================
// The command palette
// ============================================================================

// Everywhere this role may go, plus the records they can open, as one list.
//
// Screens come from opcNavGroups — the SAME list the sidebar renders — so the
// palette can never offer a screen the sidebar hides. Records are only included
// when their screen is in that list, for the same reason.
function kbdCommands(state, role, opts) {
  const o = opts || {};
  const out = [];
  const groups = (typeof window !== 'undefined' && window.opcNavGroups)
    ? window.opcNavGroups(state, role) : [];
  const canSee = {};
  groups.forEach(g => (g.items || []).forEach(it => {
    canSee[it.id] = true;
    out.push({ kind: 'screen', group: g.label, label: it.label, icon: it.icon, route: it.id,
               hint: g.label });
  }));

  if (o.screensOnly) return out;
  const cap = o.perType || 40;
  const add = (route, kind, icon, list) => {
    if (!canSee[route.split('/')[0]]) return;   // the role cannot open it — do not offer it
    list.slice(0, cap).forEach(x => out.push(Object.assign({ kind, icon }, x)));
  };

  add('sales-orders', 'Sales order', 'receipt', (state.sales_orders || []).map(so => ({
    label: so.so_no || so.id,
    hint: [(o.customerName ? o.customerName(so.customer_id) : ''), so.status].filter(Boolean).join(' · '),
    route: 'sales-orders/' + so.id,
  })));
  add('vendor-pos', 'Vendor PO', 'cart', (state.vendor_pos || []).map(po => ({
    label: po.po_no || po.id,
    hint: [(o.vendorName ? o.vendorName(po.vendor_id) : ''), po.status].filter(Boolean).join(' · '),
    route: 'vendor-pos/' + po.id,
  })));
  add('grn', 'GRN', 'package', (state.grns || []).map(g => ({
    label: g.grn_no || g.id, hint: g.status || '', route: 'grn/' + g.id,
  })));
  add('customers', 'Customer', 'user', (state.customers || []).map(c => ({
    label: c.name, hint: c.code || c.gstin || '', route: 'customers',
  })));
  add('vendors', 'Vendor', 'factory', (state.vendors || []).map(v => ({
    label: v.name, hint: v.code || v.gstin || '', route: 'vendors',
  })));
  add('products', 'Product', 'book', (state.products || []).map(p => ({
    label: p.name, hint: p.code || '', route: 'products',
  })));
  return out;
}

// Rank matches the way somebody typing expects: what starts with what they
// typed first, then what contains it. Every character has to appear, in order,
// so "vpo" finds "Vendor PO" without matching everything on the list.
function kbdFilter(items, q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return items.slice(0, 60);
  const scored = [];
  items.forEach(it => {
    const label = String(it.label || '').toLowerCase();
    const hay = (label + ' ' + String(it.hint || '') + ' ' + String(it.kind || '')).toLowerCase();
    let score = -1;
    if (label.startsWith(query)) score = 0;
    else if (label.includes(query)) score = 1;
    else if (hay.includes(query)) score = 2;
    else {
      // subsequence: every letter, in order
      let i = 0;
      for (let c = 0; c < hay.length && i < query.length; c++) if (hay[c] === query[i]) i++;
      if (i === query.length) score = 3;
    }
    if (score >= 0) scored.push({ it, score });
  });
  scored.sort((a, b) => a.score - b.score
    || String(a.it.label).length - String(b.it.label).length
    || String(a.it.label).localeCompare(String(b.it.label)));
  return scored.slice(0, 60).map(x => x.it);
}

window.kbdIsTyping = kbdIsTyping;
window.kbdIsControl = kbdIsControl;
window.kbdIsClickable = kbdIsClickable;
window.kbdEnhance = kbdEnhance;
window.kbdActivate = kbdActivate;
window.kbdVisible = kbdVisible;
window.kbdGroupOf = kbdGroupOf;
window.kbdGroupMove = kbdGroupMove;
window.KBD_CLICK_CLASSES = KBD_CLICK_CLASSES;
window.kbdResolve = kbdResolve;
window.KBD_GOTO = KBD_GOTO;
window.kbdRows = kbdRows;
window.kbdMove = kbdMove;
window.kbdJump = kbdJump;
window.kbdSetCursor = kbdSetCursor;
window.kbdCursorIndex = kbdCursorIndex;
window.kbdCurrentRow = kbdCurrentRow;
window.kbdOpenRow = kbdOpenRow;
window.kbdTickRow = kbdTickRow;
window.kbdClearCursor = kbdClearCursor;
window.kbdCommands = kbdCommands;
window.kbdFilter = kbdFilter;

// ============================================================================
// The overlay stack
// ============================================================================
// Escape must close ONE thing — the top one. Every dialog used to add its own
// window listener, so Escape closed all of them at once and a dialog opened
// from inside another took the parent down with it.
const __opcOverlays = [];
function opcOverlayPush(id) {
  if (__opcOverlays.indexOf(id) === -1) __opcOverlays.push(id);
  return () => opcOverlayPop(id);
}
function opcOverlayPop(id) {
  const i = __opcOverlays.indexOf(id);
  if (i !== -1) __opcOverlays.splice(i, 1);
}
function opcOverlayTop() { return __opcOverlays.length ? __opcOverlays[__opcOverlays.length - 1] : null; }
window.opcOverlayPush = opcOverlayPush;
window.opcOverlayPop = opcOverlayPop;
window.opcOverlayTop = opcOverlayTop;

// ============================================================================
// The listener
// ============================================================================
// One listener for the whole app. It decides nothing itself — kbdResolve does
// that — it only carries out what it is told.
function KeyboardLayer() {
  const { state, route, navigate, currentUser, getUser } = useStore();
  const [palette, setPalette] = React.useState(false);
  const [help, setHelp] = React.useState(false);
  const [pending, setPending] = React.useState(null);
  const role = (getUser(currentUser) || {}).role || '';

  // The cursor belongs to the list on screen. A new screen is a new list.
  React.useEffect(() => { kbdClearCursor(); }, [route]);

  // Put every clickable div in the tab order, and keep doing it — screens
  // re-render constantly as data syncs and filters change, and a control that
  // appeared a moment ago has to be reachable too.
  //
  // Watched rather than polled, and batched into one pass per frame: the
  // observer fires for every keystroke in a field, and doing the work on each
  // one would make typing stutter on a long screen.
  React.useEffect(() => {
    if (typeof MutationObserver === 'undefined') { kbdEnhance(); return; }
    let queued = false;
    const run = () => { queued = false; kbdEnhance(); };
    const obs = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || window.setTimeout)(run, 0);
    });
    kbdEnhance();
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  // "g" on its own means nothing after a moment — otherwise a g typed and
  // abandoned would silently eat the next letter pressed, minutes later.
  React.useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 1400);
    return () => clearTimeout(t);
  }, [pending]);

  const go = React.useCallback((r) => {
    // The role's own permissions decide, exactly as they do for the sidebar.
    // A shortcut is a faster way to somewhere you may already go, never a way
    // into somewhere you may not.
    const head = String(r).split('/')[0];
    if (window.canAccess && !window.canAccess(role, head)) return false;
    if (window.featureBlocks && window.featureBlocks(head)) return false;
    navigate(r);
    return true;
  }, [role, navigate]);

  React.useEffect(() => {
    const onKey = (e) => {
      const overlayOpen = palette || help;
      const focused = e.target || document.activeElement;
      const grp = overlayOpen ? null : kbdGroupOf(focused);
      const act = kbdResolve(e, {
        typing: kbdIsTyping(focused),
        control: kbdIsControl(focused),
        group: grp ? grp.orientation : null,
        overlay: overlayOpen,
        pending,
      });
      if (!act) return;

      switch (act.action) {
        case 'palette':
          e.preventDefault(); setHelp(false); setPalette(true); setPending(null);
          return;

        case 'help':
          e.preventDefault(); setHelp(h => !h);
          return;

        case 'escape': {
          // Only the top thing closes. A dialog opened from a dialog must not
          // take its parent with it.
          if (palette) { e.preventDefault(); e.stopImmediatePropagation(); setPalette(false); return; }
          if (help) { e.preventDefault(); e.stopImmediatePropagation(); setHelp(false); return; }
          if (opcOverlayTop()) return;              // a Modal owns it — let it close itself
          setPending(null);
          const el = document.activeElement;
          if (el && kbdIsTyping(el) && typeof el.blur === 'function') { el.blur(); return; }
          kbdClearCursor();
          return;
        }

        case 'primary': {
          // Ctrl+Enter is the primary button of the dialog on top, if it has
          // one that is enabled. Never a button on the page behind it.
          const modals = document.querySelectorAll('.modal');
          const top = modals.length ? modals[modals.length - 1] : null;
          const btn = top && top.querySelector('.modal-footer .btn-primary:not([disabled])');
          if (btn) { e.preventDefault(); btn.click(); }
          return;
        }

        case 'activate':
          // Only for a div that was made focusable. A real button already acts
          // on Enter by itself, and pressing it here too would fire it twice.
          if (kbdActivate(focused)) e.preventDefault();
          return;

        case 'group-move':
          if (kbdGroupMove(focused, act.delta)) e.preventDefault();
          return;

        case 'pending':      setPending(act.pending); return;
        case 'clear-pending': setPending(null); return;

        case 'goto':
          e.preventDefault(); setPending(null); go(act.route);
          return;

        case 'row-move':  e.preventDefault(); kbdMove(act.delta); return;
        case 'row-first': e.preventDefault(); kbdJump('first'); return;
        case 'row-last':  e.preventDefault(); kbdJump('last'); return;

        case 'row-open': {
          const row = kbdCurrentRow();
          if (!row) return;                     // nothing selected — leave Enter alone
          e.preventDefault(); kbdOpenRow();
          return;
        }

        case 'row-tick':
          // Space still scrolls the page when no row is selected.
          if (kbdTickRow()) e.preventDefault();
          return;

        case 'back':
          if (kbdCurrentRow()) { kbdClearCursor(); return; }   // first Esc-like step: drop the cursor
          e.preventDefault(); window.history.back();
          return;

        case 'search': {
          const box = document.querySelector('.main input[type="search"]')
            || Array.from(document.querySelectorAll('.main input[type="text"], .main input:not([type])'))
                 .find(i => /search|find|filter/i.test(i.placeholder || ''));
          e.preventDefault();
          if (box) { box.focus(); if (typeof box.select === 'function') box.select(); }
          else setPalette(true);
          return;
        }
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, help, pending, go]);

  return (
    <>
      {palette && <CommandPalette onClose={() => setPalette(false)} go={go} role={role} state={state}/>}
      {help && <ShortcutHelp onClose={() => setHelp(false)}/>}
    </>
  );
}

// ============================================================================
// The command palette
// ============================================================================
function CommandPalette({ onClose, go, role, state }) {
  const [q, setQ] = React.useState('');
  const [i, setI] = React.useState(0);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => opcOverlayPush('palette'), []);
  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  const custName = React.useCallback(
    id => ((state.customers || []).find(c => c.id === id) || {}).name || '', [state.customers]);
  const vendName = React.useCallback(
    id => ((state.vendors || []).find(v => v.id === id) || {}).name || '', [state.vendors]);

  const all = React.useMemo(
    () => kbdCommands(state, role, { customerName: custName, vendorName: vendName }),
    [state, role, custName, vendName]);
  const hits = React.useMemo(() => kbdFilter(all, q), [all, q]);

  React.useEffect(() => { setI(0); }, [q]);
  React.useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[data-sel="1"]');
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }, [i, hits.length]);

  const pick = (item) => { if (item && go(item.route)) onClose(); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(hits.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setI(0); }
    else if (e.key === 'End') { e.preventDefault(); setI(Math.max(0, hits.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[i]); }
  };

  return (
    <div className="modal-backdrop kbd-palette-backdrop" onClick={onClose}>
      <div className="kbd-palette" onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="kbd-palette-input">
          <Icon name="search" size={14}/>
          <input ref={inputRef} className="input" value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Go to a screen, or find an order, PO, GRN, customer, vendor or item…"
                 aria-label="Search screens and records"/>
          <span className="kbd-key">Esc</span>
        </div>
        <div className="kbd-palette-list" ref={listRef}>
          {hits.length === 0 ? (
            <div className="empty" style={{ padding: 22 }}>Nothing matches “{q}”.</div>
          ) : hits.map((h, n) => (
            <div key={h.kind + '|' + h.route + '|' + h.label + '|' + n}
                 className={'kbd-palette-row' + (n === i ? ' sel' : '')}
                 data-sel={n === i ? '1' : '0'}
                 onMouseEnter={() => setI(n)}
                 onClick={() => pick(h)}>
              <Icon name={h.icon || 'arrowRight'} size={13}/>
              <span className="kbd-palette-label">{h.label}</span>
              {h.hint ? <span className="tiny muted trunc">{h.hint}</span> : null}
              <span className="tiny muted kbd-palette-kind">{h.kind === 'screen' ? h.hint : h.kind}</span>
            </div>
          ))}
        </div>
        <div className="kbd-palette-foot tiny muted">
          <span><span className="kbd-key">↑</span><span className="kbd-key">↓</span> move</span>
          <span><span className="kbd-key">Enter</span> open</span>
          <span><span className="kbd-key">?</span> all shortcuts</span>
          <span style={{ marginLeft: 'auto' }}>{hits.length} of {all.length}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// The shortcut sheet
// ============================================================================
const KBD_SHEET = [
  { group: 'Moving around a list', keys: [
    ['↓ / ↑', 'next row / previous row'],
    ['PgDn / PgUp', 'ten rows at a time'],
    ['Home / End', 'first row / last row'],
    ['→ or Enter', 'open the selected row'],
    ['←', 'drop the selection, then go back'],
    ['Space', 'tick the box on the selected row'],
  ]},
  { group: 'Getting somewhere', keys: [
    ['Ctrl + K', 'the command palette — every screen and record'],
    ['/', 'jump to the search box on this screen'],
    ['g then a key', 'go straight to a screen (see below)'],
    ['?', 'this list'],
  ]},
  { group: 'Anything on the page', keys: [
    ['Tab / Shift + Tab', 'every button, tab, card, chip and field, in order'],
    ['Enter or Space', 'press whatever is focused'],
    ['← / →', 'along a row of tabs'],
    ['↑ / ↓', 'down the sidebar (Enter opens)'],
  ]},
  { group: 'In a dialog or form', keys: [
    ['Tab / Shift + Tab', 'between fields, staying inside the dialog'],
    ['Ctrl + Enter', 'the primary button — save, create, confirm'],
    ['Esc', 'close it (only the top one)'],
  ]},
];

function ShortcutHelp({ onClose }) {
  React.useEffect(() => opcOverlayPush('help'), []);
  const gotoRows = Object.keys(KBD_GOTO).map(k => ({ k, route: KBD_GOTO[k] }));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Keyboard shortcuts</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body">
          <div className="kbd-sheet">
            {KBD_SHEET.map(sec => (
              <div key={sec.group} className="kbd-sheet-col">
                <div className="kbd-sheet-title">{sec.group}</div>
                {sec.keys.map(([k, what]) => (
                  <div key={k} className="kbd-sheet-row">
                    <span className="kbd-key">{k}</span>
                    <span className="small">{what}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="kbd-sheet-col">
              <div className="kbd-sheet-title">g then…</div>
              <div className="kbd-goto-grid">
                {gotoRows.map(r => (
                  <div key={r.k} className="kbd-sheet-row">
                    <span className="kbd-key">g {r.k}</span>
                    <span className="tiny muted trunc">{r.route}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="tiny muted mt-2">
            Shortcuts never fire while you are typing in a field — only <span className="kbd-key">Esc</span>,
            <span className="kbd-key">Ctrl + K</span> and <span className="kbd-key">Ctrl + Enter</span> reach
            through a field, and a screen you may not open is not offered by any of them.
          </div>
        </div>
      </div>
    </div>
  );
}

window.KeyboardLayer = KeyboardLayer;
window.CommandPalette = CommandPalette;
window.ShortcutHelp = ShortcutHelp;
window.KBD_SHEET = KBD_SHEET;
