// ==UserScript==
// @name         GitHub.dev Mobile UX
// @namespace    https://github.com/Abdus2023/GMUX-GitHub-Mobile-UX-Runtime
// @version      0.1.0
// @description  Mobile-first, observation-driven presentation/interaction adapter for github.dev (VS Code for the Web). Dependency-free, local-first, reversible. GitHub/VS Code Web remains authoritative for repository, Git, editor and terminal state.
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
/**
 * GitHub.dev Mobile UX (GMUX) — v0.1.0
 * ---------------------------------------------------------------------------
 * Normative spec: SPEC.md in this repository ("Prompt Instructions Pack").
 *
 * Governing rules (spec §50):
 *   Observe first. Adapt second. Mutate third. Validate fourth.
 *   The userscript owns mobile interaction; GitHub owns application state.
 *
 * Single-file layout (spec §4/§5 — logical boundaries remain recognizable):
 *   §A identity & versions          §B vocabulary (enums, failure codes)
 *   §C pure kernel (no DOM, no GitHub selectors — unit tested)
 *   §D github-dev adapter           ALL GitHub/VS Code DOM knowledge lives here
 *   §E adapter stylesheet           presentation arm of the adapter (.gdmux-*)
 *   §F shell UI                     §G viewport subsystem
 *   §H input wiring                 §I reconciler (plan -> apply -> verify)
 *   §J lifecycle & observers        §K bootstrap, teardown, test exports
 *
 * Privacy (§29): no network access, no telemetry, local storage only.
 * Security (§45): never touches cookies/tokens/credentials.
 */
(function () {
'use strict';

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ===========================================================================
 * §A IDENTITY & VERSIONS (spec §42)
 * =========================================================================*/

const NAME = 'GitHub.dev Mobile UX';
const USER_INTERFACE_VERSION = '0.1.0';
const ADAPTER_VERSION = 'github-dev@1';
const PREFERENCE_SCHEMA_VERSION = 1;
const STORAGE_KEY = 'gdmux:prefs:v1';
const DISABLED_FLAG_KEY = 'gdmux:disabled';

/* ===========================================================================
 * §B VOCABULARY — modes, surfaces, lifecycle, evidence, failure codes
 * =========================================================================*/

const SHELL_MODE = Object.freeze({ DESKTOP: 'desktop', COMPACT: 'compact', MOBILE: 'mobile' });
const SURFACE = Object.freeze({
  EDITOR: 'editor', EXPLORER: 'explorer', SEARCH: 'search',
  GIT: 'git', TERMINAL: 'terminal', SETTINGS: 'settings',
});
const LIFECYCLE = Object.freeze({
  BOOTSTRAPPING: 'BOOTSTRAPPING', WAITING_FOR_APP: 'WAITING_FOR_APP',
  DETECTING: 'DETECTING', ACTIVE: 'ACTIVE', DEGRADED: 'DEGRADED',
  FAILED: 'FAILED', DISABLED: 'DISABLED',
});
// Capability states (spec §8). NOT_DETECTED must never be promoted to
// "absent" without evidence — the app may simply not have rendered it yet.
const CAP = Object.freeze({
  DETECTED: 'DETECTED', NOT_DETECTED: 'NOT_DETECTED',
  UNKNOWN: 'UNKNOWN', UNSUPPORTED: 'UNSUPPORTED',
});
// Evidence model (spec §34).
const EVIDENCE = Object.freeze({ OBSERVED: 'OBSERVED', INFERRED: 'INFERRED', VALIDATED: 'VALIDATED' });
// Feature status vocabulary (spec §35).
const FSTATUS = Object.freeze({
  VERIFIED: 'VERIFIED', PARTIALLY_VERIFIED: 'PARTIALLY_VERIFIED',
  PROVISIONAL: 'PROVISIONAL', BLOCKED: 'BLOCKED', OUT_OF_SCOPE: 'OUT_OF_SCOPE',
});
// Failure codes (spec §33). Failure must never silently become success.
const FAIL = Object.freeze({
  BOOTSTRAP_FAILED: 'BOOTSTRAP_FAILED', ADAPTER_NOT_FOUND: 'ADAPTER_NOT_FOUND',
  EDITOR_NOT_FOUND: 'EDITOR_NOT_FOUND', EXPLORER_NOT_FOUND: 'EXPLORER_NOT_FOUND',
  SEARCH_NOT_FOUND: 'SEARCH_NOT_FOUND', SOURCE_CONTROL_NOT_FOUND: 'SOURCE_CONTROL_NOT_FOUND',
  TERMINAL_NOT_FOUND: 'TERMINAL_NOT_FOUND', CAPABILITY_UNKNOWN: 'CAPABILITY_UNKNOWN',
  DOM_CHANGED: 'DOM_CHANGED', UNSUPPORTED_GITHUB_LAYOUT: 'UNSUPPORTED_GITHUB_LAYOUT',
  VIEWPORT_API_UNAVAILABLE: 'VIEWPORT_API_UNAVAILABLE', SHELL_MOUNT_FAILED: 'SHELL_MOUNT_FAILED',
  PREFERENCE_PARSE_FAILED: 'PREFERENCE_PARSE_FAILED', COMMAND_FAILED: 'COMMAND_FAILED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED', UNEXPECTED_TRANSITION: 'UNEXPECTED_TRANSITION',
});

// Default breakpoints (spec §3): defaults, not immutable assumptions.
const DEFAULT_BREAKPOINTS = Object.freeze({ compactMin: 600, desktopMin: 1024 });

/* ===========================================================================
 * §C PURE KERNEL
 * Dependency-free, DOM-free, GitHub-selector-free. Unit tested by
 * tests/run-tests.mjs. The kernel consumes normalized observations produced
 * by the adapter (spec §6/§41) and never queries GitHub DOM itself.
 * =========================================================================*/

/* --------------------------- diagnostics log ---------------------------- */

function createDiagLog(max = 60) {
  const entries = [];
  return {
    log(code, msg, level = 'info') {
      entries.push({ ts: Date.now(), code: code || null, msg: String(msg || ''), level });
      if (entries.length > max) entries.splice(0, entries.length - max);
    },
    entries() { return entries.slice(); },
    clear() { entries.length = 0; },
  };
}

/* ------------------------------ scheduler ------------------------------- */
// Spec §11/§31: mutation/resize/route signals -> markDirty -> one rAF ->
// exactly one reconciliation per frame. No polling loops anywhere (spec §10).

function createScheduler(env) {
  const raf = (env && env.requestAnimationFrame) ||
    ((fn) => setTimeout(() => fn(Date.now()), 16));
  let queued = false;
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
        const rs = Array.from(reasons);
        reasons.clear();
        if (handler) handler(rs);
      });
    },
    pending() { return queued; },
  };
}

/* ------------------------------ mode detect ----------------------------- */
// Spec §3: viewport checks are centralized here only.

function modeForWidth(width, breakpoints = DEFAULT_BREAKPOINTS, override = 'auto') {
  if (override && override !== 'auto' && SHELL_MODE[override.toUpperCase()]) {
    return SHELL_MODE[override.toUpperCase()];
  }
  const w = Number(width) || 0;
  if (w > breakpoints.desktopMin) return SHELL_MODE.DESKTOP;
  if (w >= breakpoints.compactMin) return SHELL_MODE.COMPACT;
  return SHELL_MODE.MOBILE;
}

/* ---------------------------- state transitions -------------------------- */
// Spec §14 minimum transition set. Anything else is diagnosable.

const TRANSITIONS = Object.freeze({
  editor: Object.freeze({
    openExplorer: SURFACE.EXPLORER, openSearch: SURFACE.SEARCH,
    openGit: SURFACE.GIT, openTerminal: SURFACE.TERMINAL, openSettings: SURFACE.SETTINGS,
  }),
  explorer: Object.freeze({ selectFile: SURFACE.EDITOR }),
  search: Object.freeze({ selectResult: SURFACE.EDITOR }),
  git: Object.freeze({}),
  terminal: Object.freeze({}),
  settings: Object.freeze({}),
});

function transitionFor(state, action) {
  const current = state.activeSurface;
  if (action === 'close') {
    if (current === SURFACE.EDITOR || current === SURFACE.SETTINGS) {
      return { ok: false, code: FAIL.UNEXPECTED_TRANSITION, reason: `close ignored on ${current}` };
    }
    return { ok: true, to: state.previousSurface && state.previousSurface !== current
      ? state.previousSurface : SURFACE.EDITOR };
  }
  const row = TRANSITIONS[current] || {};
  const to = row && row[action];
  if (!to) {
    return { ok: false, code: FAIL.UNEXPECTED_TRANSITION, reason: `no transition ${current}+${action}` };
  }
  return { ok: true, to };
}

/* ------------------------------ preferences ----------------------------- */
// Spec §28: versioned schema, tolerant of malformed data, never blocks boot.

const PREF_DEFAULTS = Object.freeze({
  version: PREFERENCE_SCHEMA_VERSION,
  mode: 'auto',
  immersive: true,
  preferredSurface: SURFACE.EDITOR,
  gestures: true,
  bottomBar: true,
  terminalFullscreen: true,
});

function parsePreferences(raw) {
  const notes = [];
  if (raw == null || raw === '') {
    return { prefs: Object.assign({}, PREF_DEFAULTS), notes };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    notes.push({ code: FAIL.PREFERENCE_PARSE_FAILED, msg: 'preferences JSON invalid; using defaults' });
    return { prefs: Object.assign({}, PREF_DEFAULTS), notes };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    notes.push({ code: FAIL.PREFERENCE_PARSE_FAILED, msg: 'preferences not an object; using defaults' });
    return { prefs: Object.assign({}, PREF_DEFAULTS), notes };
  }
  if (data.version !== PREFERENCE_SCHEMA_VERSION) {
    notes.push({ code: FAIL.PREFERENCE_PARSE_FAILED, msg: `unknown preference schema version ${String(data.version)}; using defaults` });
    return { prefs: Object.assign({}, PREF_DEFAULTS), notes };
  }
  const prefs = Object.assign({}, PREF_DEFAULTS);
  const surfaces = Object.values(SURFACE);
  if (typeof data.mode === 'string' && ['auto', 'mobile', 'compact', 'desktop'].indexOf(data.mode) !== -1) prefs.mode = data.mode;
  if (typeof data.immersive === 'boolean') prefs.immersive = data.immersive;
  if (typeof data.preferredSurface === 'string' && surfaces.indexOf(data.preferredSurface) !== -1) prefs.preferredSurface = data.preferredSurface;
  if (typeof data.gestures === 'boolean') prefs.gestures = data.gestures;
  if (typeof data.bottomBar === 'boolean') prefs.bottomBar = data.bottomBar;
  if (typeof data.terminalFullscreen === 'boolean') prefs.terminalFullscreen = data.terminalFullscreen;
  return { prefs, notes };
}

