# HDR-to-SDR Match

HDR-to-SDR Match is a recipe-snapshot operation. An active match owns a captured HDR recipe, ordered HDR local grades and masks, reference-white and source identity, highlight-boundary values, a stale-detection signature, and the independent SDR state retained for Revert. SDR controls remain separate trims over the matched rendition.

Grain has one match-specific source selector. `captured_hdr` synthesizes the captured HDR grain once, after SDR trims; `sdr_override` uses the current SDR grain controls instead. An edit to any `sdr.film_look.grain_*` field atomically copies the captured grain recipe into SDR, applies the edit, and switches the selector. The two grain recipes are never stacked.

Match, Rematch, Revert, and the first grain override apply a fully materialized `set_sdr_match` command. Its forward and inverse payloads contain the exact Match state, global adjustments, and local adjustments, making each action one deterministic undo step. Proxy analysis happens before mutation and the command's expected revision rejects results computed from stale state.

## Relationship to HDR Highlight Compression

HDR Peak Fit, Soft Ceiling, or Clip remains part of the captured HDR grade; SDR Match neither replaces nor bypasses it. Output Highlight Compression finishes the rendered HDR result before the Match knee maps its remaining headroom into SDR, so the two shoulders intentionally stack.

The automatic percentile `P` is measured after Highlight Compression and the rest of the captured HDR recipe. Peak Fit can therefore lower `P`, move the automatic Match knee upward, and produce a gentler SDR shoulder. The Peak Fit-shaped relationships remain visible in SDR; additional compression applies only where highlights still extend beyond the Match boundary.


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

Generated SDR still has an early gamut boundary after its shoulder, before
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
