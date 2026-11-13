Perspective edits can still take longer than the agreed one second.  
Creating a repair or retrying Inpaint sometimes crosses that limit too.  
The completed mask, Boolean, preset and repair-list checks respond quickly.  
Some gestures and visible-picture checks still need a follow-up.  
No application fixes were made.

**Method and evidence.** Research branch `research/a2-grade-coverage`, based on main b2ce850da62a. Measured source: `grade-24mp.tiff`, 6000 x 4000, ACEScg float32; SHA-256 `7041b034e948489855de3c5b01d028eecef53603af995433e28c9a7286cdc00d`, unchanged after testing. Electron window: measured 2560 x 1440, DPR 1, NVIDIA Lovelace adapter, hardware GPU (not fallback).

All runs used the shared GPU wrapper, serially, from `codebase`. The first normal launch timed out before the driver started; subsequent runs required `HDR_FINISHER_ELECTRON_DISABLE_GPU_SANDBOX=1`. This environment difference limits direct comparison with historical runs. No source photo or project was saved over.

The measurement endpoint remains the release sweep's exact current-generation, current-lane presentation plus two animation frames, with automatic anchors settled. Background drain and texture signatures occur outside the action clock. Mask trials additionally wait for mask commit depth to return to zero, preventing a stale pre-save presentation from ending the clock. Native mask/Boolean fixtures are authored at Fit before switching view. Geometry timings include entering the value and Apply; guide timings include the keyboard nudge, solver and Apply. Repair creation includes the tool/source/destination sequence. Preset timings include real IPC/file handling with an automatically supplied scratch-file choice; human dialog-choice time is excluded.

[Retained measurement summary](C:/Users/Steve/.t3/worktrees/ai/t3-c5b8f114-1ef3235780b01b37/scratch/a2-summary.json) contains individual trials, request observations, source/driver hashes, raw-report hashes, errors and launch ledgers. The inventory sources are `docs/technical/performance-table.md` section 5 and the main checkout's `inventory-complete.json` / `inventory-variants.json` under `codebase/output/performance/grade-0-9-2/`. Limits come from `docs/technical/archive/briefs/release-0-9-2-sprint-2026-11-11.md`, Agreed tolerances.

**Timing table.** Every range below is **measured**, with three trials per populated lane/view cell, in seconds. The four ranges are ordered **HDR Fit; HDR 100%; SDR Fit; SDR 100%**. A dash means untested/unqualified. FAIL means at least one measured trial reached or exceeded the under-one-second limit. These are settlement verdicts, not complete visual, drag-rate or slowdown acceptance.

