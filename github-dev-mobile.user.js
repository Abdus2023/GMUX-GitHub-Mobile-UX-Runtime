// ==UserScript==
// @name         GitHub.dev Mobile UX
// @namespace    https://github.com/Abdus2023/GMUX-GitHub-Mobile-UX-Runtime
// @version      0.1.0
// @description  v0.1 mobile interaction layer for github.dev (VS Code for the Web). Dependency-free, observation-driven, reversible. Observes and presents the existing application; GitHub/VS Code Web remains the sole application authority.
// @author       GMUX contributors
// @license      MIT
// @match        https://github.dev/*
// @match        https://*.github.dev/*
// @match        https://vscode.dev/github/*
// @match        https://*.vscode.dev/github/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
// Network contract (SPEC §44): @require none · @resource none · userscript
// network requests REQUIRED = 0. No @require/@resource directives are declared
// on purpose; no remote code or remote assets are ever fetched.
/**
 * GitHub.dev Mobile UX (GMUX) — v0.1.0 Concrete Implementation
 * ---------------------------------------------------------------------------
 * Normative specs: SPEC.md ("v0.1 Concrete Implementation Contract") plus the
 * inspection-first contract (reconnaissance → evidence → capability →
 * adapter → kernel → shell → observation → validation).
 *
 * Governing laws:
 *   Inspect first. Select second. Operate third. Validate fourth.
 *   Observe → Normalize → Decide → Mutate → Observe → Validate.
 *   The userscript owns mobile interaction; GitHub/VS Code owns app state.
 *   NO EVIDENCE → NO VERIFIED CLAIM.
 *   When the host is unknown, degrade or stop; do not guess.
 *   A selector is evidence, not truth. Detection is not operation.
 *   Operation is not validation. Broken recognition degrades safely.
 *
 * Single-file layout:
 *   §A identity & versions          §B vocabulary (enums, codes, flags)
 *   §C pure kernel (no DOM, no GitHub selectors — unit tested)
 *   §D github-dev adapter           ALL GitHub/VS Code DOM knowledge lives here
 *     (reconnaissance · selector registry + provenance · semantic fallback ·
 *      drift detection · Surface classes · structured operations)
 *   §E namespaced stylesheet        (.gmux-*, state classes only)
 *   §F shell UI                     §G viewport / keyboard / environment
 *   §H input & Android Back         §I reconciler (observe→decide→mutate→validate)
 *   §J lifecycle / observers        §K bootstrap, teardown, exports
 * Public namespace: globalThis.GMUX (version, inspect, getState,
 * getCapabilities, reconcile, disable). Local evidence only — no network.
 *
 * Privacy (§48): no network access, no telemetry, no credentials, no repo
 * content. Only versioned UI preferences in localStorage (§39).
 */
(function () {
'use strict';

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ===========================================================================
 * §A IDENTITY & VERSIONS
 * =========================================================================*/

const NAME = 'GitHub.dev Mobile UX';
const USER_INTERFACE_VERSION = '0.1.0';
const ADAPTER_ID = 'github-dev';
const ADAPTER_VERSION = 'github-dev@1';
const PREFERENCE_SCHEMA_VERSION = 1;

const STORAGE_KEY = 'gmux:prefs:v1';
const DISABLED_FLAG_KEY = 'gmux:disabled';
const STYLE_ID = 'gmux-style';
const ROOT_ID = 'github-mobile-ux';
const OWNER_ATTR = 'data-gmux-owner';
const OWNER_VALUE = 'github-dev-mobile';
const HISTORY_MARKER = 'gmux';

/* ===========================================================================
 * §B VOCABULARY — modes, surfaces, lifecycle, evidence, codes, flags
 * =========================================================================*/

// Shell modes (§18). Breakpoints are centralized policy defaults.
const SHELL_MODE = Object.freeze({ DESKTOP: 'desktop', COMPACT: 'compact', MOBILE: 'mobile' });
const DEFAULT_BREAKPOINTS = Object.freeze({ compactMin: 600, desktopMin: 1024 });

// v0.1 surface enumeration (§17). Terminal may be observed but stays disabled
// by default; SETTINGS exists only as the internal diagnostics/prefs surface.
const SURFACE = Object.freeze({
  EDITOR: 'editor',
  EXPLORER: 'explorer',
  SEARCH: 'search',
  SOURCE_CONTROL: 'sourceControl',
  TERMINAL: 'terminal',
  SETTINGS: 'settings',
});
const DRAWER_SURFACES = Object.freeze([SURFACE.EXPLORER, SURFACE.SEARCH, SURFACE.SOURCE_CONTROL]);
const SECONDARY_SURFACES = Object.freeze([SURFACE.EXPLORER, SURFACE.SEARCH, SURFACE.SOURCE_CONTROL, SURFACE.TERMINAL, SURFACE.SETTINGS]);

const LIFECYCLE = Object.freeze({
  BOOTSTRAPPING: 'BOOTSTRAPPING',
  WAITING_FOR_APP: 'WAITING_FOR_APP',
  ACTIVE: 'ACTIVE',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  DISABLED: 'DISABLED',
});

// Host classification (§7) — independent of any visual DOM detection.
const TARGET = Object.freeze({ SUPPORTED: 'SUPPORTED_TARGET', UNSUPPORTED: 'UNSUPPORTED_TARGET' });

// Capability values (§12). UNKNOWN must never become false without evidence.
const CAP = Object.freeze({ DETECTED: 'DETECTED', NOT_DETECTED: 'NOT_DETECTED', UNKNOWN: 'UNKNOWN' });

// Evidence levels (§11 + inspection-first §13).
// Core triple OBSERVED/INFERRED/VALIDATED is preserved; the extended set
// adds UNKNOWN/ATTEMPTED/REGRESSION-TESTED so discovery levels 0–5 can be
// mapped without collapsing categories (NO EVIDENCE → NO VERIFIED CLAIM).
const EVIDENCE = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  OBSERVED: 'OBSERVED',
  INFERRED: 'INFERRED',
  ATTEMPTED: 'ATTEMPTED',
  VALIDATED: 'VALIDATED',
  REGRESSION_TESTED: 'REGRESSION-TESTED',
});

// Discovery confidence levels (inspection-first §12):
//   0 UNKNOWN — nothing observed yet
//   1 DETECTED — element exists
//   2 SEMANTICALLY IDENTIFIED — sufficient semantic evidence
//   3 INTERACTION ATTEMPTED — operation was attempted
//   4 STATE TRANSITION OBSERVED — expected resulting state observed
//   5 REGRESSION-TESTED — repeatable regression coverage
// Levels MUST NOT be skipped silently; promotion requires evidence.
const DISCOVERY = Object.freeze({
  UNKNOWN: 0,
  DETECTED: 1,
  IDENTIFIED: 2,
  ATTEMPTED: 3,
  TRANSITION_OBSERVED: 4,
  REGRESSION_TESTED: 5,
});

// Surface lifecycle states (inspection-first §20).
const SURFACE_STATE = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  DETECTED: 'DETECTED',
  AVAILABLE: 'AVAILABLE',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
  DEGRADED: 'DEGRADED',
});

// Device orientation (§25). Tracked in layout state so portrait/landscape
// presentation policy can evolve safely; v0.1 landscape stays simple.
const ORIENTATION = Object.freeze({ PORTRAIT: 'portrait', LANDSCAPE: 'landscape' });

// Centralized presentation policy (inspection-first §22). No individual
// surface may invent its own viewport policy. `git` is the presentation key
// for the `sourceControl` surface (canonical id stays `sourceControl`).
const LAYOUT_POLICY = Object.freeze({
  mobile: Object.freeze({ explorer: 'drawer', search: 'fullscreen', git: 'fullscreen', terminal: 'fullscreen', editor: 'immersive' }),
  compact: Object.freeze({ explorer: 'drawer', search: 'panel', git: 'panel', terminal: 'panel', editor: 'normal' }),
  desktop: Object.freeze({ explorer: 'native', search: 'native', git: 'native', terminal: 'native', editor: 'native' }),
});

// Surface contract metadata (inspection-first §21): id/presentation/priority.
const SURFACE_META = Object.freeze({
  editor: Object.freeze({ id: 'editor', presentation: 'immersive', priority: 10 }),
  explorer: Object.freeze({ id: 'explorer', presentation: 'drawer', side: 'left', priority: 50 }),
  search: Object.freeze({ id: 'search', presentation: 'fullscreen', priority: 90 }),
  sourceControl: Object.freeze({ id: 'sourceControl', presentation: 'fullscreen', priority: 80 }),
  terminal: Object.freeze({ id: 'terminal', presentation: 'fullscreen', priority: 70 }),
  settings: Object.freeze({ id: 'settings', presentation: 'modal', priority: 100 }),
});

// Feature status vocabulary for diagnostics (§37/§38).
const FSTATUS = Object.freeze({
  VERIFIED: 'VERIFIED', PARTIALLY_VERIFIED: 'PARTIALLY_VERIFIED',
  PROVISIONAL: 'PROVISIONAL', BLOCKED: 'BLOCKED', OUT_OF_SCOPE: 'OUT_OF_SCOPE',
});

// Feature flags (§36). Experimental functionality is independently switchable.
// gestures is deferred from v0.1 (§2 explicit deferral; §54 "do not implement
// gestures in v0.1") and MUST stay off. Terminal is disabled by default (§17).
const FEATURES = Object.freeze({
  mobileShell: true,
  immersiveEditor: true,
  explorerDrawer: true,
  searchSurface: true,
  sourceControlSurface: true,
  terminalSurface: false,
  gestures: false,
  androidBack: true,
  diagnostics: true,
});

// Failure taxonomy (§45 + inspection-first §17/§48 ADAPTER_DRIFT).
// Exhaustive for v0.1; failures surface in diagnostics.
const FAIL = Object.freeze({
  BOOTSTRAP_FAILED: 'BOOTSTRAP_FAILED',
  ADAPTER_NOT_FOUND: 'ADAPTER_NOT_FOUND',
  ADAPTER_DRIFT: 'ADAPTER_DRIFT',
  APPLICATION_NOT_DETECTED: 'APPLICATION_NOT_DETECTED',
  CAPABILITY_UNKNOWN: 'CAPABILITY_UNKNOWN',
  EDITOR_NOT_DETECTED: 'EDITOR_NOT_DETECTED',
  EXPLORER_NOT_DETECTED: 'EXPLORER_NOT_DETECTED',
  SEARCH_NOT_DETECTED: 'SEARCH_NOT_DETECTED',
  SOURCE_CONTROL_NOT_DETECTED: 'SOURCE_CONTROL_NOT_DETECTED',
  TERMINAL_NOT_DETECTED: 'TERMINAL_NOT_DETECTED',
  SHELL_MOUNT_FAILED: 'SHELL_MOUNT_FAILED',
  SHELL_DUPLICATION: 'SHELL_DUPLICATION',
  DOM_CHANGED: 'DOM_CHANGED',
  UNSUPPORTED_LAYOUT: 'UNSUPPORTED_LAYOUT',
  VIEWPORT_UNAVAILABLE: 'VIEWPORT_UNAVAILABLE',
  PREFERENCE_PARSE_FAILED: 'PREFERENCE_PARSE_FAILED',
  COMMAND_FAILED: 'COMMAND_FAILED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
});

/* ===========================================================================
 * §C PURE KERNEL
 * No DOM, no Monaco internals, no GitHub selectors (§15, invariant I-03).
 * Unit tested by tests/run-tests.mjs. The kernel consumes only normalized
 * observations produced by the adapter (§14) and emits intent/decisions.
 * =========================================================================*/

/* ------------------------------ diagnostics ------------------------------ */

function createDiagLog(max = 60) {
  const entries = [];
  return {
    log(code, msg, level = 'info') {
      entries.push({ ts: Date.now(), code: code || null, msg: String(msg == null ? '' : msg), level });
      if (entries.length > max) entries.splice(0, entries.length - max);
    },
    entries() { return entries.slice(); },
    warnings() { return entries.filter((e) => e.level === 'warn' || e.level === 'error').slice(-20); },
    clear() { entries.length = 0; },
  };
}

/* --------------------------- host detection (§7) ------------------------- */
// Pure: takes a location-like object. MUST run before any DOM mutation and
// MUST be independent of visual DOM detection.
function detectTarget(loc) {
  if (!loc || typeof loc.hostname !== 'string' || !loc.hostname) return TARGET.UNSUPPORTED;
  const host = loc.hostname.toLowerCase();
  const path = typeof loc.pathname === 'string' ? loc.pathname : '/';
  const githubDev = host === 'github.dev' || host.endsWith('.github.dev');
  const vscodeGithub = (host === 'vscode.dev' || host.endsWith('.vscode.dev')) &&
    path.replace(/^\/+/, '').toLowerCase().startsWith('github/');
  return githubDev || vscodeGithub ? TARGET.SUPPORTED : TARGET.UNSUPPORTED;
}

/* ------------------------------ scheduler (§28) -------------------------- */
// mutation/resize/route/viewport signals → mark dirty → coalesce → ONE
// reconciler pass per animation frame. Re-entrant passes are prevented.
// No steady-state polling exists anywhere (§27, invariant I-05).
function createScheduler(env) {
  const raf = (env && env.requestAnimationFrame) ||
    ((fn) => setTimeout(() => fn(Date.now()), 16));
  let queued = false;
  let running = false;
  const reasons = new Set();
  let handler = null;
  return {
    onReconcile(fn) { handler = fn; },
    markDirty(reason) {
      reasons.add(reason || 'unknown');
      if (queued) return;
      queued = true;
      raf(() => {
        queued = false;
        if (running || !handler) { reasons.clear(); return; } // re-entrancy guard
        running = true;
        const rs = Array.from(reasons);
        reasons.clear();
        try { handler(rs); } finally { running = false; }
      });
    },
    pending() { return queued; },
  };
}

/* --------------------------- viewport classification (§18) --------------- */

function modeForWidth(width, breakpoints = DEFAULT_BREAKPOINTS, override = 'auto') {
  if (override && override !== 'auto' && SHELL_MODE[String(override).toUpperCase()]) {
    return SHELL_MODE[String(override).toUpperCase()];
  }
  const w = Number(width) || 0;
  if (w > breakpoints.desktopMin) return SHELL_MODE.DESKTOP;
  if (w >= breakpoints.compactMin) return SHELL_MODE.COMPACT;
  return SHELL_MODE.MOBILE;
}

/* ------------- orientation / environment / layout (§23–§25) ------------- */
// Pure and DOM-free: the session observes raw signals (visualViewport,
// matchMedia, navigator) and normalizes them through these helpers. No
// user-agent classification is used anywhere (inspection-first §23/§24).
function orientationFor(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  return w > h ? ORIENTATION.LANDSCAPE : ORIENTATION.PORTRAIT;
}

// Normalize a raw environment reading into {width,height,coarsePointer,
// touch,orientation}. Missing signals degrade to recorded unknowns — the
// layout decision never guesses from absent evidence.
function observeEnvironment(raw) {
  const r = raw || {};
  const width = Math.round(Number(r.width) || 0);
  const height = Math.round(Number(r.height) || 0);
  const coarsePointer = typeof r.coarsePointer === 'boolean' ? r.coarsePointer : null;
  const touch = typeof r.touch === 'boolean' ? r.touch : null;
  const orientation = r.orientation === ORIENTATION.LANDSCAPE || r.orientation === ORIENTATION.PORTRAIT
    ? r.orientation
    : orientationFor(width, height);
  return { width, height, coarsePointer, touch, orientation };
}

// Layout decision from the full environment (inspection-first §24):
// narrow viewport + interaction characteristics + orientation → mode.
// v0.1 policy: viewport width is the primary signal (centralized policy,
// same breakpoints as modeForWidth); pointer/touch/orientation are recorded
// as decision basis so DeX/tablet/desktop-display cases can evolve safely
// without ever keying on user-agent or on `Android = mobile`.
function layoutModeFor(environment, breakpoints = DEFAULT_BREAKPOINTS, override = 'auto') {
  const env = observeEnvironment(environment);
  const mode = modeForWidth(env.width, breakpoints, override);
  return {
    mode,
    basis: {
      width: env.width, height: env.height,
      coarsePointer: env.coarsePointer, touch: env.touch,
      orientation: env.orientation, override: override || 'auto',
    },
  };
}

/* ---------------- navigation stack (inspection-first §27) ---------------- */
// Mobile navigation state is independent of browser history. v0.1 depth is
// [editor] or [editor, secondary]; opening a secondary replaces any previous
// secondary (["editor","explorer"] → open search → ["editor","search"]).
function createNavStack() { return [SURFACE.EDITOR]; }
function navCurrent(stack) {
  if (!Array.isArray(stack) || !stack.length) return SURFACE.EDITOR;
  return stack[stack.length - 1];
}
function navPush(stack, surface) {
  const base = Array.isArray(stack) && stack.length ? stack.slice() : createNavStack();
  if (!surface || surface === SURFACE.EDITOR) return createNavStack();
  if (surface === SURFACE.SETTINGS) return base; // modal — not navigation
  return [SURFACE.EDITOR, surface];
}
function navPop(stack) {
  const base = Array.isArray(stack) && stack.length ? stack.slice() : createNavStack();
  if (base.length <= 1) return createNavStack();
  base.pop();
  return base.length ? base : createNavStack();
}

/* ------------- discovery levels ↔ evidence (§12/§13) -------------------- */
function discoveryLabel(level) {
  switch (Number(level)) {
    case 0: return 'UNKNOWN';
    case 1: return 'DETECTED';
    case 2: return 'SEMANTICALLY IDENTIFIED';
    case 3: return 'INTERACTION ATTEMPTED';
    case 4: return 'STATE TRANSITION OBSERVED';
    case 5: return 'REGRESSION-TESTED';
    default: return 'UNKNOWN';
  }
}
// LEVEL 0 UNKNOWN · 1 OBSERVED · 2 OBSERVED+INFERRED · 3 ATTEMPTED ·
// 4 VALIDATED · 5 VALIDATED+REGRESSION-TESTED. Element-exists ≠ works.
function evidenceForDiscovery(level) {
  switch (Number(level)) {
    case 0: return [EVIDENCE.UNKNOWN];
    case 1: return [EVIDENCE.OBSERVED];
    case 2: return [EVIDENCE.OBSERVED, EVIDENCE.INFERRED];
    case 3: return [EVIDENCE.ATTEMPTED];
    case 4: return [EVIDENCE.VALIDATED];
    case 5: return [EVIDENCE.VALIDATED, EVIDENCE.REGRESSION_TESTED];
    default: return [EVIDENCE.UNKNOWN];
  }
}

/* ---------------------------- state transitions -------------------------- */

const TRANSITIONS = Object.freeze({
  [SURFACE.EDITOR]: Object.freeze({
    openExplorer: SURFACE.EXPLORER,
    openSearch: SURFACE.SEARCH,
    openSourceControl: SURFACE.SOURCE_CONTROL,
    openTerminal: SURFACE.TERMINAL,
    openSettings: SURFACE.SETTINGS,
  }),
  [SURFACE.EXPLORER]: Object.freeze({ selectFile: SURFACE.EDITOR }),
  [SURFACE.SEARCH]: Object.freeze({ selectResult: SURFACE.EDITOR }),
  [SURFACE.SOURCE_CONTROL]: Object.freeze({}),
  [SURFACE.TERMINAL]: Object.freeze({}),
  [SURFACE.SETTINGS]: Object.freeze({}),
});

