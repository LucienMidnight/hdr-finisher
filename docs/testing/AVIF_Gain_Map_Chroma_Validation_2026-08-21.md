# AVIF Gain-map Chroma Validation — 2026-08-21

## Scope and method

The production AVIF exporter encoded the built-in 1280 × 720 HDR delivery proof pattern at quality 88 and 10-bit precision. Gain-map chroma was varied independently from primary-image chroma. The authored HDR and SDR arrays were compared with renditions decoded by bundled libavif 1.4.1 tools. Measurements cover whole-frame HDR/SDR error, saturated chromatic highlights, colored edges, gradient error/banding proxies, and file size.

Reproduce from `codebase/`:

```powershell
.\.venv\Scripts\python.exe .\tools\measure_avif_gainmap_chroma.py
node .\tools\check_avif_gainmap_chromium.js
```

Disposable files and the full JSON report are written to `codebase/output/avif-gainmap-chroma/`.

## Gain-map chroma results with a fixed 4:4:4 primary

| Gain map | Bytes | HDR MAE | Colored-edge MAE | Saturated-highlight MAE | Gradient MAE | Finding |
|---|---:|---:|---:|---:|---:|---|
| 4:4:4 | 4,776 | 0.00408 | 0.00310 | 0.00555 | 0.00378 | Reference choice |
| 4:2:2 | 4,753 | 0.00438 | 0.00387 | 0.00619 | 0.00367 | Small edge penalty; negligible size change on this pattern |
| 4:2:0 | 4,831 | 0.00485 | 0.00525 | 0.00703 | 0.00404 | About 70% higher colored-edge MAE and no size saving here |
| 4:0:0 | 4,125 | 0.09494 | 0.00789 | 0.30152 | 0.00306 | About 14% smaller, but unacceptable chromatic-highlight error |

The SDR-base metrics were identical across gain-map choices (MAE 0.000432), confirming that gain-map chroma is independent of primary/base chroma. The smooth-gradient flat-step fraction remained between 0.6% and 1.8%; lower gain-map chroma did not provide a consistent banding advantage.

Changing only primary chroma from 4:4:4 to 4:2:2 and 4:2:0 increased SDR-base edge maxima, as expected, but did not reproduce the chromatic HDR failure of a monochrome gain map. This confirms the two controls exercise separate encoded items.

## Compatibility

- Bundled `avifgainmaputil` 1.4.1/AOM 3.13.2 encoded 4:4:4, 4:2:2, 4:2:0, and 4:0:0 gain maps.
- Bundled `avifdec` and the production gain-map reconstruction path decoded every file and reported the requested gain-map format.
- Microsoft Edge 151.0.4129.93 (Chromium) decoded all nine tested primary/gain-map combinations at the expected 1280 × 720 dimensions with no image decode error.
- Headless Chromium decode proves container/image compatibility, not physical HDR presentation. Final release review still requires a supported HDR display and current headed Chromium build.

## Initial pattern decision

The pattern result established 10-bit 4:4:4 as the safe gain-map chroma and rejected 4:2:0 and 4:0:0 as built-in choices. At that stage, 4:2:2 remained a provisional Web Optimized candidate pending photographic size evidence. The corpus follow-up below supersedes that provisional mapping.

## DxO photographic corpus follow-up

Ten Sony RAW photographs exported by DxO PhotoLab 9.10 as optical-correction-only Linear DNGs were tested through the production importer and AVIF gain-map exporter. The originals remained outside the repository; disposable encodes and `report.json` were written below ignored `codebase/output/avif-gainmap-chroma-dxo/`.

The DNGs were decoded through the verified ColorMatrix-only LinearRaw route and reduced to a 2,048-pixel long edge before the codec sweep. HDR Finisher's default HDR and SDR renditions were held constant. The primary image was fixed at 10-bit 4:2:0 and quality 88. Gain-map quality was 88; gain-map chroma varied across 4:4:4, 4:2:2, and 4:2:0 at both full and half linear resolution. This produced 60 AVIF files.

Reproduce locally from `codebase/` with an equivalent private corpus:

```powershell
.\.venv\Scripts\python.exe .\tools\measure_avif_gainmap_chroma.py `
  --input-dir "D:\path\to\linear-dngs" `
  --long-edge 2048 `
  --primary-chroma 420 `
  --gain-map-chroma 444,422,420 `
  --gain-map-scales full,half `
  --quality 88 `
  --output output\avif-gainmap-chroma-dxo

node .\tools\check_avif_gainmap_chromium.js .\output\avif-gainmap-chroma-dxo
```

### Aggregate results relative to 4:4:4 at the same gain-map resolution

| Gain-map resolution | Chroma | Median total-size change | Median HDR MAE change | Median colored-edge MAE change | Median saturated-highlight MAE change |
|---|---|---:|---:|---:|---:|
| Full | 4:2:2 | -0.7% | +4.2% | +20.9% | +18.7% |
| Full | 4:2:0 | -1.7% | +9.5% | +42.3% | +39.7% |
| Half | 4:2:2 | +0.1% | +2.2% | +1.8% | +3.8% |
| Half | 4:2:0 | -0.7% | +2.8% | +3.4% | +8.2% |

At full resolution, individual 4:2:0 files ranged from no material size saving to 7.0% smaller. Worst cases increased colored-edge MAE by 64.4% and saturated-highlight MAE by 96.2%. Full-resolution 4:2:2 occasionally produced a slightly larger file than 4:4:4 and reached a 51.9% colored-edge penalty in the worst image.

At half resolution, changing chroma had little effect because spatial downscaling already dominated the residual error and data volume. Half-resolution 4:4:4 reduced total file size by a median 52.8% relative to full-resolution 4:4:4; its per-image reduction ranged from 42.9% to 66.5%. In contrast, subsampling the half-resolution map to 4:2:0 saved only another median 0.7%.

The SDR-base MAE was bit-for-bit invariant across all six gain-map variants within every source image. Bundled libavif decoded all 60 files and reported the requested gain-map format. Microsoft Edge 151.0.4129.93 decoded every file at its expected dimensions.

### Final product decision

Gain-map chroma is fixed at 10-bit 4:4:4 and removed from the normal export UI. Lower-chroma modes remain available only to the internal measurement path. AV1 compressed photographic gain-map chroma efficiently enough that 4:2:0 usually saved very little total space, while its error remained content-dependent and concentrated around colored edges and saturated highlights.

Gain-map spatial resolution is the useful web-size control. Half-resolution 4:4:4 was essentially the same size and slightly more faithful than half-resolution 4:2:2 or 4:2:0, and reduced total file size by a median 52.8% versus full-resolution 4:4:4. Web Default and Web Optimized therefore use half-resolution 4:4:4; Maximum Fidelity retains full-resolution 4:4:4. This is a publishing-size judgment: users needing the lowest reconstruction error can select Maximum Fidelity, while the two web presets avoid exposing chroma options that the evidence does not support.

These files are photographic RAW developments rather than deliberately mastered HDR/SDR pairs. Several contain very few saturated highlight pixels, so their individual highlight ratios are less stable than the corpus median. The built-in adversarial pattern remains the sharper failure detector; this follow-up establishes typical photographic size behavior and content-dependent reconstruction trends.
