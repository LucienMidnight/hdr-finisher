# Large native exports at the 4 GB default

## Recommendation

Keep GPU export and Proof when the job fits. At the Mac's 4 GB default,
accept the existing bounded CPU route for eligible large exports. Use the
same size-and-memory rule on Windows, not a blanket CPU switch or a rule
that keys only on the device. Do not raise a default or take the GPU path
just because the system has spare RAM.

## What the setting does

- **Memory the app may use** is a whole-app host RAM budget. It covers
  Electron, renderer host allocations, Python and child helpers, and sets
  the cache/admission limits and the memory pressure target (600 MB below
  the ceiling). It is not a guaranteed peak or a GPU memory limit. The
  default and minimum are 4,000,000,000 bytes on macOS and Linux and
  6,000,000,000 on normal Windows. Windows has a separate `unified-8gb` test
  profile that selects 4 GB. The settings input and backend agree
  (`desktop/lib/application-preferences.js::defaultAppMemoryBytes`,
  `backend/hdr_finisher/app_memory.py::memory_options/budgets/configure`,
  `backend/hdr_finisher/library_api.py::memory_setting_update`). The
  November 16 Windows figure in the Export PRD is historical. The master
  and memory PRDs record the November 22 change to 6 GB.
- **The route change is a preflight, not an arbitrary megapixel switch.**
  In `backend/hdr_finisher/exporters.py::_render_export_branch`, for the
  ordinary strip-eligible, unresized native cases here, the GPU estimate is
  12 bytes per source pixel + 76 bytes per native output pixel + 288 MiB.
  Add the 1.3 GB starting allowance. If the sum is **greater than** the app
  ceiling, the job is marked bounded CPU before the full GPU delivery pair
  is allocated. `gpu_delivery.py::_render_pair` publishes reason code
  `app_memory_ceiling` and the result says “GPU delivery working set does
  not fit the existing app memory ceiling; using bounded CPU strips.”
  Equal fits that test. Below it, GPU is eligible, not guaranteed. The app
  keeps native output size when it switches and does not attempt the
  rejected GPU job first. The delivery decision is cached for a matching
  source/grade/finishing/policy so Proof and export can agree.
- That arithmetic gives **27.25 MP at 4 GB** and **49.98 MP at 6 GB** for a
  source and native output of the same dimensions. For example, a
  42.39 MP frame (7,968 × 5,320) estimates **5.332 GB total**. The active
  Sony A1 frame (8,660 × 5,784, 50.09 MP, nominally 50.2 MP) estimates
  **6.010 GB total**, only 9.86 MB above the normal PC default. On the PC,
  the first is eligible at 6 GB if the recipe fits that simple case and
  the other gates pass. The A1 goes to CPU at 6 GB for the observed native
  recipe. Both are beyond 4 GB. Resize, geometry, framing, active
  Denoise and graph support change the estimate or which route qualifies.
  Prepared Denoise can use live census plus reservations and another
  transport allowance; the experimental streamed path also has live
  admission. High-fidelity JPEG XL has its own estimated reservation and
  physical-memory preflight in `exporters.py::_reserve_high_fidelity_jxl`.
  Unsupported graphs do not acquire strip support just because they are large.
  The route labels describe grading/finishing. RAW development and encoding
  can still run on the CPU in a GPU delivery.
- **Two other limits are separate.** Available system memory minus a safety
  reserve (for the full-source proxy, max of 2 GiB and 15% of RAM) can
  refuse a source transfer even when the job fits the configured ceiling
  (`resource_preflight.py::_estimate_preview_resources`,
  `main.py::webgpu_proxy_stream`). That is the “0.09 GiB safely available”
  class of refusal, not a 4 GB setting or a measurement of VRAM. The
  shared GPU broker and renderer then have their own adapter, buffer,
  texture and finishing limits (`gpu_delivery.py::next_job/reserve`,
  `frontend/gpu-delivery.js`). The Auto VRAM policy uses half detected
  dedicated memory where supported, otherwise a conservative policy
  candidate, normally 2 GiB. The 4 **GiB** adapter classification in
  `frontend/gpu-budget.js` is not the 4 **GB** app setting.

## What this means on the MacBook Neo

CPU strips avoid staging all the GPU working copies in the same 8 GiB
memory pool. If the Mac runs short of RAM for the source or encoder, CPU
still cannot guarantee completion. Prior Mac tests at 4 GB proved CPU for
29.8 MP and a successful 42.2 MP native HDR/SDR/Proof set, but the latter
later ran into physical pressure (1.212 GB system availability at the low
point even though app peak was 3.591 GB). The previous ~34–35 s GPU JPEG
rounds and the bounded-CPU export that finished under ~44 s including
launch are useful context, not paired timings. Neither justifies a higher
default on 8 GiB or a platform-wide CPU ban.

The 0.09 GiB repeat was a different failure, on a separately tested 4,000 px
Ultra HDR export. `fef365cb` removed a race by waiting for the hidden
renderer to acknowledge collection after each job (existing one-second
bound). The PC passes that repeated-export check, but did not reproduce the
Mac refusal before the fix. This does not move the large-export boundary
and is not proof of a Mac fix. Re-run `gpu-delivery-repeat.js` on the Neo
before closing that separate issue.

Sources: [overnight Mac and PC follow-up](../reports/overnight-release-check-2026-11-25.md),
[known limitations](../../known-limitations.md),
[app memory policy](../../product/modules/memory-and-caches.md),
[export policy](../../product/modules/export-and-proof.md).

