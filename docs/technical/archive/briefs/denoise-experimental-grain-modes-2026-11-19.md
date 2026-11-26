# Codex Brief: Experimental Fine Grain and Clean Grain Denoise

**Date:** November 19, 2026
**Branch:** start from `feat/denoise-v1` (round 5 merged at `ac38a25f`).
**Owner:** Steve (not a coder). Report in plain language.
**Outcome:** Built for testing. Both defaults matched the full Canon and Sony
research references exactly on the CPU. Grade uses WebGPU, and export and
Proof retain their CPU fallback. See the Grade module and performance table
for the remaining corpus fixture and MacBook Neo timings.

## Goal

Steve wants to try the two promising research methods in the real app, with
controls, so he can find their limits and use cases on his own photos. Add
them to the existing Grade **Denoise** group as experimental methods next to
the current one. The AI method is tabled for v2 and is not part of this brief.

## Method names (Steve, November 19, 2026)

Names describe the result, not the technique.

| Name in the app | What it is | Research source |
| --- | --- | --- |
| **Standard** | Today's Denoise (`adaptive-atrous-v1`), unchanged. | shipping code |
| **Fine Grain** (Experimental) | Standard, with the brightness keep factor averaged over a neighbourhood so colour noise goes and the leftover grain is even and fine. | "Even keep brightness 18 px", grain-matched (round 4 row 5 / round 5 row 4) |
| **Clean Grain** (Experimental) | Fine Grain, then colour splotch removal relative to the surroundings, then dark speck repair from nearby matching patches. | round 5 row 11 (row 8 + nearby patch healing) |
| **AI** | Tabled for v2. Do not add it to the UI. | — |

Research code: `codebase/tools/denoise_eval/candidates/even_keep_round4.py`
(`resolve`, `calibrate_brightness`) and
`codebase/tools/denoise_eval/candidates/speck_round5.py` (`relative_colour`
with `broad=True`, `patch_heal`). Report:
`docs/technical/research/denoise-v1-2026-11-16/round5-relative-colour-and-patch.md`.
Port the behaviour; the research code is a reference, not production code.

## Outcome spec

### Choosing a method

- The Denoise group gets a method choice: Standard, Fine Grain, Clean Grain.
  Fine Grain and Clean Grain are visibly marked Experimental. Use an existing
  component from the component sheet; no new tokens.
- Standard is the default for new photos. Existing saved grades open as
  Standard and look exactly as before.
