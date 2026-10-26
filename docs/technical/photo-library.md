# Photo Library: How It Works

This page records how the Photo Library stores and protects your grades,
ratings, picks, colour labels, tags and albums, how its background process works, and
why it was built this way. It is written so that a problem can be traced to a
specific file, rule or message.

- **Updated October 11, 2026: background-writer Stages A, B and C, folder-check slice 2b, and grade-saving slice 3 Stage A built.**
- Sections 1 to 10 describe what is built. Section 11 lists the remaining
  gaps. Section 12 explains the library-wide health report and diagnostics.
- The Library is still being built, and its controls change often. A
  how-to-use guide will be written when they settle. Product intent lives in
  the [Photo Library PRD](../product/archive/Photo_Library_PRD_2026-10-09.md).

Terms used here:

- **Marks:** a photo's rating, pick or reject flag, colour label and tags.
- **Settings file:** the small `.hdrf` file the app writes beside a photo.
- **Library database:** the index of photos under a pinned folder or in a manual album.
- **Helper:** a second, low-priority process that does the Library's slow
  reading.

---

## 1. The idea in one paragraph

Your saved grades, marks and album memberships are written to a small settings file beside
each photo. That file is the lasting record: it travels with the photo when
the folder is copied, backed up or moved to another computer. The library
database is a fast index of those files, kept so that the app can show tag
counts, albums and search results without opening thousands of files. The
database can be deleted and rebuilt. The originals are never changed.

**Why:** a library that lives only in a database is lost if the database is
damaged, and does not move with the photos. A library that lives only in
files is too slow to search. Keeping both, with the files as the record,
gives a fast library that can always be rebuilt.

There are exceptions, where the database is the only record. They are
listed in section 4 and matter when you delete or lose the database.

---

## 2. Where everything is kept

### The app data folder

| How the app was started | Folder on Windows |
|---|---|
| Installed app, or the desktop app run from source | `%APPDATA%\hdr-finisher-desktop` (for example `C:\Users\<you>\AppData\Roaming\hdr-finisher-desktop`) |
| Backend run on its own in a browser, without the desktop shell | `%LOCALAPPDATA%\HDR Finisher` |

The desktop shell passes its folder to the backend in
`HDR_FINISHER_APP_DATA_DIR`. Setting `HDR_FINISHER_USER_DATA_DIR` before
starting the desktop app moves the whole folder, which the tests use. macOS
and Linux use Electron's standard user-data folder; those paths were not
checked for this page.

### Files in that folder that belong to the Library

