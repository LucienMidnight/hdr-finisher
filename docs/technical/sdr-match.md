# HDR-to-SDR Match

## November 26: editable materialization for new Match actions

New whole-photo Match actions use the independent materialization fitter and
commit its normal SDR controls. The live HDR prefix could differ from the
stored SDR recipe, so disabling a link on the first creative edit exposed a
different picture. New results are one-shot independent grades; subsequent
HDR edits require another Match. Re-match replaces manual SDR tweaks, with
the existing local/authored override confirmations and atomic Undo retained.

Saved linked grades still use the existing linked CPU/GPU renderers unchanged.
Automatic re-fitting after HDR edits is deferred: it would run the iterative
fit after each settled HDR change and needs latency and cancellation design.

The fitter now adds two bounded coordinate-search passes over Exposure,
Contrast, Midtones, Highlights, Whites, shoulder Start and highlight
desaturation. Its loss includes the bright population separately, rather
than ignoring highlights outside the body mask. Already-satisfied body gates
cannot regress. Luma curves remain neutral, preserving Exposure headroom.
GPU candidates are still CPU-certified before refinement; unsafe proposals
still discard the whole attempt and run the CPU fallback.

Focused comparison: `hdr_match_scene.tiff`, HDR Exposure +0.2, Contrast +0.12,
203-nit reference, no locals or Film Look. Against the previous linked render,
mean / p95 / p99.9 Delta E 2000 changed from 0.318 / 1.416 / 9.076 before
refinement to 0.109 / 0.401 / 3.650 after refinement. Tiny-fixture fit time
changed from 0.065 s to 0.254 s. These are diagnostic samples, not general
parity or speed guarantees; extreme highlights can still differ visibly.
The calibrated materialization test retains its existing median-luma cap of
0.012 and now passes. No match acceptance or perceptual limits were relaxed.

Validation on the PC: 53 targeted Python tests and 19 Node tests passed.
`tests/sdr-match-gpu-interaction.js` passed inside disposable Electron at
2560x1440 under the shared GPU lock. Whole Match took 674 ms / 21 GPU
candidates on its `hdr_headroom.tiff` scenario. Moving Exposure preserved all
other global and local values; raw GPU pixels equalled the original matched
recipe with only Exposure changed. The interaction stayed on WebGPU with no
CPU previews or SDR source-proxy requests. Match and slider Undo/Redo, stable
Denoise/grain previews and resetting the visible controls also passed.
This richer scenario reported `needs_review` (p95 luma 0.03142, p95 OKLab
0.01741); the existing 0.03 normal-match luma gate remains unchanged.

## November 16 (historical): Steve approved safe linking and target-relative ordering

Whole-photo Match first tries the common HDR creative scene and a late SDR
output tail. Only a fit passing all safeguards becomes linked; otherwise the
existing independent fit runs and explains one short reason. The linked tail
must preserve HDR body contrast and tonal relationships within SDR's range,
compressing the highlights gently rather than giving SDR a different look.

Steve's updated decision permits linked ordering to be judged relative to the
Match target built from settled HDR. Use the existing eight HDR-brightness
quantile bins, inclusive memberships, minimum eight highlights and 0.005
allowance. For each adjacent pair, subtract the target's negative median
step (or zero) from SDR's step; fail if that excess is below -0.005. This
accepts only inversions already in the target plus the existing allowance.
Independent Match keeps its absolute ordering diagnostic unchanged. Every
body, colour, white-growth, exposure-editability and output-ceiling check
remains unchanged. Qualification must report linked/fallback counts with both
the previous absolute rule and this approved relative rule.


## Earlier November 16 checkpoint (superseded)

