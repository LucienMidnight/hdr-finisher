# Known Limitations and Support Status

This page prevents implemented, validated, expected, and planned behavior from being conflated. Status reflects the repository on **September 4, 2026**.

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
- Crop/transform and Lensfun correction are available, but there is no denoise or full retouching toolset.
- No batch queue or automation UI
- Undo/history and saved projects are available, but projects reference the original source rather than embedding its pixels.
- No local presets/look library

Importing, opening a project, ejecting, and closing prompt to save or discard unsaved adjustment state.

## Preview limitations

- Fast proxies are display-aware; high-quality refinement is capped at 2,000 pixels on the long edge.
- 100% zoom refers to proxy pixels, not necessarily original pixels.
- WebGPU is the settled authoring preview where parity and device support are validated; explicit proof and export remain backend-authoritative.
- Routine scopes analyze the current preview proxy, not every full-source pixel. Tiny source-resolution features can be reduced by proxy downsampling.
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
