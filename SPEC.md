# GitHub.dev Mobile UX

## v0.1 Concrete Implementation Contract

**Project:** GitHub.dev Mobile UX
**Artifact:** `github-dev-mobile.user.js`
**Version:** `0.1.0`
**Status:** Normative
**Runtime:** Browser userscript
**Primary target:** Android mobile browser
**Host:** `github.dev`
**Dependencies:** Zero
**Network requests by userscript:** Zero

> ## Superseded for v0.1 by the Instructions Pack
>
> This document remains the broader project contract, but the **v0.1 boundary is frozen by
> the *Prompt Instructions Pack v0.1* (74 sections)**. Where the two disagree, the pack
> wins for `0.1.0`, and the deltas are recorded with their reasoning in
> [`docs/pack-compliance.md`](docs/pack-compliance.md). The four conflict classes are:
>
> | Topic | This SPEC said | Pack v0.1 requires |
> |---|---|---|
> | Host scope (§7) | match `github.dev`, `*.github.dev`, `vscode.dev/github/*` | exactly one `@match https://github.dev/*`, `@namespace github-dev-mobile`, no extra directives (§4) |
> | Host selectors in the runtime (§9/§58) | adapter carries a selector registry with provenance | **no** guessed GitHub/VS Code selectors in the runtime; adapter intentionally incomplete, all `BLOCKED` (§12/§13/§72); structure is acquired by the separate Recon instrument (§42) |
> | State vocabulary (§18–§23) | lifecycle/nav/capability state, `OPEN_SURFACE`-style actions, `DETECTED/NOT_DETECTED`, numeric confidence | the frozen `initialState` key set, the twelve §10 action names, categorical `UNKNOWN/LOW/MEDIUM/HIGH` confidence, four result statuses (§9/§10/§14/§19) |
> | Back + history (§35/§36) | `pushState`-layered Back so hardware Back closes GMUX UI | never create browser history entries for GMUX surfaces; Back is an application command with the §39 priority and is never trapped (§39/§40) |
>
> Feature flags (`FEATURES`), `GMUX.getState()/getCapabilities()/reconcile()/disable()`,
> the `Alt+Shift+G` toggle and the `.gmux-revive` chip are likewise out of v0.1: the pack
> fixes the namespace to six members plus `inspect()` (§5) and requires that a disabled
> runtime mount **nothing at all** (§38).

# 1. Contract Objective

Implement a small, dependency-free mobile interaction layer above the existing `github.dev` / VS Code Web application.

v0.1 SHALL prove these assumptions before expanding scope:

1. `github.dev` can be reliably detected.
2. The relevant UI surfaces can be observed without assuming their existence.
3. GitHub-specific DOM knowledge can be isolated inside one adapter.
4. The kernel can operate without GitHub-specific selectors.
5. Reconciliation is idempotent.
6. The userscript can mount exactly one mobile shell.
7. The shell can invoke existing GitHub/VS Code functionality.
8. Editor interaction remains intact.
9. Mobile viewport classification works.
10. Preferences can be persisted safely.
11. Diagnostics can expose unsupported or failed capabilities.

Everything else is secondary.

# 2. v0.1 Scope

## Included

```
Bootstrap
GitHub.dev detection
Viewport classification
Capability detection
Adapter contract
Kernel state
Command dispatch
Reconciliation
Mobile shell
Bottom command bar
Editor immersive presentation
Explorer drawer
Search surface
Git/source-control surface
Android Back
Preferences
Diagnostics
```

## Explicitly deferred

```
Terminal optimization
Gesture navigation
Advanced keyboard shortcuts
Performance instrumentation
Complex animations
Repository automation
Git implementation
Remote services
Cloud synchronization
```

Deferred features MUST NOT be implemented merely because they appear convenient.

# 3. Four-Layer Architecture

```
┌─────────────────────────────┐
│ github.dev                  │
│ Existing VS Code Web        │
└──────────────┬──────────────┘
               │  observe
               ▼
┌─────────────────────────────┐
│ Adapter                     │
│ GitHub-specific knowledge   │
└──────────────┬──────────────┘
               │  normalized evidence
               ▼
┌─────────────────────────────┐
│ Kernel                      │
│ state / commands / lifecycle│
│ reconciliation              │
└──────────────┬──────────────┘
               │  intent
               ▼
┌─────────────────────────────┐
│ Mobile Shell                │
│ toolbar / drawer / surfaces │
└──────────────┬──────────────┘
               ▼
        Existing UI
```

