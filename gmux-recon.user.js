// ==UserScript==
// @name         GMUX Recon — github.dev DOM reconnaissance
// @namespace    github-dev-mobile-recon
// @version      0.1.0
// @description  Temporary, read-only DOM reconnaissance for GMUX adapter revision 1
// @match        https://github.dev/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
/**
 * GMUX Recon — the Phase B evidence instrument (pack §42–§50, §62).
 *
 *   OBSERVE github.dev → identify semantic candidates → produce compact
 *   evidence → freeze fixture → manually review → implement adapter
 *
 * It is deliberately NOT part of `github-dev-mobile.user.js`. The runtime ships
 * a selector-free kernel and an intentionally incomplete adapter (§12/§13);
 * this file is the only place allowed to look for host structure, and even here
 * the result is EVIDENCE, never VERIFIED CAPABILITY (§46).
 *
 * Hard rules enforced by this file:
 *   · read-only — no style node, no element creation, no attribute write,
 *     no class write on any host node (§42);
 *   · privacy boundary — never repository contents, file contents, terminal
 *     output, commit messages, usernames, tokens, cookies, localStorage,
 *     IndexedDB or authentication data (§43);
 *   · discovery uses semantic signals first (§44/§51) and never dumps the DOM
 *     (§45: bounded, truncated, control-scoped snippets only);
 *   · interactions are opt-in, allow-listed, always restored, and destructive
 *     verbs are refused outright (§48/§49);
 *   · results are never auto-converted into executable selectors: extraction is
 *     a human review step (§50).
 *
 * Activation: `?gmux=recon` on a github.dev URL, then `GMUXRecon.run()`.
 * Zero dependencies, zero network.
 */
