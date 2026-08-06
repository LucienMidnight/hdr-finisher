# Project Scope Document: HDR Finisher
### Open-Source HDR Web Conversion & Finishing Utility â€” v1.2

---

## 1. Project Summary

**HDR Finisher** is a standalone, offline, cross-platform desktop application for Windows and macOS. It is the missing last-mile link in a professional HDR photography and CGI workflow: it ingests 32-bit floating-point and HDR-encoded images from any editing software, provides a set of global finishing adjustments while displaying true HDR output in real time, and exports web-ready AVIF files with embedded ISO 21496-1 gain maps â€” the same output standard that previously required an Adobe subscription.

**Distribution:** Free and open-source. Donations accepted.

**Target Users:** Photographers, CGI artists, and web developers working with HDR image content for professional web publishing. The intended user has a working knowledge of HDR image editing but is not expected to be a programmer.

---

## 2. The Problem This Solves

As of early 2026, producing a high-quality AVIF with a properly crafted gain map â€” where the SDR base image is intentionally controlled rather than auto-generated â€” requires Adobe Camera Raw or Lightroom. There is no other cross-platform tool that:

- Accepts HDR output from non-Adobe editors (Blender, Affinity Photo, darktable, DXO PhotoLab, etc.)
- Displays the image in true HDR while making adjustments
- Gives the user explicit, creative control over the SDR fallback rendition embedded in the gain map
- Exports a finished AVIF or JPEG Ultra HDR with a standards-compliant gain map

HDR Finisher fills this gap. It is intentionally **not** a full image editor. It is a **finishing layer** â€” the last step before web export â€” designed to be used after the user has completed their primary editing work in whatever software they prefer.

---

## 3. Positioning & Scope Boundaries

### What This App Does
- Ingests 32-bit / HDR source files from any editor
- Displays them in true HDR via a browser-based viewport
- Provides global finishing adjustments (see Section 6)
- Gives explicit creative control over the SDR version embedded in the gain map
- Exports production-ready AVIF and technical-alpha JPEG Ultra HDR with gain maps

### What This App Deliberately Does Not Do
- RAW file processing / demosaicing (users should bring processed files)
- Local adjustments, masking, or selection-based editing
- Noise reduction, sharpening, or detail processing
- Layer compositing
- Image cataloging or library management
- Batch automation beyond single-file output to multiple formats

**Scope Creep Rule:** If a requested feature implies pixel-level selection, layer management, or AI-assisted processing, it is out of scope for v1. A clear in-app message should communicate that HDR Finisher is a finishing and export tool, not a general editor.

---

## 4. Supported Input Formats

### Tier 1 â€” Floating-Point (Scene-Linear HDR)
These are the ideal inputs. They contain genuine HDR data with values above 1.0.

| Format | Extension | Notes |
|---|---|---|
| OpenEXR | `.exr` | Primary format from Blender, Nuke, DaVinci Resolve, After Effects (32bpc mode) |
| 32-bit TIFF | `.tif`, `.tiff` | Output from Affinity Photo, Photomatix, PTGui, Lightroom HDR Merge |
| Radiance HDR | `.hdr` | Output from Affinity Photo; common for 360Â° environment maps |
| Portable Float Map | `.pfm` | Academic / programmatic HDR workflows |

### Tier 2 â€” Integer-Encoded HDR (PQ/HLG)
Valid HDR inputs, but metadata must be checked. A 16-bit TIFF without PQ/HLG encoding is just a high-precision SDR file.

| Format | Extension | Notes |
|---|---|---|
| 16-bit TIFF (PQ or HLG) | `.tif`, `.tiff` | Must contain PQ or HLG transfer function in ICC/color profile metadata |
| HEIC / HEIF | `.heic` | iPhone native HDR captures (10â€“12 bit PQ/HLG). **The HEIF parser must detect and apply auxiliary gain maps stored within the container when present.** iPhone HDR photos often contain an SDR base image plus an embedded gain map; decoding only the primary image will produce a false SDR result. |

### Tier 3 â€” Future / Stretch Goal
| Format | Extension | Notes |
|---|---|---|
| Linear DNG | `.dng` | Lightroom HDR Merge output; requires `rawpy` (LibRaw) â€” larger binary |
| JPEG XL (HDR) | `.jxl` | Round-trip editing support; requires `libjxl` |

---

## 5. Output Formats

| Format | Priority | Notes |
|---|---|---|
| AVIF + ISO 21496-1 Gain Map | **Primary** | Best quality-to-file-size ratio for web at 4K; ~95% browser support as of mid-2025 |
| JPEG Ultra HDR (JPG + Gain Map) | **Secondary** | Legacy JPEG-safe SDR fallback plus HDR gain map; HDR rendering support varies by browser, OS, and platform recompression |
| SDR JPEG / PNG | **Utility** | Tone-mapped fallback for legacy contexts; 8-bit |
| JPEG XL + Gain Map | **Stretch Goal** | Excellent format; Chrome support expected mid-2026 |

---

## 6. Finishing Tools (The Adjustment Layer)

These are the controls available while viewing the image in true HDR. All adjustments are non-destructive proxies applied to the in-memory float array; they are baked into the export.

### HDR Side Controls (affect the HDR output layer)
- **Tone Equalizer** — global, scene-referred exposure-band control with thirteen fixed nodes from -6 EV through +6 EV relative to the app's 0.18 / 100-nit diffuse-white reference. Each node supports up to +/-2 EV, the curve remains monotonic and hue-preserving, and the UI marks the 10,000-nit PQ boundary at +6.64 EV.
- **Global Exposure** â€” linear gain multiplier on the full HDR array
- **Highlight Rolloff** â€” soft compression of values above a user-defined threshold; the most critical control for HDR headroom management
- **Shadow Lift / Black Point** â€” floor adjustment
- **Lift / Gamma / Gain** â€” luminance-zone controls evaluated as smooth stop offsets in scene-linear light
- **Contrast / Pivot** â€” scene-linear contrast evaluated in exposure-value space around a user-controlled linear-light pivot
- **White Balance** â€” temperature (Kelvin) and tint sliders; applies a per-channel multiplier to the float data

