# GPU retry audit — November 6, 2026

The original November 6 report was a static audit, without code changes or
test runs. Locations below are relative to `codebase/`. Dated follow-ups record
implemented fixes separately; the historical findings are not a current
certification of every GPU route or proof of pixel safety.

## November 13 follow-up: P1-C Edge colour

`highlight-edge-colour.js` now refuses a rejected input scan immediately,
including an unrepresentable existing 32x float32 range allowance. Rejection
does not depend on whether the eventual output happens to be finite, and the
output scan no longer has an input-error bypass. `highlight_edge_gpu.py`
independently rejects returned finite magnitudes beyond that allowance derived
from the trusted source and colour matrix. Neither route retries rejection;
good-pixel reconstruction and existing numerical limits are unchanged.

Fault-injection tests check one submission, no accepted bad result, CPU
selection and cleanup. On the MacBook Neo, hardware kernel parity and three
injected corrupt inputs pass; both real clipped RAWs have clean Grade/Library
GPU reconstruction and pass finished-pixel comparisons. Host-memory admission
refuses GPU delivery; accepted CPU fallback passes Proof/export byte identity
and decoded HDR ceilings (Grade PRD and `output/p1c-edge-delivery.log`).
Export/Proof, DNG, retouch and Denoise optional recovery remain as Steve chose.

## Status (November 6, after Steve's decision)

Steve chose to fix the two routes that retry what the rule sends to the CPU,
and to leave the routes that only miss an optional retry:

- **Library RAW and preparation: fixed** in `2bca4e9` (see the Library module PRD).
- **Grade preview: fixed** (see the Preview and GPU module PRD). Repeated
  validation failure now stops the GPU per photo; it still waits for three in
  a row because the CPU preview is slow and refuses some graphs.
- **Export/Proof, DNG, Edge colour, retouch, Denoise: left as they are.** They
  already go to the CPU on a rejected or repeating failure; they only lack the
  optional single retry for a reset or restarting device, which is rare and
  would touch Still-strict export code. Revisit only if those fallbacks show
  up in Steve's use.

## Findings

### Library RAW development: retries rejected pixels

`frontend/library-gpu-raw.js:932,1015–1051` develops sensor data. It explicitly repeats an invalid-pixel result once with fresh allocations, logging retry and rejection. The invalid counter is local to an invocation; the session map counts memory failures, not invalid pixels. Memory failure gets a requeue on the first failure with a grant and CPU eligibility on the second, without establishing that another job held the memory. Device loss requeues with a grant without a persistent retry ceiling. Preemption is correctly requeued without spending an attempt.

Classification: **retries something the rule says should go to the CPU**. Make invalid pixels, permanent allocation failure and validation failure immediately CPU eligible; remember failure for the same work this session. Allow one device recovery or externally caused memory retry. Risk: medium for Library; shared RAW implementation also serves delivery, so review output implications. Coverage: `library-invalid-gpu-retry.test.js` (its intended expectation must change), `library-gpu-recovery.js`, `library-gpu-raw.js`, `library-native-direct.js`.

`frontend/library-scenes.js:139–164,174–199` adds up to three preparation attempts for broadly matched temporary errors or development failures. Errors without `gpuUnavailable` become development failures and can therefore resubmit deterministic GPU failures instead of selecting CPU. Reasons are logged through the optional stopwatch. CPU fallback is explicit for `gpuUnavailable`, but background priority can defer it. Classification: **retries something the rule says should go to the CPU**. Carry typed failure causes and a shared attempt budget through preparation and scheduling. Risk: medium, Library responsiveness. Same drivers; add deterministic-error fault injection rather than assuming existing happy-path coverage suffices.

### Preview failure policy: broad retries and delayed session disable

`frontend/render-failure.js:classify, HDRRenderFailurePolicy.record`; `frontend/preview-pipeline.js:785–833`. Allocation errors include adapter limits, oversized jobs and unqualified OOM; unknown errors default to retryable transport. Preview schedules up to two redispatches, in addition to its first render. Validation failures keep the GPU available until a consecutive threshold; success resets that threshold. CPU fallback remains available to the calling preview pipeline. Console warnings include reasons.

Classification: **retries something the rule says should go to the CPU**. Distinguish permanent failures from outside contention, allow only one temporary retry, and remember failed work rather than waiting for repeated validation failures. Risk: medium, displayed Grade result; does not itself edit export pixels. Coverage: `preview-scheduler-settle.test.js`, `full-tier-preview.js`, `webgpu-shader-compilation.js`; new failure-injection assertions are needed.

`frontend/preview-pipeline.js:130–136` retries after queued edits drain: superseded work rather than failed GPU calculation; **matches**. `frontend/webgpu-preview.js:3049–3078` refetches tiles evicted while neighbours load, up to three assembly passes, returning null on unavailable tiles: cache lifetime recovery, not retrying a rejected pixel result. **Matches** in that narrow sense; no dedicated retry-reason log was seen there.

### Export and Proof: shared delivery broker

`backend/hdr_finisher/gpu_delivery.py:110–197`; `frontend/gpu-delivery.js:26–29,166–231`. One delivery submission, except the three exact preemption/shared-Grade-budget messages at `gpu_delivery.py:47–52`, which requeue without consuming attempts. All other errors, unavailable/stale renderer, limits, validation errors and invalid non-finite readback go to CPU. The frame signature cache retains success or failure for identical work. Worker errors are logged to the console; backend stores `fallback_reason`. Preemption requeue has no explicit per-requeue reason log in this loop.

