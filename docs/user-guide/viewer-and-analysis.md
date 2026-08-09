# Viewer, Scopes, and Overlays

The viewer shows the current HDR or SDR branch. The analysis dock measures the processed branch independently of what the monitor can physically reproduce.

## Preview paths

HDR Finisher has two complementary render paths:

- **Interactive WebGPU draft:** a low-latency browser-canvas update while adjusting controls, when WebGPU is available.
- **Settled backend preview:** processed by the Python pipeline and encoded for the active branch. This is the export-authoritative preview path.

If WebGPU is missing or fails, the application falls back to backend previews. A successful fast draft does not replace the settled result; small discrepancies should be judged against the backend and final export.

## HDR and SDR viewing

**HDR Controls** shows the authored HDR rendition, transported to the browser as BT.2020/PQ when HDR presentation is available. On an SDR system, the backend produces a deterministic SDR-viewable representation so the interface remains usable, but that is not true HDR output.

**SDR Controls** shows the authored sRGB fallback.

The **A/B · V** control switches branches. Tap `V` to switch; hold it to peek at the other prepared branch. Comparing branches is useful for composition and color continuity, but they are not intended to have identical highlight brightness.

## Zoom and resolution

- **Fit** scales the proxy into the viewport.
- **100%** means one preview-proxy pixel per screen pixel.
- The slider, plus/minus controls, or typed percentage set other zooms.

Preview proxies are capped at 1,920 pixels on the long edge. Therefore, 100% is not necessarily one original source pixel per display pixel. Use the source editor or final full-resolution export for critical sharpness, fine noise, demosaicing, and texture judgments.

Proxy resampling preserves float values and uses a high-quality filter, but downsampling can still hide single-pixel clipping or artifacts.

## Histogram

The histogram counts processed values by brightness/channel. It answers questions such as:

- Is most of the photograph concentrated in shadows or midtones?
- Are highlights accumulating at the delivery ceiling?
- Does a color channel extend farther than the others?

For HDR, the x-axis is expressed in reference nits based on the app’s 100-nit diffuse-white convention. For SDR, it is normalized to the display range.

A histogram does not show where pixels occur in the image. A small but important specular highlight may be almost invisible in the count.

## Waveform

The waveform preserves horizontal image position and plots brightness vertically. It is often the best tool for placing diffuse white, faces, sky, windows, lamps, and other regions.

- **Composite** overlays RGB/luma information.
- **Luma** emphasizes brightness structure.
- **RGB Parade** separates channels to reveal casts, channel clipping, and unequal highlight behavior.

The waveform measures the processed rendition, not panel output. A 1,000-nit value remains measurable on a 300-nit SDR display even though the display cannot show it at that luminance.

## Technical panel

The Technical tab separates three kinds of evidence:

- **Output:** current preview media type, gamut/transfer, bit depth, and render-path notes.
- **Display probe:** browser media-query/GPU information plus native Windows telemetry where available.
- **Interpretation:** source primaries, transfer, confidence, and internal working space.

Use it when the picture looks wrong before changing the grade. A display-path or source-interpretation problem should not be “fixed” with creative controls.

## False Color

False color replaces or overlays picture colors according to luminance zones. Presets include:

- Web HDR: 1,000-nit peak / 100-nit white
- BT.2408: 1,000-nit peak / 203-nit white
- BT.2408: 4,000-nit peak / 203-nit white
- SDR: 100-nit white

Choose the preset for the reference convention you are evaluating. The overlay does not change the grade or export.

Use false color to find diffuse-white placement, values entering the highlight range, and values approaching a target ceiling. Do not use it as a universal exposure recipe; different scenes legitimately distribute light differently.

## Zebras

Zebras mark values at or above the selected threshold. On the HDR branch, the threshold readout is tied to the app reference-nit mapping. On SDR, it relates to the normalized output range.

Use zebras to locate clipping risk or regions above a chosen delivery target. A zebra is a warning, not proof of clipping: gain-map delivery can adapt values above a display’s current headroom.

## Scope accuracy and limits

Scopes are generated from the processed proxy or render cache using the same adjustment pipeline. They are deterministic numerical diagnostics, not instruments measuring the screen.

They cannot reveal:

- Actual panel luminance
- Local-dimming halos
- Automatic brightness limiting
- Browser-specific display tone mapping
- Ambient-light adaptation
- Whether the monitor gamut is calibrated accurately

Combine scopes with [Chrome Proof](proof.md) and physical delivery checks.

## Watch out for

- Judging settled output before the draft preview has been replaced
- Mistaking an SDR-compatible HDR preview representation for true HDR
- Reading 100% zoom as source resolution
- Using the wrong false-color reference white
- Correcting a monitor-mode problem in the image grade
- Assuming a clean scope guarantees an attractive or compatible result
