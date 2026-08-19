# Extended Formats and Media Browser Validation

## Automated gate

From `codebase/` run:

```bash
PYTHONPATH=backend .venv/bin/python -m pytest -q tests
npm --prefix desktop test
```

Run the I/O profiler against representative local media:

```bash
PYTHONPATH=backend .venv/bin/python tools/profile_io_pipeline.py \
  local-test-media/inputs/12mp-gain-map.avif \
  local-test-media/inputs/42mp-gain-map.avif \
  local-test-media/inputs/reference.dng \
  --repetitions 5 --export-formats avif_gain_map jpegxl_hdr
```

The generated report belongs under ignored `codebase/output/performance/`.

## Manual format matrix

For JPEG XL, DNG, and at least one file from each enabled RAW family:

1. Browse a folder containing spaces and non-ASCII characters, pin it, restart, and confirm the pin.
2. Confirm the SDR thumbnail appears and opening begins showing phase/elapsed feedback immediately.
3. Confirm a usable preview appears within 15 seconds on the reference Windows x64 and Apple Silicon
   machines. If full preparation continues, verify the phase text changes or receives a heartbeat at
   least once per second and the window remains interactive.
4. For RAW, test Off, unique Auto, and Manual Lensfun selection. Confirm the named profile and enabled
   correction types appear in metadata, and that a missing saved profile falls back to Off with a warning.
5. Save/reopen a project and confirm RAW settings reproduce exactly.
6. Export JPEG XL HDR, reopen it, and confirm Rec.2020/PQ interpretation is automatic for the app's own
   output. Confirm an unrecognized third-party JXL requests manual interpretation rather than guessing.
7. Select an export directory in the in-app browser, then confirm the native Save dialog starts there
   and still owns overwrite approval.

## Performance release gates

- Reference-corpus time to usable preview: target 10 seconds, maximum 15 seconds.
- AVIF time to first preview: at least 60% faster than the recorded pre-change baseline.
- 42 MP AVIF full-session readiness: at least 25% faster than baseline.
- No supported format's p95 cold import/export regresses by more than 10%.
- Progress appears within 100 ms and stale selection cancellation is acknowledged within 500 ms.

## Apple Silicon development snapshot (2026-08-20)

This is a plumbing check against the bundled 1024×576 gain-map AVIF, not the 12/42 MP release corpus:

- Browser thumbnail: 21.9 ms cold, 0.1 ms cached.
- Full import: 290.8 ms first run, 280.5 ms warm.
- Major decoder phases: 123.8 ms HDR reconstruction, 43.3 ms SDR rendition, 86.3 ms color conversion.
- JPEG XL validated export: 149.2 ms; SDR PNG export: 27.5 ms.
- Peak process RSS growth during the run: 222 MiB. This includes Python, codec, Lensfun, and app modules and
  needs repeating in a fresh process with the full-size corpus before setting a memory budget.

Validation completed with 480 Python tests passing, 91 focused extended-format/API tests passing, seven
desktop unit tests passing, the Electron end-to-end smoke passing, and a frozen backend start/capability
check passing. One pre-existing native Ultra HDR gradient test remains outside this feature gate: the local
encoder produces a longest reconstruction plateau of five samples while that test currently permits four.
