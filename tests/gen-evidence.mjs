#!/usr/bin/env node
/**
 * GMUX evidence generator — writes the OPTIONAL inspection-first evidence
 * set (evidence/reconnaissance.json, evidence/selector-registry.json,
 * evidence/mutation-results.json) from deterministic stub-DOM runs.
 *
 * Dependency-free: node tests/gen-evidence.mjs
 *
 * Provenance is stamped into every file: stub workbench runs mirroring
 * fixtures/*.html. Stub evidence is NOT live-host VALIDATED — see
 * VERIFICATION_REPORT.md. Regenerate after any adapter change.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* ------------------------- miniature DOM ------------------------------- */
let body = null;
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1; this.children = []; this.parentNode = null;
    this.attrs = new Map(); this.classes = new Set(); this.hidden = false;
    this.style = {}; this.onClick = null; this.textContent = '';
  }
  setAttribute(n, v) { this.attrs.set(n, String(v)); if (n === 'class') this.className = String(v); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  get id() { return this.attrs.get('id') || ''; }
  set id(v) { this.attrs.set('id', v); }
  get className() { return Array.from(this.classes).join(' '); }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const c = this.classes;
    return { add: (...xs) => xs.forEach((x) => c.add(x)), remove: (...xs) => xs.forEach((x) => c.delete(x)), contains: (x) => c.has(x) };
  }
  append(c) { if (c.parentNode) c.parentNode.remove(c); c.parentNode = this; this.children.push(c); return c; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  appendChild(c) { return this.append(c); }
  removeChild(c) { return this.remove(c); }
  click() { if (this.onClick) this.onClick(); }
  focus() {}
  contains(o) { return o === this || this.querySelectorAll('*').includes(o); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  matches(sel) { try { return matchSegment(this, parseSegment(sel)); } catch (e) { return false; } }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    if (sel === '*') return all(this);
    const out = [];
    for (const g of sel.split(',').map((s) => s.trim()).filter(Boolean)) {
      const segs = g.split(/\s+/).map(parseSegment);
      walk(this, (el) => { if (el !== this && matchPath(el, segs)) out.push(el); });
    }
    return Array.from(new Set(out));
  }
}
function all(r, a = []) { r.children.forEach((c) => { a.push(c); all(c, a); }); return a; }
function walk(r, f) { r.children.forEach((c) => { f(c); walk(c, f); }); }
function parseSegment(t) {
  const s = { tag: null, ids: [], cls: [], attrs: [] };
  let rest = String(t).trim();
  const m = rest.match(/^[a-zA-Z][\w-]*/);
  if (m) { s.tag = m[0].toUpperCase(); rest = rest.slice(m[0].length); }
  const ar = /\[([^\]]+)\]/g; let am;
  while ((am = ar.exec(rest))) {
    const eq = am[1].match(/^([\w-]+)([~^$*|]?=)"?([^"]*)"?$/);
    s.attrs.push(eq ? { name: eq[1], op: eq[2], val: eq[3] } : { name: am[1].trim(), op: null, val: null });
  }
  rest = rest.replace(/\[[^\]]+\]/g, '');
  const tr = /([.#])([\w-]+)/g; let tm;
  while ((tm = tr.exec(rest))) { if (tm[1] === '.') s.cls.push(tm[2]); else s.ids.push(tm[2]); }
  return s;
}
function matchSegment(el, s) {
  if (s.tag && el.tagName !== s.tag) return false;
  if (s.ids.some((i) => el.id !== i)) return false;
  if (s.cls.some((c) => !el.classes.has(c))) return false;
  for (const a of s.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.op === '=') { if (el.getAttribute(a.name) !== a.val) return false; }
  }
  return true;
}
function matchPath(el, segs) {
  if (!matchSegment(el, segs[segs.length - 1])) return false;
  let n = el.parentNode;
  for (let i = segs.length - 2; i >= 0; i--) {
    let f = false;
    while (n) { if (matchSegment(n, segs[i])) { f = true; n = n.parentNode; break; } n = n.parentNode; }
    if (!f) return false;
  }
  return true;
}

