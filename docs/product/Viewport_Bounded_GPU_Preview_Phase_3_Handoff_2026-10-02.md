# Next-thread prompt: Viewport-Bounded GPU Preview phase 3

Start phase 3 of the Viewport-Bounded GPU Preview work for HDR Finisher. Phases 0–2 are on the pushed branch `viewport-bounded-preview-phase-2-wip`; main does not contain them. Work on that branch or a new branch based on it. Do not start phase 4 or commit/push without asking me.

Read first, in order:
1. `ai/docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`: sections 4, 5.4, 5.6, 6, 7 and 10; phase 1 record 12, especially 12.3–12.6; phase 2 record 13, especially 13.4. The opening status is current; earlier measurements are historical.
2. `ai/docs/technical/architecture.md`, including “Masks and magnified views” and bounded peak measurement.
3. `ai/codebase/tests/performance/README.md`, “Viewport-Bounded GPU Preview”. Read applicable AGENTS.md files too.

Phase 3 scope is the PRD's remaining GPU work: mask rasterization/feathering, Match candidate evaluation, local/global control gaps, navigation thumbnail and scopes, and Detail agreement. The CPU remains the simple export/Proof reference and fallback. Do not add whole-image native CPU work to the edit loop or use phase 4 cleanup as a reason to expand scope.

Before building, inspect and report the remaining paths, propose a staged order, and measure which Detail stage diverges before changing either implementation (5.6). Explain decisions plainly; I am not a coder. Start with a short actionable report. Ask each required decision by itself with its tradeoff. If the PRD conflicts with the code, stop and ask. Continue routine work autonomously within the agreed scope.

Carry forward these facts and constraints:

- Keep the 1% editing peak/anchor limit. Phase 2 uses an import-time bounded source candidate list, GPU ranking and bounded native patches/masks, separate analysis caches, and containing-region source reuse. Unsupported measurements are refused and labelled preview-only; do not silently restore whole-image measurement. Export/full-size Proof measure exactly, warn above 1% disagreement, and enforce the delivered peak ceiling. `tests/test_proof_export_identity.py` must keep passing.
- Phase 2 fixed the SDR anchor stage: SDR uses the prefix before display grading and locals; HDR uses the finished signal before output highlights. Preserve this accuracy design. Maximum peak errors on the fixtures are 0.0576–0.2532% low; four robust-anchor pairs are 0.1265–0.9104% high. These are fixture measurements, not a universal guarantee.
- Discrete zoom refinement starts immediately; continuous wheel/slider gestures retain 80 ms debounce. Keep cancellation/latest-state guards and exact-scope recovery. Fresh session zoom medians: primary phase 1 624 ms (26 zooms, one session), phase 2 216 ms (24, one); four-mask phase 1 134 ms (93, three sessions), phase 2 113 ms (29, one). Three alternating timer-only pairs support the improvement. Preserve these speeds.
- Scope settlement after edits can still be slower despite prompt pictures: HDR brush primary 231→430 ms and four-mask 174→328 ms. Session counts fall partly because drivers wait for scopes. Report picture timing separately from scope settlement.
- The primary brush can take the native foreground fallback after added strokes; with local Detail, zoom six seconds after a stroke still takes about 2.1–2.3 seconds. This is a pre-existing accepted phase 1 gap, now in phase 3. Brush/feather CPU costs, per-region luminance masks, and 50-local scaling remain relevant.
- Detail agreement is now in scope. The primary as-saved tone failure and four-mask HDR near-black outliers remain unresolved. Measure them; never widen section 4 tolerances. Export is the reference unless I decide otherwise.
- Leave the trial 3-level gradual-mask limit and existing larger-bitmap fallback as they are (12.5–12.6). Preserve the brush feather's painted-peak normalization and hard-edge placement requirements.
- Peak-reduction and Denoise shaders remain byte-hash pinned in `tests/webgpu-shaders.test.js`. Tell me before changing a pinned shader.
- Pre-existing failures: `test_frontend_inventory_contract.py`; Electron `brush-mask-interaction`, `path-mask-interaction`, `tiled-admission-scope-fallback`. Do not fix incidentally; tell me if a phase 3 change depends on one.

Backend: Python/NumPy in `ai/codebase/backend`; WebGPU frontend in `ai/codebase/frontend`; Electron shell in `ai/codebase/desktop`.

Fixtures are read-only; never save them:
- `D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher`
- `ai/codebase/local-test-media/viewport/DSC00264-four-masks.hdrfinisher`
- `DSC00264-fifty-locals.hdrfinisher` beside it.

Run Electron drivers through `tests/run-in-electron.js` with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`, one at a time, with no other HDR Finisher work running. Tools: `preview-export-compare.js`, `peak-readout-review.js`, `zoom-after-edit-review.js`, `heavy-project-long-session.js --fresh-work --minutes 5 --idle-minutes 0`, reduced with `summarize-viewport-baseline.js`. Comparison captures the route the app chooses; do not force it. Global Detail off isolates other changes; as-saved Detail must also be measured for phase 3's exit.

Phase 2 raw artifacts are local/ignored under `ai/codebase/output/performance/review/viewport-phase2-baseline-2026-10-01/`; they are not included in the push. Durable figures and provenance are in PRD 13.4. Rerun only the baselines relevant to each stage, report sample counts, and keep measured results separate from expectations. If a limit cannot be met, show the evidence and stop for my decision.
