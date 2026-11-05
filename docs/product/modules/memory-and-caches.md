# Module PRD: Memory and caches

### November 5: Grade peak reduction

No allowance changes. The old docked-HDR peak sample is 5.177 GB counted
RAM: backend 3.760 GB, GPU process host pages 0.873 GB, other processes
0.544 GB. The nearest app census (283 ms later, using its previous completed
process walk) reports Grade's previous source 0.509 GB, named caches only
84.5 MB, zero handoff bytes, zero native upload/retention and no active grants.
These owner counters overlap process RAM; they must not be added to it.
Hidden delivery is only 38.7 MB counted in that independent peak sample.
GPU-process host memory includes Chromium staging/driver storage; these
records cannot divide that storage exactly, and dedicated VRAM is separate.

A 50 ms stack/array census of the same real 42 MP RAW decode identifies the
large transient at lens correction: original colour image 508.7 MB, vignetted
copy 508.7 MB, remap output 508.7 MB, full Lensfun coordinates 1,017.4 MB,
and 12 active workers' indices/weights/gathers. Unique arrays visible in
stacks total 2.854 GB at a 3.558 GB backend working-set peak; the remainder
includes interpreter/native allocator residency and temporaries between
stack observations. This is a separate instrumented decode, not a claim that
all its allocations were measured simultaneously with the old app peak.
No encoder is on that decode stack. Existing full-app telemetry and this
allocation census identify overlapping lens work, rather than named caches,
as the main peak owner.

RAW correction now consumes its exclusively owned float32 colour buffer for
vignetting. Other callers retain the default non-mutating behavior. Remap
workers run in waves whose scratch fits the existing WORKING allowance,
using a conservative 128 bytes per band pixel for indices, float64 weights
and expression temporaries. No CPU cap, cache share or memory limit changed;
the number working simultaneously follows the existing allowance and band
width. Remap bands are now 32 rows rather than 128, keeping all CPUs busy
with smaller live gathers. Original full Lensfun coordinates and bilinear
arithmetic stay intact.
Both real RAW decoded-image SHA-256 hashes are identical before/after;
isolated backend working-set peak falls to 2.316 GB (diagnostic, not app
acceptance). Small tests cover both coordinate layouts, multiple waves,
input ownership and exact output equality.

For the four hand-off timings, propose 5% against the previous whole waits
(ordinary shared-machine variation); the existing 500 ms goal remains. Paired
Grade opening already uses 5%. Memory must still peak at or below 4.4 GB and
settle below 3.4 GB at the default setting.

Final plain-Electron hand-off checks, 2560x1440, default 4 GB, reusable
hdr-test RAW copies: docked HDR 4.199 GB, docked SDR 4.185 GB, popped-out HDR
4.327 GB and popped-out SDR 4.286 GB. All four pass the unchanged 4.4 GB
allowance and settle at 2.281-2.650 GB. The intermediate 128-row version
still peaked at 4.561 GB in popped-out HDR; smaller bands removed that last
overshoot. The final popped-out HDR peak consists of backend 2.210 GB,
GPU-process host pages 1.497 GB and other processes 0.619 GB counted RAM.
Visible grid/filmstrip crops change in all four modes; separate stored-screen
crops also change in docked HDR/SDR. Existing speed misses remain, recorded
in the performance table; no delivery code or tolerance changed.

The retained-native contention check now establishes a real 508.7 MB owner
before Grade, then observes zero retained/upload bytes after Grade takes
priority. Paired Grade opens in 5.488/5.549 s (within the existing 5%);
warm-up 6.673 s. Whole-app peak 4.005 GB, idle 1.701 GB; all checks pass.
This closes the Windows retained-native/memory gap from 4d; the separate
8 GB Mac acceptance still belongs to Steve. Visible full-screen native detail
also develops and draws without refusal: peak 3.373 GB, final 1.551 GB,
six-second observation on the reused DSC00264.ARW. Fast checks: 805 JavaScript
passed; Python 3,066 passed, three skipped, with only the known unrelated
test_remembered_failure_does_not_hide_current_grade_cached_scene failure.
No allowance, output tolerance, saved-file format or processing arithmetic
changed. Two real 42 MP RAWs retain exact full decoded-image hashes.

Evidence: `codebase/output/memory-peak-{diagnostic,after-final}.log`,
`codebase/output/quick-library-check/memory-peak-handoff-{dock,pop}-{hdr,sdr}/`
and `memory-peak-native-selected/`, `memory-peak-zoom/`, and the old
`quick-library-check/batches45-handoff-dock-hdr/` process census. Final fast
logs: `codebase/output/memory-peak-{node,pytest}-final.log`.
Output started/ended at 29.2 GB (under 100 GB). App profiles were removed by
the harness. Automatic approval review blocked removal of this task's
pytest-1290/1291 TEMP folders and failed `memory-peak-native/` review folder;
these and the small allocation-probe scripts/intermediate logs are disposable.

### November 5: Grade yields backend native detail (4d, partial)

The worker's Grade/import/export work gate now also pauses both backend
native caches; previously only the helper's owner was paused. Retained native
planes are released at that gate, and a late GPU publication cannot reclaim
them until the gate reopens. The existing 600 MB working share and all other
allowances are unchanged. The memory endpoint reports retained/upload bytes
and pause state separately so an upload or a live scene cannot masquerade as
a retained native owner.

The regression runs the router, worker, native cache and Grade source-mip
cache together with small real arrays. Before the fix the native owner refuses
Grade's insertion; after it, Grade receives its source mips and retained native
bytes are exactly zero. The focused native tests pass (4).

Windows acceptance remains incomplete. A live-scene diagnostic opened Grade
in 5.674/5.706 s (within the proposed paired 5%), settled to 1.986 GB after
60 seconds, but peaked at 4.834 GB against the unchanged 4.4 GB allowance.
It established no retained backend native owner and therefore does NOT
qualify the contention interaction. Explicit 42 MP and second-photo native
attempts were refused by existing memory admission, before the paired
measurement; no allowance was raised to force a pass. Further memory tuning
and real-app retained-owner timing remain open. The 8 GB Mac acceptance must
be performed by Steve on a MacBook; Windows cannot establish it.

Evidence: `codebase/output/quick-library-check/batches45-grade-native-sampled/`
(report, scenario and independent samples); refused attempts are recorded in
`codebase/output/batches45-grade-native-{owner,smaller}.log`.


### November 5: zoom admission correction (built)

Selected full-size detail is admitted against remaining whole-app TARGET,
not the 600 MB working cache share. Its unchanged estimate is width x height
x 24 bytes plus 65,536 bytes of framing. The native upload/selected detail
owner is active work, reported under working and reclaimed on release; upload
publication counts its existing bytes once. Optional CPU-native retention
continues to use the cache share. Source and GPU scheduling still perform
their existing admission checks. CEILING, WORKING, SHARES, defaults and the
user setting are unchanged. See the November 5 photo-library entry for checks.


### November 4: Library + Grade measurement (4d step 1)

**Measurement only, on local main `3849ef8`, November 4, 2026.** No app
behaviour, cache share, size, budget, estimate, ceiling or allowance changed.
The new opt-in harness uses the existing guarded test-profile startup; normal
startup does not load it. Run from `codebase` with
`node tools/measure-library-grade-4d.cjs`; summarize with
`.venv/Scripts/python.exe tools/summarize-library-grade-4d.py`.

**Finding:** the second-photo **peak remains**: 5.005 GB counted RAM
(5.673 GB working set), with the backend reaching 3.799 GB. This small
four-photo sequence did **not** reproduce the older minutes-long 5–6 GB hold
or the 1.99 GB hidden delivery renderer. Grade B settled to 2.537 GB at
about ten seconds and 1.881 GB after the idle minute. Closing Grade released
its reported 0.509 GB source; Library settled to 1.366 GB after its idle minute.
The existing default peak allowance is 4.4 GB: A and B both exceed it.
Five one-second samples exceeded 4.4 GB; subsecond peaks can be missed.

**Sequence and limits.** A = copied `DSC03819.ARW`; B = copied
`DSC00264.ARW` (both 42 MP). The same folder also contained the real edited
`20250412_0039.ARW` and its 59 KB grade, and the DxO
`DSC04375_DxO_clipped_-1.5EV.tif` (7952 × 5304, three-channel uint16).
Sources came only from existing `output/test-photos` copies; no original
under `D:\Photos` was opened or written by the harness. Temporary subset copies,
new sidecars and fresh profile were removed afterwards. Existing copies remain.
The fresh profile reported the unchanged 4,000,000,000-byte default setting.
All four grid pictures were present, source jobs were empty at the first
checkpoint, and `page_startup_pipelines_ready` was logged before browsing.
The main window was explicitly shown at 2560 × 1440; the delivery window stayed
hidden. Browse/Single/fullscreen lasted 30 seconds, A received three exposure
edits, B replaced it, Library was popped out/browsed/docked, then each required
60-second idle was observed. Step 9 reopened B and built the **default reduced
801 × 1200 JPEG Ultra HDR Proof**, not a full-size export/Proof.

The accepted visible run lasted 339 seconds including startup. An earlier
roughly two-minute run was stopped because its main window reported hidden;
its numbers are excluded and retained separately. Combined real-app work was
under ten minutes; no additional GPU sweep was run. Fast tests ran concurrently
outside the app process tree; system pressure was `none` throughout. These are
memory observations, not isolated speed benchmarks. Extra app queries occur
every two seconds; process and Windows GPU recording run outside the app.
No noticeable extra wait was identified, but recorder overhead was not measured
against an uninstrumented control, so timings must not be used for speed claims.

**Evidence:** local raw files in
[`codebase/output/library-grade-4d`](../../../codebase/output/library-grade-4d/):
`memory.jsonl` (independent census), `points.jsonl` (cache shares, Grade bytes,
window PID/visibility, Electron metrics and Grade allocator), `gpu.jsonl`
(Windows GPU Process Memory counters), `steps.json`, `backend.log`, `grid.json`,
`report.json`, `summary.json`, and
[`process-table.csv`](../../../codebase/output/library-grade-4d/process-table.csv).
The CSV is the full **per-PID** table: counted RAM and working-set peak/settled,
plus dedicated/shared GPU peak/settled, including every Python/helper process.
Raw evidence is ignored local output, not embedded in Git.

The optional Proof displayed successfully in repeated page-status samples, but
the driver mistakenly waited on `HDRProofing.settled()` (a notification hook
returning undefined), then reported a timeout. Step 9 therefore contains about
60 seconds of post-command observation and a usable settled tail, with its
error preserved in `report.json`. The committed driver now waits on decoded
Proof/image readiness; that predicate correction was syntax/fast checked but
not rerun in the real app. Steps 1–8 completed normally. No forced GC, pressure,
working-set trim or budget override was injected.

**Tables: decimal GB, peak / settled.** Settled is the median of the last
2.5 seconds of each observation: about ten seconds after completion for
steps 3–5/7, and the end of each minute for steps 6/8. RAM samples are about
1.001 seconds apart; app/cache samples about two seconds. Independent maxima
in a row can occur at different times and must not be summed. Per-process
figures below are proportional resident (shared host pages divided by OS
share count); working set counts full resident mappings and includes overlap.
The CSV supplies the working-set breakdown as well as these counted figures.
Python helpers are grouped here for readability, individually listed in CSV.