function transitionFor(state, action) {
  const current = state.activeSurface;
  if (action === 'close') {
    if (current === SURFACE.EDITOR) {
      return { ok: false, code: FAIL.COMMAND_FAILED, reason: 'close ignored on editor' };
    }
    return { ok: true, to: state.previousSurface && state.previousSurface !== current
      ? state.previousSurface : SURFACE.EDITOR };
  }
  const row = TRANSITIONS[current] || {};
  const to = row[action];
  if (!to) return { ok: false, code: FAIL.COMMAND_FAILED, reason: `no transition ${current}+${action}` };
  return { ok: true, to };
}

/* ------------------------ Android Back decision (§34) -------------------- */
// Pure priority decision. The history plumbing lives in §H; the kernel only
// decides whether Back can be consumed and what it should do.
//   modal open?        → close modal
//   host quick input?  → dismiss it (modal-class host surface)
//   drawer/secondary?  → return to editor
//   otherwise          → ALLOW_BROWSER_DEFAULT (Back is never trapped, I-11)
function planBack(ctx) {
  const c = ctx || {};
  if (c.modal) return { consume: 'modal', to: null };
  if (c.quickInputVisible) return { consume: 'quickinput', to: null };
  // Navigation-stack input (inspection-first §27/§28) wins when present:
  // a stack deeper than [editor] means the mobile layer owns Back.
  if (Array.isArray(c.navigationStack) && c.navigationStack.length > 1) {
    const top = navCurrent(c.navigationStack);
    if (top && top !== SURFACE.EDITOR && SECONDARY_SURFACES.indexOf(top) !== -1) {
      const popped = navPop(c.navigationStack);
      return { consume: 'surface', to: navCurrent(popped) };
    }
  }
  const surface = c.activeSurface;
  if (surface && surface !== SURFACE.EDITOR && SECONDARY_SURFACES.indexOf(surface) !== -1) {
    const to = c.previousSurface && c.previousSurface !== surface ? c.previousSurface : SURFACE.EDITOR;
    return { consume: 'surface', to };
  }
  return { consume: null, to: null }; // ALLOW_BROWSER_DEFAULT
}

/* ------------------------------ preferences (§39/§40) --------------------- */

const PREF_DEFAULTS = Object.freeze({
  version: PREFERENCE_SCHEMA_VERSION,
  mode: 'auto',
  immersive: true,
  preferredSurface: SURFACE.EDITOR,
  bottomBar: true,
});

function parsePreferences(raw) {
  const notes = [];
  const fallback = () => ({ prefs: Object.assign({}, PREF_DEFAULTS), notes });
  if (raw == null || raw === '') return fallback();
  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    notes.push({ code: FAIL.PREFERENCE_PARSE_FAILED, msg: 'preferences JSON invalid; using defaults' });
    return fallback();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    notes.push({ code: FAIL.PREFERENCE_PARSE_FAILED, msg: 'preferences not an object; using defaults' });
    return fallback();
  }
  if (data.version !== PREFERENCE_SCHEMA_VERSION) {
    notes.push({ code: FAIL.PREFERENCE_PARSE_FAILED, msg: `unknown preference schema version ${String(data.version)}; using defaults` });
    return fallback();
  }
  const prefs = Object.assign({}, PREF_DEFAULTS);
  if (typeof data.mode === 'string' && ['auto', 'mobile', 'compact', 'desktop'].indexOf(data.mode) !== -1) prefs.mode = data.mode;
  if (typeof data.immersive === 'boolean') prefs.immersive = data.immersive;
  if (typeof data.preferredSurface === 'string' && Object.values(SURFACE).indexOf(data.preferredSurface) !== -1) {
    prefs.preferredSurface = data.preferredSurface;
  }
  if (typeof data.bottomBar === 'boolean') prefs.bottomBar = data.bottomBar;
  return { prefs, notes };
}

function createPreferenceStore(env, diag) {
  const storage = (env && env.storage) || null;
  let prefs = Object.assign({}, PREF_DEFAULTS);
  return {
    load() {
      let raw = null;
      if (storage) {
        try { raw = storage.getItem(STORAGE_KEY); }
        catch (e) { diag && diag.log(FAIL.PREFERENCE_PARSE_FAILED, 'storage read failed; using defaults', 'warn'); }
      }
      const parsed = parsePreferences(raw);
      prefs = parsed.prefs;
      parsed.notes.forEach((n) => diag && diag.log(n.code, n.msg, 'warn'));
      return prefs;
    },
    get() { return Object.assign({}, prefs); },
    set(patch) {
      prefs = Object.assign({}, prefs, patch, { version: PREFERENCE_SCHEMA_VERSION });
      if (storage) {
        try { storage.setItem(STORAGE_KEY, JSON.stringify(prefs)); }
        catch (e) { diag && diag.log(FAIL.PREFERENCE_PARSE_FAILED, 'storage write failed (non-fatal)', 'warn'); }
      }
      return this.get();
    },
    reset() {
      prefs = Object.assign({}, PREF_DEFAULTS);
      if (storage) { try { storage.removeItem(STORAGE_KEY); } catch (e) { /* non-fatal */ } }
      return this.get();
    },
  };
}

/* --------------------------- command registry (§22/§23) ------------------ */

function createCommandRegistry(diag) {
  const commands = new Map();
  return {
    register(id, fn, meta = {}) { commands.set(id, { fn, meta }); },
    ids() { return Array.from(commands.keys()); },
    execute(id, payload) {
      const entry = commands.get(id);
      if (!entry) {
        diag && diag.log(FAIL.COMMAND_FAILED, `command not registered: ${id}`, 'error');
        return { ok: false, code: FAIL.COMMAND_FAILED, error: 'not registered' };
      }
      try {
        const result = entry.fn(payload);
        return result && typeof result === 'object' && 'ok' in result ? result : { ok: true, result };
      } catch (error) {
        diag && diag.log(FAIL.COMMAND_FAILED, `command threw: ${id}: ${error && error.message}`, 'error');
        return { ok: false, code: FAIL.COMMAND_FAILED, error };
      }
    },
  };
}

/* ----------------------- capability classification (§12) ----------------- */
// Minimum set per §12. Input is the adapter's NORMALIZED observation (§14).
function classifyCapabilities(obs) {
  const unknown = () => ({
    editor: CAP.UNKNOWN, explorer: CAP.UNKNOWN, search: CAP.UNKNOWN,
    sourceControl: CAP.UNKNOWN, terminal: CAP.UNKNOWN, activityBar: CAP.UNKNOWN,
    statusBar: CAP.UNKNOWN, commandPalette: CAP.UNKNOWN,
  });
  if (!obs || !obs.application || !obs.application.detected) return unknown();
  const s = obs.surfaces || {};
  const p = obs.parts || {};
  const d = (found) => (found ? CAP.DETECTED : CAP.NOT_DETECTED);
  return {
    editor: d(!!(s.editor && s.editor.present)),
    explorer: d(!!(s.explorer && s.explorer.present)),
    search: d(!!(s.search && s.search.present)),
    sourceControl: d(!!(s.sourceControl && s.sourceControl.present)),
    terminal: d(!!(s.terminal && s.terminal.present)),
    activityBar: d(!!(p.activityBar && p.activityBar.present)),
    statusBar: d(!!(p.statusBar && p.statusBar.present)),
    // The quick-input widget only exists while open; never claim NOT_DETECTED
    // merely because it is closed (§12: UNKNOWN must not become false).
    commandPalette: p.quickInput && p.quickInput.present ? CAP.DETECTED : CAP.UNKNOWN,
  };
}

// Host expectation heuristic for the terminal — INFERRED evidence only.
// github.dev/vscode.dev without a remote are not known to ship a terminal;
// observation always overrules this (docs/dom-evidence.md T2).
function terminalHostExpectation(hostname) {
  if (typeof hostname !== 'string' || !hostname) return 'unknown';
  return /(^|\.)(github\.dev|vscode\.dev)$/.test(hostname) ? 'likely-unsupported' : 'unknown';
}

/* --------------------------- keyboard inference (§29/G13) ---------------- */
// visualViewport height collapse → keyboard INFERRED. Never stronger.
function inferKeyboard(sample) {
  if (!sample || !sample.vvAvailable || !sample.vvHeight || !sample.layoutHeight) {
    return { visible: false, evidence: CAP.UNKNOWN };
  }
  const ratio = sample.vvHeight / sample.layoutHeight;
  if (ratio <= 0.75 && sample.vvWidth / (sample.layoutWidth || sample.vvWidth) >= 0.9) {
    return { visible: true, evidence: EVIDENCE.INFERRED };
  }
  return { visible: false, evidence: EVIDENCE.INFERRED };
}

/* --------------------- pending-command validation (§10/§13) -------------- */
// Pure evaluation of whether an invoked command produced the expected state.
// Capability DETECTED is not validation; only an observed transition is.
function evaluatePending(pending, obs, now) {
  if (!pending) return { state: 'idle' };
  const elapsed = now - pending.t0;
  let done = false;
  if (pending.expect === SURFACE.TERMINAL) {
    done = !!(obs.surfaces && obs.surfaces.terminal && obs.surfaces.terminal.visible);
  } else if (pending.expect === SURFACE.EDITOR) {
    done = !obs.parts.sideBar.visible && !(obs.surfaces.terminal && obs.surfaces.terminal.visible);
  } else {
    const viewKey = pending.expect === SURFACE.SOURCE_CONTROL ? 'scm' : pending.expect;
    done = !!obs.parts.sideBar.visible && obs.sidebarActiveView === viewKey;
  }
  if (done) return { state: 'done' };
  if (!pending.retried && elapsed > 1200) return { state: 'retry' }; // one bounded retry
  if (elapsed > 3200) {
    const map = {
      [SURFACE.EXPLORER]: FAIL.EXPLORER_NOT_DETECTED,
      [SURFACE.SEARCH]: FAIL.SEARCH_NOT_DETECTED,
      [SURFACE.SOURCE_CONTROL]: FAIL.SOURCE_CONTROL_NOT_DETECTED,
      [SURFACE.TERMINAL]: FAIL.TERMINAL_NOT_DETECTED,
      [SURFACE.EDITOR]: FAIL.COMMAND_FAILED,
    };
    return { state: 'expired', code: map[pending.expect] || FAIL.COMMAND_FAILED };
  }
  return { state: 'wait' };
}

/* ---------------------------- reconcile planner (§24) -------------------- */
// Pure: (normalized observation, state, prefs, caps) → decision plan.
// Mutation happens later, in §I, through shell/adapter only.
function planReconcile(input) {
  const obs = input.obs || {};
  const st = input.state || {};
  const prefs = input.prefs || PREF_DEFAULTS;
  const caps = input.caps || {};
  const notes = [];

  const width = st.viewport ? st.viewport.width : 0;
  const height = st.viewport ? st.viewport.height : 0;
  const shellMode = modeForWidth(width, DEFAULT_BREAKPOINTS, prefs.mode);
  const orientation = orientationFor(width, height);
  const layout = LAYOUT_POLICY[shellMode] || LAYOUT_POLICY.mobile;
  const isMobile = shellMode === SHELL_MODE.MOBILE;
  const immersiveOn = !!(FEATURES.immersiveEditor && prefs.immersive && isMobile);

  const s = obs.surfaces || {};
  const parts = obs.parts || {};

  // ---- surface adoption: DOM is evidence, kernel state is control ---------
  let activeSurface = st.activeSurface || SURFACE.EDITOR;
  let previousSurface = st.previousSurface || null;
  let adoptedFromApp = false;
  let fileSelected = false;
  const appSurface = obs.appSurface || null;

  const activeFile = s.editor && s.editor.activeFile;
  const fileKey = activeFile ? (activeFile.uri || activeFile.name || '') : '';
  const fileChanged = !!fileKey && fileKey !== (st.lastFileKey || '');

  if (!input.pending) {
    if (fileChanged && (activeSurface === SURFACE.EXPLORER || activeSurface === SURFACE.SEARCH) && isMobile) {
      // §31/§32: selecting a file returns to the editor and closes the drawer.
      fileSelected = true;
      previousSurface = activeSurface;
      activeSurface = SURFACE.EDITOR;
    } else if (appSurface && appSurface !== activeSurface && appSurface !== SURFACE.SETTINGS) {
      // The host application moved (native shortcut, activity click, route):
      // adopt observed state (§35 navigation observation).
      previousSurface = activeSurface;
      activeSurface = appSurface;
      adoptedFromApp = true;
    }
  }

  // ---- shell chrome decisions --------------------------------------------
  const quickInputVisible = !!(parts.quickInput && parts.quickInput.visible);
  const shellMinimized = quickInputVisible; // host quick input owns the screen

  const titlebarH = obs.measured && obs.measured.titlebarH > 0 ? Math.max(obs.measured.titlebarH, 40) : 44;
  const footerH = 52;
  const headerH = isMobile ? titlebarH : 0;
  const bottomBarShown = !!(FEATURES.mobileShell && prefs.bottomBar && shellMode !== SHELL_MODE.DESKTOP);
  const statusbarH = obs.measured && obs.measured.statusbarH > 0 ? Math.min(obs.measured.statusbarH, 30) : 0;
  const shellBottom = bottomBarShown ? footerH : statusbarH;

  const vvH = (st.viewport && st.viewport.height) || 0;
  const usable = Math.max(vvH - headerH - shellBottom, 120);
  const panelH = Math.round(usable * 0.92);

  const vars = {
    '--gmux-vv-offset': `${(st.viewport && st.viewport.offsetTop) || 0}px`,
    '--gmux-vv-height': `${vvH || '100vh'}`,
    '--gmux-header-h': `${headerH}px`,
    '--gmux-footer-h': `${footerH}px`,
    '--gmux-shell-top': `${headerH}px`,
    '--gmux-shell-bottom': `${shellBottom}px`,
    '--gmux-panel-h': `${panelH}px`,
  };

  // ---- workbench state classes (presentation arm of adapter) -------------
  const workbenchAdd = [`gmux-mode-${shellMode}`];
  const workbenchRemove = ['gmux-mode-mobile', 'gmux-mode-compact', 'gmux-mode-desktop', 'gmux-immersive', 'gmux-sidebar-overlay', 'gmux-panel-overlay'];
  if (immersiveOn) workbenchAdd.push('gmux-immersive');

  const drawerActive = DRAWER_SURFACES.indexOf(activeSurface) !== -1;
  const terminalActive = activeSurface === SURFACE.TERMINAL;
  if (isMobile && drawerActive && !shellMinimized) workbenchAdd.push('gmux-sidebar-overlay');
  if (isMobile && terminalActive && !shellMinimized) workbenchAdd.push('gmux-panel-overlay');

  const rootAdd = [];
  const rootRemove = ['gmux-shell-minimized', 'gmux-no-footer', 'gmux-no-header'];
  if (shellMinimized) rootAdd.push('gmux-shell-minimized');
  if (!bottomBarShown) rootAdd.push('gmux-no-footer');
  if (!isMobile) rootAdd.push('gmux-no-header');

  // ---- toolbar state ------------------------------------------------------
  const terminalEnabled = !!(FEATURES.terminalSurface && caps.terminal === CAP.DETECTED);
  const pressedSurface = drawerActive || terminalActive ? activeSurface : null;
  if (!FEATURES.terminalSurface) {
    notes.push({ code: FAIL.TERMINAL_NOT_DETECTED, level: 'info', msg: 'terminal surface disabled by v0.1 feature flag (SPEC §17)' });
  } else if (caps.terminal !== CAP.DETECTED) {
    notes.push({ code: FAIL.TERMINAL_NOT_DETECTED, level: 'warn', msg: `terminal capability unavailable (${caps.terminal || CAP.UNKNOWN})` });
  }

  const headerFile = activeFile ? activeFile.name || null : null;

  // ---- mobile navigation stack (§27): derived, deterministic -------------
  // [editor] or [editor, secondary]; settings modals do not push navigation.
  const prevStack = Array.isArray(st.navigationStack) && st.navigationStack.length
    ? st.navigationStack.slice() : createNavStack();
  const navigationStack = activeSurface === SURFACE.SETTINGS
    ? prevStack
    : navPush(prevStack, activeSurface);

  return {
    shellMode, orientation, layout, isMobile, immersiveOn,
    activeSurface, previousSurface, navigationStack,
    adoptedFromApp, fileSelected, fileKey,
    shellMinimized, headerFile, terminalEnabled, pressedSurface, bottomBarShown,
    quickInputVisible, drawerActive,
    workbenchAdd, workbenchRemove, rootAdd, rootRemove, vars, notes,
  };
}

/* ---------------- reducer + state comparison (§35) ----------------------- */
// planReconcile IS the reducer: (state, observation) → plan. This wrapper
// exposes the inspection-first §35 signature `reducer(state, observation)`
// deterministically: identical state/observation inputs always produce the
// identical next-state fragment. The session uses planReconcile directly for
// the full plan (vars/classes); reducer() returns the state fragment only.
function reducer(state, observation) {
  const st = state || {};
  const envelope = observation || {};
  const obs = envelope.obs || envelope;
  const prefs = envelope.prefs || st.prefs || PREF_DEFAULTS;
  const caps = envelope.caps || st.capabilities || {};
  const pending = envelope.pending || null;
  const plan = planReconcile({ obs, state: st, prefs, caps, pending });
  return {
    shellMode: plan.shellMode,
    orientation: plan.orientation,
    activeSurface: plan.activeSurface,
    previousSurface: plan.previousSurface,
    navigationStack: plan.navigationStack,
    immersive: plan.immersiveOn,
  };
}

// Shallow deterministic comparison for the reconciler convergence check
// (§35: same desired state → no unnecessary mutation).
function sameState(a, b) {
  const keys = ['shellMode', 'orientation', 'activeSurface', 'previousSurface',
    'navigationStack', 'immersive', 'keyboardVisible', 'viewport', 'capabilities'];
  const norm = (v) => JSON.stringify(v === undefined ? null : v);
  return keys.every((k) => norm(a && a[k]) === norm(b && b[k]));
}

