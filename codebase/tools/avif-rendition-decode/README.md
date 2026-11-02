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

## November 2 bounded AV1 decode memory

Run `python tools/avif-rendition-decode/low_memory_decode.py path/to/libavif`
in addition to `parallel_gainmap.py` before rebuilding the matching DLL/helper.
The helper sets `HDRF_AVIF_TILE_THREADS=1` only inside its own process. The
patched AOM adapter disables row threading for that process and retains tile
workers. Other DLL users keep upstream threading. AOM's row-threaded path
allocates a coefficient/palette `CB_BUFFER` for every superblock in the base
and gain-map images: roughly 1.03/1.37 GB for the measured 13.7/18.0 MP files.
Dropping from 12 threads to 2 does not remove that allocation; one thread
avoids it but is slower. Tile-only decoding avoids it while retaining tile
parallelism. Decoded base/map planes and metadata are copied exactly, then
`avifDecoderDestroy` releases codec frames/scratch before gain reconstruction.

Dimension-derived buffer sizes at 13.7/18.0 MP: original base/map YUV
62/81 MB; each full RGBA surface 110/144 MB; enlarged map YUV 82/108 MB.
The three RGBA surfaces plus enlarged YUV account for 0.41/0.54 GB.

Reconstruction arithmetic and its full-size surfaces are unchanged: decoded
base/map YUV, base RGBA, rescaled map YUV/RGBA, reconstructed RGBA, then the
existing 10-bit YUV / 16-bit RGB boundary. No cropping, reduced decode, new
quantization or lower-precision transport is introduced. The MSVC C build
requires the OpenMP loop index declaration before the loop; the parallel
patch now emits that form.

Whole decode-tree peaks (Python, helper, console hosts) were 0.539/0.687 GB
for 13.7/18.0 MP, and 1.580 GB at 42.2 MP. The existing exact native-transport
check passes; all three real RGB16 output hashes also match the old helper.
The gain-map estimate is 50 bytes/pixel (measured peak plus 25%, rounded up),
64 MB minimum. Plain AVIF retains 56 bytes/pixel; quick preview is unchanged.
CPU colour conversion remains bounded and in place. GPU reconstruction was
dropped by Steve on November 2: insufficient whole-wait gain and no restored
concurrency from reconstruction alone. App timings belong in the performance
table; these offline peaks do not establish a 1 s first-picture claim.
