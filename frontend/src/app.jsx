// OP Central — Main app: routing, tweaks panel, providers

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "primary_color": "#3563a4",
  "density": "comfortable",
  "industry_template": "Trading",
  "show_internal_bom_inline": true
}/*EDITMODE-END*/;

function Splash({ label }) {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{label || 'Loading…'}</div>;
}

function App() {
  const { state, route, currentUser, getUser, navigate, authReady } = useStore();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const u = getUser(currentUser);

  // Apply tweaks to root
  React.useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty('--accent', t.primary_color);
    r.style.setProperty('--brand-mark-bg', t.primary_color);
    if (t.density === 'compact') {
      r.style.setProperty('--row-h', '28px');
    } else {
      r.style.setProperty('--row-h', '36px');
    }
  }, [t.primary_color, t.density]);

  // Route guard — redirect to role's primary if route not allowed
  React.useEffect(() => {
    if (!u) return;                       // not signed in yet
    if (route === 'onboarding') return;   // onboarding is universal
    if (!canAccess(u.role, route)) {
      const dest = (perm(u.role).primary || { route: 'dashboard' }).route;
      navigate(dest);
    }
  }, [route, u && u.role, navigate]);

  // Open tweaks panel via custom button — post the activate message to self
  const openTweaks = React.useCallback(() => {
    window.postMessage({ type: '__activate_edit_mode' }, '*');
  }, []);

  // Wait for the initial Supabase session check before deciding.
  if (!authReady) return <Splash/>;
  // No session → login screen.
  if (!currentUser) return <LoginScreen/>;
  // Session exists but the profile is still loading.
  if (!u) return <Splash label="Loading your workspace…"/>;

  // Onboarding is full-screen — no shell
  if (route === 'onboarding') {
    return <>
      <OnboardingWizard/>
      <OpcTweaks t={t} setTweak={setTweak}/>
    </>;
  }

  // Parse route
  const parts = route.split('/');
  let Content;
  if (route === 'dashboard') Content = <Dashboard/>;
  else if (route === 'inbox') Content = <ApprovalInbox/>;
  else if (route === 'platform') Content = <PlatformConsole/>;
  else if (route === 'scm') Content = <SCMTracking/>;
  else if (route === 'mapping') Content = <ItemMapping/>;
  else if (route === 'sales-orders') Content = <SalesOrdersList/>;
  else if (route === 'sales-orders/new') Content = <SalesOrderNew/>;
  else if (parts[0] === 'sales-orders' && parts[1]) Content = <SalesOrderDetail soId={parts[1]}/>;
  else if (route === 'sourcing') Content = <SourcingList/>;
  else if (route === 'sourcing/new') Content = <SourcingNew/>;
  else if (parts[0] === 'sourcing' && parts[1]) Content = <SourcingDetail srcId={parts[1]}/>;
  else if (route === 'customers') Content = <CustomersList/>;
  else if (parts[0] === 'customers' && parts[1] && parts[2] === 'ledger') Content = <CustomerLedger custId={parts[1]}/>;
  else if (route === 'vendors') Content = <VendorsList/>;
  else if (route === 'products') Content = <ProductsList/>;
  else if (route === 'godown') Content = <VirtualGodownList/>;
  else if (parts[0] === 'godown' && parts[1]) Content = <VirtualGodownView soId={parts[1]}/>;
  else if (route === 'pool') Content = <MasterPool/>;
  else if (route === 'transfers') Content = <CrossSOTransfers/>;
  else if (route === 'rfq') Content = <RFQList/>;
  else if (route === 'vendor-pos') Content = <VendorPOList/>;
  else if (parts[0] === 'vendor-pos' && parts[1]) Content = <VendorPODetail poId={parts[1]}/>;
  else if (route === 'grn') Content = <GRNList/>;
  else if (route === 'grn/new') Content = <GRNNew/>;
  else if (parts[0] === 'grn' && parts[1]) Content = <GRNDetail grnId={parts[1]}/>;
  else if (route === 'three-way') Content = <ThreeWayMatchList/>;
  else if (parts[0] === 'three-way' && parts[1]) Content = <ThreeWayMatchDetail viId={parts[1]}/>;
  else if (route === 'invoices') Content = <InvoiceList/>;
  else if (parts[0] === 'invoices' && parts[1] && parts[2]) Content = <InvoiceDetail soId={parts[1]} invId={parts[2]}/>;
  else if (parts[0] === 'invoices' && parts[1]) Content = <InvoiceDetail soId={parts[1]}/>;
  else if (route === 'collections') Content = <CollectionsDashboard/>;
  else if (route === 'settings') Content = <Settings/>;
  else if (route === 'audit') Content = <AuditLog/>;
  else Content = <Dashboard/>;

  // ---- PLATFORM-ONLY ACCOUNT -------------------------------------------
  // A master admin that belongs to no organization never sees a tenant's app:
  // no sidebar, no tenant data, no ERP routes. Just the platform console.
  if (state.platform && state.platform.ready && state.platform.isMaster && !state.platform.orgId) {
    return <PlatformOnlyApp/>;
  }

  return (
    <div className="app">
      <Topbar onOpenTweaks={openTweaks}/>
      <Sidebar/>
      <main className="main" data-screen-label={route}>
        <SyncErrorBanner/>
        {Content}
      </main>
      <OpcTweaks t={t} setTweak={setTweak}/>
    </div>
  );
}

