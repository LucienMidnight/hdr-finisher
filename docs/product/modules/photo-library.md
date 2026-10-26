# Module PRD: Photo Library

## October 26: GPU Denoise preparation

Noise measurement now runs on the renderer's graphics card for Grade, Library,
GPU export and Proof. The CPU remains the fallback for an unavailable, failed
or insufficient-memory GPU. Export no longer performs CPU noise measurement
before entering the GPU queue. Bounded source windows retain actual pixels:
at most 1 MP, without resizing; the host fits only compact GPU statistics.
Reconstruction and Highlight compression arithmetic are unchanged.

Measurements are kept as versioned JSON in the managed Library preview cache.
They survive visits and restarts while that cache is retained. Identity includes
source pixels, size and resampling geometry, excluding finishing controls and
HDR/SDR names. Full-size Grade/export/Proof share the native source measurement;
reduced pictures measure their own pixels. Authored SDR bases stay separate.
Clearing/evicting preview data or changing source interpretation requires a new
measurement. GPU allocation respects the existing memory budget and Library
admission; repeated requests within a page share work. Proof inherits its source
owner's identity, with a distinct identity for a reduced source.

Proposed before implementation: finished SDR mean Delta E 2000 <1 and p99 <3;
finished HDR mean Delta E ITP <1 and p99 <3 against the current CPU measurement.
Steve allows approximate measurement and CPU/GPU differences; preview and export
must agree perceptually. No per-pixel colour maximum; Highlight compression is
an exact ceiling allowing only encoder rounding. All 13 existing Denoise corpus
cases passed at two strengths in both renditions: worst HDR mean 0.152/p99 2.350,
SDR mean 0.012/p99 0.124. Existing GPU reconstruction parity and Full-tier Denoise
checks passed. Real 42 MP RAW preparation: CPU 809–969 ms, GPU 169–176 ms (about 93 ms
compute), two matched runs excluding RAW development. Fallback delivery also
keeps/reuses the native measurement; no usable GPU is required to retain it.

Library records every backend measurement as GPU, CPU fallback or reused, with
source size, measured pixel count, duration and usage (Library, Grade, export/Proof).
Mode switches record timestamp, rendition, display epoch and visible thumbnail
count. `summarize_library_log.py` reports both groups. Finishing-grade changes
and HDR/SDR switches reuse a measurement when the underlying pixels are shared.

Timing targets remain about 50 ms thumbnail preparation and 0.5 s uncached Fit
sharp draw, allowing 5% run variation. Final real-Library run on a copied 42 MP RAW: thumbnail CPU preparation
1464 ms → GPU 92 ms; screen-preview CPU preparation 983 ms → GPU 203 ms.
The first CPU result includes calibration startup. GPU compute itself was about
45/87 ms. HDR/SDR reuse was 3 ms with exactly one measurement per size. Source
reading avoids unrelated Grade peak-candidate setup and preserves the same half
float scene samples. Screen-preview drawing after preparation took 363 ms,
about 0.57 s combined; thumbnail drawing took 145 ms. This excludes source
RAW development. The 50 ms preparation and 0.5 s combined sharp-draw targets
remain open, as does Steve's normal-folder/fullscreen app acceptance. These
single-photo figures do not replace Steve's 1.6 s/270 ms historical medians.
Corpus preparation was 65–94 ms after pipeline warm-up, reuse 2–4 ms.

Real RAW GPU export measured in 208 ms within its GPU turn, then Proof reused
it; the old CPU premeasurement cost about 0.8–1.0 s per native photo. The
4000 px Ultra HDR GPU export took 28.14 s in this check, versus 119.69 s forced
CPU; those whole-export numbers compare renderer paths, not before/after this
measurement change. No matched whole-export before/after is claimed.

## Start here: Library responsiveness status (October 26, 2026)

**October 26 viewport batch, Part 3.** Disk pages reuse directory-enumeration
settings fingerprints, removing a failing settings-file probe for every
unmodified photo. All-core low-priority camera readers pause during each
short disk page, resuming between pages; selected and visible reads retain
their separate priority. Comparison reads no longer wait for the marks writer.
`folder_disk_page` records helper and acceptance time separately, alongside
existing helper queue/work timing, so disk I/O and backend waits are visible.
Validation deferred to the single final profile and fast suites.


**October 26 viewport batch, Part 2.** Folder opening delivers the entire
indexed snapshot in one message, before disk checking or background camera
details. The first grid therefore has the full count, sort and filter facts;
jumping anywhere starts only that viewport. Bulk index enrichment uses an
independent WAL reader instead of waiting behind the marks writer. This removes
hundreds of repeated database setups and full-grid sorts. Camera-detail sort
updates preserve the top visible photo. Targets: all rows about 5 s, best
available visible picture about 1 s, disk check about 60 s; allow 5% run
variation. Validation deferred to the single final profile and fast suites.


**October 26 viewport batch, Part 1.** Intermediate scroll positions no longer
start picture work. Settling requests only the visible cells; finished cells
remain cached one screen beyond either edge. Leaving cells abort shared source
work instead of allowing it to finish off screen. Settings hydration cancels
when its cells leave and adopts the new identity before repaint, avoiding a
second request for the same cell. Stream paints restore scroll before drawing.
Validation: deferred to the single final profile and fast suites.


**October 26 follow-up final verification.** Fast suites ran once: JavaScript
632 passed / 2 failed; Python 2605 passed / 2 failed / 3 skipped (7m43s).
The failures match the four previously recorded fixture problems below:
Library scenes decoder fallback, Single missing screen-preview helper,
RGB missing SourceReference luminance, and retouch CaptureCache missing
`defer_store`. No unrelated failure was investigated, fixed or rerun. The
new large-folder layout and telemetry checks passed. Final API model loading,
zero-request field preservation, frontend syntax and diff checks passed.
The summarizer read the disposable log, separating detail demands, recovery
pieces and folder closure reasons; its pre-correction scroll record lacks
range/count fields, as expected. Selected-read separation, CPU-scaled EXIF
waves, coalesced background sorting, startup-restore guards, retained telemetry
and independent main-lane disk admission are final unprofiled corrections.
No extra GPU checks (picture arithmetic unchanged), second profile, push or
installer build. The requested module status/slow-items table, technical
section 8 and picture-flow chart are updated.

**October 26 follow-up profile (one run; targets unverified).** A disposable
snapshot of the live database was used, with an empty isolated picture cache
and settings writes/source cleanup disabled. The page changed from D:\Photos
to D:\Photos\Play_Raw before bottom selection, then timed out waiting 180 s
for disk completion. Its 405 ms picture and 2 ms known-details figures are
invalid for the requested large-folder scenario. There were no page errors.
No second profile was run. Startup restoration can race navigation; it now
only restores if navigation has not begun. Selected EXIF also now bypasses
in-flight visible reads, and the telemetry schema retains range/count/demand
fields instead of silently dropping them. These final corrections remain
unprofiled. Steve should jump to the bottom of D:\Photos, select a photo,
visit Grade and return while the check runs; Claude should inspect the new
scroll, detail-read, recovery-piece and closure records. About 1 s pictures,
0.3 s selected details and roughly 50 s disk checking remain open targets.

**October 26 follow-up, Part 3.** Opening Grade no longer aborts the open
folder stream. Only opening another place or closing its page ends it; page
and backend closure logs include reasons. The observed 19:48:38 closure was
immediately preceded by Grade opening. Disk pages use the main lane at low queue priority, independently of
picture/source admission; completion wakes the stream directly instead of adding
20 ms polling delays per page. Pages now hold at most 256 photos. Open walkers
retain their place during long foreground pauses rather than expiring at 30 s.
Startup recovery caused the post-open reconcile burst: it waited for helper
idle, then reconciled one photo family per lock. Recovery now handles at most
16 families per piece, logs count/time, and checks foreground demand between
pieces. Validation is deferred to the final profile and fast suites.

**October 26 follow-up, Part 2.** Streamed folders now start the missing
camera-details fill-in after indexed rows arrive. Selection requests bypass
background readers with priority 0 and a 30 ms selection debounce; on-screen
photos request details independently of pictures. Background reads use the
all-core, below-normal helper pool and yield to foreground work. Known dates
and camera filters update as details arrive; background arrivals are coalesced
to at most one page sort per second. Logs distinguish selected,
visible and background reads with counts and durations. The 0.3 s selected
and 1 s visible-picture goals remain targets until the final profile/app try.
Validation is deferred to the final batched run.

**October 26 follow-up, Part 1.** Grid scrolls repaint at the restored viewport,
retry aborted cells, and record each settled scroll's visible range and number
of picture requests (including zero). Very tall folders compress scrollbar
travel below Chromium's element-height ceiling while retaining normal cell
sizes. Returning to a Library with a cancelled folder request reopens it rather
than passing the cancelled signal into new picture hydration. Validation is
batched: one disposable D:\Photos profile and the fast suites at the end.


**October 26 large-folder batch: built; speed acceptance remains open.** Folder
browsing now streams indexed rows first (64, then 256 at a time), without a
source/settings walk. A paged background walk sends differences; it does not
replace the grid. Visible photos read settings in groups of at most 32 before
picture work. Offscreen rows do not start pictures or Denoise measurements.
There is no whole-folder listing lock. Visible metadata also no longer waits
for upkeep while holding the marks lock (a deadlock found in this profile).
Switching folders aborts the stream and its helper page; reconciliation uses
a disposable on-disk seen set. Startup waits for initial rows, not the disk
check. Existing picture caches retain their own bounds.

The one requested D:\Photos profile used a disposable copy of the 155,873-row
index, no live database, and disabled settings writes/source cleanup. First
rows reached the page in 29 ms; all indexed rows were served in 34.2 s. The
first *camera preview* appeared at 40.4 s; no finished-thumbnail presentation
was recorded. The disk check stalled after 94,656 observations and timed out
at 10 minutes. The run exposed the 64-vs-32 visible-details request mismatch
and the metadata/upkeep lock deadlock, both corrected afterwards. Those
corrections were not re-profiled, respecting the single-profile budget.
Native Windows process counters observed a 1,058,508,800-byte backend peak
(1.01 GiB) and 484,302,848-byte helper peak; these are separate process peaks,
not a simultaneous total. The initial sampler measured the Python launcher
instead of its child and required an unavailable psutil; its 4 MB/zero figures
are invalid. The driver now samples the real backend with Windows counters.
The proposed 768 MiB backend working target and about-1-second first-screen
target are **not demonstrated**. Steve should try a large folder, switch to a
small one during its check, change ratings/Grade, then relaunch with the large
folder last open. Claude should inspect the per-open timeline before further
performance work. No second profile, broad sweep, push or installer build.

Final fast suites ran once: JavaScript 631 passed / 2 failed; Python 2604
passed / 2 failed / 3 skipped. All six new folder-stream behavior tests passed.
The four failures are the previously recorded library-scenes decoder fixture,
library-single-ready missing HDRLibraryScreenPreviews, test_library_rgb missing
SourceReference luminance, and test_retouch_integration CaptureCache missing
defer_store. No unrelated failure was investigated or repaired. The summarizer
read the disposable log successfully; the old profile's first-thumbnail label
was a camera preview, corrected in the new logging. Syntax and diff checks passed.

**Final Denoise batch verification, October 26.** Fast suites ran once at the
end: JavaScript 628 passed / 5 failed; three were affected measurement/warm-up
fixtures or behavior and were corrected, with four focused checks passing.
Python 2597 passed / 3 failed / 3 skipped; the new fallback cache exposed one
real identity collision in lightweight export frames with a repeated session
label. Fixed the source identity (real sessions retain their source/epoch
identity); the 19 export/cache checks then passed. Neither full suite was rerun.
The remaining two JavaScript and two Python failures are the already recorded
unrelated failures listed below; their code/fixtures were not changed.

Focused GPU checks ran sequentially in 2560x1440 Electron: the existing adaptive
reconstruction parity, Full-tier Denoise, Denoise-enabled delivery smoke, and
saved RAW export/Proof identity + encoded ceiling checks. The new registered
measurement driver passed all 52 finished-pixel corpus comparisons and verified
shared HDR/SDR measurements; the narrow Library run verified one measurement
per size and mode reuse. GPU quantile histograms replaced an initial sampled
variance estimate that failed HDR acceptance; the final limits were not relaxed.
Delivery smoke passes the task's mean/p99 tolerance; its pre-existing stricter
p99.9 diagnostic warns at HDR 3.377 against 3.0 (mean 0.780), recorded in the
Export/Proof PRD. Real RAW Proof/export bytes and exact ceiling passed on both
renderer paths. No other sweeps, push or installer build. The updated log
summarizer successfully read the disposable Library log, including GPU/reuse
sizes and durations. Mode-switch telemetry retains display epoch/count fields.



**Earlier October 26 responsiveness batch verification.** Fast suites ran once at the end:
JavaScript 631 passed / 2 previously documented failures; Python 2588 passed /
3 skipped / 3 failures. One Python failure was this batch's intentionally
changed model-cache policy: its old fixture omitted source identity and
expected finishing grades not to share a model. Updated the behavioural check
to verify grade reuse while separating source scene, HDR/SDR, size, geometry
and authored-SDR choice, and preserving stale-request guards; that one test
then passed (1.31 s). No full-suite rerun. Native AVIF serial/parallel samples
and utility fallback equality passed; serial/all-core noise-model equality
passed. The single shared Denoise GPU check passed, 0% beyond half-float
allowance (worst 0.44x allowance). No output/ceiling arithmetic changed.
The updated summarizer read Steve's existing log successfully, read-only;
its historical timings are not evidence of the new code's speed.

Remaining unrelated fast failures, already recorded before this batch:
- JavaScript library-scenes: selected development-ahead CPU fallback reports decoder failed.
- JavaScript library-single-ready: its fixture lacks HDRLibraryScreenPreviews.
- Python test_library_rgb publication guard: its SourceReference fixture lacks luminance.
- Python test_retouch_integration: its capture-cache mock lacks defer_store.

The chart now describes the committed routes and labels all timings as
historical baselines. App acceptance in both HDR and SDR is still required:
return-to-grid retention, folder scan <=0.5 s, selected RAW ~3 s, rapid jumps
without blanks, Denoise Fit <=0.5 s and cold non-RAW sharp draws <=1 s.
A cold graded Denoise jump can still lack a quick draw. Full GPU AVIF,
Denoise reconstruction optimization and avoiding full-resolution decoder
transport remain open; this batch does not claim those speed targets passed.

**October 26 batch, Part 5 (app trial pending; 1 s target open).** The bundled
libavif v1.4.1 reconstruction loop now processes independent rows on multiple
cores. The native helper requests all cores for decode and reconstruction,
retains the exact 10-bit YUV/16-bit RGB boundary, and reports both durations.
CLLI requests stay serial to preserve summation order. Grade/export imports
also use the rebuilt DLL; per-pixel colour arithmetic is unchanged. The final
fast suite includes native serial/parallel byte equality and the existing
comparison with the ordinary utility. No per-part GPU driver or profile.
The reproducible narrow patch and build instructions live with the native helper.
Full GPU reconstruction is not built. Still needed: GPU gain-map/chroma
resampling, colour/transfer reconstruction, exact quantization, guarded direct
GPU handoff and perceptual/ceiling qualification. CPU full-resolution decode,
map scaling and transport remain; timings must come from Steve's app try.

**October 26 batch, Part 4 (app trial pending; 1 s target open).** TIFF strips/
tiles and JPEG XL decode explicitly request all logical CPU cores. HEIC contexts
also use all cores instead of pillow-heif's four-thread default. These thread
settings affect Grade and export import too; the decoders and samples are
unchanged. Library HEIC auxiliary maps now use Grade's existing reconstruction,
then GPU colour preparation, reduction and direct drawing, retaining authored
SDR. Unknown auxiliaries retain Grade's existing unused-map policy; unresolved primaries remain
a CPU fallback. Decoder durations, format, GPU handoff and fallback reasons are
summarized. No per-part driver/profile; final fast checks recorded above. Cold-time
claims require Steve's try; full-resolution CPU decode/transport remain costs.

**October 26 batch, Part 3 (app trial pending; 0.5 s target still open).**
Library measurements use all CPU cores for the unchanged independent windows,
joined in their original order; the shared estimator's default is unchanged.
Models are keyed by source scene, rendition, size, authored SDR choice and
geometry rather than finishing grade. Quick draws use finished thumbnails;
with a Denoise thumbnail miss they explicitly yield to the sharp draw instead
of waiting for a model or displaying an approximate grade. This can still leave
a cold graded jump without a quick draw; exact finished-thumbnail preparation
and faster new model estimation remain open. GPU reconstruction's 32 passes
are unchanged. Grade/Proof/export keep the default worker partition and output.
The one focused GPU check, denoise-adaptive-parity, passed (0% beyond the
half-float allowance); final fast results are recorded above. A fast behavioural assertion
compares serial and parallel models exactly. No brightness limit changed.

