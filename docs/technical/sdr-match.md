# HDR-to-SDR Match

HDR-to-SDR Match is a recipe-snapshot operation. An active match owns a captured HDR recipe, ordered HDR local grades and masks, reference-white and source identity, highlight-boundary values, a stale-detection signature, and the independent SDR state retained for Revert. SDR controls remain separate trims over the matched rendition.

Grain has one match-specific source selector. `captured_hdr` synthesizes the captured HDR grain once, after SDR trims; `sdr_override` uses the current SDR grain controls instead. An edit to any `sdr.film_look.grain_*` field atomically copies the captured grain recipe into SDR, applies the edit, and switches the selector. The two grain recipes are never stacked.

Match, Rematch, Revert, and the first grain override apply a fully materialized `set_sdr_match` command. Its forward and inverse payloads contain the exact Match state, global adjustments, and local adjustments, making each action one deterministic undo step. Proxy analysis happens before mutation and the command's expected revision rejects results computed from stale state.

## Relationship to HDR Highlight Compression

HDR Peak Fit or Soft Ceiling remains an early creative operation inside the captured HDR grade; SDR Match neither replaces nor bypasses it. The Match knee runs later against the fully rendered, already-compressed HDR result, so the two shoulders intentionally stack: Peak Fit shapes the HDR highlight relationships first, and Match compresses only the remaining HDR headroom into SDR.

The automatic percentile `P` is measured after Highlight Compression and the rest of the captured HDR recipe. Peak Fit can therefore lower `P`, move the automatic Match knee upward, and produce a gentler SDR shoulder. The Peak Fit-shaped relationships remain visible in SDR; additional compression applies only where highlights still extend beyond the Match boundary.
