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

## Decision

Keep 10-bit 4:4:4 as the AVIF gain-map **Web Default** and **Maximum Fidelity** choice. Use 4:2:2 only in **Web Optimized**, where it is combined with lower gain-map quality and half resolution for a material size reduction. Do not use 4:2:0 as a built-in preset: on the adversarial colored-edge target its error increase was not repaid by a size saving. Do not expose 4:0:0 in the normal UI because per-channel gain is necessary for saturated chromatic highlights.
