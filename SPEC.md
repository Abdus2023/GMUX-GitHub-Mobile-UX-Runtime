# GitHub.dev Mobile UX

## Prompt Instructions Pack

### Dependency-Free, Mobile-First, Observation-Driven Userscript

**Version:** 0.1.0 · **Status:** Normative implementation prompt · **Target:** `github.dev` · **Runtime:** Browser userscript — Tampermonkey / Violentmonkey / Greasemonkey-compatible where practical · **Primary target:** Android mobile browsers · **Architecture:** Adapter + Capability Detection + State Machine + Mobile Shell · **Dependencies:** None · **GitHub operations:** Out of scope; must remain delegated to GitHub/VS Code Web

# 0. Mission

Build a userscript that transforms the desktop-oriented `github.dev` web interface into an adaptive, mobile-first development workspace.

The userscript MUST:

- optimize the existing interface for narrow screens;
- preserve GitHub/VS Code Web application state;
- reuse existing editor, Explorer, Search, Source Control, and Terminal surfaces where possible;
- avoid duplicating repository state;
- provide explicit mobile navigation between surfaces;
- handle Android viewport and virtual-keyboard changes;
- survive dynamic DOM changes;
- detect capabilities instead of assuming them;
- expose failures rather than silently claiming unsupported functionality;
- remain dependency-free;
- remain locally executable;
- remain reversible;
- avoid modifying GitHub backend behavior.

The userscript MUST NOT become a replacement Git client, replacement VS Code implementation, repository synchronizer, or hidden automation layer.

# 1. Fundamental Contract

The implementation SHALL obey:

> The userscript may transform presentation and interaction of the existing `github.dev` application, but it must not impersonate GitHub functionality or silently alter repository operations.

Therefore:

```
                github.dev
                    │
                    ▼
            Observation Layer
                    │
                    ▼
          Capability Detection
                    │
                    ▼
             Adapter Contract
                    │
                    ▼
            Mobile UX Kernel
             │      │      │
             ▼      ▼      ▼
          Layout  Surface  Input
          Engine  Manager  Engine
             │      │      │
             └──────┼──────┘
                    ▼
          Existing GitHub UI
```

The userscript is an **interaction/presentation adapter**, not a second application state authority.

# 2. Non-Goals

The implementation MUST NOT:

- implement Git commit logic;
- implement Git push/pull;
- implement branch management;
- implement merge/rebase;
- directly manipulate repository contents as an independent Git client;
- maintain an independent representation of repository state;
- replace Monaco;
- replace VS Code Web;
- duplicate the Explorer file tree unnecessarily;
- create a second terminal implementation;
- inject a frontend framework;
- require a remote service;
- require telemetry;
- require an external API;
- depend on fragile generated CSS class names when stable alternatives exist.

These are explicit out-of-scope boundaries.

# 3. Operating Modes

Implement three shell modes:

```
DESKTOP     > 1024px
COMPACT     600px–1024px
MOBILE     < 600px
```

These values are defaults, not immutable assumptions.

The implementation SHOULD permit future adjustment without changing the kernel.

Mode selection:

```
viewport observation
        │
        ▼
   mode detector
        │
        ├── Desktop
        ├── Compact
        └── Mobile
```

Do not scatter viewport checks throughout the codebase. Centralize them in the layout/mode subsystem.

# 4. Architectural Layers

Implement the following logical layers:

```
src/
├── bootstrap
├── kernel/
│   ├── state
│   ├── lifecycle
│   ├── scheduler
│   ├── commands
│   └── capabilities
├── adapters/
│   └── github-dev
├── surfaces/
│   ├── editor
│   ├── explorer
│   ├── search
│   ├── source-control
│   ├── terminal
│   └── settings
├── input/
│   ├── touch
│   ├── keyboard
│   └── pointer
├── ui/
│   ├── shell
│   ├── toolbar
│   ├── drawer
│   └── modal
├── persistence/
│   └── preferences
└── diagnostics/
    └── status
```

The first release MAY collapse these into one userscript file. The logical boundaries MUST nevertheless remain recognizable.

# 5. Single-File First

Version 0.1 SHOULD be implementable as:

```
github-dev-mobile.user.js
```

Do not introduce a build system unless implementation complexity requires it. The initial artifact should be directly installable into a userscript manager. Only split into modules when there is demonstrated maintenance benefit.