function createPreferenceStore(env, diag) {
  const storage = (env && env.storage) || null;
  let prefs = Object.assign({}, PREF_DEFAULTS);
  function load() {
    let raw = null;
    if (storage) {
      try { raw = storage.getItem(STORAGE_KEY); }
      catch (e) { diag && diag.log(FAIL.PREFERENCE_PARSE_FAILED, 'storage read failed; using defaults', 'warn'); }
    }
    const parsed = parsePreferences(raw);
    prefs = parsed.prefs;
    parsed.notes.forEach((n) => diag && diag.log(n.code, n.msg, 'warn'));
    return prefs;
  }
  function get() { return Object.assign({}, prefs); }
  function set(patch) {
    prefs = Object.assign({}, prefs, patch, { version: PREFERENCE_SCHEMA_VERSION });
    if (storage) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(prefs)); }
      catch (e) { diag && diag.log(FAIL.PREFERENCE_PARSE_FAILED, 'storage write failed (non-fatal)', 'warn'); }
    }
    return get();
  }
  function reset() {
    prefs = Object.assign({}, PREF_DEFAULTS);
    if (storage) {
      try { storage.removeItem(STORAGE_KEY); } catch (e) { /* non-fatal */ }
    }
    return get();
  }
  return { load, get, set, reset };
}

/* ---------------------------- command registry --------------------------- */
// Spec §15: every input source (toolbar / gesture / keyboard / accessibility)
// converges on commands; no per-input navigation logic.

function createCommandRegistry(diag) {
  const commands = new Map();
  return {
    register(id, fn, meta = {}) {
      commands.set(id, { fn, meta });
    },
    ids() { return Array.from(commands.keys()); },
    execute(id, payload) {
      const entry = commands.get(id);
      if (!entry) {
        diag && diag.log(FAIL.COMMAND_FAILED, `command not registered: ${id}`, 'error');
        return { ok: false, code: FAIL.COMMAND_FAILED, error: 'not registered' };
      }
      try {
        const result = entry.fn(payload);
        return (result && typeof result === 'object' && 'ok' in result) ? result : { ok: true, result };
      } catch (error) {
        diag && diag.log(FAIL.COMMAND_FAILED, `command threw: ${id}: ${error && error.message}`, 'error');
        return { ok: false, code: FAIL.COMMAND_FAILED, error };
      }
    },
  };
}

/* ------------------------- capability classification --------------------- */
// Spec §8: adapter exposes capability states; never fabricate capability.

function classifyCapabilities(obs) {
  const caps = {};
  const wb = !!(obs && obs.workbench && obs.workbench.present);
  caps.editor = wb ? (obs.editor && obs.editor.present ? CAP.DETECTED : CAP.NOT_DETECTED) : CAP.UNKNOWN;
  caps.explorer = wb ? (obs.views && obs.views.explorer && obs.views.explorer.present ? CAP.DETECTED : CAP.NOT_DETECTED) : CAP.UNKNOWN;
  caps.search = wb ? (obs.views && obs.views.search && obs.views.search.present ? CAP.DETECTED : CAP.NOT_DETECTED) : CAP.UNKNOWN;
  caps.sourceControl = wb ? (obs.views && obs.views.scm && obs.views.scm.present ? CAP.DETECTED : CAP.NOT_DETECTED) : CAP.UNKNOWN;
  caps.terminal = wb
    ? (obs.terminal && obs.terminal.present
      ? CAP.DETECTED
      : (obs.terminal && obs.terminal.hostExpectation === 'likely-unsupported' ? CAP.UNSUPPORTED : CAP.NOT_DETECTED))
    : CAP.UNKNOWN;
  return caps;
}

// Spec §8/§20: NOT_DETECTED must not be converted to ABSENT without evidence.
// github.dev/vscode.dev (no remote) do not ship an integrated terminal as of
// the evidence date (docs/dom-evidence.md); that is an INFERENCE, not proof.
function terminalHostExpectation(hostname) {
  if (typeof hostname !== 'string' || !hostname) return 'unknown';
  return /(^|\.)(github\.dev|vscode\.dev)$/.test(hostname) ? 'likely-unsupported' : 'unknown';
}

/* --------------------------- keyboard inference --------------------------- */
// Spec §25: infer keyboard from significant visual-viewport reduction.
// The result is always evidence-level INFERRED unless stronger validation
// exists (no browser-independent strong evidence exists on the web).

function inferKeyboard(sample) {
  if (!sample || !sample.vvAvailable || !sample.vvHeight || !sample.layoutHeight) {
    return { visible: false, evidence: 'UNKNOWN' };
  }
  const ratio = sample.vvHeight / sample.layoutHeight;
  if (ratio <= 0.75 && sample.vvWidth / (sample.layoutWidth || sample.vvWidth) >= 0.9) {
    return { visible: true, evidence: EVIDENCE.INFERRED };
  }
  return { visible: false, evidence: EVIDENCE.INFERRED };
}

/* ----------------------------- gesture engine ----------------------------- */
// Spec §23: conservative, controlled zones only, NO ACTION when unsure.
// Pure classifier — wiring (protected-zone checks) lives in §H.

function classifyGesture(track, cfg = {}) {
  if (!track || track.points < 2) return null;
  const edge = cfg.edgeSize != null ? cfg.edgeSize : 24;
  const minDistance = cfg.minDistance != null ? cfg.minDistance : 56;
  const maxDuration = cfg.maxDuration != null ? cfg.maxDuration : 650;
  const dominance = cfg.dominance != null ? cfg.dominance : 1.4;
  const dx = track.x1 - track.x0;
  const dy = track.y1 - track.y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const distance = Math.max(adx, ady);
  if (distance < minDistance) return null; // NO ACTION: insufficient travel
  if (track.duration > maxDuration) return null; // NO ACTION: too slow (scroll intent)
  if (adx > 0 && ady > 0 && Math.max(adx, ady) / Math.min(adx, ady) < dominance) {
    return null; // NO ACTION: diagonal — insufficient confidence
  }
  const start = { x: track.x0, y: track.y0, w: track.vw || 0, h: track.vh || 0 };
  if (adx >= ady) {
    if (dx > 0 && start.x <= edge) return { action: 'open-explorer', confidence: 'edge-swipe' };
    if (dx < 0 && start.w - start.x <= edge) return { action: 'close-surface', confidence: 'edge-swipe' };
    return null; // horizontal swipe not from an edge: NO ACTION
  }
  if (dy < 0 && start.h - start.y <= edge) return { action: 'open-terminal', confidence: 'edge-swipe' };
  if (dy > 0 && start.y <= edge) return { action: 'close-surface', confidence: 'edge-swipe' };
  return null; // vertical swipe not from an edge: NO ACTION
}

/* ---------------------------- reconcile planner --------------------------- */
// Spec §7/§31: OBSERVE -> CAPABILITY MAP -> STATE REDUCTION -> DECISION.
// Pure function: (observation, kernel state, preferences) -> decision plan.
// MUTATION happens later, in §I, through the adapter/shell only.

function planReconcile(input) {
  const obs = input.obs || {};
  const st = input.state || {};
  const prefs = input.prefs || PREF_DEFAULTS;
  const caps = input.caps || {};
  const notes = [];

  const width = st.viewport ? st.viewport.width : 0;
  const shellMode = modeForWidth(width, DEFAULT_BREAKPOINTS, prefs.mode);
  const isMobile = shellMode === SHELL_MODE.MOBILE;
  const immersiveOn = !!(prefs.immersive && isMobile);

  // ----- surface adoption: DOM state is evidence, kernel state is control --
  let activeSurface = st.activeSurface || SURFACE.EDITOR;
  let previousSurface = st.previousSurface || null;
  let adoptedFromApp = false;
  let fileSelected = false;
  const appSurface = obs.appSurface || null;

  const fileKey = obs.editor && obs.editor.activeFile
    ? (obs.editor.activeFile.uri || obs.editor.activeFile.name || '') : '';
  const fileChanged = !!fileKey && fileKey !== (st.lastFileKey || '');

  if (!input.pending) {
    if (fileChanged && (activeSurface === SURFACE.EXPLORER || activeSurface === SURFACE.SEARCH) && isMobile) {
      // Spec §14: EXPLORER selectFile -> EDITOR ; SEARCH selectResult -> EDITOR.
      fileSelected = true;
      previousSurface = activeSurface;
      activeSurface = SURFACE.EDITOR;
    } else if (appSurface && appSurface !== activeSurface && appSurface !== SURFACE.SETTINGS) {
      // The application moved without us (route change, native shortcut,
      // user clicked an activity item): adopt observed state (spec §40).
      previousSurface = activeSurface;
      activeSurface = appSurface;
      adoptedFromApp = true;
    }
  }

  // ----- shell chrome decisions -------------------------------------------
  const quickInputVisible = !!(obs.quickInput && obs.quickInput.visible);
  const shellMinimized = quickInputVisible; // let VS Code quick input own the screen

  const titlebarH = obs.measured && obs.measured.titlebarH > 0 ? Math.max(obs.measured.titlebarH, 40) : 44;
  const footerH = 52;
  const headerH = isMobile ? titlebarH : 0;
  const bottomBarShown = !!(prefs.bottomBar && shellMode !== SHELL_MODE.DESKTOP);
  const statusbarH = obs.measured && obs.measured.statusbarH > 0 ? Math.min(obs.measured.statusbarH, 30) : 0;
  const shellBottom = bottomBarShown ? footerH : statusbarH;

  const vvH = (st.viewport && st.viewport.height) || 0;
  const usable = Math.max(vvH - headerH - shellBottom, 120);
  const panelH = prefs.terminalFullscreen ? usable : Math.round(usable * 0.55);

  const vars = {
    '--gdmux-vv-offset': `${(st.viewport && st.viewport.offsetTop) || 0}px`,
    '--gdmux-vv-height': `${vvH || '100vh'}`,
    '--gdmux-header-h': `${headerH}px`,
    '--gdmux-footer-h': `${footerH}px`,
    '--gdmux-shell-top': `${headerH}px`,
    '--gdmux-shell-bottom': `${shellBottom}px`,
    '--gdmux-panel-h': `${panelH}px`,
  };

  // ----- workbench class decisions ----------------------------------------
  const workbenchAdd = [];
  const workbenchRemove = ['gdmux-mode-mobile', 'gdmux-mode-compact', 'gdmux-mode-desktop', 'gdmux-immersive'];
  workbenchAdd.push(`gdmux-mode-${shellMode}`);
  if (immersiveOn) workbenchAdd.push('gdmux-immersive');

  const sidebarSurface = [SURFACE.EXPLORER, SURFACE.SEARCH, SURFACE.GIT].indexOf(activeSurface) !== -1;
  const terminalActive = activeSurface === SURFACE.TERMINAL;

  if (isMobile && sidebarSurface && !shellMinimized) workbenchAdd.push('gdmux-sidebar-overlay');
  if (isMobile && terminalActive && !shellMinimized) workbenchAdd.push('gdmux-panel-overlay');

  const rootAdd = [];
  const rootRemove = ['gdmux-shell-minimized', 'gdmux-no-footer', 'gdmux-no-header'];
  if (shellMinimized) rootAdd.push('gdmux-shell-minimized');
  if (!bottomBarShown) rootAdd.push('gdmux-no-footer');
  if (!isMobile) rootAdd.push('gdmux-no-header');

  // ----- toolbar state ------------------------------------------------------
  const terminalEnabled = caps.terminal === CAP.DETECTED;
  const pressedSurface = sidebarSurface || terminalActive ? activeSurface : null;
  if (!terminalEnabled) {
    notes.push({ code: FAIL.TERMINAL_NOT_FOUND, level: 'info', msg: 'terminal capability ' + (caps.terminal || CAP.UNKNOWN) + ' — toolbar does not advertise it (spec §20)' });
  }

  const headerFile = obs.editor && obs.editor.activeFile ? (obs.editor.activeFile.name || null) : null;

  return {
    shellMode, immersiveOn, activeSurface, previousSurface,
    adoptedFromApp, fileSelected, fileKey,
    shellMinimized, headerFile, terminalEnabled, pressedSurface, bottomBarShown,
    workbenchAdd, workbenchRemove, rootAdd, rootRemove, vars, notes,
  };
}

