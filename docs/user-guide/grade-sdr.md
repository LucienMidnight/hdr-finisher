# Author the SDR Fallback

The SDR branch is a full creative rendition, not a preview convenience. It becomes the primary/base image in gain-map exports and is what ordinary JPEG readers, unsupported browsers, many social services, and all SDR PNG exports display.

## The basic goal

Preserve the subject, color relationships, and important highlight detail in a conventional SDR image without trying to imitate HDR brightness. A strong fallback should look intentional on its own.

Start with:

1. Filmic Base Rendition at neutral settings.
2. Exposure and Highlight Recovery.
3. Contrast/Pivot and Shadow.
4. Match HDR colors, then refine the SDR color controls if needed.
5. Lift/Gamma/Gain or Curves only when needed.

## Base Rendition

### Filmic

The neutral default. It maps scene luminance through a sigmoid anchored at middle gray. It provides a gentle shadow and highlight shoulder while keeping `0.18` at the same normalized SDR value.

- **Curve Contrast** changes the overall sigmoid steepness.
- **Contrast Skew** changes shadow and highlight steepness independently. Move left for more emphasis in darker tones and gentler highlights; move right to open shadows and give brighter tones more snap.

### ACES

Uses a compact ACES-inspired rational curve. It has a stronger characteristic shoulder/toe than the neutral Filmic implementation. It is a look choice, not a full ACES Output Transform.

### Reinhard

Uses `x / (1 + x)` luminance compression. It is predictable and strongly compressive, useful for very large ranges but often flatter than Filmic.

For Apple HDR HEIC sources with an authored SDR reference, neutral Filmic is an identity. When Base Rendition changes, HDR Finisher approximately inverts its neutral filmic relationship and applies the new selected mapping. This avoids remapping an already tone-mapped SDR image twice at default settings.

## Tone

### Exposure

Moves the SDR rendition before/around its display mapping, depending on whether the source supplies an authored SDR reference. Use it to place the overall fallback, not to force all highlights under white.

### Highlight Recovery

Adds a monotonic shoulder while holding the mid-gray anchor stable. It reduces bright-end contrast without a hard clip. Increase it when the SDR rendition loses important bright detail; reduce it when highlights become dull or gray.

It cannot reconstruct source detail that was already clipped.

### Contrast and Pivot

Operate in the display-linear SDR domain. Pivot identifies the normalized value around which contrast expands or compresses.

### Shadow

Adds or removes low-end brightness with a mask that fades toward midtones. Small values are normally sufficient.

## Match HDR colors

**Match HDR colors** is a one-shot starting point. It copies the current HDR Temperature, Tint, Saturation, Vibrance, and RGB Primaries slider positions into the SDR Color panel. It does not link the branches, and it does not copy Exposure or any other tone control.

After matching, every SDR color slider remains independently editable. Later HDR color changes do not affect SDR unless you press **Match HDR colors** again. Use **Reset** to return only the SDR color sliders to their neutral defaults; SDR Exposure and the other tone controls are preserved.

The SDR color controls operate through ACEScg for primary shaping, then convert back to display-linear sRGB.

## SDR gamut compression

After the scene is tone-mapped, HDR Finisher converts ACEScg to linear sRGB. Colors outside the normalized sRGB cube are moved toward luma until all channels fit, preserving the luma anchor and broadly preserving hue direction.

This is a simple global compression, not a perceptual appearance model. Strong wide-gamut colors can lose chroma. Inspect the SDR branch rather than assuming the HDR color grade will survive unchanged.

## Lift, Gamma, Gain and Curves

SDR Lift/Gamma/Gain uses the same stop-relative zone concept as the HDR branch, but acts on the bounded display rendition. Range and Pivot still define where each zone operates.

SDR Curves work from 0 to 1 rather than the HDR logarithmic upper range. Luma changes brightness; RGB curves change channel balance. Curves are stored independently per branch.

## Processing order

For a scene-linear source without an authored SDR reference:

1. SDR exposure and shadow
2. Independent SDR color grade (optionally initialized from HDR with Match HDR colors)
3. Selected tone map into display-linear sRGB
4. Highlight Recovery and contrast
5. Lift/Gamma/Gain
6. Curves

For an authored SDR reference such as supported Apple HDR HEIC:

1. Begin with the authored display-linear sRGB rendition
2. Exposure and shadow
3. Optional Base Rendition re-tone-map
4. Highlight Recovery and contrast
5. SDR color grade through ACEScg and back to sRGB
6. Lift/Gamma/Gain and Curves

The final result is clipped to the normalized SDR range.

## Review checklist

- Does the subject read without relying on HDR brightness?
- Are important highlights detailed rather than gray or clipped?
- Are blacks intentional on an ordinary SDR display?
- Did gamut compression alter saturated colors?
- Does the SDR version remain recognizably the same creative work as HDR?
- Does the standalone SDR PNG match the fallback decoded from the gain-map file closely enough for delivery?

## Watch out for

- Treating the fallback as an automatic tone-map by-product
- Using extreme Highlight Recovery until the image looks flat
- Expecting Match HDR colors to remain linked after the one-shot copy
- Expecting exact color identity between wide-gamut HDR and sRGB SDR
- Correcting a wrong source interpretation independently in each branch
