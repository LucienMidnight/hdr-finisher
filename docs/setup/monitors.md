# Monitors and Viewing Environment

An HDR file and an HDR monitor are not enough by themselves. The operating system, GPU signal, browser, monitor mode, panel behavior, ambient light, and image content all affect what you see.

The goal is not to make every display look identical. It is to understand what your display can verify and use scopes and proofing for everything it cannot.

## First classify the display

Marketing terms are not measurements. Look for a credible peak-brightness specification, sustained brightness, black level, color-gamut coverage, bit depth, and local-dimming or emissive-panel behavior.

VESA’s current [DisplayHDR performance criteria](https://displayhdr.org/performance-criteria/) are useful when a product is genuinely certified. DisplayHDR 400 is an entry tier; classic DisplayHDR 500 is the first tier that requires local dimming and 95% DCI-P3 coverage under the current criteria. A label such as “HDR-400” without the **DisplayHDR** certification name is not equivalent to certification. See the [VESA FAQ](https://displayhdr.org/faq/).

## SDR-only monitor

You can still use HDR Finisher productively.

### What you can judge

- The authored SDR fallback
- Composition, texture, and broad color within the monitor’s gamut
- HDR highlight placement and clipping numerically with the waveform, histogram, zebras, and false color
- Deterministic gain-map reconstructions at selected targets

### What you cannot judge

- Perceived HDR highlight intensity
- The transition from diffuse white into luminous highlights
- Blooming, haloing, local-dimming pumping, or automatic brightness limiting
- Wide-gamut colors outside the display’s reproducible gamut
- Whether the operating system/browser really enters an HDR presentation path

Grade conservatively, keep the SDR rendition excellent, and perform final HDR acceptance on at least one known HDR device.

## Limited-HDR display: roughly 500 nits or below

This category includes many HDR-capable laptops, entry monitors, and edge-lit panels. Some are genuinely useful; others primarily accept an HDR signal.

### Use it for

- Confirming that HDR presentation activates
- Seeing relative separation above SDR white
- Checking a 400- or 500-nit Chrome Proof target
- Finding severe hue shifts, clipping, or broken transfer behavior

### Do not use it alone for

- Mastering a 1,000-nit look by eye
- Deciding that all values above the panel peak are safely preserved
- Evaluating small bright highlights when the panel has no effective local dimming
- Assuming a dim or flat presentation means the encoded image is wrong

Such a display may tone-map a 1,000-nit signal into its smaller range. Its 500-nit peak may also be available only in a small window for a short time. Use the 400/500-nit proof targets and the scopes, then check a more capable display before release.

## Capable consumer HDR or creator monitor

A strong general-purpose target typically combines meaningful peak output, good black performance, wide gamut, 10-bit processing, and local dimming or an emissive panel.

Recommended baseline:

| Setting | Starting point | Why |
|---|---|---|
| HDR mode | On/Auto/HDR10 | HDR Finisher exports a PQ/HDR10-class alternate rendition. |
| Transfer/EOTF | PQ or ST 2084 | Use HLG only when explicitly reviewing an HLG source elsewhere. |
| Gamut | Auto or the monitor’s accurate HDR mode | Forcing native gamut can oversaturate BT.709/P3 content. |
| Local dimming | On; use the most accurate stable level | HDR contrast depends on it for LCDs, but aggressive settings can halo or crush detail. |
| Dynamic contrast | Off | It changes the tone response from image to image. |
| Vivid/color enhancement | Off | It obscures authored saturation and gamut behavior. |
| Sharpness/noise enhancement | Neutral/off | It is unrelated to HDR and can hide export artifacts. |
| Eco/power saving | Off during review | It may limit peak output or change brightness dynamically. |
| Color temperature | D65/6500 K or accurate preset | Matches the output assumptions more closely. |

Monitor menus vary. “Brightness” may control the backlight, PQ tracking, black level, or a post-transform offset depending on the model. Use the manual and a known test pattern before prescribing a numeric setting.

## OLED and automatic brightness limiting

An OLED may deliver excellent black levels and small-area highlights while reducing brightness for a large bright image. This is normal panel protection behavior, not necessarily a file defect.

When judging:

- Compare small highlights and large bright regions separately.
- Avoid leaving static high-brightness test patterns open unnecessarily.
- Check whether the monitor offers a creator/reference mode with more stable behavior.
- Remember that the browser viewport size can change the panel’s average picture level and therefore its brightness.

## Local-dimming LCDs

Local dimming can produce far more useful HDR contrast than an undimmed LCD, but zone count and algorithms matter.

Look for:

- Halos around bright objects on dark backgrounds
- Delayed brightness changes after edits
- Raised blacks near UI chrome or white text
- Different behavior in windowed and full-screen presentation
- A “low,” “high,” or “fast” mode that changes tonal accuracy

Keep the chosen dimming mode fixed through grading and validation.

## Gamut, color-space, and transfer labels

These labels describe different things:

- **BT.2020/Rec.2020, P3, sRGB/BT.709:** color primaries or container gamut.
- **PQ/ST 2084, HLG, sRGB:** transfer functions—how code values relate to light.
- **HDR10:** a delivery system normally using BT.2020 signaling and PQ.

Do not select HLG merely because it is “an HDR mode.” HDR Finisher’s preview/export transport is PQ. A monitor’s accurate HDR10/Auto mode is normally safer than forcing its raw/native panel gamut.

## Viewing environment

- Use subdued, neutral ambient light for repeatable work.
- Avoid colored walls or direct reflections in the screen.
- Allow the display to warm up according to its manufacturer guidance.
- Keep ambient-light and automatic-brightness features fixed or disabled.
- Do not grade peak highlights in an extremely bright room; the visual system adapts and encourages excessive brightness.
- Take breaks. HDR highlight judgment fatigues quickly.

## Calibration and measurement

Operating-system calibration improves signaling and tone mapping, but it does not replace a meter/profile workflow when color accuracy is critical. A manufacturer’s peak specification is not proof of current output, and HDR Finisher telemetry is not a colorimeter.

For serious delivery, record:

- Monitor model and firmware
- Connection and GPU mode
- Monitor HDR preset and local-dimming setting
- OS HDR/SDR-white setting
- Browser and version
- Calibration/profile date
- Approximate ambient conditions

That record makes a visual observation reproducible and is more useful than saying only “it looked correct on my HDR monitor.”
