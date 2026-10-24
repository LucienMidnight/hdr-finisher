# Module PRD: Photo Library

**Photo framing (October 24, 2026).** Single-photo view draws saved frame metadata
as an attached layer with Fit/100% and pan/zoom. Cached photo pixels, grids and
filmstrips remain unframed. Requirements and validation belong to
[Export and Proof](export-and-proof.md#8-photo-framing--requirements-recorded-october-24-2026).

**Panel alignment (October 24, 2026).** Both Library side panels resize by dragging their inner edge, with arrow keys, Home/End and double-click reset. Collapsing and reopening a panel keeps its chosen width. Panel headers share the preview-toolbar height; section and folder chevrons and text use consistent left columns.

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 19, 2026, against the code.
- **Code:** backend `library_*.py` (helper, index, sidecars, thumbnails,
  pictures, kept pictures, paste, picture queue, file commands); frontend
  `photo-library.js`, `library-*.js`, `grade-paste.js`; mock-ups in
  `../library-wireframes/`.
- **How it works inside:** [photo-library.md](../../technical/photo-library.md),
  [library speed architecture](../../technical/library-speed-architecture.md).

**Viewport scheduling (October 24, 2026).** Tile removal cancels pending demand,
but the existing maximum of two active scene preparations finish and publish
both the 2560- and 640-pixel caches. Returning tiles share that preparation.
Explicit viewing requests lead the pending queue, then visible tiles, then
nearby photos; aging only breaks ties within a priority. Embedded camera
previews still display immediately. Source identity changes and explicit grade
invalidation cancel obsolete shared work; publication rechecks ownership before
renaming the cache file.

When the grid is idle, one candidate at a time progressively checks and caches
photos in the current folder, starting near the viewport. Activity detaches
pending idle demand and foreground work takes the next available slot. Each
identity is attempted once per folder pass. Idle work stops when either existing
cache allowance lacks conservative headroom for both scene sizes (including a
possible SDR reference); it does not deliberately evict entries to warm more.
Large folders may therefore remain partly uncached. Foreground requests retain
the ordinary cache eviction policy. Active preparation is bounded and is not
preempted just to open another image, so an explicit request can wait for the
next preparation slot. The next folder pass can reconsider cache headroom.

**DNG rejection detail (October 21, 2026).** Library quick and native picture
requests preserve the DNG inspector's rejection reason, including insufficient
safe memory, instead of replacing it with a generic unreadable-DNG message.
Admission rules and memory reserves are unchanged. The four small DNG routing,
cancellation and decoder-failure tests use a sufficient test memory snapshot;
they do not depend on the machine's free RAM.

**Library footer (October 23, 2026).** The idle footer no longer displays
"Photos stay where they are." The status region remains available for activity
and action messages.

**Optional Test Patterns folder (October 23, 2026).** Settings can show or hide
an app-managed, pinned Test Patterns folder. Enabling it generates HDR and
delivery-proof ACEScg-linear EXR patterns under the writable HDR Finisher data folder;
disabling it removes the Library pin and keeps the files on disk. The option
defaults off and does not change any existing user pins.

**Cold-start performance work (October 24, 2026).** Prioritize multi-second
source preparation before sub-second CPU/GPU differences. Measure matched
inputs with a 10% timing tolerance for shared-machine noise; preserve existing
finished-pixel tolerances and GPU memory reservations. Built: linear-DNG
embedded SDR transfer/reduction and gain-map AVIF working-colour preparation
run on the GPU. Oversized DNG sources reject the GPU bridge before reading
pixels, avoiding duplicate preparation. AVIF uses a native raw-pixel handoff
instead of an intermediate compressed PNG, with the ordinary decoder as fallback.
Library measurements suggest DxO optical-correction DNG 13.6 to 5.4 seconds
and HDR Finisher exported AVIF 11.5 to 7.8 seconds. Geometry/reference probes and
finished-picture comparisons passed their existing tolerances.

**GPU path accepted (Steve, October 24, 2026).** Steve reports that the GPU
fixture passed on the Mac without triggering the range guard. Together with
the non-repeatable corruption on this machine, this supports faulty VRAM as
the cause of the earlier highlight-reconstruction failures. The GPU path is
no longer provisional. Grade import and Library both use the optimized shared
edge-colour method: reduced blur grids stay on the GPU, source weights are
reused across channels, and all scales combine in one full-size pass. Keep
the range guard and CPU fallback for GPU failure/unavailability.

Open: AVIF still spends about 5.6 seconds in CPU decoding/gain-map reconstruction.
The earlier 57-second repaired RAW cold load included a CPU retry after GPU
corruption on the faulty-VRAM machine; it is not a healthy-GPU timing baseline.
About one second remains the shared highlight-reconstruction target; the recorded
42 MP GPU result is about 3.2 seconds, and Mac timing has not been recorded.

**Mixed-format folder loading (October 24, 2026).** Recent Play_Raw logs
show the TIFF waiting about 37 seconds for a source slot, then decoding in
0.75 seconds. AVIF preparation takes about 1.4 to 7.1 seconds before GPU work;
large files and picture storage keep both source slots occupied. Ordinary
JPEG/PNG, TIFF and AVIF already use GPU colour preparation. Ultra HDR JPEG
now joins that route: libultrahdr still reconstructs the gain map, while the
GPU converts working colour, prepares the SDR reference, measures the source
and reduces Library pictures. ICC/orientation, the decoder's negative clamp,
reference-white scaling and the CPU fallback are preserved. Three matched
cold loads of the fire-dancers JPEG measured a 3.46-second GPU median against
4.21 seconds on the CPU (about 18% faster, judged with the existing 10% timing
tolerance); finished HDR/SDR comparisons passed the existing perceptual limits.
The disposable cache-size ledger uses WAL NORMAL synchronization, since its
counts are rebuilt from published files on restart, and publications avoid
recreating directories that already exist. Photo files and grades are not
stored in this ledger. Remaining: AVIF decoding/gain-map reconstruction and
folder-wide source queue time; no new whole-folder timing claim is established.

## 1. Purpose

**Remembered picture errors (October 23, 2026).** Failed photo developments
leave a small amber `--attention` error button on grid and filmstrip cells.
Both source slots continue with other photos; saved edits are validated before
decoding. Failures are stored in the Library database against the source,
settings-file revision and pending grade, so reopening or scrolling does not
repeat the failed development. Changing the photo or settings expires the error.
Cancellations, pauses and resource/admission failures are not remembered as
broken photos. Activity retains the reason and ignored state after workers
finish and across restarts. Tile and Activity error buttons open the same
dialog: Ignore remembers and skips the error, Try again clears it and queues
the photo, and Revert to original removes its grade and queues a fresh picture,
including when the command comes from Activity after browsing to another folder.
Reverting preserves original pixels, marks, tags, albums and the previous grade
through the existing settings writer. A stale dialog cannot reset newer edits.

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
| ~~Grid and filmstrip thumbnails are one gain-map file each (Ultra HDR JPEG), in a managed disk cache.~~ Replaced October 19 by "Develop once, draw live". Full-size Single and full-screen pictures stay scene-linear, drawn by the GPU. | Steve, 2026-10-17 |
| One cache folder, default `%LOCALAPPDATA%\HDR Finisher\Cache` (on C:), with a folder chooser, on/off, size controls and Clear. Thumbnails, full-size pictures and saved-grade pictures have separate allowances. | Steve, 2026-10-17 |
| **One stored thumbnail size per photo, scaled to the cell.** No size per window width. | Steve, 2026-10-18 |
| **Picture tiers:** tier 0 is the camera's embedded preview (under 0.2 s), replaced in place by the real thumbnail. The visible swap is accepted; a blur-then-wipe is the fallback if it bothers Steve. | Steve, 2026-10-12 |
| ~~The real thumbnail saved to the cache comes from the GPU picture already made for display. It is not decoded and rendered again on the CPU.~~ Replaced October 19 by "Develop once, draw live". | Steve, 2026-10-18 |
| The Export page stays and grows; Quick export… runs a preset on a selection. | Steve, 2026-10-11 |
| Exposure pastes as a plain number, including RAW; starting Exposure is zero. | Steve, 2026-10-11 |
| No photo-count size target as a product idea; tested on a large library internally. | Steve, 2026-10-11 |
| Dragging photos onto a folder asks first, for now. | Steve, 2026-10-11 |
| `.hdrfinisher` projects stay out of the Library. | 2026-10-11 |
| Pause of saved-grade picture work lasts one app session. | 2026-10-18 |
| **Library pictures: speed first, accuracy "close enough to enjoy".** Thumbnails must be very fast and give a good SDR and HDR preview for culling and group grading. Larger pictures must look close enough to the export to enjoy full screen, with no noticeably wrong colour or tone; they need not be precise. Judged by eye. Export and Proof keep their strict limits. | Steve, 2026-10-18 |
| **Prove GPU development first.** Before building the rest of the speed plan, Claude (not Codex) prototypes full-quality RAW development on the GPU to show whether it is fast enough. | Steve, 2026-10-18 |
| **Develop once, draw live.** Each photo is developed once into a stored version; every Library picture (unedited, pasted or saved grade) is drawn live on the GPU from it with Grade's shaders. Finished-picture files are no longer made for display; a pasted grade is a redraw. Replaces the October 17 gain-map thumbnail decision and the October 18 "save the displayed GPU picture" decision. | Steve, 2026-10-19 |
| **One exception to develop once: selected-photo true 100% detail.** Enlarge the stored 2560 picture immediately while the selected photo develops at full size, then swap to true detail. Keep the full-size scene for that photo so later zooms reuse it, including a zoom-out while development is pending. Never pre-develop neighbours at full size. Use the existing full-size cache allowance; no disk allowance increases are approved. | Steve, 2026-10-19 |
| **No usable GPU: visible-only CPU fallback.** Keep the existing CPU-made pictures only when the GPU is missing, software-only or lost. Make them only for photos on screen (visible cells, Single and full-screen), with no background picture queue and no pre-making pictures for pasted photos that are not visible. After device loss or driver reset, automatically return to live GPU drawing when a usable GPU becomes available; fallback must not latch for the session. As with CPU export, keep this route working without speed work or new features. | Steve, 2026-10-19 |
| **Batch Export tiles share live Library drawing.** Visible photo tiles use the same live GPU renderer and visible-only CPU fallback. While export or Proof is running they are background work: draw each tile once and retain it, never redraw for progress updates, and yield GPU memory and turns to delivery. Verify export time per photo with the page open versus closed on the same three photos; the agreed timing noise allowance is 5%. | Steve, 2026-10-19 |
| **Recent thumbnail pool: fixed 512 MB**, sized for an 8 GB machine; not scaled with RAM. Finished grid and filmstrip cells stay built for one screen beyond each edge. | Steve, 2026-10-18 |

**V2 scope decision (Steve, October 21, 2026):** Library Looks (slice 7),
linked photos (slice 7b) and portable projects (slice 10) are deferred to
v2. They are not v1 launch requirements. Their scope and unresolved
decisions are retained below for v2 planning. Existing Film Look presets
are unaffected.

**CPU fallback implementation boundary (approved October 19):**
The visible live surfaces use `library_live.fallback_picture`, which keeps the
existing CPU adjustment/geometry/local-mask code, `_denoised_export_source`
and highlight compression, plus `library_thumbnail_codec.encode` for the
returned HDR/SDR JPEG. `library_pictures` remains the scene cache and source
reduction layer; the worker and `/fallback-picture` route serve visible
requests. The JPEG is returned in memory rather than saved as another cache
file. The Library retries hardware drawing after GPU loss automatically.
The Library-only fallback helper, JPEG codec and request plumbing remain
because of this fallback. Its numerical routines are shared with CPU export
and other CPU rendering; no CPU speed work is planned.
The old `library_kept` producer/reader, `library_thumbnails` queue and durable
`library_picture_queue` are **not** required by this fallback. Their removal
is built in cleanup groups 1-5 below; their file-producing entry points are gone.

**Shared Export tiles built in part 3 (October 19):**
Visible tiles share the live renderer and CPU fallback. Tile work has
background GPU admission, its working graph is released after drawing, and
progress updates reuse the completed canvas. On the same three RAW photos,
mean export time was 33.094 s per photo with the page closed and 33.756 s
open (+2.0%, within the approved 5% noise allowance). The focused real-app
check confirmed no redraw on progress updates. Exported files and Proof
output did not change.

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
preview still shows first. Single/fullscreen now share the GPU-developed
Bayer RAW scene (October 19, part 5); saved-grade pictures use the delivery
renderer and Grade's decoder settings.
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

- October 19, draw-live part 1: unedited grid and filmstrip cells draw stored
  640 px scenes with Grade's shaders, after the camera preview. One development
  also keeps the 2560 px scene in the existing managed allowances; scene identity
  includes source interpretation, RAW settings and reference white, but excludes
  finishing edits. Cache off uses bounded RAM transport. These cells no longer
  request, read or write finished thumbnail JPEGs. Finished live cells stay built
  one screen beyond each edge. New scene work uses background GPU admission and
  releases its picture graph before delivery takes the reservation.
  A three-RAW plus PNG real-app check passed stored reuse and induced device-loss
  recovery without a relaunch. Repeated scene metadata requests took 8-21 ms;
  the four-photo cold grid took 8.7 s overall. No matched whole-grid baseline or
  70-cell measurement yet; the 100 ms/2 s targets are not claimed. Live finished
  pixels passed Grade's agreed perceptual limits for one RAW and a PNG in both
  lanes (worst SDR mean 0.015, p99.9 0.046), without the old thumbnail codec.
  CPU-made thumbnail fallback is requested only by visible cells and retries
  hardware GPU drawing automatically. Saved/pasted grades, Single/full-screen,
  source overlays and the old saved-picture queue remain for the next parts.

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
- Scrolling back (October 21): finished live cells within one screen of the
  edge stay built. Beyond that, the restored fixed 512 MB recent pool retains
  completed canvas surfaces, reattaching them without picture requests or GPU
  redraws. The previous encoded-picture pool was lost during the switch to live
  drawing; disk scene hits still worked but a 20-photo return took 2.77 s to
  reload/redraw. The live pool budgets 16 bytes per pixel for surface/presentation
  storage, evicts oldest retained cells and releases their canvas backing stores.
  Source/grade identities and HDR state prevent stale reuse; cache changes,
  hardware loss and leaving Library clear the pool. Overlay maps are detached
  while pooled and refreshed on return. Loading cells remain cancellable.
  A focused real-folder Electron check restored all 20 badminton RAW surfaces
  with no backend picture requests and identical screenshot pixels (38 ms in
  this run). This is a recent-scroll check, not a cold-folder/relaunch target. The JPEG
  export subfolder also passed: 20 surfaces, no picture requests, unchanged
  screenshot pixels (13 ms). Fast checks: 552 Node passed; Python had 2325
  passes, three skips and four unrelated linear-DNG/memory-guard failures.
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
- October 19, GPU RAW follow-up part 3: GPU thumbnails retain the starting
  document, full-source measurements, RAW settings and source fingerprint.
  Concurrent paste checks reuse it through the existing per-photo lock.
  Missing documents keep the CPU fallback with a recorded reason; scene cache
  v6 rebuilds older thumbnails once. Real app preparation: 4.364 s on CPU
  versus 0.031 s for three concurrent reuse requests (5% timing allowance).
  No rendered pixels change; the existing picture qualification still applies.
- October 19, GPU RAW follow-up part 4: Library RAW, delivery and Grade now
  share the broker's memory budget. Background RAW and delivery are admitted
  one at a time; both yield to Grade and use the existing queue ageing.
  RAW reserves 44 bytes per sensor pixel plus 64 MiB, releases intermediates
  early and submits 128-row bands. Preemption frees buffers before releasing
  the reservation, then requeues without CPU fallback. Missing/software/lost
  GPU and insufficient memory retain CPU fallback with a recorded reason.
  Three badminton pictures still pass (worst HDR mean 0.0266 / p99.9 0.0774;
  SDR 0.0182 / 0.0590). RAW GPU time is about 1.0-1.6 s including the new
  scheduler checks. Try scrolling Library while adjusting a photo in Grade
  with batch export running; Grade retains priority.
- October 19, GPU RAW follow-up part 5: grid, Single, Compare and full-screen
  use one full-quality Bayer development, reduced directly to 640 and 2560 px.
  Concurrent requests merge; neighbours retain textures in the bounded GPU
  cache. First native zoom develops one full GPU source into RAM, then pans
  reuse viewport crops. Another source replaces it; no full native disk file.
  CPU fallback uses Grade's full development and logs its reason. Scene cache
  v7 refreshes older views; separate CPU/GPU crop keys prevent stale fallback
  crops. Saved-grade zoom behaviour is unchanged.
  Three badminton RAWs, two manually lens-corrected, pass with grain/locals
  at Fit and native detail: worst HDR mean 0.09243 / p99.9 1.80228, SDR
  0.05364 / 0.83131 before encoding. Cold two-size preparation 1.92-2.34 s;
  cached requests about 6 ms, prepared neighbour flip 56 ms. First native
  preparation 3.44-4.40 s including transfer; no previous like-for-like
  three-photo Single baseline. Existing 5% timing allowance applies.
  GPU development including scheduler checks is the largest measured cold
  stage (1.24-1.54 s of the 1.92-2.34 s two-size preparation).
  Checks: 541 Node / 2315 Python passed (3 skipped, 19 existing warnings),
  focused native/cache 20 passed; Single/native and four-make grid drivers
  passed serially. The driver now exits full screen with the keyboard
  shortcut after two test-control failures clicking its hidden toolbar.
- Batch export pages and states (see Export and Proof).
- October 19, restored delivery policy: Library pictures skip the optional
  decoded HDR peak check. Saved-picture cache v7 refreshes checked entries.
- Saved-grade pictures now use the shared hidden GPU delivery renderer,
  including locals, Denoise and resize; CPU fallback records its reason.
  The existing disk picture cache remains and refreshes old CPU entries.
- October 19, GPU RAW follow-ups parts 1–2: cold saved-grade Bayer RAW
  pictures develop on the GPU, with saved lens settings and full-source
  measurements. Missing/software/lost GPUs and unsupported RAW settings keep
  the CPU fallback and its recorded reason. No half-size RAW development.
  Delivery pixels travel through job-owned shared RAM; only metadata spools
  remain. Three disposable badminton RAWs pass before-encoding colour limits
  at 2560 and Fit/1280, two with manual Lensfun correction (Samyang 135 mm
  profile, exercising distortion and vignetting). Worst HDR mean 0.0642 /
  p99.9 1.550; worst SDR mean 0.0238 / p99.9 0.233. DSC07060 includes grain
  and Denoise. The same GPU delivery graph remains shared with export.
  One cold DSC07072 picture improved from 10.13 to 6.71 s; encoding was the
  largest individual stage (2.43 s). The about-1-second goal is not reached.
  Saved pictures also enforce enabled highlight targets after encoding;
  cache v6 refreshes earlier pictures. Export and Proof checks cover the
  shared correction; no encoder or gain-map maths changed.

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
  Single/fullscreen now share the GPU development; final visual review
  remains open (Import and RAW).
  Non-RAW starts are unchanged. Unedited and saved-grade cache versions
  invalidate pictures from the previous RAW start.

### Other RAW families: GPU work estimate (October 19, part 6)

Report only; these unsupported developments keep the CPU route and recorded
fallback reasons. A RAF extension does not itself mean X-Trans: eligible
Bayer RAFs can already use the GPU. Likewise, adding another ordinary Bayer
camera supported by LibRaw is not automatically a new GPU algorithm.

These are rough engineering estimates for one developer, including focused
qualification and integration, not measured delivery promises. They assume
representative files are available and exclude a LibRaw codec upgrade or
reverse engineering a new proprietary format.

| Family | What is missing | Rough size |
| --- | --- | --- |
| Additional ordinary Bayer cameras | Check the existing sensor bridge supplies valid black/white levels, as-shot white balance, three-colour camera matrix and orientation. Fix only missing metadata fields, then qualify bright highlights and lens corrections. LibRaw still unpacks compressed sensor data on the CPU. Cameras already satisfying this contract need qualification rather than a new shader. | Small: 2-5 working days per new metadata family; no new code if it already qualifies. |
| X-Trans (6 by 6 CFA) | Replace the shader's hardcoded 2 by 2 CFA addressing and Bayer AHD interpolation/homogeneity passes with the full-quality X-Trans development used by Grade. Audit highlight repair neighbourhoods and preserve the full-source measurements, colour handling, lens order, bounded memory and Grade preemption. Then qualify several sensor generations at Fit/native with highlights, grain and locals. Merely changing the CFA table cannot make Bayer AHD correct for X-Trans. | Large: about 2-4 weeks. |
| Bayer mosaic DNG | Classify the primary image correctly, preserve DNG calibration/profile and brightness semantics, then feed eligible Bayer mosaics into the shared GPU development. Honor mandatory operations and their order; do not remove the blanket DNG exclusion before those semantics are covered. | Medium: about 1-2 weeks for a declared simple subset; 2-4 weeks for all currently supported mosaic DNG cases and mandatory corrections. |
| Linear DNG | No demosaic is needed. Bridge the existing decoded linear pixels, black/white normalization, camera/profile colour conversion, exposure/brightness metadata, crop/orientation and mandatory operations into the GPU path. Existing RGB finishing can be reused. The current CPU implementation supports specific OpcodeList3 GainMap and WarpRectilinear variants; GPU equivalents must preserve their order and prevent a second Lensfun correction. Unsupported mandatory operations remain rejected. | Medium: about 1-2 weeks for a declared subset; roughly 2-4 weeks for the currently supported linear cases with correction/profile coverage. This overlaps the mosaic DNG infrastructure, not an additive estimate. |
| Distinct four-colour, non-RGB CFA, unusual CFA or layered sensors | Define a source representation, calibration and colour transform matching Grade's existing CPU route; implement the family-specific reconstruction instead of forcing the three-channel Bayer pipeline onto it. Layered data needs a different unpacked input. Scope from real sample files before implementation. | Large and uncertain: about 4-8 weeks per sensor family; format decoding work could extend it. |

The estimates follow the local eligibility and implementation boundaries in
`library_gpu_raw.sensor`, `raw_import._camera_linear_metadata_from_libraw`,
the WGSL CFA/AHD passes in `frontend/library-gpu-raw.js`, and the primary-image,
profile and opcode handling in `linear_dng.py`. DNG container support alone
does not establish correct development. Missing/software/lost GPU remains
the CPU fallback for every supported family. No additional GPU support was
built in part 6, and no numerical limit changed.

For any chosen extension, acceptance should reuse the existing perceptual
limits before encoding (HDR/SDR mean below 1.0, p99.9 at most 3.0), Fit/native,
grain/locals and lens cases, the exact delivered HDR ceiling after encoding,
and shared memory/preemption checks. Start with the family Steve needs and
its representative photos; no broad format project is implied here.

**Live drawing, part 2 (October 19):** Grid and filmstrip cells now draw
saved grades and virtual copies as well as unedited photos. Single Fit and
full-screen Fit use the same 2560 px scenes. Grade's local masks, geometry
and Denoise are passed through its renderer. The visible-only CPU fallback
uses the existing numerical adjustments, Denoise and Library JPEG codec;
it returns its picture directly, including with the disk cache disabled.
The old saved-picture queue and native-detail route remain open work for
the next parts; this commit does not claim their removal or the speed targets.
Fast checks: 541 Node tests and the full Python suite. Focused GPU checks:
live grid/device recovery and live pictures with rotation, locals and Denoise.

**Live drawing, part 3 (October 19):** Stored-scene requests share a priority
scheduler across grid, filmstrip, Single, Compare and read-ahead. Duplicate
requests merge and promote to the most urgent waiter. A departed waiter
cannot cancel another visible user's development; the final departed waiter
cancels the work. Two full developments at most, with one serial draw lane.
Selected photos precede visible cells, then read-ahead. Existing backend
Grade pauses, shared GPU budgets and delivery preemption still govern work;
indexing remains behind browsing on the helper. Age breaks sustained Library
queue starvation. Visible batch Export tiles now use that same scheduler and renderer through
the Library frame. Intersection observation starts and cancels demand; a
completed tile is retained when progress badges change. Source and draw work
wait behind active delivery, and each draw releases its working graph before
releasing its background lease. Finished-file queues remain scheduled for removal.

Part 3 validation: all 543 Node checks and 2,327 Python checks passed
(3 skipped). The live grid/recovery/Single check and the shared Export tile
check passed. With the same three full-size RAW photos exported individually
as maximum-fidelity Ultra HDR JPEG, closed/open Export page times were
31.959/34.176 s, 34.422/35.095 s and 32.901/31.996 s. Mean time per photo
was 33.094 s closed and 33.756 s open: +2.0%, inside the approved 5% noise
allowance. Completed tiles drew once and progress updates drew none.
The browsing targets and 70-cell/memory comparison remain unmeasured.

Part 4a built October 19: saving, paste/revert/Undo and virtual-copy creation
no longer enqueue finished-picture files. Grade documents and settings writes
remain unchanged. A focused behavioral check covers save, revert and copy
with picture producers forbidden. All 543 Node checks passed. The full Python
run passed 2,325 checks, skipped 3, and failed 3 old expectations that saving
would create another finished file. Those expectations were updated for the
intended behavior; all 74 related checks then passed. No GPU check directly
covers these settings-only call-site removals; no additional GPU run was made.
The old queue is not yet removed.

Part 4 remaining cleanup, explicitly approved by Steve October 19: remove the
saved-picture producer/reader and durable queue; remove finished-thumbnail
routes and the detached thumbnail producer; remove the saved-picture settings
and Activity entry, retaining Pause/Resume for actual scene development;
remove GPU thumbnail capture and its second off-screen render; retire tests
that only exercise those removed file features and update paste tests to
expect live redraws. Keep shared document identity/atomic-write helpers,
source cache controls, visible CPU fallback, original files and sidecars.
Perform the cleanup as five small local commits: saved-picture producer and
queue; thumbnail routes and producer; settings and Activity; thumbnail
capture; tests. Run the fast checks after each. Remove tests in the final
group and list them in that commit. Native colour and timing comparisons
follow this cleanup.

Cleanup group 1 removes saved-picture production, open-Grade source capture,
the durable queue and all scheduling entry points. Document helpers and old
readers remain only until their consumer groups are removed. No tests removed
in this group; obsolete producer tests are scheduled for group 5. Validation:
543 Node checks and all 7 live-scene Python checks passed. The full Python
command stopped at collection in the three obsolete producer/queue test
modules, which still import removed code; they are retired in group 5.

Cleanup group 2 removes finished-thumbnail batch/file routes, the detached
producer and its worker lane, saved-picture readers, and the unused frontend
file-thumbnail pool. Cache controls use LibraryCache directly. Normal cache
reconciliation now removes old JPEG/AVIF display files and their metadata,
including abandoned saved-picture temporary images and old selected cache
locations. It only visits marked, non-linked cache directories; stored NPZ
scenes and retained starting documents remain. No tests removed in this group.
Validation: 539 Node checks passed; the retired thumbnail-pool test module
fails to load. Full Python collection stops at the four obsolete file-feature
test modules, scheduled for group 5. All 19 live/source-cache Python checks
passed. The focused app grid check passed, including visible CPU fallback,
automatic GPU recovery and repeated live draws. A disposable cache check
confirmed retired files are removed while source scenes, starting documents
and an original outside the cache remain; its temporary-directory teardown
hit the existing open SQLite ledger handle on Windows.

Cleanup group 3 removes the obsolete saved-picture resolution preference,
menu, polling and Activity queue entry. Activity retains Pause/Resume for
actual Library scene reading through the helper's existing pause gate; resume
does not release Grade/import/export pauses. Shared document identity and
atomic writes now live in library_documents.py; their contents and saved
document behavior are unchanged. No tests removed in this group.
Validation: fast Node checks still have only the obsolete thumbnail-pool load
failure; full Python collection stops at seven modules importing removed
code. The focused live/grade run passed 28 checks; one live-scene test still
sets the renamed document-provider field and is updated in group 5. No GPU
output processing changed; the paste interaction check follows group 5.

Cleanup group 4 removes GPU finished-thumbnail readback/capture, both
off-screen rendition builders, their save queue, and the saved-file compositor.
Ordinary live draws, Grade's graph and visible CPU fallback remain unchanged.
No tests removed in this group.

Group 4 validation: 539 Node checks passed with the obsolete thumbnail-pool
load failure; full Python collection still stops at the seven old imports.
The focused live-grid app check passed after capture removal, including
visible CPU fallback, automatic GPU recovery, Single and cache reuse.

Cleanup group 5 built October 20: retires the saved-picture producer/queue, thumbnail-file,
capture, file-stage and decoded-thumbnail-pool tests. Their driver registry
entries are removed. Cache allowance, clearing, disabled-cache and fallback
codec colour checks remain in test_library_cache.py; the JPEG decoder needed
only by that codec check now lives in test support. Grade identity, history,
file moves and paste checks use the shared document reader and stored scenes.
The paste app check verifies live redraws for three targets including a
virtual copy, reuse of the developed scenes, one Undo and untouched originals.
New regressions check retired routes return 404, scene Resume preserves other
pause reasons, and ordinary cache cleanup removes retired pictures from both
current and former marked cache locations while retaining scenes, starting
documents and files outside the cache. No allowance or tolerance changed.
Native colour and timing comparisons remain the next work after cleanup.

Group 5 validation: all 539 Node checks and 2,272 Python checks passed
(3 skipped). The first full Python run found one overlay-cache fixture that
still expected a retired JPEG to survive; it now uses a retained JSON entry,
with the same eviction limit and cross-allowance protection. The full rerun
passed. The focused paste app check passed, including native text clipboard,
selective paste, virtual-copy bulk paste, live redraw and one Undo. The five
cleanup groups are complete; native colour/timing acceptance remains open.

Part 4b built October 19: Single/full-screen true 100% detail follows the
selected-photo exception above, including saved grades, rotation and locals.
Fit stays on screen while a separate, selected-only full-size scene is
developed. Zoom-out, pan and routine status redraws retain that development;
later zooms reuse it. Source settings invalidate it, and finishing changes
redescribe the cached source with the latest grade. Full-size scenes use the
existing full-size cache and its controls. Grade's unchanged viewport graph
renders detail under the shared background GPU lease; only the visible crop
stays on the GPU after the working graph is released. Compare Fit requests
now use the supported stored 2560 tier rather than obsolete 1280/1920 tiers.

Part 4b validation: 543 Node checks and 2,329 Python checks passed (3 skipped).
The focused app check passed for an edited, rotated 3200-pixel PNG with a
local adjustment and a 7968 × 5320 RAW: enlarged Fit immediately, one
full-size development, reuse across pending and completed zoom cycles,
no full-size neighbour development, actual detail pixels and bounded native
working resources. Compare Fit also uses stored scenes. The existing
640-pixel HDR/SDR colour check passed within its agreed perceptual guide.
Native timing and the Fit/100% perceptual comparison with scale-dependent
effects remain open. Compare's detail view still uses the legacy native
crop route; its move to live native scenes remains open with that cleanup.

## 5. V1 open work, in order

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
     needs only a redraw, not a new development. **Approved by Steve,
     October 19**; it replaces the October 17 gain-map thumbnail decision and
     the October 18 "save the displayed GPU picture" decision. Brief:
     [codex-brief-library-draw-live-2026-10-19](../../technical/briefs/codex-brief-library-draw-live-2026-10-19.md).
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
   - **Single and full-screen** use the shared GPU-developed Bayer scene
     (built October 19, part 5), with full-quality CPU fallback.

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
      eviction, startup recovery and settings drift recovery list files. The
      former file-stage test was retired with live drawing; library-live-grid.js
      now checks live RAW cells and recovery. GPU-developed starting documents
      feed paste (part 3).
      Shared GPU memory budgeting with Grade and delivery is built in part 4.
      Single and full-screen are built in part 5. Saved-grade pictures are built in parts
      1–2 of the follow-up; part 6 reports unsupported families above.
      Completed brief and outcome: [codex-brief-gpu-raw-follow-ups-2026-10-19](../../technical/archive/briefs/codex-brief-gpu-raw-follow-ups-2026-10-19.md).
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
      Follow-up October 19: saved-grade thumbnail re-encoding uses its existing
      single helper lane without yielding to unrelated Library source decodes;
      the Grade/import/export pause still applies. Pending cells renew cache
      production after a lost request instead of only polling for a file.
      App check: saved thumbnail ready in 1.11 s (10 s limit) while a slow
      DNG request remained active, including recovery from a dropped request.
   1. Develop once, draw live, with the scheduler. Scope analysis and the
      thumbnail capture path go with it.
   2. GPU development step (a).
   3. GPU development step (b).
   4. **Built October 19:** Single and full-screen onto the shared developed version.

   Non-RAW source preparation has its own batch plan in section 5.1 below.

   Still unmeasured: Explorer on the same folder, a clean 70-cell run,
   on-screen saved-picture timing (the Electron window was lost in driver
   runs), loaded-grid use and peak memory.
2. **RAW picture agreement** (Import and RAW module): zero Exposure and
   plain-number paste and the shared Single/full-screen development are
   implemented; Steve's comparison-sheet review remains open.
3. **Batch export metadata (slice 8 follow-ups):** bundled ExifTool (lens
   names from maker notes, the Focus and drive group), title and caption,
   a creator/copyright/usage template written into exports, privacy
   options, "Set name" for an unknown lens. Not built.
4. **Leftovers:**
   - Comfort cap for the HDR grid (1000 nits default, adjustable). Not built.
   - Full-size pictures on disk: now part of the speed plan (item 1).
   - Indexing settings (processor use, pause on battery, pins to leave
     out). Not built.
   - Offline drives: dimmed thumbnails and a Grade message. Text-only today.
   - Drag a folder in from Explorer to pin it. Not built.
   - Smaller thumbnail files: replaced by the speed plan if Steve accepts
     drawing pictures live (item 1); otherwise still deferred.
5. **Polish pass** (held until the v1 features are done):
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
6. Installer and a methodical bug hunt.

### 5.1 Non-RAW Library source speed: batch plan (October 20, 2026)

**Status: Batches 1-3 retained for qualified cases; Batch 2 HDR/PFM remains blocked.
Batch 4 investigation closed and production GPU implementation shelved.
Batches 5-7 are shelved as a sequence; cold-folder admission and DNG work take priority
(Steve, October 20).** Steve requested a single plan covering all supported non-RAW
formats, delivered in small batches.
This extends item 1 above; the completed Bayer RAW work remains separate.
Update each batch here with its commit, outcome and remaining limits when built.
Do not mark a format complete merely because it draws on the GPU.

**Problem and starting evidence.** Non-RAW live scenes currently use
`library_live.develop_cpu` and Grade's full `SessionStore.prepare_session`
before storing the 640/2560 scenes. Finishing already draws live on the GPU.
The Bayer sensor bridge cannot accept these decoded RGB files. A single
empty-application-cache investigation on October 20 measured:

- `5M071612_finished.avif`, 1433 x 1920: scene preparation 3.62 s;
  import decode 3.05 s, including HDR reconstruction 1.65 s and decoder
  colour conversion 0.80 s. Cached scene metadata request 10.8 ms.
- `A7R00619.exr`, 7980 x 5320: scene preparation 7.74 s; decode 3.19 s,
  colour conversion 2.79 s, full-source analysis 0.71 s. Cached request 10.4 ms.

These are diagnostic single samples, not p90 results or end-to-end first-paint
measurements. Windows' file cache was not flushed. Other formats have not
been timed. Neither file has the quick camera-preview placeholder RAW uses.

**Scope and shared design.** Build one Library RGB source-preparation service,
with small decoder adapters rather than a second complete pipeline per format.
Decode compressed samples with the existing codec where necessary on the CPU;
move supported transfer decoding, colour transforms, range handling,
measurements and reduction onto the GPU. Gain-map reconstruction is an
additional adapter stage, before scene reduction. Reuse existing Grade maths,
Library stored scenes, document identity, transport and broker admission.
Keep format semantics outside the ordinary Bayer demosaic path.

| Work group | Inputs | Special handling |
| --- | --- | --- |
| Ordinary pictures | Standard JPG/JPEG, PNG; ordinary TIFF and HEIF | Orientation, ICC profiles, precision and the authored SDR rendition. JPG and JPEG are the same format. |
| Direct HDR / linear RGB | EXR, HDR, PFM, JPEG XL, direct-HDR AVIF/HEIF and applicable TIFF | Declared primaries/transfer, PQ/HLG reference white, float/integer precision, EXR channels/windows, and existing manual interpretation gates. |
| Gain-map pictures | Ultra HDR JPEG, ISO gain-map AVIF, Apple gain-map HEIC/HEIF | Decode base plus map and reconstruct using each format's own metadata; retain both HDR and authored SDR renditions. |

Dispatch by file contents and metadata, not just extension: TIFF, AVIF and
HEIF can belong to different groups. JPEG XL currently decodes in-process
through imagecodecs/libjxl; it shares the RGB foundation and does not need a
new finishing renderer. Third-party JPEG XL interpretation requirements stay.
DNG, including linear DNG, remains in the separate RAW-family plan because
its profiles, calibration and mandatory operations need their own treatment.
Do not add new supported formats as part of this work.

**Rules applying to every batch:**

- Preserve source interpretation, orientation, crop/data-window semantics,
  reference white, negative-colour handling, source measurements, starting
  grade and source fingerprint. Do not analyse only a small thumbnail when
  full-source peaks or other measurements affect the grade. Do not resize
  encoded PQ/HLG/gamma samples as though they were linear light.
- Preserve original files and sidecars. Finishing changes reuse the scene;
  source/interpretation changes invalidate it. Merge concurrent grid,
  filmstrip, Single and Export-tile requests for one source recipe. One
  preparation supplies the existing 640 and 2560 tiers; selected-only native
  detail remains the explicit exception and must retain/reuse its full scene.
- Use bounded uploads/bands and existing shared GPU memory admission. Yield
  to Grade and delivery, free intermediates before releasing reservations,
  and do not increase cache, RAM or GPU allowances. Keep existing read-ahead
  policy; no new background full-size development or finished-picture queue.
- The existing visible CPU fallback remains for unavailable/lost/software
  GPUs and unsupported operations, with a recorded reason. Retry hardware
  after recovery; do not turn transient preemption into CPU fallback. CPU
  compressed-file decoding in the normal GPU route is not itself fallback.
  No optimisation project for the CPU rendering fallback.
- Keep Grade import, export and Proof behaviour unchanged. Prefer Library
  adapters around shared routines; if a shared change affects those outputs,
  apply their strict validation rules before committing it.

**Batch 0 — representative baseline and decoder contracts.** Inventory actual
routes and choose a small representative sample set: ordinary JPEG and PNG,
profiled/16-bit TIFF, EXR, HDR/PFM, SDR and HDR JPEG XL, direct-HDR AVIF/HEIF,
and each supported gain-map family. Include orientation, non-sRGB colour,
manual interpretation, non-default reference white, a saved grade and bright
highlights across the set; do not require every combination for every codec.
Use disposable copies/caches and existing stopwatch hooks. Split queue wait,
metadata/hash, codec decode, gain reconstruction, colour/range conversion,
analysis, reduction, storage, upload and first draw. Check repeated opens and
paired 640/2560 requests. Record decoder output contracts and which colour
operations are already performed inside decoders, preventing double conversion.
Missing representative files stay explicit coverage gaps, not claimed passes.
Done: baseline and adapter contracts recorded here; one reusable focused
measurement/check driver, extending existing drivers where practical.

**Batch 0 findings (October 20, 2026; driver commit `ffbdc5f`).** Measurement/check driver:
`codebase/tests/performance/library-source-baseline.py`, using the sample
manifest beside it and optional `--synthetic`. It wraps existing import
boundaries and consumes the helper's existing queue/storage diagnostics;
production decoding, drawing, gates and allowances are unchanged. Run from
`codebase` with the .venv Python, `--manifest
tests/performance/library-source-samples.json --synthetic --repeats 3`.
Sources are copied without sidecars to disposable folders, verified by SHA-256,
and each round uses a fresh isolated cache/profile. Original sidecars are never
opened by the driver.

Protocol chosen before the final comparisons: 16 cases (8 existing files plus
8 generated cases), three repeats **each** of sequential 640 then 2560 and
simultaneously submitted 640/2560, followed by two cached opens in each round.
No other test work runs during the final timing collection. Helper startup,
sample generation/copying and preservation hashes are outside the timer; OS file
cache is uncontrolled. Report medians/ranges, use the existing 5% allowance for
matched comparisons, and do not infer p90 or first paint from three repeats.
The initial diagnostic established the concurrent-import risk; it is excluded
from the timing baseline.

Actual dispatch starts in `loader.load_image`. Its BMP branch shares the
bitmap decoder but BMP is **not** in the Library's supported-extension list;
this work adds no format. All supported non-RAW routes still enter
`SessionStore.prepare_session` from `library_live.develop_cpu`: full source
decode, full-source analysis, starting document/look, then independent linear
reductions for 2560/640 and existing half-float scene storage. The source hash
runs concurrently with import. No Bayer RAW bridge accepts these RGB arrays.

| Input / current decoder boundary | Already performed before the common loader boundary |
| --- | --- |
| Ordinary JPG/JPEG, PNG: Pillow | EXIF transpose, RGB conversion (8-bit even for a higher-precision bitmap), integer normalization; successful arbitrary ICC conversion to encoded sRGB via ImageCms. Failed ICC conversion keeps current classification/manual gate. Never apply the original ICC again to converted samples. |
| TIFF: tifffile first series/page | Layout/plane normalization, integer dtype-range division or float32 samples; profile **name classification**, not a general ICC transform. No TIFF orientation-tag transform in this route today. Preserve that observed behaviour; orientation/profile support beyond it is a separate gap, not silently “fixed” by the adapter. |
| EXR: OpenEXR.InputFile | Three separate FLOAT channel reads into HWC float32; top-level RGB, otherwise preferred layered Combined RGB. Dimensions come from dataWindow extents; displayWindow padding/origin placement is not performed. Chromaticities/colorInteropID resolve primaries or retain the conflict/missing-metadata gate. No transfer/gamut conversion yet. |
| Radiance HDR/PFM: imageio.v3 | Plugin read plus float32 cast, declared scene-linear/LINEAR; common colour detection resolves scene-linear to sRGB. Actual plugin availability/precision must be qualified; these are not proved by the cast. |
| JPEG XL: imagecodecs/libjxl, in process | Declared bit-depth normalization (not uint16 container maximum). Trusted HDR Finisher hfmd marker triggers transfer/primaries conversion to ACEScg; third-party values retain the manual interpretation gate. No external JXL process. Trusted SDR JXL currently returns ACEScg without a separate authored SDR reference; do not claim that rendition is already supplied. |
| Plain/direct AVIF: avifdec and PNG readback | Container metadata inspection, decoder transforms/YUV-to-RGB, full 16-bit PNG intermediary, then CICP transfer/primaries conversion to linear ACEScg. PQ/HLG decoded scale is 203 nits; unknown transfer rejects before irreversible interpretation. |
| ISO gain-map AVIF: avifgainmaputil + imagecodecs primary decode, or avifdec for reconstructed SDR | Tool reconstructs HDR at larger headroom to BT.2020/PQ PNG; base/alternate headroom decides whether SDR is the actual base or a reconstructed rendition. Both renditions are already converted (HDR ACEScg; SDR linear sRGB). Includes process launches and PNG/intermediary I/O; map formula is inside the tool. |
| Ultra HDR JPEG: Pillow + libultrahdr CLI | Pillow separately decodes/orients/ICC-converts the SDR base and applies sRGB EOTF. CLI reconstructs linear RGBA16f; decoder applies .18 scaling and chosen sRGB/BT.2020-to-ACEScg transform, then orientation. Returns linear-sRGB base plus HDR ACEScg at the 203-nit decoder scale. Base decoding may be duplicated inside libultrahdr. |
| HEIC/HEIF: pillow-heif/libheif | Primary image/high-precision RGB and NCLX/profile interpretation; plain/direct encoded samples still need common conversion. Apple auxiliary map is selected by type, normalized/resized and reconstructed in linear Display P3 using MakerNote headroom; SDR base is already linear sRGB. HDR P3-to-ACEScg remains in the common loader. Unreadable auxiliary data retains existing SDR-base/error metadata behaviour. |

Common loader work is still required after those boundaries: finite/range
handling, any remaining transfer/primaries conversion, decoder-to-project
reference-white ratio **once**, optional linear 1.0 diffuse-white to .18,
ordinary authored-SDR rendition formation, resolved-colour negative mapping,
and source analysis. Do not repeat EOTF, ICC, gain reconstruction or .18 scaling
on already converted decoder output. Interpretation overrides retain the
current loader order, including overrides of decoder-normalized sources;
changing that order is not authorised by Batch 0.

**Sample coverage.** Existing files in the manifest: ordinary
`DSC_3931_01.jpg` from the Zebras Crossing darktable folder; the local
DxO-neutral 16-bit PP TIFF (unknown-profile gate); the reported darktable
`A7R00619.exr` (BT.2020); fixture `linear_unconfirmed.exr` (manual gate);
LichtFeld's `alps_field_1k.hdr`; `samples/hdr_reference.avif` (inspection
confirms ISO gain map, **not** direct HDR); the reported urbanscape ISO AVIF;
and local `iphone-12-pro-HDR.heic`.
Generated 1536 x 1024 cases: EXIF orientation 6 / sRGB ICC JPEG, ordinary ICC
PNG, profiled uint16 TIFF, SDR JXL, 12-bit PQ HDR JXL with a 100-nit project
and an in-memory saved-grade recipe, Ultra HDR JPEG, float PFM with highlights,
and explicitly tagged 10-bit direct-PQ AVIF. Generated ramps cover route
contracts, not photographic quality/speed acceptance. The saved-grade recipe
does not read/write a real sidecar; saved-sidecar/reuse behaviour remains
covered by the existing fast Library tests.

