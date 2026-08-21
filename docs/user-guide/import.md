# Import, Metadata, and Source Interpretation

Import is where HDR Finisher decides what the source numbers mean. A perfectly valid EXR can still display the wrong color if its primaries are missing or interpreted incorrectly.

## Recommended source

For photography or CGI, prefer:

- Single-layer RGB or RGBA OpenEXR
- 32-bit float when practical; 16-bit half is also an HDR-capable representation but is not the primary documented handoff
- Linear transfer function
- Explicit, supported primaries
- ZIP or PIZ lossless compression
- Native dimensions
- No display tone map baked in

See [Source preparation](../workflows/source-preparation.md) for application-specific recipes.

## Import controls

- **Choose image:** opens a file chooser.
- **Eject current image:** removes the active in-memory session and its temporary source copy.
- **Load test pattern:** creates a calibrated internal HDR pattern for learning the controls and checking the display path.
- Drag and drop is supported in the viewer.

Accepted extensions include EXR, TIFF, HDR, PFM, HEIC/HEIF, AVIF, JPEG XL, PNG, JPEG, DNG, and selected camera RAW formats. Acceptance only means the loader understands the container. PNG/JPEG sources are normally SDR unless they contain a separately supported HDR representation.

## Experimental DNG Import

DNG import is experimental and intentionally variant-gated. Before reading the full pixel payload, HDR Finisher selects the largest full-resolution primary, distinguishes a three-channel LinearRaw image from a CFA mosaic, checks required metadata/opcodes/codecs, and performs a conservative memory preflight. Reduced previews and Lightroom Fast Load proxies are never accepted as the primary.

The tested implementation supports uint16 and float16/float32, contiguous three-channel LinearRaw primaries with DNG matrix color metadata, plus ordinary mosaiced DNGs handled by the existing rawpy/LibRaw path. It implements OpcodeList3 `GainMap` and `WarpRectilinear` at the post-demosaic camera-linear stage for the audited LibRaw 0.22.1 build. Unsupported mandatory operations, non-unit `DefaultScale`, unusual sample/layout variants, missing codecs, and unsafe allocations are rejected instead of ignored.

Mosaiced camera RAW development keeps LibRaw auto-brightening disabled so the imported scene-linear pixels and highlight headroom are not destructively rescaled or clipped. On first import, HDR Finisher instead meters one conservative median/highlight recommendation and applies it to the HDR and generated SDR branches as an editable Tone exposure. This is deliberately visible in the controls rather than baked into the decoded pixels; resetting Tone removes the recommendation. By contrast, metadata-defined DNG black/white normalization, baseline exposure, color transforms, and clipped-highlight reconstruction are decoder operations because they are required to interpret that DNG's samples.

Scene-linear EXR does not receive a metered exposure adjustment. Its generated SDR rendition starts from the normal Filmic transform at zero Exposure. If an imported gain-map image contains an authored SDR base, that display rendition is used directly and Highlight Recovery starts at zero to avoid adding the app's scene-render shoulder a second time.

Some linear-RGB applications, including the validated Affinity EXR workflow, store diffuse white at `1.0` rather than HDR Finisher's scene-linear `0.18`. When the source application is known, choose **1.0 = diffuse white (Affinity)** under Source Interpretation. HDR Finisher applies the exact `0.18` normalization before grading, leaving HDR and SDR Exposure at zero. Do not choose it for ordinary scene-linear EXR files whose diffuse-white convention is already `0.18`.

For accepted LinearRaw DNGs, **Camera native (embedded DNG profile)** is the source interpretation. The importer applies the DNG black/white normalization, as-shot neutral, interpolated camera matrices, chromatic adaptation, and baseline exposure, then stores the result in the ACEScg working space. ACEScg is therefore not an assertion about the file's original primaries, and manual RGB-primary reinterpretation is disabled for this already-developed source.

Integer LinearRaw channels lose their original ratios when they reach the DNG linear-response/encoding limit. To prevent the camera matrix from turning that missing ratio into pink, blue, or green lamp and bokeh artifacts, the importer first identifies a confirmed clipped core. It derives the camera-neutral ratio represented by the embedded DNG transform, reconstructs the lowest neutral signal consistent with the surviving channels (including values above the encoding limit), and blends toward that reconstruction through a continuous local confidence field. This retains an exposure-responsive highlight intensity profile instead of baking a flat gray patch into ACEScg. Signal level alone never activates recovery, so equally bright saturated subjects away from a clipped core remain unchanged. This import-stage recovery is automatic and independent of the grading pipeline's [highlight compression](../technical/highlight-compression.md). It is conservatively skipped when a post-demosaic GainMap makes the original encoding limit ambiguous.

The Metadata rail identifies the route, matrix path, required operations, and warnings. Automatic Lensfun correction is disabled when mandatory DNG corrections are applied, and an explicitly overlapping manual Lensfun request is rejected. Large CPU-safe sources use bounded preview proxies rather than one full-resolution GPU texture. Full-resolution export receives a separate memory preflight.

