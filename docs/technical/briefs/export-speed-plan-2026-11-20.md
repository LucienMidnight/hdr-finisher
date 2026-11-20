# Faster CPU export · November 20, 2026

Start with a faster implementation of the existing gain-map filter, reuse the
SDR JPEG and encoder input within each retrying export, and make the SDR
finishing pass do less work. Keep decoding every HDR candidate and reduce the
ceiling check to the information the correction actually uses. On the 8 GB
MacBook Neo, I expect the Canon Clean Grain Large export to drop from **46.9 s
to about 39–41 s**, and the Sony Clean Grain Small export from **43.3 s to
about 39–41 s**. These are click-to-file estimates. They subtract the measured
processing gains from today's app waits. The prototypes used the backend in
separate locked runs.

The exact codec trials matched the earlier Canon and Sony app exports byte
for byte. With the same denoised pixels supplied to both runs, the SDR
finishing change matched every finished float on both photos. The existing encoder, gain-map calculation, HDR target and Proof
behaviour can all be kept. The two trials that changed the image failed the
perceptual limits. I recommend proceeding with the exact changes once the
Denoise work lands. [Earlier app waits and conditions](denoise-export-proof-breakdown-2026-11-20.md)

## Ranked work

| Priority | Change and saving in one export | Risk and memory | Steve’s approval |
| --- | --- | --- | --- |
| 1 | **Speed up the existing gain-map filter.** About **1½–3 s** Canon across four passes and **2.0 s** Sony in its single pass. A small native loop keeps the same float32 sums, edge padding, filter settings and JPEG steps. | Medium implementation risk. It removes padded temporary arrays and keeps the same two-stripe limit. Check byte identity on both platforms and retain the existing implementation where a native build is unavailable. | **No** for the identical calculation and output. |
| 2 | **Finish the SDR picture in bounded bands using two CPU workers.** On Canon the SDR render fell **4.83 → 2.12 s**. On Sony it fell **3.80 → 3.30 s** with the shared CPU pool. Skip shoulder work for pixels below the knee and drop the duplicate peak scan when the whole-photo peak is already known. | Low to medium. Two half-strips share the present strip budget, with a small extra buffer to join them. Keep the whole-photo peak and the existing gamut mapper. Parallel HDR finishing took longer on this Sony, so the recommendation targets SDR. | **No** for matching finished pixels and delivery bytes. |
| 3 | **Prepare the SDR encoder inputs once per export.** About **1–2 s** on Canon, from the observed cost of three repeat conversions, JPEG writes and raw input writes, allowing for the check. Sony passed once and had **no retry saving**. | Low to medium. Canon saves about **216 MB** of logical raw writes on three retries. Sony would save about **170 MB per retry**. The packed sign check adds **7 MB Canon / 16 MB Sony** plus the existing SDR files for the life of the export. Rebuild if correction changes any HDR channel's positive/zero mask. | **No** for identical bytes. |
| 4 | **Reduce the decoded ceiling check in bands.** The Canon's four decoded checks totalled **3.43–3.87 → 2.99 s**. Sony went **1.98 → 1.77 s**. Also skip correction writes to pixels whose multiplier is one. | Medium. Replaces a **72 MB Canon / 170 MB Sony** peak image with a **0.3 / 0.7 MB** block grid and band scratch. Every decoded sample still gets checked. Keep the existing check as a fallback for unusual orientations until those are qualified. | **No** for the same accept/refuse result, correction and bytes. |
| 5 | **Use bounded finishing for stand-alone SDR JPEG with Denoise.** A native Canon Fine Grain prototype finished in **7.95 s**. At half width and height, the existing route took **3.61 s** and the bounded route **2.80 s** with identical JPEGs. | Useful primarily for memory. The reduced run dropped from **1.94 to 0.67 GB**. Use only for grades the existing strip renderer supports. | **No** once native parity is established. |
| Rejected | **Stronger first local correction.** Canon took three passes in place of four, saving a further **2.53 s** over the exact codec bundle. SDR was identical. HDR ΔE ITP mean **0.321**, P99.9 **10.754**. | High image risk. It meets the ceiling and fails the perceptual tail limit. Sony clears the first check and would not use this correction. | **Yes.** It changes which highlight pixels are delivered. |
| Rejected | **Remove gain-map smoothing.** Canon codec time was **9.93 s**, with a higher first peak and three passes. The result was **22.25 MB vs 12.05 MB**, with HDR ΔE ITP mean **11.26**, P99.9 **48.97**. Sony's single repack fell **3.61 → 0.62 s**, but HDR mean **0.505**, P99.9 **3.187** also missed the tail limit. Both SDR results were identical. | High image risk. Smoothing keeps visible noise out of the HDR rendition and its removal made this case worse. | **Yes.** It changes gain-map maths. |

