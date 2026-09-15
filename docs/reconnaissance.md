# Inspection-First Reconnaissance — how GMUX learns the host

The host DOM is **unknown until observed**. GMUX never assumes a selector:
it inspects, records evidence, identifies candidates, attempts operations,
observes the resulting state, and validates — in that order.

```
UNKNOWN HOST → RECONNAISSANCE → EVIDENCE → CAPABILITY → ADAPTER → KERNEL
→ MOBILE SHELL → EXISTING UI → OBSERVATION → VALIDATION → EVIDENCE
```

## 1. Reconnaissance scan

`adapter.reconnaissance.scan()` performs one **bounded** scan of semantic
signals: ARIA labels, roles, titles, ids, data attributes, button/input
names, element visibility and DOM relationships. It counts (buttons, labelled
controls, candidate surfaces) and samples at most 24 distinct labels — it
never dumps the DOM indiscriminately.

`adapter.reconnaissance.evidenceForSurface(surface)` returns normalized
evidence per surface, e.g.:

```json
{ "surface": "explorer",
  "evidence": [
    { "kind": "id", "value": "workbench.view.explorer", "count": 1 },
    { "kind": "aria-label", "value": "Explorer", "count": 1 },
    { "kind": "class", "value": ".explorer-folders-view", "count": 1 }
  ] }
```

Observation (counts) and interpretation (candidate + confidence) stay
separate. Scans run at bootstrap, after drift, and on `GMUX.inspect()` —
never as steady-state polling.

## 2. Selector registry and provenance

The registry **begins empty** (`explorer/search/sourceControl/editor/
terminal: []`). Entries arrive only with provenance:

```json
{ "selector": "[aria-label=\"Explorer\"]", "source": "reconnaissance",
  "confidence": 2, "observedAt": "2026-09-15", "purpose": "explorer" }
```

Current seeds carry the 2026-09-15 reconnaissance evidence from
[`dom-evidence.md`](dom-evidence.md) and remain `PROVISIONAL`.
`resolve(candidates)` returns `{element, selector, evidence}` — resolution
is observation, never verification. Every use is recorded locally
(selector, surface, discovery level, timestamp, match count, visibility,
interaction status) and never leaves the device.

## 3. Semantic fallback and drift

Resolution order: known selector → semantic discovery → `PROVISIONAL`
single candidate, else `BLOCKED`. Ambiguous candidates refuse to guess, and
a runtime candidate never auto-promotes to a permanent selector.

If a previously matching known selector stops matching, the observation
carries an `ADAPTER_DRIFT` record (`expected / current / fallback`), the
feature degrades to at most `PARTIALLY_VERIFIED`, and one bounded
re-discovery scan runs. See `evidence/mutation-results.json` for the
stub-DOM drift matrix.

## 4. Discovery levels

| Level | Meaning | Evidence |
|---|---|---|
| 0 | UNKNOWN | `UNKNOWN` |
| 1 | DETECTED (element exists) | `OBSERVED` |
| 2 | SEMANTICALLY IDENTIFIED | `OBSERVED + INFERRED` |
| 3 | INTERACTION ATTEMPTED | `ATTEMPTED` |
| 4 | STATE TRANSITION OBSERVED | `VALIDATED` |
| 5 | REGRESSION-TESTED | `VALIDATED + REGRESSION-TESTED` |

Element-exists ≠ works. Levels never skip silently. `GMUX.inspect()`
reports each capability with its discovery level.

## 5. Promotion chain (§61)

```
RECONNAISSANCE → CANDIDATE → LIVE OPERATION → STATE TRANSITION
→ FIXTURE TEST → MUTATION TEST → PROMOTED SELECTOR
```

No seed in this repo has completed the chain: promotion requires a live
github.dev state transition plus fixture and mutation coverage. Until then,
every seed is `PROVISIONAL` by construction.

## 6. Fixtures and mutation testing

[`../fixtures/`](../fixtures/) holds 7 minimal, scriptless recognition
cases: `baseline`, `explorer`, `search`, `terminal`, `missing-explorer`
(capability downgrade), `changed-label` (known fails → semantic
`PROVISIONAL`), `malformed` (safe, no throw). Run them plus the 7-mutation
matrix (ARIA changed, button removed, container renamed, element
moved/duplicated/hidden, role changed) with:

```bash
node tests/recon-fixtures.mjs  # 126 checks
node tests/gen-evidence.mjs    # regenerates evidence/*.json
```

The enforced invariant: **broken recognition degrades capability status
rather than silently executing the wrong action.** A `VALIDATED` result may
only ever name the requested surface.

## 7. First live run (Q1–Q10)

On a live session, `GMUX.inspect()` answers from local evidence: host
detection, application root, labelled controls, roles, per-surface
candidates with visibility/interactivity, cross-reconciliation stability,
and — after activating a candidate — whether the resulting state transition
is observable. Record answers in `dom-evidence.md`; do not invent them.
