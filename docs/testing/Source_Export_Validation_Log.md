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

## Adobe Lightroom Classic — HDR Output

- Date: 2026-08-17
- Application version: Lightroom Classic 14.x (HDR Output feature)
- Test image: backlit glass/window scene, real headroom source (bright window blowout behind a glass), graded with `Develop > Basics > HDR` enabled, `HDR Limit` set to `2.3`
- Status: Recipe A (AVIF gain map) validated after the CICP transfer-code fix; Recipe B (32-bit TIFF) validated as a real HDR source, contingent on one export setting (see below)

### Recipe A — AVIF gain map

- Export settings used: Image Format AVIF, HDR Output on, Maximize Compatibility on, Color Space `HDR Rec. 2020`, Quality 90.
- Import into HDR Finisher stalled for an extended period (expected — the gain-map decode path runs two full-resolution `avifgainmaputil tonemap` + `avifdec -d 16` passes) then failed with `The AVIF SDR rendition has no supported transfer characteristic.`
- Direct inspection with the bundled `avifgainmaputil printmetadata` confirmed the gain map itself is intact and correct: `Base headroom 0 (SDR)`, `Alternate headroom 2.29999 (HDR)` — matches the `HDR Limit 2.3` set in Lightroom exactly.
- Direct inspection with the bundled `avifdec --info` found the root cause: primary/base image is `Color Primaries 9` (BT.2020) / `Transfer Char. 1` (BT.709); alternate image is `Color Primaries 9` / `Transfer Char. 16` (PQ). HDR Finisher's `_cicp_transfer()` in `backend/hdr_finisher/gainmap_decoders.py` only maps codes `{8, 13, 16, 18}`, so code `1` returns `None` and triggers the exact error above. This is a real HDR Finisher interop gap, not an invalid Lightroom export — CICP transfer code 1 is standards-legal for an SDR rendition, Lightroom just doesn't use HDR Finisher's own default (code 13, sRGB).
- Fixed August 17, 2026: HDR Finisher now recognizes CICP transfer code `1` as the distinct BT.709 inverse OETF. The real 7952 × 5304 Lightroom AVIF imports as `HDR_TRUE`, preserves the exact SDR base, and retains `2.30` stops of encoded gain-map display headroom. Its measured content peak is `3.33` stops because the PQ alternate carries approximately 1000-nit content; encoded display headroom and pixel-content peak are related but not identical quantities. The same real file passes end-to-end drag/drop in the packaged Windows application.

### Recipe B — 32-bit TIFF

**Attempt 1 — Maximize Compatibility on, HDR Limit 2.3 (`LR-classic-hdr-source-test-1-32bit.tif`)**

- Export settings used: Image Format TIFF, Compression ZIP, HDR Output on, Maximize Compatibility on, Color Space `HDR Rec. 2020`, Bit Depth 32 bits/component.
- HDR Finisher auto-interpreted the file as `BT.2020 + LINEAR` (correct primaries/transfer) and reported `HDR_LINEAR_UNCONFIRMED` with the Technical panel showing `Source Depth: float32`, histogram `Peak 555.6 nit` (`% > 1000: 0.00%`).
- Direct probe of the file (`tifffile` + PIL `ImageCms`) confirmed: `SampleFormat: IEEEFP` (genuine float32, not an integer masquerading as float, unlike the earlier Affinity finding), ICC profile literally named `Linear Rec. 2020`, array `min 0.0 / max 1.0` exactly, `0.0%` of pixels above `1.0`, only `1.86%` above `0.99`.
- Initial (incorrect) conclusion at this stage: peak `1.0` was read as "no headroom." **Correction:** HDR Finisher's diffuse-white anchor is `0.18`, not `1.0`, so a peak of `1.0` is actually `log2(1.0/0.18) ≈ 2.47` stops above diffuse white — real headroom, just hard-capped. This tracked closely with the AVIF gain map's independently-measured `2.30`-stop `Alternate Headroom` from the same photo/settings, suggesting (correctly, per Attempt 2) that the cap was an artifact of one specific export setting rather than an absence of real data.

**Attempt 2 — Maximize Compatibility on, HDR Limit raised to 8.0 + exposure push (`LR-classic-hdr-source-test-2-32bit-hdr-limit-8.tif`)**

