# HDR-to-SDR Match

HDR-to-SDR Match is a recipe-snapshot operation. An active match owns a captured HDR recipe, ordered HDR local grades and masks, reference-white and source identity, highlight-boundary values, a stale-detection signature, and the independent SDR state retained for Revert. SDR controls remain separate trims over the matched rendition.

Grain has one match-specific source selector. `captured_hdr` synthesizes the captured HDR grain once, after SDR trims; `sdr_override` uses the current SDR grain controls instead. An edit to any `sdr.film_look.grain_*` field atomically copies the captured grain recipe into SDR, applies the edit, and switches the selector. The two grain recipes are never stacked.

Match, Rematch, Revert, and the first grain override apply a fully materialized `set_sdr_match` command. Its forward and inverse payloads contain the exact Match state, global adjustments, and local adjustments, making each action one deterministic undo step. Proxy analysis happens before mutation and the command's expected revision rejects results computed from stale state.

## Relationship to HDR Highlight Compression

HDR Peak Fit, Soft Ceiling, or Clip remains part of the captured HDR grade; SDR Match neither replaces nor bypasses it. Output Highlight Compression finishes the rendered HDR result before the Match knee maps its remaining headroom into SDR, so the two shoulders intentionally stack.

The automatic percentile `P` is measured after Highlight Compression and the rest of the captured HDR recipe. Peak Fit can therefore lower `P`, move the automatic Match knee upward, and produce a gentler SDR shoulder. The Peak Fit-shaped relationships remain visible in SDR; additional compression applies only where highlights still extend beyond the Match boundary.


## November 15 W3: wheel translation and SDR clipping draft

Positive wheel Balance favours Highlights in both lanes and in locals.
Materialization retains that value and translates local wheel hue/strength
between working primaries, using the same translation as global wheels.
Tonal range definitions are unchanged (C4 remains open).

The M1a renderer draft retains SDR contrast/Film Look headroom and maps hue
into legal sRGB at the final boundary, including GPU delivery finishing.
W5 fixed-recipe denim error falls from 5.522 to 0.430 Delta E 2000.
No Match acceptance gate changes. The existing +0.5 EV editable-exposure test
still exceeds its white-area growth allowance (1.279 versus 1.000 percentage
points), so M1a is blocked rather than complete. Measurements, shared RAW
results and validation are in the November 15 W3 section of the Grade PRD.
