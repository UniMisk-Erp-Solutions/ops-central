// OP Central — Flow hub: the post-login landing page.
//
// A picture of the six-stage lifecycle (Sales Order -> Vendors -> Procurement
// -> Inventory -> Dispatch -> Billing), each stage a big clickable node.
// Clicking one opens a small hub listing only the real, already-existing
// pages that belong to that stage -- nothing here is a new screen with its
// own logic; every card just navigates to the exact route that was always
// there. Every route and every role's actual access are unchanged -- only
// how you get to them changed.
//
// This is now the primary mouse nav: the Sidebar was removed (see
// docs/keyboard-control.md's Traps for what that did and did not take with
// it -- Ctrl+K, g-then-letter and Alt+letter still reach every screen).
//
// The stage -> module mapping is deliberately a short, static list (module
// ids only) kept in ONE place, FLOW_STAGES below; the label/icon/badge for
// each module is never duplicated here -- it's read straight out of
// opcNavGroups(state, role) (shell.jsx), the one nav list the command
// palette also searches. A module a given role/org cannot see there
// (nav-gated or feature-gated) simply does not appear on its stage's hub
// either.

const FLOW_STAGES = [
  { id: 'sales-order', label: 'Sales Order', icon: 'receipt', modules: ['client-requests', 'sourcing', 'sales-orders', 'customers'] },
  { id: 'vendors', label: 'Vendors', icon: 'factory', modules: ['rfq', 'vendor-pos', 'vendors', 'mapping'] },
  { id: 'procurement', label: 'Procurement', icon: 'cart', modules: ['godown', 'three-way'] },
  { id: 'inventory', label: 'Inventory', icon: 'box', modules: ['pool', 'grn', 'transfers'] },
  { id: 'dispatch', label: 'Dispatch', icon: 'truck', modules: ['scm'] },
  { id: 'billing', label: 'Billing', icon: 'cash', modules: ['invoices', 'collections'] },
];
window.FLOW_STAGES = FLOW_STAGES;

// Every nav item from every group, by id -- the one lookup both FlowHome
// (counting what's available per stage) and FlowStage (listing cards) share,
// so neither can read a module's label/icon differently from the sidebar.
function flowModuleIndex(state, role) {
  const flat = {};
  (window.opcNavGroups ? window.opcNavGroups(state, role) : []).forEach(g => g.items.forEach(it => { flat[it.id] = it; }));
  return flat;
}

function FlowTopActions() {
  const { navigate, getUser, currentUser } = useStore();
  const role = getUser(currentUser)?.role;
  const canSettings = window.canAccess ? window.canAccess(role, 'settings') : false;
  return (
    <div className="flow-top-actions">
      <button className="btn" onClick={() => navigate('dashboard')}><Icon name="home" size={13}/>Dashboard</button>
      {canSettings && <button className="btn" onClick={() => navigate('settings')}><Icon name="settings" size={13}/>Settings</button>}
    </div>
  );
}

function FlowHome() {
  const { state, navigate, getUser, currentUser } = useStore();
  const role = getUser(currentUser)?.role;
  const index = flowModuleIndex(state, role);

  return (
    <div className="page flow-page">
      <div className="flow-header">
        <div>
          <h1 className="page-title">Where do you want to go?</h1>
          <div className="page-sub">One order's whole journey, start to close — pick a step</div>
        </div>
        <FlowTopActions/>
      </div>

      <div className="flow-diagram">
        {FLOW_STAGES.map((s, i) => {
          const available = s.modules.some(id => index[id]);
          return (
            <React.Fragment key={s.id}>
              <div
                className={`flow-node ${available ? '' : 'flow-node-empty'}`}
                style={available ? { cursor: 'pointer' } : undefined}
                role={available ? 'link' : undefined}
                tabIndex={available ? 0 : -1}
                onClick={available ? () => navigate(`flow/${s.id}`) : undefined}
                onKeyDown={available ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`flow/${s.id}`); } }) : undefined}
                title={available ? undefined : 'Nothing in this step is available to your role'}
              >
                <div className="flow-node-icon"><Icon name={s.icon} size={30}/></div>
                <div className="flow-node-label">{s.label}</div>
              </div>
              {i < FLOW_STAGES.length - 1 && <div className="flow-arrow"><Icon name="arrowRight" size={16}/></div>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
window.FlowHome = FlowHome;

function FlowStage({ stageId }) {
  const { state, navigate, getUser, currentUser } = useStore();
  const role = getUser(currentUser)?.role;
  const stage = FLOW_STAGES.find(s => s.id === stageId);
  const index = flowModuleIndex(state, role);
  const items = stage ? stage.modules.map(id => index[id]).filter(Boolean) : [];

  if (!stage) {
    return (
      <div className="page flow-page">
        <div className="flow-header"><h1 className="page-title">Not found</h1><FlowTopActions/></div>
        <div className="empty"><div className="empty-title">That step doesn't exist</div>
          <button className="btn mt-2" onClick={() => navigate('flow')}>← Back to the flow</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page flow-page">
      <div className="flow-header">
        <div>
          <div className="flow-back" style={{ cursor: 'pointer' }} onClick={() => navigate('flow')}>
            <Icon name="chevronLeft" size={12}/> All steps
          </div>
          <h1 className="page-title"><Icon name={stage.icon} size={20}/> {stage.label}</h1>
          <div className="page-sub">{items.length} page{items.length === 1 ? '' : 's'} for this step</div>
        </div>
        <FlowTopActions/>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-title">Nothing here for your role</div>
          None of this step's pages are part of what you can open. Try another step, or Dashboard.
        </div>
      ) : (
        <div className="flow-card-grid">
          {items.map(it => (
            <div key={it.id} className="flow-card" style={{ cursor: 'pointer' }}
                 role="link" tabIndex={0}
                 onClick={() => navigate(it.id)}
                 onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(it.id); } }}>
              <div className="flow-card-icon"><Icon name={it.icon} size={20}/></div>
              <div className="grow">
                <div className="flow-card-label">{it.label}</div>
              </div>
              {it.badge ? <span className="badge">{it.badge}</span> : null}
              <Icon name="chevronRight" size={14} color="var(--text-3)"/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
window.FlowStage = FlowStage;
