# AI Denoise (Experimental): design and build plan

November 17, 2026. **Design only; nothing in this document is built.**

Steve has chosen the standalone RawNIND Bayer UtNet2 result after reviewing
blind crops. Ship it for v1 as an explicitly experimental alternative, while
keeping current Denoise and its separately planned new defaults. This is not
approval of the Wiener hybrid, the linear-RGB model, a new cache allowance,
or relaxed delivery safeguards. Recommendations requiring Steve's decision
are collected in section 9; discuss them one at a time during implementation.

## 0. Steve's revisions, November 17, 2026 (override the sections below)

1. **Never on initial development.** AI Denoise never runs on import,
   Library indexing, first development or any background preparation. It is
   chosen only inside the Denoise module for one photo, and choosing it
   re-develops that RAW, the same way Edge colour reconstruction's Expand
   already re-develops (Import/RAW module PRD). The wait happens only after
   the user asks for it, with the existing progress and Cancel. Library and
   other consumers show the AI result only after that re-development has
   finished; sections 2 and 3 are to be read with this restriction.
2. **Highlight reconstruction and AI are built together from the start.**
   The "Highlight reconstruction off" restriction (section 2, D3) is
   rejected: "I'd rather delay the AI denoise and sort that out than ship
   with this weird compromise." A combined sensor/RGB contract must be
   designed and measured first (for example: clipped areas carry no
   removable noise, so they could take the normal reconstructed result with
   a feathered transition), covering Opposed color and Edge colour.
3. **Priority.** The classical Denoise (Experimental) work comes first. AI
   Denoise waits for the highlight question; if it is not solved in time, it
   ships after v1.

## 1. Contract and evidence

