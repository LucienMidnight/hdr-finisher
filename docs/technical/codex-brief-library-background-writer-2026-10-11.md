# Codex Brief — Photo Library: Background File Writing, Recovery and Diagnostics
## HDR Finisher

**Date:** October 11, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then all of
`docs/technical/photo-library.md`. That page describes exactly how the
library saves marks today (sections 4 to 8), its known gaps (section 11)
and the design Steve agreed to (section 12). This brief asks you to build
section 12 and close the gaps. Where this brief and that page disagree,
ask.

## Goal

A change to ratings, picks, labels, tags or albums takes effect in the
library at once, however many photos it covers. The `.hdrf` settings files
are then brought up to date in the background. If the app crashes, is
killed, or loses a drive part-way, nothing is lost and the remaining files
are finished later without the user doing anything. Ctrl+Z works
immediately, including while files are still being written, so an
accidental change to 1,000 photos can be taken back straight away.

Whenever any part of this goes wrong, there is a record of it: in the app
where the user can act on it, and in the log where Steve and Claude can
find out later what happened and why.

## Context

- Today a mark command holds everything until every settings file has been
  written. Nothing else in the library can read or write marks meanwhile,
  there is no progress, and the command cannot be undone until it ends.
- The database already saves the whole change in one all-or-nothing step
  and flags each photo as not yet written (`pending`). That flag is the
  starting point for this work: it is already a durable list of files still
  to write. Today nothing ever works through that list.
- The backend is the only writer of the database and of settings files. The
  helper process reads only. Tests in `tests/test_library_marks.py`,
  `tests/test_library_collections.py` and `tests/test_library_worker.py`
  pin the current behaviour.
- Steve is not a coder. He finds problems by using the app on his real
  photo folders, including external and network drives.

## Decisions already made (do not reopen)

- **Mark changes save to the library at once; files catch up in the
  background; Undo is the cancel.** Steve, October 11.
- **The background writer always writes a photo's current marks,** not the
  marks of one particular command. This is what makes it safe to interrupt,
  repeat and reorder, and it is why no log of commands is wanted. Do not
  build a command journal or replay mechanism.
- **The backend stays the only writer** of the database and settings
  files. The helper process must not write either.
- **The settings file stays the lasting record,** with the rules in
  sections 3 and 5 of the library page: unknown fields are kept, an
  unreadable file is never overwritten, a file is never left half-written,
  originals are never touched.
- **Accepted cost:** for a short time after a large change, the files lag
  behind what the app shows.

Also confirmed by Steve on October 11:

| Question | Decision |
|---|---|
| Marks waiting for a drive that was unplugged, or a folder that was read-only (settles PRD open decision 25) | Written automatically when the folder is next found connected and writable, and reported when it happens. |
| A settings file was changed by something else while the library had unwritten marks for that photo | The library's marks and albums are written, every other field in the file is kept, and the event is reported and logged. It must never happen silently. |
| Undo history after a restart | Still lost, as today. Out of scope here. |
| Where progress shows | One Activity item at the right end of the bottom bar (see below). |

## Outcome spec

Work in three stages. Each ends with the app usable, the fast checks
passing and a short plain report to Steve.

### Stage A — the library changes at once and files catch up

**Changing marks**

- A mark, tag or album command returns as soon as the library has the
  change. The grid, Details, tag counts and albums show it immediately.
  This must feel instant for one photo and prompt for 10,000. Report the
  time you measure for 1,000 and 10,000 photos on a local drive.
- While files are being written, the library stays fully usable: browsing
  other folders, reading marks, and making further changes, including to
  the same photos.
- A photo changed several times in quick succession ends with its latest
  marks in its file. Earlier states need not each be written.
- Before the change is accepted, readable settings files of connected
  photos are still checked, and an unreadable one still stops the whole
  command before anything changes, as today.

**Undo**

- Ctrl+Z is available the moment a command returns and reverts the library
  at once, as one step, even if no file or only some files have been
  written.
- Files already written with the undone marks are put back. Files not yet
  reached never receive the undone marks.
- If some photos in the step can no longer be found, the rest are undone
  and the result says how many were skipped. Undo is no longer refused as
  a whole.
- A photo that had no settings file before a change, and whose change is
  undone before its file was written, should not gain an empty settings
  file.

