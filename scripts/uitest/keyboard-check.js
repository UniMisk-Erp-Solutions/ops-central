#!/usr/bin/env node
/**
 * OP Central — keyboard control check
 * ---------------------------------------------------------------------------
 * The people who use this software live on the keyboard, and a keyboard layer
 * fails in exactly one way: it fires when it should not.
 *
 * An accountant halfway through typing a part number presses g, s, /, space and
 * every arrow. If any of those jumps to another screen, their entry is gone and
 * they will not trust the software again. So the rule is asserted, not hoped:
 *
 *   NEVER WHILE TYPING   every bare shortcut is dead in a text field. Only
 *                        Escape, Ctrl+K and Ctrl+Enter reach through one.
 *   NEVER OVER A COMBO   Ctrl+C, Ctrl+F, Ctrl+R, Alt+Left still belong to the
 *                        browser. We take Ctrl+K and Ctrl+Enter, nothing else.
 *   NEVER PAST A ROLE    a shortcut is a faster way somewhere you may already
 *                        go, never a way into somewhere you may not.
 *   THE CURSOR SURVIVES  it is an attribute, because React rewrites className
 *                        on re-render and would wipe a class mid-list.
 *
 * Usage: node scripts/uitest/keyboard-check.js [path-to-frontend]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let Babel, React, JSDOM;
try {
  Babel = require('@babel/standalone');
  React = require('react');
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  console.error('Missing dev deps. Run:\n  npm i --no-save @babel/standalone@7.29.0 react@18.3.1 react-dom@18.3.1 jsdom');
  process.exit(2);
}

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
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  querySelectorAll: () => [], getElementById: () => null };
sandbox.location = { hostname: 'ml.ops-central.unimisk.com', href: '', pathname: '/', search: '', hash: '' };
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
// An exception thrown inside a dispatched DOM event rejects nothing — node
// reports it and the run carries on green. Anything uncaught is a failure.
process.on('uncaughtException', (e) => {
  bad++;
  console.log('  X  uncaught: ' + (e && e.message));
  console.log(String((e && e.stack) || '').split('\n').slice(1, 4).join('\n'));
});
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`  X  ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
  else console.log(`  ok  ${label}`);
};

// A keystroke, as the resolver sees one.
const K = (key, o) => Object.assign({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, o || {});
const act = (key, ctx, o) => {
  const r = sandbox.kbdResolve(K(key, o), ctx || {});
  return r ? r.action : null;
};
// Section 16 shadows `act` with React's act(), so the resolver keeps a second
// name for use down there.
const act2 = act;

// Every bare key this layer claims. If one of these ever fires while typing,
// somebody loses work.
const BARE = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp',
  'Home', 'End', 'Enter', ' ', '/', '?', 'g', 'd', 's'];

console.log('\n[1] nothing fires while somebody is typing');
check('every bare shortcut is dead in a text field',
  BARE.filter(k => act(k, { typing: true }) !== null), []);
check('even mid-way through a "g" jump, a field wins',
  act('s', { typing: true, pending: 'g' }), null);
check('Escape still works from inside a field', act('Escape', { typing: true }), 'escape');
check('Ctrl+K still works from inside a field',
  act('k', { typing: true }, { ctrlKey: true }), 'palette');
check('Ctrl+Enter still submits from inside a field',
  act('Enter', { typing: true }, { ctrlKey: true }), 'primary');

console.log('\n[2] what counts as typing');
const el = (tag, type) => ({ tagName: tag, type });
check('a text input is typing', sandbox.kbdIsTyping(el('INPUT', 'text')), true);
check('a number input is typing', sandbox.kbdIsTyping(el('INPUT', 'number')), true);
check('an input with no type at all is typing', sandbox.kbdIsTyping({ tagName: 'INPUT' }), true);
check('a date input is typing', sandbox.kbdIsTyping(el('INPUT', 'date')), true);
check('a textarea is typing', sandbox.kbdIsTyping(el('TEXTAREA')), true);
check('a dropdown is typing — arrows belong to it', sandbox.kbdIsTyping(el('SELECT')), true);
check('contenteditable is typing', sandbox.kbdIsTyping({ tagName: 'DIV', isContentEditable: true }), true);
check('a CHECKBOX is not — space must still tick it', sandbox.kbdIsTyping(el('INPUT', 'checkbox')), false);
check('a radio is not', sandbox.kbdIsTyping(el('INPUT', 'radio')), false);
check('a button is not', sandbox.kbdIsTyping(el('BUTTON')), false);
check('a table row is not', sandbox.kbdIsTyping(el('TR')), false);
check('nothing focused is not', sandbox.kbdIsTyping(null), false);

console.log('\n[3] the browser keeps its own shortcuts');
[['c', { ctrlKey: true }], ['f', { ctrlKey: true }], ['r', { ctrlKey: true }],
 ['a', { ctrlKey: true }], ['v', { ctrlKey: true }], ['p', { ctrlKey: true }],
 ['t', { metaKey: true }], ['w', { metaKey: true }]].forEach(([k, o]) =>
  check(`Ctrl/Cmd+${k} is left alone`, act(k, {}, o), null));
check('Alt+Left stays browser back', act('ArrowLeft', {}, { altKey: true }), null);
check('Ctrl+Down is left alone', act('ArrowDown', {}, { ctrlKey: true }), null);
check('Ctrl+Alt+K is NOT our palette', act('k', {}, { ctrlKey: true, altKey: true }), null);
check('but plain Ctrl+K is', act('k', {}, { ctrlKey: true }), 'palette');
check('and so is Cmd+K on a Mac', act('k', {}, { metaKey: true }), 'palette');
check('shift does not change a bare arrow',
  act('ArrowDown', {}, { shiftKey: true }), 'row-move');

console.log('\n[4] UP AND DOWN DRIVE THE LIST ON THE PAGE');
// Twice wrong before this. First the arrows were global, so a page could not be
// scrolled and Left went back in history from anywhere. Then they were confined
// to a list you had to Tab onto first, so on a screen that IS a list of orders
// the arrows appeared to do nothing at all.
//
// They drive the list on the page, without ceremony. Moving the selection
// scrolls it into view, so nothing is lost — and the handler only swallows the
// key when there was actually a list to move, so a screen without one still
// scrolls.
const ARROWS = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End'];
check('down moves through the list straight away, with nothing focused',
  sandbox.kbdResolve(K('ArrowDown'), {}), { action: 'row-move', delta: 1 });
check('and up moves back', sandbox.kbdResolve(K('ArrowUp'), {}), { action: 'row-move', delta: -1 });
check('nothing anywhere goes back in browser history',
  ARROWS.map(k => act(k, {}))
    .concat(ARROWS.map(k => act(k, { onRow: true })))
    .concat(ARROWS.map(k => act(k, { pane: 'sidebar' })))
    .filter(a => a === 'back'), []);

// Home and End mean top and bottom of a page until a list is actually being
// driven. Taking them before that is taking something people already use.
check('Home belongs to the page until a row is selected', act('Home', {}), null);
check('End too', act('End', {}), null);
check('but once a row is selected, Home is the first row', act('Home', { onRow: true }), 'row-first');
check('and End the last', act('End', { onRow: true }), 'row-last');
check('page down moves ten rows',
  sandbox.kbdResolve(K('PageDown'), { onRow: true }), { action: 'row-move', delta: 10 });
check('page up ten back',
  sandbox.kbdResolve(K('PageUp'), { onRow: true }), { action: 'row-move', delta: -10 });

check('right opens the selected row', act('ArrowRight', { onRow: true }), 'row-open');
check('Enter opens it too', act('Enter', { onRow: true }), 'row-open');
check('space ticks its box', act(' ', { onRow: true }), 'row-tick');
check('with no row selected, Enter presses whatever is focused',
  act('Enter', { control: true }), 'activate');
check('and does nothing at all when nothing is focused', act('Enter', {}), null);

check('nothing fires while typing, however the page is arranged',
  ARROWS.filter(k => act(k, { typing: true }) !== null
              || act(k, { typing: true, onRow: true }) !== null
              || act(k, { typing: true, pane: 'sidebar' }) !== null), []);

check('slash goes to the search box', act('/'), 'search');
check('question mark opens the shortcut list', act('?'), 'help');
check('a letter on its own does nothing', act('z'), null);

console.log('\n[4b] the side arrows cross between the sidebar and the page');
// Focus used to go into the sidebar and stay there: down moved along it, and
// nothing brought it back out except tabbing through the whole thing.
check('left crosses to the sidebar', act('ArrowLeft', {}), 'pane-sidebar');
check('and from the sidebar, RIGHT COMES BACK OUT',
  act('ArrowRight', { pane: 'sidebar' }), 'pane-main');
check('left in the sidebar does nothing — there is nothing further left',
  act('ArrowLeft', { pane: 'sidebar' }), null);
check('down moves along the sidebar',
  sandbox.kbdResolve(K('ArrowDown'), { pane: 'sidebar' }), { action: 'group-move', delta: 1 });
check('up moves back along it',
  sandbox.kbdResolve(K('ArrowUp'), { pane: 'sidebar' }), { action: 'group-move', delta: -1 });
check('Enter opens the sidebar link', act('Enter', { pane: 'sidebar' }), 'activate');
check('the sidebar does not steal Home and End either',
  ['Home', 'End', 'PageUp', 'PageDown'].filter(k => act(k, { pane: 'sidebar' }) !== null), []);
check('right with a row selected opens the row, it does not jump panes',
  act('ArrowRight', { onRow: true }), 'row-open');

console.log('\n[5] "g" then a key jumps to a screen');
check('g alone only arms the sequence',
  sandbox.kbdResolve(K('g'), {}), { action: 'pending', pending: 'g' });
check('g then s is sales orders',
  sandbox.kbdResolve(K('s'), { pending: 'g' }), { action: 'goto', route: 'sales-orders' });
check('g then p is vendor POs',
  sandbox.kbdResolve(K('p'), { pending: 'g' }), { action: 'goto', route: 'vendor-pos' });
check('g then a key that means nothing just forgets it',
  act('9', { pending: 'g' }), 'clear-pending');
check('every destination in the table is a real screen, spelled the same way',
  Object.values(sandbox.KBD_GOTO).filter(r => !new RegExp(`['"]${r}['"]`).test(
    fs.readFileSync(path.join(dir, 'src', 'app.jsx'), 'utf8'))), []);
check('no two keys claim the same screen',
  Object.values(sandbox.KBD_GOTO).length - new Set(Object.values(sandbox.KBD_GOTO)).size, 0);

console.log('\n[5b] a focused button keeps its own Enter and Space');
// One press of Enter on a "Create" button must do ONE thing. Before this guard
// it pressed the button AND opened whatever row the cursor was sitting on —
// two actions from one keystroke, the second one invisible.
check('Enter with something focused is about that thing, not the row',
  act('Enter', { control: true }), 'activate');
check('and so is Space', act(' ', { control: true }), 'activate');
// "activate" does not mean "click it". A real button already acts on Enter, and
// the handler presses only the divs that were put in the tab order — asserted
// against a real button in [10b].
check('the arrows still move the list from a focused button — nothing else wants them',
  act('ArrowDown', { control: true }), 'row-move');
check('but not from a field', act('ArrowDown', { control: true, typing: true }), null);
check('and Escape still works', act('Escape', { control: true }), 'escape');
check('with nothing focused and no row picked, Enter does nothing', act('Enter', {}), null);
check('it opens the row once one is selected', act('Enter', { onRow: true }), 'row-open');

const ctl = (tag, attrs) => ({ tagName: tag, getAttribute: k => (attrs || {})[k] || null });
check('a button is a control', sandbox.kbdIsControl(ctl('BUTTON')), true);
check('a link is a control', sandbox.kbdIsControl(ctl('A')), true);
check('a checkbox is a control', sandbox.kbdIsControl({ tagName: 'INPUT', type: 'checkbox', getAttribute: () => null }), true);
check('a sidebar nav item is a control — it is in the tab order',
  sandbox.kbdIsControl(ctl('DIV', { tabindex: '0', role: 'link' })), true);
check('a plain div is not', sandbox.kbdIsControl(ctl('DIV')), false);
check('and neither is a table row', sandbox.kbdIsControl(ctl('TR')), false);
check('tabindex="-1" is not in the tab order, so not a control',
  sandbox.kbdIsControl(ctl('DIV', { tabindex: '-1' })), false);
check('nothing focused is not a control', sandbox.kbdIsControl(null), false);

console.log('\n[5d] the tabs on a record answer from anywhere on the page');
// An order has nine tabs across it and they are the main way around the record.
// The side arrows move along them once one has focus — but getting focus there
// is several presses in, so these answer from anywhere.
check('] is the next tab', sandbox.kbdResolve(K(']'), {}), { action: 'tab-step', to: 'next' });
check('[ is the previous one', sandbox.kbdResolve(K('['), {}), { action: 'tab-step', to: 'prev' });
check('3 goes straight to the third', sandbox.kbdResolve(K('3'), {}), { action: 'tab-step', to: 3 });
check('and 9 to the ninth', sandbox.kbdResolve(K('9'), {}), { action: 'tab-step', to: 9 });
check('0 is not a tab — there is no zeroth', act('0', {}), null);
check('none of them fire while typing',
  [']', '[', '1', '5', '9'].filter(k => act(k, { typing: true }) !== null), []);
check('nor behind the palette',
  [']', '[', '1', '9'].filter(k => act(k, { overlay: true }) !== null), []);
check('nor as part of a browser combination',
  [']', '3'].filter(k => act(k, {}, { ctrlKey: true }) !== null), []);
// A digit after g is a jump that does not exist, not a tab.
check('a digit mid-way through a g jump just forgets the jump',
  act('3', { pending: 'g' }), 'clear-pending');

console.log('\n[5d2] left ALWAYS reaches the sidebar from the page');
// The bug: left was blocked whenever a control had focus, to stop it going back
// in browser history. It stopped doing that long ago — it crosses to the
// sidebar now — so the guard only stranded you. Cross right into the page, land
// on a button, and there was no way back with the arrows at all.
check('left goes to the sidebar with nothing focused', act('ArrowLeft', {}), 'pane-sidebar');
check('and from a focused button too', act('ArrowLeft', { control: true }), 'pane-sidebar');
check('and with a row selected', act('ArrowLeft', { onRow: true }), 'pane-sidebar');
check('and from a focused list', act('ArrowLeft', { control: true, inList: true }), 'pane-sidebar');
check('in the sidebar it stays put — nothing is further left',
  act('ArrowLeft', { pane: 'sidebar', control: true }), null);
check('on a tab strip it still moves along the tabs',
  act('ArrowLeft', { pane: 'tabs', control: true }), 'group-move');
check('and never from under a dialog', act('ArrowLeft', { dialog: true, control: true }), null);
check('right out of the sidebar still crosses to the page',
  act('ArrowRight', { pane: 'sidebar', control: true }), 'pane-main');
check('right on the page opens the selected row',
  act('ArrowRight', { onRow: true, control: true }), 'row-open');
check('and does nothing when no row is selected — there is nothing to its right',
  act('ArrowRight', { control: true }), null);

console.log('\n[5g] Alt and a letter, the way Tally and Excel do it');
check('Alt+s is an access key',
  sandbox.kbdResolve(K('s', { altKey: true }), {}), { action: 'access', letter: 's' });
check('so is Alt+P', sandbox.kbdResolve(K('P', { altKey: true }), {}), { action: 'access', letter: 'p' });
// It types nothing, so there is nothing for it to interrupt — and leaving a
// half-filled screen the moment you think of it is the point.
check('it works mid-word in a field',
  sandbox.kbdResolve(K('s', { altKey: true }), { typing: true }), { action: 'access', letter: 's' });
check('and from under a dialog, where its own buttons answer it',
  sandbox.kbdResolve(K('s', { altKey: true }), { dialog: true }), { action: 'access', letter: 's' });
check('Ctrl+Alt+s is not ours — that is a browser or OS combination',
  act('s', {}, { altKey: true, ctrlKey: true }), null);
check('nor Cmd+Alt+s', act('s', {}, { altKey: true, metaKey: true }), null);
check('Alt with a non-letter does nothing',
  act('5', {}, { altKey: true }), null);
check('Alt+Left is still the browser going back', act('ArrowLeft', {}, { altKey: true }), null);
check('and Alt on its own is not a shortcut', act('Alt', {}), null);

// Option+e on a Mac arrives as a dead key, not "e". The physical key is the
// fallback, or the whole feature is unusable on a Mac.
check('a Mac dead key still resolves to its letter',
  sandbox.kbdAltLetter({ key: '\u00b4', code: 'KeyE' }), 'e');
check('a plain letter needs no fallback', sandbox.kbdAltLetter({ key: 'd', code: 'KeyD' }), 'd');
check('and a digit is not a letter', sandbox.kbdAltLetter({ key: '4', code: 'Digit4' }), null);

console.log('\n[5h] a screen letter is the same one as its g jump');
// One letter per screen, two ways to press it. Two tables would drift, so the
// second is derived from the first.
check('every screen with a g jump has the same Alt letter',
  Object.keys(sandbox.KBD_GOTO).filter(k => sandbox.KBD_NAV_KEY[sandbox.KBD_GOTO[k]] !== k), []);
check('no two screens share a letter',
  Object.keys(sandbox.KBD_NAV_KEY).length, new Set(Object.values(sandbox.KBD_NAV_KEY)).size);
check('sales orders is s', sandbox.KBD_NAV_KEY['sales-orders'], 's');
check('vendor POs is p', sandbox.KBD_NAV_KEY['vendor-pos'], 'p');
check('GRN is n', sandbox.KBD_NAV_KEY['grn'], 'n');

console.log('\n[5d3] one key for the button this screen is for');
// Every screen has one obvious blue button — New Sales Order, New GRN, Create
// BOQ. Tabbing to it works, but the whole point of a keyboard is not having to.
check('n presses the primary button on the page', act('n', {}), 'primary-action');
check('not while typing a name', act('n', { typing: true }), null);
check('not inside a dialog, where Ctrl+Enter is the primary button',
  act('n', { dialog: true }), null);
check('not behind the palette', act('n', { overlay: true }), null);
check('not with a modifier held', act('n', {}, { ctrlKey: true }), null);
check('and g then n is still the GRN screen, not this',
  sandbox.kbdResolve(K('n'), { pending: 'g' }), { action: 'goto', route: 'grn' });

console.log('\n[5e] a focused button is pressed, even with a row selected');
// The bug: once a row was selected, Enter meant "open the row" everywhere —
// including while focus sat on a button. Tab to "New Sales Order", press Enter,
// and the row opened instead. The button on screen never fired.
check('Enter on a focused button presses the BUTTON, not the selected row',
  act('Enter', { control: true, onRow: true }), 'activate');
check('and Space presses it too, rather than ticking the row',
  act(' ', { control: true, onRow: true }), 'activate');
check('with nothing focused, Enter still opens the selected row',
  act('Enter', { onRow: true }), 'row-open');
check('and Space still ticks it', act(' ', { onRow: true }), 'row-tick');
check('focus on the list itself still means the row — the handler routes it',
  act('Enter', { control: true, inList: true, onRow: true }), 'activate');
// Enter and Space are the focused control's, because a button uses them. The
// side arrows are not — a button does nothing with them — so right stays the
// selected row's, wherever focus happens to be.
check('right still opens the selected row, which no button wanted anyway',
  act('ArrowRight', { control: true, onRow: true }), 'row-open');

console.log('\n[5f] an open dialog owns the screen');
// A dialog is meant to be the only thing you can operate. Left crossed to the
// sidebar behind it, "g" jumped to another screen, and "]" switched a tab the
// dialog was covering — all of it leaving an editing dialog open over a page
// that had moved on.
const dlg = { dialog: true };
check('left does not cross to the sidebar behind it',
  act('ArrowLeft', dlg), null);
check('right does not cross out to the page behind it',
  act('ArrowRight', dlg), null);
check('the record tabs behind it cannot be switched',
  [']', '[', '3'].filter(k => act(k, dlg) !== null), []);
check('and a g jump cannot navigate out from under it',
  act('s', { dialog: true, pending: 'g' }), 'clear-pending');
check('slash does not hunt for a search box on the page behind',
  act('/', dlg), null);
check('but the arrows still drive the rows INSIDE it',
  sandbox.kbdResolve(K('ArrowDown'), dlg), { action: 'row-move', delta: 1 });
check('Enter still opens a row in it', act('Enter', { dialog: true, onRow: true }), 'row-open');
check('Escape still closes it', act('Escape', dlg), 'escape');
check('Ctrl+Enter still saves it', act('Enter', dlg, { ctrlKey: true }), 'primary');
check('and Ctrl+K still opens the palette', act('k', dlg, { ctrlKey: true }), 'palette');

console.log('\n[5c] a strip of tabs moves under the side arrows');
check('right moves along the tabs',
  sandbox.kbdResolve(K('ArrowRight'), { control: true, pane: 'tabs' }),
  { action: 'group-move', delta: 1 });
check('left moves back along them',
  sandbox.kbdResolve(K('ArrowLeft'), { control: true, pane: 'tabs' }),
  { action: 'group-move', delta: -1 });
check('Enter presses the focused tab', act('Enter', { control: true, pane: 'tabs' }), 'activate');
check('tabs cannot be moved while typing',
  act('ArrowRight', { typing: true, pane: 'tabs' }), null);

console.log('\n[6] an open palette owns the keyboard');
check('the list behind it does not move',
  BARE.filter(k => act(k, { overlay: true }) !== null), []);
check('a jump cannot even be started behind it',
  act('g', { overlay: true }), null);
check('but Escape still closes it', act('Escape', { overlay: true }), 'escape');
check('and Ctrl+K still reaches it', act('k', { overlay: true }, { ctrlKey: true }), 'palette');

// ---------------------------------------------------------------------------
// The row cursor, against a real DOM.
// ---------------------------------------------------------------------------
const dom = new JSDOM(`<!doctype html><html><body>
  <main class="main">
    <table class="t"><tbody>
      <tr id="r1" style="cursor: pointer"><td><input type="checkbox" id="c1"></td><td>one</td></tr>
      <tr id="r2" style="cursor: pointer"><td><input type="checkbox"></td><td>two</td></tr>
      <tr id="r3" style="cursor:pointer"><td>three</td></tr>
      <tr id="dead"><td>a total row nobody can click</td></tr>
      <tr id="skip" style="cursor: pointer" data-kbd-skip><td>opted out</td></tr>
    </tbody></table>
  </main>
</body></html>`);
const D = dom.window.document;
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[6b] a list is one tab stop, and the arrows work inside it');
const domL = new JSDOM(`<!doctype html><html><body><main class="main">
  <table class="t" id="orders"><tbody>
    <tr id="o1" style="cursor: pointer"><td>SO/FY26/0001</td></tr>
    <tr id="o2" style="cursor: pointer"><td>SO/FY26/0002</td></tr>
  </tbody></table>
  <table class="t" id="pos"><tbody>
    <tr id="p1" style="cursor: pointer"><td>PO202609001</td></tr>
    <tr id="p2" style="cursor: pointer"><td>PO202609002</td></tr>
  </tbody></table>
  <table class="t" id="totals"><tbody>
    <tr id="tot"><td>Grand total</td></tr>
  </tbody></table>
</main></body></html>`);
const DL = domL.window.document;
sandbox.document = DL;
sandbox.getComputedStyle = domL.window.getComputedStyle.bind(domL.window);

check('a table with clickable rows is a list',
  sandbox.kbdLists().map(t => t.id), ['orders', 'pos']);
check('a table of totals is not', sandbox.kbdLists().some(t => t.id === 'totals'), false);
sandbox.kbdEnhance();
check('each list became ONE tab stop, not one per row',
  ['orders', 'pos'].map(id => DL.getElementById(id).getAttribute('tabindex')), ['0', '0']);
check('no row is a tab stop', DL.querySelectorAll('tr[tabindex]').length, 0);
check('and the totals table is not one either',
  DL.getElementById('totals').getAttribute('tabindex'), null);
check('focus inside a list is recognised', sandbox.kbdIsInList(DL.getElementById('o1')), true);
check('focus on the page is not', sandbox.kbdIsInList(DL.querySelector('main')), false);

// A screen holds several lists. The arrows must drive the one being used.
const fromOrders = DL.getElementById('orders');
const fromPos = DL.getElementById('pos');
check('the rows seen from the orders list are its own',
  sandbox.kbdRows(null, fromOrders).map(r => r.id), ['o1', 'o2']);
check('and from the PO list, its own',
  sandbox.kbdRows(null, fromPos).map(r => r.id), ['p1', 'p2']);
check('moving in one list stays in that list',
  sandbox.kbdMove(1, null, fromPos).id, 'p1');
check('and moving in the other is independent',
  sandbox.kbdMove(1, null, fromOrders).id, 'o1');
check('opening from a list opens ITS row, not the first on the page',
  (sandbox.kbdCurrentRow(null, fromPos) || {}).id, 'p1');

// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[6c] focus can always get out of the sidebar again');
// The bug: arrow into the sidebar and focus stayed there. Down moved along it,
// left did nothing, and the only way back to the page was to Tab through every
// remaining link. On a wide screen that is most of the app out of reach.
const domP = new JSDOM(`<!doctype html><html><body><div class="app">
  <aside class="sidebar">
    <div class="nav-item" id="nav1" tabindex="-1" role="link">Dashboard</div>
    <div class="nav-item active" id="nav2" tabindex="0" role="link">Sales Orders</div>
    <div class="nav-item" id="nav3" tabindex="-1" role="link">Customers</div>
  </aside>
  <div class="tabs"><button class="tab" id="tabA">Overview</button></div>
  <main class="main">
    <button id="firstbtn">Edit items</button>
    <table class="t" id="mainlist"><tbody>
      <tr id="m1" style="cursor: pointer"><td>SO/FY26/0001</td></tr>
      <tr id="m2" style="cursor: pointer"><td>SO/FY26/0002</td></tr>
    </tbody></table>
  </main>
</div></body></html>`);
const DP = domP.window.document;
sandbox.document = DP;
sandbox.getComputedStyle = domP.window.getComputedStyle.bind(domP.window);
sandbox.kbdEnhance();

let navOpened = 0;
DP.getElementById('nav3').addEventListener('click', () => navOpened++);

check('a sidebar link reports the sidebar', sandbox.kbdPaneOf(DP.getElementById('nav2')), 'sidebar');
check('a tab reports the tabs', sandbox.kbdPaneOf(DP.getElementById('tabA')), 'tabs');
check('a button on the page reports the page', sandbox.kbdPaneOf(DP.getElementById('firstbtn')), 'main');
check('and so does nothing in particular', sandbox.kbdPaneOf(DP.body), 'main');

// The sidebar is a roving group: the link for the screen you are on holds the
// only tab stop and the rest are -1. A mover that skips tabindex="-1" finds one
// item, moves to itself, and the arrows look dead.
check('the arrows move down the sidebar, past the links that are -1',
  (sandbox.kbdGroupMove(DP.getElementById('nav2'), 1) || {}).id, 'nav3');
check('and back up again',
  (sandbox.kbdGroupMove(DP.getElementById('nav3'), -1) || {}).id, 'nav2');
check('stopping at the top rather than wrapping',
  (sandbox.kbdGroupMove(DP.getElementById('nav1'), -1) || {}).id, 'nav1');
check('and at the bottom',
  (sandbox.kbdGroupMove(DP.getElementById('nav3'), 1) || {}).id, 'nav3');
check('moving carries the tab stop, so Tab does not snap back',
  Array.from(DP.querySelectorAll('.sidebar .nav-item'))
    .filter(x => x.getAttribute('tabindex') === '0').map(x => x.id), ['nav3']);
check('but it does NOT open the screen — an arrow must never leave the page',
  navOpened, 0);

check('crossing left lands on the screen you are actually on',
  (sandbox.kbdFocusSidebar() || {}).id, 'nav2');
check('and focus really moved there', DP.activeElement.id, 'nav2');
// The FIRST control on the page, in reading order. Landing on the list skipped
// the tabs and the buttons above it, which is where the actions are.
check('crossing back right lands at the start of the page',
  (sandbox.kbdFocusMain() || {}).id, 'firstbtn');
check('and focus really moved back', DP.activeElement.id, 'firstbtn');
check('so the sidebar is never a dead end', sandbox.kbdPaneOf(DP.activeElement), 'main');

// With no list on the screen, coming back out still has to land somewhere.
const domQ = new JSDOM(`<!doctype html><html><body><div class="app">
  <aside class="sidebar"><div class="nav-item" id="s1" tabindex="0">Settings</div></aside>
  <main class="main"><p>A form with no list at all</p><button id="save">Save</button></main>
</div></body></html>`);
sandbox.document = domQ.window.document;
sandbox.getComputedStyle = domQ.window.getComputedStyle.bind(domQ.window);
check('on a screen with no list, right lands on the first control',
  (sandbox.kbdFocusMain() || {}).id, 'save');
check('and the sidebar still takes focus', (sandbox.kbdFocusSidebar() || {}).id, 's1');

// Nothing focused at all: the arrows still have to find the list.
sandbox.document = DP;
sandbox.getComputedStyle = domP.window.getComputedStyle.bind(domP.window);
sandbox.kbdClearCursor();
check('with nothing focused, down finds the list on the page',
  (sandbox.kbdMove(1, null, DP.body) || {}).id, 'm1');
check('and keeps going', (sandbox.kbdMove(1, null, DP.body) || {}).id, 'm2');
// Must be asked of the document that screen actually lives in.
sandbox.document = domQ.window.document;
sandbox.getComputedStyle = domQ.window.getComputedStyle.bind(domQ.window);
check('on a screen with no list, it moves nothing and the page scrolls',
  sandbox.kbdMove(1, null, domQ.window.document.body), null);
// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[6c2] "n" presses the blue button this screen is for');
const domN2 = new JSDOM(`<!doctype html><html><body><div class="app">
  <aside class="sidebar"><div class="nav-item active" tabindex="0">Sales Orders</div></aside>
  <main class="main">
    <button class="btn" id="secondary">Import sheet</button>
    <button class="btn btn-primary" id="theblue">New Sales Order</button>
    <button class="btn btn-primary" id="later" disabled>Approve</button>
  </main>
</div></body></html>`);
const DN2 = domN2.window.document;
sandbox.document = DN2;
sandbox.getComputedStyle = domN2.window.getComputedStyle.bind(domN2.window);
sandbox.kbdEnhance();

check('a primary button is reachable by Tab, as a button always was',
  DN2.getElementById('theblue').getAttribute('tabindex'), null);
check('and the pass never took it out of the tab order',
  DN2.getElementById('theblue').getAttribute('tabindex') !== '-1', true);
const blues = Array.from(DN2.querySelectorAll('.main .btn-primary:not([disabled])'))
  .filter(sandbox.kbdVisible);
check('the screen primary button is the first enabled blue one',
  blues.length && blues[0].id, 'theblue');
check('a disabled one is never it', blues.some(b => b.id === 'later'), false);

// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[6c3] the first tab is not a dead end');
// The report: right crosses into the page, but nothing crosses back. On a strip
// of tabs left moves ALONG the tabs, and on the first one there is nothing to
// its left — so it did nothing, and focus that had landed on the tabs could
// never get back to the sidebar. Left off the first tab crosses instead.
const domX = new JSDOM(`<!doctype html><html><body><div class="app">
  <aside class="sidebar">
    <div class="nav-item" id="xa" tabindex="-1" role="link">Dashboard</div>
    <div class="nav-item active" id="xb" tabindex="0" role="link">Sales Orders</div>
  </aside>
  <main class="main">
    <div class="tabs">
      <button class="tab active" id="x1">Overview</button>
      <button class="tab" id="x2">Line Items</button>
      <button class="tab" id="x3">Procurement</button>
    </div>
    <table class="t" id="xlist"><tbody>
      <tr id="xr1" style="cursor: pointer"><td>SO/FY26/0001</td></tr>
    </tbody></table>
  </main>
</div></body></html>`);
const DX = domX.window.document;
sandbox.document = DX;
sandbox.getComputedStyle = domX.window.getComputedStyle.bind(domX.window);
sandbox.kbdEnhance();

check('left off the FIRST tab crosses to the sidebar',
  (sandbox.kbdGroupMoveOrExit(DX.getElementById('x1'), -1).exited || {}).id, 'xb');
check('and focus really moved there', DX.activeElement.id, 'xb');
check('left from a tab in the middle just moves along the strip',
  (sandbox.kbdGroupMoveOrExit(DX.getElementById('x2'), -1).moved || {}).id, 'x1');
check('it does not cross when it had somewhere to go',
  sandbox.kbdGroupMoveOrExit(DX.getElementById('x2'), -1).exited, null);
check('right off the LAST tab stays put — nothing is to its right',
  (sandbox.kbdGroupMoveOrExit(DX.getElementById('x3'), 1).moved || {}).id, 'x3');
check('and never crosses rightwards', sandbox.kbdGroupMoveOrExit(DX.getElementById('x3'), 1).exited, null);
check('the top of the sidebar still clamps rather than crossing',
  sandbox.kbdGroupMoveOrExit(DX.getElementById('xa'), -1).exited, null);

// The whole round trip, which is what was reported broken.
// Which tab holds the strip's stop depends on where it was last left, so this
// asserts the round trip, not one particular landing spot.
sandbox.kbdFocusMain();
check('right out of the sidebar lands on the page',
  sandbox.kbdPaneOf(DX.activeElement) !== 'sidebar', true);
// Pressing left, the way somebody actually does: along the strip, then off the
// end of it and across. It has to arrive, from wherever it landed.
let guard = 0;
while (sandbox.kbdPaneOf(DX.activeElement) !== 'sidebar' && guard++ < 10) {
  if (sandbox.kbdPaneOf(DX.activeElement) === 'tabs') sandbox.kbdGroupMoveOrExit(DX.activeElement, -1);
  else sandbox.kbdFocusSidebar();
}
check('and pressing left gets back to the sidebar, from wherever it landed',
  DX.activeElement.id, 'xb');
check('in a couple of presses, not by luck', guard <= 4, true);

// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[6c4] the letters land on the page, and Alt shows them');
const domK = new JSDOM(`<!doctype html><html><body><div class="app">
  <aside class="sidebar">
    <div class="nav-item" data-nav="dashboard" id="kD" tabindex="-1">Dashboard</div>
    <div class="nav-item active" data-nav="sales-orders" id="kS" tabindex="0">Sales Orders</div>
    <div class="nav-item" data-nav="vendor-pos" id="kP" tabindex="-1">Vendor POs</div>
    <div class="nav-item" data-nav="grn" id="kN" tabindex="-1">GRN</div>
  </aside>
  <main class="main">
    <button class="btn btn-primary" id="bNew">New Sales Order</button>
    <button class="btn" id="bEdit">Edit items</button>
    <button class="btn" id="bHold">Put on hold</button>
    <button class="btn" id="bOff" disabled>Cancel order</button>
    <button class="btn" id="bBlank"></button>
  </main>
</div></body></html>`);
const DK = domK.window.document;
sandbox.document = DK;
sandbox.getComputedStyle = domK.window.getComputedStyle.bind(domK.window);
sandbox.kbdAssignAccessKeys();

check('every screen in the sidebar got its fixed letter',
  ['kD', 'kS', 'kP', 'kN'].map(id => DK.getElementById(id).getAttribute('data-kbd-key')),
  ['d', 's', 'p', 'n']);
check('a button takes the first free letter of its own label',
  DK.getElementById('bNew').getAttribute('data-kbd-key'), 'n');
check('the next takes the first letter still free',
  DK.getElementById('bEdit').getAttribute('data-kbd-key'), 'e');
check('and so on down the page',
  DK.getElementById('bHold').getAttribute('data-kbd-key'), 'p');
check('a disabled button gets none — it would be a letter that does nothing',
  DK.getElementById('bOff').getAttribute('data-kbd-key'), null);
check('nor does one with no label to take a letter from',
  DK.getElementById('bBlank').getAttribute('data-kbd-key'), null);
// A busy screen runs its own labels out — by the tenth button on the dashboard
// every letter of its label is spoken for. A button nobody can press is worse
// than an arbitrary letter, so it falls back to one that shadows no screen.
const busy = {}; 'newsalesordr'.split('').forEach(c => { busy[c] = true; });
check('when the label has nothing left, it takes a letter no screen uses',
  ['f', 'h', 'j', 'q', 'y', 'z'].includes(sandbox.kbdPickLetter('New Sales Order', busy)), true);
const everything = {};
'abcdefghijklmnopqrstuvwxy'.split('').forEach(c => { everything[c] = true; });
check('and only then one that does', sandbox.kbdPickLetter('New Sales Order', everything), 'z');
const full = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(c => { full[c] = true; });
check('with the whole alphabet gone it gives up rather than double-booking',
  sandbox.kbdPickLetter('New Sales Order', full), null);
check('no two things on the page share a letter',
  ['bNew', 'bEdit', 'bHold'].map(id => DK.getElementById(id).getAttribute('data-kbd-key')).sort(),
  ['e', 'n', 'p']);

// The page is what is in front of you, so it wins — and the screen it shadows
// says so, rather than quietly doing nothing.
check('Alt+n presses the button, not the GRN screen',
  (sandbox.kbdAccessTarget('n') || {}).id, 'bNew');
check('and the shadowed screen is marked, so holding Alt shows what happened',
  DK.getElementById('kN').getAttribute('data-kbd-shadowed'), '1');
check('a screen nothing shadows is not marked',
  DK.getElementById('kD').getAttribute('data-kbd-shadowed'), null);
check('Alt+d still goes to the Dashboard', (sandbox.kbdAccessTarget('d') || {}).id, 'kD');
check('Alt+s still goes to Sales Orders', (sandbox.kbdAccessTarget('s') || {}).id, 'kS');
check('a letter nobody claims does nothing at all', sandbox.kbdAccessTarget('z'), null);
check('and the screen letters never moved for any of it',
  ['kD', 'kS', 'kP', 'kN'].map(id => DK.getElementById(id).getAttribute('data-kbd-key')),
  ['d', 's', 'p', 'n']);

// Running it again must not shuffle anything — it runs on every render.
sandbox.kbdAssignAccessKeys();
check('a second pass changes nothing',
  ['kD', 'kS', 'kP', 'kN', 'bNew', 'bEdit', 'bHold']
    .map(id => DK.getElementById(id).getAttribute('data-kbd-key')),
  ['d', 's', 'p', 'n', 'n', 'e', 'p']);

// A button that has gone must not leave its letter shadowing a screen.
DK.getElementById('bNew').remove();
sandbox.kbdAssignAccessKeys();
check('when the button goes, the screen it shadowed is free again',
  DK.getElementById('kN').getAttribute('data-kbd-shadowed'), null);
check('and Alt+n reaches the GRN screen once more',
  (sandbox.kbdAccessTarget('n') || {}).id, 'kN');

// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[6d] and they actually switch');
const domT = new JSDOM(`<!doctype html><html><body><div class="app">
  <aside class="sidebar"><div class="nav-item active" tabindex="0">Sales Orders</div></aside>
  <main class="main">
    <div class="tabs mb-2">
      <button class="tab active" id="T1">Overview</button>
      <button class="tab" id="T2">Line Items + BOM</button>
      <button class="tab" id="T3">Procurement</button>
      <button class="tab" id="T4">Vendor POs</button>
      <button class="tab" id="T5">GRN</button>
    </div>
    <table class="t"><tbody>
      <tr id="tr1" style="cursor: pointer"><td>VPO/FY26/0044</td></tr>
    </tbody></table>
  </main>
</div></body></html>`);
const DT = domT.window.document;
sandbox.document = DT;
sandbox.getComputedStyle = domT.window.getComputedStyle.bind(domT.window);
sandbox.kbdEnhance();

let switches = [];
['T1', 'T2', 'T3', 'T4', 'T5'].forEach(id =>
  DT.getElementById(id).addEventListener('click', () => switches.push(id)));

check('the strip is found on the page', !!sandbox.kbdTabStrip(), true);
check('all five tabs are in it', sandbox.kbdTabButtons(sandbox.kbdTabStrip()).length, 5);
check('] moves off the active tab to the next', (sandbox.kbdTabTo('next') || {}).id, 'T2');
check('and actually presses it, so the panel changes', switches, ['T2']);
check('focus follows it, so the side arrows carry on from there', DT.activeElement.id, 'T2');

// It reads the active tab from the page, not from a counter of its own — the
// user may have clicked one with the mouse in between.
// Exactly one tab is ever active, the way React renders the strip.
const setActive = (id) => ['T1', 'T2', 'T3', 'T4', 'T5'].forEach(x =>
  DT.getElementById(x).className = 'tab' + (x === id ? ' active' : ''));
setActive('T4');
check('it steps from whichever tab is really active', (sandbox.kbdTabTo('next') || {}).id, 'T5');
check('and stops at the last rather than wrapping', (sandbox.kbdTabTo('next') || {}).id, 'T5');

setActive('T1');
check('[ stops at the first', (sandbox.kbdTabTo('prev') || {}).id, 'T1');
check('a digit goes straight to that tab', (sandbox.kbdTabTo(3) || {}).id, 'T3');
check('and to the last one', (sandbox.kbdTabTo(5) || {}).id, 'T5');
check('a digit past the end does nothing at all', sandbox.kbdTabTo(9), null);

// The panel under the tabs is about to be replaced, so a row selected in it is
// pointing at a table that will not be there.
sandbox.kbdMove(1, null, DT.body);
check('a row was selected', !!sandbox.kbdCurrentRow(null, DT.body), true);
sandbox.kbdTabTo(2);
check('switching tab drops it', DT.querySelectorAll('[data-kbd-cursor]').length, 0);

// A screen with no tabs must leave the keys alone — a digit is then just a digit.
const domN = new JSDOM('<!doctype html><html><body><main class="main"><p>no tabs here</p></main></body></html>');
sandbox.document = domN.window.document;
sandbox.getComputedStyle = domN.window.getComputedStyle.bind(domN.window);
check('with no tab strip, there is nothing to find', sandbox.kbdTabStrip(), null);
check('and nothing happens', sandbox.kbdTabTo('next'), null);
check('so the key is left to the page', sandbox.kbdTabTo(2), null);

// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[6e] a group of buttons is one tab stop, not one each');
// Tab used to walk all twenty-two sidebar links, and all nine tabs on an order,
// before reaching anything on the page. Reachable, but nobody would — which is
// the same as unreachable.
const domR = new JSDOM(`<!doctype html><html><body><div class="app">
  <main class="main">
    <div class="tabs">
      <button class="tab" id="R1">Overview</button>
      <button class="tab active" id="R2">Line Items</button>
      <button class="tab" id="R3">Procurement</button>
      <button class="tab" id="R4">Vendor POs</button>
    </div>
    <div class="role-switcher">
      <button id="U1">DE</button><button class="active" id="U2">JI</button><button id="U3">ST</button>
    </div>
    <button id="loose">Edit items</button>
  </main>
</div></body></html>`);
const DR = domR.window.document;
sandbox.document = DR;
sandbox.getComputedStyle = domR.window.getComputedStyle.bind(domR.window);
sandbox.kbdEnhance();

const stops = (sel) => Array.from(DR.querySelectorAll(sel))
  .filter(x => x.getAttribute('tabindex') !== '-1').map(x => x.id);
check('four tabs, but only one tab stop', stops('.tabs button'), ['R2']);
check('and it is the tab you are actually on', DR.getElementById('R2').getAttribute('tabindex'), '0');
check('the role switcher is one stop too', stops('.role-switcher button'), ['U2']);
check('a button on its own is untouched', DR.getElementById('loose').getAttribute('tabindex'), null);

// Moving within the group has to carry the stop, or Tab would snap back to the
// one marked active and the group would feel like it jumped.
sandbox.kbdGroupMove(DR.getElementById('R2'), 1);
check('moving along the tabs carries the tab stop with it', stops('.tabs button'), ['R3']);
sandbox.kbdTabTo(1);
check('and so does jumping straight to one', stops('.tabs button'), ['R1']);

// A group of one is not a group.
const domS = new JSDOM('<!doctype html><html><body><div class="tabs"><button id="only">Solo</button></div></body></html>');
check('a strip with a single button is left alone',
  sandbox.kbdRoving(domS.window.document.querySelector('.tabs')), 0);
check('so it keeps its natural tab stop',
  domS.window.document.getElementById('only').getAttribute('tabindex'), null);

// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[7] only rows a person can actually act on');
check('the three clickable rows, and no others',
  sandbox.kbdRows().map(r => r.id), ['r1', 'r2', 'r3']);
check('a total row with no handler is skipped', sandbox.kbdRows().some(r => r.id === 'dead'), false);
check('and a row can opt out by hand', sandbox.kbdRows().some(r => r.id === 'skip'), false);

console.log('\n[7b] a row you can WORK IN counts, not only one that opens');
// Most tables in this app are not lists of records: they are the bill of
// materials, the receive lines, the tax lines, the allocation grid. Their rows
// open nothing, but they hold the tick boxes and quantities the work happens
// in. Requiring a clickable row meant the arrows did nothing on most of the
// screens where they help most — which is exactly what was reported.
const domW = new JSDOM(`<!doctype html><html><body><main class="main">
  <table class="t" id="receive"><tbody>
    <tr id="w1"><td>Chassis</td><td><input type="checkbox"></td><td><input type="number" value="1"></td></tr>
    <tr id="w2"><td>PSU</td><td><input type="checkbox"></td><td><input type="number" value="4"></td></tr>
    <tr id="w3"><td>Cable</td><td colspan="2"><button>Split</button></td></tr>
    <tr id="wdis"><td>Retired line</td><td><input type="checkbox" disabled></td></tr>
    <tr id="wtot"><td>Grand total</td><td>5</td></tr>
    <tr id="wskip" data-kbd-skip><td>opted out</td><td><input type="text"></td></tr>
  </tbody></table>
</main></body></html>`);
const DW = domW.window.document;
sandbox.document = DW;
sandbox.getComputedStyle = domW.window.getComputedStyle.bind(domW.window);

check('a row with a tick box is worth moving to',
  sandbox.kbdRowUsable(DW.getElementById('w1')), true);
check('so is one with a quantity to type',
  sandbox.kbdRowUsable(DW.getElementById('w2')), true);
check('and one with a button in it', sandbox.kbdRowUsable(DW.getElementById('w3')), true);
check('a totals row is not — stopping on "Grand total" helps nobody',
  sandbox.kbdRowUsable(DW.getElementById('wtot')), false);
check('nor is a row whose only control is disabled',
  sandbox.kbdRowUsable(DW.getElementById('wdis')), false);
check('and a row can still opt out by hand',
  sandbox.kbdRowUsable(DW.getElementById('wskip')), false);
check('so the arrows walk exactly the rows with work in them',
  sandbox.kbdRows(null, DW.body).map(r => r.id), ['w1', 'w2', 'w3']);
check('and the table counts as a list, worth a tab stop',
  sandbox.kbdLists().map(t => t.id), ['receive']);

// Right, on a row that opens nothing, goes INTO it — which is what somebody
// working down a receive sheet wants next.
check('such a row does not pretend to open anything',
  sandbox.kbdRowOpens(DW.getElementById('w1')), false);
sandbox.kbdMove(1, null, DW.body);
check('right hands focus to the first control in the row',
  sandbox.kbdOpenRow(null, DW.body), true);
check('and it really is that control',
  DW.activeElement.type, 'checkbox');
check('space still ticks it from the row', sandbox.kbdTickRow(null, DW.body), true);

// A row that DOES open something is still clicked, exactly as before.
const domO = new JSDOM(`<!doctype html><html><body><main class="main"><table class="t"><tbody>
  <tr id="o1" style="cursor: pointer"><td>SO/FY26/0001</td><td><input type="checkbox"></td></tr>
</tbody></table></main></body></html>`);
const DO = domO.window.document;
sandbox.document = DO;
sandbox.getComputedStyle = domO.window.getComputedStyle.bind(domO.window);
let rowOpened = 0;
DO.getElementById('o1').addEventListener('click', () => rowOpened++);
sandbox.kbdMove(1, null, DO.body);
check('a row that opens a record is clicked, not stepped into',
  sandbox.kbdRowOpens(DO.getElementById('o1')), true);
sandbox.kbdOpenRow(null, DO.body);
check('and its own handler ran', rowOpened, 1);
check('the checkbox inside it did NOT take focus instead',
  DO.activeElement === DO.getElementById('o1').querySelector('input'), false);

// Hand the document back to the one the sections below were written against.
sandbox.document = D;
sandbox.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

console.log('\n[8] moving, and stopping at the ends');
check('the first press lands on the first row', sandbox.kbdMove(1).id, 'r1');
check('the next moves down one', sandbox.kbdMove(1).id, 'r2');
check('and up one goes back', sandbox.kbdMove(-1).id, 'r1');
check('up at the top stays put — it does not wrap', sandbox.kbdMove(-1).id, 'r1');
check('a big jump clamps to the last row', sandbox.kbdMove(10).id, 'r3');
check('down at the bottom stays put', sandbox.kbdMove(1).id, 'r3');
check('Home goes to the first', sandbox.kbdJump('first').id, 'r1');
check('End goes to the last', sandbox.kbdJump('last').id, 'r3');
check('exactly one row is ever marked',
  D.querySelectorAll('[data-kbd-cursor]').length, 1);
sandbox.kbdClearCursor();
check('clearing leaves none', D.querySelectorAll('[data-kbd-cursor]').length, 0);
check('with the cursor gone, up starts at the LAST row', sandbox.kbdMove(-1).id, 'r3');

console.log('\n[9] the cursor survives a re-render');
// React rewrites className when a row re-renders. A highlight kept in a class
// would vanish mid-list; an attribute React never set is left alone.
sandbox.kbdJump('first');
D.getElementById('r1').className = 'selected';           // what React does on update
check('the mark is still on the row after className is rewritten',
  D.getElementById('r1').getAttribute('data-kbd-cursor'), '1');
check('and the engine still knows where it is', sandbox.kbdCurrentRow().id, 'r1');

console.log('\n[10] opening and ticking go through the screen own handlers');
let opened = 0, ticked = 0;
D.getElementById('r1').addEventListener('click', () => opened++);
D.getElementById('c1').addEventListener('click', () => ticked++);
sandbox.kbdJump('first');
check('Enter clicks the row, so its own handler runs', sandbox.kbdOpenRow(), true);
check('exactly once', opened, 1);
check('space clicks the checkbox on that row', sandbox.kbdTickRow(), true);
check('exactly once', ticked, 1);
sandbox.kbdJump('last');                                  // r3 has no checkbox
check('a row with no checkbox is left alone', sandbox.kbdTickRow(), false);
sandbox.kbdClearCursor();
check('with nothing selected, opening does nothing', sandbox.kbdOpenRow(), false);
check('and neither does ticking', sandbox.kbdTickRow(), false);

console.log('\n[10b] every clickable div is reachable by Tab');
// Half the controls in this app are a div with an onClick, invisible to Tab.
// They are found through the signal the app already uses for "you can click
// this" — the pointer cursor on the element ITSELF.
const dom4 = new JSDOM(`<!doctype html><html><body>
  <div class="app">
    <div class="tabs">
      <button class="tab active" id="t1">Overview</button>
      <button class="tab" id="t2">Line Items</button>
      <button class="tab" id="t3">Procurement</button>
    </div>
    <aside class="sidebar">
      <div class="nav-item" id="n1" tabindex="0" role="link">Dashboard</div>
      <div class="nav-item" id="n2" tabindex="0" role="link">Sales Orders</div>
    </aside>
    <main class="main">
      <div id="doc" class="pool-item" style="cursor: pointer">Tax Invoice</div>
      <span id="sono" class="mono" style="cursor: pointer">SO/FY26/0002</span>
      <div id="swatch" style="width: 32px; cursor: pointer"></div>
      <div id="off" style="cursor: default">a disabled chip</div>
      <div id="wrapper" style="cursor: pointer">a card <button id="inner-btn">Open</button></div>
      <div id="radio" class="radio-card"><div class="radio-card-marker"></div><strong>By sheet</strong></div>
      <div id="plain">just some text</div>
      <div class="queue-item" id="q1">a notification</div>
      <button id="realbtn">Edit items</button>
      <input id="field" type="text">
      <table class="t"><tbody>
        <tr id="row" style="cursor: pointer">
          <td id="cell"><div id="inner">an item name</div></td>
        </tr>
      </tbody></table>
    </main>
  </div>
</body></html>`);
const D4 = dom4.window.document;
sandbox.document = D4;
sandbox.getComputedStyle = dom4.window.getComputedStyle.bind(dom4.window);

check('a div with a pointer cursor is a control', sandbox.kbdIsClickable(D4.getElementById('doc')), true);
check('so is a span rendered as a link', sandbox.kbdIsClickable(D4.getElementById('sono')), true);
check('so is a colour swatch with no class at all', sandbox.kbdIsClickable(D4.getElementById('swatch')), true);
check('a known clickable class counts even with no inline style',
  sandbox.kbdIsClickable(D4.querySelector('.queue-item')), true);
check('a DISABLED control is left out — its cursor says default',
  sandbox.kbdIsClickable(D4.getElementById('off')), false);
check('plain text is not a control', sandbox.kbdIsClickable(D4.getElementById('plain')), false);
// Tab landing on a card and then again on the button inside it is the noise
// that made the tab order feel broken. The button is what somebody is aiming for.
check('a card that already holds a button is not a second tab stop',
  sandbox.kbdIsClickable(D4.getElementById('wrapper')), false);
check('but a card with only text inside it is',
  sandbox.kbdIsClickable(D4.getElementById('radio')), true);
check('a real button is already reachable, so it is left alone',
  sandbox.kbdIsClickable(D4.getElementById('realbtn')), false);
check('and so is a field', sandbox.kbdIsClickable(D4.getElementById('field')), false);
check('something already given a tabindex by hand is left alone',
  sandbox.kbdIsClickable(D4.getElementById('n1')), false);

// THE TRAP. cursor inherits, so every descendant of a clickable row computes as
// pointer. Read the computed style instead of the element's own and half the
// page lands in the tab order.
check('a row is not put in the tab order — the arrows drive rows',
  sandbox.kbdIsClickable(D4.getElementById('row')), false);
check('nor is a cell inside one', sandbox.kbdIsClickable(D4.getElementById('cell')), false);
check('nor a div inside a clickable row, which INHERITS the pointer cursor',
  sandbox.kbdIsClickable(D4.getElementById('inner')), false);
check('the inherited cursor really is pointer, so this is a live trap',
  dom4.window.getComputedStyle(D4.getElementById('inner')).cursor, 'pointer');

const added = sandbox.kbdEnhance();
// five clickable divs, plus the table of rows, which becomes one tab stop
check('the pass reaches the six that needed it', added, 6);
check('the card wrapping a button was left out of the tab order',
  D4.getElementById('wrapper').getAttribute('tabindex'), null);
check('while the button inside it is reachable as it always was',
  D4.getElementById('inner-btn').tagName, 'BUTTON');
check('the table became a list', D4.querySelector('table.t').getAttribute('data-kbd-list'), '1');
check('each got into the tab order',
  ['doc', 'sono', 'swatch', 'q1'].map(id => D4.getElementById(id).getAttribute('tabindex')),
  ['0', '0', '0', '0']);
check('and is announced as a button',
  D4.getElementById('doc').getAttribute('role'), 'button');
check('a second pass changes nothing — it is safe to run on every render',
  sandbox.kbdEnhance(), 0);
check('the disabled chip stayed out', D4.getElementById('off').getAttribute('tabindex'), null);
check('and so did the row', D4.getElementById('row').getAttribute('tabindex'), null);

let hits = 0;
D4.getElementById('doc').addEventListener('click', () => hits++);
check('Enter presses one', sandbox.kbdActivate(D4.getElementById('doc')), true);
check('exactly once', hits, 1);
check('a real button is NOT pressed by this path — it acts on Enter itself',
  sandbox.kbdActivate(D4.getElementById('realbtn')), false);
check('and neither is plain text', sandbox.kbdActivate(D4.getElementById('plain')), false);

console.log('\n[10c] the arrows move along tabs and down the sidebar');
check('a tab is in a horizontal group',
  (sandbox.kbdGroupOf(D4.getElementById('t1')) || {}).orientation, 'horizontal');
check('the sidebar is a vertical one',
  (sandbox.kbdGroupOf(D4.getElementById('n1')) || {}).orientation, 'vertical');
check('a document in the list is in neither',
  sandbox.kbdGroupOf(D4.getElementById('doc')), null);

let switched = 0;
D4.getElementById('t2').addEventListener('click', () => switched++);
const moved = sandbox.kbdGroupMove(D4.getElementById('t1'), 1);
check('right lands on the next tab', moved && moved.id, 't2');
check('and switches to it, because a tab only swaps a panel already on screen', switched, 1);
check('it stops at the last tab rather than wrapping',
  (sandbox.kbdGroupMove(D4.getElementById('t3'), 1) || {}).id, 't3');
check('and at the first going back',
  (sandbox.kbdGroupMove(D4.getElementById('t1'), -1) || {}).id, 't1');

let navigated = 0;
D4.getElementById('n2').addEventListener('click', () => navigated++);
const navMoved = sandbox.kbdGroupMove(D4.getElementById('n1'), 1);
check('down moves to the next sidebar link', navMoved && navMoved.id, 'n2');
check('but does NOT open it — an arrow key must never leave the page', navigated, 0);

console.log('\n[11] a dialog takes over the list keys');
const dom2 = new JSDOM(`<!doctype html><html><body>
  <main class="main"><table class="t"><tbody>
    <tr id="behind" style="cursor: pointer"><td>a row on the page behind</td></tr>
  </tbody></table></main>
  <div class="modal-backdrop"><div class="modal"><div class="modal-body">
    <table class="t"><tbody>
      <tr id="inm1" style="cursor: pointer"><td>a row in the dialog</td></tr>
      <tr id="inm2" style="cursor: pointer"><td>another</td></tr>
    </tbody></table>
  </div></div></div>
</body></html>`);
sandbox.document = dom2.window.document;
sandbox.getComputedStyle = dom2.window.getComputedStyle.bind(dom2.window);
check('the rows are the dialog rows, not the ones behind it',
  sandbox.kbdRows().map(r => r.id), ['inm1', 'inm2']);
check('so the page behind cannot be moved under an open dialog',
  sandbox.kbdRows().some(r => r.id === 'behind'), false);

console.log('\n[12] an empty screen is not a crash');
const dom3 = new JSDOM('<!doctype html><html><body><main class="main"><div>Nothing here yet</div></main></body></html>');
sandbox.document = dom3.window.document;
sandbox.getComputedStyle = dom3.window.getComputedStyle.bind(dom3.window);
check('no rows', sandbox.kbdRows(), []);
check('moving does nothing at all', sandbox.kbdMove(1), null);
check('so does jumping', sandbox.kbdJump('first'), null);
check('so does opening', sandbox.kbdOpenRow(), false);
check('and there is nothing under the cursor', sandbox.kbdCurrentRow(), null);

console.log('\n[13] the palette cannot get past a role');
sandbox.document = D;
const STATE = {
  sales_orders: [{ id: 'so1', so_no: 'SO/FY26/0001', customer_id: 'c1', status: 'Approved',
                   lines: [{ id: 'l1', bundle_qty: 1, unit_price: 100000, components: [] }], invoices: [] }],
  vendor_pos: [{ id: 'po1', po_no: 'PO202609001', vendor_id: 'v1', status: 'Sent' }],
  grns: [{ id: 'g1', grn_no: 'GRN/0001', status: 'Accepted' }],
  customers: [{ id: 'c1', name: 'ABG Shipyard', code: 'ABG' }],
  vendors: [{ id: 'v1', name: 'Ingram Micro', code: 'IM' }],
  products: [{ id: 'p1', name: 'Catalyst 9300', code: 'C9300' }],
  // Every collection the task builder reads. A missing one is not this
  // feature's bug, but it would stop the check before it asserted anything.
  transfer_requests: [], vendor_invoices: [], users: [], notifications: [],
  rfqs: [], sourcings: [], dismissed_writeoff: [], config: {}, audit: [],
};
const adminCmds = sandbox.kbdCommands(STATE, 'Org Admin', {});
check('an admin is offered screens', adminCmds.some(c => c.kind === 'screen'), true);
check('and records', adminCmds.some(c => c.kind === 'Sales order'), true);
check('a record carries the route that opens it',
  (adminCmds.find(c => c.kind === 'Sales order') || {}).route, 'sales-orders/so1');

// Whatever the sidebar hides, the palette must hide. Same list, same filter.
const ROLES = ['Org Admin', 'Purchase', 'Stores', 'Sales', 'Billing'];
const leaks = [];
ROLES.forEach(r => {
  const allowed = new Set([]);
  (sandbox.opcNavGroups(STATE, r) || []).forEach(g => (g.items || []).forEach(it => allowed.add(it.id)));
  sandbox.kbdCommands(STATE, r, {}).forEach(c => {
    const head = String(c.route).split('/')[0];
    if (!allowed.has(head)) leaks.push(r + ' -> ' + c.route);
  });
});
check('no role is offered anything its sidebar does not show', leaks, []);
check('every role gets a usable palette',
  ROLES.filter(r => sandbox.kbdCommands(STATE, r, {}).length === 0), []);

console.log('\n[14] the palette finds what you typed');
const items = [
  { kind: 'screen', label: 'Vendor POs', hint: 'Procurement', route: 'vendor-pos' },
  { kind: 'screen', label: 'Sales Orders', hint: 'Sales', route: 'sales-orders' },
  { kind: 'Sales order', label: 'SO/FY26/0001', hint: 'ABG Shipyard', route: 'sales-orders/so1' },
  { kind: 'Vendor PO', label: 'PO202609001', hint: 'Ingram Micro', route: 'vendor-pos/po1' },
];
check('an exact prefix wins', sandbox.kbdFilter(items, 'vendor')[0].label, 'Vendor POs');
check('a document number finds its record',
  sandbox.kbdFilter(items, 'PO2026')[0].label, 'PO202609001');
check('the customer name finds their order',
  sandbox.kbdFilter(items, 'abg')[0].label, 'SO/FY26/0001');
check('letters in order still match', sandbox.kbdFilter(items, 'vpo').length > 0, true);
check('nonsense matches nothing', sandbox.kbdFilter(items, 'zzqq'), []);
check('an empty box shows everything', sandbox.kbdFilter(items, '').length, items.length);
check('and whitespace is not a search', sandbox.kbdFilter(items, '   ').length, items.length);

console.log('\n[14b] no clickable is left behind');
// The pass finds controls by their pointer cursor. A new clickable div written
// without one would be invisible to it — and to the mouse user too, who gets no
// hand cursor. This walks the source and fails when one appears.
//
// These are the only ones that legitimately have no pointer: a click used to
// stop propagation, and a backdrop that exists to be clicked past. Neither is
// something to focus.
// A JSX opening tag cannot be matched with a regex: onClick={e => ...} holds a
// ">" that does not end it. Walk from "<" to the ">" at brace depth zero.
const tagAt = (src, i) => {
  let depth = 0, quote = null;
  for (let c = i; c < src.length; c++) {
    const ch = src[c];
    if (quote) { if (ch === quote && src[c - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return src.slice(i, c + 1);
  }
  return src.slice(i, i + 400);
};

// These legitimately have no pointer, and none of them is something to focus:
// a click that only stops propagation, and a backdrop that exists to be clicked
// past (Escape closes those too).
const NOT_CONTROLS = /stopPropagation|modal-backdrop|position: 'fixed', inset: 0/;
const POINTER_CLASSES = ['nav-item', 'queue-item', 'radio-card', 'toggle', 'kbd-palette-row'];
const uncovered = [];
fs.readdirSync(path.join(dir, 'src')).filter(f => f.endsWith('.jsx')).forEach(f => {
  const src = fs.readFileSync(path.join(dir, 'src', f), 'utf8');
  const re = /<(div|span|li|section|article)\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const tag = tagAt(src, m.index);
    if (!/\bonClick\b/.test(tag)) continue;                 // not clickable
    if (NOT_CONTROLS.test(tag)) continue;                    // not a control
    if (/cursor:\s*[^,;}]*pointer/.test(tag)) continue;       // carries the signal
    if (/\.\.\.clk\b/.test(tag)) continue;                   // shared pointer style
    if (POINTER_CLASSES.some(c => tag.includes(c))) continue; // a known clickable class
    if (/tabIndex=/.test(tag)) continue;                     // placed by hand
    uncovered.push(f + ': ' + tag.replace(/\s+/g, ' ').slice(0, 70));
  }
});
check('the tag walker sees past the ">" inside an arrow function',
  /cursor/.test(tagAt('<div onClick={e => go(e)} style={{ cursor: "pointer" }}>x', 0)), true);
check('every clickable element carries a pointer cursor, so the pass finds it',
  uncovered, []);

const kb = fs.readFileSync(path.join(dir, 'src', 'keyboard.jsx'), 'utf8');
check('the pass reads the element own style, never the computed one',
  /getComputedStyle/.test(kb.slice(kb.indexOf('function kbdIsClickable'),
                                  kb.indexOf('function kbdEnhance'))), false);
check('the observer watches children only, so its own attributes cannot re-trigger it',
  /childList: true, subtree: true/.test(kb) && !/attributes: true/.test(kb), true);

console.log('\n[15] it is actually wired in');
const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
check('keyboard.jsx is loaded by the page', /src\/keyboard\.jsx/.test(idx), true);
check('and before app.jsx, which mounts it',
  idx.indexOf('src/keyboard.jsx') < idx.indexOf('src/app.jsx'), true);
const appJsx = fs.readFileSync(path.join(dir, 'src', 'app.jsx'), 'utf8');
check('the layer is mounted in the shell', /<KeyboardLayer\s*\/>/.test(appJsx), true);
const utilsJsx = fs.readFileSync(path.join(dir, 'src', 'utils.jsx'), 'utf8');
check('dialogs trap Tab', /e\.key !== 'Tab'/.test(utilsJsx), true);
check('dialogs give focus back when they close', /openerRef/.test(utilsJsx), true);
check('and only the top dialog answers Escape', /opcOverlayTop/.test(utilsJsx), true);
// Escape has to work wherever focus is. On the dialog element it would only
// work while focus happened to be inside it.
check('Escape is heard on the window, not just inside the dialog',
  /window\.addEventListener\('keydown', onEsc\)/.test(utilsJsx), true);
check('and it is taken off again when the dialog closes',
  /window\.removeEventListener\('keydown', onEsc\)/.test(utilsJsx), true);
check('the handler is read through a ref, so the stack order holds',
  /onCloseRef/.test(utilsJsx), true);
const shellJsx = fs.readFileSync(path.join(dir, 'src', 'shell.jsx'), 'utf8');
check('the sidebar is ONE tab stop, held by the screen you are on',
  /tabIndex=\{holdsStop \? 0 : -1\}/.test(shellJsx), true);
check('and it still has a way in when no link matches the route',
  /!anyActive && gi === 0 && ii === 0/.test(shellJsx), true);
check('and opened with Enter', /onKeyDown/.test(shellJsx), true);
check('the sidebar and the palette read ONE nav list',
  /window\.opcNavGroups = opcNavGroups/.test(shellJsx), true);
// The notifications drawer is the one overlay that is not a Modal, so it has to
// say for itself what every dialog does.
check('the drawer closes on Escape, and only when it is the top one',
  /opcOverlayTop\(\) !== idRef\.current/.test(shellJsx), true);
check('it takes focus when it opens and gives it back when it closes',
  /openerRef/.test(shellJsx), true);
check('and Tab stays inside it', /e\.key !== 'Tab'/.test(shellJsx), true);
check('a drawer counts as a dialog, so nothing behind it moves',
  /querySelector\('\.modal, \.drawer'\)/.test(
    fs.readFileSync(path.join(dir, 'src', 'keyboard.jsx'), 'utf8')), true);
const css = fs.readFileSync(path.join(dir, 'src', 'styles.css'), 'utf8');
check('the selected row is visible',
  /tbody tr\[data-kbd-cursor\]/.test(css), true);
// A single accent ring is invisible on a primary button, which is accent
// coloured itself. The ring is two: a gap in the page colour, then the accent.
check('the focus ring shows on a coloured button too',
  /box-shadow: 0 0 0 2px var\(--surface\), 0 0 0 4px var\(--accent\)/.test(css), true);
check('and a list says when it has focus',
  /\[data-kbd-list\]:focus-visible/.test(css), true);
check('holding Alt shows the letters, or nobody can learn them',
  /body\.kbd-alt \[data-kbd-key\]::after/.test(css), true);
check('and the badge is the letter itself', /content: attr\(data-kbd-key\)/.test(css), true);
check('a shadowed screen looks different from a live one',
  /\[data-kbd-shadowed\]::after/.test(css), true);
check('the sidebar carries each screen id, which the letters key off',
  /data-nav=\{it\.id\}/.test(shellJsx), true);
const kbSrc = fs.readFileSync(path.join(dir, 'src', 'keyboard.jsx'), 'utf8');
check('nothing in the keyboard layer touches history any more',
  /history\.back|history\.forward|history\.go/.test(kbSrc), false);
check('the tab keys are on the shortcut sheet, or nobody will find them',
  /\] \/ \[/.test(kbSrc) && /1 \u2026 9|1 … 9/.test(kbSrc), true);
check('and so is whatever has focus', /:focus-visible/.test(css), true);

// ---------------------------------------------------------------------------
// [16] A REAL dialog, mounted, with its effects running.
// ---------------------------------------------------------------------------
// Everything above this line is logic. render-check renders every screen but
// renders them on the SERVER, where no effect ever runs — so the focus trap,
// the focus restore and the Escape listener are invisible to it. They live on
// every dialog on every screen, so they are mounted here for real and driven by
// keyboard, in a browser-shaped DOM.
(async () => {
  console.log('\n[16] a real dialog, driven by keyboard');

  // The DOM globals have to exist BEFORE react-dom is required: it decides once,
  // at load, whether it is running in a browser. Require it first and it decides
  // it is not, falls back to an IE-era polyfill, and throws on the first focus —
  // noise that would hide a real failure underneath it.
  // jsdom catches whatever is thrown inside an event listener and reports it to
  // its virtual console — no process-level handler ever sees it. Without this,
  // a crash inside a keystroke prints a stack and the run still says PASS.
  const vc = new (require('jsdom').VirtualConsole)();
  let expectingThrow = false;
  vc.on('jsdomError', (err) => {
    if (expectingThrow) { expectingThrow = 'seen'; return; }   // the trap testing itself
    bad++;
    console.log('  X  a keystroke threw: ' + (err && err.message));
  });
  vc.on('error', (msg) => { bad++; console.log('  X  ' + msg); });

  const live = new JSDOM(
    '<!doctype html><html><body><div id="root"></div><button id="opener">open</button></body></html>',
    { pretendToBeVisual: true, virtualConsole: vc });
  const w = live.window;
  global.window = w; global.document = w.document; global.navigator = w.navigator;
  global.HTMLElement = w.HTMLElement; global.Element = w.Element; global.Node = w.Node;
  global.getComputedStyle = w.getComputedStyle.bind(w);
  global.requestAnimationFrame = cb => setTimeout(cb, 0);
  global.cancelAnimationFrame = clearTimeout;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  let ReactDOMClient, act;
  try { ReactDOMClient = require('react-dom/client'); act = require('react').act; }
  catch (e) { ReactDOMClient = null; }

  if (!ReactDOMClient || typeof act !== 'function') {
    console.log('  --  skipped: needs react-dom 18.3+ (npm i --no-save react-dom@18.3.1)');
  } else {

    // The same two files the browser loads, in a scope shaped like the browser's.
    w.React = React; w.useEffect = React.useEffect; w.useState = React.useState;
    w.OPC_ENV = { APP_BASE_DOMAIN: 'x' }; w.console = { log() {}, warn() {}, error() {} };
    vm.createContext(w);
    ['src/keyboard.jsx', 'src/utils.jsx'].forEach(f => {
      try {
        vm.runInContext(Babel.transform(fs.readFileSync(path.join(dir, f), 'utf8'),
          { presets: ['react'], filename: f }).code, w, { filename: f });
      } catch (e) { /* a screen helper it cannot see here — Modal itself still loads */ }
    });

    const Modal = w.Modal;
    const h = React.createElement;
    if (typeof Modal !== 'function') {
      check('the Modal component loaded', typeof Modal, 'function');
    } else {
      const root = ReactDOMClient.createRoot(w.document.getElementById('root'));
      let closes = 0;

      w.document.getElementById('opener').focus();
      check('focus starts on whatever opened it', w.document.activeElement.id, 'opener');

      act(() => {
        root.render(h(Modal, { title: 'Receive items', onClose: () => closes++,
          footer: h('button', { className: 'btn btn-primary' }, 'Confirm') },
          h('input', { className: 'input', id: 'qty', type: 'number' }),
          h('input', { className: 'input', id: 'note', type: 'text' })));
      });
      await new Promise(r => setTimeout(r, 20));
      act(() => { w.document.body.offsetHeight; });

      check('it rendered', !!w.document.querySelector('.modal'), true);
      check('the first field took focus, so typing starts straight away',
        w.document.activeElement && w.document.activeElement.id, 'qty');
      check('a checkbox is never what gets focused',
        (w.document.activeElement.type || ''), 'number');
      check('it is on the overlay stack', w.opcOverlayTop() != null, true);

      act(() => { w.document.activeElement.dispatchEvent(
        new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      check('Escape from inside a field closes it', closes, 1);

      // The case that breaks when Escape listens on the dialog instead of the
      // window: focus is somewhere else entirely and the key never arrives.
      closes = 0;
      w.document.body.focus();
      act(() => { w.document.body.dispatchEvent(
        new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      check('and Escape from OUTSIDE it closes it too', closes, 1);

      act(() => { root.unmount(); });
      await new Promise(r => setTimeout(r, 10));
      check('closing takes it off the stack', w.opcOverlayTop(), null);
      check('and puts focus back where it came from', w.document.activeElement.id, 'opener');

      // ---- Enter walks the form ----------------------------------------
      // Filling a dialog is the slowest thing anybody does in here, and
      // reaching for Tab between every field is why.
      let saved = 0;
      // The first dialog was unmounted above; this needs a root of its own.
      const root2 = ReactDOMClient.createRoot(w.document.getElementById('root'));
      act(() => {
        root2.render(h(Modal, { title: 'Receive items', onClose: () => closes++,
          footer: h('button', { className: 'btn btn-primary', onClick: () => saved++ }, 'Confirm') },
          h('input', { className: 'input', id: 'f1', type: 'number' }),
          h('input', { className: 'input', id: 'f2', type: 'text' }),
          h('textarea', { className: 'textarea', id: 'f3' }),
          h('input', { className: 'input', id: 'f4', type: 'text', 'data-kbd-enter': 'ignore' })));
      });
      await new Promise(r => setTimeout(r, 20));
      act(() => { w.document.body.offsetHeight; });

      const press = (key, extra) => act(() => {
        w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',
          Object.assign({ key, bubbles: true }, extra || {})));
      });

      check('the first field has focus', w.document.activeElement.id, 'f1');
      press('Enter');
      check('Enter moves to the next field', w.document.activeElement.id, 'f2');
      press('Enter');
      check('and on to the one after', w.document.activeElement.id, 'f3');
      check('nothing was submitted on the way', saved, 0);

      // A textarea needs its Enter for a newline.
      press('Enter');
      check('Enter in a textarea is left alone', w.document.activeElement.id, 'f3');

      // A field can opt out, and the last one does the thing the dialog is for.
      w.document.getElementById('f4').focus();
      press('Enter');
      check('a field marked to ignore Enter keeps it', saved, 0);
      check('and focus stays put', w.document.activeElement.id, 'f4');

      // Ctrl+Enter belongs to the KeyboardLayer, which is not mounted here.
      // Deliberately ONE owner: if the dialog pressed the button as well, a
      // single Ctrl+Enter would submit twice.
      saved = 0;
      w.document.getElementById('f2').focus();
      press('Enter', { ctrlKey: true });
      check('the dialog leaves Ctrl+Enter to the one thing that owns it', saved, 0);
      check('and that thing routes it to the primary button',
        act2('Enter', { typing: true }, { ctrlKey: true }), 'primary');

      closes = 0;
      act(() => { root2.unmount(); });
      await new Promise(r => setTimeout(r, 10));
      w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      check('a closed dialog no longer listens for anything', closes, 0);

      // The trap above only means something if it fires. Throw on purpose and
      // confirm it was counted, then take the count back off.
      expectingThrow = true;
      const boom = () => { throw new Error('deliberate'); };
      w.document.body.addEventListener('click', boom);
      w.document.body.dispatchEvent(new w.window.Event('click', { bubbles: true }));
      w.document.body.removeEventListener('click', boom);
      const caught = expectingThrow === 'seen';
      expectingThrow = false;
      check('and a crash inside a keystroke would be caught, not printed and passed',
        caught, true);
    }
  }

  console.log(bad ? `\nFAILED - ${bad} check(s)` : '\nPASS - the whole app runs from the keyboard, and stays out of the way while typing');
  process.exit(bad ? 1 : 0);
})();