Use the corrected Bayer adapter in
[`rawnind.py`](../../../../codebase/tools/denoise_eval/candidates/rawnind.py),
with the qualifications in
[Verification, November 16](rawnind-prototype.md#verification-november-16).
The earlier Bayer gain, real-crop fallback and native-speed conclusions are
superseded where that section says so. The
[trial brief](../../briefs/denoise-v1-quality-trial-2026-11-16.md),
[candidate survey](candidates.md), [Wiener trial](pilot-wiener.md) and
[public pairs](public-pairs.md) remain evidence, not shipping acceptance.

The corrected model improves mid/high-ISO synthetic fidelity, but changes
fine fabric/text, softens edges and can add halos and shadow/colour shifts.
It does not meet the trial's complete quality contract. Steve's experimental
choice permits trying that known look; it does not turn those failures into
passes. Public-pair evidence covers four held-out scenes and seven scenes
seen by RawNIND, with accepted noisy ISO 1600/3200/6400 only. There is no
independent high-ISO, skin/hair, every-camera or full-frame quality guarantee.

Production adapter invariants:

- Read visible Bayer samples before white balance. Subtract channel black
  and normalize with the verified white-level convention once. Reproduce
  the corrected adapter's explicit sensor [0,1] clipping, including its
  documented shadow bias; never clip an ACEScg image to feed this model.
  Production's per-channel metadata must be reconciled with the reference's
  global-white convention in tests, not assumed equivalent.
- Canonicalize all four 2×2 Bayer orientations spatially; keep the two green
  sites distinct. Pack `[R,G1,G2,B]` FP32, 512 packed pixels per tile. The
  output is 1024×1024 un-white-balanced **camera RGB**. Trim 128 output
  pixels on each side, keep 768-pixel cores, mirror each CFA plane and
  restore sensor phase, original dimensions and orientation exactly.
- Obtain one global exposure anchor from plain unity-WB AHD camera RGB of
  the same sensor frame. Scale the network by
  `mean(AHD camera RGB) / mean(network camera RGB)`, over disjoint retained
  cores. Do not use the packed sensor mean, which counts green twice, or
  per-tile gain. Reuse the AHD pass needed for the blend baseline where
  its domain is identical. Preserve the fixed near-zero/nonfinite gain
  guards for this model hash; reject an invalid result.
- Apply the host camera white balance, matrix, gamut/source normalization,
  calibration, orientation and applicable source/lens corrections exactly
  once. Network RGB never goes through AHD again. Preserve above-white
  headroom. The prototype's signed-pixel sentinel is not permission to
  change production's existing source sanitation; reconcile the pipeline
  document with the actual loader and camera-tail tests during the build.
- No Wiener, noise fit, ISO-dependent network strength, second network pass,
  training, online service or automatic model download at runtime.

## 2. One RAW result for every consumer

### Existing routes and the required insertion

| Consumer/route today | Trace and required change |
| --- | --- |
| CPU import/Grade | `loader.load_image` dispatches ordinary RAW to `raw_import.decode_raw`; mosaiced DNG also reaches it after `linear_dng.inspect_dng`. `_execute_raw_decode` runs sensor highlight reconstruction, then `_develop_libraw_camera_rgb`/LibRaw AHD for the camera-linear bridge (or legacy LibRaw development when the bridge is unsupported). `_apply_raw_corrections` normalizes camera RGB, applies the host WB/camera-to-ACEScg tail, Edge colour where requested, lens and source corrections. Insert a qualified AI camera-RGB alternative at the demosaic boundary; keep ordinary AHD/legacy paths unchanged when AI is off. |
| Library GPU RAW | `library_api.py` live-source preparation calls `library_gpu_raw.sensor`, which unpacks sensor/metadata; `frontend/library-gpu-raw.js` `developRaw` runs normalization/highlight repair, AHD GREEN/HOMOGENEITY/COMBINE, colour/lens work and reductions. `scheduledDevelopment` owns its grant; backend `library_gpu_raw.developed` accepts results into the Library source/picture stores. **AI-selected photos must bypass this sensor/AHD route** and request the shared backend AI scene through the existing RGB/CPU-developed handoff. GPU drawing and creative grading continue on those pixels. Add the guard on the backend too, so a stale frontend cannot publish ordinary AHD as AI. |
| Library DNG | Ordinary sensor GPU RAW explicitly excludes `.dng`. `library_dng.py` has CPU AHD plus ordered mandatory DNG GainMap/Warp corrections; `library_dng_linear.py` and `linear_dng.py` handle developed linear DNG separately. AI eligibility must therefore be shared with the loader, not inferred from the GPU-RAW extension list. Narrow initial DNG support is below. |
| Grade previews/scopes | `sessions.prepare_session` retains the loaded source; source proxies feed geometry and the preview renderers. Replace the source transactionally with the selected blend, advance source epoch and invalidate dependent preview/scopes, current-Denoise analysis, masks that depend on pixels, Match diagnostics and delivery caches. Keep crop/zoom/mask coordinates because dimensions and orientation are unchanged. GPU and CPU preview must read this same source revision. |
| Proof/export | `proofing.py` renders the session or its source proxy; `exporters.py`/GPU delivery consume the same session source. Full Proof and native export must obtain native AI pixels, never upscale an AI preview. CPU delivery fallback renders the same AI source; a failed drawing GPU does not mean switching back to AHD or rerunning inference. |
| Batch/reopen | `batch_export.py` opens a saved grade via `projects.open_document` or creates a session. `projects.py` passes saved RAW settings into session creation. Resolve AI and its cache before rendering each photo, including detached workers, HDR and SDR output, and saved projects opened without visiting Grade. |

Create one backend source-preparation service used by all these callers,
keyed by source identity and the complete RAW recipe. A single-flight job
shares one inference between Library, Grade, Proof and export; cancellation
of one subscriber must not cancel another subscriber's delivery. A completed
job publishes only if the source identity, recipe and requesting generation
still match. Expose requested/effective method, model hash, source revision,
preparation state and any failure reason in metadata/logs.

### Pipeline order and presentational exceptions

The proposed order is:

```text
Bayer decode -> AHD baseline and AI joint demosaic+denoise
 -> identical qualified source colour/lens tails for each endpoint
 -> source-linear Strength blend -> existing source normalization/session
 -> geometry -> current Denoise stage (bypassed for AI method)
 -> Exposure and existing creative grade/locals/Film/finishing
 -> final Highlight Compression/gamut -> preview, Proof or export
```

This adds a source-development operation; it does not move current Denoise
from its existing post-geometry, pre-Exposure position. Update
[`image-processing-pipeline.md`](../../image-processing-pipeline.md) in the
implementation commit, including its historical CPU-authority wording versus
the current GPU delivery/CPU fallback contract. Preserve the exact HDR cap
before encoding and the existing 1% encoded rounding allowance afterward.

**Recommend mutually exclusive methods for v1.** AI is shared by HDR and SDR;
it cannot clean just one rendition because it changes their common source.
Current Denoise keeps its separate HDR/SDR enablement and controls. When AI
is selected, preserve those values but bypass both current-Denoise lanes,
including linked SDR. Returning to Current restores them. No automatic
stacking: otherwise Steve's chosen “RawNIND alone” would be smoothed again.
A later classical method can register its processing stage, eligibility,
shared/lane scope and controls in the same method-choice surface. Do not
force all methods into the post-geometry shader interface.

An embedded camera JPEG, Compare's explicit original/camera view, and RAW
sensor Focus/Exposure diagnostics cannot show the AI result. Keep these
deliberate exceptions labelled **Camera preview**, **Original** or **RAW
sensor**. While AI is preparing, a Library cell/Grade viewer may retain a
labelled camera/normal-RAW stand-in or its last valid same-photo image;
show **Preparing AI Denoise…**, never advertise the stand-in as developed AI.
Invalidate/version finished thumbnails, screen previews, native scenes and
delivery keys when method/Strength changes. Once ready, grid, filmstrip,
Single, Compare's edited side, Grade and scopes use the current AI blend.
No inference for unselected, AI-off photos during ordinary indexing.

On missing/corrupt model, invalid gain/pixels, cancellation or resource
refusal, preserve the recipe and last valid image. With no valid AI source,
show **AI Denoise unavailable — normal RAW preview** and a short reason.
Offer Retry after a changed condition and Current as an explicit choice.
Proof/export wait for successful preparation or report failure; a batch
marks that photo failed and continues according to existing batch policy,
preserving destinations. Never silently deliver an AHD fallback under an AI
recipe. Rendering GPU failure still follows one GPU try then CPU, using the
same valid AI source. CPU ML failure is not retried in a loop.

### Eligibility and source-correction boundary

Decide from decoded/header sensor topology and the existing camera/DNG
interpretation checks, not filename alone. Headers may return “Checking RAW
support…” until admitted unpacking verifies the CFA. Unknown is not eligible.

| Input | Initial recommendation / disabled reason |
| --- | --- |
| Ordinary single-frame Bayer RAW, valid black/white levels, supported camera bridge/WB/matrix | Eligible for all four Bayer phases, once source settings below qualify. Test Canon GRBG and Sony RGGB plus deterministic fixtures for the other phases. |
| Bayer mosaiced DNG | **Yes for the simple supported subset:** a valid Bayer mosaic and existing camera bridge, with no required or optional source operation that is unqualified with AI. Keep active area, crop, orientation and interpretation. `.dng` alone is insufficient. |
| Bayer DNG requiring GainMap/Warp, linearization or other source-specific operations not yet qualified with AI | Disabled: “AI Denoise does not yet support this DNG's source corrections.” Existing DNG import remains available. Do not skip mandatory operations or automatically substitute a new colour tail. Extend only after exactly-once and geometry tests. |
| X-Trans RAF / other CFA / reduced RAW that is already RGB | “AI Denoise needs a Bayer RAW sensor image.” Existing route/limitations remain. |
| Linear DNG, including externally denoised/demosaiced DNG | “This DNG has already been demosaiced.” |
| Monochrome RAW / unsupported dual-green WB, matrix or RAW topology | “AI Denoise does not support this sensor.” Keep the detailed diagnostic in logs. |
| JPEG, TIFF, HEIF, HDR, EXR, PFM, gain-map inputs and other developed RGB | “AI Denoise is available for Bayer camera RAWs only.” No reinterpretation as Bayer and no use of the rejected linear model. |

**Highlight reconstruction is an additional initial restriction, not a file
format.** The CPU camera bridge applies opposed-colour sensor repair before
AHD; Edge colour includes that repair plus a later RGB effect. The verified
network consumes the original normalized, clipped sensor. Feeding repaired
values into it and clipping again may erase highlight repair; feeding the
original while claiming repair was applied is also wrong.

Recommend initially enabling AI only with **Highlight reconstruction off**,
using the same off-state AHD baseline/anchor. Keep Lensfun corrections where
the existing common tail is qualified. Disable the AI choice otherwise:
“Turn off Highlight reconstruction to use experimental AI Denoise.” Do not
change that setting automatically; the default reconstruction is on, so this
extra step must be explained beside the method choice. While AI is active,
disable reconstruction with the reciprocal reason, allowing a return to
Current. Future combined support requires a separately verified sensor/RGB
contract, not a reordered effect hidden in this integration. This narrower
first release needs Steve's coverage decision (D3).

## 3. Controls, live Strength and persistence

Use the existing Denoise disclosure with a labelled **Method** select:
**Current** and **AI Denoise (Experimental)**. Unsupported choices remain
discoverable with the short reason beside the select; expose it through
`aria-describedby` even where native disabled options cannot receive focus.
Do not disable Current on an unsupported source.

AI shows **Applies to HDR + SDR**, a shared enable/bypass eye, and one
full-width **Strength** instrument slider, 0–100%, step 1%. **Off per photo
by default**; recommend 100% on first explicit enable because that is the
standalone result Steve selected. Zero returns the normal AHD endpoint
exactly; 100 returns AI exactly. No extrapolation above 100 or nonlinear
“more AI” promise. Bypass preserves the chosen method/Strength; whole-module
reset returns the default Current/off state; Strength reset returns 100%.
Current's separate defaults task owns its controls and reset values.

Define `source(s) = AHD + s * (AI - AHD)` in aligned scene-linear ACEScg
after each endpoint's identical qualified RAW tail, before creative geometry.
Neither endpoint contains current Denoise or a creative grade. Special-case
0/1 so endpoint identity is exact. A partial blend mixes demosaicing and
restoration as well as noise; it is not a calibrated sensor-noise amount.

Preparation creates the native AI endpoint once and aligned AHD/AI preview
endpoints or visible native tiles. Dragging Strength blends already-resident
preview endpoints on the existing GPU render path, then runs the grade.
It performs no inference, RAW read, AHD pass or full-frame disk read. Settle
the latest revision from bounded native strips/tiles; keep the proxy visible
until it is ready. CPU preview fallback uses the same bounded blend. At
100% zoom prepare visible native endpoint tiles before declaring Ready;
display “Preparing detail…” for a newly exposed region. An instant low-res
response is not a claim of instant native full-frame recomputation.

Luminance, Color Noise, Detail Recovery, noise-size controls and current
Recalculate do not apply to AI; hide them while preserving their values.
Keep a Retry action only for a failed preparation. Current's Show noise
cannot be reused without qualification: if provided for AI, label it
**Show difference** and explain “Includes changes from RAW development as
well as noise removal.” It must not claim to display pure removed noise.

Store source-level AI settings in `source.raw_import_settings`, provisionally
an `ai_denoise` object: `enabled`, stable `method` ID
`rawnind-bayer-utnet2`, `strength` in [0,1], `adapter_revision`, and
`model_sha256`. Existing `demosaic: ahd` describes the normal/bypass baseline;
the source resolver explicitly replaces it when AI is enabled, and records
the effective demosaic in provenance. There is only one authoritative AI
setting; the Denoise UI reflects it rather than storing another lane copy.
Keep current `denoise.hdr/sdr` data independently. Validate contradictory
highlight/AI settings rather than quietly changing them.

Save settings, not tensor arrays, cache paths or progress. Cover sidecars,
projects, autosave, Undo/Redo, virtual copies, grade copy/paste, presets and
batch worker transport. AI toggles and method changes are one undoable
transaction. Copying RAW settings to incompatible files reports skipped AI
settings with a reason; it must neither mark AI applied nor wipe unrelated
grades. A Strength-only change invalidates blended-source/finished results,
not inference. Downstream Exposure/geometry/Film edits never rerun ML.

**Honest update rule:** “Experimental AI Denoise is still being refined.
Its appearance may change after an app update.” Record the producing model
hash/revision for diagnosis, invalidate old caches, and show **AI Denoise
updated — review this photo** before delivery with a new model/adapter.
Keep the user's enable/Strength intent, require acknowledgement of the
changed experimental result, and use the installed version. Do not retain
old models, migrations or compatibility renderers. AI-enabled experimental
projects/sidecars are the affected projects; ordinary AI-off projects do
not acquire a new look. Export finished files if an exact historic look
must be retained; a cache is disposable, not an archival promise.

## 4. Runtime, offline assets and release packaging

Recommend **`onnxruntime==1.32.0`, Python 3.12, CPUExecutionProvider, FP32 on
every platform for the first release**. This is the prototype's runtime;
its metadata requires Python >=3.11. Specify the provider rather than letting
macOS choose CoreML. The model card documents Bayer FP16 overflow on GPU/ANE;
DirectML, ORT-Web, CUDA and CoreML acceleration are unqualified and excluded.
CPU inference coexists with normal WebGPU preview/delivery.

PyPI 1.32.0 metadata checked November 17 via its small
[JSON record](https://pypi.org/pypi/onnxruntime/1.32.0/json), without downloading
wheels or running inference:

| Shipping target | CPython 3.12 wheel | Compressed wheel size |
| --- | --- | ---: |
| Windows x64 | `cp312-cp312-win_amd64` | 16,698,767 B / 16.70 MB |
| macOS Apple silicon | `cp312-cp312-macosx_14_0_arm64` | 22,519,308 B / 22.52 MB |
| Linux x86_64 / Flatpak x86_64 | `cp312-cp312-manylinux_2_28_x86_64` | 27,780,211 B / 27.78 MB |

These are wheel transfer sizes, not installed or installer deltas. Windows
1.31.1's older 47.916 MB installed-runtime measurement in the B1 report is
not a measurement of 1.32.0 on these platforms. Plan roughly **50–90 MB
compressed installer addition** for the single 31.056 MB Bayer model plus
one CPU runtime/dependencies, per the survey; installed delta and final
compressed delta are unknown. Keep the proposed **150 MB maximum added
installer size per platform**, with exact bytes measured during packaging.
Do not bundle linear weights, PyTorch, training tools or public datasets.

Add the exact runtime requirement to app requirements and the separate
Flatpak requirements. Pin/hash wheels and dependency resolution used by
release builds (flatbuffers, packaging, protobuf and existing NumPy; inspect
the final dependency set). Linux's wheel needs glibc 2.28 or newer: verify
against the Debian build baseline and every ELF in `verify_linux_package.sh`;
Flatpak's bundled CPython 3.12/runtime must load the same ABI. macOS wheel
minimum is 14.0 and must agree with the app deployment target. Windows must
load the native DLLs on a clean supported Windows 11 x64 machine without a
developer Python or additional manual runtime installation.

Proposed source asset location:
`codebase/backend/hdr_finisher/model_assets/denoise/rawnind-bayer-utnet2/model.onnx`,
with a small manifest containing upstream pins, adapter revision, attribution,
expected bytes, licence choice and the expected SHA-256:

```text
da27509dab6a2915da67e988acd86cf71f9d5bbc8d1aa0ed32933578a887b901
```

Use a deterministic build-time fetch/extract tool for the pinned
[darktable release model archive](https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel).
Seal/check the archive SHA during implementation as well as the extracted
model SHA; retain only the Bayer asset in the shipping resource tree. The
research `output/` directory is never a production dependency. Release CI
and setup obtain the asset before packaging; application use is fully
offline. A missing build asset fails the build, not an optional feature skip.
No unpinned “latest” URL or Git LFS pointer may enter a package.

`HDRFinisherBackend.spec` must collect ORT's Python imports, native binaries,
provider support libraries and licences plus the model/manifest as package
data. Audit `HDRFinisher.spec` if it is still supported; keep both applicable
resource paths correct. Resolve resources with the existing frozen/source
application resource mechanism, not cwd. Check the model hash on first use
per backend process before constructing the ORT session, and on any asset
replacement; CI checks every built asset. Do not hash 31 MB on every slider
move. Corruption disables AI with a reinstall/repair reason, without network
repair or silently substituting another model.

For Flatpak regenerate `generated-sources/python-sources.json` with
`generate-sources.sh`, adding ORT to wheel preferences if required. Include
hash-pinned offline model sources and install resources/licences under
`/app`; write result caches only in the app's writable XDG cache area.
No expanded sandbox network/GPU permission is needed for CPU inference.

The weight grant is explicitly **GPL-3 plus CC-BY-4.0** in the upstream
[pre-trained-model grant](https://github.com/trougnouf/rawnind_jddc/blob/e80fb7b14dc440bba38c01f312fd3cc02deb566c/README.md#pre-trained-models),
not inferred from the code licence. Select GPL-3 for this GPL-3 app while
retaining author/model/conversion attribution and the dual-grant provenance.
ORT is MIT: retain its licence and wheel third-party notices. Add both to
`THIRD_PARTY_NOTICES.md`, bundled notices/About licences and the source
distribution, including conversion provenance at the pinned darktable-ai
commit in the candidate report and any adapted upstream code licence.
Redistribution must include the available corresponding model/adapter source,
conversion materials and build instructions, or identify any unavailable
material for review before packaging; an external model-card link alone is
not the source-distribution plan. Keep dataset/photo permissions separate.

Extend `desktop/tests/electron-smoke.js` packaged tests: use the **frozen
backend**, verify model/hash/provider, infer one tiny deterministic Bayer
fixture through the production service, check finite shaped output and
non-identity against normal development, exercise enable/disable/reopen and
one small Proof/export. The real-model check must fail rather than skip in
packaged builds. No full-resolution RAW/ML benchmark in CI smoke. Include a
small generated Bayer DNG if it can carry valid deterministic camera metadata;
otherwise add an explicitly licensed, small Bayer fixture and its provenance.
Test unsupported input and forced missing/corrupt assets using temporary
resource copies; never alter the installed signed bundle.

Windows, macOS and Linux already run `npm --prefix desktop run test:packaged`
in `.github/workflows/desktop-release.yml`. Add the equivalent production AI
self-test inside the installed Flatpak: today's sidecar/version/startup smoke
does not prove ORT can load/infer there. Exercise all four packages offline,
CPU inference even where Linux UI GPU is disabled. At release time start the
non-publishing **Desktop release** workflow on `main` early, resolve all
platform failures, and require a completely green main run before tagging.
No workflow, installer, tag or push is requested by this design task.

## 5. Minimum-Mac speed, memory and cache proposal

All estimates below use the **MacBook Neo, A18 Pro, 8 GB, one CPU thread**
research conditions. Windows/Linux need their own baselines. The
[performance table](../../performance-table.md) and corrected report warn:
the often-quoted **7.858 s at 18.02 MP / 17.101 s at 42.39 MP are old
preparation totals**, not inference alone, not the corrected adapter and
not action-to-screen timings. Their inference portions were 6.986/15.828 s.
Corrected neural pilots in the Wiener study took 7.44–9.92/18.28–21.71 s,
plus AHD/decode 1.62–2.01/3.71–3.98 s. The 22–66 s complete hybrid waits
and its multi-GB band cache do not describe RawNIND alone.

Budget **roughly 10–15 s at 18 MP / 23–30 s at 42 MP** as a planning range
for first source preparation, adding AHD and source work to corrected pilot
evidence. This is an estimate, excluding unmeasured queue, source corrections,
disk cache write, upload and on-screen presentation. Do not promise a speedup.
Keep the brief's proposed **24 MP CPU action-to-clean-picture <=45 s** as
the first whole-wait target for Steve to approve; CPU-only shipping replaces
the unqualified Mac GPU timing proposal. Background jobs yield at tile
boundaries to Grade/delivery; use available cores under the CPU budget rather
than permanently inheriting the research one-thread cap. Begin qualification
at its reproducible setting and assess bounded multithreading separately.

### Proposed ownership and sizes (D4/D5, not approved allowances)

Native inference is sequential fixed-size tiles, one shared AI job at a time
initially because 8 GB whole-app headroom is unqualified. Use an isolated
backend-owned worker so cancellation/pressure can terminate it and release
ORT arenas; account its complete process tree before allocation. Reuse its
session for the active job/queued burst, then release it when no admitted
work remains. No permanently resident ORT/model pool. Integrate admission
with existing scheduler/preflight and CPU priority; do not invent a second
GPU lock or run untracked helper work.

The [memory PRD](../../../product/modules/memory-and-caches.md) owns the
current 4,000,000,000-byte minimum/default, 3.4 GB settled target, existing
elastic rules and physical reserve. The earlier trial's 4.4 GB peak is not
permission to routinely allocate beyond the configured ceiling. Maintain
the existing 2 GB system reserve, cache shares and GPU budgets. A 42.2 MP
delivery already failed sustained physical headroom below 4 GB: standalone
research RSS is insufficient evidence that AI will coexist with the editor.

| Storage/owner | Proposal and estimated size |
| --- | --- |
| Native AI endpoint on local disk | Lossless float32 RGB after qualified RAW source corrections, 12 bytes/pixel: 216.24 MB at 18.02 MP, 508.68 MB at 42.39 MP, 732 MB at 61 MP. Tile-addressable with dimensions/colour/provenance and checksummed payloads. Avoid FP16/8-bit cache fidelity and range changes. Compression is optional only if lossless and bounded; capacity planning assumes none. |
| Managed AI disk allowance | **32,000,000,000 bytes total**, including incomplete writes and selected AHD/scratch spools. New separate local cache class, shared by Library/Grade/delivery, global LRU, with Clear AI cache in existing cache settings. This is additional to today's full-size 10 GB and screen-preview 10 GiB stores, not hidden inside them. Needs Steve's approval and a memory-PRD entry. |
| AHD endpoint | Persist only for the selected/preparing photo, within that same disk cap: another 12 bytes/pixel. Regenerate from normal development/cache on a later revisit as needed; retain the expensive AI endpoint for the batch. No second permanent AHD cache across every photo. |
| Live preview endpoints | Two bounded proxy/visible-tile endpoints charged to the existing sharp-picture owner, whose 4 GB-default share is 512 MB. A worst-case square 2560-edge RGB32 pair costs 157.29 MB; a 3:2 pair about 104.86 MB. Both, tile uploads and copies must fit the existing owner and GPU grant; reduce preview edge/evict older pictures if they do not. No two native full-photo GPU textures just for Strength. |
| Active native blended source | One normal session source (12 bytes/pixel) within the existing aggregate 600 MB retention owner; count unique backing once. 61 MP exceeds that owner and must be served without retention using existing bounded-source rules. Full native AHD+AI pairs would cost 432.48 MB / 1.017 GB / 1.464 GB before other work and are not a new RAM cache. |
| Inference/transient reservation | Provisional conservative estimate **0.70 GB + 32 bytes/source pixel** (about 1.277/2.056/2.652 GB at 18.02/42.39/61 MP), plus already-owned app/session bytes, covering model/ORT tile arenas, decoder/sensor and streamed output work. This is an unmeasured admission estimate, not an entitlement or final rate. Measure actual extra process-tree charge and use existing measured-peak +25% estimation policy. The older “about 100 MB extra Grade import” decision needs an explicit AI exception, not a silent bypass. |

Disk-backed arrays still consume resident memory/physical footprint. Stream
tile/strip writes and release mappings/pages/handles, count mapped residency,
and do not use memmap as an accounting escape. Avoid a third full-frame
blend buffer: readers own immutable source revisions; prepare a replacement
through bounded admitted storage and activate only when complete. Keep old
readers accounted until released, coalesce Strength settles and discard
stale outputs. If the safe working set cannot fit, wait/reclaim or refuse
with the existing memory message; never raise a budget to make it pass.

Cache key: source fingerprint (including existing size/mtime validation),
model SHA, adapter/runtime numerical revision, sensor phase/active area,
black/white convention, camera WB/matrix/calibration, orientation, RAW
interpretation, highlight/lens/DNG corrections and endpoint format revision.
Strength, creative grade, viewport and rendition do **not** belong in the
native AI endpoint key; they do belong in blended/finished keys as relevant.
Corrected source settings invalidate the endpoint; shared metadata that does
not change pixels must not. Write temp+atomic commit, reject partial/wrong
identity entries, recover orphan scratch on next start, and release busy
pins on success/failure/cancel/crash. Low disk space refuses preparation
cleanly. Cache eviction/clearing loses speed, never saved settings or photos.

### Cost of 45 RAWs (arithmetic estimates, not batch measurements)

Using the old 7.858/17.101 s totals gives **5.89/12.83 minutes** of preparation
for 45 × 18.02/42.39 MP; these are historical lower planning figures, not a
corrected batch promise. Using the corrected pilot ranges plus its measured
AHD/decode gives roughly **6.8–8.9 / 16.5–19.3 minutes**, before remaining
source correction, cache, grading, encoding and delivery time. Serial
preparation avoids assuming 45 ML workers or unsupported parallel speed.

With all native AI endpoints already cached, **zero additional ML calls**;
remaining cost is cache read/verification, AHD regeneration when Strength
is partial, blend, grade and encoding. For the recommended 100% Strength,
normal AHD is unnecessary on a cache hit. Endpoint reads total **9.73 GB /
22.89 GB** for the two batches, fitting the proposed 32 GB cap if other
entries are evicted. At an explicitly assumed 100–500 MB/s effective local
read rate this alone is about **19–97 / 46–229 s**, before processing; it
is not measured app latency. At partial Strength, add AHD work and its
temporary disk traffic. A cold first export pays preparation and writes;
the cache benefits revisits, second exports and Proof, not first-use ML.
For comparison, 45 × 61 MP AI endpoints alone are 32.94 GB, beyond this cap:
some will be recomputed. No promise that every 45-photo batch fits.

### Measurements to take during the build, with proposed tolerances

Do not perform them for this document. Write resulting timings to the
existing performance-table action rows with machine/date/commit/conditions;
do not create a new evidence document for every package. These are proposed
new gates, not changes to existing pinned limits:

| Missing measurement | Proposed gate/tolerance and reason |
| --- | --- |
| Corrected native first enable to final picture, cold and warm 18/24/42 MP, then bounded 61 MP | 24 MP CPU <=45 s; once a same-machine baseline exists, regression <=10% against its median with identical cache/thread/thermal conditions. The original timings are single runs and cannot support a tighter regression claim. Record decode/AHD, queue, ORT, corrections, I/O, upload and actual presentation separately to explain the whole wait. |
| Strength drag at Fit and 100%, including CPU preview fallback | No new ML/AHD/source I/O after preparation; first changed picture p95 <=50 ms (interactive feedback), with final settled picture p95 <=500 ms where resident tiles suffice. A nonresident-region preparation is measured separately and labelled. These visible-response targets need confirmation, not a microbenchmark-only pass. |
| Whole-app peak/settled and available physical RAM during AI plus Grade, then Proof/export | Existing ceiling/elastic contract, settled <3.4 GB and unchanged physical reserve remain strict, with no new allowance. New reservation >=1.25× measured extra peak, existing estimation headroom. Include helpers, mappings, GPU-host uploads and cancellation. Do not weaken existing exact limits for sample noise. |
| Native disk hit, second Proof/export and a representative cached batch | No inference on a valid hit, exact cache round-trip samples; establish whole-action baseline and allow <=10% repeat variation on the same local disk. Record cold misses separately. Estimate a 45-photo total from a bounded sample before asking to run a real batch. |
| Source parity across CPU render, WebGPU preview/Library, full Proof and export | Existing finished SDR ΔE2000 / HDR ΔE ITP mean <1, p99 <3 where this contract applies; preserve tighter existing guards. This compares render paths using the **same selected endpoint**, not AI versus AHD, whose look intentionally differs. Cache reads and Strength 0/1 source endpoints are exact. |
| Tile shifts, all CFA phases, crop/orientation, sensor normalization, gain anchor, downstream exposure | Existing seam/exposure perceptual limits mean <1/p99 <3, exact dimensions/phase and bypass. Test ±6 EV after RAW development, not by saturating the sensor input. Preserve the exact pre-encode HDR cap and existing encoded allowance. |
| ORT threading/admission/cancel and release | Compare same-Mac whole waits with ±10% timing tolerance; retain multithreading only if the whole wait improves and UI targets still pass. Cancellation must prevent stale publication exactly; propose worker memory returning within 100 MB of idle within 2 s after termination, consistent with prompt release and bounded one-tile interruption. |
| Every platform's installed/installer delta, load and tiny inference | <=150 MB added compressed installer; installed delta reported separately without an invented pass limit. Native dependency/hash/provider checks exact; same tiny finished-image parity limits as above across platforms. No installer-size percentage tolerance that could exceed the cap. |

No new GPU inference route is proposed. If later considered, first measure
the whole action and require an expected roughly 50% improvement, then
qualify numerics and memory; the model card's FP16 failure cannot be waived.

## 6. UI copy and user documentation

Follow [design guidelines](../../../design/HDR_Finisher_Design_Guidelines.md),
the component sheet and `frontend/visual-tokens.css`. Use existing select,
instrument-slider, neutral bypass eye, modified dot/reset and support/status
row components. Use existing `--font-body`, `--font-size-sm`,
`--font-size-min`, `--font-weight-medium`, `--text`, `--muted`/`--hf-ink-2`,
surface/plate, radius, focus and accent component tokens; no literal styles,
new badge colour, derived orange warning fill or new tokens. “Experimental”
is persistent text in the method option/selected label, not colour-only or
tooltip-only. Helper text wraps in the minimum 1100×720 layout and all three
themes; it must not displace viewer/status controls. No new modal on every
enable. A revision-change acknowledgement is a distinct one-time update flow.

Persistent helper: **“Still being refined. May change fine detail or colour.
Check at 100%. Applies to HDR and SDR.”** Preparation uses the existing
status row with polite live announcements, tile progress if reliable,
and Cancel while running; do not present a fabricated seconds countdown.
Ready names the selected method. Unsupported reasons remain readable and
keyboard accessible. An AI bypass should visibly say it affects both lanes.

Proposed explanatory tooltip catalogue entries (apply to source and generate
`docs/product/tooltips.md` during UI implementation, preserving Steve's
unapplied catalogue edits; keep the historical copy registry consistent):

| Control/context | Tooltip copy |
| --- | --- |
| Method select | “Choose how noise is reduced. Experimental AI works while developing a Bayer RAW and applies to both HDR and SDR.” |
| AI experimental explanation | “Still being refined. AI can alter fine detail, edges and colour, and its look may change after an update. Check important areas at 100%.” |
| Strength | “Blend between normal RAW development and the AI result. Lower values retain more original noise and detail. Changing Strength does not run AI again.” |
| Shared AI bypass | “Show normal RAW development in both HDR and SDR. Your AI Strength is kept.” |
| AI preparation | “Preparing this photo for AI Denoise. You can cancel; your original file is unchanged.” |
| AI Show difference, if built | “Shows changes from AI RAW development, including demosaicing changes as well as noise removal.” |
| Cache clear action | “Remove prepared AI results to free local disk space. Saved settings stay; photos take longer to prepare next time.” |

These explain consequences; do not add redundant label-only tooltips. Use
the eligibility table's exact short reasons for unsupported inputs, plus
“AI model missing or damaged. Reinstall the app to restore it.” for corrupt
resources. No ONNX, AHD, provider, tile, licence or tensor jargon in ordinary
product flows; technical detail belongs in logs/About licences.

Update `docs/user-guide/denoise.md` (method choice, shared AI versus current
per-lane settings, off default, wait once/live Strength, limitations, 100%
review, difference view), `import.md` (Bayer/DNG and highlight restrictions),
`projects.md` (experimental update rule and disposable cache), `library.md`
(labelled stand-ins/readiness/cache), `proof.md` and `export.md` (native
preparation, cache reuse, explicit failures), and `docs/troubleshooting.md`
(unsupported source, missing model, memory/disk refusal). Update control
reference/traceability where the new control is enumerated. Installation
docs explain bundled offline assets and supported OS/CPU requirements.

## 7. Commit-sized work packages and verification

Keep the feature unavailable until its complete source/consumer contract is
ready. Each package below is independently commit/revertable, with no
compatibility scaffolding for pre-1.0 projects. Record one short commit note:
what changed, checks run, failures and why. Coordinate the separate current
Denoise default change rather than copying its uncommitted values.

**Implementation test tiers:** run the Node and venv Python fast suites
from `codebase` for app changes. Add small result-based tests, not copied
source/label snippets. Real-model/native and GPU checks are explicit focused
work, not optional heavyweight inference buried in a fast unit test.
Use the machine-wide `tools/gpu-run-lock.py` wrapper for quick Library/GPU
checks, run one at a time, machine window 1408×794 Mac / 2560×1440 PC, and
the documented Electron/native runner. Run output-size checks before/after
GPU, timing or capture work; clean owned intermediates, retain only linked
evidence, never overwrite protected projects or copy RAWs per run.

| Package | Deliverable / commit boundary | Checks for that package/group |
| --- | --- | --- |
| W1: settle the contract | Confirm D1–D7 individually; record approved requirements in Import/RAW and Grade PRDs, approved allowances/exception in Memory, runtime in Desktop/release, and pipeline order. Add model provenance/manifest and deterministic asset acquisition, notices and dependency pins without exposing a UI method. | Documentation/link/hash metadata checks; fast suites if dependency/tool code changes. No existing GPU check covers model provenance. Tiny CPU model load/inference is an explicit later qualification, not a full-photo trial. |
| W2: production Bayer adapter | Extract production code from the research adapter without importing `tools/denoise_eval`; implement bounded worker/packing/global AHD anchor, camera tail, cancellation and narrow eligibility. Keep AI opt-in internal until integration completes. | Fast tests with tiny deterministic/fake-session tensors: four phases, both greens, odd edges, gain weighting, zero/near-black rejection, WB/matrix once, clipping domain, finite/headroom and endpoint identity. Then one tiny pinned actual-model CPU check. No current GPU driver proves neural preparation. |
| W3: source service and storage | Single-flight, scheduler estimates, disk atomicity/cap, aligned AHD baseline, preview/native endpoint readers, invalidation and release. No public toggle yet. Approve allowance/large-import exception before allocating it. | Fast cache corruption/invalidation, concurrency/cancel, eviction/disk-full and exact float round-trip tests. One admitted corrected native Mac sample per 18/42 MP class with whole-app census; 24/61 MP only to fill specific gaps. No GPU broad sweep as a substitute for memory ownership checks. |
| W4: shared consumers | Wire loader/sessions/projects/Library RGB handoff and stop ordinary GPU AHD publication for AI recipes. Source epochs cover geometry/Match/scopes/Proof/export/batch. Keep UI gated until W5. | Fast reopen/source/worker tests; extend `library-gpu-raw-single.js` for off-route preservation and use a new focused `ai-raw-shared-source.js` for AI source identity across grid/Single/Grade. Run the 90-second quick Library check once for this integration group. These drivers must exercise enabled AI, not merely unchanged AHD pixels. |
| W5: method UI and live blend | Enable Current/AI select, shared Strength/bypass, status/failure/difference semantics, Undo/paste/presets and documentation/catalogue changes. Existing Denoise controls remain method-specific. | Fast saved-data/undo/control tests; extend the new AI driver to prove no preparation during Strength drag, native zoom settle and stale-job rejection. Use `denoise-progressive-disclosure.js` for Current UI regression if applicable. Token/layout checks plus focused all-theme/minimum-width review. Group GPU checks once with W4 if developed together. |
| W6: delivery qualification | Verify CPU and GPU preview/Library/delivery against the same native selected source at Strength 0/intermediate/1, both renditions, linked SDR, crop/rotation, resize/sharpen, Film, masks/Retouch and supported lens corrections. Fix failures before considering built. | **Still strict:** run every existing check covering changed Proof/export/source behaviour, including `test_proof_export_identity.py`, `test_preview_export_compare.py`, `test_export_denoise_parity.py`, affected batch/project/ceiling Python checks, and focused GPU delivery checks `gpu-delivery-ceiling.js` and `hdr-ceiling-delivery.js` with AI fixtures. Add full Proof/export comparison cases to the AI driver; existing Current-Denoise tests alone do not cover upstream AI. Check decoded delivered output and exact pre-encode cap; preserve tighter pins. Plan runtime first: if slow validation exceeds about 30 minutes, stop and ask with its estimate. “Experimental” does not waive delivery tests. |
| W7: cross-platform packaged completion | Collect native ORT/model resources, Flatpak offline manifests, package self-test, clean-machine loading and user-facing failure paths. Update built state only once code is committed and relevant checks pass. | Fast packaging inventory/dependency tests; tiny actual-model production smoke on all Desktop release workflow targets including installed Flatpak, with no optional skip. At a release point use `test:release -- --plan` then focused release check on committed files; main workflow green on every platform before tag. No full sweep/endurance unless Steve requests it. |

Register every new Electron/native driver in `tests/release/drivers.json`
with area, tier and launch method; update path-to-area mapping for AI source
work (import/preview/Library/export-Proof). Record uncovered real DNG/highlight
combinations as disabled support, not a pass. Known unrelated failures get
one-line records and are left alone; change no agreed limit to make AI pass.

## 8. Risks and exit conditions

- **Image changes are real.** Experimental labelling and Steve's approval
  replace the replacement-quality ambition, not factual quality reports.
  Native 100% review of text, repeated fabric, fine edges/stars and deep
  shadows remains necessary; no promise that AI reconstructs true detail.
- **Wrong source is the largest integration risk.** A camera JPEG, stale
  finished cache or ordinary GPU AHD can look plausible while export uses
  AI. Test identities, readiness labels and finished pixels across every
  consumer; refuse delivery if native AI is unavailable.
- **Highlights/DNG can silently change physics.** Enforce initial eligibility
  and keep mandatory corrections exactly once. Do not opportunistically
  relax unsupported settings to broaden the checkbox's availability.
- **Memory may block large files.** ORT arenas, old source readers, mapped
  pages, two lanes and delivery coexist. First real Mac measurements may
  require smaller bounded storage or a revised estimate, not a larger app
  budget. No support claim for 61 MP until it works on the minimum machine.
- **Cache is substantial.** 32 GB is a proposed new disk cost, not approved
  by choosing the model. LRU misses on large batches reduce the benefit;
  copying projects to the other machine does not copy the cache.
- **Packaging/licensing can block a target.** An importable development wheel
  does not prove frozen DLL/ELF loading or weight redistribution. All four
  packaged self-tests and notices/source material are release blockers.
- **Experimental updates change saved looks.** Save provenance, invalidate
  caches and require review acknowledgement. Do not imply the old version's
  renderer remains available or silently export an updated result.

Ready for Steve's long-term testing means: supported RAWs can select AI,
Strength is live after preparation, all edited/delivered paths agree within
their existing tolerances, unsupported states explain why, source files
stay unchanged, memory and disk are admitted/bounded, and the installed
offline app passes its actual-model smoke on every supported platform.
The narrow initial restrictions and remaining quality defects must appear
in the user guide/release notes; broader source support stays open work.

## 9. Decisions for Steve

Shipping standalone RawNIND as Experimental is already decided. These are
the remaining design choices; recommendations are not implementation approval.

1. **D1 — One method at a time, AI shared by HDR and SDR.** Recommend AI
   bypasses current Denoise while preserving its settings. Trade-off: no
   extra classical cleanup on top, and AI cannot differ between renditions.
   What could break: unnoticed stacking would soften the selected result;
   lane-only AI would make the two views disagree about their source.
2. **D2 — Off by default; 100% on first enable.** Recommend no automatic AI
   on import, with live 0–100% blending after preparation. Trade-off: manual
   selection/wait per chosen photo, and reducing Strength restores noise
   along with normal detail. What could break: auto-on would change existing
   photos and make ordinary browsing unexpectedly slow.
3. **D3 — Superseded by section 0: highlight reconstruction must work with
   AI from the start.** (Original proposal: start with ordinary Bayer RAW and simple Bayer DNG, with Highlight
   reconstruction off.) Recommend explicitly disabling unsupported DNG
   corrections and highlight combinations until separately qualified.
   Trade-off: because highlight reconstruction defaults on, Steve must turn
   it off to try AI; some Bayer DNGs remain unavailable. What could break:
   feeding repaired sensor values through the model's clipping, or skipping
   DNG operations, can change bright colours, lens geometry or exposure.
4. **D4 — Allow a 32 GB local AI cache, including scratch.** Recommend native
   lossless AI results, selected-only AHD, existing RAM shares and global
   eviction. Trade-off: disk use buys repeated Proof/export without ML;
   45 large 61 MP photos will not all fit. What could break: a smaller/full
   cache causes recomputation; a cache treated as archival storage could
   lose an old experimental look when cleared or updated.
5. **D5 — Approve admitted AI preparation above the old 100 MB extra-import
   allowance, while retaining existing total memory limits.** Recommend one
   bounded AI worker initially, measured reservation with 25% headroom,
   24 MP CPU whole-wait target <=45 s, live Strength p95 <=50 ms and the
   other proposed tolerances in section 5. Trade-off: preparation can take
   tens of seconds or wait for memory. What could break: simultaneous jobs
   or uncounted ORT/mapped memory can exhaust the 8 GB Mac; larger photos
   may need bounded-work improvements before being supported.
6. **D6 — Bundle one CPU runtime/model on every platform.** Recommend ORT
   1.32.0 FP32 CPU initially, fully offline, with <=150 MB added compressed
   installer size. Trade-off: larger download and slower first preparation
   than hoped-for acceleration. What could break: FP16 GPU/ANE can overflow;
   missing native libraries/model resources can disable AI in a package
   that otherwise starts correctly. All-platform packaged smoke must pass.
7. **D7 — Warn and require review when an update changes AI development.**
   Recommend storing model/revision provenance, using the installed version
   without old-model compatibility, and acknowledging the changed result
   before delivery. Trade-off: an update may require reviewing prior AI
   photos, and exact old appearance requires retained exported files.
   What could break: silently reinterpreting an experimental saved recipe
   could deliver changed texture/colour without Steve noticing.

## Design-task verification

Read-only Git/source/document inspection and PyPI wheel metadata only; no
model download, installation, inference, app edit, GPU run or new timing
measurement. Validate this document's local links and whitespace and the
AGENTS documentation-map entry before committing. The build/test plan above
is prospective: this design-only commit does not claim a runtime, visual,
performance or export/Proof test pass.
