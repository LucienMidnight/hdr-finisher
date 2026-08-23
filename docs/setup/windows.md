# Windows Settings for HDR Finisher

**Status:** Windows 11 with current Chrome/Edge/Brave is the primary validated environment. Windows 10 may expose similar HDR controls, but the application’s physical display and browser proofing work is centered on Windows 11.

Guidance verified against Microsoft documentation, Chromium source, and local Windows telemetry on **August 22, 2026**.

## Recommended baseline

1. Connect the display with a cable, port, resolution, refresh rate, and bit depth that support HDR.
2. Open **Settings > System > Display**, select the display, open **HDR**, and enable **Use HDR**.
3. Install current GPU drivers.
4. Run the Windows HDR Calibration app if the display supports HDR apps and games.
5. Keep the calibration app’s color-saturation customization at its neutral/default position for color-critical work.
6. On an external HDR display, set **SDR content brightness** to **30 or 31**. On current Windows 11 builds this corresponds to approximately **200–204 nits**, closely matching HDR Finisher's 203-nit HDR Reference White.
7. Disable Night light and content-adaptive brightness while making repeatable judgments.
8. Fully restart HDR Finisher after material HDR, profile, monitor-mode, or SDR-brightness changes so Chromium recreates its HDR compositor and WebGPU canvas.

