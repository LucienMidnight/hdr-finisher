# Codebase Review, Scope Performance, and HDR Round-Trip Sprint

**Date:** August 11, 2026

**Application target:** HDR Finisher v0.2.1

**Status:** Ready for execution in a clean Codex task

## Goal

Review and simplify HDR Finisher without changing its authored image results, then make evidence-led improvements to the areas that most affect maintainability, installer quality, and perceived scope responsiveness.

The sprint must also investigate the two immediate HDR input gaps exposed by the current export pipeline: HDR Finisher can produce AVIF gain-map and JPEG Ultra HDR files, but it cannot yet faithfully re-import both HDR representations. The desired product outcome is trustworthy export/re-import round trips, not merely acceptance of the filename extension.

## Decisions already made

- Keep `imagecodecs` in the application and package it exactly as-is for now. It protects compressed-TIFF compatibility.
- Record selective `imagecodecs` collection as a possible later installer-size optimization. Do not implement it until a representative TIFF corpus and clean packaged-build tests exist.
- Investigate AVIF gain-map and JPEG Ultra HDR input/round-trip behavior as a priority.
- Explore JPEG XL and DNG during the coming days/weeks, but treat both as research until their product boundary, correctness, packaging cost, and platform value are understood.
- DNG exploration must distinguish importing an already-rendered linear HDR interchange from building a camera-RAW developer. Demosaicing and general RAW development remain outside v1.
- Do not add dependencies merely to silence optional-library warnings.

## Read before changing code

1. `AGENTS.md`
2. `docs/testing/README.md`
3. `docs/product/HDR_Finisher_PRD_v1.2.md`
4. `docs/testing/Automated_Testing_Index.md`
5. `docs/testing/Interactive_Preview_Performance_Validation_2026-08-09.md`
6. `docs/testing/Source_Export_Validation_Log.md`
7. `codebase/backend/hdr_finisher/loader.py`
8. `codebase/backend/hdr_finisher/scopes.py`
9. `codebase/backend/hdr_finisher/render_cache.py`
10. `codebase/frontend/preview-scheduler.js`

Preserve unrelated user files and changes. The untracked UI redesign material under `docs/design/` is user-owned and outside this sprint unless explicitly brought into scope.

## Review baseline

The August 11 review found a healthy functional base rather than a disposable or fundamentally unsound project:

- The automated suite passed at the review checkpoint (`272 passed`). Re-run it and record the actual baseline count before editing.
- Backend responsibilities are already separated into loader, color, adjustments, scopes, preview, proofing, exporters, capabilities, sessions, and cache modules.
- The scope path already includes several good performance features: tiered interactive/settled/refinement requests, bounded proxies, cache reuse, stale-generation rejection, request aborts, vectorized waveform binning, and highlight-peak regression coverage.
- The main maintainability concentrations are the buildless frontend monoliths: `frontend/app.js` is approximately 4,500 lines and `frontend/styles.css` approximately 3,900 lines. Large files are not automatically defects, but they deserve responsibility and duplication review.
- The larger Python modules (`adjustments.py`, `loader.py`, `proofing.py`, and `exporters.py`) contain inherently complex color, format, and delivery behavior. Split only where a cohesive boundary becomes clearer and tests can protect it.
- The installed application footprint observed during review was approximately 186 MiB, with a compressed ZIP around 77 MiB. `imagecodecs` accounted for roughly 48 MiB unpacked, the separate AVIF command-line tools roughly 36 MiB, and the HEIF stack roughly 10 MiB. Treat these as orientation numbers and re-measure the current build before making packaging claims.
- The launcher output is operationally healthy. HTTP `200 OK` is success, `304 Not Modified` is normal browser caching, and the observed `/favicon.ico` `404` is cosmetic. The SciPy and Matplotlib messages are optional `colour-science` feature warnings, not evidence that the HDR Finisher server failed.

## Product and engineering guardrails

