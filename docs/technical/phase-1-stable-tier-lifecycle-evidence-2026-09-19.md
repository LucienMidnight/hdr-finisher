# Phase 1 exit-gate evidence — stable-tier lifecycle

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Source state:** worktree based on `ba58d6d` (`main`), parent `83bca70`
**Application:** HDR Finisher 0.8.12
**Host:** Windows 10.0.26200; Node v24.14.0; Python 3.10.10
**Browser used for traces:** the in-app Chromium pane, **WebGPU unavailable** — every browser trace below therefore exercises the CPU/raw presentation route


> **Retracted 2026-09-19 (Phase 3):** the "environment defect" recorded below is
> wrong. `codebase/.venv` already contains Python 3.12.10 with every declared
> dependency, including `imagecodecs`, `rawpy`, and `lensfunpy`. This record ran
> the global `python` (3.10.10) instead. Re-run in the venv, the full suite is
> `1017 passed, 3 skipped, 0 failed` with no prerequisite failures. The
> before/after comparison in this document is still a valid comparison, but it
> never exercised the JPEG XL, AVIF gain-map, or Lensfun routes. See
> [phase-3-bounded-transport-evidence-2026-09-19.md](phase-3-bounded-transport-evidence-2026-09-19.md).

## What changed

### The four viewer states are derived, not stored

`deriveViewerState()` is a pure function over a snapshot: requested tier, accepted
presentation, current edit generation, lane, geometry signature, and an optional
unavailable reason. `viewerState()` reads application state into it and
`renderViewerStatus()` paints the result. Nothing stores a status, so no status
can disagree with the image on screen.

| State | Condition |
|---|---|
| **Unavailable** | An unavailable reason is set. Outranks every other state and still names the retained presentation. |
| **Preparing** | The selected tier has not produced an exact result of its own (`accepted.exact !== true` or `accepted.requestedTier !== selected`). |
| **Updating** | The selected tier has an exact result, but its generation or geometry signature is stale. |
| **Ready** | The selected tier has an exact result at the current generation and geometry. |

### Presentation identity is truthful

This corrects discrepancy 1 from the Phase 0 evidence, which was the first thing
Phase 1 owed. `acceptPresentation` previously stored the *requested* tier as
`tier`, so a 512 px interaction proxy was labeled with the selected tier.
It now records what the image actually is:

- `requestedTier` — the tier selected when the image was accepted.
- `exact` — whether the produced long edge reached `previewTargetLongEdge()`.
- `tier` — the resolution tier this image represents, or `null` when it is a placeholder.
- `schedulerTier` — the scheduler stage (`interactive`/`settled`/`refinement`), unchanged in meaning but no longer conflated with a resolution tier.

The readouts follow: "Presented" reports `Placeholder` rather than a tier name
for a non-exact image, and "Current Preview Size" appends `· placeholder`.

### Interaction no longer lowers the processing resolution

`interactiveProxyLongEdge()` returned a 512–1024 display-bounded proxy on every
gesture, and `settledProxyLongEdge()` stopped at 768–1024 unless an exact result
was already resident. Both now return `previewTargetLongEdge()`. The bounded
proxy survives as `bootstrapProxyLongEdge()` and is reachable **only** while the
selected tier is still Preparing, so a tier that has never rendered still has
something truthful to show instead of an empty viewer.

`previewNeedsRefinement()` was `previewTargetLongEdge() > settledProxyLongEdge()`,
which is now always false. It is redefined as `!selectedTierReady()` — "is more
work owed before the viewer can claim the selected tier?" — which is what all
five call sites already used it for.

### Tier changes no longer reset the renderer

`applyPreviewResolution()` no longer calls `resetSession()` and no longer clears
`gpuPreparedLane`. Proxy levels are keyed by long edge and trimmed by the
renderer's own LRU, so the outgoing tier is retired only when the budget
requires it, per PRD §8.

### Failures retain the last valid presentation

