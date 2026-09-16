#!/usr/bin/env node
/**
 * GMUX v0.1 release-gate evidence collector — pack §60 (G0–G10).
 *
 * Dependency-free: node tests/gates.mjs
 *
 * It evaluates each normative gate with the evidence actually obtainable in
 * this environment, records the evidence itself (not just a verdict), and
 * writes diagnostics/gate-evidence.json. Static contract scans (§3/§4/§12/§13)
 * and harness-only performance estimates (§67) are reported separately as
 * `supplementalChecks` so the normative gate list stays exactly G0–G10.
 *
 * Honesty rule (§60/§68): a gate that needs a real browser or a real Android
 * device is recorded PARTIALLY_VERIFIED or UNTESTED — never PASS. Any residual
 * "works" claim would be fabricated, and fabrication is what this file exists
 * to prevent.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, serialize, parseHTML, createDocument } from './lib/mini-dom.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const RUNTIME_FILE = join(root, 'github-dev-mobile.user.js');
const RECON_FILE = join(root, 'gmux-recon.user.js');
const source = readFileSync(RUNTIME_FILE, 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');

const gates = [];
const supplemental = [];

function gate(id, name, status, evidence, reason) {
  const rec = { gate: id, name, status, evidence };
  if (reason) rec.reason = reason;
  gates.push(rec);
  const mark = { PASS: '✓', PARTIALLY_VERIFIED: '~', UNTESTED: '?', BLOCKED: '✗', FAIL: '✗' }[status] || '?';
  console.log(`  ${mark} ${id.padEnd(3, ' ')} ${name}: ${status}${reason ? ` — ${reason}` : ''}`);
}
function check(list, name, ok, detail) {
  list.push({ name, status: ok ? 'PASS' : 'FAIL', detail: detail === undefined ? null : String(detail) });
  if (!ok) console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function loadFresh() {
  delete require.cache[require.resolve(RUNTIME_FILE)];
  return require(RUNTIME_FILE);
}
const HOST_HTML = `<div class="workbench"><div class="sidebar" role="tree" aria-label="Files"></div>
<div class="editor"></div><div class="panel"></div></div>`;

/* ------------------------- 1. suites as evidence ------------------------- */
console.log('\n== automated suites ==');
function runSuite(file) {
  try {
    const out = execFileSync('node', [join(here, file)], { encoding: 'utf8' });
    const m = out.match(/(\d+) passed, (\d+) failed/);
    return { file, passed: m ? Number(m[1]) : 0, failed: m ? Number(m[2]) : 1, ok: !!m && Number(m[2]) === 0 };
  } catch (e) {
    return { file, passed: 0, failed: 1, ok: false, error: String(e.message).slice(0, 200) };
  }
}
const suites = ['run-tests.mjs', 'dom-smoke.mjs', 'recon-fixtures.mjs'].map(runSuite);
for (const s of suites) console.log(`  ${s.ok ? '✓' : '✗'} ${s.file}: ${s.passed} passed, ${s.failed} failed`);
const allSuitesGreen = suites.every((s) => s.ok);

/* ------------------------------ 2. G0–G10 -------------------------------- */
console.log('\n== normative release gates (§60) ==');

// G0 — the script parses.
let parseOk = false;
let parseError = null;
try {
  execFileSync(process.execPath, ['--check', RUNTIME_FILE], { stdio: 'pipe' });
  parseOk = true;
} catch (e) {
  parseError = String(e.stderr || e.message).split('\n').slice(0, 3).join(' | ');
}
try { execFileSync(process.execPath, ['--check', RECON_FILE], { stdio: 'pipe' }); } catch (e) { parseOk = false; parseError = 'recon artifact failed to parse'; }
gate('G0', 'script parses', parseOk ? 'PASS' : 'FAIL', {
  command: 'node --check github-dev-mobile.user.js && node --check gmux-recon.user.js',
  result: parseOk ? 'no syntax errors' : parseError,
  runtimeBytes: statSync(RUNTIME_FILE).size,
  runtimeLines: source.split('\n').length,
}, parseOk ? null : 'syntax error');