# 6. Kernel Contract

The kernel MUST NOT directly query GitHub-specific DOM selectors. Instead:

```
Kernel
  │
  └── Adapter Contract
          │
          └── github-dev adapter
```

The kernel consumes normalized observations. Example conceptual contract:

```
adapter.observe()
adapter.capabilities()
adapter.openSurface(surface)
adapter.closeSurface(surface)
adapter.focusEditor()
adapter.getActiveFile()
adapter.getViewport()
adapter.getApplicationState()
```

Exact implementation MAY differ. The principle MUST remain: **GitHub-specific knowledge belongs in the adapter.**

# 7. Observation Contract

Observation MUST precede mutation. Required flow:

```
OBSERVE
   │
   ├── viewport
   ├── editor
   ├── Explorer
   ├── Search
   ├── Source Control
   ├── Terminal
   └── application state
          │
          ▼
CAPABILITY MAP
          │
          ▼
STATE REDUCTION
          │
          ▼
DECISION
          │
          ▼
MUTATION
```

Never use scattered code such as:

```js
if (window.innerWidth < 600) {
    document.querySelector(...).style...
}
```

throughout the implementation.

# 8. Capability Detection

The adapter MUST expose detected capabilities. Example:

```json
{
    "editor": true,
    "explorer": true,
    "search": true,
    "sourceControl": true,
    "terminal": false
}
```

Possible capability states:

```
DETECTED
NOT_DETECTED
UNKNOWN
UNSUPPORTED
```

Do not convert `NOT_DETECTED` into `ABSENT` without evidence. A dynamic GitHub application may simply not have rendered a component yet.

# 9. Stable DOM Targeting

Selector preference order:

```
1. semantic attributes
2. ARIA labels / accessible names
3. stable IDs
4. stable element relationships
5. known structural relationships
6. stable class names
7. generated class names
```

Generated CSS classes MUST be considered a last resort. Avoid selectors whose identity is derived from build hashes or frequently changing framework output. All GitHub-specific selectors SHOULD be isolated inside the adapter.

# 10. Reconciliation Model

The userscript MUST be reconciliation-based. Required lifecycle:

```
Page Load
   │
   ▼
Bootstrap
   │
   ▼
Application Detection
   │
   ▼
Capability Detection
   │
   ▼
Initial Reconciliation
   │
   ▼
MutationObserver
   │
   ├── relevant mutation
   │        │
   │        ▼
   │    schedule reconciliation
   │
   └── irrelevant mutation
             │
             ▼
           ignore
```

Do NOT continuously rebuild the interface. Do NOT use `setInterval(scanEntireDOM, 500)` as the primary lifecycle mechanism.

# 11. MutationObserver Requirements

The MutationObserver MUST:

- observe only the minimum practical root;
- avoid expensive whole-document processing;
- classify mutations;
- coalesce repeated mutations;
- schedule reconciliation asynchronously;
- avoid recursive mutation loops;
- disconnect cleanly if necessary.

Preferred scheduling:

```
MutationObserver
      │
      ▼
markDirty()
      │
      ▼
requestAnimationFrame()
      │
      ▼
reconcile()
```

The implementation MUST avoid mutation → reconciliation → mutation → infinite loop behavior.

# 12. State Model

Define explicit state. Minimum conceptual structure:

```json
{
    "shellMode": "mobile",
    "activeSurface": "editor",
    "previousSurface": null,
    "immersive": true,
    "keyboardVisible": false,
    "viewport": { "width": 0, "height": 0, "offsetTop": 0 },
    "capabilities": {},
    "diagnostics": {}
}
```

The DOM MUST NOT be treated as the sole state machine. DOM state is evidence. Kernel state is control state.

# 13. Surface Model

Supported surfaces:

```
Editor  Explorer  Search  Git  Terminal  Settings
```

The default mobile invariant is: **One primary surface occupies the usable workspace at a time.** Therefore:

```
MOBILE
   │
   └── activeSurface
         ├── Editor
         ├── Explorer
         ├── Search
         ├── Git
         └── Terminal
```

Desktop mode MAY retain multi-panel layouts. Mobile mode SHOULD avoid permanent side-by-side panels.

# 14. State Transitions

Minimum transition set:

