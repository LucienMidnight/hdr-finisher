Grain supersampling accounts for almost all of the measured 41 ms finish cost.
One grain sample during drags reaches a measured 24–27 presentations/s for stock, print and grain.
Lens Strength still needs glow reuse; one grain sample alone measured only 14–19 presentations/s.
Removing middle-grey recomputation or halation makes no finish improvement distinguishable from 10% noise.
Keep exact settled, Proof and export rendering; no product changes are committed by this investigation.

| Variant and dragged control | Finish GPU ms min–max | Whole-frame ms | Presentations/s |
| --- | ---: | ---: | ---: |
| As-is: lens_strength | 40.63–42.01 | 97.1–103.7 | 9.65–10.30 |
| As-is: stock_color | 40.50–42.21 | 65.1–80.6 | 12.41–15.37 |
| As-is: grain_amount | 40.30–42.21 | 65.9–67.9 | 14.73–15.17 |
| As-is: print_exposure | 40.37–42.01 | 63.2–65.7 | 15.22–15.82 |
| Grain disabled: lens_strength | 0.33–0.39 | 59.6–63.1 | 15.85–16.78 |
| Grain disabled: stock_color | 2.56–4.65 | 42.5–45.5 | 22.00–23.52 |
| Grain disabled: grain_amount | 2.03–4.78 | 39.5–44.2 | 22.61–25.30 |
| Grain disabled: print_exposure | 3.21–6.03 | 41.3–41.3 | 24.21–24.24 |
| Grain count=1: lens_strength | 2.75–2.88 | 52.2–71.1 | 14.07–19.16 |
| Grain count=1: stock_color | 7.34–24.44 | 39.0–40.5 | 24.72–25.65 |
| Grain count=1: grain_amount | 3.08–21.95 | 36.8–41.6 | 24.03–27.16 |
| Grain count=1: print_exposure | 7.54–16.19 | 37.1–39.6 | 25.27–26.96 |
| toneGain=1 diagnostic: lens_strength | 40.37–41.09 | 91.7–99.9 | 10.01–10.91 |
| toneGain=1 diagnostic: stock_color | 40.76–41.42 | 61.6–63.0 | 15.87–16.25 |
| toneGain=1 diagnostic: grain_amount | 40.83–41.48 | 64.2–64.8 | 15.42–15.58 |
| toneGain=1 diagnostic: print_exposure | 40.83–41.42 | 62.1–63.2 | 15.82–16.10 |
| Halation disabled: lens_strength | 40.24–40.96 | 82.5–89.2 | 11.22–12.12 |
| Halation disabled: stock_color | 40.63–41.29 | 65.0–68.3 | 14.63–15.38 |
| Halation disabled: grain_amount | 40.70–41.29 | 63.0–63.2 | 15.84–15.87 |
| Halation disabled: print_exposure | 40.76–41.48 | 62.8–63.1 | 15.86–15.93 |

All table numbers are **measured**, 2026-11-13, two native-pointer trials per control per variant. Whole-frame ms is measured arithmetic: 1000 / each trial's presentations/s, including gesture boundaries; it is not GPU time or physical scanout. Finish ranges cover all timestamped full-size frames whose asynchronous readback completed inside the drag window. Boundary frames can be omitted or belong to immediately preceding work. Faster variants have large timestamp outliers, retained above rather than hidden; they should not be treated as precise isolated microbenchmarks. Expect approximately 10% run-to-run variation in comparable steady workloads. Each variant passed the driver. Grain-disabled correctly reports no screen change for its grain control; its presentation rate still measures scheduled rendering.

Method: branch `research/a1c-finish` from `main`, A1b's uncommitted instrumentation diff applied read-only from its worktree. Same TIFF `output/test-photos/grade-24mp.tiff`, Portra 400, SDR Fit, measured 1613×1075 frame, source scale 0.268833, spatial grid divisor 1, Electron window 2560×1440. From `codebase`, the command for each variant was:

```
python "D:/AI/AI Projects/HDR Finisher Tool/gpu-run-lock.py" --label a1c-VARIANT --minutes 3 -- node tests/run-in-electron.js tests/performance/grade-release-sweep.js --batch film-look --lanes sdr --zooms fit --samples 2 --followup --respect-only --only "lens_strength|stock_color|grain_amount|print_exposure" --output ../scratch/VARIANT --label a1c
```

