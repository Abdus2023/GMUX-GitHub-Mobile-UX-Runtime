#!/usr/bin/env node
/**
 * GMUX verification suite (spec §20 step 20, §37, §38).
 *
 * Dependency-free: runs with plain Node (>= 18):
 *     node tests/run-tests.mjs
 *
 * Scope (honest, spec §36): these tests verify the PURE KERNEL units —
 * mode detection, transitions, preferences, scheduler, commands, capability
 * classification, keyboard inference, gestures, and the reconcile planner.
 * Live-DOM behaviors (Monaco focus, activity-bar clicks, MutationObserver
 * loops, Android viewport) require the manual matrix in docs/verification.md
 * and are NOT claimed verified here.
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

/* ------------------------- mode detection (spec §3) ----------------------- */
section('Mode detection (§3)');
check('320px -> mobile', K.modeForWidth(320) === 'mobile');
check('599px -> mobile', K.modeForWidth(599) === 'mobile');
check('600px -> compact', K.modeForWidth(600) === 'compact');
check('1024px -> compact (desktop is >1024)', K.modeForWidth(1024) === 'compact');
check('1025px -> desktop', K.modeForWidth(1025) === 'desktop');
check('override wins over width', K.modeForWidth(1400, K.DEFAULT_BREAKPOINTS, 'mobile') === 'mobile');
check('unknown override falls back to width', K.modeForWidth(320, K.DEFAULT_BREAKPOINTS, 'nonsense') === 'mobile');

/* --------------------------- transitions (spec §14) ------------------------ */
section('State transitions (§14)');
const S = K.SURFACE;
const mkState = (surface, prev = null) => ({ activeSurface: surface, previousSurface: prev });
check('editor + openExplorer -> explorer', K.transitionFor(mkState(S.EDITOR), 'openExplorer').to === S.EXPLORER);
check('editor + openSearch -> search', K.transitionFor(mkState(S.EDITOR), 'openSearch').to === S.SEARCH);
check('editor + openGit -> git', K.transitionFor(mkState(S.EDITOR), 'openGit').to === S.GIT);
check('editor + openTerminal -> terminal', K.transitionFor(mkState(S.EDITOR), 'openTerminal').to === S.TERMINAL);
check('editor + openSettings -> settings', K.transitionFor(mkState(S.EDITOR), 'openSettings').to === S.SETTINGS);
check('explorer + selectFile -> editor', K.transitionFor(mkState(S.EXPLORER), 'selectFile').to === S.EDITOR);
check('search + selectResult -> editor', K.transitionFor(mkState(S.SEARCH), 'selectResult').to === S.EDITOR);
check('explorer + close -> previousSurface', K.transitionFor(mkState(S.EXPLORER, S.GIT), 'close').to === S.GIT);
check('terminal + close -> editor when no previous', K.transitionFor(mkState(S.TERMINAL), 'close').to === S.EDITOR);
{
  const r = K.transitionFor(mkState(S.GIT), 'openTerminal');
  check('unexpected transition diagnosable', r.ok === false && r.code === K.FAIL.UNEXPECTED_TRANSITION);
}
{
  const r = K.transitionFor(mkState(S.EDITOR), 'close');
  check('close on editor rejected as unexpected', r.ok === false && r.code === K.FAIL.UNEXPECTED_TRANSITION);
}

/* ------------------------- preferences (spec §28) -------------------------- */
section('Preferences (§28)');
{
  const { prefs, notes } = K.parsePreferences(null);
  check('missing storage -> defaults', eq(prefs, K.PREF_DEFAULTS) && notes.length === 0);
}
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
  const good = { version: 1, mode: 'mobile', immersive: false, preferredSurface: 'git', gestures: false, bottomBar: false, terminalFullscreen: false };
  const { prefs, notes } = K.parsePreferences(JSON.stringify(good));
  check('valid prefs round-trip', eq(prefs, good) && notes.length === 0);
}
{
  const { prefs } = K.parsePreferences(JSON.stringify({ version: 1, mode: 42, immersive: 'yes', preferredSurface: 'golf', gestures: 1, bottomBar: [], terminalFullscreen: {} }));
  check('wrong-typed fields coerced to defaults', eq(prefs, K.PREF_DEFAULTS));
}
{
  const { prefs, notes } = K.parsePreferences('[1,2,3]');
  check('array payload rejected', eq(prefs, K.PREF_DEFAULTS) && notes.length === 1);
}
{
  // storage that throws must never prevent startup (spec §28)
  const diag = K.createDiagLog();
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  let threw = false;
  try {
    const ps = K.createPreferenceStore({ storage: hostile }, diag);
    ps.load(); ps.set({ immersive: false }); ps.reset();
  } catch (e) { threw = true; }
  check('hostile storage never throws', threw === false);
}

