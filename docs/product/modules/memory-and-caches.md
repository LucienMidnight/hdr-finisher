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
7. **Working room is reserved, not cached.** The photo being developed, Delete
   planning and similar work need temporary memory. That room is kept free
   inside the total; caches may not fill it.
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
| Grade source mips / retained native source | backend / helper | inside working room | — | Strict retained-byte admission; oversized levels can be served without being cached. |
| Working room | all | 600,000,000 bytes | no | One aggregate reservation envelope, including retained working caches, replacing 700 MB–1.2 GB per-job requests. |
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

Budget implementation is in progress on `library-big-folder`. Validation is
not a pass until the ten-minute gate below completes.

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
untracked items were left untouched. No background validation should resume
until Steve asks to continue.

## 8. Open work

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
