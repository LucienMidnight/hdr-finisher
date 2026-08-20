# Linear DNG Import Feasibility — Initial Findings

**Date:** 2026-08-20

**Branch:** `explore/linear-dng-large-import`

**Status:** Exploration in progress; no production loader integration

## Answer so far

HDR Finisher's installed `tifffile` and `imagecodecs` stack can identify and access the real Alkeria
line-scan DNG. Its image and color metadata qualify for the proposed constrained linear-DNG path.
The current application cannot import it because `.dng` is routed to `rawpy`/LibRaw, which rejects
this file as unsupported.

The test proves structural qualification, codec access, DNG-default resolution, and a bounded-memory
diagnostic color conversion. It does not yet prove visual parity with the producer because a reference
render is not available.

The supplied DxO PhotoLab 9.10 export also decodes successfully after selecting its full-resolution
LinearRaw SubIFD rather than the small preview in IFD0. It is a feasible importer candidate, with one
important correction to the original gate: this real file has ColorMatrix1/2 but no ForwardMatrix.
The prototype therefore demonstrates a diagnostic ColorMatrix fallback, but the production path must
implement and validate the DNG ColorMatrix-only, dual-illuminant transform before DxO support is safe.

Lightroom HDR Merge and Panorama Merge decisions remain open until real files and reference renders
are available.

## Real-file result

| File | Producer | Structure | Decode | Metadata | Visual result | Candidate |
|---|---|---|---|---|---|---|
| `2018-05-26-11-35-40_NECTA0000_…dng` | Alkeria `nectar-preview`, Necta N4K2-7C | DNG 1.4, `LinearRaw`, 72,480 × 4,096, RGB uint16, uncompressed, one page/strip | Pass through read-only `tifffile` memory map; sparse sample and full bounded preview pass | ColorMatrix1, ForwardMatrix1, D65 calibration illuminant, AsShotNeutral, orientation present; no opcode or gain-table recipe | Coherent diagnostic train-scan preview; producer parity not tested | Structurally yes; visual sign-off pending |
| `DSC06885_DxO.dng` | DxO PhotoLab 9.10, Sony ILCE-7RM3 | DNG 1.4; IFD0 is a 248 × 165 preview; full `LinearRaw` is a SubIFD, 7,952 × 5,304, RGB uint16, Compression 7 | Pass through `imagecodecs` full decode; 5,304 × 7,952 × 3 uint16 pixels returned | ColorMatrix1/2, two calibration illuminants, AnalogBalance, AsShotNeutral, BaselineExposure, crop, orientation present; ForwardMatrix absent; no opcode or gain-table recipe | Coherent diagnostic image with matching geometry. Supplied JPEG includes DxO edits, so color/tone parity is not a valid correctness test | **Conditional yes** after a validated ColorMatrix-only transform |
| `lightroom-classic-DNG-test-1.dng` | Lightroom Classic 15.5 DNG export of a camera RAW; not an HDR merge | DNG 1.7; primary SubIFD is 8,000 × 5,320, one-channel CFA uint16, Compression 7. Reduced Fast Load SubIFDs include 1,988 × 1,326 JPEG XL LinearRaw | Primary structure is readable. Installed `imagecodecs` also successfully decoded the reduced JPEG XL LinearRaw proxy | Primary image carries OpcodeList3. Reduced Fast Load LinearRaw carries OpcodeList2 and is marked reduced-image | Not applicable | **Reject**: mosaiced camera RAW, not a linear-DNG source |
| `DSC01204_ACR_Linear.dng` | Adobe Photoshop Camera Raw 18.3, explicit Linear (demosaiced) save | DNG 1.4, full primary SubIFD is 8,000 × 5,320, `LinearRaw`, RGB uint16, Compression 7 | Pass through `imagecodecs` full decode; 5,320 × 8,000 × 3 uint16 pixels returned | Required color, neutral, exposure, crop, and orientation metadata present. OpcodeList3 contains one non-optional WarpRectilinear opcode | Pixel decode and memory preflight pass; correct rendered geometry is not yet proven because the mandatory warp is not implemented | **Conditional no today**; feasible after WarpRectilinear support and reference validation |
| `DJI_0071-2-HDR.dng` | Lightroom Classic 15.5 HDR Merge of two DJI FC3170 DNGs | DNG 1.7; 8,000 × 6,000 primary `LinearRaw`, RGB float16, JPEG XL; reduced LinearRaw pyramid and JPEG XL transparency masks | Pass through installed `imagecodecs` JPEG XL decoder; full 6,000 × 8,000 × 3 float16 payload returned | ColorMatrix1/2, two illuminants, AsShotNeutral, BaselineExposure, crop, and orientation present; ForwardMatrix absent; no opcode lists or gain-table recipe | Coherent bounded full-payload diagnostic preview; producer color parity still needs a neutral reference | **Conditional yes** after validated ColorMatrix-only color handling |