**Baseline outcome.** Fourteen cases completed all three repeats in both modes
(84 rounds); HDR and PFM stopped on their first decode because this .venv has
no suitable imageio backend. The diagnostic deliberately exits nonzero for
these coverage gaps. It does not install a backend or claim a format pass.

- Reported EXR: sequential tier-pair median **7.765 s**, range 7.736–7.780 s;
  concurrent pair **11.705 s**, range 11.684–11.754 s. Sequential stage medians:
  decoder boundary 3.182 s, colour/range 2.814 s, analysis .714 s, reduction
  .718 s, storage .113 s. Hash 3.429 s overlaps import and is not extra wall time.
- Reported ISO AVIF: sequential tier-pair median **4.183 s**, range 4.159–4.201 s;
  concurrent pair **5.712 s**, range 5.678–5.732 s. Sequential stage medians:
  metadata .855 s, combined HDR tool work 1.732 s, colour/range .880 s,
  decoder residual .155 s, analysis .085 s, reduction .053 s, storage .192 s.
  These helper tier-pair timings are not matched comparisons with the earlier
  single-call diagnostic, and show no implementation speedup.
- Every successful sequential round imported **once** and reused the other tier;
  every simultaneous backend pair imported **twice**. Both imports hash, decode,
  analyse and reduce; per-tier storage locks prevent duplicate final writes,
  but act too late to prevent duplicated preparation. This is far beyond 5%
  noise on the two reported slow files. The page's path-keyed source scheduler
  normally merges demands before making HTTP calls, so this is a backend
  boundary finding, not proof that every normal page open duplicates work.