/* --------------------------- feature status map (§38) -------------------- */
// Evidence-based; NO EVIDENCE → NO VERIFIED CLAIM (I-15).
function computeFeatureStatuses(ctx) {
  const caps = ctx.caps || {};
  const stats = ctx.stats || {};
  const vvUsed = ctx.vvUsed;
  const s = (detected, validated, blockedReason) => {
    if (blockedReason) return { status: FSTATUS.BLOCKED, basis: blockedReason };
    if (validated) return { status: FSTATUS.VERIFIED, basis: 'expected state transition validated this session' };
    if (detected) return { status: FSTATUS.PARTIALLY_VERIFIED, basis: 'detected; operation not yet validated' };
    return { status: FSTATUS.PROVISIONAL, basis: 'awaiting evidence' };
  };
  return [
    ['Mobile shell', s(true, !!stats.shellMounted, null)],
    ['Mobile viewport detection', vvUsed
      ? { status: stats.viewportApplied ? FSTATUS.VERIFIED : FSTATUS.PARTIALLY_VERIFIED,
          basis: vvUsed === 'visualViewport' ? 'visualViewport observed' : 'window resize fallback (visualViewport unavailable)' }
      : { status: FSTATUS.PROVISIONAL, basis: 'no viewport sample yet' }],
    ['Editor immersive mode', s(true, !!stats.immersiveApplied, null)],
    ['Explorer drawer', s(caps.explorer === CAP.DETECTED, !!stats.explorerValidated, caps.explorer === CAP.DETECTED ? null : `explorer ${caps.explorer || CAP.UNKNOWN}`)],
    ['Search surface', s(caps.search === CAP.DETECTED, !!stats.searchValidated, caps.search === CAP.DETECTED ? null : `search ${caps.search || CAP.UNKNOWN}`)],
    ['Source Control surface', caps.sourceControl === CAP.DETECTED
      ? { status: FSTATUS.PARTIALLY_VERIFIED, basis: 'repositions the existing SCM view; no GMUX-owned Git state (§5/§33)' }
      : { status: FSTATUS.BLOCKED, basis: `source control ${caps.sourceControl || CAP.UNKNOWN}` }],
    ['Terminal surface', FEATURES.terminalSurface
      ? s(caps.terminal === CAP.DETECTED, !!stats.terminalValidated, caps.terminal === CAP.DETECTED ? null : `terminal ${caps.terminal || CAP.UNKNOWN}`)
      : { status: FSTATUS.OUT_OF_SCOPE, basis: 'disabled by v0.1 feature flag (§17); deferred' }],
    ['Gesture navigation', { status: FSTATUS.OUT_OF_SCOPE, basis: 'deferred from v0.1 (§2, §36 gestures=false, §54)' }],
    ['Android Back', { status: stats.backHandled ? FSTATUS.VERIFIED : FSTATUS.PARTIALLY_VERIFIED,
      basis: stats.backHandled ? 'back consumption observed this session' : 'history layering active; device confirmation pending (§34)' }],
    ['Git operations', { status: FSTATUS.OUT_OF_SCOPE, basis: 'GitHub/VS Code remains the sole authority (§4/§5/§33)' }],
    ['Unknown future GitHub DOM', { status: FSTATUS.BLOCKED, basis: 'no evidence for layouts not yet observed (§59 stop conditions)' }],
  ];
}

/* ===========================================================================
 * §D GITHUB-DEV ADAPTER
 * ALL GitHub/VS Code DOM knowledge lives in this section (invariant I-02).
 * Selector preference: semantic attributes > ARIA labels > stable IDs >
 * stable relationships > structural classes. Evidence: docs/dom-evidence.md.
 * Every operation returns STRUCTURED results (§9): {ok, operation, reason?,
 * evidence}. No operation ever silently implies success (I-15).
 * =========================================================================*/

