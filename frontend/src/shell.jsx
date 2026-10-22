// OP Central — Shell: sidebar, topbar, role switcher, notifications drawer

// The one definition of what is in the navigation.
//
// The sidebar renders it and the keyboard command palette searches it. Two
// lists would drift, and a palette that offered a screen the sidebar hides
// would be a way around the role's permissions rather than a convenience.
function opcNavGroups(state, role) {
  const allowed = perm(role).nav;
  const pendingTransfers = state.transfer_requests?.filter(t => t.status === 'Pending').length || 0;
  const overdueCount = (state.sales_orders || []).filter(s => (s.days_overdue || 0) > 0).length;
  const pendingMatches = (state.vendor_invoices || []).filter(v => v.status === 'Pending 3-Way Match').length;
  const myTasks = window.tasksForRole ? window.tasksForRole(state, role, () => {}, () => {}, () => {}).length : 0;

  const navGroups = [
    { label: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'home' },
      { id: 'inbox', label: 'My Tasks', icon: 'bell', badge: myTasks || null },
    ]},
    { label: 'Sales', items: [
      { id: 'client-requests', label: 'Item Requests', icon: 'file' },
      { id: 'sourcing', label: 'Sourcing / Inquiries', icon: 'bookmark' },
      { id: 'sales-orders', label: 'Sales Orders', icon: 'receipt' },
      { id: 'customers', label: 'Customers', icon: 'user' },
    ]},
    { label: 'Inventory', items: [
      { id: 'godown', label: 'Virtual Godowns', icon: 'box' },
      { id: 'scm', label: 'SCM Tracking', icon: 'repeat' },
      { id: 'pool', label: 'Master Surplus Pool', icon: 'layers' },
      { id: 'transfers', label: 'Cross-SO Transfers', icon: 'arrowLeftRight', badge: pendingTransfers || null },
    ]},
    { label: 'Procurement', items: [
      { id: 'rfq', label: 'RFQ Comparison', icon: 'grid' },
      { id: 'vendor-pos', label: 'Vendor POs', icon: 'cart' },
      { id: 'grn', label: 'GRN', icon: 'package' },
      { id: 'three-way', label: '3-Way Match', icon: 'check', badge: pendingMatches || null },
      { id: 'vendors', label: 'Vendors', icon: 'factory' },
      { id: 'mapping', label: 'Item Name Mapping', icon: 'arrowLeftRight' },
    ]},
    { label: 'Billing', items: [
      { id: 'invoices', label: 'Invoices & e-Way Bills', icon: 'file' },
      { id: 'collections', label: 'Collections', icon: 'cash', badge: overdueCount || null },
    ]},
    { label: 'Catalogue', items: [
      { id: 'products', label: 'Products & BOM', icon: 'book' },
    ]},
    { label: 'Admin', items: [
      { id: 'settings', label: 'Customisation', icon: 'settings' },
      { id: 'audit', label: 'Audit Log', icon: 'history' },
      { id: 'onboarding', label: 'Onboarding Wizard', icon: 'sparkles' },
    ]},
  ];

  // Filter groups & items by the role's allowed nav list, then drop anything a
  // capability that this ORGANIZATION has switched off controls (a feature row
  // with enabled=false; an absent key inherits, so nothing disappears by default).
  const filteredGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(it =>
      (allowed.includes(it.id) || (window.SCM_ROUTES_SET && window.SCM_ROUTES_SET[it.id] &&
        window.canAccess && window.canAccess(role, it.id)))
      && !(window.featureBlocks && window.featureBlocks(it.id))) }))
    .filter(g => g.items.length > 0);

  // Platform console — visible only to platform (master) admins, never to tenants.
  if (window.__opcIsMaster) {
    filteredGroups.push({ label: 'Platform', items: [
      { id: 'platform', label: 'Organizations', icon: 'layers' },
    ] });
  }
  return filteredGroups;
}
window.opcNavGroups = opcNavGroups;