/* ---------------------------- scheduler (spec §31) ------------------------- */
section('Scheduler (§31)');
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
  check('one reconcile for three signals', calls === 1);
  check('reasons merged', seenReasons && seenReasons.sort().join(',') === 'mutation,resize,viewport');
  rafCb = null;
  sched.markDirty('x');
  rafCb(Date.now());
  check('subsequent frame schedules again', calls === 2);
})();

/* --------------------------- commands (spec §15) --------------------------- */
section('Command registry (§15)');
{
  const diag = K.createDiagLog();
  const reg = K.createCommandRegistry(diag);
  reg.register('open-explorer', () => ({ ok: true, via: 'test' }));
  reg.register('boom', () => { throw new Error('exploded'); });
  check('registered command runs', reg.execute('open-explorer').ok === true);
  const miss = reg.execute('missing');
  check('missing command -> COMMAND_FAILED', miss.ok === false && miss.code === K.FAIL.COMMAND_FAILED);
  const boom = reg.execute('boom');
  check('throwing command -> COMMAND_FAILED (no silent success)', boom.ok === false && boom.code === K.FAIL.COMMAND_FAILED);
  check('failure recorded in diagnostics', diag.entries().some((e) => e.code === K.FAIL.COMMAND_FAILED));
}

/* ------------------------ capability rules (spec §8/§20) ------------------- */
section('Capability detection (§8)');
{
  const none = K.classifyCapabilities({ workbench: { present: false } });
  check('no workbench -> all UNKNOWN', Object.values(none).every((v) => v === K.CAP.UNKNOWN));
}
{
  const obs = {
    workbench: { present: true },
    editor: { present: true },
    views: { explorer: { present: true }, search: { present: true }, scm: { present: false } },
    terminal: { present: false, hostExpectation: 'likely-unsupported' },
  };
  const caps = K.classifyCapabilities(obs);
  check('observed parts DETECTED', caps.editor === K.CAP.DETECTED && caps.explorer === K.CAP.DETECTED && caps.search === K.CAP.DETECTED);
  check('unrendered part NOT_DETECTED (never ABSENT)', caps.sourceControl === K.CAP.NOT_DETECTED);
  check('terminal on github.dev-like host -> UNSUPPORTED inference', caps.terminal === K.CAP.UNSUPPORTED);
}
{
  const obs = {
    workbench: { present: true },
    editor: { present: true },
    views: { explorer: { present: true }, search: { present: true }, scm: { present: true } },
    terminal: { present: true, hostExpectation: 'likely-unsupported' },
  };
  const caps = K.classifyCapabilities(obs);
  check('observed terminal overrides host inference', caps.terminal === K.CAP.DETECTED);
}
check('terminalHostExpectation github.dev', K.terminalHostExpectation('github.dev') === 'likely-unsupported');
check('terminalHostExpectation vscode.dev', K.terminalHostExpectation('vscode.dev') === 'likely-unsupported');
check('terminalHostExpectation other host', K.terminalHostExpectation('example.com') === 'unknown');

/* ------------------------ keyboard inference (spec §25) -------------------- */
section('Virtual keyboard inference (§25)');
{
  const closed = K.inferKeyboard({ vvAvailable: true, vvHeight: 732, vvWidth: 412, layoutHeight: 732, layoutWidth: 412 });
  check('full viewport -> INFERRED closed', closed.visible === false && closed.evidence === K.EVIDENCE.INFERRED);
}
{
  const open = K.inferKeyboard({ vvAvailable: true, vvHeight: 400, vvWidth: 412, layoutHeight: 732, layoutWidth: 412 });
  check('45% height drop -> INFERRED open', open.visible === true && open.evidence === K.EVIDENCE.INFERRED);
}
{
  const narrow = K.inferKeyboard({ vvAvailable: true, vvHeight: 400, vvWidth: 200, layoutHeight: 732, layoutWidth: 412 });
  check('width loss too -> not claimed keyboard', narrow.visible === false);
}
{
  const noapi = K.inferKeyboard({ vvAvailable: false, vvHeight: 0, vvWidth: 0, layoutHeight: 732, layoutWidth: 412 });
  check('no visualViewport -> UNKNOWN evidence', noapi.evidence === 'UNKNOWN');
}