HDR controls must remain continuous at their neutral values, preserve luminance ordering, and must not introduce an implicit ceiling when enabled. Values above the curve editor's nominal range pass through unless the user deliberately applies a highlight adjustment.

**HDR primary deprecation note:** Lift / Gamma / Gain are demoted legacy compatibility controls now that the Tone Equalizer is available. Keep them through real-image validation and preset/session compatibility testing, then remove the HDR controls and their processing path if they remain deprecated and no required workflow depends on them. This note does not apply to the independent SDR fallback trims.

### SDR Side Controls (affect only the SDR base image baked into the gain map)
- **SDR Exposure** â€” independent exposure control for the SDR rendition
- **SDR Highlight Recovery** â€” a monotonic display shoulder that holds 0.18 mid-gray stable while progressively lowering highlights
- **SDR Shadow** â€” independent shadow control
- **Lift / Gamma / Gain** â€” display-referred luminance-zone trims applied after SDR tone mapping
- **Contrast / Pivot** â€” display-referred midtone contrast for matching the SDR base to the HDR rendition

### Curves
- **Independent HDR and SDR RGB Curves** â€” each lane stores separate R, G, B, and Luma curves; editing the active preview lane must never alter the other lane
- Curves support adding and removing control points, retain locked endpoints, and preserve over-range HDR values outside the editor domain

The HDR and SDR lanes are independent grading branches after source interpretation. HDR-lane exposure, rolloff, shadows, lift/gamma/gain, contrast, white balance/tint, and curves must not alter the SDR fallback; SDR-lane controls must not alter the HDR alternate. Color-space interpretation and conversion into the ACEScg working space happen before this branch and remain shared.

### Tone Mapping Operators (v1)
The SDR base rendition is generated using the following operators:

- **ACES RRT** â€” default tone mapping operator; used for the exported gain map base image
- **Reinhard** â€” available as a lightweight fallback option, primarily useful for performance-constrained preview rendering

Additional operators are deferred to v2.

### Out of Scope for v1 (to be explicitly noted in UI)
- Hue/Saturation per-channel adjustments
- Tone curve presets beyond a flat default
- Any per-pixel or local control

---

## 7. Architecture

### Overview
Local web application. Python backend handles all image math and encoding; a local browser page serves as the true-HDR viewport and UI. Packaged as a standalone `.exe` (Windows) and `.app` (macOS) via PyInstaller.

### Why This Architecture
- The browser is currently the only viable cross-platform surface that can render true HDR images on both Windows and macOS without building a native GPU pipeline
- Python + NumPy is the most practical environment for floating-point image math, gain map computation, and access to the encoding tools
- FastAPI provides a clean, testable separation between math and UI

### Backend: Python + FastAPI
Responsible for: image loading, float array normalization, adjustment math, metadata extraction, scope data generation, preview encoding, and final export encoding.

### Frontend: HTML / CSS / JavaScript
Responsible for: UI layout, HDR image display (via PQ-encoded AVIF served locally), drag-and-drop ingestion, slider/curve controls, scope rendering (Canvas), and export triggering.

---

## 8. Tech Stack

### Core Python Libraries

| Library | Role | Notes |
|---|---|---|
| `fastapi` + `uvicorn` | Local API server | |
| `numpy` | All float array math | Core dependency for everything |
| `tifffile` | 32-bit TIFF read/write | Replaces FreeImage; actively maintained |
| `openexr` (ASWF) | EXR read | Official Academy Software Foundation binding |
| `imageio` | Radiance HDR (`.hdr`), PFM | Narrow use â€” these specific formats only |
| `rawpy` | Linear DNG decode | Wraps LibRaw; Tier 3 input; increases binary size |
| `pillow-heif` | HEIC decode | Required for iPhone HDR input; must support auxiliary image extraction for embedded gain maps |
| `colour-science` (`colour`) | Color space transforms, tone mapping algorithms, chromatic adaptation | Critical â€” handles ACEScgâ†’BT.2020, ACES RRT, PQ math. v1 uses colour-science; full OpenColorIO integration is deferred to v2 for DCC pipeline parity. |
| `exifread` | EXIF metadata extraction from DNG/TIFF | |

### Color Management & Internal Working Space

The canonical internal working space for all float array processing is **ACEScg (scene-linear)**. This is the correct choice for a tool that primarily ingests EXR and CGI sources, as converting to BT.2020 prematurely can clip wide-gamut values and distort color ratios during tone mapping.

**Transform paths:**
- EXR (ACEScg or scene-linear sRGB) â†’ ACEScg working space *(no-op or matrix)*
- EXR (ACES2065-1) â†’ ACEScg *(standard ACES matrix)*
- HEIC (BT.2020 PQ) â†’ ACEScg *(PQ decode â†’ BT.2020 â†’ ACEScg matrix)*
- 16-bit TIFF PQ â†’ ACEScg *(PQ decode â†’ matrix)*

**Output transforms for export:**
- HDR delivery: ACEScg â†’ BT.2020 PQ (AVIF, JXL)
- SDR base: ACEScg â†’ sRGB (via ACES RRT)

**Diffuse white reference:** Diffuse white is defined as **100 nits in PQ** (equivalent to 0.18 in scene-linear). All headroom calculations displayed in the Inspector ("X.X stops above diffuse white") use this reference consistently.

The `colour-science` library handles all matrix operations and PQ encode/decode. **This layer cannot be skipped or deferred** â€” incorrect color space handling produces silently wrong output.

