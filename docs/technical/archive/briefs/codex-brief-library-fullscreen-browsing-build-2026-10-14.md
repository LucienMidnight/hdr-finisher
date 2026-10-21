# Codex Brief — Full-Screen Browsing Build
## HDR Finisher — Photo Library

**Date:** October 14, 2026
**Read first:** `AGENTS.md`, then PRD section 5.9 from "Full-screen browsing
speed (agreed October 14, 2026)" through "Decided after M10", and your M7,
M8, M9 and M10 entries in section 7. Your M9 and M10 prototypes are in
`codebase/tests/performance/library-raw-deep-dive.*` and
`library-disk-reader-trial.*`.

## Goal

Make full-screen and single-photo browsing of camera RAW files feel like
FastRawViewer on Steve's machine, for real users of the shipped app. This
time it is the feature, not a trial. When done:

| Situation | What Steve should see |
|---|---|
| Steady culling, a press about every half second | Every photo sharp when reached, including the first few after entering single or full-screen view |
| Stopping on a photo that was already read ahead | Sharp within half a second |
| Pressing as fast as possible, then stopping | The Library thumbnail while moving, then sharp soon after stopping. Steve judges this against FastRawViewer by feel. About 1 s is the measured limit on his photo disk |
| Going back to a photo seen recently | Instant |
| The grid | No slower than today |

## Context

Everything here was decided with Steve from the trials. Summary of what the
build must contain; how to build each part is yours.

- **Graphics-card browsing picture for camera RAW.** The M9 route: unpack on
  the processor, shrink and colour on the graphics card, draw from it without
  sending the picture back first. Steve reviewed every camera's side-by-sides
  and approved the look. Other formats keep today's route.
- **Thumbnails from the same route.** A camera RAW's grid thumbnail and its
  full-size picture must come from the same route, so nothing visibly jumps
  inside the Library. Grid speed must not get worse.
- **One decode, both sizes, where a full-size picture is needed or about to
  be** (single and full-screen view, and the photos around the grid
  selection). Grid thumbnails alone do not pay for a full-size picture.
- **Workers.** Two background workers plus one reserved for the viewed photo,
  in separate processes, not sharing one.
- **Dedicated disk reader.** One reader fills an in-memory RAW file cache in
  priority order: the viewed photo first, then ahead in the direction of
  travel. Reads in 1 MB pieces so background reading gives way at once.
  M10 settings as the starting point: 12 ahead, about 40 RAW files cached.
  Workers decode from memory.
- **Pictures held on the graphics card.** About ten recent full-size
  pictures stay ready, so going back is instant (M9: 12 ms redraw). Today
  every picture change throws the previous one away.
- **Three fixes M10 exposed:**
  1. A viewed photo already being decoded by a background worker is
     promoted, not left in the slower lane.
  2. Less data travels to the screen (M10: 182 ms for hand-off, conversion
     and drawing).
  3. Read-ahead starts when a photo is selected in the grid, not only on
     entering single or full-screen view, so the first few photos are ready.
- **Separate storage allowances.** Full-size pictures must never push
  thumbnails out of the disk cache, as they do today.
- **Memory limits follow the machine.** Steve has 64 GB and a 12 GB graphics
  card; others will not. Scale the RAW cache, the held pictures and the
  read-ahead down automatically on smaller machines. A visible setting can
  wait for the disk step.
- **One full-size picture size per machine,** fitted to what the screen
  shows, so a window or panel change does not trigger a second decode.

Steve's machine: Ryzen 5 7600 (6 cores, 12 threads), RTX 4070 Ti 12 GB,
64 GB RAM. Photos are on `D:`, a spinning disk in a USB enclosure. The app
cache is on `C:`, an NVMe drive.

## Not in this build

- Disk building of full-size pictures for the whole folder on `C:`
  (lossless shuffled Zstandard, 10 GB default, the settings). That is the
  next step. Do not design it out, but do not build it now.
- Moving RAW development onto the graphics card. A later option only if the
  build still feels slow to Steve.
- Any speed work for non-RAW formats.

## Constraints

- Grade, CPU export and Proof are unchanged. Grade still opens every photo
  through its full-quality route. Do not change any pinned shader,
  tolerance, limit or budget. If the Library route needs its own shader,
  keep it separate from Grade's pinned ones.
- The Library shares the graphics card and processor with Grade. Grade must
  stay responsive while the Library prepares pictures, and Library
  background work must keep yielding to Grade and export as it does today.
- Never write to Steve's photo folders or the read-only test projects.
- Pre-1.0 rule: no compatibility code for old cached pictures. Existing
  camera RAW thumbnails may be remade once under the new route; tell Steve
  in one line.
- Commit in small local commits, one per coherent piece, so any can be
  undone alone. Do not push.

## Testing

Per `AGENTS.md`: this is not a release point.

- After each commit: the fast checks.
- Once for the whole group: the two existing Library full-screen checks
  (`library-appearance-navigation.js`, `library-fullscreen-raw.js`), plus the
  one or two Grade GPU checks that cover any shared drawing code you change.
  Update those Library checks if the behaviour they pin has changed on
  purpose, and say what changed. Never loosen a number to get a pass.
- Once at the end, rerun your M10 30-file browsing measurement against the
  shipped app (500, 250 and 100 ms, plus a stop after a burst and a cold
  distant jump), and compare with M10. If the shipped build is clearly
  slower than the prototype, say where the time went before reporting.
- Steve's own browsing is the final judge. Leave the app in a state he can
  try straight away.
- Stop and ask Steve before any set of slow runs over about 30 minutes.

## Reporting

- Plain language for Steve: what he will notice, the M10-style numbers
  against the table in Goal, and anything that misses.
- One line on which cached thumbnails will be remade.
- What could break, and how he would notice.
- Update PRD 5.9 to say what was built, briefly. No separate evidence
  document.

## Questions protocol

Ask before inventing anything that conflicts with the existing code, adding
a dependency to the shipped app, or changing anything Grade relies on. If
part of the plan turns out wrong once you are in the real code, say so
rather than forcing it.