/* ------------------------- gesture classifier (spec §23) ------------------- */
section('Gesture classification (§23)');
const baseTrack = { points: 8, duration: 250, vw: 412, vh: 732 };
{
  const g = K.classifyGesture(Object.assign({}, baseTrack, { x0: 6, y0: 300, x1: 180, y1: 306 }));
  check('left-edge right swipe -> open-explorer', g && g.action === 'open-explorer');
}
{
  const g = K.classifyGesture(Object.assign({}, baseTrack, { x0: 408, y0: 300, x1: 220, y1: 304 }));
  check('right-edge left swipe -> close-surface', g && g.action === 'close-surface');
}
{
  const g = K.classifyGesture(Object.assign({}, baseTrack, { x0: 200, y0: 728, x1: 204, y1: 520 }));
  check('bottom-edge up swipe -> open-terminal', g && g.action === 'open-terminal');
}
{
  const g = K.classifyGesture(Object.assign({}, baseTrack, { x0: 200, y0: 4, x1: 206, y1: 200 }));
  check('top-edge down swipe -> close-surface', g && g.action === 'close-surface');
}
check('mid-screen swipe -> NO ACTION', K.classifyGesture(Object.assign({}, baseTrack, { x0: 200, y0: 300, x1: 380, y1: 302 })) === null);
check('too short -> NO ACTION', K.classifyGesture(Object.assign({}, baseTrack, { x0: 4, y0: 300, x1: 30, y1: 301 })) === null);
check('too slow -> NO ACTION', K.classifyGesture(Object.assign({}, baseTrack, { x0: 4, y0: 300, x1: 200, y1: 302, duration: 2000 })) === null);
check('diagonal -> NO ACTION', K.classifyGesture(Object.assign({}, baseTrack, { x0: 4, y0: 300, x1: 150, y1: 420 })) === null);

/* ------------------------- reconcile planner (spec §7) --------------------- */
section('Reconcile planner (§7)');
function baseObs(over = {}) {
  return Object.assign({
    workbench: { present: true },
    parts: { sidebar: { present: true, visible: false }, editor: { present: true }, panel: { present: true, visible: false } },
    editor: { present: true, activeFile: { name: 'main.rs', uri: 'file:///src/main.rs' } },
    views: { sidebarActiveView: null },
    terminal: { present: false, visible: false },
    quickInput: { visible: false },
    measured: { titlebarH: 30, statusbarH: 22 },
    appSurface: 'editor',
  }, over);
}
function baseState(over = {}) {
  return Object.assign({
    activeSurface: 'editor', previousSurface: null, lastFileKey: '',
    viewport: { width: 412, height: 732, offsetTop: 0 },
  }, over);
}
{
  const plan = K.planReconcile({ obs: baseObs(), state: baseState(), prefs: K.PREF_DEFAULTS, caps: {} });
  check('412px plans MOBILE', plan.shellMode === 'mobile');
  check('immersive on by default in mobile', plan.immersiveOn === true);
  check('mobile adds gdmux-mode-mobile', plan.workbenchAdd.indexOf('gdmux-mode-mobile') !== -1);
  check('header file surfaced', plan.headerFile === 'main.rs');
  // titlebar measured at 30px but floored to a 40px touch target
  check('vars expose visual-viewport geometry', plan.vars['--gdmux-vv-height'] === '732' && plan.vars['--gdmux-shell-top'] === '40px');
}
{
  const caps = { terminal: K.CAP.NOT_DETECTED };
  const plan = K.planReconcile({ obs: baseObs(), state: baseState(), prefs: K.PREF_DEFAULTS, caps });
  check('terminal button disabled when NOT_DETECTED (§20)', plan.terminalEnabled === false);
}
{
  const caps = { terminal: K.CAP.DETECTED };
  // app evidence agrees: terminal visible in the panel
  const termObs = baseObs({
    terminal: { present: true, visible: true }, appSurface: 'terminal',
    parts: { sidebar: { present: true, visible: false }, editor: { present: true }, panel: { present: true, visible: true } },
  });
  const plan = K.planReconcile({ obs: termObs, state: baseState({ activeSurface: 'terminal' }), prefs: K.PREF_DEFAULTS, caps });
  check('terminal surface raises panel overlay', plan.workbenchAdd.indexOf('gdmux-panel-overlay') !== -1);
  check('terminal fullscreen uses full usable height', plan.vars['--gdmux-panel-h'] === `${732 - 40 - 52}px`);
}
{
  const prefs = Object.assign({}, K.PREF_DEFAULTS, { terminalFullscreen: false });
  const termObs2 = baseObs({
    terminal: { present: true, visible: true }, appSurface: 'terminal',
    parts: { sidebar: { present: true, visible: false }, editor: { present: true }, panel: { present: true, visible: true } },
  });
  const plan = K.planReconcile({ obs: termObs2, state: baseState({ activeSurface: 'terminal' }), prefs, caps: { terminal: K.CAP.DETECTED } });
  check('terminal non-fullscreen ~55%', plan.vars['--gdmux-panel-h'] === `${Math.round((732 - 40 - 52) * 0.55)}px`);
}
{
  const obs = baseObs({ parts: { sidebar: { present: true, visible: true }, editor: { present: true }, panel: { present: true, visible: false } }, views: { sidebarActiveView: 'explorer' }, appSurface: 'explorer' });
  const plan = K.planReconcile({ obs, state: baseState(), prefs: K.PREF_DEFAULTS, caps: {} });
  check('app-opened explorer adopted (DOM is evidence)', plan.adoptedFromApp === true && plan.activeSurface === 'explorer');
  check('explorer raises sidebar drawer overlay', plan.workbenchAdd.indexOf('gdmux-sidebar-overlay') !== -1);
}
{
  // spec §14: selectFile -> EDITOR, closing the drawer
  const obs = baseObs({
    parts: { sidebar: { present: true, visible: true }, editor: { present: true }, panel: { present: true, visible: false } },
    views: { sidebarActiveView: 'explorer' }, appSurface: 'explorer',
    editor: { present: true, activeFile: { name: 'agent.rs', uri: 'file:///src/agent.rs' } },
  });
  const plan = K.planReconcile({ obs, state: baseState({ activeSurface: 'explorer', lastFileKey: 'file:///src/main.rs' }), prefs: K.PREF_DEFAULTS, caps: {} });
  check('file selection while in explorer -> editor', plan.fileSelected === true && plan.activeSurface === 'editor');
}
{
  const obs = baseObs({ quickInput: { visible: true } });
  const plan = K.planReconcile({ obs, state: baseState({ activeSurface: 'explorer' }), prefs: K.PREF_DEFAULTS, caps: {} });
  check('quick input minimizes shell chrome', plan.shellMinimized === true);
  check('quick input drops drawer overlay', plan.workbenchAdd.indexOf('gdmux-sidebar-overlay') === -1);
  check('quick input does not steal active surface', plan.adoptedFromApp === false);
}
{
  const plan = K.planReconcile({ obs: baseObs(), state: baseState({ viewport: { width: 1280, height: 800, offsetTop: 0 } }), prefs: K.PREF_DEFAULTS, caps: {} });
  check('desktop mode removes shell header', plan.shellMode === 'desktop' && plan.rootAdd.indexOf('gdmux-no-header') !== -1);
}
{
  const prefs = Object.assign({}, K.PREF_DEFAULTS, { bottomBar: false });
  const plan = K.planReconcile({ obs: baseObs(), state: baseState(), prefs, caps: {} });
  check('bottomBar=false hides toolbar, uses statusbar gap', plan.rootAdd.indexOf('gdmux-no-footer') !== -1 && plan.vars['--gdmux-shell-bottom'] === '22px');
}
{
  // pending command suppresses adoption so validation can complete
  const obs = baseObs({ appSurface: 'editor' });
  const plan = K.planReconcile({ obs, state: baseState({ activeSurface: 'explorer' }), prefs: K.PREF_DEFAULTS, caps: {}, pending: { cmd: 'openExplorer' } });
  check('pending command suppresses adoption', plan.adoptedFromApp === false && plan.activeSurface === 'explorer');
}

