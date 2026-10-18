# Codex Brief — Opening a Photo in Grade from the Library
## HDR Finisher

**Date:** October 12, 2026
**Branch:** `photo-library` only.
**Read first:** `AGENTS.md`, then
`docs/technical/library-speed-architecture.md`.
**Order:** after the saved-picture bug brief
(`codex-brief-library-saved-picture-never-updates-2026-10-12.md`).

## Goal

Steve double-clicks a thumbnail in the Library. Today the Library stays on
screen with no obvious response for many seconds, then Grade appears. It
feels as if the app has hitched.

When this is done:

1. **The double-click answers at once.** Grade is in front within a moment
   of the click, showing which photo is loading and that it is loading.
2. **The real picture arrives much sooner** than today, by removing repeated
   and unnecessary work, without changing what the picture is.

Part 1 matters more than Part 2. Do it first.

## Context

Claude read the path and timed the backend on a disposable 42 MP ARW copy
(warm disk, `.venv` Python, no profiler unless stated). Trust levels are
marked. You have the code; where it disagrees, the code wins and you say so.

**How it behaves today (read from the code):**

- The switch to Grade happens only after the import job, the session
  fetch, the grade attach and any saved-grade load have all finished. The
  progress text is written to the Grade canvas, which is hidden while the
  Library is in front.
- Nothing is shown as a stand-in. The Grade canvas is empty until the
  first real frame.
- The steps run strictly one after another, including some that do not
  depend on each other.

**Repeated or unused work (read from the code; the first item checked by
Claude in `projects.py` and `library_grade_api.py`):**

- **A photo with a saved grade is fully decoded twice.** The import job
  decodes it, then loading the saved grade opens the document, which
  creates a new session and decodes it again. Since Autosave is on by
  default, this is the normal case for any photo Steve has touched.
- The 85 MB source is hashed up to three times on that path.
- The import job first asks the Library helper for a 512 px thumbnail and
  waits for it. Nothing in the frontend appears to use the result.
- A full-source noise estimate is started on every open, even with Denoise
  off.
- The first preview image is reduced twice, and its cache file is written
  and the cache folder pruned before the response is sent.
- The job is polled every 250 ms, sleeping before the first poll.

**Measured (one decode, with a profiler attached, so the absolute numbers
are inflated; the proportions are the point):**

| Stage | About |
|---|---|
| Whole open of one RAW | 4.5 s clean, about 6 s under the profiler |
| Demosaic (turning the RAW into a picture) | 0.9 s |
| Transport diagnostics | 1.1 s |
| HDR classification and BT.2020 peaks | 1.1–1.5 s |
| Negative-value mapping | 1.0 s |
| RAW corrections | 0.9 s |
| Colour conversion and normalisation | 0.8 s |
| Hash and peak candidates | 0.6 s |
| First 1920 px preview source after the open | 2.0 s |

So under 1 second of a roughly 6-second open makes the picture. The rest
measures or checks the full-size image, one pass after another, on one
core. With the double decode and the first preview source, a photo with a
saved grade spends an estimated 12 seconds or more in the backend before
its first frame. That total is an estimate, not a measurement.

## Part 1 — the click answers at once

| Moment | What Steve sees |
|---|---|
| Double-click | Grade comes to the front straight away. |
| While loading | The status bar says the photo is loading, by name. The preview is empty; nothing from the previous photo is left on it. |
| Real picture ready | It appears in the preview and the loading message clears. |
| Controls while loading | Clearly not yet usable, and not able to record an edit before the photo is there. |
| Something else must be settled first | A question about the previous photo (unsaved changes with Autosave off, a conflict) is asked before leaving, as today. |
| The open fails | He is told why in plain words and is taken back to the Library, on the same photo. |
| He changes his mind | Opening a different photo, or going back to the Library, cancels the first open cleanly. |

Scopes and readouts stay empty until the real picture is there.

**Not in this brief (decided by Steve, October 12):** showing the Library's
picture of the photo in the preview while it loads. It is kept as an option
for later. Do not build it, but do not make it harder to add: the loading
state should be one clear state that a picture could later be shown in.

## Part 2 — the real picture arrives sooner

**Required outcomes:**

- A photo is decoded once per open, whether or not it has a saved grade.
- Its source is hashed once per open.
- Work whose result nobody uses is not done on this path.
- Steps that do not depend on each other do not wait for each other.
- The first real frame does not wait for anything it does not need. Work
  that only feeds scopes, readouts, Denoise or later zoom levels happens
  after the first frame.

**Investigate and report before changing (strict area):**

The measuring passes in the table above produce numbers that Grade,
export or Proof may rely on. For each pass, find out and report:

- what uses its result, and whether the first frame needs it;
- whether it can run after the first frame, or beside the others, with
  exactly the same result.

You may reorder or overlap passes only where every result stays
bit-for-bit the same. If a saving would need a different number, a
different method or a reduced image, do not make it. Report it to Steve
with the saving and what it could affect.

**Targets** (Claude's estimates; replace them with measurements):

| Moment | Today | Target |
|---|---|---|
| Click to Grade in front, loading shown | several seconds | under 0.5 s |
| Click to real picture, photo with a saved grade | 12 s or more (estimate) | 4 s or less |
| Click to real picture, photo never opened | about half that | 4 s or less |

Extend the stopwatch from round 1 to cover this path, so the before and
after numbers come from the log: click, Grade in front, loading shown,
each open stage, first real frame, controls usable.

## Constraints

- No change to what the decode produces, to CPU export, Proof, any pinned
  shader, tolerance, limit or budget. The real picture for a given photo
  and grade is identical before and after.
- The saved grade, recovery of unsaved work, conflict handling and the
  unsaved-changes question keep working exactly as today.
- Opening from the file picker, drag and drop, and a project file still
  works. Those may share the improvements but must not regress.
- Never write to Steve's photo folders or the read-only test projects.
- No embedded-picture, cache-layout or queue-redesign work from later
  rounds of the architecture note.

## Testing

Follow `AGENTS.md`. Fast checks, plus the focused checks that cover opening
from the Library, saved-grade load, recovery and conflict, once for the
group, in development and the unpacked packaged build. Because Part 2
touches the open path, show with a check that the opened image and its
measurements are identical before and after. No full sweep, installer or
push.

## Report to Steve

Plain language: the before and after times from the log; what was removed;
which measuring passes could not be moved and why; any saving that needs
his decision, one at a time with its trade-off; what to try in the app.

Small local commits, Part 1 separate from Part 2. Ask before pushing.

## Questions protocol

If anything here conflicts with the code, or an outcome cannot be met
without touching a constrained area, stop that part, report the options
with their trade-offs, and carry on with the rest.
