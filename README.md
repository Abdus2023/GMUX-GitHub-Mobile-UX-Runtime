# GitHub.dev Mobile UX — GMUX v0.1.0

A single-file, dependency-free userscript that adds a **mobile interaction/presentation
layer** to `https://github.dev/*` without replacing or duplicating the host application.

```
HOST IS SOURCE OF TRUTH → OBSERVE → ADAPT → PRESENT → VERIFY
```

GMUX owns presentation and interaction orchestration. GitHub/VS Code owns repository
state, files, editor state, Git state, terminal state, search and workspace state. GMUX
keeps no parallel copy of any of them.

The runtime is successful when it can say **"I don't know."** instead of guessing: a
surface it cannot verify is reported `BLOCKED` with a reason, never presented as working.

> **Status: `PARTIALLY_VERIFIED`.** Kernel, lifecycle, singletons, preference tolerance,
> privacy boundary, mutation safety and the zero-network contract pass in automation.
> Live github.dev actuation and Android behaviour are **untested and deliberately not
> claimed**. Do not call this build stable or production-ready.

## Artifacts

| Path | Role |
|---|---|
| [`github-dev-mobile.user.js`](github-dev-mobile.user.js) | **primary artifact** — the runtime (one file, zero build, zero dependencies) |
| [`gmux-recon.user.js`](gmux-recon.user.js) | **Phase B instrument** — read-only DOM reconnaissance; its output is the evidence source for adapter revision 1 |
| [`SPEC.md`](SPEC.md) | the broader project contract (**superseded for v0.1** by the Instructions Pack — see below) |
| [`docs/pack-compliance.md`](docs/pack-compliance.md) | **§-by-§ compliance audit** of the frozen pack + the deviation record |
| [`docs/recon-guide.md`](docs/recon-guide.md) | how to run live reconnaissance and promote evidence (§42–§50) |
| [`docs/dom-evidence.md`](docs/dom-evidence.md) | prior host-structure observations — **candidate inputs for review, not runtime knowledge** |
| [`docs/verification.md`](docs/verification.md) | manual live-host test matrix |
| [`fixtures/github-dev/*.json`](fixtures/github-dev/) | 6 `gmux.fixture/v1` expectation records (§53) |
| [`fixtures/*.html`](fixtures/) | 7 minimal scriptless workbench pages used as **recon** recognition inputs |
| [`diagnostics/gate-evidence.json`](diagnostics/gate-evidence.json) | machine-readable G0–G10 gate evidence |
| [`evidence/*.json`](evidence/) | adapter status, recon payload, mutation results, fixture index |
| [`tests/`](tests/) | 635 automated checks across 3 dependency-free Node suites |

## v0.1 scope

**Included:** metadata contract · environment observation · viewport classification ·
keyboard heuristic (labelled) · state + reducer + dispatcher + scheduler · host adapter
contract · capability derivation · action engine with snapshot/verify/restore · bounded
stabilization · idempotent reconciliation · exactly-one shell + style + observer ·
bottom command bar · compact header · Explorer drawer window · diagnostics surface ·
preferences · kill switch · Back command · diagnostics with claim-kind labels.

**Deliberately absent:** GitHub/VS Code selectors in the runtime (§12/§13) · Monaco
integration (§31) · terminal automation (§64) · gestures (§41) · Git/terminal/indexing/AI
implementation (§3) · any network access · any dependency.

## Metadata (frozen by §4)

```js
// ==UserScript==
// @name         GitHub.dev Mobile UX
// @namespace    github-dev-mobile
// @version      0.1.0
// @description  Mobile interaction layer for github.dev
// @match        https://github.dev/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
```

No permissions are added. See *Open items* below for the `github.dev → vscode.dev`
routing observation, which is the one thing that could make this `@match` a no-op.

## Install

1. Install Tampermonkey or Violentmonkey (on Android, e.g. Firefox + Tampermonkey).
2. Open `github-dev-mobile.user.js` raw and let the manager install it.
3. Open `https://github.dev/<owner>/<repo>` on a narrow viewport.