- All 84 cached reopen pairs hit the stored scenes, with **zero** preparation
  calls; the largest pair of helper metadata requests took 12.24 ms. That
  excludes page/HTTP transport and GPU drawing. Idle helper queue wait was
  at most 1.58 ms; it says nothing about a loaded Library or Grade pause.
- The Apple HEIC exercised actual auxiliary reconstruction and a separate SDR
  reference. Controlled HDR JXL recorded exactly one decoder-203/project-100
  normalization; orientation-6 JPEG returned transposed dimensions. No
  original, copied source or existing original sidecar was modified.

Remaining coverage gaps: no plain/direct-HDR HEIF sample, no real direct-HDR
AVIF or real SDR/HDR JXL speed sample (generated cases only), no third-party
unmarked JXL measurement, no real Ultra HDR JPEG (generated case only), no HLG
case, arbitrary non-sRGB ICC JPEG/PNG, TIFF orientation/float-profile cases,
and nonzero EXR windows/layered-channel conflicts in the measured set. The
unconfirmed EXR and ProPhoto TIFF exercise unresolved interpretation, not a
claim that their final colour is qualified. HDR/PFM require a working decoder
backend before precision/colour can be qualified. Photographic PNG speed,
saved-sidecar presentation, colour agreement and first-paint qualification
remain for the relevant implementation/acceptance batches.


