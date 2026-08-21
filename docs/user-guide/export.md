# Export and Delivery

Export writes the full-resolution HDR and SDR grades through a format-specific backend. Preview proxies do not reduce export resolution.

## Preflight

Before exporting, confirm:

- **Source interpretation:** primaries and transfer are confirmed or deliberately accepted.
- **HDR branch ready:** highlights, color, and scope placement have been reviewed.
- **SDR fallback reviewed:** the base image works on its own.
- **Encoder available:** the selected backend reports available.
- **Chrome proof reviewed:** the proof matches the selected format and is not stale.

Preflight cannot determine whether the image is artistically good or whether a future website will preserve the bytes.

## Format and preset menus

Choose the output **Format**, then choose **Web Default**, **Web Optimized**, or **Maximum Fidelity** immediately below it. Switching format applies the same preset tier to every applicable control, so settings from the previous codec cannot leak into the new export. A manual encoding, metadata, dithering, resizing, or sharpening change switches the preset to **Custom**. Selecting a built-in preset again restores its complete mapping.

Advanced Export Settings starts collapsed and remains keyboard-operable. Within each submenu, the choice used by that format's Web Default carries the suffix **· Web Default**. Options that are not defaults are intentionally unlabeled.

All built-ins use original cropped dimensions, prevent enlargement, and leave output sharpening off. Format-specific mappings are:

| Format | Web Default | Web Optimized | Maximum Fidelity |
|---|---|---|---|
| AVIF + gain map | Q85; 10-bit 4:2:0 primary; 10-bit 4:4:4 gain map Q85/full; metadata unavailable | Q75; 10-bit 4:2:0 primary; 10-bit 4:2:2 gain map Q70/half | Q100; 12-bit 4:4:4 primary; 10-bit 4:4:4 gain map Q100/full |
| JPEG Ultra HDR | Primary Q85 4:2:0; gain map Q90/full; Auto dither; copyright | Primary Q75 4:2:0; gain map Q80/half; Auto; no source metadata | Primary/gain Q100; 4:4:4; full; dither off; all except location |
| JPEG XL HDR | Q90; 12-bit integer; copyright | Q80; 10-bit integer; no source metadata | Q100; 16-bit integer; all except location |
| JPEG XL (SDR) | Q90; Auto dither; copyright | Q80; Auto; no source metadata | Q100; Subtle dither; all except location |
| PNG (SDR) | 8-bit; Auto dither; copyright | 8-bit; Auto; no source metadata | 16-bit; dither off; all except location |
| JPEG (SDR) | Q85; 4:2:0; Auto dither; copyright | Q75; 4:2:0; Auto; no source metadata | Q100; 4:4:4; Subtle dither; all except location |

## JPEG Ultra HDR

**Best for:** a file that remains an ordinary JPEG in legacy software while revealing HDR in compatible viewers.

The export contains:

- An 8-bit sRGB SDR primary JPEG
- An 8-bit logarithmic gain-map JPEG
- Ultra HDR v1 XMP metadata
- ISO 21496-1 metadata
- An authored BT.2020 linear HDR alternate used by the encoder

HDR Finisher validates that the output contains both metadata schemes and decodes with libultrahdr before accepting it.

### Controls

- **Quality:** primary JPEG quality.
- **Gain-map Quality:** compression quality for the embedded gain map. Keep high for gradients, fine bright edges, and colored highlights.
- **Gain-map Resolution:** Full preserves maximum spatial fidelity; Half reduces size but can soften or halo gain transitions.

JPEG recompression, metadata stripping, or image transformation can remove HDR while leaving the SDR image apparently valid. Treat social and hosting services as active processors until proven otherwise.

## AVIF + gain map

**Best for:** efficient web delivery and the currently validated Chromium gain-map path.

The export uses:

