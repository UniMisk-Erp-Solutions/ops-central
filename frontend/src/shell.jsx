// OP Central — Shell: sidebar, topbar, role switcher, notifications drawer

function Sidebar() {
  const { route, navigate, state, currentUser, realUserId, getUser } = useStore();
  const u = getUser(currentUser);
  const realIsAdmin = (getUser(realUserId) || {}).role === 'Org Admin';
  const allowed = perm(u.role).nav;
  const pendingTransfers = state.transfer_requests?.filter(t => t.status === 'Pending').length || 0;
  const overdueCount = state.sales_orders.filter(s => (s.days_overdue || 0) > 0).length;
  const pendingMatches = state.vendor_invoices.filter(v => v.status === 'Pending 3-Way Match').length;
  const myTasks = window.tasksForRole ? window.tasksForRole(state, u.role, () => {}, () => {}, () => {}).length : 0;

  const navGroups = [
    { label: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'home' },
      { id: 'inbox', label: 'My Tasks', icon: 'bell', badge: myTasks || null },
    ]},
    { label: 'Sales', items: [
      { id: 'sales-orders', label: 'Sales Orders', icon: 'receipt' },
      { id: 'customers', label: 'Customers', icon: 'user' },
    ]},
    { label: 'Inventory', items: [
      { id: 'godown', label: 'Virtual Godowns', icon: 'box' },
      { id: 'pool', label: 'Master Surplus Pool', icon: 'layers' },
      { id: 'transfers', label: 'Cross-SO Transfers', icon: 'arrowLeftRight', badge: pendingTransfers || null },
    ]},
    { label: 'Procurement', items: [
      { id: 'rfq', label: 'RFQ Comparison', icon: 'grid' },
      { id: 'vendor-pos', label: 'Vendor POs', icon: 'cart' },
      { id: 'grn', label: 'GRN', icon: 'package' },
      { id: 'three-way', label: '3-Way Match', icon: 'check', badge: pendingMatches || null },
      { id: 'vendors', label: 'Vendors', icon: 'factory' },
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

  // Filter groups & items by role's allowed nav list
  const filteredGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(it => allowed.includes(it.id)) }))
    .filter(g => g.items.length > 0);

  return (
    <aside className="sidebar">
      <div style={{ padding: '4px 14px 10px', fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>Logged in as <strong style={{ color: 'var(--text-2)' }}>{u.role}</strong></span>
      </div>
      {filteredGroups.map(g => (
        <div key={g.label} className="nav-group">
          <div className="nav-group-label">{g.label}</div>
          {g.items.map(it => {
            const active = route === it.id || route.startsWith(it.id + '/');
            return (
              <div key={it.id} className={`nav-item ${active ? 'active' : ''}`} onClick={() => navigate(it.id)}>
                <Icon name={it.icon} size={14}/>
                <span>{it.label}</span>
                {it.badge ? <span className="badge">{it.badge}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
      {realIsAdmin && state.users.length > 1 && (
        <div style={{ padding: '14px', marginTop: 10, borderTop: '1px solid var(--border)' }}>
          <div className="tiny muted" style={{ marginBottom: 4 }}>Act as (admin)</div>
          <select className="select" style={{ height: 26, fontSize: 11.5 }}
                  value={currentUser}
                  onChange={e => { if (window.__opc_switchTo) window.__opc_switchTo(e.target.value); }}>
            {state.users.map(usr => (
              <option key={usr.id} value={usr.id}>{usr.name} — {usr.role}</option>
            ))}
          </select>
        </div>
      )}
    </aside>
  );
}

function Topbar({ onOpenTweaks }) {
  const { state, currentUser, realUserId, impersonate, stopImpersonating, getUser, navigate, route, logout } = useStore();
  const [notifOpen, setNotifOpen] = React.useState(false);
  const u = getUser(currentUser);                 // persona being acted as
  const realUser = getUser(realUserId);           // who is actually logged in
  const isAdmin = realUser && realUser.role === 'Org Admin';
  const impersonating = currentUser !== realUserId;
  // Filter notifications to current role
  const myNotifs = state.notifications.filter(n => !n.role || n.role === (u && u.role));
  const unread = myNotifs.filter(n => !n.read).length;

  // Admin impersonation for flow testing — change persona AND jump to that
  // role's home. Does NOT change the real identity, so you can always exit back.
  const switchTo = (uid) => {
    const nu = state.users.find(x => x.id === uid);
    if (!nu) return;
    impersonate(uid);
    const dest = (perm(nu.role).primary || { route: 'dashboard' }).route;
    navigate(dest);
  };
  const exitImpersonation = () => {
    stopImpersonating();
    const dest = (perm(realUser.role).primary || { route: 'dashboard' }).route;
    navigate(dest);
  };
  // expose for sidebar select
  window.__opc_setUser = impersonate;
  window.__opc_switchTo = switchTo;

  const unreadOld = state.notifications.filter(n => !n.read).length;

  // Crumb logic
  let crumb = [{ label: 'Workspace' }];
  const labels = {
    'dashboard': 'Dashboard', 'inbox': 'My Approvals',
    'sales-orders': 'Sales Orders', 'customers': 'Customers',
    'godown': 'Virtual Godowns', 'pool': 'Master Surplus Pool', 'transfers': 'Cross-SO Transfers',
    'rfq': 'RFQ Comparison', 'vendor-pos': 'Vendor POs', 'grn': 'GRN', 'three-way': '3-Way Match', 'vendors': 'Vendors',
    'invoices': 'Invoices & e-Way Bills', 'collections': 'Collections',
    'products': 'Products & BOM',
    'settings': 'Customisation', 'audit': 'Audit Log', 'onboarding': 'Onboarding Wizard',
  };
  const parts = route.split('/');
  if (labels[parts[0]]) crumb.push({ label: labels[parts[0]] });
  if (parts.length > 1) crumb.push({ label: parts.slice(1).join('/') });

  return (
    <>
      <div className="brand">
        <div className="brand-mark">B</div>
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
                <span className={i === crumb.length - 1 ? 'current' : ''}>{c.label}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="topbar-right">
          <div className="org-pill" title={state.org.gstin}>
            <div className="org-pill-dot">{state.org.logo_letter}</div>
            <span>{state.org.short}</span>
            <span className="mono tiny muted">· FY{state.org.fiscal_year.replace('20','')}</span>
          </div>
          {isAdmin && state.users.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {impersonating && <span className="badge warning" title="You are acting as another user">Acting as {u.role}</span>}
              <div className="role-switcher" title="Act as another user (admin) — test the role flow">
                {state.users.map(usr => (
                  <button key={usr.id} className={currentUser === usr.id ? 'active' : ''}
                    title={`${usr.name} — ${usr.role}`}
                    onClick={() => switchTo(usr.id)}>{usr.initials || usr.name.slice(0, 2)}</button>
                ))}
              </div>
              {impersonating && (
                <button className="btn btn-ghost btn-sm" title="Return to your admin account" onClick={exitImpersonation}>
                  <Icon name="x" size={12}/>Exit
                </button>
              )}
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setNotifOpen(true)} style={{ position: 'relative' }}>
            <Icon name="bell" size={14}/>
            {unread > 0 && <span style={{
              position: 'absolute', top: 1, right: 1,
              width: 14, height: 14, borderRadius: '50%',
              background: 'var(--danger)', color: 'white',
              fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center',
              fontFamily: 'var(--mono)',
            }}>{unread}</span>}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onOpenTweaks} title="Tweaks">
            <Icon name="sparkles" size={14}/>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 2px' }} title={u.role}>
            <Avatar user={u} size={22}/>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500 }}>{u.name}</span>
              <span className="muted" style={{ fontSize: 10.5 }}>{u.role}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout} title="Sign out">
            <Icon name="arrowRight" size={14}/>
          </button>
        </div>
      </div>
      {notifOpen && <NotificationsDrawer onClose={() => setNotifOpen(false)} role={u && u.role} />}
    </>
  );
}

function NotificationsDrawer({ onClose, role }) {
  const { state, mutate, navigate } = useStore();
  const items = state.notifications.filter(n => !n.role || n.role === role);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 80 }} onClick={onClose}/>
      <div className="drawer">
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
                   if (n.kind === 'transfer') navigate('transfers');
                   else if (n.kind === 'grn') navigate('grn');
                   else if (n.kind === 'overdue') navigate('collections');
                   else if (n.kind === 'match') navigate('three-way');
                   else navigate('inbox');
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

window.Sidebar = Sidebar;
window.Topbar = Topbar;
