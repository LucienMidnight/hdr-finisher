# Bundled command-line encoders

HDR Finisher resolves executables from this directory first, then from a packaged runtime
`bin/` directory, and finally from `PATH`.

Native encoder executables are intentionally not checked into source. Build the pinned Windows `ultrahdr_app.exe` with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_libultrahdr_windows.ps1
```

The build enables both Ultra HDR v1 XMP (`UHDR_WRITE_XMP=ON`) and ISO 21496-1
(`UHDR_WRITE_ISO=ON`) metadata, uses a static libultrahdr/libjpeg-turbo configuration where
supported, runs upstream tests, performs a real encode/decode validation, and copies required
license and attribution files to `bin/licenses/`. The official project does not publish a Windows
CLI binary, so redistribution must use a locally or CI-built executable plus those notices.

On Apple Silicon macOS, build static `avifenc`, `avifdec`, `avifgainmaputil`, and `ultrahdr_app` binaries with:

```bash
./tools/build_native_macos.sh
```

The script pins libavif and libultrahdr revisions, rejects Homebrew-linked output, runs native tests by default, and copies the required upstream notices into `bin/licenses/`.