/* --------------------------- feature status map --------------------------- */
// Spec §35/§36: statuses are evidence-based. NO EVIDENCE -> NO VERIFIED CLAIM.

function computeFeatureStatuses(ctx) {
  const caps = ctx.caps || {};
  const stats = ctx.stats || {};
  const vvUsed = !!ctx.vvUsed;
  const s = (detected, validated, blockedReason) => {
    if (blockedReason) return { status: FSTATUS.BLOCKED, basis: blockedReason };
    if (validated) return { status: FSTATUS.VERIFIED, basis: 'validated in this session' };
    if (detected) return { status: FSTATUS.PARTIALLY_VERIFIED, basis: 'detected, not yet validated' };
    return { status: FSTATUS.PROVISIONAL, basis: 'awaiting evidence' };
  };
  return [
    ['Mobile viewport detection', vvUsed
      ? { status: stats.viewportApplied ? FSTATUS.VERIFIED : FSTATUS.PARTIALLY_VERIFIED, basis: vvUsed === 'visualViewport' ? 'visualViewport observed' : 'window resize fallback (visualViewport unavailable)' }
      : { status: FSTATUS.PROVISIONAL, basis: 'no viewport sample yet' }],
    ['Editor immersive mode', s(true, !!stats.immersiveApplied, null)],
    ['Explorer drawer', s(caps.explorer === CAP.DETECTED, !!stats.explorerValidated, caps.explorer === CAP.DETECTED ? null : 'explorer ' + (caps.explorer || CAP.UNKNOWN))],
    ['Search surface', s(caps.search === CAP.DETECTED, !!stats.searchValidated, caps.search === CAP.DETECTED ? null : 'search ' + (caps.search || CAP.UNKNOWN))],
    ['Source Control surface', caps.sourceControl === CAP.DETECTED
      ? { status: FSTATUS.PARTIALLY_VERIFIED, basis: 'surface repositions the existing SCM view; Git state stays with GitHub (spec §19)' }
      : { status: FSTATUS.BLOCKED, basis: 'source control ' + (caps.sourceControl || CAP.UNKNOWN) }],
    ['Terminal surface', caps.terminal === CAP.DETECTED
      ? { status: FSTATUS.PARTIALLY_VERIFIED, basis: 'terminal detected; fullscreen overlay pending validation' }
      : { status: FSTATUS.BLOCKED, basis: 'terminal ' + (caps.terminal || CAP.UNKNOWN) + (ctx.terminalNote ? ` (${ctx.terminalNote})` : '') }],
    ['Gesture navigation', { status: FSTATUS.PROVISIONAL, basis: 'conservative edge swipes only; never over the editor (spec §23)' }],
    ['Git operations', { status: FSTATUS.OUT_OF_SCOPE, basis: 'GitHub/VS Code remains authoritative (spec §2, §19, §46)' }],
    ['Unknown future GitHub DOM', { status: FSTATUS.BLOCKED, basis: 'no evidence for layouts not yet observed (spec §43)' }],
  ];
}

/* ===========================================================================
 * §D GITHUB-DEV ADAPTER
 * ---------------------------------------------------------------------------
 * ALL GitHub/VS Code DOM knowledge is isolated here (spec §6, §9, §41).
 * The kernel above contains zero GitHub selectors.
 *
 * Selector preference (spec §9): semantic attributes > ARIA labels > stable
 * IDs > stable relationships > structural > class names. Generated classes
 * are a last resort (none are used in v0.1).
 *
 * Evidence base for the targets below: docs/dom-evidence.md (observed
 * 2026-09-15 against github.dev -> vscode.dev and microsoft/vscode sources).
 * =========================================================================*/

const GitHubDevAdapter = HAS_DOM ? (function createAdapter() {
  // --- stable structural targets -----------------------------------------
  const WB = '.monaco-workbench';
  const PARTS = {
    titlebar: '.part.titlebar',
    activitybar: '.part.activitybar',
    sidebar: '.part.sidebar',
    editor: '.part.editor',
    panel: '.part.panel',
    statusbar: '.part.statusbar',
  };
  // View containers (stable semantic IDs, spec §9 rank 3).
  const VIEW_IDS = { explorer: 'workbench.view.explorer', search: 'workbench.view.search', scm: 'workbench.view.scm' };
  const VIEW_LABELS = { explorer: ['explorer'], search: ['search'], scm: ['source control'] };
  const VIEW_CONTENT = {
    explorer: '.explorer-folders-view, .explorer-view',
    search: '.search-view',
    scm: '.scm-view',
  };
  // Synthetic keybindings (fallback/secondary mechanisms). KeyCode values are
  // the legacy DOM keyCode constants VS Code's keybinding service understands.
  const KEYBINDINGS = {
    openExplorer: { code: 'KeyE', key: 'E', keyCode: 69, ctrl: true, shift: true },
    openSearch: { code: 'KeyF', key: 'F', keyCode: 70, ctrl: true, shift: true },
    openGit: { code: 'KeyG', key: 'G', keyCode: 71, ctrl: true, shift: true },
    toggleTerminal: { code: 'Backquote', key: '`', keyCode: 192, ctrl: true },
    toggleSidebar: { code: 'KeyB', key: 'B', keyCode: 66, ctrl: true },
    togglePanel: { code: 'KeyJ', key: 'J', keyCode: 74, ctrl: true },
    commandPalette: { code: 'KeyP', key: 'P', keyCode: 80, ctrl: true, shift: true },
    quickOpen: { code: 'KeyP', key: 'P', keyCode: 80, ctrl: true },
    openSettings: { code: 'Comma', key: ',', keyCode: 188, ctrl: true },
  };

  function qs(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function qsa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  function workbench() { return qs(WB); }
  function isPresent() { return !!workbench(); }

  // Find an activity-bar action for a view container. Preference order:
  // stable ID -> aria-label (accessible name) -> title attribute.
  function findActivityAction(viewKey) {
    const bar = qs(PARTS.activitybar);
    if (!bar) return null;
    const id = VIEW_IDS[viewKey];
    if (id) {
      const byId = bar.querySelector(`[id="${id}"]`);
      if (byId) {
        const label = byId.matches('.action-label') ? byId : byId.querySelector('.action-label');
        if (label) return label;
        if (byId.classList && byId.classList.contains('action-item')) return byId;
        return byId;
      }
    }
    const prefixes = VIEW_LABELS[viewKey] || [];
    const candidates = qsa('.action-label', bar);
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const title = (el.getAttribute('title') || '').toLowerCase();
      for (let p = 0; p < prefixes.length; p++) {
        if (aria.indexOf(prefixes[p]) === 0 || title.indexOf(prefixes[p]) === 0) return el;
      }
    }
    return null;
  }

  function clickElement(el) {
    if (!el) return false;
    try { el.click(); return true; } catch (e) { return false; }
  }

  // Dispatch a synthetic keybinding to the window. VS Code Web's keybinding
  // service listens at window level. Evidence level: INFERRED until the
  // expected effect is observed (§34) — the reconciler validates effects.
  function dispatchKeybinding(name) {
    const b = KEYBINDINGS[name];
    if (!b) return false;
    let useMeta = false;
    try { useMeta = /mac/i.test((navigator.platform || '') + ' ' + navigator.userAgent) && b.ctrl; } catch (e) { /* noop */ }
    function make(type) {
      const init = {
        code: b.code, key: b.key, bubbles: true, cancelable: true,
        ctrlKey: !!b.ctrl && !useMeta, metaKey: useMeta, shiftKey: !!b.shift, altKey: false,
      };
      let ev;
      try {
        init.keyCode = b.keyCode; init.which = b.keyCode;
        ev = new window.KeyboardEvent(type, init);
      } catch (e) {
        delete init.keyCode; delete init.which;
        ev = new window.KeyboardEvent(type, init);
      }
      return ev;
    }
    try {
      window.dispatchEvent(make('keydown'));
      window.dispatchEvent(make('keyup'));
      return true;
    } catch (e) { return false; }
  }

  // Which sidebar view is currently rendered (content-based, not label-based).
  function sidebarActiveViewKey() {
    const sb = qs(PARTS.sidebar);
    if (!sb) return null;
    for (const key of Object.keys(VIEW_CONTENT)) {
      if (qs(VIEW_CONTENT[key], sb)) return key;
    }
    return null;
  }

  function readActiveFile() {
    // 1) semantic attribute: Monaco exposes data-uri on editor nodes (OBSERVED).
    let uri = null;
    const ed = qs('.monaco-editor[data-uri]');
    if (ed) uri = ed.getAttribute('data-uri');
    // 2) active tab label (stable structural relationship).
    let name = null;
    const tab = qs('.part.editor .tab.active .label-name, .part.editor .tab.active');
    if (tab) name = (tab.textContent || '').trim();
    // 3) breadcrumb tail fallback.
    if (!name) {
      const crumbs = qsa('.monaco-breadcrumbs .monaco-breadcrumb-item');
      if (crumbs.length) name = ((crumbs[crumbs.length - 1].getAttribute('title')) || crumbs[crumbs.length - 1].textContent || '').trim();
    }
    if (!name && uri) {
      try { name = decodeURIComponent(uri.split(/[\\/]/).pop() || ''); } catch (e) { name = uri.split(/[\\/]/).pop() || ''; }
    }
    if (!name && !uri) return null;
    return {
      name: name || null,
      uri: uri || null,
      evidence: uri ? EVIDENCE.OBSERVED : EVIDENCE.INFERRED,
    };
  }

  function observe() {
    const wb = workbench();
    const obs = {
      workbench: { present: !!wb, sidebarHidden: false, panelHidden: false, fullscreen: false },
      parts: {
        titlebar: { present: false, visible: false }, activitybar: { present: false },
        sidebar: { present: false, visible: false }, editor: { present: false },
        panel: { present: false, visible: false }, statusbar: { present: false },
      },
      editor: { present: false, activeFile: null },
      views: {
        explorer: { present: false }, search: { present: false }, scm: { present: false },
        sidebarActiveView: null,
      },
      terminal: { present: false, visible: false, hostExpectation: terminalHostExpectation(location.hostname) },
      quickInput: { visible: false },
      measured: { titlebarH: 0, statusbarH: 0 },
      appSurface: null,
    };
    if (!wb) return obs;
    const cls = wb.classList;
    obs.workbench.sidebarHidden = cls.contains('nosidebar');
    obs.workbench.panelHidden = cls.contains('nopanel');
    obs.workbench.fullscreen = cls.contains('fullscreen');

    const titlebar = qs(PARTS.titlebar, wb);
    obs.parts.titlebar.present = !!titlebar;
    obs.parts.titlebar.visible = isVisible(titlebar);
    obs.measured.titlebarH = titlebar ? titlebar.offsetHeight : 0;
    obs.parts.activitybar.present = !!qs(PARTS.activitybar, wb);
    const sidebar = qs(PARTS.sidebar, wb);
    obs.parts.sidebar.present = !!sidebar;
    obs.parts.sidebar.visible = !!sidebar && !obs.workbench.sidebarHidden && isVisible(sidebar);
    obs.parts.editor.present = !!qs(PARTS.editor, wb);
    const panel = qs(PARTS.panel, wb);
    obs.parts.panel.present = !!panel;
    obs.parts.panel.visible = !!panel && !obs.workbench.panelHidden && isVisible(panel);
    const statusbar = qs(PARTS.statusbar, wb);
    obs.parts.statusbar.present = !!statusbar;
    obs.measured.statusbarH = statusbar ? statusbar.offsetHeight : 0;

    obs.editor.present = !!qs('.monaco-editor', wb);
    obs.editor.activeFile = obs.editor.present ? readActiveFile() : null;
    obs.views.explorer.present = !!qs(VIEW_CONTENT.explorer, wb);
    obs.views.search.present = !!qs(VIEW_CONTENT.search, wb);
    obs.views.scm.present = !!qs(VIEW_CONTENT.scm, wb);
    if (obs.parts.sidebar.visible) obs.views.sidebarActiveView = sidebarActiveViewKey();

    // xterm.js root class is the terminal renderer VS Code Web embeds.
    const xterm = qs('.xterm', wb);
    obs.terminal.present = !!xterm || !!qs('.part.panel .terminal-outer-container', wb);
    obs.terminal.visible = obs.parts.panel.visible && !!xterm && isVisible(xterm);

    const qi = qs('.quick-input-widget', wb);
    obs.quickInput.visible = !!qi && !qi.classList.contains('hidden') && isVisible(qi);

    // ----- derive app-side surface evidence (spec §7, §40) ----------------
    if (obs.quickInput.visible) {
      obs.appSurface = null; // transient overlay — kernel keeps its state
    } else if (obs.terminal.visible) {
      obs.appSurface = SURFACE.TERMINAL;
    } else if (obs.parts.sidebar.visible && obs.views.sidebarActiveView) {
      obs.appSurface = obs.views.sidebarActiveView === 'scm' ? SURFACE.GIT : obs.views.sidebarActiveView;
    } else if (obs.editor.present) {
      obs.appSurface = SURFACE.EDITOR;
    }
    return obs;
  }

  function capabilities(obs) { return classifyCapabilities(obs || observe()); }

  // ----- surface actions (return {ok, mechanism}) --------------------------

  function openSidebarView(viewKey) {
    const action = findActivityAction(viewKey);
    if (action) {
      // If the view already shows in a visible sidebar we are done.
      const o = observe();
      if (o.parts.sidebar.visible && o.views.sidebarActiveView === viewKey) {
        return { ok: true, mechanism: 'already-open' };
      }
      if (clickElement(action)) return { ok: true, mechanism: 'activity-click' };
    }
    const binding = viewKey === 'explorer' ? 'openExplorer' : viewKey === 'search' ? 'openSearch' : 'openGit';
    if (dispatchKeybinding(binding)) return { ok: true, mechanism: 'keybinding' };
    return { ok: false, mechanism: 'none' };
  }

  function closeSidebar() {
    // Clicking the active activity item toggles the sidebar off.
    const viewKey = sidebarActiveViewKey() || 'explorer';
    const action = findActivityAction(viewKey);
    if (action && clickElement(action)) return { ok: true, mechanism: 'activity-click' };
    if (dispatchKeybinding('toggleSidebar')) return { ok: true, mechanism: 'keybinding' };
    return { ok: false, mechanism: 'none' };
  }

  function openTerminal() {
    if (dispatchKeybinding('toggleTerminal')) return { ok: true, mechanism: 'keybinding' };
    return { ok: false, mechanism: 'none' };
  }

  function closePanel() {
    if (dispatchKeybinding('togglePanel')) return { ok: true, mechanism: 'keybinding' };
    return { ok: false, mechanism: 'none' };
  }

  function focusEditor() {
    // Monaco's hidden input is the sanctioned keyboard focus target; we never
    // synthesize clicks inside the editor (spec §22 Monaco protection).
    const ta = qs('.monaco-editor textarea.inputarea, .monaco-editor textarea');
    if (ta) {
      try { ta.focus({ preventScroll: true }); } catch (e) { try { ta.focus(); } catch (e2) { /* noop */ } }
      const focused = document.activeElement && ta.contains
        ? (ta === document.activeElement || ta.contains(document.activeElement))
        : document.activeElement === ta;
      return { ok: focused, mechanism: 'textarea-focus', evidence: focused ? EVIDENCE.VALIDATED : EVIDENCE.INFERRED };
    }
    return { ok: false, mechanism: 'none' };
  }

  function getActiveFile() { return readActiveFile(); }

  return {
    name: 'github-dev',
    version: ADAPTER_VERSION,
    isPresent, workbench, observe, capabilities,
    openSidebarView, closeSidebar, openTerminal, closePanel,
    focusEditor, getActiveFile, dispatchKeybinding, findActivityAction,
  };
})() : null;

