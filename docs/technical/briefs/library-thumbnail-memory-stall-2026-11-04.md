# Library thumbnails stall after leaving Grade (proposal)

Status: reviewed and implemented in part, November 4, 2026. Thumbnail admission passes; collection is wired, but live delivery buffers still prevent the requested memory release. See Codex outcome below.

## What Steve saw

On November 4, around 21:23, Steve left Grade and went back to the Library grid in `D:\Photos\HDR Test Images`. The thumbnails for the DxO DNGs (`*_DxO-optical-corr-only.dng`) did not appear. Going to another folder and back once did not help. About three minutes later, after a second trip to another folder, they all appeared at once.

## What the log shows

Source: `%APPDATA%\hdr-finisher-desktop\logs\backend.log`, session started 21:14:52.

| Time | Event | App memory (ceiling 4.00 GB) |
|---|---|---|
| 21:23:41 | Grade view left; grid asks for DxO DNG thumbnails (cache miss) | 4.09 GB |
| 21:23:41–21:24:40 | Each DNG waits on `measured memory`. Estimate about 0.97–0.98 GB each. 46 `reclaim_retry` cycles. The reclaim reaches the Library page and `backend/helper` only. | 4.08–4.10 GB |
| 21:24:41 | Folder away and back. The same wait resumes. | 4.05 GB |
| 21:25:01 | `request_failed`, "Library grant expired" (DSC07229.ARW), a side effect of the stall | 4.08 GB |
| 21:26:25–29 | The hidden GPU delivery window (pid 12744, role `hidden-gpu-delivery-window`) drops from 1.40 GB charged / 1.31 GB private to 0.20 / 0.10 GB. Nothing in the app asked it to. | 3.95 → 2.75 GB |
| 21:26:31 | Back to the folder. DNG grants are granted with no wait. Camera pictures are shown in 0.4–1.0 s. | 2.75 GB |

The rest of the memory was the GPU process (about 2.5 GB private), and the backend (about 2.0 GB private, the photo still retained from Grade). Neither changed.

There were no `picture_development_empty_channel` events, GPU failures or crashes.

## Two causes

### 1. A camera-picture thumbnail asks for a full-development grant

The thumbnail that finally showed was the DNG's embedded camera picture (`route: camera-preview-placeholder`, `reason: camera picture`). That route goes through `HDRLibraryGrants.preview` with kind `quick` (`frontend/library-grants.js`).

In `backend/hdr_finisher/library_estimates.py`, `estimate_details`, a `quick` DNG gets the small estimate only if exifread finds a `JPEGThumbnail`, which comes from IFD1. These DxO DNGs keep their previews in SubIFDs of page 0:

- page 0: 250 × 165, uncompressed
- SubIFD: 8020 × 5304, LinearRaw
- SubIFD: 8020 × 5304, YCbCr JPEG (the full-size preview)

exifread finds no `JPEGThumbnail`, so the code falls through to `estimate_pixels(".dng", 8020, 5304, "quick")`. That is 23 bytes × 42.5 MP ≈ 0.98 GB, which matches the logged `estimate_bytes: 978375840`. Decoding a JPEG preview, DCT-scaled to a 640 or 2560 edge, needs a small fraction of that.

This alone would probably have avoided the stall. During the same minute, 64 MB `quick` grants for ARW camera pictures in that folder (for example DSC07228.ARW and DSC07229.ARW) were admitted with no wait. Codex should confirm the small-job rule that let them through.

### 2. The hidden GPU delivery window is never asked to clean up

The window is created in `desktop/main.js` (`deliveryWindow`, `show:false`, no preload). It does GPU work such as finishing pictures and the Grade → Library picture hand-off. There was a `page_grade_picture_handoff` at 21:23:08. In `frontend/gpu-delivery.js`, read-backs return `getMappedRange().slice(0)` copies. Those are ordinary JS memory that stays until the window's garbage collector runs.

When the app needs memory, no cleanup path reaches that window:

- Scheduler reclaim and collect (`library_scheduler.py` → `library_grants.py`) go to the owners connected to the grants socket: Library pages and `backend/helper`. The delivery window does not connect.
- The pressure trim in `desktop/main.js` calls `memoryPressureRelay.notifyChromiumPressure(mainWindow.webContents, …)`, which forces a GC in the main window only. The `desktop:memory-pressure` IPC goes to `windows`, which does not include `deliveryWindow`.
- During the stall the pressure level was `none` anyway (see "Also noticed").

So the 1.2 GB waited for Chromium's own idle GC, about three minutes.

## Proposed fix (conservative, reuse what exists)

### A. Size the camera-picture grant from the preview that is actually decoded

- For `quick` on DNG and other TIFF-based RAWs, find the embedded JPEG preview from the header, including SubIFDs, the way `/api/library/preview` finds the picture it decodes. If one exists, use the same rule as an embedded JPEG today (`MINIMUM`, the approved DCT-scaled quick route). Use a size-based quick rate on the preview's dimensions only if Codex finds the route decodes it at full size.
- If there is no embedded preview, keep today's estimate.
- First confirm which page `/api/library/preview` decodes for these files, and its measured peak. The estimate must describe that route, not a guess.
- Header-only, as today. No pixel reads to size an admission.

### B. Include the hidden GPU delivery window in memory cleanup

- When the desktop runs its Chromium pressure collection, run it in the delivery window too, using the same `notifyChromiumPressure` helper.
- When the scheduler starts a `collect` or `reclaim` cycle for a waiting `now` photo, include a GC of the delivery window. The simplest route may be a small backend → desktop signal; Codex should pick the cleanest one.
- After the delivery window finishes a job with large read-backs, such as a Grade hand-off, run one GC once it is idle (debounced), so the memory does not linger for minutes.
- Measure it: the hidden window's private bytes before and after a forced GC following a Grade hand-off. If GC does not free it, report what holds it instead of adding more machinery.

## Not changing

- The 4 GB ceiling, the priority order, and Grade keeping its photo for a fast return.
- Logging volume. That is a separate issue; the log is 1.2 GB.

## Also noticed (no change proposed; Codex to give an opinion)

- **Pressure level and admission disagree about Grade.** The pressure level subtracts Grade's retained bytes (`safety_total = total - grade_bytes` in `app_memory.py`), so it read `none` and no trims ran during the stall. Admission (`measured_fits`) counts the whole total, so a `now` thumbnail waited on `measured memory` and never got "paused for Grade". With A and B in place this may not matter. Codex should say whether it is a deliberate rule or a gap.
- **Repeated folder "finished" events.** `folder_open_disk_finished` for `HDR Test Images` repeated about every 15 s with the same request id and a growing duration (2 s up to 462 s). This may be the normal re-check, or a loop.
- **Unreadable settings files.** `settings_conflict_read_failed` reported 11 `.hdrfinisher` files in `HDR Test Images` that are not UTF-8 text (for example `DSC05884.hdrfinisher`). They are left untouched. Probably old test files.

## Codex review (November 4, 2026; before implementation)

**Proceed with A and B, with small adjustments.** Neither needs a ceiling,
priority, Grade-retention or pixel change.

- **A is right.** `estimate_details` checks ExifRead's `JPEGThumbnail` for
  DNG quick jobs, then charges 23 bytes per full-source pixel. Read-only
  inspection of `DJI Samples/DSC01204_DxO-optical-corr-only.dng` confirms
  250 x 165 RGB IFD0, 8020 x 5304 LinearRaw SubIFD, and 8020 x 5304
  YCbCr/JPEG SubIFD, with no IFD1. The current charge is exactly
  978,375,840 bytes. Correction: `/preview` calls `camera_preview`, whose
  `_extract_camera_preview` uses LibRaw `extract_thumb`, not tifffile.
  Actual extraction returns a 14,076,307-byte JPEG at 8020 x 5304, and
  Pillow calls `draft` before transpose/conversion/thumbnail. At edges 640
  and 2560 it produces 423 x 640 and 1693 x 2560. Header inspection must
  exclude JPEG-compressed LinearRaw/CFA pages: compression alone cannot
  distinguish the source from the camera picture. Retain conservative
  estimates for absent/ambiguous previews. Small jobs already have the
  four-job 64 MB fast lane (`job.fast` bypasses `measured_fits`); no new
  admission exception is needed.
