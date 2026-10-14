# Codex Brief — Library Disk Reader Trial (M10)
## HDR Finisher — Photo Library

**Date:** October 14, 2026
**Read first:** `AGENTS.md`, then PRD section 5.9 from "Update after M7 and
M8" through "After M9", and your M9 entry in section 7.

## Goal

Find out whether treating the photo disk as its own scheduled resource lets
full-screen browsing meet Steve's targets on his machine. When done, Steve
and Claude can decide whether a dedicated disk reader becomes part of the
build. The targets are unchanged:

1. A steady culling pace (a press every 500 ms) finds every photo sharp.
2. The photo stopped on after moving fast is sharp within half a second.
3. Pressing as fast as possible may fall behind, but recovers quickly.

This is a measurement trial on your M9 prototype. Nothing a user sees
should change.

## What changed since M9

- **Appearance accepted.** Steve reviewed every M9 side-by-side, including
  Fuji and Sony DSC02767, and saw nothing wrong. Keep the M9 GPU browsing
  route as it is. No colour or clipping work is needed for this trial.
- **The disk is the bottleneck.** In M9 a cold RAW spent about 232 ms reading
  from `D:` (a spinning disk in a USB enclosure), against about 80 ms of our
  own processing. The disk gave about four files a second however many
  readers ran. Background work roughly doubled the viewed photo's time.

## What we suspect

Claude's hypotheses from reading M9, to confirm or overturn:

1. Each worker reads and then decodes, so reads from several workers
   collide on one spinning disk, and the disk sits idle while workers decode.
2. One dedicated reader, filling an in-memory RAW file cache in priority
   order (viewed photo first, then ahead in the direction of travel), keeps
   the disk busy and lets background preparation approach the disk's rate,
   about four a second, above the three-a-second target.
3. Reading in small pieces lets a background read give way almost at once
   when the viewed photo needs the disk, so background work stops slowing
   the viewed photo.
4. FastRawViewer feels instant on the same disk mainly because files are
   already in memory when reached. With the reader, a photo stopped on within
   the read-ahead needs only unpacking and drawing, about 0.4 s.
5. Part of M9's unexplained 5.54-second wait at 250 ms came from disk
   contention.

## Outcome spec

Short tables of medians with the slowest case named, plus a plain sentence
or two each. Use the same files and conditions as M9 (disposable copies on
`D:`, Windows file cache bypassed, warmed renderer and workers) so the
results compare directly.

| # | Question | What the answer must show |
|---|---|---|
| A | What does the disk deliver to one reader? | Files a second and MB a second for one reader working through the set, and how much reading in pieces of different sizes costs in total rate. |
| B | How quickly does a background read give way? | Time from "viewed photo requested" to "its read starts" while background reading is under way, for the piece sizes tried. |
| C | Background rate with the reader | Photos a second prepared and drawn with the reader feeding memory and the M9 workers decoding from memory, beside a viewed photo. Compare with M9's 2.00 a second, and say whether the processors or the disk now limit it. |
| D | Viewed photo time | Time to sharp for a viewed photo already in the RAW memory cache, and for one not yet read, both with background work running. Compare with M9's 0.71 s alone and 1.13-1.53 s under load. |
| E | Browsing against the targets | Repeat the M9 30-file run at one press every 500, 250 and 100 ms: photos sharp on arrival, and the wait after stopping. Add a run that stops after a burst and a cold jump to a photo far away. |
| F | Where every millisecond goes | A per-photo trace for the E runs (read wait, read, unpack, development, handoff, draw), detailed enough to explain any outlier like M9's 5.54 s. If an outlier remains unexplained, say so. |

Choose the read-ahead depth, RAW memory cache size and piece size yourself,
starting from FastRawViewer's defaults (40 RAW files cached, 12 ahead), and
report what you chose and why. Memory is plentiful (64 GB), but say what
the RAW cache costs.

## Constraints

- Prototype and measure only, inside the M9 instruments or behind a
  development-only switch. The shipped Library and Grade behave exactly as
  now.
- Do not change Grade, CPU export, Proof, or any pinned shader, tolerance,
  limit or budget.
- Never write to Steve's photo folders, the read-only test projects or the
  app's real picture cache. Keep the disposable copies on `D:` so reads stay
  honest.
- GPU runs one at a time through `tests/run-in-electron.js` at
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap them or run
  them beside another agent's GPU check.
- No full sweep, audit or endurance run. Fast checks only if you touched
  something they cover.
- If the trial looks like more than about 30 minutes of slow runs, stop and
  tell Steve what you want to run and roughly how long. C, D and E matter
  most.

## Reporting

- A plain-language summary for Steve: answers A-F, which suspicions held,
  and how close browsing now gets to each target.
- One recommendation: whether the disk reader should be part of the build,
  with its read-ahead depth and memory cost, what it adds in complexity and
  what could break.
- Add an M10 entry to PRD section 7 in the style of M9. Raw results in the
  ignored output folder. No separate evidence document.
- Say plainly what you could not measure, and anything surprising.

## Questions protocol

If a suspicion is aimed at the wrong thing, or the trace points somewhere
else, say so and follow the evidence rather than forcing the reader design.
Ask before adding any new dependency to the shipped app.
