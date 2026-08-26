// ============================================================================
// Shared CORS helper for every OP Central edge function.
// ============================================================================
// Import this — do NOT copy-paste the logic per function. One module means one
// place to change when the platform's base domain moves.
//
//   import { corsHeaders, isAllowedOrigin } from "../_shared/cors.ts";
//
// Tenant origins are matched by a REGEX anchored on the fixed apex, so onboarding
// a new organization never requires touching a hardcoded allowlist.
//
// `Vary: Origin` is REQUIRED: without it a CDN can cache one tenant's CORS
// response and hand it to a different tenant's browser.
// ============================================================================

// Single source of truth for the apex (override with APP_BASE_DOMAIN in the
// function's env to move the platform without editing code).
const BASE_DOMAIN = (Deno.env.get("APP_BASE_DOMAIN") || "ops-central.unimisk.com")
  .trim().toLowerCase().replace(/^www\./, "");

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// https only, single label, anchored both ends: https://<tenant>.<apex>
const TENANT_SUBDOMAIN_RE = new RegExp(
  "^https://[a-z0-9-]+\\." + escapeForRegex(BASE_DOMAIN) + "$",
);

export const ALLOWED_EXACT_ORIGINS: string[] = [
  `https://${BASE_DOMAIN}`,          // the shared/generic host
  "https://ops-central.vercel.app",  // Vercel default domain for this project
  "http://localhost:5173",
  "http://localhost:3000",
];

export function isAllowedOrigin(origin: string | null): boolean {
  if (origin == null) return false;
  const o = origin.trim().toLowerCase();
  return ALLOWED_EXACT_ORIGINS.includes(o) || TENANT_SUBDOMAIN_RE.test(o);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  // Browsers always send Origin on cross-origin calls. Non-browser callers
  // (curl, server-to-server) send none and ignore CORS entirely, so falling back
  // to the apex is safe and never widens access for a real browser.
  const allowed = isAllowedOrigin(origin) ? (origin as string) : ALLOWED_EXACT_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}
