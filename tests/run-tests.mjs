#!/usr/bin/env node
/**
 * GMUX pure-kernel verification suite — v0.1 Concrete Implementation Contract.
 *
 * Dependency-free: runs with plain Node (>= 18):
 *     node tests/run-tests.mjs
 *
 * Scope (honest, invariant I-15 "NO EVIDENCE → NO VERIFIED CLAIM"): these
 * checks cover the DOM-free kernel — host detection, mode policy, transitions,
 * Android Back decisions, preferences, scheduler, commands, capability
 * classification, keyboard inference, pending validation, reconcile planner
 * and feature-status honesty. Live github.dev behavior is exercised by the
 * manual matrix and recorded in VERIFICATION_REPORT.md.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const K = require('../github-dev-mobile.user.js');

let passed = 0;
let failed = 0;
const failures = [];

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function check(name, cond, detail) {
  if (cond) { passed++; }
  else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(title) { console.log(`\n== ${title} ==`); }

/* ------------------------- host detection (§7) --------------------------- */
section('Host detection precedes DOM mutation (§7)');
const loc = (hostname, pathname = '/') => ({ hostname, pathname });
check('github.dev supported', K.detectTarget(loc('github.dev', '/microsoft/vscode')) === K.TARGET.SUPPORTED);
check('*.github.dev supported', K.detectTarget(loc('foo.github.dev')) === K.TARGET.SUPPORTED);
check('vscode.dev/github/* supported', K.detectTarget(loc('vscode.dev', '/github/microsoft/vscode')) === K.TARGET.SUPPORTED);
check('*.vscode.dev/github/* supported', K.detectTarget(loc('insiders.vscode.dev', '/github/o/r')) === K.TARGET.SUPPORTED);
check('vscode.dev non-github route unsupported', K.detectTarget(loc('vscode.dev', '/microsoft/vscode')) === K.TARGET.UNSUPPORTED);
check('example.com unsupported', K.detectTarget(loc('example.com')) === K.TARGET.UNSUPPORTED);
check('missing location unsupported', K.detectTarget(null) === K.TARGET.UNSUPPORTED);

/* ----------------------- feature flags (§36) ----------------------------- */
section('Feature flags (§36)');
check('v0.1 flags present', ['mobileShell', 'immersiveEditor', 'explorerDrawer', 'searchSurface',
  'sourceControlSurface', 'terminalSurface', 'gestures', 'androidBack', 'diagnostics'].every((f) => f in K.FEATURES));
check('gestures deferred (false)', K.FEATURES.gestures === false);
check('terminal disabled by default (false)', K.FEATURES.terminalSurface === false);
check('androidBack enabled', K.FEATURES.androidBack === true);
check('mobileShell enabled', K.FEATURES.mobileShell === true);

/* ------------------------- failure taxonomy (§45) ------------------------ */
section('Failure taxonomy (§45)');
['BOOTSTRAP_FAILED', 'ADAPTER_NOT_FOUND', 'APPLICATION_NOT_DETECTED', 'CAPABILITY_UNKNOWN',
  'EDITOR_NOT_DETECTED', 'EXPLORER_NOT_DETECTED', 'SEARCH_NOT_DETECTED', 'SOURCE_CONTROL_NOT_DETECTED',
  'TERMINAL_NOT_DETECTED', 'SHELL_MOUNT_FAILED', 'SHELL_DUPLICATION', 'DOM_CHANGED',
  'UNSUPPORTED_LAYOUT', 'VIEWPORT_UNAVAILABLE', 'PREFERENCE_PARSE_FAILED', 'COMMAND_FAILED',
  'RECONCILIATION_FAILED'].forEach((code) => check(`FAIL.${code} defined`, K.FAIL[code] === code));

