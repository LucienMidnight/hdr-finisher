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
[Logs and diagnostic drivers](../../../codebase/output/denoise-mac-open-items/)
· [Performance table](../performance-table.md)
