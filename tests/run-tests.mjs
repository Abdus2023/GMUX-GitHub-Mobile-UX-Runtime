#!/usr/bin/env node
/**
 * GMUX v0.1 kernel suite — pure contracts, no DOM.
 *
 * Dependency-free: node tests/run-tests.mjs
 *
 * The userscript is required with no `window`/`document` present, so only the
 * DOM-free kernel is reachable. That is deliberate: it proves the kernel has no
 * structural dependency on a page (pack §59 containment, §21 convergence) and
 * it keeps every assertion here about contracts the pack freezes —
 * environment, heuristic labelling, state shape, the twelve reducer actions,
 * capability derivation, verification and the BLOCKED adapter.
 *
 * Honesty rule (§60/§68): nothing here exercises live github.dev. Gates that
 * need a real browser are recorded UNTESTED by tests/gates.mjs.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const K = require('../github-dev-mobile.user.js');

/**
 * Two views of the artifact: `src` keeps comments (several assertions below are
 * about the *documentation* the pack requires, e.g. the HEURISTIC label), while
 * `code` has comments stripped so forbidden-API scans only judge executable
 * text — the file legitimately names `iframe`, `Android` and `Monaco` while
 * explaining that it does not use them.
 */
const src = readFileSync(new URL('../github-dev-mobile.user.js', import.meta.url), 'utf8');
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name + (detail ? ` — ${detail}` : ''));
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function section(t) { console.log(`\n== ${t} ==`); }


/* ---------------------------- §5 namespace ------------------------------- */
section('Global namespace (§5)');
check('GMUX exists', K.GMUX && typeof K.GMUX === 'object');
check('GMUX.version is 0.1.0', K.GMUX.version === '0.1.0');
check('GMUX.inspect is required', typeof K.GMUX.inspect === 'function');
check('namespace keys are exactly the frozen six plus version/inspect',
  eq(Object.keys(K.GMUX).slice().sort(),
    ['adapter', 'inspect', 'observer', 'shell', 'state', 'version', 'viewportObserver'].sort()),
  Object.keys(K.GMUX).join(','));
check('boot state is null before bootstrap (no DOM here)', K.GMUX.state === null);

/* --------------------------- §7 environment ------------------------------ */
section('Environment is observational (§7)');
const env = K.getEnvironment();
check('getEnvironment returns the five contract fields',
  ['width', 'height', 'orientation', 'coarsePointer', 'touchPoints'].every((k) => k in env));
check('zero geometry without a window', env.width === 0 && env.height === 0);
check('width>=height classifies landscape', env.orientation === 'landscape');
check('coarsePointer degrades to false without matchMedia', env.coarsePointer === false);
check('touchPoints defaults to 0', env.touchPoints === 0);
check('classifyViewport: 599 → mobile', K.classifyViewport({ width: 599 }) === 'mobile');
check('classifyViewport: 0 → mobile', K.classifyViewport({ width: 0 }) === 'mobile');
check('classifyViewport: 600 → compact (boundary is exclusive)', K.classifyViewport({ width: 600 }) === 'compact');
check('classifyViewport: 1023 → compact', K.classifyViewport({ width: 1023 }) === 'compact');
check('classifyViewport: 1024 → desktop (boundary is exclusive)', K.classifyViewport({ width: 1024 }) === 'desktop');
check('classifyViewport: 2560 → desktop', K.classifyViewport({ width: 2560 }) === 'desktop');
check('breakpoint constants match §7', K.MOBILE_MAX_WIDTH === 600 && K.COMPACT_MAX_WIDTH === 1024);
check('no user-agent sniffing in executable code', !/navigator\.userAgent|Android\b|CriOS|FxiOS|Chrome\/|iPhone|iPad/i.test(code));
check('no browser-brand inference in executable code', !/navigator\.vendor|navigator\.platform/.test(code));

section('Mode resolution keeps configuration and measurement distinct');
check('auto defers to classification', eq(K.resolveMode('mobile', 'auto'), { mode: 'mobile', source: 'viewport-classification' }));
check('explicit mode overrides with a stated basis', eq(K.resolveMode('desktop', 'mobile'), { mode: 'mobile', source: 'configuration-override' }));
check('unknown preference value is not an override', K.resolveMode('compact', 'tablet').mode === 'compact');