/* ------------------------- mode policy (§18) ----------------------------- */
section('Viewport classification is centralized (§18)');
check('320px -> mobile', K.modeForWidth(320) === 'mobile');
check('599px -> mobile', K.modeForWidth(599) === 'mobile');
check('600px -> compact', K.modeForWidth(600) === 'compact');
check('1024px -> compact (desktop is >1024)', K.modeForWidth(1024) === 'compact');
check('1025px -> desktop', K.modeForWidth(1025) === 'desktop');
check('override wins over width', K.modeForWidth(1400, K.DEFAULT_BREAKPOINTS, 'mobile') === 'mobile');
check('unknown override falls back to width', K.modeForWidth(320, K.DEFAULT_BREAKPOINTS, 'nonsense') === 'mobile');

/* --------------------------- transitions (§17) --------------------------- */
section('Surface transitions');
const S = K.SURFACE;
const mkState = (surface, prev = null) => ({ activeSurface: surface, previousSurface: prev });
check('editor + openExplorer -> explorer', K.transitionFor(mkState(S.EDITOR), 'openExplorer').to === S.EXPLORER);
check('editor + openSearch -> search', K.transitionFor(mkState(S.EDITOR), 'openSearch').to === S.SEARCH);
check('editor + openSourceControl -> sourceControl', K.transitionFor(mkState(S.EDITOR), 'openSourceControl').to === S.SOURCE_CONTROL);
check('editor + openTerminal -> terminal', K.transitionFor(mkState(S.EDITOR), 'openTerminal').to === S.TERMINAL);
check('explorer + selectFile -> editor', K.transitionFor(mkState(S.EXPLORER), 'selectFile').to === S.EDITOR);
check('search + selectResult -> editor', K.transitionFor(mkState(S.SEARCH), 'selectResult').to === S.EDITOR);
check('close -> previousSurface', K.transitionFor(mkState(S.EXPLORER, S.SOURCE_CONTROL), 'close').to === S.SOURCE_CONTROL);
check('close without previous -> editor', K.transitionFor(mkState(S.TERMINAL), 'close').to === S.EDITOR);
check('close on editor rejected', K.transitionFor(mkState(S.EDITOR), 'close').ok === false);
{
  const r = K.transitionFor(mkState(S.SOURCE_CONTROL), 'openTerminal');
  check('unknown transition diagnosable', r.ok === false && r.code === K.FAIL.COMMAND_FAILED);
}

/* ------------------------ Android Back decisions (§34) ------------------- */
section('Android Back decision (§34, I-11)');
check('modal wins first', K.planBack({ modal: 'menu', activeSurface: S.EDITOR }).consume === 'modal');
check('quick input consumed next', K.planBack({ quickInputVisible: true, activeSurface: S.EDITOR }).consume === 'quickinput');
check('drawer returns to editor', K.planBack({ activeSurface: S.EXPLORER }).consume === 'surface');
check('drawer returns to previous', K.planBack({ activeSurface: S.SEARCH, previousSurface: S.SOURCE_CONTROL }).to === S.SOURCE_CONTROL);
check('terminal is a secondary surface', K.planBack({ activeSurface: S.TERMINAL }).consume === 'surface');
check('settings is a secondary surface', K.planBack({ activeSurface: S.SETTINGS }).consume === 'surface');
const def = K.planBack({ activeSurface: S.EDITOR });
check('editor with nothing open -> ALLOW_BROWSER_DEFAULT', def.consume === null);

