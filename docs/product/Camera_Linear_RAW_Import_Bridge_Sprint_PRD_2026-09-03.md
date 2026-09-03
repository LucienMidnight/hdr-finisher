# Camera-Linear RAW Import Bridge Sprint

**Status:** Complete — engineering qualification and product-owner visual sign-off accepted  
**Prepared:** 2026-09-03  
**Completed:** 2026-09-03  
**Scope:** Short-term correction to the existing mosaiced camera-RAW importer  
**Primary implementation area:** `codebase/backend/hdr_finisher/raw_import.py`

## Executive outcome

Replace the ordinary mosaiced camera-RAW route's bounded LibRaw ACES rendering step with a camera-linear bridge:

```text
camera RAW
    -> LibRaw unpack + existing AHD demosaic
    -> unity-white-balance camera RGB through a 16-bit transport
    -> immediate float32 normalization
    -> as-shot white balance in float32
    -> camera RGB -> XYZ -> ACEScg in float32
    -> existing Lensfun, session, preview, grading, and export paths
```

The purpose is to prevent LibRaw from applying as-shot white balance and output-color conversion before writing a bounded 16-bit RGB result. Those operations can drive a channel into the integer ceiling even when the underlying sensor samples retain useful separation. Once that plateau has been written, converting it to float32 cannot recover the lost ratios.

This sprint keeps LibRaw/rawpy and the current AHD demosaic. It changes where scaling, white balance, and camera-color conversion occur. The initial bridge did not include sensor highlight reconstruction; the approved visual-QA amendment below adds one narrowly scoped method without changing engines.

### Approved visual-QA amendment — opposed-color reconstruction

Product-owner review of the bridge-only build found objectionable magenta in Niagara and both Sony
fixtures. darktable reproduced the magenta with Highlight Reconstruction bypassed and resolved it
with its default **inpaint opposed** method. The sprint therefore includes a NumPy-only,
pre-demosaic `opposed_color_v1` module for qualifying Bayer/RGBG and X-Trans RAWs. It is enabled by
default for new imports, exposes bypass plus one clipping threshold in the module stack, and stores
stable method/version state for future expansion. Old v4 projects without the field load bypassed.

The amendment adapts darktable's documented 3x3 opposed-channel cube-root estimate and nearby
unclipped chrominance correction under the repository's compatible GPLv3 license. It does not add
segmentation, guided laplacians, texture synthesis, hot-pixel repair, denoise, or a LibRaw highlight
mode change. Experimental opcode DNG and Linear DNG semantics remain unchanged.

## Why this sprint exists

`2L1B8631.CR2` is a concrete failure of the current generic RAW path. The current path requests all of the following inside one `raw.postprocess()` call:

- as-shot camera white balance;
- ACES output color;
- linear gamma;
- `output_bps=16`; and
- `HighlightMode.Clip`.

The source contains only four visible-mosaic samples at LibRaw's global white level, yet the current half-size developed image puts approximately 23.25% of the blue channel at the 16-bit maximum. This produces a hot cyan/blue plateau that is not an honest representation of the available sensor separation.

A controlled probe of the proposed bridge on the same file used:

- `output_color=raw`;
- unity user white balance;
- `no_auto_scale=True`;
- `no_auto_bright=True`;
- linear gamma;
- AHD; and
- 16-bit output solely as a transport into float32.

The half-size camera-linear output had channel maxima of approximately `13287`, `13476`, and `13335`, with no samples at `65535`. This proves that useful demosaiced camera-linear separation can cross the current rawpy boundary before white balance and camera-color conversion.

The bug is therefore not that a nominally 12- or 14-bit sensor was stored in a 16-bit container. A 16-bit integer can represent those sensor codes exactly. The bug is that channel gain and color conversion were performed before the bounded container. The short-term fix is to move the float32 boundary earlier, not to invent a nonexistent 32-bit rawpy postprocess mode.

## Product behavior

### Supported route

The new bridge applies automatically to ordinary mosaiced RGB/RGBG Bayer and X-Trans camera RAWs for which LibRaw supplies valid:

- CFA/color-channel description;
- black and white levels;
- as-shot white-balance coefficients; and
- camera RGB-to-XYZ matrix data.

There is no camera-model, filename, exposure, subject, or highlight-content allowlist. Two photographs from the same supported camera must not take different color pipelines merely because one contains bright pixels.