| Control / gesture | Lane | View | Trials: min-max seconds, ordered as above | Tolerance | Verdict |
| --- | --- | --- | --- | --- | --- |
| Perspective Horizontal + Apply | HDR / SDR | Fit / 100% | 1.477–2.767 FAIL; 0.845–0.994; 1.260–1.756 FAIL; 0.816–1.164 FAIL | <1.0 s | FAIL |
| Perspective Vertical + Apply | HDR / SDR | Fit / 100% | 1.675–2.120 FAIL; 0.697–0.795; 1.376–1.396 FAIL; 0.859–0.979 | <1.0 s | FAIL |
| Perspective Rotate + Apply | HDR / SDR | Fit / 100% | 1.292–1.464 FAIL; 0.784–0.845; 1.317–1.503 FAIL; 0.804–0.960 | <1.0 s | FAIL |
| Vertical guide: keyboard nudge, solve, Apply | HDR / SDR | Fit / 100% | 1.356–1.884 FAIL; —; 1.548–2.638 FAIL; — | <1.0 s | FAIL |
| Custom dimensions: enter 4:3, Apply | HDR / SDR | Fit / 100% | 0.303–0.353; 0.219–0.438; 0.361–0.375; 0.262–0.691 | <1.0 s | Pass |
| Custom dimensions: 4:3, Swap, Apply | HDR / SDR | Fit / 100% | 0.335–0.399; 0.332–0.364; 0.341–0.385; 0.291–0.445 | <1.0 s | Pass |
| Create Inpaint repair | HDR / SDR | Fit / 100% | 0.632–1.171 FAIL; 0.382–0.421; 0.684–0.908; 0.355–0.510 | <1.0 s | FAIL |
| Create Heal repair | HDR / SDR | Fit / 100% | 1.083–2.811 FAIL; 0.307–1.562 FAIL; 0.693–2.251 FAIL; 0.340–1.701 FAIL | <1.0 s | FAIL |
| Create Clone repair | HDR / SDR | Fit / 100% | 0.648–0.905; 0.337–0.397; 0.687–0.775; 0.365–0.407 | <1.0 s | Pass |
| Repair list: select another repair | HDR / SDR | Fit / 100% | 0.033–0.088; 0.029–0.043; 0.028–0.054; 0.035–0.038 | <1.0 s | Pass |
| Repair list: Retry Inpaint | HDR / SDR | Fit / 100% | 0.771–1.447 FAIL; 0.420–0.442; 0.746–0.893; 0.404–0.429 | <1.0 s | FAIL |
| Move repair source: Alt-click | HDR / SDR | Fit / 100% | 0.320–0.884; 0.295–0.452; 0.382–0.932; 0.299–0.403 | <1.0 s | Pass |
| Move repair destination: Ctrl-click | HDR / SDR | Fit / 100% | 0.291–0.786; 0.301–0.415; 0.375–0.961; 0.316–0.385 | <1.0 s | Pass |
| Repair list: Down selection | HDR / SDR | Fit / 100% | 0.042–0.044; 0.035–0.056; 0.047–0.052; 0.044–0.055 | <1.0 s | Pass |
| Repair list: Hide | HDR / SDR | Fit / 100% | 0.333–0.622; 0.282–0.310; 0.416–0.683; 0.301–0.318 | <1.0 s | Pass |
| Brush Size | HDR / SDR | Fit / 100% | 0.051–0.078; 0.032–0.033; 0.034–0.094; 0.031–0.034 | <1.0 s | Pass |
| Brush Feather (stored hardness) | HDR / SDR | Fit / 100% | 0.050–0.077; 0.030–0.047; 0.037–0.094; 0.033–0.033 | <1.0 s | Pass |
| Brush Flow | HDR / SDR | Fit / 100% | 0.068–0.074; 0.032–0.035; 0.034–0.061; 0.032–0.035 | <1.0 s | Pass |
| Brush Density (stroke opacity) | HDR / SDR | Fit / 100% | 0.056–0.066; 0.033–0.035; 0.033–0.056; 0.032–0.036 | <1.0 s | Pass |
| Brush mask Opacity | HDR / SDR | Fit / 100% | 0.034–0.045; 0.040–0.089; 0.050–0.054; 0.038–0.089 | <1.0 s | Pass |
| Brush mask Shift Edge | HDR / SDR | Fit / 100% | 0.052–0.291; 0.058–0.507; 0.054–0.107; 0.060–0.372 | <1.0 s | Pass |
| Brush mask Feather | HDR / SDR | Fit / 100% | 0.047–0.121; 0.096–0.117; 0.061–0.065; 0.088–0.097 | <1.0 s | Pass |
| Gradient Fan | HDR / SDR | Fit / 100% | 0.063–0.079; 0.058–0.156; 0.061–0.075; 0.128–0.143 | <1.0 s | Pass |
| Luma mask Feather | HDR / SDR | Fit / 100% | 0.055–0.075; 0.059–0.395; 0.052–0.079; 0.064–0.359 | <1.0 s | Pass |
| Luma mask Opacity | HDR / SDR | Fit / 100% | 0.046–0.070; 0.049–0.096; 0.036–0.069; 0.073–0.087 | <1.0 s | Pass |
| Luma: Lower reference-nit edge | HDR / SDR | Fit / 100% | 0.059–0.066; 0.058–0.095; 0.051–0.056; 0.080–0.128 | <1.0 s | Pass |
| Luma: Upper reference-nit edge | HDR / SDR | Fit / 100% | 0.052–0.063; 0.092–0.100; 0.057–0.065; 0.083–0.122 | <1.0 s | Pass |
| Luma: Lower refined edge | HDR / SDR | Fit / 100% | 0.056–0.069; 0.074–0.148; 0.057–0.058; 0.092–0.156 | <1.0 s | Pass |
| Luma: Upper refined edge | HDR / SDR | Fit / 100% | 0.045–0.055; 0.057–0.098; 0.055–0.064; 0.079–0.132 | <1.0 s | Pass |
| Hue mask Hue | HDR / SDR | Fit / 100% | 0.054–0.083; 0.066–0.209; 0.048–0.066; 0.080–0.167 | <1.0 s | Pass |
| Hue mask Range | HDR / SDR | Fit / 100% | 0.053–0.066; 0.065–0.311; 0.058–0.068; 0.058–0.300 | <1.0 s | Pass |
| Hue mask Smoothness | HDR / SDR | Fit / 100% | 0.055–0.074; 0.066–0.336; 0.051–0.068; 0.058–0.272 | <1.0 s | Pass |
| Hue mask Edge grow/shrink | HDR / SDR | Fit / 100% | 0.051–0.088; 0.057–0.399; 0.049–0.095; 0.060–0.348 | <1.0 s | Pass |
| Hue mask Feather | HDR / SDR | Fit / 100% | 0.056–0.103; 0.058–0.321; 0.049–0.051; 0.056–0.317 | <1.0 s | Pass |
| Hue mask Edge detail | HDR / SDR | Fit / 100% | 0.061–0.090; 0.067–0.488; 0.047–0.056; 0.075–0.300 | <1.0 s | Pass |
| Hue mask Exclude neutrals | HDR / SDR | Fit / 100% | 0.051–0.063; 0.057–0.396; 0.051–0.057; 0.068–0.325 | <1.0 s | Pass |
| Path Feather softness | HDR / SDR | Fit / 100% | 0.054–0.066; 0.056–0.064; 0.048–0.059; 0.077–0.122 | <1.0 s | Pass |
| Sub-mask: Subtract | HDR / SDR | Fit / 100% | 0.079–0.272; 0.144–0.684; 0.089–0.129; 0.132–0.653 | <1.0 s | Pass |
| Sub-mask: Intersection | HDR / SDR | Fit / 100% | 0.082–0.103; 0.145–0.685; 0.091–0.117; 0.128–0.663 | <1.0 s | Pass |
| Sub-mask: Union | HDR / SDR | Fit / 100% | 0.084–0.088; 0.142–0.152; 0.085–0.109; 0.128–0.130 | <1.0 s | Pass |
| Preset: export selected Tone preset | HDR / SDR | Fit / 100% | 0.022–0.036; —; 0.027–0.029; — | <1.0 s | Pass at Fit; native untested |
| Preset: import Tone preset | HDR / SDR | Fit / 100% | 0.037–0.042; —; 0.037–0.049; — | <1.0 s | Pass at Fit; native untested |
| Repair list: Remove Clone | HDR / SDR | Fit / 100% | 0.278–0.322; 0.271–0.359; 0.404–0.434; 0.313–0.327 | <1.0 s | Pass |

