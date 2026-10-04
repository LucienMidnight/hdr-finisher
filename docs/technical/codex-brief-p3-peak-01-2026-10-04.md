# Codex Brief — Editing-time Peak with Clarity (P3-PEAK-01)
## HDR Finisher, Viewport-Bounded GPU Preview

**Date:** 2026-10-04

## Goal

While editing, the Peak the app reports and the highlight roll-off the preview draws should agree with export when Clarity is in use, globally or in a local adjustment, on a 42 MP image. Today they do not: the editing-time measurement cannot be completed inside its pixel budget, the preview falls back to a lower figure, and the brightest pixels are drawn differently from the export. This brief asks for a proposal first, then the work once Steve has approved it.

## Why a proposal comes first

The Peak and automatic highlight-anchor design is Steve's and is the product's differentiator. PRD section 5.3 requires the implementer to read that design and propose how the editing-time measurement can be bounded before changing anything. Steve is the owner, not a coder: write the proposal in plain language, with the trade-offs and what could break, and ask one decision at a time.

## Context

- Workspace `D:\AI\AI Projects\HDR Finisher Tool`; git root `ai`; run tests from `ai\codebase`; branch `viewport-bounded-preview-phase-2-wip`. Check HEAD and status first; do not reset. Latest local commits are `cf15236` and `66eb873` (not pushed).
- Read first, relative to the git root: `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md` sections 2, 4.1, 4.3, 5.3, 14.9, 14.11, 14.17, 14.23, 14.25 and 15; `docs/technical/viewport-phase3-texture-peak-evidence-2026-10-02.md`.
- Related open items in section 15: P3-PEAK-02 (maximum Sharpen: the measurement finishes in budget but misses the patch holding export's maximum) and the automatic-anchor redesign (its re-measure is why a Fit edit takes about 1.0-1.6 s to settle). Say in the proposal whether your approach also resolves these, or leaves them.

## What is known

| Case | Editing Peak | Export Peak | Result |
|---|---|---|---|
| Four-mask fixture, global Clarity 100, radius 3% (14.9) | 2,989 nit | 3,703 nit | 19.3% low. The bounded measurement refused 89,870,400 pixels against the 4,194,304-pixel budget |
| `Denoise-stuck-DSC04761.hdrfinisher` as saved: a brush local with Clarity 29, radius 0.75% (14.25) | 796 nit | 905 nit | 12% low. Picture differs from export by up to 6.3% luminance and 0.032 OKLab on about 3,300 specular pixels in one region |
| Same project, that local's Clarity set to 0 | 931 nit | 905 nit | 2.9% high; picture inside every limit |
| Same project, brush local off | 903 nit | 905 nit | inside 1%; picture inside every limit |
| Same project as saved, highlight compression off | — | — | picture inside every limit (worst 2.7%, OKLab 0.005) |

Measured: the picture gap follows the highlight roll-off, and it appears exactly when the preview has no bounded editing Peak for the current edit state.

Not measured, treat as a hypothesis: that the local-Clarity case fails for the same reason as 14.9 (Clarity's reach makes the patches the measurement needs exceed the budget). In the saved-project runs the comparison tool only saw that no bounded figure existed and that the scope panel's figure was shown instead. Confirm the actual reason before designing around it.

Also unexplained and worth a look while you are there: with that local's Clarity at 0 the bounded figure is 2.9% high, outside the 1% requirement, although the picture passes.

## Outcome spec

When this is done:

1. With global or local Clarity at any radius, on a 42 MP image, the editing-time Peak is within 1% of the export's exact Peak (section 4.3), or the app says plainly that the figure is approximate. It must never show a lower-bound figure under the label it reserves for a measured Peak.
2. The preview's highlight roll-off is driven by a figure good enough that the picture at 100% is inside section 4.1 against export on both cases in the table above.
3. The measurement stays bounded while editing: it must not force whole-image full-resolution masks or a whole-frame CPU render, and it must not make a Fit edit settle more slowly than it does now (about 1.0-1.6 s; faster is welcome).
4. Export and full-size Proof still measure exactly and are byte-identical to each other.
5. Cases that pass today still pass: the primary and four-mask fixtures as saved, and the picture checks recorded in 14.9 and 14.11.

How to get there is yours to propose. If the honest answer is that 1% cannot be met inside the current budget, say so with numbers and lay out the options (for example a larger or different budget, a different way of bounding Clarity's reach for measurement only, a disclosed approximation) so Steve can choose.

## Constraints

- Do not change the 1% editing limit, the section 4.1 limits, or the 4,194,304-pixel budget without Steve's explicit decision. Changing any of them is an option to present, not to take.
- The peak-reduction shader is byte-pinned. If your approach needs to change it, that is a decision for Steve; ask first.
- Export and Proof stay the exact CPU reference. No new CPU machinery for the preview: interactive work belongs on the GPU.
- Do not change Detail, mask or Denoise arithmetic to make this pass; the 14.25 isolation showed they are not the cause.
- Keep the deferrals and acceptances in section 15 as they are, other than the items this work closes.
- Never save over the fixtures. Verify their SHA-256 after GPU runs (hashes are in `docs/technical/viewport-phase3-post-testing-next-thread-prompt-2026-10-03.md`; the saved photo's is `2dd3ef64d3b4127d5e793c6664b12075d4e203e19a746d55b92e317bf23daf86`).
- Commit locally when a change is validated; ask before pushing. No installer rebuild unless asked.

## How Steve wants the work run

- Batch changes and build on the fast checks first: `node --test tests/*.test.js` (427 pass) and `.venv/Scripts/python.exe -m pytest tests -q` (1,692 pass, 3 skipped; use the venv Python).
- Then run the slow GPU checks once, one at a time, through `tests/run-in-electron.js` with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap GPU tests.
- Write patch scripts as files rather than shell heredocs. Keep edited source files LF: this repo has `core.autocrlf=true`, and a `git checkout` or `git stash` of a file rewrites it as CRLF, which breaks the shader byte-pin test.
- Report what did not meet target rather than rounding it up.

## Reproducing the two cases

From `ai\codebase`. The first reproduces the saved-photo gap; the second shows it is the roll-off.

```
node tests/run-in-electron.js tests/performance/preview-export-compare.js --project "D:/Photos/HDR Test Images/Denoise-stuck-DSC04761.hdrfinisher" --lanes hdr --regions center:0.5:0.5,lower-right:0.75:0.75 --output output/performance/review/peak-01/saved.json
```

```
node tests/run-in-electron.js tests/performance/preview-export-compare.js --project "D:/Photos/HDR Test Images/Denoise-stuck-DSC04761.hdrfinisher" --lanes hdr --regions center:0.5:0.5,lower-right:0.75:0.75 --set hdr.highlight_compression_mode=off --output output/performance/review/peak-01/compression-off.json
```

`--disable-locals 1` switches off the brush local; `--local-type brush --local-set detail.clarity_amount=0` zeroes its Clarity. Each report's `peak` block gives the editing and export figures and which source the editing figure came from. Existing evidence is under `output/performance/review/local-isolation-2026-10-04/`. The 14.9 case is described in the Texture and peak evidence document. Existing Peak drivers and tests: `tests/performance/editing-peak-diagnostic.js`, `peak-readout-review.js`, `highlight-anchor-stability.js`, `tests/editing-peak-bounded.js`, `tests/test_peak_accuracy.py`.

## Deliver, in this order

1. **Findings and proposal, no product code changed.** Why the bounded measurement is unavailable in each case (confirmed, not assumed); the options with their cost in accuracy, speed, memory and risk; your recommendation; and the decisions Steve needs to make.
2. **After Steve approves:** the change, with before and after figures for every row of the table above, the Fit-edit settle time, the fast suites, the relevant GPU drivers, and fixture hashes.
3. **Records:** update PRD section 15 for the items this closes or changes, and add a short dated section to section 14.

## Questions protocol

If anything here conflicts with the code or with the PRD, say so and ask before implementing. Do not widen a limit, raise a budget, or invent a new measurement path without checking first.
