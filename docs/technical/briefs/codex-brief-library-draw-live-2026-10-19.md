# Codex Brief: Library develops once and draws live
## HDR Finisher

**Date:** October 19, 2026
**Branch:** `gpu-raw-library`, from its current tip (not yet merged to
`main`).
**Module PRD:** `docs/product/modules/photo-library.md`: decision "Develop
once, draw live" (Steve, October 19) and Open work item 1. Update it as each
part lands.
**Background:** `docs/technical/library-speed-architecture.md`,
`docs/technical/archive/library-speed-exploration-findings-2026-10-18.md`,
`docs/technical/archive/briefs/codex-brief-gpu-raw-follow-ups-2026-10-19.md`.

## Goal

The Library stops making finished picture files for display. Each photo is
developed once into a stored version, and every Library picture (unedited,
pasted grade or saved grade, in the grid, filmstrip, Single and full-screen)
is drawn live on the GPU from that version, using Grade's own shaders.
Pasting a grade onto 50 photos becomes 50 redraws, not 50 new pictures, and
an edited photo shows its new grade in about 1 s.

## Where things stand

- **Develop once is mostly built.** Camera RAWs develop on the GPU (grid,
  filmstrip, Single, full-screen, saved grades, paste starting documents),
  and grid, Single and full-screen share one development. Shared GPU memory
  budgeting with Grade and delivery exists.
- **Draw live is not built.** The grid shows gain-map JPEG thumbnail files
  (about 830 KB each, which also fail Grade agreement on 11 of 32 lanes even
  at quality 100). An edited photo's Library picture is a finished file made
  through the hidden delivery renderer and the export encoder: about 6.7 s
  per photo, most of it encoding a file only the Library looks at.
- The Library already draws scene-linear pictures through Grade's renderer
  (`HDRLibraryGPU extends HDRWebGPUPreview`) for Single and full-screen.

## What Steve should see

| Situation | Result |
|---|---|
| Opening a folder seen before | 90% of visible cells show their real picture within 100 ms on a second launch |
| Opening a new folder | Camera preview first (as today), then the real picture; every visible cell shows a picture within 1 s p90, real pictures within about 2 s p90 |
| Pasting a grade onto many photos | Visible photos show the new grade almost at once; the rest follow without a per-photo file job |
| Changing a grade in Grade, then going back | The Library shows the new grade in about 1 s when idle |
| Flipping through Single / full-screen | As today or faster (prepared neighbours were 56 ms) |
| Scrolling a large folder | Cells stay built one screen beyond each edge (existing 512 MB pool decision) |

These targets are already in the module PRD. They don't change.

## Scope

1. **Stored versions.** Every photo the grid has shown gets a stored
   developed version at grid size (640 px, as the PRD's design proposes).
   Photos opened in Single or full-screen, or given a grade, also get a
   2560 px version. Both live in the existing managed cache, inside bounded
   allowances, using the existing cache controls (folder, on/off, size,
   Clear). You choose the format. It must hold what Grade's shaders need
   to draw any grade, including locals, and load fast enough for the
   100 ms target.
2. **Draw every Library picture live.** Unedited, pasted and saved grades
   draw from the stored version with Grade's shaders, batched per frame.
   The finished-picture files for display (grid thumbnails and saved-grade
   pictures) are no longer produced, and the queue, lanes and Activity
   entries that existed only to make them go too.
3. **Paste and grade changes are redraws.** Bulk paste no longer queues
   per-photo picture jobs. Activity and Pause/Resume stay only for work that
   still exists, such as developing photos that have no stored version yet.
4. **One scheduler for the Library's remaining work**, in the order the PRD
   gives: Grade, the selected photo, visible cells, visible pasted or saved
   grades, read-ahead, background, indexing. Duplicate requests for the same
   photo merge, and simultaneous full developments are capped.
5. **Scope analysis and the thumbnail capture path go with it.** Exposure
   and focus overlays, and anything else that read the old picture files,
   work from the stored version or the live draw.
6. **All file types.** Non-RAW files (JPEG, HEIF, TIFF, PNG, EXR, DNG and so
   on) get stored versions too, developed once on whatever route they use
   today. Plain SDR files can stay "the file itself" if that already meets
   the targets.

## Picture agreement

Steve, October 18: Library pictures need to look close enough to the export
to enjoy full screen, judged by eye. They need not be exact. Export and Proof
keep their strict limits.

- Use the existing perceptual limits (SDR ΔE 2000 / HDR ΔE ITP, mean below
  1.0, p99.9 at or below 3.0), comparing a Library picture with Grade at the
  same size, as a guide. Check at Fit and at 100%.
- Effects that depend on pixel scale (grain, Denoise, sharpening, local
  masks) may not match at 640 px. Where one can't stay within the guide,
  don't invent a workaround. Report it with a before/after pair Steve can
  look at.
- Drawing live should remove the 8-bit gain-map and gamut-clipping errors
  of the old thumbnail files. Say whether it did.

## Decisions to bring to Steve before building them

Ask before building any of these. Give a recommendation and the trade-off:

- **No usable GPU** (missing, software-only or lost). Today the Library
  falls back to CPU-made files. Propose what the Library does without a
  GPU, and what it costs. Pre-1.0 rules allow dropping old routes, but the
  Library must still show pictures.
- **Disk allowance sizes** for the 640 px and 2560 px stored versions, if
  the existing allowances don't fit. Steve's machine is the reference, and
  the recent-picture pool stays at 512 MB, sized for 8 GB machines.
- **Anything outside the Library that reads the old picture files**
  (Explorer previews, paste preparation, external use). If something needs
  them, say what and propose an answer.

## Constraints

- Export, Proof and their files don't change. This work shouldn't touch the
  hidden delivery renderer's output or the encoders. If it must, that part
  becomes "still strict" under `AGENTS.md`.
- Grade keeps GPU priority. The shared memory budget and the export fairness
  rules stay.
- One renderer: the Library draws with Grade's shaders, not a slim copy that
  could drift.
- Camera preview first stays.
- Pre-1.0: no migration. Old cache entries can be ignored and cleared.
- Steve's RTX 4070 Ti has faulty graphics memory that sometimes leaves
  bright specks or garbage values. If a GPU check fails once and the failure
  moves or vanishes on a rerun, treat it as hardware and say so in the
  report. Don't add workarounds for it. A failure that repeats exactly is a
  real bug.

## Order and hand-back

Work in parts that can each be committed and checked alone. A sensible
order: measure today's figures for the targets table, then stored versions
and the live grid, then paste and saved grades as redraws, then the
scheduler, then removing the old file work. Change the order if the code
suggests a better one, and say why.

After each part, give Steve a short plain-language note: what he'll notice,
the target figures before and after, anything that fell back or didn't
match, and how to try it.

## Testing: light, per `ai/AGENTS.md`

- Fast checks before each commit.
- Only the one or two Library GPU checks that cover each part, one at a
  time. Add drivers where none cover a part (and register them in
  `tests/release/drivers.json`).
- Timings: 5% noise allowance; rerun only when a result falls outside it.
- Also measure the items still unmeasured in the PRD: a clean 70-cell run,
  loaded-grid use and peak memory, and Explorer on the badminton folder for
  comparison.
- No release check or sweeps. Stop and ask before anything over about 30
  minutes of slow tests, and before pushing.

## Questions protocol

If anything here conflicts with the code, or a part turns out much larger
than it looks, stop and ask before inventing a new pattern.