### External CLI Binaries (bundled in package)
These are C/C++ command-line tools, not Python libraries. They must be compiled per-platform and bundled inside the PyInstaller package. This is a non-trivial packaging step.

| Binary | Role | Notes |
|---|---|---|
| `avifgainmaputil` | AVIF + gain map encoding | From `libavif` / AOMedia; separate Win/macOS builds required |
| `cjxl` / `djxl` | JPEG XL encoding | From `libjxl`; stretch goal |
| `ultrahdr_app` from `libultrahdr` | JPEG Ultra HDR encoding and validation | Built from pinned Google source with both `UHDR_WRITE_XMP=ON` and `UHDR_WRITE_ISO=ON`; resolved from bundled `bin/`, packaged runtime `bin/`, or `PATH` |

**Packaging Note:** All three binaries require OS-specific pre-built releases or build-from-source steps. This must be accounted for in the CI/CD pipeline. The Python layer calls these via `subprocess` with managed temp file paths.

### Gain Map Encoding Precision
The AVIF path uses a **10-bit logarithmic gain map**. JPEG Ultra HDR uses libultrahdr's standards-conforming JPEG gain map representation (8-bit gain-map samples) and carries both Ultra HDR v1 XMP and ISO 21496-1 metadata. Higher-precision gain maps remain deferred.

---

## 9. UI Layout

### Left Sidebar â€” The Inspector
- Resizable source rail: 268 px default, 200-380 px limits, keyboard-adjustable in 8 px increments, double-click reset, and viewport-bucket persistence
- Drag-and-drop zone (accepts all Tier 1 and Tier 2 formats)
- **Data Analyzer Badge:**
  - ðŸŸ¢ `True HDR Detected â€” Peak: X.X stops above diffuse white`
  - ðŸŸ¡ `HDR Encoded (PQ/HLG) â€” Peak: ~X nits`
  - ðŸ”´ `SDR Only â€” No headroom detected`
  - ðŸŸ  `Scene-linear file â€” HDR content unconfirmed. Please verify source.`
  - âš ï¸ `16-bit file detected â€” no HDR transfer function found. Treating as SDR.`
- **Metadata Panel:** Camera model, lens, ISO, shutter speed, color space, bit depth, detected transfer function

### Center â€” Viewport
- Full-resolution HDR preview (PQ-encoded AVIF served locally; CSS ensures no browser clamping)
- Toggle: `[ View HDR ] [ View SDR Fallback ]`
- The SDR toggle shows exactly what will be baked into the gain map base

### Right Sidebar â€” Finishing Controls
- Resizable grade rail: 320 px default, 280-420 px limits, keyboard-adjustable in 8 px increments, double-click reset, and viewport-bucket persistence
- Segmented control: `[ HDR Adjustments ] [ SDR Adjustments ]`
- Continuous instrument sliders with a narrow bar handle, eighth-scale landmarks, fixed tabular readouts, full-row hit targets, double-click reset, and Shift / Alt precision dragging (landmarks never snap)
- Banded disclosure headers with rotating carets, modified counts/dots, and contextual group reset actions
- RGB Curves editor
- Output format selector with quality/compression controls
- Export button
- Scope mode selector: histogram / waveform
- Scope channel selector: composite / luma / RGB parade
- Source Settings panel for auto vs manual interpretation override
- Export filename and save-path controls

### Bottom Panel â€” Scopes
- Resizable analysis dock: 208 px default, 96-340 px limits, 28 px collapsed strip, keyboard adjustment, double-click reset, and persisted height/open/tab state
- RGB Histogram (reflects the currently active view â€” HDR or SDR)
- False color / zebra overlay toggle (highlights clipped or over-range pixels)
- HDR reference-nit scopes use the app's internal anchor of `0.18 scene-linear = 100 nits`
- Waveform is available in addition to histogram and is the preferred spatial HDR diagnostic

---

## 10. Development Phases

### Phase 0 â€” Foundation & Architecture Setup
- Establish project repo, directory structure, and packaging scaffolding
- Confirm platform-specific binary builds for `avifgainmaputil` (Win + macOS) â€” **must be confirmed before any other work proceeds**
- Write and test `load_image()`: extension detection, routing to correct decoder, normalization to 32-bit float NumPy array in ACEScg working space
- **Float array sanitization:** All loaded arrays must be sanitized before any processing â€” replace NaN and Inf values, clamp negative luminance. This must be a mandatory first step in the pipeline and cannot be deferred.
- Write `validate_hdr()`: scans array for HDR content using the following classification logic:
  - `HDR_TRUE` â€” max pixel value > 1.0
  - `HDR_ENCODED` â€” PQ or HLG transfer function confirmed in ICC/color profile metadata
  - `HDR_LINEAR_UNCONFIRMED` â€” color space metadata confirms scene-linear encoding but max value â‰¤ 1.0 (common in CGI renders normalized before export); user is prompted to confirm HDR intent rather than forcing a classification
  - `SDR_ONLY` â€” no HDR indicators detected; max â‰¤ 1.0 and no linear/PQ/HLG metadata
  - Calculates peak headroom in stops relative to diffuse white (100 nits / 0.18 scene-linear)
- Write `extract_metadata()`: pulls EXIF, color profile, bit depth, and transfer function tags
- Establish color space pipeline using `colour-science`: ACEScg as canonical working space; define transform paths from each input format (see Section 8)
- For HEIC inputs: confirm `pillow-heif` auxiliary image extraction works correctly; verify that embedded gain maps in HEIF containers are detected and applied

