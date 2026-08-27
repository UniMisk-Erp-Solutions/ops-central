// Supabase Edge (Deno) — OP Central API.
// Adds the RFQ mailer + vendor-quote intake. All secrets stay on the server:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — injected by the stack
//   BREVO_API_KEY / SENDER_EMAIL / SENDER_NAME / QUOTE_BASE_URL — from env OR
//   the server-side file /home/deno/functions/main/_secrets.json (never served).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// CORS comes from ONE shared module (../_shared/cors.ts) so the tenant-origin
// rule lives in a single place. Headers are per-request because the allowed
// origin depends on the caller's Origin (and must carry Vary: Origin).
import { corsHeaders } from "../_shared/cors.ts";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as Record<string, string>)[c]);

const SB_URL = Deno.env.get("SUPABASE_URL") || "http://supabase-kong:8000";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY") || Deno.env.get("SERVICE_KEY") || "";
const sbHeaders = () => ({ apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" });

// Platform secrets (Vercel + Cloudflare) for tenant-subdomain provisioning.
// Read from env or the server-side _secrets.json — never from the request.
async function platformConfig() {
  const fromEnv = {
    VERCEL_TOKEN: Deno.env.get("VERCEL_TOKEN") || "",
    VERCEL_PROJECT_ID: Deno.env.get("VERCEL_PROJECT_ID") || "",
    CF_API_TOKEN: Deno.env.get("CF_API_TOKEN") || "",
    CF_ZONE_ID: Deno.env.get("CF_ZONE_ID") || "",
  };
  if (fromEnv.VERCEL_TOKEN && fromEnv.CF_API_TOKEN) return fromEnv;
  try {
    const f = JSON.parse(await Deno.readTextFile("/home/deno/functions/main/_secrets.json"));
    return {
      VERCEL_TOKEN: fromEnv.VERCEL_TOKEN || f.VERCEL_TOKEN || "",
      VERCEL_PROJECT_ID: fromEnv.VERCEL_PROJECT_ID || f.VERCEL_PROJECT_ID || "",
      CF_API_TOKEN: fromEnv.CF_API_TOKEN || f.CF_API_TOKEN || "",
      CF_ZONE_ID: fromEnv.CF_ZONE_ID || f.CF_ZONE_ID || "",
    };
  } catch (_) { return fromEnv; }
}

// Is the CALLER a platform admin? Verified by replaying their own JWT against
// the database — never trusted from the request body.
async function callerIsMasterAdmin(req: Request): Promise<boolean> {
  const jwt = req.headers.get("x-caller-jwt") || "";
  if (!jwt) return false;
  try {
    const r = await fetch(SB_URL + "/rest/v1/rpc/is_master_admin", {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch (_) { return false; }
}

async function brevoConfig() {
  let key = Deno.env.get("BREVO_API_KEY") || "";
  let email = Deno.env.get("SENDER_EMAIL") || "info@unimisk.com";
  let name = Deno.env.get("SENDER_NAME") || "Unimisk";
  let base = Deno.env.get("QUOTE_BASE_URL") || "https://ops-central.unimisk.com";
  if (!key) {
    try {
      const s = JSON.parse(await Deno.readTextFile("/home/deno/functions/main/_secrets.json"));
      key = s.BREVO_API_KEY || key; email = s.SENDER_EMAIL || email; name = s.SENDER_NAME || name; base = s.QUOTE_BASE_URL || base;
    } catch (_) { /* no secrets file */ }
  }
  return { key, email, name, base };
}

function normalize(path: string) {
  for (const p of ["/functions/v1/main", "/main"]) {
    if (path === p) return "/";
    if (path.startsWith(p + "/")) return path.slice(p.length) || "/";
  }
  return path;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("origin"));
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: cors });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = normalize(url.pathname);

  if (path === "/" || path === "/health") return json({ ok: true, service: "op-central-api", runtime: "supabase-edge" });

  // ---------- Float RFQ: store per-vendor tokens + email each vendor ----------
  if (path === "/float-rfq" && req.method === "POST") {
    if (!SB_KEY) return json({ error: "Server missing service key" }, 500);
    const body = await req.json().catch(() => ({}));
    const { src_id, src_no, customer_name, org_name, vendors, items, reason } = body || {};
    if (!src_id || !Array.isArray(vendors) || !Array.isArray(items) || !items.length) return json({ error: "src_id, vendors and items are required" }, 400);
    const cfg = await brevoConfig();
    if (!cfg.key) return json({ error: "Email is not configured yet (BREVO_API_KEY missing on the server)" }, 500);
    const rfqId = "rfq-" + src_id;
    const rand = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    // Buyer-locked fields per item (price / delivery_days / payment_terms / notes):
    // the vendor sees these as a fixed requirement and cannot change them.
    const locks = (body.locks && typeof body.locks === "object") ? body.locks : {};
    const withLock = (arr: any[]) => arr.map((i: any) => {
      const it: any = { product_id: i.product_id, name: i.name || i.product_id, code: i.code || "", qty: Number(i.qty) || 0 };
      const lk = locks[i.product_id];
      if (lk && typeof lk === "object") {
        const L: any = {};
        if (lk.price !== undefined && lk.price !== null && lk.price !== "") L.price = Number(lk.price) || 0;
        if (lk.delivery_days !== undefined && lk.delivery_days !== null && lk.delivery_days !== "") L.delivery_days = Number(lk.delivery_days) || 0;
        if (lk.payment_terms) L.payment_terms = String(lk.payment_terms);
        if (lk.notes) L.notes = String(lk.notes);
        if (Object.keys(L).length) it.lock = L;
      }
      return it;
    });
    const cleanItems = withLock(items);
    const cleanOf = withLock;
    const withEmail = vendors.filter((v: any) => v && v.vendor_id && v.email);
    if (!withEmail.length) return json({ error: "No selected vendor has an email set" }, 400);

    // Merge into any existing RFQ row so re-floating ONE vendor never wipes another's
    // submitted quote. A re-floated vendor keeps its link + prior prices/terms and is
    // re-opened for editing, with the reason logged.
    const exRes = await fetch(SB_URL + "/rest/v1/rfqs?id=eq." + encodeURIComponent(rfqId) + "&select=*", { headers: sbHeaders() });
    const exRow = (await exRes.json().catch(() => []))[0];
    const existingVendors: any[] = (exRow && Array.isArray(exRow.vendors)) ? exRow.vendors : [];
    const now = new Date().toISOString();
    const reasonStr = (typeof reason === "string" ? reason : "").trim();
    const floatedVendors = withEmail.map((v: any) => {
      const its = (Array.isArray(v.items) && v.items.length) ? cleanOf(v.items) : cleanItems;
      const prev = existingVendors.find((x: any) => x.vendor_id === v.vendor_id);
      if (prev) {
        return { ...prev, name: v.name || prev.name, email: v.email, items: its, status: "sent", sent_at: now,
          refloat_count: (Number(prev.refloat_count) || 0) + 1,
          refloat_reason: reasonStr || prev.refloat_reason || "",
          refloats: [ ...(Array.isArray(prev.refloats) ? prev.refloats : []), { reason: reasonStr, at: now } ] };
      }
      return { vendor_id: v.vendor_id, name: v.name || "Vendor", email: v.email, token: rfqId + "~" + rand(), items: its, prices: {}, terms: {}, status: "sent", sent_at: now, refloat_count: 0 };
    });
    const floatedIds = new Set(withEmail.map((v: any) => v.vendor_id));
    const mergedVendors = [ ...existingVendors.filter((x: any) => !floatedIds.has(x.vendor_id)), ...floatedVendors ];

    // Tenant stamp: this function runs with the SERVICE key, so auth.uid() is
    // NULL and the organization_id column DEFAULT cannot apply. Derive the org
    // from the parent sourcing — never from the request body (client input is
    // never trusted for tenancy).
    let orgId: string | null = (exRow && exRow.organization_id) || null;
    if (!orgId) {
      const sres = await fetch(SB_URL + "/rest/v1/sourcings?id=eq." + encodeURIComponent(src_id) + "&select=organization_id", { headers: sbHeaders() });
      const srow = (await sres.json().catch(() => []))[0];
      orgId = (srow && srow.organization_id) || null;
    }
    if (!orgId) return json({ error: "Could not determine the organization for this inquiry — open and save the inquiry once, then retry" }, 409);

    const up = await fetch(SB_URL + "/rest/v1/rfqs?on_conflict=id", { method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: rfqId, organization_id: orgId, rfq_no: (exRow && exRow.rfq_no) || ("RFQ/" + (src_no || src_id)), so_id: src_id, items_label: cleanItems.map((i: any) => i.qty + "× " + i.name).join(", ").slice(0, 240), floated_date: now.slice(0, 10), status: "Floated", vendors: mergedVendors, quotes: (exRow && exRow.quotes) || [], selected_vendor: (exRow && exRow.selected_vendor) || null }) });
    if (!up.ok) return json({ error: "Could not save RFQ: " + (await up.text().catch(() => "")).slice(0, 200) }, 502);
    const mkRows = (its: any[]) => its.map((i: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.name)}${i.code ? ` <span style="color:#999">(${esc(i.code)})</span>` : ""}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${i.qty}</td></tr>`).join("");
    const sent: any[] = [];
    for (const v of floatedVendors) {
      const link = cfg.base + "/quote?t=" + encodeURIComponent(v.token);
      const reFloat = (Number(v.refloat_count) || 0) > 0;
      const banner = reFloat && v.refloat_reason ? `<div style="background:#fff6e5;border:1px solid #ffe0a3;border-radius:6px;padding:10px 12px;margin:0 0 12px;color:#8a5a00;font-size:13px"><strong>We’ve re-sent this request.</strong><br>Reason: ${esc(v.refloat_reason)}</div>` : "";
      const intro = reFloat ? "We need you to review and re-submit your quote for the items below." : "Please quote your best price for the items below. Click the button to enter prices on a secure page — no login needed.";
      const subject = (reFloat ? "Please revise your quotation" : "Request for Quotation") + (src_no ? " — " + src_no : "");
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#222"><h2 style="margin:0 0 4px">${esc(org_name || cfg.name)}</h2><p style="color:#666;margin:0 0 14px">${reFloat ? "Revised " : ""}Request for Quotation${src_no ? " — " + esc(src_no) : ""}${customer_name ? " · for " + esc(customer_name) : ""}</p>${banner}<p>Dear ${esc(v.name)},</p><p>${intro}</p><table style="border-collapse:collapse;width:100%;margin:10px 0"><thead><tr><th style="text-align:left;padding:6px 10px;background:#f5f5f5">Item</th><th style="text-align:right;padding:6px 10px;background:#f5f5f5">Qty</th></tr></thead><tbody>${mkRows(v.items)}</tbody></table><p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#2b3a67;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">${reFloat ? "Update your quote →" : "Enter your quote →"}</a></p><p style="color:#999;font-size:12px;word-break:break-all">Or paste this link: ${link}</p><p style="color:#999;font-size:12px">This link is unique to you — please don’t forward it.</p></div>`;
      try {
        const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": cfg.key, "Content-Type": "application/json", accept: "application/json" }, body: JSON.stringify({ sender: { email: cfg.email, name: cfg.name }, to: [{ email: v.email, name: v.name }], subject, htmlContent: html }) });
        sent.push({ vendor: v.name, ok: r.ok, status: r.status, refloat: reFloat });
      } catch (e) { sent.push({ vendor: v.name, ok: false, error: String(e) }); }
    }
    return json({ ok: true, rfq_id: rfqId, refloat: floatedVendors.some((v: any) => (Number(v.refloat_count) || 0) > 0), sent });
  }

  // ---------- Quote load (vendor page) ----------
  if (path === "/quote-load" && req.method === "GET") {
    if (!SB_KEY) return json({ error: "Server missing service key" }, 500);
    const t = url.searchParams.get("t") || "";
    if (!t) return json({ error: "Missing token" }, 400);
    const rfqId = t.split("~")[0];
    const r = await fetch(SB_URL + "/rest/v1/rfqs?id=eq." + encodeURIComponent(rfqId) + "&select=*", { headers: sbHeaders() });
    const arr = await r.json().catch(() => []);
    const row = Array.isArray(arr) ? arr[0] : null;
    const v = row && (row.vendors || []).find((x: any) => x.token === t);
    if (!row || !v) return json({ error: "This quote link is not valid or has expired." }, 404);
    return json({ vendor: v.name, rfq_no: row.rfq_no, items: v.items || [], prices: v.prices || {}, terms: v.terms || {}, submitted: v.status === "submitted", refloat_reason: (Number(v.refloat_count) || 0) > 0 ? (v.refloat_reason || "") : "" });
  }

  // ---------- Quote submit (vendor page) ----------
  if (path === "/quote-submit" && req.method === "POST") {
    if (!SB_KEY) return json({ error: "Server missing service key" }, 500);
    const body = await req.json().catch(() => ({}));
    const { t, prices, terms } = body || {};
    if (!t || !prices || typeof prices !== "object") return json({ error: "token and prices required" }, 400);
    const rfqId = String(t).split("~")[0];
    const rr = await fetch(SB_URL + "/rest/v1/rfqs?id=eq." + encodeURIComponent(rfqId) + "&select=*", { headers: sbHeaders() });
    const row = (await rr.json().catch(() => []))[0];
    if (!row) return json({ error: "Invalid link" }, 404);
    const target = (row.vendors || []).find((x: any) => x.token === t);
    if (!target) return json({ error: "Invalid link" }, 404);
    // Enforce buyer-locked fields — a locked value always wins over whatever is sent.
    const finalPrices: any = { ...(prices || {}) };
    const finalTerms: any = (terms && typeof terms === "object") ? { ...terms } : {};
    (target.items || []).forEach((it: any) => {
      const lk = it.lock; if (!lk) return;
      if (lk.price !== undefined) finalPrices[it.product_id] = Number(lk.price) || 0;
      if (lk.delivery_days !== undefined || lk.payment_terms || lk.notes) {
        finalTerms[it.product_id] = finalTerms[it.product_id] || {};
        if (lk.delivery_days !== undefined) finalTerms[it.product_id].delivery_days = Number(lk.delivery_days) || 0;
        if (lk.payment_terms) finalTerms[it.product_id].payment_terms = lk.payment_terms;
        if (lk.notes) finalTerms[it.product_id].notes = lk.notes;
      }
    });
    const vendors = (row.vendors || []).map((x: any) => x.token === t ? { ...x, prices: finalPrices, terms: finalTerms, status: "submitted", submitted_at: new Date().toISOString() } : x);
    const v = vendors.find((x: any) => x.token === t);
    if (!v) return json({ error: "Invalid link" }, 404);
    await fetch(SB_URL + "/rest/v1/rfqs?id=eq." + encodeURIComponent(rfqId), { method: "PATCH", headers: { ...sbHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ vendors }) });
    const sr = await fetch(SB_URL + "/rest/v1/sourcings?id=eq." + encodeURIComponent(row.so_id) + "&select=prices,quote_vendors", { headers: sbHeaders() });
    const srow = (await sr.json().catch(() => []))[0];
    if (srow) {
      const np = srow.prices || {};
      for (const pid of Object.keys(finalPrices)) { np[pid] = np[pid] || {}; np[pid][v.vendor_id] = Number((finalPrices as any)[pid]) || 0; }
      const qv = Array.from(new Set([...(srow.quote_vendors || []), v.vendor_id]));
      await fetch(SB_URL + "/rest/v1/sourcings?id=eq." + encodeURIComponent(row.so_id), { method: "PATCH", headers: { ...sbHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ prices: np, quote_vendors: qv }) });
    }
    return json({ ok: true });
  }

  // ---------- Provision a tenant subdomain (platform admins only) ----------
  // Registers <host> on the Vercel project, writes the _vercel TXT challenge
  // into Cloudflare, then asks Vercel to verify.
  // SAFETY: the Cloudflare write is hard-limited to TXT records whose name
  // starts with "_vercel". No other record type or name can ever be created,
  // modified or deleted by this endpoint.
  if (path === "/provision-subdomain" && req.method === "POST") {
    if (!(await callerIsMasterAdmin(req))) return json({ error: "Platform admins only" }, 403);
    const body = await req.json().catch(() => ({}));
    const host = String(body.host || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9.-]+$/.test(host)) return json({ error: "A valid host is required" }, 400);

    const cfg = await platformConfig();
    if (!cfg.VERCEL_TOKEN || !cfg.VERCEL_PROJECT_ID) return json({ error: "Vercel is not configured on the server" }, 500);

    const vh = { Authorization: "Bearer " + cfg.VERCEL_TOKEN, "Content-Type": "application/json" };
    const steps: any[] = [];

    const add = await fetch("https://api.vercel.com/v10/projects/" + cfg.VERCEL_PROJECT_ID + "/domains",
      { method: "POST", headers: vh, body: JSON.stringify({ name: host }) });
    const addJson = await add.json().catch(() => ({}));
    const code = addJson && addJson.error && addJson.error.code;
    const already = code === "domain_already_in_use" || code === "domain_already_exists";
    if (!add.ok && !already) {
      return json({ error: "Vercel: " + ((addJson.error && addJson.error.message) || add.status), steps }, 502);
    }
    steps.push({ step: "vercel_add_domain", ok: true, already: !!already });

    const info = await fetch("https://api.vercel.com/v9/projects/" + cfg.VERCEL_PROJECT_ID +
      "/domains/" + encodeURIComponent(host), { headers: vh });
    const infoJson = await info.json().catch(() => ({}));
    if (infoJson && infoJson.verified === true) {
      steps.push({ step: "already_verified", ok: true });
      return json({ ok: true, host, verified: true, steps });
    }
    const chal = ((infoJson && infoJson.verification) || []).find((v: any) => v.type === "TXT");
    if (!chal) return json({ error: "Vercel returned no TXT challenge", steps }, 502);
    steps.push({ step: "challenge", ok: true, name: chal.domain });

    if (!cfg.CF_API_TOKEN || !cfg.CF_ZONE_ID) {
      return json({ ok: false, host, needs_manual_txt: { name: chal.domain, value: chal.value },
        error: "Cloudflare is not configured — add this TXT record manually", steps }, 200);
    }
    const recName = String(chal.domain || "");
    if (!/^_vercel(\.|$)/.test(recName)) {
      return json({ error: "Refusing to write an unexpected DNS record: " + recName, steps }, 400);
    }
    const cfh = { Authorization: "Bearer " + cfg.CF_API_TOKEN, "Content-Type": "application/json" };
    const listed = await fetch("https://api.cloudflare.com/client/v4/zones/" + cfg.CF_ZONE_ID +
      "/dns_records?type=TXT&name=" + encodeURIComponent(recName) + "&per_page=100", { headers: cfh });
    const listJson = await listed.json().catch(() => ({}));
    const exists = ((listJson && listJson.result) || []).some((r: any) =>
      String(r.content || "").replace(/^"|"$/g, "") === chal.value);
    if (!exists) {
      const cr = await fetch("https://api.cloudflare.com/client/v4/zones/" + cfg.CF_ZONE_ID + "/dns_records", {
        method: "POST", headers: cfh,
        body: JSON.stringify({ type: "TXT", name: recName, content: chal.value, ttl: 60,
          comment: "vercel tenant subdomain verification (auto)" }),
      });
      const crJson = await cr.json().catch(() => ({}));
      if (!crJson || crJson.success !== true) {
        return json({ error: "Cloudflare: " + JSON.stringify((crJson && crJson.errors) || crJson), steps }, 502);
      }
      steps.push({ step: "cloudflare_txt_created", ok: true });
    } else {
      steps.push({ step: "cloudflare_txt_exists", ok: true });
    }

    let verified = false;
    for (let i = 0; i < 3 && !verified; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 3000));
      const vr = await fetch("https://api.vercel.com/v9/projects/" + cfg.VERCEL_PROJECT_ID +
        "/domains/" + encodeURIComponent(host) + "/verify", { method: "POST", headers: vh });
      const vrJson = await vr.json().catch(() => ({}));
      verified = !!(vrJson && vrJson.verified === true);
    }
    steps.push({ step: "vercel_verify", ok: verified });

    return json({ ok: true, host, verified, steps,
      note: verified ? "Certificate issues automatically; the host is usually live within a minute."
                     : "DNS is still propagating — press Provision again shortly." });
  }

  return json({ ok: false, error: "Not found", path }, 404);
});
