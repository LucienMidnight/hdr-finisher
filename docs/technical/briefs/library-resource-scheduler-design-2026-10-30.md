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

### 6.8 What the grid makes

* Grid and filmstrip cells develop only the thumbnail size (640).
* The screen preview (2560) is made as **now** work when a photo opens in
  Single, as **soon** work for Single's neighbours, and as **eventually**
  work by the idle pre-warmer.
* The camera's embedded JPEG (or the original JPEG) is always shown first,
  through the fast lane.

## 7. Phases

Each phase is one small set of commits that can be undone on its own, with
fast checks and one short scripted run on a disposable copy. No phase starts
before the previous one is accepted by Steve trying the app.

| Phase | What | Removes | Accept when |
| --- | --- | --- | --- |
| 0. Measure | Log real RAM and GPU peaks per job type on disposable copies (20241117 RAWs, Aceh JPEGs, a DNG, a large TIFF). No behaviour change. | — | Estimate table written for Steve to approve. |
| 1. Stop the feedback loop | Refusal no longer counts as pressure. Trim once per level change, with a cool-down. Chromium is signalled only on real shortage. | Root cause 4. | No pressure signal while measured memory is under the target. |
| 2. One scheduler, RAM | Backend queue with priority classes, estimates and the fast lane. Replaces the fixed 600 MB reservations (gates 1 and 3). Grants arrive over the channel. | Root causes 2, 3 and 5 (RAM). | Embedded previews appear quickly while photos develop. Peak under the ceiling. |
| 3. GPU in the same scheduler | Development and draw leases move into the scheduler; two developments at once; safe-point pauses instead of yields. | Root causes 1 and 6. | Developments overlap; finished cells draw without waiting. |
| 4. Grid makes 640 only | The 2560 screen preview is made on demand or by the pre-warmer. | Root cause 7. | First screen roughly 2–3 times faster than today. |
| 5. Clean-up | Remove the retry loops, polling and workarounds the old gates needed. | Leftover complexity. | Fast checks pass; less code than before. |
| 6. Tune | Adjust estimates, the fast-lane size and the GPU count from logs. | — | Steve's feel plus the logged numbers. |

Proposed tolerances, to agree before measuring:

| Measure | Tolerance |
| --- | --- |
| Embedded preview, request to on screen, during development | p95 under 500 ms (extraction is about 60 ms) |
| Peak whole-app memory | Under the ceiling in every run |
| False failures | Zero |
| Grid timing | Judged against its own baseline, within 10% run to run |

## 8. Risks and what could break

* **Estimates that are too low** could briefly take the app over the
  ceiling. Mitigations: the 25% margin, the measured safety net (6.2),
  logging every overrun, and running unusually large pictures alone.
* **A bigger change in shared code.** Grade, export and the GPU delivery
  window use the GPU broker. Phase 3 needs their GPU checks rerun.
* **Single view on first open** may show the thumbnail for a moment before
  the screen preview arrives (phase 4), unless the pre-warmer got there
  first.
* **Two developments at once** use more GPU memory. Steve's card has
  intermittently bad VRAM, so GPU failures are rerun before blaming code.
* **The WebSocket channel** is new plumbing. If it drops, jobs must notice
  and ask again, rather than wait forever.

## 9. Decisions for Steve (one at a time, when each phase comes up)

1. Approve this design direction (option C) and the phase order.
2. Phase 0 estimate table (sizes per job type).
3. Fast-lane allowance (proposed 64 MB, four at once).
4. GPU developments at once (proposed two).
5. Grid makes only the thumbnail; Single makes its own screen preview.

## 10. Code map (for whoever builds it)

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