Whole-photo Match does not yet create a live HDR creative-grade link. The
implementation attempt stopped at output-tail acceptance: the original 49
CPU cases still fail 19 ordering and 14 white-growth checks, and the bounded
Exposure/Saturation/HC/gamut probe does not find a satisfactory general tail.
No target, gate, control ownership, saved state or renderer changes. The
independent Match behaviour below remains the shipping behaviour; do not infer
a linked-renderer or saved-schema implementation from the product decision.
See the [tail checkpoint](reports/film-look-equal-input-trial-2026-11-16.md#9-option-b-implementation-checkpoint-no-shipping-change),
including the proposed, unimplemented local-edit/unlink contract.

## Start HDR from SDR: unexposed N5 research

This is **not** a reverse Match: finished SDR has discarded scene highlight
and gamut information. The proposed promise is to retain the finished SDR
body's physical brightness and colour, while grading the original scene's
highlights under the preserved HDR cap. No such action is currently exposed.

`hdr_from_sdr.py` is imported only by research tooling/tests. It snapshots the
SDR result once through the normal renderer, including an authored SDR base
when selected. Both lanes are compared in linear sRGB, nits / 203:
`HDR × R / (.18 × 203)` versus finished SDR pixels, without gamut clipping
the HDR comparison. The target fixes the body mask and colour families for
the entire fit; candidate changes cannot evade gates by changing selection.
Film is retained and rendered normally once; stochastic grain is omitted
only from analysis. The probe copies ordinary creative controls, HSL,
curves, Film settings and locals with masks; wheels use the existing tint
vector solver with the inverse primaries transform, never division by the
forward shoulder attenuation. No captured pixel image or hidden rendering
stage is stored in a recipe.

The HDR seed compensates physical exposure by `log2(100/R)`, translates the
contrast pivot, retains the HDR target and all enabled HC settings, or enables
Fixed cap at Start = 80% of the retained peak when HC was bypassed. The fit
changes only Exposure, Contrast, five Tone strengths, Saturation, Temperature
and Tint, respecting section bypasses. Five bounded coordinate passes use
the real HDR renderer. Research input is limited to 65,536 pixels; the RAW
study uses <=256px proxies after <=512px decoding. This is not native delivery
qualification, and independent denoise/repairs are not integrated into an action.

Acceptance was committed before measuring. Of twelve synthetic/five-RAW
Film-off/Portra cases, only IMG_7723 Film-off passes the overall and sufficiently
sampled-family body gates; it fails the conservative ramp ordering probe by
1.43e-6 common-luma. Eleven body failures cannot support the promised button.
The other eleven ramp probes and all twelve 1000-nit CPU proxy ceilings pass.
No tolerances were widened. Two additional retained-mode probes detect a
600.000061-nit float maximum at a 600-nit target (Soft Ceiling and Clip), and
the new diagnostic correctly refuses that excess rather than borrowing an
encoder allowance. The incumbent renderer is not changed in N5.

Future UI wording, **not implemented**: action “Start HDR from SDR…”;
confirmation title “Replace HDR grade”; explain “Replaces the HDR global
grade and HDR local settings. Keeps SDR and masks unchanged. Uses the
original scene for HDR highlights. Undo restores the previous HDR grade.”
When HC was bypassed, additionally say “Enables Fixed cap at [target] nits.”
Planned tooltip: “Uses the finished SDR picture as a starting point for HDR.
Original scene highlights stay limited by the HDR target.” Source eligibility,
overwrite consent, revision guards, complete source processing and an X2 Undo
transaction must be built and tested before exposing any of this copy.
Existing document-swap Undo/Redo, unchanged SDR, both unexposed app layouts,
and bounded CPU/GPU encoded ceiling/Proof identity were exercised separately.
See the [measurement and validation record](reports/n5-start-hdr-2026-11-16.md).

## Local Match SDR (N4)

The SDR local-grade area exposes one **Match SDR** action for the selected
parent adjustment (including when a child mask is selected). Its promise is
the same **change**, not the same final look. It does not invoke whole-picture
Match or edit the independent SDR global grade.

At a bounded 256px source, render finished HDR with the parent on and
neutralised. Apply the existing `build_sdr_match_target` construction to both
and subtract. Add that difference to the current finished SDR with the parent
neutralised, then gamut-map the target. Fit the selected parent's ordinary SDR
controls through the real complete renderer, with global SDR and the entire
other-local stack fixed. N3a's real-local-renderer translation seeds the fit;
a neutral seed is also tested. Four bounded coordinate passes fit Exposure,
Contrast, five Tone strengths, Temperature, Tint and Saturation. Detail copies
from HDR and is never optimised; no fitted local curves are written. Film,
the final shoulder/cap and sRGB gamut mapper judge every candidate. Grain is
excluded from analysis, as in whole Match; delivery still renders normal grain.

Effective mask coverage must include at least 16 proxy pixels, 0.01% of the
frame, with at least 1% influence. Empty/negligible coverage or a disabled/no
visible HDR contribution returns an explanatory no-op. Acceptance was recorded
before measurement in the sprint brief: existing body luma/OKLab metrics within
the mask, plus mean/P95 Delta E 2000 ≤ 1/3 independently in covered body and
non-body pixels. A failed fit retains the previous grade and history unchanged.
These are proxy qualifications, not a native-size fit guarantee or a fix for
M1/M1d. Two RAW brush cases deliberately refuse at the unchanged gates.

Successful results replace only the selected `sdr_grade` and match snapshot.
Shared/HDR enable flags, masks, geometry, feather, blend, opacity, IDs and order
are preserved. One revision-guarded `update_local` gives one exact Undo.
Repeated Match starts from the current picture with this parent neutralised,
so it replaces rather than stacks. Snapshot mismatch displays **Out of date**;
there is no automatic recalculation. Whole-picture Match still replaces every
SDR local, clears individual match records, and asks before overwriting
individually matched or non-neutral SDR locals (including manual edits).

## Current recipe and output contract

`SDRAdjustments.linked_to_hdr` defaults false. Only an accepted new whole-photo
Match sets it true and disables the authored SDR base. `output_exposure` is a
visible late trim in stops, applied after the common Film and before SDR HC.
It defaults to zero and is ignored by independent SDR rendering. No pixel
snapshot, captured grain selector, migration or compatibility renderer exists.

For linked SDR, HDR Tone/colour, Exposure Bands, HSL, curves, wheels, Detail,
source-anchored HDR locals, Film/grain/halation/lens and Vignette form the common
scene prefix. The independent SDR creative/local stack is not applied on top.
The SDR tail converts ACEScg to linear sRGB, scales by (100/203)/.18, applies
output exposure, then ordinary SDR finishing, HC and gamut mapping. Preview
omits delivery resize/sharpening as before. HDR retains its existing output
compression and exact ceiling; no HDR recipe or pixel change is introduced.
HDR Denoise supplies the linked source; its controls are mirrored to the
existing SDR source route. A source whose Denoise cannot be prepared uses
independent fallback with an explanation.

Match evaluates Film once for its common scene and derives settled HDR from
that same array. The trial's 19 output tails are ranked by body safety, then
whole-frame squared RGB error. Only the selected colour-best tail is checked
for acceptance. A broader shoulder is not substituted just to obtain a link.
Acceptance retains finite/legal output, the normal .010/.030 luma median/P95
and .015/.040 OKLab median/P95 gates, +0.5 EV white growth <=1 percentage
point, and the calibrated exposure-editability checks. Only linked ordering
has Steve's approved target-relative change. A rejected proposal runs the
incumbent independent fitter with its original input and absolute diagnostic.
A failed independent fit remains a refusal, with the link reason also shown.

`set_sdr_match` atomically stores the SDR grade, locals, Denoise and Match
status/reason. Its exact inverse gives one Undo; expected revision rejects
stale analysis. Explicit Unlink, SDR creative edits and actual SDR-local edits
restore independent rendering. The edit and unlink share one history step.
HDR-only edits, shared masks/opacity/bypass and refused or equal Local Match
keep the link. A successful changed Local Match fits the independent SDR
recipe and unlinks in its one local transaction. N4 whole-Match consent stays.
Library paste cannot copy link/output metadata; an SDR creative paste unlinks
and Undo restores it. Existing saved photos remain independent until a new,
accepted Match. The three protected projects are not rewritten.

## Relationship to HDR Highlight Compression

The Match target is still built from settled HDR, including HDR's selected
output compression. Linked SDR renders the common scene before that HDR-only
output stage and applies its own late cap; it does not stack HDR output HC
and SDR output HC. Independent Match's target construction and renderer are
unchanged. HDR caps and the 1% encoded allowance retain their existing rules.

## November 15 N1: final SDR shoulder

SDR compression now follows tone, locals, Film Look, grain and output
finishing, immediately before the unconditional sRGB gamut mapper. Match
candidates and CPU certification use that real order, without an early shoulder.
New Match/Rematch recipes select the existing **Soft Ceiling**, Softness 100,
then fit Start and body controls. A final measured Peak Fit would widen its
knee according to the brightest sample and suppress body colours that the old
fitter expected to adjust after compression. Ordinary new SDR grades still
default to Peak Fit; existing saved modes/settings and their curves remain.

The existing bounded highlight refinement now considers Start for this mode,
retaining body-quality gates and the calibrated +0.5 EV white-area allowance.
It does not author ineffective Peak Detail/Bias searches for Soft Ceiling.
The old Local Tone translation remains a proposal basis; it inserts no render
stage and every result is certified through the actual final tail. N3a replaces
that local approximation along with Local Tone; its complete-highlight-colour
and equal-Film-input rebuild did not pass the unchanged gates and is not shipped.
N1 does **not** claim M1 is fixed: all-colour
research includes regressions and additional safely refused fits, recorded in
[the updated M1 report](reports/m1-colour-follow-up-2026-11-15.md#n1-remeasurement-final-sdr-compression).

All acceptance, colour, exposure-editability and review thresholds stay unchanged.
Tests that pinned Match's generated mode now expect Soft Ceiling; tests of
ordinary SDR defaults still require Peak Fit. Existing materialized recipes
render through the new order and can be Rematched; there is no migration renderer.

## November 15 W3: wheel translation and SDR headroom

Positive wheel Balance favours Highlights in both lanes and in locals.
Materialization retains that value and translates local wheel hue/strength
between working primaries, using the same translation as global wheels.
Tonal range definitions are unchanged (C4 remains open).

The M1a renderer retains SDR contrast/Film Look headroom and maps hue
into legal sRGB at the final boundary, including GPU delivery finishing.
W5 fixed-recipe denim error falls from 5.522 to 0.430 Delta E 2000.
The neutral ramp and body-only residual fit do not constrain the finished
highlight region. With early clipping removed, their zero Peak Detail can
leave values raised by Exposure Bands and finishing above white. Match now
also fits the finished highlight luminance against its target with a bounded
Peak Detail search. It retains every body quality gate the initial recipe
satisfies and cannot improve highlight error by increasing clipped-white area.
This changes the normal visible Highlight Compression control, not the target,
the gamut mapper, stage order, saved schema or a hidden Match-only renderer.
New Match/Rematch operations use this fit; existing materialized recipes keep
their saved controls until Rematch is requested.

No Match acceptance gate changes. The existing +0.5 EV editable-exposure test
now grows the white area by 0.410 rather than 1.279 percentage points, within
the unchanged 1.000 allowance; its body colour P95 is 0.039884, within the
normal matched 0.040 gate. Measurements, shared RAW results and validation
are in the November 15 W3 section of the Grade PRD. This fixture guard is not
a promise that every photograph's white area grows by at most one point.

## November 15 M1: whole-colour follow-up and remaining limitations

M1a does not establish colour equivalence across the whole photograph. The
broader follow-up reproduces the original baseline population (including its
wide-gamut controls), then compares fresh fits at `55e8bb5f` and `83fb8f8c`
for all seven coloured families, grey, three saturations, -4..+3 stops and
Film off / Portra / Ektar / Velvia at 50%. Five shared RAWs also have whole-
image and per-family measurements. [Full tables and methodology](reports/m1-colour-follow-up-2026-11-15.md)
distinguish HDR-to-target (inherent), target-to-SDR (residual), and total.

At the pre-N1 revision, generated SDR still had an early gamut boundary after its shoulder, before
Exposure Bands/contrast. Fitted lifts can raise those already-compressed
colours past white; the final mapper must remove chroma again. Body quality
metrics cover captured-HDR luminance <=0.9, not the highlight population.
The finished-highlight refinement minimizes luminance error with body/white-
area safeguards; it does not certify highlight colour, each colour family,
or the white-area response of later exposure edits. Thus `matched` is not a
guarantee of small per-family/highlight Delta E00. No acceptance rule changes.

Film-off green +2-stop maximum residual rises 11.945 ->23.904 Delta E00 in
the original population; DSC00264 green P95 rises 6.542 ->11.928. Conversely,
the -1-stop Film-off maximum over seven hues falls 3.113 ->1.024; current
75%-saturation chroma ratios there are 1.000, with a small luminance-fit error.
A7R00619's +0.5 EV trim still grows white area 11.594 points. Reducing that
with Peak Detail 35 darkens the fitted target enough to lose the candidate's
normal luma gate and worsens highlight colour. It is not adopted.

M1d remains a separate placement decision: the SDR Film input is not generally
the captured HDR Film input, even though equal-input stock kernels nearly
agree. No hidden Match stage, Film reordering, gamut change, new gate or
tolerance relaxation is implemented in this follow-up. The complete-target
fitting and colour-versus-brightness/editability policy need Steve's decision.


## November 16 N3a: renderer-based local proposals; M1/M1d remain open

The local translator no longer fits a copied linear zone basis. Its bounded
coordinate search calls the actual SDR local renderer, including shared
five-control Tone and its limiter, then the normal full recipe is measured
through the real SDR Film Look → final HC/cap → gamut tail. HDR proposal
ramps receive the parent reference/target. The translated local preserves
`hdr_grade.enabled` independently from layer enabled/opacity. The remote
GPU-candidate path permits at most three conservative CPU-certified RGB
residual passes rather than one, retaining the same improvement predicate
and sparse/editable curve rules; an unsafe result still falls back/refuses.

**Not a full Match rebuild.** The global neutral/body fit still changes
Exposure/Exposure Bands/curves before Film Look and copies print settings.
It does not guarantee equal HDR/SDR Film input or fit highlight colour.
The bounded equal-exposure/prefix-plus-post-film probe misses the unchanged
body colour ceiling: P95 OKLab .067320/.062441/.068645 for Portra/Ektar/Velvia
50% against .050. Its prefix still differs at Film input (P95 absolute luma
.118722); this is a best-found failed probe, not proof of impossibility.
It is not shipped. No hidden Match-only renderer/correction or compatibility
path is introduced, and no body, colour, clipped-white, +.5-EV exposure-room
or editable-slope gate is loosened.

Retain N1 Soft Ceiling for generated Match recipes: both bounded four-mode
searches still select it; no alternative demonstrates safe equal-Film-input
all-colour improvement. Ordinary SDR defaults remain Peak Fit. The supplied
176/224-patch and five-RAW global-only comparisons are identical to pre-N3a
`5bc997f3`; bright-colour residuals and refusals remain, with full comparisons
to `55e8bb5f` and pre-N1 `541dc130` in the [N3a M1 report section](reports/m1-colour-follow-up-2026-11-15.md).
Stored locals with nonzero old Tone strengths change without migration;
new Match/Rematch local proposals also change. N4 should not assume M1d is
resolved.
