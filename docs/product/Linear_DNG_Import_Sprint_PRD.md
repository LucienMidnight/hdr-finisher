# Experimental DNG Import and Large-File Safety Sprint

**Status:** Implemented on the exploration branch — experimental validation in progress
**Prepared:** 2026-08-20  
**Target branch:** `explore/linear-dng-large-import`  
**Production code status:** Implemented on `explore/linear-dng-large-import`; compatibility sign-off remains evidence-gated
**Related investigation:** [Linear DNG Import Feasibility — 2026-08-20](../testing/Linear_DNG_Import_Feasibility_2026-08-20.md)

## Executive outcome

Implement a constrained, metadata-driven **Experimental DNG Import** feature that can open the verified Alkeria line-scan, DxO PhotoLab Linear DNG, Adobe Camera Raw Linear DNG, and Lightroom Classic HDR Merge families without disrupting the existing mosaiced camera-RAW path. Extend DNG opcode handling far enough to apply standard `GainMap` and `WarpRectilinear` operations for the supplied DJI single-frame mosaiced DNGs as an experimental convenience path.

The importer must inspect and qualify the file before allocating its full pixel payload, convert accepted input into HDR Finisher's scene-linear float32 ACEScg working representation, preserve negative and greater-than-one values, and fail transactionally with clear resource or capability errors. Producer names are diagnostic information, not an allowlist.

This is intentionally not a promise to import every DNG, camera, or producer configuration. The UI and diagnostics must label the feature **Experimental DNG Import**. Unsupported mandatory opcodes, unimplemented image-shaping metadata, unsupported compression, unsafe resource requirements, and malformed topology must be rejected before expensive decode whenever possible. “Experimental” permits a deliberately narrow compatibility envelope; it does not permit silent omission of mandatory corrections or knowingly incorrect pixels.

## Why this sprint exists

The motivating line-scan DNG is a valid, very large Linear DNG rather than a conventional camera mosaic. It is structurally importable, but a naive full-frame pipeline can need several times the file size in RAM and can exceed GPU texture limits even on a capable workstation. Further testing found two additional practical requirements:

1. A DNG's root IFD can be only a preview; the full image can be a SubIFD.
2. Valid Linear DNGs from DxO and Lightroom HDR Merge can omit `ForwardMatrix`, so a ForwardMatrix-only implementation would reject important target files.

The existing loader currently routes every `.dng` through `rawpy`. The new implementation must classify DNG topology first, route accepted Linear DNGs to the new decoder, and let ordinary mosaiced DNGs continue through the existing RAW importer.

## Evidence baseline

The following private samples are machine-local validation inputs. Do not copy them into the repository or automated fixtures.

| Sample | Verified structure | Initial outcome |
|---|---|---|
| `D:\Photos\HDR Test Images\2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng` | Alkeria line-scan; DNG 1.4; 72,480 × 4,096; RGB uint16; uncompressed; `LinearRaw`; `ColorMatrix1` and `ForwardMatrix1`; no opcodes | Target for initial support; visual parity still needs a producer reference |
| `D:\Photos\2026\20260725\DSC06885_DxO.dng` | DxO PhotoLab 9.10; root preview plus full 7,952 × 5,304 RGB uint16 `LinearRaw` SubIFD; lossless JPEG; dual ColorMatrix; no ForwardMatrix; no opcodes | Target for initial support through the ColorMatrix-only path |
| `D:\Photos\Lightroom Classic HDR\lightroom-classic-DNG-test-1.dng` | Ordinary Lightroom DNG export; full primary is 8,000 × 5,320 one-channel CFA mosaic; reduced LinearRaw JPEG XL Fast Load proxies also exist | Must bypass the Linear DNG route and continue through the existing mosaiced RAW importer |
| `D:\Photos\Lightroom Classic HDR\DSC01204_ACR_Linear.dng` | ACR 18.3 explicit Linear DNG; full 8,000 × 5,320 RGB uint16 primary; lossless JPEG; full matrix metadata; mandatory `WarpRectilinear` opcode | Target for initial experimental support after WarpRectilinear implementation and reference validation |
| `D:\Photos\HDR Test Images\DJI Samples\DJI_0071-2-HDR.dng` | Genuine Lightroom Classic 15.5 HDR Merge; DNG 1.7; 8,000 × 6,000 RGB float16 primary; JPEG XL DNG compression; dual ColorMatrix; no ForwardMatrix; no opcodes | Target for initial support through the ColorMatrix-only path |
| `D:\Photos\HDR Test Images\DJI Samples\DJI_0071.DNG` and `DJI_0072.DNG` | Original DJI mosaiced source frames; contain mandatory OpcodeList3 `GainMap` and `WarpRectilinear` operations | Initial experimental direct-RAW target. Existing rawpy demosaic remains responsible, but acceptance requires proof that both mandatory operations are applied exactly once and in the correct DNG stage/order |

Additional facts established by the probe:

- The Alkeria file is approximately 1.78 GB. Its pre-implementation model estimated approximately 5.33 GiB for import and 8.65 GiB for full-resolution export; the measured JPEG XL export below shows that the export estimate was materially low for this extreme-width case.
- The Lightroom HDR primary payload has been fully decoded with the installed `tifffile`/`imagecodecs` stack as a `(6000, 8000, 3)` float16 array.
- The DxO full primary payload has also been decoded successfully.
- The existing DxO JPEG is an edited render. It confirms content and geometry but is not a neutral color/tone reference.
- Lightroom's Fast Load JPEG XL proxies are reduced derived images and must never cause a mosaiced primary to be classified as Linear DNG.
- The current development environment uses rawpy 0.27.0 with LibRaw 0.22.1. Reconfirm bundled versions and codec flags in packaged Windows/macOS builds rather than assuming development-machine behavior.

