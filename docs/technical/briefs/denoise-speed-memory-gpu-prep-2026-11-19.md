# Codex Brief: Denoise speed, memory fix and GPU preparation trial

**Date:** November 19, 2026
**Branch:** start from `feat/denoise-v1` (baseline merged at `184ccd3b`).
**Owner:** Steve (not a coder). Report in plain language.
**Builds on:** `docs/technical/archive/briefs/denoise-harsh-specks-baseline-speed-2026-11-19.md`
and the ranked speed plan in `docs/product/modules/grade.md`.

## Steve's decision (November 19)

Steve approved the next stage: build the memory fix and speed item 2, and
test running the Fine Grain and Clean Grain preparation on the graphics
card. He will test the app tonight, so the work must leave a runnable app
on the branch.

The wait Steve feels is the first preparation: about 11–14 s on the Canon
and 31–39 s on the Sony after turning on Fine Grain or Clean Grain, or
after zooming to 110%. The CPU items 2–4 do not shorten that wait much.
Standard Denoise already runs on the GPU and takes 1.6–2.7 s.

## Goal

1. The app stays inside the 4 GB whole-app ceiling on the MacBook Neo
   when zooming and exporting with Denoise on.
2. Switching from Fine Grain to Clean Grain reuses the Fine Grain work.
3. A measured answer to: can the Fine Grain and Clean Grain preparation
   run on the GPU fast enough to halve the first wait, while looking the
   same as the baseline? If yes, ship it as the preview route with the
   CPU as fallback. If no, stop and report.

Everything that ships must match the baseline under the rule already in
the Grade PRD: finished SDR ΔE2000 and HDR ΔE ITP mean < 1 and p99 < 3
against the reference crops from `codebase/tools/denoise_eval/speed_baseline.py`,
and no drop in the marked colour and pit counts per method and photo.

## Part 1: memory inside 4 GB (speed plan item 1)

**Outcome:**
- Sony and Canon zoom (Fit → 100% → 110% → Fit) with each of the three
  methods peaks below 4 GB whole-app memory.
- Full-size JPEG Ultra HDR export and Proof of the Sony with each method
  stays below 4 GB. Standard already overran (4.76 GB Canon, 6.82 GB Sony
  CPU fallback), so this is not only a new-method problem.
- The picture never goes blank or flashes an old zoom level during the
  change. The last complete picture stays visible until the new one is
  ready.

If export cannot get under 4 GB without slowing it more than about 10%,
or without changing a cache or disk allowance, stop and report the
options. Size and allowance changes are Steve's decision
(`docs/product/modules/memory-and-caches.md`).

## Part 2: reuse Fine Grain when switching to Clean Grain (item 2)

**Outcome:** with the same photo, controls and geometry, switching from
Fine Grain to Clean Grain takes no longer than the Clean Grain colour step
plus reading the saved result. The projection is 6–8 s Canon and 13–17 s
Sony at 110%. Changing a control that affects Fine Grain must not reuse
stale pixels. No seams at tile boundaries.

## Part 3: GPU preparation trial

**Question:** can the whole-photo preparation (grain fit, the Fine Grain
filtering and Clean Grain colour cleanup) run on the GPU so that the first
wait at 110% is about half the baseline or less?

**Go threshold, from the Fine Grain 110% baseline (14.40 s Canon,
34.06 s Sony):** about 7 s on the Canon and 17 s on the Sony, measured as
the whole wait from the action to the final picture. Clean Grain should
improve by a similar share.

**Steps:**
1. **Estimate first.** From the existing breakdown, say which parts can
   move to the GPU, the expected whole wait, and the memory the GPU route
   needs on 8 GB unified memory. If the estimate misses the threshold,
   stop here and report. Don't build it.
2. **Prototype** if the estimate passes. Measure the real whole wait and
   peak memory on the MacBook.
3. **Ship it as the preview route** only if it meets the threshold, the
   baseline match and the 4 GB ceiling. Proof and export follow the
   existing rules: GPU where it is already used, CPU fallback agreeing
   within tolerance.
4. **If the prototype misses**, keep it off the default path (or remove
   it), record the numbers in the Grade PRD and report. One GPU attempt,
   then CPU fallback, per AGENTS.md.

The grain-fit result may differ slightly between GPU and CPU. That is
acceptable only within the matching rule above. The whole-photo grain
calibration must stay whole-photo: no per-tile fits that create seams.

## Measurements

On the MacBook, against the baseline in `docs/technical/performance-table.md`
(5% run-to-run band):

- the 110% sequence (turn on Standard → Fine Grain → Clean Grain) on the
  Canon and the Sony,
- first preparation at Fit and 100%,
- zoom 100% → Fit and back, and one slider drag per method,
- full-size export and Proof for the Sony, and for the Canon if time
  allows (still open from the baseline),
- peak whole-app memory for each of these.

Update the performance table rows. Re-run the baseline crop comparison and
marked-spot counts for every method on all four baseline photos after each
part that can change pixels.

## Constraints

- Everything in the earlier Denoise briefs still applies:
  - Standard stays pixel-identical.
  - Preview, Proof and export agree within the existing limits.
  - HDR never exceeds the highlight compression target.
  - No limit, cache size or disk allowance changes without Steve.
  - No per-camera tuning; no TAU bm3d/bm4d packages.
  - Design tokens only.
  - Never save over the read-only test projects.
  - Photos only from `<photosRoot>/HDR Test Images`.
- One GPU job at a time under `tools/gpu-run-lock.py`. Run
  `tools/output_size.py` at the start and the end.
- Steve will use the app tonight. Finish your GPU and timing runs and
  leave the branch committed and runnable before you report.
- Small commits on your branch, one per part, so each can be undone
  alone. No push.
- Keep slow validation within about 30 minutes. If it would run longer,
  run the checks that cover the change and list what you skipped.
- Delete scratch output when done. Reuse the existing baseline review
  folder for any new review page instead of making a new one.

## Questions protocol

If something in this brief conflicts with the code or the measurements,
ask before building around it.

## Report back

In plain language:
- what Steve will notice in the app tonight,
- the before and after whole waits and peak memory, per photo and method,
- the GPU estimate, and if built, whether it met the threshold and the
  baseline match,
- the baseline comparison and marked-spot results,
- what you ran, what you skipped and what failed,
- your branch and final commit SHA.

Update the Grade module PRD, `docs/technical/denoising.md`, the
performance table and the AGENTS.md documentation map in the same work.
Move the finished harsh-speck baseline brief to
`docs/technical/archive/briefs/` and update its map entry.