Classification is **observational** — never user-agent, "Android" detection or browser
brand (§7): `< 600px` → `mobile` · `600–1023px` → `compact` · `≥ 1024px` → `desktop`
(shell hidden, host untouched).

## Nothing visible?

That is usually **correct behaviour**, not a failure: at desktop widths GMUX mounts and
then hides itself, because §27 forbids restyling desktop github.dev. Check these three
causes in order — from the page console, since GMUX deliberately creates no visible
affordance when it is not presenting:

| Console check | Reading |
|---|---|
| `!!window.GMUX` → `false` | The script never ran. A desktop browser visiting `github.dev/<owner>/<repo>` is **redirected to `vscode.dev/github/…`**, and userscript managers match the final URL — so the frozen `@match https://github.dev/*` (§4) never fires. See [Known risks & open items](#known-risks--open-items). |
| `!!window.GMUX` → `true`, then `GMUX.inspect().state.disabled` → `true` | Kill switch is engaged (`?gmux=off`, or `disabled: true` in preferences). Nothing is mounted, by design (§38). |
| `GMUX.inspect().state.mode` → `"desktop"` | **Expected on a wide window.** Presentation only; observation and the adapter keep running, which is why `GMUX.inspect()` still returns a full report. |

To see the shell on a wide window: narrow the window below 1024px (`compact`) or 600px
(`mobile`), use DevTools device emulation, or use the frozen §37 `mode` override, which
exists precisely for this:

```js
localStorage.setItem('github-dev-mobile:v1', JSON.stringify({ version: 1, mode: 'mobile' }));
location.reload();   // preferences are read once, at boot
```

The override changes **presentation only**. At adapter revision 0 everything is still
`BLOCKED`, so the four commands render disabled with their reason attached — visible
controls are not working features (§15). Verified in `dom-smoke` §8b: the override reveals
the root at 1440px, reports `configuration-override` as its basis, pins capability state
unchanged, and mutates no host node.

## Use

| Control | Behaviour |
|---|---|
| Bottom bar: **Files / Search / Git / Terminal** | dispatches a surface *intent* through the action engine. With adapter revision 0 all four are `BLOCKED`, rendered disabled **with the reason attached** — never as if they worked (§26) |
| Header `☰` | opens the GMUX-owned diagnostics panel (the evidence report) |
| Header `⛶` | immersive toggle (GMUX's own chrome only — hiding host chrome needs a verified mapping) |
| Header `‹` Back | runs the §39 priority: diagnostics → drawer → secondary surface → otherwise leave the browser alone |
| `Escape` | same priority as Back; GMUX never calls `preventDefault`, so the key is never trapped |

**Nothing else is wired.** There is no file tree, editor model, terminal or Git UI in
GMUX by design: those stay host-owned.

## Diagnostics

```js
GMUX.version      // "0.1.0"
GMUX.inspect()    // structured evidence + a human-readable report in the console
```

`inspect()` reports the §58 fields — GMUX version, adapter id/revision, hostname,
viewport, orientation, pointer type, touch points, mode, keyboard heuristic, capabilities,
shell/style/observer status, reconciliation + observation counts, mutation volume, last
error, kill-switch status, host fingerprint — and labels **every** line with its claim
kind:

```
viewport                       412x915      OBSERVED
pointer type                   coarse       OBSERVED
mode                           mobile       DERIVED    (viewport-classification)
keyboard                       not indicated HEURISTIC  (visualViewport shrink > 150px; not definitive)
adapter revision               0            OBSERVED   (intentionally incomplete (§12))
observer installed             true         PROVISIONAL (scope not narrowed yet (§35))
explorer                       not detected UNKNOWN · operation BLOCKED
```

`GMUX.state`, `GMUX.adapter`, `GMUX.shell`, `GMUX.observer` and `GMUX.viewportObserver`
are the only other members of the namespace (§5). Test internals are exported to Node
via `module.exports` and never into the page.

## Preferences (§37)

Single storage key: `github-dev-mobile:v1`. Loaded defensively — absent, unreadable,
corrupt or partially invalid values fall back to defaults and are reported in
`GMUX.inspect()`, and can never prevent github.dev from loading. Preferences are
**configuration, never host truth**.

| Field | Default | Meaning |
|---|---|---|
| `mode` | `"auto"` | `"auto"` classifies from the viewport; `mobile/compact/desktop` forces presentation (reported as `configuration-override`) |
| `immersive` | `true` | GMUX's own chrome only — hiding host chrome needs a verified mapping |
| `preferredSurface` | `"editor"` | `diagnostics` opens immediately (GMUX owns it); a host surface goes through the engine and may only commit on verified evidence — otherwise it reports `BLOCKED` |
| `bottomBar` | `true` | show/hide the GMUX command bar |
| `disabled` | `false` | kill switch (§38) |

## Kill switch (§38)

Either mechanism, checked **before** any observer or DOM work — when disabled there is no
shell, no observer, no host interaction and no presentation mutation:

* `?gmux=off` on the URL, or
* `{"disabled": true}` inside `localStorage["github-dev-mobile:v1"]`.

The shell's `DISABLE` action sets the preference, so it survives reload. `?gmux=on` is a
recovery escape hatch that overrides a stored `disabled` for one session; `?gmux=off`
always wins.

## Verification

```bash
node tests/run-tests.mjs       # 239 checks — pure kernel contracts (§4–§22, §58, static scans)
node tests/dom-smoke.mjs        # 141 checks — lifecycle, singletons, kill switch, host untouched (§23–§28, §38)
node tests/recon-fixtures.mjs   # 255 checks — recon privacy/schema/mutation + transaction + golden state (§42–§55)
node tests/gates.mjs            # writes diagnostics/gate-evidence.json (G0–G10, §60)
node tests/gen-evidence.mjs     # regenerates evidence/*.json
```

Everything runs on plain Node ≥ 18 with zero dependencies. DOM behaviour is exercised
against a miniature DOM (`tests/lib/mini-dom.mjs`), which is a **harness, not a
browser**: any gate whose claim needs a real browser or device is recorded
`PARTIALLY_VERIFIED` or `UNTESTED` rather than `PASS` (§60/§68). Current result:
**G0–G7, G9, G10 PASS · G8 PARTIALLY_VERIFIED**.

## Phase gates

| Gate | State |
|---|---|
| **A — Runtime baseline (G0–G10)** | 10/11 PASS; G8 needs a browser usability pass |
| **B — Recon** | instrument shipped; **never run on a live host** → adapter revision stays 0 |
| **C — Adapter** | not started; blocked on B + human review (§50) |
| **D — Mobile interaction surfaces** | shell + command bar shipped but gated on verification (§26) |
| **E — Android** | keyboard heuristic + Back command only; no gestures yet |
| **F — Final verification** | not reached — see `toReachVerified` in the gate evidence |

## Known risks & open items

* **Host routing (highest impact).** `github.dev` was observed (2026-09-15, via this
  workspace's page fetcher, which follows redirects) to resolve to `vscode.dev/github/*`,
  and `github.dev/` to `vscode.dev/`. Userscript managers match the *final* document URL,
  so if a browser follows the same redirect this build never runs. §4 freezes `@match` to
  `https://github.dev/*`, so the baseline complies and flags the risk instead of silently
  widening the host scope. If a live browser check confirms the redirect, the fix is one
  line — `// @match https://vscode.dev/github/*` — and it must be a **spec amendment**,
  not an implementation guess.
* **Keyboard detection** is a heuristic (§8): a 150 px visual-viewport shrink, not
  definitive keyboard detection. Some browsers may not shrink `visualViewport`.
* **Android hardware Back** is not intercepted: the only mechanism requires history
  entries, which §40 forbids. Escape and the in-shell control carry the same command.
* **Observer scope** is intentionally broad (`document.body`, attributes included) and
  labelled `PROVISIONAL`; narrowing needs mutation-volume data from a real session (§35).
* **Userscript-manager behaviour** on Android varies; `@grant none` is the tested-at-metadata target.
* **Performance numbers are not verified.** §67 targets are engineering targets; only
  labelled harness estimates exist so far, and the pack requires real measurement before
  anything is called `VERIFIED`.

## License

[MIT](LICENSE).
