# Codex Handoff — Stable Exact Full Preview sprint
## HDR Finisher

**Date:** 2026-09-21
**Repo root:** the `ai/` directory under `D:\AI\AI Projects\HDR Finisher Tool`
— **not** the enclosing folder, which contains a stray `.git` holding only
`info/`.
**Branch:** `main`, 60 commits ahead of `origin/main`, nothing pushed. The
continuation work summarized below is present in the working tree and has not
been committed.

---

## Where the sprint is

Phases 0 through 8 are complete with their exit gates closed. **Phase 9 was
descoped today** — the test machine has no discrete graphics card, so its
configuration matrix and physical display sign-off moved to project PRD
section 11c as a release-readiness note.

Read these before starting:

| Document | What it holds |
|---|---|
| `docs/product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md` | Section 12 phase ledger, "Current handoff checkpoint", global gates in section 11 |
| `docs/product/HDR_Finisher_PRD_v1.2.md` | Sections 11a (DENOISE-01), 11b (PERF-03/04/05/07), 11c (deferred hardware validation) |
| `docs/product/Next_Sprint_Minor_Bug_Backlog.md` | MINOR-10 (done), MINOR-11 (done), MINOR-12 (resolved in the continuation below) |

Phase 8 closed today with two recorded deviations and one waived condition —
progressive disclosure shipped without renaming Amount to Strength, Recalculate
stayed outside the Custom block, and Denoise corpus acceptance was **waived
rather than passed**. The reasoning is in the Phase 8 ledger row. Don't
re-litigate those; they were Director decisions.

### Continuation outcome — later on 2026-09-21

The implementation items handed off below are now resolved, one reported
symptom was not reproduced with a corrected harness, and all are covered by
[`sprint-wrap-evidence-2026-09-21.md`](../technical/sprint-wrap-evidence-2026-09-21.md):

- bounded CPU presentations return the exact accepted-frame scope peak;
- compositor screenshots stayed painted across Full-tier replacement; the
  earlier black-frame result was a WebGPU `drawImage` readback artifact, so no
  speculative continuity workaround ships and PERF-07 remains unconfirmed;
- guaranteed-tiled interactive drafts are declined before dispatch;
- the shared exact-peak readback fault reproduced and was replaced with a
  bounded two-target pool;
- a CPU strip refusal now completes, rather than strands, a geometry handoff;
- the synthetic Bloom Highlight Detail edge case now has matching CPU/WebGPU
  edge protection and a confirmed negative control, but the Director's real
  4K/Full dark/bright/cyan edge report was unchanged in the corrected package
  and remains open. Package/source hashes and running process paths rule out a
  stale Electron build; investigate another film or display-sampling stage.

The historical observations below are retained because their failed runs and
withdrawn hypotheses are part of the evidence trail. Where later measurement
confirmed or superseded them, the continuation evidence is authoritative.

---

## How this project works — read this first

This matters more than any individual task below, and it is not inferable
from the code.

**Every test gets a negative control.** Revert the fix, confirm the test
fails, restore. A test that has not been *seen* to fail is not evidence and
gets discarded. Four tests were thrown away over the last two days for
passing against a reverted fix — two denoise tests, and two of my own
negative controls that turned out to revert nothing.

**Measure before diagnosing.** This sprint has produced several confident,
plausible, wrong diagnoses. Attach to the running app and read real numbers
before forming a theory. Where a cause is unconfirmed, the documents say so
explicitly — preserve that honesty rather than tidying it into certainty.

**Don't ship unverified changes in the settle path** (`settlePreview` in
`frontend/app.js`). An earlier attempt there hung the viewer entirely,
confirmed by a 900-second test timeout.

Both PRDs record failures and withdrawn claims alongside successes. That is
deliberate. When something you were told turns out to be wrong, correct the
document rather than working around it.

---

## Environment

```
Backend (browser tests default to 8765 and expect it already running):
  cd ai/codebase
  .venv/Scripts/python.exe -m uvicorn hdr_finisher.main:app --host 127.0.0.1 --port 8765 --app-dir backend

Deterministic suite:  cd ai/codebase && .venv/Scripts/python.exe -m pytest tests -q
Browser suites:       npm scripts in ai/codebase/package.json
Desktop suites:       npm scripts in ai/codebase/desktop/package.json
Electron manually:    cd ai/codebase/desktop && npx electron . --remote-debugging-port=9222
```

Current state: **pytest 1290 passed, 3 skipped**. Desktop unit 18/18. The
packaging build (`npm run pack:dir` in `desktop/`) succeeds.

Three practical traps, all of which cost time today:

- **Electron enforces a single instance.** A stray window makes every
  desktop test die instantly with `ECONNRESET` at launch. Kill leftover
  `electron.exe` processes before running the desktop suite.