**Timing boundaries and limits.** Each run records helper queue wait, parallel
file hash, decoder/metadata boundaries, colour/range work, analysis, reductions
and existing storage events; also import/AVIF substage stopwatches and source
facts. Nested wrapper times are excluded from their parent's exclusive time;
inclusive containers are retained separately. Concurrent work totals and
parallel hash time must **not** be added to request wall time. “Codec combined”
includes embedded metadata, layout/range operations and uninstrumented codec
work. External tool phases combine codec/reconstruction, launch and
intermediary I/O; pure codec time and pure gain maths are **unmeasured** inside
them. AVIF's existing reconstruction stopwatch also includes PNG readback.
Storage includes half conversion, serialization, bookkeeping and trim dispatch.

The existing page stopwatch separates draw dispatch queue, pixel fetch,
renderer setup and completed `picture_drawn` (after GPU completion). Its
`first` flag is renderer-global, not request-to-first-paint. Pixel fetch
includes backend stored-scene read/conversion/transport; writeTexture upload
has no separate timer. HTTP/page source-queue wait, standalone upload,
request-to-first-visible/final paint, loaded-grid behaviour, Explorer comparison
and peak RAM/GPU use are **unmeasured in this baseline**. No first/final picture
speed goal or colour/perceptual agreement is claimed from these source-only
runs. No GPU check directly covers this diagnostic-only change. Validation: fast
Node suite 539 passed; fast .venv Python suite 2,277 passed / 3 skipped; the
new driver's source/sidecar-preservation check passed separately. No GPU
implementation, push or installer work was performed.

**Batch 1 adapter contract.**

- A decoded plane/band descriptor carries HWC RGB dimensions, selected channels,
  row stride, dtype, effective bits, integer code range, alpha/channel policy
  and ownership/lifetime. Keep float/negative values until the existing finite
  and negative-colour boundary; do not prematurely quantize to stored half.
  Preserve decoder precision, data/display-window bounds and origin, and
  actual EXIF/container orientation application status.
- Carry original and effective primaries/transfer, raw ICC or resolved profile
  plus whether CPU ICC was applied, confidence/conflicts/manual overrides,
  decoder-normalized flag, decoder/project reference white, linear-reference
  convention and explicit applied-operation flags. An ACEScg/LINEAR payload
  bypasses transfer/gamut work already done. Arbitrary ICC stays CPU-owned
  unless safely representable; failed/unknown interpretation keeps its gate.
- Optional authored SDR/base/map planes carry their own colour/range,
  dimensions/orientation, exact-base flag and gain-family metadata. ISO
  direction/headrooms/gamma/offsets, Ultra HDR's formula and Apple headroom
  remain separate. Current final-scene decoders can bridge initially; exposing
  raw base/map planes is later adapter work, not a capability proved here.
- Identity includes source path/stat/fingerprint, decoder/colour version and
  `library_live.recipe` (interpretation, white and RAW settings as today).
  Finishing edits change the document/draw identity only. Merge in-flight work
  by **source recipe across tiers**, with shared cancellation/priority demand,
  before codec allocation/upload; recheck source and recipe before publishing.
- One full-source measurement result supplies existing analysis, luminance facts,
  starting adjustments and default document. One preparation produces both
  existing scene tiers (HDR ACEScg, optional SDR linear sRGB); keep selected
  native detail as the only full-size exception. Reduce only in linear light.
  Use bounded transfers and existing broker/memory/cache limits; release
  intermediates before reservations, yield to Grade/delivery and retain explicit
  unsupported/unavailable/lost-GPU fallback reasons and recovery.

**Batch 1 outcome (October 20).** The Library-only RGB adapter retains the
existing Pillow orientation/ICC boundary and its decoded uint8 HWC RGB
precision, layout, profile/transfer state, reference white and stat/fingerprint
identity. Arbitrary ICC conversion stays on the CPU. Encoded RGB travels packed
to the GPU; sRGB transfer, colour matrices, negative-colour handling, full-source
peaks/strided quantiles and linear reduction reuse the RAW preparation maths.
The authored SDR rendition has its own planes and full-source peak. Equivalent
analysis, starting adjustments and default documents are supplied directly,
without a full Grade session. Grade's default loader, RAW numerical development,
export, Proof, shaders, tolerances and all cache/memory allowances are unchanged.

Backend ownership now coalesces a source recipe across 640/2560 before decode,
with priority promotion, cancellation, short-lived ownership/heartbeat and
source/recipe/epoch checks before publication. The CPU helper also coalesces
concurrent preparations. Native remains separate and selected-only; finishing
changes keep the scene identity. Transient native cache hits now reuse their
existing bounded storage. Shared background admission yields and resumes on
preemption; unsupported operations report their reason and retain CPU fallback.

**Matched measurement.** `tests/library-rgb-source.js` exercises the actual
GPU route (the original baseline driver remains CPU instrumentation). Protocol
chosen before comparisons: the 2000 × 1168 photographic `DSC_3931_01.jpg` and
its decoded lossless PNG, three fresh-scene repeats per route, alternating
CPU/GPU order, warm processes/pipelines, uncontrolled Windows file cache.
Concurrent 640/2560 requests through the same page scheduler measure source
preparation through stored metadata, including transport/storage. Median JPEG
fell **844 → 654 ms (22.5%)**, PNG **864 → 684 ms (20.8%)**, beyond the retained
5% noise allowance. GPU stage medians across these formats: upload 20 ms,
colour/measurements 104 ms, reduction 59–63 ms, readback 63–68 ms; measured serial
queue wait was 0 ms. Decoder boundary was 41/77 ms (JPEG/PNG), CPU baseline
colour/analysis about 400 ms. Stage fields have different/overlapping boundaries
and must not be summed into a pipeline total. Broker/backend queue wait,
metadata/hash/storage/HTTP individually, process peak RAM, first/final draw and
first paint remain unmeasured; these medians are neither p90 nor first-paint
claims. An earlier comparison overlapped pytest and was discarded.