**Interruption**

- If the app is closed, crashes, is killed or the machine loses power at
  any point, then on the next start: the library shows the change on every
  photo, the remaining files are written without the user asking, and the
  user is told once, in plain words, what was finished and how many photos
  it covered.
- Closing the app while files are still to be written does not prompt and
  does not lose anything.
- Stray temporary files left beside photos by an earlier interruption are
  removed. Only files that are unmistakably the app's own temporary
  settings files may be removed.

**Things that stop a file being written**

Each of these leaves the photo's marks safe in the library, keeps it on
the list of files to write, and is distinguishable from the others both in
the app and in the log.

| Case | What should happen |
|---|---|
| File briefly locked by another program (antivirus, a sync tool, Explorer) | Tried again a few times shortly afterwards without bothering the user. If it stays locked it is reported, and tried again later. |
| Disk full | Writing pauses for that drive with one message, not one per photo. It resumes when there is room. |
| Folder cannot be written (memory card, read-only share) | Reported once per folder. Described as "cannot be written", and no longer confused with "not written yet". |
| Drive unplugged or folder missing | Waits. Written when the folder is next connected, and reported then. |
| Photo deleted or moved outside the app | Taken off the list and counted. Its entry does not linger. |
| Settings file became unreadable since the change | Left untouched, as the rules require, and reported with the photo's name. |
| Settings file changed by something else meanwhile | As decided above: the library's marks win, the rest is kept, and it is reported. |

One failing photo or folder must never hold up the others.

**Details panel**

The Settings line tells these states apart in plain words: written beside
the photo; waiting to be written; cannot be written, with the reason; none
yet.

### Stage B — seeing what is happening, and what went wrong

**Activity item**

- One item at the right end of the bottom bar, where the indexing item is
  now. Indexing moves into it. It must not crowd out Grade's own messages.
- At rest it is quiet. While background work runs it shows the most
  important job with a count, for example "Writing settings: 312 of 1,000",
  and a small "+1" when other jobs are running.
- A click opens a list of every background job with its progress and the
  controls that make sense for it: indexing keeps Pause, Resume and Re-scan;
  file writing has Pause and Resume, and no Cancel, because Undo is the way
  back.
- The same list has a **Needs attention** part: photos or folders whose
  files could not be written, grouped by folder and reason, each with a
  plain explanation and a Try again action. It clears itself when the
  problem clears.
- After a bulk mark change the bar confirms it with the count and an Undo
  action, for example "Rated 1,000 photos · Undo".
- Follow `docs/design/HDR_Finisher_Design_Guidelines.md`. Keep the look
  simple; Claude will refine it afterwards. Do not redesign the bottom bar.

**Diagnostics — this is a firm requirement, not a nicety**

Steve and Claude must be able to tell, after the fact, that something in
the library broke, what it was and which photos it touched.

- **Every failure path in the library leaves a line in `logs/backend.log`.**
  Not only the new writer: marks, tags, albums, undo, indexing, the helper
  and the picture cache. Each line says what was being attempted, the photo
  or folder, the underlying reason as the system reported it, and what the
  app did about it.
- **Lines are easy to find.** Use one consistent, searchable marker for
  library lines and a stable short name per kind of event, so that a
  search of the log answers "did this ever happen?".
- **Ordinary milestones are logged too,** briefly: a start-up summary (how
  many files were waiting, how many temporary files were removed), the
  start and end of each bulk change with counts and duration, each time
  writing pauses or resumes and why, the helper stopping and restarting,
  indexing giving up or recovering.
- **A flood is summarised.** 10,000 failures for one cause are one line
  with a count and a few example paths, not 10,000 lines.
- **Nothing is swallowed silently.** Review the existing library code for
  places where an error is caught and dropped, and make each one either
  log, report to the user, or both. Tell Steve in the report which ones
  you found.
- **One place to read the library's health.** A backend command returns
  the current picture: files waiting, files that cannot be written with
  counts per reason, whether the helper is running and how many times it
  has restarted, the indexing state, and the most recent problems. The
  Activity list reads from it, and it gives Claude one thing to ask for
  when Steve reports a problem.
- **The user sees what they can act on,** in plain language that names the
  photo or folder and says nothing was lost. Raw technical text, such as
  today's "1 validation error for Marks", must not reach the user; the
  technical detail goes to the log.
