# Module PRD: Memory and caches

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 29, 2026, against the code on
  `library-big-folder` (`0d32e0b`).
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

| Part | Process | Share of 4 GB | Scales | Code today | Gap |
| --- | --- | --- | --- | --- | --- |
| App's own starting memory (code, page, GPU process) | all | about 1.3 GB, measured | no | about 1.33 GB at the start of the October 29 scroll (GPU-process host 0.89 GB) | Not a cache; measure, don't budget. |
| Finished thumbnails (recent pool) | renderer / GPU process | 512 MB | no (Steve's fixed decision) | `library-tile-pool.js`: 512 MiB | Matches. |
| Sharp pictures around the selected photo (Single and fullscreen ready window, direct RAW scenes) | renderer / GPU process | 512 MB | yes | `library-ready-window.js` keeps the selected photo and neighbours by count, not bytes; direct RAW scenes 256 MiB in `library-gpu-raw.js` | Needs a byte limit. |
| Camera previews | backend | 64 MB | yes | `library_pictures.py` `_CAMERA_PREVIEW_BYTES`: 64 MiB | Matches. |
| RAW files read ahead | backend | 768 MB (about 12 files) | yes | `library_raw.py` `allowances()`: 1/16 of RAM up to 4 GiB, up to 40 files | Over: 4 GiB on a 64 GB machine. |
| Hand-off between processes (in flight only) | backend / helpers | 256 MB | yes | `library_raw.py`: 1/32 of RAM up to 2 GiB, keeps up to 40 delivered outputs; `library_pictures.py` transient: 256 MiB | Over, and keeps delivered pictures (principle 4). |
| Grade source cache | backend | inside working room | — | `render_cache.py`: 256 MiB source mips | Count it when Grade is open. |
| Working room (photo being developed, Delete planning, Grade import) | all | about 600 MB | no | `app_memory.py` reserves 700 MB to 1.2 GB per source job | Reservation larger than the share. |
| **Total** | | **about 4.0 GB** | | **about 8.4 GB allowed on a 64 GB machine** | |

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

## 7. Current state (October 29, 2026)

**Not built to this budget yet.** The shares in section 4 were agreed on
October 29; the code still uses the older per-cache sizes.

- `library-big-folder` adds `app_memory.py`, which samples the whole process
  tree twice a second, starts reclaiming at 2.4 GB, and admits source jobs
  against the ceiling. It sits on top of the old allowances rather than
  replacing them, so the caches still try to grow to their old sizes.
- Real-folder measurements (D:\Photos, 2560×1440, read-only):
  - Before the big-folder work: 7–11 GB.
  - First big-folder run: 4.027 GB after 327 s, still rising.
  - One later run peaked at 3.931 GB and ended at 2.832 GB.
  - Latest run: 4.233 GB after 255 s. At the peak, the renderer used
    1.127 GB, GPU-process host RAM 1.126 GB, the backend 1.050 GB, Electron
    main 0.337 GB and the helpers 0.324 GB.
- Unexplained: Electron main jumped from 0.13 to 0.90 GB in one run. It holds no
  pictures, so it should stay small. Backend log backpressure was bounded as a
  suspected cause; not proven.
- Measurement method: the total is the sum of each process's working set.
  Memory shared between processes (Chromium shared memory, the backend-helper
  hand-off) may be counted more than once. Choose and document one method
  (for example private bytes plus shared sections counted once) before using
  the total as a pass/fail gate.

Evidence: `codebase/output/big-folder/` (measurement JSON and logs) and the
October 29 sections of [photo-library](photo-library.md).

## 8. Open work

1. Replace the RAM-scaled RAW reader and hand-off allowances with the fixed
   shares in section 4; release delivered hand-off pictures.
2. Give the ready window and direct RAW scenes byte limits.
3. Make every RAM cache report its bytes to one budget owner, with the shares
   above, and size the working-room reservation to its share.
4. Respond to system memory pressure (Windows memory resource notifications;
   macOS memory pressure events) by trimming caches early.
5. Explain or bound the Electron main-process jump.
6. Settle the measurement method (section 7).
7. Validate: the 10-minute D:\Photos scroll levels off below the ceiling, then
   the six Library drivers.

## 9. Rules for agents

- Any change to a size, share or the total is a decision for Steve. Record it
  in section 3 and update section 4 in the same commit as the code.
- A new cache must name its share, its process and what it drops first.
- Report memory per process and in total, using the method in section 7.
- Sources for this approach: darktable's fixed memory presets
  ([memory & performance tuning](https://docs.darktable.org/usermanual/4.8/en/special-topics/mem-performance))
  and Chromium's memory-pressure listener
  ([memory_pressure_listener.h](https://android.googlesource.com/platform/external/chromium_org/+/03339f7/base/memory/memory_pressure_listener.h)).
