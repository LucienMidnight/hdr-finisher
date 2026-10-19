# Module PRD: Photo Library

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** backend `library_*.py` (helper, index, sidecars, thumbnails,
  pictures, kept pictures, paste, picture queue, file commands); frontend
  `photo-library.js`, `library-*.js`, `grade-paste.js`; mock-ups in
  `../library-wireframes/`.
- **How it works inside:** [photo-library.md](../../technical/photo-library.md),
  [library speed architecture](../../technical/library-speed-architecture.md).

## 1. Purpose

A place to browse, cull, rate, compare, organise, grade in bulk and
batch-export photos without leaving the app. The reference is DxO
PhotoLab's PhotoLibrary (folder-first browsing and quick compare), with
far less on screen.

## 2. Principles (decided October 9, 2026)

1. **No import step.** Folders are browsed where they are. Pinning a folder
   makes it part of the Library.
2. **The grade lives next to the photo** in a sidecar. The database is an
   index that can be rebuilt.
3. **Browsing never changes a grade and never prompts.** Grades change only
   in Grade, or through an explicit command that says how many photos it
   will change.
4. **Single click navigates. Double-click opens in Grade.**
5. **Minimal and keyboard first.**
6. **Generic, not tuned to one camera.**
7. **Background work stays out of the way** of grading and export.
8. **Nothing is silently lost or overwritten.**
9. **Built in slices that are each useful alone.**
10. **Thumbnails appear about as fast as Windows Explorer** (Steve,
    October 18).

## 3. Decisions in force

The detailed record of the October 9 to 14 decisions is in the archived
Library PRD, section 4. These later decisions replace older ones:

| Decision | Date |
| --- | --- |
| Grid and filmstrip thumbnails are one gain-map file each (Ultra HDR JPEG), in a managed disk cache. Full-size Single and full-screen pictures stay scene-linear, drawn by the GPU. | Steve, 2026-10-17 |
| One cache folder, default `%LOCALAPPDATA%\HDR Finisher\Cache` (on C:), with a folder chooser, on/off, size controls and Clear. Thumbnails, full-size pictures and saved-grade pictures have separate allowances. | Steve, 2026-10-17 |
| **One stored thumbnail size per photo, scaled to the cell.** No size per window width. | Steve, 2026-10-18 |
| **Picture tiers:** tier 0 is the camera's embedded preview (under 0.2 s), replaced in place by the real thumbnail. The visible swap is accepted; a blur-then-wipe is the fallback if it bothers Steve. | Steve, 2026-10-12 |
| The real thumbnail saved to the cache comes from the GPU picture already made for display. It is not decoded and rendered again on the CPU. | Steve, 2026-10-18 |
| The Export page stays and grows; Quick export… runs a preset on a selection. | Steve, 2026-10-11 |
| Exposure pastes as a plain number, including RAW; starting Exposure is zero. | Steve, 2026-10-11 |
| No photo-count size target as a product idea; tested on a large library internally. | Steve, 2026-10-11 |
| Dragging photos onto a folder asks first, for now. | Steve, 2026-10-11 |
| `.hdrfinisher` projects stay out of the Library. | 2026-10-11 |
| Pause of saved-grade picture work lasts one app session. | 2026-10-18 |
| **Library pictures: speed first, accuracy "close enough to enjoy".** Thumbnails must be very fast and give a good SDR and HDR preview for culling and group grading. Larger pictures must look close enough to the export to enjoy full screen, with no noticeably wrong colour or tone; they need not be precise. Judged by eye. Export and Proof keep their strict limits. | Steve, 2026-10-18 |
| **Prove GPU development first.** Before building the rest of the speed plan, Claude (not Codex) prototypes full-quality RAW development on the GPU to show whether it is fast enough. | Steve, 2026-10-18 |
| **Recent thumbnail pool: fixed 512 MB**, sized for an 8 GB machine; not scaled with RAM. Finished grid and filmstrip cells stay built for one screen beyond each edge. | Steve, 2026-10-18 |

**Paste rules (built):** values measured from one photo are never pasted
(measured highlight peak, matched lens profile, file interpretation,
reference white, overlay view settings). Lens on/off switches do paste.
Exposure copies its literal HDR/SDR number; no source-start or target-start
delta is added, including offline and virtual photos.
Settings that don't apply to a file type are skipped and reported. Paste
always confirms, saves at once whatever the autosave setting, keeps each
photo's previous grade as its before state, and is one Undo step. Masks,
local adjustments, crop and lens corrections are unticked by default.

