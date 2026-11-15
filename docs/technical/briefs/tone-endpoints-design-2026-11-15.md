# Design proposal: five-control Tone block (T1), November 15, 2026

**Status:** proposal, not approved for building. Part of the 0.9.3 feedback
sprint (`sprint-0-9-3-feedback-2026-11-15.md`, item T1). Decided: T1-a
(user-facing order Tone → Film Look → Highlight Compression last as the cap).
Open: T1-e, T1-f, anchor, T1-b, T1-c, T1-d (end of this file). Sources:
two Codex `gpt-6.1-sol` research passes on November 15 (other apps' tone
controls; revision for Steve's order). Size: **XL** if everything lands
together; global Tone alone is L.

## Goals (Steve)

- Add Whites beside Blacks. Blacks and Whites are easy, narrow endpoint
  controls that feel the same in HDR and SDR and overlap little with the
  broad controls.
- Shadows/Midtones/Highlights cover broader, customisable ranges, closer to
  lift/gamma/gain.
- Users set tone, then add a look (LUT-like workflow); Highlight Compression
  is last so the delivered peak meets spec.

## Order

All five controls form one operation that reads one frozen guide (its input
luminance `Y` and brightest delivery-space channel `M`), so no control moves
another's selection.

| Stage | HDR | Generated SDR | Authored SDR |
| --- | --- | --- | --- |
| Start | scene-linear ACEScg | scene-linear ACEScg | display-linear sRGB base |
| Early | Exposure, Contrast/Pivot, scene Color, B&W | Exposure, scene Color, B&W | Exposure, B&W |
| SDR placement | — | fixed `0.18 → 100/203`, to display-linear sRGB | none |
| Foundation | Exposure Bands | Exposure Bands, SDR Contrast/Pivot | Exposure Bands, Contrast/Pivot, Color |
| **Tone block** | here (ACEScg) | here (display-linear sRGB) | here |
| Creative | HSL → curves → wheels → Detail → locals | same | same |
| Film Look | existing physical chain | same | same |
| Finishing | structure, vignette, resize, output sharpening | same | same |
| **Highlight Compression** | final cap | **moved here from early** | **moved here** |
| Boundary | delivery-primary ceiling at Target Peak | hue-preserving sRGB gamut mapper | same |

Blacks leaves the early exposure helpers (no double application). No hidden
second SDR shoulder before Tone or Film Look. Film grain stays inside Film
Look. HDR's target guarantee still requires HC enabled; SDR's [0,1] boundary
is unconditional. Moving SDR HC is an architecture change (T1-f).

## Why Peak Fit conflicts with early Whites

Peak Fit never lifts a peak below target, but its shoulder depends on the
photo's measured peak. Example (Start 800, Target 1000, Detail 35, Film
off, image peak 2000): a 600-nit sample becomes 598.5 at Whites 0 but
**537.8** at Whites +100, because the higher peak forces a stronger fit.
Raising Whites darkens other highlights.

Recommended fixed cap (T1-e): no peak measurement; identity below knee `k`;
above it `C(x) = k + h(1 − e^{−(x−k)/h})`, `h = P − k`, example `k = 0.8P`.
`x` is the brightest positive linear channel (BT.2020 for HDR, sRGB for
SDR); apply the common multiplier `C(x)/x` (hue preserving). Needs Start and
Target only. Soft Ceiling and Clip stay as options. A smooth cap starts
reducing values below the target (900 → 878.7, 1000 → 926.4 nits).

## References

`P` = HC target (SDR: 1.0), also when HC is bypassed; never the monitor or
the photo's own peak. `D` = reference white (SDR 1.0). `G = 0.18·D`.
`K = min(G/8, P/16)`. Slider strength `s ∈ [−1, 1]`.

Anchor change: today HDR zone Center 0 is 0.18 scene-linear = 203 nits;
the proposal's `G` is 36.54 nits (about −2.47 stops). Needs approval.

## Curves

- **Blacks:** `w_B = max(1 − Y/K, 0)²`; neutral offset `B = 0.45·s_B·K·w_B`
  added equally to RGB. +100 lifts black to 1.0125% of reference white
  (2.06 nits at 203); −100 sets a black clipping point. Nothing at or above
  `K` changes.
- **Whites (narrow):** `A = P/2`, `q = clamp(log2(M/A), 0, 1)`, `w_W = q²`;
  gain `2^Δ`, `Δ = s_W·w_W` (positive) or `log2(1/0.775)·s_W·w_W`
  (negative). At target: −100 → 0.775P; +100 → 2P before Film Look and the
  cap (overdrive is essential so Whites can still fill the cap after a look
  that darkens whites).