// === Standalone platform console (its own page, outside any organization) ===
function PlatformOnlyApp() {
  const { state, getUser, currentUser } = useStore();
  const me = getUser(currentUser) || {};
  const signOut = async () => {
    try { if (window.OPC_SB) await window.OPC_SB.auth.signOut(); } catch (e) {}
    window.location.hash = '';
    window.location.reload();
  };
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
        borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="brand-mark" style={{ width: 28, height: 28, fontSize: 14 }}>P</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>OP Central · Platform</div>
          <div className="tiny muted">Developer console — not inside any organization</div>
        </div>
        <span className="badge accent dot">platform admin</span>
        <span className="small muted">{me.email || me.name || ''}</span>
        <button className="btn btn-sm" onClick={signOut}>Sign out</button>
      </div>
      <div style={{ padding: 0 }}>
        <PlatformConsole/>
      </div>
    </div>
  );
}

// === Tweaks panel content ===
function OpcTweaks({ t, setTweak }) {
  const { impersonate, currentUser, realUserId, state, getUser } = useStore();
  // Admin-only impersonation: real users from the DB. Hidden for non-admins.
  const isAdmin = (getUser(realUserId) || {}).role === 'Org Admin';
  const personas = (state.users || []).map(u => ({ id: u.id, name: `${u.name} — ${u.role}` }));

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Brand">
        <TweakColor label="Primary accent"
          value={t.primary_color}
          options={['#3563a4', '#0c7c59', '#7a3eaa', '#b15400', '#1c1917']}
          onChange={v => setTweak('primary_color', v)}/>
      </TweakSection>
      <TweakSection label="Layout">
        <TweakRadio label="Density" value={t.density}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          onChange={v => setTweak('density', v)}/>
        <TweakToggle label="Show BOM in SO list" value={t.show_internal_bom_inline}
          onChange={v => setTweak('show_internal_bom_inline', v)}/>
      </TweakSection>
      <TweakSection label="Industry template">
        <TweakSelect label="Workflow" value={t.industry_template}
          options={[
            { value: 'Trading', label: 'Trading' },
            { value: 'Manufacturing', label: 'Manufacturing' },
            { value: 'Distribution', label: 'Distribution' },
            { value: 'Service', label: 'Service / AMC' },
            { value: 'Mixed', label: 'Mixed' },
          ]}
          onChange={v => setTweak('industry_template', v)}/>
      </TweakSection>
      {isAdmin && personas.length > 1 && (
        <TweakSection label="Impersonate (admin)">
          <TweakSelect label="Acting as" value={currentUser}
            options={personas.map(p => ({ value: p.id, label: p.name }))}
            onChange={v => impersonate(v)}/>
        </TweakSection>
      )}
      <TweakSection label="Demo">
        <TweakButton label="Reset demo data"
          onClick={() => { if (confirm('Reset all demo state?')) { localStorage.clear(); window.location.reload(); }}}
          secondary/>
      </TweakSection>
    </TweaksPanel>
  );
}

