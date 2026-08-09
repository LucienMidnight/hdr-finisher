# Known Limitations and Support Status

This page prevents implemented, validated, expected, and planned behavior from being conflated. Status reflects the repository on **August 9, 2026**.

## Platform matrix

| Capability | Windows | macOS |
|---|---|---|
| Run from source | Validated | Expected; dependency/browser validation incomplete |
| Technical package | Validated PyInstaller folder build | Unavailable |
| Signed installer | Unavailable | Unavailable |
| Native export-folder picker | Validated Windows Forms | Implemented through Tk; not repository-validated |
| Native HDR/SDR-white telemetry | Validated QueryDisplayConfig/DXGI | Unavailable |
| Chromium UI automation | Validated | Not maintained |
| Physical HDR browser checks | Maintained Windows evidence | Not maintained |
| Auto proof target | Uses Windows telemetry when available | No native telemetry; use fixed target |

## Input limitations

- Supported manual source spaces are limited to linear sRGB/Rec.709, linear Display P3, linear Rec.2020, and ACEScg, plus PQ/HLG/sRGB transfer choices.
- ProPhoto/ROMM, Affinity wsRGB, ACES2065-1 manual selection, arbitrary ICC RGB spaces, log camera encodings, and custom OCIO spaces are not safe general inputs.
- EXR chromaticities are optional; ambiguous files require user knowledge.
- Multilayer EXR beauty-pass selection is not a general user feature.
- The pipeline sanitizes negative scene-linear values to zero.
- HLG decoding assumes a 1,000-nit system peak.
- TIFF acceptance depends on supported layouts/compression/codecs; unusual channel organizations may fail.
- Apple HDR HEIC support targets the implemented auxiliary-gain metadata path, not every vendor HEIF HDR scheme.

## Editing limitations

HDR Finisher is global-only:

- No RAW development
- No masks, selections, brushes, gradients, or local adjustments
- No layers or compositing
- No crop, transform, lens correction, sharpening, denoise, or retouching
- No batch queue or automation UI
- No undo/history stack or saved project/session format
- No local presets/look library

Ejecting or replacing the image discards unsaved adjustment state.

## Preview limitations

- Proxy is capped at 1,920 pixels on the long edge.
- 100% zoom refers to proxy pixels, not necessarily original pixels.
- WebGPU is an interactive draft; backend processing is authoritative.
- An SDR-compatible representation is not true HDR output.
- Browser/display tone mapping can differ from the authoring canvas.
- Headless automated tests cannot certify emitted luminance.
- Display telemetry is descriptive and may be inaccurate; it is not a meter.

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
- JPEG XL is not implemented.
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

- The Windows package is a technical alpha archive, not a signed installer.
- There is no automatic updater.
- Native encoder redistribution may vary by platform and license requirements.
- The local API is not authenticated or hardened for network exposure.
- There is no stable versioned external API guarantee.

## Planned or explicitly deferred

- Polished installers and macOS package/signing
- JPEG XL
- Wider automatic source-space/OCIO integration
- Broader physical browser/device acceptance matrix
- Batch automation

Planned does not mean promised. Use the product requirements and issue tracker for direction, but use this page and the active code for current capability.