- sRGB SDR base signaling
- A BT.2020/PQ alternate image at the selected precision
- A separate 10-bit logarithmic gain map with selectable 4:2:0, 4:2:2, or 4:4:4 chroma
- ISO 21496-1-compatible gain-map metadata via the AVIF tooling

The primary **Quality** control is separate from **Gain-map Quality** and **Gain-map Resolution**. **Bit Depth** offers 8-bit, 10-bit, and 12-bit primary output. Primary **Chroma Subsampling** and **Gain-map Chroma** are independent. HDR Finisher validates the selected primary depth/chroma and the gain-map chroma before moving the staged file into place.

The built-in delivery pattern showed that a 4:2:0 gain map raised colored-edge MAE by about 70% versus 4:4:4 and did not reduce file size in that sample. A monochrome gain map was about 14% smaller but produced severe saturated chromatic-highlight errors. Therefore Web Default retains 4:4:4; Web Optimized uses 4:2:2 plus lower quality/half resolution; 4:0:0 is not exposed. Bundled libavif and Edge 151 decoded all tested chroma modes, but headless decode does not replace physical HDR-display review. See [AVIF Gain-map Chroma Validation](../testing/AVIF_Gain_Map_Chroma_Validation_2026-08-21.md).

The current AVIF gain-map combiner cannot preserve arbitrary source EXIF, so Source Metadata is disabled for this format. Required color and gain-map signaling is always written.

AVIF gain-map support is not universal. An unsupported decoder may show the SDR base, fail, or use a platform-specific fallback.

## JPEG XL HDR

**Best for:** direct-HDR interchange with compatible editors, archives, or specialist pipelines. JPEG XL has no embedded SDR fallback, so it is not the default choice for ordinary web publishing.

HDR Finisher writes Rec.2020/PQ and preserves the selected sample representation through a decode-and-inspect validation pass. **12-bit integer** is the recommended default. The Precision menu also offers **10-bit integer**, **16-bit integer**, **16-bit float**, and **32-bit float** for workflows that specifically require them. The two float modes retain floating-point PQ code values; they do not change the automatic Rec.2020/PQ color handling. An 8-bit JPEG XL mode is intentionally not offered.

Choose 10-bit when compatibility or size matters most, 16-bit integer for unusually quantization-sensitive integer interchange, and float only when the receiving pipeline explicitly benefits from it. Higher precision does not make a lossy quality setting lossless and can increase file size and compatibility risk.

## PNG (SDR)

Writes the authored SDR rendition as an sRGB PNG with no HDR or gain map. **8-bit** is the web default; **16-bit** is available for high-precision interchange. Quality is disabled because PNG compression is lossless. Use it to:

- Deliver an explicit legacy version
- Compare the SDR authoring result outside the application
- Diagnose whether a gain-map viewer is falling back correctly
- Supply services that do not preserve adaptive HDR

## JPEG (SDR)

Writes the same authored SDR rendition as a conventional 8-bit sRGB JPEG with no HDR or gain map. The Quality control sets JPEG compression quality. Chroma Subsampling offers **4:2:0** (default, smallest, suitable for most photographs), **4:2:2** (more horizontal color detail), and **4:4:4** (full color resolution for fine colored edges and text). This is the compact SDR option for ordinary delivery and very wide line-scan images.

The JPEG bitstream can represent dimensions up to 65,535 pixels, but the bundled Pillow/libjpeg-turbo encoder uses a safety limit of **65,500 pixels** on either axis. If the finished crop exceeds that limit, resize it to 65,500 pixels or use SDR PNG.

## JPEG XL (SDR)

Writes the authored SDR rendition as conventional **8-bit sRGB JPEG XL**, with no HDR rendition and no gain map. Quality controls JPEG XL compression; Quality 100 requests lossless coding of the quantized 8-bit result. Choose it only when the receiving editor, archive, or delivery system explicitly supports JPEG XL. It is not the default web-publishing choice because browser and service support remains uneven.

## Dithering and source metadata