### Measured Alkeria full-resolution export result — Windows, 2026-08-20

The implemented branch successfully imported and rendered the full 72,480 × 4,096 Alkeria line-scan image, then exported it as a single JPEG XL file. This is strong evidence for the large-file path and the bundled JPEG XL codec, but it is not colorimetric sign-off: the Alkeria producer/reference render is still unavailable.

| Check | Result |
|---|---|
| Output | Single-file JPEG XL, 72,480 × 4,096 |
| Encoded interpretation | 12-bit Rec.2020 PQ; application marker reports 100-nit reference white |
| File size | 83,809,271 bytes (approximately 79.9 MiB) |
| SHA-256 | `4F2EEEA09E2FA401980A182DD76DD33812ECCF150C74B32FBED4D437B4DD9CE0` |
| Bundled codec under test | `imagecodecs` 2026.6.26 with libjxl 0.11.2 |
| In-application validation | Passed a complete decode before the staged file was atomically published; decoded dimensions, finite samples, 12-bit range/precision, and the Rec.2020 PQ application marker were checked |
| Independent local codec checks | `imagecodecs.jpegxl_check` returned true; a synthetic 1 × 72,480 encode/decode probe also passed, confirming this bundled libjxl accepts the source width |
| Peak export-backend memory observed | Approximately 20.3 GiB working set and 20.8 GiB private bytes; monitoring began after processing started, so this is an observed peak rather than a guaranteed absolute peak |
| Windows open test after HDR Finisher exited | Opened successfully through the Windows Photos/shell path; after more than one minute it stabilized near 19.0 GiB private bytes for Photos and approximately 20.2 GiB private bytes across Photos, Explorer, and `dllhost`, with approximately 37.1 GiB system RAM still available |

The same source did not export through the other two attempted delivery formats. AVIF returned `Failed to encode image: Invalid argument`; this establishes failure in the tested encoder/build but does not by itself identify a standards-level maximum dimension. JPEG Ultra HDR rejected the image explicitly because its implementation limits dimensions to 8,192 × 8,192. These outcomes make direct JPEG XL the only verified single-file delivery path for this 72,480-pixel-wide sample in the current Windows build.

One earlier Windows shell attempt, with concurrent Photos/Explorer codec activity, exhausted available RAM while Photos and `dllhost` held very large private allocations. The controlled retest above stabilized safely after HDR Finisher was closed. Treat shell thumbnail/preview generation as a separate high-memory consumer, warn users before opening giant outputs in another application, and do not infer low-memory interoperability from successful encoding alone.

The user reports that other applications they tried could not open this output. Application names, versions, and failure modes were not captured, so this is useful qualitative product feedback rather than an independently verified compatibility comparison. Do not turn it into a general claim that HDR Finisher or JPEG XL supports more applications or files.

## Private local-media staging

At the start of implementation, **copy, do not move**, the real test media into:

`codebase/local-test-media/inputs/linear-dng/`

The source files must remain in their original photo-library locations. Preserve each filename and organize the copies into descriptive subfolders such as `alkeria-linescan/`, `dxo-linear/`, `lightroom-ordinary/`, `acr-linear/`, and `lightroom-hdr/`. Include:

- every DNG listed in the evidence table;
- both DJI source DNGs used to create the HDR merge;
- the original Sony ARW beside the DxO DNG;
- the edited DxO JPEG, labeled in a local manifest as geometry/content evidence only;
- neutral TIFF/JPEG producer references when they become available.

Do not commit a manifest containing the user's external absolute photo-library paths. Create a local-only manifest inside the ignored folder with filenames, roles, byte sizes, and SHA-256 hashes so later runs can verify that the copied corpus has not changed.

Repository `.gitignore` currently ignores `codebase/local-test-media/*` while retaining only its tracked README. The implementation task must nevertheless verify privacy before and after copying:

```powershell
git check-ignore -v codebase/local-test-media/inputs/linear-dng/<sample-file>
git status --short --untracked-files=all
```

Every private-media path must be reported by `git check-ignore`, and none may appear in `git status`. If any file is not ignored, stop before staging or committing and fix the narrow ignore rule first. Never use `git add -f` for this corpus. Automated tests must not depend on these files being present; local/manual tests should skip with a clear reason when the corpus is absent.

## Product behavior

### Routing

```text
.dng selected
    |
    v
metadata-only DNG inspection
    |
    +-- full primary is supported 3-channel LinearRaw --> resource preflight --> Linear DNG decoder
    |
    +-- full primary is CFA/mosaiced ------------------> existing rawpy RAW decoder
    |
    +-- malformed/unsupported/unsafe -----------------> precise early rejection
```

Classification must describe the full primary image, not merely the first IFD or any convenient LinearRaw series.

Recommended internal outcomes:

- `linear_dng`
- `mosaiced_raw_dng`
- `unsupported_dng`
- `invalid_dng`

### Broad mosaiced-DNG compatibility goal

The convenience goal is that **most ordinary mosaiced DNG camera files that LibRaw can develop should continue to open without special producer code**. In this document, “mosaiced DNG” means a CFA camera RAW that still needs demosaicing; it is distinct from a demosaiced/Linear DNG.

Use this acceptance ladder:

1. A standards-conformant mosaiced primary with no mandatory unsupported pixel operations routes directly through the existing rawpy/LibRaw development path.
2. A mosaiced primary requiring only verified decoder operations and/or the implemented standard GainMap and WarpRectilinear variants is accepted, with every operation recorded and applied exactly once.
3. Unsupported optional operations may be skipped only when the DNG flags permit it, with a diagnostic warning.
4. An unknown or unsupported mandatory operation produces a specific experimental-capability rejection rather than a damaged but plausible image.
5. A LibRaw decode failure retains its useful decoder detail and does not get misreported as a Linear DNG failure.

