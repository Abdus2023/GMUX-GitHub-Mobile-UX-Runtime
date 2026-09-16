#!/usr/bin/env node
/**
 * GMUX Phase B/C evidence suite — reconnaissance, privacy boundary, fixtures,
 * mutation safety, and the action-engine transaction contract.
 *
 * Dependency-free: node tests/recon-fixtures.mjs
 *
 * What this proves (pack §42–§55):
 *   · recon emits the §46 schema and nothing else, and mutates nothing (§42);
 *   · the §43 privacy boundary holds against planted content sentinels — file
 *     names, editor text, terminal output, input values and token-like
 *     attributes never reach the evidence;
 *   · candidates stay `candidate`: recon output is EVIDENCE, never capability
 *     (§46/§47), and nothing is auto-converted into a selector (§50);
 *   · §51 strategy preference is reported per candidate;
 *   · §48 destructive verbs are refused, and interactions need authorisation;
 *   · §55 mutations of the known-good host degrade to no-candidate/BLOCKED and
 *     never produce a false VERIFIED;
 *   · §54 golden state holds for a verified mapping: CLOSED → OPEN → CLOSED,
 *     with the commit taken only after an observed transition (§16/§18/§69);
 *   · §52 drift of a committed surface retreats and records, never silent.
 *
 * The "verified mapping" used here is supplied BY THE TEST as a swap-in
 * adapter: the shipped artifact still contains no GitHub selector at all, and
 * the fake host lives in this file. That keeps the Phase C contract exercisable
 * without smuggling Phase C knowledge into v0.1 (§12/§13/§72).
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, createDocument, parseHTML, serialize } from './lib/mini-dom.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const RECON_FILE = join(root, 'gmux-recon.user.js');
const RUNTIME_FILE = join(root, 'github-dev-mobile.user.js');

const R = require(RECON_FILE);
let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name + (detail ? ` — ${detail}` : ''));
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(t) { console.log(`\n== ${t} ==`); }
const reconSrc = readFileSync(RECON_FILE, 'utf8');
const reconCode = reconSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');

/* --------------------------- the fake host page --------------------------- */

const CONTENT_SENTINELS = [
  'repository.rs', 'secrets.env', 'SECRETCODELINE', 'ghp_LEAK', 'TERMINAL_OUTPUT',
  'SECRETPATH', 'rm -rf', 'passwd', 'cpptools',
];

/** A github.dev-shaped workbench built from semantics only (no GMUX classes). */
const HOST_HTML = `
<div class="workbench">
  <div role="toolbar" aria-label="Activity Bar">
    <button id="act-explorer" aria-label="Explorer" title="Explorer (Ctrl+Shift+E)">Ex</button>
    <button id="act-search" aria-label="Search" title="Search (Ctrl+Shift+F)">Se</button>
    <button id="act-scm" aria-label="Source Control">Sc</button>
    <button id="act-run" aria-label="Run and Debug">Run</button>
    <button id="act-ext" aria-label="Extensions">Ext</button>
    <button id="act-term" role="button" aria-label="Terminal">T</button>
    <button id="act-commit" aria-label="Git: Commit">Cm</button>
    <button id="act-kill" aria-label="Terminal: kill">K</button>
    <button id="act-publish" aria-label="Publish Branch">P</button>
  </div>
  <div class="sidebar" role="tree" aria-label="Files" data-host-role="explorer" aria-hidden="true">
    <div role="treeitem" aria-label="src/repository.rs">src/repository.rs</div>
    <li>secrets.env</li>
  </div>
  <div class="editor monaco-editor">
    <div class="view-lines">SECRETCODELINE const t = "ghp_LEAK";</div>
    <input aria-label="Search Editor" value="SECRETPATH/etc/passwd">
  </div>
  <div class="terminal xterm" aria-label="Terminal Output">TERMINAL_OUTPUT rm -rf /home/user</div>
  <button title="Extensions" data-extension-id="ms-vscode.cpptools">E</button>
  <button id="workbench.view.explorer" class="action-label">Explorer panel toggle that carries a deliberately very long visible label used to prove truncation</button>
  <button>Search</button>
  <span aria-label="Explorer">not a control</span>
</div>`;

function makeDoc(html = HOST_HTML) {
  const doc = createDocument({});
  const parsed = parseHTML(html, doc);
  while (parsed.children.length) doc.body.appendChild(parsed.children[0]);
  // The harness needs non-zero boxes for visibility; mark every element visible.
  const mark = (el) => { if (el.tagName !== 'BODY') el.setAttribute('data-rect', '4:120:48:48'); el.children.forEach(mark); };
  mark(doc.body);
  // `data-rect` is a harness affordance, so strip it from the collected `data`
  // by renaming the attribute the recon reader would see.
  return doc;
}

