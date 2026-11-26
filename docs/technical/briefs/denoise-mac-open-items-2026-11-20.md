# November 20 Denoise and Match on the MacBook Neo

Work started from `3411e81e` on `feat/denoise-v1`, in sync with GitHub.
Setup passed and found all declared test media. Tests used the 8 GB
MacBook Neo at 1408 × 794, with each Electron and GPU run under the shared
lock. Tracked changes are local to this branch.

## 1. Mac checks of the PC changes — done

- The starting fast suites passed with 1,116 Node and 4,303 Python passes.
  The final suites reported **1,117 Node passes** and **4,305 Python passes**, with zero
  failures. Node skipped one test. Python skipped 150 and reported one
  unexpected pass, also present in the starting run.
- Grade held the Canon picture steady in all six HDR holds across Fit and
  100%. There were zero new picture requests while still, zero blank frames,
  zero switches to a soft picture after three exposure changes and zero
  memory refusals. The final driver kept a whole picture under every pan
  and achieved sharp coverage at every stop. It passed all three HDR methods
  and a cropped and rotated SDR case. Canon SDR at Fit and 100% passed with
  Denoise off, Standard, Fine Grain and Clean Grain. The highest sampled
  whole-app footprint across these Canon checks was **2.03 GB**, below
  the **4 GB** app ceiling on the 8 GB Mac.
- SDR gamut parity passed the same **3,044** vectors as Windows. The greatest
  CPU/GPU channel difference was **0.00000724**, against **0.000200**.
- Match used **21 GPU candidates** in the interaction test, like Windows.
  The final P95 colour error was **0.0212** against **0.050**. The two RAW
  cases also repeated the Windows routes. The Canon linked at **0.00204**
  P95 colour error against the linked limit of **0.040**. The hibiscus
  stayed independent and used **12 GPU candidates**, with **0.00091**
  against **0.050**. Both cases reached an exact WebGPU picture and
  restored the previous grade with Undo.
- All three methods passed the JPEG Ultra HDR delivery smoke on CPU and GPU.
  The largest finished HDR mean and P99.9 errors were **0.0240 and 0.0655**.
  For SDR they were **0.0105 and 0.0711**. The gates are mean **<1** and
  P99.9 **≤3**, plus Denoise P99 **<3**. Full-size watermarked Proof was
  byte-identical to export. All sampled finished HDR inputs stayed at or
  below **1000 nits** before encoding. The all-codec test passed CPU and GPU
  export, reduced Proof and full-size Proof, with full-size byte identity.
  Its highest decoded reading was **1009.61 nits** under the **1010-nit**
  encoded limit for the 1000-nit target.
- The pan driver now uses the supported scroll path and Navigate, and opens
  Crop & Rotate before using its buttons. The delivery test capture now
  forwards the production render’s options. These repairs are in the tests.

Previously recorded exceptions include the PC tooltip and research/tooling failures, the adaptive Denoise readback fixture gap, the protected project’s Windows source path and the full-size Sony Proof memory issue. The Mac fast suites were green and the focused runs left those earlier exceptions alone. [Known limitations](../../known-limitations.md)

## 2. Small HDR Library pictures — failed, measurements complete

On the edited Canon, the live 640-pixel Fine Grain and Clean Grain draws
lost their preparation before fetching the first correction region. The app
returned “Grain preparation was replaced” in **0.48 and 0.35 s**,
respectively, with no usable HDR picture from either request. The existing
640-pixel CPU fallback graph could be measured separately. Its finished
pictures missed the HDR limits of **mean ΔE ITP <1, P99 <3 and P99.9 ≤3**
against a native CPU export resized to the same dimensions.

| Trial | Fine Grain time | Fine Grain mean / P99 / P99.9 | Clean Grain time | Clean Grain mean / P99 / P99.9 |
| --- | ---: | ---: | ---: | ---: |
| Existing 640-pixel CPU graph, including cold decode | 3.36 s | 18.49 / 77.59 / 197.21 | 2.82 s | 18.60 / 79.32 / 192.04 |
| Read prepared full-photo Grain and finish at 640 pixels | 0.59 s | 10.28 / 64.55 / 140.42 | 0.73 s | 8.97 / 65.07 / 140.12 |
| Prepare at 1280 pixels and resize the finished picture to 640 | 0.67 s | 15.32 / 71.57 / 112.00 | 0.55 s | 14.71 / 63.04 / 96.05 |
| Finish the native picture and resize using the export path | 4.41 s | Reference | 7.17 s | Reference |

The three candidate timings start with the RAW already decoded. Rereading
the full-photo Grain result also assumes its **5.75 s Fine / 8.50 s Clean**
preparation is already available. The live Library trial peaked at
**1.39 GB** whole-app memory. The CPU alternatives reached **1.89 GB** for
the measurement process, separate from the app census. The Denoise-off
control also missed the colour tolerance, at **34.12 mean / 109.94 P99**,
so the observed discrepancy extends beyond Grain. The export reference
meets the colour requirement by construction and costs several seconds
per photo even after decoding. Neither faster candidate meets the colour
gate. Library behaviour therefore received no production change.