The three exact codec changes together measured **16.07–18.61 → 12.00–12.13 s**
on Canon, with four passes in both versions. On Sony, filtering, repacking and
the check measured **5.60 → 3.41 s** with one pass. Leave headroom in the
estimates for timings to move when these are installed together in the app.
[Performance table](../performance-table.md)

## Why the Canon kept retrying

The finished Canon is at exactly **1,000 nits**. After the base JPEG and
gain-map JPEG are encoded and combined, reconstruction at bright edges and
in saturated highlights can exceed that peak. The application verifies the
actual delivered pixels. It accepts the initial file at or below 1,010 nits.
Above that it lowers the HDR input around overshooting blocks, aiming back at
1,000 nits, then encodes and checks again.

| Canon encode | Decoded peak | Pixels above 1,010 nits | Hottest pixel (column, row) |
| --- | ---: | ---: | --- |
| Initial | 1,224.88 nits | 1,771 | 3496, 1887 |
| First correction | 1,092.79 nits | 6 | 2203, 1822 |
| Second correction | 1,018.60 nits | 1 | 3242, 1632 |
| Third correction | 999.00 nits | 0 | 2839, 360 |

The first correction handled almost all of the original overshoot, but the
hottest point moved. A single remaining pixel over the allowance still
requires another pass. All three failed candidates exceeded even the 1%
allowance. The Sony's finished peak was **388.65 nits** and its first file
decoded to **397.76 nits** against the same 1,000-nit target.

Each retry needs a new HDR intent, gain map and decode. The map's global
normalisation, JPEG blocks and metadata can respond to an HDR correction even
outside the originally bright block. The SDR grade, dither, primary JPEG and
raw SDR input can be reused inside that export when the flooring mask is
unchanged. The primary's luma guide can also be reused. I left guide reuse and
selective rewrites of changed HDR input bands out of the measured bundle.

A dependable first-pass prediction would need to account for JPEG and
gain-map reconstruction at the troublesome pixels. Turning off smoothing
increased the Canon's first peak to **1,561.60 nits**. Increasing the first
local correction saved only one later pass and visibly changed HDR. The
experiment worth considering after the exact work is a small local repair
to the gain map after reading the first decoded candidate. It could avoid
rebuilding both input planes on some retries, but would still need a final
full decode. It would change the map and needs approval and its own quality
trial. The Canon still needed at least three passes in these experiments.

## What else is on the critical path

- **Finishing.** Today's Canon app spent **11.71 s** finishing both pictures
  including the other strip work around them. The quiet isolated baseline
  finished its HDR strips in **2.50 s** and SDR in **4.83 s**. The latter
  spent **3.99 s** in the final output pass including **1.32 s** in gamut
  mapping. Most of the opportunity lies in the SDR shoulder, which runs
  several calculations even on pixels it later returns as-is. The
  highlight peak must remain a whole-picture measurement. Reduce the SDR
  peak while writing the graded bands and measure scope peaks while writing
  the final bands where the caller needs them. Those are further exact-pass
  reductions with no measured gain yet. HDR and SDR use distinct colour
  spaces and curves. The matching source preparation is already shared.
  Sharing more of the creative grade would need identical inputs and
  operations. That grade work accounts for only 0.39 s in the app trace. Repeated HDR colour conversions and overlapping lanes are lower
  priorities than the measured SDR work.
- **Denoise.** Matching HDR/generated-SDR controls already resolve one
  native source. The prototype traces saw one noise measurement, one Grain
  fit and one tile resolve for each pair. The fit and tile passes both read
  the source, but the tile results depend on the completed whole-photo fit.
  Sharing a fit with a Grade job already measuring the identical source
  could save the reported **1–2 s** race in the slow case. It needs the
  same source identity and a bounded wait. Authored SDR or different
  Denoise controls require separate work. Recheck this area after the new
  Denoise method lands.