function payloadFor(html, opts) {
  const doc = makeDoc(html);
  return R.buildReconPayload(doc, { environment: { width: 412, height: 915, touchPoints: 5, coarsePointer: true }, timestamp: '2026-09-15T00:00:00.000Z', ...(opts || {}) });
}

/* -------------------------- 1. §46 payload schema ------------------------ */
section('Recon payload schema (§46)');
const payload = payloadFor();
check('schema id is gmux.recon/v1', payload.schema === 'gmux.recon/v1');
check('host is github.dev', payload.host === 'github.dev');
check('timestamp present', typeof payload.timestamp === 'string' && payload.timestamp.includes('2026'));
check('environment block has the four observed fields',
  ['width', 'height', 'touchPoints', 'coarsePointer'].every((k) => k in payload.environment));
check('environment values are numbers/booleans',
  typeof payload.environment.width === 'number' && typeof payload.environment.coarsePointer === 'boolean');
check('candidates is an array', Array.isArray(payload.candidates));
check('payload declares itself as EVIDENCE, not capability',
  payload.interpretation.isVerifiedCapability === false && /EVIDENCE/.test(payload.interpretation.meaning));
check('payload names the human review step (§50)', /human review/.test(payload.interpretation.nextStep));
check('no payload field claims VERIFIED', !/"VERIFIED"/.test(JSON.stringify(payload)));
check('discovery bookkeeping is present', payload.discovery.scanned > 0 && typeof payload.discovery.truncated === 'boolean');

/* ---------------------- 2. §44/§45/§47 candidate shape ------------------ */
section('Candidate discovery and fingerprints (§44/§45/§47)');
const bySurface = (p, s) => p.candidates.filter((c) => c.surface === s);
check('Explorer candidate found', bySurface(payload, 'explorer').length >= 1);
check('Search candidate found', bySurface(payload, 'search').length >= 1);
check('Source Control candidate found', bySurface(payload, 'sourceControl').length >= 1);
check('Terminal candidate found', bySurface(payload, 'terminal').length >= 1);
check('Run/Debug + Extensions land in the unmapped bucket, not a surface',
  bySurface(payload, 'other').length >= 2);
check('no candidate claims a GMUX surface that was not in the vocabulary',
  payload.candidates.every((c) => ['explorer', 'search', 'sourceControl', 'terminal', 'other'].includes(c.surface)));
const explorer = bySurface(payload, 'explorer')[0];
for (const field of ['tag', 'role', 'ariaLabel', 'title', 'data', 'snippet', 'parentRoles', 'depth', 'rect', 'visible', 'disabled']) {
  check(`§45 fingerprint field recorded: ${field}`, field in explorer, `missing ${field}`);
}
check('rect is a bounded numeric box', explorer.rect && ['x', 'y', 'width', 'height'].every((k) => typeof explorer.rect[k] === 'number'));
check('confidence is the string "candidate" for every candidate',
  payload.candidates.every((c) => c.confidence === 'candidate'));
check('every candidate carries evidence with type and value (§47)',
  payload.candidates.every((c) => Array.isArray(c.evidence) && c.evidence.length > 0 && c.evidence.every((e) => 'type' in e && 'value' in e)));
check('explorer evidence names the winning signal', explorer.evidence.some((e) => e.type === explorer.strategy));
check('parent roles are recorded as role names', Array.isArray(explorer.parentRoles));
check('depth is a number', typeof explorer.depth === 'number');
check('bounded candidate count (§45)', payload.candidates.length <= R.MAX_CANDIDATES);
check('long labels are truncated, not dumped',
  payload.candidates.every((c) => !c.snippet || c.snippet.length <= R.MAX_SNIPPET_CHARS + 1));
check('a non-control with a matching aria-label is skipped as content',
  payload.candidates.every((c) => c.tag === 'button' || c.tag === 'a' || c.role === 'button' || c.role === 'tab' || c.role === 'menuitem' || c.role === 'link'));

/* --------------------------- 3. §43 privacy ------------------------------ */
section('Privacy boundary holds against planted content (§43)');
const dump = JSON.stringify(payload);
for (const sentinel of CONTENT_SENTINELS) {
  check(`never collected: ${sentinel}`, !dump.includes(sentinel), 'sentinel leaked into recon output');
}
const overBudget = payload.candidates.flatMap((c) => [
  ...Object.entries(c.data).map(([k, v]) => ['data.' + k, v]),
  ['title', c.title], ['ariaLabel', c.ariaLabel], ['snippet', c.snippet],
].filter(([, v]) => typeof v === 'string' && v.length > (v === c.snippet ? R.MAX_SNIPPET_CHARS : R.MAX_TITLE_CHARS) + 1));
check('no payload string exceeds its truncation budget', overBudget.length === 0,
  JSON.stringify(overBudget));
