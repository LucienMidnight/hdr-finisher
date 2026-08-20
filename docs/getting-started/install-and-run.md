# Install and Run

HDR Finisher is currently a technical alpha. Windows x64 and Apple Silicon macOS have native desktop packaging paths. Other platforms should be treated as source-run development environments.

## Requirements

- Python 3.12 or newer
- A current Chromium-family browser for the validated HDR preview path
- An HDR-capable GPU/display chain for visual HDR review
- Optional native encoders for AVIF gain maps and JPEG Ultra HDR

The application works offline. The native desktop shell starts a private local FastAPI sidecar and displays the editor in its own window. Keep the application open while you work. Images remain on the local machine unless you separately upload an export elsewhere.

## Run the Windows release

1. Download the latest `HDR-Finisher-Setup-<version>-x64.exe` from
   [GitHub Releases](https://github.com/LucienMidnight/hdr-finisher/releases).
2. Run the installer and choose the installation directory. The installer creates Start menu and desktop shortcuts.
3. Open **HDR Finisher**. Because technical-preview builds are not yet code-signed, Windows may show an unrecognized-app warning; verify the SHA-256 manifest before continuing.
4. If installation is not desired, download and run `HDR-Finisher-Portable-<version>-x64.exe` instead.

The installer and portable executable contain the Python processing backend and native encoder tools; Python and Node are not required on the destination PC.

## Run the macOS technical preview

1. Download `HDR-Finisher-<version>-macOS-arm64.dmg` on an Apple Silicon Mac.
2. Open the DMG and drag **HDR Finisher** to Applications.
3. Because technical-preview artifacts are not yet Developer ID signed or notarized, Control-click the app in Finder, choose **Open**, then confirm **Open** once. Do not disable Gatekeeper globally.
4. Open `.hdrfinisher` projects from Finder or use the application File menu.

The package contains its Python processing backend and native encoder tools; Python and Node are not required on the destination Mac. Intel Macs are not yet shipped as a binary artifact.

## Run from source

From `codebase/`, create a virtual environment and install development dependencies.

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python run_app.py
```

To run the Electron shell rather than the browser launcher:

```bash
cd desktop
npm ci
npm start
```

### macOS shell

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python run_app.py
```

Open the local address in Chrome, Edge, or Brave. Current physical HDR and delivery validation is Windows/Chromium-focused; see [macOS status](../setup/macos.md).

## Encoder capabilities

The UI reports encoder availability. Missing an encoder does not prevent import, grading, scopes, SDR PNG export, or whichever gain-map backend remains available.

### JPEG Ultra HDR

JPEG Ultra HDR requires a compatible `ultrahdr_app` in `codebase/bin/` or on `PATH`. HDR Finisher rejects the result unless it decodes and contains both Ultra HDR v1 and ISO 21496-1 metadata.

On Windows, the pinned source build can be reproduced with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_libultrahdr_windows.ps1
```

The script requires CMake and Visual Studio 2022 Build Tools, runs upstream tests, and performs a real encode/decode check.

### AVIF gain maps

AVIF gain-map export requires `avifenc`, `avifdec`, and `avifgainmaputil`. The application searches its bundled binary directory and `PATH`.

On macOS, build the pinned static AVIF tools and `ultrahdr_app` with:

```bash
./tools/build_native_macos.sh
```

## Windows technical-preview package

From `codebase/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_desktop.ps1
```

The build packages the private PyInstaller backend, then produces versioned NSIS setup and portable executables below `codebase/dist-electron/`. Run `npm --prefix desktop run test:packaged` before release and publish both executables with `SHA256SUMS-Windows.txt`. The artifacts are not currently code-signed.

## macOS technical-preview package

From `codebase/`, after creating `.venv` and installing `requirements-dev.txt`:

```bash
./tools/build_desktop_macos.sh
```

The build produces an Apple Silicon `.app`, `.dmg`, `.zip`, and SHA-256 manifest below `codebase/dist-electron/`. It builds native encoders, packages the private PyInstaller backend, runs Electron Builder, and does not auto-discover a signing identity by default. Developer ID signing, hardened runtime, and notarization remain release steps once credentials are available.

## Verify the installation

1. Open the application.
2. Choose **Load test pattern**.
3. Confirm the viewer and scopes populate.
4. Check the capability status in Export.
5. On an HDR display, confirm the operating system and browser report HDR capability in the Technical panel.

For contributor-level verification, use the [testing index](../testing/README.md).

## Security and privacy boundary

The server binds to the local loopback address by default. HDR Finisher has no account system or database. Sessions, previews, and temporary encoder files are local and transient; finished exports are written only to the destination you choose.
