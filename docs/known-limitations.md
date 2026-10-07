# Known Limitations and Support Status

This page prevents implemented, validated, expected, and planned behavior from being conflated. Platform and distribution status reflects **September 4, 2026**; the Denoise and preview notes below were refreshed on **October 5, 2026** against the viewport-preview PRD and baseline.

## Platform matrix

| Capability | Windows | macOS | Linux x86_64 |
|---|---|---|---|
| Run from source | Validated | Expected; dependency/browser validation incomplete | Validated in Kubuntu SDR/degraded mode; physical HDR pending |
| Technical package | Validated PyInstaller folder build | Implemented Apple Silicon package | `.deb` validated locally; Flatpak manifest/CI path implemented |
| Signed/store distribution | Unavailable | Unavailable | Flathub submission pending physical qualification |
| Native file picker | Implemented | Implemented | Implemented; Flatpak uses XDG portals |
| Native display metadata | Validated QueryDisplayConfig/DXGI | Unavailable | Electron label/color-space/depth only; no peak nits |
| Chromium UI automation | Validated | Not maintained | Implemented headless/X11 degradation path |
| Physical HDR browser checks | Maintained Windows evidence | Not maintained | Required on Kubuntu 26.04; not yet recorded |
| Auto proof target | Uses Windows telemetry when available | Use fixed target | Use fixed/custom target; exact headroom unavailable |

## Input limitations

- Supported manual source spaces are limited to linear sRGB/Rec.709, linear Display P3, linear Rec.2020, and ACEScg, plus PQ/HLG/sRGB transfer choices.
- ProPhoto/ROMM, Affinity wsRGB, ACES2065-1 manual selection, arbitrary ICC RGB spaces, log camera encodings, and custom OCIO spaces are not safe general inputs.
- EXR chromaticities are optional; ambiguous files require user knowledge.
- Multilayer EXR beauty-pass selection is not a general user feature.
- The pipeline sanitizes negative scene-linear values to zero.
- HLG decoding assumes a 1,000-nit system peak.
- TIFF acceptance depends on supported layouts/compression/codecs; unusual channel organizations may fail.
- Apple HDR HEIC support targets the implemented auxiliary-gain metadata path, not every vendor HEIF HDR scheme.
- Experimental DNG Import supports a constrained metadata/layout/opcode envelope, not every valid DNG. Producer-reference comparisons are in progress and macOS resource validation remains open; current successful decodes are not yet color/geometry/DJI compatibility sign-off.

## Editing limitations

HDR Finisher is a finishing editor, not a full compositor or RAW editor:

- RAW development is a constrained convenience beta. Ordinary supported Bayer and X-Trans RGB RAWs use a camera-linear float bridge with a versioned, bypassable NumPy opposed-color highlight reconstruction stage before AHD. The method repairs channel-clipped color from spatially supported opposing CFA channels but does not invent texture in fully clipped areas. Complicated colored lighting can retain pink/green boundaries, and heavily clipped X-Trans speculars can retain blue residuals that become visible only when HDR exposure is lowered; threshold changes require source re-development. Unsupported sensor/color metadata is identified in the Metadata panel as a legacy compatibility fallback. Experimental DNG Import adds metadata-driven LinearRaw decoding and audited OpcodeList3 GainMap/WarpRectilinear handling. These routes do not add segmentation/guided-laplacian reconstruction, hot-pixel repair, denoise, sharpening, creative camera profiles, or a general RAW-development UI.
- Local finishing masks support brush, gradient, path, luminance-range, and Boolean combinations; there is no pixel cloning or object-aware selection.
- No layers or compositing
- Crop/transform, Lensfun correction and Denoise are available. There is no full retouching toolset. Denoise has one method, which measures the noise in the photo (the earlier wavelet method was removed on October 6, 2026; a project saved with it opens with the current method); cold enabling while panned on the saved 42 MP photo can show too few frames during a drag (PRD 15.3 / CF-SPEED-05).
- No batch queue or automation UI
- Undo/history and saved projects are available, but projects reference the original source rather than embedding its pixels.
- No local presets/look library

Importing, opening a project, ejecting, and closing prompt to save or discard unsaved adjustment state.

## Preview limitations