const GitHubDevAdapter = HAS_DOM ? (function createAdapter() {
  const WB = '.monaco-workbench';
  const PARTS = {
    titlebar: '.part.titlebar',
    activityBar: '.part.activitybar',
    sideBar: '.part.sidebar',
    editor: '.part.editor',
    panel: '.part.panel',
    statusBar: '.part.statusbar',
  };
  const VIEW_IDS = {
    explorer: 'workbench.view.explorer',
    search: 'workbench.view.search',
    scm: 'workbench.view.scm',
  };
  const VIEW_LABELS = { explorer: ['explorer'], search: ['search'], scm: ['source control'] };
  const VIEW_CONTENT = {
    explorer: '.explorer-folders-view, .explorer-view',
    search: '.search-view',
    scm: '.scm-view',
  };
  // Legacy DOM keyCode constants for VS Code's window-level keybinding
  // service (secondary actuation path; INFERRED until the effect is observed).
  const KEYBINDINGS = {
    openExplorer: { code: 'KeyE', key: 'E', keyCode: 69, ctrl: true, shift: true },
    openSearch: { code: 'KeyF', key: 'F', keyCode: 70, ctrl: true, shift: true },
    openSourceControl: { code: 'KeyG', key: 'G', keyCode: 71, ctrl: true, shift: true },
    toggleSidebar: { code: 'KeyB', key: 'B', keyCode: 66, ctrl: true },
    togglePanel: { code: 'KeyJ', key: 'J', keyCode: 74, ctrl: true },
    commandPalette: { code: 'KeyP', key: 'P', keyCode: 80, ctrl: true, shift: true },
    quickOpen: { code: 'KeyP', key: 'P', keyCode: 80, ctrl: true },
    openSettings: { code: 'Comma', key: ',', keyCode: 188, ctrl: true },
    escape: { code: 'Escape', key: 'Escape', keyCode: 27 },
  };

  /* -------- selector registry with provenance (inspection-first §14) ----- */
  // The registry BEGINS EMPTY. Selectors enter only with provenance after
  // reconnaissance evidence exists — a selector is evidence, not truth (§60).
  // Seeds below carry the 2026-09-15 reconnaissance evidence recorded in
  // docs/dom-evidence.md; every seed stays PROVISIONAL until a live state
  // transition promotes it (§60/§61 promotion chain).
  const selectorRegistry = { explorer: [], search: [], sourceControl: [], editor: [], terminal: [] };
  const SEED_OBSERVED_AT = '2026-09-15';
  const PROVISIONAL_SEEDS = [
    { purpose: 'explorer', selector: '.part.activitybar [id="workbench.view.explorer"] .action-label' },
    { purpose: 'explorer', selector: '.part.activitybar [id="workbench.view.explorer"]' },
    { purpose: 'search', selector: '.part.activitybar [id="workbench.view.search"] .action-label' },
    { purpose: 'search', selector: '.part.activitybar [id="workbench.view.search"]' },
    { purpose: 'sourceControl', selector: '.part.activitybar [id="workbench.view.scm"] .action-label' },
    { purpose: 'sourceControl', selector: '.part.activitybar [id="workbench.view.scm"]' },
    { purpose: 'editor', selector: '.monaco-editor textarea.inputarea' },
    { purpose: 'editor', selector: '.monaco-editor' },
    { purpose: 'terminal', selector: '.xterm' },
    { purpose: 'terminal', selector: '.part.panel .terminal-outer-container' },
  ];
  let registrySeeded = false;
  function registerSelector(purpose, selector, provenance) {
    const list = selectorRegistry[purpose];
    if (!list || typeof selector !== 'string' || !selector) return null;
    const exists = list.some((e) => e && e.selector === selector);
    if (exists) return list.filter((e) => e.selector === selector)[0];
    const entry = {
      selector,
      source: (provenance && provenance.source) || 'reconnaissance',
      confidence: (provenance && typeof provenance.confidence === 'number') ? provenance.confidence : DISCOVERY.IDENTIFIED,
      observedAt: (provenance && provenance.observedAt) || new Date().toISOString(),
      purpose,
      status: (provenance && provenance.status) || FSTATUS.PROVISIONAL,
    };
    list.push(entry);
    return entry;
  }
  function ensureSeeded() {
    if (registrySeeded) return;
    registrySeeded = true;
    PROVISIONAL_SEEDS.forEach((s) => registerSelector(s.purpose, s.selector, {
      source: 'reconnaissance', confidence: DISCOVERY.IDENTIFIED,
      observedAt: SEED_OBSERVED_AT, status: FSTATUS.PROVISIONAL,
    }));
  }
  function registrySnapshot() {
    ensureSeeded();
    const out = {};
    Object.keys(selectorRegistry).forEach((k) => { out[k] = selectorRegistry[k].slice(); });
    return out;
  }

  // Local selector-use log (inspection-first §16): selector, surface,
  // discovery level, timestamp, matching count, visibility, interaction
  // status. Local diagnostic telemetry ONLY — never leaves the device (§49).
  const selectorLog = [];
  function recordSelectorUse(entry) {
    selectorLog.push(Object.assign({ timestamp: new Date().toISOString() }, entry || {}));
    if (selectorLog.length > 80) selectorLog.splice(0, selectorLog.length - 80);
  }
  function getSelectorLog() { return selectorLog.slice(); }

  // Drift tracking (inspection-first §17/§48): remembers whether each
  // surface's known selectors matched on the previous observation.
  const lastKnownMatch = { explorer: null, search: null, sourceControl: null, editor: null, terminal: null };
  const driftEvents = [];
  function checkDrift(purpose, matchedNow) {
    const before = lastKnownMatch[purpose];
    lastKnownMatch[purpose] = !!matchedNow;
    if (before === true && !matchedNow) {
      const evt = {
        code: FAIL.ADAPTER_DRIFT,
        surface: purpose,
        expected: 'known selector matched',
        current: 'no known selector matched',
        fallback: 'semantic reconnaissance required',
        timestamp: new Date().toISOString(),
      };
      driftEvents.push(evt);
      if (driftEvents.length > 20) driftEvents.splice(0, driftEvents.length - 20);
      return evt;
    }
    return null;
  }
  function getDriftEvents() { return driftEvents.slice(); }

  function qs(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function qsa(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; }
  }
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }
  function opResult(operation, ok, evidence, reason) {
    const out = { ok: !!ok, operation, evidence: evidence || {} };
    if (reason) out.reason = reason;
    return out;
  }

  function workbench() { return qs(WB); }

  /* ---------------- resolve + semantic fallback (§15/§18) ---------------- */
  // resolve() tries known candidates in order. It MUST NOT classify the
  // result as verified — resolution is observation, not validation.
  function resolve(candidates, root) {
    ensureSeeded();
    const list = Array.isArray(candidates) ? candidates : [];
    for (let i = 0; i < list.length; i++) {
      const cand = list[i];
      const sel = typeof cand === 'string' ? cand : (cand && cand.selector);
      if (!sel) continue;
      let element = null;
      let count = 0;
      try {
        element = (root || document).querySelector(sel);
        try { count = (root || document).querySelectorAll(sel).length; } catch (e) { count = element ? 1 : 0; }
      } catch (e) { element = null; }
      if (element) {
        const evidence = typeof cand === 'string' ? { selector: sel } : cand;
        recordSelectorUse({
          selector: sel, surface: (evidence && evidence.purpose) || null,
          discoveryLevel: (evidence && evidence.confidence) || DISCOVERY.IDENTIFIED,
          matchingCount: count, visible: isVisible(element), interaction: 'resolved',
        });
        return { element, selector: sel, evidence: evidence || null, matchingCount: count };
      }
    }
    return null;
  }

  // Semantic discovery: scan the activity bar for accessible-name evidence.
  // A runtime candidate MUST NOT auto-become a permanent selector (§18) —
  // the caller records evidence first; promotion follows §61 only.
  function semanticCandidates(viewKey, root) {
    const scope = root || document;
    const bar = qs(PARTS.activityBar, scope === document ? undefined : scope);
    const searchRoot = bar || scope;
    let labels = [];
    try {
      labels = Array.prototype.slice.call(searchRoot.querySelectorAll('.action-label'));
    } catch (e) { labels = []; }
    if (!labels.length && !bar) {
      // Fallback: any aria-labelled control in scope (bounded, no DOM dump).
      try {
        labels = Array.prototype.slice.call(scope.querySelectorAll('[aria-label]')).slice(0, 60);
      } catch (e) { labels = []; }
    }
    const prefixes = VIEW_LABELS[viewKey] || [];
    const out = [];
    for (let i = 0; i < labels.length; i++) {
      const element = labels[i];
      let aria = '';
      let title = '';
      try {
        aria = (element.getAttribute('aria-label') || '').toLowerCase();
        title = (element.getAttribute('title') || '').toLowerCase();
      } catch (e) { /* unreadable node — skip */ }
      for (let p = 0; p < prefixes.length; p++) {
        if ((aria && aria.indexOf(prefixes[p]) === 0) || (title && title.indexOf(prefixes[p]) === 0)) {
          out.push({
            element,
            evidence: { kind: aria ? 'aria-label' : 'title', value: aria || title, count: 1 },
          });
          break;
        }
      }
    }
    return out;
  }

  // Resolution order: known selector → semantic discovery → PROVISIONAL /
  // BLOCKED. Broken recognition degrades; it never guesses (§45/§46).
  function resolveSurfaceTarget(surfaceKey, root) {
    ensureSeeded();
    const purpose = surfaceKey === 'scm' ? 'sourceControl' : surfaceKey;
    const known = resolve(selectorRegistry[purpose] || [], root);
    if (known) return { element: known.element, via: 'known-selector', status: 'MATCHED', evidence: known.evidence };
    const cands = semanticCandidates(surfaceKey, root);
    if (cands.length === 1) {
      recordSelectorUse({
        selector: '(semantic)', surface: purpose, discoveryLevel: DISCOVERY.IDENTIFIED,
        matchingCount: 1, visible: isVisible(cands[0].element), interaction: 'provisional-candidate',
      });
      return { element: cands[0].element, via: 'semantic', status: 'PROVISIONAL', evidence: cands[0].evidence };
    }
    if (cands.length > 1) {
      // Ambiguous: more than one semantic candidate. Refuse to guess (§56).
      return { element: null, via: 'semantic', status: 'BLOCKED', evidence: { kind: 'aria-label', value: 'ambiguous', count: cands.length } };
    }
    return { element: null, via: 'none', status: 'BLOCKED', evidence: { kind: 'none', value: purpose, count: 0 } };
  }

  /* ---------------- DOM reconnaissance (inspection-first §9/§10) ---------- */
  // Inspect first, select second. Bounded scans of semantic signals — ARIA
  // labels, roles, titles, ids, data attributes, button/input names,
  // dimensions, visibility — never an indiscriminate full-DOM dump.
  const RECON_LABEL_CAP = 24;
  const RECON_NODE_CAP = 600;
  function safeText(node, maxLen) {
    try {
      const t = (node.textContent || '').trim().replace(/\s+/g, ' ');
      return t.length > maxLen ? t.slice(0, maxLen) : t;
    } catch (e) { return ''; }
  }
  function evidenceForSurface(surface, root) {
    const scope = root || document;
    const evidence = [];
    const count = (sel) => {
      try { return scope.querySelectorAll(sel).length; } catch (e) { return 0; }
    };
    const push = (kind, value, n) => { if (n > 0) evidence.push({ kind, value, count: n }); };
    if (surface === 'explorer') {
      push('id', 'workbench.view.explorer', count('[id="workbench.view.explorer"]'));
      push('aria-label', 'Explorer', count('[aria-label="Explorer"]'));
      push('class', '.explorer-folders-view', count('.explorer-folders-view'));
      push('class', '.explorer-view', count('.explorer-view'));
    } else if (surface === 'search') {
      push('id', 'workbench.view.search', count('[id="workbench.view.search"]'));
      push('aria-label', 'Search', count('[aria-label="Search"]'));
      push('class', '.search-view', count('.search-view'));
    } else if (surface === 'sourceControl') {
      push('id', 'workbench.view.scm', count('[id="workbench.view.scm"]'));
      push('aria-label', 'Source Control', count('[aria-label="Source Control"]'));
      push('class', '.scm-view', count('.scm-view'));
    } else if (surface === 'editor') {
      push('class', '.monaco-editor', count('.monaco-editor'));
      push('semantic', '.monaco-editor[data-uri]', count('.monaco-editor[data-uri]'));
    } else if (surface === 'terminal') {
      push('class', '.xterm', count('.xterm'));
      push('class', '.terminal-outer-container', count('.terminal-outer-container'));
    }
    return { surface, evidence };
  }
  function scanReconnaissance(root) {
    const scope = root || document;
    const out = {
      timestamp: new Date().toISOString(),
      buttons: 0, labelledControls: 0, candidateSurfaces: 0,
      labels: [], roles: {}, evidence: [],
    };
    let buttons = [];
    let labelled = [];
    try { buttons = Array.prototype.slice.call(scope.querySelectorAll('button, [role="button"], .action-label')); }
    catch (e) { buttons = []; }
    try { labelled = Array.prototype.slice.call(scope.querySelectorAll('[aria-label]')); }
    catch (e) { labelled = []; }
    out.buttons = Math.min(buttons.length, RECON_NODE_CAP);
    out.labelledControls = Math.min(labelled.length, RECON_NODE_CAP);
    const seen = {};
    for (let i = 0; i < Math.min(labelled.length, RECON_LABEL_CAP); i++) {
      const node = labelled[i];
      let label = '';
      let role = '';
      try {
        label = node.getAttribute('aria-label') || '';
        role = node.getAttribute('role') || node.tagName || '';
      } catch (e) { /* skip */ }
      if (!label || seen[label]) continue;
      seen[label] = true;
      out.labels.push({ label: label.slice(0, 80), role: String(role).slice(0, 24) });
    }
    const roleNames = ['button', 'tab', 'tree', 'listbox', 'textbox', 'dialog', 'toolbar', 'menu'];
    roleNames.forEach((r) => {
      try { out.roles[r] = scope.querySelectorAll(`[role="${r}"]`).length; }
      catch (e) { out.roles[r] = 0; }
    });
    ['explorer', 'search', 'sourceControl', 'editor', 'terminal'].forEach((s) => {
      const rec = evidenceForSurface(s, scope);
      out.evidence.push(rec);
      if (rec.evidence.length) out.candidateSurfaces++;
    });
    return out;
  }
  const reconnaissance = { scan: scanReconnaissance, evidenceForSurface };

  // Discovery levels 0–2 from a single observation (adapter-side only):
  // 0 UNKNOWN (no host) · 1 DETECTED (element exists) · 2 IDENTIFIED
  // (sufficient semantic evidence, e.g. trigger resolvable). Levels 3–5 are
  // promoted by the session after attempt/transition/regression evidence.
  function discoveryLevels(obs) {
    const levels = { explorer: 0, search: 0, sourceControl: 0, editor: 0, terminal: 0 };
    if (!obs || !obs.application || !obs.application.detected) return levels;
    const s = obs.surfaces || {};
    const present = (k) => !!(s[k] && s[k].present);
    levels.editor = present('editor') ? DISCOVERY.IDENTIFIED : DISCOVERY.UNKNOWN;
    ['explorer', 'search', 'sourceControl'].forEach((k) => {
      if (!present(k)) { levels[k] = DISCOVERY.UNKNOWN; return; }
      const viewKey = k === 'sourceControl' ? 'scm' : k;
      const trigger = resolveSurfaceTarget(viewKey);
      levels[k] = trigger.element ? DISCOVERY.IDENTIFIED : DISCOVERY.DETECTED;
    });
    if (s.terminal && s.terminal.present) {
      levels.terminal = DISCOVERY.IDENTIFIED;
    } else if (s.terminal && s.terminal.hostExpectation === 'likely-unsupported') {
      levels.terminal = DISCOVERY.UNKNOWN;
    }
    return levels;
  }

  /* ----------------------------- observation (§14) ----------------------- */
  function observe() {
    const wb = workbench();
    const hostExpectation = terminalHostExpectation(location.hostname);
    const obs = {
      application: { detected: !!wb, target: ADAPTER_ID },
      surfaces: {
        editor: { present: false, visible: false, activeFile: null },
        explorer: { present: false, visible: false },
        search: { present: false, visible: false },
        sourceControl: { present: false, visible: false },
        terminal: { present: false, visible: false, hostExpectation },
      },
      parts: {
        titlebar: { present: false, visible: false },
        activityBar: { present: false },
        sideBar: { present: false, visible: false },
        editor: { present: false },
        panel: { present: false, visible: false },
        statusBar: { present: false },
        quickInput: { present: false, visible: false },
      },
      measured: { titlebarH: 0, statusbarH: 0 },
      sidebarActiveView: null,
      appSurface: null,
      viewport: { width: window.innerWidth || 0, height: window.innerHeight || 0 },
      route: { url: location.href },
    };
    if (!wb) {
      obs.drift = [];
      obs.discovery = { explorer: 0, search: 0, sourceControl: 0, editor: 0, terminal: 0 };
      return obs;
    }
    const cls = wb.classList;
    const sidebarHidden = cls.contains('nosidebar');
    const panelHidden = cls.contains('nopanel');

    const titlebar = qs(PARTS.titlebar, wb);
    obs.parts.titlebar.present = !!titlebar;
    obs.parts.titlebar.visible = isVisible(titlebar);
    obs.measured.titlebarH = titlebar ? titlebar.offsetHeight : 0;
    obs.parts.activityBar.present = !!qs(PARTS.activityBar, wb);

    const sidebar = qs(PARTS.sideBar, wb);
    obs.parts.sideBar.present = !!sidebar;
    obs.parts.sideBar.visible = !!sidebar && !sidebarHidden && isVisible(sidebar);

    obs.parts.editor.present = !!qs(PARTS.editor, wb);
    const panel = qs(PARTS.panel, wb);
    obs.parts.panel.present = !!panel;
    obs.parts.panel.visible = !!panel && !panelHidden && isVisible(panel);
    const statusbar = qs(PARTS.statusBar, wb);
    obs.parts.statusBar.present = !!statusbar;
    obs.measured.statusbarH = statusbar ? statusbar.offsetHeight : 0;

    // Editor + active file (data-uri is a semantic Monaco attribute).
    const monacoEditor = qs('.monaco-editor', wb);
    obs.surfaces.editor.present = !!monacoEditor;
    obs.surfaces.editor.visible = !!monacoEditor && isVisible(monacoEditor);
    obs.surfaces.editor.activeFile = readActiveFile(wb);

    // Sidebar content views (presence ≠ visibility; §12 uncertainty model).
    obs.surfaces.explorer.present = !!qs(VIEW_CONTENT.explorer, wb);
    obs.surfaces.search.present = !!qs(VIEW_CONTENT.search, wb);
    obs.surfaces.sourceControl.present = !!qs(VIEW_CONTENT.scm, wb);
    obs.surfaces.explorer.visible = obs.parts.sideBar.visible && !!qs(VIEW_CONTENT.explorer, sidebar || wb);
    obs.surfaces.search.visible = obs.parts.sideBar.visible && !!qs(VIEW_CONTENT.search, sidebar || wb);
    obs.surfaces.sourceControl.visible = obs.parts.sideBar.visible && !!qs(VIEW_CONTENT.scm, sidebar || wb);
    if (obs.parts.sideBar.visible) obs.sidebarActiveView = sidebarActiveViewKey(sidebar);

    // Terminal renders through xterm.js when the host provides one.
    const xterm = qs('.xterm', wb);
    obs.surfaces.terminal.present = !!xterm || !!qs('.part.panel .terminal-outer-container', wb);
    obs.surfaces.terminal.visible = obs.parts.panel.visible && !!xterm && isVisible(xterm);

    const qi = qs('.quick-input-widget', wb);
    obs.parts.quickInput.present = !!qi;
    obs.parts.quickInput.visible = !!qi && !qi.classList.contains('hidden') && isVisible(qi);

    // ---- derive host-side surface evidence (kernel normalizes decisions) --
    if (obs.parts.quickInput.visible) obs.appSurface = null; // transient overlay
    else if (obs.surfaces.terminal.visible) obs.appSurface = SURFACE.TERMINAL;
    else if (obs.parts.sideBar.visible && obs.sidebarActiveView) {
      obs.appSurface = obs.sidebarActiveView === 'scm' ? SURFACE.SOURCE_CONTROL : obs.sidebarActiveView;
    } else if (obs.surfaces.editor.present) obs.appSurface = SURFACE.EDITOR;
    // ---- drift + discovery (inspection-first §16/§17) --------------------
    // Targeted trigger probes only — no full-DOM scan. A previously matching
    // trigger that no longer matches emits ADAPTER_DRIFT (§48); the feature
    // degrades to at most PARTIALLY_VERIFIED until revalidated.
    obs.drift = [];
    const triggerMatch = {
      explorer: !!findActivityAction('explorer'),
      search: !!findActivityAction('search'),
      sourceControl: !!findActivityAction('scm'),
      editor: !!obs.surfaces.editor.present,
      terminal: !!obs.surfaces.terminal.present,
    };
    Object.keys(triggerMatch).forEach((k) => {
      const evt = checkDrift(k, triggerMatch[k]);
      if (evt) obs.drift.push(evt);
    });
    const levelOf = (present, identified) => (present ? (identified ? DISCOVERY.IDENTIFIED : DISCOVERY.DETECTED) : DISCOVERY.UNKNOWN);
    obs.discovery = {
      explorer: levelOf(obs.surfaces.explorer.present, triggerMatch.explorer),
      search: levelOf(obs.surfaces.search.present, triggerMatch.search),
      sourceControl: levelOf(obs.surfaces.sourceControl.present, triggerMatch.sourceControl),
      editor: obs.surfaces.editor.present ? DISCOVERY.IDENTIFIED : DISCOVERY.UNKNOWN,
      terminal: levelOf(obs.surfaces.terminal.present, triggerMatch.terminal),
    };
    return obs;
  }

  function sidebarActiveViewKey(sidebarEl) {
    const sb = sidebarEl || qs(PARTS.sideBar);
    if (!sb) return null;
    const keys = Object.keys(VIEW_CONTENT);
    for (let i = 0; i < keys.length; i++) {
      if (qs(VIEW_CONTENT[keys[i]], sb)) return keys[i];
    }
    return null;
  }

  function readActiveFile(wb) {
    let uri = null;
    const ed = qs('.monaco-editor[data-uri]', wb);
    if (ed) uri = ed.getAttribute('data-uri');
    let name = null;
    const tab = qs('.part.editor .tab.active .label-name, .part.editor .tab.active', wb);
    if (tab) name = (tab.textContent || '').trim();
    if (!name) {
      const crumbs = qsa('.monaco-breadcrumbs .monaco-breadcrumb-item', wb);
      if (crumbs.length) {
        name = (crumbs[crumbs.length - 1].getAttribute('title') || crumbs[crumbs.length - 1].textContent || '').trim();
      }
    }
    if (!name && uri) {
      try { name = decodeURIComponent(uri.split(/[\\/]/).pop() || ''); }
      catch (e) { name = uri.split(/[\\/]/).pop() || ''; }
    }
    if (!name && !uri) return null;
    return { name: name || null, uri: uri || null, evidence: uri ? EVIDENCE.OBSERVED : EVIDENCE.INFERRED };
  }

  /* --------------------------- capability probe (§12) ------------------- */
  function capabilities(snapshot) { return classifyCapabilities(snapshot || observe()); }

  /* ------------------------------ mechanisms ----------------------------- */
  function findActivityAction(viewKey) {
    // Primary path: known-selector registry → semantic fallback (§18).
    // Resolution is observation; validation happens after actuation (§10).
    try {
      const target = resolveSurfaceTarget(viewKey);
      if (target && target.element) {
        const found = target.element;
        try {
          if (found.matches && found.matches('.action-label')) return found;
          if (found.querySelector) {
            const inner = found.querySelector('.action-label');
            if (inner) return inner;
          }
        } catch (e) { /* structural probe failed — return the node itself */ }
        return found;
      }
      // Ambiguous semantic evidence: refuse to guess (§18/§56). Never fall
      // through to a first-match heuristic when several candidates exist.
      if (target && target.status === 'BLOCKED' && target.evidence && target.evidence.count > 1) {
        return null;
      }
    } catch (e) { /* fall through to the direct structural path */ }
    // Direct structural fallback: same id evidence without the registry's
    // descendant form, for hosts whose query engine differs.
    const bar = qs(PARTS.activityBar);
    if (!bar) return null;
    const id = VIEW_IDS[viewKey];
    if (id) {
      let byId = null;
      try { byId = bar.querySelector(`[id="${id}"]`); } catch (e) { byId = null; }
      if (byId) {
        try {
          if (byId.matches && byId.matches('.action-label')) return byId;
          const inner = byId.querySelector ? byId.querySelector('.action-label') : null;
          return inner || byId;
        } catch (e) { return byId; }
      }
    }
    const prefixes = VIEW_LABELS[viewKey] || [];
    const candidates = qsa('.action-label', bar);
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      let aria = '';
      let title = '';
      try {
        aria = (el.getAttribute('aria-label') || '').toLowerCase();
        title = (el.getAttribute('title') || '').toLowerCase();
      } catch (e) { continue; }
      for (let p = 0; p < prefixes.length; p++) {
        if ((aria && aria.indexOf(prefixes[p]) === 0) || (title && title.indexOf(prefixes[p]) === 0)) return el;
      }
    }
    return null;
  }

  function dispatchKeybinding(name) {
    const b = KEYBINDINGS[name];
    if (!b) return false;
    let useMeta = false;
    try { useMeta = /mac/i.test((navigator.platform || '') + ' ' + navigator.userAgent) && !!b.ctrl; } catch (e) { /* noop */ }
    const make = (type) => {
      const init = {
        code: b.code, key: b.key, bubbles: true, cancelable: true,
        ctrlKey: !!b.ctrl && !useMeta, metaKey: useMeta, shiftKey: !!b.shift, altKey: false,
      };
      let ev;
      try { init.keyCode = b.keyCode; init.which = b.keyCode; ev = new window.KeyboardEvent(type, init); }
      catch (e) { delete init.keyCode; delete init.which; ev = new window.KeyboardEvent(type, init); }
      return ev;
    };
    try { window.dispatchEvent(make('keydown')); window.dispatchEvent(make('keyup')); return true; }
    catch (e) { return false; }
  }

  function clickElement(el) { if (!el) return false; try { el.click(); return true; } catch (e) { return false; } }

  // ---- host-DOM knowledge for the session's observer / input guards ------
  // Per invariant I-02 even these selectors live in the adapter; the kernel
  // only receives boolean answers.
  const RELEVANT_SELECTOR = '.monaco-workbench, .part, .pane-composite-part, .monaco-editor, .xterm, .quick-input-widget, .tab';
  const PROTECTED_SELECTOR = '.monaco-editor, textarea, input, select, [contenteditable="true"], .xterm, .monaco-list';

  function matchesAny(el, selectorList) {
    if (!el || typeof el.matches !== 'function') return false;
    const groups = selectorList.split(',');
    for (let i = 0; i < groups.length; i++) {
      try { if (el.matches(groups[i].trim())) return true; } catch (e) { /* unknown selector in this host */ }
    }
    return false;
  }

  // Whether a DOM mutation at node may represent an application change the
  // reconciler should react to. Userscript-owned nodes always return false.
  function isRelevantNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.getAttribute && node.getAttribute(OWNER_ATTR) === OWNER_VALUE) return false;
    try {
      if (matchesAny(node, RELEVANT_SELECTOR)) return true;
      if (typeof node.querySelector === 'function' && node.querySelector(RELEVANT_SELECTOR)) return true;
    } catch (e) { /* noop */ }
    return false;
  }

  // Whether an event target sits inside the editor protection zone (§30).
  function isProtectedTarget(node) {
    if (!node || node.nodeType !== 1) return false;
    try { if (typeof node.closest === 'function' && node.closest(PROTECTED_SELECTOR)) return true; } catch (e) { /* noop */ }
    return matchesAny(node, PROTECTED_SELECTOR);
  }

  /* ------------------------ structured operations (§9) ------------------- */

  // detect() — application detection evidence (§6 step 5).
  function detect() {
    const found = !!workbench();
    return opResult('detect', found, {
      workbenchFound: found,
      level: found ? EVIDENCE.OBSERVED : EVIDENCE.INFERRED,
    }, found ? null : FAIL.APPLICATION_NOT_DETECTED);
  }

  function missingWorkbenchResult(operation, code) {
    return opResult(operation, false, {
      elementFound: false, invoked: false, mechanism: 'none',
      stateChanged: false, level: EVIDENCE.OBSERVED,
    }, code);
  }

  function openView(viewKey, operation) {
    const failCode = viewKey === 'explorer' ? FAIL.EXPLORER_NOT_DETECTED
      : viewKey === 'search' ? FAIL.SEARCH_NOT_DETECTED : FAIL.SOURCE_CONTROL_NOT_DETECTED;
    if (!workbench()) return missingWorkbenchResult(operation, failCode);
    const before = observe();
    const alreadyOpen = before.parts.sideBar.visible && before.sidebarActiveView === viewKey;
    if (alreadyOpen) {
      return opResult(operation, true, {
        elementFound: true, invoked: false, mechanism: 'already-open',
        stateChanged: false, level: EVIDENCE.VALIDATED,
      });
    }
    const action = findActivityAction(viewKey);
    let mechanism = 'none';
    let invoked = false;
    if (action) { invoked = clickElement(action); mechanism = 'activity-click'; }
    if (!invoked) {
      const binding = viewKey === 'explorer' ? 'openExplorer' : viewKey === 'search' ? 'openSearch' : 'openSourceControl';
      invoked = dispatchKeybinding(binding);
      if (invoked) mechanism = 'keybinding';
    }
    const after = observe();
    const stateChanged = after.parts.sideBar.visible && after.sidebarActiveView === viewKey;
    const elementFound = !!action;
    const level = stateChanged ? EVIDENCE.VALIDATED : invoked ? EVIDENCE.INFERRED : EVIDENCE.OBSERVED;
    return opResult(operation, invoked, {
      elementFound, invoked, mechanism, stateChanged, level,
    }, invoked ? null : failCode);
  }

  const openExplorer = () => openView('explorer', 'open-explorer');
  const openSearch = () => openView('search', 'open-search');
  const openSourceControl = () => openView('scm', 'open-source-control');

  // closePanels() closes any open sidebar drawer AND/OR the bottom panel.
  function closePanels() {
    if (!workbench()) {
      return missingWorkbenchResult('close-panels', FAIL.DOM_CHANGED);
    }
    const before = observe();
    let sidebarInvoked = false;
    let panelInvoked = false;
    if (before.parts.sideBar.visible) {
      const viewKey = before.sidebarActiveView || 'explorer';
      const action = findActivityAction(viewKey);
      sidebarInvoked = clickElement(action) || dispatchKeybinding('toggleSidebar');
    }
    if (before.surfaces.terminal.visible) panelInvoked = dispatchKeybinding('togglePanel');
    const after = observe();
    const sidebarWasClosed = before.parts.sideBar.visible && !after.parts.sideBar.visible;
    const panelWasClosed = before.surfaces.terminal.visible && !after.surfaces.terminal.visible;
    const sidebarClosed = !after.parts.sideBar.visible;
    const panelClosed = !after.surfaces.terminal.visible;
    const stateChanged = sidebarWasClosed || panelWasClosed;
    const hadSomethingToClose = before.parts.sideBar.visible || before.surfaces.terminal.visible;
    const ok = !hadSomethingToClose || stateChanged || sidebarInvoked || panelInvoked;
    return opResult('close-panels', ok, {
      elementFound: true,
      sidebarInvoked, panelInvoked,
      sidebarClosed, panelClosed,
      stateChanged,
      level: !hadSomethingToClose ? EVIDENCE.VALIDATED : stateChanged ? EVIDENCE.VALIDATED : EVIDENCE.INFERRED,
    });
  }

  function focusEditor() {
    const ta = qs('.monaco-editor textarea.inputarea, .monaco-editor textarea');
    if (!ta) {
      return opResult('focus-editor', false,
        { elementFound: false, stateChanged: false, level: EVIDENCE.OBSERVED }, FAIL.EDITOR_NOT_DETECTED);
    }
    try { ta.focus({ preventScroll: true }); }
    catch (e) { try { ta.focus(); } catch (e2) { /* noop */ } }
    const focused = document.activeElement === ta ||
      (ta.contains && document.activeElement && ta.contains(document.activeElement));
    return opResult('focus-editor', focused, {
      elementFound: true, stateChanged: focused,
      level: focused ? EVIDENCE.VALIDATED : EVIDENCE.INFERRED,
    }, focused ? null : FAIL.COMMAND_FAILED);
  }

  // Host quick-input dismissal for Android Back (modal-class host surface).
  function dismissQuickInput() {
    const before = observe();
    if (!before.parts.quickInput.visible) {
      return opResult('dismiss-quickinput', true,
        { elementFound: before.parts.quickInput.present, stateChanged: false, level: EVIDENCE.VALIDATED });
    }
    const invoked = dispatchKeybinding('escape');
    const after = observe();
    const stateChanged = !after.parts.quickInput.visible;
    return opResult('dismiss-quickinput', invoked, {
      elementFound: true, invoked, stateChanged,
      level: stateChanged ? EVIDENCE.VALIDATED : EVIDENCE.INFERRED,
    });
  }

  // Focus the Search input after opening Search (inspection-first §31).
  function focusSearchInput() {
    const input = qs('.search-view input, .search-view textarea, .search-view [role="textbox"]');
    if (!input) {
      return opResult('focus-search-input', false,
        { elementFound: false, stateChanged: false, level: EVIDENCE.OBSERVED }, FAIL.SEARCH_NOT_DETECTED);
    }
    try { input.focus({ preventScroll: true }); }
    catch (e) { try { input.focus(); } catch (e2) { /* noop */ } }
    const focused = document.activeElement === input ||
      (input.contains && document.activeElement && input.contains(document.activeElement));
    return opResult('focus-search-input', focused, {
      elementFound: true, stateChanged: focused,
      level: focused ? EVIDENCE.VALIDATED : EVIDENCE.INFERRED,
    }, focused ? null : FAIL.COMMAND_FAILED);
  }

  /* ---------------- Surface abstraction (§19–§21) ------------------------ */
  // Generic surface contract: id/presentation/priority (SURFACE_META) +
  // detect/open/close/isOpen/observe. Lifecycle (§20):
  // UNKNOWN → DETECTED → AVAILABLE → OPEN → CLOSING → AVAILABLE, with
  // DEGRADED on operation failure. The UI represents DEGRADED (§20).
  const surfaceStates = {
    editor: SURFACE_STATE.UNKNOWN, explorer: SURFACE_STATE.UNKNOWN,
    search: SURFACE_STATE.UNKNOWN, sourceControl: SURFACE_STATE.UNKNOWN,
    terminal: SURFACE_STATE.UNKNOWN,
  };
  function getSurfaceState(id) { return surfaceStates[id] || SURFACE_STATE.UNKNOWN; }
  function getSurfaceStates() { return Object.assign({}, surfaceStates); }
  function setSurfaceState(id, st) { if (id in surfaceStates) surfaceStates[id] = st; }

  class Surface {
    constructor(id) { this.id = id; }
    detect() { return false; }
    open() { return { ok: false, reason: 'not-implemented' }; }
    close() { return { ok: false, reason: 'not-implemented' }; }
    isOpen() { return false; }
    observe() { return { present: false, visible: false, state: getSurfaceState(this.id) }; }
  }
  class EditorSurface extends Surface {
    constructor() { super(SURFACE.EDITOR); }
    detect() {
      const o = observe();
      const present = !!(o.surfaces.editor && o.surfaces.editor.present);
      setSurfaceState(this.id, !present ? SURFACE_STATE.UNKNOWN
        : (o.surfaces.editor.visible ? SURFACE_STATE.OPEN : SURFACE_STATE.AVAILABLE));
      return present;
    }
    open() {
      const r = focusEditor();
      setSurfaceState(this.id, r.ok ? SURFACE_STATE.OPEN : SURFACE_STATE.DEGRADED);
      return r;
    }
    close() {
      setSurfaceState(this.id, SURFACE_STATE.AVAILABLE);
      return opResult('close-editor-surface', true, { stateChanged: false, level: EVIDENCE.VALIDATED });
    }
    isOpen() { const o = observe(); return !!(o.surfaces.editor && o.surfaces.editor.visible); }
    observe() {
      const o = observe();
      return { present: !!o.surfaces.editor.present, visible: !!o.surfaces.editor.visible, state: getSurfaceState(this.id) };
    }
  }
  function drawerOpenResult(viewKey, surfaceId, r) {
    if (!r.ok) { setSurfaceState(surfaceId, SURFACE_STATE.DEGRADED); return r; }
    if (r.evidence && r.evidence.stateChanged) setSurfaceState(surfaceId, SURFACE_STATE.OPEN);
    else setSurfaceState(surfaceId, SURFACE_STATE.AVAILABLE); // invoked, awaiting validation
    return r;
  }
  function drawerCloseResult(surfaceId, r) {
    setSurfaceState(surfaceId, SURFACE_STATE.CLOSING);
    setSurfaceState(surfaceId, r.ok ? SURFACE_STATE.AVAILABLE : SURFACE_STATE.DEGRADED);
    return r;
  }
  class ExplorerSurface extends Surface {
    constructor() { super(SURFACE.EXPLORER); }
    detect() {
      const o = observe();
      const present = !!(o.surfaces.explorer && o.surfaces.explorer.present);
      setSurfaceState(this.id, !present ? SURFACE_STATE.UNKNOWN
        : (o.parts.sideBar.visible && o.sidebarActiveView === 'explorer' ? SURFACE_STATE.OPEN : SURFACE_STATE.AVAILABLE));
      return present;
    }
    open() { return drawerOpenResult('explorer', this.id, openExplorer()); }
    close() { return drawerCloseResult(this.id, closePanels()); }
    isOpen() { const o = observe(); return !!(o.parts.sideBar.visible && o.sidebarActiveView === 'explorer'); }
    observe() {
      const o = observe();
      return { present: !!o.surfaces.explorer.present, visible: this.isOpen(), state: getSurfaceState(this.id) };
    }
  }
  class SearchSurface extends Surface {
    constructor() { super(SURFACE.SEARCH); }
    detect() {
      const o = observe();
      const present = !!(o.surfaces.search && o.surfaces.search.present);
      setSurfaceState(this.id, !present ? SURFACE_STATE.UNKNOWN
        : (o.parts.sideBar.visible && o.sidebarActiveView === 'search' ? SURFACE_STATE.OPEN : SURFACE_STATE.AVAILABLE));
      return present;
    }
    open() { return drawerOpenResult('search', this.id, openSearch()); }
    close() { return drawerCloseResult(this.id, closePanels()); }
    isOpen() { const o = observe(); return !!(o.parts.sideBar.visible && o.sidebarActiveView === 'search'); }
    observe() {
      const o = observe();
      return { present: !!o.surfaces.search.present, visible: this.isOpen(), state: getSurfaceState(this.id) };
    }
  }
  class GitSurface extends Surface {
    constructor() { super(SURFACE.SOURCE_CONTROL); }
    detect() {
      const o = observe();
      const present = !!(o.surfaces.sourceControl && o.surfaces.sourceControl.present);
      setSurfaceState(this.id, !present ? SURFACE_STATE.UNKNOWN
        : (o.parts.sideBar.visible && o.sidebarActiveView === 'scm' ? SURFACE_STATE.OPEN : SURFACE_STATE.AVAILABLE));
      return present;
    }
    open() { return drawerOpenResult('scm', this.id, openSourceControl()); }
    close() { return drawerCloseResult(this.id, closePanels()); }
    isOpen() { const o = observe(); return !!(o.parts.sideBar.visible && o.sidebarActiveView === 'scm'); }
    observe() {
      const o = observe();
      return { present: !!o.surfaces.sourceControl.present, visible: this.isOpen(), state: getSurfaceState(this.id) };
    }
  }
  class TerminalSurface extends Surface {
    constructor() { super(SURFACE.TERMINAL); }
    detect() {
      const o = observe();
      const present = !!(o.surfaces.terminal && o.surfaces.terminal.present);
      // Terminal MAY be observed and reported, but operational integration
      // stays disabled in v0.1 (inspection-first §2 scope freeze).
      setSurfaceState(this.id, present ? SURFACE_STATE.AVAILABLE : SURFACE_STATE.UNKNOWN);
      return present;
    }
    open() {
      return opResult('open-terminal', false,
        { elementFound: false, invoked: false, stateChanged: false, level: EVIDENCE.OBSERVED },
        'terminal-disabled');
    }
    close() {
      setSurfaceState(this.id, SURFACE_STATE.AVAILABLE);
      return opResult('close-terminal', true, { stateChanged: false, level: EVIDENCE.VALIDATED });
    }
    isOpen() { const o = observe(); return !!(o.surfaces.terminal && o.surfaces.terminal.visible); }
    observe() {
      const o = observe();
      return { present: !!o.surfaces.terminal.present, visible: this.isOpen(), state: getSurfaceState(this.id) };
    }
  }
  const surfaces = {
    editor: new EditorSurface(),
    explorer: new ExplorerSurface(),
    search: new SearchSurface(),
    sourceControl: new GitSurface(),
    terminal: new TerminalSurface(),
  };

  return {
    id: ADAPTER_ID,
    version: ADAPTER_VERSION,
    detect, observe, capabilities,
    focusEditor, focusSearchInput, openExplorer, openSearch, openSourceControl, closePanels,
    dismissQuickInput,
    // inspection-first reconnaissance + selector provenance (§9–§18)
    reconnaissance, resolve, resolveSurfaceTarget, registerSelector, registrySnapshot,
    getSelectorLog, getDriftEvents, discoveryLevels,
    // surface abstraction (§19–§21)
    Surface, surfaces, getSurfaceState, getSurfaceStates,
    // internal mechanisms (shell/command layer may use as secondary paths)
    workbench, dispatchKeybinding, findActivityAction,
    // host-DOM knowledge the kernel needs as boolean answers (I-02)
    isRelevantNode, isProtectedTarget,
  };
})() : null;