const VIEW_META = {
  explorer: { id: 'workbench.view.explorer', label: 'Explorer', contentClass: 'explorer-folders-view' },
  search: { id: 'workbench.view.search', label: 'Search', contentClass: 'search-view' },
  scm: { id: 'workbench.view.scm', label: 'Source Control', contentClass: 'scm-view' },
};
function buildWorkbench() {
  const wb = new El('div'); wb.classes.add('monaco-workbench');
  const bar = new El('div'); bar.className = 'part activitybar'; wb.append(bar);
  const side = new El('div'); side.className = 'part sidebar'; side.hidden = true; wb.append(side);
  const edp = new El('div'); edp.className = 'part editor'; wb.append(edp);
  const panel = new El('div'); panel.className = 'part panel'; panel.hidden = true; wb.append(panel);
  const sb = new El('div'); sb.className = 'part statusbar'; wb.append(sb);
  const mon = new El('div'); mon.className = 'monaco-editor'; mon.setAttribute('data-uri', 'file:///src/main.rs');
  const ta = new El('textarea'); ta.className = 'inputarea'; mon.append(ta); edp.append(mon);
  wb.classes.add('nosidebar'); wb.classes.add('nopanel');
  let activeView = null;
  function render() {
    side.children.slice().forEach((c) => side.removeChild(c));
    if (activeView) {
      wb.classes.delete('nosidebar'); side.hidden = false;
      const content = new El('div'); content.className = VIEW_META[activeView].contentClass; side.append(content);
    } else { wb.classes.add('nosidebar'); side.hidden = true; }
  }
  ['explorer', 'search', 'scm'].forEach((key) => {
    const item = new El('div'); item.className = 'action-item'; item.id = VIEW_META[key].id;
    const a = new El('a'); a.className = 'action-label'; a.setAttribute('aria-label', VIEW_META[key].label);
    a.onClick = () => { activeView = activeView === key ? null : key; render(); };
    item.append(a); bar.append(item);
  });
  activeView = 'explorer'; render();
  return { wb, bar, side, setView(v) { activeView = v; render(); } };
}

body = new El('body');
const document = {
  readyState: 'loading', body, head: new El('head'), documentElement: new El('html'),
  createElement: (t) => new El(t), getElementById: () => null,
  addEventListener() {}, removeEventListener() {},
  querySelector: (s) => body.querySelector(s), querySelectorAll: (s) => body.querySelectorAll(s),
};
const fakeLocation = { hostname: 'github.dev', pathname: '/o/r', href: 'https://github.dev/o/r' };
const window = {
  location: fakeLocation, innerWidth: 412, innerHeight: 915,
  visualViewport: { width: 412, height: 915, offsetTop: 0, addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  history: { pushState() {}, replaceState() {}, back() {} },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  getComputedStyle: (el) => ({ display: el && el.hidden ? 'none' : 'block', visibility: 'visible' }),
  KeyboardEvent: class { constructor(t, i) { Object.assign(this, i || {}); } },
  MutationObserver: class { observe() {} disconnect() {} },
};
window.window = window;
globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 5 }, configurable: true });
Object.defineProperty(globalThis, 'location', { value: fakeLocation, configurable: true });
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MutationObserver = window.MutationObserver;

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const K = require(join(root, 'github-dev-mobile.user.js'));
const A = K.__adapter;

function setHost(wb) {
  body.children.slice().forEach((c) => body.removeChild(c));
  if (wb) body.append(wb);
}

/* ------------------------------ runs ----------------------------------- */
const provenance = 'stub workbench mirroring fixtures/*.html — NOT live-host VALIDATED (see VERIFICATION_REPORT.md)';
const generatedAt = new Date().toISOString();

const base = buildWorkbench();
setHost(base.wb);
const scan = A.reconnaissance.scan();
const obs = A.observe();
const reconnaissance = {
  generatedAt, provenance, artifact: 'github-dev-mobile.user.js', version: K.USER_INTERFACE_VERSION,
  summary: { buttons: scan.buttons, labelledControls: scan.labelledControls, candidateSurfaces: scan.candidateSurfaces },
  labels: scan.labels, roles: scan.roles, evidence: scan.evidence,
  discovery: A.discoveryLevels(obs), capabilities: K.classifyCapabilities(obs),
};