- Editing preview is viewport-bounded, with selectable processing resolutions including Full. CPU preview remains available for an unavailable or lost GPU. The October 5 audits also record CPU picture, mask, scope and whole-source work that is still under investigation (PRD 15.7).
- Native zoom uses source-resolution viewport processing; magnified views below 100% use stepped processing sizes. Preview/export and cross-scale agreement have the specific limitations recorded in PRD 15.1, 15.2 and 15.7.
- WebGPU is the settled authoring preview where parity and device support are validated; explicit proof and export remain backend-authoritative.
- The Technical Execution readout can say Direct GPU while the viewer is showing a Tiled GPU frame, because it reads the last auxiliary render plan (PRD CF-ROUTE-08).
- Routine scopes analyze the current preview proxy, not every full-source pixel. Tiny source-resolution features can be reduced by proxy downsampling.
- With a 1 GiB preview budget, Full tiled slider overlap can enter the CPU settle branch for superseded/coalesced work, and guaranteed tiled interactive drafts are refused after source preparation. These Phase 4 findings remain open (PRD CF-ROUTE-06/07); warm runs sent no CPU picture request.
- An SDR-compatible representation is not true HDR output.
- Browser/display tone mapping can differ from the authoring canvas.
- Headless automated tests cannot certify emitted luminance.
- Display telemetry is descriptive and may be inaccurate; it is not a meter.
- Linux HDR presentation is qualified only on native Wayland when Chromium reports HDR and the extended `rgba16float` WebGPU canvas is active. X11/Xwayland, SDR output, and CPU/device-loss fallback are explicitly labeled as non-authoritative SDR simulation.
- On the qualified KDE/Wayland NVIDIA path, smooth HDR gradients may show more visible contouring or banding than the same content on Windows or macOS, even when the Technical scope reports a 16-bit-float WebGPU canvas, 10-bit components, and 30-bit screen output. Lowering the tested display from 143.98 Hz to 59.95 Hz did not change the result. This is a live Linux presentation limitation and does not by itself indicate that high-bit-depth exported pixels are banded; verify critical gradients in a high-bit-depth export on the intended delivery platform. Presentation-only dithering is planned as a later polish investigation.
- Crop, Rotate/Straighten, and Perspective are not GPU-accelerated. Each interactive change round-trips to a backend Python/Pillow warp, so dragging these controls feels less immediate than grading sliders, which run on WebGPU after one initial geometry proxy load.

## Color limitations

- Internal ACEScg processing is not a complete ACES color-management system.
- The SDR “ACES” tone mapper is an ACES-inspired curve, not an RRT/ODT.
- SDR gamut compression is a simple luma-preserving move toward the sRGB cube, not a perceptual appearance model.
- Extreme RGB Primaries settings can create physically/output-impossible colors.
- There is no soft proof for a specific ICC display profile.
- There is no user-selectable chromatic adaptation method.
- There is no mastering-display metadata editor.

## Export limitations

- JPEG Ultra HDR depends on a compatible libultrahdr build; availability is capability-gated.
- AVIF gain maps depend on compatible libavif command-line tools.
- JPEG XL HDR is experimental and capability-gated. It is direct 12-bit Rec.2020/PQ and has no SDR fallback; third-party files with ambiguous precision or color signaling are rejected or require manual interpretation.
- Gain-map browser/app support changes outside the project.
- The app validates structural markers and decoder behavior, not formal certification against every clause of ISO 21496-1.
- No built-in publishing client uploads directly to hosting or social platforms.
- Services may destroy adaptive HDR without returning an error.

## Proofing limitations

- Chrome Proof models encoded reconstruction, not a monitor’s physical behavior.
- The proof target is not a hard display clip.
- Local dimming, ABL, ambient light, gamut accuracy, and browser composition policy are not simulated.
- The user-facing proof stage focuses on Chrome/Chromium behavior; it is not a universal browser emulator.
- Evidence records become stale after 180 days by current policy.

## Packaging and operations

- The Windows setup and portable packages are unsigned technical previews; Windows may show an unrecognized-app warning.
- Flatpak updates are store-managed; other desktop packages provide a GitHub release check rather than an in-place automatic updater.
- Linux 0.8.8 is x86_64 only. AppImage and arm64 artifacts are not part of this milestone.
- Native encoder redistribution may vary by platform and license requirements.
- The desktop sidecar uses authenticated loopback requests and path grants, but it is not designed or hardened for network exposure.
- There is no stable versioned external API guarantee.

## Planned or explicitly deferred

- Windows/macOS signing, notarization, and installer polish
- Wider JPEG XL interoperability and platform acceptance
- Wider automatic source-space/OCIO integration
- Broader physical browser/device acceptance matrix
- Batch automation

Planned does not mean promised. Use the product requirements and issue tracker for direction, but use this page and the active code for current capability.

Local design QA retains an unresolved visual contract (CF-DRIFT-02): shared
switch dimensions/border differ from the original guard. Further diagnostic
UI checks also fail; original temporary reference images are unavailable.
See viewport PRD 16.12.

October 6 cleanup validation observed new warm latency target misses
(CF-DRIFT-03), reproduced on confirmation and unattributed to cleanup. Successful
measurement recorder exits do not mean all speed targets passed. See PRD16.17.

The October 6 fifty-local cleanup audit recorded a revision mismatch and two
120-second settle failures (CF-DRIFT-05), and a rotated SDR Denoise 15-second
outlier (CF-DRIFT-04). All of those rows used the legacy wavelet Denoise
method, which has since been removed. An October 7 narrow repeat on the
fifty-local project (SDR only; saved, flip, perspective and both; adaptive
Denoise rows included) completed 1,363 rows with no page error, no settle
timeout and every row on WebGPU, so both items are closed. The HDR lane and
the other geometry states were not repeated. The full sweep has 13 retained
failed guards; phase 4 has not met its green exit. See viewport PRD 15.7 and
16.21 and the final cleanup comparison.
