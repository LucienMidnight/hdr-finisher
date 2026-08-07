# Delivery Proofing and Browser Verification Sprint

**Date:** August 6, 2026

**Application target:** HDR Finisher v0.2.0

**Initial release gate:** Windows Chrome

**Formats:** JPEG Ultra HDR and AVIF gain map

**Status:** Implementation complete; physical-display evidence collection in progress

## Goal and product boundary

Delivery proofing now separates three questions that must not be conflated:

1. **Authoring** shows HDR Intent and the independently graded SDR Fallback.
2. **Delivery Matrix** reconstructs pixels from encoded delivery data at fixed headroom targets.
3. **Live Browser Check** lets the installed browser, OS, GPU compositor, and active display render the exact encoded proxy.

This is practical delivery proofing, not colorimetric display certification. Differences of roughly 5–10% are acceptable when highlights, clipping behavior, gradients, color, and overall tonal impression remain close. A consistent bias is recorded, not silently normalized. Camera photographs and absolute luminance claims remain out of scope without a colorimeter.

Live Browser Check is authoritative for the tested browser/device combination. The matrix is authoritative for the encoded reconstruction. Neither replaces the other.

## Implemented scope

### Encoded artifacts and matrix

- Proof proxies use the same production exporter classes and metadata paths as final exports. Only proxy dimensions and quality differ.
- JPEG Ultra HDR is the provisional default; AVIF gain maps remain selectable.
- Artifact filenames and URLs are derived from SHA-256 content hashes and served with immutable caching, ETags, and a hash response header.
- The matrix contains +0, +1, +2, +3, +4 stops and full encoded headroom when it is not already one of those targets.
- AVIF matrix tiles are generated from the exact encoded artifact through libavif's gain-map tone mapper.
- JPEG tiles use the encoded JPEG SDR endpoint and libultrahdr-decoded HDR endpoint, then apply ISO/Skia gain-map weighting.
- Each tile reports target headroom, numerical peak, percentage above the target ceiling, current nominal display headroom, and an above-headroom warning.
- The UI calls these **Fixed-headroom reconstructions** because their pixels are fixed while physical presentation remains display-dependent.

The formula follows the Skia gain-map definition and implementation; no extra Chromium-only weighting stage was found:

