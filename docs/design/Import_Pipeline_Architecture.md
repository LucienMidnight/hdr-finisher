# Import Pipeline Architecture

**Last updated:** August 20, 2026
**Scope:** Desktop source selection, staged preview, authoritative decode, working-space
normalization, cancellation, activation, and import-performance invariants.

## 1. Architectural outcome

HDR Finisher is a single-document application. Import is therefore a staged, latest-request-wins
transaction rather than a collection of independent background uploads. A new source may consume
substantial CPU and memory, but it cannot replace the active document until its pixels, source
interpretation, analysis, and render cache are ready as one coherent session.

The pipeline has two deliberately different image products:

1. A **non-authoritative source preview** used by the media browser and the import progress view.
   It should be fast, color-aware, bounded, and visually useful. It may use an embedded thumbnail or
   an SDR/base rendition and must never invent missing color metadata.
2. An **authoritative session decode** that preserves source precision and HDR semantics, normalizes
   known inputs to linear ACEScg, retains an exact SDR reference when the container supplies one,
   analyzes the result, and only then becomes eligible for activation.

Keeping these products separate is the central performance and correctness rule. A thumbnail must
not invoke a full gain-map reconstruction merely because the full loader can do so.

## 2. Runtime flow

```text
Desktop path grant
    -> POST /api/import-jobs
    -> ImportJobManager.start()
       - cancel prior non-terminal job
       - assign latest ownership token
       - serialize full-resolution jobs
    -> preview phase
       - MediaBrowserStore thumbnail cache
       - embedded/primary/base preview when available
       - color-aware SDR JPEG thumbnail output
    -> authoritative development phase
       - SessionStore.prepare_session()
       - load_image()
       - format decoder
       - source interpretation -> linear ACEScg
       - HDR analysis and source descriptor
       - LoadedSession remains private
    -> atomic activation
       - activate new session, or transactionally redevelop current RAW session
       - invalidate prior render cache only after success
    -> frontend fetches the ready session and renders a draft/settled preview
```

The frontend maintains its own import generation in addition to the backend ownership token. A
late response or poll from an older selection cannot clear, activate, or overwrite a newer import.

## 3. State and phase contract

Terminal job states are `ready`, `error`, and `cancelled`. Non-terminal state/phase labels describe
the work actually in progress:

- `queued`: waiting for the serialized development worker.
- `previewing`: extracting or decoding the non-authoritative source preview.
- `metadata`: inspecting authoritative container/source metadata.
- `hdr_reconstruction`, `sdr_decode`, `decoding_avif`, `decoding_jpegxl`, or `developing_raw`:
  format-specific pixel work.
- `lens_correction`: selected RAW optical correction.
- `color_conversion`: conversion to the application working-space invariant.
- `ready`: session prepared and atomically activated.

Phase reporting occurs before the corresponding expensive call. “Still working normally” is only
a time-based reassurance; it is never used to disguise an unknown or stale phase.

## 4. Pixel and color invariants

- The authoritative HDR working image is H×W×3 `float32`, linear ACEScg.
- The application convention is `0.18 == 100 nits`.
- An SDR reference, when available, is H×W×3 `float32`, linear sRGB in `[0, 1]`.
- A decoder that already returns canonical ACEScg declares
  `decoder_normalized_to_acescg: true`. The generic loader then adopts that array without a second
  full-frame normalization or copy, unless a user interpretation override requires reprocessing.
- Unknown primaries or transfer characteristics remain unknown and trigger the interpretation
  gate; thumbnail or loader code must not guess them from file extension or pixel values.
- Large color transforms operate in row strips and reuse writable float32 source buffers where the
  encoded representation is no longer needed. This bounds transform temporaries independently of
  image height.

## 5. AVIF reference path

### Non-authoritative preview