- Preserve ACEScg as the canonical internal working space and preserve the `0.18 scene-linear = 100 nits` authoring reference.
- CPU/export math remains authoritative. Preview or scope shortcuts must never change final export values.
- Preserve tiny, rare highlights. A faster scope that drops a small 4,000-nit light is not acceptable even if its average histogram looks similar.
- Preserve the independently authored SDR fallback and the separation between HDR and SDR adjustment branches.
- Do not convert color math to lower precision without measured error bounds and explicit tests.
- Prefer comments that explain intent, invariants, standards decisions, unusual scaling, cache ownership, and failure behavior. Avoid comments that merely translate the next line into English.
- Do not introduce a frontend framework or build system solely as a cleanup exercise.
- Do not split files by arbitrary line-count targets. Split at stable responsibility seams with focused tests.
- Do not remove a dependency based only on an import search. Verify runtime, optional capability, encoder, packaged, and license/notice paths.
- Do not broaden the sprint into JPEG XL implementation, DNG development, batch processing, local adjustments, or a general rewrite.

## Workstream 1 — Establish a reproducible baseline

Before refactoring:

1. Record `git status --short` and protect unrelated changes.
2. Run the deterministic Python suite from `codebase/`:

   ```powershell
   .\.venv\Scripts\python.exe -m pytest -q tests
   ```

3. Run the JavaScript syntax checks and the existing targeted performance tests documented in `Automated_Testing_Index.md`.
4. Run the preview-performance matrix with representative EXR, float TIFF, and Apple HDR HEIC inputs. Include histogram, luma waveform, composite waveform, and RGB parade where the harness permits it.
5. Capture at least these timings separately:
   - input event to first visible image response;
   - input event to first visible scope feedback;
   - request debounce/queue delay;
   - proxy lookup or generation;
   - adjustment math;
   - histogram/waveform computation;
   - JSON serialization and transfer;
   - frontend parse and Canvas draw;
   - settled and refinement completion;
   - memory peak and retained-cache size.
6. Record the current packaged folder, archive, and major dependency sizes if a current package exists. Do not rebuild only to obtain size data unless the documented build path is ready.

The baseline must distinguish benchmark success from the user's real-image perception that scopes still feel slower than desired. Keep both facts visible.

## Workstream 2 — Structure and maintainability review

### 2.1 Map responsibilities before moving code

Produce a compact map of:

- backend module ownership and allowed dependency direction;
- frontend state ownership;
- preview and scope request lifecycle;
- import/normalization flow;
- export/proof encoder adapters;
- capability detection and packaged-binary discovery.

Use the map to identify actual problems: duplicated policy, circular knowledge, functions with mixed responsibilities, repeated serialization or normalization, mutable global state, unreachable compatibility paths, or error handling that loses useful context.

### 2.2 Frontend review

Review `app.js` for stable extraction seams such as:

- source import/session lifecycle;
- scope request and Canvas rendering;
- viewer/zoom/pan state;
- source interpretation controls;
- export/preflight orchestration;
- DOM binding and persisted preferences.

Some scheduling and proofing code is already separated. Extend those seams only when doing so reduces duplicated state or makes behavior independently testable. Preserve the buildless local-app model unless a separate product decision changes it.

Review `styles.css` for duplicated selectors, repeated hard-coded values that should be tokens, obsolete redesign rules, and component blocks that can be grouped coherently. Splitting CSS into smaller files is optional; reducing cascade ambiguity and dead rules matters more than file count.

### 2.3 Backend review

Focus on cohesion rather than cosmetic churn:

- `loader.py`: keep top-level dispatch clear; consider format-specific decoder modules only if they isolate optional dependencies and format metadata policy cleanly.
- `adjustments.py` and `color.py`: preserve tested numerical behavior; document why reference scaling, gamut transforms, and branch isolation exist.
- `proofing.py` and `exporters.py`: identify repeated artifact, subprocess, temp-file, validation, or metadata logic. Consolidate only when failure semantics remain explicit.
- `main.py`: keep HTTP concerns separate from image processing and session/cache policy.
- capability and binary discovery: ensure one source of truth for what the installed build can actually do.

