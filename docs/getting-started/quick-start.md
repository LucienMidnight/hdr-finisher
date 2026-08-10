# Five-Minute Quick Start

This path gets a prepared HDR source to a gain-map export. It assumes the application is already running and that your image has been developed or rendered before import.

## 1. Prepare the display

On an HDR display, enable HDR in the operating system and use an accurate HDR monitor mode. Turn off Night Light/Night Shift, True Tone, content-adaptive brightness, vivid color, and dynamic contrast while judging color. See [Windows](../setup/windows.md), [macOS](../setup/macos.md), and [monitor setup](../setup/monitors.md).

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
2. **Highlight Rolloff** and **Rolloff Start** if bright detail is too abrupt.
3. **Exposure Bands** for brightness-specific corrections.
4. **Temperature, Tint, Saturation, and Vibrance** for broad color work.
5. **Lift, Gamma, Gain** or **Curves** for targeted finishing.

Use the HDR waveform or histogram. The app defines 100 nits as diffuse white and labels the HDR scope in reference nits.

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

- **JPEG Ultra HDR** for broad JPEG fallback behavior and compatible HDR viewers.
- **AVIF + gain map** for high compression efficiency and validated Chromium delivery.
- **PNG (SDR)** for a standalone fallback or comparison file.

After export, open the result in its intended browser or service. Moving the same browser window between HDR and SDR displays is a useful fallback check. Hosting services may recompress the file and remove its gain map, so validate the delivered URL when publication matters.

## Three rules that prevent most failures

1. Never guess source primaries.
2. Always review both HDR and SDR renditions.
3. Treat the final browser/service/display combination as part of the delivery pipeline.
