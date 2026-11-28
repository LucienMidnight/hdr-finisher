# Development and research tools

Use the [development guide](../../docs/technical/development.md) for the
supported setup, build and test workflows. The [test catalogue](../../docs/technical/test-catalogue.md)
lists registered test drivers. This index calls out older and hand-run tools
that are easy to mistake for current app or release entry points.

| Tool | Status | Purpose |
| --- | --- | --- |
| [GPU RAW development prototype](gpu_raw_prototype/README.md) | History | Isolated proof of full-quality Bayer development on WebGPU. The app does not import it. |
| [HSL colour-range prototype](hsl-prototype/README.md) | History | Standalone picker and colour-range experiments. It has its own window and does not use the app backend. |
| [Legacy Windows package builder](build_windows.ps1) | History / manual | PowerShell staging, packaging and startup smoke check for the older standalone Windows build. Use the development guide for the current Desktop release process. |
| [Library scroll analyser](analyze-library-scroll.py) | Manual | Summarises retained grid pictures and Windows process-memory ownership from an existing measurement folder. It does not launch the app. |
| [Local media probe](local_media_probe.py) | Manual | Reads private HEIC, EXR and HDR samples and records import/preview behaviour, with an optional AVIF gain-map export. Keep inputs and receipts local. |
| [Scope pipeline profiler](profile_scope_pipeline.py) | Manual | Times the backend scope phases independently on supplied inputs. It does not measure the whole app wait. |
| [Round 4 Denoise reproduction](denoise_eval/round4/reproduce.sh) | History / manual | Rebuilds the [research study](../../docs/technical/research/denoise-v1-2026-11-16/predemosaic-round4.md) from locally retained Round 3 source and staging. Results stay in output. |

## Library JPEG investigation tools

These are three distinct manual probes, not interchangeable tests. They
retain investigation-specific assumptions about photos, output folders and
launch settings. For any reuse, follow the current development guide's
shared GPU lock, test-profile and owned-process rules.

| Tool | Status | Question it answers |
| --- | --- | --- |
| [Single JPEG failure probe](check-library-jpeg-loop.cjs) | History / manual | Can the known JPEG develop and store a 640 px scene within the bounded wait? Captures RGB development errors and inputs. Baseline mode records a failure without asserting success. |
| [Mixed-folder grid check](check-library-jpeg-folder.cjs) | History / manual | Do all 18 cells in the staged RAW/JPEG folder actually present once, without failed or restarted development? Records camera placeholders and finished on-screen presentations separately. |
| [Isolated JPEG or RAW measurement](measure-library-jpeg.cjs) | Manual | What peak GPU bytes, development-stage events and memory-budget request count and duration does one scene report? It does not assert a grid presentation or diagnose the known JPEG specifically. |