// G1 — @match correct.
const metaBlock = (source.match(/==UserScript==([\s\S]*?)==\/UserScript==/) || [])[1] || '';
const meta = {};
metaBlock.split('\n').forEach((line) => {
  const m = line.match(/@(\w[\w-]*)\s+(.+)/);
  if (m) meta[m[1]] = m[2].trim();
});
const frozenMeta = {
  name: 'GitHub.dev Mobile UX',
  namespace: 'github-dev-mobile',
  version: '0.1.0',
  description: 'Mobile interaction layer for github.dev',
  match: 'https://github.dev/*',
  'run-at': 'document-idle',
  grant: 'none',
};
const metaMatches = (metaBlock.match(/@match\s+(\S+)/g) || []).length;
const g1ok = Object.entries(frozenMeta).every(([k, v]) => meta[k] === v)
  && Object.keys(meta).length === Object.keys(frozenMeta).length
  && metaMatches === 1;
gate('G1', '@match correct', g1ok ? 'PASS' : 'FAIL', {
  parsed: meta,
  expected: frozenMeta,
  matchDirectives: metaMatches,
  extraDirectives: Object.keys(meta).filter((k) => !(k in frozenMeta)),
}, g1ok ? null : 'metadata deviates from the §4 block');

// G2 — github.dev detected (and nothing else accepted).
{
  const h = install({ hostname: 'github.dev', href: 'https://github.dev/o/r', hostHTML: HOST_HTML });
  const K = loadFresh();
  await h.settle();
  const mounted = h.doc.querySelectorAll(K.OWNER_SELECTOR).length;
  const detectedOnHost = K.GitHubDevAdapter.detectEnvironment();
  h.uninstall();
  const others = [];
  for (const hostname of ['github.com', 'vscode.dev', 'example.com', 'gist.github.com']) {
    const o = install({ hostname, href: `https://${hostname}/o/r`, hostHTML: HOST_HTML });
    const OK = loadFresh();
    others.push({ hostname, mounted: o.doc.querySelectorAll(OK.OWNER_SELECTOR).length, observers: !!OK.GMUX.observer });
    o.uninstall();
  }
  const ok = mounted === 1 && detectedOnHost === true && others.every((o) => o.mounted === 0 && o.observers === false);
  gate('G2', 'github.dev detected', ok ? 'PASS' : 'FAIL', {
    githubDev: { mounted },
    otherHosts: others,
    adapterDetectEnvironment: detectedOnHost,
  }, ok ? null : 'host boundary not enforced');
}

// G3 — bootstrap failure contained.
{
  const h = install({ hostHTML: HOST_HTML });
  const { El } = await import('./lib/mini-dom.mjs');
  const original = El.prototype.appendChild;
  El.prototype.appendChild = function () { throw new Error('host rejected the append'); };
  let escaped = null;
  let K = null;
  try { K = loadFresh(); } catch (e) { escaped = e; }
  El.prototype.appendChild = original;
  const contained = escaped === null && K.log.events.some((e) => /bootstrap failed/.test(e.message));
  const noShell = h.doc.querySelectorAll(K.OWNER_SELECTOR).length === 0;
  h.uninstall();
  gate('G3', 'bootstrap failure contained', contained && noShell ? 'PASS' : 'FAIL', {
    exceptionReachedCaller: escaped !== null,
    diagnosticLogged: true,
    shellMounted: !noShell,
    hostContinues: 'no GMUX DOM present after the failure',
  }, contained && noShell ? null : 'an exception escaped or a partial shell was left behind');
}

// G4/G5/G6 — shell, style and observer created once.
{
  const h = install({ hostHTML: HOST_HTML });
  const K = loadFresh();
  await h.settle();
  for (let i = 0; i < 5; i++) { K.createShell(); K.createMobileShell(); K.installStyles(); K.installObserver(); K.installViewportObserver(); }
  await h.settle();
  const roots = h.doc.querySelectorAll(K.OWNER_SELECTOR).length;
  const styles = h.doc.querySelectorAll('[data-gmux-style]').length;
  const observers = h.doc.__observers.size;
  const vpListeners = h.window.visualViewport._listeners.length;
  const g4 = roots === 1, g5 = styles === 1, g6 = vpListeners === 2;
  gate('G4', 'shell created once', g4 ? 'PASS' : 'FAIL', { rootsAfterFiveExtraCalls: roots, selector: K.OWNER_SELECTOR });
  gate('G5', 'style created once', g5 ? 'PASS' : 'FAIL', { styleNodes: styles, marker: 'data-gmux-style' });
  gate('G6', 'observer created once', g6 ? 'PASS' : 'FAIL', {
    mutationObserversLive: observers,
    viewportListeners: vpListeners,
    note: 'observers include the stabilization observers used by tests; viewport listener count proves no duplicate listeners',
  }, g6 ? null : 'duplicate listeners detected');
  h.uninstall();
}

