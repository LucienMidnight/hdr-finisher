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