The dependency direction is:

```
Mobile Shell
      ↓
Kernel
      ↓
Adapter
      ↓
github.dev
```

The adapter MUST NOT depend on the shell.

The kernel MUST NOT depend on GitHub selectors.

# 4. Ownership Contract

## Userscript owns

```
shell state
mobile mode
active surface presentation state
mobile controls
mobile preferences
diagnostics
command routing
```

## GitHub / VS Code owns

```
repository state
Git state
editor model
file contents
terminal state
authentication
authorization
Git operations
application state
```

This boundary is mandatory.

# 5. Authority Rule

There SHALL be exactly one application authority:

```
GitHub / VS Code Web
```

The userscript MUST NOT create an alternative authority for:

```
files
branches
commits
Git status
repository contents
editor buffers
credentials
```

The userscript observes and controls presentation of the existing application.

# 6. Bootstrap Contract

The script MUST execute only when the current page is compatible with the target.

Conceptually:

```
bootstrap()
```

MUST:

1. verify host;
2. create kernel state;
3. initialize diagnostics;
4. initialize adapter;
5. wait for the application;
6. detect capabilities;
7. classify viewport;
8. mount shell;
9. reconcile.

It MUST be safe to execute more than once.

Therefore:

```
bootstrap()
bootstrap()
bootstrap()
```

MUST NOT create:

```
3 shells
3 observers
3 toolbars
3 command registries
```

# 7. Host Detection

Host detection MUST precede DOM mutation.

The script MUST distinguish:

```
SUPPORTED_TARGET
UNSUPPORTED_TARGET
```

It MUST NOT inject the mobile shell into arbitrary websites.

The host check MUST be independent of visual DOM detection.

# 8. Adapter Interface

The adapter SHALL expose approximately:

```js
const adapter = {
    id: "github-dev",
    detect(),
    observe(),
    capabilities(),
    focusEditor(),
    openExplorer(),
    openSearch(),
    openSourceControl(),
    closePanels()
};
```

Exact implementation MAY differ.

The semantic contract MUST remain.

# 9. Structured Operation Results

Every adapter operation MUST return structured evidence.

Success:

```js
{
    ok: true,
    operation: "open-explorer",
    evidence: {
        elementFound: true,
        stateChanged: true
    }
}
```

Failure:

```js
{
    ok: false,
    operation: "open-terminal",
    reason: "terminal-not-detected",
    evidence: {
        elementFound: false
    }
}
```

Forbidden:

```js
adapter.openTerminal(); // assume success
```

No adapter operation may silently imply success.

# 10. Result Semantics

`ok: true` means the operation's contract was satisfied.

It MUST NOT mean merely:

```
selector returned an element
```

For example:

```
element found
```

is observation.

Whereas:

```
element found + operation invoked + expected state transition observed
```

is validation.

# 11. Evidence Levels

Use three levels:

```
OBSERVED
INFERRED
VALIDATED
```

Example:

```
OBSERVED: Explorer-related element exists.
INFERRED: Element probably represents Explorer.
VALIDATED: Opening Explorer caused the expected surface transition.
```

The implementation MUST preserve these distinctions internally where practical.

# 12. Capability Detection

Minimum capability set:

```js
{
    editor: ...,
    explorer: ...,
    search: ...,
    sourceControl: ...,
    terminal: ...,
    activityBar: ...,
    statusBar: ...,
    commandPalette: ...
}
```

Capability values MUST support uncertainty.

Recommended:

```
DETECTED
NOT_DETECTED
UNKNOWN
```

Do not convert:

```
UNKNOWN
```

into:

```
false
```

without evidence.

# 13. Capability Detection Is Not Operation Validation

These are separate:

```
Capability Detection
        │
        ▼
"Can I see something corresponding to Explorer?"
```

versus:

```
Operation Validation
        │
        ▼
"Did opening Explorer actually produce the expected state?"
```

A detected capability MUST NOT automatically receive `VERIFIED`.