- **Broad zones:** `z = log2(Y/G)`, `u_i = 1 − S(|z − c_i| / (W_i/2))`,
  gates `g_B = S(log2(Y/(K/2)))`, `g_W = 1 − S(2·log2(M/(P/2)))`,
  `w_i = u_i·g_B·g_W`. Black/broad overlap ≤ 1 stop; white/broad ≤ ½ stop.
  Defaults: Shadows −1.5/5 EV, Midtones 0/4, Highlights +2.25/4.5 (HDR),
  +1.25/2.5 (SDR).
- **Combined limiter:** candidate
  `I_raw = I·2^(Σ a_i w_i + Δ_W) + B·1`, output `I + λ(I_raw − I)`, with
  `λ = 1` if the minimum linear-light derivative `d ≥ 0.1`, else
  `0.9/(1 − d)`. Computed from parameters (not photo statistics), checked on
  fixed-colour rays, with conservative bounds rather than sampling alone.
  Calibrate each zone's ±100 strength after gating. Zero settings are an
  exact bypass. Negative Blacks may clip intentionally.

## Worked examples (HDR, target 1000 nits, fixed cap k = 0.8P)

| Film | Input | Whites | After Whites | After Film | After cap |
| --- | ---: | ---: | ---: | ---: | ---: |
| Off | 1000 | −100 | 775.0 | 775.0 | 775.0 |
| Off | 1000 | 0 | 1000.0 | 1000.0 | 926.4 |
| Off | 1000 | +100 | 2000.0 | 2000.0 | 999.5 |
| Portra 400 | 1000 | 0 | 1000.0 | 706.4 | 706.4 |
| Portra 400 | 1000 | +100 | 2000.0 | 1412.9 | 990.7 |

SDR behaves identically in relative terms (Film Look's numbers differ by
lane, as today).

## Selection weights (SDR, % of linear white)

| Value | Blacks | Shadows | Midtones | Highlights | Whites |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1.125% | 0.250 | 0 | 0 | 0 | 0 |
| 1.688% | 0.063 | 0.087 | 0 | 0 | 0 |
| 9% | 0 | 0.896 | 0.500 | 0 | 0 |
| 18% | 0 | 0.352 | 1.000 | 0 | 0 |
| 36% | 0 | 0 | 0.500 | 0.896 | 0 |
| 59.46% | 0 | 0 | 0.026 | 0.339 | 0.063 |
| 70.71% | 0 | 0 | 0 | 0 | 0.250 |
| 100% | 0 | 0 | 0 | 0 | 1.000 |

## Film Look, Local Tone, Match

- Tone now feeds the film response: Whites can push into the stock's
  shoulder, Blacks changes the toe and grain exposure, halation responds to
  extra energy. No hidden normalisation or post-film Whites correction.
  Show pre-look qualification and the finished post-cap clipping separately.
- Local Tone (recommended, T1-c): same curves per layer: local
  Exposure/Contrast, freeze that layer's guide, five-control block, then
  local colour/HSL/curves/wheels/detail, then mask × opacity.
- Match: replace the linear local-tone basis with a bounded fit that calls
  the real renderer and certifies through the real SDR tail, Film Look, cap
  and gamut mapper. Keep every Match gate unchanged.

## Saved edits (pre-1.0, no migration renderer)

Changes: non-zero global Blacks/zones and presets; all Local Tone edits and
stored Match recipes (if T1-c); HDR Center/Width (if the anchor changes);
**SDR grades with HC enabled even with Tone at zero** (shoulder moves); Peak
Fit grades (if T1-e replaces it).

## Tests

`test_tone_zones.py`, `tone-zones.test.js` (identity, frozen selection,
endpoint weights, references, gated strength, limiter); local tests
(global/local equivalence); highlight tests (fixed knee, non-expansion,
ceiling, no peak dependency, saturated channels); film/headroom tests (tone
before film, above-white survives to final mapping); Match tests (real
renderer fit, unchanged gates); delivery tests (cap after resize,
sharpening and grain). GPU: `tone-zones-delivery.js`,
`gpu-highlight-compression-parity.js`. No tolerance loosened.

## Open decisions (in this order)

1. **T1-e:** fixed cap (recommended) vs keep Peak Fit vs offer both.
2. **T1-f:** move the SDR shoulder last (recommended) vs keep an early SDR
   placement compression plus a separately named final cap.
3. **Anchor:** HDR Center 0 = 18% of reference white (recommended, 36.54
   nits) vs today's 203 nits (redo HDR defaults).
4. **T1-b:** narrow Whites (recommended: top stop, −100 → 77.5%, +1 stop
   overdrive) vs wider (top two stops, −100 → 57.4%).
5. **T1-c:** Local Tone in the same change (recommended) vs global first.
6. **T1-d:** clipping/range preview first (recommended) vs Auto together.