The user-facing workflow gains a **Highlight Reconstruction** module immediately after RAW DEVELOPMENT. Its bypass eye is Off; the v1 method is **Opposed color** with one clipping-threshold control. Import and **Re-develop source** continue to use the saved `RawImportSettings`, and the result remains a contiguous HxWx3 float32 linear ACEScg working image.

### Capability fallback

Unsupported sensor/color models must retain a deliberate compatibility route rather than receiving guessed color:

- layered/Foveon data;
- non-RGB CFA descriptions such as CMYG;
- materially different dual-green coefficients that cannot be mapped deterministically;
- missing, non-finite, singular, or dimensionally invalid camera matrices; or
- missing/non-positive white-balance or saturation metadata after documented fallbacks are exhausted.

The existing LibRaw ACES development may remain as a narrowly named legacy fallback for those cases. Fallback must never be silent: source metadata must record the selected pipeline and reason, and diagnostics must expose the limitation. Every RAW in the primary local suite below is expected to qualify for the new bridge; fallback on one of those six files is a sprint failure.

### Clipping semantics

`HighlightMode.Clip` remains selected for this sprint. Its meaning is narrowed by the bridge: LibRaw performs no as-shot WB or destination-color conversion before returning camera RGB, so it cannot create the same output-space ceiling that caused the Niagara failure.

The implementation must:

- preserve values above normalized `1.0` after WB and color conversion;
- preserve finite negative values produced by the camera-to-working-space matrix;
- never apply a final `np.clip(..., 0, 1)` or equivalent;
- distinguish reported per-channel camera saturation from LibRaw's global/physical processing ceiling in diagnostics; and
- avoid calling pixels "recovered" when their CFA channel was genuinely saturated.

The bridge itself does not reconstruct missing ratios. The approved amendment estimates clipped channel color only where opposing CFA samples provide spatial support; it does not claim to recreate texture where every channel is saturated. `DSC04375.ARW` remains the positive hard-clipping fixture.

## Required implementation

### 1. Isolate the ordinary camera-RAW path

Refactor `decode_raw()` only as far as necessary to make the processing boundary explicit. Suggested focused helpers are:

```python
@dataclass(frozen=True)
class CameraLinearMetadata:
    black_level: np.ndarray
    white_level: np.ndarray
    as_shot_wb: np.ndarray
    camera_to_xyz: np.ndarray
    color_description: str
    normalization_basis: str


def _develop_libraw_camera_rgb(... ) -> tuple[np.ndarray, CameraLinearMetadata]: ...
def _normalize_camera_rgb_float32(... ) -> np.ndarray: ...
def _camera_rgb_to_acescg_float32(... ) -> np.ndarray: ...
```

Names may change, but rawpy parameter selection, metadata validation, normalization, WB, and color conversion must not remain interleaved in one large branch.

Do not rewrite the Experimental DNG opcode route as part of this refactor. Its exactly-once opcode audit and DNG-specific color transform retain their existing semantics.

### 2. Request a neutral camera-linear LibRaw result

For the qualifying ordinary RAW branch, call `postprocess()` with these explicit properties:

```python
demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD
use_camera_wb=False
use_auto_wb=False
user_wb=[1.0, 1.0, 1.0, 1.0]
no_auto_bright=True
no_auto_scale=True
output_color=rawpy.ColorSpace.raw
gamma=(1.0, 1.0)
output_bps=16
highlight_mode=rawpy.HighlightMode.Clip
```

Preserve the current orientation/crop behavior. Do not set `user_flip=0` on the ordinary RAW route unless the existing orientation is reproduced explicitly later.

The 16-bit result is a rawpy/LibRaw transport constraint, not the canonical working representation. Convert it to float32 before applying WB, a camera matrix, exposure scaling, or any operation that can create values outside `[0, 65535]`.

### 3. Normalize without double-subtracting black

LibRaw's `no_auto_scale` path disables `scale_colors()`, which also disables its normal WB/scaling step. The implementation task must confirm and test the bundled LibRaw behavior at the precise postprocess boundary rather than inferring it from variable names.

For the validated bundled behavior, normalize the already black-subtracted camera RGB using per-channel usable ranges derived from:

```text
camera white level - camera black level
```

