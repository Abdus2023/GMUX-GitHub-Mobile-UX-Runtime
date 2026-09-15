#!/usr/bin/env node
/**
 * GMUX inspection-first suite — reconnaissance, selector provenance, semantic
 * fallback, drift, surfaces, fixtures and mutation testing.
 *
 * Dependency-free: node tests/recon-fixtures.mjs
 *
 * Covers the inspection-first contract (§9–§21, §43–§46):
 *   - DOM reconnaissance produces normalized evidence (never a DOM dump);
 *   - the selector registry begins empty and every entry carries provenance;
 *   - resolve() observes without verifying; semantic fallback yields
 *     PROVISIONAL or BLOCKED and never auto-promotes;
 *   - known-selector loss emits ADAPTER_DRIFT and degrades (never guesses);
 *   - Surface classes honor detect/open/close/isOpen/observe with the §20
 *     lifecycle, including DEGRADED and a disabled TerminalSurface;
 *   - fixtures/*.html are minimal, scriptless and semantically correct;
 *   - mutations of a known-good host degrade capabilities with diagnostic
 *     evidence instead of executing the wrong action (critical invariant).
 *
 * The stub DOM below mirrors fixtures/*.html (improved attribute-selector
 * parsing vs tests/adapter-flow.mjs, which is left untouched). Stub evidence
 * is NOT live-host VALIDATED — see VERIFICATION_REPORT.md.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(t) { console.log(`\n== ${t} ==`); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = readFileSync(join(root, 'github-dev-mobile.user.js'), 'utf8');

/* ------------------------- miniature DOM ------------------------------- */

