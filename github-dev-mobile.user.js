// ==UserScript==
// @name         GitHub.dev Mobile UX
// @namespace    github-dev-mobile
// @version      0.1.0
// @description  Mobile interaction layer for github.dev
// @match        https://github.dev/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
/**
 * GMUX — GitHub Mobile UX Runtime · v0.1.0 IMPLEMENTATION BASELINE
 * =============================================================================
 * A single-file, dependency-free mobile interaction/presentation layer for
 * https://github.dev/*. It observes the host, derives only the state it
 * actually needs, exposes mobile controls, invokes host operations through an
 * adapter, observes the resulting host state, verifies the expected
 * transition, commits GMUX state only after verification, and degrades safely
 * when a host capability cannot be identified. It never becomes a second IDE.
 *
 *   HOST IS SOURCE OF TRUTH → OBSERVE → ADAPT → PRESENT → VERIFY          §2
 *
 * Governing invariants (docs/pack-compliance.md holds the §-by-§ audit):
 *   NO EVIDENCE → NO VERIFIED CLAIM                                        §68
 *   UNKNOWN ≠ FALSE · UNKNOWN ≠ TRUE · UNKNOWN → DIAGNOSTICS              §68
 *   GMUX MAY FAIL → github.dev MUST CONTINUE                              §59/§74
 *   An element existing is NOT operational verification.                   §15
 *
 * THE v0.1 ADAPTER IS INTENTIONALLY INCOMPLETE (§12). No GitHub CSS class,
 * VS Code DOM class, Monaco selector, host element id or host DOM hierarchy
 * appears anywhere in this file: the kernel is selector-free (§13) and the
 * adapter answers BLOCKED until live DOM reconnaissance — the separate
 * `gmux-recon.user.js` artifact — yields candidates that a human reviews into
 * `github-dev` adapter revision 1 (§42/§50/§51/§72). A selector is evidence,
 * not truth, and acquiring it is not this file's job.
 *
 * Section order is the §72 mandated artifact order:
 *   1 constants · 2 logging · 3 storage · 4 environment · 5 adapter contract
 *   6 capability detection · 7 state · 8 reducer · 9 dispatcher · 10 scheduler
 *   11 stabilization · 12 action engine · 13 shell · 14 surfaces · 15 styles
 *   16 diagnostics · 17 reconciliation/observers · 18 input · 19 bootstrap
 *
 * Constraints honoured (§3): no @require · no @connect · no GM_xmlhttpRequest ·
 * no network request · no framework · no iframe · no Git implementation · no
 * terminal implementation · no repository indexing · no AI · no completion ·
 * no Monaco internals · no parallel file tree · no parallel editor model · no
 * host DOM rewrite · no continuous polling · no silently ignored adapter
 * failure · no capability claimed merely because an element exists.
 */
(function () {
'use strict';

/* =============================================================================
 * §2 CONSTANTS
 * ===========================================================================*/

const VERSION = "0.1.0";                                  // §4/§5
const OWNER = "github-dev-mobile";                         // §23 ownership marker
const ROOT_ID = "gmux-root";                               // §23 gmux- prefix rule
const OWNER_SELECTOR =                                     // §24 singleton lookup
  '[data-gmux-owner="github-dev-mobile"][data-gmux-root="true"]';
const STYLE_SELECTOR = "[data-gmux-style]";                 // §28 one style node
const STORAGE_KEY = "github-dev-mobile:v1";                 // §37
const HOST = "github.dev";                                  // §4/§59 host boundary
const KILL_PARAM = "gmux";                                  // §38 kill switch
const KILL_PARAM_OFF = "off";
const KILL_PARAM_ON = "on";                                 // recovery escape hatch
const KEYBOARD_THRESHOLD = 150;                             // §8 — HEURISTIC
const MOBILE_MAX_WIDTH = 600;                               // §7
const COMPACT_MAX_WIDTH = 1024;                             // §7
const STABILITY_TIMEOUT = 1000;                             // §20 engineering
const STABILITY_QUIET = 100;                                // §20 parameters
const TOUCH_TARGET = 44;                                    // §34 design target
const MAX_LOG_EVENTS = 60;                                  // §58 bounded ring
const MAX_REASON_CHARS = 96;                                // §26 reason channel

/** The only permitted state transitions (§10). */
const ACTION = Object.freeze({
  ENVIRONMENT_CHANGED: "ENVIRONMENT_CHANGED",
  OPEN_SURFACE_REQUEST: "OPEN_SURFACE_REQUEST",
  SURFACE_COMMITTED: "SURFACE_COMMITTED",
  SURFACE_REJECTED: "SURFACE_REJECTED",
  CLOSE_SURFACE_REQUEST: "CLOSE_SURFACE_REQUEST",
  IMMERSIVE_TOGGLE: "IMMERSIVE_TOGGLE",
  KEYBOARD_CHANGED: "KEYBOARD_CHANGED",
  CAPABILITIES_CHANGED: "CAPABILITIES_CHANGED",
  BACK: "BACK",
  DIAGNOSTICS_OPEN: "DIAGNOSTICS_OPEN",
  DIAGNOSTICS_CLOSE: "DIAGNOSTICS_CLOSE",
  DISABLE: "DISABLE",
});

/** Action-result statuses (§19). Nothing else may be claimed. */
const STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  PARTIALLY_VERIFIED: "PARTIALLY_VERIFIED",
  PROVISIONAL: "PROVISIONAL",
  BLOCKED: "BLOCKED",
});

/** Observation confidence (§14). Numeric confidence is deliberately absent. */
const CONFIDENCE = Object.freeze({
  UNKNOWN: "UNKNOWN",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
});

/** Claim kinds, so a fact never blurs into a guess (§8/§58). */
const KIND = Object.freeze({
  OBSERVED: "OBSERVED",
  DERIVED: "DERIVED",
  HEURISTIC: "HEURISTIC",
  PROVISIONAL: "PROVISIONAL",
  VERIFIED: "VERIFIED",
  BLOCKED: "BLOCKED",
});

/** Surfaces GMUX may present. `editor` is the resting surface. */
const SURFACE = Object.freeze({
  EDITOR: "editor",
  EXPLORER: "explorer",
  SEARCH: "search",
  SOURCE_CONTROL: "sourceControl",
  TERMINAL: "terminal",
  DIAGNOSTICS: "diagnostics",
});

/**
 * Initial command registry (§26). Labels are display strings, not host
 * mappings: they carry no operational claim. Enabled state is derived from
 * capability policy at render time, so nothing dead is presented as live.
 */
const surfaceCommands = [
  ["explorer", "Files"],
  ["search", "Search"],
  ["sourceControl", "Git"],
  ["terminal", "Terminal"],
];

/** Preference defaults (§37) — configuration only, never host truth. */
const PREF_DEFAULTS = Object.freeze({
  version: 1,
  mode: "auto",
  immersive: true,
  preferredSurface: "editor",
  bottomBar: true,
  disabled: false,
});
const PREF_MODES = Object.freeze(["auto", "mobile", "compact", "desktop"]);

const HAS_DOM = typeof window !== "undefined" && typeof document !== "undefined";

/* =============================================================================
 * §3 LOGGING
 *
 * One bounded, offline log. Failures surface through diagnostics instead of
 * reaching the host (§59). No telemetry, no network (§3).
 * ===========================================================================*/

const log = { events: [], total: 0, errors: 0 };

function nowMs() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch (e) { /* fall through to wall clock */ }
  return Date.now();
}

function pushEvent(level, message, detail) {
  log.total++;
  if (level === "error") log.errors++;
  log.events.push({
    at: nowMs(),
    level,
    message: String(message),
    detail: detail === undefined || detail === null ? null : String(detail).slice(0, 240),
  });
  if (log.events.length > MAX_LOG_EVENTS) log.events.shift();
}

function consoleLine(level, message, detail) {
  try {
    const text = `[${OWNER}] ${message}`;
    if (level === "error" && console.error) console.error(text, detail === undefined ? "" : detail);
    else if (level === "warn" && console.warn) console.warn(text, detail === undefined ? "" : detail);
  } catch (e) { /* logging must never break the host */ }
}

const logInfo = (m, d) => pushEvent("info", m, d);
const logWarn = (m, d) => { pushEvent("warn", m, d); consoleLine("warn", m, d); };
const logError = (m, d) => { pushEvent("error", m, d); consoleLine("error", m, d); };

/* =============================================================================
 * §4 STORAGE — versioned UI preferences (§37)
 *
 * Read defensively: absent, unreadable or corrupt storage MUST NOT prevent
 * github.dev from loading. Preferences are configuration, never host truth,
 * and never a source of capability claims.
 * ===========================================================================*/

function rawPreference() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return { storageError: (e && e.name) || "unavailable" };
  }
}

/** @returns {{prefs: object, issues: string[]}} never throws (§37) */
function loadPreferences() {
  const issues = [];
  const note = (code) => { issues.push(code); logInfo("preference-issue", code); };
  const prefs = Object.assign({}, PREF_DEFAULTS);
  const raw = rawPreference();

  if (raw && typeof raw === "object" && raw.storageError) {
    note(`storage-unavailable:${raw.storageError}`);
    return { prefs, issues };
  }
  if (typeof raw !== "string" || raw.length === 0) {
    return { prefs, issues };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // §37: corrupt storage degrades to defaults and continues. The issue is
    // recorded where it is detected, so no early return can lose it.
    note("preference-parse-failed");
    return { prefs, issues };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    note("preference-not-an-object");
    return { prefs, issues };
  }
  if ("version" in parsed && parsed.version !== PREF_DEFAULTS.version) {
    note("preference-version-mismatch");
  }
  for (const key of Object.keys(PREF_DEFAULTS)) {
    if (key === "version" || !(key in parsed)) continue;
    const value = parsed[key];
    if (key === "mode") {
      if (PREF_MODES.indexOf(value) !== -1) prefs.mode = value;
      else note("preference-mode-invalid");
    } else if (key === "preferredSurface") {
      if (isKnownSurface(value)) prefs.preferredSurface = value;
      else note("preference-surface-unknown");
    } else if (typeof value !== typeof PREF_DEFAULTS[key]) {
      note(`preference-${key}-type-invalid`);
    } else {
      prefs[key] = value;
    }
  }
  return { prefs, issues };
}

