# Codex Brief: Library speed, exploration only
## HDR Finisher

**Date:** October 18, 2026
**Branch:** `film-look-rebuild`, from its current tip.
**Module PRD:** `docs/product/modules/photo-library.md` (Known problems;
open work items 1, 2 and 9).

## Why this brief

Library speed has been fixed one symptom at a time, and the big targets are
still missed. Before more fixes, Claude will design one plan for how all
Library picture work is scheduled, cached and shared. This brief is the
fact-finding for that design. **Change no behaviour and fix nothing.**
Report what is there, where the time goes, and what you would change.

This pauses the active saved-picture brief
(`codex-brief-library-saved-picture-speed-2026-10-18.md`). Its findings
feed into this one; do not continue its fixes.

## The targets we are missing

| Path | Target | Last measured |
| --- | --- | --- |
| Fresh folder, first picture in every visible cell | 1 s p90 | 3.66 s p90 (badminton folder, 70 visible) |
| Fresh folder, real thumbnail | about 2 s p90 | 21.24 s p90; did not finish in 60 s |
| Second launch, cached thumbnails | 90% within 100 ms | One photo: 24 ms. Whole screen not measured. |
| Saved-grade picture after a paste or save, on screen, idle | about 1 s each | about 16 s each |

Steve's yardstick is Windows Explorer showing the same folder.

## Questions to answer

1. **Map of the picture work.** Every kind of Library picture work
   (camera preview, first GPU picture, real thumbnail and cache write,
   saved-grade picture, exposure map, full-size Single and full-screen
   picture, read-ahead, indexing). For each: who asks for it, which
   process does it (app window, helper, backend, hidden delivery
   renderer), which queue or lane it waits in, how priority and
   cancelling work, and what it competes with (Grade, export, Proof).
   A plain diagram or table is enough.
2. **Where the time goes.** On the badminton folder (372 Sony RAWs on a
   USB HDD, read-only), measure each path in the table above stage by
   stage: disk read, decode, lens correction, colour, analysis, Denoise
   preparation, transport, GPU render, readback, encode, cache write,
   draw. Give medians and p90. For each stage, say whether the CPU, GPU
   or disk was busy or idle, and how much was waiting in a queue rather
   than working.
3. **The floor.** For the same folder: how fast can the embedded camera
   JPEGs alone be read off that drive (the realistic floor for first
   pictures)? How long does Explorer take to show the folder? What is
   the least work a real thumbnail and a saved-grade picture could need?
4. **Repeated work.** How often is the same RAW read, decoded or
   developed across these paths and Grade? What is cached where (memory,
   disk, GPU), and what could be reused that is not today?
5. **The full-folder failures.** Why the visible-screen check did not
   fill 70 thumbnails in 60 s, and what "RAW transport released before a
   GPU draw" means and whether it costs time.
6. **The six speed-plan leftovers** (open work item 9): one ranked helper
   queue instead of lanes; helper priority that follows what Steve is
   doing; GPU pipelines warmed at launch; no scope analysis on Library
   draws; a running cache size total instead of listing the folder; the
   window shown before the backend is ready. For each: what it costs
   today (measured), and what changing it would touch.
7. **Thumbnail file size.** How much of reading and holding a thumbnail
   is due to its size (about 830 KB). Measure only; no pixel changes.
8. **Saved thumbnail agreement.** Why the saved thumbnail files exceed
   Grade agreement limits on 9 SDR and 2 HDR photos even at maximum JPEG
   quality. Separate source/development differences from quantisation,
   JPEG compression, gain-map reconstruction and colour-gamut losses.
   Keep the agreed limits; investigate without changing the codec.
9. **Single and full-screen agreement.** What would be needed for these
   views to match Grade, including the source decoder and full-source
   measurements, and what that would cost in speed, memory and reuse.
   Keep their current quick decoder during this exploration.
