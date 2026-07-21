// Supabase Edge (Deno) — OP Central API.
// Adds the RFQ mailer + vendor-quote intake. All secrets stay on the server:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — injected by the stack
//   BREVO_API_KEY / SENDER_EMAIL / SENDER_NAME / QUOTE_BASE_URL — from env OR
//   the server-side file /home/deno/functions/main/_secrets.json (never served).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as Record<string, string>)[c]);

const SB_URL = Deno.env.get("SUPABASE_URL") || "http://supabase-kong:8000";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY") || Deno.env.get("SERVICE_KEY") || "";
const sbHeaders = () => ({ apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" });

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
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = normalize(url.pathname);

  if (path === "/" || path === "/health") return json({ ok: true, service: "op-central-api", runtime: "supabase-edge" });

  // ---------- Float RFQ: store per-vendor tokens + email each vendor ----------
  if (path === "/float-rfq" && req.method === "POST") {
    if (!SB_KEY) return json({ error: "Server missing service key" }, 500);
    const body = await req.json().catch(() => ({}));
    const { src_id, src_no, customer_name, org_name, vendors, items } = body || {};
    if (!src_id || !Array.isArray(vendors) || !Array.isArray(items) || !items.length) return json({ error: "src_id, vendors and items are required" }, 400);
    const cfg = await brevoConfig();
    if (!cfg.key) return json({ error: "Email is not configured yet (BREVO_API_KEY missing on the server)" }, 500);
    const rfqId = "rfq-" + src_id;
    const rand = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const cleanItems = items.map((i: any) => ({ product_id: i.product_id, name: i.name || i.product_id, code: i.code || "", qty: Number(i.qty) || 0 }));
    const withEmail = vendors.filter((v: any) => v && v.vendor_id && v.email);
    if (!withEmail.length) return json({ error: "No selected vendor has an email set" }, 400);
    const rfqVendors = withEmail.map((v: any) => ({ vendor_id: v.vendor_id, name: v.name || "Vendor", email: v.email, token: rfqId + "~" + rand(), items: cleanItems, prices: {}, status: "sent", sent_at: new Date().toISOString() }));
    const up = await fetch(SB_URL + "/rest/v1/rfqs?on_conflict=id", { method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: rfqId, rfq_no: "RFQ/" + (src_no || src_id), so_id: src_id, items_label: cleanItems.map((i: any) => i.qty + "× " + i.name).join(", ").slice(0, 240), floated_date: new Date().toISOString().slice(0, 10), status: "Floated", vendors: rfqVendors, quotes: [], selected_vendor: null }) });
    if (!up.ok) return json({ error: "Could not save RFQ: " + (await up.text().catch(() => "")).slice(0, 200) }, 502);
    const rows = cleanItems.map((i: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.name)}${i.code ? ` <span style="color:#999">(${esc(i.code)})</span>` : ""}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${i.qty}</td></tr>`).join("");
    const sent: any[] = [];
    for (const v of rfqVendors) {
      const link = cfg.base + "/quote?t=" + encodeURIComponent(v.token);
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#222"><h2 style="margin:0 0 4px">${esc(org_name || cfg.name)}</h2><p style="color:#666;margin:0 0 14px">Request for Quotation${src_no ? " — " + esc(src_no) : ""}${customer_name ? " · for " + esc(customer_name) : ""}</p><p>Dear ${esc(v.name)},</p><p>Please quote your best price for the items below. Click the button to enter prices on a secure page — no login needed.</p><table style="border-collapse:collapse;width:100%;margin:10px 0"><thead><tr><th style="text-align:left;padding:6px 10px;background:#f5f5f5">Item</th><th style="text-align:right;padding:6px 10px;background:#f5f5f5">Qty</th></tr></thead><tbody>${rows}</tbody></table><p style="text-align:center;margin:22px 0"><a href="${link}" style="background:#2b3a67;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Enter your quote →</a></p><p style="color:#999;font-size:12px;word-break:break-all">Or paste this link: ${link}</p><p style="color:#999;font-size:12px">This link is unique to you — please don’t forward it.</p></div>`;
      try {
        const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": cfg.key, "Content-Type": "application/json", accept: "application/json" }, body: JSON.stringify({ sender: { email: cfg.email, name: cfg.name }, to: [{ email: v.email, name: v.name }], subject: "Request for Quotation" + (src_no ? " — " + src_no : ""), htmlContent: html }) });
        sent.push({ vendor: v.name, ok: r.ok, status: r.status });
      } catch (e) { sent.push({ vendor: v.name, ok: false, error: String(e) }); }
    }
    return json({ ok: true, rfq_id: rfqId, sent });
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
    return json({ vendor: v.name, rfq_no: row.rfq_no, items: v.items || [], prices: v.prices || {}, submitted: v.status === "submitted" });
  }

  // ---------- Quote submit (vendor page) ----------
  if (path === "/quote-submit" && req.method === "POST") {
    if (!SB_KEY) return json({ error: "Server missing service key" }, 500);
    const body = await req.json().catch(() => ({}));
    const { t, prices } = body || {};
    if (!t || !prices || typeof prices !== "object") return json({ error: "token and prices required" }, 400);
    const rfqId = String(t).split("~")[0];
    const rr = await fetch(SB_URL + "/rest/v1/rfqs?id=eq." + encodeURIComponent(rfqId) + "&select=*", { headers: sbHeaders() });
    const row = (await rr.json().catch(() => []))[0];
    if (!row) return json({ error: "Invalid link" }, 404);
    const vendors = (row.vendors || []).map((x: any) => x.token === t ? { ...x, prices, status: "submitted", submitted_at: new Date().toISOString() } : x);
    const v = vendors.find((x: any) => x.token === t);
    if (!v) return json({ error: "Invalid link" }, 404);
    await fetch(SB_URL + "/rest/v1/rfqs?id=eq." + encodeURIComponent(rfqId), { method: "PATCH", headers: { ...sbHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ vendors }) });
    const sr = await fetch(SB_URL + "/rest/v1/sourcings?id=eq." + encodeURIComponent(row.so_id) + "&select=prices,quote_vendors", { headers: sbHeaders() });
    const srow = (await sr.json().catch(() => []))[0];
    if (srow) {
      const np = srow.prices || {};
      for (const pid of Object.keys(prices)) { np[pid] = np[pid] || {}; np[pid][v.vendor_id] = Number((prices as any)[pid]) || 0; }
      const qv = Array.from(new Set([...(srow.quote_vendors || []), v.vendor_id]));
      await fetch(SB_URL + "/rest/v1/sourcings?id=eq." + encodeURIComponent(row.so_id), { method: "PATCH", headers: { ...sbHeaders(), Prefer: "return=minimal" }, body: JSON.stringify({ prices: np, quote_vendors: qv }) });
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: "Not found", path }, 404);
});
