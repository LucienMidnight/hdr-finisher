# Development Guide

This guide is for contributors changing code, tests, packaging, or technical documentation. For ordinary use, see [Install and run](../getting-started/install-and-run.md).

## Repository layout

```text
ai/
  codebase/
    backend/hdr_finisher/   Python application and color pipeline
    frontend/               Plain HTML/CSS/JavaScript UI
    tests/                  Automated tests and deterministic fixtures
    tools/                  QA, packaging, encoder, and delivery scripts
    bin/                    Optional native encoders and notices
    samples/                Deliberately bundled user-facing media
    local-test-media/       Ignored private/manual inputs
    output/                 Ignored generated evidence and packages
  docs/
    user-guide/             Application behavior
    concepts/               HDR, formats, and color assumptions
    setup/                  OS/display guidance
```

Keep automated tests under `codebase/tests/`, private test media under `codebase/local-test-media/`, and generated evidence under `codebase/output/`.

## Environment

Requires Python 3.12+.

```powershell
cd codebase
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python run_app.py
```

Production dependencies include FastAPI, Uvicorn, Pydantic, NumPy, Pillow, tifffile/imagecodecs, imageio, colour-science, OpenEXR, pillow-heif, and exifread.

## Test tiers

From `codebase/`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run_alpha_qa.ps1
```

The full alpha harness adds JavaScript syntax checks, capability reporting, real sample exports when encoders are present, metadata inspection, and browser layout/preview checks.

Run the relevant suites under `codebase/tests/` for contributor-level verification. Physical HDR display checks remain a separate maintainer validation step.

## Change discipline for color work

Any change to source normalization, adjustment order, reference white, luma coefficients, gamut conversion, PQ/HLG handling, encoder signaling, or gain-map reconstruction should include:

1. A numerical test with known pixels.
2. A behavior test at an edge case.
3. Preview/export parity evidence.
4. A review of both HDR and SDR branches.
5. An update to [Color Pipeline](../concepts/color-pipeline.md).
6. An update to [Traceability](../traceability.md) if a control or module changes.

Do not use screenshots alone to approve color math. Conversely, numerical equality alone does not validate physical browser/display presentation.

## Manual media and generated evidence

- Small deterministic machine fixtures: `codebase/tests/fixtures/`
- Private photographs/large EXRs: `codebase/local-test-media/inputs/`
- Generated screenshots, exports, and reports: `codebase/output/`

Generated output is disposable and must not be the only copy of a conclusion.

## UI checks

The Playwright preview tool exercises the active Chromium/Edge path and layout regressions:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\playwright_preview.ps1
```

Use `-Headed` for visible inspection. Browser automation cannot prove HDR luminance in a headless run; it validates state, rendering mechanics, errors, and layout.

## Packaging

The current Windows package workflow builds the Python sidecar and Electron setup/portable artifacts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_desktop.ps1
```

It writes `HDR-Finisher-Setup-<version>-x64.exe`, `HDR-Finisher-Portable-<version>-x64.exe`, and the unpacked smoke-test target below `codebase/dist-electron/`. Run `npm --prefix desktop run test:packaged` and generate the release checksum manifest after building.

On Apple Silicon macOS:

```bash
cd codebase
./tools/build_desktop_macos.sh
npm --prefix desktop run test:packaged
```

The macOS workflow builds pinned static encoder tools, the PyInstaller sidecar, and unsigned `.app`, `.dmg`, and `.zip` artifacts in `codebase/dist-electron/`. Use `--skip-native-tools` only when the four native tools already exist in `codebase/bin/`. Signing and notarization require an Apple Developer identity and are intentionally separate from the reproducible local technical-preview build.

## API changes

The API is not versioned. When changing a Pydantic model or route:

- Update frontend consumers in the same change.
- Preserve request validation and clear user-facing errors.
- Add or update API tests.
- Update Architecture and any affected module guide.
- Consider stored local browser state migration.

## Dependency and encoder updates

Native encoders affect file compliance, metadata, and decoded color. Pin or record versions, retain upstream licenses, run upstream/real-media checks, and update third-party notices. A binary merely starting successfully is not enough; require real encode, inspect, and decode evidence.
