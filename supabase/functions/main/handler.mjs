/**
 * Shared API handler — runs on Node (local) and Supabase Edge (Deno).
 * Uses Web Fetch API only (no Express in this file).
 */

import { getSupabase } from './lib/supabase.mjs';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Strip /functions/v1/main prefix when deployed as edge function "main". */
export function normalizePath(pathname) {
  const prefixes = ['/functions/v1/main', '/main'];
  for (const p of prefixes) {
    if (pathname === p) return '/';
    if (pathname.startsWith(p + '/')) return pathname.slice(p.length) || '/';
  }
  return pathname;
}

export async function handleRequest(req, env = process.env) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  const url = new URL(req.url);
  const path = normalizePath(url.pathname);
  const supabase = getSupabase(env);

  if (path === '/' || path === '/health') {
    return json({
      ok: true,
      service: 'op-central-api',
      runtime: typeof Deno !== 'undefined' ? 'supabase-edge' : 'node',
      supabaseConfigured: !!supabase,
      timestamp: new Date().toISOString(),
    });
  }

  if (path === '/api/status') {
    if (!supabase) {
      return json({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY in env' }, 503);
    }
    const { count, error } = await supabase
      .from('org_settings')
      .select('*', { count: 'exact', head: true });
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
      return json({ ok: false, error: error.message, hint: 'Run supabase/migrations/001_op_central.sql in Studio' }, 502);
    }
    return json({
      ok: true,
      message: error?.code === '42P01' ? 'DB connected; run migration 001_op_central.sql' : 'DB connected',
      org_settings_rows: count ?? 0,
    });
  }

  return json({ ok: false, error: 'Not found', path }, 404);
}
