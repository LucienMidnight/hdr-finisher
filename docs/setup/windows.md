# Windows Settings for HDR Finisher

**Status:** Windows 11 with current Chrome/Edge/Brave is the primary validated environment. Windows 10 may expose similar HDR controls, but the application’s physical display and browser proofing work is centered on Windows 11.

Guidance verified against Microsoft documentation on **August 9, 2026**.

## Recommended baseline

1. Connect the display with a cable, port, resolution, refresh rate, and bit depth that support HDR.
2. Open **Settings > System > Display**, select the display, open **HDR**, and enable **Use HDR**.
3. Install current GPU drivers.
4. Run the Windows HDR Calibration app if the display supports HDR apps and games.
5. Keep the calibration app’s color-saturation customization at its neutral/default position for color-critical work.
6. Set **SDR content brightness** deliberately rather than compensating with the HDR grade.
7. Disable Night light and content-adaptive brightness while making repeatable judgments.
8. Restart the browser after material HDR, profile, or SDR-brightness changes.

Microsoft’s current instructions are available in [HDR settings in Windows](https://support.microsoft.com/en-us/windows/2d767185-38ec-7fdc-6f97-bbc6c5ef24e6), [Windows HDR Calibration](https://support.microsoft.com/en-gb/windows/calibrate-your-hdr-display-using-the-windows-hdr-calibration-app-f30f4809-3369-43e4-9b02-9eabebd23f19), and [display brightness and color](https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-display-brightness-and-color-in-windows).

## SDR content brightness is part of HDR headroom

Windows must decide how bright ordinary SDR white appears while HDR mode is active. HDR Finisher reads that SDR-white level where Windows exposes it and compares it with the display’s reported maximum luminance.

In simplified terms:

```text
nominal headroom in stops = log2(display maximum luminance / Windows SDR white)
```

If SDR white is 100 nits and the display maximum is 1,000 nits, nominal headroom is about 3.32 stops. Raising SDR content brightness makes the desktop easier to see in a bright room, but leaves less relative room above diffuse white for HDR highlights. Lowering it increases the ratio, but can make SDR applications uncomfortably dim.

Use a stable value that suits the viewing environment, then keep it fixed while grading and proofing. Do not chase a desired proof result by repeatedly changing the Windows slider.

## Windows HDR Calibration

The calibration app records the display’s darkest visible detail, brightest visible detail, and maximum brightness in a color profile. Run it in the monitor mode you will actually use.

Watch out for:

- Entering a peak much higher than the display can reproduce. That encourages Windows to send values the display will tone-map or clip.
- Adding saturation in the calibration app. This is a preference control, not a substitute for an accurate gamut or profile.
- Calibrating one monitor mode and grading in another.
- Letting the monitor’s local dimming, brightness, or HDR mode change after calibration.

## Settings to disable for repeatable color work

- **Night light:** changes display white and color balance.
- **Change brightness based on content:** can alter brightness and contrast as the image changes. Microsoft specifically notes that color-critical photo and video work may benefit from disabling it.
- **Automatic ambient brightness:** disable during controlled review if the device allows it.
- **Battery saver or automatic HDR-on-power behavior:** a laptop may disable or reduce HDR when unplugged.
- GPU-driver “vivid,” enhancement, or dynamic-range filters.

These features can be useful in daily computing. The point is to remove moving variables during a grading session, not to leave them disabled forever.

## Multiple displays

Select the actual HDR display in Windows before changing HDR settings. Keep the HDR Finisher browser window entirely on that display during visual judgment. A browser may recreate or tone-map its output when a window moves between HDR and SDR displays.

After moving the window:

1. Wait for the display and browser to settle.
2. Rebuild Chrome Proof if its selected display or target changed.
3. Reload the final exported image when validating native rendering.

The application’s **Active display** list uses Windows QueryDisplayConfig and DXGI 1.6. Reported maximum luminance is display/driver telemetry, not a fresh meter reading and not proof of certification.

## Connection and signal checks

If HDR is missing or color is visibly wrong:

- Confirm the display is HDR-capable in Windows.
- Check that the selected resolution and refresh rate fit the connection bandwidth.
- Prefer a certified DisplayPort or HDMI cable appropriate for the mode.
- Verify that the GPU is not outputting an unintended limited range or reduced chroma mode.
- Try a lower refresh rate as a diagnostic if the full resolution/refresh combination prevents HDR or high bit depth.
- Check the monitor menu for per-input HDR and bandwidth settings.

## What HDR Finisher can read

On Windows, the application attempts to report:

- HDR/advanced-color state
- color depth and color encoding where exposed
- Windows SDR white and its approximate nit value
- DXGI minimum, maximum, and full-frame luminance
- nominal headroom derived from SDR white and maximum luminance

Telemetry helps choose a proof target; it does not measure current panel output, room light, automatic brightness limiting, local-dimming behavior, or calibration accuracy.