```
EDITOR
  ├── openExplorer  → EXPLORER
  ├── openSearch    → SEARCH
  ├── openGit       → GIT
  ├── openTerminal  → TERMINAL
  └── openSettings  → SETTINGS

EXPLORER
  ├── selectFile    → EDITOR
  └── close         → previousSurface

SEARCH
  ├── selectResult  → EDITOR
  └── close         → previousSurface

GIT
  └── close         → previousSurface

TERMINAL
  └── close         → previousSurface
```

Unexpected transitions MUST be diagnosable.

# 15. Command Registry

All navigation mechanisms MUST use a common command layer. Example:

```
commands.register("open-explorer")
commands.register("open-search")
commands.register("open-git")
commands.register("open-terminal")
commands.register("focus-editor")
commands.register("toggle-immersive")
commands.register("close-surface")
```

Input sources — Toolbar, Gesture, Keyboard shortcut, Pointer, Accessibility interaction — MUST converge on:

```
Input
   │
   ▼
Command
   │
   ▼
State transition
   │
   ▼
Adapter
   │
   ▼
Existing UI
```

Do not implement separate navigation logic for each input source.

# 16. Mobile Shell

The shell SHOULD provide:

```
┌────────────────────────┐
│ ☰   current-file    ⋮  │
├────────────────────────┤
│                        │
│                        │
│       ACTIVE           │
│       SURFACE          │
│                        │
│                        │
├────────────────────────┤
│ Files Search Git Term. │
└────────────────────────┘
```

On extremely narrow screens:

```
┌──────────────────────┐
│ ☰  file          ⋮  │
│                      │
│      SURFACE         │
│                      │
├──────────────────────┤
│ 📁  🔎  ⎇  ▣  ⋮      │
└──────────────────────┘
```

Icons MUST have accessible names. Do not sacrifice accessibility for compactness.

# 17. Explorer

The Explorer SHOULD become a drawer/full-screen surface.

```
┌──────────────────────┐
│ Files             ×  │
├──────────────────────┤
│ src/                 │
│ ├─ main.rs           │
│ ├─ lib.rs            │
│ └─ agent.rs          │
│                      │
│ Cargo.toml           │
│ README.md            │
└──────────────────────┘
```

Critical requirement: **Do not duplicate repository state.** Reuse the existing Explorer wherever possible. The mobile layer should primarily alter `position visibility width z-index interaction` rather than create a second file-tree model.

# 18. Search

Search SHOULD become a full-screen or dominant mobile surface.

Requirements:

- maximize usable width;
- prevent unnecessary desktop chrome;
- preserve existing search functionality;
- return to editor after selecting a result;
- do not implement a separate repository search engine.

# 19. Source Control

Source Control SHOULD become a full-screen or slide-up mobile surface.

The userscript MAY:

- open the existing Source Control view;
- resize/reposition it;
- expose navigation controls;
- improve visibility.

The userscript MUST NOT implement an independent Git state machine. GitHub/VS Code remains authoritative.

# 20. Terminal

Terminal SHOULD normally occupy the full usable mobile height.

```
┌──────────────────────┐
│ Terminal          ×  │
├──────────────────────┤
│ $ cargo test         │
│                      │
│ running...           │
│                      │
│                      │
│                      │
├──────────────────────┤
│ command input        │
└──────────────────────┘
```

Do not assume the terminal exists. If not detected: `terminal = NOT_DETECTED`. The toolbar MUST NOT falsely advertise a working terminal.

# 21. Editor Immersive Mode

Mobile default: `immersive = true`.

Potentially hide:

- minimap;
- redundant breadcrumbs;
- desktop activity rail;
- unnecessary status information;
- excessive padding;
- redundant toolbars.

Do NOT blindly remove:

- editor controls required for operation;
- accessibility affordances;
- Monaco interaction mechanisms;
- error/warning information that materially assists development.

Every hiding rule MUST be individually justified.

# 22. Monaco Protection Rule

The userscript MUST treat the editor as a protected interaction region. Do not hijack:

- text selection;
- cursor movement;
- horizontal editor scrolling;
- copy/paste;
- native pointer behavior;
- Monaco gestures;
- keyboard input.

The mobile layer owns only its own controls and controlled shell zones.

# 23. Gesture Contract

Gestures are OPTIONAL and initially SHOULD be conservative.

Potential mapping:

```
Shell right swipe → Explorer
Shell left swipe  → close surface
Shell upward      → Terminal
Shell downward    → close surface
```

