# Codex Brief — Library Preview Speed Trial (M2/M6 follow-up)
## HDR Finisher — Photo Library

**Date:** October 10, 2026
**Read first:** `AGENTS.md` (testing scale and reporting), then section 7 of
`docs/product/archive/Photo_Library_PRD_2026-10-09.md` (the M2, M6 and status entries).

## Goal

Find out how fast a library HDR preview can really be made on Steve's machine.
The October 10 M2/M6 numbers (about 13 seconds for a never-opened photo, 4.5
seconds for an already-opened one, 35 minutes for a 500-photo paste) measured
the exact CPU export renderer on one thread with caching off. That is the
slowest route the app has, and it led to the suggestion that HDR previews
must be a prepare-ahead command. Steve thinks that is too slow, and the
suggestion should not stand on that route alone. When this task is done,
Steve can decide between the simple HDR switch and prepare-ahead (PRD 5.9)
from numbers that reflect a sensible way of building previews.

This is a measurement trial. It is not the library preview feature.

## Context

- The earlier instrument is `codebase/tests/performance/photo-library-remaining.py`
  with the Electron driver `photo-library-refresh-interaction.js`. Raw results
  are in `codebase/output/library-measurements/remaining` (ignored output).
  Reuse the same ten files and the same 30-photo set so the new numbers
  compare directly.
- From that raw data, at 2560 on the long edge: opening a photo took 2.4-10.6
  seconds across nine files, and 100 seconds for `DJI_0071-2.DNG`. Building
  the preview file after opening took 2.9-5.0 seconds whether or not the
  grade had changed.
- In the same trial the graphics card (RTX 4070 Ti) redrew an exposure change
  in Grade in about 23 ms at a 2560x1440 window.
- The first round was not allowed to touch the app. This round may add a
  small experimental path inside the app, under the constraints below.

Claude has not profiled any of this. Everything under "What we suspect" is a
guess to confirm or overturn, not a diagnosis.

## What we suspect

1. Most of the 3-5 second build is the CPU export renderer, and the graphics
   card could produce the same two pictures (HDR and SDR) far faster.
2. A good share of the opening cost is work done at full resolution that a
   2560 preview does not need.
3. The 100-second DJI open is either an artefact of the instrument (one
   thread, low priority, cache off) or a real slow spot in the app.

## Outcome spec

Answer these four questions. Each answer is a short table of medians plus
one or two plain sentences.

| # | Question | What the answer must show |
|---|---|---|
| A | Where does the current 4.5 seconds go? | The already-opened 2560 build split into its main steps (drawing the two pictures, working out the gain map, JPEG encoding, writing). Also the same build with the normal number of threads instead of one. |
| B | How fast is the build when the graphics card draws the pictures? | Per photo at 1920 / 2560 / 3840: time to draw, time to get the pixels back, time to encode and write, and the total. For an already-opened photo and again after a +0.25 EV change. File sizes as before. |
| C | How cheap can opening be for a preview? | The current open split into its main steps (decode, highlight reconstruction, automatic exposure, lens correction, reduction). Then the fastest open you can find that still gives an honest preview, with its time. |
| D | Why did `DJI_0071-2.DNG` take 100 seconds to open? | Where the time went, and whether the same file is that slow when opened normally in the app. |

Then two end-to-end runs using the best route found in B and C:

- **30 distinct never-opened photos at 2560**, one after another (the earlier
  run took 9 minutes 58 seconds).
- **50 remakes after an edit at 2560** while Grade is being used, with the
  same gesture sampling as before. This matters more than last time: preview
  work would now share the graphics card with grading, so report idle versus
  under-load median and p95, and the largest frame gap. Do not repeat the
  500-job run.

Notes on the answers:

- **The stored file stays the same idea:** one gain-map image serving both
  HDR and SDR preview modes. If the fast route needs a different way of
  producing it, say so and say what it changes.