## PC measurements

Windows 11 desktop, Ryzen 5 7600, RTX 4070 Ti (12 GiB dedicated), 67.82 GB
RAM, unpackaged Electron at 2560 × 1440, revision `76f1cf12`. Steve's
existing app stayed open. The test app used a disposable profile and a
shared GPU lock. The batch export used original files read-only, one photo
at a time, no photo open in Grade. The A1 had no sidecar. DSC04375 used its
curated saved grade. Native HDR JPEG XL, Q95 / 12-bit, no frame, output
sharpening or resize, dithering off. Auto and forced CPU used the same
8 GB test ceiling so the A1 could actually take the GPU. This was not a
suggestion to run at 8 GB by default.

Time is the full batch start-to-finished wait including RAW development,
render, encode, validation and the test hook that saves the actual
pre-encode pixels. It excludes app launch and offline colour comparison.
Peak is the sum of private commit for the test Electron process tree,
sampled about once a second, not physical resident RAM or dedicated VRAM.
These are single diagnostic runs, not steady-state performance estimates.
Treat differences below 10% as inconclusive. Do not generalize larger
differences from one pair. Order was GPU then CPU for the A1, and CPU
then GPU for DSC04375. The full profiler/capture overhead
applies to both routes, and caches were not flushed between jobs.

| Native HDR JPEG XL | CPU wait / peak | GPU wait / peak | Finished HDR agreement |
| --- | --- | --- | --- |
| `DSC00636.ARW`, 8,660 × 5,784 (50.09 MP) | 155.7 s / 5.857 GB | 177.3 s / 8.174 GB | **Fail.** The GPU capture had extreme finite RGB values. The perceptual calculation overflowed, so neither mean nor P99.9 was a finite passing result. |
| `DSC04375.ARW`, 5,320 × 7,968 (42.39 MP) | 157.4 s / 5.740 GB | 131.5 s / 7.536 GB | **Pass.** ΔE ITP mean **0.02246**, P99.9 **0.06071**. Finished peaks were 1000.0 nits CPU and 999.9998 nits GPU, at the active 1000-nit limit. |

CPU was 12% faster on the unedited A1 and used 2.32 GB less app memory.
GPU was 16% faster on the saved grade and used 1.80 GB more app memory.
This saved grade has seven dust repairs. Forcing CPU also routed the
repairs to CPU, so this is a whole-export comparison, not a shader-only
test. Encoding alone took 103–118 s across these runs. GPU delivery took
22.3 s on the A1 and 5.4 s on DSC04375. The A1's CPU strip render was 1.7 s.
The GPU path normally builds an HDR/SDR pair even when this export only
encodes HDR. Neither route wins consistently across these two photos.

**A1 GPU result is not qualified.** Before encoding, 119 GPU pixels were
above the 10,000-nit codec range, with a maximum RGB component of about
1.10 × 10³⁸ in scene-linear units. The CPU RGB maximum was 1.57 (about
1,788 nits after conversion). The GPU file was accepted and decoded to a
10,000-nit peak, so the codec check did not catch the failed finished-pixel
agreement. Highlight Compression was off on this photo. This is one
observation at the raised cap. It does not identify the failing stage or
driver and is separate from deciding the 4 GB route.

The 6 GB A1 Ultra HDR JPEG probe logged `app_memory_ceiling` and chose
CPU, then failed at the **8,192 × 8,192** codec limit. The active width
is 8,660 px. It is not a successful CPU export or a speed comparison.
The native JXL run avoids that unrelated codec limit. The PC benchmark
does not simulate the Mac's physical memory or cover a sustained batch
on the Neo.

Method: Electron runner and batch API pattern from
`tests/performance/export-speed-app.js`, OS census from
`tools/export_speed_profile.py::process_rows`, the runner's existing
delivery-capture hook and `tests/helpers/delivery_comparison.py`.
Colour is compared over every HDR pixel before encoding with the existing
ΔE ITP mean < 1.0 and P99.9 ≤ 3.0 gates. This HDR-only format does not
measure SDR parity.

The diagnostics passed the four requested file writes and three related Node
checks. The targeted Python run was 137 passes and 23 pre-existing CPU
exactness failures in `test_export_memory_exactness.py` on this checkout.
No app code, tests or tolerances were changed. The two RAW hashes and the
DSC04375 sidecar match the curated manifest. Replaceable full-size exports
and captures were removed after comparison. Small PC receipts (including
the extreme-pixel coordinates) are in
`codebase/output/large-export-cpu-research/`.

## If accepted

No production code change (0 lines). Keep the app limit, device memory
reserve, GPU fallback, and all pixel tolerances. In a separate change, update
`codebase/tests/library-export-live-tiles.js` (roughly 10–15 changed lines)
so its existing tile and timing checks accept only the expected bounded-CPU
route at the configured limit and still require GPU when the fixture is
within budget. Match the current exact fallback message above. The overnight
draft diff still expects an obsolete “Native GPU delivery” prefix and would
accept GPU regardless of the budget; do not apply it unchanged. Retain a GPU
coverage case that fits at 4 GB. Update the stale historical “all GPU” claim
in `docs/known-limitations.md` with a short current-policy qualifier.

This does not qualify complex grades or every codec on the Neo, and it does
not rule out a faster, genuinely bounded GPU path later. A codec dimension
failure is not a memory fallback. Faster render alone also does not make a
large export much faster if RAW development or the encoder dominates.
