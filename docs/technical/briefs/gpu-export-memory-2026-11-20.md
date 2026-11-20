# GPU export memory on the MacBook Neo — November 20, 2026

**Decision:** Turn on the new GPU route for native-size Clean Grain Large
SDR JPEG up to the tested 18.02 MP. That Canon export went from **13.45 s
to 4.89 s**, with matching colour and a **1.986 GB** app peak. The CPU still
takes over on failure or when selected in Preferences. Keep the other
streamed JPEG cases opt-in for now.

## What changed

The old trial kept several copies of the photo. On the 42.4 MP Sony it
asked for at least **5.332 GB** before opening a GPU job. That was an
estimate, not a measured peak. The estimated work included a 509 MB
copy of the input, two RGBA output pictures (1.356 GB), the RGB copies
made for the encoders (1.017 GB), and an allowance for the finishing
textures. Those numbers describe ownership; they are not additive to the
old estimate.

The new route reads the developed source in strips. Grade lends its copy
to the broker; a separate batch worker stages its source on disk. The GPU
keeps one half-float picture of the graded result at a time, and releases
that lane before rendering the next. It finishes and hands back 32 rows
at a time over a local connection. Each strip is acknowledged before the
next one is sent, avoiding the memory growth from repeated transfers through
Electron's main process. The broker checks the rows and writes RGB directly
to scratch files, which the encoders read in bands. A JPEG
ceiling retry can still change its own highlights without copying or
changing the cached picture. Stand-alone SDR makes only the SDR rendition.
The admission check counts the live app, other reservations, the GPU
allowance and bounded transfer scratch. The **4.000 GB ceiling is unchanged**.

The other native-size JPEG cases with no geometry, frame, watermark or
output sharpening can use `HDR_FINISHER_GPU_STREAMED_DELIVERY=1` for trials.
This does not move Micro Grain off the CPU delivery source.
There are no encoder or gain-map changes. Full-size Ultra HDR Proof uses
the same export path and keeps its existing shared render identity.

## How it was checked

MacBook Neo (8 GB), 1408 × 794 Electron window, original RAW dimensions,
0 EV, signed AHD, 2.5 speck cleanup, no lens correction. Q90 JPEG and,
where applicable, a full Q90 gain map, 4:2:0 chroma, automatic dither and
a 1,000-nit HDR target. The clock runs from the Export click to a saved
file and the success status; it excludes opening the RAW. Peaks are sampled
physical memory across the app and its child processes. Each run took the
shared GPU lock and stopped on app limit, macOS pressure or swap growth.
Run-to-run noise is a reason not to qualify a borderline single timing.

An injected invalid GPU result on Canon Fine Grain, tested on the first
streamed implementation, entered the ordinary CPU
fallback once. The saved Ultra HDR JPEG had the same SHA-256 as the forced
CPU export. The app did not try the GPU again. A separate Canon Denoise-off
run built full-size Proof after export on the same GPU route; the two JPEGs
matched byte for byte.

## What fit

Before the change, Canon Fine Grain and Clean Grain Small GPU Ultra HDR
peaked at 3.54 and 3.70 GB; they now completed at 2.951 and 3.122 GB in
the first streamed tests. Canon Large previously stopped and now saved at
3.117 GB. The Sony used to be refused before upload, so there is no old
measured GPU peak to compare. With the final local strip connection, Sony
Fine Grain saved Ultra HDR at **3.771 GB** and Clean Grain Small at
**3.761 GB**. All three Sony SDR GPU cases saved below **3.025 GB**.