/* ===========================================================================
 * §E ADAPTER STYLESHEET — presentation arm of the adapter.
 * ---------------------------------------------------------------------------
 * Spec §26: everything is namespaced (.gdmux-* / #gdmux-root); no broad
 * element rules. The few rules touching VS Code parts are scoped under
 * gdmux-* state classes the userscript itself toggles.
 * Spec §27: controlled z-index ladder: base 900 < surface 910 < drawer 920 <
 * modal 930 < shell 940 < diagnostic 950. No escalation wars.
 * =========================================================================*/

const STYLE_ID = 'gdmux-style';
const CSS_TEXT = [
  '/* GMUX shell chrome */',
  '#gdmux-root{position:fixed;inset:0;pointer-events:none;z-index:940;',
  ' font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.3;',
  ' color:var(--vscode-foreground,#cccccc);}',
  '#gdmux-root button{pointer-events:auto;font:inherit;color:inherit;background:transparent;border:0;padding:0;cursor:pointer;}',
  '#gdmux-root .gdmux-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}',

  '.gdmux-header{position:absolute;left:0;right:0;top:var(--gdmux-vv-offset,0px);height:var(--gdmux-header-h,44px);',
  ' display:flex;align-items:center;gap:2px;padding:0 2px;pointer-events:auto;',
  ' background:var(--vscode-titleBar-activeBackground,var(--vscode-sideBar-background,#252526));',
  ' border-bottom:1px solid var(--vscode-titleBar-activeBorder,rgba(128,128,128,.2));transition:transform .15s ease;}',
  '.gdmux-icon-btn{flex:0 0 auto;width:42px;height:38px;font-size:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;}',
  '.gdmux-header-file{flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:center;height:38px;padding:0 6px;border-radius:6px;font-size:13px;}',
  '.gdmux-header-file .gdmux-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
  '.gdmux-icon-btn:hover,.gdmux-header-file:hover{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));}',
  '.gdmux-icon-btn:focus-visible,.gdmux-toolbar button:focus-visible,.gdmux-modal button:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:-2px;}',

  '.gdmux-toolbar{position:absolute;left:0;right:0;',
  ' top:calc(var(--gdmux-vv-offset,0px) + var(--gdmux-vv-height,100vh) - var(--gdmux-footer-h,52px));',
  ' height:var(--gdmux-footer-h,52px);display:flex;pointer-events:auto;',
  ' background:var(--vscode-statusBar-background,var(--vscode-sideBar-background,#252526));',
  ' border-top:1px solid var(--vscode-statusBar-border,rgba(128,128,128,.2));transition:transform .15s ease;}',
  '.gdmux-toolbar button{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:19px;position:relative;',
  ' color:var(--vscode-statusBar-foreground,var(--vscode-foreground,#cccccc));}',
  '.gdmux-toolbar button .gdmux-btn-label{font-size:10px;opacity:.85;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.gdmux-toolbar button[aria-pressed="true"]{color:var(--vscode-button-background,#0e639c);}',
  '.gdmux-toolbar button[aria-pressed="true"]::before{content:"";position:absolute;top:0;left:22%;right:22%;height:2px;background:currentColor;border-radius:0 0 2px 2px;}',
  '.gdmux-toolbar button[aria-disabled="true"]{opacity:.38;cursor:not-allowed;}',
  '#gdmux-root.gdmux-no-footer .gdmux-toolbar{display:none;}',
  '#gdmux-root.gdmux-no-header .gdmux-header{display:none;}',
  '#gdmux-root.gdmux-shell-minimized .gdmux-header{transform:translateY(-110%);}',
  '#gdmux-root.gdmux-shell-minimized .gdmux-toolbar{transform:translateY(110%);}',
  '@media (max-width:360px){.gdmux-toolbar button .gdmux-btn-label{display:none;}}',

  '/* Adapter presentation rules (mobile overlays) — scoped under gdmux-* state classes */',
  // Mobile invariant: the GMUX header replaces the desktop titlebar strip.
  // visibility keeps VS Code grid metrics intact (no layout corruption).
  '.monaco-workbench.gdmux-mode-mobile .part.titlebar{visibility:hidden;}',
  // The desktop activity rail is replaced by the bottom toolbar on mobile;
  // visibility keeps its 48px grid track so workbench layout stays stable.
  '.monaco-workbench.gdmux-mode-mobile .part.activitybar{visibility:hidden;}',
  // Immersive: minimap hidden. Safe — the vacated strip shows editor
  // background; Monaco text viewport was already sized beside it (spec §21).
  '.monaco-workbench.gdmux-immersive .monaco-editor .minimap{display:none !important;}',
  // Explorer/Search/SCM as drawer: reposition the EXISTING sidebar part
  // (spec §17 — no duplicated file tree, no second repository model).
  '.monaco-workbench.gdmux-sidebar-overlay .part.sidebar{position:fixed !important;left:0 !important;right:auto !important;',
  ' top:calc(var(--gdmux-vv-offset,0px) + var(--gdmux-shell-top,0px)) !important;',
  ' height:calc(var(--gdmux-vv-height,100vh) - var(--gdmux-shell-top,0px) - var(--gdmux-shell-bottom,0px)) !important;',
  ' width:min(100vw,480px) !important;z-index:920;',
  ' background:var(--vscode-sideBar-background,#252526);box-shadow:0 0 24px rgba(0,0,0,.45);}',
  // Terminal full usable height (spec §20).
  '.monaco-workbench.gdmux-panel-overlay .part.panel{position:fixed !important;left:0 !important;right:0 !important;bottom:auto !important;',
  ' top:calc(var(--gdmux-vv-offset,0px) + var(--gdmux-shell-top,0px)) !important;',
  ' height:var(--gdmux-panel-h,60vh) !important;width:auto !important;z-index:920;',
  ' background:var(--vscode-panel-background,#1e1e1e);box-shadow:0 0 24px rgba(0,0,0,.45);}',

  '/* Modal & menus */',
  '.gdmux-modal-backdrop{position:absolute;inset:0;pointer-events:auto;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center;}',
  '@media (min-width:600px){.gdmux-modal-backdrop{align-items:center;}}',
  '.gdmux-modal{background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background,#252526));',
  ' color:var(--vscode-editorWidget-foreground,inherit);border:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,.3));',
  ' border-radius:10px 10px 0 0;width:100%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;',
  ' box-shadow:0 -4px 24px rgba(0,0,0,.35);}',
  '@media (min-width:600px){.gdmux-modal{border-radius:10px;}}',
  '.gdmux-modal-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(128,128,128,.2);font-weight:600;}',
  '.gdmux-modal-head button{width:34px;height:30px;border-radius:6px;font-size:16px;}',
  '.gdmux-modal-head button:hover{background:rgba(128,128,128,.18);}',
  '.gdmux-modal-body{padding:8px 12px 14px;overflow:auto;-webkit-overflow-scrolling:touch;}',
  '.gdmux-menu{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;}',
  '.gdmux-menu button{display:flex;width:100%;text-align:left;padding:11px 10px;border-radius:6px;font-size:15px;align-items:center;gap:10px;}',
  '.gdmux-menu button:hover{background:var(--vscode-list-hoverBackground,rgba(128,128,128,.15));}',
  '.gdmux-menu button[aria-disabled="true"]{opacity:.45;cursor:not-allowed;}',
  '.gdmux-menu .gdmux-note{margin-left:auto;font-size:11px;opacity:.7;}',
  '.gdmux-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 2px;border-bottom:1px solid rgba(128,128,128,.15);font-size:14px;}',
  '.gdmux-row input[type=checkbox]{width:20px;height:20px;}',
  '.gdmux-row select{background:var(--vscode-dropdown-background,#3c3c3c);color:var(--vscode-dropdown-foreground,#fff);border:1px solid var(--vscode-dropdown-border,transparent);padding:4px 6px;border-radius:4px;}',
  '.gdmux-report{font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;background:rgba(128,128,128,.08);padding:8px;border-radius:6px;}',
  '.gdmux-actions-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}',
  '.gdmux-actions-row button{background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#fff);padding:7px 12px;border-radius:5px;font-size:13px;}',
  '.gdmux-revive{position:fixed;right:10px;bottom:10px;z-index:940;width:34px;height:34px;border-radius:50%;',
  ' background:var(--vscode-button-background,#0e639c);color:#fff;display:flex;align-items:center;justify-content:center;',
  ' font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:auto;border:0;cursor:pointer;}',
].join('\n');