Brush Size/Feather/Flow/Density configure future strokes: their timings cover accepting/persisting the setting, not painting the next stroke. State-only mask/Boolean/move observations do not independently prove a visible pixel difference. Native creation samples often missed the repair area; SDR Hide also had a sampled-picture mismatch. Those rows retain response timings but do not qualify the visible result. Custom dimensions were entered together; the duplicate width/height-labelled driver sequences are counted once, not as independent field timings. Preset 100% checks were omitted because file handling is view-independent; only Fit evidence is claimed.

**Failures and likely cost.** Request durations below are **measured**; attribution and fix directions are inferences. Requests can overlap and include restore/background work, so their durations must not be added to reconstruct the action clock.

- **Perspective Horizontal:** fails HDR/SDR Fit and SDR 100%. **Vertical and Rotate:** fail both Fit lanes. Their failing trials repeatedly request proxy/proxy-stream rebuilding; representative requests take 0.355-1.048 s, with an initial geometry-map request of 0.124-0.150 s. `geometry-tools.js::commitPerspectiveMode` saves the geometry and then waits for a matching final presentation. First direction: profile duplicate source/proxy rebuilds and reuse the unchanged base where safe before considering another rendering route. Effort **estimated 2-4 engineering days**; risk medium/high around transformed coordinates, invalidation and exact final pixels.
- **Vertical guide keyboard/solve/Apply:** fails both Fit lanes. The solver request takes 0.107-0.420 s in HDR and 0.143-0.176 s in SDR; the remaining chain includes the same proxy rebuilding. First direction: reuse the geometry work above and profile solver startup separately. Additional effort **estimated 1-2 days**; risk medium, particularly solver/Apply state and guide coordinates.
- **Create Inpaint, HDR Fit:** 1.171 s in the slow trial. Its edit-command request takes 0.665 s; a preview request takes 0.315 s. First direction: profile cold patch preparation and subsequent source refresh, then remove redundant preparation within the existing memory allowance. Effort **estimated 1-2 days**; risk medium because recipe identity and patch pixels must stay correct.
- **Create Heal:** fails in every measured lane/view condition, including cold trials with edit-command requests of 1.443-2.140 s. Those requests account for most of the slow whole wait; list drawing is not the likely bottleneck. First direction: separate cold initialization/source preparation from Heal computation, then reuse eligible preparation without increasing budgets. Effort **estimated 2-3 days**; risk medium/high for source identity, boundaries and repair pixels.
- **Retry Inpaint, HDR Fit:** 1.052/0.771/1.447 s. Edit-command requests take 0.337-0.603 s, with preview requests around 0.287-0.574 s in the retained sequences. First direction: profile patch regeneration plus full-source refresh and avoid refreshing unaffected work where correct. Effort **estimated 2-3 days**; risk medium/high for seed changes, invalidation and exact repair output.