**Validation.** Fast checks: 539 Node, 2,285 Python passed (3 skipped), plus
seven focused adapter/API checks after helper heartbeat renewal. Registered
Electron drivers `library-rgb-source.js` and `library-rgb-native.js` run serially
at 2560 × 1440. Source checks pass for photographic JPEG/PNG, saved rotation,
locals and Denoise, both scene sizes, native scene pixels/reuse and forced
preemption without CPU fallback. Finished HDR/SDR agreement retains the existing
mean < 1 / p99.9 ≤ 3 perceptual limits (worst HDR mean 0.075, p99.9 0.351).
Photographic JPEG/PNG grid cells, saved-grade native detail, selected-only reuse,
CPU picture fallback and automatic hardware recovery pass. Native resident
resources were 238–240 MB against the unchanged 2 GiB budget. The native driver
now reloads between Compare and recovery to avoid an asynchronous view change
that invalidated its earlier grid assertion.
Default documents also match Grade at a non-default 100-nit white. Backend tests
cover concurrent tiers, cancellation, promotion, invalidation and stale
publication. Original sources/sidecars are preserved; the pre-existing EXR
sidecar remains untouched with its recorded SHA-256.

**Remaining limits/readiness.** Only ordinary JPEG/PNG using the existing
8-bit Pillow RGB boundary is qualified. Gain-map JPEG, interpretation overrides,
unresolved profiles and unavailable/failed GPU operations retain explicit CPU
routes; no later-format adapter has started. High-precision/windowed/linear
inputs must extend the contract rather than pass through this packed 8-bit
entry point. Batch 2 can build on the shared preparation/ownership foundation;
its real-format and HDR/PFM decoder gaps from Batch 0 remain its own work. The
existing open native perceptual comparison for scale-dependent effects and
Library p90/first-paint targets remain open.

**Batch 1 — shared RGB GPU preparation, ordinary JPEG/PNG first.** Add the
Library adapter contract (sample layout/precision, source dimensions,
orientation, colour/transfer/profile, reference white, optional SDR/base/map,
source identity). Implement the supported common transforms, full-source
measurements and linear reduction under background admission. Start with
standard JPEG and PNG, exercising both SDR preservation and scene reuse.
Retain CPU ICC interpretation where an arbitrary profile cannot safely be
represented by the shared GPU operations; report that boundary rather than
silently replacing it with sRGB. Store the same scene/document products as
today without constructing an unnecessary full Grade session where equivalent
metadata and measurements can be supplied directly.
Done: real JPEG/PNG cells, saved-grade redraws, both scene sizes and selected
native detail work; focused colour, identity, memory and recovery checks pass.

**Batch 2 outcome (October 20).** Qualified EXR/TIFF cases now use float32
samples with shared GPU transfer/matrix preparation, negative-colour handling,
full-source measurements and linear reduction, without an 8-bit intermediate.
The existing TIFF decoder owns integer normalization and profile classification;
its orientation tag remains unapplied, matching Grade. Planar TIFF is interleaved
once for transport. The contract retains source integer range/precision, EXR
channel types/selected layers, data/display windows and origin, chromaticities,
conflicts, original interpretation and applied-operation flags. Overrides retain
the loader's order, including 1.0 diffuse-white scaling. Supported transfers are
linear, sRGB and BT.709; PQ/HLG and unresolved/arbitrary profiles retain explicit
CPU routes and interpretation gates. HDR/PFM plumbing is **not qualified**.

The baseline driver's new `--exr-read-profile` compared three alternating
separate/together reads on the real darktable EXR, checking samples exactly.
OpenEXR 3.5's combined call reduced median binding time **2.92 to 1.02 s**.
This includes channel buffers/compressed-block work; pure decompression is not
isolated. Only Library opts into this call and records channel/interleave times;
Grade retains its separate-channel calls. Combined reads temporarily hold three
channel byte buffers plus the interleaved image, releasing the byte buffers
before subsequent preparation. Process peak memory was not measured.

Preparation still supplies equivalent analysis/default documents and both
640/2560 scenes without a Grade session. Selected-only native detail shares the
route. Linear inputs use three planes; authored SDR TIFF keeps its own three
reference planes. Uploads use 128-row bands. Existing source-recipe coalescing,
identity/publication checks, priority, cancellation, preemption, visible CPU
fallback and hardware recovery remain shared. Recipe v2 refreshes older scenes
once. No Grade/export/Proof numerical default, pinned shader, tolerance or
memory/cache allowance changed.

**Matched measurement.** The registered `library-precision-source.js` exercises
the actual GPU route on disposable copies of darktable `A7R00619.exr`
(7980 × 5320) and Lightroom `DJI_0072-Lightroom-reference.tif` (float32,
8000 × 6000). Protocol chosen before comparison: three fresh-scene repeats per
route, alternating CPU/GPU order, warm processes/pipelines, uncontrolled Windows
file cache, concurrent 640/2560 requests through stored metadata. With combined
EXR reads, median preparation fell **9.80 to 5.75 s (41.3%)** for EXR and
**7.59 to 5.11 s (32.7%)** for TIFF, beyond the retained 5% noise allowance.
These supersede the earlier separate-read EXR measurement.

GPU-route stage medians (EXR/TIFF): decoder plus metadata 3.30/2.72 s,
upload 369/378 ms, colour/measurements 240/226 ms, reduction 132/60 ms,
readback 52/45 ms, page serial queue 0/0.1 ms. Decode includes container/layout
work. Adapter finite sanitization, framing and HTTP sit inside broader source
fetch time; GPU stages include scheduler checks, and reduction excludes timed
readback. CPU quantiles use the GPU's bounded full-source sample. Nested source
fetch/GPU timers overlap these stages and must not be summed. Backend queueing,
hash/storage/HTTP individually, first paint, p90 and process peak RAM/GPU memory
remain unmeasured. Five-second preparation still misses the about-two-second
aspiration.

**Validation.** Fast checks: 539 Node / 2,291 Python passed, 3 Python skipped.
Two registered focused Electron checks run serially at 2560 × 1440:
`library-precision-source.js` and `library-precision-rendition.js` (reusing the
JPEG/PNG driver). They pass real EXR/float TIFF scene-half agreement, both
finished lanes, full-source starting peaks, concurrent tiers, cached reopen,
selected native reuse, reservation bounds and forced preemption without CPU
fallback. Real-file worst SDR mean/p99.9: 0.2913/0.4544; HDR: 0.0254/0.0685,
within unchanged mean < 1 / p99.9 ≤ 3. Additional cases cover photographic
uint16 TIFF, signed layered EXR with offset windows, saved rotation/locals/
Denoise, BT.709 override, 100-nit white with 1.0 diffuse white and JPEG/PNG
regression. Backend checks cover planar/integer/float samples, layer/window
preservation, interpretation gates/order and equivalent starting documents.
Originals/sidecars are preserved; the pre-existing Blender sidecar retains
SHA-256 `69F50AE23B96291A8F3D98CFAF1AAA571C658831AA939F6C9BD54E7E855ADC29`.

**Remaining blocker/readiness.** The existing imageio v3 route raises
`OSError: Could not find a backend ... with iomode r` on real `alps_field_1k.hdr`
and a valid signed little-endian float PFM. Installed requirements include
imageio but no capable optional backend; imageio suggests its OpenCV extra for
HDR and PyAV/OpenCV for PFM. No backend was added or substituted, so HDR/PFM
precision/colour remain untested and these formats are not marked complete.
Unknown/conflicting EXR primaries and ROMM/ProPhoto TIFF retain manual review;
unsupported transfers retain CPU normalization. Batch 3 can start independently
on the shared precision/ownership foundation; HDR/PFM qualification remains
open Batch 2 work. No later format batch started.

**Batch 2 — EXR, HDR/PFM and TIFF adapters.** Feed existing decoded linear or
encoded high-precision samples into batch 1. Profile EXR channel reads and
compressed-block work; investigate reading RGB together if the bindings and
measured cost justify it. Preserve selected layered channels, data-window
handling, chromaticities/conflicts and manual overrides. TIFF retains its
existing bit depth, float, profile and orientation semantics. Avoid converting
whole full-size arrays to repeated intermediate copies before GPU upload.
Built for qualified EXR/TIFF cases; decoder and GPU times are separated.
HDR/PFM remain blocked as above; unsupported cases retain explicit reasons.

**Batch 3 outcome (October 20).** Library-only JXL/plain AVIF/HEIF adapters
separate normalized-range float32 RGB from colour preparation. JXL retains
in-process libjxl, declared integer/float precision, trusted marker and
third-party interpretation gate. HEIF keeps primary selection, high-precision
normalization and profile/NCLX interpretation. Decoder-owned orientation is
not repeated; unexposed original JXL/HEIF orientation values are recorded as
unknown. ICC and HEIF auxiliary data retain explicit CPU routes; gain-map AVIF
and Apple HEIF cannot publish a plain-primary final scene. Reconstruction has
not started. Grade/export/Proof defaults and numerical paths, tolerances and
all allowances remain unchanged. Recipe v3 refreshes older scenes once.

Library-only GPU operations add PQ and vector HLG, including its
luminance-dependent OOTF and project reference white. Linear/sRGB/BT.709 reuse
the shared path, preserving Grade's BT.2020 curve for sRGB-labelled BT.2020.
JXL/AVIF overrides still act **after** original decoder normalization at 203 nits:
that first transform stays CPU-owned on override cases, followed by GPU
preparation. Otherwise transfer/matrix/reference scale is applied once on the
GPU. Finite/negative boundaries, authored HEIF SDR, equivalent full-source
analysis/documents, both tiers and selected-only native detail are retained.
JXL/plain AVIF keep Grade's existing lack of a separate authored SDR rendition.
No high-precision buffer uses packed uint8. Coalescing, priority, cancellation,
publication, preemption and hardware recovery retain the existing machinery.

**AVIF decision/measurement.** Installed avifdec 1.4.1 exposes PNG/JPEG/Y4M,
not raw RGB; the installed imagecodecs binding has no output-depth option.
`library-source-baseline.py --avif-decode-profile FILE --repeats 3` compares
three alternating repeats of default PNG, uncompressed PNG and in-process RGB
on libavif's photographic cosmos PQ and Kodak SDR examples. Launch-only version
probes measured 181–188 ms, separately, not subtracted from decoding. In-process
RGB took 7–8 ms but changed encoded samples (mean differences .00024/.00118),
so Library retains **16-bit PNG**, with compression disabled. Samples match
exactly; tool-stage medians fell 334→209 ms for PQ and 270→209 ms for SDR.
PNG read/decode/float-normalization was about 6 versus 9–10 ms. Tool time includes
launch, codec/YUV work and PNG write; pure decode/write are not isolated.
Temporary files grow but are not persistent cache products. Official fixture
URLs, revisions and SHA-256 values are pinned in `library_codec_samples.py`.

**Actual-route comparison.** Protocol chosen before comparison: three fresh-scene
repeats per route, alternating CPU/GPU order, warm processes, uncontrolled
Windows file cache, concurrent 640/2560 through stored metadata. Inputs: a
2000×1168 photographic lossless JXL made from `DSC_3931_01.jpg`, real 1024×428
cosmos direct-PQ AVIF and real 1280×854 libheif example HEIF. Medians fell
**716→538 ms (24.9%) JXL**, **797→636 ms (20.3%) AVIF**, **432→387 ms (10.4%) HEIF**,
beyond the retained 5% noise allowance. GPU-route decode/metadata medians were
136/401/52 ms, upload 26/10/15 ms, colour/measurements 53/21/39 ms, reduction
30/28/29 ms and readback 38/30/37 ms (JXL/AVIF/HEIF). Page serial-queue median
was zero. Nested fetch/decode/GPU timers overlap and must not be summed.
Backend queueing, individual hash/storage/HTTP, first paint/final draw, p90 and
process peak memory remain unmeasured; Library latency targets are not qualified.

**Validation/limits.** Node fast checks: 539 passed. Full Python: 2,300 passed,
3 skipped, one failure in the unchanged
`test_source_ownership_merges_tiers_promotes_and_rejects_stale_publication`:
its immediate PNG rewrite was not rejected. The source-ownership/key code
and this test are unchanged; this unrelated failure was left open. Final
focused Library Python checks: 23 passed, the same ownership failure.
Registered source/native
Electron drivers ran serially at 2560×1440. Scene-half precision, full-source
starting peaks, both tiers, cached identity, native reuse and forced preemption
pass. Photographic JXL/AVIF and controlled tagged HEIF pass finished HDR/SDR
mean <1 / p99.9 ≤3 (worst qualifying SDR .207/.986; HDR .078/.351).
Controlled cases cover 12-bit PQ, HLG JXL/AVIF/HEIF, signed float16/float32
linear JXL, linear AVIF, 100-nit white, 1.0 diffuse white, post-decoder overrides,
unmarked JXL resolution and saved rotation/locals/Denoise. Real ISO AVIF/Apple
HEIF adapter rejection is checked. Photographic JXL/HEIF cells, selected-only
native reuse, saved grades, visible fallback and automatic recovery pass;
native resident resources were 238–240 MB within the unchanged 2 GiB budget.

The source driver retains one **existing HEIF SDR rendering failure**:
untagged real example HEIF measures mean **1.669**, p99.9 **3.119**. Its stored
scenes and HDR pass. `--only example.heic --cpu-reference` reproduces the same
SDR failure through unchanged CPU preparation. No renderer/tolerance was changed
to accept it. Results: `output/library-rgb-source/1792496524591` (GPU) and
`1792496676588` (CPU oracle); the source driver exits failed for this issue.
Native camera direct-HDR HEIF, third-party photographic HDR JXL and real codec
orientation cases remain coverage gaps; controlled files cover transfer and
precision. Original sources/sidecars, including the Blender sidecar hash, are
preserved. HDR/PFM's missing-backend blocker remains open Batch 2 work.

**Batch 4 readiness.** Shared samples/metadata/ownership and GPU transfers are
ready. A qualified base/map interface is still required: in-process primary
decode was not adopted, and Batch 3 supplies neither map access nor
reconstruction. Batch 4 may start with that codec-boundary investigation.

