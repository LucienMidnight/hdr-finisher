# HDR Finisher

**Open-source HDR finishing and AVIF gain map export utility for web publishing.**

HDR Finisher is a standalone, offline desktop application for Windows and macOS. It is the missing last-mile link in a professional HDR photography and CGI workflow: ingest 32-bit floating-point and HDR-encoded images from any editing software, make global finishing adjustments while viewing true HDR output in real time, and export web-ready AVIF files with embedded ISO 21496-1 gain maps — the same output standard that previously required an Adobe subscription.

**This is early-stage prototype software.** Core functionality works, but expect rough edges. Feedback welcome.

---

## What It Does

- Accepts HDR output from non-Adobe editors (Blender, Affinity Photo, darktable, DXO PhotoLab, and others)
- Displays images in true HDR via a local browser viewport
- Provides global finishing adjustments for both the HDR output and the SDR fallback embedded in the gain map
- Exports production-ready AVIF with ISO 21496-1 gain map
- Exports SDR JPEG/PNG fallback for legacy contexts

## What It Deliberately Does Not Do

HDR Finisher is a finishing and export tool, not a general image editor. It has no RAW processing, local adjustments, masking, layer compositing, or batch automation. Bring your finished files here as the last step before web export.

---

## Supported Input Formats

| Format | Extension |
|---|---|
| OpenEXR | `.exr` |
| 32-bit TIFF | `.tif`, `.tiff` |
| Radiance HDR | `.hdr` |
| HEIC / HEIF (iPhone HDR) | `.heic` |
| 16-bit TIFF (PQ or HLG) | `.tif`, `.tiff` |

---

## Current State (April 2026)

The following is working in the current build:

- HDR classification, metadata inspection, and source interpretation override
- True HDR browser preview via PQ AVIF transport
- Apple HEIC auxiliary gain map detection and reconstruction
- Independent HDR and SDR adjustment controls
- RGB Curves editor (Luma / R / G / B channels)
- Histogram and waveform scopes with HDR reference-nit labeling
- False color and zebra diagnostic overlays
- Real AVIF + ISO 21496-1 gain map export
- SDR PNG export

**Not yet implemented:** JPEG Ultra HDR export, JPEG XL export, packaging/installer.

---

## How to Run (Local Development)

Requires Python 3.10+.

```bash
# Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # macOS

# Install dependencies
pip install -r requirements-dev.txt

# Run the app
python run_app.py
```

Then open `http://127.0.0.1:8000` in a Chromium-based browser (Chrome, Brave, or Edge) for correct HDR preview rendering.

---

## License

GPL-3.0 — see [LICENSE](LICENSE) for details.

---

## Created By

Steven Funcke ([@LucienMidnight](https://github.com/LucienMidnight))

---

## Support the Project

If you find this useful, donations are appreciated and help keep development going.

[Donate via PayPal](https://www.paypal.com/ncp/payment/TMM9TRHJUUTJS)