**October 26 batch tolerance proposed before Part 3 edits.** Finished SDR:
mean Delta E 2000 <1, p99 <3; finished HDR: mean Delta E ITP <1, p99 <3.
These keep typical differences below visibility with a bounded high percentile,
without a hard per-pixel colour maximum. The exact Highlight compression ceiling
still applies, allowing only encoder rounding. Exact decoder samples remain
exact; this batch aims to change scheduling, not the look. Timing goals have
5% run-to-run allowance and remain targets until Steve's app trial.

**October 26 batch, Part 2 (app trial pending).** Main-lane folder scans have
independent admission and no longer wait for source-busy or picture-lane slots.
Stored screen preview writes may run during GPU development; CPU picture work
and indexing still yield where resources compete. RAW developments request an
exclusive GPU lease, so memory capacity no longer permits overlapping Bayer
work. Develop-ahead starts after the selected sharp draw is published; queued
lower-priority leases yield at existing stage boundaries to selected work.
The summary reports helper queue/work/yield times and GPU admission routes.
The one blank outcome was DSC07343, abandoned after 222 ms: thumbnail-pool miss,
150 ms cache check, then GPU admission wait, not a failed decode. Pool retention
and exclusive preemption address those causes; immediate pixels on every rapid
jump remain an app acceptance item. Final fast results above; no per-part GPU run.

**October 26 batch, Part 1 (app trial pending).** Finished thumbnails from all
completed canvas routes survive Single/fullscreen transitions in the bounded
recent thumbnail pool; memory reclamation removes only as many as needed.
Grid camera previews now obey the same no-thumbnail/no-grade guard as quick
draws. Camera previews are retained in 64 MiB RAM, by exact file version.
Logs distinguish extraction, memory hits, thumbnail reuse and reclamation;
the summary reports each. Final fast results above; no per-part GPU driver run.

**Batch working agreement (Steve, October 26).** Five ordered parts, each
committed locally, without intermediate stops. Run fast checks once at the
end; only shared Denoise output changes may run their focused GPU checks.
Steve tries HDR and SDR in the app, then Claude traces backend.log with
summarize_library_log.py. Logs identify routes and stage durations. Steve's
screen takes precedence over the log; discrepancies require screen inspection.


A handoff summary of the October 25–26 work so a new thread can carry on.
Details are in the dated entries below, the decisions table (section 3), the
"Known slow items to target" table (section 5) and the linked documents.

**Steve's goals.**

- Prepare a 200–300 photo folder, then flip forwards and backwards through
  finished fullscreen pictures instantly while culling and rating, with
  restarts benefiting from the stored cache.
- Cull **fresh, never-prepared folders** quickly too (a core workflow).

The responsiveness baseline is opening a folder of Sony RAWs, where camera
previews appear almost immediately. HDRF's grade and HDR/SDR look must be
preserved.