This design should maximize practical compatibility while remaining producer-agnostic. “Most” is a compatibility objective measured against the available multi-camera corpus, not a universal promise. Add any group-contributed files only to the ignored local corpus and record anonymized structural outcomes in the durable validation log.

### User-visible success

An accepted Linear DNG opens as a normal HDR Finisher session with:

- scene-linear float32 ACEScg pixels;
- `0.18` retaining the application's existing 100-nit diffuse-white convention;
- negative and greater-than-one channel values preserved;
- correct primary selection, crop, orientation, white balance, exposure baseline, and matrix color conversion;
- producer, DNG version, dimensions, compression, source sample type, selected IFD/series, color path, and skipped optional metadata recorded for diagnostics;
- no attempt to upload the full source as a GPU texture when it exceeds adapter limits.

The import surface, progress UI, source diagnostics, and format-support documentation must display **Experimental DNG Import** (or an equally explicit experimental badge). The message should explain that the importer is tested against a limited sample matrix and may reject valid but untested DNG variants rather than guessing.

### User-visible failure

Failures must say what is unsupported or unsafe and leave the current document unchanged. Avoid generic messages such as “could not decode DNG” when the inspector knows the reason.

Examples:

- `This DNG's primary image is mosaiced camera RAW; it will be opened by the camera RAW importer.` This is a route decision, not an error.
- `This Experimental DNG requires an unsupported mandatory opcode: FixBadPixelsList (OpcodeList1, opcode 5). No correction was skipped.`
- `This Linear DNG uses unsupported compression 34892.`
- `Opening this 72,480 × 4,096 Linear DNG is estimated to require 5.3 GiB of additional memory; only 3.8 GiB is safely available.`
- `The full image exceeds this GPU's maximum texture dimensions. HDR Finisher can use a bounded preview proxy, but full-resolution GPU processing is unavailable.`
- `The import ran out of memory while decoding. The open document was not changed.`

## Scope

### Initial implementation scope

- Inspect TIFF/DNG topology and inherited root/primary metadata without decoding pixel data.
- Select the largest valid `NewSubfileType = 0` primary image and reject reduced Fast Load proxies as primaries.
- Distinguish a three-channel `LinearRaw` primary from a one-channel CFA/mosaiced primary.
- Decode accepted interleaved RGB uint16, float16, and float32 LinearRaw images.
- Support uncompressed, lossless JPEG, Deflate, and JPEG XL when an installed decoder explicitly supports the selected page.
- Support files whose root IFD is a preview and whose primary is a SubIFD.
- Normalize supported black/white levels, white balance, exposure baseline, and camera color into ACEScg.
- Implement both ForwardMatrix-present and ColorMatrix-only color paths.
- Parse all opcode lists safely; skip only opcodes marked optional; reject any mandatory unimplemented opcode by name, ID, list, and flags.
- Implement and validate standard OpcodeList3 `GainMap` (opcode 9) and `WarpRectilinear` (opcode 1), including their operation order, crop/coordinate semantics, per-plane behavior, bounded-memory resampling, progress, cancellation, and diagnostic records.
- Inspect mosaiced DNGs before rawpy development and verify whether LibRaw has already consumed each required DNG opcode. Apply a correction exactly once; never assume decoder behavior from the producer name.
- Support the supplied DJI single-frame DNGs only after both mandatory GainMap and WarpRectilinear operations are proven correct. Warp alone is insufficient for these files.
- Preserve broad rawpy/LibRaw passthrough for mosaiced DNGs that do not need unsupported mandatory operations; do not make Linear DNG qualification a new barrier for ordinary camera DNGs.
- Inspect system resources before decode, bound working allocations, report progress, support cancellation, and translate allocation failures.
- Keep import transactional and preserve the existing session on rejection, cancellation, or failure.
- Use bounded preview proxies and enforce GPU texture-size limits independently from CPU RAM limits.
- Preflight full-resolution export separately from import.
- Add deterministic automated fixtures and a repeatable manual validation procedure for the real files above.

### Explicitly out of scope for the initial implementation

- Demosaicing or replacing the existing mosaiced RAW importer.
- A producer allowlist or producer-specific UI switches.
- Mandatory opcodes other than the explicitly implemented standard `GainMap` and `WarpRectilinear` operations.
- ProfileGainTableMap/ProfileGainTableMap2 and other profile gain-table variants; these are distinct from OpcodeList3 `GainMap` and remain unsupported until separately implemented.
- Importing reduced Fast Load data in place of a full primary.
- Claiming Lightroom Panorama or DxO PureRAW compatibility without representative samples.
- Matching Adobe or DxO's creative rendering recipe, profile look, denoising, sharpening, or local edits.
- Writing or exporting DNG.
- Loading an entire enormous image as one GPU texture.

## Proposed architecture

Keep the integration in `loader.py` small and put DNG-specific behavior in focused modules.

### `backend/hdr_finisher/linear_dng.py`

Suggested public surface:

```python
class DngRoute(str, Enum):
    LINEAR_DNG = "linear_dng"
    MOSAICED_RAW_DNG = "mosaiced_raw_dng"
    UNSUPPORTED_DNG = "unsupported_dng"
    INVALID_DNG = "invalid_dng"

@dataclass(frozen=True)
class LinearDngInspection:
    route: DngRoute
    width: int
    height: int
    samples_per_pixel: int
    dtype: str
    compression: int
    primary_series_index: int
    primary_page_index: int | None
    metadata_page_index: int
    color_path: str | None
    required_opcodes: tuple[...]
    optional_opcodes: tuple[...]
    warnings: tuple[str, ...]
    rejection: DngRejection | None
    resource_estimate: ResourceEstimate | None

def inspect_dng(path, *, resource_snapshot, retained_session_bytes=0) -> LinearDngInspection: ...

def decode_linear_dng(
    path,
    inspection,
    *,
    progress=None,
    cancelled=None,
) -> tuple[np.ndarray, dict[str, Any]]: ...
```