The installed LibRaw path fails on the Alkeria file before development with
`LibRawFileUnsupportedError: Unsupported file format or not RAW file`. A future routing gate must
inspect the DNG before choosing the existing RAW developer.

The DxO topology also proves that inspecting only `tif.pages[0]` is incorrect. The importer must
enumerate TIFF series/SubIFDs, identify the largest primary image rather than a reduced preview, require
that primary image to be LinearRaw, and obtain shared DNG metadata from the root IFD when the selected
raw SubIFD does not repeat it.

The Lightroom export adds a stricter rule: do not accept a file merely because *some* SubIFD is
LinearRaw. With **Embed Fast Load Data** enabled, Lightroom wrote several reduced LinearRaw JPEG XL
proxies alongside the full-resolution CFA primary image. The gate must identify the primary image
(`NewSubfileType = 0`) first and reject the file when that primary image is mosaiced. This fixture
would have been falsely accepted before that rule was added to the probe.

## Resolved DNG defaults

The following absent tags have specified defaults and were resolved rather than treated as missing
metadata:

| Tag | Effective value |
|---|---|
| BlackLevel | 0 for all three channels |
| WhiteLevel | 65,535 for unsigned 16-bit samples |
| AnalogBalance | 1, 1, 1 |
| BaselineExposure | 0 EV |
| ActiveArea | Full 72,480 × 4,096 image |
| DefaultCropOrigin | 0, 0 |
| DefaultCropSize | Full image |

Files with an absent color matrix, calibration illuminant, or AsShotNeutral remain hard failures.
ForwardMatrix absence cannot itself be a hard failure: the supplied real DxO export omits it while
providing dual-illuminant ColorMatrix metadata. The importer must support a validated ColorMatrix-only
path or reject this otherwise-decodable DxO class. Files carrying OpcodeList1/2/3,
ProfileGainTableMap, or ProfileGainTableMap2 remain hard failures until the relevant behavior is
implemented and validated.

## DxO edited-JPEG comparison

The supplied `DSC06885_DxO.jpg` is 4,000 × 2,668. Its aspect ratio matches the 7,952 × 5,304 DNG
to rounding, and the decoded images show the same content, crop, and orientation. The JPEG is brighter,
more contrasty, and more saturated because it includes DxO edits. It cannot establish neutral color or
tone parity with the DNG, and those differences are not importer failures. A neutral DxO render with
edits disabled, or a controlled color-target workflow, is still required for color-transform sign-off.

The diagnostic DNG preview used ColorMatrix1 plus chromatic adaptation because ForwardMatrix is
absent. It deliberately does not claim the complete dual-illuminant default-render transform.

The original `DSC06885.ARW` is present beside the DxO export. A metadata-only LibRaw inspection reports
an 8,000 × 5,320 sensor buffer, consistent with DxO's cropped 7,952 × 5,304 demosaiced output and
the `OriginalRawFileName = DSC06885.ARW` provenance tag. No `rawpy.postprocess()` operation was used.

## Adobe Camera Raw linear conversion

Camera Raw 18.3's explicit **Linear (demosaiced)** save produced a genuine full-resolution LinearRaw
DNG. It is 129,892,982 bytes on disk and decodes to a 255,360,000-byte uint16 RGB buffer. The estimated
retained ACEScg source is 510,720,000 bytes; conservative import and export peaks are approximately
1.0 GiB and 1.45 GiB, both passing on the test machine.