/* ===========================================================================
 * §E NAMESPACED STYLESHEET (§41/§42)
 * All selectors are namespaced: #github-mobile-ux / .gmux-*. Host overrides
 * only apply under gmux-* state classes the userscript itself toggles.
 * No global element rules. !important is isolated to layout-critical host
 * overrides where VS Code's own grid would otherwise win.
 * Z-ladder (controlled, no escalation): drawer/panel 920 · surface modal 930
 * · shell/revive 940.
 * =========================================================================*/

const CSS_TEXT = [
  '/* GMUX shell chrome */',
  // CSS containment (inspection-first §40): treated as an optimization
  // requiring validation. Fake-DOM smoke + stub runs show no layout
  // breakage; live-device confirmation remains pending (see report).
  `#${ROOT_ID}{position:fixed;inset:0;pointer-events:none;z-index:940;contain:layout style;`,
  ' font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.3;',
  ' color:var(--vscode-foreground,#cccccc);}',
  '.gmux-surface{contain:layout paint;}',
  `#${ROOT_ID} .gmux-button{pointer-events:auto;font:inherit;color:inherit;background:transparent;border:0;padding:0;cursor:pointer;}`,
  `#${ROOT_ID} .gmux-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}`,

  '.gmux-header{position:absolute;left:0;right:0;top:var(--gmux-vv-offset,0px);height:var(--gmux-header-h,44px);',
  ' display:flex;align-items:center;gap:2px;padding:0 2px;pointer-events:auto;',
  ' background:var(--vscode-titleBar-activeBackground,var(--vscode-sideBar-background,#252526));',
  ' border-bottom:1px solid var(--vscode-titleBar-activeBorder,rgba(128,128,128,.2));transition:transform .15s ease;}',
  '.gmux-icon-button{flex:0 0 auto;width:42px;height:38px;font-size:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;}',
  '.gmux-header-file{flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:center;height:38px;padding:0 6px;border-radius:6px;font-size:13px;}',
  '.gmux-header-file .gmux-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
  '.gmux-icon-button:hover,.gmux-header-file:hover{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));}',
  '.gmux-icon-button:focus-visible,.gmux-toolbar .gmux-button:focus-visible,.gmux-surface .gmux-button:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:-2px;}',

  '.gmux-toolbar{position:absolute;left:0;right:0;',
  ' top:calc(var(--gmux-vv-offset,0px) + var(--gmux-vv-height,100vh) - var(--gmux-footer-h,52px));',
  ' height:var(--gmux-footer-h,52px);display:flex;pointer-events:auto;',
  ' background:var(--vscode-statusBar-background,var(--vscode-sideBar-background,#252526));',
  ' border-top:1px solid var(--vscode-statusBar-border,rgba(128,128,128,.2));transition:transform .15s ease;}',
  '.gmux-toolbar .gmux-button{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:19px;position:relative;',
  ' color:var(--vscode-statusBar-foreground,var(--vscode-foreground,#cccccc));}',
  '.gmux-toolbar .gmux-button .gmux-btn-label{font-size:10px;opacity:.85;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.gmux-toolbar .gmux-button[aria-pressed="true"]{color:var(--vscode-button-background,#0e639c);}',
  '.gmux-toolbar .gmux-button[aria-pressed="true"]::before{content:"";position:absolute;top:0;left:22%;right:22%;height:2px;background:currentColor;border-radius:0 0 2px 2px;}',
  '.gmux-toolbar .gmux-button[aria-disabled="true"]{opacity:.38;cursor:not-allowed;}',
  '.gmux-toolbar .gmux-button[data-degraded="true"]{opacity:.55;text-decoration:underline dotted;}',
  `#${ROOT_ID}.gmux-no-footer .gmux-toolbar{display:none;}`,
  `#${ROOT_ID}.gmux-no-header .gmux-header{display:none;}`,
  `#${ROOT_ID}.gmux-shell-minimized .gmux-header{transform:translateY(-110%);}`,
  `#${ROOT_ID}.gmux-shell-minimized .gmux-toolbar{transform:translateY(110%);}`,
  '@media (max-width:360px){.gmux-toolbar .gmux-button .gmux-btn-label{display:none;}}',

  '/* Host presentation overrides — only under gmux-* state classes (§42) */',
  // visibility (not display:none) preserves the workbench grid tracks so the
  // VS Code layout is never corrupted; only visibility/presentation changes.
  '.monaco-workbench.gmux-mode-mobile .part.titlebar{visibility:hidden;}',
  '.monaco-workbench.gmux-mode-mobile .part.activitybar{visibility:hidden;}',
  // Immersive editor (§29): minimap + redundant breadcrumbs out of the way.
  '.monaco-workbench.gmux-immersive .monaco-editor .minimap{display:none !important;}',
  '.monaco-workbench.gmux-immersive .monaco-breadcrumbs{display:none !important;}',
  // Drawer: reposition the EXISTING sidebar part (§31) — never a second tree.
  '.monaco-workbench.gmux-sidebar-overlay .part.sidebar{position:fixed !important;left:0 !important;right:auto !important;',
  ' top:calc(var(--gmux-vv-offset,0px) + var(--gmux-shell-top,0px)) !important;',
  ' height:calc(var(--gmux-vv-height,100vh) - var(--gmux-shell-top,0px) - var(--gmux-shell-bottom,0px)) !important;',
  ' width:min(100vw,480px) !important;z-index:920;',
  ' background:var(--vscode-sideBar-background,#252526);box-shadow:0 0 24px rgba(0,0,0,.45);}',
  // Panel overlay (only reachable if a terminal is ever enabled — §17).
  '.monaco-workbench.gmux-panel-overlay .part.panel{position:fixed !important;left:0 !important;right:0 !important;bottom:auto !important;',
  ' top:calc(var(--gmux-vv-offset,0px) + var(--gmux-shell-top,0px)) !important;',
  ' height:var(--gmux-panel-h,60vh) !important;width:auto !important;z-index:920;',
  ' background:var(--vscode-panel-background,#1e1e1e);box-shadow:0 0 24px rgba(0,0,0,.45);}',

  '/* Surfaces: menus / settings / diagnostics (modal class) */',
  '.gmux-surface-backdrop{position:absolute;inset:0;pointer-events:auto;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center;}',
  '@media (min-width:600px){.gmux-surface-backdrop{align-items:center;}}',
  '.gmux-surface{background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background,#252526));',
  ' color:var(--vscode-editorWidget-foreground,inherit);border:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,.3));',
  ' border-radius:10px 10px 0 0;width:100%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;',
  ' box-shadow:0 -4px 24px rgba(0,0,0,.35);}',
  '@media (min-width:600px){.gmux-surface{border-radius:10px;}}',
  '.gmux-surface-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(128,128,128,.2);font-weight:600;}',
  '.gmux-surface-head .gmux-button{width:34px;height:30px;border-radius:6px;font-size:16px;}',
  '.gmux-surface-head .gmux-button:hover{background:rgba(128,128,128,.18);}',
  '.gmux-surface-body{padding:8px 12px 14px;overflow:auto;-webkit-overflow-scrolling:touch;}',
  '.gmux-menu{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;}',
  '.gmux-menu .gmux-button{display:flex;width:100%;text-align:left;padding:11px 10px;border-radius:6px;font-size:15px;align-items:center;gap:10px;}',
  '.gmux-menu .gmux-button:hover{background:var(--vscode-list-hoverBackground,rgba(128,128,128,.15));}',
  '.gmux-menu .gmux-button[aria-disabled="true"]{opacity:.45;cursor:not-allowed;}',
  '.gmux-menu .gmux-note{margin-left:auto;font-size:11px;opacity:.7;}',
  '.gmux-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,.15);font-size:14px;}',
  '.gmux-row input[type=checkbox]{width:20px;height:20px;}',
  '.gmux-row select{background:var(--vscode-dropdown-background,#3c3c3c);color:var(--vscode-dropdown-foreground,#fff);border:1px solid var(--vscode-dropdown-border,transparent);padding:4px 6px;border-radius:4px;}',
  '.gmux-report{font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;background:rgba(128,128,128,.08);padding:8px;border-radius:6px;}',
  '.gmux-actions-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}',
  '.gmux-actions-row .gmux-button{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#fff);padding:7px 12px;border-radius:5px;font-size:13px;}',
  '.gmux-revive{position:fixed;right:10px;bottom:10px;z-index:940;width:34px;height:34px;border-radius:50%;',
  ' background:var(--vscode-button-background,#0e639c);color:#fff;display:flex;align-items:center;justify-content:center;',
  ' font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:auto;border:0;cursor:pointer;}',
].join('\n');

/* ===========================================================================
 * §F–§J RUNTIME SESSION (browser only)
 * =========================================================================*/

let session = null; // exactly one session (§6/§21 idempotency)

