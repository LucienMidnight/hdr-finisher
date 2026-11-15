# Design proposal: five-control Tone block (T1), November 15, 2026

**Status, November 16:** N1 and **global N2 + C4 built** on
`feat/watermark-and-library-polish`. Steve's decisions are recorded in the sprint
brief. **N3a Local Tone is built**, including renderer-based local Match
proposals; the full equal-Film-input/highlight-colour Match rebuild is stopped
after failed unchanged-gate probes, not shipped. **N3b clipping/range diagnostics
are built**. No Auto or compatibility renderer is included.

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
the photo's own peak. `D` = lane reference/diffuse white: HDR scene-linear `0.18`, SDR
display-linear `100/203 = 0.4926108374`. `G = 0.18·D`.
`K = min(G/8, P/16)`. Slider strength `s ∈ [−1, 1]`.

Implemented anchor: `G_HDR = 0.0324` scene-linear (36.54 nits at project
reference white 203; 18 nits at reference white 100). `G_SDR = 0.08866995074`
display-linear. HDR `P = target_nits * 0.18 / project_reference_white_nits`;
SDR `P = 1`. Authored SDR already uses display-linear sRGB, so it shares the
SDR anchor without another placement conversion. Verified against
`SDR_DISPLAY_REFERENCE_WHITE`, `SDR_SCENE_TO_DISPLAY_SCALE` and
`GRAIN_DEVELOP_HDR_SCALE` in `adjustments.py`. Monitor brightness and image
statistics never enter these references. Exposure/Contrast/foundation run first.

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
  +1.75/3.5 (SDR). The earlier SDR proposal assumed `D=1`; the
  narrower display headroom under `D=100/203` is now explicit.
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

## Built defaults and overlap

| Zone | HDR Center / Width | SDR Center / Width | Nominal support in stops from G |
| --- | ---: | ---: | --- |
| Shadows | −1.5 / 5 EV | −1.5 / 5 EV | [−4, +1] |
| Midtones | 0 / 4 EV | 0 / 4 EV | [−2, +2] |
| Highlights | +2.25 / 4.5 EV | +1.75 / 3.5 EV | HDR [0, +4.5]; SDR [0, +3.5] |

The upper gate truncates nominal support; it does not move the center.
At HDR Target 1000 nits / project reference white 203:

| Endpoint / overlap | HDR | SDR |
| --- | --- | --- |
| Blacks support | Y < 2.25% D | Y < 2.25% D |
| Blacks ↔ broad | 1.125–2.25% D (one stop) | same |
| Whites starts (M=P/2) | +3.7744 EV from G | +2.4954 EV from G |
| Broad ends (M=P/√2) | +4.2744 EV from G | +2.9954 EV from G |
| Broad ↔ Whites overlap | half a stop | half a stop |

Neutral-ray weights below use **% of D**, not SDR display-white percentages;
M=Y. Colourful pixels use frozen delivery-channel M independently.

| % D | Blacks | Shadows | Midtones | HDR Highlights | SDR Highlights | HDR / SDR Whites |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.125 | .250 | 0 | 0 | 0 | 0 | 0 / 0 |
| 1.6875 | .0625 | .087 | 0 | 0 | 0 | 0 / 0 |
| 9 | 0 | .896 | .500 | 0 | 0 | 0 / 0 |
| 18 | 0 | .352 | 1.000 | 0 | 0 | 0 / 0 |
| 36 | 0 | 0 | .500 | .417 | .606 | 0 / 0 |
| 80 | 0 | 0 | 0 | .994 | .866 | 0 / 0 |
| 100 | 0 | 0 | 0 | .972 | .628 | 0 / 0 |
| 150 | 0 | 0 | 0 | .705 | 0 | 0 / .318 |

### Limiter implementation

`tone.py` and `tone-engine.js` compute matching parameter-only interval bounds.
Intervals include every zone knot, black-gate knot and a 1/8-EV partition;
the white gate is independently bounded in 16 cells. Smoothstep values and
interior derivative extrema are bounded across each cell, not merely sampled.
Independent Y/M ranges conservatively include every fixed-colour ray, including
signed out-of-gamut input. The candidate's derivative includes the black floor,
white exponent and all three broad controls together. No image scan, percentile,
new GPU reduction or texture allocation is required; parameter caches hold 128
entries. Convex mixing certifies a luminance slope of at least 0.1, except the
intentional negative-Blacks clipping plateau.

Each broad amount is `s * .9 / max(abs(weight_derivative_bound), 1.5/half_width)`.
At the defaults, +100 pre-limiter EV coefficients are Shadows .287917,
Midtones .282077, Highlights .285416 HDR / .277499 SDR; the combined limiter
may reduce them further. These conservative, gated strengths replace the old
fixed 1.5-EV interpretation. Whites alone retains λ=1 and its exact 0.775P/2P
endpoint meanings. All five at zero returns the input exactly, including signed
headroom. CPU/GPU tests evaluate eight fixed-colour rays, sign combinations,
minimum/normal/maximum widths, endpoint gates and full-render ceilings.

### C4 wheel ranges (built)

Global and local wheels now both use `log2(Y/G)` in HDR and SDR, with the
existing Balance/Blending formula unchanged. The same normalized neutral ray
therefore receives the same weights relative to D in both lanes. Match's tint
translation still converts primaries; Balance/Blending need no lane-specific
translation. This changes existing non-neutral wheel grades, including locals.

