# DOM Evidence Log — `github.dev` / VS Code for the Web

This file is the observation record required by SPEC.md §51 ("Inspect the
current `github.dev` runtime before writing selectors. Record observed DOM
evidence."). Adapter selectors are only justified by entries here.

Evidence levels follow SPEC.md §34:

- **OBSERVED** — directly seen in a live fetch of the runtime or in the
  authoritative `microsoft/vscode` source on the date noted.
- **INFERRED** — follows a stable, observed convention but has not yet been
  confirmed interactively on a live session.
- **VALIDATED** — a command produced the expected observable state on a real
  device/session. *(Nothing is VALIDATED until the manual matrix in
  `verification.md` is run; entries will be promoted then.)*

Collection date: **2026-09-15** (UTC). Sources: live fetch of `github.dev`
(via this environment's page fetcher) and `raw.githubusercontent.com/microsoft/vscode@main`.

---

## 1. Runtime routing

| # | Evidence | Level |
|---|----------|-------|
| R1 | Fetching `https://github.dev/microsoft/vscode` resolves to `https://vscode.dev/github/microsoft/vscode`. Page title: *"vscode - Visual Studio Code - github"*. **`github.dev` is currently served by the `vscode.dev` runtime.** | OBSERVED |
| R2 | The rendered page exposes the VS Code welcome/quick-access overlay with the strings: *"Show All Commands Ctrl+Shift+P"*, *"Go to File Ctrl+P"*, *"Open Settings Ctrl+,",* and *"Drag a view here to display."* — confirming the command palette, quick-open, and settings keybindings exist in this runtime. | OBSERVED |

**Implication:** the userscript `@match` list includes both `github.dev/*`
(and subdomains) and `vscode.dev/github/*` so it follows the redirect.

## 2. Workbench root & state classes

From `src/vs/workbench/browser/media/style.css` (OBSERVED):

| # | Evidence | Level |
|---|----------|-------|
| W1 | Root element carries class `.monaco-workbench`. | OBSERVED |
| W2 | Platform/mode modifiers: `.mac`, `.windows`, `.linux`, `.web`, `.border`, `.fullscreen`, `.hc-black`, `.hc-light`, `.no-shadows`, `.activitybar-right`, `.modal-dialog-visible`, `.file-icons-enabled`, `.underline-links`. | OBSERVED |
| W3 | Visibility-state class **`.nosidebar`** appears in live selectors (`.monaco-workbench.no-shadows.nosidebar .part.activitybar`). | OBSERVED |
| W4 | **`.monaco-workbench.web { touch-action: none; overscroll-behavior: none; }`** — the web workbench disables browser pan/zoom and handles touch itself. GMUX gestures therefore must use pointer events on *controlled shell zones only* and must never rely on native scroll over the workbench. | OBSERVED |
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
| A4 | View-container action ids `workbench.view.explorer`, `workbench.view.search`, `workbench.view.scm`. | INFERRED (stable, long-lived action ids; confirmed on live session pending) |
| A5 | Accessible names / `aria-label` on `.action-label` elements begin with "Explorer", "Search", "Source Control". | INFERRED (ARIA fallback path in adapter) |

## 5. Editor (Monaco)

| # | Evidence | Level |
|---|----------|-------|
| E1 | Editor surface is `.monaco-editor`; Monaco exposes `textarea.inputarea` as its hidden keyboard input and `data-uri`/`data-mode-id` attributes on editor nodes. | INFERRED (standard Monaco widget DOM; live confirmation pending) |
| E2 | Breadcrumbs `.monaco-breadcrumbs` / `.monaco-breadcrumb-item`; minimap `.monaco-editor .minimap`. | INFERRED |
| E3 | Monaco is a protected region (SPEC §22). GMUX focuses it via `textarea.inputarea.focus()` only and never synthesizes clicks/selection inside it. | DESIGN CONSTRAINT |

## 6. Surfaces: Search / SCM / Terminal

| # | Evidence | Level |
|---|----------|-------|
| S1 | Search content view `.search-view`. | INFERRED |
| S2 | Source Control content view `.scm-view`. | INFERRED |
| S3 | Explorer content views `.explorer-folders-view` / `.explorer-view`. | INFERRED |
| T1 | Terminal renders via xterm.js → `.xterm`; panel container `.part.panel .terminal-outer-container`. | INFERRED |
| T2 | `github.dev` / `vscode.dev` (no remote tunnel) do **not** ship an integrated terminal → capability should report `UNSUPPORTED` there. | INFERRED (host heuristic; the toolbar must not advertise a terminal it cannot open — SPEC §20) |

## 7. Quick input & input plumbing

| # | Evidence | Level |
|---|----------|-------|
| Q1 | Command palette / quick-open render in `.quick-input-widget`. | INFERRED |
| Q2 | Input widgets: `.monaco-inputbox` (+ `.info/.warning/.error`), `select` + `.select-container`. | OBSERVED (style.css) |
| Q3 | VS Code Web dispatches commands from window-level keyboard events (`StandardKeyboardEvent`, `KeyCode` imported by the activity-bar part) — so synthetic `KeyboardEvent`s are a viable *secondary* actuation path. | INFERRED (mechanism exists; per-binding validation pending) |

---

## Selector preference compliance (SPEC §9)

The adapter resolves each target in this order and stops at the first match:

1. **Semantic attributes** — e.g. `.monaco-editor[data-uri]` for the active file.
2. **ARIA / accessible names** — `.action-label[aria-label^="Explorer"]` etc.
3. **Stable IDs** — `[id="workbench.view.explorer"]`.
4. **Stable relationships** — `.part.sidebar` content probes (`.search-view`…).
5. **Stable class names** — `.part.*`, `.monaco-*`, `.xterm`.

No generated/hashed class names are used. All GitHub/VS Code-specific
selectors live in `§D GITHUB-DEV ADAPTER` of `github-dev-mobile.user.js`.

## Known gaps (honest)

- No interactive session on a physical Android device has been run from this
  environment, so **no capability is claimed VALIDATED yet**. Run
  `docs/verification.md` to promote entries.
- `.part.sidebar/.panel/.statusbar`, view-container ids, and the synthetic
  keybinding path are INFERRED and are the first things to confirm live; the
  adapter degrades gracefully (reports `NOT_DETECTED`/`COMMAND_FAILED`) if any
  differ.
