# Codex Brief — Photo Library Slices 5 and 6: File Controls and Smart Albums
## HDR Finisher

**Date:** October 12, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Read first:** `AGENTS.md`, then all of
`docs/technical/photo-library.md`, then these parts of
`docs/product/archive/Photo_Library_PRD_2026-10-09.md`: sections 3, 5.2, 5.4,
5.6, 5.7, 5.12, Appendix B and the "Later on October 11" decisions in
section 4. The mock-up in `docs/product/library-wireframes` shows the
rename, move, name-clash, busy-folder and delete windows, the folder
right-click menu and the smart album window.

## Goal

Steve can tidy a shoot without leaving the app: rename and move photos
and folders, make folders, and delete the photos he rejected, with
everything attached to a photo travelling with it and nothing ever lost
or overwritten silently. He can also save a filter as a smart album that
stays current across the whole library.

## Context

- Until now the Library has only ever written settings files (`.hdrf`)
  beside photos. **This is the first work that renames, moves and
  deletes original photos.** Treat it with the care `AGENTS.md` gives
  export and Proof.
- A photo's marks, grade, history, virtual copies and albums are in its
  one settings file beside it. The database indexes them. Kept pictures
  of edited photos, quick pictures and overlay maps are in the cache,
  tied to the photo's path and file version.
- The backend is the only writer. A durable background writer already
  survives interruption, restarts and unplugged drives, and reports
  through Activity and Needs attention. Folder checks already notice
  changes made outside the app.
- The filter bar already has a rule format (field, comparison, value,
  "is not", match all or any) that was built to be reused for smart
  albums. Albums exist; their membership is written into settings files.
- Steve is not a coder. He judges this on real shoots.

## Working unattended

Steve may be away while this runs. **Do not stop to wait for an
answer.** This overrides every "ask" below except the hard stops.

- Where something is not specified, choose the simplest behaviour that
  fits the PRD, the mock-up and how the Library already behaves. Prefer
  the choice that is easiest to change later, in its own commit where
  practical.
- Keep a running list headed "Decisions made for Steve": what you chose,
  the alternative, the trade-off and what could break. Give it in one
  final report, one item at a time.
- Hard stops. Leave that one item unbuilt, record why, and carry on with
  everything that does not depend on it:
  - anything that would change Grade's rendering, export, Proof, an
    existing shader or a pinned tolerance, limit or budget;
  - any route by which a photo or settings file could be lost,
    overwritten or left half-copied that you cannot close and prove
    closed with a check;
  - running any file command in this brief against anything except
    disposable test folders. Never against Steve's real photo folders,
    never against the read-only test projects;
  - slow tests for one stage heading past roughly 30 minutes;
  - a check that fails because of your change and that you cannot fix
    without loosening it.

## Decisions already made (do not reopen)

- Included: rename a folder, move a folder, create a folder; move
  photos; rename a single photo; delete photos; delete all rejected;
  show in Explorer; multi-select of photos and of folders.
- Left out: deleting a whole folder; batch rename of originals.
- **Dragging photos onto a folder asks first** (Steve, October 11): one
  confirmation that names the number of photos and the destination.
- Deletes always confirm and go to the Recycle Bin wherever one exists.
- A name clash stops and asks. Nothing is ever overwritten.
- Renames and moves are each one undo step. Deletes are undone from the
  Recycle Bin, not with Ctrl+Z.
- A smart album is a saved filter: one rule engine for the filter bar
  and smart albums.
- The smart album mock-up is accepted as the starting point.

## Outcome spec

Work in the stages below. Each ends with the app usable and the fast
checks passing.

### Stage A — an untouched save must not mark a photo Edited

Found in slice 4 and left alone under that brief's hard stop. Opening a
photo and saving without changing anything can still mark it Edited,
because measured highlight values in the grade shift by a tiny amount.

- Those values are measurements of the photo, not choices the user
  made. They must not count when the Library decides whether a photo is
  edited, whether a kept picture is current, or whether a revert would
  do something. This is the same treatment the overlay view settings
  got in slice 4.
- Do not change what Grade measures, stores, renders, exports or
  proofs. If the only way to fix this is to change one of those, or if
  a real edit could show up in those values alone, it is a hard stop.

### Stage B — rename and move photos

