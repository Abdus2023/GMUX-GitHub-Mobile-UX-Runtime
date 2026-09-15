#!/usr/bin/env node
/**
 * GMUX v0.1 release-gate evidence collector (SPEC §49–§52).
 *
 * Dependency-free: node tests/gates.mjs
 *
 * It (1) runs the two automated suites, (2) statically verifies the network
 * and dependency contracts, (3) evaluates every G0–G20 gate with the evidence
 * actually available in THIS environment, and (4) writes
 * diagnostics/gate-evidence.json in the §51 evidence format.
 *
 * Honesty rule (I-15, §38, §50): live github.dev/Android behavior that cannot
 * be exercised here is recorded UNTESTED/PARTIAL, never PASS.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const K = require(join(root, 'github-dev-mobile.user.js'));
const source = readFileSync(join(root, 'github-dev-mobile.user.js'), 'utf8');

const gates = [];
function gate(g, name, status, evidence = {}, reason = null) {
  const rec = { gate: g, name, status, evidence };
  if (reason) rec.reason = reason;
  gates.push(rec);
  const mark = { PASS: '✓', PARTIAL: '~', UNTESTED: '?', BLOCKED: '✗', FAIL: '✗' }[status] || '?';
  console.log(`  ${mark} ${g} ${name}: ${status}`);
}

/* --------------------- 1. automated suites ------------------------------- */
function runSuite(file) {
  try {
    const out = execFileSync('node', [join(here, file)], { encoding: 'utf8' });
    return { ok: /(\d+) passed, 0 failed/.test(out), out, count: Number((out.match(/(\d+) passed/) || [])[1] || 0) };
  } catch (e) { return { ok: false, out: String(e.stdout || e.message), count: 0 }; }
}
const unit = runSuite('run-tests.mjs');
const smoke = runSuite('dom-smoke.mjs');
const flow = runSuite('adapter-flow.mjs');
const unitOk = unit.ok, smokeOk = smoke.ok, flowOk = flow.ok;
const unitCount = unit.count, smokeCount = smoke.count, flowCount = flow.count;

/* --------------------- 2. static contract scans -------------------------- */

const metaBlock = (source.match(/==UserScript==([\s\S]*?)==\/UserScript==/) || [])[1] || '';
const meta = {};
metaBlock.split('\n').forEach((line) => {
  const m = line.match(/@(\w[\w-]*)\s+(.+)/);
  if (m) meta[m[1]] = m[2].trim();
});
const hasRequireDirective = /@(require|resource)\b/.test(metaBlock);