### Phase 1 â€” Backend Core & API
- Initialize FastAPI server with auto-start on app launch
- Implement `/upload` endpoint: ingests file, runs sanitization, validation, and metadata extraction, returns JSON summary
- Implement `/preview` endpoint: applies current adjustment state to float array, encodes a fast PQ-AVIF preview (downsampled for speed), returns as binary
- Implement `/preview/sdr` endpoint: generates the tone-mapped SDR rendition using current SDR controls
- Implement `/scopes` endpoint: returns histogram data as JSON
- Implement adjustment math functions for all controls in Section 6
- Write `compute_gain_map()`: the core math function that computes the per-pixel gain map delta between the HDR and SDR arrays per ISO 21496-1, encoded at 10-bit logarithmic precision

**Critical note on preview performance:** Full AVIF encoding for 4K preview is too slow for interactive use. The preview pipeline should downsample to a maximum of 1920px on the long edge and use fast encoder settings. The final export uses full resolution and quality settings.

### Phase 2 â€” Frontend Skeleton & Diagnostic Integration
- Build `index.html`, `styles.css` (dark mode, HDR-aware), and `app.js`
- Implement drag-and-drop file listener
- Wire `/upload` response to populate the Inspector panel (badge + metadata)
- Build viewport with HDR/SDR toggle; ensure correct CSS color-gamut and dynamic-range properties
- Implement slider and curves UI; wire to backend adjustment state

### Phase 3 â€” HDR Preview Engine
- Wire slider changes to re-fetch `/preview` with debounce (avoid hammering encoder on every frame)
- Ensure browser viewport correctly renders PQ-AVIF as HDR (not clamped to SDR)
- Implement SDR preview toggle to show exact gain map base image
- Validate HDR vs SDR preview parity with scope readout

### Phase 4 â€” Scopes
- Implement RGB histogram using Canvas; reads from `/scopes` endpoint
- Histogram reflects current view (HDR float values or SDR 8-bit rendition)
- Optional: false color overlay highlighting out-of-range pixels
- Add waveform scope mode and richer HDR reference readouts
- Add reference guide lines and summary stats for diffuse white / HDR headroom validation

### Phase 5 â€” Export Pipeline
- Wire export button to trigger full-resolution processing pipeline:
  1. Apply adjustment stack to source float array
  2. Generate SDR base via tone-mapping stack (ACES RRT default)
  3. Call `compute_gain_map()` to produce 10-bit logarithmic gain map array
  4. Route to `avifgainmaputil` (AVIF) or `cjxl` (JXL) via subprocess
  5. Return output file path to frontend for download prompt
- Maintain JPEG Ultra HDR export through the current verified `ultrahdr_app` CLI and validate both metadata representations before publishing the staged file
- Implement SDR JPEG/PNG fallback export
- Quality/compression controls for each format

### Phase 6 â€” Packaging & Distribution
- PyInstaller configuration for Windows (`.exe`) and macOS (`.app`)
- Bundle OS-specific `avifgainmaputil` and `ultrahdr_app` binaries; keep `cjxl` deferred with JPEG XL
- Handle PATH management and binary permissions at runtime
- Test on clean machines (no Python installed) on both platforms
- GitHub release pipeline with signed builds (macOS notarization required to avoid Gatekeeper warning)

### Licensing & Commercial Distribution
- HDR Finisher is currently distributed under **GPL-3.0**. It may be sold, bundled with paid support, or funded by donations, but anyone receiving a binary must also be able to obtain the corresponding source and build materials under GPL-3.0. Recipients retain the right to modify and redistribute their copies.
- User-authored input media and exported JPEG, AVIF, or PNG files are **not** placed under GPL-3.0 merely because HDR Finisher processed them.
- A future proprietary or dual-licensed edition is possible only for code whose copyright is controlled by the project owner. Relicensing contributed code requires the relevant copyright holders' permission, and already-published GPL releases remain available under GPL-3.0.
- Google `libultrahdr` is distributed under the terms of both the MIT License and Apache License 2.0, which are compatible with HDR Finisher's GPL-3.0 distribution. Packages containing `ultrahdr_app` must retain the upstream copyright and license texts.
- Adobe grants a worldwide, royalty-free patent license for compliant Gain Map implementations. Distributed source and documentation must prominently retain the required notice: **"This product includes Gain Map technology under license by Adobe."** The implementation must remain standards-compliant to rely on that grant.
- `libjpeg-turbo` and any other compiled dependencies keep their own permissive notices. Release archives must include `THIRD_PARTY_NOTICES.md` and the copied license files under the packaged `bin/licenses/` directory.
- The licensing requirements are release-compliance work, not an encoder availability restriction: no per-user, per-export, or royalty payment is expected for the compliant Ultra HDR path described here.

---

## 11. Known Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `avifgainmaputil` binary packaging complexity | High | Confirm binary builds for both platforms in Phase 0 before writing any other code |
| AVIF preview encoding too slow for interactive use | Medium | Downsample previews; use fast encoder presets; debounce slider events |
| Reference HDR preview and delivered browser rendering do not match in apparent brightness | High | Keep the authored 100-nit-reference HDR view, but explicitly distinguish it from display-adaptive delivery. Evaluate a **Browser Delivery** mode that encodes a proxy with the real AVIF gain-map pipeline and presents it through a normal browser image element, allowing the active browser and monitor to apply their actual headroom adaptation and tone mapping. Do not claim an exact Chrome simulation from coarse web capability probes. |
| Color space metadata missing or ambiguous in input files | Medium | Implement explicit user override: "This file has no color profile â€” please select one" dialog |
| macOS Gatekeeper rejecting unsigned binary | High | Budget time for Apple Developer ID signing and notarization |
| `libultrahdr` AVIF support not yet released | Low | JPEG Ultra HDR (JPG) is fully functional now; AVIF via libultrahdr is a 2026 addition |
| Scope creep from user feature requests | Medium | Enforce scope boundary in README and in-app UI copy from day one |
| Large EXR files exceeding available RAM | Medium | 32-bit EXR panoramas can exceed 1GB in memory before processing copies; tiled/chunked processing is deferred to v2. v1 should display a clear error rather than crashing if memory limits are exceeded. |
| NaN/Inf values in EXR from rendering software | Medium | Mandatory float sanitization step in Phase 0 pipeline eliminates this risk before any math runs |
| HEIC auxiliary gain map not detected | Medium | Confirmed in Phase 0; if `pillow-heif` cannot extract auxiliary images, an alternative HEIF parser must be evaluated before v1 ships |

