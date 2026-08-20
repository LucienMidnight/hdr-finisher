# Source Preparation Workflows

HDR Finisher is the last global finishing and delivery step. Complete RAW development, compositing, retouching, and rendering upstream, but export before an SDR display transform clips or compresses the HDR range.

## A good handoff has four properties

1. **Unbounded or HDR-capable values:** important highlights survive above the diffuse-white reference.
2. **Known primaries:** ACEScg, Rec.2020, Display P3, or Rec.709/sRGB coordinates are identified accurately.
3. **Linear transfer:** preferred for EXR/TIFF scene handoff.
4. **Lossless, full-resolution RGB:** no JPEG compression, chroma subsampling, display tone map, or ambiguous multilayer beauty pass.

If an upstream application uses another working space, convert the document/export into one of HDR Finisher’s supported interpretations. Use **Convert**, not **Assign**.

## Affinity build 4646 and Sony RAW

**Validated workflow:** Sony ILCE-7RM3 `.ARW` through Affinity build 4646 to 32-bit float OpenEXR.

1. Before opening the RAW, open **Settings > Assistant > Develop Assistant**.
2. Select **Affinity RAW** and **RGB (32 bit HDR)**. Leave exposure bias at no action unless your workflow requires otherwise.
3. Develop the RAW and keep the document in RGB/32 HDR.
4. Use **Document > Setup > Convert Format / ICC Profile**.
5. Convert to **Display P3 (Linear)** with Relative Colorimetric intent and black-point compensation off.
6. Perform the desired editing without Tone Mapping Persona and without converting to RGB/16 or RGB/8.
7. In 32-bit Preview, enable HDR, set preview exposure to 0 and gamma to 1, use the ICC display transform, and leave peak clipping off.
8. Export **OpenEXR 32-bit linear**, single layer, ZIP compression, native dimensions, and profile-from-name enabled.
9. Import into HDR Finisher and manually select **Display P3 Linear** if prompted.

Build 4646 did not write EXR chromaticities in this path, so Review is expected. Affinity’s linear Display P3 coordinates and HDR Finisher’s **Display P3 Linear** interpretation match.

### Why not 32-bit TIFF?

The tested Affinity TIFF “RGB 32-bit” export stored unsigned 32-bit integers and was bounded below `1.0`; it was high precision but not an unbounded HDR handoff. The EXR retained a measured peak of `13.59` linear, about 6.24 stops above the app diffuse-white anchor.

### Why not wsRGB?

Affinity’s default linear wsRGB is not a supported manual source space in HDR Finisher. Converting to linear Display P3 preserves a wider gamut than sRGB while making the interchange explicit. ROMM/ProPhoto and wsRGB should not be mislabeled as another supported space.

## Adobe Lightroom Classic (HDR Output)

**Status: Recipes A and B hands-on tested and validated; Recipe B has one critical export setting.** Lightroom Classic 13/14’s HDR Output feature (`Develop > Basics > HDR`) is real scene-referred HDR editing, not a preview trick. Official background: [Edit and Export in HDR — Lightroom Classic](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/hdr-output.html). Findings below are from a real round trip on 2026-08-17; full detail in [Source Export Validation Log](../testing/Source_Export_Validation_Log.md).

**Important — the "Maximize Compatibility" checkbox behaves oppositely for the two recipes below.** For AVIF, Adobe's own docs say it's required to get the gain map written at all. For TIFF, hands-on testing found the opposite: with it checked, Lightroom silently normalizes/clamps its internal HDR data into a bounded `[0,1]` range before writing the file, discarding real headroom; unchecked, the TIFF carries genuine unbounded scene-linear data. Same checkbox, opposite correct setting per format — get this wrong and Recipe B silently produces an SDR-bounded file that still claims to be 32-bit float HDR.

### Recipe A — AVIF gain map (use this one for delivery)

1. Edit the photo with **Develop > Basics > HDR** enabled. This is available by default on Merge-to-HDR DNGs, iPhone 12+ HEIC/JPEG, and Canon/Sony HDR HEIF; turn it on manually for anything else (needs Process Version 3+).
2. `File > Export > File Settings`: Image Format **AVIF**, tick **HDR Output** and **Maximize Compatibility**, Color Space **HDR Rec. 2020** (widest gamut in common with HDR Finisher’s BT.2020 delivery gamut), Quality 90+.
3. Export, then drag the `.avif` into HDR Finisher.