/* ------------------------- preferences (§39/§40) ------------------------- */
section('Preferences are versioned and corruption tolerant (§39/§40, I-12)');
{
  const { prefs, notes } = K.parsePreferences(null);
  check('missing storage -> defaults', eq(prefs, K.PREF_DEFAULTS) && notes.length === 0);
}
check('default schema shape', eq(Object.keys(K.PREF_DEFAULTS).sort(), ['bottomBar', 'immersive', 'mode', 'preferredSurface', 'version']));
{
  const { prefs, notes } = K.parsePreferences('{oops');
  check('corrupt JSON -> defaults + PREFERENCE_PARSE_FAILED',
    eq(prefs, K.PREF_DEFAULTS) && notes.some((n) => n.code === K.FAIL.PREFERENCE_PARSE_FAILED));
}
{
  const { prefs } = K.parsePreferences(JSON.stringify({ version: 99, immersive: false }));
  check('foreign schema version -> defaults', prefs.immersive === true);
}
{
  const good = { version: 1, mode: 'mobile', immersive: false, preferredSurface: 'sourceControl', bottomBar: false };
  const { prefs, notes } = K.parsePreferences(JSON.stringify(good));
  check('valid prefs round-trip', eq(prefs, good) && notes.length === 0);
}
{
  const { prefs } = K.parsePreferences(JSON.stringify({ version: 1, mode: 42, immersive: 'yes', preferredSurface: 'golf', bottomBar: [] }));
  check('wrong-typed fields fall back', eq(prefs, K.PREF_DEFAULTS));
}
{
  const { prefs, notes } = K.parsePreferences('[1,2,3]');
  check('array payload rejected', eq(prefs, K.PREF_DEFAULTS) && notes.length === 1);
}
{
  const diag = K.createDiagLog();
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  let threw = false;
  try {
    const ps = K.createPreferenceStore({ storage: hostile }, diag);
    ps.load(); ps.set({ immersive: false }); ps.reset();
  } catch (e) { threw = true; }
  check('hostile storage never throws (startup always proceeds)', threw === false);
}

/* ---------------------------- scheduler (§28) ---------------------------- */
section('Reconcile scheduling coalesces (§26/§28, I-04)');
await (async () => {
  let rafCb = null;
  const env = { requestAnimationFrame: (fn) => { rafCb = fn; return 1; } };
  const sched = K.createScheduler(env);
  let calls = 0;
  let seenReasons = null;
  sched.onReconcile((rs) => { calls++; seenReasons = rs; });
  sched.markDirty('mutation');
  sched.markDirty('resize');
  sched.markDirty('viewport');
  check('coalesced to a single pending frame', sched.pending() === true && calls === 0);
  rafCb(Date.now());
  check('one reconcile for multiple signals', calls === 1);
  check('reasons merged', seenReasons && seenReasons.slice().sort().join(',') === 'mutation,resize,viewport');
  rafCb = null;
  sched.markDirty('x');
  rafCb(Date.now());
  check('subsequent frame schedules again', calls === 2);
})();

/* --------------------------- commands (§22/§23) -------------------------- */
section('Command registry never silently succeeds');
{
  const diag = K.createDiagLog();
  const reg = K.createCommandRegistry(diag);
  reg.register('open-explorer', () => ({ ok: true, operation: 'open-explorer', evidence: { stateChanged: true } }));
  reg.register('boom', () => { throw new Error('exploded'); });
  check('registered command runs', reg.execute('open-explorer').ok === true);
  const miss = reg.execute('missing');
  check('missing command -> COMMAND_FAILED', miss.ok === false && miss.code === K.FAIL.COMMAND_FAILED);
  check('throwing command -> COMMAND_FAILED', reg.execute('boom').ok === false);
  check('failure recorded in diagnostics', diag.entries().some((e) => e.code === K.FAIL.COMMAND_FAILED));
}