`decode_avif_preview()` inspects CICP metadata, decodes only the primary AVIF item through
`imagecodecs`, converts that primary to ACEScg, and produces an SDR display thumbnail. For a
gain-map AVIF, the primary is typically the SDR base. The preview path never calls
`avifgainmaputil tonemap`.

### Authoritative gain-map import

1. `avifdec --info` establishes gain-map presence, base/alternate headroom, CICP, bit depth, and
   rendition roles.
2. `avifgainmaputil tonemap` reconstructs the requested full-headroom HDR rendition as a 16-bit PNG.
3. The exact SDR primary is decoded directly with `imagecodecs`; it is not routed through an
   AVIF-to-PNG subprocess.
4. HDR PQ/BT.2020 -> ACEScg and SDR primary -> linear sRGB conversions run in bounded strips and
   reuse the decoded buffers.
5. Metadata records reconstruction, source CICP, headroom, timings, and the canonical-output flag.

This structure reduced the measured 42 MP color-conversion stage from 61.9 seconds to 9.6 seconds
and the exact SDR decode from roughly 14–18 seconds to about 2.2 seconds.

## 6. Cancellation and ownership

Cancellation has four layers:

1. The frontend increments `importGeneration`, stops polling the old job, disables export gating,
   and restores the prior document view.
2. `DELETE /api/import-jobs/{id}` sets the job cancellation event and terminal state.
3. Progress callbacks reject phase changes from a job that no longer owns the import generation.
4. Cancellable native AVIF subprocesses are polled; cancellation terminates them, escalating to a
   kill only if graceful termination does not complete promptly.

In-process native library calls such as a single LibRaw demosaic cannot always be interrupted in
the middle of that call. They must check cancellation immediately before and after the call and at
every subsequent bounded phase. Regardless of native interruption support, cancelled output is
never activated.

If an import starts while another document is open, the staged thumbnail does not replace the
current preview. Cancelling leaves the current session, edits, project association, and render
surface intact.

## 7. Resource policy

- Full-resolution session development is serialized (`max_workers=1`) because a 42 MP HDR image
  and SDR reference already occupy roughly 1 GB as float32 RGB before transient decoder memory.
- Browser thumbnail extraction uses a separate bounded semaphore and an on-disk keyed cache.
- Staged import requests `fast_only` thumbnails. The allowlist is limited to embedded RAW previews,
  Pillow bitmap previews, and the AVIF primary rendition. TIFF, EXR, HEIF, HDR/PFM, and JPEG XL go
  directly to authoritative development instead of decoding twice.
- Superseded jobs cannot activate, even if a native call returns after cancellation.
- Strip height is a memory-control parameter, not a quality parameter; each pixel uses the same
  color transform as the former full-frame path.
- Generated benchmark media and screenshots remain disposable under `codebase/output/` or system
  temporary storage. Private source photographs are never committed as test fixtures.

## 8. Regression coverage

Deterministic tests enforce:

- fast AVIF primary preview without gain-map reconstruction;
- CICP-aware preview conversion;
- strip-bounded conversion parity with the full-frame color transform;
- prompt native subprocess cancellation;
- latest-request-wins activation and preserved current session;
- truthful preview phase labels and the frontend Cancel control contract;
- no second generic-loader normalization for canonical decoder output.

An opt-in local-media test accepts `HDR_FINISHER_LARGE_AVIF=<path>` and builds a complete staged
40+ MP session—including its fast primary preview—with a default 120-second regression ceiling.
The representative 24 MB Lightroom file passed in 34.69 seconds and 38.20 seconds on consecutive
post-change runs on the implementation workstation.

## 9. Checklist for adding or changing an importer

1. Define whether a cheap embedded/base/primary preview exists; do not reuse the authoritative
   decoder by default.
