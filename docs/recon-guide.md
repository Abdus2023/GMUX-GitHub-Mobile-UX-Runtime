# GMUX Recon — Phase B live reconnaissance guide

**Instrument:** `gmux-recon.user.js` · **Purpose:** acquire the evidence that becomes
`github-dev` **adapter revision 1** · **Contract:** pack §42–§50, §62.

Recon is the only place in this project that is allowed to look for host structure.
The runtime stays selector-free (§12/§13) and Recon stays read-only by default (§42).
Its output is **EVIDENCE**, not capability: a candidate that Recon found is still a
candidate until a human reviews it, a fixture freezes it, and an interaction
verification observes the transition (§46/§47/§50).

```
OBSERVE github.dev → identify semantic candidates → produce compact evidence
       → freeze fixture → manually review → implement adapter            (§42)
```

## 1. Install and arm

1. Install `gmux-recon.user.js` in Tampermonkey/Violentmonkey (`@grant none`).
2. Open a repository: `https://github.dev/<owner>/<repo>?gmux=recon`.
   The `?gmux=recon` parameter is required — the instrument does not exist on the page
   without it, and it never runs alongside the runtime's own behaviour.
3. Open the devtools console. `GMUXRecon` is the only global it creates.

## 2. Collect structure

```js
const p = GMUXRecon.run();   // returns the payload AND reports a self-audit
GMUXRecon.summary();         // compact per-surface view for review
console.log(GMUXRecon.json());// full gmux.recon/v1 payload to paste into evidence/
```

`run()` is read-only and says so: it digests the host structure before and after the
scan and reports `reconIntegrity.mutated`. That flag must be `false`; `true` is a bug
in the instrument, not a finding about the host.

Expected payload shape (§46):

```json
{
  "schema": "gmux.recon/v1",
  "host": "github.dev",
  "timestamp": "…",
  "environment": { "width": 412, "height": 915, "touchPoints": 5, "coarsePointer": true },
  "candidates": [ { "surface": "search", "confidence": "candidate", "evidence": [ … ] } ],
  "interpretation": { "isVerifiedCapability": false }
}
```

## 3. What Recon may and may not do

| | |
|---|---|
| **May** | query `[aria-label]`, `[title]`, `[role]`, `button`; record tag/role/name/data attributes/depth/box/visibility/disabled; count candidates; report which strategy matched |
| **May, only after you authorise it** | `open-explorer`, `close-explorer`, `open-search`, `close-search`, focus the editor — each followed by an observed comparison and a restore (§48/§49) |
| **Never** | commit · push · delete · rename · merge · publish · discard · stage · revert · kill/terminate · restart · install; any terminal command; any destructive or irreversible action (§48) |
| **Never collects** | repository contents · file contents · terminal output · commit messages · usernames · tokens · cookies · localStorage · IndexedDB · authentication data (§43) |

Content discipline is structural, not a scrubber: Recon only reads *interaction
controls* (`button`, `a`, `role=button|tab|menuitem|link|…`) whose own text matches a
known UI token. Tree rows, list items, cells, inputs and editor regions are treated as
content and are skipped, so a file name in the Explorer — which is an `aria-label` on a
`treeitem` — cannot enter the evidence. The harness proves this with planted sentinels
(`tests/recon-fixtures.mjs` §3).

## 4. Interaction verification (§49)

```js
await GMUXRecon.verify('explorer', { allowInteraction: true });
```

Seven steps, in order: locate candidate → snapshot pre-state → controlled action →
stabilize → observe post-state → compare → restore. Outcomes:

* `PROVISIONAL` — a transition was seen **and** the pre-state was restored. Still not
  `VERIFIED`: one run on one page is one data point.
* `BLOCKED` — no transition, or the pre-state could not be restored. Reported as
  `BLOCKED`, never as "probably works" (§49). A failure to restore is the most
  important thing this command can tell you; surface it to the maintainer.