- **Developer detail stays out of the way.** Anything too noisy for normal
  use goes behind the existing development switches, not into the bar.

Draft the user-facing wording in the style of PRD Appendix B and list every
new or changed message in your report for Steve to review.

### Stage C — the remaining gaps

| Gap today | What should be true |
|---|---|
| Marks cannot be changed on a photo whose drive is not connected | They can. The library changes at once and the file waits for the drive. |
| A tag or album command skips photos that are not connected, so the old name lingers in the list | The command reaches every photo in the library. Files on drives that are not connected wait. The old name is gone from the list. The result still says how many files are waiting for a drive. |
| If the helper process stops, the library fails until the app is restarted | The helper is started again automatically and waiting requests recover. If it keeps failing, it stops trying after a sensible limit, the user is told plainly, and Grade stays unaffected throughout. Every stop and restart is logged with the reason. |
| Indexing gives up for the rest of the session after repeated failures, and Re-scan then does nothing | Indexing recovers on its own when the cause clears, and Re-scan always works. Giving up, if it happens at all, is visible in the Activity item and in the log. |
| A second settings file for one photo (a sync conflict copy) is ignored | It is detected and reported under Needs attention with both file names. Nothing is merged, renamed or deleted. Bringing it in as virtual copies is a later slice. |
| An invalid value inside a settings file produces raw technical text with no photo name | A plain message naming the photo, in line with the other "left untouched" messages. |

## Constraints

- Originals are never written, renamed, moved or deleted by this work.
- A settings file the app cannot read is never overwritten, and a settings
  file is never left half-written. Unknown fields in a settings file are
  kept.
- No change may be recorded as written beside the photo unless it is.
- Grading must not feel slower while files are being written or the helper
  is restarting. If file writing needs to give way to Grade, make it do so.
- Do not change Grade, export, Proof, any shader, or the picture decode
  routes.
- Do not add folder watching, persistent undo, virtual copies, file moves
  or exports. They are separate slices.
- Pre-1.0 rule: no migration code. If the database layout changes, say in
  one line what happens to an existing `library.sqlite3`. If an existing
  database could hold marks that were never written to a file, do not
  discard them without telling Steve first.
- Keep each source file's existing line endings (see `AGENTS.md`).
- Small local commits, each undoable alone. Do not push. Do not rebuild
  the installer.

## Testing

Follow `AGENTS.md`: fast checks on every change; nothing here touches
export, Proof or a pinned shader, so no broad GPU sweeps.

Add fast data checks, in the style of the existing library tests, that
prove the behaviour above without needing the interface. At least:

- an interruption at each point of a bulk change, followed by a restart,
  ends with every file correct;
- undo before, during and after file writing;
- each row of the "things that stop a file being written" table, and
  recovery when the cause clears;
- one failing photo does not hold up the rest;
- a change to photos on a folder that is not connected, then reconnecting;
- temporary-file clean-up removes only the app's own files;
- the helper restarting, and indexing recovering;
- each failure leaves its log line, and a flood is summarised.

Existing checks that pin behaviour this brief deliberately changes (for
example a tag command leaving unconnected photos alone, or undo failing as
a whole) should be updated to the new behaviour and named in your report.
Do not loosen any other check.

If the Activity item needs one interface check in Electron, run that one.
Then ask Steve to try it on a real folder; how it feels is his call.

## Documentation

In the same change as the code, update `docs/technical/photo-library.md`
so it describes what is now built: move section 12 into the sections on
saving and undo, clear the gaps you closed from section 11, update the
`pending` description, the bottom-bar table and the messages table, and
add a short section on reading the log (the marker, the event names and
what each means). The decisions above are already recorded in the PRD's
October 11 decisions.

## Report to Steve after each stage

Plain language, short:

- what now works, and what he should try;
- anything that behaves differently from this brief, and why;
- any new decision he needs to make, one at a time, each with its
  trade-off;
- the new messages, for his review;
- what was run, and anything that failed.

## Questions protocol

You have the code; this brief describes outcomes, not how to reach them.
If an outcome here conflicts with how the code actually works, or two
outcomes conflict with each other, stop and ask before building. Do not
invent a new product behaviour to resolve it. If something would take much
longer than its value suggests, say so and propose the smaller version.
