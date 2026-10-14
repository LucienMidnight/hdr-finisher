# Codex Brief — Camera RAW Decode Deep Dive (M9)
## HDR Finisher — Photo Library

**Date:** October 14, 2026
**Read first:** `AGENTS.md`, then in `docs/product/Photo_Library_PRD_2026-10-09.md`
section 5.9 from "Full-screen browsing speed (agreed October 14, 2026)" to the
end of "Update after M7 and M8", and your own M7 and M8 entries in section 7.

## Goal

Find the fastest way to turn a camera RAW into a full-size Library browsing
picture on screen, on Steve's machine, now that the picture only has to look
the same to the eye. When done, Steve and Claude can choose the decode route
to build, knowing how close it gets to these targets:

1. The photo you stop on is sharp within **half a second**, cold from the
   photo disk.
2. Background preparation of about **three photos a second**, so a steady
   culling pace (a press every half second) finds every photo sharp.
3. Pressing as fast as possible may fall behind, as long as it recovers
   quickly once you stop.

The benchmark is FastRawViewer on this same machine: Steve sees photos sharp
in under half a second unless he presses as fast as he can.

This is a measurement and prototype trial. Nothing a user sees should change.

## What changed since M7

- **Exactness rule dropped (Steve, October 14).** The browsing picture need
  only look the same to the eye, judged by Steve from side-by-sides. Colour
  accuracy may be traded for speed. Grade still opens through its full route
  and is unchanged. The one hard rule: a photo's Library thumbnail and its
  full-size picture must come from the same route, so nothing visibly jumps
  inside the Library.
- **Camera RAW only.** Other formats are usually already picks; their speed
  is out of scope here.
- **The graphics-card route is the target design**, FastRawViewer-style: the
  processor reads and unpacks, the graphics card does most of the rest and
  draws from it without sending the picture back first. Your October 14 GPU
  prototype was rejected against the old identical-pixels rule and because
  it returned the picture to the processor. Neither applies now. Saving to
  disk can happen afterwards, off the path to the screen.
- **Disk.** Steve's photos are on `D:`, a spinning disk in a USB enclosure
  (TerraMaster). The app cache is on `C:`, an NVMe drive. M7 ran with files
  already in Windows' memory, so cold reads from `D:` were never measured.
  FastRawViewer advises two or three parallel reads on spinning disks.
- **Whole machine for the viewed photo.** M7's "alone" figures used one
  thread at low priority. The photo being viewed may use the whole machine
  (Ryzen 5 7600, 6 cores / 12 threads; RTX 4070 Ti 12 GB; 64 GB RAM) as long
  as the app stays responsive. Read-ahead stays background work.

## What we suspect

Guesses to confirm or overturn, not diagnoses:

1. Reading the file cold from `D:` is a real share of the time, and parallel
   reads on that disk hurt more than they help beyond two or three.
2. Unpacking the RAW is well under the half-second budget when it may use
   several threads. Most of today's time is our own steps after it.
3. Those steps (shrinking, colour conversion, packaging, handoff) can mostly
   move to the graphics card, or become much cheaper on the processor.
4. Less data needs to cross to the page than today's half-float RGBA.
5. Storing the size actually shown on screen, rather than 2560 for every
   photo, saves work. On a 2560x1440 screen a 3:2 landscape is shown about
   2160 wide, and a portrait about 1440 tall.

## Outcome spec

Short tables of medians with the slowest case named, plus a plain sentence
or two each.

| # | Question | What the answer must show |
|---|---|---|
| A | What is the floor? | Per test file, cold from `D:`: time to read the file, and time to unpack the RAW data, with one thread and with the whole machine. Also reading one, two, three and six files at once from `D:`. This is the least any route can cost. |
| B | How fast for the photo you stop on? | The fastest route you can find from cold file to sharp picture drawn, with its main steps. Include at least one route that keeps work on the processor and one FastRawViewer-style graphics-card route. Say what each change bought. |
| C | How fast in the background? | Photos a second for background preparation on the best route, with the viewed photo still taking priority, and the parallel read count that suits `D:`. Show it does not make the app sluggish or disturb Grade's normal preview. |
| D | Does it meet the targets? | Repeat your M7 end-to-end run on the best route, cold from `D:`, at one press every 500 ms, 250 ms and 100 ms: photos sharp on arrival, and the wait for the photo landed on. |
| E | Does it look the same? | Side-by-side images of the new browsing picture against today's Library picture, for every camera in the set, in SDR and HDR, saved to the ignored output folder for Steve. Include bright highlights and deep shadows. Give a simple measured difference, but Steve's eye is the judge. |

Use the camera RAWs from the M7 set (Sony ARW, Canon CR2, Nikon NEF, Fuji
RAF, mosaiced DJI DNG), plus any other camera RAW in Steve's test folders
that adds a brand or a much higher pixel count. Note that Fuji X-Trans may
need its own handling.

"Cold" means read from `D:`, not from Windows' memory. Choose a reliable way
to ensure that and say what you used.

## Constraints

- Prototype and measure only, under `codebase/tests/performance` or behind a
  development-only switch. The shipped Library and Grade must behave exactly
  as now.
- The new route is for Library browsing pictures only. Do not change Grade,
  CPU export, Proof, or any pinned shader, tolerance, limit or budget.
- Never write to Steve's photo folders or the read-only test projects. Work
  on disposable copies. Keep the copies on `D:` so cold reads stay honest.
  Do not write into the app's real picture cache.
- GPU runs one at a time through `tests/run-in-electron.js` at
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap them or run
  them beside another agent's GPU check.
- No full sweep, audit or endurance run. Fast checks only if you touched
  something they cover.
- If the whole trial looks like more than about 30 minutes of slow runs,
  stop and tell Steve what you want to run and roughly how long. A and B
  matter most.

## Reporting

- A plain-language summary for Steve: answers A-E, which suspicions held,
  and how close the best route gets to each target.
- One recommendation: the route to build, what it costs in complexity, and
  what could break.
- Add an M9 entry to PRD section 7 in the style of M7 and M8. Raw results
  and side-by-sides in the ignored output folder. No separate evidence
  document.
- Say plainly what you could not measure, and anything surprising.

## Questions protocol

If anything here conflicts with the code, or a suspicion is aimed at the
wrong thing, say so before working around it. Ask before adding any new
dependency to the shipped app; a test-only dependency is fine if you say so.