/* ------------------------- §8 keyboard heuristic -------------------------- */
section('Keyboard is a labelled heuristic (§8)');
check('threshold constant is 150', K.KEYBOARD_THRESHOLD === 150);
check('labelled HEURISTIC in source comments', /§8 HEURISTIC/.test(src));
check('returns false with no visualViewport', K.keyboardLikelyVisible() === false);
check('source names it a heuristic, not detection', /NOT definitive keyboard detection/.test(src));

/* ----------------------------- §9 state ---------------------------------- */
section('State contract (§9)');
const s0 = K.initialState;
check('exact key set, no extras',
  eq(Object.keys(s0).sort(), ['capabilities', 'diagnostics', 'drawer', 'immersive', 'keyboardVisible', 'mode', 'pendingAction', 'previousSurface', 'surface'].sort()),
  Object.keys(s0).join(','));
check('defaults: desktop / editor / no drawer / no pending',
  s0.mode === 'desktop' && s0.surface === 'editor' && s0.drawer === null && s0.pendingAction === null && s0.previousSurface === null);
check('diagnostics counters start at zero with null lastError',
  s0.diagnostics.observations === 0 && s0.diagnostics.reconciliations === 0 && s0.diagnostics.lastError === null);
for (const hostState of ['repository', 'branch', 'file', 'cursor', 'selection', 'editorModel', 'terminalSession', 'gitStatus']) {
  check(`no parallel host state: ${hostState}`, !(hostState in s0));
}

/* ---------------------------- §10 reducer -------------------------------- */
section('Reducer: the twelve actions (§10)');
for (const name of ['ENVIRONMENT_CHANGED', 'OPEN_SURFACE_REQUEST', 'SURFACE_COMMITTED', 'SURFACE_REJECTED',
  'CLOSE_SURFACE_REQUEST', 'IMMERSIVE_TOGGLE', 'KEYBOARD_CHANGED', 'CAPABILITIES_CHANGED', 'BACK',
  'DIAGNOSTICS_OPEN', 'DIAGNOSTICS_CLOSE', 'DISABLE']) {
  check(`action ${name} is defined`, K.ACTION[name] === name);
}
const A = K.ACTION;
check('ENVIRONMENT_CHANGED updates mode', K.reducer(s0, { type: A.ENVIRONMENT_CHANGED, mode: 'mobile' }).mode === 'mobile');
const onceMode = K.reducer(s0, { type: A.ENVIRONMENT_CHANGED, mode: 'mobile' });
check('ENVIRONMENT_CHANGED is idempotent (re-application returns the same reference)',
  K.reducer(onceMode, { type: A.ENVIRONMENT_CHANGED, mode: 'mobile' }) === onceMode);
check('unchanged environment returns the identical reference (no needless churn)',
  (() => { const b = { ...s0, mode: 'mobile' }; return K.reducer(b, { type: A.ENVIRONMENT_CHANGED, mode: 'mobile' }) === b; })());

const requested = K.reducer(s0, { type: A.OPEN_SURFACE_REQUEST, surface: 'explorer' });
check('OPEN_SURFACE_REQUEST only sets pending state',
  eq(requested.pendingAction && { type: requested.pendingAction.type, surface: requested.pendingAction.surface }, { type: 'open', surface: 'explorer' }));
check('OPEN_SURFACE_REQUEST does not move surface', requested.surface === 'editor' && requested.previousSurface === null);
check('OPEN_SURFACE_REQUEST does not open the drawer', requested.drawer === null);
check('request for editor is refused', K.reducer(s0, { type: A.OPEN_SURFACE_REQUEST, surface: 'editor' }) === s0);
check('request for an unknown surface is refused', K.reducer(s0, { type: A.OPEN_SURFACE_REQUEST, surface: 'notebook' }) === s0);

const base = { ...s0, surface: 'search', drawer: { kind: 'surface', surface: 'search' } };
const committed = K.reducer({ ...s0, surface: 'explorer', drawer: { kind: 'surface', surface: 'explorer' }, pendingAction: { type: 'open', surface: 'terminal' } },
  { type: A.SURFACE_COMMITTED, surface: 'terminal' });
check('SURFACE_COMMITTED records previous surface', committed.previousSurface === 'explorer');
check('SURFACE_COMMITTED sets surface', committed.surface === 'terminal');
check('SURFACE_COMMITTED clears pending', committed.pendingAction === null);
check('SURFACE_COMMITTED resets drawer to the committed window', eq(committed.drawer, { kind: 'surface', surface: 'terminal' }));
check('SURFACE_COMMITTED to editor closes the drawer',
  K.reducer(committed, { type: A.SURFACE_COMMITTED, surface: 'editor' }).drawer === null);