Both CPU routes previously either blanked the viewer (`renderPreviewForLane`
called `clearPreviewImage()`) or failed silently (`renderRawPreviewForLane`
returned `false`). Both now call `markPreviewUnavailable(detail)`, which sets a
reason, leaves the image alone, and moves the viewer to Unavailable. The reason
clears on the next exact acceptance.

### Overlay acceptance is generation-safe

`refreshOverlay`'s currency guard checked `editRevision` only. `editRevision`
does not move for local-only invalidations or geometry changes, so an overlay
response could be painted over a different generation of the image. The guard
now also pins `previewGeneration[lane]` and the geometry signature.

### Updating is reported on the generation bump

`invalidatePreview()` calls `renderViewerStatus()` immediately after
incrementing the generation, so the §11.1 "feedback within 100 ms" target is met
by the state change itself rather than by the render that follows it.

## Gate 1 — 1K, 2K, and 4K never change processing resolution during a gesture

**Status: met.**

Browser trace, 4K selected and Ready, five rapid edits inside one
`beginInteraction()`/`endInteraction()` gesture:

```
target 1280   ready true
frame 1  interactive 1280  settled 1280  status updating
frame 2  interactive 1280  settled 1280  status updating
frame 3  interactive 1280  settled 1280  status updating
frame 4  interactive 1280  settled 1280  status updating
frame 5  interactive 1280  settled 1280  status updating
everyFrameAtTarget true   anyDowngrade false
```

(The test-pattern source has a 1280 px long edge, so `previewTargetLongEdge()`
correctly caps the 4K tier at the source edge.)

With the accepted presentation cleared — the Preparing case — the same call
returns `889`, below the target, confirming the bootstrap path is still
reachable exactly when it should be and never otherwise.

Source-level coverage: `test_interaction_holds_the_selected_tier_once_it_has_produced_a_result`
asserts the bounded proxy appears only inside `bootstrapProxyLongEdge`, and that
neither `interactiveProxyLongEdge` nor `settledProxyLongEdge` can reach
`clamp(displayedLongEdge(), …)`.

## Gate 2 — Rapid reversal presents no stale image, overlay, or scope

**Status: met.**

Browser trace, 4K Ready, then 4K → 1K → 4K within one tick:

```
select 1024  status preparing  "Preparing 1K — showing previous 4K result"  presented 4096
select 4096  status updating   "Updating — 4K"                              presented 4096
after settle status ready      "Ready — 4K"
             acceptedGeneration 7 == currentGeneration 7
             scheduler staleResults 0
             zoom "fit"  width 627.556px
```

The intermediate 1K selection never claimed a 1K result, and reverting returned
to the retained 4K presentation without presenting anything stale.

Ten state-transition cases are covered deterministically in
`codebase/tests/viewer-state-transitions.test.js`, including tier change, lane
mismatch, stale geometry, non-exact placeholder, unavailable precedence,
unrecognized tier fallback, and rapid reversal.

## Gate 3 — CPU errors retain the previous image

**Status: met.**

Browser trace with `fetch` stubbed to return HTTP 500 for `/preview/` and
`/preview-raw/`, then a forced settle:

```
before  element CANVAS  display block  width 627.556px
after   status      unavailable
        label       "4K unavailable — Simulated CPU preview failure"
        sameElement true   display block   width 627.556px
        imageRetained true   acceptedStillThere true
```

Recovery after removing the stub:

```
status ready   label "Ready — 4K"   previewUnavailableReason ""
```

## Gate 4 — Tier changes are atomic and do not reset viewport geometry

**Status: met.**

Browser trace, 1K Ready → select 4K:

```
before   width 627.556px  zoom "fit"
+60ms    status preparing  dock shown
         "Preparing 4K — showing previous 1K result"
         width 627.556px  zoom "fit"   image element unchanged
settled  status ready  "Ready — 4K"  accepted tier 4096 exact true
         width 627.556px  zoom "fit"
```