Use the per-channel camera white levels when valid; otherwise use the documented LibRaw global white fallback. Do not clamp values that exceed the chosen camera-white normalization point. Record whether per-channel or global white was used.

Black subtraction must occur exactly once. Add a synthetic regression that would expose a second subtraction as crushed shadows or negative offset.

### 4. Apply as-shot WB in float32

Validate the as-shot coefficients as finite and positive. Map LibRaw's CFA channel ordering through `color_desc` rather than assuming that list positions always mean RGBG. Normalize the multiplier convention deterministically, with the effective green multiplier as the neutral reference, and document treatment of two green channels.

Apply WB to float32 camera RGB with no clipping. A channel value may legitimately exceed `1.0` after WB.

Do not add auto-WB, expose a new WB UI, or change the saved `RawImportSettings` schema in this sprint.

### 5. Convert camera RGB to ACEScg in float32

Use LibRaw/rawpy's camera RGB-to-XYZ matrix for supported ordinary RAWs. Validate matrix shape, channel ordering, finiteness, and rank. Establish and document the matrix's reference-white convention from the LibRaw API/source used by the bundled version, then use the existing chromatic-adaptation/color utilities to reach ACEScg/D60.

Do not guess the reference white from file extension, camera maker, or scene content. Do not fit a per-image matrix to the old render. The old render is a parity reference only in samples safely below its clipping boundary.

All full-frame operations must use float32 and bounded row strips. Small matrices and metadata calculations may use float64. No full-resolution float64 image is permitted.

### 6. Preserve downstream contracts

The bridge output must enter the same downstream position as the current canonical ACEScg image. Preserve:

- Lensfun order and settings;
- transactional import and cancellation behavior;
- RAW re-development and project association;
- preview/export parity;
- source dimensions, crop, and orientation;
- adjustment and local-mask state across re-development; and
- the existing Experimental DNG routing/opcode contract.

If any canonical pixel cache includes RAW development results, its identity/schema must distinguish the new pipeline. If no such cache exists, record that finding in the validation report rather than adding one.

### 7. Make provenance inspectable

Replace the ambiguous metadata description `16-bit LibRaw linear development` for the new path with fields that distinguish transport from working precision. At minimum record:

```json
{
  "bit_depth": "16-bit LibRaw camera-RGB transport; float32 color development",
  "color_space": "ACEScg",
  "transfer_function": "LINEAR",
  "raw_development": {
    "pipeline": "camera_linear_float_bridge_v1",
    "decoder": "LibRaw",
    "demosaic": "AHD",
    "libraw_output_space": "camera RGB",
    "libraw_output_bps": 16,
    "libraw_auto_scale": false,
    "white_balance_stage": "float32_after_libraw",
    "color_transform_stage": "float32_after_libraw",
    "highlight_mode": "clip",
    "normalization_basis": "camera_white_minus_black"
  }
}
```

Also retain rawpy/LibRaw versions, black/white levels, WB coefficients, matrix qualification result, and legacy-fallback reason where applicable. Field naming may follow existing conventions, but the facts above must remain available for bug reports.

## Local validation corpus

The private corpus is stored at:

`D:\Photos\HDR Test Images\Test Suite Images`

Use the files in place and read-only. Do not copy them into the repository, add sidecars beside them, rename them, or write generated renders into that directory. Automated tests must not require this directory. Opt-in integration tests may use an environment variable such as `HDR_FINISHER_RAW_TEST_SUITE`; when it is absent, skip with a clear reason.

