# Linear DNG Import and Large-File Safety Sprint

**Status:** Implementation brief  
**Prepared:** 2026-08-20  
**Target branch:** `explore/linear-dng-large-import`  
**Production code status:** Not yet modified  
**Related investigation:** [Linear DNG Import Feasibility — 2026-08-20](../testing/Linear_DNG_Import_Feasibility_2026-08-20.md)

## Executive outcome

Implement a constrained, metadata-driven Linear DNG importer that can open the verified Alkeria line-scan, DxO PhotoLab Linear DNG, and Lightroom Classic HDR Merge families without disrupting the existing mosaiced camera-RAW path.

The importer must inspect and qualify the file before allocating its full pixel payload, convert accepted input into HDR Finisher's scene-linear float32 ACEScg working representation, preserve negative and greater-than-one values, and fail transactionally with clear resource or capability errors. Producer names are diagnostic information, not an allowlist.

This is intentionally not a promise to import every DNG. Unsupported mandatory opcodes, unimplemented image-shaping metadata, unsupported compression, unsafe resource requirements, and malformed topology must be rejected before expensive decode whenever possible.

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
| `D:\Photos\Lightroom Classic HDR\DSC01204_ACR_Linear.dng` | ACR 18.3 explicit Linear DNG; full 8,000 × 5,320 RGB uint16 primary; lossless JPEG; full matrix metadata; mandatory `WarpRectilinear` opcode | Reject clearly in the initial sprint unless geometric opcode support is deliberately added |
| `D:\Photos\HDR Test Images\DJI Samples\DJI_0071-2-HDR.dng` | Genuine Lightroom Classic 15.5 HDR Merge; DNG 1.7; 8,000 × 6,000 RGB float16 primary; JPEG XL DNG compression; dual ColorMatrix; no ForwardMatrix; no opcodes | Target for initial support through the ColorMatrix-only path |
| `D:\Photos\HDR Test Images\DJI Samples\DJI_0071.DNG` and `DJI_0072.DNG` | Original DJI mosaiced source frames; contain mandatory GainMap and WarpRectilinear operations | Existing RAW path remains responsible; the Lightroom merge has already consumed/baked these operations |

Additional facts established by the probe:

- The Alkeria file is approximately 1.78 GB, but a conservative import estimate is approximately 5.33 GiB and a full-resolution export can peak near 8.65 GiB.
- The Lightroom HDR primary payload has been fully decoded with the installed `tifffile`/`imagecodecs` stack as a `(6000, 8000, 3)` float16 array.
- The DxO full primary payload has also been decoded successfully.
- The existing DxO JPEG is an edited render. It confirms content and geometry but is not a neutral color/tone reference.
- Lightroom's Fast Load JPEG XL proxies are reduced derived images and must never cause a mosaiced primary to be classified as Linear DNG.

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

### User-visible success

An accepted Linear DNG opens as a normal HDR Finisher session with:

- scene-linear float32 ACEScg pixels;
- `0.18` retaining the application's existing 100-nit diffuse-white convention;
- negative and greater-than-one channel values preserved;
- correct primary selection, crop, orientation, white balance, exposure baseline, and matrix color conversion;
- producer, DNG version, dimensions, compression, source sample type, selected IFD/series, color path, and skipped optional metadata recorded for diagnostics;
- no attempt to upload the full source as a GPU texture when it exceeds adapter limits.

### User-visible failure

Failures must say what is unsupported or unsafe and leave the current document unchanged. Avoid generic messages such as “could not decode DNG” when the inspector knows the reason.

Examples:

- `This DNG's primary image is mosaiced camera RAW; it will be opened by the camera RAW importer.` This is a route decision, not an error.
- `This Linear DNG requires WarpRectilinear (OpcodeList3, opcode 1), which this version cannot apply.`
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
- Inspect system resources before decode, bound working allocations, report progress, support cancellation, and translate allocation failures.
- Keep import transactional and preserve the existing session on rejection, cancellation, or failure.
- Use bounded preview proxies and enforce GPU texture-size limits independently from CPU RAM limits.
- Preflight full-resolution export separately from import.
- Add deterministic automated fixtures and a repeatable manual validation procedure for the real files above.

### Explicitly out of scope for the initial implementation