- **Some tests hang instead of failing.** `highlight-lane-4k` throws and then
  never closes Electron, so the node process never exits. Run desktop tests
  under a timeout.
- **Don't run several Electron/GPU suites concurrently.** They contend for
  the GPU and produce failures that are pure artefacts.

Test sources: `tests/large-noisy-tiff.js` generates a dependency-free noisy
TIFF at any size. Use 7968x5320 to force the tiled route — 4200px renders
Full on Direct on this GPU and silently skips the tiled path.

---

## Work remaining, in the Director's priority order

### 1. Scope peak on the CPU route

**What should be true:** the peak a tiled presentation reports is the peak of
the pixels it actually presented, at native resolution.

**What is true now:** Phase 7 made the peak an exact native-resolution
maximum on the GPU scope route, which is what a Direct presentation uses. A
**tiled** presentation settles through the CPU scope route, where the peak is
still the proxy's.

**Why it matters:** before Phase 7 fixed the GPU side, the three scope
profiles were under-reporting the peak by 13.6%, 11.3% and 5.0% on a 42 MP
frame — always low, which is the direction that tells a user a delivery sits
inside its ceiling when it does not. The same class of error is still present
on the tiled path.

Recorded as item 3 under "Next safe edits" in the sprint PRD's handoff
checkpoint. Item 4 there — tile-wise accumulation of the scope *distributions*
— is related but separate, and nothing about the peak depends on it.

**Confidence:** high. This is a known, deliberately-deferred gap, not a
diagnosis.

---

### 2. PERF-07 — the viewer goes blank on a tier change

**Symptom:** switch the preview tier to Full and the viewer goes black. On a
cold Full proxy it stays black for about eight seconds. Reported from manual
testing as "the first time I dragged the slider I got a black frame", clean
on every drag afterwards.

**What should be true:** the previously presented frame stays on screen until
a new one can replace it. Global gate 11.1 requires Full to remain "visibly
progressing"; a canvas that is black for an entire render is not.

**Corrected harness:** `npm run test:tier-change-blank`
(`tests/performance/tier-change-blank-canvas.js`) samples clipped page
screenshots across the tier change. The earlier implementation used
`drawImage` on the WebGPU canvas; Chromium returned zeroes even while the page
compositor displayed the frame, producing a false black result. The corrected
run measured 4/4 painted samples and zero blank samples on a 4K-to-Full
transition.

**Status: not reproduced, cause unconfirmed.** A retained 2D overlay and a
dual-WebGPU-canvas implementation were evaluated and removed because the
corrected harness passed without them. Keep PERF-07 in the manual matrix,
particularly for a cold Full proxy and other GPU configurations. Do not ship a
canvas-lifecycle change unless a compositor-level negative control first
reproduces the visible blank.

**Scope boundary:** the tiled encoder carries the byte-exact Direct/Tiled
parity gates from Phases 4 through 7. Run `test:tiled-parity`,
`test:tiled-film-parity`, `test:full-tier-denoise` and
`tests/tiled-cpu-detail-parity.js` before and after any change to it. The
clear that `loadOp` performs on the first tile is also protecting against
stale pixels surviving outside a new frame when geometry changes — don't
simply remove it.

---

### 3. PERF-06 — interactive drafts at Full do work that is always thrown away

**What should be true:** at Full, a draft the tiled encoder is going to refuse
outright is not dispatched at all.

**What is true now:** the tiled encoder refuses every interactive-tier render
(`tiled-refused:interactive render`) — but only after the draft has fetched a
proxy, built masks and measured a highlight peak, and only after
`renderGpuDraftInner` has taken the supersession token. Measured at roughly
37 to 41 such drafts per tone drag, each doing real work and discarding it.

This is the "laggy but consistent" feel the Director reports at Full. Full has
no interactive feedback by design, so what the user perceives is the viewer
holding the last settled frame while that waste runs.

It is also the engine of PERF-03: those refused drafts are what invalidated
the settled render in flight. PERF-03 is fixed at the settle path
(`supersededByScheduledWork`), so this is now an efficiency issue rather than
a correctness one.

**Direction:** declining before dispatch needs a cheap predicate for "this
tier will tile". `admitDirect()` in `frontend/webgpu-preview.js` could supply
it, but the accurate call needs halo and graph-activity inputs that are
currently derived inside `render()`. **The risk to weigh:** a predicate that
says "tiled" when the real plan would have said "direct" would suppress a
useful interactive frame and make a drag feel worse, not better. Getting that
wrong is worse than the waste.

**Harness:** `npm run test:full-tier-tone-cost` reports the refusal histogram
per tier and asserts no CPU fallback. Extend it rather than writing a new one.

---

