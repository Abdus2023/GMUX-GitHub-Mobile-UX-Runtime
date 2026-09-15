#!/usr/bin/env node
/**
 * GMUX DOM smoke test — boots the userscript against a minimal fake DOM.
 *
 * Dependency-free: node tests/dom-smoke.mjs
 *
 * What it proves (spec §32 lifecycle, §39 reversibility):
 *   - bootstrap completes without a workbench and parks in WAITING_FOR_APP
 *     (no crash, no polling);
 *   - the shell can be disabled and re-enabled without a page reload;
 *   - the disabled flag persists; the revive affordance mounts.
 * Live github.dev behavior still requires the manual matrix
 * (docs/verification.md) — this smoke test does not claim it.
 */

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL ${name}`); }
}

/* ------------------------------ fake DOM ---------------------------------- */

const elementsByClass = new Set();
const ids = new Map();
let monacoWorkbenchEl = null; // injected later to simulate app render

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
      add: (...cs) => { cs.forEach((c) => classes.add(c)); elementsByClass.add(this); },
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)),
      get size() { return classes.size; },
    };
    this.textContent = '';
    this.id = '';
    this._listeners = [];
    Object.defineProperty(this, 'className', {
      get: () => Array.from(classes).join(' '),
      set: (v) => {
        classes.clear();
        String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
        elementsByClass.add(this);
      },
    });
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }
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
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) { this._listeners.push([type, fn]); }
  removeEventListener(type, fn) {
    this._listeners = this._listeners.filter(([t, f]) => !(t === type && f === fn));
  }
  dispatchEvent() { return true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  matches() { return false; }
  closest() { return null; }
  contains() { return false; }
  focus() {}
  getClientRects() { return []; }
  get offsetHeight() { return 0; }
  get offsetWidth() { return 0; }
}

function hasClass(el, cls) {
  try { return el && el.classList && el.classList.contains(cls); } catch (e) { return false; }
}

const body = new FakeElement('body');
const head = new FakeElement('head');
const documentElement = new FakeElement('html');

const document = {
  readyState: 'complete',
  body, head, documentElement,
  createElement: (tag) => new FakeElement(tag),
  getElementById: (id) => ids.get(id) || null,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: (sel) => {
    if (sel === '.gdmux-revive') {
      for (const c of body.children) if (hasClass(c, 'gdmux-revive')) return c;
      return null;
    }
    // Adapter probe: the workbench appears once the test injects it.
    if (sel === '.monaco-workbench') return monacoWorkbenchEl;
    if (sel && sel.startsWith('#')) return ids.get(sel.slice(1)) || null;
    return null;
  },
  querySelectorAll: () => [],
};

const storageMap = new Map();
const window = {
  innerWidth: 412,
  innerHeight: 732,
  visualViewport: null, // exercises the VIEWPORT_API_UNAVAILABLE fallback
  localStorage: {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(k, String(v)); },
    removeItem: (k) => { storageMap.delete(k); },
  },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  KeyboardEvent: class FakeKeyboardEvent {
    constructor(type, init) { this.type = type; Object.assign(this, init || {}); }
  },
  MutationObserver: class FakeMutationObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  },
};
window.window = window;
const observers = [];

globalThis.window = window;
globalThis.document = document;
// Node 22 exposes a read-only global navigator — override via defineProperty.
Object.defineProperty(globalThis, 'navigator', {
  value: { platform: '', userAgent: 'gmux-smoke/node' }, configurable: true,
});
Object.defineProperty(globalThis, 'location', {
  value: { hostname: 'github.dev' }, configurable: true,
});
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MutationObserver = window.MutationObserver;

/* ------------------------------ boot -------------------------------------- */

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
require('../github-dev-mobile.user.js'); // boot runs on import (readyState=complete)

await new Promise((r) => setTimeout(r, 30)); // let rAF-scheduled work settle

check('dev hook exposed', !!window.__GDMUX__);
check('version matches metadata', window.__GDMUX__ && window.__GDMUX__.version === '0.1.0');
const st0 = window.__GDMUX__.state();
check('state readable', !!st0);
check('parks in WAITING_FOR_APP without a workbench (no crash)',
  st0 && st0.lifecycle === 'WAITING_FOR_APP');
check('no shell chrome mounted before app detection', document.getElementById('gdmux-root') === null);
check('diagnostics report available while waiting',
  typeof window.__GDMUX__.diagnostics() === 'string' &&
  window.__GDMUX__.diagnostics().includes('GitHub.dev Mobile UX'));

/* ------------------------- disable / re-enable ---------------------------- */

window.__GDMUX__.disable();
check('disabled flag persisted', storageMap.get('gdmux:disabled') === '1');
check('revive affordance mounted', !!document.querySelector('.gdmux-revive'));

window.__GDMUX__.enable();
check('disabled flag cleared', storageMap.get('gdmux:disabled') == null);
check('revive affordance removed', document.querySelector('.gdmux-revive') === null);
const st1 = window.__GDMUX__.state();
check('re-enabled session parks again without reload',
  st1 && st1.lifecycle === 'WAITING_FOR_APP');

/* ------------------- workbench appears (dynamic load) ---------------------- */
// Simulate the VS Code workbench rendering after the userscript booted:
// the boot observer must move the lifecycle forward and mount the shell.

monacoWorkbenchEl = new FakeElement('div');
monacoWorkbenchEl.classList.add('monaco-workbench');
observers.filter((o) => !o.disconnected).forEach((o) => o.cb && o.cb([]));
await new Promise((r) => setTimeout(r, 30));

const st2 = window.__GDMUX__.state();
check('workbench appearance detected (no reload)',
  st2 && (st2.lifecycle === 'ACTIVE' || st2.lifecycle === 'DEGRADED'));
check('shell mounted after app detection', !!document.getElementById('gdmux-root'));
check('scoped stylesheet installed', !!document.getElementById('gdmux-style'));
check('editor not detected in bare workbench -> degraded, not falsely claimed',
  st2.lifecycle === 'DEGRADED');
check('diagnostics reflect detected adapter',
  window.__GDMUX__.diagnostics().includes('Adapter: github-dev'));

// Idempotency (spec §32): re-triggering observers must not re-initialize.
const rootsBefore = body.children.filter((c) => c.id === 'gdmux-root').length;
observers.filter((o) => !o.disconnected).forEach((o) => o.cb && o.cb([]));
await new Promise((r) => setTimeout(r, 20));
const rootsAfter = body.children.filter((c) => c.id === 'gdmux-root').length;
check('initialization is idempotent (no duplicate shells)', rootsBefore === 1 && rootsAfter === 1);

/* ------------------------------ summary ----------------------------------- */
console.log(`\ndom-smoke: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