# 14. Observation Contract

`adapter.observe()` MUST return normalized information.

Conceptual:

```js
{
    application: {
        detected: true
    },
    surfaces: {
        editor: ...,
        explorer: ...,
        search: ...,
        sourceControl: ...,
        terminal: ...
    },
    viewport: {
        width: ...,
        height: ...
    },
    route: {
        url: ...
    }
}
```

The kernel MUST consume this normalized structure.

# 15. Kernel Contract

The kernel owns:

```
state
reducer
commands
lifecycle
scheduler
reconciliation
feature flags
diagnostics
```

The kernel MUST NOT contain:

```
GitHub CSS selectors
Monaco internals
GitHub class names
GitHub-specific DOM traversal
```

Those belong to the adapter.

# 16. State

Minimum state:

```js
{
    shellMode: "mobile",
    activeSurface: "editor",
    previousSurface: null,
    immersive: true,
    keyboardVisible: false,
    viewport: {
        width: 0,
        height: 0,
        offsetTop: 0
    },
    capabilities: {},
    diagnostics: {
        reconciliationCount: 0,
        warnings: []
    }
}
```

State MUST be serializable except for runtime-only handles.

# 17. Surface Enumeration

v0.1:

```
EDITOR
EXPLORER
SEARCH
SOURCE_CONTROL
```

Terminal MAY be detected but SHALL remain disabled by default.

Settings MAY exist only as an internal diagnostics/preferences surface.

# 18. Shell Modes

```
DESKTOP
COMPACT
MOBILE
```

Default classification:

```
width > 1024     → DESKTOP
600–1024         → COMPACT
< 600            → MOBILE
```

These are policy defaults.

They MUST be centralized.

No feature may independently redefine what “mobile” means.

# 19. Mobile Shell Contract

The shell MUST have exactly one root:

```html
<div
    id="github-mobile-ux"
    data-gmux-owner="github-dev-mobile">
</div>
```

The root MUST be uniquely identifiable.

Repeated reconciliation MUST reuse it.

# 20. DOM Ownership

Every userscript-created element MUST carry:

```
data-gmux-owner="github-dev-mobile"
```

or an equivalent unique ownership marker.

Preferred namespace:

```
gmux-
```

Examples:

```
gmux-shell
gmux-toolbar
gmux-drawer
gmux-surface
gmux-button
```

Never identify userscript-owned DOM using generic selectors such as:

```
.toolbar
.panel
.button
```

# 21. Shell Invariant

At all times:

```
userscript-owned shell count <= 1
```

If more than one shell is detected:

```
SHELL_DUPLICATION
```

MUST be emitted.

The kernel MUST reconcile toward exactly one shell.

# 22. Shell Presentation

Mobile shell:

```
┌──────────────────────────┐
│ Files  Search  Git  ...  │
└──────────────────────────┘
```

The toolbar is a **command surface**, not an implementation surface.

Buttons MUST dispatch intent.

Example:

```js
dispatch({
    type: "OPEN_SURFACE",
    surface: "explorer"
});
```

Buttons MUST NOT directly contain GitHub DOM manipulation logic.

# 23. Command Pipeline

All interaction MUST follow:

```
User Input
    │
    ▼
Intent
    │
    ▼
Reducer / Command
    │
    ▼
Kernel State
    │
    ▼
Adapter Operation
    │
    ▼
GitHub UI
    │
    ▼
Observation
    │
    ▼
Validation
```

This creates a closed feedback loop.

# 24. Reconciliation Contract

Conceptually:

```js
function reconcile() {
    const observation = adapter.observe();
    const next = reducer(
        state,
        observation
    );
    if (!same(state, next)) {
        state = next;
        shell.render(state);
    }
}
```

The exact implementation MAY differ.

The semantic invariant MUST remain.

# 25. Idempotence Requirement

The following MUST converge:

```
reconcile()
reconcile()
reconcile()
reconcile()
```

Repeated reconciliation MUST NOT produce:

```
duplicate shell
duplicate listeners
duplicate toolbar
duplicate drawer
duplicate observers
```

Formally:

```
R(R(S)) = R(S)
```

for stable observation `S`, modulo explicitly changing external application state.

# 26. MutationObserver

