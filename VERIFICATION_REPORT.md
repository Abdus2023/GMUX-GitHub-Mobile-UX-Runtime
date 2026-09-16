# GMUX v0.1 — Verification Report

> Governing evidence law (pack §68/§74): **NO EVIDENCE → NO VERIFIED CLAIM.**
> Status vocabulary: `PASS · PARTIALLY_VERIFIED · UNTESTED · BLOCKED · FAIL`.
> Claim kinds recorded everywhere: `OBSERVED · DERIVED · HEURISTIC · PROVISIONAL · VERIFIED · BLOCKED`.
> Promotion to `VERIFIED` requires an observed host transition plus a successful restore
> (§49/§54). This report does not promote untested behaviour.

- **Version:** `0.1.0` — runtime `github-dev-mobile.user.js`; recon instrument `gmux-recon.user.js`
- **Adapter:** `github-dev@0` — **intentionally incomplete** (pack §12): no GitHub/VS Code
  selectors exist in the runtime, so every host operation is `BLOCKED` by contract
- **Target:** `https://github.dev/*` (the pack's frozen, single `@match`)
- **Contract:** *Instructions Pack v0.1* (74 sections). Per-section audit:
  [`docs/pack-compliance.md`](docs/pack-compliance.md)
- **Test environment:** headless Node v22 on Linux. Three dependency-free suites,
  **635 checks, 0 failures**:
  | suite | checks | scope |
  |---|---|---|
  | `tests/run-tests.mjs` | 239 | pure kernel: metadata, environment, heuristic labelling, state/reducer/dispatch/scheduler, adapter contract, capability + verification discipline, preferences, diagnostics, static constraint scans |
  | `tests/dom-smoke.mjs` | 141 | real bootstrap against a miniature DOM: singletons, idempotence, coalescing, host-untouched, kill switch, Back, teardown, style hygiene |
  | `tests/recon-fixtures.mjs` | 255 | recon schema + privacy sentinels + read-only proof, strategy preference, interaction authorisation, §55 mutation matrix, §53 fixtures, §54 golden state, §52 drift, §56/§57 revision + fingerprint |
- **Gate evidence:** [`diagnostics/gate-evidence.json`](diagnostics/gate-evidence.json)
  (normative gates **G0–G10**, §60; extra static scans under `supplementalChecks`)
- **Machine-readable evidence:** [`evidence/adapter-status.json`](evidence/adapter-status.json) ·
  [`evidence/reconnaissance.json`](evidence/reconnaissance.json) ·
  [`evidence/mutation-results.json`](evidence/mutation-results.json) ·
  [`evidence/fixtures-index.json`](evidence/fixtures-index.json)
- **Live host:** **not available** — no real `github.dev` session was opened in this
  environment; the only host observation is a redirect probe (see *Routing* below)
- **Device:** no physical or emulated Android device was exercised (**UNTESTED**)

## 1. Overall verdict

```
STATUS: PARTIALLY_VERIFIED
```

`v0.1 RUNTIME BASELINE` requires G0–G10 all `PASS` (§60). Ten of eleven are `PASS`;
**G8 (desktop remains usable)** is `PARTIALLY_VERIFIED` because its usability half
(tap targets, scroll ownership, focus order, keyboard flow) cannot be evidenced in a
Node harness, and §68 forbids promoting it on inference. This is the honest ceiling for
this environment; it is not a defect in the artifact.

Per §73 the progression is `OBSERVED → INFERRED → PROVISIONAL → VALIDATED → VERIFIED →
RELEASED`, with failure states `BLOCKED`/`PARTIALLY_VERIFIED`. This build sits at
`PROVISIONAL` for its own runtime behaviour and `BLOCKED` for host operations, and is
therefore **not** released.

## 2. Normative gates (§60)

| Gate | Name | Status | Evidence |
|---|---|---|---|
| G0 | script parses | **PASS** | `node --check` on both artifacts |
| G1 | `@match` correct | **PASS** | metadata parsed and compared field-by-field to §4; exactly one `@match`; no extra directives |
| G2 | github.dev detected | **PASS** | mounts on `github.dev`; zero shell/style/observer on `github.com`, `vscode.dev`, `example.com`, `gist.github.com` |
| G3 | bootstrap failure contained | **PASS** | hostile DOM (`appendChild` throws): no exception escapes, failure logged, no partial shell |
| G4 | shell created once | **PASS** | 5 extra `createShell()`/`createMobileShell()` calls → still exactly one `[data-gmux-owner][data-gmux-root]` |
| G5 | style created once | **PASS** | repeated `installStyles()` → one `[data-gmux-style]` node |
| G6 | observer created once | **PASS** | repeated installs do not replace the observer; exactly 2 viewport listeners (resize, scroll) |
| G7 | reconciliation idempotent | **PASS** | 50 reconciles → byte-identical shell markup, one root; 100 dispatches coalesce to ≤ 2 reconciliations |
| G8 | desktop remains usable | **PARTIALLY_VERIFIED** | shell `hidden`, host markup byte-identical to the same fixture with no GMUX, no host class writes — machine-checked. Human usability needs a browser |
| G9 | mobile classification works | **PASS** | 320/599 → mobile · 600/768/1023 → compact · 1024/1440 → desktop, with shell visibility matching, from viewport geometry only |
| G10 | diagnostics available | **PASS** | `GMUX.inspect()` exposes all 19 §58 fields; every field carries a claim kind |

## 3. Supplemented contract checks (not part of G0–G10)

| Check | Result |
|---|---|
| No `@require` / `@resource` / `@connect` | ✅ PASS |
| No network primitives (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `GM_xmlhttpRequest`, dynamic `import`) in executable code | ✅ PASS |
| No iframe, no framework references | ✅ PASS |
| **No GitHub/VS Code/Monaco selectors or host ids in the runtime** (§12/§13/§72) | ✅ PASS — 0 matches |
| No history API use (`pushState`/`replaceState`/`history.go`) (§39/§40) | ✅ PASS |
| No `element.click()` in the runtime (§16) | ✅ PASS |
| No host class/style writes (§3/§30/§31) | ✅ PASS |
| No continuous polling (`setInterval`) (§3/§67) | ✅ PASS |
| Adapter revision starts at 0 (§56) | ✅ PASS |
| Recon artifact is read-only (no create/append/setAttribute/classList/innerHTML) | ✅ PASS |
| `fixtures/github-dev/*.json` present in `gmux.fixture/v1` | ✅ PASS — 6 files |
| All automated suites green | ✅ PASS |

## 4. Privacy boundary (§43)

Recon output is scanned for eight planted content sentinels (repository file names,
editor code text, token-shaped strings, terminal output, shell command text, an input
value, a credential-shaped data attribute). **0 leaks** in `tests/recon-fixtures.mjs` §3
and in `evidence/reconnaissance.json`.

The guarantee is structural rather than a scrubber: recon only reads *interaction
controls* whose own text matches a UI token, so content-bearing nodes (tree rows, list
items, cells, inputs, editor/terminal regions) are never candidates at all. Long or
free-form labels are omitted rather than truncated into partial leaks.

## 5. Mutation safety (§55)

Eight mutations of a known-good host — ARIA label changed, button removed, container
moved, panel renamed, visibility changed, duplicate candidate added, role changed,
irrelevant candidate added — were applied and re-scanned. In every case:

* no candidate was promoted above `confidence: "candidate"`;
* no `operational`/`verified` flag appeared;
* no `"VERIFIED"` string was produced;
* discovery terminated and reported its skip counters.

Runtime-side check: when the observation confidence of an otherwise verified mapping is
lowered to `LOW`, the action returns `BLOCKED` naming the shortfall
(`post-state confidence is LOW, below HIGH`) and **no surface commits**. Restoring
`HIGH` confidence verifies again. `mutation → false VERIFIED` did not occur.

## 6. Transaction and golden-state evidence (§16/§18/§19/§54)

A `VERIFIED` mapping was **supplied by the test as a swap-in adapter** (the shipped
artifact still contains no selectors), driving a fake host element:

1. `requestSurface('explorer','open')` → `VERIFIED` with evidence `closed → open`;
   host attribute changed; `state.surface === 'explorer'`; `previousSurface === 'editor'`;
   `pendingAction === null`; control `aria-pressed="true"`.
2. `requestSurface('explorer','close')` → `VERIFIED`; host value **byte-equal to the
   pre-test snapshot**; `surface === 'editor'`; drawer closed. **Golden-state invariant
   holds.**
3. Failure path — adapter invokes successfully but changes nothing: `BLOCKED` with
   `no state transition was observed`, restore attempted (`PROVISIONAL`), **no commit**,
   pending cleared, host left where it was. A successful JS call was not treated as
   evidence of a UI transition (§18).
4. Drift path — a committed surface stops being observed: GMUX retreats to `editor`,
   logs `adapter drift: … retreating to editor (§52)`, shows the reason in the shell,
   and re-disables the control. Never silent; never `VERIFIED` after drift (§52).
5. Capability honesty — with the shipped revision-0 adapter, `search`/`sourceControl`/
   `terminal`/`editor`/`explorer` all report `operation: BLOCKED`, `confidence: UNKNOWN`,
   and a tap on a blocked control produces no host call at all (§26/§68).

## 7. Heuristics and provisional items recorded as such

| Item | Kind | Note |
|---|---|---|
| keyboard state | **HEURISTIC** | `innerHeight − visualViewport.height > 150px`; never described as detection (§8) |
| orientation, mode, capabilities, fingerprint, compatibility, nav stack | **DERIVED** | mode may carry a stated `configuration-override` basis (§37) |
| mutation observer scope | **PROVISIONAL** | `document.body`, `childList+subtree+attributes`; narrowing needs host volume data (§35) |
| viewport `scroll` listener | **PROVISIONAL** | provisional until measured (§36) |
| `restore()` outcome | **PROVISIONAL** | the fail path reports restore as *attempted, not verified* |

## 8. Performance (§67)

`tests/gates.mjs` reports bootstrap and per-reconciliation timings from the harness,
explicitly labelled `UNVERIFIED` because they are not browser measurements. **No §67
target is claimed as met.** The pack requires real execution data before any of them
may be called `VERIFIED`.

## 9. Routing observation (material to G1/G2)

`OBSERVED` (this environment's fetcher, which follows redirects, 2026-09-15):
`https://github.dev/microsoft/vscode` → final URL `https://vscode.dev/github/microsoft/vscode`;
`https://github.dev/` → `https://vscode.dev/`.

`UNTESTED`: whether a real browser keeps the address on `github.dev`. Userscript managers
match the final document URL, so if browsers follow the same redirect, the §4-frozen
single `@match https://github.dev/*` would never fire. The baseline keeps the mandated
metadata and records the risk rather than widening host scope on inference (§4/§68).
Resolution requires a spec amendment: add `// @match https://vscode.dev/github/*` after a
live check.

## 10. Deliberately untested

1. Live `github.dev` actuation of any surface (no verified mapping exists — §12).
2. Android hardware Back, soft keyboards, IME, keyboard overlay geometry.
3. Real `visualViewport` resize/scroll cadence and §35 mutation volume on a busy session.
4. Touch target size in physical CSS pixels on real devices (the 44px value is a design
   target, §34).
5. Safe-area insets in browsers with notches/home bars.
6. Long-session performance, memory and leak behaviour.
7. Behaviour across VS Code Web release trains (host DOM drift, §52).
8. Userscript-manager installation paths on Android.

## 11. How to read this report

| Symbol | Meaning |
|---|---|
| ✅ **VERIFIED** | observed transition + successful restore, on the real host |
| 🟡 **PARTIALLY_VERIFIED** | some evidence exists; a required portion is unverified |
| ⚪ **PROVISIONAL** | identified or attempted, not validated |
| ⛔ **BLOCKED** | contractually withheld: no evidence, no operation |
| ❓ **UNTESTED** | no evidence obtained |

**Bottom line.** The v0.1 runtime boundary is implemented and internally evidenced: the
shell, state machine, scheduler, kill switch, preferences, diagnostics and the
adapter/action-engine discipline all hold under automation, and the runtime is provably
free of host selectors, network access and host DOM writes. What it *cannot* do — and
honestly says it cannot do — is operate GitHub's UI, because adapter revision 0 has no
reviewed mappings. The next step is not more UI: it is the live Recon run documented in
[`docs/recon-guide.md`](docs/recon-guide.md).
