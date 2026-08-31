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
- General-purpose RAW development or camera-profile authoring beyond the app's constrained, deterministic RAW/DNG ingest workflow
- General layer compositing, pixel painting, or object-aware selection; local adjustments remain non-destructive mask-and-grade operations
- General retouching or restoration; denoise and Detail are finishing-stage tools with bounded photographic controls
- Arbitrary layer compositing
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

**Candidate sources to evaluate first:** DxO PhotoLab's "linear DNG" export (demosaiced/denoised/lens-corrected, no baked tone curve) and Adobe's linear DNG output (Lightroom Classic/Camera Raw "Convert to DNG" and Merge-to-HDR DNG) both name-match this candidate and are worth pulling real files from before writing a proposal. Verify per app with `exiftool`/`dcraw -i -v`: whether a display tone curve is silently baked in despite the "linear" label, and whether `ColorMatrix1/2`, `CalibrationIlluminant`, `AsShotNeutral`, black/white levels, and `BaselineExposure` are populated well enough for a deterministic ACEScg mapping without camera-profile selection.

### Input Round-Trip Principle

Formats produced by HDR Finisher are priority import candidates. AVIF gain-map and JPEG Ultra HDR round trips compare the exact exported artifact with its re-imported HDR rendition and independent SDR fallback, including gain-map presence, color primaries, transfer function, reference white, encoded headroom, clipping, highlight ordering, dimensions, orientation, and representative pixel/perceptual parity. Valid HDR exports must never be silently reduced to their SDR base, double-decode PQ/HLG, apply a gain map twice, or double-tone-map the SDR branch. Two-generation lossy round trips are accepted within explicit SDR, HDR-distribution, and headroom tolerances rather than requiring byte or pixel identity.

---

## 5. Output Formats

| Format | Priority | Notes |
|---|---|---|
| AVIF + ISO 21496-1 Gain Map | **Primary** | Best quality-to-file-size ratio for web at 4K; ~95% browser support as of mid-2025 |
| JPEG Ultra HDR (JPG + Gain Map) | **Secondary** | Legacy JPEG-safe SDR fallback plus HDR gain map; HDR rendering support varies by browser, OS, and platform recompression |
| SDR JPEG / PNG | **Utility** | Tone-mapped fallback for legacy contexts. JPEG is fixed at 8-bit; PNG defaults to 8-bit with a 16-bit advanced interchange option. |
| JPEG XL HDR | **Experimental** | Direct Rec.2020/PQ HDR with high-bit-depth and floating-point capability. Browser delivery still requires an explicit fallback strategy. |

### Export Settings Direction

- Keep the normal export surface format-aware and web-correct by default. Put niche codec controls behind an **Advanced** disclosure instead of presenting one global set of settings.
- Keep export color handling automatic: SDR outputs use sRGB, while HDR delivery uses Rec.2020/PQ. Show the resolved color encoding in the export summary rather than offering an arbitrary color-space selector.
- AVIF + gain map defaults to a **10-bit 4:2:0 primary with a half-resolution 10-bit 4:4:4 gain map**. It exposes 8-/10-/12-bit primary precision and 4:2:0/4:2:2/4:4:4 primary chroma. Gain-map chroma is fixed at 4:4:4 and is not presented as a user choice: the August 21 pattern and DxO corpus found content-dependent colored-edge and saturated-highlight penalties from subsampling with negligible typical size benefit. Web Default and Web Optimized use half resolution, which supplied the material size reduction; Maximum Fidelity uses full resolution.
- JPEG Ultra HDR and SDR JPEG default to **4:2:0** and expose **4:2:2** and **4:4:4** primary JPEG chroma for specialist cases.
- JPEG Ultra HDR automatically applies a conservative SDR-guided denoise pass to the logarithmic gain map before its final JPEG compression. The authored SDR primary remains pixel-identical, real transitions are guided by that primary, and the operation has no user control because it removes multiplicative delivery noise rather than changing either creative endpoint.
- **Roadmap — AVIF gain-map denoising:** evaluate the same principle separately on a representative photographic and synthetic corpus, including Safari/Chromium physical-HDR review, edge/highlight error, 10-bit precision, half/full-resolution maps, encode time, and file size. Do not enable AVIF filtering until that evidence shows a net benefit; libavif's range trimming is not evidence that spatial denoising is safe.
- SDR PNG defaults to **8-bit** and exposes **16-bit** for high-precision interchange. Its lossless encoder does not present a quality control.
- JPEG XL HDR defaults to **12-bit integer PQ** and exposes **10-bit integer**, **16-bit integer**, **16-bit float**, and **32-bit float** alternatives. The backend preserves the selected representation through encode/decode validation instead of quantizing every selection through a 12-bit buffer. **8-bit** is reserved for a future SDR JPEG XL mode and is not offered for HDR delivery.
- Dithering is exposed as **Auto / Off / Subtle** only where final 8-bit quantization makes it useful. For higher-bit-depth and floating-point outputs, the control is disabled and visibly greyed out with a short explanation.
- Source metadata export options are **None**, **Copyright only** (Web Default where the encoder supports source metadata), **All except location**, and **All including location**. Required color and HDR/gain-map metadata is technical format metadata and must never be removed by the source-metadata choice.
- Retain the current Original / Long edge / Fit resolution controls and prevent-enlargement behavior.
- The Export panel provides immutable, format-aware **Web Default**, **Web Optimized**, and **Maximum Fidelity** presets. Format changes apply the same preset tier to every applicable control; a manual encoding, metadata, dithering, sharpening, or resolution change switches the menu to explicit **Custom**. Each submenu marks its current format's Web Default choice with `· Web Default`.
- **V2 — User-saved export presets:** allow users to save, name, update, and delete Custom configurations while retaining the three immutable built-ins. Saved presets should use a versioned schema and ignore or migrate settings that no longer apply after a backend change.

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

### Detail

- HDR and SDR each provide a dedicated **Detail** module containing Texture, Clarity, Clarity Radius, Sharpen, Sharpen Radius, and Sharpen Threshold. Radius and Threshold are subordinate Sharpen targeting controls in the interface.
- Detail is corrective, scale-selective processing and is distinct from Film Look Microcontrast. Global Detail runs after the lane's color grade and before ordered local adjustments; local Detail runs last inside each local grade before mask blending. Film Look retains its later fixed-scale character operation, and export sharpening remains an output-resize operation.
- Texture and Clarity operate on perceptual luminance bands and restore RGB by luminance gain. Sharpen uses continuous edge qualification, radius-aware sampling, and bounded local excursions so low Amount values increase edge contrast gradually instead of acting as an on/off blur.
- Neutral Detail is a zero-cost pass-through. Interactive preview uses the WebGPU adjustment pipeline when available, with matching CPU processing for settled/export output and automatic GPU recovery after transient device loss. Proxy footprints scale with source resolution so 1K, 2K, 4K, and full-resolution results address the same source detail.

### Match Entire HDR Grade

- A centered **Match entire HDR grade** action appears at the top of the SDR lane, below the HDR/SDR selector and above Base Rendition. It captures the current HDR recipe and produces an SDR base that preserves the rendered HDR appearance below the selected highlight boundary while compressing remaining HDR-only headroom.
- The captured recipe covers global grade modules, ordered local masks and grades, Detail, Film Look, vignette, grain, source identity, and reference-white context. SDR controls remain independent trims over the captured base. Later HDR edits leave the snapshot stable and expose **Rematch**; **Revert** restores the complete SDR state that existed before the first match.
- Match-specific grain state is either captured HDR grain or an SDR override. The first actual edit to any SDR grain field copies the captured recipe into the SDR fields and changes source atomically; the two grain recipes never stack. Rematch preserves an existing SDR override, while Revert and source replacement clear match state.
- The automatic highlight boundary is derived once per Match/Rematch from the settled, no-grain HDR result. A manual boundary can be adjusted without recapturing the HDR recipe, and the UI keeps its value label attached to the active handle.
- HDR Peak Fit or Soft Ceiling remains an early creative operation inside the captured HDR grade; SDR Match neither replaces nor bypasses it. The match knee runs later against the fully rendered, already-compressed HDR result, so the two shoulders intentionally stack: Peak Fit shapes the HDR highlight relationships first, and Match compresses only the remaining HDR headroom into SDR.
- Match, Rematch, Revert, and the inherited-grain-to-SDR-override transition are atomic history operations. Redo reapplies the stored materialized result instead of rerendering or deriving a new knee.

