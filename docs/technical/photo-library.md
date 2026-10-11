# Photo Library: How It Works

This page records how the Photo Library stores and protects your ratings,
picks, colour labels, tags and albums, how its background process works, and
why it was built this way. It is written so that a problem can be traced to a
specific file, rule or message.

- **Updated October 11, 2026: background-writer Stages A, B and C built.**
- Sections 1 to 10 describe what is built. Section 11 lists the remaining
  gaps. Section 12 explains the library-wide health report and diagnostics.
- The Library is still being built, and its controls change often. A
  how-to-use guide will be written when they settle. Product intent lives in
  the [Photo Library PRD](../product/Photo_Library_PRD_2026-10-09.md).

Terms used here:

- **Marks:** a photo's rating, pick or reject flag, colour label and tags.
- **Settings file:** the small `.hdrf` file the app writes beside a photo.
- **Library database:** the app's own index of every photo it has seen.
- **Helper:** a second, low-priority process that does the Library's slow
  reading.

---

## 1. The idea in one paragraph

Your marks and album memberships are written to a small settings file beside
each photo. That file is the lasting record: it travels with the photo when
the folder is copied, backed up or moved to another computer. The library
database is a fast index of those files, kept so that the app can show tag
counts, albums and search results without opening thousands of files. The
database can be deleted and rebuilt. The originals are never changed.

**Why:** a library that lives only in a database is lost if the database is
damaged, and does not move with the photos. A library that lives only in
files is too slow to search. Keeping both, with the files as the record,
gives a fast library that can always be rebuilt.

There are three exceptions, where the database is the only record. They are
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
| `library.sqlite3` | The library database (section 4). Created the first time a folder is opened in the Library. | Rebuilt from the settings files as folders are visited or indexed. Three things are lost: see section 4. |
| `library-preferences.json` | The meanings you gave the four colour labels, and whether background indexing is on. | Label meanings are blank again; indexing returns to on. |
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

A settings file is created only when a photo is first marked or added to an
album. Opening and browsing a folder writes nothing.

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

Grades are not stored in the settings file yet. That arrives with a later
slice of the Library.

---

## 4. The library database

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

Everything is rebuilt from the settings files except:

1. **Marks on photos with `pending = 1`.** Their settings files were never
   written, so the database held the only copy.
2. **Empty albums.** An album with no photos exists only in the database.
3. **Tags that no photo carries**, such as one made with New tag and not yet
   used.

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
- It has three kinds of work, each with its own lane so that one cannot
  hold up another:

  | Lane | Work | At once |
  |---|---|---|
  | Main | Listing the folder you just opened, the folder tree, camera details for photos on screen, Import thumbnails | 1 |
  | Picture | Grid, single-view and 100% pictures | 6 |
  | Index | Background indexing of pinned folders | 1 |

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
  Folders are **not** watched for changes in between.
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
copies are never written. Virtual copies remain a later slice.

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
2. Folders are not watched (separate slice).
3. Detected conflict copies are not imported as virtual copies (later slice).

Stage B closed unified Activity, writer Pause/Resume, grouped Try again,
the health command, diagnostics and raw validation messages. Plain wording
for invalid settings was included here because Stage B explicitly requires
technical validation text to stay out of user messages. Stage C completed
offline edits, helper restart, indexing recovery and conflict-copy detection;
the plain invalid-settings wording remains unchanged.

## 12. Reading library health and diagnostics

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
Indexing keeps `GET/POST /api/library/index`.

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
