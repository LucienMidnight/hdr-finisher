# Design: one scheduler for Library memory and GPU work

Status: **DRAFT FOR STEVE'S REVIEW, October 30, 2026.** Design only. No code
changes are approved by this document. Each phase below is approved
separately, and every size or count marked "Steve's decision" stays a
proposal until he agrees it.

Owner modules: [photo-library](../../product/modules/photo-library.md),
[memory-and-caches](../../product/modules/memory-and-caches.md),
[preview-and-gpu](../../product/modules/preview-and-gpu.md).

## 1. Why this document exists

Since October 29 the Library has had a run of stalls, false failures and
disappearing thumbnails. Each fix addressed the visible symptom in one place
and the problem moved somewhere else. The cause is not one bug. Work in the
Library passes through about ten separate gates, each with its own rules,
retries and idea of priority. No single part decides what runs next.

This document maps the system as it is, explains why it keeps failing, looks
at how proven software solves the same problem, and proposes one
conservative design to build in small, separately testable phases and then
tune from measurements.

## 2. Goals and non-goals

Goals, in order:

1. **What is on screen comes first, always.** A visible photo never waits
   behind background work, and a small job never waits behind a big one.
2. **Stay under the agreed RAM ceiling** (the smaller of 4 GB or a quarter of
   RAM, never below 2.5 GB; Steve, October 29) and the GPU memory budget,
   without throwing away finished work unless memory is really short.
3. **No false failures.** Waiting, yielding or cancelling never marks a photo
   as broken.
4. **One place to look.** Every job is visible in one log line sequence:
   asked, admitted, started, finished, with estimated and measured size.
5. **Conservative first, tuned later.** Start with fixed, small, well
   understood limits that are known to work; raise them only from
   measurements.

Non-goals: changing the RAM ceiling or any cache share (those stay Steve's
decisions); changing pictures or exports; supporting old saved state
(pre-1.0 rule).

## 3. How it works today (the whiteboard)

Three resources are shared: **app RAM** (all processes together, ceiling
4 GB), **GPU memory** (the GPU broker's budget, shared with Grade and
export), and **connections between the window and the backend**.

### 3.1 The gates a grid thumbnail passes

For a camera RAW in the grid, in order:

| # | Gate | Where | Rule today |
| --- | --- | --- | --- |
| 1 | Quick preview (embedded JPEG) | backend `library_api.py` `quick_preview` | Reserves a fixed 600 MB before extracting (real use: a few MB). Refused → HTTP 202 → window retries every 250 ms. |
| 2 | Source preparation lanes | window `library-scenes.js` `sources` | Queue with one lane per CPU core. |
| 3 | RAW decode | backend `library_raw.py` | Reserves a fixed 600 MB. |
| 4 | RAW read-ahead | backend `library_raw.py` | Cache share, 768 MB / 12 files. |
| 5 | Helper process queue | backend `library_worker.py` | Its own priority queue; claims memory over IPC. |
| 6 | GPU development lease | backend `gpu_delivery.py` `raw-budget`, asked from `library-gpu-raw.js` | Exclusive (`concurrent:false`): one development at a time. Window re-asks every 50–100 ms while waiting, and again about every 100 ms during the development; a "no" mid-development throws the work away ("yield"). |
| 7 | Draw lease | `library-scenes.js` `lease`, same endpoint | Finished pictures need the same GPU lease to draw, so they wait behind developments. |
| 8 | Draw queues | `library-scenes.js` `draws`, `quickDraws` | One at a time each. |
| 9 | Hand-off and store | backend `library_pictures.py` | Cache share 256 MB; both 640 and 2560 sizes are made for every grid cell. |
| 10 | Idle pre-warmer | `photo-library.js` `createWarmer` | One photo at a time after 1 s idle. |

Grade and export use the same GPU broker (gate 6) with their own permits.

### 3.2 How memory is checked

* The backend's `app_memory` measures every process of the app (Electron main,
  windows, GPU process, Python and helpers) and keeps a list of
  reservations.
* Admission grants a job if **measured total + all reservations + this
  request ≤ ceiling**. A running job's memory is counted **twice**: once in
  the measured total and once in its reservation, until it ends.
* Any refusal sets a "waiting" flag for 2 seconds, which reports
  **budget pressure**.
* Every 500 ms the Electron main process reads that report. While budget
  pressure is reported, on every tick:
  * every window halves each of its caches and clears its recent pictures;
  * Chromium is sent a **critical** memory-pressure signal (through the
    debugger), so it discards its own caches in every process;
  * the backend runs a reclaim pass.

### 3.3 What that produces (measured in Steve's 18:18 run, October 30)

* Two or three developments held 1.2–1.8 GB of reservations while the app
  used 2.1–2.7 GB. The arithmetic said "full" although about 1 GB was free.
* Every quick preview was then refused. Embedded JPEGs that take 56 ms to
  extract waited a median 2.1 s, up to 31 s.
* Each refusal turned into two seconds of "critical" pressure, so finished
  thumbnails were thrown away (29 reclaims) and had to be made again, which
  needed more memory: a feedback loop.
* One development at a time, plus draws behind developments, meant photos
  finished about one per second even when memory was free.
* Retry loops made each gate's rules more complicated, and those rules
  produced their own bugs (for example, three yields marked `_DSC6679.ARW`
  as broken).

### 3.4 Root causes, in one list

1. **No single decision maker.** Ten gates decide on their own, with
   different priorities. Work can hold one resource while it waits for
   another.
2. **Fixed guesses instead of estimates.** Every job reserves 600 MB,
   whatever it needs.
3. **Counting memory twice.** Reservations stay on top of measured use.
4. **"No" is treated as "memory is short".** A refused admission sets off
   emergency clean-up in every process.
5. **Polling instead of waiting in line.** Jobs ask again and again instead
   of being told when it is their turn. Polling also uses connections (see
   4.1).
6. **The GPU lane is exclusive by construction,** and draws share it.
7. **Grid cells make the large screen preview too** (16 times the data of the
   thumbnail).

## 4. What proven software does

### 4.1 Chromium and Electron: constraints we must respect