---

## 12. Out of Scope for v1 (Explicit Deferrals)

The following are reasonable future features but are explicitly deferred to avoid scope bloat:

- Batch processing of multiple files
- Preset saving / loading for adjustment stacks
- Soft proofing for specific display profiles
- Any local/masked adjustment
- Integration with darktable, Lightroom, or any external editor via plugin or watch folder
- Mobile / web-hosted version
- Windows on ARM
- OpenColorIO integration (full ACES config LUT support, RRT+ODT chain) â€” colour-science handles v1 transforms; OCIO is the path to full DCC pipeline parity in v2
- Tiled/chunked processing for very large EXR files
- Gain map precision above 10-bit (16-bit float gain maps deferred to v2)
- Additional tone mapping operators beyond ACES RRT and Reinhard

---


## 13. Current Repository Checkpoint (2026-08-06)

The repository is no longer at the original vertical-slice stage. It now provides a usable single-image HDR finishing workflow with real AVIF and JPEG Ultra HDR gain-map export, true HDR browser preview, Apple HEIC HDR reconstruction, independent SDR fallback control, scopes and diagnostics, and delivery proofing that distinguishes authored intent, encoded fixed-headroom reconstruction, and the installed browser's live rendering. Detailed browser-proofing status and the evidence protocol are maintained in `md/Delivery_Proofing_Sprint.md`.

### Implemented in the Current Slice
- Single-session local workflow with import, eject, and drag-and-drop into the main viewport
- HDR classification, metadata inspection, and source interpretation override flow
- Real `colour-science` normalization into ACEScg for supported source types
- Apple HEIC auxiliary HDR gain-map detection and reconstruction
- True HDR browser preview using downsampled PQ AVIF transport
- SDR fallback preview using the preserved embedded SDR base when available
- HDR and SDR adjustment controls with real backend math
- RGB Curves editor with Luma / R / G / B channels applied to the active preview side
- Histogram scopes endpoint and frontend rendering
- HDR waveform mode with selectable composite / luma / RGB parade channels
- HDR reference-nit guide lines and summary stats (`Peak`, `P99`, `P95`, `Median`, `% > 100`, `% > 203`, `% > 1000`)
- False color and zebra diagnostic overlay modes
- False-color luminance presets for common HDR conventions:
  - Web HDR `1000 nit peak / 100 nit diffuse white`
  - BT.2408 `1000 nit peak / 203 nit reference white`
  - BT.2408 `4000 nit peak / 203 nit reference white`
  - SDR `100 nit white`
- Tooltip help for source interpretation and overlay controls
- Export filename and save-path controls in the UI
- Real AVIF + ISO 21496-1 gain-map export via bundled Windows binaries
- Real JPEG Ultra HDR export with Ultra HDR v1 XMP and ISO 21496-1 metadata; JPEG is the provisional delivery default
- SDR PNG export
- Three proofing views: **Authoring**, **Delivery Matrix**, and **Live Browser Check**
- Fixed-headroom reconstruction at +0 through +4 stops and full encoded headroom, with numerical peak/clipping data and above-display-headroom warnings
- Live delivery proxies generated by the production JPEG/AVIF exporters and served through immutable content-hashed URLs
- Windows display telemetry for HDR state, SDR white, bit depth, DXGI luminance, and nominal headroom
- Structured browser/display observations stored locally with exact browser versions and a 180-day staleness policy
- Generated float-TIFF delivery target with neutral headroom patches, saturated colors, and dark-to-HDR gradients
- Hosting survival verifier for byte identity, MIME, automatic format conversion, gain-map presence, and metadata preservation
- Bundled HDR reference sample generation and serving
- EXR import validation against synthetic and real Blender exports
- Automated tests for core math, classification behavior, HEIC reconstruction, preview/export helpers, scopes, and API flow
- Float-preserving Lanczos proxy downsampling with regression coverage for high-frequency detail, replacing unfiltered point decimation that produced severe mesh and foliage aliasing
- Validated Affinity build 4646 Sony RAW handoff guidance using a 32-bit floating-point OpenEXR in linear Display P3

### Current API Surface
- `POST /api/session`
- `GET /api/session/{id}`
- `DELETE /api/session/current`
- `POST /api/session/{id}/interpretation`
- `POST /api/session/{id}/preview/hdr`
- `POST /api/session/{id}/preview/sdr`
- `POST /api/session/{id}/overlay`
- `GET /api/session/{id}/scopes`
- `GET /api/capabilities`
- `POST /api/session/{id}/export`
- `POST /api/session/{id}/proof/artifact`
- `GET /api/proof/artifact/{hash}.{ext}`
- `POST /api/proof/matrix`
- `GET /api/proof/tile/{hash}.avif`
- `GET /api/display`
- `GET /api/proof/test-pattern`
- `GET /api/proof/evidence`
- `POST /api/proof/evidence`

### Current Repository Layout
- `backend/hdr_finisher/` - FastAPI app, session store, loaders, color pipeline, adjustment math, preview/scopes/export services
- `frontend/` - static HTML/CSS/JS app served by FastAPI
- `tests/` - unit and API tests with synthetic and real fixture coverage
- `tools/` - helper scripts for samples, fixtures, and capability checks
- `samples/` - bundled HDR reference assets for local verification