| Step | Total RAM | Working set | GPU | Library popout | Python helpers | backend | delivery | main | main renderer | other helpers | utility |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 grid and preparation | 1.738 / 1.706 | 2.282 / 2.250 | 1.133 / 1.108 | 0.000 / 0.000 | 0.256 / 0.256 | 0.216 / 0.112 | 0.044 / 0.044 | 0.055 / 0.049 | 0.413 / 0.108 | 0.013 / 0.011 | 0.018 / 0.018 |
| 2 browse and fullscreen | 1.968 / 1.566 | 2.532 / 2.140 | 1.108 / 0.913 | 0.000 / 0.000 | 0.337 / 0.260 | 0.370 / 0.172 | 0.048 / 0.042 | 0.129 / 0.050 | 0.345 / 0.101 | 0.011 / 0.011 | 0.044 / 0.017 |
| 3 Grade A and edits | 4.890 / 2.072 | 5.397 / 2.702 | 0.921 / 0.718 | 0.000 / 0.000 | 0.259 / 0.259 | 3.493 / 0.776 | 0.047 / 0.047 | 0.102 / 0.087 | 0.208 / 0.158 | 0.011 / 0.011 | 0.030 / 0.017 |
| 4 Grade B | 5.005 / 2.537 | 5.673 / 3.167 | 0.745 / 0.726 | 0.000 / 0.000 | 0.259 / 0.259 | 3.799 / 1.286 | 0.047 / 0.046 | 0.051 / 0.051 | 0.159 / 0.142 | 0.011 / 0.011 | 0.018 / 0.017 |
| 5 popout and dock | 2.601 / 1.894 | 3.317 / 2.526 | 0.848 / 0.658 | 0.106 / 0.000 | 0.470 / 0.261 | 1.286 / 0.721 | 0.047 / 0.047 | 0.086 / 0.051 | 0.159 / 0.128 | 0.036 / 0.011 | 0.019 / 0.018 |
| 6 Grade idle 60s | 1.884 / 1.881 | 2.517 / 2.513 | 0.661 / 0.658 | 0.000 / 0.000 | 0.261 / 0.261 | 0.723 / 0.721 | 0.047 / 0.047 | 0.058 / 0.058 | 0.113 / 0.109 | 0.011 / 0.011 | 0.019 / 0.018 |
| 7 close Grade | 1.411 / 1.358 | 2.044 / 1.988 | 0.682 / 0.665 | 0.000 / 0.000 | 0.261 / 0.261 | 0.201 / 0.200 | 0.047 / 0.047 | 0.065 / 0.051 | 0.130 / 0.105 | 0.011 / 0.011 | 0.018 / 0.018 |
| 8 Library idle 60s | 1.368 / 1.366 | 1.999 / 1.997 | 0.664 / 0.662 | 0.000 / 0.000 | 0.261 / 0.261 | 0.201 / 0.199 | 0.047 / 0.046 | 0.059 / 0.059 | 0.112 / 0.110 | 0.011 / 0.011 | 0.018 / 0.018 |
| 9 B reduced Proof | 4.293 / 1.737 | 4.932 / 2.400 | 0.699 / 0.418 | 0.000 / 0.000 | 0.261 / 0.261 | 3.127 / 0.777 | 0.081 / 0.048 | 0.091 / 0.091 | 0.159 / 0.113 | 0.056 / 0.011 | 0.019 / 0.018 |

| Step | Thumbnails | Sharp | Camera | RAW | Handoff | Working | Grade retained | GPU dedicated | GPU shared |
|---|---|---|---|---|---|---|---|---|---|
| 1 grid and preparation | 0.017 / 0.017 | 0.008 / 0.008 | 0.000 / 0.000 | 0.000 / 0.000 | 0.002 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.860 / 0.253 | 0.936 / 0.936 |
| 2 browse and fullscreen | 0.017 / 0.017 | 0.102 / 0.095 | 0.000 / 0.000 | 0.000 / 0.000 | 0.026 / 0.000 | 0.004 / 0.004 | 0.000 / 0.000 | 0.624 / 0.624 | 0.721 / 0.721 |
| 3 Grade A and edits | 0.017 / 0.013 | 0.095 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.033 / 0.026 | 0.509 / 0.509 | 0.732 / 0.589 | 0.721 / 0.495 |
| 4 Grade B | 0.013 / 0.004 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.026 / 0.023 | 0.509 / 0.509 | 0.590 / 0.495 | 0.494 / 0.488 |
| 5 popout and dock | 0.017 / 0.017 | 0.038 / 0.038 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.027 / 0.027 | 0.509 / 0.509 | 0.909 / 0.331 | 0.545 / 0.452 |
| 6 Grade idle 60s | 0.017 / 0.017 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.027 / 0.027 | 0.509 / 0.509 | 0.416 / 0.352 | 0.456 / 0.453 |
| 7 close Grade | 0.017 / 0.017 | 0.032 / 0.032 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.020 / 0.020 | 0.000 / 0.000 | 0.357 / 0.335 | 0.460 / 0.457 |
| 8 Library idle 60s | 0.017 / 0.017 | 0.032 / 0.032 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.020 / 0.020 | 0.000 / 0.000 | 0.335 / 0.324 | 0.458 / 0.457 |
| 9 B reduced Proof | 0.017 / 0.004 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.000 / 0.000 | 0.027 / 0.027 | 0.509 / 0.509 | 0.537 / 0.445 | 0.459 / 0.197 |

**GPU accounting.** Windows attributed all nonzero dedicated/shared GPU
counters in this run to GPU-process PID 33060. Main PID 24544, main renderer
1504, delivery renderer 46328, popped-out Library renderer 22256, backend and
helpers had no nonzero GPU-counter rows (zero in the CSV). A counter query took
a median 1.115 seconds in the external recorder, yielding about one sample
every 2.1 seconds. This limits GPU peak precision. The recorder logged one invalid-counter
error; every step still has GPU samples, including a final sample 777 ms
before the last checkpoint. The error log is retained. GPU counters measure driver
allocations, not ownership by JavaScript object or by window.

The host total already includes the GPU process's host pages. **Do not add
working set to counted RAM, or blindly add shared GPU bytes.** Dedicated VRAM
is separate on this Windows machine; on a unified-memory machine it competes
for system RAM. The shared GPU counters cannot be separated into overlap with
Chromium host RAM versus additional backing with this recording. Thus an
exact non-double-counted unified total cannot be produced here. The prior
5d-only 18–23 MB dedicated / 557–845 MB shared increments are background
context, not independently remeasured or added to these totals.

**Largest holders and their owners.** Classification is based on source
ownership plus observed lifetime, not an allocation-by-allocation heap proof.

- **Backend import peak, up to 3.799 GB counted:** `SessionStore.prepare_session`
  in `sessions.py`, `loader.py`/`raw_import.py`, colour conversion and source-mip
  preparation in `render_cache.py`. Transient working memory in the current
  pipeline; the record does not prove every temporary is necessary. A remains
  current while B is prepared, then `activate_session` replaces `_current`.
  By Grade idle the backend is 0.721 GB. Release: finish preparation and drop
  the decoder/conversion/intermediate references.
- **Open Grade source, 0.509 GB:** `SessionStore._current` and
  `_publish_retained_session_bytes` in `sessions.py`; counts unique source,
  retouch-original and SDR-reference NumPy roots. Needed while open under
  Library decision 8. A and B each report one 0.509 GB source, not two; close
  reports zero and backend drops to 0.200 GB. No evidence here of A's Grade
  session surviving B's activation; allocator retention is not a second live
  session. Release: `SessionStore.clear` through the normal Close photo gate.
- **GPU-process host memory:** 1.133 GB grid peak, 0.658 GB Grade-idle,
  0.662 GB Library-idle; driver allocations are additional/overlapping as
  explained above. Owners include Chromium/Dawn and live Library surfaces
  (`library-scenes.js`, `library-gpu.js`, `library-raw-gpu.js`), Grade
  `HDRWebGPUPreview`, and prepared pipelines (`idle-warmup.js`,
  `gpu-delivery.js`). Grade's allocator reports only 11.874 MB late in Grade
  (10.957 MB source proxies and 0.918 MB tile graph), then zero after close;
  this is not a census of all driver/native allocations. Remaining native
  host/GPU storage cannot be divided reliably into Library scenes, pipelines,
  delivery and driver pools from these counters. It looks like cache/engine
  residency, not proof of a leaked Grade tile. Release: scene/session teardown
  destroys owned resources; releasing the engine/device is needed for its pools.
- **Hidden delivery renderer:** 0.044–0.048 GB settled and 0.081 GB peak
  during reduced Proof, returning to 0.048 GB. `gpu-delivery.js` keeps one
  initialized `HDRWebGPUPreview`/device and pipelines, but resets sessions and
  destroys finishing resources in success/error/finally. This run shows a
  small warm engine, not the earlier 1.99 GB leftover. The exact contents of
  that old hold remain unmeasured; reduced Proof does not exercise full-size
  delivery transfers. Release: job finally clears owned images; closing the
  delivery renderer releases its engine residency.
- **Python helpers:** about 0.261 GB idle in aggregate, briefly 0.470 GB
  with the popout. Spawned Library decode workers in `library_worker.py`;
  mostly interpreter/module working footprint, not a reported image cache.
  Main renderer/main process are around 0.11/0.06 GB Library-idle. Popout
  renderer peaks at 0.106 GB and exits on docking. Release: worker/window
  shutdown releases their process footprint.
- **Named caches:** small relative to the peak (tables above), owned by
  `app_memory.py` registrations, `library-ram.js`, picture/RAW providers and
  `SourceMipCache` in `render_cache.py`. Rebuildable caches, not the multi-GB
  backend peak; retained Grade bytes are separate and not added again to RAM.
  Release: registered cache trim callbacks evict their entries.

**Moderate trim:** three events, during A, B and B's reopen for Proof, at
4.320/4.646/4.065 GB. No ten-second repeating trim loop during the idle minutes.
`desktop/main.js` sends registered main/Library windows the pressure record,
`preload.js` relays it to Library, and `library-ram.js` halves managed shares;
backend `app_memory.reclaim_all` halves registered caches including source mips.
Only the main renderer receives the explicit major-GC request in
`memory-pressure.cjs`; the hidden delivery window is not in that relay and
moderate does not clear native caches. Grade's current source and shader/device
pipelines are not managed cache trim targets. Grade GPU session resources are
reset on photo replacement/close, not by that moderate-cache path. Memory fell
following import completion/trim, but this observation cannot assign the fall
to trim rather than normal completion or collection.

**8 GB unified-memory Mac estimates, not measurements or new allowances.**
The unchanged default ceiling is 2.5 GB, elastic peak 2.75 GB and settled
planning target 1.9 GB. The following rough Windows-derived scenarios start
with counted RAM + dedicated GPU; the high scenario also adds all shared GPU
bytes. The high scenario may double-count host backing. These are illustrative
accounting envelopes, not certified bounds or a prediction of Metal's footprint;
peaks combine independently sampled maxima. Smaller Mac cache shares, different
viewport, driver, compression and physical-footprint accounting can change them.

| Step | Estimated peak GB | Estimated settled GB |
|---|---|---|
| 1 grid and preparation | 2.60–3.53 | 1.96–2.90 |
| 2 browse and fullscreen | 2.59–3.31 | 2.19–2.91 |
| 3 Grade A and edits | 5.62–6.34 | 2.66–3.16 |
| 4 Grade B | 5.60–6.09 | 3.03–3.52 |
| 5 popout and dock | 3.51–4.05 | 2.22–2.68 |
| 6 Grade idle 60s | 2.30–2.76 | 2.23–2.69 |
| 7 close Grade | 1.77–2.23 | 1.69–2.15 |
| 8 Library idle 60s | 1.70–2.16 | 1.69–2.15 |
| 9 B reduced Proof | 4.83–5.29 | 2.18–2.38 |