`allowInteraction` is mandatory. Without it the plan is refused, so a copy-pasted
snippet cannot mutate anyone's session by accident.

## 5. Freeze the evidence

1. Copy `GMUXRecon.json()` into `evidence/reconnaissance.json` (replace the harness
   payload; keep the `schema` and set `provenance` to the live session/date, dropping
   `UNVALIDATED_LIVE`).
2. `GMUXRecon.fixture('explorer','open')` and `('explorer','closed')` → save as
   `fixtures/github-dev/explorer-open.json` / `explorer-closed.json`, editing to the
   **minimum** structure needed to verify the adapter (§53).
3. Regenerate derived evidence: `node tests/gen-evidence.mjs`.

## 6. Human review → adapter revision 1 (§50)

Recon output must never be piped into executable selectors automatically. The review
chain, in order:

```
candidate → human review → adapter definition → fixture → interaction verification → release gate
   (§47)      (§50)            (§12/§51)          (§53)         (§49/§54)            (§60/§66)
```

For each surface a mapping may enter `github-dev-mobile.user.js` only when all hold:

1. **Strategy** is recorded, preferring ARIA → title → stable data attribute →
   role+name → structure, with CSS class as the weakest fallback (§51). The adapter must
   report which strategy succeeded.
2. **Golden state** passes: CLOSED → OPEN → CLOSED leaves the host where it started (§54).
3. **Mutation tests** degrade to `PROVISIONAL`/`BLOCKED` instead of producing a false
   `VERIFIED` (§55).
4. `adapter.revision` increments (§56) and the host fingerprint changes (§57).
5. `VERIFIED` appears in `GMUX.inspect()` only for the surface actually verified.

Anything less ships as `BLOCKED` with a reason. `UNKNOWN` is not `FALSE` and not `TRUE`
(§68): a surface Recon could not identify is reported as unidentified, and the mobile
control stays visibly disabled rather than hidden behind a lie (§26).

## 7. Selector drift (§52)

If a mapping that used to match stops matching, the runtime must not silently disable
the feature and must not keep claiming it. The generic layer handles this without
knowing any selector: a committed surface that is no longer observed retreats to
`editor`, logs `adapter drift: <surface> is no longer observed`, and shows the reason in
the shell. Add a fixture for the drifted shape (mutation-test it), bump the adapter
revision, and re-verify.

## 8. Narrowing the observer (§35)

While a real session is open, read `GMUX.inspect()` → `mutation volume`
(`total · peak batch · peak/s`). That measurement is the input for the §35 checklist:

1. measure mutation volume on a busy session (typing, file switches, Git refresh);
2. identify the relevant workbench root;
3. narrow `installObserver()` to that subtree where possible;
4. drop `attributes: true` if evidence shows it is unnecessary.

Do not narrow on the basis of a fake-DOM harness number: harness counts include the
harness's own per-attribute batching and are not representative (§67).

## 9. Known items to settle during Phase B

* **Host routing.** `https://github.dev/*` is the mandated single `@match` (§4), but
  `github.dev` was observed (2026-09-15, via this workspace's fetcher, which follows
  redirects) to resolve to `vscode.dev/github/*`. Confirm in a real browser whether the
  address bar stays on `github.dev`. If it redirects, the runtime never executes and the
  pack's metadata must be amended (`https://vscode.dev/github/*`) — a spec decision, not
  an implementation guess.
* **Keyboard.** The §8 heuristic measures viewport shrink only. Record actual
  `visualViewport` traces per browser so the heuristic can be judged (never relabelled
  as detection).
* **Back.** Hardware Back cannot be captured without history entries, which §40
  forbids; decide in Phase E whether GMUX keeps an in-shell Back control + Escape only.
* **Terminal.** §29/§64 allow a terminal surface only when verified. Confirm whether the
  web host exposes one at all; absence is a valid observation, not a failure (§68).