BUT: **Never globally interpret gestures across the editor.** Gesture recognition MUST be restricted to explicitly controlled UI zones. Required minimum protections:

```
ignore editor
ignore text selection
ignore input controls
ignore textarea
ignore contenteditable
ignore native scrolling contexts
```

If gesture confidence is insufficient: `NO ACTION`.

# 24. Android Viewport Contract

The implementation MUST prefer `window.visualViewport` when available. Track `width height offsetTop resize scroll`.

Conceptual flow:

```
Physical viewport
       │
       ▼
visualViewport
       │
       ├── width
       ├── height
       ├── offsetTop
       └── resize
              │
              ▼
       Mobile Shell Layout
```

Do not assume `window.innerHeight` equals usable screen height.

# 25. Virtual Keyboard

When the Android keyboard opens: `keyboardVisible = true`. The shell MUST adapt to the reduced visual viewport. The bottom toolbar MUST NOT remain hidden behind the keyboard. The implementation SHOULD infer keyboard visibility from a significant visual viewport reduction rather than relying on a browser-specific keyboard API. Keyboard inference MUST remain `INFERRED` unless validated by stronger evidence.

# 26. CSS Architecture

CSS MUST be scoped to the userscript. Use a unique namespace, for example `.gdmux-*`. Avoid broad rules such as `* { ... } body { ... } button { ... }` unless tightly scoped. Preferred:

```css
.gdmux-shell {}
.gdmux-toolbar {}
.gdmux-drawer {}
.gdmux-surface {}
.gdmux-hidden {}
```

Do not unintentionally alter Monaco or GitHub application components.

# 27. Z-Index Policy

The mobile shell MUST use a controlled z-index hierarchy. Do not use arbitrary extreme values throughout the stylesheet. Define a small internal hierarchy:

```
base  surface  drawer  modal  shell  diagnostic
```

Avoid z-index escalation wars with VS Code.

# 28. Persistence

Use `localStorage` initially. Schema:

```json
{
    "version": 1,
    "mode": "auto",
    "immersive": true,
    "preferredSurface": "editor",
    "gestures": true,
    "bottomBar": true,
    "terminalFullscreen": true
}
```

Requirements:

- version the schema;
- tolerate malformed data;
- fall back to defaults;
- never prevent application startup because preferences are invalid;
- do not store repository contents;
- do not store credentials;
- do not store authentication tokens.

# 29. Privacy Contract

The userscript MUST be local-first. It MUST NOT:

- send telemetry;
- call analytics services;
- transmit repository contents;
- transmit editor contents;
- transmit credentials;
- collect browsing history;
- introduce remote JavaScript dependencies.

External network access is unnecessary for the core implementation.

# 30. Performance Contract

The implementation MUST be conservative on mobile hardware.

Prohibited by default: React, Vue, Svelte runtime, Tailwind runtime, jQuery, polling loops, DOM reconstruction, iframes, remote libraries, continuous full-DOM scans.

Preferred: native JavaScript, native CSS, MutationObserver, ResizeObserver, visualViewport, requestAnimationFrame, event delegation, small state store.

The userscript SHOULD minimize allocations and DOM writes.

# 31. Scheduler

All expensive reconciliation SHOULD pass through a scheduler. Conceptual: `scheduleReconcile()`. Multiple events within one frame SHOULD produce one reconciliation.

```
mutation / resize / viewport resize / route change
        │
        ▼
      dirty
        │
        ▼
requestAnimationFrame
        │
        ▼
reconcile once
```

# 32. Lifecycle

Required lifecycle states:

```
BOOTSTRAPPING
      │
      ▼
WAITING_FOR_APP
      │
      ▼
DETECTING
      │
      ├── sufficient evidence ──> ACTIVE
      │
      └── insufficient evidence → DEGRADED
```

Do not repeatedly initialize the shell. Initialization MUST be idempotent.

# 33. Failure Codes

Define explicit diagnostic codes:

```
BOOTSTRAP_FAILED
ADAPTER_NOT_FOUND
EDITOR_NOT_FOUND
EXPLORER_NOT_FOUND
SEARCH_NOT_FOUND
SOURCE_CONTROL_NOT_FOUND
TERMINAL_NOT_FOUND
CAPABILITY_UNKNOWN
DOM_CHANGED
UNSUPPORTED_GITHUB_LAYOUT
VIEWPORT_API_UNAVAILABLE
SHELL_MOUNT_FAILED
PREFERENCE_PARSE_FAILED
COMMAND_FAILED
RECONCILIATION_FAILED
```

