# Code Audit Stabilization Sprint PRD

**Status:** Approved; code implementation completed on August 20, 2026. Physical-device and full-corpus
exit gates remain pending. The validation record is maintained in
[Extended Formats and Media Browser Validation](../testing/Extended_Formats_and_Media_Browser.md).

**Date:** August 20, 2026
**Audit branch:** `codex/jpeg-xl-raw-browser` at `fdf6633`
**Comparison base:** `main` at `d8ec5ef`

## 1. Outcome

Stabilize the new JPEG XL, RAW/DNG, staged-import, and media-browser work before treating it as
release-ready, while repairing two shared-state defects found in the older session infrastructure.
The sprint prioritizes prevention of edit loss and incorrect pixels over UI polish or new format
scope.

No production fix should begin until this PRD is reviewed and approved.

## 2. Audit method and baseline

The audit began with the single new commit, followed its integrations through loader, session,
project, export, Electron, frontend, packaging, and test code, and then expanded into the shared
session/render infrastructure and the preceding AVIF/desktop changes.

Validation completed during research:

- Python: 478 passed; one known native Ultra HDR gradient gate failed at a five-sample plateau
  against the current limit of four.
- Two launcher tests initially failed because the managed sandbox forbids localhost binding; both
  passed outside that restriction (7/7 launcher tests passed).
- Desktop unit tests: 7/7 passed.
- Electron source-mode integration smoke: passed, including staged source open, project save,
  export, authorization boundary, and overwrite behavior.
- Python bytecode compilation, JavaScript syntax checks, and `git diff --check`: passed.
- The existing JPEG XL round trip, RAW/Lensfun, media-browser, and staged-import tests passed, but
  the edge cases below are not represented by those tests.

Primary library contracts checked during the audit:

- [`imagecodecs`](https://github.com/cgohlke/imagecodecs) describes metadata inspection as outside
  its block-codec focus and notes that its API is not stable.
- [`rawpy` postprocess parameters](https://letmaik.github.io/rawpy/api/rawpy.Params.html) confirm
  the selected as-shot white balance, AHD, 16-bit output, no-auto-bright, gamma, and highlight
  controls.
- [Lensfun's modifier contract](https://lensfun.github.io/manual/latest/structlfModifier.html)
  confirms the required color, geometry, and subpixel correction stages and that applications own
  the interpolation step.

## 3. Confirmed findings

### AUD-01 — RAW re-development discards the active edit document

**Priority:** P0 / destructive data loss
**Area:** frontend staged import, session activation, project state

`applyRawImportSettings()` grants the current source path and calls `openStagedDesktopSource()`.
That path creates and activates a new session with default global adjustments, no local adjustments,
revision zero, no undo history, and an empty project path. It then synchronizes that clean state to
the desktop shell. The UI describes the action as re-developing the source, not replacing the
editing document.

A direct session/job reproduction changed HDR exposure to `2`, re-imported the same source, and
observed exposure `0` and revision `0` in the ready session.

**Planned correction**

- Add an atomic in-place source re-development operation scoped to the current session.
- Prepare and validate the new source pixels before mutating the active session.
- On success, retain global adjustments, ordered locals, interpretation where applicable, project
  association, and undo/redo policy defined below; replace source pixels, metadata, analysis,
  render cache, and persisted RAW settings as one transaction.
- Mark the document dirty and increment its revision exactly once.
- On failure or cancellation, leave the old pixels, edit document, previews, project association,
  and dirty state intact.
- Treat ordinary source replacement, project open, and eject as separate destructive operations
  covered by AUD-06.

### AUD-02 — JPEG XL integer fallback can change brightness by an order of magnitude

**Priority:** P1 / pixel correctness
**Area:** `jpegxl.py`

When the private libjxl basic-info probe is unavailable, bit depth is inferred from the brightest
decoded sample. A dark 12-bit image whose maximum sample is 64 is therefore classified as 8-bit and
divided by 255 rather than 4095. The audit reproduced a decoded maximum of `0.25098` instead of
`0.01563`, a 16.06x error. The application marker's explicit `bit_depth` field is not used by this
fallback.

This is especially risky on packaged platforms where libjxl may be linked in a way that allows
`imagecodecs` decoding but does not expose a separately discoverable dynamic library to `ctypes`.

**Planned correction**

- Never infer nominal integer precision from image content.
- Prefer validated container/basic-info precision, then the application marker for the app's own
  output; reject ambiguous high-bit-depth integer input rather than rescaling it heuristically.
- Validate marker schema version and field types before granting automatic interpretation.
- Extend export validation to assert 12-bit basic info, Rec.2020/PQ signaling, decoded finite range,
  representative code values, shape, and the application marker.
- Add dark, near-black, diffuse-white, saturated, and 10,000-nit cases with the dynamic-library
  probe deliberately disabled.

### AUD-03 — Concurrent staged jobs can both report ready while one session no longer exists

**Priority:** P1 / import reliability and memory safety
**Area:** `import_jobs.py`, `sessions.py`, staged-import API and frontend polling

The job manager permits two full imports, but `SessionStore` retains only one current session. A
two-job reproduction returned `ready` plus a session ID for both jobs; the first ID immediately
raised `Session not found` after the second activation. Cancellation is cooperative only between
phases and does not stop a native decode, so rapidly changing a 42 MP selection can also leave two
large decodes running concurrently even though only one result can be used.

**Planned correction**

- Define staged import as latest-request-wins for this single-document application.
- Give each request a generation/ownership token and allow activation only when that token is still
  current.
- Make terminal job state and session availability one atomic transition.
- Keep prepared sessions private until activation; dispose superseded prepared results.
- Prevent a cancelled/superseded job from changing phases back to `developing` or activating later.
- Serialize full-resolution development unless measured memory evidence supports bounded parallel
  decodes; thumbnail extraction may retain separate bounded concurrency.
- Ensure the frontend can cancel an in-progress import from replacement, eject, close, and error
  paths, and cannot let an old poll clear the state of a newer job.

### AUD-04 — Lens profile choices are duplicated and some cannot be reapplied

**Priority:** P1 / reproducibility
**Area:** `raw_import.py`, RAW controls, project persistence

In the first 1,000 catalog rows, 154 profile IDs were duplicated. Two displayed profiles had no
camera identity and could not be resolved manually because `find_cameras("", "")` returned hundreds
of cameras. The saved `database_version` is the Python package version, not a verified correction
database identity, and it is not checked when a project is reopened. In addition, default `Auto`
causes RAW import to fail if Lensfun is missing or its database cannot load, even though pixel
development through LibRaw could otherwise succeed and the first-open UI offers no way to choose
`Off` beforehand.

**Planned correction**

- Generate canonical, deduplicated profile records with stable camera, lens, mount, and database
  identity; do not display records that cannot be resolved back to exactly one correction target.
- Persist and verify the actual database identity needed for reproducibility.
- Reopen an exact saved profile only; if unavailable or changed, leave correction Off and return a
  visible warning without substitution.
- Make `Auto` soft-fail to uncorrected pixels when Lensfun/database capability is unavailable;
  retain a hard error for an explicitly requested Manual profile that cannot be honored.
- Add deterministic fake-database tests for duplicate mounts, blank camera matches, ambiguous
  matches, database changes, unavailable Lensfun, and exact project reopen.

### AUD-05 — `replace_document` can save an interpretation that was never rendered

**Priority:** P1 / saved-project fidelity
**Area:** `sessions.py`, edit-state API

The shared `replace_document` command assigns `interpretation_override` but does not reload or
renormalize the source. A reproduction changed the stored override to BT.2020 Linear while the
active descriptor and pixels remained sRGB. Saving that state records the BT.2020 override, so the
project can reopen with different pixels from those shown before save.

**Planned correction**

- Exclude source interpretation and RAW development settings from generic edit-document
  replacement, or route changes through the same transactional source-reload operation used by the
  dedicated endpoints.
- Validate that immutable source identity fields in a replacement document match the session.
- Guarantee that the active descriptor, normalized pixels, stored override, render cache, and saved
  document describe one interpretation revision.
- Add API tests that attempt mixed adjustment/interpretation replacement and verify either an
  atomic reload or an explicit validation error.

### AUD-06 — Destructive document transitions have no unsaved-change guard

**Priority:** P1 / user data safety
**Area:** frontend commands and Electron document lifecycle

Import Source, Open Project, Eject, and RAW re-development can replace or clear a dirty session
without using the desktop shell's existing Save/Discard/Cancel close flow. AUD-01 makes the RAW case
particularly misleading, but the underlying gap predates the new commit.

**Planned correction**

- Centralize destructive-transition handling behind a Save / Discard / Cancel decision.
- Do not consume a one-use path grant until the transition is allowed to proceed, or reacquire it
  safely after Save.
- Make Cancel preserve the exact current session and UI.
- Make Save wait for pending edits and abort the transition if save fails or is cancelled.
- Exempt successful in-place RAW re-development because it preserves the edit document and becomes
  a normal dirty edit.

### AUD-07 — Media-browser selection and thumbnail color are unreliable

**Priority:** P2 / browser UX and preview trust
**Area:** `media_browser.py`, media-browser frontend

In source mode, single-clicking a directory enables **Open image** and submits that directory to the
source-file grant, producing an error instead of navigating or remaining disabled. Directory loads
also have no generation guard, so a slow earlier request may replace a later navigation result.

Thumbnail paths do not share one color-managed contract: Pillow thumbnails ignore embedded ICC
conversion, direct-HDR AVIF samples can be written as if their encoded values were sRGB, and an
unmarked JPEG XL is passed through the ACEScg thumbnail transform even though its primaries and
transfer are explicitly unknown.

**Planned correction**

- In source mode, directory single-click selects only for navigation context; double-click/Enter
  opens it, and **Open image** remains disabled until a supported file is selected.
- Add request generations or abort controllers to directory, thumbnail, and lens-search requests.
- Route every non-embedded thumbnail through an explicit decode -> source interpretation -> ACEScg
  (when known) -> SDR display transform contract. For unknown JPEG XL, show a neutral placeholder or
  a clearly non-authoritative embedded preview rather than applying invented color semantics.
- Handle thumbnail failures with a stable placeholder and status text.
- Add keyboard, stale-response, non-ASCII path, ICC, direct-HDR AVIF, marked/unmarked JXL, and RAW
  embedded-preview coverage.

### AUD-08 — New release gates are not yet executable or representative on both target platforms

**Priority:** P2 / validation integrity
**Area:** profiler, packaging evidence, documentation

`profile_io_pipeline.py` imports Unix-only `resource`, so the documented profiler cannot run on
Windows even though Windows x64 is a supported target. Its decoder `total` phase ends before source
fingerprinting and payload metadata extraction, so it is not the same as user-visible session-ready
time. The committed performance evidence uses a 1024x576 AVIF and explicitly lacks the 12/42 MP
corpus and a memory budget.

The repository's support documents also contradict the active implementation: known limitations,
the automated-test index, alpha QA, workflow guidance, and historical product requirements still
state that JPEG XL and RAW/DNG are unavailable or deferred.

**Planned correction**

- Make process-memory sampling cross-platform and label unsupported metrics explicitly.
- Record thumbnail-ready, decode, color conversion, fingerprint, metadata/payload construction,
  activation, and end-to-end session-ready timings without double-counting.
- Run the agreed 12 MP and 42 MP corpus on source and frozen Windows x64/macOS arm64 builds.
- Measure cancellation latency and peak resident memory with sequential and superseded imports.
- Update active user/support/QA documentation after behavior passes; retain historical PRDs as
  historical and add dated implementation addenda instead of rewriting prior decisions.
- Keep JPEG XL and generic RAW labelled experimental/capability-gated until the exit gates below
  pass.

### AUD-09 — Render-cache diagnostics double-count scope misses

**Priority:** P3 / observability
**Area:** `render_cache.py`

The new-scope producer path increments `_misses` twice for one miss. This does not alter pixels, but
it makes cache diagnostics and performance comparisons inaccurate.

**Planned correction**

- Remove the duplicate increment and add an exact counter-transition test for frame and scope hit,
  miss, wait, stale, and eviction paths.

## 4. Sprint workstreams

### Workstream A — Transactional document safety

Implements AUD-01, AUD-05, and AUD-06. This workstream lands first; no RAW UI behavior is considered
safe before it passes.

### Workstream B — Deterministic format and lens correctness

Implements AUD-02 and AUD-04. It must use deterministic fixtures and fake capability/database cases
in addition to optional real-media checks.

### Workstream C — Staged-import ownership and bounded resources

Implements AUD-03. It defines the job/session state machine before changing worker counts or progress
copy.

### Workstream D — Browser preview trust

Implements AUD-07 after the authoritative loaders are stable. The browser thumbnail remains SDR and
non-authoritative, but it must not invent transfer functions or primaries.

### Workstream E — Evidence, diagnostics, and documentation

Implements AUD-08 and AUD-09, runs the full regression matrix, and updates current documentation only
after the corresponding behavior is proven.

## 5. Acceptance gates

The sprint is complete only when all applicable gates pass:

1. Re-developing RAW preserves byte-equivalent serialized adjustments and ordered locals, retains
   project association, increments revision once, and leaves the old session untouched on failure or
   cancellation.
2. Every destructive dirty-document transition offers Save / Discard / Cancel; Cancel and failed
   Save preserve the current session.
3. JPEG XL dark 12-bit input decodes to the same normalized values with and without the private
   libjxl dynamic-library probe. Ambiguous precision is rejected, never guessed from content.
4. App-produced JPEG XL passes structural, signaling, representative-pixel, finite-range, and
   re-import checks in source and frozen builds on Windows x64 and macOS arm64.
5. Two overlapping staged requests cannot both publish usable sessions; the superseded request ends
   cancelled/superseded and cannot activate later.
6. Cancelling or replacing a full-size import is acknowledged within 500 ms in the UI, and obsolete
   work does not create a second full-decode memory peak unless explicitly justified by measurement.
7. Every displayed manual lens profile resolves to exactly one target. Missing or changed saved
   profiles produce Off plus a warning; no substitution occurs.
8. RAW import succeeds without lens correction when LibRaw is available but Lensfun is unavailable.
9. Edit-document replacement cannot create a mismatch among stored interpretation, descriptor,
   normalized pixels, and the reopened project.
10. Media-browser keyboard/mouse navigation, stale-response handling, favorites, and thumbnail
    fallback pass automated Electron coverage.
11. Full Python, desktop unit, Electron source and packaged smoke, frontend contract, project
    migration, export round trip, and targeted interaction suites pass. The existing Ultra HDR
    plateau discrepancy must be either fixed or explicitly dispositioned with owner approval; it
    cannot be silently described as a green full-suite run.
12. The 12 MP and 42 MP corpus meets the documented 15-second maximum to usable preview on both
    target platforms, with a recorded peak-memory budget approved before enabling two concurrent
    full decodes.

## 6. Out of scope

- New camera-development controls, demosaic algorithms, camera profiles, highlight reconstruction,
  denoise, sharpening, or catalog features.
- JPEG XL gain maps, animation, alpha authoring, or browser-proof support.
- A frontend framework migration or broad visual redesign.
- Changes to the ACEScg working space, the `0.18 = 100 nits` convention, existing grade math, or
  existing AVIF/JPEG Ultra HDR encoding semantics unless a targeted regression proves they are
  involved.
- Signing/notarization or a new installer format.

## 7. Review decisions requested

1. Approve transactional in-place RAW re-development as the required behavior, with the current
   edit document preserved and marked dirty.
2. Approve latest-request-wins staged import and serialized full-resolution development until the
   full-corpus memory evidence supports more concurrency.
3. Approve keeping JPEG XL and general camera RAW visibly experimental/capability-gated until the
   Windows/macOS corpus and packaged gates pass.
4. Approve AUD-07 through AUD-09 in this sprint, or defer those P2/P3 items after the P0/P1 work while
   retaining them in the backlog.

## 8. Review disposition

The reviewer approved the sprint and subsequently approved execution. The original implementation
hold is therefore closed. The findings and planned corrections above remain the decision record;
the implementation details and current runtime invariants are maintained in
[Import Pipeline Architecture](Import_Pipeline_Architecture.md).

## 9. Import performance and cancellation addendum — August 20, 2026

A real 24 MB, 5304×7952 Lightroom gain-map AVIF exposed an import path that could remain on
**Reading source metadata** for more than six minutes. Instrumentation showed that metadata itself
took about 1.2 seconds. The staged thumbnail path had accidentally called the authoritative AVIF
loader, performing full gain-map reconstruction once for the thumbnail and again for the session.
The full decode also created several simultaneous 42 MP float-frame temporaries during color
conversion, and frontend cancellation did not reach the native decoder process.

Implemented corrections:

- AVIF staged/browser preview now decodes only the primary/base rendition, honors its CICP color
  metadata, and never reconstructs the gain map.
- Full AVIF import decodes the exact SDR primary directly with `imagecodecs` instead of an
  AVIF-to-PNG subprocess round trip.
- HDR and SDR color transforms run in bounded row strips and reuse their source buffers, avoiding
  multiple full-frame transform temporaries.
- The generic loader trusts an explicit `decoder_normalized_to_acescg` contract and does not copy
  or normalize already-canonical decoder output a second time.
- Import phases advance before preview/decode work begins; the UI no longer labels reconstruction
  as metadata inspection.
- The progress overlay includes **Cancel import**. Cancellation invalidates the frontend polling
  generation, preserves the currently active session, marks the job cancelled, and terminates an
  active cancellable AVIF subprocess.
- Full-resolution staged development remains serialized and latest-request-wins.

Measured on the same local 42 MP AVIF:

| Measurement | Before | After |
|---|---:|---:|
| AVIF decoder color conversion | 61.9 s | 9.6 s in the isolated decoder run |
| Exact SDR base decode | 14–18 s | about 2.2 s |
| Full decoder run | 104.5 s | 47.1 s in the first post-fix run |
| Complete session-build regression gate | More than 360 s observed in-app | 37.04 s automated local-media run |

The timings vary with native tonemapper load and system memory pressure; the local 40+ MP automated
gate uses a 120-second ceiling to catch the original multi-minute regression without treating a
single workstation measurement as a universal product SLA. Structural tests independently enforce
the fast preview path, strip-bounded conversion, no second normalization, accurate phase labeling,
preserved active session, and prompt subprocess cancellation.

The subsequent cross-format audit applied the same architecture to the remaining importers:

- staged import now requests only genuinely cheap thumbnails; TIFF, EXR, HEIF, HDR/PFM, and JPEG XL
  skip the duplicate preview decode and proceed directly to their authoritative decoder;
- known JPEG XL, RAW, and JPEG Ultra HDR output declares canonical ACEScg and bypasses the generic
  loader's former second normalization;
- JPEG XL container inspection and pixel decode share one payload read;
- RAW normalization, Lensfun remapping, HEIF Apple gain-map application, and shared source color
  transforms are strip-bounded and cancellation-aware between native phases;
- EXR allocates one output frame and fills channels sequentially instead of retaining three channel
  planes plus a stacked copy;
- large-frame HDR analysis keeps exact maximum luma but bounds the robust-percentile sample and
  temporary arrays;
- ordinary bitmap thumbnails use an ICC-aware Pillow thumbnail path that downsizes before float
  working-space construction;
- progress now names bitmap, TIFF, EXR, HEIF, HDR/PFM, analysis, and session-indexing phases.

On the representative 433 MB, 42 MP Photoshop float TIFF, staged session readiness measured 3.89
seconds. The revised single-session profiler measured 3.65 seconds and 1.15 GB peak RSS, compared
with 5.52 seconds and 1.74 GB when it forced a full thumbnail decode before the session. The legacy
multipart byte-upload endpoint inherits the decoder improvements but remains synchronous and is
explicitly recorded as a follow-up in the architecture reference rather than receiving unsafe
client-only cancellation.

## 10. v0.5.0 implementation and release-candidate addendum — August 20, 2026

The completed stabilization work is packaged as version 0.5.0, advancing the published v0.4.0
technical preview. The release scope includes the original JPEG XL, RAW/DNG, staged-import, and
media-browser feature branch plus every correction made during the audit and hands-on proof review.

Implemented audit corrections:

- RAW re-development is transactional and preserves the active edit document, project association,
  and prior pixels on failure; dirty destructive transitions use the desktop Save / Discard / Cancel
  guard.
- Staged imports are serialized, cancellation-aware, and latest-request-wins. Superseded work cannot
  publish a stale session or clear the state owned by a newer request.
- JPEG XL integer normalization uses validated precision rather than image brightness. Application
  markers are schema-checked, and app-produced 12-bit Rec.2020/PQ files have structural and round-trip
  validation.
- Lens profiles are canonicalized and reproducible, unavailable automatic correction soft-fails with
  a warning, and explicitly requested unavailable profiles remain hard failures.
- Edit-document replacement cannot persist an interpretation that was not used to produce the active
  pixels.
- Media-browser navigation rejects directories as source files, stale responses are generation-gated,
  and thumbnails use explicit color interpretation or a non-authoritative fallback.
- Import profiling is cross-platform, reports the staged phases that users experience, and render-cache
  scope misses are counted once.

Additional proof and viewer corrections completed during release review:

- Browser proof now separates the actual delivered artifact from deterministic reference-target and
  SDR-base views. The delivered AVIF/JPEG bytes are preloaded and presented through the browser's native
  image pipeline; unsupported decoding falls back visibly to the reference rather than presenting a
  black or misleading frame.
- Proof artifact generation is concurrency-safe. Per-artifact locking, atomic decoded-reference writes,
  endpoint caching, and exact byte-length validation remove the intermittent black proof race.
- JPEG XL HDR is available as a proof format. Chromium receives the real `.jxl` delivery attempt and,
  because the current Electron Chromium build does not decode JPEG XL, the UI explicitly disables native
  delivery comparison and selects the Rec.2020/PQ reference target.
- Matched Safari checks found both gain-map AVIF and JPEG Ultra HDR darker than HDR Finisher's direct-PQ
  reference, while the two delivered formats were close to each other. No speculative encoder brightness
  compensation was added; the proof UI now makes the browser-delivery versus reference distinction clear.
- False Color and Zebra overlay selections now mark and synchronize their global edit immediately, so
  they appear on selection without toggling High-res preview. Overlay and scope refreshes share the same
  committed mode state.
- The Electron application menu exposes the platform Reload command and shortcut, providing a reliable
  renderer restart in development builds.

Release validation completed on Apple Silicon macOS:

- The complete native-tools workflow rebuilt libavif 1.4.1 and the pinned libultrahdr revision; all 14
  enabled libavif tests and the libultrahdr unit suite passed.
- PyInstaller built the private backend and Electron Builder produced an ad-hoc-signed app, DMG, and ZIP.
- The packaged Electron smoke passed source upload, filesystem and pathless drops, staged open, metadata,
  project save, export, capability discovery, and shutdown. The packaged desktop and backend both reported
  version 0.5.0; AVIF gain-map, JPEG Ultra HDR, JPEG XL, RAW/DNG, and Lensfun capabilities were available.
- Desktop unit tests passed 7/7 and JavaScript syntax checks passed. The full Python run completed with
  505 passed and one skipped; its sole failure is the previously recorded native Ultra HDR gradient gate,
  which measured a five-sample reconstruction plateau against the current four-sample limit.
- `HDR-Finisher-0.5.0-macOS-arm64.dmg` is 196,040,854 bytes with SHA-256
  `d4e2d591c05097f7109e9e47ee94b608b110da0b9729ec36a364ac88889f9f5e`.
- `HDR-Finisher-0.5.0-macOS-arm64.zip` is 197,060,605 bytes with SHA-256
  `20cc7490c12b372e2ce12bded36103994935bafe7eb57c3bc1c3bbf2a68a8b23`.

Signing/notarization, clean-machine installation, physical HDR display acceptance, the native Ultra HDR
plateau disposition, and the full Windows/macOS 12/42 MP corpus remain release-hardening gates; v0.5.0
remains an unsigned technical preview.