function createSession() {
  const diag = createDiagLog();
  const scheduler = createScheduler(HAS_DOM ? window : null);
  const prefsStore = createPreferenceStore(HAS_DOM ? { storage: window.localStorage } : null, diag);
  const commands = createCommandRegistry(diag);
  const adapter = GitHubDevAdapter;

  /* ----- minimum serializable kernel state (§16 + insp. §26) -------------- */
  const state = {
    lifecycle: LIFECYCLE.BOOTSTRAPPING,
    shellMode: SHELL_MODE.MOBILE,
    orientation: ORIENTATION.PORTRAIT,
    activeSurface: SURFACE.EDITOR,
    previousSurface: null,
    navigationStack: createNavStack(),
    immersive: true,
    keyboardVisible: false,
    viewport: { width: 0, height: 0, offsetTop: 0 },
    environment: { coarsePointer: null, touch: null },
    capabilities: {},
    diagnostics: { observations: 0, reconciliationCount: 0, warnings: [] },
    // runtime-only handles are kept OUTSIDE state (pending, modal kind).
    modal: null,
    lastFileKey: '',
  };

  let caps = {};
  const stats = {
    shellMounted: false, observerActive: false, observerRoot: 'body', viewportApplied: false,
    immersiveApplied: false, backHandled: false,
    explorerValidated: false, searchValidated: false, sourceControlValidated: false, terminalValidated: false,
    driftCount: 0, reconScans: 0,
  };
  // Last reconnaissance + discovery snapshots (inspection-first §9–§11).
  // Reconnaissance runs on demand (bootstrap / drift / inspect), never as a
  // steady-state full-DOM scan (§37/§50).
  let lastRecon = null;
  let lastDiscovery = { explorer: 0, search: 0, sourceControl: 0, editor: 0, terminal: 0 };
  let lastFocusedElement = null;
  let vvUsed = false;
  let pending = null;                 // {cmd, expect, t0, retried}
  let suppress = 0;                  // self-write MutationObserver mask
  let disposed = false;

  const listeners = [];
  let mo = null, bootObserver = null, bootTimer = null;
  let shell = null;
  const lastVars = {};

  // Android Back history layering (§34).
  let historyStack = [];   // owned history entries, bottom→top
  let internalPops = 0;    // pops initiated by our own reconciliation
  let dismissingQuickInput = false;

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  function applyWrites(fn) {
    suppress++;
    try { fn(); } finally {
      // Observer callbacks flush as microtasks before this timeout.
      setTimeout(() => { suppress = Math.max(0, suppress - 1); }, 0);
    }
  }

  // Every userscript-created element is ownership-marked (§20, I-13).
  function own(el) {
    if (el && el.setAttribute) el.setAttribute(OWNER_ATTR, OWNER_VALUE);
    return el;
  }
  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return own(node);
  }

  /* ============================ §F SHELL UI ============================== */

  const SURFACE_BUTTONS = [
    { surface: SURFACE.EXPLORER, icon: '\u{1F4C1}', label: 'Files' },
    { surface: SURFACE.SEARCH, icon: '\u{1F50D}', label: 'Search' },
    { surface: SURFACE.SOURCE_CONTROL, icon: '\u2387', label: 'Git' },
    { surface: SURFACE.TERMINAL, icon: '\u25A3', label: 'Term.' },
    { surface: SURFACE.SETTINGS, icon: '\u2699', label: 'More' },
  ];

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = el('style');
    style.id = STYLE_ID;
    style.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  function buildShell() {
    const root = el('div', 'gmux-shell');
    root.id = ROOT_ID;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'GitHub.dev mobile controls');

    const header = el('header', 'gmux-header');
    header.setAttribute('role', 'banner');

    const menuBtn = el('button', 'gmux-button gmux-icon-button gmux-header-menu');
    menuBtn.textContent = '\u2630';
    menuBtn.setAttribute('aria-label', 'GMUX menu');
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-controls', 'gmux-surface-root');

    const fileBtn = el('button', 'gmux-button gmux-header-file');
    fileBtn.setAttribute('aria-label', 'Current file — activate to focus the editor');
    const fileName = el('span', 'gmux-file-name');
    fileBtn.appendChild(fileName);

    const moreBtn = el('button', 'gmux-button gmux-icon-button gmux-header-more');
    moreBtn.textContent = '\u22EE';
    moreBtn.setAttribute('aria-label', 'Editor actions');
    moreBtn.setAttribute('aria-haspopup', 'true');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.setAttribute('aria-controls', 'gmux-surface-root');

    header.appendChild(menuBtn);
    header.appendChild(fileBtn);
    header.appendChild(moreBtn);

    // Bottom command bar — a COMMAND surface dispatching intent only (§22).
    const toolbar = el('nav', 'gmux-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Mobile command bar');
    const buttons = {};
    SURFACE_BUTTONS.forEach((def) => {
      const b = el('button', 'gmux-button');
      b.setAttribute('data-surface', def.surface);
      b.setAttribute('aria-label', def.surface === SURFACE.TERMINAL ? 'Terminal (unavailable on this host)'
        : def.surface === SURFACE.SETTINGS ? 'Settings and diagnostics' : def.label);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('aria-controls', ROOT_ID);
      const ic = el('span');
      ic.setAttribute('aria-hidden', 'true');
      ic.textContent = def.icon;
      const lb = el('span', 'gmux-btn-label');
      lb.setAttribute('aria-hidden', 'true');
      lb.textContent = def.label;
      b.appendChild(ic);
      b.appendChild(lb);
      toolbar.appendChild(b);
      buttons[def.surface] = b;
    });

    const live = el('div', 'gmux-visually-hidden');
    live.setAttribute('aria-live', 'polite');
    const surfaceRoot = el('div', 'gmux-surface-root');
    surfaceRoot.id = 'gmux-surface-root';

    root.appendChild(header);
    root.appendChild(toolbar);
    root.appendChild(live);
    root.appendChild(surfaceRoot);

    // Inputs dispatch INTENT; no GitHub DOM logic exists in the shell (§22).
    menuBtn.addEventListener('click', () => dispatch({ type: 'OPEN_MENU' }));
    moreBtn.addEventListener('click', () => dispatch({ type: 'OPEN_EDITOR_MENU' }));
    fileBtn.addEventListener('click', () => dispatch({ type: 'FOCUS_EDITOR' }));
    toolbar.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-surface]') : null;
      if (!btn) return;
      const surface = btn.getAttribute('data-surface');
      if (btn.getAttribute('aria-disabled') === 'true') {
        if (surface === SURFACE.TERMINAL) {
          diag.log(FAIL.TERMINAL_NOT_DETECTED, 'terminal not advertised on this host (§17/§46)', 'warn');
          announce('Terminal is not available on github.dev');
        }
        return;
      }
      dispatch({ type: 'OPEN_SURFACE', surface });
    });

    return {
      root, header, toolbar, fileName, buttons, live, surfaceRoot, menuBtn, moreBtn,
      mount() { applyWrites(() => { document.body.appendChild(root); }); },
      unmount() { if (root.parentNode) applyWrites(() => { root.parentNode.removeChild(root); }); },
    };
  }

  function announce(msg) { if (shell && shell.live) shell.live.textContent = msg; }

  /* ------------------------------ surfaces ------------------------------- */

  let activeModal = null;
  function closeModal() {
    if (activeModal) { activeModal.close(); activeModal = null; }
  }

  function openSurfaceModal(title, bodyEl, kind) {
    closeModal();
    const backdrop = el('div', 'gmux-surface-backdrop');
    const modal = el('div', 'gmux-surface');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title);
    const head = el('div', 'gmux-surface-head');
    const h = el('span');
    h.textContent = title;
    const x = el('button', 'gmux-button');
    x.textContent = '\u2715';
    x.setAttribute('aria-label', 'Close dialog');
    x.addEventListener('click', () => requestBackOrClose());
    head.appendChild(h);
    head.appendChild(x);
    const body = el('div', 'gmux-surface-body');
    body.appendChild(bodyEl);
    modal.appendChild(head);
    modal.appendChild(body);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) requestBackOrClose(); });
    const prevFocus = document.activeElement;
    applyWrites(() => { shell.surfaceRoot.appendChild(backdrop); });
    state.modal = kind || 'modal';
    scheduler.markDirty('modal');
    const focusable = modal.querySelector('button, [href], input, select, textarea');
    if (focusable) { try { focusable.focus(); } catch (e) { /* noop */ } }
    announce(`${title} opened`);
    activeModal = {
      close() {
        if (backdrop.parentNode) applyWrites(() => { backdrop.parentNode.removeChild(backdrop); });
        state.modal = null;
        scheduler.markDirty('modal');
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* noop */ } }
      },
    };
    return activeModal;
  }

  // Android Back is the canonical close path (§34); when a history entry exists
  // we pop it and popstate performs the close, keeping the stack truthful.
  function requestBackOrClose() {
    if (historyStack.length && FEATURES.androidBack) {
      try { window.history.back(); return; } catch (e) { /* fall through */ }
    }
    closeModal();
  }

  function menuList(items) {
    const ul = el('ul', 'gmux-menu');
    items.forEach((item) => {
      const li = el('li');
      const b = el('button', 'gmux-button');
      b.textContent = item.label;
      if (item.note) {
        const n = el('span', 'gmux-note');
        n.textContent = item.note;
        b.appendChild(n);
      }
      if (item.disabled) b.setAttribute('aria-disabled', 'true');
      else b.addEventListener('click', () => { if (!item.keepOpen) closeModal(); if (item.run) item.run(); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    return ul;
  }

  /* ---------------------------- diagnostics (§37) ------------------------ */

  function buildReport() {
    const p = prefsStore.get();
    const L = [];
    L.push(NAME);
    L.push(`Version: ${USER_INTERFACE_VERSION}`);
    L.push(`Adapter: ${adapter ? adapter.id : 'none'}`);
    L.push(`Mode: ${String(state.shellMode || 'unknown').toUpperCase()}`);
    L.push(`Orientation: ${state.orientation || ORIENTATION.PORTRAIT}`);
    L.push(`Viewport: ${state.viewport.width} \u00D7 ${state.viewport.height}`);
    L.push(`Pointer: ${state.environment.coarsePointer === null ? 'unknown' : (state.environment.coarsePointer ? 'coarse' : 'fine')}   Touch: ${state.environment.touch === null ? 'unknown' : (state.environment.touch ? 'yes' : 'no')}`);
    L.push('');
    L.push(`Editor: ${caps.editor || CAP.UNKNOWN}`);
    L.push(`Explorer: ${caps.explorer || CAP.UNKNOWN}`);
    L.push(`Search: ${caps.search || CAP.UNKNOWN}`);
    L.push(`Source Control: ${caps.sourceControl || CAP.UNKNOWN}`);
    L.push(`Terminal: ${caps.terminal || CAP.UNKNOWN}`);
    L.push(`Activity bar: ${caps.activityBar || CAP.UNKNOWN}`);
    L.push(`Status bar: ${caps.statusBar || CAP.UNKNOWN}`);
    L.push(`Command palette: ${caps.commandPalette || CAP.UNKNOWN}`);
    L.push('');
    L.push(`Shell: ${stats.shellMounted ? 'ACTIVE' : state.lifecycle}`);
    L.push(`Observer: ${stats.observerActive ? `ACTIVE (${stats.observerRoot || 'body'})` : 'INACTIVE'}`);
    L.push(`Observations: ${state.diagnostics.observations}   Reconciliations: ${state.diagnostics.reconciliationCount}`);
    L.push(`Keyboard: ${state.keyboardVisible ? 'INFERRED_OPEN' : 'INFERRED_CLOSED'}`);
    L.push(`Immersive: ${p.immersive ? 'ON' : 'OFF'}   Bottom bar: ${p.bottomBar ? 'ON' : 'OFF'}`);
    L.push(`Active surface: ${state.activeSurface}${state.previousSurface ? ` (previous: ${state.previousSurface})` : ''}`);
    L.push(`Navigation: ${JSON.stringify(state.navigationStack || [SURFACE.EDITOR])}`);
    L.push(`Discovery: explorer=${lastDiscovery.explorer} search=${lastDiscovery.search} sourceControl=${lastDiscovery.sourceControl} editor=${lastDiscovery.editor} terminal=${lastDiscovery.terminal}`);
    if (lastRecon) {
      L.push(`Reconnaissance: buttons=${lastRecon.buttons} labelled=${lastRecon.labelledControls} candidateSurfaces=${lastRecon.candidateSurfaces} scans=${stats.reconScans}`);
    } else {
      L.push('Reconnaissance: (no scan yet)');
    }
    const drift = adapter && adapter.getDriftEvents ? adapter.getDriftEvents() : [];
    L.push(`Drift: ${drift.length ? `${drift.length} ADAPTER_DRIFT event(s)` : 'none'}`);
    drift.slice(-4).forEach((d) => L.push(`- ADAPTER_DRIFT surface=${d.surface} fallback=${d.fallback}`));
    L.push('');
    const warnings = diag.warnings();
    L.push(`Warnings: ${warnings.length ? '' : '(none)'}`);
    warnings.forEach((w) => L.push(`- ${w.code ? w.code + ': ' : ''}${w.msg}`));
    if (!warnings.length && caps.terminal !== CAP.DETECTED) {
      L.push('- terminal capability unavailable');
    }
    L.push('');
    L.push('Feature status (evidence-based, §38):');
    computeFeatureStatuses({ caps, stats, vvUsed: vvUsed ? (window.visualViewport ? 'visualViewport' : 'fallback') : null })
      .forEach(([name, info]) => L.push(`  ${name}: ${info.status} — ${info.basis}`));
    const recent = diag.entries().slice(-10);
    if (recent.length) {
      L.push('');
      L.push('Recent events:');
      recent.forEach((e) => L.push(`  [${new Date(e.ts).toISOString()}] ${e.level.toUpperCase()} ${e.code ? e.code + ': ' : ''}${e.msg}`));
    }
    return L.join('\n');
  }

  function openDiagnostics() {
    const wrap = el('div');
    const pre = el('div', 'gmux-report');
    pre.setAttribute('role', 'log');
    pre.textContent = buildReport();
    wrap.appendChild(pre);
    const row = el('div', 'gmux-actions-row');
    const mk = (label, fn) => {
      const b = el('button', 'gmux-button');
      b.textContent = label;
      b.addEventListener('click', fn);
      row.appendChild(b);
    };
    mk('Refresh', () => { scheduler.markDirty('diagnostics'); pre.textContent = buildReport(); });
    mk('Copy report', () => {
      const text = buildReport();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => announce('Report copied'), () => announce('Copy failed'));
      } else announce('Clipboard unavailable');
    });
    mk('Reset preferences', () => { prefsStore.reset(); scheduler.markDirty('prefs'); pre.textContent = buildReport(); });
    mk('Disable GMUX', () => { closeModal(); dispatch({ type: 'DISABLE' }); });
    wrap.appendChild(row);
    openSurfaceModal(`${NAME} — diagnostics`, wrap, 'diagnostics');
  }

  /* ----------------------------- preferences UI -------------------------- */

  function openSettings() {
    const p = prefsStore.get();
    const wrap = el('div');
    const row = (labelText, control) => {
      const r = el('div', 'gmux-row');
      const l = el('label');
      l.textContent = labelText;
      r.appendChild(l);
      r.appendChild(control);
      wrap.appendChild(r);
      return r;
    };
    const checkbox = (value, key) => {
      const c = el('input');
      c.type = 'checkbox';
      c.checked = !!value;
      c.addEventListener('change', () => { dispatch({ type: 'TOGGLE_PREF', key, value: c.checked }); });
      return c;
    };
    row('Immersive editor (hide minimap on mobile)', checkbox(p.immersive, 'immersive'));
    row('Bottom command bar', checkbox(p.bottomBar, 'bottomBar'));
    const sel = el('select');
    sel.setAttribute('aria-label', 'Shell mode');
    ['auto', 'mobile', 'compact', 'desktop'].forEach((m) => {
      const o = el('option');
      o.value = m;
      o.textContent = m === 'auto' ? 'Auto (follow viewport)' : m;
      if (p.mode === m) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => dispatch({ type: 'TOGGLE_PREF', key: 'mode', value: sel.value }));
    row('Shell mode', sel);
    const note = el('div', 'gmux-report');
    note.style.marginTop = '10px';
    note.textContent = `${NAME} v${USER_INTERFACE_VERSION}\nadapter ${adapter ? adapter.version : '-'} · preferences schema v${PREFERENCE_SCHEMA_VERSION}\n` +
      'Preferences stay in this browser (localStorage). No telemetry, no network, no credentials, no repository data (§39/§48).';
    wrap.appendChild(note);
    openSurfaceModal('GMUX settings', wrap, 'settings');
  }

  /* ===================== COMMAND PIPELINE (§22/§23) ====================== */

  function dispatch(action) {
    if (!action || typeof action.type !== 'string') {
      diag.log(FAIL.COMMAND_FAILED, `invalid intent: ${JSON.stringify(action || null)}`, 'error');
      return { ok: false, code: FAIL.COMMAND_FAILED };
    }
    switch (action.type) {
      case 'OPEN_SURFACE': return openSurfaceIntent(action.surface);
      case 'CLOSE_SURFACE': return commands.execute('close-surface');
      case 'FOCUS_EDITOR': return commands.execute('focus-editor');
      case 'OPEN_MENU': return openMenuCommand();
      case 'OPEN_EDITOR_MENU': return openEditorMenuCommand();
      case 'OPEN_SETTINGS': openSettings(); return { ok: true };
      case 'OPEN_DIAGNOSTICS': openDiagnostics(); return { ok: true };
      case 'TOGGLE_PREF': return commands.execute('set-preference', action);
      case 'DISABLE': return commands.execute('disable-gmux');
      default:
        diag.log(FAIL.COMMAND_FAILED, `unknown intent: ${action.type}`, 'error');
        return { ok: false, code: FAIL.COMMAND_FAILED };
    }
  }

  function openSurfaceIntent(surface) {
    // Focus management (§31): remember the opening control so close can
    // restore focus when the element is still connected.
    try { lastFocusedElement = document.activeElement || null; } catch (e) { lastFocusedElement = null; }
    if (surface === SURFACE.SETTINGS) { openSettings(); return { ok: true }; }
    if (surface === SURFACE.TERMINAL) {
      if (!FEATURES.terminalSurface) {
        diag.log(FAIL.TERMINAL_NOT_DETECTED, 'terminal surface is disabled in v0.1 (feature flag, §17)', 'warn');
        announce('Terminal is disabled in v0.1');
        return { ok: false, code: FAIL.TERMINAL_NOT_DETECTED };
      }
      return commands.execute('open-terminal');
    }
    // Pressing the active surface again toggles it closed (through Back path).
    if (state.modal) closeModal();
    if (state.activeSurface === surface) return commands.execute('close-surface');
    const id = surface === SURFACE.SOURCE_CONTROL ? 'open-source-control' : `open-${surface}`;
    return commands.execute(id);
  }

  function beginPending(cmd, expect) {
    state.previousSurface = state.activeSurface;
    state.activeSurface = expect;
    state.navigationStack = navPush(state.navigationStack, expect);
    pending = { cmd, expect, t0: Date.now(), retried: false };
  }

  function recordOperation(r, failCode) {
    if (r.ok) {
      diag.log(null, `${r.operation}: ok (${r.evidence.level || 'OBSERVED'}${r.evidence.mechanism ? ', ' + r.evidence.mechanism : ''})`, 'info');
    } else {
      diag.log(r.reason || failCode, `${r.operation} failed: ${JSON.stringify(r.evidence)}`, 'warn');
    }
  }

  commands.register('open-explorer', () => {
    if (caps.explorer === CAP.UNKNOWN) diag.log(FAIL.CAPABILITY_UNKNOWN, 'explorer capability UNKNOWN; attempting on evidence anyway', 'info');
    const r = adapter.openExplorer();
    recordOperation(r, FAIL.EXPLORER_NOT_DETECTED);
    if (!r.ok) return { ok: false, code: r.reason || FAIL.EXPLORER_NOT_DETECTED, evidence: r.evidence };
    beginPending('openExplorer', SURFACE.EXPLORER);
    scheduler.markDirty('command');
    return { ok: true, operation: r.operation, evidence: r.evidence };
  });
  commands.register('open-search', () => {
    const r = adapter.openSearch();
    recordOperation(r, FAIL.SEARCH_NOT_DETECTED);
    if (!r.ok) return { ok: false, code: r.reason || FAIL.SEARCH_NOT_DETECTED, evidence: r.evidence };
    beginPending('openSearch', SURFACE.SEARCH);
    scheduler.markDirty('command');
    return { ok: true, operation: r.operation, evidence: r.evidence };
  });
  commands.register('open-source-control', () => {
    const r = adapter.openSourceControl();
    recordOperation(r, FAIL.SOURCE_CONTROL_NOT_DETECTED);
    if (!r.ok) return { ok: false, code: r.reason || FAIL.SOURCE_CONTROL_NOT_DETECTED, evidence: r.evidence };
    beginPending('openSourceControl', SURFACE.SOURCE_CONTROL);
    scheduler.markDirty('command');
    return { ok: true, operation: r.operation, evidence: r.evidence };
  });
  commands.register('open-terminal', () => {
    if (caps.terminal !== CAP.DETECTED) {
      diag.log(FAIL.TERMINAL_NOT_DETECTED, `terminal ${caps.terminal || CAP.UNKNOWN}; not advertising it (§17/§46)`, 'warn');
      return { ok: false, code: FAIL.TERMINAL_NOT_DETECTED };
    }
    const invoked = adapter.dispatchKeybinding('togglePanel');
    if (!invoked) return { ok: false, code: FAIL.TERMINAL_NOT_DETECTED };
    beginPending('openTerminal', SURFACE.TERMINAL);
    scheduler.markDirty('command');
    return { ok: true };
  });
  commands.register('focus-editor', () => {
    const r = adapter.focusEditor();
    recordOperation(r, FAIL.EDITOR_NOT_DETECTED);
    if (!r.ok) return { ok: false, code: r.reason || FAIL.EDITOR_NOT_DETECTED, evidence: r.evidence };
    state.previousSurface = state.activeSurface;
    state.activeSurface = SURFACE.EDITOR;
    state.navigationStack = createNavStack();
    scheduler.markDirty('command');
    return { ok: true, evidence: r.evidence };
  });
  commands.register('close-surface', () => {
    if (state.activeSurface === SURFACE.EDITOR) {
      diag.log(FAIL.COMMAND_FAILED, 'close-surface ignored on editor', 'info');
      return { ok: false, code: FAIL.COMMAND_FAILED };
    }
    const t = transitionFor(state, 'close');
    const target = t.ok ? t.to : SURFACE.EDITOR;
    const r = adapter.closePanels();
    recordOperation(r, FAIL.COMMAND_FAILED);
    state.previousSurface = null;
    state.activeSurface = target;
    state.navigationStack = navPop(state.navigationStack);
    pending = { cmd: 'close', expect: SURFACE.EDITOR, t0: Date.now(), retried: false };
    // Focus restoration (§31): return to the opening control when possible.
    try {
      if (lastFocusedElement && lastFocusedElement.isConnected && lastFocusedElement.focus) {
        lastFocusedElement.focus();
      }
    } catch (e) { /* safe fallback: leave focus where the host put it */ }
    scheduler.markDirty('command');
    return { ok: true, evidence: r.evidence };
  });
  commands.register('set-preference', (action) => {
    const allowed = ['mode', 'immersive', 'preferredSurface', 'bottomBar'];
    if (!action || allowed.indexOf(action.key) === -1) {
      return { ok: false, code: FAIL.COMMAND_FAILED };
    }
    prefsStore.set({ [action.key]: action.value });
    scheduler.markDirty('prefs');
    return { ok: true };
  });
  commands.register('disable-gmux', () => { disableShell(true); return { ok: true }; });

  function openMenuCommand() {
    const p = prefsStore.get();
    openSurfaceModal('GMUX', menuList([
      { label: 'Settings', note: 'mobile UX', run: () => dispatch({ type: 'OPEN_SETTINGS' }) },
      { label: 'Diagnostics', note: 'status & evidence', run: () => openDiagnostics() },
      { label: 'Toggle immersive mode', note: p.immersive ? 'on' : 'off', run: () => dispatch({ type: 'TOGGLE_PREF', key: 'immersive', value: !p.immersive }) },
      { label: 'Toggle bottom command bar', note: p.bottomBar ? 'on' : 'off', run: () => dispatch({ type: 'TOGGLE_PREF', key: 'bottomBar', value: !p.bottomBar }) },
      { label: 'Disable GMUX', note: 'Alt+Shift+G restores', run: () => dispatch({ type: 'DISABLE' }) },
    ]), 'menu');
    return { ok: true };
  }
  function openEditorMenuCommand() {
    openSurfaceModal('Editor actions', menuList([
      { label: 'Go to file\u2026', note: 'Ctrl+P', run: () => adapter.dispatchKeybinding('quickOpen') },
      { label: 'Command palette\u2026', note: 'Ctrl+Shift+P', run: () => adapter.dispatchKeybinding('commandPalette') },
      { label: 'VS Code settings', note: 'Ctrl+,', run: () => adapter.dispatchKeybinding('openSettings') },
      { label: 'Focus editor', run: () => dispatch({ type: 'FOCUS_EDITOR' }) },
      { label: 'Close current surface', run: () => dispatch({ type: 'CLOSE_SURFACE' }) },
    ]), 'editor-menu');
    return { ok: true };
  }

  /* ===================== §G VIEWPORT / KEYBOARD (§18/§29) ================ */

  function readViewport() {
    const vv = window.visualViewport;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let offsetTop = 0;
    if (vv) {
      width = vv.width; height = vv.height; offsetTop = vv.offsetTop;
      vvUsed = 'visualViewport';
    } else if (vvUsed !== 'fallback') {
      vvUsed = 'fallback';
      diag.log(FAIL.VIEWPORT_UNAVAILABLE, 'visualViewport missing; window resize fallback used', 'warn');
    }
    state.viewport = { width: Math.round(width), height: Math.round(height), offsetTop: Math.round(offsetTop) };
    // Interaction characteristics (§23): coarse pointer + touch, observed —
    // never inferred from user-agent (§24).
    let coarsePointer = null;
    try {
      if (window.matchMedia) coarsePointer = !!window.matchMedia('(pointer: coarse)').matches;
    } catch (e) { coarsePointer = null; }
    let touch = null;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number') {
        touch = navigator.maxTouchPoints > 0;
      }
    } catch (e) { touch = null; }
    const env = observeEnvironment({
      width: state.viewport.width, height: state.viewport.height,
      coarsePointer, touch,
    });
    state.orientation = env.orientation;
    state.environment = { coarsePointer: env.coarsePointer, touch: env.touch };
    const kb = inferKeyboard({
      vvAvailable: !!vv, vvHeight: height, vvWidth: width,
      layoutHeight: window.innerHeight, layoutWidth: window.innerWidth,
    });
    state.keyboardVisible = kb.visible;
    scheduler.markDirty('viewport');
  }

  let vvRaf = 0;
  function onViewportEvent() {
    if (vvRaf) return;
    vvRaf = (window.requestAnimationFrame || window.setTimeout)(() => {
      vvRaf = 0;
      if (!disposed) readViewport();
    });
  }
  function wireViewport() {
    const vv = window.visualViewport;
    if (vv) { on(vv, 'resize', onViewportEvent); on(vv, 'scroll', onViewportEvent); }
    on(window, 'resize', onViewportEvent);
    on(window, 'orientationchange', onViewportEvent);
    readViewport();
  }

  /* ==================== §J MUTATION OBSERVER (§26/§27) =================== */

  // Observation narrowing (inspection-first §37): bootstrap observes the
  // body; once the workbench root is identified the main observer narrows to
  // it, while a cheap top-level watcher keeps workbench add/remove visible.
  // No permanent full-document expensive scan remains in steady state.
  let moTarget = null;
  let moRoot = null;
  function observerCallback(mutations) {
    if (suppress > 0) return; // mask our own writes
    let relevant = false;
    for (let i = 0; i < mutations.length && !relevant; i++) {
      const m = mutations[i];
      // "Is this host change relevant?" is adapter knowledge (I-02);
      // ownership masking is included in the adapter's answer.
      if (m.type === 'childList') {
        for (let a = 0; a < m.addedNodes.length && !relevant; a++) relevant = adapter.isRelevantNode(m.addedNodes[a]);
        for (let r = 0; r < m.removedNodes.length && !relevant; r++) relevant = adapter.isRelevantNode(m.removedNodes[r]);
      } else if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
        relevant = adapter.isRelevantNode(m.target);
      }
    }
    if (relevant) scheduler.markDirty('mutation');
  }
  function retargetObserver() {
    if (!mo) return;
    let wb = null;
    try { wb = adapter.workbench(); } catch (e) { wb = null; }
    const scope = wb ? 'workbench' : 'body';
    const target = wb || document.body;
    if (stats.observerRoot === scope && moTarget === target) return;
    try { mo.disconnect(); } catch (e) { /* noop */ }
    moTarget = target;
    try {
      mo.observe(moTarget, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'aria-hidden'],
        characterData: false,
      });
    } catch (e) { /* host without a usable root — keep waiting */ }
    if (stats.observerRoot !== scope) {
      stats.observerRoot = scope;
      diag.log(null, `observer scope: body → ${scope} (§37 narrowing)`, 'info');
    }
  }
  function wireObserver() {
    if (!('MutationObserver' in window)) {
      diag.log(FAIL.DOM_CHANGED, 'MutationObserver unavailable; dynamic changes will not reconcile', 'error');
      return;
    }
    mo = new MutationObserver(observerCallback);
    retargetObserver();
    // Top-level watcher: catches workbench add/remove even while narrowed.
    try {
      moRoot = new MutationObserver(() => { retargetObserver(); scheduler.markDirty('root'); });
      moRoot.observe(document.body, { childList: true, subtree: false, attributes: false, characterData: false });
    } catch (e) { moRoot = null; }
    stats.observerActive = true;
  }

  /* ===================== §H INPUT & ANDROID BACK (§34) =================== */
  // The editor is a protected zone (§30): GMUX adds no pointer/gesture
  // handlers in v0.1 and only listens for Escape, yielding to Monaco inside
  // editor regions (the protected-zone answer comes from the adapter, I-02).
  // Back is never permanently trapped (I-11).

  function wireKeyboard() {
    on(window, 'keydown', (ev) => {
      if (ev.key === 'Escape' && state.modal) { closeModal(); return; }
      if (ev.key === 'Escape' && !state.modal && state.shellMode === SHELL_MODE.MOBILE &&
          state.activeSurface !== SURFACE.EDITOR) {
        if (adapter.isProtectedTarget(ev.target)) return; // Monaco owns Escape there
        if (historyStack.length && FEATURES.androidBack) { try { window.history.back(); return; } catch (e) { /* fall through */ } }
        commands.execute('close-surface');
      }
    }, true);
  }

  function desiredHistoryStack(obs) {
    // Back layering is a v0.1 mobile/compact interaction; DESKTOP mode must
    // leave browser history completely alone (§34 scope, I-11).
    if (state.shellMode === SHELL_MODE.DESKTOP) return [];
    const d = [];
    if (state.activeSurface && state.activeSurface !== SURFACE.EDITOR && state.activeSurface !== SURFACE.SETTINGS) {
      d.push('surface');
    }
    if (obs && obs.parts.quickInput && obs.parts.quickInput.visible && !dismissingQuickInput && !state.modal) {
      d.push('quickinput');
    }
    if (state.modal) d.push('modal');
    return d;
  }

  function markerState(kind) { return { [HISTORY_MARKER]: true, kind, v: 1 }; }

  // Declarative convergence: push/replace/popping until the owned history
  // stack matches the currently presented owned UI. Idempotent (§25).
  function syncHistory(desired) {
    if (!FEATURES.androidBack) return;
    let guard = 0;
    while (historyStack.length < desired.length && guard++ < 4) {
      const kind = desired[historyStack.length];
      try { window.history.pushState(markerState(kind), ''); } catch (e) { break; }
      historyStack.push(kind);
    }
    while (historyStack.length > desired.length && guard++ < 8) {
      internalPops++;
      try { window.history.back(); } catch (e) { /* noop */ }
      historyStack.pop();
    }
    if (historyStack.length && desired.length &&
        historyStack[historyStack.length - 1] !== desired[desired.length - 1]) {
      const kind = desired[desired.length - 1];
      try { window.history.replaceState(markerState(kind), ''); } catch (e) { /* noop */ }
      historyStack[historyStack.length - 1] = kind;
    }
  }

  function consumeBrowserBack(popState) {
    // Priority (§34): modal → host quick input → drawer/secondary → default.
    const decision = planBack({
      modal: !!state.modal,
      quickInputVisible: !!(popState && popState.quickInputVisible),
      activeSurface: state.activeSurface,
      previousSurface: state.previousSurface,
      navigationStack: state.navigationStack,
    });
    if (decision.consume === 'modal') {
      closeModal();
      stats.backHandled = true;
      diag.log(null, 'back consumed: closed modal', 'info');
      return true;
    }
    if (decision.consume === 'quickinput') {
      dismissingQuickInput = true;
      const r = adapter.dismissQuickInput();
      recordOperation(r, FAIL.COMMAND_FAILED);
      stats.backHandled = true;
      diag.log(null, 'back consumed: dismiss host quick input', 'info');
      return true;
    }
    if (decision.consume === 'surface') {
      commands.execute('close-surface');
      stats.backHandled = true;
      diag.log(null, `back consumed: returned to ${decision.to}`, 'info');
      return true;
    }
    return false; // ALLOW_BROWSER_DEFAULT
  }

  function wireHistory() {
    if (!FEATURES.androidBack) return;
    on(window, 'popstate', (ev) => {
      scheduler.markDirty('route');
      if (internalPops > 0) {
        // Our own convergence pop: syncHistory() already adjusted the stack.
        internalPops--;
        return;
      }
      const ours = !!(ev.state && ev.state[HISTORY_MARKER] === true);
      if (!ours) return; // application/route entry: ALLOW_BROWSER_DEFAULT
      historyStack.pop();
      const obs = adapter.observe();
      consumeBrowserBack({ quickInputVisible: !!(obs.parts.quickInput && obs.parts.quickInput.visible) });
      scheduler.markDirty('back');
    });
    // Route observations without monkey-patching pushState (§35): popstate +
    // MutationObserver surface adoption cover SPA navigation.
    on(window, 'hashchange', () => scheduler.markDirty('route'));
  }

  /* ========================= §I RECONCILER (§24/§25) ===================== */

  let reconcileGuard = { count: 0, windowStart: Date.now() };

  function applyClassDiffs(el, add, remove) {
    if (!el) return;
    remove.forEach((c) => { if (el.classList.contains(c)) el.classList.remove(c); });
    add.forEach((c) => { if (!el.classList.contains(c)) el.classList.add(c); });
  }
  function applyVars(vars) {
    const style = document.documentElement.style;
    Object.keys(vars).forEach((k) => {
      if (lastVars[k] !== vars[k]) { style.setProperty(k, vars[k]); lastVars[k] = vars[k]; }
    });
  }
  function clearVars() {
    const style = document.documentElement.style;
    Object.keys(lastVars).forEach((k) => { style.removeProperty(k); delete lastVars[k]; });
  }

  function reconcileShellDuplication() {
    // Invariant I-01/§21: userscript-owned shell count ≤ 1.
    let roots = [];
    try { roots = qsaRoots(); } catch (e) { roots = []; }
    if (roots.length > 1) {
      diag.log(FAIL.SHELL_DUPLICATION, `observed ${roots.length} shell roots; reconciling to exactly one`, 'error');
      roots.forEach((r) => { if (r !== shell.root && r.parentNode) applyWrites(() => r.parentNode.removeChild(r)); });
      return true;
    }
    return false;
  }
  function qsaRoots() { return Array.prototype.slice.call(document.querySelectorAll(`#${ROOT_ID}`)); }

  function reconcile() {
    if (disposed) return;
    const now = Date.now();
    if (now - reconcileGuard.windowStart > 2000) reconcileGuard = { count: 0, windowStart: now };
    reconcileGuard.count++;
    if (reconcileGuard.count > 90) {
      diag.log(FAIL.RECONCILIATION_FAILED, 'reconciliation rate too high; backing off this cycle', 'error');
      reconcileGuard.windowStart = now;
      return;
    }
    try {
      reconcileShellDuplication();

      const obs = adapter.observe();
      state.diagnostics.observations++;
      if (obs.discovery) lastDiscovery = Object.assign({}, lastDiscovery, obs.discovery);
      // Drift: a previously matching known selector that no longer matches
      // degrades the feature (§48) and triggers a bounded re-scan — the
      // agent records evidence first instead of guessing (§18).
      if (obs.drift && obs.drift.length) {
        obs.drift.forEach((d) => {
          stats.driftCount++;
          diag.log(FAIL.ADAPTER_DRIFT,
            `Surface: ${d.surface} Expected: ${d.expected} Current: ${d.current} Fallback: ${d.fallback}`, 'warn');
        });
        try {
          lastRecon = adapter.reconnaissance.scan();
          stats.reconScans++;
        } catch (e) { /* reconnaissance must never break reconciliation */ }
      }
      retargetObserver();
      if (dismissingQuickInput && !(obs.parts.quickInput && obs.parts.quickInput.visible)) dismissingQuickInput = false;

      const prevCaps = caps;
      caps = adapter.capabilities(obs);
      Object.keys(caps).forEach((k) => {
        if (prevCaps && prevCaps[k] && prevCaps[k] !== caps[k]) {
          diag.log(null, `capability ${k}: ${prevCaps[k]} → ${caps[k]} (OBSERVED)`, 'info');
        }
      });
      state.capabilities = caps;

      // ---- validate pending command effects (§10/§13) --------------------
      if (pending) {
        const verdict = evaluatePending(pending, obs, now);
        if (verdict.state === 'done') {
          if (pending.expect === SURFACE.EXPLORER) stats.explorerValidated = true;
          if (pending.expect === SURFACE.SEARCH) stats.searchValidated = true;
          if (pending.expect === SURFACE.SOURCE_CONTROL) stats.sourceControlValidated = true;
          if (pending.expect === SURFACE.TERMINAL) stats.terminalValidated = true;
          diag.log(null, `command effect VALIDATED: ${pending.cmd} → ${pending.expect}`, 'info');
          // Focus management (§31): opening Search focuses its input once
          // the surface transition is validated.
          if (pending.expect === SURFACE.SEARCH && state.shellMode !== SHELL_MODE.DESKTOP) {
            try { adapter.focusSearchInput(); } catch (e) { /* non-fatal */ }
          }
          pending = null;
        } else if (verdict.state === 'retry') {
          pending.retried = true;
          if (pending.expect === SURFACE.TERMINAL) adapter.dispatchKeybinding('togglePanel');
          else if (pending.expect === SURFACE.EDITOR) adapter.closePanels();
          else {
            const binding = pending.expect === SURFACE.EXPLORER ? 'openExplorer'
              : pending.expect === SURFACE.SEARCH ? 'openSearch' : 'openSourceControl';
            adapter.dispatchKeybinding(binding);
          }
          diag.log(null, `command retry via fallback mechanism: ${pending.cmd}`, 'info');
          scheduler.markDirty('retry');
        } else if (verdict.state === 'expired') {
          diag.log(verdict.code, `expected effect not observed for ${pending.cmd} → ${pending.expect}`, 'warn');
          pending = null;
        }
      }

      const prefs = prefsStore.get();
      const plan = planReconcile({ obs, state, prefs, caps, pending });
      // Only warnings reach the diagnostic log; steady-state info notes must
      // not flood it every reconciliation (§43 targets / §37 usefulness).
      plan.notes.forEach((n) => { if (n.level === 'warn' || n.level === 'error') diag.log(n.code, n.msg, n.level); });

      // ---- reduce kernel state -------------------------------------------
      const surfaceChanged = plan.activeSurface !== state.activeSurface;
      state.activeSurface = plan.activeSurface;
      state.previousSurface = plan.previousSurface;
      state.navigationStack = plan.navigationStack;
      state.shellMode = plan.shellMode;
      state.orientation = plan.orientation;
      state.immersive = plan.immersiveOn;
      if (plan.fileKey) state.lastFileKey = plan.fileKey;
      if (plan.adoptedFromApp) diag.log(null, `surface adopted from application: ${plan.activeSurface} (OBSERVED)`, 'info');
      if (plan.fileSelected) {
        diag.log(null, 'file selection observed in drawer → editor; closing drawer (§31)', 'info');
        adapter.closePanels();
        pending = { cmd: 'selectFile', expect: SURFACE.EDITOR, t0: Date.now(), retried: false };
      }

      // ---- MUTATE only after observe → decide (§24) -----------------------
      applyWrites(() => {
        applyVars(plan.vars);
        applyClassDiffs(adapter.workbench(), plan.workbenchAdd, plan.workbenchRemove);
        applyClassDiffs(shell.root, plan.rootAdd, plan.rootRemove);

        const name = plan.headerFile || '';
        if (shell.fileName.textContent !== name) shell.fileName.textContent = name;

        let surfStates = null;
        try { surfStates = adapter.getSurfaceStates(); } catch (e) { surfStates = null; }
        SURFACE_BUTTONS.forEach((def) => {
          const b = shell.buttons[def.surface];
          if (!b) return;
          const pressed = plan.pressedSurface === def.surface ||
            (def.surface === SURFACE.SETTINGS && !!state.modal);
          b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
          b.setAttribute('aria-expanded', pressed ? 'true' : 'false');
          if (def.surface === SURFACE.TERMINAL) {
            b.setAttribute('aria-disabled', plan.terminalEnabled ? 'false' : 'true');
          }
          // DEGRADED surfaces stay visible but honest (§20).
          const sst = surfStates ? surfStates[def.surface] : null;
          b.setAttribute('data-degraded', sst === SURFACE_STATE.DEGRADED ? 'true' : 'false');
        });
        if (shell.menuBtn) shell.menuBtn.setAttribute('aria-expanded', state.modal ? 'true' : 'false');
        if (shell.moreBtn) shell.moreBtn.setAttribute('aria-expanded', state.modal ? 'true' : 'false');
      });

      // ---- Android Back convergence (§34) --------------------------------
      if (FEATURES.androidBack) syncHistory(desiredHistoryStack(obs));

      stats.viewportApplied = true;
      stats.immersiveApplied = plan.immersiveOn;
      state.diagnostics.reconciliationCount++;
      state.diagnostics.warnings = diag.warnings().map((w) => ({ code: w.code, msg: w.msg }));

      if (surfaceChanged) {
        announce(`${plan.activeSurface} surface`);
        if (plan.activeSurface !== SURFACE.SETTINGS) prefsStore.set({ preferredSurface: plan.activeSurface });
      }
    } catch (err) {
      diag.log(FAIL.RECONCILIATION_FAILED, String(err && err.message || err), 'error');
      state.diagnostics.warnings = diag.warnings().map((w) => ({ code: w.code, msg: w.msg }));
    }
  }

  /* ======================== §J LIFECYCLE (§6/§27) ======================== */

  let activated = false;
  function activate() {
    if (activated) return; // idempotent (§6: boot must be safe to repeat)
    activated = true;
    state.lifecycle = LIFECYCLE.BOOTSTRAPPING;
    diag.log(null, `${NAME} v${USER_INTERFACE_VERSION} activating (adapter ${ADAPTER_VERSION})`, 'info');

    // §6 order: capabilities → classify viewport → mount shell → reconcile.
    const firstObs = adapter.observe();
    caps = adapter.capabilities(firstObs);
    state.capabilities = caps;
    state.navigationStack = createNavStack();
    if (firstObs.discovery) lastDiscovery = Object.assign({}, lastDiscovery, firstObs.discovery);
    state.diagnostics.observations++;

    // Inspection-first bootstrap (§9): one bounded reconnaissance scan proves
    // what the host exposes before any host-specific operation is attempted.
    try {
      lastRecon = adapter.reconnaissance.scan();
      stats.reconScans++;
      diag.log(null,
        `reconnaissance: buttons=${lastRecon.buttons} labelled=${lastRecon.labelledControls} candidates=${lastRecon.candidateSurfaces}`, 'info');
    } catch (e) {
      diag.log(FAIL.APPLICATION_NOT_DETECTED, 'initial reconnaissance scan failed safely; continuing', 'warn');
    }

    wireViewport();

    try {
      ensureStyle();
      // §21: never mount a second shell if one already exists (duplicate eval).
      const existing = document.getElementById(ROOT_ID);
      if (existing) {
        diag.log(FAIL.SHELL_DUPLICATION, 'a shell root already existed at mount; reusing it', 'warn');
        if (existing.parentNode) existing.parentNode.removeChild(existing);
      }
      shell = buildShell();
      shell.mount();
      stats.shellMounted = true;
      diag.log(null, 'shell mounted exactly once', 'info');
    } catch (err) {
      state.lifecycle = LIFECYCLE.FAILED;
      diag.log(FAIL.SHELL_MOUNT_FAILED, String(err && err.message || err), 'error');
      return;
    }

    wireObserver();
    wireKeyboard();
    wireHistory();
    scheduler.onReconcile(reconcile);
    reconcile(['initial']);

    state.lifecycle = caps.editor === CAP.DETECTED ? LIFECYCLE.ACTIVE : LIFECYCLE.DEGRADED;
    if (state.lifecycle === LIFECYCLE.DEGRADED) {
      diag.log(FAIL.EDITOR_NOT_DETECTED, 'workbench present but editor not detected; degraded, remaining features continue (§46/§47)', 'warn');
    }

    // Restore preferred surface if its capability was observed (§39).
    const pref = prefsStore.get().preferredSurface;
    if (pref && pref !== SURFACE.EDITOR && DRAWER_SURFACES.indexOf(pref) !== -1) {
      const capKey = pref === SURFACE.SOURCE_CONTROL ? 'sourceControl' : pref;
      if (caps[capKey] === CAP.DETECTED) {
        setTimeout(() => { if (!disposed) dispatch({ type: 'OPEN_SURFACE', surface: pref }); }, 400); // bounded one-shot
      }
    }
    if (window.__GMUX__) window.__GMUX__.lifecycle = state.lifecycle;
  }

  function start() {
    diag.log(null, `${NAME} v${USER_INTERFACE_VERSION} bootstrap starting`, 'info');
    prefsStore.load();

    const detection = adapter.detect();
    if (detection.ok) { activate(); return; }

    state.lifecycle = LIFECYCLE.WAITING_FOR_APP;
    diag.log(FAIL.APPLICATION_NOT_DETECTED, 'VS Code workbench not present yet; waiting via observer (no polling)', 'info');
    bootObserver = new MutationObserver(() => {
      if (adapter.detect().ok) {
        if (bootObserver) { bootObserver.disconnect(); bootObserver = null; }
        if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
        activate();
      }
    });
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
    // Bounded one-shot warning (§27): observation stays reactive afterwards.
    bootTimer = setTimeout(() => {
      if (state.lifecycle === LIFECYCLE.WAITING_FOR_APP) {
        state.lifecycle = LIFECYCLE.DEGRADED;
        diag.log(FAIL.UNSUPPORTED_LAYOUT, 'no VS Code workbench observed after 30s; staying reactive (§59)', 'warn');
        if (window.__GMUX__) window.__GMUX__.lifecycle = state.lifecycle;
      }
    }, 30000);
  }

  function dispose() {
    disposed = true;
    closeModal();
    // Remove our history layers so Back is never left trapped (§34/I-11).
    if (FEATURES.androidBack) {
      while (historyStack.length) { internalPops++; try { window.history.back(); } catch (e) { /* noop */ } historyStack.pop(); }
    }
    if (mo) { mo.disconnect(); mo = null; }
    if (moRoot) { try { moRoot.disconnect(); } catch (e) { /* noop */ } moRoot = null; }
    moTarget = null;
    stats.observerActive = false;
    if (bootObserver) { bootObserver.disconnect(); bootObserver = null; }
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    listeners.splice(0).forEach(([t, type, fn, opts]) => {
      try { t.removeEventListener(type, fn, opts); } catch (e) { /* noop */ }
    });
    if (shell) { shell.unmount(); shell = null; }
    stats.shellMounted = false;
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    const wb = adapter.workbench();
    if (wb) {
      ['gmux-mode-mobile', 'gmux-mode-compact', 'gmux-mode-desktop', 'gmux-immersive', 'gmux-sidebar-overlay', 'gmux-panel-overlay']
        .forEach((c) => wb.classList.remove(c));
    }
    clearVars();
    state.lifecycle = LIFECYCLE.DISABLED;
  }

  /* ============ structured inspection (insp. §11/§42) ===================== */
  // GMUX.inspect() answers the first-live-run questions (Q1–Q10) from local
  // evidence only. It returns a structured object AND logs a human-readable
  // console representation. No network transmission is permitted (§49).
  function buildInspection() {
    const p = prefsStore.get();
    let drift = [];
    let surfStates = {};
    let selectorUses = 0;
    try { drift = adapter.getDriftEvents(); } catch (e) { drift = []; }
    try { surfStates = adapter.getSurfaceStates(); } catch (e) { surfStates = {}; }
    try { selectorUses = adapter.getSelectorLog().length; } catch (e) { selectorUses = 0; }
    return {
      version: USER_INTERFACE_VERSION,
      adapter: adapter ? adapter.id : 'none',
      adapterVersion: adapter ? adapter.version : 'none',
      mode: state.shellMode,
      orientation: state.orientation,
      viewport: Object.assign({}, state.viewport),
      environment: Object.assign({}, state.environment),
      host: {
        githubDev: 'detected',
        url: (function () { try { return window.location.href; } catch (e) { return '(unknown)'; } })(),
      },
      reconnaissance: lastRecon ? {
        buttons: lastRecon.buttons,
        labelledControls: lastRecon.labelledControls,
        candidateSurfaces: lastRecon.candidateSurfaces,
        scans: stats.reconScans,
        evidence: lastRecon.evidence,
      } : { scans: stats.reconScans, evidence: [] },
      capabilities: Object.assign({}, caps),
      discovery: Object.assign({}, lastDiscovery),
      shell: {
        mounted: stats.shellMounted,
        toolbar: !!(shell && shell.toolbar),
        observer: stats.observerActive ? 'ACTIVE' : 'INACTIVE',
        observerRoot: stats.observerRoot,
        lifecycle: state.lifecycle,
      },
      surfaces: surfStates,
      state: {
        activeSurface: state.activeSurface,
        navigationStack: (state.navigationStack || []).slice(),
        immersive: p.immersive,
        keyboardVisible: state.keyboardVisible,
        modal: state.modal,
      },
      evidence: {
        observations: state.diagnostics.observations,
        reconciliations: state.diagnostics.reconciliationCount,
        selectorUses,
      },
      drift: drift.slice(),
      warnings: diag.warnings().map((w) => ({ code: w.code, msg: w.msg })),
    };
  }
  function inspectConsoleText(insp) {
    const L = [];
    const capName = (k) => ({
      editor: 'editor', explorer: 'explorer', search: 'search',
      sourceControl: 'source-control', terminal: 'terminal',
    }[k] || k);
    L.push('GitHub.dev Mobile UX');
    L.push('────────────────────');
    L.push(`Version: ${insp.version}  Adapter: ${insp.adapter}  Mode: ${insp.mode}  Orientation: ${insp.orientation}`);
    L.push(`Viewport: ${insp.viewport.width} × ${insp.viewport.height}`);
    L.push('');
    L.push(`Host   github.dev: ${insp.host.githubDev}`);
    L.push('Reconnaissance');
    L.push(`  buttons: ${insp.reconnaissance.buttons || 0}   labelled controls: ${insp.reconnaissance.labelledControls || 0}   candidate surfaces: ${insp.reconnaissance.candidateSurfaces || 0}`);
    L.push('Capabilities');
    ['editor', 'explorer', 'search', 'sourceControl', 'terminal'].forEach((k) => {
      const level = insp.discovery ? insp.discovery[k] : 0;
      L.push(`  ${capName(k).padEnd(15)} ${insp.capabilities[k] || 'UNKNOWN'}  (discovery ${level}: ${discoveryLabel(level)})`);
    });
    L.push('Shell');
    L.push(`  mounted: ${insp.shell.mounted ? 'YES' : 'NO'}   toolbar: ${insp.shell.toolbar ? 'YES' : 'NO'}   observer: ${insp.shell.observer} (${insp.shell.observerRoot})`);
    L.push('State');
    L.push(`  surface: ${insp.state.activeSurface}   navigation: ${JSON.stringify(insp.state.navigationStack)}   immersive: ${insp.state.immersive}   keyboard: ${insp.state.keyboardVisible}`);
    L.push('Evidence');
    L.push(`  observations: ${insp.evidence.observations}   reconciles: ${insp.evidence.reconciliations}   selector uses: ${insp.evidence.selectorUses}`);
    L.push(`Drift: ${insp.drift.length ? insp.drift.length + ' event(s)' : 'none'}`);
    L.push(`Warnings: ${insp.warnings.length ? '' : 'none'}`);
    insp.warnings.slice(-6).forEach((w) => L.push(`  - ${w.code ? w.code + ': ' : ''}${w.msg}`));
    return L.join('\n');
  }
  function inspect() {
    // Refresh reconnaissance on demand so inspect() answers Q1–Q10 from a
    // current bounded scan (never a steady-state scan).
    try {
      lastRecon = adapter.reconnaissance.scan();
      stats.reconScans++;
    } catch (e) { /* keep the previous snapshot */ }
    const insp = buildInspection();
    try {
      if (typeof console !== 'undefined' && console.info) console.info(inspectConsoleText(insp));
    } catch (e) { /* console unavailable — structured return still valid */ }
    return insp;
  }

  return {
    diag, state, stats, commands, prefsStore, scheduler, adapter, dispatch,
    get caps() { return caps; },
    get pending() { return pending; },
    start, dispose, activate, reconcile, buildReport, buildInspection, inspect,
    get lastRecon() { return lastRecon; },
    get lastDiscovery() { return lastDiscovery; },
    // test/debug helpers
    markDirty: (r) => scheduler.markDirty(r),
  };
}