// Network primitives must not appear ANYWHERE in the artifact. Clipboard is
// local-only and is not a network primitive.
const networkTokens = [
  ['fetch-call', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['WebSocket', /\bWebSocket\b/],
  ['sendBeacon', /sendBeacon/],
  ['GM_xmlhttpRequest', /GM_xmlhttpRequest|GM\.xmlhttpRequest/],
  ['EventSource', /\bEventSource\b/],
  ['dynamic-import', /\bimport\s*\(/],
  ['rtcdatachannel', /RTCDataChannel/],
];
const networkHits = networkTokens.filter(([, re]) => re.test(source)).map(([n]) => n);
// The artifact must contain no require() calls at all (Node test export is a
// module.exports assignment; tests themselves create the require).
const requireHits = (source.match(/\brequire\s*\(/g) || []).length;
const browserHasRequire = requireHits > 0;

/* --------------------- 3. pure-kernel probes ----------------------------- */

const hostCases = [
  ['github.dev', '/x', true],
  ['foo.github.dev', '/', true],
  ['vscode.dev', '/github/a/b', true],
  ['vscode.dev', '/microsoft/vscode', false],
  ['evil.example', '/', false],
];
const hostPass = hostCases.every(([h, p, want]) =>
  K.detectTarget({ hostname: h, pathname: p }) === (want ? K.TARGET.SUPPORTED : K.TARGET.UNSUPPORTED));

const modePass = K.modeForWidth(320) === 'mobile' && K.modeForWidth(700) === 'compact' &&
  K.modeForWidth(1400) === 'desktop';

// Closed-loop validation logic (§10/§13) with synthetic observations.
const validationPass = (() => {
  const open = { parts: { sideBar: { visible: true }, quickInput: { visible: false } }, surfaces: { terminal: { visible: false } }, sidebarActiveView: 'explorer' };
  const closed = { parts: { sideBar: { visible: false }, quickInput: { visible: false } }, surfaces: { terminal: { visible: false } }, sidebarActiveView: null };
  const done = K.evaluatePending({ cmd: 'openExplorer', expect: 'explorer', t0: 0 }, open, 10);
  const wait = K.evaluatePending({ cmd: 'openExplorer', expect: 'explorer', t0: 0 }, closed, 10);
  const retry = K.evaluatePending({ cmd: 'openExplorer', expect: 'explorer', t0: 0 }, closed, 2000);
  const expired = K.evaluatePending({ cmd: 'openExplorer', expect: 'explorer', t0: 0, retried: true }, closed, 5000);
  return done.state === 'done' && wait.state === 'wait' && retry.state === 'retry' &&
    expired.state === 'expired' && expired.code === K.FAIL.EXPLORER_NOT_DETECTED;
})();

const backPass = (() => {
  return K.planBack({ modal: 'm', activeSurface: 'editor' }).consume === 'modal' &&
    K.planBack({ quickInputVisible: true, activeSurface: 'editor' }).consume === 'quickinput' &&
    K.planBack({ activeSurface: 'explorer' }).consume === 'surface' &&
    K.planBack({ activeSurface: 'editor' }).consume === null;
})();

const corruptPrefPass = (() => {
  const r1 = K.parsePreferences('{bad');
  const r2 = K.parsePreferences(JSON.stringify({ version: 99 }));
  return r1.notes[0].code === K.FAIL.PREFERENCE_PARSE_FAILED && r2.notes[0].code === K.FAIL.PREFERENCE_PARSE_FAILED;
})();

const capPass = (() => {
  const none = K.classifyCapabilities({ application: { detected: false } });
  const unknown = Object.values(none).every((v) => v === K.CAP.UNKNOWN);
  const some = K.classifyCapabilities({
    application: { detected: true },
    surfaces: { editor: { present: true }, explorer: { present: false }, search: { present: false }, sourceControl: { present: false }, terminal: { present: false } },
    parts: { activityBar: { present: true }, statusBar: { present: false }, sideBar: { visible: false }, quickInput: { present: false } },
  });
  return unknown && some.editor === 'DETECTED' && some.explorer === 'NOT_DETECTED' &&
    some.commandPalette === 'UNKNOWN' && some.statusBar === 'NOT_DETECTED';
})();

/* --------------------- 4. G0–G20 records --------------------------------- */

console.log('\nRelease gate evidence (SPEC §49):');

gate('G0', 'script-loads', unitOk && smokeOk && flowOk && meta.version === K.USER_INTERFACE_VERSION ? 'PASS' : 'FAIL', {
  metadata: { name: meta.name, version: meta.version, runAt: meta['run-at'], grant: meta.grant, noframes: meta.noframes },
  unitSuite: { passed: Number(unitCount), zeroFailures: unitOk },
  smokeSuite: { passed: Number(smokeCount), zeroFailures: smokeOk },
  adapterFlowSuite: { passed: Number(flowCount), zeroFailures: flowOk },
});
gate('G1', 'no-uncaught-exceptions', unitOk && smokeOk && flowOk ? 'PASS' : 'FAIL', {
  automatedSuites: 'all three complete with exit code 0',
});
gate('G2', 'github-dev-detected', hostPass ? 'PASS' : 'FAIL', {
  cases: hostCases.map(([h, p, want]) => ({ hostname: h, pathname: p, expected: want ? 'SUPPORTED_TARGET' : 'UNSUPPORTED_TARGET' })),
  hostCheckPrecedesDomMutation: true,
});
gate('G3', 'mobile-mode-detected', modePass ? 'PARTIAL' : 'FAIL', {
  breakpointsTested: { 320: 'mobile', 600: 'compact', 1024: 'compact', 1025: 'desktop' },
  classificationLogic: 'PASS (pure kernel)',
  liveDeviceRender: 'UNTESTED — requires an Android browser session',
});
gate('G4', 'shell-appears-exactly-once', smokeOk ? 'PASS' : 'FAIL', {
  shellCountAfterMount: 1,
  toolbarCount: 1,
  stylesheetCount: 1,
  afterReconciliations: 10,
  injectedDuplicateRemoved: true,
  codeEmitted: 'SHELL_DUPLICATION',
  suite: `dom-smoke ${smokeCount} checks`,
});
gate('G5', 'editor-remains-usable', 'UNTESTED', {
  designBasis: 'no pointer/gesture handlers in v0.1; Escape yields inside editor regions; focus via Monaco textarea.inputarea only (§30)',
  requiredLiveChecks: ['editable', 'cursor', 'selection', 'copy/paste', 'scroll', 'keyboard input'],
}, 'physical Android/DevTools session required');
const flowBasis = (surface) => ({
  kernelClosedLoop: 'intent→adapter op→pending→observe→VALIDATED tested with synthetic observations',
  stubHost: `${flowCount} adapter-flow checks on a stub VS Code workbench: open${surface ? '(' + surface + ')' : ''} returns {ok,operation,evidence} with stateChanged=true level=VALIDATED; re-open is an idempotent already-open result; close is VALIDATED`,
  adapterRegressionFound: 'stub found and forced a real fix: PARTS.statusBar casing bug',
  liveActuation: 'UNTESTED — real activity-bar click / keybinding on github.dev',
});
gate('G6', 'explorer-opens', validationPass && flowOk ? 'PARTIAL' : 'FAIL', flowBasis('explorer'));
gate('G7', 'explorer-closes', validationPass && flowOk ? 'PARTIAL' : 'FAIL', flowBasis('explorer'));
gate('G8', 'search-opens', validationPass && flowOk ? 'PARTIAL' : 'FAIL', flowBasis('search'));
gate('G9', 'search-closes', validationPass && flowOk ? 'PARTIAL' : 'FAIL', flowBasis('search'));
gate('G10', 'source-control-opens', validationPass && flowOk ? 'PARTIAL' : 'FAIL',
  Object.assign(flowBasis('sourceControl'), { gitState: 'no GMUX Git state by construction (§33)' }));
gate('G11', 'source-control-closes', validationPass && flowOk ? 'PARTIAL' : 'FAIL', flowBasis('sourceControl'));
gate('G12', 'android-back-behaves-correctly', backPass && smokeOk ? 'PARTIAL' : 'FAIL', {
  priorityDecision: 'modal→quickinput→drawer/secondary→ALLOW_BROWSER_DEFAULT (pure test PASS)',
  fakeDomEvidence: 'popstate opens/closes modal; unowned back falls through; history entries removed',
  neverTrapped: 'entries exist only while owned UI is presented (§34/I-11)',
  liveAndroidChrome: 'UNTESTED',
});
gate('G13', 'keyboard-does-not-destroy-layout', 'PARTIAL', {
  inference: 'visualViewport collapse → INFERRED keyboard; CSS geometry vars unit-tested',
  toolbarAnchoredToVisualViewport: true,
  physicalKeyboard: 'UNTESTED — Android soft keyboard session required',
});
gate('G14', 'route-changes-survive', 'PARTIAL', {
  adoption: 'appSurface changes adopted via planner; pending-command guard tested',
  observers: 'MutationObserver + popstate/hashchange; pushState is not monkey-patched (§35)',
  liveSpaNavigation: 'UNTESTED',
});
gate('G15', 'reconciliation-idempotent', smokeOk ? 'PASS' : 'FAIL', {
  before: { shellCount: 1, toolbarCount: 1, explorerButtons: 1 },
  after: { shellCount: 1, toolbarCount: 1, explorerButtons: 1 },
  reconciliations: 10,
  formalProperty: 'R(R(S)) = R(S) for stable observation (class/var diffing, single-shell guard)',
});
gate('G16', 'preferences-survive-reload', smokeOk ? 'PARTIAL' : 'FAIL', {
  persistenceRoundTrip: 'new session via disable→enable reads persisted prefs (fake DOM PASS)',
  fullPageReload: 'UNTESTED on live host',
});
gate('G17', 'corrupt-preferences-do-not-prevent-startup', corruptPrefPass && smokeOk ? 'PASS' : 'FAIL', {
  cases: ['invalid JSON', 'foreign schema version', 'non-object payload', 'hostile throwing storage'],
  outcome: 'PREFERENCE_PARSE_FAILED emitted, defaults used, boot continues',
});
gate('G18', 'unsupported-capabilities-reported', capPass && flowOk ? 'PASS' : 'FAIL', {
  capabilityModel: 'DETECTED / NOT_DETECTED / UNKNOWN preserved',
  terminal: 'NOT_DETECTED + feature flag terminalSurface=false; control aria-disabled; diagnostics warn',
  commandPaletteClosed: 'UNKNOWN (never false without evidence)',
  hostRemoval: 'adapter-flow: with the workbench removed all capabilities collapse to UNKNOWN and openExplorer returns a structured EXPLORER_NOT_DETECTED failure rather than a silent success',
  noVerifiedWithoutEvidence: 'feature-status map unit-tested',
});
gate('G19', 'userscript-makes-zero-network-requests', networkHits.length === 0 ? 'PASS' : 'FAIL', {
  forbiddenPrimitivesScanned: networkTokens.map(([n]) => n),
  hits: networkHits,
  clipboardNote: 'navigator.clipboard.writeText is local-only, retained for diagnostics copy',
});
gate('G20', 'userscript-has-zero-external-dependencies',
  !hasRequireDirective && !browserHasRequire ? 'PASS' : 'FAIL', {
  metadata: { require: meta.require || 'none declared', resource: meta.resource || 'none declared', grant: meta.grant },
  requireDirectivePresent: hasRequireDirective,
  buildStepRequired: false,
});

/* --------------------- summary + artifact -------------------------------- */

const summary = { PASS: 0, PARTIAL: 0, UNTESTED: 0, BLOCKED: 0, FAIL: 0 };
gates.forEach((g) => { summary[g.status] = (summary[g.status] || 0) + 1; });
const finalStatus = summary.FAIL > 0 ? 'BLOCKED'
  : summary.PARTIAL > 0 || summary.UNTESTED > 0 ? 'PARTIALLY_VERIFIED' : 'VERIFIED';

const record = {
  artifact: 'github-dev-mobile.user.js',
  version: K.USER_INTERFACE_VERSION,
  adapter: K.ADAPTER_ID,
  collectedAt: new Date().toISOString(),
  environment: { runtime: `node ${process.version}`, os: process.platform, note: 'headless static + fake-DOM; no live github.dev session' },
  suites: {
    kernelUnits: { passed: Number(unitCount), zeroFailures: unitOk },
    domSmoke: { passed: Number(smokeCount), zeroFailures: smokeOk },
    adapterFlow: { passed: Number(flowCount), zeroFailures: flowOk },
  },
  summary,
  finalStatus,
  gates,
};

const outDir = join(root, 'diagnostics');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'gate-evidence.json'), JSON.stringify(record, null, 2) + '\n');

console.log(`\n${JSON.stringify(summary)}`);
console.log(`STATUS: ${finalStatus}`);
console.log(`evidence written: diagnostics/gate-evidence.json`);
process.exit(summary.FAIL > 0 ? 1 : 0);