Microsoft’s current instructions are available in [HDR settings in Windows](https://support.microsoft.com/en-us/windows/2d767185-38ec-7fdc-6f97-bbc6c5ef24e6), [Windows HDR Calibration](https://support.microsoft.com/en-gb/windows/calibrate-your-hdr-display-using-the-windows-hdr-calibration-app-f30f4809-3369-43e4-9b02-9eabebd23f19), and [display brightness and color](https://support.microsoft.com/en-us/windows/hardware/display-graphics/change-display-brightness-and-color-in-windows).

## Use slider position 30 or 31 for a 203-nit project

For the **SDR content brightness** control shown for an external HDR display, current Windows 11 behavior is:

```text
Windows SDR white in nits = 80 + (4 × slider position)
```

The control runs from 0 through 100. It is not a conventional percentage even though Windows presents it as a unitless 0–100 slider.

| Slider position | Windows SDR white |
|---:|---:|
| 0 | 80 nits |
| 5 | 100 nits |
| 25 | 180 nits |
| **30** | **200 nits** |
| **31** | **204 nits** |
| 50 | 280 nits |
| 100 | 480 nits |

An exact 203-nit value is not available on this whole-number slider. Position **31** is mathematically closest, while position **30** is equally practical for visual work. HDR Finisher therefore recommends **30 or 31**, producing approximately **200–204 nits**. Position 25 is approximately 180 nits, not approximately 200 nits.

To set it:

1. Open **Settings > System > Display**.
2. Select the external HDR display actually used for HDR Finisher.
3. Open **HDR** and turn on **Use HDR**.
4. Set **SDR content brightness** to **30 or 31**.
5. Fully restart HDR Finisher.
6. In HDR Finisher's active-display telemetry, confirm that **Windows SDR white** reports approximately **200–204 nits**. If it does not, trust the reported nit value and adjust the slider until it does.

Microsoft documents how applications read the resulting SDR-white value through [`DISPLAYCONFIG_SDR_WHITE_LEVEL`](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-displayconfig_sdr_white_level), including its conversion from an 80-nit multiplier, but does not document the Settings slider's numeric mapping. The `80 + 4 × position` mapping was cross-checked on the current validation system: its native telemetry reports 180.0 nits, exactly the formula's result for position 25, on Windows 11 build 26200. Treat HDR Finisher's native nit readback as authoritative if a future Windows build, display type, or driver behaves differently.

> **Built-in-display exception:** Do not apply the 30/31 formula to a laptop's **HDR content brightness** control. Microsoft defines that control differently: built-in panel brightness governs SDR while HDR content brightness changes HDR relative to SDR. Use a stable brightness, disable automatic brightness for controlled review, and record both settings.

## Why this setting directly affects Chromium and HDR Finisher

HDR Finisher's desktop application uses Chromium's HDR compositor and an extended floating-point WebGPU canvas. This makes Windows SDR white a rendering input, not merely a desktop-comfort preference.

On Windows, Chromium:

1. Reads `DISPLAYCONFIG_SDR_WHITE_LEVEL` from the selected display.
2. Stores it as the display's SDR maximum luminance.
3. Calculates relative HDR headroom from display maximum luminance divided by Windows SDR white.
4. Uses that display state when configuring its HDR/scRGB compositor and presenting extended canvas content.

Chromium's implementation is visible in its [Windows SDR-white query](https://chromium.googlesource.com/chromium/src/+/master/ui/display/win/screen_win.cc#131), [SDR-luminance and HDR-headroom configuration](https://chromium.googlesource.com/chromium/src/+/master/ui/display/win/screen_win.cc#205), and [FP16 scRGB HDR-output selection](https://chromium.googlesource.com/chromium/src/+/master/ui/display/win/screen_win.cc#238). Chromium also uses 203 nits as its default SDR-white convention for color transforms that do not specify another reference, including canvas-related cases, in [`ui/gfx/color_space.h`](https://chromium.googlesource.com/chromium/src/+/HEAD/ui/gfx/color_space.h).

HDR Finisher configures its live HDR preview as an extended `rgba16float` Display-P3 WebGPU canvas. Matching Windows SDR white to approximately 203 nits therefore aligns three distinct but interacting values:

- HDR Finisher project HDR Reference White: 203 nits
- Chromium's nominal canvas/reference convention: 203 nits
- Windows-reported SDR white used by Chromium: approximately 200–204 nits at slider 30 or 31

Changing the slider does **not** modify project pixels, project settings, exported pixels, or export metadata. It **can** materially alter the live presentation: SDR UI brightness, the relationship between UI white and image reference white, Chromium's available relative headroom, gain-map adaptation, compositor tone mapping, and highlight presentation. Never compensate for the wrong Windows setting by changing the HDR grade.

## SDR content brightness is part of HDR headroom

Windows must decide how bright ordinary SDR white appears while HDR mode is active. HDR Finisher reads that SDR-white level and compares it with the display's reported maximum luminance.

In simplified terms:

```text
nominal headroom in stops = log2(display maximum luminance / Windows SDR white)
```

If SDR white is 100 nits and the display maximum is 1,000 nits, Chromium-relative nominal headroom is about 3.32 stops. At the recommended 200–204-nit setting it is about 2.30–2.32 stops. Raising SDR content brightness makes the desktop easier to see in a bright room, but leaves less relative room above SDR white for HDR highlights. Lowering it increases that ratio, but can make SDR applications uncomfortably dim and creates a mismatch with a 203-nit HDR Finisher project.

Use a stable value that suits the viewing environment, then keep it fixed while grading and proofing. Do not chase a desired proof result by repeatedly changing the Windows slider.

## Rules for implementers and AI agents

- Treat **slider position**, **Windows SDR white in nits**, **project HDR Reference White**, and **display peak** as separate values.
- For an external HDR display on the currently validated Windows behavior, convert the slider with `80 + 4 × position`; recommend position 30 or 31 for a 203-nit project.
- Never apply that formula to a built-in display's **HDR content brightness** control.
- Prefer the native `DISPLAYCONFIG_SDR_WHITE_LEVEL` readback over an assumed slider mapping.
- Do not use Windows SDR white as a replacement for project reference white or export peak.
- Record Windows SDR white, project reference white, display peak, Chromium/Electron version, display identity, and HDR state in repeatable performance or visual-baseline evidence.
- Restart HDR Finisher after changing display HDR state, SDR white, display profile, monitor mode, or active display before accepting a visual result.

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