Lightroom’s HDR AVIF export writes an Adobe gain map (`http://ns.adobe.com/hdr-gain-map/1.0/`) that is the same technology base as ISO 21496-1, and HDR Finisher’s JPEG/AVIF gain-map decoder already recognizes that exact Adobe XMP namespace. Direct inspection of a real export (`avifgainmaputil printmetadata`) confirmed the gain map itself decodes correctly — `Base Headroom 0.00 (SDR), Alternate Headroom 2.30 (HDR)`, matching the source photo’s `HDR Limit` setting exactly.

**Validated interoperability note:** Lightroom tags the SDR base image with CICP transfer characteristic code `1` (BT.709), while its alternate image uses BT.2020/PQ. HDR Finisher now decodes code `1` with the standards-distinct BT.709 inverse OETF rather than rejecting it or treating it as sRGB. The real 7952 × 5304 test export imports as `HDR_TRUE`, preserves the SDR base, retains `2.30` stops of encoded display headroom, and passes packaged Windows drag/drop. A large file may remain on the loading state for a while because gain-map reconstruction and preview preparation process both full-resolution renditions.

### Recipe B — 32-bit TIFF: validated, but only with Maximize Compatibility OFF

1. Same HDR-enabled Develop pass as Recipe A.
2. `File > Export > File Settings`: Image Format **TIFF**, tick **HDR Output**, **leave Maximize Compatibility unchecked**, Color Space **HDR Rec. 2020**, Bit Depth **32 bits**, Compression **ZIP**.
3. Import into HDR Finisher. Expect the badge to read `HDR_TRUE` with a real peak in stops, and Source Interpretation to auto-detect `BT.2020 + LINEAR` with confidence `confirmed` (not the ambiguous/ask-to-review state).

A full round trip on 2026-08-17 nailed the cause of an earlier false negative here. With **Maximize Compatibility checked**, the exported TIFF was genuine `float32` (`SampleFormat: IEEEFP`, ICC profile literally named “Linear Rec. 2020”) but every pixel was clamped to `max 1.0` regardless of the photo's actual HDR content — confirmed by a controlled A/B: the *same* grade at `HDR Limit 8.0`, re-exported with only the Maximize Compatibility checkbox changed, went from a hard-clipped peak of `1.0` (`555.6 nit`, `HDR_LINEAR_UNCONFIRMED`) to genuine unbounded data peaking at `8511 nit` — **6.63 stops above diffuse white** — with `HDR_TRUE` confirmed. Since `HDR Limit` was identical between the two exports and only the checkbox changed, this rules out both of the theories floated earlier in testing (an HDR-Limit-tracking renormalization, and real sensor-level clipping in the source photo) — it was purely an artifact of that one export setting.

No Source Interpretation override should be needed with Maximize Compatibility off; auto-detection already resolves both primaries and transfer function confidently. If you do see the ambiguous/`HDR_LINEAR_UNCONFIRMED` state on a TIFF export, check that checkbox first before troubleshooting anything else.

## Adobe Photoshop (32-bit HDR via Camera Raw)

**Status: hands-on validated 2026-08-17**, via a different and more involved path than originally assumed. `File > Automate > Merge to HDR Pro` and direct EXR/Radiance opening (the original guess for this section) remain untested — the recipe below is the one actually verified.

