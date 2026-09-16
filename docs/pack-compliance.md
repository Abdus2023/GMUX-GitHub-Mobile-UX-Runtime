# Pack Compliance Audit — v0.1 Implementation Baseline + DOM Reconnaissance

**Normative input:** *GMUX GitHub.dev Mobile UX — Prompt Instructions Pack v0.1 (IMPLEMENTATION
BASELINE, 74 sections)*.
**Audited artifact:** `github-dev-mobile.user.js` (runtime) + `gmux-recon.user.js` (Phase B instrument).
**Date:** 2026-09-15 · **Status:** `PARTIALLY_VERIFIED` (see `diagnostics/gate-evidence.json`).

This file records two things:

1. **§-by-§ compliance** of the shipped baseline against the frozen pack.
2. **A deviation audit** of the previous working-tree implementation, which was a
   functional superset but violated 13 clauses of the pack — including three hard
   constraints. Every violation was removed rather than annotated.

Evidence column names the check that proves it. `run-tests` / `dom-smoke` /
`recon` are `tests/run-tests.mjs`, `tests/dom-smoke.mjs`, `tests/recon-fixtures.mjs`;
`gates` is `tests/gates.mjs` (G0–G10 per §60).

---

## 1. Compliance by section

| § | Requirement (abbreviated) | Status | Evidence |
|---|---|---|---|
| 1 | Observe → derive → present → adapt → observe → verify → commit → degrade | ✅ | `recon` §10 transaction path; runtime section map |
| 2 | Host is source of truth; no parallel authoritative copies | ✅ | `run-tests` §9 (no host-owned keys); `dom-smoke` §52 drift retreat |
| 3 | All 18 hard constraints (no @require/@connect/network/iframe/Git/terminal/polling/…) | ✅ | `run-tests` static scan over comment-stripped code; `gates` supplemental |
| 4 | Metadata block exactly as given | ✅ | `gates` **G1** (string equality, single `@match`) |
| 5 | One namespace: `{version,state,adapter,shell,observer,viewportObserver}` + `inspect()`; no unrelated globals | ✅ | `run-tests` §5 key-set equality; `dom-smoke` "no extra globals" |
| 6 | Dependency graph bootstrap → {adapter,state,shell} → scheduler; Action Engine between intent and adapter | ✅ | runtime structure; `recon` §10 (engine in the path) |
| 7 | `getEnvironment()` + `classifyViewport()` verbatim; never UA/brand-based | ✅ | `run-tests` §7 boundaries (599/600/1023/1024) + UA scan |
| 8 | `KEYBOARD_THRESHOLD = 150`, labelled HEURISTIC; OBSERVED/DERIVED/HEURISTIC distinct | ✅ | `run-tests` §8; `gates` **G10** kind labels |
| 9 | Frozen `initialState` key set; no host-owned state | ✅ | `run-tests` §9 exact key equality |
| 10 | All twelve actions; reducer never touches DOM | ✅ | `run-tests` §10 (12 actions + purity scan of reducer body) |
| 11 | `dispatch` → reducer → state → scheduleReconcile; controls never mutate state | ✅ | `dom-smoke` §11 handlers dispatch only; coalescing test |
| 12 | Intentionally incomplete adapter: BLOCKED/PROVISIONAL contract, `find*` → null, revision 0 | ✅ | `run-tests` §12 (every method, exact reasons) |
| 13 | Kernel knows no GitHub/VS Code/Monaco selectors, ids or hierarchy | ✅ | `run-tests` + `gates`: selector scan returns 0 hits |
| 14 | Observation records `{surface,detected,evidence,strategy,confidence}`; categorical confidence | ✅ | `run-tests` §14; numeric-confidence scan |
| 15 | Capabilities derived from observations; existence ≠ operational verification | ✅ | `run-tests` §15; `recon` §11 (all BLOCKED) |
| 16 | Every host interaction through the Action Engine; no `element.click()` in UI handlers | ✅ | `run-tests` §16 short-circuit order; `.click()` scan = 0 |
| 17 | Action contract `id/target/precondition/invoke/verify/reversible` | ✅ | `run-tests` §17 field check for all actions |
| 18 | Snapshot → action → observe → verify → commit or restore | ✅ | `recon` §10: commit path **and** FAIL → RESTORE path |
| 19 | Result statuses `VERIFIED/PARTIALLY_VERIFIED/PROVISIONAL/BLOCKED` only | ✅ | `run-tests` §19 vocabulary equality |
| 20 | Bounded, mutation-aware, deterministic stabilization | ✅ | `run-tests` §20 termination + parameter honouring |
| 21 | Reconciliation idempotent, convergent, no duplicate shell/listeners | ✅ | `gates` **G7**; `dom-smoke` 25-reconcile markup equality |
| 22 | One pending rAF: N mutations → ≤ 1 reconciliation | ✅ | `gates` **G7** coalescing; `dom-smoke` 40-dispatch check |
| 23 | Shell structure + `data-gmux-owner`/`data-gmux-root`/`data-gmux-style`; `gmux-` prefix | ✅ | `dom-smoke` §23 structure + id-prefix scan |
| 24 | Shell singleton via the owner+root selector | ✅ | `gates` **G4** (5 extra calls → still 1 root) |
| 25 | Controls created once; reconciliation updates attributes only | ✅ | `dom-smoke` node identity + listener-count checks |
| 26 | Four surface commands; VERIFIED→enabled, PROVISIONAL→diagnostics, BLOCKED→disabled + reason | ✅ | `dom-smoke` §26 (aria-disabled + title reason); `recon` §10 (enables on VERIFIED) |
| 27 | `render()` sets dataset.mode/surface, hides on desktop, renders header + toolbar | ✅ | `gates` **G8**/**G9** |
| 28 | Exactly one style node, narrow selectors, no `* {}`, no `!important` | ✅ | `gates` **G5**; `dom-smoke` style hygiene |
| 29 | Layout policy: desktop native → compact layer → mobile immersive + drawers | ✅ | `dom-smoke` mode/visibility matrix |
| 30 | Drawer is a presentation/windowing layer; no casual reparenting | ✅ | `dom-smoke` "nothing reparented"; `recon` host-equality |
| 31 | Monaco is a black box; no cursor/selection/model/scroll/command control | ✅ | `.click()`/Monaco-API scans; `focus-editor` stays BLOCKED |
| 32 | Explicit scroll ownership; no global `body{overflow:hidden}` | ✅ | `dom-smoke` style hygiene; body-style scan |
| 33 | `env(safe-area-inset-*)`, toolbar honours bottom inset | ✅ | `dom-smoke` CSS checks (custom-property aliasing) |
| 34 | ≈44×44 CSS px target, large hit area + small label | ✅ | `TOUCH_TARGET = 44` in min-width/min-height; `run-tests` |
| 35 | MutationObserver on `document.body`, PROVISIONAL, mutation volume measured for narrowing | ✅ | `dom-smoke` §35 churn + volume counters |
| 36 | visualViewport resize+scroll, passive, scroll provisional | ✅ | `dom-smoke` listener count; `gates` **G6** |
| 37 | Key `github-dev-mobile:v1`; defensive load; config never host truth | ✅ | `run-tests` §37; `dom-smoke` corrupt/partial prefs |
| 38 | Kill switch: `disabled:true` and `?gmux=off` → no shell/observer/interaction; checked first | ✅ | `dom-smoke` §9 (both paths) |
| 39 | Back as an application command with the 4-step priority; never trapped; no history entries | ⚠️ partially | Priority + Escape + in-shell Back tested (`dom-smoke` §39). **Android hardware-Back interception deliberately not attempted** — the only mechanism requires history entries, which §40 forbids. Recorded as `docs/recon-guide.md` open item, not as "working" |
| 40 | Internal navigation stack only | ✅ | `run-tests` `navStack`; `history.pushState` scan = 0 |
| 41 | Gestures not required for v0.1 correctness | ✅ | **No gesture code shipped** — no Pointer Events handlers, no edge zones (deliberate: §65 orders them after verified actions) |
| 42 | Recon is a separate temporary capability and must not modify the UI | ✅ | `recon` §7 read-only proof; separate artifact |
| 43 | Recon privacy boundary (no repo/file/terminal/commit/user/token/cookie/storage data) | ✅ | `recon` §3 sentinel scan (8 planted sentinels, 0 leaks) |
| 44 | Semantic-first candidate discovery over `[aria-label],[title],[role],button` | ✅ | `recon` §2 |
| 45 | Compact structural fingerprint only — never a DOM dump | ✅ | `recon` §2 field-by-field + bounds |
| 46 | `gmux.recon/v1` output; evidence ≠ verified capability | ✅ | `recon` §1 (`isVerifiedCapability: false`) |
| 47 | Every candidate keeps its reason; progression stays `candidate → … → VALIDATED` | ✅ | `recon` §2 evidence shape |
| 48 | Only safe interactions allowed; destructive verbs forbidden | ✅ | `recon` §5 (denylist + allowlist) |
| 49 | locate → snapshot → act → stabilize → observe → compare → restore, else BLOCKED | ✅ | `gmux-recon.user.js` `Recon.verify()`; harness-tested authorisation gates |
| 50 | Recon output is never auto-converted into executable selectors | ✅ | `recon` §6 (no `selector` field; runtime never calls recon) |
| 51 | Selector strategy order ARIA → title → data attr → role+name → structure → class, and it reports which won | ✅ | `recon` §4 rank assertions |
| 52 | Mapping loss → fallback or BLOCKED; never silent, never VERIFIED after drift | ✅ | `recon` §10 drift path (retreat + logged reason) |
| 53 | `fixtures/github-dev/*.json` in `gmux.fixture/v1` | ✅ | `recon` §9 (6 files, role+name only) |
| 54 | Golden-state invariant CLOSED → OPEN → CLOSED | ✅ | `recon` §10 (host value restored exactly) |
| 55 | Mutation tests degrade to PROVISIONAL/BLOCKED, never false VERIFIED | ✅ | `recon` §8 (8 mutations) + `evidence/mutation-results.json` |
| 56 | GMUX version independent of adapter revision | ✅ | `recon` §10 fingerprint/revision independence |
| 57 | Host fingerprint from semantic controls, structure, capability set, revision | ✅ | `run-tests` §57 (deterministic + input-bearing) |
| 58 | `GMUX.inspect()` exposes the full §58 field list with claim kinds | ✅ | `gates` **G10** (19 required labels) |
| 59 | Bootstrap containment: GMUX fails → log → stop → host continues | ✅ | `gates` **G3**; `dom-smoke` throwing-host + no-body |
| 60 | Gates G0–G10 | ✅ 10 PASS, G8 PARTIAL | `diagnostics/gate-evidence.json` |
| 61 | Runtime acceptance behaviour | ✅ | `dom-smoke` §1–§7 + `docs/verification.md` procedure |
| 62 | Phase B gate only after runtime gates | ✅ | gates pass; `gmux-recon.user.js` shipped, live run pending |
| 63 | Phase C gate only after Recon | ✅ honoured | adapter revision stays **0**; no selectors in runtime |
| 64 | Phase D surfaces gated on verification | ✅ | toolbar disabled-with-reason until `resolveSurface` says VERIFIED |
| 65 | Phase E after core interactions | ✅ honoured | keyboard heuristic + Back command only; no gestures |
| 66 | Phase F final verification | ⛔ not reached | `toReachVerified` list in `diagnostics/gate-evidence.json` |
| 67 | Performance targets are engineering targets, not claims | ✅ | `gates` records harness estimates as `UNVERIFIED` |
| 68 | UNKNOWN ≠ FALSE/TRUE; BLOCKED/PROVISIONAL/VERIFIED discipline | ✅ | `run-tests` §15/§18; `recon` §11 |
| 69 | No state drift: REQUEST → PENDING → ACT → OBSERVE → VERIFY → COMMIT, else REJECT | ✅ | `recon` §10; `run-tests` CLOSE/REJECT checks |
| 70 | Final architecture shape | ✅ | runtime section map |
| 71 | Architectural principle (the system may say "I don't know") | ✅ | every surface reports BLOCKED with a reason |
| 72 | Next artifact = runtime (13 named parts, no selectors) + separate Recon mode | ✅ | both files; `run-tests` selector scan = 0 |
| 73 | Progression OBSERVED → … → RELEASED with failure states | ✅ | overall status `PARTIALLY_VERIFIED`; never `RELEASED` |
| 74 | Final non-negotiable invariant | ✅ | `gates` G2/G3/G8 + drift path + evidence-only promotion |

---

## 2. Deviation audit — what the previous baseline got wrong

The working tree already contained a 3,137-line v0.1 build whose own tests passed.
It was *behaviourally* richer but **non-compliant with this pack**, so it could not
serve as the frozen baseline. Each row is the violation, the evidence, and the
resolution now shipped.

| ID | Violation | Evidence in the old build | Resolution |
|---|---|---|---|
| DEV-1 | §4 "use exactly" — 4 `@match` lines incl. `*.github.dev`, `vscode.dev/github/*`; extra `@author`/`@license`/`@noframes`; wrong `@namespace` and `@description` | old header lines 2–14 | exact §4 block restored; verified by **G1** string equality |
| DEV-2 | §5 "one namespace… do not create unrelated globals" — `window.__GMUX__`, `window.__GMUX_INTERNALS__` | old lines 3065–3097, 3129 | single `window.GMUX`; internals exported to Node only via `module.exports` |
| DEV-3 | §12/§13/§72 "no guessed GitHub selectors belong in v0.1 Runtime" — 39 host-selector occurrences in the runtime | `monaco-workbench` ×8, `action-label` ×10, `activitybar` ×8, `part.panel` ×4, `part.sidebar` ×2, `inputarea` ×2, `view-lines`, `explorer-folders-view` ×3, `monaco-breadcrumbs` ×2 | adapter restored to the §12 stub (all `find*` → null, BLOCKED contract); host structure now belongs to the Recon artifact |
| DEV-4 | §3 "must not rewrite host DOM unnecessarily" — `classList` writes on the host workbench, host-scoped CSS with 6 `!important` | old lines 2583–2584, 2873, 1751–1762 | zero host class/style writes and zero `!important`; scans assert it |
| DEV-5 | §39/§40 "do not create browser history entries for ordinary GMUX surfaces" — `pushState` history layering with a `gmux` marker | old lines 2499–2572 | no history API use at all; Back is an application command with the §39 priority (scan for `pushState` = 0) |
| DEV-6 | §38 "If disabled: NO shell NO observer NO host interaction NO presentation mutation" — a `.gmux-revive` chip and a global keydown toggle were installed while disabled | old lines 3007–3038, 3101–3107 | disabled path returns before any mount; verified for both `?gmux=off` and `preferences.disabled` |
| DEV-7 | §37 storage key must be `github-dev-mobile:v1` — used `gmux:prefs:v1` plus a second key `gmux:disabled` | old line 66–67 | single frozen key holding the `disabled` field; corrupt/partial handling tested |
| DEV-8 | §9/§10 state and action vocabulary — extra state keys (`lifecycle`, `nav`, counters) and action names (`OPEN_SURFACE` etc.) | old §B/§C | exact §9 key set and the twelve §10 action names; key-set equality asserted |
| DEV-9 | §14/§15/§19 vocabularies — `DETECTED/NOT_DETECTED/UNKNOWN`, six evidence levels, numeric `confidence: 2` in the registry | old lines 74–90, `evidence/selector-registry.json` | categorical `UNKNOWN/LOW/MEDIUM/HIGH` (§14) and the four §19 statuses; numeric confidence is statically forbidden |
| DEV-10 | §23/§24 shell root id `github-mobile-ux` violates the `gmux-` prefix rule; duplication detection by id | old line 68, 2608 | `#gmux-root` plus `data-gmux-owner`/`data-gmux-root`, looked up through the §24 selector |
| DEV-11 | §60 the normative gate list is G0–G10 — the suite reported G0–G20 with different names, so "gate passed" could not be read against the pack | old `tests/gates.mjs` | `tests/gates.mjs` now emits exactly G0–G10; extra static scans moved to `supplementalChecks` |
| DEV-12 | §48/§67 measured performance was recorded as evidence from a stub workbench | old `adapter-flow.mjs` (deleted) | harness timings are labelled `UNVERIFIED`, with the real measurement path documented |
| DEV-13 | §53 fixtures must live in `fixtures/github-dev/*.json` as `gmux.fixture/v1` | only `fixtures/*.html` existed | 6 JSON fixtures added in the mandated format; the HTML pages remain as *recon* inputs only |

### Deliberate non-changes

* `GMUX.getState()/getCapabilities()/reconcile()/disable()` and the `Alt+Shift+G`
  toggle were dropped: §5 fixes the namespace surface, and §38's kill switch is
  preferences/query-param based. `GMUX.inspect()` covers diagnostics; `DISABLE` is a
  reducer action (§10), so no imperative off-switch API is needed.
* The `gestures: false` feature-flag machinery was removed rather than kept off: §41
  makes gestures out of scope for v0.1, and a flag for unimplemented code invites the
  illusion of a boundary. Absence is now provable by scan.
* `docs/dom-evidence.md` was retained but re-labelled: its selector observations are
  *candidate inputs for Phase B review*, not runtime knowledge.

---

## 3. Open items (not gaps in compliance)

1. **Host routing risk — the one decision that may need a pack amendment.**
   From this environment, `https://github.dev/microsoft/vscode` and `https://github.dev/`
   both resolve to `https://vscode.dev/github/…` and `https://vscode.dev/` respectively
   (observed 2026-09-15 via the workspace fetcher, which follows redirects; recorded
   `OBSERVED` for the fetch path, `UNTESTED` for a real browser). If a browser also
   follows that redirect, a script matching only `https://github.dev/*` never executes,
   because userscript managers match the final document URL. §4 freezes the metadata to
   a single `@match` and §72 forbids widening the host scope, so the baseline complies
   and flags the risk instead of silently amending the spec. The one-line resolution,
   if a live check confirms the redirect: add `// @match https://vscode.dev/github/*`.
2. **G8 desktop usability** needs a human/browser pass (tap targets, scroll ownership,
   focus order). Everything machine-checkable about it already passes.
3. **Android hardware Back** (§39/§65) stays open pending a decision that does not
   violate §40.
4. **Phase B live run** (§62): `GMUXRecon.run()` has never been executed on a real
   github.dev session; `evidence/reconnaissance.json` is harness-produced and marked
   `UNVALIDATED_LIVE`.
5. **§35 observer narrowing** requires measuring mutation volume on the host; the
   counters and peak-rate instrumentation needed to decide are already shipped.