* **Six connections per server.** Chromium allows six simultaneous HTTP/1.1
  connections per host and port. The Library window and the hidden GPU
  delivery window both talk to `http://127.0.0.1:<port>`, so they very likely
  share those six. A request that waits or polls uses one up. WebSockets have
  a separate, much higher limit (255).
  ([client_socket_pool_manager.cc](https://chromium.googlesource.com/chromium/src/+/HEAD/net/socket/client_socket_pool_manager.cc))
  *Design consequence:* waiting for a turn must not hold an HTTP request;
  grants arrive over one long-lived channel.
* **Per-process JavaScript memory is limited.** Electron builds use V8
  pointer compression, which caps each process's JavaScript heap at 4 GB;
  ArrayBuffers are counted separately with their own limits, and since
  Electron 21 they must live inside V8's memory cage.
  ([Electron: V8 memory cage](https://electronjs.org/blog/v8-memory-cage))
  *Consequence:* large pixel buffers in the window are a real cost, and the
  scheduler must count them.
* **Chromium's own memory-pressure levels** (moderate, critical) come from
  free physical memory. Critical is reported every time; moderate only on
  entry, and then only after a cool-down.
  ([memory_pressure_monitor_win.cc](https://chromium.googlesource.com/chromium/src/+/ebac7f0193fe2e8cc8835a13f06ac1ef86354de2/base/memory/memory_pressure_monitor_win.cc))
  *Consequence:* sending "critical" every 500 ms because one job was turned
  away is far outside Chromium's own practice. Signal on a change of level,
  with a cool-down.
* **Blob storage** keeps up to about 2 GB (64-bit desktop) in memory and
  writes the rest to disk. Our hand-off uploads use Blobs.
  ([blob_memory_controller.cc](https://chromium.googlesource.com/chromium/src/+/8ff1e4f84ea36f339d440252ab36559263cf540c/storage/browser/blob/blob_memory_controller.cc))
* **GPU memory failures can be caught.** WebGPU reports out-of-memory through
  `pushErrorScope("out-of-memory")` and `GPUOutOfMemoryError`; the app can
  free work and try again instead of crashing.
  ([MDN: GPUOutOfMemoryError](https://developer.mozilla.org/en-US/docs/Web/API/GPUOutOfMemoryError))
* **Chromium's tile scheduler** (the compositor that draws web pages) is the
  closest proven model for a scrolling grid. Work is sorted into priority
  bins — **now** (visible), **soon** (about to scroll in), **eventually** —
  and memory is handed out by walking the queue in priority order until the
  budget is used. Work that does not fit is simply not started; nothing is
  thrown away to make room for lower-priority work. Visible work may use a
  larger (hard) limit than prepainting (soft limit).
  ([Chromium memory and tile priority, summary](https://grida.co/docs/wg/research/chromium/memory-and-priority);
  [managed_tile_state.h](https://android.googlesource.com/platform/external/chromium_org/+/3551c9c/cc/resources/managed_tile_state.h))
* **Measurement sources available to us:** Electron `app.getAppMetrics()` and
  `process.getProcessMemoryInfo()`, Chromium tracing (`contentTracing`, the
  `memory-infra` category gives a per-allocator breakdown per process), and
  our existing Windows per-process charge sampling.

### 4.2 darktable

([memory & performance tuning](https://docs.darktable.org/usermanual/development/en/special-topics/mem-performance/))

* **Fixed presets, not live guessing.** A "resources" setting (small,
  default, large) gives fixed fractions of total RAM for processing (default
  50%), for the thumbnail cache (default 12.5%) and for GPU memory (default
  about 70% of the card after a fixed 600 MB headroom).
* **Plan by estimate, before starting.** Each processing step estimates the
  memory it needs. If it does not fit, darktable splits the image into
  tiles (slower, never fails) instead of refusing or waiting.
* **GPU headroom is fixed** because the GPU cannot use swap and the app
  cannot see how much is free.
* **A busy GPU has a timeout** (about 2 s by default) after which work falls
  back to the CPU.
* **The thumbnail cache is a fixed size** and drops the oldest entries.

### 4.3 Other image tools

* **ImageMagick** has fixed resource limits (memory, map, area, disk). When
  the memory limit is reached, it writes pixels to disk instead of failing.
  Only exceeding the disk limit is an error.
  ([security policy](https://imagemagick.org/script/security-policy.php))
* **libvips** keeps a small operation cache with a memory limit, and runs one
  worker per CPU thread by default. Its docs say it can only track memory it
  allocates itself, not memory used by other libraries — the same limitation
  we have.
  ([vips_cache_set_max_mem](https://www.libvips.org/API/current/func.cache_set_max_mem.html))

### 4.4 Scheduling theory: the "weighted semaphore"

A standard building block (Go's `x/sync/semaphore`, and ports of it) gives
out a fixed number of units. Each job asks for its weight and waits in line.
A strict first-come, first-served line never starves a big job, but a big
job at the front blocks small ones behind it even when they would fit.
([Resiliency.WeightedSemaphore](https://hexdocs.pm/resiliency/Resiliency.WeightedSemaphore.html))
*Design consequence:* separate small, urgent work from large work so small
jobs are never stuck behind a large one.

### 4.5 What this tells us

All of the proven designs share five traits:

1. **one owner** decides what runs;
2. **fixed budgets** sized from total RAM;
3. **per-job estimates**, checked before starting;
4. **a priority order**: visible, then soon, then eventually;
5. **if work does not fit, it waits its turn** (or tiles or spills to disk).
   It does not trigger emergency clean-up.

Emergency trimming is reserved for real shortage reported by the operating
system.

## 5. Options considered

| Option | What it is | Verdict |
| --- | --- | --- |
| A. Remove the 600 MB reservations | Jobs just run; caches still capped. | Fastest, but with nothing stopping several large jobs at once, small machines can go well over the ceiling. Not conservative. |
| B. Patch today's gates | Smaller reservations, no double count, refusal ≠ pressure. | Fixes this week's symptoms, keeps ten gates and polling. This is what has been going in circles. |
| C. **One central scheduler** (chosen) | Every job that needs real RAM or GPU memory joins one ranked queue. One owner admits it by estimate against fixed budgets. | The pattern used by Chromium, darktable and ImageMagick. More work, but it removes the root causes instead of moving them. |
| D. Scheduler in the window instead of the backend | The window knows what is visible. | Rejected: Grade, export, helpers and the delivery window would each need their own copy, and the backend already measures every process. The window still supplies priority (what is visible). |

## 6. Proposed design

### 6.1 One scheduler, in the backend

The backend already owns the memory measurement and the GPU broker, so the
scheduler lives there and replaces gates 1, 3, 6 and 7 (and later the
separate retry rules around them). It keeps three numbers:

* **RAM job budget:** the existing 600 MB working room, plus whatever the
  cache shares are not using at the moment (reported cache bytes, not noisy
  process measurements). This keeps the agreed split: caches can never
  squeeze out jobs, and jobs never push caches over their shares.
* **GPU budget:** the broker's existing budget; unchanged.
* **Concurrency:** how many GPU developments may run at once.

A job is admitted when its **estimated** RAM and GPU memory both fit in what
the running jobs' **estimates** leave free. A job's estimate stays reserved
until it ends. The measured process total is not part of this arithmetic,
which removes the double count.

### 6.2 Measured memory is a safety net, not the admission rule

The measured whole-app total is still sampled every 500 ms, as now:

* above the target (ceiling minus working room): stop admitting **soon** and
  **eventually** work and trim caches once, oldest first;
* above the ceiling: also pause new **now** work except the selected photo,
  and trim harder;
* operating-system **critical** pressure: drop everything that can be made
  again (as now).

Trimming happens **once per change of level**, with a cool-down, as Chromium
does. A refused admission **never** counts as pressure, and the app never
sends Chromium a pressure signal of its own making except on real shortage.

### 6.3 Priority classes

Taken from Chromium's tile bins and matched to what Steve sees:

1. **Grade and export** (the photo being edited or delivered).
2. **Now:** the selected photo in Single, and grid or filmstrip cells
   currently visible.
3. **Soon:** one screen ahead and behind, Single's neighbours.
4. **Eventually:** idle pre-warming, background indexing work.

Higher classes go first. Within a class, first come, first served. A cell
that scrolls away drops to a lower class or is cancelled. Cancelling is never
a failure.

### 6.4 A fast lane for small jobs

Jobs estimated under a small size (embedded camera JPEGs, small
original-JPEG previews) are admitted from a small separate allowance taken
from the working room, so they never wait behind a large development.
Proposed: 64 MB, with up to four at once. **Steve's decision.**

### 6.5 Estimates per job type

Each job type gets a written estimate formula from its pixel size. As a
safety margin, each estimate is the measured peak plus 25%. When a job ends,
its real peak is logged next to the estimate. A job that goes over its
estimate is logged, and repeated overruns raise that type's estimate. A
picture too large for any budget runs alone, with nothing else admitted
beside it. This is the conservative equivalent of darktable's tiling: slower
but never refused forever.

### 6.6 Waiting in line without polling

A job asks once and waits. The answer ("your turn") comes over one
long-lived channel from the backend to each window: a WebSocket, which has
its own connection limit. While waiting, no HTTP connection is held and no
polling runs. Leases are renewed by the same channel, not by repeated
requests.

### 6.7 GPU work

* Developments may share the GPU when their GPU estimates fit. Start
  conservatively at **two** at once (one on the GPU while the other reads
  back and hands off). **Steve's decision.**
* Draws of finished pictures do not need a development lease. They are
  small, and they get their own small GPU allowance.
* Grade and export keep priority. **Steve, October 31: this replaces “not
  thrown away” for GPU work.** Stop Library GPU work at its next safe point,
  release its GPU memory and discard GPU intermediates. Requeue without
  spending an attempt. Keep the decoded CPU source only when it fits the
  existing free RAM share; otherwise drop it. No disk checkpoint. Export may
  wait only until that safe point (expected well under one second); log the wait.
* A GPU out-of-memory error frees Library work and retries once at the
  front of the line, before any CPU fallback.

### 6.8 What each view makes (Steve, October 30: grid makes thumbnails only)

How it works today (checked in code, October 30): the Library develops each
photo **without** its edit into a stored scene. The edit is applied by
Grade's shaders **when the picture is drawn**. The grid always draws from
the 640 scene (`thumbnailEdge()` is 640), so an edited photo's grid
thumbnail already shows its edit from the 640 scene. The 2560 scene is made
today only because every development produces both sizes at once.

The rules:

* **Grid and filmstrip:** develop only the 640 scene, for every photo,
  edited or not. Edited photos keep drawing their edit live on that scene
  (masks, local adjustments, Film Look, Denoise and so on), exactly as now.
  This must not regress (see the check below).
* **Edits that change the source itself** (retouch, lens correction, RAW
  import settings, anything in the scene identity) still trigger a new
  640 development: **now** work if the photo is visible.
* **Single, fullscreen and Compare:** the 2560 scene is made when a photo is
  opened there (**now**), then for Single's next and previous neighbours
  (**soon**). An unedited RAW in the grid never gets a 2560 scene until it
  is opened. The idle pre-warmer makes only 640 scenes while the grid is
  showing, and 2560 neighbours only while Single is open.
* **While the 2560 scene is made,** Single shows the photo's own finished
  grid picture scaled up (the existing October decision). An unedited photo
  may show its camera preview. An edited photo never does.
* **Stored screen previews** (the protected JPEG XL files) keep serving
  Single when they exist. Nothing changes there.
* **The camera's embedded JPEG** (or the original JPEG) is always shown
  first in the grid, through the fast lane, for unedited photos only.

**No-regression check for edited photos** (run in phase 5): a disposable
copy with edited photos covering masks, many local adjustments, Film Look,
Denoise, retouch and a virtual copy. Its grid and filmstrip pictures must
match today's pictures (perceptual difference below the just-noticeable
level). After opening each one in Single, the 2560 picture must match too.
The read-only test projects are opened from copies only.

### 6.9 Supported files and the file gate (Steve, October 30: be restrictive)

The Library lists a file only if it passes **every** rule below. Anything
else is ignored silently, or shown once as "unreadable" where noted. The
supported list is one explicit table in code (`SOURCE_EXTENSIONS`, today 24
extensions) and is also published in the user guide, so it is always clear
what the Library reads.

| Rule | Today | Proposed |
| --- | --- | --- |
| Extension is on the supported list | Yes | Unchanged; one list used everywhere (scan, index, add-folder browser, file checks). |
| Not a macOS `._` companion | Yes (October 30) | Unchanged. |
| Name does not start with `.` or `~` | No | Skip: hidden and temporary names. A `_` start stays allowed (Sony names Adobe RGB files `_DSC…`). |
| Not marked hidden or system by Windows | No | Skip, for files and whole folders. |
| Not inside a system, trash, snapshot or thumbnail folder | Six names | Skip the whole folder. Names compared without case: `$RECYCLE.BIN`, `System Volume Information`, `.Trash`, `.Trash-*`, `.Trashes`, `#recycle`, `@Recycle`, `@eaDir`, `.@__thumb`, `#snapshot`, `.snapshot`, `.DocumentRevisions-V100`, `.TemporaryItems`, `.Spotlight-V100`, `.fseventsd`, `__MACOSX`, `.AppleDouble`. (Any dot-folder is already covered by the rule above.) |
| Not empty or too small to be an image | No | Skip files under 1 KB. They are counted in the existing "unreadable files hidden" note. |
| Contents match a supported format | No | Read the first bytes before decoding. If they are another supported format (phones sometimes save HEIC as `.jpg`), decode it as that format. If they are not an image, show "not a valid photo" once, and don't retry until the file changes. |
| File is not still being written | No | If the size or modified time changed in the last 2 seconds, list the photo but wait to decode it until it is stable (a card copy in progress). |
| File is not an online-only cloud placeholder | No | OneDrive, Dropbox, iCloud and Google Drive "online-only" files download when read. The grid, filmstrip, pre-warmer and background work never read them; they show a "not downloaded" cell. **Opening one in Single, fullscreen or Grade downloads it (Steve, October 30)**, with progress shown. Neighbours are not downloaded ahead. After the download it is an ordinary local file. |
| Picture size | No limit | **No size limit (Steve, October 30: support really large images).** Read the dimensions from the header first. Very large pictures run alone through a bounded route (7.3); they are never refused for size. |

Our own temporary files must never end in a photo extension. Exports and
saves write to a temporary name and rename it when complete, so a
half-written export never appears in the Library. Phase 1 audits every
writer for this.

### 6.10 Memory budget per file type

Every supported type gets an estimate formula, used by the scheduler (6.5).
**Phase 0 measured them on October 30; see 6.11.** The table immediately
below is the original rough plan, kept for comparison.

| Type | Extensions | Library route | What uses the memory | 24 MP rough figure (to measure) |
| --- | --- | --- | --- | --- |
| Camera RAW | ARW, CR2, CR3, NEF, NRW, RAF, RW2, ORF, ORI, PEF, SRW | LibRaw unpack, GPU development | Sensor data (W×H×2 bytes), GPU working set (VRAM, existing `rawBudget`), read-back planes | about 50 MB sensor + read-back; VRAM per `rawBudget` |
| Camera RAW, quick preview | same | embedded JPEG | Decoded embedded preview (often 1–2 MP) | 5–25 MB |
| DNG | DNG | raw, linear or JPEG XL-compressed | As camera RAW; linear DNG holds 3 channels; tiles bound the working set | 50–300 MB |
| JPEG | JPG, JPEG | GPU direct | 8-bit decode W×H×3, upload copy | about 72 MB + copy |
| JPEG, quick preview | same | original preview | Full 8-bit decode, then reduced | 70–250 MB |
| PNG | PNG | GPU direct | W×H×channels×(1 or 2 bytes) | 72–190 MB |
| TIFF | TIF, TIFF | strip decode | W×H×channels×(1, 2 or 4 bytes); strips bound the reading | 72–380 MB |
| HEIC, HEIF, AVIF, JPEG XL | HEIC, HEIF, AVIF, JXL | native decode | 10–12-bit decode into 16-bit buffers; gain-map files decode two images | 150–300 MB |
| EXR, Radiance HDR, PFM | EXR, HDR, PFM | float decode | W×H×channels×4 bytes (2 for half-float EXR) | 150–380 MB |
| Stored outputs | — | hand-off | 640 scene about 3 MB, 2560 scene about 52 MB (half float) | as stated |

Rules on top of the formulas:

* **Dimensions come from the header,** read before admission. If the header
  can't be read, use that type's worst case.
* **Orientation:** rotated photos use the rotated dimensions.
* **Gain-map and multi-image files** (Ultra HDR, gain-map AVIF, HEIC with
  depth) count every image they decode.
* **Estimates are logged against measured peaks.** Overruns raise that
  type's estimate (6.5).
* **Reduced decoding is for quick previews only, never for the real
  thumbnail.** Real grid thumbnails keep the full-size decode, for two
  existing reasons:
  * Steve approved Grade's decoder and full-source measurements for
    thumbnails. Peaks and other measurements taken from the full source set
    the starting grade and highlight handling. A shrunk decode averages away
    small bright highlights, so the thumbnail would not match Single or the
    export.
  * A half-size (2×2 binned) RAW development was tried on October 18. It cut
    preparation from 7.6 s to 2.5 s, but failed the perceptual limits on
    DSC07216 (HDR ΔE ITP mean 2.37, p99.9 80; SDR ΔE 2000 mean 0.67, p99.9
    19), mostly in bright highlights, and was removed.

  Quick previews (the camera's embedded JPEG, or an unedited JPEG original)
  are placeholders with no grade or measurements, so a reduced decode is
  safe there (6.11, point 4).

### 6.11 Phase 0 results (measured October 30, 2026)

**Method.** `codebase/tools/measure_job_memory.py` ran each backend job
(the camera or original quick preview, the GPU source preparation, and the
CPU route) once per file, in a fresh process, on copies in
`codebase/output/test-photos/phase0/`. It ran one warm-up first, because
the backend is long-running and first-use imports are not a job cost. The
peak is the extra private memory, sampled every millisecond. Raw results:
`codebase/output/phase0-memory/backend-jobs.jsonl`.

GPU memory comes from 2,544 developments already stored in Steve's Library
cache (each stored scene records its `gpu_memory_peak_bytes`). Missing real
samples: Radiance `.hdr` and `.pfm` (synthetic 24 MP files were used),
`.heif` (same decoder as HEIC), and NRW, ORI, PEF and SRW (same LibRaw
sensor route as the other camera RAWs).

**Backend memory per job, measured:**

| Type | Job | Sample | Peak | Per pixel |
| --- | --- | --- | --- | --- |
| Camera RAW (ARW, CR2, CR3, NEF, ORF, RW2) | sensor read for the GPU | 16–42 MP | 84–235 MB | about 5.5 bytes |
| Fujifilm X-Trans RAF | CPU route (GPU route not eligible) | 26 MP | 461 MB | about 18 bytes |
| JPEG | GPU source decode | 3, 30, 42 MP | 55, 539, 761 MB | about 18 bytes |
| PNG | GPU source decode | 3, 42 MP | 54, 936 MB | 18–22 bytes |
| TIFF | GPU source decode | 8, 48 MP | 123, 964 MB | 15–20 bytes |
| HEIC (iPhone 16 Pro) | GPU source decode | 24.5 MP | 995 MB | about 41 bytes |
| AVIF | GPU source decode | 10.7 MP / 42 MP gain-map | 192 / 1,268 MB (16 s) | 18–30 bytes |
| EXR | GPU source decode | 42 MP | 1,027 MB | about 24 bytes |
| Radiance HDR / PFM (synthetic) | GPU source decode | 24 MP | 433 / 650 MB | 18 / 27 bytes |
| Linear DNG (DxO) | GPU source decode | 42.5 MP | 933 MB | about 22 bytes |
| Line-scan linear DNG | CPU route (one GPU buffer can't hold it) | 297 MP | **5,953 MB** (27 s) | about 20 bytes |
| JPEG XL, EXR without colour tags | CPU route | 6–14 MP | 260–620 MB | — |
| Camera RAW quick preview | embedded JPEG, full decode (today) | Sony 2 MP / Nikon, Canon, DxO full-size | 14–23 / 218–532 MB | — |
| Camera RAW quick preview | embedded JPEG, reduced decode | same files | 15–23 MB | — |
| JPEG/PNG quick preview | original decode (today) | 3–42 MP | 53–762 MB | — |
| JPEG quick preview | reduced decode | 30, 42 MP | 51, 20 MB | — |

**GPU memory per development, measured** (2,544 stored scenes): camera
RAW, DNG and EXR about 25 bytes per pixel (a 42 MP RAW about 1.04 GB). JPEG
about 27 bytes per pixel at full size (48 MP DJI JPEG 1.32 GB). TIFF about
37 bytes per pixel. Small pictures cost proportionally more because of a
fixed overhead. The existing GPU estimate (`rawBudget`: 28 bytes per pixel
plus 64 MB for ordinary RAW) covers the measured RAW peaks.

**What the measurements show:**

1. **The working room is smaller than one ordinary job.** A full-size
   non-RAW decode needs 0.5–1.3 GB of backend memory. The 600 MB working
   room cannot hold one, so on a 4 GB ceiling (1.3 GB starting memory plus
   caches) only one or two can run at once. Estimates must be per job, as
   designed. A fixed slot cannot work.
2. **RAW is cheap in the backend; other formats are not.** The RAW sensor
   read is about 5.5 bytes per pixel, but JPEG, PNG, TIFF, HEIC, AVIF and EXR
   decoding is 15–41 bytes per pixel. That is 5–10 times what is handed on
   (2–4 bytes per pixel for 8-bit sources). Making these decoders leaner is
   the largest memory saving available. It is recorded as open work, not
   part of this design.
3. **Some files are decoded and then rejected.** JPEG XL, EXR or TIFF
   without resolved colour tags is decoded in full (250 MB–2.9 GB, the
   192 MP TIFF at 2.9 GB) before the GPU route says "not eligible". The CPU
   route then decodes it again. Eligibility must be decided from the header,
   before decoding (new edge case F19).
4. **Quick previews are not always small.** Nikon, Canon and DxO embed
   full-size JPEGs. A reduced (DCT-scaled) decode cuts the quick preview from
   218–762 MB to 15–51 MB and makes it 2–3 times faster. The visible
   difference against today's quick preview is a mean ΔE 2000 of 0.2–0.5
   (95th percentile 0.8–1.8, at edges), below the just-noticeable level.
   **Steve's decision**, since it changes what the screen shows, although
   the change is too small to see.
5. **Very large pictures:**
   * JPEG and PNG over about 179 MP are refused today by Pillow's
     decompression-bomb guard (confirmed with a synthetic 192 MP file).
   * The 192 MP TIFF decodes at 2.9 GB.
   * The 297 MP line scan works only because the CPU route is allowed
     6 GB, 1.5 times the whole-app ceiling. On a machine with 8 or 16 GB
     of RAM it would fail or swap. The bounded routes in 7.3 are needed,
     not optional (F11, phase 3).
6. **A picture that can never fit the GPU route should not wait for it.**
   For the line scan, the GPU route answers "waiting for memory" because its
   samples (about 3.6 GB) exceed the GPU's largest buffer. It should go
   straight to the bounded route (new edge case M26).

**Estimates for the scheduler (approved by Steve, October 30).** Measured bytes
per pixel plus 25%, from header dimensions, with a 64 MB minimum per job:

| Job | Estimate (backend RAM) |
| --- | --- |
| Camera RAW sensor read | 7 bytes × pixels |
| JPEG, Radiance HDR | 23 bytes × pixels |
| PNG, TIFF, linear DNG | 28 bytes × pixels |
| EXR, PFM, AVIF | 38 bytes × pixels |
| HEIC, HEIF, JPEG XL | 52 bytes × pixels |
| CPU route, any type | 25 bytes × pixels |
| Quick preview, reduced decode | 64 MB (fast lane) |
| Quick preview, no reduced decode (PNG, or embedded non-JPEG) | 23 bytes × the preview's pixels |
| GPU memory per development | existing `rawBudget` formula (matches the measurements) |

Not measured in phase 0: the window's own memory per development (read-back
and upload copies). From the code it is about the hand-off size plus the
reduced outputs. Phase 3 adds a per-development log line for it.

## 7. Edge cases the design must handle

Listed up front so each one is built and tested with its phase, rather than
found later as a bug. "Phase" is where it is handled; "test" is the check
that proves it.

### 7.1 Files and folders

| # | Case | Handling | Phase | Test |
| --- | --- | --- | --- | --- |
| F1 | Hidden, system, temporary, `._`, dot- and tilde-named files | File gate (6.9) | 1 | Fixture folder holding one of each; only real photos listed |
| F2 | Trash, recycle, snapshot, NAS thumbnail and macOS metadata folders | Skipped whole (6.9) | 1 | Same fixture; NAS snapshot folders must not duplicate the library |
| F3 | Empty or tiny files | Skipped, counted as unreadable | 1 | Fixture |
| F4 | File still being copied (card import, sync) | Listed, decoded once stable | 1 | A file grown in steps during the test |
| F5 | Wrong extension (HEIC named `.jpg`, PNG named `.jpg`) | Header sniff decodes the real format | 1 | Fixtures |
| F6 | Not an image at all (HTML error page saved as `.jpg`) | "Not a valid photo" once; no retry until the file changes | 1 | Fixture |
| F7 | Truncated or corrupt file | Decoder error remembered once (exists) | 1 | Truncated JPEG, ARW and TIFF |
| F8 | Decoder crash or hang | The helper restarts. After one crash, that file is set aside with a message, not retried in a loop. Each type has a time limit. | 2 | A crafted crashing file and a hanging decoder stub |
| F9 | Online-only cloud placeholder | Not read by the grid or background work; "not downloaded" cell. Opening it downloads it, with progress; a failed or cancelled download is "offline", not a broken photo. | 1 | Placeholder attributes simulated in a unit test |
| F10 | Supported extension, unsupported variant: multi-page or layered TIFF, CMYK or Lab, palette or 1-bit PNG, animated PNG/AVIF/HEIC, bursts, HEIC depth images, JPEG XL-compressed or lossy DNG, Apple ProRAW, monochrome DNG, a RAW from a camera LibRaw doesn't know, multi-part or deep EXR | Decode what is supported (first page or frame); otherwise a clear "not supported: reason" message, with the embedded preview if there is one | 1 | One fixture per variant that we can make or obtain |
| F11 | Very large pictures (line scans, panoramas, 1 GB TIFFs) | Supported at any size (7.3): header dimensions before admission; runs alone through a bounded route | 3 | The 297 MP line-scan DNG and a large TIFF, on disposable copies |
| F12 | Paths: over 260 characters on Windows, Unicode (macOS NFD names), names differing only in case, network shares, symbolic links and junctions (no loops) | The walk handles each; never follows a link loop | 1 | Fixture tree including a junction loop |
| F13 | Folder without read permission | Shown once as not readable; the walk continues | 1 | Fixture with denied access |
| F14 | Drive unplugged or asleep mid-read (D: is a removable exFAT drive) | Jobs end as "offline", never as broken photos; folders dim | 2 | Simulated read error mid-job |
| F15 | File changed, moved or deleted during development | Identity check (exists): ends as "changed" and is redone | 2 | Existing tests, plus a scheduler case |
| F16 | Our own exports or saves inside a Library folder | Temporary name, renamed when complete | 1 | Audit plus a test that a half-written export is not listed |
| F17 | RAW+JPEG pairs and duplicate copies | Both listed (no stacking in v1); one development each | — | Note only |
| F18 | Sidecars (`.xmp`, `.hdrfinisher`, `.pp3`, `.dop`) | Never parsed as photos (not on the list) | 1 | Fixture |
| F19 | A file decoded in full and then rejected by the GPU route (JPEG XL, EXR or TIFF with unresolved colour; measured 250 MB–2.9 GB wasted) | Decide eligibility from the header before decoding; decode once, on the right route | 3 | The phase 0 JPEG XL, EXR and 192 MP TIFF samples |

### 7.2 Memory and scheduling

| # | Case | Handling | Phase | Test |
| --- | --- | --- | --- | --- |
| M1 | Size unknown before decoding | Header read first; otherwise estimated at the ceiling, so it runs alone, never as the floor, and only when free memory minus the reserve covers it (decision 10, to revisit) | 3a | Unit tests per type; an unreadable header gets the ceiling |
| M2 | Job bigger than the whole job budget | Runs alone, with nothing else admitted beside it. If even that cannot fit under the ceiling, a reduced decode. | 2 | Unit test |
| M3 | Big job starved by a stream of small ones | When a **now** job is waiting, lower classes stop being admitted until it fits | 2 | Unit test |
| M4 | Job holding RAM while it waits for the GPU (deadlock, priority inversion) | RAM and GPU granted together, all or nothing | 3 | Unit test with two jobs needing both |
| M5 | Leaked grants (window reload, crash, helper restart) | Each grant has an owner and a heartbeat; when the owner goes, the grant is released. After a backend restart, windows resubmit. | 2 | Kill a window mid-job; reload the page |
| M6 | Several windows (Library, Grade, hidden delivery window) | One scheduler for all of them. A minimised or hidden window's work drops to **eventually** (Chromium's hidden-tab practice). | 2–3 | Two-window test |
| M7 | Fast scrolling: hundreds of submits and cancels | Cancelling removes a job at once and costs nothing; only settled viewports submit (exists) | 2 | Scripted fast scroll; queue length logged |
| M8 | Selection changes mid-development | Priority changes in place; the work is kept | 3 | Unit test |
| M9 | Small machine (8 GB RAM, 2.5 GB ceiling) | At least one **now** job can always run; caches trim to make room; background work stops | 3 | Run with the ceiling forced to 2.5 GB |
| M10 | Other apps use the memory (operating-system pressure) | Trim at Chromium's levels; the job budget shrinks while pressure lasts | 1–2 | Simulated pressure |
| M11 | Memory measurement fails (a process can't be read) | Keep scheduling on estimates; log once | 2 | Unit test |
| M12 | Unified-memory graphics (Apple silicon, Intel/AMD integrated) | GPU estimates also count against RAM (darktable's `unifraction` practice) | 3 | Unit test with a unified adapter flag |
| M13 | GPU lost (driver reset, sleep, display change, Steve's faulty VRAM) | All GPU grants released, jobs requeued once, then the visible-only CPU fallback; GPU failures rerun before blaming code | 3 | Forced device loss in a driver |
| M14 | GPU out of memory | Caught through WebGPU error scopes; Library work freed; retried once | 3 | Forced allocation failure |
| M15 | Another app using VRAM (games, browsers) | Fixed headroom kept free (darktable practice); out-of-memory handling as M14 | 3 | — |
| M16 | Export or Proof running | Library background work pauses; visible work continues on a small allowance; export never waits on the Library | 3 | Export while scrolling |
| M17 | Grade and the Library want the same photo | No duplicate simultaneous development for the same source **at the same resolution**; different resolutions may proceed with Grade priority | 3 | Open a photo in Grade while its cell develops |
| M18 | Pasting a grade onto hundreds of photos | Redraw only; visible photos first, the rest **eventually**; no new development unless the source changed | 3 | Paste onto 200 photos in a disposable copy |
| M19 | Virtual copies | One development, separate draws | 3 | Existing virtual-copy fixture |
| M20 | HDR/SDR switch | Redraw from the same scene; no development | 5 | Toggle test |
| M21 | Disk cache full, or C: full | Storing fails once with a message; the cache stops filling; no retry loop | 2 | Allowance forced to a few MB |
| M22 | Cache folder on a drive that was removed | Run without a disk cache, with a message | 2 | Simulated missing folder |
| M23 | The grant channel drops, or the backend restarts | Windows reconnect and resubmit; waiting jobs time out instead of waiting forever | 2 | Kill and restart the channel mid-run |
| M24 | Startup upkeep on a large library (cache reconciliation measured 31 s, all upkeep 76 s on October 30) | Runs as **eventually** work through the scheduler; never blocks visible work | 2 | Startup with D:\Photos indexed (read-only) |
| M25 | Logging costs: backend.log is 358 MB and timing lines are frequent | Rotate logs; per-job lines stay, very frequent diagnostics are sampled | 5 | Log size after a ten-minute session |
| M26 | A picture that can never fit the GPU route (the line scan's samples exceed the GPU's largest buffer) | Goes straight to the bounded route instead of "waiting for memory" | 3 | The line-scan copy |
| M27 | A photo left open in Grade holds more than the whole budget (Steve, October 30: the 297 MP line scan kept the backend at about 3.7 GB, the app at 5.2 GB against the 4 GB ceiling, and every Library admission was refused: "0 active · 25 waiting" on a cold folder, forever) | The open Grade photo counts as one admitted **Grade** job with its estimate, not as measured memory that blocks everyone. Its rebuildable parts (levels, frames) trim first. The Library then still gets M9's floor: one ordinary **now** job at a time plus the fast lane, background work stopped. A large Library job (above the floor allowance) pauses with a message and a **Close photo in Grade** button; nothing ever starts beyond the computer's free memory minus the system reserve (Steve, October 31; 7.6 points 5–8). | 3a | Open the line-scan copy in Grade, then open a cold folder copy: visible cells keep arriving |

### 7.3 Very large pictures (Steve, October 30: support them)

The reference case is the line-scan DNG in `D:\Photos\HDR Test Images\Test
Suite Images\` (`line_scan_2018-…NECTA0000….dng`). It is 72,480 × 4,096
pixels, about 297 megapixels of 16-bit RGB: 1.78 GB of picture data. Read
from the header on October 30; LibRaw cannot open it.

How it works today (it works in the app):

* The app's own linear-DNG reader (`linear_dng.py`) **memory-maps** the
  file (`tifffile.memmap`). Windows pages pixel data in from disk as it is
  read, so the whole 1.78 GB is not loaded into the app's own memory at once.
* It is not an ordinary camera RAW, so its Library development has used the
  backend preparation route: decode, colour, analysis, then reduction to the
  stored sizes. That took about 25 s on October 22.
* From the October 30 logs: first grid thumbnail 12.3 s cold; afterwards
  the stored thumbnail shows in 0.37–0.70 s.

What the design keeps and adds:

1. **No size limit.** A very large picture is admitted alone: nothing else
   large runs beside it, and the fast lane keeps serving small jobs.
2. **Bounded routes by format,** so memory follows the strip or tile size,
   not the picture size:
   * memory-mapped or strip reading for DNG and TIFF;
   * tiled GPU correction for DNG (exists);
   * row-by-row reduction straight to 640 and 2560.

   Phase 0 measures the real peak for the line scan and a large TIFF, and
   names any step that still holds a full-size copy. Those steps become
   phase 3 work.
3. **Pillow's built-in size guard.** Pillow refuses images above about
   179 megapixels (its "decompression bomb" guard), and the app does not
   change that setting today. So a very large JPEG, PNG or TIFF that goes
   through Pillow is probably refused now, while the DNG works. Phase 0
   checks this. Phase 3 gives those formats a bounded route, or explicitly
   allows large sizes where the route is bounded.
4. **Grid cost.** A very large picture's 640 thumbnail is made once and
   stored. A wide line scan gets a very thin thumbnail at grid size. Its
   cell shows it fitted like any other photo.
5. **Single and Grade** use 2560 and the existing native-detail rules.
   Export is unchanged.

**Revised direction (Steve, October 31).** These points replace points 1–3
where they differ.

* **A memory setting, like DaVinci Resolve.** Settings gain "Memory the app
  may use".
  * Default: today's rule (the smaller of 4 GB or a quarter of RAM, never
    below 2.5 GB). Steve, October 31: keep it; users with big files raise
    the setting themselves.
  * The user can raise it up to the computer's RAM minus the system reserve
    (the larger of 2 GB or 10%), or lower it to 2.5 GB.
  * Everything follows the chosen value: the ceiling, the target, the scaled
    cache shares, admission, and the picture size check below.
  * Today the ceiling never goes above 4 GB, even on a 128 GB machine. The
    setting is how a user with plenty of RAM gives the app more.
* **100 MP beside other work: measured; proposed rates awaiting Steve.**
+  Steve corrected the phase 3c acceptance item. At the approved
  estimates, a 100 MP RAW needs about 0.7 GB and fits beside other work. A
  100 MP JPEG (about 2.3 GB) or TIFF, PNG or linear DNG (about 2.8 GB) does
  not, so today each would run alone, one at a time.
  * Proposed fix, **shrink while reading** for Library pictures:
    * JPEG is decoded at reduced scale, as quick previews already are;
    * TIFF, PNG and linear DNG are read in strips and reduced as they are
      read;
    * the normal pipeline then runs on the reduced picture.
  * This avoids rewriting each full-size step (the 3b finding).
  * The coding agent confirms it can be done and measures it. Library
    pictures must stay within the perceptual tolerance of today's.
* **Giant pictures (line scans, huge panoramas) work whenever the user's
  limit allows.**
  * Such a picture runs alone, as in point 1.
  * If it needs more than the limit, its cell says how much memory it needs
    and where to raise the limit. It never waits forever.
  * If shrink while reading works for its type, it may fit the default
    anyway.
* **Pillow's size guard** (about 179 MP) is never disabled globally. A larger
  picture is let through for that one decode when the app's own estimate
  fits the user's limit and the computer's free memory.

### 7.4 Phase 1 as built (October 30)

* `codebase/backend/hdr_finisher/file_gate.py` holds the supported list and
  every rule. The security module, folder scan, index walk, folder tree,
  folder stream, add-folder browser, camera details, the picture checks and
  Needs attention all use it.
* Windows file details come from the folder listing itself, so the hidden,
  system and size checks add no extra disk reads.
* At picture time (`source_gate` in `library_api.py`), before any decoding:
  * a cloud placeholder is read only for the opened photo (priority 0, the
    detail view, or the selected photo's camera details); any other request
    gets "Not downloaded", which is not remembered as a failure, and the
    grid shows a **Not downloaded** cell;
  * a file modified in the last 2 seconds waits;
  * the first 32 bytes must be a supported image, or the file is remembered
    once as "Not a valid photo".
* F5 as built: a non-RAW file whose contents are a different supported
  format than its extension is decoded by its contents (`decode_suffix`,
  used by Grade's loader and the Library's GPU source decode).
  * The real case: iPhone edited copies (`IMG_E….HEIC`) that are JPEGs.
    That is 13 of a 3,000-photo sample of D:\Photos, so probably a few
    hundred files in all. Before, these failed in both Grade and the Library
    with "No 'ftyp' box".
  * The five checked were also damaged: each JPEG ends early, and the bottom
    10–40% of the picture is missing (grey) in the file itself. They now
    report "image file is truncated" instead of a misleading HEIC error.
    Complete files of this kind open.
  * Camera RAW and DNG files keep their own route.
* F3 as built: files under 1 KB are skipped silently when listing, not
  counted.
* F16: export staging files are named `.<name>.<random>.sdr.tmp.jpg`. The
  leading-dot rule hides them, so a half-written export is never listed. It
  could be listed before phase 1.
* F10: CMYK and greyscale JPEG, and palette, 1-bit, transparent, 16-bit and
  animated PNG all open (tested). Multi-page and CMYK TIFF without a colour
  profile go to the CPU route (F19, phase 3). HEIC depth images, ProRAW and
  JPEG XL-compressed DNG were not tested (no samples).
* F12: symbolic links and junctions are never followed (junction loops
  tested). Unicode and decomposed names are tested. Paths over 260
  characters are not specially handled; they fail as unreadable and the walk
  continues.
* F13: unreadable folders keep their existing handling (shown, walk
  continues). There is no automated test, because denying access in a test
  folder is not portable.
* Tests: `codebase/tests/test_file_gate.py`. Other tests write small
  stand-in photos and use them at once, so `tests/conftest.py` turns off the
  1 KB minimum and the 2-second wait for them. The gate tests, the
  `._`-file tests and the add-folder peek test check the real values. Tests
  whose scans run in the helper process use stand-ins over 1 KB.
* Read-only check of D:\Photos (October 30). It took 44 s from folder
  listings alone, with no file opens, plus 3,000 sampled opens:
  * 142,570 photo-type files; 140,302 still listed;
  * hidden: 2,267 macOS `._` files, one file under 1 KB (an Aperture face
    thumbnail), and 13 hidden Lightroom `.lrdata`/`.lrcat-data` folders
    (Lightroom's own previews);
  * no real photo was hidden by the `.`/`~` name rules;
  * the content sample found no non-images and 13 JPEG-in-HEIC files (F5).
* Photo-app library packages such as `Aperture Library.aplibrary` keep
  being listed, internal previews included (Steve, October 30), because some
  apps keep originals inside the package.

### 7.5 Phase 2 whiteboard: stop the feedback loop (October 30)

**Today, exactly.**

1. A job asks `app_memory.admit` for room (600 MB today). If measured total
   + reservations + request is over the ceiling, it is refused, and
   `_waiting_until` is set 2 s ahead.
2. For those 2 s, `snapshot()` reports `budgetPressure` and `reclaim`, even
   when measured memory is far below the target.
3. The Electron main process reads `snapshot()` every 500 ms. While
   `budgetPressure` is set it marks **every tick** as a reclaim:
   * sends every window the pressure value; the Library halves both picture
     caches (`library-ram.js` `apply`) and clears its recent pictures and
     host copies (`photo-library.js`);
   * sends Chromium a **critical** pressure signal (`memory-pressure.cjs`);
   * asks the backend to reclaim (cache shares halved, helper told too).
4. The window retries refused quick previews every 250 ms, so a stream of
   refusals keeps the flag up permanently: four critical clean-ups a second,
   finished thumbnails thrown away and made again.
5. Separately, a refused `admit` empties the `working` share (Grade levels,
   the Library's native buffer). That is a targeted make-room step for the
   job, not a pressure signal; phase 2 leaves it alone.

**What changes.**

1. A refusal is only a refusal. `snapshot()` reports pressure only from
   measurement and the operating system:
   * **moderate**: measured total above the target (ceiling minus working
     room), including above the ceiling, or operating-system moderate
     pressure. Caches halve; while it lasts they halve again each cool-down,
     which is the "trim harder" of 6.2;
   * **critical**: operating-system critical pressure only. Everything
     rebuildable is dropped. Measured memory over our own ceiling is not
     critical: pictures dropped then could not be made again (admissions are
     refused), so the grid would go blank.

   The 2-second waiting note stays in the snapshot for logs only.
2. One rule in the main process (`memory-pressure.cjs` `pressureGate`)
   decides when to trim: at once when the level rises (none → moderate →
   critical); otherwise at most once per 10 s cool-down while it lasts, as
   Chromium's own monitor does. A sustained overrun therefore still reclaims,
   every 10 s instead of every 500 ms. Falling back to none does nothing.
3. Only that decision trims anything: the windows' caches, Chromium's signal
   (at the same level, never "critical" for a refusal) and the backend
   reclaim. Each trim is logged as `memory_trim` with its level and measured
   total.

No size, share, ceiling or the 600 MB reservation changes.

**The open-Grade stall (M27).** Phase 2 does not unblock it. The app really
is over the ceiling there (5.2 GB measured), so phase 2 correctly reports
moderate pressure: caches halve on entry and then once every 10 s, instead of
a critical clean-up four times a second. What blocks the Library is the admission rule itself ("measured
total + reservations + 600 MB under the ceiling"), which can never pass while
the Grade photo holds 3.7 GB and nothing may release it. That rule is
replaced in phase 3 (admission by estimates, M9 and M27). Until then,
opening a small photo in Grade should release the large one, since Grade
keeps only its current photo (`SessionStore.activate_session`); not yet
tested.

Steve's try (October 31) confirmed it: 5.15 GB measured, one moderate trim
every 10 s, nothing admitted. It also showed a second effect: the 30 waiting
cells polled about 37 times a second, filling the window's connections, so
folder-tree clicks waited behind them (the backend answered in about 1 ms).
Phase 3's waiting line without polling (6.6) has to land with the M27 fix.

**Tolerance for the scripted run** (from section 8): no pressure signal and
no trim while measured memory stays under the target; when over it, at most
one trim per level change plus one per 10 s; peak whole-app memory under the
ceiling; zero false failures; grid screens no slower than the October 30
baseline (28.7 s / 56.5 s) plus 10%.

**As built and measured (October 30, 23:05).** `app_memory.pressure_level`
(backend), `pressureGate` in `desktop/memory-pressure.cjs` (10 s cool-down,
used by the `main.js` memory timer), `library-ram.js` `apply` trims only when
told. Tests: `test_app_memory.py` (a refusal is not pressure; level from
measurement and OS only), `desktop-memory-pressure.test.js` (once per rise,
sustained overrun every 10 s, no trim on flapping), `library-ram.test.js`.
Scripted cold run, 48 Aceh Pesta copies:

| Measure | Result | Tolerance |
| --- | --- | --- |
| Pressure signals / trims | 1 / 1, moderate, when measured memory reached 3.50 GB (target 3.40). None from the refusals active in 6 of 11 logged samples. | Met |
| Peak whole-app memory | 3.28 GB (independent observer), 3.50 GB (app's own sample) | Met |
| Grid screens | 24.1 s / 46.9 s (baseline 28.7 / 56.5 s) | Met |
| False failures | 0; every cell drew | Met |
| Quick preview request → on screen | p50 0.93 s, p95 9.1 s, max 17.9 s | Not met against section 8's 0.5 s p95; expected, the 600 MB reservation is phase 3 |

### 7.6 Phase 3 whiteboard: one scheduler for RAM (October 31, for Steve's review)

**Today, exactly.** Five places ask for memory, each on its own:

| Who asks | Where | Asks for | When refused |
| --- | --- | --- | --- |
| Quick preview (embedded camera JPEG, small original preview) | backend `library_api.py` `quick_preview` | 600 MB | Answers HTTP 202; the window asks again every 150 ms (`photo-library.js`) |
| Window development (every grid photo being developed) | window `library-scenes.js` `sources` `admit`, through `/memory-admission` | 600 MB, renewed every 10 s | The window's queue asks again every 100 ms (`library-scene-scheduler.js`) |
| RAW sensor read | backend `library_raw.py` | 600 MB | Its thread waits and asks again |
| Source preparation (`live-source`) | backend `library_api.py` | refused when the bounded GPU route can't take it yet (`MemoryPending`) | HTTP 202; the window asks again every 150 ms (`library-scenes.js`) |
| Helper process caches | `library_worker.py` remote claims | cache shares | Cache evicts its oldest |

The rule for the 600 MB askers: **measured total + every reservation +
600 MB ≤ 4 GB**. A running job is counted twice (measured and reserved).

**Grade never asks.** Opening a photo in Grade checks only against the
computer's physical memory (`resource_preflight.py`), not the app's 4 GB
ceiling. The open photo is held until another photo replaces it. For the
line scan that is 3.75 GB in the backend (7.3 GB at peak while viewing at
100%), so the app sits at 5.15 GB. Every Library ask is then refused, forever.

**What that produced on October 31.** 30 waiting cells and the retry loops
above sent about 37 requests a second. The window has only a few
connections to the backend, so a folder click waited behind them, although
the backend answered folder requests in about 1 ms.

**October 31 implementation — phase 3a connected, performance qualification open.**
The backend estimate queue now owns Library source, CPU, sensor, quick-preview
and RAW-reader admission. Each window has one authenticated `/api/library/grants`
WebSocket; asks are sent once, with heartbeat/owner expiry, cancellation,
promotion and reconnect. Backend-owned requests wait in process. Source
preparation reuses its grant. Fixed Library memory admission and memory-202
retries have been removed; non-memory preparation/copy and GPU broker waits
remain as before. `MemoryPending` from a route needing phase 3b remains waiting
until cancellation, without repeated decode attempts.

Grade retained source allocations are counted once by unique NumPy backing
allocation. They reduce Library room and are excluded from the app-target
trim comparison, while physical pressure still trims everything. The Library
pause rows and Close photo in Grade action are connected. Closing requires
edit drain and a successful save before session deletion. JPEG quick previews
use reduced DCT decoding; finished source/Grade/export/Proof paths are unchanged.

Logs record asks, grants, finishes, class, estimate, wait reason and peak.
`measured_peak` is a sampled whole-app increase from the grant baseline,
not an isolated per-job peak; overlapping jobs/caches affect it and very short
jobs may lack a useful sample. Unavailable sampling logs once and estimates
continue. Unknown-size logs retain reason **unknown size** separately from
what made them wait. All agreed budgets, cache shares and phase 2 trim cooldown
are unchanged. Phase 3b and phase 4 are still open.

**As built and measured, October 31 (phase 3a integration commit).** Code is
built; acceptance remains open for Steve's try because the speed targets below
are not met. Scratch profiles, read-only originals, one existing line-scan
copy; 2560 × 1440 Electron. No Grade-close-specific GPU driver existed; the
focused real-app run exercised that action instead. The frozen backend was
built separately and accepted an authenticated grant WebSocket.

| Agreed check | Result |
| --- | --- |
| Quick preview request → screen p95 <0.5 s | **Not met:** p50 1.496 s / p95 2.394 s / max 2.560 s, 48 JPEG previews |
| Thirty waiting jobs: one ask each plus heartbeat | Behavioral channel checks; real Aceh: 96 asks for 96 jobs, zero duplicates, 16 heartbeats (~1.2 asks/s). All HTTP including unchanged GPU/cache/telemetry work averaged 16.9/s; RAM retry requests: zero |
| Folder click while waiting <0.5 s | 1 ms to the already listed folder; opening a different uncached folder while paused is not separately qualified |
| Grade line scan: first ordinary photo <5 s | 3.288 s; visible work progressed with Grade retaining 3,562,536,960 bytes |
| Large cell paused within 1 s of being shown | **Not qualified:** observed 2.876 s from folder opening; cell-visible time was not captured separately |
| Close saves first; resume <2 s after close | Exposure 0.125 read back from the settings file; close including save 2.142 s; grants resumed 0.165 s after Grade emptied |
| Forced physical reserve: waits, then starts, no failure | Passing behavior tests; unknown headers also use the ceiling, run alone and never use the floor |
| Peak under ceiling, no oversized Grade/job | 3.746 GB against 4 GB (independent whole-app observer) |
| Cold Aceh screens ≤26.51 / 51.59 s | **Not met:** 39.9 / 83.9 s (elapsed from folder opening); first run with backend checks competing was slower and is not used as the final timing |
| Reduced quick preview mean ΔE2000 <1 | 0.331–0.485 across three JPEGs, compared with the prior quick route |
| No Grade-only target trims | No trims during the measured Grade-browsing interval; two legitimate trims during initial source loading. Unit checks also cover Grade exclusion and OS pressure |
| Pressure feedback remains controlled | Aceh: one moderate Chromium signal/trim at 3.409 GB against 3.4 GB target; zero refusal-induced trims |
| False failures zero | Aceh: zero. Mixed phase0: **not met**, existing X-Trans CPU-route refusal and unresolved-colour JPEG XL route refusal (two unique photos, ten repeated work-failed events); memory waits themselves were not failures |

The cold run also failed its memory-endpoint responsiveness check: two 2.5 s
timeouts out of 139 samples. No further timing sweep was run. These speed and
route limitations remain open; the implementation must not be described as a
qualified stall fix. Whole-app peak attribution has the limitation above.
Evidence is in `codebase/output/cold-mixed/aceh/`, `output/phase3a-grade/`,
`output/phase3a-quick-colour.json` and `output/phase3a-package-smoke.log`.

Fast checks: JavaScript 681 passed / 3 known failures; the final 30-cell channel
case was added and passes separately. Full Python
2,835 passed / 3 skipped / 4 known failures; final targeted queue/header/channel
set 41 passed. Known failures: preset-header contract, RGB publication fixture,
frame-cache fixture and Retouch capture-cache fixture; JavaScript's two
scene-version harness cases and Single screen-preview harness case. No limits
or tolerances were relaxed. The two scene-order expectations now follow
backend FIFO grant order instead of the replaced cost-biased admission.

**What changes (implemented for 3a).**

1. **One decision maker.** A new backend module, `library_scheduler.py`,
   owns every Library grant: who asked (owner), class (Grade, now, soon,
   eventually), estimate, and when it was granted. Higher classes first;
   first come, first served within a class. `app_memory` keeps measurement,
   cache shares and pressure (phase 2).
2. **Estimates, not measurements, decide.** The room for jobs is:

   > ceiling − starting memory (1.3 GB) − cache bytes in use (at most their
   > shares) − the open Grade photo (its exact size)

   A job is admitted if its estimate fits in that room beside the estimates
   already running. Nothing is counted twice. Estimates are the approved
   bytes per pixel (6.11) times the pixel count read from the file header
   (M1), with the 64 MB minimum. If the header can't be read, the job is
   estimated at the full Library budget, the ceiling (decision 10, to
   revisit). When a job ends, its sampled incremental whole-app peak is logged beside
   its estimate, subject to the attribution limitation above.
3. **The open Grade photo is a grant of its own** (M27). When Grade opens a
   photo, the scheduler records its exact size (the pixels Grade keeps). It is
   never refused by the Library, since Grade comes first, but the Library now
   knows about it instead of tripping over it.
4. **A fast lane** for jobs estimated at 64 MB or less (embedded camera
   JPEGs, and with reduced decoding nearly every JPEG quick preview): a
   separate allowance of 64 MB, up to four at once, so they never wait
   behind a development (6.4; Steve, October 31, decisions 3 and 4). A
   quick preview estimated above 64 MB joins the normal queue as a **now**
   job with its real estimate.
5. **A floor for what is on screen** (M9, M27; Steve, October 31: keep a
   floor). If the room is too small for any **now** job (a small machine, or
   a large photo open in Grade), one **now** job at a time still runs, plus
   the fast lane, even if that takes the app over its 4 GB budget. **soon**
   and **eventually** work stops. The floor is for ordinary photos: only a
   job whose estimate is within the **floor allowance** (1 GB, Steve,
   October 31; decision 8) runs this way.
6. **The Library pauses for a large photo in Grade** (Steve, October 31).
   Example: a folder of line scans, with one open in Grade. Each line scan
   needs about 6 GB in the Library (measured, 6.11), so the floor can't take
   it. Grade stays fully usable; the Library pauses instead of piling more on
   top:
   * **Rule:** while the open Grade photo leaves no room for a job, a
     **now** job bigger than the floor allowance does not start. It steps
     aside rather than blocking the line, so smaller visible photos and the
     fast lane carry on.
   * **Status bar:** "Library paused: memory is in use by
     line_scan_….dng in Grade".
   * **Each waiting row in Activity:** "Waiting: memory in use by the photo
     open in Grade".
   * **Activity heading, with one button:** "This photo needs the app's
     memory while it is open in Grade. Close it in Grade to resume Library
     browsing." The button, **Close photo in Grade**, saves the grade first
     (autosave), then closes the photo, and Grade shows no photo. The backend
     already has the close step (`DELETE /api/session/current`); no Grade
     control uses it today. The Library resumes by itself when the photo's
     grant is released.
   * Nothing is marked as failed, and the message goes away as soon as the
     photo leaves Grade, however it leaves (closed, another photo opened, or
     app restart).
7. **Over the app budget is allowed; over the computer's free memory is
   not** (Steve, October 31). A job bigger than the whole room runs alone
   (M2): nothing large starts beside it, and it may take the app over 4 GB.
   But no Library job starts if its estimate is more than the computer's
   free physical memory minus a **system reserve** left for Windows and
   other apps (the larger of 2 GB or 10% of RAM, Steve, October 31;
   decision 9):
   * Such a job waits with "Waiting: not enough free memory on this computer
     (needs 6.0 GB, 4.1 GB free)". It is not a failure.
   * The backend re-checks free memory when grants are released and every
     few seconds while anything is blocked this way, then grants it. The
     window never polls.
   * The same check covers the floor and the paused-for-Grade cases, so even
     the floor can't push the computer into swapping.
   * On Steve's 68 GB machine this almost never binds; on an 8 GB machine
     it is what keeps the app from taking the computer down with it.
8. **The open Grade photo doesn't set off repeated trims.** Phase 2 trims
   caches every 10 s while measured memory is over the target. With a large
   photo in Grade that would halve Grade's own caches over and over and make
   Grade slower. The safety net therefore compares memory without the Grade
   photo's grant against the target. Operating-system pressure still trims
   everything.
9. **No starvation** (M3): while a **now** job waits, lower classes are not
   admitted. A job that stepped aside (point 6) or is blocked by the system
   reserve (point 7) does not hold up the jobs behind it.
10. **The phase 2 safety net stays.** Measured total above the target: stop
    admitting **soon** and **eventually**. Above the ceiling: only Grade,
    the fast lane and the floor.
11. **Waiting in line without asking again** (6.6). Each window opens one
   WebSocket to the backend (`/api/library/grants`; the backend already has
   the WebSocket library). The window sends "ask", "cancel" and "change
   priority"; the backend answers "granted" once, when it is that job's turn.
   * While waiting, nothing polls and no HTTP connection is held, so folder
     clicks never queue behind waiting photos.
   * A quick preview or a development carries its grant to the backend. The
     backend's own users (RAW sensor read) wait in-process without HTTP.
   * Each window sends a heartbeat every 5 s. If a window closes, reloads or
     crashes, its grants are released (M5). If the channel drops, the window
     reconnects and asks again; nobody waits forever (M23).
   * The memory-related HTTP 202 retry loops and `/memory-admission` are
     removed.
12. **Logging.** One line per job: asked, granted, finished, with class,
    estimate and measured peak, and the wait time; and why a job waited
    (room, paused for Grade, system reserve).

**Proposed split: phase 3a, then 3b.** Phase 3 as listed in section 8 is
large. Building it in two steps lets Steve try the stall fix sooner, and each
step can be undone alone.

* **3a. Scheduler and channel:** points 1–12 above, including the paused
  message and the **Close photo in Grade** button, and reduced-decode quick
  previews (decision 3; check: mean ΔE 2000 against today's quick preview
  below 1, as measured in phase 0). Edge cases M1–M3, M5,
  M7, M9, M10, M11, M23, M27; F15 (a changed file ends its job as "changed"
  and releases its grant). Removes the stall and the polling.
* **3b. Bounded routes and the rest:** very large pictures (F11, F19, M26,
  7.3), decoder crash
  and hang limits (F8), offline drives (F14), disk cache full or missing
  (M21, M22), startup upkeep as **eventually** work (M24), hidden windows
  (M6).

**What could break (3a).**

* Estimates that are too low could take the app briefly over the ceiling.
  The phase 2 safety net and the per-job log catch it.
* The WebSocket is new plumbing between every window and the backend. If it
  fails, Library pictures stop until it reconnects. Reconnection and a
  timeout are part of 3a, and the packaged build must include the WebSocket
  library (it comes with `uvicorn[standard]`; checked in the trial packaged
  build, not assumed).
* Grade, export and the hidden delivery window keep their current GPU
  leases until phase 4, so their GPU behaviour does not change in 3a.
* **Close photo in Grade** is the first control that closes Grade's photo.
  If it closed before the autosave finished, the last edits could be lost.
  It waits for the save to finish, and a failed save keeps the photo open
  with the save error shown. Tested with a disposable copy, never the
  read-only test projects.
* Going over the 4 GB budget is now allowed for the floor and for one large
  job at a time. The system reserve is the hard stop. If the estimates for a
  type are too low, a job could still eat into the reserve; the per-job log
  shows it and that type's estimate is raised.

**Tolerances for 3a (proposed, to agree before building).**

| Measure | Tolerance |
| --- | --- |
| Embedded preview, request to on screen, while photos develop | p95 under 0.5 s (section 8) |
| Requests from a window while 30 cells wait | No repeated asks: at most one per job, plus the 5 s heartbeat |
| Folder click to rows usable, while cells wait | Under 0.5 s (existing target) |
| Line scan open in Grade, then a cold folder of ordinary photos | Visible cells keep arriving: the first within 5 s, none stuck; Grade's caches not trimmed by the safety net |
| Line scan open in Grade, then a folder holding line-scan copies | Their cells wait with the "paused for Grade" message, within 1 s of being shown; ordinary cells beside them still arrive; Grade stays responsive |
| **Close photo in Grade** | Grade's edits saved first; Library work resumes within 2 s of the photo closing |
| A job bigger than free memory minus the reserve (forced in a test) | Waits with the "not enough free memory" message; never starts; never marked failed |
| Peak whole-app memory, without an oversized Grade photo or job | Under the ceiling |
| Cold Aceh grid screens | No slower than phase 2's 24.1 s / 46.9 s plus 10% |
| False failures | Zero |

Checks: fast checks; unit tests for each edge case above; the Aceh cold run;
one run with the line-scan copy
(`codebase\output\test-photos\phase0\line_scan_…dng`) open in Grade
while a cold folder copy opens.

**Phase 3a.1 as built and measured, October 31.** Admission now permits at
most two source/CPU developments across windows. Queued work starts in viewport
order within class; quick jobs precede new development work. Cancel immediately
releases its place. The frontend source queue retains FIFO within class; other
queues retain their existing ordering. The cause was confirmed: source grants
were issued before the local queue and exclusive GPU lease, allowing 22 decoded
sources to compete. Budgets, estimates, Grade wording and GPU lease are unchanged.

Corrected isolated Aceh run: 35.429 / 94.662 s (limits 26.51 / 51.59 s), all
48 cells presented, peak 3.601 GB <4 GB, zero duplicate asks. Two memory-endpoint
samples timed out; qualification fails. Prepared pixels still retain their grant
while awaiting the exclusive GPU lease: the requested no-grant GPU wait is NOT
implemented or claimed. A safe transfer of ownership belongs with phase 4;
releasing a grant while keeping decoded pixels would undercount real memory.
The final run records one second-screen-labelled source starting before the
last first-screen finish and before explicit scrolling. The app includes 30
partly visible cells in its visible class; the harness counts 24 fully visible
cells. Filename FIFO passes, but strict 24-cell first-screen ordering is not
qualified. No rerun for noise: the timing miss is substantial.

Grade coexistence: first ordinary picture 2.926 s (<5), paused line scan observed
1.995 s from folder opening (cell-visible latency unmeasured), close/save 1.872 s,
resume 0.150 s (<2), saved exposure verified, zero page errors, protected project
hashes unchanged. The pause message and Close photo in Grade action work.
No independent memory observer ran here: backend logs reached 9.124 GB during
oversized Grade opening, with three moderate trims/Chromium pressure relays
before browsing; one coexistence snapshot was 5.370 GB. This is not a <4 GB pass.

Checks: scheduler/grant Python checks 22 passed. Final full Python: 2,842
passed, three skipped, four existing fixture failures (preset-header, RGB
publication, frame-cache and Retouch capture-cache). The earlier unrelated
helper-restart timeout did not recur. Full JavaScript: 683 passed, three
existing failures (two source-test version stubs and Single screen-preview
stub). No new failures. The quick-first and FIFO expectations were updated
because those behaviours changed deliberately; no tolerance was relaxed.
Development grants: maximum two, time-weighted mean 1.831. Quick previews:
p50 1.390 s / p95 2.130 s / max 2.439 s (p95 limit <0.5 s missed). Two moderate
trims and Chromium pressure relays at 3.469 / 3.420 GB, above the existing
3.40 GB target; no memory-refusal signals.
Invalid exploratory runs (overlapped apps and an accidental draw-lane change)
were excluded; the draw queues are restored to one lane.

### Phase 3a.2 as built and measured (October 31)

The four findings were confirmed. Development places included disk saving;
transient spill/packing held the shared picture lock; admission could ignore
native whole-app growth; and offscreen quick previews received foreground
precedence. The changes below preserve the approved estimates, shares, fast
lane, floor, reserve and Grade messages.

* GPU completion releases the preparation place after the exclusive lease ends.
  The memory grant survives through saving. **Two saves at once** is Steve's
  decision (October 31; decision 14 records it as a possible bottleneck to
  retest later); a third waits, and new developments
  stop entering while both saving places are occupied. This bounds retained
  decoded results without hiding their memory.
* Transient state is captured briefly under the picture lock; packing, spilling,
  index/default-document work and memory reporting run outside it. Pending
  ownership and packed bytes publish atomically. A blocked-spill concurrency
  test proves unrelated open/store/default-document/memory calls finish while
  the spill remains blocked. Delivered disposable bytes are dropped first.
  Chromium's moderate relay now collects page garbage instead of requesting
  a global native purge; critical pressure retains that purge. The level gate,
  ten-second cooldown, cache halving and critical zeroing are unchanged.
* Admission requires measured total + estimates for grants begun since that
  census + the new estimate to fit. Grants already covered by the census are
  not counted twice. Approved fast/floor/oversized-alone exceptions remain.
  Scheduler samples refresh every half second; telemetry reads the last completed
  census without waiting on another process walk. Logs identify measured-memory
  waits, saving and alone/floor exceptions.
* Only visible quick previews precede visible developments. Offscreen quick
  previews retain their normal class. RGB direct scenes now compare the same
  render identity, reuse already uploaded variants, and keep retained textures
  in the existing sharp share; pixel payloads are saved once inside the grant.

Two quiet cold Aceh repeats, isolated profiles, 2560×1440, all 48 photos finished:

| Measure | aceh-3a2-6 | aceh-3a2-7 |
| --- | --- | --- |
| First / second screen from folder click | 29.442 / 56.064 s | 32.111 / 57.203 s |
| Development maximum / time-weighted mean | 2 / 1.430 | 2 / 1.413 |
| Saving maximum | 2 | 2 |
| Independent whole-app peak | 3.598 GB | 3.712 GB |
| Memory requests / timeouts / longest | 112 / 0 / 110.5 ms | 121 / 0 / 339.7 ms |
| All-preview request latency p50 / p95 | 1.551 / 2.783 s | 1.507 / 2.410 s |
| Visible previews, including partial cells | 30/30 by 5.008 s | 30/30 by 5.884 s |
| Longest Library request spanning trim or starting within 1 s after | 0.822 s | 1.066 s |

Each run had one real moderate trim. Run 7 also contains the final cached-only
telemetry refinement. Source reports/logs/screens are in
`codebase/output/cold-mixed/aceh-3a2-{6,7}/`. These results remove the long
freeze and improve throughput, but **do not qualify** the 26.51 / 51.59 s screen
limits, formal preview p95 <0.5 s, or strict <1 s trim-request limit in run 7.
Protected projects were unchanged; no photo failures or duplicate asks occurred.

Mixed phase0 stopped at **4.022 GB**, with ten of 27 finished thumbnails and no
memory endpoint timeouts (226 requests). Five logged wait-reason transitions
were measured-memory waits. AVIF was admitted at 2.271 GB measured + 1.603 GB
estimate = 3.874 GB, which fits; the decoder subsequently charged 1.765 GB.
The overrun was not an oversized-alone exception. The measured gate works,
but approved estimates do not guarantee this route's peak. No estimate was
raised to conceal it. Bounded large-picture routes remain unfinished.
Per-file timings/statuses, including unfinished files at stop, are in
`codebase/output/cold-mixed/phase0-3a2/per-file-results.csv`; no uncompleted file
is relabelled as a decode failure.

Grade retained 3.563 GB. The first ordinary photo took 1.978 s; pause was
observed 1.573 s from folder opening (cell-visible interval unmeasured); folder
click 23 ms; close including saved exposure 0.125 took 1.926 s and Library
resumed 0.696 s later. The harness's older <1 s folder-to-pause assertion fails;
its save/resume assertions pass. This run does not qualify whole-app memory.
See `codebase/output/phase3a-grade/report.json`.

Native memory: the detailed Chromium dump in
`codebase/output/cold-mixed/aceh-3a2-4/memory-trace.json` identifies 1.099 GB of
GPU transfer memory, with 0.810 GB mapped into the main page (mostly the same
shared pages, **do not add them**), 94 MB of GPU shared images and 390 MB of
browser blob storage. Page JS used 11.6 MB; backing storage was 211 MB.
The previously unexplained Browser/GPU total is mainly native transfer/readback
pools and browser upload blobs, rather than two hidden JavaScript scene caches.
The sharp texture owner reports 445.747 MB, within its existing 512 MB share,
and halves that on moderate pressure. No cache share or total is increased.
Comparative runs implicate Chromium's global native purge in the long stalls;
this is an inference from timing, not an OS-stack attribution.

Validation: full Python 2,861 passed / 3 skipped / four known failures
(preset header, RGB publication guard, frame-cache budget, Retouch capture-cache).
Final focused memory/scheduler/grants/trim checks: 52 passed. Full Node: 690
passed / three known failures (two scene version stubs, Single preview stub).
One focused RAW GPU driver passed on DSC07060.ARW: 3.004 s app / 1.164 s GPU;
SDR mean/p99.9 ΔE2000 0.0182/0.0590, HDR 0.0266/0.0769, within existing limits.
No pixel math changed. Driver reuse of permanent copies and stop-time per-file
reporting are separate from production behavior. Steve should try the two
screens, mixed folder and Grade coexistence before further speed tuning.

### 7.7 Phase 3b whiteboard (October 31)

Steve authorised 3a.1 followed immediately by 3b during this run, without
waiting for acceptance between them. No approved budget or estimate changes.

| Item | Today | Change to build | Acceptance / undecided numbers |
| --- | --- | --- | --- |
| 1. Large pictures / header routing | RGB codecs can decode before colour refusal; a DNG larger than a GPU buffer waits indefinitely; Pillow rejects very large images. | Inspect eligibility before pixels; provide strip/mapped reduction only where the decoder and colour pipeline support it. Do not silently replace finished pictures with a different rendering. Unsupported routes must finish once with a reason and retain an embedded preview. | Line scan ≤27 s, report incremental peak, aim ≤1 GB. Large TIFF and >179 MP synthetic JPEG/PNG must finish. Ordinary mean ΔE2000 <1. Bounded-route estimates remain **proposed, awaiting Steve**, only after measurements; keep approved rates meanwhile. |
| 2. Decoder recovery | Shared helper restarts and replays pending requests, including the culprit; no per-file deadline. | Track active requests and deadlines; isolate a known culprit once. A shared-process crash with multiple active files cannot safely identify its cause: do not mark innocent photos broken. | Crafted crash and hanging stub. Proposed, awaiting Steve: five times each phase-0 measured maximum, rounded up, at least five seconds. The final per-type proposal is in section 10, decision 12; use it in the helper meantime as authorised. |
| 3. Offline source | Missing pins already dim, but an I/O failure during decoding can be remembered as a broken photo. | Preserve OS error identity across helper transport; treat disconnected-device errors as temporary offline results, with no broken-photo receipt. Refresh available folders on return. | Simulated device failures only; zero stored broken-photo errors, retry succeeds after return. No new size/count. |
| 4. Disk cache unavailable | Publication errors can fail the photo and subsequent jobs try storage again. | Stop failed storage for the session and continue transient pictures; surface one cache message. Handle missing cache volume separately from a new folder. | Scratch allowance of a few MB and simulated ENOSPC / missing volume; one failed store, no retry loop, usable pictures. Existing allowances unchanged. |
| 5. Startup upkeep | Low-priority thread waits for helper idleness outside the scheduler. | Admit bounded upkeep steps as eventually work, yield between safe points, release on cancellation/close. | Large generated scratch fixture; first visible picture within 10% of launch without upkeep (proposed tolerance from this brief). No new memory allowance: existing 64 MB minimum estimate. |
| 6. Window visibility | Hidden and shown owners retain equal classes. | Window visibility arrives over the grant channel; hidden owners become eventually; showing restores requested classes. Running work completes at its existing safe boundary. | Two owners: visible work wins, hidden queued work resumes and restores its class. No new count or budget. |

**3b implementation status (October 31; partial, not accepted).**

1. **Header refusal built; bounded pictures unfinished.** JPEG XL without a
   resolved source interpretation is refused before its pixel decoder is called.
   Fuji RAF's 6×6 CFA metadata tag is checked before opening LibRaw, so X-Trans reports a clear
   unsupported reason while the separate camera-preview path remains available.
   Other RAW containers retain the existing post-unpack CFA gate; complete header routing remains open. Ordinary supported decode/render math is untouched. Tests execute real marked
   JPEG XL samples and assert that unresolved samples never reach the decoder.
   This does **not** complete F19 for EXR/TIFF or provide bounded DNG/TIFF/PNG/JPEG.
   The line scan still waits for the missing bounded route. Investigation found
   full-size allocation in `normalize_camera_samples`, then global highlight
   support, colour conversion, crop/orientation and reduction. A mapped input
   alone cannot meet 7.3. No global Pillow guard change, no claim of an any-size
   thumbnail, and no bounded-route rate proposed without a measured route.
2. **Helper recovery built with a remaining crash ambiguity.** All decoding
   helper jobs announce active work. A single active culprit is set aside on
   crash; queued requests survive restart. Deadlines count active, unpaused work,
   not queue/Grade-pause time. A timed-out request is removed before restarting
   the helper, and other active requests are retained. Crafted crash and hanging
   stub tests recover the following file. If several files are active when a
   native crash occurs, the culprit remains ambiguous; current bounded replay
   remains rather than falsely accusing every active photo. GPU-source decoding
   in the backend itself is outside this helper protection. Both remain open. The existing three-restart lifetime limit is unchanged; this is not unlimited recovery.
3. **Offline reads built, return detected on reopen/focus.** OS errno/Windows
   device errors survive helper transport. Disconnection returns HTTP 503 with
   `offline`, never a picture-error receipt. The frontend treats it as an
   interrupted request, dims affected pins and explains reconnect/reopen. Coming
   back to the window refreshes pins and reopens the folder. Immediate hardware
   reconnect notification is not wired. A simulated ENODEV read followed by a
   successful retry passes; corrupt files remain distinct.
4. **Disk-cache failure handling blocked, no partial latch shipped.** Scene,
   camera-thumbnail, overlay and stored-screen writers publish independently in
   two processes. `_evict_transient` also relies on disk to preserve previews
   already promised to a draw. Disabling writes in just `prepare`/`build` either
   loses those previews or leaves memory above its share. Next work is one
   coordinated unavailable-cache state plus an event-driven handoff backpressure
   path, then ENOSPC/missing-volume tests. Existing budgets and LRU behaviour
   remain. No full-cache/no-cache acceptance claim; no new cache message.
5. **Startup scheduling built; launch tolerance unqualified.** Startup
   reconciliation, cleanup and membership recovery ask for the existing 64 MB
   minimum as `eventually` work. At every existing safe point the previous grant
   ends, visible requests go first, then upkeep waits on the job event. Close
   cancels/wakes the grant, and completion releases it. Visible work can start
   while the current short piece finishes. Non-startup indexing retains its
   existing waits. First-use ledger creation can still reconcile synchronously;
   the generated-fixture launch comparison is required before claiming ≤10%.
6. **Visibility scheduling built; native-window trial passed.** Visibility
   messages use the persistent grant channel. Hidden owners' jobs become
   `eventually`, including quick previews; they cannot jump ahead of foreground
   work. Promotions made while hidden are retained and restored when shown.
   Active work completes at its normal boundary. Two-owner scheduling and
   reconnect-channel behaviour pass. The native main + detached-Library trial also passes: a queued job becomes eventually when minimised, returns to now on restore, and is admitted when the two held slots end. Chromium remained visible while minimised in the harness, so the existing native window-state event also supplies visibility. Class changes are published even when the waiting reason is unchanged.

**Final qualification, October 31.** The final cold Aceh run completed all 48
pictures with no photo/page failures or duplicate asks: 35.284 / 81.634 s,
quick p50 / p95 / max 1.372 / 2.381 / 2.494 s, development maximum two and
time-weighted mean 1.980, independent peak 3.635 GB. Timing targets still fail;
two of 148 memory-endpoint samples timed out. One moderate trim/Chromium relay
occurred at 3.542 GB, above the 3.40 GB target. The 24-versus-30 visible-cell
ordering qualification described in 7.6 remains open.

The mixed-format cold run stopped at 4.206 GB during AVIF decoding (the external
AVIF process accounted for 1.546 GB). Only ten of 27 files completed; every file,
including unfinished ones, is recorded in
`codebase/output/cold-mixed/phase0/per-file-results.csv`. DJI TIFF completed in
14.257 s, but this is not a bounded-route measurement. The 192 MP JPEG/PNG quick
paths hit Pillow's existing size guard. The line scan, synthetic TIFF and other
unreached files remain unqualified. Overlapping grants mean per-file whole-app
increments in that CSV are not isolated decoder peaks; no lower estimates are
proposed from them. RAF/JXL header refusal timings were checked separately,
not mistaken for completed grid results. Full evidence and trim counts are in
`codebase/output/phase3b-summary.json`.

A sequential 2560×1440 direct Bayer RAW GPU check passes: app 3.249 s / GPU
1.878 s; SDR mean ΔE2000 0.0259 (p99.9 0.1343), HDR mean 0.1023 (p99.9 0.5414).
No tiled DNG math was built, so its tiled pixel comparison was not run. Disk-cache
failure tests and the generated-fixture upkeep launch comparison remain undone;
no broad or >30-minute slow validation was substituted.

Final grouped fast checks: JavaScript 686 passed / three existing failures;
Python 2,853 passed / three skipped / four existing failures (414.35 s). Existing
failures remain the two scene version stubs, Single screen-preview stub, preset
header contract, RGB publication guard, frame-cache budget and Retouch
CaptureCache fixture. No new failures; logs are
`codebase/output/phase3b-node-final.txt` and `phase3b-pytest-final.txt`.
Temporary profiles and test scratch are removed; real photos are reused only
from the permanent test-photo copies.

### 7.8 Phase 3c: live memory setting and reduced Library sources (October 31)

Built on `library-big-folder` after `2b37557`. Acceptance is **partial**. Steve
corrected the brief: **100 MP beside other work: measured; proposed rates
awaiting Steve**. The shipped estimates, default ceiling rule, fixed shares,
floor, fast lane, two developments and two saves remain approved values.

**Built.** Settings > Performance has a persistent, live "Memory the app may
use" control, from 2.5 GB to RAM minus max(2 GB, 10% RAM), with Use default.
The default remains max(2.5 GB, min(4 GB, RAM/4)). Ceiling, target (minus
600 MB), scaled shares, scheduler and helper follow it immediately; lowering
uses the existing trim path. Oversized cells keep available previews and show
their requirement with a link to this setting. Waiting is not a broken-photo
receipt. Raising the value resumes jobs without reopening the folder.

JPEG uses DCT reduction; PNG and TIFF use sequential decoding and reduction
before the normal Library pipeline. Ordinary sources retain up to a 5120
edge; the qualified root-page linear DNG route retains 10240. A 5120 line-scan
comparison exceeded the high-percentile tolerance, so it is not used. Single
100%, Grade, Proof and export keep full resolution. Original dimensions remain
in source descriptors. Repair jobs, DNG SubIFDs, opcode routes and DNGs with a
full-size embedded SDR reference retain their existing full-source route.
Uncompressed contiguous TIFF/DNG uses bounded overlapping row reads even for
a single enormous strip; mapping that strip kept the whole original resident.
Compressed TIFF/PNG use libvips sequential reduction. No retained cache was
added. Pillow's global guard is unchanged: giant JPEG permission is local to
one decode and checks the app estimate and physical reserve first.

**Other formats.** No reduced route was built for HEIC/HEIF, AVIF, JPEG XL,
EXR, PFM or Radiance HDR. Existing HEIF auxiliary/gain-map and ICC handling,
AVIF gain reconstruction and JPEG XL colour/auxiliary handling need their
format-specific paths. Resizing their returned full raster would not bound
decode memory. EXR/PFM/HDR also retain full decode; adding a correct scanline
reader is separate work. The new generic reader is deliberately not selected
for these formats. This is an assessment of the current adapters, not a claim
that their codec libraries cannot support future reduced decoding.

**Source-boundary peaks and decision 13.** Fresh Python processes, 25 ms
independent proportional-resident process-tree sampling, including external
children; peak minus the pre-job baseline. Decimal MB/GB. These are source
peaks, not promises about whole-app memory. A separate 1 ms private/working-set
probe is retained in the same JSON. Estimates in production are unchanged.

| Reduced route | Measured incremental peak | Source time | Proposed rate, awaiting Steve |
|---|---:|---:|---|
| 100 MP JPEG / 192 MP JPEG | 322.154 / 791.076 MB | 0.137 / 0.261 s | 6 MB/MP |
| 100 MP PNG / 192 MP PNG | 568.809 / 1101.330 MB | 0.792 / 2.369 s | 8 MB/MP |
| 100 MP TIFF / 192 MP TIFF | 400.610 / 258.233 MB | 0.562 / 0.458 s | 6 MB/MP |
| 297 MP eligible linear DNG | 389.565 MB | 10.834 s | 2 MB/MP |

Proposed lower rates apply only to the qualified reduced route at 100 MP or
larger; ordinary, native and fallback routes retain approved rates. The 64 MB
minimum remains. MB/MP equals bytes per source pixel. The proposed rates cover
the measured source peaks plus at least 25%, rounded upward. They still need
whole-app qualification across less compressible and differently shaped files.
The 192 MP PNG peak shows that sequential input is not constant-memory decoding.
Evidence: `codebase/output/phase3c/route-peaks.jsonl` (192 MP files were later
flattened from `phase0/synthetic` into `phase0` for the nonrecursive Library).

One authorised test-only comparison applied 6/8/6 to the three 100 MP sources
at the default 4 GB. All three finished in 7.886 / 7.953 / 7.983 s from folder
open (JPEG / PNG / TIFF); whole-app peak **2.478308200 GB**. Source grants
overlapped and each had `alone=false`: JPEG 1793444581807-1793444583855 ms,
PNG 1793444581808-1793444584701, TIFF 1793444582943-1793444585573. Thus each
ran beside other 100 MP work. Twelve generated 111-byte background PNGs were
filtered by the existing 1 KB photo gate, so this was three actual photos,
not a 15-photo ordinary mixed-work qualification. The temporary estimate
override was removed before committing. Production uses only approved rates.
Evidence: `codebase/output/cold-mixed/phase3c-proposed-comparison/`.

**AVIF overrun remains open.** The external gain-map decoder reconstructs
full-size output while retaining decoded image/gain-map/RGB buffers. It has
no selected reduced-output path. A fresh 42.177 MP LR-classic source measured
**1.883587143 GB** above baseline (44.7 bytes/pixel), including an external
decoder peak of 1.881 GB, against the approved 38 bytes/pixel / 1.603 GB.
This explains the underestimate; reducing only after reconstruction cannot
fix it. Propose **56 MB/MP** (measured +25%, rounded up). **Approved by
Steve, October 31**; not yet in code.
That is 2.362 GB for this source and reduces overlap. It requires a new
whole-app check if approved, especially with the oversized-alone exception.
No AVIF rate or implementation was silently changed.

**Actual-app evidence** (disposable profiles/copies, 2560x1440, one run each;
process-tree census, zero memory-observer timeouts):

| Run | Result | Whole-app peak |
|---|---|---:|
| 27-file phase0, approved rates, default 4 GB | Strict stop during LR-classic AVIF; acceptance failed | 4.002060571 GB |
| Same 27 files, approved rates, 16 GB | 22 finished, 5 refusals; line scan and all 192 MP synthetics finished | 5.402632183 GB |
| Focused 192 MP JPEG/PNG/TIFF, 4 -> 16 GB | Three needs-memory cells resumed in the same folder; 8.200 / 9.767 / 10.508 s from open; notices cleared | 3.057958322 GB |
| Line scan alone, 16 GB, cold app | Active development 12.4656 s; source 10.7978 s | 2.209855773 GB |
| Ordinary Aceh 48, default 4 GB | All finished, first/second viewport 24.910 / 41.252 s | 3.618042437 GB |

The line-alone pre-grant baseline was 0.984061070 GB, so whole-app incremental
peak was **1.225794703 GB**. It meets the <=27 s time aim but misses <=1 GB
incremental memory. The isolated 390 MB source figure does not replace this
whole-app result. In the raised mixed run the line took 12.667 s active,
47.161 s from open including queueing; concurrent work makes that interval
unsuitable for isolating the line's peak. Total raised mixed finish was 57.3 s.
All 27 per-file statuses/times are in each run's `per-file-results.csv` and `report.json`.
The five raised-run refusals are unresolved colour for two JXLs and the EXR,
unsupported X-Trans Library development for RAF, and an **unclassified**
request error for `DSC01244_DxO-optical-corr-only.dng`. The latter is not
claimed pre-existing. None is a needs-memory success; mixed acceptance remains
open. The stopped default run does not establish all-visible-preview time.

Ordinary quick-preview request p50/p95/max was 1.4751 / 2.2861 / 2.3655 s:
the <0.5 s p95 target remains unmet. All initially visible cells, partial rows
included, were quick-drawn by **2.9996 s**, 30/30; slowest `IMG_3212.JPG`,
2.9996 s from folder click / 2.3655 s from request. Setting 8 GB then 4 GB
took 62 / 22 ms; maximum frame gap across those setting changes was 89.7 ms,
with no failures. The complete browsing trace had an earlier 2.7925 s gap,
so this is not a claim that all browsing stalls are fixed. One cold run is
directionally faster than 3a.2, not a repeat-pair regression qualification.

**Scroll-back investigation.** At 43.386 s, all 48 previously shown Aceh cells
remained presented. Returning generated no `picture_navigation_to_present`,
`picture_cache_check`, source or development event and no pixel/source request;
only status polling and later idle live-plan calls. This case did not reproduce
Steve's thumbnail wait. No cache share was increased and no speculative cache
fix was made. Larger-folder reproduction remains open. Evidence for these
checks: `codebase/output/cold-mixed/phase3c-ordinary/report.json` and
`memory.jsonl`; other runs use the corresponding `phase3c-*` directory.

**Picture review.** Six before/after 2560 pairs are in
`D:\AI\AI Projects\HDR Finisher Tool\ai\codebase\output\phase3c\picture-review`.
Open `index.html` for pairs and full-size links. Finished SDR mean/p99.9
Delta E 2000: JPEG 0/0, PNG 0.269/1.832, TIFF 0.048/0.779, second PNG 0/0,
edited JPEG (+0.7 EV) 0/0, linear DNG 0.118/1.698. All satisfy mean <1 and
p99.9 <=3. The line pair uses the same +0.25 EV starting adjustment on both
routes, as labelled on the review page. Ordinary JPEG retains sufficient DCT
samples to keep the edited comparison inside tolerance. Steve's visual review
is still required; passing numerical agreement is not his approval by eye.

**Deadline proposal (decision 12).** The helper now scales the already-proposed
per-type baseline by `max(1, source MP/24)`. Queued time/Grade pauses do not
count. Examples: 192 MP JPEG 40 s; 297 MP DNG about 1670 s. This avoids
killing valid giants but lets a stuck giant hold a lane much longer. The
scaling and baseline remain proposed, awaiting Steve.

Focused checks only, as instructed for this round. Settings/scheduler/grants,
reduced PNG/TIFF, original geometry and DNG reference handling were exercised;
153 final focused Python checks passed (3 unrelated parameter cases deselected);
52 focused JavaScript checks passed. Follow-up checks after the final geometry,
PNG orientation and deadline tests: 36 reduced/DNG and 25 reduced/worker passed
(overlapping selections, not additional unique-test counts). A pre-existing RGB publication test creates
a source reference without required luminance and remains unrelated. An
embedded-DNG reference regression found during this work was fixed by retaining
its original route. No full suites, repeat pairs, push, merge or installer.
Protected project hashes were verified by each actual-app harness run.

### 7.9 Phase 3c.2 Part A: approved rates and retryable deadlines; revised acceptance (October 31)

**Partial implementation, based on ad1402d.** AVIF uses the approved 56 bytes
per source pixel. Qualified reduced Library sources at >=100 MP use JPEG 6,
PNG 8, TIFF 6 and linear DNG 6. The header qualifier excludes gain-map JPEG
and DNGs with operations or an embedded SDR rendition; native and CPU requests
keep their existing rates. The requested scene edge travels with the grant,
including reconnects. The 64 MB minimum and every other allowance are unchanged.
No reduced-route image processing changed.

Decoder baselines scale by max(1, source MP/24), capped at 300 seconds of
active helper work. Queueing and Grade pauses remain excluded. A deadline
returns a typed, retryable 408 result rather than a broken-photo receipt.
Cells retain this notice in window memory: "Took too long · Try again".
Retry clears the notice and requests a new development at the photo's
current visible/background priority, with a fresh deadline.

**Earlier stop, superseded by decision 16 below.** One 27-file cold mixed run, default
4,000,000,000-byte ceiling, stopped at **4,011,418,177 bytes** (4.011418177 GB),
**11,418,177 bytes over**. The only active development grant was
LR-classic-hdr-source-test-1.avif: **2,361,934,848 bytes**, the approved
56 bytes/pixel, admitted alone. The external AVIF decoder was active;
no AVIF GPU development had started. The sampled AVIF decoder charge was
1,206,977,097 bytes; the remainder includes the app and previously retained
resources, so this is not an isolated AVIF increment or a measured final peak.
The run stopped at the first observed violation. There were zero duplicate
grant asks and zero memory-request timeouts (50 requests). Protected-project
hashes were unchanged.

Evidence: codebase/output/cold-mixed/phase3c2-default/report.json,
memory.jsonl, per-file-results.csv and screen.png. This stopped run establishes
neither all-file completion nor complete screen/quick-preview timings.
No estimate was raised and no acceptance run was repeated.

**DxO DNG remains unresolved.** The earlier recorded error occurred during
Reading photo samples. Source preparation and JSON header serialization
succeeded in isolation on the existing disposable photo; the Library API
also returned a complete 640-source response (200). This does not qualify
the GPU picture or explain the earlier mixed-run failure. No speculative
decoder change or new refusal was added.

**Validation.** The final focused selection passed **72 Python checks**
and **33 grant/channel and scene-scheduler JavaScript checks**. Two new test
fixture defects found in the initial selection were corrected before this pass. The existing
helper crash/hang tests exercise deadline recovery and the new API test verifies
408 with no receipt. No full Python/Node suites, repeat pairs or release sweep.
The brief's AVIF stop condition prevented Parts B/C and the remaining acceptance:
one-versus-two GPU runs, raised line scan, Grade coexistence, forced GPU failures,
Single/neighbours and edited-photo comparisons. No new before/after folder exists.
Existing phase 3c review pictures remain unchanged and await Steve's visual review.

**Steve's revised acceptance, October 31 (decision 16).** The 4.011418177 GB
sample passes the memory peak rule. It does not establish completed-file or
settling acceptance: that stopped run did not observe either. Keep AVIF 56;
no further AVIF investigation now. Leave the DxO DNG alone because it succeeds
in isolation; capture and report the full request error only if it fails again.
Continue Parts B/C, then rerun the default mixed folder in final acceptance.

The harness now permits up to 10% over the planning ceiling during active work,
stops above that or on a physical-reserve breach, and records peak, overage,
active grant/file type and each observed excursion's duration (500 ms census
resolution). It observes normal settling for up to 30 seconds after the screen
work, requiring no running grants and memory below ceiling minus 600 MB. The
30 seconds is a proposed measurement window to keep the acceptance bounded,
not an additional production timeout or allowance. An unfinished job or missing
settle is reported as incomplete acceptance. Production logs record every
sampled crossing and recovery with active file types. A second excursion with
the same active type produces an estimate-review proposal for Steve; this is
association, not proof of causation, and never changes a rate automatically.

Focused validation of this addendum: 29 scheduler Python checks and four
independent observer accounting checks pass. The new boundary checks explicitly
accept exactly +10%, reject one byte beyond it, and preserve the hard reserve.
No GPU acceptance run was repeated for this measurement-only change.


### 7.10 Phase 3c.2 Part B: GPU work in the Library scheduler (October 31)

**Built and measured on `library-gpu-scheduling`** (`e466cd4` prototype finished
in `ae79a3d`, `2a9f016`, `d19862b`, `5282827`). The brief asked for this as a new
section 7.9; Part A holds that number, so it is 7.10.

Built: development and draw leases move into the one scheduler. Up to two
developments share the GPU when both `rawBudget` estimates, plus the small draw
allowance, fit in the app's existing Auto budget (half the detected card; the
Library now reports the same budget as Grade). Finished cells draw on their own
allowance without waiting for a development lease. Grade and export preempt at
the job's next safe point: the Library job releases its GPU memory, discards its
GPU work, keeps its decoded CPU source only if the RAM cache admits it, and is
requeued without spending an attempt (no disk checkpoint); the release log
records how long the higher class waited. RAM and the GPU are granted together
(M4). Out of memory frees the work and retries once at the front, then the
visible-only CPU route, and writes no broken-photo record. A lost device
releases all GPU grants and requeues once, then the visible-only CPU route.
Every development logs `gpu_estimate_bytes` and its measured `gpu_peak_bytes`.

**The 120 s grid timeout was not the scheduler.** The grid driver copies
`sdr_gradient.png` (111 bytes) as its fourth photo; the October 30 file gate
lists only files of at least 1 KB, so the folder listed three photos
(`folder_open_first_rows rows: 3`, `page_folder_rows_usable count: 3`) and the
driver waited forever for a fourth canvas. The disposable copy is now padded
past IEND above 1 KB (`ae79a3d`); pixels and edges are unchanged. With four
photos listed, the grid completed and two real Part B defects surfaced:

1. The Library window never received the detected video memory, so its Auto
   budget stayed at the 2 GiB policy default and `/api/delivery/gpu/activity`
   clamped the scheduler's GPU budget to 2 GiB. Two 1.26 GB ARW developments
   could never share and mid-flight preemption checks misfired. The Library boot
   now reads `desktop.videoMemory()` before renderer setup (`2a9f016`).
2. A device-loss or preemption requeue could start before the departing attempt
   stored its retained decoded source (measured 5 ms). The retry then fetched
   the source again while the backend claim was still held and renewed every
   10 s, so `live-scene` answered 202 forever. The retry now adopts a retained
   source that appears while it waits, and when the GPU route gives up for a
   photo the retained source is released so the visible CPU route can claim it
   (`d19862b`). A retained direct scene also reports as a cache hit.

**Measurements** (commit `5282827`). Grid driver via the release runner: PASS;
four cells cold in 6.7 s, every source reused (18-22 ms), two developments
overlapped, device-loss redraw of all cells works. New recovery driver
(`library-gpu-recovery.js`, area): forced OOM takes one GPU retry then the
visible CPU route; two forced device losses requeue once then take the visible
CPU route; both photos finish, no broken-photo records, no stuck grants - PASS.

One versus two GPU developments, Aceh 48-photo folder, cold, default 4 GB:
first/second screen 27.4 / 43.5 s with two, 28.6 / 47.7 s with one; all 30
visible quick previews on screen by 2.0 s (slowest IMG_3212.JPG, 1.27 s
request); peak RAM 3.74 / 3.42 GB; two overlapped in the grant log and is
faster with the same outcomes, so two stays. Default mixed folder (phase0 set,
4 GB): peak 3.42 GB - under the ceiling, the +10% brief excursion was not
needed - settled immediately (under ceiling - 600 MB), system reserve never
touched. Completion is unchanged from Part A: 10 of 27 finished, 3 refused as
needing more memory, the rest still developing at stop; the harness'
per-cell-outcome assert fails on those unfinished giants. Grade coexistence:
line-scan DNG open in Grade, Library paused in 543 ms, first ordinary photo
551 ms, resume after close 212 ms, the small edit saved.

**Open.** Two of the 48 Aceh JPEGs (IMG_2995, IMG_3232) are portrait photos:
`gpu_metadata` plans with landscape dimensions while the decode reports
portrait, the decoded `rawBudget` exceeds the admitted reservation by ~4 KB,
and `gpu_refine` forbids growth after admission, so both take the visible CPU
route (identical in both runs). **Steve chose option A (decision 19):** the
planning estimate uses the orientation the decode reports. Not yet in code. Large-picture completion in the phase0 set, and explicit M8/M18/M19
driver coverage, remain open.

Evidence: `codebase/output/cold-mixed/aceh-3c2-partb-{one,two}/report.json`,
`codebase/output/cold-mixed/phase3c2-partb-default/report.json`,
`codebase/output/release-checks/`, `codebase/output/library-gpu-recovery/`,
`codebase/output/phase3a-grade/report.json`.

### 7.11 Part C: built and measured; remaining limits (October 31)

Before any scene change, `tools/capture-library-edited.cjs --baseline` captured
five variants from disposable copies of the four-mask and fifty-local projects:
masks, many locals, Film Look with Denoise, a virtual copy and active Retouch.
Pictures and manifest: `codebase/output/part-c-edited/`. All five Single views
reached edge 2560; grid and filmstrip captured; protected project hashes checked.
The capture uses one reusable RAW under output/test-photos and removes its
sidecar afterwards. A canvas-stability capture timeout was corrected. Steve
observed VRAM corruption in the fifth picture; the unchanged-code capture was
rerun once and still contains obvious bright artifacts. Preserve this caveat
when judging pairs. No scene behavior changed in this capture commit.

Comparison allowance: mean Delta E 2000 below 1 and p99.9 at most 3, with
visual review of differences (same perceptual limits used in phase 3c).
Sparse obvious hardware corruption is identified separately, as Steve requested.
Focused validation: completed capture, five 2560 views, no page errors.

Implementation: requested-edge-only GPU development and CPU fallback;
source flights keyed by source identity AND edge. Grid/filmstrip and grid idle
warming make only 640. Single/fullscreen/Compare request 2560 now; only next
and previous neighbours develop as soon (50), with viewport-owned cancellation.
Filmstrip rank changes promote only 640 grants, keeping 2560 neighbours soon.
Existing edited stand-ins and protected stored-screen-preview reads are retained.
JPEG/PNG planning applies the decoder's EXIF turn; RAW planning keeps sensor
allocation dimensions and LibRaw flip. TIFF follows its unchanged, unrotated
decode contract. Admission still forbids growth; all approved numbers unchanged.

Focused checks: 47 orientation/estimate Python checks; 47 scene/GPU/ready-window/
read-ahead JS checks, and 37 grant/scene checks after tier-aware promotion.
The focused live Python run had 71 passes and the known unrelated scene-version
stub failure (`library-rgb-v3` versus current `library-rgb-reduced-v4`); left alone.
The final live-grid and GPU-recovery drivers pass through the release runner
at `28240ef` (isolated profiles, 2560x1440). Grid recovery stays 640-only;
M20 switching HDR/SDR starts no development. Single from the cold grid reaches
2560 in 1.761 s; a prepared neighbour step takes 17 ms; neighbour requests use
soon priority 50. No screen work remains after leaving Single. Active neighbour
cancellation is verified by the focused behavioral test; the successful live
run's neighbours had already finished, so it does not prove an in-flight abort.
Fullscreen/Compare use the same demand path; not separately timed here.

**Edited comparison.** `output/part-c-edited/index.html` shows every pair;
`comparison.json` retains unfiltered Delta E 2000 results. All averages are below
0.057. Four Single pictures are pixel-identical; the fifth has sparse red
corruption (mean 0.00472, p99.9 zero). Grid variant 3 and the five filmstrip
pictures exceed the p99.9 limit solely at sparse red streaks: filmstrip
x=64+119*n, for example [225,0,38] versus [192,193,185] at y=38.
Eye review finds no edit/color/detail change beyond this hardware corruption,
which Steve explicitly allowed us to disregard. The raw numeric check is not
an unqualified pass; no pixels or tolerance were changed. The original
filmstrip screenshot showed only two finished cells; a complete five-cell
supplement was captured with the exact original `71b486f` renderer, then the
current files were restored byte-for-byte. All protected projects unchanged.

**Final speed, approved estimates retained.** Two cold Aceh 48 runs at 4 GB,
two GPU developments, Auto half-card budget:

| Run | First / second screen, from opening | All 30 visible camera previews | App RAM peak | Whole-card GPU peak |
|---|---|---|---|---|
| one | 12.978 / 20.380 s | 1.848 s; slowest IMG_3212.JPG, request 1.159 s | 2.109 GB | 3.793 GB |
| two | 14.257 / 21.991 s | 1.924 s; slowest IMG_3212.JPG, request 1.229 s | 2.236 GB | 3.885 GB |

First screen is 2.11x / 1.92x faster than Part B's 27.424 s. All 48 finished
in both runs, zero development failures/timeouts; every RGB development requests
only edge 640. Both IMG_2995 and IMG_3232 use the GPU in both runs; actual peaks
155,013,488 / 314,437,808 bytes fit reservations 406,777,472 / 557,958,464.
GPU figures sample nvidia-smi every 250 ms and include other applications and
the desktop (initial whole-card use 2.404 / 2.393 GB); they are not app-only.

**Mixed 27, default 4 GB.** 10 finished, 6 quick previews only, 3 need more
memory and 8 unfinished at the 132-second stop: same completion as Part B.
Peak 3.173 GB, no excursion or physical-reserve breach, settled below 3.4 GB,
zero memory endpoint timeouts and zero development failures. The driver's
all-target-outcomes assertion still fails on the unfinished photos, as in
Part B; this is a memory pass, not a mixed-completion pass.

The first Part C mixed run finished 9 because narrowing the reservation inputs
removed headroom used by full-source RGB preparation (IMG_1150.tiff refused).
Restored the approved both-tier reservation and unchanged formula; only the
products actually developed are tiered. Repeated the affected two Aceh runs
and mixed measurement after this correction. Two test assumptions were also
corrected: matching-tier cache reuse is checked before another tier can reclaim
it, and live navigation accepts a neighbour that finished before departure;
active cancellation remains covered by the behavioral test. The final release
checks pass without retry. Grade's measurement initially failed while collecting
its log because it read an unset environment variable; it now uses the runner's
actual profile path. Final Grade check passes: pause 464 ms, first ordinary 471 ms, close/save
324 ms, resume 122 ms; small exposure edit saved and original sidecar restored.
Evidence: `codebase/output/phase3a-grade/report.json` (`9fb6b25` log-path fix).

Evidence: `codebase/output/cold-mixed/aceh-partc-{one,two}/`,
`phase0-partc-default/`; `output/library-live-grid/result.json`;
release-check folders `2026-10-31T16-38-42-377Z-e1e30d04e3923741abb4` and
`2026-10-31T16-39-54-178Z-8f64a7e7e08f034e0c26`. No approved rate, budget,
ceiling, reserve, concurrency or rendering formula changed. Grade, Proof and
export rendering code unchanged. Proof/export were not separately rerun.
Output size: 6.4 GB at start, 6.7 GB at end (100 GB limit). All 20 disposable
Electron profiles created for this task were removed; review pictures/reports
and reusable test-photo copies retained.

### 7.12 Scroll-back and mixed completion diagnosis (November 1)

**Problem 1: not reproduced on the bounded recent-screen case; no cache-policy
change claimed.** The diagnostic mode `--scroll-diagnose` reuses 200 disposable
copies (86 ARW, 85 HEIC, 20 PNG, 9 JPEG) from `D:/Photos/2023/11`. It waits for
three screens to finish, scrolls four more screens without waiting, then returns
to screens 3, 2 and 1. Source originals are read only. The observer computes the
complete expected screen from the layout before sampling: it does not mistake
cells left over from the previous layout for a completed screen.

`codebase/output/cold-mixed/scroll-verified/report.json` records every returning
cell, first draw, finished draw, blank observation, source/cache events and
previous finish. All 96 observations (36 / 30 / 30 cells) reused finished surfaces
in memory in 22.7 / 13.2 / 12.4 ms; no blank cells, disk-scene reads, source decode
or redevelopment. Every cell had previously finished. The three original screens
finished at 26.958 / 41.883 / 61.727 s. Whole-app RAM peaked at 3.090 GB, settled
below 3.4 GB, with no reserve violation or memory-endpoint timeout.

The thumbnail share held 367,288,320 of its existing 536,870,912 bytes; sharp
retention was zero. `tilePool` keeps finished surfaces outside the DOM and
returns them by exact source/grade/display identity. Virtual-window removal
alone did not lose these pictures. Its existing oldest-entry eviction applies
when the fixed share fills, and real memory pressure can trim it. An earlier,
invalid time-sorted diagnostic saw six memory trims while moving rows; that is
an investigation lead, **not proof** of Steve's reported cause. An initial
observer also undercounted a return screen; its timings are not acceptance data.
Neither run justifies a cache increase. Reproduction under pressure and the
beyond-capacity disk/stand-in behavior remain open; this run only covers the
three completed screens, including the top screen several screens back.

Validation: 24 focused layout, tile-pool, ready-window and grant checks pass.
No production cache sizes, cache lifetimes, rendering, Grade, Proof or export
behavior changed for Problem 1.

**Problem 2: partial fixes built; default mixed completion still fails.**

The original 17 unfinished source jobs were all **waiting**, not actively
running. Three refusal notices belonged to quick-preview attempts, not the
finished-picture routes. Four independent problems are now corrected:

* API paths are strings: the reduced-JPEG qualifier now converts to `Path`
  before checking gain maps. The 192 MP JPEG uses the approved 6 bytes/pixel
  instead of falling through to an unknown-size 4 GB reservation.
* JPEG XL dimensions now seek to the codestream header instead of requiring
  an entire large container box in a 1 MB prefix. OpenEXR's `InputFile` header
  reader is closed explicitly; it does not support the previous context-manager
  use. The real JXL and EXR now have dimension-based estimates, not 4 GB unknowns.
* JPEG GPU planning uses the same header-only DCT draft dimensions as the
  existing decoder. The 192 MP JPEG no longer reserves full-raster GPU space
  for an 8000×6000 decoded source. No estimate rate or GPU limit changed.
* GPU source responses stream their unchanged framed bytes in 1 MiB views.
  Joining the whole decoded source had created an additional full-source copy.
  The isolated gain-map AVIF initially stopped at **4.710 GB** (backend 2.905 GB);
  streaming lets it finish at **19.645 s, peak 3.786 GB**, settled below 3.4 GB.
  This is a transport fix, not a new decoder or a picture-quality change.

The grid's finished-picture memory notice now excludes quick-preview grants.
For the line scan, PNG and TIFF, the quick attempts estimated 6.828 / 4.416 /
4.416 GB, while the approved reduced source estimates are 1.781 / 1.536 / 1.152 GB.
A preview refusal must not describe those finished routes as unable to fit.

**All 17 isolated diagnoses.** Decimal MB/GB. Estimates are per source job;
measured peaks below are independently sampled **whole-app** peaks, including
startup, transport and GPU host memory, not per-decoder increments. They must
not be subtracted from or compared directly with a job estimate. Timings start
at folder open, and include application work; refusal times are explicit
unsupported-route outcomes, not successful developments. The 15 ordinary rows
were measured with header fixes before streaming, AVIF and TIFF with streaming.
The first isolated TIFF attempt omitted its `.hdrf` interpretation and was
invalid for this comparison; the corrected driver moves and restores that
sidecar with the disposable photo. No original photo is moved or edited.

| File / format | File MB | MP | Route | Source estimate MB | Isolated app peak GB | Isolated finish / refusal s | Mixed wait |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| `_DSC6510-1.png` | 223.27 | 42.390 | RGB PNG | 1186.91 | 2.446 | 9.386 (finished) | room, behind AVIF |
| `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif` | 2.14 | 10.664 | RGB AVIF | 597.18 | 1.751 | 6.756 (finished) | room, behind AVIF |
| `DSC00636.ARW` | 56.24 | 49.766 | Bayer GPU | 348.36 | 1.364 | 6.366 (finished) | room, behind AVIF |
| `DSC01244_DxO-optical-corr-only.dng` | 134.98 | 42.538 | linear DNG GPU | 1191.07 | 2.587 | 7.871 (finished) | room, behind AVIF |
| `DSC01302.jxl` | 93.61 | 10.664 | JPEG XL interpretation gate | 554.53 | 1.392 | 1.642 (refused) | room, behind AVIF |
| `DSCF6495.RAF` | 33.74 | 16.454 | X-Trans unsupported | 115.18 | 1.302 | 1.037 (refused) | room, behind AVIF |
| `IMG_7723.CR3` | 28.43 | 25.504 | Bayer GPU | 178.53 | 1.767 | 5.563 (finished) | room, behind AVIF |
| `jpeg_xl_16_bit_p3_color.jxl` | 0.76 | 10.684 | JPEG XL interpretation gate | 555.57 | 1.308 | 0.981 (refused) | room, behind AVIF |
| `line_scan_…fbcb8f8f…dng` | 1781.27 | 296.878 | reduced linear DNG GPU | 1781.27 | 2.308 | 13.178 (finished) | room, behind AVIF |
| `LR-classic-hdr-source-test-1.avif` | 25.54 | 42.177 | RGB gain-map AVIF | 2361.93 | 3.786 | 19.645 (finished) | measured memory |
| `P1010004.ORF` | 14.37 | 16.110 | Bayer GPU | 112.77 | 1.485 | 5.649 (finished) | room, behind AVIF |
| `pano_192mp.jpg` | 3.40 | 192.000 | DCT-reduced JPEG GPU | 1152.00 | 1.465 | 5.767 (finished) | room, behind AVIF |
| `pano_192mp.png` | 9.32 | 192.000 | row-reduced PNG GPU | 1536.00 | 2.279 | 7.738 (finished) | room, behind AVIF |
| `pano_192mp.tif` | 10.44 | 192.000 | row-reduced TIFF GPU (saved interpretation) | 1152.00 | 1.768 | 5.903 (finished) | room, behind AVIF |
| `possibly-cat-prints-texture-v001.exr` | 14.32 | 28.302 | EXR interpretation gate | 1075.49 | 1.640 | 1.375 (refused) | room, behind AVIF |
| `synthetic_24mp.hdr` | 82.39 | 24.000 | RGB HDR GPU | 552.00 | 2.189 | 7.046 (finished) | room, behind AVIF |
| `synthetic_24mp.pfm` | 288.00 | 24.000 | RGB PFM GPU | 912.00 | 2.264 | 7.435 (finished) | room, behind AVIF |

The shortened line-scan name is
`line_scan_2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng`.
Reports: `codebase/output/cold-mixed/isolated-0` through `isolated-16`, replacing
9 with `isolated-9-streamed` and 13 with `isolated-13-with-grade`.
Thus **13 of these 17 finish on their own**; two JXLs require source-colour
interpretation in Grade, EXR also needs interpretation, and RAF needs X-Trans
support. The RAF keeps its camera preview. DxO DNG succeeds on its own;
no unrelated investigation or rendering change was made for it.

**Remaining mixed blockage, not accepted:** `phase0-streamed/report.json`
(default 4 GB, all 27) still finishes **10/27**, with the same 17 waiting. Peak
3.059 GB, settled below 3.4 GB, system reserve untouched, 210 memory requests
without timeout. After 106.041 s the third screen still has 10 finished;
the measurement ends after detecting 30 s with no running jobs on each screen.
The first blocked visible source is `LR-classic-hdr-source-test-1.avif`:
2.282 GB retained whole-app RAM + its 2.362 GB estimate = **4.644 GB**, exceeding
even the 4.4 GB elastic boundary. The other 16 wait for room behind it under
existing FIFO. The table supplies every unfinished file's final reason.
No active decoder reaches its five-minute deadline: these jobs have not started.
Running this idle state for five minutes would not exercise the decoder cap.
This is not an accepted completion run and no terminal memory outcome is claimed.

Garbage collection, a moderate native-memory diagnostic, explicit consumed
upload-buffer detachment, and releasing the idle development device did not
unblock the queue. Upload detachment and device release were removed. The
pressure diagnostic is not production policy. Do not bypass the measured gate,
reduce 56 bytes/pixel, raise 4 GB, or manufacture pressure to clear thumbnails.
The remaining ownership/admission work and a default-folder completion run are
open; this change has not established a need for a higher approved number.

Validation: 64 estimate/framing checks and 28 focused source/grant/monitor checks
pass; 24 live-source checks pass with the brief's known unrelated authored-scene
version stub failing once. No full suites. The streaming test checks identical
wire bytes and that payload chunks share their original backing storage.
Existing reduced/full pixel comparisons in `output/phase3c/picture-review`
remain the evidence (mean ΔE2000 all <1; no new colour algorithm here). The PNG
pair was also inspected visually: detail and colour agree. This round does not
claim fresh perceptual comparisons for all 17 or Steve's visual acceptance.
All approved rates, shares, floors, deadlines and limits remain unchanged.

**Final regression checks, committed code `3cf7a9e`, once at the end.**
Two cold Aceh 48 runs finished their first screens in **13.195 / 13.547 s**
and their second screens by **19.635 / 20.928 s**. Both first screens remain
inside the predeclared 5% timing tolerance against Part C. All 30 initially
visible camera previews appeared by **1.725 / 1.807 s**. Peak whole-app RAM:
**2.304 / 2.367 GB**, settled below 3.4 GB, reserve untouched. Whole-card GPU
peaks **4.058 / 4.093 GB**, including the desktop and other applications; these
are not Library-only allocations. Reports: `output/cold-mixed/aceh-scroll-big-final-1`
and `aceh-scroll-big-final-2` under `codebase`.

The requested release-runner `library-live-grid.js` and
`library-gpu-recovery.js` both **pass**, no retries, at `3cf7a9e`.
Their run directories are
`output/release-checks/2026-10-31T17-31-27-705Z-84a5ee87675fa723d939` and
`2026-10-31T17-32-03-973Z-bb59737dae16adf3fbde`.
Grade coexistence passes: pause 480 ms, ordinary photo 488 ms,
folder click 1 ms, close 416 ms, resume 58 ms.
The disposable edit was saved and its original sidecar restored; protected
project hashes remained unchanged in every run. Report: `output/phase3a-grade`.
Output remains **14.5 GB** (100 GB limit); all 40 owned temporary profiles and
failed-run scratch were removed. Reusable photo copies and cited evidence stay.

**Open work:** reproduce the reported pressure/beyond-capacity scroll loss;
resolve the idle mixed queue without changing an approved number; rerun default
mixed completion after that fix and verify terminal non-broken outcomes. The
mixed run above is deliberately recorded as failed, not hidden by successful
isolated runs. Further slow diagnosis/validation needs a new time block under
AGENTS.md's roughly-30-minute stop-and-ask rule; no budget increase is proposed
from the current evidence alone.

### 7.13 Decision 20: fitting jobs pass a blocked job (November 1)

Implemented on `library-gpu-scheduling` (`ea2629b`, `42a0ede`); final acceptance is partial below.
Within a class, a fitting request can pass an older memory wait while earlier
work drains. Once passed, or once earlier work has drained and it is the oldest
waiter in its class, the blocked request protects its next turn: later work in
that class and lower classes stops. Higher classes and the quick-preview fast
lane continue. Existing running work finishes before reclamation.

Reclamation runs outside the scheduler lock, through existing cache trims and
scene/token release paths. Every connected window releases offscreen finished
surfaces/scenes and retained decoded sources; visible finished surfaces and
camera previews stay. Backend and helper release retained decoded/handoff
caches. Only acknowledgements from all owners followed by a fresh memory census
allow admission or a terminal decision. This is shortage for a specific waiting
job, not a synthetic operating-system pressure signal. No cache sizes, estimate
rates, concurrency limits, ceiling/floor or reserve values changed. Alone work
also observes the existing measured-memory admission gate.

If the job still cannot fit with competing work drained, its request ends once
with `needs more memory`. The cell keeps its preview and memory notice; no
broken-photo record is made. A new cell on scrolling back or opening Single can
make a fresh attempt. The source queue excludes these outcomes from failures.

Initial real-app check (`decision20-phase0`): all 27 ended in 34.331 s,
19 finished, four existing interpretation/X-Trans refusals, four source memory
outcomes (line scan, AVIF, PNG, PFM). Peak 3.813 GB, settled below 3.4 GB, no
reserve violation or HTTP timeout. The eviction acknowledgements preceded
Chromium releasing dead upload storage; the completion path now also awaits
the existing garbage-release call after references are released. It sends no
synthetic OS pressure and changes no approved number. This initial run is not
qualification; final acceptance below supersedes its completion result.

Focused validation: 59 Python scheduler/channel/memory checks and 38 JavaScript
channel/queue checks pass. The FIFO test now expects intentional same-class
skip-ahead while lower classes wait. No full suites, per this brief.


**Final acceptance at `42a0ede`, November 1.** The default mixed 4 GB run
reached an outcome for **all 27 in 34.6 s**: **20 finished**, four existing
interpretation/X-Trans refusals, three terminal source-memory outcomes. The
requested 23-finished target is **not met**. No jobs remain stuck. The last
finished photo was PFM at 32.831 s. The big AVIF ends once with `needs more
memory` at **29.018 s**; no source decode was started for it and it creates no
broken-photo record. Available camera previews remain. Quick-preview-only
refusals for the line scan, PNG and TIFF are separate from the source outcomes.

The guarded requests exhausted existing offscreen/decoded-cache release and
the dead-upload garbage-release step. The final census still left these sums
above the unchanged 4 GB admission gate (the 10% allowance covers running-work
excursions, not a wider admission rule):

| Source request | Estimate GB | Retained whole-app GB at decision | Sum GB | Outcome time s |
| --- | ---: | ---: | ---: | ---: |
| Line-scan DNG | 1.781 | 2.390 | 4.172 | 21.566 |
| Large gain-map AVIF | 2.362 | 2.466 | 4.828 | 29.018 |
| 192 MP PNG | 1.536 | 2.501 | 4.037 | 33.799 |

Peak whole-app RAM **3.592 GB**, zero above-ceiling excursions, settled below
**3.4 GB** as soon as the driver began its settling observation; system reserve
never touched. All 70 memory requests answered; no page errors. GPU allocation
reservations passed. No estimate, ceiling, allowance, floor, reserve, cache
share, save/development count or decoder deadline changed.

**All 27 final states:**

| File | Final state |
| --- | --- |
| `_DSC6117_DxO.jpg` | finished |
| `_DSC6328.jpg` | finished |
| `_DSC6510-1.png` | finished |
| `_DSC6527.ARW` | finished |
| `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif` | finished |
| `DJI_0071-2.tif` | finished |
| `DSC00636.ARW` | finished |
| `DSC01244_DxO-optical-corr-only.dng` | finished |
| `DSC01302.jxl` | Needs source-colour interpretation in Grade |
| `DSCF6495.RAF` | X-Trans unsupported; camera preview kept |
| `IMG_1150.tiff` | finished |
| `IMG_6717.PNG` | finished |
| `IMG_7723.CR3` | finished |
| `iphone_16_pro_IMG_3324.HEIC` | finished |
| `jpeg_xl_16_bit_p3_color.jxl` | Needs source-colour interpretation in Grade |
| `line_scan_2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng` | needs more memory |
| `LR-classic-hdr-source-test-1.avif` | needs more memory |
| `P1010004.ORF` | finished |
| `P1150601.RW2` | finished |
| `pano_192mp.jpg` | finished |
| `pano_192mp.png` | needs more memory |
| `pano_192mp.tif` | finished |
| `possibly-cat-prints-texture-v001.exr` | Needs source-colour interpretation in Grade |
| `QNY_8816.NEF` | finished |
| `synthetic_24mp.hdr` | finished |
| `synthetic_24mp.pfm` | finished |
| `VKNS0418.JPEG` | finished |

Evidence: `codebase/output/cold-mixed/decision20-final-phase0/report.json`
(includes the terminal backend census/estimate records), `per-file-results.csv`
and `memory.jsonl` in the same folder. Initial unqualified run remains in
`codebase/output/cold-mixed/decision20-phase0/`.

**Aceh regression passes:** both cold runs finish all 48, first screens
**13.783 / 14.062 s**, within 5% of their respective 13.2 / 13.5 s baselines.
Second screens **20.585 / 21.157 s**; peak RAM **2.265 / 2.348 GB**, settled
below 3.4 GB, no reserve breach, timeout or page error. Reports:
`codebase/output/cold-mixed/decision20-aceh-one/` and `decision20-aceh-two/`.

**Real-app checks:** `library-live-grid.js` and `library-gpu-recovery.js` both
pass through `npm run test:release -- --driver ...` after committing at
`42a0ede` (no flaky retry). Release records:
`codebase/output/release-checks/2026-11-01T02-38-59-169Z-841682e34ed08c51a61c/`
and `2026-11-01T02-39-50-898Z-f3a790930c1b24989f3e/`.

**Grade coexistence is not qualified:** pause notice **2.705 s**, over its
1 s limit; first ordinary picture **3.001 s** (under 5 s), folder click
**170 ms**, close/save **2.591 s**, resume **729 ms** (under 2 s). Exposure
0.125 was saved and Grade emptied. Protected projects stayed unchanged in all
runs. This driver failed its pause assertion; no extra slow rerun or diagnosis
was made. `codebase/output/decision20-grade-report.json` keeps the result.

Final focused checks: **59 Python and 57 JavaScript pass**. No full suites,
scroll-back diagnosis, Proof/export comparison or extra slow tests. Steve's
scroll-back try is still open. The 23-photo completion target and Grade pause
timing remain open; this is a built queue-stall fix with incomplete acceptance.
The remaining memory evidence suggests retained renderer/GPU host storage plus
protected visible surfaces, rather than queued decoders, limits the three jobs;
no additional ownership investigation or higher-memory proposal is claimed.
Disposable application profiles from these runs were removed. Output storage
remains **14.5 GB** at the end (14.5 GB at the start; limit 100 GB).

### 7.14 Grade rerun, decision 21 and retained-memory investigation (November 1)

Built and measured on `library-gpu-scheduling`: Grade coverage `024bbfb`,
decision 21 `f780e3b`. All final real-app checks below ran at `f780e3b`.
No push, merge, installer build, cache tuning or approved-number change.

**Grade: earlier slowdown not reproduced; cause unresolved.** The requested
one baseline repeat on unchanged `b3d5eed` passes: pause **469 ms**, ordinary
picture **477 ms**, close/save **402 ms**, resume **261 ms**. The original
2.705 s pause / 2.591 s close therefore does not establish a reproducible
regression in decision 20. No production fix is claimed. Grade's scheduler
branch already bypasses guard, measured admission and owner acknowledgements;
backend reclamation runs on a separate thread outside its lock. The retained
slow-run report has timings but does not isolate the delaying operation; no
reclamation/census cause can be established from it. Native page collection
can still occupy its renderer; uninterrupted interaction during that engine
operation is not established by these measurements.

Behavioral coverage now checks Grade before reclamation, while backend and
owner acknowledgements are both outstanding, and before a fresh census.
Another case admits a guarded GPU job, requests priority preemption and checks
that its active GPU reservation releases at the existing safe point. Final
coexistence: **509 ms pause, 518 ms ordinary picture, 354 ms close/save,
319 ms resume**; exposure **0.125** read back from the saved sidecar. Both
runs preserve the protected projects. Baseline evidence:
`codebase/output/grade-regression-baseline.json`; final evidence:
`codebase/output/phase3a-grade/{report.json,backend.log,screen.png}`.

**Decision 21 as built.** The oldest protected request, with no running job
of its own class, may use ceiling × 1.1 in the measured admission gate.
Ordinary admission stays at the ceiling. The physical-headroom gate runs
first, charges uncovered grants and preserves the hard system reserve.
The target, estimates, ceiling rule, elastic percentage, floor, fast lane,
cache shares, two developments, two saves and decoder deadlines are unchanged.
The allowance may avoid reclamation if the guarded request already fits;
otherwise decision 20 still drains, releases owners and requires a fresh
census. Tests cover 4.4 GB exactly and one byte over, unchanged ordinary
admission, same-class drainage, reserve blocking/recovery and Grade priority.
Existing reclamation fixtures now use retained totals above the new boundary
so they continue to exercise owner acknowledgements and census ordering.

**Retained memory, by owner; no tuning or additional release built.** At the
AVIF terminal decision after completed reclamation, scheduler total was
**2.461827 GB**, estimate **2.361935 GB**, sum **4.823762 GB**, above 4.4 GB.
The independent sample 252 ms before that decision measured **2.461704 GB**:

| Owner | Charged RAM MB at AVIF decision (nearest sample) | Needed? Existing guarded-job release? |
| --- | ---: | --- |
| Electron main/browser | 105.7 | App shell is needed. Dead uploads can use the existing page garbage-release call, already awaited. The later native capture reports 67.5 MB blob storage; it does not prove which blobs remain live. |
| Main Library/Grade renderer | 828.7 | Page and visible surfaces are needed; offscreen scenes, decoded sources and idle picture-host resources already release through `HDRLibraryReclaimWaiting`, `reclaimDecoded`, `reclaimHost`. Native/backing-store remainder is not attributed to live JS objects by this capture. |
| Other renderer / GPU host | 44.5 | Hidden renderer service remains needed. It has a native WebGPU transfer mapping even while idle; session reset does not destroy its device. No existing guarded purge of that engine pool is established. |
| Chromium GPU process | 1069.9 | Device/visible compositor resources are needed. A large transfer pool persists after app resources are released. Existing texture destruction/reset does not guarantee that Chromium returns its transfer pool. Device destruction/recreation would need a separate change and validation. |
| Python backend | 129.7 | Interpreter, Library metadata and small protected caches remain needed. Raw/handoff/working shares are reclaimed through `app_memory.reclaim("shortage")`; no extra large backend decode remains here. |
| Helper and its three decoder children | 254.0 | About 63–65 MB each, predominantly process baseline. Helper acknowledgement follows its existing raw/handoff/working reclamation. Stopping/restarting decoder services is not an existing guarded-cache release. |
| Utility/crash handler/launcher/console | 29.1 | Service/process baseline; no app-cache purge path. |
| Visible protected surfaces (overlap with owners above) | Not separately charged | Finished visible surfaces and available camera previews deliberately stay. The nearest logged cache census (1.5 s earlier) reported 72.8 MB of thumbnails; this is not an additional process total. Freeing those would violate decision 20's protection. |

The **end-of-run detailed Chromium capture**, after the final PNG (not an
atomic dump at the AVIF decision), identifies **846.7 MB GPU transfer memory**:
576.7 MB for the main renderer's client and 269.0 MB for the other renderer.
Three mappings are 268.4 MB each. The renderer maps **541.1 / 268.4 MB** of
that storage: the matching shared-memory identifiers confirm overlap, so do
not add these numbers to the GPU total. GPU shared images are **73.3 MB**.
Main-page JS heap used is **9.7 MB**, while backing storage is **671.0 MB**
and the array-buffer allocator's resident accounting is **687.5 MB**. The
capture does not distinguish live references, dead awaiting collection and
allocator retention within that backing storage. It must not be described
as 671 MB of proven reclaimable cache. Native sampling returned no stacks.

This explains where most of the retained charge resides: renderer/native
backing storage and Chromium GPU transfer pools, rather than a retained 1 GB
Python decode. The existing safe release paths have already been exercised;
no simple additional release is proven safe. Synthetic OS pressure, arbitrary
cache reductions and GPU device resets were not introduced. The AVIF still
does not fit. Its exact object-level backing-store retention remains open.
Evidence: `codebase/output/cold-mixed/decision21-final-phase0/`
`{report.json,memory.jsonl,memory-trace.json,backend.log}`. Shared allocator,
resident and charged measurements are different views, not additive totals.

**Final acceptance, one run per requested check.** Mixed default 4 GB: all
27 outcomes confirmed by **49.131 s**, last finished thumbnail at **48.424 s**;
**22 finished**, four existing interpretation/X-Trans refusals, one AVIF memory
notice at **35.218 s**. Line scan finishes at **34.505 s**, PNG at **48.424 s**.
Their guarded censuses plus unchanged estimates are **4.181019 GB** and
**4.072916 GB**, respectively. Quick-preview-only size refusals do not change
these source outcomes. Available camera previews remain; no memory refusal
records a broken photo.

Peak RAM **3.753870 GB**; no samples above the 4 GB ceiling, no elastic-limit
or physical-reserve violation, settled under **3.4 GB** at the first settling
observation. Last independent sample **2.648059 GB**. All 100 memory requests
answer, no page errors, GPU allocation reservations pass. Independent samples
are about 500 ms apart, so unsampled shorter excursions cannot be excluded.

| File | Final state |
| --- | --- |
| `_DSC6117_DxO.jpg` | finished |
| `_DSC6328.jpg` | finished |
| `_DSC6510-1.png` | finished |
| `_DSC6527.ARW` | finished |
| `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif` | finished |
| `DJI_0071-2.tif` | finished |
| `DSC00636.ARW` | finished |
| `DSC01244_DxO-optical-corr-only.dng` | finished |
| `DSC01302.jxl` | Needs source-colour interpretation in Grade |
| `DSCF6495.RAF` | X-Trans unsupported; camera preview kept |
| `IMG_1150.tiff` | finished |
| `IMG_6717.PNG` | finished |
| `IMG_7723.CR3` | finished |
| `iphone_16_pro_IMG_3324.HEIC` | finished |
| `jpeg_xl_16_bit_p3_color.jxl` | Needs source-colour interpretation in Grade |
| `line_scan_2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng` | finished |
| `LR-classic-hdr-source-test-1.avif` | needs more memory |
| `P1010004.ORF` | finished |
| `P1150601.RW2` | finished |
| `pano_192mp.jpg` | finished |
| `pano_192mp.png` | finished |
| `pano_192mp.tif` | finished |
| `possibly-cat-prints-texture-v001.exr` | Needs source-colour interpretation in Grade |
| `QNY_8816.NEF` | finished |
| `synthetic_24mp.hdr` | finished |
| `synthetic_24mp.pfm` | finished |
| `VKNS0418.JPEG` | finished |

All 27 rows, per-file times and terminal notices are retained in
`codebase/output/cold-mixed/decision21-final-phase0/per-file-results.csv`.

Cold Aceh, 48/48 finished in both runs: first screens **14.383 / 13.601 s**
(report timestamps), second screens **21.762 / 20.661 s**. First screens are
within the agreed 5% of **13.8 / 14.1 s** respectively. Peaks **2.236 / 2.333 GB**;
both settle below target with reserve intact, no endpoint timeout or page error.
Evidence: `codebase/output/cold-mixed/decision21-aceh-{one,two}/report.json`.
Console completion notices can trail the stored screen timestamp by milliseconds.

Focused checks: **63 Python** scheduler/channel/app-memory checks and **45
JavaScript** grant/queue/desktop-memory checks pass. No full suites, broad GPU
sweep, Proof or export picture checks. Grade/Proof/export picture code is
unchanged. After committing, both requested release-runner drivers pass at
`f780e3b`: `tests/library-live-grid.js` and `tests/library-gpu-recovery.js`.
Protected project hashes are unchanged. Runner summaries:
`codebase/output/release-checks/2026-11-01T03-40-36-631Z-4277919e7eb6f8bed383/`
and `2026-11-01T03-41-21-032Z-c0e0cebc3bf3f2a49a0b/`.

Remaining limits: original slow Grade run's cause unresolved; native transfer
pool/backing-store release not implemented; AVIF remains a memory notice.
No new decision or numerical relaxation is required for the built change.
Scratch output is **14.5 GB** at start and end (12.5 GB reusable test photos),
below 100 GB. The seven task-created temporary profiles and redundant console
scratch were removed; the reports and referenced diagnostic capture remain.

### 7.15 Ordinary waits and proportional reclamation (November 1)

The requested session (epoch 1793504808–1793504883) confirms 238 visible
measured-memory waits, 200 guard waits and 156 room waits. Its 111 thumbnail
cache checks include 43 hits and 68 misses. Four ordinary requests triggered
reclamation at retained totals of 3.091, 3.201, 3.362 and 3.555 GB. There were
14 developments, with no repeated path in that session. The log does not prove
that the misses were a one-time Part C rebuild.

The guard used a previous memory wait plus queue age/bypass, even while jobs
were running. It therefore blocked fitting work during normal queuing. Once
jobs finished, it could immediately reuse a census taken while they still
held allocations. Reclamation had no byte target: all windows, backend and
helper emptied eligible caches. The first 1.344 GB job needed only about
35 MB below the elastic admission boundary, yet invoked the same wholesale
release as a genuine giant. The backend pressure endpoint already acknowledges
asynchronously; the historical two desktop timeout messages alone do not
identify which part delayed acknowledgement.

The guard now requires drained running work and a census started after its
release, including cancellation/defer/disconnect. Real shortages retain the
existing elastic boundary and physical reserve. Reclamation sends a byte
target to one owner, resamples after acknowledgement, and visits another only
if a deficit remains. Within an owner it stops at the target, allowing the
last indivisible resource to cross it. If that estimated release returns less
resident RAM than expected, resampling requests another bounded batch from
the same owner until it fits or that owner has nothing left to release. Visible surfaces and prepared Single
neighbours remain protected. No approved estimate, budget or concurrency
number changes. Grade, Proof and export picture algorithms are unchanged.

`measure-library-cold-mixed.cjs --hdr-test` copies the complete source tree
once into `output/test-photos/hdr-test`, preserving child folders and sidecars.
Every cold app uses an isolated profile. `--warm-reopen` resets the Library
frame and its memory caches before reopening the folder against the same disk
cache. Measurement acceptance: report both screens, camera-preview coverage,
visible wait maximum, reclamation count, peak/settled RAM and warm cache hits;
Aceh first screens stay within the requested 5% of 14.4/13.6 s. Slow acceptance
is incomplete; focused checks currently pass (70 Python, 29 JavaScript).

Follow-up after `guard-hdr-final-one`: eight cache reclaims remained and the
first-screen observer expired at 313.926 s (24/30 original targets). The log
shows no queued source developments in the long gap before the observer
scrolled at 313.9 s: its fixed target list included photos moved offscreen by
folder discovery/sort updates. The observer now follows the current viewport;
a regression exercises row replacement. Finished/refused grants immediately
release development places in a focused behavioral check.

The EXR's source development failed once and was remembered, but every recheck
rebuilt its aborted cell and asked for a new *quick-preview* grant (0.975 GB),
before the cached refusal rejected the source plan. Refused cells now stop
before either preview or source preparation; grade warnings still allow work.
Unsupported preview formats (including EXR/TIFF/HEIC) no longer reserve RAM
for the preview endpoint that returns no preview for them. Estimates are not
changed. Before any cache eviction a drained shortage now asks connected
windows to collect dead upload buffers, then resamples. This does not discard
cache entries. Only a remaining measured deficit begins bounded eviction.

Steve stopped the extra folder run on November 1 and deferred phase0, Aceh,
release-driver and Grade checks. The next authorized slow check is one cold
HDR-copy first screen, followed by a report; no warm reopen or other slow
checks in that round. Focused checks above pass; native acceptance failed in the single authorized
follow-up run (`c9507e3`, `output/cold-mixed/guard-hdr-followup`). At 32.002 s,
whole-app RAM reached **4.490 GB**, crossing 4.4 GB by 89.9 MB, and the observer
stopped the run. Two ordinary DJI DNG developments held 336 MB grants each.
The first screen was incomplete (five finished pictures); no first-screen time
or settled RAM is available. The longest interval between successful
`picture_live_developed` completions was **6.981 s**; these are completion
events, so that gap does not mean the GPU was idle. Reconstructing grant state
from asks/grants/finishes finds **0 ms** with queued source work and no active
grant in this short observation. It recorded **zero reclaims and zero
collection requests**, so it stopped before the new collection path or the
EXR refusal could be qualified. No controller errors or diagnostic memory
probe timeouts appeared. This is a failed memory acceptance, not a speed or
zero-reclamation pass. No additional slow checks followed Steve's stop.

For the earlier capture, the longest completion gap was 188.519 s, from
129.919 to 318.439 s after the folder opened. From 140 to 313 s there were no
queued or active source/cpu grants at all. Later `development places full`
waits belong to the next screen's newly admitted work, after scrolling at
313.9 s; the entire capture's longest queued interval without any active grant
was 1.221 s. Its apparent long deadlock was the observer waiting on stale
viewport targets. This does not explain away the eight real cache reclaims.

Remaining work: diagnose the measured overshoot with unchanged budgets and
estimates before another slow check. The one-run follow-up did not reach the
EXR or establish a warm cache hit rate; phase0, Aceh, release-runner grid and
recovery, and Grade coexistence remain deferred for these commits.

### 7.16 Memory overshoot diagnosis; estimate decision required (November 1)

**Not fixed or qualified.** Work remains on `library-gpu-scheduling`, baseline
`94f996d`. No approved number or production behavior is changed in this round.
The requested brief says to stop before changing an estimate. The diagnosis
below reaches that boundary; phase0, Grade and release acceptance have therefore
not been run for a claimed fix.

Two unchanged-code cold `library-mixed-v1` checks show **18 / 17 pictures by
30 s and 31 / 31 by 60 s**. Both log a 4.308 GB backend-sampled peak and one
ordinary-file reclaim (`DSC01287.exr`). The independent observer in the second
run catches **4,420,308,985 bytes**, over the 4.4 GB limit, while ordinary DJI
DNG developments run, before any guarded admission. It settles below 3.4 GB
and does not breach the physical reserve. Reports:
`codebase/output/quick-library-check/memory-before/report.json` and
`codebase/output/quick-library-check/memory-before250/report.json`; independent
samples are in the latter's `memory.jsonl`. That first observer used a 250 ms
sleep plus census time (median interval 339 ms), so shorter spikes remain
possible. The checked-in observer now offers a true 250 ms start cadence;
existing callers retain their original default behavior.

**Concrete admission/route mismatch.** Header-only inspection shows both
`DJI_0071.DNG` and `DJI_0072.DNG` are **8000 x 6000 (48 MP)**, with required
GainMap and WarpRectilinear corrections. These fixture entries were previously
described as 20 MP; the locked fixture and manifest are unchanged.
`library_estimates.estimate_details` sees CFA photometric 32803 and reserves
**336 MB (7 bytes/pixel)** as though this were sensor-only RAW preparation.
`library_dng.decoded` instead demosaics to a **576 MB float32 RGB source**;
`developDNGTiles` also holds **576 MB in three full-size host planes**, before
tile packing, readbacks, transport and decoder temporaries. These are logical
live buffers, not a second process-memory charge. They exceed the grant even
before temporary/native retention. The baseline whole-app peak has 2.752 GB
in the main renderer and 1.149 GB in the GPU process. A whole-app increment
cannot be attributed exclusively to one overlapping grant. The route/header
record is `memory-before250/dng-route-diagnosis.json` beside that report.

The GPU header planner already distinguishes the DNG correction route; the
RAM planner does not. A proposed next step is to use the existing **28-byte
DNG RGB rate** for this route (1.344 GB per 48 MP request), retaining 7 for
sensor-only Bayer. This changes those jobs' admission estimates, so it awaits
Steve's authorization. It could reduce overlap and throughput, and would
still require the requested memory/speed acceptance. It is not implemented.
The other option is a larger bounded-host-buffer redesign with unchanged
estimates, requiring additional correctness and performance work.

**Rejected experiments, removed from production.** Explicit source-buffer
release, paced RGB uploads, explicit DNG tile-buffer release, and collection
before each source all failed independent memory acceptance. Their peaks were
4.781 / 4.663 / 5.651 / 4.617 GB. They do not establish a safe lifetime fix;
all were removed. Per-run evidence remains under
`codebase/output/quick-library-check/{owned-source,upload-bands,tile-storage,collect-start}/`.
The last experiment also exposed overlapping debugger collection failures
(`target closed while handling command`); it is not shipped. No estimate,
cache share, ceiling, allowance, floor, reserve, save/development count or
decoder deadline has changed. Decisions 20 and 21 remain intact.

**Ordinary reclamation is still open.** In the first baseline the drained EXR
wait collected dead uploads, then still saw 2.811 GB retained plus its 1.611 GB
estimate, about 21 MB above 4.4 GB. It invoked bounded eviction and eventually
ended with a memory notice rather than reaching its source interpretation
gate. This is real retained-memory pressure, not evidence that running work
was mistaken for drained work. Reducing false/avoidable ordinary reclaims has
not been achieved; estimate correction alone is not claimed to solve it.

Final focused checks: **70 Python and 32 JavaScript pass**; quick-check syntax
and observer compilation pass. Output is **31.8 GB** at start and end, below
100 GB. All six created application profiles were removed; evidence stays.

Tooling now adds independent whole-app process samples, active grants, peak,
reserve violations, final below-target status and observed sampling cadence to
the quick check, while preserving the existing backend `peak_gb` field and
older-commit API compatibility. `measure-library-processes.py` accepts an
optional period; its original callers retain the default. Focused validation
and local commit are recorded in the commit note. No new slow driver, full
suite, push, merge or protected-project write. The default Library real-app
check line was added to the local untracked `AGENTS.md`.

## 8. Phases

Each phase is one small set of commits that can be undone on its own, with
fast checks and one short scripted run on a disposable copy. No phase starts
before the previous one is accepted by Steve trying the app. Every phase
records its numbers in the [performance table](../performance-table.md).

| Phase | What | Removes | Accept when |
| --- | --- | --- | --- |
| 0. Measure — **done October 30** | Log real RAM and GPU peaks per file type and job type on disposable copies (20241117 RAWs, Aceh JPEGs, one of each supported type, a large TIFF). Try reduced decoding for 640. No behaviour change. | — | Per-type budget table (6.11) written for Steve to approve. |
| 1. File gate — **built October 30, awaiting Steve's try** | The rules in 6.9, edge cases F1–F7, F9, F10, F12, F13, F16 and F18. One shared rule set for the scan, the index, the add-folder browser and file checks. | Junk being parsed. | The fixture folder lists only real photos. No change for Steve's real folders apart from hidden and junk files. |
| 2. Stop the feedback loop — **built October 30, awaiting Steve's try** (7.5) | Refusal no longer counts as pressure. Trim once per change of level, with a cool-down. Chromium is signalled only on real shortage. | Root cause 4. | No pressure signal while measured memory is under the target. |
| 3. One scheduler, RAM — **October 31 run exception: Steve authorised 3a.1 → 3b without intervening acceptance.** — **3a.2 corrections built October 31; speed/mixed-memory qualification open (7.6). 3b partial resilience/scheduling built, large-picture and disk-cache work unfinished (7.7)** | Backend queue with priority classes, per-type estimates and the fast lane. Replaces the fixed 600 MB reservations (gates 1 and 3). Grants arrive over the channel. Reduced-decode quick previews if approved. Bounded routes for very large pictures. Edge cases F8, F11, F14, F15, F19, M1–M3, M5–M7, M9–M11, M21–M24, M26. | Root causes 2, 3 and 5 (RAM). | Embedded previews appear quickly while photos develop. Peak under the ceiling. |
| 3c.2 approved decisions — **Part A estimates built; revised memory acceptance (7.9)** | Approved estimates and retryable capped deadlines | Qualification remains open | Peak within ceiling +10%, then below target; mixed completion rerun pending. |
| 4. GPU in the same scheduler — **open; Steve authorised continuation (7.9)** | Development and draw leases move into the scheduler; two developments at once; safe-point pauses instead of yields. Edge cases M4, M8, M12–M19. | Root causes 1 and 6. | Developments overlap; finished cells draw without waiting. |
| 5. Grid makes 640 only — **built/measured October 31, awaiting Steve's try; hardware-artifact exception and mixed completion limit (7.11)** | 2560 made in Single and for its neighbours (6.8). The edited-photo no-regression check. Edge case M20. | Root cause 7. | First screen roughly 2–3 times faster than today; edited thumbnails unchanged. |
| 6. Clean-up | Remove the retry loops, polling and workarounds the old gates needed. Edge case M25. | Leftover complexity. | Fast checks pass; less code than before. |
| 7. Tune | Adjust estimates, the fast-lane size and the GPU count from logs. | — | Steve's feel plus the logged numbers. |

Proposed tolerances, to agree before measuring:

| Measure | Tolerance |
| --- | --- |
| Embedded preview, request to on screen, during development | p95 under 500 ms (extraction is about 60 ms) |
| Peak whole-app memory | Briefly at most ceiling +10% while work runs; settle below ceiling −600 MB; physical reserve stays hard (decision 16) |
| False failures | Zero |
| Grid timing | Judged against its own baseline, within 10% run to run |

## 9. Risks and what could break

* **Estimates that are too low** could briefly take the app over the
  ceiling. Mitigations: the 25% margin, the measured safety net (6.2),
  logging every overrun, and running unusually large pictures alone.
* **A bigger change in shared code.** Grade, export and the GPU delivery
  window use the GPU broker. Phase 4 needs their GPU checks rerun.
* **Single view on first open** may show the scaled-up grid picture for a
  moment before the 2560 picture arrives (phase 5). Neighbours are prepared
  while Single is open, so stepping through photos is usually ready.
* **A stricter file gate** hides anything it rejects. A real photo whose
  name starts with `.` or `~`, or that sits in a hidden folder, will no
  longer show. That is the intended restrictive choice; phase 1 reports how
  many files each rule hid in Steve's library (read-only count) before it
  ships.
* **Header sniffing** costs one small read per file. It happens at decode
  time, not while listing, so folder opening stays fast.
* **Two developments at once** use more GPU memory. Steve's card has
  intermittently bad VRAM, so GPU failures are rerun before blaming code.
* **The WebSocket channel** is new plumbing. If it drops, jobs must notice
  and ask again, rather than wait forever.

## 10. Decisions for Steve (one at a time, when each phase comes up)

Already decided (October 30): be restrictive about files; the grid makes
thumbnails only; edited photos keep their edit in the grid; an unedited RAW
gets its larger picture only in Single.

Decisions waiting for Steve:

1. ~~Approve this design direction (option C) and the phase order.~~
   Approved by Steve, October 30.
2. ~~Phase 0 per-type estimates (6.11).~~ Approved by Steve, October 30;
   recorded in memory-and-caches.
3. ~~Reduced-decode quick previews (6.11, point 4).~~ Approved by Steve,
   October 31, and moved into 3a. Quick previews only; finished
   thumbnails, Single, Grade, Proof and export are unchanged.
4. ~~Fast-lane allowance.~~ **64 MB, up to four at once, approved by Steve,
   October 31.** A quick preview estimated over 64 MB joins the normal queue
   as a **now** job with its real estimate (never refused, never failed).
5. ~~GPU developments at once.~~ **Two, approved by Steve, October 31**,
   with a measured one-versus-two comparison; if two is not faster, go back
   to one. A second development starts only when its GPU estimate fits beside
   Grade inside the GPU budget (Auto: half the card, 6 GB on Steve's 12 GB
   RTX 4070 Ti). Expected Library use: about 1.5-2.5 GB for two typical
   developments, about 3.5 GB at most. Per-development GPU peaks are logged.
   Steve also chose (October 31) to build phases 4 and 5 in one round together
   with wiring decisions 12-13 and the AVIF rate.
6. ~~When the photo open in Grade is bigger than the Library's room
   (M27).~~ Decided by Steve, October 31: keep a floor (option A, over
   options B "Grade lets go of the photo" and C "the Library waits"). Grade
   stays fully usable. When the Library's next photo is itself large, the
   Library pauses with a clear message and a way to close the photo in Grade.
   Going over the app's budget is usually fine, but never over the
   computer's free memory (7.6, points 5–8).
7. ~~Build phase 3 as 3a then 3b (7.6).~~ Approved by Steve, October 31.
8. ~~The floor allowance~~ **1 GB, approved by Steve, October 31.** The
   largest photo job that may run over the app's budget while room is short
   (7.6, point 5). 1 GB covers a
   24 MP JPEG (about 550 MB), a 12 MP iPhone HEIC (about 620 MB) and a
   61 MP RAW sensor read (about 430 MB); not a 48 MP HEIC (about 2.5 GB)
   or a line scan (about 6 GB), which wait for room instead. Needed for 3a.
9. ~~The system reserve~~ **the larger of 2 GB or 10% of RAM, approved by
   Steve, October 31.** Free memory always left for Windows and other apps
   (7.6, point 7): 6.8 GB on Steve's 68 GB machine, 2 GB on an 8 GB one.
10. **Unknown size: estimated at the ceiling, approved by Steve, October 31
    (Claude's proposal, asked for by Codex). Marked to revisit.** When a
    file's dimensions can't be read from its header, its job is estimated at
    the full Library budget (the ceiling: 4 GB on Steve's machine). The
    existing rules then apply: it runs alone, it is never admitted as the
    floor, and it starts only when free memory minus the system reserve
    covers that estimate. Waiting is never a failure; if the decode then
    fails, that error is recorded once as today. Each such job is logged as
    "unknown size", with its measured peak.
    * Why: most unreadable headers are damaged files that fail quickly, so a
      conservative stand-in costs little. The approved per-pixel table has
      no pixel count to fall back on.
    * Revisit if: the "unknown size" log lines show real photos (not damaged
      files) taking this path often, or waiting long on a small machine
      (an 8 GB machine with a 2.5 GB ceiling needs 4.5 GB free). Better
      stand-ins then: a per-type worst case, or an estimate from the file
      size for uncompressed formats (TIFF, PFM, linear DNG).
11. **Fix 3a's speed before 3b; at most two developments in progress,
    approved by Steve, October 31 (phase 3a.1).** Cause, from the 3a Aceh
    run's grant log (`codebase/output/cold-mixed/aceh/backend.log`): with
    estimates instead of the fixed 600 MB, 22 developments were granted in
    the same instant (2.2 s). They decoded on the CPU together and then
    queued for the still-exclusive GPU lease (phase 4), finishing about one
    per second in no screen order (IMG_2986: granted 2.2 s, finished
    34.3 s; grant-to-finish p50 13.4 s against a whole JPEG development of
    about 1.8 s). The old 600 MB rule had been limiting concurrency to about
    three by accident. Quick previews waited p50 1.0 s for the four-slot
    fast lane and took about 0.28 s each under that CPU load (phase 0: about
    0.06 s). Fix: at most two developments in progress (one on the GPU, one
    preparing), started in screen order; quick previews ahead of
    developments; memory granted just before real work, not held while
    waiting for the GPU. The count is tunable from logs (decision 5 still
    covers phase 4's two GPU developments at once).

Decided October 30:
- No picture size limit; very large pictures are supported through bounded
  routes (7.3).
- Online-only cloud files download only when opened (6.9).

12. **Decoder deadlines — approved by Steve, October 31, with a 5-minute
    cap.** Per-type baselines below, scaled by max(1, source MP/24), but never
    more than **5 minutes** of active work. Why the cap: the DNG baseline was
    already set from the line scan, so scaling counted its size twice (about
    28 minutes against 12.5 s measured), and a stuck giant runs alone, holding
    up all large work. A job that hits the limit is not a broken photo: its
    cell says it took too long and offers Try again. Cap and retryable Try again implemented in Part A; mixed qualification
    stopped as recorded in 7.9. Original proposal, kept for reference: use five times the
    largest phase-0 measured per-type job time, rounded up, with a five-second
    minimum: DNG 135 s, AVIF 81 s, EXR 16 s, PNG 15 s, JPEG XL 6 s, RAF 17 s,
    HEIC/HEIF 9 s; JPEG/TIFF/Bayer RAW/HDR/PFM 5 s. Unmeasured extensions use
    135 s. These proposed limits are used in the helper meantime, as authorised
    by this brief. Tradeoff: a bad decoder cannot occupy a lane forever, but a
    slower machine or an unusually large valid file can exceed these sample-based
    limits. Phase 3c scales them by max(1, source MP/24), still proposed,
    awaiting Steve; giant examples and tradeoffs are in 7.8. Queued work and
    Grade pauses do not consume the limit.
13. **Bounded-route estimates — approved by Steve, October 31.** Section
    7.8 records source peaks and the single authorised comparison. Qualified
    reduced routes at >=100 MP: JPEG 6, PNG 8, TIFF 6, linear DNG **6** MB per
    source MP. Codex proposed 2 for linear DNG; Steve chose 6 because the line
    scan's whole-app increment (1.226 GB, about 4.1 per pixel) is double what 2
    budgets. Implemented for qualified reduced Library sources in Part A; whole-app
    qualification stopped as recorded in 7.9. **AVIF 56 MB/MP approved by Steve, October 31**
    (replaces 38; needs a whole-app ceiling recheck). Lower reduced-route rates
    improve overlap but may underestimate other files; the higher AVIF rate
    reduces overlap but addresses its measured external-decoder overrun.
    Approved rates remain in production; the comparison override was removed.

14. **Saving limit — decided: two at once (Steve, October 31).** Keeping two
    bounds decoded results waiting for disk; a higher count might improve
    throughput on fast storage but retains more memory and can pile up results.
    **Possible bottleneck for folder speed.** Once the other major changes are
    in (memory setting, shrink while reading, faster processing), rerun the
    cold-folder tests with two, three and four saves and compare folder finish
    time and peak memory before changing it.
15. **Visible quick-preview measure — decided October 31 (Steve asked Claude
    to answer).** Add it as a reported measure: time from folder click until
    all initially visible cells, including partial rows, show their quick
    preview (5.008 / 5.884 s in the 3a.2 repeats). Each report also names the
    slowest single visible cell and its time, so one stuck cell cannot hide
    behind the total. No pass/fail target for it yet; set one once the speed
    work settles. The request-to-screen p95 <0.5 s target stays unchanged and
    is not met.


16. **Whole-app ceiling is a planning budget — Steve, October 31.** Running
    work may briefly exceed it by at most 10% (400 MB at default 4 GB), then
    must settle below target (ceiling minus 600 MB) when work finishes. The
    physical reserve remains hard and unchanged; never admit work that would
    cut into it. Measurements stop only above ceiling +10% or at a reserve
    breach. Report peak, overage, active grant/file type and excursion duration.
    Log every crossing; repeated excursions with one active type become a
    proposal for Steve, never an automatic rate change. The 4.011 GB AVIF sample
    passes; keep 56, no further AVIF investigation now. Rerun the default mixed
    folder in final acceptance. This supersedes earlier exact-ceiling acceptance
    wording, not the existing estimate-based admission or reserve rules.

17. **Sharing means the same source at the same resolution — Steve, October 31.**
    M17 forbids duplicate simultaneous work at matching source/resolution. A
    Library 640 development may proceed alongside Grade's full-resolution work;
    Grade keeps priority. Reusing Grade's finished result for a cell is optional
    only if simple; do not build new sharing machinery for it.

18. **Discard Library GPU intermediates on priority preemption — Steve, October 31.**
    This supersedes “not thrown away” in 6.7 for GPU work. Stop at the next safe
    point, free GPU allocations, requeue without spending an attempt. Retain the
    CPU decoded source only if free to keep inside existing RAM cache shares;
    otherwise drop it too. No disk checkpoints or added allowance. Export waits
    only for the next safe point, expected well under one second; log that wait.
19. **GPU planning uses the decoded orientation — Steve, October 31.** Portrait
    photos were planned with landscape dimensions, so their decoded `rawBudget`
    exceeded the admitted reservation by about 4 KB and they fell back to the
    CPU route (IMG_2995, IMG_3232 in Aceh). Option A: the GPU estimate uses the
    same orientation the decode reports, as 6.10 already states for rotated
    photos ("rotated photos use the rotated dimensions"). Growth after admission
    stays forbidden (option B rejected: a job could exceed what admission
    checked). Recheck the Aceh and phase0 numbers once after the change.
20. **Smaller jobs may skip a job that cannot fit yet — Steve, November 1.**
    Section 7.12 found one gain-map AVIF (2.362 GB estimate on top of 2.282 GB
    retained) blocking 16 jobs that each finish on their own. Within the same
    priority class, a job that fits now may start ahead of an older job that
    does not. Normal waiting behind running work does not activate the guard.
    Guard against starvation only after running work drains and a fresh census
    still shows that the oldest waiting job cannot fit. Then stop admitting
    later jobs of that class or below and reclaim only its remaining shortfall,
    cheapest offscreen finished surfaces first, then retained decoded sources.
    Resample between owners and stop releasing as soon as the job fits. If it still
    cannot fit once nothing else of its class is running, it ends once with
    "needs more memory", keeps its camera preview, and is never recorded as a
    broken photo. Tradeoff accepted: photos no longer always finish in screen
    order. No approved number changes.
21. **A guarded job may start inside the elastic allowance — Steve, November 1.**
    Section 7.13: after reclamation, the line scan (4.172 GB) and the 192 MP PNG
    (4.037 GB) were refused against the 4 GB admission gate, although each
    finished alone (whole-app peaks 2.3 GB). When the decision-20 guard holds the
    turn and nothing else of the job's class is running, admission may use the
    ceiling plus the existing 10% elastic allowance (4.4 GB at the default) as its
    limit. Ordinary admission stays at the ceiling. The system reserve stays
    hard: admission never cuts into it. Memory must settle below target after the
    job, as before. No estimate, ceiling or allowance value changes. Expected
    result on phase0: line scan and PNG finish (22 of 27); the 4.828 GB AVIF still
    ends with "needs more memory" unless retained memory is reduced.

**Wrap-up requested by Steve, October 31.** Part A remains the committed
implementation (`5fb733c`, `a86689a`). A Part B prototype passed 76 focused
Python and 71 JavaScript checks, but the real-app grid driver failed twice.
The first failure exposed cropped versus raw sensor dimensions in the GPU
reservation descriptor; after correcting that, detached reuse passed but grid
completion timed out after 120 seconds. The unqualified prototype was preserved
on the local branch `library-gpu-scheduling-wip` (commit 54bfb62, not pushed;
README in `docs/technical/wip/phase3c2-gpu/` on that branch) and as
`codebase/output/phase3c2-gpu-wip/part-b.patch`. Production code is restored
to Part A. Part B/C and all final acceptance remain open. No edited comparison
baseline or pairs were captured. Resume with the prototype README; do not treat
its focused checks as qualification of the restored production code.

**Resumed and finished, same day.** Part B was completed on
`library-gpu-scheduling` (see 7.10): the 120 s timeout was the driver's
111-byte fixture under the file gate's 1 KB listing floor, and the two real
defects it hid (the Library's 2 GiB budget default; a retry racing the previous
attempt's retained source claim) were fixed. The wip scaffolding and its
output copy are removed; the prototype's descriptor correction (cropped versus
raw sensor dimensions) stands. Acceptance runs in 7.10; the remaining open
items are listed there.

## 11. Code map (for whoever builds it)

* Memory owner: `codebase/backend/hdr_finisher/app_memory.py` (`admit`,
  `snapshot`, `_waiting_until`).
* Quick preview gate: `library_api.py` `quick_preview`, `live_preview`.
* RAW decode gate: `library_raw.py` (the `raw-decode-` reservations).
* GPU broker: `gpu_delivery.py` (`raw-budget`, `permit`, `activity`).
* Window side: `library-gpu-raw.js` `scheduledDevelopment`,
  `library-scenes.js` (`sources`, `draws`, `quickDraws`, `lease`),
  `photo-library.js` (preview polling, `createWarmer`, the
  `hdr-memory-pressure` handler), `library-ram.js` (`apply`).
* Pressure relay: `desktop/main.js` (the 500 ms memory timer) and
  `desktop/memory-pressure.cjs`.
* File gate: `desktop_security.py` (`SOURCE_EXTENSIONS`, `is_photo_name`,
  `is_os_junk_folder`), used by `library_folders.py` (`scan_folder`,
  `_walk_photos`), `library_folder_stream.py`, `media_browser.py`,
  `library_metadata.py`, `library_file_folders.py`, `library_marks.py`,
  `library_pictures.py`, `library_picture_errors.py`.
* View sizes: `photo-library.js` `thumbnailEdge()` (640) and
  `library-gpu-raw.js` (the `[640, 2560, edge]` development sizes).