let activeElement = null;
let body = null; // assigned below; El.isConnected resolves lazily
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.classes = new Set();
    this.hidden = false;
    this.style = {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
    };
    this.onClick = null;
    this.textContent = '';
    this._listeners = [];
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
    return {
      add: (...xs) => xs.forEach((x) => c.add(x)),
      remove: (...xs) => xs.forEach((x) => c.delete(x)),
      contains: (x) => c.has(x),
      toggle: (x) => (c.has(x) ? (c.delete(x), false) : (c.add(x), true)),
    };
  }
  append(c) {
    if (c.parentNode) c.parentNode.remove(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  remove(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  appendChild(c) { return this.append(c); }
  removeChild(c) { return this.remove(c); }
  addEventListener(t, f) { this._listeners.push([t, f]); }
  removeEventListener(t, f) { this._listeners = this._listeners.filter(([a, b]) => !(a === t && b === f)); }
  click() { if (this.onClick) this.onClick(); }
  focus() { activeElement = this; }
  contains(o) { return o === this || this.querySelectorAll('*').includes(o); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return body !== null && n === body; }
  matches(sel) { try { return matchSegment(this, parseSegment(sel)); } catch (e) { return false; } }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    if (sel === '*') return all(this);
    const groups = sel.split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const g of groups) {
      const segs = g.split(/\s+/).map(parseSegment);
      walk(this, (el) => { if (el !== this && matchPath(el, segs)) out.push(el); });
    }
    return Array.from(new Set(out));
  }
}
function all(root, acc = []) { root.children.forEach((c) => { acc.push(c); all(c, acc); }); return acc; }
function walk(root, fn) { root.children.forEach((c) => { fn(c); walk(c, fn); }); }
function parseSegment(text) {
  const seg = { tag: null, ids: [], cls: [], attrs: [] };
  let rest = String(text).trim();
  const tagM = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagM) { seg.tag = tagM[0].toUpperCase(); rest = rest.slice(tagM[0].length); }
  const attrRe = /\[([^\]]+)\]/g;
  let am;
  while ((am = attrRe.exec(rest))) seg.attrs.push(parseAttr(am[1]));
  rest = rest.replace(/\[[^\]]+\]/g, '');
  const tokRe = /([.#])([\w-]+)/g;
  let tm;
  while ((tm = tokRe.exec(rest))) {
    if (tm[1] === '.') seg.cls.push(tm[2]); else seg.ids.push(tm[2]);
  }
  return seg;
}
function parseAttr(t) {
  const eq = String(t).match(/^([\w-]+)([~^$*|]?=)"?([^"]*)"?$/);
  if (eq) return { name: eq[1], op: eq[2], val: eq[3] };
  return { name: String(t).trim(), op: null, val: null };
}
function matchSegment(el, seg) {
  if (seg.tag && el.tagName !== seg.tag) return false;
  if (seg.ids.some((i) => el.id !== i)) return false;
  if (seg.cls.some((c) => !el.classes.has(c))) return false;
  for (const a of seg.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.op === '=') { if (el.getAttribute(a.name) !== a.val) return false; }
  }
  return true;
}
function matchPath(el, segs) {
  if (!matchSegment(el, segs[segs.length - 1])) return false;
  let node = el.parentNode;
  for (let i = segs.length - 2; i >= 0; i--) {
    let found = false;
    while (node) {
      if (matchSegment(node, segs[i])) { found = true; node = node.parentNode; break; }
      node = node.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

/* ------------------------- stub workbench ------------------------------ */

const VIEW_META = {
  explorer: { id: 'workbench.view.explorer', label: 'Explorer', contentClass: 'explorer-folders-view' },
  search: { id: 'workbench.view.search', label: 'Search', contentClass: 'search-view' },
  scm: { id: 'workbench.view.scm', label: 'Source Control', contentClass: 'scm-view' },
};

function buildWorkbench(opts = {}) {
  const actions = opts.actions || ['explorer', 'search', 'scm'];
  const labels = opts.labels || {};
  const withIds = opts.withIds !== false;
  const wb = new El('div');
  wb.classes.add('monaco-workbench');
  const titlebar = new El('div'); titlebar.className = 'part titlebar'; wb.append(titlebar);
  const activitybar = new El('div');
  activitybar.className = opts.barClass || 'part activitybar';
  wb.append(activitybar);
  const sidebar = new El('div'); sidebar.className = 'part sidebar'; sidebar.hidden = true; wb.append(sidebar);
  const editorPart = new El('div'); editorPart.className = 'part editor'; wb.append(editorPart);
  const panel = new El('div'); panel.className = 'part panel'; panel.hidden = true; wb.append(panel);
  const statusbar = new El('div'); statusbar.className = 'part statusbar'; wb.append(statusbar);

  const editor = new El('div');
  editor.className = 'monaco-editor';
  editor.setAttribute('data-uri', 'file:///src/main.rs');
  const ta = new El('textarea'); ta.className = 'inputarea'; editor.append(ta);
  editorPart.append(editor);
  const tab = new El('div'); tab.className = 'tab active';
  const label = new El('div'); label.className = 'label-name'; label.textContent = 'main.rs'; tab.append(label);
  editorPart.append(tab);

  if (opts.terminal) {
    const outer = new El('div'); outer.className = 'terminal-outer-container';
    const xterm = new El('div'); xterm.className = 'xterm'; outer.append(xterm);
    panel.append(outer);
    panel.hidden = false;
  } else {
    wb.classes.add('nosidebar');
    wb.classList.add('nopanel');
  }

  let activeView = null;
  function renderSidebar() {
    sidebar.children.slice().forEach((c) => sidebar.removeChild(c));
    if (activeView) {
      wb.classes.delete('nosidebar');
      sidebar.hidden = false;
      const content = new El('div');
      content.className = VIEW_META[activeView].contentClass;
      if (activeView === 'search' && opts.searchInput !== false) {
        const input = new El('input');
        input.setAttribute('aria-label', 'Search');
        content.append(input);
      }
      sidebar.append(content);
    } else {
      wb.classes.add('nosidebar');
      sidebar.hidden = true;
    }
  }
  actions.forEach((key) => {
    const item = new El('div');
    item.className = 'action-item';
    if (withIds) item.id = VIEW_META[key].id;
    const action = new El('a');
    action.className = 'action-label';
    action.setAttribute('aria-label', labels[key] || VIEW_META[key].label);
    action.onClick = () => { activeView = activeView === key ? null : key; renderSidebar(); };
    item.append(action);
    activitybar.append(item);
  });
  if (opts.sidebarContent) { activeView = opts.sidebarContent; renderSidebar(); }
  return {
    wb, activitybar, sidebar, editorPart, panel,
    setView(v) { activeView = v; renderSidebar(); },
    getView: () => activeView,
    actionFor(key) {
      const items = activitybar.querySelectorAll('.action-item');
      for (const it of items) {
        const a = it.querySelector('.action-label');
        if (!a) continue;
        if (it.id === ((VIEW_META[key] || {}).id || '')) return { item: it, action: a };
      }
      // fall back to label match (changed-label fixtures carry no id)
      for (const it of items) {
        const a = it.querySelector('.action-label');
        if (a && (a.getAttribute('aria-label') || '').toLowerCase().indexOf(key === 'scm' ? 'source control' : key) === 0) {
          return { item: it, action: a };
        }
      }
      return null;
    },
  };
}

body = new El('body');
const document = {
  readyState: 'loading', // do NOT boot the session; adapter + GMUX shape only
  body, head: new El('head'), documentElement: new El('html'),
  createElement: (t) => new El(t),
  getElementById: () => null,
  addEventListener() {}, removeEventListener() {},
  querySelector: (s) => body.querySelector(s),
  querySelectorAll: (s) => body.querySelectorAll(s),
};
Object.defineProperty(document, 'activeElement', { get: () => activeElement });
const fakeLocation = { hostname: 'github.dev', pathname: '/o/r', href: 'https://github.dev/o/r' };
const window = {
  location: fakeLocation,
  innerWidth: 412, innerHeight: 915,
  visualViewport: { width: 412, height: 915, offsetTop: 0, addEventListener() {} },
  localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } },
  history: { pushState() {}, replaceState() {}, back() {} },
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return true; },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  getComputedStyle: (el) => ({ display: el && el.hidden ? 'none' : 'block', visibility: 'visible' }),
  KeyboardEvent: class { constructor(t, i) { Object.assign(this, i || {}); } },
  MutationObserver: class { observe() {} disconnect() {} },
};
window.window = window;
globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Linux', userAgent: 'recon/node', maxTouchPoints: 5 }, configurable: true });
Object.defineProperty(globalThis, 'location', { value: fakeLocation, configurable: true });
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MutationObserver = window.MutationObserver;

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const K = require(join(root, 'github-dev-mobile.user.js'));
const A = K.__adapter;
if (!A) { console.error('adapter export missing'); process.exit(1); }