- **Rename a photo:** a small window with the name. The file ending
  cannot be changed. A name already used in the folder stops with "That
  name is taken. Nothing was renamed." and lets the user choose another.
  Names Windows will not accept are refused with a plain reason.
- **Move photos:** right-click, Move to folder, with a list of pinned
  folders and their sub-folders; or drag thumbnails onto a folder in the
  left panel. Both confirm first with the count and the destination.
- **A name clash at the destination** stops with the file name and three
  answers: Keep both (the moved file gets a number), Skip this one,
  Cancel move. The window says nothing has been moved or overwritten
  yet. The result line says how many moved and how many were skipped.
- **Everything attached travels.** After a rename or move, the photo
  has the same marks, grade, history, virtual copies, album memberships
  and kept pictures as before, with no re-indexing wait and no "picture
  not current" state. Its settings file moves with it and still names
  the right photo. A RAW and a JPEG of the same name are separate items
  and move only if selected.
- **A move to another drive** copies each photo and its settings file,
  checks the copy, and only then removes the original. It runs in the
  background and shows in Activity with a count, Pause and Cancel. A
  cancelled move leaves the remaining photos where they were. If the app
  or the PC stops part-way, no photo is lost: at the next start each
  photo is whole in one place or the other, the job is finished or
  reported, and nothing is left half-copied under a real name.
- **Failures** (file open elsewhere, read-only location, drive full,
  drive unplugged): the affected photos stay where they were, the rest
  proceed, and the result says which were not done and why.
- **Undo** puts the photos back as one step. If something has since
  taken an old place or name, nothing is overwritten and the undo says
  what it could not put back.
- **The photo open in Grade.** Simplest safe rule for this build: it
  cannot be renamed, moved or deleted while open. The command does the
  others and says "Open another photo before changing this one. Nothing
  was changed for it." Record this as a decision for Steve.
- **Background work on those photos** (indexing, pictures, overlay maps,
  settings writes) must not collide with the command. Work that can be
  remade is cancelled; settings waiting to be written are written first
  or carried to the new place. No "folder is busy" window is needed
  unless you find a case that cannot be handled this way.
- **More than one settings file for a photo** (a conflict copy): do not
  guess. Leave that photo where it is and report it.

### Stage C — folders

- On a folder's right-click menu: **New folder inside**, **Rename
  folder**, **Move folder**, **Show in Explorer**. A pinned folder's own
  entry also has **Rename label**, which changes only the name shown in
  the list and touches nothing on disk.
- Renaming or moving a folder carries everything inside it, including
  files the Library does not show. Pins on it or inside it, albums, the
  index and cached pictures follow without re-indexing.
- For this build a folder can be moved only within the same drive. A
  move to another drive is refused with a plain message. Record this as
  a decision for Steve.
- A folder that holds the photo open in Grade follows the rule in
  Stage B.
- A clash with an existing folder name stops. Folders are never merged.
- Each is one undo step.
- Several folders can be selected in the left panel (Ctrl-click,
  Shift-click) for the commands that make sense on several.

### Stage D — delete

- **Delete** on the selection, and **Delete all rejected** for the
  folder or album on screen, each behind a confirmation.
- The window says exactly what will happen: how many photos; that their
  settings, grades and how many virtual copies go with them; and whether
  they go to the Recycle Bin or are gone for good. Where there is no
  Recycle Bin (many network and removable drives), it says so plainly,
  and the confirm button says "Delete permanently".
- The settings file goes with its photo, to the same place.
- Deleting a virtual copy stays the separate, smaller action it is
  today. A selection that mixes photos and copies must make clear which
  is which, and never delete a photo because its copy was selected.
- A photo restored from the Recycle Bin by the user comes back in the
  Library with its marks, grade and copies at the next folder check.
- Failures leave the photo in place and are reported per photo.
- Deleted photos leave their albums; their cached pictures and maps are
  cleaned up.

### Stage E — smart albums

- **New smart album** from the + by the Albums heading, and **Save as
  smart album** on the filter bar, which opens the same window with the
  current filter already written as rules and limited to the folder
  being looked at.
- The window has a name, "match all / any of these rules", rule rows of
  field, comparison and value with "is not", "Look in" ticks for pinned
  folders (all ticked means the whole library), and a live count of
  matching photos as the rules change.
- Fields: every field the filter bar offers today, including rating,
  pick status, colour label, tag, state (edited or not), kind (virtual
  copy or original), file type, camera, lens, ISO and file name. A field
  added to one must appear in the other.