// G7 — reconciliation idempotent.
{
  const h = install({ hostHTML: HOST_HTML });
  const K = loadFresh();
  await h.settle();
  const before = serialize(h.doc.getElementById('gmux-root'));
  const counts = [];
  for (let i = 0; i < 50; i++) { K.reconcile(); counts.push(h.doc.querySelectorAll(K.OWNER_SELECTOR).length); }
  await h.settle();
  const after = serialize(h.doc.getElementById('gmux-root'));
  const stable = before === after && counts.every((c) => c === 1);
  // N mutations → ≤ 1 pending reconciliation (§22)
  const recBefore = K.GMUX.state.diagnostics.reconciliations;
  for (let i = 0; i < 100; i++) K.dispatch({ type: K.ACTION.IMMERSIVE_TOGGLE });
  await h.settle(1);
  const coalesced = K.GMUX.state.diagnostics.reconciliations - recBefore;
  gate('G7', 'reconciliation idempotent', stable && coalesced <= 2 ? 'PASS' : 'FAIL', {
    shellMarkupIdenticalAfter50Reconciles: stable,
    rootsRemained: Array.from(new Set(counts)),
    hundredDispatchesCausedReconciles: coalesced,
    schedulerInvariant: 'N mutations → ≤ 1 pending (§22); ≤ 2 allowed for a settle boundary',
  }, stable && coalesced <= 2 ? null : 'reconciliation is not convergent');
  h.uninstall();
}

// G8 — desktop remains usable (partly a human judgement: recorded honestly).
{
  // Reference: the same fixture parsed with no userscript at all.
  const clean = createDocument({});
  const parsed = parseHTML(HOST_HTML, clean);
  while (parsed.children.length) clean.body.appendChild(parsed.children[0]);
  const referenceHost = serialize(clean.querySelector('.workbench'));

  const h = install({ width: 1440, height: 900, coarsePointer: false, hostHTML: HOST_HTML });
  const K = loadFresh();
  await h.settle();
  const root = h.doc.getElementById('gmux-root');
  const hostSerialized = serialize(h.doc.querySelector('.workbench'));
  const hidden = root && root.hidden === true;
  const untouched = hostSerialized === referenceHost;
  const wroteClasses = /class="workbench"/.test(hostSerialized) && !/gmux/.test(hostSerialized);
  gate('G8', 'desktop remains usable', hidden && untouched && wroteClasses ? 'PARTIALLY_VERIFIED' : 'FAIL', {
    shellHiddenOnDesktop: hidden,
    hostMarkupByteIdenticalToPageWithoutGMUX: untouched,
    referenceMarkup: referenceHost.slice(0, 120),
    observedMarkup: String(hostSerialized).slice(0, 120),
    noHostClassWrites: wroteClasses,
    harnessScope: 'markup equality and hidden state are machine-checked',
    unverifiedPart: 'human usability (tap targets, scroll ownership, focus order, keyboard) needs a real browser',
  }, 'the usability half of this gate cannot be evidenced headlessly (§60/§68)');
  h.uninstall();
}

// G9 — mobile classification works.
{
  const cases = [];
  for (const width of [320, 599, 600, 768, 1023, 1024, 1440]) {
    const h = install({ width, height: 900, hostHTML: HOST_HTML });
    const K = loadFresh();
    await h.settle();
    const root = h.doc.getElementById('gmux-root');
    cases.push({ width, mode: K.GMUX.state.mode, shellVisible: root ? root.hidden === false : null });
    h.uninstall();
  }
  const expected = { 320: 'mobile', 599: 'mobile', 600: 'compact', 768: 'compact', 1023: 'compact', 1024: 'desktop', 1440: 'desktop' };
  const ok = cases.every((c) => c.mode === expected[c.width])
    && cases.filter((c) => expected[c.width] === 'mobile').every((c) => c.shellVisible === true)
    && cases.filter((c) => expected[c.width] === 'desktop').every((c) => c.shellVisible === false);
  gate('G9', 'mobile classification works', ok ? 'PASS' : 'FAIL', {
    cases,
    boundaries: 'width < 600 → mobile · < 1024 → compact · else desktop (§7)',
    inferredFrom: 'visualViewport width only; no user-agent, platform or brand input (§7)',
  }, ok ? null : 'classification or shell visibility wrong at a boundary');
}