| File | Size | SHA-256 | Sprint role |
|---|---:|---|---|
| `2L1B8631.CR2` | 29,185,235 bytes | `0099C675DE295C68D1292B95100AC076FEF7D365B3A0CD93E4A17EA5B382D62F` | Primary regression: importer-created blue/cyan ceiling despite only four samples at LibRaw global white |
| `DSC00264.ARW` | 85,615,616 bytes | `E646D44A86CEF88FF73AF27ED60A683BF8CE2F7F62110EA042F84FEDC56A4E00` | Sony Bayer exposure/color parity and real clipped-highlight behavior |
| `DSC04375.ARW` | 85,533,696 bytes | `1604AD3C0645B8C26ED8167DAB23452A97ED784E577ED8C6B90F99312ABD3CF3` | Genuine hard-clipping positive fixture; no false claim of reconstruction |
| `Fujifilm_X-E2S_DSCF6495.RAF` | 33,737,348 bytes | `6F30BA88DA509926B1FC0C3F57686F7D687CE113C4D6CE1DF04B8EE94F945128` | Six-by-six X-Trans routing, color, dimensions, and orientation |
| `Nikon_D7500_DSC_3931.NEF` | 25,015,229 bytes | `3A1BC9E4E07005E05105DC03E86CA15D68448E7ED81CF4252D6F59A705F54253` | Unclipped Nikon Bayer negative fixture and low/midtone parity |
| `noisy_canon_IMG_0790.CR2` | 24,381,533 bytes | `E63A0F80FC60EB9BE4CC7504982B9653414B39B0C21ED623966A4500E8D8DED5` | Canon high-signal/noisy regression already used in RAW-highlight feasibility work |
| `iphone_16_pro_IMG_3324.HEIC` | 3,247,539 bytes | `56402D9D9399CCD8DC2E866C278A53D8DD1355F6ED07CA809F385208A21D2000` | Non-RAW route-isolation check; HEIC/gain-map behavior must be unchanged. Product-owner review finds the current starting exposure roughly two stops too hot; investigate HEIC/gain-map exposure interpretation in future work without changing it in this sprint. |
| `line_scan_2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng` | 1,781,269,120 bytes | `700B6705CD6B5F5BE82538A1CD32863DD7A68652D2EB5781CB4FDC8203CC8673` | Linear DNG route/resource-isolation check; do not send through the generic mosaiced bridge |

The current local decoder probe is rawpy `0.27.0` with LibRaw `0.22.1`. Reconfirm the bundled versions in development and packaged builds during implementation.

## Test plan

### Deterministic unit tests

Add or update focused tests for:

1. the exact neutral LibRaw parameter contract, including `no_auto_scale=True` and `output_color=raw`;
2. conversion to float32 before WB or matrix multiplication;
3. per-channel black/white normalization without a second black subtraction;
4. WB mapping through `color_desc`, including RGBG/two-green handling;
5. identity and non-identity camera matrices with a documented reference white;
6. preservation of finite negative and greater-than-one results;
7. rejection/fallback for invalid WB, white levels, matrices, and unsupported color models;
8. no content-dependent route switching;
9. metadata/provenance for bridge and fallback paths;
10. unchanged DNG opcode routing and exactly-once application;
11. unchanged HEIC and Linear DNG routing; and
12. cancellation, Lensfun order, orientation, re-development, and project round trips.

Synthetic tests belong in the committed suite. They must not embed or derive recognizable pixels from private photographs.

### Opt-in real-file qualification

Create a repeatable opt-in test or diagnostic script that:

- verifies every file hash before use;
- records rawpy and LibRaw versions;
- records CFA/color description, dimensions, black/white levels, WB, and matrix validation;
- renders both the legacy baseline and bridge without overwriting either;
- reports per-channel maxima, exact ceiling counts, finite/non-finite counts, and values below/above `1.0`;
- compares exposure and color only in a safely sub-clipped mask;
- records execution time and peak memory when practical; and
- writes results only to an ignored workspace or temporary directory.

The 1.78 GB Linear DNG need only pass metadata routing/preflight in routine qualification. A full decode is reserved for the existing large-file validation workflow.

### Numerical acceptance gates

The implementation is accepted only when all of the following hold:

- Every primary RAW produces finite, contiguous HxWx3 float32 linear ACEScg with the expected oriented dimensions.
- `2L1B8631.CR2` takes the bridge path and no longer exhibits an exact `65535` camera-RGB transport plateau. Float ACEScg values may exceed `1.0`; they must not be capped at exactly `1.0` by the importer.
- The Niagara result retains visible highlight gradation and loses the false cyan/blue ceiling in product-owner review against the darktable reference.
- In pixels where the legacy result is safely below clipping, the new path has no material exposure jump or broad color cast. The validation report must include median and 99th-percentile linear-RGB error, luminance EV difference, and chromaticity difference. Investigate and explain any median exposure shift above `0.05 EV` or 99th-percentile shift above `0.10 EV`; do not normalize it away with a per-image fit.
- `DSC04375.ARW` remains identified as genuinely clipped where its sensor channels reached their hard boundary. The sprint must not invent texture/chroma or label the result recovered.
- Nikon, Sony, Canon, and Fujifilm files all use the bridge rather than legacy fallback.
- HEIC and Linear DNG route selection and canonical pixels remain unchanged within their existing deterministic tolerances.
- Import, re-development, settled preview, and export consume the same canonical pixels.
- The complete existing automated suite passes.

