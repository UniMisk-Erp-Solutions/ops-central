// Vercel serverless function — returns the line items for one vendor's quote link
// (by token). Read-only; exposes ONLY that vendor's items, nothing else about the SO.
module.exports = async function handler(req, res) {
  const t = (req.query && req.query.t) || '';
  if (!t) { res.status(400).json({ error: 'Missing token' }); return; }
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: 'Server not configured' }); return; }
  const rfqId = String(t).split('~')[0];
  try {
    const r = await fetch(SB_URL + '/rest/v1/rfqs?id=eq.' + encodeURIComponent(rfqId) + '&select=*', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    const v = row && (row.vendors || []).find(x => x.token === t);
    if (!row || !v) { res.status(404).json({ error: 'This quote link is not valid or has expired.' }); return; }
    res.status(200).json({ vendor: v.name, rfq_no: row.rfq_no, items: v.items || [], prices: v.prices || {}, submitted: v.status === 'submitted' });
  } catch (e) { res.status(500).json({ error: 'Could not load quote' }); }
};