- Demosaicing or replacing the existing mosaiced RAW importer.
- A producer allowlist or producer-specific UI switches.
- Mandatory `WarpRectilinear` implementation, unless the product decision at the end of this brief changes.
- Mandatory GainMap/ProfileGainTableMap application.
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
7. Classify one-channel CFA primaries as `MOSAICED_RAW_DNG` even if reduced LinearRaw proxies exist.
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

## Opcode policy

Parse `OpcodeList1`, `OpcodeList2`, and `OpcodeList3` using their big-endian binary definitions and validate list counts, payload sizes, IDs, versions, and flags.

- An opcode with the optional flag may be skipped, but its list, ID/name, version, and flags must be recorded.
- A mandatory opcode may be skipped only after its effect has been implemented and validated elsewhere in the pipeline.
- Any mandatory unknown or unimplemented opcode causes early rejection.
- ProfileGainTableMap/ProfileGainTableMap2 and comparable gain-table metadata are rejected until implemented and validated.

Recommended initial decision: defer `WarpRectilinear`. Neither the target DxO file nor the genuine Lightroom HDR Merge requires it. Deferral keeps geometric resampling, per-channel warp semantics, border policy, and crop interaction out of the first color-and-memory sprint. The ACR-created explicit Linear DNG remains a useful negative test with a precise rejection message.

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

The 2 GiB/15% reserve is a provisional product policy, not a measured truth. Capture Windows and macOS peak RSS during validation and adjust it before release.

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

### LDNG-4 — Bounded decoder and loader routing

- Decode supported primary series using `tifffile`/`imagecodecs` capability checks.
- Convert in chunks where possible and avoid redundant full-frame copies.
- Apply crop/orientation correctly.
- Integrate the classifier before the existing RAW branch.
- Mark output as already normalized to ACEScg.
- Add progress, cancellation, and specific error translation.

**Exit:** Accepted synthetic Linear DNGs open; synthetic mosaiced DNGs route to the existing RAW decoder; unsupported files fail before payload decode.

### LDNG-5 — Transactional session and export safety

- Verify candidate-session preparation retains the old session until success.
- Account for the retained session in resource estimates.
- Test cancellation and failures at every stage.
- Add export preflight for the loaded dimensions and chosen output path.

**Exit:** Rejection, cancellation, decoder failure, and simulated OOM leave the active document and edits unchanged and leak no owned temporary artifacts.

### LDNG-6 — Real-file validation and release documentation

- Run the private sample matrix below.
- Capture peak RSS, wall time, cancellation latency, GPU/proxy behavior, and export estimates on Windows; repeat resource policy checks on macOS.
- Compare against neutral producer references.
- Update format-support UI/help and the testing index.

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
- resource accept/reject boundaries, unknown resources, retained session, and export-only failure;
- mocked `MemoryError`, native allocation failure, cancellation, and cleanup;
- no full payload read during inspection/rejection;
- no activation of a failed candidate session;
- existing mosaiced RAW DNG behavior remains covered.

Run the targeted tests during development and the full suite before handoff. At the start of this sprint, the branch baseline is **521 passed, 1 skipped**, with two pre-existing warnings.

## Manual validation matrix

Store the durable procedure/results in `docs/testing/`; put disposable previews and measurements in `codebase/output/linear-dng/`.

| Input | Expected route/result | Required checks |
|---|---|---|
| Alkeria line-scan | Accepted Linear DNG | 72,480 × 4,096 primary, correct orientation/color, bounded proxy, no giant GPU texture, measured import/export peaks, cancel/replace behavior |
| DxO Linear DNG | Accepted Linear DNG | Select full SubIFD rather than root preview; 7,952 × 5,304; ColorMatrix-only path; neutral render comparison |
| Lightroom ordinary DNG export | Existing mosaiced RAW path | Never select Fast Load proxy as primary; no regression in rawpy behavior |
| ACR explicit Linear DNG | Named early rejection in initial scope | Identify mandatory WarpRectilinear and its opcode list; do not decode full payload |
| Lightroom HDR Merge | Accepted Linear DNG | 8,000 × 6,000 float16 JPEG XL primary; masks ignored safely; ColorMatrix-only path; HDR values and neutral render comparison |
| Corrupt/truncated copy | Rejected safely | No crash, no session loss, no leaked handles/temp files |
| Simulated low-memory environment | Rejected before decode | Required/available GiB message and current session retained |

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
- Alkeria: obtain a producer/reference render if one is available.

