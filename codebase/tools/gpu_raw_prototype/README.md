# GPU RAW development prototype (October 18, 2026)

Proves that Grade's full-quality camera RAW development can run on the GPU
with the same maths. Not product code; nothing in the app uses it.

What runs on the GPU (WebGPU, `pipeline.js`):

1. Black/white normalisation and as-shot white balance of the sensor mosaic.
2. Opposed-colour highlight repair (darktable method, as in `raw_import.py`),
   with the chrominance residual summed per workgroup and finished on the CPU.
3. LibRaw 0.22.1 AHD demosaic, ported step by step (green H/V, red/blue and
   CIELab, homogeneity maps, combine; `border_interpolate(5)` at the edges).
4. Camera RGB to ACEScg, the import gamut projection, the fixed −0.8 EV
   calibration (and Fuji DR brightness), full-source peaks and the strided
   sample for the robust peaks.
5. Pillow-equivalent bilinear reduction to the Library sizes (640, 2560 px).

Still on the CPU: reading the file and unpacking the mosaic (LibRaw), the
robust-peak quantiles. Not covered yet: X-Trans (Fuji) sensors, Lensfun lens
corrections (the comparison turns them off on both sides), mandatory DNG
operations.

## Run

From `codebase`:

```
.venv/Scripts/python.exe tools/gpu_raw_prototype/prepare.py <photo> [...]
node tools/gpu_raw_prototype/run.js <name> [...]
.venv/Scripts/python.exe tools/gpu_raw_prototype/compare.py <name> [...]
.venv/Scripts/python.exe tools/gpu_raw_prototype/unpack_time.py <photo> [...]
```

`prepare.py` reads photos read-only and writes to `output/gpu-raw-prototype/`.
`compare.py` renders finished SDR and HDR pictures from both developments with
their own starting grades and compares them with `delivery_colour`.

## Result (14 Bayer RAWs, five makes, RTX 4070 Ti)

Every photo passes the agreed limits by a wide margin at both sizes (SDR
ΔE 2000 mean ≤ 0.006, p99.9 ≤ 0.85; HDR ΔE ITP mean ≤ 0.018, p99.9 ≤ 2.8 at
2560 px; ≤ 0.76 at 640 px). All six full-source measurements match. GPU
development takes 0.10 to 0.20 s per photo, end to end including readback,
against 2.0 to 5.6 s for the CPU development. Unpacking adds 0.06 s
(uncompressed Sony) to 0.27 s (compressed CR2/NEF/ORF); sending the mosaic to
the page 70 to 220 ms.

## In the app (branch `gpu-raw-library`)

The same module develops camera RAW grid thumbnails in the Library window
(`library_gpu_raw.py` hands out the unpacked mosaic and stores the result).
That route adds Grade's automatic Lensfun correction on the GPU: vignetting
gain from a small Lensfun grid, then distortion and colour-fringe
coordinates that Lensfun computes at full size every 16 pixels, applied
before the measurements as Grade does. `tests/library-gpu-raw.js` checks it
in the real app against Grade's CPU development (helper:
`compare_library.py`).
