# Prerelease remediation plan — October 24, 2026

Status: REVIEWED BY CLAUDE (October 24, 2026). Approved with the changes in "Claude review corrections" below; where they disagree with a later section, the corrections win. Planning only; no application/test changes, test execution, packaging, commits, or release certification performed for this review.

## Objective and evidence

Restore meaningful automated coverage, repair confirmed behavior defects, and resolve every finding from `output/prerelease-checks/2026-10-24-full/summary.md`. A green process exit is insufficient when the intended scenario did not run. Conversely, a diagnostic is not automatically a product defect.

Reviewed at HEAD `afffa1f448598fe62903868c48fb73e4ad2a1e73`, matching the sweep revision. Sources: the prerelease summary and grouped failures; authoritative release `summary.json` and `state.json`; final-attempt logs for all 80 failing drivers; supplemental packaged launch/coverage evidence; relevant driver, launcher, helper, runner, frontend/backend source; release README, module PRDs and known limitations. Proposed source investigations below are hypotheses unless explicitly identified as confirmed.

Baseline: 195 drivers = 115 passed + 78 new failures + 2 known failures; zero unfinished. Fast suites previously passed (590 Node; 2,480 Python, three skips). Package creation succeeded; packaged runtime navigation did not. Endurance and dynamic heavy-project checks passed. Protected projects retained their hashes. None of these results proves the 80 failing scenarios work.

All repository-relative paths below resolve from the `ai` Git root. Native evidence directory: `codebase/output/release-checks/2026-10-23T17-46-30-838Z-0f078ddbe72267236b05/`.

## Corrections to the initial report

1. **32, not 30, drivers fail on the undefined `importTestPattern`.** `slider-fill-anchoring.js` and `technical-panel-fit.js` print just the message and were categorized under other diagnostics. The existing helper is `tests/helpers/import-test-pattern.js`. Representative failing callers have no corresponding import. This is a confirmed harness defect; the underlying 32 scenarios remain untested.
2. **RAW paste zero-count behavior is intentional in the existing recipe.** `library-gpu-raw-paste.js` copies a grade and pastes the unchanged exposure back, explicitly asserting both counts are zero and no sidecars exist. Keep this no-op check. It does not cover an actual changed paste; add that separately and investigate the contradictory `grade_changed:true` metadata.
3. **Local Detail rapid-drag `finalValue:0` is expected.** The driver deliberately finishes at zero and asserts it. The concrete failing predicates include `orderedDifference:0` and `globalAndLocalDifference:0`; supported/finite and a coalesced render count alone do not establish correctness.
4. **Overlay-feedback's `state` error occurs on `desktop/starting.html`.** Its first diagnostic evaluates editor state before waiting for the editor. This is a confirmed launch-readiness race, not evidence of missing application state in the loaded editor.
5. **The missing packaged executable was superseded by a second failure.** After a successful unpacked build, initial navigation still timed out. Fixing a path or rebuilding alone does not close this issue.
6. **`budget-route` has real failed assertions.** Its final JSON reports Auto remaining tiled instead of Direct. The grouped first message (`pageErrors:[]`) is not the root failure.
7. **Proof peak warning is a contract failure separate from delivered-file identity.** The 6.5% error exceeds `peak_accuracy.py`'s existing 1% limit, while exact delivery measurements and the recorded Proof/export identity can still be correct.

## Claude review corrections (October 24, 2026)

Checked against HEAD `afffa1f`, the native logs and `state.json`. The 80-row inventory matches `state.json` exactly, and the confirmed claims checked (1% `EDITING_MEASUREMENT_LIMIT`, `starting.html` race, post-wait instrumentation in `run-in-electron.js`, fixed `.tmp` rename in `runner.cjs`, direct state mutation in the Local Detail test) hold. Changes:

1. **Hidden GPU delivery window breaks window-count assumptions (new shared cause; do first in H2).** `desktop/main.js` creates a hidden `gpu-delivery.html` window about 1 s after the main window loads. Drivers that wait for `app.windows().length === 2` (or `=== 1` after closing) now count it:
   - `desktop/tests/multi-window.js` (count wait, lines 18/58/78/85);
   - `desktop/tests/standalone-browser.js` (main + standalone Library + delivery = 3, so `=== 2` can stay false; likely its "Condition did not become true");
   - `tests/photo-library-navigation.js` (lines 134–156): main + delivery already equals 2 before the pop-out opens, so `popped` is undefined at line 136.
   Fix with one shared helper that lists user-visible windows (excluding the delivery window) and use it in all window-count/selection code, including `run-in-electron.js`. Do not hide or delay the delivery window in production to suit the tests. **`photo-library-navigation.js` moves from L1 to H2:** it is registered `launch.method: "native"`, so the L1 hypothesis about the `chromium.launch` adapter does not apply.