2. Make source color/transfer interpretation explicit and refuse unsafe guesses.
3. Identify the largest simultaneously live arrays and bound full-frame transforms.
4. Avoid reading the same payload or decoding the same rendition twice.
5. Declare canonical decoder output so the generic loader does not normalize it again.
6. Emit a phase before every expensive operation.
7. Propagate cancellation into subprocesses and check it around in-process native calls.
8. Keep prepared sessions private until the latest-owner activation check.
9. Add numerical parity tests, cancellation tests, phase/ownership tests, and an optional real-media
   performance gate when small deterministic fixtures cannot represent production scale.
10. Record measured end-to-end session-ready time; decoder-only timing is insufficient.

## 10. Cross-format audit and current paths

| Source family | Fast staged preview | Authoritative path and improvements | Cancellation boundary |
|---|---|---|---|
| PNG, ordinary JPEG, BMP | Pillow applies orientation, converts a valid ICC profile to sRGB, and downsizes before float conversion | Pillow decode followed by shared strip-bounded normalization | Before/after in-process decode and during color/analysis strips |
| JPEG Ultra HDR | ICC-aware SDR base through the same Pillow thumbnail path | Exact SDR base plus native gain-map reconstruction; bounded SDR EOTF and HDR gamut conversion; canonical output is not normalized twice | Native reconstruction subprocess is terminated; bounded phases also poll |
| AVIF | CICP-aware primary/base rendition; gain map is never reconstructed | Exact SDR primary is decoded directly; HDR reconstruction is native; both renditions convert in reused strip-bounded buffers | Native subprocess termination plus strip polling |
| RAW/DNG | Embedded LibRaw thumbnail; neutral fallback if none exists | One LibRaw development, optional strip-bounded Lensfun remap, strip-bounded AP0-to-AP1 conversion; canonical output is not normalized twice | Checks around LibRaw and Lensfun calls and within remap/color strips; a single in-process demosaic cannot be interrupted mid-call |
| JPEG XL | None; authoritative decode begins immediately | Container bytes are read once for marker/basic-info inspection and decode; declared precision is retained; known color converts in strips; canonical output is not normalized twice | Checks before/after the in-process libjxl decode and during color strips |
| TIFF | None; authoritative decode begins immediately | One tifffile decode and strip-bounded source conversion; large-frame analysis uses an exact strip peak plus bounded robust sample | Checks around decode and within color/analysis strips |
| OpenEXR | None; authoritative decode begins immediately | Preallocates one RGB frame and fills channels sequentially instead of retaining three channel buffers plus a stacked frame; conversion and analysis are bounded | Checks between channel reads and within bounded phases |
| HEIC/HEIF | None; authoritative decode begins immediately | Primary decode once; Apple gain-map EOTF/application is strip-bounded and reuses the base buffer; SDR reference is preserved separately | Checks around native decode and within gain-map/color/analysis strips |
| Radiance HDR/PFM | None; authoritative decode begins immediately | One floating-point imageio decode followed by bounded conversion/analysis | Checks around decode and within bounded phases |

The 42 MP Photoshop float TIFF is the representative non-AVIF stress case. During this audit its
staged session-ready time measured 3.89 seconds. Updating the profiler to model the real `fast_only`
decision rather than forcing an otherwise-unused full thumbnail reduced the one-process profile
from 5.52 seconds and 1.74 GB peak RSS to 3.65 seconds and 1.15 GB peak RSS. Large-frame analysis
alone fell from about 592 ms to 120–150 ms while retaining an exact maximum-luma scan.

## 11. Known boundary: legacy byte upload

The normal Electron path-grant flow uses staged jobs. A legacy browser/fallback `multipart/form-data`
endpoint still copies an uploaded file to application-owned temporary storage and creates a session
synchronously. It benefits from all shared decoder, bounded-memory, canonical-output, and analysis
improvements, but it does not yet expose backend phases or native cancellation. Converting that
endpoint to an owned-source import job requires explicit temporary-file lifetime and activation-race
handling; a client-only fetch abort would be unsafe because the server could still activate the
session. This remains a contained follow-up rather than an unreviewed partial cancellation model.