const selectorRegistry = {
  generatedAt, provenance, artifact: 'github-dev-mobile.user.js', version: K.USER_INTERFACE_VERSION,
  note: 'The registry begins empty in source; entries below carry the 2026-09-15 reconnaissance provenance and stay PROVISIONAL until a live state transition promotes them (§60/§61).',
  registry: A.registrySnapshot(),
};

function freshClosed() {
  const h = buildWorkbench();
  setHost(h.wb);
  A.observe();
  h.setView(null);
  return h;
}
const mutations = [];
function recordMutation(name, mutate) {
  const h = freshClosed();
  mutate(h);
  const target = A.resolveSurfaceTarget('explorer');
  const r = A.openExplorer();
  const after = A.observe();
  const drift = (after.drift || []).map((d) => d.surface);
  mutations.push({
    mutation: name,
    resolve: { status: target.status, via: target.via, evidence: target.evidence },
    openExplorer: {
      ok: r.ok, elementFound: r.evidence.elementFound, invoked: r.evidence.invoked,
      mechanism: r.evidence.mechanism || null, stateChanged: r.evidence.stateChanged, level: r.evidence.level,
    },
    sidebarActiveViewAfter: after.sidebarActiveView,
    drift,
    verdict: r.ok && r.evidence.level === 'VALIDATED' && after.sidebarActiveView !== 'explorer'
      ? 'FAIL: wrong view validated'
      : 'OK: degraded or correct, never the wrong action',
  });
}
recordMutation('aria-label-changed', () => {
  const a = A.workbench().querySelector('[id="workbench.view.explorer"] .action-label');
  a.setAttribute('aria-label', 'Something Else Entirely');
  a.parentNode.attrs.delete('id');
});
recordMutation('button-removed', () => {
  const item = A.workbench().querySelector('[id="workbench.view.explorer"]');
  item.parentNode.removeChild(item);
});
recordMutation('container-renamed', () => {
  A.workbench().querySelector('.part.activitybar').className = 'part rail';
});
recordMutation('element-moved', (h) => {
  const item = A.workbench().querySelector('[id="workbench.view.explorer"]');
  item.parentNode.removeChild(item);
  h.side.append(item);
});
recordMutation('element-duplicated', (h) => {
  const src = A.workbench().querySelector('[id="workbench.view.explorer"]');
  const dup = new El('div'); dup.className = 'action-item'; dup.id = src.id;
  const a2 = new El('a'); a2.className = 'action-label'; a2.setAttribute('aria-label', 'Explorer');
  const first = h.bar.querySelector('.action-label');
  a2.onClick = () => { if (first && first.onClick) first.onClick(); };
  dup.append(a2); h.bar.append(dup);
});
recordMutation('element-hidden', () => {
  const item = A.workbench().querySelector('[id="workbench.view.explorer"]');
  item.hidden = true;
  item.querySelector('.action-label').hidden = true;
});
recordMutation('role-changed', () => {
  A.workbench().querySelector('[id="workbench.view.explorer"] .action-label').setAttribute('role', 'menuitem');
});
const mutationResults = {
  generatedAt, provenance, artifact: 'github-dev-mobile.user.js', version: K.USER_INTERFACE_VERSION,
  invariant: 'Broken DOM recognition MUST degrade capability status rather than silently executing the wrong action (§46).',
  mutations,
};

/* ------------------------------ write ---------------------------------- */
mkdirSync(join(root, 'evidence'), { recursive: true });
writeFileSync(join(root, 'evidence', 'reconnaissance.json'), JSON.stringify(reconnaissance, null, 2) + '\n');
writeFileSync(join(root, 'evidence', 'selector-registry.json'), JSON.stringify(selectorRegistry, null, 2) + '\n');
writeFileSync(join(root, 'evidence', 'mutation-results.json'), JSON.stringify(mutationResults, null, 2) + '\n');
const bad = mutations.filter((m) => m.verdict.indexOf('FAIL') === 0);
console.log(`evidence written: 3 files, ${mutations.length} mutations, ${bad.length} failures`);
process.exit(bad.length ? 1 : 0);