2. **H1 covers 36 files, not 32.** Four more call `importTestPattern` without importing it: `tests/lens-filter-tiled-parity.js` (full tier; passed only because the sweep supplied `--input`, so the fallback branch never ran), and diagnostic-tier `tests/performance/exact-tier-latency.js`, `tests/performance/many-local-layers.js`, `tests/performance/roi-parity.js`. Fix all 36 in the H1 batch. The four extras need no GPU rerun for this plan (`lens-filter-tiled-parity` already passed with its registered input; the others are diagnostic).
3. **R3 setup confirmed.** `webgpu-shader-compilation.js` changes `state.adjustments` with `Object.assign` and replaces `locals` with `splice` before reading pixels. Repair the test's edit route first, as planned. Also tighten its CPU parity comparison (free under "Tighten"): require equal GPU/CPU dimensions before comparing instead of comparing over `Math.min` of the two lengths. Do not replace its existing threshold with a new number without the usual tolerance proposal.
4. **U3 has no recorded design decision.** Neither `grade.md` nor any committed brief records the right-hand panel header becoming 86 px (smoke expects 54). The control-panel brief (now archived at `docs/technical/archive/briefs/codex-brief-control-panel-modes-2026-10-23.md`; Steve confirmed the work finished on October 28) says nothing about header height. Identify the commit that changed the height, then put it to Steve as one decision with a screenshot at 2560×1440: keep 86 px (update the smoke contract) or restore 54 px. Do not decide it from the code.
5. **Shared code for R/P (answer to review question 2).** R3 (only if production code changes), R4, R5, R6 and P1 all go through the GPU preview admission/coordinator and route-selection path. Treat any production change there as one batch with one coordinated strict validation matrix, not separate per-fix runs. P1 touches Proof, so "Still strict" applies. R1 (RAW edge-colour development) and R2 (HEIC SDR source) are separate source-decoding paths. R2 is strict only if its fix changes exported pixels.
6. **K1/K2.** K1 cannot be judged repairable before diagnosis; keep the plan's approach. For K2, present Steve one decision after he has seen matched Full/4K crops: (a) keep 1.25 and ship as a known limitation again, (b) accept a looser limit (about 1.30) because the difference is not visible, or (c) fund a lens-model change that alters the pinned reach. No change before his answer.
7. **The result ledger must prove each scenario ran.** A clean exit is not enough (`library-gpu-raw-paste.js` exited 0 having checked zero photos). For each previously failing driver, record its own final PASS line or result-file field, not just the exit code. If a driver has no final success marker, add one as part of its repair (a one-line `console.log` at the end, not a new framework).
8. **Time.** Re-running the 36 H1 callers plus the other repaired drivers will exceed 30 minutes. Give Steve the history-based estimate and wait for his yes before starting, as validation gate 4 already requires.

## Execution order and change boundaries

Recommended sequence: H1 → H2/H3 → U1/U2/U3 → L1/M1 → R1–R6/P1 → K1/K2 → A1/I1 → final qualification. These are dependency groups, not instructions to run GPU jobs concurrently. After harness repair, immediately prioritize any newly exposed delivery, invalid-pixel, or saved-state defect over cosmetic work.

Each implementation batch should be independently reversible and locally committed after its required checks. Keep one short commit note: changes, checks, failures and reason. Do not mix changing an expectation with changing the production behavior it is intended to protect. Record changed requirements/current behavior in the owning module PRD in the same implementation commit. This draft is the single working brief; do not create a fresh evidence document per batch. Archive it after outcomes are recorded in the modules.

### H1 — Restore fixture imports (32 failed drivers; first batch)

- Add explicit CommonJS imports from `./helpers/import-test-pattern` or `../helpers/import-test-pattern` as appropriate. Do not inject a global function from the launcher or restore the retired Import rail.
- Preserve the helper's normal byte import, HTTP failure handling, and session/import/workflow readiness checks. Confirm the fixture is appropriate for each original scenario rather than replacing every specialized source with one pattern.
- Check affected files for other unresolved setup symbols. A lightweight undefined-identifier check may prevent recurrence, but do not introduce source-snippet tests or require browser modules merely to lint them (drivers execute at import time).
- Acceptance: one root-level caller and one performance-directory caller reach their actual assertions through Electron. Then run the affected scenarios in planned groups; an import fix is not a pass for any caller whose later assertions have not run.