- A smart album is always current: photos join and leave as their
  marks, tags and grades change, without a refresh.
- It covers everything indexed. While indexing is still running, the
  window and the album say so, so a count is not taken as final.
- Inside a smart album every normal command works (marks, tags, open in
  Grade, move, delete). Remove from album is not offered, and photos
  cannot be dragged into it.
- Right-click a smart album: Edit rules and name…, Delete smart album.
  Deleting it touches no photo. Create, edit and delete are each one
  undo step.
- **Rules must survive losing the database.** The database is an index
  that can be thrown away; a smart album is something the user made.
  Keep the rules with the Library's other user-made settings, where pins
  and label meanings already live.
- Opening a smart album over a large indexed library should feel as
  quick as opening a folder. Report what you measure on a disposable
  50,000-photo index.

## Constraints

- Do not change Grade's rendering, export, Proof, any shader, or any
  pinned tolerance, limit or budget.
- A photo's pixels are never rewritten. The only changes to originals
  are the rename, move and delete the user asked for.
- Nothing is overwritten, ever. No command may replace an existing file
  or folder at the destination.
- A settings file the app cannot read is never overwritten and never
  blocks its photo from being reported clearly.
- Every action is a backend command first (PRD rule F5), and none of it
  is reachable without the confirmation the spec requires.
- Keep slices 1 to 4 working and their checks intact, including the
  background writer, recovery, folder checks and the leave gate.
- Pre-1.0 rule: no migration code. If the settings file or the database
  layout changes, say in one line what happens to existing `.hdrf` files
  and to an existing `library.sqlite3`.
- Follow `docs/design/HDR_Finisher_Design_Guidelines.md` and the
  mock-up. Keep new controls simple; Claude refines the look afterwards.
- Keep each source file's existing line endings.
- Small local commits, each undoable alone. Do not push. Do not rebuild
  the installer.

## Testing

This brief asks for more than the usual amount of fast data checks, and
says why: a mistake here loses a photographer's originals, silently.
The checks are cheap; write them thoroughly. Slow checks stay light, as
`AGENTS.md` asks.

Every check uses disposable folders made for the test. At least:

- rename and move: marks, grade, history, virtual copies, albums and
  kept pictures all present afterwards; settings file names the right
  photo; undo restores everything;
- a clash for each answer (Keep both, Skip, Cancel), and a clash that
  appears only at undo;
- names: Unicode, long paths, a change of letter case only, names
  Windows refuses, a RAW and JPEG of the same name;
- a cross-drive move interrupted at every step (before copy, mid-copy,
  after copy before check, after check before removal, after removal
  before the index is updated): after restart no photo or settings file
  is lost or duplicated under a real name;
- locked file, read-only destination, full drive, unplugged drive, each
  in the middle of a multi-photo command;
- the photo open in Grade is left alone;
- a photo with a conflict copy is left alone and reported;
- folder rename and move: pins, albums, index and pictures follow;
  unknown files inside travel; cross-drive is refused; no merge;
- delete: the Recycle Bin route and the no-Recycle-Bin wording; the
  settings file goes with the photo; a virtual copy selection never
  deletes the photo; restore is picked up by a folder check;
- Stage A: an untouched save leaves the photo Not edited and makes no
  new kept picture; a real edit still does both;
- smart albums: each field and comparison, all and any, "is not", "Look
  in"; live membership after a mark, tag and grade change; rules
  rebuilt after the database is deleted; undo of create, edit, delete.

One focused Electron check per stage for the visible part.

## Documentation

In the same change as the code, update `docs/technical/photo-library.md`:
how each file command works and what it guarantees, how an interrupted
move recovers, the messages table and the log events, and where smart
album rules are kept. In the PRD, mark slices 5 and 6 built in section
8. Add the file commands and smart albums to the code map.

## Final report to Steve

Plain language, short: what now works and what to try first on a copy
of a real folder, not the folder itself; anything that differs from this
brief and why; the "Decisions made for Steve" list, one at a time; any
hard stop reached; the new messages; what was run and anything that
failed.

## Questions protocol

You have the code; this brief describes outcomes, not how to reach
them. If an outcome here conflicts with how the code works, choose under
the unattended rules above and record it. Do not invent a new product
behaviour where a hard stop applies.