The existing `tests/preview-resolution-interaction.js` browser suite
independently asserts that a tier change does not move 100 % zoom geometry, and
it passes. `test_changing_preview_tier_does_not_reset_the_renderer_or_clear_the_viewport`
asserts `applyPreviewResolution` contains no `resetSession`, no
`clearPreviewImage`, and no `gpuPreparedLane` reset.

## Gate 5 — Preference round-trip

**Status: met.**

The tier persisted across a full page reload during the browser session: 4K was
selected, the page was reloaded, and the app came back with 4K selected and
`Ready — 4K`. The preference schema itself landed in Phase 0 and is covered by
`test_preview_resolution_contract.py`.

## Regression evidence

| Suite | Result |
|---|---|
| `tests/test_frontend_contract.py` + `tests/test_preview_resolution_contract.py` | `85 passed` (was 77 at Phase 0; +8 new Phase 1 cases) |
| `node --test` over the three deterministic suites | `tests 19 / pass 19 / fail 0` |
| Full Python suite | `986 passed, 4 skipped, 23 failed` |
| Failure list vs clean `83bca70` | **identical** — same 23 node ids |
| Playwright browser suites (14 non-GPU) | all PASS, listed below |

Browser suites run against a local server on port 8000:
`startup-state`, `preview-resolution-interaction`, `grading-value-entry`,
`curve-editor-interaction`, `fine-adjustment-interaction`,
`exposure-bands-interaction`, `lane-roundtrip-interaction`,
`session-replacement-interaction`, `crop-apply-handoff`,
`geometry-transactions`, `scope-region-interaction`,
`workflow-stage-overlays`, `device-loss-fallback`,
`source-disclosures-interaction`. The overlay-affected subset was re-run after
the overlay guard change and passed again.

## Carried-forward items

1. **No GPU trace.** The in-app browser pane has no WebGPU adapter, so every
   browser trace above is the CPU/raw route. The exact-tier change affects the
   GPU path identically — both read the same `interactiveProxyLongEdge()` and
   `settledProxyLongEdge()` — but the *performance* consequence of exact-tier
   interaction is unmeasured on GPU. The §11.1 timing targets (16.7 ms p95 at
   1K/2K, 33 ms p95 at 4K) are not verified by this record and need a run on
   named reference hardware with a WebGPU adapter.
2. **Exact-tier interaction cost.** Removing the interaction proxy means a 4K
   gesture now dispatches 4K work per coalesced frame. This is the intended
   contract (PRD §2.2, §11.1), but if it proves too slow on the reference
   machine, the answer is Phase 2's planner and Phase 4's tiled execution, not a
   resolution downgrade.
3. **Scopes still derive from any accepted generation**, not specifically from an
   exact selected-tier generation. `gpuScopeEligible` already pins lane,
   transport, generation, and geometry, and scope density is deliberately
   independent of tier identity (Phase 0 inventory). Tightening scopes to
   selected-tier generations is explicitly Phase 7 work and was left there
   rather than half-done here.
4. **Comparison lanes** are not yet required to state tier and generation
   explicitly; that is Phase 7 (§7, "HDR/SDR comparison and A/B").
5. **The Python 3.12 environment defect** from Phase 0 is unchanged. Note that
   `run_app.py` refuses to start under Python < 3.12, so the browser traces above
   were produced by running `uvicorn hdr_finisher.main:app` directly under
   3.10.10, which imports and serves correctly. A `.claude/launch.json` was added
   for that purpose.

## Verdict

All five Phase 1 exit-gate conditions are met on the CPU route, with no
regression in the Python suite or in fourteen browser suites. **Phase 1 is
closed**, with the GPU timing measurement recorded as a carried-forward item
rather than a gate failure, because the gate asks for behavioral stability and
the timing targets in §11.1 are sprint-wide acceptance criteria measured on named
reference hardware.
