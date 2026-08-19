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

| AVIF HDR / ISO 21496-1 gain map | `.avif` | Supported through bundled libavif tools. Plain SDR, direct PQ/HLG HDR, and standards-compliant gain-map AVIF are routed explicitly; malformed or unsupported HDR metadata is rejected rather than silently presented as SDR. |
| JPEG Ultra HDR | `.jpg`, `.jpeg` | Gain-map JPEGs are detected before the ordinary Pillow JPEG path and reconstructed through the bundled libultrahdr decoder. The legacy SDR base is retained independently. Plain JPEG remains supported as SDR. |

### Future Input Research (Not Yet Supported)
| Format | Extension | Research boundary |
|---|---|---|
| JPEG XL (HDR / gain map) | `.jxl` | Later. Current interoperability and preservation value do not justify another native toolchain and proof matrix yet. Reconsider only with a representative corpus and verified Windows/macOS, editor, browser, and hosting round trips. |
| Rendered Linear DNG | `.dng` | Later, constrained input-only candidate. A future proposal must define explicit rendered RGB samples, color interpretation, white balance, black/white levels, baseline exposure, and orientation. Mosaiced RAW, demosaicing, camera profiles, and general RAW development remain outside v1. |
| Camera RAW | Camera-dependent (`.arw`, `.cr2`, `.cr3`, `.nef`, `.orf`, `.raf`, `.rw2`, `.dng`, and others) | Consider after v1 as a separate product-scope investigation. LibRaw, potentially through the open-source `rawpy` Python wrapper already identified below, is a candidate decoding foundation. Before committing support, define whether HDR Finisher would provide only a deliberately constrained, deterministic RAW-to-linear ingest or a broader RAW-development workflow, and evaluate camera coverage, demosaicing quality, white balance, camera profiles, highlight recovery, orientation/crop metadata, licensing, maintenance, packaged binary size, and cross-platform behavior. |