// "My profile": who you are, and the one thing a person can safely do for themselves —
// change their own password (Supabase Auth, the signed-in session only). Name, role and
// organisation are read-only here: they are set by an Org Admin in Customisation → Users.
function ProfileModal({ user, org, realUser, impersonating, onClose, onSignOut }) {
  const toast = useToast();
  const [cur, setCur] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);     // the password form stays folded away until asked for
  const [show, setShow] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [sent, setSent] = React.useState('');         // set once a reset e-mail has been requested
  const email = (realUser && realUser.email) || user.email || '';
  const canChange = !!window.OPC_SB && !impersonating;   // acting as someone else is not their account
  const reset = () => { setOpen(false); setCur(''); setPw(''); setPw2(''); setShow(false); setErr(''); };

  // Change: prove you know the CURRENT password first (a stolen, unlocked session cannot silently take
  // over the account), then set the new one.
  const update = async () => {
    setErr('');
    if (!cur) { setErr('Enter your current password.'); return; }
    if (pw.length < 8) { setErr('Use at least 8 characters for the new password.'); return; }
    if (pw !== pw2) { setErr('The two new passwords do not match.'); return; }
    if (pw === cur) { setErr('The new password must be different from the current one.'); return; }
    setBusy(true);
    const chk = await window.OPC_SB.auth.signInWithPassword({ email, password: cur });
    if (chk.error) { setBusy(false); setErr('The current password is not correct.'); return; }
    const { error } = await window.OPC_SB.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    reset();
    toast('Password updated', 'success');
  };

  // Forgot it: Supabase e-mails a one-time link that comes back to this app (see RecoveryScreen). It only
  // works if the server has outgoing e-mail (SMTP) set up and this page's address is on its allowed
  // redirect list — if not, the error is shown as-is rather than pretending a mail went out.
  const forgot = async () => {
    setErr('');
    if (!email) { setErr('There is no e-mail on this account.'); return; }
    setBusy(true);
    const { error } = await window.OPC_SB.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    setBusy(false);
    if (error) { setErr('Could not send the reset e-mail: ' + error.message); return; }
    setSent(email);
  };
  const masked = (e) => String(e).replace(/^(.{2}).*(@.*)$/, '$1***$2');

  return (
    <Modal title="My profile" onClose={onClose} footer={<>
      <button className="btn" onClick={onSignOut}><Icon name="arrowRight" size={13}/>Sign out</button>
      <button className="btn btn-primary" onClick={onClose}>Close</button>
    </>}>
      <div className="profile-head">
        <Avatar user={user} size={56}/>
        <div style={{ minWidth: 0 }}>
          <div className="profile-name">{user.name}</div>
          <div className="muted small">{user.role}</div>
        </div>
      </div>
      <div className="dl" style={{ marginTop: 14 }}>
        <dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{email || '—'}</dd>
        <dt>Role</dt><dd>{user.role}</dd>
        <dt>Organisation</dt><dd>{org.name || org.short || '—'}</dd>
        {org.gstin ? <><dt>GSTIN</dt><dd className="mono">{org.gstin}</dd></> : null}
      </div>
      {impersonating && <div className="small muted mt-2">You are acting as {user.role}. Exit that to change your own account.</div>}
      {canChange && (
        <div className="pw-block">
          {!open ? (
            <button type="button" className="pw-row" onClick={() => setOpen(true)}>
              <span>Change password</span><Icon name="chevronRight" size={15}/>
            </button>
          ) : (
            <div className="pw-form">
              <div className="pw-title">Change password</div>
              <label className="field">
                <span className="field-label">Current password</span>
                <span className="pw-field">
                  <input className="input" type={show ? 'text' : 'password'} autoComplete="current-password" autoFocus value={cur} onChange={e => setCur(e.target.value)}/>
                  <button type="button" className="pw-eye" aria-label={show ? 'Hide passwords' : 'Show passwords'} onClick={() => setShow(v => !v)}><Icon name={show ? 'eyeOff' : 'eye'} size={16}/></button>
                </span>
              </label>
              <div style={{ marginTop: -4 }}>
                {sent
                  ? <span className="pw-hint ok">✓ Reset link sent to {masked(sent)} — open it on this device.</span>
                  : <button type="button" className="pw-link" onClick={forgot} disabled={busy}>Forgot your current password? E-mail me a reset link</button>}
              </div>
              <label className="field">
                <span className="field-label">New password</span>
                <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)}/>
              </label>
              <label className="field">
                <span className="field-label">Confirm new password</span>
                <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)}
                       onKeyDown={e => { if (e.key === 'Enter') update(); }}/>
              </label>
              <div className={`pw-hint${pw.length >= 8 ? ' ok' : ''}`}>{pw.length >= 8 ? '✓ ' : ''}At least 8 characters{pw2 && pw !== pw2 ? ' · the two do not match yet' : ''}</div>
              {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
              <div className="pw-actions">
                <button className="btn" onClick={reset}>Cancel</button>
                <button className="btn btn-primary" onClick={update} disabled={busy || !cur || pw.length < 8 || pw !== pw2}>{busy ? 'Working…' : 'Update password'}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Topbar({ onOpenTweaks }) {
  const { state, currentUser, realUserId, impersonate, stopImpersonating, getUser, navigate, route, logout } = useStore();
  const [notifOpen, setNotifOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);   // the phone/tablet "account" menu
  React.useEffect(() => {
    if (!menuOpen) return;
    const away = (e) => { if (!e.target.closest || !e.target.closest('.tb-menu, .tb-more')) setMenuOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);
  const u = getUser(currentUser);                 // persona being acted as
  const realUser = getUser(realUserId);           // who is actually logged in
  const isAdmin = realUser && realUser.role === 'Org Admin';
  const impersonating = currentUser !== realUserId;
  const canAct = isAdmin && state.users.length > 1;
  // Filter notifications to the current role OR a specific assigned user.
  const myNotifs = state.notifications.filter(n => (!n.role && !n.user_id) || (n.role && n.role === (u && u.role)) || (n.user_id && n.user_id === currentUser));
  const unread = myNotifs.filter(n => !n.read).length;

  // Admin impersonation for flow testing — change persona AND jump to that
  // role's home. Does NOT change the real identity, so you can always exit back.
  const switchTo = (uid) => {
    const nu = state.users.find(x => x.id === uid);
    if (!nu) return;
    impersonate(uid);
    // Always land on the Flow hub (the "Workspace"): it lists exactly what the
    // new role can reach, whatever screen the previous role was on.
    navigate('flow');
  };
  const exitImpersonation = () => {
    stopImpersonating();
    navigate('flow');
  };
  // expose for sidebar select
  window.__opc_setUser = impersonate;
  window.__opc_switchTo = switchTo;

  const unreadOld = state.notifications.filter(n => !n.read).length;

  // Crumb logic
  let crumb = [{ label: 'Workspace' }];
  const labels = {
    'dashboard': 'Dashboard', 'inbox': 'My Approvals',
    'client-requests': 'Item Requests',
    'sales-orders': 'Sales Orders', 'customers': 'Customers',
    'godown': 'Virtual Godowns', 'pool': 'Master Surplus Pool', 'transfers': 'Cross-SO Transfers',
    'rfq': 'RFQ Comparison', 'vendor-pos': 'Vendor POs', 'grn': 'GRN', 'three-way': '3-Way Match', 'vendors': 'Vendors',
    'invoices': 'Invoices & e-Way Bills', 'collections': 'Collections',
    'products': 'Products & BOM',
    'settings': 'Customisation', 'audit': 'Audit Log', 'onboarding': 'Onboarding Wizard',
    'sourcing': 'Sourcing / Inquiries', 'mapping': 'Item Name Mapping', 'scm': 'SCM Tracking', 'client-requests': 'Item Requests',
  };
  const parts = route.split('/');
  if (labels[parts[0]]) crumb.push({ label: labels[parts[0]] });
  // The last crumb of a record page is its document number (INQ/FY26/0002), not the raw id (src-1).
  const docNo = (() => {
    const id = parts[1];
    if (!id) return null;
    const find = (arr, k) => { const r = (arr || []).find(x => x.id === id); return r ? r[k] : null; };
    if (parts[0] === 'sourcing') return find(state.sourcings, 'src_no');
    if (parts[0] === 'sales-orders' || parts[0] === 'invoices' || parts[0] === 'godown' || parts[0] === 'scm') return find(state.sales_orders, 'so_no');
    if (parts[0] === 'vendor-pos') return find(state.vendor_pos, 'po_no');
    if (parts[0] === 'grn') return find(state.grns, 'grn_no');
    return null;
  })();
  if (parts.length > 1) crumb.push({ label: docNo || parts.slice(1).join('/') });

  return (
    <>
      <div className="brand" style={{ cursor: 'pointer' }} onClick={() => navigate('flow')}
           title="Back to the flow">
        <div className={`brand-mark${state.org.logo ? ' has-logo' : ''}`}>{state.org.logo ? <img src={state.org.logo} alt=""/> : 'B'}</div>
        <div>
          <div className="brand-name">OP Central</div>
        </div>
      </div>
      <div className="topbar">
        <div className="topbar-left">
          <div className="crumbs">
            {crumb.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span className="sep">›</span>}
                {i === 0
                  ? <span style={{ cursor: 'pointer' }} onClick={() => navigate('flow')}>{c.label}</span>
                  : <span className={i === crumb.length - 1 ? 'current' : ''}>{c.label}</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="topbar-right">
          {/* No second logo here: the brand mark on the left already is the org's logo. */}
          <div className="org-pill org-pill-text" title={state.org.gstin}>
            <span className="org-pill-name">{state.org.short}</span>
            <span className="mono tiny muted org-pill-fy">· FY{String((state.org && state.org.fiscal_year) || '').replace('20','') || '—'}</span>
          </div>
          {canAct && (
            <>
              {impersonating && <span className="badge warning topbar-acting" title="You are acting as another user">Acting as {u.role}</span>}
              {/* Labelled by ROLE, not initials. Two users sharing a role are told apart by name. */}
              <select className="select role-select" value={currentUser} aria-label="Act as role"
                title="Act as another role (admin) — test the role flow"
                onChange={e => switchTo(e.target.value)}>
                {state.users.map(usr => {
                  const dup = state.users.filter(x => x.role === usr.role).length > 1;
                  return <option key={usr.id} value={usr.id}>{dup ? `${usr.role} — ${usr.name}` : usr.role}</option>;
                })}
              </select>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setNotifOpen(true)} style={{ position: 'relative' }} title="Notifications">
            <Icon name="bell" size={19}/>
            {unread > 0 && <span style={{
              position: 'absolute', top: 1, right: 1,
              width: 14, height: 14, borderRadius: '50%',
              background: 'var(--danger)', color: 'white',
              fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center',
              fontFamily: 'var(--mono)',
            }}>{unread}</span>}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onOpenTweaks} title="Tweaks">
            <Icon name="sparkles" size={19}/>
          </button>
          {/* Profile: the avatar opens a small menu with Sign out (and Exit when acting as someone). */}
          <button className="btn btn-ghost tb-more" aria-expanded={menuOpen} aria-haspopup="menu" title={`${u.name} · ${u.role}`}
                  onClick={() => setMenuOpen(o => !o)}>
            <Icon name="user" size={19}/>
            <span className="topbar-user-text" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, textAlign: 'left' }}>
              <span style={{ fontSize: 11.5, fontWeight: 500 }}>{u.name}</span>
              <span className="muted" style={{ fontSize: 10.5 }}>{u.role}</span>
            </span>
            <Icon name="chevronDown" size={13}/>
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="tb-menu" role="menu">
          <button type="button" className="tb-menu-user tb-menu-profile" onClick={() => { setMenuOpen(false); setProfileOpen(true); }}>
            <Avatar user={u} size={36}/>
            <div style={{ minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>{u.name}</div>
              <div className="muted small">{u.role} · {state.org.short}</div>
            </div>
            <span className="tb-menu-chev"><Icon name="chevronRight" size={15}/></span>
          </button>
          {impersonating && (
            <button className="tb-menu-item" onClick={() => { exitImpersonation(); setMenuOpen(false); }}><Icon name="x" size={17}/>Exit — back to my account</button>
          )}
          <button className="tb-menu-item" onClick={() => { setMenuOpen(false); logout(); }}><Icon name="arrowRight" size={17}/>Sign out</button>
        </div>
      )}
      {profileOpen && <ProfileModal user={u} org={state.org} realUser={realUser} impersonating={impersonating}
        onClose={() => setProfileOpen(false)} onSignOut={() => { setProfileOpen(false); logout(); }}/>}
      {notifOpen && <NotificationsDrawer onClose={() => setNotifOpen(false)} role={u && u.role} />}
    </>
  );
}

// Where clicking a notification should land. A notification's role/user_id
// TARGET and the route its KIND points at have always been two separate
// lists — nothing guaranteed the recipient's own nav also carries that
// route (e.g. a 'grn'-kind notification targets Billing, which has never
// carried 'grn' in its own nav). Dashboard is the one route every role
// keeps, so a kind the viewer cannot actually open lands there instead of
// bouncing silently off the app-level route guard.
function notificationRoute(n, role) {
  const dest = n.kind === 'transfer' ? 'transfers'
    : n.kind === 'grn' ? 'grn'
    : n.kind === 'overdue' ? 'collections'
    : n.kind === 'match' ? 'three-way'
    : n.kind === 'sourcing' ? 'sourcing'
    : n.kind === 'client-request' ? 'client-requests'
    : 'inbox';
  return canAccess(role, dest) ? dest : 'dashboard';
}
window.notificationRoute = notificationRoute;

function NotificationsDrawer({ onClose, role }) {
  const { state, mutate, navigate, currentUser } = useStore();
  const items = state.notifications.filter(n => (!n.role && !n.user_id) || (n.role && n.role === role) || (n.user_id && n.user_id === currentUser));
  const ref = React.useRef(null);
  const openerRef = React.useRef(null);
  const idRef = React.useRef('drawer-' + Math.random().toString(36).slice(2));
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // The same four things every dialog in this app does. This one is not a
  // Modal, so it has to say so itself: Escape closes it and only it, focus
  // moves in when it opens and back to the bell when it closes.
  React.useEffect(() => {
    openerRef.current = document.activeElement;
    const pop = window.opcOverlayPush ? window.opcOverlayPush(idRef.current) : null;
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (window.opcOverlayTop && window.opcOverlayTop() !== idRef.current) return;
      onCloseRef.current && onCloseRef.current();
    };
    window.addEventListener('keydown', onEsc);
    const t = setTimeout(() => {
      const box = ref.current;
      if (!box || box.contains(document.activeElement)) return;
      const first = box.querySelector('button, [data-kbd-click], [tabindex]:not([tabindex="-1"])');
      if (first && first.focus) { try { first.focus(); } catch (e) {} }
    }, 0);
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

  // Tab stays inside it, the same way it stays inside a dialog.
  const onKeyDown = (e) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const focusable = Array.from(ref.current.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
      + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(el => el === document.activeElement
                 || (window.kbdVisible ? window.kbdVisible(el) : el.offsetParent !== null));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 80 }} onClick={onClose}/>
      <div className="drawer" ref={ref} role="dialog" aria-modal="true"
           aria-label="Notifications" onKeyDown={onKeyDown}>
        <div className="drawer-header">
          <div>
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            <div className="muted tiny">For {role} · {items.length} total · {items.filter(n=>!n.read).length} unread</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="drawer-body">
          {items.length === 0 && <div className="empty"><div className="empty-title">All clear</div>No notifications for your role.</div>}
          {items.map(n => (
            <div key={n.id} className="queue-item" style={{ background: n.read ? 'transparent' : 'var(--accent-bg)' }}
                 onClick={() => {
                   mutate(s => ({ ...s, notifications: s.notifications.map(x => x.id === n.id ? {...x, read: true} : x) }));
                   navigate(notificationRoute(n, role));
                   onClose();
                 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: n.read ? 'var(--border-strong)' : 'var(--accent)' }}/>
              <div className="grow">
                <div style={{ fontSize: 12.5, marginBottom: 2 }}>{n.text}</div>
                <div className="muted tiny">{n.kind} · {fmtDate(n.date)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

window.Topbar = Topbar;
