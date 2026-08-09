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