- **B is right about missing cleanup; the exact retaining allocation is an
  inference.** All scheduler owner events reach the Library/backend only.
  Desktop pressure collection targets main only; `windows` omits delivery.
  Readback copies and upload Blobs can leave ordinary garbage after the
  existing GPU destruction/session reset. Logs alone cannot prove which
  allocation survived, or that Chromium GC caused the spontaneous drop.
  The requested forced-GC measurement will test that explanation. Reuse
  `desktop:reclaim-library-storage`, already called by both Library collect
  and reclaim callbacks, to collect delivery too; no backend signal needed.
  Use a bounded/coalesced existing collection and one debounced idle
  notification from the delivery worker, after job scope has unwound.

**Log verification.** Streamed the requested session beginning 21:14:52
(UTC+7), without changing it. It contains 46 reclaim retries, the one
21:25:01 preview failure for DSC07229.ARW, no empty-channel/GPU-failure/crash
markers, and repeated DNG measured-memory waits. The hidden PID 12744 goes
from about 1.30 GB private to 103,505,920 bytes by 21:26:29; whole-app charge
then is 2,748,100,603 bytes. Grade retains 1,017,354,240 published bytes;
backend private stays about 1.97-1.98 GB. The GPU private figure fluctuates
rather than being literally unchanged. A logged handoff is a finishing
redraw, reason `No clean current Grade picture`; do not assume it was a
zero-copy handoff. The proposal's times/estimates describe the stall well,
but its GC attribution and invariant GPU wording are stronger than the log.

**Also noticed.**

1. Grade exclusion from pressure and inclusion in admission are explicit
   separate policies in `app_memory.snapshot` and `Scheduler._schedule`.
   Protecting retained Grade while counting actual admission headroom is
   consistent with the recorded decisions. The missing delivery collector
   is a gap; changing Grade accounting is outside this fix. `paused for
   Grade` depends on estimate room, not every measured-total refusal.
2. `library_folder_stream` deliberately rechecks at least every 15 seconds.
   `duration_ms` is measured from stream start; `check_ms` is each pass.
   These are not repeated full folder opens or a busy retry loop. Relabeling
   that diagnostic, and limiting repeated unchanged warnings, are separate.
3. `library_conflicts` matches any name containing `.hdrf`, including old
   binary `.hdrfinisher` project files, then reads them as UTF-8 JSON. The
   11-file warnings are real but do not prove damaged sidecars. Leave those
   files untouched; narrow extra-sidecar recognition in a separate fix
   (already listed under Library batch 4c).

Validation limits: estimates/unchanged no-preview rates are exact. For
memory collection, report actual private bytes with no numeric reduction
promise; success means prompt removal of dead storage after a real job.
Preview peak must fit the existing 64 MB grant; sampling can miss short
peaks. Real-app acceptance requires the DxO camera pictures and no
measured-memory waits for them after Grade; no timing budget is relaxed.

**Implementation adjustment from measurement:** the 640-edge decode sampled
33,099,776 extra private bytes; the 2560-edge decode sampled 156,168,192.
The blanket 64 MB proposal would understate the screen route, even though
it uses DCT reduction. Use the existing 23-byte quick rate on the actual
power-of-two DCT sample dimensions (minimum still 64 MB), and forward the
requested edge through grant admission. For this DxO header: 640 edge =
64,000,000 bytes; 2560 edge = 244,593,960 bytes; old = 978,375,840 bytes.
This changes no rate, budget, priority or pixels. Plain-JPEG and legacy
IFD1 quick estimates are outside this targeted SubIFD fix and stay as before.
The initial measurement attempt returned zero because its Windows handle
signature was missing; those zero figures are excluded. Correctly typed
GetProcessMemoryInfo counters produced the figures above (1 ms sampling).

## Codex outcome (November 4, 2026)