## 4. Current state (October 18, 2026)

RAW zero-start validation at `a2263fe`: fullscreen RAW browsing passed.
Thumbnail colour measurements passed, but that driver's settings checkbox
timed out; the saved-picture refresh driver failed reading an undefined
response field. These UI failures remain recorded without unrelated repairs.
Steve subsequently approved Grade's decoder/full-source measurements for
unedited RAW grid/filmstrip thumbnails and their kept pictures. The camera
preview still shows first. Single/fullscreen retain the quick RAW/GPU route
for the speed exploration; saved-grade pictures already use Grade's decoder.
Five badminton photos measured cold visible median 4.64 s / p90 4.78 s,
versus quick-route 0.55 s / 2.54 s (added 4.09 s / 2.25 s). Camera preview
median 34 ms; kept by 4.86 s / 4.93 s. Application caches were empty; Windows'
file cache was not flushed. No speed optimization was attempted.
All 16 RAW comparison sources now pass SDR/HDR Grade agreement before
thumbnail JPEG compression. The unchanged kept JPEG transport passes 7/16
SDR and 14/16 HDR; compression agreement remains open, separately from the
resolved source decoder mismatch. See Import and RAW for the limits/results.
Follow-up checks: 534 Node / 2291 Python passed (3 skipped), plus the
five-photo Electron route/render/keep measurement. Kept JPEG agreement still
fails as recorded above; export, Proof and their limits were not changed.

**Built**

- Slices 0 to 6 including 2b: docked and pop-out Library, culling marks,
  tags and colour labels, albums and smart albums, filter rules, sorting
  remembered per source, background indexing, folder checks, grades in
  sidecars with autosave, reverts, before state and virtual copies, quick
  decode, compare, focus and exposure overlays, zoom, file and folder
  commands, delete all rejected.
- Full-screen browsing speed (October 14): GPU RAW route, disk reader.
- Live HDR/SDR switch.
- Thumbnail cache: gain-map thumbnails, managed folder and settings, batched
  requests, recent pool, read-ahead. One 640 px size per photo (October 18).
- Scrolling back (October 18): finished cells within one screen of the edge
  are kept, so they reappear at once. Further back, the 512 MB recent pool
  answers without a backend request. A held 640 px thumbnail measured about
  1.2 MB (4.6 bytes per pixel, mostly the encoded file); the pool counts
  6 bytes per pixel, so it holds about 300 thumbnails. Cells still loading,
  or showing the GPU-drawn first picture, are not kept.
- Camera previews first for camera RAWs, then GPU-finished thumbnails
  written to the cache (`6bda55c`, October 18). One real RAW showed its
  camera preview in 60 ms, and its cached thumbnail after a relaunch in
  24 ms.
- Copy and paste of grades (Ctrl+C, Ctrl+V, Ctrl+Shift+V with the tick
  list). Pictures for grades changed in bulk go through a durable queue
  with Pause/Resume in Activity, resume on launch, visible photos first.
  Paste is usable as soon as something is ticked (October 18): the check
  that counts changed photos runs alongside, and photos not yet prepared
  are prepared after confirming, with "Preparing 3 of 12 photos for
  paste…" in the status bar. A RAW grid thumbnail now runs Grade's own
  import and keeps the starting grade it produced, so paste does not
  develop that photo again. Each photo is developed at most once even
  when the check and the paste ask together.
- Batch export pages and states (see Export and Proof).
- Saved-grade pictures now use the shared hidden GPU delivery renderer,
  including locals, Denoise and resize; CPU fallback records its reason.
  The existing disk picture cache remains and refreshes old CPU entries.

**Known problems**

- **Thumbnail files are large: about 830 KB each** at 640 px (JPEG
  quality 100, no chroma subsampling, full-size RGB gain map;
  `library_thumbnail_codec.py`). The 2 GB thumbnail allowance holds only
  about 2,400 photos, and each file read and held in memory costs more
  than it needs to. Shrinking them changes pixels, so it needs the
  perceptual check against the current files.

- **Thumbnails for a whole folder are still too slow.** On the badminton
  folder (372 Sony RAWs on a USB HDD), first pictures measured 3.66 s
  p90 against a 1 s target. Real thumbnails and filling the cache are
  still too slow. See [known limitations](../../known-limitations.md),
  "Library thumbnail cache qualification".