### 2.4 Commenting standard

Add or improve comments only where they answer one of these questions:

- Why is this conversion or constant correct?
- Which external standard/tool behavior is being adapted?
- Which invariant must a future edit preserve?
- Why is an apparently redundant copy, cache key, limit, or validation step necessary?
- Why is a fallback safe, and what fidelity does it sacrifice?

Do not comment routine loops, assignments, obvious conditionals, or standard API wiring.

## Workstream 3 — Scope performance by design

### 3.1 Verify the current architecture first

The code already appears to use the right broad design: calculate scopes from bounded float proxies rather than millions of full-resolution pixels on every slider event; deliver aggregated bins/grids to Canvas; cache reusable work; reject stale results; and refine after interaction settles.

Confirm each of those assumptions in the active path. Find out where real time is going before replacing it.

### 3.2 Resolution and fidelity model

Scopes are judgement tools, not pixel viewers. Their resolution should be independent of source megapixel count:

- Histogram accuracy is governed primarily by representative sampling and bin count, not display-size pixels.
- Waveform spatial judgement needs a bounded horizontal column count and vertical luminance bins, not one column per source pixel.
- Rare HDR highlights require an explicit preservation strategy because ordinary downsampling can average them away.

If profiling shows proxy computation is still the bottleneck, evaluate a hybrid analysis representation:

1. A compact, float, color-correct base proxy for histogram and waveform distribution.
2. Peak-preserving information derived during the same downsample, such as per-cell maxima or a small top-luminance reservoir, so isolated highlights survive.
3. Fixed scope output dimensions chosen for the actual Canvas size and display scale.
4. Interactive, settled, and optional refinement tiers with visibly documented freshness.

Do not implement the hybrid representation merely because it is described here. Compare it against the existing peak-priority behavior and adopt it only if measurements show a worthwhile latency/memory gain with no diagnostic regression.

### 3.3 Bottleneck-specific options

Use only options supported by evidence:

- If adjustment math dominates, reuse processed proxies across preview/scope consumers using a complete adjustment-and-source cache key.
- If waveform binning dominates, test fewer interactive bins/columns, retained settled resolution, or a more compact vectorized index path.
- If JSON dominates, reduce redundant channels/precision or evaluate a compact typed representation before considering GPU compute.
- If Canvas drawing dominates, move static grid/labels off the hot path, avoid excess redraws, and scale backing resolution to visible size.
- If scheduling dominates, tune debounce/coalescing and ensure refinements cannot compete with active interaction.
- If proxy generation dominates, reuse a small pyramid created once per source/interpretation rather than resizing independently for each consumer.
- Consider WebGPU reduction only after the CPU/transfer/draw breakdown demonstrates that it addresses the measured bottleneck. GPU complexity is not a default success criterion.

### 3.4 Scope acceptance targets

At minimum, retain or improve the existing documented budgets:

- visible image response: no slower than 50 ms p95;
- first visible scope feedback: no slower than 100 ms p95;
- normal settled scope: no slower than 250 ms p95 including scheduled delay;
- stale or wrong result applied: zero;
- blank/zero-flash during refinement: zero;
- export requests or export values changed by preview-quality choices: zero.

Also evaluate subjective continuity during repeated slider movement on the real high-resolution HEIC/EXR cases. If the instrument still feels laggy while numeric targets pass, record the visible cadence and investigate scheduling/drawing rather than declaring success from aggregate timing alone.

Numerical/parity gates:

- Peak value and clipping classification must match the authoritative processed source within the existing tested tolerance.
- The tiny-highlight 4,000-nit regression must remain visible.
- Histogram distributions and waveform structure must remain within a documented tolerance against the current settled/reference path.
- HDR/SDR lanes and source interpretation must never share an invalid cache result.

