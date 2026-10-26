# Stored screen previews and cold original decoding — October 26, 2026

Offline Part B experiment for the [Library threads/codecs brief](../archive/briefs/codex-brief-library-threads-and-codecs-2026-10-25.md). Measured app revision: `5f846b5` (Library Film Look stock-table fix). No application integration or import-rule change.

## Decision

Recommend **tiled AVIF q100 for HDR plus a separate lossless authored-SDR PNG** for the next stored-screen-preview vertical slice: PQ10, BT.2100/CICP 9/16/9, YUV444, speed 8, 8 tiles (`tilelog2=(1,2)` in imagecodecs), 12 threads on this machine; SDR sRGB8, PNG level 3. Store interpretation explicitly in the cache contract. Decode only the selected rendition and decode a bidirectional window ahead. This is a proposed direction, not a built storage change.

Across 19 real finished pictures the pair averages **12.12 MiB**, about **844 photos per 10 GiB**; median pair encode **437 ms**, HDR decode **75.4 ms** at 12 threads and SDR decode **38.0 ms**. Both renditions pass the guide on every picture. The untiled AVIF100 result is much slower: HDR about 306 ms and its separate SDR12 AVIF about 710 ms. Requesting 12 threads alone does not make an untiled still scale.

Keep **lossless PQ16 BT.2100 HDR JXL + lossless sRGB8 SDR JXL**, effort 3 / decoding-speed 1 / 12 threads, as the precision-first alternative: **20.94 MiB**, **489 photos/10 GiB**, **213 ms** encode, **62.7 / 56.7 ms** HDR/SDR decode. Its HDR error is far smaller; the AVIF/PNG pair uses about 42% less storage. The sRGB16 JXL pair improves SDR quantization but grows to 33.19 MiB. Lossless half-float remains the exact reference (41.06 MiB/pair), not the proposed persistent tier.

Reject the measured q90/q95 settings for storage: none passes both renditions across all photos, despite appealing sizes and speed. AVIF99 with a lossless SDR companion also fails; nearly lossless JXL distance 0.004 is insufficient for HDR. Ultra HDR's tiny combined file and fast SDR base are useful trade-offs, but neither higher JPEG base quality nor the wider-gamut map makes these tested settings meet the agreed guide. No gain-map format is selected merely for combining both views.

No format is fully qualified for storage yet: the actual Library reference pictures include uncapped HDR output, and Steve's visual grain judgment remains pending. The recommendation is a measured direction for a subsequent vertical slice, not permission to change rendering, export, Proof or import accuracy.

## What was measured

- Windows, Ryzen 5 7600 (6 cores / 12 logical CPUs), RTX 4070 Ti; Python 3.12, imagecodecs 2026.8.16, libultrahdr 2.0.2, libavif 1.4.2, libjxl 0.12.0, libjpeg-turbo 3.2.0. The small original-AVIF memory probe uses the already-local libavif 1.4.1 build and its AOM decoder. This distinction matters when comparing its speed or pixels with the installed binding.
- Nineteen distinct RAW sources: the existing 16-source comparison manifest already contains alley (`2025_0730_1331_3.arw`) and wide-gamut `IMG_0790.CR2`; add graded `DSC07202`, `DSC07178`, `DSC07217`. Only the latter three copied sidecars are loaded. They enable Denoise, Portra 400 grain (amount 24, size 30, softness 25) and halation in both renditions. Fixed grain seed 271828.
- Captured the real Library GPU finished pixels at 2560 px Fit, before monitor encoding, including Film Look after `5f846b5`: scene-linear ACEScg HDR and display-linear sRGB authored SDR. Reference white 203 nits. No CPU-rendered export or camera JPEG stands in for these pictures. The stored reference is the captured RGB half-float data.
- In-process encode/decode only for candidate previews. Encode uses all 12 logical CPUs where an API exposes jobs. AVIF/JXL decode uses explicit 1, 4 and 12 threads. Ultra HDR and Zstandard expose no jobs argument in this binding: their 1/4/12 measurements limit the process CPU affinity while retaining the library's own team policy. These are CPU-availability results, not a claim that all 12 CPUs do useful work.
- Encode once per photo/setting; decode from in-memory compressed bytes three times and take the median. Tables then summarize across photos. File read, transfer/gamut preparation, Python import, GPU upload and presentation are outside these decode times; codec-internal YUV/RGB conversion remains inside. Encode includes both renditions. No per-photo command-line process or intermediate file occurs inside a candidate timing. The reference Zstandard stream is single-threaded in this API. PNG companion decoding has no thread control; its repeated 1/4/12 table cells are single-image default decoding, not 12-thread scanline decoding.
- Timings are diagnostic, with a 10% interpretation allowance for scheduling/cache noise, consistent with the brief's scratch-measurement convention. No claim of an improvement inside that allowance. This is not a USB, disk-cache-purged, folder-navigation or prepared-folder acceptance benchmark.
- Compare every finished pixel using the existing `compare_finished_pixels`: ΔEITP for HDR, ΔE2000 for SDR; mean below 1.0 and p99.9 at most 3.0 **for each photo and each rendition**. No sampling, peak normalization, stray-pixel exclusion or relaxed tolerance. “Worst” columns independently take the largest per-photo mean/p99.9. They need not come from the same photo.
- Peaks are the maximum decoded linear BT.2020 channel in absolute nits, matching the per-channel delivery ceiling, rather than average luminance. Capacity uses both stored views: `floor(10 × 2^30 / mean pair bytes)`; excludes database/thumbnail/index overhead and reserve space.

## B1 — stored screen previews

### Settings

| Label | Exact representation |
| --- | --- |
| uhdr90/95 full/half | libultrahdr quality 90/95, quality usage; supplied authored SDR RGBA8 base and HDR BT.2100-linear RGBA half input (1 = 203 nits). Gain-map scale 1 or 2. The quality argument controls the base; the binding leaves gain-map quality at its library default. Three-channel gain map; ISO metadata says `use_base_colour_space=false`, so this is the supported wider-gamut BT.2020 gain-map option. No additional narrower-gamut result is claimed. |
| avif90/95 | HDR PQ 10-bit, CICP 9/16/9, YUV444, speed 8, quality 90/95; separate authored-SDR JPEG q95, 4:4:4. JPEG companion quality is included in the rejection. |
| avif100 (untiled) | Same HDR representation, quality 100; separate authored-SDR AVIF 12-bit, CICP 1/13/0, YUV444, q100, speed 8. “100” is lossless coding of quantized/YUV samples, not lossless finished HDR pixels. |
| jxl90/95 | Separate HDR PQ 16-bit BT.2100-tagged JXL and authored SDR 8-bit sRGB-tagged JXL; distances 0.4/0.2, effort 3, decoding-speed 1, container enabled. Labels are shorthand, not JPEG-equivalent quality scores. |
| jxl99.9 | HDR PQ16 plus authored SDR sRGB16; distance 0.004, effort 3, decoding-speed 1. |
| avif99/100tiled-png | HDR quality 99/100 as above, 8 tiles (`tilelog2=(1,2)`, column/row log2 order in the binding); separate authored-SDR sRGB8 lossless PNG, compression level 3. The known cache contract supplies the SDR interpretation. |
| jxl100s8 | Lossless PQ16 HDR JXL as above, plus lossless authored-SDR sRGB8 JXL. |
| jxl100 | Same PQ16/sRGB16 pair with `lossless=true`, distance 0, effort 3, decoding-speed 1. Lossless encoded samples still incur the stated transfer/quantization conversion relative to half-float. |
| half-zstd | Separate captured RGB half-float HDR and SDR arrays, lossless Zstandard level 3. Reference only. |

### Space, preparation and quality

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

MiB are binary units. Bytes per individual photo, encode/decode times, complete metrics and peaks are preserved in the CSV appendix and in ignored `output/part-b-codecs-2026-10-26/results.json`; the main report tables show the aggregate and all per-photo peaks. Lossless half-float is the reference only, not the proposed persistent format.

### Decode scaling

| Setting | HDR decode ms, 1 / 4 / 12 | SDR decode ms, 1 / 4 / 12 |
| --- | --- | --- |
| uhdr90full | 265.0 / 113.5 / 106.6 | 14.5 / 13.9 / 14.2 |
| uhdr90half | 255.2 / 103.8 / 97.9 | 14.6 / 14.2 / 13.9 |
| uhdr95full | 275.7 / 120.3 / 115.3 | 18.5 / 17.7 / 18.1 |
| uhdr95half | 261.4 / 110.8 / 103.4 | 18.5 / 17.9 / 17.9 |
| avif90 | 68.5 / 69.0 / 70.0 | 17.7 / 17.8 / 17.7 |
| avif95 | 113.3 / 114.6 / 115.7 | 17.7 / 17.8 / 17.9 |
| jxl90 | 134.6 / 43.7 / 22.5 | 112.7 / 38.1 / 18.7 |
| jxl95 | 157.5 / 50.3 / 27.3 | 136.5 / 45.6 / 22.7 |
| half-zstd | 28.6 / 27.8 / 28.1 | 28.9 / 28.0 / 28.0 |
| avif100 | 305.7 / 306.9 / 305.9 | 698.4 / 698.6 / 709.6 |
| jxl99.9 | 194.8 / 64.6 / 30.9 | 169.2 / 57.1 / 27.2 |
| jxl100 | 402.7 / 145.9 / 63.5 | 400.9 / 146.2 / 62.1 |
| avif99tiled-png | 191.3 / 72.6 / 50.2 | 37.9 / 37.8 / 38.4 |
| avif100tiled-png | 307.8 / 109.2 / 75.4 | 37.9 / 38.2 / 38.0 |
| jxl100s8 | 401.8 / 149.3 / 62.7 | 370.7 / 133.5 / 56.7 |

A selected rendition decodes only its own file. Ultra HDR HDR reconstruction uses base plus gain map; its SDR view only decodes the base JPEG. Parallel work does not guarantee linear scaling. Decode-ahead remains necessary even for a qualified codec; these numbers do not establish instantaneous key-to-picture latency.

### Ultra HDR: two JPEG decodes plus WGSL

| Setting | Two JPEGs ms, 1 / 4 / 12 workers | CPU upload enqueue + allocations ms | Queued uploads + GPU submit/wait ms | Worst GPU vs lib mean / p99.9 | Within guide vs lib | Worst GPU vs reference mean / p99.9 | HDR guide passes | Max GPU peak nits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| uhdr90full | 23.3 / 16.7 / 16.7 | 15.8 | 59.2 | 1.408 / 8.520 | 15/19 | 23.386 / 117.550 | 0/19 | 6133.635 |
| uhdr90half | 16.7 / 13.9 / 14.4 | 9.9 | 52.4 | 2.907 / 36.508 | 6/19 | 20.799 / 75.290 | 0/19 | 3793.714 |
| uhdr95full | 30.3 / 21.1 / 21.6 | 15.9 | 61.1 | 1.398 / 8.526 | 15/19 | 17.240 / 75.037 | 0/19 | 5611.328 |
| uhdr95half | 21.9 / 18.6 / 18.5 | 9.9 | 52.0 | 3.325 / 35.151 | 6/19 | 15.147 / 56.720 | 0/19 | 3628.917 |

The two JPEGs are decoded in memory by libjpeg-turbo. With one worker they run serially; with 4/12 workers only two independent JPEG jobs exist, so extra workers do not create parallel scanline decoding. WGSL reconstructs at full HDR headroom using ISO gains, per-channel offsets/gamma and the gain-map colour-space flag. It converts the SDR base to BT.2020 before gain application for these files. Half-size gain maps use pixel-centred bilinear sampling.

The GPU number is CPU-observed submission plus queue completion, not a GPU timestamp. The first column times CPU allocations and upload enqueueing; the second also waits for those queued GPU uploads before compute completion. Do not interpret it as pure shader execution. Readback, scratch evidence writes and Playwright transport are excluded. Shader creation occurs once; GPU work is sampled once per photo/setting, and the table takes the median across 19 photos. The adapter reports NVIDIA Lovelace (the RTX 4070 Ti). This exploratory shader has no production integration. JPEG output rounding/chroma handling, half-size gain-map interpolation and output half precision can differ from libultrahdr; the measured discrepancy above is retained rather than silently treating it as equivalent. See raw `gpu-comparison.json` for per-photo comparison with both libultrahdr and the uncompressed reference.

### HDR ceiling

The requested 1000-nit ceiling is **not established by this experiment**. Capturing actual current Library output exposed reference pictures above 1000 nits when Highlight compression is disabled. The scratch capture sets the target value to 1000 but deliberately does not turn on a disabled section. Clipping those references before comparison would alter the requested Library picture. No original sidecar was changed.

| Photo | Reference peak nits | All decoded settings: min–max peak | AVIF100 peak | JXL lossless peak |
| --- | --- | --- | --- | --- |
| DSC07147.ARW | 192.050 | 188.132–197.297 | 191.828 | 192.047 |
| DSC07333.ARW | 1901.829 | 1509.812–1921.622 | 1921.622 | 1901.851 |
| DSC07518.ARW | 324.266 | 322.392–333.245 | 325.364 | 324.260 |
| DSC_3931.NEF | 201.088 | 195.458–203.991 | 202.915 | 201.099 |
| 2025_0730_1331_3.arw | 1609.377 | 1609.377–2540.672 | 1620.626 | 1609.401 |
| DSCF6495.RAF | 2000.326 | 1928.500–2561.670 | 2009.798 | 2000.484 |
| A7R00619.ARW | 2261.782 | 2233.000–2383.807 | 2258.656 | 2261.839 |
| IMG_0790.CR2 | 1789.357 | 1789.235–2650.102 | 1804.684 | 1789.235 |
| A7R00652.ARW | 1448.732 | 1433.688–1563.562 | 1455.410 | 1448.720 |
| DSC00636.ARW | 1307.501 | 880.988–1310.687 | 1307.063 | 1307.392 |
| 2L1B8631.CR2 | 1936.420 | 1893.609–2046.202 | 1938.940 | 1936.521 |
| IMG_3129.CR2 | 1900.063 | 1899.722–2178.936 | 1904.461 | 1899.988 |
| P6200170.ORF | 1681.140 | 1677.922–1804.684 | 1694.906 | 1681.209 |
| DSC08360.ARW | 2117.766 | 1771.492–2362.471 | 2102.058 | 2117.888 |
| DSCF4011.RAF | 5372.501 | 4193.219–6774.649 | 5386.054 | 5372.330 |
| IMG_7723.CR3 | 454.544 | 435.782–456.037 | 456.037 | 454.553 |
| DSC07202.ARW (graded) | 248.544 | 208.353–275.755 | 249.033 | 248.532 |
| DSC07178.ARW (graded) | 747.154 | 745.963–765.611 | 756.238 | 747.116 |
| DSC07217.ARW (graded) | 754.370 | 754.370–905.068 | 763.069 | 754.388 |

Supplementary numerical edge probe (256-square ramp, saturated-colour boundaries and black/white steps near 1000 nits) distinguishes lossy overshoot from the uncapped-photo problem. Half-float representation itself slightly changes the input peak; the actual input peak is reported, not labelled exactly 1000:

| Setting | Input half-float peak nits | Decoded peak nits |
| --- | --- | --- |
| uhdr90full | 1000.0831 | 999.9336 |
| uhdr90half | 1000.0831 | 1258.4414 |
| uhdr95full | 1000.0831 | 1039.5820 |
| uhdr95half | 1000.0831 | 1258.4414 |
| avif90 | 1000.0831 | 1007.9301 |
| avif95 | 1000.0831 | 1007.9301 |
| avif99 | 1000.0831 | 1063.6334 |
| avif100 | 1000.0831 | 998.9324 |
| jxl90 | 1000.0831 | 1000.0013 |
| jxl95 | 1000.0831 | 1000.4214 |
| jxl99.9 | 1000.0831 | 1000.2813 |
| jxl100 | 1000.0831 | 1000.1413 |
| avif99tiled-png | 1000.0831 | 998.9324 |
| avif100tiled-png | 1000.0831 | 998.9324 |
| jxl100s8 | 1000.0831 | 1000.1413 |
| half-zstd | 1000.0831 | 1000.0831 |

No lossy codec should be trusted to enforce an exact decoded ceiling merely because its encoder input is capped. PQ quantization and half-float rounding must be accounted for; compression ringing/gain reconstruction is not “rounding.” A future stored-preview path must resolve the uncapped reference behaviour and apply/verify the selected ceiling after reconstruction, with only agreed encoder rounding. This task makes no such app change.

### Grain and local visual review

Inspected the three 6-column grain contact sheets in SDR and in the labelled HDR-to-SDR fallback, and verified the HTML's two 2× crops, HDR canvas and grain-case switching. The q95 variants change fine texture and colour around the watch/shoe and on the green floor; differences in the pale field are subtle at native crop size. AVIF100+PNG and lossless JXL100s8 look closest in these inspected crops. This is a limited visual observation, not Steve's grain acceptance. The fallback and screenshots cannot establish HDR fidelity; use the numeric HDR canvas on an HDR-enabled display for that judgment.

The local HTML gallery is `D:\AI\AI Projects\HDR Finisher Tool\ai\output\part-b-codecs-2026-10-26\gallery\index.html`. It contains the worst full-image p99.9 photo for every candidate/setting, separately in HDR and SDR, plus all three graded grain cases in each rendition. Within that photo it selects the 256-square tile with largest mean absolute finished-RGB difference on a 128-pixel grid; therefore “worst crop” is a documented visual diagnostic, not a second perceptual acceptance metric. Every candidate shares the selected reference crop. Zoom is 2× nearest-neighbour.

The optional HDR view uploads numeric Display-P3 half-float pixels to an extended-tone-mapping WebGPU half-float canvas; 1 = 203 nits. A labelled PNG fallback compresses HDR brightness for SDR inspection. It cannot establish HDR fidelity. Steve must judge HDR on an HDR-enabled display and judge whether grain still has the intended character. Browser `createImageBitmap` HDR preservation was not tested; no conclusion is made about it or about JPEG XL browser decoding.

### JPEG XL gain-map binding estimate