Do not retain live `TiffFile`, page, or file-map objects in the inspection result. Reopen the file for decode and verify a cheap structural fingerprint such as size, modification time, selected IFD offset, dimensions, and compression before allocating. This avoids stale handles and catches a file changed between inspection and decode.

### `backend/hdr_finisher/dng_color.py`

Keep color-matrix math pure and independently testable. It should accept decoded samples plus resolved DNG metadata and return float32 ACEScg. Matrix construction, illuminant interpolation, white-point adaptation, and normalization should have deterministic unit tests based on the DNG specification and known numeric vectors.

### `backend/hdr_finisher/dng_opcodes.py`

Implement bounded parsing and application of supported DNG opcodes independently from TIFF topology and UI code. The module must expose an explicit stage/order contract and reusable operations for both decoded Linear DNG pixels and the mosaiced-DNG development path.

For `GainMap`, implement the DNG-specified sampled gain field, active rectangle, row/column pitch, plane targeting, map spacing/origin, interpolation, and out-of-domain behavior. Apply gains in the specified camera/image stage before any color transform that would make per-channel gains non-equivalent.

For `WarpRectilinear`, implement the DNG-specified coefficient sets, optical center, per-plane/channel semantics, coordinate system, inverse mapping, interpolation filter, border behavior, and interaction with ActiveArea/default crop/orientation. Process in bounded row/tile chunks, check cancellation, and avoid a second unnecessary full-resolution source copy.

Do not assume rawpy/LibRaw ignores or applies these operations. Add a decoder-capability/behavior probe and reference comparison. If the existing `rawpy.postprocess()` API cannot expose pixels at the DNG-required stage, the clean task must document the limitation and choose a correct integration (for example, a verified LibRaw behavior or a camera-linear intermediate) rather than applying a mathematically non-commutative correction after ACES conversion.

### `backend/hdr_finisher/resource_preflight.py`

If existing resource utilities cannot own this cleanly, isolate:

- physical/available RAM detection;
- retained current-session accounting;
- import and export peak estimates;
- GPU adapter dimension/VRAM capability capture;
- policy decisions and user-facing quantities.

Resource detection and policy must be dependency-injected or mockable so tests do not depend on the developer machine.

### Loader integration

Before the generic `suffix in RAW_EXTENSIONS` branch:

1. inspect `.dng`;
2. decode through the new path only for `LINEAR_DNG`;
3. fall through to `decode_raw` for `MOSAICED_RAW_DNG`;
4. raise a specific `LoaderError` for unsupported, invalid, or unsafe Linear DNG classifications.

The new decoder should set the same internal metadata signal used by other already-normalized decoders so the generic loader does not color-convert the returned ACEScg data a second time.

The current `SessionManager.prepare_session()`/`activate_session()` split is already suitable for transactional replacement. Verify with tests that no shared session state or owned temporary source is mutated before successful preparation.

## Qualification and primary-image selection

### Inspection algorithm

1. Validate TIFF/DNG structure and read DNG version/backward version.
2. Enumerate root IFDs, SubIFDs, and `tifffile` series without pixel decode.
3. Resolve shared metadata from the root IFD and image-specific metadata from candidate primary pages using DNG inheritance rules.
4. Prefer full-resolution candidates with `NewSubfileType = 0`.
5. Select the largest credible primary by active/full pixel area. Never select reduced-resolution, preview, transparency-mask, thumbnail, or Fast Load series merely because it is LinearRaw.
6. Determine photometric interpretation, channel count, CFA tags, sample format, bit depth, planar configuration, compression, dimensions, crop, orientation, and required metadata.
7. Classify one-channel CFA primaries as `MOSAICED_RAW_DNG` even if reduced LinearRaw proxies exist, while retaining their parsed mandatory-opcode plan for the RAW development route.
8. Require a three-channel LinearRaw primary for the new route. Reject ambiguous or contradictory topology.
9. Parse all opcode-list payloads with bounds checks before making an acceptance decision.
10. Compute import/export resource estimates before accessing the full payload.

### Initial metadata capability policy

Support:

- scalar or per-channel `BlackLevel` and `WhiteLevel` values that can be unambiguously broadcast to RGB;
- DNG-defined defaults when optional tags are absent;
- `AsShotNeutral` or an equivalent reference-neutral path defined by the specification;
- one or two ColorMatrix/calibration-illuminant sets;
- ForwardMatrix when present, without requiring it;
- `AnalogBalance` and `CameraCalibration` with DNG-defined defaults;
- `ActiveArea`, `DefaultCropOrigin`, `DefaultCropSize`, and orientation combinations covered by tests;
- separate transparency-mask series as non-primary auxiliary content, ignored for the first implementation unless the core pipeline already has a meaningful consumer.

Reject initially, with a named reason, when correctness is not implemented and the metadata materially changes pixel interpretation. This includes:

- non-trivial `LinearizationTable`;
- `BlackLevelDeltaH` or `BlackLevelDeltaV`;
- unsupported planar/channel layouts;
- non-unity scale/resampling requirements not covered by crop/orientation code;
- mandatory unimplemented opcodes;
- required profile/gain-table data that cannot be applied correctly;
- unknown sample formats or bit-depth combinations;
- a decoder missing for the selected primary's compression.

