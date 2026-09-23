#!/usr/bin/env node
/**
 * Dump the shared PERMISSIONS table (base nav/can per role) as JSON, exactly
 * as the app itself would compute it -- same Babel, same file set, same
 * sandbox as every other check in this suite.
 *
 * Feeds ssh-audit-permission-drift.py, which compares this against every
 * organization's live config.data.permissions override and flags a
 * capability or nav id that an override is silently missing -- the exact
 * class of bug that broke Purchase's ability to convert a client request
 * into a Sales Order on Demo Org (see docs/client-requests.md's Traps
 * section): a per-organization override is a WHOLE-OBJECT replacement of
 * `can`/`nav`, not a merge, so it freezes at whatever the base role had on
 * the day it was written and silently falls behind every capability added
 * to the base role afterward.
 *
 * Usage:
 *   node scripts/uitest/dump-permissions.js frontend > /tmp/permissions.json
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React;
try { Babel = require('@babel/standalone'); React = require('react'); }
catch (e) { console.error('Missing dev deps. Run: npm i --no-save @babel/standalone@7.29.0 react@18.3.1 react-dom@18.3.1 jsdom'); process.exit(2); }

const dir = process.argv[2] || path.join(__dirname, '..', '..', 'frontend');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const plain = [...html.matchAll(/<script src="(src\/[^"]+)"><\/script>/g)].map(m => m[1]);
const jsx = [...html.matchAll(/type="text\/babel"\s+src="([^"]+)"/g)].map(m => m[1]);

const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const node = () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {},
  classList: { add() {}, remove() {} } });
sandbox.document = { createElement: node, head: node(), body: node(),
  documentElement: { style: { setProperty() {} } },
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null };
sandbox.location = { hostname: 'ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
sandbox.navigator = { userAgent: 'node' };
sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
sandbox.sessionStorage = sandbox.localStorage;
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
sandbox.fetch = () => new Promise(() => {});
sandbox.setTimeout = () => 0; sandbox.clearTimeout = () => {};
sandbox.setInterval = () => 0; sandbox.clearInterval = () => {};
sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
sandbox.history = { pushState() {}, replaceState() {}, back() {} };
sandbox.crypto = { randomUUID: () => 'x', getRandomValues: a => a };
sandbox.React = React;
sandbox.ReactDOM = { createRoot: () => ({ render() {} }) };
sandbox.OPC_ENV = { APP_BASE_DOMAIN: 'ops-central.unimisk.com' };
vm.createContext(sandbox);
for (const f of [...plain, ...jsx]) {
  vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, f), 'utf8'),
    { presets: ['react'], filename: f }).code, sandbox, { filename: f });
}

if (!sandbox.PERMISSIONS) { console.error('PERMISSIONS never reached window -- aborting'); process.exit(1); }
const out = {};
Object.keys(sandbox.PERMISSIONS).forEach(role => {
  const p = sandbox.PERMISSIONS[role];
  out[role] = { nav: p.nav || [], can: Object.keys(p.can || {}) };
});
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