function savePreferences(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch (e) {
    // A storage failure is a preference failure, never a host failure (§37).
    logInfo("preference-save-skipped", (e && e.name) || "unavailable");
    return false;
  }
}

/* =============================================================================
 * §5 ENVIRONMENT — observational and host-independent (§7/§8)
 *
 * Classification uses viewport geometry and pointer/touch signals only. It is
 * never inferred from user-agent, "Android" detection or browser brand (§7).
 * ===========================================================================*/

function getEnvironment() {
  if (!HAS_DOM) {
    return { width: 0, height: 0, orientation: "landscape", coarsePointer: false, touchPoints: 0 };
  }
  const viewport = window.visualViewport;

  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;

  return {
    width,
    height,
    orientation: width >= height ? "landscape" : "portrait",
    // Guarded so a host without matchMedia degrades instead of throwing;
    // semantics are identical wherever matchMedia exists.
    coarsePointer:
      typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : false,
    touchPoints: (typeof navigator !== "undefined" && navigator.maxTouchPoints) || 0,
  };
}

function classifyViewport(env) {
  if (env.width < MOBILE_MAX_WIDTH) {
    return "mobile";
  }
  if (env.width < COMPACT_MAX_WIDTH) {
    return "compact";
  }
  return "desktop";
}

/**
 * §8 HEURISTIC — explicitly NOT definitive keyboard detection. It reports only
 * that the visual viewport is shorter than the window by more than
 * KEYBOARD_THRESHOLD px.
 */
function keyboardLikelyVisible() {
  if (!HAS_DOM) return false;
  const vv = window.visualViewport;
  if (!vv) {
    return false;
  }
  return window.innerHeight - vv.height > KEYBOARD_THRESHOLD;
}

/**
 * §37: `mode` is configuration, so an explicit user override is honoured while
 * measurement stays untouched. The returned basis keeps the OBSERVED input and
 * the DERIVED label separable in diagnostics (§8/§58).
 */
function resolveMode(measuredMode, preferredMode) {
  if (preferredMode && preferredMode !== "auto" && PREF_MODES.indexOf(preferredMode) !== -1) {
    return { mode: preferredMode, source: "configuration-override" };
  }
  return { mode: measuredMode, source: "viewport-classification" };
}

/* =============================================================================
 * §6 HOST ADAPTER CONTRACT (§12) — INTENTIONALLY INCOMPLETE
 *
 * This is the whole adapter for v0.1, and it is deliberately a boundary stub:
 * it detects the host, reports what it can actually see (nothing, yet), and
 * refuses to act or claim. Adding a guessed selector here would violate §12
 * and §13, and would let a "successful" DOM query masquerade as a working
 * feature (§15). Real mappings arrive only as reviewed Recon evidence under a
 * bumped `adapterRevision` (§50/§52/§56).
 *
 *   GMUX kernel → generic surface/action → this adapter → GitHub/VS Code DOM
 *                                                    (§13)
 * ===========================================================================*/

const GitHubDevAdapter = {
  id: "github-dev",
  revision: 0,

  detectEnvironment() {
    // `typeof` guards keep this total: a host with a frozen or absent
    // `location` gets `false` instead of a ReferenceError (§59 containment).
    const host = HAS_DOM && typeof location !== "undefined" ? location.hostname : null;
    return host === HOST;
  },

  observe() {
    return {
      editor: this.findEditor(),
      explorer: this.findExplorer(),
      search: this.findSearch(),
      sourceControl: this.findSourceControl(),
      terminal: this.findTerminal(),
    };
  },

  resolveSurface(surface) {
    return {
      status: "BLOCKED",
      surface,
      reason: "No verified host mapping yet.",
    };
  },

  invoke(action) {
    return {
      status: "BLOCKED",
      action,
      reason: "GitHub-specific interaction not verified.",
    };
  },

  verify(action, before, after) {
    return {
      status: "BLOCKED",
      action,
      before,
      after,
      reason: "Verification contract not implemented.",
    };
  },

  restore(snapshot) {
    return {
      status: "PROVISIONAL",
      snapshot,
    };
  },

  // Every host lookup answers null until reviewed evidence replaces it. A
  // non-null return here without a verified mapping would be a guess, so
  // there is deliberately nothing to guess with (§12/§68).
  findEditor() { return null; },
  findExplorer() { return null; },
  findSearch() { return null; },
  findSourceControl() { return null; },
  findTerminal() { return null; },
};

/* =============================================================================
 * §7 OBSERVATION + CAPABILITY DETECTION (§14/§15)
 *
 * Observation records preserve evidence. Capabilities are DERIVED from
 * observations; an element existing is never treated as operational proof.
 * ===========================================================================*/

function makeObservationRecord(surface, detected, strategy, confidence, evidence) {
  return {
    surface,
    detected: !!detected,
    evidence: evidence || [],
    strategy: strategy || null,
    confidence: confidence || CONFIDENCE.UNKNOWN,
  };
}

/**
 * One adapter value → one §14 record. A v0.1 adapter returns elements or null,
 * so the confidence of any hit is UNKNOWN. A later adapter may return the
 * richer §15 record form (`{detected, confidence, strategy, evidence}`) and is
 * then honoured verbatim — nothing here promotes confidence on its own.
 */
function normalizeRecord(surface, value) {
  if (value && typeof value === "object" && "detected" in value) {
    return {
      ...value,
      surface,
      detected: !!value.detected,
      evidence: Array.isArray(value.evidence) ? value.evidence : [],
      strategy: value.strategy || null,
      confidence: CONFIDENCE[value.confidence] || CONFIDENCE.UNKNOWN,
    };
  }
  // §14/§68: a bare query hit has no strategy and no interaction evidence, so
  // it can only be UNKNOWN — never enough to claim a capability.
  return makeObservationRecord(surface, value !== null && value !== undefined, null, CONFIDENCE.UNKNOWN, []);
}

function observeSurfaces(adapter) {
  const observed = adapter.observe();
  const records = {};
  for (const key of Object.keys(observed)) {
    records[key] = normalizeRecord(key, observed[key]);
  }
  return { observed, records };
}

/**
 * §15 initial capability form — booleans, nothing more. `isDetected` keeps the
 * §15 upgrade path (record-valued observations) from inverting `!!{...}` into a
 * false positive; for element-or-null observations the two are identical.
 */
function isDetected(value) {
  if (value && typeof value === "object" && "detected" in value) return !!value.detected;
  return value !== null && value !== undefined;
}

function detectCapabilities(observation) {
  return {
    editor: isDetected(observation.editor),
    explorer: isDetected(observation.explorer),
    search: isDetected(observation.search),
    sourceControl: isDetected(observation.sourceControl),
    terminal: isDetected(observation.terminal),
  };
}

function sameCapabilities(a, b) {
  const keys = Object.keys(b || {});
  if (Object.keys(a || {}).length !== keys.length) return false;
  return keys.every((k) => !!a[k] === !!b[k]);
}

/**
 * Capability gate used by action preconditions (§17). It returns a decision
 * rather than a boolean so the reason survives into diagnostics: §68 forbids
 * collapsing UNKNOWN into FALSE.
 */
function capability(name) {
  const caps = GMUX.state ? GMUX.state.capabilities : {};
  const resolved = GMUX.adapter.resolveSurface(name);
  if (!caps[name]) {
    return {
      ok: false,
      reason: resolved && resolved.reason
        ? `capability-unknown (${resolved.reason})`
        : "capability-unknown",
      status: STATUS.BLOCKED,
      surface: name,
    };
  }
  if (!resolved || resolved.status !== STATUS.VERIFIED) {
    return {
      ok: false,
      status: resolved && resolved.status ? resolved.status : STATUS.PROVISIONAL,
      reason: `detected but unverified (${(resolved && resolved.reason) || "no mapping"})`,
      surface: name,
    };
  }
  return { ok: true, reason: null, status: STATUS.VERIFIED, surface: name };
}

/**
 * §18/§19 verification primitive. A transition may only be promoted when it is
 * actually visible in the before/after records; the absence of a post-action
 * observation yields BLOCKED, never "probably works". HIGH confidence is
 * required because §55 forbids mutation-driven false VERIFIED.
 */
/**
 * Which way is the surface pointing? `detected` answers "does the host expose
 * this control/view at all" (capability), while `open` answers "is the surface
 * currently visible" (transition). A v0.1-style record has no `open` field, so
 * existence stands in for presence; a verified adapter supplies the real axis.
 */
function isOpenRecord(record) {
  if (!record || typeof record !== "object") return null;
  if (typeof record.open === "boolean") return record.open;
  if (typeof record.detected !== "boolean") return null;
  return !!record.detected;
}