/* ===========================================================================
 * §F–§J RUNTIME (browser only): shell, viewport, inputs, reconciler,
 * lifecycle, bootstrap. Everything below is guarded by HAS_DOM so the file
 * can also be loaded by Node for the unit test suite.
 * =========================================================================*/

let session = null; // active runtime session (idempotency, spec §32)

function createSession() {
  const diag = createDiagLog();
  const scheduler = createScheduler(HAS_DOM ? window : null);
  const prefsStore = createPreferenceStore(HAS_DOM ? { storage: window.localStorage } : null, diag);
  const commands = createCommandRegistry(diag);
  const adapter = GitHubDevAdapter;

  // ----- kernel state (spec §12) — DOM is evidence, this is control state --
  const state = {
    lifecycle: LIFECYCLE.BOOTSTRAPPING,
    shellMode: null,
    activeSurface: SURFACE.EDITOR,
    previousSurface: null,
    immersive: true,
    keyboardVisible: false,
    keyboardEvidence: 'UNKNOWN',
    viewport: { width: 0, height: 0, offsetTop: 0 },
    lastFileKey: '',
    modal: null,
  };
  let caps = {};
  const stats = {
    viewportApplied: false, immersiveApplied: false,
    explorerValidated: false, searchValidated: false, gitValidated: false, terminalValidated: false,
    reconciles: 0,
  };
  let vvUsed = false;
  let pending = null; // {cmd, expect, t0, retried}
  let suppress = 0;   // MutationObserver self-write guard (spec §11)
  let disposed = false;

  const listeners = []; // [target, type, fn, opts] — removable on teardown
  let mo = null;        // app MutationObserver
  let bootObserver = null;
  let bootTimer = null;
  let shell = null;
  let reviveEl = null;
  const lastVars = {};

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  function applyWrites(fn) {
    suppress++;
    try { fn(); } finally {
      // MutationObserver callbacks run as microtasks queued before this
      // timeout, so our own mutations are still masked when they fire.
      setTimeout(() => { suppress = Math.max(0, suppress - 1); }, 0);
    }
  }

  /* ----------------------------- shell UI (§16) --------------------------- */

  const SURFACE_BUTTONS = [
    { surface: SURFACE.EXPLORER, icon: '\u{1F4C1}', label: 'Files', command: 'open-explorer' },
    { surface: SURFACE.SEARCH, icon: '\u{1F50D}', label: 'Search', command: 'open-search' },
    { surface: SURFACE.GIT, icon: '\u2387', label: 'Git', command: 'open-git' },
    { surface: SURFACE.TERMINAL, icon: '\u25A3', label: 'Term.', command: 'open-terminal' },
    { surface: SURFACE.SETTINGS, icon: '\u2699', label: 'More', command: 'open-settings' },
  ];

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(el);
  }

  function buildShell() {
    const root = document.createElement('div');
    root.id = 'gdmux-root';
    root.setAttribute('data-gdmux', '');

    const header = document.createElement('header');
    header.className = 'gdmux-header';
    header.setAttribute('role', 'banner');

    const menuBtn = document.createElement('button');
    menuBtn.className = 'gdmux-icon-btn gdmux-header-menu';
    menuBtn.textContent = '\u2630';
    menuBtn.setAttribute('aria-label', 'GMUX menu');
    menuBtn.setAttribute('aria-haspopup', 'true');

    const fileBtn = document.createElement('button');
    fileBtn.className = 'gdmux-header-file';
    fileBtn.setAttribute('aria-label', 'Current file — activate to focus editor');
    const fileName = document.createElement('span');
    fileName.className = 'gdmux-file-name';
    fileName.textContent = '';
    fileBtn.appendChild(fileName);

    const moreBtn = document.createElement('button');
    moreBtn.className = 'gdmux-icon-btn gdmux-header-more';
    moreBtn.textContent = '\u22EE';
    moreBtn.setAttribute('aria-label', 'Editor actions');
    moreBtn.setAttribute('aria-haspopup', 'true');

    header.appendChild(menuBtn);
    header.appendChild(fileBtn);
    header.appendChild(moreBtn);

    const toolbar = document.createElement('nav');
    toolbar.className = 'gdmux-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Workspace surfaces');
    const buttons = {};
    SURFACE_BUTTONS.forEach((def) => {
      const b = document.createElement('button');
      b.setAttribute('data-surface', def.surface);
      b.setAttribute('aria-label',
        def.surface === SURFACE.TERMINAL ? 'Terminal' :
        def.surface === SURFACE.SETTINGS ? 'Settings and more' : def.label);
      b.setAttribute('aria-pressed', 'false');
      const ic = document.createElement('span');
      ic.setAttribute('aria-hidden', 'true');
      ic.textContent = def.icon;
      const lb = document.createElement('span');
      lb.className = 'gdmux-btn-label';
      lb.setAttribute('aria-hidden', 'true');
      lb.textContent = def.label;
      b.appendChild(ic);
      b.appendChild(lb);
      toolbar.appendChild(b);
      buttons[def.surface] = b;
    });

    const live = document.createElement('div');
    live.className = 'gdmux-visually-hidden';
    live.setAttribute('aria-live', 'polite');

    const modalRoot = document.createElement('div');
    modalRoot.className = 'gdmux-modal-root';

    root.appendChild(header);
    root.appendChild(toolbar);
    root.appendChild(live);
    root.appendChild(modalRoot);

    // Event wiring — everything converges on the command registry (spec §15).
    menuBtn.addEventListener('click', () => commands.execute('open-menu'));
    moreBtn.addEventListener('click', () => commands.execute('open-editor-menu'));
    fileBtn.addEventListener('click', () => commands.execute('focus-editor'));
    toolbar.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-surface]') : null;
      if (!btn) return;
      const def = SURFACE_BUTTONS.find((d) => d.surface === btn.getAttribute('data-surface'));
      if (!def) return;
      if (btn.getAttribute('aria-disabled') === 'true') {
        diag.log(FAIL.TERMINAL_NOT_FOUND, 'terminal surface not available on this host (spec §20)', 'warn');
        announce('Terminal not available here');
        return;
      }
      commands.execute(def.command);
    });

    return {
      root, header, toolbar, fileName, buttons, live, modalRoot,
      mount() {
        applyWrites(() => { document.body.appendChild(root); });
      },
      unmount() {
        if (root.parentNode) applyWrites(() => { root.parentNode.removeChild(root); });
      },
    };
  }

  function announce(msg) {
    if (shell && shell.live) shell.live.textContent = msg;
  }

  /* ------------------------------- modals --------------------------------- */

  function openModal(title, bodyEl, opts = {}) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'gdmux-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'gdmux-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title);
    const head = document.createElement('div');
    head.className = 'gdmux-modal-head';
    const h = document.createElement('span');
    h.textContent = title;
    const x = document.createElement('button');
    x.textContent = '\u2715';
    x.setAttribute('aria-label', 'Close dialog');
    x.addEventListener('click', () => closeModal());
    head.appendChild(h);
    head.appendChild(x);
    const body = document.createElement('div');
    body.className = 'gdmux-modal-body';
    body.appendChild(bodyEl);
    modal.appendChild(head);
    modal.appendChild(body);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) closeModal(); });
    const prevFocus = document.activeElement;
    applyWrites(() => { shell.modalRoot.appendChild(backdrop); });
    state.modal = opts.kind || 'modal';
    scheduler.markDirty('modal');
    const focusable = modal.querySelector('button, [href], input, select, textarea');
    if (focusable) { try { focusable.focus(); } catch (e) { /* noop */ } }
    announce(title + ' opened');
    return {
      close() {
        if (backdrop.parentNode) applyWrites(() => { backdrop.parentNode.removeChild(backdrop); });
        state.modal = null;
        scheduler.markDirty('modal');
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* noop */ } }
      },
    };
  }

  let activeModal = null;
  function closeModal() {
    if (activeModal) { activeModal.close(); activeModal = null; }
  }
  function showModal(title, bodyEl, opts) { activeModal = openModal(title, bodyEl, opts); return activeModal; }

  function menuList(items) {
    const ul = document.createElement('ul');
    ul.className = 'gdmux-menu';
    items.forEach((item) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = item.label;
      if (item.note) {
        const n = document.createElement('span');
        n.className = 'gdmux-note';
        n.textContent = item.note;
        b.appendChild(n);
      }
      if (item.disabled) {
        b.setAttribute('aria-disabled', 'true');
      } else {
        b.addEventListener('click', () => {
          if (!item.keepOpen) closeModal();
          if (item.run) item.run();
        });
      }
      li.appendChild(b);
      ul.appendChild(li);
    });
    return ul;
  }

  /* --------------------------- diagnostics (§44) -------------------------- */

  function buildReport() {
    const p = prefsStore.get();
    const lines = [];
    lines.push(`${NAME} v${USER_INTERFACE_VERSION} (adapter ${adapter ? adapter.version : 'none'})`);
    lines.push(`Mode: ${String(state.shellMode).toUpperCase()}   Lifecycle: ${state.lifecycle}`);
    lines.push(`Adapter: ${adapter ? adapter.name : 'none'}   Adapter status: ${adapter && adapter.isPresent() ? 'ACTIVE' : 'NOT_FOUND'}`);
    lines.push('');
    lines.push(`Editor: ${caps.editor || CAP.UNKNOWN}`);
    lines.push(`Explorer: ${caps.explorer || CAP.UNKNOWN}`);
    lines.push(`Search: ${caps.search || CAP.UNKNOWN}`);
    lines.push(`Git: ${caps.sourceControl || CAP.UNKNOWN}`);
    lines.push(`Terminal: ${caps.terminal || CAP.UNKNOWN}${caps.terminal === CAP.UNSUPPORTED ? ' (host does not provide a terminal — inference)' : ''}`);
    lines.push('');
    lines.push(`Viewport: ${state.viewport.width} \u00D7 ${state.viewport.height}${vvUsed ? '' : ' (visualViewport unavailable)'}`);
    lines.push(`Keyboard: ${state.keyboardVisible ? 'INFERRED_OPEN' : 'INFERRED_CLOSED'} (evidence: ${state.keyboardEvidence})`);
    lines.push('');
    lines.push(`Shell: ${state.lifecycle}   Immersive: ${p.immersive ? 'ON' : 'OFF'}   Gestures: ${p.gestures ? 'ON' : 'OFF'}`);
    lines.push(`Active surface: ${state.activeSurface}${state.previousSurface ? `   Previous: ${state.previousSurface}` : ''}`);
    lines.push(`Reconciliations: ${stats.reconciles}`);
    lines.push('');
    lines.push('Features (spec §35 — evidence-based):');
    computeFeatureStatuses({ caps, stats, vvUsed: vvUsed ? (window.visualViewport ? 'visualViewport' : 'fallback') : null, terminalNote: caps.terminal === CAP.UNSUPPORTED ? 'github.dev/vscode.dev host' : null })
      .forEach(([name, info]) => lines.push(`  ${name}: ${info.status} — ${info.basis}`));
    const recent = diag.entries().slice(-12);
    if (recent.length) {
      lines.push('');
      lines.push('Recent diagnostics:');
      recent.forEach((e) => lines.push(`  [${new Date(e.ts).toISOString()}] ${e.level.toUpperCase()} ${e.code ? e.code + ': ' : ''}${e.msg}`));
    }
    return lines.join('\n');
  }

  function openDiagnostics() {
    const wrap = document.createElement('div');
    const pre = document.createElement('div');
    pre.className = 'gdmux-report';
    pre.setAttribute('role', 'log');
    pre.textContent = buildReport();
    wrap.appendChild(pre);
    const row = document.createElement('div');
    row.className = 'gdmux-actions-row';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      row.appendChild(b);
    };
    mk('Refresh', () => { scheduler.markDirty('diagnostics-refresh'); pre.textContent = buildReport(); });
    mk('Copy report', () => {
      const text = buildReport();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => announce('Report copied'), () => announce('Copy failed'));
      } else { announce('Clipboard unavailable'); }
    });
    mk('Reset preferences', () => { prefsStore.reset(); diag.log(null, 'preferences reset to defaults'); scheduler.markDirty('prefs'); pre.textContent = buildReport(); });
    mk('Disable GMUX', () => { closeModal(); commands.execute('disable-gmux'); });
    wrap.appendChild(row);
    showModal(`${NAME} — diagnostics`, wrap, { kind: 'diagnostics' });
  }

  /* ----------------------------- settings (§28) --------------------------- */

  function openSettings() {
    const p = prefsStore.get();
    const wrap = document.createElement('div');
    const row = (labelText, control) => {
      const r = document.createElement('div');
      r.className = 'gdmux-row';
      const l = document.createElement('label');
      l.textContent = labelText;
      r.appendChild(l);
      r.appendChild(control);
      wrap.appendChild(r);
      return r;
    };
    const checkbox = (value, apply) => {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!value;
      c.addEventListener('change', () => { apply(c.checked); scheduler.markDirty('prefs'); });
      return c;
    };
    row('Immersive editor (hide minimap on mobile)', checkbox(p.immersive, (v) => prefsStore.set({ immersive: v })));
    row('Bottom toolbar', checkbox(p.bottomBar, (v) => prefsStore.set({ bottomBar: v })));
    row('Edge-swipe gestures', checkbox(p.gestures, (v) => prefsStore.set({ gestures: v })));
    row('Terminal fullscreen', checkbox(p.terminalFullscreen, (v) => prefsStore.set({ terminalFullscreen: v })));
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Shell mode');
    ['auto', 'mobile', 'compact', 'desktop'].forEach((m) => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m === 'auto' ? 'Auto (follow viewport)' : m;
      if (p.mode === m) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { prefsStore.set({ mode: sel.value }); scheduler.markDirty('prefs'); });
    row('Shell mode', sel);
    const note = document.createElement('div');
    note.className = 'gdmux-report';
    note.style.marginTop = '10px';
    note.textContent = `${NAME} v${USER_INTERFACE_VERSION}\nadapter ${adapter ? adapter.version : '-'} · prefs schema v${PREFERENCE_SCHEMA_VERSION}\nPreferences stay in this browser (localStorage). No telemetry, no network, no repository data (spec §29).`;
    wrap.appendChild(note);
    showModal('GMUX settings', wrap, { kind: 'settings' });
  }

  /* --------------------------- command registry --------------------------- */

  function expectTransition(actionName, expect) {
    const t = transitionFor(state, actionName);
    if (!t.ok) {
      diag.log(t.code, t.reason, 'warn');
      // Navigation commands are still allowed to proceed — the transition
      // table lagging behind reality is diagnosable, not fatal.
    }
    state.previousSurface = state.activeSurface;
    state.activeSurface = expect;
    pending = { cmd: actionName, expect, t0: Date.now(), retried: false };
  }

  commands.register('open-explorer', () => {
    if (caps.explorer === CAP.NOT_DETECTED) diag.log(FAIL.EXPLORER_NOT_FOUND, 'explorer not detected yet; attempting anyway', 'warn');
    const r = adapter.openSidebarView('explorer');
    if (!r.ok) return { ok: false, code: FAIL.EXPLORER_NOT_FOUND };
    expectTransition('openExplorer', SURFACE.EXPLORER);
    scheduler.markDirty('command');
    return { ok: true };
  });
  commands.register('open-search', () => {
    const r = adapter.openSidebarView('search');
    if (!r.ok) return { ok: false, code: FAIL.SEARCH_NOT_FOUND };
    expectTransition('openSearch', SURFACE.SEARCH);
    scheduler.markDirty('command');
    return { ok: true };
  });
  commands.register('open-git', () => {
    const r = adapter.openSidebarView('scm');
    if (!r.ok) return { ok: false, code: FAIL.SOURCE_CONTROL_NOT_FOUND };
    expectTransition('openGit', SURFACE.GIT);
    scheduler.markDirty('command');
    return { ok: true };
  });
  commands.register('open-terminal', () => {
    if (caps.terminal !== CAP.DETECTED) {
      diag.log(FAIL.TERMINAL_NOT_FOUND, `terminal capability ${caps.terminal || CAP.UNKNOWN}; not advertising a working terminal (spec §20)`, 'warn');
      announce('Terminal not available here');
      return { ok: false, code: FAIL.TERMINAL_NOT_FOUND };
    }
    const r = adapter.openTerminal();
    if (!r.ok) return { ok: false, code: FAIL.TERMINAL_NOT_FOUND };
    expectTransition('openTerminal', SURFACE.TERMINAL);
    scheduler.markDirty('command');
    return { ok: true };
  });
  commands.register('focus-editor', () => {
    const r = adapter.focusEditor();
    if (r.ok) {
      state.previousSurface = state.activeSurface;
      state.activeSurface = SURFACE.EDITOR;
      scheduler.markDirty('command');
      return { ok: true };
    }
    return { ok: false, code: FAIL.EDITOR_NOT_FOUND };
  });
  commands.register('close-surface', () => {
    const cur = state.activeSurface;
    if (cur === SURFACE.EDITOR || cur === SURFACE.SETTINGS) {
      diag.log(FAIL.UNEXPECTED_TRANSITION, `close-surface ignored on ${cur}`, 'info');
      return { ok: false, code: FAIL.UNEXPECTED_TRANSITION };
    }
    const t = transitionFor(state, 'close');
    const target = t.ok ? t.to : SURFACE.EDITOR;
    if (cur === SURFACE.TERMINAL) adapter.closePanel();
    else adapter.closeSidebar();
    state.previousSurface = null;
    state.activeSurface = target;
    pending = { cmd: 'close', expect: target, t0: Date.now(), retried: false };
    scheduler.markDirty('command');
    return { ok: true };
  });
  commands.register('open-settings', () => { openSettings(); return { ok: true }; });
  commands.register('open-menu', () => {
    showModal('GMUX', menuList([
      { label: 'Settings', note: 'mobile UX', run: () => commands.execute('open-settings') },
      { label: 'Diagnostics', note: 'status & evidence', run: openDiagnostics },
      { label: 'Toggle immersive mode', note: prefsStore.get().immersive ? 'on' : 'off', run: () => commands.execute('toggle-immersive') },
      { label: 'Toggle bottom toolbar', run: () => commands.execute('toggle-bottombar') },
      { label: 'Toggle gestures', run: () => commands.execute('toggle-gestures') },
      { label: 'Disable GMUX', note: 'Alt+Shift+G restores', run: () => commands.execute('disable-gmux') },
    ]), { kind: 'menu' });
    return { ok: true };
  });
  commands.register('open-editor-menu', () => {
    showModal('Editor actions', menuList([
      { label: 'Go to file\u2026', note: 'Ctrl+P', run: () => adapter.dispatchKeybinding('quickOpen') },
      { label: 'Command palette\u2026', note: 'Ctrl+Shift+P', run: () => adapter.dispatchKeybinding('commandPalette') },
      { label: 'VS Code settings', note: 'Ctrl+,', run: () => adapter.dispatchKeybinding('openSettings') },
      { label: 'Focus editor', run: () => commands.execute('focus-editor') },
      { label: 'Close current surface', run: () => commands.execute('close-surface') },
    ]), { kind: 'menu' });
    return { ok: true };
  });
  commands.register('toggle-immersive', () => {
    const v = !prefsStore.get().immersive;
    prefsStore.set({ immersive: v });
    scheduler.markDirty('prefs');
    return { ok: true };
  });
  commands.register('toggle-bottombar', () => {
    const v = !prefsStore.get().bottomBar;
    prefsStore.set({ bottomBar: v });
    scheduler.markDirty('prefs');
    return { ok: true };
  });
  commands.register('toggle-gestures', () => {
    const v = !prefsStore.get().gestures;
    prefsStore.set({ gestures: v });
    scheduler.markDirty('prefs');
    return { ok: true };
  });
  commands.register('show-diagnostics', () => { openDiagnostics(); return { ok: true }; });
  commands.register('reset-preferences', () => { prefsStore.reset(); scheduler.markDirty('prefs'); return { ok: true }; });
  commands.register('disable-gmux', () => { disableShell(true); return { ok: true }; });

  /* ------------------------- viewport subsystem (§24) ---------------------- */

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
      diag.log(FAIL.VIEWPORT_API_UNAVAILABLE, 'visualViewport missing; using window resize observations', 'warn');
    }
    state.viewport = { width: Math.round(width), height: Math.round(height), offsetTop: Math.round(offsetTop) };
    // §25 keyboard inference — significant visual-viewport height reduction.
    const kb = inferKeyboard({
      vvAvailable: !!vv, vvHeight: height, vvWidth: width,
      layoutHeight: window.innerHeight, layoutWidth: window.innerWidth,
    });
    state.keyboardVisible = kb.visible;
    state.keyboardEvidence = kb.evidence;
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
    if (vv) {
      on(vv, 'resize', onViewportEvent);
      on(vv, 'scroll', onViewportEvent);
    }
    on(window, 'resize', onViewportEvent);
    on(window, 'orientationchange', onViewportEvent);
    readViewport();
  }

  /* --------------------------- mutation observer (§11) --------------------- */

  const RELEVANT_SELECTOR = '.part, .pane-composite-part, .monaco-editor, .xterm, .quick-input-widget, .tab';
  function isRelevantNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === 'gdmux-root' || (node.classList && node.classList.contains('gdmux-revive'))) return false;
    try {
      if (node.matches && node.matches(RELEVANT_SELECTOR)) return true;
      if (node.querySelector && node.querySelector(RELEVANT_SELECTOR)) return true;
    } catch (e) { /* noop */ }
    return false;
  }

  function wireObserver() {
    if (!('MutationObserver' in window)) {
      diag.log(FAIL.DOM_CHANGED, 'MutationObserver unavailable; dynamic changes will not reconcile', 'error');
      return;
    }
    mo = new MutationObserver((mutations) => {
      if (suppress > 0) return; // our own writes
      let relevant = false;
      for (let i = 0; i < mutations.length && !relevant; i++) {
        const m = mutations[i];
        if (m.target && m.target.id === 'gdmux-root') continue;
        if (m.type === 'childList') {
          for (let a = 0; a < m.addedNodes.length && !relevant; a++) relevant = isRelevantNode(m.addedNodes[a]);
          for (let rIdx = 0; rIdx < m.removedNodes.length && !relevant; rIdx++) relevant = isRelevantNode(m.removedNodes[rIdx]);
        } else if (m.type === 'attributes') {
          const t = m.target;
          if (t && t.nodeType === 1) {
            relevant = (t.classList && t.classList.contains('monaco-workbench')) ||
              (t.classList && t.classList.contains('part'));
          }
        }
      }
      if (relevant) scheduler.markDirty('mutation');
    });
    // attributeFilter intentionally excludes 'style': VS Code writes inline
    // part metrics continuously during layout; class changes (nosidebar,
    // nopanel, …) are the state signals GMUX cares about (spec §11).
    mo.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'aria-hidden'],
      characterData: false,
    });
  }

  /* ------------------------------ inputs (§15/§22/§23) --------------------- */

  // Monaco protection (§22): never intercept inside these zones.
  const PROTECTED_SELECTOR = '.monaco-editor, textarea, input, select, [contenteditable="true"], .xterm, .monaco-list';

  function wireKeyboard() {
    on(window, 'keydown', (ev) => {
      // Alt+Shift+G is handled by the bootstrap-level listener (it must
      // survive session teardown to re-enable the shell, spec §39).
      if (ev.key === 'Escape' && state.modal) {
        closeModal();
        return;
      }
      if (ev.key === 'Escape' && !state.modal && state.shellMode === SHELL_MODE.MOBILE &&
          state.activeSurface !== SURFACE.EDITOR) {
        const t = ev.target;
        if (t && t.closest && t.closest(PROTECTED_SELECTOR)) return; // Monaco owns Escape there
        commands.execute('close-surface');
      }
    }, true);
  }

  function wireGestures() {
    let track = null;
    on(window, 'pointerdown', (ev) => {
      if (disposed || !prefsStore.get().gestures) return;
      if (!ev.isPrimary) return;
      const t = ev.target;
      if (t && t.closest && t.closest(PROTECTED_SELECTOR)) return; // spec §23 protections
      if (t && t.closest && t.closest('#gdmux-root')) return; // shell handles its own input
      track = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, t0: Date.now(), points: 1 };
    }, { capture: true, passive: true });
    on(window, 'pointermove', (ev) => {
      if (!track || ev.pointerId !== track.id) return;
      track.x1 = ev.clientX;
      track.y1 = ev.clientY;
      track.points++;
    }, { capture: true, passive: true });
    const finish = (ev) => {
      if (!track || ev.pointerId !== track.id) return;
      const tr = track;
      track = null;
      tr.x1 = tr.x1 != null ? tr.x1 : tr.x0;
      tr.y1 = tr.y1 != null ? tr.y1 : tr.y0;
      tr.duration = Date.now() - tr.t0;
      tr.vw = state.viewport.width || window.innerWidth;
      tr.vh = state.viewport.height || window.innerHeight;
      const g = classifyGesture(tr);
      if (g && g.action) {
        diag.log(null, `gesture ${g.action} (${g.confidence})`, 'info');
        commands.execute(g.action);
      }
      // NO ACTION is the default whenever confidence is insufficient (spec §23).
    };
    on(window, 'pointerup', finish, { capture: true, passive: true });
    on(window, 'pointercancel', () => { track = null; }, { capture: true, passive: true });
  }

  /* --------------------------- reconciler (§7/§31) ------------------------- */

  let reconcileGuard = { count: 0, windowStart: Date.now() };

  function applyClassDiffs(el, add, remove) {
    if (!el) return;
    remove.forEach((c) => { if (el.classList.contains(c)) el.classList.remove(c); });
    add.forEach((c) => { if (!el.classList.contains(c)) el.classList.add(c); });
  }

  function applyVars(vars) {
    const style = document.documentElement.style;
    Object.keys(vars).forEach((k) => {
      if (lastVars[k] !== vars[k]) {
        style.setProperty(k, vars[k]);
        lastVars[k] = vars[k];
      }
    });
  }

  function clearVars() {
    const style = document.documentElement.style;
    Object.keys(lastVars).forEach((k) => { style.removeProperty(k); delete lastVars[k]; });
  }

  function verifyPending(obs) {
    if (!pending) return;
    const elapsed = Date.now() - pending.t0;
    let done = false;
    if (pending.expect === SURFACE.TERMINAL) done = !!(obs.terminal && obs.terminal.visible);
    else if (pending.expect === SURFACE.EDITOR) {
      const sidebarGone = !obs.parts.sidebar.visible;
      const panelGone = !obs.terminal.visible;
      done = sidebarGone && panelGone;
    } else {
      const map = { explorer: 'explorer', search: 'search', git: 'scm' };
      done = !!obs.parts.sidebar.visible && obs.views.sidebarActiveView === map[pending.expect];
    }
    if (done) {
      if (pending.expect === SURFACE.EXPLORER) stats.explorerValidated = true;
      if (pending.expect === SURFACE.SEARCH) stats.searchValidated = true;
      if (pending.expect === SURFACE.GIT) stats.gitValidated = true;
      if (pending.expect === SURFACE.TERMINAL) stats.terminalValidated = true;
      diag.log(null, `command effect validated: ${pending.cmd} -> ${pending.expect} (evidence: ${EVIDENCE.VALIDATED})`, 'info');
      pending = null;
      return;
    }
    if (!pending.retried && elapsed > 1200) {
      // One bounded retry through the alternate adapter mechanism.
      pending.retried = true;
      const map = { explorer: 'explorer', search: 'search', git: 'scm' };
      if (pending.expect === SURFACE.TERMINAL) adapter.openTerminal();
      else if (pending.expect === SURFACE.EDITOR) adapter.closeSidebar();
      else adapter.dispatchKeybinding(pending.expect === 'explorer' ? 'openExplorer' : pending.expect === 'search' ? 'openSearch' : 'openGit');
      diag.log(null, `command retry via fallback mechanism: ${pending.cmd}`, 'info');
      scheduler.markDirty('retry');
      return;
    }
    if (elapsed > 3200) {
      const codeMap = {
        explorer: FAIL.EXPLORER_NOT_FOUND, search: FAIL.SEARCH_NOT_FOUND,
        git: FAIL.SOURCE_CONTROL_NOT_FOUND, terminal: FAIL.TERMINAL_NOT_FOUND,
        editor: FAIL.COMMAND_FAILED,
      };
      diag.log(codeMap[pending.expect] || FAIL.COMMAND_FAILED,
        `expected effect not observed for ${pending.cmd} -> ${pending.expect}; capability stays ${caps[pending.expect === 'git' ? 'sourceControl' : pending.expect] || CAP.UNKNOWN}`, 'warn');
      pending = null;
    }
  }

  function reconcile(reasons) {
    if (disposed) return;
    // Loop guard (spec §11): reconciliation must not feed itself.
    const now = Date.now();
    if (now - reconcileGuard.windowStart > 2000) reconcileGuard = { count: 0, windowStart: now };
    reconcileGuard.count++;
    if (reconcileGuard.count > 90) {
      diag.log(FAIL.RECONCILIATION_FAILED, 'reconciliation rate too high; backing off', 'error');
      reconcileGuard.windowStart = now; // reset window, skip this cycle
      return;
    }
    try {
      const obs = adapter.observe();
      const prevCaps = caps;
      caps = adapter.capabilities(obs);
      Object.keys(caps).forEach((k) => {
        if (prevCaps && prevCaps[k] && prevCaps[k] !== caps[k]) {
          diag.log(null, `capability ${k}: ${prevCaps[k]} -> ${caps[k]} (evidence: ${EVIDENCE.OBSERVED})`, 'info');
        }
      });

      verifyPending(obs);

      const prefs = prefsStore.get();
      const plan = planReconcile({ obs, state, prefs, caps, pending });

      // State reduction (spec §7) — kernel state adopts the decision.
      const surfaceChanged = plan.activeSurface !== state.activeSurface;
      state.activeSurface = plan.activeSurface;
      state.previousSurface = plan.previousSurface;
      state.shellMode = plan.shellMode;
      state.immersive = plan.immersiveOn;
      if (plan.fileKey) state.lastFileKey = plan.fileKey;
      if (plan.adoptedFromApp) {
        diag.log(null, `surface adopted from application: ${plan.activeSurface} (evidence: ${EVIDENCE.OBSERVED})`, 'info');
      }
      if (plan.fileSelected) {
        diag.log(null, 'file selection observed -> editor surface; closing sidebar drawer', 'info');
        adapter.closeSidebar(); // spec §14 EXPLORER selectFile -> EDITOR
        pending = { cmd: 'selectFile', expect: SURFACE.EDITOR, t0: Date.now(), retried: false };
      }

      // Mutation (spec §7: only after observe/detect/decide).
      applyWrites(() => {
        applyVars(plan.vars);
        applyClassDiffs(adapter.workbench(), plan.workbenchAdd, plan.workbenchRemove);
        applyClassDiffs(shell.root, plan.rootAdd, plan.rootRemove);

        // Header current file (write only on change — spec §30).
        const name = plan.headerFile || '';
        if (shell.fileName.textContent !== name) shell.fileName.textContent = name;

        // Toolbar state (spec §20: never falsely advertise terminal).
        SURFACE_BUTTONS.forEach((def) => {
          const b = shell.buttons[def.surface];
          if (!b) return;
          const pressed = plan.pressedSurface === def.surface ||
            (def.surface === SURFACE.SETTINGS && state.modal === 'settings');
          b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
          if (def.surface === SURFACE.TERMINAL) {
            b.setAttribute('aria-disabled', plan.terminalEnabled ? 'false' : 'true');
          }
        });
      });

      stats.viewportApplied = true;
      stats.immersiveApplied = plan.immersiveOn;
      stats.reconciles++;

      if (surfaceChanged) {
        announce(`${plan.activeSurface} surface`);
        prefsStore.set({ preferredSurface: plan.activeSurface });
      }
    } catch (err) {
      diag.log(FAIL.RECONCILIATION_FAILED, String(err && err.message || err), 'error');
    }
  }

  /* ------------------------------ lifecycle (§32) -------------------------- */

  // Boot guard (spec §32): never repeatedly initialize the shell. Guarded
  // here (not at call sites) so every entry path is covered.
  let detectingEntered = false;
  function enterDetecting() {
    if (detectingEntered) return;
    detectingEntered = true;
    state.lifecycle = LIFECYCLE.DETECTING;
    diag.log(null, 'workbench observed; detecting capabilities', 'info');
    try {
      ensureStyle();
      shell = buildShell();
      shell.mount();
      diag.log(null, 'shell mounted', 'info');
    } catch (err) {
      state.lifecycle = LIFECYCLE.FAILED;
      diag.log(FAIL.SHELL_MOUNT_FAILED, String(err && err.message || err), 'error');
      return;
    }
    wireViewport();
    wireObserver();
    wireKeyboard();
    wireGestures();
    scheduler.onReconcile(reconcile);
    reconcile(['initial']);
    const obsCaps = caps;
    state.lifecycle = obsCaps.editor === CAP.DETECTED ? LIFECYCLE.ACTIVE : LIFECYCLE.DEGRADED;
    if (state.lifecycle === LIFECYCLE.DEGRADED) {
      diag.log(FAIL.EDITOR_NOT_FOUND, 'workbench present but editor not detected; shell active in degraded mode', 'warn');
    }
    // Restore preferred surface if it is detectable (spec §28).
    const pref = prefsStore.get().preferredSurface;
    const capKey = pref === 'git' ? 'sourceControl' : pref;
    if (pref && pref !== SURFACE.EDITOR && obsCaps[capKey] === CAP.DETECTED) {
      const cmd = { explorer: 'open-explorer', search: 'open-search', git: 'open-git', terminal: 'open-terminal' }[pref];
      if (cmd) setTimeout(() => { if (!disposed) commands.execute(cmd); }, 400); // bounded one-shot, not polling
    }
    window.__GDMUX__.lifecycle = state.lifecycle;
  }

  function start() {
    diag.log(null, `${NAME} v${USER_INTERFACE_VERSION} bootstrapping (adapter ${ADAPTER_VERSION})`, 'info');
    prefsStore.load();
    if (adapter.isPresent()) {
      enterDetecting();
      return;
    }
    state.lifecycle = LIFECYCLE.WAITING_FOR_APP;
    diag.log(null, 'workbench not yet present; waiting for application (no polling)', 'info');
    bootObserver = new MutationObserver(() => {
      if (adapter.isPresent()) {
        if (bootObserver) { bootObserver.disconnect(); bootObserver = null; }
        if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
        enterDetecting();
      }
    });
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
    // Bounded one-shot warning — observation continues reactively afterwards.
    bootTimer = setTimeout(() => {
      if (state.lifecycle === LIFECYCLE.WAITING_FOR_APP) {
        state.lifecycle = LIFECYCLE.DEGRADED;
        diag.log(FAIL.UNSUPPORTED_GITHUB_LAYOUT, 'no VS Code workbench observed after 25s; staying reactive', 'warn');
      }
    }, 25000);
  }

  /* ------------------------------ teardown (§39) --------------------------- */

  function dispose() {
    disposed = true;
    closeModal();
    if (mo) { mo.disconnect(); mo = null; }
    if (bootObserver) { bootObserver.disconnect(); bootObserver = null; }
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    listeners.splice(0).forEach(([t, type, fn, opts]) => {
      try { t.removeEventListener(type, fn, opts); } catch (e) { /* noop */ }
    });
    if (shell) { shell.unmount(); shell = null; }
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    const wb = adapter.workbench();
    if (wb) {
      ['gdmux-mode-mobile', 'gdmux-mode-compact', 'gdmux-mode-desktop', 'gdmux-immersive', 'gdmux-sidebar-overlay', 'gdmux-panel-overlay']
        .forEach((c) => wb.classList.remove(c));
    }
    clearVars();
    state.lifecycle = LIFECYCLE.DISABLED;
  }

  return {
    diag, state, stats, commands, prefsStore, scheduler, adapter,
    get caps() { return caps; },
    get pending() { return pending; },
    start, dispose,
    buildReport,
  };
}