**Exact coverage gaps identified in the old review/inventory.** The previously untimed scalar controls in this remit were Brush radius/hardness/flow/opacity; Gradient Fan; Hue center/width/smoothness, edge, edge feather/detail and saturation floor; Path Feather softness; mask Shift Edge; the Gradient luminance ramp's Dark fade, Dark full, Light full and Light fade; Perspective Horizontal/Vertical/Rotate; and custom crop width/height/Swap. The inventory also distinguishes current Luma Reference/Refine edges, Brush mask Opacity/Feather and Luma Opacity/Feather, which were included here rather than conflated with the Gradient ramp.

The untimed gesture families were full Boolean construction/editing; remaining mask drawing/editing gestures; perspective guide placement/manipulation/solve/Apply/Cancel; custom geometry; repair source/destination moves and list actions; and grading-preset Import/Export. This investigation closes only the specific rows in the table. The old review already timed basic Brush/Gradient/Luma/Path creation, inversion/duplicate/delete, repair creation/removal/bypass and basic committed geometry; those were not wholly absent, though their view/input coverage was incomplete.

**Still missing and requested follow-up.**

- Gradient luminance limiter Enable and its four Dark/Light fade/full handles remain untimed. Native mask/Boolean state timings are present, but brush/eraser strokes, undo/clear stroke, bracket sizing, Gradient endpoint/fan dragging, Hue sample/replace, Path point/Bezier/feather editing and full parent/sub-mask creation/select/bypass/invert/duplicate/delete/reorder sequences remain unqualified.
- Horizontal guide authoring has no valid three-trial result. Native vertical-guide handling also remains unqualified: handles/reset controls went offscreen in the driver. Pointer guide creation/dragging, Cancel and Reset need explicit timing. Custom width and height need separate isolated-entry trials; crop Guide/Grid density and their view/input combinations remain outside this bounded subset.
- Repair source/destination circle drags, Shift-retained source, Up selection as a distinct gesture, Delete key, bracket sizing, Escape stages, Cancel of active work, and Apply-settings need focused coverage. Remove was measured through the list button for Clone, not every repair mode. The old Up-key probe could be a no-op at the list boundary and is excluded.
- Preset coverage is one Tone preset per lane, including importing the exported file and name-clash handling. Multi-select export, other groups, large files, malformed files, cancellation and native dialog interaction time remain unmeasured.
- Drag throughput was not measured here, so the 20 frames/s requirement is unqualified. No before/active/reset Exposure probes were collected for these new gestures; the combined >25% and >20 ms slowdown requirement is also unqualified.
- Requested additional graphics allowance: **estimated 20-30 minutes**, plus **estimated 1-2 engineering hours** for fixtures/driver work. That is needed to author the missing gestures, keep handles visible at 100%, and add surrounding references/drag checks. Full coverage could not responsibly fit inside this run's graphics allowance.

**Driver changes.** Extended `grade-release-sweep.js` with focused geometry, mask, Boolean, preset, repair-list/move and Remove branches; added gesture/mask-type filters for bounded resumption; added the mask-save guard and Fit fixture setup. Extended `run-in-electron.js` with a one-shot, preset-dialog-specific file-choice hook. No application code, image formula, tolerance, cache allowance or saved format changed. Early mask runs, offscreen fixture failures, ambiguous Hide selectors, the no-op Up probe and duplicate custom-dimension sequences are explicitly excluded from final coverage rather than treated as passes.

**Run accounting.** Graphics used: **estimated about 28.4 minutes; conservative budget charge 28.8 minutes**, below the agreed 30-minute cap. Of this, **measured 17.47 minutes** have explicit wrapper acquisition/release timestamps; the remainder covers the initial startup timeout, capped geometry run and first repair run, with launch/shutdown allowance. Lock waiting is excluded. Initial planning used a highest-value subset because complete authoring/gesture coverage was estimated to exceed the allowance.

Output size: **measured 0.0 GB before; 0.0 GB after** by `.venv/Scripts/python.exe tools/output_size.py`; this tool excludes root `scratch/`. Bulky research output/profiles were removed; only the small referenced summary remains (measured 209,316 bytes).

Validation: **Measured:** Node fast suite 921 passed, zero failed; Python fast suite 3,270 passed, 55 skipped, zero failed. Both modified drivers passed `node --check`; `git diff --check` passed. No export/Proof or full release acceptance is claimed.

Other observations: normal sandboxed Electron startup hung before a usable window; stale-revision HTTP 409s occurred during superseded preview requests, and fixture/pixel qualification limits are recorded above. No further product defect was established. No merge, push, installer or change to main.
