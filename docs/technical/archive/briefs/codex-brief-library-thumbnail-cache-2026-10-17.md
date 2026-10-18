# Codex Brief — Library thumbnails: one HDR file each, a managed disk cache, no waiting in line

## HDR Finisher

**Date:** October 17, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first and follow its testing rules. Do not overlap GPU
checks. Commit in small steps. Ask before pushing.

## Why

Steve sees too much activity when he scrolls a Library folder. Thumbnails
are blank first, then appear one by one, even in folders he has already
browsed. Claude measured this on October 17. Two small causes are already
fixed (`63b72c4`, `ef4326c`). The big one is still there.

**What happens today (measured):**

- The disk cache (`library-pictures`, a fixed 2 GB limit in
  `library_pictures.py`) stores each photo as 16-bit scene-linear pixels.
  This is one picture shared by SDR and HDR. It is used: nearly every
  revisit is a cache hit.
- Each time a thumbnail scrolls into view, a new cell is created. The cell
  asks the backend for the picture, fetches the pixels and draws them on the
  GPU. Nothing drawn is kept once the cell leaves the screen.
- Thumbnails are drawn strictly one at a time (`library-gpu.js` `show()`
  queue, which waits for submitted GPU work after each draw). Backend
  answers also queue.

Timings from Steve's own `backend.log`, about 5,000 thumbnails, median (p90):

| Step | Time |
|---|---|
| Pixel fetch from the cache | 12 ms (25 ms) |
| GPU draw | 18 ms (34 ms) |
| Waiting for the backend to answer | 160 ms (680 ms) |
| Waiting for a turn on the draw queue | 470 ms (1.5 s) |
| Request to visible | 720 ms (2 s) |

So making a thumbnail is cheap. Nearly all the delay is queueing, plus the
fact that finished thumbnails are thrown away.

## What Steve wants

**This replaces an older decision.** On October 10 the Library PRD settled
"live HDR switch from quick scene pictures; no stored gain-map previews"
(open decision 13, and section 5.9). On October 17 Steve chose gain-map
files for grid and filmstrip thumbnails. That replaces the October 10
decision for thumbnails only. Full-size Single and full-screen pictures stay
scene-linear, drawn by the GPU, as decided on October 14. The main PRD,
section 11g, records this.

### 1. One compressed HDR file per thumbnail

Store each grid and filmstrip thumbnail as a **single gain-map image**
(Ultra HDR JPEG, or AVIF with a gain map). Pick whichever displays and
encodes better here, and say why. One file serves both SDR and HDR. The HDR
button should only change how that one file is shown, not fetch or make
another.

- The thumbnail shows the same look as the current grid thumbnail: the
  starting look, or the saved grade once its kept picture exists. When the
  look, grade or source file changes, the thumbnail is remade.
- It must appear in HDR on an HDR display with the HDR button on, and in
  SDR otherwise. Check that the Electron build actually shows the gain map
  in HDR in the grid. If it can't, stop and report before building the rest.
- Size: large enough for the biggest grid cell at the display's pixel
  density (the Thumbnail size slider goes up to 360), and no larger.
- Exposure and focus overlay maps stay as they are. They are separate data.
- Single view, Compare and 100% keep their current GPU path from the
  scene-linear picture. This brief is only about grid and filmstrip
  thumbnails.
- The export Ultra HDR and AVIF encoders already exist in `exporters.py`. You
  may reuse them. **You must not change export output or Proof.** If
  sharing code would touch the export path, copy what you need or stop and
  ask. The existing Ultra HDR path starts an external tool for each image,
  which may be too slow for thumbnails. Measure it, and use the fastest
  method that gives correct gain-map files.

### 2. A managed disk cache folder, with settings

- **Location.** Steve asked for the folder where the app is installed, so
  that cloud services don't interfere with it. The app is installed in
  `C:\Program Files\HDR Finisher`, which a normal user can't write to.
  **Default:** `%LOCALAPPDATA%\HDR Finisher\Cache`. That's local and
  machine-only: OneDrive and similar services don't sync it, unlike
  Documents, and unlike `%APPDATA%` (Roaming), where today's caches live.
  Settings lets the user pick any folder, for example on another drive.
  When an installed copy can write to its own folder (a portable or per-user
  install), offer that as a choice. Never require admin rights.
