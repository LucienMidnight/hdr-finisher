# Codex Brief — Library Quick-Open Trial
## HDR Finisher — Photo Library

**Date:** October 10, 2026
**Read first:** `AGENTS.md`, then the "M2/M6 speed follow-up" entry in section
7 of `docs/product/Photo_Library_PRD_2026-10-09.md`.

## Goal

Show whether the library can put several RAW photos per second on screen,
graded, in SDR or HDR, the way FastRawViewer browses. When this trial is
done Steve knows the real end-to-end rate inside the app, has seen what the
quick picture looks like next to the Grade picture, and can decide whether
this replaces stored HDR preview files.

This is a measurement trial, not the library feature.

## Direction from Steve (October 10)

- The library does **not** apply corrective steps: no lens correction, no
  highlight reconstruction, no denoise, no DNG correction opcodes. Those
  load when the user switches to the Grade page, as they do today.
- The library uses a **separate quick demosaic** from grading and export.
  Grading and export keep theirs unchanged.
- A lower-resolution picture is acceptable for browsing.
- **HDR is optional** and is the only thing worth extra time.
- Everything the graphics card can do should be done there.

## Context

The previous trial showed where the time goes on the current route: drawing
on the graphics card took about 25 ms and reading back about 59 ms, but
writing the gain-map file took about 2.9 seconds and a corrected open took
1-8 seconds (86 seconds for the DJI DNG warp). So the route to test now has
no corrected open and no file encoder in the path to the screen.

Claude then timed a bare quick open outside the app (rawpy / LibRaw
half-size, camera white balance, linear 16-bit, highlights clipped, nothing
else) on the same 29-file corpus, warm disk, Ryzen 5 7600:

| Measured | Result |
|---|---|
| 42 MP Sony ARW, one core | about 190-290 ms (unpack 46-144, half-size 143) |
| Canon CR2 / Nikon NEF, 18-22 MP, one core | about 320-400 ms |
| Fuji RAF, 16 MP, one core | about 80 ms |
| 19 camera originals, 1 / 2 / 4 / 6 / 10 at once | 4.1 / 7.1 / 10.7 / 13.2 / 15.2 photos per second |
| Threads versus separate processes | Same rate; LibRaw runs in parallel on threads |
| Embedded JPEG, extract and decode | 5-25 ms |
| Linear DxO DNG, one core / six at once | about 2 s each / 1.9 per second |
| Embedded JPEG in those DNGs, decoded reduced | 50-105 ms |

Those numbers stop at a picture in processor memory. Nothing has been
measured from there to the screen inside this app. That gap is this trial.

## Outcome spec

Build the smallest experimental path that takes a photo from disk to a
graded picture on screen with no corrective steps, then answer:

| # | Question | What the answer must show |
|---|---|---|
| 1 | How long from "show this photo" to the graded picture on screen? | Median and worst per format, for a photo not seen before and for one prefetched. Split into quick open, hand-over to the graphics card, and draw. |
| 2 | How many photos per second end to end? | The 19 camera originals and the full 29, with 1, 4 and 6 opens at once, counted when each picture is actually presented. |
| 3 | What does the hand-over cost? | Time to get one quick-opened picture from the helper onto the graphics card at the size sent, and whether sending a smaller picture changes the rate. This is the step Claude is least sure of. |
| 4 | Is HDR extra? | The same runs with the HDR view on. State any work HDR needs that SDR does not. |
| 5 | How fast does a grid fill? | 30 thumbnails from never-seen photos: time to first thumbnail and to all 30. |
| 6 | Does grading stay smooth? | The same Grade gesture sampling as before, idle versus while a batch of quick opens runs. |
| 7 | How different is the picture? | For the ten representative files, the quick picture beside the Grade picture at fit size: saved side-by-side images for Steve, plus the same simple difference numbers used last time. |

Notes:

- **The grade must be applied.** An edited photo shows its saved grade. Use
  the existing graphics card grading; do not build a second grade.
- **Brightness must match Grade.** The automatic starting exposure measured
  at under 10 ms, so keep it or an equivalent, and say which. If the HDR
  source classification (about 130 ms at preview size) is needed for a
  correct picture, say so and time it; if not, leave it out.
- **Embedded JPEG first is allowed** as an instant placeholder, replaced
  when the quick picture is ready. Report both moments.
- **Already-processed files** (linear DNG, TIFF, JPEG, HEIC) have no quick
  demosaic. Report the fastest honest route for each; using the embedded
  JPEG first for linear DNG is expected.
- **Known look differences to show, not fix:** the DJI DNGs without their
  correction opcodes, and clipped highlights without reconstruction. Include
  these in the side-by-side images.
- **Nothing is written to disk in the path to the screen.** Whether to store
  a small copy for faster revisits is a later question; do not build a
  cache. If one obvious measurement would inform it cheaply (for example the
  size in memory of a thumbnail-size and a fit-size picture), report it.

## Constraints

- **Invisible to users.** The experimental path is off unless a test driver
  turns it on. No new controls, preferences, defaults or visible behaviour.
- **Do not change** the Grade page's opening route, CPU export, Proof, any
  pinned shader, tolerance, limit or budget, the project format, or any
  existing cache limit. If the trial needs one of these touched, stop and
  ask.
- **Nothing is adopted.** No pipeline, format or cache is decided here.
- **Originals are read-only.** Never save over the read-only test projects.
- **Keep it small.** No queueing, cancel, progress, cache management or
  thumbnail store. No new correction shaders.
- **Testing follows `AGENTS.md`.** Fast checks on every change; GPU runs one
  at a time through the Electron runner at
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. If slow runs will total
  more than about 30 minutes, tell Steve first.
- **Excluded:** local masks, virtual copies, network drives, cold disk,
  export overlap, the oversized line-scan DNG and the unsupported merged HDR
  DNG. Say plainly that the disk was warm; uncompressed 42 MP Sony files are
  82 MB each, so a slow disk would cap the rate before the processor does.
- Small local commits. No push, no installer build.

## Records and report

- One short dated entry in PRD section 7 after the speed follow-up entry:
  the seven answers, what was excluded, and a suggestion for Steve. Leave
  the earlier entries as they are. No separate evidence document.
- Report to Steve in plain language: the photos-per-second figure, the
  slowest step left, what the quick picture gets wrong compared with Grade,
  and the one decision he needs to make with its trade-off.
- Say clearly if anything contradicts the numbers in the Context table.

## Questions protocol

If the smallest path turns out to need more than a small, switched-off
addition, or anything here conflicts with the existing code, ask before
building it.