check('snippets specifically stay short', payload.candidates.every((c) => !c.snippet || c.snippet.length <= R.MAX_SNIPPET_CHARS + 1));
check('recon never reads form control values', !/\b(el|element|node|input|textarea|field|target)\.value\b/.test(reconCode));
check('recon reads no cookies, storage or credential APIs',
  !/document\.cookie|localStorage|sessionStorage|indexedDB|\.credentials\b|document\.querySelector\(['"][^'"]*\bpassword\b/i.test(reconCode));
check('recon actively filters credential-shaped attributes',
  /authorization/i.test(reconCode) && /token/.test(reconCode));
check('recon never uses the network',
  !/fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|GM_xmlhttpRequest|import\(/.test(reconCode));
check('recon output field set is closed and small', (() => {
  const allowed = new Set(['surface', 'confidence', 'strength', 'tag', 'role', 'ariaLabel', 'title', 'data', 'snippet',
    'parentRoles', 'depth', 'rect', 'visible', 'disabled', 'strategy', 'strategyRank', 'matchToken', 'evidence']);
  return payload.candidates.every((c) => Object.keys(c).every((k) => allowed.has(k)));
})(), payload.candidates[0] && Object.keys(payload.candidates[0]).join(','));

/* ------------------------- 4. §51 strategy preference ------------------- */
section('Selector strategy preference is reported (§51)');
check('aria-label outranks title', explorer.strategy === 'aria-label' && explorer.strategyRank === 1);
const titleOnly = R.identifyStrategy({ tagName: 'BUTTON', textContent: 'x', getAttribute: (n) => (n === 'title' ? 'Extensions' : null) });
check('title is the second strategy', titleOnly.strategy === 'title' && titleOnly.rank === 2);
const idOnly = R.identifyStrategy({ tagName: 'BUTTON', textContent: 'x', getAttribute: (n) => (n === 'id' ? 'workbench.view.explorer' : null) });
check('stable id is the third strategy', idOnly.strategy === 'stable-id' && idOnly.rank === 3);
const roleOnly = R.identifyStrategy({ tagName: 'DIV', textContent: 'Explorer', getAttribute: (n) => (n === 'role' ? 'button' : null) });
check('role+name is the fourth strategy', roleOnly.strategy === 'role+name' && roleOnly.rank === 4);
check('structure is last', R.identifyStrategy({ tagName: 'BUTTON', textContent: 'Search', getAttribute: () => null }).strategy === 'structure');
check('every candidate reports the strategy that matched',
  payload.candidates.every((c) => ['aria-label', 'title', 'stable-id', 'role+name', 'structure'].includes(c.strategy)));
check('CSS classes are not used as identity', !payload.candidates.some((c) => c.strategy === 'class'));

/* --------------------- 5. §48/§49 interaction authorisation -------------- */
section('Safe interactions only, and only when authorised (§48/§49)');
check('read-only by default: no allowInteraction → BLOCKED',
  R.planInteraction('explorer', {}).status === 'BLOCKED' && /not authorised/.test(R.planInteraction('explorer', {}).reason));
check('unknown commands are refused',
  R.planInteraction('explorer', { allowInteraction: true, command: 'kill-terminal' }).status === 'BLOCKED');
check('off-surface commands are refused',
  R.planInteraction('explorer', { allowInteraction: true, command: 'open-search' }).status === 'BLOCKED');
check('open-explorer is on the safe list', R.planInteraction('explorer', { allowInteraction: true, command: 'open-explorer' }).ok === true);
check('safe list contains no destructive command',
  Object.keys(R.SAFE_INTERACTIONS).every((c) => !R.isDestructiveLabel(c)));
for (const verb of ['commit', 'push', 'delete', 'rename', 'merge', 'publish', 'discard', 'kill', 'reset', 'install']) {
  check(`denylist refuses: ${verb}`, R.isDestructiveLabel(`Git: ${verb} everything`) === true);
}
check('denylist does not refuse plain surface names',
  !R.isDestructiveLabel('Explorer') && !R.isDestructiveLabel('Search') && !R.isDestructiveLabel('Terminal'));
check('destructive candidates are excluded from discovery',
  payload.candidates.every((c) => !R.isDestructiveLabel(`${c.ariaLabel || ''} ${c.title || ''} ${c.snippet || ''}`)));
check('the denylist run is counted in bookkeeping', payload.discovery.skipped.destructive >= 1);
check('recon exposes only the three safe commands', R.Recon.safeInteractions.length === 3);

/* ----------------------------- 6. §50 boundary --------------------------- */
section('Recon never becomes a code generator (§50)');
check('candidates carry no selector field',
  payload.candidates.every((c) => !('selector' in c) && !('cssSelector' in c) && !('xpath' in c)));
check('no candidate carries a CSS class value', !payload.candidates.some((c) => (c.className || '').length));
const runtimeSrc = readFileSync(RUNTIME_FILE, 'utf8');
const runtimeCode = runtimeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
check('the shipped runtime never calls into recon', !/GMUXRecon|GMUXRecon\.|Recon\.run/.test(runtimeCode));
check('the shipped runtime never imports recon', !/require\(|import\s+.*recon|import\(/i.test(runtimeCode));
check('the runtime carries no recon activation path or payload handling',
  !/["']recon["']|ACTIVATE_VALUE|buildReconPayload/.test(runtimeCode));
check('the runtime adapter still has zero host lookups',
  /findExplorer\(\) \{\n    return null;\n  \}/.test(runtimeSrc) || /findExplorer\(\) \{ return null; \}/.test(runtimeSrc));
check('recon declares the required progression', /human review → adapter definition → fixture → interaction verification/.test(R.buildReconPayload.toString() + JSON.stringify(payload.interpretation)));

/* ------------------------------ 7. §42 read-only ------------------------ */
section('Recon modifies nothing (§42)');
{
  const doc = makeDoc();
  const before = serialize(doc.body);
  R.buildReconPayload(doc, { environment: { width: 1, height: 1, touchPoints: 0, coarsePointer: false } });
  R.discoverCandidates(doc, { allowHidden: true });
  R.structureDigest(doc);
  check('host subtree byte-identical after discovery', serialize(doc.body) === before);
  check('recon creates no elements', !/document\.createElement|createElement\(/.test(reconCode));
  check('recon appends nothing', !/appendChild|append\(|insertBefore|replaceChildren/.test(reconCode));
  check('recon writes no attributes or classes', !/setAttribute|classList|\.style\.|innerHTML|textContent\s*=/.test(reconCode));
  check('recon injects no style node', !/data-gmux-style|<style|GMUX_CSS/.test(reconCode));
  check('recon does not touch history', !/history\.|pushState|popstate/.test(reconCode));
  check('recon activates only on ?gmux=recon', /ACTIVATE_VALUE = "recon"/.test(reconSrc) && /searchParams\.get\(ACTIVATE_PARAM\)/.test(reconSrc));
  const meta = (reconSrc.match(/==UserScript==([\s\S]*?)==\/UserScript==/) || [])[1] || '';
  check('recon metadata: grant none, no require, github.dev only',
    /@grant\s+none/.test(meta) && !/@require|@connect|@resource/.test(meta) && (meta.match(/@match\s+(\S+)/g) || []).length === 1);
}

/* --------------------------- 8. §55 mutation matrix --------------------- */
section('Mutation tests degrade, never falsely verify (§55)');
const mutations = {
  'aria label changed': (d) => d.getElementById('act-explorer').setAttribute('aria-label', 'File Browser'),
  'button removed': (d) => d.getElementById('act-explorer').remove(),
  'container moved': (d) => { const t = d.querySelector('[data-host-role="explorer"]'); d.querySelector('.editor').appendChild(t); },
  'panel renamed': (d) => d.querySelector('[data-host-role="explorer"]').setAttribute('aria-label', 'Repository View'),
  'visibility changed': (d) => { d.getElementById('act-explorer').hidden = true; },
  'duplicate candidate added': (d) => { const b = d.createElement('button'); b.setAttribute('aria-label', 'Explorer'); d.querySelector('.workbench').appendChild(b); },
  'role changed': (d) => d.getElementById('act-term').setAttribute('role', 'treeitem'),
  'irrelevant candidate added': (d) => { const b = d.createElement('button'); b.setAttribute('aria-label', 'Banana'); d.querySelector('.workbench').appendChild(b); },
};
const baseline = payload;
for (const [name, mutate] of Object.entries(mutations)) {
  const doc = makeDoc();
  mutate(doc);
  const p = R.buildReconPayload(doc, { environment: { width: 412, height: 915, touchPoints: 5, coarsePointer: true } });
  const json = JSON.stringify(p);
  check(`${name}: no VERIFIED claim`, !/"VERIFIED"/.test(json) && p.candidates.every((c) => c.confidence === 'candidate'));
  check(`${name}: content sentinels still absent`, CONTENT_SENTINELS.every((s) => !json.includes(s)));
  check(`${name}: only interaction controls are collected`, p.candidates.every((c) =>
    c.tag === 'button' || c.tag === 'a' || ['button', 'tab', 'menuitem', 'link'].includes(c.role)));
  check(`${name}: discovery still terminates within bounds`, p.candidates.length <= R.MAX_CANDIDATES && p.discovery.scanned > 0);
  if (name === 'aria label changed') {
    check(`${name}: relabel moves the element out of the vocabulary (no silent remap)`,
      p.discovery.skipped.nonSemantic > baseline.discovery.skipped.nonSemantic);
    check(`${name}: no candidate keeps the old accessible name`, !p.candidates.some((c) => c.ariaLabel === 'Explorer' && c.data.id === 'act-explorer'));
  }
  if (name === 'button removed') {
    check(`${name}: the removed control is simply absent from evidence`, !p.candidates.some((c) => c.data.id === 'act-explorer'));
    check(`${name}: candidate count decreases rather than being filled in`, p.candidates.length < baseline.candidates.length);
  }
  if (name === 'visibility changed') {
    check(`${name}: hidden control counted as skipped-invisible`, p.discovery.skipped.invisible >= 1);
    check(`${name}: hidden control is not reported as usable`, !p.candidates.some((c) => c.data.id === 'act-explorer' && c.visible));
  }
  if (name === 'role changed') {
    check(`${name}: terminal demoted to content, not kept as a control`, !p.candidates.some((c) => c.data.id === 'act-term'));
    check(`${name}: demotion is counted`, p.discovery.skipped.content > baseline.discovery.skipped.content);
  }
  if (name === 'duplicate candidate added') {
    check(`${name}: duplicates are surfaced for human review, not resolved silently`,
      p.candidates.filter((c) => c.surface === 'explorer').length >= 2);
  }
  if (name === 'irrelevant candidate added') {
    check(`${name}: unknown labels are skipped, not classified`, !p.candidates.some((c) => c.ariaLabel === 'Banana'));
  }
  if (name === 'panel renamed' || name === 'container moved') {
    check(`${name}: structural churn does not create a new verified surface`,
      p.candidates.every((c) => c.confidence === 'candidate' && !c.operational && !c.verified));
  }
}

/* ----------------------------- 9. §53 fixtures ------------------------- */
section('Fixture format (§53)');
const fixtureDir = join(root, 'fixtures/github-dev');
const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort();
check('the six §53 fixtures exist', eqArrays(fixtureFiles,
  ['explorer-closed.json', 'explorer-open.json', 'mobile-layout.json', 'search.json', 'source-control.json', 'terminal.json']),
  fixtureFiles.join(','));
for (const file of fixtureFiles) {
  const fx = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  check(`${file}: schema is gmux.fixture/v1`, fx.schema === 'gmux.fixture/v1');
  check(`${file}: has surface/state/elements`, 'surface' in fx && 'state' in fx && Array.isArray(fx.elements));
  check(`${file}: elements are role+name+visible only`,
    fx.elements.every((e) => Object.keys(e).every((k) => ['role', 'name', 'visible', 'pressed', 'selected', 'disabled'].includes(k))),
    JSON.stringify(fx.elements[0] || {}));
  check(`${file}: carries no selector or class`,
    !/class=|\.[a-z-]+\s*\{|#gmux|querySelector/i.test(JSON.stringify(fx)));
  check(`${file}: status is not VERIFIED`, fx.status !== 'VERIFIED' && fx.verification === 'UNVALIDATED_LIVE');
  check(`${file}: provenance names the review requirement`, /not live-validated|EVIDENCE ONLY/i.test(fx.provenance));
}
{
  const open = JSON.parse(readFileSync(join(fixtureDir, 'explorer-open.json'), 'utf8'));
  const closed = JSON.parse(readFileSync(join(fixtureDir, 'explorer-closed.json'), 'utf8'));
  check('explorer open/closed pair differs exactly in state fields',
    open.surface === closed.surface && open.state === 'open' && closed.state === 'closed');
  check('closed fixture states the golden-state invariant', /CLOSED → OPEN → CLOSED/.test(closed.goldenStateInvariant));
  check('terminal fixture treats absence as a valid observation', /NOT a failure/.test(JSON.stringify(
    JSON.parse(readFileSync(join(fixtureDir, 'terminal.json'), 'utf8')))));
  const layout = JSON.parse(readFileSync(join(fixtureDir, 'mobile-layout.json'), 'utf8'));
  check('mobile-layout records the §32 scroll ownership table',
    layout.scrollOwnership && layout.scrollOwnership.editor === 'host' && layout.scrollOwnership.diagnostics === 'gmux' && layout.scrollOwnership.shellBackground === 'none');
  check('mobile-layout records the CSS-first drawer strategy (§30)', /CSS positioning first/.test(layout.drawerStrategy));
}
function eqArrays(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }

/* ------------------- 10. §54/§16/§18/§69 transaction path -------------- */
section('Action engine transaction + golden state (harness-supplied verified mapping)');
let runtime = null;
let handle = null;
try {
  handle = install({ width: 412, height: 915, touchPoints: 5, coarsePointer: true, hostHTML: HOST_HTML });
  delete require.cache[require.resolve(RUNTIME_FILE)];
  runtime = require(RUNTIME_FILE);
  await handle.settle();

  const doc = handle.doc;
  const host = { toggles: 0, failTransition: false, restored: 0 };
  const surfaceEl = () => doc.querySelector('[data-host-role="explorer"]');
  const isOpen = () => surfaceEl() && surfaceEl().getAttribute('aria-hidden') === 'false';
  const snapshotOpen = () => (surfaceEl() ? surfaceEl().getAttribute('aria-hidden') : null);

  const verifiedAdapter = {
    id: 'github-dev',
    revision: 1,
    detectEnvironment: () => true,
    observe() {
      const present = !!surfaceEl();
      const open = !!present && isOpen();
      return {
        explorer: present
          ? { detected: true, open, confidence: 'HIGH', strategy: 'aria-label', evidence: [{ type: 'presence', value: open ? 'open' : 'closed' }] }
          : null,
        editor: { detected: true, open: true, confidence: 'HIGH', strategy: 'structure', evidence: [] },
        search: { detected: false, open: false, confidence: 'HIGH', strategy: 'aria-label', evidence: [] },
        sourceControl: { detected: false, open: false, confidence: 'HIGH', strategy: 'aria-label', evidence: [] },
        terminal: null,
      };
    },
    resolveSurface(surface) {
      if (surface === 'explorer' || surface === 'editor') return { status: 'VERIFIED', surface, reason: null };
      return { status: 'BLOCKED', surface, reason: 'no reviewed mapping for this surface' };
    },
    invoke(action) {
      host.toggles++;
      if (!surfaceEl()) return { ok: false, status: 'BLOCKED', reason: 'host element missing' };
      if (host.failTransition) return { ok: true };                       // "success" with no effect
      surfaceEl().setAttribute('aria-hidden', action === 'open-explorer' ? 'false' : 'true');
      return { ok: true, status: 'PROVISIONAL' };
    },
    verify() { return { status: 'BLOCKED', reason: 'adapter defers to the observed transition' }; },
    restore(snapshot) {
      host.restored++;
      if (surfaceEl() && snapshot && snapshot.explorer) {
        surfaceEl().setAttribute('aria-hidden', snapshot.explorer.open ? 'false' : 'true');
      }
      return { status: 'PROVISIONAL', restored: true };
    },
    findEditor: () => null, findExplorer: () => null, findSearch: () => null,
    findSourceControl: () => null, findTerminal: () => null,
  };

  const hostBefore = snapshotOpen();
  runtime.__setAdapter(verifiedAdapter);
  runtime.reconcile();
  check('capabilities re-derived from the swapped adapter', runtime.GMUX.state.capabilities.explorer === true);
  check('search stays undetected and therefore disabled', runtime.GMUX.state.capabilities.search === false);
  const explorerBtn = doc.getElementById('gmux-cmd-explorer');
  check('a VERIFIED surface enables its control (§26)', explorerBtn.getAttribute('aria-disabled') === 'false');
  check('a BLOCKED surface stays disabled', doc.getElementById('gmux-cmd-search').getAttribute('aria-disabled') === 'true');

  const openResult = await runtime.requestSurface('explorer', 'open');
  check('open verified against the observed transition (§19)', openResult.status === 'VERIFIED', JSON.stringify(openResult));
  check('verification evidence records closed → open',
    openResult.evidence.before === 'closed' && openResult.evidence.after === 'open');
  check('host element actually opened', isOpen() === true);
  check('state committed only after verification (§69)', runtime.GMUX.state.surface === 'explorer');
  check('pending action cleared on commit', runtime.GMUX.state.pendingAction === null);
  check('previous surface recorded', runtime.GMUX.state.previousSurface === 'editor');
  check('drawer opened for the committed surface', runtime.GMUX.state.drawer.surface === 'explorer');
  await handle.settle();
  check('toolbar control reflects the committed surface', explorerBtn.getAttribute('aria-pressed') === 'true');
  check('drawer explains the verified presentation', /positions this window/.test(doc.getElementById('gmux-drawer-body').textContent));

  const closeResult = await runtime.requestSurface('explorer', 'close');
  check('close verified', closeResult.status === 'VERIFIED', JSON.stringify(closeResult));
  check('golden state: host returned to its initial value', snapshotOpen() === hostBefore);
  check('golden state: GMUX surface back to editor', runtime.GMUX.state.surface === 'editor');
  check('golden state: drawer closed', runtime.GMUX.state.drawer === null);
  check('engine ran exactly two host operations', host.toggles === 2);

  /* ---- §18 FAIL → RESTORE: a call that succeeds but changes nothing ---- */
  host.failTransition = true;
  const beforeFail = snapshotOpen();
  const fakeResult = await runtime.requestSurface('explorer', 'open');
  host.failTransition = false;
  check('a no-op invocation never verifies', fakeResult.status === 'BLOCKED', JSON.stringify(fakeResult));
  check('the reason names the missing transition',
  /no state transition was observed|expected open, observed closed/.test(String(fakeResult.reason)), String(fakeResult.reason));
  check('restore path ran for a reversible action', fakeResult.restore === 'PROVISIONAL' && host.restored >= 1);
  check('no commit on failure (§69 REJECT)', runtime.GMUX.state.surface === 'editor');
  check('pending cleared after failure', runtime.GMUX.state.pendingAction === null);
  check('host left where it was', snapshotOpen() === beforeFail);

  /* ---- §52 drift on a committed surface ---- */
  await runtime.requestSurface('explorer', 'open');
  check('re-opened for the drift scenario', runtime.GMUX.state.surface === 'explorer');
  surfaceEl().setAttribute('data-host-role', 'gone');       // the verified mapping disappears
  runtime.reconcile();
  await handle.settle();
  check('drift retreats the surface to editor (§52)', runtime.GMUX.state.surface === 'editor');
  check('drift is logged, never silent', runtime.log.events.some((e) => /adapter drift/.test(e.message)));
  check('drift shows a reason in the shell', /disappeared from the host/.test(doc.getElementById('gmux-reason').textContent));
  check('the control is disabled again after drift', doc.getElementById('gmux-cmd-explorer').getAttribute('aria-disabled') === 'true');
  const hostAfterDrift = serialize(doc.querySelector('.workbench'));
  check('the host subtree is still GMUX-free', !/data-gmux-owner|gmux-/.test(hostAfterDrift));

  /* ---- §56/§57 revision independence ---- */
  const fpZero = runtime.hostFingerprint(runtime.observeSurfaces(runtime.GitHubDevAdapter).records);
  runtime.GMUX.adapter = verifiedAdapter;
  const fpOne = runtime.hostFingerprint(runtime.observeSurfaces(verifiedAdapter).records);
  check('fingerprint changes when the mapping set changes', fpZero.value !== fpOne.value);
  check('GMUX version is independent of adapter revision', runtime.VERSION === '0.1.0' && verifiedAdapter.revision === 1);
  check('compatibility rises to PARTIALLY_VERIFIED with a mapped adapter', fpOne.compatibility === 'PARTIALLY_VERIFIED');
  check('fingerprint inputs name the §57 sources',
    /controls=.*workbench=.*capabilities=\d+;revision=1/.test(fpOne.payload), fpOne.payload);
} catch (e) {
  check('transaction path ran without throwing', false, `${e && e.message}\n${e && e.stack}`);
} finally {
  if (handle) { await handle.settle(2); handle.uninstall(); }
}

/* --------------------- 11. runtime stays BLOCKED (no swap) -------------- */
section('Shipped runtime: no verified mapping, so no claim (§68)');
{
  const h = install({ width: 412, height: 915, hostHTML: HOST_HTML });
  delete require.cache[require.resolve(RUNTIME_FILE)];
  const K = require(RUNTIME_FILE);
  await h.settle();
  const r = K.GMUX.inspect();
  check('adapter revision stays 0 in the shipped runtime', K.GMUX.adapter.revision === 0);
  check('all surfaces BLOCKED', Object.values(r.surfaces).every((s) => s.operation === 'BLOCKED'));
  check('all confidence UNKNOWN', Object.values(r.surfaces).every((s) => s.confidence === 'UNKNOWN'));
  check('detection ≠ verification', Object.values(r.surfaces).every((s) => s.detection !== 'verified'));
  check('runtime status vocabulary never leaves §19',
    Object.values(r.surfaces).every((s) => ['VERIFIED', 'PARTIALLY_VERIFIED', 'PROVISIONAL', 'BLOCKED'].includes(s.operation)));
  check('UNKNOWN is kept as UNKNOWN, not false', r.surfaces.explorer.confidence === 'UNKNOWN');
  h.uninstall();
}

/* --------------------- 12. §55 mutation → runtime honesty -------------- */
section('Broken recognition degrades in the runtime too (§55)');
{
  const h = install({ width: 412, height: 915, hostHTML: HOST_HTML });
  delete require.cache[require.resolve(RUNTIME_FILE)];
  const K = require(RUNTIME_FILE);
  await h.settle();
  const doc = h.doc;
  // A "verified" adapter whose evidence is then mutated to LOW confidence.
  const surfaceEl = () => doc.querySelector('[data-host-role="explorer"]');
  let confidence = 'HIGH';
  const adapter = {
    id: 'github-dev', revision: 2, detectEnvironment: () => true,
    observe: () => ({
      explorer: {
        detected: !!surfaceEl(),
        open: !!surfaceEl() && surfaceEl().getAttribute('aria-hidden') === 'false',
        confidence, strategy: 'aria-label', evidence: [],
      },
      editor: null, search: null, sourceControl: null, terminal: null,
    }),
    resolveSurface: () => ({ status: 'VERIFIED', surface: 'explorer', reason: null }),
    invoke: () => { surfaceEl().setAttribute('aria-hidden', 'false'); return { ok: true }; },
    verify: () => ({ status: 'BLOCKED', reason: 'defer' }),
    restore: () => ({ status: 'PROVISIONAL' }),
    findEditor: () => null, findExplorer: () => null, findSearch: () => null, findSourceControl: () => null, findTerminal: () => null,
  };
  K.__setAdapter(adapter);
  K.reconcile();
  confidence = 'LOW';                       // mutation: the semantic signal degraded
  const res = await K.requestSurface('explorer', 'open');
  check('degraded confidence blocks verification', res.status === 'BLOCKED', JSON.stringify(res));
  check('the reason names the confidence shortfall', /below HIGH/.test(String(res.reason)), String(res.reason));
  check('no commit on degraded evidence', K.GMUX.state.surface === 'editor');
  confidence = 'HIGH';
  surfaceEl().setAttribute('aria-hidden', 'true');   // put the host back to closed
  K.reconcile();
  const ok = await K.requestSurface('explorer', 'open');
  check('recovered confidence verifies again', ok.status === 'VERIFIED', JSON.stringify(ok));
  h.uninstall();
}

/* ---------------- 13. prior-phase HTML fixtures as inputs --------------- */
section('Prior-phase HTML fixtures — recon input, never runtime input');
{
  const dir = join(root, 'fixtures');
  const htmlFixtures = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  check('the seven minimal recognition fixtures still exist', htmlFixtures.length === 7, htmlFixtures.join(','));
  let totalCandidates = 0;
  for (const file of htmlFixtures) {
    const html = readFileSync(join(dir, file), 'utf8');
    const doc = createDocument({});
    const parsed = parseHTML(html, doc);
    while (parsed.children.length) doc.body.appendChild(parsed.children[0]);
    const mark = (el) => { if (el.tagName !== 'BODY') el.setAttribute('data-rect', '4:120:48:48'); el.children.forEach(mark); };
    mark(doc.body);
    const before = serialize(doc.body);
    const p = R.buildReconPayload(doc, { environment: { width: 412, height: 915, touchPoints: 5, coarsePointer: true } });
    const json = JSON.stringify(p);
    totalCandidates += p.candidates.length;
    check(`${file}: discovery runs and terminates`, p.discovery.scanned >= 0 && p.candidates.length >= 0);
    check(`${file}: host subtree untouched by discovery`, serialize(doc.body) === before);
    check(`${file}: nothing is promoted from an HTML fixture`, !/"VERIFIED"/.test(json)
      && p.candidates.every((c) => c.confidence === 'candidate'));
    check(`${file}: no fixture text beyond UI tokens is collected`,
      !/\.rs\b|\.js\b|\.ts\b/.test(p.candidates.map((c) => c.snippet || '').join(' ')),
      p.candidates.map((c) => c.snippet).filter(Boolean).join(','));
  }
  check('the fixtures yield at least one candidate in total', totalCandidates >= 5, `total=${totalCandidates}`);
  check('the runtime reads no files and no fixtures', !/readFileSync|require\(|import\(|XMLHttpRequest|fetch\(/.test(runtimeCode));
  check('the runtime names no filesystem path', !/[A-Za-z_/-]*fixtures\//.test(runtimeCode));
}

/* ------------------------------- summary -------------------------------- */
console.log(`\nrecon-fixtures: ${passed} passed, ${failed} failed`);
if (failed) {
  console.error('failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Reconnaissance, privacy boundary, fixture format, mutation safety and transaction contracts hold (harness evidence; live host UNTESTED).');
}
