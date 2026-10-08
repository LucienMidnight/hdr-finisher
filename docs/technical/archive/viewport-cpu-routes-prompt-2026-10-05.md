# Paste into the next thread — Remaining CPU routes while editing

## Goal

While editing in HDR Finisher, some work still falls back to the CPU behind a
GPU frame. The October 5 baseline counted it. Find out why each of those
fallbacks happens, and remove the ones that are not there by decision, so
that an ordinary edit is drawn, masked and measured on the GPU for the
visible area. Start with the two that cost the user most: CPU pictures after
a geometry change (CF-ROUTE-01) and CPU mask requests (CF-ROUTE-02).

This is the work that makes the larger code cleanup possible. Phase 4 found
almost nothing to delete (19 lines) because the CPU-era machinery is still
in use. Code can be removed only after the route that needs it has stopped
firing, and that removal is a separate, later step.

## Context

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`. Test and
run directory: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`.
Check HEAD and status first; do not reset. Local commits are ahead of the
remote and not pushed.

Steve is the owner and not a coder. Explain in plain language. Put decisions
to him one at a time, each with the trade-off and what could break. He
prefers related changes batched on the fast checks, then one combined GPU
pass.

Read first, relative to the git root:

- `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`: sections 2,
  4, 5.1, 5.4 and 6, then all of 15 (15.1 deferrals, 15.2 acceptances, 15.3
  known limits, 15.7 carry-forward list) and 16 (phase 4 so far).
- `docs/technical/archive/viewport-phase3-baseline-before-cleanup-2026-10-05.md`,
  "Coverage audit" and "Endurance".
- `docs/technical/archive/viewport-phase4-cleanup-inventory-2026-10-05.md`: what
  phase 4 kept because it is still live, and why.

Raw audit rows, one per audited edit with its requests and refusal reasons,
are in the gitignored directory
`codebase/output/performance/review/phase3-baseline-2026-10-05/`:
`coverage-primary-settled.json`, `coverage-four-mask-settled.json`,
`coverage-fifty-local.json`, `audit-final-summary.json`, and
`endurance-30min.json`. The audit driver is
`tests/performance/phase3-coverage-audit.js`.

## What was measured

| ID | Measured on October 5 |
|---|---|
| CF-ROUTE-01 | An Exposure edit after rotation, flip or straighten is refused by the GPU with `dirty-edit-with-stale-geometry` and drawn as a whole CPU picture: three on the four-mask audit, five CPU pictures on fifty-local (two of those are legacy-Denoise Levels rows refused with `superseded-before-proxy`). The audit waits for settled geometry before it edits, so this is not explained by its setup |
| CF-ROUTE-02 | CPU mask requests: 121 on the primary fixture (59 rows), 36 on four-mask, 402 on fifty-local (159 rows), 450 in the 30-minute endurance run. They include 512-edge masks and mask tiles, not only the 3,200-edge fallback that is deferred as P3-FALLBACK-01 |
| CF-ROUTE-03 | The whole native source is fetched when legacy Denoise is enabled and on a few colour rows: 13-14 requests an audit |
| CF-ROUTE-04 | CPU scope requests: nine on fifty-local; six for HDR during switches to SDR in the endurance run |
| CF-ROUTE-05 | 35 HTTP 409 responses in the endurance run; probably superseded work, but the bodies were not captured |

What is not known: the cause of any of these. Nothing below is a diagnosis.
Two things are worth checking early and may be wrong: whether the refusal
reason in CF-ROUTE-01 reflects a real ordering problem between the edit and
the geometry state or a guard that is stricter than it needs to be; and how
many of the CF-ROUTE-02 requests are the known limits already listed in PRD
15.3 (masks that keep the previous route by design) rather than something
new.

## Outcome spec

1. **Explain before changing.** For CF-ROUTE-01 and CF-ROUTE-02, a short
   account for Steve: which edits trigger the CPU work, why, and what the
   user feels (a wait, a soft frame, nothing). For CF-ROUTE-02 the requests
   are sorted into three piles with counts: explained by a deferral or known
   limit in PRD 15.1 / 15.3; explained by something else that is by design;
   and unexplained. Report this before proposing any change.