### Editing and project transactions

- Slider drags are history-coalesced by gesture: pointer-down captures the starting value and pointer-up commits the settled result as one undo step. Keyboard Undo/Redo updates both the rendered preview and every affected control from authoritative document state.
- Project open uses the same blocking progress treatment as source import. Schema v4 is the only accepted project document for this release; schema v1-v3 projects are rejected explicitly with instructions to recreate the project rather than entering source relink or attempting an implicit migration.

### Curves
- **Independent HDR and SDR RGB Curves** â€” each lane stores separate R, G, B, and Luma curves; editing the active preview lane must never alter the other lane
- Curves support adding and removing control points, retain locked endpoints, and preserve over-range HDR values outside the editor domain

The HDR and SDR lanes are independent grading branches after source interpretation. HDR-lane exposure, rolloff, shadows, lift/gamma/gain, contrast, white balance/tint, and curves must not alter the SDR fallback; SDR-lane controls must not alter the HDR alternate. Color-space interpretation and conversion into the ACEScg working space happen before this branch and remain shared.

### Tone Mapping Operators (v1)
The SDR base rendition is generated using the following operators:

- **ACES RRT** â€” default tone mapping operator; used for the exported gain map base image
- **Reinhard** â€” available as a lightweight fallback option, primarily useful for performance-constrained preview rendering

Additional operators are deferred to v2.

### Exploration Area: Perceptual HDR-to-SDR Color Equality

The HDR and SDR branches should be treated as two independently authored, excellent renditions of the same image. Their shared creative identity should survive the branch boundary: important hues, color relationships, subject separation, and the intended impression of saturation should remain perceptually comparable. HDR's primary advantage is additional dynamic range and physical brightness in emissive and specular highlights; the product must not rely on globally stronger saturation to make the HDR rendition feel superior.

The current simple SDR gamut compressor preserves the tone-mapped luma anchor and moves out-of-sRGB colors toward neutral until every channel fits the SDR cube. That produces legal output, but it can turn extremely bright ACEScg colors into pale or pastel patches. The installed delivery test pattern demonstrates the behavior particularly strongly, and scene-linear EXR renders from Blender can contain similarly hot emissive materials, colored lights, fire, neon, and saturated reflections. Pastel conversion must not be accepted merely because the result is bounded and hue direction is approximately retained.

Explore a more perceptual HDR-to-SDR rendering policy with the following product goals:

- Preserve the recognizable color identity of hot rendered colors. The SDR rendition may lower a chromatic highlight's luminance when that better preserves its perceived saturation; retaining the HDR tone-mapped luma at all costs is not a requirement.
- Preserve ordinary photographic color. Skin, foliage, sky, textiles, signage, flowers, practical lights, and neutral surfaces must not acquire exaggerated saturation, unstable hue, or objectionable local contrast in order to improve synthetic stress targets.
- Desaturate highlights only where the chosen appearance model or creative intent justifies a path toward white. High numerical RGB values alone are not proof that a surface should become pastel or neutral in SDR.
- Keep diffuse regions and colors already representable in SDR as stable as practical. The mapping should concentrate its intervention on genuinely out-of-gamut or out-of-range colors and avoid unnecessary changes to the rest of the image.
- Preserve smooth gradients, luminance ordering, temporal/parameter continuity, deterministic output, and CPU/WebGPU/export parity. A new transform must not introduce hue flips, contouring, clipping, or unstable results around the gamut boundary.
- Keep HDR and SDR authoring controls independent. An improved starting transform should reduce corrective work without preventing the user from deliberately grading the two renditions differently.

Candidate research may include hue-stable chroma compression, adaptive luminance-versus-chroma tradeoffs, perceptual or appearance-model gamut mapping, and highlight-specific paths toward white. No single method is selected by this PRD; implementation should follow comparative evidence rather than adopting a named transform by reputation.

Evaluation must use more than the installed synthetic pattern. Build a corpus containing scene-linear ACEScg and other correctly interpreted Blender EXRs with hot emissive and reflected colors, plus representative photographic RAW/EXR/TIFF and authored gain-map sources. Include skin tones, foliage, skies, flowers, saturated fabrics/signage, mixed lighting, neutral ramps, diffuse colors, specular highlights, and values near and far beyond the sRGB boundary. Review the HDR and SDR renditions on qualified HDR and SDR displays, supported by vectorscope/gamut diagnostics and objective hue, chroma, luminance, gradient, and clipping measurements.

The exploration succeeds when the SDR result stands on its own as a polished image, the HDR result reads as the same creative work with additional luminance range and physically brighter highlights, hot rendered colors no longer collapse unnecessarily toward pastel, and normal photographs do not regress. The installed test pattern remains a useful stress target, but it cannot by itself approve a perceptual transform.

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
- Continuous instrument sliders with a narrow bar handle, fixed tabular readouts, full-row hit targets, and double-click reset. The later UI Visual Refinement Sprint supersedes the original modifier and landmark behavior: Ctrl is 10× fine adjustment, Shift uses semantic snapping, and rails remain visually empty.
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
- Maintain SDR JPEG/PNG fallback export, including very-wide JPEG validation
- Quality/compression controls for each format

### Phase 6 â€” Packaging & Distribution

**Windows MVP status — August 16, 2026:** Electron package 0.3.1 has passed installed-app hands-on validation for native import, interactive adjustment, project operation, and export. The initial 0.3.0 build exposed a transient console-window flash when settled HDR previews launched `avifenc`; 0.3.1 launches all bundled encoder/decoder subprocesses without a visible console, and the installed fix was confirmed by the product owner. Branding, application icon, and installer presentation remain deliberately deferred until the functional desktop baseline receives broader workflow testing.

**macOS technical-preview status — August 18, 2026:** Electron package 0.4.0 now builds as Apple Silicon DMG and ZIP artifacts from the Windows-parity source revision. The package bundles arm64 PyInstaller, `avifenc`, `avifdec`, `avifgainmaputil`, and `ultrahdr_app` executables. Desktop unit tests, 467 Python tests, and the packaged Electron smoke flow pass, including path-backed drop, pathless TIFF byte-stream drop, native import, project save, SDR export, capability discovery, and clean shutdown. The product owner confirmed the application opens and runs on the build Mac. A first-launch failure exposed an incomplete linker signature that the direct executable smoke path did not catch; the macOS build now applies and strictly verifies a complete ad-hoc bundle signature before producing the DMG and ZIP. A tag-triggered GitHub Actions workflow builds and tests the Windows x64 Setup/Portable and macOS arm64 DMG/ZIP candidates, writes per-platform checksums, and publishes them together as one prerelease only after both platform jobs pass. Developer ID signing, notarization, an exact-artifact Finder launch test, representative real-media drag/drop, physical HDR display review, and clean-machine testing remain release gates.

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
| Luma-first SDR gamut compression turns hot wide-gamut colors pastel | High | Research and validate the perceptual HDR-to-SDR color-equality direction defined in Section 6 against both rendered EXR and ordinary photographic corpora. Permit bounded luminance reduction where it preserves color identity better than neutralization; do not replace the current transform until CPU/WebGPU/export parity and representative visual evidence pass. |

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