/* ===========================================================================
 * §K BOOTSTRAP, TEARDOWN, EXPORTS
 * =========================================================================*/

function setDisabledFlag(disabled) {
  try {
    if (disabled) window.localStorage.setItem(DISABLED_FLAG_KEY, '1');
    else window.localStorage.removeItem(DISABLED_FLAG_KEY);
  } catch (e) { /* private mode — flag simply will not persist */ }
}
function getDisabledFlag() {
  try { return window.localStorage.getItem(DISABLED_FLAG_KEY) === '1'; } catch (e) { return false; }
}

function mountReviveChip() {
  if (document.querySelector('.gmux-revive')) return;
  const b = document.createElement('button');
  b.className = 'gmux-revive';
  b.setAttribute(OWNER_ATTR, OWNER_VALUE);
  b.setAttribute('aria-label', `Re-enable ${NAME} (Alt+Shift+G)`);
  b.title = `Re-enable ${NAME}`;
  // Inline styles are intentional: the namespaced stylesheet is removed
  // during teardown, and the revive affordance must still be presentable.
  b.style.cssText =
    'position:fixed;right:10px;bottom:10px;z-index:940;width:34px;height:34px;border-radius:50%;' +
    'background:#0e639c;color:#fff;display:flex;align-items:center;justify-content:center;' +
    'font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.4);border:0;cursor:pointer;' +
    'font-family:system-ui,sans-serif;padding:0;pointer-events:auto;';
  b.textContent = 'GM';
  b.addEventListener('click', () => enableShell());
  document.body.appendChild(b);
}

