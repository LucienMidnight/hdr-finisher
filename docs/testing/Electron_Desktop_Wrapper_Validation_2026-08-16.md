# Electron Desktop Wrapper Validation — 2026-08-16

## Outcome

HDR Finisher 0.3.0 has a Windows x64 Electron MVP on `feature/electron-desktop-shell`. The package retains the existing HTML/WebGPU renderer and Python image engine while replacing browser path prompts and the visible Python console with native desktop workflows and a managed private sidecar.

## Architecture decisions

| Decision | Selected implementation |
|---|---|
| Desktop runtime | Electron 43.4.0 |
| Packaging | electron-builder 26.15.3 |
| Renderer transport | Authenticated ephemeral loopback FastAPI origin |
| Backend | Windowless PyInstaller folder-mode sidecar |
| Windows artifacts | NSIS Setup and portable executable, x64 |
| File association | Standard electron-builder `.hdrfinisher` association; NSIS per-machine |
| Renderer security | Sandbox on, context isolation on, Node integration off, popup/navigation/permission denial, restrictive CSP |
| Filesystem boundary | Native selections become short-lived, intent-scoped backend path grants |

## Automated evidence

| Check | Result |
|---|---|
| Python deterministic suite | 451 passed |
| Desktop validation unit tests | 3 passed |
| Browser startup regression | Passed |
| Browser export regression | Passed for SDR PNG and JPEG Ultra HDR |
| Source-run Electron smoke | Passed: sandbox, auth boundary, direct import, project Save As, SDR export, document title |
| Unpacked packaged-app smoke | Passed with bundled runtime and the same import/save/export flow |
| Dependency audit | 285 packages audited; 0 known vulnerabilities reported by npm |

The sidecar contract was also exercised directly: it emitted a versioned ready record on an OS-assigned port, returned 401 for an unauthenticated authoring request, accepted a control-authorized source grant, and retained the durable original source path.

## Packaging observations

PyInstaller reported optional `imagecodecs` DLL warnings for JPEG XS, JetRaw, and its separate HEIF codec module. These are not claimed HDR Finisher input paths; the supported HEIC path remains `pillow-heif`. The packaged smoke test proved the bundled application starts and performs deterministic PNG export. Existing source-run encoder validation continues to pass for JPEG Ultra HDR. Do not narrow the packaged `imagecodecs` set without the representative corpus gate required by the main PRD.

The application intentionally uses Electron's default icon and standard dialogs/window chrome in this MVP. Branding and custom installer presentation are deferred.

## Remaining hands-on checks

The Windows desktop was locked during the first UI-control pass, so native dialog appearance and physical HDR/WebGPU behavior still require the user-visible hands-on pass below:

1. Install the NSIS artifact and accept the expected unsigned-build Windows warning.
2. Import representative EXR, TIFF, HEIC, AVIF, and JPEG Ultra HDR sources with spaces and non-ASCII characters in their paths.
3. Save, close, reopen, Save As, relink a deliberately moved source, and double-click a `.hdrfinisher` project.
4. Export AVIF gain map, JPEG Ultra HDR, and SDR PNG; use Reveal and Open on each completed output.
5. Build a Chromium proof and open the short-lived read-only proof in the default browser.
6. Confirm true-HDR preview and WebGPU fallback behavior on the intended HDR display.
7. Confirm normal quit, forced Electron termination, and second launch leave no backend process.

Generated installers, portable packages, screenshots, and exports remain ignored build evidence under `codebase/dist-electron/` and `codebase/output/`.