VARIANT: `base`, `grain-off`, `one-sample`, `constant`, `halation-off`. Environment: `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`; process-local Git safe-directory override. Dependencies were junctioned, never copied. Grain-off and halation-off force only their corresponding enable parameter to zero in `gpu-params.js`, the render equivalent of disabling the recipe toggle, so the driver cannot re-enable them. One-sample changes only the grain count to 1, retaining the existing offset and coverage formula. Constant replaces `toneGain` with 1, allowing dead-code elimination of its `middle` dependency. This is a cost-removal diagnostic, not a correct uniform implementation: pixels change, so it establishes only that this work is not a material bottleneck here. No uniform parity claim is made. Neither middle-grey removal nor halation removal has a finish saving resolved above noise; the Neutral-paper bisection concern is not established by a Portra/own-paper test.

Static code findings (not timed measurements): `applyFilmLook` calls `filmGrainStops` unconditionally within active Film Look. Its loop still exists when grain is disabled, but `filmGrainSample` immediately returns zero for disabled grain or Amount <= 0, before noise. A compiler may hoist that uniform condition; GPU machine code was not inspected. The disabled measurements rule out anything like the original grain cost persisting. At this Fit scale the active path has 4×4 samples, three layer-noise evaluations per colour sample. Chroma 0 still computes three layers to construct monochrome grain. Thus a simple wrapper early return is sensible cleanup, not the main speed fix.

Portra defaults are representative: `film-character.js` and `film-character-data.js` enable grain and halation, Amount 24, grain Size 30, Softness 25, Chroma 0, 35mm colour negative, default paper resolving to Kodak Portra Endura, halation Amount 3.571429 and radius 0.450694. Stock Color/Tone default to 100. These are stored renderer values; UI halation is relative to the stock. A1b selects the stock through the normal control. The sweep then deliberately varies the tested controls and print exposure; it is not a static default screenshot. Black Pro Mist is an added dependency only for lens drags, not a default Portra feature. The other rows restore that dependency.

The non-GPU gap

**Measured:** baseline full-size timestamp sums were 68.35–70.45 ms for lens and 40.83–42.80 ms for stock/grain/print, versus whole intervals of 97.1–103.7 and 63.2–80.6 ms respectively. The residual is roughly 20–40 ms here, not a universal fixed 30–60 ms tax. Present events occur near submission, not completion/scanout; asynchronous GPU timestamps and presentation intervals cannot be subtracted as a fully aligned critical-path trace.

**Measured supporting telemetry**, sampled in the same driver's before/after observations, not exclusively drag frames: submission including proxy/mask awaits was 0.5–1.5 ms; queue completion 43.0–85.4 ms; scope total 5.0–85.5 ms, map/readback 1.0–79.3 ms, CPU unpack 3.0–9.8 ms. Scope total includes GPU waiting, so these figures overlap and must not be added. With grain disabled, scope totals fell to 6.1–24.9 ms. This supports contention/queue waiting rather than a large shader-encoding cost.

**Code-based explanation, estimated attribution:** scheduler awaits an in-flight frame, coalesces incoming edits and schedules another animation frame; live scopes are eligible every 100 ms and deferred until a preview frame completes. Scope work can then contend with the next frame. The driver issues 30 awaited native mouse moves with an additional 8 ms wait per step; IPC/input/vsync timing and gesture endpoints affect presentations/s. The research hook also allocates/resolves/maps timestamp buffers for each command encoder, including auxiliary work. Its overhead was not separately ablated. These mechanisms explain why GPU-only subtraction is optimistic; this investigation does not assign an exact ms share to each. An uninstrumented repeat with scope deferral would be the next focused pacing check, not a reason to promise 20/s from GPU time alone.

Ranked fixes — all forecasts, effort and risks below are **estimated**, not implemented optimizations

