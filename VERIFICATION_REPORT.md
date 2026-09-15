# GMUX v0.1 — Verification Report

> Governing evidence law (SPEC §63): **NO EVIDENCE → NO VERIFIED CLAIM.**
> Status vocabulary: **PASS · PARTIAL · UNTESTED · BLOCKED · FAIL**.
> Feature evidence levels (SPEC §11): **OBSERVED · INFERRED · VALIDATED**.
> Per §50, `VERIFIED` requires G0–G20 = PASS. Anything else is reported as
> `PARTIALLY_VERIFIED` or `BLOCKED`. This report does not promote untested
> behavior to verified.

- **Version:** 0.1.0 (`github-dev-mobile.user.js`, single-file artifact)
- **Target:** `github.dev` (currently served by the VS Code Web runtime at
  `vscode.dev/github/{owner}/{repo}`; evidence R1 in `docs/dom-evidence.md`)
- **Primary device class:** Android phones, mobile browsers with a
  userscript-capable manager
- **Test environment:** headless Node on Linux; three dependency-free
  suites — 113 pure-kernel checks, 37 fake-DOM lifecycle checks, 50 stub-
  workbench adapter-operation checks. No live `github.dev` session and no
  physical/virtual Android device was available in this environment
- **Browser:** automated checks use a minimal in-repo fake DOM
  (`tests/dom-smoke.mjs`); live browser matrix = **UNTESTED** (manual recipe
  in `docs/verification.md`)
- **Device:** no physical device exercised (**UNTESTED**)
- **Viewport:** automated classification exercised at 320 / 412 / 599 / 600 /
  768 / 1024 / 1025 / 1280 px widths; live visualViewport behavior UNTESTED
- **Adapter status:** `github-dev@1` — adapter code present, selector targets
  recorded as OBSERVED/INFERRED in `docs/dom-evidence.md`; **live actuation
  UNTESTED**, so the adapter is not claimed VALIDATED

## How to reproduce

```bash
node tests/run-tests.mjs     # 113 pure-kernel checks
node tests/dom-smoke.mjs     # 37 fake-DOM lifecycle/idempotence checks
node tests/adapter-flow.mjs  # 50 stub-workbench structured-operation checks
node tests/gates.mjs         # G0–G20 evidence → diagnostics/gate-evidence.json
```

Machine-readable gate records (§51 format) are emitted to
[`diagnostics/gate-evidence.json`](diagnostics/gate-evidence.json) on every
run of `tests/gates.mjs`.

## Capability observations

Capabilities use `DETECTED / NOT_DETECTED / UNKNOWN` (SPEC §12). `UNKNOWN` is
never coerced to false. These are **detection** facts; only an observed state
transition promotes an operation to VALIDATED (§13).

| Capability | Static/fake-DOM observation | Live host |
|---|---|---|
| editor | classifier TESTED (DETECTED/NOT_DETECTED/UNKNOWN paths) | UNTESTED |
| explorer | classifier TESTED | UNTESTED |
| search | classifier TESTED | UNTESTED |
| sourceControl | classifier TESTED | UNTESTED |
| terminal | host expectation heuristic TESTED; feature flag `terminalSurface=false` (§17) | expected NOT_DETECTED on github.dev — UNTESTED |
| activityBar | classifier TESTED | UNTESTED |
| statusBar | classifier TESTED | UNTESTED |
| commandPalette | UNKNOWN while closed by design; DETECTED only when `.quick-input-widget` observed | UNTESTED |

Selector evidence for every host target lives in `docs/dom-evidence.md`.
Selectors without an evidence entry are not used (§58 rule 4).

## Gate results (SPEC §49, format §51)

