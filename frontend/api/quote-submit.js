// Vercel serverless function — vendor submits prices. Writes them onto the rfqs row
// AND folds them into sourcings.prices[product_id][vendor_id] + quote_vendors, so the
// presales vendor-comparison shows the real prices live. Service key stays server-side.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const { t, prices } = req.body || {};
  if (!t || !prices || typeof prices !== 'object') { res.status(400).json({ error: 'token and prices required' }); return; }
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: 'Server not configured' }); return; }
  const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  const rfqId = String(t).split('~')[0];
  try {
    const rr = await fetch(SB_URL + '/rest/v1/rfqs?id=eq.' + encodeURIComponent(rfqId) + '&select=*', { headers: H });
    const row = (await rr.json().catch(() => []))[0];
    if (!row) { res.status(404).json({ error: 'Invalid link' }); return; }
    const vendors = (row.vendors || []).map(x => x.token === t ? Object.assign({}, x, { prices: prices, status: 'submitted', submitted_at: new Date().toISOString() }) : x);
    const v = vendors.find(x => x.token === t);
    if (!v) { res.status(404).json({ error: 'Invalid link' }); return; }
    await fetch(SB_URL + '/rest/v1/rfqs?id=eq.' + encodeURIComponent(rfqId), { method: 'PATCH', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify({ vendors }) });

    // Fold prices into the sourcing so presales sees them without any manual step.
    const sr = await fetch(SB_URL + '/rest/v1/sourcings?id=eq.' + encodeURIComponent(row.so_id) + '&select=prices,quote_vendors', { headers: H });
    const srow = (await sr.json().catch(() => []))[0];
    if (srow) {
      const np = srow.prices || {};
      Object.keys(prices).forEach(pid => { np[pid] = np[pid] || {}; np[pid][v.vendor_id] = Number(prices[pid]) || 0; });
      const qv = Array.from(new Set([].concat(srow.quote_vendors || [], [v.vendor_id])));
      await fetch(SB_URL + '/rest/v1/sourcings?id=eq.' + encodeURIComponent(row.so_id), { method: 'PATCH', headers: Object.assign({}, H, { Prefer: 'return=minimal' }), body: JSON.stringify({ prices: np, quote_vendors: qv }) });
    }
    res.status(200).json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not save your quote — please try again' }); }
};