Both Grade import peaks clearly miss the 2.5 GB target even before any GPU
addition. Idle Grade is near/over the ceiling depending on overlap, and over
the 1.9 GB settled target in both scenarios. Library idle is near that settled
target. Full-size delivery, larger folders and the old persistent hidden-window
hold remain unqualified. No budget, estimate or release-policy change is
proposed in this measurement step.

**Validation:** 797 JavaScript checks passed. Python: 3,051 passed, 3 skipped,
one unrelated failure:
`test_library_live.py::test_remembered_failure_does_not_hide_current_grade_cached_scene`
(expected native live-plan refusal 422, got 200). No backend/Library behaviour
was edited; the failure was left alone and not rerun. Real-app observation is
the focused GPU exercise for this diagnostic work; no export/output/shader
implementation changed. Output started and finished at 29.2 GB (below the 100 GB limit);
raw fast-check logs are retained with the run. Temporary profiles/photos were
removed; no broad cleanup of Steve's existing output was performed.



### November 3: completed shared-source ownership

Library shared preparations now clear their downloaded source reference when the
last requested tier finishes or fails. Finished direct-scene callbacks can retain
the job's lexical context beyond its backend claim; this previously kept about
1.760 GB of full-source samples alive after reclamation in the HDR folder copy.
Only the existing bounded decoded-source cache may retain samples after a yield.
Sharing, native resolution, cache shares, estimates and all approved sizes remain
unchanged. Grade's open source remains counted and uses the existing close gate.


The stronger whole-app check still fails the unchanged peak rule: Grade import
reaches 4.870 GB, although Grade return, close, Single exit and Compare exit
settle below target. Steve kept that separate import peak out of Batch 3c.
The same-folder scroll checkpoint also has unfinished work at 30 seconds;
full retention acceptance is still open (see photo-library, November 3).

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 29, 2026, against the code on
  `library-big-folder` (implementation based on `c57c4ee`; validation below).
- **Code:** backend `app_memory.py` (whole-app measurement and admission),
  `library_raw.py` (RAW reader and hand-off allowances), `library_pictures.py`
  (picture cache, hand-off, camera previews), `library_cache.py` and
  `library_screen_previews.py` (disk allowances), `render_cache.py` (Grade
  source cache); frontend `library-tile-pool.js`, `library-ready-window.js`,
  `library-gpu-raw.js`, `library-raw-gpu.js`, `gpu-budget.js`,
  `gpu-render-plan.js`, `webgpu-preview.js` (GPU budgets), `photo-library.js`
  (reclaim on memory pressure).

This file owns **how much memory and disk the app may use, and how that is
split between its parts**. The other module PRDs describe what each cache is
for; the sizes live here. Change a size here first, with Steve's decision, and
then in the code.

**Built, November 1, 2026: one scheduler for Library memory and GPU work**
(merged into `main` as `ae1396a`; X-Trans follow-up `f1a99d4`). It replaced
the fixed 600 MB per-job reservations, double-counted memory and
refusal-as-pressure loops behind the October 29–30 stalls. The finished
design, measurements and history are archived in
[library-resource-scheduler-design-2026-10-30](../../technical/archive/briefs/library-resource-scheduler-design-2026-10-30.md)
(section numbers such as "scheduler 7.20" in this file and in the Library
PRD point there). Approved numbers, which change only with Steve's decision:

- **Ceiling:** the 4 GB rule and user setting in section 3. A peak may exceed
  it by up to 10% briefly, and the app must settle below the ceiling minus
  600 MB. The system reserve (the larger of 2 GB or 10% of RAM) is a hard
  stop.
- **Per-job estimates:** the bytes-per-pixel table in section 3 (AVIF 56;
  X-Trans RAF on the CPU route 45). The scheduler admits jobs by estimate,
  and logs and corrects overruns.
- **What's on screen comes first:** classes Grade/export, now, soon,
  eventually. A fast lane runs small jobs (estimated at 64 MB or less, such as
  camera previews) beside big ones, and a 1 GB floor lets one visible job
  start even when the room is taken.
- **Two developments and two saves** at a time. GPU work runs inside the
  same scheduler, within the Automatic VRAM budget (half the dedicated video
  memory, section 6). Grade and export preempt Library developments at the
  next safe point.
- **Grade coexistence:** a large photo open in Grade pauses Library work with
  a message and a **Close photo in Grade** action.

Known open items: the Grade pause message takes 3–4 s to appear when a folder
is opened (target 1 s; see the Library PRD); intermittent zeroed colour
channels in 42 MP RAW thumbnails since the merge (being tested with one GPU
development at a time); some of the CPU recipes listed in section 8 are
still unqualified.

### October 31: GPU priority and source sharing decisions (Steve)

Library GPU intermediates are disposable at a safe point when Grade or export
needs their memory. Release them and requeue without spending an attempt. Keep
CPU decoded samples only when free to keep within the existing sharp-scene RAM
share; otherwise drop them. **No disk checkpoints and no increased allowance.**
Log the priority wait through release; export should wait well under one second.
This replaces the earlier “not thrown away” rule for GPU work.

M17 sharing between Grade and Library applies only to simultaneous requests
at the same resolution. Grade's full-resolution work and a Library 640
development may both proceed, with Grade priority. **Steve, November 2, 2026:**
the earlier "no new cross-resolution sharing machinery" rule is lifted for
Library-only demand, so a photo opened while its grid picture develops is read
once (a second read costs about 8–10 s on a large RAW plus slow-storage time).
Batch 2 (`68e2b4c`) shares overlapping Library 640/2560 demands for one source recipe:
one admission owns the active preparation and releases it when demand ends.
This adds no retention, cache share or memory allowance; selected native detail
and Grade's full-resolution work remain separate.

### October 31: planning ceiling acceptance and overrun records (Steve)

The whole-app ceiling is a planning budget. While a job runs, memory may
briefly reach **ceiling +10%** (4.4 GB at default 4 GB). After work finishes
it must settle below **ceiling −600 MB** (3.4 GB). The larger of 2 GB or 10%
of system RAM remains a hard physical reserve; never start work that would
cut into it. Existing estimate admission, cache shares, floor and fast lane
are unchanged. This decision supersedes earlier exact-ceiling acceptance here.

The independent measurement harness stops above ceiling +10% or on a reserve
breach, reports peak/overage, active grants and file types, and duration per
sampled excursion. Sampling resolves duration to about 500 ms. A bounded
30-second observation window checks settling after screen work; unfinished
work or no settling is incomplete acceptance, not a relaxed target. Production
logs record crossings/recovery and propose review after repeated excursions
with the same active type. Rates never change automatically; attribution is
association with an active grant, not isolated proof of its cost.

The earlier **4,011,418,177-byte** AVIF sample passes the revised peak rule.
The stopped run did not measure completion or settling. Keep **56 bytes/pixel**,
leave AVIF alone, and rerun the default mixed folder in final acceptance.
Qualified reduced >=100 MP JPEG/PNG/TIFF/linear DNG remain **6/8/6/6**;
native, ordinary and CPU rates stay unchanged. Helper active deadlines cap at
300 seconds with Try again and no broken-photo receipt. Leave the isolated
successful DxO DNG alone; capture its full request error if it fails later.
GPU scheduling and 640-only work remain open; scheduler design section 7.9.

### October 31: phase 3c live memory setting; estimates awaiting Steve

The persistent Settings > Performance memory control is built and applies
without restart, including helper, scheduler, target and scaled cache shares.
It ranges from 2.5 GB to RAM minus max(2 GB, 10% RAM); the default rule is
unchanged. Lowering uses existing reclamation. Giant cells link to Settings
and resume in the same folder after a sufficient increase, without a broken
photo receipt. Three 192 MP sources verified 4 -> 16 GB resume.

JPEG DCT reduction, sequential PNG/TIFF and a qualified root-page linear-DNG
route now reduce before Library development. No cache allowance or approved
estimate changed. **Approved by Steve, 2026-10-31** (not yet in code; each
needs a whole-app recheck): reduced routes >=100 MP use JPEG 6, PNG 8, TIFF 6
and eligible linear DNG 6 bytes per source pixel. Codex proposed 2 for linear
DNG; Steve chose 6 because the line scan's measured whole-app increase
(1.226 GB, about 4.1 per pixel) is double what 2 budgets. AVIF 56 (was 38).
Source peak increments: 100 MP JPEG/PNG/TIFF 322/569/401 MB; 192 MP
791/1101/258 MB; line scan 390 MB. The isolated line's **whole-app** increment
was 1.226 GB, above the 1 GB aim (12.466 s active, within 27 s).

