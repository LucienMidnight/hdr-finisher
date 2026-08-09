# HDR Without the Jargon

HDR images can describe a wider difference between ordinary surfaces and bright light sources than SDR images. The goal is not to make the whole photograph brighter. It is to create a believable hierarchy: paper, skin, paint, and clouds can remain comfortable while reflections, lamps, sunlit edges, fire, or emissive materials have room to feel luminous.

## Three ideas are enough to start

### 1. Diffuse white is not the brightest possible white

Diffuse white represents an ordinary bright reflecting surface. HDR reserves values above it for light, reflections, and unusually bright surfaces.

HDR Finisher uses 100 nits as diffuse white in its authoring convention. That does not mean every white object must be exactly 100 nits; it is the reference around which the tools and scopes are organized.

### 2. A stop is a doubling of light

| Stops above diffuse white | Reference luminance |
|---:|---:|
| 0 | 100 nits |
| 1 | 200 nits |
| 2 | 400 nits |
| 3 | 800 nits |
| 3.32 | about 1,000 nits |
| 4 | 1,600 nits |
| 5 | 3,200 nits |
| 6 | 6,400 nits |
| 6.64 | about 10,000 nits |

Thinking in stops makes HDR less mysterious: the difference between 100 and 400 nits is two stops, not “300 brightness units.”

### 3. The display decides how much of the range it can show

A 400-nit display cannot reproduce a 1,000-nit authored highlight literally. A gain-map-aware viewer adapts the relationship to the available headroom. A stronger display can apply more of the intended boost.

Therefore, an HDR image has both content intent and display adaptation. Different displays can be correct without being identical.

## Nits and code values are different

A nit (`cd/m²`) describes emitted luminance. An RGB value describes data in a particular color space and transfer function.

The number `0.5` might mean:

- Half of a linear reference in one working space
- A nonlinear sRGB code value
- A PQ signal corresponding to a specific absolute luminance
- An HLG signal interpreted relative to a display/system peak

Never reason about a number without knowing its encoding.

## Scene-referred and display-referred

### Scene-referred

Values represent relative scene light or a rendered scene before a final display transform. OpenEXR is commonly used for this. Values above `1.0` are normal and useful; `1.0` is not inherently a clipping boundary.

### Display-referred

Values describe the intended display output. PQ is an absolute display-referred HDR transfer function capable of representing up to 10,000 nits. SDR sRGB is also display-oriented, though its exact physical brightness depends on the viewing system.

HDR Finisher prefers a scene-linear handoff, grades internally in scene-linear ACEScg, and uses display-referred encodings for preview and delivery.

## Primaries and transfer functions

These solve different questions:

- **Primaries/gamut:** What real colors do R, G, and B coordinates describe? Examples: sRGB/Rec.709, Display P3, Rec.2020, ACEScg.
- **Transfer function:** How does a stored number relate to light? Examples: Linear, sRGB, PQ, HLG.

“Rec.2020” alone does not tell you whether the values are linear, PQ, or HLG. “PQ” normally implies a BT.2100/BT.2020 HDR context in the application’s supported paths, but it is still useful to keep the two concepts separate.

## PQ and HLG

The current [ITU-R BT.2100](https://www.itu.int/rec/R-REC-BT.2100) standard defines both systems.

- **PQ/ST 2084:** maps code values to absolute display luminance up to 10,000 nits. HDR Finisher uses PQ for HDR preview and alternate export encoding.
- **HLG:** was designed for broadcast workflows and a degree of legacy compatibility. Its appearance depends on system/display assumptions. HDR Finisher supports HLG input under a current 1,000-nit decoding assumption, then normalizes it to the internal working representation.

Do not use PQ and HLG labels interchangeably.

## HDR color

HDR expands brightness and often arrives with wide-gamut color, but the two are separate. A color can be:

- Bright but inside sRGB
- Dim but outside sRGB
- Both wide-gamut and bright
- Neither

Increasing saturation is not “making HDR.” HDR’s most distinctive contribution is luminous range and the contrast between diffuse and emissive/specular regions.

## Why the SDR version still matters

Most gain-map formats are SDR-first. The ordinary image is the base; HDR-capable viewers use a gain map to reconstruct more range. Unsupported software shows only the SDR image.

An excellent HDR rendition with a poor SDR fallback is an incomplete delivery.

## Common misconceptions

- **“My monitor says HDR, so it shows the file accurately.”** HDR signal acceptance does not guarantee peak output, contrast, gamut, or accurate tone tracking.
- **“Anything above 100 nits should be clipped on a 100-nit display.”** A viewer can tone-map or apply only part of a gain map.
- **“A 10,000-nit PQ container means the image should peak at 10,000 nits.”** It only defines the available encoding range.
- **“More nits always means better HDR.”** Black level, sustained brightness, local contrast, gamut, and accuracy also matter.
- **“Scopes replace an HDR monitor.”** Scopes measure the signal; they cannot show the physical display result.