### 4. MINOR-12 — applying a straighten strands the geometry handoff with no GPU

**Symptom:** with WebGPU unavailable, applying a straighten leaves
`state.geometryTransformHandoffSignature` set permanently.
`tests/electron-smoke.js` times out at line 563, thirty seconds after the
`straighten slider cancellation` checkpoint.

**This is pre-existing, and verified so twice**: identical with the PERF-03
guard neutralised, and identical on baseline `d909b7a` carrying only the
MINOR-11 fix — which is the smallest change that lets the suite reach line
563 at all. It was invisible until today because the suite died eighty lines
earlier on the Help bug.

**What is known:** the bounded CPU strip path refuses roll geometry by design
(`cpu_strips.py`) — `Image.rotate(expand=True)` materialises the whole rotated
frame, so a windowed roll is exact but not bounded, which is the property that
path sells. With no GPU and Full selected, that surfaces as **"Full
unavailable — Bounded strip execution refused this graph. roll geometry."**

**Resolved later on 2026-09-21:** the hypothesis was confirmed. The refusal
prevents the matching accepted presentation that normally owns handoff cleanup.
Unavailable now completes the matching handoff, removes the temporary
transform, retains the last valid frame, and leaves tier selection/editing
usable. The unchanged Electron smoke assertion reached its formerly failing
checkpoint.

**Why it may outrank PERF-06:** CPU-only is one of the three configurations
Phase 9 was meant to validate and 11c now defers. On such a machine, Full plus
any rotation is not slow — it is unavailable, and the geometry edit never
completes. The same refusal list covers denoise, spatial film effects, matched
SDR and post-geometry downsample, so the exposure is wider than straighten
alone. Ask the Director whether this jumps the queue.

---

### 5. Phase 9 leftovers that are not hardware-blocked

Descoping the phase must not descope these. All four are doable on this
machine:

- Endurance across repeated edits, tier changes, source changes, HDR/SDR
  switching, comparison, overlays, undo/redo, proof and export. Device-loss
  recovery is already covered by `test:device-loss`, which passes.
- Application-preference migration and recovery.
- Publishing the final performance, memory, parity and known-limit evidence.
- Updating user-facing help for preview tiers, GPU budget, CPU expectations
  and status meanings. **Blocked behind MINOR-11 until today** — Help now
  loads, so this is unblocked.

---

## Also open, lower priority

- **Spatial film effects on the CPU strip path** still refuse, so a CPU Full
  with halation falls back to whole-frame CPU: exact, but not bounded, which
  is a Phase 4 promise. Handoff checkpoint item 5.
- **The resolved denoise proxy is still whole-frame** (Phase 6 note, memory).
- **`test:local-design`** fails on a disabled `linear_gradient` tool button —
  fails at baseline too, undiagnosed. Note the Phase 7-8 evidence document
  wrongly attributes the *toggle* failure to this suite; that was
  `ui-refinement-detail-qa`, and it is fixed.
- **`denoise-selector-seam`** fails at baseline as well as at HEAD.
  Environmental as far as it was investigated, not confirmed.
- **`HDRFinisherPerformance` hooks call `Number(longEdge)`** with no
  validation, so the `"full"` sentinel yields `NaN`. Phase 0 discrepancy 3,
  two-line fix.
- **PERF-02 is referenced** in the sprint PRD's QA section but **defined
  nowhere**. Either it was lost or the reference is wrong.
- **PERF-05 subsequently reproduced** when an exact-peak measurement overlapped
  tiled presentation: WebGPU rejected a submit because the singleton readback
  buffer was pending map. It now uses a bounded two-target pool with
  `busy`/`mapState` guards and omits the optional measurement under further
  backpressure. `npm run test:full-tier-instrumented-tiling` then completed
  8/8 tiled renders and three forced overlaps without a device error.

---

## Constraints

- Don't re-litigate the Phase 8 decisions: Amount keeps its name, Recalculate
  stays outside Custom, the corpus condition is waived not passed, and the
  export-exact label is applied on the parity measurement.
- Don't weaken the selected-tier contract. Exactness is a fact about the
  resolution a frame was *processed* at, and the test is equality — a frame
  processed above the selected tier is not that tier either.
- Don't claim a gate is met without evidence in the repository. The ledger
  exists to prevent exactly that, and it records descoped and withdrawn
  claims as carefully as met ones.
- Don't remove or soften the "unconfirmed" language in PERF-07 or MINOR-12
  unless you have actually confirmed the cause.

## Questions protocol

If anything here conflicts with what you find in the code, believe the code
and say so. Several statements in these documents have already been corrected
this way — the PERF-07 cause was withdrawn after measurement contradicted it,
and the claim that no Electron suite existed was simply wrong. Correcting the
record is the expected outcome, not a failure of the brief.
