# Codex Brief — Library Speed, Round 1: Stopwatch, Map Stall, Saved-Grade Picture
## HDR Finisher

**Date:** October 12, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then
`docs/technical/library-speed-architecture.md` (the whole file; it is short),
then section 15 of `docs/technical/photo-library.md`.

## Goal

Steve finds Library waits 1 to 6 in section 15 far too long against other
photo apps. The architecture note sets out why and what to build, in five
rounds. This is round 1. It has three parts:

1. **A built-in stopwatch**, so every later round is judged from a log and
   the unexplained half of the 20-second launch is located.
2. **The exposure-map stall is reproduced and removed.**
3. **A grade saved in Grade shows in the Library in about 2 to 3 seconds**,
   down from 14 to 16, with identical output.

Rounds 2 to 5 (first-draw warm-up, embedded pictures first, one ranked
queue, launch) are not part of this brief. Do not start them.

## Context

Claude measured and read the following. Each item says how far to trust it.
You have the code; where it disagrees with this brief, the code wins and
you say so.

- **Measured** (disposable 42 MP ARW copy, warm disk, `.venv` Python): the
  corrected open that the kept picture uses takes 8.3 s under helper
  conditions and 4.5 s without them. Shrinking an already-open image of
  that size to 1024 px takes 0.45 s.
- **Read from the code, not run:** when Grade saves, the main backend holds
  the same photo's session with its corrected image in memory. The kept
  picture is nevertheless made by the helper re-opening the file.
- **Read from the code, not reproduced:** kept pictures and overlay maps
  share one helper thread. That lane waits while a folder check is
  running; a folder check that has started waits until nothing of that
  lane is queued. With one job running and a second queued when a timed
  folder check starts, none of the three appears able to continue until
  something is cancelled. This fits section 15's stall (four maps ready,
  two pending) but is a hypothesis.
- **Read from Codex's recorded runs:** the first Library draw after launch
  takes about 3 to 6 s and later draws about 0.03 s. The first four picture
  decodes in a fresh helper each report about 5 s with a 12 ms spread,
  which points to one shared blocker and not four slow decodes.
- **Measured:** backend load about 2.4 s, then helper start about 0.9 s,
  one after the other, before a window exists. That and the first picture
  explain roughly half of the launch time. The other half is unknown.

## Part 1 — stopwatch

When this part is done, one launch of the app and a few minutes of ordinary
Library use leave a record from which a reader can answer, without adding
any instrument:

| Question | The record must show |
|---|---|
| Where does launch time go? | A single timeline from app start to first Library picture on screen: app ready, backend process started, backend ready, helper ready, window created, page loaded, Library page ready, folder listed, first picture requested, first picture answered, first picture drawn. |
| Is the first draw the slow one? | Time for renderer setup and for the first draw, separately from later draws. |
| Is a picture waiting or working? | Per picture request: time queued in the page, time queued in the helper, time decoding, time storing, time fetching pixels, time drawing. |
| What did a saved-grade picture cost? | Time from save to kept picture written, split into source, render and encode, and time until the Library showed it. |
| Did the helper step aside? | Each pause and resume, and any job that was cancelled after it had started work. |

It must be always on, cheap enough to leave on, and written where the
existing Library events already go. Keep it to one line per event. It must
not record anything from a photo beyond its path, which the existing log
already holds.

Then run one development launch and one packaged launch on a disposable
profile with the disposable 42 MP copies and report the launch timeline for
each. Name the largest stages. That report decides round 5; do not fix
launch here.

Also report, from the same record, whether the first-draw cost and the
shared 5-second first decodes are confirmed, and what each is actually
spent on. Investigation and report only; fixing them is round 2.

## Part 2 — the map stall

**What's broken:** with the exposure overlay on for a row of six photos,
one packaged run had four maps appear and two still pending after
60 seconds.

**What should happen:** every requested map arrives. A queued map or kept
picture is never left waiting indefinitely, whatever else the helper is
doing.

**What to do:** reproduce the stall first with a focused check that fails
on the current code. Start from the hypothesis in Context; if it is wrong,
find the real cause and say so. Then fix it so that the check passes.

The architecture note (3.5) describes one ranked queue as the eventual
shape. Do not build that here. The fix for this round should be the
smallest one that makes the mutual wait impossible, and it should not make
round 4 harder.

Keep: folder checks and indexing still give way to pictures on screen, and
the helper still steps aside while Grade is working.

## Part 3 — saved-grade picture from the open photo

**Outcome:** Steve opens a photo from the Library in Grade, changes it,
saves, and returns to the same Library. The edited picture replaces the old
one within about 3 seconds of the save on the 42 MP test files, in
development and packaged. He does not browse away and back.

**Decision already made (architecture note 3.3):** the kept picture for a
save made in Grade is rendered from the corrected image Grade already has
open, reduced to the kept size. It is not made by opening the file again.
This is a change of where the source comes from, not of how the picture is
rendered.

Required to hold:

- **Same picture.** For the same photo and grade, the kept picture made
  this way matches the one made by today's route. Show this with a check
  that compares the two. If they cannot match exactly, stop and report the
  difference and its cause before going further; do not loosen anything to
  make it pass.
- **Saving stays quick.** The save itself returns as fast as it does today.
  Making the picture does not hold up the save or the next edit.
- **The right photo.** If Steve opens a different photo, or edits again,
  before the picture is finished, the Library never shows a picture for the
  wrong photo or an out-of-date grade. Today's guards against that (grade
  identity, source size and date, superseded jobs) keep working.
- **Memory.** Making the picture does not keep a second full-size copy of
  the photo alive after it is done.
- **Other cases still work.** A revert with no photo open, virtual copies,
  and the request route have no open image. They keep today's route. Do not
  speed them up in this round.

Leave the encode step as it is. It belongs to the export code.

If the time is still well above 3 seconds after this, report where the
remainder goes from the Part 1 record. Do not chase it further.

## Constraints

- No change to CPU export, Proof, any pinned shader, tolerance, limit or
  budget, the gain-map writer, the RAW decode route or its corrections.
  Part 3 calls the existing render functions exactly as today.
- No change to slice 5's records, flushes, checksums or verification.
- No new setting, preference or message for Steve to manage.
- No embedded-picture, cache-layout, renderer, queue-redesign or launch
  work. Those are later rounds.
- Never write to Steve's photo folders or the read-only test projects. Use
  disposable copies and disposable profiles.
- The stale slice-2 wording check (expects "Library index up to date"; the
  heading is now "Activity") may be updated to the current wording so that
  the rest of that check runs again. Wording only.

## Testing

Follow `AGENTS.md`. Fast checks for the group, plus the focused Library
checks that cover saving a grade, kept pictures, overlay maps and folder
checks, once for the group, in development and in the unpacked packaged
build. No full sweep, no installer, no push.

## Report to Steve

Plain language, short:

- the two launch timelines and the largest stages;
- whether the stall was reproduced, what caused it, and that it is gone;
- save-to-picture time before and after, development and packaged;
- whether the first-draw and first-decode costs were confirmed, and on
  what;
- anything that failed, in one line each;
- what he should try in the app.

Small local commits, one per part. Ask before pushing.

## Questions protocol

If anything here conflicts with the code, or a required outcome cannot be
met without touching a constrained area, stop that part, report what you
found and the options with their trade-offs, and carry on with the other
parts.