/* ------------------------ capabilities (§12/§13) ------------------------- */
section('Capability detection supports uncertainty');
function obsWith(over = {}) {
  return Object.assign({
    application: { detected: true },
    surfaces: {
      editor: { present: true }, explorer: { present: true }, search: { present: true },
      sourceControl: { present: false }, terminal: { present: false },
    },
    parts: {
      activityBar: { present: true }, statusBar: { present: true },
      sideBar: { visible: false }, quickInput: { present: false, visible: false },
    },
  }, over);
}
{
  const caps = K.classifyCapabilities({ application: { detected: false } });
  check('application not detected -> all UNKNOWN (never false)', Object.values(caps).every((v) => v === K.CAP.UNKNOWN));
  check('minimum capability set (§12)', ['editor', 'explorer', 'search', 'sourceControl', 'terminal', 'activityBar', 'statusBar', 'commandPalette']
    .every((k) => k in caps));
}
{
  const caps = K.classifyCapabilities(obsWith());
  check('present surfaces DETECTED', caps.editor === K.CAP.DETECTED && caps.explorer === K.CAP.DETECTED && caps.search === K.CAP.DETECTED);
  check('unrendered SCM NOT_DETECTED (not absent-as-false)', caps.sourceControl === K.CAP.NOT_DETECTED);
  check('terminal NOT_DETECTED', caps.terminal === K.CAP.NOT_DETECTED);
  check('parts detected', caps.activityBar === K.CAP.DETECTED && caps.statusBar === K.CAP.DETECTED);
  check('command palette UNKNOWN while closed (§12)', caps.commandPalette === K.CAP.UNKNOWN);
}
{
  const caps = K.classifyCapabilities(obsWith({ parts: { activityBar: { present: true }, statusBar: { present: true }, sideBar: { visible: false }, quickInput: { present: true, visible: true } } }));
  check('command palette DETECTED only when observed', caps.commandPalette === K.CAP.DETECTED);
}
check('terminal host expectation github.dev', K.terminalHostExpectation('github.dev') === 'likely-unsupported');
check('terminal host expectation other host unknown', K.terminalHostExpectation('example.com') === 'unknown');

/* ------------------------ keyboard inference (§29) ----------------------- */
section('Virtual keyboard is INFERRED from visualViewport');
check('full viewport -> closed/inferred', (() => {
  const r = K.inferKeyboard({ vvAvailable: true, vvHeight: 732, vvWidth: 412, layoutHeight: 732, layoutWidth: 412 });
  return r.visible === false && r.evidence === K.EVIDENCE.INFERRED;
})());
check('height collapse -> open/inferred', (() => {
  const r = K.inferKeyboard({ vvAvailable: true, vvHeight: 400, vvWidth: 412, layoutHeight: 732, layoutWidth: 412 });
  return r.visible === true && r.evidence === K.EVIDENCE.INFERRED;
})());
check('width collapse too -> not claimed as keyboard', K.inferKeyboard({ vvAvailable: true, vvHeight: 400, vvWidth: 200, layoutHeight: 732, layoutWidth: 412 }).visible === false);
check('no API -> UNKNOWN', K.inferKeyboard({ vvAvailable: false }).evidence === K.CAP.UNKNOWN);

/* --------------------- pending validation (§10/§13) ---------------------- */
section('Operation validation is separate from capability detection');
const t0 = 1000;
const sidebarObs = (viewKey) => ({
  parts: { sideBar: { visible: true }, quickInput: { visible: false } },
  surfaces: { terminal: { visible: false } },
  sidebarActiveView: viewKey,
});
{
  const pend = { cmd: 'openExplorer', expect: S.EXPLORER, t0, retried: false };
  check('expected transition -> done (VALIDATED)', K.evaluatePending(pend, sidebarObs('explorer'), 1100).state === 'done');
}
{
  const pend = { cmd: 'openSourceControl', expect: S.SOURCE_CONTROL, t0, retried: false };
  check('wrong view still showing -> wait', K.evaluatePending(pend, sidebarObs('explorer'), 1100).state === 'wait');
  check('after 1.2s -> one bounded retry', K.evaluatePending(pend, sidebarObs('explorer'), 2300).state === 'retry');
  const expired = K.evaluatePending({ cmd: 'openSourceControl', expect: S.SOURCE_CONTROL, t0, retried: true }, sidebarObs('explorer'), 4300);
  check('after 3.2s -> expired with correct code', expired.state === 'expired' && expired.code === K.FAIL.SOURCE_CONTROL_NOT_DETECTED);
}
{
  const pend = { cmd: 'close', expect: S.EDITOR, t0, retried: false };
  const closed = { parts: { sideBar: { visible: false }, quickInput: { visible: false } }, surfaces: { terminal: { visible: false } }, sidebarActiveView: null };
  check('close validated when drawer gone', K.evaluatePending(pend, closed, 1100).state === 'done');
}