- The choice and every new control are saved with the grade, copied by
  copy/paste and presets like the other Denoise controls, and reset by
  **Reset**/**Default**.

### Controls

All of Standard's controls stay and keep working in all three methods
(Amount, Detail Recovery, Luminance, Color Noise, the four noise sizes).
Add these. Defaults must reproduce the research result Steve approved:

| Method | Control | What it does for the user | Default |
| --- | --- | --- | --- |
| Fine Grain, Clean Grain | **Grain Evenness** | How evenly the remaining brightness grain is spread. 0% gives Standard's result. | the 18 px grain-matched setting |
| Clean Grain | **Color Splotches** | How strongly coloured blobs (green/magenta, blue/red) are pulled toward the colour around them. 0% is off. | round 5 row 8's strength |
| Clean Grain | **Splotch Size** | Small (about 12 px reach only) or Large (adds the 28 px reach). | Large |
| Clean Grain | **Dark Specks** | How strongly dark pits and clumps are filled from matching nearby patches. 0% is off. | round 5 row 11's healing |

Codex may propose a better slider mapping or one more control if a research
parameter clearly matters to the result; say why in the report. Keep the
number of new controls small: Steve is testing outcomes, not tuning internals.

Tooltip text for every new control goes into the source and
`docs/product/tooltips.md` (regenerate with the catalogue tool).

### Preview, Show noise, export

- Same behaviour as Standard: the photo is measured once, sliders update the
  picture while dragging, the status line reports Preparing/Ready/Dirty, and
  **Recalculate Denoise** works. If a heavy step (patch search) cannot run
  live, compute it once per measurement and make its slider a live blend;
  any recompute after release must show its status. Measure the wait the
  user feels on the MacBook Neo and report it.
- **Show noise** shows what each method removes.
- Export and Proof deliver the same picture as the preview, within the
  existing Denoise agreement (finished SDR ΔE2000 and HDR ΔE ITP mean < 1,
  p99 < 3), and HDR output still never exceeds the highlight compression
  target.
- GPU or CPU per "Speed where it is felt; the GPU where it pays" in
  AGENTS.md. The CPU must work as the fallback. Fine Grain changes the
  existing resolve, so its GPU route is expected; for the colour and patch
  steps, choose the cheapest route that keeps sliders live. Report times at
  18 MP and 42 MP.

### Pipeline place

Same place as Standard Denoise. Signed RAW development and Pixel cleanup
("Even out harsh specks") stay as they are; the research results were
measured with harsh specks at 2.5 on, so say in the user guide that the new
methods work best with it on.

## Constraints

- **Standard is unchanged.** Existing grades, the Standard preview and
  Standard export pixels must not change. This is a strict area (export and
  Proof output): run every check that covers it.
- Memory: the MacBook Neo (8 GB) is the minimum machine. New caches or
  buffers follow `docs/product/modules/memory-and-caches.md`; a size change
  is Steve's decision. One GPU job at a time through
  `codebase/tools/gpu-run-lock.py`.
- No per-camera tuning, defect maps or calibration captures. No TAU
  bm3d/bm4d packages. The old neighbour-similarity "pattern" veto must not
  be used to block repairs.
- Detail protections are deliberately off at this stage (Steve,
  November 18): do not add edge/hair/flame protection to hide the known
  side effects. Steve wants to see the real limits first.
- Design tokens only; match the component sheet.
- Never save over the read-only test projects. Photos only from
  `<photosRoot>/HDR Test Images`. Run `tools/output_size.py` at start and end.
- Commit in small commits on your branch. Do not push.

## Testing

Follow "How much to test" in AGENTS.md: fast suites, plus the Denoise GPU
checks that cover this (`denoise-adaptive-parity.js`,
`gpu-denoise-measurement.js`, `gpu-delivery-smoke.js`, extended to the new
methods), plus result tests (pixels/numbers) for: Standard unchanged,
Evenness 0% equals Standard, defaults reproduce the research rows within a
small stated tolerance, saved grade round trip, and CPU/GPU agreement. Add
any new driver to `codebase/tests/release/drivers.json`. If validation would
pass about 30 minutes of slow tests, stop and ask.

## Documents

Update in the same work: `docs/user-guide/denoise.md` (the three methods,
the new controls, the known side effects: pink-orange rims on bright
coloured edges, softer faces, lashes and fine dark hair), the Grade module
PRD (decision and current state), `docs/technical/denoising.md`,
`docs/technical/performance-table.md` (MacBook Neo rows),
`docs/product/tooltips.md`, and the AGENTS.md documentation map.

## Report back

In plain language: what Steve will see in the Denoise group, how to test
each method, wait times on the MacBook for preview and export, what was run
and what failed, and anything that differs from the research results.

## Questions protocol

November 19 implementation decision. Grade preview and Show noise keep
Standard's WebGPU requirement. Export and Proof keep the CPU fallback.
Prepare the whole-photo gain fit before resolving and allow a longer
Preparing/Recalculating state for the experimental modes. Color Splotches
and Dark Specks blend live after preparation. Grain Evenness may prepare
again on release.

For reference comparisons on signed float32 scene data, use absolute
tolerance 0.000002 and relative tolerance 0.00001. This allows float32
rounding when filtering a tile with different dimensions. Standard and
zero-evenness Fine Grain must be bit-identical. Finished HDR/SDR use the
perceptual limits above. The new MacBook times are baselines, with a 5%
run-to-run band when repeating the same action on the same machine.

If this brief conflicts with the existing code (for example the Denoise
controls schema or the GPU resolve layout makes a requirement expensive),
stop and report the conflict with options instead of inventing a new
pattern.