Before finalizing the allow/reject list, audit every pixel-affecting tag present in all target samples. Absence of a tag must resolve to the DNG specification's default rather than an invented value.

## Scene-linear color pipeline

The importer is a baseline scene-referred conversion, not an attempt to reproduce Adobe or DxO's creative default look.

### Common decode and normalization

1. Decode the selected primary into its native sample type.
2. Resolve black level, white level, analog balance, camera calibration, reference neutral, baseline exposure, illuminants, crop, and orientation from the correct metadata scope.
3. Convert in bounded strips/tiles or row chunks where the codec and array layout permit it.
4. Normalize integer samples using resolved black/white levels. Preserve floating-point scene values and apply only metadata-required scaling; do not clamp negative or super-white values.
5. Apply white balance and camera calibration in the order required by DNG 1.7.1. Do not infer order from tag names.
6. Convert to XYZ and then ACEScg using one of the two paths below.
7. Apply the confirmed DNG baseline-exposure behavior at its specification-defined point.
8. Apply crop and orientation without silently resampling unless metadata explicitly requires it and that operation is supported.
9. Return a contiguous float32 ACEScg result and diagnostic metadata.

### Path A: ForwardMatrix present

Use the applicable ForwardMatrix together with ColorMatrix, AnalogBalance, CameraCalibration, and reference neutral according to the DNG specification to reach XYZ D50, then transform XYZ D50 to ACEScg.

Do not treat ForwardMatrix as a simple optional replacement for ColorMatrix, and do not assume it already includes every white-balance/calibration operation. Lock the exact equations and operation order to DNG 1.7.1 before coding.

### Path B: ForwardMatrix absent

This path is required for the verified DxO and Lightroom HDR samples.

1. Use `ColorMatrix1/2`, `CalibrationIlluminant1/2`, `AsShotNeutral`, `AnalogBalance`, and `CameraCalibration` to solve the effective camera-to-XYZ transform.
2. For dual-illuminant profiles, determine the scene/reference correlated color temperature and interpolate matrices using the DNG-specified method, including reciprocal-temperature/mired behavior where required.
3. Invert the calibrated XYZ-to-camera relationship with numerical conditioning checks.
4. Chromatically adapt the resolved source white to D50 using the DNG-specified/reference method.
5. Convert XYZ D50 to ACEScg.

Never silently substitute `ColorMatrix1`, D65, or a hard-coded white point just because the image looks plausible. The diagnostic preview created during exploration used such a simplified fallback and is not a color reference.

### Exposure and default-render metadata

Confirm from the DNG specification and neutral producer renders whether and where `BaselineExposure` contributes the default scene-linear scale. The likely scale factor is `2 ** BaselineExposure`, but this must be verified with numeric tests and real references rather than accepted as an assumption.

Inventory profile hue/saturation maps, look tables, tone curves, and default-render tags in the target files. Classify each as:

- required for a correct baseline camera-to-scene transform;
- optional/creative and intentionally not applied;
- unsupported but mandatory for safe acceptance.

Record intentional omissions in metadata so a future diagnostic report can explain why HDR Finisher differs from a producer's rendered JPEG/TIFF.

## Opcode policy and implemented operations

Parse `OpcodeList1`, `OpcodeList2`, and `OpcodeList3` using their big-endian binary definitions and validate list counts, payload sizes, IDs, versions, and flags.

- An opcode with the optional flag may be skipped, but its list, ID/name, version, and flags must be recorded.
- A mandatory opcode may be marked consumed only when the application or a verified decoder has applied its effect exactly once at the required stage.
- Any mandatory unknown or unimplemented opcode causes early rejection.
- ProfileGainTableMap/ProfileGainTableMap2 and comparable profile gain-table metadata are rejected until separately implemented and validated.

The initial experimental compatibility envelope implements standard OpcodeList3 `GainMap` and `WarpRectilinear`:

- `WarpRectilinear` is required by the ACR explicit Linear sample and by each supplied DJI source DNG.
- `GainMap` is also mandatory in each supplied DJI source DNG. Implementing Warp alone would still require rejecting direct DJI import.
- The genuine Lightroom HDR Merge contains neither opcode because Lightroom appears to have baked the source corrections into the merged pixels. It must not receive those source corrections again.
- Any unsupported coefficient/layout variant must reject explicitly even though the opcode ID itself is known.
- Tests must prove operation ordering and exactly-once application, especially across rawpy/LibRaw and HDR Finisher's existing optional Lensfun correction. Do not stack DNG WarpRectilinear and Lensfun distortion correction automatically; define precedence and expose diagnostics.

## Large-file and resource safety

### Preflight inputs

The estimate must include, at minimum:

- decoded source buffer bytes (`width × height × channels × native bytes/sample`), independent of compressed file size;
- output float32 ACEScg bytes;
- codec, strip/tile, matrix-conversion, crop/orientation, analysis, and contiguous-copy scratch;
- retained current-session image and preview allocations while the candidate session is prepared;
- a fixed application/OS reserve;
- likely full-resolution export intermediates, calculated separately from import.

An uncompressed memory-mapped source can reduce committed RAM, but acceptance should remain conservative because pages can become resident and later operations can force copies. Compressed lossless JPEG and JPEG XL should assume a full decoded source allocation unless measured decoder behavior proves a lower bounded peak.

### Recommended policy

- Reserve the larger of 2 GiB or 15% of physical RAM for the OS/application baseline, then subtract currently committed/retained session memory and a measured safety margin.
- Accept only when the conservative predicted peak fits safely available memory.
- Treat resource detection failure as `unknown`, never as unlimited capacity.
- For unknown resources, permit ordinary-sized files under the existing loader's proven envelope, but reject unusually large Linear DNGs before decode with a message that safety could not be determined. Put the threshold in one documented policy constant and cover both sides with tests.
- Keep import and export admission separate. A file may open successfully but still receive a warning or denial for an export requiring larger intermediates.
- Report estimated required and safely available GiB, dimensions, and the limiting resource.

