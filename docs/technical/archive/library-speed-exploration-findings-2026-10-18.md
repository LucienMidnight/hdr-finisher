# Library speed exploration — findings and bounded follow-up

October 18, 2026. Product code at `364cd6c` on `film-look-rebuild`.
Exploration only: no Library scheduling, decoding, codec, Grade, export or
Proof behaviour was changed. The Fuji DR-only correction preceded this study.
Updated after Steve's bounded follow-up: GPU development map, uncached USB
embedded-JPEG floor and three-photo saved-grade production stages. The requested
measurement work has stopped. Explorer observation was blocked by the computer-use
tool, and the saved-picture display attempt lost the Electron window. Those two
results remain explicitly unqualified; this is not a complete speed qualification.

## Findings that can guide the design now

- All nine known SDR thumbnail failures pass after 8-bit rounding, then fail
  after quality-100, 4:4:4 JPEG encoding. Maximum JPEG quality is still lossy.
- The two HDR failures have different causes. The alley image loses precision
  in its gain map; IMG_0790 loses saturated colours at the codec's nonnegative
  sRGB boundary. A higher JPEG quality setting cannot solve both.
- Matching Grade in Single/full-screen requires Grade's source development
  and full-source measurements. The existing half-size RAW route has different
  demosaic, highlights, colour handling and measurements, and lacks the new
  RAW calibration. Changing only its Exposure defaults is insufficient.
- Current CPU source preparation dominates a new correct thumbnail. A scheduling
  change alone does not close that gap. The GPU-first development map below is a
  separate route to reducing that work, with preliminary estimates rather than
  a qualified two-second claim.
- Cache directory enumeration grows into seconds. Repeated source development,
  competing native thread pools and multiple independent queues deserve a
  joint design before more local speed fixes.

## Evidence and measurement boundaries

**M = measured**, **H = historical measurement**, **E = estimate**, **C = code
inspection**. All new timings below used warm/uncontrolled Windows file cache;
none is claimed as a physical cold USB-HDD measurement. Application caches
were empty at the start of the accepted source/Electron samples. Renderer
warm-up is included or identified explicitly. Percentiles use linear
interpolation; five photos are a small sample, not a folder acceptance run.

The new unbuffered USB probe is the exception to the warm/uncontrolled Windows
cache condition above: it bypasses that cache explicitly; device cache remains
uncontrolled. All GPU port timings below are E, not new measurements or a prototype.

Accepted artefacts in this directory:

- `source-stages.json`, `source-isolated.log`: five sequential RAWs,
  DSC07147–DSC07151, production loader/cache with temporary timing wrappers.
- `gpu-stages.json`, `gpu-isolated.log`, `test-timing-profile/logs/backend.log`:
  five paired production API/GPU routes, DSC07247–DSC07251, 2560 px browse
  versus 640 px Grade-source thumbnails. All ten controlled draws and five
  thumbnail stores completed before the later folder experiment failed.
- `codec-stages.json`: production full-source/default adjustments, reduced
  to 640 px, production CPU finishing and actual thumbnail codec, with losses
  separated at its boundaries. Ten photos cover all nine SDR failures and
  both HDR failures; the alley belongs to both groups. This diagnoses the
  encoding round trip, not a new all-photo GPU agreement qualification.
- `cache-enumeration-original-summary.json`: valid initial disposable cache
  enumeration, five samples at each size. A later probe reused its directory;
  its overwritten `cache-enumeration.json` is excluded because its smaller
  labels no longer represented the actual entry count.
- `file-costs.json`, `file-cost-summary.json`: warm reads and Pillow SDR base
  decode of ten generated JPEGs in this workspace; not Chromium HDR decode.
- `test-saved-profile/logs/backend.log` and its cache metadata: one completed
  saved-grade backend production, on a disposable photo/sidecar copy.
- `embedded-floor-final.json`, `probe-embedded-floor.py`: 70 distinct original
  USB-HDD RAWs; aligned unbuffered TIFF-header and embedded-JPEG reads.
- `kept-final.json`, `kept-final-summary.json`, `kept-three.log`,
  `test-saved-three-profile/logs/backend.log`: three sequential saved-grade
  productions, empty explicit disposable cache, then a failed display attempt.
  `kept-final.log`/`test-saved-final-profile` is a separate first attempt and is
  excluded from the three-photo percentiles.

The first custom Electron/source profiles unexpectedly selected the shared
Library cache: cache isolation depends on the profile differing from APP_DATA_DIR
or containing `test-`. Their cache/build timings are excluded (files named
`*-shared-cache-excluded.json` / `shared-cache-run-excluded.json`). They added
derived entries to that cache; it was not cleared, and photos/saved grades were
not changed. Accepted reruns used explicit throwaway cache settings or `test-`
profiles. This is a measurement-harness issue, not a proposed product change.

The UI folder probes did **not** produce a valid complete-screen timing: listing
was delayed, the observed list changed, and Electron closed during observation.
The canonical-path probe eventually reported 372 RAWs of 427 total pictures,
with 70 visible cells. No zero-picture or partial result is presented as a
70-cell percentile. The earlier saved-picture UI probe closed after its first
backend result. The follow-up completed three productions before attempting
display; production percentiles are now available, on-screen percentiles are not.