Failure MUST NOT silently become success.

# 34. Evidence Model

Use: `OBSERVED INFERRED VALIDATED`.

Example:

```
OBSERVED   └── an editor-related DOM surface exists
INFERRED   └── it represents the active editor
VALIDATED  └── focus-editor command produced the expected editor state
```

Do not label inferred behavior as validated.

# 35. Feature Status

Every major feature SHOULD have one status: `VERIFIED PARTIALLY_VERIFIED PROVISIONAL BLOCKED OUT_OF_SCOPE`.

Example:

| Feature | Status |
| --- | --- |
| Mobile viewport detection | VERIFIED |
| Editor immersive mode | VERIFIED |
| Explorer drawer | VERIFIED |
| Search surface | VERIFIED |
| Source Control surface | PARTIALLY_VERIFIED |
| Terminal surface | PARTIALLY_VERIFIED |
| Gesture navigation | PROVISIONAL |
| Git operations | OUT_OF_SCOPE |
| Unknown future GitHub DOM | BLOCKED |

These statuses MUST be evidence-based.

# 36. Verification Invariant

Enforce: **NO EVIDENCE → NO VERIFIED CLAIM**

Therefore:

```
No observed element        → Cannot claim capability
No successful transition   → Cannot claim command validated
No mobile viewport test    → Cannot claim mobile layout verified
```

# 37. Testing Matrix

At minimum test:

```
Desktop  Compact  Mobile portrait  Mobile landscape
Editor open  Explorer open  Search open  Git open  Terminal open
Keyboard closed  Keyboard open
Dynamic DOM changes  Route changes  File changes  Panel changes
Gesture enabled  Gesture disabled
Fresh installation  Existing preferences  Corrupt preferences
Unsupported layout  Missing terminal  Missing Explorer
```

# 38. Regression Requirements

A regression MUST be tested whenever a selector, adapter rule, or shell layout changes. At minimum verify:

```
Editor remains editable
Text selection remains functional
Copy/paste remains functional
Explorer remains usable
Search remains usable
GitHub UI remains responsive
Terminal remains usable when present
Shell can be disabled
Desktop mode remains minimally intrusive
```

# 39. Reversibility

Provide a reliable disable mechanism. Minimum: **Toggle mobile mode.** The implementation SHOULD also provide a diagnostic/reset mechanism.

When disabled:

```
userscript shell hidden
userscript listeners removed where practical
userscript styles removed
GitHub application left intact
```

Do not reload the page as the only recovery mechanism.

# 40. Route / Application Changes

`github.dev` is a dynamic web application. The userscript MUST detect relevant application transitions. Possible signals: DOM mutations, history changes, URL changes, active editor changes, panel changes. Do not assume a full page reload occurs between repository/file transitions.

# 41. Adapter Isolation

All GitHub-specific implementation MUST remain inside the `github-dev` adapter. For example:

```
adapter/
    observeEditor()
    observeExplorer()
    observeSearch()
    observeGit()
    observeTerminal()
    focusEditor()
    openExplorer()
    openSearch()
    openGit()
    openTerminal()
```

The kernel MUST NOT contain selectors such as `document.querySelector(".some-github-class")`.

# 42. Versioning

Userscript metadata MUST expose a version. Example:

```
@name GitHub.dev Mobile UX
@version 0.1.0
```

The implementation SHOULD maintain `USER_INTERFACE_VERSION`, `ADAPTER_VERSION`, `PREFERENCE_SCHEMA_VERSION` separately where useful. A GitHub DOM change MUST NOT automatically imply a userscript semantic-version change unless behavior changes.

# 43. No Silent Compatibility Claims

Never state "Works with all GitHub layouts" unless evidence exists. Instead report:

```
adapter: github-dev
layout: detected
capabilities:
    editor: VERIFIED
    explorer: VERIFIED
    terminal: UNKNOWN
```

Unknown remains unknown.

# 44. Diagnostics

Provide a lightweight diagnostics surface. Example:

```
GitHub.dev Mobile UX
Mode: MOBILE        Adapter: github-dev   Adapter status: ACTIVE
Editor: DETECTED    Explorer: DETECTED    Search: DETECTED
Git: DETECTED       Terminal: NOT_DETECTED
Viewport: 412 × 732 Keyboard: INFERRED_CLOSED
Shell: ACTIVE       Immersive: ON         Gestures: ON
```