### Verification Completed at This Checkpoint
- The full test suite passes with `175 passed, 1 skipped`; the alpha QA harness, capability checks, and JavaScript syntax checks also pass
- Real JPEG Ultra HDR and AVIF gain-map proof proxies and fixed-headroom matrices are covered by integration tests using the bundled production encoders
- Formula tests cover known whole-stop gain-map results and base/full endpoint reconstruction
- Installed headless Google Chrome 150 and Edge 151 proofing smoke tests pass with no console/page errors, exact proxy decode, all presentation variants, generated test-pattern import, and proof persistence across background scope refreshes
- The 1280 px layout regression passes with zero horizontal overflow
- Headless browser results validate transport, browser decode, APIs, state, and layout; they do not establish physical HDR parity or satisfy the Windows Chrome release gate by themselves
- Local manual validation on April 8, 2026 confirmed:
  - true HDR preview is working in Brave
  - Apple HEIC HDR photos decode with auxiliary gain maps applied
  - SDR fallback now perceptually matches the preserved HEIC SDR base in Windows Photos
  - AVIF gain-map exports render correctly in Brave after CICP / matrix fixes
  - EXR imports from Blender load and preview correctly
  - synthetic EXR exposure charts produce sensible histogram and waveform separation
  - a real Blender render validates useful HDR waveform reads on both HDR and SDR displays
  - local git backup workflow was verified with commit + push to GitHub remote
- Windows JPEG Ultra HDR validation completed on July 30, 2026:
  - the pinned Google `libultrahdr` source revision builds successfully with MSVC and its native unit tests pass
  - `ultrahdr_app.exe` is bundled with the application together with the required license and attribution notices
  - both the generated reference export and a real full-resolution image pass legacy JPEG decode, embedded gain-map detection, Ultra HDR v1 XMP detection, ISO 21496-1 metadata detection, and native libultrahdr HDR decode
  - validation confirms two embedded JPEG images and that the decoded HDR result is brighter than the SDR base
  - the packaged Windows application reports JPEG Ultra HDR export as available
  - the PyInstaller portable Windows alpha ZIP has been rebuilt and smoke-tested with the verified encoder included
- Affinity-to-HDR-Finisher round-trip validation completed on August 6, 2026:
  - a 42.39 MP Sony ILCE-7RM3 ARW was developed in Canva-era Affinity build 4646 as RGB/32 HDR, converted to `Display P3 (Linear)`, and exported as single-layer OpenEXR 32-bit float
  - Affinity's TIFF `RGB 32-bit` export was proven to contain bounded unsigned-integer samples and is therefore rejected as the recommended true-HDR interchange for this build
  - the OpenEXR retained a `13.59` linear peak, or 6.24 stops above diffuse white; because Affinity omitted EXR chromaticities, HDR Finisher correctly required the matching manual `Display P3 Linear` interpretation
  - post-fix preview detail was visually validated against Affinity; the final quality-85 AVIF gain-map export retained matching detail/noise, activated HDR in Chrome on the HDR monitor, and selected the authored SDR fallback when moved to the SDR monitor
  - delivery inspection confirmed an 8-bit sRGB base, 10-bit YUV444 logarithmic gain map, BT.2020/PQ alternate, base headroom `0.00`, and alternate headroom `5.26035`
  - the export folder picker failed during the live Windows test; direct destination-path entry worked and remains the temporary fallback

### Current Blockers and Known Gaps
- The Windows JPEG Ultra HDR implementation blocker is cleared: the native encoder is built, bundled, attributed, and validated. Remaining release work is clean-machine redistribution validation; macOS will require its own native build and packaging path.
- JPEG XL gain-map export is still stubbed; `cjxl` is not wired yet
- A portable PyInstaller Windows alpha ZIP now exists and passes its smoke test. A conventional installer, upgrade/uninstall behavior, version metadata, and clean-machine testing are not yet complete.
- Windows Photos remains an unreliable validation target for AVIF gain-map HDR compared with Brave / Chromium browsers
- Preview AVIF quality is now usable, but still tunable; a future user-facing preview-quality control may be worthwhile
- The authored/reference-versus-delivery distinction is now implemented in the UI. Remaining work is empirical: verify how the fixed matrix and exact live proxy respond to Windows SDR-white changes and establish physical Windows Chrome parity within the accepted practical tolerance.
- Browser APIs still provide only coarse HDR capability signals. Windows-native telemetry now supplies SDR white and nominal headroom inputs, but those values cannot reveal every private browser/compositor/display decision and must not be presented as colorimetric certification.
- The Browser Delivery direction is implemented for both JPEG Ultra HDR and AVIF gain maps. It intentionally reports the active browser/device rather than claiming to emulate Chrome or predict other systems.
- Cross-browser behavior remains a delivery QA concern. A browser-native delivery preview reflects only the current browser, OS, monitor, and HDR settings; it cannot predict Safari, Firefox, a television, or a different display. Unsupported gain-map renderers should naturally show the SDR base and the UI should report that limitation without treating it as a failed export.
- The Windows export folder picker failed in real use while direct path entry succeeded; diagnose and fix the picker before installer release.
- EXR automatic color-space detection is safer now, but still depends on source metadata / chromaticities; fully robust auto-detection remains a quality target rather than a solved problem
- The major three-rail UI-density and responsive-shell pass is complete. Export guidance and final installer-era copy remain candidates for smaller follow-up refinement.

### Technical Alpha Packaging Direction
The portable technical-alpha milestone has been reached locally: the zipped Windows build runs without a local Python install and includes the required AVIF and JPEG Ultra HDR encoder binaries. The next packaging milestone is a conventional per-user Windows installer, after a focused UI/UX and installer-readiness pass.

