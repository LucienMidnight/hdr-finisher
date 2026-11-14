# Test photos (approved by Steve 2026-11-14)

Every test reads its photos from one folder, `HDR Test Images`, under the
machine's photos root (PC `D:/Photos`, Mac `~/HDR Finisher Tool/Photos`). The
folder is identical on both machines and stays around 2–4 GB. Only tests
against Steve's personal library (for example the `2026/20261017 badminton`
folder) are PC-only, and they are marked so.

The curated folder replaces the old 40 GB `D:/Photos/HDR Test Images` and is
now installed on both machines. Transfer by **copying**: never move, rename
inside, or delete Steve's originals. Keep
the file names below (sidecars such as `.hdrf` must keep matching their
photo's name). The folder is flat except `Projects/`.

## Files

Sizes are approximate. "PC source" records the pre-curation provenance, not
a lookup location for tests; `P0` is
`D:/AI/AI Projects/HDR Finisher Tool/ai/codebase/output/test-photos/phase0`,
`HTI` the old `D:/Photos/HDR Test Images`, `PR` is `D:/Photos/Play_Raw`.

| File | MB | Covers | PC source |
| --- | ---: | --- | --- |
| **Sony RAW (large, 42 MP)** | | | |
| `DSC00264.ARW` + `.hdrf` | 82 | main Grade, Edge colour, Library, masks; saved grade | HTI |
| `DSC04375.ARW` + `.hdrf` | 82 | Retouch; pairs with the DxO DNG and TIFF below | HTI |
| `DSC01212.ARW` | 82 | Library focus trial | HTI |
| `DSC06615.ARW` + `.hdrf` | 42 | compressed Sony RAW; saved grade | HTI |
| `A7R00619.ARW` | 41 | another photographer's Sony (A7R IIIa) | PR/Lakeland landscape in dry Summer |
| `2025_0730_1331_3.arw` | 82 | lower-case extension; another photographer | PR/An alley at Seoul - lucas faco |
| `DSC00950.ARW` + `.ARW.hdrf` | 35 | heavy saved project baseline | PR/Fantastic light over village - AdamFromCanada |
| **Other cameras** | | | |
| `IMG_0114.CR2` + `.hdrf` | 25 | Canon CR2; all HSL checks | PR/Balanced Rock in Arches Nat Park - LaurentFromSF |
| `IMG_0790.CR2` | 23 | noisy Canon (Denoise, focus) | PR/Hawai'ian Fire Dancers - Challenge the Darkside - LaurentFromSF |
| `IMG_3129.CR2` | 20 | Edge colour on Canon | PR/Sunset on ferry -silicoid |
| `IMG_7723.CR3` | 27 | Canon CR3 | PR/Foggy morning at Dunn Lake |
| `DSC_3931.NEF` | 24 | Nikon NEF | PR/Zebras Crossing - thekman |
| `DSC_3931.NEF.hdrf` | 0 | saved NEF grade | HTI/Test Suite Images/Nikon_D7500_DSC_3931.NEF.hdrf (rename to match) |
| `P1010004.ORF` | 14 | **small RAW** (Olympus, 16 MP) | P0 |
| `P1150601.RW2` | 23 | Panasonic RW2 | P0 |
| `DSCF6495.RAF` | 32 | Fuji X-Trans (camera preview only) | P0 |
| `Leica-X2-L1021324.DNG` | 23 | camera DNG | HTI |
| `DJI_0071-2.DNG` | 92 | drone DNG | HTI/DJI Samples |
| `DSC04375_DxO-optical-corr-only.dng` | 135 | linear (DxO) DNG | HTI/DJI Samples |
| **iPhone** | | | |
| `iphone_16_pro_IMG_3324.HEIC` | 3 | HEIC with gain map | HTI/Test Suite Images |
| `IMG_6705.HEIC` | 2 | ordinary HEIC | D:/Photos/2024/2024 - phone images/202406__ |
| **Other files** | | | |
| `DSC04375_DxO_clipped_target.tif` | 242 | the TIFF; needs interpretation | HTI |
| `pano_192mp.jpg` / `.png` / `.tif` + `.tif.hdrf` | 22 | huge pixel count, reduced route | P0 |
| `DJI_0071-2.JPG` | 13 | camera JPEG | HTI/DJI Samples |
| `_DSC6328.jpg` | 33 | large JPEG | P0 |
| `VKNS0418.JPEG` | 13 | `.JPEG` extension | P0 |
| `IMG_0790_finished.jpg` | 11 | edited JPEG | PR/Hawai'ian Fire Dancers… |
| `DSC_3931_01.jpg` | 1 | small exported JPEG | PR/Zebras Crossing - thekman/darktable_exported |
| `IMG_6717.PNG` | 2 | 8-bit PNG | P0 |
| `_DSC6510-1.png` | 213 | 16-bit PNG | P0 |
| `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif` | 2 | PQ AVIF | P0 |
| `DSC08883.avif` | 4 | ordinary AVIF | D:/Photos/2025/20251210 Power Out/darktable_exported |
| `LR-classic-hdr-source-test-1.avif` | 24 | gain-map AVIF | P0 |
| `5M071612_finished.avif` | 1 | small AVIF | PR/HDR exercise on urbanscape |
| `DSC01302.jxl` | 89 | JPEG XL needing interpretation | P0 |
| `jpeg_xl_16_bit_p3_color.jxl` | 1 | 16-bit P3 JPEG XL | P0 |
| `e053a5bf16a9398eaa3da890-900x1200.jxl` | 1 | JPEG XL source colour | HTI |
| `A7R00619.exr` | 476 | large camera EXR | PR/Lakeland landscape in dry Summer/darktable_exported |
| `possibly-cat-prints-texture-v001.exr` | 14 | EXR needing interpretation | P0 |
| `synthetic_24mp.hdr` | 79 | Radiance HDR | P0 |
| `synthetic_24mp.pfm` | 275 | PFM | P0 |
| `Projects/DSC00950.hdrfinisher` | 0 | saved project | PR/Fantastic light over village - AdamFromCanada |

Exactly 50 files including sidecars and the project: about 2.4 GiB (2.52 GB).
No extra iPhone samples were added. The source column records provenance, not
paths a test may read.

## Dropped (tests move to a file above)

- Eight more 82 MB Sony ARWs from the old Library fixture (`DSC01204`,
  `DSC01226`, `DSC01244`, `DSC01286`, `DSC01287`, `DSC02767`, `DSC03819`,
  `DSC04761`). The Library check keeps enough photos by using every file
  in the folder.
- Duplicates or near duplicates: `DJI_0071.DNG`, `DJI_0072.DNG`,
  `DSC00264_DxO-optical-corr-only.dng`, `DSC01244_DxO-optical-corr-only.dng`,
  `2L1B8631.CR2`, `IMG_5137.CR2`, `QNY_8816.NEF`, `P1010300.ORF`,
  `IMG_1193.CR2`, `_DSC6117_DxO.jpg`, `_DSC3289_DxO.jpg`, `IMG_1150.tiff`.
- Too large for both machines: `DJI_0071-2.tif` (370 MB), `DSC01287.exr`
  (472 MB) and the 297 MP line-scan DNG (1.7 GB). If Steve wants a
  very-large-file check, it becomes PC-only like the badminton folder.
- Folder-scale one-off measurements (`2017/Aceh-Wedding/Pesta`, `2023/11`)
  become PC-only personal-library checks.

## On each machine

`codebase/tests/test-photos.manifest.json` lists all 50 files with relative
name, bytes and SHA-256, generated from the installed Mac folder. The photo
folder itself is not in Git. Setup compares names, sizes and hashes and names
anything missing, different or extra (ignoring `.DS_Store`). From `codebase`,
run the venv Python with `tools/check-test-photos.py` to check without setup.
Steve must keep **every file in that manifest on both machines**, including
sidecars and `Projects/DSC00950.hdrfinisher`; no additional iPhone copy is needed.

## Replacement inventory (November 14)

All new names below are relative to `HDR Test Images`. Original source paths
are historical provenance, not alternate lookup locations. The inventory was
checked against tests, drivers, tools, sample lists and repository history.

| Old input | New input | Consumers and required coverage |
| --- | --- | --- |
| `Play_Raw/.../IMG_0114.CR2` | `IMG_0114.CR2` | HSL selection/delivery, overlays, smoothing/review tools; Canon RAW and its saved HSL grade |
| `Play_Raw/Contre-jourin Hawai’i/IMG_1193.CR2` | `IMG_0114.CR2` | Tone-zones visual review; another Canon case now uses the same rock/sky image, not the old beach scene |
| `2020/Lucas 2nd Birthday/IMG_5137.CR2` | `IMG_0114.CR2` | RAW overlay placement; portrait orientation retained (LibRaw flip 5), not a skin-tone reference |
| `2025/Yenny BBQ/P1010300.ORF` | `P1010004.ORF` | RAW measurement corpus; Olympus ORF / smaller 16 MP sensor |
| `Test Suite Images/noisy_canon_IMG_0790.CR2` | `IMG_0790.CR2` | Library focus trial / camera variety; same noisy Canon image |
| `Play_Raw/.../{IMG_0790.CR2,IMG_0790_finished.jpg,IMG_3129.CR2,IMG_7723.CR3,A7R00619.ARW,2025_0730_1331_3.arw}` | Same flat basenames | RAW GPU camera routes, Edge colour, photographic RGB codecs; case-sensitive extensions retained |
| `Play_Raw/.../DSC_3931.NEF`, `Test Suite Images/Nikon_D7500_DSC_3931.NEF` | `DSC_3931.NEF` | Nikon GPU RAW route, edited-sharp checks and corpus probes |
| `Play_Raw/.../DSC_3931_01.jpg` | `DSC_3931_01.jpg` | RGB source/native and codec fixture builders; small photographic SDR JPEG |
| Scratch `20260214/darktable_exported/DSC01910.jpg`, manually supplied `graceful-grades/photo.jpg` | `DSC_3931_01.jpg` | JPEG-loop and picture-error checks now seed their own reusable copies |
| Scratch Retouch source/grade | `DSC04375.ARW` + `.hdrf` | Retouch review reads the curated original and writes only disposable output |
| Scratch `v1-visual-sources` / `Review-1.png` | `DSC_3931_01.jpg`, `IMG_0790_finished.jpg`, `DJI_0071-2.JPG`, `_DSC6328.jpg`, `VKNS0418.JPEG`, `IMG_6717.PNG` | Six-photo UI/font review inputs; own curated cache, same six-image count; PNG selected for the batch review |
| `2024/02/_DSC3289_DxO.jpg` | `_DSC6328.jpg` | JPEG measurement tool; retain a large photographic JPEG rather than the small exported JPEG |
| `2024/.../IMG_6705.HEIC`, old downloaded `example.heic` | `IMG_6705.HEIC` | Ordinary HEIC and codec fixtures |
| `2025/.../DSC08883.avif`, downloaded `kodim.avif` | `DSC08883.avif` | Ordinary AVIF codec fixture |
| Downloaded `cosmos.avif` | `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif` | PQ HDR AVIF codec fixture; no network photo download |
| `Play_Raw/.../5M071612_finished.avif` | `5M071612_finished.avif` | Non-RAW asynchronous picture and source sample list |
| `Test Suite Images/iphone_16_pro_IMG_3324.HEIC`, private iPhone 12 gain-map HEIC | `iphone_16_pro_IMG_3324.HEIC` | HEIC gain-map/reference reconstruction, overlay backlog; real gain-map assertion no longer silently optional |
| `DJI Samples/DJI_0071-2.DNG` / `DJI_0071.DNG` | `DJI_0071-2.DNG` | DJI mosaiced DNG, Grade and Library geometry/warp |
| `DJI Samples/DSC00264_DxO-optical-corr-only.dng`, `DSC06885_DxO-neutral.dng` | `DSC04375_DxO-optical-corr-only.dng` | Linear-DNG inspection and Library route; related Sony/DxO input retained |
| `DJI_0071-2-HDR.dng` | `Leica-X2-L1021324.DNG` for the third real-file case | Leica required warp opcodes; this is not an authored HDR-linear-DNG substitute (gap below) |
| Scratch `DSC07060/DSC07061/DSC07072.ARW` | `DSC00264/DSC04375/DSC06615.ARW` | Live grid, live/export tiles, Film Look and single-view routes; copied saved grades, never original sidecar writes |
| Saved `DSC07060` ceiling grade | `DSC04375.ARW` + `.hdrf` | Delivery ceiling/repeat: real saved grade with Highlight Compression enabled at 1000 nits; same exact ceiling assertions |
| Overlay Sony landscape `DSC07060.ARW` | `A7R00619.ARW` | Keep a landscape-oriented Sony alongside portrait Canon and landscape Canon (LibRaw flips 0 / 5 / 0) |
| Fixture `DSC03819.ARW` / `DSC02767.ARW` / `20250412_0039.ARW` | `DSC04375.ARW` / `DSC01212.ARW` / `DSC06615.ARW` | Temporary recovery, RAW corpus and grade-memory probes; distinct real RAWs, saved grade where required |
| `DSC04375_DxO_clipped_-1.5EV.tif`, old profiled TIFF | `DSC04375_DxO_clipped_target.tif` | Profiled 16-bit TIFF and memory probe |
| `DJI_0072-Lightroom-reference.tif` (float TIFF) | Generated 640 × 640 float32 crop of the curated TIFF | Precision-source driver retains a true floating TIFF, its ICC profile, native reuse and unchanged perceptual checks; it does not mislabel uint16 pixels as float |
| Private Affinity/darktable photographic EXRs | `A7R00619.exr` | Precision-source, film/halation tier, Clarity and Denoise labs; real scene-linear photographic pixels, not the old beach/city content |
| Old Radiance source | `synthetic_24mp.hdr` | Source sample list, Radiance decoding |
| `Play_Raw/.../DSC00950.hdrfinisher` | `Projects/DSC00950.hdrfinisher` | Protected heavy-project baseline; its matching RAW is now the flat `DSC00950.ARW` |

No tolerance, ceiling, shader pin or memory/time budget was relaxed. Dynamic
pixel comparisons still derive their reference from the selected input.
The DNG route expectations were re-inspected: DxO = linear DNG, DJI and Leica =
mosaiced DNG. The RAW metadata experiment now requires exactly **18 RAW files,
17 mosaiced**, measured from these files instead of the old 29 / 19 counts.
Its ten-case subset remains ten cases. The 30-photo screen experiment retains
30 distinct inputs by adding curated RGB files, not duplicate RAWs.
Film Look fixtures explicitly apply their required Portra/grain/halation recipe
to disposable sidecars. Reusable copies are refreshed when source bytes differ,
so an old scratch copy cannot quietly stand in for the new photo.

### Coverage Steve would need to supply

- A noise-free, scene-linear EXR **render at least 540 × 540 pixels** for the
  Denoise lab render-reference case. The committed Blender interoperability
  fixture is only 8 × 8 and is not a valid substitute; the lab names this gap
  and stops, rather than inventing a clean render or reporting a pass.
- An authored HDR linear DNG, if the former `DJI_0071-2-HDR.dng` photographic
  case must be retained. The curated drone and Leica samples are mosaiced;
  the curated DxO sample covers ordinary linear DNG. Synthetic opcode checks
  remain, but are not evidence for that missing photographic source.
- The old beach/urban-specific Clarity, Tone-zones and Denoise review scenes
  are not reproduced. Those reviews now use curated landscape pixels; old
  crop names/caches and visual baselines must not be reused as evidence.

No missing Olympus sample, 40-RAW folder or 50+ MP RAW is silently invented.
The curated set has an Olympus ORF, 18 RAWs, 42 MP Sony RAWs and 192 MP raster
files. Raster stress is not a claim of 50+ MP RAW-decoder coverage.

## Library fixture hand-over

`library-mixed-v2` contains the 49 flat files (photos plus sidecars, excluding
the protected project). It was built and fully hash-verified on the Mac;
`codebase/tools/library-mixed-v2.manifest.json` uses portable source names.
The source photo folder and read-only fixture are never written by drivers.

From `codebase`, with the venv Python:

```text
python tools/library-mixed-fixture.py build --version=v2
python tools/library-mixed-fixture.py verify --version=v2
python tools/library-mixed-fixture.py run-copy --version=v2
```

Opt in with `node tools/quick-library-check.cjs --folder=library-mixed-v2-run
--label=<name>`. **Do not switch defaults yet.** `fix/library-8gb` is measuring
v1 before/after; v1, its committed manifest, quick-check default and associated
capture tools remain frozen exceptions. After that comparison, build v2 on
the PC, switch the quick/capture defaults and setup verification together,
and establish new per-machine v2 timings. Do not compare v1 timings with v2.

## PC-only exceptions

These print a plain skip on Mac, before opening the personal input:

- Badminton: `library-fullscreen-raw.js`, `library-scroll-cache.js`,
  `library-stored-screen-preview.js`, `library-live-picture.js`,
  `library-focus-camera.js`, `library-exposure-culling.js`,
  `performance/library-large-folder-open.js`,
  `performance/library-fullscreen-speed-trial.js`,
  `tools/measure-library-badminton.cjs`, `tools/gpu_raw_prototype/folder_speed.js`,
  `tools/prepare-badminton-profile.py`, `tools/profile_library_startup.py`,
  `tools/color_controls_review.py` and `tools/sharpen_review.py`.
- Folder-scale: `tools/measure-library-cold-mixed.cjs` modes using Aceh,
  `2023/11` or the old phase0 corpus. Its `--hdr-test` mode remains portable.
  `tools/measure-library-big-folder.js` also stays PC-only: it opens the whole
  personal `D:/Photos` tree, not the shared test corpus.
- Dropped giants: `tools/measure-library-grade-grants.cjs` (line-scan DNG),
  `tests/performance/library-fullscreen-speed-trial.py` (old 472 MB EXR), and
  `tools/qualify_camera_linear_raw.py` / `test_camera_linear_raw_corpus.py`
  (exact historical qualification, including the 1.7 GB DNG). The latter
  requires an explicit PC `HDR_FINISHER_RAW_TEST_SUITE` or `--root`; its old
  hashes are not relaxed to fit the curated samples. The 370 MB TIFF survives
  only in the explicitly frozen v1/pre-5a fixture experiment.
- `tests/performance/library-raw-deep-dive.py` also skips on Mac because its
  unbuffered-disk experiment calls Windows APIs; its selected RAW names now
  refer to the curated corpus.
  `tools/exposure-memory-diagnostic.py` likewise skips on Mac because its RSS
  measurement uses Windows APIs; its photo is now a flat curated basename.

These personal/legacy inputs are not required to pass shared-corpus setup on
Mac. On PC, supply the personal library for those optional measurements.

## Protected projects (unchanged)

The two protected DSC00264 mask projects still name the retained
`HDR Test Images/DSC00264.ARW`. The curated `Projects/DSC00950.hdrfinisher`
still embeds `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.ARW`
as its durable source path. Its RAW is present in the curated root, but the
protected project was **not** rewritten. Heavy-project runs may need Steve to
resolve that source in a new disposable project; this is not an alternate photo
search path for drivers. All protected project bytes remain unchanged.

## Validation on Mac (November 14, commit containing this record)

- Node fast suite: 951 passed, 1 skipped; no failures. Reusable-photo helper
  also passes after adding stale-copy refresh coverage.
- Python fast suite: 3,319 passed, 144 skipped, 1 existing expected-failure
  test unexpectedly passed; no failures. Existing Starlette deprecation warning.
- Release driver inventory accepts the new paths. Setup media reporting,
  the 50-file corpus hashes, v2 fixture hashes and v2 run-copy all pass.
  The generated photographic float-TIFF crop was checked as float32 RGB,
  640 × 640. All modified Python and JavaScript files parse.
- Sequential Electron checks used the shared GPU lock and Mac window size:
  RAW paste **passes**, reading curated `DSC06615.ARW`; Stage A fails its
  unchanged workspace-visibility assertion at line 48, before the real-photo
  section; non-RAW picture copies the curated AVIF but times out waiting for
  its first grid canvas; Grade DNG finds/hashes/copies both curated DNGs but
  its two-page setup is rejected by the existing one-page Electron harness.
  That last failed run was stopped and its own process tree/profile cleaned.
  No assertions or timeouts were relaxed to hide those blockers.
- No broad sweep, installer, push or merge to another branch was performed.
