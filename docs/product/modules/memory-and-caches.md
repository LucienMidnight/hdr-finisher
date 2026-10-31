# Module PRD: Memory and caches

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 29, 2026, against the code on
  `library-big-folder` (implementation based on `c57c4ee`; validation below).
- **Code:** backend `app_memory.py` (whole-app measurement and admission),
  `library_raw.py` (RAW reader and hand-off allowances), `library_pictures.py`
  (picture cache, hand-off, camera previews), `library_cache.py` and
  `library_screen_previews.py` (disk allowances), `render_cache.py` (Grade
  source cache); frontend `library-tile-pool.js`, `library-ready-window.js`,
  `library-gpu-raw.js`, `library-raw-gpu.js`, `gpu-budget.js`,
  `gpu-render-plan.js`, `webgpu-preview.js` (GPU budgets), `photo-library.js`
  (reclaim on memory pressure).

This file owns **how much memory and disk the app may use, and how that is
split between its parts**. The other module PRDs describe what each cache is
for; the sizes live here. Change a size here first, with Steve's decision, and
then in the code.

**Open, October 30: one scheduler for memory and GPU work.** The fixed
600 MB per-job reservation, memory counted twice, and refusals treated as
memory pressure are behind the October 29–30 stalls. The proposed
replacement, with research and phases, is
[library-resource-scheduler-design-2026-10-30](../../technical/briefs/library-resource-scheduler-design-2026-10-30.md).
Phase 3a is connected as recorded below; later phases remain open.
Steve approved the design and phase order on October 30. Phase 0 measured
backend memory per job and file type (section 6.11 of the design). A
full-size non-RAW decode needs 0.5–1.3 GB, more than the 600 MB working room.
The RAW sensor read needs about 5.5 bytes per pixel. GPU memory runs about
25 bytes per pixel. The 297 MP line scan peaks at 6 GB on the CPU route. The
proposed per-type estimates are Steve's decision; no size or share has
changed.

### October 31: phase 3b partial scheduling

Startup upkeep uses the existing 64 MB minimum estimate as eventually work,
yields between safe points, and releases its grant on completion/close. Hidden
window work becomes eventually without changing its estimates or allowances. Native window-state events cover minimisation when Chromium visibility stays visible.
Bounded large-image routes and coordinated unavailable-disk-cache fallback remain
unfinished; all approved rates/shares stay in force. See design 7.7 for why the
transient handoff cannot safely be detached from failed disk storage yet.

### October 31: phase 3a.1 admission cap

Two source/CPU developments may be admitted across windows. This is the approved
count, not a new memory allowance. Quick previews precede new developments; all
estimates, floor, physical reserve and fast-lane limits remain unchanged. A
prepared job still owns its decoded memory through its exclusive GPU wait; no
unaccounted release is used. Corrected cold Aceh peak 3.601 GB.

### October 31: phase 3a scheduler and channel connected

`library_scheduler.py` owns estimate admission, priority/FIFO, the visible
floor, the four-job fast lane, system reserve and disconnected-owner cleanup.
`library_estimates.py` reads headers without decoding pixels;
`library_grants.py` serves one WebSocket per window and in-process waits for
backend work. Live source, CPU, sensor, quick preview and RAW-reader callers
use it. A source-preparation request reuses its window grant.

Room is ceiling minus the approved 1.3 GB starting footprint, cache bytes
capped at their shares, and Grade's unique retained source allocations.
Measured whole-app memory minus that Grade source is a safety backstop;
operating-system pressure still counts everything. Existing phase 2 trim
cooldown and all approved budgets/shares are unchanged. Waiting is not a
failure or a pressure event. The Close photo in Grade action requires edits
to be drained and saved before releasing the source.

Grant logs include class, estimate, wait and peak alongside the reason. The
peak is the largest sampled whole-app increase since that grant began, not
an isolated job measurement: overlapping work and cache changes affect it;
a short job or unavailable measurements can have no useful peak. An unavailable
measurement is logged once and scheduling continues on estimates.

Cold-folder timing remains outside tolerance; see the performance table and
design 7.6. Phase 3b and the phase 4 GPU broker are not implemented here.

