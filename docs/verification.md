# Live Verification Matrix — github.dev / Android

The automated verdict and the G0–G20 evidence ledger live in
[`../VERIFICATION_REPORT.md`](../VERIFICATION_REPORT.md) (machine-readable:
[`../diagnostics/gate-evidence.json`](../diagnostics/gate-evidence.json)).

This file is the **manual live matrix**. Entries here only move a gate from
PARTIAL/UNTESTED to PASS when the listed evidence has actually been observed
on a real github.dev session and appended to `docs/dom-evidence.md`.
Invariant I-15: **NO EVIDENCE → NO VERIFIED CLAIM.**

## 1. Run the automated evidence first

```bash
node tests/run-tests.mjs     # pure kernel (113 checks)
node tests/dom-smoke.mjs     # fake-DOM lifecycle (37 checks)
node tests/adapter-flow.mjs  # stub workbench adapter operations (50 checks)
node tests/gates.mjs         # writes diagnostics/gate-evidence.json
```

## 2. Manual live matrix (SPEC §49/§52)

Status legend: ✅ automated evidence recorded · 🖐 live run pending · ➖ out of scope.

| Gate | Scenario | Status | Expected live evidence |
|---|---|---|---|
| G2 | Open `https://github.dev/<owner>/<repo>` | 🖐 | diagnostics header shows `Adapter: github-dev`, shell begins in WAITING→ACTIVE |
| G3 | DevTools phone profile, 360–430 px | 🖐 | `Mode: MOBILE`, header + bottom bar visible |
| G3 | DevTools 768 px | 🖐 | `Mode: COMPACT`, bottom bar, native titlebar still respected |
| G3 | Desktop > 1024 px | 🖐 | `Mode: DESKTOP`, shell chrome hidden (`gmux-no-header gmux-no-footer`) |
| G4 | Repeated reconcile (scroll, switch tabs) | ✅/🖐 | automated idempotence PASS; confirm one `#github-mobile-ux` live |
| G5 | Open a file and edit it | 🖐 | type, caret, selection, copy/paste, touch scroll all work; minimap/breadcrumb hidden |
| G6 | Tap **Files** | 🖐 | existing VS Code sidebar overlays as drawer; diagnostics later shows Explorer VALIDATED |
| G7 | Tap a file in the drawer | 🖐 | returns to editor, drawer closes, Back stack empty |
| G8 | Tap **Search** | 🖐 | existing Search view overlays; no custom search backend |
| G9 | Close Search (Back/Escape/tap active) | 🖐 | returns to editor |
| G10 | Tap **Git** | 🖐 | existing Source Control view overlays; GMUX owns no Git state |
| G11 | Close Git | 🖐 | returns to editor |
| — | Tap **Term.** | ✅/🖐 | control disabled (`aria-disabled`), tapping announces unavailability; no terminal claimed |
| G12 | Hardware Back with drawer open | 🖐 | drawer closes; second Back leaves the page (never trapped) |
| G12 | Back with settings/diagnostics modal open | 🖐 | modal closes, drawer/surface underneath preserved |
| G12 | Back with Ctrl+Shift+P palette open | 🖐 | host quick input dismissed |
| G12 | Back at editor, nothing owned | 🖐 | browser navigates normally (ALLOW_BROWSER_DEFAULT) |
| G13 | Focus editor (soft keyboard appears) | 🖐 | bottom bar stays visually above the keyboard; no layout breakage; keyboard reported INFERRED |
| G14 | Open another file / change view without reload | 🖐 | shell follows (surface adoption), no duplicate shell, reconciliation continues |
| G16 | Change prefs, reload | 🖐 | prefs restored from `gmux:prefs:v1` |
| G17 | Set storage value to `{bad` manually, reload | 🖐 | `PREFERENCE_PARSE_FAILED` warning, defaults, shell boots |
| — | Alt+Shift+G | 🖐 | shell tears down; VS Code UI intact; GM chip/Alt+Shift+G restores it |
| G18 | Host without explorer/search DOM | 🖐 | capabilities NOT_DETECTED, buttons actuate to structured failures, other features continue |

## 3. Minimum acceptance walk-through (SPEC §52)

1. Open github.dev.
2. Wait for application detection (WAITING_FOR_APP → ACTIVE in diagnostics).
3. Enter mobile mode (narrow viewport).
4. Verify exactly one shell root (`#github-mobile-ux`).
5. Verify the editor remains usable (type/select/scroll/copy/paste).
6. Open Explorer; close Explorer.
7. Open Search; close Search.
8. Open Source Control; close Source Control.
9. Exercise Android Back at each layer, then at the editor.
10. Open the soft keyboard; confirm the shell remains visible.
11. Navigate between files/routes.
12. Trigger repeated reconciliation (observe counter growth, no duplicates).
13. Reload; verify preferences.
14. Inspect diagnostics (☰ → Diagnostics) and use **Copy report**.

## 4. Regression checklist (rerun after any adapter/CSS change)

- [ ] Editor editable; caret, selection, clipboard, scroll intact (§29/§30)
- [ ] Explorer / Search / Source Control are the *existing* VS Code views, repositioned only
- [ ] No Git operation affordances introduced (§33)
- [ ] Back never permanently traps (§34, I-11)
- [ ] Exactly one shell, one toolbar, one stylesheet under all flows (I-01)
- [ ] Every userscript element carries `data-gmux-owner="github-dev-mobile"` (I-13)
- [ ] No network requests appear in the DevTools Network panel originating from the userscript (G19)
- [ ] Desktop mode stays minimally intrusive
- [ ] Disable/re-enable leaves the host application intact

## 5. Promoting evidence

When a live run succeeds: append the observed facts to
`docs/dom-evidence.md` with the date and evidence level (VALIDATED for
observed state transitions), rerun `node tests/gates.mjs` after updating the
gate basis where the harness cannot record the live fact itself, and update
`VERIFICATION_REPORT.md`. Do not mark a gate PASS from a screenshot alone —
the expected state transition must be described.
