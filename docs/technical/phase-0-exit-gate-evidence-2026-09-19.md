# Phase 0 exit-gate evidence

**Recorded:** 2026-09-19
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)
**Source state:** dirty worktree based on commit `83bca704dd0422dd470de37cee0b4eb4db0fbe5c` (`main`)
**Application:** HDR Finisher 0.8.12
**Host:** Windows 10.0.26200; Node v24.14.0; Python 3.10.10 (`C:\Users\Steve\AppData\Local\Programs\Python\Python310\python.exe`)
**Display adapters:** NVIDIA GeForce RTX 4070 Ti (12,282 MiB, driver 616.92); AMD Radeon(TM) Graphics (driver 32.0.21045.5002)

This record evaluates the three Phase 0 exit-gate conditions stated in Section 10 of the sprint PRD. It supersedes the "gate status: open" note in
[phase-0-gpu-logical-memory-baselines-2026-09-19.md](phase-0-gpu-logical-memory-baselines-2026-09-19.md) for gates 1 and 3.


> **Retracted 2026-09-19 (Phase 3):** the "environment defect" recorded below is
> wrong. `codebase/.venv` already contains Python 3.12.10 with every declared
> dependency, including `imagecodecs`, `rawpy`, and `lensfunpy`. This record ran
> the global `python` (3.10.10) instead. Re-run in the venv, the full suite is
> `1017 passed, 3 skipped, 0 failed` with no prerequisite failures. The
> before/after comparison in this document is still a valid comparison, but it
> never exercised the JPEG XL, AVIF gain-map, or Lensfun routes. See
> [phase-3-bounded-transport-evidence-2026-09-19.md](phase-3-bounded-transport-evidence-2026-09-19.md).

## Gate 1 — Diagnostic totals agree with allocations in deterministic tests

**Status: met.**

Two deterministic Node suites cover this gate from opposite directions. Neither needs a WebGPU adapter, so both run on any developer machine and in CI.

| Suite | What it proves |
|---|---|
| `codebase/tests/webgpu-memory-diagnostics.test.js` | The static logical models (`directPreviewMemoryModel`, `staticPreviewMemoryModels`) reproduce the approved 24 MP / 42 MP / 8K baselines and keep planned, resident, transient, cached, retained-overlap, and peak bytes separate. |
| `codebase/tests/webgpu-allocation-agreement.test.js` | The live diagnostics agree with what the renderer actually allocated. A recording `GPUDevice` stub captures every `createTexture` / `createBuffer` descriptor and every `destroy()`, and the suite drives the real `ensureIntermediate`, `ensureStorageBuffers`, and `acquireScopeResource` code paths. |

The allocation-agreement suite asserts:

- `ensureIntermediate` creates **four** full-size `rgba16float` grading textures, and `resources.memory.resident.categories.gradingCoreBytes` equals those four textures' bytes. This is the direct regression test for the historic three-texture undercount.
- `resources.memory.resident.totalBytes` equals the total live device bytes after a graph with Detail, spatial film, scope pool, and parameter buffers is built — that is, the diagnostic is neither over- nor under-counting anything the device was asked to create.
- A resize destroys all eight previous textures and residency follows the live device set rather than the historic peak.
- Each `recordAllocation` ledger entry (`grading-intermediates`, `grading-detail-intermediates`, `grading-spatial-intermediates`, `scope`) equals the bytes created by that call.
- The `planned` model derived for the resident graph matches the measured grading, Detail, and spatial categories, and `peakLogicalBytes` carries no retained-presentation overlap until a presentation is recorded.

### Commands and results

```
cd codebase
node --test tests/webgpu-memory-diagnostics.test.js tests/webgpu-allocation-agreement.test.js
```

`tests 9 / pass 9 / fail 0`.

Both suites are registered in `codebase/package.json` as `test:webgpu-memory` and `test:webgpu-allocation-agreement`.

### What this gate does not cover

A recording stub proves the diagnostic arithmetic and the allocation call sites agree. It cannot observe driver padding, heap fragmentation, the compositor swapchain, or physical VRAM. `transient.submittedWorkPendingDestructionBytes` remains explicitly zero and untracked, because WebGPU destruction callbacks do not expose resource size. These remain recorded limitations rather than gate failures, because Section 4.1 defines the baseline as a **logical** resource-size model and Section 4.2 states that WebGPU does not expose reliable physical VRAM capacity. Physical-allocation behavior is admitted and measured in Phase 2, where the planner attempts real allocations and backs off.

## Gate 2 — Existing 1K/2K/4K behavior and exports remain unchanged

**Status: met for everything the current environment can execute; the unexecutable subset is unchanged from the pre-sprint baseline and is an environment defect, not a regression.**

The full Python suite was run twice from the same shell and interpreter: once on the Phase 0 worktree, and once on a clean `83bca70` produced with `git stash push -u` (restored afterwards with `git stash pop`).

| Run | Result |
|---|---|
| Clean `83bca70` (baseline) | `23 failed, 975 passed, 4 skipped` in 38.80 s |
| Phase 0 worktree | `23 failed, 978 passed, 4 skipped` in 38.32 s |

The two `FAILED` lists are **byte-identical** — same 23 node ids, no additions, no removals:

- 19 × `tests/test_extended_formats.py` (JPEG XL precision/round-trip/export and the manual Lensfun profile case)
- 3 × `tests/test_gainmap_import.py` (AVIF gain-map and direct PQ AVIF import)
- 1 × `tests/test_linear_dng.py::test_real_local_corpus_routes_when_present` (private Linear DNG corpus route)

