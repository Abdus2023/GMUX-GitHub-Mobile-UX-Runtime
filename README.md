# GitHub.dev Mobile UX — GMUX userscript v0.1.0

A small, **dependency-free** userscript that layers a mobile interaction
shell (bottom command bar, Explorer/Search/Source-Control drawers, immersive
editor, Android Back) over the existing **github.dev / VS Code for the Web**
application. It never re-implements application state.

> **Inspect first. Select second. Operate third. Validate fourth.**
> **Observe → Normalize → Decide → Mutate → Observe → Validate.**
> The userscript owns mobile interaction; **GitHub/VS Code Web remains the
> sole application authority** for files, branches, commits, editors,
> terminals and credentials (SPEC §4/§5).

- **Primary artifact:** [`github-dev-mobile.user.js`](github-dev-mobile.user.js) — one file, zero build, zero dependencies
- **Normative contract:** [`SPEC.md`](SPEC.md) (v0.1 Concrete Implementation Contract) + the inspection-first contract (§7 below)
- **Verification status:** [`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md) — **PARTIALLY_VERIFIED**
- **DOM evidence:** [`docs/dom-evidence.md`](docs/dom-evidence.md) · **Reconnaissance:** [`docs/reconnaissance.md`](docs/reconnaissance.md) · **Live test recipe:** [`docs/verification.md`](docs/verification.md)
- **Static fixtures:** [`fixtures/`](fixtures/) (7 minimal HTML recognition cases)
- **Machine-readable gates:** [`diagnostics/gate-evidence.json`](diagnostics/gate-evidence.json) · **Stub evidence:** [`evidence/`](evidence/)

## Purpose

Prove the v0.1 architecture on a narrow phone viewport before adding
sophistication (SPEC §1): a selector-isolated **adapter** feeds a
selector-free **kernel** (state, commands, reconciliation, diagnostics) that
drives exactly one **mobile shell**. Shell buttons dispatch *intent*; the
adapter actuates the *existing* VS Code UI and the reconciler validates the
observed effect. Nothing is claimed verified without evidence.

## Supported host

The userscript injects only on:

- `https://github.dev/*` and `https://*.github.dev/*`
- `https://vscode.dev/github/*` and `https://*.vscode.dev/github/*`
  (github.dev currently redirects to the vscode.dev runtime)

Host detection is independent of DOM detection and runs **before any DOM
mutation** (SPEC §7). Any other site is classified `UNSUPPORTED_TARGET` and
left completely untouched. There is no claim of compatibility with
github.com, other VS Code Web routes, or future host DOM that has not been
observed (SPEC §59).

## v0.1 scope

**Included:** bootstrap/host detection · viewport classification · capability
detection · adapter contract · kernel state & command dispatch ·
MutationObserver-driven idempotent reconciliation · exactly-one mobile shell ·
bottom command bar · editor immersive presentation · Explorer drawer · Search
surface · Source Control surface · Android Back · preferences · diagnostics.

**Explicitly deferred (not implemented in v0.1):** terminal optimization
(terminal surface is detected but **disabled by default**), gesture
navigation (the flag is **off** and no gesture code path is wired in the
runtime), advanced keyboard shortcuts, performance instrumentation, complex
animations, repository/Git automation, remote services, cloud sync.

## Feature flags (SPEC §36)

| Flag | v0.1 | Meaning |
|---|---|---|
| `mobileShell` | `true` | mount the shell root `#github-mobile-ux` |
| `immersiveEditor` | `true` | hide minimap / breadcrumbs / desktop activity rail on mobile |
| `explorerDrawer` | `true` | reposition the existing VS Code sidebar as a drawer |
| `searchSurface` | `true` | reuse the existing Search view |
| `sourceControlSurface` | `true` | reuse the existing Source Control view |
| `terminalSurface` | **`false`** | github.dev web host provides no terminal (inference); control is disabled and honest in diagnostics |
| `gestures` | **`false`** | deferred from v0.1; no pointer/gesture handlers are installed |
| `androidBack` | `true` | history-layered Back: modal → quick input → drawer → editor → browser default |
| `diagnostics` | `true` | in-shell evidence report |

The shell is a **command surface** only. No button contains GitHub DOM logic;
all input flows `intent → command → kernel state → adapter operation → host UI
→ observation → validation` (SPEC §23).

## Inspection-first operation

The host DOM is treated as **unknown until observed**. On bootstrap the
adapter runs one bounded DOM reconnaissance scan (semantic elements, ARIA
labels, roles, titles, ids, data attributes, visibility — never an
indiscriminate DOM dump) and records normalized evidence before any
host-specific operation is attempted:

```
github.dev → DOM reconnaissance → normalized observation → capability
evidence → adapter contract → kernel → mobile shell → observation → validation
```

- **Selector registry with provenance:** the registry begins empty; every
  entry carries `{selector, source, confidence, observedAt, purpose}` and
  stays `PROVISIONAL` until a live state transition promotes it. A selector
  is evidence, not truth — detection is not operation, operation is not
  validation.
- **Discovery levels 0–5:** `UNKNOWN → DETECTED → SEMANTICALLY IDENTIFIED →
  INTERACTION ATTEMPTED → STATE TRANSITION OBSERVED → REGRESSION-TESTED`,
  mapped to `UNKNOWN / OBSERVED / OBSERVED+INFERRED / ATTEMPTED / VALIDATED /
  VALIDATED+REGRESSION-TESTED`. Levels are never skipped silently.
- **Semantic fallback:** known selector → semantic discovery → `PROVISIONAL`
  candidate or `BLOCKED`. Ambiguous candidates refuse to guess.
- **Drift detection:** a previously matching known selector that stops
  matching emits `ADAPTER_DRIFT` with fallback guidance and degrades the
  feature to at most `PARTIALLY_VERIFIED` until revalidated.
- **Surface abstraction:** `Editor/Explorer/Search/Git/Terminal` surfaces
  with `detect/open/close/isOpen/observe` and the `UNKNOWN → DETECTED →
  AVAILABLE → OPEN → CLOSING → AVAILABLE` lifecycle (`DEGRADED` on failure,
  shown honestly in the UI). Terminal is observed but operationally disabled.
- **Layout policy:** one centralized `mobile/compact/desktop` presentation
  table; orientation (`portrait/landscape`), coarse-pointer and touch signals
  are observed (never user-agent sniffed) and recorded as decision basis.
- **Navigation stack:** mobile navigation (`[editor]` / `[editor, secondary]`)
  is independent of browser history and drives Back priority
  (modal → drawer → secondary → `ALLOW_BROWSER_DEFAULT`, never trapped).

Public runtime namespace (local evidence only, zero network):

```js
GMUX.version            // "0.1.0"
GMUX.inspect()          // structured evidence + human-readable console report
GMUX.getState()         // serializable kernel state snapshot
GMUX.getCapabilities()  // DETECTED / NOT_DETECTED / UNKNOWN map
GMUX.reconcile()        // run one reconciliation pass now
GMUX.disable()          // tear down the shell; host left intact
```

## Installation

1. Install a userscript manager (Tampermonkey or Violentmonkey; on Android,
   e.g. Firefox + Tampermonkey).
2. Open [`github-dev-mobile.user.js`](github-dev-mobile.user.js) raw and let
   the manager install it. Metadata: `@grant none`, `@noframes`, no
   `@require` / `@resource`.
3. Open a repository at `https://github.dev/<owner>/<repo>` on a narrow
   viewport (< 600 CSS px classifies MOBILE; 600–1024 COMPACT; > 1024
   DESKTOP, where the shell stays minimally intrusive).

## Use

| Input | Behavior |
|---|---|
| Bottom bar: **Files / Search / Git / Term. / More** | dispatches `OPEN_SURFACE` intent; tapping the active surface again closes it |
| Header ☰ | menu: settings, diagnostics, immersive/bottom-bar toggles, disable |
| Header file name | focuses the editor via Monaco's own `textarea.inputarea` (no synthesized editor clicks) |
| Header ⋮ | editor actions delegated to the host: Go to file, Command palette, VS Code settings |
| Android hardware Back | close GMUX modal → dismiss host quick input → close drawer/secondary surface → return to editor; with nothing owned, the browser default is allowed (Back is never trapped) |
| Escape | same priority as Back, except it yields to Monaco inside protected editor regions |
| **Alt+Shift+G** | disable / re-enable the shell without a page reload |

Preferences stored: mode (`auto|mobile|compact|desktop`), `immersive`,
`preferredSurface`, `bottomBar` under `localStorage` key `gmux:prefs:v1`.
Disable flag: `gmux:disabled`.

## Failure behavior

- Capabilities are `DETECTED / NOT_DETECTED / UNKNOWN`; `UNKNOWN` is never
  silently treated as false (SPEC §12). Detection is separate from operation
  validation (SPEC §13).
- Every adapter operation returns a structured result
  `{ ok, operation, reason?, evidence: { elementFound, invoked, stateChanged,
  level } }` — success is never implied by a selector match alone (SPEC §9/§10).
- An unavailable optional capability disables only that feature, emits a
  diagnostic warning, and leaves all other features working (SPEC §46/§47).
- Malformed preferences produce `PREFERENCE_PARSE_FAILED`, default
  preferences, and continue startup (SPEC §40).
- Multiple shell roots trigger `SHELL_DUPLICATION` and convergence to exactly
  one (SPEC §21, invariant I-01).
- No workbench after 30 s → `UNSUPPORTED_LAYOUT`/`APPLICATION_NOT_DETECTED`,
  degraded reactive waiting — no steady-state polling is ever used (SPEC §27).

## Diagnostics

☰ → **Diagnostics** shows version, mode, orientation, viewport (plus
interaction signals and inferred keyboard state), every capability with its
evidence level and discovery level, shell/observer status (including observer
narrowing), navigation stack, observation/reconciliation counters, drift
events, warnings, feature-status table and recent events. The report is
copyable as plain text and requires no network access (SPEC §37). The console
hook is `GMUX.inspect()` (structured object + readable report); the legacy
`window.__GMUX__` alias (`state()`, `diagnostics()`, `dispatch(action)`,
`enable()`, `disable()`, `poke(reason)`) remains for compatibility. Both only
read local state.

## Privacy & security (SPEC §48)

No network requests, no telemetry, no remote resources, no external runtime
dependencies (statically enforced by `tests/gates.mjs`). The script never
reads or writes tokens, cookies, passwords, Git credentials or authorization
state, and never transmits repository or editor content. It performs no Git
operations of any kind.

## Verification

```bash
node tests/run-tests.mjs      # 113 pure-kernel checks
node tests/dom-smoke.mjs      # 37 fake-DOM lifecycle/idempotence checks
node tests/adapter-flow.mjs   # 50 stub-workbench adapter operation checks
node tests/recon-fixtures.mjs # 126 reconnaissance/registry/surface/fixture/mutation checks
node tests/gates.mjs          # writes diagnostics/gate-evidence.json (G0–G20)
node tests/gen-evidence.mjs   # regenerates evidence/*.json (optional set)
```

Static recognition fixtures live in [`fixtures/`](fixtures/)
(`baseline`, `explorer`, `search`, `terminal`, `missing-explorer`,
`changed-label`, `malformed`) — minimal, scriptless DOM cases the adapter
must handle without a live site. The 7-mutation matrix (ARIA changed, button
removed, container renamed, element moved/duplicated/hidden, role changed)
proves the critical invariant: broken recognition degrades with diagnostic
evidence instead of executing the wrong action.

Current release status: **PARTIALLY_VERIFIED** — kernel, lifecycle,
idempotence, preference tolerance, capability honesty, reconnaissance,
registry provenance, drift handling, fixture behavior, mutation safety and
the zero-network / zero-dependency contracts PASS in automation; live
github.dev actuation and Android device behavior remain UNTESTED and are
deliberately not claimed (see [`VERIFICATION_REPORT.md`](VERIFICATION_REPORT.md)).
Do not call this build “stable” or “production-ready”.

## Known compatibility risks

- Selectors for activity-bar items, sidebar view content and workbench parts
  are recorded OBSERVED/INFERRED from `microsoft/vscode` sources and a fetched
  github.dev page (2026-09-15) but are not yet VALIDATED on a live session.
- Synthesized keybindings are a fallback path; some mobile browsers may
  deliver keyboard events differently.
- Drawer/keyboard positioning relies on `visualViewport`; very old browsers
  fall back to window resize (`VIEWPORT_UNAVAILABLE`).
- `pushState`/`replaceState` are never monkey-patched; if the host interleaves
  its own history entries while an owned surface is open, Back yields to the
  host entry and re-converges on the next owned entry.
- Userscript-manager behavior on Android varies; Violentmonkey/Tampermonkey
  with `@grant none` are the tested-at-metadata targets.

## License

[MIT](LICENSE).