- **Honest preview (question C):** a faster open is only useful if the result
  looks like the real thing. For each shortcut tried, give a simple measured
  difference against the full open reduced to the same size, and save a small
  set of side-by-side images to the ignored output folder for Steve to look
  at. M1 already showed that LibRaw half-size does not shrink the linear DxO
  DNGs, so do not assume one shortcut covers every format.
- **A separate fast demosaic for viewing is allowed (Steve, October 10).**
  FastRawViewer does this: a quick demosaic for browsing, kept apart from
  the quality one. Library previews may use a faster demosaic than grading
  and export do. Grading and export keep theirs unchanged. M1 already
  measured one candidate: LibRaw half-size took 0.08-0.39 seconds against
  1.6-5.9 seconds full size on the camera originals. Treat that as a
  starting point, not the answer. Check per file whether the result is at
  least as large as the preview being made, and report where it is not.
  A demosaic done on the graphics card is a possible later step; note
  whether the numbers suggest it is worth a trial, but do not build one here.
- **Demosaic is only part of opening.** The opens measured 2.4-10.6 seconds
  against 1.6-5.9 seconds for the full decode alone, so the other steps
  (highlight reconstruction, automatic exposure, lens correction) need the
  same treatment: time each at preview size, not only at full size.
- **Direction: graphics card for everything it can do (Steve, October 10).**
  Steve expects any step left on the processor to be too slow. Unpacking
  the camera file has to stay on the processor; everything after it is a
  candidate for the graphics card. For each opening step, report: its
  processor time at preview size, whether the app already has a graphics
  card version of it, and if not, roughly how big a job writing one would
  be. Use a graphics card version in the end-to-end runs wherever one
  already exists. Do not write new shaders for the missing ones in this
  trial; the table is what lets Steve decide which are worth building.
  Also report what running several unpacking jobs at once on the processor
  does to the 30-photo total, since that part cannot move.
- **Question D is find and report only.** If the cause is a real slow spot in
  the app, describe it in one or two lines and stop. Fixing it is a separate
  decision for Steve.
- **No pass or fail limits.** As a rough guide for the write-up only (Claude's
  guide, not a budget): the simple switch looks workable if an already-opened
  photo takes a few tenths of a second and a never-opened one about a second
  or less. Report the numbers either way.

## Constraints

- **Invisible to users.** Any experimental path in the app is off unless a
  test driver turns it on. No new controls, menus, preferences, defaults or
  visible behaviour.
- **Do not change** CPU export, Proof, any pinned shader, tolerance, limit or
  budget, the project format, the helper's shipped job types, or any existing
  cache limit. If the trial cannot be done without touching one of these,
  stop and ask.
- **Nothing is adopted.** No preview format, pipeline, schema, metadata
  reader or cache size is decided by this work.
- **Originals are read-only.** Work on copies under the ignored output
  folder. Never save over the read-only test projects.
- **Keep it small.** GPU first; do not improve the CPU preview route. Do not
  build queueing, pause/cancel, progress or cache management. Those belong to
  the feature.
- **Testing follows `AGENTS.md`.** Fast checks on every change; GPU runs one
  at a time through the Electron runner at
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`, never overlapping. If the
  slow runs for this trial will total more than about 30 minutes, tell Steve
  what and how long before starting.
- **Excluded, as before:** local masks, denoise changes, virtual copies,
  network drives, cold disk, export overlap, the oversized line-scan DNG and
  the unsupported merged HDR DNG. List anything else you leave out.
- Small local commits. No push, no installer build.

## Records and report

- Add one short dated entry to PRD section 7 under the existing M2/M6
  entries: the four answers, the two end-to-end totals, what was excluded,
  and a suggestion for Steve on switch versus prepare-ahead. Do not rewrite
  the October 10 entries; they stay as the CPU baseline. No separate evidence
  document.
- Report to Steve in plain language: what is now fast, what is still slow and
  why, and the one decision he needs to make, with its trade-off and what
  could break.
- Say clearly if a result surprised you or contradicts the suspicions above.

## Questions protocol

If anything here conflicts with the existing code, or the experimental path
turns out to need more than a small, switched-off addition, ask before
building it. Do not invent a new preview format or pipeline to make a number
look better.
