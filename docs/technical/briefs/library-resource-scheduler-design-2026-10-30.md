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
Screen two is explicitly scrolled to by the script after all screen-one canvases
appear; a later store/finish overlaps that scroll, so this is not evidence of
unprompted second-screen overtaking. No rerun for noise: the miss is substantial.

Grade coexistence: first ordinary picture 2.926 s (<5), paused line scan observed
1.995 s from folder opening (cell-visible latency unmeasured), close/save 1.872 s,
resume 0.150 s (<2), saved exposure verified, zero page errors, protected project
hashes unchanged. The pause message and Close photo in Grade action work.

Checks: scheduler/grant Python checks 22 passed. Final full Python: 2,842
passed, three skipped, four existing fixture failures (preset-header, RGB
publication, frame-cache and Retouch capture-cache). The earlier unrelated
helper-restart timeout did not recur. Full JavaScript: 683 passed, three
existing failures (two source-test version stubs and Single screen-preview
stub). No new failures. The quick-first and FIFO expectations were updated
because those behaviours changed deliberately; no tolerance was relaxed.
Development grants: maximum two, time-weighted mean 1.831. Quick previews:
p50 1.390 s / p95 2.130 s / max 2.439 s (p95 limit <0.5 s missed). Two moderate
trims at 3.469 / 3.420 GB, above the existing 3.40 GB target; no refusal signals.
Invalid exploratory runs (overlapped apps and an accidental draw-lane change)
were excluded; the draw queues are restored to one lane.

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
   LibRaw's header CFA is checked before `unpack`, so X-Trans reports a clear
   unsupported reason while the separate camera-preview path remains available.
   Ordinary supported decode/render math is untouched. Tests execute real marked
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
   in the backend itself is outside this helper protection. Both remain open.
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
| 3. One scheduler, RAM — **October 31 run exception: Steve authorised 3a.1 → 3b without intervening acceptance.** — **3a scheduler/channel connected October 31; speed qualification open (7.6). 3b partial resilience/scheduling work; large-picture and disk-cache work unfinished (7.7)** | Backend queue with priority classes, per-type estimates and the fast lane. Replaces the fixed 600 MB reservations (gates 1 and 3). Grants arrive over the channel. Reduced-decode quick previews if approved. Bounded routes for very large pictures. Edge cases F8, F11, F14, F15, F19, M1–M3, M5–M7, M9–M11, M21–M24, M26. | Root causes 2, 3 and 5 (RAM). | Embedded previews appear quickly while photos develop. Peak under the ceiling. |
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
2. ~~Phase 0 per-type estimates (6.11).~~ Approved by Steve, October 30;
   recorded in memory-and-caches.
3. ~~Reduced-decode quick previews (6.11, point 4).~~ Approved by Steve,
   October 31, and moved into 3a. Quick previews only; finished
   thumbnails, Single, Grade, Proof and export are unchanged.
4. ~~Fast-lane allowance.~~ **64 MB, up to four at once, approved by Steve,
   October 31.** A quick preview estimated over 64 MB joins the normal queue
   as a **now** job with its real estimate (never refused, never failed).
5. GPU developments at once (proposed two).
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

12. **Decoder deadlines — proposed, awaiting Steve.** Use five times the
    largest phase-0 measured per-type job time, rounded up, with a five-second
    minimum: DNG 135 s, AVIF 81 s, EXR 16 s, PNG 15 s, JPEG XL 6 s, RAF 17 s,
    HEIC/HEIF 9 s; JPEG/TIFF/Bayer RAW/HDR/PFM 5 s. Unmeasured extensions use
    135 s. These proposed limits are used in the helper meantime, as authorised
    by this brief. Tradeoff: a bad decoder cannot occupy a lane forever, but a
    slower machine or an unusually large valid file can exceed these sample-based
    limits. They need scaling/qualification for bounded very-large jobs; those
    routes are not built. Queued work and Grade pauses do not consume the limit.
13. **Bounded-route estimates — awaiting measurements.** No new rate is applied
    or invented. Keep the approved per-type rates until a bounded implementation
    has measured peaks. A lower rate would allow more overlap but could exceed
    the ceiling if full-size intermediates remain. Current code uses the approved
    rates, including the oversized line scan's conservative estimate.

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
