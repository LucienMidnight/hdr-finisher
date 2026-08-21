# HDR Finisher

HDR Finisher is an offline finishing and export application for HDR photographs and rendered images. It accepts high-dynamic-range sources, lets you author separate HDR and SDR renditions, and exports adaptive gain-map images for the web.

The project is an early technical alpha. Native Windows x64 and macOS Apple Silicon desktop packages are supported, while physical HDR validation remains primarily Windows/Chromium-focused. macOS native display telemetry and the complete Mac display/browser acceptance matrix are still pending. See [Known limitations](docs/known-limitations.md) before relying on it for delivery work.

## What it is for

Use HDR Finisher after RAW development, compositing, or rendering. Basic RAW/DNG development is also
available as a convenience path, but remains intentionally smaller than a dedicated RAW editor:

1. Import a scene-linear EXR/TIFF/HDR source or supported HDR HEIC.
2. Confirm how the source color values should be interpreted.
3. Grade the HDR rendition.
4. Create and inspect the SDR fallback.
5. Proof how the gain map adapts to different displays.
6. Export JPEG Ultra HDR, AVIF with a gain map, or an SDR JPEG/PNG/JPEG XL.

HDR Finisher is not a RAW developer or layer compositor. Its local-adjustment mode is intended for finishing masks and selective grades, not pixel-cloning or full retouching.

## Start here

- **Windows users:** download `HDR-Finisher-Setup-<version>-x64.exe` from
  [GitHub Releases](https://github.com/LucienMidnight/hdr-finisher/releases) and run the installer. A
  `HDR-Finisher-Portable-<version>-x64.exe` build is also available when installation is not desired.
- **Apple Silicon Mac users:** download the macOS arm64 DMG, drag **HDR Finisher** to Applications, and open it. Unsigned technical-preview builds require the one-time Finder **Open** confirmation described in [Install and run](docs/getting-started/install-and-run.md).
- [Five-minute quick start](docs/getting-started/quick-start.md)
- [Install and run](docs/getting-started/install-and-run.md)
- [Prepare files from Affinity, darktable, Blender, or an iPhone](docs/workflows/source-preparation.md)
- [Choose system and monitor settings](docs/setup/monitors.md)
- [Browse the complete documentation](docs/README.md)

## Supported inputs and outputs

| Direction | Formats | Important note |
|---|---|---|
| Input | OpenEXR, TIFF, Radiance HDR, PFM, HEIC/HEIF, AVIF, JPEG XL, PNG, JPEG, DNG and selected camera RAW formats | An accepted file is not necessarily a valid HDR handoff. DNG import is experimental, broader RAW development is a convenience beta, and source primaries still matter. |
| Output | JPEG Ultra HDR | Backward-compatible SDR JPEG with an 8-bit gain map and Ultra HDR v1 plus ISO 21496-1 metadata. Requires a compatible `ultrahdr_app`. |
| Output | AVIF with gain map | SDR base plus BT.2020/PQ alternate and a 10-bit gain map. Requires the bundled or discoverable AVIF tools. |
| Output | SDR JPEG | The authored SDR rendition as a compact 8-bit JPEG. The bundled encoder supports dimensions up to 65,500 pixels. |
| Output | SDR PNG | The authored SDR rendition without HDR data. |
| Output | JPEG XL SDR | The authored SDR rendition as 8-bit sRGB JPEG XL with no HDR or gain map. Viewer support varies. |
| Output | JPEG XL HDR | Direct Rec.2020/PQ HDR with 10-, 12-, or 16-bit integer and 16- or 32-bit floating-point precision. The default is 12-bit integer; there is no SDR fallback. Viewer support varies. |

## Color pipeline in one paragraph

Sources are normalized to a float32, scene-linear ACEScg working image when their encoding is known. HDR Finisher defines linear ACEScg `0.18` as 100-nit diffuse white. The HDR rendition remains scene-linear through grading and is encoded as BT.2020/PQ for preview and export. The SDR rendition is independently tone-mapped and rendered to sRGB. Gain-map exports store the SDR result plus enough information to reconstruct an adaptive HDR result. Read the [color-pipeline specification](docs/concepts/color-pipeline.md) before integrating a new source or exporter.

## Development

HDR Finisher uses Python 3.12+, FastAPI, NumPy, colour-science, Pillow, OpenEXR, tifffile, a plain HTML/CSS/JavaScript interface, Electron for the Windows and macOS desktop shells, and optional native encoders. Processing and authoritative export rendering remain local.

To run the desktop shell from source, install the dependencies in `codebase/desktop` with `npm install`, then run `npm start`. Build Windows x64 artifacts with `codebase/tools/build_desktop.ps1`; build native Apple Silicon `.app`, `.dmg`, and `.zip` artifacts with `codebase/tools/build_desktop_macos.sh`. Both workflows package the Python sidecar first and write Electron artifacts to `codebase/dist-electron`.

See [Architecture](docs/technical/architecture.md) and the [Development guide](docs/technical/development.md).

## Project status

- Windows x64 and macOS Apple Silicon technical-alpha packaging are available.
- macOS native display telemetry, signing/notarization, and physical HDR acceptance remain open release-hardening work.
- JPEG Ultra HDR and AVIF gain-map availability is capability-gated.
- Batch processing, sampled content selectors, signed installers, and automatic updates are not implemented. JPEG XL HDR and Experimental DNG Import are capability-gated. Brush, gradient, luminance-range, and path local adjustments are available; sampled selectors remain build-gated pending IP review.

## License and third-party software

HDR Finisher is GPL-3.0. Optional encoders retain their upstream licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Created by Steven Funcke ([@LucienMidnight](https://github.com/LucienMidnight)).

[Donate via PayPal](https://www.paypal.com/ncp/payment/TMM9TRHJUUTJS)
