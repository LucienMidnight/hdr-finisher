# Codex Brief: Speed up Global HSL and the Local hue mask
## HDR Finisher

**Date:** October 27, 2026
**Repository:** `D:\AI\AI Projects\HDR Finisher Tool\ai` (code in `codebase`)

Read `D:\AI\AI Projects\HDR Finisher Tool\ai\AGENTS.md` first and follow it: testing scale, "Still strict" for export and Proof, tolerances, line endings (use `git cat-file blob`, never `git checkout`), and plain-language reporting to Steve.

**Another agent is working in this same checkout at the same time.** Claude is replacing Lift/Gamma/Gain with tone sliders (`docs/technical/briefs/codex-brief-tone-zones-2026-10-27.md`). It touches the tone code: `adjustments.py` tone and primaries functions, `models.py` tone fields, `sdr_match.py`, `library_paste.py`, tone parts of `webgpu-shaders.js`, `gpu-params.js`, `gpu-param-layout.js`, `range-controls.js`, `app-state.js` and the Tone panel in `index.html`.
- Stay out of tone code.
- Commit only files you changed (`git add <file>`, never `git add -A`).
- If a test fails inside tone code, treat it as Claude's and carry on.
- If you need a GPU param slot, say so in your report rather than renumbering the layout.

## What's wrong

Steve loves the new Edge, Feather and Edge detail controls, but says performance is now "awful" when using Global HSL and the Local hue mask. He did not say which actions are slow, so measure them all.

## Earlier numbers to compare against

These were measured on copied 24 MP and 42 MP photos, SDR, before the edge controls existed (commit 4d3757d and earlier; see `docs/product/modules/grade.md`):

| Action | Earlier result |
| --- | --- |
| Global HSL range change at Fit | 0.03 s |
| Global HSL range change at 100% | 0.05–0.06 s |
| Dragging Global HSL Luminance | 27–28 frames/s |
| Local hue range change at Fit | 0.04–0.05 s |
| Local hue range change at 100% | 0.13–0.17 s |
| Dragging Local Exposure with a hue mask | about 31 frames/s |

## Goal

Make HSL editing feel live again, with Edge, Feather and Edge detail in use. Pictures must not change: the selection stays the same within its existing GPU/CPU coverage tolerance.

## What to do

1. **Measure first, before changing anything.** Use copies of Balanced Rock and a 42 MP photo, in SDR and HDR, at Fit, 100% and about 400%. Cover:
   - dragging Range, Edge, Feather and Edge detail;
   - dragging HSL Luminance and an unrelated slider (Exposure) while HSL is active;
   - panning and zooming;
   - the same actions for a Local hue mask, including Show mask.

   Run each with the edge controls at default and at non-default values (for example Edge +3, Feather 8). Compare against the earlier numbers above, and against the same build with the edge controls at default. That shows whether the slowdown comes from the edge controls or from something else.
2. **Report where the time goes in plain words.** Examples: the edge passes, the selection being rebuilt when it should be reused, tiles redoing work, the larger halo, Show selection, or the CPU overlay. Then fix the biggest causes.
3. **Before measuring, propose tolerances,** as AGENTS.md "Work within tolerances" requires. A reasonable starting point:
   - with defaults, within 10% of the earlier numbers;
   - with non-default edge values, sliders stay live (about 24 frames/s or better) at Fit and 100% on 24 MP.
   Record what you choose in the Grade PRD.
4. Steve's GPU has intermittent bad VRAM. Rerun a GPU failure once before blaming code.

## Constraints

- No visible change to the pictures, Show selection or Show mask. No change to export or Proof output beyond the existing tolerances. The Highlight compression ceiling stays exact.
- Do not reduce quality to gain speed (for example a coarser selection, or skipping the edge controls in preview but not in export) without asking Steve first. Present it as a choice with the trade-off.
- GPU first, with the CPU as fallback. Use all cores for CPU work.
- Commit locally in small commits. Do not push.

## Checks

- Fast checks.
- `node tests/hsl-selection-engine.js` (run natively).
- `tools/hsl-seam-repro.js` with non-default edge values: no tile lines.
- **If GPU code paths that affect pixels change:** run `tests/hsl-selection-delivery.js` (plus `--local`) and `tests/hue-mask-delivery.js`. Ask first if the slow tests would go over about 30 minutes.
- **The open "stale literal PARAM_COUNT assertion" failure** from the edge-controls work:
  - If the edge-controls work caused it, fix it.
  - If it comes from the tone work, leave it.
- A timing driver or tool for the measurements above, registered in `codebase/tests/release/drivers.json` if it is a driver.

## Report

Tell Steve in plain language:
- what was slow and why;
- before-and-after timings for the actions he uses;
- anything still slow;
- any quality-for-speed choice he needs to make, one at a time.

Update `docs/product/modules/grade.md`.

## Outcome - October 28, 2026

Measured first; built exact drag pacing and regional Local hue selection without
reducing quality. Completed-frame rates and edit timings improved substantially,
especially at 400%. Native 100% remains below the proposed 24 frames/s target;
remaining selection/cache work and the Local Show mask navigation regression
are recorded under Open work in `docs/product/modules/grade.md`. The same module
contains before/after timings, checks and known unrelated failures. Steve approved
the longer GPU/export/Proof checks; they pass existing picture tolerances.
Balanced Rock was 18 MP, so an additional true 24 MP pair was measured too.
Four small local commits; no push and no tone code changes.
