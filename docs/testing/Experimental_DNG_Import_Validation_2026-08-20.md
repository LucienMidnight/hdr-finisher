# Experimental DNG Import Validation — 2026-08-20

## Result

The constrained importer is implemented and automated/structural validation passes on Windows. Every supplied DNG is classified from metadata before payload decode; accepted LinearRaw primaries decode to scene-linear float32 ACEScg, and mosaiced primaries remain on rawpy/LibRaw. The giant Alkeria source uses a bounded preview plan. Import failures are transactional and export admission is independent.

This record does **not** sign off color, geometry, shading, or DJI compatibility. The required neutral producer-reference renders were not supplied, and macOS resource-policy validation has not run. These are release/definition-of-done blockers, not permission to infer correctness from plausible images or the edited DxO JPEG.

## Private corpus controls

All source media was copied, never moved, into ignored `codebase/local-test-media/inputs/linear-dng/`. Its local `manifest.md` records role, byte size, source SHA-256, copied SHA-256, and equality. Source/copy hashes matched for every item. `git check-ignore -v` resolves every copied file and the manifest to `codebase/local-test-media/*`; `git status --short` reports none of them. Validation commands use only these copies.

Do not commit the corpus, manifest, decoded arrays, previews, or local reports. Recheck before every handoff:

```powershell
git check-ignore -v codebase/local-test-media/inputs/linear-dng/manifest.md
Get-ChildItem codebase/local-test-media/inputs/linear-dng -Recurse -File |
  ForEach-Object { git check-ignore -v -- $_.FullName }
git status --short
```

## Locked processing contracts

The implementation is grounded in Adobe's public [DNG 1.7.1 specification and SDK entry point](https://helpx.adobe.com/camera-raw/desktop/dng-and-file-formats/digital-negative.html) and the corresponding reference SDK sources mirrored in Android:

- [GainMap reference implementation](https://android.googlesource.com/platform/external/dng_sdk/+/refs/heads/android14-prebuilt-test/source/dng_gain_map.cpp) establishes pixel-center normalization over image bounds, clamped bilinear map interpolation, pitch handling, and map-plane selection.
- [WarpRectilinear reference implementation](https://android.googlesource.com/platform/external/dng_sdk/+/refs/heads/android14-prebuilt-test/source/dng_lens_correction.cpp) establishes destination-to-source mapping, farthest-corner radius normalization, normalized optical center, radial/tangential equations, per-plane behavior, and clipped source bounds.
- [Adobe bicubic reference kernel](https://android.googlesource.com/platform/external/dng_sdk/+/refs/heads/android14-prebuilt-test/source/dng_resample.cpp) uses extent 2 and `A = -0.75`; the implementation applies it in 64-row chunks.

OpcodeList3 is applied after demosaic/linearization and before DNG camera color conversion, crop, and orientation. GainMap precedes WarpRectilinear in file order. Operations are never applied to the Lightroom HDR merge because its full primary has no opcode list. Required operations disable automatic Lensfun; an explicitly overlapping manual request rejects before decode.

## LibRaw exactly-once audit

Environment: rawpy 0.27.0, LibRaw 0.22.1, Windows. For each supplied DJI single-frame DNG, a local ignored derivative preserved TIFF/DNG structure while replacing GainMap samples with unity and WarpRectilinear coefficients with identity. Original versus neutralized files were compared through both `raw_image_visible` and half-size `postprocess()` output.

Both comparisons were bit-identical: maximum absolute difference `0`, mean difference `0`, and changed-pixel percentage `0%`. Therefore this exact LibRaw build ignores both OpcodeList3 operations. The guarded path requests camera-linear RGB (`output_color=raw`, unity user WB, no auto bright, no rotation), applies GainMap then WarpRectilinear once, performs the DNG matrix conversion, then crops/orients. Any other LibRaw version rejects mandatory OpcodeList3 until the neutralization audit is repeated.

## Automated validation

Targeted integration run after the final opcode correction, before the last matrix-expansion tests:

```text
160 passed, 1 warning
```

The covered contracts include metadata-only inspection, root-preview/SubIFD inheritance, full-primary choice, CFA versus LinearRaw routing, codec/layout/tag rejection, no payload read during inspection, both color paths and numeric vectors, signed/HDR preservation, malformed opcode bounds, GainMap planes/pitch/interpolation/order, WarpRectilinear identity/radial/tangential/per-plane/cancellation/chunking, exactly-once LibRaw gating, Lensfun conflict policy, RAM unknown/pass/reject boundaries, retained sessions, bounded proxies, separate export rejection, and transactional decode/OOM/cancellation failures.

Final full backend suite on the completed tree:

```text
560 passed, 1 skipped, 2 warnings in 25.55 s
```

The warnings are existing Starlette/httpx and naive-UTC deprecations, not DNG failures. The optional real-corpus route test ran because the ignored local corpus was present.

## Real-file Windows matrix

Measurements use the ignored copies. Times are wall clock for the decoder function and working-set deltas are sampled for runs where a valid monitor was active. Min/max are per-channel output values and demonstrate that the decoder itself does not clamp signed or super-white samples. They are not colorimetric validation.

| Input | Route and required work | Full output | Wall time | Peak working-set increase | Result boundary |
|---|---|---:|---:|---:|---|
| Alkeria line-scan | LinearRaw; ForwardMatrix; no opcode | 72,480 × 4,096 RGB float32 | 6.57 s | 5.17 GiB | Decode passed; full GPU texture denied; proxy plan 4,096 × 231; producer visual reference absent |
| DxO PhotoLab DNG | full SubIFD LinearRaw; ColorMatrix-only; no opcode | 7,952 × 5,304 RGB float32 | 1.11 s | 0.72 GiB | Full primary selected; decode passed; edited JPEG is geometry/content context only, not a neutral oracle |
| Lightroom ordinary export | CFA primary despite reduced LinearRaw proxies; WarpRectilinear | 5,304 × 7,952 RGB float32 after crop/orientation | 64.39 s | 1.03 GiB | Decode passed; Fast Load proxy never selected; Warp recorded once; neutral reference absent |
| ACR Linear DNG | LinearRaw; ForwardMatrix; WarpRectilinear | 5,304 × 7,952 RGB float32 after crop/orientation | 63.50 s | 1.03 GiB | Corrected SDK-semantics warp completed; neutral ACR geometry/color reference absent |
| Lightroom HDR merge | float16 JPEG XL LinearRaw; ColorMatrix-only; no opcode | 8,000 × 6,000 RGB float32 | 1.41 s | 0.82 GiB | Decode passed; no GainMap/Warp reapplied; neutral Lightroom render absent |
| DJI_0071.DNG | mosaiced rawpy; GainMap then WarpRectilinear; DNG color | 8,000 × 6,000 RGB float32 | 78.65 s | 1.68 GiB | Both operations recorded once; decoder-neutralization audit passed; visual reference absent |
| DJI_0072.DNG | same guarded route | 8,000 × 6,000 RGB float32 | 78.26 s | 1.68 GiB | Both operations recorded once; decoder-neutralization audit passed; visual reference absent |

The corrected reference bicubic warp is intentionally slower than the discarded early bilinear prototype. Cancellation is checked every 64 warp rows and every 128 gain/color rows. A real DJI decode cancelled 15.52 seconds after start with 0.52 seconds of latency after the 15-second request deadline. A native tifffile/imagecodecs or LibRaw call cannot be interrupted until that call returns; this limitation must remain visible in release notes.

## Repeatable local procedure

From `codebase/`, inspect all copied DNGs without decoding full payloads:

```powershell
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe .\tools\experimental_dng_audit.py
```

Decode selected files and optionally write an ignored JSON report:

```powershell
.\.venv\Scripts\python.exe .\tools\experimental_dng_audit.py `
  --decode DJI_0071.DNG `
  --output output/linear-dng/audit/report.json
```

For visual sign-off, obtain neutral/default full-resolution 16-bit TIFF renders for DxO, ACR, Lightroom HDR, DJI_0071, and DJI_0072 with application/version/settings recorded, plus an Alkeria producer reference if available. Compare crop, corners, straight-line geometry, channel registration, shading uniformity, sampled neutral patches, and scene-linear exposure after separating creative tone curves. Do not use the edited DxO JPEG as the color/tone oracle.

## Exact compatibility envelope

Supported experimentally:

- metadata-selected largest `NewSubfileType=0` primary, including a full SubIFD beneath a root preview;
- contiguous three-channel LinearRaw uint16, float16, or float32 with installed tifffile/imagecodecs compression support;
- ColorMatrix1 plus AsShotNeutral and CalibrationIlluminant1, with optional dual matrices, ForwardMatrix path, camera calibration, analog balance, black/white levels, and baseline exposure;
- square-pixel, unit-DefaultScale crop/orientation variants exercised by the corpus;
- standard OpcodeList3 GainMap and WarpRectilinear variants with one or three warp coefficient sets and bounded row processing;
- mosaiced DNG passthrough through LibRaw, with the guarded camera-linear path only when mandatory supported OpcodeList3 operations are present and the LibRaw version was audited.

Rejected or unclaimed:

- mandatory opcodes outside supported OpcodeList3 GainMap/WarpRectilinear, unsupported opcode variants, and required pixel-shaping tags such as LinearizationTable/delta/profile gain-table maps;
- non-unit DefaultScale, planar RGB, unsupported sample types/compressions, ambiguous/malformed primaries, missing required color metadata, and unsafe/unknown large-file resources;
- Lightroom Panorama, DxO PureRAW, arbitrary producer/camera compatibility, creative rendering parity, and any DNG writing/export;
- color, geometry, shading, DJI visual compatibility, and macOS resource-policy sign-off until their explicit evidence gates pass.

## Open gates

1. Supply the neutral producer references listed above. Without them, visual correctness cannot be signed off.
2. Run the resource accept/reject and peak-working-set matrix on macOS; record hardware, OS, Python/codec versions, and cancellation behavior.
3. Consider optimizing the SDK-equivalent bicubic warp without changing its numeric contract; current 48 MP runs take roughly one minute or more on this Windows machine.
