# Chrome Proof and Display Adaptation

Chrome Proof answers a practical question: “Given the HDR and SDR renditions I am about to encode, what should the gain-map reconstruction look like at this amount of display headroom?”

It does not alter the grade or export.

## Why proofing is necessary

A gain-map image does not contain one fixed displayed HDR brightness. It contains an SDR base, an HDR target relationship, and metadata that lets a compatible viewer adapt the reconstruction to current display headroom.

The available headroom can change with:

- Display peak luminance
- SDR/reference-white brightness
- Window size and average picture level
- Automatic brightness limiting
- Ambient-light adaptation
- Operating-system and browser policy

Therefore, a 1,000-nit-authored result may appear closer to SDR on a 400-nit display and more expansive on a stronger display.

## Build a proof

1. Open **Proof**.
2. Enable **Show Chrome proof**.
3. Select JPEG Ultra HDR or AVIF + gain map.
4. Select a target display peak.
5. Choose the active display when Windows telemetry is available.
6. Click **Build proof**.

The proof is generated from encoded media, not merely from the live working image. That catches encoder metadata, quantization, gamut, and endpoint behavior that an unencoded simulation could miss.

After the proof is built, use **HDR adaptation** to inspect the reconstruction at the selected display target and **SDR base** to inspect the exact encoded fallback without leaving the Proof page. Switching these previews does not rebuild the artifact or change export settings.

## Target display peak

| Target | Good use |
|---|---|
| Auto | Uses the selected Windows display’s reported nominal headroom. Unavailable as a trustworthy native measurement on macOS. |
| 400 / 600 nits | Entry and limited-HDR behavior. Important for consumer resilience. |
| 1,000 nits | Common general HDR authoring/proof target. |
| 2,000 / 4,000 nits | Higher-headroom behavior and extreme highlight relationships. |
| Full encoded range | Applies the gain map to the content’s encoded maximum, independent of a smaller display target. |
| Custom | Tests a known or hypothetical peak from 100 to 10,000 nits. |

The selected proof peak is interpreted against the active project's HDR Reference White. A 1,000-nit target is about 2.30 stops above 203 nits or 3.32 stops above 100 nits. Proof target, display peak, content peak, export peak, and reference white remain independent.

## Not a hard clip

The target controls how strongly the encoded gain map is applied. It is not simply a ceiling that clips every pixel above that nit value. The reconstruction uses the gain-map metadata, content headroom, and selected display headroom to adapt between the SDR and HDR endpoints.

The result can still contain values numerically above the nominal target before the final display transform. The proof reports clipped/above-headroom statistics as diagnostics, not as a substitute for looking at the reconstruction.

## Stale proofs

Grading after building a proof marks it **Stale**. The previous proof remains visible so editing is not interrupted, but it no longer describes the current adjustments.

Rebuild after:

- Any relevant HDR or SDR grade change
- Changing export format or gain-map settings
- Changing the target display
- Changing source interpretation
- Moving to a materially different system/display configuration

Proofing is optional and stays in the dedicated Proof workflow. Export does not warn about an unreviewed or stale proof; rebuild it whenever the delivery needs that additional confidence.

## Deterministic proof versus native browser rendering

These are different authorities:

- **Chrome Proof** is authoritative for HDR Finisher’s deterministic reconstruction of the encoded endpoints at a chosen headroom.
- **Native Chrome rendering** is authoritative for what that Chrome build, operating system, GPU, and display actually present.

They should agree in structure, highlight hierarchy, gradients, and broad color. They need not be brightness-identical. A consistent modest brightness difference can result from browser/display tone mapping without indicating an export failure.

Investigate when you see:

- Changed hue or severe saturation shifts
- Missing or inverted highlight separation
- Banding or hard steps
- A fallback unrelated to the authored SDR branch
- Gain-map disappearance after hosting
- Large, inconsistent changes between reloads with fixed settings

## Under the hood

The proof stage:

1. Processes the current HDR and SDR branches.
2. Encodes a content-hashed JPEG Ultra HDR or AVIF proof artifact.
3. Reads encoded gain-map metadata/headroom.
4. Reconstructs the encoded endpoints with the gain-map formula at the chosen display capacity.
5. Encodes a PQ proof tile for the main viewer.

The implementation follows the logarithmic gain-map model used by Ultra HDR/ISO-style gain maps. The Android [Ultra HDR specification](https://developer.android.com/media/platform/hdr-image-format) explains the SDR base, gain map, content boost, and display boost concepts.

## A useful proof sequence

For web delivery:

1. Review HDR authoring view.
2. Review the SDR branch alone.
3. Build 400-nit proof.
4. Build 1,000-nit proof.
5. Build Full encoded range.
6. Export.
7. Open the exact exported file natively in current Chrome/Edge/Brave.
8. Test the hosted URL or service-transformed result.

## Limits

Chrome Proof does not simulate:

- A particular monitor’s local dimming, ABL, or gamut
- Ambient light or visual adaptation
- Safari, Firefox, social-app, or mobile-app decoding policy
- Hosting recompression before the encoded bytes are retrieved
- Incorrect display telemetry

It is a powerful delivery diagnostic, not a reference-monitor certification system.