The repository is no longer at the original vertical-slice stage. It now provides a usable single-image HDR finishing workflow with real AVIF and JPEG Ultra HDR gain-map export and re-import, true HDR browser preview, Apple HEIC HDR reconstruction, independent SDR fallback control, scopes and diagnostics, and delivery proofing that distinguishes authored intent, encoded fixed-headroom reconstruction, and the installed browser's live rendering. Detailed browser-proofing, performance, packaging, and round-trip evidence is retained in local maintainer QA records.

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
- SDR JPEG and PNG export
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

### Future User-Selectable Test Image: Spectral Gradient (2026-08-26)

Add a built-in **Spectral Gradient** to the test images users can choose to import. The asset should reproduce the supplied visual reference as a clean image, without the surrounding application chrome: deep blue at the upper left flowing through cyan/teal at the lower left, red/orange at the upper right, and yellow/chartreuse at the lower right, with the four fields blending smoothly through a restrained neutral center.

- Generate and retain a deterministic, high-precision master rather than using a screenshot crop, and embed explicit color-space/transfer metadata.
- Provide a clear name and thumbnail alongside the existing generated test pattern(s); choosing it must enter the normal import/session workflow rather than a special preview-only path.
- Preserve smooth derivatives without banding, seams, unintended clipping, or hue reversals across HDR preview, SDR rendering, scopes, crop/rotate, and supported exports.
- Use it as a visual stress target for gamut mapping, saturated-color continuity, gradient precision, preview/export parity, and geometry handoffs. It supplements rather than replaces neutral ramps, luminance patches, photographic fixtures, and the existing delivery pattern.

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

### Linux v0.8.0 hands-on qualification — August 31, 2026

HDR Finisher 0.8.0 was installed and exercised on an x86_64 workstation running Ubuntu 26.04.1 LTS with KDE Plasma in a native Wayland session. HDR was first enabled for the main display in **System Settings > Display & Monitor > Display Configuration**, and the application window was kept on the HDR-enabled Xiaomi Corporation Mi Monitor for the presentation check. The locally built Debian artifact was verified and installed with:

```bash
cd codebase/dist-electron
sha256sum -c SHA256SUMS-Linux.txt
sudo apt install ./HDR-Finisher-0.8.0-Linux-x86_64.deb
```

The SHA-256 check passed and the package installed as `hdr-finisher` 0.8.0. APT's `_apt` notice about reading the local package unsandboxed as root was non-fatal. The installed application launched from `hdr-finisher` without a separate Python or Node installation.

After **Load test pattern** caused the first real preview surface to be configured, the Technical scope reported all application-level Linux HDR gates as passed:

| Readout | Observed value |
|---|---|
| HDR Presentation | Qualified |
| Session | Native Wayland |
| Display | Xiaomi Corporation Mi Monitor |
| Dynamic Range | high |
| Color Gamut | P3 |
| Component Depth | 10-bit |
| Screen Depth | 30-bit output |
| Presented / transport | 1024 px WebGPU / GPU texture |
| Media / space | WebGPU canvas / Display P3 extended |
| Preview representation | 16-bit float proxy |

The test pattern was subjectively brighter and wider-ranging than an ordinary SDR presentation. That observation plus the qualified readout validates that this application build entered its intended extended WebGPU path on the named environment; it is not a photometric calibration or a measurement of emitted peak luminance. Chromium/Electron printed Wayland/Vulkan surface and Wayland color-manager diagnostics at startup, plus dynamic-uniform-buffer limit reductions. Those messages did not prevent the extended canvas from qualifying after content was presented and should not, by themselves, be treated as an HDR failure.

The hands-on run exposed three Linux integration follow-ups:

1. **Defer the Linux presentation warning until a presentation has actually been attempted.** On a fresh launch with no source, `gpuSurfaceHdr` is necessarily false because no canvas has been configured. The current capability renderer therefore displays **Non-authoritative SDR preview** over the empty import state, even though the same session becomes **Qualified** immediately after loading the test pattern. With no active session, the UI should remain neutral and may describe HDR status as waiting/not yet tested. Evaluate the warning only after a source import or test-pattern load has reached its first settled presentation attempt. Hide/reset it again after source ejection. If that attempt fails, or a previously qualified surface later fails because of monitor movement, HDR disablement, CPU fallback, or device loss, retain the persistent actionable warning. Add frontend and packaged-Electron coverage for empty launch, first qualified render, first failed render, source ejection, and qualified-to-degraded transitions.
2. **Repair KDE/Wayland taskbar icon association.** The installed `.deb` placed a valid 1024 px `hdr-finisher.png` under the hicolor icon theme and installed `hdr-finisher.desktop`, but the running window appeared as a blank gray taskbar tile. The package currently uses Electron application ID `org.hdrfinisher.app` while the desktop-entry basename and `StartupWMClass` use `hdr-finisher`; this mismatch is the leading hypothesis, not yet a confirmed root cause. Align the Wayland application ID, desktop-entry identity, executable metadata, and installed icon name, then rebuild and test both application-menu and terminal launches. Acceptance requires the correct icon in the KDE launcher, running-task tile, task switcher, and window grouping after a clean install and desktop-cache refresh.
3. **Promote mounted Linux storage into Import > Locations.** The browser currently returns only `/` as a connected root on non-Windows/non-macOS systems. The DAS was reachable by manually navigating through `/media`, but its mounted volume was not shown directly under **Locations**. The `.deb` should enumerate relevant user-accessible mounted filesystems rather than assuming all Linux storage is represented by `/`; cover common `/media/$USER`, `/run/media/$USER`, `/mnt`, and custom mount points without listing pseudo/system filesystems. Use stable labels, deduplicate paths, mark unavailable mounts honestly, refresh when the browser opens and after hot-plug changes, and allow a discovered volume or subfolder to be pinned. Flatpak behavior must retain the portal/no-broad-home security contract and surface external storage through an appropriate portal grant rather than silently broadening sandbox permissions. Add backend tests with synthetic mount tables plus hands-on `.deb` validation for DAS present at launch, attached after launch, detached while browsing, and reopened from Pinned/Recent.

### Current Blockers and Known Gaps
- **Resolved August 17, 2026 — Lightroom Classic AVIF gain-map import.** CICP transfer-characteristic code 1 is now decoded as the distinct BT.709 inverse OETF rather than rejected or aliased to sRGB. The real 42 MP Lightroom Classic AVIF preserves its SDR base, imports as `HDR_TRUE`, retains its 2.30-stop encoded display headroom, and passes the packaged Windows drag/drop path.
- **Resolved August 17, 2026 — Windows drag-and-drop ingestion.** File drops are accepted across the application surface. When Windows Explorer, Lightroom, or another shell/catalog integration supplies file bytes without an Electron filesystem path, HDR Finisher falls back to streaming the local file to its bundled backend instead of misreporting AVIF/TIF/TIFF as unsupported. Packaged regression coverage exercises path-backed drop, pathless TIFF drop, native Import, save, export, bundled capabilities, and clean shutdown; the real Lightroom AVIF also passes end to end.
- **Resolved August 17, 2026 — cross-platform icon migration.** Remaining private-use Segoe Fluent/MDL2 glyphs in disclosure, local-adjustment, and geometry controls were replaced with bundled Tabler SVG mask assets. The controls no longer depend on Windows-only font glyphs and use the same icon sources on Windows and macOS.
- **Resolved August 23, 2026 — Photoshop 32-bit TIFF interpretation and ambiguous browser previews.** Photoshop's validated `P3D65 PQ Display Full 12-16-0-1 (Linear RGB Profile)` is now recognized as Display P3 primaries with a linear transfer; the explicit 32-bit linear qualifier overrides the stale `PQ` substring retained in the base display-profile name. The real 5304×7952, 32-bit IEEE-float, 454 MB TIFF produces a color thumbnail instead of entering the ambiguity path. Genuinely unresolved sources no longer receive a confidently wrong assumed preview or a silent cached placeholder: the media browser shows a checkerboard, reason-specific `Color interpretation required` copy, and the detected ICC profile while keeping **Open Image** enabled for the established main-app interpretation gate.
- **Resolved August 23, 2026 — AVIF media-browser bit depth, stale selection, and failure caching.** The fast AVIF primary-preview decoder now honors the inspected 8/10/12-bit sample depth rather than applying an 8-bit default to valid 10-bit data. Browser selection clears the previous pixels before the next thumbnail loads, rejects superseded responses, reports real decoder failures, and versions/revalidates thumbnail caches instead of persisting a checkerboard as a successful immutable JPEG. The reported 10-bit gain-map AVIF now generates a real thumbnail, and browser regression coverage exercises loading, rapid reselection, decode failure, and interpretation-required states.
- The Windows JPEG Ultra HDR implementation blocker is cleared: the native encoder is built, bundled, attributed, and validated. The Apple Silicon native encoder and packaging path is also implemented and passes packaged capability validation; remaining release work includes clean-machine redistribution, representative real-media, physical-display, signing, and notarization validation.
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
- AVIF + gain-map export, JPEG Ultra HDR export, SDR JPEG/PNG export, and the existing import / preview / adjustment workflow
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