function verifyTransition(before, after, expected) {
  const wantOpen = expected !== "closed";
  if (!after || typeof after.detected !== "boolean") {
    return {
      status: STATUS.BLOCKED,
      reason: "no post-action observation available",
      evidence: { before: before ? String(isOpenRecord(before)) : "unobserved", after: null },
    };
  }
  const beforeOpen = isOpenRecord(before);
  const afterOpen = isOpenRecord(after);
  const evidence = {
    before: beforeOpen === null ? "unobserved" : (beforeOpen ? "open" : "closed"),
    after: afterOpen ? "open" : "closed",
    confidence: after.confidence,
  };
  if (after.confidence !== CONFIDENCE.HIGH) {
    return { status: STATUS.BLOCKED, reason: `post-state confidence is ${after.confidence}, below HIGH`, evidence };
  }
  if (afterOpen !== wantOpen) {
    return { status: STATUS.BLOCKED, reason: `expected ${wantOpen ? "open" : "closed"}, observed ${evidence.after}`, evidence };
  }
  // §18: the transition itself must be visible. A "successful" call that left
  // the host exactly where it was is not evidence of anything.
  if (beforeOpen === null) {
    return { status: STATUS.BLOCKED, reason: "no pre-action observation to compare against", evidence };
  }
  if (beforeOpen === afterOpen) {
    return { status: STATUS.BLOCKED, reason: "no state transition was observed", evidence };
  }
  return { status: STATUS.VERIFIED, evidence };
}

/* =============================================================================
 * §8 STATE (§9)
 *
 * GMUX-owned presentation/intent state only. Host-owned facts — repository,
 * branch, file, cursor, selection, editor model, terminal session, git status
 * — are deliberately absent: the host stays authoritative (§2/§9), so GMUX
 * never maintains a parallel copy that could drift.
 * ===========================================================================*/

const initialState = {
  mode: "desktop",
  surface: "editor",
  previousSurface: null,
  immersive: false,
  drawer: null,
  keyboardVisible: false,
  capabilities: {},
  pendingAction: null,
  diagnostics: {
    observations: 0,
    reconciliations: 0,
    lastError: null,
  },
};

function isKnownSurface(name) {
  return name === SURFACE.EDITOR
    || name === SURFACE.EXPLORER
    || name === SURFACE.SEARCH
    || name === SURFACE.SOURCE_CONTROL
    || name === SURFACE.TERMINAL
    || name === SURFACE.DIAGNOSTICS;
}

/**
 * §40 internal navigation stack, derived from GMUX presentation state. No
 * browser history entry is ever created for a GMUX surface — the stack is
 * state-only, so Back can be served without polluting or trapping history.
 */
function navStack(state) {
  return state.surface === SURFACE.EDITOR ? ["editor"] : ["editor", state.surface];
}

/* =============================================================================
 * §9 REDUCER (§10)
 *
 * Pure: never touches the DOM, never queries the host. Every transition goes
 * through one of these twelve actions (§69: REQUEST → PENDING → HOST ACTION →
 * OBSERVE → VERIFY → COMMIT, else REJECT).
 * ===========================================================================*/

function reducer(state, action) {
  switch (action.type) {
    case ACTION.ENVIRONMENT_CHANGED:
      if (state.mode === action.mode) return state;
      return { ...state, mode: action.mode };

    case ACTION.OPEN_SURFACE_REQUEST:
      if (!isKnownSurface(action.surface) || action.surface === SURFACE.EDITOR) return state;
      if (state.surface === action.surface && state.drawer && state.drawer.surface === action.surface) {
        return state;                       // already there: no churn (§21)
      }
      return {
        ...state,
        pendingAction: { type: "open", surface: action.surface, at: nowMs() },
      };

    case ACTION.SURFACE_COMMITTED:
      if (!isKnownSurface(action.surface)) return state;
      return {
        ...state,
        previousSurface: state.surface,
        surface: action.surface,
        drawer: action.surface === SURFACE.EDITOR ? null : { kind: "surface", surface: action.surface },
        pendingAction: null,
      };

    case ACTION.SURFACE_REJECTED:
      return { ...state, pendingAction: null };

    case ACTION.CLOSE_SURFACE_REQUEST:
      // The GMUX presentation window is GMUX-owned, so it closes at once; the
      // *host* surface returns to editor only after verification (§69), which
      // is why `surface` is untouched here.
      return {
        ...state,
        drawer: null,
        pendingAction: { type: "close", surface: state.surface, at: nowMs() },
      };

    case ACTION.IMMERSIVE_TOGGLE:
      return { ...state, immersive: !state.immersive };

    case ACTION.KEYBOARD_CHANGED:
      if (state.keyboardVisible === !!action.visible) return state;
      return { ...state, keyboardVisible: !!action.visible };

    case ACTION.CAPABILITIES_CHANGED:
      if (sameCapabilities(state.capabilities, action.capabilities)) return state;
      return { ...state, capabilities: action.capabilities };

    case ACTION.BACK: {
      const plan = planBack(state);
      return plan.action ? reducer(state, plan.action) : state;
    }

    case ACTION.DIAGNOSTICS_OPEN:
      if (state.drawer && state.drawer.kind === SURFACE.DIAGNOSTICS) return state;
      return { ...state, drawer: { kind: SURFACE.DIAGNOSTICS }, pendingAction: null };

    case ACTION.DIAGNOSTICS_CLOSE:
      if (!state.drawer || state.drawer.kind !== SURFACE.DIAGNOSTICS) return state;
      return { ...state, drawer: null };

    case ACTION.DISABLE:
      return { ...state, disabled: true, drawer: null, pendingAction: null, surface: SURFACE.EDITOR };

    default:
      return state;
  }
}

/**
 * §39 Back priority — one pure decision table shared by the reducer and the
 * input layer, so the two can never drift:
 *
 *   Diagnostics open → close · Drawer open → close · Secondary surface →
 *   editor · otherwise do NOT consume browser Back.
 *
 * The secondary-surface step returns no reducer action: closing a host surface
 * is a host operation and must run through the action engine (§16).
 */
function planBack(state) {
  if (state.drawer && state.drawer.kind === SURFACE.DIAGNOSTICS) {
    return { consume: true, step: "diagnostics", action: { type: ACTION.DIAGNOSTICS_CLOSE }, command: null };
  }
  if (state.drawer) {
    return {
      consume: true,
      step: "drawer",
      action: { type: ACTION.CLOSE_SURFACE_REQUEST },
      command: state.drawer.surface ? `close-${state.drawer.surface}` : null,
    };
  }
  if (state.surface !== SURFACE.EDITOR) {
    return {
      consume: true,
      step: "secondary-surface",
      action: null,
      command: `close-${state.surface}`,
    };
  }
  return { consume: false, step: "browser-default", action: null, command: null };
}

/* =============================================================================
 * §10 DISPATCHER (§11)
 *
 * UI controls never mutate state. Required flow:
 *   CONTROL → dispatch() → reducer() → STATE → reconcile()
 * ===========================================================================*/

function dispatch(action) {
  if (!GMUX.state || !action || !action.type) return false;
  const current = GMUX.state;
  const next = reducer(current, action);
  if (next !== current) {
    GMUX.state = next;
    scheduleReconcile();
    return true;
  }
  return false;
}

/**
 * Observation-derived transitions use the same reducer, but must not re-enter
 * the scheduler — otherwise reconcile would keep rescheduling itself (§21:
 * idempotent, convergent, safe to repeat).
 */
function applyObserved(action) {
  if (!GMUX.state || !action || !action.type) return false;
  const current = GMUX.state;
  const next = reducer(current, action);
  if (next === current) return false;
  GMUX.state = next;
  return true;
}

/* =============================================================================
 * §11 SCHEDULER (§22)
 *
 * Invariant: N mutations → ≤ 1 pending reconciliation.
 * ===========================================================================*/

let scheduled = false;

function scheduleReconcile() {
  if (scheduled) {
    return;
  }
  scheduled = true;
  scheduleFrame(() => {
    scheduled = false;
    try {
      reconcile();
    } catch (error) {
      if (GMUX.state) {
        GMUX.state.diagnostics.lastError = String(error);
      }
      logError("reconcile failed", error);
      if (console && console.error) {
        console.error("[GMUX] reconcile failed", error);
      }
    }
  });
}

/** rAF is the contract; a microtask fallback keeps hosts without rAF correct. */
function scheduleFrame(fn) {
  try {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => fn());
      return;
    }
  } catch (e) { /* host without rAF */ }
  Promise.resolve().then(() => fn());
}

/* =============================================================================
 * §12 STABILIZATION (§20)
 *
 * Bounded and mutation-aware. Never an infinite loop: a quiet window resolves
 * success, the deadline resolves failure, and both paths disconnect. The
 * numbers are initial engineering parameters, not universal truths.
 * ===========================================================================*/

function waitForStability({ timeout = STABILITY_TIMEOUT, quiet = STABILITY_QUIET } = {}) {
  if (!HAS_DOM || typeof MutationObserver !== "function" || !(document.body || document.documentElement)) {
    return Promise.resolve({ settled: false, reason: "no-dom", elapsed: 0, mutations: 0 });
  }
  const start = nowMs();
  return new Promise((resolve) => {
    const target = document.body || document.documentElement;
    let mutations = 0;
    let finished = false;
    let quietTimer = null;
    let deadline = null;
    let observer = null;

    const finish = (settled, reason) => {
      if (finished) return;
      finished = true;
      if (observer) observer.disconnect();
      if (quietTimer) clearTimeout(quietTimer);
      if (deadline) clearTimeout(deadline);
      resolve({ settled, reason, elapsed: Math.max(0, nowMs() - start), mutations });
    };

    const armQuiet = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(true, "quiet"), quiet);
    };

    observer = new MutationObserver((records) => {
      mutations += records && records.length ? records.length : 1;
      armQuiet();
    });
    try {
      observer.observe(target, { childList: true, subtree: true, attributes: true });
    } catch (e) {
      finish(false, "observer-unavailable");
      return;
    }
    // Deterministic termination even if the host never mutates again.
    deadline = setTimeout(() => finish(false, "timeout"), Math.max(timeout, quiet + 1));
    armQuiet();
  });
}

