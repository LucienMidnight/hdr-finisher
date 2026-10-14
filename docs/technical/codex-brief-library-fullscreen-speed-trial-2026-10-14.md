# Codex Brief — Library Full-Screen Speed Trial (M7, M8)
## HDR Finisher — Photo Library

**Date:** October 14, 2026
**Read first:** `AGENTS.md` (testing scale and reporting), then in
`docs/product/Photo_Library_PRD_2026-10-09.md`: section 5.9, the part
headed "Full-screen browsing speed (agreed October 14, 2026)", and the M7
and M8 rows in section 7.

## Goal

Tell Steve how fast a full-size Library picture can be made from a RAW and
put on screen, and how small it can be stored. When this is done, Steve
and Claude can decide two things from numbers: whether reading ahead in
memory can carry fast full-screen browsing on its own, and which disk
format full-size pictures should use.

This is a measurement trial. It is not the feature. Nothing the app does
for a user should change.

## Context

- Full-screen arrowing hitches. The PRD section above lists what was found
  in the app's timing log and what Steve agreed to try. The plan is modelled
  on FastRawViewer: decode quickly, keep decoded pictures in memory around
  the viewed photo, read ahead in the direction of travel.
- That plan only works if a decode is quick. In Steve's log an ordinary
  camera RAW took 1.3-2.2 seconds per 2560 picture, roughly: 340-740 ms
  reading the RAW, 400-900 ms shrinking and converting colour, 160-550 ms
  saving. Those figures were taken while several decodes ran at once, during
  real browsing. They are not a controlled measurement.
- M1 on October 10 measured the LibRaw half-size read alone at 0.08-0.39
  seconds on camera originals. So the read itself may be much cheaper than
  the log suggests when it is not competing.
- Full-size pictures are currently saved uncompressed at about 26 MB each
  (2560 long edge), since commit `fa8d7eb`. Smaller pictures are still
  compressed.
- The always-on stage records land in
  `%APPDATA%\hdr-finisher-desktop\logs\backend.log` (lines starting
  `[library]`). They may be useful as a cross-check.
- Reuse the ten representative files and the 30-photo set from
  `codebase/tests/performance/photo-library-remaining.py`, so numbers
  compare with M1 and M2. Include at least one each of: Sony ARW, Canon
  CR2, a mosaiced DNG, a linear (DxO) DNG, an EXR, and a HEIC or AVIF.

Claude read the code and the log but ran nothing. Everything under "What
we suspect" is a guess to confirm or overturn.

## What we suspect

1. The shrink and colour-conversion step is slower than it needs to be, and
   could be done much faster on the graphics card or by a quicker
   processor route.
2. The six picture lanes slow each other down, because they share one
   low-priority background process.
3. Making the 512 thumbnail and the 2560 picture from one decode costs
   little more than making the 2560 picture alone.
4. A picture could reach the screen noticeably sooner if it did not have to
   be saved to disk and read back first.
5. An unfinished 2560 picture can be stored several times smaller than
   26 MB without a visible difference, and still open quickly.

## Outcome spec

Answer these questions. Each answer is a short table of medians (with the
slowest case named) plus one or two plain sentences.

### Part 1 — M7: how fast can a picture be made and shown?

| # | Question | What the answer must show |
|---|---|---|
| A | Where does the time go today? | One 2560 Library picture per test file through the current route, split into its main steps (read the RAW, shrink, colour, starting look, save, fetch to the page, draw). Run each file alone, and again with six running at once. |
| B | How fast can the decode get? | The fastest route you can find that gives the same picture, with its time alone and with six at once. Try at least: a quicker shrink and colour conversion on the processor; doing that step on the graphics card; and decodes that do not share one process. Say which change bought how much. |
| C | What does the second size cost? | Time for 512 only, 2560 only, and both from one decode, on the current route and on the best route from B. |
| D | How soon can it be on screen? | From "decode finished" to "picture drawn", through the current save-then-read-back path, and through the most direct handoff you can arrange. Also the time to redraw a 2560 picture that is still held on the graphics card. |
| E | What does holding pictures cost? | Graphics memory and ordinary memory per held 2560 picture, and whether holding ten on the graphics card and forty in memory is comfortable on this machine beside Grade. |

Then one end-to-end run with the best route from B to D: step forward
through 30 never-seen photos, one step every 250 ms, with twelve read ahead
in the direction of travel. Report how many photos were sharp at the moment
they were reached, and the longest wait for the photo landed on at the end.
Repeat at one step every 100 ms.

### Part 2 — M8: how small can it be stored?

| # | Question | What the answer must show |
|---|---|---|
| F | Which storage formats are worth considering? | For each candidate, per test file at 2560: size on disk, time to write, time to open ready for drawing. Include today's uncompressed file and the earlier compressed `.npz` as the two baselines. |
| G | Does the picture still look the same? | For each candidate, a simple measured difference against the uncompressed picture after the Library draws it, in SDR and in HDR. Save a small set of side-by-side images to the ignored output folder for Steve to look at, including one with bright highlights and one with deep shadows. |

Candidates are your choice. The picture must stay unfinished scene data so
the graphics card can still draw SDR or HDR from one file; that is a
product decision (PRD 5.9, October 10 and October 14). A candidate may
change how the numbers are packed or compressed, but must not bake in a
look. If nothing unfinished opens in well under the time it takes to
decode the RAW again, say so plainly. Do not move to a finished-picture
format; that is Steve's decision.

## Constraints

- Measurement only. Put instruments and any experimental route under
  `codebase/tests/performance` or behind a development-only switch. The
  shipped Library must behave exactly as it does now.
- Do not change a pinned shader, tolerance, limit or budget. Do not touch
  CPU export or Proof.
- Never write to Steve's photo folders or to the read-only test projects.
  Work on disposable copies, as `library-fullscreen-raw.js` does.
- Do not write into the app's real picture cache. Use a throwaway cache
  folder so Steve's saved thumbnails are untouched.
- GPU runs go one at a time through `tests/run-in-electron.js` at
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`. Never overlap them, and do
  not run them while another agent's GPU check is running.
- No full driver sweep, coverage audit or endurance run. This is a trial;
  the fast checks are enough if you touched anything they cover.
- If the whole trial looks like more than about 30 minutes of slow runs,
  stop first and tell Steve what you want to run and roughly how long.
  Part 1 matters more than Part 2 if time has to be split.

## Reporting

- A plain-language summary for Steve: the answers to A-G, the end-to-end
  result, and which of the five suspicions held.
- One recommendation each for: the decode route, whether both sizes should
  come from one decode everywhere, and the storage format. Give the
  trade-off for each.
- Raw results in the ignored output folder. Add M7 and M8 entries to PRD
  section 7 in the style of the existing M entries. No separate evidence
  document.
- Say clearly what you could not measure, and anything that surprised you.

## Questions protocol

If anything here conflicts with the code, or a suspicion is aimed at the
wrong thing, say so before working around it. Do not invent a new picture
format, cache layout or setting in the app itself as part of this trial.
