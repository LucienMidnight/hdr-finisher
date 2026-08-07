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
- [Source Export Validation Log](Source_Export_Validation_Log.md) — validated source-editor handoff workflows and findings.

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
