# Source Export Validation Log

This log records real-application validation of the source export workflows documented in `README.md`.

## Blender 5.2 LTS — Output Setup

- Date: 2026-08-07
- Application version: Blender 5.2.0 LTS
- Status: rendered-file A/B and HDR Finisher import validated; live HDR-display and gain-map delivery checks pending
- Verified single-layer output controls: `OpenEXR (.exr)`, `RGB` / `RGBA`, `Float (Full)`, and `ZIP`.
- Verified Output Color Management controls: `Follow Scene` / `Override`, with both `Linear Rec.709` and `Linear Rec.2020` available as explicit overrides.
- Published guidance now recommends `Override > Linear Rec.2020` for Blender's standard OCIO configuration. This uses wide-gamut interchange coordinates and separates the file encoding from local Display, View Transform, Look, exposure, and gamma settings.
- For a deliberately configured ACEScg project, the matching explicit output and HDR Finisher interpretation remain `ACEScg` / `ACEScg Linear`.
- Baseline handoff disables Compositing and Sequencer unless their output is intentional, and sets Dither to `0.00` for deterministic float output.
- A controlled 540 x 540 A/B used the same scene and settings with only the output override changed. Both files are float32 RGB OpenEXR with ZIP compression, finite positive samples, and substantial unbounded HDR headroom.
- Blender wrote no standard EXR `chromaticities` attribute. It did write `colorInteropID` values `lin_rec709_scene` and `lin_rec2020_scene`. HDR Finisher now recognizes these exact OCIO interoperability IDs and automatically selects the matching scene-linear source space.
- After interpreting the files as Linear Rec.709 and Linear Rec.2020 respectively, their ACEScg results had a mean absolute channel difference of `0.000397`, RMSE `0.001931`, and mean relative difference of `0.0113%`. `94.65%` of pixels matched within `0.001` in every channel. Peak ACEScg luminance was `55.7306` versus `55.7402`; the maximum luminance difference was `0.00952`.
- Neither file contained negative or non-finite samples, so the loader's input sanitization had no effect on this comparison. Matched SDR previews were visually indistinguishable.
- The A/B confirms that Linear Rec.2020 preserves the intended scene while providing the preferred wide-gamut interchange encoding. Linear Rec.709 remains technically valid when selected with its matching import interpretation.
- Automatic identification is deliberately allowlisted and also covers Blender/OCIO's `lin_p3d65_scene` and `lin_ap1_scene` IDs. Unknown IDs remain untrusted, and disagreement between a recognized ID and standard EXR chromaticities requires manual review.
- Remaining validation: verify the higher-resolution Rec.2020 file in the live HDR canvas, scopes, diagnostics, and gain-map export.

## Affinity (Canva-era unified app) — Sony RAW

- Date: 2026-08-06
- Application version/build: Mid July '26 (4646)
- Camera / RAW filename: Sony ILCE-7RM3 / `DSC06898.ARW`
- Goal: validate Sony RAW development to a 32-bit floating-point, scene-linear TIFF that imports cleanly into HDR Finisher.
- Planned interpretation: scene-linear sRGB / Rec.709
- Status: Affinity round trip validated; delivery brightness behavior documented

### Checkpoints

1. Record Affinity version and initial RAW-open state — complete.
2. Verify Develop Assistant RAW engine, 32-bit HDR output, and tone-curve settings — complete.
3. Develop the Sony RAW and verify document format/profile — complete.
4. Export full-resolution 32-bit TIFF with embedded linear ICC profile — complete, but unsuitable for true HDR.
5. Probe TIFF metadata and pixel range outside Affinity — complete; failed floating-point/headroom requirement.
6. Export/probe single-layer 32-bit floating-point EXR — complete; true HDR preserved, chromaticities absent.
7. Import into HDR Finisher and verify manual source interpretation, HDR classification, preview, scopes, and delivery — complete.
8. Record corrections needed in the README workflow — complete for the Affinity round trip.

### Observations

