# HDR Finisher

**Open-source HDR finishing and AVIF / JPEG gain-map export utility for web publishing.**

HDR Finisher is a standalone, offline desktop application for Windows and macOS. It is the missing last-mile link in a professional HDR photography and CGI workflow: ingest 32-bit floating-point and HDR-encoded images from any editing software, make global finishing adjustments while viewing true HDR output in real time, and export web-ready AVIF files with embedded ISO 21496-1 gain maps — the same output standard that previously required an Adobe subscription.

**This is early-stage prototype software.** Core functionality works, but expect rough edges. Feedback welcome.

---

## What It Does

- Accepts HDR output from non-Adobe editors (Blender, Affinity Photo, darktable, DXO PhotoLab, and others)
- Displays images in true HDR via a local browser viewport
- Provides global finishing adjustments for both the HDR output and the SDR fallback embedded in the gain map
- Exports production-ready AVIF with ISO 21496-1 gain map
- Exports backward-compatible JPEG Ultra HDR (`.jpg`) with an authored SDR fallback, authored HDR rendition, Ultra HDR v1 XMP, and ISO 21496-1 metadata when the pinned encoder is installed
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

## Current State (July 2026, v0.1.16)

The following is working in the current build:

- HDR classification, metadata inspection, and source interpretation override
- True HDR browser preview via PQ AVIF transport
- Apple HEIC auxiliary gain map detection and reconstruction
- Independent HDR and SDR adjustment controls
- RGB Curves editor (Luma / R / G / B channels)
- Histogram and waveform scopes with HDR reference-nit labeling
- False color and zebra diagnostic overlays
- Real AVIF + ISO 21496-1 gain map export
- JPEG Ultra HDR (JPG + Gain Map) technical-alpha export through Google's `libultrahdr`
- SDR PNG export

**Not yet implemented:** JPEG XL export and a polished installer. The technical PyInstaller package is available, but JPEG Ultra HDR is capability-gated until a compatible `ultrahdr_app` is built or supplied.

### Enable JPEG Ultra HDR on Windows

Google does not publish a prebuilt Windows `ultrahdr_app`. With CMake and Visual Studio 2022 Build Tools installed, build the pinned source and validate it with:

```powershell
cd codebase
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_libultrahdr_windows.ps1
```

The script enables both `UHDR_WRITE_XMP=ON` and `UHDR_WRITE_ISO=ON`, runs upstream tests, performs a real generated-media encode/decode check, and places the executable and redistribution notices under `codebase/bin/`. A user-supplied `ultrahdr_app` on `PATH` also works, but exports are rejected unless the result contains both metadata formats and passes libultrahdr decoding.

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

## UI Preview Automation

The repo includes a small Playwright smoke-preview script for checking the local UI in Edge or Playwright's bundled Chromium:

```powershell
cd codebase
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\playwright_preview.ps1
```

The script starts the local app if needed, reuses the machine's existing Playwright browser cache when available, prefers installed Edge, and writes its screenshot/result files to `codebase/output/playwright/`. Add `-Headed` for a visible browser window or `-KeepServer` to leave the local app running afterward.

## Alpha QA And Packaging

Run the full alpha QA harness:

```powershell
cd codebase
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run_alpha_qa.ps1
```

This runs tests, JavaScript syntax validation, capability reporting, sample AVIF export, AVIF metadata inspection, and Playwright UI preview. When `ultrahdr_app` is available it also creates a real JPEG Ultra HDR sample, confirms both metadata schemes, decodes the SDR fallback with Pillow, decodes the HDR rendition with libultrahdr, and checks the highlight luminance relationship. Reports are written to `codebase/output/qa/`.

Build the technical Windows alpha package:

```powershell
cd codebase
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_windows.ps1
```

The build uses PyInstaller folder mode, smoke-tests the packaged app, and writes `codebase/output/package/HDRFinisher-alpha-windows.zip`. If PyInstaller is missing, install dev dependencies with `python -m pip install -r requirements-dev.txt`.

For private HEIC/EXR validation without committing media:

```powershell
cd codebase
python .\tools\local_media_probe.py "D:\path\to\image.heic" "D:\path\to\render.exr" --export
```

Manual HDR-display checks are tracked in `md\Alpha_Manual_QA_Checklist.md`.

---

## License

Optional bundled encoders retain their upstream licenses and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

GPL-3.0 — see [LICENSE](LICENSE) for details.

---

## Created By

Steven Funcke ([@LucienMidnight](https://github.com/LucienMidnight))

---

## Support the Project

If you find this useful, donations are appreciated and help keep development going.

[Donate via PayPal](https://www.paypal.com/ncp/payment/TMM9TRHJUUTJS)
