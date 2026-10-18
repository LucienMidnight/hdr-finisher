# Codex Brief — Photo Library Slice 5: Finish Rename, Move and Delete
## HDR Finisher

**Date:** October 12, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then
`docs/technical/archive/briefs/codex-brief-library-slices-5-6-2026-10-12.md` (the
outcome spec for Stages B, C and D there still stands), then the slice 5
notes in `docs/technical/photo-library.md`, including your own "Hard
stop for stages B, C rename/move, and D".

## What changed

You stopped, correctly, because the earlier brief asked you to prove
that no interruption could ever separate a photo from its settings
file, and Windows cannot change two files as one step. That bar was set
too high by the brief, not by Steve. He has now agreed a guarantee that
can be met. Build the remaining commands to it.

## Goal

Rename a photo, move photos, rename and move a folder, Delete and Delete
all rejected all work, as specified in Stages B, C and D of the earlier
brief. Stage A, the independent folder controls and smart albums are
done and stay as they are.

## The guarantee (Steve, October 12)

**Nothing is ever lost or overwritten. A photo and its settings file may
be apart for a short time after an interruption, and the app reunites
them at its next start or says plainly that it could not.**

In detail:

| Situation | What must be true |
|---|---|
| Before any original or settings file is touched | The app has durably recorded what it is about to do, for every photo in the command. |
| A command runs to the end | Photo and settings file are together at the new place (or both gone, for delete), and the record is cleared. |
| The app, the PC or the drive stops part-way | At the next start the app reads its record and finishes the job for each photo: the settings file follows its photo. It then tells the user once what it finished. |
| Finishing is not possible (the place is now occupied, the drive is absent, a file is locked or was changed by something else) | Nothing is overwritten and nothing is guessed. Both files stay where they are, the item appears in Needs attention naming both locations, and it is retried when the cause clears, as waiting settings writes are today. |
| Something else now has the photo's old name | Recovery never moves anything onto an occupied name. It only completes forward. |
| Settings were waiting to be written for that photo | They are written first or carried with the record, so no mark or grade is lost and none is written to the old place afterwards. |
| The helper answers late about the old path | The answer is discarded; it must not recreate an entry, a picture or a settings file at the old place. |
| Delete, interrupted after the photo went but before its settings file | At the next start the leftover settings file goes the same way. If the photo is back by then (restored from the Recycle Bin), the settings file is left alone. |
| A cross-drive move | Copy, check the copy, then remove the original, under a name that cannot be mistaken for a finished photo until it is checked. An interruption leaves each photo whole in one place or the other. |

**Accepted by Steve, so do not treat it as a hard stop:** after a power
failure part-way through, a photo can sit without its settings file
beside it until the app is next started. If the user moves things by
hand in Explorer in that window, the grade can be orphaned; the app
then reports it in Needs attention and does not guess. Say this plainly
in `photo-library.md`.

Undo follows the same guarantee: it is a move back, recorded first, and
never overwrites.

## Still a hard stop

Leave the one item unbuilt, record why, and carry on with the rest, if:

- a route remains by which a photo or settings file could be destroyed
  or overwritten (not merely separated);
- a delete could remove a photo without the confirmation in the spec,
  or permanently when the window said Recycle Bin;
- anything would change Grade's rendering, export, Proof, an existing
  shader or a pinned tolerance, limit or budget;
- slow tests for one stage are heading past roughly 30 minutes;
- a check fails because of your change and cannot be fixed without
  loosening it.

## Working unattended

As in the earlier brief: do not stop to wait for answers. Choose the
simplest behaviour that fits the PRD, the mock-up and the existing
Library, keep it easy to reverse, and add it to a "Decisions made for
Steve" list for one final report.

The earlier brief's defaults still apply: the photo open in Grade is
left alone with a message; a folder moves only within the same drive;
background work that can be remade is cancelled and the command
proceeds; a photo with more than one settings file is left where it is
and reported; folders are never merged; nothing is ever overwritten.

## Testing

Run every file command only on disposable folders made for the test.
Never on Steve's real photo folders or the read-only test projects.
`D:\test-photos-delete-later` holds six real Sony ARW files that Steve
set aside for this; copy from it into a disposable folder if you want
real RAW files in a check, and run the commands on your copies.

The fast data checks listed in the earlier brief still apply. For the
guarantee above, the interruption checks are the heart of this work:
stop the command at each point between "record written", "photo
changed", "settings file changed" and "record cleared", for rename,
same-drive move, cross-drive move, folder rename and delete, then start
again and show that every photo and every settings file exists exactly
once, together, with marks, grade, virtual copies and albums intact, or
is reported with both locations. Include: the old name taken by another
file before restart; the destination settings name taken; a restored
delete; a late helper answer for the old path; settings waiting to be
written when the command began.

One focused Electron check per stage for the visible part, including
each confirmation window's wording and the no-Recycle-Bin case.

## Documentation

Replace your hard-stop note in `docs/technical/photo-library.md` with
how each command works, the guarantee in plain words, what the user
sees after an interrupted command, the messages table and log events.
Mark slice 5 fully built in the PRD, section 8. Update the code map.

## Final report to Steve

Plain language, short: what now works; what to try first, on a copy of
a real folder; the "Decisions made for Steve" list, one at a time; any
hard stop reached; the new messages; what was run and anything that
failed.