- **Saved-grade pictures take about 16 s each, not about 1 s** (badminton
  RAWs, October 18, GPU route). The stages are: about 8 to 10 s reopening
  and developing the full 42 MP RAW on the CPU (2.5 s decode, 3.1 s lens
  correction, the rest colour and analysis); 4 to 7 s GPU work, mostly
  Denoise preparation and transport (the creative render itself is about
  0.8 s); and 2 to 5 s for the Ultra HDR encode.
  - Two saved-grade pictures are now made at once (two helper lanes, two
    queue items in flight), so one photo's CPU development overlaps the
    previous photo's GPU work and encode. Not yet measured on Steve's photos.
  - **Tried and rejected (Claude, October 18):** decoding the RAW at half
    size (2x2 binning) for Library pictures. It cut source preparation from
    7.6 s to 2.5 s, but the finished picture failed the perceptual limits
    against a full-size decode on DSC07216 (HDR ΔE ITP mean 2.37 / p99.9 80;
    SDR ΔE 2000 mean 0.67 / p99.9 19), concentrated in bright highlights.
    Codex's earlier half-size and in-process-encoder trials were also
    removed before they qualified.
- **Opening a folder** ("Reading folder…") took about 3.4 s for the
  372-photo badminton folder, after a 25 ms folder read. Each visit rewrote
  every photo's virtual-copy state, one database write at a time, and
  re-read settings files several times. Fixed October 18 (`58c0324`):
  about 0.6 s, with identical listings and database contents. The remaining
  time is mostly the membership reconcile (about 0.2 s, run twice) and the
  index update (0.1 s).
- Library pictures compete with batch export for the GPU and the CPU. The
  October 18 fairness changes in Export and Proof stop them from forcing
  export onto the CPU.
- Camera RAW grid/filmstrip thumbnails start at Exposure 0 with Grade's state,
  the approved −0.8 EV calibration and documented file brightness. Its
  grid/filmstrip thumbnail decode now uses Grade and full-source measurements.
  Single/fullscreen quick decoding remains deferred to the speed exploration;
  final visual review remains open (Import and RAW).
  Non-RAW starts are unchanged. Unedited and saved-grade cache versions
  invalidate pictures from the previous RAW start.

## 5. Open work, in order