The file contains one OpcodeList3 record: opcode ID 1 (`WarpRectilinear`), minimum DNG version 1.3,
flags 0, and a 164-byte parameter block with three color-plane coefficient sets. Flags 0 means the
operation is neither optional nor preview-skippable. The coefficients are not identity values: the red
and blue planes carry small radial corrections while green is identity, consistent with lateral color
correction. A conforming full-quality import must apply this post-demosaic warp. The prototype therefore
rejects the file for correctness even though decoding itself succeeds.

## Lightroom Classic HDR Merge

The supplied `DJI_0071-2-HDR.dng` closes the major Adobe HDR/JPEG XL feasibility gap. Lightroom Classic
15.5 produced a genuine 8,000 × 6,000 three-channel float16 LinearRaw primary image with DNG JPEG XL
compression. The installed `tifffile`/`imagecodecs` stack decoded the complete 48-megapixel payload.
The 52,161,553-byte file expands to a 288,000,000-byte float16 RGB buffer; estimated retained ACEScg,
conservative import, and conservative export sizes are approximately 549 MiB, 1.07 GiB, and 1.60 GiB.
Both preflights passed on the test machine.

The merged topology contains ten TIFF series: a root preview, the full LinearRaw primary, a full-size
transparency mask, and reduced JPEG XL LinearRaw/mask pyramid levels. The primary image is correctly
marked `NewSubfileType = 0`, so the primary-image selection rule remains valid.

Neither the merged primary nor its root metadata carries OpcodeList1/2/3 or a profile gain-table recipe.
This is notable because both source DJI camera DNGs carry mandatory OpcodeList3 `GainMap` and
`WarpRectilinear` operations. Lightroom appears to have consumed or baked those camera-stage corrections
while creating the merged pixels. Consequently, WarpRectilinear support is **not** required to import
this HDR result correctly.

Like the real DxO file, the merge provides ColorMatrix1/2 but no ForwardMatrix. This second independent
producer result confirms that ForwardMatrix cannot remain a universal acceptance requirement. A
spec-conformant, validated ColorMatrix-only transform is the remaining color-path prerequisite for this
file. The diagnostic preview is coherent, but its simplified single-illuminant fallback is not the final
dual-illuminant implementation and does not constitute producer-parity sign-off.

## Large-source evidence

The image contains 296,878,080 RGB pixels.

| Resource | Estimate |
|---|---:|
| Encoded/uncompressed pixel payload | 1,781,268,480 bytes (1.66 GiB) |
| Retained float32 ACEScg source | 3,562,536,960 bytes (3.32 GiB) |
| 128-row conversion scratch | 111,329,280 bytes (106.2 MiB) |
| Optimistic import peak with direct mapping | 3,942,301,696 bytes (3.67 GiB) |
| Conservative import peak counting the mapped payload | 5,723,570,176 bytes (5.33 GiB) |
| Conservative full-resolution export peak | 9,286,107,136 bytes (8.65 GiB) |

At probe time the Windows machine reported 63.17 GiB total physical RAM and approximately 42 GiB
available. After a provisional 15%-of-total reserve (minimum 2 GiB), both import and export preflights
passed. These estimates are policy prototypes and must be checked against measured peak resident memory
before production use.

The bounded diagnostic preview processed the complete memory-mapped payload in blocks and produced a
2,338 × 132 SDR PNG without allocating the full ACEScg source. Its ACEScg extrema after the experimental
DNG transform were approximately `[0.000035, 0.000141, -0.009407]` to
`[0.805629, 0.628809, 0.539732]` by channel.
Small negative values are plausible matrix-conversion excursions and must be preserved in the working
source rather than clipped; clipping was used only for the diagnostic SDR PNG.

The DxO file is much smaller: 119,141,940 bytes on disk and 253,064,448 bytes decoded as uint16 RGB.
Its estimated retained ACEScg source is 506,128,896 bytes; conservative import and full-resolution
export peaks are approximately 0.97 GiB and 1.44 GiB. Both preflights passed on the test machine. Unlike
the uncompressed Alkeria image, its compressed full-resolution SubIFD cannot be memory-mapped, so the
estimate includes the complete decoded integer buffer.