// ===========================================================================
// Unsaved-changes banner
// ===========================================================================
// The worst failure this app had was a silent one: a record rejected by the
// database still showed on screen, lived only in localStorage, and was missing
// from every other browser. The user had no way to know. Anything that fails to
// save now says so, in the page, until it is retried.
function SyncErrorBanner() {
  const { syncErrors, retrySync } = useStore();
  const [busy, setBusy] = React.useState(false);
  if (!syncErrors || !syncErrors.length) return null;
  const tables = [...new Set(syncErrors.map(e => e.table))];
  const retry = async () => { setBusy(true); try { await retrySync(); } finally { setBusy(false); } };
  return (
    <div style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: 'var(--radius)',
                  background: 'var(--danger-bg)', border: '1px solid var(--danger)', fontSize: 12.5 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="alert" size={14} color="var(--danger)"/>
        <strong>Not saved to the server.</strong>
        <span>
          {syncErrors.length} change{syncErrors.length > 1 ? 's' : ''} to {tables.join(', ')}
          {' '}could not be saved, so {syncErrors.length > 1 ? 'they are' : 'it is'} only in this browser
          and will not appear for anyone else.
        </span>
        <button className="btn btn-sm" disabled={busy} onClick={retry} style={{ marginLeft: 'auto' }}>
          {busy ? 'Retrying…' : 'Retry now'}
        </button>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11.5 }}>Details</summary>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11.5, lineHeight: 1.6 }}>
          {syncErrors.slice(-5).map((e, i) => (
            <li key={i}><span className="mono">{e.table}</span> {e.op}
              {e.rowId ? <span className="mono"> · {String(e.rowId).slice(0, 28)}</span> : null} — {e.message}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
window.SyncErrorBanner = SyncErrorBanner;

// ===========================================================================
// Crash boundary
// ===========================================================================
// React unmounts the entire tree when a render throws, so ONE bad field in a
// component that sits on every page produces a white screen with nothing to go
// on — no message, no route, no way back. This turns that into something a
// non-technical user can act on and a developer can diagnose, and it keeps the
// rest of the session recoverable.
//
// Deliberately a class component: getDerivedStateFromError / componentDidCatch
// have no hook equivalent.
class CrashBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    this.setState({ info });
    try {
      console.error('[OPC] render crash', error, info && info.componentStack);
    } catch (e) { /* never throw from the handler */ }
  }
  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    const stack = (this.state.info && this.state.info.componentStack) || '';
    const detail = `${e && e.message ? e.message : String(e)}\n${stack}`.trim();
    // A stale cache is the most common cause and the most common cure, so it is
    // the primary action — but it is the user's choice, not automatic, because
    // clearing it discards anything not yet synced.
    const reset = () => {
      try { localStorage.removeItem('opc.state.v3'); } catch (err) {}
      window.location.reload();
    };
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 24, background: 'var(--bg, #f6f7f9)', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 620, width: '100%', background: 'var(--surface, #fff)',
                      border: '1px solid var(--border, #e3e3e6)', borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>This page could not be displayed</div>
          <div style={{ fontSize: 13, color: 'var(--text-2, #666)', lineHeight: 1.6 }}>
            Something in the app failed while drawing this screen. Your data is safe —
            nothing was saved or changed. Reloading usually clears it.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn" onClick={reset} title="Clears this browser's cached copy and reloads from the server">
              Clear cached data &amp; reload
            </button>
            <button className="btn" onClick={() => { window.location.hash = ''; window.location.reload(); }}>
              Back to dashboard
            </button>
          </div>
          <details open style={{ marginTop: 18 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-2, #666)' }}>
              Technical details (please send this if it keeps happening)
            </summary>
            <pre style={{ marginTop: 8, padding: 10, background: 'var(--bg-subtle, #f2f2f4)', borderRadius: 6,
                          fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: 260, overflow: 'auto' }}>{detail}</pre>
          </details>
        </div>
      </div>
    );
  }
}

function Root() {
  return (
    <CrashBoundary>
      <StoreProvider>
        <ToastProvider>
          <App/>
        </ToastProvider>
      </StoreProvider>
    </CrashBoundary>
  );
}

window.CrashBoundary = CrashBoundary;

ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