2. **CF-ROUTE-01 resolved.** A grade edit made after a settled rotation,
   flip, straighten or perspective change is drawn on the GPU, with no CPU
   picture request, on all three fixtures and in both lanes. A genuinely
   stale state (the geometry really has not arrived) is still refused; the
   protection is kept, only the false refusals go.

3. **CF-ROUTE-02 reduced to what is decided.** After the work, the CPU mask
   requests left in the three audits are only those covered by a named
   deferral or known limit, each counted. If removing a pile needs new GPU
   mask work of any size, put the size and risk to Steve first rather than
   starting it.

4. **CF-ROUTE-03, 04 and 05 classified.** Investigate and report cause and
   user impact. Fix only where the cause is established and the fix is
   small; otherwise leave them on the list with what you learned. For 05,
   capture the response bodies so "superseded work" is shown, not assumed.

5. **Shown by the same measurement.** The three coverage audits are repeated
   and compared row for row with the October 5 reports. Report the request
   totals before and after, and anything else that moved. Repeat the fast
   suites, `tests/device-loss-fallback.js`, and the preview-versus-export
   comparison on the fixtures touched. The picture must not change: a state
   that was inside the section 4 limits is still inside them.

6. **A list of what is now removable.** For each route that has stopped
   firing, name the code that only it needed. Do not delete it in this work.
   That list is the input for the next cleanup pass.

7. **A record.** PRD 15.7 updated per item (closed, reduced with counts, or
   unchanged with findings) and a short evidence document under
   `docs/technical/` in the style of the existing ones.

## Constraints

- **The fallback itself stays.** A CPU preview when the GPU is missing or
  lost, and a refusal when state really is stale, are protections. CPU
  export and Proof are the exact reference and are not touched.
- **Decisions already made stand.** P3-FALLBACK-01 is deferred with "do not
  change without Steve". The known limits in PRD 15.3 are not to be removed
  as a side effect; if one turns out to be the bulk of CF-ROUTE-02, say so
  and ask.
- **Nothing in the picture changes.** No tolerance, limit, budget or pinned
  shader changes: the section 4 limits, the two-level soft-mask limit, the
  4,194,304-pixel editing-Peak budget and the Peak and Denoise shader byte
  pins. If a fix seems to need one, stop and ask.
- **One thing at a time.** Other carry-forward items (CF-PIX, CF-PEAK,
  CF-SPEED, CF-DRIFT) are out of scope. If one turns out to share a cause,
  report it; do not fix it here.
- **No deletions.** This work changes routing. Removing the code that
  becomes unused is a separate step Steve approves from the list in item 6.
- GPU checks run one at a time through `tests/run-in-electron.js` (or
  `tests/run-native-electron.js` for drivers that launch the app themselves)
  with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap them.
- Fast checks: `node --test tests/*.test.js` (427 pass) and
  `codebase/.venv/Scripts/python.exe -m pytest tests -q` (1,692 pass, three
  skipped). Use the `.venv` Python.
- Never save over the read-only fixtures; verify their SHA-256 afterwards
  (table in the baseline evidence).
- Source files have mixed line endings and some tests match `\n` literally.
  Preserve each file's existing endings. To compare against a committed
  version, read it with `git cat-file blob`, not `git checkout`.
- Commit locally per validated fix. Ask Steve before pushing. Do not rebuild
  the installer unless he asks.

## Still owed from phase 4, not part of this work

The 16 old-design checks and two test timing races listed at the end of PRD
15.7 are not yet rewritten or retired, and the post-cleanup sweep has not
been run. Leave them alone here unless one of them is the right place to
assert a route fix; say so if it is.

## Questions protocol

Ask Steve before: changing anything covered by a deferral, acceptance or
known limit; starting GPU mask work larger than a routing fix; or anything
that conflicts with what the code or the PRD says. If a fallback turns out
to be protecting against something real, stop and report it.