function disableShell(persist) {
  if (session) {
    session.diag.log(null, 'shell disabled by user; GitHub application left intact', 'info');
    session.dispose();
    session = null;
  }
  if (persist) setDisabledFlag(true);
  mountReviveChip();
  if (window.__GMUX__) window.__GMUX__.lifecycle = LIFECYCLE.DISABLED;
}

function enableShell() {
  setDisabledFlag(false);
  const chip = document.querySelector('.gmux-revive');
  if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
  bootstrap();
}

function bootstrap() {
  // §6 + §7: host verification precedes ALL DOM mutation.
  let target = TARGET.UNSUPPORTED;
  try { target = detectTarget(window.location); } catch (e) { target = TARGET.UNSUPPORTED; }
  if (target !== TARGET.SUPPORTED) {
    try { console.info(`[${NAME}] ${TARGET.UNSUPPORTED}: no shell injected (§7).`); } catch (e) { /* noop */ }
    return;
  }
  if (session) return; // safe to execute repeatedly (§6 idempotence)
  if (getDisabledFlag()) { mountReviveChip(); return; }
  try {
    session = createSession();
    session.start();
  } catch (err) {
    session = null;
    try { console.error(`[${NAME}] ${FAIL.BOOTSTRAP_FAILED}`, err); } catch (e) { /* noop */ }
  }
}

if (HAS_DOM) {
  // Duplicate-evaluation guard (e.g. script installed twice): never build a
  // second instance — §21 shell count ≤ 1, §6 idempotence.
  if (!window.__GMUX__) {
    window.__GMUX__ = {
      name: NAME,
      version: USER_INTERFACE_VERSION,
      adapterId: ADAPTER_ID,
      adapterVersion: ADAPTER_VERSION,
      preferenceSchemaVersion: PREFERENCE_SCHEMA_VERSION,
      features: Object.freeze(Object.assign({}, FEATURES)),
      lifecycle: null,
      enable: enableShell,
      disable: () => disableShell(true),
      dispatch: (action) => (session ? session.dispatch(action) : { ok: false, code: FAIL.ADAPTER_NOT_FOUND }),
      diagnostics: () => (session ? session.buildReport() : `${NAME} disabled — press Alt+Shift+G to re-enable`),
      state: () => (session ? JSON.parse(JSON.stringify(session.state)) : null),
      // local debug/test affordance — schedules one reconciliation, no network
      poke: (reason) => { if (session) session.markDirty(reason || 'poke'); },
    };

    // Inspection-first public namespace (insp. §6): exactly one global.
    // No other helper globals are created. Local evidence only (§49).
    const GMUX_API = {
      version: USER_INTERFACE_VERSION,
      inspect: () => (session ? session.inspect()
        : { version: USER_INTERFACE_VERSION, status: 'disabled', hint: 'press Alt+Shift+G to re-enable' }),
      getState: () => (session ? JSON.parse(JSON.stringify(session.state)) : null),
      getCapabilities: () => (session ? Object.assign({}, session.caps) : {}),
      reconcile: () => { if (session) session.reconcile(); },
      disable: () => disableShell(true),
    };
    try {
      globalThis.GMUX = GMUX_API;
      window.GMUX = GMUX_API;
    } catch (e) { /* non-writable global — __GMUX__ remains available */ }

    // Alt+Shift+G lives outside the session so disable is reversible.
    window.addEventListener('keydown', (ev) => {
      if (ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && (ev.code === 'KeyG' || ev.key === 'g' || ev.key === 'G')) {
        ev.preventDefault();
        if (session) disableShell(true); else enableShell();
      }
    }, true);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
      bootstrap();
    }
  }
}

/* ------------------------- test exports (Node only) ----------------------- */
const TEST_EXPORTS = {
  NAME, USER_INTERFACE_VERSION, ADAPTER_ID, ADAPTER_VERSION, PREFERENCE_SCHEMA_VERSION,
  SHELL_MODE, SURFACE, LIFECYCLE, TARGET, CAP, EVIDENCE, FSTATUS, FAIL, FEATURES,
  DEFAULT_BREAKPOINTS, PREF_DEFAULTS, ROOT_ID, OWNER_ATTR, OWNER_VALUE,
  DISCOVERY, SURFACE_STATE, ORIENTATION, LAYOUT_POLICY, SURFACE_META,
  // Adapter exists only when DOM globals are present; used by adapter-flow.mjs.
  __adapter: HAS_DOM ? GitHubDevAdapter : null,
  createDiagLog, detectTarget, createScheduler, modeForWidth, transitionFor, planBack,
  parsePreferences, createPreferenceStore, createCommandRegistry,
  classifyCapabilities, terminalHostExpectation, inferKeyboard, evaluatePending,
  planReconcile, computeFeatureStatuses,
  orientationFor, observeEnvironment, layoutModeFor,
  createNavStack, navCurrent, navPush, navPop,
  discoveryLabel, evidenceForDiscovery, reducer, sameState,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TEST_EXPORTS;
} else if (HAS_DOM) {
  try { window.__GMUX_INTERNALS__ = TEST_EXPORTS; } catch (e) { /* noop */ }
}

})();