### Performance and memory gates

- No full-frame float64 image is created.
- Color conversion remains row-strip bounded and cancellation-aware.
- Peak live storage must not grow by more than one HxWx3 float32 image compared with the current RAW path; avoid unnecessary `.astype()` plus `.copy()` chains.
- Record median full-resolution import time for `2L1B8631.CR2`, one Sony ARW, and the Fujifilm RAF before and after. Investigate any repeatable slowdown above 20% before accepting the sprint.

## Explicitly out of scope

- Switching globally to LibRaw `Blend`, `ReconstructDefault`, or another highlight mode.
- Additional reconstruction methods such as segmentation, guided laplacians, or texture synthesis.
- Repairing hot/dead pixels or adding denoise.
- Replacing AHD with AMaZE, RCD, Markesteijn, or another demosaic algorithm.
- Integrating librtprocess, RawSpeed, darktable, RawTherapee, or Rawler.
- Camera-profile look tables, DCP/HueSatMap processing, creative camera matching, or a WB editing UI.
- Reworking Experimental DNG opcode application or Linear DNG color processing.
- Treating the 16-bit rawpy transport as a 16-bit canonical working image.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| LibRaw matrix orientation/reference white is misinterpreted | Verify against LibRaw/rawpy API and source; add synthetic matrix tests and sub-clipped parity measurements before production routing |
| Black is subtracted twice | Isolate normalization, test known black/white values, and inspect shadow-floor diagnostics |
| WB convention changes exposure | Normalize coefficients deterministically, prohibit per-image fitting, and enforce EV parity gates |
| Unsupported four-color/non-RGB sensors receive plausible but wrong color | Capability-gate the bridge and expose a named legacy fallback reason |
| X-Trans behavior is accidentally treated as Bayer | Use LibRaw's demosaiced camera RGB and explicitly qualify the supplied RAF |
| New path breaks DNG opcodes | Keep the branch separate and retain exactly-once unit/integration coverage |
| Float conversion increases memory | Convert once, operate in place/strips, prohibit full-frame float64 |
| Decoder upgrade changes semantics | Record rawpy/LibRaw versions and make the real-file qualification repeatable per bundled release |

## Deliverables

1. Camera-linear bridge implementation for qualifying ordinary mosaiced RAWs.
2. Explicit legacy fallback with provenance for unsupported sensor/color models.
3. Focused deterministic unit tests and updated existing mocks.
4. Opt-in private-corpus qualification tooling.
5. Validation report at `docs/testing/Camera_Linear_RAW_Import_Bridge_Validation_2026-09-03.md` containing before/after numerical results, performance, versions, and visual sign-off status.
6. Updated import architecture/user documentation if implementation changes diagnostics or supported-behavior claims.

## Definition of done

The sprint is complete when the Niagara CR2 imports without the false hot/cyan channel ceiling, the other five camera RAWs satisfy the cross-vendor gates, HEIC and Linear DNG remain isolated, all existing tests pass, and the validation report contains enough versioned evidence to reproduce the decision.

**Completion record — 2026-09-03:** All definition-of-done gates passed. Product-owner review accepted the opposed-color v1 result, confirmed the unclipped Nikon fixture passes, and closed the sprint. The documented Sony and Fujifilm edge cases and the iPhone HEIC starting-exposure observation remain future work rather than release blockers for this sprint.

Completion does not imply that genuinely clipped sensor highlights are reconstructed or that LibRaw's demosaic has become the long-term RAW engine.

## References

- [Phase 2 Generic RAW Highlight Feasibility](../testing/Phase2_Generic_RAW_Highlight_Feasibility_2026-08-30.md)
- [Import Pipeline Architecture](../design/Import_Pipeline_Architecture.md)
- [rawpy RawPy API](https://letmaik.github.io/rawpy/api/rawpy.RawPy.html)
- [rawpy postprocess parameters](https://letmaik.github.io/rawpy/api/rawpy.Params.html)
- [LibRaw processing data structures and callbacks](https://github.com/LibRaw/LibRaw/blob/master/doc/API-datastruct.html)
