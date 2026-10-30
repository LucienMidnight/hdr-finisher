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
* Grade and export keep priority. A Library development is asked to pause
  only at a safe point between stages, and is not thrown away. If it is
  stopped, it waits its turn again without spending an attempt.
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
* **Reduced decoding** is checked in phase 0 for the 640 grid size. Examples
  are JPEG decoding at 1/2, 1/4 or 1/8 scale, and LibRaw half-size. It can
  cut both memory and time for thumbnails. It is used only where the picture
  stays within the agreed perceptual tolerance.

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

**Proposed estimates for the scheduler (Steve's decision).** Measured bytes
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
| M1 | Size unknown before decoding | Header read first; otherwise the type's worst case | 2 | Unit tests per type |
| M2 | Job bigger than the whole job budget | Runs alone, with nothing else admitted beside it. If even that cannot fit under the ceiling, a reduced decode. | 2 | Unit test |
| M3 | Big job starved by a stream of small ones | When a **now** job is waiting, lower classes stop being admitted until it fits | 2 | Unit test |
| M4 | Job holding RAM while it waits for the GPU (deadlock, priority inversion) | RAM and GPU granted together, all or nothing | 3 | Unit test with two jobs needing both |
| M5 | Leaked grants (window reload, crash, helper restart) | Each grant has an owner and a heartbeat; when the owner goes, the grant is released. After a backend restart, windows resubmit. | 2 | Kill a window mid-job; reload the page |
| M6 | Several windows (Library, Grade, hidden delivery window) | One scheduler for all of them. A minimised or hidden window's work drops to **eventually** (Chromium's hidden-tab practice). | 2–3 | Two-window test |
| M7 | Fast scrolling: hundreds of submits and cancels | Cancelling removes a job at once and costs nothing; only settled viewports submit (exists) | 2 | Scripted fast scroll; queue length logged |
| M8 | Selection changes mid-development | Priority changes in place; the work is kept | 3 | Unit test |
| M9 | Small machine (8 GB RAM, 2.5 GB ceiling) | At least one **now** job can always run; caches trim to make room; background work stops | 2 | Run with the ceiling forced to 2.5 GB |
| M10 | Other apps use the memory (operating-system pressure) | Trim at Chromium's levels; the job budget shrinks while pressure lasts | 1–2 | Simulated pressure |
| M11 | Memory measurement fails (a process can't be read) | Keep scheduling on estimates; log once | 2 | Unit test |
| M12 | Unified-memory graphics (Apple silicon, Intel/AMD integrated) | GPU estimates also count against RAM (darktable's `unifraction` practice) | 3 | Unit test with a unified adapter flag |
| M13 | GPU lost (driver reset, sleep, display change, Steve's faulty VRAM) | All GPU grants released, jobs requeued once, then the visible-only CPU fallback; GPU failures rerun before blaming code | 3 | Forced device loss in a driver |
| M14 | GPU out of memory | Caught through WebGPU error scopes; Library work freed; retried once | 3 | Forced allocation failure |
| M15 | Another app using VRAM (games, browsers) | Fixed headroom kept free (darktable practice); out-of-memory handling as M14 | 3 | — |
| M16 | Export or Proof running | Library background work pauses; visible work continues on a small allowance; export never waits on the Library | 3 | Export while scrolling |
| M17 | Grade and the Library want the same photo | One development per source identity, shared | 3 | Open a photo in Grade while its cell develops |
| M18 | Pasting a grade onto hundreds of photos | Redraw only; visible photos first, the rest **eventually**; no new development unless the source changed | 3 | Paste onto 200 photos in a disposable copy |
| M19 | Virtual copies | One development, separate draws | 3 | Existing virtual-copy fixture |
| M20 | HDR/SDR switch | Redraw from the same scene; no development | 5 | Toggle test |
| M21 | Disk cache full, or C: full | Storing fails once with a message; the cache stops filling; no retry loop | 2 | Allowance forced to a few MB |
| M22 | Cache folder on a drive that was removed | Run without a disk cache, with a message | 2 | Simulated missing folder |
| M23 | The grant channel drops, or the backend restarts | Windows reconnect and resubmit; waiting jobs time out instead of waiting forever | 2 | Kill and restart the channel mid-run |
| M24 | Startup upkeep on a large library (cache reconciliation measured 31 s, all upkeep 76 s on October 30) | Runs as **eventually** work through the scheduler; never blocks visible work | 2 | Startup with D:\Photos indexed (read-only) |
| M25 | Logging costs: backend.log is 358 MB and timing lines are frequent | Rotate logs; per-job lines stay, very frequent diagnostics are sampled | 5 | Log size after a ten-minute session |
| M26 | A picture that can never fit the GPU route (the line scan's samples exceed the GPU's largest buffer) | Goes straight to the bounded route instead of "waiting for memory" | 3 | The line-scan copy |

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

## 8. Phases

Each phase is one small set of commits that can be undone on its own, with
fast checks and one short scripted run on a disposable copy. No phase starts
before the previous one is accepted by Steve trying the app. Every phase
records its numbers in the [performance table](../performance-table.md).

| Phase | What | Removes | Accept when |
| --- | --- | --- | --- |
| 0. Measure — **done October 30** | Log real RAM and GPU peaks per file type and job type on disposable copies (20241117 RAWs, Aceh JPEGs, one of each supported type, a large TIFF). Try reduced decoding for 640. No behaviour change. | — | Per-type budget table (6.11) written for Steve to approve. |
| 1. File gate | The rules in 6.9, edge cases F1–F7, F9, F10, F12, F13, F16 and F18. One shared rule set for the scan, the index, the add-folder browser and file checks. | Junk being parsed. | The fixture folder lists only real photos. No change for Steve's real folders apart from hidden and junk files. |
| 2. Stop the feedback loop | Refusal no longer counts as pressure. Trim once per change of level, with a cool-down. Chromium is signalled only on real shortage. | Root cause 4. | No pressure signal while measured memory is under the target. |
| 3. One scheduler, RAM | Backend queue with priority classes, per-type estimates and the fast lane. Replaces the fixed 600 MB reservations (gates 1 and 3). Grants arrive over the channel. Reduced-decode quick previews if approved. Bounded routes for very large pictures. Edge cases F8, F11, F14, F15, F19, M1–M3, M5–M7, M9–M11, M21–M24, M26. | Root causes 2, 3 and 5 (RAM). | Embedded previews appear quickly while photos develop. Peak under the ceiling. |
| 4. GPU in the same scheduler | Development and draw leases move into the scheduler; two developments at once; safe-point pauses instead of yields. Edge cases M4, M8, M12–M19. | Root causes 1 and 6. | Developments overlap; finished cells draw without waiting. |
| 5. Grid makes 640 only | 2560 made in Single and for its neighbours (6.8). The edited-photo no-regression check. Edge case M20. | Root cause 7. | First screen roughly 2–3 times faster than today; edited thumbnails unchanged. |
| 6. Clean-up | Remove the retry loops, polling and workarounds the old gates needed. Edge case M25. | Leftover complexity. | Fast checks pass; less code than before. |
| 7. Tune | Adjust estimates, the fast-lane size and the GPU count from logs. | — | Steve's feel plus the logged numbers. |

Proposed tolerances, to agree before measuring:

| Measure | Tolerance |
| --- | --- |
| Embedded preview, request to on screen, during development | p95 under 500 ms (extraction is about 60 ms) |
| Peak whole-app memory | Under the ceiling in every run |
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

Still to decide:

1. ~~Approve this design direction (option C) and the phase order.~~
   Approved by Steve, October 30.
2. Phase 0 per-type estimates (6.11).
3. Reduced-decode quick previews (6.11, point 4).
4. Fast-lane allowance (proposed 64 MB, four at once).
5. GPU developments at once (proposed two).

Decided October 30:
- No picture size limit; very large pictures are supported through bounded
  routes (7.3).
- Online-only cloud files download only when opened (6.9).

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