function setHost(wb) {
  body.children.slice().forEach((c) => body.removeChild(c));
  activeElement = null;
  if (wb) body.append(wb);
}
function freshBaseline(extra = {}) {
  const host = buildWorkbench(Object.assign({ sidebarContent: 'explorer' }, extra));
  setHost(host.wb);
  return host;
}

/* ------------------- A. fixture files (§43/§44) ------------------------- */

section('Fixture architecture: minimal, scriptless, semantic (§43/§44)');
const FIXTURES = ['baseline.html', 'explorer.html', 'search.html', 'terminal.html',
  'missing-explorer.html', 'changed-label.html', 'malformed.html'];
FIXTURES.forEach((f) => {
  let ok = false, size = -1, noscript = false, text = '';
  try {
    text = readFileSync(join(root, 'fixtures', f), 'utf8');
    size = statSync(join(root, 'fixtures', f)).size;
    ok = true;
    noscript = !/<script[\s>]/i.test(text);
  } catch (e) { ok = false; }
  check(`fixtures/${f} exists and is minimal (<8KB)`, ok && size > 0 && size < 8192, `size=${size}`);
  if (f !== 'malformed.html') check(`fixtures/${f} carries no scripts`, noscript);
});
{
  const t = (f) => readFileSync(join(root, 'fixtures', f), 'utf8');
  check('baseline: workbench + explorer/search/scm ids + editor, no xterm',
    /monaco-workbench/.test(t('baseline.html')) && /workbench\.view\.explorer/.test(t('baseline.html')) &&
    /workbench\.view\.search/.test(t('baseline.html')) && /workbench\.view\.scm/.test(t('baseline.html')) &&
    /monaco-editor/.test(t('baseline.html')) && !/class="xterm"/.test(t('baseline.html')));
  check('terminal: xterm present', /class="xterm"/.test(t('terminal.html')) && /terminal-outer-container/.test(t('terminal.html')));
  check('missing-explorer: no explorer id or view', !/workbench\.view\.explorer/.test(t('missing-explorer.html')) &&
    !/explorer-folders-view/.test(t('missing-explorer.html')) && /workbench\.view\.search/.test(t('missing-explorer.html')));
  check('changed-label: stable id gone, Explorer semantics remain',
    !/id="workbench\.view\.explorer"/.test(t('changed-label.html')) && /aria-label="Explorer/.test(t('changed-label.html')));
  check('malformed: duplicate ids, still parseable text', (t('malformed.html').match(/workbench\.view\.explorer/g) || []).length >= 2);
}

/* ------------------- B. pure inspection-first kernel -------------------- */

section('Orientation / environment / layout (§23–§25)');
check('orientation portrait', K.orientationFor(412, 915) === 'portrait');
check('orientation landscape', K.orientationFor(915, 412) === 'landscape');
check('square viewport → portrait', K.orientationFor(500, 500) === 'portrait');
{
  const env = K.observeEnvironment({ width: 412, height: 915, coarsePointer: true, touch: true });
  check('environment normalized', env.width === 412 && env.coarsePointer === true && env.touch === true && env.orientation === 'portrait');
  const missing = K.observeEnvironment({ width: 1280, height: 800 });
  check('missing signals degrade to recorded nulls', missing.coarsePointer === null && missing.touch === null && missing.orientation === 'landscape');
}
{
  const r = K.layoutModeFor({ width: 412, height: 915, coarsePointer: true, touch: true }, K.DEFAULT_BREAKPOINTS, 'auto');
  check('narrow+coarse+touch → mobile with basis', r.mode === 'mobile' && r.basis.orientation === 'portrait' && r.basis.touch === true);
  const wide = K.layoutModeFor({ width: 1400, height: 900, coarsePointer: true, touch: true }, K.DEFAULT_BREAKPOINTS, 'auto');
  check('phone-class signals on a wide display → desktop (DeX possible)', wide.mode === 'desktop');
  const over = K.layoutModeFor({ width: 1400, height: 900 }, K.DEFAULT_BREAKPOINTS, 'mobile');
  check('explicit override still wins', over.mode === 'mobile' && over.basis.override === 'mobile');
}

section('Navigation stack (§27)');
check('stack starts at [editor]', JSON.stringify(K.createNavStack()) === '["editor"]');
check('push explorer → [editor,explorer]', JSON.stringify(K.navPush(['editor'], 'explorer')) === '["editor","explorer"]');
check('open search replaces secondary', JSON.stringify(K.navPush(['editor', 'explorer'], 'search')) === '["editor","search"]');
check('pop returns to [editor]', JSON.stringify(K.navPop(['editor', 'search'])) === '["editor"]');
check('pop at root stays at root', JSON.stringify(K.navPop(['editor'])) === '["editor"]');
check('settings modal does not push navigation', JSON.stringify(K.navPush(['editor'], 'settings')) === '["editor"]');

section('Discovery levels ↔ evidence (§12/§13)');
check('level labels 0–5', K.discoveryLabel(0) === 'UNKNOWN' && K.discoveryLabel(2) === 'SEMANTICALLY IDENTIFIED' &&
  K.discoveryLabel(4) === 'STATE TRANSITION OBSERVED' && K.discoveryLabel(5) === 'REGRESSION-TESTED');
check('L0 → UNKNOWN', JSON.stringify(K.evidenceForDiscovery(0)) === '["UNKNOWN"]');
check('L1 → OBSERVED', JSON.stringify(K.evidenceForDiscovery(1)) === '["OBSERVED"]');
check('L2 → OBSERVED+INFERRED', JSON.stringify(K.evidenceForDiscovery(2)) === '["OBSERVED","INFERRED"]');
check('L3 → ATTEMPTED', JSON.stringify(K.evidenceForDiscovery(3)) === '["ATTEMPTED"]');
check('L5 → VALIDATED+REGRESSION-TESTED',
  JSON.stringify(K.evidenceForDiscovery(5)) === '["VALIDATED","REGRESSION-TESTED"]');

section('Layout policy + surface metadata (§21/§22)');
check('mobile explorer=drawer', K.LAYOUT_POLICY.mobile.explorer === 'drawer');
check('mobile search/git fullscreen, editor immersive',
  K.LAYOUT_POLICY.mobile.search === 'fullscreen' && K.LAYOUT_POLICY.mobile.git === 'fullscreen' && K.LAYOUT_POLICY.mobile.editor === 'immersive');
check('compact search=panel', K.LAYOUT_POLICY.compact.search === 'panel' && K.LAYOUT_POLICY.compact.editor === 'normal');
check('desktop all native', Object.values(K.LAYOUT_POLICY.desktop).every((v) => v === 'native'));
check('explorer meta drawer/left/50',
  K.SURFACE_META.explorer.presentation === 'drawer' && K.SURFACE_META.explorer.side === 'left' && K.SURFACE_META.explorer.priority === 50);
check('search meta fullscreen/90', K.SURFACE_META.search.presentation === 'fullscreen' && K.SURFACE_META.search.priority === 90);

section('Back planner honors the navigation stack (§28)');
{
  const d = K.planBack({ navigationStack: ['editor', 'explorer'], activeSurface: 'explorer' });
  check('stack deeper than root consumes Back', d.consume === 'surface' && d.to === 'editor');
  const root = K.planBack({ navigationStack: ['editor'], activeSurface: 'editor' });
  check('stack at root allows browser default', root.consume === null);
}

section('Reducer is deterministic (§35)');
{
  const st = { activeSurface: 'editor', previousSurface: null, navigationStack: ['editor'], viewport: { width: 412, height: 915, offsetTop: 0 } };
  const obs = { surfaces: { editor: { activeFile: null }, terminal: { visible: false } }, parts: { sideBar: { visible: false }, quickInput: { visible: false } }, measured: {}, appSurface: 'editor' };
  const r1 = K.reducer(st, obs);
  const r2 = K.reducer(JSON.parse(JSON.stringify(st)), JSON.parse(JSON.stringify(obs)));
  check('identical inputs → identical fragment', JSON.stringify(r1) === JSON.stringify(r2));
  check('reducer carries orientation + stack', r1.orientation === 'portrait' && JSON.stringify(r1.navigationStack) === '["editor"]');
  check('sameState compares kernel state', K.sameState(st, Object.assign({}, st)) === true &&
    K.sameState(st, Object.assign({}, st, { activeSurface: 'search' })) === false);
  const plan = K.planReconcile({ obs, state: st, prefs: K.PREF_DEFAULTS, caps: {} });
  check('planner emits orientation + navigationStack + layout', plan.orientation === 'portrait' &&
    Array.isArray(plan.navigationStack) && plan.layout && plan.layout.explorer === 'drawer');
}

/* ------------------- C. static architecture checks ---------------------- */

section('Static contract: empty registry start, GMUX API, kernel isolation');
check('registry begins empty (§14)', /const selectorRegistry = \{\s*explorer:\s*\[\],\s*search:\s*\[\],\s*sourceControl:\s*\[\],\s*editor:\s*\[\],\s*terminal:\s*\[\]\s*\}/.test(source));
check('GMUX global namespace with §6 API',
  /globalThis\.GMUX = GMUX_API/.test(source) && /inspect:\s*\(\)\s*=>/.test(source) &&
  /getState:\s*\(\)\s*=>/.test(source) && /getCapabilities:\s*\(\)\s*=>/.test(source) &&
  /reconcile:\s*\(\)\s*=>/.test(source));
{
  const cStart = source.indexOf('§C PURE KERNEL');
  const dStart = source.indexOf('§D GITHUB-DEV ADAPTER');
  const kernel = source.slice(cStart, dStart);
  const leaks = ['.monaco-workbench', '.action-label', '.xterm', 'workbench.view', '.monaco-editor', '.part.sidebar', '.search-view', '.scm-view']
    .filter((s) => kernel.indexOf(s) !== -1);
  check('kernel contains no GitHub selectors (§8/I-03)', leaks.length === 0, leaks.join(','));
}
check('reconnaissance subsystem present (§9)', /const reconnaissance = \{/.test(source) && /evidenceForSurface/.test(source));
check('no network primitives in artifact (G19)', !/\bfetch\s*\(/.test(source) && !/XMLHttpRequest/.test(source) &&
  !/\bWebSocket\b/.test(source) && !/sendBeacon/.test(source) && !/\bEventSource\b/.test(source) && !/\bimport\s*\(/.test(source));

/* ------------------- D. registry + resolve (§14–§16) -------------------- */

section('Selector registry provenance + resolution (§14–§16)');
{
  const snap = A.registrySnapshot();
  check('registry covers five purposes', ['explorer', 'search', 'sourceControl', 'editor', 'terminal'].every((k) => Array.isArray(snap[k])));
  const ex = snap.explorer[0] || {};
  check('seed carries provenance', typeof ex.selector === 'string' && ex.source === 'reconnaissance' &&
    ex.confidence === 2 && typeof ex.observedAt === 'string' && ex.purpose === 'explorer');
  const before = snap.explorer.length;
  A.registerSelector('explorer', '.custom-explorer-trigger', { source: 'reconnaissance', confidence: 2, observedAt: '2026-09-15-test' });
  check('registerSelector appends with provenance', A.registrySnapshot().explorer.length === before + 1);
}
freshBaseline();
{
  const snap = A.registrySnapshot();
  const hit = A.resolve(snap.explorer);
  check('resolve() matches a known selector', !!hit && !!hit.element && typeof hit.selector === 'string');
  check('resolve() returns evidence, never a verified claim',
    !!hit && !!hit.evidence && !('verified' in hit) && hit.evidence.purpose === 'explorer');
  check('resolve() records matching count', !!hit && typeof hit.matchingCount === 'number' && hit.matchingCount >= 1);
  check('resolve() misses cleanly', A.resolve([{ selector: '.no-such-gmux-selector-xyz' }]) === null);
  const log = A.getSelectorLog();
  check('selector use is logged locally (§16)', log.length > 0 && log[log.length - 1].selector === hit.selector &&
    typeof log[log.length - 1].timestamp === 'string');
}

/* ------------------- E. semantic fallback (§18) ------------------------- */

section('Semantic fallback: PROVISIONAL or BLOCKED, never guessed (§18)');
{
  // changed-label: stable id gone, Explorer prefix semantics remain.
  const host = buildWorkbench({ withIds: false, labels: { explorer: 'Explorer (Files)' }, sidebarContent: 'explorer' });
  setHost(host.wb);
  const t = A.resolveSurfaceTarget('explorer');
  check('changed label → PROVISIONAL via semantic evidence', t.status === 'PROVISIONAL' && t.via === 'semantic' && !!t.element);
  const regN = A.registrySnapshot().explorer.length;
  A.resolveSurfaceTarget('explorer');
  check('semantic candidate never auto-promoted to the registry', A.registrySnapshot().explorer.length === regN);
}
{
  // missing-explorer: nothing to find.
  const host = buildWorkbench({ actions: ['search', 'scm'] });
  setHost(host.wb);
  const t = A.resolveSurfaceTarget('explorer');
  check('missing surface → BLOCKED', t.status === 'BLOCKED' && t.element === null);
}
{
  // ambiguity: two id-less Explorer labels → refuse to guess.
  const host = buildWorkbench({ withIds: false, sidebarContent: null });
  const dup = new El('div'); dup.className = 'action-item';
  const a2 = new El('a'); a2.className = 'action-label'; a2.setAttribute('aria-label', 'Explorer');
  dup.append(a2); host.activitybar.append(dup);
  setHost(host.wb);
  const t = A.resolveSurfaceTarget('explorer');
  check('ambiguous semantic evidence → BLOCKED', t.status === 'BLOCKED' && t.element === null && t.evidence.count === 2);
  check('findActivityAction refuses ambiguity too', A.findActivityAction('explorer') === null);
}

/* ------------------- F. reconnaissance (§9/§10) ------------------------- */

section('DOM reconnaissance output (§9/§10)');
freshBaseline();
{
  const scan = A.reconnaissance.scan();
  check('scan counts buttons + labelled controls', scan.buttons > 0 && scan.labelledControls > 0);
  check('scan finds candidate surfaces', scan.candidateSurfaces >= 2);
  check('scan records bounded label samples', Array.isArray(scan.labels) && scan.labels.length > 0 && scan.labels.length <= 24);
  check('scan records role distribution', scan.roles && typeof scan.roles.button === 'number');
  const rec = A.reconnaissance.evidenceForSurface('explorer');
  check('evidence record shape {surface, evidence[]}', rec.surface === 'explorer' && Array.isArray(rec.evidence));
  const kinds = rec.evidence.map((e) => e.kind).sort();
  check('explorer evidence distinguishes kinds', kinds.indexOf('id') !== -1 && kinds.indexOf('aria-label') !== -1, kinds.join(','));
  const counts = rec.evidence.every((e) => typeof e.count === 'number' && e.count > 0 && typeof e.value === 'string');
  check('every evidence entry carries kind/value/count', counts);
}

/* ------------------- G. discovery levels (§12) -------------------------- */

section('Discovery levels from observation (§12)');
{
  const closed = buildWorkbench();
  setHost(closed.wb);
  const d0 = A.discoveryLevels(A.observe());
  check('closed sidebar: explorer UNKNOWN, editor IDENTIFIED', d0.explorer === 0 && d0.editor === 2, JSON.stringify(d0));
  const r = A.openExplorer();
  check('open path still VALIDATED on the stub', r.ok === true && r.evidence.level === 'VALIDATED');
  const d1 = A.discoveryLevels(A.observe());
  check('open explorer: IDENTIFIED (trigger + content)', d1.explorer === 2, JSON.stringify(d1));
  A.closePanels();
}

/* ------------------- H. surface abstraction (§19–§21) -------------------- */

section('Surface contract + lifecycle (§19–§21)');
{
  const ids = Object.keys(A.surfaces).sort();
  check('five surfaces implemented', JSON.stringify(ids) === '["editor","explorer","search","sourceControl","terminal"]');
  const contract = ['detect', 'open', 'close', 'isOpen', 'observe'].every((m) =>
    ids.every((id) => typeof A.surfaces[id][m] === 'function'));
  check('every surface exposes detect/open/close/isOpen/observe', contract);
  check('Surface base class honors the not-implemented contract', (() => {
    const s = new A.Surface('test');
    return s.detect() === false && s.isOpen() === false && s.open().ok === false;
  })());
}
freshBaseline();
{
  check('ExplorerSurface.detect() true on baseline', A.surfaces.explorer.detect() === true);
  check('ExplorerSurface.isOpen() true (baseline shows explorer)', A.surfaces.explorer.isOpen() === true);
  const c = A.surfaces.explorer.close();
  check('ExplorerSurface.close() → AVAILABLE', c.ok === true && A.getSurfaceState('explorer') === 'AVAILABLE' && A.surfaces.explorer.isOpen() === false);
  const o = A.surfaces.explorer.open();
  check('ExplorerSurface.open() → OPEN + VALIDATED', o.ok === true && A.getSurfaceState('explorer') === 'OPEN' && A.surfaces.explorer.isOpen() === true);
}
{
  const o = A.surfaces.search.open();
  check('SearchSurface.open() VALIDATED', o.ok === true && A.surfaces.search.isOpen() === true);
  const f = A.focusSearchInput();
  check('search input focusable after open (§31)', f.ok === true && f.evidence.level === 'VALIDATED');
  A.surfaces.search.close();
  const g = A.surfaces.sourceControl.open();
  check('GitSurface.open() VALIDATED', g.ok === true && A.surfaces.sourceControl.isOpen() === true);
  A.surfaces.sourceControl.close();
  check('GitSurface.close() → AVAILABLE', A.getSurfaceState('sourceControl') === 'AVAILABLE');
}
{
  check('EditorSurface.detect() true', A.surfaces.editor.detect() === true);
  const f = A.surfaces.editor.open();
  check('EditorSurface.open() focuses Monaco input', f.ok === true && f.operation === 'focus-editor');
}
{
  const host = buildWorkbench({ terminal: true });
  setHost(host.wb);
  check('TerminalSurface.detect() observes the terminal', A.surfaces.terminal.detect() === true);
  const t = A.surfaces.terminal.open();
  check('TerminalSurface.open() refuses without actuating (§2 freeze)',
    t.ok === false && t.reason === 'terminal-disabled' && A.surfaces.terminal.isOpen() === true /* observed, not operated */);
}
{
  // Failure → DEGRADED (§20), honestly reported.
  setHost(null);
  document.body.children.slice().forEach((c) => document.body.removeChild(c));
  const r = A.surfaces.explorer.open();
  check('open with no host fails structured', r.ok === false);
  check('failed surface becomes DEGRADED', A.getSurfaceState('explorer') === 'DEGRADED');
  freshBaseline();
}

/* ------------------- I. drift detection (§17/§48) ------------------------ */

section('Selector drift (§17/§48)');
{
  freshBaseline();
  A.observe(); // lastKnown: triggers match
  const host = A.workbench();
  const item = host.querySelector('[id="workbench.view.explorer"]');
  item.parentNode.removeChild(item);
  const obs = A.observe();
  const drift = (obs.drift || []).filter((d) => d.surface === 'explorer');
  check('lost known selector emits ADAPTER_DRIFT', drift.length === 1 && drift[0].code === 'ADAPTER_DRIFT');
  check('drift record carries fallback guidance', drift.length === 1 && /semantic reconnaissance/.test(drift[0].fallback));
  check('drift persisted in the local log', A.getDriftEvents().some((d) => d.surface === 'explorer'));
  freshBaseline();
  A.observe(); // re-baseline triggers to matched
}

/* ------------------- J. mutation testing (§45/§46) ----------------------- */

section('Mutation testing: degrade, never the wrong action (§45/§46)');
function baselineTriggerState() {
  const host = freshBaseline();
  A.observe(); // settle lastKnownMatch to matched
  host.setView(null); // sidebar closed → operations must use the trigger path
  return host;
}
function neverWrongView(result, requested) {
  // VALIDATED may only ever name the requested view; anything else must be
  // an honestly qualified INFERRED/OBSERVED attempt — never a wrong success.
  if (result.ok && result.evidence && result.evidence.level === 'VALIDATED') {
    const after = A.observe();
    return after.sidebarActiveView === requested;
  }
  return true;
}
// M1: ARIA label changed + stable id removed.
baselineTriggerState();
{
  const h = A.workbench().querySelector('[id="workbench.view.explorer"] .action-label');
  h.setAttribute('aria-label', 'Something Else Entirely');
  h.parentNode.attrs.delete('id');
  const t = A.resolveSurfaceTarget('explorer');
  const r = A.openExplorer();
  check('M1 aria-changed: resolution BLOCKED', t.status === 'BLOCKED');
  check('M1 aria-changed: no element found, nothing validated', r.evidence.elementFound === false && r.evidence.stateChanged === false);
  check('M1 aria-changed: never the wrong view', neverWrongView(r, 'explorer'));
  check('M1 aria-changed: search still opens (isolation)', A.openSearch().evidence.level === 'VALIDATED');
}
// M2: trigger button removed.
baselineTriggerState();
{
  const item = A.workbench().querySelector('[id="workbench.view.explorer"]');
  item.parentNode.removeChild(item);
  const t = A.resolveSurfaceTarget('explorer');
  const r = A.openExplorer();
  check('M2 removed: resolution BLOCKED', t.status === 'BLOCKED');
  check('M2 removed: drift evidence recorded', A.getDriftEvents().some((d) => d.surface === 'explorer'));
  check('M2 removed: never the wrong view', neverWrongView(r, 'explorer'));
}
// M3: container renamed (activity bar class changed).
baselineTriggerState();
{
  const bar = A.workbench().querySelector('.part.activitybar');
  bar.className = 'part rail';
  const t = A.resolveSurfaceTarget('explorer');
  check('M3 renamed container: known selector fails, semantic PROVISIONAL (not MATCHED)', t.status === 'PROVISIONAL' && t.via === 'semantic');
  const r = A.openExplorer();
  check('M3 renamed container: fallback opens the CORRECT view or stays honest', neverWrongView(r, 'explorer'));
}
// M4: trigger moved out of the activity bar.
baselineTriggerState();
{
  const wb = A.workbench();
  const item = wb.querySelector('[id="workbench.view.explorer"]');
  const side = wb.querySelector('.part.sidebar');
  item.parentNode.removeChild(item);
  side.append(item);
  const t = A.resolveSurfaceTarget('explorer');
  const r = A.openExplorer();
  check('M4 moved: trigger no longer resolvable → BLOCKED', t.status === 'BLOCKED' && A.findActivityAction('explorer') === null);
  check('M4 moved: never the wrong view', neverWrongView(r, 'explorer'));
}
// M5: trigger duplicated.
baselineTriggerState();
{
  const wb = A.workbench();
  const bar = wb.querySelector('.part.activitybar');
  const src = wb.querySelector('[id="workbench.view.explorer"]');
  const dup = new El('div'); dup.className = 'action-item'; dup.id = src.id;
  const a2 = new El('a'); a2.className = 'action-label'; a2.setAttribute('aria-label', 'Explorer');
  a2.onClick = () => { const first = bar.querySelector('.action-label'); if (first && first.onClick) first.onClick(); };
  dup.append(a2); bar.append(dup);
  const hit = A.resolve(A.registrySnapshot().explorer);
  check('M5 duplicated: match recorded with count=2', !!hit && hit.matchingCount === 2);
  const r = A.openExplorer();
  check('M5 duplicated: still the correct view (evidence recorded)', r.evidence.level === 'VALIDATED' && A.observe().sidebarActiveView === 'explorer');
  A.closePanels();
  // …but id-less duplicates are ambiguous → refuse.
  wb.querySelectorAll('[id="workbench.view.explorer"]').forEach((n) => n.attrs.delete('id'));
  check('M5 ambiguous duplicates → BLOCKED', A.resolveSurfaceTarget('explorer').status === 'BLOCKED');
}
// M6: trigger hidden.
baselineTriggerState();
{
  const item = A.workbench().querySelector('[id="workbench.view.explorer"]');
  const act = item.querySelector('.action-label');
  item.hidden = true; act.hidden = true;
  const hit = A.resolve(A.registrySnapshot().explorer);
  const entry = A.getSelectorLog()[A.getSelectorLog().length - 1];
  // The use-log is a bounded ring (cap 80, local only); assert the newest
  // entry — not the length — carries the visibility evidence.
  check('M6 hidden: visibility recorded as evidence',
    !!hit && entry.selector === hit.selector && entry.visible === false && entry.matchingCount >= 1);
}
// M7: role changed on the trigger.
baselineTriggerState();
{
  const act = A.workbench().querySelector('[id="workbench.view.explorer"] .action-label');
  act.setAttribute('role', 'menuitem');
  const t = A.resolveSurfaceTarget('explorer');
  const r = A.openExplorer();
  check('M7 role-changed: stable id still MATCHED (no false downgrade)', t.status === 'MATCHED');
  check('M7 role-changed: correct view, never wrong', r.evidence.level === 'VALIDATED' && A.observe().sidebarActiveView === 'explorer');
  A.closePanels();
}
section('Malformed host: safe, structured, degraded (§44)');
{
  const wb = new El('div');
  wb.classes.add('monaco-workbench');
  const dup1 = new El('div'); dup1.id = 'workbench.view.explorer'; wb.append(dup1);
  const dup2 = new El('div'); dup2.id = 'workbench.view.explorer'; wb.append(dup2);
  setHost(wb);
  let obs = null, threw = false;
  try { obs = A.observe(); } catch (e) { threw = true; }
  check('malformed: observe() never throws', threw === false && !!obs);
  const caps = K.classifyCapabilities(obs);
  check('malformed: capabilities degrade honestly', caps.editor === 'NOT_DETECTED' && caps.explorer === 'NOT_DETECTED');
  let r = null;
  try { r = A.openExplorer(); } catch (e) { threw = true; }
  check('malformed: operation returns structured failure', threw === false && r && r.ok === false || (r && r.evidence && r.evidence.stateChanged === false));
  let scanOk = true;
  try { A.reconnaissance.scan(); } catch (e) { scanOk = false; }
  check('malformed: reconnaissance never throws', scanOk);
  freshBaseline();
}

/* ------------------- K. GMUX namespace (§6) ----------------------------- */

section('GMUX namespace (§6)');
check('globalThis.GMUX exposed', typeof globalThis.GMUX === 'object' && globalThis.GMUX !== null);
check('GMUX.version 0.1.0', globalThis.GMUX && globalThis.GMUX.version === '0.1.0');
check('GMUX API shape', ['inspect', 'getState', 'getCapabilities', 'reconcile', 'disable']
  .every((m) => globalThis.GMUX && typeof globalThis.GMUX[m] === 'function'));
check('GMUX.inspect() reports disabled session honestly', (() => {
  const i = globalThis.GMUX.inspect();
  return i && i.version === '0.1.0' && i.status === 'disabled';
})());
check('GMUX.getState()/getCapabilities() safe with no session',
  globalThis.GMUX.getState() === null && JSON.stringify(globalThis.GMUX.getCapabilities()) === '{}');
{
  let threw = false;
  try { globalThis.GMUX.reconcile(); } catch (e) { threw = true; }
  check('GMUX.reconcile() safe with no session', threw === false);
}
{
  // disable() with no session still mounts an owned revive affordance.
  globalThis.GMUX.disable();
  const chip = document.querySelector('.gmux-revive');
  check('GMUX.disable() mounts owned revive chip',
    !!chip && chip.getAttribute('data-gmux-owner') === 'github-dev-mobile' && /Re-enable/.test(chip.getAttribute('aria-label') || ''));
}

/* ------------------------------- summary --------------------------------- */
console.log(`\nrecon-fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
