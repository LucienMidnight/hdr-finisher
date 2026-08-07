# JPEG Ultra HDR Reliability

JPEG Ultra HDR has two independent validation concerns. Do not treat a matrix color mismatch as evidence of gain-map compression damage, or clean edges as proof that color management is correct.

## Failure modes

1. **Gain-map edge artifacts** — half-resolution, quality-85 multichannel gain maps can produce colored pixels, noise, and ringing around hard HDR edges. The shipping default is therefore a full-resolution, quality-100 multichannel gain map. Base JPEG quality remains independently adjustable.
2. **Delivery Matrix color interpretation** — libultrahdr reports `useBaseColorSpace=1` for current HDR Finisher exports and returns linear output in the decoded base gamut (sRGB/BT.709), even though the alternate HDR intent was supplied as BT.2020. Treating that decoded buffer as BT.2020 causes the matrix oversaturation. Proof metadata now records the base/alternate/selected gamut, content-boost range, gamma, HDR capacity, and SDR/HDR offsets.

AVIF gain-map proofing remains on its independent libavif path and is not a reference implementation for JPEG metadata interpretation.

## Automated acceptance

From `codebase/` run:

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests\test_ultrahdr_export.py tests\test_proofing.py
```

The regressions require:

- proof and export commands to use the same base quality, gain-map quality, and gain-map scale;
- full-resolution/quality-100 defaults, with explicit half-resolution overrides still supported;
- the full-headroom JPEG endpoint to use the metadata-selected decoded gamut;
- mean normalized chromaticity error below 1% before matrix AVIF quantization;
- intermediate reconstruction to use the encoded capacity and actual offsets; and
- full and over-capacity reconstruction to equal the decoded endpoint.

The small deterministic gamut tests cover the Rec.709 and Rec.2020 interpretation branches. Full Blender render checks use the local files listed below because renderer outputs are intentionally not committed as CI fixtures.

## Physical iPhone validation

Use `codebase/local-test-media/inputs/iphone-12-pro-HDR.heic` and retain the same edits for both runs.

The repeatable local probe generates both variants, decodes them, and writes edge/fallback metrics under ignored `output/qa/jpeg_reliability/`:

```powershell
.\.venv\Scripts\python.exe .\tools\jpeg_ultrahdr_reliability_probe.py .\local-test-media\inputs\iphone-12-pro-HDR.heic
```

1. Export a diagnostic JPEG with base quality 85, gain-map quality 85, and Half resolution.
2. Export the release-default comparison with base quality 85, gain-map quality 100, and Full resolution.
3. Probe each file with `ultrahdr_app -m 1 -j <file> -P`; record `useBaseColorSpace`, content boosts, capacity, and offsets.
4. Decode the HDR endpoint as linear RGBA half-float and inspect high-gradient edge pixels for isolated red/green outliers. Verify the full/Q100 result does not reproduce the half/Q85 colored-edge defect.
5. Open both artifacts in current Chromium on the HDR monitor. Compare the native live artifact with the Delivery Matrix **Selected fixed-headroom reference**. Judge color relationships and edge cleanliness separately.
6. Open the embedded SDR fallback with a legacy decoder and confirm it remains artifact-free.

Browser-selected headroom is compositor-dependent; it is not guaranteed to equal the nearest nominal DXGI headroom tile.

## Blender gamut validation

Use both local fixtures:

- `codebase/local-test-media/inputs/Blender_5.2_TestScene_LinearRec709_32f.exr`
- `codebase/local-test-media/inputs/Blender_5.2_TestScene_LinearRec2020_32f.exr`

Export and probe each JPEG, then compare decoded full-headroom pixels against the authored HDR endpoint after conversion through the metadata-selected gamut. The normalized chromaticity threshold is below 1% before the proof tile is quantized to AVIF. A Rec.709-decoded buffer interpreted as BT.2020 is expected to fail this threshold substantially and is the regression this test guards against.