- Same grade/export settings as Attempt 1 except `HDR Limit` raised from `2.3` to `8.0`, plus `Exposure +1.14`, `Contrast +35`, `Highlights -37`, `Shadows +96`.
- Peak stayed exactly `555.6 nit` / `1.0` — completely unchanged despite HDR Limit more than tripling. Median and `% > 100` / `% > 203` did shift up as expected from the exposure/shadow push. Direct probe confirmed `min 0.0 / max 1.0` still exactly, with the fraction of pixels pinned at the max growing from `1.86%` (above `0.99`) to `9.15%` (exactly at max) — consistent with more content being pushed up against the same fixed wall.
- At this point two hypotheses were live: (a) genuine sensor/optical clipping in the original capture (plausible: ISO 800, f/4, 1/250s, direct window backlight), or (b) an export-setting-driven fixed ceiling unrelated to the real scene data. This test alone could not distinguish them, since both predict an unmoving peak with a growing clipped fraction.

**Attempt 3 — Maximize Compatibility OFF, same HDR Limit 8.0 grade (`LR-classic-hdr-source-test-2-32bit-hdr-limit-8-no-max-compat.tif`)**

- Identical grade to Attempt 2; only the Maximize Compatibility checkbox was unchecked.
- Result: `HDR_TRUE` confirmed, peak `6.63 stops above diffuse white`, histogram `Peak 8511 nit`, `P99 5565 nit`, `P95 2927 nit`, `Median 73.34 nit`, `% > 1000: 7.77%`. Source Interpretation auto-detected `BT.2020 + LINEAR` with confidence `confirmed` ("Auto detection found a consistent source interpretation") instead of the ambiguous/review state seen in Attempts 1–2.

**Conclusion:** Since HDR Limit was identical between Attempts 2 and 3 and only Maximize Compatibility changed, this is a clean, isolated A/B. It disproves both hypotheses raised after Attempt 2 (HDR-Limit-tracking renormalization, and real sensor clipping) — the `1.0` ceiling in Attempts 1–2 was purely an artifact of the **Maximize Compatibility** checkbox. With it checked, Lightroom's 32-bit TIFF export silently clamps/normalizes real HDR data into a bounded `[0,1]` range; with it unchecked, the TIFF carries genuine unbounded scene-linear data and HDR Finisher's automatic interpretation resolves it confidently. This is the opposite of what Maximize Compatibility does for AVIF (Recipe A), where it's required to get the gain map written at all — same checkbox, opposite correct setting per format. **Recipe B is validated as a real HDR source, provided Maximize Compatibility is left unchecked for TIFF exports.** This differs from the earlier Affinity "RGB 32-bit" finding, which was a genuine, unavoidable bug in that export path (integer clipping) rather than a misconfigured checkbox.

## Adobe Photoshop — 32-bit HDR via Camera Raw

- Date: 2026-08-17
- Application version: Photoshop 27.x with Camera Raw (modern unified panel), opening the already-validated `LR-classic-hdr-source-test-2-32bit-hdr-limit-8-no-max-compat.tif` (real `6.63`-stop HDR TIFF from the Lightroom testing above) as the input
- Status: validated end to end, via a path different from the originally-documented guess (Merge to HDR Pro / direct EXR open — neither tested)

### Pipeline discovered

