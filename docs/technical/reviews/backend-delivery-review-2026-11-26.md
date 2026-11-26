# Backend delivery review — 26 November 2026

Scope: focused source review of the backend families below on
`integrate/pc-tests-review-2026-11-26`. No processing algorithms, encoding
settings, image tolerances or memory budgets were changed. Steve's running
Electron app was left open; no GPU runs, installer builds or pushes were made.

## Family coverage

| Family | Inspected paths and outcome |
| --- | --- |
| Encoders and gain maps | `exporters.py` shared publication lifecycle, AVIF/JPEG writers and validation helpers; `jpegxl.py`, `jpegxl_stream.py`, `avif_info.py`, `gainmap_decoders.py`, `y4m.py`. Fixed publication overwrite race on Windows, added final permission recheck elsewhere; fixed invalid JPEG XL marker field types. Codec arithmetic and native codec internals unchanged. |
| ICC and colour metadata | Loader bitmap ICC conversion, TIFF profile classification, HEIF/CICP interpretation, JPEG XL declared precision/interpretation, export metadata protected-byte fingerprints. TIFF interpretation questions below were left for approval. |
| CPU strips and memory | `cpu_strips.py`, `cpu_budget.py`, `export_parallel.py`, `delivery_frames.py`, `delivery_memory.py`, resource-preflight declarations and exporter lease/release paths. Corrected stale strip/refusal and row-concatenation memory comments; budgets unchanged. |
| Batch export and Proof | `batch_export.py`, `batch_export_api.py`, `batch_export_worker.py`, `proofing.py`: queue state, child polling, progress publication, staging, collision naming, endpoint storage and content-addressed artifacts. Corrected obsolete serial-worker module description. No additional confirmed defect fixed in these paths. |
| Watermarks | `watermark.py`: owned writable pixels, fitting, HDR/SDR levels, ceiling clamp. Removed duplicate import. Existing watermark tests passed. |
| Import and source interpretation | Loader format dispatch, TIFF layout, bitmap ICC, source override/normalization, `import_jobs.py`, `import_opening.py`, `import_defaults.py`, decoder process cancellation. No image interpretation behavior changed. RAW processing algorithms belong to the other reviewer. |
| EXIF and descriptive metadata | `metadata.py`, `library_metadata.py`, `export_metadata.py`: field extraction, persistent helper lifecycle, privacy filters and protected bytes. Fixed invalid GPS latitude/reference acceptance and ExifTool pipe/exit-callback retention. |
| Sidecars, projects and presets | `projects.py`, `saved_grades.py`, `library_documents.py`, settings-writer conflict/retry paths, `export_presets.py`: fixed newly saved/Save As project conflict tracking, malformed project manifest errors, concurrent preset temporary-file collision and failed-save cleanup. |
| Server/API and workers | Launcher socket/thread setup, main desktop boundary and import/project/export routes, batch API, Library helper start/close. Merged duplicate server export suffix table into existing preset registry. This was source review, not a live server shutdown/stress qualification. |
| Logging | `diagnostics.py`, `export_timing.py`, `export_progress.py`, worker stderr/progress forwarding: reviewed bounded structured fields, action context, error handling and clock ownership. No confirmed change needed. |

Private top-level definitions in the main delivery/import/project/worker modules
were checked against Python backend, tests and tools references. None was
proven unused across those sources. No endpoints or compatibility paths were
removed merely because the frontend did not call them. Cleanup removed roughly
ten original redundant lines (duplicate suffix table/import and unused manifest
assignment), plus replaced inaccurate comments.

## Verification

- Project conflict regression failed before the fix in both new-save and Save As cases;
  project/grade selection: **71 passed**.
- Malformed manifest regression: **5 failed before**, then project manifest/conflict
  selection **7 passed**.
- Metadata helper lifecycle and real descriptive-metadata exports: **11 passed**;
  stronger helper collection/reader-thread assertion: **1 passed**.
- Export publication regression: **1 failed, 1 passed before**; shared export lifecycle
  and metadata selection after fix: **16 passed**.
- GPS regression: **2 failed before**; Library metadata and watermark selection:
  **18 passed**.
- Desktop security and export lifecycle: **12 passed**.
- Strengthened Windows publication test creates the rival file after the final
  permission check: export lifecycle **7 passed**.
- Malformed JPEG XL marker regression: **5 failed before**; JPEG XL marker/helper
  fallback and preset-write selection after fixes: **20 passed**.
- Existing batch preset checks: **2 passed**, 29 deselected.
- Preset concurrent-save and failed-cleanup regression: **2 failed before**;
  included in the passing 20-test selection above.

One intermediate JPEG XL run hit a shared-checkout import error while another
reviewer was introducing `box_blur.py`; retry after that file existed passed.
Full Node/Python suites remain with the parent. No GPU check directly covers
these filesystem, malformed-input and helper-resource changes. No speedup was
implemented or claimed; there are no before/after whole-action timings.

## Decisions for Steve

1. **Atomic refusal to overwrite on macOS/Linux.** Those platforms now recheck
   permission immediately before replacement, but retain a small race window.
   Windows uses atomic non-replacing rename. Plain POSIX rename replaces files;
   hard-link publication would close the window but can break export to FAT/exFAT
   volumes. Recommend a separate platform-native exclusive-rename implementation
   with filesystem tests, retaining removable-drive support. No such filesystem
   compatibility change was made here.
2. **TIFF orientation and ICC interpretation.** The TIFF loader normalizes sample
   axes, but does not apply TIFF Orientation; ICC handling classifies the profile
   name rather than applying arbitrary embedded profiles as the bitmap loader does.
   Fixing these changes the displayed/source pixels of affected TIFFs. Recommend
   explicitly approving a TIFF interpretation follow-up with rotated-tag and
   custom-profile fixtures before altering existing project appearance.

Not qualified here: native codec/vendor internals, exhaustive pixel/format parity,
GPU delivery, native RAW algorithm correctness, long-running process-tree stress,
packaged builds, or macOS/Linux runtime behavior. The main API and very large
processing modules received focused lifecycle/interpretation inspection rather
than a claim of exhaustive line-by-line correctness.