The 2 GiB/15% reserve is a provisional product policy, not a measured truth. The Alkeria JPEG XL run observed approximately 20.8 GiB of private memory, more than twice the original 8.65 GiB export estimate. Recalibrate the JPEG XL export model against this measurement, including the simultaneous source/render, PQ conversion, encoded payload, and validation-decode lifetimes; do not merely increase the fixed reserve. Capture repeat Windows measurements from process start and macOS peak RSS before release.

### Allocation and failure handling

- Catch Python `MemoryError`, native codec allocation failures, file-mapping failures, and temporary-storage exhaustion and translate them to a stable import error.
- Free partially allocated arrays and close maps/files promptly.
- Remove only temporary files owned by the failed import.
- Check cancellation between metadata inspection, decode units, conversion chunks, crop/orientation, analysis, and session indexing.
- Do not mutate or dispose the open session until the candidate session is complete and accepted.
- Avoid multiple full-frame float32 copies. Require code review justification for every full-resolution allocation.

### GPU behavior

CPU acceptance does not imply one-texture GPU compatibility.

- Query and enforce maximum 2D texture dimensions and practical VRAM budget.
- Build bounded display/analysis proxies for giant images.
- Tile GPU processing where already supported; otherwise keep full-resolution source/working data on CPU and expose the limitation clearly.
- Never fail an otherwise safe CPU import solely because the full frame cannot be one GPU texture if a correct bounded-preview path exists.

## Work breakdown

### LDNG-0 — Freeze evidence and contracts

- Create the ignored `codebase/local-test-media/inputs/linear-dng/` corpus by copying the private samples and available references; generate its local hash/role manifest and verify every path is ignored.
- Convert the exploration probe's findings into golden inspection expectations.
- Audit pixel-affecting metadata across every real target.
- Document exact DNG 1.7.1 equations/defaults used by both color paths.
- Define stable route, warning, and rejection data structures.

**Exit:** The private local corpus is complete and confirmed absent from Git status; reviews agree on primary selection, color equations, opcode policy, resource quantities, and error taxonomy before production decode code lands.

### LDNG-1 — Production metadata inspector

- Extract/rework safe topology, tag, compression, and opcode parsing from the probe into production code.
- Add root-preview/SubIFD metadata inheritance.
- Implement full-primary selection and CFA-versus-LinearRaw routing.
- Detect required unsupported tags and codec availability without full decode.

**Exit:** Small synthetic tests reproduce the classifications of the ordinary Lightroom export, DxO layout, HDR layout, and mandatory-opcode rejection.

### LDNG-2 — Resource preflight and policy

- Implement mockable Windows/macOS memory detection and retained-session accounting.
- Model decoded source, ACEScg target, scratch, preview, and export peaks.
- Implement safe/unsafe/unknown decisions and formatted user messages.
- Add GPU texture-dimension qualification and bounded-proxy policy.

**Exit:** Deterministic tests cover boundary values, unknown detection, retained-session pressure, import-versus-export differences, and giant dimensions without allocating giant arrays.

### LDNG-3 — Color conversion core

- Implement resolved DNG defaults and supported black/white normalization.
- Implement ForwardMatrix-present and ColorMatrix-only dual-illuminant paths.
- Implement chromatic adaptation and XYZ D50 to ACEScg conversion.
- Confirm BaselineExposure behavior.
- Preserve negative and HDR values; forbid accidental clipping.

**Exit:** Numeric vector tests pass for both paths, single/dual illuminants, defaults, white balance, negative values, super-whites, malformed/singular matrices, and float/int samples.

### LDNG-4 — GainMap and WarpRectilinear engine

- Implement strict parameter parsing and validation for the supplied standard opcode variants.
- Implement spec-backed GainMap interpolation/application at the correct image stage.
- Implement spec-backed inverse WarpRectilinear resampling in bounded chunks.
- Define crop, active-area, orientation, mask, channel/plane, border, and interpolation behavior.
- Audit rawpy/LibRaw behavior with the supplied DJI files and ensure each correction is applied exactly once.
- Define precedence with the existing Lensfun path; never compound equivalent automatic corrections silently.
- Add progress, cancellation, allocation estimates, and opcode-specific diagnostics.

**Exit:** Synthetic numeric/geometry fixtures pass; the ACR Linear sample matches a producer geometry reference; both DJI source DNGs have GainMap and WarpRectilinear applied exactly once at the correct stages. If the current decoder cannot expose or perform the required stage correctly, that is a sprint blocker requiring a correct integration—not grounds to mark the sprint complete with a silent omission.

### LDNG-5 — Bounded decoder and loader routing

- Decode supported primary series using `tifffile`/`imagecodecs` capability checks.
- Convert in chunks where possible and avoid redundant full-frame copies.
- Apply crop/orientation correctly.
- Integrate the classifier before the existing RAW branch.
- Mark output as already normalized to ACEScg.
- Add progress, cancellation, and specific error translation.

**Exit:** Accepted synthetic Linear DNGs open; synthetic mosaiced DNGs route to the existing RAW decoder with their opcode plan preserved; unsupported files fail before payload decode.

### LDNG-6 — Transactional session and export safety

- Verify candidate-session preparation retains the old session until success.
- Account for the retained session in resource estimates.
- Test cancellation and failures at every stage.
- Add export preflight for the loaded dimensions and chosen output path.