## Workstream 4 — Dependency, packaging, and startup-noise audit

Create an evidence table for every production dependency:

- importing module(s);
- user-visible capability;
- whether it is mandatory or optional;
- whether PyInstaller discovers it automatically;
- packaged size contribution;
- tests proving its capability;
- license/notice obligation;
- keep, investigate, or remove recommendation.

Specific decisions and checks:

- `imagecodecs`: **keep unchanged**. Document that the current app uses it mainly behind `tifffile` for compressed TIFF segments. Do not confuse bundled AVIF/JPEG XL/Ultra HDR codec modules with active input-format support.
- SciPy and Matplotlib: they are not production requirements today. Determine why `colour-science` announces their absence at startup and suppress only the precise optional-feature warnings if the exercised HDR Finisher paths do not need them. Do not hide unexpected warnings broadly.
- Favicon: once the user supplies the final asset, wire the browser icon and packaged application icon deliberately. Until then, `/favicon.ico` returning 404 is harmless and should be documented rather than “fixed” with an arbitrary asset.
- Access logging: `200` and `304` lines are normal. Reduce console noise only if useful error visibility and the user's “keep this window open” recovery path remain intact.
- PyInstaller: review broad `collect_all`/hidden-import rules and record candidates for future tightening, but do not narrow `imagecodecs` in this sprint.

## Workstream 5 — HDR export/import round-trip investigation

### 5.1 Current gap

- `.avif` is not routed by `load_image()`, even though AVIF gain-map export and decoding tools are bundled for export/proof workflows.
- `.jpg` and `.jpeg` route through Pillow and become an ordinary 8-bit RGB base. A valid JPEG Ultra HDR file can therefore open while silently losing its HDR gain-map rendition.
- JPEG XL is not accepted as input and its export path remains deferred.
- DNG is not accepted as input.

### 5.2 Required AVIF/JPEG investigation output

For both AVIF gain map and JPEG Ultra HDR:

1. Identify the authoritative production decoder already bundled or the smallest standards-correct addition.
2. Define loader routing and capability-gate behavior.
3. Define how to recover and represent:
   - the reconstructed HDR rendition;
   - the exact SDR base/fallback;
   - color primaries and transfer characteristics;
   - reference white and HDR headroom/capacity;
   - gain-map metadata and offsets;
   - orientation and dimensions.
4. Define explicit behavior for a plain SDR AVIF/JPEG, a direct-HDR file without a gain map, a valid gain-map file, missing/contradictory metadata, a malformed gain map, and an unavailable native decoder.
5. Confirm that re-import does not double-decode PQ/HLG, double-apply a gain map, or double-tone-map the SDR branch.
6. Decide whether implementation can reuse the existing proofing decoder adapters or whether those adapters need a shared lower-level module.
7. Produce a small deterministic fixture strategy plus a real-export local-media procedure.

Implementation may follow in the same clean task only if the decoder contract and tests are clear and the changes remain bounded. Otherwise, finish with a concrete implementation plan and no speculative loader path.

### 5.3 Round-trip test matrix

For each of HDR Finisher's production HDR exports:

1. Start from a deterministic source with neutral patches, saturated colors, gradients, and tiny highlights.
2. Export using current production settings.
3. Validate the encoded artifact with the existing native inspection/decoder tools.
4. Re-import the exact artifact.
5. Compare:
   - HDR classification;
   - reconstructed peak and stops above diffuse white;
   - color interpretation and transfer;
   - SDR base identity or bounded error;
   - HDR reconstructed pixels at representative coordinates;
   - histogram/waveform distribution;
   - clipping and highlight ordering;
   - orientation and dimensions;
   - metadata required for a second export.
6. Export the re-imported session once more and determine whether generation loss, headroom drift, gamut drift, or metadata drift is within a stated tolerance.

Round-trip does not mean the compressed file must be pixel-identical after another lossy encode. It means the decoded authoring intent, HDR/SDR relationship, color meaning, and metadata remain correct within a deliberate tolerance.