| Gate | Name | Status | Basis / evidence |
|---|---|---|---|
| G0 | Script loads | **PASS** | metadata block parsed; both suites require/load the artifact with zero load errors |
| G1 | No uncaught exceptions | **PASS** | 113 kernel + 37 smoke + 50 adapter-flow checks complete, exit code 0 |
| G2 | github.dev detected | **PASS** | pure, DOM-independent `detectTarget()`: github.dev, `*.github.dev`, `vscode.dev/github/*` supported; `vscode.dev` non-github routes and arbitrary hosts UNSUPPORTED; runs before any DOM mutation (§7) |
| G3 | Mobile mode detected | **PARTIAL** | centralized breakpoint policy TESTED (`<600 mobile, 600–1024 compact, >1024 desktop` + override); live mobile UA/render UNTESTED |
| G4 | Shell appears exactly once | **PASS** | fake-DOM mount: `#github-mobile-ux` count = 1, toolbar = 1, stylesheet = 1; injected rogue root removed and `SHELL_DUPLICATION` emitted; duplicate-eval guard present |
| G5 | Editor remains usable | **UNTESTED** | design-only evidence: v0.1 installs **no pointer/gesture handlers**; Escape yields inside `.monaco-editor, textarea, input, …`; focus uses Monaco `textarea.inputarea` only; live editable/cursor/selection/clipboard/scroll/keyboard checklist pending (§29/§30) |
| G6 | Explorer opens | **PARTIAL** | kernel closed loop TESTED (intent → structured result → pending → observe → VALIDATED/expiry); **stub workbench TESTED**: `openExplorer()` returns §9 evidence with `stateChanged:true, level=VALIDATED`; live activity-bar/keybinding actuation UNTESTED |
| G7 | Explorer closes | **PARTIAL** | stub: `closePanels()` VALIDATED after open, no-op VALIDATED when nothing is open, `selectFile → editor` planner TESTED; live actuation UNTESTED |
| G8 | Search opens | **PARTIAL** | same kernel + stub evidence for search; live actuation UNTESTED |
| G9 | Search closes | **PARTIAL** | stub close VALIDATED; live UNTESTED |
| G10 | Source Control opens | **PARTIAL** | same kernel + stub evidence; no GMUX-owned Git state by construction (§33); live actuation UNTESTED |
| G11 | Source Control closes | **PARTIAL** | stub close VALIDATED; live UNTESTED |
| G12 | Android Back behaves correctly | **PARTIAL** | pure `planBack` priority TESTED (modal → host quick-input → drawer/secondary → `ALLOW_BROWSER_DEFAULT`); fake-DOM `popstate` opens/closes a modal and unowned Back falls through; history entries exist only while owned UI is presented (never trapped, I-11); real Android Chrome history UNTESTED |
| G13 | Keyboard does not destroy shell layout | **PARTIAL** | visualViewport collapse → keyboard `INFERRED` (never stronger); shell chrome anchored to visual-viewport CSS geometry, TESTED; soft-keyboard device session UNTESTED |
| G14 | Route changes survive | **PARTIAL** | host-driven surface adoption + pending-command guard TESTED in the planner; observation uses MutationObserver + `popstate`/`hashchange`; `pushState` is **not** monkey-patched (§35); live SPA navigation UNTESTED |
| G15 | Reconciliation is idempotent | **PASS** | 10 scheduled reconciliations over a stable observation: shell/toolbar/button counts unchanged (1/1/1); class/CSS-var writes are diffed; duplicate root converged (§25) |
| G16 | Preferences survive reload | **PARTIAL** | schema-v1 round trip across a fresh session (disable→enable) TESTED with fake storage; full page reload on live host UNTESTED |
| G17 | Corrupt preferences do not prevent startup | **PASS** | invalid JSON, foreign schema version, non-object payload, throwing storage: each yields `PREFERENCE_PARSE_FAILED` + defaults + successful boot |
| G18 | Unsupported capabilities reported | **PASS** | UNKNOWN/NOT_DETECTED never promoted; terminal control rendered `aria-disabled`; stub test with the workbench removed shows all capabilities collapsing to UNKNOWN and `openExplorer()` returning a structured `EXPLORER_NOT_DETECTED` failure (no silent success); feature-status map refuses VERIFIED without validation |
| G19 | Userscript makes zero network requests | **PASS** | static scan: no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, dynamic `import`, RTC data channels (`tests/gates.mjs` enforces this) |
| G20 | Userscript has zero external dependencies | **PASS** | no `@require`/`@resource` directives, no `require()` in artifact, no build step, single file; `@grant none` |

### Architecture invariants (I-01 … I-15)

| Invariant | Evidence |
|---|---|
| I-01 shell count ≤ 1 | G4/G15 PASS (mount dedupe + SHELL_DUPLICATION convergence) |
| I-02/I-03 selector isolation | all host selectors, mutation-relevance and editor-protection answers live in §D adapter; static scan shows none after §D except the §E namespaced stylesheet; the pure §C kernel contains no GitHub names |
| I-04 reconcile converges | G15 PASS |
| I-05 no steady-state polling | MutationObserver + rAF only; bounded one-shot timers enumerated (boot 30 s warning, pending retry, surface restore) |
| I-06/I-07 no network/deps | G19/G20 PASS |
| I-08 GitHub authority | no repository/Git model exists in the artifact |
| I-09 editor interactive | design evidence + G5 live UNTESTED |
| I-10 no unverified capability | G18 PASS |
| I-11 Back never trapped | stack exists only while owned UI is presented; tested in fake DOM; live UNTESTED |
| I-12 prefs never block boot | G17 PASS |
| I-13 namespace-owned DOM | fake-DOM walk: every created node carries `data-gmux-owner` |
| I-14 optional feature isolation | command/adapter failures return structured results; terminal disabled without impact |
| I-15 no claim without evidence | this report |

