# Module PRD: Photo Library

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 19, 2026, against the code.
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

### 5.1 Non-RAW Library source speed: batch plan (October 20, 2026)

**Status: Batch 0 recorded; Batch 1 built October 20 for ordinary JPEG/PNG.** Steve requested a single plan covering all supported non-RAW
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

**Batch 2 — EXR, HDR/PFM and TIFF adapters.** Feed existing decoded linear or
encoded high-precision samples into batch 1. Profile EXR channel reads and
compressed-block work; investigate reading RGB together if the bindings and
measured cost justify it. Preserve selected layered channels, data-window
handling, chromaticities/conflicts and manual overrides. TIFF retains its
existing bit depth, float, profile and orientation semantics. Avoid converting
whole full-size arrays to repeated intermediate copies before GPU upload.
Done: supported cases use shared GPU preparation, decoder time is separated
from GPU time, and unsupported cases keep an explicit existing fallback.

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