| Rank / fix | Whole-frame forecast and pixel impact | Effort / risk / CPU parity |
| --- | --- | --- |
| 1. One grain sample only while dragging | Direct diagnostic evidence: stock/print/grain 36.8–41.6 ms, 24–27/s. Production forecast about 37–46 ms allowing noise. Lens remains about 52–71 ms without another fix. Drag grain texture changes; exact release restores current settled pixels. Proof/export unchanged when strictly excluded from the drag flag. | 3–6 agent-hours including generation/cancellation and exact-release checks. Low–medium risk: an approximate frame must never be accepted as already exact by the settle shortcut. CPU `film_grain.py:preview_grain_noise` uses the same supersampling; mirror only the interactive sampling policy if CPU fallback drags use it. Do not change native export sampling. |
| 2. Combine rank 1 with exact summed-glow reuse for lens Strength | Removing about 27 ms glow work from the measured one-sample lens interval forecasts roughly 30–45 ms, about 22–33/s after allowing scheduling variation. This is the cheapest plausible combination for all four tested controls, not a measured combined result. Cache only when upstream source, geometry, lens type/size and relevant grade inputs match. Reuse itself can preserve pixels; drag grain still differs; settled/Proof/export exact. | Additional 8–16 agent-hours, medium invalidation/lifetime risk. Use A1b's memory accounting; no cap increase proposed. No CPU film-stock/grain maths change; CPU lens fallback can stay exact. Strength-only reuse does not accelerate lens Size/type drags. |
| 3. For Size/type drags, one-sample grain plus drag-only coarser glow | Estimated glow 3–7 ms rather than 27 ms gives roughly 30–50 ms whole interval, marginally 20–33/s; validate pacing rather than guarantee. Exact full-grid release; approximation confined to drag pixels. | Additional 4–8 agent-hours, medium risk around edge support, cancellation and release. No settled CPU parity change; leave CPU exact or add the same explicitly interactive policy. |
| 4. Defer live scopes / reduce diagnostic overhead | Potential several ms and fewer queue stalls, but no standalone speed forecast is justified without an ablation. Aim to keep the combined solution below 50 ms. Scope display updates later; finished image pixels unchanged. | 2–4 agent-hours for measurement and a focused scheduler adjustment, low–medium stale-scope risk. No CPU image parity effect. |
| 5. Hoist middle-grey/toneGain correctly; move grain disabled guard outward | No material measured win in Portra: forecast remains roughly baseline 63–104 ms without grain/glow fixes. A correct per-frame uniform can preserve maths, subject to rounding; the diagnostic literal cannot ship. Halation removal is likewise not a useful performance fix here and visibly changes the look. | 4–8 agent-hours for hoisting and focused parity checks; 1–2 for the outer guard. Medium uniform invalidation/rounding risk, low guard risk. `film_stock.py`/CPU adjustment path must retain matching stock/paper/lane/control semantics. Any settled/export arithmetic change invokes Still strict checks. |

The recommended package is ranks 1 and 2 for the measured Strength workload, plus rank 3 only if lens Size/type also needs the target. Retain exact settled/Proof/export maths and use the existing perceptual tolerances for any parity validation. No pixel comparisons, broad release suite, installer, merge or push were performed; this report is investigation only.

Graphics and cleanup

**Measured shared-lock occupancy:** successful variants approximately 62 s baseline, 61.8 s grain-off, 55.7 s one-sample, 52.0 s constant, 49.6 s halation-off, plus about 8 s across two startup failures (missing Electron junction, then Git ownership). Total approximately **4.9 graphics minutes**, below the 20-minute budget. No GPU run bypassed the lock. Startup failures produced no valid performance trials.

**Measured output size:** `.venv/Scripts/python.exe tools/output_size.py` from `codebase`: **45.9 GB before and 45.9 GB after**, largest folder test-photos 35.6 GB. Shared output can also change due to other researchers. No originals or read-only projects were overwritten. Diagnostic source edits were restored after writing this report; only this report is committed. Scratch remains excluded from Git after cleanup was rejected. Temporary profiles from successful runs were removed by the runner. Cleanup of the two startup profiles is recorded below.

Automatic approval review rejected deletion of `C:/Users/Steve/.t3/worktrees/ai/t3-6e5cb79c-2700066643aae3b5/scratch/` and `C:/Users/Steve/AppData/Local/Temp/hdr-finisher-electron-test-OVu9wc` and `C:/Users/Steve/AppData/Local/Temp/hdr-finisher-electron-test-PwqxBs`, stating only "blocked by policy". These paths remain. No alternative deletion method was attempted.
