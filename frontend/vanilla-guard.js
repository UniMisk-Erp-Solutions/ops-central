/**
 * ============================================================================
 *  Maintenance guard for a NON-React / static app (e.g. SO-PO).
 * ============================================================================
 *  Drop this in <head> BEFORE your app scripts:
 *
 *    <script>
 *      window.MC = {
 *        url: "https://qknaxyagucgepawvrgto.supabase.co",
 *        key: "<anon public key>",
 *        project: "so-po",
 *        // Pages that stay reachable while the app is down. Everything else
 *        // is gated, which deliberately includes login / signup.
 *        publicPaths: ["/", "/about", "/legal/*"]
 *        // ...or gate ONLY certain paths instead:
 *        // protectedPaths: ["/login", "/app/*"]
 *      };
 *    </script>
 *    <script src="/maintenance-guard.js"></script>
 *
 *  Behaviour is identical to the React gate:
 *    * reads ONE public table in the separate cloud project (GET only)
 *    * never touches this app's own backend
 *    * FAIL-OPEN: any error/timeout leaves the site exactly as it was
 *    * the maintenance screen is static: no images, icons or network calls
 *    * light appearance only, so every app shows the same calm page
 *    * only gates the pages you say are private (see publicPaths above)
 * ============================================================================
 */
(function () {
  var cfg = window.MC || {};
  if (!cfg.url || !cfg.key || !cfg.project) return;         // not configured -> do nothing

  var TIMEOUT = 1500, POLL = 30000, shown = false;

  var CSS = [
    '.mc-root{--mc-canvas:#f5f5f5;--mc-card:#fff;--mc-ink:#0c0a09;--mc-body:#4e4e4e;',
    '--mc-muted:#777169;--mc-line:#e7e5e4;--mc-primary:#292524;--mc-on-primary:#fff;',
    'color-scheme:light;min-height:100vh;display:grid;place-items:center;padding:24px;',
    'position:relative;overflow:hidden;background:var(--mc-canvas);color:var(--mc-body);',
    'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
    'font-size:16px;line-height:1.5;letter-spacing:.16px;-webkit-font-smoothing:antialiased}',
    '.mc-orb{position:absolute;border-radius:50%;filter:blur(58px);opacity:.55;z-index:0}',
    '.mc-card{position:relative;z-index:1;width:100%;max-width:520px;text-align:center;',
    'background:var(--mc-card);border:1px solid var(--mc-line);border-radius:24px;',
    'padding:56px 48px;box-shadow:0 4px 16px rgba(0,0,0,.04)}',
    '.mc-eyebrow{font-size:12px;font-weight:600;line-height:1.4;letter-spacing:.96px;',
    'text-transform:uppercase;color:var(--mc-muted);margin:0 0 20px}',
    '.mc-h1{font-family:Newsreader,"Iowan Old Style",Palatino,"Palatino Linotype",Georgia,"Times New Roman",serif;font-weight:300;',
    'font-size:40px;line-height:1.1;letter-spacing:-.4px;color:var(--mc-ink);margin:0}',
    '.mc-rule{width:36px;height:1px;background:var(--mc-line);border:0;margin:28px auto}',
    '.mc-p{margin:0 auto;max-width:40ch;color:var(--mc-body)}',
    '.mc-eta{margin:20px 0 0;font-size:15px;letter-spacing:.15px;color:var(--mc-muted)}',
    '.mc-eta strong{color:var(--mc-ink);font-weight:500}',
    '.mc-btn{margin-top:32px;height:40px;padding:0 22px;border:0;border-radius:9999px;',
    'background:var(--mc-primary);color:var(--mc-on-primary);font-family:inherit;font-size:15px;',
    'font-weight:500;line-height:1;cursor:pointer;transition:background-color .18s ease}',
    '.mc-btn:hover{background:var(--mc-ink)}',
    '.mc-foot{margin:24px 0 0;font-size:13.5px;color:var(--mc-muted)}',
    '@media (max-width:560px){.mc-card{padding:44px 26px;border-radius:20px}',
    '.mc-h1{font-size:32px;letter-spacing:-.32px}}'
  ].join("");

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function orb(color, size, top, left) {
    return '<span class="mc-orb" style="background:' + color + ';width:' + size + 'px;height:' +
           size + 'px;top:' + top + ';left:' + left + '"></span>';
  }

  function screen(row) {
    if (shown) return;
    shown = true;

    var title = (row && row.display_name) || "This service";
    var msg = (row && row.message) ||
      "This service is briefly unavailable while we carry out maintenance. " +
      "Your data is safe and nothing has been lost.";
    var eta = row && row.eta ? new Date(row.eta).toLocaleString() : null;

    document.documentElement.innerHTML =
      '<head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light">' +
      '<title>We’ll be right back</title><style>' + CSS + '</style></head>' +
      '<body style="margin:0"><div class="mc-root">' +
        orb("#a8c8e8", 360, "-130px", "-120px") +
        orb("#e8b8c4", 320, "58%", "70%") +
        orb("#a7e5d3", 280, "74%", "-80px") +
        '<div class="mc-card">' +
          '<p class="mc-eyebrow">' + esc(title) + '</p>' +
          '<h1 class="mc-h1">We’ll be right back</h1>' +
          '<hr class="mc-rule">' +
          '<p class="mc-p">' + esc(msg) + '</p>' +
          (eta ? '<p class="mc-eta">Expected back around <strong>' + esc(eta) + '</strong></p>' : '') +
          '<button class="mc-btn" onclick="location.reload()">Try again</button>' +
          '<p class="mc-foot">This page updates automatically once the service is restored.</p>' +
        '</div>' +
      '</div></body>';
  }

  /**
   * "/"         exact match only
   * "/legal/*"  the prefix and anything beneath it
   * "/about"    the path itself and anything beneath /about/
   */
  function pathMatches(pathname, patterns) {
    if (!patterns || !patterns.length) return false;
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (p instanceof RegExp) { if (p.test(pathname)) return true; continue; }
      if (typeof p !== "string" || p === "") continue;
      var clean = p.length > 1 ? p.replace(/\/+$/, "") : p;
      if (clean === "/") { if (pathname === "/" || pathname === "") return true; continue; }
      if (clean.slice(-2) === "/*") {
        var base = clean.slice(0, -2);
        if (pathname === base || pathname.indexOf(base + "/") === 0) return true;
        continue;
      }
      if (clean.slice(-1) === "*") {
        if (pathname.indexOf(clean.slice(0, -1)) === 0) return true;
        continue;
      }
      if (pathname === clean || pathname.indexOf(clean + "/") === 0) return true;
    }
    return false;
  }

  /** Is the page we are on right now allowed to be covered? */
  function isGated() {
    var path = window.location.pathname;
    if (cfg.protectedPaths && cfg.protectedPaths.length) {
      return pathMatches(path, cfg.protectedPaths);
    }
    return !pathMatches(path, cfg.publicPaths || []);
  }

  function check() {
    if (!isGated()) return;                      // public page: never covered
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