The one permitted test-only 100 MP comparison overlapped all three sources at
4 GB, peak 2.478 GB; its override is removed. Approved rates remain shipped.
Default mixed qualification still fails: AVIF crossed 4 GB at 4.002 GB. At
16 GB, line and 192 MP sources finished; 22/27 finished overall, with five
non-memory refusals. Settings up/down took 62/22 ms, no failure; 89.7 ms
maximum frame gap during those changes. No cache share increase. Scroll-back
on the 48-photo fixture reused presented pictures without source reads; the
reported larger-folder symptom remains unconfirmed. Full evidence and pending
decisions: [scheduler design 7.8](../../technical/archive/briefs/library-resource-scheduler-design-2026-10-30.md#78-phase-3c-live-memory-setting-and-reduced-library-sources-october-31).

### October 31: phase 3a.2 measured admission and native ownership

Admission now also requires measured whole-app bytes plus estimates for grants
not covered by that census plus the incoming estimate to fit the ceiling.
Covered grants are not counted twice. Approved floor, fast-lane, physical-reserve
and oversized-alone rules remain unchanged. Saving retains its memory grant
after releasing a development place; two saves at once is Steve's decision
(2026-10-31). It may limit folder speed: retest two, three and four saves once
the other major changes are in (scheduler design, decision 14).

Fresh scheduler censuses run every half second. Memory endpoints return a
completed census while another walk is busy. Transient spill/packing/index work
runs outside the shared picture lock. Moderate Chromium cleanup collects page
garbage; critical cleanup still requests native pressure. Thresholds, cooldown,
halving and critical zeroing are unchanged.

A Chromium detailed dump identifies 1.099 GB of native GPU transfer memory,
0.810 GB mapped into the main page (shared overlap, not additive), 94 MB GPU
shared images and 390 MB browser upload blobs. Page JS used 11.6 MB. These are
engine-owned native allocations counted in the measured total, not a new cache
share. Retained direct textures report 445.747 MB under the existing sharp
512 MB share and halve on moderate trim. No approved rate/share/ceiling changed.

Cold Aceh peaks were 3.598/3.712 GB with no memory-request timeouts. Mixed phase0
stopped at 4.022 GB after an AVIF decoder exceeded its admitted estimate; this
remains unqualified. See design 7.6 for census coverage tests, native dump and
per-file evidence; bounded routes in 7.7 remain unfinished.

### October 31: phase 3b partial scheduling

Startup upkeep uses the existing 64 MB minimum estimate as eventually work,
yields between safe points, and releases its grant on completion/close. Hidden
window work becomes eventually without changing its estimates or allowances. Native window-state events cover minimisation when Chromium visibility stays visible.
Bounded large-image routes and coordinated unavailable-disk-cache fallback remain
unfinished; all approved rates/shares stay in force. See design 7.7 for why the
transient handoff cannot safely be detached from failed disk storage yet.

### October 31: phase 3a.1 admission cap

Two source/CPU developments may be admitted across windows. This is the approved
count, not a new memory allowance. Quick previews precede new developments; all
estimates, floor, physical reserve and fast-lane limits remain unchanged. A
prepared job still owns its decoded memory through its exclusive GPU wait; no
unaccounted release is used. Corrected cold Aceh peak 3.601 GB.

### October 31: phase 3a scheduler and channel connected

`library_scheduler.py` owns estimate admission, priority/FIFO, the visible
floor, the four-job fast lane, system reserve and disconnected-owner cleanup.
`library_estimates.py` reads headers without decoding pixels;
`library_grants.py` serves one WebSocket per window and in-process waits for
backend work. Live source, CPU, sensor, quick preview and RAW-reader callers
use it. A source-preparation request reuses its window grant.

Room is ceiling minus the approved 1.3 GB starting footprint, cache bytes
capped at their shares, and Grade's unique retained source allocations.
As superseded by phase 3a.2 above, measured whole-app memory is also an admission gate;
operating-system pressure still counts everything. Existing phase 2 trim
cooldown and all approved budgets/shares are unchanged. Waiting is not a
failure or a pressure event. The Close photo in Grade action requires edits
to be drained and saved before releasing the source.

Grant logs include class, estimate, wait and peak alongside the reason. The
peak is the largest sampled whole-app increase since that grant began, not
an isolated job measurement: overlapping work and cache changes affect it;
a short job or unavailable measurements can have no useful peak. An unavailable
measurement is logged once and scheduling continues on estimates.

Cold-folder timing remains outside tolerance; see the performance table and
design 7.6. Phase 3b and the phase 4 GPU broker are not implemented here.

**Decided by Steve, October 31 (to revisit): unknown size.** When a file's
dimensions can't be read from its header, its job is estimated at the
ceiling (the full Library budget, 4 GB on Steve's machine). It then runs
alone, never as the floor, and only when free memory minus the system
reserve covers it. It is logged as "unknown size" with its measured peak.
Revisit if those log lines show real photos taking this path often or
waiting long on small machines; alternatives are in design decision 10.

### November 2: overshoot causes found; estimates unchanged

Steve's November 2 session peaked at 5.14 GB with 35 needless "needs more
memory" refusals. Causes and fixes (`library-avif-gainmap-gpu`):

- **Library window leak** (`80decca`): each grid cell kept its whole
  downloaded source. Gain-map AVIFs left 60-430 MB each; the window held
  2.2-3.4 GB that no cache share counted and reclaim could not free.
- **Refusal after one reclaim** (`a487f9c`): a job up to the ceiling minus
  the 1.3 GB starting memory now waits (retrying reclaim every 10 s) instead
  of being refused. Larger jobs keep the notice.
- **Lapsed reservations** (`2520301`): a running job's unused estimate now
  counts until it finishes, not only until the first sample.
- **Per-type estimates checked, none exceeded** (one development at a time,
  HDR Test Images): DxO linear DNG 0.56-0.62 GB measured vs 1.18 GB estimate;
  DJI DNG/TIFF 0.27-1.10 GB vs 1.32-1.34 GB. No rate change proposed.

Results (90 s cold quick checks): HDR Test Images peak 4.45 -> 3.54 GB,
settled; Play_Raw AVIF copy peak 4.0 -> 2.63 GB, settled, 0 refusals.
The ceiling, 4.4 GB elastic maximum, floor, shares, reserve, saves,
developments and GPU budget are unchanged. The November 1 EXR header gate is
replaced by the assumed-colour decision ([import-and-raw](import-and-raw.md)).

## 1. Purpose

HDR Finisher holds pictures in several processes at once: the Python backend
and its helpers, the Electron main process, the page (renderer) and the GPU
process. Each part has its own cache. Without one owner for the total, each
size was chosen on its own and together they reached about 8.4 GB on a 64 GB
machine (section 7). This module sets one total, divides it, and says how the
app behaves when the machine runs short.

## 2. Principles (Steve, October 29, 2026)

1. **One total for the whole app.** Every RAM cache is a share of a single
   app-wide budget. Adding or enlarging a cache means taking room from another
   share or asking Steve to raise the total.
2. **Fixed sizes that scale down, never up.** Total physical RAM can be read
   reliably on every platform; free RAM cannot, because other apps change it
   from second to second. Sizes depend on total RAM only to protect small
   machines. Large machines do not get bigger caches, because speed is limited
   by the disk and GPU, not by how much is held in memory.
3. **Caches are limited by bytes and drop the least recently needed first.**
   Visible photos, then the selected photo and its neighbours, keep priority.
   Redrawing an older photo when scrolling back is acceptable.
4. **Hand-off layers hold only work in flight.** Memory used to pass a picture
   between processes is released once the picture is delivered; it is not a
   second cache.
5. **One kept copy per level.** A photo should not be kept as a RAW file, a
   hand-off copy, a GPU-process copy and a page copy all at once. Each level
   keeps what it needs and lets the others go.
6. **React when the machine is short of memory.** When Windows or macOS reports
   memory pressure, the caches drop their oldest entries early (moderate
   pressure: trim to about half; critical: drop everything that can be made
   again). This follows Chromium's memory-pressure practice.
7. **Working room is reserved, not capped at 600 MB.** Cache shares cap
   retained bytes. Caches leave at least 600 MB free inside the total;
   temporary developments and other jobs may borrow any additional free room.
   Several developments may run together when their reservations fit. Visible
   photos go first; the hard limit is the whole-app ceiling (Steve's
   clarification, October 30, 2026).
8. **Disk and VRAM are separate budgets.** Disk allowances (section 5) and GPU
   memory (section 6) do not count toward the RAM total.

## 3. Decisions

| Decision | Date |
| --- | --- |
| **Whole-app RAM ceiling: the smaller of 4 GB or a quarter of total RAM, but never less than 2.5 GB.** 4 GB means 4,000,000,000 bytes, counting Electron main, renderers, GPU-process host RAM, the Python backend and its helpers. Dedicated VRAM is not counted. | Steve, 2026-10-29 |
| **User memory setting, like DaVinci Resolve.** Settings will let the user choose how much memory the app may use: from 2.5 GB up to the computer's RAM minus the system reserve (the larger of 2 GB or 10%). The ceiling, target, scaled shares, admission and the very-large-picture check all follow it. The default stays the rule above (Steve, 2026-10-31: users with big files raise it themselves). Built live and persistent in phase 3c; evidence and limitations in the scheduler design, section 7.8. | Steve, 2026-10-31 |
| **Budget split** as in section 4. Approved as a trial; adjust from measurements. | Steve, 2026-10-29 |
| **Respond to system memory pressure** by trimming caches early (principle 6). | Steve, 2026-10-29 |
| Older pictures may be discarded and redrawn; visible and nearby pictures keep priority. | Steve, 2026-10-29 |
| **Recent thumbnail pool: fixed 512 MB**, sized for an 8 GB machine; not scaled with RAM. Finished grid and filmstrip cells stay built for one screen beyond each edge. | Steve, 2026-10-18 |
| Grade import: no additional full-size photo copies held at once; about 100 MB extra peak working memory is allowed; larger additions need Steve's decision. | Steve, 2026-10-13 |
| **Per-job memory estimates for the Library scheduler** (measured peak plus 25%, from header pixel count, 64 MB minimum per job). Backend RAM in bytes per pixel: camera RAW sensor read 7; JPEG and Radiance HDR 23; PNG, TIFF and linear DNG 28; EXR and PFM 38; AVIF 56 (raised from 38 by Steve, 2026-10-31, after a measured 44.7 overrun); HEIC, HEIF and JPEG XL 52; CPU route, 25 except header-confirmed 6x6 RAF, 45 (Steve, November 1; 587.7 MB measured private peak plus 25%, scheduler section 7.20). Reduced-decode quick preview: 64 MB. Quick preview without reduced decode: 23 × the preview's pixels. GPU memory: the existing `rawBudget` formula. Overruns are logged and raise that type's estimate. Measurements: scheduler design, section 6.11. Built in the Library scheduler (November 1). | Steve, 2026-10-30 |
| **Gain-map AVIF decoder memory and admission (supersedes the uncommitted 3 GB proposal):** reduce native memory without changing decoded samples, then use measured peak plus 25%. Full-source and CPU-fallback gain-map AVIF jobs use **50 bytes/pixel**, 64 MB minimum; headers identify gain maps without decoding pixels. Complete decode-tree peaks (Python, helper, console hosts) were 539,377,662 / 686,570,347 / 1,580,237,384 bytes at 13.7/18.0/42.2 MP. The largest peak-per-pixel plus 25% is 49.12, rounded up to 50. Estimates at 14/18/42 MP are 0.70/0.90/2.10 GB. Plain AVIF source stays at 56 bytes/pixel, plain CPU at 25; quick previews stay unchanged. No ceiling, reserve, cache, fast-lane or GPU limits change. The earlier 3 GB conditional proposal was rejected after it admitted neither photo and was never committed. GPU reconstruction is dropped. Steve authorized the memory reduction, exact samples, and re-estimation from measured peak plus 25% on November 2. | Steve, 2026-11-02 |
| No disk allowance increases without Steve's decision (selected-photo native detail uses the existing full-size allowance). | Steve, 2026-10-19 |
| Superseded: the RAW reader sized from "memory is plentiful (64 GB)" (October 14 disk-reader brief, FastRawViewer's 40 files cached / 12 ahead). Replaced by the fixed shares below. | 2026-10-29 |

## 4. RAM budget

Shares of the 4 GB total. On a smaller total, the cache shares (marked
"scales") shrink in proportion. The starting memory and the working room do
not shrink.

| Part | Process | Share of 4 GB | Scales | Implementation |
| --- | --- | --- | --- | --- |
| App starting memory | all | about 1.3 GB, measured | no | Observed process charge, never claimed as cache bytes. |
| Finished thumbnails | renderer / GPU host | fixed 512 MiB (existing fixed pool) | no | Pool plus visible/nearby canvas estimates report to `thumbnails`; oldest detached cells go first. |
| Sharp selected/nearby pictures | renderer / GPU host | 512,000,000 bytes | yes | Ready surfaces and direct scenes share one byte cap; older finished surfaces/scenes are evicted. |
| Camera previews | backend / helper | 64,000,000 bytes | yes | Aggregate preview LRU claims `camera`. |
| RAW read-ahead | backend | 768,000,000 bytes, at most 12 files | yes | Reader admits actual file/shared-section bytes, including partial reads. |
| Picture hand-off | backend / helper | 256,000,000 bytes | yes | RAW outputs and transient picture bodies share `handoff`; delivered bodies are released. |
| Grade source mips / session frames, masks, hue stages / retained native source | backend / helper | inside working room | — | A 600,000,000-byte aggregate retention cap replaces the separate 256 MiB mip, 192 MiB frame and 96/160 MiB mask limits. Unique array backing is counted once within a session; persistent mips have one retaining owner. Oversized levels are served without being cached. |
| Working room | all | at least 600,000,000 bytes kept free | no | Minimum free room protected from retained caches, not a maximum for jobs. Concurrent temporary reservations may use all remaining room below the whole-app ceiling. |
| **Total** | | **ceiling 4,000,000,000 bytes** | | Actual process charge is the final gate; shares are approximate and cannot override it. |

The fixed thumbnail decision preserves the existing 512 MiB implementation.
All other cache shares scale by `(ceiling − 1.3 GB − 600 MB − 512 MiB) /
(4 GB − 1.3 GB − 600 MB − 512 MiB)`. Starting memory, working room and the
fixed thumbnail pool stay unchanged. No share or ceiling was enlarged.
`app_memory.py` is the backend owner. Helper cache growth is admitted over
IPC by that owner; renderer caches use its returned share limits and report
actual retained bytes every 500 ms. Disk and dedicated VRAM remain separate.

With the 2.5 GB minimum, an 8 GB machine has about 0.6 GB left for the cache
shares after starting memory and working room. That machine redraws more
often; nothing stops working.

## 5. Disk allowances

Disk caches do not count toward RAM. Sizes are user settings in the Library
pictures window (1, 2, 5, 10 or 20 GB) unless noted.

| Cache | Default | Code |
| --- | --- | --- |
| Thumbnails (`thumbnail`) | 2 GB | `library_cache.py` `ALLOWANCES` |
| Full-size scenes (`full_size`) | 10 GB | same |
| Saved-grade pictures (`saved_grade`) | 2 GB | same |
| Stored screen previews (protected and unprotected) | 10 GiB, fixed | `library_screen_previews.py` `LIMIT_BYTES` |
| Browsing pictures (`library-pictures\`) | 2 GiB, trimmed to 90% | `library_pictures.py` `CACHE_LIMIT_BYTES` |
| Add-folder media browser | 512 JPEG files | media-browser helper |

Background preparation stops when its allowance is full; cleanup never evicts
protected previews. See [photo-library](photo-library.md) for what each cache
holds and [technical/photo-library.md](../../technical/photo-library.md)
section 9 for file layout.

## 6. GPU memory (VRAM)

VRAM is a separate budget, set per device in `gpu-budget.js` and
`gpu-render-plan.js` (automatic policy 2 GiB; smaller on software or limited
adapters). Grade's GPU tile caches trim against it in `webgpu-preview.js`.
Library RAW development, delivery and Grade share the GPU broker's budget.
Library developments and finished-cell draws now take their allowance inside
the one Library scheduler (phase 3c.2 Part B, October 31): up to two
developments share the GPU when their estimates fit the Automatic VRAM budget
(half the detected dedicated video memory; the Library reports the same budget
as Grade, not the 2 GiB policy default), finished cells draw on a small
allowance without waiting for a development lease, and Grade or export preempts
a Library development at its next safe point. Library GPU RAW keeps at most
384 MiB of developed scenes (`library-raw-gpu.js`). Details:
[preview-and-gpu](preview-and-gpu.md).

GPU-process **host** RAM (Chromium's copies of uploads and canvases) does
count toward the RAM total, and grows with the number of live canvases.

## 7. Current state and measurement (October 29, 2026)

Budget implementation is in progress on `library-big-folder`. The five-minute
manual checkpoint below restores retention under the ceiling. The lock criterion
and broader CPU qualification remain open; full ten-minute/driver validation is deferred.

**Windows gate:** sum proportional resident bytes for Electron main and its
complete descendant process tree (renderers, GPU host, backend and helpers).
For every resident page from `QueryWorkingSet`, charge a private page once;
charge a shared page as page size divided by its OS ShareCount. This avoids
adding Chromium mappings and backend/helper shared sections as full copies
in each process. This is proportional attribution, not private commit bytes
and not the sum of working sets. Pages shared with other applications are
attributed proportionally too. Windows saturates ShareCount at seven, so
heavily shared pages can be overcharged; this is conservative. Dedicated VRAM
is absent from this measurement. Ordinary working sets are retained only as
diagnostics. See Microsoft's [working-set flags](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-psapi_working_set_block).

The independent Python observer samples approximately every 500 ms, outside
the app's process tree, even when renderer/backend requests stall. It records
per-process charge, ordinary working set, Electron role, latest owner cache
bytes/share and renderer estimates. Cache telemetry carries its own timestamp:
it is asynchronous, not a simultaneous heap census. An unreadable live
process fails measurement rather than being charged zero. The gate stops at
the first sample above the exact ceiling. Plateau assessment requires no
sustained rise in the final two minutes, allowing a 5% band for OS/allocator
variation; this tolerance never applies to the ceiling. Cache bytes explain allocations;
they are not added to process bytes a second time.

On macOS the implemented sampler uses the kernel's `proc_pid_rusage` physical
footprint charge, with resident bytes alongside it, and libdispatch memory
pressure events. This platform path has not been validated on this Windows
machine. See Apple's [rusage structure](https://github.com/apple/darwin-xnu/blob/main/bsd/sys/resource.h).
Windows pressure uses memory resource notifications. Moderate pressure trims
oldest reconstructible entries toward half; critical pressure drops them.

**Electron main investigation:** the earlier 1.040 GB resident sample had only
8.1 MB of live JavaScript heap (and 4.3 MB external). The large increase was
outside the JS heap. Live picture uploads converted Blob bodies to
ArrayBuffers; Electron's auth `webRequest` hook exposes byte uploads in main.
Uploads now retain Blob backing and the hook records any remaining byte
uploads. This removes the identified bulk-copy path; its effect and the main
process high-water mark must be established by the scroll gate. It is not yet
a proven explanation of every historical spike. See [Electron request details](https://www.electronjs.org/docs/latest/api/web-request).

Earlier scroll numbers used summed working sets (latest 4.233 GB at 255 s)
and cannot be compared directly with this gate. Historical records remain in
`codebase/output/big-folder/`.

**Fast checks:** Python 2,729 passed / 3 failed / 3 skipped; JavaScript
662 passed / 2 failed. The five failures are previously recorded: adjustment
preset source contract, RGB publication fixture, retouch capture-cache fixture;
selected fallback and Single ready-window JS fixtures. The 91 focused
cache/helper checks pass. The combined run also covers restoring the helper
adapter after its in-process test. Real-folder scroll remains pending.


October 29 validation follow-up: the first completed 600.651-second scroll
stayed below 4 GB (2.585 GB peak, about 2.06 GB at the end), but finished
picture caches remained empty, so this does not establish the browsing goal.
Delete confirmation on the disposable PNG was 993 ms and cancelled; protected
project hashes were unchanged. RGB-native and codec-native passed. Scroll-cache
failed waiting for finished cells; background-activity failed waiting for its
Pause indexing control. Precision-source and live-native could not create
hard-linked fixtures on the exFAT D: volume. Admission now distinguishes a
busy 600 MB working slot from low total RAM: queued work must not reclaim the
current picture. A regression check covers that distinction. Shares are unchanged.
The repeated scroll records finished-cell counts explicitly; validation remains open.


**Paused at Steve's request, October 29.** Latest code is `3c446d9`
(after `b567c15`), still on `library-big-folder`; no push or merge.
The repeat used a disposable NTFS Windows TEMP profile. It was stopped by
request after approximately 230 seconds of independent sampling, before
completing the ten-minute gate or repeating Delete. Peak charge was
3,919,898,910 bytes; final sample 2,490,635,991 bytes. Two finished grid
cells were observed, and finished/camera/sharp bytes were retained. This is
partial evidence only: no plateau verdict. The peak had backend charge about
1.859 GB, GPU host 1.046 GB, renderer tabs 0.584 GB and main 0.143 GB;
main ordinary resident was about 0.216 GB at that sample. Backend temporary
allocations need investigation against the 600 MB working room before claiming
one enforced whole-app ceiling. No shares were changed.

| Share | Peak sample bytes / limit | Pause sample bytes / limit |
| --- | ---: | ---: |
| thumbnails | 51,892,480 / 536,870,912 | 57,945,600 / 536,870,912 |
| sharp | 0 / 512,000,000 | 80,768,000 / 512,000,000 |
| camera | 6,796,834 / 64,000,000 | 57,811,826 / 64,000,000 |
| raw | 0 / 768,000,000 | 0 / 768,000,000 |
| handoff | 26,310,222 / 256,000,000 | 168,059,324 / 256,000,000 |
| working | 0 / 600,000,000 | 0 / 600,000,000 |

Longest recorded lock hold in this NTFS repeat: `reconcile`
375 ms. The earlier exFAT-profile run recorded a 1,344 ms
startup copy observation, 656 ms during scrolling, and a 547 ms index batch.
The 250 ms requirement remains open wherever exceeded.

Fast checks after the admission follow-up: Python 2,730 passed / three known
failures / three skipped; JS 662 passed / two known failures; ten focused
memory checks passed. The six driver results above predate this follow-up;
they are not a validation of `3c446d9`. Their total run time was under eight
minutes, sequentially, with no 15-minute stall or 75-minute cap reached.
Protected hashes were checked again after stopping and are unchanged.

Resume: inspect the repeat's backend temporary allocations and lock timings;
finish auditing RAM caches against the single owner (including Grade session
frames/masks), and resolve hand-off cancellation/delivery lifetimes. Then run
fast checks and the full ordered scroll/Delete/six-driver sequence. The two
hard-link fixture drivers require an NTFS fixture strategy; D: is exFAT.
Evidence is retained under `codebase/output/big-folder/budget-validation/`
and `budget-validation-repeat/` (JSONL plus per-PID CSV, cache peak/end CSV for
the completed first run, backend logs and each driver result). Temporary
measurement profiles and driver photo scratch are removed. The three original
untracked items were left untouched. Steve asked to resume; the next gate will run after the follow-up fast checks.

Resume follow-up: camera/original quick-preview extraction now obtains the
existing 600 MB working reservation before allocating; queued previews wait
asynchronously rather than occupying the request worker pool. Cache hits bypass
decoding and admission. Grade session caches now register with the same owner;
the old independent frame/mask/mip defaults are removed. Critical pressure can
discard those cached levels and rebuild them. Failed deferred publication
releases its hand-off payload in `finally`. Unreadable live Windows processes
now fail measurement also when opening/querying the process fails. Reconcile
yields between individual photos, and photos with no virtual-copy state no
longer create an empty baseline transaction. Shares remain unchanged.
Forty focused memory/Grade/live checks passed; the broader 111-check group had
110 passes and the previously known RGB publication fixture failure. Full
fast checks and the ordered gate are in progress; these changes have not yet
established the ten-minute goal.

Sustained OS moderate pressure trims once when entered, rather than halving
every sampling tick. Actual budget overruns continue reclaiming until working
room is available; critical pressure still clears reconstructible caches.

**Decided by Steve, October 31 (for scheduler phase 3, not built).** The
4 GB ceiling becomes the budget for normal Library work, not a hard stop:
- Photos on screen keep a floor: one ordinary photo at a time may run even
  when that takes the app over 4 GB, if its estimate is 1 GB or less (floor
  allowance, Steve, October 31).
- One large job at a time may also go over 4 GB.
- While a large photo is open in Grade, a large Library photo pauses with a
  clear message and a **Close photo in Grade** button. Grade stays fully
  usable.
- The hard stop is the computer's free physical memory minus a system
  reserve: the larger of 2 GB or 10% of RAM (Steve, October 31). A job
  that would cross it waits with a message; it is never
  marked failed.

- Quick previews have a fast lane of 64 MB, up to four at once; JPEG quick
  previews use a reduced decode (15–51 MB instead of 218–762 MB). A larger
  quick preview joins the normal queue with its own estimate.

Details: design section 7.6 and decisions 3, 4, 6, 8 and 9.

**Replaced October 30 (scheduler phase 2).** Pressure now comes only from
measurement and the operating system, never from a refused admission:
- **moderate:** measured whole-app total above the target (ceiling minus
  working room), including above the ceiling, or OS moderate pressure.
  Caches halve.
- **critical:** OS critical pressure only. Reconstructible caches are
  dropped. Our own ceiling being exceeded is not critical, because pictures
  dropped then could not be made again while admissions are refused.

The Electron main process trims when the level rises, then at most once every
10 s while it lasts (Chromium's practice), and logs each trim as
`memory_trim`. Chromium's pressure signal, the windows' cache trims and the
backend reclaim all follow that one decision. No size, share or ceiling
changed. The 600 MB per-job reservation stays until phase 3.

Follow-up fast checks: Python 2,731 passed / three known failures / three
skipped (481 s); JavaScript 662 passed / two known failures. Python failures
remain the scoped-preset contract, RGB publication guard fixture, and retouch
CaptureCache deferred-store fixture. JavaScript failures remain the selected
CPU decoder fixture and missing Single screen-preview stub. No shares changed.
Tests that formerly forced independent frame/mask limits now force eviction
through an injected smaller owner budget and preserve live-mask priority.


**Resumed gate, `f56075a`: STOP at 162.212 seconds of scrolling.** The
independent observer measured **4,425,675,331 bytes**, above the exact
4,000,000,000-byte ceiling. It stopped the app and skipped disposable Delete
and all six drivers, as instructed. There is no ten-minute plateau result.
The last sample is also the peak. No finished grid canvas was counted in 161
responsive scroll replies (longest reply gap 1,020 ms), with 11,089 listed
photos. This does not establish usable visible/nearby redraw behavior.

The process curve below uses GB (1e9 bytes) and seconds from observer start;
startup precedes scrolling by about 13 seconds. Full individual-PID samples
are in `codebase/output/big-folder/budget-validation-resumed/process-curve.csv`.

| Observer seconds | Main | Tabs combined | GPU host | Backend | Helpers combined | Total |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.049 | 0.150 | 0.400 | 0.094 | 0.239 | 0.960 |
| 30 | 0.120 | 0.287 | 0.951 | 0.142 | 0.256 | 1.784 |
| 60 | 0.234 | 0.325 | 0.939 | 0.315 | 0.256 | 2.098 |
| 90 | 0.089 | 0.326 | 0.863 | 0.277 | 0.256 | 1.841 |
| 120 | 0.090 | 0.466 | 0.899 | 0.284 | 0.257 | 2.026 |
| 150 | 0.106 | 0.450 | 0.918 | 0.281 | 0.257 | 2.041 |
| 175.5 (peak/end) | 0.109 | 0.339 | 0.908 | 0.289 | 2.750 | 4.426 |

Total also includes the utility, Python launcher, crash handler and console.
At peak/end the four helper PIDs charge 2,562,018,742 (39240), 62,469,266
(5728), 62,521,929 (44116), and 62,771,785 (18680) bytes. Backend 47364 charges
289,033,654; main 14656 109,026,157; tabs 47944/3908 291,900,854/46,738,285;
GPU 15124 907,769,563. The sharp spike is in helper 39240, coincident with a
`live-scene` job for `_DSC3289.ARW` starting about five seconds earlier.
This is a temporary-allocation failure while the 600 MB working reservation
is held, not evidence that a cache share should increase. Its allocation path
remains to be bounded within the agreed working room.

| Owner cache | Bytes at peak and end | Share bytes |
| --- | --- | --- |
| Thumbnails | 2,160,000 | 536,870,912 |
| Sharp surfaces/direct scenes | 0 | 512,000,000 |
| Camera previews | 5,635,374 | 64,000,000 |
| RAW read-ahead | 0 | 768,000,000 |
| Hand-off | 140,049,380 | 256,000,000 |
| Retained working caches | 0 | 600,000,000 |

The owner telemetry is 374 ms older than the peak process sample. The latest
renderer thumbnail estimate is 25,200,000 bytes (sharp zero), showing that
asynchronous reports can differ; both readings are retained in JSONL. Working
reservations separately total 600,000,000 bytes. Reported cache bytes are well
inside their shares despite the helper's excess temporary allocation.

Main's maximum charge was 237,823,122 bytes, maximum ordinary working set
306,454,528, and its largest observed byte upload 15,102 bytes. The former
0.90 GB rise did not recur in this short run; this is not a ten-minute bound
or a complete explanation of the historical spike.

Lock maxima: `marks_read` 110 ms, `marks_read_copies` 125 ms, `index_scan`
31 ms (`index_batch` 0 ms). The longest remaining hold was **734 ms in
reconcile**, still over the approximately 250 ms requirement, at shutdown
immediately after the ceiling sample. Splitting to one photo is insufficient
for that database/filesystem scope. The historic Delete/morning-freeze
causation remains unproven as described above.

Delete confirmation: **not run**. `library-scroll-cache`,
`library-precision-source`, `library-rgb-native`, `library-live-native`,
`library-codec-native`, and `library-background-activity`: **all not run after
this commit because the preceding ceiling gate stopped**. Earlier results
are historical, not validation of `f56075a`. The protected project hashes
remain unchanged; the owned C: profile and disposable Delete fixture are
removed. D:/Photos was only read. Output remains 2.0 GB, below 100 GB.
Evidence: `measurement.json`, `measurement-memory.jsonl`, `process-curve.csv`,
`cache-peak-end.csv`, `analysis.json`, and `measurement-backend.log` in
`codebase/output/big-folder/budget-validation-resumed/`.


### October 29: bounded CPU ARW picture

The no-GPU ordinary ARW thumbnail/screen development now processes full-resolution
sensor bands with 32-row halos and temporary planar files. It retains only the
640/2560 reductions in memory. Opposed-colour highlight coordinates are scanned
in bounded batches. This is a working-allocation change; no share or total changed.

With GPU delivery explicitly disabled, the complete visible CPU fallback for
`DSC07060.ARW` (7968 x 5320, 42.4 MP) returned a finished picture in 25.61 s.
The helper's proportional resident peak, including its baseline, was
**328,528,456 bytes**, within the **600,000,000-byte** working room.
Before comparing pixels, the proposed finished-SDR tolerance was average colour
difference below 1 and p99 below 2. Against the former full-image CPU route,
mean Delta E 76 was 0.0584 and p99 0.1948: inside those limits.

Qualification covers ordinary ARW, opposed-colour highlights, no saved repairs,
and edges at most 2560. Other formats, edge-colour, saved repairs and native CPU
inspection still use the previous development path and are **not qualified within
600 MB**. This is not a claim that every no-GPU recipe is bounded.
Evidence: `codebase/output/big-folder/cpu-bands-validation.json` and
`cpu-bands-parity.json`. Fast Python: 2734 passed, three existing failures,
three skipped. The existing failures are the scoped-preset source contract,
RGB publication fixture and retouch CaptureCache fixture. CPU-focused numerical
checks pass. No protected project was saved over.


### October 29: five-minute manual checkpoint after afcca55

Steve shortened this round to five minutes and deferred all six Library drivers
until before merging to main. The code is committed on `library-big-folder`;
there is no merge or push. Shares and the 4,000,000,000-byte total are unchanged.

Memory shortage now keeps source development on the GPU admission queue. The
page only selects CPU after a missing/software/lost GPU; generic development,
transfer and memory errors cannot select it. Capacity refusal in the backend,
including bounded DNG metadata/storage limits, answers pending. Unsupported GPU
source recipes report an error rather than silently selecting CPU. Idle and
speculative requests do not start CPU development; visible work has priority.

The regression had multiple contributing paths. At f56075a, camera-preview
requests began waiting for the entire working slot while holding browser HTTP
connections. The GPU source owning that slot needed those connections for
admission and handoff. Preview refusal now returns 202 immediately, and the
page retries without occupying a connection. Scrolling also cancelled every
loading cell, even overlapping ones; reconciliation now cancels only departed
cells. Finally, the ordinary Bayer reservation charged 44 bytes per photosite
although measured live allocations fit 28 plus the existing fixed overhead.
That estimate evicted finished surfaces before actual pressure. Complex graphs
retain their larger estimate. A 42 MP GPU ARW measured 1,041,881,888 live bytes
inside the new reservation. Direct RGB scenes are stored before eviction, so
reclaim does not discard the only finished scene. No share was enlarged.

The first five-minute attempt was **not a retention pass**: thumbnail bytes
fell to 102,221,440. The final run below is the manual checkpoint: thumbnails
rose toward their 512 MiB share and remained retained at the end.

**Memory/retention pass, overall gate incomplete.** At 2560 x 1440, the final
read-only D:/Photos scroll lasted 300.444 seconds. Peak proportional
resident process-tree charge was **3,075,009,385 bytes**; scroll end was
**2,737,641,174 bytes**. The maximum finished visible grid-cell count was
30; the last count was 5. These are visible canvas counts, not a total
of cached photos. Transient zero counts while moving do not mean empty caches.

| Scroll seconds | Main | Tabs | GPU host | Backend | Helpers | Total GB | Finished visible cells |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0.054 | 0.166 | 1.313 | 0.099 | 0.255 | 1.915 | 0 |
| 60 | 0.196 | 0.472 | 0.978 | 0.291 | 0.256 | 2.223 | 5 |
| 120 | 0.154 | 0.610 | 1.008 | 0.444 | 0.257 | 2.506 | 18 |
| 180 | 0.326 | 0.549 | 0.953 | 0.249 | 0.257 | 2.367 | 0 |
| 240 | 0.120 | 0.609 | 1.077 | 0.396 | 0.257 | 2.492 | 12 |
| 300 | 0.173 | 0.726 | 1.039 | 0.422 | 0.257 | 2.652 | 5 |

The total includes utility, launcher, crash-handler and console processes in
addition to the groups shown. It did not cross the ceiling. There is **no proven
plateau**: five minutes ended while thumbnails were still accumulating. This
is not the deferred ten-minute endurance result. Full per-PID samples and
one-second finished-cell counts are in `process-curve.csv` and
`finished-grid-cells.csv` beside `measurement-memory.jsonl`.

| Share | Bytes at process peak | Bytes at scroll end | Share bytes |
| --- | --- | --- | --- |
| thumbnails | 298,760,960 | 335,690,880 | 536,870,912 |
| sharp | 0 | 0 | 512,000,000 |
| camera | 50,084,241 | 60,949,335 | 64,000,000 |
| raw | 0 | 0 | 768,000,000 |
| handoff | 112,143,180 | 110,408,954 | 256,000,000 |
| working | 0 | 0 | 600,000,000 |

These are latest asynchronous owner reports: 563 ms before the peak and
845 ms before scroll end. The working reservation is separately 600,000,000
bytes at those samples; retained working-cache bytes are zero.

Longest scrolling marks-lock hold: **360 ms**, `marks_read` in accepted listing,
plus a **281 ms** picture-error revision hold. Both occurred during normal use,
so the approximately 250 ms criterion **fails**. Reconcile connection open/close,
pin reads and known-path stat checks now occur outside its marks lock; this does
not establish that all remaining read/revision scopes are short enough. The
historic 734 ms shutdown reconcile observation stays open separately.

Disposable-copy Delete confirmation took **40 ms**; it was cancelled and the
copy remained intact. Earlier, the bin size/count query independently took
34.97 s. Planning now selects the local-drive RecycleItem route without enumerating
the bin. Actual recycle failure still leaves the file alone and cannot silently
permanently delete it. All three protected project hashes were unchanged;
D:/Photos was read-only. Owned measurement profiles and fixtures are removed.

The isolated cold `_DSC3289_DxO.jpg` development took **2.098 s**, with upload
42.7 ms and reduction 115.3 ms; the resumed run reported 2.04 s and 4.24 s for
those stages. Admission request maximum was 4.7 ms in isolation. Those stopwatch
stages include asynchronous admission/network time, not GPU timestamp intervals.
The RGB GPU algorithm is unchanged against main 8ff72f8; the newly blocked
preview/admission path and request contention explain the multi-second stage
inflation. This is a supported contention diagnosis, not proof that all cold
latency regressed or recovered: **the earlier sub-second cold target is not yet
re-established**. The ordinary permit now lasts at most 100 ms instead of one
HTTP request per band; cancellation still checks each boundary (DNG keeps 20 ms).

Fast checks: JavaScript **665 passed, one existing failure** (Single test lacks
HDRLibraryScreenPreviews); Python **2734 passed, three existing failures, three
skipped** (the three exceptions named in the CPU note above). The later reconcile
change passed 40 focused membership/delete checks, with two real-bin cases
excluded from that focused rerun; full Python already covered those cases.
Six Library drivers and the full ten-minute scroll were **not run**, as requested.
Output ended at 2.1 GB, under 100 GB.

Evidence: `codebase/output/big-folder/five-minute-reviewed/measurement.json`,
`analysis.json`, `process-curve.csv`, `cache-peak-end.csv`,
`finished-grid-cells.csv`, `measurement-memory.jsonl`, and `measurement-backend.log`.
JPEG isolation: `codebase/output/big-folder/jpeg-isolated.json`.

### October 30: badminton cache and admission checkpoint

Waiting for working memory now stays in the ranked waiting queue, outside the
active source slots. Admission uses short requests with no connection retained
between retries. Metadata also returns pending while its helper lane is occupied
by a source. A GPU development that cannot fit must not block a smaller cached
draw that can fit. Newly visible development can cancel an offscreen source
parked at GPU admission and release its working reservation. No ceiling, share,
decoder version or GPU algorithm changed.

The scene-key regression was validation materialising the neutral
`edge_colour_expand_percent=0.5` in authored RAW settings. Canonicalising that
default restores the exact earlier keys for DSC07209/17/23/11/16; all five NPZs
still exist in the real managed cache. This was a key change, not eviction or
failure to store. Default-source and finishing-only reuse remain covered.

The incident's 23:21:34 checks for DSC07232 onwards were untraced idle-warmer
checks, not proof of completed visible-cell requests. The historical 50-second
holder cannot be identified from that log alone. Reproduction did identify
metadata connections held for seconds, hydration gating pictures for 6–11 s,
and an ungranted large GPU reservation blocking fitting draws; these gates are
removed. Grid read-ahead is cache-only and follows the viewport; full idle
warming waits until visible cells finish and every picture queue is idle.

Final isolated 2560 x 1440 scripted run: eight scroll positions through the
DSC0720x–0725x rows, six-second pauses, copied index and retained scenes in an
owned disposable profile; original photos only read. No drivers or ten-minute
run. Independent process-tree proportional-resident sampling at 0.5 s peaked at
**1,899,322,216 bytes**, below **4,000,000,000**. At that sample (bytes): Electron
PIDs 41804=52,827,282; 1176=1,277,063,753; 22092=134,579,346;
20488=37,771,556; 30636=17,890,157; 33316=8,462,336. Backend Python
39556=114,848,329; helper PIDs 38820=62,855,460; 20644=64,616,740;
14216=62,924,507; 40076=62,703,908. Python launcher 38328=1,014,052;
conhost 15548=1,764,790. Raw working-set sum was 2,344,562,688 bytes; it is
not the ceiling charge because it double-counts shared resident pages.

Of 73 ARW grid request attempts in those rows, 41 presented before leaving the
viewport/end: 31 unedited (1.665–11.551 s, median 3.938), ten edited
(3.587–5.323 s, median 4.371). **40 presentations exceeded 2 s**; 32 attempts
had no finished thumbnail before scroll/end, all observed unfinished for over
2 s in viewport snapshots (CSV records those lower bounds separately).
These are actual trace-ID joins
to compositor presentation, not DOM insertion matches or assumed successes.
This is not a complete latency pass. DSC07209 and DSC07211 presented on return
in 3.884/4.495 s; the other three named edited photos were scrolled away before
presentation. None of the five was redeveloped. Actual GPU admission order was
the exported DSC07198 Version 1 JPEG five times (cancel/retry), then DSC07259.ARW.
Earlier incident order was DSC07209 → 07217 → 07223 → 07211 → 07216.

Fast checks: final JavaScript 669 passed, one existing Single fixture failure
(`HDRLibraryScreenPreviews` missing). Full Python during iteration: 2725 passed,
13 failed, three skipped; ten failures introduced by the intermediate key fix
were corrected and rechecked (109 passed, one existing RGB fixture failure).
Final focused admission/key tests: 46 passed. The other existing Python failures
are the scoped-preset source contract and retouch CaptureCache fixture. No broad
rerun after those focused corrections. Protected project and photo-sidecar
hashes were unchanged; no page errors. Steve should try this checkpoint before
further memory work; the earlier deferred work below stays open.

Evidence under `codebase/output/badminton/`: `scroll.json`, `cell-timings.csv`
(every request, including missing results and >2 s flags), `summary.json`,
`restored-scene-keys.json`, `backend.log`, and fast-check logs. Owned copied
profile/cache scratch is removed after measurement; evidence is retained.
Output started and ended at 2.1 GB, below the 100 GB limit.

## 8. Open work

- Bound and qualify the remaining no-GPU CPU recipes listed above; only the ordinary ARW path has the measured 600 MB result.

Steve requested a manual try before the full ten-minute scroll and six drivers.
Do not run that deferred sequence in this round or increase shares. The latest
five-minute run passed memory/retention but did not pass the normal-use lock
criterion: shorten the 360 ms marks-read and 281 ms revision scopes. Broader CPU
recipes remain unqualified within the working room as listed above.

- Camera-preview admission, Grade cache ownership and single-row reconcile
  scopes are implemented; their whole-app effect still needs the gate below.
- Complete the ordered ten-minute read-only scroll, disposable Delete timing,
  then six sequential Library drivers. Stop if process charge crosses the
  ceiling. Record peak/end cache shares and per-process curve here.
- Confirm Electron main levels off after removing the byte-upload copy path.
- Validate macOS measurement/pressure on a Mac before claiming parity.
- Lock changes move path probes and grade/copy observation outside the outer
  marks read lock, and split index writes into single-row scopes. Measure the
  longest remaining hold; a slow filesystem/database call can still exceed
  250 ms, which must remain open if observed.
- The 33.516-second Delete planning hold was a later reproduction, not an
  identified holder in the October 29 08:17:32–08:17:50 incident. That incident
  recorded waits around 18.2 s without the outer holder's stack. The later
  hold can explain such a wait in principle, but cannot establish causation.

## 9. Rules for agents

- Any change to a size, share or the total is a decision for Steve. Record it
  in section 3 and update section 4 in the same commit as the code.
- A new cache must name its share, its process and what it drops first.
- Report memory per process and in total, using the method in section 7.

**November 1: exact finished Library thumbnails.** The backend stores
`library-thumbnails/<identity>.surface` in the existing 2 GB thumbnail disk
allowance, counted and trimmed by `LibraryCache` alongside source scenes.
Oldest managed files go first under its existing disk policy. The file holds
a JSON identity/dimensions header and lossless DEFLATE blocks containing the
exact GPU presentation bytes; HDR/SDR and canvas format have distinct keys.
No retained RAM index or pixel pool is added. Restored renderer canvases use
the existing fixed 512 MiB thumbnail share; oldest detached cells go first.
Request-owned compressed bodies, GPU readback and response buffers are
transient working memory and released after transfer. Captures share the
existing two screen-preview save places, and local reads use the existing API
worker pool. No ceiling, floor, reserve, share, development concurrency, GPU
budget, per-type estimate or disk allowance changes.
- Sources for this approach: darktable's fixed memory presets
  ([memory & performance tuning](https://docs.darktable.org/usermanual/4.8/en/special-topics/mem-performance))
  and Chromium's memory-pressure listener
  ([memory_pressure_listener.h](https://android.googlesource.com/platform/external/chromium_org/+/03339f7/base/memory/memory_pressure_listener.h)).

### October 30 retry: saved scenes and working room

Steve clarified that shares cap what caches **keep**, rather than partitioning
RAM into exclusive job slots. The 600 MB is a minimum kept free, not the
maximum for jobs. Development admission now compares actual whole-app charge
plus outstanding reservations plus the requested bytes with the unchanged
4,000,000,000-byte ceiling. It no longer clamps a request to 600 MB or forces
all concurrent jobs into that amount. Visible-first scheduling stays in the
ranked Library queue. Retained Grade levels keep their own 600 MB aggregate
cap and are not evicted on every new admission or ten-second lease renewal;
they are reclaimed when total room is needed. Cache growth leaves the working
minimum free. Reservations conservatively include work already reflected in
process charge; this can refuse work before the measured ceiling when its
additional reserved bytes would not fit. It is not a 600 MB slot refusal.

The fixed slot was introduced by `b567c15`; `f56075a` made Grade retained
levels consume that same slot, and renewal also discarded those levels.
Neither change altered Library disk scene identity. Source-mip ownership and
Library NPZ ownership are separate: Grade mips use content fingerprints and
interpretation; Library scenes use file version, edge and source quality.
Neither includes cache owner/object identity. See the photo-library retry note
for the scene-key audit and short read-only measurement results.

Short retry measurement: **2,091,545,156 bytes** peak whole-app proportional
resident charge, below the unchanged 4 GB ceiling. No working-memory wait and
no admission request occurred: every edited cell used a stored scene. Behavior
checks separately admit three 600 MB jobs with a 1.8 GB measured app total,
preserve Grade retained levels during admission/renewal, and reject work whose
charge plus outstanding reservations would exceed the ceiling. The first
cached row still had draw-queue delays; this is not a complete latency pass.
See photo-library for the per-cell results and recorded known fast-check
failures (34 final focused checks pass). The profile and scene copies are
removed; original scenes/sidecars and protected projects remain unchanged.
Output started and ended at 2.1 GB. Steve's manual retry is the next checkpoint.

### October 30: keep pending Library previews drawable during reclamation

The exported-JPEG loop was a GPU lifetime error, not a new memory allowance:
six RGB source planes outlived their last reduction use. Releasing each plane
after that use fits the existing development reservation. Cache shares, the
whole-app ceiling and GPU budgets are unchanged.

The first-draw preview loss was hand-off ownership: the LRU could evict both
published bytes and their pending-store receipt while a visible draw waited.
Before evicting an undelivered pending entry, the hand-off owner now validates
its source/settings and atomically writes the already-packed NPZ into the
existing thumbnail/full-size disk cache, then releases RAM. Existing disk
accounting and trimming apply; no separate spool, byte copy cache or allowance
is introduced. Ordinary delivered transient bodies still release normally.
Install ownership before RAM admission for GPU and CPU publication; retain it
until pending disk publication finishes, so concurrent reclaim cannot leave
a gap with neither RAM nor disk backing. Changed-source checks still reject
publication. Disk I/O errors propagate as explicit failures rather than
publishing a missing preview.

Behavior checks cover both immediate hand-off admission refusal and later
zero-byte reclamation, and drawing during disk publication. The short fresh
profile open of disposable `20260214` copies backed **21** pending previews
during reclamation: all **18** developed cells presented, each developed once,
without restarts or draw failures. Per-cell timings and the JPEG failure
explanation are in photo-library's matching October 30 note; this is not a
new process-memory or endurance qualification. No drivers or ten-minute run.

Final focused cache/scene/error checks: 52 passed. The photo-library note
records the full fast-suite failures without claiming a clean broad pass.
Output started/ended at 2.1 GB; owned photo/profile/pytest scratch removed.
Both module records accompany this local `library-big-folder` commit.


### October 30: keep control sampling responsive during cold development

Memory sampling now runs on a dedicated executor, independently of the
ordinary API worker pool and disk reclamation. A single-flight process census
prevents concurrent callers from allocating duplicate Windows working-set
queries. Timestamp the completed census, avoiding an immediately stale sample.
Admission uses its own workers. Reclaim requests coalesce on a separate worker
and acknowledge queueing promptly; critical pressure upgrades pending work.
Disk spills no longer block subsequent controller samples. The desktop also
forwards the existing controller's pressure to Chromium's native allocators;
renderer cache eviction alone did not release accumulated transfer buffers.

The Library disk cache now evicts from its size/access-age ledger, releasing
the shared publication lock between small LRU families, rather than rescanning
the cache during every over-budget save. RGB preview handoffs carry clipped
half samples, matching the existing persisted NPZ precision and reducing
transient copies. Source ownership renews through waits and saves. The GPU
footprint estimate includes actual overlapping buffers/textures. No RAM
ceiling, target, cache share, disk allowance, 600 MB minimum or concurrency
setting changed.

Final fresh-profile cold mixed-60 capture with pinned indexing active:
**190** memory endpoint requests, **zero timeouts**, **127.8 ms p95**,
**336.5 ms maximum**, independently sampled whole-app peak
**3,826,597,295 bytes** (ceiling remains **4,000,000,000**). All first-two-screen
observations finished: 42 observations of 29 distinct photos because the
viewports overlap. The full photo-library note records per-cell latency,
stage times, reconcile counts, test failures and the still-slow 95-second
first screen. Three protected-project hashes were unchanged.

This is evidence for the short sample, not a guarantee for all 449 files.
Fast native half conversion exceeded the ceiling in an experiment; adding a
separate reservation while decode reservations were held then blocked work.
Both experiments are omitted. More concurrent GPU developments are not
recommended until transient allocation/readback ownership is improved.
Existing minimum, budgets and shares remain Steve's decision.

Output started and ended at **2.1 GB** (100 GB limit). Owned temporary
photo/profile/pytest scratch was removed; only linked small evidence remains.
Committed locally on `library-big-folder`; stop for Steve's retry.

### November 1: RGB correction DNG admission estimate (Steve)

Steve approved using the existing **28 bytes per source pixel** DNG rate for
mosaiced DNGs eligible for Library's mandatory RGB correction route. A header-only
check uses the same correction plan as decoding. Sensor-only DNGs retain 7;
linear DNG, CPU and quick routes retain their existing rates. The two 48 MP DJI
files now reserve 1.344 GB each rather than 336 MB. This may reduce overlap;
final cold repeats verify 20–22 / 31 shown at 30 / 60 s, 3.982–4.000 GB peak,
settling below 3.4 GB and zero ordinary reclaims. Default phase0: 22 / 27,
4.025 GB peak, settled; only the permitted non-fitting AVIF reclaims.
The accompanying EXR header gate avoids reserving an unusable decode before
its existing interpretation requirement is known. Grade coexistence and the
two requested release checks pass at `b6754a2`.
The 4 GB ceiling, 4.4 GB elastic maximum and all cache shares are unchanged.


### November 3: native RAW upload ownership (Batch 3b)

Full-source RAW planes cross the upload worker without full-body packing.
The backend admits one receive buffer to its existing native working-cache
owner before allocation, keeps that owner busy through publication, and
releases abandoned uploads at the worker's existing deadline. Native crops
read planar views; live scene saving clips/converts in bands. Retention refusal
returns the existing memory notice instead of advertising an absent GPU source.
No ceiling, reserve, cache share, working minimum, VRAM rate or budget changed.

Overlapping native proxy/peak/tile requests also share one weakly held scene
read while those requests own it. The final request releases its decoded pixels;
this adds no resident scene cache or allowance.

### November 3, 2026 - Batch 3g: monitor isolation

Grade publishes retained source bytes when activating, redeveloping, editing
repairs, replacing interpretation or clearing its session. Both the HTTP memory
reader and grant census read published values without the Grade lock. The memory
endpoint shares one pending sample and serves the latest completed sample; slow
work cannot accumulate queued polls. A first sample has a bounded 500 ms wait.
`memory_endpoint` records queue/run time only above 250 ms. Desktop awaits are
bounded, renderer collections coalesce, and a renderer timeout still allows
backend reclamation and later polling. Accounting, levels and budgets are unchanged.

### November 3, 2026 - Batch 3g: request-loop spills

The audited live-developed acceptance already runs inside adapter.developed on
a worker. The actual inline spill sites were cached live-scene acceptance,
CPU pending scene acceptance, and picture/native/overlay helper acceptance;
these now run sequentially on workers with the existing source validation.
Native-upload buffer lookup also leaves the loop (it takes the upload lock),
as do large receive-buffer allocation/copies. Finished-thumbnail joins remain.
A 100 ms heartbeat logs only delays above 250 ms and active Library routes;
those routes are candidates, not proof of which request blocked the loop.

Other async operations still worth measuring: source-path/owner/status locks,
RAW metadata under the raw-browsing condition, and small response/header JSON
construction. Broader handler/lock restructuring is deferred. Finished-thumbnail
`too_long` is a validation error: its request uses MetadataRequest's maximum
path count, not a time measurement. This batch does not change that limit.

### November 3, 2026 - Batch 3g: memory diagnostics

The existing five-second app_memory log now includes Windows PrivateUsage as
`privateBytes` beside each process working set. These fields do not enter the
budget calculation. Electron metric rows label main-window,
hidden-gpu-delivery-window and other. Backend telemetry includes its PID and
Python allocated-block count. Optional `HDR_FINISHER_TRACE_ALLOCATIONS=1`
collects live/peak traced Python and NumPy bytes using one tracing frame;
reading the counters is constant-cost, but allocation tracing itself has
overhead, so normal app sessions leave it disabled. It excludes native
allocations outside Python/NumPy's tracing hooks and allocations made before
tracing started; it is not a complete native-heap census.

`tools/trim-backend-working-set.py --pid PID` is a standalone Windows diagnostic.
It verifies that the selected process is Python, samples working set/private
bytes, trims that process only, and samples immediately and 500 ms later.
It is never part of memory control. The plain-Electron quick-check flag
`--memory-diagnostic --folder=library-live-grid` runs Grade edit/return/F/Compare,
observes 60 seconds idle and invokes this script. Normal quick-check acceptance
and its limits are unchanged; diagnostic display timeouts are recorded while
continuing to collect idle/trim evidence.

Retouch framed uploads now use the same worker-copy receiver, and RAW source
framing runs on a worker too. Remaining request-loop candidates include chunked
bodies without a declared length, source-path and owner/status locks, RAW metadata
under its condition, and small JSON responses.
They have not been established as multi-second stalls by this batch's heartbeat;
finished-thumbnail joining is deliberately unchanged.

The one diagnostic session completed on three existing test RAW copies, with
allocation tracing enabled. Figures below are decimal MB, not budget charges:

| Backend point | Working set | Private commit | Traced live heap | Published Grade source |
| --- | ---: | ---: | ---: | ---: |
| Before Grade | 161 | 541 | 23 | 0 |
| Grade loaded | 1,242 | 2,024 | 581 | 509 |
| After leaving Grade | 710 | 1,461 | 559 | 509 |
| After 60 seconds idle | 711 | 1,462 | 560 | 509 |
| After trim (500 ms) | 62 | 1,462 | about 560 | 509 |
| After explicitly closing Grade | 123 | 952 | 52 | 0 |

The trim's immediate working set was 10 MB; it rebounded to 62 MB at 500 ms
and 65 MB in the next endpoint sample. Private commit did not change. This
shows reclaimable residency, not proof that those pages were all freed: Windows
can trim live pages too. The retained 509 MB source is genuinely live after
leaving Grade. Explicit close removes it from both private commit and traced
live heap. The remainder of private commit includes untraced native allocations
and possibly allocator-held memory; this run cannot separate them. No Grade
release change or automatic working-set trim is introduced.

The five-second Electron metric maxima were main-window PID 48452: 625 MB;
hidden-gpu-delivery-window PID 13144: 118 MB. The main window was the larger
Tab, but the reported 2 GB Tab and extra 2-3 GB backend did not reproduce in
this small workload. Whole-app charged peak was 3.187 GB, with no memory
violation. Full screen did issue foreground development for the graded
DSC07060.ARW, reason "selected photo"; the quick thumbnail appeared in 4.1 ms
and sharp draw was published after 2.724 s. The scenario navigated away before
the final physical-presentation event, so that is not a complete visible-sharp
timing. Full-screen/Grade-return fixes remain Batch 3h work.

No event_loop_lag, memory_endpoint, memory_controller_error or
chromium_pressure_error occurred in this session or the clean retry,
double-rejection and native RAW checks. Controlled fast tests separately prove
that a held Grade lock and a blocked cache acceptance do not block memory
polling, and that stuck renderer collection is bounded and coalesced. This
supports the specific fixes; it does not rule out every possible future stall.

Evidence: codebase/output/batch3g/diagnostic-summary.json and
codebase/output/quick-library-check/batch3g-diagnostic/{report,scenario,trim}.json,
backend.log, electron.log and memory.jsonl. Final fast suites: 768 JavaScript
passed; 3,023 Python passed, 3 skipped, zero failures. The final framing follow-up
also passed its 44 affected Python checks. The clean retry and native RAW checks
pass; the forced double rejection still fails later CPU preparation as expected
(6.138 GB logged peak), deferred to the bounded-memory CPU work. No budget,
limit, level, pixel tolerance or saved format changes. Output started and ended
at 28.6 GB (100 GB limit); owned profiles and temporary scratch were removed.

### November 4: camera-picture admission and delivery collection

SubIFD JPEG previews in TIFF-based RAWs are sized from their header-only
DCT sample dimensions using the existing quick rate/minimum and actual
requested edge. No-preview files retain their previous estimate. The DxO
8020 x 5304 fixture asks for 64 MB at grid size, 244.6 MB at screen size,
instead of 978.4 MB. No budget, priority or Grade-retention decision changed.

Waiting-photo collection/reclaim and pressure cleanup now reach the hidden
GPU delivery window; completed jobs schedule one debounced idle GC. **Open:**
GC cannot release 1,186,913,280 bytes still referenced by the paused delivery
async loop (one input and three output ArrayBuffers). After a real Grade
handoff, private commit only changes 1,230,790,656 -> 1,230,544,896 bytes.
Do not mark prompt hidden-memory release complete. The focused Grade run
still exceeds memory acceptance; the standard 90-second grid passes.
Details and evidence: `../../technical/archive/briefs/library-thumbnail-memory-stall-2026-11-04.md`.

Validation note: 801 JS passed; Python 3,053 passed / three skipped / one
unrelated failed PNG remembered-error route test (expected 422, received
200). Left unchanged. Output and numeric evidence remain in the open brief.

### November 5: completed delivery-job storage is released promptly

The delivery renderer now runs each job in a separate async frame, ending
all local input/output/upload references before it waits for the next job.
This closes the live-buffer follow-up above; success, failure and cancellation
use the same boundary for every operation. Existing pressure/waiting-photo
collection and the 250 ms idle collector remain. Keep idle collection: freeing
references allows it to work, but does not guarantee spontaneous collection
within the required two seconds. No ceiling, priority, Grade retention, GPU
budget, order or pixel computation changed.

Acceptance is private commit within 200 MB of pre-job idle within two seconds.
The real 42 MP Grade job starts at 42,119,168 bytes, peaks at 1,744,891,904,
and returns to 42,594,304 at 2,005 ms (0.475 MB above idle). The old loop still
held 1,230,323,712 bytes at two seconds. The new heap snapshot contains none
of its former 1,186,913,280 bytes of photo backing stores. The broader Grade
processing peak remains above whole-app acceptance and is separate.
Review, checks and evidence: `../../technical/archive/briefs/library-thumbnail-memory-stall-2026-11-04.md`.
Validation: 802 JS passed; Python 3,053 passed / three skipped / the same
unrelated remembered-PNG 422/200 failure. Fifteen delivery lifetime cases pass.
Real 42 MP export/Proof match the unchanged-code baseline exactly; per-job
GPU timing changes +2.42% / -2.58% meet 5%. Standard Library check passes;
focused Grade processing peak remains separate. Output 29.2 GB; no push.