- [SkGainmapInfo definition](https://skia.googlesource.com/skia/+/main/include/private/SkGainmapInfo.h)
- [SkGainmapShader implementation](https://skia.googlesource.com/skia/+/main/src/shaders/SkGainmapShader.cpp)

### Live Browser Check

- Exact JPEG or AVIF proxy beside a selectable matching matrix tile.
- Correct MIME versus deliberately wrong `application/octet-stream`.
- `dynamic-range-limit: no-limit` versus `standard`.
- Native, CSS-sized, transformed, opacity, and animated transition presentation paths.
- Explicit cache refresh without changing the underlying bytes.
- Structured observations for highlights, midtones, color, overall equivalence, and notes.
- Compatibility starts as **Observed on this device** and **No verified compatibility record for this browser/version**.
- Evidence matches exact browser version and format and becomes stale after 180 days.

### Windows display telemetry

The app reads active-display state through Windows display configuration and DXGI 1.6:

- HDR supported and enabled state
- bits per channel
- Windows SDR white level and its equivalent nits
- DXGI maximum and full-frame luminance
- nominal headroom `log2(max luminance / SDR white)`
- primary-display identity

Relevant platform definitions:

- [DISPLAYCONFIG_SDR_WHITE_LEVEL](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-displayconfig_sdr_white_level)
- [DXGI output luminance and advanced color behavior](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture)

### Test media and hosting survival

- A generated float-TIFF test target contains neutral 0 through +4-stop patches, saturated colors, a dark-to-HDR gradient, and stable geometry. Use the **Test pattern** button so runs do not depend on private photographs.
- `codebase/tools/verify_hosted_gainmap.py` downloads one or more delivery URLs and records HTTP status, final URL, MIME, content encoding, cache headers, ETag, hashes, byte identity, gain-map presence, and metadata survival against a local export.

Example:

```powershell
cd codebase
$env:PYTHONPATH = "backend"
python .\tools\verify_hosted_gainmap.py .\output\proof.jpg `
  https://direct.example/proof.jpg `
  https://transform.example/proof.jpg
```

## Interfaces for future threads

| Interface | Purpose |
|---|---|
| `POST /api/session/{id}/proof/artifact` | Encode an exact delivery proxy using current adjustments |
| `GET /api/proof/artifact/{hash}.{ext}` | Serve content-hashed live bytes; `?mime=wrong` forces a bad MIME |
| `POST /api/proof/matrix` | Build fixed-headroom reconstructions from an artifact |
| `GET /api/proof/tile/{hash}.avif` | Serve an immutable PQ matrix tile |
| `GET /api/display` | Read Windows display/HDR telemetry where available |
| `GET /api/proof/test-pattern` | Generate the stable float-TIFF proofing target |
| `GET/POST /api/proof/evidence` | Read or append structured local observations |

Local evidence lives at `%LOCALAPPDATA%\HDR Finisher\delivery-proof-evidence.json`. It is deliberately not committed because it describes a particular browser, OS, GPU, and display state.

## Current evidence

The current suite completes with **198 passed and 0 skipped** on the fully provisioned Windows development environment. Automated coverage includes:

- whole-stop formula conformance at 0, +2, and +4 stops;
- base/full endpoint reconstruction checks;
- stable content hashes and immutable artifact URLs;
- matrix headroom warnings;
- evidence persistence and 180-day policy;
- real JPEG Ultra HDR and AVIF gain-map proxy encodes;
- correct and deliberately wrong MIME delivery;
- real matrix generation for both formats;
- test-pattern range and float encoding;
- hosting-probe byte and metadata preservation logic;
- installed headless Chrome 150 and Edge 151 UI/API/decode smoke coverage with console, presentation-variant, and horizontal-overflow checks;
- the full 1280 px layout regression with no horizontal overflow.

The Windows workstation reported the following initial telemetry. This is machine state, not browser acceptance evidence:

| Display | HDR | Depth | SDR white | DXGI max | Nominal headroom |
|---|---:|---:|---:|---:|---:|
| Mi Monitor | On | 10-bit | 360 nit | 1300 nit | 1.85 stops |
| M27Q P | Off | 8-bit | 80 nit | 400 nit | 2.32 stops |

No physical Windows Chrome parity claim should be made until the manual sequence below has structured observations saved. Headless Edge confirms transport, layout, APIs, and decoding, but cannot certify physical HDR presentation.

## Manual sequence and acceptance gates

### 1. Windows SDR white-level response — run first

Use the generated pattern and one representative image. Keep the browser window, file, adjustments, format, and proof proxy constant. Test low, middle, and high Windows SDR-brightness positions plus any positions that put nominal headroom close to a whole number of stops.

At each position:

- record `/api/display` telemetry;
- confirm artifact and matrix tile hashes do not change;
- note whether Chrome updates immediately, after reload, or after a full restart;
- save structured observations for highlights, midtones, color, and overall equivalence.

Expected invariant: encoded and matrix hashes remain fixed. Expected variable: the physical presentation may change with Windows SDR white and available headroom.

### 2. Windows Chrome versus matching tile

Test nominal headroom near +1, +2, +3, and +4 stops where the hardware permits. Compare the exact live proxy and closest matrix tile in the same Chrome window using uniform patches, stepped highlights, gradients, saturated colors, and a representative image. Repeat after reload and Chrome restart.

Accept up to approximately 10% luminance difference when highlight placement, clipping, gradients, and color remain perceptually close. Record a stable 5–10% bias without blocking release. Investigate obvious clipping differences, hue shifts, severe saturation changes, a wrong SDR base, a missing gain map, or differences clearly above about 10%. Do not use near-black percentages as a gate.

Classify failures as formula/adapter, headroom input, decode/color conversion, compositor/display, cache/refresh, or physical presentation.

### 3. State changes and browser variants

Run and record each format separately where applicable:

- drag Chrome between HDR and SDR displays; check immediate repaint, reload, and restart;
- toggle Windows HDR while Chrome remains open; check immediate repaint, reload, and restart;
- A/B correct and wrong MIME;
- A/B `dynamic-range-limit` and each presentation path;
- test browser zoom and mixed SDR/HDR page content;
- verify JPEG Ultra HDR and AVIF fallback independently in Firefox;
- verify both formats in Mac Chrome and Safari; treat headroom conclusions on the available 500-nit MacBook as exploratory.

### 4. Hosting survival

1. Upload JPEG and AVIF originals directly to Cloudflare Pages and run the hosting probe. Direct delivery is the byte-preservation control.
2. Probe Cloudflare resize, quality, and automatic-format transformation URLs separately.
3. Repeat for WordPress original uploads and generated sizes.
4. Repeat with one additional real optimizer or resizing CDN.
5. Open each resulting URL in the relevant browser and record whether HDR and the SDR fallback render correctly.

Do not conflate an unsupported transformation with metadata stripping. Record unsupported operation, byte change, metadata state, and browser behavior as separate fields.

Publishing is intentionally not automated in this sprint because no production Cloudflare/WordPress target or credentials are part of the repository. The verifier is ready as soon as URLs are supplied.

## Default-format decision

JPEG Ultra HDR remains the provisional default, but the recommendation is blocked if this application's JPEG exports fail native Windows Chrome rendering.

Do not switch the default merely because one optimizer prefers AVIF. Reconsider only after at least three representative transforming pipelines are tested and AVIF preserves HDR where JPEG loses it in at least two of the same pipelines, with no reciprocal JPEG advantage.

## Release gate

Release claims require:

- formula conformance for both formats;
- proxy/export metadata-path equivalence;
- correct HDR rendering and SDR fallback in Windows Chrome;
- no unexplained perceptual or measured discrepancy above the practical tolerance;
- documented monitor-move, Windows-HDR-toggle, reload, restart, and hosting behavior.

Repository/release maintainers own the evidence registry. Re-verify quarterly, after relevant browser changes, and before releases that make new compatibility claims.

## Deferred

- Sony and iPhone photography as normalized test targets
- camera photographs of displays
- absolute physical luminance measurement without a colorimeter
- definitive Safari headroom characterization on the 500-nit MacBook
- exhaustive XMP-only, ISO-only, and conflicting-metadata variants unless shipping exports reveal a browser divergence
- a large hosting-vendor matrix before local Chrome parity and the first Cloudflare tests are complete