- **One folder, separate allowances.** Put the Library's caches under this
  folder: the new thumbnails, the scene-linear pictures (`library-pictures`,
  `library-full-pictures`), RAW thumbnails, and saved-grade (kept) pictures.
  Keep the separate allowances Steve decided on October 14 (Library PRD
  5.9): a full-size picture must never push out a thumbnail, and saved-grade
  pictures keep their own allowance because each one costs a full Grade
  render to remake. Within each allowance, evict the least recently used
  files first. If a cache shouldn't move, say why.
- **Settings** (on the Performance page, unless you find a better home; ask
  if so):
  - Thumbnail cache: on or off, using the app's toggle switch labelled
    Enabled or Disabled.
  - Size limits, with a few clear choices (for example 1, 2, 5, 10 or
    20 GB), showing how much is used now. Offer one control per allowance
    (thumbnails; full-size pictures, whose decided default is 10 GB;
    saved-grade pictures), or one total split by fixed shares if that is
    simpler to understand. Propose which in your plan.
  - Location, with Change… and Show in Explorer buttons.
  - Clear cache, with a confirmation that says how much will be freed.
- **Off** means nothing new is written, and thumbnails are made fresh as
  they are needed. Already-cached files may still be read until cleared.
  Say how you handle that.
- **Changing the location** starts an empty cache there and leaves the old
  folder alone. Offer to delete the old one; never delete it silently.
- This is before 1.0, so there's no migration. The old caches under
  `%APPDATA%\hdr-finisher-desktop` can be left or cleared on first start.
  Say in one line which you chose.

### 3. No waiting in line

- Ask for all visible thumbnails together, not one request at a time.
- Show cached thumbnails without a GPU draw per thumbnail. Decoding should
  happen in parallel and off the main thread.
- Load about a screen ahead in the direction of scrolling.
- Keep recently shown thumbnails ready, so scrolling back shows them at
  once. Grid cells can be reused; the picture should not be rebuilt.
- Making new thumbnails (cache misses) must not block cached ones from
  showing.

## Tolerances (agree in your plan, then work within them)

Proposed below; change them in your plan with a reason if needed.

- **Cached folder:** with a cache that's already warm, at 2560×1440 and the
  Thumbnail size at 360, 90% of thumbnails are visible within 100 ms of
  their cell appearing, and none take longer than 300 ms.
- **First visit:** no worse than today: median about 0.4 s, p90 about 3.4 s
  in Claude's run.
- **Look:** a cached thumbnail matches what the current grid draws for the
  same photo and mode. In SDR, the average colour difference is within
  ΔE2000 1.0 and the 99th percentile within 3.0. In HDR, the peak and
  reference white agree within 2%.
- **Memory:** state what the "keep recent thumbnails" pool uses at its
  limit, and keep it at or under 256 MB unless you give a reason.

## Measuring

Claude's scroll measurement is at `codebase/output/library-scroll-diag.js`.
It's a local file in the ignored `output/` folder, so copy it before
`output/` is cleaned. It runs through `tests/run-in-electron.js`, scrolls
`D:\Photos\HDR Test Images` three times, and prints, for each pass, how many
cells were created, double draws, blank time and routes. Turn it into a real
driver under `tests/` that asserts the tolerances above, and add it to
`tests/release/drivers.json`. Leave Steve's photo folders unchanged. The
runner already uses a throwaway profile.

Before/after for each pass on the current code, to compare against (blank
time median / p90):

| Pass | Before the two small fixes | After them (now) |
|---|---|---|
| 1, first visit | 2.1 s / 6.0 s | 0.4 s / 3.4 s |
| 2, revisit | 0.8 s / 2.0 s | 0.2 s / 0.6 s |
| 3, revisit | 1.4 s / 2.0 s | 0.4 s / 2.4 s |

Revisit timings vary a lot from run to run. Judge against the tolerances,
not one run.

## Testing

Follow `AGENTS.md`. Fast checks after each change. GPU checks:
`tests/photo-library-stage-c.js` (loading, HDR toggle, native zoom), the new
scroll driver, and `tests/library-kept-pictures.js` if saved-grade
thumbnails change. The stage-c check currently asserts that the HDR toggle
makes no new picture request; that must stay true.

Export and Proof must not change. If any change touches them, run their
strict checks and tell Steve first.

## Report back

One short line for each part: what changed, what you ran, the measured
numbers against the tolerances, and anything Steve needs to decide (format
choice, cache location behaviour, which caches moved).