## GPU-first full-quality RAW development (priority follow-up)

**C: all six requested image stages are GPU candidates; none requires changing
the intended maths.** Metadata parsing, compressed RAW unpacking and unsupported
camera/DNG cases can initially stay in LibRaw on the CPU. Upload the unpacked
mosaic once, perform highlight repair before demosaic, develop and measure the
full source on the GPU, then reduce it for the Library. Retain a compatible
source/analysis for Grade and saved pictures. Downloading the full developed
source between stages would defeat much of this plan.

### What exists and what must be ported

| Stage | Current Grade CPU work | Existing GPU work | Same-maths port required |
| --- | --- | --- | --- |
| Demosaic | `raw_import._develop_libraw_camera_rgb`: LibRaw full-size AHD request, unity WB, `no_auto_scale`, linear uint16 camera transport | No full-quality sensor demosaic found. `library_raw_decode.py` still performs half-size LINEAR processing on CPU before GPU upload | Port bundled LibRaw's actual Bayer AHD: border interpolation, horizontal/vertical candidates, camera Lab conversion, homogeneity maps and selection/tie average. Preserve integer shifts, clipping, tile halos and rounding. LibRaw may dispatch another algorithm for X-Trans; retain its existing route until that actual algorithm is ported too. |
| Highlight reconstruction | `_apply_raw_highlight_reconstruction`: per-CFA black/white normalisation, WB thresholds, opposed-colour repair before demosaic | Quick GPU route only neutralises clipped output pixels. That is a different operation and cannot substitute for repair | Port the float mosaic, clipping mask/counts, coarse mask/dilation, 3×3 opposing-channel means in cube-root space, nearby residual statistics and repair. Preserve the >100-sample reliability gate and original uint16 re-encoding before AHD. Start with CPU final reduction of small residual totals, or qualified compensated sums, because the current sum is float64. |
| Camera RGB development | `_normalize_camera_rgb_float32`, `_camera_rgb_to_acescg_float32`: existing transport scale, as-shot WB and camera→ACEScg matrix | `library-raw-gpu.js` has a matrix/threshold path fed by half-size camera RGB | Reuse the kernel pattern and metadata, not the whole quick recipe. Apply the full-quality transport normalisation and WB/matrix at full resolution, with the same orientation/crop. Keep the fixed −0.8 EV calibration and recorded Fuji DR-only brightness once, at the existing stage. |
| Import gamut handling | `map_import_negative` / `color.map_negative_acescg`: finite sanitisation, signed AP1 contraction toward its max-channel neutral axis, black when no positive channel | Quick browse's vertical kernel contains a related negative-channel projection | Separate a full-resolution pass after colour/lens operations and before analysis/reduction. Quick browse currently shrinks before this nonlinear operation; that order cannot be used for Grade. Preserve finite/nonnegative pass-through. CPU uses float64 for extreme spans; rescale arithmetic or use an exceptional CPU path to preserve the result without introducing overflow. |
| Full-source HDR analysis | `analysis.classify_hdr`: exact channel/luma/BT.2020 maxima; three robust 0.9999 quantiles on the existing bounded stride sample | `webgpu-preview.js`/`webgpu-shaders.js` already reduce tone-adjusted peaks and a log histogram for Grade's highlight anchor | Reuse reduction infrastructure but add import-specific coefficients, exact maxima, sample locations and quantile interpolation. Existing tone histogram is not the same statistic. GPU gather plus exact selection/sort, or read back the same bounded sample for CPU quantiles, preserves the maths. Metadata classification/badge text stays CPU. |
| Reduction | `library_pictures.reduce_picture`: per-channel Pillow float BILINEAR, same dimensions/rounding | `library-raw-gpu.js`: two-pass triangular shrink with widened support | Reuse the separable design, match Pillow's centres, support, edge normalisation and rounding. Run only after full-source gamut/calibration/analysis. Ordinary four-tap bilinear sampling or a mip approximation is not equivalent when shrinking 42 MP to 640 px. |