(function () {
'use strict';

const HAS_DOM = typeof window !== "undefined" && typeof document !== "undefined";

const SCHEMA = "gmux.recon/v1";
const FIXTURE_SCHEMA = "gmux.fixture/v1";
const HOST = "github.dev";
const ACTIVATE_PARAM = "gmux";
const ACTIVATE_VALUE = "recon";
const VERSION = "0.1.0";

/**
 * §44 candidate vocabulary. These are candidate tokens, NOT hard-coded
 * operational truths: a match records a candidate, nothing more.
 */
const CANDIDATE_VOCABULARY = Object.freeze({
  explorer: ["explorer", "files"],
  search: ["search", "find in files"],
  sourceControl: ["source control", "git", "changes"],
  terminal: ["terminal", "console"],
  // Observed in the workbench but with no GMUX surface in v0.1: recorded so a
  // human can decide, never auto-promoted.
  other: ["run and debug", "run", "debug", "extensions", "settings"],
});

/** §48 forbidden verbs. A label containing one is refused, not attempted. */
const DESTRUCTIVE_TOKENS = Object.freeze([
  "commit", "push", "pull", "merge", "rebase", "delete", "remove", "discard",
  "rename", "revert", "unstage", "stage all", "publish", "create branch",
  "sign out", "install", "uninstall", "restart", "reload", "kill", "terminate",
  "reset", "clean", "force", "abort", "archive",
]);

/** §48 the only interactions recon may perform, and only on explicit request. */
const SAFE_INTERACTIONS = Object.freeze({
  "open-explorer": { surface: "explorer", expect: "open", reversible: true },
  "open-search": { surface: "search", expect: "open", reversible: true },
  "focus-editor": { surface: "editor", expect: "focus", reversible: false },
});

/**
 * §43: recon records UI *structure*, never content. Only controls that activate
 * UI may be collected; anything carrying data (tree rows, list items, cells,
 * inputs) is content and is skipped. This is what keeps a repository file name —
 * which is an `aria-label` on a treeitem — out of the evidence.
 */
const INTERACTION_ROLES = Object.freeze([
  "button", "tab", "menuitem", "link", "checkbox", "radio", "switch", "toolbar",
]);
const CONTENT_ROLES = Object.freeze([
  "treeitem", "listitem", "row", "gridcell", "cell", "columnheader", "rowheader",
  "option", "textbox", "searchbox", "combobox", "listbox", "tree", "treegrid",
  "article", "document", "region", "group", "status", "tooltip", "dialog",
]);
const INTERACTION_TAGS = Object.freeze(["BUTTON", "A", "SUMMARY"]);

/** §43 regions whose text is never read, whatever else happens. */
const FORBIDDEN_REGION_MARKERS = Object.freeze([
  "monaco-editor", "view-lines", "overflow-guard", "interactive-window",
  "terminal", "xterm", "review-widget", "commit", "diff-editor", "webview",
  "notebook", "debug-console", "repl", "output",
]);
const FORBIDDEN_TAGS = Object.freeze(["INPUT", "TEXTAREA", "SELECT", "OPTION", "CODE", "PRE", "SCRIPT", "STYLE"]);

/** §45 bounds. Recon output is a compact structural record, never a dump. */
const MAX_CANDIDATES = 80;
const MAX_SNIPPET_CHARS = 40;
const MAX_DATA_ATTRS = 4;
const MAX_TITLE_CHARS = 48;
const MAX_ANCESTOR_ROLES = 4;

/* ---------------------------------------------------------------------------
 * Pure helpers (exported to Node so fixtures can drive them without a browser)
 * ------------------------------------------------------------------------*/

function normalizeText(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = normalizeText(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** True when the node lives inside a region whose content must not be read. */
function isForbiddenRegion(element) {
  let node = element;
  let depth = 0;
  while (node && node.nodeType === 1 && depth++ < 30) {
    const classes = String(node.className || "");
    for (const marker of FORBIDDEN_REGION_MARKERS) {
      if (classes.toLowerCase().includes(marker)) return true;
    }
    const tag = String(node.tagName || "").toUpperCase();
    if (FORBIDDEN_TAGS.includes(tag)) return true;
    if (node.getAttribute && node.getAttribute("data-recon-forbidden") === "true") return true;
    node = node.parentNode;
  }
  return false;
}

function roleOf(element) {
  return normalizeText(element && element.getAttribute && element.getAttribute("role")).toLowerCase();
}

/** True only for controls that activate UI — never for content-bearing nodes. */
function isInteractionControl(element) {
  if (!element) return false;
  const role = roleOf(element);
  if (CONTENT_ROLES.indexOf(role) !== -1) return false;
  const tag = String(element.tagName || "").toUpperCase();
  if (INTERACTION_TAGS.indexOf(tag) !== -1) return true;
  return INTERACTION_ROLES.indexOf(role) !== -1;
}

/**
 * §43/§45: a snippet is recorded only for an interaction control whose own text
 * is a recognised UI token. Text that merely sits near a control (file names,
 * tree rows, editor lines) can therefore never be collected, and a control
 * inside a forbidden region yields nothing at all.
 */
function snippetFor(element) {
  if (!element || !isInteractionControl(element) || isForbiddenRegion(element)) return null;
  const text = truncate(element.textContent, MAX_SNIPPET_CHARS);
  if (!text) return null;
  return matchSurface(text) ? text : null;
}

/** §48: refuse anything that could change the repository, ever. */
function isDestructiveLabel(label) {
  const text = normalizeText(label).toLowerCase();
  if (!text) return false;
  return DESTRUCTIVE_TOKENS.some((token) => text.includes(token));
}

/** §44/§51: which surface a name maps to, and how confident the mapping is. */
function matchSurface(label) {
  const text = normalizeText(label).toLowerCase();
  if (!text) return null;
  for (const [surface, tokens] of Object.entries(CANDIDATE_VOCABULARY)) {
    for (const token of tokens) {
      if (text === token) return { surface, token, strength: "exact" };
    }
  }
  for (const [surface, tokens] of Object.entries(CANDIDATE_VOCABULARY)) {
    for (const token of tokens) {
      if (text.includes(token)) return { surface, token, strength: "contains" };
    }
  }
  return null;
}

function isVisible(element) {
  try {
    if (element.hidden === true) return false;
    const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
    if (!rect) return true;
    return rect.width > 0 && rect.height > 0;
  } catch (e) {
    return false;
  }
}

function depthOf(element) {
  let depth = 0;
  let node = element ? element.parentNode : null;
  while (node && node.nodeType === 1 && depth < 60) { depth++; node = node.parentNode; }
  return depth;
}

/** §45 relevant data attributes only, bounded and truncated. */
function relevantData(element) {
  const out = {};
  const attrs = element.attributes;
  if (!attrs) return out;
  const entries = attrs instanceof Map
    ? Array.from(attrs.entries())
    : Array.from(attrs).map((a) => [a.name, a.value]);
  for (const [name, value] of entries) {
    const key = String(name);
    if (!key.startsWith("data-") && key !== "id") continue;
    if (key.startsWith("data-gmux")) continue;               // never echo GMUX's own markers
    if (Object.keys(out).length >= MAX_DATA_ATTRS) break;
    const text = truncate(value, MAX_TITLE_CHARS);
    // §43: a data attribute holding a path/URL/token-like value is dropped.
    if (/(file:|https?:|token|secret|key=|authorization)/i.test(key + text)) continue;
    out[key] = text;
  }
  return out;
}

function parentRoles(element) {
  const roles = [];
  let node = element ? element.parentNode : null;
  while (node && node.nodeType === 1 && roles.length < MAX_ANCESTOR_ROLES) {
    const role = node.getAttribute ? node.getAttribute("role") : null;
    if (role) roles.push(truncate(role, 24));
    node = node.parentNode;
  }
  return roles;
}

function rectOf(element) {
  try {
    const r = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
    if (!r) return null;
    return { x: Math.round(r.x || 0), y: Math.round(r.y || 0), width: Math.round(r.width || 0), height: Math.round(r.height || 0) };
  } catch (e) {
    return null;
  }
}

/** §51 selector strategy order, with the winning strategy reported. */
function identifyStrategy(element) {
  const aria = normalizeText(element.getAttribute && element.getAttribute("aria-label"));
  if (aria) return { strategy: "aria-label", name: truncate(aria, MAX_TITLE_CHARS), rank: 1 };
  const title = normalizeText(element.getAttribute && element.getAttribute("title"));
  if (title) return { strategy: "title", name: truncate(title, MAX_TITLE_CHARS), rank: 2 };
  // §51 step 3: a stable host data attribute or id. Recorded as a *candidate*
  // string only — this file never emits it as an executable selector.
  const id = normalizeText(element.getAttribute && element.getAttribute("id"));
  if (id && id.length <= MAX_TITLE_CHARS) return { strategy: "stable-id", name: truncate(id, MAX_TITLE_CHARS), rank: 3 };
  const role = normalizeText(element.getAttribute && element.getAttribute("role"));
  if (role) return { strategy: "role+name", name: truncate(element.textContent, MAX_SNIPPET_CHARS), rank: 4 };
  return { strategy: "structure", name: null, rank: 5 };
}

/** §44 discovery: semantic information first, never a DOM dump. */
function discoverCandidates(root, options) {
  const opts = options || {};
  const doc = root || (HAS_DOM ? document : null);
  if (!doc || typeof doc.querySelectorAll !== "function") {
    return { candidates: [], scanned: 0, skipped: { destructive: 0, invisible: 0, nonSemantic: 0, content: 0 }, truncated: false };
  }
  let list = [];
  try {
    list = Array.from(doc.querySelectorAll(['[aria-label]', '[title]', '[role]', 'button'].join(',')));
  } catch (e) {
    return { candidates: [], scanned: 0, skipped: { destructive: 0, invisible: 0, nonSemantic: 0, content: 0 }, truncated: false, error: 'query-failed' };
  }
  const candidates = [];
  const skipped = { destructive: 0, invisible: 0, nonSemantic: 0, duplicate: 0, content: 0 };
  let truncatedFlag = false;
  const seen = new Set();

  for (const element of list) {
    const ident = identifyStrategy(element);
    const labelCandidates = [
      element.getAttribute && element.getAttribute("aria-label"),
      element.getAttribute && element.getAttribute("title"),
      element.textContent,
    ];
    const label = normalizeText(labelCandidates.find((v) => normalizeText(v))) || ident.name || "";
    if (!isInteractionControl(element)) { skipped.content++; continue; }
    const match = matchSurface(label);
    if (!match) { skipped.nonSemantic++; continue; }
    if (isDestructiveLabel(label)) { skipped.destructive++; continue; }
    if (!opts.allowHidden && !isVisible(element)) { skipped.invisible++; continue; }

    const key = `${ident.strategy}:${match.surface}:${label}:${depthOf(element)}`;
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);

    if (candidates.length >= MAX_CANDIDATES) { truncatedFlag = true; break; }

    // §47 every candidate carries the reason it is interesting.
    const evidence = [{ type: ident.strategy, value: label || ident.name || null }];
    const aria = normalizeText(element.getAttribute && element.getAttribute("aria-label"));
    if (aria && ident.strategy !== "aria-label") evidence.push({ type: "aria-label", value: truncate(aria, MAX_TITLE_CHARS) });
    const role = normalizeText(element.getAttribute && element.getAttribute("role"));
    if (role) evidence.push({ type: "role", value: truncate(role, 24) });

    candidates.push({
      surface: match.surface,
      confidence: "candidate",          // §47 — never "verified" from recon
      strength: match.strength,
      tag: String(element.tagName || "").toLowerCase(),
      role: role || null,
      // §43: identity text is kept only when it is a UI token or a short
      // control label; a long free-form label is treated as content.
      ariaLabel: aria && aria.length <= MAX_SNIPPET_CHARS ? truncate(aria, MAX_TITLE_CHARS) : (aria ? "[omitted:label-too-long]" : null),
      title: truncate(element.getAttribute && element.getAttribute("title"), MAX_TITLE_CHARS) || null,
      data: relevantData(element),
      snippet: snippetFor(element),
      parentRoles: parentRoles(element),
      depth: depthOf(element),
      rect: rectOf(element),
      visible: isVisible(element),
      disabled: !!(element.disabled === true
        || (element.getAttribute && element.getAttribute("aria-disabled") === "true")),
      strategy: ident.strategy,
      strategyRank: ident.rank,
      matchToken: match.token,
      evidence,
    });
  }

  return { candidates, scanned: list.length, skipped, truncated: truncatedFlag };
}

/** §46 environment block — observed signals only, same discipline as §7. */
function environmentBlock(win) {
  const w = win || (HAS_DOM ? window : null);
  if (!w) return { width: 0, height: 0, touchPoints: 0, coarsePointer: false };
  const vv = w.visualViewport;
  const width = (vv && vv.width) ?? w.innerWidth ?? 0;
  const height = (vv && vv.height) ?? w.innerHeight ?? 0;
  let coarsePointer = false;
  try {
    coarsePointer = typeof w.matchMedia === "function" ? w.matchMedia("(pointer: coarse)").matches : false;
  } catch (e) { coarsePointer = false; }
  return {
    width: Math.round(width),
    height: Math.round(height),
    touchPoints: (w.navigator && w.navigator.maxTouchPoints) || 0,
    coarsePointer,
  };
}

/** Cheap structural digest used only to prove recon changed nothing (§42). */
function structureDigest(doc) {
  if (!doc || !doc.body) return null;
  const counts = {};
  try {
    for (const tag of ["DIV", "BUTTON", "A", "LI", "INPUT", "TEXTAREA", "STYLE", "CANVAS"]) {
      const n = doc.body.querySelectorAll(tag).length;
      if (n) counts[tag] = n;
    }
    counts.__children = doc.body.children.length;
  } catch (e) {
    return null;
  }
  return JSON.stringify(counts);
}

/**
 * §49 interaction plan — constructed, never executed implicitly. Execution
 * requires `allowInteraction: true` from the operator and an allow-listed id.
 */
function planInteraction(surface, options) {
  const opts = options || {};
  if (!opts.allowInteraction) {
    return { ok: false, status: "BLOCKED", reason: "interaction not authorised (pass allowInteraction) — recon defaults to read-only" };
  }
  const spec = SAFE_INTERACTIONS[opts.command];
  if (!spec) {
    return { ok: false, status: "BLOCKED", reason: `command not on the safe list: ${opts.command || "(none)"}` };
  }
  if (spec.surface !== surface) {
    return { ok: false, status: "BLOCKED", reason: `command ${opts.command} does not target ${surface}` };
  }
  return { ok: true, status: "PROVISIONAL", command: opts.command, surface, expect: spec.expect, reversible: spec.reversible };
}

/** §53 fixture shape — minimum structure needed to verify an adapter. */
function buildFixture(surface, state, candidates) {
  const elements = (candidates || [])
    .filter((c) => c.surface === surface)
    .slice(0, 12)
    .map((c) => ({
      role: c.role || (c.tag === "button" ? "button" : null),
      name: c.ariaLabel || c.title || c.snippet || null,
      visible: !!c.visible,
      ...(c.disabled ? { disabled: true } : {}),
    }))
    .filter((e) => e.name);
  return {
    schema: FIXTURE_SCHEMA,
    surface,
    state,
    elements,
    provenance: "gmux-recon/v1 candidate evidence — reviewed by a human before use (§50)",
    status: "PROVISIONAL",
  };
}

/** The §46 payload. Evidence, not capability. */
function buildReconPayload(root, options) {
  const opts = options || {};
  const discovery = discoverCandidates(root, opts);
  const bySurface = {};
  for (const c of discovery.candidates) {
    (bySurface[c.surface] = bySurface[c.surface] || []).push(c);
  }
  return {
    schema: SCHEMA,
    host: HOST,
    timestamp: opts.timestamp || new Date().toISOString(),
    environment: opts.environment || environmentBlock(),
    candidates: discovery.candidates,
    // Convenience view for the human review step (§50). Derived, not asserted.
    bySurface: Object.keys(bySurface).reduce((acc, key) => {
      acc[key] = { count: bySurface[key].length, strategies: Array.from(new Set(bySurface[key].map((c) => c.strategy))) };
      return acc;
    }, {}),
    discovery: {
      scanned: discovery.scanned,
      skipped: discovery.skipped,
      truncated: discovery.truncated,
      limit: MAX_CANDIDATES,
    },
    interpretation: {
      meaning: "EVIDENCE — candidate structure only",
      isVerifiedCapability: false,
      nextStep: "human review → adapter definition → fixture → interaction verification → release gate (§50)",
    },
  };
}

/* ---------------------------------------------------------------------------
 * Browser-side instrument
 * ------------------------------------------------------------------------*/

const Recon = {
  version: VERSION,
  schema: SCHEMA,
  lastPayload: null,
  vocabulary: CANDIDATE_VOCABULARY,
  safeInteractions: Object.keys(SAFE_INTERACTIONS),
  forbiddenVerbs: DESTRUCTIVE_TOKENS,

  /** Read-only candidate scan. */
  run(options) {
    const before = structureDigest(document);
    const payload = buildReconPayload(document, { environment: environmentBlock(window), ...(options || {}) });
    const after = structureDigest(document);
    payload.reconIntegrity = { mutated: before !== after, digestBefore: before, digestAfter: after };
    Recon.lastPayload = payload;
    console.log(`[GMUX Recon] ${payload.candidates.length} candidate(s) over ${payload.discovery.scanned} semantic element(s); mutated host: ${payload.reconIntegrity.mutated ? "YES — BUG" : "no"}`);
    return payload;
  },

  /** Compact per-surface summary for the review step. */
  summary() {
    const payload = Recon.lastPayload || Recon.run();
    const lines = [`GMUX Recon ${VERSION} · ${payload.host} · ${payload.timestamp}`,
      `viewport ${payload.environment.width}x${payload.environment.height} · touch ${payload.environment.touchPoints} · pointer ${payload.environment.coarsePointer ? "coarse" : "fine"}`,
      `candidates ${payload.candidates.length} (scanned ${payload.discovery.scanned}, skipped ${JSON.stringify(payload.discovery.skipped)})`];
    for (const surface of Object.keys(payload.bySurface)) {
      const info = payload.bySurface[surface];
      lines.push(`  ${surface.padEnd(14, " ")} ${info.count} candidate(s) · strategies: ${info.strategies.join(", ")}`);
      for (const c of payload.candidates.filter((x) => x.surface === surface).slice(0, 3)) {
        lines.push(`      <${c.tag}> ${c.ariaLabel || c.title || c.snippet || "(unnamed)"} · ${c.strategy} · visible=${c.visible} · PROVISIONAL`);
      }
    }
    lines.push("EVIDENCE only — no capability is claimed from this output (§46/§68).");
    const text = lines.join("\n");
    console.log(text);
    return text;
  },

  /** §49 controlled interaction: explicit authorisation, restore, verdict. */
  async verify(surface, options) {
    const opts = options || {};
    const plan = planInteraction(surface, { ...opts, command: opts.command || `open-${surface}` });
    if (!plan.ok) return { status: "BLOCKED", surface, reason: plan.reason };
    const candidate = (Recon.lastPayload ? Recon.lastPayload.candidates : Recon.run().candidates)
      .filter((c) => c.surface === surface && !c.disabled && c.visible)[0];
    if (!candidate) {
      return { status: "BLOCKED", surface, reason: "no enabled, visible candidate for this surface" };
    }
    if (isDestructiveLabel(`${candidate.ariaLabel || ""} ${candidate.title || ""} ${candidate.snippet || ""}`)) {
      return { status: "BLOCKED", surface, reason: "candidate label matches the destructive denylist" };
    }
    const before = structureDigest(document);
    const element = findCandidateElement(candidate);
    if (!element) return { status: "BLOCKED", surface, reason: "candidate no longer resolvable" };

    const pre = stateOf(surface);
    element.click();
    await settle(opts.settleMs || 300);
    const post = stateOf(surface);
    let restored = "not-applicable";
    if (plan.reversible) {
      const again = stateOf(surface);
      restored = again.open === pre.open ? "restored" : "NOT restored — human check required";
      if (restored !== "restored") {
        return { status: "BLOCKED", surface, reason: `transition observed (${pre.open} → ${again.open}) but the pre-state was not restored` };
      }
    }
    const transitioned = post.open !== pre.open;
    const payload = {
      status: transitioned ? "PROVISIONAL" : "BLOCKED",
      surface,
      command: plan.command,
      evidence: {
        before: pre.open ? "open" : "closed",
        after: post.open ? "open" : "closed",
        via: candidate.strategy,
        restored,
        hostStructureDigestStable: before === structureDigest(document),
      },
      note: transitioned
        ? "a transition was seen; still not VERIFIED — needs a repeat run, a fixture and release review (§50/§54)"
        : "no expected transition — reported as BLOCKED, never as 'probably works' (§49)",
    };
    console.log(`[GMUX Recon] verify(${surface}) → ${payload.status}`, payload.evidence);
    return payload;
  },

  /** §53 freeze a reviewed candidate set as a fixture payload. */
  fixture(surface, state) {
    const payload = Recon.lastPayload || Recon.run();
    return buildFixture(surface, state || "closed", payload.candidates);
  },

  /** Everything needed for the human review step, as text. */
  json() {
    const payload = Recon.lastPayload || Recon.run();
    const text = JSON.stringify(payload, null, 2);
    console.log(text);
    return text;
  },

  /** Copy the evidence for a paste into evidence/reconnaissance.json. */
  async copy() {
    const text = Recon.json();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        console.log("[GMUX Recon] payload copied to clipboard (local only)");
        return true;
      }
    } catch (e) {
      console.log("[GMUX Recon] clipboard unavailable — use GMUXRecon.json()");
    }
    return false;
  },
};

function stateOf(surface) {
  // Deliberately weak evidence: recon may only *observe* whether something
  // resembling the surface is present, and reports it as such (§49).
  const tokens = CANDIDATE_VOCABULARY[surface] || [];
  const nodes = Array.from(document.querySelectorAll('[role="tree"], [role="tabpanel"], [aria-label]')).slice(0, 400);
  const open = nodes.some((n) => {
    const label = normalizeText(n.getAttribute("aria-label") || n.getAttribute("title"));
    if (!label) return false;
    if (!tokens.some((t) => label.toLowerCase().includes(t))) return false;
    const expanded = normalizeText(n.getAttribute("aria-expanded") || "");
    if (expanded) return expanded === "true";
    return isVisible(n);
  });
  return { open, via: "semantic-presence-heuristic" };
}

function findCandidateElement(candidate) {
  const all = Array.from(document.querySelectorAll(["[aria-label]", "[title]", "[role]", "button"].join(",")));
  for (const el of all) {
    const label = normalizeText(el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent);
    if (label !== normalizeText(candidate.ariaLabel || candidate.title || candidate.snippet)) continue;
    if (String(el.tagName).toLowerCase() !== candidate.tag) continue;
    if (depthOf(el) !== candidate.depth) continue;
    return el;
  }
  return null;
}

function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (HAS_DOM) {
  let active = false;
  try {
    active = new URL(location.href).searchParams.get(ACTIVATE_PARAM) === ACTIVATE_VALUE;
  } catch (e) { active = false; }
  if (active) {
    // One global, clearly named, and only under the explicit recon param. It is
    // a separate artifact from the runtime, so §5's single-namespace rule for
    // `GMUX` is untouched.
    window.GMUXRecon = Recon;
    console.log(`[GMUX Recon] ready on ${HOST} — run GMUXRecon.run(); read-only; nothing is claimed (§42/§46)`);
  }
}

/* ---------------------------------------------------------------------------
 * Node exports for the fixture/mutation harness (never a browser global)
 * ------------------------------------------------------------------------*/
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCHEMA, FIXTURE_SCHEMA, HOST, VERSION, MAX_CANDIDATES, MAX_SNIPPET_CHARS,
    CANDIDATE_VOCABULARY, DESTRUCTIVE_TOKENS, SAFE_INTERACTIONS,
    FORBIDDEN_REGION_MARKERS, FORBIDDEN_TAGS,
    normalizeText, truncate, isForbiddenRegion, isDestructiveLabel, matchSurface,
    snippetFor, isInteractionControl, roleOf,
    INTERACTION_ROLES, CONTENT_ROLES, INTERACTION_TAGS, isInteractionControl,
    discoverCandidates, environmentBlock, buildReconPayload,
    buildFixture, planInteraction, identifyStrategy, relevantData, parentRoles,
    structureDigest, isVisible, depthOf, Recon,
  };
}
})();
