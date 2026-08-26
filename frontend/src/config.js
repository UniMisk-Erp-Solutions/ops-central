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
// Public Supabase URL via the Cloudflare tunnel (so-po.unimisk.com → SO-PO Kong
// on the Coolify host at 192.168.0.18, internal :8000). Works from anywhere
// (Vercel frontend at ops-central.unimisk.com + LAN). Override via window.OPC_ENV.
window.OPC_ENV = window.OPC_ENV || {
  SUPABASE_URL: 'https://so-po.unimisk.com',
  SUPABASE_ANON_KEY: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4MDM4NDg2MCwiZXhwIjo0OTM2MDU4NDYwLCJyb2xlIjoiYW5vbiJ9.0AhbGOMbIybN0azUCAuoriNKGtSwdpznBqCQbZDpxZM',

  // --- Multi-tenancy -------------------------------------------------------
  // THE single source of truth for "the apex". Tenants live one label below it:
  // acme.ops-central.unimisk.com. Change this ONE value (here, or via an env.js
  // override) to move the platform to another base domain.
  //
  // TLS note: this host is DNS-only in Cloudflare (grey cloud) and goes straight
  // to Vercel, so VERCEL issues the certificate (Let's Encrypt), not Cloudflare.
  // Cloudflare's 1-level Universal SSL limit therefore does NOT apply — a Vercel
  // wildcard domain *.ops-central.unimisk.com covers every tenant host.
  APP_BASE_DOMAIN: 'ops-central.unimisk.com',
  // Simulate a tenant host on localhost (no DNS needed): set to e.g. 'acme'.
  DEV_TENANT_SUBDOMAIN: '',
};

(function initSupabase() {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      window.OPC_SB = window.supabase.createClient(
        window.OPC_ENV.SUPABASE_URL,
        window.OPC_ENV.SUPABASE_ANON_KEY,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
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