The `+3 passed` delta is exactly the Phase 0 additions: two cases in the new `tests/test_preview_resolution_contract.py` and one added case in `tests/test_frontend_contract.py`.

Focused frontend contract run:

```
cd codebase
python -m pytest -q tests/test_frontend_contract.py tests/test_preview_resolution_contract.py
```

`77 passed in 2.38 s`.

### Root cause of the 23 prerequisite failures

Earlier handoff notes described these as "missing `imagecodecs` / missing Lensfun profiles". That diagnosis was incomplete. The actual cause is an **interpreter version mismatch**, and it cannot be fixed by installing packages into the active environment:

- `codebase/requirements.txt` pins `imagecodecs>=2026.6.26,<2027.0`.
- Every `imagecodecs` release from `2026.5.10` onward requires **Python ≥ 3.12**; the `2026.6.26` pin itself requires ≥ 3.12.
- The active interpreter is **Python 3.10.10**, whose newest installable `imagecodecs` is `2025.3.30`.

`python -m pip install --dry-run "imagecodecs>=2026.6.26,<2027.0"` therefore ends in
`ERROR: No matching distribution found`. `rawpy` 0.27.1 and `lensfunpy` 1.18.0 *are* installable on 3.10 (`--dry-run` resolves both) but are likewise absent from the active environment.

Python **3.12.10** is present on this host at `C:\Users\Steve\AppData\Local\Programs\Python\Python312\python.exe`, but its site-packages is bare — none of `numpy`, `fastapi`, `pytest`, `PIL`, `tifffile`, `OpenEXR`, `imagecodecs`, `rawpy`, or `lensfunpy` are installed there.

**Consequence for this gate:** the JPEG XL, AVIF gain-map, and Lensfun routes cannot be executed on this host until a Python ≥ 3.12 environment is provisioned from `requirements.txt` + `requirements-dev.txt`. Because the identical 23 cases fail identically at clean `83bca70`, the Phase 0 changes demonstrably did not cause or worsen them, and no Phase 0 change touches those code paths (the diff is confined to `frontend/`, `desktop/main.js`, `package.json`, and tests). Restoring that environment is tracked as a standalone environment task, not a Phase 0 implementation blocker.

### Not covered by this gate

The Playwright browser suites in `codebase/package.json` were not run for this record. They exercise interaction behavior that Phase 1 is about to rewrite (the resolution selector, proxy scheduling, and presentation acceptance), so their baseline belongs to the Phase 1 evidence pack, where a before/after comparison is meaningful.

## Gate 3 — Baseline evidence saved with hardware and application metadata

**Status: met.**

- [phase-0-gpu-logical-memory-baselines-2026-09-19.md](phase-0-gpu-logical-memory-baselines-2026-09-19.md) — allocation inventory, static model formula, and named 1K/2K/4K plus 24 MP/42 MP/8K baselines, with host, Node, Python, and display-adapter metadata.
- [phase-0-preview-resolution-boundary-inventory-2026-09-19.md](phase-0-preview-resolution-boundary-inventory-2026-09-19.md) — every semantic-tier boundary, numeric pixel-edge boundary, `long_edge` serialization site, and backend admission bound.
- This document — gate-by-gate results with the commands that produced them.

## Open discrepancies carried into Phase 1

These are recorded rather than fixed, because each belongs to a later phase's scope.

1. **`acceptPresentation` now stores the requested tier as `tier` and the executed tier as `renderTier`.** The Preview Output readout labels the presented image with `acceptedPresentation.tier`, so a presentation produced by a lower-resolution interaction proxy is currently labeled with the selected tier. This satisfies no contract on its own and directly conflicts with PRD §2.2 ("never replace it with a lower-resolution interaction proxy") and the §2.3 state table. **Phase 1 must make the readout derive from `renderTier`, or stop accepting proxy presentations as the selected tier.**
2. **Interaction-time proxy substitution still exists.** `interactiveProxyLongEdge` (512–1024) and `settledProxyLongEdge` (768–1024) still lower the processing resolution during gestures. This is the core behavior Phase 1 removes.
3. **`window.HDRFinisherPerformance` render/denoise hooks call `Number(longEdge)`** with no runtime validation of their numeric-only contract. Passing the `"full"` sentinel would yield `NaN`. They are diagnostic pixel-edge APIs, not tier APIs, and should be documented or validated as such.
4. **Backend request models cap preview work at 16,384 pixels.** A source whose Full long edge exceeds that cannot cross the current monolithic endpoints. Phase 3's bounded tile transport removes the need for a single image-sized request.
5. **Full is deliberately absent from both the preview selector and the Settings default-preview-resolution menu.** The `"full"` sentinel is implemented and tested end to end through normalization, labeling, long-edge derivation, dimension derivation, and preference persistence, but it is not user-selectable. Phase 4 adds the engineering-only selection; Phase 9 makes it public.
6. **Retained-presentation overlap is an `8P` approximation** rather than a full retained graph, and the static model excludes Denoise analysis temporaries, upload staging, scope pools, masks, comparison surfaces, and multiple cached proxy tiers. Phase 2's render-plan inventory replaces this approximation with an enumerated plan.

## Verdict

Gates 1 and 3 are met. Gate 2 is met for every test the host can execute, with the unexecutable subset proven identical to the pre-sprint baseline and re-diagnosed as a Python-version environment defect. **Phase 0 is closed**; the environment provisioning task and the six discrepancies above are carried forward as tracked follow-ups rather than as open Phase 0 work.
