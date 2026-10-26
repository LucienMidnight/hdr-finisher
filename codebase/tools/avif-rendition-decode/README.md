# AVIF rendition transport

`hdrf-avif-decode` uses libavif's gain-map reconstruction and preserves the
bundled `avifgainmaputil tonemap` 10-bit YUV to 16-bit RGB boundary. It writes
raw little-endian RGB16 instead of compressing a PNG that Python immediately
decodes. Colour conversion remains with the caller (GPU in Library, CPU when
needed). Unsupported transforms, ICC profiles and alpha retain the ordinary
decoder. A failed or missing executable also retains that decoder.

The Windows executable and `bin/avif.dll` use libavif **v1.4.1**, built in
Release with Visual Studio 2022, `BUILD_SHARED_LIBS=ON`,
`AVIF_CODEC_AOM=LOCAL`, `AVIF_CODEC_AOM_DECODE=ON`,
`AVIF_CODEC_AOM_ENCODE=OFF`, `AVIF_LIBYUV=LOCAL`; other codecs are OFF.
Use libavif's pinned local dependency versions. Licences and patent notices
are in `bin/licenses/` (libavif, libaom and libyuv).

After building that libavif checkout:

```powershell
cmake -S tools/avif-rendition-decode -B output/avif-rendition-decode `
  -DAVIF_SOURCE=C:/path/to/libavif `
  -DAVIF_IMPORT_LIBRARY=C:/path/to/build/Release/avif.lib
cmake --build output/avif-rendition-decode --config Release
```

Copy the resulting executable and matching libavif DLL into `bin/`.
`test_native_avif_transport_preserves_reconstructed_samples_and_cpu_fallback`
checks exact decoded samples against the ordinary bundled utility. Platforms
without this helper continue to use that utility.

## October 26 row-parallel reconstruction

Before configuring the pinned libavif v1.4.1 checkout, run
`python tools/avif-rendition-decode/parallel_gainmap.py path/to/libavif`.
Configure it with `-DCMAKE_C_FLAGS="/DWIN32 /D_WINDOWS /openmp"` on MSVC,
or the corresponding OpenMP compile/link flags on other platforms. Rebuild
libavif and this helper, then copy the matching DLL and executable to `bin/`.
The helper links OpenMP and requests all logical cores; an optional final
`threads` argument (1 through the machine count) supports serial comparison.
The Windows distribution includes Microsoft's vcomp140 runtime, already used
by bundled LibRaw/rawpy. No installer is rebuilt by this batch.

Only independent reconstruction rows are parallel. Gain-map scaling, chroma
sampling, RGB/YUV quantization, primaries, transfer and headroom are unchanged.
CLLI requests remain serial to preserve their floating-point sum order. The
same DLL serves Grade/export imports too. The existing fallback utility remains
available for unsupported ICC/transform/alpha or native errors. Backend logs
report native decode/reconstruction timings and the fallback route.

Still open: GPU reconstruction/transfer and avoiding full-resolution CPU RGB
transport, including exact chroma/gain-map resampling and 10-bit YUV/16-bit RGB
boundary qualification. No 1 s first-picture claim is made without an app trial.