### 5.4 JPEG XL research questions

- Is direct HDR, a gain-map representation, or both required for HDR Finisher's use case?
- What do current target browsers, operating systems, editors, and hosting services actually preserve?
- Can `libjxl` decoding/encoding be packaged cleanly on Windows and macOS?
- Does it provide enough round-trip or archival value to justify another native toolchain?
- Can current bundled `imagecodecs` components help with controlled experiments without being mistaken for the final application architecture?

Return a go/no-go/later recommendation. Do not implement by default.

### 5.5 DNG research questions

- Which DNG is intended: mosaiced camera RAW, linear DNG, floating-point DNG, HDR gain-map DNG, or a constrained subset?
- Which real source applications create the target files?
- Does LibRaw/rawpy return a rendered image, scene-linear sensor values, or an application-dependent conversion for each target?
- How will camera matrices, white balance, baseline exposure, profiles, orientation, black/white levels, and highlight reconstruction map into HDR Finisher's ACEScg convention?
- Can an input-only handoff remain useful without adding RAW development controls?
- What are the Windows/macOS binary-size, startup, licensing, and maintenance costs?

Return a narrowly scoped candidate format definition before proposing code.

## Workstream 6 — Validation and handoff

After each coherent change:

1. Run the smallest relevant tests.
2. At the end, run the complete deterministic suite.
3. Run JavaScript syntax/browser coverage for any frontend extraction or scheduling change.
4. Re-run the same performance matrix and sources used for the baseline.
5. Compare before/after timing, memory, output parity, and package size where applicable.
6. Run a packaged smoke test if imports, dependency collection, binary discovery, launcher behavior, or icons changed.
7. Update durable documentation with measured results and remaining decisions. Generated traces and screenshots belong under ignored `codebase/output/`.

## Required deliverables

- A prioritized review with concrete findings, not line-count or style complaints.
- Safe cleanup/refactoring changes where evidence supports them.
- Before/after scope performance and parity results on representative EXR, TIFF, and HEIC inputs.
- A dependency/package evidence table and recommendations.
- A clear explanation of any retained startup warnings; targeted cleanup for warnings proven harmless and unnecessary.
- An AVIF/JPEG Ultra HDR round-trip decoder contract and test matrix, plus implementation if it is bounded and verified.
- JPEG XL and DNG feasibility notes with go/no-go/later recommendations.
- Updated tests and documentation for every behavior change.
- A final summary separating completed changes, measured improvements, deferred ideas, and risks requiring user choice.

## Definition of done

- All pre-existing deterministic tests pass, plus focused tests for changed behavior.
- Image math, HDR/SDR branch isolation, color interpretation, metadata, proofing, and export behavior show no unexplained regression.
- Scope latency is measurably improved or the actual bottleneck is conclusively identified with evidence and a bounded follow-up plan.
- Tiny-highlight and scope-distribution fidelity remain within documented tolerances.
- No stale scope result is rendered and no interaction causes a blank scope flash.
- Cleanup produces clearer responsibility boundaries and removes proven duplication; it does not merely redistribute the same complexity.
- Important “why” comments exist at non-obvious invariants without narrating routine code.
- `imagecodecs` remains fully packaged and TIFF tests continue to pass.
- AVIF/JPEG Ultra HDR round-trip behavior is either implemented and tested or specified precisely enough for a small follow-up sprint.
- JPEG XL and DNG remain research items unless evidence supports a deliberate scope decision.
- The final handoff includes exact commands run, test counts, performance comparisons, package-size comparisons where relevant, and links to durable evidence.

## Explicitly deferred

- Selective `imagecodecs` packaging
- General camera-RAW development or demosaicing UI
- JPEG XL implementation without a completed feasibility decision
- A new frontend framework/build chain
- WebGPU scope computation without profiling evidence
- Full-source tiled/chunked image processing
- Broad visual redesign unrelated to measured usability or performance