**Dithering** offers Auto, Off, and Subtle for final 8-bit outputs. Auto uses a deterministic one-LSB signal-domain dither; Subtle uses half that amplitude. The control is disabled for higher-bit-depth and floating-point outputs.

**Source Metadata** offers None, Copyright only, All except location, and All including location. Web Default preserves copyright where supported; Web Optimized carries no source metadata; Maximum Fidelity carries everything except location. Color, HDR, and gain-map signaling is technical output metadata and is never removed by this choice. Source metadata support depends on the selected encoder; the UI disables the control where the current backend cannot carry it.

## Filename and destination

HDR Finisher sanitizes the filename, adds the appropriate extension, and asks before overwriting an existing file. **Browse** opens a native folder chooser and writes the selected directory into Destination. It stages complex gain-map exports and only replaces the destination after validation, reducing the chance of leaving a partial file.

In source-run builds, Browse opens an in-app directory browser that shows folders and files, permits navigation through folders, and returns the selected writable directory to the export form. Files are shown only as location context and cannot be selected. You can also type a valid destination path directly. The installed desktop build's native picker remains an installer acceptance item.

Full-resolution HDR and SDR rendering, gain-map encoding, and validation can take materially longer than preview generation, especially for large sources. The Export status reports the active stage and elapsed time while work is in progress. A completed export is reported only after the staged artifact passes format validation and is moved into place.

## Color and luminance encoding

### HDR

The working ACEScg image is converted to linear BT.2020. The application maps `0.18` to 100 nits and encodes PQ up to 10,000 nits for AVIF and preview transport.

For libultrahdr’s linear HDR input, the same absolute intent is rescaled because libultrahdr defines linear `1.0` as 203 nits. This is an encoder-interface conversion, not a change to the authoring reference.

### SDR

The authored display-linear sRGB rendition is clipped/compressed to gamut as needed, sRGB encoded, quantized to 8 bits, and written as the base.

## Validate the local file

1. Open the file in a current supported Chromium browser on the HDR display.
2. Compare highlight hierarchy and color with Chrome Proof.
3. Move/reopen it on an SDR display and compare with the authored SDR branch or SDR PNG.
4. Check that the file reports a gain map using the repository inspection tools.
5. For JPEG, confirm an ordinary image viewer can still open the SDR primary.

Do not expect exact brightness identity between the authoring canvas and browser. Gain maps are display-adaptive and the browser may perform additional display mapping.

## Validate publication

The file you uploaded is not necessarily the file a service delivers. A CDN or social platform may resize, recompress, convert, or strip metadata.

Use the hosting probe from `codebase/`:

```powershell
$env:PYTHONPATH = "backend"
python .\tools\verify_hosted_gainmap.py .\output\image.jpg https://example.com/image.jpg
```

The report compares hashes, MIME type, caching headers, format signatures, gain-map presence, and metadata survival. Also inspect the delivered URL visually on the intended device.

## Choosing a format

| Need | Start with |
|---|---|
| Legacy JPEG compatibility matters most | JPEG Ultra HDR |
| Efficient Chromium-focused web delivery | AVIF + gain map |
| Compact or very wide SDR delivery | JPEG (SDR) |
| SDR delivery to a JPEG XL-aware workflow | JPEG XL (SDR) |
| Lossless explicit SDR fallback | PNG (SDR) |
| Specialist direct-HDR interchange | JPEG XL HDR (12-bit integer by default) |
| A platform/service with unknown gain-map support | Export and test both JPEG Ultra HDR and an explicit SDR alternative |

## Watch out for

- Lowering gain-map quality to solve a file-size problem without checking edges and gradients
- Assuming a `.jpg` extension means a service will preserve Ultra HDR metadata
- Wrong MIME type from a server
- Reviewing only the local file
- Overwriting a known-good delivery without retaining evidence
- Calling a successful encode “ISO-compliant” beyond what the application actually validates
