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

// ===== Shared helpers (download / CSV) =====
function opcDownload(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function opcToCSV(rows) {
  if (!rows || !rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

// ===== Settings / Customisation Engine =====
function Settings() {
  const { state, resetData, saveConfig, navigate } = useStore();
  const toast = useToast();
  const [tab, setTab] = React.useState('branding');
  const fileRef = React.useRef(null);

  const exportConfig = () => {
    const blob = { org: state.org, ...state.config };
    opcDownload('opcentral-config.json', JSON.stringify(blob, null, 2));
    toast('Config exported', 'success');
  };
  const importConfig = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const { org, ...cfg } = parsed;
      const res = await saveConfig(cfg, org || null);
      toast(res && res.ok === false ? 'Import save failed' : 'Config imported & saved', res && res.ok === false ? '' : 'success');
    } catch (err) {
      toast('Invalid config file: ' + (err.message || err), '');
    }
  };

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
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={importConfig}/>
          <button className="btn" onClick={exportConfig}><Icon name="download" size={13}/>Export config (JSON)</button>
          <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="upload" size={13}/>Import config</button>
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
            {tab === 'catalogue' && (
              <div className="empty">
                <div className="empty-title">Catalogue & BOM</div>
                Products, categories and BOM templates are managed on the Products screen.
                <div className="mt-2"><button className="btn btn-primary" onClick={() => navigate('products')}><Icon name="book" size={13}/>Open Products &amp; BOM</button></div>
              </div>
            )}
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

const DEFAULT_TEAMS = [
  { name: 'Sales', desc: 'Receives customer POs, creates SOs' },
  { name: 'Pre-sales', desc: 'Drafts quotations' },
  { name: 'Project Management', desc: 'Owns SOs end-to-end' },
  { name: 'Purchase', desc: 'RFQ + vendor selection' },
  { name: 'Stores', desc: 'GRN + QC + surplus' },
  { name: 'Billing', desc: '3-way match + invoices' },
  { name: 'Collections', desc: 'Overdue follow-ups' },
  { name: 'Supervisor', desc: 'Site implementation · BOQ + daily usage' },
  { name: 'Managing Director', desc: 'High-value approvals' },
  { name: 'Org Admin', desc: 'Customisation + billing' },
];

function StructurePane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [teams, setTeams] = React.useState(() => {
    const t = state.config.org_teams;
    return (Array.isArray(t) && t.length) ? t.map(x => ({ ...x })) : DEFAULT_TEAMS.map(x => ({ ...x }));
  });
  const [saving, setSaving] = React.useState(false);
  const memberCount = (name) => state.users.filter(u => u.role === name).length;
  const update = (i, patch) => setTeams(ts => ts.map((t, j) => j === i ? { ...t, ...patch } : t));
  const remove = (i) => setTeams(ts => ts.filter((_, j) => j !== i));
  const add = () => setTeams(ts => [...ts, { name: 'New Team', desc: '' }]);
  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ org_teams: teams });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Org structure saved', res && res.ok === false ? '' : 'success');
  };
  return (
    <div className="stack">
      <h3 className="card-title">Org structure</h3>
      <div className="muted small">Rename, add or remove teams. {state.users.length} users mapped.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Team</th><th className="num">Members</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={i}>
                  <td><input className="input" value={t.name} onChange={e => update(i, { name: e.target.value })} style={{ height: 26 }}/></td>
                  <td className="num">{memberCount(t.name)}</td>
                  <td><input className="input" value={t.desc || ''} onChange={e => update(i, { desc: e.target.value })} style={{ height: 26 }}/></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => remove(i)}><Icon name="trash" size={11} color="var(--danger)"/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={add}><Icon name="plus" size={11}/>Add team</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save structure'}</button>
      </div>
    </div>
  );
}

const PERMISSION_SCREENS = [
  ['dashboard', 'Dashboard'], ['inbox', 'My Tasks'], ['sales-orders', 'Sales Orders'],
  ['customers', 'Customers'], ['godown', 'Virtual Godowns'], ['pool', 'Master Pool'],
  ['transfers', 'Transfers'], ['rfq', 'RFQ'], ['vendor-pos', 'Vendor POs'], ['grn', 'GRN'],
  ['three-way', '3-Way Match'], ['vendors', 'Vendors'], ['invoices', 'Invoices'],
  ['collections', 'Collections'], ['products', 'Products'], ['settings', 'Customisation'],
  ['audit', 'Audit Log'], ['onboarding', 'Onboarding'],
];

function PermissionsPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const base = state.config.permissions || (typeof PERMISSIONS !== 'undefined' ? PERMISSIONS : {});
  const [perms, setPerms] = React.useState(() => JSON.parse(JSON.stringify(base)));
  const [saving, setSaving] = React.useState(false);
  const roles = Object.keys(perms);
  const has = (role, sid) => (perms[role] && perms[role].nav || []).includes(sid);
  const toggle = (role, sid) => {
    if (role === 'Org Admin') return; // admin always has full access
    setPerms(p => {
      const nav = new Set((p[role] && p[role].nav) || []);
      nav.has(sid) ? nav.delete(sid) : nav.add(sid);
      return { ...p, [role]: { ...p[role], nav: Array.from(nav) } };
    });
  };
  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ permissions: perms });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Permissions saved · applied live', res && res.ok === false ? '' : 'success');
  };
  return (
    <div className="stack">
      <h3 className="card-title">Screen access by role</h3>
      <div className="muted small">Tick which screens each role can open. Drives the sidebar and route access live. Org Admin always has full access.</div>
      <div className="card">
        <div className="table-wrap">
          <table className="t" style={{ fontSize: 11.5 }}>
            <thead><tr>
              <th>Screen</th>
              {roles.map(r => <th key={r} className="num" title={r}>{r === 'Managing Director' ? 'MD' : r === 'Project Manager' ? 'PM' : r === 'Collections' ? 'Coll.' : r === 'Org Admin' ? 'Admin' : r}</th>)}
            </tr></thead>
            <tbody>
              {PERMISSION_SCREENS.map(([sid, label]) => (
                <tr key={sid}>
                  <td><strong>{label}</strong> <span className="tiny muted mono">{sid}</span></td>
                  {roles.map(r => (
                    <td key={r} className="num">
                      <input type="checkbox" checked={r === 'Org Admin' ? true : has(r, sid)}
                             disabled={r === 'Org Admin'} onChange={() => toggle(r, sid)}/>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save permissions'}</button></div>
    </div>
  );
}

function WorkflowPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [stages, setStages] = React.useState(() => {
    const s = state.config.workflow_stages;
    return (Array.isArray(s) && s.length) ? [...s] : [...SO_LIFECYCLE];
  });
  const [saving, setSaving] = React.useState(false);
  const rename = (i, v) => setStages(ss => ss.map((s, j) => j === i ? v : s));
  const remove = (i) => setStages(ss => ss.filter((_, j) => j !== i));
  const move = (i, dir) => setStages(ss => {
    const j = i + dir; if (j < 0 || j >= ss.length) return ss;
    const next = [...ss]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const add = () => setStages(ss => [...ss, 'New Stage']);
  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ workflow_stages: stages });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Workflow stages saved', res && res.ok === false ? '' : 'success');
  };
  return (
    <div className="stack">
      <h3 className="card-title">SO Workflow stages</h3>
      <div className="muted small">Rename, reorder, add or remove stages. The configured list is saved to the DB and shown across the app.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>#</th><th>Stage</th><th>Reorder</th><th></th></tr></thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={i}>
                  <td className="mono small muted">{i + 1}</td>
                  <td><input className="input" value={s} onChange={e => rename(i, e.target.value)} style={{ height: 26 }}/></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button className="btn btn-ghost btn-sm" disabled={i === stages.length - 1} onClick={() => move(i, 1)}>↓</button>
                    </div>
                  </td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => remove(i)}><Icon name="trash" size={11} color="var(--danger)"/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={add}><Icon name="plus" size={11}/>Add stage</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save stages'}</button>
      </div>
    </div>
  );
}

function ApprovalGatesPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [gates, setGates] = React.useState(() => (state.config.approval_gates || []).map(g => ({ ...g, approvers: [...(g.approvers || [])] })));
  const [mdThreshold, setMdThreshold] = React.useState(state.config.vendor_po_md_threshold ?? 500000);
  const [saving, setSaving] = React.useState(false);

  const update = (id, patch) => setGates(gs => gs.map(g => g.id === id ? { ...g, ...patch } : g));
  const remove = (id) => setGates(gs => gs.filter(g => g.id !== id));
  const add = () => setGates(gs => [...gs, { id: 'g' + Date.now().toString(36), entity: 'Vendor PO', tier: 'New threshold', approvers: ['Managing Director'] }]);

  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ approval_gates: gates, vendor_po_md_threshold: Math.max(0, Number(mdThreshold) || 0) });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Approval gates saved · applied live', res && res.ok === false ? '' : 'success');
  };

  return (
    <div className="stack">
      <h3 className="card-title">Approval gates</h3>
      <div className="muted small">Define which roles must approve, per entity & threshold. Approvers are comma-separated.</div>
      <div className="card">
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="grow">
            <strong className="small">Vendor PO → Managing Director approval</strong>
            <div className="tiny muted">Any Vendor PO above this amount is held at <span className="mono">Pending MD Approval</span> and receiving is blocked until the MD approves. Applies live across procurement.</div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Threshold (₹)</label>
            <input type="number" className="input mono" value={mdThreshold} min="0" step="50000" onChange={e => setMdThreshold(e.target.value)} style={{ width: 160 }}/>
            <div className="field-hint">{inr(Math.max(0, Number(mdThreshold) || 0))}</div>
          </div>
        </div>
      </div>
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

const DEFAULT_NOTIF_EVENTS = [
  ['SO created', 'Sales · PM'], ['SO approved', 'PM · Purchase'], ['Vendor PO sent', 'Vendor · Purchase'],
  ['Material received', 'PM · Billing'], ['3-Way match exception', 'Billing · PM'],
  ['Invoice sent', 'Customer · Sales'], ['Payment due 7d', 'Customer · Coll.'],
  ['Payment overdue', 'Customer · Coll · Sales'], ['Approval pending', 'Approver'],
  ['Cross-SO transfer', 'Source PM'],
].map(([event, recipients]) => ({
  event, recipients,
  email: true,
  sms: event.includes('Payment') || event.includes('Invoice'),
  whatsapp: event.includes('Payment'),
  inapp: true,
}));

function NotificationsPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [events, setEvents] = React.useState(() => {
    const e = state.config.notification_events;
    return (Array.isArray(e) && e.length) ? e.map(x => ({ ...x })) : DEFAULT_NOTIF_EVENTS.map(x => ({ ...x }));
  });
  const [saving, setSaving] = React.useState(false);
  const channels = [['email', 'Email'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['inapp', 'In-app']];
  const toggle = (i, ch) => setEvents(es => es.map((e, j) => j === i ? { ...e, [ch]: !e[ch] } : e));
  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ notification_events: events });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Notification settings saved', res && res.ok === false ? '' : 'success');
  };
  return (
    <div className="stack">
      <h3 className="card-title">Notification events</h3>
      <div className="muted small">Toggle channels per event. Saved to the DB.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t" style={{ fontSize: 12 }}>
            <thead><tr>
              <th>Event</th><th>Recipients</th>{channels.map(([k, l]) => <th key={k} className="num">{l}</th>)}
            </tr></thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td><strong>{e.event}</strong></td>
                  <td className="small muted">{e.recipients}</td>
                  {channels.map(([ch]) => (
                    <td key={ch} className="num"><div style={{ display: 'flex', justifyContent: 'flex-end' }}><Toggle value={!!e[ch]} onChange={() => toggle(i, ch)}/></div></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save notifications'}</button></div>
    </div>
  );
}

const DEFAULT_BILLING_PATTERNS = [
  { t: 'Lumpsum', d: 'Single invoice on full delivery', on: true },
  { t: 'Advance + Balance', d: 'Advance %, balance on delivery', on: true, hint: '30% advance default' },
  { t: 'Milestone', d: 'Define milestones with %', on: true },
  { t: 'Recurring (AMC)', d: 'Monthly/quarterly invoices', on: false },
  { t: 'Per-unit', d: 'Bill per dispatched unit', on: true },
];

function BillingPatternsPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [patterns, setPatterns] = React.useState(() => {
    const p = state.config.billing_patterns;
    return (Array.isArray(p) && p.length) ? p.map(x => ({ ...x })) : DEFAULT_BILLING_PATTERNS.map(x => ({ ...x }));
  });
  const [saving, setSaving] = React.useState(false);
  const toggle = (i) => setPatterns(ps => ps.map((p, j) => j === i ? { ...p, on: !p.on } : p));
  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ billing_patterns: patterns });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Billing patterns saved', res && res.ok === false ? '' : 'success');
  };
  return (
    <div className="stack">
      <h3 className="card-title">Billing patterns</h3>
      <div className="muted small">Enable the patterns available for new SOs. Saved to the DB.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {patterns.map((p, i) => (
          <div key={i} className="pool-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{p.t}</strong>
              <Toggle value={p.on} onChange={() => toggle(i)}/>
            </div>
            <div className="tiny muted">{p.d}</div>
            {p.hint && <div className="tiny mono" style={{ color: 'var(--accent)' }}>{p.hint}</div>}
          </div>
        ))}
      </div>
      <div><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save patterns'}</button></div>
    </div>
  );
}

