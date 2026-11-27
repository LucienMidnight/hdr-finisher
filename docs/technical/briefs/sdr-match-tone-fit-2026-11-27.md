# Codex Brief — SDR Match: picture-based Tone fit, matched Highlight compression, Match HDR buttons
## HDR Finisher

**Date:** 2026-11-27 · **Approved by Steve:** 2026-11-27 · **Author:** Claude (design and prototype), Codex (implementation)

## Goal

Automatic SDR Match should make the SDR grade look like the HDR grade (the HDR picture placed on SDR, with only the highlights scaled down), using settings a person would choose and can edit: Tone Exposure first, Contrast only when HDR uses it, a simple 5-point Exposure bands curve, and a Highlight compression mode chosen to fit. It must never invent colour corrections the user did not make. Each Grade module that Match touches also gets a "Match HDR …" button like Detail and Vignette already have.

## Why (what Steve saw, and what the prototypes showed)

1. **Pink black-and-white photo** (`D:\Photos\2014\2014 capture one\P8060847.ORF`, read-only): Match added an SDR red-only curve. Reproduced on CPU, so not a GPU fault. The colour-curve residual stage accepted a red-only curve because it lowered overall OKLab error while the base tonal fit was ~11% too dark at p95; later luma stages fixed brightness and the red tint remained. Without that stage the result was neutral and better on every metric.
2. **Flower** (`D:\Photos\2025\20250704\DSC09738.ARW`): current Match refuses ("could not be safely materialized", P95 luma 0.070, OKLab 0.082). Forcing it through gives a pink/beige background (mean ΔE2000 7.3 in body tones). Steve graded the SDR by hand.
3. **Root cause of the poor tonal fit:** the neutral tonal fit works on a synthetic grey ramp, so it is blind to spatial and creative operators (Film Look, Detail, locals). HDR and SDR controls are also not the same operations (HDR Contrast is a stop slope around a scene pivot; SDR Contrast acts on encoded luma around 0.5 at half strength per unit; SDR Exposure bands measure display luma, which sits log2(SDR_SCENE_TO_DISPLAY_SCALE) = log2((100/203)/0.18) ≈ +1.45 EV from HDR's scene luma; the prototype's initial band copy used a wrong −1.02 EV offset, which did not affect the approved fit because it starts the 5 bands from zero). Copying values cannot work; they must be fitted.

