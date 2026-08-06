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

TIFF imports include lossless Deflate/LZW compression and integer or floating-point predictors commonly emitted by darktable, Affinity Photo, and Adobe applications.

| Format | Extension |
|---|---|
| OpenEXR | `.exr` |
| 32-bit TIFF | `.tif`, `.tiff` |
| Radiance HDR | `.hdr` |
| HEIC / HEIF (iPhone HDR) | `.heic` |
| 16-bit TIFF (PQ or HLG) | `.tif`, `.tiff` |

---

## Preparing Files For HDR Finisher

HDR Finisher is the last step in the workflow, not the RAW developer or renderer. Finish the source edit first, but hand it off **before** converting it to an 8/16-bit SDR image or baking a display tone map. A useful source file has:

- floating-point RGB pixels with highlight values above `1.0`;
- a linear transfer function;
- known color primaries (embedded ICC profile or EXR chromaticities); and
- no lossy compression.

After import, check **Source Space**, **Transfer**, and the HDR classification in the Inspector. If the source interpretation is marked **Review**, choose the manual interpretation that exactly matches the export setting below. Do not choose a space merely because it looks closest.

The workflows below are preliminary and are being validated with real application exports. The Affinity workflow is the first test target.

### Affinity (Canva-era build 4646) — Sony RAW (`.ARW`)

Use a single-layer, 32-bit floating-point OpenEXR. Real build 4646 testing confirmed that this preserves unbounded HDR highlights. Affinity's TIFF **RGB 32-bit** export instead stores unsigned 32-bit integers; it is high precision but bounded and is not a true-HDR handoff.

1. Before opening the RAW, choose **Edit > Settings > Assistant**, scroll to the bottom, and click **Develop Assistant...**.
2. Set **RAW engine** to **Affinity RAW** and **RAW output format** to **RGB (32 bit HDR)**. In build 4646, **Default tone curve** is disabled and fixed at **Standard** for this configuration. **Exposure bias: Take no action**, automatic lens correction, color noise reduction, and light sharpening are suitable baseline settings.
3. Open the Sony `.ARW`, make the desired Develop Persona adjustments, and click **Develop**. A linked or embedded RAW layer is useful if you want to revise the development later.
4. Choose **Document > Setup > Convert Format / ICC Profile...**. Confirm **RGB/32 (HDR)** and convert from Affinity's default **wsRGB (Linear)** to the recommended Affinity handoff profile, **Display P3 (Linear)**, with **Relative Colorimetric** intent and black point compensation off. Use **Convert**, not **Assign**. Do not export `wsRGB` directly: HDR Finisher does not yet support that source space safely.
5. Finish global or local editing without using Tone Mapping Persona and without converting the document to RGB/16 or RGB/8. Preserve highlight detail above the SDR range for HDR Finisher.
6. In **32-bit Preview**, enable HDR, leave preview exposure at `0` and gamma at `1`, use the ICC display transform, and leave **Clip to Max (Peak)** off. A monitor reference white of `100` nits matches HDR Finisher's diffuse-white reference.
7. Choose **File > Export > EXR > OpenEXR 32-bit linear** (not layered) and set:
   - **Area/size:** whole document at native dimensions
   - **Color profile from name:** on
   - **Multi channel:** off
   - **Compression:** ZIP
   - **Image pixels:** 32 bit (FLOAT)
8. Import the `.exr` into HDR Finisher. Affinity build 4646 does not write EXR chromaticities in this workflow, so source interpretation is expected to show **Review**. Select the matching recommended import interpretation, **Display P3 Linear**, manually; do not leave the ambiguous EXR primaries on automatic interpretation. Affinity's **Display P3 (Linear)** and HDR Finisher's **Display P3 Linear** are the same primaries and linear transfer function with slightly different punctuation.

Validated with a 42.39 MP Sony ILCE-7RM3 `.ARW`: the EXR retained a peak of `13.59` linear (6.24 stops above diffuse white), while the TIFF test was bounded below `1.0`. After applying **Display P3 Linear** manually, HDR Finisher's colors matched Affinity while presenting the retained HDR brightness. Do not use JPEG, PNG, TIFF, a layered EXR, or a tone-mapped export for this handoff. Affinity's linear wsRGB and ROMM/ProPhoto RGB spaces are not yet safe automatic HDR Finisher inputs; converting to linear Display P3 avoids an incorrect primaries assumption while retaining a wider gamut than sRGB.

