# Codex Bug Fix Brief — Saved-Grade Library Picture Takes Minutes Again
## HDR Finisher — Photo Library

**Date:** October 16, 2026

Read `AGENTS.md` at the repository root first. It sets the testing level
and how to report to Steve.

## What's broken

After Steve edits a photo in Grade and it saves, the Library goes on
showing the old picture for a minute or more. Today's log has saved-grade
pictures taking 42 to 171 seconds to render (`kept_rendered`), for
example DSC_3931.NEF at 67 s and DSC00264.ARW at 171 s.

## What should happen instead

What the plan says (architecture note 3.3 in
`docs/technical/library-speed-architecture.md`, and Part 3 of
`codex-brief-library-speed-1-stopwatch-stall-saved-picture-2026-10-12.md`):
after a save in Grade, the edited picture replaces the old one in the
Library **within about 3 seconds** on the 42 MP test files. Cases with no
open photo (revert, virtual copies, the request route) take about 4.5 s
when Grade is idle.

The October 14 decision still holds: the saved picture fills the screen
(the same 1280-2560 pixel fitted edge as unedited pictures), JPEG quality
95, 4:4:4, one gain-map file for SDR and HDR. A crop must not leave it
smaller than that.

## Cause (diagnosed, high confidence)

Commit `982a6b7` ("Make saved Library pictures fit full-screen viewing")
changed the order of work. Before, the photo was shrunk to the picture
size and then the grade was rendered. Now the grade is rendered on the
full-size photo and shrunk afterwards, so that a crop cannot leave the
picture below screen size. That makes every saved picture a full-size
export render (both the HDR and SDR branches) in the low-priority
background process, which runs on one core. The PRD estimated 9-12 s
for this; the log shows 4 to 15 times that.

Two things make it worse. They are **not** part of this fix, but say in
your report if they still matter after it:

- While Grade is open, its save check every half second goes through the
  request route that pauses the background helper. DSC00264.ARW spent
  92 of its 184 seconds waiting.
- Each new save cancels a picture in progress and starts again, so a
  run of edits can keep the Library waiting for the whole run.

## Steve's decision

Go back to shrinking first, and choose the shrunk size so that what is
left after the crop (and rotation) still reaches the screen target. An
uncropped photo is shrunk straight to the target. A photo cropped to half
its width is shrunk to twice the target. The shrunk size never exceeds
the full photo.

How you work out that size from the saved grade is your call.

## Required to hold

- **Fills the screen.** The finished picture's long edge matches the
  chosen target (screen size or 512/1024/1920), within a pixel or two of
  rounding, for uncropped photos, heavily cropped ones and rotated ones.
  It is never larger than the photo allows.
- **Looks like the grade.** Compare the shrink-first picture with today's
  full-size picture for the same photo and grade, on at least one
  uncropped and one cropped photo. Some difference is expected, since
  effects tied to pixel scale (grain, sharpening, texture, denoise, glow,
  local masks) are worked out at a smaller size. Proposed tolerance:
  differences in those effects are acceptable when the picture matches
  what Grade shows at Fit for the same grade. Any difference in overall
  colour, brightness or tone, or anything that looks wrong full screen,
  is not. If you find one, stop and report it with the cause before going
  further. Do not loosen any existing check to get a pass.
- **The open-photo route stays.** A save made in Grade still uses the
  image Grade already has open (no second decode). The other routes keep
  their current source.
- **Saving stays quick.** The save returns as fast as it does today.
  Making the picture does not hold up the save or the next edit.
- **The right photo and grade.** Today's guards (grade identity, source
  fingerprint, superseded jobs) keep working.
- **Memory.** No second full-size copy of the photo stays alive after the
  shrink.

**Timing tolerance** (proposed, with the reason): on the 42 MP test files
the picture should appear within 3 s of the save, measured from the
existing stopwatch. Treat up to 4 s as a pass, since the 3 s figure was
an estimate (about 2 s render plus encode) and has not been measured on
this route. Above that, report where the remainder goes
from the stopwatch record, and do not chase it further.

## Scope

- No change to CPU export, Proof, the export render functions, the
  gain-map writer, any pinned shader, tolerance, limit or budget, or the
  RAW decode route. Call the existing render functions as today. Only
  the size of the image you hand them changes.
- Leave the helper's pause rules and the cancel-on-new-save behaviour as
  they are (see above). Report on them; do not change them.
- Pictures already saved under the current picture version do not need
  remaking. Before 1.0 there is no compatibility work. If you do need to
  invalidate them, say so in one line.

## Checks

As set out in `AGENTS.md` for an ordinary change: the fast Node and
Python checks, then only the GPU checks that cover saved pictures
(`tests/library-kept-pictures.js` and
`tests/library-saved-picture-refresh.js`, one at a time, at 2560x1440).
Update `tests/test_library_kept.py` to check the results that matter
here: picture size for cropped and uncropped grades, and that the render
is handed the reduced image. No full sweep.

## Report back

One short note: what changed, the time from save to picture for one
uncropped and one cropped 42 MP photo, what the look comparison showed,
and which checks ran. One commit, held locally. Ask before pushing.

## Questions

If anything here conflicts with the code, for example if crop or rotation
can't be read before the render, ask before inventing a workaround.