**Batch 3 — JPEG XL and plain/direct-HDR AVIF/HEIF adapters.** Separate encoded
sample decode from colour preparation where current decoders combine them.
Use the in-process JPEG XL decode already present. Preserve its declared
precision and interpretation gate. For AVIF, measure external process and PNG
intermediate costs; select an in-process or raw-buffer path only after checking
the bundled decoder's capabilities and validating the same metadata/precision.
HEIF retains its current primary-image and colour metadata interpretation.
Do not route gain-map files through a plain primary-image final scene.
Done: SDR, PQ/HLG and supported linear cases share GPU preparation, reference
white is applied once, and cache/native/saved-grade behaviour agrees.

**Batch 4 outcome (October 20) — GPU implementation deferred.** No new
base/map interface was adopted by the app. ISO AVIF retains full-resolution CPU
reconstruction and both renditions; GPU finishing is not GPU reconstruction.
Grade/export/Proof, interpretation order, numerical boundaries, reference white,
scheduling and all allowances are unchanged. Batch 5 has not started and is not
ready to reuse a shared gain-map reconstruction foundation.

**Installed-interface limits.** Bundled avifgainmaputil/avifdec use libavif 1.4.1.
imagecodecs/libavif 1.4.2 exposes primary/frame RGB through
`avif_decode(data, index=None, numthreads=None, out=None)`, without auxiliary-map
selection or structured ISO metadata. `index=1` rejects both real inputs as out
of frame range. pillow-heif 1.8.0/libheif 1.23.4 has an auxiliary accessor, but
no installed AVIF decoder (HEVC only). Pillow's libavif 1.3.0 binding exposes
only `get_info`/`get_frame`, returning primary RGB without map access.