/* =============================================================================
 * §13 ACTION ENGINE (§16/§17/§18/§19)
 *
 * Every host interaction passes through here. No mobile-UI handler ever calls
 * element.click(): handlers dispatch intent, the engine actuates through the
 * adapter, re-observes, and only then may anything be committed.
 *
 *   REQUEST → PENDING → HOST ACTION → OBSERVE → VERIFY → COMMIT | REJECT §69
 *
 * Transaction model for reversible host operations (§18):
 *   SNAPSHOT → ACTION → OBSERVE → VERIFY → (PASS → COMMIT | FAIL → RESTORE)
 * ===========================================================================*/

const actions = buildActions(surfaceCommands);

function buildActions(commands) {
  const out = {};
  for (const [surface, label] of commands) {
    out[`open-${surface}`] = {
      id: `open-${surface}`,
      target: surface,
      label,
      precondition() { return capability(surface); },
      invoke() { return asInvoked(GMUX.adapter.invoke(`open-${surface}`)); },
      verify(before, after) {
        return adapterVerify(`open-${surface}`, surface, "open", before, after);
      },
      reversible: true,
    };
    out[`close-${surface}`] = {
      id: `close-${surface}`,
      target: surface,
      label,
      precondition() { return capability(surface); },
      invoke() { return asInvoked(GMUX.adapter.invoke(`close-${surface}`)); },
      verify(before, after) {
        return adapterVerify(`close-${surface}`, surface, "closed", before, after);
      },
      reversible: true,
    };
  }
  out["focus-editor"] = {
    id: "focus-editor",
    target: SURFACE.EDITOR,
    label: "Editor",
    precondition() { return capability(SURFACE.EDITOR); },
    invoke() { return asInvoked(GMUX.adapter.invoke("focus-editor")); },
    // §31: Monaco is a black box. A focus request has no observable host
    // transition GMUX can verify, so it may never claim more than BLOCKED.
    verify(before, after) {
      return {
        status: STATUS.BLOCKED,
        action: "focus-editor",
        reason: "Focus request has no verifiable host transition in v0.1.",
        evidence: { before: "unobserved", after: "unobserved" },
      };
    },
    reversible: false,   // a focus request is not a state transition
  };
  return out;
}

/**
 * An adapter result is authoritative when it verifies; otherwise the observed
 * transition decides. Neither path may manufacture a claim (§19/§68).
 */
function adapterVerify(actionId, surface, expected, before, after) {
  const mapped = GMUX.adapter.verify(actionId, before, after);
  if (mapped && mapped.status === STATUS.VERIFIED) return withAction(mapped, actionId);

  const observed = verifyTransition(before[surface], after[surface], expected);
  if (observed.status === STATUS.VERIFIED) return withAction(observed, actionId);

  return withAction({
    ...observed,
    reason: mapped && mapped.reason ? `${observed.reason}; adapter: ${mapped.reason}` : observed.reason,
  }, actionId);
}

function asInvoked(result) {
  if (!result || typeof result !== "object") {
    return { ok: false, status: STATUS.BLOCKED, reason: "adapter returned no result" };
  }
  if (typeof result.ok === "boolean") return result;
  return Object.assign({}, result, {
    ok: result.status === STATUS.VERIFIED || result.status === STATUS.PARTIALLY_VERIFIED,
    reason: result.reason || `adapter status ${result.status}`,
  });
}

function withAction(result, actionId) {
  if (!result || typeof result !== "object") {
    return { status: STATUS.BLOCKED, action: actionId, reason: "verify returned no result" };
  }
  return Object.assign({ action: actionId }, result);
}

/** §16 required engine: unknown → precondition → before → invoke → settle → after → verify. */
async function executeAction(actionId) {
  const action = actions[actionId];
  if (!action) {
    return { status: STATUS.BLOCKED, reason: "unknown-action" };
  }

  const pre = action.precondition();
  if (!pre.ok) {
    const blocked = {
      status: pre.status || STATUS.BLOCKED,
      action: actionId,
      reason: pre.reason,
      evidence: { before: "unobserved", after: "unobserved" },
    };
    reject(blocked);
    logInfo(`action ${actionId} → ${blocked.status}`, blocked.reason);
    return blocked;
  }

  const before = GMUX.adapter.observe();
  const invoked = asInvoked(await action.invoke());
  if (!invoked.ok) {
    const blocked = {
      status: invoked.status || STATUS.BLOCKED,
      action: actionId,
      reason: invoked.reason || "invocation refused",
      evidence: { before: "unobserved", after: "unobserved" },
    };
    reject(blocked);
    logInfo(`action ${actionId} → ${blocked.status}`, blocked.reason);
    return blocked;
  }

  await waitForStability();
  const after = GMUX.adapter.observe();
  const result = withAction(action.verify(recordsFrom(before), recordsFrom(after)), actionId);

  if (result.status === STATUS.VERIFIED || result.status === STATUS.PARTIALLY_VERIFIED) {
    commit(actionId, action, result);
  } else {
    // §18 FAIL → RESTORE. A successful JavaScript call is never evidence that
    // the host UI transitioned, so the snapshot path runs and nothing commits.
    let restore = null;
    if (action.reversible) {
      const r = GMUX.adapter.restore(before);
      restore = r && r.status ? r.status : STATUS.PROVISIONAL;
    }
    result.restore = restore;
    // §3: adapter failure is never silently ignored, so the fail path states
    // what it did about restoration instead of hiding it in a log line.
    result.reason = `${result.reason || "verification failed"}; restore ${
      action.reversible ? `${restore} (attempted, not verified)` : "not applicable"
    }`;
    reject(result);
  }
  logInfo(`action ${actionId} → ${result.status}`, result.reason || undefined);
  return result;
}

/** Raw adapter observation → §14 records (idempotent, no host mutation). */
function recordsFrom(observation) {
  const records = {};
  for (const key of Object.keys(observation || {})) {
    records[key] = normalizeRecord(key, observation[key]);
  }
  return records;
}

function commit(actionId, action, result) {
  const surface = action.target;
  const next = actionId.startsWith("close-") ? SURFACE.EDITOR : surface;
  applyObserved({ type: ACTION.SURFACE_COMMITTED, surface: next });
  if (result.status === STATUS.PARTIALLY_VERIFIED) {
    logWarn(`committed ${next} on partial verification`, actionId);
  }
  scheduleReconcile();
}

function reject(result) {
  if (GMUX.state && GMUX.state.pendingAction) {
    applyObserved({ type: ACTION.SURFACE_REJECTED });
    logInfo("pending action rejected — host remains authoritative", result && result.reason);
  }
  scheduleReconcile();
}

/**
 * Shell command entry point. §26 capability policy decides what may be
 * attempted at all: BLOCKED never reaches the host, PROVISIONAL and VERIFIED
 * run the full engine. Dead controls are never exercised as though they work.
 */
function requestSurface(surface, direction) {
  if (!isKnownSurface(surface) || surface === SURFACE.EDITOR) {
    return Promise.resolve({ status: STATUS.BLOCKED, action: null, reason: "not-a-host-surface" });
  }
  const id = direction === "close" ? `close-${surface}` : `open-${surface}`;
  const gate = capability(surface);

  if (gate.status === STATUS.BLOCKED) {
    const result = {
      status: STATUS.BLOCKED,
      action: id,
      reason: gate.reason || "no verified host mapping",
      attempted: false,
      evidence: { before: "unobserved", after: "unobserved" },
    };
    showReason(result);
    logInfo(`withheld ${id} (§26: never render dead controls as live)`, result.reason);
    return Promise.resolve(result);
  }

  dispatch(
    direction === "close"
      ? { type: ACTION.CLOSE_SURFACE_REQUEST }
      : { type: ACTION.OPEN_SURFACE_REQUEST, surface }
  );
  if (gate.status === STATUS.PROVISIONAL) showReason({ status: gate.status, action: id, reason: gate.reason });
  return executeAction(id).then((result) => {
    showReason(result);
    return result;
  });
}

/** Last reason surfaced to the user — presentation bookkeeping, not kernel
 *  state, because §9 freezes the state contract. */
const lastReason = { value: null, at: 0 };

function showReason(result) {
  lastReason.value = result && result.reason
    ? `${result.status} · ${String(result.reason)}`.slice(0, MAX_REASON_CHARS)
    : result
      ? `${result.status} — no reason recorded`
      : null;
  lastReason.at = nowMs();
  scheduleReconcile();
}

/* =============================================================================
 * §14 SURFACE STATUS (§26)
 *
 * Generic status query used by rendering and by the engine. The kernel never
 * inspects the host here: it asks the adapter, which owns host knowledge.
 * ===========================================================================*/

function surfaceStatus(surface) {
  const gate = capability(surface);
  return {
    surface,
    capability: !!(GMUX.state && GMUX.state.capabilities && GMUX.state.capabilities[surface]),
    status: gate.status,
    reason: gate.reason,
    enabled: gate.ok || gate.status === STATUS.PROVISIONAL,
    kind: gate.status === STATUS.VERIFIED ? KIND.VERIFIED
      : gate.status === STATUS.PROVISIONAL ? KIND.PROVISIONAL
      : KIND.BLOCKED,
  };
}

/* =============================================================================
 * §15 STYLES + SHELL (§23–§28)
 *
 * GMUX owns exactly one root and only its own subtree. Controls are created
 * once at bootstrap and updated by attribute during reconciliation (§25):
 * nothing is destroyed-and-recreated, and no host node is rewritten (§3).
 * ===========================================================================*/

function installStyles() {
  if (!HAS_DOM) return null;
  const existing = document.querySelector(STYLE_SELECTOR);
  if (existing) {
    return existing;                                  // §28: exactly one node
  }
  const style = document.createElement("style");
  style.dataset.gmuxStyle = "true";
  style.textContent = GMUX_CSS;
  document.head.appendChild(style);
  return style;
}

