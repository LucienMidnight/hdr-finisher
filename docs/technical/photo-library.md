# Photo Library: How It Works

This page records how the Photo Library stores and protects your ratings,
picks, colour labels, tags and albums, how its background process works, and
why it was built this way. It is written so that a problem can be traced to a
specific file, rule or message.

- **Checked against the code on October 11, 2026** (commit `1906506`).
- Sections 1 to 10 describe what is built. Section 11 lists the known gaps.
  Section 12 describes a design agreed on October 11 that is **not built
  yet**. Do not read section 12 as current behaviour.
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
is called "kept in the library". It is set for every photo in a change
before any file is written, and cleared for each photo as its file is
written successfully.

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

1. **Check the photos.** Every photo must exist and be a supported type.
   Otherwise the whole command stops with a message and nothing changes.
2. **Check every settings file first.** If any one is unreadable, the whole
   command stops before anything is written. *Why: half of a bulk change is
   worse than none.*
3. **Work out what changes.** Photos whose marks would not change are left
   out. They are not rewritten and are not part of the undo step.
4. **Save to the database, all at once.** Every changed photo is saved in
   one step and flagged pending. This step either happens completely or not
   at all, even if the app is killed in the middle.
5. **Write the settings files, one at a time.** For each photo:
   - a temporary file named `.<photo name>.hdrf.<random>.tmp` is written in
     the same folder and flushed to the disk;
   - it then replaces the real `.hdrf` file in a single step, so a settings
     file is never left half-written;
   - the photo's pending flag is cleared.

   If a file cannot be written, the photo stays pending, a message is added
   to the result, and the remaining photos carry on.
6. **Record one undo step** for the whole command.

Only one command runs at a time. A second command, and anything that needs
to read marks, waits until the first has finished all of step 5. On a large
change the Library shows "Saving marks…" until then, with no progress count.

### Library-wide tag and album commands

Rename, Merge and Remove for tags, and Rename and Delete for albums, find
every photo carrying the name and run the steps above.

- **Only connected photos are changed.** A photo whose file cannot be found
  (an unplugged drive, a missing folder) is left as it is and counted in the
  result: "N photos on folders that are not connected were not changed."
- Because those photos still carry the old name, **the old name stays in
  the list** with them as its count.
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
- Undo puts back each photo's previous marks and albums through the same
  steps as section 6, so it takes about as long as the original command.
  For tag and album commands it also puts back the lists of tag and album
  names.
- If any photo in the step has gone missing, or one of its settings files
  has become unreadable, **the whole undo is refused**, nothing changes, and
  the step stays available to try again.
- Undoing the first mark ever made on a photo leaves its settings file in
  place with empty marks. The file is not deleted.

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
- **If the helper stops unexpectedly it is not restarted.** Every Library
  request then fails with "Library helper stopped unexpectedly." until the
  app is restarted. Grade is unaffected. Marks and tags can still be saved,
  because the backend does that.

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
- A pinned folder that is not connected is skipped and tried again on the
  next pass. Its existing entries are kept.
- Pinning or unpinning a folder, or changing the indexing setting, restarts
  the pass from the beginning.

The item at the right of the bottom bar reports the state:

| Bottom bar text | Meaning |
|---|---|
| Library index up to date | No pass is running. |
| Indexing <folder> · reading folders | Step 1 for that folder. |
| Indexing <folder> · 1,240 of 5,000 | Step 3; the count is photos whose details are known. |
| Indexing waits while Grade is busy | The helper is paused by grading, import or export. |
| Indexing paused | You paused it. It stays paused until you resume or choose Re-scan. |
| Background indexing is off | Turned off in the same menu. Folders are still read when opened. |

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
| "<photo>: marks are kept in the library because its settings file cannot be written. They will not travel with the photo." | The `.hdrf` file could not be written. The marks are safe in the database (pending). | Check that the folder can be written to and has free space, and that no sync or antivirus tool holds the file. Then change any mark on that photo; that is currently the only thing that tries again. |
| Details: "Kept in the library only; this folder cannot be written" | The photo is pending. **This is also shown when a bulk change was interrupted**, where the folder is in fact writable (section 11). | As above. |
| "Settings for <photo> cannot be read; they were left untouched." | The `.hdrf` file is not valid JSON, or could not be opened. | Open it in Notepad. Repair it, or rename it out of the way to start fresh. A command that includes this photo will stop until then. |
| "Settings for <photo> have an unsupported format; they were left untouched." | `format` or `schema_version` is not what this version expects, usually a file from a newer version. | Use the newer version, or rename the file out of the way. |
| "Settings for <photo> have no photo ID; they were left untouched." | `photo_id` is missing or empty. | Restore the file from a backup, or rename it out of the way. |
| "Settings for <photo> have unreadable albums; they were left untouched." | `albums` is not a list of valid names. | Fix or remove the `albums` entry in Notepad. |
| A technical message beginning "1 validation error for Marks" | A value inside `marks` is outside the allowed values, or `marks` has a field this version does not know. The message names the field but not the photo. The file is left untouched. | Find the photo by the field named, then fix that entry in Notepad. |
| "Settings for <photo> are a link; they were left untouched." | The `.hdrf` file is a link to another file. The app will not write through links. | Replace the link with a real file. |
| "N photos on folders that are not connected were not changed." | A tag or album command skipped photos it could not find. | Connect the drive and run the command again. |
| "A tag named <name> already exists." | A rename would join two tags. | Confirm the merge, or choose another name. |
| "That tag is no longer in the library." / "That album is no longer in the library." | The name was removed, or renamed, since the list was shown. | Reopen the list. |
| "Select a supported photo to mark." | A selected file is not a supported photo type. | Nothing was changed. |
| A Windows "file not found" message when marking | A selected photo was moved, deleted or is on a drive that is not connected. Marking a photo that cannot be found is not supported yet. | Nothing was changed. Re-scan the folder or reconnect the drive. |
| "Library helper stopped unexpectedly." | The helper process ended. | Restart the app. Check `logs\backend.log`. |
| "Library helper did not start in time." | The helper did not report ready within 30 seconds. | Restart the app. If it repeats, check `logs\backend.log`. |
| "Library helper queue is full." | More than 256 requests were waiting. | Normally clears on its own within seconds. |
| "Library cache entry is unavailable; request it again." | A cached picture was removed between two steps. | None; the page asks again. |
| "Photo changed while its library picture was being read." | The file was modified during decoding. | None; it is read again when next shown. |

---

## 11. Known gaps (October 11, 2026)

These are how the app behaves today. Section 12 is the agreed fix for the
first five.

1. **An interrupted bulk change is left half-written, silently.** If the app
   is closed or crashes during step 5 of section 6, the database has the
   change on every photo and the remaining settings files still hold the old
   marks. Inside the app everything looks complete. Nothing finishes the
   remaining files; each is only written when that photo's marks are next
   changed. Those photos would lose the change if the database were deleted.
2. **Those photos are mislabelled** as "this folder cannot be written".
3. **No progress and no cancel** for a large change. It cannot be undone
   until it has finished.
4. **A stray temporary file** (`.<photo name>.hdrf.<random>.tmp`) can be
   left beside a photo if the app is killed at the wrong instant. It is
   harmless and can be deleted; nothing cleans it up.
5. **A failed write is never retried** on its own, including after a
   read-only folder becomes writable or a drive is reconnected.
6. **Undo does not survive a restart**, and is refused as a whole if one
   photo is missing.
7. **An old tag name can linger** after a rename when some of its photos
   were not connected (section 6).
8. **Marks cannot be changed on a photo whose drive is not connected.** The
   PRD intends this to work.
9. **Indexing can stop for the rest of the session.** After five failures
   in a row to reach the helper, the indexer gives up and Re-scan does
   nothing until the app is restarted.
10. **Folders are not watched.** A change made outside the app is seen when
    the folder is next opened or re-scanned.
11. **A second settings file for one photo** (a sync conflict copy such as
    `DSC02339.ARW (1).hdrf`) is ignored, not detected.

---

## 12. Agreed design, not built yet: files catch up in the background

Agreed by Steve on October 11, 2026. Recorded here so the reasoning is kept
with the behaviour it will replace.

**The problem.** Section 6 makes every change wait for every file. That
gives gaps 1 to 5 above, and it makes an accidental bulk change (five stars
on 1,000 photos) impossible to stop.

**The design.** Split library work into two kinds.

*Mark changes* (ratings, picks, labels, tags, albums, renames):

- The database changes at once, as now, and the command returns
  immediately. The grid shows the result straight away.
- Each changed photo is flagged "file needs writing". This is the existing
  pending flag, used as a to-do list.
- A background writer works through the flagged photos. It always writes
  the photo's **current** marks, not the marks of a particular command.
- **Undo is the cancel.** Ctrl+Z reverts the database at once. Files not
  yet written are never written with the unwanted marks; files already
  written are put back by the same writer.
- Because the to-do list is in the database, it survives a crash or a hard
  shutdown. The writer carries on at the next start and says so in the
  bottom bar.

*File jobs* (moves, copies, exports, previews, indexing) take real time and
keep Pause and Cancel. Cancel stops between files, each photo is wholly in
one place, and Undo puts back the part that was done.

**Why this shape:**

- Writing "the current marks" is safe to repeat and safe to interrupt, in
  any order. No log of commands is needed, and there is nothing to replay
  in the right sequence after a crash.
