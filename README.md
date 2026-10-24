# HDR Finisher

**A free, open-source desktop photo editor built for HDR photographs on the web.**

Develop a camera RAW or a finished HDR file, grade the HDR picture on a real HDR display, grade a separate SDR picture for everyone else, and deliver both in a single gain-map file. HDR screens show the full range; ordinary screens and older apps show the SDR picture you made for them.

Windows · macOS (Apple Silicon) · Linux &nbsp;|&nbsp; GPL-3.0, no subscription &nbsp;|&nbsp; Version 0.9.1, technical alpha

[Download](https://github.com/LucienMidnight/hdr-finisher/releases) · [Quick start](docs/getting-started/quick-start.md) · [Documentation](docs/README.md) · [Known limitations](docs/known-limitations.md)

---

## What sets it apart

- **Two pictures, one file.** HDR and SDR are graded as two independent renditions of the same photo. Neither is an automatic by-product of the other. Gain-map export joins them, so each viewer gets the version made for their screen.
- **Gain maps in and out.** Exports JPEG Ultra HDR and AVIF with ISO 21496-1 gain maps, plus direct JPEG XL HDR. Gain-map files from phones and other editors open with their SDR base kept as the SDR rendition.
- **A peak you can rely on.** Set a highlight target in nits, and the rendered HDR picture never goes above it. Encoders can nudge a few highlights over; the optional **Guarantee HDR peak** check decodes the written file and corrects them.
- **Proof before you publish.** Proof encodes the real export file, then shows how it adapts on displays with less headroom, from SDR up to full HDR, or at a chosen peak in nits.
- **Scene-linear throughout.** Every source is converted to a 32-bit float ACEScg working image, with a 203-nit HDR reference white. Rendered EXR from Blender and other 3D tools is handled as carefully as camera RAW.
- **GPU first.** Preview, export, batch export, Proof and Library pictures all render on the graphics card with the same shaders. The CPU takes over if no usable GPU is found.
- **Offline and yours.** Everything runs locally. Originals are never changed; each photo's grade is saved in a sidecar file beside it.

## Supported formats

### Open

| Kind | Formats | Notes |
|---|---|---|
| Camera RAW | `.arw` `.cr2` `.cr3` `.nef` `.nrw` `.raf` `.rw2` `.orf` `.ori` `.pef` `.srw` `.dng` | Developed with LibRaw, one generic method for every camera. Includes Fujifilm X-Trans, highlight reconstruction and automatic Lensfun lens correction. DNG import is experimental. |
| Scene-linear HDR | OpenEXR, 32-bit float TIFF, Radiance HDR, PFM | The preferred handoff from other editors and 3D renderers. |
| HDR with a gain map | JPEG Ultra HDR, AVIF (ISO 21496-1), iPhone HEIC | The file's SDR base becomes the SDR rendition. |
| Encoded HDR | AVIF and 16-bit TIFF in PQ or HLG, JPEG XL | |
| SDR | JPEG, PNG, TIFF, BMP, HEIC | Opens as the file, ready to be extended into HDR. |

### Export

| Format | What you get | Best for |
|---|---|---|
| **AVIF + gain map** | SDR base (8, 10 or 12-bit) plus a 10-bit gain map, ISO 21496-1 | The best balance of quality and file size for HDR on the web |
| **JPEG Ultra HDR** | 8-bit SDR JPEG plus a gain map, Ultra HDR v1 and ISO 21496-1 metadata | Widest compatibility: any JPEG viewer shows the SDR picture |
| **JPEG XL HDR** | Direct Rec.2020 PQ at 10, 12 or 16-bit integer, or 16 or 32-bit float | Archival or very large HDR images. No SDR fallback; viewer support varies |
| **JPEG / PNG / JPEG XL (SDR)** | The SDR rendition on its own (PNG up to 16-bit) | Plain SDR delivery |

Export presets can resize, sharpen for output, choose what metadata to keep, and write several versions of each photo in one run, for example an HDR AVIF and an SDR JPEG.

## What's in the app

- **Library.** Browse folders as a grid, filmstrip or full screen, and compare two photos side by side. Rate, label, tag, and build manual and smart albums. Use focus and exposure overlays, virtual copies, and copy and paste of selected parts of a grade.
- **RAW development.** Camera RAW opens straight into an HDR grade, with lens correction and white balance in floating point.
- **HDR and SDR grading.** Tone, Highlight Compression, Exposure Bands (a tone equalizer), Color, Color Grading, Curves, Detail, Vignette, and crop, straighten and perspective correction. Match entire HDR grade builds a starting SDR from your finished HDR grade.
- **Local adjustments.** Brush, gradient, luminance-range and freeform path masks, which can be combined, each with its own grade.
- **Denoise** that measures the noise in each file, and **Black & White** with eight colour sliders.
- **Film Look.** Negative and slide film stocks, print papers, push/pull, grain, halation and lens-filter glow, applied in the order light passes through film and rendered in real time on the GPU. The film and paper data comes from Andrea Volpato's [spektrafilm](https://github.com/andreavolpato/spektrafilm), whose physical film simulation also guided HDR Finisher's own engine.
- **Scopes and full-resolution preview.** HDR waveform and histogram in nits, and true source pixels at 100% zoom, even on 40-megapixel files.
- **Batch export.** Export a whole selection in the background with a preset, with pause, cancel and a result for each file.

**Coming in 1.0:** a Retouch brush (Inpaint, Heal and Clone) and hue selection as a local-adjustment mask.

## Who it is for

Photographers and 3D artists who want to publish real HDR pictures on the web without a subscription editor. You need to know photo editing, not colour science. An HDR display is needed to see HDR; on an SDR screen you can still grade the SDR picture and place HDR with the scopes.

## Install

- **Windows x64:** run `HDR-Finisher-Setup-<version>-x64.exe` from [Releases](https://github.com/LucienMidnight/hdr-finisher/releases), or use the portable `.exe`.
- **macOS, Apple Silicon:** open the DMG and drag HDR Finisher to Applications. The build is not notarized, so the first launch needs the one-time **Open** confirmation described in [Install and run](docs/getting-started/install-and-run.md).
- **Linux x86_64:** install the `.deb` or the Flatpak. HDR preview needs a native Wayland session; see [Linux setup](docs/setup/linux.md).

Then read the [quick start](docs/getting-started/quick-start.md) and [monitor setup](docs/setup/monitors.md).

## Status

HDR Finisher is a technical alpha, heading for 1.0. Windows is the best-tested platform. Windows builds are unsigned and macOS builds are not notarized. On macOS and Linux the Library cannot yet rename, move or delete files. Saved projects and presets may need to be recreated between versions until 1.0. See [Known limitations](docs/known-limitations.md) and the [release notes](RELEASE_NOTES.md).

## Development

Python 3.12 with FastAPI and NumPy for decoding, colour maths and encoding; plain HTML, CSS and JavaScript with a WebGPU renderer for the interface; Electron for the desktop app. To run from source, run `npm install` and then `npm start` in `codebase/desktop`. See the [development guide](docs/technical/development.md), [architecture](docs/technical/architecture.md) and [code map](docs/technical/code-map.md).

## Acknowledgments

Photo-framing geometry reference code and measured test cases are from
Pedro C. Silva's [BorderMuse](https://github.com/pedrocsilva/bordermuse)
(MIT License, Copyright (c) 2026 Pedro C. Silva). HDR Finisher extends this
reference with independent two-layer geometry, attached viewer controls and
GPU-first HDR/SDR composition. See the
[retained MIT license](codebase/bin/licenses/bordermuse-MIT.txt) and
[third-party notices](THIRD_PARTY_NOTICES.md).

## License

GPL-3.0. Bundled encoders keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Created by Steven Funcke ([@LucienMidnight](https://github.com/LucienMidnight)). If HDR Finisher is useful to you, you can [donate via PayPal](https://www.paypal.com/ncp/payment/TMM9TRHJUUTJS).
