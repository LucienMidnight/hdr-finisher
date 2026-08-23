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
- One file carries both the authored SDR base and adaptive HDR reconstruction

Risks:

- Recompression often strips the gain map
- Metadata can be removed while leaving a valid SDR JPEG
- Both the SDR base and logarithmic gain map are stored as 8-bit JPEG data, so gradients and large gain ranges are more sensitive to quantization and compression than the 10-bit AVIF gain-map path
- Application/browser support remains version-dependent

“8-bit” describes the two JPEG-coded components, not the final display buffer.
A compatible viewer reconstructs HDR from the 8-bit SDR base, the 8-bit gain
map, and floating-point gain metadata. An incompatible viewer simply opens the
ordinary SDR JPEG. This backward-compatible model is the format's major
advantage. Google's [libultrahdr reference
implementation](https://github.com/google/libultrahdr) documents the same SDR
base plus gain-map behavior.

At export, HDR Finisher constrains the JPEG gain-map boost range to four stops
of per-channel latitude below and above unity, expanding the upper bound when
needed to include the authored HDR peak. This delivery-only guardrail prevents
near-zero color-channel ratios from exhausting the 8-bit map's precision while
retaining intentional HDR/SDR color separation.

HDR Finisher also removes pixel-scale variation from the generated logarithmic
JPEG gain map with a conservative filter guided by the unchanged SDR primary.
Real base-image edges therefore remain sharp, while source noise or small
HDR/SDR processing differences are less likely to become coarse multiplicative
texture when a browser reconstructs HDR. Neither authored endpoint is denoised.

## AVIF with gain map

HDR Finisher combines an SDR base and a BT.2020/PQ alternate into an AVIF gain-map file, with a separate 10-bit gain map. Primary-image chroma is selectable; gain-map chroma is fixed at 4:4:4. The built-in Web Default keeps the primary at 4:2:0 because test-pattern measurements found no useful size benefit and materially worse colored-edge error from a 4:2:0 gain map. Encoder-supported monochrome gain maps are not exposed because they cannot preserve per-channel gain in saturated highlights.

The bundled AVIF encoder already discards the outer 0.1% of ratio outliers when
choosing each channel's gain range. Its 10-bit map therefore receives an
automatic range optimization without altering the rendered HDR or SDR endpoint
images.

An equivalent spatial denoise is not yet applied to AVIF. Its 10-bit map and
different encoder/decoder path require separate corpus and physical-display
validation; that investigation is retained on the product roadmap.

Strengths:

- High compression efficiency
- Higher gain-map precision in the current implementation
- Validated Chromium-oriented delivery path

Risks:

- Less universal decoding than ordinary JPEG
- Servers may send the wrong MIME type or transform the file
- A decoder may ignore the gain map or fail rather than display the base

AVIF itself can theoretically code images up to 65,536 pixels on an axis, but
that number is not a useful promise of application compatibility. The bundled
libavif tooling uses practical safety defaults of **268,435,456 total pixels**
(`16,384 × 16,384`) and **32,768 pixels on either axis** to avoid memory and
integer-overflow failures. JPEG XL can therefore be a useful alternative for
images beyond those practical AVIF limits. These are libavif defaults, not a
universal AVIF-format ceiling; see the official [libavif limit
definitions](https://github.com/AOMediaCodec/libavif/blob/main/include/avif/avif.h)
and [AVIF specification](https://github.com/AOMediaCodec/av1-avif/blob/main/index.bs).

## JPEG XL HDR

JPEG XL HDR stores the graded Rec.2020/PQ image directly rather than packaging
an SDR base plus gain map. It is a strong choice for preserving high-bit-depth
HDR images, exchanging them with a known compatible editor, or retaining very
large images that exceed the bundled AVIF tooling's practical limits. HDR
Finisher offers 10- and 12-bit integer, 16-bit integer, 16-bit float, and 32-bit
float output. The JPEG XL reference implementation describes native HDR support
through full-precision computation and explicit color/transfer signaling in its
[format overview](https://github.com/libjxl/libjxl/blob/main/doc/xl_overview.md).

Strengths:

- Direct high-bit-depth HDR without an 8-bit base-image bottleneck
- Lossy or lossless high-fidelity preservation and interchange
- Better fit than the bundled AVIF route for extremely large pixel dimensions
- Explicit Rec.2020/PQ signaling in HDR Finisher exports

Risks:

- No embedded authored SDR fallback or gain map
- An SDR device depends on the viewer to tone-map the PQ image; unsupported or simplistic viewers may fail to open it or present it poorly
- Browser and general-viewer support remains uneven, so it is not a safe universal web-delivery format
- Higher precision can increase file size and does not make a lossy quality setting lossless

Safari added JPEG XL in version 17, but WebKit still recommends providing a
fallback for browsers without support. The current Chromium/Electron runtime
used by HDR Finisher does not natively decode JPEG XL. WebKit's 2026 JPEG XL
work is still described as an interoperability investigation, which supports
calling browser delivery *uneven* rather than *unsupported everywhere*. See
[Safari 17's JPEG XL notes](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)
and [Interop 2026](https://webkit.org/blog/17818/announcing-interop-2026/).

## SDR PNG

SDR PNG is not adaptive HDR. It is a lossless sRGB export of the authored base,
available in 8 or 16 bits per channel. It is useful as a broadly readable SDR
fallback, diagnostic reference, or higher-precision interchange file. Its main
cost is file size, especially at 16 bits.

## SDR JPEG

SDR JPEG is not adaptive HDR. It is a conventional 8-bit sRGB export of the
authored base, encoded with adjustable quality and selectable 4:2:0, 4:2:2, or
4:4:4 chroma sampling. It is the smallest and most broadly compatible option
for ordinary standalone SDR delivery, but it is lossy and carries no HDR data.

## JPEG XL SDR

JPEG XL SDR stores only the authored 8-bit sRGB rendition. It can provide good
compression for a JPEG XL-aware editor or archive, but it has neither an HDR
rendition nor a gain map. Because browser, service, and viewer support is still
uneven, it should be chosen only when the receiving workflow is known to accept
JPEG XL.

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
