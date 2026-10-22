// OP Central — Auth screen: admin self-signup (first run) + login (simple DB password, demo)

function LoginScreen() {
  const { login, signupAdmin, navigate } = useStore();
  const [mode, setMode] = React.useState('login');   // 'login' | 'signup'
  const [checking, setChecking] = React.useState(true);
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // First run: if no active admin exists, open signup. Otherwise login only.
  // Uses an RPC (anon cannot read the users table under the locked-down RLS).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.OPC_SB) { setChecking(false); return; }
      try {
        const { data, error } = await window.OPC_SB.rpc('opc_admin_exists');
        if (cancelled) return;
        if (!error) setMode(data ? 'login' : 'signup');
      } catch (e) { /* default to login */ }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setBusy(true);
    const res = mode === 'signup'
      ? await signupAdmin({ name: name.trim(), email: email.trim(), password })
      : await login(email.trim(), password);
    setBusy(false);
    if (!res.ok) { setError(res.error || 'Failed.'); return; }
    // Every role lands on the flow hub first now, not role-specific `primary`
    // — primary is still what a denied mid-session route falls back to (see
    // the App-level route guard in app.jsx), unchanged.
    navigate('flow');
  };

  const isSignup = mode === 'signup';

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #f6f7f9)', padding: 20 }}>
      <form onSubmit={submit} className="card" style={{ width: 360, maxWidth: '92vw' }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div className="brand-mark" style={{ width: 34, height: 34, fontSize: 17 }}>B</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>OP Central</div>
              <div className="tiny muted">{isSignup ? 'Create your admin account' : 'Sign in to your workspace'}</div>
            </div>
          </div>

          {checking ? (
            <div className="muted small" style={{ padding: '12px 0' }}>Loading…</div>
          ) : (
            <>
              {isSignup && (
                <div className="field">
                  <label className="field-label">Full name</label>
                  <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Your name"/>
                </div>
              )}
              <div className={isSignup ? 'field mt-2' : 'field'}>
                <label className="field-label">Email</label>
                <input className="input" type="email" autoFocus={!isSignup} value={email}
                       onChange={e => setEmail(e.target.value)} placeholder="you@company.com"/>
              </div>
              <div className="field mt-2">
                <label className="field-label">Password</label>
                <input className="input" type="password" value={password}
                       onChange={e => setPassword(e.target.value)} placeholder="••••••••"/>
              </div>

              {error && (
                <div className="mt-2" style={{ padding: '8px 10px', background: 'var(--danger-bg)', border: '1px solid oklch(0.86 0.08 25)', borderRadius: 'var(--radius)', fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Icon name="alert" size={13} color="var(--danger)"/>{error}
                </div>
              )}

              <button className="btn btn-primary mt-3" type="submit"
                      disabled={busy || !email || !password || (isSignup && !name)}
                      style={{ width: '100%', justifyContent: 'center' }}>
                {busy ? (isSignup ? 'Creating…' : 'Signing in…') : (isSignup ? 'Create admin & continue' : 'Sign in')}
                {!busy && <Icon name="arrowRight" size={13}/>}
              </button>

              <div className="tiny muted mt-2" style={{ textAlign: 'center' }}>
                {isSignup
                  ? 'Creates your organisation’s first admin. Other users are added later from Customisation → Users.'
                  : 'New users are created by your Org Admin.'}
              </div>
              <div className="tiny mt-2" style={{ textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {isSignup ? (
                  <>Already have an organisation?{' '}
                    <a style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}
                       onClick={() => { setMode('login'); setError(''); }}>Sign in</a></>
                ) : (
                  <>New organisation?{' '}
                    <a style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}
                       onClick={() => { setMode('signup'); setError(''); }}>Create admin account</a></>
                )}
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

window.LoginScreen = LoginScreen;


// Where a password-reset e-mail lands: sign in with the link's one-time tokens, ask for a new
// password, save it, then reload into the normal app. Shown by App() while window.__opcRecovery is set.
function RecoveryScreen() {
  const [state, setState] = React.useState('checking');   // checking | form | done | bad
  const [msg, setMsg] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      const t = window.__opcRecovery;
      if (!window.OPC_SB || !t || !t.access_token) { setMsg('This reset link is not valid here.'); setState('bad'); return; }
      const { error } = await window.OPC_SB.auth.setSession({ access_token: t.access_token, refresh_token: t.refresh_token || '' });
      if (error) { setMsg('This reset link has expired or was already used. Request a new one from your profile or ask your Org Admin.'); setState('bad'); return; }
      setState('form');
    })();
  }, []);
  const save = async (e) => {
    if (e) e.preventDefault();
    if (pw.length < 8) { setMsg('Use at least 8 characters.'); return; }
    if (pw !== pw2) { setMsg('The two passwords do not match.'); return; }
    setBusy(true); setMsg('');
    const { error } = await window.OPC_SB.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setState('done');
  };
  const finish = () => { window.__opcRecovery = null; window.location.replace(window.location.pathname); };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #f6f7f9)', padding: 20 }}>
      <form onSubmit={save} className="card" style={{ width: 360, maxWidth: '92vw' }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div className="brand-mark" style={{ width: 34, height: 34, fontSize: 17 }}>B</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>OP Central</div>
              <div className="tiny muted">Set a new password</div>
            </div>
          </div>
          {state === 'checking' && <div className="muted small" style={{ padding: '12px 0' }}>Checking your link…</div>}
          {state === 'bad' && (<>
            <div className="small" style={{ color: 'var(--danger)', marginBottom: 12 }}>{msg}</div>
            <button type="button" className="btn btn-primary" onClick={finish}>Back to sign in</button>
          </>)}
          {state === 'form' && (<div className="stack" style={{ gap: 10 }}>
            <label className="field"><span className="field-label">New password</span>
              <span className="pw-field">
                <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus value={pw} onChange={e => setPw(e.target.value)}/>
                <button type="button" className="pw-eye" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(v => !v)}><Icon name={show ? 'eyeOff' : 'eye'} size={16}/></button>
              </span>
            </label>
            <label className="field"><span className="field-label">Confirm new password</span>
              <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)}/>
            </label>
            <div className={`pw-hint${pw.length >= 8 ? ' ok' : ''}`}>{pw.length >= 8 ? '✓ ' : ''}At least 8 characters</div>
            {msg && <div className="small" style={{ color: 'var(--danger)' }}>{msg}</div>}
            <button type="submit" className="btn btn-primary" disabled={busy || pw.length < 8 || pw !== pw2}>{busy ? 'Saving…' : 'Save new password'}</button>
          </div>)}
          {state === 'done' && (<>
            <div className="small" style={{ marginBottom: 12 }}>Your password has been changed.</div>
            <button type="button" className="btn btn-primary" onClick={finish}>Continue</button>
          </>)}
        </div>
      </form>
    </div>
  );
}
window.RecoveryScreen = RecoveryScreen;