- The database step is already all-or-nothing, so the Library is never
  half-changed, however the app stops.
- One mechanism covers interrupted changes, locked files, a full disk and
  an unplugged drive: the photo simply stays on the to-do list.

**The cost, accepted:** for a short time after a large change, the settings
files lag behind what the app shows. A folder copied to another computer, or
a drive pulled, during that time carries the older marks for some photos
until the drive is back and the writer finishes.

**Intended handling of unusual cases:**

| Case | Intended behaviour |
|---|---|
| Crash, hard shutdown, power loss | The writer resumes at the next start. Stray `.tmp` files are cleaned up. |
| File locked by another program | Tried again a few times, then listed under "Needs attention" and retried later. |
| Disk full | The writer pauses with one message, not one per photo. |
| Read-only folder | Stays in the library, labelled as such, and shown differently from "waiting to be written". |
| Drive unplugged or folder missing | Waits. Whether it is written automatically on return is PRD open decision 25. |
| Photo deleted or moved outside the app | Dropped from the to-do list and counted in the result. |
| Undo when some photos are gone | The rest are undone and the skipped count is reported. |
| Settings file changed by something else meanwhile | Needs a rule. Not decided. |
| Closing the app mid-write | Closes without a prompt and resumes at the next start. |

**Where progress will show (proposed, not yet confirmed):** one Activity
item at the right end of the bottom bar, where the indexing item is now. It
shows the most important job with a count; a click lists every job with
Pause or Cancel, and a "Needs attention" list for files that could not be
written.

**Still to decide:** whether Undo survives a restart; the Activity item;
open decision 25; the rule for a settings file changed by something else.

---

## 13. How to check things yourself

**Is a photo's change written beside it?** Select the photo and look at
Settings in the Details panel: "Beside the photo", "Kept in the library
only…" or "None yet". Or open the `.hdrf` file in Notepad and read `marks`.

**Clear one photo's marks completely.** Close the app, delete that photo's
`.hdrf` file, reopen the folder. This does not work while the photo is
pending (section 5); change a mark on it first so that the file is written.

**Rebuild the library database.**

1. Read "What is lost" in section 4 first.
2. Close the app completely.
3. In the app data folder, rename `library.sqlite3` (keep it as a backup
   until you are satisfied).
4. Start the app, open the Library and choose Re-scan pinned folders now.
5. Wait for "Library index up to date". Folders that are not pinned are
   rebuilt when you open them.

**Clear the browsing pictures.** Close the app and delete the
`library-pictures` folder.

**Find stray temporary files.** In Explorer, search the photo folder for
`*.hdrf.*.tmp`. With the app closed, any that are found can be deleted.

**The Library stops responding but Grade works.** The helper has probably
stopped. Restart the app, then read the end of `logs\backend.log`.

---

## 14. Code and checks

Paths are from `codebase/`.

| File | Owns |
|---|---|
| `backend/hdr_finisher/library_marks.py` | The database, settings files, mark, tag and album commands, undo |
| `backend/hdr_finisher/library_index.py` | File facts, background indexing, `library-preferences.json` |
| `backend/hdr_finisher/library_worker.py` | The helper process, its lanes, pausing and cancelling |
| `backend/hdr_finisher/library_folders.py` | Folder listing and the folder tree (run in the helper) |
| `backend/hdr_finisher/library_metadata.py` | Camera details (run in the helper) |
| `backend/hdr_finisher/library_pictures.py` | Browsing pictures and their cache |
| `backend/hdr_finisher/library_api.py` | The `/api/library/…` commands the page calls |
| `backend/hdr_finisher/media_browser.py` | Pinned folders (`pinned-folders.json`) |
| `frontend/photo-library.js` and `frontend/library-*.js` | The Library page |

Fast checks that pin the behaviour on this page:

- `tests/test_library_marks.py`: browsing writes nothing; a bulk change and
  its undo; rebuilding from settings files after the database is deleted;
  unknown fields survive; a failed write stays in the database across a
  restart; an unreadable file is never overwritten; a failed write leaves
  the old file and no temporary file.
- `tests/test_library_collections.py`: tag and album commands, photos that
  are not connected, albums in settings files, preferences outside the
  database, indexing an unvisited pinned folder.
- `tests/test_library_worker.py`: the helper's lanes, priorities, pausing,
  cancelling, failure and shutdown.
- `tests/test_library_pins.py`: unpinning a folder that is not connected.

**Keeping this page true:** update it in the same change as any edit to how
marks are saved, which copy wins, the settings-file fields, the database
tables, the helper's lanes or pausing, or any message in section 10. When
section 12 is built, move it into sections 6 and 7 and clear the matching
gaps from section 11.