Do not build it in this task. The installed binding has no gain-map API. [libjxl's metadata API](https://libjxl.github.io/libjxl/api_metadata.html) provides `JxlGainMapBundle` and read/write/size functions for an ISO gain-map bundle; it does not provide HDRF's authored-SDR-to-HDR gain-map authoring and GPU reconstruction pipeline. A minimal native memory wrapper/ownership bridge is plausibly half to one engineering day. Container/tagging, independent authored-SDR intent, gain generation, reconstruction, packaged Windows loading and colour/ceiling qualification make the useful production slice roughly 2–4 engineering days (estimate, not measured). That is not small enough to justify an unrequested binding here. Separate JXL files already measure the available path.

## B2 — cold originals

### Timing boundary and real files

One copied real file per format family, with two different gain-map AVIF examples and a direct AVIF. The application was already running; JPEG is first in the sequence and includes first-use renderer/pipeline setup, while later formats can reuse that setup. These are diagnostic snapshots, not matched codec latency rankings. Its disposable profile/scene cache had no prior entries for these copied originals. The OS file cache was warm from copying. Start = Library scene request at a 640-pixel first-picture size; finish = finished GPU work followed by two animation frames, a compositor opportunity. This is a measured first finished picture in the existing pipeline, not a folder-selection click, physical-panel measurement, full 2560 sharp picture or cold application launch. Gates/errors remain gates; decoding samples is not permission to display a guessed interpretation.

Current CPU boundaries are separately timed existing decoder calls, including current helper/metadata work where used. Fast times are three-run median in-process decoding/sample conversion. RGB probes consume memory input and exclude read (recorded separately); DNG retains warm reads of the copied original inside the existing preparation routine. All exclude GPU preparation/upload/draw and generally metadata validation. The illustrative first-picture column is `current first − current CPU boundary + fast decode`: an estimate using separately timed components, **not** an implemented or measured fast end-to-end display path. It retains the existing downstream work, excludes any new parser implementation and is unsuitable as an acceptance target. HEIC headroom parsing is specifically not included in its fast number. DNG uses the existing complete preparation/calibration path; the fast measurement requests TIFF workers/OpenMP teams of 12 and reuses raw EXIF inspection where needed. That parser work is not included in the fast estimate.

| Format | Real sample | Current first picture ms | Current CPU boundary ms | Fast in-process ms | Illustrative first-picture ms | Sample difference mean / p99.9 / max |
| --- | --- | --- | --- | --- | --- | --- |
| JPEG | DSC_3931_01.jpg | 4644.7 | 51.4 | 6.3 | 4599.6 | exact |
| UltraHDR | DSCF6495_finished.jpg | 1866.5 | 770.9 | 91.8 | 1187.5 | exact |
| AVIF | DSCF6495_finished.avif | 12696.2 | 8747.0 | 6730.4 | 10679.6 | 0.00000000 / 0.00000003 / 0.00000006 |
| AVIF-gainmap | 5M071612_finished.avif | 3237.3 | 2118.1 | 1118.1 | 2237.2 | 0.00000000 / 0.00000003 / 0.00000006 |
| HEIC | IMG_3324.HEIC | 6736.7 | 1613.9 | 1597.7 | 6720.5 | exact |
| TIFF | 2026-03-30-0072.tif | 2729.6 | 149.8 | 72.2 | 2651.9 | 0.00000000 / 0.00000003 / 0.00000006 |
| PNG | IMG_2981.PNG | 1049.6 | 16.5 | 5.2 | 1038.2 | exact |
| EXR | DSCF6495.exr | 2808.4 | 179.3 | 387.0 | 3016.1 | exact |
| JXL | DSC01302.jxl | 4178.8 | 1149.0 | 217.2 | 3247.0 | exact |
| mosaic-DNG | Leica-X2-L1021324.DNG | 3221.3 | 579.5 | 587.4 | 3229.1 | exact |
| linear-DNG | DJI_0071-2-HDR.dng | 4960.4 | 2009.4 | 1949.7 | 4900.7 | exact |
| AVIF-direct | DSC08883.avif | 2692.8 | 1508.6 | 648.4 | 1832.6 | 0.00000000 / 0.00000003 / 0.00000006 |

Differences are absolute returned-sample units, not colour differences unless stated: uint8 code values for JPEG/PNG, normalized float samples for precision RGB formats, and float32 Library preparation/working samples for DNG. Exact means `array_equal` at that boundary. Layout mismatches/errors are not accepted as pixel equivalence. The fast path does not silently inherit metadata from a display decision; where the experiment reuses metadata it says so.

### Recommended paths and accuracy restrictions

- **JPEG:** libjpeg-turbo in memory. Use reduced IDCT where it still covers the first-picture size; the measured difference below is a deliberate first-picture approximation, not permission to replace the accurate sharp picture. Apply the same EXIF orientation, ICC interpretation and finite-value rules. Plain JPEG scanline decoding does not gain 12-way parallelism merely from requesting workers.
- **Ultra HDR JPEG:** libultrahdr in memory, retaining the authored SDR base as well as reconstructed HDR. The fast probe includes both decodes; preserve ISO/Adobe gain-map interpretation, gamut, offsets, orientation and the current HDR/SDR intent. Base-only reduced JPEG may supply an SDR first picture; it cannot silently stand in for HDR. The two-JPEG/WGSL experiment above is a further option only after its reconstruction differences are resolved.
- **AVIF, direct and gain-map:** native libavif memory API, `maxThreads=12`, one container parse/decode, retain both base and reconstructed output. The scratch wrapper deliberately keeps the current gain-map application and 10-bit YUV-to-RGB boundary. It does not remove a conversion by silently changing pixels. The available offline build uses AOM; dav1d remains an unmeasured alternative. These originals are already encoded: their tile structure cannot be fixed by a decoder thread count. No proven reduced-size decode shortcut was found in the available still-image API.
- **HEIF/HEIC:** keep libheif/pillow-heif, enable its decode workers, retain primary selection, ICC/NCLX, orientation and Apple's auxiliary gain map/headroom. Replace metadata subprocesses only with an equivalent in-process parser. The fast probe reuses already-read Apple headroom, so its speed is an optimistic opportunity, not a complete replacement; 1598 vs 1614 ms is within timing noise and establishes no decode improvement. It still reconstructs HDR and creates the SDR reference; it is not an SDR-only decode.
- **TIFF:** tifffile/imagecodecs with workers for independently compressed strips/tiles; use a valid reduced-resolution IFD if one exists and its interpretation matches. Do not substitute a thumbnail with an unknown look. Preserve sample normalization, channels, orientation policy, ICC and interpretation gates. This single scan is not evidence for every TIFF compression/layout.
- **PNG:** in-memory libpng/imagecodecs plus the existing colour/alpha/orientation boundary. PNG has no JPEG-style reduced IDCT; normal image reduction follows full decode. A decoder that retains 16 bits where the current route returns 8 bits changes pixels: preserve the current boundary for an optimization, or obtain a separate import-accuracy decision.
- **EXR:** keep the existing in-process combined-channel OpenEXR path (179 ms here); the memory-wrapper probe is slower (387 ms), so do not replace it for this sample. The latter needs explicit B/G/R file-channel reordering and includes that gather in its timing; retain channel selection, data/display windows, chromaticities, linear reference, finite sanitation and interpretation. The wrapper has no thread-count argument; setting the separate Python OpenEXR global pool does not prove control of its linked library. Do not label this an explicitly 12-thread decode. Mip/rip levels help only when actually present and appropriate; this exported scanline image has no tested reduced level.
- **JPEG XL:** existing libjxl through imagecodecs, explicit 12 threads, memory input. Retain its colour tags/profile, orientation, precision and interpretation gate. No browser decoding dependency or unqualified progressive/reduced-detail approximation is proposed. Faster unpacking alone does not solve an unresolved source interpretation.
- **Linear DNG and mosaic DNG:** retain the experimental DNG route, embedded profile, black/white normalization, crop/orientation, calibration, required opcodes, gain maps, highlight handling and demosaic. Use TIFF workers where independently compressed tiles/strips allow and the existing machine-derived LibRaw/OpenMP teams. Reusing EXIF inspection avoids parsing twice; it does not remove inspection. Neither DNG probe establishes a speed gain outside the 10% noise allowance. The measured fast probe retains the complete existing preparation, including embedded SDR work when applicable. No camera-preview-only shortcut is qualified and no raw mosaic is treated as an RGB picture.

First-picture reduced JPEG results, both-rendition differences, gates and the exact per-file conditions are recorded below. None of these isolated probes is an app integration or a decision to relax import accuracy.

### Sample-specific accuracy findings

- JPEG full decode is exact in returned 8-bit samples. Actual reduced IDCT used Pillow/libjpeg-turbo `draft()` before loading: 2000×1168 → 1000×584, then the same Lanczos reduction to 640. Decode 6.83 ms versus 6.31 ms full memory decode: **no speed benefit on this small JPEG**. At 640, reduced vs full SDR ΔE2000 mean 0.184, p99.9 2.527: within the preview guide, but approximate pixels. The imagecodecs `shape` argument did not actually reduce this JPEG and is not counted as reduced decoding. The sample's sRGB ICC conversion is an identity here; this does not qualify skipping ICC on other JPEGs.
- Ultra HDR includes both HDR and the SDR base. HDR is exact after retaining the existing 0.18 linear scale; SDR differs by at most 5.96e-8 normalized code units from multiply/divide rounding. This original uses the existing sRGB reconstruction gamut, unlike the wider-gamut B1 encodes.
- Large gain-map AVIF: native full-precision headroom is **4.113112926 stops**, while the current inspection text/parser gives **4.11**. Exact metadata changes normalized PQ samples: mean 0.0000429666, p99.9 0.0024109185, max 0.0135500114. Finished HDR ΔEITP mean **0.0618**, p99.9 **2.0596**, within the Library preview guide; that guide does not authorize an import pixel change. Supplying the existing 4.11 reduces the discrepancy to float32 rounding (mean 1.18e-10, p99.9 2.98e-8, max 5.96e-8). **The table uses that compatibility probe**, 6730.4 ms for both renditions. The full-precision variant took 6807.9 ms. Retain the current headroom decision until Steve chooses otherwise.
- Small gain-map AVIF: HDR max sample difference 5.96e-8; its SDR base differs by mean **0.000244262**, p99.9 **0.000492811**, max **0.000496298** normalized samples. Current base decoding returns 10-bit RGB codes; the native probe converts YUV into 16-bit RGB. Retain that existing quantization boundary or obtain a separate accuracy decision. The large sample's 8-bit SDR base differs only by float32 rounding (max 5.96e-8).
- The available libavif gain-map implementation has serial pixel loops. `maxThreads=12` enables codec/YUV work where supported; it does not parallelize all transfer/gamut maths. The 14.3 MP original still spends seconds in reconstruction. Removing helpers alone is insufficient; GPU or safely partitioned reconstruction is a later measured task, not an unmeasured speed promise.
- TIFF and direct AVIF differ by at most 5.96e-8 normalized samples due to float32 normalization. JPEG, PNG, JXL, HEIC HDR and both DNG preparation buffers are exact at the compared boundaries. This PNG is 8-bit; no 16-bit-PNG precision change was observed here.
- EXR is exact after gathering selected RGB channels: file order is `B, G, R, highlight reconstruction.Y`, so taking the first three as RGB would be wrong. Its 387 ms memory probe is slower than the existing 179 ms combined-channel reader. Keep the latter.
- HEIC retains Apple gain-map reconstruction and SDR-reference creation; 1598 vs 1614 ms is within noise and excludes a new metadata parser. JXL/HEIC lower-level GPU adapters reject unresolved primaries/auxiliary ICC cases; the existing Library CPU fallback still produced the measured first pictures. The probes do not remove those fallback/gate rules. Mosaic DNG 587 vs 579 ms and linear DNG 1950 vs 2009 ms establish no speed gain outside the 10% allowance.

### Safety and reproducibility

All input photos and the three graded sidecars were copied into the ignored experiment tree before loading and used as read-only inputs. Source and copy hashes were recorded; the final source-hash audit is recorded below. Isolated Electron/backend app-data profiles and disabled source-cache use for CPU probes prevent writes to the live Library database/cache. Current decoders may use temporary files as part of the measured baseline; the fast RGB candidate timings use memory, including the offline AVIF DLL; DNG keeps warm original-file reads in its in-process preparation routine. No live photo, sidecar, cache or database was opened for writing. No app tests, sweeps, export or Proof runs were performed; the experiment is the requested validation.

Scratch scripts, images, codec payloads, profiles and raw measurements stay under `output/part-b-codecs-2026-10-26` (ignored). The AVIF DLL was built offline from already-local headers/libraries and copies the existing gain-map reconstruction/10-bit YUV boundary. A proposed external libultrahdr source download/build was rejected by automatic approval review as outside the offline scope and was not run; installed bindings cover the wider-gamut experiment. No native libjxl binding was built.

Final SHA-256 audit: **34/34 source/copy pairs unchanged** (19 RAW photos, 3 sidecars and 12 non-RAW/DNG originals). No live Library database/cache was used. Checksums identify the retained local evidence:

- `manifest.json`: `00393ce8b4391f4da3f394712f7fbf57087a04ba82ded09202f2981b833a6ce7`
- `captures.json`: `c65a10bbcb1377cb4e2f951418545e724746f9704b90f8139044f6dc5eb6a56d`
- `results.json`: `2587b45c7ef6a2586c199ec31af41815bc0e43562c0336da74e33ea7bf88b173`
- `gpu-comparison.json`: `84bc444bd5ba8d3a9ca96ff26be58e9b85e17a7efcba0dbb6bd86a968a2c6bcc`
- `cold-manifest.json`: `bdf4dbe3a4a53a0b8a7c1c884b6cbbbf29bdf06df67c9e38168166505f626bea`
- `cold-display.json`: `b9b7886be7ab4665ed88460768f7a355765cefb95d891ebcdcda7b38b2104bac`
- `cold-cpu.json`: `e09fdf236eaefdc3459dc121c87aea7ddbf5634eea797af23b9957780dc130fe`
- `hash-audit.json`: `6f1447566a6dfe930ef81e643c41906d950509e68fcee8b4764389795c9d04b9`

## Per-photo measurement appendix

<details>
<summary>Preview measurements (CSV)</summary>

```csv
photo,graded,setting,bytes_pair,HDR_file_bytes,SDR_file_bytes,photos_per_10GiB,encode_ms,HDR_1_ms,HDR_4_ms,HDR_12_ms,SDR_1_ms,SDR_4_ms,SDR_12_ms,HDR_mean,HDR_p999,SDR_mean,SDR_p999,decoded_peak_nits,reference_peak_nits
DSC07147.ARW,False,uhdr90full,1645727,1645727,0,6524,213.919,270.037,123.159,106.095,13.997,13.856,14.246,7.370494,26.456926,2.816979,10.352928,188.131836,192.049759
DSC07147.ARW,False,uhdr90half,1079313,1079313,0,9948,152.522,257.62,107.984,101.15,14.638,14.233,13.904,7.357639,26.455886,2.816979,10.352928,188.230957,192.049759
DSC07147.ARW,False,uhdr95full,3275479,3275479,0,3278,225.108,283.727,131.828,126.657,18.735,18.115,19.021,6.68699,23.216068,2.6174,9.800772,190.114273,192.049759
DSC07147.ARW,False,uhdr95half,2048017,2048017,0,5242,155.903,263.011,117.407,107.862,19.023,18.497,18.34,6.664773,23.290733,2.6174,9.800772,191.303711,192.049759
DSC07147.ARW,False,avif90,2327006,667994,1659012,4614,488.155,76.672,78.026,76.142,17.679,18.59,17.947,7.317007,26.532345,2.609862,9.877608,190.036774,192.049759
DSC07147.ARW,False,avif95,3603858,1944846,1659012,2979,303.013,130.238,132.309,132.765,17.909,18.035,18.035,4.748348,15.912408,2.609862,9.877608,188.261749,192.049759
DSC07147.ARW,False,jxl90,2290829,1276059,1014770,4687,357.593,140.701,48.613,25.12,115.956,38.793,20.615,5.720181,21.564991,2.397746,8.248294,188.590683,192.049759
DSC07147.ARW,False,jxl95,4525279,2450495,2074784,2372,219.46,162.116,57.141,28.481,146.733,48.13,23.419,4.083962,16.114497,1.842008,6.502163,192.355972,192.049759
DSC07147.ARW,False,half-zstd,43976295,21814677,22161618,244,180.674,28.279,27.837,28.329,27.236,26.252,26.308,0.0,0.0,0.0,0.0,192.049759,192.049759
DSC07333.ARW,False,uhdr90full,1262018,1262018,0,8508,253.979,268.589,120.887,111.41,15.212,14.624,14.323,6.290553,23.104994,2.436736,9.377799,1809.554688,1901.828613
DSC07333.ARW,False,uhdr90half,1042784,1042784,0,10296,146.332,409.471,161.523,148.407,14.565,14.313,14.094,6.238478,23.049038,2.436736,9.377799,1532.808594,1901.828613
DSC07333.ARW,False,uhdr95full,2425355,2425355,0,4427,228.011,278.978,127.427,117.861,19.96,19.473,19.45,5.705578,20.139621,2.284195,8.814597,1833.34375,1901.828613
DSC07333.ARW,False,uhdr95half,1938301,1938301,0,5539,157.79,411.34,169.439,153.852,20.204,19.2,20.728,5.677989,20.184586,2.284195,8.814597,1509.8125,1901.828613
DSC07333.ARW,False,avif90,2337235,556639,1780596,4594,206.913,69.337,68.995,69.955,18.631,19.108,19.632,6.461099,23.841458,2.262503,8.848119,1772.608765,1901.828613
DSC07333.ARW,False,avif95,3478221,1697625,1780596,3087,309.548,119.149,120.235,126.105,18.471,18.256,18.989,4.460369,15.081761,2.262503,8.848119,1887.453613,1901.828613
DSC07333.ARW,False,jxl90,2379867,1309630,1070237,4511,197.55,136.05,47.177,26.247,113.109,40.514,20.608,4.840536,18.384185,2.050239,7.397689,1883.828369,1901.828613
DSC07333.ARW,False,jxl95,4590481,2458800,2131681,2339,218.792,159.85,54.582,27.748,137.914,47.619,24.48,3.477038,13.712508,1.572125,5.736042,1885.939819,1901.828613
DSC07333.ARW,False,half-zstd,43064242,21317396,21746846,249,136.876,27.924,27.307,25.941,25.637,24.962,25.725,0.0,0.0,0.0,0.0,1901.828613,1901.828613
DSC07518.ARW,False,uhdr90full,1924214,1924214,0,5580,224.518,268.647,116.671,106.976,15.875,14.99,14.991,5.062007,22.13542,1.98161,8.389692,326.108398,324.265564
DSC07518.ARW,False,uhdr90half,1308736,1308736,0,8204,157.17,398.598,157.977,138.381,15.512,14.898,15.196,5.107416,22.310861,1.98161,8.389692,326.108398,324.265564
DSC07518.ARW,False,uhdr95full,3598542,3598542,0,2983,242.803,278.77,128.156,118.332,21.225,20.313,20.811,4.605929,19.519925,1.898008,8.014585,333.245117,324.265564
DSC07518.ARW,False,uhdr95half,2408096,2408096,0,4458,176.218,407.99,165.493,150.428,21.289,20.816,20.678,4.671463,19.679254,1.898008,8.014585,332.055695,324.265564
DSC07518.ARW,False,avif90,2541261,435560,2105701,4225,243.39,68.469,74.475,72.925,24.623,24.316,24.261,5.005531,22.186591,1.888803,8.039778,325.363708,324.265564
DSC07518.ARW,False,avif95,3476483,1370782,2105701,3088,328.839,136.176,135.112,126.478,24.839,24.637,24.26,3.706218,13.422165,1.888803,8.039778,322.391998,324.265564
DSC07518.ARW,False,jxl90,2038421,1131751,906670,5267,209.371,160.399,46.779,24.109,134.245,38.109,18.507,3.810522,17.777671,1.581944,6.753274,325.469788,324.265564
DSC07518.ARW,False,jxl95,4069380,2206768,1862612,2638,238.792,191.044,56.169,28.823,167.042,47.055,24.819,2.793872,12.93708,1.265311,5.361051,327.667694,324.265564
DSC07518.ARW,False,half-zstd,43463396,21489399,21973997,247,212.492,27.504,26.285,26.323,26.454,25.986,25.745,0.0,0.0,0.0,0.0,324.265564,324.265564
DSC_3931.NEF,False,uhdr90full,5454560,5454560,0,1968,250.062,287.218,135.785,127.398,12.324,12.025,11.708,2.663531,9.978089,1.404294,5.302542,203.991211,201.087601
DSC_3931.NEF,False,uhdr90half,1132190,1132190,0,9483,192.316,248.555,100.912,90.776,12.362,11.745,12.951,2.626699,9.92975,1.404294,5.302542,203.594727,201.087601
DSC_3931.NEF,False,uhdr95full,7810284,7810284,0,1374,266.903,298.791,148.706,136.487,14.86,15.035,14.503,2.405428,8.768249,1.282674,4.833224,203.594727,201.087601
DSC_3931.NEF,False,uhdr95half,1979789,1979789,0,5423,161.298,254.555,106.534,96.561,14.551,14.187,14.111,2.374629,8.720525,1.282674,4.833224,203.991211,201.087601
DSC_3931.NEF,False,avif90,1310349,257176,1053173,8194,205.769,57.999,56.369,54.295,15.877,15.981,16.125,2.758595,11.083833,1.254375,4.825261,195.457764,201.087601
DSC_3931.NEF,False,avif95,1734602,681429,1053173,6190,252.923,94.62,90.29,95.989,16.832,17.363,17.463,2.328504,8.535678,1.254375,4.825261,201.025742,201.087601
DSC_3931.NEF,False,jxl90,1249113,679824,569289,8596,193.028,134.561,41.755,21.547,112.74,34.29,20.885,2.180004,8.468755,1.274203,4.602276,198.210815,201.087601
DSC_3931.NEF,False,jxl95,2569213,1376477,1192736,4179,213.626,158.021,46.765,23.834,139.408,39.975,19.335,1.720261,6.792454,1.068628,3.834731,198.907227,201.087601
DSC_3931.NEF,False,half-zstd,38103615,18866205,19237410,281,265.405,30.624,29.591,29.59,29.451,28.536,28.563,0.0,0.0,0.0,0.0,201.087601,201.087601
2025_0730_1331_3.arw,False,uhdr90full,1417432,1417432,0,7575,221.433,259.629,110.76,99.297,15.516,14.633,14.618,13.858878,56.129352,3.074392,12.336974,2540.671875,1609.377197
2025_0730_1331_3.arw,False,uhdr90half,1245241,1245241,0,8622,151.493,399.374,156.696,136.761,15.406,14.725,14.793,14.113917,56.088676,3.074392,12.336974,2450.273438,1609.377197
2025_0730_1331_3.arw,False,uhdr95full,2669142,2669142,0,4022,226.744,269.285,119.724,112.329,20.967,20.448,20.512,12.038154,50.696862,2.655233,10.824758,2007.796875,1609.377197
2025_0730_1331_3.arw,False,uhdr95half,2298730,2298730,0,4671,160.288,410.531,165.234,148.628,20.916,21.072,20.541,12.176264,50.635039,2.655233,10.824758,2426.484375,1609.377197
2025_0730_1331_3.arw,False,avif90,3568425,1440301,2128124,3009,309.25,123.175,117.733,110.614,22.675,21.808,20.142,11.415635,41.89816,2.639224,10.716899,2238.454102,1609.377197
2025_0730_1331_3.arw,False,avif95,5345715,3217591,2128124,2008,436.161,174.915,182.256,177.605,20.057,20.016,20.203,6.012788,20.731621,2.639224,10.716899,1921.622437,1609.377197
2025_0730_1331_3.arw,False,jxl90,3380130,1884242,1495888,3176,218.985,147.131,49.432,25.518,124.361,41.716,20.663,10.138525,39.937338,2.545123,9.599888,1707.52417,1609.377197
2025_0730_1331_3.arw,False,jxl95,5887140,3185890,2701250,1823,222.556,173.019,57.934,28.824,147.011,48.633,24.142,7.046955,29.522692,1.871834,7.249892,1659.474243,1609.377197
2025_0730_1331_3.arw,False,half-zstd,46362524,23103365,23259159,231,139.935,23.994,23.596,22.476,22.759,22.495,22.368,0.0,0.0,0.0,0.0,1609.377197,1609.377197
DSCF6495.RAF,False,uhdr90full,1766251,1766251,0,6079,229.092,262.972,112.001,104.364,16.859,16.349,16.83,7.751642,31.792735,3.033174,12.821377,2121.984375,2000.325562
DSCF6495.RAF,False,uhdr90half,1596749,1596749,0,6724,148.08,259.557,103.465,97.852,16.889,16.189,16.841,7.668122,31.769789,3.033174,12.821377,1966.5625,2000.325562
DSCF6495.RAF,False,uhdr95full,3040031,3040031,0,3532,227.627,271.555,119.972,111.153,22.27,21.265,21.284,6.149232,23.293055,2.451734,9.654237,2118.8125,2000.325562
DSCF6495.RAF,False,uhdr95half,2678909,2678909,0,4008,158.448,261.368,109.847,103.364,22.56,21.302,21.281,6.056449,24.161248,2.451734,9.654237,1928.5,2000.325562
DSCF6495.RAF,False,avif90,3530953,1094715,2436238,3040,254.277,96.206,94.576,95.276,21.014,21.522,20.945,7.583416,27.900155,2.430796,9.542256,2561.670166,2000.325562
DSCF6495.RAF,False,avif95,4823022,2386784,2436238,2226,341.321,149.272,151.711,155.55,21.508,23.096,21.104,4.434657,14.577402,2.430796,9.542256,2198.595459,2000.325562
DSCF6495.RAF,False,jxl90,3502936,1883055,1619881,3065,225.071,148.328,48.651,24.081,128.22,39.609,19.968,6.341628,30.998982,2.670062,10.989088,2079.942627,2000.325562
DSCF6495.RAF,False,jxl95,5775372,3067582,2707790,1859,223.737,171.643,56.912,27.593,143.962,46.937,22.822,4.371065,22.075593,1.931405,7.694981,2027.570068,2000.325562
DSCF6495.RAF,False,half-zstd,45203140,22520252,22682888,237,131.499,25.169,23.988,23.965,24.248,23.903,23.536,0.0,0.0,0.0,0.0,2000.325562,2000.325562
A7R00619.ARW,False,uhdr90full,1574278,1574278,0,6820,217.576,258.482,109.661,101.705,14.863,14.256,14.294,4.626682,25.151127,1.882198,13.0208,2258.375,2261.781738
A7R00619.ARW,False,uhdr90half,1321433,1321433,0,8125,147.923,249.146,100.756,89.547,14.603,14.19,14.014,4.830961,33.221663,1.882198,13.0208,2240.929688,2261.781738
A7R00619.ARW,False,uhdr95full,2612972,2612972,0,4109,230.956,266.473,117.951,112.139,18.63,17.955,18.108,3.854081,18.842224,1.655401,9.318918,2256.789062,2261.781738
A7R00619.ARW,False,uhdr95half,2122040,2122040,0,5059,157.345,253.631,105.815,95.899,18.537,17.953,17.905,4.120983,30.646381,1.655401,9.318918,2233.0,2261.781738
A7R00619.ARW,False,avif90,2686796,834056,1852740,3996,307.055,76.769,76.703,76.743,17.769,17.755,18.173,4.4431,26.125645,1.621022,9.390382,2279.043457,2261.781738
A7R00619.ARW,False,avif95,3407964,1555224,1852740,3150,413.957,113.307,114.636,115.741,17.68,17.809,17.853,3.226759,16.159448,1.621022,9.390382,2258.656494,2261.781738
A7R00619.ARW,False,jxl90,3009897,1660339,1349558,3567,185.479,131.885,43.722,22.516,110.746,38.528,18.087,3.196216,17.586952,1.551702,9.246101,2264.060791,2261.781738
A7R00619.ARW,False,jxl95,4742521,2608097,2134424,2264,215.929,150.609,50.165,25.782,126.202,45.632,22.714,2.296233,12.548179,1.199948,6.20502,2255.503174,2261.781738
A7R00619.ARW,False,half-zstd,43549061,22176531,21372530,246,229.855,28.568,27.733,27.474,30.433,29.525,29.515,0.0,0.0,0.0,0.0,2261.781738,2261.781738
IMG_0790.CR2,False,uhdr90full,3351435,3351435,0,3203,230.404,281.423,125.638,116.105,20.035,19.269,19.196,23.403702,117.933696,3.357043,15.453325,2650.101807,1789.357422
IMG_0790.CR2,False,uhdr90half,2112799,2112799,0,5082,151.73,263.626,108.892,97.875,19.908,19.896,19.4,20.858887,75.134843,3.357043,15.453325,2212.382812,1789.357422
IMG_0790.CR2,False,uhdr95full,5844889,5844889,0,1837,233.911,300.003,143.487,130.123,27.841,27.546,27.522,17.252655,75.289535,2.296511,10.614147,2631.070312,1789.357422
IMG_0790.CR2,False,uhdr95half,3746363,3746363,0,2866,156.853,275.762,119.506,109.836,27.637,27.823,26.772,15.239164,57.149344,2.296511,10.614147,2231.414307,1789.357422
IMG_0790.CR2,False,avif90,5948800,2557486,3391314,1804,345.081,153.674,154.561,155.927,28.471,26.752,28.337,14.474613,53.23397,2.284333,10.579077,2341.32959,1789.357422
IMG_0790.CR2,False,avif95,8010758,4619444,3391314,1340,448.849,232.992,230.861,242.954,27.821,28.944,26.889,6.517736,23.442004,2.284333,10.579077,1974.048584,1789.357422
IMG_0790.CR2,False,jxl90,5486912,2962513,2524399,1956,215.693,163.694,51.923,26.785,141.424,48.902,22.491,13.941234,54.203547,2.613836,10.620614,1795.507446,1789.357422
IMG_0790.CR2,False,jxl95,8191297,4346132,3845165,1310,241.884,179.201,59.354,34.675,160.736,56.696,28.425,9.248841,39.783634,1.803601,7.703991,1790.989258,1789.357422
IMG_0790.CR2,False,half-zstd,46055390,23132954,22922436,233,151.717,23.449,22.061,23.351,24.181,22.891,22.926,0.0,0.0,0.0,0.0,1789.357422,1789.357422
A7R00652.ARW,False,uhdr90full,1843074,1843074,0,5825,222.463,261.578,112.337,106.597,16.331,16.078,15.889,4.663312,19.96902,2.058087,10.877511,1455.097778,1448.731934
A7R00652.ARW,False,uhdr90half,1623574,1623574,0,6613,152.104,250.804,102.681,94.262,16.397,15.721,15.822,4.771175,24.983455,2.058087,10.877511,1433.6875,1448.731934
A7R00652.ARW,False,uhdr95full,3027877,3027877,0,3546,232.946,269.318,120.331,109.41,20.879,20.169,20.66,3.843596,15.77031,1.795709,8.291059,1451.925781,1448.731934
A7R00652.ARW,False,uhdr95half,2574705,2574705,0,4170,151.037,257.716,108.399,97.766,20.776,20.378,20.768,3.986699,23.070356,1.795709,8.291059,1439.238403,1448.731934
A7R00652.ARW,False,avif90,3290906,989069,2301837,3262,270.564,83.891,82.312,83.638,19.854,20.141,19.984,4.84499,21.001585,1.773501,8.260241,1563.5625,1448.731934
A7R00652.ARW,False,avif95,4104963,1803126,2301837,2615,358.472,128.927,125.373,124.837,20.289,19.846,19.883,3.517169,14.367087,1.773501,8.260241,1455.409912,1448.731934
A7R00652.ARW,False,jxl90,3766311,2032104,1734207,2850,196.844,144.504,49.712,23.193,117.297,38.628,19.228,3.299469,15.398478,1.687301,8.25362,1446.290405,1448.731934
A7R00652.ARW,False,jxl95,5799942,3127464,2672478,1851,223.381,162.704,54.3,27.314,137.242,46.754,21.891,2.358508,11.291522,1.277334,5.698819,1449.935913,1448.731934
A7R00652.ARW,False,half-zstd,43599676,22102270,21497406,246,210.791,28.289,27.14,26.946,28.868,28.021,28.043,0.0,0.0,0.0,0.0,1448.731934,1448.731934
DSC00636.ARW,False,uhdr90full,1109205,1109205,0,9680,219.214,256.26,108.034,97.695,12.772,12.006,12.034,2.768983,16.098792,1.309897,6.831506,1282.230591,1307.500977
DSC00636.ARW,False,uhdr90half,873302,873302,0,12295,159.82,247.401,98.268,88.292,12.168,11.954,12.388,2.80863,16.814401,1.309897,6.831506,880.988281,1307.500977
DSC00636.ARW,False,uhdr95full,1957497,1957497,0,5485,224.206,264.957,114.418,112.192,15.814,14.856,14.892,2.390944,12.403907,1.196151,5.80477,1236.238281,1307.500977
DSC00636.ARW,False,uhdr95half,1424997,1424997,0,7535,150.143,256.018,102.151,97.745,15.313,14.786,14.835,2.420503,13.140963,1.196151,5.80477,936.496094,1307.500977
DSC00636.ARW,False,avif90,1702388,481389,1220999,6307,211.009,60.46,59.561,61.779,14.656,14.872,15.486,2.639469,16.660188,1.15872,5.787957,1238.660034,1307.500977
DSC00636.ARW,False,avif95,2140616,919617,1220999,5016,265.179,91.585,82.883,83.182,14.632,14.545,14.561,2.072443,10.9914,1.15872,5.787957,1261.054321,1307.500977
DSC00636.ARW,False,jxl90,1746327,930832,815495,6148,181.853,117.958,38.954,21.701,99.627,36.199,17.035,1.931376,11.09948,1.101003,5.267541,1289.056152,1307.500977
DSC00636.ARW,False,jxl95,2866774,1519600,1347174,3745,204.818,139.429,46.533,24.597,124.427,37.707,19.855,1.47373,8.053036,0.935041,4.012794,1310.68689,1307.500977
DSC00636.ARW,False,half-zstd,41978666,20891028,21087638,255,269.695,31.201,30.643,30.914,29.917,29.038,29.532,0.0,0.0,0.0,0.0,1307.500977,1307.500977
2L1B8631.CR2,False,uhdr90full,1028228,1028228,0,10442,217.685,258.955,114.839,103.066,14.511,11.501,11.447,2.493491,14.394796,1.333023,8.10586,1936.42981,1936.4198
2L1B8631.CR2,False,uhdr90half,819753,819753,0,13098,149.283,247.15,97.803,91.065,11.762,11.452,11.702,2.536041,14.834384,1.333023,8.10586,1901.539185,1936.4198
2L1B8631.CR2,False,uhdr95full,1797131,1797131,0,5974,242.428,263.456,115.154,115.918,15.189,15.413,17.746,2.181368,11.830876,1.22593,6.984531,1939.601562,1936.4198
2L1B8631.CR2,False,uhdr95half,1342524,1342524,0,7997,150.811,250.558,101.445,98.757,15.141,14.352,14.317,2.211931,12.147284,1.22593,6.984531,1893.609375,1936.4198
2L1B8631.CR2,False,avif90,1613680,439388,1174292,6653,187.018,54.231,55.098,55.526,14.274,14.171,14.168,2.513269,15.940118,1.161234,6.943993,2046.201538,1936.4198
2L1B8631.CR2,False,avif95,1992101,817809,1174292,5389,225.923,75.279,79.639,78.847,14.132,14.735,14.322,2.026297,11.842744,1.161234,6.943993,1974.048584,1936.4198
2L1B8631.CR2,False,jxl90,1727908,955215,772693,6214,181.182,117.578,42.131,21.476,97.513,34.279,19.24,1.739217,10.25455,1.081645,6.258243,1955.325806,1936.4198
2L1B8631.CR2,False,jxl95,2906917,1621408,1285509,3693,190.151,132.832,46.126,23.035,111.847,38.311,18.573,1.291361,7.340211,0.875018,4.588991,1993.490234,1936.4198
2L1B8631.CR2,False,half-zstd,40644584,20952523,19692061,264,257.263,33.765,33.338,33.817,34.555,34.585,34.657,0.0,0.0,0.0,0.0,1936.4198,1936.4198
IMG_3129.CR2,False,uhdr90full,1084342,1084342,0,9902,212.158,260.202,109.086,100.419,13.582,12.88,12.995,5.315421,28.056096,1.818548,8.891818,2056.960938,1900.063477
IMG_3129.CR2,False,uhdr90half,905916,905916,0,11852,152.947,248.82,99.103,92.487,13.337,13.08,12.919,5.052674,31.084099,1.818548,8.891818,2030.0,1900.063477
IMG_3129.CR2,False,uhdr95full,1857340,1857340,0,5781,217.146,263.774,113.839,107.78,16.796,15.887,16.099,4.739126,22.789507,1.618026,7.573163,2030.0,1900.063477
IMG_3129.CR2,False,uhdr95half,1502164,1502164,0,7147,149.912,253.519,103.683,93.848,16.416,16.06,16.083,4.466538,27.574932,1.618026,7.573163,2056.960938,1900.063477
IMG_3129.CR2,False,avif90,1867915,525404,1342511,5748,227.328,64.976,64.447,64.601,15.516,15.59,15.642,4.91517,25.978224,1.595901,7.555815,2178.935791,1900.063477
IMG_3129.CR2,False,avif95,2615954,1273443,1342511,4104,309.368,103.142,103.734,104.819,15.642,15.547,15.725,3.454296,14.909108,1.595901,7.555815,2027.917358,1900.063477
IMG_3129.CR2,False,jxl90,2000597,1109492,891105,5367,183.234,124.041,42.197,21.906,104.475,36.812,17.933,3.7492,22.166738,1.566535,7.009639,1905.58313,1900.063477
IMG_3129.CR2,False,jxl95,3626033,1974531,1651502,2961,211.667,144.182,50.262,24.974,123.892,40.706,19.919,2.802266,16.820051,1.254434,5.418895,1900.52002,1900.063477
IMG_3129.CR2,False,half-zstd,43184329,21539431,21644898,248,195.886,28.483,27.493,27.052,27.756,26.647,26.558,0.0,0.0,0.0,0.0,1900.063477,1900.063477
P6200170.ORF,False,uhdr90full,1048457,1048457,0,10241,244.986,289.128,120.284,110.761,13.608,13.122,13.534,4.124324,19.579014,1.333398,6.96746,1698.53894,1681.140381
P6200170.ORF,False,uhdr90half,846633,846633,0,12682,168.545,278.931,115.411,104.793,14.101,13.133,13.194,4.048157,21.576222,1.333398,6.96746,1681.09375,1681.140381
P6200170.ORF,False,uhdr95full,1872151,1872151,0,5735,251.126,296.138,128.234,115.35,16.983,16.45,16.224,3.66122,16.803779,1.209707,6.025315,1698.53894,1681.140381
P6200170.ORF,False,uhdr95half,1433434,1433434,0,7490,168.997,285.778,115.211,108.266,16.99,16.484,17.092,3.604621,18.866331,1.209707,6.025315,1677.921875,1681.140381
P6200170.ORF,False,avif90,1753074,543926,1209148,6124,203.602,68.379,67.775,69.043,15.79,16.476,15.789,3.8341,19.287144,1.170943,5.987934,1804.684326,1681.140381
P6200170.ORF,False,avif95,2413064,1203916,1209148,4449,274.278,103.887,100.198,100.35,15.657,15.692,15.731,2.741658,12.190664,1.170943,5.987934,1725.567383,1681.140381
P6200170.ORF,False,jxl90,1606213,902533,703680,6684,189.081,129.47,42.779,21.948,108.684,35.032,18.026,3.123528,16.808675,1.189637,6.099091,1697.99353,1681.140381
P6200170.ORF,False,jxl95,2898329,1623789,1274540,3704,204.833,150.639,49.985,26.967,123.631,42.476,21.66,2.369958,12.920002,0.978366,4.775494,1685.447998,1681.140381
P6200170.ORF,False,half-zstd,47446194,24056189,23390005,226,245.535,33.329,32.761,31.961,33.82,32.313,32.243,0.0,0.0,0.0,0.0,1681.140381,1681.140381
DSC08360.ARW,False,uhdr90full,1134719,1134719,0,9462,216.274,258.82,108.297,102.132,14.835,14.248,14.284,7.73141,39.316244,2.78949,9.973838,2145.773438,2117.765625
DSC08360.ARW,False,uhdr90half,1036304,1036304,0,10361,147.59,254.244,102.419,95.551,14.723,14.234,14.026,7.724373,38.560443,2.78949,9.973838,1771.492065,2117.765625
DSC08360.ARW,False,uhdr95full,1884967,1884967,0,5696,217.12,264.754,112.596,110.66,18.517,17.723,18.697,6.794795,34.343367,2.500225,8.91726,2139.429688,2117.765625
DSC08360.ARW,False,uhdr95half,1781218,1781218,0,6028,156.074,256.906,107.319,98.188,18.985,17.899,18.459,6.768715,33.925423,2.500225,8.91726,1838.101685,2117.765625
DSC08360.ARW,False,avif90,2458370,803424,1654946,4367,201.508,78.047,79.557,78.375,17.659,17.958,17.662,7.469112,30.219393,2.496685,8.919878,2362.471436,2117.765625
DSC08360.ARW,False,avif95,3664900,2009954,1654946,2929,294.497,131.88,131.99,132.35,17.765,17.875,18.622,4.612718,16.190593,2.496685,8.919878,2102.057617,2117.765625
DSC08360.ARW,False,jxl90,2523059,1383095,1139964,4255,188.93,135.755,46.137,22.782,115.792,40.4,18.689,5.849274,31.640283,2.299505,7.539918,2129.796631,2117.765625
DSC08360.ARW,False,jxl95,4630250,2493854,2136396,2318,213.024,157.539,54.337,27.618,136.535,46.4,25.72,4.156671,24.000791,1.728668,5.776985,2126.813477,2117.765625
DSC08360.ARW,False,half-zstd,41361885,20541891,20819994,259,214.404,30.902,29.051,29.766,27.968,27.019,27.355,0.0,0.0,0.0,0.0,2117.765625,2117.765625
DSCF4011.RAF,False,uhdr90full,1630594,1630594,0,6584,218.724,264.915,113.139,105.033,17.774,16.368,16.102,9.072275,38.489785,2.836924,12.875242,6134.405762,5372.501465
DSCF4011.RAF,False,uhdr90half,1500689,1500689,0,7154,152.91,254.148,103.797,99.074,16.911,16.27,16.952,9.013212,40.394355,2.836924,12.875242,4193.21875,5372.501465
DSCF4011.RAF,False,uhdr95full,2923095,2923095,0,3673,222.958,275.674,122.902,120.004,23.682,22.828,21.913,7.587303,31.749111,2.384444,10.751376,5601.53125,5372.501465
DSCF4011.RAF,False,uhdr95half,2632882,2632882,0,4078,156.725,262.028,111.04,108.265,22.603,22.076,22.132,7.437974,34.015591,2.384444,10.751376,4567.5,5372.501465
DSCF4011.RAF,False,avif90,3663896,1247331,2416565,2930,317.314,95.089,94.425,96.401,21.449,21.389,21.379,8.615265,34.414333,2.372073,10.806664,6774.648926,5372.501465
DSCF4011.RAF,False,avif95,5107602,2691037,2416565,2102,421.822,155.828,159.321,157.623,21.467,21.3,21.44,5.086369,18.491787,2.372073,10.806664,5742.396973,5372.501465
DSCF4011.RAF,False,jxl90,3968735,2175189,1793546,2705,203.402,151.608,51.708,25.743,127.546,43.534,20.837,6.420572,30.312049,2.342169,10.68138,5502.745117,5372.501465
DSCF4011.RAF,False,jxl95,6568705,3526099,3042606,1634,229.839,174.708,58.67,29.06,151.054,53.087,24.068,4.203545,21.019935,1.645378,7.643357,5357.018555,5372.501465
DSCF4011.RAF,False,half-zstd,44905218,22355796,22549422,239,153.282,25.55,27.739,24.506,24.642,24.885,24.554,0.0,0.0,0.0,0.0,5372.501465,5372.501465
IMG_7723.CR3,False,uhdr90full,4080575,4080575,0,2631,225.687,286.475,134.786,130.398,13.209,12.704,12.761,2.618414,11.152751,1.388844,6.025007,449.216797,454.543549
IMG_7723.CR3,False,uhdr90half,1263835,1263835,0,8495,149.064,255.246,104.943,97.366,12.861,12.551,12.359,2.589743,11.152178,1.388844,6.025007,445.251953,454.543549
IMG_7723.CR3,False,uhdr95full,6367686,6367686,0,1686,243.759,301.85,148.963,148.25,16.231,15.533,15.8,2.286004,8.90784,1.249844,5.327165,451.595703,454.543549
IMG_7723.CR3,False,uhdr95half,2164322,2164322,0,4961,155.004,259.221,110.752,101.477,16.218,15.578,15.453,2.263309,8.895815,1.249844,5.327165,448.423828,454.543549
IMG_7723.CR3,False,avif90,1678101,414140,1263961,6398,158.172,54.173,53.916,54.804,15.184,14.854,15.725,2.686187,13.659818,1.200324,5.232967,435.781616,454.543549
IMG_7723.CR3,False,avif95,2119336,855375,1263961,5066,192.703,80.588,78.727,80.616,15.196,15.138,15.045,2.131874,8.820935,1.200324,5.232967,443.776459,454.543549
IMG_7723.CR3,False,jxl90,1712985,916766,796219,6268,172.183,116.08,38.845,19.969,98.732,33.297,16.434,2.04652,9.117464,1.221051,5.053361,443.096069,454.543549
IMG_7723.CR3,False,jxl95,2999943,1594619,1405324,3579,187.655,133.464,46.48,22.469,114.845,38.81,18.873,1.58409,6.686129,1.011384,3.908331,445.61731,454.543549
IMG_7723.CR3,False,half-zstd,40499681,20021768,20477913,265,254.582,33.471,32.414,32.278,31.216,30.414,30.293,0.0,0.0,0.0,0.0,454.543549,454.543549
DSC07202.ARW,True,uhdr90full,1484188,1484188,0,7234,215.437,270.739,115.567,111.066,11.096,10.863,10.741,2.315317,11.398822,0.840348,4.350571,275.754883,248.54364
DSC07202.ARW,True,uhdr90half,810297,810297,0,13251,147.223,250.204,101.499,96.068,11.369,10.646,10.839,2.459134,17.782379,0.840348,4.350571,208.352554,248.54364
DSC07202.ARW,True,uhdr95full,2523324,2523324,0,4255,227.117,275.889,122.627,112.884,13.714,13.264,13.261,2.109951,8.735753,0.761745,3.5418,236.899414,248.54364
DSC07202.ARW,True,uhdr95half,1339730,1339730,0,8014,151.128,255.449,103.19,96.617,14.326,13.541,13.373,2.270305,16.724868,0.761745,3.5418,230.15918,248.54364
DSC07202.ARW,True,avif90,1117236,202283,914953,9610,159.99,47.808,47.282,49.175,12.911,12.988,12.779,1.901755,10.932697,0.692368,3.46813,231.210663,248.54364
DSC07202.ARW,True,avif95,1529781,614828,914953,7018,193.059,69.437,69.41,69.917,12.843,12.924,12.774,1.391888,6.421481,0.692368,3.46813,246.735733,248.54364
DSC07202.ARW,True,jxl90,1014602,478657,535945,10582,169.627,111.321,35.507,19.175,97.84,31.24,16.229,1.409683,7.711328,0.644229,2.975888,272.360779,248.54364
DSC07202.ARW,True,jxl95,1951427,899690,1051737,5502,192.352,122.125,41.967,20.766,109.077,37.206,18.16,0.985886,5.333901,0.524709,2.224726,258.275177,248.54364
DSC07202.ARW,True,half-zstd,42892772,21160320,21732452,250,253.553,32.03,30.623,30.562,31.135,30.898,30.607,0.0,0.0,0.0,0.0,248.54364,248.54364
DSC07178.ARW,True,uhdr90full,1203577,1203577,0,8921,228.484,265.021,111.231,106.578,11.017,10.46,10.724,3.030879,23.568448,0.87503,7.718397,762.042969,747.153687
DSC07178.ARW,True,uhdr90half,757917,757917,0,14167,152.642,403.004,160.34,142.348,10.745,10.681,11.065,3.129993,26.973207,0.87503,7.718397,761.25,747.153687
DSC07178.ARW,True,uhdr95full,2096325,2096325,0,5122,222.34,274.499,118.432,110.936,13.661,13.195,12.893,2.738958,16.54122,0.811316,6.276548,762.042969,747.153687
DSC07178.ARW,True,uhdr95half,1255594,1255594,0,8551,154.003,412.698,159.72,153.389,13.622,12.943,13.034,2.864184,21.233001,0.811316,6.276548,765.611328,747.153687
DSC07178.ARW,True,avif90,1286547,361269,925278,8345,196.972,51.136,53.64,54.052,12.666,12.636,13.162,2.121061,19.718028,0.774354,6.222986,756.238159,747.153687
DSC07178.ARW,True,avif95,1769217,843939,925278,6069,248.039,74.256,74.48,75.911,12.601,12.536,13.452,1.476264,10.743169,0.774354,6.222986,756.238159,747.153687
DSC07178.ARW,True,jxl90,1290284,698104,592180,8321,172.821,114.713,38.554,20.008,95.62,33.61,16.441,1.55006,13.272323,0.620578,4.70976,746.277222,747.153687
DSC07178.ARW,True,jxl95,2229322,1184262,1045060,4816,190.52,123.537,42.712,22.587,106.741,35.357,17.842,1.086453,8.986538,0.510838,3.437313,745.962891,747.153687
DSC07178.ARW,True,half-zstd,40768215,21293898,19474317,263,257.602,30.15,32.95,28.08,30.435,32.095,30.34,0.0,0.0,0.0,0.0,747.153687,747.153687
DSC07217.ARW,True,uhdr90full,1270749,1270749,0,8449,221.212,269.121,113.461,109.703,11.728,11.747,10.96,3.051183,25.568696,0.930682,8.923864,822.308594,754.369751
DSC07217.ARW,True,uhdr90half,825506,825506,0,13007,145.516,404.141,155.949,147.931,11.793,10.925,11.097,3.211577,28.318239,0.930682,8.923864,810.414062,754.369751
DSC07217.ARW,True,uhdr95full,2205959,2205959,0,4867,223.929,276.128,119.484,119.26,14.732,14.042,14.818,2.707285,18.177914,0.847176,6.722365,813.585999,754.369751
DSC07217.ARW,True,uhdr95half,1381898,1381898,0,7770,152.397,409.702,160.382,148.905,14.523,13.926,13.978,2.913429,22.190505,0.847176,6.722365,794.554688,754.369751
DSC07217.ARW,True,avif90,1437535,397217,1040318,7469,253.165,56.465,56.77,57.374,13.376,13.273,13.349,2.418645,23.343419,0.776497,6.722324,905.068115,754.369751
DSC07217.ARW,True,avif95,2017425,977107,1040318,5322,324.854,81.724,80.474,81.781,13.464,13.304,13.501,1.644063,12.908764,0.776497,6.722324,834.815002,754.369751
DSC07217.ARW,True,jxl90,1484452,806538,677914,7233,178.367,117.465,41.401,20.815,97.292,34.379,16.545,1.768412,15.75624,0.65381,5.818935,771.520447,754.369751
DSC07217.ARW,True,jxl95,2620382,1402324,1218058,4097,193.204,128.411,45.626,27.95,109.677,39.282,26.612,1.235287,10.60142,0.53073,4.123221,763.228149,754.369751
DSC07217.ARW,True,half-zstd,41049542,21588332,19461210,261,252.599,30.23,28.83,28.556,30.629,29.008,29.243,0.0,0.0,0.0,0.0,754.369751,754.369751
DSC07147.ARW,False,avif100,22916406,7235136,15681270,468,1577.663,352.122,353.66,356.234,753.624,753.073,756.288,0.675519,1.634115,0.019637,0.058417,191.827667,192.049759
DSC07147.ARW,False,jxl99.9,10541391,5510154,5031237,1018,262.692,199.221,70.302,33.091,180.551,61.86,31.582,1.518619,6.518206,0.710883,2.737941,189.949158,192.049759
DSC07147.ARW,False,jxl100,37444388,18039351,19405037,286,299.47,405.97,155.954,64.656,404.428,145.507,63.513,0.005473,0.013671,0.001229,0.003653,192.046524,192.049759
DSC07333.ARW,False,avif100,22754711,6952287,15802424,471,1725.945,334.37,328.094,328.769,753.411,748.375,748.551,0.660441,1.597959,0.016882,0.053704,1921.622437,1901.828613
DSC07333.ARW,False,jxl99.9,10577741,5504069,5073672,1015,257.227,197.377,64.344,31.675,180.941,61.846,28.487,1.309615,5.598901,0.611214,2.422869,1903.716064,1901.828613
DSC07333.ARW,False,jxl100,37230785,17704101,19526684,288,246.109,399.822,148.609,63.529,400.782,147.35,63.244,0.005411,0.013405,0.001046,0.00334,1901.851196,1901.828613
DSC07518.ARW,False,avif100,22359620,6454356,15905264,480,1656.065,300.983,299.14,303.928,745.192,747.039,751.285,0.623828,1.589841,0.014411,0.052081,325.363708,324.265564
DSC07518.ARW,False,jxl99.9,9958579,5208580,4749999,1078,254.741,194.782,64.258,32.218,176.829,58.876,28.913,1.067982,5.086289,0.517036,2.255829,327.433167,324.265564
DSC07518.ARW,False,jxl100,37131225,17189129,19942096,289,234.164,400.541,148.703,63.154,403.794,149.009,63.597,0.005222,0.013848,0.000895,0.003276,324.260162,324.265564
DSC_3931.NEF,False,avif100,17664542,4708444,12956098,607,1427.683,236.41,238.213,240.109,662.56,665.258,663.138,0.673545,1.56773,0.018159,0.054168,202.915085,201.087601
DSC_3931.NEF,False,jxl99.9,7410261,3890947,3519314,1448,241.241,180.464,61.99,30.129,163.792,53.982,27.229,0.79534,3.315468,0.495403,1.826435,201.010498,201.087601
DSC_3931.NEF,False,jxl100,32444482,15106175,17338307,330,237.601,403.288,143.498,62.559,398.244,145.995,62.905,0.005649,0.014001,0.001121,0.003359,201.098587,201.087601
2025_0730_1331_3.arw,False,avif100,26555032,9089151,17465881,404,1973.789,463.567,465.948,465.269,789.134,790.114,808.031,0.724941,1.822173,0.016631,0.053656,1620.625977,1609.377197
2025_0730_1331_3.arw,False,jxl99.9,12125161,6371745,5753416,885,274.185,205.074,70.35,33.307,188.214,64.37,31.098,2.564612,12.060981,0.695237,2.909008,1627.513916,1609.377197
2025_0730_1331_3.arw,False,jxl100,39591438,19652878,19938560,271,249.068,406.049,151.32,65.037,402.989,148.399,62.988,0.005754,0.014295,0.001044,0.003367,1609.401001,1609.377197
DSCF6495.RAF,False,avif100,25983964,8053067,17930897,413,1886.128,396.184,396.827,401.804,803.474,803.063,804.806,0.714267,1.712424,0.017523,0.051663,2009.798218,2000.325562
DSCF6495.RAF,False,jxl99.9,11926807,6196205,5730602,900,255.319,201.833,69.825,30.929,185.953,59.131,28.701,1.580332,8.59909,0.707262,2.971062,2010.316528,2000.325562
DSCF6495.RAF,False,jxl100,39296332,19017404,20278928,273,239.47,402.742,143.567,63.484,400.913,141.032,61.252,0.00591,0.015211,0.001087,0.003212,2000.483765,2000.325562
A7R00619.ARW,False,avif100,21790318,6258476,15531842,492,1962.938,322.853,325.569,327.646,698.376,698.587,709.648,0.67277,1.564659,0.017005,0.051917,2258.656494,2261.781738
A7R00619.ARW,False,jxl99.9,9983603,5456454,4527149,1075,253.641,191.959,67.205,30.798,166.35,54.994,26.582,0.918013,5.224487,0.488408,2.325197,2262.79126,2261.781738
A7R00619.ARW,False,jxl100,34501784,16354929,18146855,311,228.426,401.579,141.892,65.638,396.148,154.759,61.18,0.00555,0.013768,0.001056,0.003232,2261.839111,2261.781738
IMG_0790.CR2,False,avif100,31508415,11341807,20166608,340,2119.071,591.593,593.24,592.703,843.786,848.888,843.469,0.725865,1.913789,0.012125,0.045504,1804.684326,1789.357422
IMG_0790.CR2,False,jxl99.9,14432952,7512881,6920071,743,284.755,214.417,75.506,33.343,199.081,70.191,30.479,3.322882,17.254168,0.656001,3.254639,1790.989258,1789.357422
IMG_0790.CR2,False,jxl100,42117583,21044806,21072777,254,229.233,410.167,148.606,62.411,415.564,138.328,60.696,0.005741,0.015005,0.000754,0.002874,1789.235352,1789.357422
A7R00652.ARW,False,avif100,24760264,6855112,17905152,433,1970.653,348.696,348.965,347.943,768.683,770.49,776.712,0.677615,1.584106,0.015637,0.047396,1455.409912,1448.731934
A7R00652.ARW,False,jxl99.9,11495967,6172660,5323307,934,270.078,207.348,65.79,31.704,176.641,57.08,27.876,0.916243,4.70299,0.499486,2.188797,1447.302246,1448.731934
A7R00652.ARW,False,jxl100,36178439,17079656,19098783,296,228.038,411.292,145.143,62.047,405.389,143.606,61.394,0.005673,0.014059,0.000975,0.002955,1448.719604,1448.731934
DSC00636.ARW,False,avif100,17955255,4732210,13223045,598,1556.221,262.201,257.732,259.81,647.384,646.719,647.466,0.666072,1.558601,0.019603,0.056696,1307.063477,1307.500977
DSC00636.ARW,False,jxl99.9,6984786,3684394,3300392,1537,239.479,171.982,61.147,28.634,152.729,53.522,25.127,0.711937,3.620924,0.43894,1.781393,1305.564941,1307.500977
DSC00636.ARW,False,jxl100,31483711,14676499,16807212,341,220.637,400.263,144.168,63.359,397.916,152.501,61.241,0.005596,0.01373,0.00121,0.003523,1307.391846,1307.500977
2L1B8631.CR2,False,avif100,17093173,4537139,12556034,628,1710.903,247.343,247.848,247.711,596.484,599.863,599.173,0.653711,1.54875,0.017291,0.052407,1938.940063,1936.4198
2L1B8631.CR2,False,jxl99.9,7006626,3931240,3075386,1532,224.307,174.131,56.571,27.897,145.347,50.557,23.388,0.568552,3.147267,0.364042,1.886445,1946.309204,1936.4198
2L1B8631.CR2,False,jxl100,30685126,14308102,16377024,349,221.179,396.972,147.249,63.856,400.563,143.687,60.86,0.005513,0.013509,0.001078,0.003257,1936.520996,1936.4198
IMG_3129.CR2,False,avif100,19793223,5948102,13845121,542,1634.074,291.626,292.224,293.552,685.346,687.386,687.773,0.7188,1.751435,0.018228,0.056378,1904.460693,1900.063477
IMG_3129.CR2,False,jxl99.9,8780855,4658268,4122587,1222,246.781,185.913,64.566,30.567,169.24,58.727,27.082,1.196546,6.997531,0.548909,2.336555,1899.721924,1900.063477
IMG_3129.CR2,False,jxl100,34396458,16445068,17951390,312,224.615,398.643,141.352,62.374,411.765,142.02,60.488,0.005861,0.015309,0.001138,0.003529,1899.987671,1900.063477
P6200170.ORF,False,avif100,19639520,5952815,13686705,546,1640.781,305.732,306.888,305.92,680.081,679.944,680.536,0.698062,1.728509,0.016667,0.056625,1694.905884,1681.140381
P6200170.ORF,False,jxl99.9,7538297,4157022,3381275,1424,249.019,194.764,65.042,30.994,167.837,56.657,26.698,1.047804,5.567586,0.441825,2.086303,1685.683838,1681.140381
P6200170.ORF,False,jxl100,36270004,17385710,18884294,296,251.881,447.911,170.319,69.418,445.979,161.381,67.392,0.00569,0.015462,0.001047,0.003567,1681.208618,1681.140381
DSC08360.ARW,False,avif100,23001962,7381149,15620813,466,1607.804,360.73,363.613,364.52,746.654,744.752,763.103,0.684678,1.622841,0.020562,0.05769,2102.057617,2117.765625
DSC08360.ARW,False,jxl99.9,10424425,5447409,4977016,1030,270.94,200.504,65.337,31.573,183.085,58.338,28.317,1.579195,10.468149,0.664353,2.418912,2114.328857,2117.765625
DSC08360.ARW,False,jxl100,36858855,17882287,18976568,291,222.875,398.299,146.828,61.763,400.763,143.716,62.131,0.005476,0.012689,0.001268,0.003565,2117.888184,2117.765625
DSCF4011.RAF,False,avif100,26364868,8477121,17887747,407,2067.866,417.996,417.394,420.473,798.028,798.851,798.951,0.666599,1.705817,0.015148,0.054656,5386.053711,5372.501465
DSCF4011.RAF,False,jxl99.9,12943860,6746264,6197596,829,270.112,207.588,66.24,32.445,190.419,62.645,29.734,1.424495,7.967409,0.568541,2.888237,5371.563965,5372.501465
DSCF4011.RAF,False,jxl100,39018819,18919379,20099440,275,238.624,408.715,142.271,64.509,405.015,149.481,62.837,0.005393,0.013535,0.000946,0.003438,5372.330078,5372.501465
IMG_7723.CR3,False,avif100,18444690,4813931,13630759,582,1408.971,247.786,248.389,253.536,672.889,676.47,674.194,0.676315,1.597697,0.017402,0.049741,456.037079,454.543549
IMG_7723.CR3,False,jxl99.9,7683787,4052391,3631396,1397,233.655,179.023,57.919,28.56,159.153,51.299,25.118,0.750932,3.109864,0.471716,1.734667,451.853699,454.543549
IMG_7723.CR3,False,jxl100,32392732,15041347,17351385,331,237.371,402.557,136.436,62.539,400.134,144.616,60.28,0.005803,0.014518,0.001088,0.00309,454.552612,454.543549
DSC07202.ARW,True,avif100,14741602,3515154,11226448,728,1301.821,200.982,201.432,204.042,580.044,581.787,586.235,0.688272,1.704481,0.016895,0.053909,249.033493,248.54364
DSC07202.ARW,True,jxl99.9,4635302,2171668,2463634,2316,206.873,138.404,46.86,24.085,131.387,43.848,21.86,0.495189,2.791518,0.173431,0.94103,256.712799,248.54364
DSC07202.ARW,True,jxl100,26940881,12384456,14556425,398,226.156,398.334,141.04,61.688,396.364,154.308,61.769,0.005447,0.014073,0.001062,0.003394,248.531845,248.54364
DSC07178.ARW,True,avif100,13835944,3997990,9837954,776,1417.38,215.782,215.977,216.644,487.146,486.401,487.583,0.632851,1.618893,0.016861,0.05522,756.238159,747.153687
DSC07178.ARW,True,jxl99.9,5051706,2689781,2361925,2125,211.762,146.99,48.504,25.541,128.608,44.539,22.026,0.516112,3.48907,0.161705,1.429002,748.270447,747.153687
DSC07178.ARW,True,jxl100,27841886,13250401,14591485,385,249.932,405.858,145.922,63.971,398.516,150.522,63.121,0.005116,0.013488,0.001071,0.003499,747.115784,747.153687
DSC07217.ARW,True,avif100,14905376,4408317,10497059,720,1768.03,239.285,235.671,234.897,520.973,523.496,525.282,0.606853,1.642947,0.015135,0.053133,763.068726,754.369751
DSC07217.ARW,True,jxl99.9,5932930,3154615,2778315,1809,220.409,159.699,53.789,25.969,140.739,45.615,23.219,0.572353,4.148295,0.193314,1.703327,757.252747,754.369751
DSC07217.ARW,True,jxl100,29397287,13738084,15659203,365,231.451,407.442,149.919,65.239,404.695,146.238,63.464,0.004964,0.013682,0.000953,0.003367,754.388123,754.369751
DSC07147.ARW,False,avif99tiled-png,11829294,4939567,6889727,907,451.015,224.765,74.031,53.539,39.948,40.334,39.93,1.670769,5.293331,0.314802,0.93617,197.297241,192.049759
DSC07147.ARW,False,avif100tiled-png,14127101,7237374,6889727,760,441.872,359.518,135.583,80.572,39.694,40.155,40.028,0.675519,1.634115,0.314802,0.93617,191.827667,192.049759
DSC07147.ARW,False,jxl100s8,24269899,18039351,6230548,442,227.943,397.437,151.066,64.972,366.373,131.92,59.068,0.005473,0.013671,0.314802,0.93617,192.046524,192.049759
DSC07333.ARW,False,avif99tiled-png,11599163,4614758,6984405,925,430.037,207.908,78.25,50.221,41.55,40.852,40.709,1.656534,5.142914,0.270917,0.861611,1904.460693,1901.828613
DSC07333.ARW,False,avif100tiled-png,13939490,6955085,6984405,770,432.613,327.471,109.957,70.312,41.001,40.553,40.845,0.660441,1.597959,0.270917,0.861611,1921.622437,1901.828613
DSC07333.ARW,False,jxl100s8,24044562,17704101,6340461,446,232.315,400.433,156.222,63.914,367.673,136.219,58.879,0.005411,0.013405,0.270917,0.861611,1901.851196,1901.828613
DSC07518.ARW,False,avif99tiled-png,11259399,4090596,7168803,953,418.769,191.292,72.563,48.391,42.215,41.097,41.305,1.529881,4.751361,0.231074,0.834909,328.361786,324.265564
DSC07518.ARW,False,avif100tiled-png,13625855,6457052,7168803,788,432.343,304.95,106.697,68.719,42.06,41.396,42.228,0.623828,1.589841,0.231074,0.834909,325.363708,324.265564
DSC07518.ARW,False,jxl100s8,23889431,17189129,6700302,449,231.843,402.143,147.964,62.723,371.653,132.495,57.513,0.005222,0.013848,0.231074,0.834909,324.260162,324.265564
DSC_3931.NEF,False,avif99tiled-png,7851971,2384918,5467053,1367,341.379,147.02,59.061,44.618,32.358,32.532,32.394,1.403445,4.336621,0.290512,0.861063,202.915085,201.087601
DSC_3931.NEF,False,avif100tiled-png,10178212,4711159,5467053,1054,398.628,239.243,94.062,65.152,32.381,32.926,33.009,0.673545,1.56773,0.290512,0.861063,202.915085,201.087601
DSC_3931.NEF,False,jxl100s8,19547709,15106175,4441534,549,206.798,402.208,148.725,61.534,370.651,137.512,54.711,0.005649,0.014001,0.290512,0.861063,201.098587,201.087601
2025_0730_1331_3.arw,False,avif99tiled-png,13876989,6435473,7441516,773,452.073,299.46,101.682,65.654,44.236,45.273,44.57,1.915891,6.366756,0.267458,0.8615,1756.786743,1609.377197
2025_0730_1331_3.arw,False,avif100tiled-png,16534613,9093097,7441516,649,486.737,466.557,146.223,91.369,44.99,44.331,45.576,0.724941,1.822173,0.267458,0.8615,1620.625977,1609.377197
2025_0730_1331_3.arw,False,jxl100s8,26420983,19652878,6768105,406,236.582,404.085,145.301,63.341,374.168,131.463,58.503,0.005754,0.014295,0.267458,0.8615,1609.401001,1609.377197
DSCF6495.RAF,False,avif99tiled-png,12958396,5122392,7836004,828,459.162,249.995,88.323,56.432,46.357,46.66,46.663,1.75473,5.573751,0.280946,0.828131,2027.917358,2000.325562
DSCF6495.RAF,False,avif100tiled-png,15893012,8057008,7836004,675,474.889,397.435,149.736,89.143,46.128,46.817,46.178,0.714267,1.712424,0.280946,0.828131,2009.798218,2000.325562
DSCF6495.RAF,False,jxl100s8,26065075,19017404,7047671,411,216.606,403.294,149.024,62.291,372.082,145.332,56.813,0.00591,0.015211,0.280946,0.828131,2000.483765,2000.325562
A7R00619.ARW,False,avif99tiled-png,10381344,3692592,6688752,1034,500.563,205.567,76.989,58.231,36.027,36.171,36.396,1.524632,5.340009,0.27443,0.831246,2383.806885,2261.781738
A7R00619.ARW,False,avif100tiled-png,12950322,6261570,6688752,829,549.138,323.586,119.813,86.684,36.035,36.202,36.19,0.67277,1.564659,0.27443,0.831246,2258.656494,2261.781738
A7R00619.ARW,False,jxl100s8,21696036,16354929,5341107,494,212.722,401.221,149.637,68.835,371.043,133.516,62.142,0.00555,0.013768,0.27443,0.831246,2261.839111,2261.781738
IMG_0790.CR2,False,avif99tiled-png,16274138,8030106,8244032,659,487.23,398.18,131.261,77.416,37.33,37.16,37.559,2.044354,6.923806,0.191779,0.729148,1820.940552,1789.357422
IMG_0790.CR2,False,avif100tiled-png,19590293,11346261,8244032,548,533.335,591.566,217.48,123.945,37.6,36.856,36.96,0.725865,1.913789,0.191779,0.729148,1804.684326,1789.357422
IMG_0790.CR2,False,jxl100s8,29037854,21044806,7993048,369,233.182,415.809,149.186,62.082,391.499,130.206,58.809,0.005741,0.015005,0.191779,0.729148,1789.235352,1789.357422
A7R00652.ARW,False,avif99tiled-png,11733391,4145196,7588195,915,478.927,230.026,84.746,58.262,38.875,39.288,38.939,1.641781,5.369453,0.25263,0.760624,1455.409912,1448.731934
A7R00652.ARW,False,avif100tiled-png,14446319,6858124,7588195,743,558.687,354.571,126.275,89.216,38.482,38.557,38.574,0.677615,1.584106,0.25263,0.760624,1455.409912,1448.731934
A7R00652.ARW,False,jxl100s8,23240009,17079656,6160353,462,213.149,400.486,152.77,66.74,371.78,131.527,56.736,0.005673,0.014059,0.25263,0.760624,1448.719604,1448.731934
DSC00636.ARW,False,avif99tiled-png,7764380,2344679,5419701,1382,372.164,147.252,58.513,42.847,35.725,36.071,35.63,1.284544,4.613137,0.314038,0.907584,1283.853027,1307.500977
DSC00636.ARW,False,avif100tiled-png,10154272,4734571,5419701,1057,428.747,251.729,99.109,68.295,35.749,35.979,35.559,0.666072,1.558601,0.314038,0.907584,1307.063477,1307.500977
DSC00636.ARW,False,jxl100s8,18817849,14676499,4141350,570,205.454,397.579,153.681,62.527,368.129,132.497,56.051,0.005596,0.01373,0.314038,0.907584,1307.391846,1307.500977
2L1B8631.CR2,False,avif99tiled-png,7870655,2188638,5682017,1364,361.756,141.615,63.242,46.538,37.696,37.612,38.12,1.256153,4.82587,0.279891,0.837219,2009.798218,1936.4198
2L1B8631.CR2,False,avif100tiled-png,10218743,4536726,5682017,1050,427.656,248.949,98.591,73.088,37.714,38.202,37.577,0.653711,1.54875,0.279891,0.837219,1938.940063,1936.4198
2L1B8631.CR2,False,jxl100s8,18313924,14308102,4005822,586,201.09,401.013,147.797,61.638,371.914,142.158,55.316,0.005513,0.013509,0.279891,0.837219,1936.520996,1936.4198
IMG_3129.CR2,False,avif99tiled-png,9501052,3444235,6056817,1130,399.014,184.027,67.913,50.226,37.864,38.178,38.394,1.612591,5.46524,0.29267,0.902401,1904.460693,1900.063477
IMG_3129.CR2,False,avif100tiled-png,12007002,5950185,6056817,894,447.802,293.825,108.659,75.405,37.905,37.913,38.117,0.7188,1.751435,0.29267,0.902401,1904.460693,1900.063477
IMG_3129.CR2,False,jxl100s8,21400173,16445068,4955105,501,199.823,401.435,149.317,60.907,367.304,132.926,55.385,0.005861,0.015309,0.29267,0.902401,1899.987671,1900.063477
P6200170.ORF,False,avif99tiled-png,9098084,3256271,5841813,1180,399.846,185.579,70.391,56.809,38.517,37.781,39.043,1.392933,4.714934,0.268126,0.909401,1710.16748,1681.140381
P6200170.ORF,False,avif100tiled-png,11797493,5955680,5841813,910,443.156,307.839,109.201,77.996,37.995,38.261,38.041,0.698062,1.728509,0.268126,0.909401,1694.905884,1681.140381
P6200170.ORF,False,jxl100s8,22032624,17385710,4646914,487,223.818,445.63,174.331,69.852,420.231,152.327,62.437,0.00569,0.015462,0.268126,0.909401,1681.208618,1681.140381
DSC08360.ARW,False,avif99tiled-png,11617788,4910915,6706873,924,392.688,237.521,85.479,53.657,38.548,38.399,38.803,1.690194,5.345896,0.330381,0.925224,2121.016602,2117.765625
DSC08360.ARW,False,avif100tiled-png,14091206,7384333,6706873,761,437.15,363.533,134.189,84.366,38.655,38.39,38.419,0.684678,1.622841,0.330381,0.925224,2102.057617,2117.765625
DSC08360.ARW,False,jxl100s8,23749379,17882287,5867092,452,203.038,401.678,144.357,62.452,365.165,138.116,56.223,0.005476,0.012689,0.330381,0.925224,2117.888184,2117.765625
DSCF4011.RAF,False,avif99tiled-png,13431305,5772531,7658774,799,536.484,270.73,97.316,61.595,45.139,45.334,45.483,1.770856,5.914548,0.24274,0.879253,5435.532715,5372.501465
DSCF4011.RAF,False,avif100tiled-png,16138806,8480032,7658774,665,520.272,419.256,142.087,85.605,45.781,47.906,45.955,0.666599,1.705817,0.24274,0.879253,5386.053711,5372.501465
DSCF4011.RAF,False,jxl100s8,25816995,18919379,6897616,415,213.998,401.764,155.864,63.03,366.918,141.088,62.802,0.005393,0.013535,0.24274,0.879253,5372.330078,5372.501465
IMG_7723.CR3,False,avif99tiled-png,8229106,2411955,5817151,1304,349.987,149.368,60.696,44.22,35.663,36.227,35.716,1.339359,4.31018,0.281464,0.794946,456.037079,454.543549
IMG_7723.CR3,False,avif100tiled-png,10632015,4814864,5817151,1009,395.582,248.583,95.813,72.697,35.655,35.759,36.536,0.676315,1.597697,0.281464,0.794946,456.037079,454.543549
IMG_7723.CR3,False,jxl100s8,19516615,15041347,4475268,550,200.587,395.648,136.793,61.129,362.992,135.183,55.285,0.005803,0.014518,0.281464,0.794946,454.552612,454.543549
DSC07202.ARW,True,avif99tiled-png,6174461,1647755,4526706,1739,305.311,104.352,43.443,33.337,26.606,26.471,26.62,0.948063,3.414108,0.268701,0.866321,253.690674,248.54364
DSC07202.ARW,True,avif100tiled-png,8044728,3518022,4526706,1334,355.838,200.257,85.072,56.19,26.721,26.562,26.779,0.688272,1.704481,0.268701,0.866321,249.033493,248.54364
DSC07202.ARW,True,jxl100s8,15524138,12384456,3139682,691,196.592,402.97,153.945,61.617,365.749,133.544,55.612,0.005447,0.014073,0.268701,0.866321,248.531845,248.54364
DSC07178.ARW,True,avif99tiled-png,6212802,2027622,4185180,1728,326.171,119.716,58.49,41.942,27.984,28.103,28.021,0.931084,3.945744,0.266849,0.887206,756.238159,747.153687
DSC07178.ARW,True,avif100tiled-png,8186386,4001206,4185180,1311,375.484,223.478,88.578,69.614,28.137,28.777,30.363,0.632851,1.618893,0.266849,0.887206,756.238159,747.153687
DSC07178.ARW,True,jxl100s8,16385941,13250401,3135540,655,207.359,412.203,145.697,63.606,372.379,140.751,56.647,0.005116,0.013488,0.266849,0.887206,747.115784,747.153687
DSC07217.ARW,True,avif99tiled-png,6776676,2284973,4491703,1584,359.966,128.934,59.42,41.078,27.092,27.237,27.15,0.960226,4.539023,0.243309,0.855637,783.927856,754.369751
DSC07217.ARW,True,avif100tiled-png,8903655,4411952,4491703,1205,409.116,237.109,95.717,58.593,27.105,28.068,27.325,0.606853,1.642947,0.243309,0.855637,763.068726,754.369751
DSC07217.ARW,True,jxl100s8,17319735,13738084,3581651,619,211.087,403.697,158.358,63.811,366.607,126.225,56.318,0.004964,0.013682,0.243309,0.855637,754.388123,754.369751
```

</details>

<details>
<summary>Ultra HDR two-JPEG/WGSL measurements (CSV)</summary>

```csv
photo,setting,JPEG_workers1_ms,JPEG_workers4_ms,JPEG_workers12_ms,CPU_alloc_enqueue_ms,GPU_queued_upload_submit_wait_ms,vs_lib_mean,vs_lib_p999,vs_reference_mean,vs_reference_p999,GPU_peak_nits,lib_peak_nits
DSC07147.ARW,uhdr90full,26.811,14.739,14.087,24.6,21.4,0.82371,2.230049,7.416693,26.539991,187.193085,188.131836
DSC07147.ARW,uhdr90half,16.664,13.961,13.533,11.4,57.2,0.848996,2.391756,7.403598,26.567811,186.727753,188.230957
DSC07147.ARW,uhdr95full,37.984,18.993,18.742,15.9,57.4,0.828388,2.21459,6.73691,23.344021,189.270981,190.114258
DSC07147.ARW,uhdr95half,22.296,18.666,18.328,10.5,54.1,0.872991,2.527117,6.714374,23.424326,191.269699,191.303711
DSC07333.ARW,uhdr90full,21.993,14.053,14.035,16.5,68.2,0.703118,1.888381,6.31799,23.172066,1809.380981,1809.554688
DSC07333.ARW,uhdr90half,15.618,13.883,14.684,10.2,55.2,0.709929,2.156607,6.275948,23.148327,1550.154419,1532.808594
DSC07333.ARW,uhdr95full,30.088,21.134,23.545,16.6,61.5,0.704154,1.902552,5.739525,20.248078,1835.162964,1833.34375
DSC07333.ARW,uhdr95half,21.401,19.433,19.335,10.3,53.8,0.714524,2.161505,5.71833,20.301635,1538.45813,1509.8125
2L1B8631.CR2,uhdr90full,19.952,14.781,14.775,18.8,61.9,0.441539,1.331367,2.524993,14.451549,1936.415405,1936.429688
2L1B8631.CR2,uhdr90half,13.752,12.178,11.791,11.9,12.5,0.518002,4.077018,2.565497,14.912977,1893.495483,1901.539062
2L1B8631.CR2,uhdr95full,25.853,18.286,17.241,17.9,14.2,0.441303,1.337745,2.216872,11.882936,1939.432129,1939.601562
2L1B8631.CR2,uhdr95half,17.755,15.585,15.489,10.3,23.6,0.536603,4.06393,2.243245,12.189875,1894.809448,1893.609375
IMG_3129.CR2,uhdr90full,20.467,15.597,16.161,15.5,27.5,0.772939,2.501226,5.423273,28.110774,2054.050537,2056.960938
IMG_3129.CR2,uhdr90half,15.305,13.93,13.598,10,22.6,1.032456,20.52223,5.074554,30.608906,1927.176025,2030.0
IMG_3129.CR2,uhdr95full,26.391,19.818,19.374,15.5,26.9,0.774156,2.511309,4.857555,22.922706,2027.742065,2030.0
IMG_3129.CR2,uhdr95half,18.51,17.293,16.727,11.3,23.1,1.063513,20.931785,4.505448,26.948806,1941.640137,2056.960938
P6200170.ORF,uhdr90full,21.783,16.643,16.732,23.1,29.6,0.774213,2.600864,4.171867,19.680998,1697.757568,1698.539062
P6200170.ORF,uhdr90half,15.33,13.894,14.39,10.9,27,0.827783,8.004284,4.086207,20.878236,1681.754272,1681.09375
P6200170.ORF,uhdr95full,28.31,20.795,20.3,17.8,28.3,0.772149,2.605137,3.712955,16.968803,1697.757568,1698.539062
P6200170.ORF,uhdr95half,19.86,17.249,17.246,11.3,27.3,0.835059,8.320513,3.645077,18.04501,1677.489746,1677.921875
DSC08360.ARW,uhdr90full,20.264,15.076,16.488,15.7,26.5,0.950988,4.832784,7.793951,39.727422,2144.871582,2145.773438
DSC08360.ARW,uhdr90half,15.762,14.652,14.654,9.8,20.9,0.932162,5.419784,7.766006,38.890375,1671.10437,1771.492188
DSC08360.ARW,uhdr95full,24.931,20.409,20.216,15.6,26,0.953992,4.877362,6.865546,34.833188,2138.678711,2139.429688
DSC08360.ARW,uhdr95half,23.86,18.649,18.533,9.7,23.9,0.946091,5.550304,6.817108,34.299615,1659.387207,1838.101562
DSCF4011.RAF,uhdr90full,23.347,19.023,18.351,16.5,26.3,0.816229,3.165971,9.096723,38.585423,6133.635254,6134.40625
DSCF4011.RAF,uhdr90half,18.245,16.807,16.813,9.8,22.3,0.900341,12.540443,9.019478,38.907288,3793.713623,4193.21875
DSCF4011.RAF,uhdr95full,31.673,24.951,24.875,15.7,28,0.812289,3.190785,7.604879,31.957624,5611.328125,5601.53125
DSCF4011.RAF,uhdr95half,25.168,23.105,22.354,10.1,23.6,0.925359,12.687087,7.445522,32.246919,3628.916992,4567.5
IMG_7723.CR3,uhdr90full,40.6,30.634,32.04,16.2,27,0.499649,1.199146,2.646058,11.192147,448.588867,449.216797
IMG_7723.CR3,uhdr90half,17.375,13.558,14.19,9.7,23.4,0.509258,1.269855,2.617063,11.169872,444.402924,445.251953
IMG_7723.CR3,uhdr95full,52.452,39.851,41.919,15.6,28.6,0.501303,1.199547,2.314701,8.945533,450.673218,451.595703
IMG_7723.CR3,uhdr95half,22.647,17.446,17.479,9.5,23.8,0.515498,1.317942,2.291827,8.930259,447.421539,448.423828
DSC07202.ARW,uhdr90full,23.721,16.682,16.682,16.8,27.1,0.645882,1.77733,2.418682,11.447096,276.129089,275.754883
DSC07202.ARW,uhdr90half,13.817,11.802,11.823,15.4,16.7,1.091091,13.21662,2.499466,15.809438,185.341858,208.352539
DSC07202.ARW,uhdr95full,30.086,17.56,21.344,22.4,63.5,0.645351,1.776325,2.211345,8.854326,237.654846,236.899414
DSC07202.ARW,uhdr95half,17.135,14.75,14.265,9.6,81.4,1.109257,13.358993,2.299719,14.359604,211.099564,230.15918
DSC07178.ARW,uhdr90full,21.675,15.206,14.823,15.8,60.3,0.87077,2.110442,3.019609,23.656981,761.695251,762.042969
DSC07178.ARW,uhdr90half,15.922,11.79,11.775,9.9,56,1.022101,6.786222,3.121527,27.597858,760.084045,761.25
DSC07178.ARW,uhdr95full,28.777,18.883,18.969,15.6,60,0.870531,2.11039,2.710412,16.606125,761.695251,762.042969
DSC07178.ARW,uhdr95half,16.908,14.245,14.349,9.6,51.8,1.02381,6.764251,2.834549,22.278437,764.899841,765.611328
DSC07217.ARW,uhdr90full,22.035,15.457,14.436,15.6,60.6,0.744906,2.072065,3.113082,25.618412,822.952393,822.308594
DSC07217.ARW,uhdr90half,13.916,11.954,11.929,9.6,51.4,0.936092,8.532294,3.27286,28.401997,813.645447,810.414062
DSC07217.ARW,uhdr95full,28.797,19.266,17.475,22.4,67.7,0.746842,2.065959,2.759258,18.289429,813.967834,813.585938
DSC07217.ARW,uhdr95half,17.885,14.754,15.173,9.7,50.4,0.938129,8.514742,2.962517,22.421506,799.326538,794.554688
DSC07518.ARW,uhdr90full,27.128,17.796,15.536,15.3,13.8,0.588786,2.086293,5.086285,22.237179,327.235931,326.108398
DSC07518.ARW,uhdr90half,17.763,15.907,15.9,10.4,54.3,0.611218,2.18706,5.133478,22.427045,327.306458,326.108398
DSC07518.ARW,uhdr95full,38.162,25.676,25.992,15.5,61.3,0.586451,2.084857,4.631117,19.577254,331.927155,333.245117
DSC07518.ARW,uhdr95half,24.658,21.728,21.757,9.9,60.4,0.617617,2.247349,4.698317,19.740145,331.33078,332.055664
DSC_3931.NEF,uhdr90full,47.58,38.987,36.879,15.4,59.2,0.536383,1.320823,2.696632,10.058987,204.826263,203.991211
DSC_3931.NEF,uhdr90half,17.26,13.121,13.346,9.8,50.1,0.547167,1.431945,2.661217,10.005945,203.483826,203.594727
DSC_3931.NEF,uhdr95full,59.838,47.396,48.042,16.1,63.7,0.540069,1.322975,2.440396,8.864133,204.226471,203.594727
DSC_3931.NEF,uhdr95half,21.527,16.506,16.425,10.3,54.3,0.554575,1.456153,2.41167,8.807731,205.110657,203.991211
2025_0730_1331_3.arw,uhdr90full,22.445,17.981,17.715,15.7,57.5,1.407818,8.520198,13.96518,56.838943,2537.408691,2540.671875
2025_0730_1331_3.arw,uhdr90half,18.015,15.384,15.595,9.6,55.3,1.582149,12.889281,14.150996,57.159155,2670.925781,2450.273438
2025_0730_1331_3.arw,uhdr95full,30.913,23.936,23.633,15.5,62.9,1.397732,8.526411,12.152978,51.396328,2008.879272,2007.796875
2025_0730_1331_3.arw,uhdr95half,23.333,21.153,21.758,9.9,51.4,1.651343,12.338823,12.260626,51.899917,2769.378418,2426.484375
DSCF6495.RAF,uhdr90full,24.839,18.968,19.655,15.8,64.8,0.731506,2.010703,7.774654,31.775857,2123.170654,2121.984375
DSCF6495.RAF,uhdr90half,18.704,17.21,17.08,10.1,53.1,0.822538,9.155665,7.684559,31.343913,1884.954712,1966.5625
DSCF6495.RAF,uhdr95full,32.174,24.683,25.045,16.4,61.1,0.731126,2.021189,6.178982,23.317583,2117.75415,2118.8125
DSCF6495.RAF,uhdr95half,24.671,22.152,22.127,9.9,52.9,0.841057,9.204662,6.076098,23.321203,1841.676147,1928.5
A7R00619.ARW,uhdr90full,23.287,17.482,17.12,15.7,66.3,0.546255,1.726802,4.653511,25.197552,2262.399658,2258.375
A7R00619.ARW,uhdr90half,16.815,15.063,14.98,9.9,54.4,0.961237,19.439813,4.804719,30.355839,2241.391113,2240.929688
A7R00619.ARW,uhdr95full,29.962,22.108,21.646,16.2,71.6,0.546339,1.733625,3.887433,18.934377,2254.911865,2256.789062
A7R00619.ARW,uhdr95half,21.87,19.767,18.671,10.6,56.1,0.984362,19.436339,4.09432,26.632737,2229.534668,2233.0
IMG_0790.CR2,uhdr90full,36.185,24.132,23.265,16.7,61.8,1.238405,5.974419,23.386355,117.55029,2653.614014,2650.101562
IMG_0790.CR2,uhdr90half,22.275,20.916,20.535,9.8,56.9,2.906699,36.507691,20.798907,75.289983,2161.550049,2212.382812
IMG_0790.CR2,uhdr95full,49.995,33.337,33.968,15.7,64.6,1.246729,6.492108,17.239595,75.037354,2634.863525,2631.070312
IMG_0790.CR2,uhdr95half,31.964,29.112,28.052,9.9,52,3.325349,35.15059,15.146793,56.719573,2025.158203,2231.414062
A7R00652.ARW,uhdr90full,25.653,20.135,19.597,15.3,61.3,0.485528,1.515549,4.689202,20.030741,1460.276001,1455.097656
A7R00652.ARW,uhdr90half,19.81,17.605,18.238,9.5,56.1,0.74396,16.243278,4.766135,22.857901,1435.880859,1433.6875
A7R00652.ARW,uhdr95full,37.377,25.138,25.319,15.7,60.4,0.484562,1.518612,3.872006,15.84396,1458.33728,1451.925781
A7R00652.ARW,uhdr95half,26.132,21.915,22.934,9.6,52.4,0.763319,16.19485,3.983317,19.851241,1438.098145,1439.238281
DSC00636.ARW,uhdr90full,23.31,16.634,14.758,15.6,60.5,0.539804,1.982816,2.808564,16.174494,1279.829224,1282.230469
DSC00636.ARW,uhdr90half,16.231,13.512,14.378,11.1,52.4,0.566184,2.888408,2.847001,16.830283,783.207764,880.988281
DSC00636.ARW,uhdr95full,30.302,20.385,21.573,16,65.6,0.545359,1.984885,2.433058,12.489208,1233.94458,1236.238281
DSC00636.ARW,uhdr95half,20.272,17.026,19.574,9.5,55.4,0.578041,2.919129,2.462217,13.124992,792.433044,936.496094
```

</details>

## B3 — Cold first-picture profiling (October 26, 2026)

**Partial qualification, no stored-preview work.** Copies of the B2 JPEG/PNG/TIFF/HEIC/JXL samples, disposable app database/profile/cache, cold application scenes, uncontrolled OS file caches. Both 640 and 2560 renderers were warmed by actual draws before each phase. Grid development was suppressed to keep selected-photo development cold. Timing allowance proposed beforehand: 10%; baseline variation exceeded it. These navigation-to-visible results cover more work than B2 and should not be compared directly with its figures.

The driver resumed after fixing a warmup-only instrumentation error, before sample measurements. All ten baseline samples completed. Electron exited during the after phase: JPEG and HEIC have one completed after sample; TIFF presentation was recovered from the backend stopwatch log without a completed canvas capture. No replacement GPU run was launched. Both after repetitions for all five formats were therefore **not completed**.

### Before/after, seconds

Each entry is **first visible / sharp**. First visible may be a temporary original stand-in.

| Format | Before 1 | Before 2 | After 1 | After 2 |
|---|---:|---:|---:|---:|
| JPEG | 6.254 / 6.254 | 7.785 / 7.785 | **0.102 / 6.826** | not reached |
| PNG | 6.154 / 6.154 | 6.138 / 6.277 | not reached | not reached |
| TIFF | 17.257 / 17.257 | 18.595 / 18.595 | 18.533 / 18.533* | not reached |
| HEIC | 9.114 / 9.114 | 11.610 / 12.071 | 10.265 / 10.265 | not reached |
| JXL | 5.004 / 5.198 | 7.112 / 7.258 | not reached | not reached |

*Recovered TIFF log, no earlier quick presentation recorded. No sharp-navigation improvement is established by these partial after samples.*

### Stage breakdown

Baseline GPU-route means, milliseconds. Development includes the following source, GPU, quantile and handoff intervals. Substages overlap their parents; do not sum every row.

| Stage | JPEG | PNG | TIFF |
|---|---:|---:|---:|
| Development total | 5962 | 5017 | 14823 |
| Source request + transfer | 104 | 67 | 518 |
| GPU preparation | 356 | 526 | 962 |
| GPU upload | 39 | 66 | 353 |
| GPU colour + measurement | 138 | 271 | 358 |
| GPU scene reduction | 93 | 90 | 162 |
| GPU readback | 74 | 88 | 74 |
| Quantiles | 10 | 11 | 70 |
| Scene handoff round trip | **5493** | **4413** | **13274** |

Handoff includes transport and backend acceptance, not just network bytes. Its internal cause is not fully isolated. Representative first metadata/claim checks: JPEG 10.1, PNG 4.0, TIFF 9.5 ms. Source body transfers: 14.7, 19.1, 198.6 ms respectively. Sharp scene fetches across formats took about 71–100 ms; viewer GPU wait/draw about 13–63 ms. First JPEG quick-fetch stalled about 2 s; scheduling/backend contention remains a target. Cache-store success was observed after presentation; displaying an available picture does not inherently require cache persistence, although the current scene route awaits backend acceptance before handing it to the viewer.

CPU fallback baseline means, milliseconds:

| Stage | HEIC | JXL |
|---|---:|---:|
| Decode | 2363 | 1461 |
| Normalize/colour including reference | 2036 | 82 |
| Analysis | 612 | 289 |
| Full import | 5012 | 1832 |
| Session render cache | 388 | 113 |
| Highlight source peaks | 71 | <1 |
| Reduction + packing after session preparation | 1660 | 536 |

HEIC first full session preparation took 5355 ms; JXL 1878 ms. HEIF auxiliary reconstruction retains the CPU route; unresolved JXL primaries retain Grade's interpretation gate. Speculative fallback and claim waits are logged, but complete allocation of all scheduling/fallback waits was not obtained.

Telemetry now covers source scheduling/202 sleeps, interpretation/claim, decode/transfer, CPU preparation, GPU upload/colour/measurement/reduction/readback, handoff and existing navigation/draw/store events. New fine CPU fields split luminance, robust channel/BT.2020 measurements, SDR reference, session cache and highlight peaks. Those finer fields were added after the experiment backend started: **this run contains aggregate analysis, not every new measurement split**. Explicit request-wait time counts 202 sleeps; encompassing request time also includes server work.

### Built changes and remaining targets

- Unedited, currently unchanged, resolved sRGB JPEG/PNG can use the decoded original for a temporary quick draw. Grade's shared decoder applies ICC/orientation. Gain-map JPEG and unresolved colour are excluded; source/grade/cache guards run before and after decode. The normal sharp pipeline remains intact. TIFF precision and HEIC/JXL interpretation require separate qualification.
- Live GPU handoff now materializes identical framed bytes as an ArrayBuffer rather than uploading a Blob. JPEG's one after development/handoff was 3014/2517 ms versus baseline means 5962/5493. TIFF's recovered development/handoff was 12065/9157 versus 14823/13274. This suggests a transport improvement, but does not establish an overall sharp-time win. It adds a temporary reduced-scene payload copy, not a full-source copy.
- The original stand-in bypasses ACES scene preparation, luminance/highlight analysis, SDR reference, quantiles, 2560 reduction, readback, backend handoff and cache persistence. All can follow first display. The sharp pipeline still performs them to preserve its result.
- Next structural target: expose 640 before preparing/storing both renditions, then retain GPU results for direct drawing instead of readback → backend upload → fetch → GPU upload. Not implemented here. Faster decoding alone cannot remove the dominant handoff interval.

JPEG finished canvas captures were exactly identical across both before samples and its completed after sample. Other after finished-pixel comparisons remain incomplete. Fast behavioural tests extend source/grade/cache-race guards to JPEG/PNG and verify original quick-draw ICC/orientation against the shared decode. All 13 copied experiment sample hashes matched input copies; no copied-photo sidecars appeared. Live library/database/photos/sidecars/cache were not used.

Fast checks ran once: Node 630 passed, one existing `selected photo joining development-ahead keeps its CPU fallback if GPU fails` failure; Python 2579 passed, three skipped, one unrelated `test_library_native_source_uses_same_repair_before_reduction` test-double failure (`CaptureCache.build` lacks the existing `defer_store` argument). No reruns. The reusable opt-in `codebase/tools/profile_cold_picture.js` was extracted from the interrupted experiment afterward; it retains bounded metadata and canvas hashes instead of screenshots and was not launched again.

### AVIF gain-map GPU estimate — not built

B2's large 14.3 MP gain-map example took 8.747 s on the current CPU boundary and 6.730 s in the native memory probe; the small example took 2.118/1.118 s. The native probe still calls serial `avifImageApplyGainMap`, followed by BT.2020 PQ through 10-bit YUV and back to RGB. Moving gain-map reconstruction arithmetic to compute should remove seconds of serial transfer/gamut/power maths. AVIF decoding, source upload and retained output conversions remain.

Engineering estimate: 1–2 days for a measured prototype; about 3–5 days total for integration, cancellation/fallback and pixel qualification. Provisional target: subsecond reconstruction maths at 14 MP, perhaps 0.1–0.3 s on this GPU, **not a measured end-to-end forecast**. Existing JPEG gain-map GPU waits are tens of milliseconds but its algorithm differs. First isolate decode, ApplyGainMap and output conversions. Preserve base/gain sampling, gamma/offset/channel bounds, gamut choice, orientation, interpolation, headroom rounding (4.11 versus 4.113112926), and existing quantization/YUV round trips before claiming unchanged finished pixels. No AVIF implementation was changed.


## B4 — Cold non-RAW direct GPU draw (October 26, 2026)

Follow-up to 37c85b2. The preceding B3 session ended at its token limit, not an
app crash. This follow-up completed the previously missing formats/repetitions
and compares finished pixels before monitor encoding, in both HDR and authored SDR.

### Method and timing results

One profiler experiment, resumed from its incremental ledger instead of repeating
completed samples. Command from `codebase`:

```powershell
$env:HDR_FINISHER_ELECTRON_WINDOW_SIZE = '2560x1440'
# Supply a NEW disposable profile directory that already exists:
$env:HDR_FINISHER_ELECTRON_TEST_USER_DATA = '<experiment profile>'
node --require ./tools/profile_cold_picture_network.cjs tests/run-in-electron.js tools/profile_cold_picture.js --manifest ../output/part-b-codecs-2026-10-26/cold-manifest.json
# Interrupted experiments continue with --resume <experiment directory>.
```

Existing experiment copies supplied all originals; every case copied its photo
into a new directory. Both renderers and actual draws were warmed before each
photo; the page was reloaded between photos to release retained GPU resources.
Grid source preparation was suppressed; selecting/opening the photo initiated
cold scene preparation. Before selects the preceding backend-acceptance route,
including the same original stand-ins and current guards; after enables retained
GPU scenes. OS file cache is warm. These are not cold app-start or USB timings.
No live Library database, photo, sidecar or cache folder was written.

Seconds, **first visible / sharp draw**, anchored to the initial single-view
navigation for the selected photo. A same-photo metadata refresh can reset its
per-request stopwatch; using those later durations alone falsely reported the
second after JXL sharp draw as 0.491 s. The saved event clocks give 4.945 s from
the original navigation. All rows below use that common time origin.

| Format | Before 1 | Before 2 | After 1 | After 2 |
|---|---:|---:|---:|---:|
| JPEG | 0.393 / 1.798 | 0.656 / 1.825 | 0.327 / 0.844 | 0.390 / 0.896 |
| PNG | 0.277 / 1.786 | 0.705 / 2.137 | 0.262 / 1.067 | 0.403 / 1.094 |
| TIFF | 3.208 / 3.208 | 3.307 / 3.307 | 2.362 / 2.362 | 2.017 / 2.017 |
| HEIC | 6.815 / 7.298 | 8.109 / 8.322 | 7.857 / 7.857 | 7.579 / 7.579 |
| JXL | 5.033 / 5.225 | 5.008 / 5.341 | 6.318 / 6.661 | 4.161 / 4.945 |

Mean sharp draw: JPEG 1.811 → 0.870 s, PNG 1.962 → 1.080 s,
TIFF 3.257 → 2.190 s. HEIC/JXL CPU routes were not optimized; JXL after
variation (6.661/4.945 s) does not establish a CPU speed change.

Ledger and raw captures: `output/cold-nonraw-sharp/1792992142384/results.json`,
`input-hashes.json` and `{phase}-{format}-{repeat}-{hdr,sdr}.f16`.
All 20 rows have successful cache-store events and matching input/photo hashes;
no copied-photo `.hdrf` appeared. Each format's four finished HDR hashes match
exactly, and its four authored SDR hashes match exactly (40 captures total).
The ledger retains timing/stage events and bounded response metadata as each
photo/capture completes, before later store/capture assertions can fail.

### Direct draw and publication

Library preparation and both picture renderers share one hardware WebGPU device.
GPU reduction retains half-float source textures for thumbnail and screen preview;
the viewer copies them directly into its managed proxies. The source scene remains
ungraded: normal finishing still runs in the renderer. A metadata-only acceptance
request checks source owner, current identity/fingerprint, recipe and finishing
grade without publishing scene pixels. Direct entries use the current source and
finishing-grade identities, are bounded to 256 MiB and expire after 30 seconds.
Invalidation releases them. Retained bytes join shared ready-memory accounting.

The selected surface is published before starting full pixel upload/acceptance
and persistence. Source ownership survives until background acceptance finishes;
existing RAM publication and atomic disk publication checks remain in force.
Geometry/local-adjustment/Denoise cases that require backend scene data retain
the established route. RAW/DNG reconstruction and native detail preview behavior
are unchanged. Reduced-scene readback still costs about 87 ms for JPEG; it is
storage preparation, not the viewer's source. No rendering shader/order changed.

After JPEG/PNG/TIFF rows record direct texture draws and **zero** `/live-pixels`
fetches, including their finished-pixel captures. JPEG's description handoff is
82/93 ms versus baseline pixel handoff 644/709 ms; pixel handoff happens later in
the after phase. Store starts after sharp-surface publication, about one frame
before the trace's later two-animation-frame presentation confirmation.

### First-fetch stall and profiler repair

The historical ~2 s first JPEG quick fetch overlapped a 2172 ms index lock hold
in B3's backend log. That overlap does not prove lock ownership caused the fetch
wait: this pixel route does not take the index/marks lock. The new response headers
separate route-to-worker queue time and pixel packing. Bounded baseline JPEG
thumbnail fetch headers: **4.7/5.8 ms**; queue **0.15/0.31 ms**; packing
**2.95/3.69 ms**. The ~2 s wait did not recur. Direct GPU drawing removes that
scene-fetch dependency altogether; no unproven executor/locking change was added.

The profiler itself exposed avoidable overhead: Playwright's DevTools network
recording serialized complete binary scene POST bodies. TIFF closed the debug
connection while the app/backend continued to draw/store; main-process diagnostics
recorded no renderer/GPU crash or window/app shutdown. Bounding `Network.enable`
`maxPostDataSize` to one byte affects debug recording only. It let TIFF finish,
and removed much of the apparent handoff cost. For example, the preliminary
unbounded JPEG baseline was 5.448 s sharp with a 2.542 s handoff, versus the
bounded 1.798/1.825 s sharp and 0.644/0.709 s handoff. B3's 5–15 s figures include
observer/transport overhead and cannot serve as clean before timings here.
The historical 2 s quick-fetch stall's exact cause remains unproven; debug
recording is a plausible contributor, not a proven backend contention diagnosis.

Seventeen completed samples were retained. Only the two initial samples taken
before this instrumentation repair, and the first after JPEG sample with a GPU
half-rounding defect, were replaced. Their records/captures remain as
`superseded-results.json` and `superseded-*.f16`. Native half-float texture stores
rounded differently from NumPy; explicit nearest/ties-to-even packing fixed it.
Final profiler log: `output/cold-nonraw-profiler-final.log`, ending PASS.
Other attempt logs: `output/cold-nonraw-profiler*.log`. No extra Library GPU driver.

### Checks and remaining scope

Fast checks once: Node **631 pass/2 fail**, Python **2581 pass/3 skip/2 fail**.
Known failures: `selected photo joining development-ahead keeps its CPU fallback
if GPU fails`; `test_library_native_source_uses_same_repair_before_reduction`
(`CaptureCache.build` lacks the existing `defer_store` argument). New fixture
failures: missing `HDRLibraryGpuRaw.directBytes` stub and an incomplete
`EditDocument` used for a grade-identity check. Both fixtures were corrected;
suites were not repeated. New stale-source/stale-recipe cases and draw/store
ordering cases passed in the one run. Fast logs: `output/cold-nonraw-fast-*.log`.

No HEIC/JXL CPU speed work, AVIF GPU reconstruction or stored-preview implementation
was done. JPEG XL q90 stored screen previews remain the decision already recorded
in `a633430`, preserved in the module PRD. Steve's normal-folder trial remains.
