# DOM Evidence Log — `github.dev` / VS Code for the Web

> ## ⚠️ Status of this file (read first)
>
> **These observations are *candidate inputs for Phase B review*. They are not runtime
> knowledge.** Pack §12/§13/§72 forbid GitHub/VS Code selectors, Monaco selectors, host
> element ids and host DOM hierarchy inside `github-dev-mobile.user.js`, and the shipped
> runtime contains none of them (statically verified: `node tests/gates.mjs`).
>
> Consequences of that boundary:
>
> * Nothing below is *used* by v0.1. It stays here as prior observation so Phase B can
>   confirm, refute or re-rank it — not as a selector bank to copy from.
> * The correct instrument for collecting current structure is `gmux-recon.user.js`
>   (`GMUXRecon.run()` on a live session); see [`recon-guide.md`](recon-guide.md).
> * Promotion path for any entry below: `candidate → human review → adapter definition →
>   fixture → interaction verification → release gate` (§50). A selector is evidence, not
>   truth; detection is not operation and operation is not validation.
> * **Correction to §1 below:** the "Implication" paragraph records host detection
>   accepting `*.github.dev` and `vscode.dev/github/*`. That was the *previous*
>   implementation's widened scope, which pack §4 supersedes: v0.1 matches
>   `https://github.dev/*` only, and `github.dev` is the host source of truth. The
>   redirect question is recorded as an open item in
>   [`../VERIFICATION_REPORT.md`](../VERIFICATION_REPORT.md) §9 and
>   [`verification.md`](verification.md) §5 — to be settled by a live browser check, not
>   by inference.
> * Entries below marked `OBSERVED` were read from a fetched page or from
>   `microsoft/vscode` sources on the stated date; none is `VALIDATED`, and none may be
>   relabelled `VALIDATED` without the §49 interaction procedure plus a §54 golden-state
>   pass on a real session.

This file is the observation record behind every adapter selector. SPEC
§58 rules 1/4 require inspecting before modifying and forbid inventing
selectors without inspection evidence; if a selector here cannot be
confirmed live, §59 says stop and report BLOCKED rather than guessing.

Evidence levels follow SPEC §11:

- **OBSERVED** — directly seen in a live fetch of the runtime or in the
  authoritative `microsoft/vscode` source on the date noted.
- **INFERRED** — follows a stable, observed convention but has not yet been
  confirmed interactively on a live session.
- **VALIDATED** — an operation produced the expected observable state
  transition on a real device/session. *(Nothing is VALIDATED until the
  manual matrix in `docs/verification.md` is run; entries are promoted then.)*