This is not universal DNG or camera compatibility. The current local sample matrix proves structural routing and successful decode; producer-reference comparisons and macOS resource validation must finish before color, shading, geometry, or DJI visual compatibility can be signed off. See the [Experimental DNG validation record](../testing/Experimental_DNG_Import_Validation_2026-08-20.md).

## What the application inspects

The Metadata rail reports information available from the file and loader, including dimensions, channels, data type, bit depth, camera/lens fields when present, color metadata, transfer metadata, EXR attributes, and Apple HDR information.

The application also calculates:

- A peak linear value
- Stops above its diffuse-white reference
- An HDR classification
- Whether a manual color override is required

The source is then normalized into the internal working representation when the interpretation is sufficiently known.

## Classifications

| State | Meaning | Action |
|---|---|---|
| True HDR | The file has linear values above diffuse white or a supported auxiliary HDR gain map. | Confirm color interpretation and continue. |
| HDR encoded | PQ or HLG metadata describes a display-referred HDR source. | Confirm that the metadata matches the actual file. |
| Linear, unconfirmed | Float/linear data contains headroom, but primaries are ambiguous. | Select the exact source primaries before judging color. |
| SDR only | No trustworthy HDR headroom or HDR encoding was detected. | Use a better handoff if HDR information was expected. |

Classification is diagnostic, not a quality score. An image can be genuine HDR and still contain poor color metadata, clipping, noise, or an unsuitable display rendering.

## Auto Detect and Manual Override

**Auto Detect** uses ICC information, HEIF color properties, EXR `chromaticities`, recognized OCIO `colorInteropID` values, extension-based transfer hints, and other supported metadata.

Use **Manual Override** only when you know the upstream encoding. Select primaries and transfer separately:

### Color Primaries

- Scene-Linear sRGB / Rec.709
- Scene-Linear Rec.2020
- ACEScg Linear
- Display P3 Linear

### Transfer Function

- Linear
- PQ
- HLG
- sRGB

The UI labels the primaries choices “Scene-Linear” for clarity, but transfer is still a separate field. For example, BT.2020/PQ and linear BT.2020 share primaries but do not share numeric encoding.

## Why guessing is dangerous

Assigning the wrong primaries changes hue and saturation because the RGB coordinates describe different real colors. Assigning the wrong transfer changes brightness nonlinearly:

- Treating PQ as linear makes most values far too dark or incorrectly scaled.
- Treating linear data as sRGB applies an unwanted decoding curve.
- Treating Display P3 coordinates as sRGB changes saturated colors.
- Treating ACEScg as Rec.2020 produces a subtler but still real color error.

Do not choose whichever option appears closest on the current display. Return to the source application or its export settings and identify the actual encoding.

## EXR-specific behavior

OpenEXR pixels are commonly linear, but primaries are not guaranteed. The `chromaticities` attribute is optional and many applications omit it. HDR Finisher recognizes standard chromaticities for ACEScg, BT.2020, sRGB/Rec.709, and Display P3, plus selected OCIO interoperability IDs.

If chromaticities and `colorInteropID` conflict, manual review is required. If both are absent, the application deliberately avoids silently transforming unknown linear primaries.

The OpenEXR project explains why RGB channel names alone do not define color in its [technical introduction](https://openexr.com/en/latest/TechnicalIntroduction.html).

## HEIC/HEIF behavior

For supported Apple HDR photographs, the loader extracts the SDR image, auxiliary gain map, and Apple headroom metadata, then reconstructs an HDR working image. The authored SDR image is retained as a reference for neutral SDR defaults.

Not every HEIC is an Apple HDR gain-map image. A plain HEIC may be SDR, PQ, HLG, or otherwise encoded depending on its properties.

## Under the hood

The loader produces float32 RGB values, records the chosen source space and transfer, and calls the color normalization stage. Known linear RGB spaces are converted to ACEScg with CAT02 chromatic adaptation. PQ and HLG paths are decoded to luminance, scaled to the app convention, converted from BT.2020 to ACEScg, and sanitized. Unknown linear primaries are retained without an irreversible gamut transform until the user resolves them.

Changing interpretation reloads the source and rebuilds the session; it is not a cosmetic viewer setting.

## Watch out for

- Tone-mapped EXRs that no longer contain the intended scene range
- Integer TIFFs labeled “32-bit” but bounded to an SDR-normalized range
- Layered/multichannel EXRs where the intended beauty RGB is ambiguous
- Lossy DWAA/DWAB compression for a finishing master
- ICC profile assignment instead of conversion in the source editor
- Negative scene values: the current normalization sanitizes/clips them rather than preserving them as a signed working range
- Sources above 10,000 nits: the PQ delivery path has a 10,000-nit ceiling