### H2 — Make desktop and packaged startup observable (7 failed drivers, including `photo-library-navigation`; start with review correction 1)

Targets: `tests/electron-initial-load.js`, `tests/run-in-electron.js`, native launch paths, and the H2 drivers in the inventory.

- Separate loading the startup page, identifying the main editor window, successful sidecar navigation, editor readiness, and Library readiness. Never read `state` before the editor is loaded. Wait for the Library start screen rather than visibility of the intentionally hidden `#empty-import-button`.
- Use the existing main-window selection logic as a starting point; exclude the GPU delivery window and re-check selection when the main page navigates. Do not accept a startup/error page as ready or swallow navigation failures.
- Install useful launch diagnostics **before** `waitForInitialLoad`: window IDs/URLs, main-frame failed loads, process exits, sidecar spawn/health details, and profile-local backend logs. Today much of `run-in-electron.js`'s main-event instrumentation is installed after the wait that fails.
- Packaged diagnosis: inspect the existing unpacked build with a disposable profile; record which page is waiting and whether the bundled backend starts. Check bundled resources, backend launch/path/cwd, health response, main-window ownership, and navigation continuation. Repair the demonstrated cause rather than lengthening the 180-second timeout. Rebuild the unpacked package only if its contents change; record the build revision to avoid stale-package evidence.
- For `standalone-browser`, inspect the failed condition and distinguish intended browser/desktop capability differences from a startup regression.
- Acceptance: desktop startup, intentional renderer crash/recovery, and two-window behavior still work; packaged launch reaches the editor/Library and the packaged baseline driver actually records its intended workload. Native packaged smoke is a separate requirement from successful pack creation and from development smoke.

### H3 — Remove environmental dependencies and diagnose response-body ownership (4 failed drivers)

- `pan-store-region-identity`: registry supplies no `--project`; `path.resolve('')` becomes the working directory and `manifest()` tries to hash it as a file (`EINVAL`). Supply an explicit protected read-only project via supported runner argument expansion or a disposable generated project, and validate `isFile()` before launching. Preserve exact region-byte identity and never save the protected project.
- `detail-cache-residency`: replace absolute temporary-file assumptions in `release/drivers.json` with deterministic fixture provisioning for all three native sizes (24 MP, 42 MP, 8K). Reuse the noisy TIFF builder where suitable, keeping inputs in disposable output and creating them before the driver runs. Check dimensions/content, not just file existence. Preserve tile/band cache and memory limits.
- `sdr-match-gpu-interaction`: record the actual fixture preparation response/exception and use the current supported import/session route. Preserve independent SDR state and GPU Match behavior; do not skip Match when setup fails.
- `native-region-stall`: identify owners of the unconsumed successful `/api/library/test-patterns` and `/api/library-worker/pause` bodies. Consume or explicitly cancel bodies in the responsible helper/production call. If the observer misattributes non-streaming traffic, fix its accounting with behavioral cases for unread, consumed, and cancelled bodies; do not simply exclude these URLs. Keep superseded source cleanup and native-region progress assertions.
- Acceptance: prerequisites work from a clean disposable profile/output; malformed/missing file arguments fail promptly with actionable errors; the intended workloads and leak checks run without depending on previous tests.

### U1/U2/U3 — Align UI drivers with approved product behavior (16 failed drivers)

**U1: Export controls (3).** `export-and-proof.md` explicitly records the October 24 preset heading menu and Advanced layout. Update old New preset/button/input flows to use that menu and open the relevant Advanced section before JPEG codec interactions. Assert saved preset settings and selected photos, not just visibility. Preserve output-version isolation, file grants, destination defaults, encoding settings, and actual export coverage. No pixel or ceiling expectation changes are authorized by a UI redesign.

**U2: Library rendering and controls (12).** Several drivers require old `canvas[data-kept]`, `img[data-picture-key]`, old `#filter-grade`, old pick `<select>`, or exact activity wording. Check each against the current `photo-library.md` and live renderer before changing it. Use current controls and behavior: matching photo identity, visible nonempty rendered pixels, overlays actually appearing, membership/selection/filter results, persisted marks, and request cancellation. Do not blindly exchange `img` for `canvas` or make hidden old nodes pass via forced clicks. In particular:

- Compare/virtual-copy display waits must prove the correct photo/copy is painted.
- Exposure/focus logs show prepared maps but hidden canvases: establish whether the correct view was activated or whether visible overlay compositing is broken.
- Stage A reaches its count check after finding a canvas; diagnose the `3001` count contract, broken-image filtering and scan completion. It is not solely an old selector failure. Preserve the four-live-request cap and first-visible-picture ordering.
- Stage C waits for twelve `img` nodes; preserve sort/filter/HDR-toggle/no-blank coverage on the current renderer.
- Appearance/navigation fails during fullscreen review and also contains a later retired `#filter-grade` use. Repair both only after proving review/read-ahead behavior on the current transport.
- Replace `undefined === false` measurement assertions with the current behavioral identity/invalidated-measurement contract; do not coerce missing data into a pass.
- Album membership checks should prove retained membership and discoverable UI, without pinning incidental prose. Keep durable-state assertions.

**U3: Desktop header geometry (1).** Smoke expects `[54,54]`, records `[54,86]`. Compare with the approved current Grade header design and the archived control-panel brief, `docs/technical/archive/briefs/codex-brief-control-panel-modes-2026-10-23.md` (context only; do not modify that user's draft). If 86 px is intentional, update the visual/layout behavior contract with justification and retain alignment, fit, toolbar and metadata-overlay checks. If not, fix the layout. Do not treat an exact geometric assertion as dispensable wording.

Acceptance: each driver reaches the intended user action and checks its outcome; failures that survive updated setup become production bugs. Module decisions, rather than convenience, decide whether code or expectation changes.

### L1 — Repair Library lifecycle, focus and command semantics (7 failed drivers; `photo-library-navigation` moved to H2)

Do not preclassify these as stale tests. Inspect `library.js`, picture/source/GPU transport modules, command routing, Grade session handoff, and `application-shell.js` as the evidence directs.

- `library-picture-startup` / `library-nonraw-picture`: existing observers target `/api/library/picture`; determine whether GPU-first routes replaced this request or whether visible preparation/worker pause ordering regressed. Observe actual selected-photo work with a deterministic gate, not a sleep. Preserve overlap, continuity while selection is unchanged, and correct pause/resume when Grade owns resources.
- `library-gpu-raw-single`: cached screen/native development succeeds before Single-view readiness times out. Trace selected path/key, accepted rendition/edge, resident keys, cancellation, and handoff from prepared RAW to visible draw. Keep neighbour reuse/native zoom coverage and no unnecessary CPU fallback.
- `photo-library-navigation`: launcher documents that multiple independent pages are unsupported under its `chromium.launch` adapter. Verify the registered launch mode and whether the popout exists outside that adapter. Use a supported native Electron route for real popout tests; preserve separate-window navigation and focus assertions.
- `library-smart-albums`: its helper waits for exactly 15,500 matches; inspect seeded dataset, preview request, count result, and modal state. Keep query correctness and responsiveness checks without relying on arbitrary arrival time or label formatting.
- `library-grade-paste`: text remains `normal text` instead of duplicating after Ctrl+V. Inspect clipboard setup, active element, and shortcut interception. Prove normal text paste is untouched in editable fields and photo-grade paste applies only in its proper context.
- `library-export-menu`: line 87 is the HDR peak option's visibility check after opening an enclosing details element. Check the new Advanced grouping and format-specific visibility before alleging a selection-menu bug. Preserve the option's false-by-default state and carried setting.
- `project-open-session-interaction`: trace the timed-out condition, old/new session IDs, pending Library work and delayed responses. Keep stale-session isolation, pause/drain, no old-photo error, and read-only project behavior.

Acceptance: deterministic positive and cancellation/late-result cases; visible photo identity and persisted outcomes are correct, with original concurrency and timing limits intact.

### M1 — Resolve mask/geometry interaction contracts (6 failed drivers)

- Gradient overlay button position: compare with current Grade requirements; test operable control plus intended placement/accessibility rather than resurrecting an obsolete layout.
- Luma sampled-before-gesture: Grade PRD explicitly states October 23's unused-until-range-edit-or-sample rule. Trace creation/default state, selection/render updates and first picker gesture; repair premature activation if reproduced. Keep unused conversion/discard and undo behavior.
- Invalid two-node Path: preserve cancellation on external interaction and ensure no invalid committed mask/history entry survives. Separate selected existing mask state from an active draft.
- Path smooth-node usability: waiting on `/edit-commands` times out. Check hit-testing, selected node and actual command/committed document. If no command is required for an already-smooth node, choose a nontrivial initial state rather than remove the intended commit assertion.
- Crop anchor/view tools: activate the correct workflow/section before clicking hidden geometry or local bypass controls. Then verify crop/source coordinates, mask alignment, bypass pixels, undo and lane behavior. The separately documented crop-reopening redesign is not implicitly part of this repair.
- Acceptance: intended current user behavior succeeds with real pointer/keyboard interactions; no forced hidden clicks, dropped persistence checks, or geometry tolerance changes.

### R1–R6 and P1 — Pixel correctness and preview admission

Treat these as high priority once the harness supports valid reproduction. Fix the rendering path demonstrated wrong; CPU is a fallback, not an exact universal oracle.

| ID | Failure | Investigation and required result |
| --- | --- | --- |
| R1 | `edge-colour-raw` invalid pixels | `library-gpu-raw.js:838` receives a rejection from storing developed planes; trace validation backward to the first nonfinite/out-of-range stage, including sensor decode, edge correction, colour conversion, reconstruction and packing. Capture stage dimensions, ranges and finite counts. Compare edge correction on/off and native/reduced paths. Repair the source of invalid values; do not clamp everything, bypass validation or silently return black. Reuse `gpu-edge-colour` as adjacent coverage. |
| R2 | `library-codec-source` HEIC SDR disagreement | Trace `example.heic` authored SDR/gain-map metadata and plane choice, reference white, transfer/primaries, orientation, and CPU/GPU source identity. HDR passes while SDR fails (mean 1.8657, p99.9 3.5497 in the existing comparison metric). Preserve independently authored SDR; do not substitute HDR tone mapping or raise the threshold. Validate existing ordinary SDR/PQ/HLG and other-codec controls. |
| R3 | Local Detail ordering/global-local invariance | First audit test setup: it creates locals through commands but subsequently mutates document arrays/global state directly. Establish accepted edit revision, enabled flags, cache keys, immutable inputs and nonempty matched readbacks. Use current command/state APIs if direct mutation bypasses invalidation. If valid edits still produce identical pixels, inspect stack order, parameter uploads, scratch-texture reuse and cache invalidation in `webgpu-preview.js`/shaders. Retain meaningful noncommutative overlapping-local and global-plus-local checks. Zero drag endpoint remains correct. Add a positive lower bound for actual drag presentation if needed; zero renders must not satisfy coalescing alone. |
| R4 | Lens parity compares 560×373 against 2400×1600 | Gate readback on the matching lane, geometry, edit generation, requested size and accepted render; distinguish stale/draft frame races from intentional admission reduction. A parity case must render equal domains and complete buffers before comparing. Do not resize one side to hide the failure or accept mismatched buffers. Then investigate any remaining pixel error with the existing guards. |
| R5 | Denoise drag `NaN` first-frame latency | `frames[0]` is absent, so this represents zero matching presentation events during the drag, not measured slow latency. Check observer/event contract and generation first, then coordinator admission/catch-up and cold setup if the stall is real. Persist trace/refusals even on failure. Preserve <1000 ms first frame, at least ten frames during sixty inputs, and at most one setup analysis. If unexplained timing exceeds tolerance, Steve tries the app before another timing run. |
| R6 | Auto budget remains tiled | Inspect actual adapter budget, Direct cost/admission reason, source dimensions and enabled passes. Either fix an incorrect route or provision a fixture that genuinely fits Direct within the unchanged real budget, then lower to 1 GiB to force tiled and restore Auto. Do not label tiled as Direct or increase budgets. Verify pixels and route ownership across the transition. |
| P1 | Proof editing peak estimate differs by 6.5% | Trace estimated and exact peak/anchor values for identical session, lane, revision, geometry, film/grain state, reference white and render size. Determine stale identity versus a systematically insufficient bounded estimate. Fix GPU-first estimate/identity as needed, keeping the existing 1% contract and exact delivery measurement. Add a behavioral assertion against structured warning/accuracy data to the current Proof check; status wording alone should not carry the guard. |

Acceptance common to R/P: nonempty finite pixel buffers of equal expected dimensions; correct photo/session/lane/edit identity; existing perceptual limits and exact requirements preserved; GPU and fallback behavior covered where touched. Do not introduce a new hard maximum per-pixel agreement metric. HDR output must remain under its compression target after encoding, allowing only encoder rounding.

Any previously agreed exact tiling/image guarantee remains exact until explicitly changed. If a new measurable comparison lacks a tolerance, record the proposed perceptual mean/high-percentile or timing tolerance and reason before measuring. A replacement for any existing agreed number requires Steve's decision; there is no implicit permission in this plan to relax one.

### K1/K2 — Close the two known release blockers

- **K1, Film Neutral maximum paper gain:** known extreme HDR preview/export divergence remains a failure. Investigate representable range, intermediate precision/overflow, film paper transform and delivery normalization under the actual GPU-first pipeline. Do not add an arbitrary highlight clamp or reduce the supported range to make the test pass. Any intentional output/range change needs a concrete technical proposal, impacted project/fixture list and Steve's decision before implementation. Run relevant Film/parity/Proof/export coverage after a repair.
- **K2, Pro-Mist tier consistency:** existing limit is 1.25; documented disagreement ratio is about 1.292. Prior analysis found no small repair preserving the bounded lens model and pinned reach. Produce matched Full/4K crops around bright hard edges using the established recipe and assess a real model fix. If the only viable resolution changes the pinned lens model or accepts a larger limit, present that specific decision to Steve with crops and consequences. Do not adopt the previously suggested 1.30 automatically. Keep known-failure signatures exact until verified repairs remove them.
- Acceptance: both guards pass their current contracts, or a separately approved requirement change is implemented and validated. A known label is never a waiver or READY result.

### A1 — Resolve the additional successful-run findings

1. **Phase 3's 27 flags:** inventory each row (26 CPU-mask, one whole-native-source). Trace request purpose/owner, size, whether awaited or superseded, geometry/lane and accepted-frame route. Distinguish an intentional bounded auxiliary request from avoidable CPU picture/mask work. In particular `saved/sdr` dominates mask flags and `saved/hdr` print-paper triggers whole-source fetch. Repair unnecessary work while retaining correctness; update the preview module with justified remaining fallback/auxiliary behavior. Do not equate a WebGPU route label with absence of CPU work. Re-run only implicated controls/states first, not the full audit.
2. **RAW paste:** preserve unchanged-paste zero-write coverage; add an actual nonzero exposure edit pasted to a second disposable RAW. Assert intended target count/path, changed setting, sidecar semantics, undo availability/restoration, and reuse of prepared GPU development. Explain or repair `grade_changed:true` on no-op results against the API contract.
3. **HSL 409 and budget release:** correlate request/session/generation and expected cancellation/conflict ownership. Expected superseded work may be diagnostic; an accepted edit must not fail, disappear, or force unexpected CPU delivery. Retain parity pass evidence. Add a targeted regression only for a demonstrated defect.
4. **Viewer 51.4 s outlier:** retain as an unexplained observation without an invented regression threshold. Inspect the saved trace for blocking work. Ask Steve to try Compare single/side-horizontal before spending a new timing run. Establish a justified tolerance before any subsequent timing experiment.
5. **Three pytest skips:** identify exact test names and conditions from pytest collection/markers or one future required fast run with skip reasons (`-ra`). Distinguish legitimate platform/capability skips from missing prerequisites. Do not rerun the complete suite solely to obtain the names now.
6. **Retired Bloom recipes:** review all candidates in release README, including excluded heavy-project-control-sweep and the still-used phase3 audit. Remove retired-only assertions or replace them with coverage of current controls where meaningful; preserve non-Bloom coverage. Keep inventory/README accurate and list removals in the commit. Do not restore removed Bloom settings or add pre-1.0 compatibility code.
7. **Generated fixture sidecars:** identify which drivers write beside repository fixtures and use disposable copies instead. Preserve existing user/untracked material; do not delete sidecars merely because the summary says generated. The four existing untracked paths are outside this plan's ownership.

Acceptance: every finding has a supported disposition (fixed, intentional with documented evidence, or explicit unresolved blocker), without relabeling unexecuted scenarios as passes. Previously passed endurance/dynamic checks need no repeat unless related production changes invalidate their evidence.

### I1 — Harden release evidence persistence

`tests/release/runner.cjs` writes a fixed `.tmp` then synchronously renames over state; the run encountered two EPERM interruptions. Add bounded retry/backoff for demonstrated transient Windows replacement errors, retaining the prior valid state and producing an actionable fatal error on exhaustion. Consider uniquely owned temp names under the existing global lock, but do not remove locking, overwrite evidence blindly, or delete the last good state as a workaround.

Use behavioral filesystem fault injection for transient failure then success, permanent denial, interruption/resume, and no lost/duplicated completed attempts. Preserve revision/protected-hash checks, retry classification and 30/75-minute caps. Persist standalone Node stdout/stderr and exit status in future prerelease artifacts; do not retroactively claim the missing original log exists.

## Validation and release gates

This plan does not authorize another full sweep or a multi-hour validation campaign. The historical three-hour run is evidence, not a target to repeat after every repair.

1. For each related implementation batch, run from `codebase`: `node --test tests/*.test.js` and `.venv/Scripts/python.exe -m pytest tests -q` (add `-ra` on the next required run to explain skips). Use virtual-environment Python. No fast rerun is needed for this planning-only document.
2. Inspect selections with `npm run test:release -- --driver <path> --plan` or the appropriate area selection. Choose one or two directly relevant GPU checks for an ordinary change; shared fixture fixes still require eventual execution of all previously blocked scenarios before claiming full remediation.
3. Commit tracked implementation changes before real release-runner selections. Run GPU jobs serially through the supported Electron/native launcher with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440` and disposable test profiles. Preserve each file's line endings.
4. **Still strict overrides the ordinary one/two-check rule:** enumerate every covering check before changing export/Proof output, shaders, tolerances, limits or budgets. This may include matrices outside the focused release set. Obtain Steve's agreement before starting a slow validation workload estimated over roughly 30 minutes; do not divide one large workload into smaller invocations to bypass that rule. Use history from the actual proposed commands, including retries; report absent/obsolete history honestly. Do not invent a fixed total estimate before diagnosis.
5. After fixes, reconcile every inventory entry against new per-driver results. Helpers repaired but callers not rerun remain unverified; later failures get a new concrete diagnosis and batch. Record flaky passes as flaky. Do not count retries as additional drivers. Use fresh run state at a new committed revision, never edit the old run into a pass.
6. At an actual release point, run `npm run test:release -- --release --plan`, then the focused selection within its approximately 75-minute authorization. READY requires no new, known or unfinished failures and no unresolved correctness blocker discovered outside that selection. Passing the focused set alone does not prove all full-tier failures resolved.
7. Requalify the repaired unpacked app with packaged runtime smoke/baselines against the correct build. A final full sweep/coverage/endurance campaign requires Steve's explicit request with its current history-based estimate. If requested, require all 195 original scenarios accounted for, plus current registered coverage/replacements, and protected hashes unchanged; legitimate retirements must be explicit, never silently dropped from the denominator.
8. Ask before pushing. Cross-platform trial workflow and all Windows/macOS/Linux/Flatpak results remain release requirements after the approved push. No installer or tag is authorized by this plan.

## Review questions for Claude

Answered in "Claude review corrections" above (partition: items 1 and 3; shared R/P code: item 5; header: item 4; K1/K2: item 6; ledger: item 7).

- Does the proposed partition correctly separate observable defects from setup/observer drift, especially GPU-first Library requests and direct mutation in the Local Detail test?
- Which R/P fixes share production processing code and therefore require one coordinated strict validation matrix?
- Are the current module decisions sufficient to update the 86-pixel Grade header and overlay positioning expectations, or is an explicit design decision missing?
- Is K1 technically repairable without changing output/range, and what concrete choice should Steve review for K2?
- Does the eventual result ledger prove each scenario ran, rather than merely eliminating its original first error?

## Complete failing-driver inventory

Each row below is taken from the authoritative `state.json`. Assignment is the first investigation owner, not a claim that the cause has been proven. H1 includes all callers whose final log contains the undefined helper message. Paths start at `codebase/`.

| Driver | Original verdict | Workstream |
| --- | --- | --- |
| `tests/control-panel-polish.js` | new | U1 |
| `desktop/tests/electron-smoke.js` | new | U3 |
| `desktop/tests/multi-window.js` | new | H2 |
| `desktop/tests/renderer-crash.js` | new | H2 |
| `desktop/tests/standalone-browser.js` | new | H2 |
| `tests/crop-apply-handoff.js` | new | H1 |
| `tests/denoise-pan-enable-drag.js` | new | R5 |
| `tests/export-file-browser-interaction.js` | new | U1 |
| `tests/exposure-bands-interaction.js` | new | H1 |
| `tests/film-stock-parity.js` | known | K1 |
| `tests/fine-adjustment-interaction.js` | new | H1 |
| `tests/full-tier-preview.js` | new | H1 |
| `tests/geometry-transactions.js` | new | H1 |
| `tests/gpu-highlight-compression-parity.js` | new | H1 |
| `tests/gpu-scope-parity.js` | new | H1 |
| `tests/gradient-mask-interaction.js` | new | M1 |
| `tests/grading-value-entry.js` | new | H1 |
| `tests/lane-roundtrip-interaction.js` | new | H1 |
| `tests/lens-filter-parity.js` | new | R4 |
| `tests/library-appearance-navigation.js` | new | U2 |
| `tests/library-compare.js` | new | U2 |
| `tests/library-delete-file-commands.js` | new | U2 |
| `tests/library-exposure.js` | new | U2 |
| `tests/library-filter-bar.js` | new | U2 |
| `tests/library-focus.js` | new | U2 |
| `tests/library-measurement-identity.js` | new | U2 |
| `tests/library-membership.js` | new | U2 |
| `tests/library-nonraw-picture.js` | new | L1 |
| `tests/library-picture-startup.js` | new | L1 |
| `tests/library-smart-albums.js` | new | L1 |
| `tests/library-virtual-copies.js` | new | U2 |
| `tests/local-adjustment-usability.js` | new | M1 |
| `tests/local-crop-anchor-interaction.js` | new | M1 |
| `tests/local-design-qa.js` | new | H1 |
| `tests/luma-mask-interaction.js` | new | M1 |
| `tests/native-region-stall.js` | new | H3 |
| `tests/pan-store-region-identity.js` | new | H3 |
| `tests/path-feather-geometry.js` | new | H1 |
| `tests/path-mask-interaction.js` | new | M1 |
| `tests/performance/budget-route.js` | new | R6 |
| `tests/performance/denoise-scale-identity.js` | new | H1 |
| `tests/performance/denoise-selector-seam.js` | new | H2 |
| `tests/performance/detail-cache-residency.js` | new | H3 |
| `tests/performance/failure-taxonomy.js` | new | H1 |
| `tests/performance/gpu-linear-gradient-parity.js` | new | H1 |
| `tests/performance/packaged-baselines.js` | new | H2 |
| `tests/performance/phase5-inactive-lane.js` | new | H1 |
| `tests/performance/presentation-gate.js` | new | H1 |
| `tests/performance/roi-catch-up.js` | new | H1 |
| `tests/performance/roi-pan-cache.js` | new | H1 |
| `tests/performance/roi-refinement.js` | new | H1 |
| `tests/performance/tier-film-consistency.js` | known | K2 |
| `tests/perspective-interaction.js` | new | H1 |
| `tests/perspective-preview-ownership.js` | new | H1 |
| `tests/photo-library-navigation.js` | new | H2 (moved from L1 by review) |
| `tests/photo-library-slice-2.js` | new | U2 |
| `tests/photo-library-stage-a.js` | new | U2 |
| `tests/photo-library-stage-c.js` | new | U2 |
| `tests/preview-resolution-interaction.js` | new | H1 |
| `tests/project-open-session-interaction.js` | new | L1 |
| `tests/scope-region-interaction.js` | new | H1 |
| `tests/sdr-match-gpu-interaction.js` | new | H3 |
| `tests/session-replacement-interaction.js` | new | H1 |
| `tests/slider-fill-anchoring.js` | new | H1 |
| `tests/source-disclosures-interaction.js` | new | H1 |
| `tests/technical-panel-fit.js` | new | H1 |
| `tests/tiled-admission-scope-fallback.js` | new | H1 |
| `tests/tiled-cpu-detail-parity.js` | new | H1 |
| `tests/tiled-direct-parity.js` | new | H1 |
| `tests/tiled-film-parity.js` | new | H1 |
| `tests/ui-refinement-detail-qa.js` | new | H1 |
| `tests/view-tools-interaction.js` | new | M1 |
| `tests/webgpu-shader-compilation.js` | new | R3 |
| `desktop/tests/overlay-feedback.js` | new | H2 |
| `tests/library-grade-paste.js` | new | L1 |
| `tests/library-export-menu.js` | new | L1 |
| `tests/library-gpu-raw-single.js` | new | L1 |
| `tests/library-export-live-tiles.js` | new | U1 |
| `tests/library-codec-source.js` | new | R2 |
| `tests/edge-colour-raw.js` | new | R1 |

Inventory cross-check: 78 new + 2 known = 80 distinct failing drivers. H1 = 32 failed (36 files to fix; see review correction 2); H2 = 7; H3 = 4; U1 = 3; U2 = 12; U3 = 1; L1 = 7; M1 = 6; R1–R6 = 6; K1/K2 = 2. P1, A1 and I1 cover findings beyond those 80 failed-driver results.
