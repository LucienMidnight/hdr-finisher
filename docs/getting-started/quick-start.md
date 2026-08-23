# Five-Minute Quick Start

This path gets a prepared HDR source to a gain-map export. It assumes the application is already running and that your image has been developed or rendered before import.

## 1. Prepare the display

On an HDR display, enable HDR in the operating system and use an accurate HDR monitor mode. Turn off Night Light/Night Shift, True Tone, content-adaptive brightness, vivid color, and dynamic contrast while judging color. New projects use a 203-nit HDR Reference White; use the [reference-white guide](../user-guide/hdr-reference-white.md) before deliberately selecting 100 nits. See [Windows](../setup/windows.md), [macOS](../setup/macos.md), and [monitor setup](../setup/monitors.md).

On an SDR display, continue normally, but use the scopes for HDR placement and understand that you cannot visually certify peak highlights. You can still author the SDR rendition accurately.

## 2. Import a prepared source

Choose **Import > Choose image**. The best general handoff is a full-resolution, losslessly compressed, single-layer, 32-bit float OpenEXR with known linear primaries.

After import, inspect the badge and Metadata rail:

- **Confirmed** means the app found a supported, unambiguous interpretation.
- **Review** means primaries or transfer metadata are missing, ambiguous, or conflicting.
- **SDR** means the app found no reliable HDR headroom or HDR transfer metadata.

If review is required, do not pick the option that merely looks nicest. Match the exact color space and transfer function used by the source application. See [Import and source interpretation](../user-guide/import.md).

## 3. Grade the HDR rendition

Open **Grade > HDR Controls**.

A safe order is:

1. **Exposure** for overall placement.
2. **Highlight Compression** if bright detail is too abrupt: choose where it starts, the intended peak, and how softly highlights approach it.
3. **Exposure Bands** for brightness-specific corrections.
4. **Temperature, Tint, Saturation, and Vibrance** for broad color work.
5. **Lift, Gamma, Gain** or **Curves** for targeted finishing.

Use the HDR waveform or histogram. The app labels the active project reference and retains fixed 100- and 203-nit guides; these are signal measurements, not a claim about emitted monitor luminance.

## 4. Author the SDR fallback

Switch to **SDR Controls**. This image is what a legacy JPEG viewer, a non-HDR context, or a failed gain-map delivery will show.

Start with **Filmic**. Adjust Base Rendition contrast/skew, Exposure, Highlight Recovery, and Shadow until the image works as an ordinary SDR photograph. Use **Match HDR colors** to copy the current HDR color settings into SDR, then refine the SDR color controls independently if needed.

Do not treat the SDR version as an unimportant thumbnail. In a gain-map file it is the base image and often the most widely viewed rendition.

## 5. Proof the delivery

Open **Proof**, enable **Show Chrome proof**, select the export format, and choose a target display peak. Start at **1,000 nits** for a general web-HDR check, then inspect a lower target such as 400 or 500 nits.

Chrome Proof is a deterministic reconstruction of the encoded endpoints. It is not a promise that every browser and display will look identical. See [Proofing](../user-guide/proof.md).

## 6. Export

Open **Export** and review preflight:

- Source interpretation is accepted.
- HDR and SDR branches have been reviewed.
- The required encoder is available.
- The selected proof is current.

Choose:

- **JPEG Ultra HDR** when ordinary JPEG compatibility is the priority. Legacy software sees the authored SDR image, while compatible HDR viewers apply the gain map. Its base and gain map are both 8-bit JPEG data, so it is more vulnerable to compression artifacts and banding than the higher-precision AVIF path; the reconstructed HDR result is not simply an “8-bit HDR image.”
- **AVIF + gain map** for the best balance of compression efficiency, gain-map precision, and the currently validated Chromium delivery path. HDR Finisher supports an 8-, 10-, or 12-bit primary plus a 10-bit gain map, but AVIF gain-map decoding and metadata survival are less universal than ordinary JPEG.
- **JPEG XL HDR** for preserving a direct, high-bit-depth HDR rendition or for exceptionally large images. It supports 10- and 12-bit integer, 16-bit integer/float, and 32-bit float output in HDR Finisher, but it has no gain map or authored SDR fallback. Non-HDR presentation therefore depends on the receiving viewer's tone mapping, and browser/viewer support remains uneven.
- **JPEG (SDR)** for the smallest, most broadly compatible standalone SDR rendition. It is 8-bit and lossy, with no HDR data.
- **PNG (SDR)** for a lossless standalone SDR fallback, comparison file, or higher-precision 16-bit interchange. Files are usually much larger than JPEG.
- **JPEG XL (SDR)** for compact SDR interchange when the receiving application explicitly supports JPEG XL. It carries no HDR rendition and is not a dependable general-web fallback.

After export, open the result in its intended browser or service. Moving the same browser window between HDR and SDR displays is a useful fallback check. Hosting services may recompress the file and remove its gain map, so validate the delivered URL when publication matters.

## Three rules that prevent most failures

1. Never guess source primaries.
2. Always review both HDR and SDR renditions.
3. Treat the final browser/service/display combination as part of the delivery pipeline.