Prototype (CPU, 384 px search, 1200 px measurement; Claude's scratch scripts, for reference only, not to copy):
`C:\Users\Steve\AppData\Local\Temp\claude\e91982c0c7b0793c\d1323bc8-85df-4742-be2a-aaf51482182e\scratchpad\tone_fit_proto.py` (class `SimpleFitter`) and `contrast_curves_test.py` (class `ContrastFitter`). Results, review sheets and JSON are in the `tone-fit` folder beside them.

Results (mean ΔE2000 in body tones, below the 0.9 shoulder; ~2 is just noticeable):

| Photo | Current Match | Approved approach |
|---|---|---|
| DSC09738 flower | 7.3 | 0.9 |
| P8060847 B&W | 7.5 (pink) | 0.67 (with Contrast, HDR Contrast +0.31) |
| PC290598 | 0.2 | 0.1 |
| P1011900 fireworks | 2.0 | 1.7 |
| DSC07654 | 0.5 | 0.05 |
| DSC07708 | 2.4 | 0.16 |
| DSC07721 | 0.4 | 0.45 |
| WCFA0332.HEIC (`D:\Photos\2022\04`) | — | 0.75 (HDR Contrast +0.5) |

Photo paths: `D:\Photos\2014\2014-12-29 Aceh Visit\PC290598.ORF`, `D:\Photos\2014\New Year's Taipei 2014\P1011900.ORF`, `D:\Photos\2026\20261114 Lucas 8 bday\DSC07654.ARW`, `DSC07708.ARW`, `DSC07721.ARW`. All have `.hdrf` sidecars. **D:\Photos is read-only**: copy a photo and sidecar into `codebase/output/test-photos/` once and work on the copy. Never write a sidecar in D:\Photos.

## Outcome spec

### 1. What Match aims for
Keep the current target (`build_sdr_match_target`: HDR luma placed on SDR, top 10% shoulder). Steve will judge the highlight look by eye later; do not redesign the target in this task.

### 2. Tonal fit, in Steve's order (the way he grades SDR by hand)
| Step | Controls | Rule |
|---|---|---|
| 1 | Tone **Exposure** (and **Contrast only if HDR Contrast ≠ 0**), plus Highlight compression Start | Fitted against the actual rendered picture, not a ramp. |
| 2 | **Exposure bands, exactly 5 points** | End points at the graph ends; the three middle points at this photo's dark, middle and bright body tones (prototype: 10th/50th/90th percentile of body EV, ≥0.75 EV apart). Gentle: larger adjustments are penalised. |
| 3 | Settle steps 1–2 together | Small refinement. |

- Blacks, Shadows, Midtones, Highlights and Whites stay at **0**. The earlier free fit drove them to ±100 and fighting each other; that is rejected.
- Contrast, when HDR has none, stays 0 (the prototype showed fitting it anyway gave no gain or a loss).
- The fit measures perceptual error in body tones (mean + high percentile) plus highlights with lower weight. The prototype's loss is a reasonable starting point; Codex may improve it.

### 3. Highlight compression chosen to fit
Try both and keep the closer one:
- **Soft ceiling**, Preserve color, softness 100, fitted Start.
- **Peak Fit** carrying over the HDR's own Highlight Color handling, Highlight Detail, Bias and Attenuation, with robust peak measurement, fitted Start.
Neither won everywhere in the prototype (Peak Fit was best on the flower, badly wrong on DSC07654).

### 4. Colour: never invented
- Remove the RGB-curve residual stages from Match (initial, composed passes, per-channel loop, CPU-certification curve passes). Match must not write R/G/B curves on its own.
- HSL, Color, B&W, Color grading, Detail, Film Look and Vignette keep the existing semantic copy.
- HDR curves are handled by a separate follow-up task (curve scale/colour-space unification being agreed now). **In this task, leave SDR curves exactly as `_semantic_sdr_translation` gives them except: do not reset them for Match's own fitting and do not fit any.** Leave a clear hook so the follow-up can copy HDR curves in.

### 5. Match HDR buttons
Add buttons for **HSL**, **Curves**, **Tone** and **Highlight compression**, beside the existing Detail/Vignette/Colour grading/B&W/Film pattern ("Match HDR …", "Copies once; SDR remains independent" or equivalent wording).
- HSL and Curves: copy once (Curves copy may be a plain copy for now; the follow-up task will make it exact).
- Tone and Highlight compression: re-run only that part of the fit (Tone = steps 1–3 including Exposure bands; Highlight compression = mode choice + Start) against the current HDR, leaving other SDR modules unchanged. Tooltip should say it fits rather than copies.
- One undo step each, like the existing buttons. Follow the design tokens and component sheet.

### 6. Speed
Today's Match runs candidates on the page GPU (`sdr_match_remote`), with CPU certification. The new fit must keep the felt wait about where it is (current Match 16–43 s on these photos on the PC). Use the existing GPU candidate route and keep the CPU fallback per the November 6 rule. Measure Match on the 8 photos before/after on the PC and record the row in `docs/technical/performance-table.md`. If the new fit is clearly slower than today, report rather than ship.

### 7. Statuses
`matched` / `needs_review` / refusal stay, but re-check thresholds against the new results: the flower and B&W photos must not be refused or marked unsafe when the result is visibly correct. Do not loosen an agreed limit without asking (AGENTS.md "Changing tests").

## Acceptance
- The 8 photos: body mean ΔE2000 ≤ 2 and no visible colour cast; P8060847 SDR neutral grey (no R/G/B curve, chroma ≈ 0 in body).
- No Tone zone slider moved by Match; Exposure bands have ≤ 5 points; Contrast nonzero only when HDR Contrast is.
- Small review page (downscaled sheets: target / old Match / new Match) for Steve under `codebase/output/review/sdr-match-tone-fit/`.
- Tests check results (pixels/values), not wording. Update existing Match tests whose expectations change on purpose, and say so in the commit.
- Fast checks plus only the GPU checks that cover Match and the new buttons, under `tools/gpu-run-lock.py`.

## Constraints
- Work on a new branch from `integrate/pc-tests-review-2026-11-26`. Small local commits. Do not push. Do not touch Steve's running app or kill processes.
- Pre-1.0: no migration code for old projects.
- Update `docs/technical/sdr-match.md`, the Grade module PRD (status/decisions dated 2026-11-27), and `docs/user-guide/grade-sdr.md` with what is built. Save this brief as `docs/technical/briefs/sdr-match-tone-fit-2026-11-27.md` and add it to the AGENTS.md documentation map.
- Keep each file's line endings (mixed CRLF/LF; see AGENTS.md).

## Questions protocol
If anything here conflicts with the existing code or the pipeline contract, stop and report before inventing a different approach. Report at the end in plain language for Steve: what changed, results table, timings, anything not done.
