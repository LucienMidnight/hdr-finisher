# Gain Maps and Output Formats

A gain-map image packages two creative endpoints into one adaptive file:

- The **SDR base** that ordinary viewers can display.
- Information describing how to recover the **HDR rendition** when the viewer and display have enough headroom.

This is different from a single fixed PQ image. It is designed to adapt between displays while preserving a useful legacy rendition.

## A simple mental model

Imagine the SDR and HDR images aligned pixel for pixel. For each pixel, the encoder asks how much brighter or darker the HDR linear-light result should be than the SDR result. That ratio is stored logarithmically in a gain map, along with metadata that describes its range and how it should be applied.

At display time:

1. Decode the SDR base.
2. Determine available display boost/headroom.
3. Decode the logarithmic gain map.
4. Apply none, some, or all of the gain according to display capacity.
5. Present the adapted HDR rendition.

The Android [Ultra HDR Image Format](https://developer.android.com/media/platform/hdr-image-format) provides a public technical description of this model and recommends carrying both Ultra HDR v1 and ISO 21496-1 metadata in JPEG for cross-platform compatibility.

## Why logarithmic gain

Brightness ratios are naturally expressed in stops:

```text
gain in stops = log2((HDR + offset HDR) / (SDR + offset SDR))
```

The offsets stabilize very dark or zero values. Metadata records minimum/maximum gain, gamma, capacity range, offsets, and which rendition supplies the base color space.

The actual standards contain more detail, per-channel possibilities, quantization, and container rules; the equation above is the useful working intuition.

## Display boost and content boost

- **Content boost:** how much HDR expansion the encoded image asks for.
- **Display boost:** how much expansion the current display can make available above SDR white.
- **Applied boost:** constrained by both.

A display’s boost can change with settings, ambient conditions, thermals, average picture level, and power state. This is why browser rendering is adaptive rather than a fixed reproduction of the brightest authored endpoint.

## JPEG Ultra HDR

JPEG Ultra HDR is SDR-first and backward compatible:

- Legacy readers decode the primary SDR JPEG.
- Supporting readers locate the secondary gain map and metadata.
- HDR Finisher writes Ultra HDR v1 XMP and ISO 21496-1 metadata using the same gain-map image.

Strengths:

- Ordinary JPEG fallback behavior
- Familiar extension and broad legacy decoding
- Good fit for photography workflows

Risks:

- Recompression often strips the gain map
- Metadata can be removed while leaving a valid SDR JPEG
- The 8-bit gain map is sensitive to quality and spatial downsampling
- Application/browser support remains version-dependent

## AVIF with gain map

HDR Finisher combines an SDR base and a BT.2020/PQ alternate into an AVIF gain-map file, with a separate 10-bit gain map. Primary-image and gain-map chroma are independently selectable. The built-in Web Default keeps the primary at 4:2:0 but the gain map at 4:4:4 because test-pattern measurements found no size benefit and materially worse colored-edge error from a 4:2:0 gain map. Encoder-supported monochrome gain maps are not exposed because they cannot preserve per-channel gain in saturated highlights.

Strengths:

- High compression efficiency
- Higher gain-map precision in the current implementation
- Validated Chromium-oriented delivery path

Risks:

- Less universal decoding than ordinary JPEG
- Servers may send the wrong MIME type or transform the file
- A decoder may ignore the gain map or fail rather than display the base

## SDR PNG

SDR PNG is not adaptive HDR. It is a lossless-container, 8-bit sRGB export of the authored base. It is useful as a fallback, diagnostic reference, or separate delivery.

## SDR JPEG

SDR JPEG is not adaptive HDR. It is a conventional 8-bit sRGB export of the authored base, encoded with adjustable quality and selectable 4:2:0, 4:2:2, or 4:4:4 chroma sampling. It is useful for compact standalone delivery and line-scan images up to the bundled encoder's 65,500-pixel per-axis limit.

## Resolution and edge behavior

The gain map represents differences between two aligned images. Reducing its resolution can work well for broad luminance transitions but can produce halos or color/brightness errors along small bright edges.

Use full-resolution gain maps when the image contains:

- Fine emissive text or graphics
- Specular hair, foliage, jewelry, or particles
- High-contrast colored edges
- Bright CGI lines against black
- Detailed windows or practical lights

Half-resolution can be reasonable after A/B testing on representative material.

## What can break during delivery

- File recompression
- Resizing
- Format conversion
- Metadata stripping
- Wrong MIME type
- CDN optimization
- Social-media ingestion
- Messaging-app forwarding
- Screenshotting or clipboard conversion

A byte-identical hosted file is the strongest evidence that the container survived. A visual HDR result is still required because a preserved file can be decoded differently by the viewing platform.

## Compatibility language

Avoid saying simply “supported everywhere.” Prefer explicit statements:

- Container can be opened as SDR by a named legacy viewer.
- Gain map is detected by a named browser/version.
- HDR was observed on a named OS/display configuration.
- Uploaded bytes were preserved by a named hosting path on a stated date.

That language remains useful as software support changes.