Use `MutationObserver` for dynamic application changes.

Required pattern:

```
DOM mutation
    │
    ▼
mark dirty
    │
    ▼
schedule
    │
    ▼
reconcile
```

Do not perform complete reconciliation synchronously for every mutation.

# 27. No Polling

Steady-state polling is prohibited.

Forbidden:

```js
setInterval(scan, 500);
```

or equivalent whole-DOM polling loops.

If polling is temporarily required during bootstrap, it MUST:

- be bounded;
- terminate after detection or timeout;
- never become the steady-state lifecycle mechanism.

# 28. Reconciliation Scheduling

Multiple events:

```
mutation
resize
route
viewport
```

SHOULD converge into one scheduled reconciliation.

Preferred primitive:

```
requestAnimationFrame
```

The scheduler MUST prevent re-entrant reconciliation.

# 29. Editor Immersive Mode

When mobile mode is active, v0.1 SHOULD hide or minimize:

```
minimap
desktop activity rail
redundant breadcrumbs
excessive padding
secondary chrome
```

The implementation MUST NOT disable core editor interaction.

Required validation:

```
editor remains editable
cursor works
selection works
copy/paste works
scrolling works
keyboard input works
```

# 30. Editor Protection Boundary

The editor region is a protected zone.

The mobile layer MUST NOT hijack:

```
horizontal swipe
vertical scroll
selection
cursor interaction
pointer events
keyboard events
clipboard interaction
```

unless the event is explicitly required by the mobile shell and is outside the editor.

# 31. Explorer Drawer

The Explorer MUST use the existing GitHub/VS Code Explorer when possible.

The mobile layer SHOULD modify:

```
width
position
visibility
z-index
presentation
```

rather than constructing a second repository tree.

Selecting a file SHOULD return the active surface to:

```
EDITOR
```

where validated by the host UI.

# 32. Search Surface

Search MUST reuse the existing search mechanism.

The userscript MAY:

```
open it
resize it
make it full-screen
provide close/navigation controls
```

It MUST NOT implement an independent repository-search backend.

# 33. Source Control Surface

Source Control MUST reuse GitHub/VS Code's existing surface.

The userscript MAY expose:

```
open
close
resize
focus
navigation
```

The userscript MUST NOT implement:

```
commit engine
push engine
pull engine
branch engine
merge engine
```

# 34. Android Back

v0.1 SHOULD implement:

```
Back
 │
 ├── modal open?
 │      └── close modal
 │
 ├── drawer open?
 │      └── close drawer
 │
 ├── secondary surface?
 │      └── return to editor
 │
 └── otherwise
        └── browser history
```

The userscript MUST NOT permanently trap the Back action.

If no userscript-owned state can consume Back:

```
ALLOW_BROWSER_DEFAULT
```

# 35. Navigation Observation

The application behaves as a dynamic web application.

The implementation MUST NOT rely exclusively on:

```
window.onload
```

Relevant navigation MAY be detected through:

```
popstate
history changes
URL observation
MutationObserver
application-state changes
```

Do not monkey-patch `pushState` or `replaceState` unless testing demonstrates that it is necessary.

Prefer the least invasive mechanism.

# 36. Feature Flags

v0.1 SHALL use:

```js
const FEATURES = {
    mobileShell: true,
    immersiveEditor: true,
    explorerDrawer: true,
    searchSurface: true,
    sourceControlSurface: true,
    terminalSurface: false,
    gestures: false,
    androidBack: true,
    diagnostics: true
};
```

Experimental functionality MUST be independently switchable.

# 37. Diagnostics

Diagnostics MUST be available in v0.1.

Minimum information:

```
GitHub.dev Mobile UX
Version: 0.1.0
Adapter: github-dev
Mode: MOBILE
Viewport: 412 × 915
Editor: DETECTED
Explorer: DETECTED
Search: DETECTED
Source Control: DETECTED
Terminal: NOT_DETECTED
Shell: ACTIVE
Observer: ACTIVE
Reconciliations: 42
Warnings:
- terminal capability unavailable
```

Diagnostics MUST never require external network access.

# 38. Diagnostics Are Evidence

Diagnostics MUST report facts about the current observation.

Do not report:

```
Explorer: VERIFIED
```