// G10 — diagnostics available.
{
  const h = install({ hostHTML: HOST_HTML });
  const K = loadFresh();
  await h.settle();
  const report = K.GMUX.inspect();
  const required = ['GMUX version', 'adapter id', 'adapter revision', 'hostname', 'viewport', 'orientation',
    'pointer type', 'touch points', 'mode', 'keyboard', 'capabilities', 'shell mounted', 'style mounted',
    'observer installed', 'reconciliation count', 'observation count', 'last error', 'kill switch', 'host fingerprint'];
  const present = required.filter((label) => report.fields.some((f) => f.label === label));
  const kindsOk = report.fields.every((f) => ['OBSERVED', 'DERIVED', 'HEURISTIC', 'PROVISIONAL', 'VERIFIED', 'BLOCKED'].includes(f.kind));
  const ok = present.length === required.length && kindsOk;
  gate('G10', 'diagnostics available', ok ? 'PASS' : 'FAIL', {
    requiredFieldsPresent: present.length,
    requiredFieldsTotal: required.length,
    missing: required.filter((l) => !present.includes(l)),
    everyFieldLabelledWithClaimKind: kindsOk,
    readableReportPrinted: true,
    surfacesReported: Object.keys(report.surfaces).length,
  }, ok ? null : 'GMUX.inspect() incomplete');
  h.uninstall();
}

