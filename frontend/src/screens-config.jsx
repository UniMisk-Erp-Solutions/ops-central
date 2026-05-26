// OP Central — Onboarding Wizard (6 steps) + Settings (Customisation Engine)

function OnboardingWizard() {
  const { navigate } = useStore();
  const [step, setStep] = React.useState(1);
  const [data, setData] = React.useState({
    legal_name: 'Brightline Systems Pvt Ltd',
    display_name: 'Brightline',
    industry: 'Trading',
    gstin: '27AABCB9999N1Z2',
    address: 'Office 402, Lotus Tech Park, Powai, Mumbai 400076',
    turnover: '10-50',
    locations: 1,
    has_presales: true,
    has_sales_desk: true,
    pm_eq_tl: true,
    order_types: 'supply_imp',
    has_godown: true,
    vendor_policy: 'multi',
    md_approval: 'above_1L',
    eway_bill: 'yes_freq',
    has_collections: true,
    teams: ['Sales','Pre-sales','Project Management','Purchase','Stores','Billing','Collections','Managing Director'],
    invitees: [],
    import_method: 'fresh',
  });
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  const steps = [
    { n: 1, title: 'Organisation basics', desc: 'Legal name, GSTIN, address' },
    { n: 2, title: 'Workflow shape', desc: 'Map your team & process' },
    { n: 3, title: 'Team & users', desc: 'Roles & invites' },
    { n: 4, title: 'Master data', desc: 'Customers, vendors, products' },
    { n: 5, title: 'Document templates', desc: 'Logo, brand, edit templates' },
    { n: 6, title: 'Confirm & launch', desc: 'Review & go live' },
  ];

  const next = () => step < 6 ? setStep(step + 1) : navigate('dashboard');
  const back = () => step > 1 ? setStep(step - 1) : navigate('dashboard');

  return (
    <div className="onboard-shell">
      <div className="onboard-side">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div className="brand-mark">B</div>
          <strong>OP Central</strong>
        </div>
        <div className="muted tiny mb-2">Welcome — let's set up your workspace.</div>
        {steps.map(s => (
          <div key={s.n} className={`onboard-step ${step === s.n ? 'current' : step > s.n ? 'done' : ''}`}>
            <div className="num-dot">{step > s.n ? '✓' : s.n}</div>
            <div>
              <strong>{s.title}</strong>
              <span>{s.desc}</span>
            </div>
          </div>
        ))}
        <div className="grow"/>
        <div className="tiny muted">Takes about 8 minutes. You can revisit any step from Customisation later.</div>
      </div>

      <div className="onboard-main">
        <div className="mb-3" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="muted tiny">Step {step} of 6</div>
            <h1 className="page-title">{steps[step-1].title}</h1>
          </div>
          {step > 1 && <button className="btn btn-ghost" onClick={back}><Icon name="chevronLeft" size={13}/>Back</button>}
        </div>

        {step === 1 && (
          <div className="stack">
            <div className="card">
              <div className="card-body">
                <div className="field-row">
                  <div className="field">
                    <label className="field-label">Legal name *</label>
                    <input className="input" value={data.legal_name} onChange={e => set('legal_name', e.target.value)}/>
                  </div>
                  <div className="field">
                    <label className="field-label">Display name *</label>
                    <input className="input" value={data.display_name} onChange={e => set('display_name', e.target.value)}/>
                  </div>
                </div>
                <div className="field-row mt-2">
                  <div className="field">
                    <label className="field-label">Industry *</label>
                    <select className="select" value={data.industry} onChange={e => set('industry', e.target.value)}>
                      <option>Trading</option><option>Manufacturing</option><option>Distribution</option><option>Service</option><option>Mixed</option><option>Other</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Primary GSTIN *</label>
                    <input className="input mono" value={data.gstin} onChange={e => set('gstin', e.target.value)}/>
                    <div className="field-hint">15-character format validated</div>
                  </div>
                </div>
                <div className="field mt-2">
                  <label className="field-label">Registered address</label>
                  <textarea className="textarea" value={data.address} onChange={e => set('address', e.target.value)}/>
                </div>
                <div className="field-row mt-2">
                  <div className="field">
                    <label className="field-label">Annual turnover band</label>
                    <select className="select" value={data.turnover} onChange={e => set('turnover', e.target.value)}>
                      <option value="under5">Under ₹5 Cr</option>
                      <option value="5-10">₹5 – 10 Cr</option>
                      <option value="10-50">₹10 – 50 Cr</option>
                      <option value="above50">Above ₹50 Cr</option>
                    </select>
                    <div className="field-hint">Determines e-invoicing applicability</div>
                  </div>
                  <div className="field">
                    <label className="field-label">Office / warehouse locations</label>
                    <input type="number" className="input mono" value={data.locations} onChange={e => set('locations', parseInt(e.target.value) || 1)}/>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <Question label="Do you have a separate Pre-sales / quoting team?">
              <RadioCardGroup options={['Yes', 'No']} value={data.has_presales ? 'Yes' : 'No'} onChange={v => set('has_presales', v === 'Yes')}/>
            </Question>
            <Question label="Do you have a separate Sales Desk that receives POs?">
              <RadioCardGroup options={['Yes', 'No']} value={data.has_sales_desk ? 'Yes' : 'No'} onChange={v => set('has_sales_desk', v === 'Yes')}/>
            </Question>
            <Question label="Do your Project Managers also act as Team Leaders?">
              <RadioCardGroup options={['Same role (merge)', 'Separate roles']} value={data.pm_eq_tl ? 'Same role (merge)' : 'Separate roles'} onChange={v => set('pm_eq_tl', v === 'Same role (merge)')}/>
            </Question>
            <Question label="Which order types do you handle?">
              <RadioCardGroup options={['Supply only', 'Supply + Implementation', 'Supply + Implementation + Service / AMC']} value={data.order_types === 'supply' ? 'Supply only' : data.order_types === 'supply_imp' ? 'Supply + Implementation' : 'Supply + Implementation + Service / AMC'}
                onChange={v => set('order_types', v === 'Supply only' ? 'supply' : v === 'Supply + Implementation' ? 'supply_imp' : 'all')}/>
            </Question>
            <Question label="Do you have your own warehouse / godown?">
              <RadioCardGroup options={['Yes', 'No · drop-ship from vendor']} value={data.has_godown ? 'Yes' : 'No · drop-ship from vendor'} onChange={v => set('has_godown', v === 'Yes')}/>
            </Question>
            <Question label="Do you procure from multiple vendors per item?">
              <RadioCardGroup options={['Always (RFQ to 3-4)', 'Sometimes', 'Single vendor']} value={data.vendor_policy === 'multi' ? 'Always (RFQ to 3-4)' : data.vendor_policy} onChange={v => set('vendor_policy', v === 'Always (RFQ to 3-4)' ? 'multi' : v)}/>
            </Question>
            <Question label="Do you need Managing Director approval on vendor selection?">
              <RadioCardGroup options={['Always', 'Above ₹1,00,000', 'No']} value={data.md_approval === 'always' ? 'Always' : data.md_approval === 'above_1L' ? 'Above ₹1,00,000' : 'No'} onChange={v => set('md_approval', v === 'Always' ? 'always' : v === 'Above ₹1,00,000' ? 'above_1L' : 'no')}/>
            </Question>
            <Question label="Do you generate e-Way Bills?">
              <RadioCardGroup options={['Yes — frequently', 'Yes — sometimes', 'No']} value={data.eway_bill === 'yes_freq' ? 'Yes — frequently' : 'Yes — sometimes'} onChange={v => set('eway_bill', v === 'Yes — frequently' ? 'yes_freq' : 'yes_some')}/>
            </Question>
            <Question label="Do you have a dedicated Collections team?">
              <RadioCardGroup options={['Yes', 'No — handled by Accounts']} value={data.has_collections ? 'Yes' : 'No — handled by Accounts'} onChange={v => set('has_collections', v === 'Yes')}/>
            </Question>
          </div>
        )}

        {step === 3 && (
          <div className="stack">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Recommended team structure</h3>
                <span className="card-sub">Based on your Step 2 answers · edit anything</span>
              </div>
              <div className="card-body">
                <div className="muted small mb-2">8 teams recommended</div>
                {data.teams.map((t, i) => (
                  <div key={i} className="pool-item mb-1">
                    <div>
                      <strong className="small">{t}</strong>
                      <div className="tiny muted">{teamDesc[t] || 'Custom team'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm"><Icon name="edit" size={11}/></button>
                      <button className="btn btn-ghost btn-sm"><Icon name="trash" size={11}/></button>
                    </div>
                  </div>
                ))}
                <button className="btn mt-2"><Icon name="plus" size={11}/>Add team</button>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Invite users (optional)</h3></div>
              <div className="card-body">
                <div className="field-row-3">
                  <input className="input" placeholder="Email"/>
                  <select className="select"><option>Pick role…</option>{data.teams.map(t => <option key={t}>{t}</option>)}</select>
                  <button className="btn">Send invite</button>
                </div>
                <div className="muted tiny mt-2">You can invite users later from Settings → Users.</div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="stack">
            <Question label="How would you like to add your master data?">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[
                  { v: 'excel', t: 'Import from Excel', d: 'Upload .xlsx for customers, vendors, products (template provided)', icon: 'upload' },
                  { v: 'tally', t: 'Import from Tally', d: 'Connect Tally Prime via XML export', icon: 'link' },
                  { v: 'fresh', t: 'Start fresh', d: 'Add records manually as you go', icon: 'plus' },
                ].map(o => (
                  <div key={o.v} className={`radio-card ${data.import_method === o.v ? 'selected' : ''}`} onClick={() => set('import_method', o.v)}>
                    <div className="radio-card-marker"/>
                    <div>
                      <strong>{o.t}</strong>
                      <span>{o.d}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Question>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Templates available</h3></div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {['Customers.xlsx','Vendors.xlsx','Products.xlsx'].map(f => (
                  <div key={f} className="pool-item">
                    <div className="small">{f}</div>
                    <button className="btn btn-sm"><Icon name="download" size={11}/></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="stack">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Brand</h3></div>
              <div className="card-body">
                <div className="field-row">
                  <div className="field">
                    <label className="field-label">Logo upload</label>
                    <div className="ph-block">Drop logo · PNG/SVG · 1:1 preferred</div>
                  </div>
                  <div className="field">
                    <label className="field-label">Brand colour</label>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      {['#3563a4','#0c7c59','#7a3eaa','#b15400','#1c1917'].map(c => (
                        <div key={c} style={{ width: 28, height: 28, borderRadius: 4, background: c, border: c === '#3563a4' ? '2px solid var(--text)' : '1px solid var(--border)', cursor: 'pointer' }}/>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h3 className="card-title">Document templates</h3></div>
              <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {['Quotation','Sales Order Ack','Vendor PO','Delivery Challan','Tax Invoice','GRN'].map(t => (
                  <div key={t} className="pool-item">
                    <div>
                      <div className="small">{t}</div>
                      <div className="tiny muted">Default · ready to use</div>
                    </div>
                    <button className="btn btn-sm">Edit</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="stack">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Review your workspace</h3></div>
              <div className="card-body">
                <div className="dl">
                  <dt>Organisation</dt><dd>{data.legal_name}</dd>
                  <dt>GSTIN</dt><dd className="mono">{data.gstin}</dd>
                  <dt>Industry</dt><dd>{data.industry}</dd>
                  <dt>Turnover band</dt><dd>{data.turnover}</dd>
                  <dt>Teams</dt><dd>{data.teams.length} teams configured</dd>
                  <dt>Modules enabled</dt><dd>SO · VG · Pool · {data.eway_bill === 'yes_freq' && 'e-Way Bill · '} {data.has_collections && 'Collections · '}3-Way Match</dd>
                  <dt>Approval gates</dt><dd>5 default gates · MD approval above ₹1,00,000</dd>
                  <dt>Data import</dt><dd>{data.import_method === 'fresh' ? 'Start fresh' : data.import_method === 'excel' ? 'Excel import' : 'Tally import'}</dd>
                </div>
              </div>
            </div>
            <div className="card" style={{ background: 'var(--accent-bg)', borderColor: 'var(--accent-border)' }}>
              <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Icon name="sparkles" size={20} color="var(--accent)"/>
                <div className="grow">
                  <strong>Your workspace is ready.</strong>
                  <div className="small muted">100k+ configurations possible · everything editable from Customisation later.</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-3" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderTop: '1px solid var(--border)' }}>
          <span className="muted small">{step}/6</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 1 && <button className="btn" onClick={back}>Back</button>}
            <button className="btn btn-primary" onClick={next}>
              {step === 6 ? 'Launch workspace' : 'Next'} <Icon name="arrowRight" size={13}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const teamDesc = {
  'Sales': 'Receives customer POs, creates SOs',
  'Pre-sales': 'Drafts quotations · RFQ for pricing',
  'Project Management': 'Owns SOs end-to-end · approves dispatch',
  'Purchase': 'RFQ · vendor selection · vendor POs',
  'Stores': 'GRN · QC · surplus reconciliation',
  'Billing': '3-way match · invoices · e-Way Bills',
  'Collections': 'Overdue follow-ups · ageing reports',
  'Managing Director': 'High-value approvals · MIS oversight',
};

function Question({ label, children }) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="form-section-title" style={{ marginBottom: 12, color: 'var(--text)' }}>{label}</div>
        {children}
      </div>
    </div>
  );
}

function RadioCardGroup({ options, value, onChange }) {
  return (
    <div className="radio-card-grid" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, 1fr)` }}>
      {options.map(o => (
        <div key={o} className={`radio-card ${value === o ? 'selected' : ''}`} onClick={() => onChange(o)}>
          <div className="radio-card-marker"/>
          <div><strong>{o}</strong></div>
        </div>
      ))}
    </div>
  );
}

// ===== Settings / Customisation Engine =====
function Settings() {
  const { state, mutate, resetData } = useStore();
  const toast = useToast();
  const [tab, setTab] = React.useState('branding');

  const tabs = [
    { id: 'branding', label: 'Identity & branding', icon: 'sparkles' },
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'structure', label: 'Org structure', icon: 'users' },
    { id: 'permissions', label: 'Permissions', icon: 'check' },
    { id: 'workflow', label: 'Workflow stages', icon: 'repeat' },
    { id: 'soform', label: 'Sales Order form', icon: 'receipt' },
    { id: 'catalogue', label: 'Catalogue & BOM', icon: 'book' },
    { id: 'gates', label: 'Approval gates', icon: 'flag' },
    { id: 'docs', label: 'Documents', icon: 'file' },
    { id: 'fields', label: 'Custom fields', icon: 'grid' },
    { id: 'godown', label: 'Virtual Godown rules', icon: 'box' },
    { id: 'billing', label: 'Billing patterns', icon: 'cash' },
    { id: 'notif', label: 'Notifications', icon: 'bell' },
    { id: 'reports', label: 'Reports & dashboards', icon: 'chart' },
    { id: 'wizard', label: 'Onboarding wizard', icon: 'arrowRight' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customisation</h1>
          <div className="page-sub">13 tiers · everything configurable · zero hardcoded business logic</div>
        </div>
        <div className="page-actions">
          <button className="btn"><Icon name="download" size={13}/>Export config (JSON)</button>
          <button className="btn"><Icon name="upload" size={13}/>Import config</button>
          <button className="btn btn-danger" onClick={() => { if (confirm('Reset all demo data?')) resetData(); }}><Icon name="repeat" size={13}/>Reset demo data</button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: 500 }}>
          <div style={{ borderRight: '1px solid var(--border)', padding: '8px 6px', background: 'var(--surface-2)' }}>
            {tabs.map(t => (
              <div key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={13}/>{t.label}
              </div>
            ))}
          </div>
          <div style={{ padding: 18 }}>
            {tab === 'branding' && <BrandingPane/>}
            {tab === 'users' && <UsersPane/>}
            {tab === 'soform' && <SoFormFieldsPane/>}
            {tab === 'structure' && <StructurePane/>}
            {tab === 'permissions' && <PermissionsPane/>}
            {tab === 'workflow' && <WorkflowPane/>}
            {tab === 'gates' && <ApprovalGatesPane/>}
            {tab === 'godown' && <GodownRulesPane/>}
            {tab === 'notif' && <NotificationsPane/>}
            {tab === 'billing' && <BillingPatternsPane/>}
            {tab === 'docs' && <DocsPane/>}
            {tab === 'fields' && <CustomFieldsPane/>}
            {tab === 'catalogue' && <div className="empty"><div className="empty-title">Catalogue → manage via Products screen</div></div>}
            {tab === 'reports' && <ReportsPane/>}
            {tab === 'wizard' && <WizardPane/>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandingPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [name, setName] = React.useState(state.org.name || '');
  const [color, setColor] = React.useState(state.org.brand_color || '#3563a4');
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    const res = await saveConfig({}, { name, brand_color: color });
    setSaving(false);
    if (res && res.ok === false) { toast('Save failed — change kept locally', ''); return; }
    // Apply colour live
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--brand-mark-bg', color);
    toast('Branding saved', 'success');
  };

  return (
    <div className="stack">
      <h3 className="card-title">Identity & branding</h3>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Organisation name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)}/>
        </div>
        <div className="field">
          <label className="field-label">Subdomain</label>
          <div style={{ display: 'flex' }}>
            <input className="input mono" defaultValue="brightline" style={{ borderRadius: '4px 0 0 4px' }}/>
            <span style={{ padding: '6px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border-strong)', borderLeft: 'none', borderRadius: '0 4px 4px 0', fontSize: 12, color: 'var(--text-3)' }}>.opcentral.in</span>
          </div>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="field-label">Brand colour</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {['#3563a4','#0c7c59','#7a3eaa','#b15400','#1c1917'].map(c => (
              <div key={c} onClick={() => setColor(c)} title={c}
                   style={{ width: 32, height: 32, borderRadius: 4, background: c, border: c === color ? '2px solid var(--text)' : '1px solid var(--border)', cursor: 'pointer' }}/>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="field-label">Default currency</label>
          <select className="select"><option>INR ₹</option></select>
        </div>
      </div>
      <div className="field">
        <label className="field-label">Logo</label>
        <div className="ph-block" style={{ width: 160 }}>Drop logo here</div>
      </div>
      <div><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save branding'}</button></div>
    </div>
  );
}

function StructurePane() {
  const { state } = useStore();
  return (
    <div className="stack">
      <h3 className="card-title">Org structure</h3>
      <div className="muted small">Rename, merge, split or remove any team. {state.users.length} users mapped.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Team</th><th className="num">Members</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {[
                ['Sales', 1, 'Receives customer POs, creates SOs'],
                ['Pre-sales', 0, 'Drafts quotations'],
                ['Project Management', 2, 'Owns SOs end-to-end'],
                ['Purchase', 1, 'RFQ + vendor selection'],
                ['Stores', 1, 'GRN + QC + surplus'],
                ['Billing', 1, '3-way match + invoices'],
                ['Collections', 1, 'Overdue follow-ups'],
                ['Managing Director', 1, 'High-value approvals'],
                ['Org Admin', 1, 'Customisation + billing'],
              ].map(([n,c,d], i) => (
                <tr key={i}>
                  <td><strong>{n}</strong></td>
                  <td className="num">{c}</td>
                  <td className="small muted">{d}</td>
                  <td>
                    <div className="row-actions" style={{ opacity: 1, display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm"><Icon name="edit" size={11}/></button>
                      <button className="btn btn-ghost btn-sm"><Icon name="trash" size={11}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <button className="btn"><Icon name="plus" size={11}/>Add team</button>
    </div>
  );
}

function PermissionsPane() {
  return (
    <div className="stack">
      <h3 className="card-title">Permissions matrix</h3>
      <div className="muted small">6 grains: Module · Screen · Action · Field · Record · Approval authority</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t" style={{ fontSize: 11.5 }}>
            <thead><tr>
              <th>Permission</th>
              <th className="num">Sales</th><th className="num">PM</th><th className="num">Purchase</th>
              <th className="num">Stores</th><th className="num">Billing</th><th className="num">MD</th><th className="num">Coll.</th>
            </tr></thead>
            <tbody>
              {[
                ['View Sales Orders', 'C', 'A', '−', '−', 'V', 'A', 'V'],
                ['Create Sales Orders', 'C', 'C', '−', '−', '−', '−', '−'],
                ['View cost / margin', '−', 'V', 'V', '−', 'V', 'V', '−'],
                ['Approve Vendor PO', '−', '−', 'C', '−', '−', 'V', '−'],
                ['MD approval threshold', '−', '−', '−', '−', '−', '✓', '−'],
                ['Post GRN', '−', 'V', 'V', 'C', '−', '−', '−'],
                ['3-Way Match', '−', 'V', '−', '−', 'C', '−', '−'],
                ['Raise Tax Invoice', '−', 'V', '−', '−', 'C', 'V', '−'],
                ['Modify approval gates', '−', '−', '−', '−', '−', '−', '−'],
                ['Reset demo data (Admin)', '−', '−', '−', '−', '−', '−', '−'],
              ].map((row, i) => (
                <tr key={i}>
                  <td><strong>{row[0]}</strong></td>
                  {row.slice(1).map((v, j) => (
                    <td key={j} className="num mono" style={{ color: v === 'C' ? 'var(--success)' : v === 'V' ? 'var(--info)' : v === '✓' ? 'var(--accent)' : v === 'A' ? 'var(--warning)' : 'var(--text-muted)' }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="tiny muted">Legend: <strong className="mono" style={{ color: 'var(--success)' }}>C</strong> create · <strong className="mono" style={{ color: 'var(--warning)' }}>A</strong> approve · <strong className="mono" style={{ color: 'var(--info)' }}>V</strong> view · <strong className="mono">−</strong> none</div>
        </div>
      </div>
    </div>
  );
}

function WorkflowPane() {
  return (
    <div className="stack">
      <h3 className="card-title">SO Workflow stages</h3>
      <div className="muted small">Rename, reorder, add or remove stages. Set owners and auto-transition rules.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>#</th><th>Stage</th><th>Default owner</th><th>Auto-rules</th><th></th></tr></thead>
            <tbody>
              {SO_LIFECYCLE.map((s, i) => (
                <tr key={s}>
                  <td className="mono small muted">{i+1}</td>
                  <td><strong>{s}</strong></td>
                  <td className="small">{['Sales','MD/PM','PM','Purchase','Stores','PM','PM','Billing','Billing','Collections','Accounts','PM'][i]}</td>
                  <td className="small muted">{i === 2 ? 'Auto-open VG' : i === 4 ? 'On GRN posted' : i === 7 ? 'On dispatch authorised' : '—'}</td>
                  <td><Icon name="move" size={12} color="var(--text-3)"/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ApprovalGatesPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [gates, setGates] = React.useState(() => (state.config.approval_gates || []).map(g => ({ ...g, approvers: [...(g.approvers || [])] })));
  const [saving, setSaving] = React.useState(false);

  const update = (id, patch) => setGates(gs => gs.map(g => g.id === id ? { ...g, ...patch } : g));
  const remove = (id) => setGates(gs => gs.filter(g => g.id !== id));
  const add = () => setGates(gs => [...gs, { id: 'g' + Date.now().toString(36), entity: 'Vendor PO', tier: 'New threshold', approvers: ['Managing Director'] }]);

  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ approval_gates: gates });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Approval gates saved', res && res.ok === false ? '' : 'success');
  };

  return (
    <div className="stack">
      <h3 className="card-title">Approval gates</h3>
      <div className="muted small">Define which roles must approve, per entity & threshold. Approvers are comma-separated.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Entity</th><th>Threshold</th><th>Approvers (comma-separated)</th><th></th></tr></thead>
            <tbody>
              {gates.map(g => (
                <tr key={g.id}>
                  <td>
                    <input className="input" value={g.entity} onChange={e => update(g.id, { entity: e.target.value })} style={{ height: 26 }}/>
                  </td>
                  <td>
                    <input className="input mono" value={g.tier} onChange={e => update(g.id, { tier: e.target.value })} style={{ height: 26, width: 160 }}/>
                  </td>
                  <td>
                    <input className="input" value={(g.approvers || []).join(', ')}
                           onChange={e => update(g.id, { approvers: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                           style={{ height: 26 }}/>
                  </td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => remove(g.id)}><Icon name="trash" size={11} color="var(--danger)"/></button></td>
                </tr>
              ))}
              {gates.length === 0 && <tr><td colSpan="4"><div className="empty">No gates — add one.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={add}><Icon name="plus" size={11}/>Add gate</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save gates'}</button>
      </div>
    </div>
  );
}

function GodownRulesPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const c = state.config;
  const [poolFirst, setPoolFirst] = React.useState(c.pool_first !== false);
  const [lpp, setLpp] = React.useState(c.lpp_threshold ?? 10);
  const [vtol, setVtol] = React.useState(c.three_way_value_tolerance ?? 2);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    const res = await saveConfig({
      pool_first: poolFirst,
      lpp_threshold: Number(lpp) || 0,
      three_way_value_tolerance: Number(vtol) || 0,
    });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Godown rules saved', res && res.ok === false ? '' : 'success');
  };

  return (
    <div className="stack">
      <h3 className="card-title">Virtual Godown rules</h3>
      <div className="card">
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div className="grow">
              <strong className="small">Pool-first allocation</strong>
              <div className="tiny muted">When SO approved, check Master Pool before triggering RFQ</div>
            </div>
            <Toggle value={poolFirst} onChange={setPoolFirst}/>
          </div>
          <RuleRow label="Cross-SO transfer" desc="Allow PMs to lend stock between SOs (backend-only)" value={true}/>
          <RuleRow label="Surplus reconciliation" desc="On SO close, Stores reconciles and returns leftover to pool" value={true}/>
          <RuleRow label="Customer documents hide transfers" desc="Internal cross-SO movements never appear on DC/Invoice/EWB" value={true} locked/>
          <div className="divider"/>
          <div className="field-row">
            <div className="field">
              <label className="field-label">LPP variance threshold</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" className="input mono" value={lpp} onChange={e => setLpp(e.target.value)} style={{ width: 70 }}/> <span className="small muted">%</span>
              </div>
            </div>
            <div className="field">
              <label className="field-label">3-Way match value tolerance</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" className="input mono" value={vtol} onChange={e => setVtol(e.target.value)} step="0.5" style={{ width: 70 }}/> <span className="small muted">%</span>
              </div>
            </div>
          </div>
          <div className="mt-2"><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</button></div>
        </div>
      </div>
    </div>
  );
}

function RuleRow({ label, desc, value, locked }) {
  const [on, setOn] = React.useState(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="grow">
        <strong className="small">{label}</strong>
        <div className="tiny muted">{desc}</div>
      </div>
      {locked && <span className="badge tiny" style={{ marginRight: 6 }}>Locked</span>}
      <Toggle value={on} onChange={locked ? () => {} : setOn}/>
    </div>
  );
}

function NotificationsPane() {
  return (
    <div className="stack">
      <h3 className="card-title">Notification events</h3>
      <div className="muted small">Per event · per channel · template editable</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t" style={{ fontSize: 12 }}>
            <thead><tr>
              <th>Event</th><th>Recipients</th><th className="num">Email</th><th className="num">SMS</th><th className="num">WhatsApp</th><th className="num">In-app</th>
            </tr></thead>
            <tbody>
              {[
                ['SO created', 'Sales · PM'],['SO approved', 'PM · Purchase'],['Vendor PO sent', 'Vendor · Purchase'],
                ['Material received', 'PM · Billing'],['3-Way match exception', 'Billing · PM'],
                ['Invoice sent', 'Customer · Sales'],['Payment due 7d', 'Customer · Coll.'],
                ['Payment overdue', 'Customer · Coll · Sales'],['Approval pending', 'Approver'],
                ['Cross-SO transfer', 'Source PM'],
              ].map(([e, r], i) => (
                <tr key={i}>
                  <td><strong>{e}</strong></td>
                  <td className="small muted">{r}</td>
                  {[true, e.includes('Payment') || e.includes('Invoice'), e.includes('Payment'), true].map((on, j) => (
                    <td key={j} className="num"><div style={{ display: 'flex', justifyContent: 'flex-end' }}><Toggle value={on} onChange={() => {}}/></div></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BillingPatternsPane() {
  return (
    <div className="stack">
      <h3 className="card-title">Billing patterns</h3>
      <div className="muted small">Pick the patterns enabled for new SOs</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { t: 'Lumpsum', d: 'Single invoice on full delivery', on: true },
          { t: 'Advance + Balance', d: 'Advance %, balance on delivery', on: true, hint: '30% advance default' },
          { t: 'Milestone', d: 'Define milestones with %', on: true },
          { t: 'Recurring (AMC)', d: 'Monthly/quarterly invoices', on: false },
          { t: 'Per-unit', d: 'Bill per dispatched unit', on: true },
        ].map((p, i) => (
          <div key={i} className="pool-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{p.t}</strong>
              <Toggle value={p.on} onChange={() => {}}/>
            </div>
            <div className="tiny muted">{p.d}</div>
            {p.hint && <div className="tiny mono" style={{ color: 'var(--accent)' }}>{p.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DocsPane() {
  return (
    <div className="stack">
      <h3 className="card-title">Document templates</h3>
      <div className="muted small">14 default templates · WYSIWYG editor · placeholders like {`{{customer_name}}`} · live preview</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {['Quotation','SO Acknowledgement','Vendor Purchase Order','GRN','Delivery Challan','Proforma Invoice','Tax Invoice','Partial Invoice','Final Settlement Invoice','Credit Note','Debit Note (vendor)','Payment Receipt','e-Way Bill','AMC Contract'].map(t => (
          <div key={t} className="pool-item">
            <div>
              <strong className="small">{t}</strong>
              <div className="tiny muted">Default · v1.0</div>
            </div>
            <button className="btn btn-sm">Edit</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomFieldsPane() {
  return (
    <div className="stack">
      <h3 className="card-title">Custom fields</h3>
      <div className="muted small">Up to 20 custom fields per master · text · number · dropdown · date</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Master</th><th>Field</th><th>Type</th><th>Required</th><th></th></tr></thead>
            <tbody>
              <tr><td>Customer</td><td>Region</td><td>Dropdown</td><td>No</td><td></td></tr>
              <tr><td>Customer</td><td>Sales channel</td><td>Dropdown</td><td>Yes</td><td></td></tr>
              <tr><td>Vendor</td><td>Empanelment date</td><td>Date</td><td>No</td><td></td></tr>
              <tr><td>Product</td><td>Warranty months</td><td>Number</td><td>Yes</td><td></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <button className="btn"><Icon name="plus" size={11}/>Add custom field</button>
    </div>
  );
}

function ReportsPane() {
  return (
    <div className="stack">
      <h3 className="card-title">Reports & dashboards</h3>
      <div className="muted small">Drag-drop widgets · custom report builder · schedule exports</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          'Sales register (GSTR-1 ready)','Purchase register (GSTR-2B reco)','Stock ageing (Master Pool)',
          'Vendor performance','Customer outstanding','SO P&L per order',
          'LPP variance log','Approval log','Cross-SO transfer log','Audit log','GSTR-3B summary','TDS register',
        ].map(r => (
          <div key={r} className="pool-item">
            <div>
              <div className="small"><strong>{r}</strong></div>
              <div className="tiny muted">Pre-built · Excel + PDF</div>
            </div>
            <button className="btn btn-sm"><Icon name="download" size={11}/></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersPane() {
  const { state, createUser, setUserActive, removeUser, realUserId } = useStore();
  const toast = useToast();
  const roles = (state.config.roles && state.config.roles.length) ? state.config.roles : Object.keys(PERMISSIONS);
  const [form, setForm] = React.useState({ name: '', email: '', password: '', role: 'Sales' });
  const [busy, setBusy] = React.useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const add = async () => {
    if (!form.name || !form.email || !form.password) { toast('Name, email and password are required'); return; }
    setBusy(true);
    const res = await createUser(form);
    setBusy(false);
    if (!res.ok) { toast('Create failed: ' + (res.error || ''), ''); return; }
    toast(`${form.name} added as ${form.role}`, 'success');
    setForm({ name: '', email: '', password: '', role: form.role });
  };

  return (
    <div className="stack">
      <h3 className="card-title">Users</h3>
      <div className="muted small">Add a user with a role + login credentials. They sign in with their email & password and land on their role's dashboard — and become part of the workflow.</div>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Add user</h3></div>
        <div className="card-body">
          <div className="field-row-3">
            <div className="field"><label className="field-label">Full name *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)}/></div>
            <div className="field"><label className="field-label">Email *</label><input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)}/></div>
            <div className="field"><label className="field-label">Role *</label>
              <select className="select" value={form.role} onChange={e => set('role', e.target.value)}>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="field-row mt-2">
            <div className="field"><label className="field-label">Password *</label><input className="input" type="text" value={form.password} onChange={e => set('password', e.target.value)} placeholder="set an initial password"/></div>
            <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" onClick={add} disabled={busy}><Icon name="plus" size={12}/>{busy ? 'Adding…' : 'Add user'}</button>
            </div>
          </div>
          <div className="tiny muted mt-1">Permissions follow the role (edit roles under the Permissions tab). Password is stored as-is for this demo.</div>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Existing users · {state.users.length}</h3></div>
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {state.users.map(u => (
                <tr key={u.id}>
                  <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Avatar user={u} size={20}/>{u.name}</div></td>
                  <td className="mono small">{u.email || '—'}</td>
                  <td><span className="badge">{u.role}</span></td>
                  <td><Toggle value={u.active !== false} onChange={v => setUserActive(u.id, v)}/></td>
                  <td>{u.id !== realUserId && (
                    <button className="btn btn-ghost btn-sm" onClick={async () => {
                      if (confirm('Remove ' + u.name + '?')) { const r = await removeUser(u.id); toast(r.ok ? 'User removed' : (r.error || 'Failed'), r.ok ? '' : ''); }
                    }}><Icon name="trash" size={11} color="var(--danger)"/></button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SoFormFieldsPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [fields, setFields] = React.useState(() => (state.config.so_form_fields || []).map(f => ({ ...f })));
  const [nf, setNf] = React.useState({ label: '', type: 'text', required: false, options: '' });
  const [saving, setSaving] = React.useState(false);

  const slug = (s) => 'cf_' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  const addField = () => {
    if (!nf.label.trim()) { toast('Field label is required'); return; }
    let key = slug(nf.label);
    if (!key || key === 'cf_') key = 'cf_' + Date.now().toString(36);
    if (fields.find(f => f.key === key)) key = key + '_' + Date.now().toString(36).slice(-3);
    const field = { key, label: nf.label.trim(), type: nf.type, required: !!nf.required, removable: true, custom: true };
    if (nf.type === 'select') field.options = nf.options.split(',').map(s => s.trim()).filter(Boolean);
    setFields(fs => [...fs, field]);
    setNf({ label: '', type: 'text', required: false, options: '' });
  };
  const removeField = (key) => setFields(fs => fs.filter(f => f.key !== key));
  const toggleReq = (key) => setFields(fs => fs.map(f => f.key === key ? { ...f, required: !f.required } : f));

  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ so_form_fields: fields });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Sales Order form saved', res && res.ok === false ? '' : 'success');
  };

  return (
    <div className="stack">
      <h3 className="card-title">Sales Order form</h3>
      <div className="muted small">Built-in fields are fixed; add any custom fields you need. Custom fields appear in the "Additional details" section when creating a Sales Order and are saved with the order.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Required</th><th>Kind</th><th></th></tr></thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.key}>
                  <td><strong>{f.label}</strong></td>
                  <td className="mono small muted">{f.key}</td>
                  <td className="small">{f.type}{f.type === 'select' && f.options ? ` (${f.options.length})` : ''}</td>
                  <td><Toggle value={!!f.required} onChange={() => toggleReq(f.key)}/></td>
                  <td>{f.custom ? <span className="badge accent">Custom</span> : <span className="badge">Built-in</span>}</td>
                  <td>{f.removable !== false
                    ? <button className="btn btn-ghost btn-sm" onClick={() => removeField(f.key)}><Icon name="trash" size={11} color="var(--danger)"/></button>
                    : <span className="tiny muted">locked</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Add custom field</h3></div>
        <div className="card-body">
          <div className="field-row-3">
            <div className="field"><label className="field-label">Label</label><input className="input" value={nf.label} onChange={e => setNf({ ...nf, label: e.target.value })} placeholder="e.g. Delivery instructions"/></div>
            <div className="field"><label className="field-label">Type</label>
              <select className="select" value={nf.type} onChange={e => setNf({ ...nf, type: e.target.value })}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="textarea">Long text</option>
                <option value="select">Dropdown</option>
              </select>
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={nf.required} onChange={e => setNf({ ...nf, required: e.target.checked })}/> Required
              </label>
            </div>
          </div>
          {nf.type === 'select' && (
            <div className="field mt-2"><label className="field-label">Options (comma-separated)</label><input className="input" value={nf.options} onChange={e => setNf({ ...nf, options: e.target.value })} placeholder="Option A, Option B, Option C"/></div>
          )}
          <div className="mt-2" style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={addField}><Icon name="plus" size={11}/>Add field</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save form'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WizardPane() {
  const { navigate } = useStore();
  return (
    <div className="stack">
      <h3 className="card-title">Onboarding wizard</h3>
      <div className="muted small">Re-run for new branches or to reshape a major workflow change.</div>
      <button className="btn btn-primary" onClick={() => navigate('onboarding')}><Icon name="sparkles" size={13}/>Open wizard</button>
    </div>
  );
}

window.OnboardingWizard = OnboardingWizard;
window.Settings = Settings;