Sony Ultra HDR with Denoise off was admitted and finished GPU processing
in 5.78 s, but macOS signalled memory pressure entering encoder
preparation. The last sampled app footprint was 2.941 GB; this is not a
completed export peak. The CPU comparison also stopped on pressure, so
there is no click-to-file comparison for this case. All other requested
settings have a completed pair, with the transport version noted in the
[timing table](../performance-table.md#november-20--streamed-gpu-jpeg-export-trial).

## Why the other cases stay experimental

The graphics card only replaces picture processing. It does not replace the
JPEG encoder or the decode that checks the delivered highlights. In the Canon
Ultra HDR Large trial (24.73 s GPU versus 33.68 s CPU), GPU work took 7.75 s
and the codec spent 16.23 s making and checking four candidates. The Canon
Small codec spent 12.66 s on three candidates. Sony Clean Grain Small spent
16.26 s on GPU work and 12.35 s in the codec (31.19 s total versus 32.60 s
CPU). Sony Fine Grain was slower than CPU. Sony Small SDR saved 36–49% in
the measured runs, not enough for a reliable default.

## Colour and brightness

On the saved SDR files, Fine Grain and Clean Grain passed on both cameras.
The qualifying Canon Large SDR scored **0.094 / 1.230 / 1.846** in ΔE 2000
(mean / p99 / p99.9); it saved the same JPEG before and after the local
connection change. Denoise off failed the stricter tail check on Canon
(0.184 / 2.272 / 4.148) and the p99 and tail checks on Sony
(0.534 / 3.737 / 5.638).

Canon Large reached exactly **1,000 nits** before encoding on both routes.
After decoding it reached 998.87 nits on GPU and 999.59 nits on CPU. Its HDR
colour difference was 0.065 / 0.849 / 6.398 before encoding and
5.509 / 21.971 / 33.869 after decoding, in ΔE ITP. No measured Canon
Ultra HDR case passed the saved HDR colour limits. Sony Clean Grain Small
passed mean and p99 (0.392 / 2.941) but missed the stricter p99.9 limit (3.973).
Sony Fine Grain missed p99 and p99.9 (0.815 / 3.312 / 4.612). Both decoded
Sony files stayed below the selected ceiling. A correct brightness limit
does not make the colours match, and these measurements do not establish
the cause of the differences. Codec and gain-map maths were left alone.

### Canon Large: where the saved files differ

The original CPU and GPU runs each encoded four candidates and applied three
local ceiling corrections, with the same margins (0.3%, 0.6%, 1.2%). Equal
pass counts do not mean equal corrections: the first CPU candidate decoded
to 1,498.54 nits, and the first GPU candidate to 1,342.53 nits.

| Decoded candidate peak (nits) | CPU | GPU |
| --- | ---: | ---: |
| First encode, before retries | 1,498.54 | 1,342.53 |
| After correction 1 | 1,012.38 | 1,038.56 |
| After correction 2 | 1,013.19 | 1,022.36 |
| After correction 3, saved | 999.59 | 998.87 |

The final tags have the same gain bounds (0.0625× to 16×), gamma (1),
SDR and HDR offsets (both 0.0000001), minimum display capacity (1), and
reconstruction colour space (sRGB). Maximum display capacity differs
slightly (CPU 4.20214, GPU 4.20150). An eighth-resolution JPEG decode shows
where the larger difference lives: the saved SDR base differs by just
0.37 code values per channel on average, while the saved gain map differs
by 10.64 (p99 70), on the same 0–255 scale. That identifies different
gain-map samples, not a large difference in the metadata. The discrepancy
is larger in the dark parts of the SDR base: the mean map difference is
17.06 codes where both bases are below code 16 in all channels, versus
1.83 where either base reaches code 128. The saved files and pass logs
alone do not establish which encoding stage first introduced that
difference or how many input pixels the corrections changed.

The no-capture Sony follow-up checked normal macOS pressure before waiting,
but did not acquire the shared lock within about ten minutes. The Micro
Grain demo was deliberately left open for review and held the lock. It was
left untouched. The Canon own-intent check and correction-footprint counts
need a fresh CPU/GPU pair because the original uncompressed captures were
removed after the first comparison. Neither that pair nor the final full
suite rerun started while the lock was held.

## Checks and next step

The initial streamed change passed the locked full Node suite (1,127 passed,
1 skipped) and grouped Python suite (4,363 passed, 150 skipped, 1 unexpected
pass). After the socket and default changes, 41 focused Python checks and
JavaScript syntax passed; the full suites were not repeated. Real-app receipts
and saved JPEG comparisons are in `codebase/output/gpu-export-memory-2026-11-20/`.

Before expanding the default, repeat Sony Ultra HDR with Denoise off without
the benchmark image captures, and trace memory at the start of encoding.
That distinguishes pressure from the measurements themselves from memory
that export needs to release. This needs about 5–10 minutes of locked app
checks; ask before continuing past the slow-test allowance. Investigate the
HDR colour mismatch separately before proposing any change to the encoders.
