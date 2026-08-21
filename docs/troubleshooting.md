# Troubleshooting

Start with the symptom. Before changing the creative grade, separate source interpretation, processing, preview transport, display behavior, and delivery transformation.

## The image has the wrong color immediately after import

Likely cause: wrong or ambiguous source primaries/transfer.

1. Open Metadata and Interpretation.
2. Compare the selected primaries and transfer with the source application’s export settings.
3. If the source is EXR, check for missing/conflicting chromaticities or `colorInteropID`.
4. Reapply the exact interpretation.

Do not correct a primaries mismatch with Temperature, Tint, Saturation, or RGB Primaries. That hides the problem in one image and breaks pipeline consistency.

## The imported EXR is SDR or has no values above white

- Confirm the source document/render is floating-point and scene-linear.
- Check that an SDR view transform, tone mapper, or output transform was not baked in.
- Confirm the exporter did not write bounded unsigned integer data.
- Inspect peak linear value and stops above diffuse white.
- Use the validated Affinity/darktable/Blender recipes in [Source Preparation](workflows/source-preparation.md).

High bit depth does not guarantee HDR headroom.

## The HDR preview looks SDR

1. Confirm Windows/macOS and the monitor are actually in HDR mode.
2. Check the Technical panel for HDR media/display information.
3. Keep the browser window fully on the HDR display.
4. Restart the browser after changing OS HDR or profiles.
5. Confirm the browser is current and Chromium-based for the validated path.
6. Check whether the Technical tab reports an HDR-capable WebGPU canvas or the SDR-compatible fallback.

An SDR display can show a usable representation, but it cannot emit the authored HDR luminance.

## The preview changes after I stop dragging

Fast mode keeps the same WebGPU surface after settling, so a routine encoded-image swap should not occur. High-quality mode may atomically replace the proxy after longer idle, and a device-loss fallback may move to the raw CPU canvas.

If the difference is large or systematic:

- Check the browser console.
- Run the GPU parity QA tool.
- Compare the authoring preview with an explicit Chrome Proof or final export.
- Record the GPU/browser/version and the affected controls.

## Highlights are clipped

Determine where clipping occurs:

- **Source:** upstream values are already clipped; HDR Finisher cannot recover them.
- **HDR grade:** waveform/zebras show values compressed against 10,000 nits or an unintended control boundary.
- **SDR fallback:** the SDR branch needs tone-map/Highlight Recovery adjustment.
- **Monitor:** the panel or its tone mapper cannot reproduce the requested peak.
- **Service:** recompression removed the gain map, leaving only SDR.

Use Highlight Rolloff, Exposure Bands, or a lower exposure only after identifying the stage.

## HDR looks flat on a low-nit monitor

A limited display may compress a much larger authored range into 400–500 nits, especially without effective local dimming. Build a proof at the display’s credible peak, keep SDR white stable, and inspect highlight hierarchy rather than expecting a 1,000-nit appearance.

See [Monitors](setup/monitors.md).

## The image changes when moved between monitors

This is expected when one display is HDR and the other is SDR, or when their SDR-white, peak, gamut, and profiles differ. Keep the window on one display during grading. Reload/rebuild proof after moving and document which display was used.

## SDR colors are dull or different from HDR

Wide-gamut ACEScg/BT.2020 colors must fit sRGB for the fallback. HDR Finisher compresses out-of-gamut chroma toward luma. Try:

- Use **Match HDR colors** as a starting point.
- Reduce or adapt the independent SDR saturation or primaries deliberately.
- Inspect RGB parade/channel clipping.
- Confirm the monitor is not forcing its native gamut for SDR.

Exact color identity is not always possible; aim for a perceptual match.

## Changing SDR Base Rendition does little or looks strange on HEIC

Supported Apple HDR HEIC already contains an authored SDR rendition. Neutral Filmic intentionally preserves it. Other Base settings approximately re-tone-map that display image rather than returning to RAW scene data. Use moderate adjustments and prefer the original SDR if it is already strong.

## Chrome Proof is stale

The grade, format, target, source interpretation, or relevant settings changed after the last build. The previous proof remains visible for reference. Click **Build proof** again before treating it as current.

## Auto proof target is unavailable or implausible

Native SDR-white and DXGI luminance telemetry is Windows-only. Even on Windows, EDID/driver values are not measurements.

- Choose a fixed target from a credible display specification or calibration.
- Verify the selected display.
- Check Windows SDR content brightness.
- Avoid using an implausible reported maximum as mastering truth.

## JPEG Ultra HDR is unavailable

- Check Export capability status.
- Confirm `ultrahdr_app` exists in `codebase/bin/` or on `PATH`.
- Use the pinned Windows build script if developing locally.
- Confirm the binary supports the required ISO/XMP features.
- Run capability and real-media tests.

Do not substitute an arbitrary similarly named binary without validating its flags and output.

## AVIF gain-map export is unavailable

Confirm `avifenc`, `avifdec`, and `avifgainmaputil` are bundled/discoverable and compatible. Run the capability checker and sample export. A plain `avifenc` alone is not enough to assemble the gain map.

## Export says the file already exists

HDR Finisher requires explicit overwrite confirmation. Choose a new name or confirm overwrite in the UI. The exporter stages and validates complex output before replacing the destination.

## The exported file is HDR locally but SDR after upload

The service probably resized, recompressed, converted, or stripped metadata.

1. Download the delivered file.
2. Compare its hash and MIME type with the original.
3. Run `tools/verify_hosted_gainmap.py`.
4. Inspect gain-map markers/metadata.
5. Test a hosting path that preserves original bytes.

The presence of a normal-looking SDR JPEG after upload does not prove the Ultra HDR payload survived.

## Fine bright edges have halos or color errors

For JPEG Ultra HDR:

- Use Full gain-map resolution.
- Raise Gain-map Quality.
- Check whether the issue exists before hosting.
- Inspect the original HDR and SDR alignment.
- Repeat the JPEG Ultra HDR reliability checks with a known-good source and decoder.

## Browse does not open a folder picker on macOS/Linux

The non-Windows picker uses Python Tk. Install/use a Python build with Tk support, or enter an existing destination path manually. Current non-Windows picker behavior is not part of the validated package matrix.

## The app is slow or uses substantial memory

Full-resolution float32 RGB images are large, and HDR/SDR processing can create multiple arrays. The viewer uses proxies, but export is full resolution.

- Close/eject the current image before loading another large source.
- Avoid unnecessarily huge intermediates.
- Confirm WebGPU is available for the settled authoring preview.
- Leave High-quality preview off when GPU memory is constrained; export quality is unchanged.
- Check `/api/session/{id}/diagnostics` when cache growth, evictions, or duplicate work is suspected.
- Expect final export to take longer than the proxy preview.

If reporting performance, include dimensions, file type, available RAM, GPU/browser, control state, and whether the delay is import, preview, scope, proof, or export.