Diagnostics MUST be optional and unobtrusive.

# 45. Security Boundary

The userscript MUST NOT intercept or modify: authentication cookies, tokens, credentials, Git credentials, repository authorization, GitHub API authentication. It MUST NOT inject credentials into commands. The userscript has no need to possess repository authority.

# 46. Repository-State Boundary

The following MUST remain authoritative:

```
GitHub / VS Code Web
        │
        ├── repository state
        ├── Git state
        ├── editor model
        ├── terminal state
        └── authentication
```

The userscript owns only:

```
Mobile UX state
        │
        ├── active surface
        ├── shell mode
        ├── immersive preference
        ├── gesture preference
        └── presentation state
```

# 47. Implementation Order

Implement in this order:

```
1.  Bootstrap
2.  Adapter contract
3.  Application detection
4.  Capability detection
5.  Viewport detection
6.  State model
7.  Reconciliation scheduler
8.  Mobile shell
9.  Editor immersive mode
10. Explorer surface
11. Search surface
12. Source Control surface
13. Terminal surface
14. Command registry
15. Persistence
16. Keyboard handling
17. Conservative gestures
18. Diagnostics
19. Failure handling
20. Verification suite
```

Do not begin with gesture support. Do not begin with CSS micro-optimization. The kernel and adapter contract come first.

# 48. Implementation Discipline

For every feature:

```
DEFINE → OBSERVE → DETECT → IMPLEMENT → VALIDATE → CLASSIFY EVIDENCE → RELEASE
```

Do not implement a feature merely because the DOM appears to suggest it exists.

# 49. Release Gates

A release MUST NOT be marked stable unless:

```
[ ] Userscript installs
[ ] Bootstrap succeeds
[ ] Adapter detected
[ ] Mobile mode activates
[ ] Editor remains functional
[ ] Explorer works when detected
[ ] Search works when detected
[ ] Git surface does not duplicate Git state
[ ] Terminal works when detected
[ ] Android viewport handling works
[ ] Keyboard does not obscure shell
[ ] MutationObserver reconciliation works
[ ] No polling loop is required
[ ] Preferences tolerate corruption
[ ] No external dependency exists
[ ] No telemetry exists
[ ] Disable/recovery works
[ ] Unsupported capabilities are reported honestly
```

# 50. Final Engineering Principle

The implementation is not "CSS hacks for GitHub". It is:

```
Existing Application
        │
        │ observation
        ▼
GitHub Adapter
        │
        │ normalized evidence
        ▼
Capability Layer
        │
        ▼
Mobile UX Kernel
        │
        ├── state
        ├── commands
        ├── lifecycle
        ├── scheduling
        └── diagnostics
        │
        ▼
Mobile Presentation Layer
        │
        ▼
Existing GitHub / VS Code UI
```

The governing rule is:

> **Observe first. Adapt second. Mutate third. Validate fourth.**

And:

> **The userscript owns mobile interaction; GitHub owns application and repository state.**

# 51. Agent/Implementation Instruction

When executing this specification:

1. Inspect the current `github.dev` runtime before writing selectors.
2. Record observed DOM evidence.
3. Build the adapter around observed stable interfaces.
4. Keep GitHub-specific knowledge isolated.
5. Implement the kernel independently of selectors.
6. Make every mutation reversible.
7. Coalesce dynamic updates.
8. Protect Monaco interaction.
9. Treat Android viewport behavior as a first-class subsystem.
10. Never invent unsupported capabilities.
11. Never claim verification without evidence.
12. Prefer graceful degradation over brittle automation.
13. Keep the first implementation dependency-free and single-file.
14. Produce diagnostics for failures.
15. Preserve GitHub's own application state and authority.
16. Test each surface independently before adding gestures.
17. Do not expand scope into Git automation.
18. Mark unresolved compatibility questions as `BLOCKED` or `PROVISIONAL`.
19. Release only after the defined gates pass.
20. Preserve the distinction `OBSERVED / INFERRED / VALIDATED`.

Final status vocabulary: `VERIFIED PARTIALLY_VERIFIED PROVISIONAL BLOCKED OUT_OF_SCOPE`.

**No evidence means no verified claim.**