/* ----------------------- feature statuses (spec §35/§36) ------------------- */
section('Feature status honesty (§35/§36)');
{
  const rows = K.computeFeatureStatuses({ caps: {}, stats: {}, vvUsed: null });
  const map = Object.fromEntries(rows.map(([n, v]) => [n, v]));
  check('git operations always OUT_OF_SCOPE', map['Git operations'].status === K.FSTATUS.OUT_OF_SCOPE);
  check('unknown future DOM BLOCKED', map['Unknown future GitHub DOM'].status === K.FSTATUS.BLOCKED);
  check('no evidence -> not VERIFIED (viewport)', map['Mobile viewport detection'].status !== K.FSTATUS.VERIFIED);
  check('no evidence -> not VERIFIED (explorer)', map['Explorer drawer'].status !== K.FSTATUS.VERIFIED);
}
{
  const rows = K.computeFeatureStatuses({
    caps: { explorer: K.CAP.DETECTED }, stats: { explorerValidated: true, viewportApplied: true }, vvUsed: 'visualViewport',
  });
  const map = Object.fromEntries(rows.map(([n, v]) => [n, v]));
  check('validated capability -> VERIFIED', map['Explorer drawer'].status === K.FSTATUS.VERIFIED);
  check('applied viewport -> VERIFIED', map['Mobile viewport detection'].status === K.FSTATUS.VERIFIED);
}

/* ------------------------------ summary ------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  failures.forEach((f) => console.error(` - ${f}`));
  process.exit(1);
}
console.log('Kernel unit suite green. Live-runtime matrix: docs/verification.md');