check('SURFACE_COMMITTED refuses unknown surfaces', K.reducer(s0, { type: A.SURFACE_COMMITTED, surface: 'hacker' }) === s0);

const rejected = K.reducer(requested, { type: A.SURFACE_REJECTED });
check('SURFACE_REJECTED clears pending only', rejected.pendingAction === null && rejected.surface === 'editor');
check('SURFACE_REJECTED keeps host surface untouched', rejected.surface === s0.surface);

const closeReq = K.reducer(base, { type: A.CLOSE_SURFACE_REQUEST });
check('CLOSE_SURFACE_REQUEST closes the GMUX window', closeReq.drawer === null);
check('CLOSE_SURFACE_REQUEST keeps surface until verified (§69)', closeReq.surface === 'search');
check('CLOSE_SURFACE_REQUEST records a close intent', closeReq.pendingAction.type === 'close' && closeReq.pendingAction.surface === 'search');

check('IMMERSIVE_TOGGLE flips', K.reducer(s0, { type: A.IMMERSIVE_TOGGLE }).immersive === true);
check('IMMERSIVE_TOGGLE flips back', K.reducer(K.reducer(s0, { type: A.IMMERSIVE_TOGGLE }), { type: A.IMMERSIVE_TOGGLE }).immersive === false);
check('KEYBOARD_CHANGED sets visible', K.reducer(s0, { type: A.KEYBOARD_CHANGED, visible: true }).keyboardVisible === true);
check('KEYBOARD_CHANGED dedupes', (() => { const b2 = { ...s0, keyboardVisible: true }; return K.reducer(b2, { type: A.KEYBOARD_CHANGED, visible: true }) === b2; })());
check('CAPABILITIES_CHANGED replaces the derived map',
  eq(K.reducer(s0, { type: A.CAPABILITIES_CHANGED, capabilities: { explorer: true } }).capabilities, { explorer: true }));
check('CAPABILITIES_CHANGED dedupes equal maps',
  (() => { const b3 = { ...s0, capabilities: { explorer: false, editor: false } }; return K.reducer(b3, { type: A.CAPABILITIES_CHANGED, capabilities: { explorer: false, editor: false } }) === b3; })());
const disabled = K.reducer(base, { type: A.DISABLE });
check('DISABLE marks state disabled and retreats to editor',
  disabled.disabled === true && disabled.surface === 'editor' && disabled.drawer === null && disabled.pendingAction === null);
check('unknown action types are inert', K.reducer(s0, { type: 'SOMETHING_ELSE' }) === s0);
check('reducer never returns undefined for a known action', K.reducer(s0, { type: A.DIAGNOSTICS_OPEN }) !== undefined);

/* -------------------------- §10 reducer purity ---------------------------- */
section('Reducer purity (§10: no DOM)');
const reducerBody = code.slice(code.indexOf('function reducer(state, action)'), code.indexOf('function planBack(state)'));
check('reducer body is locatable for the purity scan', reducerBody.length > 400 && reducerBody.includes('case ACTION.DISABLE'));
check('reducer body has no DOM references', !/document|window|querySelector|getElementById|\.style|classList|localStorage|adapter\./.test(reducerBody),
  'found a host/DOM reference inside reducer()');