merely because:

```
Explorer DOM node exists
```

Instead distinguish:

```
DETECTED
OPENED
VALIDATED
```

# 39. Preferences

Persist only mobile UX preferences.

Example:

```js
{
    version: 1,
    mode: "auto",
    immersive: true,
    preferredSurface: "editor",
    bottomBar: true
}
```

Never persist:

```
tokens
credentials
repository contents
editor contents
Git state
```

# 40. Preference Failure

Malformed preferences MUST NOT prevent startup.

Example:

```
invalid storage
      │
      ▼
PREFERENCE_PARSE_FAILED
      │
      ▼
default preferences
      │
      ▼
continue startup
```

The application must degrade gracefully.

# 41. CSS Contract

All userscript CSS MUST be namespaced.

Example:

```css
.gmux-shell {}
.gmux-toolbar {}
.gmux-button {}
.gmux-drawer {}
.gmux-surface {}
```

Avoid global:

```
*
body
button
input
```

rules.

Avoid `!important` unless evidence demonstrates that it is necessary.

If `!important` is required, isolate it to the smallest possible selector.

# 42. CSS Ownership

The userscript SHOULD prefer:

```
mobile shell
    + limited host overrides
```

rather than reconstructing the entire GitHub interface.

Desired architecture:

```
┌────────────────────────┐
│ Userscript shell       │
├────────────────────────┤
│ Existing GitHub UI     │
│                        │
│ Existing VS Code       │
└────────────────────────┘
```

The shell is a control layer over the existing application.

# 43. Performance Targets

Initial engineering targets:

| Metric | Target |
|---|---|
| Bootstrap JS | < 50 ms |
| Normal reconciliation | < 5 ms |
| Mutation callback | < 2 ms |
| Steady-state polling | 0 |
| External dependencies | 0 |
| Userscript network requests | 0 |
| Full-DOM scans in steady state | 0 |

These are **targets**, not pre-verified facts.

They MUST be measured before being classified as verified.

# 44. Network Contract

Userscript metadata SHOULD contain:

```
@require none
@resource none
```

The implementation MUST NOT introduce remote dependencies.

Userscript network requests:

```
REQUIRED = 0
```

GitHub's own network activity is outside this contract.

# 45. Failure Taxonomy

At minimum:

```
BOOTSTRAP_FAILED
ADAPTER_NOT_FOUND
APPLICATION_NOT_DETECTED
CAPABILITY_UNKNOWN
EDITOR_NOT_DETECTED
EXPLORER_NOT_DETECTED
SEARCH_NOT_DETECTED
SOURCE_CONTROL_NOT_DETECTED
TERMINAL_NOT_DETECTED
SHELL_MOUNT_FAILED
SHELL_DUPLICATION
DOM_CHANGED
UNSUPPORTED_LAYOUT
VIEWPORT_UNAVAILABLE
PREFERENCE_PARSE_FAILED
COMMAND_FAILED
RECONCILIATION_FAILED
```

Failures MUST be observable through diagnostics.

# 46. Graceful Degradation

If a capability is unavailable:

```
capability unavailable
        │
        ▼
feature disabled
        │
        ▼
diagnostic warning
        │
        ▼
remaining features continue
```

Example:

```
Terminal unavailable
```

MUST NOT prevent:

```
Editor
Explorer
Search
Source Control
```

from operating.

# 47. Error Boundary

A failure in one optional feature MUST NOT crash the entire mobile layer.

Conceptually:

```
Explorer failure
      │
      ▼
Explorer = DEGRADED
      │
      ├── Editor continues
      ├── Search continues
      └── Git continues
```

Global failure is reserved for failures that prevent safe operation of the shell itself.

# 48. Security Rules

The userscript MUST NOT access or modify:

```
authentication tokens
cookies
passwords
Git credentials
authorization state
```

It MUST NOT transmit repository/editor content.

It MUST NOT introduce remote telemetry.

# 49. v0.1 Verification Gates

