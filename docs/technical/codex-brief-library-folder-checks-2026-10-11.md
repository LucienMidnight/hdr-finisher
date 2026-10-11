# Codex Brief — Photo Library: Keeping Folders Current (Slice 2b)
## HDR Finisher

**Date:** October 11, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then `docs/technical/photo-library.md`
(the helper, background indexing, Activity and diagnostics sections), then
"Keeping folders current" in section 5.18 of
`docs/product/Photo_Library_PRD_2026-10-09.md`. Where this brief and those
pages disagree, ask.

## Goal

A pinned folder stays current while the app is running. The case to
design for: Steve pins an "intake" folder, leaves the Library open, and
drops photos into that folder from Explorer. They appear in the Library
without him doing anything. It does not have to be instant. When he wants
it sooner, one action checks the folder or folders he has selected, ahead
of other background library work, without re-scanning the whole library.

## Context

- Today a folder is read when the Library first loads, when it is pinned,
  when it is clicked, and on "Re-scan pinned folders now". Nothing is
  noticed in between. This is the one part of slice 2 that was not built.
- An indexing pass already skips files whose size and modified date are
  unchanged, already runs in the helper on a lane that gives way to
  visible Library work and to Grade and export, and already reports
  through Activity, the health command and the library log. Build on
  that; do not make a second indexing system.
- The backend is the only writer of the database and of settings files.
  The helper reads only.
- Steve is not a coder. He judges this by using the app on his real
  folders, including external and network drives.

## Decisions already made (do not reopen)

Steve, October 11:

- Pinned folders keep themselves current while the app runs. Folders
  that are not pinned are read when opened, as today, and are not checked
  in the background.
- Timed checks are enough. Instant notification from Windows is not part
  of this work. Do not add a file-system watcher.
- A user action checks sooner. It acts only on the selected folder or
  folders and goes to the front of the queue.
- A requested check still gives way to Grade and export, like all library
  work. It runs ahead of background indexing and timed checks, and
  alongside settings writing.

## Outcome spec

### Timed checks

| What | Should be true |
|---|---|
| The folder on screen | Checked about every 15 seconds for as long as it is on screen, whether pinned or not. |
| Every other pinned folder | Checked about every 5 minutes, one folder at a time. |
| A slow drive or a very large folder | Checked less often on its own: after a check, the next one for that folder waits at least ten times as long as the check took. No setting. |
| A check that finds nothing | Writes nothing, shows nothing in Activity, and adds no routine log line. |
| A check that finds changes | Only the new or changed photos and settings files are read. The rest of the folder is not read again. |

The 15 seconds and 5 minutes are Claude's starting proposal, not
measured. **Measure one check** on a folder of about 50,000 photos on a
local drive, and on a network share if one is available, and report the
times and whether the numbers should change (PRD open decision 27). If
the periods as written would visibly cost anything while Steve is
browsing or grading, say so and propose different ones.

### What a check notices

- Photos added, removed, renamed or replaced from outside the app.
- New sub-folders, and sub-folders removed.
- Settings files added, changed or removed by something else (a sync
  tool, another machine), so marks, tags and albums made elsewhere show.
  The existing rules for unreadable files, conflict copies and marks
  waiting to be written still apply unchanged.

### A photo still being copied in

It is not shown until its size has stopped changing from one check to the
next. A half-copied file must never appear as broken or unreadable, and
must not be recorded as a problem under Needs attention.

### What Steve sees when photos arrive

- New photos take their place in the current sort order and respect the
  current filters. Album and tag views and counts stay correct.
- The selection, the scroll position and the photo being looked at stay
  where they are, in the grid, the filmstrip, single view, review and the
  pop-out window. Nothing jumps.
- A photo that disappeared while selected or on screen is handled
  quietly: the selection moves to a neighbour and nothing errors.
- The bar says once, quietly, how many arrived and where, for example
  "12 new photos in Intake". One line per check, not one per photo.

### "Check for new photos"

- Available on a folder's right-click menu in the pinned tree, for one
  folder or several selected together, and on the Library toolbar for the
  folder on screen. Sub-folders are included.
