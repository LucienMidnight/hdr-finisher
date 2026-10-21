# Codex Brief — Photo Library: Packaged Smoke Check and the Worst Slow Spots
## HDR Finisher

**Date:** October 12, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then `docs/technical/photo-library.md`
(sections 8 and 9, the slice 3 Stage B notes on kept pictures, and the
slice 5 notes), and section 8 of
`docs/product/archive/Photo_Library_PRD_2026-10-09.md` ("Performance to revisit").

## Goal

Two things, in this order.

1. **Find out whether the Library works in the packaged app.** Everything
   since the foundation work has run only in the development build. The
   Library depends on a separate helper process, and separate processes
   are a known trouble spot once an app is packaged. Steve wants to know
   now, before more is built on it.
2. **Take the worst waits out of everyday Library use.** Steve has used
   slices 1 to 6 and they work, but a few things are slow enough to get
   in the way. This is not the full performance pass; that comes after
   the remaining features. It is the extremes only, measured first.

## Context

- The Electron test runner can already drive the packaged app:
  `tests/run-in-electron.js <driver> --packaged` uses the unpacked build
  that `npm run pack:dir` produces in `desktop/`.
- The Library has an optional timing display
  (`HDR_FINISHER_DEV_LIBRARY_TIMING=1`) and a log of Library events.
- A kept picture for an edited photo is made in the helper through the
  corrected source opening and the export rendering functions. On a
  36 MP RAW that took about 10 seconds, of which about 5.5 seconds was
  opening the photo.
- Steve is not a coder. He judges speed by using the app.

## Part 1 — packaged smoke check

Build the unpacked app only. **Do not build the installer.** Steve has
agreed that this smoke check does not need the full sweep (`AGENTS.md`
now says so).

Then show, in the packaged app, on disposable photos and a disposable
profile:

- the Library opens, lists a pinned folder and draws pictures, which
  proves the helper process starts and answers;
- background indexing runs and finishes;
- a mark is saved to a settings file;
- a photo opens in Grade from the Library, a grade saves, and its kept
  picture appears;
- one overlay map is made;
- one file command (a rename and its Undo) works;
- closing the app leaves no helper or backend process running.

Use the existing focused Library drivers where they already cover these,
with `--packaged`. Two or three drivers is the scale intended, not the
whole set.

**If something fails only when packaged, fix it**, as long as the fix
is about how the app is packaged or how its processes are started and
found. Run the same check again in the development build to show
nothing changed there. If the fix would need a change to how the helper
and the app are divided, stop this part, report what you found and the
options, and carry on with Part 2.

Report the size of the unpacked build and how long the app takes from
launch to the first Library picture, packaged against development.

## Part 2 — measure the slow spots

Before changing anything, measure. Use real camera files: read-only from
`D:\Photos\HDR Test Images`, or copies of the six ARW files in
`D:\test-photos-delete-later` placed in a disposable folder. Never write
into either folder.

Measure at least these, end to end as the user experiences them, and
break each into its stages so the slowest stage is visible:

| What the user does | Known so far |
|---|---|
| A new photo arrives in a pinned folder: time from the bar saying it arrived to its picture being on screen | Reported slow by Steve on October 11; not investigated. |
| Saving a grade: time until the Library shows the edited photo's picture | About 9 to 10 seconds on a 36 to 42 MP RAW. |
| Undo of a photo rename | About 11 seconds on a real RAW, against about 4 for the rename. |
| Renaming a photo | About 4 seconds. |
| Opening a folder for the first time: time to the first picture, and to a full screen of pictures | Not measured recently on real files. |
| Flipping to the next photo in single view and in compare | Not measured. |
| Switching an overlay on: time to the first map on screen | About 1.3 to 1.6 seconds per photo for the half-size focus map. |

Add any other wait over about a second that you meet while measuring.

Produce one ranked list: what it is, how long it takes, where the time
goes, and whether the cause is waiting (queues, polling, pauses,
priority) or work (decode, render, encode, disk). Waiting is usually
cheap to fix; work is not.

## Part 3 — fix the worst of them

Work down the ranked list and fix what can be fixed without changing
behaviour. Expect most of the gain to come from waits: something polled
too slowly, queued behind lower-value work, repeated, or done before it
is needed.

For each fix, record the time before and after on the same files.

Stop working down the list when the next item would need a change in
how a feature behaves or what it produces. For those, do not build;
report the options with what each costs and gains, so Steve can choose.
Examples of what needs his choice, not yours: showing a rougher picture
first; making kept pictures by a different rendering route; keeping
more in memory.

## Constraints

- **Strict area.** Do not change Grade's rendering, export, Proof, any
  existing shader, any pinned tolerance, limit or budget, or the Grade
  and export decode routes. A kept picture is made through the export
  rendering functions: you may change when and in what order that work
  is scheduled, not what export produces.
- Do not loosen a timing budget or a check to show an improvement.
- Background work must still give way to Grade, export and pictures for
  the screen. A fix must not make grading or scrolling worse; say how
  you checked.
- The safety guarantees of slice 5 are unchanged. If the rename and
  Undo times come from the record-first safety steps, report that and
  leave them.
- No new behaviour, no new settings, no new messages unless a fix
  cannot be made without one; if so, list it.
- Keep slices 1 to 6 working and their checks intact.
- Keep each source file's existing line endings.
- Small local commits, each undoable alone. Do not push. **Do not build
  the installer.**

## Working unattended

Steve may be away. Do not stop to wait for answers. Where something is
not specified, choose the simplest option that fits the existing
Library, keep it easy to reverse, and add it to a "Decisions made for
Steve" list for one final report. Hard stops (leave that one item
unbuilt, record why, carry on): anything in the strict area above;
anything that weakens a slice 5 guarantee; slow tests for one part
heading past roughly 30 minutes; a check that fails because of your
change and cannot be fixed without loosening it.

## Testing

Follow `AGENTS.md`: fast checks on every change, and the focused
Electron check that covers what you touched. This brief asks for
focused timing runs, which is more than a usual change gets, because
measuring is the task; keep them to the items in the table and do not
run the broad timing sweeps. Timing runs use 2560x1440, one at a time,
on a warm disk, and say so.

## Documentation

Record the ranked list, the before and after times and the packaged
check result in `docs/technical/photo-library.md`, in one section a
future reader can find. In the PRD, section 8, replace the single
"Performance to revisit" note with what was fixed and what is left for
the full pass. Note the packaged result against foundation item F3,
which has been waiting for it.

## Final report to Steve

Plain language, short:

- does the Library work when packaged, yes or no, and what was fixed;
- the ranked list of waits, with before and after for each one fixed;
- what he should try, to feel the difference;
- the items that need his choice, one at a time, each with its
  trade-off and what could break;
- the "Decisions made for Steve" list;
- what was run and anything that failed.
