# Install and Run

HDR Finisher is currently a technical alpha. Windows has a tested package-building path; other platforms should be treated as source-run development environments.

## Requirements

- Python 3.12 or newer
- A current Chromium-family browser for the validated HDR preview path
- An HDR-capable GPU/display chain for visual HDR review
- Optional native encoders for AVIF gain maps and JPEG Ultra HDR

The application works offline. It starts a local FastAPI server, displays the browser address in its launcher window, and opens a browser launcher page. Choose **Open HDR Finisher**, choose **Copy address** and paste it into another browser, or select and copy the displayed address manually. Keep the launcher window open while using the application. Images remain on the local machine unless you separately upload an export elsewhere.

## Run the Windows release

1. Download the latest `HDR-Finisher-v*-Windows-x64.zip` from
   [GitHub Releases](https://github.com/LucienMidnight/hdr-finisher/releases).
2. Extract the ZIP to a normal local folder.
3. Double-click **HDR Finisher.exe**.
4. Keep the HDR Finisher server window open while you work.

The browser launcher opens automatically. If port 8000 is unavailable, HDR Finisher selects another local port and displays the address. Do not open `frontend/launcher.html` from the source tree; a directly opened HTML file has no application server behind it and will show a `file://` address.

## Run from source

From `codebase/`, create a virtual environment and install development dependencies.

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python run_app.py
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

## Windows technical-alpha package

From `codebase/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_windows.ps1
```

The PyInstaller folder-mode build is smoke-tested and written as a versioned ZIP plus SHA-256 checksum below `codebase/output/package/`. The ZIP contains **HDR Finisher.exe** at its root and is the artifact published to GitHub Releases. It is not currently code-signed.

## Verify the installation

1. Open the application.
2. Choose **Load test pattern**.
3. Confirm the viewer and scopes populate.
4. Check the capability status in Export.
5. On an HDR display, confirm the operating system and browser report HDR capability in the Technical panel.

For contributor-level verification, use the [testing index](../testing/README.md).

## Security and privacy boundary

The server binds to the local loopback address by default. HDR Finisher has no account system or database. Sessions, previews, and temporary encoder files are local and transient; finished exports are written only to the destination you choose.