Implementation can begin without these files, but visual correctness cannot be signed off without them.

## Definition of done

The sprint is complete only when:

- target Linear DNGs qualify by structure/capability rather than producer name;
- the Alkeria, DxO, and Lightroom HDR target families import through the intended paths;
- ordinary mosaiced DNGs retain existing behavior;
- both matrix color paths are specification-backed and numerically tested;
- unsupported mandatory operations reject before expensive decode with precise messages;
- predicted and measured memory behavior is documented and the safety policy adjusted if needed;
- giant sources use bounded previews and respect GPU dimension limits;
- import and export resource checks are distinct;
- cancellation/OOM/decoder failures are transactional;
- no private large media is committed;
- all private real-file validation uses duplicated files below the ignored `codebase/local-test-media/inputs/linear-dng/` corpus rather than reading the working photo library directly;
- the full automated suite passes;
- manual Windows validation passes and macOS resource-policy behavior is documented;
- remaining producer/sample limitations are stated without overclaiming compatibility.

## Product decisions and dependencies

### One decision requested

**Should `WarpRectilinear` be included in this initial sprint?**

Recommendation: **No; defer it to a follow-up.** It is not required by the verified DxO or Lightroom HDR targets, and the line-scan file has no opcodes. Adding it now introduces geometric resampling, per-channel warp, border, crop, quality, and performance work before the core color and memory paths are proven. With this default, the ACR explicit Linear DNG is rejected clearly, not silently mishandled.

If no contrary decision is recorded, the clean implementation task should use the recommended deferral.

### User-provided validation dependencies

The neutral DxO and Lightroom HDR renders described above are needed before final visual sign-off. They do not block metadata, routing, resource, decoder, or numeric color implementation.

### Defaults that do not need a separate decision unless changed

- Automatic metadata/capability routing; no producer allowlist.
- Preserve the existing mosaiced RAW path.
- Conservative unknown-resource handling for unusually large inputs.
- CPU-safe import with bounded GPU previews instead of requiring one full-size texture.
- No compatibility claim for Lightroom Panorama or DxO PureRAW until samples exist.
- No creative-look matching; implement the DNG baseline scene-linear transform.

## Clean-task kickoff prompt

Use this in a clean task:

> Work on branch `explore/linear-dng-large-import`. Read `docs/product/Linear_DNG_Import_Sprint_PRD.md`, `docs/testing/Linear_DNG_Import_Feasibility_2026-08-20.md`, `AGENTS.md`, and `docs/testing/README.md` completely before editing. Implement the initial Linear DNG import sprint in staged, reviewable commits. Preserve all unrelated and untracked user files. First copy (never move) the private samples and references identified by the sprint into `codebase/local-test-media/inputs/linear-dng/`, create a local-only role/hash manifest there, and prove with `git check-ignore` and `git status` that no private media can be committed. Use those copies for all manual/local validation and make their absence a clean test skip. Treat `WarpRectilinear` as deferred unless I explicitly say otherwise. Start production work by validating the contracts and DNG 1.7.1 color equations, then implement the metadata-only classifier, resource preflight, both color paths, bounded decoder, loader routing, transactional error handling, and tests. Do not commit private/large source images, do not accept reduced Fast Load proxies as primaries, and do not claim visual sign-off without neutral producer references. Run targeted tests throughout and the full suite before handoff; update the durable validation log with evidence and remaining limitations.

## Existing exploration assets

- Feasibility probe: `codebase/tools/linear_dng_probe.py`
- Probe tests: `codebase/tests/test_linear_dng_probe.py`
- Findings: `docs/testing/Linear_DNG_Import_Feasibility_2026-08-20.md`
- Diagnostic preview, not a color reference: `codebase/output/linear-dng/dji-0071-2-hdr-preview.png`
- Existing integration points: `codebase/backend/hdr_finisher/loader.py`, `raw_import.py`, and `sessions.py`

The probe is evidence and reusable parsing research, not production architecture. Move only reviewed, bounded, tested behavior into the application.
