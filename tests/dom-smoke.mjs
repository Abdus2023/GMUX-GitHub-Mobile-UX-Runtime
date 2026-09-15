#!/usr/bin/env node
/**
 * GMUX DOM smoke test — boots the userscript against a minimal fake DOM.
 *
 * Dependency-free: node tests/dom-smoke.mjs
 *
 * Evidence provided (v0.1 contract):
 *   G0/G1  script loads with no uncaught exception on an empty page;
 *   G2/G3  host detection + mobile classification (pure kernel, via hook);
 *   G4     exactly one shell root, one toolbar, one stylesheet;
 *   I-13   every userscript-created element carries data-gmux-owner;
 *   G12    Android Back history layering opens/closes a modal and otherwise
 *          falls through (ALLOW_BROWSER_DEFAULT);
 *   G15    repeated reconciliation converges — no duplicates;
 *   §21    SHELL_DUPLICATION is emitted and reconciled back to one root;
 *   G17    corrupt preferences do not prevent startup;
 *   §6     disable / re-enable without reload stays idempotent.
 *
 * Live github.dev interaction still requires the manual matrix
 * (VERIFICATION_REPORT.md); this harness makes no such claim.
 */

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------------ fake DOM --------------------------------- */

const ids = new Map();
let monacoWorkbenchEl = null;

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {
      cssText: '',
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
    };
    const classes = new Set();
    this.classList = {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)),
    };
    this.textContent = '';
    this.id = '';
    this._listeners = [];
    Object.defineProperty(this, 'className', {
      get: () => Array.from(classes).join(' '),
      set: (v) => { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    if (child.id) ids.set(child.id, child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    if (child.id && ids.get(child.id) === child) ids.delete(child.id);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) { this._listeners.push([type, fn]); }
  removeEventListener(type, fn) { this._listeners = this._listeners.filter(([t, f]) => !(t === type && f === fn)); }
  dispatchEvent() { return true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  matches() { return false; }
  closest() { return null; }
  contains(o) { return o === this; }
  focus() {}
  getClientRects() { return []; }
  get offsetHeight() { return 0; }
  get offsetWidth() { return 0; }
}

function walk(el, fn) {
  fn(el);
  el.children.slice().forEach((c) => walk(c, fn));
}
function findAll(el, pred, acc = []) {
  if (pred(el)) acc.push(el);
  el.children.forEach((c) => findAll(c, pred, acc));
  return acc;
}
function hasClass(el, cls) { return !!(el && el.classList && el.classList.contains(cls)); }

const body = new FakeElement('body');
const head = new FakeElement('head');
const documentElement = new FakeElement('html');

function scanSelector(root, sel) {
  const out = [];
  walk(root, (el) => {
    if (sel.startsWith('#')) { if (el.id === sel.slice(1)) out.push(el); }
    else if (sel.startsWith('.')) { if (hasClass(el, sel.slice(1))) out.push(el); }
  });
  return out;
}

const document = {
  readyState: 'complete',
  body, head, documentElement,
  createElement: (tag) => new FakeElement(tag),
  getElementById: (id) => ids.get(id) || null,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: (sel) => {
    if (sel === '.monaco-workbench') return monacoWorkbenchEl;
    if (sel === '.gmux-revive') { const r = scanSelector(body, '.gmux-revive'); return r[0] || null; }
    if (sel && sel.startsWith('#')) return ids.get(sel.slice(1)) || null;
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === '#github-mobile-ux') return scanSelector(body, '#github-mobile-ux');
    if (sel && sel.startsWith('.')) return scanSelector(body, sel);
    return [];
  },
};

const storageMap = new Map();
const listeners = [];
const historyStates = [];
const window = {
  innerWidth: 412,
  innerHeight: 732,
  visualViewport: null, // exercises VIEWPORT_UNAVAILABLE fallback path
  localStorage: {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  },
  history: {
    pushState(s) { historyStates.push(s); },
    replaceState(s) { if (historyStates.length) historyStates[historyStates.length - 1] = s; else historyStates.push(s); },
    back() { /* popstate is driven explicitly by the test */ },
  },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  addEventListener: (type, fn, opts) => listeners.push([type, fn, opts]),
  removeEventListener: (type, fn) => {
    const i = listeners.findIndex(([t, f]) => t === type && f === fn);
    if (i !== -1) listeners.splice(i, 1);
  },
  dispatchEvent: () => true,
  pop(type, ev) { listeners.filter(([t]) => t === type).forEach(([, f]) => f(ev)); },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  KeyboardEvent: class FakeKeyboardEvent { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
  MutationObserver: class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  },
};
const fakeLocation = { hostname: 'github.dev', pathname: '/o/r', href: 'https://github.dev/o/r' };
window.location = fakeLocation;
window.window = window;
const observers = [];

globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, 'navigator', {
  value: { platform: '', userAgent: 'gmux-smoke/node' }, configurable: true,
});
Object.defineProperty(globalThis, 'location', { value: fakeLocation, configurable: true });
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MutationObserver = window.MutationObserver;

/* ------------------------------ boot ------------------------------------- */

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const K = require('../github-dev-mobile.user.js'); // boot runs on import (readyState=complete)

await new Promise((r) => setTimeout(r, 30));

check('dev hook exposed', !!window.__GMUX__);
check('version 0.1.0', window.__GMUX__ && window.__GMUX__.version === '0.1.0');
check('feature flags frozen into hook', window.__GMUX__.features && window.__GMUX__.features.gestures === false &&
  window.__GMUX__.features.terminalSurface === false && window.__GMUX__.features.androidBack === true);

// Host detection is DOM-independent (§7).
check('G2 detectTarget supports github.dev', K.detectTarget({ hostname: 'github.dev', pathname: '/x' }) === 'SUPPORTED_TARGET');
check('G2 detectTarget rejects arbitrary site', K.detectTarget({ hostname: 'evil.example', pathname: '/' }) === 'UNSUPPORTED_TARGET');
check('G3 412px classifies mobile', K.modeForWidth(412) === 'mobile');

const st0 = window.__GMUX__.state();
check('parks WAITING_FOR_APP with no workbench', st0 && st0.lifecycle === 'WAITING_FOR_APP');
check('no shell before app detection', document.getElementById('github-mobile-ux') === null);
check('diagnostics available while waiting', String(window.__GMUX__.diagnostics()).includes('GitHub.dev Mobile UX'));

/* ---------------------- dynamic app render (G4) -------------------------- */

monacoWorkbenchEl = new FakeElement('div');
monacoWorkbenchEl.classList.add('monaco-workbench');
observers.filter((o) => !o.disconnected).forEach((o) => o.cb && o.cb([]));
await new Promise((r) => setTimeout(r, 40));

const st1 = window.__GMUX__.state();
check('bare workbench -> DEGRADED (no false editor claim)', st1 && st1.lifecycle === 'DEGRADED');
const root = document.getElementById('github-mobile-ux');
check('shell mounted with contract id', root && root.id === 'github-mobile-ux');
check('shell root ownership marker (§19/§20)', root && root.getAttribute('data-gmux-owner') === 'github-dev-mobile');
check('scoped stylesheet installed once', !!document.getElementById('gmux-style'));

// Every userscript-created node under the root must be ownership-marked (I-13).
let unowned = 0;
walk(root, (n) => { if (n.getAttribute('data-gmux-owner') !== 'github-dev-mobile') unowned++; });
check('all shell elements carry data-gmux-owner', unowned === 0, `${unowned} unowned nodes`);
// Stylesheet node is owned too.
check('stylesheet element carries ownership marker', document.getElementById('gmux-style').getAttribute('data-gmux-owner') === 'github-dev-mobile');

const toolbars = findAll(root, (n) => hasClass(n, 'gmux-toolbar'));
check('exactly one toolbar', toolbars.length === 1);
const toolbarButtons = toolbars[0] ? toolbars[0].children.filter((n) => n.tagName === 'BUTTON') : [];
check('five command-bar buttons', toolbarButtons.length === 5);
const termBtn = toolbarButtons.find((b) => b.getAttribute('data-surface') === 'terminal');
check('terminal control disabled by default (§17)', termBtn && termBtn.getAttribute('aria-disabled') === 'true');

/* --------------------- reconciliation idempotence (G15) ------------------ */

for (let i = 0; i < 10; i++) { window.__GMUX__.poke ? window.__GMUX__.poke('smoke') : null; await new Promise((r) => setTimeout(r, 5)); }
const rootsAfter = document.querySelectorAll('#github-mobile-ux');
const toolbarsAfter = findAll(root, (n) => hasClass(n, 'gmux-toolbar'));
check('G15 one shell after 10 reconciliations', rootsAfter.length === 1, `roots=${rootsAfter.length}`);
check('G15 one toolbar after 10 reconciliations', toolbarsAfter.length === 1);
check('G15 no duplicate buttons', findAll(root, (n) => n.getAttribute && n.getAttribute('data-surface') === 'explorer').length === 1);
const stAfter = window.__GMUX__.state();
check('G15 reconciliation counter advanced', stAfter.diagnostics.reconciliationCount >= 10);

/* -------------------- SHELL_DUPLICATION converges (§21) ------------------ */

const rogue = new FakeElement('div');
rogue.id = 'github-mobile-ux';
rogue.setAttribute('data-gmux-owner', 'github-dev-mobile');
body.appendChild(rogue);
window.__GMUX__.poke('duplication-test');
await new Promise((r) => setTimeout(r, 20));
check('duplicate shell reconciled to exactly one', document.querySelectorAll('#github-mobile-ux').length === 1);
check('SHELL_DUPLICATION observable in diagnostics', String(window.__GMUX__.diagnostics()).includes('SHELL_DUPLICATION'));

/* ----------------------- Android Back layering (G12) --------------------- */

// Open a GMUX modal surface: a history entry must be pushed (never a trap).
window.__GMUX__.dispatch({ type: 'OPEN_SETTINGS' });
await new Promise((r) => setTimeout(r, 20));
check('opening modal pushes an owned history entry', historyStates.some((s) => s && s.gmux === true && s.kind === 'modal'));
check('modal DOM present', findAll(root, (n) => hasClass(n, 'gmux-surface')).length === 1);
let modalOwned = 0;
findAll(root, (n) => hasClass(n, 'gmux-surface-backdrop')).forEach((bd) => walk(bd, (n) => { if (n.getAttribute('data-gmux-owner') !== 'github-dev-mobile') modalOwned++; }));
check('modal elements ownership-marked', modalOwned === 0);

// Hardware Back (popstate with our marker) closes the modal.
window.pop('popstate', { state: { gmux: true, kind: 'modal' } });
await new Promise((r) => setTimeout(r, 20));
check('G12 back closes modal', findAll(root, (n) => hasClass(n, 'gmux-surface')).length === 0);

// Back at the editor with nothing owned -> ALLOW_BROWSER_DEFAULT (no throw,
// no owned UI consumed, no trap).
window.pop('popstate', { state: null });
await new Promise((r) => setTimeout(r, 10));
check('G12 unowned back falls through (editor untouched)',
  window.__GMUX__.state().activeSurface === 'editor' &&
  findAll(root, (n) => hasClass(n, 'gmux-surface')).length === 0);

/* ---------------------- preferences (G16/G17) ---------------------------- */

// G16: a preference change persists across disable/enable (same storage).
window.__GMUX__.dispatch({ type: 'TOGGLE_PREF', key: 'immersive', value: false });
await new Promise((r) => setTimeout(r, 10));
let stored = JSON.parse(storageMap.get('gmux:prefs:v1'));
check('G16 preference persisted', stored && stored.immersive === false);

// G17: corrupt storage must not prevent startup.
storageMap.set('gmux:prefs:v1', '{corrupt-json');
window.__GMUX__.disable();
await new Promise((r) => setTimeout(r, 10));
check('revive chip mounted on disable', !!document.querySelector('.gmux-revive'));
check('revive chip ownership-marked', document.querySelector('.gmux-revive').getAttribute('data-gmux-owner') === 'github-dev-mobile');
window.__GMUX__.enable();
await new Promise((r) => setTimeout(r, 30));
let booted = false;
try { booted = !!window.__GMUX__.state(); } catch (e) { booted = false; }
check('G17 boots despite corrupt preferences', booted);
check('G17 PREFERENCE_PARSE_FAILED reported', String(window.__GMUX__.diagnostics()).includes('PREFERENCE_PARSE_FAILED'));
// Corrupt value is never rewritten until the next valid preference write;
// the report shows the default posture (immersive ON) despite bad storage.
check('G17 default posture after corrupt storage', /Immersive: ON/.test(String(window.__GMUX__.diagnostics())));
void stored;

/* --------------------------- unsupported host ---------------------------- */
check('adapter id is github-dev', window.__GMUX__.adapterId === 'github-dev');
check('terminal honestly reported in diagnostics', /Terminal: (NOT_DETECTED|UNKNOWN)/.test(String(window.__GMUX__.diagnostics())));

/* ------------------------------- summary --------------------------------- */
console.log(`\ndom-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
