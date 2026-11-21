# Desktop diagnostics

The desktop writes the current log to `<userData>/logs/backend.log`. The
default user-data folders are `%APPDATA%\HDR Finisher` on Windows and
`~/Library/Application Support/HDR Finisher` on macOS. The desktop process
writes the actual path in `session_started`. The test launcher uses a
disposable profile.

The current file and seven numbered backups each hold up to 20 MiB.
`backend.log.1` is the newest backup. The writer caps queued output at
1 MiB and reports dropped lines through `log_overload`. Structured records
are limited to 8 KiB. Main writes the first occurrence of a repeated
decision immediately so it survives a renderer crash. A follow-up summary
reports the number of additional consecutive identical occurrences after
250 ms of quiet, on the next different event, or at orderly shutdown.
Interpret `repeat_count` as additional occurrences.

## Event format

A structured event is a single JSON object. `time` is Unix seconds (UTC).
`seq` counts records within a process or renderer document. Read it with
`proc`, `pid` and the renderer `instance` when ordering records with
the same timestamp. `area` is app, library, grade, denoise, gpu, memory,
raw, export, proof or match. `event` is snake_case, `level` is info,
warn or error, and `action` is the correlation ID or null for unscoped
work. `photo` is null or an object with `id` and `name`. Legacy
`[library] <event> {json}` records retain their format and add
`action_id` when the request has a correlation ID.

Route decisions carry `route` (gpu, cpu, cpu_reduced or refused) and a
stable `reason`. The route describes the part of the work being logged.
For example, CPU-prepared Grain can still be drawn by the GPU. Byte
counts use fields ending in `_bytes`, sizes use `_px`, and elapsed time
uses `_ms`. The memory snapshot distinguishes the ledger's resident
bytes from its allocator's used bytes. `app_ram_bytes` comes from the
most recent process census, with its age in `app_ram_sample_age_ms`.
A null reading means no census had arrived yet. `system_free_bytes`
comes from the OS at the desktop receiver.

`session_started` records the app version, build commit when available,
platform, RAM, memory setting and log path. `session_gpu_configuration`
adds adapter limits, the budget decision and probe result once the
device is initialized. It is emitted again when configuration changes.

## Emitting events

In JavaScript, pass the context explicitly through asynchronous work so
concurrent actions retain their own IDs.

```js
const action = HDRDiagnostics.start("denoise", "choose_grain_method", { id, name });
HDRDiagnostics.event("denoise", "grain_route", {
  route: "gpu",
  reason: "gpu_grain_selected",
  budget_bytes: budget,
}, action);
const headers = HDRDiagnostics.headers(action, { "Content-Type": "application/json" });
// Pass headers on this action's same-origin request.
action.finish("presented");
```

The header is `X-HDR-Finisher-Action`. In Python, import
`hdr_finisher.diagnostics.log` and call
`log("denoise", "grain_cpu_prepare_started", route="cpu", reason=reason)`.
The HTTP request supplies the action context, including in requests
handled by the standard thread pool. Deferred work can carry
`current_action()` explicitly and restore it with `action_scope(id)`.
At the outer action boundary pair start and finish, including on error
or cancellation. Diagnostic events are always on. Keep per-tile and
per-frame details in the optional instrumentation, or aggregate them.
Pass specific numeric fields and local paths as needed. Keep pixels,
credentials, full requests and opaque payloads out of the log.

## Grade Grain reason codes

| Reason | Meaning |
| --- | --- |
| `gpu_grain_selected` | The Grade Grain GPU path was selected. |
| `gpu_adaptive_selected` | Adaptive reconstruction is in use without a prepared Grain correction. |
| `cpu_prepared_grain_selected` | The accepted frame uses a correction prepared on the CPU. |
| `gpu_grain_not_selected`, `gpu_unavailable` | The GPU path was disabled or the renderer was unavailable. |
| `gpu_initialization_failed` | The renderer could not initialise a usable GPU. |
| `gpu_budget_exceeded` | The request plus the greater of resident and allocator bytes exceeded 90% of the effective GPU budget. Temporary. |
| `gpu_request_too_large` | The reservation by itself exceeds 90% of the configured budget. Sticky for this source key. |
| `gpu_allocation_pressure` | The driver failed a GPU allocation. Retry only after more room becomes available or the device changes. |
| `source_too_large` | A source, texture, strip, dispatch or buffer exceeds a hard limit. Sticky. |
| `gpu_reservation_granted` | A calibration, Fit reduction or Bayer region reservation was admitted. See `requested_bytes` and `stage` in `grain_gpu_reserved`. |
| `bounded_working_set` | Grain calibration or Fit reduction split the native work into bounded rectangles. |
| `gpu_validation_error` | A shader, texture, readback or returned value failed a validity check. Sticky. |
| `transport_timeout` | A timeout, network failure or transient server response interrupted a GPU request. Temporary. |
| `device_lost` | Retry can follow a successful device rebuild. |
| `unsupported_lens_correction`, `unsupported_grain_source` | The input or its geometry is incompatible with the selected Grain GPU route. Sticky. |
| `grain_gpu_error` | An uncategorised GPU failure. Sticky. |
| `prior_failure_latched` | A previous failure is still active. See `prior_reason`, `temporary` and `retry_used`. |
| `superseded` | The action was replaced and did not latch a failure. |
| `rebuildable_cache_released`, `no_reclaimable_resources` | The eviction pass released cache entries or found none that it could safely release. |
| `cpu_preparation_complete`, `cpu_scratch_refused`, `cpu_preparation_failed` | The backend reported success, a storage refusal or another preparation error. |

Temporary failure keys expire after 30 seconds. A temporary transport
failure waits at least 150 ms before a single retry. A memory refusal waits
for enough budget or a replacement device. Settled work can try again
once the key expires. A sticky key belongs to the source, geometry, repair
generation and method. Generated HDR and SDR share the key. Authored SDR
has its own key.

## Investigating a session

Run `python tools/log_timeline.py "<log directory>"` from `codebase`.
The reader automatically includes rotated files beside the current log.

- For a slow Grain edit, filter with `--photo _DSC7970.ARW --area denoise`.
  Copy the ID from the relevant `action_started` line and run the tool
  with `--action ID`. Follow the first `grain_gpu_refused` or
  `grain_gpu_skipped` through eviction, retry, CPU preparation and the
  chosen route. The backend's `denoise_grain_prepared` line records fit
  time, filtering time and disk usage. A CPU noise-model measurement may
  coexist with GPU Grain, so follow the Grain route itself.
- For a failed export, narrow the time window with `--since` and
  `--until` (UTC ISO-8601 or Unix seconds). Check the export, GPU and
  memory areas together. Use the action filter where a correlation ID
  exists. The app-wide rollout adds coverage to those routes. Legacy events
  from that window still appear in the unfiltered timeline.
- Use `--summary-only` for refusal reasons and memory maxima. These maxima
  can occur at different times, so inspect one event to compare values
  that occurred together.