1. **Library speed plan** (Claude, October 18, from the speed exploration:
   [findings](../../technical/archive/library-speed-exploration-findings-2026-10-18.md)).
   Targets unchanged: every visible cell shows a picture within 1 s p90;
   real pictures about 2 s p90; a second launch shows 90% of visible
   thumbnails within 100 ms; a changed photo on screen shows its new grade
   in about 1 s when idle.

   What the exploration showed: a correct RAW picture costs 5 to 10 s of
   CPU development (42 MP: decode 2.6 s, colour-range handling 1.1 s,
   full-source measurements 0.9 s, reduction 0.4 s); the GPU draw is about
   60 ms. Saved-grade pictures take 17.5 s median. The same RAW is
   developed separately for the grid, Single, Grade and saved pictures.
   Thumbnail files fail the Grade agreement limits on 11 of 32 lanes even at
   JPEG quality 100 (8-bit gain-map precision and gamut clipping). The
   camera preview floor off the USB drive is 54 ms median / 79 ms p90.

   Design:
   - **Develop once, draw live.** Each photo is developed once with Grade's
     full-quality development and measurements into a stored scene version:
     640 px for every photo the grid has shown, and 2560 px for photos
     opened in Single, full-screen or given a grade, within a bounded disk
     allowance (this absorbs "full-size pictures on disk" from Leftovers).
     Every Library picture, unedited, pasted or saved grade, is drawn on
     the GPU from that version with Grade's own shaders, the way Grade's
     Fit view works. Recently drawn pictures stay in the memory pool.
     Finished-picture files are no longer made for display. A pasted grade
     needs only a redraw, not a new development. *Pending Steve's decision;
     it replaces the October 17 gain-map thumbnail decision and the October
     18 "save the displayed GPU picture" decision.*
   - **Development on the GPU, same maths, CPU fallback.** Step (a):
     camera colour, colour-range handling, measurements and reduction.
     Step (b): highlight repair and the AHD demosaic, ported from the
     bundled LibRaw. Estimated 0.6 to 2.8 s per cold 42 MP RAW instead of
     5 to 10 s; to be proven by a prototype first.
   - **One scheduler** for Library work: one ranked queue with ageing,
     duplicate requests merged by source identity, a cap on simultaneous
     full developments (about 485 MB each at 42 MP), and the shared GPU
     queue for draws. Order: Grade, the selected photo, visible cells,
     visible pasted or saved grades, read-ahead, background pictures,
     indexing.
   - **Camera preview first** stays.
   - **Single and full-screen** keep the quick decoder until GPU
     development is fast, then move to the shared developed version so
     they match Grade.

   Steve, October 18: accuracy matters less than speed in the Library (see
   Decisions), so "draw live" is no longer needed for accuracy; whether to
   draw live or keep picture files is decided after the GPU prototype. The
   prototype comes first.

   Phases:
   P. GPU development prototype (Claude): does full-quality development of
      a 42 MP RAW on the GPU come in well under the current 5 to 10 s?
      **Answered yes (October 18–19).** The prototype
      (`codebase/tools/gpu_raw_prototype`) ports highlight repair, LibRaw's
      AHD demosaic, colour, measurements and reduction to WebGPU. On 14 Bayer
      RAWs from five makes, finished pictures match Grade's CPU development
      far inside the agreed limits (SDR ΔE 2000 mean ≤ 0.006; HDR ΔE ITP
      mean ≤ 0.018, p99.9 ≤ 2.8 at 2560 px) and all six measurements match.
      GPU development: 0.10 to 0.20 s per photo, against 2.0 to 5.6 s.
      **Grid thumbnails on branch `gpu-raw-library` (not merged):** camera
      RAW grid and filmstrip thumbnails develop on the GPU in the Library
      window (`frontend/library-gpu-raw.js`, `library_gpu_raw.py`), with
      Grade's automatic Lensfun correction (vignetting gain, then exact
      full-size distortion and colour-fringe coordinates on a 16-pixel
      grid) before measuring, and store the result where Grade's CPU
      development would. X-Trans, DNG and anything else keep the CPU route,
      as does any GPU failure. In the app a cold thumbnail takes about 0.5
      to 0.8 s (unpack 0.1 to 0.4 s, transfer about 0.1 to 0.2 s, GPU 0.07
      to 0.18 s, store 0.07 s) against 2.4 to 8 s; five real RAWs, two with
      lens corrections, pass the agreed limits (worst: HDR mean 0.13,
      p99.9 1.3). Whole folder, four at a time as the grid asks: 23
      badminton RAWs in 11.3 s (0.49 s each) against 24 in 110 s (4.6 s
      each) on the CPU route; reading each 85 MB RAW off the USB drive is
      now the main cost (`tools/gpu_raw_prototype/folder_speed.js`).
      **After Steve's first try (October 19):** a camera RAW cell now shows
      two stages, its camera preview and then its saved thumbnail; the GPU
      develops and saves the thumbnail without drawing an interim picture,
      so the cell is the same file a later visit shows and stays built when
      scrolling. An edited RAW shows its preview until its saved-grade
      thumbnail is ready, never the unedited look. GPU jobs run two at a
      time outside the grid's request slots (camera previews had queued
      behind them) and the grid and filmstrip share one job per photo.
      October 19: a shared running size ledger replaces the interim 20 s
      trim limit. Each saved picture updates its allowance total; only
      eviction, startup recovery and settings drift recovery list files. `tests/library-gpu-raw-grid.js`
      checks the stages. Not yet covered: the starting document for paste (paste
      prepares a GPU-developed photo the slow way), GPU memory budgeting with
      Grade and delivery (each development holds up to about 2 GB briefly),
      Single and full-screen views, saved-grade pictures.
   0. **Quick wins built October 19** ([brief and outcome](../../technical/archive/briefs/codex-brief-library-speed-quick-wins-2026-10-18.md)):
      the window appears before the backend; a shared running cache total
      replaces folder listings after each save and the interim 20 s trim limit.
      Library display/conversion, GPU RAW development and the hidden delivery
      renderer warm their existing pipelines after launch when idle. Compilation
      is asynchronous, yields between pipelines and gives way to a real photo;
      missing/software GPUs skip warm-up. No shader or picture changes.
      Window visible in 0.424 s (limit 1.5 s); cache bookkeeping worst 2.76 ms
      at 5,000 entries (limit 50 ms); first idle-launch Library draw 38.3 ms
      (limit 500 ms), warm median 7.1 ms on the 640 px gradient fixture.
   1. Develop once, draw live, with the scheduler. Scope analysis and the
      thumbnail capture path go with it.
   2. GPU development step (a).
   3. GPU development step (b).
   4. Single and full-screen onto the shared developed version.

   Still unmeasured: Explorer on the same folder, a clean 70-cell run,
   on-screen saved-picture timing (the Electron window was lost in driver
   runs), loaded-grid use and peak memory.
