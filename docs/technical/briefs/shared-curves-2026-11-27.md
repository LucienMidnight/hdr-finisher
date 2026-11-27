# Codex Brief — One curve setting for HDR and SDR, at a gentler strength
## HDR Finisher

**Date:** 2026-11-27 · **Approved by Steve:** 2026-11-27 ("the same curve settings can apply across HDR and SDR"; "curves were too strong") · **Design agreed by:** Claude and Gemini 4 Neon · **Implementation:** Codex

Background discussion (read it): `C:\Users\Steve\AppData\Local\Temp\claude\e91982c0c7b0793c\d1323bc8-85df-4742-be2a-aaf51482182e\scratchpad\curves-design-discussion.md`. Evidence: `...\scratchpad\tone-fit\round4-curves\` (copying today's curves into SDR leaves mean ΔE2000 3.6–4.3 on colour curves even with scale conversion; the remainder is different primaries).

## Goal

A curve (Luma, Red, Green, Blue; global and local adjustments) means the same tone and the same colour change in HDR and in SDR, so SDR Match and the "Match HDR curves" button copy curve points verbatim and the SDR looks the same as the HDR below SDR white. A small drag moves brightness about half a stop everywhere from mid grey up, close to a normal photo editor (today ~1 stop at mid grey in HDR and up to 13 stops in SDR shadows).

## Agreed spec

### 1. Shared curve scale (CPU, WGSL, UI)
Scene-linear ACEScg units, 0.18 = project reference white (at any project white, 100 or 203 nits).

- `CURVE_C = 0.004`, `CURVE_VMAX = 3.6` (20 × 0.18), `CURVE_LOG_SPAN = log2(1 + VMAX/C) = log2(901)`
- `E(v) = log2(1 + v/C) / LOG_SPAN` for v ≥ 0; linear with the matching slope `1/(C·LOG_SPAN·ln2)` for v < 0.
- `D(x) = C·(2^(x·LOG_SPAN) − 1)` for x ≥ 0; linear inverse for x < 0. CPU may use log1p/expm1.
- Landmarks to test: 0→0, mid grey 0.0324→0.325, reference white 0.18→0.563, SDR white 0.3654→0.665, 3.6→1.0; 10,000 nits at 203 RW extrapolates to x≈1.13.
- Sensitivity (0.05 · d log2 v / dx): ≈0.55 st at mid grey, ≈0.50 st from reference white up; −2 st 0.73; −4 st 1.46 (≈ sRGB editor).
- Default control points stay `[[0,0],[0.25,0.25],[0.5,0.5],[0.75,0.75],[1,1]]`.

### 2. Shared colour space and evaluation (global + local; CPU + WGSL)
1. Exact bypass when curves are off or all four neutral (no conversions).
2. Enter: HDR uses its ACEScg pixels as-is. SDR (generated and authored): `aces = linear_srgb_to_acescg(px) / SDR_SCENE_TO_DISPLAY_SCALE`. WGSL must use the exact CAT02 matrix matching Python's `_LINEAR_SRGB_TO_ACESCG` (the existing WGSL `srgbToAcescg` helper differs by ~0.003; do not silently change it for other stages without auditing them — use an exact matrix for the curve path).
3. 1024-sample monotone cubic LUT on [0,1]; outside [0,1] CPU and GPU both extrapolate linearly with the LUT endpoint slopes (`(lut[1]−lut[0])·1023`, `(lut[1023]−lut[1022])·1023`). No output clipping.
4. Luma curve: ACEScg AP1 luma `[0.2722287, 0.6740818, 0.0536895]`; `Y_out = D(curve(E(Y)))`; black-floor lift `y0 = max(0, min(D(curve(0)), Y_out))`; if `Y > 1e-5`: `aces = y0 + aces·(Y_out − y0)/Y`, else `aces += (Y_out − Y)`. This fixes today's bugs: a black-point lift that leaves black black and multiplies shadow noise, and sign inversion on negative-luma RAW pixels.
5. R/G/B curves per channel in ACEScg: `aces[c] = D(curve_c(E(aces[c])))`. (ACEScg chosen because all sRGB/P3 colours are positive there; per-channel curves in linear sRGB corrupt wide-gamut HDR colours with negative channels.)
6. Exit: HDR returns ACEScg; SDR returns `acescg_to_linear_srgb(aces) × SDR_SCENE_TO_DISPLAY_SCALE`. Keep signed and above-white values so SDR Highlight compression and the gamut mapper shape highlights (SDR curves must not clip at white).

### 3. Keep Film Look / Grain / Halation / Vignette unchanged (mandatory)
`_curve_domain_encode/_decode` (and WGSL `curveEncodeChannel/curveDecodeChannel`) are also used by `_film_encode_luma/_film_decode_luma`, Vignette highlight protection, Halation masks/diagnostics and Grain response (WGSL `filmSignalFromLuma/filmLumaFromSignal`). Move today's HDR transfer into dedicated film helpers first, so those stages stay bit-identical and the pinned film/lens parity guards (AGENTS.md, 2026-11-14) are untouched. Check `_contrast_pivot_in_curve_domain` too.

### 4. Match and buttons
- Whole-photo Match (`_semantic_sdr_translation` on branch `feat/sdr-match-tone-fit`, using the hook left there): copy `curves_section_enabled` and all four curves verbatim from HDR. Never fit or invent curves.
- Local Match (`_translate_local_grade`): copy the four curves verbatim from `hdr_grade` to `sdr_grade`, and neutralise curves on the temporary copy used for the local tonal fit so the luma curve is not counted twice.
- "Match HDR curves" button: verbatim copy; tooltip says HDR and SDR curves share one scale.

### 5. Curve editor UI
- Remove the 0.35× (0.18× endpoints) vertical drag damper (`curveVerticalAdjustmentScale`) and its keyboard equivalent: 1:1 drag on every channel in both lanes.
- Nit ticks/false-colour bands use the project reference white (fix today's +1.02-stop misplacement at 203 nits): `v = nits·0.18/R`, `x = E(v)`.
- SDR view: same [0,1] graph, a vertical line at SDR white (x = 0.665), and a lightly shaded but still editable "Headroom" region to the right. HDR view: reference-white line at 0.563.
- Design tokens only (AGENTS.md); match the component sheet.

### 6. Saved grades, caches
Pre-1.0: no migration. Projects with non-neutral curves will change; list them in the report (known: `D:\Photos\2022\04\WCFA0332.HEIC` HDR luma; one Play_Raw project; SDR curves left by the old Match in P8060847.ORF, DSC07594.ARW, DSC07708.ARW, the old Test Suite DSC00264.ARW and two Play_Raw projects). Do not edit any of them. Bump whatever cache version makes finished Library pictures/screen previews rebuild for changed curves.

## Tests (check results, not wording)
1. Scale maths: landmarks, C¹ at 0, float32 round trip over [−0.1, 100], sensitivity at mid grey 0.48–0.58 st per 0.05.
2. HDR↔SDR equivalence (global and local): same Luma S-curve, teal-orange R/B curves and a black lift applied to HDR and to placed SDR (including above-SDR-white values to v=4 and P3/BT.2020 colours) agree within 1e-3 linear / body ΔE2000 < 0.05, and SDR keeps > 1.0 headroom before Highlight compression.
3. Wide-gamut and signed-RAW safety: neutral shadow lift on BT.2020 green keeps R = B; luma black lift lifts black to D(curve(0)) without amplifying 1e-5 noise and without inverting negative-luma pixels.
4. Film/Grain/Halation/Vignette output bit-identical before/after with neutral curves.
5. Match: copies HDR curves verbatim; teal-orange and S-luma cases reach body mean ΔE2000 ≤ 2 on the Match test photos (reuse Codex's previous eight-photo setup on `feat/sdr-match-tone-fit`; synthetic curves added in memory only); never invents curves when HDR curves are neutral.
6. CPU vs WebGPU, global + local, HDR + SDR, including black lift and > 4,000-nit extrapolation: SDR ΔE2000 mean < 0.5, p99 < 1.5; HDR ΔE ITP mean < 1.0, p99 < 3.0; HDR delivery ceiling exact.
7. Curve editor: reference-white line at 0.563 for 100- and 203-nit project whites; SDR white line at 0.665; 1:1 drag on HDR Luma, HDR Red and SDR Luma.
Update the existing tests that pin the old curve domain on purpose (e.g. `test_hdr_curve_domain_*`, `test_log_domain_hdr_curves_no_infinities_up_to_peak_10`, Match materialization expectations, curve-editor drag drivers) and say why in the commit.

This touches pinned shader code and render output: run every check covering curves, local adjustments, Film/Lens parity and export/Proof of curve grades (AGENTS.md "Still strict"), grouped once, under `tools/gpu-run-lock.py`. If that exceeds ~30 minutes of slow tests, record what you would run and the estimate in the report instead of stopping (Steve is away; he will approve).

## Constraints
- Repository `D:\AI\AI Projects\HDR Finisher Tool\ai`. Create branch `feat/shared-curves` from `feat/sdr-match-tone-fit` (current HEAD). Small local commits; never push. Don't kill or restart Steve's app. Leave untracked `AGENTS.local.md` and `docs/design/grade-notice-wireframes/` alone. D:\Photos read-only.
- Keep each file's line endings. Update `docs/technical/image-processing-pipeline.md`, `docs/concepts/color-pipeline.md`, the Grade module PRD (dated decision 2026-11-27), `docs/user-guide/grading-controls-reference.md` and `docs/technical/sdr-match.md`. Save this brief as `docs/technical/briefs/shared-curves-2026-11-27.md` and add it to the AGENTS.md documentation map.
- If the code contradicts this spec in a way that matters, stop and report rather than inventing a different design.

## Report
Plain language for Steve: what changed, how curves feel now (numbers), Match results with HDR curves, which saved projects look different, checks run and results (and any not run, with estimate), review page path (absolute Windows path, small before/after crops of WCFA0332 and a teal-orange case in HDR and SDR), branch and commits.