The Windows release should prioritize:
- Windows first
- AVIF + gain-map export, JPEG Ultra HDR export, SDR PNG export, and the existing import / preview / adjustment workflow
- Bundled sample media or a one-command sample generation path
- Clear capability reporting and actionable errors for bundled export backends
- Automatic browser launch, reliable single-instance / port handling, clean shutdown, and user-writable runtime directories
- Application icon and version metadata, Start menu integration, uninstall support, and retention of the portable ZIP option
- Clean-machine install, upgrade, export, and uninstall validation on Windows
- Release notes that state Chromium / Brave / Edge are the preferred HDR validation targets

The Windows installer release should not be blocked by:
- Windows code signing
- macOS signing / notarization
- JPEG XL export
- Broader editing scope such as RAW development, local adjustments, layers, cataloging, or batch processing

After the Windows installer proves the workflow on clean machines, the packaging track can move to a macOS `.app` and `.dmg`, native macOS encoder builds, signing/notarization, and broader release automation.

### Implementation Reality vs PRD
- **Preview transport:** the PRD target of true HDR browser preview is now implemented. HDR previews are served as PQ AVIF and SDR previews remain display-safe fallback images.
- **Preview resampling:** the 1920-pixel proxy remains intentionally bounded, but its downsampling now uses per-channel float32 Lanczos filtering clamped to the source channel extrema. This removes the severe alias/noise pattern caused by integer point sampling without inventing negative light or new HDR peaks. UI `100%` remains proxy-pixel 1:1, not source-pixel 1:1.
- **Reference versus delivery rendering:** Authoring, Fixed-headroom Delivery Matrix, and Live Browser Check are now separate views. The matrix is authoritative for encoded reconstruction; the live view is authoritative for the tested browser/OS/display. Neither promises brightness identity with the authored fixed-reference canvas.
- **Color-management pipeline:** the previously scaffolded `colour-science` layer is now active for supported transforms instead of being metadata-only.
- **HEIC auxiliary gain maps:** iPhone HDR HEIC files are no longer decoded as false SDR when Apple auxiliary gain-map data is present; the gain map is applied and the embedded SDR base is preserved separately for fallback output.
- **Source ambiguity handling:** the `HDR_LINEAR_UNCONFIRMED` / ambiguous color-state warning now has a real user override workflow in the UI and backend session model.
- **Source override UX:** the app now separates color primaries from transfer function and exposes a manual Source Settings workflow more like Resolve's auto/manual color-management split.
- **Adjustment layer:** HDR primaries use continuous scene-linear stop-domain math, SDR trims remain independent and display-safe, and HDR/SDR curves now have separate state with add/remove point controls.
- **HDR tone equalizer:** the HDR branch now includes a fixed -6 EV through +6 EV exposure-band graph with a marked +6.64 EV / 10,000-nit PQ boundary, monotonic smoothing, hue-preserving RGB scaling, and matching backend/export and WebGPU-preview processing. HDR Lift / Gamma / Gain remain demoted for compatibility pending a later removal decision.
- **Branch isolation:** the SDR fallback now starts from the neutral interpreted source or embedded HEIC SDR reference, never from the HDR-graded branch; HDR-lane controls are regression-tested for zero influence on both SDR paths.
- **Wide-range control QA:** every image-affecting slider is regression-tested by one browser step against wide EXR-like values for finite output, luminance ordering, and gradual response; the SDR-reference path is tested separately.
- **Scopes:** the original histogram goal is now exceeded by an HDR waveform mode, reference-nit labeling, and luma / parade diagnostics that make the tool more useful on SDR-only displays.
- **Viewport diagnostics:** false color and zebra overlays are now implemented, including named HDR luminance presets and explanatory tooltips.
- **UI state reliability:** the earlier broken-image / empty-state overlap bug has been cleaned up, and a later layout pass resolved right-rail clipping, tooltip placement, overlay-image positioning, and stray frame-corner ornament bugs.
- **Instrument UI pass:** the source rail, grade rail, and analysis dock are now directly resizable with clamped mouse, keyboard, double-click-reset, and viewport-bucket persistence behavior. Control groups use banded disclosure headers, and native accessible ranges retain keyboard semantics while adding continuous bar-handle interaction, fixed numeric readouts, scale landmarks, precision modifiers, and a trailing 90 ms preview request cadence.

### Current UI Testing Notes
- The UI has been refactored into a three-rail layout: Inspector on the left, preview center, controls/scopes/export on the right
- At 1280 px the shell has no horizontal overflow, the grade rail retains at least 180 px of usable slider track, and all three splitters remain keyboard accessible and persistent
- A repo-local Playwright preview script smoke-tests the local UI in Edge or bundled Chromium and writes artifacts under `codebase/output/playwright/`
- A repo-local alpha QA harness now runs tests, capability checks, sample AVIF export, AVIF metadata inspection, and Playwright preview, with reports under `codebase/output/qa/`
- A Windows alpha build script now targets a zipped PyInstaller folder artifact and smoke-tests the packaged app before archiving
- Import can now happen either through the `Import Image` button or by dropping directly into the preview viewport
- The left rail intentionally hides its scrollbar in normal desktop use while remaining scrollable if overflow occurs
- Technical preview readouts now show app output transport, browser display probe data, and source interpretation details
- Browser-based HDR validation is currently the most trustworthy path for AVIF gain-map output; Windows Photos should be treated as secondary / advisory
- Delivery proofing browser QA now covers JPEG Ultra HDR and AVIF independently, exposes MIME, `dynamic-range-limit`, CSS size/transform/opacity/transition paths, and records structured physical-display observations
- The installed Chrome smoke run reports the full browser version and confirms the live proxy, matrix, test pattern, state lifecycle, and layout paths; a headed physical-HDR observation remains required
- The right rail required explicit width, wrapping, and scrollbar tuning. The fixed state keeps the rail usable by:
  - widening the rail and giving the center preview less dominance
  - slimming the internal scrollbar
  - allowing scope header controls to wrap
  - removing corner ornaments from scrolling rail content where they produced floating artifacts