## 3. Shared HDR and SDR Denoise methods — done

HDR and SDR already offered Standard, Fine Grain and Clean Grain through
the same Grade code. Generated SDR already reused an identical HDR
preparation on the first switch. Recalculate tracked its refresh separately
per rendition, causing the next SDR switch to repeat expensive work on the
same photo.

The refresh now follows the source pixels. On the Canon with identical Fine
Grain settings, switching to SDR after Recalculate in HDR improved from
**13.34 s to 0.33 s**. The same prepared result was used and the backend
recorded zero extra SDR preparations. Whole-app peak went from **1.63 GB to
1.55 GB**, below **4 GB**. An imported Ultra HDR JPEG produced a separate
preparation for its authored SDR base in the real app. The route tests cover
both Grain methods and check that authored SDR cannot read the HDR
corrections. The delivery smoke repeated the same metrics after the change.

The guide and Grade decision table record Steve’s November 20 decision.
Settings remain per rendition, including the existing linked and
independent Match behaviour. [Denoise guide](../../user-guide/denoise.md) ·
[Grade decisions](../../product/modules/grade.md#3-decisions)

## 4. Match with the Canon’s separate SDR grade — done, with one refusal

The real app started with an independent SDR Exposure of **−0.25 EV**.
With HDR Exposure at **+1 EV** and a **120/450-nit** Highlight Compression
range, Match chose an independent SDR grade and reached the exact picture
in **5.47 s**. It used **20 GPU candidates**. The exact CPU check measured
**0.0112 P95 luma** against **0.060** and **0.0299 P95 colour** against
**0.050**. The app marked it **Needs review** because the median colour error was
**0.0210** against the tighter **0.015** confidence threshold. Undo restored
the prior independent SDR grade exactly.

At the Windows-documented stronger **120/300-nit** setting, the Mac
safely refused at **0.035 P95 luma** and **0.077 P95 colour** against the
same limits. Windows also refused that setting at **0.061 P95 colour**.
On the Mac the prior SDR grade and revision were preserved. No fitting
or acceptance rule changed.

## Decisions for Steve, in order

1. **Library**. A finished thumbnail saved when a native render is already
   available could improve revisits without adding a multi-second wait to
   opening a folder. Cold thumbnails would still need a separate solution.
   Rendering every cold thumbnail exactly would trade folder speed and
   memory headroom for agreement with export.
2. **Match**. The independent Canon case works. Improving the stronger
   300-nit case would need a separate fitting pass and timing checks within
   the current limits. The current refusal preserves the SDR edit.

## Commits and checks

- `edbd3d18` forwards bounded Denoise render options through the delivery test capture.
- `5851893a` uses Grade’s supported pan controls and opens Crop & Rotate in the driver.
- `50945dfa` shares Grade Grain preparation after Recalculate and records Steve’s decision.
- This report and the remaining Mac timing entries are in the commit
  **Record the November 20 Mac Denoise and Match checks**.

The three read-only projects kept the same SHA-256 hashes. The logged slow
attempts totalled **about 22 minutes**, including retries, within the 90-minute
allowance. Scratch output was **15.1 GB** against the **100 GB** limit.

## 5. Overnight bug-fix report — November 20, 2026

The nine audit findings are fixed locally on `feat/denoise-v1`.
Small HDR Library pictures still do not match Grade/export colour on the
Canon test; that is separate from the fixed failure to draw them. Nothing
was pushed, merged, tagged, or packaged for release.

| Finding | Status and evidence |
| --- | --- |
| 1. Authored SDR export ignored Denoise | **Fixed.** Before, Denoise On and Off produced the same authored SDR pixels. Now Standard, Fine Grain with Evenness at zero, and Clean Grain with both Evenness and Color Splotches at zero change the authored SDR, and CPU strip and whole-picture outputs agree exactly. In the real imported JPEG test, Grade versus CPU export measured **0.198 mean / 0.622 P99 / 0.730 P99.9 ΔE 2000**, inside the unchanged **<1 / <3 / ≤3** limits. Full-size Proof and CPU export were byte-identical. |
| 2. Match and Undo reused the wrong SDR source | **Fixed.** A same-size real-app test exposed an authored linear-sRGB texture under the generic cache key. Match now uses generated ACEScg pixels, and Undo restores the authored linear-sRGB pixels and Denoise selection. The separate Match interaction test also passed with **21 GPU candidates** and **0.0212 P95 colour error** against **0.050**. |
| 3. Library Grain expired before the first read | **Fixed.** The 640-pixel correction read went from HTTP 409 to complete pixel data and became unavailable only after the draw released it. Real Canon Fine/Clean Grain draws returned pictures with no HTTP errors. If the preparation does expire, a current draw goes to the CPU once; an actual user cancel stops it. |
| 4. Grade CPU fallback dropped Denoise | **Fixed.** A forced Fine Grain validation failure in Electron made **one GPU attempt**, then showed the CPU picture. The pixel check confirms the CPU result isn't the untouched source. A bounded Full request above the existing **4096-pixel** whole-preview baseline uses that reduced edge and says it is reduced instead of claiming Full or omitting Denoise. |
| 5. Stuck on Recalculating | **Fixed.** A rejected or thrown save, unavailable GPU, or expired preparation no longer leaves the controls busy. The error offers Recalculate, and the test verifies that it retries a failed save. |
| 6. Cancelled Grain work kept running | **Fixed at the requested boundaries.** The browser stops obsolete reads and uploads. An obsolete fit cannot start tile work, and the backend passes cancellation to existing tile workers. A fit already inside a numerical operation can finish, but its result is discarded. `denoise_grain.py` was not edited by this work. |
| 7. Library replaced the saved highlight target | **Fixed.** The Library spec requires the saved target; its proposed optional 1000-nit comfort cap is explicitly marked not built. The old CPU path reached **832 nits** on a saved **400-nit** test; the new path is at or below **400** before encoding, and the Library GPU graph receives **400**, not **1000**. Stored HDR picture keys turn over so old pictures are not reused. |
| 8. Panorama Fit failed | **Fixed.** The 18,001-pixel regression now requests the supported Fit measurement instead of asking the API for an unsupported native width. The API limit is unchanged. |
| 9. Finished HDR thumbnails survived decoder changes | **Fixed.** A stored HDR picture is no longer returned after a source-development or decoder identity change. The test reads the original bytes, changes the decoder, and verifies a cache miss. SDR keys are unchanged. |

### Tests and limits

- JavaScript: **1,125 passed, 1 skipped**. Python: **4,314 passed, 150 skipped,
  1 unexpectedly passed** (the same expected-failure marker as before);
  **78 focused Python checks** passed again. An earlier Python attempt overlapped
  Electron and failed eight checks; the isolated full rerun had zero failures.
- Locked Mac tests passed: Denoise delivery (all three methods, CPU/GPU,
  authored SDR, and watermarked Proof), all-codec ceiling and Proof size/byte
  identity, JPEG XL high fidelity, GPU repeat delivery, Proof size controls,
  Match and linked SDR, the default Library smoke, and real 640-pixel Canon
  Grain drawing. The unchanged HDR ceiling checks passed before encoding;
  the all-codec decoded high was **1009.61 nits** for a **1000-nit** target,
  within the existing encoding allowance. No tolerance or budget was relaxed.
- The Denoise measurement driver's **36 synthetic comparisons** passed. Its
  full corpus is **blocked** by the missing noise-free linear EXR. The two
  protected-project Proof/Grade drivers were **blocked** by a missing
  source path; no protected project was relinked or modified. The bounded
  and authored delivery checks above ran on accessible fixtures instead.
- Small HDR Library colour parity remains **not fixed**: the live Canon Fine
  and Clean draws were **18.42 / 77.59 / 198.65** and **18.56 / 79.32 / 192.57**
  (mean / P99 / P99.9 ΔE ITP), outside **<1 / <3 / ≤3**. The Denoise-Off control
  also missed. These are colour failures, not drawing failures.
- Slow attempts took **about 9½ minutes** on the **8 GB MacBook Neo**, one
  app/GPU run at a time at **1408 × 794** under the shared lock. The three
  protected project checksums are unchanged; scratch was **15.2 GB / 100 GB**.

### Decisions for Steve, in order

1. **Full-size JPEG Proof memory — not fixed.** The reported native-size
   path can reach **13.5 GB** (`proofing.py:279` and `:537`). Give this its
   own pass: reuse owned buffers between finishing and encoding, or stream
   bounded strips directly into the encoder rather than retaining multiple
   full-sized pictures. That should reduce memory pressure, but changing
   buffer lifetimes or processing order could change the delivered file.
   Require full-size Proof/export byte identity and the exact HDR ceiling
   before accepting it on the Neo.
2. **JPEG peak correction copy — not fixed.** `hdr_ceiling.py:167` copies the
   full RGB image during peak correction. Try correcting bounded strips or
   reusing a buffer only when it has a single owner. Strips lower peak memory
   but can add a pass; in-place reuse is cheaper but could damage another
   rendition if it shares those pixels. Keep the correction math, exact
   pre-encode ceiling, and encoded rounding rule unchanged.
3. **Small Library colour.** Keep the now-working quick pictures while
   investigating why even Denoise Off differs, or use an exact finished
   thumbnail when a native render already exists. Reusing finished pictures
   would help revisits, not first opens. Rendering every cold thumbnail at
   native size would cost several seconds per photo and more memory.

### Local commits

- `5105a4cc` — invalidate finished HDR thumbnails after source-development changes.
- `de20bf58` — fix Denoise, Match, Grade fallback and Library rendering; add regressions.
- This report is committed separately as **Record the overnight Mac Denoise bug fixes**.
[Logs and diagnostic drivers](../../../codebase/output/denoise-mac-open-items/)
· [Performance table](../performance-table.md)
