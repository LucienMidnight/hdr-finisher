# Bundled command-line encoders

HDR Finisher resolves executables from this directory first, then from a packaged runtime
`bin/` directory, and finally from `PATH`.

`ultrahdr_app.exe` is intentionally not checked into source. Build the pinned Windows binary with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build_libultrahdr_windows.ps1
```

The build enables both Ultra HDR v1 XMP (`UHDR_WRITE_XMP=ON`) and ISO 21496-1
(`UHDR_WRITE_ISO=ON`) metadata, uses a static libultrahdr/libjpeg-turbo configuration where
supported, runs upstream tests, performs a real encode/decode validation, and copies required
license and attribution files to `bin/licenses/`. The official project does not publish a Windows
CLI binary, so redistribution must use a locally or CI-built executable plus those notices.
