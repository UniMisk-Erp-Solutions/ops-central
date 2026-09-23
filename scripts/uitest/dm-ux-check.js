#!/usr/bin/env node
/**
 * OP Central — the five UX-friendliness features added for non-technical
 * users on the client-requests flow
 * ---------------------------------------------------------------------------
 *   RECOMMENDATIONS FIRST     "Quick add — ordered before" renders above the
 *                             free-text fallback, not after it, so tapping a
 *                             past item needs no typing and nothing for
 *                             Purchase to map by hand
 *   THE REQUESTER GETS TOLD   converting a request notifies the specific
 *                             person who sent it (by user_id), not only
 *                             Purchase -- their only passive signal, since
 *                             they have no "My Tasks" page
 *   ONE DEFINITION OF STATUS  clientReqStatusCopy() is the one place the
 *                             list badge, its hover text and the detail
 *                             page's status line all read from
 *   SHARE WITHOUT A FILE HOST WhatsApp/email links carry a plain-text
 *                             summary, since neither can attach the
 *                             printable HTML without a backend to host it
 *   NO DEAD-END ON FLOAT RFQ  a missing vendor email is collected inline and
 *                             immediately retried, not a toast pointing at a
 *                             screen the user has to go find
 *
 * Usage: node scripts/uitest/dm-ux-check.js [path-to-frontend]
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
sandbox.location = { hostname: 'dm.ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
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

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

const crJsx = fs.readFileSync(path.join(dir, 'src', 'screens-client-requests.jsx'), 'utf8');
const scmJsx = fs.readFileSync(path.join(dir, 'src', 'screens-scm.jsx'), 'utf8');
const srcJsx = fs.readFileSync(path.join(dir, 'src', 'screens-sourcing.jsx'), 'utf8');
const shellJsx = fs.readFileSync(path.join(dir, 'src', 'shell.jsx'), 'utf8');

console.log('\n[1] recommendations render before the free-text fallback, not after it');
const quickAddPos = crJsx.indexOf('Quick add — ordered before');
const fallbackPos = crJsx.indexOf("Can't find it above? Type it in");
check('both sections exist', quickAddPos >= 0 && fallbackPos >= 0, true);
check('"Quick add" appears earlier in the source than the free-text fallback', quickAddPos < fallbackPos, true);
check('a customer with no history gets an explanation, not a blank card',
  /No past orders for this customer yet/.test(crJsx), true);

console.log('\n[2] one definition of what each status means');
check('Draft', sandbox.clientReqStatusCopy('Draft').label, 'Draft');
check('Sent reads as an active, human process, not a mailbox state',
  sandbox.clientReqStatusCopy('Sent').label, 'Being matched');
check('Converted reads as an outcome the client cares about',
  sandbox.clientReqStatusCopy('Converted').label, 'Order placed');
check('an unknown status falls back to itself rather than throwing',
  sandbox.clientReqStatusCopy('Something New').label, 'Something New');
check('the list badge reads from the same function as the detail page',
  (crJsx.match(/clientReqStatusCopy\(/g) || []).length >= 3, true);

console.log('\n[3] the requester is told directly -- their only passive signal, since they have no My Tasks page');
check('converting notifies the SPECIFIC user who sent the request, by user_id',
  /kind: 'client-request', user_id: req\.created_by/.test(crJsx), true);
check('Purchase still gets its own confirmation too (unchanged)',
  /role: 'Purchase',\s*\n\s*text: `\$\{newSO\.so_no\} created from/.test(crJsx), true);
check("a client-request notification opens the requests list when clicked",
  /n\.kind === 'client-request'\) navigate\('client-requests'\)/.test(shellJsx), true);
check('the bell/drawer in the topbar is not gated by nav -- every role reaches it, including one with only two pages',
  /function Topbar\(/.test(shellJsx) && !/function Topbar\([^)]*\)\s*\{\s*if\s*\(!perm/.test(shellJsx), true);

console.log('\n[4] sharing a delivery challan needs no file host');
check('a plain-text summary function exists', /const shareText = \(\)/.test(scmJsx), true);
check('WhatsApp opens with that text pre-filled', /const whatsappHref = \(\)/.test(scmJsx) && /wa\.me/.test(scmJsx), true);
check("a 10-digit customer phone is given the country code so the chat actually opens",
  /digits\.length === 10 \? '91' \+ digits/.test(scmJsx), true);
check('email opens with the same text pre-filled', /const mailHref = \(\)/.test(scmJsx) && /mailto:/.test(scmJsx), true);
check('both buttons are wired into the modal footer, next to Print',
  /href=\{mailHref\(\)\}/.test(scmJsx) && /href=\{whatsappHref\(\)\}/.test(scmJsx), true);

console.log('\n[5] a missing vendor email is collected right there, not a dead-end toast');
check('the old dead-end toast is gone', /add it in .Add vendor . quote./.test(srcJsx), false);
check('missing emails now open an inline prompt instead',
  /setMissingEmails\(missing\.map\(v => \(\{ vendor_id: v\.vendor_id, name: v\.name \}\)\)\)/.test(srcJsx), true);
check('the prompt saves to the SAME config.vendor_emails every other vendor-email save uses',
  /saveConfig\(\{ vendor_emails: \{ \.\.\.cur, \.\.\.collected \} \}\)/.test(srcJsx), true);
check('collected emails are used immediately, not after waiting for state to round-trip',
  /floatRFQ\(collected\)/.test(srcJsx), true);
check('floatRFQ accepts an override so the retry does not depend on state having refreshed yet',
  /const floatRFQ = \(overrideEmails\) => \{/.test(srcJsx), true);

console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - recommendations lead, statuses read in plain language, the requester is told, sharing needs no file host, and Float RFQ has no dead end');
process.exit(bad ? 1 : 0);