## Film Look, Local Tone, Match

- Tone now feeds the film response: Whites can push into the stock's
  shoulder, Blacks changes the toe and grain exposure, halation responds to
  extra energy. No hidden normalisation or post-film Whites correction.
  Show pre-look qualification and the finished post-cap clipping separately.
- Local Tone (built in N3a): same curves per layer: local
  Exposure/Contrast, freeze that layer's guide, five-control block, then
  local colour/HSL/curves/wheels/detail, then mask × opacity.
- Match (N3a, partial): the linear local-tone basis is replaced by a bounded
  fit calling the shared local renderer; full recipes are certified through
  the real SDR tail, Film Look, cap and gamut mapper. HDR local enabled and
  parent target/reference are preserved. No Match gate changes.
- M1/M1d remain open: global Match still changes pre-Film exposure and does
  not constrain highlight colour. The equal-exposure/prefix-plus-post-Film
  probe misses the body colour ceiling (.050) at .067320 Portra, .062441
  Ektar, .068645 Velvia 50%; Film input also still differs (P95 absolute
  luma .118722). This best-found failure is not proof of impossibility and
  is not shipped. No hidden Match-only post-Film correction is added.
- N1 mode review: retain Soft Ceiling for Match; both bounded four-mode
  searches still select it, not a universal optimum claim. Ordinary SDR
  default remains Peak Fit. Global-only chart and five-RAW final results
  are identical to pre-N3a. See the existing M1 report's November 16 section.
- N3a intentional output changes: stored nonzero local Tone and generated
  local Match proposals, including DSC00950's local edits. The two protected
  DSC00264 projects have zero local Tone. No source project/fixture bytes
  are rewritten; derived Library thumbnail/screen identities are v7/v6.

## N3b affordances (November 16, preview only)

- Hover/drag all five controls and Center/Width: draw the actual gated
  neutral-ray weight × combined limiter, anchored on G, in the viewer key
  and histogram/waveform. Local weights include opacity but explicitly
  exclude the spatial mask. Label **Pre-look neutral-ray range**; saturated
  pixels still qualify with their own Y/M. This is not a finished-pixel mask.
- Alt/Option-drag Blacks/Whites: use the accepted finished Film Look texture
  and the existing final HC/gamut tail, separately labelled **Finished,
  post-cap**. SDR Whites black / Blacks white, with scope RGB channel marks.
  Pale dots = endpoint-only; solid RGB = measurable loss at the final cap;
  dashed RGB = newly reached endpoint against the drag-start snapshot, not
  proof of lost detail. Earlier lost detail cannot be inferred from a final
  value alone. White-endpoint tolerance is 0.1% of P for half-float storage;
  black contact tolerance is 1e-6. Neither changes output pixels.
- HDR: existing accent marks crossing 100-nit SDR white; existing attention
  marks over reported primary-display peak; pale marks reaching the HC target
  guide. Physical nits convert through project reference white; unknown
  display telemetry stays unknown. HC bypass does not become a hidden cap.
- A separate GPU section consumes existing renderer bindings, without edits
  to the grading shader. Baseline rgba16float and diagnostic canvas are at
  most 640×640 (3.125 + 1.563 MiB plus parameters), allocator-accounted and
  released on exit. Tiled rendering reuses the bounded scope-proxy path;
  CPU preview keeps the parameter range but no new CPU clipping renderer.
  No full-resolution cache, recipe change, export change, new UI token or
  Auto. Existing scope RGB/luma, accent and attention tokens only; black and
  white are diagnostic data endpoints, not new interface colours.

Coverage, timings, limitations and screenshot links are in the sprint N3b
result. Compact sampling is not full-source clipping certification.

## Saved edits (pre-1.0, no migration renderer)

N2 intentionally changes non-zero global Blacks/zones, their presets/default
ranges, and non-neutral global/local wheels. Existing stored Match recipes with
those controls can change. N1 already changed SDR grades with HC enabled even
with Tone at zero. Peak Fit remains available. Local Tone's curves are unchanged
until N3a; there is no migration renderer. The two protected DSC00264 projects
have neutral affected global controls and wheels and are not rewritten.

## Tests

`test_tone_zones.py`, `tone-zones.test.js` (identity, frozen selection,
endpoint weights, references, gated strength, limiter); local tests
(global/local equivalence); highlight tests (fixed knee, non-expansion,
ceiling, no peak dependency, saturated channels); film/headroom tests (tone
before film, above-white survives to final mapping); Match tests (real
renderer fit, unchanged gates); delivery tests (cap after resize,
sharpening and grain). GPU: `tone-zones-delivery.js`,
`gpu-highlight-compression-parity.js`. No tolerance loosened.

## Decisions / remaining steps

All six decisions at the end of the original proposal are resolved: offer Fixed
cap alongside Peak Fit; final SDR HC; photographic-grey anchor; narrow Whites;
Local Tone next (N3a); clipping/range preview built in N3b, Auto later. N2 does not
claim local/global Tone equivalence or the rebuilt Match solver. The temporary
Match adaptation considers median-luma recovery, two additional bounded
Start proposals and one composed RGB residual at CPU certification, with all
existing acceptance/quality/editability gates retained.
Validation evidence and unrun checks are in the sprint brief's N2 result.