/* ===========================================================================
 * §K BOOTSTRAP, DISABLE/REVIVE, EXPORTS
 * =========================================================================*/

function setDisabledFlag(disabled) {
  try {
    if (disabled) window.localStorage.setItem(DISABLED_FLAG_KEY, '1');
    else window.localStorage.removeItem(DISABLED_FLAG_KEY);
  } catch (e) { /* private mode — flag simply won't persist */ }
}
function getDisabledFlag() {
  try { return window.localStorage.getItem(DISABLED_FLAG_KEY) === '1'; } catch (e) { return false; }
}

function mountReviveChip() {
  if (document.querySelector('.gdmux-revive')) return;
  const b = document.createElement('button');
  b.className = 'gdmux-revive';
  // Inline styles: the GMUX stylesheet is removed during teardown (spec §39),
  // the revive affordance must survive it.
  b.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:940;width:34px;height:34px;border-radius:50%;' +
    'background:#0e639c;color:#fff;display:flex;align-items:center;justify-content:center;' +
    'font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.4);border:0;cursor:pointer;' +
    'font-family:system-ui,sans-serif;';
  b.textContent = 'GM';
  b.setAttribute('aria-label', `Re-enable ${NAME} (or press Alt+Shift+G)`);
  b.title = `Re-enable ${NAME}`;
  b.addEventListener('click', () => enableShell());
  document.body.appendChild(b);
}