- Test initiated while the user is operating Affinity interactively.
- Initial Develop view screenshot confirms `DSC06898.ARW`, 5320 x 7968 px, 42.39 MP, RGBA/32 (HDR), and RAW Layer (Embedded).
- Camera/lens metadata shown: Sony ILCE-7RM3, Tamron 17-28mm F2.8 Di III RXD; ISO 100, f/22, 17.0 mm, 1/100 s.
- Scene contains a direct sun highlight and deep shaded structure, making it a strong real-world headroom and shadow test.
- About dialog identifies the application as the Canva-era unified `affinity`, Mid July '26 build 4646. This is not Affinity Photo 2; older Photo 2 documentation must be treated as background until UI labels are verified in build 4646.
- Build 4646 Develop Assistant path: `Edit > Settings > Assistant`, scroll to bottom, then `Develop Assistant...`.
- Observed Develop Assistant defaults: Affinity RAW engine; auto-select lens profile; apply color reduction; apply light sharpening; RGB (32 bit HDR) RAW output; exposure bias `Take no action`.
- `Default tone curve` is disabled/locked to `Standard` with RGB (32 bit HDR); the preliminary README instruction to select `Take no action` does not apply to build 4646.
- Histogram orange triangle denotes coarse histogram display, not clipping. Clicking it switches the histogram to fine display and clears the indicator.
- Working RAW grade reported from screenshot: Exposure `+2`, Blackpoint `0%`, Brightness `+15%`, Contrast `+5%`, Clarity `+2%`, Texture `0%`, Saturation `0%`, Vibrance `+8%`, Shadows `+60%`, Highlights `0%`.
- Observed 32-bit Preview defaults: Enable HDR on; Clip warning `None`; monitor reference white `80` nits; Clip to Max (Peak) off; preview Exposure `0`; Gamma `1`; ICC Display Transform selected.
- Test adjustment: change preview monitor reference white to `100` nits to align with HDR Finisher's diffuse-white reference. This is a preview setting, not a pixel edit.
- Build 4646 conversion path: `Document > Setup > Convert Format / ICC Profile...`.
- The developed RAW document exposes `wsRGB (Linear)` as its current/starred profile. HDR Finisher's current substring classifier would incorrectly identify `wsRGB` as ordinary `sRGB`, so an explicit profile conversion is required before export.
- Selected handoff profile for this validation: `Display P3 (Linear)`, RGB/32 (HDR), Relative Colorimetric, black point compensation off. Display P3 is wider than sRGB and is explicitly recognized by HDR Finisher.
- TIFF export settings tested: native 5320 x 7968, whole document, Pixel Format `RGB 32-bit`, use/embedded document ICC, embedded metadata, ZIP compression, Affinity layers off.
- TIFF probe result: 493,515,694 bytes; stored array `(7968, 5320, 4)` with `uint32` samples; TIFF SampleFormat `1` (unsigned integer), BitsPerSample `32`, Adobe Deflate compression (`8`), Predictor `2`.
- HDR Finisher imported the TIFF cleanly and confidently detected Display P3 + LINEAR, but integer normalization bounded the pixels below 1.0. Post-conversion peak was `0.74442` ACEScg (~412 nits / 2.05 stops above 0.18), producing `HDR_LINEAR_UNCONFIRMED` rather than `HDR_TRUE`.
- Conclusion: build 4646 `TIFF > RGB 32-bit` is not a floating-point HDR interchange. It is a high-precision unsigned-integer export and cannot preserve unbounded scene-linear highlight values. Test EXR next.
- EXR export settings tested: `OpenEXR 32-bit linear` (not layered), native 5320 x 7968, whole document, Color profile from name on, Multi channel off, ZIP compression, Image pixels `32 bit (FLOAT)`.
- EXR probe result: valid float32 RGB, `HDR_TRUE`, peak `13.59327` linear, 6.23875 stops above diffuse white, estimated 6,581 nit peak, 0.14% of pixels above 1,000 nits. HDR AVIF and SDR PNG preview generation both succeeded.
- Affinity did not write a `chromaticities` EXR header attribute. HDR Finisher therefore leaves source color space unknown and correctly requests manual interpretation. Select `Linear Display P3`, matching the explicit pre-export document conversion.
- Documented recommendation: Affinity `Display P3 (Linear)` on conversion/export, paired with HDR Finisher's exact menu label `Display P3 Linear` on import. These labels describe the same linear Display P3 encoding.
- Initial live UI import confirms `True HDR detected, peak 6.24 stops above diffuse white` and requests source interpretation review because EXR chromaticities are absent.
- User reports that the live HDR presentation looks substantially better than the Windows screenshot/Affinity view, but the initial preview appears very noisy. Defer noise/color judgment until the required `Linear Display P3` manual source interpretation has regenerated the preview.
- After applying `Display P3 Linear`, user confirms colors match the Affinity view while HDR Finisher presents the retained HDR brightness that Affinity was not visibly showing.
- Pixel-level preview investigation: noise-like artifacts become severe on café mesh/fine detail at the UI's `100%` view. Code inspection confirms previews are capped at a 1920 px long edge and `downsample_image()` uses integer coordinate selection (`image[np.ix_(ys, xs)]`), i.e. point/nearest-style decimation with no reconstruction filter. The `100%` UI view is therefore 1:1 proxy pixels, not 1:1 source pixels.
- HDR proxy encoding uses 10-bit YUV 4:4:4 AVIF at quality 82. This can contribute compression artifacts, but unfiltered 7968-to-1920 decimation is the primary explanation for the strong mesh/foliage aliasing observed.
- Classification: preview-pipeline defect/limitation, not evidence of ISO 100 RAW sensor noise. Do not judge noise or sharpness from the current proxy.
- Fix implemented during validation: replaced integer point decimation with per-channel float32 Lanczos resampling, clamped to each source channel's extrema so preview filtering cannot create negative light or new HDR peaks.
- Added a high-frequency checkerboard regression covering mean preservation, finite float32 output, HDR range bounds, target dimensions, and suppression of alias variance. Preview/core/render-cache test selection passes: 46 tests.
- Remaining intentional behavior: preview long edge remains capped and UI `100%` remains proxy-pixel 1:1, not source-pixel 1:1.
- SDR fallback visual check: user reports it looks fine. Its highlight preservation/rolloff differs slightly from Affinity, but HDR Finisher's rolloff is subjectively better for this image; no corrective action requested.
- Post-fix live A/B validation: user reports preview noise/aliasing is significantly better. A 100% proxy crop shows coherent woven-mesh structure instead of the prior salt-and-pepper pattern. Filtered float32 Lanczos proxy resampling is visually validated on the real 42.39 MP Affinity EXR.
- Delivery pre-flight reached with all checks ready: source interpretation confirmed, HDR branch ready, SDR fallback ready, and encoder available. Selected primary output is `AVIF + gain map` (ISO 21496-1, 10-bit logarithmic gain map) at quality `85`; JPEG Ultra HDR and SDR PNG are also reported ready, while JPEG XL is unavailable in this build.
- Export dialog `Browse` folder picker failed during the Windows live test and displayed `Folder picker failed.` Pasting the destination path directly was a successful workaround; track the picker behavior as a separate UI defect.
- Quality-85 AVIF gain-map export completed and is retained locally at `codebase/output/manual-test-runs/affinity-2026-08-06/Affinity_DSC06898_DisplayP3_Linear_32f_finished.avif`; HDR Finisher reports successful post-export validation with `avifdec`.
- Live delivery validation used Chrome with monitor 1 in HDR mode and monitor 2 in SDR mode. HDR gain-map presentation activated on monitor 1; moving the same Chrome content to monitor 2 selected the intended SDR fallback. Exported noise/detail matched Affinity extremely closely, as expected because no additional denoising was authored.
- Chrome's HDR brightness did not exactly match HDR Finisher's live HDR canvas. Technical inspection confirms a valid 5320 x 7968 AVIF with an 8-bit sRGB base, 10-bit YUV444 logarithmic gain map, BT.2020/PQ alternate, base headroom `0.00`, and alternate headroom `5.26035`. This is expected display-adaptive behavior: Chrome applies the gain map according to the active monitor's current HDR headroom and performs display tone mapping, while HDR Finisher presents the authored rendition against its explicit 100-nit diffuse-white reference. Treat color/detail/fallback selection as round-trip invariants; do not require pixel-identical on-screen brightness between these two presentation paths.