10. **GPU-first development (Steve's priority follow-up).** Map Grade's
    demosaic, highlight repair, camera RGB development, import gamut handling,
    full-source HDR analysis and reduction onto existing GPU work or required
    ports. Keep the maths and existing perceptual limits. Give clearly labelled
    rough 42 MP GPU timing estimates or an outside-product prototype.

## What to deliver

- A findings report at `output/library-speed-exploration/findings.md`,
  with the map, the stage tables, the floor, the repeated work and your
  answers to 5 to 10. Mark every number as measured or estimated, and say
  whether the operating system's disk cache was cold or warm.
- Your recommendation: the three changes you think would close the
  largest gaps, with rough gains, risks and what each would touch.
  Claude makes the design decision; do not start building it.
- A short plain-language summary for Steve (five to ten lines).

## Constraints

- **Read-only on behaviour.** Temporary timing logs are fine; keep any
  you think are worth keeping off by default, in their own commit, and
  say so. No change to pixels, caches' contents format, export, Proof or
  Grade.
- Never write into Steve's photo folders or the read-only test projects.
  Use a separate, throwaway cache folder so cold-cache runs do not wipe
  Steve's real cache.
- **Exposure at zero may be in progress** in another task and will
  change the Library's starting look. Do not touch
  `library_pictures.py` `default_look`, `sessions.py` starting
  adjustments or `loader.py`. Never run GPU checks or timing runs at the
  same time as another task's GPU checks.
- Testing per `ai/AGENTS.md`: fast checks only if you commit anything.
  Keep slow measurement runs under about 30 minutes in total; past that,
  stop and ask Steve with an estimate.

## Questions protocol

If something in this brief does not match the code (for example, a path
or a process that does not exist), say so and carry on with what is
there. Ask before anything that would change behaviour.

## October 18 investigation checkpoint

Started after the Fuji DR-only correction (`364cd6c`). Questions 8 and 9
above record Steve's additions. First findings and measurement boundaries:
`output/library-speed-exploration/findings.md`.

All nine known SDR failures pass 8-bit rounding and exceed the existing
limits after quality-100 JPEG encoding. The two HDR failures expose gain-map
precision and saturated-colour clipping. No codec or limit was changed.
Single/full-screen still use the quick decoder; the report describes the
source work and estimated extra cost required for Grade agreement.

The study remains open: clean whole-screen/cached-launch timing, physical
cold-drive/Explorer comparison, three-photo idle saved-picture timing and
resource-use measurements remain. Interrupted UI runs are not acceptance
results. Temporary probes live under output; no speed implementation was
made. Fast checks for the preceding Fuji change: 534 JavaScript passed;
2297 Python passed, 3 skipped.

## Bounded follow-up outcome — stopped as requested

The report now includes question 10's stage map and estimates, an unbuffered
70-photo embedded-JPEG floor on the original USB HDD, and three sequential idle
GPU saved-grade productions with stage medians/p90. The GPU six-stage estimate
is 0.23–1.18 s excluding file/unpack/upload and other listed work; it has not
been prototyped or qualified. Preview floor was 54 ms median / 79 ms p90 with
Windows' data cache bypassed and drive cache uncontrolled. Saved production
was 17.5 s median / 30.0 s p90 including first-renderer warm-up.

Explorer observation was blocked by the computer-use app-server launch failure.
After all three saved files completed, the display attempt again lost the
Electron window. Neither Explorer timing nor save-to-on-screen acceptance is
claimed. Loaded-grid utilisation and peak-memory work were skipped as Steve
requested. Whole-screen/cached-launch qualification also remains open from the
checkpoint. No more runs or implementation are authorised by this continuation.
Slow measurement runtime for the continuation was about four minutes, within
the 30-minute total ceiling including the checkpoint. Product behaviour is
unchanged; documentation and probe summaries were checked. The brief remains
active to preserve the explicit gaps; no acceptance target was relaxed.
