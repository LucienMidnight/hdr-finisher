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

On Linux x86_64, build the same pinned command-line tools with:

```bash
./tools/build_native_linux.sh
```

The Linux build uses static codec dependencies where possible, runs the upstream test suites,
rejects missing or unexpected build-host ELF dependencies, exercises each command-line tool,
and installs the required notices into `bin/licenses/`. Run it on Ubuntu 22.04 when producing
release binaries so the packaged tools retain the project's conservative glibc baseline.