- **I/O and scheduling.** The earlier Canon trace attributed **0.16 s**
  outside named stages and about **0.04 s** directly to scratch open and
  flush. The actual plane writes and paging are inside the measured stages.
  At native size a pair of float32 endpoints is **432 MB Canon / 1.02 GB
  Sony**. Keeping their lifetime short and using bounded disk-backed bands
  protects RAM. Overlapping the full encoder with rendering would put those
  buffers and the helper's native allocation in memory together. The Sony
  encoder helper alone reached **1.92 GB**. Keep those stages sequential.
- **Stand-alone SDR.** The current native Canon route completed in **5.70 s**
  with Denoise off. Two native Fine Grain attempts on the current whole-frame
  route stopped on macOS pressure and swap growth. The watchdog caught those attempts as they jumped to about **2.5–2.6 GB**.
  The bounded Fine Grain prototype had a **1.24 GB** peak. SDR runs one render and one JPEG write,
  with no gain-map or HDR check. These timings run from backend export request
  to a validated saved file with the RAW already open. [Prior phase receipts](../../../codebase/output/export-proof-breakdown-2026-11-20/)

## Implementation after Denoise

1. Run the existing full-size Canon and Sony Export actions on the settled
   branch and capture the wait, peak and output hashes. Hook up the exact
   filter, per-export SDR input reuse and compact verification separately.
   Keep staged-file validation and atomic publication. Preserve the legacy
   path for unsupported cases.
2. Add the SDR strip change through the shared CPU pool. Keep the same
   whole-photo anchors and check the current handling of authored SDR,
   framing, watermark, resizing, sharpening, dithering, robust Peak Fit,
   other HDR white points and a near-black SDR base. Use bounded SDR JPEG
   where the existing strip renderer is eligible.
3. Compare native CPU Export bytes and full-size Proof bytes with the
   existing behaviour as a regression check. Keep Proof's processing out
   of the speed project. Check a retry-heavy frame and a one-pass frame,
   exact pre-encode peak, every encoded ceiling and destination preservation
   on refusal. Measure actual click-to-file waits, CPU contention and memory
   at the normal budget before publishing a new speed number.

## Measurement scope

MacBook Neo, Apple A18 Pro, six cores, 8 GB, macOS 27.0.1 on AC. App
checkout `a217b2db`, native Canon `IMG_0790.CR2` at 5202 × 3464 and Sony
`_DSC7970.ARW` at 7968 × 5320. CPU, JPEG Ultra HDR Q90, full map Q90,
4:2:0, automatic dither, 1,000-nit Highlights, matched generated SDR,
no metadata or sharpening. Signed AHD, harsh-speck cleanup 2.5, lens off.
Standalone SDR was Q90. Timing comparisons used a 5% noise band, consistent
with the earlier study. The Canon codec baselines spread more than 5%, so
the forecast is a range. Decoded trial-to-current differences use the
project's mean <1 and P99.9 ≤3 perceptual thresholds per lane, with the
exact pre-encode ceiling and 1% encoded allowance checked separately.

All photographic measurements used the shared lock and a watcher that
stopped on system pressure, swap growth or a roughly 2 GB process-tree
footprint. The first Sony native encode attempt stopped on OS pressure even
with the helper isolated. It completed on a quiet retry. The Canon staging
trial in isolation hit pressure twice. The combined exact run completed,
so its isolated contribution is estimated from component timings. A first
attempt to compare Canon finishing across separate Denoise runs found
four to ten differing float channels. Using identical denoised input
isolated the finishing change and produced exact matches. The Canon also
gave the original JPEG bytes when the faster finishing and codec were
combined. Both RAW hashes match the approved originals.

The pressure-monitored commands accounted for about seven minutes of
sampled machine time, including stops. I used separate Sony stages and
cut additional encoder settings and whole-app repeats. The exact bundle
still needs an integrated app timing. The measurement scripts and receipts
are local scratch. Scratch ended at 15.9 GB against the 100 GB limit.
[Prototype scripts and receipts](../../../codebase/output/export-speed-2026-11-20/)