```
G0   Script loads
G1   No uncaught exceptions
G2   github.dev detected
G3   Mobile mode detected
G4   Shell appears exactly once
G5   Editor remains usable
G6   Explorer opens
G7   Explorer closes
G8   Search opens
G9   Search closes
G10  Source Control opens
G11  Source Control closes
G12  Android Back behaves correctly
G13  Keyboard does not destroy shell layout
G14  Route changes survive
G15  Reconciliation is idempotent
G16  Preferences survive reload
G17  Corrupt preferences do not prevent startup
G18  Unsupported capabilities are reported
G19  Userscript makes zero network requests
G20  Userscript has zero external dependencies
```

# 50. Release Rule

The release status SHALL be:

```
VERIFIED
```

only if:

```
G0..G20 = PASS
```

Otherwise:

```
PARTIALLY_VERIFIED
```

or:

```
BLOCKED
```

depending on the failure.

Do not use:

```
works
stable
production-ready
```

as substitutes for the verification status.

# 51. Test Evidence Format

Each gate SHOULD produce:

```js
{
    gate: "G15",
    name: "reconciliation-idempotence",
    status: "PASS",
    evidence: {
        before: {
            shellCount: 1,
            toolbarCount: 1
        },
        after: {
            shellCount: 1,
            toolbarCount: 1
        },
        reconciliations: 10
    }
}
```

Failure:

```js
{
    gate: "G15",
    name: "reconciliation-idempotence",
    status: "FAIL",
    reason: "duplicate-toolbar",
    evidence: {
        toolbarCount: 2
    }
}
```

# 52. Minimum Acceptance Test

The following sequence constitutes the core v0.1 scenario:

```
1. Open github.dev
2. Wait for application detection
3. Enter mobile mode
4. Verify shell exists exactly once
5. Verify editor remains usable
6. Open Explorer
7. Close Explorer
8. Open Search
9. Close Search
10. Open Source Control
11. Close Source Control
12. Press Android Back
13. Open keyboard
14. Verify shell remains visible
15. Navigate to another file/route
16. Trigger reconciliation repeatedly
17. Reload
18. Verify preferences
19. Inspect diagnostics
```

Every step MUST produce observable evidence.

# 53. v0.1 Definition of Done

v0.1 is complete only when:

```
┌────────────────────────────────────┐
│          v0.1 DEFINITION            │
├────────────────────────────────────┤
│ Adapter isolated                    │
│ Kernel selector-free                │
│ Shell idempotent                    │
│ Capabilities evidence-based         │
│ Editor protected                    │
│ Explorer reusable                   │
│ Search reusable                     │
│ Source Control reusable             │
│ Back reversible                     │
│ Preferences versioned               │
│ Diagnostics available               │
│ No network dependencies             │
│ No polling                           │
│ No uncaught errors                   │
│ G0–G20 evidence collected            │
└────────────────────────────────────┘
```

# 54. Implementation Order

The implementation agent MUST follow this order:

```
PHASE 1 — FOUNDATION
    host detection
    bootstrap
    state
    diagnostics
PHASE 2 — ADAPTER
    application detection
    DOM observation
    capability detection
    operation results
PHASE 3 — KERNEL
    reducer
    command registry
    scheduler
    reconciliation
PHASE 4 — SHELL
    root
    toolbar
    surface state
    namespace
PHASE 5 — EDITOR
    immersive presentation
    editor protection
PHASE 6 — SURFACES
    Explorer
    Search
    Source Control
PHASE 7 — MOBILE
    viewport classification
    Android Back
    keyboard-aware layout
PHASE 8 — PERSISTENCE
    preferences
    migration/fallback
PHASE 9 — VERIFICATION
    G0–G20
    evidence collection
    failure classification
```

Do not implement Phase 7 before the kernel and shell are stable.

Do not implement gestures in v0.1.

# 55. Required Deliverables

The v0.1 implementation MUST produce:

```
github-dev-mobile.user.js
README.md
VERIFICATION_REPORT.md
```

Optional:

```
fixtures/
diagnostics/
screenshots/
```

The userscript is the primary artifact.

The verification report MUST distinguish:

```
observed
tested
validated
untested
blocked
```

# 56. README Requirements

The README MUST document:

```
purpose
scope
installation
supported host
features
feature flags
limitations
privacy
failure behavior
diagnostics
verification status
known compatibility risks
```

It MUST NOT claim universal GitHub compatibility.

# 57. Verification Report Requirements

The report MUST contain:

```
Version
Target
Test environment
Browser
Device
Viewport
Adapter status
Capability observations
Gate results
Failures
Known limitations
Final status
```

Example final classification:

```
STATUS: PARTIALLY_VERIFIED

VERIFIED: G0–G12
PARTIALLY_VERIFIED: G13
BLOCKED: G14
UNTESTED: G19–G20
```

Do not promote untested behavior to VERIFIED.

# 58. Implementation-Agent Rules

The implementation agent MUST:

1. inspect before modifying;
2. preserve the four-layer architecture;
3. isolate all GitHub selectors in the adapter;
4. never invent selectors without inspection evidence;
5. implement the smallest viable v0.1;
6. avoid dependencies;
7. avoid polling;
8. avoid global CSS;
9. protect Monaco interaction;
10. make initialization idempotent;
11. make reconciliation idempotent;
12. return structured adapter results;
13. expose failures;
14. preserve GitHub as the application authority;
15. never implement Git operations;
16. validate behavior before claiming success;
17. record evidence for every release gate;
18. stop rather than guessing when host behavior is unknown.

# 59. Stop Conditions

The implementation agent MUST STOP and report `BLOCKED` when:

```
GitHub DOM cannot be reliably identified
adapter contract cannot be satisfied
required host behavior cannot be validated
a proposed mutation risks editor corruption
a feature requires an independent Git state model
a dependency becomes necessary for v0.1
a selector is known to be unstable and no safer alternative exists
```

The agent MUST NOT silently replace a blocked requirement with an invented implementation.

# 60. Core Invariants

The following are normative invariants:

```
I-01  Shell count ≤ 1
I-02  Userscript selectors stay inside adapter
I-03  Kernel contains no GitHub selectors
I-04  Reconciliation converges
I-05  No steady-state polling
I-06  No userscript network requests
I-07  No external runtime dependencies
I-08  GitHub remains application authority
I-09  Editor remains interactive
I-10  Unsupported capability is never represented as verified
I-11  Back is never permanently trapped
I-12  Preferences cannot prevent startup
I-13  Userscript DOM is namespace-owned
I-14  Optional feature failure does not crash kernel
I-15  No verified claim without evidence
```

# 61. v0.1 Freeze Boundary

Once G0–G20 are evaluated, freeze the v0.1 behavior.

Do not mix:

```
v0.1 verification
```

with:

```
v0.2 feature development
```

The sequence SHALL be:

```
implement
    ↓
inspect
    ↓
test
    ↓
collect evidence
    ↓
classify
    ↓
freeze
    ↓
tag v0.1.0
    ↓
plan v0.2
```

# 62. v0.2 Boundary

Only after v0.1 is frozen may the following enter scope:

```
Source Control hardening
visualViewport integration
keyboard-aware layout
Android Back hardening
```

v0.3:

```
Terminal
touch gestures
command shortcuts
performance instrumentation
```

v1.0:

```
adapter hardening
DOM-change resilience
fixture tests
device matrix
release automation
```

# 63. Final Contract

The product SHALL be understood as:

```
                 USER
                   │
         ┌─────────┼─────────┐
         │         │         │
       touch    keyboard    Back
         │         │         │
         └─────────┼─────────┘
                   ▼
         ┌───────────────────┐
         │ Mobile UX Kernel  │
         │                   │
         │ state             │
         │ commands          │
         │ capabilities      │
         │ lifecycle         │
         │ reconciliation    │
         └─────────┬─────────┘
                   │
               Adapter
                   │
                   ▼
         ┌───────────────────┐
         │ github.dev        │
         │ VS Code Web       │
         │                   │
         │ editor            │
         │ explorer          │
         │ search            │
         │ source control    │
         │ terminal          │
         └───────────────────┘
```

The governing implementation law is:

**Observe → Normalize → Decide → Mutate → Observe → Validate.**

The governing ownership law is:

**The userscript owns mobile interaction; GitHub/VS Code owns application state.**

The governing evidence law is:

**NO EVIDENCE → NO VERIFIED CLAIM.**

The governing compatibility law is:

**When the host is unknown, degrade or stop; do not guess.**

The governing v0 law is:

**Prove the adapter, kernel, shell, and reconciliation model before adding sophistication.**