**Decided by Steve, October 31 (to revisit): unknown size.** When a file's
dimensions can't be read from its header, its job is estimated at the
ceiling (the full Library budget, 4 GB on Steve's machine). It then runs
alone, never as the floor, and only when free memory minus the system
reserve covers it. It is logged as "unknown size" with its measured peak.
Revisit if those log lines show real photos taking this path often or
waiting long on small machines; alternatives are in design decision 10.

## 1. Purpose

HDR Finisher holds pictures in several processes at once: the Python backend
and its helpers, the Electron main process, the page (renderer) and the GPU
process. Each part has its own cache. Without one owner for the total, each
size was chosen on its own and together they reached about 8.4 GB on a 64 GB
machine (section 7). This module sets one total, divides it, and says how the
app behaves when the machine runs short.

## 2. Principles (Steve, October 29, 2026)

1. **One total for the whole app.** Every RAM cache is a share of a single
   app-wide budget. Adding or enlarging a cache means taking room from another
   share or asking Steve to raise the total.
2. **Fixed sizes that scale down, never up.** Total physical RAM can be read
   reliably on every platform; free RAM cannot, because other apps change it
   from second to second. Sizes depend on total RAM only to protect small
   machines. Large machines do not get bigger caches, because speed is limited
   by the disk and GPU, not by how much is held in memory.
3. **Caches are limited by bytes and drop the least recently needed first.**
   Visible photos, then the selected photo and its neighbours, keep priority.
   Redrawing an older photo when scrolling back is acceptable.
4. **Hand-off layers hold only work in flight.** Memory used to pass a picture
   between processes is released once the picture is delivered; it is not a
   second cache.
5. **One kept copy per level.** A photo should not be kept as a RAW file, a
   hand-off copy, a GPU-process copy and a page copy all at once. Each level
   keeps what it needs and lets the others go.
6. **React when the machine is short of memory.** When Windows or macOS reports
   memory pressure, the caches drop their oldest entries early (moderate
   pressure: trim to about half; critical: drop everything that can be made
   again). This follows Chromium's memory-pressure practice.
7. **Working room is reserved, not capped at 600 MB.** Cache shares cap
   retained bytes. Caches leave at least 600 MB free inside the total;
   temporary developments and other jobs may borrow any additional free room.
   Several developments may run together when their reservations fit. Visible
   photos go first; the hard limit is the whole-app ceiling (Steve's
   clarification, October 30, 2026).
8. **Disk and VRAM are separate budgets.** Disk allowances (section 5) and GPU
   memory (section 6) do not count toward the RAM total.

## 3. Decisions

| Decision | Date |
| --- | --- |
| **Whole-app RAM ceiling: the smaller of 4 GB or a quarter of total RAM, but never less than 2.5 GB.** 4 GB means 4,000,000,000 bytes, counting Electron main, renderers, GPU-process host RAM, the Python backend and its helpers. Dedicated VRAM is not counted. | Steve, 2026-10-29 |
| **Budget split** as in section 4. Approved as a trial; adjust from measurements. | Steve, 2026-10-29 |
| **Respond to system memory pressure** by trimming caches early (principle 6). | Steve, 2026-10-29 |
| Older pictures may be discarded and redrawn; visible and nearby pictures keep priority. | Steve, 2026-10-29 |
| **Recent thumbnail pool: fixed 512 MB**, sized for an 8 GB machine; not scaled with RAM. Finished grid and filmstrip cells stay built for one screen beyond each edge. | Steve, 2026-10-18 |
| Grade import: no additional full-size photo copies held at once; about 100 MB extra peak working memory is allowed; larger additions need Steve's decision. | Steve, 2026-10-13 |
| **Per-job memory estimates for the Library scheduler** (measured peak plus 25%, from header pixel count, 64 MB minimum per job). Backend RAM in bytes per pixel: camera RAW sensor read 7; JPEG and Radiance HDR 23; PNG, TIFF and linear DNG 28; EXR, PFM and AVIF 38; HEIC, HEIF and JPEG XL 52; CPU route, any type, 25. Reduced-decode quick preview: 64 MB. Quick preview without reduced decode: 23 × the preview's pixels. GPU memory: the existing `rawBudget` formula. Overruns are logged and raise that type's estimate. Measurements: scheduler design, section 6.11. Not built yet (phase 3). | Steve, 2026-10-30 |
| No disk allowance increases without Steve's decision (selected-photo native detail uses the existing full-size allowance). | Steve, 2026-10-19 |
| Superseded: the RAW reader sized from "memory is plentiful (64 GB)" (October 14 disk-reader brief, FastRawViewer's 40 files cached / 12 ahead). Replaced by the fixed shares below. | 2026-10-29 |

## 4. RAM budget

Shares of the 4 GB total. On a smaller total, the cache shares (marked
"scales") shrink in proportion. The starting memory and the working room do
not shrink.

| Part | Process | Share of 4 GB | Scales | Implementation |
| --- | --- | --- | --- | --- |
| App starting memory | all | about 1.3 GB, measured | no | Observed process charge, never claimed as cache bytes. |
| Finished thumbnails | renderer / GPU host | fixed 512 MiB (existing fixed pool) | no | Pool plus visible/nearby canvas estimates report to `thumbnails`; oldest detached cells go first. |
| Sharp selected/nearby pictures | renderer / GPU host | 512,000,000 bytes | yes | Ready surfaces and direct scenes share one byte cap; older finished surfaces/scenes are evicted. |
| Camera previews | backend / helper | 64,000,000 bytes | yes | Aggregate preview LRU claims `camera`. |
| RAW read-ahead | backend | 768,000,000 bytes, at most 12 files | yes | Reader admits actual file/shared-section bytes, including partial reads. |
| Picture hand-off | backend / helper | 256,000,000 bytes | yes | RAW outputs and transient picture bodies share `handoff`; delivered bodies are released. |
| Grade source mips / session frames, masks, hue stages / retained native source | backend / helper | inside working room | — | A 600,000,000-byte aggregate retention cap replaces the separate 256 MiB mip, 192 MiB frame and 96/160 MiB mask limits. Unique array backing is counted once within a session; persistent mips have one retaining owner. Oversized levels are served without being cached. |
| Working room | all | at least 600,000,000 bytes kept free | no | Minimum free room protected from retained caches, not a maximum for jobs. Concurrent temporary reservations may use all remaining room below the whole-app ceiling. |
| **Total** | | **ceiling 4,000,000,000 bytes** | | Actual process charge is the final gate; shares are approximate and cannot override it. |

The fixed thumbnail decision preserves the existing 512 MiB implementation.
All other cache shares scale by `(ceiling − 1.3 GB − 600 MB − 512 MiB) /
(4 GB − 1.3 GB − 600 MB − 512 MiB)`. Starting memory, working room and the
fixed thumbnail pool stay unchanged. No share or ceiling was enlarged.
`app_memory.py` is the backend owner. Helper cache growth is admitted over
IPC by that owner; renderer caches use its returned share limits and report
actual retained bytes every 500 ms. Disk and dedicated VRAM remain separate.

With the 2.5 GB minimum, an 8 GB machine has about 0.6 GB left for the cache
shares after starting memory and working room. That machine redraws more
often; nothing stops working.

## 5. Disk allowances

Disk caches do not count toward RAM. Sizes are user settings in the Library
pictures window (1, 2, 5, 10 or 20 GB) unless noted.

| Cache | Default | Code |
| --- | --- | --- |
| Thumbnails (`thumbnail`) | 2 GB | `library_cache.py` `ALLOWANCES` |
| Full-size scenes (`full_size`) | 10 GB | same |
| Saved-grade pictures (`saved_grade`) | 2 GB | same |
| Stored screen previews (protected and unprotected) | 10 GiB, fixed | `library_screen_previews.py` `LIMIT_BYTES` |
| Browsing pictures (`library-pictures\`) | 2 GiB, trimmed to 90% | `library_pictures.py` `CACHE_LIMIT_BYTES` |
| Add-folder media browser | 512 JPEG files | media-browser helper |

Background preparation stops when its allowance is full; cleanup never evicts
protected previews. See [photo-library](photo-library.md) for what each cache
holds and [technical/photo-library.md](../../technical/photo-library.md)
section 9 for file layout.

## 6. GPU memory (VRAM)

VRAM is a separate budget, set per device in `gpu-budget.js` and
`gpu-render-plan.js` (automatic policy 2 GiB; smaller on software or limited
adapters). Grade's GPU tile caches trim against it in `webgpu-preview.js`.
Library RAW development, delivery and Grade share the GPU broker's budget;
Library GPU RAW keeps at most 384 MiB of developed scenes
(`library-raw-gpu.js`). Details: [preview-and-gpu](preview-and-gpu.md).

GPU-process **host** RAM (Chromium's copies of uploads and canvases) does
count toward the RAM total, and grows with the number of live canvases.

## 7. Current state and measurement (October 29, 2026)

Budget implementation is in progress on `library-big-folder`. The five-minute
manual checkpoint below restores retention under the ceiling. The lock criterion
and broader CPU qualification remain open; full ten-minute/driver validation is deferred.

**Windows gate:** sum proportional resident bytes for Electron main and its
complete descendant process tree (renderers, GPU host, backend and helpers).
For every resident page from `QueryWorkingSet`, charge a private page once;
charge a shared page as page size divided by its OS ShareCount. This avoids
adding Chromium mappings and backend/helper shared sections as full copies
in each process. This is proportional attribution, not private commit bytes
and not the sum of working sets. Pages shared with other applications are
attributed proportionally too. Windows saturates ShareCount at seven, so
heavily shared pages can be overcharged; this is conservative. Dedicated VRAM
is absent from this measurement. Ordinary working sets are retained only as
diagnostics. See Microsoft's [working-set flags](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-psapi_working_set_block).

The independent Python observer samples approximately every 500 ms, outside
the app's process tree, even when renderer/backend requests stall. It records
per-process charge, ordinary working set, Electron role, latest owner cache
bytes/share and renderer estimates. Cache telemetry carries its own timestamp:
it is asynchronous, not a simultaneous heap census. An unreadable live
process fails measurement rather than being charged zero. The gate stops at
the first sample above the exact ceiling. Plateau assessment requires no
sustained rise in the final two minutes, allowing a 5% band for OS/allocator
variation; this tolerance never applies to the ceiling. Cache bytes explain allocations;
they are not added to process bytes a second time.

On macOS the implemented sampler uses the kernel's `proc_pid_rusage` physical
footprint charge, with resident bytes alongside it, and libdispatch memory
pressure events. This platform path has not been validated on this Windows
machine. See Apple's [rusage structure](https://github.com/apple/darwin-xnu/blob/main/bsd/sys/resource.h).
Windows pressure uses memory resource notifications. Moderate pressure trims
oldest reconstructible entries toward half; critical pressure drops them.

**Electron main investigation:** the earlier 1.040 GB resident sample had only
8.1 MB of live JavaScript heap (and 4.3 MB external). The large increase was
outside the JS heap. Live picture uploads converted Blob bodies to
ArrayBuffers; Electron's auth `webRequest` hook exposes byte uploads in main.
Uploads now retain Blob backing and the hook records any remaining byte
uploads. This removes the identified bulk-copy path; its effect and the main
process high-water mark must be established by the scroll gate. It is not yet
a proven explanation of every historical spike. See [Electron request details](https://www.electronjs.org/docs/latest/api/web-request).

Earlier scroll numbers used summed working sets (latest 4.233 GB at 255 s)
and cannot be compared directly with this gate. Historical records remain in
`codebase/output/big-folder/`.

**Fast checks:** Python 2,729 passed / 3 failed / 3 skipped; JavaScript
662 passed / 2 failed. The five failures are previously recorded: adjustment
preset source contract, RGB publication fixture, retouch capture-cache fixture;
selected fallback and Single ready-window JS fixtures. The 91 focused
cache/helper checks pass. The combined run also covers restoring the helper
adapter after its in-process test. Real-folder scroll remains pending.


October 29 validation follow-up: the first completed 600.651-second scroll
stayed below 4 GB (2.585 GB peak, about 2.06 GB at the end), but finished
picture caches remained empty, so this does not establish the browsing goal.
Delete confirmation on the disposable PNG was 993 ms and cancelled; protected
project hashes were unchanged. RGB-native and codec-native passed. Scroll-cache
failed waiting for finished cells; background-activity failed waiting for its
Pause indexing control. Precision-source and live-native could not create
hard-linked fixtures on the exFAT D: volume. Admission now distinguishes a
busy 600 MB working slot from low total RAM: queued work must not reclaim the
current picture. A regression check covers that distinction. Shares are unchanged.
The repeated scroll records finished-cell counts explicitly; validation remains open.


**Paused at Steve's request, October 29.** Latest code is `3c446d9`
(after `b567c15`), still on `library-big-folder`; no push or merge.
The repeat used a disposable NTFS Windows TEMP profile. It was stopped by
request after approximately 230 seconds of independent sampling, before
completing the ten-minute gate or repeating Delete. Peak charge was
3,919,898,910 bytes; final sample 2,490,635,991 bytes. Two finished grid
cells were observed, and finished/camera/sharp bytes were retained. This is
partial evidence only: no plateau verdict. The peak had backend charge about
1.859 GB, GPU host 1.046 GB, renderer tabs 0.584 GB and main 0.143 GB;
main ordinary resident was about 0.216 GB at that sample. Backend temporary
allocations need investigation against the 600 MB working room before claiming
one enforced whole-app ceiling. No shares were changed.

| Share | Peak sample bytes / limit | Pause sample bytes / limit |
| --- | ---: | ---: |
| thumbnails | 51,892,480 / 536,870,912 | 57,945,600 / 536,870,912 |
| sharp | 0 / 512,000,000 | 80,768,000 / 512,000,000 |
| camera | 6,796,834 / 64,000,000 | 57,811,826 / 64,000,000 |
| raw | 0 / 768,000,000 | 0 / 768,000,000 |
| handoff | 26,310,222 / 256,000,000 | 168,059,324 / 256,000,000 |
| working | 0 / 600,000,000 | 0 / 600,000,000 |

Longest recorded lock hold in this NTFS repeat: `reconcile`
375 ms. The earlier exFAT-profile run recorded a 1,344 ms
startup copy observation, 656 ms during scrolling, and a 547 ms index batch.
The 250 ms requirement remains open wherever exceeded.

Fast checks after the admission follow-up: Python 2,730 passed / three known
failures / three skipped; JS 662 passed / two known failures; ten focused
memory checks passed. The six driver results above predate this follow-up;
they are not a validation of `3c446d9`. Their total run time was under eight
minutes, sequentially, with no 15-minute stall or 75-minute cap reached.
Protected hashes were checked again after stopping and are unchanged.

Resume: inspect the repeat's backend temporary allocations and lock timings;
finish auditing RAM caches against the single owner (including Grade session
frames/masks), and resolve hand-off cancellation/delivery lifetimes. Then run
fast checks and the full ordered scroll/Delete/six-driver sequence. The two
hard-link fixture drivers require an NTFS fixture strategy; D: is exFAT.
Evidence is retained under `codebase/output/big-folder/budget-validation/`
and `budget-validation-repeat/` (JSONL plus per-PID CSV, cache peak/end CSV for
the completed first run, backend logs and each driver result). Temporary
measurement profiles and driver photo scratch are removed. The three original
untracked items were left untouched. Steve asked to resume; the next gate will run after the follow-up fast checks.

Resume follow-up: camera/original quick-preview extraction now obtains the
existing 600 MB working reservation before allocating; queued previews wait
asynchronously rather than occupying the request worker pool. Cache hits bypass
decoding and admission. Grade session caches now register with the same owner;
the old independent frame/mask/mip defaults are removed. Critical pressure can
discard those cached levels and rebuild them. Failed deferred publication
releases its hand-off payload in `finally`. Unreadable live Windows processes
now fail measurement also when opening/querying the process fails. Reconcile
yields between individual photos, and photos with no virtual-copy state no
longer create an empty baseline transaction. Shares remain unchanged.
Forty focused memory/Grade/live checks passed; the broader 111-check group had
110 passes and the previously known RGB publication fixture failure. Full
fast checks and the ordered gate are in progress; these changes have not yet
established the ten-minute goal.

Sustained OS moderate pressure trims once when entered, rather than halving
every sampling tick. Actual budget overruns continue reclaiming until working
room is available; critical pressure still clears reconstructible caches.

**Decided by Steve, October 31 (for scheduler phase 3, not built).** The
4 GB ceiling becomes the budget for normal Library work, not a hard stop:
- Photos on screen keep a floor: one ordinary photo at a time may run even
  when that takes the app over 4 GB, if its estimate is 1 GB or less (floor
  allowance, Steve, October 31).
- One large job at a time may also go over 4 GB.
- While a large photo is open in Grade, a large Library photo pauses with a
  clear message and a **Close photo in Grade** button. Grade stays fully
  usable.
- The hard stop is the computer's free physical memory minus a system
  reserve: the larger of 2 GB or 10% of RAM (Steve, October 31). A job
  that would cross it waits with a message; it is never
  marked failed.

- Quick previews have a fast lane of 64 MB, up to four at once; JPEG quick
  previews use a reduced decode (15–51 MB instead of 218–762 MB). A larger
  quick preview joins the normal queue with its own estimate.

Details: design section 7.6 and decisions 3, 4, 6, 8 and 9.

**Replaced October 30 (scheduler phase 2).** Pressure now comes only from
measurement and the operating system, never from a refused admission:
- **moderate:** measured whole-app total above the target (ceiling minus
  working room), including above the ceiling, or OS moderate pressure.
  Caches halve.
- **critical:** OS critical pressure only. Reconstructible caches are
  dropped. Our own ceiling being exceeded is not critical, because pictures
  dropped then could not be made again while admissions are refused.

The Electron main process trims when the level rises, then at most once every
10 s while it lasts (Chromium's practice), and logs each trim as
`memory_trim`. Chromium's pressure signal, the windows' cache trims and the
backend reclaim all follow that one decision. No size, share or ceiling
changed. The 600 MB per-job reservation stays until phase 3.

Follow-up fast checks: Python 2,731 passed / three known failures / three
skipped (481 s); JavaScript 662 passed / two known failures. Python failures
remain the scoped-preset contract, RGB publication guard fixture, and retouch
CaptureCache deferred-store fixture. JavaScript failures remain the selected
CPU decoder fixture and missing Single screen-preview stub. No shares changed.
Tests that formerly forced independent frame/mask limits now force eviction
through an injected smaller owner budget and preserve live-mask priority.


**Resumed gate, `f56075a`: STOP at 162.212 seconds of scrolling.** The
independent observer measured **4,425,675,331 bytes**, above the exact
4,000,000,000-byte ceiling. It stopped the app and skipped disposable Delete
and all six drivers, as instructed. There is no ten-minute plateau result.
The last sample is also the peak. No finished grid canvas was counted in 161
responsive scroll replies (longest reply gap 1,020 ms), with 11,089 listed
photos. This does not establish usable visible/nearby redraw behavior.

The process curve below uses GB (1e9 bytes) and seconds from observer start;
startup precedes scrolling by about 13 seconds. Full individual-PID samples
are in `codebase/output/big-folder/budget-validation-resumed/process-curve.csv`.

| Observer seconds | Main | Tabs combined | GPU host | Backend | Helpers combined | Total |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.049 | 0.150 | 0.400 | 0.094 | 0.239 | 0.960 |
| 30 | 0.120 | 0.287 | 0.951 | 0.142 | 0.256 | 1.784 |
| 60 | 0.234 | 0.325 | 0.939 | 0.315 | 0.256 | 2.098 |
| 90 | 0.089 | 0.326 | 0.863 | 0.277 | 0.256 | 1.841 |
| 120 | 0.090 | 0.466 | 0.899 | 0.284 | 0.257 | 2.026 |
| 150 | 0.106 | 0.450 | 0.918 | 0.281 | 0.257 | 2.041 |
| 175.5 (peak/end) | 0.109 | 0.339 | 0.908 | 0.289 | 2.750 | 4.426 |

Total also includes the utility, Python launcher, crash handler and console.
At peak/end the four helper PIDs charge 2,562,018,742 (39240), 62,469,266
(5728), 62,521,929 (44116), and 62,771,785 (18680) bytes. Backend 47364 charges
289,033,654; main 14656 109,026,157; tabs 47944/3908 291,900,854/46,738,285;
GPU 15124 907,769,563. The sharp spike is in helper 39240, coincident with a
`live-scene` job for `_DSC3289.ARW` starting about five seconds earlier.
This is a temporary-allocation failure while the 600 MB working reservation
is held, not evidence that a cache share should increase. Its allocation path
remains to be bounded within the agreed working room.

| Owner cache | Bytes at peak and end | Share bytes |
| --- | --- | --- |
| Thumbnails | 2,160,000 | 536,870,912 |
| Sharp surfaces/direct scenes | 0 | 512,000,000 |
| Camera previews | 5,635,374 | 64,000,000 |
| RAW read-ahead | 0 | 768,000,000 |
| Hand-off | 140,049,380 | 256,000,000 |
| Retained working caches | 0 | 600,000,000 |

The owner telemetry is 374 ms older than the peak process sample. The latest
renderer thumbnail estimate is 25,200,000 bytes (sharp zero), showing that
asynchronous reports can differ; both readings are retained in JSONL. Working
reservations separately total 600,000,000 bytes. Reported cache bytes are well
inside their shares despite the helper's excess temporary allocation.

Main's maximum charge was 237,823,122 bytes, maximum ordinary working set
306,454,528, and its largest observed byte upload 15,102 bytes. The former
0.90 GB rise did not recur in this short run; this is not a ten-minute bound
or a complete explanation of the historical spike.

Lock maxima: `marks_read` 110 ms, `marks_read_copies` 125 ms, `index_scan`
31 ms (`index_batch` 0 ms). The longest remaining hold was **734 ms in
reconcile**, still over the approximately 250 ms requirement, at shutdown
immediately after the ceiling sample. Splitting to one photo is insufficient
for that database/filesystem scope. The historic Delete/morning-freeze
causation remains unproven as described above.

Delete confirmation: **not run**. `library-scroll-cache`,
`library-precision-source`, `library-rgb-native`, `library-live-native`,
`library-codec-native`, and `library-background-activity`: **all not run after
this commit because the preceding ceiling gate stopped**. Earlier results
are historical, not validation of `f56075a`. The protected project hashes
remain unchanged; the owned C: profile and disposable Delete fixture are
removed. D:/Photos was only read. Output remains 2.0 GB, below 100 GB.
Evidence: `measurement.json`, `measurement-memory.jsonl`, `process-curve.csv`,
`cache-peak-end.csv`, `analysis.json`, and `measurement-backend.log` in
`codebase/output/big-folder/budget-validation-resumed/`.


### October 29: bounded CPU ARW picture

The no-GPU ordinary ARW thumbnail/screen development now processes full-resolution
sensor bands with 32-row halos and temporary planar files. It retains only the
640/2560 reductions in memory. Opposed-colour highlight coordinates are scanned
in bounded batches. This is a working-allocation change; no share or total changed.

With GPU delivery explicitly disabled, the complete visible CPU fallback for
`DSC07060.ARW` (7968 x 5320, 42.4 MP) returned a finished picture in 25.61 s.
The helper's proportional resident peak, including its baseline, was
**328,528,456 bytes**, within the **600,000,000-byte** working room.
Before comparing pixels, the proposed finished-SDR tolerance was average colour
difference below 1 and p99 below 2. Against the former full-image CPU route,
mean Delta E 76 was 0.0584 and p99 0.1948: inside those limits.

Qualification covers ordinary ARW, opposed-colour highlights, no saved repairs,
and edges at most 2560. Other formats, edge-colour, saved repairs and native CPU
inspection still use the previous development path and are **not qualified within
600 MB**. This is not a claim that every no-GPU recipe is bounded.
Evidence: `codebase/output/big-folder/cpu-bands-validation.json` and
`cpu-bands-parity.json`. Fast Python: 2734 passed, three existing failures,
three skipped. The existing failures are the scoped-preset source contract,
RGB publication fixture and retouch CaptureCache fixture. CPU-focused numerical
checks pass. No protected project was saved over.


### October 29: five-minute manual checkpoint after afcca55

Steve shortened this round to five minutes and deferred all six Library drivers
until before merging to main. The code is committed on `library-big-folder`;
there is no merge or push. Shares and the 4,000,000,000-byte total are unchanged.

Memory shortage now keeps source development on the GPU admission queue. The
page only selects CPU after a missing/software/lost GPU; generic development,
transfer and memory errors cannot select it. Capacity refusal in the backend,
including bounded DNG metadata/storage limits, answers pending. Unsupported GPU
source recipes report an error rather than silently selecting CPU. Idle and
speculative requests do not start CPU development; visible work has priority.

The regression had multiple contributing paths. At f56075a, camera-preview
requests began waiting for the entire working slot while holding browser HTTP
connections. The GPU source owning that slot needed those connections for
admission and handoff. Preview refusal now returns 202 immediately, and the
page retries without occupying a connection. Scrolling also cancelled every
loading cell, even overlapping ones; reconciliation now cancels only departed
cells. Finally, the ordinary Bayer reservation charged 44 bytes per photosite
although measured live allocations fit 28 plus the existing fixed overhead.
That estimate evicted finished surfaces before actual pressure. Complex graphs
retain their larger estimate. A 42 MP GPU ARW measured 1,041,881,888 live bytes
inside the new reservation. Direct RGB scenes are stored before eviction, so
reclaim does not discard the only finished scene. No share was enlarged.

The first five-minute attempt was **not a retention pass**: thumbnail bytes
fell to 102,221,440. The final run below is the manual checkpoint: thumbnails
rose toward their 512 MiB share and remained retained at the end.

**Memory/retention pass, overall gate incomplete.** At 2560 x 1440, the final
read-only D:/Photos scroll lasted 300.444 seconds. Peak proportional
resident process-tree charge was **3,075,009,385 bytes**; scroll end was
**2,737,641,174 bytes**. The maximum finished visible grid-cell count was
30; the last count was 5. These are visible canvas counts, not a total
of cached photos. Transient zero counts while moving do not mean empty caches.

| Scroll seconds | Main | Tabs | GPU host | Backend | Helpers | Total GB | Finished visible cells |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.054 | 0.166 | 1.313 | 0.099 | 0.255 | 1.915 | 0 |
| 60 | 0.196 | 0.472 | 0.978 | 0.291 | 0.256 | 2.223 | 5 |
| 120 | 0.154 | 0.610 | 1.008 | 0.444 | 0.257 | 2.506 | 18 |
| 180 | 0.326 | 0.549 | 0.953 | 0.249 | 0.257 | 2.367 | 0 |
| 240 | 0.120 | 0.609 | 1.077 | 0.396 | 0.257 | 2.492 | 12 |
| 300 | 0.173 | 0.726 | 1.039 | 0.422 | 0.257 | 2.652 | 5 |

The total includes utility, launcher, crash-handler and console processes in
addition to the groups shown. It did not cross the ceiling. There is **no proven
plateau**: five minutes ended while thumbnails were still accumulating. This
is not the deferred ten-minute endurance result. Full per-PID samples and
one-second finished-cell counts are in `process-curve.csv` and
`finished-grid-cells.csv` beside `measurement-memory.jsonl`.

| Share | Bytes at process peak | Bytes at scroll end | Share bytes |
| --- | --- | --- | --- |
| thumbnails | 298,760,960 | 335,690,880 | 536,870,912 |
| sharp | 0 | 0 | 512,000,000 |
| camera | 50,084,241 | 60,949,335 | 64,000,000 |
| raw | 0 | 0 | 768,000,000 |
| handoff | 112,143,180 | 110,408,954 | 256,000,000 |
| working | 0 | 0 | 600,000,000 |

These are latest asynchronous owner reports: 563 ms before the peak and
845 ms before scroll end. The working reservation is separately 600,000,000
bytes at those samples; retained working-cache bytes are zero.

Longest scrolling marks-lock hold: **360 ms**, `marks_read` in accepted listing,
plus a **281 ms** picture-error revision hold. Both occurred during normal use,
so the approximately 250 ms criterion **fails**. Reconcile connection open/close,
pin reads and known-path stat checks now occur outside its marks lock; this does
not establish that all remaining read/revision scopes are short enough. The
historic 734 ms shutdown reconcile observation stays open separately.

Disposable-copy Delete confirmation took **40 ms**; it was cancelled and the
copy remained intact. Earlier, the bin size/count query independently took
34.97 s. Planning now selects the local-drive RecycleItem route without enumerating
the bin. Actual recycle failure still leaves the file alone and cannot silently
permanently delete it. All three protected project hashes were unchanged;
D:/Photos was read-only. Owned measurement profiles and fixtures are removed.

The isolated cold `_DSC3289_DxO.jpg` development took **2.098 s**, with upload
42.7 ms and reduction 115.3 ms; the resumed run reported 2.04 s and 4.24 s for
those stages. Admission request maximum was 4.7 ms in isolation. Those stopwatch
stages include asynchronous admission/network time, not GPU timestamp intervals.
The RGB GPU algorithm is unchanged against main 8ff72f8; the newly blocked
preview/admission path and request contention explain the multi-second stage
inflation. This is a supported contention diagnosis, not proof that all cold
latency regressed or recovered: **the earlier sub-second cold target is not yet
re-established**. The ordinary permit now lasts at most 100 ms instead of one
HTTP request per band; cancellation still checks each boundary (DNG keeps 20 ms).

Fast checks: JavaScript **665 passed, one existing failure** (Single test lacks
HDRLibraryScreenPreviews); Python **2734 passed, three existing failures, three
skipped** (the three exceptions named in the CPU note above). The later reconcile
change passed 40 focused membership/delete checks, with two real-bin cases
excluded from that focused rerun; full Python already covered those cases.
Six Library drivers and the full ten-minute scroll were **not run**, as requested.
Output ended at 2.1 GB, under 100 GB.

Evidence: `codebase/output/big-folder/five-minute-reviewed/measurement.json`,
`analysis.json`, `process-curve.csv`, `cache-peak-end.csv`,
`finished-grid-cells.csv`, `measurement-memory.jsonl`, and `measurement-backend.log`.
JPEG isolation: `codebase/output/big-folder/jpeg-isolated.json`.

### October 30: badminton cache and admission checkpoint

Waiting for working memory now stays in the ranked waiting queue, outside the
active source slots. Admission uses short requests with no connection retained
between retries. Metadata also returns pending while its helper lane is occupied
by a source. A GPU development that cannot fit must not block a smaller cached
draw that can fit. Newly visible development can cancel an offscreen source
parked at GPU admission and release its working reservation. No ceiling, share,
decoder version or GPU algorithm changed.

The scene-key regression was validation materialising the neutral
`edge_colour_expand_percent=0.5` in authored RAW settings. Canonicalising that
default restores the exact earlier keys for DSC07209/17/23/11/16; all five NPZs
still exist in the real managed cache. This was a key change, not eviction or
failure to store. Default-source and finishing-only reuse remain covered.

The incident's 23:21:34 checks for DSC07232 onwards were untraced idle-warmer
checks, not proof of completed visible-cell requests. The historical 50-second
holder cannot be identified from that log alone. Reproduction did identify
metadata connections held for seconds, hydration gating pictures for 6–11 s,
and an ungranted large GPU reservation blocking fitting draws; these gates are
removed. Grid read-ahead is cache-only and follows the viewport; full idle
warming waits until visible cells finish and every picture queue is idle.

Final isolated 2560 x 1440 scripted run: eight scroll positions through the
DSC0720x–0725x rows, six-second pauses, copied index and retained scenes in an
owned disposable profile; original photos only read. No drivers or ten-minute
run. Independent process-tree proportional-resident sampling at 0.5 s peaked at
**1,899,322,216 bytes**, below **4,000,000,000**. At that sample (bytes): Electron
PIDs 41804=52,827,282; 1176=1,277,063,753; 22092=134,579,346;
20488=37,771,556; 30636=17,890,157; 33316=8,462,336. Backend Python
39556=114,848,329; helper PIDs 38820=62,855,460; 20644=64,616,740;
14216=62,924,507; 40076=62,703,908. Python launcher 38328=1,014,052;
conhost 15548=1,764,790. Raw working-set sum was 2,344,562,688 bytes; it is
not the ceiling charge because it double-counts shared resident pages.

Of 73 ARW grid request attempts in those rows, 41 presented before leaving the
viewport/end: 31 unedited (1.665–11.551 s, median 3.938), ten edited
(3.587–5.323 s, median 4.371). **40 presentations exceeded 2 s**; 32 attempts
had no finished thumbnail before scroll/end, all observed unfinished for over
2 s in viewport snapshots (CSV records those lower bounds separately).
These are actual trace-ID joins
to compositor presentation, not DOM insertion matches or assumed successes.
This is not a complete latency pass. DSC07209 and DSC07211 presented on return
in 3.884/4.495 s; the other three named edited photos were scrolled away before
presentation. None of the five was redeveloped. Actual GPU admission order was
the exported DSC07198 Version 1 JPEG five times (cancel/retry), then DSC07259.ARW.
Earlier incident order was DSC07209 → 07217 → 07223 → 07211 → 07216.

Fast checks: final JavaScript 669 passed, one existing Single fixture failure
(`HDRLibraryScreenPreviews` missing). Full Python during iteration: 2725 passed,
13 failed, three skipped; ten failures introduced by the intermediate key fix
were corrected and rechecked (109 passed, one existing RGB fixture failure).
Final focused admission/key tests: 46 passed. The other existing Python failures
are the scoped-preset source contract and retouch CaptureCache fixture. No broad
rerun after those focused corrections. Protected project and photo-sidecar
hashes were unchanged; no page errors. Steve should try this checkpoint before
further memory work; the earlier deferred work below stays open.

Evidence under `codebase/output/badminton/`: `scroll.json`, `cell-timings.csv`
(every request, including missing results and >2 s flags), `summary.json`,
`restored-scene-keys.json`, `backend.log`, and fast-check logs. Owned copied
profile/cache scratch is removed after measurement; evidence is retained.
Output started and ended at 2.1 GB, below the 100 GB limit.

## 8. Open work

- Bound and qualify the remaining no-GPU CPU recipes listed above; only the ordinary ARW path has the measured 600 MB result.

Steve requested a manual try before the full ten-minute scroll and six drivers.
Do not run that deferred sequence in this round or increase shares. The latest
five-minute run passed memory/retention but did not pass the normal-use lock
criterion: shorten the 360 ms marks-read and 281 ms revision scopes. Broader CPU
recipes remain unqualified within the working room as listed above.

- Camera-preview admission, Grade cache ownership and single-row reconcile
  scopes are implemented; their whole-app effect still needs the gate below.
- Complete the ordered ten-minute read-only scroll, disposable Delete timing,
  then six sequential Library drivers. Stop if process charge crosses the
  ceiling. Record peak/end cache shares and per-process curve here.
- Confirm Electron main levels off after removing the byte-upload copy path.
- Validate macOS measurement/pressure on a Mac before claiming parity.
- Lock changes move path probes and grade/copy observation outside the outer
  marks read lock, and split index writes into single-row scopes. Measure the
  longest remaining hold; a slow filesystem/database call can still exceed
  250 ms, which must remain open if observed.
- The 33.516-second Delete planning hold was a later reproduction, not an
  identified holder in the October 29 08:17:32–08:17:50 incident. That incident
  recorded waits around 18.2 s without the outer holder's stack. The later
  hold can explain such a wait in principle, but cannot establish causation.

## 9. Rules for agents

- Any change to a size, share or the total is a decision for Steve. Record it
  in section 3 and update section 4 in the same commit as the code.
- A new cache must name its share, its process and what it drops first.
- Report memory per process and in total, using the method in section 7.
- Sources for this approach: darktable's fixed memory presets
  ([memory & performance tuning](https://docs.darktable.org/usermanual/4.8/en/special-topics/mem-performance))
  and Chromium's memory-pressure listener
  ([memory_pressure_listener.h](https://android.googlesource.com/platform/external/chromium_org/+/03339f7/base/memory/memory_pressure_listener.h)).

### October 30 retry: saved scenes and working room

Steve clarified that shares cap what caches **keep**, rather than partitioning
RAM into exclusive job slots. The 600 MB is a minimum kept free, not the
maximum for jobs. Development admission now compares actual whole-app charge
plus outstanding reservations plus the requested bytes with the unchanged
4,000,000,000-byte ceiling. It no longer clamps a request to 600 MB or forces
all concurrent jobs into that amount. Visible-first scheduling stays in the
ranked Library queue. Retained Grade levels keep their own 600 MB aggregate
cap and are not evicted on every new admission or ten-second lease renewal;
they are reclaimed when total room is needed. Cache growth leaves the working
minimum free. Reservations conservatively include work already reflected in
process charge; this can refuse work before the measured ceiling when its
additional reserved bytes would not fit. It is not a 600 MB slot refusal.

The fixed slot was introduced by `b567c15`; `f56075a` made Grade retained
levels consume that same slot, and renewal also discarded those levels.
Neither change altered Library disk scene identity. Source-mip ownership and
Library NPZ ownership are separate: Grade mips use content fingerprints and
interpretation; Library scenes use file version, edge and source quality.
Neither includes cache owner/object identity. See the photo-library retry note
for the scene-key audit and short read-only measurement results.

Short retry measurement: **2,091,545,156 bytes** peak whole-app proportional
resident charge, below the unchanged 4 GB ceiling. No working-memory wait and
no admission request occurred: every edited cell used a stored scene. Behavior
checks separately admit three 600 MB jobs with a 1.8 GB measured app total,
preserve Grade retained levels during admission/renewal, and reject work whose
charge plus outstanding reservations would exceed the ceiling. The first
cached row still had draw-queue delays; this is not a complete latency pass.
See photo-library for the per-cell results and recorded known fast-check
failures (34 final focused checks pass). The profile and scene copies are
removed; original scenes/sidecars and protected projects remain unchanged.
Output started and ended at 2.1 GB. Steve's manual retry is the next checkpoint.

### October 30: keep pending Library previews drawable during reclamation

The exported-JPEG loop was a GPU lifetime error, not a new memory allowance:
six RGB source planes outlived their last reduction use. Releasing each plane
after that use fits the existing development reservation. Cache shares, the
whole-app ceiling and GPU budgets are unchanged.

The first-draw preview loss was hand-off ownership: the LRU could evict both
published bytes and their pending-store receipt while a visible draw waited.
Before evicting an undelivered pending entry, the hand-off owner now validates
its source/settings and atomically writes the already-packed NPZ into the
existing thumbnail/full-size disk cache, then releases RAM. Existing disk
accounting and trimming apply; no separate spool, byte copy cache or allowance
is introduced. Ordinary delivered transient bodies still release normally.
Install ownership before RAM admission for GPU and CPU publication; retain it
until pending disk publication finishes, so concurrent reclaim cannot leave
a gap with neither RAM nor disk backing. Changed-source checks still reject
publication. Disk I/O errors propagate as explicit failures rather than
publishing a missing preview.

Behavior checks cover both immediate hand-off admission refusal and later
zero-byte reclamation, and drawing during disk publication. The short fresh
profile open of disposable `20260214` copies backed **21** pending previews
during reclamation: all **18** developed cells presented, each developed once,
without restarts or draw failures. Per-cell timings and the JPEG failure
explanation are in photo-library's matching October 30 note; this is not a
new process-memory or endurance qualification. No drivers or ten-minute run.

Final focused cache/scene/error checks: 52 passed. The photo-library note
records the full fast-suite failures without claiming a clean broad pass.
Output started/ended at 2.1 GB; owned photo/profile/pytest scratch removed.
Both module records accompany this local `library-big-folder` commit.


### October 30: keep control sampling responsive during cold development

Memory sampling now runs on a dedicated executor, independently of the
ordinary API worker pool and disk reclamation. A single-flight process census
prevents concurrent callers from allocating duplicate Windows working-set
queries. Timestamp the completed census, avoiding an immediately stale sample.
Admission uses its own workers. Reclaim requests coalesce on a separate worker
and acknowledge queueing promptly; critical pressure upgrades pending work.
Disk spills no longer block subsequent controller samples. The desktop also
forwards the existing controller's pressure to Chromium's native allocators;
renderer cache eviction alone did not release accumulated transfer buffers.

The Library disk cache now evicts from its size/access-age ledger, releasing
the shared publication lock between small LRU families, rather than rescanning
the cache during every over-budget save. RGB preview handoffs carry clipped
half samples, matching the existing persisted NPZ precision and reducing
transient copies. Source ownership renews through waits and saves. The GPU
footprint estimate includes actual overlapping buffers/textures. No RAM
ceiling, target, cache share, disk allowance, 600 MB minimum or concurrency
setting changed.

Final fresh-profile cold mixed-60 capture with pinned indexing active:
**190** memory endpoint requests, **zero timeouts**, **127.8 ms p95**,
**336.5 ms maximum**, independently sampled whole-app peak
**3,826,597,295 bytes** (ceiling remains **4,000,000,000**). All first-two-screen
observations finished: 42 observations of 29 distinct photos because the
viewports overlap. The full photo-library note records per-cell latency,
stage times, reconcile counts, test failures and the still-slow 95-second
first screen. Three protected-project hashes were unchanged.

This is evidence for the short sample, not a guarantee for all 449 files.
Fast native half conversion exceeded the ceiling in an experiment; adding a
separate reservation while decode reservations were held then blocked work.
Both experiments are omitted. More concurrent GPU developments are not
recommended until transient allocation/readback ownership is improved.
Existing minimum, budgets and shares remain Steve's decision.

Output started and ended at **2.1 GB** (100 GB limit). Owned temporary
photo/profile/pytest scratch was removed; only linked small evidence remains.
Committed locally on `library-big-folder`; stop for Steve's retry.
