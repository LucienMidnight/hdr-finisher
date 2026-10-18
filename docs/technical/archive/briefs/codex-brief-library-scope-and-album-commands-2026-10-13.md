# Codex Brief — What the Library Contains, and Album Commands
## HDR Finisher

**Date:** October 13, 2026
**Branch:** `photo-library` only.
**Read first:** `AGENTS.md`, then `docs/technical/photo-library.md`
(sections 4, 5, 6 and 8) and PRD sections 5.2, 5.7 and 5.18.

## Goal

Today the Library's index holds every photo from every folder Steve has
ever pinned or opened. Unpinning a folder removes it from the left panel
but its photos stay in the index, so smart albums, search and tag counts
show photos from folders he can no longer see.

When this is done, one rule decides what the Library contains:

> **The library is every photo in a pinned folder, plus every photo in a
> manual album.**

Everything on the left panel is in the library; nothing else is. Part 2
adds three album commands Steve asked for.

Part 1 matters more. Do it first, in its own commits.

## Context

Read from the code by Claude on October 13. You have the code; where it
disagrees, the code wins and you say so.

- The `files` table gains rows whenever a folder is visited or indexed,
  pinned or not. Nothing removes them when a folder is unpinned.
- Unpinning only edits `pinned-folders.json`.
- Smart-album candidates are read from the whole `files` table.
- Manual album membership lives in `album_photos` and in each photo's
  `.hdrf` file, independent of pins.
- The smart-album editor's "Look in" list adds any saved folder that is no
  longer pinned as an extra tick box.
- The background index and the timed folder checks only walk pinned
  folders and the folder on screen.
- A database rebuild only rescans pinned folders.

## Part 1 — what the library contains

Decided by Steve, October 13.