The packaging track now produces an Apple Silicon macOS `.app`, `.dmg`, and `.zip` with bundled native encoders and a verified ad-hoc technical-preview signature. Remaining Mac work is exact downloaded-artifact and clean-machine validation, representative real-media drag/drop, physical HDR display review, Developer ID signing/notarization, Intel/universal-build evaluation, and broader release automation.

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
- **Photographer media browser:** version 0.7.2 replaces the generic Drives / Places / Favorites browser with a macOS-tailored Recent / Pinned / Locations workflow while retaining the exposed full path and Go / Up / Pin controls. The list exposes Name, Size, Kind, and Date Added; headers toggle ascending/descending sort; columns and the right preview pane resize by pointer or keyboard; Arrow keys, Home / End, and Enter support list navigation. Pinned folders and the last three successful import locations persist in the application-data directory. Browsing, cancellation, and failed imports must not change Recent. Preview thumbnails retain natural aspect and RAW orientation instead of being padded into square canvases. Preview work is selection-scoped: the prior image is removed immediately, a visible loading state replaces it, and only the current selection may admit a completed response. A source whose color interpretation cannot be established without guessing receives a checkerboard plus a reason-specific `Color interpretation required` message and detected ICC profile; **Open Image** remains available so the established main-app interpretation gate owns the actual primaries/transfer choice.
- **Export throughput:** version 0.7.2 reduces quality-neutral full-resolution work by caching the fixed colour-science matrices, reusing one SDR transfer/quantization result for JPEG Ultra HDR's SDR intent and JPEG base, deriving the HDR intent and peak from one BT.2020 conversion, and processing independent gain-map channels concurrently. Export settings, coefficients, per-channel operations, metadata validation, and output-quality policy remain unchanged; regression tests require the cached transforms and parallel gain-map result to match their reference paths exactly. The export result reports total elapsed time so before/after comparisons use the same visible measurement.
- **Application settings, help, and update awareness:** version 0.7.3 adds persistent application-wide HDR Reference White, Auto/CPU rendering preference, project/file import and save locations, and the HDR Finisher Presets library location. The settings surface owns these controls rather than duplicating reference white in the top bar. A searchable in-app documentation browser provides tree navigation and an official GitHub feedback link. The desktop shell can compare the installed semantic version with the latest public GitHub release at startup or on demand; it never downloads or installs an update automatically, and network failure must resolve to an actionable status rather than an indefinite spinner. In the next version, the Updates panel must also provide a direct external link to the HDR Finisher GitHub Releases page so users can view release notes and downloads from the same menu.
- **Keyboard and external-control accessibility:** version 0.7.3 exposes application commands and continuous grading controls through a customizable shortcut registry. Users can assign, clear, reset, save, and load shortcut presets; slider controls expose Increase, Decrease, and Reset commands with key-repeat plus coarse/fine modifiers for Stream Decks, control wheels, and alternative input devices. Modifier-only presses never execute commands, and conservative defaults avoid reserved macOS screenshot bindings.
- **Adjustment-group presets:** every global grading group can save, apply, and delete lane/group-scoped slider-state presets without recording bypass state or unrelated controls. User presets persist as portable grading-preset files in the configured preset library. Built-in Film Look models replace the former Reference Model dropdown, apply a complete editable Film Look state, cannot be deleted, and Reset returns Film Look to Neutral.
- **Project browser and interface cleanup:** Open Project and Save Project/Save As use the in-app file browser with `.hdrfinisher` filtering, configured default locations, filename entry, and explicit replacement confirmation; an already-known project path still saves immediately. The release also shortens scope labels, prevents scope-guide overlap, aligns neutral RGB-primary purity handles, reserves stable Preset/Reset/Bypass header columns, removes redundant modal eyebrows and the top-bar reference-white control, and centers dialog close icons.
- **Format-selection documentation:** Quick Start, Gain Maps and Output Formats, and Export now explain the intended use and principal costs of JPEG Ultra HDR, AVIF gain maps, direct-HDR and SDR JPEG XL, SDR PNG, and SDR JPEG. The guidance distinguishes Ultra HDR's 8-bit JPEG components from its reconstructed HDR result, records libavif's practical 268,435,456-pixel and 32,768-pixel-axis safety defaults, and positions direct-PQ JPEG XL as high-bit-depth preservation/large-image interchange with no authored SDR fallback and uneven browser/viewer support.

### RAW Development and Corrections Direction (2026-08-23)

HDR Finisher's constrained RAW path is a beginning-of-workflow operation rather than source metadata. The Grade Control Panel therefore places a **RAW DEVELOPMENT** disclosure first, above Local Adjustments. The current implementation keeps the existing as-shot white balance, AHD demosaic, linear ACES output, Lensfun profile selection, separate distortion/lateral-chromatic-aberration/vignetting choices, optical metadata overrides, and explicit **Re-develop source** action. This UI relocation does not change decoded pixels, saved project data, or re-development semantics.

The settled product contract is:

- **RAW DEVELOPMENT** remains present at the top of the Grade Control Panel and is disabled with a concise RAW-only explanation for non-RAW sources. Until that disabled-state follow-up lands, the current slice retains the prior RAW-only visibility gate.
- RAW development remains deterministic and source-scoped. Re-development must preserve the active session identity, global adjustments, ordered local adjustments, project association, undo/history contract, and reference-white state.
- **Future RAW highlight-reconstruction follow-up (recorded 2026-08-25):** extend the spatial camera-neutral clipped-highlight reconstruction beyond its current integer LinearRaw DNG-only path to the generic mosaiced camera-RAW route. The Canon fixture `D:\Photos\2018\Craig and Tracy TW Visit 2018\IMG_0478.CR2` contains independently clipped CFA channels that the current LibRaw/rawpy `HighlightMode.Clip` development converts into harsh pink, cyan, and blue false color in bright neutral background areas. This is an import-stage color-reconstruction problem, not denoise, grading, or highlight compression. A future implementation must preserve unclipped saturated subjects, recover only spatially supported clipped highlights, remain deterministic across preview/re-development/export, and add this exact CR2 to the real-image regression suite. Do not treat a global switch to LibRaw `ReconstructDefault` or `Blend` as an accepted fix without image-quality and exposure-scaling validation.
- **Generic RAW bad/hot-pixel repair follow-up (recorded 2026-08-25; affects the main branch):** add conservative CFA-domain outlier repair before demosaic rather than allowing isolated sensor defects to expand into colored AHD clusters. Regression source `D:\Photos\2018\Craig and Tracy TW Visit 2018\P2150593.ORF` (SHA-256 `EB6586F830594E594AE89E9CBD4F2A873576BE2CF24BB7823AC71A549DE77057`) contains an isolated red CFA outlier at visible-RAW `(x=606, y=1250)`: value `611` against a same-color neighborhood median of `261.5` and camera black level `255`. The current LibRaw 0.22.1 / rawpy 0.27.0 AHD path, which requests neither bad-pixel repair nor pre-demosaic FBDD, maps it through orientation to developed `(x=1250, y=4033)` and expands it to an ACES2065-1 red cluster whose peak pixel is `[7758, 0, 455]`. Affinity Photo displays the source cleanly; DxO PhotoLab shows the dot in its lower-magnification preview but removes it when switching to its higher-quality render at approximately 55% zoom or above, consistent with correction in the final-quality RAW path. One post-demosaic median pass only halves the defect (`[3972, 0, 301]`); three passes and FBDD remove it but are broad image-wide operations. Replacing only the confirmed raw site with its same-CFA neighborhood median before AHD produces a neutral `[205, 147, 150]` result at the developed coordinate. The implementation must therefore detect and repair only high-confidence CFA outliers before demosaic, preserve legitimate small saturated highlights and ordinary sensor texture, record the applied repair count/method in source metadata, remain deterministic across import and re-development, and add this exact ORF plus synthetic negative cases to regression coverage. Do not accept a global multi-pass post-demosaic median filter as the default fix without representative detail and color-artifact validation.
- Add conservative sensor-aware denoise to RAW development before pursuing a broader finishing denoiser. The first implementation should expose understandable strength presets backed by LibRaw/rawpy's supported pre-demosaic noise-reduction path, persist the choice with `RawImportSettings`, record the applied method in source metadata, and require explicit re-development. It must not imply parity with specialized neural RAW denoisers.
- Add a separate always-visible **CORRECTIONS** group immediately below RAW DEVELOPMENT. Corrections are shared source-preparation edits and apply equally to RAW-derived images, EXR/TIFF renders, and other supported decoded sources.
- The first manual correction is profile-free barrel/pincushion distortion with an explicit neutral value and safe scale/crop behavior. It must be applied before crop, local adjustments, grading, scopes, proofing, and export, with identical CPU and WebGPU results.
- Manual distortion is a nonlinear spatial transform. Implementation must replace or extend the editor's current affine-only geometry-coordinate assumption so local masks, crop guides, sampling, overlays, and preview gizmos remain registered when correction values change. Preview caches and full-resolution export must use the same correction signature and resampling convention.
- Profile-driven Lensfun correction stays in RAW DEVELOPMENT because it is part of source re-development. Profile-free distortion stays in CORRECTIONS because it must remain editable for both RAW and rendered inputs. The UI must make this distinction clear and prevent accidental double correction.
- Later Corrections candidates are rendered-image luminance/color denoise, manual chromatic-aberration controls, dehaze, and input/detail sharpening. Each requires scene-linear/HDR-safe math, preview/export parity, conservative defaults, and representative real-image validation before becoming a committed control.

This direction is intentionally narrower than a general RAW editor: it aims to let ordinary RAW photographs complete the HDR Finisher pipeline while retaining the product's single-image, deterministic finishing scope.

### Current UI Testing Notes

#### Denoise implementation rollback (2026-08-25)

- The first shared, interactive denoise implementation was removed after hands-on Electron testing exposed regressions in the common preview path. All grading sliders became noticeably laggy at a 1K preview even when denoise had never been enabled or adjusted.
- Preview presentation also became unstable: touching Exposure could make the image zoom out, and switching among 1K, 2K, and 4K proxies or between interactive/settled render tiers could visibly change the viewport scale instead of replacing pixels in place.
- Restoring the pre-denoise frontend, WebGPU shader, adjustment model, and backend processing immediately restored expected slider responsiveness. This confirms that the regression belonged to the denoise integration rather than the individual grading controls.
- Do not reintroduce image denoise into the shared base-render path until its disabled state is demonstrably zero-cost and byte-for-byte equivalent to the established non-denoise render path. Any future implementation must keep proxy resolution independent from CSS viewport geometry, preserve zoom and scroll position across every render-tier handoff, and pass before/after interactive performance measurements on representative RAW and rendered sources before landing.
- This rollback does not affect the existing bounded SDR-guided cleanup of JPEG Ultra HDR gain-map delivery data; that export-only operation is separate from image denoise and does not participate in interactive preview rendering.

#### Interactive wavelet-denoise follow-up (2026-08-25)

- The current Amount, Luminance, Color Noise, and Detail Recovery controls are sufficiently clear for continued evaluation. Before finalizing the **Custom** method, the product owner must define its wavelet scales and per-scale adjustments more clearly: what each scale represents spatially, which noise or detail structures users should inspect, how changes at one scale interact with the others, and which adjustments require **Recalculate Denoise** rather than updating live. The final labels, descriptions, defaults, and adjustment workflow should follow that definition instead of exposing implementation terminology without a clear photographic observation model.

#### Photographer media browser contract (v0.7.2)

- **Recent** contains at most three folders in most-recently-imported order. A folder is recorded only after the selected source completes session creation successfully; merely visiting a folder, previewing a file, cancelling, or receiving an import error does not record it. The updated folder appears the next time the importer opens.
- **Pinned** is the user-managed persistent set. Existing `favorite-folders.json` data is read during migration, while new writes use `pinned-folders.json`; Recent uses `recent-folders.json` in the same local application-data root.
- **Locations** prioritizes Pictures, Downloads, Desktop, Documents, iCloud Drive, Applications, Home, Exports, and connected volumes on macOS. Unavailable locations remain explicit rather than silently redirecting elsewhere.
- The center pane is list-only for this release. Name, Size, Kind, and Date Added are sortable in both directions and independently resizable. Folder rows remain grouped ahead of files while the selected key orders each group. Horizontal overflow preserves user-chosen widths instead of shrinking the right preview away.
- The right preview pane is retained, independently resizable, and uses the available vertical space. Generated thumbnails preserve their source aspect ratio and apply embedded EXIF / LibRaw orientation so portrait RAW files are not presented horizontally or inside square padding.
- Thumbnail requests are latest-selection-wins and content/cache-version keyed. Changing selection hides the prior pixels immediately; delayed, failed, or superseded responses cannot be presented under the current filename. Decoder failures are not stored as successful immutable thumbnails.
- When authoritative source inspection reports missing, unrecognized, conflicting, or otherwise review-required color interpretation, the browser withholds potentially misleading pixels and presents a checkerboard with a reason-specific explanation and embedded ICC profile name when available. The browser does not duplicate manual primaries/transfer controls: **Open Image** stays enabled and the existing main-app Source Settings interpretation gate handles the decision.
- Pointer and keyboard operation are equivalent: Arrow Up / Down move selection, Home / End jump within the list, Left goes to the parent, Right / Enter opens a folder, Enter opens a supported selected image, and focused column or preview dividers resize with Arrow keys.
- The compact dialog header contains only the current action (`Choose a source image` or `Choose save folder`); the redundant Import Source / Export Destination eyebrow is omitted.

#### Export throughput contract (v0.7.2)

- Fixed ACEScg / sRGB / BT.2020 / ACES2065 transforms use cached matrices generated by colour-science and float32 image multiplication. Exact-array regression coverage compares them with the prior generic `RGB_to_RGB` path.
- JPEG Ultra HDR performs the SDR linear-to-sRGB conversion once and reuses those exact pixels for the raw RGBA intent and encoded legacy JPEG. Its HDR BT.2020 conversion is likewise shared by raw-intent preparation and peak measurement.
- The three guided-filter gain-map channels may execute concurrently because they are mathematically independent. Every channel retains the prior operation order and coefficients, and the stacked result must remain array-identical to the serial reference.
- These optimizations must not relax structural, XMP / ISO 21496-1, decoder, metadata, atomic-publication, or visual-quality validation. Future performance changes require the same exactness tests plus representative full-resolution timing before claiming a speedup.