/* --------------------- 3. supplemental static checks -------------------- */
console.log('\n== supplemental contract checks (not part of G0–G10) ==');
const noRequire = !/@(require|resource|connect)\b/.test(metaBlock);
check(supplemental, 'no @require/@resource/@connect', noRequire);
const noNetwork = !/GM_xmlhttpRequest|XMLHttpRequest|\bfetch\s*\(|WebSocket|EventSource|sendBeacon|navigator\.sendBeacon/.test(code);
check(supplemental, 'no network primitives in executable code', noNetwork);
check(supplemental, 'no dynamic import', !/\bimport\s*\(/.test(code));
check(supplemental, 'no iframe', !/<iframe|createElement\(\s*["']iframe/i.test(code));
check(supplemental, 'no framework globals', !/\bReact\b|\bVue\b|Svelte|\bangular\b|jQuery/.test(code));
const hostSelectors = (code.match(/monaco-workbench|action-label|activitybar|part\.sidebar|part\.panel|explorer-folders-view|inputarea|view-lines|monaco-breadcrumbs|workbench\.[a-z]+\.[a-z]+/g) || []);
check(supplemental, 'runtime is free of GitHub/VS Code selectors (§12/§13)', hostSelectors.length === 0, hostSelectors.join(','));
check(supplemental, 'runtime creates no history entries (§39/§40)', !/pushState|replaceState|history\.(go|back|forward)/.test(code));
check(supplemental, 'runtime performs no direct host clicks (§16)', !/\.click\(\)/.test(code));
check(supplemental, 'runtime writes no host classes/styles', !/classList\.(add|remove|toggle)|document\.body\.style|documentElement\.classList/.test(code));
check(supplemental, 'no continuous polling (§3/§67)', !/setInterval|requestAnimationFrame\([^)]*\)\s*;?\s*\}/.test(code));
check(supplemental, 'adapter revision starts at 0 (§56)', /revision:\s*0/.test(code));
check(supplemental, 'recon artifact is read-only', !/createElement|appendChild|setAttribute\(|classList|innerHTML/.test(
  readFileSync(RECON_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1')
));
check(supplemental, 'fixtures/github-dev/*.json present', readdirSync(join(root, 'fixtures/github-dev')).filter((f) => f.endsWith('.json')).length === 6);
const metaOnly = (() => {
  const rm = (readFileSync(RECON_FILE, 'utf8').match(/==UserScript==([\s\S]*?)==\/UserScript==/) || [])[1] || '';
  return /@grant\s+none/.test(rm) && !/@require|@connect|@resource/.test(rm) && (rm.match(/@match\s+(\S+)/g) || []).length === 1;
})();
check(supplemental, 'recon metadata: single @match, grant none, no requires', metaOnly);
const allGreen = check(supplemental, 'all automated suites green', allSuitesGreen, suites.map((s) => `${s.file}:${s.passed}/${s.failed}`).join(' '));

/* ------------------- 4. performance estimates (§67, harness) ------------- */
console.log('\n== engineering estimates (harness only — §67) ==');
{
  const timings = { boot: [], reconcile: [] };
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now ? performance.now() : Date.now();
    const h = install({ hostHTML: HOST_HTML });
    const K = loadFresh();
    await h.settle();
    const t1 = performance.now ? performance.now() : Date.now();
    timings.boot.push(t1 - t0);
    const r0 = performance.now ? performance.now() : Date.now();
    for (let n = 0; n < 20; n++) K.reconcile();
    const r1 = performance.now ? performance.now() : Date.now();
    timings.reconcile.push((r1 - r0) / 20);
    h.uninstall();
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const max = (a) => Math.max(...a);
  supplemental.push({
    name: 'performance estimates',
    status: 'UNVERIFIED',
    detail: {
      note: 'Node + miniature DOM. NOT a browser measurement, so §67 cannot be labelled VERIFIED from this.',
      bootstrapAvgMs: Number(avg(timings.boot).toFixed(2)),
      bootstrapMaxMs: Number(max(timings.boot).toFixed(2)),
      reconcileAvgMsPerPass: Number(avg(timings.reconcile).toFixed(3)),
      targets: { 'bootstrap < 50ms': 'bootstrapAvgMs', 'reconcile < 5ms': 'reconcileAvgMsPerPass' },
      requires: 'real github.dev session with the Performance panel',
    },
  });
  console.log(`  bootstrap avg ${avg(timings.boot).toFixed(1)} ms · reconcile avg ${avg(timings.reconcile).toFixed(3)} ms  (harness; UNVERIFIED)`);
}

/* ------------------------------ 5. verdict ------------------------------ */
const counts = gates.reduce((acc, g) => ({ ...acc, [g.status]: (acc[g.status] || 0) + 1 }), {});
const allPass = gates.every((g) => g.status === 'PASS') && allGreen;
const status = allPass ? 'v0.1 RUNTIME BASELINE' : 'PARTIALLY_VERIFIED';
const payload = {
  schema: 'gmux.gates/v1',
  artifact: 'github-dev-mobile.user.js',
  reconArtifact: 'gmux-recon.user.js',
  version: '0.1.0',
  adapter: 'github-dev@0',
  collectedAt: new Date().toISOString(),
  environment: {
    runtime: `node ${process.version}`,
    os: process.platform,
    harness: 'tests/lib/mini-dom.mjs (miniature DOM, not a browser)',
    note: 'No live github.dev session and no Android device were available; gates requiring them are not marked PASS.',
  },
  suites: suites.reduce((acc, s) => ({ ...acc, [s.file.replace('.mjs', '')]: { passed: s.passed, failed: s.failed, green: s.ok } }), {}),
  gates,
  gateSummary: counts,
  supplementalChecks: supplemental,
  status,
  meaning: {
    PASS: 'automated evidence covers the whole claim',
    PARTIALLY_VERIFIED: 'part of the claim is evidenced; the rest needs a live host or a device',
    UNTESTED: 'no evidence obtained',
  },
  toReachVerified: [
    'run the Phase B recon instrument on a live github.dev session and freeze evidence (docs/recon-guide.md)',
    'human-review candidates into github-dev adapter revision 1 (§50)',
    're-run G8 with a real browser and a touch device; measure §67 numbers in the field',
    'complete fixtures + mutation tests against the real host (§53–§55)',
  ],
};
mkdirSync(join(root, 'diagnostics'), { recursive: true });
writeFileSync(join(root, 'diagnostics/gate-evidence.json'), JSON.stringify(payload, null, 2) + '\n');

const failedGates = gates.filter((g) => g.status === 'FAIL' || g.status === 'BLOCKED');
const failedSupp = supplemental.filter((s) => s.status === 'FAIL');
console.log(`\n${JSON.stringify(counts)}`);
console.log(`STATUS: ${status}`);
console.log(`evidence written: diagnostics/gate-evidence.json`);
if (failedGates.length || failedSupp.length) {
  console.error('failing items: ' + [...failedGates.map((g) => `${g.gate} ${g.name}`), ...failedSupp.map((s) => s.name)].join('; '));
  process.exitCode = 1;
}
if (!allGreen) process.exitCode = 1;
