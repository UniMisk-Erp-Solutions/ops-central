// OP Central — runtime config + Supabase client.
//
// This app is served as static files (in-browser Babel, no bundler), so VITE_
// env vars can't be injected. The values below mirror frontend/.env and point
// at the OP Central Supabase instance on Coolify (API :54331). The anon key is
// a public client key (RLS governs access).
//
// Loads AFTER the supabase-js UMD bundle (which sets window.supabase). If that
// failed to load, OPC_SB is null and the app falls back to localStorage/seed.

// Config precedence: a pre-set window.OPC_ENV (e.g. from env.js or an inline
// snippet injected at deploy) wins; otherwise these dev defaults apply. The
// anon key is a PUBLIC client key (RLS governs access) — safe to ship. The
// service-role key must NEVER appear here; it lives only server-side.
window.OPC_ENV = window.OPC_ENV || {
  SUPABASE_URL: 'http://192.168.16.112:54331',
  SUPABASE_ANON_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3OTQ0ODA4MCwiZXhwIjo0OTM1MTIxNjgwLCJyb2xlIjoiYW5vbiJ9.VrYk5aEwhCXAyXuAtjqk0dfUVw5iOJMKSajL1DwM5xw',
};

(function initSupabase() {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      window.OPC_SB = window.supabase.createClient(
        window.OPC_ENV.SUPABASE_URL,
        window.OPC_ENV.SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      console.info('[OPC] Supabase client ready →', window.OPC_ENV.SUPABASE_URL);
    } else {
      window.OPC_SB = null;
      console.warn('[OPC] supabase-js not loaded — running offline (localStorage/seed).');
    }
  } catch (e) {
    window.OPC_SB = null;
    console.error('[OPC] Supabase init failed — running offline.', e);
  }
})();