/**
 * GMUX-owned styling only: every rule is scoped under the ownership marker
 * with `gmux-` prefixed ids/classes. No universal selectors, no !important,
 * no host classes, and no global body/overflow rule (§28/§32). Scroll
 * ownership stays explicit — only GMUX's own report body scrolls.
 */
const GMUX_CSS = `
[data-gmux-owner="${OWNER}"]{position:fixed;inset:0;z-index:2147483000;pointer-events:none;
 font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
 --gmux-bg:rgba(24,24,27,.97);--gmux-border:rgba(128,128,140,.36);--gmux-accent:#3d8ce0;
 --gmux-inset-top:env(safe-area-inset-top,0px);--gmux-inset-right:env(safe-area-inset-right,0px);
 --gmux-inset-bottom:env(safe-area-inset-bottom,0px);--gmux-inset-left:env(safe-area-inset-left,0px);}
#gmux-root{display:flex;flex-direction:column;}
#gmux-header,#gmux-toolbar{pointer-events:auto;background:var(--gmux-bg);
 display:flex;align-items:center;gap:2px;}
#gmux-header{min-height:${TOUCH_TARGET}px;border-bottom:1px solid var(--gmux-border);
 padding:2px calc(4px + var(--gmux-inset-right)) 2px calc(4px + var(--gmux-inset-left));}
#gmux-toolbar{min-height:${TOUCH_TARGET}px;border-top:1px solid var(--gmux-border);margin-top:auto;
 padding:2px calc(4px + var(--gmux-inset-right)) calc(2px + var(--gmux-inset-bottom)) calc(4px + var(--gmux-inset-left));}
#gmux-content{flex:1 1 auto;display:flex;align-items:flex-end;justify-content:center;padding:8px;}
.gmux-reason{pointer-events:auto;max-width:min(92vw,520px);background:var(--gmux-bg);
 border:1px solid var(--gmux-border);border-radius:8px;padding:8px 10px;}
.gmux-reason[hidden]{display:none;}
#gmux-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.42);pointer-events:auto;}
#gmux-backdrop[hidden]{display:none;}
#gmux-drawer{position:absolute;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;
 top:calc(${TOUCH_TARGET}px + var(--gmux-inset-top));
 bottom:calc(${TOUCH_TARGET}px + var(--gmux-inset-bottom));
 left:var(--gmux-inset-left);width:min(86vw,360px);background:var(--gmux-bg);
 border:1px solid var(--gmux-border);border-radius:0 10px 10px 0;}
#gmux-drawer[hidden]{display:none;}
#gmux-root[data-mode="landscape"] #gmux-drawer{width:min(60vw,420px);}
#gmux-root[data-keyboard="true"] #gmux-drawer{bottom:var(--gmux-inset-bottom);}
.gmux-drawer-head{display:flex;align-items:center;gap:6px;min-height:${TOUCH_TARGET}px;
 padding:6px 6px 6px 10px;border-bottom:1px solid var(--gmux-border);}
.gmux-drawer-title{flex:1 1 auto;font-weight:600;}
.gmux-drawer-body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 10px;}
.gmux-btn{appearance:none;-webkit-appearance:none;background:transparent;border:1px solid transparent;
 color:inherit;font:inherit;border-radius:8px;padding:2px 6px;cursor:pointer;
 /* §34 design target: ≥44×44 CSS px hit area, small visual label inside it. */
 min-width:${TOUCH_TARGET}px;min-height:${TOUCH_TARGET}px;
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;}
#gmux-toolbar .gmux-btn{flex:1 1 0;min-width:0;}
.gmux-btn-icon{font-size:18px;line-height:1.1;}
.gmux-btn-label{font-size:10px;opacity:.85;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gmux-btn[aria-pressed="true"]{color:var(--gmux-accent);}
.gmux-btn[aria-disabled="true"]{opacity:.42;cursor:default;}
.gmux-btn[data-pending="true"]{opacity:.7;}
.gmux-report{white-space:pre-wrap;word-break:break-word;margin:0;
 font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;}
@media (max-width:360px){.gmux-btn-label{display:none;}}
@media (prefers-reduced-motion:reduce){.gmux-btn{transition:none;}}
`;

