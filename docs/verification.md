# Live Verification Matrix — github.dev / Android

Automated verdict and the G0–G10 evidence ledger:
[`../VERIFICATION_REPORT.md`](../VERIFICATION_REPORT.md) · machine-readable:
[`../diagnostics/gate-evidence.json`](../diagnostics/gate-evidence.json).

This file is the **manual live matrix**. An entry moves a gate from
`PARTIALLY_VERIFIED`/`UNTESTED` to `PASS` only when the listed evidence has actually been
observed on a real `github.dev` session and appended to `docs/dom-evidence.md`.
Invariant (§68/§74): **NO EVIDENCE → NO VERIFIED CLAIM.**

Legend: ✅ automated evidence recorded · 🖐 live run pending · ➖ out of scope for v0.1.

## 1. Run the automated evidence first

```bash
node tests/run-tests.mjs       # 239 pure-kernel checks
node tests/dom-smoke.mjs       # 132 miniature-DOM lifecycle checks
node tests/recon-fixtures.mjs  # 255 recon/privacy/mutation/transaction/golden-state checks
node tests/gates.mjs           # writes diagnostics/gate-evidence.json (G0–G10)
node tests/gen-evidence.mjs    # regenerates evidence/*.json
```

If any suite is red, do not start the manual matrix: fix the runtime first.

## 2. Environment

| Field | Record it |
|---|---|
| URL actually loaded | `github.dev/...` or `vscode.dev/github/...` (**this decides G1**, see §5) |
| Browser + version | e.g. Chrome/Brave Android, Firefox Android, Safari iOS, Desktop Chrome |
| Userscript manager | Tampermonkey / Violentmonkey, `@grant none` |
| Viewport | `visualViewport.width × height`, `window.innerHeight` |
| Pointer/touch | `(pointer: coarse)`, `navigator.maxTouchPoints` |
| Device | physical model, OS version, notch/home bar present |

## 3. Runtime gates needing a live session

| # | Step | Expected | Gate |
|---|---|---|---|
| L1 | Load a repo page, open the console, run `GMUX.inspect()` | object + readable report; every line labelled OBSERVED/DERIVED/HEURISTIC/PROVISIONAL/VERIFIED/BLOCKED | G10 |
| L2 | Check `hostname`, `viewport`, `orientation`, `pointer type`, `touch points` | match the environment table in §2 | G2 |
| L3 | Resize across 599→600 and 1023→1024 | `mobile → compact → desktop`; shell hidden in desktop, host visually untouched | G8, G9 |
| L4 | `document.querySelectorAll('[data-gmux-owner="github-dev-mobile"][data-gmux-root="true"]').length` | exactly `1`, before and after heavy interaction | G4 |
| L5 | `document.querySelectorAll('[data-gmux-style]').length` | exactly `1` | G5 |
| L6 | Switch files, open panels, run a search — then reconcile again | no duplicate shell, no duplicate controls, `lastError: null` | G7 |
| L7 | Tap **Files / Search / Git / Terminal** with adapter revision 0 | each control is disabled **with a reason**, and nothing pretends to work; no host element is clicked by GMUX | §26 |
| L8 | Open `?gmux=off` | no shell, no style node, no observer, no host change at all | §38 |
| L9 | Set `{"disabled":true}` in `localStorage["github-dev-mobile:v1"]`, reload | same as L8 | §38 |
| L10 | Corrupt that key (`{ oops`), reload | GMUX boots with defaults and reports `preference-parse-failed`; **github.dev unaffected** | §37 |
| L11 | Header `☰` → diagnostics panel; `Escape`; header `‹` | diagnostics opens/closes; Back priority diagnostics → drawer → surface → browser default; **no history entry created by GMUX** (`history.length` unchanged) | §39/§40 |
| L12 | Break the host on purpose (devtools: rename a GMUX class, remove a control) | GMUX degrades with a diagnostic; no false claim; github.dev keeps working | §55/§59 |
| L13 | Read `mutation volume` in `inspect()` on a busy session | record the numbers for the §35 narrowing decision | §35 |

## 4. Phase B — reconnaissance (must run before any Phase C work)

```js
// on https://github.dev/<owner>/<repo>?gmux=recon
const p = GMUXRecon.run();
p.reconIntegrity.mutated;          // MUST be false (§42)
GMUXRecon.summary();
await GMUXRecon.verify('explorer', { allowInteraction: true });   // §49
GMUXRecon.fixture('explorer', 'closed');                          // §53
```

Record: candidate counts per surface, winning strategy per candidate (§51), the
`verify` outcome (`PROVISIONAL` only if the pre-state was restored, else `BLOCKED`), and
paste `GMUXRecon.json()` into `evidence/reconnaissance.json` with a live `provenance`
line. Full procedure: [`recon-guide.md`](recon-guide.md).

## 5. Routing check (decides whether G1 is enough)

Observed from this environment (2026-09-15, fetcher follows redirects):
`https://github.dev/microsoft/vscode` → `https://vscode.dev/github/microsoft/vscode`.

In a real browser, check the address bar after opening `https://github.dev/<owner>/<repo>`:

* **stays on `github.dev`** → the frozen `@match` is correct as specified; nothing to change.
* **becomes `vscode.dev/github/...`** → the runtime never executes, because userscript
  managers match the final URL. Record the observation, then treat this as a **spec
  amendment** (§4): add `// @match https://vscode.dev/github/*` and re-run G1/G2. Do not
  widen host scope by inference inside the implementation.

## 6. Android device matrix (§65)

| # | Step | Expected |
|---|---|---|
| A1 | Soft keyboard open/close while the diagnostics panel is open | `keyboard: likely/not indicated` flips; drawer bottom inset changes; no layout jump or scroll lock on the host |
| A2 | Same while the editor is focused | GMUX does not move, resize or scroll the editor; Monaco keeps its own scrolling (§31/§32) |
| A3 | Hardware Back with diagnostics open → then closed | first press closes diagnostics; second press goes to the browser — Back is never trapped |
| A4 | Rotation portrait ↔ landscape | mode/orientation re-derived; drawer width changes; no duplicated shell |
| A5 | Tap every control one-handed at 360px width | ≥44 CSS px targets, no misfires into host UI |
| A6 | Notched device / gesture bar | header and toolbar respect `env(safe-area-inset-*)` |
| A7 | Airplane mode with the script installed | no difference: GMUX makes zero network requests |
| A8 | 30-minute session, typing + file switching | `reconciliation count` grows only on real change; no growing node count under `[data-gmux-owner]`; no polling loops |

## 7. Evidence capture template

Append to `docs/dom-evidence.md`; promote a claim only from there:

```markdown
| # | Observation | Level | Date/Device |
|---|-------------|-------|-------------|
| L3 | 412px viewport classifies mobile; shell visible at 412, hidden at 1280 | OBSERVED | 2026-mm-dd / Chrome Android 14 |
```

Then re-run `node tests/gates.mjs` and update the status rows in
`VERIFICATION_REPORT.md` §2. If a live finding contradicts the pack, record it and raise
it as a **spec question** — do not silently deviate from the frozen boundary (§74).