C: the relevant LibRaw reference is the bundled **0.22.1**, whose
[AHD implementation](https://raw.githubusercontent.com/LibRaw/LibRaw/0.22.1/src/demosaic/ahd_demosaic.cpp)
contains the candidate, Lab/homogeneity and combine passes. This is an algorithm
port, not an API switch: rawpy cannot delegate its existing AHD to WebGPU.
The [WGSL scalar types](https://www.w3.org/TR/WGSL/#scalar-types) provide f32
and optional f16 rather than native f64, which matters for the two CPU float64
uses noted above. Retain the existing perceptual limits; do not demand pixel
identity or quietly replace the statistics with a coarser histogram.

### Rough 42 MP GPU timings — estimates, not measurements

**E: planning ranges for this machine's RTX 4070 Ti, one 7968×5320 Bayer RAW,
warm pipelines, one job, GPU-resident source.** No GPU development prototype was
built, and no full-quality GPU/CPU agreement is claimed. These are intentionally
broad engineering estimates; implementation/tiling could move them by a factor
of two or more. They exclude device creation, shader compilation, disk read,
RAW unpack, input upload, lens/mandatory DNG operations, creative rendering,
readback of finished pictures, JPEG encoding and cache publication.

| Stage | Estimated elapsed ms per RAW | Basis / largest uncertainty |
| --- | ---: | --- |
| Full-size Bayer AHD | 180–800 | Multi-pass neighbourhood work and candidate/Lab scratch; roughly 10–35 GB aggregate traffic depending on tiling. Branches, halos and integer semantics dominate risk. |
| Opposed highlights | 10–150 | Scan/masks, dilation, neighbourhood repair and small reductions; low end few/no clipped sites, upper end substantial highlight regions. Not an all-cameras worst-case bound. |
| Camera normalisation + WB/matrix | 8–35 | About 1–1.4 GB read/write traffic in a full-resolution RGB/RGBA pass; can combine compatible per-pixel operations. |
| Import gamut + calibration | 10–40 | Another full-frame pass; finite/extreme-value handling and preserving the original operation order. |
| Full-source HDR analysis | 20–120 | Parallel full-frame maxima plus exact existing ~1.7 M-location sample (stride 5 at 42 MP), including small-result/sample transfer and CPU quantile option. |
| Reduction to 640 px | 5–30 | Full source read plus small horizontal/vertical intermediates; preserve widened support. A 2560 px result has larger intermediates and may cost more. |
| Six-stage subtotal | **233–1175** | Arithmetic sum of estimates, not a measured pipeline or percentile. |

E: these traffic estimates use a deliberately conservative **50–150 GB/s
effective** bandwidth assumption for application kernels, not advertised peak
hardware throughput. Simple-pass lower bounds are traffic/bandwidth with room
for dispatch and arithmetic. AHD adds substantially more stencil/branch work.
The earlier measured quick route took ~136 ms median to fetch/copy/upload its
~60.6 MiB half-size transport, and ~160 ms median to reach conversion-ready,
including that upload; those are useful overhead warnings, not full-quality stage
benchmarks. Do not scale the existing 640 px creative draw to estimate AHD.

E: allow a further **100–400 ms** for full-mosaic IPC/upload on the current
style of transport. Initial CPU file/metadata/unpack is provisionally
**0.3–1.2 s with warm OS data**, based on the existing decoder observations,
not a new isolated full-quality unpack measurement. That gives a broad
**~0.63–2.78 s** source-to-reduced-picture planning envelope before excluded
lens/creative/encode/cache work. Physical cold full-RAW I/O is additional and
must not be inferred from the embedded-JPEG probe. This is enough reason to
prototype the GPU route; it is not a promise that a cold grid meets two seconds.

### Integration and agreement constraints

- Preserve the sequence: file information/unpack → highlight repair → actual
  demosaic → camera development → existing lens/DNG operations → import gamut
  → calibration → full-source analysis → reduction. Preserve exactly-once
  DNG BaselineExposure and Fuji recorded DR; no hidden curve or auto brightness.
- Keep a float32 full-quality working representation. Existing half-float
  display textures are useful outputs, not automatic proof that early f16
  demosaic/highlight intermediates retain the intended result. Tile around
  actual adapter buffer-binding limits with proper halos; the current quick
  route rejects oversized single buffers. This is an architectural requirement,
  not the deferred peak-memory study.
- CPU lens metadata/coordinate generation can remain; applying identical lens
  maps is a GPU resampling candidate. Mandatory DNG opcodes, special matrices,
  non-Bayer dispatch and unsupported cameras need explicit support or the
  existing full-quality CPU fallback. Their costs are outside the table.
- Judge finished SDR by existing ΔE2000 mean <1 / p99.9 ≤3, and HDR by existing
  ΔEITP mean <1 / p99.9 ≤3. Keep the highlight ceiling as separately required.
  Test textured edges, borders, clipped colours, negative gamut and supported
  sensors, including comparisons before the known lossy thumbnail JPEG step.
- First useful port: move full-size camera development, gamut, analysis and
  reduction together, keeping LibRaw AHD/highlight repair on CPU initially.
  This avoids a full CPU download between those ports. Then port CFA highlights
  and demosaic together so repaired mosaic does not shuttle back into LibRaw.
  Their CPU import cost does not disappear until those ports are implemented.
- Saved-grade Denoise, creative work and the existing CPU gain-map encoder
  remain separate costs. A faster RAW import alone does not establish the
  one-second saved-picture target.

## 1. Map of picture work (C)

| Work | Asker and execution | Waiting, priority, cancellation and competition |
| --- | --- | --- |
| Camera JPEG placeholder | Grid/filmstrip miss; backend request thread opens RAF/RAW metadata, extracts JPEG, resizes and returns a data URL | Frontend picture request queue; priority 5. No demosaic. HTTP abort prevents presentation; native extraction is not preempted mid-call. Shares disk/CPU with other work. |
| Correct unedited RAW thumbnail | Grid/filmstrip asks `purpose: thumbnail`; helper picture lane calls Grade loader, full analysis, then reduces to 640 px | Frontend ranked queue has four slots; helper has six picture lanes. Grade/import/export pause gate; queued requests cancel on scroll. Six full-source developments can compete for CPU/RAM and native threads. |
| Visible GPU picture | Library renderer uploads float16 scene NPZ transport and uses shared creative shaders | One frontend GPU promise queue. Current-selection checks discard stale results. Shares physical GPU with Grade, Proof/export delivery and other windows. |
| Kept thumbnail file | After visible draw, capture its finished pixels, render opposite HDR/SDR lane, read back, POST and encode | Separate frontend cache promise queue waits for visible work; joins GPU queue for second render. Backend in-process JPEG/gain-map encode, atomic store, cache trim. Does not decode RAW again. |
| Cached thumbnail display | Batch ticket requests, async native Image decode, cell image and recent pool | Thumbnail batch/polling queue, bounded 512 MiB estimated recent pool. Scroll cancels pending entries; completed neighbouring cells can remain. Native Chromium display avoids creative rerender. |
| Saved-grade picture | Desired-grade durable queue; helper opens SessionStore, reduces corrected source; hidden delivery renderer makes HDR+SDR; existing export encoder writes 2560 px kept picture | Two kept lanes/two jobs in flight, one shared GPU delivery queue. Visible work and Grade pause/yield gates. Existing eligible open-Grade source reuse is special-case; reopening remains common. |
| Exposure/focus maps | Library overlay controls; helper kept lane, separate map cache | Exposure reads original sensor values without demosaic; focus separately decodes quick/native source. Cancel checks and helper yielding; no common decoded-source cache with thumbnail/Grade. |
| Single/full-screen fit | Library selection and read-ahead plan; backend RAW reader plus three decoder processes, GPU shrink/conversion and creative draw | One RAW reader, selected-photo reserved decoder lane plus two read-ahead lanes. Native decoder threads set to one. Selected request can promote a process; stale queued read-ahead cancels; already-running useful work finishes. |
| Native zoom | Single viewport asks helper `native` picture; helper retains one native source and serves crops | Helper picture lanes; separate source/cache from quick fit and Grade. A fit picture is not a guarantee of native-view Grade agreement. |
| Index/check/metadata | Folder opening, pinned folders, explicit checks and background polling | Separate main, index and check lanes; foreground counter/yield gates; database and metadata work can contend with picture requests. |
| Grade / export / Proof | Main backend sessions and delivery renderer | They outrank background Library jobs, but process priority alone does not allocate a shared CPU/GPU budget. Export fairness is already implemented; do not undo it. |

Code anchors: `library_api.py`, `library_worker.py`, `library_raw.py`,
`library_raw_decode.py`, `library_pictures.py`, `library_kept.py`,
`library_picture_queue.py`, `library_overlays.py`; frontend
`photo-library.js`, `library-request-queue.js`, `library-gpu.js`,
`library-raw-gpu.js`, `library-thumbnails.js`.

## 2. Stage timings

M: standalone production Grade-source thumbnail, first five badminton RAWs,
empty isolated cache. These are wall times. Nested rows must not be added.
CPU attribution describes the executing code; hardware utilisation counters
were not recorded. Disk/CPU overlap inside LibRaw is not separated.

| Stage | Median ms | p90 ms | Activity / boundary |
| --- | ---: | ---: | --- |
| Camera JPEG extraction + resize | 25.3 | 40.0 | CPU + file reads; no RAW unpack/demosaic |
| RAW metadata inspection | 0.9 | 19.6 | File/CPU |
| RAW execute, inclusive | 2597.3 | 3027.3 | File open/unpack, reconstruction, demosaic and diagnostics |
| Highlight reconstruction, nested | 340.4 | 591.9 | CPU |
| Camera RGB development, nested | 1242.7 | 1357.9 | CPU/native LibRaw |
| RAW corrections, inclusive | 643.7 | 829.3 | CPU colour/correction work |
| Lensfun call, nested | 0.12 | 59.0 | These default-start photos do not demonstrate expensive saved lens corrections |
| Import gamut handling | 1136.3 | 1308.0 | CPU, full source |
| Fixed RAW calibration | 21.8 | 25.3 | CPU, full source |
| Full-source HDR analysis | 945.4 | 1070.7 | CPU |
| Loader total | 5263.2 | 6261.2 | Inclusive above |
| Reduction to thumbnail | 411.5 | 444.4 | CPU |
| Build including NPZ/cache bookkeeping | 5741.3 | 7093.8 | No helper queue or GPU draw |
| Existing NPZ metadata lookup | 12.5 | 14.9 | Warm cache file read; not a finished on-screen image |

M: paired production Electron requests, second five badminton RAWs. Empty
throwaway application cache, same file read by quick route before Grade route;
OS cache warm/uncontrolled. These are a different photo/process sample from
the table above and must not be subtracted from it to infer a bottleneck.

| Stage | Median ms | p90 ms |
| --- | ---: | ---: |
| Camera preview request + image decode before thumbnail | 38.0 | 40.0 |
| Quick Single fit metadata/source request | 395.2 | 501.5 |
| Quick fit GPU show, all five including first warm-up | 233.9 | 3098.4 |
| Quick fit GPU show, four after warm-up | 230.4 | 244.7 |
| Grade-source thumbnail request | 10012.6 | 12348.3 |
| Grade-source thumbnail GPU show + capture | 61.7 | 71.0 |
| Opposite-lane render/readback + encode/store request | 294.5 | 406.8 |
| Thumbnail total, including preview and keeping file | 10394.7 | 12862.1 |

M: controlled frontend draw dispatch waiting was median 0 ms / p90 0.1 ms.
The helper's mixed-operation queue sample was median 0.5 ms / p90 2.0 ms;
this is a sequential probe, **not** evidence that the loaded grid has no queue
problem. Recorded 640 px NPZ pixel fetches were median 30.7 ms / p90 46.9 ms
(ten lane fetches). Backend NPZ/store bookkeeping was median 90.4 ms /
p90 182.2 ms (five). Exact thumbnail readback/encoding/write subdivisions
remain to be instrumented in the actual backend path. The offline codec-only
samples took roughly 55–90 ms, with different photos/finished pixels.

M: one completed saved-grade backend job, DSC07314, cold delivery renderer,
isolated cache and disposable source/sidecar copy: source **7.66 s**, render
bucket **22.53 s**, encoder **3.28 s**, total **33.61 s**. No p90 from one job.
The GPU diagnostic within that bucket reports setup 0.903 s, source transport
2.657 s, Denoise 3.220 s, creative 5.085 s, finishing 1.021 s, readback
0.381 s and encoder handoff 6.464 s. Those sum within the renderer record;
do not add them again to the total. They are wall-clock stages, not GPU busy
counter durations. The window closed after the first result, so the attempted
three-photo on-screen run is unqualified.

H: the earlier saved-picture study measured 20.9–48.8 s on three photos,
with cold warm-up and other activity; `codebase/output/library-saved-picture-speed/
baseline/timings.json` is useful stage evidence, not an idle performance target.

### Follow-up: three-photo idle saved-grade production

M: DSC07314, DSC07320 and DSC07321, sequential requests with 1.5 s between
completed pictures; no foreground Grade editing/export/Proof or loaded-grid
probe. Sources and saved grades were disposable copies on D:, the same USB
volume; originals were read-only. `test-saved-three-profile` explicitly points
to its own initially empty cache. OS file cache was warm/uncontrolled. All three
used the production **GPU renderer, no CPU fallback**. The first includes cold
delivery-renderer/pipeline warm-up; later pictures reuse that renderer. Saved
crops differ, so their developed dimensions differ from the uncropped 42 MP RAW.

| Photo | Source ms | Render bucket ms | Encoder ms | Production total ms | Request→ready ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| DSC07314 | 8147.0 | 22307.7 | 2535.0 | 33139.8 | 34767.2 |
| DSC07320 | 6760.3 | 7721.5 | 1783.1 | 16271.4 | 16750.0 |
| DSC07321 | 8227.6 | 6514.7 | 2750.1 | 17500.4 | 17829.3 |
| **Median** | **8147.0** | **7721.5** | **2535.0** | **17500.4** | **17829.3** |
| **p90** | **8211.5** | **19390.5** | **2707.0** | **30011.9** | **31379.6** |

M: render-bucket subdivisions from `gpu_delivery_rendered`, **wall-clock stage
timings**, not hardware GPU timestamps. These are nested in the render bucket;
do not add them to source/render/encoder totals. Small discrepancies between
GPU diagnostic sums and bucket totals are bridge/wait overhead and rounding.

| Delivery renderer subdivision | Median ms | p90 ms |
| --- | ---: | ---: |
| Renderer setup | 4.6 | 587.9 |
| Source preparation/transport | 1584.7 | 2529.7 |
| Denoise preparation/render | 1938.2 | 3037.3 |
| Creative passes | 565.9 | 4101.3 |
| Finishing | 967.0 | 1146.2 |
| Readback | 338.6 | 368.7 |
| Handoff | 2899.6 | 5521.3 |
| Diagnostic renderer total | 7381.0 | 17113.0 |

The two later productions took 16.27 and 17.50 s (median 16.89 s); n=2 is
too small for a useful general warm-renderer p90. Source already costs ~8 s,
but it is not the only gap: Denoise, transport, handoff and encoding remain
material. No per-photo algorithm shortcut or speed fix was made.

**Display limitation:** all three metadata/files were recorded before the
first `HDRLibraryPictures.show` attempt. That attempt lost the Electron
window again. Therefore these are complete **production** percentiles,
not save-to-on-screen percentiles and not a pass against the one-second
on-screen requirement. The error is retained in `kept-final.json`; do not
silently count a produced file as an accepted display. No extra retries or
unrelated application fixes were made after this bounded run.

## 3. USB embedded-JPEG floor and Explorer comparison

M: D: was verified through `Get-Partition -DriveLetter D | Get-Disk` as
**TerraMas TDAS, USB, 12 TB**. The follow-up reads 70 distinct RAWs from the
original `D:\Photos\2026\20261017 badminton` folder, fixed random order
(seed 20261018), one sequential probe and no GPU timing run overlapped.

**Cache-state method:** Win32 `CreateFileW` with `FILE_FLAG_NO_BUFFERING`,
4096-aligned `VirtualAlloc` storage, aligned offsets/lengths, and `ReadFile`.
For each photo, open it, read 64 KiB of TIFF header, parse its full embedded
JPEG offset/length, then read that aligned JPEG extent. Decode the resulting
JPEG in memory, apply EXIF transpose, convert/resize to 640 px and encode a
quality-90 placeholder, matching the preview's image operations. No source,
grade or user cache was changed; no system-wide cache purge/reboot was used.
Windows data-cache bypass is enforced by the file handle. Drive/controller
cache and cached filesystem metadata remain uncontrolled, so this is **OS
data-cache-bypassed**, not a claim that every read physically missed the HDD's
firmware cache. Header parsing is a small Sony-specific probe, not LibRaw's
complete camera parser or an end-to-end Library request.

| 70-photo floor | Median | p90 |
| --- | ---: | ---: |
| Embedded JPEG size | 391477 bytes | 451732 bytes |
| Open + TIFF header + JPEG read | **28.63 ms** | **51.71 ms** |
| JPEG decode, resize and placeholder encode | **24.59 ms** | **27.40 ms** |
| Combined serial per-photo floor | **53.72 ms** | **78.68 ms** |

M/E: 70×the measured median is ~3.76 s of serial work, an illustrative
calculation rather than whole-screen timing or a prediction for parallel
Explorer. UI scheduling, folder listing, native thumbnail caches and device
seek concurrency can change the result. The earlier warm production preview
samples were 25–40 ms; they use a different parser/request boundary and must
not be subtracted to isolate physical disk time.

**Actual Explorer comparison remains blocked, not estimated.** The computer-use
connection failed before any UI observation on two attempts and once more
after resetting its JavaScript kernel:
`failed to launch codex app-server: The system cannot find the file specified.
(os error 2)`. No Explorer navigation or thumbnail-cache clearing occurred.
There is no defensible Explorer first/last-thumbnail time or cold/warm ratio
to report. The USB floor above must not be labelled Explorer performance.
To complete this one remaining comparison, observe Explorer on this same folder
and view size, explicitly report existing shell-thumbnail cache versus a new
cache and OS data-cache state, and time navigation through visible-thumbnail
completion. It was not substituted with Shell extraction or guessed numbers.

C/E: a real correct thumbnail needs one Grade-equivalent development and
full-source measurement unless matching work already exists. Reusing the
camera JPEG as the final thumbnail changes the look. Saved-grade output also
needs the saved source interpretation, lens corrections, full-source analysis,
enabled Denoise, creative work and both renditions; an eligible existing Grade
source can remove redevelopment. The one-second target therefore depends on
reuse/preparation or a separately qualified faster pipeline, not queue priority
alone. No replacement decoder or Denoise shortcut is adopted here.

## 4. Repeated work and caches (C)

Opening one RAW in the grid and then Single currently develops it twice:
once fully for Grade-source thumbnail, once in the independent half-size
read-ahead route. Opening Grade can develop it again. A saved-grade picture
can reopen it yet again; an open compatible Grade source can already be handed
to that producer. Exposure maps read sensor data again; focus maps have another
decode. Cache hits can eliminate some visits, so these are opportunities on a
cold traversal, not a fixed per-photo read count.

Independent representations include raw file bytes in backend shared-memory
LRU; half-size camera uint16 transport; GPU fit/thumbnail textures; tiny RAW
scene NPZ; Grade-source float16 NPZ; rendered JPEG/gain-map thumbnail;
2560 px saved-grade pictures; Grade source/mip caches; and overlay maps.
They have different identities, ownership and eviction rules. Rendered HDR/SDR
thumbnail lanes reuse the source and do not themselves cause another RAW decode.

E: 7968×5320 RGB float32 source = **485 MiB** before scratch arrays; six such
sources alone are **2.84 GiB**. Half-size RGB uint16 transport is about **60.6
MiB** per RAW. A 2560×1709 RGBA16F fit texture is about **33.4 MiB** per lane.
These are dimensions×bytes calculations, not process peak-memory measurements.
Sharing source work needs an immutable key including source identity, RAW/lens
settings, interpretation, white normalisation and calibration version, plus
owner lifetimes and bounded memory. Filename-only sharing would be incorrect.

## 5. Why old full-folder failures are plausible, and what is still unproved

H: the brief's 3.66 s preview / 21.24 s real-thumbnail p90 and unfinished
60-second run predate the Grade-source thumbnail route. They are not a current
speed qualification.

C: the quick RAW transport store evicts FIFO outputs beyond 40 items or its
RAM-derived byte budget (at most 2 GiB). At roughly 60.6 MiB each, the byte
limit can be reached before 40 outputs. Metadata/HTTP requests and the one
frontend GPU queue have separate lifetimes. A queued GPU draw can therefore
refer to output already evicted; `/raw-transport` returns 404, or the tiny
thumbnail save returns 409 after output release. The message describes that
lifetime race, not a slow demosaic operation. It wastes work when a picture
must be requested again. No event-to-retry duration is qualified here.

The current Grade-source grid route uses small disk NPZ instead of those
short-lived camera transports; Single/read-ahead still uses the quick route.
Its bottlenecks must be measured separately. New full-folder probes were
invalid as described above. Investigation of listing/reconciliation delay and
a clean 70-cell run remains open; no unrelated UI repair was attempted.

## 6. Six speed-plan leftovers

| Item | Current evidence | What a design change touches |
| --- | --- | --- |
| One ranked helper queue | C: six picture, two kept, one thumbnail, main/index/check lanes plus separate RAW processes. M: near-zero queue in sequential sample only. Loaded-lane opportunity cost unmeasured. | Worker dispatch, byte/native-thread budgets, pause/yield rules, durable queue and cancellation; a global FIFO would lose selected-photo priority. |
| Priority follows user | C: selected RAW request promotes its process; helper pending browse requests can be promoted. Already-running native decode is not generally preempted. M: no selected-under-export stress percentile yet. | Shared foreground/Grade/export state and priority propagation; avoid starvation and resource ownership races. |
| Warm GPU at launch | M: first quick show 5.00 s versus 0.23 s warm median; setup object only 0.118 s, so setup alone is not all cold work. Other native/import/resource effects are included. | Visible and hidden renderer startup/pipeline preparation. E: several seconds of first-use delay could move to idle launch, not disappear. |
| No scope analysis on Library draws | C: visible 640 px draw and opposite rendition capture finished pixels through scope readback. Those readbacks currently supply encoded thumbnails. M: independent removable scope-only cost not isolated. | Renderer capture interface; removing all analysis blindly would stop thumbnail saving. Preserve required pixel capture and highlight measurements. |
| Running cache size total | M: disposable warm enumeration median/p90 17/20 ms at 70 entries, 197/199 ms at 1000, 2191/2291 ms at 5000. Each publication can trim/list again. | Managed cache accounting, grouped eviction, atomic publication, external-deletion recovery and preferences display. E: avoids repeated O(entry count) scans; exact end-to-end gain depends on cache size. |
| Show window before backend ready | M: one launch app start→backend ready 7.26 s, then window creation 0.071 s later. C: startBackend is awaited before createWindow. | Desktop boot shell, ready/error/closing states; no backend-dependent controls until ready. E: shell could appear during most backend wait, without making pictures ready sooner. |

## 7. Thumbnail file size

M: ten actual generated 640 px JPEG/gain-map files have median **710,668 B**,
p90 **857,770 B**. Warm workspace-file reads: **0.42/0.78 ms** median/p90;
Pillow SDR-primary decode **4.84/6.17 ms**. This excludes HTTP, Chromium gain-map
decode, texture upload, queue wait and scanout. No cold-disk or full HDR-native
decode estimate is smuggled into these figures.

E: 70 files at the observed median hold about **47.4 MiB encoded**. Separate
decoded/GPU allocations grow with pixel count, not simply file length. C:
the recent pool accounts six bytes per pixel plus data-URL storage and has a
512 MiB budget. Its accounting is an estimate; current process residency was
not remeasured. Smaller files alone would not remove seconds of development
or repeated cache enumeration. No pixels or codec settings were changed.

## 8. Why the kept files miss Grade agreement

Agreed limits stay mean <1, p99.9 ≤3, SDR CIEDE2000 / HDR ΔE ITP on finished
pixels. Earlier full-source→float16 scene-cache measurements passed on all
16 photos; these encoding probes isolate what happens afterwards.

M: the nine SDR failures all have zero clipping error and pass after 8-bit
sRGB rounding. Their p99.9 after rounding spans **0.84–0.96**, then **3.02–3.61**
after JPEG. Means remain below 1. The extra loss includes JPEG colour conversion,
DCT/quantisation/rounding; the probe does not attribute each internal JPEG step
separately. Subsampling is already disabled. It is not a wrong RAW calibration.

| SDR photo | 8-bit only p99.9 | JPEG quality 100 p99.9 |
| --- | ---: | ---: |
| DSC07147 | 0.962 | 3.555 |
| DSC07333 | 0.845 | 3.053 |
| DSC_3931 | 0.870 | 3.020 |
| 2025_0730_1331_3 | 0.883 | 3.141 |
| DSC00636 | 0.917 | 3.161 |
| 2L1B8631 | 0.839 | 3.073 |
| IMG_3129 | 0.885 | 3.605 |
| P6200170 | 0.918 | 3.250 |
| DSC08360 | 0.957 | 3.514 |

M: HDR stage p99.9 values:

| Photo | Clip negative sRGB only | 8-bit gain values, no gain JPEG | Gain JPEG before peak guard | Final codec |
| --- | ---: | ---: | ---: | ---: |
| 2025_0730_1331_3 alley | 1.581 | 3.143 | 10.166 | 10.166 |
| IMG_0790 fire/saturated lights | 21.298 | 21.301 | 21.336 | 21.336 |

The alley has a **6.40 EV** RGB gain range mapped to 256 levels. Rounding
alone crosses the percentile limit; JPEG adds substantial error (final mean
1.787). IMG_0790 has negative linear-sRGB channels in **6.88%** of pixels;
the codec clips them before gain computation, losing representable ACEScg
colours (final mean 1.423). The peak guard makes only a small difference in
these two examples; disabling it is neither justified nor proposed.

C/E: investigate a representation preserving the required gamut and precision,
with lossless SDR where needed. Reusing the already-agreeing float16 scene or
finished HDR pixels is an option, but may require GPU presentation instead of
native gain-map Image display and changes memory/transport/decode costs.
No codec choice or relaxed limit is approved by this exploration.

## 9. Single/full-screen matching and its cost

C: use Grade's full-quality source development, selected lens/raw settings,
highlight reconstruction and import gamut handling; apply −0.8 EV and confirmed
Fuji DR metadata exactly once; derive defaults from full-source analysis;
then reduce for fit and render the same visible controls. Full-screen uses
the same fit path; it does not need another independent decoder. Native zoom
and saved-grade caching also need consistent interpretation/identity.

M: on the five paired files the Grade-source request cost exceeds the quick
request by median **9.61 s**, p90 **11.89 s**. E: this is the source-work cost
to expect if simply routing cold Single through the present Grade-thumbnail
mechanism, **not a measured new Single implementation**. A 2560 px result
would add its reduction/transport/render costs. Current quick browse totals
median 0.67 s with warm file cache; its first GPU show alone took 5.00 s.
Earlier five-photo measurements showed a smaller ~4.09 s median increase;
different photos/process/cache conditions explain why one number must not be
advertised as universal. Full cold Single needs a controlled measurement.

E/C: retain a shared correct full source or prepared mip and full-analysis state
to avoid paying this again after a thumbnail/Grade visit; fit texture reuse
could keep revisits near existing GPU costs. Budget roughly 485 MiB per full
42 MP RGB float32 source before scratch space, versus 60.6 MiB half-size camera
transport. Memory limits and cancellation must be designed before increasing
read-ahead. No Single/full-screen behaviour changed in this task.

## Three recommendations for Claude to assess

1. **Prototype full-quality GPU development with shared source ownership.**
   Start with the full-size colour/gamut/analysis/reduction group, then the
   coupled CFA highlights/demosaic group described above. Reuse the resulting
   compatible source/analysis/mips across thumbnails, Single and saved pictures
   under a bounded scheduler. E: six image stages provisionally 0.23–1.18 s
   GPU-resident, excluding file/unpack/upload and other listed costs; this is
   not measured acceptance. Reuse can additionally avoid a measured 5–10+
   second CPU preparation on a subsequent visit today. Risks: integer/border
   semantics, precision, unsupported sensors/DNG, stale colour/settings, source
   lifetime and starving Grade. Touches import/GPU source ownership, loader
   users, worker/RAW pools, kept source handoff and transport. Preserve the
   algorithms and existing perceptual limits; CPU remains the fallback.
2. **Schedule first feedback and cache work together.** Prioritise embedded
   previews and selected work, bound simultaneous full-source developments,
   separate required capture from optional scope work, warm renderers during
   idle startup, and replace repeated cache scans with accounted totals.
   E: can recover seconds at large caches and first GPU use; warm preview floor
   is tens of milliseconds per photo, not a guarantee of one-second whole-screen
   display. Touches frontend queues, helper budgets, cache manager and desktop
   lifecycle. Risks: queue starvation, eviction races and incorrect accounting.
3. **Choose an accurate kept-picture representation before shrinking it.**
   Resolve the measured JPEG and gamut losses inside existing limits; benchmark
   the chosen format's native/GPU display cost, then decide compression/size.
   E: this closes an accuracy gap, not an established speed gain. Quality 100
   cannot close it. Touches Library codec/reconstruction/presentation and cache
   versions; export/Proof encoding stays separate. Risks: larger files, slower
   decoding and losing direct native HDR display.

## Stop point and explicitly unqualified results

Steve asked for this bounded follow-up, then a stop. It is now stopped. The
GPU map/estimated stage ranges, OS-cache-bypassed embedded floor and three-photo
idle production percentiles are recorded. Actual Explorer display is blocked
by the computer-use launch failure; saved-picture on-screen acceptance remains
blocked by the Electron window loss. No result is invented for either one.

The clean 70-visible-RAW/cached-launch qualification from the original brief
also remains unmeasured. **Loaded-grid utilisation and peak-memory studies
were skipped at Steve's request.** Do not treat the dimension-based memory
calculations or sequential queue samples as substitutes. No more measurement
runs, implementation, decoder/codec changes or application-crash investigation
are part of this continuation. The brief remains active with those limitations
so unqualified work is not archived as completed acceptance.

The continuation's two isolated Electron launches plus USB probe used roughly
four minutes of slow measurement runtime, below the 30-minute ceiling (and
still below it together with the earlier checkpoint's slow runs). No GPU runs
overlapped. No broad validation sweep was repeated: product code is unchanged;
the preceding Fuji fast checks remain 534 JavaScript passed and 2297 Python
passed, 3 skipped. Probe summaries/dimensions and documentation diff were
checked; originals and protected grades were not written.

## Plain-language summary for Steve

Grade's six RAW image stages can move to the GPU while keeping their maths.
The quick browse route already has colour/shrink kernels, but lacks Grade's
full-quality demosaic, highlight repair and complete import measurements.
The six-stage GPU estimate is 0.23–1.18 seconds for 42 MP, before file read,
unpack, upload and other work; it needs a prototype before making a promise.
Reading and preparing an embedded preview with Windows' data cache bypassed
took 54 ms median / 79 ms p90 per photo on the USB HDD.
Three saved-grade productions took 17.5 seconds median / 30.0 seconds p90;
the first warmed the renderer, and source/transport/encoding still cost seconds.
Explorer observation was unavailable and saved-picture display lost the window,
so neither on-screen target is claimed. Behaviour is unchanged; work is stopped.
