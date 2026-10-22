# Five-Minute Quick Start

This path takes a photo from the Library to a gain-map export. It works for a camera RAW, a finished HDR file from another editor, or a scene-linear render. It assumes the application is already running.

## 1. Prepare the display

On an HDR display, enable HDR in the operating system and use an accurate HDR monitor mode. Turn off Night Light/Night Shift, True Tone, content-adaptive brightness, vivid color, and dynamic contrast while judging color. New projects use a 203-nit HDR Reference White; use the [reference-white guide](../user-guide/hdr-reference-white.md) before deliberately selecting 100 nits. See [Windows](../setup/windows.md), [macOS](../setup/macos.md), and [monitor setup](../setup/monitors.md).

On an SDR display, continue normally, but use the scopes for HDR placement and understand that you cannot visually certify peak highlights. You can still author the SDR rendition accurately.

## 2. Open a photo

The app opens on the **Library**. Choose **Pin folder** and pick a folder of photos. Browse the grid, then double-click a photo to open it in **Grade**. See the [Photo Library guide](../user-guide/library.md) for rating, albums and copying grades. Its grade is saved automatically in a small `.hdrf` file beside the photo; the original is never changed.

To work on a single file without the Library, choose **Choose image**.

- **Camera RAW** opens straight into an HDR grade, with white balance, highlight reconstruction and lens correction applied. Exposure starts at zero.
- **HDR files** (OpenEXR, HDR TIFF, AVIF, Ultra HDR JPEG, HEIC, JPEG XL) show a badge after opening:
  - **Confirmed** means the app found a supported, unambiguous interpretation.
  - **Review** means primaries or transfer metadata are missing, ambiguous, or conflicting.
  - **SDR** means the app found no reliable HDR headroom or HDR transfer metadata.

If review is required, do not pick the option that merely looks nicest. Match the exact color space and transfer function used by the source application. See [Import and source interpretation](../user-guide/import.md). The best handoff from another editor or a 3D renderer is a full-resolution, losslessly compressed, single-layer, 32-bit float OpenEXR with known linear primaries.

## 3. Grade the HDR rendition

Open **Grade > HDR Controls**.

A safe order is:

1. **Exposure** for overall placement.
2. **Highlight Compression** if bright detail is too abrupt: choose where it starts, the intended peak, and how softly highlights approach it.
3. **Exposure Bands** for brightness-specific corrections.
4. **Temperature, Tint, Saturation, and Vibrance** for broad color work.
5. **Curves** or **Color Grading** for targeted finishing.

Then, as the photo needs: **Detail**, **Denoise**, **Black & White**, **Film Look**, and local adjustments for selective changes with brush, gradient, luminance-range, or path masks.

Use the HDR waveform or histogram. The app labels the active project reference and retains fixed 100- and 203-nit guides; these are signal measurements, not a claim about emitted monitor luminance.

## 4. Author the SDR fallback

Switch to **SDR Controls**. This image is what a legacy JPEG viewer, a non-HDR context, or a failed gain-map delivery will show.

**Match entire HDR grade** is a quick start: it builds an SDR base from your whole HDR grade, including local adjustments and Film Look, and leaves the SDR controls free as trims. Or grade the SDR side yourself: adjust Exposure and Shadow until the subject reads naturally, then use **Highlight Compression** to shape the bright end.

Do not treat the SDR version as an unimportant thumbnail. In a gain-map file it is the base image and often the most widely viewed rendition.

## 5. Proof the delivery

Open **Proof**, enable **Show Chromium proof**, select the export format, and choose a target display peak. Start at **1,000 nits** for a general web-HDR check, then inspect a lower target such as 400 or 500 nits.

Proof encodes the real export file and shows how it reconstructs at that display headroom. It is not a promise that every browser and display will look identical. See [Proofing](../user-guide/proof.md).

## 6. Export

Open **Export**, choose the format and preset, then select the destination. Proofing is optional. To export several photos, select them in the Library and choose **Quick export…** (Ctrl+Shift+E) with an export preset saved on the Export page; the batch runs in the background and the Library marks photos edited since their last export.

Choose:

- **JPEG Ultra HDR** when ordinary JPEG compatibility is the priority. Legacy software sees the authored SDR image, while compatible HDR viewers apply the gain map. Its base and gain map are both 8-bit JPEG data, so it is more vulnerable to compression artifacts and banding than the higher-precision AVIF path; the reconstructed HDR result is not simply an “8-bit HDR image.”
- **AVIF + gain map** for the best balance of compression efficiency, gain-map precision, and the currently validated Chromium delivery path. HDR Finisher supports an 8-, 10-, or 12-bit primary plus a 10-bit gain map, but AVIF gain-map decoding and metadata survival are less universal than ordinary JPEG.
- **JPEG XL HDR** for preserving a direct, high-bit-depth HDR rendition or for exceptionally large images. It supports 10- and 12-bit integer, 16-bit integer/float, and 32-bit float output in HDR Finisher, but it has no gain map or authored SDR fallback. Non-HDR presentation therefore depends on the receiving viewer's tone mapping, and browser/viewer support remains uneven.
- **JPEG (SDR)** for the smallest, most broadly compatible standalone SDR rendition. It is 8-bit and lossy, with no HDR data.
- **PNG (SDR)** for a lossless standalone SDR fallback, comparison file, or higher-precision 16-bit interchange. Files are usually much larger than JPEG.
- **JPEG XL (SDR)** for compact SDR interchange when the receiving application explicitly supports JPEG XL. It carries no HDR rendition and is not a dependable general-web fallback.

A preset can write several versions of each photo in one run, for example an HDR AVIF and an SDR JPEG. See [Export and delivery](../user-guide/export.md).

After export, open the result in its intended browser or service. Moving the same browser window between HDR and SDR displays is a useful fallback check. Hosting services may recompress the file and remove its gain map, so validate the delivered URL when publication matters.

## Three rules that prevent most failures

1. Never guess source primaries.
2. Always review both HDR and SDR renditions.
3. Treat the final browser/service/display combination as part of the delivery pipeline.