Classification: **gives up on something the rule says is worth one retry** for recoverable device reset or restarting renderer; **matches** for deterministic failures and preemption counting. Add a typed, single recovery attempt for those temporary cases and explicit retry/fallback records. Risk: **high, export and Proof — Still strict**. Coverage: `test_gpu_delivery.py`, `gpu-delivery-smoke.js`, `gpu-delivery-ceiling.js`; include every applicable output check before shipping a fix.

### DNG correction and Edge colour through delivery

`backend/hdr_finisher/dng_gpu.py:29–79` and `highlight_edge_gpu.py:39–90` each submit once and requeue the same exact preemption messages. Invalid/non-finite or incomplete replies go to CPU; fallback reasons are returned in diagnostics. Neither has a general second device/startup recovery attempt or session failed-work latch in the inspected wrapper. Reasons are carried to callers, rather than explicitly logged at each requeue.

Classification: **matches** for deterministic rejection; **gives up on something the rule says is worth one retry** for temporary device/startup failures. Add shared typed recovery and failed-work recording in the broker, not separate nested retries. Risk: **high**, corrected source and Edge colour can reach export/Proof. Coverage: `test_dng_gpu.py`, `grade-dng.js`, `library-dng-warp.js`, `test_highlight_edge_gpu.py`, `gpu-edge-colour.js`.

### Retouch

`backend/hdr_finisher/retouch_gpu.py:215–257` submits once, requeues preemption, rejects non-finite output and throws other failures. `retouch_routes.py:28–49` catches failure, runs CPU transfer or inpaint, caches the completed recipe and logs `retouch_route` with the fallback reason. Classification: **matches** for permanent errors; **gives up on something the rule says is worth one retry** for device/startup recovery. Use the same bounded broker recovery; retain CPU recipe caching. Risk: **high**, repaired pixels reach export/Proof. Coverage: `test_retouch_routes.py`, `retouch-gpu-kernels.js`, `retouch-delivery.js`, `performance/retouch-cpu-fallback.js`.

### Denoise measurement

`frontend/webgpu-preview.js:5834–5859` tries GPU measurement once then requests and publishes CPU measurement with the reason. Request/publication errors are rethrown rather than mistaken for GPU calculation failures. `backend/hdr_finisher/denoise_measurement.py:251–258` checks stale publication and logs route/reason. `denoise_adaptive.py:538,553` also logs CPU fallback. Delivery worker at `gpu-delivery.js:205` throws if GPU Denoise analysis fails, invoking delivery CPU fallback.

Classification: **matches** for permanent failures; **gives up on something the rule says is worth one retry** when device loss is temporary. Add only one recovered-device attempt through the shared policy. Risk: **high** for delivery measurement because Denoise affects output. Coverage: `gpu-denoise-measurement.js`, `test_denoise_measurement.py`, `denoise-adaptive-parity.js`, `test_export_denoise_parity.py`.

## Silent acceptance and logging questions

- No confirmed path in these inspected wrappers accepts an explicitly rejected result as success. Delivery, DNG and retouch check finiteness; this does **not** prove plausible-but-wrong finite values are rejected.
- `gpu_delivery.py:184–189` checks finiteness, not the HDR ceiling at that boundary. Retouch likewise checks finiteness, not valid centre coordinate ranges before integer conversion. These are safety review questions, not confirmed output defects; use ceiling and retouch kernel drivers before drawing a conclusion.
- Worker error logging at `gpu-delivery.js:228–231` can fail to publish completion; backend timeout should carry the fallback reason, but the original error may remain only in console output.
- Delivery, Edge, DNG and retouch preemption loops do not explicitly log every requeue reason. Returned diagnostics are not equivalent to a durable log at the decision point.
- Library retry/fallback events use optional stopwatch calls; verify production diagnostic retention before treating those as guaranteed logging.
- Desktop `main.js` search found no independent GPU retry loop; it hosts the renderer and memory controls. This is not a guarantee that every desktop helper was exhaustively traced.

## Priority summary

Ordered by output safety, then likely user-visible wasted work. No timing gain was measured.

| Priority | Route | Main mismatch | Suggested next change | Risk / coverage |
|---|---|---|---|---|
| 1 | Export/Proof shared delivery | No bounded recovery for temporary device/startup failure; requeues lack explicit logs | Central typed recovery policy, one retry, log each decision | High; delivery smoke, ceiling, backend broker |
| 2 | DNG, Edge, retouch, Denoise | Same temporary-recovery gaps; session handling varies | Reuse broker policy, avoid nested retries | High; route-specific output drivers above |
| 3 | Library RAW and preparation | Invalid pixels retried; deterministic errors can enter three preparation attempts; unqualified OOM retry | Immediate CPU for permanent failure, shared attempt/session record | Medium; RAW recovery, invalid-result and native drivers |
| 4 | Grade preview | Two retries; adapter limits/OOM/unknown errors broadly retryable; delayed validation disable | One temporary retry, immediate CPU for permanent failure | Medium; preview scheduler and full-tier drivers |

The temporary-recovery rows identify missed opportunities, not an instruction to retry every unavailable GPU. No GPU, CPU chosen, oversized work and persistent failure must remain immediate CPU cases. Further tracing of scheduler requeue consumers, all preview mask/graph routes and session lifetime ownership is required before calling this an exhaustive inventory.
