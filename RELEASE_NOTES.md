# HDR Finisher 0.9.4

0.9.4 makes large exports practical on 8 GB machines, shows real export progress, adds Raw development pixel cleanup and a new Clean Grain, and makes SDR Match follow the HDR grade more faithfully.

## Export

- Export shows real progress: the current stage and an estimate of the time left. The bar keeps moving when a stage runs longer than expected.
- Large photos export in strips backed by disk, so very large exports (including Detail, Local adjustments, Film Look, framing and watermark) no longer need the whole picture in memory. On machines with less than 16 GB, batch export uses one worker, and native AVIF above 50 MP shows a memory warning first.
- Optional lossless high-fidelity JPEG XL delivery.
- A graphics-card export that stops making progress for 60 seconds recovers instead of hanging.
- Files created while an export is encoding are no longer overwritten.

## Grading

- SDR Match fits from the rendered picture, keeps the linked SDR when it is safe, matches individual adjustments with Undo, and lifts its main-tone target by one stop. HDR and SDR now share the same curves.
- Raw development: Pixel cleanup is on by default, with optional bright-only and harsh-speck Bayer cleanup.
- Clean Grain: Luminance and Color Noise sit under Amount, simpler colour controls, and a Protect color edges switch (off by default) that only protects long colour edges.
- Denoise keeps the current picture on screen while it switches on or off, stays sharp when zoomed, and shows a status line only when the slower CPU route is in use.
- Vignette midpoint goes up to 200%. HSL selection updates while dragging; Softness and Feather are renamed Hue softness and Edge feather.
- SDR exposure compensation sits after Film Look. Global and local Tone sliders behave as peers. Tone ranges show on the histogram only, and clipping uses a solid channel view.
- Removed: Film Look Print and Scan shortcut rows, and Camera Lens mini presets (saved lens values are kept).

## Photo Library

- TIFF files are supported, with orientation and embedded colour profiles applied.
- Faster safe deletion, steadier recovery after a lost graphics device, and fewer stalls when memory is short.
- Paste Grade choices line up in paired HDR and SDR lanes. Menus appear promptly and use native Mac shortcut labels.

## Interface

- Module headers highlight on hover and open with a click anywhere on the row.
- Simpler Scopes readouts that follow the active display; scopes pause while zooming.
- Unified scrollbars and workflow borders, an opaque Navigator grip, and app dialogs take Escape before the page does.

## Fixes

- Many memory and graphics-card fixes on 8 GB Macs: Grade previews, Library RAW development, Retouch and delivery share memory more fairly and fall back to the CPU cleanly.
- Scan Sharpening seams in CPU export strips, Film Exposure against a grey reference, lens grids in Library matching Grade, and incomplete GPS data in Details.
- Denoise no longer mistakes half-precision rounding in reduced TIFF previews for noise.
- Tag suggestions no longer disappear when the Details panel redraws while you type.

## Known limitations

This remains a technical alpha. Windows packages are unsigned; macOS packages are not notarized. See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.9.4/docs/known-limitations.md) for support and validation status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.9.3...v0.9.4
