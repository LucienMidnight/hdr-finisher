# Glossary

## ACEScg

A scene-linear RGB working space using AP1 primaries and a D60 white point. HDR Finisher uses it for internal float32 processing. This does not mean the application implements the entire ACES reference rendering system.

## ABL (Automatic Brightness Limiter)

Display behavior that reduces brightness when a large portion of the screen is bright, common on emissive displays. It can make the same highlight appear different as viewport size or surrounding content changes.

## BT.2020 / Rec.2020

A wide RGB primary set and signal framework used by UHD/HDR systems. It describes color coordinates, not by itself whether values are linear, PQ, or HLG.

## BT.2100

The ITU HDR television recommendation that defines PQ and HLG systems with wide-gamut colorimetry.

## CAT02

A chromatic-adaptation transform used to convert colors between spaces with different white points. HDR Finisher’s colour-science RGB conversions currently request CAT02.

## CICP

Compact numeric metadata identifying color primaries, transfer characteristics, and matrix coefficients in media containers.

## Chromaticities

CIE x,y coordinates defining RGB primaries and a white point. OpenEXR can store them in its optional `chromaticities` attribute.

## Diffuse white

The project brightness assigned to an ordinary reflecting white surface, distinct from source diffuse-white metadata, a light source, or a specular highlight. HDR Finisher maps internal linear `0.18` to the selected HDR Reference White: 203 nits by default or 100 nits in the controlled preset.

## Display P3

An RGB space using P3-family primaries, D65 white, and normally an sRGB-like transfer function. “Display P3 Linear” uses the same primaries/white but linear values.

## Display-referred

Image values shaped for a display response or absolute display luminance. PQ and SDR sRGB delivery are display-referred representations.

## EDR

Apple’s Extended Dynamic Range display concept/API. It describes headroom above SDR white in supported Apple display pipelines. HDR Finisher does not currently read native macOS EDR telemetry.

## EOTF

Electro-optical transfer function: maps encoded signal values to displayed light. PQ/ST 2084 is an EOTF.

## EV / stop

A logarithmic light ratio. One stop higher is twice the linear light; one stop lower is half.

## Gain map

An auxiliary image storing logarithmic differences between SDR and HDR renditions. A compatible viewer combines it with the base according to available display headroom.

## Gamut

The set of colors represented or reproducible by a color space/device. Wide gamut and high dynamic range are related in many formats but are not the same property.

## HDR

High dynamic range: image representation and display behavior capable of a wider luminance range than conventional SDR, usually with room above diffuse white for luminous highlights.

## HLG

Hybrid Log-Gamma, a BT.2100 HDR transfer system designed for broadcast workflows and a degree of legacy compatibility. HDR Finisher currently decodes HLG input with a 1,000-nit peak assumption.

## ISO 21496-1

An ISO standard for gain-map metadata and application. HDR Finisher’s gain-map exporters/validators use supporting encoders and structural checks associated with this format.

## Linear light

An encoding where doubling a numeric value doubles represented light. Linear data is appropriate for many compositing and scene-light operations.

## Local dimming

LCD backlight control that dims and brightens regions independently. It improves HDR contrast but can create halos, crushed detail, or delayed brightness changes.

## Luma / luminance

Luminance is a physical/linear-light quantity related to perceived brightness. Luma is commonly a weighted signal-domain quantity. The UI uses accessible labels while implementation sections state the exact coefficients/domain.

## Nit

One candela per square meter (`cd/m²`), a unit of display luminance.

## OETF

Opto-electronic transfer function: maps scene light into signal values. In complete HDR systems, OETF, EOTF, and the overall system transform must be distinguished.

## OpenEXR

A high-dynamic-range image container designed for scene-linear visual-effects and imaging workflows. It supports half/float channels, lossless compression, and optional chromaticities.

## PQ / ST 2084

Perceptual Quantizer, an absolute HDR transfer function that can encode display luminance up to 10,000 nits. HDR Finisher uses PQ for HDR preview and export transport.

## Primaries

The real chromaticities assigned to the R, G, and B axes of an RGB color space.

## Proxy

A reduced-resolution image used for interactive preview/analysis. HDR Finisher’s proxy is capped at 1,920 pixels on the long edge; exports use full resolution.

## Reference white

A defined white level used to anchor a workflow. HDR Finisher v4 projects select 203 nits by default or the intentional 100-nit preset. Codec interface conventions, including libultrahdr's 203-nit linear scale, are converted separately and exactly once.

## SDR

Standard dynamic range. In HDR Finisher, the authored SDR rendition is display-linear sRGB during processing and becomes an 8-bit sRGB base/output.

## Scene-referred

Image values related to relative scene light before a final display rendering. Scene-linear EXR is the preferred HDR Finisher handoff.

## Tone mapping

Compressing or shaping a larger luminance range into a target display range while trying to preserve important relationships and detail.

## Transfer function

The relationship between stored values and light. Linear, sRGB, PQ, and HLG are different transfer interpretations.

## Ultra HDR

Google/Android’s backward-compatible JPEG gain-map format. Legacy readers show the SDR primary; supporting readers reconstruct HDR. Current guidance adds ISO 21496-1 metadata for compatibility.

## Wide gamut

An RGB gamut larger than conventional sRGB/Rec.709, such as Display P3, Rec.2020, or ACEScg. It does not imply high luminance range.
