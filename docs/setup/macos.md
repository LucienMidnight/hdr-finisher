# macOS Settings for HDR Finisher

**Status:** Running from source is expected on a compatible Python/macOS environment. The repository does not yet contain a packaged macOS build, native macOS display telemetry, or a complete physical browser/display validation record. Treat macOS HDR conclusions as unverified until checked on the exact Mac, browser, and display.

Guidance verified against Apple documentation on **August 9, 2026**.

## Before running

- Use a current macOS release supported by the Mac and browser.
- Confirm the built-in or external display supports HDR10-class output.
- For external displays, use a cable, adapter, port, resolution, and refresh rate that preserve HDR support.
- Install Python 3.12+ and follow [Install and run](../getting-started/install-and-run.md).
- Ensure Python includes Tk support if you want the native export-folder picker.

Apple’s current general requirements are described in [Play HDR video on Mac](https://support.apple.com/en-ie/102205) and [connect external displays](https://support.apple.com/guide/mac-help/connect-an-external-display-mchl7c7ebe08/26/mac/26).

## Recommended viewing baseline

1. Open **System Settings > Displays** and select the display.
2. Choose an HDR-capable preset or mode appropriate to the hardware.
3. Disable **True Tone** and **Night Shift** for repeatable color judgment.
4. Disable automatic brightness during a controlled session when the selected mode permits it.
5. Use a stable physical brightness or reference-mode setting.
6. Keep the browser window fully on the selected HDR display.

True Tone intentionally adapts color to ambient light, while Night Shift makes the display warmer. Both are valuable viewing features but make a fixed D65-oriented judgment impossible. Apple documents them in [Use True Tone on Mac](https://support.apple.com/en-ae/102147) and [Use Night Shift on your Mac](https://support.apple.com/en-gb/102191).

## Apple XDR displays and reference modes

Apple displays that offer presets/reference modes may include general-use XDR presets and **HDR Video (P3-ST 2084)**. Apple describes HDR Video as a controlled-environment production preset using P3 primaries and the ST 2084/PQ EOTF, intended for work up to 1,000 nits sustained full-screen on supported hardware.

For ordinary browser delivery review, begin with the normal XDR/general-use preset because that resembles how owners commonly view the web. For a controlled, repeatable PQ comparison, also inspect the HDR Video reference mode if the display provides it. Do not assume the two modes should be brightness-identical: the general-use preset can adapt to environment and system presentation behavior, while a reference mode is deliberately constrained.

See Apple’s [display preset reference](https://support.apple.com/en-gb/guide/mac-help/mchld7ad475f/mac).

## PQ versus HLG

HDR Finisher’s live HDR preview and exported alternate rendition use BT.2020/PQ. If a display menu requires an explicit transfer choice for this path, use **PQ**, **ST 2084**, or **HDR10**, not HLG.

HLG is a different HDR transfer system intended largely for broadcast compatibility. It is a valid supported input interpretation, but it is normalized into the application’s internal working representation and is not the export-display mode.

## Browser validation

The repository’s automated proofing and physical evidence are Chromium-focused on Windows. On macOS:

- Test the current Chrome/Chromium browser first for parity with the validated application path.
- Treat Safari behavior as a separate delivery target, not as proof that Chrome will match.
- Verify each exported format directly; browser support and gain-map behavior can differ by version.
- Compare the exported file on both HDR and SDR displays or devices.

The deterministic Chrome Proof remains useful on macOS, but **Auto** cannot use native macOS display telemetry. Select a fixed target such as 400, 500, 600, or 1,000 nits based on the display’s credible capability.

## Current macOS gaps

- No signed or notarized application package
- No native reading of SDR white, EDR headroom, or display luminance
- No repository-backed validation of the Tk folder picker on current macOS
- No maintained browser/version acceptance matrix
- No assurance that all bundled Windows encoder binaries have macOS equivalents present

These are product-status limitations, not evidence that macOS cannot display or process HDR. They mean the user must validate more of the chain manually.
