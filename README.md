# HDR Finisher

HDR Finisher is an offline finishing and export application for HDR photographs and rendered images. It accepts high-dynamic-range sources, lets you author separate HDR and SDR renditions, and exports adaptive gain-map images for the web.

The project is an early technical alpha. The current implementation and packaged build are validated primarily on Windows with Chromium-based browsers. Running from source on macOS is possible, but native display telemetry, the folder picker, packaging, and physical HDR validation are not yet at Windows parity. See [Known limitations](docs/known-limitations.md) before relying on it for delivery work.

## What it is for

Use HDR Finisher after RAW development, compositing, or rendering. It is the final global grade and delivery step:

1. Import a scene-linear EXR/TIFF/HDR source or supported HDR HEIC.
2. Confirm how the source color values should be interpreted.
3. Grade the HDR rendition.
4. Create and inspect the SDR fallback.
5. Proof how the gain map adapts to different displays.
6. Export JPEG Ultra HDR, AVIF with a gain map, or SDR PNG.

HDR Finisher is not a RAW developer or layer compositor. Its local-adjustment mode is intended for finishing masks and selective grades, not pixel-cloning or full retouching.

## Start here

- **Windows users:** download the latest `HDR-Finisher-v*-Windows-x64.zip` from
  [GitHub Releases](https://github.com/LucienMidnight/hdr-finisher/releases), extract it, and double-click
  **HDR Finisher.exe**. Do not open `frontend/launcher.html` directly.
- [Five-minute quick start](docs/getting-started/quick-start.md)
- [Install and run](docs/getting-started/install-and-run.md)
- [Prepare files from Affinity, darktable, Blender, or an iPhone](docs/workflows/source-preparation.md)
- [Choose system and monitor settings](docs/setup/monitors.md)
- [Browse the complete documentation](docs/README.md)

## Supported inputs and outputs

| Direction | Formats | Important note |
|---|---|---|
| Input | OpenEXR, TIFF, Radiance HDR, PFM, HEIC/HEIF, PNG, JPEG | An accepted file is not necessarily a valid HDR handoff. Source primaries and transfer function still matter. |
| Output | JPEG Ultra HDR | Backward-compatible SDR JPEG with an 8-bit gain map and Ultra HDR v1 plus ISO 21496-1 metadata. Requires a compatible `ultrahdr_app`. |
| Output | AVIF with gain map | SDR base plus BT.2020/PQ alternate and a 10-bit gain map. Requires the bundled or discoverable AVIF tools. |
| Output | SDR PNG | The authored SDR rendition without HDR data. |

## Color pipeline in one paragraph

Sources are normalized to a float32, scene-linear ACEScg working image when their encoding is known. HDR Finisher defines linear ACEScg `0.18` as 100-nit diffuse white. The HDR rendition remains scene-linear through grading and is encoded as BT.2020/PQ for preview and export. The SDR rendition is independently tone-mapped and rendered to sRGB. Gain-map exports store the SDR result plus enough information to reconstruct an adaptive HDR result. Read the [color-pipeline specification](docs/concepts/color-pipeline.md) before integrating a new source or exporter.

## Development

HDR Finisher uses Python 3.12+, FastAPI, NumPy, colour-science, Pillow, OpenEXR, tifffile, a plain HTML/CSS/JavaScript interface, and optional native encoders. The browser is the application viewport; processing and authoritative export rendering remain local.

See [Architecture](docs/technical/architecture.md), [Development guide](docs/technical/development.md), and [Testing and validation](docs/testing/README.md).

## Project status

- Windows technical-alpha packaging is available.
- macOS has source-run guidance but no validated package or native display telemetry.
- JPEG Ultra HDR and AVIF gain-map availability is capability-gated.
- JPEG XL, batch processing, sampled content selectors, and polished installers are not implemented. Brush, gradient, luminance-range, and path local adjustments are available; sampled selectors remain build-gated pending IP review.

## License and third-party software

HDR Finisher is GPL-3.0. Optional encoders retain their upstream licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Created by Steven Funcke ([@LucienMidnight](https://github.com/LucienMidnight)).

[Donate via PayPal](https://www.paypal.com/ncp/payment/TMM9TRHJUUTJS)