const DEFAULT_DOC_TEMPLATES = ['Quotation','SO Acknowledgement','Vendor Purchase Order','GRN','Delivery Challan','Proforma Invoice','Tax Invoice','Partial Invoice','Final Settlement Invoice','Credit Note','Debit Note (vendor)','Payment Receipt','e-Way Bill','AMC Contract']
  .map(name => ({ name, body: '' }));

function DocsPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [docs, setDocs] = React.useState(() => {
    const d = state.config.document_templates;
    return (Array.isArray(d) && d.length) ? d.map(x => ({ ...x })) : DEFAULT_DOC_TEMPLATES.map(x => ({ ...x }));
  });
  const [sel, setSel] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const update = (i, patch) => setDocs(ds => ds.map((d, j) => j === i ? { ...d, ...patch } : d));
  const remove = (i) => { setDocs(ds => ds.filter((_, j) => j !== i)); setSel(0); };
  const add = () => { setDocs(ds => [...ds, { name: 'New Template', body: '' }]); };
  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ document_templates: docs });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Document templates saved', res && res.ok === false ? '' : 'success');
  };
  const cur = docs[sel];
  return (
    <div className="stack">
      <h3 className="card-title">Document templates</h3>
      <div className="muted small">Edit template bodies. Use placeholders like <span className="mono">{`{{customer_name}}`}</span>. Saved to the DB.</div>
      <div className="split-2to1">
        <div className="card">
          <div className="card-header"><h3 className="card-title">{cur ? cur.name : 'No template'}</h3></div>
          <div className="card-body">
            {cur ? (
              <>
                <div className="field"><label className="field-label">Name</label><input className="input" value={cur.name} onChange={e => update(sel, { name: e.target.value })}/></div>
                <div className="field mt-2"><label className="field-label">Body</label>
                  <textarea className="textarea" rows="10" value={cur.body || ''} onChange={e => update(sel, { body: e.target.value })} placeholder="Template content with {{placeholders}}…"/>
                </div>
              </>
            ) : <div className="empty">No template selected</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="card-title">Templates · {docs.length}</h3></div>
          <div className="card-body flush">
            {docs.map((d, i) => (
              <div key={i} className="queue-item" style={{ background: i === sel ? 'var(--accent-bg)' : 'transparent', cursor: 'pointer' }} onClick={() => setSel(i)}>
                <div className="grow"><div className="small">{d.name}</div><div className="tiny muted">{d.body ? 'Customised' : 'Default'}</div></div>
                <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); remove(i); }}><Icon name="trash" size={11} color="var(--danger)"/></button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={add}><Icon name="plus" size={11}/>Add template</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save templates'}</button>
      </div>
    </div>
  );
}