/* ------------------------- reconcile planner (§24) ----------------------- */
section('Reconcile planner (observe → normalize → decide)');
function baseObs(over = {}) {
  return Object.assign({
    application: { detected: true },
    surfaces: {
      editor: { present: true, activeFile: { name: 'main.rs', uri: 'file:///src/main.rs' } },
      explorer: { present: true, visible: false }, search: { present: true, visible: false },
      sourceControl: { present: true, visible: false }, terminal: { present: false, visible: false, hostExpectation: 'likely-unsupported' },
    },
    parts: {
      titlebar: { present: true, visible: true }, activityBar: { present: true },
      sideBar: { present: true, visible: false }, panel: { present: true, visible: false },
      statusBar: { present: true }, quickInput: { present: false, visible: false },
    },
    measured: { titlebarH: 30, statusbarH: 22 },
    sidebarActiveView: null,
    appSurface: 'editor',
  }, over);
}
function baseState(over = {}) {
  return Object.assign({
    activeSurface: 'editor', previousSurface: null, lastFileKey: '', modal: null,
    viewport: { width: 412, height: 732, offsetTop: 0 },
  }, over);
}
{
  const plan = K.planReconcile({ obs: baseObs(), state: baseState(), prefs: K.PREF_DEFAULTS, caps: {} });
  check('412px plans MOBILE', plan.shellMode === 'mobile');
  check('immersive on by default in mobile', plan.immersiveOn === true);
  check('mobile workbench class planned', plan.workbenchAdd.indexOf('gmux-mode-mobile') !== -1);
  check('header file surfaced', plan.headerFile === 'main.rs');
  check('geometry vars emitted', plan.vars['--gmux-vv-height'] === '732' && plan.vars['--gmux-shell-top'] === '40px');
}
{
  const plan = K.planReconcile({ obs: baseObs(), state: baseState(), prefs: K.PREF_DEFAULTS, caps: { terminal: K.CAP.NOT_DETECTED } });
  check('terminal never advertised when feature flag off', plan.terminalEnabled === false);
  check('terminal unavailability produces a note', plan.notes.some((n) => n.code === K.FAIL.TERMINAL_NOT_DETECTED));
}
{
  const obs = baseObs({
    parts: { titlebar: { present: true }, activityBar: { present: true }, sideBar: { present: true, visible: true }, panel: { present: true, visible: false }, statusBar: { present: true }, quickInput: { present: false, visible: false } },
    sidebarActiveView: 'explorer', appSurface: 'explorer',
  });
  obs.surfaces.explorer.visible = true;
  const plan = K.planReconcile({ obs, state: baseState(), prefs: K.PREF_DEFAULTS, caps: {} });
  check('app-opened explorer adopted (DOM is evidence)', plan.adoptedFromApp === true && plan.activeSurface === 'explorer');
  check('explorer raises drawer overlay', plan.workbenchAdd.indexOf('gmux-sidebar-overlay') !== -1);
}
{
  const obs = baseObs({
    parts: { titlebar: { present: true }, activityBar: { present: true }, sideBar: { present: true, visible: true }, panel: { present: true, visible: false }, statusBar: { present: true }, quickInput: { present: false, visible: false } },
    sidebarActiveView: 'explorer', appSurface: 'explorer',
  });
  obs.surfaces.editor.activeFile = { name: 'agent.rs', uri: 'file:///src/agent.rs' };
  const plan = K.planReconcile({ obs, state: baseState({ activeSurface: 'explorer', lastFileKey: 'file:///src/main.rs' }), prefs: K.PREF_DEFAULTS, caps: {} });
  check('file selection in drawer -> editor (§31)', plan.fileSelected === true && plan.activeSurface === 'editor');
}
{
  const obs = baseObs({ parts: { titlebar: { present: true }, activityBar: { present: true }, sideBar: { present: true, visible: false }, panel: { present: true, visible: false }, statusBar: { present: true }, quickInput: { present: true, visible: true } } });
  const plan = K.planReconcile({ obs, state: baseState({ activeSurface: 'explorer' }), prefs: K.PREF_DEFAULTS, caps: {} });
  check('quick input minimizes shell chrome', plan.shellMinimized === true);
  check('quick input suppresses drawer overlay', plan.workbenchAdd.indexOf('gmux-sidebar-overlay') === -1);
  check('quick input does not steal surface', plan.adoptedFromApp === false);
}
{
  const plan = K.planReconcile({ obs: baseObs(), state: baseState({ viewport: { width: 1280, height: 800, offsetTop: 0 } }), prefs: K.PREF_DEFAULTS, caps: {} });
  check('desktop mode removes header', plan.shellMode === 'desktop' && plan.rootAdd.indexOf('gmux-no-header') !== -1);
  check('desktop mode removes bottom bar', plan.rootAdd.indexOf('gmux-no-footer') !== -1);
}
{
  const prefs = Object.assign({}, K.PREF_DEFAULTS, { bottomBar: false });
  const plan = K.planReconcile({ obs: baseObs(), state: baseState(), prefs, caps: {} });
  check('bottomBar=false hides toolbar and keeps statusbar gap', plan.rootAdd.indexOf('gmux-no-footer') !== -1 && plan.vars['--gmux-shell-bottom'] === '22px');
}
{
  const obs = baseObs({ appSurface: 'editor' });
  const plan = K.planReconcile({ obs, state: baseState({ activeSurface: 'explorer' }), prefs: K.PREF_DEFAULTS, caps: {}, pending: { cmd: 'openExplorer' } });
  check('pending command suppresses adoption until validated', plan.adoptedFromApp === false && plan.activeSurface === 'explorer');
}

