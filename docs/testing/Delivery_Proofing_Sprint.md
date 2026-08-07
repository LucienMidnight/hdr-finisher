# Delivery Proofing and Browser Verification Sprint

**Date:** August 6, 2026

**Application target:** HDR Finisher v0.2.0

**Initial release gate:** Windows Chrome

**Formats:** JPEG Ultra HDR and AVIF gain map

**Status:** Implementation complete; physical-display evidence collection in progress

## Goal and product boundary

Delivery proofing separates three questions that must not be conflated:

1. **Authoring** shows HDR Intent and the independently graded SDR Fallback.
2. **Chrome Proof** reconstructs the selected encoded delivery at one display-headroom target inside the main authoring viewer.
3. **Native browser validation** opens the exact export in the installed browser, OS, GPU compositor, and active display when environment-specific confirmation is required.

This is practical delivery proofing, not colorimetric display certification. Differences of roughly 5–10% are acceptable when highlights, clipping behavior, gradients, color, and overall tonal impression remain close. A consistent bias is recorded, not silently normalized. Camera photographs and absolute luminance claims remain out of scope without a colorimeter.

Native Chrome rendering is authoritative for the tested browser/device combination. Chrome Proof is authoritative for HDR Finisher's deterministic encoded reconstruction. Neither replaces the other.

## Implemented scope

### Encoded artifacts and fixed-headroom proof

- Proof proxies use the same production exporter classes and metadata paths as final exports. Only proxy dimensions and quality differ.
- JPEG Ultra HDR is the provisional default; AVIF gain maps remain selectable.
- Artifact filenames and URLs are derived from SHA-256 content hashes and served with immutable caching, ETags, and a hash response header.
- Normal proofing generates only the selected target. The legacy full matrix remains available through an internal API for regression and diagnostic work.
- AVIF proof tiles are generated from the exact encoded artifact through libavif's gain-map tone mapper.
- JPEG proof tiles use the encoded JPEG SDR endpoint and libultrahdr-decoded HDR endpoint, then apply ISO/Skia gain-map weighting.
- Auto uses the selected Windows display's nominal headroom. Fixed presets are 400, 600, 1,000, 2,000, and 4,000 nits against HDR Finisher's 100-nit reference white; Full uses encoded headroom; Custom accepts 100–10,000 nits.
- Proof targets above encoded capacity are capped and disclosed. Targets above the active display's reported headroom remain selectable with a nonblocking warning.
- Proof format and target persist, while the preview-only toggle starts off for every new source. SDR Fallback and A/B peeks suspend the proof and resume it on HDR Grade.

The formula follows the Skia gain-map definition and implementation; no extra Chromium-only weighting stage was found:

- [SkGainmapInfo definition](https://skia.googlesource.com/skia/+/main/include/private/SkGainmapInfo.h)
- [SkGainmapShader implementation](https://skia.googlesource.com/skia/+/main/src/shaders/SkGainmapShader.cpp)

### Linear Grade / Proof / Export workflow and retained diagnostics

- Grade, Proof, and Export are top-level workflow stages. The source rail, viewer, zoom/pan state, and authored technical displays remain in place while the right settings rail changes by stage.
- Chrome Proof lives in the Proof stage. Its on/off control, format, target, display, status, and explicit Build/Refresh action are in the right rail. The old Delivery Matrix and Live Browser tabs are no longer user-facing.
- Production JPEG/AVIF proof generation is intentionally on demand. Adjustments keep the last valid proof, mark it stale, and never trigger a background rebuild.
- Request generations prevent an older encode or reconstruction from replacing the latest grade.
- Scopes continue to describe authored HDR data and are labeled **HDR · AUTHORED** while proofing.
- Export settings and preflight live in the Export-stage rail instead of a modal. Preflight reports matching, stale, missing, or format-mismatched proof state without blocking export, and can return directly to the Proof stage.
- Full-matrix, wrong-MIME, presentation-variant, and structured evidence endpoints remain internal facilities for regression and hands-on browser investigation.

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
| `POST /api/proof/reconstruction` | Build one Auto, fixed-nit, or full-range reconstruction for main-view Chrome Proof |
| `GET /api/proof/tile/{hash}.avif` | Serve an immutable PQ matrix tile |
| `GET /api/display` | Read Windows display/HDR telemetry where available |
| `GET /api/proof/test-pattern` | Generate the stable float-TIFF proofing target |
| `GET/POST /api/proof/evidence` | Read or append structured local observations |

Local evidence lives at `%LOCALAPPDATA%\HDR Finisher\delivery-proof-evidence.json`. It is deliberately not committed because it describes a particular browser, OS, GPU, and display state.

## Current evidence

The current suite completes with **246 passed and 0 skipped** on the fully provisioned Windows development environment. Automated coverage includes:

- whole-stop formula conformance at 0, +2, and +4 stops;
- base/full endpoint reconstruction checks;
- stable content hashes and immutable artifact URLs;
- matrix headroom warnings;
- all fixed-nit preset conversions, custom bounds, Auto telemetry resolution, encoded-capacity capping, and single-target cache stability;
- evidence persistence and 180-day policy;
- real JPEG Ultra HDR and AVIF gain-map proxy encodes;
- correct and deliberately wrong MIME delivery;
- real matrix generation for both formats;
- test-pattern range and float encoding;
- hosting-probe byte and metadata preservation logic;
- installed headless Chrome 151 main-view proofing coverage, including stale-proof retention, refresh completion, SDR suspension/resume, export mismatch guidance, console errors, and horizontal overflow;
- the full 1280 px layout regression with no horizontal overflow.

The Windows workstation reported the following initial telemetry. This is machine state, not browser acceptance evidence:

| Display | HDR | Depth | SDR white | DXGI max | Nominal headroom |
|---|---:|---:|---:|---:|---:|
| Mi Monitor | On | 10-bit | 360 nit | 1300 nit | 1.85 stops |
| M27Q P | Off | 8-bit | 80 nit | 400 nit | 2.32 stops |

### Personal Windows Chrome observation — August 7, 2026

On the current personal Windows PC and HDR monitor, a **JPEG Ultra HDR** image matches the HDR Finisher authoring view best when it is mastered to a **1,000-nit peak**. The monitor can display above 1,000 nits, but exports mastered beyond that point begin to diverge visibly from HDR Finisher in Chrome and look worse.

A **JPG Ultra HDR export made from the Blender EXR test scene** also exposes a substantial color-rendering difference when viewed in Chrome. In Chrome, the red emissive light remains fully saturated and appears pink through its brightest region; in HDR Finisher, the same highlight rolls toward white at the center. Perceptually, the difference resembles switching between Blender tone-mapping looks such as Filmic and AgX. The available screenshot illustrates the comparison but is not reliable HDR/colorimetric evidence.

An **AVIF gain-map export of the same test image also looks substantially different in Chrome**. The image was adjusted in HDR Finisher but still peaks above 4,000 nits. The monkey's green body, which is not the principal highlight region, differs slightly but remains close enough; the red/pink and yellow emissive backlights show much larger differences in saturation and highlight rendering. Because both JPG Ultra HDR and AVIF exhibit the strongest divergence in these extreme highlights, Chrome's handling of highlights above the practical 1,000-nit target is the leading working hypothesis rather than a format-specific JPEG problem.

For the Blender EXR scene exported as **AVIF with a gain map**, the **Selected fixed-headroom reference** in HDR Finisher's Live Browser section matches what is actually visible in Chrome. This is positive evidence that the in-app delivery-preview reconstruction is functioning for this case: it predicts the observed Chrome-facing result even though that result differs from the HDR Finisher authoring view. It does not by itself establish why Chrome presents the extreme highlights differently.

Treat 1,000-nit peak mastering as the current practical recommendation for this specific workstation while the behavior is unresolved, not as a general Chrome or product limit. Future investigation should determine what Chrome, Windows, the compositor, and the display are each doing above 1,000 nits; why the delivered image appears limited or remapped there; and which authoring, export, and browser-preview scenarios HDR Finisher should recommend to users with different display capabilities.

The investigation must also isolate whether the Blender-scene difference comes from highlight hue preservation/desaturation, gamut mapping, gain-map reconstruction, color-space interpretation, browser or OS tone mapping, or a mismatch between HDR Finisher's authoring preview and the exported endpoint. Compare JPG Ultra HDR and AVIF at matched 1,000-nit and above-4,000-nit peaks to separate format behavior from Chrome's peak/highlight handling. Do not assume that either the leading Chrome hypothesis or the Filmic-versus-AgX resemblance identifies the actual cause until that comparison is complete.

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

Test nominal headroom near +1, +2, +3, and +4 stops where the hardware permits. Compare the exact exported proxy in Chrome with Chrome Proof at the matching target using uniform patches, stepped highlights, gradients, saturated colors, and a representative image. Use the internal matrix endpoint when whole-stop regression tiles are needed. Repeat after reload and Chrome restart.

Accept up to approximately 10% luminance difference when highlight placement, clipping, gradients, and color remain perceptually close. Record a stable 5–10% bias without blocking release. Investigate obvious clipping differences, hue shifts, severe saturation changes, a wrong SDR base, a missing gain map, or differences clearly above about 10%. Do not use near-black percentages as a gate.

Classify failures as formula/adapter, headroom input, decode/color conversion, compositor/display, cache/refresh, or physical presentation.

### 3. State changes and browser variants

Run and record each format separately where applicable:

- drag Chrome between HDR and SDR displays; check immediate repaint, reload, and restart;
- toggle Windows HDR while Chrome remains open; check immediate repaint, reload, and restart;
- use the internal browser harness to A/B correct and wrong MIME;
- use the internal browser harness to A/B `dynamic-range-limit` and each presentation path;
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