**Preview resolution:** HDR Finisher renders a proxy capped at 1920 pixels on the long edge, so **100%** means one proxy pixel per screen pixel rather than one original source pixel. Proxy generation uses float-preserving Lanczos resampling to suppress aliasing in mesh, fabric, foliage, and other fine detail. Return to the source editor or inspect the final export for critical source-resolution noise and sharpness judgments.

**Validate the delivered gain map:** Open the exported AVIF in a current Chromium browser on an HDR display, then move the same browser window to an SDR display to confirm the fallback. Color and detail should follow the authored HDR and SDR renditions, but do not expect the HDR browser image to be brightness-identical to HDR Finisher's live canvas. The AVIF is display-adaptive: Chromium applies the gain map according to the active display's available HDR headroom and may perform additional display tone mapping. HDR Finisher's canvas shows the authored HDR rendition with a fixed 100-nit diffuse-white reference. This brightness adaptation is expected and is not, by itself, an export failure.

### darktable — RAW Photo

OpenEXR is the preferred handoff from darktable because it carries scene-linear floating-point data and can describe its primaries with EXR chromaticities.

1. Complete the RAW development with scene-referred modules. Disable **filmic rgb** or **sigmoid** for this handoff so the display rendering is not baked into the source intended for HDR Finisher.
2. In **output color profile** (or the export module's **profile** setting), choose **linear Rec2020 RGB**.
3. Export with:
   - **File format:** OpenEXR
   - **Bit depth:** 32-bit float
   - **Compression:** ZIP or PIZ (lossless); avoid DWAA/DWAB
   - **Size:** native dimensions, no upscaling
4. Import the `.exr`. The expected interpretation is **Linear BT.2020**. If automatic detection requests review, select that exact interpretation manually.

A 32-bit TIFF with **linear Rec2020 RGB** embedded is the fallback if EXR export is unavailable. Do not select ordinary sRGB, Adobe RGB, or a display-referred profile: those choices can bake a transfer curve or constrain the HDR handoff.

### Blender 5.2 LTS — Render

Use a single-layer OpenEXR as an intermediate render, not a display-ready PNG/JPEG.

1. In **Output Properties**, set **File Format** to **OpenEXR** (single layer), **Color** to **RGB** or **RGBA**, and **Color Depth** to **Float (Full)** / 32-bit.
2. Choose **ZIP** or **PIZ** lossless compression. Avoid DWAA/DWAB for a finishing master.
3. Keep the output in the scene-linear render space. Do not bake AgX, Filmic, Standard, exposure, gamma, or another display/view transform into the EXR.
4. With Blender's standard OCIO configuration, interpret the result in HDR Finisher as **Scene-Linear sRGB / Rec.709**. If the Blender project uses an ACES OCIO configuration and renders in ACEScg, choose **ACEScg Linear** instead.
5. Prefer a single combined RGB(A) image for the handoff. Multilayer EXR is intended for compositing and can make the intended beauty pass ambiguous.

These Blender labels are based on the Blender 5.x color-management and image-format documentation and will be checked against the installed 5.2 LTS UI before this section is marked validated.

### Reference Documentation

- [Affinity Photo 2: Developing a RAW image](https://affinity.help/photo2/English.lproj/pages/Raw/raw.html) (background reference; build 4646 UI is under validation)
- [Affinity Photo 2: 32-bit HDR editing](https://affinity.help/photo2/English.lproj/pages/HDR/hdr_editing.html) (background reference)
- [Affinity Photo 2: Export settings](https://affinity.help/photo2/English.lproj/pages/ExportPersona/exportSettings.html) (background reference)
- [darktable: output color profile](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/output-color-profile/)
- [darktable: EXR and TIFF export options](https://docs.darktable.org/usermanual/development/en/special-topics/program-invocation/darktable-cli/)
- [Blender: Color Management](https://docs.blender.org/manual/en/latest/render/color_management.html)
- [Blender: Supported Graphics Formats](https://docs.blender.org/manual/en/latest/files/media/image_formats.html)

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

Requires Python 3.12+.

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

The script starts the local app if needed, reuses the machine's existing Playwright browser cache when available, prefers installed Edge, and writes its screenshot/result files to `codebase/output/playwright/`. It also runs the 1280 px layout regression covering splitter keyboard control, persistence, double-click reset, dock collapse/restore, minimum slider width, and horizontal overflow. Add `-Headed` for a visible browser window or `-KeepServer` to leave the local app running afterward.

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
