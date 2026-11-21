# App-wide logging rollout notes

## Reason codes

| Area | Reasons and meaning |
| --- | --- |
| Library | `folder_index`, `folder_disk` identify the first listing source. `first_picture_presented` records the first visible grid picture. `place_open_failed`, `folder_stream_failed`, `folder_stream_closed`, `picture_draw_failed` and `gpu_draw_unavailable` identify the failed stage. |
| RAW | `raw_developed`, `raw_development_failed`, `raw_development_cancelled`, `raw_gpu_unavailable` and `unsupported_raw_source` describe the decoder result. `gpu_validation_error`, `gpu_budget_exceeded` and `gpu_preempted` explain GPU rejection and retry. |
| Grade | `source_open_failed`, `source_open_cancelled`, `gpu_render_succeeded`, `strip_execution_refused`, `preview_resource_limit`, `preview_edge_reduced` and `backend_preview_requested` describe opening and first render. `user_selected_cpu`, `gpu_unavailable`, `prior_failure_latched` and `unsupported_local_adjustments` explain CPU selection. Other render refusals use the renderer's reason key in snake case. `superseded` marks replacement by newer work. `zoom_render_refused` or `zoom_render_failed` marks a failed zoom. |
| GPU | `device_lost`, `device_rebuilt` and `gpu_rebuild_failed` track device recovery. `gpu_validation_error`, `transport_timeout`, `gpu_allocation_failed` and `gpu_render_failed` classify Grade failures. |
| Match | `gpu_candidates_requested`, `gpu_candidates_completed`, `gpu_candidate_unavailable`, `cpu_candidates_selected` and `local_match_cpu` cover candidate routing. `match_failed` and `match_cancelled` describe action outcomes. |
| Export and Proof | `cpu_delivery_policy`, `delivery_policy_unreadable`, `gpu_delivery_unavailable`, `gpu_delivery_failed`, `gpu_delivery_succeeded`, `gpu_preempted` and `delivery_cache_hit` describe delivery rendering. `delivery_completed`, `proof_artifact_available`, `encoder_unavailable`, `encoding_failed`, `encoder_completed`, `encoder_launch_failed`, `encoder_exit_failed` and `encoded_peak_exceeded` cover validation and encoding. `edit_sync_failed`, `export_cancelled`, `export_failed`, `export_transport_failed` and `proof_failed` describe action outcomes. Batch controls emit `batch_pause`, `batch_resume` and `batch_cancel`. Each rendition reports `batch_exported`, `batch_renamed`, `batch_skipped` or `batch_failed`. |
| Memory and app | `app_memory_ceiling`, `cache_share_limit`, `memory_reclaim`, `system_memory_pressure` and `memory_sample_failed` describe admission, eviction and sampling. `startup_failed` marks an unsuccessful desktop startup. |

## Investigation recipes

- **Library waited on opening.** Find `open_place` and follow its action through
  `folder_listing_route` and `first_picture_drawn`. The listing area shows
  the index or disk route. The first picture records its display route when
  known. Check `folder_stream_failed` for an error after the first list was usable.
- **Grade retained an earlier picture.** Find the `open_photo`, `zoom` or
  `settle_preview` action. Check `preview_refused`, `preview_retry` and
  `preview_cancelled` next to the final `preview_route`. GPU successes record
  `execution` as Direct or Tiled in lowercase. Compare the requested and rendered
  edges on CPU fallback. Search for `device_lost` and the rebuild action by time
  if the renderer lost the device between those events.
- **Match ran on the CPU.** Compare the renderer's `candidate_route` with the
  backend's `candidate_result` for the same action. The latter has the accepted
  GPU candidate count when one was available.
- **Export or Proof failed.** Trace the action from `delivery_route` through
  the delivery worker result, encoder helper outcomes and the API result.
  A `ceiling_retry` records the decoded peak, target and encoded allowance in
  nits. A `ceiling_refused` means the output still exceeded the allowance.
  Batch worker events use the same action as the queue and include the child
  PID. Those events reach the main log when that photo's worker exits.
- **Memory limited a route.** Compare `requested_bytes` and `reserved_bytes`
  to `budget_bytes` and `app_ram_bytes`. Read `cache_trim_requested` for the
  trim decision and `cache_trimmed` for the measured bytes freed where the
  cache owner reports them.