#### Application settings and command contract (v0.7.3)

- Application preferences are local desktop state, not project state. Changing default reference white affects new sessions and a user-confirmed active-session change; project files continue to carry their own reference-white value.
- Folder preferences remain explicit and independently configurable for project import/save, source import, finished-file save, and the preset library. The default preset library contains separate Keyboard Shortcuts and Grading directories.
- Shortcuts are data-driven command bindings. Conflicting assignments are resolved deliberately, bare modifiers are ignored, macOS system screenshot chords are not claimed by defaults, and continuous controls remain operable through repeatable Increase/Decrease/Reset actions.
- Update checks compare versions only. They may display and dismiss a release notice and open the official repository, but may not silently download, install, or execute release assets.
- Help content is sourced from the shipped documentation, searchable without leaving the application, and retains hierarchical navigation. External feedback/bug-report navigation is constrained to the official HDR Finisher GitHub project.

#### Grading preset and project-browser contract (v0.7.3)

- A grading preset contains only the values owned by one named HDR or SDR adjustment group. Applying it cannot change another group, the opposite lane, section bypass, project reference white, geometry, local adjustments, export settings, or application preferences.
- User-created presets can be named, applied, and deleted. Built-in Film Look presets are read-only and non-deletable. Neutral is represented by the group's default state rather than a built-in preset that duplicates Reset.
- Open Project enables only existing `.hdrfinisher` files. Save Project adds the extension when omitted and requires explicit confirmation before replacing an existing file. Once a document owns a known authorized path, ordinary Save remains direct; Save As always reopens the custom browser.
- Browser cancellation, invalid selection, missing source relink, and backend errors leave the current document intact and show a human-readable message; structured error objects must never surface as `[object Object]`.

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

- Opening Rotate starts an explicit geometry transaction. **Rotate left 90 degrees**, **Rotate right 90 degrees**, **Flip H**, **Flip V**, and **Straighten** modify only that local draft until the user presses **Apply rotation**.
- A positive draft rotation is clockwise, matching the button label. A draft quarter turn resets the draft crop to the full frame because the previous normalized crop belongs to the old orientation; neither change is committed until Apply.
- **Straighten** is a continuous `-45` through `+45` degree control. Slider movement responds immediately by rotating the currently displayed canvas at its existing viewer scale behind a stationary alignment grid. The temporary transform uses scale `1` and no generated `clip-path`.
- The stationary straighten grid retains the displayed image frame and aspect for the duration of the gesture. It uses dense high-contrast alignment lines plus a clearly drawn border around all four edges so the intended frame remains legible while image corners move through it.
- Pausing while holding the slider and releasing the pointer must leave the same locally transformed canvas visible. HDR Finisher must not request or mount an authoritative replacement preview, apply the valid-pixel crop, refit the canvas, or otherwise advance the pipeline while the Rotate transaction remains open.
- **Apply rotation** is the sole commit action. After it is pressed, the local transform remains visible until the matching authoritative rotated and valid-pixel-cropped frame is ready; only then may the temporary transform clear.
- Leaving Rotate by pressing Cancel, pressing the Rotate tool toggle again, opening Crop, changing workflow tabs, ejecting the source, or entering any other tool cancels the transaction and restores the exact pre-Rotate geometry. Tool navigation must never imply Apply.
- Crop therefore always opens against the last explicitly committed geometry. Crop's own **Apply** composes its normalized draft into any previously committed crop; Crop **Cancel** discards only the Crop draft.

#### Implementation structure and invariants

- Frontend interaction orchestration lives in `codebase/frontend/app.js`:
  - `beginStraightenGesture` captures the committed base angle and displayed frame, shows the grid, and invalidates older preview generations.
  - `updateStraightenInteractive` updates the active Rotate draft and applies only the immediate temporary rotation delta through `--interactive-straighten-angle`; `--interactive-straighten-scale` remains `1` and `clipPath` remains empty. It must not queue an authoritative preview.
  - `showStraightenGrid` freezes and draws the canvas grid and its two-pass dark/light edge border. `finishStraightenGesture` hides the grid without clearing, replacing, settling, or committing the visual draft.
  - `closeRotateMode(true)` is reachable only from **Apply rotation** and starts the committed preview handoff. Every other exit calls `closeRotateMode(false)` before opening the destination tool or workflow.
  - `openCropMode` creates its draft from committed geometry only. `closeCropMode` composes the visible-frame draft into `cropEditBaseCrop` on Crop Apply.
  - Applying Rotate, Flip, Straighten, or Crop must invalidate the shared global edit state before a normal preview is requested; cancelling a Rotate draft must not dirty the document. A normal preview must never render an older backend geometry and temporarily appear to undo a committed geometry edit.
  - `cropAuthoringFrameAspect` mirrors the backend's safe-rectangle calculation so fixed and custom aspect ratios are constrained in the same post-straighten coordinate space.
- The CSS transform in `codebase/frontend/styles.css` is a temporary visual aid only. Do not put crop authority, persisted zoom, or export geometry into the CSS transform.
- Authoritative processing lives in `codebase/backend/hdr_finisher/finishing.py::apply_geometry` and remains ordered as: quarter rotation, horizontal/vertical flips, arbitrary-angle straighten, then normalized crop.
- `_rotate_to_valid_pixels` performs bicubic rotation with expansion, derives the largest centered valid-pixel rectangle through `_largest_rotated_rectangle`, and retains a two-pixel kernel inset on every edge. This no-invented-corners rule applies to previews and exports.
- `zoomReferenceFrame` stabilizes display size across proxy-resolution swaps. Source geometry may update its aspect, but a preview quality or proxy long-edge change must not masquerade as zoom or alter scroll position.

#### Regression requirements

- Browser coverage must verify live rotation direction, temporary scale `1`, empty `clipPath`, stationary grid dimensions, non-empty grid rendering, and zero authoritative preview generations or preview-source replacements while a Rotate draft is being adjusted, paused, or released.
- The Electron smoke flow must hold the Straighten gesture at a non-trivial value long enough to catch delayed work, release it, and prove that the same preview source and temporary transform remain mounted with the Rotate transaction open.
- The same flow must prove that Rotate-to-Crop restores the original quarter-turn/Straighten geometry, while **Apply rotation** alone commits it and retains the temporary visual transform until the matching authoritative frame presents.
- `codebase/tests/test_advanced_finishing.py` must continue to prove that arbitrary-angle straightening returns finite valid pixels without padded corners and that shared geometry produces matching HDR/SDR dimensions.
- Any change to transform order, safe-rectangle math, crop composition, preview generation, or viewport zoom must run both the focused geometry tests and the broader local-adjustments browser interaction test. Visual QA must include at least one portrait and one landscape image at a non-trivial angle.
- **Windows package follow-up (recorded 2026-08-26):** carry this explicit Rotate transaction into the next rebuilt Windows package and run the same regression there before release. The installed Windows build must never replace or settle the preview before Apply, must cancel Rotate when Crop or another tool opens, and must commit only through **Apply rotation**. Confirm the packaged Windows app—not only the shared source frontend—passes cancellation, explicit application, undo/redo, and preview/export parity checks.

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

