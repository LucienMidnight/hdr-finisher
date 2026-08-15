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
- A 10-bit, 4:4:4 BT.2020/PQ alternate image
- A 10-bit logarithmic gain map
- ISO 21496-1-compatible gain-map metadata via the AVIF tooling

The Quality control is applied to the AVIF alternate, gain map, and combined output path. HDR Finisher validates that the resulting AVIF reports an embedded gain map before moving the staged file into place.

AVIF gain-map support is not universal. An unsupported decoder may show the SDR base, fail, or use a platform-specific fallback.

## PNG (SDR)

Writes the authored SDR rendition as an 8-bit sRGB PNG with no HDR or gain map. Use it to:

- Deliver an explicit legacy version
- Compare the SDR authoring result outside the application
- Diagnose whether a gain-map viewer is falling back correctly
- Supply services that do not preserve adaptive HDR

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
| Explicit universal SDR fallback | PNG (SDR) |
| A platform/service with unknown gain-map support | Export and test both JPEG Ultra HDR and an explicit SDR alternative |

## Watch out for

- Lowering gain-map quality to solve a file-size problem without checking edges and gradients
- Assuming a `.jpg` extension means a service will preserve Ultra HDR metadata
- Wrong MIME type from a server
- Reviewing only the local file
- Overwriting a known-good delivery without retaining evidence
- Calling a successful encode “ISO-compliant” beyond what the application actually validates
