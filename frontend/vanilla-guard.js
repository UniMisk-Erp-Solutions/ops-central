/**
 * ============================================================================
 *  Maintenance guard for a NON-React / static app (e.g. SO-PO).
 * ============================================================================
 *  Drop this in <head> BEFORE your app scripts:
 *
 *    <script>
 *      window.MC = { url: "https://qknaxyagucgepawvrgto.supabase.co",
 *                    key: "<anon public key>", project: "so-po" };
 *    </script>
 *    <script src="/maintenance-guard.js"></script>
 *
 *  Behaviour is identical to the React gate:
 *    * reads ONE public table in the separate cloud project (GET only)
 *    * never touches this app's own backend
 *    * FAIL-OPEN: any error/timeout leaves the site exactly as it was
 *    * the maintenance screen is static and makes zero network calls
 * ============================================================================
 */
(function () {
  var cfg = window.MC || {};
  if (!cfg.url || !cfg.key || !cfg.project) return;         // not configured -> do nothing

  var TIMEOUT = 1500, POLL = 30000, shown = false;

  function screen(row) {
    if (shown) return;
    shown = true;
    var msg = (row && row.message) ||
      ((row && row.display_name ? row.display_name : "This service") +
       " is temporarily unavailable while we carry out maintenance. Your data is safe — nothing has been lost.");
    var eta = row && row.eta ? new Date(row.eta).toLocaleString() : null;

    document.documentElement.innerHTML =
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>We’ll be right back</title></head><body style="margin:0;min-height:100vh;display:grid;' +
      'place-items:center;background:#0b0f17;color:#e6edf3;font:15px/1.6 system-ui,Segoe UI,Roboto,sans-serif;padding:20px">' +
      '<div style="max-width:460px;width:100%;text-align:center;background:#111826;border:1px solid #1e2733;' +
      'border-radius:18px;padding:38px 30px">' +
      '<div style="font-size:42px;line-height:1">🛠️</div>' +
      '<h1 style="font-size:22px;margin:10px 0 6px">We’ll be right back</h1>' +
      '<p style="color:#8b98a9;margin:0">' + esc(msg) + '</p>' +
      (eta ? '<p style="color:#8b98a9;margin-top:14px;font-size:14px">Expected back around <strong style="color:#e6edf3">' + esc(eta) + '</strong></p>' : '') +
      '<button onclick="location.reload()" style="margin-top:22px;padding:10px 20px;border-radius:10px;border:0;' +
      'background:#2f81f7;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Try again</button>' +
      '</div></body>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function check() {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT);
    var url = cfg.url.replace(/\/$/, "") + "/rest/v1/status?key=eq." +
              encodeURIComponent(cfg.project) + "&select=status,message,eta,display_name";

    fetch(url, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        clearTimeout(to);
        var row = rows && rows.length ? rows[0] : null;
        if (row && row.status === "maintenance") screen(row);
      })
      .catch(function () { clearTimeout(to); });          // fail open, always
  }

  check();
  setInterval(check, POLL);
  window.addEventListener("focus", check);
})();