Collection date: **2026-09-15** (UTC). Sources: live fetch of `github.dev`
(via this environment's page fetcher) and
`raw.githubusercontent.com/microsoft/vscode@main`.

---

## 1. Runtime routing

| # | Evidence | Level |
|---|----------|-------|
| R1 | Fetching `https://github.dev/microsoft/vscode` resolves to `https://vscode.dev/github/microsoft/vscode`. Page title: *“vscode - Visual Studio Code - github”*. **`github.dev` is currently served by the `vscode.dev` runtime.** | OBSERVED |
| R2 | The rendered page exposes the VS Code welcome/quick-access overlay with the strings: *“Show All Commands Ctrl+Shift+P”*, *“Go to File Ctrl+P”*, *“Open Settings Ctrl+,”*, and *“Drag a view here to display.”* — confirming command palette, quick-open and settings keybindings exist. | OBSERVED |

**Implication:** host detection (SPEC §7) accepts `github.dev`,
`*.github.dev`, and `vscode.dev/github/*` (following the redirect); anything
else is `UNSUPPORTED_TARGET` and receives no DOM mutation.

## 2. Workbench root & state classes

From `src/vs/workbench/browser/media/style.css` (OBSERVED):

| # | Evidence | Level |
|---|----------|-------|
| W1 | Root element carries class `.monaco-workbench`. | OBSERVED |
| W2 | Platform/mode modifiers: `.mac`, `.windows`, `.linux`, `.web`, `.border`, `.fullscreen`, `.hc-black`, `.hc-light`, `.no-shadows`, `.activitybar-right`, `.modal-dialog-visible`, `.file-icons-enabled`, `.underline-links`. | OBSERVED |
| W3 | Visibility-state class **`.nosidebar`** appears in live selectors (`.monaco-workbench.no-shadows.nosidebar .part.activitybar`). | OBSERVED |
| W4 | **`.monaco-workbench.web { touch-action: none; overscroll-behavior: none; }`** — the web workbench handles touch itself. v0.1 ships **no gesture layer** (`FEATURES.gestures = false`, SPEC §2/§36/§54); the mobile shell only places controls outside the editor and never intercepts editor pointers (§30). | OBSERVED + design consequence |
| W5 | Sibling state classes `nopanel`, `noauxiliarybar`, `nostatusbar`, `notitlebar`. | INFERRED (same convention as W3) |

## 3. Parts (layout regions)

| # | Evidence | Level |
|---|----------|-------|
| P1 | `.part.titlebar`, `.part.activitybar`, `.part.editor` appear directly in `style.css` (e.g. `.part.editor .tabs-container > .tab.active`). | OBSERVED |
| P2 | `.part.sidebar`, `.part.panel`, `.part.statusbar`, `.part.auxiliarybar`. | INFERRED — same `.part.<name>` convention as P1 |
| P3 | Parts derive from `Part extends Component` (`part.ts`); `PartLayout.TITLE_HEIGHT = 35`, `HEADER_HEIGHT = 35`. Each part has a container plus title/content areas. | OBSERVED |
| P4 | Editor tabs: `.part.editor .tabs-container > .tab`, `.tab.active`, `.tab:hover`. | OBSERVED |

## 4. Activity bar & view containers

From `activitybarPart.ts` + `style.css` (OBSERVED):

| # | Evidence | Level |
|---|----------|-------|
| A1 | `ActivitybarPart` renders `.action-item` / `.action-label` controls inside `.part.activitybar`; action-bar classes `.monaco-action-bar`, `.action-item.active .action-label`. | OBSERVED |
| A2 | Constants: `ACTIVITYBAR_WIDTH = 48`, `COMPACT_ACTIVITYBAR_WIDTH = 36`, `ACTION_HEIGHT = 48`. | OBSERVED |
| A3 | Pinned view containers persist under storage key `workbench.activity.pinnedViewlets2`; `ToggleSidebarVisibilityAction` exists. | OBSERVED |
| A4 | View-container action ids `workbench.view.explorer`, `workbench.view.search`, `workbench.view.scm`. | INFERRED (stable long-lived ids; live confirmation pending) |
| A5 | Accessible names / `aria-label` on `.action-label` elements begin with “Explorer”, “Search”, “Source Control”. | INFERRED (ARIA fallback path in adapter) |

## 5. Editor (Monaco)

| # | Evidence | Level |
|---|----------|-------|
| E1 | Editor surface is `.monaco-editor`; Monaco exposes `textarea.inputarea` as its hidden keyboard input and `data-uri`/`data-mode-id` attributes on editor nodes. | INFERRED (standard Monaco widget DOM; live confirmation pending) |
| E2 | Breadcrumbs `.monaco-breadcrumbs` / `.monaco-breadcrumb-item`; minimap `.monaco-editor .minimap`. | INFERRED |
| E3 | Monaco is a protected region (SPEC §30). GMUX focuses it only via `textarea.inputarea.focus()`; it never synthesizes clicks, selections, key presses (other than window-level VS Code keybindings), pointer events or clipboard actions inside the editor. | DESIGN CONSTRAINT (§29/§30) |

## 6. Surfaces: Search / SCM / Terminal

| # | Evidence | Level |
|---|----------|-------|
| S1 | Search content view `.search-view`. | INFERRED |
| S2 | Source Control content view `.scm-view`. | INFERRED |
| S3 | Explorer content views `.explorer-folders-view` / `.explorer-view`. | INFERRED |
| T1 | Terminal renders via xterm.js → `.xterm`; panel container `.part.panel .terminal-outer-container`. | INFERRED |
| T2 | `github.dev` / `vscode.dev` (no remote tunnel) are not known to ship an integrated terminal → observation reports NOT_DETECTED, the host expectation is `likely-unsupported`, and `FEATURES.terminalSurface = false` keeps the control disabled (SPEC §17/§46). | INFERRED (host heuristic; live confirmation pending) |

## 7. Quick input & input plumbing

| # | Evidence | Level |
|---|----------|-------|
| Q1 | Command palette / quick-open render in `.quick-input-widget`. | INFERRED |
| Q2 | Input widgets: `.monaco-inputbox` (+ `.info/.warning/.error`), `select` + `.select-container`. | OBSERVED (`style.css`) |
| Q3 | VS Code Web dispatches commands from window-level keyboard events (`StandardKeyboardEvent`, `KeyCode` imported by the activity-bar part) — synthetic `KeyboardEvent`s are a viable *secondary* actuation path; every keybinding result stays INFERRED until the state transition is observed (SPEC §10/§13). | INFERRED |

---

## Selector preference compliance

The adapter resolves each target in this order and stops at the first match:

1. **Semantic attributes** — e.g. `.monaco-editor[data-uri]` for the active file.
2. **ARIA / accessible names** — `.action-label` with `aria-label`/`title` prefixes.
3. **Stable IDs** — `[id="workbench.view.explorer"]` and friends.
4. **Stable relationships** — `.part.sidebar` content probes (`.search-view`…).
5. **Stable class names** — `.part.*`, `.monaco-*`, `.xterm`.

No generated/hashed class names are used. All GitHub/VS Code-specific
selectors live in **§D GITHUB-DEV ADAPTER** of `github-dev-mobile.user.js`.
The kernel contains none (invariants I-02/I-03, SPEC §15).

## Known gaps (honest)

- No interactive session on a physical Android device has been run from this
  environment, so **no capability or operation is VALIDATED yet**. Run
  `docs/verification.md` and update `VERIFICATION_REPORT.md` to promote gates.
- `.part.sidebar/.panel/.statusbar`, view-container ids, and the synthetic
  keybinding path are INFERRED and are the first things to confirm live;
  the adapter returns structured failures (`EXPLORER_NOT_DETECTED`, …) and
  degrades per §46/§47 if any differ — it never substitutes an invented
  implementation (§59).