- Overlay tooltips now open inward instead of clipping off the screen
- The diagnostic overlay image is now positioned against the rendered preview image box rather than using independent layout assumptions

### Recommended Next Steps After This Checkpoint
1. Run the Windows SDR-white response sequence first using the generated test target at low, middle, high, and useful whole-stop-adjacent settings. Confirm artifact/tile hashes remain fixed and save structured highlight, midtone, color, overall, reload, and restart observations.
2. Compare exact JPEG Ultra HDR and AVIF proxies against the nearest matrix tile in headed Windows Chrome. Accept a stable 5–10% bias when highlight placement, clipping, gradients, and color remain close; investigate obvious clipping/color differences or discrepancies clearly above roughly 10%.
3. Record Chrome behavior when moving between HDR and SDR displays and when Windows HDR is toggled, including immediate repaint, reload, and full restart outcomes.
4. Test JPEG and AVIF separately in Firefox, Mac Chrome, and Safari. Treat Safari headroom conclusions on the available 500-nit MacBook as exploratory.
5. Run the hosting survival sequence: Cloudflare Pages direct bytes, Cloudflare transformations, WordPress originals/generated sizes, and one additional optimizer/CDN. Keep JPEG as provisional default unless the evidence threshold in `md/Delivery_Proofing_Sprint.md` is met.
6. Fix the Windows export folder picker and retain direct path entry as a resilient fallback.
7. Complete installer-readiness changes: automatic browser launch, single-instance and port-conflict handling, clean shutdown, user-writable runtime directories, path portability, quiet console behavior, and application icon/version metadata.
8. Continue documented darktable RAW and Blender 5.2 LTS source-export validation after the completed Affinity workflow.
9. Build and clean-machine validate a conventional per-user Windows installer, then publish release notes with checksums, supported workflows, evidence-backed browser claims, and known limitations.
10. Start native macOS encoder and `.app`/`.dmg` packaging after the Windows installer stabilizes. Keep JPEG XL deferred unless it becomes strategically important or straightforward to ship.

---

## 14. Local Developer Quick Start

This PRD defines the target product, but the current repository already provides a runnable local development slice for implementation and testing.

1. Create and activate a Python 3.12+ virtual environment
2. Install dependencies with `pip install -r requirements-dev.txt`
3. Run the local app with `python run_app.py`
4. Open `http://127.0.0.1:8000`
5. Optionally run `python tools\check_capabilities.py` to inspect local decoder and encoder availability

### Manual Git Backup Workflow
When the user asks for a quick backup from the VS Code terminal, give them this flow:

1. Check the repo state:
   - `git status`
2. Stage everything that is not already excluded by the repository `.gitignore`:
   - `git add -A`
3. Optionally inspect what is staged:
   - `git diff --cached --stat`
4. Create the local backup commit:
   - `git commit -m "Checkpoint UI and HDR workflow polish"`
5. Upload the backup to GitHub:
   - `git push`
6. If the branch has no upstream yet, use:
   - `git push -u origin HEAD`

This repository's root `.gitignore` already excludes local exports, EXR / HDR working assets, caches, and editor artifacts, so `git add -A` is the preferred default unless the user explicitly wants a narrower commit.

---

*Document version 1.2 - revised following technical review and JPEG Ultra HDR implementation*
*Changes from v1.0: ACEScg internal working space; diffuse white definition; HEIC auxiliary gain map requirement; NaN/Inf sanitization; HDR detection logic (HDR\_LINEAR\_UNCONFIRMED state); gain map bit depth locked to 10-bit logarithmic; tone mapping operators specified; large EXR memory risk added; OCIO v2 deferral noted.*
*April 8, 2026 implementation addendum: false color / zebra overlays, HDR reference-nit histogram and waveform scopes, source interpretation manual override workflow, EXR validation notes, export filename/save-path controls, UI bug-fix summary, and the local git backup / push workflow are now recorded in this PRD.*
*July 22, 2026 implementation addendum: JPEG Ultra HDR now consumes independent HDR and SDR branches through libultrahdr, publishes atomically only after legacy / gain-map / metadata / decoder validation, supports bundled and packaged binary discovery, and includes a pinned Windows build and attribution workflow. JPEG XL remains out of scope.*
*July 30, 2026 implementation addendum: the pinned libultrahdr Windows build, native tests, complete 110-test alpha QA run, real-image JPEG Ultra HDR validation, packaged capability check, and portable PyInstaller ZIP all pass. The delivery sequence is now UI/UX refinement, installer-readiness work, a conventional Windows installer with clean-machine validation, and then macOS packaging. JPEG XL remains deferred.*
*July 31, 2026 implementation addendum: the instrument-style UI pass adds a tokenized dark visual system, banded disclosure groups, continuous bar-handle sliders, and persisted keyboard-accessible source/grade/dock splitters. The 1280 px shell and 90 ms preview cadence have dedicated browser regression coverage.*
*August 6, 2026 implementation addendum: the Affinity build 4646 Sony RAW workflow is validated through linear Display P3 OpenEXR import and quality-85 AVIF gain-map delivery on paired HDR/SDR monitors. Affinity's bounded integer TIFF limitation and missing EXR chromaticities are documented; manual `Display P3 Linear` interpretation is required. Float-preserving Lanczos preview downsampling fixes severe high-frequency aliasing and has automated plus real-image validation. Delivery proofing is now implemented for JPEG Ultra HDR and AVIF through separate Authoring, fixed-headroom Matrix, and Live Browser views with Windows headroom telemetry, content-hashed proxies, structured evidence, generated test media, and hosting-survival tooling. Automated coverage passes at 175 tests plus installed-Chrome/Edge smoke and 1280 px layout QA. Physical Windows Chrome parity, monitor/HDR state changes, cross-browser behavior, and real hosting pipelines remain the next evidence phase; the Windows export folder picker also requires repair.*