/** §24 shell singleton: repeated calls must yield exactly one owned root. */
function createShell() {
  // §24/§38: no DOM and no <body> mean nothing to own — never create a
  // detached root, and never throw into the host.
  if (!HAS_DOM || !document.body) return null;
  const existing = document.querySelector(OWNER_SELECTOR);
  if (existing) {
    if (!GMUX.shell) GMUX.shell = shellApi(existing, null);
    logInfo("shell already mounted — reusing the existing root (§24)");
    return GMUX.shell;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.dataset.gmuxOwner = OWNER;                 // §23 ownership marker
  root.dataset.gmuxRoot = "true";
  root.setAttribute("role", "presentation");
  // Hidden until the first render assigns a mode. Without this, a root with no
  // attributes would paint for one frame even on desktop (§27) — a visible
  // violation of "host presentation minimally affected".
  root.hidden = true;

  // §23 required structure, in order: header · content/controller layer ·
  // backdrop · drawer/surface container · bottom toolbar.
  const header = document.createElement("header");
  header.id = "gmux-header";

  const content = document.createElement("div");
  content.id = "gmux-content";
  content.setAttribute("role", "status");
  content.setAttribute("aria-live", "polite");
  const reason = document.createElement("div");
  reason.id = "gmux-reason";
  reason.className = "gmux-reason";
  reason.hidden = true;
  content.appendChild(reason);

  const backdrop = document.createElement("div");
  backdrop.id = "gmux-backdrop";
  backdrop.setAttribute("role", "presentation");
  backdrop.hidden = true;

  const drawer = document.createElement("section");
  drawer.id = "gmux-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "false");
  drawer.setAttribute("aria-label", "GMUX panel");
  drawer.hidden = true;
  const drawerHead = document.createElement("div");
  drawerHead.className = "gmux-drawer-head";
  const drawerTitle = document.createElement("div");
  drawerTitle.id = "gmux-drawer-title";
  drawerTitle.className = "gmux-drawer-title";
  drawerTitle.textContent = "GMUX";
  const drawerClose = document.createElement("button");
  drawerClose.id = "gmux-drawer-close";
  drawerClose.className = "gmux-btn";
  drawerClose.type = "button";
  drawerClose.setAttribute("aria-label", "Close panel");
  drawerClose.textContent = "×";
  drawerHead.append(drawerTitle, drawerClose);
  const drawerBody = document.createElement("div");
  drawerBody.id = "gmux-drawer-body";
  drawerBody.className = "gmux-drawer-body";
  drawer.append(drawerHead, drawerBody);

  const toolbar = document.createElement("nav");
  toolbar.id = "gmux-toolbar";
  toolbar.setAttribute("aria-label", "GMUX command bar");

  const back = makeButton("gmux-back", "Back", "‹");
  back.setAttribute("aria-label", "Back");
  const brand = document.createElement("div");
  brand.id = "gmux-title";
  brand.className = "gmux-btn-label";
  brand.textContent = HOST;
  const immersive = makeButton("gmux-immersive", "Immersive", "⛶");
  const menu = makeButton("gmux-menu", "Diagnostics", "☰");
  menu.setAttribute("aria-label", "GMUX diagnostics");
  header.append(back, brand, immersive, menu);
  root.append(header, content, backdrop, drawer, toolbar);

  /** @type {Record<string, any>} */
  const buttons = {};
  for (const [surface, label] of surfaceCommands) {
    const button = makeButton(`gmux-cmd-${surface}`, label, iconFor(surface));
    button.dataset.gmuxSurface = surface;
    toolbar.appendChild(button);
    buttons[surface] = button;
  }

  document.body.appendChild(root);
  const controls = { back, menu, immersive, brand, reason, drawer, drawerTitle, drawerClose, drawerBody, backdrop, buttons };
  wireShell(controls);
  GMUX.shell = shellApi(root, controls);
  logInfo("shell mounted — exactly one owned root (§24)");
  return GMUX.shell;
}

/** §59 names the factory `createMobileShell()`; it is the same singleton. */
function createMobileShell() {
  return createShell();
}

function makeButton(id, label, glyph) {
  const b = document.createElement("button");
  b.id = id;
  b.className = "gmux-btn";
  b.type = "button";
  const icon = document.createElement("span");
  icon.className = "gmux-btn-icon";
  icon.textContent = glyph;
  const text = document.createElement("span");
  text.className = "gmux-btn-label";
  text.textContent = label;
  b.append(icon, text);
  return b;
}

/** Purely decorative glyphs — never host icons, never a capability claim. */
function iconFor(surface) {
  if (surface === SURFACE.EXPLORER) return "▤";
  if (surface === SURFACE.SEARCH) return "⌕";
  if (surface === SURFACE.SOURCE_CONTROL) return "⑂";
  return "▸";
}

function shellApi(root, controls) {
  return {
    root,
    controls: controls || null,
    mounted: !!root,
    render(state, env) { render(state, env, controls); },
    destroy() {
      if (root && root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/* =============================================================================
 * §15b RENDERING POLICY (§27)
 *
 * Attributes only. Desktop → shell hidden and host presentation untouched;
 * compact → compact layer; mobile → active. Controls are never rebuilt here
 * (§25), and GMUX never writes to a host node (§3).
 * ===========================================================================*/

function render(state, env) {
  const shell = GMUX.shell;
  const root = shell && shell.root;
  if (!root) return;
  const controls = shell.controls;

  suppressObserver();
  try {
    root.dataset.mode = state.mode;
    root.dataset.surface = state.surface;
    root.hidden = state.mode === "desktop";
    root.dataset.immersive = String(!!state.immersive);
    root.dataset.keyboard = String(!!state.keyboardVisible);
    root.dataset.bottomBar = String(state.bottomBar !== false);
    if (controls) {
      renderHeader(state, env, controls);
      renderToolbar(state, controls);
      renderDrawer(state, controls);
      renderContent(state, controls);
    }
  } finally {
    resumeObserver();
  }
}

function renderHeader(state, env, controls) {
  const plan = planBack(state);
  if (controls.back) {
    controls.back.setAttribute("aria-disabled", plan.consume ? "false" : "true");
    controls.back.setAttribute("title", plan.consume
      ? `Close ${plan.step}`
      : "Nothing for GMUX to close — Back goes to the browser");
  }
  if (controls.immersive) {
    controls.immersive.setAttribute("aria-pressed", state.immersive ? "true" : "false");
    // §31: GMUX may hide its own chrome and request layout changes; hiding host
    // chrome needs a verified mapping, so the reason is stated, not hidden.
    controls.immersive.setAttribute("title", state.immersive
      ? "Immersive on — GMUX chrome only; host chrome needs a verified mapping (BLOCKED)"
      : "Immersive off");
  }
  if (controls.brand) {
    const surfaceLabel = state.surface === SURFACE.EDITOR ? "" : ` · ${state.surface}`;
    controls.brand.textContent =
      state.mode === "mobile" || !env ? `${HOST}${surfaceLabel}` : `${HOST} · ${env.orientation}${surfaceLabel}`;
  }
}

function renderToolbar(state, controls) {
  const pending = state.pendingAction;
  for (const [surface, label] of surfaceCommands) {
    const button = controls.buttons && controls.buttons[surface];
    if (!button) continue;
    const s = surfaceStatus(surface);
    button.setAttribute("aria-disabled", s.enabled ? "false" : "true");
    button.setAttribute("aria-pressed", state.surface === surface ? "true" : "false");
    button.dataset.pending = pending && pending.surface === surface ? "true" : "false";
    button.dataset.capability = s.status;
    button.setAttribute("title", s.enabled
      ? `${label} — ${s.status}`
      : `${label} unavailable — ${s.reason || "no verified host mapping"}`);
    button.setAttribute("aria-label", s.enabled ? label : `${label} (unavailable)`);
  }
}

/**
 * §30: the drawer is a presentation/windowing layer. GMUX owns the drawer, the
 * backdrop, the close control, positioning and the mobile viewport; the host
 * owns the file tree, file selection, file contents and workspace state. With
 * no verified mapping, the window states that plainly instead of faking a
 * second file tree.
 */
function renderDrawer(state, controls) {
  const open = !!state.drawer;
  if (controls.drawer) controls.drawer.hidden = !open;
  if (controls.backdrop) controls.backdrop.hidden = !open;
  if (!open || !controls.drawerBody) return;

  let title = "GMUX";
  let body;
  if (state.drawer.kind === SURFACE.DIAGNOSTICS) {
    title = "GMUX diagnostics";
    body = formatReport(buildReport());
  } else {
    const surface = state.drawer.surface || state.surface;
    const resolved = GMUX.adapter.resolveSurface(surface);
    title = `GMUX · ${surface}`;
    const lines = [`Host surface: ${surface}`, `Status: ${resolved.status}`];
    if (resolved.reason) lines.push(`Reason: ${resolved.reason}`);
    lines.push("");
    lines.push(
      resolved.status === STATUS.VERIFIED
        ? "GMUX positions this window over the host view; the file tree,"
        : "Presentation window only — GMUX has not been given a verified"
    );
    lines.push(
      resolved.status === STATUS.VERIFIED
        ? "selection and workspace stay owned by github.dev."
        : "mapping to the host view, so nothing is presented as working."
    );
    lines.push("");
    lines.push("No host nodes were reparented and no parallel tree exists (§30).");
    body = lines.join("\n");
  }
  // Re-render only on real change: keeps reconciliation convergent and stops
  // GMUX's own writes from re-triggering the host observer (§21/§35).
  if (controls.drawerBody.textContent !== body) {
    controls.drawerBody.replaceChildren(reportNode(body));
  }
  if (controls.drawerTitle && controls.drawerTitle.textContent !== title) {
    controls.drawerTitle.textContent = title;
  }
  if (controls.drawerClose) {
    controls.drawerClose.setAttribute(
      "aria-label",
      state.drawer.kind === SURFACE.DIAGNOSTICS ? "Close diagnostics" : "Close panel"
    );
  }
}

function renderContent(state, controls) {
  const reason = controls.reason;
  if (!reason) return;
  const pending = state.pendingAction;
  const text = pending
    ? `${pending.type === "close" ? "Closing" : "Opening"} ${pending.surface} — awaiting observed host transition…`
    : lastReason.value || "";
  if (reason.textContent !== text) reason.textContent = text;
  reason.hidden = !text;
}

function reportNode(text) {
  const pre = document.createElement("pre");
  pre.className = "gmux-report";
  pre.textContent = text;
  return pre;
}

/** §25 static controls: wired exactly once at creation. */
function wireShell(controls) {
  if (!controls || !controls.menu || controls.menu.dataset.gmuxWired === "true") return;
  if (controls.menu) controls.menu.dataset.gmuxWired = "true";

  const toggleDiagnostics = () => {
    const open = GMUX.state.drawer && GMUX.state.drawer.kind === SURFACE.DIAGNOSTICS;
    dispatch({ type: open ? ACTION.DIAGNOSTICS_CLOSE : ACTION.DIAGNOSTICS_OPEN });
  };

  controls.menu.addEventListener("click", toggleDiagnostics);

  if (controls.immersive) {
    controls.immersive.addEventListener("click", () => dispatch({ type: ACTION.IMMERSIVE_TOGGLE }));
  }

  if (controls.back) {
    controls.back.addEventListener("click", () => handleBackCommand("shell-back"));
  }

  const closePanel = () => {
    const st = GMUX.state;
    if (st.drawer && st.drawer.kind === SURFACE.DIAGNOSTICS) dispatch({ type: ACTION.DIAGNOSTICS_CLOSE });
    else dispatch({ type: ACTION.CLOSE_SURFACE_REQUEST });
  };
  if (controls.drawerClose) controls.drawerClose.addEventListener("click", closePanel);
  if (controls.backdrop) controls.backdrop.addEventListener("click", closePanel);

  for (const surface of Object.keys(controls.buttons || {})) {
    controls.buttons[surface].addEventListener("click", () => {
      const st = GMUX.state;
      const active = st.surface === surface && !!st.drawer && st.drawer.surface === surface;
      // Handlers dispatch intent and ask the engine to act. Never a click on
      // a host element (§16).
      requestSurface(surface, active ? "close" : "open");
    });
  }
}

/**
 * Recovery path only: if an owned root exists without a live GMUX.shell (e.g.
 * after a teardown that left DOM behind), adopt the existing controls instead of
 * creating a second set (§24/§25).
 */
function adoptControls() {
  const byId = (id) => {
    try { return document.getElementById(id); } catch (e) { return null; }
  };
  const buttons = {};
  for (const [surface] of surfaceCommands) {
    const b = byId(`gmux-cmd-${surface}`);
    if (b) buttons[surface] = b;
  }
  const controls = {
    back: byId("gmux-back"),
    menu: byId("gmux-menu"),
    immersive: byId("gmux-immersive"),
    brand: byId("gmux-title"),
    reason: byId("gmux-reason"),
    drawer: byId("gmux-drawer"),
    drawerTitle: byId("gmux-drawer-title"),
    drawerClose: byId("gmux-drawer-close"),
    drawerBody: byId("gmux-drawer-body"),
    backdrop: byId("gmux-backdrop"),
    buttons,
  };
  return controls.menu || controls.reason ? controls : null;
}

/* =============================================================================
 * §16 DIAGNOSTICS (§57/§58)
 *
 * Diagnostics exist to make uncertainty visible, and every entry states which
 * kind of claim it is: OBSERVED · DERIVED · HEURISTIC · PROVISIONAL ·
 * VERIFIED · BLOCKED.
 * ===========================================================================*/

/** §57 — a fingerprint of what GMUX can actually see; never a build version. */
function hostFingerprint(records) {
  const parts = [];
  for (const key of Object.keys(records).sort()) {
    parts.push(`${key}:${records[key].detected ? "1" : "0"}/${records[key].confidence}`);
  }
  const semanticControls = parts.join("|") || "unresolved";
  const workbenchStructure = HAS_DOM
    ? document.body && document.body.children && document.body.children.length
      ? "populated"
      : "empty"
    : "unknown";
  const payload = [
    `controls=${semanticControls}`,
    `workbench=${workbenchStructure}`,
    `capabilities=${Object.keys(records).length}`,
    `revision=${GMUX.adapter.revision}`,
  ].join(";");

  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return {
    value: hash.toString(16).padStart(8, "0"),
    payload,
    workbenchStructure,
    // A revision-0 adapter has no verified mapping, so compatibility cannot be
    // claimed higher than PARTIALLY_VERIFIED (§56/§57).
    compatibility: GMUX.adapter.revision > 0 ? STATUS.PARTIALLY_VERIFIED : STATUS.BLOCKED,
  };
}

function buildReport() {
  const state = GMUX.state || initialState;
  const env = getEnvironment();
  const measuredMode = classifyViewport(env);
  const mode = resolveMode(measuredMode, prefs.mode);
  const { records } = observeSurfaces(GMUX.adapter);
  const keyboard = keyboardLikelyVisible();
  const fingerprint = hostFingerprint(records);
  const styleMounted = HAS_DOM ? !!document.querySelector(STYLE_SELECTOR) : false;
  const shellMounted = !!(GMUX.shell && GMUX.shell.root);

  const field = (label, value, kind, note) => ({ label, value, kind, note: note || null });
  const fields = [
    field("GMUX version", VERSION, KIND.OBSERVED),
    field("adapter id", GMUX.adapter.id, KIND.OBSERVED),
    field("adapter revision", GMUX.adapter.revision, KIND.OBSERVED,
      GMUX.adapter.revision === 0 ? "intentionally incomplete (§12)" : null),
    field("hostname", HAS_DOM ? location.hostname : null, KIND.OBSERVED),
    field("viewport", `${Math.round(env.width)}x${Math.round(env.height)}`, KIND.OBSERVED),
    field("orientation", env.orientation, KIND.DERIVED, "width >= height"),
    field("pointer type", env.coarsePointer ? "coarse" : "fine", KIND.OBSERVED),
    field("touch points", env.touchPoints, KIND.OBSERVED),
    field("mode", mode.mode, KIND.DERIVED, mode.source),
    field("keyboard", keyboard ? "likely" : "not indicated", KIND.HEURISTIC,
      `visualViewport shrink > ${KEYBOARD_THRESHOLD}px; not definitive`),
    field("capabilities", JSON.stringify(state.capabilities || {}), KIND.DERIVED,
      "from adapter.observe() (§15)"),
    field("shell mounted", shellMounted, KIND.OBSERVED),
    field("style mounted", styleMounted, KIND.OBSERVED),
    field("observer installed", !!GMUX.observer, KIND.PROVISIONAL,
      "document.body · childList+subtree+attributes · scope not narrowed yet (§35)"),
    field("viewport observer", !!(GMUX.viewportObserver && GMUX.viewportObserver.installed), KIND.PROVISIONAL,
      "scroll listener provisional until measured (§36)"),
    field("reconciliation count", state.diagnostics.reconciliations, KIND.OBSERVED),
    field("observation count", state.diagnostics.observations, KIND.OBSERVED),
    field("mutation volume",
      `${mutationVolume.total} total · peak batch ${mutationVolume.maxBatch} · peak ${Math.round(mutationVolume.perSecondPeak)}/s`,
      KIND.OBSERVED, "evidence for narrowing §35 scope; host-side measurement still UNTESTED"),
    field("last error", state.diagnostics.lastError, KIND.OBSERVED),
    field("kill switch", state.disabled ? "DISABLED" : "active", KIND.OBSERVED,
      `preferences.disabled or ?${KILL_PARAM}=${KILL_PARAM_OFF}`),
    field("host fingerprint", `${fingerprint.value} · ${GMUX.adapter.id}@${GMUX.adapter.revision}`, KIND.DERIVED,
      fingerprint.payload),
    field("compatibility", fingerprint.compatibility, KIND.DERIVED),
    field("pending action", state.pendingAction ? `${state.pendingAction.type}:${state.pendingAction.surface}` : null, KIND.OBSERVED),
    field("navigation stack", navStack(state).join(" → "), KIND.DERIVED, "state-only; no browser history entries (§40)"),
    field("browser history entries created", 0, KIND.OBSERVED, "GMUX never pushes history (§39/§40)"),
  ];

  const surfaces = {};
  for (const key of Object.keys(records)) {
    const resolved = GMUX.adapter.resolveSurface(key);
    surfaces[key] = {
      detection: records[key].detected ? "detected" : "not detected",
      confidence: records[key].confidence,
      operation: resolved.status,
      reason: resolved.reason,
    };
  }

  return {
    schema: "gmux.diagnostics/v1",
    version: VERSION,
    fields,
    surfaces,
    capabilities: Object.assign({}, state.capabilities),
    state: JSON.parse(JSON.stringify({
      mode: state.mode, surface: state.surface, previousSurface: state.previousSurface,
      immersive: state.immersive, drawer: state.drawer, keyboardVisible: state.keyboardVisible,
      pendingAction: state.pendingAction, disabled: !!state.disabled,
    })),
    preferences: Object.assign({}, prefs),
    fingerprint,
    environment: env,
    log: log.events.slice(-12),
    notes: [
      "Adapter revision 0 is intentional: no verified host mapping exists yet (§12).",
      "Host operations remain BLOCKED until Phase B reconnaissance yields reviewed evidence (§42/§50).",
      "Evidence source: the GMUX Recon instrument, then a reviewed adapter revision.",
    ],
  };
}

function formatReport(report) {
  const lines = [`GMUX ${report.version} · diagnostics`];
  for (const f of report.fields) {
    lines.push(`${f.label.padEnd(30, " ")} ${String(f.value).padEnd(12, " ")} ${f.kind}${f.note ? `  (${f.note})` : ""}`);
  }
  lines.push("", "surfaces");
  for (const key of Object.keys(report.surfaces)) {
    const s = report.surfaces[key];
    lines.push(`  ${key.padEnd(14, " ")} ${s.detection.padEnd(13, " ")} ${s.confidence} · operation ${s.operation}`);
  }
  lines.push("", ...report.notes.map((n) => `note: ${n}`));
  return lines.join("\n");
}

function printReport() {
  const report = buildReport();
  try {
    console.log(`[${OWNER}]\n${formatReport(report)}`);
  } catch (e) { /* console unavailable — the object is still returned */ }
  return report;
}

/* =============================================================================
 * §17 RECONCILIATION + OBSERVERS (§21/§35/§36)
 *
 * Idempotent, convergent, safe to repeat: no duplicate shell, no duplicate
 * style node, no duplicate listeners, no host mutation, no polling.
 * ===========================================================================*/

let prefs = Object.assign({}, PREF_DEFAULTS);
let observerSuppression = 0;
let inputInstalled = false;

/**
 * §35/§36 evidence for narrowing the observer later: total mutations, peak
 * batch size and peak rate, measured event-driven (never by polling).
 */
const mutationVolume = { total: 0, maxBatch: 0, perSecondPeak: 0, windowStart: 0, windowCount: 0, windows: 0 };

function recordMutations(count, at) {
  mutationVolume.total += count;
  if (count > mutationVolume.maxBatch) mutationVolume.maxBatch = count;
  if (!mutationVolume.windowStart) {
    mutationVolume.windowStart = at;
    mutationVolume.windowCount = count;
    return;
  }
  const elapsed = at - mutationVolume.windowStart;
  if (elapsed >= 1000) {
    const rate = (mutationVolume.windowCount * 1000) / elapsed;
    if (rate > mutationVolume.perSecondPeak) mutationVolume.perSecondPeak = rate;
    mutationVolume.windows++;
    mutationVolume.windowStart = at;
    mutationVolume.windowCount = count;
    return;
  }
  mutationVolume.windowCount += count;
}

function suppressObserver() { observerSuppression++; }
function resumeObserver() { if (observerSuppression > 0) observerSuppression--; }

function installObserver() {
  if (!HAS_DOM || GMUX.observer || !document.body || typeof MutationObserver !== "function") {
    return null;
  }
  const observer = new MutationObserver((records) => {
    // GMUX's own attribute writes must not feed the loop it watches (§21).
    if (observerSuppression > 0) return;
    const count = records && records.length ? records.length : 1;
    recordMutations(count, nowMs());
    GMUX.state.diagnostics.observations++;
    scheduleReconcile();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  GMUX.observer = observer;
  logInfo("mutation observer installed — PROVISIONAL scope (§35)");
  return observer;
}

function installViewportObserver() {
  if (!HAS_DOM || GMUX.viewportObserver) return null;
  const target = window.visualViewport || window;
  const onResize = () => scheduleReconcile();
  const onScroll = () => scheduleReconcile();
  target.addEventListener("resize", onResize, { passive: true });
  target.addEventListener("scroll", onScroll, { passive: true });
  GMUX.viewportObserver = {
    target,
    installed: true,
    provisional: true,
    listeners: [["resize", onResize], ["scroll", onScroll]],
    note: "scroll listener provisional until measured (§36)",
  };
  logInfo("viewport observer installed — scroll provisional (§36)");
  return GMUX.viewportObserver;
}

function reconcile() {
  const state = GMUX.state;
  if (!state) return null;

  // §38: a disabled runtime mutates nothing at all — and the switch is
  // persisted so the next load never installs anything either.
  if (state.disabled) {
    if (GMUX.shell || GMUX.observer || GMUX.viewportObserver) teardown();
    if (!prefs.disabled) {
      prefs = Object.assign({}, prefs, { disabled: true });
      savePreferences(prefs);
    }
    return null;
  }

  const env = getEnvironment();
  const { observed, records } = observeSurfaces(GMUX.adapter);
  const capabilities = detectCapabilities(observed);
  const measuredMode = classifyViewport(env);
  // `mode` must be the classification string itself — §21 stores the mode,
  // never the resolution record (the basis is diagnostics' job, not state's).
  const { mode } = resolveMode(measuredMode, prefs.mode);

  // Observation-derived transitions still go through explicit actions (§10),
  // but without re-entering the scheduler (§21 convergence).
  applyObserved({ type: ACTION.ENVIRONMENT_CHANGED, mode });
  applyObserved({ type: ACTION.CAPABILITIES_CHANGED, capabilities });
  applyObserved({ type: ACTION.KEYBOARD_CHANGED, visible: keyboardLikelyVisible() });

  // §52/§2: a previously committed surface that is no longer observed on the
  // host must not stay claimed by GMUX. Retreat — but never silently: the
  // reason is logged and shown. Skipped while an action is in flight so this
  // can never fight the commit path (§69).
  const surface = GMUX.state.surface;
  if (surface !== SURFACE.EDITOR && !GMUX.state.pendingAction) {
    const record = records[surface];
    const stillPresent = !!record && (record.open === true || (record.open === undefined && record.detected));
    if (!stillPresent) {
      const drifted = surface;
      applyObserved({ type: ACTION.SURFACE_COMMITTED, surface: SURFACE.EDITOR });
      logWarn(`adapter drift: ${drifted} is no longer observed — retreating to editor (§52)`,
        record ? `confidence ${record.confidence}` : "no observation record");
      showReason({ status: STATUS.PROVISIONAL, reason: `${drifted} disappeared from the host — GMUX degraded to editor` });
    }
  }

  GMUX.state.diagnostics.reconciliations++;

  if (!GMUX.shell) createShell();
  if (GMUX.shell && !GMUX.shell.controls) {
    const adopted = adoptControls();
    if (adopted) GMUX.shell = shellApi(GMUX.shell.root, adopted);
  }
  // A shell that could not be mounted (no body, hostile host) degrades to
  // presentation-less reconciliation rather than throwing (§59).
  if (GMUX.shell) GMUX.shell.render(GMUX.state, env);

  // Preferences are configuration: a user toggle is persisted here, in the
  // effect layer, never inside the reducer (§10). Only fields GMUX can change
  // are synced, and only on real change, so reconciliation never writes
  // storage repeatedly (§21: idempotent, convergent).
  if (prefs.immersive !== GMUX.state.immersive) {
    prefs = Object.assign({}, prefs, { immersive: GMUX.state.immersive });
    savePreferences(prefs);
  }
  return { env, records, capabilities, mode };
}

function teardown() {
  if (!HAS_DOM) return;
  try {
    if (GMUX.observer) { GMUX.observer.disconnect(); GMUX.observer = null; }
    if (GMUX.viewportObserver && GMUX.viewportObserver.target) {
      for (const [type, fn] of GMUX.viewportObserver.listeners || []) {
        GMUX.viewportObserver.target.removeEventListener(type, fn);
      }
      GMUX.viewportObserver = null;
    }
    if (GMUX.shell) { GMUX.shell.destroy(); GMUX.shell = null; }
    const style = document.querySelector(STYLE_SELECTOR);
    if (style && style.parentNode) style.parentNode.removeChild(style);
    inputInstalled = false;
    logInfo("GMUX torn down — host left intact (§59)");
  } catch (e) {
    logError("teardown failed", e);
  }
}

/* =============================================================================
 * §18 INPUT — Back as an application command (§39)
 *
 * Priority: diagnostics → drawer → secondary surface → otherwise leave the
 * browser alone. GMUX never pushes a history entry and never calls
 * preventDefault, so Back cannot be trapped (§39/§40). Android hardware Back
 * interception is therefore deliberately NOT attempted in v0.1: the only
 * mechanism that could capture it requires history pollution, which §40
 * forbids. Escape and the in-shell Back control carry the same command.
 * ===========================================================================*/

function handleBackCommand(origin) {
  const state = GMUX.state;
  if (!state) return { consume: false, step: "no-state" };
  const plan = planBack(state);
  if (!plan.consume) {
    return { consume: false, step: "browser-default", origin };
  }
  if (plan.action) dispatch(plan.action);
  if (plan.command && actions[plan.command]) {
    // Secondary surface closure is a host operation → engine, not a mutation.
    requestSurface(plan.command.replace(/^close-/, ""), "close");
  }
  logInfo(`back command consumed (${origin})`, plan.step);
  return { consume: true, step: plan.step, origin };
}

function installInputHandlers() {
  if (!HAS_DOM || inputInstalled) return false;
  inputInstalled = true;
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      // No preventDefault: GMUX yields the key to the host whenever it owns
      // nothing, and never traps it even when it does (§39).
      handleBackCommand("escape");
    }
  });
  return true;
}

/* =============================================================================
 * §19 BOOTSTRAP (§59)
 *
 * The strongest runtime invariant: GMUX MAY FAIL → github.dev MUST CONTINUE.
 * Nothing here may propagate an exception into the host, and the kill switch
 * is checked before any observer is installed.
 * ===========================================================================*/

/**
 * The single GMUX namespace (§5). Nothing else is written to the global scope
 * and no other global is created.
 */
const GMUX = {
  version: VERSION,
  state: null,
  adapter: GitHubDevAdapter,
  shell: null,
  observer: null,
  viewportObserver: null,
  /** Required diagnostic interface (§5/§58). */
  inspect: printReport,
};

function killSwitchRequested() {
  try {
    if (typeof location === "undefined") return { off: false, on: false };
    const params = new URL(location.href).searchParams;
    return {
      off: params.get(KILL_PARAM) === KILL_PARAM_OFF,
      on: params.get(KILL_PARAM) === KILL_PARAM_ON,
    };
  } catch (e) {
    return { off: false, on: false };
  }
}

function bootstrap() {
  try {
    if (!HAS_DOM || typeof location === "undefined") return { status: "skipped", reason: "no-dom" };
    if (location.hostname !== HOST) {
      // §59 host contract: any other host is left completely untouched.
      return { status: "skipped", reason: "not-github.dev" };
    }

    const kill = killSwitchRequested();
    const loaded = loadPreferences();
    prefs = loaded.prefs;
    if (kill.on) prefs = Object.assign({}, prefs, { disabled: false });

    // §38 kill switch, checked BEFORE any observer or DOM work.
    if (kill.off || prefs.disabled) {
      logInfo("GMUX disabled — no shell, no observer, no host interaction (§38)");
      return { status: "disabled", reason: kill.off ? "query-param" : "preference" };
    }

    if (!GitHubDevAdapter.detectEnvironment()) {
      return { status: "blocked", reason: "adapter-declined-host" };
    }

    // Adapter slot (§13): the only place host knowledge may live. A verified
    // revision may be swapped in without touching the kernel.
    if (!GMUX.adapter) GMUX.adapter = GitHubDevAdapter;

    // `mode` is seeded with a real classification rather than the `"auto"`
    // preference value, so state and the first render agree from the start (§9/§21).
    GMUX.state = {
      ...initialState,
      ...prefs,
      mode: resolveMode(classifyViewport(getEnvironment()), prefs.mode).mode,
    };

    installStyles();                                  // §28 — exactly one node
    GMUX.shell = createShell() || GMUX.shell;         // §24 — exactly one root
    installInputHandlers();
    installObserver();                                // §35
    installViewportObserver();                        // §36
    scheduleReconcile();                              // §22

    // §37 preferredSurface is honoured only as far as evidence allows. A
    // GMUX-owned surface (diagnostics) may open at once, because GMUX is its
    // authority; a host surface goes through the engine and may only commit on
    // a verified transition, so with a revision-0 adapter it yields a reported
    // BLOCKED result — never a claim, never a silent no-op.
    let preferredOutcome = null;
    const preferred = GMUX.state.preferredSurface;
    if (preferred && preferred !== SURFACE.EDITOR && isKnownSurface(preferred)) {
      if (preferred === SURFACE.DIAGNOSTICS) {
        dispatch({ type: ACTION.DIAGNOSTICS_OPEN });
        preferredOutcome = STATUS.PROVISIONAL;
      } else {
        preferredOutcome = "pending";
        requestSurface(preferred, "open").then((r) => {
          logInfo(`preferred surface ${preferred} → ${r.status}`, r.reason);
        });
      }
    }
    return { status: "ok", preferenceIssues: loaded.issues, preferredSurface: preferredOutcome };
  } catch (error) {
    // Contained: the host must keep running with no GMUX at all (§59).
    logError("bootstrap failed", error);
    if (console && console.error) console.error("[GMUX] bootstrap failed", error);
    try {
      teardown();
    } catch (e) { /* never rethrow into the host */ }
    return { status: "failed", reason: String(error) };
  }
}

/* =============================================================================
 * Public namespace + start
 * ===========================================================================*/

if (HAS_DOM) {
  // §5: the one permitted global. No unrelated globals, no legacy aliases.
  try {
    window.GMUX = GMUX;
  } catch (e) { /* non-writable global — the runtime still boots */ }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bootstrap(), { once: true });
  } else {
    bootstrap();
  }
}

/* =============================================================================
 * Test exports — Node harness only. Never written into the page (§5 forbids
 * unrelated globals), which is why there is no browser-side internals export.
 * ===========================================================================*/

const TEST_EXPORTS = {
  VERSION, OWNER, ROOT_ID, OWNER_SELECTOR, STYLE_SELECTOR, STORAGE_KEY, HOST,
  KEYBOARD_THRESHOLD, MOBILE_MAX_WIDTH, COMPACT_MAX_WIDTH, STABILITY_TIMEOUT, STABILITY_QUIET,
  TOUCH_TARGET, ACTION, STATUS, CONFIDENCE, KIND, SURFACE, PREF_DEFAULTS,
  surfaceCommands, initialState, GitHubDevAdapter,
  getEnvironment, classifyViewport, keyboardLikelyVisible, resolveMode,
  loadPreferences, savePreferences, makeObservationRecord, observeSurfaces,
  detectCapabilities, sameCapabilities, capability, verifyTransition, isOpenRecord, normalizeRecord,
  reducer, planBack, navStack, isKnownSurface, dispatch, applyObserved, scheduleReconcile,
  waitForStability, executeAction, requestSurface, actions, buildActions,
  installStyles, createShell, createMobileShell, render, surfaceStatus, buildReport,
  formatReport, hostFingerprint, reconcile, installObserver, installViewportObserver,
  teardown, handleBackCommand, recordMutations, mutationVolume, log,
  GMUX,
  __setAdapter(a) { GMUX.adapter = a; },
  __reset() {
    teardown();
    GMUX.state = JSON.parse(JSON.stringify(initialState));
    GMUX.adapter = GitHubDevAdapter;
    prefs = Object.assign({}, PREF_DEFAULTS);
    scheduled = false;
    observerSuppression = 0;
    inputInstalled = false;
    mutationVolume.total = 0; mutationVolume.maxBatch = 0; mutationVolume.perSecondPeak = 0;
    mutationVolume.windowStart = 0; mutationVolume.windowCount = 0; mutationVolume.windows = 0;
    log.events.length = 0; log.total = 0; log.errors = 0;
    lastReason.value = null;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = TEST_EXPORTS;
}

})();
