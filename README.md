# GMUX — GitHub.dev Mobile UX Runtime

A **dependency-free, mobile-first, observation-driven userscript** that turns
the desktop-oriented [`github.dev`](https://github.dev) (VS Code for the Web)
interface into an adaptive mobile development workspace.

> **Observe first. Adapt second. Mutate third. Validate fourth.**
> The userscript owns mobile interaction; GitHub owns application and
> repository state.

- **Version:** 0.1.0 — normative spec: [`SPEC.md`](SPEC.md)
- **Artifact:** [`github-dev-mobile.user.js`](github-dev-mobile.user.js)
  (single file, no build step, no dependencies)
- **Target:** `github.dev` (which currently redirects to
  `vscode.dev/github/{owner}/{repo}`), primary device class: Android phones
- **Evidence log:** [`docs/dom-evidence.md`](docs/dom-evidence.md) ·
  **Verification:** [`docs/verification.md`](docs/verification.md)

---

## What it is

An **interaction/presentation adapter** layered over the existing application:

```
github.dev  →  Observation Layer  →  Capability Detection  →  Adapter Contract
   →  Mobile UX Kernel (state · commands · lifecycle · scheduling · diagnostics)
   →  Mobile Shell  →  Existing GitHub / VS Code UI (untouched authority)
```

- One primary surface at a time on phones: **Editor · Files · Search · Git ·
  Terminal · Settings**, switched from a bottom toolbar, edge gestures, or
  keyboard.
- Reuses the *existing* Explorer tree, Search view, Source Control view and
  terminal — it repositions them, it never clones repository state.
- Tracks `window.visualViewport` so the shell survives the Android virtual
  keyboard; keyboard visibility is always reported as `INFERRED`, never faked.
- Reconciliation-driven: a classified, coalesced `MutationObserver` schedules
  at most one reconcile per animation frame. **No polling loops.**
- Reversible: Alt+Shift+G (or ☰ → Disable) tears the shell down without a
  page reload and leaves the GitHub application intact.

## What it is not (explicit non-goals)

Not a Git client (no commit/push/pull/branch/merge logic), not a repository
synchronizer, not a second editor or terminal, not a frontend framework, not
a telemetry source. It performs **zero network requests** and stores only UI
preferences in `localStorage` (versioned schema, corruption-tolerant).

## Install

1. Install a userscript manager (Tampermonkey, Violentmonkey, or a
   Greasemonkey-compatible manager; on Android, e.g. Firefox + Tampermonkey).
2. Open [`github-dev-mobile.user.js`](github-dev-mobile.user.js) and let the
   manager install it (matches `github.dev/*`, `*.github.dev/*` and
   `vscode.dev/github/*`).
3. Open any repository on `https://github.dev/…` on a narrow viewport.

## Use

| Input | Behavior |
|---|---|
| Bottom toolbar | Files 📁 · Search 🔍 · Git ⎇ · Terminal ▣ · More ⚙ (icons always carry accessible names) |
| Header | ☰ GMUX menu · current file (tap = focus editor) · ⋮ editor actions |
| Edge swipes | left edge →→ Files · right edge ←← close surface · bottom edge ↑ Terminal · top edge ↓ close surface (never over the editor; insufficient confidence = no action) |
| Escape | closes dialogs, then closes the active surface |
| Alt+Shift+G | disable / re-enable the shell (works even after disable) |
| ☰ → Diagnostics | capabilities, viewport/keyboard evidence, feature statuses, failure log, copyable report |

The Terminal button is **disabled unless a terminal is actually detected** —
on `github.dev`/`vscode.dev` the host does not provide one, and GMUX reports
`UNSUPPORTED` instead of advertising a broken button.

## Verification status (evidence-based, spec §35)

Per SPEC §36, *no evidence → no verified claim*. Kernel logic is covered by
automated suites; live-runtime behavior awaits the manual matrix in
[`docs/verification.md`](docs/verification.md) and is deliberately **not**
claimed verified yet.

| Feature | Status | Basis |
|---|---|---|
| Kernel units (modes, transitions, prefs, scheduler, commands, capabilities, gestures, planner) | VERIFIED | 77 unit checks, `node tests/run-tests.mjs` |
| Bootstrap / lifecycle / disable-recovery | VERIFIED | 17 smoke checks, `node tests/dom-smoke.mjs` |
| Mobile viewport detection | PARTIALLY_VERIFIED | visualViewport logic unit-tested; device confirmation pending |
| Editor immersive mode | PARTIALLY_VERIFIED | minimap hiding layout-safe by construction; live confirmation pending |
| Explorer drawer / Search / Source Control surfaces | PARTIALLY_VERIFIED | reposition-only design; live confirmation pending |
| Terminal surface | BLOCKED on github.dev | host does not ship a terminal (inference, honestly reported) |
| Gesture navigation | PROVISIONAL | conservative edge swipes; device confirmation pending |
| Git operations | OUT_OF_SCOPE | GitHub/VS Code remains authoritative |
| Unknown future GitHub DOM | BLOCKED | no claims beyond observed evidence |

## Develop

```bash
node tests/run-tests.mjs   # kernel unit suite
node tests/dom-smoke.mjs   # boot/lifecycle smoke suite (fake DOM)
```

No package manager, no build, no network. The userscript also exports its pure
kernel for Node (`module.exports` guard) — in the browser nothing extra is
exposed beyond the documented `window.__GDMUX__` dev hook
(`enable() / disable() / diagnostics() / state()`).

### Repository layout

```
github-dev-mobile.user.js   the release artifact (single file)
SPEC.md                     normative specification (Prompt Instructions Pack)
tests/run-tests.mjs         dependency-free kernel unit suite
tests/dom-smoke.mjs         dependency-free boot/lifecycle smoke suite
docs/dom-evidence.md        OBSERVED/INFERRED/VALIDATED selector evidence log
docs/verification.md        live test matrix, regressions, release gates
```

### Inside the single file

`§A` identity/versions · `§B` vocabulary & failure codes · `§C` pure kernel
(no DOM, no GitHub selectors — unit-tested) · `§D` **github-dev adapter**
(*all* GitHub/VS Code DOM knowledge) · `§E` namespaced adapter stylesheet
(`.gdmux-*`, controlled z-ladder 900–950) · `§F–§J` shell, viewport, input,
reconciler, lifecycle · `§K` bootstrap/teardown/exports.

## Security & privacy

No credentials, cookies, tokens or repository content are ever read, stored or
transmitted. There is no network access of any kind. Preferences are the only
persisted data (`gdmux:prefs:v1`), plus a disable flag (`gdmux:disabled`).

## License

[MIT](LICENSE)
