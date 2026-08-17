# Color-Pipeline Specification

This page describes what the current implementation does, not an abstract ideal and not every future intention in the PRD. It is the reference for integrating a source, control, preview path, scope, or exporter.

## Pipeline summary

```text
file bytes
  -> decode container and metadata
  -> determine primaries + transfer
  -> normalize to non-negative float32 scene-linear ACEScg
  -> author HDR and SDR branches
  -> measure scopes / create overlays
  -> convert to display or encoder representation
  -> encode and validate gain-map or SDR output
```

## Core conventions

| Property | Current convention |
|---|---|
| Internal RGB space | ACEScg / AP1 primaries, D60 white |
| Internal numeric type | NumPy float32 RGB |
| Internal transfer | Linear |
| Diffuse-white anchor | ACEScg linear `0.18` = 100 nits |
| HDR delivery gamut | BT.2020 |
| HDR delivery transfer | PQ / ST 2084 |
| PQ ceiling | 10,000 nits |
| SDR rendition | Display-linear sRGB/BT.709 primaries, then sRGB encoding |
| Chromatic adaptation | CAT02 in colour-science RGB conversions |
| Negative final values | Clipped/sanitized to zero |

The `0.18 = 100 nits` relationship is an application authoring convention. It is used consistently in PQ conversion, scopes, rolloff placement, proofing, and peak calculations.

```text
reference nits = linear ACEScg-relative value / 0.18 * 100
linear value   = reference nits / 100 * 0.18
```

## Source interpretation

The source container does not by itself define color. The application needs:

1. RGB primaries/white point
2. Transfer function
3. Pixel values and range

Supported manual primaries are ACEScg, BT.2020, Display P3, and sRGB/Rec.709. Supported manual transfer interpretations are Linear, PQ, HLG, and sRGB. AVIF auto-detection also accepts CICP transfer code `1` as BT.709.

### Metadata priority and uncertainty

- ICC/profile information is used for supported TIFF/Pillow paths.
- EXR `chromaticities` is compared with known primaries.
- Recognized EXR/OCIO `colorInteropID` values include `lin_rec709_scene`, `lin_rec2020_scene`, `lin_p3d65_scene`, and `lin_ap1_scene`.
- If standard chromaticities and an interoperability ID disagree, review is required.
- An EXR without known primaries remains untransformed until the user supplies them.
- PQ and HLG supported inputs imply BT.2020 in the current normalization path.

This differs deliberately from OpenEXR’s historical fallback recommendation to assume Rec.709 when chromaticities are absent. HDR Finisher does not make that irreversible assumption for ambiguous HDR handoffs because contemporary CGI/photo pipelines commonly use ACEScg or Rec.2020.

## Normalization to ACEScg

### Linear RGB

Known linear source RGB is converted with `colour.models.RGB_to_RGB` and CAT02 chromatic adaptation. ACEScg is an identity path.

If sRGB or Display P3 is selected with sRGB transfer, the sRGB CCTF is decoded before the primary conversion. AVIF tagged with CICP transfer code `1` uses colour-science's BT.709 inverse OETF instead; it is not silently treated as the numerically different sRGB curve. Linear P3 and linear sRGB/Rec.709 are not decoded again.

### PQ input

PQ values are clamped to 0–1 and decoded with ST 2084 to absolute nits:

```text
BT.2020 PQ -> ST 2084 EOTF -> nits
linear BT.2020 = nits / 100 * 0.18
linear BT.2020 -> ACEScg (CAT02)
```

### HLG input

HLG values are decoded with colour-science’s BT.2100 HLG EOTF using `L_B = 0` and `L_W = 1000` nits, then scaled and converted like PQ.

This 1,000-nit system assumption must be documented whenever HLG input behavior is discussed. It is not inferred from source mastering metadata.

### Integer sources

Integer arrays are normalized by their data-type maximum before transfer/color processing. High integer precision alone does not create HDR headroom; a bounded linear integer TIFF may remain at or below `1.0`.

### Sanitization

Arrays become float32. NaN and negative infinity become 0; positive infinity becomes 65,504 before non-negative clipping. Negative scene values are not preserved by the current pipeline.

## Apple HDR HEIC reconstruction

For supported Apple gain-map HEIC:

1. Decode the Display P3 SDR primary and auxiliary gain map.
2. Decode both from the sRGB-family transfer to linear values.
3. Derive headroom from supported Apple maker-note fields.
4. Compute a per-pixel scale:

```text
scale = 1 + (headroom - 1) * linear gain map
HDR Display P3 linear = SDR Display P3 linear * scale
```

5. Normalize reconstructed Display P3 linear to ACEScg.
6. Separately convert the authored SDR primary from Display P3 to linear sRGB and retain it as `sdr_reference_image`.

This is an Apple-specific auxiliary-gain reconstruction, distinct from the later JPEG/AVIF export gain maps.

## HDR adjustment branch

The HDR branch remains linear ACEScg. Current order:

1. Exposure (`2^EV`)
2. Shadow/black adjustment
3. Contrast about a linear pivot
4. Highlights section: Soft Ceiling or Peak Fit, with optional ACEScg path to white
5. White balance
6. ACEScg primary/tint matrix
7. Saturation and vibrance
8. Monotonic scene-EV Exposure Bands
9. Lift/Gamma/Gain luminance zones
10. HDR-domain luma/R/G/B curves
11. Film Response and subtractive Color Density
12. Halation
13. Bloom/Diffusion
14. Image Softness and Microcontrast
15. Seeded density-aware Grain
16. Final non-negative clip