**Candidate sources to evaluate first:** DxO PhotoLab's "linear DNG" export (demosaiced/denoised/lens-corrected, no baked tone curve) and Adobe's linear DNG output (Lightroom Classic/Camera Raw "Convert to DNG" and Merge-to-HDR DNG) both name-match this candidate and are worth pulling real files from before writing a proposal. Verify per app with `exiftool`/`dcraw -i -v`: whether a display tone curve is silently baked in despite the "linear" label, and whether `ColorMatrix1/2`, `CalibrationIlluminant`, `AsShotNeutral`, black/white levels, and `BaselineExposure` are populated well enough for a deterministic ACEScg mapping without camera-profile selection. See [DNG recommendation](../testing/Codebase_Review_Cleanup_and_Round_Trip_Results_2026-08-11.md#dng-recommendation-later-constrained-candidate-only) and the [DNG research questions](../testing/Codebase_Review_Cleanup_and_Round_Trip_Sprint.md#55-dng-research-questions) for the full evaluation checklist.

### Input Round-Trip Principle

Formats produced by HDR Finisher are priority import candidates. AVIF gain-map and JPEG Ultra HDR round trips compare the exact exported artifact with its re-imported HDR rendition and independent SDR fallback, including gain-map presence, color primaries, transfer function, reference white, encoded headroom, clipping, highlight ordering, dimensions, orientation, and representative pixel/perceptual parity. Valid HDR exports must never be silently reduced to their SDR base, double-decode PQ/HLG, apply a gain map twice, or double-tone-map the SDR branch. Two-generation lossy round trips are accepted within explicit SDR, HDR-distribution, and headroom tolerances rather than requiring byte or pixel identity.

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
| `imagecodecs` | Compressed TIFF segment decoding | Keep the current dependency and full packaged codec set for import reliability. A later evidence-led packaging pass may retain only the TIFF codecs proven necessary by a representative compatibility corpus; do not remove or narrow it before that corpus and packaged-app tests exist. Bundled codecs do not automatically make their file extensions valid HDR Finisher inputs. |
| `openexr` (ASWF) | EXR read | Official Academy Software Foundation binding |
| `imageio` | Radiance HDR (`.hdr`), PFM | Narrow use â€” these specific formats only |
| `rawpy` (research candidate) | Potential Linear DNG decode | Not a current production dependency. Evaluate its LibRaw behavior, color/metadata fidelity, maintenance, and binary-size cost before defining a supported DNG subset. |
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

**Windows MVP status — August 16, 2026:** Electron package 0.3.1 has passed installed-app hands-on validation for native import, interactive adjustment, project operation, and export. The initial 0.3.0 build exposed a transient console-window flash when settled HDR previews launched `avifenc`; 0.3.1 launches all bundled encoder/decoder subprocesses without a visible console, and the installed fix was confirmed by the product owner. Branding, application icon, and installer presentation remain deliberately deferred until the functional desktop baseline receives broader workflow testing.

- Execute the desktop-shell migration through [Electron Desktop Wrapper Sprint](Electron_Desktop_Wrapper_Sprint_PRD.md). Keep it on a separate feature branch until its security, lifecycle, WebGPU, project-round-trip, and clean-package gates pass.
- PyInstaller configuration for Windows (`.exe`) and macOS (`.app`)
- Bundle OS-specific `avifgainmaputil` and `ultrahdr_app` binaries; keep `cjxl` deferred with JPEG XL
- Keep `imagecodecs` packaged as-is for the current installer. Record its size separately and revisit selective codec collection only after TIFF compatibility fixtures cover representative uncompressed, LZW, Deflate/ZIP with predictors, PackBits, tiled/striped, integer, and floating-point files from real source applications.
- Handle PATH management and binary permissions at runtime
- Test on clean machines (no Python installed) on both platforms
- GitHub release pipeline with automated builds, SHA-256 checksums, and retained build provenance. V1 preview builds may be unsigned under the launch plan below; signing is a post-V1-readiness follow-up rather than a launch blocker.

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
| macOS Gatekeeper rejecting unsigned binary | High | Label the initial unsigned macOS package as a technical preview and document the expected Gatekeeper approval path. Before targeting ordinary Mac users, enroll in the Apple Developer Program, sign every bundled executable with Developer ID, enable hardened runtime, notarize the release, and staple the ticket. |
| `libultrahdr` AVIF support not yet released | Low | JPEG Ultra HDR (JPG) is fully functional now; AVIF via libultrahdr is a 2026 addition |
| Scope creep from user feature requests | Medium | Enforce scope boundary in README and in-app UI copy from day one |
| Large EXR files exceeding available RAM | Medium | 32-bit EXR panoramas can exceed 1GB in memory before processing copies; tiled/chunked processing is deferred to v2. v1 should display a clear error rather than crashing if memory limits are exceeded. |
| NaN/Inf values in EXR from rendering software | Medium | Mandatory float sanitization step in Phase 0 pipeline eliminates this risk before any math runs |
| HEIC auxiliary gain map not detected | Medium | Confirmed in Phase 0; if `pillow-heif` cannot extract auxiliary images, an alternative HEIF parser must be evaluated before v1 ships |

---

## 12. Out of Scope for v1 (Explicit Deferrals)

The following are reasonable future features but are explicitly deferred to avoid scope bloat:

- Batch processing of multiple files
- Direct camera RAW import and development. Reconsider after v1 using LibRaw/`rawpy` as an open-source implementation candidate, subject to a dedicated scope and image-quality investigation.
- Preset saving / loading for adjustment stacks
- Soft proofing for specific display profiles
- Any local/masked adjustment
- Chroma-aware mask exclusion for Gradient and Brush masks. Explore a selector that derives representative hue buckets from the spatially masked region, preserves multiple commonly represented colors, and progressively excludes uncommon hues. Defer until the interaction model, neutral-color behavior, preview cost, and multi-color sampling behavior can be designed and validated together.
- Integration with darktable, Lightroom, or any external editor via plugin or watch folder
- Mobile / web-hosted version
- Windows on ARM
- OpenColorIO integration (full ACES config LUT support, RRT+ODT chain) â€” colour-science handles v1 transforms; OCIO is the path to full DCC pipeline parity in v2
- Tiled/chunked processing for very large EXR files
- Gain map precision above 10-bit (16-bit float gain maps deferred to v2)
- Additional tone mapping operators beyond ACES RRT and Reinhard

---


## 13. Current Repository Checkpoint (2026-08-11)

The repository is no longer at the original vertical-slice stage. It now provides a usable single-image HDR finishing workflow with real AVIF and JPEG Ultra HDR gain-map export and re-import, true HDR browser preview, Apple HEIC HDR reconstruction, independent SDR fallback control, scopes and diagnostics, and delivery proofing that distinguishes authored intent, encoded fixed-headroom reconstruction, and the installed browser's live rendering. Detailed browser-proofing status and the evidence protocol are maintained in `docs/testing/Delivery_Proofing_Sprint.md`; the August 11 codebase, performance, packaging, and round-trip evidence is maintained in `docs/testing/Codebase_Review_Cleanup_and_Round_Trip_Results_2026-08-11.md`.

### Implemented in the Current Slice
- Single-session local workflow with import, eject, and drag-and-drop into the main viewport
- HDR classification, metadata inspection, and source interpretation override flow
- Real `colour-science` normalization into ACEScg for supported source types
- Apple HEIC auxiliary HDR gain-map detection and reconstruction
- AVIF import for plain SDR, direct PQ/HLG HDR, and ISO 21496-1 gain-map files, with explicit native-decoder capability gates and strict malformed-HDR failure behavior
- JPEG Ultra HDR detection and native reconstruction before the ordinary JPEG path, preserving the independently decoded legacy SDR base
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
- Shared AVIF/JPEG gain-map decoder adaptation and metadata parsing used by import and proofing instead of duplicated format policy

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
- `docs/product/` - product requirements and architecture direction
- `docs/testing/` - manual QA procedures, acceptance criteria, and durable validation logs
- `backend/hdr_finisher/` - FastAPI app, session store, loaders, color pipeline, adjustment math, preview/scopes/export services
- `frontend/` - static HTML/CSS/JS app served by FastAPI
- `tests/` - unit and API tests with synthetic and real fixture coverage
- `tools/` - helper scripts for samples, fixtures, and capability checks
- `samples/` - bundled HDR reference assets for local verification
- `local-test-media/` - ignored private and large inputs for hands-on validation
- `output/` - ignored generated reports, exports, screenshots, packages, and run evidence

### Verification Completed at This Checkpoint
- The full deterministic suite passes with `280 passed`; the focused gain-map/proofing suite and JavaScript syntax checks also pass
- Production AVIF gain-map and JPEG Ultra HDR files pass first- and second-generation export/re-import checks for HDR classification, independent SDR relationship, HDR peak/distribution, highlight ordering, dimensions/orientation, and bounded headroom drift
- Scope acceptance checks are good: the isolated 4,000-nit highlight regression passes, waveform aggregation matches its exact reference, sustained histogram/waveform drag QA produces continuously changing non-empty canvases with no browser errors, and the retained scope remains visible while a newer result is updating
- Preview-quality choices cannot change export values: the preference affects only proxy resolution and scheduling, while export requests contain no preview-quality field and production exporters process the full source image with the authoritative session adjustments
- The enforced EXR/TIFF/HEIC browser matrix passes all nine fast, high-quality, and CPU-fallback scenarios with zero stale results applied; first visible scope feedback is 61–72 ms p95 and all scenarios finish `Settled`
- The latest Windows portable package was rebuilt from this checkpoint, passed packaged `/health`, reported both AVIF gain-map and JPEG Ultra HDR decoders as available from frozen resources, and re-imported a production AVIF gain-map export as `HDR_TRUE`. The ZIP is 84,247,676 bytes (80.34 MiB), with SHA-256 `ab7264fc43bcb5d43db4c57573b654db37f36e5cbcd69739d192e279ce121dd7`.
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
- **Resolved August 17, 2026 — Lightroom Classic AVIF gain-map import.** CICP transfer-characteristic code 1 is now decoded as the distinct BT.709 inverse OETF rather than rejected or aliased to sRGB. The real 42 MP Lightroom Classic AVIF preserves its SDR base, imports as `HDR_TRUE`, retains its 2.30-stop encoded display headroom, and passes the packaged Windows drag/drop path.
- **Resolved August 17, 2026 — Windows drag-and-drop ingestion.** File drops are accepted across the application surface. When Windows Explorer, Lightroom, or another shell/catalog integration supplies file bytes without an Electron filesystem path, HDR Finisher falls back to streaming the local file to its bundled backend instead of misreporting AVIF/TIF/TIFF as unsupported. Packaged regression coverage exercises path-backed drop, pathless TIFF drop, native Import, save, export, bundled capabilities, and clean shutdown; the real Lightroom AVIF also passes end to end.
- **Resolved August 17, 2026 — cross-platform icon migration.** Remaining private-use Segoe Fluent/MDL2 glyphs in disclosure, local-adjustment, and geometry controls were replaced with bundled Tabler SVG mask assets. The controls no longer depend on Windows-only font glyphs and use the same icon sources on Windows and macOS.
- **TIFF import's unrecognized-color-space fallback is actively misleading, not just imprecise.** When a TIFF's embedded ICC profile name doesn't match HDR Finisher's substring classifier (confirmed with a real Photoshop export named `P3D65 PQ Display Full 12-16-0-1`), the app correctly flags the source as ambiguous and prompts for review — but the default guess it offers alongside that prompt silently assumes sRGB primaries and applies an sRGB gamma decode, which can be badly wrong (wrong primaries, and a double decode on top of already-linear data) and produces a confidently-wrong-looking image rather than an obviously broken one. Worth a future fix; not yet briefed to Codex.
- The Windows JPEG Ultra HDR implementation blocker is cleared: the native encoder is built, bundled, attributed, and validated. Remaining release work is clean-machine redistribution validation; macOS will require its own native build and packaging path.
- JPEG XL gain-map export is still stubbed; `cjxl` is not wired yet
- DNG and JPEG XL input are research candidates for the coming days/weeks, not commitments for the current installer milestone. DNG research must preserve the boundary between importing an already-rendered HDR interchange and becoming a RAW development application.
- The complete `imagecodecs` package remains intentionally bundled for TIFF reliability. Selective codec packaging is a later size optimization, gated by a representative TIFF corpus and clean packaged-build testing.
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
- **AVIF and JPEG Ultra HDR input:** both production HDR export formats now have standards-aware re-import paths. Native decoders reconstruct HDR once, preserve or explicitly recover the independent SDR rendition, normalize color once into ACEScg, retain useful gain-map/headroom metadata, and fail explicitly when advertised HDR cannot be decoded safely.
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

#### Tooltip and description policy

- Explanatory descriptions should generally be removed from persistent panel layout and presented as tooltips attached to the title of the feature, visualization, control, or other named object they explain.
- Title tooltips appear after a two-second hover. The same content must also be available from keyboard focus and associated with its trigger for assistive technology.
- Persistent inline descriptions are exceptions reserved for safety-critical guidance, required workflow state, errors, empty states, or instructions that users must read to complete the current task.
- Tooltip copy is maintained separately in `docs/design/HDR_Finisher_Tooltip_Copy.md` so wording can be reviewed and copied into the implementation without searching application markup or scripts.
- The Reference Nit Histogram is the reference implementation: its logarithmic reference-nit explanation is attached to the visualization title rather than occupying the readings column.

- The UI has been refactored into a three-rail layout: Inspector on the left, preview center, controls/scopes/export on the right
- At 1280 px the shell has no horizontal overflow, the grade rail retains at least 180 px of usable slider track, and all three splitters remain keyboard accessible and persistent
- A repo-local Playwright preview script smoke-tests the local UI in Edge or bundled Chromium and writes artifacts under `codebase/output/playwright/`
- A repo-local alpha QA harness now runs tests, capability checks, sample AVIF export, AVIF metadata inspection, and Playwright preview, with reports under `codebase/output/qa/`
- A Windows alpha build script now targets a zipped PyInstaller folder artifact and smoke-tests the packaged app before archiving
- Import can now happen through the native `Import Image` button or by dropping onto the application surface; Windows drops without an Electron-visible filesystem path use a local streamed-file fallback and retain AVIF/TIF/TIFF support
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

### Crop and Rotate Interaction Contract (2026-08-16)

The Crop and Rotate group owns one shared, destructive geometry stage for both the HDR and SDR renditions. Geometry must settle identically in preview and export; the browser may provide an optimistic interaction preview, but it must never redefine the authoritative image geometry.

#### User-visible rotate and straighten behavior

- **Rotate left 90 degrees** and **Rotate right 90 degrees** commit a quarter turn immediately. A positive stored rotation is clockwise, matching the button label. A quarter turn resets the crop to the full frame because the previous normalized crop belongs to the old orientation.
- **Flip H** and **Flip V** commit shared horizontal and vertical reflections without creating lane-specific geometry.
- **Straighten** is a continuous `-45` through `+45` degree control. While the slider is held, the currently displayed image rotates at its existing viewer scale behind a stationary alignment grid. The temporary transform must use scale `1` and no generated `clip-path`; it must not zoom to cover the old frame.
- The stationary straighten grid retains the displayed image frame and aspect for the duration of the gesture. It uses dense high-contrast alignment lines plus a clearly drawn border around all four edges so the intended frame remains legible while image corners move through it.
- Releasing Straighten hides the grid and requests one authoritative settled preview. That render removes unsupported rotated corners by selecting the largest centered rectangle containing only valid source pixels. In **Fit** view the resulting safe frame is fitted to the viewport; this final refit is expected content geometry, not an interactive zoom gesture.
- If the user opens **Crop** before Straighten has settled, Crop waits for the latest shared geometry state and authoritative preview. The crop editor must never open against the pre-straighten bitmap.
- Crop is authored against the visible settled frame. **Apply** composes the new normalized crop into any crop that was already committed; **Cancel** discards the draft. Applying a crop after straightening must preserve the released angle and the selected crop ratio.

#### Implementation structure and invariants

- Frontend interaction orchestration lives in `codebase/frontend/app.js`:
  - `beginStraightenGesture` captures the committed base angle and displayed frame, shows the grid, and invalidates older preview generations.
  - `updateStraightenInteractive` updates shared geometry and applies only the temporary rotation delta through `--interactive-straighten-angle`; `--interactive-straighten-scale` remains `1` and `clipPath` remains empty.
  - `showStraightenGrid` freezes and draws the canvas grid and its two-pass dark/light edge border. `clearInteractiveStraightenPreview` removes temporary styles only after the authoritative replacement is ready.
  - `finishStraightenGesture` hides the grid, invalidates both HDR and SDR preview lanes, and schedules the settled render instead of rendering on every pointer step.
  - `openCropMode` synchronizes pending global edits and renders the settled geometry before creating a crop draft. `closeCropMode` composes the visible-frame draft into `cropEditBaseCrop` on Apply.
  - `cropAuthoringFrameAspect` mirrors the backend's safe-rectangle calculation so fixed and custom aspect ratios are constrained in the same post-straighten coordinate space.
- The CSS transform in `codebase/frontend/styles.css` is a temporary visual aid only. Do not put crop authority, persisted zoom, or export geometry into the CSS transform.
- Authoritative processing lives in `codebase/backend/hdr_finisher/finishing.py::apply_geometry` and remains ordered as: quarter rotation, horizontal/vertical flips, arbitrary-angle straighten, then normalized crop.
- `_rotate_to_valid_pixels` performs bicubic rotation with expansion, derives the largest centered valid-pixel rectangle through `_largest_rotated_rectangle`, and retains a two-pixel kernel inset on every edge. This no-invented-corners rule applies to previews and exports.
- `zoomReferenceFrame` stabilizes display size across proxy-resolution swaps. Source geometry may update its aspect, but a preview quality or proxy long-edge change must not masquerade as zoom or alter scroll position.

#### Regression requirements

- `codebase/tests/local-adjustments-interaction.js` must continue to verify the live rotation direction, temporary scale `1`, empty `clipPath`, stationary grid dimensions, non-empty grid rendering, and absence of repeated authoritative renders during the drag.
- The same browser flow must release Straighten, enter Crop immediately, apply a fixed ratio, and prove that the released angle and ratio survive synchronization and that the settled bitmap has the requested aspect without stretching.
- `codebase/tests/test_advanced_finishing.py` must continue to prove that arbitrary-angle straightening returns finite valid pixels without padded corners and that shared geometry produces matching HDR/SDR dimensions.
- Any change to transform order, safe-rectangle math, crop composition, preview generation, or viewport zoom must run both the focused geometry tests and the broader local-adjustments browser interaction test. Visual QA must include at least one portrait and one landscape image at a non-trivial angle.

### Local Adjustments Brush/Eraser Correctness and Performance Record (2026-08-14)

Commit `dcb00c7` (`Fix local mask erasing and performance`) is the reference implementation for destructive Brush-mask editing and the baseline for hardening Gradient, Luma, Path, and future local-adjustment tools. The detailed architecture remains in `docs/technical/local-adjustments.md`; this PRD section records the product-visible failures, the required operation order, the synchronization contract, the performance findings, and the tests that must not regress.

#### Required Brush-mask order of operations

Eraser strokes form a destructive attenuation layer that is evaluated above the completed positive Brush mask, but the attenuation itself must respect chronological paint/erase order. This distinction lets erase remove coverage generated later by shared controls while still allowing a subsequent Brush stroke to repaint an erased pixel. The authoritative CPU mask and browser fallback overlay must use the same sequence:

1. Traverse serialized strokes in chronological order. Accumulate every positive stroke into the positive paint mask. Brush Flow builds coverage and per-stroke Density/opacity limits the stroke contribution.
2. Maintain a separate attenuation mask initialized to one when the first erase appears. An erase multiplies attenuation by its remaining coverage; a later positive stroke restores attenuation locally by that stroke's Flow/Density strength.
3. Apply whole-mask **Shift Edge** to the positive mask.
4. Apply whole-mask **Feather**.
5. Apply expression **Invert**, when enabled.
6. Apply whole-mask **Mask Opacity**.
7. Multiply the chronological attenuation mask into the result as the final mask operation.
8. Clamp the finished mask, apply the local HDR or SDR grade through it, then apply the local adjustment's overall opacity.
9. Apply **Bypass** as the final gate over the entire local adjustment. Bypass disables the complete local grade, not merely a control group or mask stage. The mask overlay may remain visible for inspection while the grade is bypassed.

In compact form, for positive mask `P`, shared mask processing `S`, mask opacity `O`, chronological attenuation `A`, erase strength `E_i`, and later paint strength `B_i`:

`A_0 = 1`; erase updates `A_i = A_(i-1) × (1 - E_i)`; later paint restores `A_i = max(A_(i-1), min(Density_i, A_(i-1) + B_i))`; and `M_final = clamp(S(P) × O × A_final, 0, 1)`.

`S(P)` includes Shift Edge, Feather, and any requested inversion. Final-stage attenuation is what allows the eraser to remove coverage generated outside the original paint footprint by positive Shift Edge, Feather, or Invert. Chronological restoration is intentionally limited to later positive strokes; merely settling, rerendering, zooming, or replacing a proxy must never restore erased coverage.

The backend reference is `codebase/backend/hdr_finisher/local_adjustments.py::evaluate_mask` and `_brush_masks`. The browser fallback reference is `codebase/frontend/app.js::postProcessBrushMaskPreviewWithErase`. Future mask tools with destructive or exclusion stages must state their corresponding operation order explicitly and test points whose coverage was generated by a shared mask control, not only points inside the original geometry.

#### Issues fixed and durable behavior

| Observed failure | Root cause | Required behavior and implemented fix | Regression coverage |
|---|---|---|---|
| Erase worked while dragging but reverted on pointer release. | An older queued edit response could replace the optimistic local-adjustment object graph while a newer gesture was still mutating it. A pre-erase authoritative mask could then be requested or displayed. | Preserve the optimistic local object graph while a pointer gesture or local-mask commit is active. Gate authoritative requests by the exact mask signature and edit revision. The released overlay must never show a pre-erase pixel, even for a single animation frame. | `codebase/tests/brush-mask-interaction.js` records overlay alpha for one second after release and rejects stale pre-erase mask requests. |
| Rapid consecutive erase strokes sometimes disappeared or exposed an older mask state. | Overlapping `update_local` responses and adjusted-preview refreshes could complete out of order from the user's gestures. | Track local-mask commit depth, serialize edit commands, retain newer optimistic strokes, and defer the adjusted HDR/SDR preview refresh until the final queued commit settles. Frontend and server stroke lists must converge without dropped erase strokes. | The browser test forces three overlapping erase commits, verifies all three persisted, checks frontend/server equality, and rejects intermediate adjusted-preview requests. |
| Erasing was limited to the bounds of the original painted area. | Erase was composed into raw paint before Shift Edge, Feather, Invert, and Mask Opacity. Shared controls could generate finished-mask coverage that the eraser could not reach. | Build positive paint separately, process the shared mask controls, then multiply the combined eraser attenuation on top. The frontend fallback mirrors the authoritative backend order. | `test_brush_eraser_is_applied_after_every_mask_control` covers Shift Edge, Feather, Mask Opacity, Invert, and combinations at a point outside the raw paint dab. |
| Painting could not restore a previously erased hole or edge. | All erase strokes were gathered into a permanent final multiplier after every positive stroke, so even paint serialized later remained suppressed. | Keep erase as final-stage attenuation, but update that attenuation while traversing strokes: later paint restores earlier attenuation according to its Flow/Density. Mirror this exact ordering in the browser fallback cache. | `test_later_brush_stroke_can_repaint_an_erased_area` requires paint → erase → repaint at the same center pixel, and the browser suite verifies optimistic/settled convergence. |
| A circular live Brush dab settled as a squashed ellipse on non-square images. | The browser radius is defined in square display pixels while the CPU evaluator measured normalized X/Y directly, whose pixel scales differ with aspect ratio. | Map the source grid and stored stroke points through `_brush_display_metric()` before distance and ROI evaluation so authoritative radius uses the same visual pixel metric as the live Canvas brush. | `test_brush_radius_remains_circular_on_a_landscape_image` asserts a circular authoritative footprint and expected diameter. |
| Creating, selecting, or deleting a local adjustment appeared to change zoom. | Interactive and settled frames used different proxy long edges, and each replacement bitmap was allowed to redefine CSS geometry. | Retain a per-session/per-geometry `zoomReferenceFrame`; proxy resolution swaps may change pixels but not displayed dimensions or scroll position. Preserve the current aspect for crop and quarter-turn changes. | Browser local-adjustment coverage checks stable preview geometry through mask-tool lifecycle operations and custom zoom. |
| Gradient overlay flashed transparent between drawing and settlement. | New coordinates invalidated the cached signature before draft state was marked, and the previous exact raster was discarded before the committed replacement existed. | Mark the Gradient draft dirty before its first synchronous render and retain the last exact Gradient/Luma raster through the draft/commit handoff, replacing it atomically when the matching raster arrives. | `gradient-mask-interaction.js` samples alpha every animation frame through settlement and rejects any transparent handoff frame. |
| The red overlay and applied adjustment could disagree. | Browser fallback composition, tinting, and authoritative mask replacement did not consistently represent the same final alpha mask. | Prefer the exact authoritative compiled mask whenever its signature matches. Keep the last exact mask while a control draft is pending; process fallback masks in backend order; tint only after mask geometry and alpha processing. | Browser Shift Edge/Feather matrices compare interactive and settled authoritative masks, including alpha distribution and bounds. |
| Bypass did not consistently behave as the top-level local-adjustment switch, and mask inspection could fail while bypassed. | Rendering correctly filtered disabled locals, but the overlay compiler used the same filtered path and could have no mask entry to return. | Persist `enabled=false` as a gate over the whole local adjustment. For overlay inspection only, compile a temporary enabled/opacity-one view without changing persisted state. | `test_local_bypass_gates_the_entire_adjustment_after_mask_and_grade` and the browser bypass/re-enable assertions cover applied pixels, server state, button state, and overlay availability. |
| Zooming and erasing became extremely slow as the mask accumulated strokes. | Every overlay render rebuilt every historical stroke at the zoomed CSS display resolution. At 300% this could allocate and redraw a 3840x2160 canvas even though the authoritative mask was approximately 962x541. Release fallback also post-processed the same mask repeatedly and drew positive strokes twice when erasers existed. | Keep overlay bitmaps at bounded proxy resolution (512-1600 long edge) while CSS handles display scaling; skip historical stroke rasterization when an authoritative mask exists; render only new gesture points incrementally; cache processed and tinted masks; build positive paint once; and run release fallback post-processing once per mask signature. | `codebase/tests/performance/local-mask-performance.js`, exposed as `npm run test:local-mask-performance`, profiles zoom, erase, function timings, long tasks, payload size, and commit response time. |

#### Measured performance checkpoint

The repeatable Edge/Playwright stress case uses the 1280x720 generated test pattern, 24 painted strokes with 16 points each, Shift Edge and Feather enabled, zoom changes through 100/200/300/150/300 percent, and a 40-step erase gesture.

- Zoom median wall time improved from approximately `167.6 ms` to `10.7 ms`.
- Zoom worst case improved from approximately `354.4 ms` to `11 ms`.
- Static Brush-overlay rendering improved from approximately `165 ms p95` to `1.5 ms p95`.
- Release fallback post-processing fell from six runs to one run, approximately `25.7 ms` in the recorded run.
- The 25-stroke local-adjustment JSON payload was `25,960` bytes and the edit-command response was approximately `58 ms`.

These figures are development-machine baselines, not cross-machine release guarantees. The durable requirement is that zoom must not rerasterize historical strokes or resize the overlay bitmap to the zoomed CSS dimensions, and pointer movement must update only the incremental gesture work. Future local-mask performance changes should run the same benchmark before and after modification and retain the raw JSON result in the task notes when a regression is investigated.

#### Undo/history finding

Undo was investigated as a possible latency source and was not the primary cause of the observed zoom or eraser delay. The session history stores forward and inverse edit commands rather than image snapshots and is already capped at **100 entries or 64 MiB, whichever is reached first**. An `update_local` entry contains the full serialized local adjustment, so extremely complex stroke lists consume the byte budget sooner and may eventually make command validation, rollback copies, or serialization measurable. Do not lower the current cap merely to address interactive mask rendering; profile command time and payload size independently first.

#### Tests added or materially extended on 2026-08-14

- `codebase/tests/test_local_adjustments.py`
  - `test_brush_eraser_cannot_strengthen_a_post_processed_mask`
  - `test_brush_eraser_is_applied_after_every_mask_control`
  - `test_local_bypass_gates_the_entire_adjustment_after_mask_and_grade`
- `codebase/tests/brush-mask-interaction.js`
  - exact Shift Edge/Feather live-versus-settled overlay matrices
  - erase outside the raw paint bounds
  - no pointer-release flash to pre-erase alpha
  - no stale authoritative-mask request
  - rapid overlapping erase commits with no dropped strokes or intermediate adjusted preview
  - whole-adjustment bypass persistence and re-enable behavior
  - incremental erase responsiveness guard
- `codebase/tests/performance/local-mask-performance.js`
  - repeatable zoom/erase stress fixture and timing summaries
  - instrumentation for overlay rendering, stroke rasterization, final erase processing, browser long tasks, edit payload size, and commit response latency
- `codebase/tests/local-adjustments-interaction.js`
  - retained as the broader local-adjustment UI smoke test and run alongside the focused Brush regression.

Validation at commit `dcb00c7` completed with `84 passed` for `tests/test_local_adjustments.py`, three consecutive passes of the focused Brush browser regression, a passing broader local-adjustments browser run, a passing local-mask performance benchmark, JavaScript syntax checks, and `git diff --check`.

#### Post-validation regression additions on 2026-08-15

- `test_brush_radius_remains_circular_on_a_landscape_image` locks the authoritative Brush footprint to the live square-pixel metric.
- `test_later_brush_stroke_can_repaint_an_erased_area` locks chronological paint → erase → repaint behavior.
- `gradient-mask-interaction.js` now samples every animation frame through a full redraw/commit handoff and rejects a transparent overlay frame; the recorded run held alpha continuously for 24 frames.
- The focused Gradient and Brush browser suites pass after these corrections, as do all 32 frontend contract tests.
- The full deterministic Python suite passes with **437 tests and two existing dependency deprecation warnings**.

#### Requirements for the remaining local-mask tools

Work on Gradient, Luma, Path, or a future mask type must preserve these cross-tool invariants:

- The red overlay and applied local grade consume the same normalized mask for the same edit revision.
- Interactive, pointer-release, and settled authoritative states do not flash backward to an older mask.
- Exact-mask replacements are visually atomic: retain the latest valid exact raster when a tool has no current client-side raster, and never expose a transparent handoff frame.
- Proxy long-edge changes never alter viewport zoom geometry or scroll state; only source geometry changes may replace the stable reference aspect.
- Brush distance and ROI calculations use the same square-pixel metric in optimistic and authoritative renderers on landscape and portrait sources.
- A response from an older commit cannot detach or replace the object receiving a newer gesture.
- Tool-specific mask construction occurs before shared whole-mask controls; destructive/exclusion stages have a documented, tested order.
- Destructive attenuation remains a final-stage mask operation, but later positive strokes restore earlier attenuation in chronological order.
- Bypass gates the entire local adjustment after its mask and grade while leaving intentional mask inspection available.
- Tests include generated-coverage points outside the original tool geometry, rapid overlapping edits, serialization/server convergence, undo/redo round trips, and representative control/geometry combinations.
- Zoom and pointer interaction are profiled with a non-trivial edit history; historical geometry must not be rebuilt merely because display zoom changed.

### Recommended Next Steps After This Checkpoint

#### V1 Launch Distribution and Signing Plan

Signing is not a V1 launch blocker. The first public builds may ship unsigned from the project's official GitHub Releases page while the project remains free and open source.

1. Produce Windows and macOS release artifacts through a documented GitHub Actions workflow where practical. Publish the matching source revision and SHA-256 checksums for every downloadable artifact.
2. Label unsigned packages clearly as V1 preview builds. Document the exact Windows SmartScreen and macOS Gatekeeper warnings users should expect without instructing users to disable operating-system security protections globally.
3. Keep release filenames, application identity, repository location, and download links consistent. Publish known limitations and a concise verification procedure beside each release.
4. After the first qualifying public release, apply to the SignPath Foundation for free Windows Authenticode signing. Preserve the fully open-source license, public source/build provenance, and automated trusted-build workflow needed for eligibility.
5. If SignPath is unavailable or declines the project, continue unsigned Windows GitHub releases until adoption justifies the cost of a conventional public code-signing certificate. Do not make Microsoft Store distribution a prerequisite; it remains an optional later channel.
6. Treat unsigned macOS builds as technical previews because Gatekeeper imposes a stronger default block than Windows SmartScreen. When the Mac build is ready for ordinary users, enroll in the Apple Developer Program, obtain a Developer ID Application identity, sign the app and every bundled Electron/Python executable, enable hardened runtime, submit the package for notarization, and staple the returned ticket. One program membership may cover this and the owner's other Apple applications.
7. Before calling either platform launch-ready, test the exact downloaded GitHub artifact on a clean machine. Verify checksum publication, installer/app identity, expected security prompts, import/export access, bundled backend startup and shutdown, update/reinstall behavior, and complete removal.

**Next working session — August 14, 2026:** fix and harden the remaining local-adjustment mask tools: **Gradient, Luma, and Path**. For each tool, verify that the red overlay and applied grade consume the same mask, interactive and settled previews agree, editing remains responsive, serialization and undo survive round trips, and representative control and geometry configurations pass automated browser tests plus screenshot review. Preserve the intentional separation between tool-specific controls and whole-mask controls established for Brush.

1. Run the Windows SDR-white response sequence using the generated test target at low, middle, high, and useful whole-stop-adjacent settings. Confirm artifact/tile hashes remain fixed and save structured highlight, midtone, color, overall, reload, and restart observations.
2. Compare exact JPEG Ultra HDR and AVIF proxies against the nearest matrix tile in headed Windows Chrome. Accept a stable 5–10% bias when highlight placement, clipping, gradients, and color remain close; investigate obvious clipping/color differences or discrepancies clearly above roughly 10%.
3. Record Chrome behavior when moving between HDR and SDR displays and when Windows HDR is toggled, including immediate repaint, reload, and full restart outcomes.
4. Test JPEG and AVIF separately in Firefox, Mac Chrome, and Safari. Treat Safari headroom conclusions on the available 500-nit MacBook as exploratory.
5. Run the hosting survival sequence: Cloudflare Pages direct bytes, Cloudflare transformations, WordPress originals/generated sizes, and one additional optimizer/CDN. Keep JPEG as provisional default unless the evidence threshold in `docs/testing/Delivery_Proofing_Sprint.md` is met.
6. Retain the server-backed in-app export-folder browser and direct path entry as resilient development fallbacks. During installer validation, explicitly test the installed app's native **Choose image** and **Choose export folder** dialogs from the launched application process: each dialog must appear in the foreground on the active desktop, support paths containing spaces and non-ASCII characters, return the selected source or writable destination correctly, handle cancellation without an error, permit reopening after cancellation or failure, and never leave its Browse button disabled or its UI stuck on an opening status. Verify these behaviors on the clean-machine installer test, after an application restart, and when another application owns focus. Do not mark the installer picker work complete based only on source-run or automated browser coverage.
7. Complete installer-readiness changes: automatic browser launch, single-instance and port-conflict handling, clean shutdown, user-writable runtime directories, path portability, quiet console behavior, and application icon/version metadata.
8. Continue documented darktable RAW and Blender 5.2 LTS source-export validation after the completed Affinity workflow.
9. Keep JPEG XL and DNG deferred until representative interoperability corpora and packaging evidence justify a deliberate product decision.
10. Build and clean-machine validate a conventional per-user Windows installer, then publish the unsigned V1 preview on the official GitHub Releases page with checksums, expected SmartScreen behavior, supported workflows, evidence-backed browser claims, and known limitations. Apply to SignPath after the public release qualifies.
11. Start native macOS encoder and `.app`/`.dmg` packaging after the Windows installer stabilizes. An unsigned technical preview may ship with explicit Gatekeeper guidance; complete Developer ID signing and Apple notarization before presenting the Mac build to ordinary users. Keep JPEG XL deferred unless later evidence makes it strategically important and practical to ship.
12. Fix the remaining TIFF unrecognized-color-space fallback recorded above. The Lightroom Classic AVIF CICP import gap is resolved and validated with the real source file in the packaged Windows application.
13. Continue source-export workflow validation (see [Source Preparation Workflows](../workflows/source-preparation.md) and the [Source Export Validation Log](../testing/Source_Export_Validation_Log.md)) with the following still-untested candidates:
    - **Photoshop OpenEXR export** — the Photoshop 32-bit HDR recipe validated on 2026-08-17 used TIFF only; Photoshop 27.5+ has native OpenEXR write support that remains untested, including whether it writes usable EXR `chromaticities` (Affinity's EXR export notably did not).
    - **GIMP workflow** — not yet attempted. GIMP's HDR/32-bit float and EXR support has changed across major versions; needs a real recipe and round trip before any doc claims.
    - **DNG from Adobe (Lightroom Classic / Camera Raw) and DxO PhotoLab** — see the DNG candidate note under Section 4 and the DNG recommendation in `docs/testing/Codebase_Review_Cleanup_and_Round_Trip_Results_2026-08-11.md`. Pull a real linear DNG from each app and verify with `exiftool`/`dcraw -i -v` whether a display tone curve is baked in despite the "linear" label, and whether `ColorMatrix1/2`, `CalibrationIlluminant`, `AsShotNeutral`, black/white levels, and `BaselineExposure` are populated well enough for a deterministic ACEScg mapping without camera-profile selection or general RAW development, before any DNG import proposal is written.

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
*August 6, 2026 implementation addendum: the Affinity build 4646 Sony RAW workflow is validated through linear Display P3 OpenEXR import and quality-85 AVIF gain-map delivery on paired HDR/SDR monitors. Affinity's bounded integer TIFF limitation and missing EXR chromaticities are documented; manual `Display P3 Linear` interpretation is required. Float-preserving Lanczos preview downsampling fixes severe high-frequency aliasing and has automated plus real-image validation. Delivery proofing is now implemented for JPEG Ultra HDR and AVIF through separate Authoring, fixed-headroom Matrix, and Live Browser views with Windows headroom telemetry, content-hashed proxies, structured evidence, generated test media, and hosting-survival tooling. Automated coverage passes at 198 tests plus installed-Chrome/Edge smoke and 1280 px layout QA. Physical Windows Chrome parity, monitor/HDR state changes, cross-browser behavior, and real hosting pipelines remain the next evidence phase; the Windows export folder picker also requires repair.*
*August 11, 2026 implementation addendum: the full `imagecodecs` package remains in the installer for TIFF reliability. Standards-aware AVIF and JPEG Ultra HDR import is implemented with strict decoder capability gates, independent HDR/SDR recovery, and two-generation production round-trip coverage. The deterministic suite passes at 280 tests, the enforced EXR/TIFF/HEIC browser matrix passes all nine scenarios with zero stale results, and follow-up checks confirm retained non-blank scopes during updates, exact waveform aggregation, isolated 4,000-nit highlight preservation, and preview/export independence. JPEG XL and DNG remain evidence-gated research items rather than v1 commitments.*
*August 14, 2026 implementation addendum: Brush erasing is now an explicit top-of-mask attenuation stage after Shift Edge, Feather, Invert, and Mask Opacity; Bypass is the final gate over the complete local adjustment. Optimistic edit synchronization prevents pointer-release reversion, stale authoritative masks, intermediate adjusted previews, and dropped rapid erase strokes. Proxy-resolution incremental rasterization and processed/tinted mask caches reduce the recorded zoom worst case from about 354 ms to 11 ms. Focused Python, browser interaction, overlap/race, bypass, and repeatable local-mask performance coverage are recorded in the Local Adjustments Brush/Eraser section above and serve as the contract for Gradient, Luma, Path, and future mask work.*
*August 16, 2026 implementation addendum: Crop and Rotate behavior is now explicitly contracted. Straighten rotates the current image at scale 1 behind a stationary bordered grid, then hands off to the authoritative valid-pixel crop on release. Crop waits for that settled geometry and composes visible-frame drafts into the committed crop. Frontend state ownership, backend transform order, zoom separation, and required Python/browser regression coverage are recorded in the Crop and Rotate Interaction Contract above.*
*August 17, 2026 implementation addendum: Source-export workflow guidance was extended to Adobe Lightroom Classic, Adobe Photoshop, and DxO PhotoLab in `docs/workflows/source-preparation.md`, backed by real hands-on round trips recorded in `docs/testing/Source_Export_Validation_Log.md`. Lightroom Classic's AVIF HDR-Output export is the validated primary recipe, blocked only by the CICP transfer-code import gap recorded above; its 32-bit TIFF export is a validated secondary recipe, but only with **Maximize Compatibility left unchecked** — checked, Lightroom silently clamps real HDR data to a bounded `[0,1]` range, the opposite of what that same checkbox requires for AVIF gain-map inclusion. Photoshop's validated recipe is materially different from the original guess: Camera Raw's HDR toggle hands off a 16-bit PQ-encoded (not scene-linear) document, which must be promoted with `Image > Mode > 32 Bits/Channel` to decode PQ into real linear light before `File > Save As` (never `Export As`, which forces an 8-bit sRGB flatten) — validated end to end including direct ICC colorant-tag verification that the resulting primaries are genuine Display P3. DxO PhotoLab, as of PhotoLab 9, has no export path that produces HDR Finisher-importable HDR data (TIFF tops out at 16-bit, DNG carries no tonal/color rendering, and DxO cannot import EXR); its linear DNG is flagged as a plausible future DNG-import candidate rather than a current recipe. Two real HDR Finisher import gaps were found and are recorded under Current Blockers and Known Gaps: an AVIF CICP transfer-code gap (briefed to Codex, fix pending) and a misleading default-assumption fallback for unrecognized TIFF color profiles (not yet briefed). Future testing plans are recorded as item 13 under Recommended Next Steps: Photoshop OpenEXR export, a GIMP workflow, and DNG round-trip research using real Adobe and DxO PhotoLab linear DNG exports.*
*Later August 17, 2026 implementation addendum: the Lightroom Classic AVIF CICP transfer gap is resolved with a standards-distinct BT.709 decode and real-file packaged validation. Windows drag-and-drop now covers the full app surface and falls back to local byte streaming for shell/catalog drops that do not expose a filesystem path; packaged TIFF, the real Lightroom AVIF, and native Import all pass. The last Windows-only Segoe/MDL2 control glyphs were replaced with bundled Tabler SVG assets, clearing the known cross-platform icon blocker. A request-header shutdown race discovered during packaged validation was also removed by binding the active backend credentials for the interceptor lifetime.*
*August 19, 2026 implementation addendum: the minor-bug validation pass recorded in `docs/product/Next_Sprint_Minor_Bug_Backlog.md` is complete for MINOR-02 through MINOR-07 and user-verified on the npm/Electron Windows HDR build. The pass adds deterministic JPEG Ultra HDR endpoint dithering, reliable path-preserving EXR drag-and-drop with a pathless fallback, single native overwrite approval with cross-runtime-safe target validation, revision- and lane-safe HDR/SDR preview/scopes, stronger narrow-range Gain behavior in matching CPU/WebGPU paths, and same-gesture curve-point creation and dragging. Follow-up testing also fixed Affinity EXR portrait aspect retention, a WebGPU shader mutability error that disabled the HDR surface, native clipboard path copying, and an SDR-canvas/HDR-scope race after manual Display P3 Linear interpretation. MINOR-08—JPEG Ultra HDR appearing brighter than a matched AVIF—was investigated from the encoded files and independently reconstructed HDR pixels, then checked by the user in the same browser. The matched files were functionally equivalent; an unedited-EXR follow-up showed only a slight AVIF dark-region lift with otherwise close rendering. The report is shelved as non-reproducible/likely save or viewing-state variance, with no speculative encoder change and no new regression tests.*