- It checks only those folders. "Re-scan pinned folders now" stays in
  Activity as the whole-library action.
- It starts promptly even when a long first index of another folder is
  running. That other work continues afterwards from where it was; it
  does not start again from the beginning.
- While it runs, Activity shows it. If Grade or export is holding it,
  Activity says that, in the same plain style as the existing wording.
- When it finishes, the bar says what it found, including when it found
  nothing, so the user knows it ran.

### When checks stop and start

| Situation | What happens |
|---|---|
| Background indexing switched off | Other pinned folders are not checked. The folder on screen still is. |
| Indexing paused by the user | Timed checks wait. A requested check still runs. |
| Grade or export busy | All checks wait, as other library work does. |
| Drive not connected | That folder is skipped. Its entries are kept. It is checked straight away when it comes back. |
| Library popped out to its own window | Works the same there. |

### Diagnostics

Failures and recoveries follow the existing library log marker and event
naming, show through Activity and Needs attention where the user can act
on them, and appear in the health command. The health command also says
when each pinned folder was last checked. Add what a reader of the log
needs to answer "was this folder checked, and what did it find?" without
a line for every empty check.

## Constraints

- Originals and settings files are never written, renamed, moved or
  deleted by a check. A check only reads.
- The backend stays the only writer of the database. The helper must not
  write.
- Grading and export must not feel slower. Browsing must not stutter
  when a check runs.
- Do not change Grade, export, Proof, any shader, or the picture decode
  routes.
- Not part of this work: a file-system watcher, the Library settings
  page, processor-use and battery settings, leaving chosen pins out,
  dimmed offline thumbnails, importing conflict copies, persistent undo.
- Follow `docs/design/HDR_Finisher_Design_Guidelines.md`. Keep the new
  control simple; Claude will refine the look afterwards. Do not redesign
  the toolbar, the folder menu or the bottom bar.
- Pre-1.0 rule: no migration code. If the database layout changes, say in
  one line what happens to an existing `library.sqlite3`.
- Keep each source file's existing line endings (see `AGENTS.md`).
- Small local commits, each undoable alone. Do not push. Do not rebuild
  the installer.

## Testing

Follow `AGENTS.md`: fast checks on every change. Nothing here touches
export, Proof or a pinned shader, so no broad GPU sweeps.

Add fast data checks, in the style of the existing library tests, that
prove the behaviour without the interface. At least:

- a photo added to a pinned folder outside the app appears after a timed
  check, with nothing else in the folder read again;
- removed, renamed and replaced photos, and a settings file changed
  elsewhere;
- a file whose size is still changing is held back, then appears;
- a requested check on one folder runs ahead of a long index of another,
  and that index then continues without starting again;
- a slow check lengthens that folder's own wait and no other folder's;
- each row of the "when checks stop and start" table;
- an empty check writes nothing to the database.

Tests must not wait on real 15-second or 5-minute timers.

One focused Electron check at 2560x1440 for the visible part: photos
copied into the folder on screen appear without the selection or scroll
position moving, and "Check for new photos" works from the folder menu
and the toolbar. Use disposable folders only.

Then ask Steve to try it on a real intake folder; how it feels is his
call.

## Documentation

In the same change as the code, update `docs/technical/photo-library.md`:
the background indexing section, the Activity and messages tables, the
log event list, and remove folder watching from the known gaps. In the
PRD, mark slice 2b built in section 8 and record the measured check times
against open decision 27.

## Report to Steve

Plain language, short:

- what now works, and what he should try;
- the measured check times and your recommendation on the two periods;
- anything that behaves differently from this brief, and why;
- any new decision he needs to make, one at a time, each with its
  trade-off;
- the new messages, for his review;
- what was run, and anything that failed.

## Questions protocol

You have the code; this brief describes outcomes, not how to reach them.
If an outcome here conflicts with how the code actually works, or two
outcomes conflict with each other, stop and ask before building. Do not
invent a new product behaviour to resolve it. If something would take
much longer than its value suggests, say so and propose the smaller
version.