**Exit:** Rejection, cancellation, decoder failure, and simulated OOM leave the active document and edits unchanged and leak no owned temporary artifacts.

### LDNG-7 — Real-file validation and experimental release documentation

- Run the private sample matrix below.
- Capture peak RSS, wall time, cancellation latency, GPU/proxy behavior, and export estimates on Windows; repeat resource policy checks on macOS.
- Compare against neutral producer references.
- Update format-support UI/help and the testing index.
- Label all DNG import paths experimental and state the tested compatibility matrix without implying universal camera/software support.

**Exit:** All initial targets pass structure, geometry, color, stability, and resource gates; deferred files fail with the intended message; full automated suite remains green.

## Automated test plan

Place tests and small generated fixtures under `codebase/tests/`. Do not commit private photographs or gigabyte-scale media.

Required coverage:

- root preview plus full primary SubIFD;
- multiple series including transparency masks and reduced LinearRaw proxies;
- largest `NewSubfileType = 0` primary selection;
- mosaiced primary with LinearRaw Fast Load proxy routes to RAW;
- uint16, float16, and float32 accepted sample paths;
- supported and unsupported compression capability checks;
- missing decoder produces a deterministic early rejection;
- tag inheritance and DNG defaults;
- crop/orientation combinations;
- scalar/per-channel black and white levels;
- unsupported linearization, black-level delta, scale, and planar layouts;
- single- and dual-illuminant ForwardMatrix paths;
- single- and dual-illuminant ColorMatrix-only paths;
- numerically singular or invalid matrices;
- negative and greater-than-one values survive conversion;
- BaselineExposure numeric behavior;
- valid optional opcode skip and diagnostic record;
- mandatory known, mandatory unknown, truncated, oversized, and wrong-endian opcode payloads;
- GainMap numeric interpolation, plane selection, active rectangle, pitch, map boundary, malformed dimensions, operation order, and HDR-value preservation;
- WarpRectilinear identity, radial-only and tangential terms, optical center, per-plane coefficients, inverse mapping, interpolation, borders, crop/orientation order, cancellation, and giant-dimension chunking;
- exactly-once opcode behavior when a decoder reports/produces corrected pixels;
- DNG opcode versus Lensfun precedence, with no silent double correction;
- resource accept/reject boundaries, unknown resources, retained session, and export-only failure;
- mocked `MemoryError`, native allocation failure, cancellation, and cleanup;
- no full payload read during inspection/rejection;
- no activation of a failed candidate session;
- existing mosaiced RAW DNG behavior remains covered.
- a representative producer-neutral mosaiced-DNG matrix confirms that ordinary LibRaw-supported files without unsupported mandatory operations still open through the convenience path.

Run the targeted tests during development and the full suite before handoff. At the start of this sprint, the branch baseline is **521 passed, 1 skipped**, with two pre-existing warnings.

## Manual validation matrix

Store the durable procedure/results in `docs/testing/`; put disposable previews and measurements in `codebase/output/linear-dng/`.

| Input | Expected route/result | Required checks |
|---|---|---|
| Alkeria line-scan | Accepted Linear DNG | 72,480 × 4,096 primary, correct orientation/color, bounded proxy, no giant GPU texture, measured import/export peaks, cancel/replace behavior |
| DxO Linear DNG | Accepted Linear DNG | Select full SubIFD rather than root preview; 7,952 × 5,304; ColorMatrix-only path; neutral render comparison |
| Lightroom ordinary DNG export | Existing mosaiced RAW path | Never select Fast Load proxy as primary; no regression in rawpy behavior |
| ACR explicit Linear DNG | Accepted experimental Linear DNG | Apply WarpRectilinear; verify crop, border, channel registration, detail retention, and geometry against a neutral ACR render |
| Lightroom HDR Merge | Accepted Linear DNG | 8,000 × 6,000 float16 JPEG XL primary; masks ignored safely; ColorMatrix-only path; HDR values and neutral render comparison |
| DJI `DJI_0071.DNG` and `DJI_0072.DNG` separately | Accepted experimental mosaiced DNG, contingent on correct decoder-stage integration | Preserve existing demosaic behavior; apply mandatory GainMap and WarpRectilinear exactly once; do not double-apply Lensfun; compare geometry, shading, color, corners, and crop to neutral Adobe/DJI references |
| Corrupt/truncated copy | Rejected safely | No crash, no session loss, no leaked handles/temp files |
| Simulated low-memory environment | Rejected before decode | Required/available GiB message and current session retained |

As of 2026-08-20, the Alkeria row has passed full-dimension import, bounded interactive use, single-file JPEG XL export, transactional decode validation, and a controlled Windows Photos open test. Export resource measurement is recorded above. Exact producer-reference color and geometry comparison remains pending, so the row is not yet complete and must not be described as color-validated Alkeria compatibility.

### Visual and numeric acceptance

- Exact dimensions, crop, and orientation match the producer's neutral reference.
- No channel swaps, spatial corruption, preview substitution, or mask-series substitution.
- Neutral regions remain neutral within a documented tolerance.
- No unintended clipping of negative values or highlights above working diffuse white.
- Baseline exposure is within a documented tolerance of the neutral producer render after accounting for known tone-curve differences.
- Sampled color differences are measured after defining a fair scene-linear/reference comparison; “looks plausible” is not sign-off.
- Creative producer edits are not used as the colorimetric oracle.
- Import, cancel, replace, edit, save/session restore, and full-resolution export paths are exercised.

Neutral producer references are a validation dependency:

