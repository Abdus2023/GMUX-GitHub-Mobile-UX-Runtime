#!/usr/bin/env node
/**
 * GMUX adapter flow suite — exercises the github-dev adapter's structured
 * operations (SPEC §8/§9/§10/§14) against a stub workbench that emulates the
 * OBSERVED VS Code DOM behavior:
 *
 *   - .monaco-workbench with part regions (§dom-evidence W1/P1..P4)
 *   - activity bar action items identified by stable view ids (A4)
 *   - clicking an action toggles the sidebar and swaps its view content
 *   - Monaco editor node with data-uri and a textarea.inputarea (E1)
 *
 * This is STUB evidence, not live-host VALIDATED: it proves the adapter's
 * observe → act → observe → validate logic returns §9-shaped results. Real
 * github.dev actuation remains PARTIAL (VERIFICATION_REPORT.md).
 *
 * Dependency-free: node tests/adapter-flow.mjs
 */

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

/* ------------------------- miniature DOM ------------------------------- */

let activeElement = null;
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.classes = new Set();
    this.hidden = false;
    this.style = {};
    this.onClick = null;
    this.textContent = '';
  }
  setAttribute(n, v) { this.attrs.set(n, String(v)); if (n === 'id') this.id = String(v); if (n === 'class') this.className = String(v); }
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
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  click() { if (this.onClick) this.onClick(); }
  focus() { activeElement = this; }
  contains(o) { return o === this || this.querySelectorAll('*').includes(o); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  matches(sel) { return matchSegment(this, parseSegment(sel)); }
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
  let rest = text;
  const tagM = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagM) { seg.tag = tagM[0].toUpperCase(); rest = rest.slice(tagM[0].length); }
  const re = /([.#])?([\w-]+)(?:\[([^\]]+)\])?|\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(rest))) {
    if (m[1] === '.' || (m[2] && m[0].startsWith('.'))) seg.cls.push(m[2]);
    else if (m[1] === '#' || (m[2] && m[0].startsWith('#'))) seg.ids.push(m[2]);
    const attrText = m[3] || m[4];
    if (attrText) seg.attrs.push(parseAttr(attrText));
  }
  return seg;
}
function parseAttr(t) {
  const eq = t.match(/^([\w-]+)([~^$*|]?=)"?([^"]*)"?$/);
  if (eq) return { name: eq[1], op: eq[2], val: eq[3] };
  return { name: t, op: null, val: null };
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
  // The final segment matches the candidate element itself; preceding
  // segments are satisfied by ancestors (descendant combinator semantics).
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

function buildWorkbench() {
  const wb = new El('div');
  wb.classes.add('monaco-workbench');

  const titlebar = new El('div'); titlebar.className = 'part titlebar'; wb.append(titlebar);
  const activitybar = new El('div'); activitybar.className = 'part activitybar'; wb.append(activitybar);
  const sidebar = new El('div'); sidebar.className = 'part sidebar'; sidebar.hidden = true; wb.append(sidebar);
  const editorPart = new El('div'); editorPart.className = 'part editor'; wb.append(editorPart);
  const panel = new El('div'); panel.className = 'part panel'; panel.hidden = true; wb.append(panel);
  const statusbar = new El('div'); statusbar.className = 'part statusbar'; wb.append(statusbar);

  // Monaco editor with semantic data-uri + hidden inputarea.
  const editor = new El('div'); editor.className = 'monaco-editor'; editor.setAttribute('data-uri', 'file:///src/main.rs');
  const ta = new El('textarea'); ta.className = 'inputarea'; editor.append(ta);
  editorPart.append(editor);
  const tab = new El('div'); tab.className = 'tab active';
  const label = new El('div'); label.className = 'label-name'; label.textContent = 'main.rs'; tab.append(label);
  editorPart.append(tab);

  // Emulate VS Code: clicking a view action toggles the sidebar content.
  let activeView = null;
  function renderSidebar() {
    sidebar.children.slice().forEach((c) => sidebar.removeChild(c));
    wb.classList.toggle('nosidebar'); // ensure baseline below
    if (activeView) {
      wb.classes.delete('nosidebar');
      sidebar.hidden = false;
      const content = new El('div'); content.className = VIEW_META[activeView].contentClass;
      sidebar.append(content);
    } else {
      wb.classes.add('nosidebar');
      sidebar.hidden = true;
    }
  }
  wb.classes.add('nosidebar');
  Object.keys(VIEW_META).forEach((key) => {
    const item = new El('div'); item.className = 'action-item'; item.id = VIEW_META[key].id;
    const action = new El('a'); action.className = 'action-label'; action.setAttribute('aria-label', VIEW_META[key].label);
    action.onClick = () => { activeView = activeView === key ? null : key; renderSidebar(); };
    item.append(action);
    activitybar.append(item);
  });

  return { wb, sidebar, setView(v) { activeView = v; renderSidebar(); }, getView: () => activeView };
}