1. Opening the TIFF routed through **Camera Raw** automatically (JPEG/TIFF Handling preference). Selected **HDR** toggle in the Edit panel. Light panel sliders were confirmed neutral on open (a rendered TIFF carries no develop history for ACR to reconstruct); `HDR Limit` was then set manually to `8.0` by the tester to match the Lightroom source, not read back from embedded metadata.
2. On opening into the Photoshop canvas, `Image > Mode` showed **16 Bits/Channel**, with `Edit > Assign Profile` reporting the source as `P3D65 PQ Display Full 12-16-0-1` — a **display-referred, PQ-encoded** representation, not scene-linear.
3. `Edit > Convert to Profile` at this stage showed only an irrelevant default CMYK destination (`Working CMYK - U.S. Web Coated (SWOP) v2`) and was correctly not used — a 16-bit integer document cannot represent values beyond its profile's nominal range, so converting profiles before promoting bit depth would have clipped the HDR content.
4. `Image > Mode > 32 Bits/Channel` was used instead. This decoded the PQ curve into real linear light: `Convert to Profile`, reopened afterward, showed the source profile relabeled `P3D65 PQ Display Full 12-16-0-1 (Linear RGB Profile)` — confirming a genuine PQ→linear decode, not just a bit-depth relabel.
5. Export was first attempted via `File > Export As`, which is a trap for this use case: 8-bit-only (PNG/JPG/GIF), with **"Convert to sRGB" checked by default** — would have silently flattened the HDR data. Corrected to `File > Save As` → **TIFF**, which offered a real TIFF Options dialog with **Bit Depth: 32 bit (Float)** already selected, ZIP/LZW/none compression, no Maximize-Compatibility-style trap.
6. Direct probe of the exported TIFF (`PS-source-test-1-32bit.tif`) confirmed: `SampleFormat: IEEEFP`, ICC profile name `P3D65 PQ Display Full 12-16-0-1 (Linear RGB Profile)`, array `min ≈ 0.0 / max 17.83`, `12.35%` of pixels above `1.0`, peak `log2(17.83/0.18) = 6.630` stops above diffuse white.
7. Direct parse of the embedded ICC profile's `rXYZ`/`gXYZ`/`bXYZ`/`wtpt` colorant tags (not just trusting the profile name) gave chromaticities `R(0.6820, 0.3193) G(0.2846, 0.6746) B(0.1559, 0.0660) W(0.3127, 0.3290)` — matching canonical Display P3 `R(0.6800, 0.3200) G(0.2650, 0.6900) B(0.1500, 0.0600) W(0.3127, 0.3290)` to within normal ICC fixed-point rounding. This is genuinely standard Display P3, not an idiosyncratic monitor-specific profile despite the unusual name.

### Import result

- First import attempt: badge correctly read `True HDR detected, peak 6.64 stops above diffuse white. Source color space is ambiguous; review source settings.` and the UI surfaced the "Source Interpretation Needs Review" prompt as designed — the ambiguity-detection mechanism worked correctly, this was not a silent failure. The preview shown alongside that prompt (and what "Use assumption" would have accepted) was **badly incorrect color** (heavy red cast, blotchy green/cyan highlights): HDR Finisher's fallback default for an unrecognized TIFF ICC profile name is **sRGB primaries with an sRGB gamma (CCTF) decode applied**. Both are wrong for this file (real primaries are Display P3, not sRGB; data is already linear, not gamma-encoded) — the gamma decode on top of already-linear data is a real double-decode, and the primaries mismatch caused the visible color error. The gap is specifically that the *offered default* is badly wrong, not that the app failed to ask.
- First correction attempt (Color Primaries → `Display P3 Linear` only, Transfer Function left unchanged) **did not fix it** — consistent with the double-decode still being active.
- Setting **both** Color Primaries `Display P3 Linear` and Transfer Function `Linear` together resolved it completely: badge `True HDR detected, peak 6.63 stops above diffuse white` (matches the direct probe's `6.630` to three digits), preview returned to correct color, histogram `Peak 8524 nit`, `P99 5516 nit`, `P95 2042 nit`, `Median 72.87 nit`, `% > 1000: 7.74%` — closely tracking the equivalent Lightroom-sourced numbers (`Peak 8511 nit`, `% > 1000: 7.77%`) from the same underlying photo.

### Conclusion

This Photoshop path is validated as a real, working HDR source, but only via the specific pipeline above (Camera Raw HDR toggle → 16-bit PQ → `Image > Mode > 32 Bits/Channel` to decode → `File > Save As` TIFF, never `Export As`) and only with **both** Source Interpretation fields manually set together. Note a real HDR Finisher gap surfaced here, independent of anything Photoshop did wrong: silently defaulting an unrecognized TIFF color space to sRGB-primaries-plus-gamma-decode is a worse failure mode than a neutral/no-op fallback would be, since it produces a confidently-wrong-looking image rather than an obviously-broken one. Worth a future fix, not yet briefed to Codex.