HDR luma coefficients are ACEScg-derived: `0.2722287 R + 0.6740818 G + 0.0536895 B`.

Peak Fit predicts the measured source peak after the independently bypassable Tone section, then anchors the Highlights-stage luminance to Target Peak. Preserve color scales RGB together. The optional AgX-inspired path-to-white reduces chroma through the shoulder and constrains individual ACEScg channels to the target. Later creative sections are deliberately not peak constrained.

## SDR adjustment branch

### From a scene-linear source

1. SDR exposure and shadow in ACEScg
2. Independent SDR color in ACEScg, optionally initialized by copying the HDR color controls
3. Tone-map ACEScg luma
4. Convert to display-linear sRGB with CAT02
5. Compress to the sRGB cube toward display luma
6. Highlight Recovery and contrast
7. Lift/Gamma/Gain
8. SDR-domain curves
9. Film Response/Color Density, Halation, Bloom, Image Structure, and Grain

### From an authored SDR HEIC reference

The display-linear sRGB reference is the neutral base. Non-neutral Base Rendition approximately inverts the neutral filmic sigmoid to estimate scene luminance, then applies the chosen tone curve. Color changes temporarily convert to ACEScg and return to sRGB.

### Tone-map formulas

- **Reinhard:** `x / (1 + x)`
- **ACES:** compact rational approximation using coefficients `2.51, 0.03, 2.43, 0.59, 0.14`, normalized by its asymptote
- **Filmic:** a log-exposure sigmoid passing through `0.18`, with separate shadow/highlight powers derived from Contrast and Skew

These are application operators. The “ACES” choice is not a complete ACES RRT/ODT and should not be documented as one.

## Curves

Both branches use monotone cubic interpolation with 2–16 points and a 1,024-sample LUT.

SDR curves use the bounded 0–1 domain. HDR curves map:

- ACEScg values from 0 to `0.18` linearly into graph 0 to 0.5.
- Values from `0.18` to the 10,000-nit equivalent logarithmically into graph 0.5 to 1.

Values beyond graph endpoints are extended with endpoint slopes before conversion back to the branch domain.

## Film Look

Both branches carry the same nested `film_look` schema and a separate top-level bypass. Film Response works in a perceptual branch domain, so the HDR path retains values above diffuse white rather than applying an SDR print ceiling. Halation and Bloom qualify highlights relative to that branch. Spatial radii are stored as percentages of image diagonal.

The CPU renderer and two-pass WebGPU renderer use the same operation order and parameter meanings. `shared.film_grain_seed` anchors the spatial grain field across HDR and SDR; branch-specific response controls may change its amplitude but not its phase. The Halation qualification map is a viewer diagnostic and export backends force it off on a deep copy of the adjustment state.

## Scopes and overlays

Scopes call the same adjustment pipeline on a processed proxy/cache.

- HDR reference nits use `linear / 0.18 * 100`.
- HDR luma statistics use ACEScg coefficients.
- SDR luma uses Rec.709/sRGB coefficients `0.2126, 0.7152, 0.0722`.
- False color and zebras are diagnostic overlays rendered separately; they do not enter export.

Scopes describe encoded/processed image values, not photons emitted by the monitor.

## HDR preview and AVIF alternate

The HDR image is converted from ACEScg to linear BT.2020 with CAT02, clipped to the non-negative PQ range, mapped to nits using the core convention, and ST 2084 encoded:

```text
nits = clamp(linear BT.2020 / 0.18 * 100, 0, 10000)
PQ   = ST2084_OETF(nits / 10000)
```

The YUV transport uses BT.2020 non-constant-luminance coefficients and 10-bit limited-range YUV444 signaling in the current encoder path. AVIF is tagged CICP `9/16/9` (BT.2020 primaries / PQ transfer / BT.2020 non-constant matrix).

The SDR base is tagged `1/13/0` (BT.709 primaries / sRGB transfer / RGB identity).

## JPEG Ultra HDR encoder interface

libultrahdr accepts a linear BT.2020 half-float HDR input whose `1.0` represents its 203-nit SDR reference. HDR Finisher rescales while preserving absolute intent:

```text
libultrahdr linear = ACEScg-to-BT.2020 linear * (100 / 0.18) / 203
```

Values are clipped to `10000 / 203`. The SDR input is sRGB RGBA8888. The target HDR peak is computed from BT.2020 luma and clipped to the encoder-supported 203–10,000-nit range.

The exported file is accepted only after marker inspection finds Ultra HDR v1 and ISO 21496-1 metadata and libultrahdr can decode it.

## Gain-map proofing

The proof system decodes the encoded base/alternate relationship and reconstructs at a requested display headroom. It uses a log2 gain formula with gain minimum/maximum, gamma, offsets, and capacity bounds. SDR display-linear values are converted back into the app’s working scale (`sRGB -> ACEScg`, then `* 0.18`) before PQ proof-tile encoding.

The public [Ultra HDR specification](https://developer.android.com/media/platform/hdr-image-format) is useful background, but the repository code and encoder versions define the exact current behavior.

## Known scientific/engineering boundaries

- No spectral processing or appearance model
- No preservation of negative scene values
- Simple luma-oriented SDR gamut compression
- HLG fixed at a 1,000-nit decoding assumption
- No automatic source-space support beyond the named interpretations
- No mastering-display metadata authoring UI
- Browser/display tone mapping is outside the authoritative export renderer
- ACEScg primary-shaping extremes can create colors no output gamut can reproduce

Changes to any convention in this document require coordinated code, tests, user-guide, proofing, and export updates.