const DEFAULT_CUSTOM_FIELDS = [
  { master: 'Customer', field: 'Region', type: 'Dropdown', required: false },
  { master: 'Customer', field: 'Sales channel', type: 'Dropdown', required: true },
  { master: 'Vendor', field: 'Empanelment date', type: 'Date', required: false },
  { master: 'Product', field: 'Warranty months', type: 'Number', required: true },
];

function CustomFieldsPane() {
  const { state, saveConfig } = useStore();
  const toast = useToast();
  const [fields, setFields] = React.useState(() => {
    const f = state.config.custom_fields;
    return (Array.isArray(f) && f.length) ? f.map(x => ({ ...x })) : DEFAULT_CUSTOM_FIELDS.map(x => ({ ...x }));
  });
  const [saving, setSaving] = React.useState(false);
  const update = (i, patch) => setFields(fs => fs.map((f, j) => j === i ? { ...f, ...patch } : f));
  const remove = (i) => setFields(fs => fs.filter((_, j) => j !== i));
  const add = () => setFields(fs => [...fs, { master: 'Customer', field: 'New field', type: 'Text', required: false }]);
  const save = async () => {
    setSaving(true);
    const res = await saveConfig({ custom_fields: fields });
    setSaving(false);
    toast(res && res.ok === false ? 'Save failed — kept locally' : 'Custom fields saved', res && res.ok === false ? '' : 'success');
  };
  return (
    <div className="stack">
      <h3 className="card-title">Custom fields</h3>
      <div className="muted small">Define custom fields per master. Saved to the DB.</div>
      <div className="card">
        <div className="card-body flush">
          <table className="t">
            <thead><tr><th>Master</th><th>Field</th><th>Type</th><th>Required</th><th></th></tr></thead>
            <tbody>
              {fields.map((f, i) => (
                <tr key={i}>
                  <td>
                    <select className="select" value={f.master} onChange={e => update(i, { master: e.target.value })} style={{ height: 26 }}>
                      <option>Customer</option><option>Vendor</option><option>Product</option><option>Sales Order</option>
                    </select>
                  </td>
                  <td><input className="input" value={f.field} onChange={e => update(i, { field: e.target.value })} style={{ height: 26 }}/></td>
                  <td>
                    <select className="select" value={f.type} onChange={e => update(i, { type: e.target.value })} style={{ height: 26 }}>
                      <option>Text</option><option>Number</option><option>Date</option><option>Dropdown</option>
                    </select>
                  </td>
                  <td><Toggle value={!!f.required} onChange={() => update(i, { required: !f.required })}/></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => remove(i)}><Icon name="trash" size={11} color="var(--danger)"/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={add}><Icon name="plus" size={11}/>Add custom field</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save fields'}</button>
      </div>
    </div>
  );
}

function ReportsPane() {
  const { state, getCustomer, getVendor, getProduct } = useStore();
  const toast = useToast();
  const cust = id => (getCustomer(id) || {}).name || id;
  const vend = id => (getVendor(id) || {}).name || id;
  const prod = id => (getProduct(id) || {}).name || id;
  const taxable = a => Math.round((a || 0) / 1.18);

  const builders = {
    'Sales register (GSTR-1 ready)': () => state.sales_orders.filter(s => s.invoice_no).map(s => ({ invoice_no: s.invoice_no, date: s.invoice_date, customer: cust(s.customer_id), taxable: taxable(s.invoice_amount), gst: (s.invoice_amount || 0) - taxable(s.invoice_amount), total: s.invoice_amount })),
    'Purchase register (GSTR-2B reco)': () => state.vendor_pos.map(p => ({ po_no: p.po_no, vendor: vend(p.vendor_id), date: p.date, amount: p.amount, status: p.status })),
    'Stock ageing (Master Pool)': () => state.pool.map(p => ({ product: prod(p.product_id), qty: p.qty, source_so: p.source_so, received: p.received_date })),
    'Vendor performance': () => state.vendors.map(v => ({ code: v.code, name: v.name, city: v.city, rating: v.rating, terms: v.terms })),
    'Customer outstanding': () => state.sales_orders.filter(s => s.status === 'Payment Pending').map(s => ({ invoice_no: s.invoice_no, customer: cust(s.customer_id), amount: s.invoice_amount, days_overdue: s.days_overdue || 0 })),
    'SO P&L per order': () => state.sales_orders.map(s => ({ so_no: s.so_no, customer: cust(s.customer_id), value: (s.lines || []).reduce((a, l) => a + l.bundle_qty * l.unit_price, 0), status: s.status })),
    'LPP variance log': () => state.rfqs.flatMap(r => (r.quotes || []).map(q => ({ rfq: r.rfq_no, vendor: vend(q.vendor_id), total: q.total, lpp_variance: q.lpp_variance, responded: q.responded }))),
    'Approval log': () => state.audit.filter(a => /approv/i.test(a.action || '')).map(a => ({ ts: a.ts, action: a.action, entity: a.entity, ref: a.entity_id })),
    'Cross-SO transfer log': () => state.transfer_requests.map(t => ({ id: t.id, from_so: t.from_so, to_so: t.to_so, status: t.status, reason: t.reason })),
    'Audit log': () => state.audit.map(a => ({ ts: a.ts, action: a.action, entity: a.entity, entity_id: a.entity_id, user: a.user_id })),
    'GSTR-3B summary': () => state.sales_orders.filter(s => s.invoice_no).map(s => ({ invoice: s.invoice_no, taxable: taxable(s.invoice_amount), output_gst: (s.invoice_amount || 0) - taxable(s.invoice_amount) })),
    'TDS register': () => state.vendor_invoices.map(vi => ({ invoice: vi.vendor_invoice_no, vendor: vend(vi.vendor_id), amount: vi.amount, tds: Math.round((vi.amount || 0) * 0.02) })),
  };

  const download = (name) => {
    let rows = [];
    try { rows = (builders[name] ? builders[name]() : []) || []; } catch (e) { rows = []; }
    if (!rows.length) { toast('No data yet for "' + name + '"'); return; }
    opcDownload(name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.csv', opcToCSV(rows), 'text/csv');
    toast(name + ' exported (' + rows.length + ' rows)', 'success');
  };

  return (
    <div className="stack">
      <h3 className="card-title">Reports & dashboards</h3>
      <div className="muted small">Export live data from the database as CSV.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {Object.keys(builders).map(r => (
          <div key={r} className="pool-item">
            <div>
              <div className="small"><strong>{r}</strong></div>
              <div className="tiny muted">CSV · live data</div>
            </div>
            <button className="btn btn-sm" onClick={() => download(r)}><Icon name="download" size={11}/></button>
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
