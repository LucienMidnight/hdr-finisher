# Bundled command-line encoders

HDR Finisher resolves executables from this directory first, then from a packaged runtime
`bin/` directory, and finally from `PATH`.

Build the pinned Windows `ultrahdr_app.exe` with:

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

The Windows `hdrf-avif-decode.exe` and matching `avif.dll` provide the raw
AVIF gain-map rendition transport. Build instructions and the pinned libavif
configuration are in [tools/avif-rendition-decode](../tools/avif-rendition-decode/README.md).
Other platforms retain the ordinary rendition decoder until this helper is built.

## Source metadata

From codebase, run `.venv/Scripts/python.exe tools/fetch_exiftool.py` (Unix:
`.venv/bin/python tools/fetch_exiftool.py`). This downloads ExifTool 13.59 from
the pinned vendored 13.59.3 archive, verifies SHA-512 and retains all licence,
source and patch files under `exiftool-runtime/`. That generated folder is not
committed. Desktop build scripts fetch/check it before packaging; the packaged
app check executes its copy. Windows includes Perl; macOS uses /usr/bin/perl;
Debian declares perl and Flatpak builds its own /app/bin/perl. A missing helper
fails metadata-bearing exports explicitly. Metadata=None without templates
continues to need only the encoder's own colour/HDR signalling.