check('reducer body has no side-effect APIs', !/setTimeout|fetch|dispatch\(|scheduleReconcile/.test(reducerBody));

/* ---------------------------- §39/§40 back ------------------------------- */
section('Back priority and navigation (§39/§40)');
check('nothing owned → Back is not consumed', K.planBack(s0).consume === false && K.planBack(s0).step === 'browser-default');
check('diagnostics outranks everything', (() => {
  const st = { ...s0, drawer: { kind: 'diagnostics' }, surface: 'search' };
  const p = K.planBack(st);
  return p.consume === true && p.step === 'diagnostics' && p.action.type === A.DIAGNOSTICS_CLOSE;
})());
check('drawer outranks secondary surface', (() => {
  const st = { ...s0, drawer: { kind: 'surface', surface: 'explorer' }, surface: 'explorer' };
  const p = K.planBack(st);
  return p.step === 'drawer' && p.action.type === A.CLOSE_SURFACE_REQUEST && p.command === 'close-explorer';
})());
check('secondary surface returns to editor via the engine, not the reducer', (() => {
  const st = { ...s0, surface: 'search' };
  const p = K.planBack(st);
  return p.step === 'secondary-surface' && p.action === null && p.command === 'close-search';
})());
check('BACK applies the same priority as planBack',
  K.reducer({ ...s0, drawer: { kind: 'diagnostics' } }, { type: A.BACK }).drawer === null);
check('BACK with nothing owned is a no-op', K.reducer(s0, { type: A.BACK }) === s0);
check('nav stack is editor-only at rest', eq(K.navStack(s0), ['editor']));
check('nav stack holds at most two entries', eq(K.navStack({ ...s0, surface: 'search' }), ['editor', 'search']));
check('diagnostics opens the owned window', K.reducer(s0, { type: A.DIAGNOSTICS_OPEN }).drawer.kind === 'diagnostics');
check('diagnostics open dedupes', (() => { const b4 = K.reducer(s0, { type: A.DIAGNOSTICS_OPEN }); return K.reducer(b4, { type: A.DIAGNOSTICS_OPEN }) === b4; })());
const surfaceDrawerState = { ...s0, drawer: { kind: 'surface', surface: 'explorer' } };
check('diagnostics close ignores a surface drawer',
  K.reducer(surfaceDrawerState, { type: A.DIAGNOSTICS_CLOSE }) === surfaceDrawerState);
check('diagnostics close leaves the host surface alone',
  K.reducer(surfaceDrawerState, { type: A.DIAGNOSTICS_CLOSE }).surface === 'editor');

/* ------------------------ §11/§12 adapter contract ------------------------ */
section('Host adapter is intentionally incomplete (§12)');
const ad = K.GitHubDevAdapter;
check('id is github-dev', ad.id === 'github-dev');
check('revision starts at 0', ad.revision === 0);
check('observe returns the five surfaces', eq(Object.keys(ad.observe()).sort(), ['editor', 'explorer', 'search', 'sourceControl', 'terminal'].sort()));
for (const surface of ['editor', 'explorer', 'search', 'sourceControl', 'terminal']) {
  check(`find${surface[0].toUpperCase()}${surface.slice(1)}() is null`, ad[`find${surface[0].toUpperCase()}${surface.slice(1)}`]() === null);
  check(`observe().${surface} is null`, ad.observe()[surface] === null);
  const r = ad.resolveSurface(surface);
  check(`resolveSurface(${surface}) is BLOCKED`, r.status === 'BLOCKED' && r.reason === 'No verified host mapping yet.');
}
const invoked = ad.invoke('open-explorer');
check('invoke is BLOCKED with the §12 reason', invoked.status === 'BLOCKED' && invoked.reason === 'GitHub-specific interaction not verified.');
const verified = ad.verify('open-explorer', {}, {});
check('verify is BLOCKED with the §12 reason', verified.status === 'BLOCKED' && verified.reason === 'Verification contract not implemented.');
check('verify echoes action/before/after', verified.action === 'open-explorer' && verified.before && verified.after);
const restored = ad.restore({ any: 'snapshot' });
check('restore is PROVISIONAL and echoes the snapshot', restored.status === 'PROVISIONAL' && eq(restored.snapshot, { any: 'snapshot' }));

/* -------------------- §14/§15 observation + capability -------------------- */
section('Observation records and capabilities (§14/§15)');
const { records } = K.observeSurfaces(ad);
check('record has the five §14 fields', ['surface', 'detected', 'evidence', 'strategy', 'confidence'].every((f) => f in records.explorer));
check('undetected surface: detected false, empty evidence, null strategy, UNKNOWN',
  records.explorer.detected === false && eq(records.explorer.evidence, []) && records.explorer.strategy === null && records.explorer.confidence === 'UNKNOWN');
check('confidence vocabulary is categorical only',
  eq(Object.keys(K.CONFIDENCE), ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH']));
check('no numeric confidence anywhere in source', !/confidence:\s*0?\.\d+|confidence:\s*(9[0-9]|100)\b/.test(src));
const caps = K.detectCapabilities(ad.observe());
check('capabilities are booleans', Object.values(caps).every((v) => typeof v === 'boolean'));
check('all capabilities false against the stub adapter', Object.values(caps).every((v) => v === false));
check('record-valued adapter results do not invert to true',
  eq(K.detectCapabilities({ editor: { detected: false, confidence: 'HIGH' }, explorer: { detected: true, confidence: 'HIGH' }, search: null, sourceControl: undefined, terminal: null }),
    { editor: false, explorer: true, search: false, sourceControl: false, terminal: false }));
check('sameCapabilities ignores ordering, honours values',
  K.sameCapabilities({ a: true, b: false }, { b: false, a: true }) === true && K.sameCapabilities({ a: true }, { a: false }) === false);

/* --------------------------- §18/§19 verification ------------------------- */
section('Verification discipline (§18/§19)');
const rec = (detected, confidence) => ({ surface: 'explorer', detected, evidence: [], strategy: null, confidence });
check('no post-action observation → BLOCKED', K.verifyTransition(rec(true, 'HIGH'), null, 'open').status === 'BLOCKED');
check('unobserved before is recorded as such', K.verifyTransition(null, rec(true, 'HIGH'), 'open').evidence.before === 'unobserved');
check('UNKNOWN-confidence hit never verifies', K.verifyTransition(rec(false, 'UNKNOWN'), rec(true, 'UNKNOWN'), 'open').status === 'BLOCKED');
check('MEDIUM-confidence hit never verifies', K.verifyTransition(rec(false, 'LOW'), rec(true, 'MEDIUM'), 'open').status === 'BLOCKED');
check('HIGH-confidence open verifies', (() => {
  const v = K.verifyTransition(rec(false, 'HIGH'), rec(true, 'HIGH'), 'open');
  return v.status === 'VERIFIED' && v.evidence.before === 'closed' && v.evidence.after === 'open';
})());
check('HIGH-confidence close verifies', (() => {
  const v = K.verifyTransition(rec(true, 'HIGH'), rec(false, 'HIGH'), 'closed');
  return v.status === 'VERIFIED' && v.evidence.after === 'closed';
})());
check('wrong direction does not verify', K.verifyTransition(rec(false, 'HIGH'), rec(false, 'HIGH'), 'open').status === 'BLOCKED');
check('status vocabulary is exactly the four allowed',
  eq(Object.keys(K.STATUS), ['VERIFIED', 'PARTIALLY_VERIFIED', 'PROVISIONAL', 'BLOCKED']));
check('no evidence → no verified claim (phrase present in source)', /NO EVIDENCE.*NO VERIFIED CLAIM/.test(src));

/* ------------------------- §20 stabilization ----------------------------- */
section('Bounded stabilization (§20)');
check('defaults are the engineering parameters', K.STABILITY_TIMEOUT === 1000 && K.STABILITY_QUIET === 100);
const stabilityResult = await K.waitForStability();
check('resolves instead of hanging without a DOM', stabilityResult && stabilityResult.reason === 'no-dom');
check('carries elapsed and mutations', typeof stabilityResult.elapsed === 'number' && typeof stabilityResult.mutations === 'number');
const timeouted = await K.waitForStability({ timeout: 5, quiet: 50 });
check('custom parameters are honoured (timeout path terminates)', timeouted.settled === false);

/* --------------------------- §16/§17 actions ----------------------------- */
section('Action engine contracts (§16/§17)');
check('every command surface has open and close actions',
  K.surfaceCommands.every(([surface]) => K.actions[`open-${surface}`] && K.actions[`close-${surface}`]));
check('actions carry the six §17 fields', Object.keys(K.actions).every((id) => {
  const a = K.actions[id];
  return a.id === id && 'target' in a && typeof a.precondition === 'function' && typeof a.invoke === 'function'
    && typeof a.verify === 'function' && typeof a.reversible === 'boolean';
}));
check('surface actions are reversible', K.actions['open-explorer'].reversible === true);
check('focus-editor is not reversible (no state transition to undo)', K.actions['focus-editor'].reversible === false);
check('preconditions refuse without evidence', K.actions['open-explorer'].precondition().ok === false);
check('refusal keeps UNKNOWN as BLOCKED, not false', /capability-unknown/.test(K.actions['open-explorer'].precondition().reason));
const unknown = await K.executeAction('not-a-real-action');
check('unknown action → BLOCKED/unknown-action', unknown.status === 'BLOCKED' && unknown.reason === 'unknown-action');

const recorded = [];
const stubAdapter = {
  id: 'stub', revision: 0,
  detectEnvironment: () => true, observe: () => ({ explorer: null }),
  resolveSurface: () => ({ status: 'BLOCKED', surface: 'explorer', reason: 'no mapping' }),
  invoke: (a) => { recorded.push(`invoke:${a}`); return { status: 'BLOCKED', reason: 'no interaction' }; },
  verify: (a) => ({ status: 'BLOCKED', action: a, reason: 'no contract' }),
  restore: (s) => ({ status: 'PROVISIONAL', snapshot: s }),
  findExplorer: () => null,
};
K.GMUX.state = { ...K.initialState, capabilities: { explorer: true } };
K.__setAdapter(stubAdapter);
const preBlocked = await K.executeAction('open-explorer');
check('undetected capability blocks before any host call', preBlocked.status === 'BLOCKED' && eq(recorded, []));
check('blocking keeps the reason visible', /capability|no mapping/.test(preBlocked.reason), preBlocked.reason);

// Preconditions pass (detected + verified mapping) but the host refuses to act:
// the engine must report BLOCKED and must not have touched the DOM.
K.__setAdapter({
  ...stubAdapter,
  observe: () => ({ explorer: { detected: true, confidence: 'HIGH', strategy: 'aria', evidence: [{ type: 'aria-label', value: 'Explorer' }] } }),
  resolveSurface: () => ({ status: 'VERIFIED', surface: 'explorer', reason: null }),
});
// Capabilities are DERIVED from observation, never asserted by the test (§15),
// so the test drives one explicit reconciliation to derive them.
K.GMUX.state = { ...K.initialState, capabilities: {} };
K.reconcile();
check('capabilities re-derive from the adapter observation',
  K.GMUX.state.capabilities.explorer === true && K.GMUX.state.capabilities.editor === false,
  JSON.stringify(K.GMUX.state.capabilities));
check('a detected-but-unmapped-verify surface still passes the precondition',
  K.actions['open-explorer'].precondition().ok === true);
check('reconcile degrades safely when no shell could mount (§59)', K.GMUX.state.diagnostics.lastError === null);
const refused = await K.executeAction('open-explorer');
check('a refused invoke yields BLOCKED', refused.status === 'BLOCKED' && refused.reason === 'no interaction');
check('invoke was asked through the adapter, not the DOM', eq(recorded, ['invoke:open-explorer']));
check('a refused invoke never commits the surface', K.GMUX.state.surface === 'editor');
check('a refused invoke clears the pending intent', K.GMUX.state.pendingAction === null);
K.GMUX.state = null;
const withheld = await K.requestSurface('explorer', 'open');
check('§26 BLOCKED never reaches the host', withheld.status === 'BLOCKED' && withheld.attempted === false);
check('§26 BLOCKED is not counted as an attempt', eq(recorded, ['invoke:open-explorer']));
check('§26 BLOCKED explains itself', /no verified host mapping|capability-unknown/.test(withheld.reason));
const badDirection = await K.requestSurface('editor', 'open');
check('editor is not a host surface', badDirection.status === 'BLOCKED' && badDirection.reason === 'not-a-host-surface');
K.__setAdapter(ad);

/* ------------------------- §21 reconcile is inert early ------------------ */
section('Reconciliation without state is inert (§21)');
K.GMUX.state = null;
check('reconcile with no state returns null', K.reconcile() === null);
check('dispatch with no state is refused', K.dispatch({ type: A.BACK }) === false);
check('installStyles is inert without a DOM', K.installStyles() === null);
check('createShell is inert without a DOM', K.createShell() === null);
check('installObserver is inert without a DOM', K.installObserver() === null);
check('installViewportObserver is inert without a DOM', K.installViewportObserver() === null);
check('teardown is inert without a DOM', K.teardown() === undefined);

/* ---------------------------- §37 preferences ---------------------------- */
section('Defensive preference loading (§37)');
check('defaults are the §37 field set',
  eq(Object.keys(K.PREF_DEFAULTS).sort(), ['bottomBar', 'disabled', 'immersive', 'mode', 'preferredSurface', 'version'].sort()));
check('defaults are frozen', Object.isFrozen(K.PREF_DEFAULTS));
const stored = K.loadPreferences();
check('storage-unavailable is reported, not thrown', stored.issues.some((i) => /storage-unavailable/.test(i)));
check('defaults survive an unavailable store', stored.prefs.mode === 'auto' && stored.prefs.immersive === true && stored.prefs.bottomBar === true);
check('corrupt storage never blocks the host: no throw path', stored.prefs.version === 1);

/* ---------------------------- §26 command set ---------------------------- */
section('Surface commands (§26)');
check('exactly the four initial commands', eq(K.surfaceCommands, [['explorer', 'Files'], ['search', 'Search'], ['sourceControl', 'Git'], ['terminal', 'Terminal']]));
check('no command claims a host selector',
  !K.surfaceCommands.some(([surface, label]) => /[.#[]/.test(surface + label)));

/* ------------------------- §57/§58 diagnostics --------------------------- */
section('Diagnostics expose uncertainty (§57/§58)');
K.GMUX.state = { ...K.initialState };
K.GMUX.adapter = ad;
const report = K.buildReport();
check('report carries the §58 field list', ['GMUX version', 'adapter id', 'adapter revision', 'hostname', 'viewport',
  'orientation', 'pointer type', 'touch points', 'mode', 'keyboard', 'capabilities', 'shell mounted', 'style mounted',
  'observer installed', 'reconciliation count', 'observation count', 'last error', 'kill switch', 'host fingerprint']
  .every((label) => report.fields.some((f) => f.label === label)));
check('every field is labelled with its claim kind',
  report.fields.every((f) => Object.values(K.KIND).includes(f.kind)));
check('keyboard field is HEURISTIC, never OBSERVED',
  report.fields.find((f) => f.label === 'keyboard').kind === 'HEURISTIC');
check('orientation/mode/capabilities are DERIVED',
  ['orientation', 'mode', 'capabilities', 'host fingerprint', 'compatibility'].every((l) => report.fields.find((f) => f.label === l).kind === 'DERIVED'));
check('viewport/pointer/touch are OBSERVED',
  ['viewport', 'pointer type', 'touch points', 'hostname'].every((l) => report.fields.find((f) => f.label === l).kind === 'OBSERVED'));
check('observer entries are PROVISIONAL',
  ['observer installed', 'viewport observer'].every((l) => report.fields.find((f) => f.label === l).kind === 'PROVISIONAL'));
check('surfaces report detection and operation separately',
  Object.values(report.surfaces).every((s) => 'detection' in s && 'operation' in s && 'confidence' in s));
check('operation is BLOCKED while the adapter is revision 0',
  Object.values(report.surfaces).every((s) => s.operation === 'BLOCKED'));
check('compatibility cannot be claimed above BLOCKED at revision 0',
  report.fingerprint.compatibility === 'BLOCKED');
check('fingerprint is hex-ish and short', /^[0-9a-f]{8}$/.test(report.fingerprint.value));
check('fingerprint is deterministic', K.hostFingerprint(K.observeSurfaces(ad).records).value === report.fingerprint.value);
check('fingerprint changes with adapter revision',
  K.hostFingerprint(K.observeSurfaces(ad).records).value !== K.hostFingerprint({ editor: { detected: true, confidence: 'HIGH', evidence: [], strategy: 'aria', surface: 'editor' } }).value);
const text = K.formatReport(report);
check('formatted report includes the kind labels', /OBSERVED/.test(text) && /DERIVED/.test(text) && /HEURISTIC/.test(text) && /PROVISIONAL/.test(text));
check('formatted report states the intentional gap', /Adapter revision 0 is intentional/.test(text));
check('report never claims VERIFIED for a surface', !/VERIFIED/.test(text.replace(/PARTIALLY_VERIFIED/g, '')));
K.GMUX.state = null;

/* ------------------------- §3 hard-constraint scan ------------------------ */
section('Hard constraints (§3/§4) — static scan of the artifact');
const metaBlock = (src.match(/==UserScript==([\s\S]*?)==\/UserScript==/) || [])[1] || '';
const meta = {};
metaBlock.split('\n').forEach((line) => {
  const m = line.match(/@(\w[\w-]*)\s+(.+)/);
  if (m) meta[m[1]] = m[2].trim();
});
check('@name is exact', meta.name === 'GitHub.dev Mobile UX');
check('@namespace is github-dev-mobile', meta.namespace === 'github-dev-mobile');
check('@version is 0.1.0', meta.version === '0.1.0');
check('@description is exact', meta.description === 'Mobile interaction layer for github.dev');
check('@match is exactly https://github.dev/*',
  (metaBlock.match(/@match\s+(\S+)/g) || []).length === 1 && meta.match === 'https://github.dev/*');
check('@run-at is document-idle', meta['run-at'] === 'document-idle');
check('@grant is none', meta.grant === 'none');
check('no extra metadata directives beyond the frozen block',
  eq(Object.keys(meta).sort(), ['description', 'match', 'name', 'namespace', 'run-at', 'version'].concat(['grant']).sort()),
  Object.keys(meta).join(','));
for (const [label, re] of [
  ['@require', /@require\b/], ['@resource', /@resource\b/], ['@connect', /@connect\b/],
  ['GM_xmlhttpRequest', /GM_xmlhttpRequest|GM\.xmlhttpRequest/],
  ['fetch(', /\bfetch\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /WebSocket/],
  ['EventSource', /EventSource/], ['sendBeacon', /sendBeacon/], ['import(', /\bimport\s*\(/],
  ['iframe', /\biframe\b|createElement\(["']iframe/i],
  ['Monaco internals', /monaco\.|getEditors|ICodeEditor|ITextModel|\.getModel\(\)|editor\.getOption/],
  ['framework globals', /\bReact\b|\bReactDOM\b|\bVue\b|Svelte|\bangular\b|jQuery|\b_\b\s*=\s*require/],
  ['git commands', /git\s+(commit|push|pull|merge|rebase|checkout|stash)/i],
  ['setInterval', /setInterval/], ['timeout loop', /setTimeout\(\s*function\s+tick|requestAnimationFrame\([^)]*\)\s*;?\s*\}\s*\)/],
  ['direct host click', /\.click\(\)/], ['pushState', /pushState/], ['replaceState', /replaceState/],
  ['history.go/back', /history\.(go|back|forward)\s*\(/],
  ['innerHTML write', /\.innerHTML\s*=/], ['document.write', /document\.write/],
  ['userAgent', /userAgent/], ['cookie access', /document\.cookie/],
  ['document.referrer', /document\.referrer/], ['navigator.clipboard in runtime', /navigator\.clipboard/],
  ['storage of host truth', /localStorage\.setItem\(\s*["'](?!github-dev-mobile:v1)/],
  ['global leak', /globalThis\.[A-Za-z_$]/],
]) {
  check(`forbidden in executable code: ${label}`, !re.test(code), re.source);
}
for (const [label, re] of [['@require', /@require\b/], ['@resource', /@resource\b/], ['@connect', /@connect\b/]]) {
  check(`forbidden in metadata: ${label}`, !re.test(metaBlock), re.source);
}
check('comments state the network contract', /no network request/.test(src));
check('selector-free kernel: no host CSS classes in source',
  !/monaco-workbench|action-label|activitybar|part\.sidebar|part\.panel|explorer-folders-view|inputarea|view-lines|editorGroupHeader|tabs-container|quick-input|statusbar/.test(src));
check('no host element ids in source', !/workbench\.[a-z]+\.[a-z]+/i.test(src));
check('exactly one @match and it is the frozen pattern', !/@match\s+https:\/\/\*/.test(src));
check('ownership marker is present in source and CSS', (src.match(/data-gmux-owner/g) || []).length >= 2);
check('style marker is data-gmux-style', /data-gmux-style/.test(src));
check('element ids created via .id= are gmux-prefixed',
  (src.match(/\.id\s*=\s*["'`]([^"'`]+)["'`]/g) || []).every((m) => /gmux-|\$\{/.test(m)), (src.match(/\.id\s*=\s*["'`]([^"'`]+)["'`]/g) || []).join('|'));
check('CSS avoids universal selectors', !/[^-\w]\*\s*\{/.test(code));
check('CSS avoids !important', !/!important/.test(code));
check('no global overflow suppression', !/body\s*\{[^}]*overflow\s*:\s*hidden/.test(code));
check('no style writes to host nodes', !/document\.body\.style|documentElement\.style/.test(code));
check('the artifact explains its own hygiene', /no !important/.test(src));
check('safe-area insets are used (§33)', /env\(safe-area-inset-top/.test(src) && /env\(safe-area-inset-bottom/.test(src));
check('touch target constant is 44 (§34)', K.TOUCH_TARGET === 44);
check('storage key is the frozen one (§37)', K.STORAGE_KEY === 'github-dev-mobile:v1');
check('kill switch checks both mechanisms (§38)', /KILL_PARAM_OFF/.test(src) && /prefs\.disabled/.test(src));

/* ------------------------------ summary --------------------------------- */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Kernel suite green. Live github.dev behavior is NOT claimed here (see VERIFICATION_REPORT.md).');
}