A is implemented, including edge forwarding in both frontend and backend
admission. The small header-only fixture has the DxO SubIFD layout and no
IFD1 or pixel body. At 640 edge the estimate changes from 978,375,840 to
64,000,000 bytes; at 2560 it is 244,593,960. The same no-preview fixture keeps
978,375,840. JPEG-compressed LinearRaw is explicitly excluded as a preview.
No decoder, displayed/exported samples, ceiling, rate, priority rule or Grade
retention changed.

B's collection wiring is implemented: existing waiting-photo collect/reclaim
IPC includes delivery; pressure collection includes all registered windows
and delivery; a private, sender-checked preload cancels/debounces one idle
collection 250 ms after a completed worker job. Existing collection deadlines
and coalescing are reused. **The requested prompt memory release is not
achieved by GC alone. No further production machinery was added.**

The real Grade edge-colour GPU job reproduces the large hidden-worker hold.
After its Grade-to-Library handoff, a forced major GC changes Windows private
commit from **1,230,790,656 to 1,230,544,896 bytes** (Electron reports KiB;
converted by multiplying by 1024). Its earlier idle GC changed 1,233,051,648
to 1,230,487,552 bytes. Those tiny reductions do not release the photo buffers.
A heap snapshot proves the async generator in `gpu-delivery.js` still strongly
holds its previous job's 678,236,160-byte input and three 169,559,040-byte
outputs through its `parameters_and_registers` array (slots 57 and 60).
Total live backing stores: **1,186,913,280 bytes**. These are live references,
not unreachable garbage. This corrects the proposal's idle-GC explanation.
The incident's hidden-worker turns occurred at 21:21:24-38, before the
21:23:08 Library handoff; they were Grade work, not evidence of a hidden
renderer doing that handoff itself. Separate follow-up: end the lifetime of
completed job buffers in the delivery loop. Do not change Grade retention.

Real-app check: plain Electron at 2560 x 1440, Grade edits on reusable
`output/test-photos/library-live-grid/DSC07061.ARW` only, normal Library return,
then read-only browse of `D:/Photos/HDR Test Images/DXO_PL_exported`.
All ten visible optical-correction DNGs show camera pictures **0.464-0.829 s**
after browse; all their quick grants are 64 MB; **zero measured-memory waits**
for those DNGs in backend.log. Their extraction stage takes 89-171 ms, not
the whole visible wait. Original photos/settings were not written. The
harness restores sidecars on reusable copies and removes its temporary profile.

This focused diagnostic still fails whole-app memory acceptance: Grade's
large work peaks at 5.890 GB and ends at 3.570 GB (target below 3.4 GB).
Do not present it as full memory acceptance. The separate standard 90-second
Library check passes, with 29 pictures and 3.202 GB external peak. Existing
Grade peak/coexistence work remains separate; no allowance was relaxed.

Evidence (small retained local outputs):
`codebase/output/quick-library-check/thumbnail-memory/{scenario.json,report.json,backend.log,delivery-collections.json,delivery.heapsnapshot,retained-buffers.json}`;
standard: `codebase/output/quick-library-check/thumbnail-memory-standard/report.json`.
The opt-in diagnostic is `node tools/quick-library-check.cjs --thumbnail-memory
--folder=library-live-grid --label=thumbnail-memory --seconds=6`.
Early trials that did not exercise the worker or reused a non-empty cache
are excluded. The final measurement uses an empty isolated profile and no
DevTools connection. The heap snapshot is diagnostic only.

Final fast checks: 801 JavaScript tests passed; 3,053 Python passed and three
skipped. One unrelated Python test fails:
`test_library_live.py::test_remembered_failure_does_not_hide_current_grade_cached_scene`
expects a 422 for a remembered failed PNG, but gets a 200 original-file
route. This is outside SubIFD sizing/collection; left unchanged, not rerun.
The 66 estimate tests and final 26 grant/collection tests pass. The registered
diagnostic helper and standard checker both pass syntax checks. This change
is deliberately incomplete for prompt delivery-memory release; the next fix
needs to remove the proven completed-job references, not add more GC loops.
