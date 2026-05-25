// OP Central — Main app: routing, tweaks panel, providers

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "primary_color": "#3563a4",
  "density": "comfortable",
  "industry_template": "Trading",
  "show_internal_bom_inline": true
}/*EDITMODE-END*/;

function App() {
  const { route, currentUser, getUser, navigate } = useStore();
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

  // Not signed in (or session points at a removed user) → login screen.
  if (!currentUser || !u) {
    return <LoginScreen/>;
  }

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
  else if (route === 'sales-orders') Content = <SalesOrdersList/>;
  else if (route === 'sales-orders/new') Content = <SalesOrderNew/>;
  else if (parts[0] === 'sales-orders' && parts[1]) Content = <SalesOrderDetail soId={parts[1]}/>;
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
  else if (parts[0] === 'invoices' && parts[1]) Content = <InvoiceDetail soId={parts[1]}/>;
  else if (route === 'collections') Content = <CollectionsDashboard/>;
  else if (route === 'settings') Content = <Settings/>;
  else if (route === 'audit') Content = <AuditLog/>;
  else Content = <Dashboard/>;

  return (
    <div className="app">
      <Topbar onOpenTweaks={openTweaks}/>
      <Sidebar/>
      <main className="main" data-screen-label={route}>
        {Content}
      </main>
      <OpcTweaks t={t} setTweak={setTweak}/>
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

function Root() {
  return (
    <StoreProvider>
      <ToastProvider>
        <App/>
      </ToastProvider>
    </StoreProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
