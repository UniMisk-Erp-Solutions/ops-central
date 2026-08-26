// ============================================================================
// OP Central — tenant context (subdomain -> organization)
// ============================================================================
// This app is served as STATIC files (in-browser Babel, no bundler), so there is
// no import / import.meta.env. The tenant helpers therefore live on
// window.OPC_TENANT and read configuration from window.OPC_ENV (the same idiom
// config.js already uses).
//
// The hostname is a UX / branding signal ONLY. It is never the security
// boundary — data access is decided server-side by RLS against the
// organization_memberships table joined on auth.uid(). Nothing here is trusted
// by the database.
//
// PHASE 2 STATUS: loaded but INERT. It resolves and exposes tenant identity;
// no screen consumes it yet, so behaviour is unchanged.
// ============================================================================
(function () {
  'use strict';

  var DEFAULT_BASE_DOMAIN = 'ops-central.unimisk.com';

  // Labels that are platform infrastructure, not tenants. Mirrors the DB's
  // reserved_subdomains table for the hosts that actually exist here, so the
  // shared app host (ops-central.unimisk.com) is treated as the generic host
  // rather than a tenant that cannot be found. UX signal only — the DB table is
  // the authority when an org is actually created.
  var RESERVED_LABELS = ['www', 'api', 'app', 'ops-central', 'so-po', 'quote',
                         'supabase', 'db', 'storage', 'functions', 'mail', 'status'];

  // Single source of truth for "the apex". Change it in ONE place
  // (window.OPC_ENV.APP_BASE_DOMAIN in config.js / env.js) to move the platform
  // to a different base domain — e.g. 'unimisk.com' for acme.unimisk.com.
  function getAppBaseDomain() {
    var env = window.OPC_ENV || {};
    var raw = (env.APP_BASE_DOMAIN || '').trim().toLowerCase();
    return (raw || DEFAULT_BASE_DOMAIN).replace(/^www\./, '');
  }

  // Lets a developer simulate a tenant host on localhost without real DNS.
  function getDevTenantOverride() {
    var env = window.OPC_ENV || {};
    var v = (env.DEV_TENANT_SUBDOMAIN || '').trim().toLowerCase();
    return v || null;
  }

  // ---------------------------------------------------------------------------
  // PURE function, zero I/O — safe to call synchronously on first render, so a
  // guarded screen can never mount before tenant detection has finished.
  // ---------------------------------------------------------------------------
  function resolveTenantLabelFromHostname(hostname, baseDomain, devOverride) {
    if (devOverride) return { subdomainLabel: devOverride, isTenantHost: true };
    var host = String(hostname || '').split(':')[0].toLowerCase().replace(/^www\./, '');
    var base = String(baseDomain || '').toLowerCase().replace(/^www\./, '');
    if (!host || !base) return { subdomainLabel: null, isTenantHost: false };
    if (host === base) return { subdomainLabel: null, isTenantHost: false };
    var suffix = '.' + base;
    if (host.length > suffix.length && host.slice(-suffix.length) === suffix) {
      var label = host.slice(0, -suffix.length);
      if (label.length > 0 && label.indexOf('.') === -1 &&
          RESERVED_LABELS.indexOf(label) === -1) {
        return { subdomainLabel: label, isTenantHost: true };
      }
    }
    return { subdomainLabel: null, isTenantHost: false };
  }

  // ---------------------------------------------------------------------------
  // Resolution state machine. A transient network failure ("error") and "there
  // is no org on this subdomain" ("not_found") are DIFFERENT situations and must
  // not be collapsed into one boolean.
  //   idle | loading | resolved | not_found | error
  // ---------------------------------------------------------------------------
  var state = {
    status: 'idle',
    baseDomain: getAppBaseDomain(),
    subdomainLabel: null,
    isTenantHost: false,
    tenantHostOrgId: null,
    org: null,
    error: null
  };

  // Synchronous first pass — available immediately, before any network call.
  (function initSync() {
    var r = resolveTenantLabelFromHostname(
      window.location.hostname, state.baseDomain, getDevTenantOverride());
    state.subdomainLabel = r.subdomainLabel;
    state.isTenantHost = r.isTenantHost;
  })();

  var listeners = [];
  function subscribe(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }
  function emit() {
    var snap = getState();
    listeners.forEach(function (f) { try { f(snap); } catch (e) { /* never break the app */ } });
  }
  function getState() {
    return {
      status: state.status, baseDomain: state.baseDomain,
      subdomainLabel: state.subdomainLabel, isTenantHost: state.isTenantHost,
      tenantHostOrgId: state.tenantHostOrgId, org: state.org, error: state.error
    };
  }

  // ---------------------------------------------------------------------------
  // Async resolve of label -> real org, via a PRE-AUTH-SAFE RPC (granted to
  // anon) so the login screen can show the right branding before sign-in.
  // Plain fetch(), not supabase-js: it must not touch this app's auth session.
  // ---------------------------------------------------------------------------
  function resolve() {
    if (!state.isTenantHost || !state.subdomainLabel) {
      state.status = 'resolved';           // shared/generic host — nothing to look up
      state.org = null; state.tenantHostOrgId = null;
      emit();
      return Promise.resolve(getState());
    }
    var env = window.OPC_ENV || {};
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      state.status = 'error'; state.error = 'not configured'; emit();
      return Promise.resolve(getState());
    }
    state.status = 'loading'; state.error = null; emit();

    var url = String(env.SUPABASE_URL).replace(/\/$/, '') +
              '/rest/v1/rpc/get_organization_by_subdomain';
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ p_subdomain: state.subdomainLabel })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (rows) {
        var row = Array.isArray(rows) ? rows[0] : rows;
        if (row && row.id) {
          state.status = 'resolved'; state.org = row; state.tenantHostOrgId = row.id;
        } else {
          state.status = 'not_found'; state.org = null; state.tenantHostOrgId = null;
        }
        emit();
        return getState();
      })
      .catch(function (e) {
        // Transient failure — explicitly NOT the same as not_found.
        state.status = 'error'; state.error = String((e && e.message) || e);
        state.org = null; state.tenantHostOrgId = null;
        emit();
        return getState();
      });
  }

  // ---------------------------------------------------------------------------
  // Feature gate.
  // `tenantHostOrgId` (from the hostname) and the signed-in user's
  // `organizationId` (from their membership) are DIFFERENT pieces of state.
  // Only require them to match for features that genuinely mean "must be logged
  // into the org whose subdomain you are currently on".
  // ---------------------------------------------------------------------------
  function isOrgFeatureActiveOnThisHost(key, ctx) {
    ctx = ctx || {};
    var flags = ctx.featureFlags || {};
    if (!flags[key]) return false;                       // missing row => OFF
    if (!ctx.requiresSubdomainMatch) return true;
    if (!ctx.isTenantHost || !ctx.tenantHostOrgId || !ctx.organizationId) return false;
    return ctx.tenantHostOrgId === ctx.organizationId;
  }

  // Convenience: same check against the live tenant state.
  function isFeatureOn(key, featureFlags, organizationId, requiresSubdomainMatch) {
    return isOrgFeatureActiveOnThisHost(key, {
      featureFlags: featureFlags || {},
      requiresSubdomainMatch: !!requiresSubdomainMatch,
      isTenantHost: state.isTenantHost,
      tenantHostOrgId: state.tenantHostOrgId,
      organizationId: organizationId || null
    });
  }

  window.OPC_TENANT = {
    getAppBaseDomain: getAppBaseDomain,
    getDevTenantOverride: getDevTenantOverride,
    resolveTenantLabelFromHostname: resolveTenantLabelFromHostname,
    isOrgFeatureActiveOnThisHost: isOrgFeatureActiveOnThisHost,
    isFeatureOn: isFeatureOn,
    getState: getState,
    subscribe: subscribe,
    resolve: resolve
  };

  // Kick off resolution immediately; it never blocks rendering.
  try { resolve(); } catch (e) { /* fail open */ }
})();
