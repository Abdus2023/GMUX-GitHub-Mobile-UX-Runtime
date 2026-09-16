# Inspection-First Reconnaissance — how GMUX learns the host

The host DOM is **unknown until observed**. GMUX never assumes a selector: it inspects,
records evidence, identifies candidates, attempts a controlled operation, observes the
resulting state and validates — in that order (§1/§42).

```
UNKNOWN HOST → RECONNAISSANCE → EVIDENCE → CAPABILITY → ADAPTER → KERNEL
   → MOBILE SHELL → HOST UI → OBSERVATION → VERIFICATION → STATE
```

## 1. Where reconnaissance lives

Reconnaissance is **not** part of the runtime. Pack §12/§13/§72 freeze the v0.1 runtime
as selector-free with an intentionally incomplete adapter, so the scan lives in a
separate, temporary artifact:

| | `github-dev-mobile.user.js` | `gmux-recon.user.js` |
|---|---|---|
| role | presentation + orchestration runtime | evidence acquisition instrument |
| host knowledge | **none** — asks the adapter, gets `BLOCKED` | semantic queries + structural fingerprints |
| DOM writes | only inside its own owned root | **none** (read-only, self-audited) |
| activation | always on `github.dev` | only with `?gmux=recon` |
| output | `GMUX.inspect()` diagnostics | `gmux.recon/v1` payload |
| lifetime | maintained | temporary, retired once adapter revision 1+ is verified |

The adapter's host lookups return `null` until reviewed evidence replaces them. That is
not a stub waiting to be filled in quietly — it is the release gate working: `find*`
returning something other than `null` without a verified mapping would be a guess (§12/§68).

## 2. What a scan does

`GMUXRecon.run()` performs one bounded scan of semantic signals
(`[aria-label]`, `[title]`, `[role]`, `button`), keeps only interaction controls whose
text matches a UI token, and records a compact fingerprint per candidate: tag, role,
aria-label, title, bounded `data-*` set, token-matched snippet, parent roles, depth,
bounding box, visibility, disabled state, the winning strategy, and the evidence list
(§44/§45/§47). It never dumps the DOM, and it reports `scanned`, `skipped` counters and a
`truncated` flag so silence is distinguishable from absence.

Candidate vocabulary (§44) — tokens, not truths:

```
Explorer · Files · Search · Source Control · Run · Debug · Terminal · Extensions
```

## 3. Discovery levels

Evidence may only move forward one step at a time, and each step is recorded:

```
UNKNOWN → DETECTED → SEMANTICALLY IDENTIFIED → INTERACTION ATTEMPTED
        → STATE TRANSITION OBSERVED → REGRESSION-TESTED
```

| Level | Claim kind in diagnostics | Reached by |
|---|---|---|
| UNKNOWN | `BLOCKED` | nothing observed yet |
| DETECTED | `PROVISIONAL` | a semantic signal matched — existence only |
| SEMANTICALLY IDENTIFIED | `PROVISIONAL` | role + accessible name + strategy recorded |
| INTERACTION ATTEMPTED | `PROVISIONAL` | an allow-listed, authorised action ran (§48) |
| STATE TRANSITION OBSERVED | `PARTIALLY_VERIFIED` | before/after differ as expected (§18) |
| REGRESSION-TESTED | `VERIFIED` | fixture + mutation suite pass; golden state restored (§54/§55) |

Levels are never skipped silently, and **detection is never promoted to operation** —
element existence is not operational verification (§15). `UNKNOWN` is not `FALSE` and not
`TRUE`; it goes to diagnostics (§68).

## 4. Selector strategy preference (§51)

When a mapping is eventually written, it must prefer, in order:

1. ARIA semantics (`aria-label`, `aria-*`, roles + accessible name)
2. `title`
3. stable `data-*` attribute / stable id
4. `role` + accessible name
5. structural relationship
6. CSS class — weakest fallback, usable only with evidence of stability

The adapter must report **which** strategy succeeded. Recon reports it per candidate as
`strategy` + `strategyRank`; §51 preference is asserted in `tests/recon-fixtures.mjs`.

## 5. Drift handling (§52)

```
KNOWN MAPPING → not found → semantic fallback? → yes → PROVISIONAL
                                             └→ no  → BLOCKED
```

Never silently disabled, never still claiming `VERIFIED`. The runtime implements the
generic half of this without knowing any selector: a committed surface that stops being
observed retreats to `editor`, logs `adapter drift: <surface> is no longer observed —
retreating to editor (§52)` and shows the reason in the shell. The selector-specific half
(re-identifying the moved control) is the adapter's job and arrives with revision 1+.

## 6. Interaction verification (§49)

For every safe candidate:

```
1 locate candidate → 2 snapshot pre-state → 3 controlled action
→ 4 wait for stabilization → 5 observe post-state → 6 compare → 7 restore
```

Outcomes: transition seen **and** restored → `PROVISIONAL` (one data point, still not
`VERIFIED`); no expected transition or no restore → `BLOCKED`. "Probably works" is not an
available answer. Automatic destructive actions are impossible by construction: the
allow-list is `open/close Explorer`, `open/close Search`, `focus editor`, and any label
matching the denylist (commit, push, delete, rename, merge, publish, discard, stage,
revert, kill, restart, install, reset, …) is refused before it can be attempted (§48).

## 7. Fixture format (§53) and extraction (§50)

Frozen evidence lives in `fixtures/github-dev/` as `gmux.fixture/v1` records carrying the
**minimum** structure needed to verify an adapter — `role` + accessible `name` +
`visible`, never CSS selectors:

```
fixtures/github-dev/
├── explorer-open.json      ├── search.json           ├── terminal.json
├── explorer-closed.json    ├── source-control.json   └── mobile-layout.json
```

Extraction to code is a human gate, never a code generator:

```
Recon → candidate → human review → adapter definition → fixture
      → interaction verification → release gate            (§50)
```

Only after that chain may a mapping enter the runtime, and only with
`adapterRevision` incremented (§56) and the host fingerprint changed (§57).

## 8. Mutation tests (§55)

Adversarial fixtures deliberately break recognition: ARIA label changed · button removed ·
container moved · panel renamed · visibility changed · duplicate candidate added · role
changed · irrelevant candidate added. The only acceptable outcome is adapter uncertainty:

```
mutation → PROVISIONAL / BLOCKED            ✅
mutation → false VERIFIED                   ❌ release blocker
```

Current results: [`../evidence/mutation-results.json`](../evidence/mutation-results.json)
(all eight degrade safely; regenerated with `node tests/gen-evidence.mjs`).

## 9. Reproducing the automated evidence

```bash
node tests/recon-fixtures.mjs    # schema, privacy sentinels, read-only proof, strategy
                                 # preference, §48/§49 authorisation, §55 mutations,
                                 # §53 fixtures, §54 golden state, §52 drift
node tests/gen-evidence.mjs      # regenerate evidence/*.json
```

Live procedure, including the §46→§53 freeze steps: [`recon-guide.md`](recon-guide.md).
Prior host observations (candidate inputs for review, not runtime knowledge):
[`dom-evidence.md`](dom-evidence.md).
