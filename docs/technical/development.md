# Development Guide

This guide is for contributors changing code, tests, packaging, or technical documentation. For ordinary use, see [Install and run](../getting-started/install-and-run.md).

## Repository layout

```text
ai/
  codebase/
    backend/hdr_finisher/   Python application and color pipeline
    frontend/               Plain HTML/CSS/JavaScript UI
      app.js                Startup calls
      app-boot.js           Startup and event wiring
      app-state.js          Shared state, constants and element references
      *-ui.js, other files  Feature functions (see code map)
      gpu-render-plan.js    Plans, memory estimates and halos
      gpu-params.js         Adjustment buffers and curves
      gpu-param-layout.js   Global shader names and fixed positions
      webgpu-preview.js     Renderer class
      webgpu-shaders.js     Shader sources
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
    technical/              Architecture, development and technical notes
      archive/              Closed dated technical records
    product/                Sprint plans and completion records
```

Keep automated tests under `codebase/tests/`, private test media under `codebase/local-test-media/`, and generated evidence under `codebase/output/`.

Frontend scripts use the existing shared page scope and fixed script order.
Register each new file in `frontend/index.html`. Update the [code map](code-map.md)
with a source move. Renderer parts are listed in `tests/frontend-source.js`;
existing numeric source pins resolve shader names through the production
layout, while `gpu-param-layout.test.js` audits raw writers and shader readers.
Technical documents belong under the repository's `docs/technical/`, not
`codebase/docs/technical/`.

## Environment

For a fresh clone **or agent worktree**, run from the repository root:

```bash
# macOS / Linux
./codebase/tools/setup.sh
```

```powershell
# Windows (no administrator session required)
powershell -NoProfile -ExecutionPolicy Bypass -File .\codebase\tools\setup.ps1
```

Re-run the same command after pulling. Install Git, Node/npm and Python **3.12**
first; `HDR_FINISHER_SETUP_PYTHON` can name that interpreter. Windows uses
`py -3.12` when available. Native builds additionally need Apple's command-line
tools on macOS, or the compiler/CMake/NASM/pkg-config dependencies listed in the
Desktop release Linux job. Setup installs CMake into the Mac venv.

Setup creates `codebase/.venv`, installs `requirements-dev.txt`, runs `npm install`
in `codebase` and `codebase/desktop`, fetches the pinned ExifTool runtime, and
builds macOS/Linux encoders with their upstream checks. First setup can take
several minutes. A recipe/architecture fingerprint and executable hashes let
subsequent worktrees reuse the validated native tools beside the main checkout.
Unknown old binaries are rebuilt once. Build scratch is removed on success or
failure; upstream scripts always receive a space-free physical build path.
Windows continues using the committed encoder executables.

### One machine settings file

`hdr-finisher-machine.json` sits beside the **main checkout**, outside all agent
worktrees. Git's common directory finds it even when an agent worktree is under
`.t3/worktrees`. Setup writes defaults once; re-runs preserve your settings.
`HDR_FINISHER_MACHINE_SETTINGS=/absolute/path/to/file.json` selects a different
shared file (for a clone in another parent folder, for example). Paths inside
JSON may be absolute or relative to that file. The fields are:

| Field | Default |
| --- | --- |
| `windowSize` | `1408x794` on macOS; `2560x1440` on Windows/Linux |
| `photosRoot` | `D:/Photos` on Windows; `Photos` beside the settings file otherwise |
| `testFixturesRoot` | `test-fixtures` beside the settings file |
| `sharedTestPhotos` | Main checkout's existing `codebase/output/test-photos` |
| `sharedLocalTestMedia` | Main checkout's existing `codebase/local-test-media` |
| `lockFolder` | Main checkout's parent folder (the existing wrapper's lock) |
| `nativeToolsRoot` | `native-tools` beside the settings file |

The photo defaults deliberately reuse the existing private folders without
moving Steve's files. Point them at other shared machine folders if desired.
Setup links those folders into each worktree (directory junctions on Windows,
symlinks elsewhere); it never copies RAWs per worktree or replaces a nonempty
folder. Missing private media is listed at the end; setup cannot download it.
Supply the same named photos/fixtures from Steve's other machine, then rerun.
The report includes mixed-fixture sizes, protected projects and literal external
photo dependencies; computed filenames and user-provided arguments still need
their driver's input set. Missing private media does not fail dependency setup.

`HDR_FINISHER_PHOTOS_ROOT` and `HDR_FINISHER_ELECTRON_WINDOW_SIZE` remain explicit
one-run overrides. The Python used by JavaScript tools defaults to this
worktree's `.venv/Scripts/python.exe` on Windows or `.venv/bin/python` elsewhere;
`HDR_FINISHER_PYTHON` remains available. No compatibility symlink is needed.

### GPU / real-app checks

From `codebase`, always take the one shared lock:

```bash
.venv/bin/python tools/gpu-run-lock.py --label my-library-check -- node tools/quick-library-check.cjs --label=my-library-check
.venv/bin/python tools/gpu-run-lock.py --label my-gpu-check -- node tests/run-in-electron.js tests/webgpu-shader-compilation.js
npm run test:release -- --plan
```

On Windows replace `.venv/bin/python` with `.venv/Scripts/python.exe`. For an
approved focused release run, set `--minutes 75` and run
`npm run test:release -- --release` through the same wrapper. Planning starts no
GPU process. Release selection, retry rules and all three protected-project
hashes are unchanged. The machine's window size is used by the launchers,
quick check and release runner.

The wrapper uses atomic directory acquisition, waits for legacy `gpu-check.lock`
holders, and acquires the parent `gpu-run.lock` even if `lockFolder` is changed.
The existing parent wrapper therefore interoperates during handover. No tracked
`gpu-lock.cjs` remains on this branch; do not restore a separate lock. Dead
owners may be recovered after 60 minutes; a live owner is never broken merely
because it is old. The owner heartbeat also prevents the old wrapper from
aging out a live in-repo holder. Timeouts/interruption stop the entire owned process tree;
failed shutdown retains the lock. Do not remove another agent's live lock.

Fast checks do not need the GPU lock:

```bash
node --test tests/*.test.js
.venv/bin/python -m pytest tests -q
```

Pytest sets disposable app-data, local-data and source-cache roots **before test
collection**, including subprocesses, and removes them when done. This prevents
`codebase/HDR Finisher/Cache` and `library.sqlite3` appearing in the repository.
The real application's POSIX cache-location fallback is unchanged; see
[known limitations](../known-limitations.md).

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

On Linux x86_64, `./tools/build_desktop_linux.sh` builds pinned native tools, runs their upstream tests, packages the Python 3.12 sidecar, runs Electron tests, and creates the `.deb` plus checksum manifest. Release `.deb` builds run on Ubuntu 22.04 for a conservative glibc baseline; physical HDR acceptance runs on Kubuntu 26.04/Plasma 6.6. The custom Flatpak manifest and offline source lists are under `packaging/flatpak/`.

## API changes

The API is not versioned. When changing a Pydantic model or route:

- Update frontend consumers in the same change.
- Preserve request validation and clear user-facing errors.
- Add or update API tests.
- Update Architecture and any affected module guide.
- Consider stored local browser state migration.

## Dependency and encoder updates

Native encoders affect file compliance, metadata, and decoded color. Pin or record versions, retain upstream licenses, run upstream/real-media checks, and update third-party notices. A binary merely starting successfully is not enough; require real encode, inspect, and decode evidence.