- **Path feather/softness QA follow-up (recorded 2026-08-27):** the current additive outer-feather behavior and adjustable falloff are accepted provisionally, but should be deliberately stress-tested in a future polish pass. Try to break them with extreme Feather and Softness combinations, tightly concave and self-overlapping outer guides, rapid slider scrubbing, node edits during preview settlement, undo/save/reopen, 4K sources, and high zoom. Watch specifically for halos under strong exposure changes, discontinuities or hotspots where feather regions merge, stale or disappearing overlays, long uncommunicated processing, and disagreement between the red overview mask and the applied grade.
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
5. Run the hosting survival sequence: Cloudflare Pages direct bytes, Cloudflare transformations, WordPress originals/generated sizes, and one additional optimizer/CDN. Keep JPEG as provisional default until the delivery-proofing evidence threshold is met.
6. Retain the server-backed in-app export-folder browser and direct path entry as resilient development fallbacks. During installer validation, explicitly test the installed app's native **Choose image** and **Choose export folder** dialogs from the launched application process: each dialog must appear in the foreground on the active desktop, support paths containing spaces and non-ASCII characters, return the selected source or writable destination correctly, handle cancellation without an error, permit reopening after cancellation or failure, and never leave its Browse button disabled or its UI stuck on an opening status. Verify these behaviors on the clean-machine installer test, after an application restart, and when another application owns focus. Do not mark the installer picker work complete based only on source-run or automated browser coverage.
7. Complete installer-readiness changes: automatic browser launch, single-instance and port-conflict handling, clean shutdown, user-writable runtime directories, path portability, quiet console behavior, and application icon/version metadata.
8. Continue documented darktable RAW and Blender 5.2 LTS source-export validation after the completed Affinity workflow.
9. Keep JPEG XL and DNG deferred until representative interoperability corpora and packaging evidence justify a deliberate product decision.
10. Build and clean-machine validate a conventional per-user Windows installer, then publish the unsigned V1 preview on the official GitHub Releases page with checksums, expected SmartScreen behavior, supported workflows, evidence-backed browser claims, and known limitations. Apply to SignPath after the public release qualifies.
11. Continue macOS release validation now that the Apple Silicon native encoders and `.app`/`.dmg`/`.zip` packaging pass the automated gate. Test the exact downloadable artifact on a clean Mac with representative HDR sources and a physical HDR display. The ad-hoc-signed technical preview must retain explicit Gatekeeper guidance; complete Developer ID signing and Apple notarization before presenting the Mac build to ordinary users. Keep JPEG XL deferred unless later evidence makes it strategically important and practical to ship.
12. Fix the remaining TIFF unrecognized-color-space fallback recorded above. The Lightroom Classic AVIF CICP import gap is resolved and validated with the real source file in the packaged Windows application.
13. Continue source-export workflow validation (see [Source Preparation Workflows](../workflows/source-preparation.md)) with the following still-untested candidates:
    - **Photoshop OpenEXR export** — the Photoshop 32-bit HDR recipe validated on 2026-08-17 used TIFF only; Photoshop 27.5+ has native OpenEXR write support that remains untested, including whether it writes usable EXR `chromaticities` (Affinity's EXR export notably did not).
    - **GIMP workflow** — not yet attempted. GIMP's HDR/32-bit float and EXR support has changed across major versions; needs a real recipe and round trip before any doc claims.
    - **DNG from Adobe (Lightroom Classic / Camera Raw) and DxO PhotoLab** — see the DNG candidate note under Section 4. Pull a real linear DNG from each app and verify with `exiftool`/`dcraw -i -v` whether a display tone curve is baked in despite the "linear" label, and whether `ColorMatrix1/2`, `CalibrationIlluminant`, `AsShotNeutral`, black/white levels, and `BaselineExposure` are populated well enough for a deterministic ACEScg mapping without camera-profile selection or general RAW development, before any DNG import proposal is written.
14. Run the perceptual HDR-to-SDR color-equality exploration defined in Section 6. Establish a versioned Blender EXR and photographic corpus, capture the current luma-first compressor as the baseline, compare candidate mappings with matched HDR/SDR visual review and numerical diagnostics, and write a focused implementation PRD only after the preferred luminance/chroma tradeoff is supported across both source classes.

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
*August 16, 2026 implementation addendum, refined August 26: Crop and Rotate behavior is explicitly contracted as a user-confirmed transaction. Straighten responds immediately at scale 1 behind a stationary bordered grid, but pausing or releasing the slider performs no preview replacement, valid-pixel crop, refit, or commit. Apply rotation is the sole commit; opening Crop or leaving Rotate by any other route cancels and restores the pre-Rotate geometry. Frontend state ownership, backend transform order, zoom separation, explicit commit/cancel behavior, and required Python/browser/Electron regression coverage are recorded in the Crop and Rotate Interaction Contract above.*
*August 17, 2026 implementation addendum: Source-export workflow guidance was extended to Adobe Lightroom Classic, Adobe Photoshop, and DxO PhotoLab in `docs/workflows/source-preparation.md`, backed by real hands-on round trips retained in maintainer QA records. Lightroom Classic's AVIF HDR-Output export is the validated primary recipe, blocked only by the CICP transfer-code import gap recorded above; its 32-bit TIFF export is a validated secondary recipe, but only with **Maximize Compatibility left unchecked** — checked, Lightroom silently clamps real HDR data to a bounded `[0,1]` range, the opposite of what that same checkbox requires for AVIF gain-map inclusion. Photoshop's validated recipe is materially different from the original guess: Camera Raw's HDR toggle hands off a 16-bit PQ-encoded (not scene-linear) document, which must be promoted with `Image > Mode > 32 Bits/Channel` to decode PQ into real linear light before `File > Save As` (never `Export As`, which forces an 8-bit sRGB flatten) — validated end to end including direct ICC colorant-tag verification that the resulting primaries are genuine Display P3. DxO PhotoLab, as of PhotoLab 9, has no export path that produces HDR Finisher-importable HDR data (TIFF tops out at 16-bit, DNG carries no tonal/color rendering, and DxO cannot import EXR); its linear DNG is flagged as a plausible future DNG-import candidate rather than a current recipe. Two real HDR Finisher import gaps were found and are recorded under Current Blockers and Known Gaps: an AVIF CICP transfer-code gap (briefed to Codex, fix pending) and a misleading default-assumption fallback for unrecognized TIFF color profiles (not yet briefed). Future testing plans are recorded as item 13 under Recommended Next Steps: Photoshop OpenEXR export, a GIMP workflow, and DNG round-trip research using real Adobe and DxO PhotoLab linear DNG exports.*
*Later August 17, 2026 implementation addendum: the Lightroom Classic AVIF CICP transfer gap is resolved with a standards-distinct BT.709 decode and real-file packaged validation. Windows drag-and-drop now covers the full app surface and falls back to local byte streaming for shell/catalog drops that do not expose a filesystem path; packaged TIFF, the real Lightroom AVIF, and native Import all pass. The last Windows-only Segoe/MDL2 control glyphs were replaced with bundled Tabler SVG assets, clearing the known cross-platform icon blocker. A request-header shutdown race discovered during packaged validation was also removed by binding the active backend credentials for the interceptor lifetime.*
*August 18, 2026 implementation addendum: Apple Silicon package 0.4.0 is built from the Windows-parity source revision as DMG and ZIP artifacts with arm64 Electron, PyInstaller backend, and all four native AVIF/Ultra HDR tools. Desktop unit tests, 467 Python tests, and packaged path-backed/pathless drop, import, save, export, capability, and shutdown coverage pass. Product-owner launch validation exposed an incomplete linker signature missed by direct-executable automation; the build now applies and strictly verifies a complete ad-hoc app-bundle signature before artifact creation. The unified tag-triggered desktop release workflow gates publication on tested Windows x64 Setup/Portable and macOS arm64 DMG/ZIP jobs and includes per-platform SHA-256 manifests. Developer ID signing/notarization, exact downloaded-artifact and clean-machine checks, representative real-media drag/drop, physical HDR display review, and Intel compatibility remain open.*
*August 19, 2026 implementation addendum: the minor-bug validation pass recorded in `docs/product/Next_Sprint_Minor_Bug_Backlog.md` is complete for MINOR-02 through MINOR-07 and user-verified on the npm/Electron Windows HDR build. The pass adds deterministic JPEG Ultra HDR endpoint dithering, reliable path-preserving EXR drag-and-drop with a pathless fallback, single native overwrite approval with cross-runtime-safe target validation, revision- and lane-safe HDR/SDR preview/scopes, stronger narrow-range Gain behavior in matching CPU/WebGPU paths, and same-gesture curve-point creation and dragging. Follow-up testing also fixed Affinity EXR portrait aspect retention, a WebGPU shader mutability error that disabled the HDR surface, native clipboard path copying, and an SDR-canvas/HDR-scope race after manual Display P3 Linear interpretation. MINOR-08—JPEG Ultra HDR appearing brighter than a matched AVIF—was investigated from the encoded files and independently reconstructed HDR pixels, then checked by the user in the same browser. The matched files were functionally equivalent; an unedited-EXR follow-up showed only a slight AVIF dark-region lift with otherwise close rendering. The report is shelved as non-reproducible/likely save or viewing-state variance, with no speculative encoder change and no new regression tests.*
*August 20, 2026 implementation addendum: version 0.5.0 advances the published 0.4.0 technical preview with experimental JPEG XL HDR and constrained RAW/DNG development, transactional in-place RAW re-development, latest-request-wins staged import, bounded large-frame color/analysis memory, deterministic JPEG XL precision and marker validation, canonical Lensfun selection, guarded dirty-document transitions, color-managed media-browser thumbnails, and corrected cache/profiler diagnostics. Release review also made browser proof semantics explicit: Browser delivery uses the actual AVIF/JPEG/JPEG XL artifact, Reference target uses deterministic Rec.2020/PQ output, and SDR base remains separately selectable. Concurrent proof generation no longer races into black frames; unsupported native JPEG XL display falls back visibly to the reference. Matched Safari review showed delivered AVIF gain-map and JPEG Ultra HDR images were close to each other but both darker than the direct-PQ reference, so no speculative per-format brightness compensation was introduced. False Color and Zebra now activate immediately without cycling High-res preview, and Electron exposes its Reload command. The full implementation and remaining release-hardening gates are recorded in `docs/design/Code_Audit_Stabilization_Sprint_PRD_2026-08-20.md`.*
*August 22, 2026 implementation addendum: a real Sony RAW project exposed Safari-visible patchy noise in JPEG Ultra HDR while Chrome showed milder noise. The file was structurally valid, but libultrahdr had mapped an 8-bit gain image across `-14.3` to `+7.29` stops even though the authored display capacity was only `+2.318` stops; near-zero RGB channel ratios therefore consumed most available codes. JPEG Ultra HDR export now applies an automatic publishing-only content-boost guardrail of `-4` to `+4` stops (`0.0625x` to `16x`), expanding the positive limit whenever the measured authored HDR peak requires more headroom. It also applies a conservative SDR-guided filter only to the generated logarithmic gain map before final compression. The original SDR primary remains pixel-identical, the creative HDR/SDR endpoints remain untouched, and bounded-memory stripes support full-resolution RAW exports. On the reported half-resolution Web Optimized fixture, disabling synthetic grain made no difference, a full-resolution map made Safari's pattern finer but did not remove it, and the guided map filter produced a slight Chrome improvement plus a user-verified major Safari improvement while reducing the test file from about 3.8 MB to 3.6 MB. AVIF receives neither the JPEG range clamp nor spatial filter: bundled libavif already trims ratio-range outliers, while AVIF map denoising remains a test-gated roadmap item. Direct-PQ JPEG XL remains outside all gain-map logic.*
*August 23, 2026 implementation addendum: version 0.7.2 introduces the photographer-focused Electron media browser and a quality-neutral export-throughput pass. The importer now provides persistent Pinned folders, three successful-import-only Recent locations, macOS-priority Locations, sortable and resizable Name / Size / Kind / Date Added columns, complete keyboard navigation, a resizable right preview, natural-aspect color-managed thumbnails, and explicit RAW preview orientation handling. Its compact header retains only the action title and full path / Go / Up / Pin controls. Export preparation now caches fixed color matrices, eliminates duplicate SDR and HDR conversion work in JPEG Ultra HDR, runs independent gain-map channels concurrently, and reports elapsed export time; exact reference-path tests protect transform and filter output. The complete deterministic suite passes 622 tests with three skips, the seven Electron unit tests pass, and live macOS Electron QA covers browsing without Recent mutation, sort toggling, keyboard resizing, and portrait RAW preview layout.*
*Later August 23, 2026 implementation addendum: media-browser preview admission is now selection-scoped and explicitly loading-aware, preventing a previous file's pixels from appearing under a newly selected filename. AVIF base thumbnails honor inspected sample precision, decoder failures are not persisted as successful immutable checkerboards, and the thumbnail cache schema is versioned. Photoshop's real 32-bit `P3D65 PQ Display Full … (Linear RGB Profile)` TIFF is recognized as linear Display P3 and generates a validated color thumbnail. Genuinely unresolved sources follow the main-app interpretation policy: the browser withholds misleading pixels, displays a checkerboard with reason-specific `Color interpretation required` copy and detected ICC profile, keeps **Open Image** enabled, and defers the primaries/transfer decision to Source Settings. The deterministic Python suite passes 625 tests with three skips, and installed-Chrome interaction coverage passes loading, rapid reselection, decoder failure, and interpretation-required states.*
*August 23, 2026 v0.7.3 release addendum: application-wide Settings and searchable Help browsers now cover HDR reference white, processing mode, project/import/export/HDRF-preset locations, update checks, documentation, and GitHub feedback. A command registry supports conservative macOS-aware defaults, user-defined shortcuts, external keyboard/control-surface step commands for continuous controls, individual/all-default reset, and JSON shortcut presets. Grading adjustment groups now support isolated built-in and user presets, including protected Film Look reference-model presets and deletion of user presets only. Project open/save use the in-app file browser; header, modal, scopes-label, slider-handle, and control-panel presentation issues are corrected. Export documentation now explains the practical strengths, limitations, bit depth, fallback behavior, dimensions, and compatibility of JPEG Ultra HDR, AVIF gain maps, JPEG XL HDR, JPEG SDR, and PNG SDR. Release validation passes 629 Python tests with three skips, seven Electron unit tests, source Electron integration, and packaged Electron import/project-save/export/capability coverage. The Apple Silicon app reports version 0.7.3 and passes strict deep signature verification with an ad-hoc signature; the DMG checksum and ZIP contents also verify. Release artifacts are `HDR-Finisher-0.7.3-macOS-arm64.dmg` (196,265,400 bytes; SHA-256 `757d220d88f350069dd27cf3fc48e19ad5baaafb904190a6a75b8c55890ef9c1`) and `HDR-Finisher-0.7.3-macOS-arm64.zip` (197,273,658 bytes; SHA-256 `a1b5bc390eb59f9f9cb86a27fb6f671ec199c76974654fd4386244c636b39202`). Developer ID signing, notarization, exact downloaded-artifact/clean-machine validation, and the matching Windows build remain release follow-ups.*
*August 29, 2026 v0.7.6 implementation addendum: the HDR and SDR lanes now include a dedicated GPU-preview/CPU-settled Detail module with Texture, Clarity, radius control, and continuously qualified sharpening; the same Detail payload is available in masked local grades while Film Look Microcontrast and output sharpening retain their separate pipeline roles. SDR adds a centered one-click Match entire HDR grade workflow with captured-recipe state, independently editable trims, inherited-versus-override grain behavior, automatic/manual highlight mapping, stale detection, Rematch, Revert, source-specific invalidation, deterministic redo, and intentional stacking after HDR Peak Fit/Soft Ceiling. Slider history is coalesced by completed gesture, authoritative Undo/Redo refreshes controls, side-by-side modifier-wheel zoom addresses either image, Detail presets are registered, project opening shows blocking progress, and obsolete schema v1-v3 documents are rejected instead of entering relink or migration. GPU preview startup and transient-loss recovery were hardened so ordinary Tone and Detail interaction can re-enter the accelerated path without leaving a black preview. Schema v4 adds neutral Detail and inactive SDR Match defaults without a migration utility.*
