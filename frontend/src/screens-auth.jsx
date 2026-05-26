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
    const dest = (perm(res.user.role).primary || { route: 'dashboard' }).route;
    navigate(dest);
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