| Situation | What should be true |
|---|---|
| Photo is under any pinned folder | In the library: search, tag counts, smart albums, everything. |
| Photo is in at least one manual album, folder not pinned | Still a full library member. Shows in search, tag counts and smart albums; can be viewed, graded and exported as normal. Steve calls these "kept" photos. |
| Photo has a rating, tag, grade or smart-album match only, folder not pinned | Not in the library. Only a manual album keeps a photo. |
| Folder is unpinned | Its photos leave the library at once, except those kept by an album. The index is really cleaned, not just hidden. |
| A photo is taken out of its last album, or that album is deleted, and its folder is not pinned | It leaves the library. Undo brings it back. |
| A photo is under two pins (a folder and its parent) and one is unpinned | It stays, because it is still under a pin. |
| A pinned folder's drive is unplugged | Unchanged from today: entries kept, shown as not connected. |
| A folder is opened without pinning | Shown while it is open. It is not part of search, tag counts or smart albums, and nothing from it lingers in the library afterwards except photos added to an album. (Claude's proposal; Steve has not confirmed. Build it this way and list it in the report.) |
| Virtual copies | Follow their original. |
| Projects shown on the left, if built | Count the same as pinned folders. |

**Nothing is ever deleted from disk, and no `.hdrf` file is changed by
unpinning.** Marks, grades and album names stay beside the photos.
Re-pinning the folder brings everything back.

**Work that is not yet written must survive.** If a photo leaving the
library has marks, album changes, a grade, recovery work or a retained
previous grade that exists only in the database, that work is written
beside the photo first, or kept until it can be (for example an unplugged
drive). Leaving the library must never be the reason something is lost.

**Kept photos stay current.** They are no longer inside a folder that is
checked on a timer, so the app must still notice when one is moved,
deleted, changed, or has its settings file changed elsewhere, at a cost
that stays small with a few thousand kept photos. A kept photo on an
unplugged drive shows as not connected, as album photos do today.

**Kept photos survive a database rebuild.** After `library.sqlite3` is
deleted and the pinned folders are rescanned, albums come back complete,
including photos outside every pinned folder, without Steve opening those
folders by hand. Personal settings already live outside the database for
this reason; a list of kept photos may be stored the same way.

**Smart albums:**

- They match library photos only.
- "Look in" with every folder ticked means the whole library, kept photos
  included. With only some folders ticked, kept photos outside those
  folders do not match.
- A rule that points at a folder no longer pinned keeps that rule. In the
  editor the folder is shown as not pinned, and it matches nothing until
  the folder is pinned again.

**Messages** (Claude's proposed wording; adjust to fit, and list the final
text in the report):

| Moment | Message |
|---|---|
| Unpinning | "Stop showing <folder>? 1,240 photos leave the library. 36 stay because they are in albums. Nothing is deleted from disk." If none are kept, leave that sentence out. |
| Removing photos from their last album, folder not pinned | The existing removal message, plus "N are no longer in the library; their folder is not pinned." |
| Deleting an album | The existing dialog, plus how many photos will leave the library, when any will. |
| New Album dialog | One short line saying that photos in an album stay in the library even if their folder is unpinned. |

Never use "delete" or "remove photos" for unpinning.

The Details panel should make it clear when a photo is in the library only
because of an album, for example beside the albums it lists.

**Existing data:** the app is pre-1.0. No migration code. Rows already in
the index for unpinned folders are simply cleaned out by the new rule the
first time it runs. Pending work on such rows is covered by "must survive"
above.

## Part 2 — album commands

Decided by Steve, October 13. All on the right-click menu of the album in
the left panel, and each is one undo step.

| Command | On | What it does |
|---|---|---|
| Edit rules and name… | Smart album | Already in the code. Confirm it appears and works by right-click and by keyboard; fix it if not. |
| Save as manual album… | Smart album | Makes a new manual album holding the photos that match right now, including not-connected ones. The smart album stays and keeps updating. |
| Duplicate | Manual album | A new manual album with the same photos. |
| Duplicate | Smart album | A new smart album with the same rules and "Look in" choices. |

**Naming:** the new album is offered as "Copy of <name>", then
"Copy of <name> (2)" and so on if that is taken. The name is shown in an
editable box before the album is made, so Steve can change it. A manual
album made from a smart album follows the same rule.

Making a manual album writes its name beside every photo, as today. For a
few thousand photos that goes through the existing background writer; the
album is usable at once.

## Constraints

- The settings file beside a photo remains the lasting record, and the
  rules in `photo-library.md` section 5 (which copy wins) and section 6
  (how a change is saved) are unchanged.
- No change to Grade, CPU export, Proof, any pinned shader, tolerance,
  limit or budget.
- The backend remains the only writer of the database and settings files.
- Unpinning a folder whose drive is unplugged must still work.
- Browsing, the folder on screen and Grade keep priority over any new
  background work.
- Never write to Steve's photo folders or the read-only test projects.
- Update `docs/technical/photo-library.md` and PRD sections 5.2 and 5.7 in
  the same change, including any new file in the app data folder.

## Testing

Follow `AGENTS.md`: fast checks, plus the focused Library checks that
cover pins, collections, smart albums and the settings writer, once per
part. Add fast checks, on disposable photos, for at least:

- unpinning empties search and smart albums of that folder's photos and
  keeps album photos;
- a kept photo leaves when it leaves its last album, and Undo restores it;
- pending marks and an unwritten grade on an unpinned, unplugged folder
  survive and are written on reconnection;
- a database rebuild restores kept photos to their albums;
- overlapping pins;
- Save as manual album and both Duplicates, including the naming rule and
  Undo.

No full sweep, installer or push.

## Report to Steve

Plain language: what the library now contains; the final wording of every
new message; how kept photos are kept current and what that costs; the
"open without pinning" behaviour for him to confirm; whether right-click
Edit on a smart album was already working; what to try in the app
(unpin a folder that has a few album photos, then search for them).

Small local commits, Part 1 separate from Part 2. Ask before pushing.

## Questions protocol

If anything here conflicts with the code, or an outcome cannot be met
without touching a constrained area, stop that part, report the options
with their trade-offs, and carry on with the rest.