### Tally

```
PASS     9   G0 G1 G2 G4 G15 G17 G18 G19 G20
PARTIAL 11   G3 G6 G7 G8 G9 G10 G11 G12 G13 G14 G16
UNTESTED 1   G5
BLOCKED  0
FAIL     0
```

## Observed / tested / validated / untested — explicit ledger

- **Observed (documented DOM evidence):** github.dev→vscode.dev runtime,
  VS Code command list overlay, workbench/parts/activity-bar selectors from
  `microsoft/vscode` sources — `docs/dom-evidence.md` (collection 2026-09-15).
- **Tested in this environment:** pure kernel (host detection, modes,
  transitions, Back decisions, preference tolerance, scheduler coalescing,
  structured commands, capability classification, keyboard inference,
  operation validation state machine, reconcile planner, feature-status
  honesty); fake-DOM lifecycle (idempotent boot, waiting state, dynamic
  activation, single shell, ownership markers, duplication convergence,
  Back modal layering, corruption recovery, disable/re-enable); and a stub
  VS Code workbench (normalized observation shape, detect/open/close/focus
  structured results with VALIDATED evidence levels, idempotent already-open
  semantics, no-op close semantics, and graceful collapse to UNKNOWN/
  structured failures when the host disappears).
- **Validated (observed expected state transition after an operation):**
  **none on a live host.** Synthetic validation paths prove the state
  machine; they are not claims about github.dev behavior.
- **Untested:** every live-runtime behavior on github.dev and Android —
  G5–G11 actuation, real Back history, soft keyboard, live route changes,
  full reload persistence, devicemetric viewports. Manual recipe:
  `docs/verification.md`.
- **Blocked:** nothing currently; “unknown future GitHub DOM” remains
  structurally BLOCKED-by-default (no claims beyond observed evidence).

## Failures / warnings found during verification

- No failures remain in the automated suites (113 + 37 + 50 checks green).
- The stub-workbench suite caught and forced a fix for a real artifact defect:
  `observe()` queried `PARTS.statusbar` (undefined key) instead of
  `PARTS.statusBar`, which in a real browser would have thrown inside the
  guarded `querySelector` and left the status-bar capability permanently
  unobserved. Corrected and regression-covered by the stub suite.
- Terminal is not provided by the github.dev/vscode.dev web host per the
  recorded inference (`docs/dom-evidence.md` T2); the surface is flagged
  `terminalSurface=false` (§17) and the control is disabled rather than
  advertised as working.
- `visualViewport` is unavailable in the headless fake-DOM harness → fallback
  resize path and `VIEWPORT_UNAVAILABLE` warning path are exercised; the
  adapter-flow stub provides `visualViewport`; real-device confirmation
  remains pending.

## Known limitations

1. Live host selectors (activity-bar view IDs, sidebar content classes,
   `.xterm`, `.quick-input-widget`) are OBSERVED/INFERRED from source and a
   fetched page, not yet VALIDATED interactively. If a target differs, the
   adapter returns a structured failure and the feature degrades (§46/§47)
   rather than pretending success.
2. Synthetic keybinding dispatch is the secondary mechanism; VS Code key
   handling in mobile browsers may swallow synthesized events.
3. Android Back layering assumes GMUX-owned history entries are not
   interleaved with host entries while an owned surface is open; interleaved
   host entries fall through safely (`ALLOW_BROWSER_DEFAULT`) but ordering on
   real devices is UNTESTED.
4. Sidebar drawer positioning uses fixed presentation with `!important`
   layout on the existing `.part.sidebar`; visibility-based hiding preserves
   the host grid, but visual regressions on small screens cannot be ruled out
   without a live session (§41).
5. Disable/re-enable (`Alt+Shift+G`) and the revive chip are conveniences
   outside the minimum command set; they are smoke-tested in the fake DOM
   only.
6. No performance measurement on real hardware yet (§43 targets remain
   engineering targets, not verified facts).

## Final status

```
STATUS: PARTIALLY_VERIFIED
VERIFIED (PASS):       G0 G1 G2 G4 G15 G17 G18 G19 G20
PARTIALLY_VERIFIED:    G3 G6 G7 G8 G9 G10 G11 G12 G13 G14 G16
UNTESTED:              G5
BLOCKED:               (none)
FAIL:                  (none)
```

Per SPEC §50/§61, v0.1 is **not tagged VERIFIED** and must not be described as
“works / stable / production-ready”. The next action is the live manual
matrix (`docs/verification.md`); G5–G14 promotions require evidence from a
real github.dev session and an Android-class browser.
