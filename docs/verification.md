# Verification Plan & Status

Verification invariant (SPEC §36): **NO EVIDENCE → NO VERIFIED CLAIM.**
Statuses use the vocabulary of SPEC §35:
`VERIFIED · PARTIALLY_VERIFIED · PROVISIONAL · BLOCKED · OUT_OF_SCOPE`.

## 1. Automated suites (run in this repository)

```bash
node tests/run-tests.mjs    # kernel unit suite (77 checks)
node tests/dom-smoke.mjs    # fake-DOM boot/lifecycle smoke test (17 checks)
```

Both suites are dependency-free (plain Node ≥ 18). They cover the pure kernel
and the boot/teardown lifecycle only. **They do not constitute live-runtime
verification** of github.dev behavior.

| Suite | Covers (spec refs) |
|---|---|
| `run-tests.mjs` | Mode detection §3 · transitions §14 · preference tolerance §28 · scheduler coalescing §31 · command registry failure codes §15/§33 · capability classification §8 · terminal host rule §20 · keyboard inference §25 · gesture classifier §23 · reconcile planner §7/§12 · feature-status honesty §35/§36 |
| `dom-smoke.mjs` | Bootstrap idempotency §32 · WAITING_FOR_APP parking §32 · dynamic app detection §40 · shell mount §16 · disable/re-enable without reload §39 · degraded (no false capability) reporting §33/§43 |

## 2. Live-runtime test matrix (SPEC §37)

Status legend: ✅ automated · 🖐 manual — pending on a real github.dev
session · ➖ out of scope.

| Scenario | Status | How |
|---|---|---|
| Desktop > 1024px | 🖐 pending | Chrome DevTools, desktop size; expect: no shell header, minimal chrome |
| Compact 600–1024px | 🖐 pending | DevTools 768px; expect: bottom toolbar, native titlebar intact |
| Mobile portrait < 600px | 🖐 pending | DevTools Pixel/Galaxy profile; expect: header + bottom toolbar, immersive |
| Mobile landscape | 🖐 pending | Rotate profile; expect: same shell, re-fitted by visualViewport |
| Editor open | 🖐 pending | Open a file; header shows file name; `focus-editor` works |
| Explorer open (drawer) | 🖐 pending | Files button → sidebar overlays; file tap → editor, drawer closes |
| Search open | 🖐 pending | Search button → search view overlays; result tap → editor |
| Git open | 🖐 pending | Git button → SCM view overlays; **no GMUX-owned Git state** |
| Terminal open | 🖐 pending | On hosts with a terminal; on github.dev expect disabled button + honest diagnostic |
| Keyboard closed / open | 🖐 pending | Focus an input on Android; toolbar must stay above keyboard |
| Dynamic DOM changes | ✅/🖐 | Mutation-driven reconcile is unit-tested; confirm no loops live |
| Route / file / panel changes | 🖐 pending | Navigate between files/branches without reload; shell must follow |
| Gesture enabled | 🖐 pending | Edge swipes from shell zones only; editor untouched |
| Gesture disabled | 🖐 pending | Settings toggle; swipes inert |
| Fresh installation | ✅ | Defaults applied |
| Existing preferences | ✅ | Round-trip test |
| Corrupt preferences | ✅ | `PREFERENCE_PARSE_FAILED` + defaults, boot unaffected |
| Unsupported layout | ✅/🖐 | Smoke test parks in WAITING_FOR_APP/DEGRADED; confirm on non-VS Code page live |
| Missing terminal | ✅ | Capability UNSUPPORTED/NOT_DETECTED, toolbar honest |
| Missing Explorer | 🖐 pending | Capability NOT_DETECTED, command reports EXPLORER_NOT_FOUND |

## 3. Regression checklist (SPEC §38)

Re-run after any selector, adapter rule, or shell layout change:

- [ ] Editor remains editable
- [ ] Text selection remains functional
- [ ] Copy/paste remains functional
- [ ] Explorer remains usable
- [ ] Search remains usable
- [ ] GitHub UI remains responsive
- [ ] Terminal remains usable when present
- [ ] Shell can be disabled (Alt+Shift+G / GMUX menu / revive chip) and GitHub is left intact
- [ ] Desktop mode remains minimally intrusive

## 4. Release gates (SPEC §49) — current honest status

| Gate | Status |
|---|---|
| Userscript installs | 🖐 pending (metadata validated by inspection) |
| Bootstrap succeeds | ✅ smoke-tested |
| Adapter detected | 🖐 pending live |
| Mobile mode activates | 🖐 pending live |
| Editor remains functional | 🖐 pending live |
| Explorer works when detected | 🖐 pending live |
| Search works when detected | 🖐 pending live |
| Git surface does not duplicate Git state | ✅ by construction (no Git model in GMUX); confirm live |
| Terminal works when detected | 🖐 pending live (expected UNSUPPORTED on github.dev) |
| Android viewport handling works | 🖐 pending on device |
| Keyboard does not obscure shell | 🖐 pending on device |
| MutationObserver reconciliation works | ✅ coalescing unit-tested; loop-guard present |
| No polling loop is required | ✅ only bounded one-shot timers (boot warning, command validation) |
| Preferences tolerate corruption | ✅ unit-tested |
| No external dependency exists | ✅ zero imports, zero network calls |
| No telemetry exists | ✅ no network code paths at all |
| Disable/recovery works | ✅ smoke-tested |
| Unsupported capabilities reported honestly | ✅ capability/feature-status unit-tested |

**Release 0.1.0 must not be called "stable" until the 🖐 live gates pass.**

## 5. Manual test recipe

1. Install Tampermonkey/Violentmonkey in Chrome/Edge (or a userscript-capable
   Android browser, e.g. Firefox Android + Tampermonkey).
2. Install `github-dev-mobile.user.js`.
3. Open `https://github.dev/<owner>/<repo>` (sign in if required).
4. DevTools mobile emulation: toggle device toolbar, choose a phone profile.
5. Exercise the matrix above; open diagnostics (☰ → Diagnostics) to inspect
   capabilities, evidence levels, and the failure log; use **Copy report**
   when filing issues.
6. Alt+Shift+G disables/re-enables the shell without reloading.