/* ----------------------- feature status honesty (§38) ------------------- */
section('Diagnostics are evidence, not aspiration');
{
  const rows = K.computeFeatureStatuses({ caps: {}, stats: {}, vvUsed: null });
  const map = Object.fromEntries(rows.map(([n, v]) => [n, v]));
  check('Git operations OUT_OF_SCOPE', map['Git operations'].status === K.FSTATUS.OUT_OF_SCOPE);
  check('Gestures OUT_OF_SCOPE for v0.1', map['Gesture navigation'].status === K.FSTATUS.OUT_OF_SCOPE);
  check('Terminal surface OUT_OF_SCOPE under the v0.1 flag', map['Terminal surface'].status === K.FSTATUS.OUT_OF_SCOPE);
  check('Unknown future DOM BLOCKED', map['Unknown future GitHub DOM'].status === K.FSTATUS.BLOCKED);
  check('no evidence -> not VERIFIED (viewport)', map['Mobile viewport detection'].status !== K.FSTATUS.VERIFIED);
  check('no evidence -> not VERIFIED (explorer)', map['Explorer drawer'].status !== K.FSTATUS.VERIFIED);
}
{
  const rows = K.computeFeatureStatuses({ caps: { explorer: K.CAP.DETECTED }, stats: { explorerValidated: true, viewportApplied: true }, vvUsed: 'visualViewport' });
  const map = Object.fromEntries(rows.map(([n, v]) => [n, v]));
  check('validated transition -> VERIFIED', map['Explorer drawer'].status === K.FSTATUS.VERIFIED);
  check('applied viewport -> VERIFIED', map['Mobile viewport detection'].status === K.FSTATUS.VERIFIED);
}

/* ------------------------------ summary ---------------------------------- */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  failures.forEach((f) => console.error(` - ${f}`));
  process.exit(1);
}
console.log('Kernel unit suite green. Live-runtime matrix: VERIFICATION_REPORT.md');