The CLI **can** extract maps as 16-bit RGB PNG and print rational metadata.
Follow-up native testing found `printmetadata` repeats channel R for G/B
([`FormatFractions`](https://github.com/AOMediaCodec/libavif/blob/v1.4.1/apps/avifgainmaputil/printmetadata_command.cc)
passes the same pointer three times). Both real files have
unequal stored min/max channels, so that text is unsafe as reconstruction input.
The existing CPU reconstruction itself uses the correct structured metadata.
Urbanscape has a 1433×1920 limited-range 10-bit YUV420 base and 717×960 full-range
10-bit YUV444 map; the reference has a 1024×576 8-bit base and same-size 10-bit
map. Both have sRGB base, BT.2020/PQ alternate and no orientation transform.
[libavif reconstruction](https://github.com/AOMediaCodec/libavif/blob/v1.4.1/src/gainmap.c)
scales map **YUV to base dimensions before RGB conversion**, at native map depth.
[Extraction](https://github.com/AOMediaCodec/libavif/blob/v1.4.1/apps/avifgainmaputil/extractgainmap_command.cc)
exports original-size RGB instead. Resizing that PNG changes the operation order
and quantization. Y4M writes raw YUV without re-encoding, but its CLI output
does not supply the complete structured reconstruction contract. The follow-up
bridge below resolves native sample access for the tested files; it does not
yet qualify Library GPU reconstruction.

Remaining implementation work: productionise the diagnostic native interface
below, including packaging, cancellation, bounded transport and fail-closed
interpretation gates; then implement and validate Library GPU ISO maths.
Preserve the existing imagecodecs-authored SDR when the base is SDR; HDR-base inputs currently
reconstruct SDR through encoded AVIF and avifdec. Bypassing those quantization
stages needs validation too. The existing display-oriented metadata parser was
left unchanged; the text diagnostic retains what the CLI prints and rejects
missing fields, zero denominators and nonpositive gamma. It cannot recover the
G/B values hidden by the CLI reporting bug.

**Measurements.** Extended the registered `library-source-baseline.py` with
`--iso-gainmap-profile FILE`. Protocol chosen before collection: tracked reference,
real urbanscape and a disposable quality-100 `swapbase` reference, three repeats each,
alternating existing CPU decode and map extraction order, uncontrolled Windows
file cache. Copies exclude sidecars; original source/sidecar hashes are checked.
Reversed-case creation is outside the timer. This is a codec probe, **not a new
Library route comparison or a measured improvement**; the 5% allowance remains.

Existing decoder medians: reference **1.62 s**, urbanscape **3.53 s**, reversed
HDR-base **3.33 s**. Urbanscape nested medians: inspection 457 ms, HDR tool/PNG
readback 1,798 ms, SDR decode 63 ms, metadata process 417 ms, colour 783 ms.
Reversed SDR reconstruction/intermediates took 1,788 ms. Map-only PNG extraction
and read medians were 492/598/497 ms; they omit primary decode/reconstruction and
are not competing-route timings. Tool timers combine launch, decode, maths and
intermediate I/O; pure decode/gain maths are unisolated. Nested medians are not
additive. Queueing, Library analysis/reduction, upload/readback, first paint,
p90 and peak process memory are unmeasured here. The tool/intermediate floor
remains.

**Validation.** Diagnostic tests cover exact rational precision, both headroom
directions, unequal gamma/offset channels and signed min/max; these validate
parsing, not GPU maths. The real reference probe checks uint16 map output,
both finite CPU renditions, 203-nit white, preservation and adapter rejection.
Registered `library-iso-source.js` ran through Electron at 2560×1440: both real
files, reversed HDR-base and a disposable saved-grade urbanscape pass stored
scene-half agreement, full-source starting peaks, concurrent 640/2560, cached
native identity/reuse and live HDR/SDR colour. Explicit CPU reconstruction
reasons are verified with GPU preparation enabled. Worst finished mean/p99.9
**0.075/0.186**, within unchanged mean <1 / p99.9 ≤3. No preemption/recovery
claim is made for a new route. Fast checks: **539 Node / 2,304 Python passed,
3 Python skipped**. The unchanged ownership failure did not reproduce in this
run; it was not repaired. The known HEIF SDR driver failure was not rerun.

Photographic non-unit gamma/unequal offsets, 12-bit maps, ISO orientation/ICC,
and new-route full-source/default-document equivalence remain untested. No GPU
reconstruction was enabled. Batch 2 blockers and the known Batch 3 failures were
not investigated or repaired. Originals/sidecars are preserved, including the
Blender sidecar SHA-256 recorded above.

**Follow-up feasibility investigation (October 20).** A direct interface is
possible; absence from installed Python bindings is not a codec impossibility.
Built the isolated `tools/iso-gainmap-probe` using libavif v1.4.1
(commit `6543b22b5bc706c53f038a16fe515f921556d9b3`), libyuv 1922
(`6067afde563c3946eebd94f146b3824ab7a97a9c`) and decode-only AOM v3.13.2,
MSVC Release, generic AOM CPU. Public APIs expose native-depth RGBA base/map,
full-base-size map after native YUV scaling, exact per-channel fractions,
colour/range/depth/dimensions, ICC presence and unapplied transform flags.
This is an investigation executable, not bundled or called by the app.

Registered `tests/performance/library-iso-native.py`: same three matched files,
three alternating CPU/probe repeats chosen before collection, unchanged 5%
noise allowance, copies and source/sidecar hashes. All nine native HDR RGB16
buffers matched existing tool PNG samples **exactly**; all nine native primary
RGB buffers matched the installed imagecodecs primary **exactly**. The real
half-size map case therefore has a viable full-resolution decode boundary.
HDR compatibility includes native-depth RGB gain maths, RGB→10-bit YUV→16-bit
RGB, not merely a 16-bit reconstruction buffer. The existing route takes HDR
headroom from inspect's **two-decimal** display; the probe preserves it rather
than silently changing to exact headroom. These compatibility stages matter
when designing the GPU path, including output chroma subsampling.

New CPU decoder medians: reference **1.67 s**, urbanscape **3.85 s**, reversed
**3.36 s**. Diagnostic native totals were **0.73/2.45/0.65 s**, respectively,
but are **not a speedup comparison**: they include raw extraction/writes and
CPU HDR reconstruction, omit reversed SDR reconstruction and working-colour
conversion, and do not run Library analysis/reduction or GPU work. Urbanscape
native decode alone was about **1.33 s**, HDR maths/output conversions about
**0.62 s**; these nested stages exclude process launch and overlap the total.
No actual new Library route, GPU improvement, first paint, p90 or peak process
memory was measured. The decoder/intermediate floor is still material.

Reproduce with CMake/VS2022: build pinned libavif with shared libraries,
`AVIF_CODEC_AOM=LOCAL`, `AVIF_CODEC_AOM_ENCODE=OFF`, `AVIF_LIBYUV=LOCAL`,
`AOM_TARGET_CPU=generic`, apps/tests off; build `tools/iso-gainmap-probe` with
`AVIF_SOURCE` pointing to that checkout and `AVIF_IMPORT_LIBRARY` to its Release
`avif.lib`, and place its `avif.dll` beside the probe. Run the registered Python
driver with `--probe EXE --source FILE --repeats 3`. Build/downloads and all
sample-generation work are outside measured boundaries.

Follow-up validation: native Release build and all nine matched precision
comparisons completed; **539 Node / 2,304 Python passed, 3 Python skipped**.
No GPU driver covers this isolated codec probe; no app/GPU code changed, so
no additional GPU sweep was run. Earlier focused Electron findings stand.

**Decision (Steve, October 20): defer Batch 4 GPU implementation; keep the
findings and reproducible probe.** The bridge is feasible, but GPU support is
still a substantial separate implementation: decoder distribution, exact ISO
maths plus compatibility quantization, both lanes, transport/memory ownership,
and the full Library validation matrix. The maintenance cost is not yet
justified by a measured Library speed gain.
Do not equate the partial prototype's timings with user-visible gain.
The investigation is complete for this feasibility decision; Batch 4 production
implementation remains incomplete. HDR-base SDR compatibility, controlled
non-unit gamma/unequal offsets, 12-bit/ICC/orientation and all new-route GPU
analysis, reuse/preemption/recovery checks remain unqualified. Existing app
routes are unchanged. Batch 5 can be scoped independently, but cannot inherit
an implemented/qualified ISO GPU reconstruction foundation.

**Closeout and next priority (Steve, October 20).** Preserve the committed
ordinary RGB, EXR/TIFF and JXL/plain AVIF/HEIF gains from Batches 1-3, together
with their recorded exclusions and known failures. Keep ISO AVIF's existing CPU
reconstruction and the reproducible diagnostic probe. No rollback, new ISO GPU
route or continuation into Batches 5-7 is authorised by this closeout. Those
batches below remain shelved proposals, not the current execution order. The
unfinished HDR/PFM, gain-map and mixed-format acceptance work remains open;
this closeout does not claim all formats or cold-folder targets are met.

**HDR keyboard toggle (October 21, built).** H now invokes the HDR button's
click action. A previous mouse click could leave that button focused; pressing
H switched Chromium to keyboard focus styling and painted a purple ring separate
from the HDR state. The shortcut clears that leftover focus and ignores key
repeat, so a press toggles once. Ordinary Tab/keyboard focus remains visible.
The focused Electron DNG check verifies click/H state, repeat and focus behavior
at 2560 x 1440. Required fast checks: 549 Node passed; Python 2,328 passed,
3 skipped, with the unchanged intermittent source-ownership failure described
below. No installer or push.

**Source pause and Activity scroll fix (October 22, built).** Once submitted,
source development and CPU picture fallback retain their request while Grade
pauses the helper. Queued work waits at the existing pause gate; work already
executing can finish. Brief pauses no longer cancel the import and restart it
from the beginning. Leaving the photo or invalidating the source still cancels
its work. Activity refreshes preserve the scroll position and restore keyboard
focus without scrolling a focused action into view.

**Activity reporting (October 21, built).** Activity now lists filenames and
actual waiting/running source, cache-check and drawing jobs, including backend
RAW development and individual DNG brightness/distortion corrections. Resource
waits are distinct from execution; cancelled native work stays visible as
stopping until it returns. Reading Pause retains its existing gate and explains
that work already executing can still finish. Existing export, indexing,
settings-writing and file-command sections remain. No estimated percentages.
Stage transitions include source paths, elapsed stage time and completion,
cancellation or failure in Library diagnostics; failed frontend jobs retain a
bounded file/reason entry until retried. Frontend/backend rows for one file are
combined. No decoder isolation, extra source slots or pixel changes.

Validation: required fast suites passed 548 Node / 2,305 Python (3 skipped),
plus the focused backend Activity test added afterwards (25 RGB/source checks).
The live-grid Electron check passed at 2560 x 1440: cold drawing, cached reuse,
selected-photo display and GPU recovery. This is Activity/route validation,
not a matched DNG speed measurement. Native decoders remain cooperatively
cancellable only at the existing checkpoints.

**Library GPU WarpRectilinear (October 21, initial delivery).** The combined
GainMap/linear-DNG entry below supersedes this first delivery's CPU GainMap and
linear-DNG exclusions. A separate Library-only
bridge now accepts mosaiced DNGs whose supported applied OpcodeList3 operations
are CPU GainMaps followed by exactly one final WarpRectilinear (one or three
coefficient planes, supported opcode version, validated crop and optical centre).
Eligibility comes from the operations, never the camera name. Linear DNG,
interpretation overrides, unsupported order/operations and incompatible decoder
geometry retain the existing route. The blanket gate on other DNGs remains.

The existing verified LibRaw/AHD CPU decode and CPU GainMap run once. Camera RGB
is uploaded once; a fused GPU pass samples WarpRectilinear before the DNG colour
matrix/baseline exposure, existing brightness calibration, gamut handling and
full-source analysis. Existing reduction and live SDR/HDR drawing follow. There
is no CPU warp on the eligible route and no full-resolution warped readback.
The sampler retains integer pixel centres, optical-centre/radius calculation,
radial/tangential coefficients, a=-0.75 bicubic weights and clamped edges. Crop,
XMP crop and all current CPU orientation behaviours are retained. Mandatory
correction audit order and the duplicate-Lensfun guard are preserved. Grade,
export and Proof keep their existing pixels. Shared broker leases, Grade
preemption, delivery fairness, source concurrency and GPU memory budgets are
unchanged; allocation/device/eligibility failures use the existing CPU fallback.

**Measured result and limits.** Serial Electron checks used a 2560 x 1440 window,
disposable profiles/caches and copies of the 48 MP DJI_0071.DNG plus a small PNG.
Three clean matched CPU/GPU folder pairs (alternating route order in the first
two, then a fresh-profile confirmation) finished at 97.3–98.5 s CPU versus
7.95–8.11 s GPU; medians 97.44 s and 8.05 s. First picture was the small PNG at
0.10–0.18 s CPU / 0.096–0.123 s GPU, not the finished DNG. The finished-picture
improvement is well outside the existing 5% timing noise allowance. One earlier
pair overlapping fast checks is excluded from timing claims. OS disk caches
were uncontrolled: these are cold application scenes, not disk-cold results,
and no speedup is calculated against yesterday's cProfile result.

In the final pair, whole-photo source preparation was 96.93 s CPU / 7.58 s GPU
(before final cache publication/drawing). CPU WarpRectilinear alone was 88.82 s.
The fused GPU warp + colour + analysis pass was 0.253 s (0.223–0.383 s across
clean runs); this is explicitly not an isolated GPU warp-only timer. CPU
GainMap remained 4.77 s and CPU decode/metadata about 1.22 s. No estimated
percentages or synthetic progress timers are added. The real Activity modal
identified warp.DNG while CPU/GPU work ran, with an independent UI heartbeat.
The two-second finished-picture goal is still unmet; these results qualify
this sample, not mixed-format p90 or an entire camera population.

Finished live 640-pixel SDR/HDR pictures agreed with the correct CPU route:
worst mean 0.00068 and p99.9 0.0661, including a separate eight-pixel border
check, inside the unchanged mean <1.0 / p99.9 <=3.0 limits. Both 640 and 2560
source tiers were prepared and reused. Sixteen native-resolution synthetic
GPU probes cover one/three coefficient planes, off-centre and tangential warp,
clamped edges, crop and all eight orientations: worst linear sample error
0.0000045, below the proposed-before-measuring 0.0001 geometry allowance.
These are behaviour/pixel checks, not shader-text checks. The focused
`library-dng-warp.js` driver is registered for Library release selection.

Validation: required fast checks: 549 Node passed; Python 2,323 passed,
3 skipped, with the previously documented intermittent
`test_source_ownership_merges_tiers_promotes_and_rejects_stale_publication`
failure reproduced (rewritten source was not rejected). It is unchanged and
was not investigated. New DNG/stage/invalidation checks passed separately
(19 focused checks), including the preparation invalidation test added after
the full-suite collection. Coverage includes eligibility, mandatory ordering,
no CPU warp, coordinate/crop and preparation stage/cancellation behavior. The focused
live-grid check and DNG check ran serially at 2560 x 1440, comfortably within
the 30-minute slow-test allowance. GainMap GPU work, linear DNG, embedded
previews, more source concurrency and separate decoder processes remain
outside this change. Original photos/sidecars and the owner's cache were
preserved; no installer or push.

**Library GPU GainMap and linear DNG (October 21).** Steve grouped these
follow-ups so they share one focused validation batch. The original DJI samples
have mandatory GainMap then WarpRectilinear; the inspected DxO linear DNGs and
merged DJI HDR DNG have no GainMap. Eligibility follows declared supported
operations, not producer names.

The mosaic bridge now uploads the CPU AHD camera samples without CPU GainMap.
An in-place GPU pass applies the supported maps in opcode order before the
existing warp pass. Pixel-centre normalization, bilinear grid interpolation,
absolute channel selection, area/pitch masks and clamped map boundaries retain
the CPU semantics. There is no second full-resolution image buffer for GainMap.
Maps exceeding 262,144 grid values retain the CPU route; this bounds metadata.

A separate Library bridge admits operation-free linear DNGs. CPU TIFF decoding
and black/white normalization are retained. The existing compact clipped-light
support mask is computed on the CPU; the GPU reconstructs supported highlights,
applies the embedded camera/profile matrix and baseline exposure, preserves RAW
brightness calibration, measures the full source and reduces it for live drawing.
Crop, XMP crop and existing orientations are retained. Embedded SDR renditions
use the existing CPU decoder and reducer and remain available to SDR drawing and
its defaults. Native full-size requests with an embedded SDR rendition, linear
DNGs with any opcodes, interpretation overrides and unavailable/failed GPU work
retain the existing CPU route. Other DNG gates remain. Grade, export and Proof
entry points and pixels are unchanged. Shared broker/budget/priority/fairness,
source concurrency and decoder process policy are unchanged.

The combined focused Electron driver ran serially at 2560 x 1440, with three
matched CPU/GPU folder pairs per sample, alternating order and fresh copied
paths/app scenes. Each folder included a small PNG. Median finished-folder times
were 100.99 s CPU / 4.18 s GPU for DJI_0071.DNG, 9.35 / 7.80 s for the DxO
neutral linear DNG, and 8.17 / 6.23 s for merged DJI HDR. First picture was the
PNG: 0.15–0.51 s CPU and 0.14–0.36 s GPU across the batch. These are application
cold scenes with uncontrolled OS caches, not disk-cold results or a comparison
with the old cProfile run. No other tests overlapped these timing measurements.

The 5% allowance is unchanged. DJI GPU finishes were stable at 4.16–4.21 s;
linear-DNG CPU reading varied: DxO GPU finishes ranged 7.52–10.33 s and merged
DJI 4.41–6.31 s. The median improvements exceed 5%, but DxO was slower in one
pair, so there is no claim of a consistent per-file latency or two-second goal.
Steve should judge these folders in the app before further timing investigation.
The remaining CPU decoding, SDR rendition preparation and compact highlight
support still matter, especially for DxO.

For the final DJI pair, whole-photo source preparation (before final publication
and drawing) was 104.98 s CPU / 3.77 s GPU. CPU GainMap was 4.49 s and warp
95.69 s; GPU GainMap was 0.254 s and the fused warp/colour/analysis pass 0.354 s.
The fused timing is not an isolated warp-only timer. Linear source preparation
was 6.97–9.81 s DxO and 4.05–5.91 s merged DJI. Activity showed each actual
filename with a live UI heartbeat throughout the slow comparisons.

Finished 640-pixel SDR/HDR pictures and separate eight-pixel borders passed the
unchanged perceptual mean <1.0 / p99.9 <=3.0 limits: worst mean 0.00069 and
p99.9 0.067. DxO's embedded SDR rendition matched exactly. The second DxO
profile sample also passed a separate finished SDR/HDR and border comparison.
Both 640 and 2560
source tiers were prepared. Forty native synthetic probes cover ordered maps,
partial areas/pitches, one/three map planes, warp geometry/edges and all current
orientations, plus linear highlight reconstruction/crop/orientation: worst
linear error 0.0000064, within the existing 0.0001 geometry allowance. Explicit
submission cancellation, reservation rejection and subsequent successful reuse
also passed. The existing DNG driver now covers both routes; there is no broad
GPU sweep. The combined slow checks stayed below the 30-minute allowance.

Required fast checks: 549 Node passed; Python 2,328 passed, 3 skipped, with
the unchanged intermittent
`test_source_ownership_merges_tiers_promotes_and_rejects_stale_publication`
failure (rewritten source was not rejected). It was not investigated or rerun. Original photos, sidecars and owner
caches were preserved. No push or installer.

**Cold-folder/DNG investigation (October 20; initial diagnosis).** Existing
owner-app logs confirm DJI_0071.JPG at 205.5 s, DJI_0072.DNG at 159.7 s,
DJI_0072-2.DNG at 201.7 s and DJI_0071.DNG at 296.7 s until final grid display.
The frontend's two source slots encompass CPU fallback as well as GPU work.
A controlled scheduler check held both with unfinished DNG jobs: the JPEG
could not start. A disposable admission prototype serialised slow demand
before the unchanged two-slot scheduler and let a JPEG finish while the first
DNG was still running. This proves the admission mechanism only, not a live
folder speedup. Merely reordering waiting jobs cannot help once both slots
are occupied. Cache-hit discovery, selected-photo priority, cancellation and
merged requests must also survive a production change; keep Grade priority
and existing memory/concurrency allowances.

One read-only full-resolution DJI_0071.DNG load with Library-helper native
thread settings took 82.6 s under cProfile: mandatory corrections 79.5 s,
including WarpRectilinear 75.2 s and GainMap 4.2 s; RAW decode/demosaic about
1.1 s. This original is 8000 x 6000 Bayer with mandatory GainMap then
WarpRectilinear, not a simple DNG that can safely bypass the blanket GPU
exclusion. Separate unprofiled loads took 6.2 s for DJI_0071-2-HDR.dng and
8.4 s for DSC00264_DxO-optical-corr-only.dng: both are linear DNGs without
listed mandatory operations. These are single diagnostic import samples,
not matched improvements, cold-grid p90 or pure disk-cold timings. The existing
5% matched-timing noise allowance and picture agreement limits remain.
No owner cache was cleared and no source/sidecar was changed.

Recommended next work: bounded slow-job admission that leaves capacity for
other visible files, plus Activity reporting for frontend waiting/running
source and draw work and backend preparation. Then a narrow Library-only GPU
trial of the existing DJI GainMap/WarpRectilinear variants after their current
CPU demosaic, with DNG colour/brightness/crop/orientation and exact operation
order preserved. Measure actual cold-grid display and finished SDR/HDR
agreement before adoption. Linear-DNG GPU colour/analysis/reduction is a
separate follow-up through the RGB foundation. Do not remove DNG eligibility
gates wholesale, skip required corrections, change Grade/export/Proof, raise
budgets or promise a GPU speedup from these CPU profiles. Production queue,
Activity and DNG GPU changes have not been implemented by this investigation. Fast
checks: 539 Node passed; 2,303 Python passed, 3 skipped. The previously recorded
`test_source_ownership_merges_tiers_promotes_and_rejects_stale_publication`
failure reproduced (stale publication was not rejected after rewriting the
source). It was not investigated or changed in this documentation-only work.
No GPU check was needed because no app or shader code changed.

**Loading-order follow-up (October 23; implemented with this commit).**
Large-only queues now use both existing source slots. Lighter queued work is
still preferred when the expensive allowance is occupied, but an otherwise
idle slot is lent to another expensive source after one microtask. A light
file arriving after both slots start waits for the next completion; running
decoders are not interrupted. Cancelled work retains its slot until it exits.
The total two-source limit and shared GPU admission/budgets are unchanged.
GPU-to-CPU fallback events now include the reason in the page stopwatch log,
including failures after source decoding/transfer. The large line-scan DNG's
repeated preparation remains a separate diagnostic issue; this change does
not claim to eliminate its CPU fallback or improve its own processing time.

Validation: all 15 focused scheduler/scene checks and the isolated Electron
`library-live-grid.js` check (2560 x 1440, including GPU recovery) passed.
Fast checks: Node 583 passed with three unrelated `edit-sync-retry.test.js`
failures (`discardUnusedLocal` missing from its test harness); Python 2,418
passed, three skipped, seven unrelated failures in frontend workflow/wording
contracts and the previously recorded stale-source publication check in
`test_library_rgb.py`. No backend, shader or pixel-output behavior changed.

**Loading-order adjustment (October 20; implemented with this commit).**
Cache discovery now runs on a separate bounded two-request queue and never
starts decoding. A cache hit bypasses occupied source slots. Cold preparations
keep the existing total limit of two, but at most one predicted expensive
source runs at once. The estimate is independent of file extension: files at
least 32 MiB, or files whose last preparation in this Library session took at
least two seconds, use the expensive allowance. A small bounded cost penalty
favours likely cheaper waiting work; existing demand promotion, queue aging,
last-subscriber cancellation and shared grid/filmstrip development remain.
Timings are bounded to 256 source entries and discarded when the source's
size/modification identity changes. The size threshold is a conservative
scheduling heuristic, not a decoder timeout, memory-budget change or measured
speed guarantee. In an expensive-only folder, preparation is deliberately
serial; the spare capacity remains available for newly visible lighter files.

Focused behavioural checks cover an expensive TIFF/DNG-shaped pair allowing
a small file through, cache hits during occupied work, shared requests at two
sizes, selection, aging, cancellation, failure cleanup and learned small-file
costs. Source decoding, corrections, colour/brightness, Grade/export/Proof and
GPU memory limits are unchanged. No claim is made that an unexpectedly slow
small file can be interrupted or that the cold-folder timing goals are met.

Validation: 546 Node checks passed; 2,305 Python checks passed, 3 skipped.
The focused `library-live-grid.js` Electron check passed at 2560 x 1440,
covering cold loading, cached reuse, GPU recovery and selected-photo display.
The earlier stale-publication failure did not reproduce in this run. These
checks validate scheduling/integration, not a new DJI cold-folder benchmark.

**Open follow-ups after loading order (Steve, October 20).**

- Activity reporting is built October 21 (above), including frontend probes,
  waiting/running source and draw jobs and backend preparation. Continue using
  the named transitions to diagnose unexpectedly slow files.
- Refine extension-independent cost estimates with cheap dimensions/required
  operations where safe and useful; evaluate retained cost history and
  representative mixed-folder cold first/final display times. Stat size and
  session timing are the initial estimate, not a reliable decoder prediction.
- Add actual processing checkpoints or separately stoppable decoder workers
  for unexpectedly slow/hung files of any format. Aborting a request or racing
  a timer cannot safely reclaim a native decoder that is still executing.
  Preserve completed stages where possible instead of repeatedly restarting.
- Evaluate more/adaptive source concurrency against memory and responsiveness
  within existing broker budgets. Do not simply raise the two-slot limit;
  measure the expensive-only throughput trade-off of reserved capacity too.
- The narrow Library WarpRectilinear route is built October 21 (above).
  Broaden photographic qualification before widening operation eligibility.
  GPU GainMap and operation-free linear DNG are built in the combined October 21
  follow-up above; broader DNG operation plans and consistent two-second latency
  remain open.
- Operation-free linear-DNG GPU colour/analysis/reduction is built above.
  Keep ISO gain-map AVIF and the remaining format-batch work shelved as
  recorded above, with earlier sprint gains preserved.

**Batch 4 — gain-map AVIF.** Prioritise the measured AVIF bottleneck. Establish
access to decoded base/map samples and all required ISO gain-map metadata;
prototype Library GPU reconstruction and colour conversion with the existing
CPU decoder as the comparison route. Remove full-resolution PNG/intermediate
round trips where the qualified decoder interface permits it. Preserve base
versus alternate headroom direction, map dimensions, orientation, gamut,
offsets, gamma and both SDR/HDR renditions. Keep reconstruction at sufficient
resolution for correct full-source measurements before reduction. If the
bundled interface cannot expose the map safely, record the remaining codec
work and retain the existing route rather than claiming this batch complete.
Done: real gain-map AVIF files pass both lanes and first-preparation timings
identify any remaining decode floor.

**Batch 5 — Ultra HDR JPEG and Apple HDR HEIF gain maps.** Reuse batch 4's
base/map transport and scheduling, with separate reconstruction adapters for
libultrahdr and Apple's supported metadata. Do not treat ISO, Adobe/libultrahdr
and Apple map formulas as interchangeable. Preserve the actual SDR base,
headroom/reference-white rules, orientation and current handling of missing
or unreadable auxiliary data. Avoid decoding the same base twice where the
chosen codec can expose both products. Keep export/Proof decoders intact.
Done: both families pass focused SDR/HDR comparison, source identity and
fallback checks; format-specific unsupported cases are listed here.

**Batch 6 — fast first pictures, only where useful.** After the final-scene
route works, use batch 0 timings to choose decoder-supported reduced or
embedded previews for slow formats. Standard JPEG's reduced decode and a
colour-aware gain-map SDR base are candidates, not promised capabilities for
every codec. Label these as temporary pictures and replace them reliably with
the final live scene; never cache an SDR stand-in as final HDR. Reuse ongoing
decoding where possible and bound extra work so previews do not delay final
scenes. Formats without a cheap preview retain the normal loading state.
Done: navigation, cancellation, grade/source changes and GPU recovery cannot
leave a stale stand-in; first-paint improvement is measured for enabled routes.

**Batch 7 — focused mixed-format acceptance and closeout.** Exercise a small
mixed folder in grid/filmstrip, Single/full-screen, Compare Fit, selected true
100% detail and visible Batch Export tiles. Cover unedited and saved/pasted
grades, finishing-only scene reuse, interpretation invalidation, concurrent
requests, cache off/clear, relaunch and device recovery. Check responsiveness
while Grade/delivery owns priority. Reuse the existing export-tile timing
check only if shared tile scheduling changed. Retire replaced Library-only
preparation code/tests once all its consumers move; retain supported fallback.
Done: record which formats/routes are built, measured waits and remaining
codec limits here, with no blanket claim that all decoding runs on the GPU.

**Validation and acceptance for the batches:**

- Existing Library picture guide: finished SDR Delta E 2000 / HDR Delta E ITP
  mean below 1.0 and p99.9 at or below 3.0, against Grade at the same display
  size and recipe, in both lanes. No hard per-pixel maximum. Review ordinary
  SDR files and authored SDR bases as well as HDR highlights. Preserve the
  existing hard highlight-target rule when enabled and use the existing
  agreed checks for measurements; do not invent looser tolerances.
- Existing speed goals remain: first picture within 1 s p90, final pictures
  about 2 s p90, 90% of visible cached thumbnails within 100 ms on relaunch,
  changed visible grade about 1 s when idle. Separate first paint, final draw,
  cached metadata and codec-only timings. Single samples above do not qualify
  these goals. Use 5% timing noise allowance for matched comparisons; seek
  substantial reduction in the stage being changed and record unmet goals
  honestly. The baseline batch chooses the representative sample count and
  repeats before collecting comparisons; no broad camera sweep is required.
- For every implementation batch run the repository's fast Node and .venv
  Python checks, then one or two directly relevant GPU checks, serially via
  the Electron runner at 2560 x 1440. Add new drivers to the release inventory.
  Keep slow validation within roughly 30 minutes per related group; ask
  before exceeding it, following AGENTS.md. Documentation-only updates need
  the fast checks, with no GPU run. Full sweeps/installers are outside scope.
- Each batch is independently reviewable and locally committed, with a short
  outcome and any failures. Batch 0 precedes batch 1; batches 2 and 3 build on
  batch 1; batch 4 builds on the AVIF contract from batch 3; batch 5 follows
  batch 4; batch 6 follows qualification of its chosen formats; batch 7 closes
  the integrated work. No push or installer is included.

**October 22: Edge colour GPU reconstruction (built).** Ordinary eligible
camera RAWs with `edge_colour_v1` now stay on the Library GPU route. The
shared reconstruction runs on ACEScg after opposed colour and camera
conversion, before lens correction, gamut handling, calibration and source
measurements. Its clipping mask uses camera channels before white balance,
matching Grade. Expand and saved source recipes are unchanged. The existing
44 bytes/pixel + 64 MiB reservation covers the added stage; short row bands
yield to Grade and delivery. Allocation/device failures retain CPU fallback.
The source-job pause/Activity scroll fix in 53ef951 is preserved.
Focused real-photo validation: DSC00264 source completion 9.0 s, IMG_3129
6.3 s, including queue and handoff. Both explicitly reported GPU Edge colour.
Finished SDR/HDR agreement with the same CPU Library source/reducer passed
the existing mean <1 / p99.9 ≤3 limits, including the brightest 5% separately.
Grade's Lanczos proxy and Library's bilinear tier remain different filters;
direct comparison between those previews is still outside limits on these
photos. This reconstruction change does not qualify that existing open item.

**October 23: Bounded DNG distortion preparation (built).** Supported mosaiced
DNGs with mandatory GainMaps followed by one WarpRectilinear now use bounded
GPU source footprints. Each channel's radial and tangential mapping is bounded
with interval arithmetic, including cubic support; large footprints split
adaptively. Source coordinates, crop/orientation and sample positions stay in
full-image space across seams. GainMaps run in order on each uploaded source
footprint before warping, colour conversion, calibration and measurements.
There is no full-camera GPU buffer. Output tiles accumulate in host RAM, then
one plane at a time uses the existing GPU reduction filter.

The shared scheduler and all existing memory limits remain unchanged. A DNG
reservation covers the maximum concurrent tile/reduction allocations rather
than the generic RAW estimate. Allocation failure, unsupported mandatory
operations, unavailable memory and cancellation retain the existing failure or
CPU fallback paths. Grade keeps priority; DNG stages reuse a scheduler permit
for at most 20 ms while checking cancellation at every boundary.

Focused results: three-run medians on one real `DJI_0071-2.DNG`, 8000 x 6000,
Ryzen 5 7600 / RTX 4070 Ti, headless Playwright Edge at 2560 x 1440. Each run
used a fresh photo/output copy in isolated application data; OS caches were
warm/uncontrolled and household GPU activity continued. The baseline loaded
the committed pre-change frontend and CPU opcode implementation. An early run
contending with a separate CPU profiler was discarded before these runs.
Timing tolerance: 10%, agreed in the brief before measurement.

| Stage / measurement | Before: rejected GPU, CPU fallback | After: tiled GPU |
|---|---:|---:|
| AHD decode (opcode-free boundary) | 1.55 s | 1.31 s |
| GainMap | 4.87 s | 0.38 s |
| Distortion | 85.66 s | 0.33 s, fused with colour/measurements |
| Additional CPU DNG colour | 0.30 s | included in fused stage |
| Additional CPU normalization / analysis | 0.78 / 0.86 s | included in fused stage |
| GPU queue / scheduler permits | not applicable | 0.001 / 0.50 s |
| GPU upload / readback | not applicable | 0.70 / 2.05 s |
| GPU reduction | not separately timed on CPU | 0.12 s |
| All GPU preparation, including transfers and permits | rejected | 4.10 s |
| Finished mixed-folder picture, including storage/display | 101.25 s | 10.47 s |
| DNG reservation / available shared memory | 2078.16 / 2048 MiB | 283.20 / 2048 MiB |
| Peak tracked DNG GPU buffers | no DNG allocation after rejection | 260.45 MiB |

Stage medians are independent and should not be added to the end-to-end
median. The under-five-second preparation goal is met. Final user waits
ranged 8.89-10.63 s; their spread exceeds the 10% noise guidance, so the
end-to-end number is descriptive, not a tight latency guarantee. No extra
runs chased that variation. Reduction still needs one full output plane (192 MB for this photo); smaller
binding limits or an insufficient reservation fall back to the CPU.
Host RSS was not sampled: the decoder, source
transfer and accumulated output still retain full images in host memory.

Quality: finished 640-pixel SDR and HDR pictures matched the original CPU
baseline for all three pairs, both whole picture and eight-pixel borders.
Worst SDR Delta E 2000 mean / p99.9: 0.000688 / 0.0580. Worst HDR Delta E ITP
mean / p99.9: 0.000366 / 0.0662. Existing limits remain mean <1, p99.9 <=3.
All 41 synthetic native-pixel cases pass the existing 0.0001 absolute check
(worst 0.00000719), covering all eight orientations, per-channel and
off-centre/tangential warps, ordered GainMaps, clamped borders, seam crossing,
an adaptive off-lattice split and full-image measurement samples. Cancellation,
low memory, injected allocation failure and successful reuse after failure pass.

All four real DJI mosaiced DNGs still pass the operation-based plan; the Sony
DxO linear DNG and DJI merged HDR DNG have no mandatory warp and retain their
existing route. This is not a camera-brand switch. The subsequent real Leica validation below closes the
non-DJI fixture gap. Grade now shares this bounded correction engine through
its own source-job/delivery lifecycle (see Import and RAW).

Validation: the existing focused DNG driver ran serially through headless
Playwright; no visible Electron/browser, broad sweep, push or installer.
Fast checks: 590 Node passed; 2,468 Python passed, 3 skipped.
Evidence remains in ignored `codebase/output/dng-performance/` and
`codebase/output/library-dng-warp/` (baseline `1792772080024`, final timed GPU
`1792772515693`, final adaptive geometry `1792772824911`).

**October 24, 2026: real non-DJI GPU DNG validation (built)**

The externally stored Leica X2 sample 882 from raw.pixls.us is CC0/public domain.
`codebase/tests/fixtures/dng-real-samples.json` retains its acquisition URL,
SHA256, byte size and local fixture reference. The 4944 x 3272 mosaiced sensor
has mandatory OpcodeList3 WarpRectilinear with three coefficient sets and produces
4928 x 3264 corrected pixels. Tests use output copies and preserve the original.

Three-run Library CPU/GPU medians on the same shared machine: completion
25.15 -> 7.61 seconds, with 10% timing tolerance. GPU preparation median was
5.01 seconds (decode 0.981 s, tiled GPU work 1.549 s); measured GPU stages were
upload 0.231 s, warp/colour 0.139 s, readback 0.838 s and reduction 0.073 s.
Tracked GPU peak was 109.80 MiB against a 130.36 MiB shared reservation.
CPU preparation median was 21.86 seconds, including 21.07 seconds decode/correction.
These warm/uncontrolled-cache timings are descriptive; they do not establish a
Grade baseline or a standalone-GPU performance guarantee.

All three independently rendered 640-pixel finished SDR/HDR pairs pass the
unchanged mean <1, p99.9 <=3 limits, including outer eight-pixel borders.
Worst SDR Delta E 2000 mean / p99.9: 0.0000960 / 0.02066; worst HDR Delta E ITP:
0.0004341 / 0.05688. The 57 native synthetic geometry cases include signed
Grade colour, all orientations, channel-specific/off-centre/tangential warp,
ordered GainMaps and adaptive tile seams: worst absolute error 0.00000859
against the unchanged 0.0001 limit. Cancellation, budget denial and injected
allocation failure/reuse also pass. This does not claim full-native finished
export comparison or general Library-to-Grade RAW brightness agreement.

Fast checks: 590 Node passed; 2,480 Python passed, 3 skipped.
The focused headless Playwright driver ran serially; no visible browser or
Electron window, broad sweep, push or installer. Ignored evidence:
`codebase/output/library-dng-warp/1792774197270/results.json` (three real Leica
pairs), `1792774852959/results.json` (final geometry), and
`codebase/output/dng-grade/library-final3.log`. The forced CPU reference now
also explicitly selects CPU delivery so the shared Grade hook cannot silently
turn a CPU reference into GPU work.

## 6. Decisions waiting on Steve

- **V2, deferred:** linked photos: whole grade or chosen groups; where the link is stored.
- **V2, deferred:** portable projects: one-file packing; the project index file ending.
- Comfort cap: roll-off or clip; grid only or everywhere.
- **V2, deferred:** Library Looks: one menu or two.
- Image-dependent settings when pasting: re-run or copy the numbers.
- Nested tags. What "HDR" means for an unedited photo (proposed: HDR
  Finisher's default rendering). One focus overlay or two. How often
  folders are checked.

## 7. V2 work and other deferred ideas

- **Post-v1: consider Library cache compression (Steve, October 24, 2026).** Evaluate idle/background lossless compression of large half-float previews, measuring disk savings against compression cost and cached reopen speed; a manual compact-cache action is optional. Deferred beyond v1: preserve the current cache plans, formats and large-image preparation behavior.

**Deferred to v2 (Steve, October 21, 2026); not built:**

- **Library Looks (slice 7):** one Looks menu; Apply Look window with
  favourites, user folders and a small built-in starter set; preview on
  hover; "Save as look preset" from the paste window.
- **Linked photos (slice 7b):** Link grades, chain icon, "linked with N
  other photos" in Grade, Unlink, a Linked filter. Crop, lens and local
  adjustments never link. Two decisions remain open (section 6).
- **Portable projects (slice 10):** Export project, a Projects section,
  Merge or Keep separate, "Missing" frames, manual relink. Two decisions
  remain open (section 6).

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