| File or folder | What it holds | If you delete it (with the app closed) |
|---|---|---|
| `library.sqlite3` | The library database (section 4). Created the first time a folder is opened in the Library. | Rebuilt from the settings files as folders are visited or indexed. Unwritten work and other exceptions are lost: see section 4. |
| `library-preferences.json` | The meanings you gave the four colour labels, and whether background indexing is on. | Label meanings are blank again; indexing returns to on. |
| `library-kept-records\` | One atomic recovery record per kept photo or detached work item, referenced by `kept-photos.json`. Only a changed photo record is rewritten. | Rebuilding its cached offline work is no longer possible; sidecars remain intact. |
| `kept-photos.json` | Recovery list of manual albums, their physical photos and virtual copies, cached facts and detached pending settings/recovery/history. Backend-owned and replaced atomically when this state changes. | A database rebuild can no longer find photos outside pins automatically; sidecars remain intact. |
| `pinned-folders.json` | The list of pinned folders, as plain paths. | No folders are pinned. Photos and marks are untouched. |
| `library-pictures\` | Cached browsing pictures, one `.npz` file each (section 9). | Safe at any time. Pictures are made again when next needed. |
| `thumbnails\` | Small pictures for the older file browser used by Import. Not used by the Library grid. | Safe. |
| `logs\backend.log`, `logs\desktop.log` | What the backend and the desktop shell reported. | Safe. Look here first when something fails without a message. |

Preferences are kept outside the database on purpose, so that deleting the
database never loses personal settings.

### Files beside your photos

One settings file per marked photo, named with the photo's whole file name
plus `.hdrf`:

```
D:\Photos\Iceland\DSC02339.ARW
D:\Photos\Iceland\DSC02339.ARW.hdrf
```

**Why the whole file name:** a RAW and a JPEG with the same name each get
their own file, and the file sorts next to its photo in Explorer.

A settings file is created only when a photo is first marked, added to an
album or given a saved grade. Opening and browsing a folder writes nothing.

---

## 3. The settings file

It is plain text and can be opened in Notepad:

```json
{
  "format": "HDR Finisher Photo",
  "schema_version": 1,
  "photo_id": "0b6f6c1e-5d0e-4d3e-9a55-2f2f6f0d0a11",
  "source": {
    "filename": "DSC02339.ARW"
  },
  "contains_source_pixels": false,
  "marks": {
    "rating": 4,
    "pick": "pick",
    "label": "green",
    "tags": [
      "Iceland",
      "Waterfall"
    ]
  },
  "albums": [
    "Portfolio 2026"
  ]
}
```

| Field | Allowed values |
|---|---|
| `format` | Exactly `HDR Finisher Photo`. |
| `schema_version` | Exactly `1`. |
| `photo_id` | A random ID given to the photo the first time it is marked. Meant for finding the photo again after files move; nothing uses it for that yet. |
| `marks.rating` | A whole number, 0 to 5. |
| `marks.pick` | `unmarked`, `pick` or `reject`. |
| `marks.label` | Empty, `red`, `orange`, `green` or `blue`. |
| `marks.tags` | A list of names, each 1 to 120 characters. |
| `albums` | A list of album names, same rules as tags. Present only once the photo has been in an album. |
| `grade` | The existing version 4 project edit document, without source pixels: HDR and SDR settings, crop, source interpretation, RAW development, lens corrections, local adjustments and masks. Absent until a grade is saved. |

Rules for names (tags and albums):

- Runs of spaces are collapsed to one, and leading and trailing spaces are
  removed.
- Capitals are kept as typed, but two names that differ only in capitals are
  the same name. `iceland` and `Iceland` cannot both exist.

What the app will and will not do with a settings file:

- **It keeps what it does not understand.** When marks are saved, only
  `marks` and `albums` are replaced. Every other field, including a grade or
  fields from a newer version, is written back unchanged.
- **It never overwrites a file it cannot read.** A file is treated as
  unreadable if it is not valid JSON, has a different `format` or
  `schema_version`, has no `photo_id`, has a mark outside the allowed
  values, has an unknown field inside `marks`, or is a link to another file.
  The photo is still shown, a message is given, and the file is left exactly
  as it is.
- **It never changes the photo.** `contains_source_pixels` is always
  `false`; the file holds settings only.

### Grade saving (slice 3, Stage A)

Opening a photo loads its saved `grade` through the same document-opening
path as a project. A photo without one uses today's defaults and creates no
settings file just by being opened. Ctrl+S and Save on a source photo write
its grade beside it; Save As still makes a project. Project opening and
project saving remain available. Export and Proof use their existing paths.

Autosave is one app preference, initially on and kept between launches.
Claude's mockup button sits at the top right, visible from Library and Grade:
**Autosave on** with a filled dot, or **Autosave off** with a hollow dot.
The photo's save state and Save/Revert actions stay beside its name.
It saves after roughly a second without an edit, on leaving the photo and
on closing. With it off, the named-photo Save / Don't save / Cancel notice
guards photo replacement and closing. Switching Library tabs, browsing and
opening the same photo do not prompt. Marks save independently.

The visible states are **All changes saved**, **Saving…**, **Unsaved changes**
and **No unsaved changes**. When a settings write cannot finish, the state is
**Waiting to write settings — grade kept safely in the Library**. Activity
uses the existing folder failure and retry notices. Whole-file replacement
and a durable queue protect settings through interrupted and failed writes.

Before every grade save, and again when the background writer prepares the
file, the app compares the grade with the last known grade. Marks, tags,
albums and unknown fields alone never cause a grade-conflict notice; fresh
outside fields are preserved. An external grade change with unsaved work
pauses saving. The notice names the photo:

> The grade for <photo> changed elsewhere while you were working. Nothing
> was overwritten. Choose which grade to use; the other will be kept as the
> previous grade.

Title: **Grade changed elsewhere**. Choices: **Cancel**, **Use the file's
grade**, **Keep my grade**. Cancel keeps Grade open with **Saving paused —
grade changed elsewhere** and a Resolve control. Leaving or closing asks
again. Each successful choice retains the unchosen grade in durable Library
storage as `previous_grade`; Stage C gives it the before-state home and
Restore previous grade control. Keep both is built in Stage D: the outside grade becomes a virtual copy.
Activity lists paused conflicts by folder and photo; it does not promise
automatic conflict resolution.

With no unsaved work, Grade loads an outside grade without a question and
says once: **The grade for <photo> changed elsewhere. Grade now shows the
file's grade.** Recovery is retained after acknowledged edits even with
autosave off. After an interrupted app or Windows session, the next start
offers the named photo, then asks **Unsaved work for <photo> was kept after
the app stopped. Restore it?** Choices: **Leave saved grade**, **Restore
unsaved work**. It is never applied without asking.

The Library still shows its default pictures until Stage B. Finished saved
pictures, the remaining reverts and virtual copies are not built in Stage A.

---

## 4. The library database

### Library membership (October 13, 2026)

The Library contains every photo under any pinned folder, plus every photo
in a manual album. Virtual copies follow their physical original. Overlapping
pins keep photos until their last covering pin is gone. Ratings, tags, grades
and smart rules do not keep an unpinned photo. Projects are not yet built.
Opening without pinning shows a temporary folder; it contributes nothing to
Library search, tag counts or smart albums unless a photo joins an album.
This temporary-folder behaviour is built for Steve to confirm.

Unpinning immediately cleans `files`, tag associations and disposable marks
rows. It never writes a settings file or deletes a photo. Pending marks/album
removals and grade recovery/history remain protected in their existing durable
tables, outside Library membership; the existing writer retries pending work.
`kept-photos.json` and `library-kept-records\` also retain these protected records, so an index rebuild
cannot discard work because its folder was unpinned. Unsaved recovery is kept
as recovery; it is never silently made the saved grade. Re-pinning reads the
unchanged sidecars again. Removing the last manual-album membership outside
pins has the same effect; Undo restores membership and its file index row.

The recovery list includes albums and cached records even on unplugged drives.
Each photo has one atomic record under `library-kept-records\`; writer completion changes only that record, not the whole recovery list. A missing database is rebuilt from these before normal indexing, then connected
sidecars use the existing section 5 reconciliation rules. Pending database work
still wins until written. Album-only photos appear in Details as **Kept in the
library by an album; folder not pinned**.

Part 1 validation: 474 JavaScript fast checks and 1,990 Python checks passed
(three skipped). The focused Electron membership and background-writer checks
passed at 2560×1440. Initial checks exposed temporary-photo status and
preference-only startup regressions; both were fixed. Disposable photos only.

Smart candidates use this membership. All pinned Look in choices ticked means
the whole Library including album-only photos. A subset covers only those
pins. Saved folders that are no longer pinned remain labelled **(not pinned)**,
match nothing, and work again when pinned.


`library.sqlite3` is a standard SQLite file. Any SQLite viewer can open it;
open a copy, not the live file.

| Table | One row per | Columns |
|---|---|---|
| `photos` | Photo that has marks or an album | `path`, `photo_id`, `marks` (JSON text), `pending` (0 or 1) |
| `tags` | Tag name | `tag` |
| `photo_tags` | Photo and tag pair | `path`, `tag` |
| `albums` | Album name | `name` |
| `album_photos` | Album and photo pair | `album`, `path` |
| `settings_writes` | Photo waiting for a settings write | `path`, current-state `revision`, preflight `fingerprint`, failure `reason` and `detail`, `next_try`, `attempts` |
| `files` | Photo file found in a visited or indexed folder | `path`, `bytes`, `mtime_ns`, `facts` (camera details as JSON text, empty until read) |
| `photo_grades` | Photo opened for sidecar saving | `path`, `state` (JSON: known grade, queued grade, unsaved recovery, conflict and retained previous grade) |

Photos are identified by their **full path**. This has consequences:

- A photo moved or renamed in Explorer together with its `.hdrf` file keeps
  its marks; it is picked up at its new place the next time that folder is
  visited or indexed.
- A photo moved without its `.hdrf` file arrives with no marks.
- The old path lingers in the database until its old folder is next visited
  or indexed. Until then a tag or album count can be one too high, and the
  album or tag view reports the photo as not connected.

### The `pending` flag

`pending = 1` means: the database holds marks for this photo that have
**not** been written to its settings file. In the code and in messages this
is shown as "waiting to be written", or "cannot be written" with the
reason. It is set for every photo in a change before any file is written,
and cleared only after the current marks have replaced the settings file.
It is the durable work list: a backend thread resumes it at startup and
retries failures automatically. `settings_writes` holds the current state
of that work, not commands or history. Existing database rows, including
unwritten marks, are kept; the new table is added without replacing them.
Offline edits use this same queue. Stage C changes no database layout and
retains the existing `library.sqlite3`, including every pending mark.

### What is lost if the database is deleted

The kept-photo recovery list restores manual albums and its cached/protected
records. Outside that list, everything is rebuilt from settings files except:

1. **Marks on photos with `pending = 1`.** Their settings files were never
   written, so the database held the only copy.
2. **Empty albums if the recovery list is also deleted.** Their names now survive SQLite loss in `kept-photos.json`.
3. **Unused tags if the recovery list is also deleted.** The current tag list is recorded there.
4. **Unwritten grades, unsaved recovery and the retained previous grade.**
   These live in `photo_grades`; a saved grade already beside its photo survives.

Camera details and file sizes are also dropped, and are read again by
indexing.

---

## 5. Which copy wins

The same photo's marks can be in two places, so there is a fixed rule.

| Situation when a folder is read | Result |
|---|---|
| Settings file readable, photo not pending | **The file wins.** If it differs from the database, the database is corrected. This is how an edit made on another computer, or by hand, is picked up. |
| Photo is pending | **The database wins.** The settings file is ignored for marks until a write succeeds. |
| Settings file gone, photo not pending | The photo's marks are removed from the database. Deleting a `.hdrf` file is a way to clear a photo's marks. |
| Settings file gone, photo pending | The database keeps the marks. |
| Settings file unreadable | The database row is kept as it was, a message is shown, and the file is not touched. |

**Why the database wins while pending:** the change is saved to the database
first. If the app stopped before the file was written, the file still holds
the older marks. Without this rule the older file would silently undo the
change on the next visit.

---

## 6. What happens when you change a mark

The same steps run for one photo or ten thousand, and for ratings, picks,
labels, tags and album membership.

1. **Check the photos.** Every photo must be a supported type. Connected
   photos must exist; a photo already known to the library can be changed
   while its folder or drive is disconnected. Unknown missing photos are
   refused. Files deleted from a connected folder are still treated as missing.
2. **Check connected settings files first.** If any one is unreadable, the whole
   command stops before anything is written. *Why: half of a bulk change is
   worse than none.*
3. **Work out what changes.** Photos whose marks would not change are left
   out. They are not rewritten and are not part of the undo step.
4. **Save to the database, all at once.** Every changed photo is saved in
   one step and flagged pending. This step either happens completely or not
   at all, even if the app is killed in the middle.
5. **Record one undo step and return.** The grid, Details, tags and albums
   show the database change immediately. The command does not wait for files.
6. **The backend writer brings files up to date**, one at a time:
   - it reads the photo's current marks and albums, and rereads its settings
     file so every other field is kept;
   - it prepares and flushes a temporary file in the photo's folder, named
     `.hdrf-settings.<photo name>.hdrf.<photo ID fingerprint>.<random>.tmp`;
   - immediately before replacement, it checks that neither a newer mark
     command nor an external file edit has superseded the work. Superseded
     work is discarded and the latest state is read on the next pass;
   - it replaces the real file atomically and clears pending only for that
     same current state. Originals are never touched.

Slow file preparation runs outside the lock used by library commands.
Browsing, reading marks, further changes and Undo stay available. The writer
waits between photos whenever Grade, import or export has paused the helper.
Closing does not drain the queue or prompt; pending work resumes on startup.
A completion notice reports how many photos from the last session finished.

### Writing failures and recovery

| Case | Built handling |
|---|---|
| Brief file lock | Three short automatic retries, quietly; persistent locks are reported and retried later. |
| Disk full | Writing pauses for that drive, with one message; other drives carry on. Retried after 15 seconds. |
| Folder cannot be written | Reported once per folder, kept pending, automatically retried after 15 seconds. |
| Folder missing or drive unplugged | Kept pending and retried; when it returns, settings are written and completion is reported. |
| Photo missing but its folder is present | Its pending work and library entry are removed; the count is reported. |
| Settings became unreadable | Left untouched, reported with photo names, marks kept safe; retried later. |
| Settings changed elsewhere | Library marks and albums win, every other field is kept, and the event is reported and logged. |

At startup, and when a previously missing folder becomes available, the
writer cleans its own temporary settings files. New names identify even an
incomplete file. Older temporary names are removed only if their document,
source filename and photo ID prove they belong to a known library photo.
Other temporary files and links are left untouched.

### Library-wide tag and album commands

October 13 album menus: **Duplicate** creates a new manual or smart album.
**Save as manual album…** snapshots a smart album using the shared query worker
at confirmation, including offline indexed originals and virtual copies.
The source album is unchanged. Each creation uses one backend command and
one Undo step; manual album memberships use the existing background writer.
The name box proposes **Copy of <name>**, then **Copy of <name> (2)** and so on,
checking names of both album kinds and staying within the existing 120-character
limit. The box stays editable. Smart **Edit rules and name…** already had
right-click and ContextMenu/Shift+F10 access; these paths are retained.

Final messages added for Library scope and album commands:

| Where | Wording |
|---|---|
| Unpin title | Stop showing <folder>? |
| Unpin body | <N> photos leave the library. <K> stay because they are in albums. Nothing is deleted from disk. (Omit the K sentence when zero.) |
| After last-album removal | <N> are no longer in the library; their folder is not pinned. (Appended to the existing removal status.) |
| Delete Album | <N> photos will leave the library; their folder is not pinned. (Appended when any leave.) |
| New Album | Photos in an album stay in the library even if their folder is unpinned. |
| Details | Kept in the library by an album; folder not pinned (also shown on an original kept through its virtual copy). |
| Look in | All pinned folders ticked means the whole library, including photos kept by albums. A folder marked not pinned matches nothing until pinned again. |
| Duplicate Album | The new album has the same photos. Photos stay where they are. |
| Duplicate Smart Album | The new smart album uses the same rules and Look in choices. |
| Save as Manual Album | The new manual album keeps the photos matching now, including not-connected photos. The smart album keeps updating. |
| Creation status | Album <name> created. |
| Kept-photo update status | Photos kept by albums updated |

Part 2 validation: 475 Node checks and 1,994 Python checks passed (three
existing skips). Focused Electron album-command and existing smart-album checks
passed at 2560×1440, covering naming, offline snapshots, single Undo and both
Edit menu paths. The first existing smart-album run timed out waiting for its
155,000-photo fixture count; the diagnostic rerun passed unchanged count and
responsiveness requirements. Temporary diagnostics were removed. Disposable
photos only; no installer or push.


Rename, Merge and Remove for tags, and Rename and Delete for albums, find
every photo carrying the name and run the steps above.

- **Every library photo is changed**, including photos in disconnected
  folders. Their settings files wait in the same durable queue. The result
  reports how many files are waiting for a disconnected folder.
- The old name disappears from the list when renamed, merged or removed.
  Connected unreadable settings still stop the whole change before acceptance.
  A photo deleted from a connected folder is removed by the writer as before.
- Renaming a tag to a name that already exists stops and asks before
  merging. Renaming an album to an existing name is refused.
- Merging into an existing name keeps the spelling already in use.
- A change of capitals only (`iceland` to `Iceland`) is a rename like any
  other and rewrites every settings file that carries it.
- New tag and a new empty album touch only the database.

---

## 7. Undo

- Ctrl+Z undoes the last library command, however many photos it changed,
  as one step.
- The last **100** commands are kept.
- Undo history is held in memory. **It is empty after the app restarts**,
  whether it was closed normally or not.
- Undo puts back previous marks and albums in the database immediately,
  as one transaction, together with any tag and album name-list restoration.
  The writer then brings existing settings files up to date.
- A newer command or Undo invalidates a prepared but unwritten file. Earlier
  states do not each need to be written.
- Undo also works on known photos in disconnected folders, with their files
  waiting for reconnection. If photos were deleted from connected folders,
  the rest are undone and the skipped count is reported. An unreadable settings file still stops the command
  before changes are accepted, so it is never overwritten.
- Undo before the first settings file was written leaves no empty file.
  Once a settings file has been written, Undo keeps it with empty marks,
  as before. Undo does not delete settings files.

---

## 8. The helper process

Decoding RAW files and walking large folders is slow. The Library does this
in a second process so that grading stays responsive.

**Two processes:**

- **The backend** (the same one Grade uses) is the only thing that writes
  the database and the settings files. *Why: with one writer, two changes
  can never overwrite each other.*
- **The helper** (named `hdr-library`) reads folders, reads camera details
  and makes browsing pictures. It writes only to the picture cache. It never
  touches the database, a settings file or a photo.

**How the helper behaves:**

- It starts with the backend, at reduced priority (Windows "below normal").
- It has four kinds of work, each with its own lane so that one cannot
  hold up another:

  | Lane | Work | At once |
  |---|---|---|
  | Main | Listing the folder you just opened, the folder tree, camera details for photos on screen, Import thumbnails | 1 |
  | Picture | Grid, single-view and 100% pictures | 6 |
  | Index | Background indexing of pinned folders | 1 |
  | Check | Timed or requested folder checks using the same index commands | 1 |

- **It pauses whenever Grade is working.** Every grading, import and export
  request pauses the helper until that request finishes. While paused, a
  picture that is not already cached is answered with "not yet" and the page
  asks again a moment later. Cached pictures are still served.
- The index lane also waits whenever any visible Library work is queued, so
  background indexing never delays the folder on screen.
- At most 256 requests can be waiting. Beyond that, new ones are refused
  with "Library helper queue is full." and the page retries.
- Requests for photos that scroll off screen are cancelled.
- It checks four times a second that the backend is still running, and
  exits if not. It cannot be left behind after a crash.
- **If the helper stops unexpectedly it restarts automatically.** Waiting
  read requests are retained and sent to the replacement helper, with their
  priorities and the current Grade/import/export pause gate. Cancelled work
  is not resent. Three restarts per backend session are allowed, with short
  increasing delays. Each stop, restart and exhausted limit is logged.
  After the limit, Activity asks for an app restart. Grade and the backend
  settings writer stay available throughout. Closing cancels waiting requests
  and prevents another helper from being launched.

### Background indexing

Indexing makes pinned folders searchable without visiting each one.

- **When it runs:** when the Library is first shown after the app starts,
  when a folder is pinned, and when you choose Re-scan pinned folders now.
  Timed checks now keep these folders current between passes (slice 2b).
- **What a pass does**, for each pinned folder that is connected:
  1. Lists every supported photo in the folder and its subfolders, with size
     and modified date. Links are not followed.
  2. Reads the settings files, 200 at a time, so that marks, tags and albums
     made elsewhere are known. Photos already in the database are checked
     too, so a deleted settings file is noticed.
  3. Reads camera details for files not yet read, 32 at a time.
- A file whose size and modified date are unchanged is not read again.
- A pinned folder that is not connected is skipped; its existing entries
  are kept. Incomplete passes and helper/database failures wait 15 seconds
  and try again automatically, continuing beyond five failures. Activity
  shows the retry wait. Recovery is logged; Re-scan wakes the wait immediately.
  User Pause and background indexing off remain respected. This is recovery
  of failed work, not watching successfully indexed folders for changes.
- Pinning or unpinning a folder, or changing the indexing setting, restarts
  the pass from the beginning.

### Keeping folders current (slice 2b, October 11)

Album-only photos get an exact-path helper check about every five minutes,
200 photos per batch, sharing the existing check lane and pause/priority gates.
Only photo and settings-file size/modified-date probes run on unchanged entries;
no unrelated folders are scanned and no pictures are decoded. Changed file facts
use the existing metadata reader, 32 at a time; settings changes use section 5.
The next pass waits at least ten times its last duration. Missing photos on a
connected volume leave their albums/index; disconnected volumes retain entries.
External moves appear as missing at the recorded path, as with existing folder
checks; a move through the app updates its stored paths. No whole-drive search
for an externally moved photo is performed.


The existing helper lists names, sizes and modified dates (including settings
files). The backend compares the listing with session-only folder snapshots;
only new or changed photos and settings go through the existing marks reader
and camera-detail index. No database layout changed: existing `library.sqlite3`
files and pending writes are retained. There is no filesystem watcher.

- A visible folder, pinned or not, is checked about every **15 seconds**.
  Other pins are checked about every **five minutes**, one folder at a time.
  Each folder waits at least **ten times its own last check duration**, measured
  after completion. Empty timed checks write nothing and have no Activity item
  or routine log line. Health still records the last check time and duration.
- New photos, and replacements whose size changed, wait for the same size in
  two consecutive listings. Growing files are not decoded or reported as bad.
- Background indexing off stops other pins; visible folders continue. User
  indexing Pause stops timed checks, including queued work. A requested check
  bypasses that Pause. Grade/import/export hold every check. Both docked and
  popped-out Library pages report their visible folder; closed/hidden pages
  stop reporting and their short visibility lease expires.
- Disconnected folders retain their snapshots and entries. Availability is
  checked while the scheduler runs; a reconnected pin is checked immediately.
  Other failures retry after 15 seconds, subject to the folder's duration floor.
- **Chosen scheduling option:** a check runs alongside the existing index in
  the same helper, in one read-only check lane. The index yields at file/batch
  boundaries and resumes its existing work in memory; camera details and
  settings already read are not repeated. Visible folder/picture work and
  Grade take priority over both. Settings writing continues independently.
  Requested checks interrupt a timed listing by cancelling only that listing;
  re-listing names is allowed. An index listing made stale while yielding can
  also be repeated before expensive work begins. Helper restart and failed-index
  recovery continue to use the Stage A to C mechanisms.

**Measured before settling the periods:** the local D: drive listing of 50,000
valid, disposable JPEG photos took **3.23 seconds**. One complete unchanged-folder
check (helper transfer and comparison included, helper already started) took
**2.70 seconds** on the warmed listing. No mapped SMB share was available.
Picture payloads were not read; this is a listing measurement, not a real-photo
browsing or Grade performance claim. Keep the 15-second/five-minute bases: this
large folder automatically waits at least about **27 seconds** in the foreground.
Steve's real intake-folder trial decides how it feels. Reproduce the complete
check with `.venv/Scripts/python.exe tests/performance/library-folder-check.py
<folder>` from `codebase`; it uses disposable app data and only reads that folder.

The right end of the bottom bar now has one **Activity** item for settings
writing and indexing. At rest it says only "Activity". A click opens the
job list; Grade's own messages keep their existing place. Writing takes
priority, and "+1" means indexing is also running or paused. Job progress
counts describe the current session's queue, including further changes;
they are not a journal of earlier commands.

| Activity text | Meaning |
|---|---|
| Writing settings: 312 of 1,000 | Current settings-writing progress. |
| Writing settings paused · N waiting | Paused by the user; marks remain safe in the database. |
| Writing settings waits while Grade is busy · N waiting | Waiting for Grade, import or export to finish. |
| Indexing <folder> · reading folders | Folder listing is running. |
| Indexing <folder> · N of M | Camera-details progress. |
| Indexing waits while Grade is busy | Helper paused by Grade, import or export. |
| Indexing paused | Paused by the user. |
| Indexing is waiting to try again | An incomplete or failed pass will retry automatically; Re-scan wakes it now. |
| Checking for new photos · <folder> | Requested check, or a timed check that found changes. |
| Checking folders waits while Grade is busy | Requested check queued behind Grade, import or export. |
| Activity · Needs attention / Needs attention: N | A helper/indexing problem, or N settings files with a writing problem. |

The list always includes both jobs and their state, even at rest:
"Settings files up to date", "Library index up to date", or "Background
indexing is off". Indexing keeps Pause, Resume, Re-scan and its on/off
control. Writing has Pause and Resume, **no Cancel**; Undo remains the way
back. A pause lasts for this backend session, not across an app restart.
After a successful change the Library bar confirms the changed-photo count
("Rated N photos", "Picked N photos", "Rejected N photos" or "Updated N
photos") and offers **Undo** immediately. Undo reports "Undid the change on
N photos". Existing partial-result warnings take precedence over this count.

**Needs attention** groups current writing problems by folder and reason,
with a count and a plain explanation. Unreadable settings also name up to
three example photos. **Try again** brings that group forward for another
attempt; it neither clears the problem prematurely nor overrides Pause.
Other groups keep their schedule. A group disappears automatically only
when its pending work clears. Helper restart, exhausted restart attempts
and indexing retry waits are shown here too.

### Settings conflict copies

On folder visits, settings reads and background indexing, extra `.hdrf`
documents are associated with a photo using their recorded source filename,
or a recognisable sync-conflict filename. This also detects unreadable copies
with a recognisable conflict name. Needs attention shows the photo, folder
and both filenames. Detection merges, renames and deletes nothing;
links and temporary files are not read. Revisit or Re-scan after resolving
the conflict to clear the warning. Known warnings remain while offline.
Ordinary mark writes still update only the canonical settings file; extra
copies are never written. Virtual copies inside the canonical settings file are now built in slice 3 D below.

### Camera details

Details are read from each file's EXIF data, without decoding the picture.
A value the file does not record is shown as "Not recorded"; nothing is
guessed. The reader does not yet read manufacturer-specific notes, so the
lens name is missing for some cameras (PRD open decision 15).

---

## 9. Browsing pictures

- Grid and single-view pictures are made by the helper from a quick decode
  of the photo, with no lens correction, highlight reconstruction or
  denoise. They are for browsing; Grade and export use the full route.
- Each picture is cached in `library-pictures\`. The cache is limited to
  **2 GB**. When it goes over, the pictures used longest ago are removed
  until it is back to 90% of the limit.
- A cached picture is tied to the photo's path, size and modified date. If
  the photo changes, a new picture is made and the old one ages out.
- A damaged cache file is deleted and made again without a message.

---

## 10. Messages and what they mean

| Message | Meaning | What to do |
|---|---|---|
| "N new photos in <folder>" | One notice for arrivals in a check. | None. |
| "Checked <folder>: no new photos" / "Checked <folder>: library updated" | Requested completion, or changes other than arrivals. | None. |
| "N photos still arriving" | Files are waiting for their size to settle between checks. | Wait, or check again after the copy finishes. |
| "Checking for new photos · <folder>" / "Checking folders waits while Grade is busy" | Check running, or queued behind Grade/import/export. | Wait. |
| "Could not check <folder>: folder is not connected; photos and marks are kept" | Requested check could not reach the folder. | Reconnect the drive; checking resumes. |
| "Could not check <folder>: it will try again automatically" / "Folder check could not finish; it will try again" | Requested completion failure or Activity attention. | Check the folder; automatic retry continues. |
| "Rated / Picked / Rejected / Updated N photos" · Undo | The changed photos are saved in the database; files catch up in the background. | Undo is available immediately. |
| "Undid the change on N photos" | Undo returned; settings files catch up in the background. | None. |
| Details: "Waiting to be written; marks are safe in the library" | Pending, with no write failure. | Wait; the writer works automatically. |
| Details: "Cannot be written: <reason>; marks are safe in the library" | Pending because of a lock, full drive, unwritable or missing folder, unreadable file, or another system error. | Correct the named cause; automatic retries continue. |
| "N photos: settings files are waiting to be written. Marks are safe in the library." | Selection includes pending photos. | Check individual Settings lines for reasons. |
| "Settings are waiting in <folder or drive>: <reason>. Marks are safe in the library; writing will retry automatically." | Grouped write failure. Reasons distinguish locks, full drives, unwritable folders, disconnected folders and system errors. | Correct the cause; no marks were lost. |
| "Settings for <names> cannot be read and were left untouched. Marks are safe in the library." | Settings became unreadable after a command was accepted. | Repair the named file; automatic retries continue. |
| "Settings changed elsewhere for N photos in <folder> (<names>). The library's marks were written; every other setting was kept." | A file changed between accepting marks and writing them. | Review the named files if needed. |
| "Restored pending settings for N photos in <folder>. Earlier file changes could not be checked; the library's marks were written and every other setting was kept." | An existing pending row had no writer fingerprint. Its marks were retained and written. | None. |
| "Finished writing settings for N photos from the last session." | Pending work resumed after restart and finished. | None. Shown once. |
| "Finished writing settings for N photos in <folder>." | Writing succeeded after a failure or reconnection. | None. |
| "Undid the change on N photos; M photos could no longer be found and were skipped." | Partial Undo when a photo is missing. | The available photos were restored. |
| "N photos could no longer be found in <folder>; their library entries were removed." | A pending photo was deleted or moved outside the app while its folder remained present. | Reopen its new folder if it was moved. |
| "Settings for <photo> cannot be read; they were left untouched." | The `.hdrf` file is not valid JSON, or could not be opened. | Open it in Notepad. Repair it, or rename it out of the way to start fresh. A command that includes this photo will stop until then. |
| "Settings for <photo> have an unsupported format; they were left untouched." | `format` or `schema_version` is not what this version expects, usually a file from a newer version. | Use the newer version, or rename the file out of the way. |
| "Settings for <photo> have no photo ID; they were left untouched." | `photo_id` is missing or empty. | Restore the file from a backup, or rename it out of the way. |
| "Settings for <photo> have unreadable albums; they were left untouched." | `albums` is not a list of valid names. | Fix or remove the `albums` entry in Notepad. |
| "Settings for <photo> have unreadable marks; they were left untouched." | A mark is invalid or unknown. Technical validation details go to the log. | Repair the settings file or rename it out of the way. |
| "Settings for <photo> are a link; they were left untouched." | The `.hdrf` file is a link to another file. The app will not write through links. | Replace the link with a real file. |
| "N photos: settings files are waiting for a folder that is not connected. Marks are safe in the library." | Marks or collection changes were accepted on disconnected photos. | Connect the drive; writing resumes automatically. |
| "More than one settings file was found for <photo>. All files were left untouched; nothing was merged." | A second settings document was detected; Activity shows both filenames. | Review the files; revisit or Re-scan after resolving the conflict. |
| "A tag named <name> already exists." | A rename would join two tags. | Confirm the merge, or choose another name. |
| "That tag is no longer in the library." / "That album is no longer in the library." | The name was removed, or renamed, since the list was shown. | Reopen the list. |
| "Select a supported photo to mark." | A selected file is not a supported photo type. | Nothing was changed. |
| "<file or folder> could not be reached or changed. Saved marks are safe; check the folder and try again." | An unknown missing photo, or a photo deleted from a connected folder, cannot be marked. | Re-scan the folder; nothing was changed. |
| Activity: "The Library helper is restarting. Saved marks are safe; browsing will resume automatically." | A helper stopped and is being replaced. | Wait; pending requests recover automatically. |
| "The Library helper is restarting. Saved marks are safe; try again in a moment." | A request could not yet reach the replacement helper. | Try again shortly. |
| "The Library helper stopped after repeated problems. Saved marks are safe; restart the app to browse again." | Three automatic restarts were used. | Restart the app; check `logs\backend.log` if it repeats. |
| "Indexing could not finish. Saved marks are safe; it will try again automatically, or choose Re-scan now." | An incomplete pass or indexing failure is waiting to retry. | Wait or choose Re-scan. |
| "Indexing stopped. Saved marks are safe; choose Re-scan to try again." | An indexing thread has stopped. | Re-scan starts it again. |
| "The Library helper is busy. Saved marks are safe; try again in a moment." | More than 256 requests were waiting. | Normally clears on its own within seconds. |
| "Library cache entry is unavailable; request it again." | A cached picture was removed between two steps. | None; the page asks again. |
| "The Library could not read <photo>. Saved marks are safe; check the photo or folder and try again." | The file was modified during decoding. | None; it is read again when next shown. |

---

## 11. Known gaps (October 11, 2026)

Stages A, B and C closed the background-writer brief's gaps. Remaining:

1. Undo history is lost after restart (agreed, out of scope).
2. Detected conflict copies are not imported as virtual copies (later slice).

Stage B closed unified Activity, writer Pause/Resume, grouped Try again,
the health command, diagnostics and raw validation messages. Plain wording
for invalid settings was included here because Stage B explicitly requires
technical validation text to stay out of user messages. Stage C completed
offline edits, helper restart, indexing recovery and conflict-copy detection;
the plain invalid-settings wording remains unchanged.

## 12. Reading library health and diagnostics

### Library timing logs (October 2026)

Every Library picture step is logged to
`%APPDATA%\hdr-finisher-desktop\logs\backend.log` as `[library] <event> {json}`
lines. The file is large (over 150 MB); read it with a script, never by eye.

- **Summary:** from `codebase`, run
  `.venv/Scripts/python.exe tools/summarize_library_log.py` (latest app
  launch), add `--since "YYYY-MM-DD HH:MM"`, or add `--list` for a
  per-request fullscreen timeline. It is read-only.
- **Events** are named `page_picture_<stage>` and use the glossary in their
  fields:
  - `picture_size`: camera preview, thumbnail, screen preview or detail
    preview;
  - `step`: quick draw or sharp draw;
  - `view`: grid, filmstrip, single, fullscreen or compare;
  - `request`: groups one navigation's events.
- **Stages:** `cache_check`, `queue_wait`, `lease_wait`, `pixel_fetch`,
  `upload`, `denoise_prepare`, `render`, `draw_complete`, `present`,
  `development`, `store`.
- **Per navigation:** `page_picture_review_outcome` records the result
  (`quick_draw`, `sharp_draw`, `blank`, `reason`, and `duration_ms` from key
  press).
- **Other useful events:**
    - `backend_process_started`, `helper_process_started`, `backend_ready`
      (with `duration_ms`) and `page_ready`; the summary reports startup from
      the backend process, including before page load;
    - `startup_upkeep_started/finished/cancelled/failed`: deferred Library
      recovery work, with elapsed time including foreground yields;
  - `lock_timing` and `document_lookup_timing` (shared-lock wait and hold);
  - `helper_job_*` (helper work such as indexing metadata batches and folder
    scans);
  - `picture_source_preparation_*`;
  - `page_loaded`, which marks each app launch.
- Logs before October 25, 19:42 use older names (`page_present`,
  `page_key_to_picture`, `stand_in`/`sharp` fields). The mapping table is in
  the photo-library module PRD.
- A "present" event means the app believes the picture is visible. If what
  Steve sees disagrees with the log, check the screen too, not just the log.
  The October 26 Film Look bug was invisible in the logs.
- `codebase/tools/profile_cold_picture.js` is an opt-in profiler for cold
  first pictures on copied inputs.

**One command:** `GET /api/library/health` returns settings-writing progress,
waiting count, counts per failure reason, current folder/reason attention
groups, pause/Grade-wait state, recent writer notices, helper running state
and restart count, indexing state and the most recent 50 diagnostic problems.
Activity uses this command once a second while the Library is visible.
Helper health includes `recovering`, the restart count and an exhausted-limit
failure. The additive `conflicts` list supplies photo/folder and both filenames.
The recent-problem list is held in memory; the log is the lasting record.
Technical details remain in that command and the log, outside normal UI.

`POST /api/library/writer` accepts `action: pause`, `resume`, or `retry`.
Retry includes the exact `folder` and `reason` from an attention group.
`POST /api/library/settings-status` with `paths` continues to supply live
Details storage states; the GET version gives the writer summary.
Indexing keeps `GET/POST /api/library/index`. `POST /api/library/checks` accepts
selected `paths`, or a page `client` and `visible` folder lease.
`POST /api/library/view` refreshes from the checked snapshot and cached database
marks/facts without rereading settings. Health `index.checks` supplies queued and
running checks, recent completion notices, per-folder last-check timestamps,
durations, disconnection state and unreadable-settings warnings.

Search **`[library]`** in `logs/backend.log`. Every line has a stable event
name and JSON details: the attempted operation, photo/folder or examples,
the original system reason and the action taken. Bulk failures from the
same folder are grouped with a count and at most three example paths;
10,000 unreadable settings in one read produce one summary line.
Helper diagnostics are forwarded to the backend before logging, so the
same health command includes problems found in its other process.

| Event or family | Meaning |
|---|---|
| `command_start`, `command_end`, `<command>_failed` | Marks, Undo, tag and album commands; counts, context, duration, and failures. |
| `grade_save_queued`, `grade_saved` | A grade kept in the durable queue, or written beside its photo. |
| `grade_conflict`, `grade_conflict_resolved` | Saving paused for an external grade change, or the explicit choice and retention of the unchosen grade. |
| `request_failed`, `request_invalid`, `helper_request_failed` | Backend/API request stopped or rejected; original technical details stay here. |
| `settings_read_failed`, `settings_folder_failed`, `undo_skipped`, `collection_photo_missing` | Unreadable settings/folder, skipped deleted Undo photos or unavailable collection views. |
| `settings_conflict`, `settings_conflict_cleared`, `settings_conflict_scan_failed`, `settings_conflict_read_failed` | Extra settings documents detected or no longer found; failed detection retains existing warnings and leaves files untouched. |
| `writer_start` | Startup pending and temporary-cleanup counts. |
| `writer_locked`, `writer_disk_full`, `writer_unwritable`, `writer_offline`, `writer_unreadable`, `writer_io` | Grouped distinct failures; pending marks retained and retried. |
| `writer_recovered`, `writer_recovery_finished` | Successful recovery or completion of last-session work. |
| `writer_deleted`, `writer_baseline_unknown`, `writer_external_change` | Missing-photo removal, unknown fingerprint, or external file edits; preservation action recorded. |
| `writer_cleanup_failed`, `writer_cleanup_unproven`, `writer_failed` | Cleanup/writer problem; unproven temporary files left untouched. |
| `writer_pause`, `writer_resume`, `writer_retry` | User control or Grade/import/export wait, and an explicit retry. |
| `index_start`, `index_end`, `index_pause`, `index_resume`, `index_recovered` | Index milestones and controls. |
| `index_offline`, `index_scan_failed`, `index_metadata_failed`, `index_failed`, `index_stopped`, `index_stop`, `index_pass_failed`, `index_<operation>_failed` | Skipped folder, failed facts/scan/database work, retries or stopping, including its reason. |
| `folder_check_changed`, `folder_check_end` | Changes discovered (counts), or requested completion including zero arrivals and held copies; empty timed checks have no line. |
| `folder_check_offline`, `folder_check_failed`, `folder_check_recovered`, `folder_check_availability_failed` | Folder skipped or failed, entries retained, automatic retry, and recovery. |
| `preferences_read_failed` | Unreadable preferences; defaults used, file retained. |
| `helper_start`, `helper_stop`, `helper_stopped`, `helper_boot_failed`, `helper_pause`, `helper_resume` | Helper lifecycle and wait gate; Grade remains unaffected. |
| `helper_restart`, `helper_restart_exhausted` | Automatic restart with reason and count, or the three-restart limit reached; waiting reads recover or fail plainly. |
| `helper_send_failed`, `helper_control_failed`, `helper_reply_failed`, `helper_pipe_closed`, `helper_job_failed`, `helper_interpretation_required` | Helper communication/job problems and original reason. |
| `scan_folder_failed`, `scan_photo_failed`, `folder_tree_failed` | Folder/photo listing failure and skipped locations. |
| `metadata_read_failed`, `metadata_stat_failed`, `read_metadata_failed` | Failed EXIF/file access; unavailable facts do not hide the photo. |
| `cache_corrupt`, `cache_trim_missing`, `cache_<operation>_failed`, `cache_pixels_failed` | Cache repair, eviction races or unavailable picture bytes; request/rebuild action recorded. |
| `picture_embedded_fallback`, `picture_camera_fallback`, `picture_bitmap_fallback` | Existing decode fallback taken and why; decode routes are unchanged. |

The audit also checked expected non-failures: no settings/preferences on
first use, missing EXIF fields, cancellation, waiting on a helper future,
and a superseded prepared settings file. Those retain their quiet behavior.
Unknown old temporary files cannot be proved app-owned; they are left alone,
with grouped diagnostics if their document could not be read.

### Stage B wording for review

All new or changed user-facing text (N/M and names stand for actual values):

- "Activity"; "Needs attention"; "Nothing needs attention."
- "Writing settings: N of M"; "+1"; "Needs attention: N".
- "Settings files up to date".
- "Writing settings paused · N waiting".
- "Writing settings waits while Grade is busy · N waiting".
- "Pause writing"; "Resume writing"; "Try again"; "Undo".
- "Rated N photos"; "Picked N photos"; "Rejected N photos";
  "Updated N photos"; "Undid the change on N photos".
- "N photos: <reason>. Marks are safe in the library; writing will retry
  automatically." Reasons: "the settings file is still in use by another
  program", "the drive is full", "the folder cannot be written", "the folder
  is not connected", "the settings file cannot be read and was left
  untouched", "the system could not write the settings file". Folder and
  unreadable-photo examples are separate lines in the same group.
- "Indexing stopped · restart the app".
- "The Library helper stopped. Saved marks are safe; restart the app to
  browse again."
- "Indexing stopped after repeated problems. Saved marks are safe; restart
  the app to index again."
- "The Library helper is unavailable. Saved marks are safe; restart the app."
- "The Library helper is busy. Saved marks are safe; try again in a moment."
- "The Library could not read <photo or the selected photos>. Saved marks
  are safe; check the photo or folder and try again."
- "Settings for <photo> have unreadable marks; they were left untouched."
- "<file or folder> could not be reached or changed. Saved marks are safe;
  check the folder and try again."
- "Those marks could not be read. Nothing was changed; saved marks are safe."
- "That Library request could not be understood. Nothing was changed."
- "The Library could not finish that request. Saved marks are safe; try again."

Existing indexing texts and controls moved into Activity unchanged, except
that paused indexing is now counted as a job. Writer notices and Details
messages from Stage A remain unchanged. No database layout changed; existing
`library.sqlite3`, including every pending mark, is retained.

---

## 13. How to check things yourself

**Is a photo's change written beside it?** Select the photo and look at
Settings in the Details panel: "Beside the photo", "Waiting to be writtenÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦",
"Cannot be written: <reason>ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" or "None yet". Or open the `.hdrf` file in Notepad and read `marks`.

**Clear one photo's marks completely.** Close the app, delete that photo's
`.hdrf` file, reopen the folder. Wait until the Settings line says "Beside the photo" first. Deleting a
settings file while its photo is pending does not clear the library marks;
the writer will recreate the file.

**Rebuild the library database.**

1. Read "What is lost" in section 4 first.
2. Close the app completely.
3. In the app data folder, rename `library.sqlite3` (keep it as a backup
   until you are satisfied).
4. Start the app, open the Library and choose Re-scan pinned folders now.
5. Open Activity and wait for "Library index up to date". Folders that are not pinned are
   rebuilt when you open them.

**Clear the browsing pictures.** Close the app and delete the
`library-pictures` folder.

**Find stray temporary files.** In Explorer, search the photo folder for
`*.hdrf.*.tmp`. Startup removes provably app-owned files automatically. Do not delete
unrecognised temporary files based only on that broad search.

**The Library stops responding but Grade works.** The helper has probably
stopped. Open Activity and allow its automatic restart. If it reports
repeated problems, restart the app and read the end of `logs\backend.log`.

---

## 14. Code and checks

Paths are from `codebase/`.

| File | Owns |
|---|---|
| `backend/hdr_finisher/library_marks.py` | The database, settings files, mark, tag and album commands, undo |
| `backend/hdr_finisher/library_settings_writer.py` | Background writing, retries, recovery, cleanup and controls |
| `backend/hdr_finisher/library_diagnostics.py` | Shared grouped log events and recent problems |
| `backend/hdr_finisher/library_conflicts.py` | Read-only conflict-copy detection and current attention |
| `frontend/library-activity.js` | Unified Activity controls and Needs attention |
| `backend/hdr_finisher/library_index.py` | File facts, background indexing, `library-preferences.json` |
| `backend/hdr_finisher/library_worker.py` | The helper process, its lanes, pausing and cancelling |
| `backend/hdr_finisher/library_folders.py` | Folder listing and the folder tree (run in the helper) |
| `backend/hdr_finisher/library_metadata.py` | Camera details (run in the helper) |
| `backend/hdr_finisher/library_pictures.py` | Browsing pictures and their cache |
| `backend/hdr_finisher/library_api.py` | The `/api/library/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦` commands the page calls |
| `backend/hdr_finisher/media_browser.py` | Pinned folders (`pinned-folders.json`) |
| `frontend/photo-library.js` and `frontend/library-*.js` | The Library page |

Fast checks that pin the behaviour on this page:

- `tests/test_library_marks.py`: browsing writes nothing; a bulk change and
  its undo; rebuilding from settings files after the database is deleted;
  unknown fields survive; a failed write stays in the database across a
  restart; an unreadable file is never overwritten; a failed write leaves
  the old file and no temporary file.
- `tests/test_library_settings_writer.py`: actual process termination at database
  and file boundaries; restart recovery; Undo before/during/after writing;
  superseded writes; locks, full drives, permissions, offline folders, missing
  photos, unreadable and external settings edits; safe temporary cleanup;
  grouped failure logging and backend startup.
- `tests/test_library_collections.py`: tag and album commands, photos that
  are not connected, albums in settings files, preferences outside the
  database, indexing an unvisited pinned folder.
- `tests/test_library_worker.py`: the helper's lanes, priorities, pausing,
  cancelling, failure and shutdown.
- `tests/test_library_pins.py`: unpinning a folder that is not connected.

**Keeping this page true:** update it in the same change as any edit to how
marks are saved, which copy wins, the settings-file fields, the database
tables, the helper's lanes or pausing, or any message in section 10. Keep
the writer behavior in sections 6 and 7 and diagnostics in section 12
accurate; clear the matching section 11 gaps as Stages B and C are built.


### Stage A verification (October 11, 2026)

On disposable local PNG copies on `D:`, with the backend writer running and
folder/database setup completed before timing, full HTTP command acceptance
was **0.26 seconds for 1,000 photos** and **2.17 seconds for 10,000 photos**
(one-photo acceptance was 0.15 seconds). These measure saving to the library
and returning the result, not bringing every settings file up to date.
`tests/performance/library-mark-acceptance.py` repeats the measurement.

The existing synchronous-file expectations in `test_library_marks.py` and
`test_library_collections.py` now run a separate writer pass before checking
files. This includes bulk marks and Undo, restart/rebuild, preservation of
unknown fields, atomic replacement failure, tag rename/merge/remove and
album membership/rename/delete. Write-failure assertions now check writer
notices and retained pending state rather than a synchronous command warning.
Their unreadable-file and original-photo protection checks remain strict.
Stage C replaces the unconnected-tag expectation with edits that wait for reconnection.

`tests/library-background-writer.js` is the focused Electron check: immediate
Ctrl+Z while the writer waits, no empty first settings file, live Settings
states, restoring already-written files and continued folder browsing. The
fast suites pass; process-kill checks use the project's Python and temporary
photos only. No Grade/export/Proof, shader or decode route was changed.

### Stage B verification (October 11, 2026)

The focused health checks cover progress, pause/retry, grouped failures and
clearing after recovery, plain validation responses, cache/EXIF fallbacks,
and a 10,000-failure summary. `tests/library-background-activity.js` checks
Activity and Undo in Electron at 2560×1440 using disposable PNG copies.
The required suites pass: 460 Node checks; 1,674 Python checks, 3 skipped.
The final audit-focused checks also pass. No Grade/export/Proof, shader,
installer or decode-route changes were made.


### Stage C wording and verification (October 11, 2026)

New or changed messages (Stage B wording above is its historical review list):

- "N photos: settings files are waiting for a folder that is not connected.
  Marks are safe in the library."
- "More than one settings file was found for <photo>. All files were left
  untouched; nothing was merged." Both filenames are separate lines.
- "The Library helper is restarting. Saved marks are safe; browsing will
  resume automatically."
- "The Library helper is restarting. Saved marks are safe; try again in a moment."
- "The Library helper stopped after repeated problems. Saved marks are safe;
  restart the app to browse again."
- "Indexing is waiting to try again".
- "Indexing could not finish. Saved marks are safe; it will try again
  automatically, or choose Re-scan now."
- "Indexing stopped · Re-scan to try again".
- "Indexing stopped. Saved marks are safe; choose Re-scan to try again."

Fast checks use disposable data for offline marks, tag rename/merge/remove,
album membership/rename/delete, restart/reconnect, offline Undo, unknown
missing photos, conflict reporting and clearing, automatic helper restart
and its limit, indexing recovery beyond five failures, and Re-scan waking
a retry wait. Existing Stage A writer/interruption checks remain unchanged.
The changed expectations are the unconnected-tag test, process-failure test,
index-stopping test and failed-index Activity wording. The focused Activity
Electron check also proves both conflict names are shown, both files remain
untouched, and attention clears after Re-scan.

Verification: 461 Node checks passed; the full Python suite passed 1,688
checks with 3 skipped. After the final Windows filename and helper-wait
refinements, all 33 focused Stage C/worker/health checks passed. The Activity
Electron check passed at 2560×1440. No check failed.

No Grade/export/Proof, shader, picture decode, database-layout or installer
changes. Existing database rows and pending marks are preserved. No new
product decision is needed; Stage C ends the brief's implementation.

### Slice 2b verification and wording (October 11, 2026)

Backend commit: timed and requested checks use the existing index, protect
pending marks, detect external changes, defer growing files, retain offline
entries and report last-check health. Thirteen focused data checks passed,
including an already-running helper scan that yielded to a requested check
within two seconds and resumed without another invocation. Existing Stage A
to C recovery tests were retained. Timing and the period recommendation are
recorded above; no database migration is needed.

Interface commit: the toolbar and folder menu offer **Check for new photos**;
Ctrl-click or Shift-click selects several tree folders. New wording is listed
in the messages table. The focused `tests/library-folder-checks.js` Electron
check at 2560×1440 covers timed arrivals without selection/scroll movement,
both controls, stable single view/filmstrip and a removed selected photo.
The fast suites and final focused results are recorded with the commit.
The final recovery/health/folder-check subset passed 39 checks, including
removed subfolder counts and retaining pending marks.
No broad GPU sweep, push or installer build was performed. Steve should try
adding photos to a real pinned intake folder, including an external or network
drive, and judge whether browsing and Grade still feel right.

### Slice 3 Stage A verification (October 11, 2026)

The required fast suites passed: 462 Node tests and 1,723 Python tests,
with three skips. Twenty new data checks use disposable photos and cover
the complete grade document, mark/album/unknown-field preservation, external
grade choices, queued-write races, offline/read-only/full/locked/unreadable
settings recovery and restart recovery. JPEG, AVIF and JPEG XL exports and
full-size Proof artifacts are byte-identical when the same grade is opened
from a sidecar or project. Existing render formulas and encoders are unchanged.

The focused Electron check passed at 2560×1440: opening writes nothing,
manual and automatic save states, the Grade dot, reopening, browsing without
prompts, exact named-photo prompt and Escape, immediate save when autosave
is enabled, external marks without a grade notice, conflict Cancel and
repeat notices on leaving and actual main-window close, Keep my grade,
clean external reload and offered unsaved recovery after restart. No final
check failed. No broad sweep, push or installer build was performed.

Steve should try a real photo with both HDR and SDR edits and a mask: save,
close and reopen it, then repeat with autosave off. The Library's displayed
saved grade awaits Stage B and its format/resolution measurement decision.

### Slice 3 Stage B prerequisite (October 11, 2026)

The encode-only JPEG and AVIF gain-map writing bodies are now shared functions
in `backend/hdr_finisher/exporters.py`: `write_jpeg_gainmap_renditions` and
`write_avif_gainmap_renditions`. They accept finished HDR/SDR pixels, reference
white and encoding settings. Existing export commands still render, encode,
validate and publish through their original lifecycle, with unchanged encoder
arguments, filtering and metadata policy. Steve approved this extraction.

### Slice 3 Stage B - backend kept pictures (October 11, 2026)

Steve approved the backend alternative. Saved edited grades now queue a separate,
low-priority helper job through existing corrected SessionStore opening, reduced
export renditions and the shared JPEG writer. Grade readback, shaders, export and
Proof are unchanged. One app-data gain-map file serves all Library views. JPEG,
512/1024/1920 with default 1024 are provisional: the 36 MP trial took 9.5 seconds
at 1024 and JPEG was smaller than AVIF at all three sizes. A Library pictures
window provides storage limit and edited-picture resolution, plus usage. Quick
pictures are evicted before least-recently-viewed edited pictures.

The backend verifies grade identity and source stat before publishing. Pending,
missing or outdated pictures show the default look and edited/not-current mark.
Unsaved work is excluded. Edited zoom enlarges the kept file without decoding the
original. State is a filter and sort. Optional `grade_default` travels in the
sidecar; no marks/albums tables are replaced. Known-writer JPEG files are decoded
in process for Library display; source/export/Proof decoders stay unchanged.
The SDR base is exact; HDR gain-map interpolation has a small display-only
rounding difference, measured in the running report. The 1000-nit cap stays.

`kept_picture_saved` and `kept_picture_failed` record production. New user messages
and all trial/check results are in `slice-3-stage-reports-2026-10-11.md`. Slice 7
can call the same producer for unopened photos; its durable bulk queue, Activity,
Pause/Resume, restart/offline recovery and visible-photo priority remain future
work. The latest-grade/source checks and cooperative foreground gates are built.

### Slice 3 Stage C - history and reverts (October 11, 2026)

`grade_history` in the one settings file holds optional `session_start` and
`previous_grade`, preserving unknown history fields. The first edit in each app
run captures its starting grade locally; it survives restart and joins the next
settings write (Steve accepted this behavior). Reverts retain the losing grade,
including unsaved open work. Original, last saved, last session and previous are
available in Grade; last saved drops unsaved work. Library selections offer only
useful choices, confirm the count, keep marks/albums, and form one Undo step. An
open target stays ordinary unsaved work. Unreadable settings and outside grade
changes prevent replacement; Undo refuses a newer outside grade. Existing matching
pictures remain keyed to their grade. `grade_revert` logs target/count/retention.

New optional fields use existing grade documents and the existing database; no
marks or album tables are replaced.

For every closed item, Revert to original clears the saved grade (writes
`grade: null`) and keeps the losing grade as `previous_grade`. This is the same
behavior whether a starting grade was recorded or not. The item shows Not edited
and uses the ordinary unedited Library picture; the old grade-keyed kept picture
is no longer displayed and remains eligible for reuse on restoration. The next
normal Grade open computes fresh defaults through its existing import path.
Open items still revert immediately to their known defaults as unsaved work.
Undo and Restore previous grade support the no-saved-grade state too. No source
is loaded by a closed-item revert and no migration or new database field is added.
The former open-once message is retired. The full fast pass and focused on-screen revert check passed.
The previous validation stop is superseded by Steve's per-stage slow-test rule.
Virtual copies are built in Stage D below.


### Slice 3 Stage D - virtual copies (October 11, 2026)

Wording and layout pass after Stage D (Claude, October 11): the Library right-click menu follows the mock-up (name header, key hints, items that open a window end in an ellipsis, Remove virtual copy last and in the warning colour; Del removes the selected copy). The create, remove and revert windows use the mock-up titles and explanations. In Grade, Revert opens a small menu of the reverts that would do something, in place of a window of buttons; with none available it reports "There is no earlier grade to go back to." The copy filter is labelled Kind. Details names a virtual copy and shows Edited or Not edited. Rename copy is now a backend command, offered in the right-click menu and Details. Create and remove accept selections, ask once, and each form one Undo step for the whole command. Duplicate names are allowed. Rename changes only the name, including the open Grade caption, without changing its save state. Bulk commands validate every settings file before accepting changes and stop as a whole on failure, matching counted reverts. Removal skips the copy open in Grade and names it in the result; originals in a mixed selection are retained.

`library_copies.py` owns virtual item identity and the copy list. An internal
`<physical path>|copy|<photo_id>` key addresses each Library item; it is never
opened as a filesystem path. Grade opening resolves the physical source and
attaches the copy's ID and document. Opening another item of the same source
passes the ordinary save/discard/cancel gate. Session activation is finished
before status polling resumes. Copy names follow the filename in Grade too.

The one physical `.hdrf` gains optional `virtual_copies`: a list of each copy's
ID, name, grade, default, marks, albums and optional grade history. Unknown fields
are retained. A small `library_copies` SQLite table keeps the observed list and
durable pending list; the existing photos/tags/albums tables index virtual keys.
Copy commands queue one physical settings writer transaction alongside the
original's latest marks and grades. Whole-file atomic publication is unchanged.
Unreadable copy data or a changed outside copy list prevents replacement and
retains both local and file versions. Standalone marks-only callers still
preserve unfamiliar fields without interpreting them. Existing `.hdrf` files
need no migration; existing `library.sqlite3` keeps all grades, marks and albums,
with the copy table added when the service starts. Sources are never duplicated.

Current grade and Clean start both inherit the physical original's stars, pick,
label and tags; new album membership starts empty. Names default to the first
unused Copy number. Every copy uses its own grade, crop, marks, albums, history
and kept-picture identity. Rebuild reads these from the one settings file. Copy
and original filtering treats them independently; family sorting keeps copies
immediately after the original in every direction. The strip shows a copy symbol
or the original's +count. Removing a closed copy has its own confirmation and
one Ctrl+Z restoration; Library removal leaves a copy open in Grade in place
and names it in the result, so unsaved Grade work cannot be discarded. A mixed
selection removes only closed copies. Internal Undo of creation also refuses
to remove an open copy and leaves Undo available. Nothing is deleted from disk.

Keep both is a small extension of the grade-conflict choice: queue the outside
grade as a new copy, then retain/save the local grade using the existing conflict
safety net. `virtual_copy_created` and `virtual_copy_removed` log copy identity
and action. The running report holds every new message and validation result.

A further grade-status race was fixed without changing rendering: status could
read the old settings file just before writer acknowledgement changed the
baseline, compare those different moments, and request a false external reload.
The check now compares against the baseline captured before reading and defers
when acknowledgement changed it. A deterministic data test covers this race.


Slice 3 C/D additions to the messages table:

| Message | Meaning | What to do |
|---|---|---|
| Revert <name or count> to Original? / to Last Session? / to Last Saved? and Restore Previous Grade of <name or count>? Each says what happens, that the previous grade is kept and that marks and tags are not touched. | Counted Library grade replacement, marks retained. | Confirm or Cancel; Ctrl+Z restores the group. |
| Reverted to original: <count> photos. Each keeps its previous grade. Ctrl+Z undoes it. (and the matching last session, last saved and previous grade wording) | Closed original reverts have no saved grade, show Not edited and use the ordinary picture; their next open computes fresh defaults. Open targets remain unsaved. | Open normally, restore the previous grade, or Undo. Save open changes when ready. |
| A grade changed since the revert; Undo was left available and nothing was overwritten. | Undo would replace a newer grade. | Review the newer grade before trying again. |
| <count> virtual copy/copies created beside the original/their originals. Ctrl+Z undoes it. | A new independent item is queued in the same settings file. | Open or mark the copy. |
| This removes one grade of <filename> / <count> virtual copies, with their own marks and tags. The photos stay. Nothing is deleted from disk. | Counted copy-removal confirmation; originals are retained. | Remove or Cancel. |
| <count> virtual copy/copies removed. The photos stay. Ctrl+Z brings them back. | Copy removed from the durable list, source retained. | Undo if needed. |
| Open another photo or copy before removing this virtual copy. Nothing was changed. | Undo of creation would remove an open copy. | Leave it through the normal save gate, then Undo again. |
| Virtual copies changed elsewhere. Both versions are kept; settings were left untouched. | Pending local copy list conflicts with the file. | Keep both versions and review the conflict; no automatic merge. |
| Keep both brings the file's grade in as a virtual copy. | Extra choice in the existing Grade conflict notice. | Choose Keep both to retain both independent grades. |
| Copy names must contain between 1 and 120 characters. | Copy name validation. | Enter a shorter nonblank name, or leave the creation name empty for the default. |

| Virtual copy renamed. Ctrl+Z undoes it. | A name-only command; Grade save state is unchanged. | Continue editing, or Undo. |
| Left "<copy name>" of <filename>: it is open in Grade. | Library removal skipped that copy and removed the other selected copies. | Leave Grade through its normal save gate before removing this copy. |
| The copy name changed since the rename; nothing was overwritten. | Undo would overwrite a newer copy name. | Review the name before trying again. |

These leftovers add no settings fields or database layout. Existing `.hdrf`
files retain their contents except for the requested changes; existing
`library.sqlite3` needs no migration. Bulk copy acceptance uses one database
transaction and the existing per-file atomic writer. A later outside edit is
still handled by the existing writer conflict protection. The rename-only queue
keeps unsaved history in its existing durable database state until a later
ordinary write; renaming does not publish it.

### Slice 4 Stage A - viewer choices and SDR Highlights presets

Library grade comparisons and kept-picture identities ignore Grade's five overlay
view fields (mode, opacity, threshold and the two false-colour settings). The
complete document is still saved and reopened unchanged. A real grade difference
still counts as Edited. Saving only new overlay choices on a real edit does not
queue another kept picture. Revert comparisons treat no saved grade as the
starting grade, including for closed items. Grade drawing, export and Proof are
unchanged. SDR Highlights is accepted by the desktop preset store.

Existing kept pictures use the old identity and may be unavailable until the
next real save regenerates them; no migration is added. No new messages or log
events. Existing .hdrf and project rendering is unchanged.

The focused UI check found an existing separate issue: ordinary Grade save can
change measured highlight peaks by a tiny amount even without an authored edit,
so that still can count as Edited. It is not an overlay field and is left alone
under this brief's hard stop on Grade rendering and pinned comparisons.
Validation: 463 Node checks; 1,755 Python checks passed, 3 skipped (3:24),
including settings-file save/reopen and byte-identical export/Proof checks.
Focused Electron at 2560x1440 passed on a disposable photo/profile. The driver
was corrected to wait for file publication and synchronize command revisions.

### Slice 4 Stage B - compare

`library_review.py` owns read-only pin/navigation commands. Compare retains a
left reference and makes the right item the sole target of marks and Enter.
The current folder/album sort and filters provide navigation order; movement
skips the reference. Two virtual items remain separate even with one source.
`library-compare.js` draws two Library surfaces with common normalized position
and zoom, using the existing picture/native routes. Unedited sides show native
source crops at 100%; edited sides enlarge their kept picture and say
"Saved Library picture enlarged. Check detail in Grade." No Grade renderer,
shader or settings-file command is involved. The right neighbours are read ahead.

Compare's panel contains its switch, side/top/split layouts and file names/marks.
The split divider can be dragged or moved by arrow keys when focused. C toggles;
[ pins the selected item and selects its next neighbour; ] assigns the alternate.
Compare is off at launch. Layout and caption preference live under `review` in
`library-preferences.json`, with other preferences preserved. Leaving a view
cancels drawing; browsing a different place keeps the reference available for
comparison. No new settings file or database field, no grade/mark/album changes.

Decisions made for Steve:
- Navigation skips the pinned reference. The alternative revisits it on the
  right; skipping saves a useless comparison but a one-photo folder shows it twice.
- Zoom/pan use the same normalized place in each frame, including different
  image dimensions. Borders can appear when one frame is smaller; scaling both
  to the same pixel size instead would make one side's 100% claim misleading.
- The reference can stay pinned across filter changes and places. The alternative
  clears it on every browse; retaining it helps compare folders but can show a
  reference that is outside the current filtered list.
B validation: 463 Node; 1,757 Python passed, 3 skipped (3:18). Focused
Electron at 2560x1440 passed pin/navigation, locked native zoom/pan, right-only
marks/Undo, layouts, captions, HDR, virtual copies and mixed kept/native zoom.
Driver waits for preference saves and pin commands were corrected. No new
log events. The Library viewing-settings read failure is the only new notice.

### Slice 4 Stage C - exposure overlay

`library_overlays.py` reads RAW sensor samples with per-channel black/white
levels and file orientation, before tone mapping or highlight recovery. Linear
DNG samples use their recorded black/white normalization; bitmap warnings use
integer code limits. Blown means at the recorded ceiling in any channel;
blocked means all channels at or within 0.1% of black (at least one integer
code). Tiny 512-edge maps retain warnings by maximum pooling, not averaging.
Floating/HDR formats with no trustworthy clipping limit show unavailable.

`library_worker.py` makes maps on its existing low-priority kept-picture lane,
yielding to Grade, export, checks and visible pictures. `library_api.py` owns
switch/map/pixels commands. `library-overlays.js` draws separate coloured
canvases above the Library pictures and native crops, in grid/film/single,
compare and review. E is instant; the toolbar button opens options. The legend
stays visible in review and its colour squares are editable. Strength, colours
and warning choices are saved in the same viewing preferences. Switch state
is transient; it writes no grade, settings file or database field.

Maps are compressed colourless `.map.npz` entries beside quick/kept pictures
in the existing cache, under the same configured storage limit. Their keys
include path, source size/mtime, map version, kind and quality. Source changes
invalidate them; cancellation prevents publication. Cache trimming removes
maps before quick pictures and then edited pictures. No cache migration:
existing picture entries stay valid. A lost map is remade on demand.

New messages: "E · preparing", "E · unavailable" with the reason in its
tooltip, and "Overlay is measured from the original; this photo is shown with
its saved grade." Edited items never decode an original for this overlay.
Formats without a source clipping ceiling say so, rather than claiming no
warnings. `overlay_map_saved` logs dimensions, source, quality and make time.

Decisions made for Steve:
- Blocked means the first 0.1% above the recorded black level, rather than
  only exact zero. It catches near-black areas but some intentional dark areas
  will be marked. This threshold is local to Library and easy to change.
- For SDR bitmaps the warning is about clipped stored codes, not recoverable
  sensor data. HDR/floating formats without a ceiling show unavailable. The
  alternative would guess a white point and could wrongly declare detail lost.
- If highlight and shadow warnings land in the same small map cell, highlights
  take priority. Larger maps could separate them but cost more storage.

Highlight headroom numbers are deferred as requested: they need a defined
reference white, trustworthy sensor saturation metadata and a separate
measurement/display decision; neither SDR previews nor clipped stored codes
alone establish recoverable highlight stops.

C validation: 463 Node; 1,762 Python passed, 3 skipped (3:32). Focused
Electron at 2560x1440 passed on disposable known-region photos in grid, film,
single/native, compare and review, including instant colour/strength changes
without map regeneration. The check caught an unresolved request model and
missing worker command registration; both were fixed. Its initial colour
expectation was corrected for canvas premultiplied-alpha readback rounding.

### Slice 4 Stage D - focus peaking

`library_focus.py` measures detail on the Library's plain linear quick decode,
not the thumbnail or screen-toned picture. It normalizes luminance, compares
fine (0.7px) and coarse (1.5px) Gaussian edge magnitudes, and subtracts a robust
noise allowance estimated from the median fine-scale residual. A minimum floor
prevents a very smooth frame's tiny variations from becoming sharp detail.
A synthetic evenly noisy scene produces no marks. This is an edge-confidence
map, not a lens/focus diagnosis; fine texture can be suppressed with noise.

The map is maximum-pooled to at most 512 pixels on its longest edge and stored
as one colourless byte per cell. Half-size RAW uses LibRaw's existing Library
half decode; other formats are sampled at half dimensions before measurement.
The grid/filmstrip use this first map. Single/compare/review then request a
separate full-decode map on the same low-priority lane, only while on screen.
Half/full variants share the source-version/cache checks from Stage C. Pixel
serving also rechecks the source before delivering an old key. No new worker,
Grade decode path, rendering formula, shader, export or Proof was changed.

S switches instantly; clicking Focus opens strength, sensitivity and colour.
Low strength selects only higher-confidence edges with faint opacity; high
strength lowers the display threshold and makes marks bold. Sensitivity shifts
that threshold. All three redraw the existing map immediately. Both overlays
can run together; focus draws above exposure. Edited items get no map. Map work
is cancelled when the photo leaves the view or the overlay turns off.
Settings are remembered in viewing preferences; switches are off at launch.
The new quiet notices are "S · preparing", "S · refining" (half map visible
while full detail is measured), and "S · unavailable" with its reason as a
tooltip. Logs use Stage C's `overlay_map_saved` event with kind/quality.

Bounded measurement (three real RAWs, warm disk, one numerical thread, plain
Library decode plus map calculation; compressed map sizes include metadata):

| Photo | Half time / size | Full time / size |
|---|---|---|
| DSC00264.ARW, shallow-depth glass with a soft background, ISO 800 | 1.48s / 2,281 bytes | 5.96s / 1,823 bytes |
| DSC01212.ARW, detailed building, ISO 800 | 1.59s / 43,736 bytes | 5.90s / 36,090 bytes |
| noisy_canon_IMG_0790.CR2, ISO 3200 | 1.28s / 5,873 bytes | 3.84s / 27,260 bytes |

These include decode and filter time, not cold disk, PNG transport or drawing.
Natural photos have no focus ground-truth labels. The trial also applied known
slight (0.7 source pixel sigma) and stronger (1.4px) blur in memory to each real
frame. For slight blur the half-size detailed-building mean confidence was
unchanged (15.401 to 15.428), while full fell 30% (8.400 to 5.907); the high-ISO
frame fell only 1% at half size and 69% at full size. These are trial statistics,
not a user-facing sharpness score. The synthetic sharp edge peak fell 203 to
108 with slight blur, 17 with stronger blur, and zero with 3px blur. Flat and
even-noise inputs stay clear. This supports half for browsing with full only
for large views, rather than calling the half map reliable for close focus.
`tests/performance/library-focus-trial.py` reproduces the small read-only trial;
local images/JSON stay under ignored output, never beside source photos.

Decisions made for Steve:
- Use a robust per-image noise estimate rather than camera-specific ISO tables.
  It handles many formats with no new metadata dependency, but very fine
  texture can be treated as noise. Sensitivity can restore weaker marks.
- Keep the small maximum-pooled map for focus too, rather than retaining every
  sharp edge pixel. It makes thumbnails readable but can colour a small block
  around a thin edge, especially at 100%. A denser map could reduce that cost.
- Default focus colour is green, strength 65%, sensitivity 50%; exposure uses
  red/blue at 65%. These are reversible starting values rather than presets
  for each camera. Other colours may be clearer on a particular scene.

Large-view maps take precedence over grid/film maps on the background lane,
while saved grade pictures retain priority over both. This changes only new
map ordering; existing foreground gates and budgets are unchanged.

D validation: 463 Node; 1,767 Python passed, 3 skipped (3:17). Focused
Electron at 2560x1440 passed colour/strength/sensitivity changes without new
maps, half grid/film, full single/native/compare/review, both overlays together,
edited-photo exclusion, remembered options and switches off after reload.
The driver initially read preferences during a reload; waiting for navigation
fixed that check. The first candidate failed the softness experiment and was
replaced before implementation, without changing any pinned comparison.
Read-only ARW, CR2 and linear-DNG exposure sample reads also passed. No other
failing checks remain, apart from Stage A's separately documented Grade issue.

### Slice 4 exposure precision follow-up - October 12

The final source-reader check found that Pillow reduces colour 16-bit PNGs to
8-bit RGB, which can round a stored 65500 to screen code 255 and falsely mark
it blown. Only the Library exposure reader now uses the existing imagecodecs
PNG decoder for 16-bit samples, keeps orientation and excludes alpha. RGB/RGBA
and grayscale 16-bit regression checks preserve headroom and mark only the true
ceiling/black regions. Grade, picture drawing, export and Proof are unchanged.
Overlay map version is now v2; earlier overlay maps are remade on demand without
migration. Existing Library pictures stay valid, and old maps are normal first-
to-evict disposable cache entries. There are no new messages or log events.

The same source-reader correction makes RAW shadows colour-aware: all samples
in a Bayer/X-Trans pattern cell must be near black before calling it blocked.
A single dark colour channel in a bright coloured subject is no longer enough.
Highlights still warn for any clipped sensor sample. A synthetic mosaic check
and read-only ARW/CR2 sample reads cover this distinction.

Decisions made for Steve:
- RAW shadow warnings require all sensor colours in a pattern cell near black,
  rather than any one dark channel. This avoids false warnings on saturated
  colours; noisy deep shadows may get fewer warnings because some samples
  remain above the threshold. The near-black 0.1% threshold is unchanged.

Precision follow-up validation: 463 Node; 1,770 Python passed, 3 skipped
(3:17). The focused exposure Electron check at 2560x1440 passed, including a
near-white RGB16 PNG with no false clipping, all Library views and live colour/
strength reuse. No check failed in this correction. Its initial regression
confirmed the ordinary decoder's uint16-to-uint8 loss before changing the reader.

### Steve's slice 4 review — October 12

Steve accepted the ten decisions, with normalized pan acceptable for now and
real-photo testing still pending for shadow warnings, warning collisions,
focus noise filtering, and compact-map blockiness. The PRD now carries three
polish reminders: test/revisit near-black shadows (4), review exposure warning
explanations in the UI (5), and add overlay colour settings to the menu bar
(9). No implementation or defaults changed.

Validation: 463 Node and 1,770 Python passed, 3 skipped (3:46); no failures.
No Electron check covers this documentation-only change. A thread reminder
checks for the start of Library polish and stays quiet until then.

### Slice 5 Stage A — measured highlights (October 12, 2026)

Library grade comparisons ignore HDR source peak nits and SDR source peak
percent, which Grade recomputes from its source analysis. Saved documents retain
both values unchanged. Edited state, kept-picture identity and revert availability
share this comparison. Manual peak values and measurement modes still count as
edits. Rendering, export and Proof are unchanged; no data layout changes.

Stage A verification: 463 Node checks and 1,772 Python checks passed, three
skipped. The focused measurement-identity Electron check passed at 2560x1440
on disposable PNGs. Initial checks caught unnecessary first-save scheduling
and driver Save-button/timing mistakes; these were corrected without weakening
assertions. No rendering, export, Proof, shader or budget changes.

### Slice 5 Stage C — independent folder controls (October 12, 2026)

`POST /api/library/folder-command` supports `new`, `label` and `show`.
New folder inside uses exclusive creation and refuses an existing name,
including a difference only in capitals. Windows reserved names, forbidden
characters, trailing spaces/full stops and overlong names are rejected.
It creates only an empty folder; one Undo removes it only while it remains
empty and retains the original identity. Rename label changes `pin_labels`
in `library-preferences.json`, preserves other preferences, and is one Undo.
Labels survive database loss. Show in Explorer accepts selected folders,
checks all of them first, and uses the Windows shell. Ctrl/Shift folder
selection already exists; only Show in Explorer applies to several here.

Messages: "That name is taken. Nothing was created."; plain Windows name
reasons; "The new folder is no longer empty or is in use; Undo left it
untouched."; "Library settings could not be read; nothing was changed.";
"Restored the folder label."; "Removed the empty new folder.". Logs:
`folder_create`, `folder_create_undo`, `folder_label`, `folder_show`.
Existing `.hdrf` files and `library.sqlite3` are unchanged.

The earlier paired-file hard stop was superseded by Steve's October 12
file-command brief. A photo and its settings may be separated after a stop;
the app completes forward on restart or reports both locations without guessing.
Moving things by hand in Explorer during that gap can orphan a grade. The app
reports this in Needs attention and never guesses which photo it belongs to.
Stages B, C and D are built under that guarantee: photo and folder rename/move,
Delete and Delete all rejected use the same recorded-command service. Existing
virtual-copy removal retains its smaller action.

Stage C independent controls verification: 463 Node and 1,792 Python checks
passed, three skipped. Focused folder-controls Electron passed at 2560x1440.
The driver was corrected for transient Undo wording and explicit UTF-8 after
a failed write; assertions on disk safety were retained. No original rename,
move or delete was run.

### Slice 6 — smart albums (October 12, 2026)

`library-preferences.json` now holds `smart_albums`: stable ID, name and
saved filter expression, including rules, all/any, optional folder paths
and the common filter controls. The database remains disposable. Create,
edit and delete each save the preferences atomically, preserve other settings,
touch no photo, and have one Undo. Undo refuses an outside rules change.
No `.hdrf` or database layout changes and no migration code are introduced.

`GET /api/library/smart-albums`, `POST /api/library/smart-albums` and
`GET /api/library/smart-candidates` are backend commands. Candidates come
only from indexed files, marks, grades and virtual copies. A database stamp
including SQLite's change counter avoids retransferring an unchanged list.
The page checks for changed candidates while visible; marks apply at once
and external grade/tag changes join or leave automatically on the next check.
The frontend's `library-query.js` is the one matching engine for the filter
bar, smart albums and the editor's live count. Shared field definitions ensure
every field offered by one is available in the other. File-name rules on a
virtual copy use its original filename, rather than its copy caption.

The Albums + menu offers New smart album; the filter bar offers Save as
smart album with the current expression and folder scope. The editor has
name, all/any, field/comparison/value, is not, folder ticks and live count.
No folders ticked disables Save; all ticked means the indexed library when
changed. Saved explicit scope remains explicit on opening, even if it is the
only pin. Common quick filters remain editable required controls, so Match any
never changes the meaning of the expression saved from the filter bar.
While indexing or waiting to retry, the count and album say: "Indexing is
still running, so more may turn up." Smart albums have Edit rules and name
and Delete smart album. They accept normal available commands; manual Remove
from album and drops into them are absent. Photo rename/move also work in smart albums through the same backend
commands; saved membership remains determined by the rules.

Messages: "That smart album name is taken. Nothing was changed.";
"Smart album settings could not be read; nothing was changed.";
"Smart albums changed elsewhere; Undo left them untouched.";
"Restored smart album rules. Photos untouched."; invalid rule/comparison
messages explain that nothing changed. Logs: `smart_album_create`,
`smart_album_edit`, `smart_album_delete`, `smart_album_undo`. Normal API failure
logging retains technical details outside the user interface.

Disposable 50,000-photo synthetic-index trial: backend candidate retrieval
1.50 seconds cold, 0.56 seconds cached; unchanged polling 0.11 ms. JSON
serialization took 89 ms for a 25.5 MB snapshot. The shared engine filtered
5,000 picked items in 41 ms; the unfiltered 50,000-item sort took 59 ms.
These measure indexed retrieval and matching, not thumbnail loading or an
on-screen 50,000-photo shoot. Reproduce with the two `library-smart-*` scripts
in `tests/performance`; they touch only a new disposable output index.

Decisions made for Steve:
- Save-as retains quick filters as editable required controls alongside the
  all/any rule list. Flattening everything into all/any rows could silently
  change the existing filter meaning; the trade-off is a few extra controls.
- Virtual-copy file-name rules test the original name. Matching the copy name
  instead would be convenient for copy naming but would mislabel a File name rule.
- An empty folder selection disables Save, rather than meaning the whole
  library. It avoids unintentionally broad albums; empty-album scopes are not saved.
- The earlier original-command hard stop was superseded by Steve's revised
  October 12 guarantee. The completed commands and recovery are described below.

Stage E verification: 466 Node and 1,800 Python checks passed, three existing
skips. The focused smart-albums Electron check passed at 2560x1440 on disposable
photos: actual editor/save-as controls, live membership after rating changes,
edit/delete/Undo and absence of manual Remove from album. Fast checks cover
each shared field/comparison, all/any/is-not, scope boundaries, indexed mark,
tag and grade changes, independent virtual-copy marks, and rules surviving
database loss/rebuild. Initial focused checks exposed an incorrect test call
to copy creation and the existing empty-unknown-rule no-op expectation; both
were corrected without deleting or loosening an existing assertion. A nonempty
unknown rule fails matching rather than broadening an album. No original file
command ran against a real photo folder or a read-only test project.

### Slice 5 Stage B — recorded photo commands (October 12, 2026)

`POST /api/library/file-command` first previews a rename/move and returns an
opaque token. Executing it rechecks every photo, settings fingerprint and
indexed pending state. Renames preserve the extension. Move clashes offer
Keep both, Skip this one and Cancel move before anything is moved. Numbered
names reserve the photo and its full-extension settings filename together.
RAW/JPEG sharing a stem remain independent. Windows-invalid names are refused.

The sole backend owns durable JSON records in `library-file-commands`, outside
the disposable database. Each record carries the complete current settings,
queued marks/grades/history/copies, source file identity and checksum, index
rows and exclusive staging names. It is flushed before originals are touched.
Windows no-replace publication refuses a concurrent destination arrival.
Cross-drive moves copy to a non-photo temporary name, flush and check SHA-256,
then publish without replacement. A verified destination is locked while the
source is removed using its verified file handle, so replacement of a pathname
cannot make the command delete an unrelated file. Settings use the same
checked-copy/source-removal guard. Case-only names use recorded temporary
names. Pixels are never rewritten.

Recovery runs before the settings writer, finishes only forward, and retries
unresolved items every 15 seconds. Changed, absent, locked or occupied paths
stay untouched and appear in Activity/Needs attention with both locations.
Completion produces one notice. The record clears only after settings,
index and pictures have followed. Pending settings cannot publish at the old
path; helper replies crossing a command epoch are discarded. Quick/kept
pictures and overlay maps retarget their cache keys without changing the grade
identity. No `.hdrf` or SQLite layout change, and no migration, is introduced.

Undo is one recorded reverse command. An occupied old name is left alone and
reported. It never overwrites. The photo open in Grade and conflict-copy photos
are left alone while the others proceed. Cross-drive jobs appear in Activity
with count, Pause and Cancel remaining; both finish the current photo/settings
pair before stopping, and Cancel leaves unstarted photos where they were.

Messages include "That name is taken. Nothing was renamed."; "The destination
is occupied. Neither location was overwritten."; "Marks or grades changed;
preview the command again. Nothing was changed."; the prescribed open-Grade
message; and "Finished an interrupted file command ... Settings are together
with their photos." Logs: `file_command_complete`, `file_command_attention`,
`file_command_notice`. Records retain the detailed checkpoint and error.

Decisions made for Steve in this completion pass:
- Leave the photo open in Grade alone; allowing it would require changing live
  session ownership and could send later saves to an old path.
- Pause/Cancel finishes the current photo/settings pair and stops before the
  next. Mid-photo rollback would respond sooner but introduce extra failure
  paths; one large RAW may therefore finish copying before the pause takes effect.

Stage B validation: Node fast checks passed (466); Python fast checks passed (1,836, three skipped). The focused Electron photo-command check passed. Its first run exposed a hidden Undo button after a file change; that was fixed and the same check passed. Interruption and pending-settings checks passed; all file operations used disposable folders.

### Stage C original folder commands (October 12 completion)

Rename folder and Move folder carry every file inside, including unknown files.
Folders move only on the same drive and are never merged. An open Grade photo
or an unreadable/conflicting settings file leaves the whole folder alone.
Each folder tree has a durable record before its exclusive rename, and pending
settings are carried in it. Recovery finishes forward, without using an old
name that another file or folder has taken. Pins, nested pins, custom labels,
recent folders, smart-album folder scopes, albums and cached pictures follow.
Each command has one Undo; an occupied old folder prevents that Undo.

Decisions made for Steve: folder moves stay on the same drive (agreed brief
default). A conflict or link anywhere inside leaves the whole folder alone,
so a move cannot silently exclude part of the tree. Moving a folder also
updates saved smart-album folder scopes, so their existing scope follows it.

Stage C validation: 21 focused folder data checks passed, alongside all 36
photo-command checks. The focused Electron folder check passed. Its first run
checked Undo before it finished because both folder rows had the same name;
the check now waits for the current path to return. No assertion was weakened.
Stage C required fast suites passed: Node 466; Python 1,857, three skipped.


### Stage D — confirmed original Delete (October 12 completion)

Delete, the Delete key and More > Delete all rejected first preview the entire
selection, then ask once. The window counts eligible originals, their attached
virtual copies, and separately selected copies whose originals remain. Photos,
settings, grades and attached copies go together; selected independent copies
use the existing settings-only removal and its Undo. Removing a selected copy
never selects its source photo for deletion. Originals open in Grade or with
conflicting/unreadable settings are left alone and named in the result.

Delete all rejected takes every rejected item in the current place, including
items hidden by the quick filters. For a smart album, its saved rules and folder
scope still define that place. Preview and execution recheck the reject mark.

The backend requires a matching confirmation token and route before doing any
work. Local Windows deletion calls the explicit ITransferSource.RecycleItem
method, never an API that falls back to permanent removal. Windows returns a
Bin receipt which is checked against the recorded bytes. Startup can also find
that receipt if interruption fell between recycling and recording its result.
No other user's Bin entries are changed or emptied. If a Bin is unavailable,
the window says "gone for good" and its button is "Delete permanently". A Bin
failure is Needs attention; it never changes the already-confirmed route.
The API contract is documented by [Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-itransfersource-recycleitem).

Before deletion, complete pending settings are safely prepared beside the photo.
Photo removal is recorded before removing settings the same way. After restart,
a leftover settings file follows a proved deletion. If the photo is restored,
its leftover settings are retained. Restore both the photo and `.hdrf` entries
from Windows' Bin to bring back marks, grades, albums and copies; the next folder
check rebuilds the Library. Original Delete has no app Undo.

If a permanent removal happened but the PC stopped before its completion could
be recorded, absence alone cannot distinguish deletion from an Explorer move.
The app retains the settings and reports both recorded locations in Needs
attention. Likewise, a photo present after an uncertain delete is left alone
because it may have been restored. It does not guess or repeat a deletion just
because the record is unfinished. A deliberate Try again can retry a present
photo; an absent unproved permanent deletion continues to need attention.
Moving things in Explorer during a recovery gap can orphan a grade, as accepted
in Steve's brief; that is reported, never guessed.

### Filesystem and final recovery safeguards

The disposable D: checks exposed exFAT's changing file IDs during rename. NTFS
keeps strict IDs; FAT/exFAT recovery verifies recorded volume, size, modification
time and full SHA-256 contents at the recorded staging/destination locations.
An occupied destination is still refused even when it contains identical bytes.
Folder recovery checks its recorded files and directories, including unknown
files and empty folders. It never merges a tree. A partial temporary file on a
filesystem with unstable IDs is retained and a newly recorded exclusive name
is used; it is never reopened for overwriting on uncertain ownership.

Cross-drive copies and rewritten settings refuse extra Windows named data
streams, so data outside the main file cannot silently be discarded. Ordinary
same-drive photo renames preserve the entire original. Late scan/metadata
answers are checked again inside the marks lock at acceptance, including
case-only renames for which the old spelling is still readable. Folder path
updates preserve custom label values, smart-album names, rule text and unknown
preferences. Recovery also restores album names if the disposable index was
lost between the filesystem command and its rebuild.

Additional messages (the command record contains the checkpoint and reason):

| Situation | What Steve sees |
| --- | --- |
| Normal local Delete | Counts, "photos and their settings go to the Recycle Bin", "Move to Recycle Bin" button; restore both entries. |
| No Bin | "There is no Recycle Bin ... gone for good", "Delete permanently" button. |
| Restore during interruption | "is back. Its leftover settings were left alone." |
| Uncertain permanent deletion | "its deletion could not be proved. Its settings were left alone in Needs attention." |
| Present photo after uncertain delete | "It may have been restored; its settings were left alone. Delete it again only if intended." |
| Late helper answer | "Photos changed during this read. Open the folder again." |
| Occupied, changed, locked or missing destination | Needs attention names the recorded photo/settings/staging locations; Try again finishes forward if safe. |

All original commands use `file_command_complete`, `file_command_attention` and
`file_command_notice`; no silent permanent-delete fallback event exists.

Decisions made for Steve (completion pass, one at a time):

- Leave the open Grade photo, or a folder containing it, alone. This avoids a
  later live save going to an old path; close or leave that photo first.
- Move folders only on the same drive and never merge them. A link or conflicting
  settings anywhere leaves the whole tree alone rather than silently omitting it.
- Pause/Cancel finishes the current photo/settings pair. A large RAW may finish
  copying before the pause takes effect, avoiding a second rollback operation.
- Saved smart-album folder scopes follow folder rename/move. Their names and
  rules remain unchanged; memberships continue to use the intended folder.
- Delete all rejected includes quick-filter-hidden rejects in the current place.
  Its counted confirmation makes that wider selection visible before deletion.
- An uncertain delete retains settings and reports Needs attention. It may need
  deliberate retry; it avoids deleting a restored photo or orphaned settings.
- Preserve uncertain exFAT temporary files and refuse unsupported extra streams.
  Some unusual files need attention, but their unaccounted data is retained.

Final validation: required Node checks passed (466); Python checks passed
(1,936, three existing skips). Focused Electron checks for B, C and D, native
Windows Bin checks, interruption checkpoints and 43 disposable exFAT checks
passed. The focused photo-command Electron check also passed after the final
locked helper-acceptance safeguard. Checks used fixture images and
synthetic ARW contents in disposable folders; no real photo folder or read-only
project received a file command. No Grade rendering, export, Proof, shader,
pinned tolerance or budget changed. No push or installer build.

Failures corrected during D: the new cross-drive final guard initially compared
the destination with the source's NTFS ID; it now uses the recorded published
identity. The focused UI check needed the full Delete menu accessible label
and the existing authenticated test-harness fetch for its no-Bin simulation.
The actual D: Bin check then exposed changing exFAT IDs, leading to the verified
contents safeguard above. No existing assertion was removed or loosened.


Local completion commit notes:

- `4c2cec9`: confirmed original Delete/Delete all rejected, explicit Bin receipts,
  safe no-Bin route, verified exFAT recovery and preservation of uncertain temps.
  Required fast suites passed (466 Node; 1,936 Python, three skipped); focused
  B/C/D Electron and native Bin/exFAT checks passed. Earlier failures and fixes
  are recorded immediately above; none remains unresolved.
- Final safeguard commit: reject late helper scan/facts at locked acceptance,
  rebuild album names after index loss, and complete the PRD/code-map/decision
  notes. The same final fast suites passed, including the added race and index
  loss checks; the focused photo-command Electron check passed after this
  safeguard. Two attempted targeted invocations named nonexistent test files;
  no tests ran in those invocations, and the required full fast suite covered
  the real test files. No assertion was loosened, push made or installer built.

## 15. Packaged Library and everyday waits — October 12, 2026

Branch: `photo-library`. This was an unpacked smoke check and a focused
measurement of everyday waits, not the full performance pass. PyInstaller
built the current backend and `npm run pack:dir` built the unpacked desktop
app. No installer, full sweep or push was made.

### Packaged result

The required smoke passed in the unpacked app: a pinned folder listed and
drew real RAW pictures; its low-priority helper answered and indexing finished;
a rating reached the photo's `.hdrf`; opening in Grade, explicitly saving and
returning to the same Library produced the kept picture; an exposure map drew;
rename and Undo worked. After normal window closure, none of the recorded
Electron, backend or helper process IDs remained. No packaging-specific
process-start or file-location repair was needed. The previous backend bundle
was stale, so it was rebuilt before the smoke and again for the final source.

Unpacked size: 583,922,493 bytes, 667 files (about 557 MiB). A fresh disposable
profile, with the same copied pinned folder, took 19.5 seconds from launch to
first Library picture packaged, against 21.7 seconds in development. These
initial smoke timings include backend/helper startup, automatic browse and
first GPU picture, with Library selected as soon as the host was ready; they
precede the two frontend fixes. They are single trials, not startup budgets.

### Files and measurements

Six Sony ILCE-7RM3 ARWs, 7968 × 5320 (42.4 MP), about 85.5 MB each, were copied
from `D:\test-photos-delete-later` into disposable `codebase/output/library-slow-spots`
folders. Only the RAWs were copied, giving clean grade state. Originals and
both permitted source folders received no writes. A separate 30-copy folder
filled a scrollable viewport; the existing thumbnail size was 360, with 20
virtualized cells at 2560 × 1440. Runs were serial, on warm OS disk cache, with
fresh disposable profiles and empty Library picture caches. Before/after
viewport runs used the same copied files; the before run served the committed
frontend source. Detailed JSON and screenshots remain under that ignored
output folder, rather than creating a new evidence document.

Ranked observed waits (overlapping stages must not be added together):

| Rank | User action and elapsed time | Where time goes; waiting or work |
|---|---|---|
| 1 | First saved grade returns to an already-open Library: no update after 120 seconds before; 13.7 seconds development / 16.3 seconds packaged after | Fixed discovery wait: the old page polled no paths for a previously unedited sidecar photo, although its kept picture was already ready. Remaining helper work was 9.5 / 10.7 seconds, plus foreground gating and refresh. An isolated same-camera kept build took 10.93 seconds: corrected source opening 8.74, rendering both branches 0.12, JPEG encoding 1.42, remaining preparation about 0.65. Predominantly work after the fix. |
| 2 | Exposure maps for a whole six-photo row: normally 8.0–10.7 seconds; one final packaged navigation trial exceeded 60 seconds with four ready and two pending | The first map drew in 2.35 seconds in that trial. Recorded first-map work was 1.97 seconds; later maps queued behind the single decoder, each about 1.1–1.3 seconds of work. The final two pending jobs were not diagnosed or repaired. Earlier packaged and development trials completed all six; this is an intermittent outstanding issue, not evidence that the helper cannot start packaged. |
| 3 | Launch to first Library picture: 19.5 seconds packaged / 21.7 development | Combined app/backend/helper startup and fresh picture/GPU preparation. This timing did not isolate every startup stage; the folder-list and picture stages below do not explain the entire launch interval. No startup fix claimed. |
| 4 | Fresh folder: first picture 5.86 seconds, filled 20-cell viewport 6.39 seconds; after setup overlap 5.88 / 6.47 seconds | List took 0.39 / 0.41 seconds. First-source preparation dominated; the earlier six-file trial recorded about 5 seconds of decode/preparation for its first RAW. Parallel picture requests and serialized GPU draws fill the viewport. GPU initialization moved from after a picture response to beside its preparation (0.128 / 0.155 seconds in these runs). No measurable end-to-end gain in the controlled warm-disk pair. |
| 5 | Single view: next uncached display-size photo about 2.8–3.5 seconds; entry about 3.0–4.0 seconds | About 0.8 seconds recorded decode/preparation, a roughly 3.1-second request in the baseline, and about 0.3 seconds drawing. The request's remaining time includes array conversion, compressed-cache publication, scheduling and transport; compression is inferred from the unchanged cache code, not individually timed. Work, with possible queue time. |
| 6 | Scroll to previously unseen end of the 30-copy folder: 2.46 seconds | Waited for the new last row and all its actual picture keys, not just the old cells. Visible picture work; scrolling completed with the new setup order. No before/after claim. |
| 7 | Compare: entry 1.65–2.13 seconds; next cached picture about 0.004 seconds, newly requested picture 1.19–1.60 seconds | Cache reuse removes most work; new compare-sized picture preparation and transport dominate the slower flip. |
| 8 | Rename about 0.87–0.93 seconds; Undo about 0.84–1.37 seconds | The earlier 4 / 11-second waits did not reproduce. Isolated rename execution 0.84 seconds and Undo 1.06: durable record flushes about 0.50 / 0.58 seconds and content checksums about 0.18 / 0.17 seconds. Settings and move verification nest those stages. Safety work; left unchanged. |
| 9 | Arrival bar to first picture 0.50–0.63 seconds | Baseline 0.625, final development 0.497, final packaged 0.629 seconds. In the baseline, request/preparation was about 0.58 seconds and draw 0.04. No clear slow wait reproduced after the bar. Explicit checks still used the existing stable-size guard; time waiting for arrival recognition is excluded. |

### Changes and hard stop

Only `frontend/photo-library.js` changed in production. Settings polling now
includes the existing visible grid/filmstrip cells and selected photo, alongside
the already edited/database rows. That lets the page discover a first saved
grade without re-browse. It does not scan every photo or change the polling
interval. GPU initialization starts with a visible photo request, overlapping
the existing preparation; draw still uses the same renderer and reports setup
errors through its usual path. No new messages, settings, rendering route,
cache allocation or priority was introduced. The large variation in earlier
first-paint samples is not claimed as a speedup; Steve should judge fresh
folder opening in use before any more timing runs.

After fixing discovery, the worst reproducible remaining grade wait is the
corrected source opening. The brief's strict-area stop applies: no Grade,
export, Proof, shader, decode-route, tolerance, limit or budget changed.
Slice 5 records, flushes, checksums and verification remain intact. No further
performance implementation was made.

Choices left unbuilt, for Steve to consider one at a time:

- Keep the exact saved-grade picture and its current opening cost, or consider
  a rough picture first / another preparation route. The latter needs an
  explicit quality and consistency decision; lens corrections and agreement
  with Grade/export could break. It is outside this brief's strict area.
- For slow Single flips, less cache compression could trade disk space and
  earlier cache eviction for latency. More retained pictures or prefetching
  would trade memory and foreground competition for faster navigation.
- For overlays, investigate the pending-job stall before choosing more
  concurrency or a rougher map. Concurrency can compete with Grade and raise
  memory use; a rougher map changes what the overlay tells the user.

A late file-command health refresh also reset navigation during one timing
attempt after Undo. The driver allowed the existing refresh to settle before
measuring subsequent views. This existing interaction is recorded for the
full pass; no file-command safety or refresh logic was changed.

### Decisions made for Steve

Use clean disposable RAW copies and fresh profiles; count arrival from the
bar's actual notification, retaining stable-size checks; use 30 copies to
measure a genuinely filled viewport; make only the two frontend scheduling /
discovery fixes; preserve exact kept output and all file-safety work; leave the
remaining choices unbuilt. No push, installer or broad sweep.

### Validation and local commit notes

Required fast checks: 466 Node tests; 1,936 Python tests, three existing skips.
Focused regressions cover the first saved grade replacing the default picture
in the same Library (original bytes unchanged), and GPU setup starting while
its visible-picture request is held. Both passed development and final
packaged runs. The foreground/background interaction check verified Grade
editing while thumbnail work is paused and then resumed; helper priority stayed
below normal. The filled-viewport check also scrolled to new pictures.

Existing packaged `photo-library-slice-2.js` stopped at its wording assertion:
it expected “Library index up to date” but the current heading is “Activity”.
It was left unchanged and not rerun. The combined final packaged camera driver
also hit the all-six-map timeout above; a separate focused completion proved
the required one map, grade/kept picture and normal shutdown. An initial
normal-close instrument cleanup threw after the already closed Electron app;
the disposable instrument was corrected without changing the production runner.
No existing assertion or budget was loosened.

- First-save discovery commit: poll the existing visible/selected photos;
  required fast suites and saved-picture regression in development/packaged.
  Original photo bytes stayed unchanged. Unrelated wording failure and
  intermittent map timeout remain recorded above.
- GPU setup scheduling commit: overlap the unchanged setup with visible photo
  preparation; the same grouped fast suites, setup-order regression in both
  builds, foreground pause/resume and viewport/scroll checks passed. Controlled
  warm-disk timings showed no measurable overall gain; no budget changed.
- Documentation commit: record packaged smoke, ranked stages, decisions and
  hard stops here; replace PRD section 8's old arrival-only note and close F3's
  pending packaged confirmation. No additional production code.

## 16. Library speed round 1 (October 12, 2026)

### Part 1: built-in stopwatch

Always-on, batched one-line events now join the existing backend Library log.
They record app/backend/helper/page startup; page and helper queue delays;
decode, source reduction, starting look, cache storage, pixel fetch, renderer
setup and individual draws; saved-picture source/render/encode/publication;
and helper pauses, resumes and cancellations. The page sends bounded metadata
only, with paths and request/picture identifiers, never photo pixel content.

Serial development and unpacked packaged launches used fresh disposable
profiles and six copied Sony 42 MP ARWs, warm disk, at 2560 x 1440. Seconds
below are cumulative from app start; they are observations, not launch fixes.

| Event | Development | Packaged |
|---|---:|---:|
| App ready | 0.675 | 0.750 |
| Backend process started | 3.255 | 3.738 |
| Helper ready | 7.156 | 11.807 |
| Backend ready | 7.242 | 11.823 |
| Window created | 7.293 | 11.879 |
| Page loaded | 9.947 | 14.278 |
| Library page ready | 10.000 | 14.498 |
| Folder listed | 12.085 | 19.892 |
| First picture requested | 12.586 | 19.905 |
| First picture answered | 13.812 | 21.139 |
| First picture drawn | 16.212 | 24.205 |

Largest intervals: backend start to ready (4.0 / 8.1 seconds), packaged
page-ready to folder list (5.4 seconds), window to loaded page (2.7 / 2.4),
and first answer to draw (2.4 / 3.1). Backend-to-ready includes helper startup;
these nested stages must not be added twice. One sample per mode cannot
establish a startup regression against section 15.

First-draw cost was confirmed: roughly 2.4 / 3.1 seconds, dominated by waiting
for GPU submitted work; later ordinary draws were about 0.02-0.04 seconds.
Synchronous pipeline creation and highlight analysis were negligible. The log
does not prove which GPU compilation or execution caused that completion wait.
The shared five-second first decodes did not reproduce: packaged first four
decoder imports took 0.12 seconds, RAW processing 0.41-0.45, reduction
0.22-0.25, total decoded-source stages 0.80-0.82 and starting looks 0.095.
No warm-up, source, rendering, queue redesign or launch change was made.

Grouped validation: 466 Node tests passed; 1,943 Python tests passed with
three existing skips. The combined six-map/save driver passed development
and packaged during evaluation; the existing development folder-check
regression passed. The saved-source experiment and its stop are recorded
below; those checks alone do not approve that proposed route.

Local commit note: add the stopwatch without changing rendering; grouped
fast suites and focused disposable launches passed. Initial driver readiness
and toggle-selector errors, and a mock signature mismatch introduced by the
saved-source experiment, were corrected before those passing runs.

### Part 2: exposure-map/check circular wait removed

The hypothesis reproduced before the fix: a running map, second queued map
and started folder check all stopped completing. The map lane waited for
the active check while the check waited for that map lane to empty. The
minimal fix makes maps/kept pictures proceed across checks; checks yield
to that lane. Foreground Grade pauses and picture/index yielding remain.
No ranked-queue redesign was introduced. The stale slice-2 heading assertion
now expects the existing Activity wording; only that wording changed.

The same deterministic reproduction passes after the fix. The grouped native
driver delivered all six exposure maps during a simultaneous folder check
in development and packaged runs. Existing folder-check regressions passed
in both modes: timed intake, stable grid selection/scroll, toolbar/folder
menu, stable single/filmstrip and selected-photo removal. Original copied
ARW bytes remained unchanged. The 21 focused lane/worker/folder Python
checks and the grouped fast suites above passed.

Local commit note: remove the mutual wait, add its regression and update
the permitted wording assertion. No outstanding map/check failure observed;
the saved-source exact-match stop below is separate.

### Part 3: guarded open-source kept picture (approved follow-up)

Steve approved the fast route only where the open source is equivalent,
with today's reopened route as fallback. Grade saves now capture references
to their corrected source, reduce it off the save thread, and call the same
export render functions and unchanged gain-map writer. No full-size duplicate
is made. Reference release, superseded jobs, grade identity, source fingerprint
and source size/date checks prevent stale publication. Reverts without an
open image, virtual copies and explicit requests retain the helper route.

The equivalence guard compares the source cache's immutable decode identity
with the current inputs: content, dimensions, decode/color versions, reference
white, interpretation and RAW recipe. It also checks that the cache and Grade
still refer to the same source arrays. A mismatch selects the existing route.
This is deliberately conservative: a decode-white change falls back even if
a particular scene-linear source might otherwise be reusable. No new setting
or user decision is required at save time.

The original exact-match stop was correct. For a generated Ultra HDR JPEG
opened at 203 nits and changed to 100, reopening rescales the decoded source
by 203/100 while the in-session white edit changes only rendering context.
Unconditionally reusing the open source produced different HDR arrays
(maximum absolute difference 0.25750059); SDR arrays matched. This existing
behavior also means HDR Grade and export can look different after reopening
a saved project. It is reported in known-limitations.md, not fixed here.
The guarded route preserves today's reopened result for these cases.

Exact comparisons pass for both rendered branches and actual JPEG bytes on
the corrected 42 MP ARW, plus generated Ultra HDR sources opened/saved at
203/203, 100/100, 203/100 and 100/203 nits. The last two use the fallback.
Tests also cover crop/local grades, changed decode recipe, opening another
photo, a newer save, external grade/source changes, and release of large
source references before encoding. No tolerance or picture math changed.

### Save acknowledgement and the unchanged Grade gate

Before enabling the guarded route, two controlled development launches using
the existing producer measured 0.400 and 0.300 seconds for Save immediately
after editing. Thus the earlier 0.055/0.065 section-15 samples were not a
stable current baseline, and 0.35 seconds did not demonstrate a regression
from this producer. A new cheap one-line save event separates lock waiting,
recovery retention, preflight, durable registration, scheduling and status.

In the instrumented existing-route run, recovery retention cost 122.89 ms
and durable registration 160.15 ms of a 290.78 ms backend save. Lock waiting
was 0.01 ms, preflight 0.73, scheduling 1.46 and status 5.53. Both durable
phases include the existing SQLite transactions; they were not combined,
deferred or weakened. This explains the cost of the current slower samples;
the earlier isolated 60-ms samples do not establish a universal 60-ms limit.
The guarded development run spent 1.20 ms scheduling, and the packaged run
1.83 ms. Their backend recovery/registration phases still dominate. The
new source route adds no meaningful save-request work or image processing;
Save remains within the unchanged route's observed range under these
conditions, rather than claiming a new 60-ms guarantee.

The roughly two-second gate is not a post-save timer. DesktopRequestBoundary
holds LibraryWorker.busy for every /api/session and /api/library/grade
request, including responses. Saving does not finish or cancel outstanding
Grade preview/proxy/scope requests. In the final development trace an HDR
preview starting about 0.28 seconds after Save began ran 2.526 seconds,
overlapping a 1.807-second scope request; packaged HDR preview took 2.577
seconds and scopes 1.766. Their completion explains the approximately
2.5-second producer gate wait after save acknowledgement. Neither the
request boundary, preview work, scope work nor pause/release rules changed.

### Final timing and validation

Final serial 42 MP trials: Save acknowledged in 0.325 seconds
development / 0.371 packaged; edited picture displayed in
6.230 / 5.801 seconds, versus section 15's
13.685 / 16.285. This is faster, but the three-second target is not met.
Earlier exploratory samples were 4.787 / 4.707 seconds; current encoding
cost explains much of that variation, rather than a new source decode.

Development: source/hash/reduction 0.489 seconds, render 0.085, encode 1.476, producer gate/checks/preparation 2.513; save-to-written 4.642, written-to-drawn 1.050. These intervals overlap with frontend return and discovery; do not add them to the complete end-to-end result.

Packaged: source/hash/reduction 0.422 seconds, render 0.096, encode 1.549, producer gate/checks/preparation 2.513; save-to-written 4.721, written-to-drawn 0.326. These intervals overlap with frontend return and discovery; do not add them to the complete end-to-end result.

Both native runs delivered all six maps through a simultaneous folder check,
showed the new kept picture in the same Library without re-browsing, reported
no page errors and preserved all copied original ARW bytes. Grouped fast
checks passed: 466 Node and 1,948 Python tests, three existing skips. Focused
source/fallback/publication tests passed; backend and unpacked Windows app
were rebuilt. Earlier folder-check regressions already passed in both modes;
their behavior is unchanged in this part. No broad sweep, installer, push,
export/Proof/decode change, or later-round optimization was performed.

Local Part 3 commit note: reuse equivalent corrected sources asynchronously,
preserve the existing fallback and guards, and measure the unchanged durable
save cost. All grouped checks above passed. Outstanding limitations are the
unfixed reopened-reference-white behavior and the unmet three-second display
target. Steve should try Save and return to the same Library on his usual
RAW edits before further responsiveness timing or gate changes.


## 17. Opening Library photos in Grade (October 12, 2026)

Part 1: after the existing leave-photo question, Grade appears before import
work starts. One loading state names the photo, empties the previous picture,
scopes and readouts, and locks edits. Returning to Library cancels the open;
newer requests supersede older ones, including grants and grade attachment.
Failure returns to the same Library selection with the reason. No thumbnail
stand-in is shown.

Part 2: saved or pending grades select their RAW recipe, interpretation and
reference white before the import. The existing recovery choice is asked
before decoding, so restored work can use its own decode settings once.
Applying the selected grade reuses the session only when source identity and
all decode settings agree. Its existing fingerprint verifies the grade; no
second hash or decode is needed on the stable open path. A grade changed
externally during the open may still need the existing safe reopen fallback.
Conflict resolution and project opening retain their existing reopen route.
Recovery retains its original default grade and durable unsaved work.

The unused 512-pixel import thumbnail is no longer requested. Polling starts
immediately. Attach returns its initialized clean session without another
session fetch. Denoise-off opens do not start a full-source noise warm-up.
Scopes and overlays start together after the first frame and do not hold the
loading state or controls open. Pixel processing methods are unchanged.

### Initial measurement audit (October 12)

- RAW corrections, colour conversion/normalisation and negative-value mapping
  produce the actual image; the first frame needs their exact output.
- HDR classification, AP1/luma/BT.2020 peaks and the RAW starting exposure feed
  initial Grade highlight settings, source metadata and export/Proof. They
  remain before the first frame, with the same methods and values.
- RAW transport diagnostics feed source metadata/readouts and are measured
  from the decoder's camera-RGB buffer. Deferring them requires retaining that
  buffer or changing their lifetime; this was not changed under the strict
  numerical and memory-budget constraints.
- Source peak candidates feed the exact peak-measurement endpoints. Their
  construction remains unchanged; delayed readiness has not been validated.
- Source hashing validates the saved source and keys its mip cache, so it
  remains before the first frame, once on the stable open path.
- The brief's second resize is normally a no-op when the image already fits.
  When geometry enlarges it, resizing is required to preserve the current
  result; removing it would not be an identical-pixels optimization.
- Cold source mip persistence and disk pruning still run before the proxy
  response. Deferring these needs a separate review of the shared cache's
  ownership, cancellation and memory limits. No cache layout or queue change
  was made. This remains an incomplete Part 2 first-frame requirement.

At the end of the initial October 12 batch, the stopwatch recorded the Library click, Grade-visible loading,
backend phases, grade attachment, first frame and controls-ready events. No
42 MP before/after timings, GPU drivers or unpacked-build checks had been run,
following Steve's fast-checks-only instruction. The under-0.5-second and
four-second targets were therefore unverified, not claimed achieved.

Fast validation: 471 Node and 1,959 Python tests passed, three existing skips.
Focused tests compare decoded pixels, HDR measurements, grade documents and
preview sources bit-for-bit with the previous open route, count one decode
and one hash, reject fingerprint mismatch, preserve recovery defaults, and
check loading, stale-open exclusion and the runner's initial-load barrier.
Three staged-thumbnail tests were updated for the explicitly removed unused
product; authoritative decode and cancellation assertions were retained and
strengthened. No export/Proof algorithm, shader, tolerance, limit or budget
changed. No installer or push.

Small startup fix: both Electron runners wait for complete initial page load
and its main-process continuation before navigation. Only ERR_ABORTED (-3)
from window loadURL is treated as an interrupted navigation; genuine backend
failures keep their existing dialog and shutdown handling.

### Part 2 continuation — October 13, 2026

Before: `10eeb1e`; after: the memory-safe hash/cache changes below. Actual
Library double-clicks, 2560×1440, three opens per kind in development and
unpacked packaged builds. Each run used disposable copies of the 42 MP
7968×5320 ARW and a disposable profile under `codebase/output`. Preparing the
saved grade was outside the timing samples. The three fresh paths had never
been opened in Grade and had no saved sidecar. Their byte-identical contents
share the preview cache warmed by saved-grade preparation. These are warm
source-mip results; they do not establish a cold-cache saving. Original photo
bytes were checked unchanged. No writes to Steve's folders or test projects.

Click to first real frame, seconds (all three samples and their means):

| Build and kind | Before, three opens | After, three opens | Mean before → after |
|---|---|---|---|
| Development, saved grade | 4.45 / 4.45 / 4.70 | 4.48 / 4.51 / 4.48 | 4.53 → 4.49 |
| Development, fresh paths | 5.78 / 4.42 / 4.48 | 4.71 / 4.46 / 4.46 | 4.89 → 4.54 |
| Packaged, saved grade | 4.51 / 4.47 / 4.52 | 4.48 / 4.46 / 4.47 | 4.50 → 4.47 |
| Packaged, fresh paths | 4.75 / 4.70 / 4.49 | 4.70 / 4.74 / 4.47 | 4.65 → 4.63 |

Backend stage means, seconds. Repeated entries for a phase are summed per
open, then averaged; these are logged stages, not a new measuring method.

| Build, kind and run | RAW development | Colour conversion | Analysis | Session indexing | Ready |
|---|---|---|---|---|---|
| Development, saved grade, before | 2.187 | 1.006 | 0.734 | 0.224 | 0.063 |
| Development, saved grade, after | 2.166 | 0.989 | 0.735 | 0.156 | 0.115 |
| Development, fresh paths, before | 2.104 | 0.985 | 0.724 | 0.224 | 0.072 |
| Development, fresh paths, after | 2.135 | 0.994 | 0.718 | 0.157 | 0.142 |
| Packaged, saved grade, before | 2.188 | 0.978 | 0.719 | 0.213 | 0.068 |
| Packaged, saved grade, after | 2.182 | 0.974 | 0.719 | 0.161 | 0.119 |
| Packaged, fresh paths, before | 2.114 | 0.964 | 0.723 | 0.235 | 0.182 |
| Packaged, fresh paths, after | 2.192 | 1.010 | 0.719 | 0.172 | 0.125 |

Metadata/RAW-metadata/lens stages were negligible for this fixture. Click,
Grade-visible, attachment, first-frame and controls events remain available
in `codebase/output/library-grade-open/{before,after}-{development,packaged}.json`.
The first fresh development baseline spent 1.354 s between click and starting
the open. Its slower total must not be attributed to the backend changes.
The warm saved-grade differences are small; a substantial first-frame speedup
and the four-second target have not been demonstrated.

What now overlaps: source SHA-256 reads file bytes beside the existing decode,
then joins before session identity is published. It needs no decoded-image
owner or full-size copy. A changed source stat uses the existing late-hash
behaviour. The stable path still decodes and hashes once.

What remains serial: RAW corrections produce the pixels for normalization,
colour conversion and negative mapping; their output feeds classification,
peaks and initial Grade settings. Source candidates still finish before
publication. Other peak/analysis scans can be independent, but overlapping
them would overlap their scratch allocations, violating this brief's memory
condition. Their methods, order and values are unchanged.

Rejected trial: RAW transport diagnostics could read the existing camera-RGB
buffer beside normalization/in-place colour conversion, with identical
results and no additional full-size photo. However, one controlled backend
peak-private-memory sample rose from 1,230,946,304 to 1,247,121,408 bytes
(+15.4 MiB), so that change was removed. Separately timed original routines
cost 0.748 s diagnostics and 0.527 s normalization plus colour conversion:
0.527 s is an ideal upper bound for overlap, not a measured first-frame
saving. Steve's one optional decision is whether that possible saving warrants
allowing about 16 MB more peak memory; it could reduce RAM available to other
photos/apps. No such permission is assumed.

The retained change's backend sample was 1,229,533,184 private bytes versus
1,230,946,304 before; peak working set 839,131,136 versus 840,822,784 bytes.
These are single-process samples, not a claimed memory reduction. The
508,677,120-byte source and full-size owner count are unchanged.

First-frame cache review: the GPU proxy response sends its complete picture
body before source-mip disk persistence, stale-file cleanup and pruning. A
background task carries only cache identity and session/source epoch; it
never queues a session or image owner. It takes at most a 1 MiB byte chunk
from the still-owned immutable LRU entry, releasing the memory lock before
I/O. Eviction or supersession aborts the temporary write. Publication is an
atomic replace after the existing header/checksum is complete. Even a cancel
racing publication can only leave a complete entry for the exact old identity,
which is valid for reuse. Cache format, layout and budgets remain unchanged;
evicted/disabled-memory entries skip optional persistence. Foreground memory
hits do not wait on a paused background disk write. Existing synchronous
cache consumers retain their route, with direct buffer writes instead of
whole-level byte copies.

Validation for the group: 471 Node tests, 1,969 Python tests passed, three
existing skips; focused hash/cache/API checks 92 passed. The 42 MP before/after
identity check passed for new and saved grades: source pixels, proxy bytes,
all recorded analysis/metadata, peak candidates and edit documents exactly
match. Deferred multi-chunk cache files also exactly match the prior format.
Development and packaged `library-grade-saving.js` passed: saved load, both
grades/crop, unsaved leave, recovery and conflict handling. Final stopwatch
runs in both builds also cancelled an in-flight Library open and reopened the
saved grade correctly. No shader, export/Proof algorithm, tolerance, limit or
budget change; no sweep, installer or push.

Failures: the diagnostic overlap failed the memory condition and was removed.
Early stopwatch fixtures needed log-record parsing and queued-sidecar waiting;
the final checks have no outstanding failure.

Local commit notes (checks above apply to the grouped changes):

- Hash overlap: one file hash beside decode, exact identity retained; fast and
  identity checks passed; no retained failure.
- Cache housekeeping: picture body first, weak ownership, cancellation and
  atomic identical files; fast/cache/API and focused app checks passed; no
  retained failure.
- Timing record and drivers: disposable 42 MP before/after samples, identity
  and memory probes; both app builds passed; the rejected memory trial is
  recorded rather than shipped.

What to try: in the development or unpacked app, double-click a saved-grade
RAW, a fresh RAW, then cancel an open by returning to Library and reopen the
saved grade. Confirm the first real picture and settings look unchanged and
judge the wait; do not spend another timing sweep on these small warm changes.

### Grade import bands — October 13 follow-up

Steve approved the earlier 16 MB option and replaced the former memory rule:
no additional full-size photo copies held at once; about 100 MB extra peak
working memory is allowed, larger additions require his decision. This round
uses that allowance for two-worker bands rather than retaining the three-worker
trial. No numerical budget or existing cache limit changes.

Before is `0e8a2b6`, including the prior hash/cache changes. The stopwatch ran
three saved-grade opens and three never-opened paths per build, before and
after. Same disposable 42 MP ARW copies, disposable profiles, 2560×1440,
saved-grade preparation outside the samples and shared warm source-mip cache
as last round. The fresh paths had no sidecar before opening. Source hashes
confirm the copied photo bytes remained untouched. Timings were taken without
fast tests or builds competing for CPU. No cold-cache saving is claimed.

Click to first real frame, seconds:

| Build and kind | Before, three opens | After, three opens | Mean before → after | Saving |
|---|---|---|---|---|
| Development, saved grade | 4.72 / 4.70 / 4.68 | 3.98 / 3.99 / 3.97 | 4.70 → 3.98 | 0.72 |
| Development, fresh paths | 4.71 / 4.45 / 4.52 | 3.96 / 3.97 / 3.95 | 4.56 → 3.96 | 0.60 |
| Packaged, saved grade | 4.43 / 4.72 / 4.73 | 3.96 / 4.02 / 4.04 | 4.63 → 4.01 | 0.62 |
| Packaged, fresh paths | 4.66 / 4.72 / 4.71 | 4.14 / 3.96 / 3.97 | 4.70 → 4.02 | 0.68 |

Stage means across the six opens per build, seconds. Each open's repeated
phase entries are summed before averaging. These use the existing stopwatch.

| Stage | Split and why | Development before → after | Packaged before → after |
|---|---|---|---|
| RAW | Partly: transport maxima/counts and camera normalization; disjoint writes, integer counts and ordered maxima. | 2.213 → 2.018 | 2.216 → 1.998 |
| Colour | Yes: white balance/matrix and negative mapping are per-pixel; the same arithmetic writes separate row ranges. | 1.008 → 0.677 | 1.049 → 0.684 |
| Analysis | Partly: exact luma/BT.2020 scan bands; original band shapes and ordered maxima. Robust samples/quantiles stay serial. | 0.745 → 0.609 | 0.752 → 0.610 |

What is not split: LibRaw's AHD demosaic remains the same opaque decoder
operation; changing its neighbour processing would exceed this brief. The
opposed-highlight pixel chunks read immutable neighbours, so they could be
independent; chrominance sums would additionally require identical original
chunk reductions combined in original order. Neither was changed: the supplied
ARW has no clipped photosites, so these paths are bypassed and have no measured
saving here. Their extra scratch space on clipped RAWs is unvalidated. The
existing CFA-pattern normalization/white-balance passes also have disjoint
channel destinations, but were left alone rather than expanding the trial
beyond the main timed band loops. No separate saving is claimed for them.
Analysis keeps its original stride, samples, quantile methods and small-image
route: a global percentile is not an independent-band calculation. Initial
RAW exposure and first-found peak-candidate construction remain serial. All
required measurements still finish before the first real frame.

The new worker scope is an explicit opt-in of the main Grade SessionStore.
Default SessionStores, including the Library helper's saved-preview rebuilds,
remain serial. The helper's priority, decoder count, queue and native thread
settings are untouched. One open may use the pair at a time; a simultaneous
open falls back to serial execution. Machines with fewer than four logical
CPUs stay serial; otherwise at most two workers leave at least half available.
The local CPU probe on this 12-logical-CPU machine measured roughly 1.7–2.0
active cores in the changed routines, including their native NumPy calls.
Cancelled/failed opens join active bands and cancel queued work before their
arrays can be released or another session published. Results combine in
original band order, regardless of worker completion order.

Memory: the one backend peak-private-memory sample was 1,228,824,576 bytes
before and 1,236,025,344 after (+7,200,768 bytes, about 7.2 MB). Peak working
sets were 839,303,168 and 839,442,432 bytes. These are samples, not a guarantee
of an exact RAM increment for every source. The 508,677,120-byte decoded
source and full-size buffer count are unchanged. Negative mapping caps each
worker's band at about 100k pixels to bound even its all-negative float64
working arrays; it changes band boundaries, not the per-pixel method. Matrix
and exact-peak scan bands retain their old shapes. No photo arrays are returned
or accumulated as queued results; only scalars/small integer vectors or None.

Failures/corrections: the three-worker trial raised sampled private memory by
140,951,552 bytes (about 141 MB), exceeding Steve's allowance, so it was not
retained. The first scope design would also have enabled helper saved-preview
rebuilds; the explicit main-store opt-in fixed that before the final packaged
checks. No outstanding check failure.

Validation: 471 Node and 1,981 Python tests passed, three existing skips;
36 focused band/RAW/open-reuse tests passed. The real 42 MP new/saved identity
checks match prior source and proxy bytes, analysis/metadata, peak candidates
and documents bit-for-bit. Synthetic cases cover band boundaries, transport
ceiling counts, non-neutral camera transforms, all-negative pixels, signed
zero, NaN/infinity sanitation, exact/robust peaks, worker isolation and failure
joining. Development and unpacked `library-grade-saving.js` passed for saved
load, unsaved leave, recovery and conflicts. Final stopwatch runs also passed
in-flight cancellation and saved-grade reopening in both builds. The first
frame still precedes source-cache persistence/pruning. No CPU export/Proof
method, shader, tolerance, limit, budget, cache layout, installer or push.

The measured total savings exceed half a second in both builds, so the capped
version is retained. Detailed events and CPU/memory samples are under
`codebase/output/library-grade-open/bands-*`; last round's timing files remain
separate. The timing driver supports `--bands` to keep the records distinct;
identity/memory probes explicitly opt into the main Grade policy.

Local commit notes:

- Import-only band processing: two workers, exact ordered results and explicit
  Grade opt-in; grouped fast/identity/open checks passed; the oversized trial
  and original helper-affecting scope above are not shipped.
- Timing record/probes: fresh three-open before/after records and opt-in
  identity/memory probes; both builds passed; no outstanding failure.

What to try: open a saved-grade RAW and a fresh RAW, cancel one open and reopen
it, and judge the wait while other Grade work is active. Confirm the same
picture, saved settings and readouts. Leave the two-worker cap in place unless
Steve chooses to revisit the larger-memory option.


## Add folder views and camera peeks — October 14, 2026

Add folder now remembers its List/Grid view, with the switch beside the path
bar. Grid uses the existing file-browser folder icon and temporary photo
thumbnails. Folder selection, Ctrl/Shift selection, double-click navigation
and Pin share the same behavior in both views. Going Up selects and scrolls
to the folder just left, and shows its peek.

A folder peek counts supported photos directly inside that folder and lists
their file types. It tries at most 12 eligible files to show up to four
embedded camera JPEGs; it never generates pictures for a peek. Missing or
unreadable embedded previews can therefore leave fewer pictures, or a
message explaining that none are available. Photo tiles and the selected
photo use the media-browser service, preferring embedded JPEGs and otherwise
making a temporary thumbnail with a loading state. Ambiguous colour inputs
retain the existing interpretation message.

Only visible grid tiles and peek frames request pictures. Scrolling them out
of view aborts their requests and releases their object URLs. The picker has
two request slots, reserving browser connections for other work. Closing or
navigating cancels the previous folder and pictures. An already executing
decoder finishes its current read before observing cancellation; cancelled
results are not written to disk. The existing media-browser cache prunes to
512 JPEG files after generation, including in the desktop helper. Its new
keys refresh prior generated thumbnails. None of this uses the Library
picture cache, changes its allowances, or changes Grade, export or Proof.

The layout follows `product/library-wireframes/add-folder.html`, retaining
the existing application dialog dimensions and styles. The reference was
opened from a static server rooted at `ai`, with its stand-in photos loaded.
