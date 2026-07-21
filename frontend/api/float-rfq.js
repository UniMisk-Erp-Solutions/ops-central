// Vercel serverless function — floats an RFQ: stores a per-vendor token in the
// `rfqs` table (via Supabase service key) and emails each vendor a private quote
// link through Brevo. Secrets live ONLY here (server-side env), never in the browser.
//
// Required Vercel env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, BREVO_API_KEY, SENDER_EMAIL, SENDER_NAME
//   QUOTE_BASE_URL (optional, defaults to https://ops-central.unimisk.com)
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const { src_id, src_no, customer_name, org_name, vendors, items } = req.body || {};
  if (!src_id || !Array.isArray(vendors) || !Array.isArray(items) || !items.length) {
    res.status(400).json({ error: 'src_id, vendors and items are required' }); return;
  }
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BREVO = process.env.BREVO_API_KEY;
  const SENDER_EMAIL = process.env.SENDER_EMAIL || 'info@unimisk.com';
  const SENDER_NAME = process.env.SENDER_NAME || 'Unimisk';
  const BASE = process.env.QUOTE_BASE_URL || 'https://ops-central.unimisk.com';
  if (!SB_URL || !SB_KEY || !BREVO) { res.status(500).json({ error: 'Server not configured — missing SUPABASE_URL / SUPABASE_SERVICE_KEY / BREVO_API_KEY' }); return; }

  const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  const rfqId = 'rfq-' + src_id;
  const rand = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const cleanItems = items.map(i => ({ product_id: i.product_id, name: i.name || i.product_id, code: i.code || '', qty: Number(i.qty) || 0 }));
  const withEmail = vendors.filter(v => v && v.vendor_id && v.email);
  if (!withEmail.length) { res.status(400).json({ error: 'No selected vendor has an email set' }); return; }
  const rfqVendors = withEmail.map(v => ({ vendor_id: v.vendor_id, name: v.name || 'Vendor', email: v.email, token: rfqId + '~' + rand(), items: cleanItems, prices: {}, status: 'sent', sent_at: new Date().toISOString() }));

  // Upsert the rfqs row (one per sourcing; re-floating replaces it).
  const up = await fetch(SB_URL + '/rest/v1/rfqs?on_conflict=id', {
    method: 'POST',
    headers: Object.assign({}, H, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ id: rfqId, rfq_no: 'RFQ/' + (src_no || src_id), so_id: src_id, items_label: cleanItems.map(i => i.qty + '× ' + i.name).join(', ').slice(0, 240), floated_date: new Date().toISOString().slice(0, 10), status: 'Floated', vendors: rfqVendors, quotes: [], selected_vendor: null }),
  });
  if (!up.ok) { const t = await up.text().catch(() => ''); res.status(502).json({ error: 'Could not save RFQ: ' + String(t).slice(0, 300) }); return; }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rowsHtml = cleanItems.map(i => '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">' + esc(i.name) + (i.code ? ' <span style="color:#999">(' + esc(i.code) + ')</span>' : '') + '</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">' + i.qty + '</td></tr>').join('');
  const sent = [];
  for (const v of rfqVendors) {
    const link = BASE + '/quote?t=' + encodeURIComponent(v.token);
    const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#222">'
      + '<h2 style="margin:0 0 4px">' + esc(org_name || SENDER_NAME) + '</h2>'
      + '<p style="color:#666;margin:0 0 14px">Request for Quotation' + (src_no ? ' — ' + esc(src_no) : '') + (customer_name ? ' · for ' + esc(customer_name) : '') + '</p>'
      + '<p>Dear ' + esc(v.name) + ',</p><p>Please quote your best price for the items below. Click the button to enter prices on a secure page — no login needed.</p>'
      + '<table style="border-collapse:collapse;width:100%;margin:10px 0"><thead><tr><th style="text-align:left;padding:6px 10px;background:#f5f5f5">Item</th><th style="text-align:right;padding:6px 10px;background:#f5f5f5">Qty</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>'
      + '<p style="text-align:center;margin:22px 0"><a href="' + link + '" style="background:#2b3a67;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Enter your quote →</a></p>'
      + '<p style="color:#999;font-size:12px;word-break:break-all">Or paste this link: ' + link + '</p>'
      + '<p style="color:#999;font-size:12px">This link is unique to you — please don’t forward it.</p></div>';
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: SENDER_EMAIL, name: SENDER_NAME }, to: [{ email: v.email, name: v.name }], subject: 'Request for Quotation' + (src_no ? ' — ' + src_no : ''), htmlContent: html }),
      });
      sent.push({ vendor: v.name, email: v.email, ok: r.ok, status: r.status });
    } catch (e) { sent.push({ vendor: v.name, email: v.email, ok: false, error: String(e && e.message || e) }); }
  }
  res.status(200).json({ ok: true, rfq_id: rfqId, sent });
};