1. Open the source file. If Camera Raw's JPEG/TIFF Handling preference is set to auto-open compatible files, a TIFF with real HDR content may route through **Camera Raw** automatically instead of opening straight into the canvas — this is expected, not an error.
2. In Camera Raw, select **HDR** (top of the Edit panel, next to Auto/B&W). Before proceeding, expand **Light** and confirm the sliders reflect what you intend — a rendered/flattened TIFF does not carry prior develop history the way a raw file does, so Camera Raw applies a fresh default pass (typically neutral) rather than reconstructing an original edit. Click through to open into the Photoshop canvas.
3. The document lands as **16-bit**, not 32-bit, with a profile resembling `P3D65 PQ Display Full ...` — this is a **display-referred, PQ-encoded** representation (matches the pattern used by HDR photo formats like iPhone HEIC), not scene-linear. `Edit > Convert to Profile` is not safe to use yet: a 16-bit integer document cannot hold values beyond its profile's nominal range, so converting now would clip/destroy the HDR content.
4. **`Image > Mode > 32 Bits/Channel`** first. This decodes the PQ curve into genuine linear light rather than just adding precision — confirmed by direct probe: the resulting document's profile is re-labeled with `(Linear RGB Profile)` appended, and real values exceeding `1.0` appear (validated peak `6.63 stops` above diffuse white, matching HDR Finisher's own reading after import to within 0.01).
5. No further profile conversion is needed at this point — the document is now Display P3 primaries (confirmed by directly parsing the embedded ICC profile's `rXYZ`/`gXYZ`/`bXYZ`/`wtpt` tags; chromaticities match canonical Display P3 to within normal ICC fixed-point rounding) and linear transfer, which is exactly HDR Finisher's **Display P3 Linear** preset.
6. Export with **`File > Save As`** (or **Save a Copy**) — **not `File > Export As`**, which is a real trap: that dialog is 8-bit PNG/JPG/GIF only and has **"Convert to sRGB" checked by default**, silently flattening HDR data to SDR.
7. Choose **TIFF**. In the TIFF Options dialog, confirm **Bit Depth: 32 bit (Float)** (it may default there already if the document is genuinely 32-bit). ZIP compression is fine; no Maximize-Compatibility-style trap was found in this dialog.
8. Import into HDR Finisher. **Auto-detection will likely report the source as ambiguous** — not because the data is wrong, but because the profile name is literally `P3D65 ... Display ...`, not the contiguous phrase "Display P3" the classifier matches on. HDR Finisher correctly detects this and stops to ask via the "Source Interpretation Needs Review" prompt — this part works as intended. The catch is that the *default guess* it offers alongside that prompt (and what "Use assumption" would accept) is **sRGB primaries with an sRGB gamma decode applied**, which is wrong on both counts for this file (wrong primaries, and a double decode on top of already-linear data) and produces badly incorrect color. Don't accept the default here — always override manually for this recipe.
9. Open **Source Interpretation > Manual Override** and set **both** Color Primaries **Display P3 Linear** and Transfer Function **Linear** together — setting only one is not enough (confirmed: primaries alone still left a visible color error until Transfer Function was also corrected). Apply. Expect the badge to clear to `HDR_TRUE` with a real peak in stops and the preview to look like a normal photograph again.

## darktable RAW photo

OpenEXR with linear Rec.2020 is the preferred handoff.

1. Complete RAW development with scene-referred modules.
2. Disable **filmic rgb** or **sigmoid** for this handoff so their display rendering is not baked into the source.
3. Choose **linear Rec2020 RGB** as the output/export profile.
4. Export OpenEXR, 32-bit float, native dimensions, ZIP or PIZ compression.
5. Import and confirm **Scene-Linear Rec.2020**.

A 32-bit TIFF with an embedded linear Rec.2020 profile is a fallback if EXR is unavailable. Avoid ordinary display-referred sRGB, Adobe RGB, or an SDR tone-mapped export when the goal is to preserve scene headroom.

Official background: [darktable output color profile](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/output-color-profile/) and [export options](https://docs.darktable.org/usermanual/development/en/special-topics/program-invocation/darktable-cli/).

## Blender 5.2 LTS

**Validated workflow:** single-layer 32-bit OpenEXR with an explicit output color-space override.

1. In **Output Properties**, choose **OpenEXR** (single layer), RGB/RGBA, and **Float (Full)**.
2. Select ZIP or PIZ compression. Avoid DWAA/DWAB for the finishing master.
3. Under Output Color Management, choose **Override**.
4. With Blender’s standard OCIO configuration, select **Linear Rec.2020**.
5. With a deliberate ACES OCIO pipeline, select **ACEScg** instead.
6. Set Dither to `0.00`.
7. Disable Compositing and Sequencer unless their result is intentionally the finished beauty image.
8. Import the result and confirm the expected interpretation.

Blender 5.2 can write `colorInteropID: lin_rec2020_scene` rather than standard EXR chromaticities. HDR Finisher recognizes this exact ID as Scene-Linear Rec.2020. It also recognizes an explicitly tagged ACEScg result.

Do not select a Display, View Inverse, Log, Non-Color, or other display-referred output for the beauty handoff. The scene’s View Transform, Look, Exposure, and Gamma are useful for Blender viewing, but should not define the interchange encoding.

A validated A/B of matching Linear Rec.709 and Linear Rec.2020 outputs normalized to nearly identical ACEScg pixels in HDR Finisher, confirming that the override changed coordinate encoding rather than the intended render.

Official background: [Blender Color Management](https://docs.blender.org/manual/en/latest/render/color_management.html) and [image formats](https://docs.blender.org/manual/en/latest/files/media/image_formats.html).

## iPhone Apple HDR HEIC

Import the original HEIC/HEIF rather than a screenshot, messaging-app copy, or JPEG conversion.

When supported metadata is present, HDR Finisher:

- Decodes the Display P3 SDR primary
- Reads the auxiliary Apple HDR gain map
- Reads Apple maker-note headroom metadata
- Reconstructs a linear HDR working image
- Retains the original SDR rendition as the neutral fallback reference

Check the Metadata rail for gain-map detection and computed headroom. If an iPhone image arrives as SDR only, confirm that the transfer method did not strip auxiliary images or metadata.

## DxO PhotoLab

**Status: currently not a usable HDR source.** As of PhotoLab 9 (documentation dated March 30, 2026), PhotoLab’s export dialog offers only JPEG, TIFF (8-bit or 16-bit — no 32-bit/float option), and linear DNG (RAW sensor data plus *technical* corrections only: denoise, optics, crop; tonal/color grading is excluded). There is no HDR editing mode, no gain-map export, and no AVIF output, and DxO cannot open EXR or other float HDR sources either (native OpenEXR import remains an open feature request on DxO’s own forum as of this writing).

A 16-bit TIFF out of PhotoLab is display-referred and bounded to `1.0` by construction — HDR Finisher will correctly classify it `SDR_ONLY`, not `HDR_TRUE`. Promoting it to 32-bit in Photoshop afterward (`Image > Mode > 32 Bits/Channel`) adds precision but does not recover headroom that was never captured, so it is not a real HDR workflow.

If you want to use PhotoLab’s denoise/optics correction as a pre-pass ahead of HDR Finisher, the only currently valid order is the reverse: do HDR authoring first (Lightroom, Photoshop, Affinity, a bracketed merge, etc.) to get a true float/HDR file, and treat PhotoLab as an SDR-only tool for other pictures. Do not route an HDR source through PhotoLab expecting its headroom to survive. Revisit this section if a future PhotoLab release adds float TIFF, gain-map, or EXR support.

### A note on the experimental linear DNG path

PhotoLab’s **linear DNG** export can now enter HDR Finisher's experimental DNG/RAW convenience path, but this is not yet a validated PhotoLab HDR workflow. No tone curve should mean the samples retain scene-linear headroom, but real PhotoLab exports still need inspection for populated color matrices, illuminant, as-shot neutral, black/white levels, baseline exposure, and unexpected display rendering. Keep Lensfun Off when PhotoLab already applied optics corrections, and compare against a known float/HDR reference before trusting the result. The older [DNG research questions](../testing/Codebase_Review_Cleanup_and_Round_Trip_Sprint.md#55-dng-research-questions) remain the acceptance checklist rather than a claim that all DNG variants are supported.

## Other applications

For Affinity versions, Blender configurations, renderers, or RAW developers not listed above, use this decision process:

1. Identify the application’s actual scene/output primaries.
2. Export a small test image containing neutral gray, saturated colors, diffuse white, and highlights several stops above it.
3. Prefer single-layer linear EXR with standard chromaticities.
4. Inspect the file in HDR Finisher before grading.
5. Compare with the source application under a known display transform.
6. Record the exact application version and export settings.

Do not promote an untested recipe to “validated” based only on a visually plausible result.

## Source checklist

- [ ] Full resolution
- [ ] Linear transfer (unless deliberately using PQ/HLG input)
- [ ] Known primaries
- [ ] Float or otherwise HDR-capable encoding
- [ ] Lossless compression
- [ ] No baked SDR tone map
- [ ] Intended RGB beauty pass
- [ ] No accidental premultiplication/channel ambiguity
- [ ] HDR Finisher interpretation matches the export exactly

Durable validation observations belong in [Source Export Validation Log](../testing/Source_Export_Validation_Log.md).