**Where things stand** (from Steve's own testing and the logs):

- **Very large folders (290831e), Steve's try on October 26, 19:45: "seems to
  work pretty great".** Opening `D:\Photos` (155,873 photos) showed first
  rows in 96 ms and a first camera preview at 0.68 s; Steve moved on after 6 s,
  so that folder's background disk check did not finish in his session. In
  Codex's disposable profile the disk check timed out after 10 minutes, before
  later lock and request-size fixes; whether a full background check of a
  155k-photo folder completes, and how long it takes, is still unverified.
  The same session's one RAW development took 2.2 s with the graphics card
  given to one development at a time (was 10–26 s).

- **After the five-part batch (a7e7da6–958e4e4), Steve's try on October 26
  evening: "so much better now".** Log 17:08–17:56: folder scans start at
  once (queue at most 1 ms, was 16–22 s); stored-preview writes wait at most
  0.3 s (was up to 29 s); no blank fullscreen; returning to the grid reused
  finished thumbnails from the recent pool (323 reuses). Denoise is still the
  slowest sharp draw: preparation median 1.2 s, worst 2.5 s (was 1.4 / 3.8 s),
  against the 0.5 s target.

- Startup cache accounting, temporary settings-file cleanup and codec probing
  no longer block the first page. Python starts alongside the Starting window;
  helper readiness overlaps page startup. The one disposable 155,879-file launch
  reached the page in 3.99 s from Python start, but its first thumbnail took
  12.14 s. Steve's own restart on the final code (October 26, 15:55) felt
  "super fast": page ready 2.4 s and first thumbnail 3.6 s from app launch,
  against 17.5 s and about 19 s that morning. Startup is done. See the
  startup follow-up below.

- Prepared photos in the ready window: sharp draw in about 5 ms.
- Prepared photos outside it: quick draw at once, sharp draw in about
  0.2–0.5 s through the scene route. Stored screen previews now bypass scenes
  in fullscreen and Single at Fit, including after restart. Disposable profile:
  226 ms first stored sharp draw, 115 ms next SDR draw, 162 ms HDR draw.
  The ~100 ms target remains open for first use and HDR.
- Plain RAWs browse well.
- Graded photos with Denoise take about 1–2 s for the sharp draw (Denoise
  preparation is the slow item).
- Never-prepared RAWs show their camera preview at once if unedited, then
  develop in about 2.8 s.
- Never-prepared JPEG/PNG/TIFF now draw their GPU-prepared thumbnail and
  screen preview before background scene acceptance and cache storage. JPEG/PNG
  originals still give an early quick draw. The dated draw-first entry below
  records both repetitions; Steve's normal-folder try is pending.
- HEIC and JPEG XL take a slower CPU route; AVIF gain-map files take seconds
  of serial CPU maths.
- Ratings show immediately; their background save is about 110 ms.
- The 2560 scene cache is full at 10 GiB (about one folder), so idle warming
  has stopped.
- Library pictures now include Film Look (fixed in 5f846b5; it had never
  been applied before).

**October 26 startup follow-up.** The unlogged pre-writer interval contained
synchronous cache inventory/retired-cache cleanup and a settings writer sweep
through every indexed photo folder. Both move to low-priority upkeep after the
first page, yielding to foreground work. Existing durable cache totals are used
at restart; a new ledger and explicit Settings usage still rebuild counts.
Pending settings writes still recover immediately and clean their own folder.
Stored screen preview directories are not scanned at launch or by cache upkeep.

Capability subprocess probing is lazy and requested after the first page.
The helper starts alongside the page rather than gating backend readiness.
The desktop now starts Python alongside the Starting window; the disposable
launch had exposed a separate 4.0 s wait for that window to finish loading.
Slow imports (at least 100 ms), recovery, helper startup and upkeep phases are
logged. Python emits each event with its newline in one locked write; the desktop
also assembles complete child-process lines. The summary accepts joined older
entries and prints both app-launch and Python-start timelines.

The one full desktop profile used copied database and caches, with copied pending
writes disabled. Live database/cache files were read only. Its measured breakdown,
in seconds from `backend_process_started`, was:

| Milestone | Steve, October 26 14:17 | Disposable copy |
| --- | ---: | ---: |
| Helper process started | 4.0 | 2.45 |
| Helper ready | 4.8 | 4.14 |
| Settings writer started | 8.6 | 2.44 |
| Backend ready | 8.7 | 2.54 |
| Page ready | 9.8 | 3.99 |
| First thumbnail shown | ~12 | 12.14 |

This profile preceded the final window/Python overlap and yielding cache-upkeep
implementation; it is not a measurement of the final commit. From app launch,
the measured page/first thumbnail were 7.99/16.14 s. The helper's historical extra
1.5 s was variable: Steve's later 15:00 log already spawned it at 1.67 s before
this change. Slow-import logging now makes recurring costs visible. The 14:17
window delay was also variable; the later live launch showed about 0.18 s.
The measured thumbnail delay includes folder listing, 1.36 s initial cache checks
and a 3.43 s first GPU queue wait. These remain open; no ~3 s success is claimed.

Stored SDR screen preview timing was 192 ms: fetch/body 146 ms, setup 13 ms,
upload 15 ms, GPU draw/wait 17 ms. Backend time inside the fetch was 85 ms:
36 ms disk read, 24 ms JPEG XL decode and 25 ms RGBA packing. No single small
change accounted for enough of the delay to establish the ~100 ms target, so
rendering is unchanged and the new per-stage timings remain for Steve's try.

Validation: fast suites ran once (JavaScript: 631 passed, two unrelated failures;
Python: 2,579 passed, three skipped, eleven failures). Nine Python failures were
Proof tests reading the old eager capability variable: their setup now calls
the lazy getter, and all nine passed on one focused rerun. Output assertions
were unchanged. Remaining unrelated failures are the selected-photo CPU fallback
(`library-scenes.test.js`), the missing stored-preview mock
(`library-single-ready.test.js`), the missing source luminance fixture
(`test_library_rgb.py`) and the old cache mock lacking `defer_store`
(`test_retouch_integration.py`). Deferred cache-count recovery, temporary-file
ownership, concurrent complete log lines and joined-log parsing checks passed.
No additional GPU sweep or desktop profile was run; the desktop profile exercised
the existing stored-preview rendering with timing instrumentation only.

**Work done** (commits, in order):

| Commit | Change |
| --- | --- |
| 68ad8f8 | Proposal recorded. Claude's architecture review is a private artifact: https://claude.ai/artifact/VhYThwAqsNTd6ogzehCymH |
| 513715b | Timing instrumentation (Step 0) |
| ae6475a | Export/grade deadlock fix |
| bb09db6 | Foreground off the shared lock (Step 1) |
| 002519f | Incremental index maintenance (Step 2) |
| 3e9bfb4 | Ready window (Step 3) |
| ccc5ac1 | Grid stand-ins (Part 0) |
| 50e0870 | Rapid navigation fixes (Part 0b) |
| 7d7bc37 | Graded stand-ins and Denoise reuse (Part 0c) |
| 021df6b | Glossary |
| a6d4f7d | Terminology in the UI and logs |
| d48d466 | RAW draw-before-store, stopped photo first (Part 0d) |
| 58ab4b1 | Use the whole machine (Part A) |
| 7bbfaa0 | Seamless swaps, indexing yields (Part 0e) |
| d436ddb | Camera-preview quick draw, development ahead (Part 0f) |
| 5f846b5 | Film Look fix |
| 5cef188 | Codec and cold-decode experiment (Part B): [evidence](../../technical/evidence/library-codecs-and-cold-decode-2026-10-26.md) |
| 37c85b2 | Cold non-RAW profiling; JPEG/PNG original quick draws |
| 84f1166 | Defer startup reconciliation and report startup/upkeep timings |

Finished briefs are in `docs/technical/archive/briefs/`
(`codex-brief-library-responsiveness-core-2026-10-25.md`,
`codex-brief-library-threads-and-codecs-2026-10-25.md`).

**Decisions made** (details in section 3 and the master PRD):

- Glossary of picture sizes and fullscreen steps (master PRD).
- "Use the whole machine" principle (master PRD principle 3).
- Fullscreen stand-ins: the photo's own thumbnail as the quick draw.
- Camera preview as the quick draw for unedited photos only.
- Cold-folder culling is a core workflow.
- "Build previews" works per photo and selection; detail (100%) previews come
  later.
- Stored screen previews use JPEG XL q90, with AVIF q90 as a valid
  alternative and Ultra HDR rejected.
- The quality rule for stored previews is Steve's blink test at Fit.
- Codex tasks use absolute minimum testing during this phase (Steve,
  October 25).
- Stored screen previews follow the live screen preview's HDR ceiling: the
  exact Highlight compression target when it is on, no extra cap when it is
  off (Steve, October 26).
- Never-prepared JPEGs are accepted for now at about 0.85–0.9 s to the sharp
  draw; the target for cold non-RAW photos is a sharp draw within 1 s
  (Steve, October 26).

**Next work.** The October 26 five-part batch is done and tried by Steve (see above); later work is separate.

1. Done: stored JPEG XL screen previews (a8540f8; SDR tried by Steve,
   sharp draw from a stored preview about 95-265 ms, mostly reading the
   file; HDR not yet tried) and the startup fix (84f1166, 64482d8; confirmed
   by Steve).
2. Denoise: all-core exact model estimation and reuse built in this batch;
   quick-draw misses no longer wait. The 0.5 s sharp-draw target and GPU
   reconstruction optimization remain open.
3. HEIC/JPEG XL/TIFF: all-core decode and eligible HEIC GPU preparation built;
   the 1 s cold sharp-draw target needs Steve's trial.
4. AVIF: native parallel CPU reconstruction built; full GPU reconstruction
   remains open (previous estimate 3–5 days).
5. Build previews command, protected prepared set and space checks.
6. Detail (100%) previews, last.

**Other open items:**

- **Switching HDR on or off is a bit slow** (Steve, October 26; for later, not
  now). Every visible thumbnail redraws, and graded photos prepare Denoise
  again, because the Denoise model reuse keeps HDR and SDR apart (batch policy
  in e94650f) although Denoise itself does not depend on the mode. Log 17:52:
  a 70-thumbnail grid took 2.9–5.1 s to finish, with about 40 Denoise
  preparations of 0.5–1.1 s; some 20-thumbnail redraws just after took
  12–21 s. There is no log line for the switch itself; add one when this is
  picked up.

- Faster rating saves would trade durability; this is Steve's call.
- 134,656 index entries still lack facts and are backfilling in the
  background.
- The scene cache allowance is full.

**October 26: startup reconciliation (Part 1).** The incremental-maintenance
change left full reconciliation in `LibraryMembership.__init__`. Small lock
holds did not make that call asynchronous: it delayed helper creation. Startup
now loads durable recovery without replaying it; the first Library page schedules
the still-needed pass after three seconds, with cancellable foreground/Grade
gates between photo families and key pages. Explicit membership commands keep
their reconciliation. Startup and upkeep appear in the log summary.

One read-only SQLite backup per phase, copied recovery records and settings,
no live data/log writes: constructor 41,375 ms / 3,327 lock operations before,
256 ms / zero reconciliation operations after. These are constructor timings,
not whole-app launch timings. Fast checks are deliberately deferred until the
end of Part 2, as Steve requested; no GPU check applies to this startup change.

**How this work is run.**

- Steve tests in the app after restarting it. Claude reads
  `%APPDATA%\hdr-finisher-desktop\logs\backend.log` with
  `codebase/tools/summarize_library_log.py` (see "Library timing logs" in
  `docs/technical/photo-library.md`).
- Claude writes outcome-focused Codex prompts that cite logged evidence and
  ask for minimal testing. Codex commits and stops for Steve to try.
- The Library picture flow chart, [`docs/technical/library-picture-flow.html`](../../technical/library-picture-flow.html),
  shows each step from launch to fullscreen and back, which process does it,
  what is kept and current timings. Update it when a step's timing or owner
  changes.

**October 26, 2026: cold non-RAW draw first, background storage (built in this commit; Steve's try pending)**

JPEG/PNG/TIFF GPU development now returns validated scene descriptions and retained
half-float GPU textures for the thumbnail and screen preview. The Library renderers
share the development device and copy these textures directly into their managed
source proxies. Pixel upload, backend acceptance and cache persistence start after
the selected sharp surface is published; drawing needs no scene-pixel fetch.
The small metadata handoff still validates source ownership/fingerprint and the
current finishing grade. Complex geometry, local adjustments and Denoise retain
the established acceptance route. Native detail previews are unchanged.

Direct scenes are keyed by source recipe plus finishing-grade identity, bounded
and expired, and forgotten on invalidation. Background publication retains the
source owner until acceptance finishes and uses the existing atomic cache checks.
GPU packing explicitly rounds to the same half-float values as persisted scenes.
Reduced scene readback is still preparation work for background storage (about
87 ms on the JPEG); it no longer supplies the viewer's source texture.

Seconds, **first visible / sharp draw**, both repetitions. These are cold source
and scene-cache misses with warmed renderers and OS file cache, measured from
initial single-view navigation through compositor presentation opportunities.
Same-photo refreshes keep that initial time origin.

| Format | Before 1 | Before 2 | After 1 | After 2 |
|---|---:|---:|---:|---:|
| JPEG | 0.393 / 1.798 | 0.656 / 1.825 | 0.327 / 0.844 | 0.390 / 0.896 |
| PNG | 0.277 / 1.786 | 0.705 / 2.137 | 0.262 / 1.067 | 0.403 / 1.094 |
| TIFF | 3.208 / 3.208 | 3.307 / 3.307 | 2.362 / 2.362 | 2.017 / 2.017 |
| HEIC | 6.815 / 7.298 | 8.109 / 8.322 | 7.857 / 7.857 | 7.579 / 7.579 |
| JXL | 5.033 / 5.225 | 5.008 / 5.341 | 6.318 / 6.661 | 4.161 / 4.945 |

All 20 cases stored successfully. Finished HDR and authored SDR pixels before
monitor encoding are exactly identical across both phases and repetitions for
all five formats. All copied inputs/photos retained their hashes; no copied-photo
sidecars were created. Only disposable copies, profiles, databases and caches
were used. No extra Library GPU driver ran.

The earlier ~2 s first-JPEG thumbnail fetch did not recur: baseline headers were
4.7/5.8 ms, backend queue 0.15/0.31 ms and packing 2.95/3.69 ms. Direct GPU draws
now make zero scene-pixel fetches. Profiler DevTools recording of complete binary
uploads caused major measurement overhead and closed its debug connection on TIFF;
bounded debug recording fixes that measurement problem. It does not establish the
historical stall's exact cause, and no speculative backend scheduling change was
made. Earlier 5–15 s figures are not directly comparable to this bounded profiler.

Fast checks ran once: Node 631 passed/2 failed; Python 2581 passed/3 skipped/2
failed. One failure in each suite is the already-known fallback/test-double issue.
The other two exposed incomplete fixtures for retained-byte accounting and valid
grade documents; those fixtures were corrected without rerunning the suites.
The profiler caught a new GPU half-rounding difference, which was fixed; only the
three affected/inconsistently instrumented samples were replaced. Its final
20-case qualification passed. No broader test run, release check or installer.

HEIC/JXL CPU speed remains open (including JXL timing variation); AVIF GPU gain-map
reconstruction remains estimated, not built. JPEG XL q90 stored screen previews
remain a recorded decision, not an implementation. That decision was already
committed in `a633430` while this work was underway and is preserved here.
[Detailed method and retained ledger](../../technical/evidence/library-codecs-and-cold-decode-2026-10-26.md#b4--cold-non-raw-direct-gpu-draw-october-26-2026).

**October 26, 2026: cold non-RAW first-picture profiling (built in this commit; partial qualification)**

Unedited, unchanged, resolved sRGB JPEG/PNG originals now offer a temporary quick draw using Grade's ICC/orientation decoder and existing source/grade/cache guards before and after decoding. Gain-map JPEGs and unresolved colour retain the normal route. Sharp-scene calculations remain unchanged. Live GPU scene handoff uses identical ArrayBuffer bytes instead of Blob upload. Added source/check/wait/transfer, CPU measurement/session and handoff telemetry; no stored-preview feature.

Both warmed-renderer baseline runs completed on disposable copies/profile/database/cache for JPEG, PNG, TIFF, HEIC and JXL. The session hit its token limit and Electron exited with it, not an app crash: JPEG first draw was 102 ms, sharp 6.826 s (before 6.254/7.785 s), with exactly unchanged finished canvas. HEIC and recovered TIFF after results do not establish a sharp-time improvement. PNG/JXL after, second after runs and remaining pixel comparisons were incomplete then; the draw-first follow-up below completes them. Fine CPU splits remain outside that follow-up. Scene handoff dominated the GPU route at 4.4–13.3 s. [Full table, stage evidence, test results and AVIF GPU estimate](../../technical/evidence/library-codecs-and-cold-decode-2026-10-26.md#b3--cold-first-picture-profiling-october-26-2026). AVIF reconstruction was estimated only, not built.


**October 25, 2026: Part 0f cold quick draws and development ahead (built in this commit; Steve's try pending)**

- Single and fullscreen can show the selected unedited RAW's camera preview
  as its quick draw when no thumbnail is available. The backend checks that
  no grade or thumbnail exists before and after extraction, and that the
  source has not changed. Presentation checks selection/source/grade again;
  a late camera preview cannot replace HDRF's thumbnail or screen preview.
  Edited photos never use this route. Part B decoding remains unstarted.
- Denoise did not acquire a new preparation regression at Part A or Part 0e.
  The earlier 250-530 ms observations mostly measured thumbnails; an 18:45
  screen-preview measurement already cost 1,630 ms. The unchanged 2560
  estimator and overlapping neighbour measurements explain the later slow
  preparation. Independent measurement windows now use the existing shared
  CPU pool and machine-derived native thread partition, with results joined
  in their original order. Exact model equality is required, not a new look.
  Large Library model requests are ordered one at a time, with the selected
  photo before queued neighbours; quick draws remain independent. Idle
  renderer warm-up also prepares the unchanged one-time noise calibration.
- The RAM handoff included two full RAW fingerprint reads, one per scene
  size. Both handoffs now share a fingerprint for the same checked source
  preparation; the owner/settings/source checks remain. Building the HTTP
  body directly from its planes removes an extra full-picture copy. Scene
  reduction, half-float storage and finishing arithmetic are unchanged.
- Development ahead is separate from the finished ready window. Once the
  selected screen-preview scene is cached or its source demand is admitted,
  uncached photos ahead in the direction of travel begin development, using
  the existing 12-photo read-ahead plan. Navigation preserves useful work and
  promotes the selected photo. Source/sensor admission prioritizes it; only
  one lower-priority source is interrupted when every source slot is full.
  Bayer RAW developments can overlap when their combined GPU reservations
  fit. Drawing and delivery remain exclusive and Grade/export/Proof retain
  precedence. No CPU development-ahead fallback or allowance increase.
- Idle folder warming stops when either scene allowance lacks conservative
  headroom. At the existing 10 GiB 2560 allowance it reserves another
  `2560 * 2560 * 12 + 1 MiB` (76 MiB); a full screen-preview scene allowance
  therefore stops warming even if thumbnail space remains. It does not
  evict existing scenes just to finish warming a folder.

Validation: the fast suites ran once: JavaScript 622 passed / 8 fixture
errors; Python 2,557 passed / 3 skipped / 11 failures. The new exact-model,
handoff and memory/priority broker checks passed. Eight JavaScript errors
were missing scheduler imports in isolated test fixtures; ten Python
failures were a wrong preview mock target and the now-parallel window read
order assertion. Those fixtures were corrected without rerunning the suites.
The remaining retouch failure is the existing CaptureCache mock rejecting
`defer_store`; it was left alone. Final review also preserved CPU fallback
when selected work joins GPU-only development ahead.

The one disposable 2560x1440 fullscreen/Single driver confirmed the cold
selected camera preview appeared with the old HDRF canvas hidden, then
stopped at its trace assertion: it selected a grid camera-preview event
instead of waiting for the fullscreen quick-draw presentation callback.
That driver fixture was corrected, but not rerun. Replacement, edited
Denoise and steady forward browsing therefore still need Steve's try;
there is no completed live-GPU performance result for this commit. No live
library database, photos, sidecars or cache folders were written.

**October 25, 2026: Part 0e seamless swaps and development priority (built in this commit; Steve's try pending)**

Supersedes Part 0d's unconditional quiet gate. Part B remains open.

- A ready-window hit replaces the previous Single/fullscreen surface in the
  same task, without first hiding it, clearing it or changing its dimensions.
  A miss still hides a different photo or obsolete grade; only the selected
  photo's correctly graded thumbnail can provide its quick draw. Background
  reclamation preserves the selected quick draw and sharp draw within the
  existing memory allowance; work that cannot fit must yield.
- Stored scenes are probed immediately, outside the quiet gate. A sharp draw
  no longer waits for a separate quick-draw development to complete. New
  development alone waits while arrow navigation is active; key release wakes
  the stopped selection immediately. The 350 ms quiet fallback still covers
  a held navigation key. Pointer selection has no fixed quiet delay.
- Live GPU developments notify the helper from source preparation through
  transfer and validation. Index pages, scans and metadata dispatch yield;
  already-dispatched EXIF children wait before their next file read/seek.
  Grade/delivery pause and cancellation still take priority. No thread count,
  cache allowance, GPU reservation or image-processing setting changed.
- Unchanged indexed facts were already retained by byte size and exact
  nanosecond timestamp. The restart regression now creates a fresh index
  object before checking reuse. Inspection used a disposable database copy:
  155,879 files, 21,223 with facts, 134,656 still without facts. All 453 badminton
  entries had facts and sampled timestamps matched disk. This supports an
  unfinished backfill, not a demonstrated reread of unchanged facts; the old
  207 job records do not identify their individual paths. A new per-folder
  reuse/pending count makes that distinction visible on Steve's next launch.
  Folder contents are still validated after launch, including changes made
  while the app was closed; these scans now yield to browsing developments.
- Development logging now retains source and GPU stage timings on the live
  route. Normal LibRaw open/unpack timings include file I/O. The explicit
  diagnostic mode reads the RAW into RAM first, separating bulk file read,
  LibRaw open and unpack; EXIF reading remains separately timed. GPU stage
  fences run only in the diagnostic driver. Stage times include scheduling
  and submission costs, not just hardware execution.

One isolated Library Single/live GPU driver passed, using copied RAWs and a
separate profile: four ready-window swaps showed no blank animation frame.
With indexing active, the scan recorded 3,068.68 ms yielded and 184.80 ms work;
metadata batches began after the measured development. This exercises scan
priority; it is not a separate measurement of already-running EXIF children.

Development breakdown (ms; one identical uncached RAW copy per condition):

| Stage | Index idle | Index active, yielding |
| --- | ---: | ---: |
| Bulk file read | 656.5 | 647.7 |
| EXIF | 38.4 | 12.9 |
| LibRaw open | 0.4 | 0.2 |
| LibRaw unpack | 56.6 | 52.6 |
| Mosaic copy and metadata | 55.9 | 56.9 |
| Other sensor preparation, including first-use setup | 99.9 | 0.4 |
| Sensor endpoint and transfer overhead | 165.0 | 132.9 |
| GPU upload | 131.7 | 80.9 |
| GPU highlight reconstruction | 263.4 | 284.7 |
| GPU demosaic | 458.5 | 517.9 |
| GPU colour and measurement | 266.3 | 310.2 |
| GPU reduction | 129.0 | 151.6 |
| GPU readback | 57.5 | 37.7 |
| Other GPU scheduling/submission | 14.3 | 13.9 |
| Quantiles | 41.2 | 38.9 |
| Thumbnail and screen preview RAM handoff | 792.9 | 713.9 |
| Whole development | **3,227.7** | **3,053.7** |

These are diagnostic samples, not medians or a causal speed comparison. OS
file caches were uncontrolled; explicit file reading adds a RAM copy and GPU
fences change scheduling. The old 2.8 s median cannot be split retrospectively:
its stage fields were discarded by the stopwatch request schema. Bulk reading,
GPU development and RAM handoff remain substantial after indexing yields;
Part A/Part B still need Steve's separate go-ahead. Normal logging now retains
sensor, GPU, quantile and handoff totals without diagnostic fences.

Fast checks ran once: Node 620 passed initially with one test-double failure;
the corrected Single tests passed (2), and navigation tests passed (6). Python
2,551 passed, 3 skipped, 5 failed initially; the five affected helper cases
passed after the focused correction. The remaining unrelated failure is
`test_library_native_source_uses_same_repair_before_reduction`: its cache mock
does not accept the prior Part 0d `defer_store` argument. It remains untouched.
No live library database, photos, sidecars or cache folders were written.

**October 25, 2026: Part 0d cold fullscreen development (built; Steve's try pending)**

This supersedes Part 0c's 120 ms gate and neighbour-development policy below.
Parts A/B and stored screen previews remain unstarted.

- Fresh GPU-developed thumbnail and screen preview data is published into the
  existing 256 MiB bounded RAM transport, rather than waiting for two disk
  writes. Fullscreen draws the developed thumbnail first and then the screen
  preview; background saving starts after the sharp surface is published.
  The CPU development fallback hands both sizes through the same RAM transport.
  Grid and idle warming still save data. No allowance, shader or picture quality
  changed. Fullscreen still excludes camera previews and other photos.
- Source identity/settings and owner checks run before RAM publication and
  again before atomic disk publication. Cache eviction can discard pending
  saves together with their RAM data. Saving holds no GPU lease. The tiny
  default-document file is saved with the background data.
- The quiet period is 350 ms, covering Steve's approximately 200 ms presses.
  Unfinished passed requests are cancelled; selecting an existing neighbour
  promotes that same request. Neighbours start only after the selection is
  sharp and otherwise use idle source slots. A new selected development
  preempts lower-priority developments at their existing cancellation boundary.
- The apparent fixed two-second lease wait was **neighbour development**, not
  an expiry/aging timer: DSC07169 held the GPU from 19:26:37.024 to 19:26:40.390,
  while DSC07168 requested its sharp draw at 19:26:38.435. Its logged wait was
  1,976 ms. Starting neighbours during the selected photo's disk writes let
  them acquire the next lease first. The new order removes that overlap.

**Capacity, read only.** At inspection, screen preview and detail preview data
used 9.9867 GiB of the unchanged 10 GiB allowance. Idle warming requires about
76 MiB of headroom for its next screen preview data plus overhead, so it was
capacity-blocked. Thumbnail data was also at 1.9973 GiB of 2 GiB. Surviving
current-recipe entries whose creation preceded the 19:25:53 startup establish
at least **334/372 RAWs (89.8%) with thumbnail data and 174/372 (46.8%) with
screen preview data**. Including the 81 indexed JPEG/PNG files below the folder,
that is at least 415/453 thumbnails and 174/453 screen preview data entries.
These are lower bounds: LRU eviction during the try prevents recovering an
exact historical total from today's files. Access-time touches were excluded
from the starting-coverage calculation; old recipe versions were checked.
No live cache, database, sidecar or photo was written for this inspection.

**One isolated Single/live GPU run, 2560x1440: PASS.** Existing fullscreen RAW
driver, cold mode, disposable copies and profile/cache/database only. Two
200 ms presses pass DSC07165 and DSC07166 before stopping on DSC07168. Neither
passed photo developed before that stopped selection. The next selection
promoted DSC07166 from neighbour work. The first correct fullscreen presentation
was a developed thumbnail in both completed requests. Photo and sidecar hashes
were unchanged. Timing is descriptive, with cold setup, concurrent Python fast
checks and ordinary machine activity; no controlled performance comparison.

Per-request seconds; lease pairs and store pairs are thumbnail / screen preview.
Quick draw and sharp draw are navigation-to-presentation times; development is
whole shared development including reading, GPU work, validation and RAM handoff.
Stages overlap and must not be added. Background store is actual per-size
`picture_stored` time; neither write delays these fullscreen presentations.

| Request / source copy | Development | Background store | Lease | Quick draw | Sharp draw |
| --- | ---: | --- | --- | ---: | ---: |
| Passed DSC07165 | not started | — | — | — | — |
| Passed DSC07166 | not started | — | — | — | — |
| Stopped DSC07168 | 3.617 | 3.348 / 3.257 | .0030 / .0023 | 4.478 | 4.848 |
| Selected DSC07166 | 2.984 shared/promoted | .104 / 3.028 | .0020 / .0027 | 2.954 | 3.518 |

The passed requests ended at 207 and 204 ms. Successful store HTTP requests
completed 6.857 and 6.515 seconds after their sharp draw submissions, entirely
in the background; these include contention/queue time beyond the per-file
store records above. GPU development including its queue was 2.146 / 1.940 s;
reading/transfer to the page was .532 / .308 s. Cold development and RAM handoff
remain visible costs. Stored screen previews (Part B and its following slice)
remain the planned capacity/finished-picture reuse fix.

Validation: Node fast checks once: 618 passed, one harness failure after the
new fullscreen hook; corrected, then 18 affected behavior tests passed. Python
fast checks once: 2,553 passed, three skipped. The final fallback handoff had
16 focused live-scene tests pass. The final four focused publication checks passed. No second GPU run, broad sweep, push or installer.
Evidence is ignored under `codebase/output/part0d/` and
`codebase/output/library-fullscreen-raw/part0d-events.json`.


**October 25, 2026: Library picture terminology (built in this commit)**

Follows Part 0c and precedes Part A. The master PRD's "Glossary: Library
pictures" is authoritative. This changes words and diagnostic labels only;
source development, pixels, priorities, timing, cache formats and allowances
are unchanged. "Scene" remains an internal name for ungraded working data.
"Stored screen preview" and "Build previews" remain planned, not new commands.
The saved-grade cache allowance still covers existing finished files; its new
label does not claim the planned persistent screen-preview workflow is built.

User-facing string review (placeholders retain their existing values):

| Old | New |
| --- | --- |
| Checking stored picture | Checking thumbnail cache / Checking screen preview cache / Checking detail preview cache (according to requested size) |
| Reading and developing source | Developing photo |
| Waiting for source reading / Waiting to read source | Waiting to develop photo |
| Waiting for GPU preparation | Waiting to develop photo |
| Waiting for GPU drawing | Waiting to draw preview |
| Drawing picture on GPU | Drawing thumbnail / Drawing screen preview / Drawing detail preview (according to requested size) |
| Drawing quick picture on GPU | Drawing thumbnail for quick draw |
| Preparing source on GPU | Developing photo |
| Reading source samples | Reading photo samples |
| Reading source | Reading photo |
| Storing prepared picture | Saving preview data |
| Reducing and storing Library pictures | Preparing thumbnail and screen preview |
| Reading the embedded SDR picture | Reading camera preview (SDR) |
| Loading {photo name}… | Preparing screen preview · {photo name}… |
| Loading {percent} · {photo name}… | Preparing detail preview · {percent} · {photo name}… |
| Loading {percent}… | Preparing detail preview · {percent}… |
| {percent} unavailable · {error} | Detail preview unavailable · {percent} · {error} |
| Saved Library picture enlarged. Check detail in Grade. | Screen preview enlarged. Check detail in Grade. |
| Native-resolution crop | Detail preview |
| Library picture error | Library preview error |
| This photo has been skipped so other pictures can finish loading. The error is remembered for future visits. | This photo was skipped so other previews can finish. The error is remembered for future visits. |
| Photo queued for a new Library picture. | Photo queued for a new preview. |
| The photo or settings changed. Request its picture again. | The photo or settings changed. Request its preview again. |
| The source settings changed while its scene was prepared. | The source settings changed while the preview was prepared. |
| Stored scene unavailable; request it again. | Preview data unavailable; request it again. |
| Scene belongs to another Library. | Preview data belongs to another Library. |
| Incomplete RGB scene/rendition payload. | Incomplete RGB preview data. |
| The cached picture is unavailable; revisit this photo. | The cached preview is unavailable; revisit this photo. |
| Library live drawing requires a hardware GPU. | Drawing Library previews requires a hardware GPU. |
| The library picture could not be drawn: {reason} | The Library preview could not be drawn: {reason} |
| {photo name}: {ms} ms to picture · {cache or route} · {KiB} KiB | {photo name}: {ms} ms to preview · {cache or route} · {KiB} KiB |
| Library thumbnail cache (accessibility label) | Library preview cache |
| Thumbnails (cache allowance) | Thumbnail data |
| Full-size pictures | Screen preview and detail preview data |
| Saved-grade pictures | Stored thumbnails and screen previews |
| Full-size pictures never displace thumbnails or saved-grade pictures. | Screen preview and detail preview data never displaces thumbnail data or stored thumbnails and screen previews. |
| Force CPU for export, Proof and saved-grade Library pictures | Force CPU for export, Proof and stored Library previews |
| The GPU-developed scene is unavailable; revisit this photo. | The developed preview data is unavailable; revisit this photo. |
| The RAW picture was released; select the photo again. | The RAW preview data was released; select the photo again. |
| This RAW exceeds the graphics card’s Library picture limit. | This RAW exceeds the graphics card’s Library preview limit. |

Log reader mapping (no old-event compatibility layer):

| Old event / field | New event / field |
| --- | --- |
| Frontend GPU/trace stages without a picture prefix (`gpu_wait`, `pipeline`, `render`, `upload`, `cache_check`, `denoise_*`, etc.) | `page_picture_<operation>` in the backend log; `picture_<operation>` in the page batch |
| `page_scene_<state>` | `page_picture_work_<state>`; the Activity text moves from `key` to `work_stage` |
| `page_stand_in_lookup` | `page_picture_quick_draw_lookup` |
| `page_embedded_preview_decoded` | `page_picture_camera_preview_decoded`, `picture_size="camera preview"` |
| `page_fullscreen_outcome` | `page_picture_review_outcome` |
| `page_present` / `page_key_to_picture` | `page_picture_present` / `page_picture_navigation_to_present` |
| `source_preparation_<operation>` / `preparation_stage` | `picture_source_preparation_<operation>` / `picture_preparation_stage` |
| `gpu_raw_sensor` / `gpu_raw_not_eligible` / `gpu_raw_developed` | `picture_raw_sensor_read` / `picture_raw_not_eligible` / `picture_raw_developed` |
| `camera_preview_ready` / `raw_browse_<outcome>` / `cache_pixels_failed` | `picture_camera_preview_ready` / `picture_raw_browse_<outcome>` / `picture_cache_pixels_failed` |
| `cache_<operation>_failed` (picture-cache audit) | `picture_cache_<operation>_failed` |
| `source_cpu_fallback` and page fallback stages | `picture_source_cpu_fallback` and `page_picture_<fallback operation>` |
| `helper_job_*`, interpretation/reply errors for the picture lane | `picture_helper_job_*`, `picture_helper_interpretation_required`, `picture_helper_reply_failed`; other lanes keep their existing names |
| `stand_in` / `sharp` | `quick_draw` / `sharp_draw`; `step="quick draw"` / `"sharp draw"` on the corresponding draw/presentation records |
| `edge=640` / display-size edge / `edge=100000` in picture logs | `picture_size="thumbnail"` / `"screen preview"` / `"detail preview"` |
| `key="live-<hash>"` / other picture `key` | `scene_key="<hash>"` / `picture_key`; transport and stored keys unchanged |
| Unlabelled shared preparation / renderer warmup | Explicit comma-separated `picture_size` and `view` lists, `scope="shared"`; per-view draw records name their actual view |
| Console `[library-picture]` timing / duplicate CPU-fallback prose | Structured `page_picture_diagnostic` / existing labelled fallback event |

The naming pattern is `[page_]picture_<operation>`; `page_` records browser
origin. Lifecycle, navigation, indexing, writer, lock and Grade events keep
their names because they do not name a picture size. Shared source work can
produce both sizes and serve several views; its lists describe that scope,
not an invented single-view attribution. Steps apply to fullscreen draws,
not decoding. No global "current photo" is used to label renderer work.

Kept unchanged: endpoint paths, scene/cache keys on disk and on the wire,
cache allowance setting names (`thumbnail`, `full_size`, `saved_grade`), DOM
selectors, scheduling internals and historical documents. Renaming them would
change formats/consumers or add avoidable risk. Existing generic "photo" and
"preview" wording remains where the action spans sizes. No live Library,
photo, sidecar or cache directory is used for this pass.

Validation: fast checks once. Node: 619 cases; initial 15 failures from isolated
modules missing the optional label helper were fixed, then all 19 directly
affected cases passed. Python: 2,549 passed, 3 skipped, 2 old-expectation
failures; both were corrected, and those two plus the stopwatch schema case
passed (3/3). The source-preparation cancellation test now checks path/state
without pinning its prose. No new wording-only tests. Edited JavaScript parses
and `git diff --check` passes.

The sole log-reading Electron driver, `library-round1.js`, ran once at
2560 x 1440 in its own copied-photo/profile directories. It timed out waiting
for `window.HDRLibrary`, before reading log assertions: a duplicate helper
insertion caused a syntax error, subsequently fixed and syntax-checked. It
was not rerun, preserving Steve's one-run limit. The renamed log reader is
updated, but its end-to-end assertions are not qualified by this pass.
No push, installer, live Library/database, original photo, sidecar or cache
folder was touched.


**October 25, 2026: Part 0c graded fullscreen scheduling (built; Steve's retry pending)**

The 18:45–18:47 badminton logs contain 216 Single/fullscreen requests. DSC07224's
640 draw queued for 2,937 ms and its stand-in arrived at 3,047 ms. DSC07178's
640 draw queued for 3,161 ms; the already-prefetched sharp picture won the
presentation race, so no stand-in reached a compositor opportunity. This is a
queue/presentation race, not evidence of a grade identity mismatch. Finished
borrowed grid surfaces could also be removed by sharp-source reclamation.

- Quick 640 pictures now have an independent renderer and priority queue.
  They use the same finishing graph, grade, HDR/SDR selection and shared GPU
  leases. They never join the sharp draw queue. Selected sharp work takes
  precedence over all queued neighbours; only one sharp draw can be active.
- Model measurement happens before the draw queue. Sixteen exact Library
  model requests are retained across navigation, independently of grid cache
  churn; quick and sharp renderers share these small JSON results. Keys include
  source/grade, lane, edge and geometry. No source arrays or additional Denoise
  image textures are retained. GPU and finished-picture budgets are unchanged.
  Reconstruction, scratch allocation and the film/grain/halation graph remain
  real costs on a redraw; speeding up those algorithms is outside this part.
- After the existing 120 ms quiet gate, all four in-window neighbours begin
  quick and sharp preparation while the selection loads, rather than waiting
  for its sharp picture and then preparing neighbours serially. Source jobs
  still share the existing slots and both renderers obey the existing broker.
  This improves readiness at about two photos/s; it cannot guarantee cold sharp
  draws at that pace when the unchanged finishing graph exceeds 500 ms/photo.
- A borrowed visible grid stand-in survives ordinary Library reclamation. Its
  bytes stay counted; mandatory reclamation can still release it to honour the
  existing budget. Exact photo/source/grade/display/rendition checks remain.
  In-progress prefetch stages now follow the request that selects the photo.

A cheaper look-preserving future route is to retain/store the *finished* Fit
picture after its first complete draw, then reuse/decode that result. Part B
qualifies the codec first. Changing Denoise quality, grain, halation, sharpening
or Fit resolution is not part of this work. No appearance setting or shader changed.

Validation: one fast run, **619 Node passed; 2,551 Python passed, three skipped**.
Final focused results: **14 passed**, including exact stand-in identity, cancellation,
independent quick work, selected queue order, model separation/reuse and RAW budget
handling. A factory closure typo was caught and corrected by the first focused
result run. The first GPU launch command stopped before Electron started because
the disposable profile directory was missing; creating it allowed the one actual
GPU driver run below. No sweeps or additional GPU runs.

**One graded Single/live GPU try at 2560x1440: PASS.** The existing fullscreen
RAW driver used disposable RAW + sidecar copies of DSC07178, DSC07253 and DSC07254,
with source names mapped below. It checked a forced missing eligible grid surface,
a held sharp draw, back/forward navigation and ten 30 ms reversals. It verified
that no wrong photo appeared, the stopped selection finished sharp, and all six
copied photo/sidecar hashes stayed unchanged. The backend profile/database/cache
were isolated under ignored output.

Per-request milliseconds (rows 8–17 are rapid reversals). Sharp-ready is the
logged window completion, before presentation; it is not physical scanout.
A dash means work was already prefetched, or that no stage was recorded under
this selection, **not a zero cost**. Denoise columns separate CPU model preparation,
selector/pipeline installation, and GPU resolve. Nested render time is not added.

| Request | Photo | Stand-in | Sharp ready | Draw queue | Model prepare | Denoise install / resolve |
| ---: | --- | ---: | ---: | --- | --- | --- |
| 1 | DSC07253 | 6.7 | 3863.5 | 309.7 | 3150.6 cold | 0.1 / 44.2 |
| 2 | DSC07178 | 123.4 | 461.3 | 0.2 / 0.1 | 0 / 0 hits | 0 / 16.8; 0.2 / 43.3 |
| 3 | DSC07253 | 9.2 | 265.4 | — | — | 0.1 / 34.2 |
| 4 | DSC07254 | 13.5 | 151.8 | — | — | — / 35.6 |
| 5 | DSC07253 | — | 1.0 | — | — | — |
| 6 | DSC07178 | — | 0.5 | — | — | — |
| 7 | DSC07253 | — | 0.6 | — | — | — |
| 8 | DSC07254 | — | 0.7 | — | — | — |
| 9 | DSC07253 | — | 0.9 | — | — | — |
| 10 | DSC07254 | — | 0.6 | — | — | — |
| 11 | DSC07253 | — | 0.8 | — | — | — |
| 12 | DSC07254 | — | 0.8 | — | — | — |
| 13 | DSC07253 | — | 0.8 | — | — | — |
| 14 | DSC07254 | — | 0.9 | — | — | — |
| 15 | DSC07253 | — | 0.8 | — | — | — |
| 16 | DSC07254 | — | 0.8 | — | — | — |
| 17 | DSC07253 | — | 0.8 | — | — | — |

There were four stand-in and 11 sharp compositor-opportunity records. Two requests
(rows 5–6) advanced after the visible-canvas check before the two-frame callback,
so their presentation is unlogged although their correct sharp surfaces were ready.
Rows 1–4 also advanced before sharp presentation callbacks. The 11 confirmed sharp
presentations arrived in 2.0–11.8 ms. Driver-observed normal navigation sharp arrivals
were 162, 6, 4 and 8 ms. Artificial held draws/transport delay and a three-photo
window mean this is **not** a sustained two-photos/s benchmark.

Full request IDs, separate stage arrays and confirmed sharp-presentation times:
ignored `codebase/output/part0c-after-requests.csv` and `.json`; raw records in
`codebase/output/library-fullscreen-raw/part0c-events.json`.

**Remaining:** first-use model measurement was 3.15 s with concurrent preparation
in this try; cold/evicted models still require measurement. Repeat preparation was
below 0.1 ms and selector installation 0–0.2 ms. GPU reconstruction (16.8–44.2 ms
here), film/grain/halation, fetch/upload and one already-active sharp draw remain.
The 309.7 ms selected queue wait followed one in-flight draw; the forced 640 request
queued only 0.2 ms. No claim that cold first draws or a long graded sequence are now
instant. Steve's normal-use retry remains the feel check.
Parts A and B remain unstarted. Part A (threads) is next; after it, remeasure
"Known slow items to target" during a short normal-use run and update that table
before starting Part B. The previously uncommitted slow-items table is included
in this commit. No live library database, photo, sidecar or cache-folder writes.

**October 25, 2026: Part 0b rapid fullscreen navigation (built; Steve's retry pending)**

Steve's badminton try at 16:29–16:32 exposed missing grid stand-ins, repeated
source preparation and cancelled Denoise draws. This follow-up supersedes
Part 0's restart-on-selection policy below; Parts A and B remain unstarted.

- If no eligible finished grid picture exists, Single draws the stored 640
  scene with the current grade and HDR/SDR shaders before the sharp picture.
  A stored-scene miss waits for 120 ms of navigation quiet before preparing
  the source; 30 ms arrow repeats therefore do not start developments for
  photos merely passed. A stopped source miss produces its 640 picture first.
  Filmstrip source misses also wait for the selected sharp picture.
- In-progress source preparations and draws survive direction changes while
  their exact photo/source/grade/display identity remains in the window.
  Selection promotes existing demand to priority zero without restarting it.
  Grade/source/display invalidation and leaving the window still cancel it.
  A submitted in-window draw finishes before the next draw uses the shared
  renderer; an arriving selection does not cancel that draw.
- Before RAW GPU reservation, release finished Library window/tile surfaces
  when necessary. Retry a budget refusal after reclamation; a running window
  draw finishes before another attempt. Pending draw surfaces are not evicted.
  Genuine GPU failures or insufficient memory after Library eviction retain
  the existing CPU fallback. Memory limits and the rendering graph are unchanged.
- Library Denoise model hits now use metadata before opening any stored pixel
  arrays, keyed by source/grade, lane, edge and geometry, in the existing bounded
  model cache. First measurement and GPU Denoise reconstruction remain unchanged.
- Library `live-` Denoise/mask requests previously entered the middleware's
  blanket session/Grade pause. An open Grade session also polls settings every
  500 ms while Library is visible. Those reads, settings checks/saves and
  Library revert-menu operations no longer count as Grade activity. Actual
  Grade loads acquire the pause inside their route; normal Grade editing/import
  and delivery gates remain. Library renderer initialization also no longer
  advertises itself as Grade.

Each navigation now logs a terminal `fullscreen_outcome`: whether any picture,
a stand-in and/or a sharp picture reached a compositor opportunity. A request
with no presentation is explicitly counted blank, including rapid supersession.

Read-only baseline from Steve's 16:29–16:32 logs: **177 requests, 13 with no
logged picture, 72 stand-in presentations and 127 sharp presentations** (a
request may have both). There were 45 helper-pause events. Independent stage
p50/p95 in milliseconds: cache 16.2/183.6; queue 0.1/294.0; lease 1.6/27.2;
fetch 68.9/100.8; upload 15.4/17.4; Denoise analysis 156.9/1463.1; render
35.2/1471.0; present 4.1/9.2; key-to-picture 6.1/625.7. Nested stages must
not be added; these describe the original try, not a controlled benchmark.
Per-request breakdown is retained in ignored
`codebase/output/part0b-before-requests.json`.

**Short disposable-copy try, one Single/live GPU driver at 2560x1440: PASS.**
The driver forced a missing eligible grid surface, checked the correct 640
stand-in during a held sharp draw, then navigated portrait/landscape and made
ten reversals at roughly 30 ms per tap. No wrong photo was displayed and the
stopped selection finished sharp. Four observed sharp arrivals were 231, 9, 7
and 5 ms (driver checks, distinct from presentation records).

The per-request presentation log contains **17 requests, four stand-in and 11
sharp presentations, two without a logged picture**. Both unlogged requests
were ordinary driver steps advanced after the visible-canvas check in under
one display frame; all ten paced reversal requests logged sharp. There was no
blank stopped selection. Full records, including each request's stages and
blank flag: `codebase/output/part0b-after-requests.json` and `.csv`.

| Stage | Trial p50 / p95 ms |
| --- | ---: |
| Cache check | 50.5 / 66.0 |
| Queue | 0.1 / 0.1 |
| Lease | 2.5 / 2.9 |
| Pixel fetch | 89.2 / 94.3 |
| Upload | 15.8 / 24.9 |
| Render | 41.0 / 87.1 |
| Present | 6.9 / 9.1 |
| Key to picture | 8.4 / 66.8 |

Only three draws reached these selected-request stage logs; kept pictures
reuse work begun under another request. The trial includes deliberate draw/
transport delays and ungraded disposable RAW copies, so it is not a badminton
performance comparison and supplies no new Denoise timing. The final settings-
poll pause fix followed this GPU run; it was covered by focused Python results
without spending a second GPU run.

Validation: one full fast run, **616 Node passed; 2,550 Python passed, three
skipped**. Final result checks: **23 Node and three Python passed**, including
wrong-photo/grade rejection, in-progress window completion/promotion, source
quiet gating, cache reclamation before reservation, Denoise reuse, and settings
checks/saves versus real Grade loading. The first final Python check exposed
a worker-module/instance reference error; corrected and the same three checks
passed. No live database, photo, sidecar or cache-folder writes. Stop for Steve
to restart the app and retry the badminton folder before Parts A and B.

**October 25, 2026: Part 0 fullscreen navigation (built; followed by Part 0b above)**

Single/Fit borrows the selected photo's existing finished grid/filmstrip WebGPU
canvas until its sharp picture arrives. The actual HDR/SDR surface is moved and
restored; there is no JPEG encoding, CPU readback or colour conversion. Only
`library-live` pictures with matching photo/source/grade identity, display epoch
and rendition qualify. Camera embedded previews never qualify. Finished grid
cells now survive entry into Single inside the existing 512 MiB tile pool.
No extra surface is allocated for the stand-in. Cancellation, invalidation,
leaving Single and entering Compare restore it to its owner.

The selected source probe, preparation and draw preempt lower-priority work;
submitted GPU work must still finish. An unfinished neighbour selected by Steve
originally restarted its demand at priority zero; Part 0b above replaces this
with promotion of the same work.
Memory polling preserves selected work during source loading, while Grade,
export/Proof and the existing memory limits still take precedence. The existing
forward-biased two-neighbours-each-side window remains; no budget changed.
For neutral geometry, stored half-float pixels are packed directly from the
requested HDR/SDR lane. Other geometries retain the existing path. Exact packed
byte checks cover HDR and authored/non-authored SDR, signed/bright values and
padded rows. No shader, effect setting, export or Proof pixel change.

**Why graded Fit remains expensive.** Existing normal-use logs put most of the
wait in the finishing graph: 1,746/2,454 ms render p50/p95, excluding fetch/upload.
Read-only inspection of two slow badminton sidecars (DSC07217 and DSC07178)
confirms adaptive Denoise in both lanes, Portra 400, grain amount 24 and halation;
there are no local adjustments. DSC07178 also has sharpening amount 28.
Each new Library scene reconstructs the Denoise model via the backend and runs
adaptive reconstruction (32 dispatches per 512-pixel tile), then the film/grain/
halation graph. Scene reset discards working resources between pictures. These
are concrete repeated costs, but old logs do **not** isolate their individual
shares; attributing all 1.7–2.8 seconds to Denoise or grain would be unsupported.
Pipeline/highlight-anchor calls in the existing logs are generally sub-ms.
Library-only per-request Denoise analysis, direct reconstruction and local-mask
timings now separate those waits on the next try; tiled reconstruction remains
inside render time. Nested stage timings must not be added together.

Options, with no look change applied: retain finished previews (Part B qualifies
the storage format); retain reusable Denoise models/results within existing
budgets; avoid rebuilding identical effect resources. Drawing below 2560 pixels
or simplifying Denoise/grain/halation could be cheaper but can change appearance
and requires Steve's approval. The immediate stand-in leaves all effects intact.

**Key-to-picture evidence.** Existing live logs, read only, before Part 0:
87 navigation events, 60 sharp presentations, 28 cancellation events (a request
can appear in both groups), zero stand-ins. Independent p50/p95 milliseconds:

| Stage | Existing normal-use logs | Step 3 follow-up driver |
| --- | ---: | ---: |
| Cache check | 28.9 / 514.6 | 17.6 / 33.2 |
| Queue | 0.2 / 87.4 | 0.1 / 2.3 |
| Lease | 2.0 / 715.8 | 1.9 / 1.9 |
| Pixel fetch | 233.7 / 603.0 | 189.0 / 213.7 |
| Upload | 15.5 / 17.7 | 16.2 / 16.2 |
| Render | 1746.2 / 2453.8 | 31.5 / 32.5 |
| Present | 4.3 / 8.7 | 8.2 (one logged sample) |
| Key to picture | 433.2 / 3253.5 | 9.0 (one logged kept hit) |

The one authorized Step 3 driver ran **before** Part 0, once at 2560x1440,
and passed. Its photo-path/edge observations confirmed four navigation sharp
arrivals at 366, 260, 249 and 6 ms, including portrait/landscape; these are driver
observations, not compositor timings. Only one sharp presentation reached its
buffered log before teardown; zero stand-ins existed then. Neither dataset is
a controlled before/after comparison. No Part 0 GPU rerun was made. Post-change
stand-in/sharp counts and key-to-picture breakdown await Steve's short try;
`stand_in`/`sharp` flags now distinguish first stand-in and subsequent sharp
presentations, with cancellation recorded until sharp is presented.

Validation: 612 Node checks passed in the one fast run, including stand-in
identity/mode/camera rejection and selected-neighbour completion. Python: 2,549 passed, three skipped in the one fast run. Final view-cleanup/
logging and own-source polling edits: 23 focused Node checks passed. No failures.
No live database, photo, sidecar or cache-folder writes. Parts A and B have not
started; stop here for Steve to try forward/back arrows, rapid reversals, then
stop on a graded photo; also change grade and HDR/SDR and revisit it.

**Fullscreen selection (October 24, 2026).** Entering Single/fullscreen with F
hides the previous photo until the selected photo has finished drawing. The
caption follows the selection immediately; waiting for source or GPU work must
never display a different photo. This also applies to Single-view navigation.

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
the ordinary cache eviction policy. Active preparation is bounded. The October 25 Part 0 change above lets the
selected Single photo preempt lower-priority probes and preparations; other
requests still wait for the next preparation slot. The next folder pass can reconsider cache headroom.

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

| Date | Batch decision | Status |
| --- | --- | --- |
| October 26, 2026 | Open folders from the index immediately; a background disk check applies differences. Briefly showing deleted photos or missing newly added photos is accepted. Unindexed folders stream discovery. Visible settings and pictures have priority; cancel on folder switch. | Built; first-screen, relaunch and memory targets await app acceptance |
| October 26, 2026 | Five ordered local commits; one final fast run; focused Denoise parity only; Steve tests HDR/SDR and Claude summarizes backend.log. Screen wins over logs. | In force |
| October 26, 2026 | Finished thumbnails before camera previews; bounded file-version camera-preview RAM reuse. Exclusive GPU development, folder scans admitted independently. | Built; app trial pending |
| October 26, 2026 | GPU noise measurement for Library/Grade/export/Proof; persistent source-pixel identity excludes finishing grades and shared HDR/SDR names. Authored SDR separate; source/size/resampling changes invalidate. Mean <1/p99 <3 on finished pixels; exact HDR ceiling. | GPU corpus, shared renderer parity, Proof/delivery and copied RAW timing checked; 50 ms thumbnail/0.5 s Fit targets remain open |
| October 26, 2026 | Exact all-core Library noise models; no approximate Denoise quick draw. SDR mean Delta E 2000 <1/p99 <3; HDR mean Delta E ITP <1/p99 <3; exact Highlight compression ceiling. | Proposed tolerance recorded before edits; output arithmetic unchanged |
| October 26, 2026 | All-core codec decode; Library HEIC reconstruction followed by GPU colour preparation. Parallel libavif rows before a full GPU route. | Built; timing targets remain open |


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
| **Fullscreen stand-in: the photo's own finished grid picture.** While the sharp fullscreen picture loads, show that photo's finished grid/filmstrip picture scaled to Fit (same grade and HDR/SDR mode), then swap. Never another photo or an obsolete grade. Adjusts the October 24 hide-until-ready behaviour. | Steve, 2026-10-25 |
| **Camera preview as a quick draw, unedited photos only.** When a photo has no thumbnail yet and has no grade, fullscreen and Single may show its camera preview immediately, then replace it with HDRF's picture. Edited photos never show a camera preview. Amends the October 14 rule. | Steve, 2026-10-25 |
| **Cold-folder culling is a core workflow.** Users often cull folders the app has never prepared, so stored previews cannot be the only route to speed. Every supported format needs a fast first picture on cold visits: camera previews for RAWs, and fast in-process decoding for JPEG, HEIF, AVIF, TIFF, PNG, EXR, DNG and similar (the file itself as the quick draw when unedited). Edited photos need fast development and finishing. Stored screen previews speed up returning to a folder; they do not replace cold speed. | Steve, 2026-10-25 |
| **Stored screen preview format: JPEG XL q90** (distance 0.4, effort 3, decoding speed 1, all threads), as separate HDR (PQ 16-bit, BT.2100-tagged) and authored-SDR (sRGB 8-bit) files. About 2.3 MB per photo for both, about 4,400 photos per 10 GiB. Decode about 20 ms per rendition with 12 threads. Its decoded peak stayed at the 1000-nit edge in the Part B probe. **AVIF q90 remains a valid alternative** (native Chromium decoding, similar size, tiles needed for multi-core decoding, slight ceiling overshoot needs a post-decode clamp). Ultra HDR was rejected: visible artefacts in backgrounds at q90 and q95. **Quality rule for stored previews:** visually identical at Fit in Steve's blink test on his graded photos. This replaces the per-pixel perceptual guide for codec texture only; the guide still governs Library-vs-Grade/export colour agreement, and the exact HDR ceiling still applies. Fullscreen/Single Fit storage built October 26; Steve's blink test pending. | Steve, 2026-10-26 |
| **Stored screen previews follow the live HDR ceiling.** When Highlight compression is on, the decoded stored HDR preview never exceeds its target (encoder rounding only; a post-decode clamp is fine). When it is off, the stored preview matches the live screen preview with no extra cap, so a stored preview never looks different from a fresh one. | Steve, 2026-10-26 |
| **Cold non-RAW sharp-draw target: within 1 s.** About 0.85-0.9 s for never-prepared JPEGs (8b64302) is accepted for now; faster is wanted later. | Steve, 2026-10-26 |
| **Manual built previews work per photo** (any selection, also offered on folders), protected until discarded. Native 100% previews wait until everything else is fast. Design open; see Prepared-folder fullscreen culling. | Steve, 2026-10-25 |

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

**October 26: stored screen previews, fullscreen first.** Built automatic
background capture and JPEG XL q90 storage of finished 2560 screen previews,
with separate PQ 16-bit BT.2100 HDR and authored sRGB 8-bit SDR files. The
below-normal helper has a separate write lane which yields to foreground
work and Grade; two bounded uploads prevent folder-sized RAM queues. Fit
reads validate the complete grade (including Film Look), source stamp, source
settings, rendition, display dimensions and format version. Misses and stale
entries use the existing scene route. The ready window shares its existing
memory allowance; 100% uses the detail preview and hides the stored Fit picture
while detail is pending. A separate fixed 10 GiB oldest-first allowance leaves
the scene cache policy unchanged. Cache off also disables these reads/writes.

The focused disposable real-photo profile used a copied RAW/sidecar and an
explicit disposable scene cache. The scene-route sharp draw was 326 ms,
with capture disabled during that baseline to compare today's route fairly.
After a process restart, with scene loading deliberately forbidden, stored
sharp draws were 226 ms first use, 115 ms next SDR draw and 162 ms HDR. The
~100 ms target is not met on first use or HDR; local transport and first-use
setup remain open. A compression-on copied photo near the target decoded at
999.86 nits against 1000 nits. The first failed harness attempt selected the
shared scene cache before the explicit disposable cache was added; the live
Library database, original photos and sidecars were not changed. No quality
study or broad GPU sweep; Steve's Fit blink test remains authoritative.

Next: Steve's normal launch and Fit/100% try, first-use/HDR transport latency,
then Build previews, a protected prepared set and disk-space checks. Those
preparation commands and protection policies are not built. Under pressure,
background capture may be skipped; a later finished screen preview retries it.

**Validation, once at the end of both parts.** Node: 632 passed, one existing
development-ahead CPU-fallback test failed (`library-scenes.test.js`, decoder
failed). Python: 2,585 passed, three skipped, two unrelated fixture failures:
`test_rgb_description_precedes_pixels_and_keeps_publication_guards[None]`
constructs a SourceReference without the required luminance field;
`test_library_native_source_uses_same_repair_before_reduction` has the
already documented cache mock without `defer_store`. The three new stored
screen preview checks passed (restart/grade/source identity, decoded HDR ceiling
on/off, independent oldest-first removal). No repeat of the broad fast suites.




## Part A — Use the whole machine (October 25, 2026)

Part A built in this commit; Part B remains open. Counts derive from logical
CPUs, with one shared Python CPU pool per process, inline nested work, and a
photo/native partition to avoid a team per core per photo. On this 12-CPU
machine the helper/source partition is three photo lanes with four native
threads per photo. Selected RAW development takes all free CPUs; neighbours
wait while selected RAW work exists. Idle neighbours divide all CPUs between
the available background processes (six threads each here). If an already
running LibRaw call occupies the last CPU, the selection may start with one
foreground thread: a temporary maximum of CPUs + 1 native threads avoids
queuing the selection behind non-interruptible neighbour unpack. One-process
machines let that lane serve both foreground and background work. Helper preparation and metadata yield to
selected RAW work too. Existing Grade/export/Proof pauses remain authoritative.
Helpers, metadata processes and the RAW reader run below normal priority;
selected RAW decoding retains its foreground promotion. Budgets and cache
allowances are unchanged. No decoder-library replacement or Part B work.

| Limit | Before | After (12 logical CPUs here) |
| --- | --- | --- |
| Helper native team | CPUs / 2 | CPUs / floor(sqrt(CPUs)): 4 per photo, 3 shared admissions |
| Helper decode / picture / map lanes | 1 / 6 / 2 | Machine-derived photo lanes: 3 each; main and picture share admission |
| Index reader lanes | 1 | 12 low-priority processes; single helper coordinator and DB writer |
| RAW decode | 3 processes, OMP/BLAS 1 | Machine-derived processes (3 here), limited by existing transport allowance; selected OMP up to 12, neighbours divide CPUs; unused BLAS teams stay 1 to avoid nesting |
| Grade import bands | At most 2 | 12 shared CPU workers; negative-mapping bands divide the original concurrent scratch allowance |
| Gamut / brush | Half CPUs, at most 8 | Up to 12 shared CPU workers; helper uses its photo partition; brush's measured small-image threshold retained |
| Grain / Denoise CPU | CPUs minus 1, at most 8 | Up to 12 shared CPU workers, bounded by available bands/tiles |
| Retouch | 1 solve | Shared CPU pool; existing two owned ROI snapshots retained as memory bound (up to two independent solves) |
| Source hash | 1 | 1: SHA-256 byte-stream order defines source identity; file I/O overlaps import |
| Ultra HDR export stripes / gain-map channels | 2 / 3 | min(CPUs, 2) / min(CPUs, 3): existing stripe scratch allowance and only three independent colour channels; per-channel arithmetic and serial writer unchanged |
| Source slots / heavy slots | 2 / 1 | Machine-derived photo lanes: 3 / 3; existing preemption and GPU broker admission retained |
| Metadata read batches | 32, serial | max(32, 4 × CPUs): 48, parallel waves; DB/maintenance pages remain 32 for short lock holds |
| Source AVIF | Implicit CLI default | Explicit machine-share `--jobs`; bundled avifdec already defaulted to all CPUs, so no claimed decoder speed-up |
| Source Ultra HDR | Per-photo CLI | Same decoder: bundled 1.4.0 tool exposes no thread option; keeps its native scheduler. Propose an independently qualified in-process binding later, since source-import accuracy must be preserved |
| Lens remap | At most 6 | Machine-sized shared CPU pool |
| Grade import job / RGB resize lanes | 1 / 3 | Retained-image memory ownership / three independent channels; image bands scale within the import |

On Windows, Python's metadata process pool has a 61-child wait-handle limit;
this is an OS/library limit, not a chosen background CPU reserve. Native work
can use further CPUs. The Library helper is non-daemonic so it can own those
readers, and closes them on shutdown. Metadata workers only return facts; they
never open the Library database. Maintenance remains scoped to changed paths.

**One short scratch trial, 10% timing noise allowance.** A copied 85.5 MB,
42 MP Sony RAW: one-thread unpack/decode 77.6/230.4 ms; twelve-thread
77.8/193.4 ms. Decoded uint16 transport bytes matched exactly. Unpack did not
improve; the complete CPU decode fell about 16%. This is a warm local-drive
copy, not Steve's USB drive, and excludes GPU development and cache writes.
Twelve copied RAW metadata reads: serial 75.8 ms; parallel including process
startup 477.4 ms; one different set of twelve copies with warm processes
9.7 ms (about 7.8× throughput). Metadata records matched exactly. No 155k-photo
throughput claim: directory walks, transactions and storage still matter.
Scratch script/results: `codebase/output/part-a-cpu/` (ignored).

**Validation.** Fast Node checks ran once: 607 passed, 12 failed because the
VM browser harness lacked hardware concurrency. The two affected files then
passed all 14 checks, including scaled heavy-source admission. Python fast
checks ran once: 2529 passed, 3 skipped, 19 failed and 7 errored. Twenty-five
failures/errors were the new optional helper hook being accessed eagerly in
test routes with no helper or a lightweight helper; fixed. Focused rerun: 85
passed, including shared/nested CPU work, exact import-band results, concurrent
Retouch cache accounting and helper lifecycle/pause behavior. One unrelated
pre-existing failure remains: `test_retouch_integration.py::test_library_native_source_uses_same_repair_before_reduction`
has a cache mock without Part 0d's `defer_store` argument. It was not changed
or rerun. A final actual-RAW-worker check on two scratch copies simulated a
one-CPU machine: background and selected work both completed, transport bytes
matched, and the foreground yield hook released correctly. No GPU code,
drivers, sweeps, installer build or live-data writes.

**Next app session to finish the slow-items remeasurement.** Open badminton
fullscreen and arrow through 30 uncached photos, pausing on each until the
sharp draw appears. Then revisit the same 30. Include DSC07178, DSC07253 and
DSC07254 so existing logs split Denoise, other drawing, source read/unpack,
development, cache writes and scene fetch. Leave a not-yet-indexed pin running
idle for 60 seconds, then browse fullscreen for 30 seconds: compare metadata
work and yield time. If indexing is already complete, do not reset the live
index just for this trial. For the unchanged export row, export one copied
full-size photo with the usual Ultra HDR preset into a scratch output folder.
Highlight reconstruction needs the existing 42 MP difficult RAW at Fit; leave
it selected until sharp, then inspect its stage logs. Rate one copied photo
to check save timing. These observations will update the table from the next
session's logs; no live data/cache was modified by this task.

### Known slow items to target (Steve, October 25, 2026)

A running list of measured or suspected slow work, kept so each can become its
own task. **Part A scratch remeasurement is recorded below; fullscreen/USB
figures await the exact next-session app trial above.** Figures are
from Steve's machine and logs on October 25, unless stated otherwise.

| Item | Evidence | Status |
| --- | --- | --- |
| **Large-folder scroll / camera details / disk checking** | October 26 app log: requests stopped, no EXIF reads, disk check closed when Grade opened; recovery resumed in a reconcile burst. | Three fixes committed: viewport retries/logging, demand-prioritized details, persistent yielding disk checks and 16-family recovery pieces. Single follow-up profile changed to Play_Raw and timed out; D:\Photos timings remain unverified. Final startup and telemetry corrections unprofiled. Steve app trial required. |
| **Very large folder opening** | October 26 disposable D:\Photos: first rows 29 ms, all 155,873 indexed rows served 34.2 s, first camera preview 40.4 s, no finished-thumbnail milestone, disk check timed out after 10 minutes. Backend peak 1.01 GiB. | Index-first streaming, bounded settings reads/disk pages, difference updates and metadata lock fix built. The one profile preceded the final request-size/deadlock fixes. About-1-second first screen, 768 MiB working target, disk completion and fast relaunch remain unverified; Steve app trial required. |
| **App startup** (after the 155k-photo D:\Photos index) | October 26 14:17: helper spawn 4.0 s, backend ready 8.7 s, page ready 9.8 s, thumbnails ~12 s from Python start. One disposable 155,879-file launch after removing blocking sweeps: 2.45 s / 2.54 s / 3.99 s / 12.14 s respectively. It also exposed 4.0 s before Python started. | Cache accounting and temporary-file cleanup deferred with foreground yielding; codec probing delayed; helper startup overlaps the page. Final shell change overlaps Python with the Starting window (not re-profiled). Targets remain open: folder listing, 1.36 s initial thumbnail checks and a 3.43 s first GPU queue wait still delay thumbnails. Steve's restart 15:55: page ready 2.4 s, first thumbnail 3.6 s from app launch; felt super fast. **Done.** |
| **Back to grid after Single/fullscreen** | October 26: all 14 exits used camera previews; finished-thumbnail delay 0.4–4.2 s or over 5 s. | Finished routes now retained/reused by current grade and HDR/SDR mode; camera previews retained in 64 MiB RAM. Bounded-memory eviction can still require drawing again. App acceptance pending. |
| **Folder opening during RAW development** | October 26 scans queued 16–22 s for about 40 ms work; stored writes queued 24–29 s. | Main scans admitted independently of source-busy/picture slots; stored writes no longer blocked by GPU source-busy. End-to-end 0.5 s target remains open (indexed listing alone was 0.5–0.66 s). |
| **Stored screen preview sharp draw** | Disposable real-photo restart: 226 ms first stored draw, 115 ms next SDR draw, 162 ms HDR; scene route 326 ms with capture disabled for the baseline. No scene dependency on stored hits. | Fullscreen and Single Fit built. ~100 ms first-use/HDR target still open; Steve's blink test and 200–300-photo workload pending. Build previews/protected set/disk-space checks deferred. |
| **Cold first picture for non-RAW formats** (October 26: all-core TIFF/HEIC/JXL and auxiliary HEIC GPU preparation built; app timing pending; core workflow, see decisions; target sharp draw within 1 s, Steve October 26) | October 26 draw-first follow-up: two cold-source repetitions per phase for JPEG/PNG/TIFF/HEIC/JXL; see dated entry and B4 evidence. | JPEG/PNG/TIFF direct GPU thumbnail/screen preview built. HEIC/JXL CPU speed and AVIF reconstruction remain open; stored screen previews now serve returning Fit pictures. OS cache warm; Steve's normal-folder try remains separate. |
| **Cold RAW development** (October 26: exclusive GPU developments, develop-ahead after selected sharp draw; app timing pending; badminton, 21:36) | About 2.8 s per uncached RAW: file read about 0.65 s (USB drive), GPU development 1.3–1.4 s, RAM handoff 0.7–0.8 s. | Measured baseline; Part 0f removes repeated fingerprint reads and an extra handoff copy, and adds directional development ahead. Steve's timing try pending. |
| **Denoise in Library drawing.** GPU measurement and persistent source-pixel reuse built October 26. Finishing grades and shared HDR/SDR pixels do not re-measure; authored SDR remains separate. | Historical CPU measurement: screen preview median 1.6 s/worst 2.5 s; thumbnail median 270 ms/worst 1.1 s. Matched copied RAW: thumbnail CPU 1464 ms → GPU 92 ms; screen-preview CPU 983 ms → GPU 203 ms; HDR/SDR reuse ~3 ms. Screen-preview draw 363 ms after preparation (~0.57 s combined). Source development excluded. | About 50 ms thumbnail preparation and 0.5 s uncached Fit sharp draw still require app acceptance. Reconstruction optimization remains open. |
| Film grain and halation in Library drawing | Present in all slow graded photos (Portra 400, grain 24, halation). Not timed apart from Denoise. | Suspected; measure. |
| Sharpening | Present on one slow photo (DSC07178). No timing. | Unmeasured; check only. |
| Stored-scene pixel fetch | 65–150 ms per 2560 scene after Part 0, down from 140–800 ms. | Measured; improved. |
| AVIF and Ultra HDR source decoding (October 26: row-parallel native AVIF reconstruction built; GPU route and 1 s target open) | Part B local copies: Ultra HDR first picture 1.87 s, CPU boundary 771 ms vs memory probe 92 ms; large gain-map AVIF 12.70 s, CPU boundary 8.75 s vs memory probe 6.73 s. Small gain-map and direct AVIF measured below. | Remeasured offline at 640 px. Large AVIF gain reconstruction remains slow despite memory input/all-thread requests. October 26 batch integrates native row-parallel reconstruction with exact transport; full GPU reconstruction and live USB/2560 fullscreen timings remain open. |
| Cold RAW development | Previous GPU two-size preparation 1.9–2.3 s per 42 MP RAW; CPU fallback 8–10 s. Part A local-copy LibRaw decode: 230 → 193 ms; unpack 78 → 78 ms; exact transport bytes. | CPU decode remeasured; USB read, GPU development and cache-write timings await the 30-photo app trial. |
| Highlight reconstruction | 42 MP GPU about 3.2 s against a 1 s target. | Measured (October 24). |
| Rating save | About 110 ms in the background: 58 ms SQLite commits, 32 ms recovery flush. Screen no longer waits. Cutting it further trades durability, which is Steve's decision. | Measured; option pending. |
| Indexing throughput | Previous 0.35 s per 32-photo batch, one lane. Part A 12-copy metadata read: 75.8 ms serial → 9.7 ms warm parallel; 477.4 ms including process startup. | Metadata remeasured only; 155k-library end-to-end throughput awaits a normal indexing session. |
| Whole-pin folder walks | Initial and changed pins still walk their whole scope (D:\Photos holds about 155k photos). | Known; scoped since Step 2. |
| Full-size Ultra HDR export | About 33 s per photo (CPU export, maximum fidelity). | Measured (October 19); GPU delivery brief exists. |

### Cold-original decoding — Part B offline findings (October 26, 2026)

**Measured, not built.** One real read-only copy per format family, two gain-map AVIF examples and a direct AVIF. App already running; isolated Library scene/cache misses, OS file cache warm. First picture is the current finished 640 px GPU picture plus two animation frames, not a cold app launch, folder-click latency or the sharp 2560 picture. JPEG goes first and includes first-use renderer setup. The CPU boundary is timed separately; RGB memory probes exclude file reads; DNG keeps warm reads inside its existing in-process preparation. Most metadata validation is outside the fast timing. Estimated first picture = current first − current CPU boundary + fast probe, not a measured integrated fast path. [Full method, samples and accuracy results](../../technical/evidence/library-codecs-and-cold-decode-2026-10-26.md#b2--cold-originals).

| Format / copied sample | Current first ms | Current CPU / fast probe ms | Estimated first ms | Recommended path and sample differences |
| --- | --- | --- | --- | --- |
| JPEG / `DSC_3931_01.jpg` | 4644.7 | 51.4 / 6.3 | 4599.6 | libjpeg-turbo memory; exact full samples. Reduced IDCT 6.8 ms vs 6.3 full: no gain here; reduced 640 px ΔE2000 0.184 / 2.527. |
| Ultra HDR JPEG / `DSCF6495_finished.jpg` | 1866.5 | 770.9 / 91.8 | 1187.5 | libultrahdr memory, both views; HDR exact, SDR max 5.96e-8. Retain 0.18 scale, gamut/orientation and gain metadata. |
| AVIF gain map, full / `DSCF6495_finished.avif` | 12696.2 | 8747.0 / 6730.4 | 10679.6 | libavif memory, both views, 12 threads; retain current 4.11 headroom: HDR max 5.96e-8. Full metadata precision changes pixels (report). Serial gain maths still dominates. |
| AVIF gain map, half / `5M071612_finished.avif` | 3237.3 | 2118.1 / 1118.1 | 2237.2 | libavif memory, both views, 12 threads; HDR max 5.96e-8. SDR max 0.0004963 from a different 10/16-bit RGB boundary: retain current quantization before integration. |
| HEIF/HEIC / `IMG_3324.HEIC` | 6736.7 | 1613.9 / 1597.7 | 6720.5 | Keep libheif with decode workers and Apple auxiliary-map/ICC path. HDR exact; no measured decode gain, new headroom parser excluded. |
| TIFF / `2026-03-30-0072.tif` | 2729.6 | 149.8 / 72.2 | 2651.9 | tifffile/imagecodecs workers on independent strips/tiles; max 5.96e-8. Preserve normalization, channels, ICC and orientation policy. |
| PNG / `IMG_2981.PNG` | 1049.6 | 16.5 / 5.2 | 1038.2 | libpng memory; exact 8-bit sample here. Full decode then reduce; retain ICC/alpha rules and any current precision boundary. |
| EXR / `DSCF6495.exr` | 2808.4 | 179.3 / 387.0 | 3016.1 | Keep current combined-channel OpenEXR (179 ms). Memory probe slower (387 ms), exact only with explicit RGB channel gathering. |
| JXL / `DSC01302.jxl` | 4178.8 | 1149.0 / 217.2 | 3247.0 | libjxl memory, 12 threads; exact fallback samples. Keep source-interpretation gate/profile handling; no browser dependency. |
| Mosaic DNG / `Leica-X2-L1021324.DNG` | 3221.3 | 579.5 / 587.4 | 3229.1 | Existing complete experimental DNG preparation, LibRaw/OpenMP and TIFF workers; exact. No speed gain; retain opcodes, profile, crop and demosaic. |
| Linear DNG / `DJI_0071-2-HDR.dng` | 4960.4 | 2009.4 / 1949.7 | 4900.7 | Existing complete linear-DNG preparation and TIFF workers; exact. No speed gain; retain calibration, highlight support and embedded SDR work. |
| AVIF direct / `DSC08883.avif` | 2692.8 | 1508.6 / 648.4 | 1832.6 | libavif memory, 12 threads; max 5.96e-8; retain CICP/ICC, orientation and interpretation rules. |

Sample differences are absolute returned-sample units, normalized float for precision formats; they are not interchangeable with perceptual ΔE. Values at 5.96e-8 are float32 rounding. EXR, HEIC and both DNG probes establish no useful decode-speed improvement. JXL/HEIC adapter gates still use the existing fallback. No required import accuracy, metadata, DNG correction or authored-SDR rule is relaxed. Gain-map AVIF headroom 4.113112926 vs the current parsed 4.11 gives HDR ΔEITP mean 0.0618 / p99.9 2.0596; the table deliberately retains 4.11. More native metadata precision is a separate import decision. No per-photo command-line tool or intermediate file occurs inside the fast probes.

### Prepared-folder fullscreen culling (October 25, 2026)

**User requirement; implementation open.** Steve should be able to leave a
folder of roughly 200-300 supported photos to prepare, then browse forwards,
backwards and jump between fullscreen pictures in real time while culling and
rating. Preparing a folder is useful work completed ahead of browsing, not
merely moving development ahead while making each navigation render again.
The photo count describes an everyday acceptance workload, not a library cap.
The same requirement covers unedited photos, saved grades and virtual copies,
and HDR and authored SDR viewing. A smaller first picture helps cold browsing
but does not satisfy this prepared-folder requirement.

**Existing experience to match (Steve's observation).** Opening a folder of
pure Sony RAW files currently loads their embedded JPEGs extremely quickly and
feels good. Use that workflow as the experiential and measured comparison for
finished-preview browsing: measure time to the correct visible picture,
forward/reverse navigation and cold/warm behaviour on matched hardware and
preview sizes. This is Steve's qualitative observation, not an instrumented
result or proof of the responsible internal path. The prepared-preview route
should approach that responsiveness while showing the current authored grade
and HDR/SDR intent rather than the camera's embedded look. Investigate reuse of
its successful loading/presentation mechanisms where applicable.

**Proposed acceptance targets; not yet agreed or measured.** For a prepared
300-photo folder at the declared Fit preview size and rendition on the reference
machine, propose sustained five photo changes per second, p95 key-to-correct-
finished-picture at or below 100 ms and p99 at or below 200 ms, including
reversal and rating during navigation. These targets make "real time" testable
and expose stalls hidden by averages. Measure arbitrary jumps separately,
including misses in the decoded-memory window; initially propose p95 <=250 ms
from a local SSD. Report the first presentation after relaunch separately from
steady browsing. Reuse the existing 5% noise allowance for matched comparisons;
these proposed latency goals do not replace agreed tolerances or claim a pass.
Record display resolution, cache drive, rendition, concurrency and cache state.

**Current architecture and gaps (code checked October 25).**

- `library_pictures` persists source/developed scenes at 640 and 2560 pixels.
  Finishing-only edits reuse those scenes. `library_live.describe` attaches the
  current grade; its pixels endpoint loads scene arrays and prepares transport.
  These stored scenes are not finished Library pictures.
- `library-gpu.js` fetches/uploads pixels and runs Grade's finishing graph for
  a live draw. Draws share one scheduler and background GPU leases. A disk
  scene hit avoids source development but not this rendering work. Live draws
  reset their working session and release their lease afterwards.
- `showSingle` requests the 2560 scene and waits for its draw. Entering Single
  clears grid cells instead of carrying the selected completed preview into
  fullscreen. The October 24 stale-photo fix hides old pixels during this wait;
  it does not make the selected picture arrive faster.
- Idle warming calls scene loading, not final-picture rendering/publication.
  It runs one candidate at a time while the active grid is idle, and stops
  when either scene allowance lacks conservative headroom. Waiting longer
  therefore cannot guarantee every photo is ready for immediate fullscreen.
  There is no explicit folder-completion contract or retained finished-disk
  preview serving this workflow. Recent app logs contain multi-second Library
  draw-queue waits; their events do not identify an F-key interval, so they
  cannot assign those waits to Steve's particular fullscreen transition.

**External comparison (official documentation, consulted October 25).**

- [Lightroom Classic performance guidance](https://helpx.adobe.com/lightroom-classic/desktop/technical-support/performance-guidelines/optimize-performance-lightroom.html)
  distinguishes minimal/embedded, standard and 1:1 previews, recommends
  preparing previews before working, and sizes standard previews for the
  display. Its [colour FAQ](https://helpx.adobe.com/lightroom-classic/desktop/technical-support/technical-issues/miscellaneous-issues/color-faq.html)
  explicitly describes pre-rendered, compressed 8-bit Adobe RGB JPEGs for
  Library curation. The transferable lesson is pre-rendering, not adopting
  that SDR representation for HDRF's two authored renditions.
- [darktable 5.6 lighttable preferences](https://docs.darktable.org/usermanual/5.6/en/preferences-settings/lighttable/)
  documents rendered thumbnail/full-preview disk caches and configurable idle
  generation. Its [cache generator documentation](https://docs.darktable.org/usermanual/4.8/en/special-topics/program-invocation/darktable-generate-cache/)
  describes advance generation at selected sizes. This supports retaining
  completed browsing products alongside an editing pipeline; it is not a
  measured performance comparison with HDRF.
- [Capture One culling](https://support.captureone.com/hc/en-us/articles/7185822431645-Culling-images)
  uses embedded previews to accelerate culling and warns that their appearance
  can differ. Its [preview cache settings](https://support.captureone.com/hc/en-us/articles/360002484457-Capture-One-Preferences-Settings-Image-tab)
  size generated Viewer previews for the display and offer generation-speed
  versus compression choices.
- [Photo Mechanic](https://camerabits.freshdesk.com/support/solutions/articles/48000361354-supported-file-formats-in-photo-mechanic-6)
  uses embedded JPEGs for fast RAW browsing, with optional RAW rendering. Its
  [render cache](https://camerabits.freshdesk.com/support/solutions/articles/48001146201-render-cache-preferences)
  avoids re-rendering when returning to photos. Embedded camera appearance
  alone would not represent HDRF's saved grades or authored HDR/SDR output.

**Recommended design to evaluate; not built or approved.** Make finished,
versioned previews the persistent product used for prepared-folder browsing;
retain developed scenes as independently evictable working data where useful.
This revisits the October 19 "draw every Library picture live" decision for
unchanged prepared pictures. It retains GPU generation, shared colour/finishing
maths, non-destructive grades and existing memory/quality rules. No old
finished-file queue or retired encoder implementation is being reinstated.

1. A single bounded preparation job develops a source once, finishes the
   required renditions on the GPU, then publishes fullscreen previews and
   suitable grid previews. Qualify grid downsampling for grain, Denoise and
   other scale-dependent effects; use a separately rendered small product if
   deriving it fails the existing quality guide. Avoid a duplicate source
   decode or a second finishing pass solely to write a picture already drawn.
2. Persist the completed folder on disk. Keep only a small decoded/presentable
   window around the current selection in RAM/GPU memory, prefetching ahead
   and behind within existing budgets. A navigation hit needs presentation
   and colour/display conversion, not source development, Denoise, masks or
   the finishing graph. Disk misses need preview loading/decoding, not RAW
   reading or grading. Rapid navigation discards superseded presentation work.
3. Represent completed HDR pixels with explicit colour space, transfer and
   reference-white information, before monitor-specific presentation. Preserve
   the authored SDR rendition separately or in a representation that faithfully
   carries both; do not derive it by generic HDR tone mapping. Keep the agreed
   HDR ceiling and perceptual limits. Monitor transforms and UI/marks remain
   presentation work. Codec and representation remain an experiment, not a
   decision to use ordinary JPEG or a screenshot of the monitor output.
4. Key previews by source identity/interpretation, pixel-affecting grade,
   rendition, size and renderer version. Ratings, picks, labels, tags and
   album membership must not invalidate image pixels. Grade changes invalidate
   affected finished products; retained scenes make finishing-only updates
   cheap. Check identity again at atomic publication. Never show another
   photo's pixels, silently present an obsolete grade as current, or apply a
   rapid rating to a photo other than the one it is intended for.
5. Offer a deliberate Prepare folder/selection action with progress and
   rendition/size coverage, alongside automatic idle preparation. "Ready"
   means valid finished previews exist for all requested photos and sufficient
   cache capacity is reserved. Keep the active prepared set from evicting
   itself while it is being built or culled. Report failures, insufficient
   capacity, missing/changed entries and partial completion explicitly. Resume
   after interruption, avoid redoing valid products, and recheck after relaunch.
   Entry to fullscreen should also reuse the correct existing preview while
   any missing final picture is prepared.
6. Treat true native 100% focus inspection as a separate cache level. Keep the
   existing selected-only full-source/viewport lifecycle. A 2560 Fit preview
   cannot establish native sharpness, and preparing Fit must not silently
   develop all neighbours at full native size. Choose Fit resolution from the
   intended physical display; a 2560 long edge is not native 4K coverage.

**What to store.** Replacing every 2560 scene outright with a finished picture
would speed browsing, but could force source preparation again after a small
finishing edit. Keeping both for every photo gives fast browsing and redraws
at the greatest disk cost. Prefer finished previews for the prepared set, with
working scenes retained opportunistically/recently under a separately managed
share of existing space. This is a policy proposal; no allowance is increased
and no existing cache data is deleted by this investigation. Folder preparation
must be able to stream through temporary working scenes; requiring enough
space to retain every intermediate would defeat the proposal.

For scale, calculated, uncompressed 2560 x 1707 RGB half-float is about 25 MiB
per rendition: 300 photos need 7.33 GiB for one or 14.65 GiB for two, before
thumbnails/intermediates. RGBA half-float is 33.34 MiB each, or 19.54 GiB for
both renditions of 300 photos. These are arithmetic estimates, not measured
cache/codec results. Current full-size default is 10 GiB; thumbnails 2 GiB,
saved-grade allowance 2 GiB, and recent thumbnail memory pool 512 MiB. Simply
adding finished half-float pictures to all existing scenes will not ensure
this workload fits. Compare load-optimized packed/compressed finished HDR/SDR
representations against half-float, including encode cost, decode/upload,
colour and highlight correctness, disk use and restart behaviour. The existing
post-v1 proposal to compress old scene caches remains deferred; this is an
explicit new review of the representation needed for the culling requirement.

**Persistent compression direction (Steve, October 25).** Steve questions the
need for uncompressed half-float fullscreen previews and favours considering
compressed storage for previews retained across sessions. Evaluate compressed
finished previews as the preferred persistent tier, with half-float as a working
format and quality/performance reference, not a requirement for on-disk storage.
Decode a small bidirectional window ahead of use; do not transcode the whole
folder on every launch or put decoding back on every sequential key press.
Compression itself does not require dropping half-float precision: lossless
compression and a different pixel representation are separate choices.

Steve also notes that AVIF and JPEG Ultra HDR decoding have received little
optimization so far. Treat existing timings as implementation baselines, not
format limits. Prioritize those two formats before introducing another codec.
Compare a small shortlist, not a broad sweep:

- AVIF: inspect the actual bundled decoder, build, thread policy, colour
  conversion and pixel transport. Evaluate an optimized decoder path such as
  libavif/dav1d where practical; avoid unnecessary intermediate files, repeated
  conversions or process startup on each picture. Do not assume AV1 video
  hardware acceleration implies a usable still-image path for this app.
- JPEG Ultra HDR: profile JPEG/base and gain-map decoding, reconstruction,
  colour conversion and upload separately. Its SDR base plus gain map could
  carry both authored views together, but qualify the SDR base and reconstructed
  HDR against HDRF's independently authored outputs. Preserve both intents;
  do not substitute a default tone map when generating the preview.
- A losslessly compressed finished half-float baseline, such as OpenEXR ZIP/PIZ,
  to establish exact reference pixels and compare space/read/decode costs.
  Lossy EXR remains a secondary option if the candidates fail the measured
  speed, quality or capacity requirements.
- JPEG XL: a full third candidate (Steve, October 25). In a crude in-process
  2560 px test, HDR PQ 16-bit decoded in about 30 ms with 8 threads (AVIF
  10-bit: about 57 ms). Those test files were unrealistically small and untagged.
  Facts checked October 25:
  - The bundled `imagecodecs` contains libjxl 0.12.0. libjxl has had a gain-map
    API (`JxlGainMapBundle`, ISO 21496-1 `jhgm` box) since 0.11.
  - `imagecodecs.jpegxl_encode/decode` exposes PQ/primary tagging and a
    decoding-speed setting, but no gain-map options.
  - The app's Electron 43 uses Chromium 150. Chromium's JPEG XL decoder sits
    behind a flag there; third-party reports say Chrome turned it on by default
    only in 155. Whether Chromium renders JPEG XL HDR or gain maps is
    unverified.
  - Checked October 25 in the app's own Electron (Chromium 150.0.7871.224),
    1709 x 2560 px, using `createImageBitmap`. JPEG XL fails to decode
    without the `JXLImageFormat` feature; with it, a PQ-tagged 16-bit HDR file
    (434 KiB) decoded in about 78 ms and an SDR file (260 KiB) in about 64 ms.
    A plain JPEG took about 11 ms.
  - In-process libjxl on the same files: HDR about 145 / 52 / 37 ms and SDR
    about 121 / 39 / 28 ms with 1 / 4 / 8 threads.
  - Enabling the feature works, but the browser decoder is about twice as slow
    as multi-threaded libjxl, and its HDR precision on the way to a WebGPU
    texture is unverified.

  Test two forms:
  - Separate HDR and authored-SDR JPEG XL renditions. Each mode decodes only
    its own rendition, and this needs no new dependency.
  - A single file with a gain map. This would need a small native libjxl
    binding or helper, which is a planned update, not yet built.

  Do not rely on the browser decoding JPEG XL.

[libavif](https://github.com/AOMediaCodec/libavif) supports multiple decoder
backends, including dav1d; [libultrahdr](https://github.com/google/libultrahdr)
documents encoding from HDR and SDR inputs and decoding SDR/HDR intent.
[OpenEXR's documentation](https://openexr.com/en/latest/TechnicalIntroduction.html)
distinguishes lossless and lossy compression. None establishes a performance
winner for this app. Measure preparation time, persistent bytes, cold/random
read+decode+upload+present latency, warm navigation, peak memory and perceptual
error on the same pictures. Decode and prefetch outside the navigation critical
path while respecting resource priorities. The smallest file alone is not the
winner. Retained previews remain regenerable cache products keyed to
source/grade/version, not archival replacements for originals and non-destructive
edit metadata.

**Part B offline codec result — October 26, 2026.** No storage or decoder integration. Measured real GPU finished HDR and authored SDR screen previews at 2560 px Fit after `5f846b5`, including Film Look: the existing 16-source RAW set already contains alley and wide-gamut IMG_0790; add graded DSC07202, DSC07178 and DSC07217 with Denoise, Portra grain and halation. Lossless half-float is the reference only. [Report, full settings, 1/4/all-thread decode tables, per-photo bytes/metrics and cold-original findings](../../technical/evidence/library-codecs-and-cold-decode-2026-10-26.md).

**Recommended next storage slice:** HDR AVIF q100, PQ10 / BT.2100 CICP 9/16/9 / YUV444 / speed 8, eight tiles (`tilelog2=(1,2)`, column/row order), all available decoder threads (12 here); separate lossless authored-SDR sRGB8 PNG level 3. Decode only the chosen rendition, ahead of navigation. The pair averages 12.12 MiB (844 photos per 10 GiB), median 437 ms encode, 75.4 ms HDR decode and 38.0 ms SDR decode at 12 threads. Both renditions meet the guide on 19/19 photos. Store interpretation explicitly; the PNG is an independent authored SDR rendition.

Lossless PQ16 BT.2100 HDR JXL + lossless sRGB8 SDR JXL (effort 3, decoding-speed 1, all threads) is the precision-first alternative: 20.94 MiB, 489 photos/10 GiB, 213 ms pair encode, 62.7 / 56.7 ms HDR/SDR decode. AVIF/PNG uses about 42% less space; JXL has much smaller HDR error and faster preparation. Lossless sRGB16 JXL improves SDR quantization but makes a 33.19 MiB pair. None of the tested q90/q95 settings passes both renditions across all 19 photos; near-lossless JXL distance 0.004 and AVIF99 also fail. Quality labels are not equivalent across codecs.

| Setting | Mean MiB/photo (both views) | Min–max MiB | Photos/10 GiB | Encode ms | Worst HDR mean / p99.9 | Worst SDR mean / p99.9 | Both pass |
| --- | --- | --- | --- | --- | --- | --- | --- |
| uhdr90full | 1.77 | 0.98–5.20 | 5777 | 221.4 | 23.404 / 117.934 | 3.357 / 15.453 | 0/19 |
| uhdr90half | 1.11 | 0.72–2.01 | 9230 | 151.7 | 20.859 / 75.135 | 3.357 / 15.453 | 0/19 |
| uhdr95full | 3.00 | 1.71–7.45 | 3412 | 227.6 | 17.253 / 75.290 | 2.655 / 10.825 | 0/19 |
| uhdr95half | 1.91 | 1.20–3.57 | 5361 | 156.1 | 15.239 / 57.149 | 2.655 / 10.825 | 0/19 |
| avif90 | 2.31 | 1.07–5.67 | 4423 | 227.3 | 14.475 / 53.234 | 2.639 / 10.807 | 0/19 |
| avif95 | 3.18 | 1.46–7.64 | 3220 | 309.4 | 6.518 / 23.442 | 2.639 / 10.807 | 0/19 |
| jxl90 | 2.32 | 0.97–5.23 | 4417 | 189.1 | 13.941 / 54.204 | 2.670 / 10.989 | 0/19 |
| jxl95 | 3.99 | 1.86–7.81 | 2567 | 213.6 | 9.249 / 39.784 | 1.931 / 7.704 | 0/19 |
| half-zstd | 41.06 | 36.34–45.25 | 249 | 214.4 | 0.000 / 0.000 | 0.000 / 0.000 | 19/19 |
| avif100 | 20.18 | 13.19–30.05 | 507 | 1656.1 | 0.726 / 1.914 | 0.021 / 0.058 | 19/19 |
| jxl99.9 | 8.81 | 4.42–13.76 | 1162 | 253.6 | 3.323 / 17.254 | 0.711 / 3.255 | 1/19 |
| jxl100 | 33.19 | 25.69–40.17 | 308 | 234.2 | 0.006 / 0.015 | 0.001 / 0.004 | 19/19 |
| avif99tiled-png | 9.76 | 5.89–15.52 | 1049 | 399.8 | 2.044 / 6.924 | 0.330 / 0.936 | 0/19 |
| avif100tiled-png | 12.12 | 7.67–18.68 | 844 | 437.2 | 0.726 / 1.914 | 0.330 / 0.936 | 19/19 |
| jxl100s8 | 20.94 | 14.80–27.69 | 489 | 212.7 | 0.006 / 0.015 | 0.330 / 0.936 | 19/19 |

Tables count both renditions. “Worst” = largest per-photo mean/p99.9, independently; HDR ΔEITP and SDR ΔE2000 use the unchanged guide, mean <1.0 and p99.9 ≤3.0 for every photo. Capacity is floor(10 GiB / mean pair bytes), excluding metadata/reserve. Encode once; decode median of three memory runs, then median across photos. Thread requests do not guarantee parallel work: untiled AVIF100 HDR stays about 306 ms at 1/4/12 threads, while eight tiles give about 308 / 109 / 75 ms. Ultra HDR/Zstandard have no binding thread knob; the report uses process affinity 1/4/12 and states that limit.

**Ultra HDR GPU option:** two libjpeg-turbo JPEG decodes plus standalone WGSL reconstruction were measured for all 76 Ultra HDR files. Full-size gain maps agree with libultrahdr within the preview guide on 15/19 photos; half-size maps on 6/19. All still fail the guide against the uncompressed HDR reference at these settings. Keep the discrepancies; the exploratory shader is not an interchangeable decoder. The report separates JPEG time, CPU allocation/upload enqueueing and queued GPU upload/submit/wait time.

**Ceiling and visual qualification remain open.** Twelve actual Library references exceed 1000 nits with Highlight compression disabled (maximum 5372.5 nits); they were not silently clipped to make the codec experiment pass. The separate near-1000-nit edge probe exposes lossy reconstruction overshoot (for example half-size Ultra HDR about 1258.4 nits). The q100 tiled AVIF edge result is 998.93 nits, while lossless JXL is 1000.14 vs a half-float input peak of 1000.083; one synthetic case does not establish a universal ceiling. A future slice must resolve the uncapped reference and verify the required ceiling after decoding, allowing only encoder rounding. No codec is fully qualified until that and Steve's visual grain judgment are resolved.

The local side-by-side gallery is `D:/AI/AI Projects/HDR Finisher Tool/ai/output/part-b-codecs-2026-10-26/gallery/index.html`: 34 worst-case/grain cases, both renditions, numeric half-float HDR canvas plus a labelled SDR fallback. The HDR canvas/case switching was verified; screenshots/fallbacks cannot qualify HDR. Initial crop inspection favours AVIF100/PNG and lossless JXL for retained texture; Steve's grain judgment is pending. Browser `createImageBitmap` precision is untested. A useful native libjxl gain-map slice is estimated at 2–4 engineering days (minimal metadata wrapper half–one day), so no binding was built.

Part B is complete as an offline experiment. Only this PRD and its report are committed; scripts/images/raw measurements remain ignored. No app behaviour or import rule changed, no app tests were run, and all 34 source/copy hash pairs are unchanged. The brief remains active for unfinished normal-use/implementation work.

**Next implementation boundary.** The October 26 stored screen preview slice
now connects GPU capture, disk and fullscreen/Single Fit presentation. Finish
first-use/HDR timing and Steve's Fit blink test, then add
folder readiness/space policy and shared grid/Single/Compare consumers. Exercise
a prepared 200-300-photo workload, sequential/reverse/random navigation, rating,
relaunch, edits, both renditions, cache clear/off, capacity exhaustion and GPU
recovery. Measure total preparation separately from browsing and do not hide
misses behind a smaller-placeholder first-paint number. Preserve current export,
Proof and Grade output; preparation yields to their existing priority. Assess
prepared browsing during those jobs separately. No broad sweep, new budgets,
codec choice or implementation is authorised by this research alone.

**Built previews: per photo, user-chosen (Steve, October 25).** Besides
automatic grid thumbnails and idle-built fullscreen previews, offer a manual
"Build previews" command. Like Lightroom's per-photo 1:1 previews, it works on
any selection, so users can filter or sort (for example by top rating) and
build a limited set instead of a whole, possibly enormous, folder. It may also
appear in the folder's right-click menu. User-built previews stay protected
from automatic cleanup until discarded, and also suit keeping a gallery of
favourite photos. Size tiers: automatic grid thumbnails plus display-sized
fullscreen previews come first; native 100% detail previews are deferred until
everything else is fast. Not built.

**Review findings (Claude, October 25).** Measured during the 155k-photo
indexing run: the global Library lock is held by whole-library membership
reconciliation after every 32-photo index batch, every rating and every folder
listing. Picture cache checks rose from about 20-50 ms to a 1.05 s median and
ratings took 3.5-8.3 s; folder listings waited 1.9-6.1 s after a 31-42 ms scan.
The 2560 scene cache was full (366 entries, 9.98 of 10 GiB). Each prepared flip
still reloads, converts, uploads and re-grades its scene. In-process decoding at
2560 px (crude test pixels, speed only): Ultra HDR SDR base 17-20 ms, HDR
float16 about 100 ms on the CPU, 10-bit AVIF about 57 ms. Recommended order:
instrument, take picture/rating paths off the lock, make reconciliation
incremental, draw neighbours ahead, qualify codecs, then one stored-preview
slice, then preparation and capacity. Not built or approved.



**October 25, 2026: responsiveness core, Step 0 (instrumentation built).**
Single and fullscreen navigation now carry a request ID through `cache_check`,
`queue_wait`, `lease_wait`, `pixel_fetch`, `upload`, `render`, `present` and
`key_to_picture` stopwatch events. Grid and filmstrip draws carry their own view
and request IDs; the embedded-camera preview baseline uses the same stopwatch
(with Sony ARW identified separately). Superseded navigation is recorded as
cancelled. Cache-hit and route fields describe the picture path used.

`upload` measures texture allocation and upload submission on the page;
GPU completion remains in `render`, which excludes the measured fetch and
upload submission time. `present` is the first checked browser paint opportunity
(two animation frames) after the correct finished canvas is revealed, not
physical display scanout. Backend `lock_timing` events report wait/hold
milliseconds for folder listings, membership reconciliation, document lookup,
marks reads/changes and index scan/metadata batches. Nested scopes overlap;
do not add their hold times together.

This step changes diagnostics only. No live library timing run was made;
acceptance targets in the responsiveness brief remain proposals. Steps 1-3
remain open, as do persistent previews and Prepare/Build previews.

Validation: 603 Node tests passed; 2,539 Python tests passed, 3 skipped.
No failures. Scratch app-data paths were used; no live library experiments,
GPU drivers or timing sweeps.

**October 25, 2026: responsiveness core, Step 1 (foreground paths).**
Document and grade-open lookups use an independent read-only database snapshot
and atomic sidecar reads, with pending grades and virtual copies preserved.
SQLite WAL is enabled during normal database initialisation; no schema change,
rebuild or settings-format change. These readers take neither application lock;
all existing session-before-Library write locking remains unchanged.

Ratings/marks, visited-folder reads and writer acknowledgements reconcile only
the affected original/copy families and preserve unrelated recovery records.
Folder listing performs one scoped reconcile; folder and copy path searches use
indexes. Full index-batch reconciliation and whole-pin/kept checks remain open
for Step 2, as does the Step 3 finished-picture window.

A short warm-database run on a 155,879-row copy with simulated background
metadata batches measured indexing-time p50/p95
of 867/947 ms for ratings, 4/15 ms for document lookup and 735/737 ms for a
one-photo scratch listing after scan. Ratings and listing miss the proposed
100 ms and 0.5 s targets because background full reconciliation still holds
the shared lock. Lookup alone is below 30 ms; the complete live-plan HTTP path
and actual USB badminton folder were not measured. Idle small/large copy
rating and listing times stayed within the proposed 10%; indexing did not.
These are proposed targets, not newly agreed tolerances. Measurements used
scratch data on D: (medium unverified), not Steve's photos or sidecars.
See the active responsiveness brief for sample sizes, idle timings and scope.

Smart-album cache invalidation uses the backend commit serial plus the WAL
stamp; same-timestamp writes still refresh results. Validation: 603 Node tests
passed; one Python fast run had 2,541 passed, 3 skipped and two failures, both
corrected (new copy-test setup and WAL invalidation). All 22 affected result
checks then passed, including the export/grade deadlock regression. No full
rerun, GPU drivers, sweeps or additional timing runs.


**October 25, 2026: responsiveness core, Step 2 (incremental maintenance).**
Index batches, changed-folder deltas and kept-album checks reconcile only affected
families. Full membership and scan imports use bounded pages, releasing the
Library lock between pages; removing a pin no longer retains it across the pass.
Recovery manifests retain unaffected families. Session-before-Library order,
sidecar/grade formats and durability guarantees are unchanged.

Windows periodic non-visible pin checks use recursive change notifications;
after the baseline scan an unchanged whole-library pin skips its walk, snapshot
copy and import. Visible/manual checks, dirty pins and notification failures still
scan; disconnects retain entries and reconnects trigger checks. Initial/dirty
walks, full-pass total pages, kept-member counts and recovery manifests still
scale with their scope; explicit pin impact still reads library paths.

One Step 1-style short run on disposable warm copies (155,883 files on the large
copy), one scratch PNG on D: and simulated one-photo index writes every 20 ms:
large idle rating 108/335 ms, lookup 1/1 ms, post-scan listing 6/6 ms (p50/p95);
indexing rating 143/222 ms, lookup 6/8 ms, listing 66/73 ms. Rating p95 improves
from 947 ms but misses the proposed 100 ms; scratch listing meets 0.5 s.
Lookup alone meets 30 ms, not a measured complete live-plan result. Actual USB
badminton was not measured. Small/large ratings and indexing listings stay within
10%; idle listing p50 differs by 12% (0.63 ms), p95 by 2%. Targets remain proposals.
One idle-rating profile attributes 58 of 107 ms to SQLite commits and 32 ms to
recovery fsync, versus 6 ms in scoped queries. Removing those flushes needs a
separate durability design, not a library-size optimisation; historical ~15 ms
is not reproduced. The brief records all four conditions and sample sizes.

The single timing run preceded final finer per-family yielding; no timing
rerun. Windows may emit several events per edit, so a conservatively dirty pin
can receive an extra scan before its signal becomes quiet.

Validation: 603 Node checks passed. The one Python fast run had 2,546 passed,
3 skipped and one new notification-test failure (incorrectly assumed one event
per edit). Corrected it; 161 affected Library checks and four final regressions
passed, including export/grade snapshot locking. No full rerun, GPU drivers,
sweeps or repeated timing runs. Live database opened read-only only for backup;
all writes used scratch copies/photos/sidecars. Step 3 remains open.



**October 25, 2026: responsiveness core, Step 3 (implementation built;
hardware acceptance open).**
Single/fullscreen keeps finished live canvases for the current photo and up to
two neighbours each way, drawing ahead in the travel direction first. Ready
hits present that existing canvas. Selected and neighbour draws preempt lower
priority filmstrip/grid work; superseded neighbour demand is cancelled. Photo,
grade, source, HDR/SDR and display identities gate reuse, with explicit invalidation
and the October 24 rule that obsolete pixels stay hidden. GPU loss clears it.
The separate twelve-photo source-only Single read-ahead is replaced by this window.

Conservative surface bytes are reported to the existing broker and share the
existing detached-surface pool ceiling. Grade/export/Proof keep their priority;
100 ms permit checks discard kept work on contention. No budget, rendering maths,
shader, file format or backend durability changes. Ready-budget reports use the
configured budget before shared deductions, avoiding a shrinking-budget loop.

Rating/pick marks appear immediately with path-bound queued saves. Navigation
does not await saves, older replies cannot overwrite newer pending marks, and
failures restore acknowledged marks and report the error. SQLite and recovery
flushes retain their guarantees. No small safe commit consolidation was found;
relaxed sync/delayed recovery remains an unapplied option with power-loss risk.

Normal-use logs since 002519f: 17 completed fullscreen flips, key-to-picture
p50/p95 2847/3645 ms; finishing render 2111/2843 ms dominated. Fourteen rating/
marks lock scopes waited 0/78 ms and held 32/203 ms; no whole-save HTTP samples.
The brief retains every stage, sample sizes and uncontrolled-condition limits.
No post-change timing or sustainable-pace claim; the 100 ms proposal remains open.

Validation: one Node fast run had 601 passes/six initialization failures, corrected
with 26 affected passes; 24 final focused result checks passed. One Python fast
run: 2,547 passed, three skipped. One existing fullscreen driver at 2560x1440,
isolated profile/copied photos, timed out at first fullscreen presentation with
a budget refusal. The new budget-report calculation was corrected and result-
tested afterwards; no second GPU run. Hardware verification of the corrected
fullscreen window remains open, along with Steve's normal-use acceptance.
No live library, photo or sidecar writes, sweeps or timing runs. Persistent
previews, codecs and Prepare/Build previews remain separate work. Stop at Step 3.

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

**Activity panel grouping (October 25, 2026).** Picture warnings appear below the Needs attention heading alongside the other problems. The settings-writing section appears only while settings writes are pending (including paused or waiting work); the idle "Settings files up to date" status is hidden.

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

**October 26, 2026: Library Film Look dependency repair (built in this commit; Steve's try pending)**

Library's independent HTML document omitted `film-stocks.js`. Grade's shared
renderer awaits that helper optionally; without it the stock slot is zero and
the placeholder buffer silently bypasses stock colour/tone and paper/scan.
`library_live.describe` preserves the recipe, and there is no live-session
Film Look bypass. Grain and halation were already dispatched: grain fell back
to direct RGB modulation instead of Portra negative density, so it was present
but responded differently. Halation remained active. The repair loads Grade's
existing stock helper before the renderer; no shader or separate implementation.
Both Library factories and both lanes use it, including Export's shared tiles.

The first darker grid picture is the current RAW's embedded camera JPEG,
extracted by `rawpy.extract_thumb`, resized and displayed as a temporary
`camera-preview-placeholder`. The grid requests it even for graded photos;
Single's separate camera fallback is restricted to ungraded uncached photos.
It is not a saved older graded picture and does not contain the saved grade.

Validation uses disposable photo/sidecar copies and the runner's isolated app
profile/cache. The existing live-picture driver now permanently grades its
synthetic saved photo with Portra 400, grain 24 / size 30 and halation 4 in both
lanes. Real DSC07202, DSC07217 and DSC07178 additionally compare Library's
640/2560 finished pixels and the quick renderer with Grade's independent GPU
renderer using standard Grade proxy transport over the same read-only scene.
This isolates finishing agreement; it is not a new full RAW-development audit.
Limits remain perceptual mean <1.0 and p99.9 <=3.0. Warm timing samples reproduce
the previous missing-helper condition and alternate three paired sharp draws
per lane, excluding readback; use the existing 10% noise guide and report the
added stock-chain cost descriptively rather than impose a new speed budget.

Validation: all 18 real-photo comparisons passed (both lanes at 640/2560,
plus the separate 640 quick renderer). Measured mean and p99.9 were zero in
every comparison. The permanent Film Look fixture also passed against Grade's
numerical renderer: worst mean 0.134, p99.9 1.922, within the existing limits.
The first GPU attempt stopped on a test-helper readback after scene release;
the capture was moved inside renderTo and Steve approved one corrected run,
which completed. No further GPU run or broad checks.

DSC07202's three-pair warm sharp-draw medians, old missing-helper condition to
fixed: SDR 167.9 -> 182.5 ms (+8.7%); HDR 170.7 -> 169.9 ms (-0.5%). Both are
inside the 10% noise guide; no slowdown beyond that guide was measured. These
exclude initial stock-table download, source development and CPU pixel readback,
and are not cold end-to-end latency or an isolated grain/halation benchmark.

Fast checks ran once: Node 630 passed, one unrelated failure in
`library-scenes.test.js` (selected photo joining development-ahead keeps its
CPU fallback if GPU fails: decoder failed). Python was interrupted at 50%
when the session stopped; the process is gone and there is no final result.
Neither was rerun under Steve's once-only limit. Original photos, sidecars,
live Library database and cache were not written. Evidence: ignored
`codebase/output/library-film-look-corrected.log` and
`codebase/output/library-live-picture/1792971604518/film-results.json`.
The real-photo extension is opt-in via `HDR_FINISHER_FILM_PHOTOS`; the permanent
synthetic saved Film Look fixture always runs in `library-live-picture.js`.

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