function disableShell(persist) {
  if (session) {
    session.diag.log(null, 'shell disabled by user; GitHub application left intact (spec §39)', 'info');
    session.dispose();
    session = null;
  }
  if (persist) setDisabledFlag(true);
  mountReviveChip();
  if (window.__GDMUX__) window.__GDMUX__.lifecycle = LIFECYCLE.DISABLED;
}

function enableShell() {
  setDisabledFlag(false);
  const chip = document.querySelector('.gdmux-revive');
  if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
  boot();
}

function boot() {
  if (session) return; // idempotent initialization (spec §32)
  if (getDisabledFlag()) { mountReviveChip(); return; }
  try {
    session = createSession();
    session.start();
  } catch (err) {
    session = null;
    try { console.error(`[${NAME}]`, FAIL.BOOTSTRAP_FAILED, err); } catch (e) { /* noop */ }
  }
}

// Alt+Shift+G hotkey lives outside the session so disable is reversible
// without a page reload (spec §39).
if (HAS_DOM) {
  window.addEventListener('keydown', (ev) => {
    if (ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && (ev.code === 'KeyG' || ev.key === 'g' || ev.key === 'G')) {
      ev.preventDefault();
      if (session) disableShell(true);
      else enableShell();
    }
  }, true);

  // Console/dev hook — local only, never transmits anything (spec §29).
  window.__GDMUX__ = {
    name: NAME,
    version: USER_INTERFACE_VERSION,
    adapterVersion: ADAPTER_VERSION,
    preferenceSchemaVersion: PREFERENCE_SCHEMA_VERSION,
    lifecycle: null,
    enable: enableShell,
    disable: () => disableShell(true),
    diagnostics: () => (session ? session.buildReport() : `${NAME} disabled — press Alt+Shift+G to re-enable`),
    state: () => (session ? JSON.parse(JSON.stringify(session.state)) : null),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

/* ------------------------- test exports (Node only) ------------------------ */
const TEST_EXPORTS = {
  NAME, USER_INTERFACE_VERSION, ADAPTER_VERSION, PREFERENCE_SCHEMA_VERSION,
  SHELL_MODE, SURFACE, LIFECYCLE, CAP, EVIDENCE, FSTATUS, FAIL,
  DEFAULT_BREAKPOINTS, PREF_DEFAULTS,
  modeForWidth, transitionFor, parsePreferences, classifyCapabilities,
  terminalHostExpectation, inferKeyboard, classifyGesture, planReconcile,
  computeFeatureStatuses, createScheduler, createCommandRegistry, createDiagLog,
  createPreferenceStore,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TEST_EXPORTS;
} else if (HAS_DOM) {
  try { window.__GDMUX_INTERNALS__ = TEST_EXPORTS; } catch (e) { /* noop */ }
}

})();