const host = buildWorkbench();

const body = new El('div'); body.tagName = 'BODY';
body.append(host.wb);

const document = {
  readyState: 'complete',
  body, head: new El('div'), documentElement: new El('div'),
  createElement: (t) => new El(t),
  getElementById: () => null,
  addEventListener() {}, removeEventListener() {},
  querySelector: (s) => body.querySelector(s),
  querySelectorAll: (s) => body.querySelectorAll(s),
  activeElement: null,
};
const listeners = [];
const fakeLocation = { hostname: 'github.dev', pathname: '/o/r', href: 'https://github.dev/o/r' };
const window = {
  location: fakeLocation,
  innerWidth: 412, innerHeight: 915,
  visualViewport: { width: 412, height: 915, offsetTop: 0, addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  history: { pushState() {}, replaceState() {}, back() {} },
  addEventListener(t, f) { listeners.push([t, f]); }, removeEventListener() {},
  dispatchEvent() { return true; },
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  getComputedStyle: (el) => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible' }),
  KeyboardEvent: class { constructor(t, i) { Object.assign(this, i || {}); } },
  MutationObserver: class { observe() {} disconnect() {} },
};
window.window = window;
Object.defineProperty(document, 'activeElement', { get: () => activeElement });

globalThis.window = window;
globalThis.document = document;
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Linux', userAgent: 'flow/node' }, configurable: true });
Object.defineProperty(globalThis, 'location', { value: { hostname: 'github.dev', pathname: '/o/r', href: 'https://github.dev/o/r' }, configurable: true });
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MutationObserver = window.MutationObserver;

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const K = require('../github-dev-mobile.user.js');

/* The adapter is DOM-bound and reached through the Node test export. */
const A = K.__adapter;
if (!A) {
  console.error('adapter export missing (set __adapter in TEST_EXPORTS)');
  process.exit(1);
}

/* ----------------------------- assertions -------------------------------- */

console.log('== Adapter detection & observation (§7/§14) ==');
const det = A.detect();
check('detect returns structured result', det.ok === true && det.operation === 'detect' && det.evidence.workbenchFound === true);
check('stub selector engine finds statusbar', host.wb.querySelectorAll('.part.statusbar').length === 1);
const obs0 = A.observe();
check('application.detected', obs0.application.detected === true, JSON.stringify(obs0.parts));
check('normalized surfaces present', ['editor', 'explorer', 'search', 'sourceControl', 'terminal'].every((k) => k in obs0.surfaces));
check('normalized viewport + route', obs0.viewport.width === 412 && /^https:/.test(obs0.route.url));
check('editor DETECTED with active file', obs0.surfaces.editor.present && obs0.surfaces.editor.activeFile.name === 'main.rs');
check('sidebar hidden initially -> views not visible', obs0.parts.sideBar.visible === false);
check('terminal NOT_DETECTED on github.dev stub', K.classifyCapabilities(obs0).terminal === K.CAP.NOT_DETECTED);
check('command palette UNKNOWN while closed', K.classifyCapabilities(obs0).commandPalette === K.CAP.UNKNOWN);
const caps0 = K.classifyCapabilities(obs0);
check('all structural caps present as expected',
  caps0.editor === 'DETECTED' && caps0.activityBar === 'DETECTED' && caps0.statusBar === 'DETECTED' &&
  caps0.explorer === K.CAP.NOT_DETECTED /* view content not rendered while sidebar closed */,
  JSON.stringify(caps0));

console.log('== Structured open/close operations (§9/§10/§31) ==');
function assertOpen(key, operation, surface) {
  const r = key === 'explorer' ? A.openExplorer() : key === 'search' ? A.openSearch() : A.openSourceControl();
  check(`${operation}: ok`, r.ok === true, JSON.stringify(r));
  check(`${operation}: operation name`, r.operation === operation);
  check(`${operation}: element found`, r.evidence.elementFound === true, JSON.stringify(r.evidence));
  check(`${operation}: invoked`, r.evidence.invoked === true);
  check(`${operation}: state transition VALIDATED`, r.evidence.stateChanged === true && r.evidence.level === 'VALIDATED',
    `level=${r.evidence.level} stateChanged=${r.evidence.stateChanged}`);
  const o = A.observe();
  check(`${operation}: normalized observation agrees`, o.parts.sideBar.visible === true && o.appSurface === surface);
  // Idempotent re-open reports already-open rather than re-invoking.
  const again = key === 'explorer' ? A.openExplorer() : key === 'search' ? A.openSearch() : A.openSourceControl();
  check(`${operation}: idempotent already-open`, again.ok === true && again.evidence.stateChanged === false && again.evidence.level === 'VALIDATED');
  const c = A.closePanels();
  check(`closePanels after ${operation}: VALIDATED`, c.ok === true && c.evidence.sidebarClosed === true && c.evidence.level === 'VALIDATED',
    JSON.stringify(c.evidence));
  check(`${operation}: closed observation`, A.observe().parts.sideBar.visible === false);
}
assertOpen('explorer', 'open-explorer', 'explorer');
assertOpen('search', 'open-search', 'search');
assertOpen('scm', 'open-source-control', 'sourceControl');

console.log('== Editor focus (§30) ==');
const f = A.focusEditor();
check('focus-editor structured + VALIDATED', f.ok === true && f.evidence.elementFound === true && f.evidence.stateChanged === true && f.evidence.level === 'VALIDATED',
  JSON.stringify(f.evidence));

console.log('== closePanels no-op semantics (§9 no silent failure) ==');
const nothing = A.closePanels();
check('closePanels when nothing open: ok/VALIDATED no-op', nothing.ok === true && nothing.evidence.stateChanged === false);

console.log('== Observer relevance & editor protection live in the adapter (I-02/§30) ==');
{
  const part = new El('div'); part.className = 'part sidebar';
  check('relevant: a part node', A.isRelevantNode(part) === true);
  const hostEditor = host.wb.querySelectorAll('.monaco-editor')[0];
  check('relevant: subtree containing Monaco editor', A.isRelevantNode(host.wb) === true && A.isRelevantNode(hostEditor) === true);
  const owned = new El('div'); owned.setAttribute('data-gmux-owner', 'github-dev-mobile');
  check('owned nodes are never relevant mutations', A.isRelevantNode(owned) === false);
  const neutral = new El('p');
  check('neutral node is not relevant', A.isRelevantNode(neutral) === false);
  const ta = host.wb.querySelectorAll('.monaco-editor textarea')[0];
  check('protected: Monaco textarea', A.isProtectedTarget(ta) === true);
  const input = new El('input');
  check('protected: input controls', A.isProtectedTarget(input) === true);
  const outside = new El('div');
  check('unprotected: neutral surface', A.isProtectedTarget(outside) === false);
  void hostEditor;
}

console.log('== Failure honesty when host disappears (§45/§46) ==');
const removed = body.removeChild(host.wb);
const det2 = A.detect();
check('detect reports APPLICATION_NOT_DETECTED after removal', det2.ok === false && det2.reason === K.FAIL.APPLICATION_NOT_DETECTED);
const obsGone = A.observe();
check('observation degrades to application.detected=false', obsGone.application.detected === false);
check('capabilities collapse to UNKNOWN (never fabricated false-absent)',
  Object.values(K.classifyCapabilities(obsGone)).every((v) => v === K.CAP.UNKNOWN));
const openGone = A.openExplorer();
check('openExplorer failure structured', openGone.ok === false && openGone.reason === K.FAIL.EXPLORER_NOT_DETECTED &&
  openGone.evidence.elementFound === false);
body.append(removed); // restore

console.log(`\nadapter-flow: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