- DxO: make a full-size neutral/default render with edits disabled, preferably 16-bit TIFF; a maximum-quality JPEG can be secondary evidence.
- Lightroom HDR: make a full-size neutral/default 16-bit TIFF and record all Develop/export settings.
- DJI single-frame: make neutral/default 16-bit TIFF references from `DJI_0071.DNG` and `DJI_0072.DNG`, with automatic lens corrections enabled as prescribed by the DNG, and record the application/version/settings.
- Alkeria: obtain a producer/reference render if one is available.

Implementation can begin without these files, but visual correctness cannot be signed off without them.

## Definition of done

The sprint is complete only when:

- target Linear DNGs qualify by structure/capability rather than producer name;
- the Alkeria, DxO, ACR Linear, and Lightroom HDR target families import through the intended paths;
- the supplied DJI single-frame DNGs pass reference-backed GainMap/WarpRectilinear validation; inability to access the correct decoder stage blocks completion rather than permitting a mandatory correction to be omitted;
- ordinary mosaiced DNGs retain existing behavior;
- the available multi-camera mosaiced-DNG corpus demonstrates broad LibRaw passthrough without producer allowlisting;
- both matrix color paths are specification-backed and numerically tested;
- unsupported mandatory operations reject before expensive decode with precise messages;
- supported GainMap and WarpRectilinear variants are applied exactly once, in order, with bounded memory and reference-backed geometry/shading evidence;
- predicted and measured memory behavior is documented and the safety policy adjusted if needed;
- giant sources use bounded previews and respect GPU dimension limits;
- import and export resource checks are distinct;
- cancellation/OOM/decoder failures are transactional;
- no private large media is committed;
- all private real-file validation uses duplicated files below the ignored `codebase/local-test-media/inputs/linear-dng/` corpus rather than reading the working photo library directly;
- the full automated suite passes;
- manual Windows validation passes and macOS resource-policy behavior is documented;
- remaining producer/sample limitations are stated without overclaiming compatibility.
- UI/help/diagnostics identify DNG import as experimental and list the tested sample families.

## Product decisions and dependencies

### Decisions recorded

- Include standard `WarpRectilinear` in the initial sprint.
- Include standard OpcodeList3 `GainMap` because both supplied DJI single-frame DNGs require it in addition to WarpRectilinear; direct DJI acceptance cannot be correct with Warp alone.
- Label the complete DNG import capability experimental because the available corpus cannot cover every camera, DNG version, producer, opcode variant, and software configuration.
- Prefer an explicit capability rejection over a plausible-looking import that skipped mandatory metadata.
- Treat direct JPEG XL as the currently verified single-file export for the 72,480-pixel-wide Alkeria sample. AVIF and JPEG Ultra HDR are not verified for this dimension in the current Windows build.
- Consider bounded tiled export as a follow-up for dimension-limited formats. At an 8,192-pixel tile-width ceiling, this sample would require nine horizontal tiles (eight 8,192-pixel tiles and one 6,944-pixel remainder), plus deterministic naming and a reconstruction manifest. Tiling is not part of this sprint's completed compatibility envelope.

### User-provided validation dependencies

The neutral DxO and Lightroom HDR renders described above are needed before final visual sign-off. They do not block metadata, routing, resource, decoder, or numeric color implementation.

### Defaults that do not need a separate decision unless changed

- Automatic metadata/capability routing; no producer allowlist.
- Preserve the existing mosaiced RAW path.
- Conservative unknown-resource handling for unusually large inputs.
- CPU-safe import with bounded GPU previews instead of requiring one full-size texture.
- No compatibility claim for Lightroom Panorama or DxO PureRAW until samples exist.
- No creative-look matching; implement the DNG baseline scene-linear transform.
- Standard GainMap/WarpRectilinear support is variant-gated; “known opcode ID” is not universal compatibility.

## Clean-task kickoff prompt

Use this in a clean task:

> Work on branch `explore/linear-dng-large-import`. Read `docs/product/Linear_DNG_Import_Sprint_PRD.md`, `docs/testing/Linear_DNG_Import_Feasibility_2026-08-20.md`, `AGENTS.md`, and `docs/testing/README.md` completely before editing. Implement the Experimental DNG Import sprint in staged, reviewable commits. Preserve all unrelated and untracked user files. First copy (never move) the private samples and references identified by the sprint into `codebase/local-test-media/inputs/linear-dng/`, create a local-only role/hash manifest there, and prove with `git check-ignore` and `git status` that no private media can be committed. Use those copies for all manual/local validation and make their absence a clean test skip. Implement standard OpcodeList3 GainMap and WarpRectilinear in the initial scope; audit rawpy/LibRaw behavior and apply each mandatory correction exactly once at the DNG-required stage. Remember that the supplied DJI single-frame DNGs require both operations, while the Lightroom HDR merge has already baked them and must receive neither. Start production work by validating the contracts and DNG 1.7.1 color/opcode equations, then implement the metadata-only classifier, resource preflight, both color paths, bounded opcode engine and decoder, loader/RAW routing, transactional error handling, experimental UI labeling, and tests. Do not commit private/large source images, do not accept reduced Fast Load proxies as primaries, and do not claim visual sign-off without neutral producer references. Run targeted tests throughout and the full suite before handoff; update the durable validation log with evidence and remaining limitations.

## Existing exploration assets

- Feasibility probe: `codebase/tools/linear_dng_probe.py`
- Probe tests: `codebase/tests/test_linear_dng_probe.py`
- Findings: `docs/testing/Linear_DNG_Import_Feasibility_2026-08-20.md`
- Diagnostic preview, not a color reference: `codebase/output/linear-dng/dji-0071-2-hdr-preview.png`
- Existing integration points: `codebase/backend/hdr_finisher/loader.py`, `raw_import.py`, and `sessions.py`

The probe is evidence and reusable parsing research, not production architecture. Move only reviewed, bounded, tested behavior into the application.
