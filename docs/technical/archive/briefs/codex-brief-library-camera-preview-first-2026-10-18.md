# Codex Brief: Camera preview first for RAW thumbnails, and save the real thumbnail from the picture already made
## HDR Finisher

**Date:** October 18, 2026
**Branch:** continue on `film-look-rebuild` from its current tip (`9985891` or later).
**Read first:** `ai/AGENTS.md`, then `docs/technical/library-speed-architecture.md`
(section 3.1 "Picture tiers" and section 6, decision 1).

---

## Goal

When Steve opens a folder of camera RAWs, the grid and filmstrip should fill
about as fast as Windows Explorer does. Explorer shows the camera's built-in
JPEG preview. We agreed to do the same on October 12 ("tier 0"), and it was
never built for camera RAWs. After the camera preview, the real thumbnail
(the starting look, or the saved grade) replaces it in place. Once a photo's
real thumbnail has been made, it is saved in the Library cache on C: and
reused on every later launch, so the camera preview is only ever seen the
first time a photo is shown.

---

## What Steve sees today

- Thumbnails in a folder he has browsed before still load slowly, and more
  slowly than Explorer. Steve says this is not acceptable.
- Folder: `D:\Photos\2026\20261017 badminton`, 372 Sony ARW files, about
  82 MB each, on a 7200 rpm USB HDD (D:). The Library cache is at
  `%LOCALAPPDATA%\HDR Finisher\Cache` on a fast NVMe SSD (C:).

## What Claude found (measured from Steve's `backend.log` and cache folder)

Confident:

1. **Cache misses on every launch (fixed in `9985891`).** Grid thumbnails
   were cached under the exact cell width, which changes with window size
   and photo count. Steve's cache held the same photos at 360, 370, 391,
   444, 457 and 520 px, so most launches found nothing. `9985891` stores one
   640 px thumbnail per photo and lets the grid scale it. Steve wants one
   stored size, scaled up and down, not one per window size. That commit
   also orphaned every existing cached thumbnail, so Steve's test of it
   started from an empty cache.
2. **No tier 0 for camera RAWs.** On a cache miss, a camera RAW picture
   request always goes to the full RAW reader (`library_raw.py`,
   `RawBrowsing`). That reader reads the whole 82 MB file one photo at a
   time, then decodes it at screen size. In the launch at 12:01 today it
   made 192 such pictures at about 1.1 per second (read median 480 ms, p90
   1.3 s; decode about 280 ms). The visible unedited thumbnails took a
   median of 0.35 s to appear, a p90 of 14.7 s and up to 28 s. The
   embedded-preview route (`embedded_picture`, quality `fast`) exists, but
   the page uses it only for DNG, HEIC and TIFF, and the backend ignores
   `quality` for camera RAWs.
3. **The cached thumbnail is made a second time on the CPU.** After a scene
   picture is shown, the page asks a single low-priority background job to
   build the cached gain-map thumbnail. That job decodes the photo again
   and renders it with the CPU numerical renderer
   (`library_thumbnails.build`). Today it saved only 65 thumbnails while
   192 pictures were decoded for display. The picture already on screen is
   not what gets saved.

Less sure (check before relying on it): the camera preview read via
`rawpy.extract_thumb` should read only a small part of each file. Measure
it on the USB HDD from a cold start. The architecture doc measured 17 to
170 ms.

---

## Outcome

| Situation | What Steve sees |
| --- | --- |
| A photo never shown before | Camera preview within about 0.2 s, then the real thumbnail replaces it in the same cell |
| A photo whose real thumbnail is cached | The real thumbnail straight away, with no camera preview first (keep the behaviour from `ef4326c`) |
| App relaunch, window resized, thumbnail slider moved | Cached thumbnails still hit. One stored size per photo, scaled to the cell |
| Edited photo | Saved-grade thumbnail as today. The camera preview is fine as a placeholder only until the saved-grade or real thumbnail is ready |
| Single view | Unchanged: shows the grid picture enlarged, then the display-size picture |

- The real thumbnail saved to the cache should come from the picture the
  Library has already made for display (the GPU scene picture). Do not
  decode the RAW again or re-render on the CPU just to fill the cache. If
  that is impossible for a reason you can explain, say why and propose the
  cheapest alternative.
- Visible photos come first, then look-ahead. Filling the cache must never
  hold up a visible cell.
- Making real thumbnails for a whole folder in the background after the
  visible ones is welcome, provided it gives way to visible work, Grade and
  export (as the existing background worker already does).
- The swap from camera preview to real thumbnail is visible, and Steve has
  accepted that (decision 1). Build it so that the transition can later be
  changed to a blur-then-wipe without reworking the tiers.

## Targets (proposed tolerance; record any change in the PRD)

Taken from `library-speed-architecture.md`, section 4 row 4 ("Fresh folder"):

- Fresh folder, Steve's badminton folder, Thumbnail size at its default:
  every visible cell shows a picture (camera preview or real) within 1 s of
  the folder opening, p90.
- Real thumbnails for the visible cells: about 2 s, p90.
- Second launch with nothing changed: 90% of visible thumbnails within
  100 ms (the existing thumbnail-cache target).
- Run-to-run noise on a USB HDD is large, so judge against these limits,
  not against one earlier run.

---

## Constraints

- **Export and Proof must not change.** Do not touch the export renderer,
  encoders or Proof. If you need encoder code for thumbnails, copy it or
  stop and ask (the same rule as the thumbnail-cache brief).
- Keep one stored thumbnail size per photo (Steve, October 18). If 640 px is
  wrong for the largest cell at the slider maximum, propose a size with a
  one-line reason. Do not reintroduce a size per window width.
- Single, Compare and 100% keep their current paths.
- Cache stays in the managed Library cache folder on C:. A full-size
  picture must never push out a thumbnail.
- Pre-1.0: no migration code for old cache entries. Orphaned files can be
  left for the cache trim to remove.
- Keep each file's existing line endings (see AGENTS.md).

## Testing (AGENTS.md "How much to test", plus Steve today: keep checks short)

- Fast checks: `node --test tests/*.test.js` and
  `.venv/Scripts/python.exe -m pytest tests -q`.
- Then the one or two GPU drivers that cover Library thumbnails
  (`tests/library-thumbnail-scroll.js`, and `tests/photo-library-stage-c.js`
  if you change first paint). Run them one at a time with
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.
- Add a result-based test showing that a camera RAW cache miss returns the
  camera preview without a full RAW read, and that a later request after
  the real thumbnail is saved returns the cached real thumbnail.
- Measure the targets above from `backend.log` (`page_picture_shown`,
  `raw_browse_ready` and the thumbnail events) on Steve's folder. It is
  read-only, so do not write into it.
- Add any new driver to `codebase/tests/release/drivers.json`.
- If validation looks like it will take more than about 30 minutes, stop
  and ask.

## Questions protocol

If this brief conflicts with the code, for example because tier 0 already
exists somewhere Claude missed, or the scene picture cannot be turned into
the cached gain-map file, stop and report before building around it. Commit
in small local commits with one short note each. Ask before pushing.