## Proposed resource and failure policy

1. Read TIFF/DNG directories and estimate resources before decoding pixels.
2. Account for the existing active session because imports are transactional and the old source remains
   live until the new source is accepted.
3. Reserve the greater of a fixed floor and a percentage of total RAM. Validate the provisional policy
   against Windows and macOS measurements rather than treating it as final.
4. Use the conservative estimate for automatic acceptance. If resource detection is unavailable, report
   `unknown_resources`; never claim the operation is safe.
5. Reject before allocation when the estimate exceeds safely available RAM. Include required and safely
   available GiB in the user-facing error.
6. Catch Python `MemoryError`, native decoder allocation errors, mapping failures, and temporary-storage
   exhaustion. Leave the active document unchanged and remove owned temporary outputs.
7. Preflight full-resolution export separately. Import success does not imply export has enough working
   memory.
8. Keep full-resolution pixels in system RAM/file-backed mappings. GPU uploads remain bounded preview
   proxies and must obey the adapter's texture limits independently.

Suggested messages:

- `This image needs approximately 5.33 GiB of working memory; only 4.10 GiB is safely available.`
- `System memory could not be measured. Large-file safety cannot be confirmed.`
- `The image can be previewed, but full-resolution export is estimated to exceed available memory.`
- `Import ran out of memory. The current image was left unchanged.`

## Prototype and repeatability

The isolated probe is `codebase/tools/linear_dng_probe.py`. It performs qualification, installed-codec
checks, sparse decode, system-memory detection, import/export estimates, and an optional bounded preview.
It does not modify `loader.py` or the production RAW path.

From `codebase/`:

```powershell
.\.venv\Scripts\python.exe .\tools\linear_dng_probe.py `
  "<real-linear-dng>" `
  --output .\output\linear-dng\probe.json `
  --preview-output .\output\linear-dng\preview.png

.\.venv\Scripts\python.exe -m pytest -q tests\test_linear_dng_probe.py
```

Generated JSON and previews belong under ignored `codebase/output/`. Real private DNGs belong under
ignored `codebase/local-test-media/inputs/` or may remain at their existing external location.

## Open gates

- Obtain 1–2 more DxO linear DNGs, 2–3 Lightroom HDR Merge DNGs, and 1–2 Lightroom Panorama DNGs.
- Include JPEG XL DNGs from both relevant producers where possible.
- Capture reference renders from each producer and from `nectar-preview` for visual comparisons.
- Implement and validate the complete DNG-to-ACEScg transform in the prototype, including dual-
  illuminant interpolation where present.
- Measure real peak RSS during full-resolution decode, conversion, cancellation, session replacement,
  and export on Windows and macOS.
- Decide how the existing mosaiced RAW convenience path and the brief's requested mosaiced-DNG rejection
  should coexist. The current codebase already develops mosaiced DNG/RAW through LibRaw.

## Current decisions

| Producer/case | Decision |
|---|---|
| Alkeria Necta line-scan DNG | **Conditional yes**: structure and bounded decode pass; reference parity and production memory proof remain |
| DxO PhotoLab 9.10 | **Conditional yes**: full LinearRaw decode, geometry, metadata, and memory checks pass; production requires validated ColorMatrix-only dual-illuminant handling and a neutral reference comparison |
| DxO PureRAW | **No decision**: corpus unavailable |
| Lightroom camera-RAW DNG export with Fast Load Data | **No**: correctly rejected as a mosaiced primary despite embedded LinearRaw JPEG XL proxies |
| Adobe Camera Raw 18.3 explicit Linear save | **Conditional**: full decode and metadata pass, but the mandatory standard WarpRectilinear opcode must be implemented before acceptance |
| Lightroom HDR Merge 15.5, DJI source | **Conditional yes**: full float16 JPEG XL decode, structure, opcode boundary, and memory checks pass; validated ColorMatrix-only rendering and producer-reference comparison remain |
| Lightroom Panorama Merge | **No decision**: corpus unavailable |
