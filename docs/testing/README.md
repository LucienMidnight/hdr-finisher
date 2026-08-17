# Testing and Validation

This directory is the canonical home for human-readable test procedures, acceptance criteria, and durable validation records. Start here when looking for manual QA instructions.

## Where test material belongs

| Material | Location | Versioned | Purpose |
|---|---|---:|---|
| Automated test code and deterministic fixtures | `codebase/tests/` | Yes | Inputs and code consumed directly by pytest or browser automation |
| Manual procedures, acceptance criteria, and durable logs | `docs/testing/` | Yes | Human-readable source of truth for validation work |
| Private or large manual source media | `codebase/local-test-media/inputs/` | No | Local photographs, EXRs, TIFFs, and HEICs used for hands-on checks |
| Generated exports, screenshots, reports, and run evidence | `codebase/output/` | No | Disposable artifacts reproducible by tests or manual runs |
| Bundled user-facing reference assets | `codebase/samples/` | Yes | Known-good media intentionally shipped with the project |

Generated output must not be the only copy of a procedure or durable conclusion. Promote reusable findings into a document in this directory.

## Manual test documents

- [Alpha Manual QA Checklist](Alpha_Manual_QA_Checklist.md) — packaged application, HDR/SDR display, HEIC, EXR, and export checks.
- [Delivery Proofing Sprint](Delivery_Proofing_Sprint.md) — browser/display proofing protocol, acceptance gates, and hosting-survival work.
- [JPEG Ultra HDR Reliability](JPEG_Ultra_HDR_Reliability.md) — separate edge-fidelity and matrix-color failure modes, automated thresholds, and iPhone/Blender procedures.
- [Source Export Validation Log](Source_Export_Validation_Log.md) — validated source-editor handoff workflows and findings.
- [Interactive Preview Performance Validation — 2026-08-09](Interactive_Preview_Performance_Validation_2026-08-09.md) — final automated measurements, approved parity envelope, physical-display procedure, and platform sign-off fields.
- [GPU Local Adjustments Phase 0/1 Validation — 2026-08-14](GPU_Local_Adjustments_Phase_0_1_Validation_2026-08-14.md) — deterministic Luma opacity/feather baseline, Phase 1 measurements, live-scope evidence, CPU/GPU parity, and Brush/Gradient preservation results.
- [GPU Local Adjustments Phase 2 Validation — 2026-08-14](GPU_Local_Adjustments_Phase_2_Validation_2026-08-14.md) — GPU-resident scene Luma, qualification, cached separable Feather, mask overlay, parity, fallback, and Phase 2 exit-gate evidence.
- [GPU Local Adjustments Phase 3 Validation — 2026-08-14](GPU_Local_Adjustments_Phase_3_Validation_2026-08-14.md) — GPU-backed histogram, waveform, and vectorscope cadence, compact readback timing, CPU/GPU parity, stale-generation protection, and Phase 3 exit-gate evidence.
- [GPU Local Adjustments Phase 4/5 Validation — 2026-08-15](GPU_Local_Adjustments_Phase_4_5_Validation_2026-08-15.md) — retained Boolean mask graphs, 16/32/64-local scaling, destructive device-loss fallback, Edge endurance, release regressions, and remaining physical sign-off.
- [Codebase Review, Scope Performance, and HDR Round-Trip Sprint](Codebase_Review_Cleanup_and_Round_Trip_Sprint.md) — clean-task implementation brief for evidence-led code cleanup, scope profiling, packaging review, and AVIF/JPEG Ultra HDR re-import investigation, with JPEG XL and DNG feasibility follow-up.
- [macOS Desktop Validation](macOS_Desktop_Validation.md) — Apple Silicon package automation, native workflow checks, application lifecycle, and remaining signing/display gates.
- [Compact Workspace Validation](Compact_Workspace_Validation.md) — responsive viewport matrix and packaged macOS/Windows checks for small displays.

## Automated entry points

See the [Automated Testing Index](Automated_Testing_Index.md) for the test tiers, requirement-to-suite inventory, capability-aware integration behavior, and remaining automation gaps.

From `codebase/`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run_alpha_qa.ps1
```

Automated reports are written below `codebase/output/`; they are evidence from a run, not documentation.

## Repeatable manual-test images

Generate the calibrated float32 HDR scene and delivery-proof chart with:

```powershell
cd codebase
.\.venv\Scripts\python.exe .\tools\generate_manual_test_media.py
```

The ignored outputs live in `codebase/local-test-media/inputs/generated/`. Select **ACEScg Linear** when HDR Finisher requests their manual source interpretation. Use them alongside representative real Affinity, Blender, and iPhone sources; generated patterns provide known numeric values, while real media exposes decoder, metadata, detail, and perceptual issues.