2. **RAW picture agreement** (Import and RAW module): zero Exposure and
   plain-number paste are implemented; resolve the separate quick decoder
   mismatch and finish strict checks and Steve's comparison-sheet review.
3. **Looks (slice 7):** one Looks menu; Apply Look window with
   favourites, user folders and a small built-in starter set; preview on
   hover; "Save as look preset" from the paste window. Not built.
4. **Linked photos (slice 7b):** Link grades, chain icon, "linked with N
   other photos" in Grade, Unlink, a Linked filter. Crop, lens and local
   adjustments never link. Not built. **Two decisions open.**
5. **Batch export metadata (slice 8 follow-ups):** bundled ExifTool (lens
   names from maker notes, the Focus and drive group), title and caption,
   a creator/copyright/usage template written into exports, privacy
   options, "Set name" for an unknown lens. Not built.
6. **Portable projects (slice 10):** Export project, a Projects section,
   Merge or Keep separate, "Missing" frames, manual relink. Not built.
   **Two decisions open.**
7. **Leftovers:**
   - Comfort cap for the HDR grid (1000 nits default, adjustable). Not built.
   - Full-size pictures on disk: now part of the speed plan (item 1).
   - Indexing settings (processor use, pause on battery, pins to leave
     out). Not built.
   - Offline drives: dimmed thumbnails and a Grade message. Text-only today.
   - Drag a folder in from Explorer to pin it. Not built.
   - Smaller thumbnail files: replaced by the speed plan if Steve accepts
     drawing pictures live (item 1); otherwise still deferred.
8. **Polish pass** (held until the features are done):
    - Slice 4 reminders: test the blocked-shadows warning on dark and noisy
      RAWs; Steve to review the exposure-warning wording.
    - Overlay colours: Steve asked for them in the menu bar; they are in the
      overlay panel. Confirm with Steve.
    - SDR-only rough edges: remember the last tab and format; Match asks
      before replacing SDR work; HDR-assuming wording; a notice on non-HDR
      displays.
    - Missing notices: second settings file for one photo, settings file
      with no photo (Reconnect), unreadable or newer settings file, not
      enough room on the drive, interrupted move buttons.
    - One Library settings page.
9. Installer and a methodical bug hunt.

## 6. Decisions waiting on Steve

- Linked photos: whole grade or chosen groups; where the link is stored.
- Portable projects: one-file packing; the project index file ending.
- Comfort cap: roll-off or clip; grid only or everywhere.
- Looks: one menu or two. Image-dependent settings when pasting: re-run
  or copy the numbers.
- Nested tags. What "HDR" means for an unedited photo (proposed: HDR
  Finisher's default rendering). One focus overlay or two. How often
  folders are checked.

## 7. Not planned

**Decided out:** stacks for bursts, "open in another app", batch rename of
originals, deleting whole folders, reading or writing other apps' ratings
(for now), showing unreadable files, undo history surviving a restart.

**Not planned for now:** face recognition, maps, cloud sync, phone
companion, tethering, printing, web galleries, slideshows, video. AI
search and tagging: version 2 at the earliest.

**Ideas noted:** duplicate finder, watermark on export, named snapshots,
a sharpness score, a strength slider for looks, a default preset per
camera, saved workspace layouts.

## 8. Detail and history

- Full decision record, requirements and measurements:
  [Photo_Library_PRD_2026-10-09](../archive/Photo_Library_PRD_2026-10-09.md)
  (sections 4, 5, 7 to 9, appendices)
- Remaining-work list as of October 17:
  [HDR_Finisher_PRD_v1.2 section 11g](../archive/HDR_Finisher_PRD_v1.2.md)
- Filter bar simplification:
  [brief, October 13](../archive/Library_Filter_Bar_Simplification_Brief_2026-10-13.md)
- Library briefs: `docs/technical/archive/briefs/codex-brief-library-*.md`
