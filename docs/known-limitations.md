# Known Limitations and Support Status

## November 14: encoding allowance follow-up

Steve's November 14 decision replaces the October 18–19 ceiling policy and
the earlier zero-allowance interpretation. Every Highlight Compression HDR
export and reduced/full-size Proof is decoded, CPU and GPU. Initial peaks up
to target + 1% are accepted unchanged, without a note. Larger overshoots use
the existing local correction toward the target; only after all rounds may
the allowance be used again. Files still above it are refused without replacing
the destination. Highlights-off optional strict codec checking is unchanged.
Library pictures are not checked after encoding.

**Mac validation completed on the commit containing this record**, following
implementation `7d41e7a7` and the pause/resume WIP `46b84c38`:

- Read-only IMG_0114.CR2 and DSC00264.ARW real-photo CPU fixtures cover all
  three HDR codecs and both Proof sizes. Corrected peaks are
  **971.983–999.368 nits against 1000** across those fixtures and the real-app
  checks. Initial files up to **1007.448 nits** stay unchanged within the
  allowance. No real file is refused; existing correction margins are retained.
- The real-app matrix passes all six codec/renderer pairs (JPEG, AVIF,
  JPEG XL; GPU and CPU), with 800px reduced and 1600px full-size Proof.
  Its 18 finished-file readings are 989.558–1007.448 nits. Every full-size
  Proof is byte-identical to its export. The checkbox is off throughout,
  proving active Highlight Compression remains mandatory.
- The six-case reduced JPEG Proof matrix passes (977.461–994.067 nits).
  GPU/CPU delivery smoke, watermarked Proof identity, framing and Proof-size
  interaction also pass. The smoke's pre-existing stricter HDR p99.9 miss
  remains 3.377 against 3; its agreed Denoise p99 criterion passes.
- Native DSC00264 (7968×5320) could not obtain the GPU host reservation:
  estimated 3.41 GiB additional working memory, safely available 0.00 GiB.
  One GPU attempt fell back to the CPU and exported successfully (69.35 s
  backend total), then the driver failed its GPU-renderer assertion.
  Native 42MP GPU delivery is therefore **not qualified** on this run.
  The all-codec GPU checks and timing use 1600px linear-ACEScg EXRs prepared
  from the real photos before import. The portable driver prepares that
  bounded fixture by default; `--native-source` retains the original for
  a separate diagnostic. No memory budget, shader or encoder was changed.
- Same-Mac, same-file paired GPU export measurements: about **0.48 s extra**
  when checking without correction; **2.09–3.53 s extra** when correction
  needs three/four encode-and-decode rounds. These are warm 1600px JPEG
  quality-90 exports, excluding source preparation/import. The dim unchecked
  control varies more than the agreed 5% noise allowance (0.384–0.434 s),
  so its added cost is approximate (0.44–0.53 s). No timing rerun was made;
  Steve should try exports before further timing work. Native RAW and larger
  output costs are not established by this bounded measurement.

Node passes: 951 tests, one skipped. The resumed focused Python ceiling/parity
selection passes all 62 cases. The earlier full-suite attempts total 3,331
passes, 145 skips and one xpass, with two unchanged Library failures and one
stalled test; the full Python suite is **not** a pass:
`test_library_gpu_raw.py::test_native_chunk_owner_admits_before_allocation_and_survives_trim`,
`test_library_gpu_raw.py::test_abandoned_native_upload_releases_owner_without_expiring_replacement`
(native upload admission returns false), and
`test_library_live.py::test_xtrans_api_reuses_measured_cpu_grant_and_existing_cancellable_helper[False]`
(API wait; ten-minute stack, stopped after 12.5 minutes). The remaining
1,356 tests passed separately. These Library files/checks were not repaired.

The resumed 90-second Library smoke remains unqualified: six of 33 pictures,
1.2 s first picture, system-reserve memory failure. This is left to the
Library/memory follow-up, without a rerun or changed limit. Older fixture
blocks and unqualified native/Windows checks below remain open; this is not
full release qualification. All checks were serialized through the shared
GPU lock at 1408×794 points. The three protected project hashes are unchanged.
No curated HDR Test Images path broke or needed retargeting in these runs.

Compact evidence and logs: `codebase/output/ceiling-followup/` (delivery,
cost, parity, CPU matrix, fast-suite logs); Library report:
`codebase/output/quick-library-check/ceiling-followup/report.json`.
Generated EXRs, exports, decoded copies and temporary profiles are removed.
Scratch output started at 6.3 GB and ended at 6.5 GB, below 100 GB. No push, merge into
main, installer build, or new HDR-policy decision is needed here. Windows GPU
qualification and the separate Library/memory failures remain open.

The following earlier report is historical; its zero-allowance statement is
superseded by the rule above.

## November 14: Mac encoded HDR ceiling and GPU delivery

Baseline investigation confirms that the 1038–1437-nit parity readings are
real encoded reduced Proof files against a 1000-nit target. The diagnostic
previously excused reduced Proof overshoots. Default synthetic JPEG and
JPEG XL export can overshoot too; this is not only a diagnostic error.

Enabled Highlight Compression now always checks the decoded brightest
BT.2020 channel and uses the existing local correction. Uncorrectable files
are rejected without replacing the destination. The diagnostic uses the
same exact ceiling at both scales, without its old 1% + 1-nit allowance.
No shader, budget, codec formula or tolerance is relaxed. Already-compliant
files and SDR pixels are unchanged; correcting an actual PC-path violation
is intentional under this brief. Windows hardware checks remain pending.

The Mac's GPU worker works on the unchanged base and final code. A broker
regression establishes a startup race: a request before the worker heartbeat
could cache CPU-only delivery indefinitely for unchanged settings. That
pre-submission unavailability is no longer cached. Actual failed GPU jobs
still fall back once and are not retried. The previously reported smoke
failure is not evidence of unsupported Mac hardware; it did not reproduce
in the unchanged-base real-app smoke. The existing stricter HDR perceptual
p99.9 miss (3.377 against 3) does reproduce and is unchanged.

Final code `9bfea9e5`: Node 951 passed / one skipped; Python 3,323 passed /
145 skipped / one xpassed. All 22 non-helper export/Proof catalog entries
were attempted, plus local HSL: 23 invocations, 12 passed, eight failed or
fixture-blocked, three stopped/time-limited. Every non-pass has an
unchanged-base attempt with the same failure or bounded non-completion.
The five catalog helpers are covered only through their parent drivers; an
incomplete parent does not qualify its helpers. The protected project
hashes are unchanged.

Ceiling results: six reduced JPEG Proof cases are 977.461–994.067 nits,
zero above 1000. Full-size real-RAW HSL GPU/CPU deliveries and full-size
Proof identity pass (neutral/global/local decoded peaks 941.168–987.561
nits); HSL integration passes at 989.669 nits. Real JPEG, AVIF and JPEG XL
unit regressions cover default-option enforcement, reduced/full-size Proof,
unchanged compliant bytes and refusal to replace a destination with an
uncorrectable file. No sampled final delivered file exceeds its target.

Unchanged-base blockers/non-passes (not repaired in this task):
- `gpu-delivery-ceiling.js` and `gpu-delivery-repeat.js` lack
  `output/test-photos/saved-grades/DSC07060.ARW.hdrf` on both trees.
- `proof_export_identity.py` and `proof-grade-diagnostic.js` cannot resolve
  the protected project's stored Windows source path on this Mac. The
  project and its source were not rewritten.
- `retouch-delivery.js` expects GPU Retouch but receives CPU; the Tone Zones
  and Color/Desat delivery drivers fail their hidden-renderer assertion.
  The same failures occur before the fix. The actual GPU/CPU delivery smoke,
  HSL and framing checks do work on this Mac.
- `batch-export-ui.js` times out waiting for `#bounded-help-tooltip` on both
  trees, before delivery qualification.
- `gpu-denoise-measurement.js` lacks
  `local-test-media/inputs/Affinity_DSC06898_DisplayP3_Linear_32f.exr` on both
  trees and hangs after reporting that error. Final run interrupted; base
  run bounded after reproducing the same error. Neither is a pass.
- `preview-export-compare.js` does not finish within the same 86-second
  cap on base or final. `edge-colour-raw.js` does not finish within the
  remaining 52–54-second caps. These are incomplete checks, not established
  output regressions. Longer follow-up requires Steve's approval under the
  overnight slow-test allowance; nothing was relaxed.

The default locked 90-second Library smoke shows 6/33 photos and a 399 ms
frame gap against 250 ms; it is not accepted. No sustained memory violation
is reported. Incomplete mixed-folder coverage already exists in the Mac
baseline notes; the new gap was not investigated or re-run. Steve should try
Library before more timing work.

Decisions for Steve: transfer the two named private fixtures, approve a
separate read-only fixture/source-path repair and longer incomplete checks,
then run Windows export/Proof qualification. Safest overnight choice was to
leave unrelated routes, protected projects and limits alone. Logs, base
comparisons and compact ceiling evidence:
`codebase/output/mac-export/validation-summary.json` and adjacent logs.
Scratch output began at 6.1 GB and ends at 6.3 GB, below the 100 GB limit.
Float readbacks, redundant captures, base archives and finished disposable
Electron profiles were removed; compact logs/JSON and reduced encoded Proof
files remain. Shared source photos and protected projects were not changed.
## November 14: HSL Mac picker and 100% selection

An armed HSL picker can intercept controls underneath the offscreen part of
the zoomed photograph. Reproduced against both plain-base and P1-B picker
code and native app; 2x normalized coordinates and returned-colour application
themselves work. Input is now scoped to the visible main preview. Native
before/after checks cover plain and exact Steve-stacked DSC00264 grades,
both renditions, and real on-photo picks. Global Show selection now uses a
visible-area CPU crop with the full selection halo and lossless fast PNG;
decoded cropped overlay pixels equal the original whole-frame coverage.
All warm Fit/100% cases meet the existing <1 s bar on the MacBook Neo.
Remaining limits: the first plain HDR Fit show is about 1.6 s; first SDR
100% shows can exceed 1 s, and upstream SDR stage work still costs about
half a second. These are not claimed fixed by the warm selection change.
Export, Proof, selection maths, image tolerances and memory limits are unchanged.

Final validation: Node 966 pass / one skip; Python 3,354 pass / 145 skip /
one expected failure now passing. Native HSL selection-engine GPU/CPU agreement
and real-RAW overlay/pan/zoom/cleanup checks pass. The required plain-Electron
90 s Library check still fails separately: 6/33 eligible pictures and the
system-reserve memory flag. It was not investigated or rerun for this HSL
change; `codebase/output/quick-library-check/hsl-mac/report.json` records it.

## November 14: Mac GPU parity follow-up
## November 14: Mac preview parity (closed with fixed drift guards)

Steve, 2026-11-14: the measured invisible lens/Velvia byte-mean misses now use
fixed, narrow perceptual caps, shared by PC and Mac. Rendering, shaders,
Proof/export and the HDR ceiling are unchanged.

| Check / editing lane | Cases | Worst mean ΔE | Worst p99.9 ΔE | New mean cap | New p99.9 cap |
| --- | --- | --- | --- | --- | --- |
| Lens: HDR editing lane | 28 | 0.155865 | 1.134869 | 0.161 | 1.155 |
| Lens: SDR editing lane | 32 | 0.242057 | 1.181764 | 0.248 | 1.202 |
| Velvia physical chain: SDR | 1 | 0.119114 | 1.044660 | 0.125 | 1.065 |

Three MacBook Neo / A18 Pro native-Metal measurements per affected case give
zero observed spread in mean or p99.9. Lens uses independent processes;
Velvia repeats in one process and then passes a fresh-process final check. The full lens baseline is
68 strict passes / 60 byte-mean misses; only those 60 and the SDR Velvia
physical chain receive exceptions. The eight quick cases are a subset of
those 60. HDR Velvia and all 68 strictly passing lens cases remain strict;
the two-level byte p99.9 and complete-frame/dimension checks remain strict.
Each cap is the three-repeat worst + 0.005 mean / + 0.020 p99.9, rounded up
to 0.001, not the general 1/3 criterion. Failure messages identify the case,
metric and excess. Numeric caps and the exact exception set have regression
checks; a new failing case cannot opt itself in.

Both editing lanes in these drivers are **SDR presentations**, so the correct
metric is ΔE 2000. This does not qualify actual HDR pixels or relax ΔE ITP,
Proof/export agreement, the highlight ceiling, the separate HDR Neutral known
failure, or diagnostic-only Velvia variants. PC confirmation remains in
AGENTS.md. Detailed measurements and the decision are in the Film Look and
Preview/GPU module PRDs; compact evidence is in
`codebase/output/parity-limits/`.

The earlier tiled-scope submission-count harness correction remains fixed;
Film-panel keyboard failure remains unreproduced. Fast suites pass: Node 957 passed /
one skipped; Python 3,313 passed / 145 skipped / one xpassed. The initial concurrent
Python run hit 11 Library memory-admission failures; the quiet full rerun passes
without test or budget changes. Final live lens quick set passes 8/8 and Velvia passes
2/2. All 254 saved calibration comparisons pass a replay through the fixed gates (not
a new full render). The default 90-second Library smoke remains incomplete (6/33
photos), with a system-reserve warning; this separate Library limitation was not
investigated or rerun. No curated-photo path needed retargeting.
**Decisions for Steve:** authorize the already agreed perceptual criterion
for these perceptually small lens/Velvia byte-gate misses, or leave them open for
separately qualified preview-only precision work. Safest overnight option:
keep the strict failures and all delivery/PC pixels unchanged. Current PC
reruns of lens quick/full, the scope fallback and panel helper are still
needed; the registered extreme HDR Neutral film failure is a separate case.
Details and local evidence are in the Film Look and Preview/GPU module PRDs.
Fast validation passes: JavaScript 951 passed / one skipped; Python 3,311
passed / 145 skipped / one expected failure now passing. All five focused
film/lens native-encoder Proof/export identity cases pass without skips.
The default plain-Electron Library smoke still fails on incomplete coverage:
six of 33 pictures after 90 seconds, consistent with the existing Mac stall;
no memory or responsiveness-limit violation. Not investigated or rerun here.
## November 14: P1-B strict Mac validation

No P1-B-specific output regression was found against `87b91385`; full direct
lens/stock failure metrics and all six export-diagnostic encoded-file hashes
match base. Existing failures remain failures: two stock cases, 60/128 direct
lens cases, 8/8 quick-lens cases, Film panel keyboard fold, tiled admission/
CPU-scope atomicity, and delivery-smoke worker startup. The non-gating
`performance/export-parity.js` diagnostic records proof-scale peaks of
1038–1437 nits for a 1000-nit target on both branches; a zero driver exit is
not ceiling qualification. Full-size real-RAW HSL GPU/CPU delivery, exact Proof
bytes and ceilings pass. Two original EXRs and the original DSC07060 saved
grade are missing on this Mac; supplemental synthetic Film/halation tests do
not qualify those originals. No tolerance or production shader was changed.
The [Film Look PRD](product/modules/film-look.md) lists every covering driver,
base verdict, exact missing filename and retained evidence. Final Film is
still below 20 fps; Print and HSL timings moved outside 10%, with one warm
100% Show selection at 1.079 s. Steve should try them before further timing
runs. This is relative regression evidence, not unconditional merge/release
or minimum-machine speed acceptance.
The default 90-second quick Library check also fails identically on coverage
(6/33 pictured on branch and base; no memory violation). Fast suites pass:
958 Node tests (one skip), 3314 Python tests (145 skips, one existing xpass).

## November 13: POSIX cache-location fallback (reported; unchanged)

The standalone Python backend falls back to its runtime directory when
`HDR_FINISHER_APP_DATA_DIR` and `LOCALAPPDATA` are absent. Library's default
cache then adds `HDR Finisher/Cache` beneath that profile on POSIX, including
Electron profiles without the `test-` isolation marker. Desktop passes its
user-data profile explicitly, so it avoids a repository-relative database;
the extra cache subfolder still differs from the native macOS convention.
This tooling task isolates pytest before collection and does not move any real
app cache or change allowances. Choosing a new app cache location remains
Steve's decision in the memory-and-caches module.

## November 13: minimum-hardware Mac validation

macOS available-memory detection and deterministic DNG refusal loops are fixed;
no allowance or output tolerance changed. The 90-second MacBook mixed Library
check shows 2/33 photos, blocked before development by the real system reserve
(about 2.0–2.5 GB available, protecting 2 GB). This is not 8 GB feature/speed
acceptance. [Memory and caches](product/modules/memory-and-caches.md) records
headroom, evidence, test results and the next decision.
The earlier SDR Velvia byte-gate miss is closed by the fixed November 14
caps above. The historical diagnostic and isolation remain in
[Film Look](product/modules/film-look.md); no shader was changed.


## November 12: watermark and Library polish validation

Fast validation: Node 923 passed; full Python run 3,327 passed, 3 skipped,
two failures. The intended Proof schema field-order change was then added to
the contract test (including watermark cache identity/conversion), and the
affected model/watermark suites pass: 13 tests. The remaining unrelated failure
is `test_library_worker.py::test_identified_bad_decoder_is_not_replayed_and_next_file_recovers[HANG]`
(recovery timeout, previously documented). Focused fullscreen/Single: 16 passed.
No frontend build step exists; changed JavaScript syntax and git diff checks pass.
Output starts and ends at 45.9 GB.

Text watermarks are delivery-only: Export and encoded Proof, not Grade or
Library pictures. Rendition-test mode is verified by decoding real Ultra HDR
JPEG and AVIF files and classifying their different HDR/SDR labels. Full-size
Proof matches those exports byte for byte. The GPU delivery smoke also checks
watermarked GPU and CPU exports against their own full-size Proof bytes;
both pass. The existing HDR delivery p99.9 miss remains 3.377 against 3;
SDR and Denoise acceptance pass. No tolerance was relaxed.

The framing delivery driver passes GPU/CPU, all six formats, Proof, Library
and decoded ceilings. The batch UI driver passes new watermark version
round-trip and all four theme outline contrast checks (minimum 11.62:1), then
times out at its existing bounded-help-tooltip visibility step; the complete
batch UI driver is not claimed as passing.

The 90-second plain Electron Library check reports no application errors,
failed photos or memory violations, but fails responsiveness with a 649 ms
frame gap and 670 ms main-thread block. It ran concurrently with the full
Python suite; no isolated speed comparison or regression conclusion is made.
Logs are `codebase/output/watermark-*.log`; the smoke report is in
`codebase/output/quick-library-check/watermark-library-polish/report.json`.

Steve still needs to inspect layout at his usual window size, native fullscreen
return, and actual viewer/display behavior. Use full gain map and 100% opacity:
full HDR headroom should show HDR, ignored/stripped map should show SDR, and
partial headroom can blend the labels. An HDR label after tone mapping is not
proof that the display is presenting HDR. No physical-viewer qualification or
packaged installer build was performed.


This page prevents implemented, validated, expected, and planned behavior from being conflated. Platform and distribution status reflects **September 4, 2026**; the Denoise and preview notes below were refreshed on **October 5, 2026** against the viewport-preview PRD and baseline. Editing scope, export rendering, packaging and planned work were refreshed on **October 22, 2026** against the master PRD.

## Platform matrix

| Capability | Windows | macOS | Linux x86_64 |
|---|---|---|---|
| Run from source | Validated | Expected; dependency/browser validation incomplete | Validated in Kubuntu SDR/degraded mode; physical HDR pending |
| Technical package | Validated PyInstaller folder build | Implemented Apple Silicon package | `.deb` validated locally; Flatpak manifest/CI path implemented |
| Signed/store distribution | Unavailable | Unavailable | Flathub submission pending physical qualification |
| Native file picker | Implemented | Implemented | Implemented; Flatpak uses XDG portals |
| Native display metadata | Validated QueryDisplayConfig/DXGI | Unavailable | Electron label/color-space/depth only; no peak nits |
| Chromium UI automation | Validated | Not maintained | Implemented headless/X11 degradation path |
| Physical HDR browser checks | Maintained Windows evidence | Not maintained | Required on Kubuntu 26.04; not yet recorded |
| Auto proof target | Uses Windows telemetry when available | Use fixed target | Use fixed/custom target; exact headroom unavailable |

## Library thumbnail cache qualification (October 17–18, 2026)

October 18: camera RAW grid/filmstrip misses now extract the embedded camera
JPEG without a full RAW read, then replace it with the real scene picture.
Native gain-map hits still bypass the placeholder. The displayed GPU lane
is read back from its finished texture; the other lane is rendered on the
GPU from the same source, after visible draws and only while Grade/export
allow background work. The Library-only JPEG writer packages those pixels
at the fixed 640-pixel size. It does not re-open or CPU-grade a camera RAW.
Saved-grade pictures retain their existing finished-picture path. Uploads
reject changed source/grade identities and cache preferences. Export, Proof,
Single, Compare, native zoom, pinned shaders and timing limits are unchanged.

Qualification: 532 Node tests and 2261 Python tests passed (three skips),
including a camera-first/no-full-read/cache-hit behavior test; the focused
Stage C GPU check passed. A real ARW copied into a disposable one-photo
folder showed its camera preview in 60 ms, saved its GPU-produced real
thumbnail, and showed that cached thumbnail in 24 ms after an actual app
relaunch, without another camera preview or RAW decode. These are one-photo
checks, not a qualification of the full-folder targets or a cold OS disk.

October 19: saved-grade thumbnail encoding no longer yields to unrelated
Library source decoding; it still respects the Grade/import/export pause.
The app contention check produced its saved thumbnail in 1.11 s while a slow
DNG request remained active. The HDR Test Images visible-screen check still
failed to finish all persistent thumbnails within 60 s; DNG source decoding
remains on the existing CPU fallback. This is not full-folder qualification.

Remaining: the badminton folder at default size has 70 visible photos.
The visible-screen check did not finish filling their persistent thumbnails
within 60 seconds; only 68 first pictures and 45 real-picture events were
recorded (first-picture p90 3.66 s; real-picture p90 21.24 s). The full scroll check also timed out
waiting for cache warming, with a RAW transport released before a GPU draw.
The 1 s first-picture / 2 s real-picture / 100 ms cached-folder targets have
not been qualified for that folder. The scene reader still reads entire
82 MB RAWs, so its HDD throughput, first shader compilation and saved-grade
work remain costs. No timing budget was relaxed. Full-folder cache filling
and reliable handoff from RAW transport to GPU draws need follow-up.

Earlier October 17 qualification (CPU cache producer, before this change):

Grid and filmstrip use native gain-map JPEG thumbnails; Single, Compare and
full-screen keep their scene-linear GPU path. Separate thumbnail, full-size
and saved-grade allowances default to 2, 10 and 2 GB, with LRU eviction only
inside each allowance. The default cache is under LocalAppData; old Roaming
caches are left untouched, with no migration.

This work is not fully qualified. Native HDR display, GPU colour agreement,
independent cache Settings, and the disk-cache revisit passed their focused
checks. On a miss, the scene picture is GPU-drawn before requesting a gain-map
file. CPU file creation uses one background worker, yields between stages to
visible work, and pauses for Grade/export. It never holds a scene-cache lock
while yielding. GPU readback for file creation was not yet implemented in
that October 17 version; the October 18 path above supersedes it.
Steve agreed to measure first visits against the same scroll driver on
pre-cache `ef4326c`, plus 15% noise, rather than Claude's post-first-screen
clock. The unchanged driver measured 925 ms median / 7478 ms p90 on that
revision (80 cells, disposable profile, 2560x1440); an external observer
captured the cold result before the old app's missing thumbnail-pool API
stopped the driver. Cold limits are 1063.75 ms / 8599.7 ms. The current run
measured 1064 ms / 7232 ms: p90 passed, median missed by 0.25 ms. No timing
rerun was made. First-draw shader compilation, source decoding and saved-grade
remakes remain visible costs.

With every gain-map file explicitly warmed, both revisit passes made zero
scene-picture or pixel requests: p90 was 2 ms on both, maxima 2 / 214 ms,
within the unchanged 100 / 300 ms limits. Cache hits need no scene pictures:
captions use photo metadata and overlays request their own maps. Claude's
third pass still used scene fallbacks (99 picture requests / 60 pixel fetches),
so it was not equivalent to this explicit cache warm-up. The recent pool
stays under 256 MiB. Export and Proof paths were not changed.

## Input limitations

- Supported manual source spaces are limited to linear sRGB/Rec.709, linear Display P3, linear Rec.2020, and ACEScg, plus PQ/HLG/sRGB transfer choices.
- ProPhoto/ROMM, Affinity wsRGB, ACES2065-1 manual selection, arbitrary ICC RGB spaces, log camera encodings, and custom OCIO spaces are not safe general inputs.
- EXR chromaticities are optional; ambiguous files require user knowledge.
- Multilayer EXR beauty-pass selection is not a general user feature.
- Resolved imports share a fixed negative-only ACEScg neutral-axis projection after colour conversion and RAW lens correction, before analysis and source mip creation. Finite nonnegative pixels pass through bit-for-bit; signed pixels move toward their maximum-channel neutral until the minimum reaches zero, and pixels with no positive channel become black. Ambiguous EXR/TIFF primaries retain signed samples until interpretation is resolved. This replaces import-time negative hard clips; denoise and grading can still create negatives and final delivery retains its output limits. Qualification on DSC00099 removed the strong 768-pixel teal hub fringe. Steve accepted its six measured, invisible 200% dark red-wall discrepancies as a deviation of `0929c8f` (preview PRD 15.7, CF-PIX-09); limits and tolerances are unchanged. CPU geometry also creates 326 entirely negative pixels at full size on this photo, which export turns black, invisible here. The separate pre-existing baseline tone-limit failure remains. Full qualification of the import change is still pending. CPU export denoises before geometry and GPU preview after it; the measured effect is invisible so far. CF-DENOISE-ORDER-01 requires Steve to judge a noisy photo with Straighten applied by eye before any work is scheduled; no direction is proposed. The source cache version changed, so affected saved RAW/EXR projects rebuild their source levels and may render differently (October 8, 2026).
- HLG decoding assumes a 1,000-nit system peak.
- TIFF acceptance depends on supported layouts/compression/codecs; unusual channel organizations may fail.
- Apple HDR HEIC support targets the implemented auxiliary-gain metadata path, not every vendor HEIF HDR scheme.
- Experimental DNG Import supports a constrained metadata/layout/opcode envelope, not every valid DNG. Producer-reference comparisons are in progress and macOS resource validation remains open; current successful decodes are not yet color/geometry/DJI compatibility sign-off.

## Editing limitations

HDR Finisher is a photo editor with RAW development, but it has no layers or compositing:

- RAW development uses one generic method for every camera, with no per-camera profiles. Ordinary supported Bayer and X-Trans RGB RAWs use a camera-linear float bridge with a versioned, bypassable NumPy opposed-color highlight reconstruction stage before AHD. The method repairs channel-clipped color from spatially supported opposing CFA channels but does not invent texture in fully clipped areas. Complicated colored lighting can retain pink/green boundaries, and heavily clipped X-Trans speculars can retain blue residuals that become visible only when HDR exposure is lowered; threshold changes require source re-development. Unsupported sensor/color metadata is identified in the Metadata panel as a legacy compatibility fallback. Experimental DNG Import adds metadata-driven LinearRaw decoding and audited OpcodeList3 GainMap/WarpRectilinear handling. The RAW route does not add segmentation/guided-laplacian reconstruction, hot-pixel repair or creative camera profiles; Denoise and sharpening are applied in Grade.
- Local adjustment masks support brush, gradient, path, luminance-range, and Boolean combinations. Hue selection is not available yet; it is planned for 1.0. AI or object-aware selection is out of scope.
- No layers or compositing.
- Crop/transform, Lensfun correction and Denoise are available. There is no retouching brush yet; a Retouch brush (Inpaint, Heal and Clone) is planned for 1.0. Denoise has one method, which measures the noise in the photo (the earlier wavelet method was removed on October 6, 2026; a project saved with it opens with the current method); cold enabling while panned on the saved 42 MP photo can show too few frames during a drag (PRD 15.3 / CF-SPEED-05).
- Batch export is available from the Export page and the Library. There is no scripting or automation interface.
- Undo/history and saved projects are available, but projects reference the original source rather than embedding its pixels.
- Group presets and Film Looks can be saved and applied. The presets window cannot yet rename, edit, import or export presets, and a Library browser for Looks is deferred until after 1.0.
- Saved projects and presets are not migrated between versions before 1.0; ones that use a removed setting must be recreated.

Importing, opening a project, ejecting, and closing prompt to save or discard unsaved adjustment state.

## Steve's testing feedback (October 16, 2026)

- Settled editing scopes always request the additional bounded peak measurement on GPU and CPU preview. Interactive updates keep the fast preview reading. If the bounded measurement is unavailable, the scope explicitly says Peak (preview). A scope waiting for its matching GPU frame retries after it arrives. Export and Proof measurement are unchanged.
- Save As previously had no in-app recent-project list; Library and the initial Library screen list photos, not project files. Steve chose Recent projects. File and the header now expose the last ten successfully opened or saved projects, stored in the desktop profile. Existing projects enter the list when next opened; this includes Steve's previously saved project. Browser mode stores its history locally. Missing files report an error and keep the current project open.
- Project opening now pauses and drains Library grade polling before replacing the backend session. This fixes the reproduced old-photo 404. Retiring a photo clears its Match/grade-saving messages, and late Match results cannot change the next photo. The delayed-open check passed with a scratch copy of Steve's RAW project; opening did not rewrite the project or create a source sidecar. His original project and RAW hashes were unchanged.
- **Crop follow-up: medium-sized, deferred.** The source pixels and source-relative crop are retained, but reopening Crop currently frames the already-cropped preview and composes another crop inside it. Editing the same crop needs an uncropped editing preview with the saved crop handles restored, then a careful return to the committed preview. Main risks are crop/rotate/perspective coordinate handoff, mask alignment, undo, saved-project reopening, and export/Proof geometry agreement. No crop implementation or export/Proof changes were made in this brief.

The four targeted checks for Claude's logo, Film panel, Navigate and RAW-toggle changes passed independently. The Library filter driver now tests the intentionally restored RAW toggle rather than requiring its absence. UI refinement skipped three missing optional historical reference images. The release check remains stopped at Steve's request; these checks do not constitute release validation.

## Preview limitations

- Reduced GPU source levels now limit Straighten/Perspective bicubic overshoot to nearby source values (October 8). On DSC00099 the shelf LED specks are gone at Fit and 12%, but a small blue/cyan speck remains on the glass sculpture at Fit. Negative ACEScg channels already exist after the full-size camera colour conversion, before lens correction; they are retained rather than globally clipped. Native geometry, CPU export, Proof and colour conversion are unchanged. The inspected production CPU export render at 711 pixels showed no matching LED specks; this is not a general export qualification.
- Perspective uses a bounded GPU draft made by warping one uncropped graded image. Spatial grading and resampling can differ from the final result; Apply rebuilds the authoritative preview at the selected tier. CPU preview is the fallback. Reset saves immediately, and leaving Perspective cancels unapplied changes.
- Editing preview is viewport-bounded, with selectable processing resolutions including Full. CPU preview remains available for an unavailable or lost GPU. The October 5 audits also record CPU picture, mask, scope and whole-source work that is still under investigation (PRD 15.7).
- Native zoom uses source-resolution viewport processing; magnified views below 100% use stepped processing sizes. Preview/export and cross-scale agreement have the specific limitations recorded in PRD 15.1, 15.2 and 15.7.
- Preview, export, Proof and Library pictures render on the GPU with the same shaders, and fall back to the CPU when no usable GPU is available. GPU and CPU results agree within a perceptual tolerance, not pixel for pixel. File encoding itself runs on the CPU.
- Technical Processing and Execution describe the accepted viewer frame; auxiliary renders do not change those route labels (CF-ROUTE-08 fixed October 7).
- Editor exposure overlays omit film grain so random grain excursions do not paint warning speckles. Overlay and CPU scope work share two render slots; superseded/disconnected requests stop at render boundaries. Visible pictures in a detached Library keep loading during a grading gesture. Library source-map jobs already cancel on disconnect and use a separate bounded helper lane.
- Routine scopes analyze the current preview proxy, not every full-source pixel. Tiny source-resolution features can be reduced by proxy downsampling.
- With a 1 GiB preview budget, Full tiled slider overlap can enter the CPU settle branch for superseded/coalesced work, and guaranteed tiled interactive drafts are refused after source preparation. These Phase 4 findings remain open (PRD CF-ROUTE-06/07); warm runs sent no CPU picture request.
- An SDR-compatible representation is not true HDR output.
- Browser/display tone mapping can differ from the authoring canvas.
- Headless automated tests cannot certify emitted luminance.
- Display telemetry is descriptive and may be inaccurate; it is not a meter.
- Linux HDR presentation is qualified only on native Wayland when Chromium reports HDR and the extended `rgba16float` WebGPU canvas is active. X11/Xwayland, SDR output, and CPU/device-loss fallback are explicitly labeled as non-authoritative SDR simulation.
- On the qualified KDE/Wayland NVIDIA path, smooth HDR gradients may show more visible contouring or banding than the same content on Windows or macOS, even when the Technical scope reports a 16-bit-float WebGPU canvas, 10-bit components, and 30-bit screen output. Lowering the tested display from 143.98 Hz to 59.95 Hz did not change the result. This is a live Linux presentation limitation and does not by itself indicate that high-bit-depth exported pixels are banded; verify critical gradients in a high-bit-depth export on the intended delivery platform. Presentation-only dithering is planned as a later polish investigation.
- Crop and Rotate/Straighten are not GPU-accelerated. Their geometry previews still use the backend Python/Pillow warp. Perspective has the bounded GPU draft described above; Apply rebuilds its authoritative preview.

## Color limitations

- Internal ACEScg processing is not a complete ACES color-management system.
- The SDR “ACES” tone mapper is an ACES-inspired curve, not an RRT/ODT.
- SDR gamut compression is a simple luma-preserving move toward the sRGB cube, not a perceptual appearance model.
- Extreme RGB Primaries settings can create physically/output-impossible colors.
- There is no soft proof for a specific ICC display profile.
- There is no user-selectable chromatic adaptation method.
- There is no mastering-display metadata editor.
- For Ultra HDR JPEGs, changing HDR reference white can make HDR Grade and export look different after reopening a saved project: reopening rescales the source, while the in-session white edit does not. This existing behavior remains unchanged; Library uses its existing reopened-picture route when decode white differs.

## Export limitations

- JPEG Ultra HDR depends on a compatible libultrahdr build; availability is capability-gated.
- HDR renditions need not contain pixels above SDR white. JPEG export and saved-grade Library pictures retain their separate HDR and SDR views in that case; the encoder capacity metadata has a minimal positive transition instead of the rejected zero-width range. Existing successful JPEG encodes are unchanged. Failed Library pictures retry on Library use after a 30-second cooldown, without another edit/save; replaced jobs are logged separately (October 12, 2026).
- AVIF gain maps depend on compatible libavif command-line tools.
- JPEG XL HDR is experimental and capability-gated. It is direct Rec.2020/PQ (12-bit integer by default; 10- and 16-bit integer and 16- and 32-bit float are selectable) and has no SDR fallback; third-party files with ambiguous precision or color signaling are rejected or require manual interpretation. On Windows, standard D65 sRGB/P3/BT.2020 JPEG XL colour tags are read through the bundled libjxl metadata helper; other platforms need that helper built. PQ/HLG use declared primaries, including source luminance weights for HLG; this does not establish newer-iPhone Adaptive HDR compatibility.
- Gain-map browser/app support changes outside the project.
- The app validates structural markers and decoder behavior, not formal certification against every clause of ISO 21496-1.
- No built-in publishing client uploads directly to hosting or social platforms.
- Services may destroy adaptive HDR without returning an error.

## Proofing limitations

- Chrome Proof models encoded reconstruction, not a monitor’s physical behavior.
- The proof target is not a hard display clip.
- Local dimming, ABL, ambient light, gamut accuracy, and browser composition policy are not simulated.
- The user-facing proof stage focuses on Chrome/Chromium behavior; it is not a universal browser emulator.
- Evidence records become stale after 180 days by current policy.

## Packaging and operations

- The Windows setup and portable packages are unsigned technical previews; Windows may show an unrecognized-app warning. macOS packages are not notarized.
- Flatpak updates are store-managed; other desktop packages provide a GitHub release check rather than an in-place automatic updater.
- Linux packages are x86_64 only. There are no AppImage or arm64 builds.
- Linux Library original-file rename/move/delete remains unavailable. macOS now supports these commands with checked native Trash receipts and session-local deletion Undo; unavailable or unreliable Trash volumes are refused, never permanently deleted. Whole folders still move only within one volume on Windows and Mac. Native Mac process-crash/cross-volume APFS checks are covered; physical removable/FAT/exFAT, power-loss and packaged-Mac qualification remain open (Library module PRD, November 14).
- Native encoder redistribution may vary by platform and license requirements.
- The desktop sidecar uses authenticated loopback requests and path grants, but it is not designed or hardened for network exposure.
- There is no stable versioned external API guarantee.

## Planned or explicitly deferred

- Planned for 1.0: a Retouch brush (Inpaint, Heal and Clone) and hue selection as a local-adjustment mask
- Wider JPEG XL interoperability and platform acceptance
- Wider automatic source-space/OCIO integration
- Deferred until after 1.0: a Library browser for Looks, linked photos, portable projects, and automation for AI assistants

Planned does not mean promised. Use the product requirements and issue tracker for direction, but use this page and the active code for current capability.

Local design QA retains an unresolved visual contract (CF-DRIFT-02): shared
switch dimensions/border differ from the original guard. Further diagnostic
UI checks also fail; original temporary reference images are unavailable.
See viewport PRD 16.12.

October 6 cleanup validation observed new warm latency target misses
(CF-DRIFT-03), reproduced on confirmation and unattributed to cleanup. Successful
measurement recorder exits do not mean all speed targets passed. See PRD16.17.

The October 6 fifty-local cleanup audit recorded a revision mismatch and two
120-second settle failures (CF-DRIFT-05), and a rotated SDR Denoise 15-second
outlier (CF-DRIFT-04). All of those rows used the legacy wavelet Denoise
method, which has since been removed. An October 7 narrow repeat on the
fifty-local project (SDR only; saved, flip, perspective and both; adaptive
Denoise rows included) completed 1,363 rows with no page error, no settle
timeout and every row on WebGPU, so both items are closed. The HDR lane and
the other geometry states were not repeated. The October 8 full sweep had 13
retained failed guards (seven remain on October 9, below); phase 4 has not met
its green exit. See viewport PRD 15.7 and
16.21 and the final cleanup comparison.

## v0.9 pre-release validation (October 9, 2026)

Revision `53bccfd`: 435 Node, 1,581 Python (three skips), and 22 desktop
unit checks passed. The development Electron sweep completed 149 current
drivers at 2560 x 1440, sequentially: 139 passed and 10 failed. Two removed
Denoise drivers were excluded. Three desktop preview invocations initially
lacked their executable/project environment; all passed with those inputs
supplied. Perspective ownership ran through its explicit main entry point.
All three read-only project hashes remained unchanged.

Seven failures recur from the October 8 morning sweep (`99f2216`) with the
same messages: Black & White parity, scope parity, editing-peak Clarity
reference, local design QA, drag GPU load, luma-feather latency, and
tier-film consistency. Six other guards that failed in that sweep now pass.

Three checks that passed on October 8 failed in the sweep. Follow-up the same
day, at the same application code:

- Path Feather control child order: the test was out of date. `4a83373` made
  the readout typable, which gives it a class name the test expected to be
  blank. The expectation was updated and the test passes.
- Native-region stall (30-second wait for the delayed source-tile response):
  not reproduced; four reruns passed. Intermittent and unexplained. The test
  now prints what was fetched if that wait times out again.
- CPU Full-preview peak currency (120-second timeout): not reproduced; one
  rerun passed. In the failed run the peak readout held 12,000.26 nits from a
  settled scope while the accepted Full picture reported 12,000. Intermittent,
  CPU fallback only, cause not investigated.

The sweep's driver list came from October 8 and so missed tests added on
October 9. Run afterwards and passed: `pan-store-region-identity.js` on both
DSC00264 projects and `view-tools-interaction.js`. Not run:
`performance/source-tile-transfer-probe.js` (measurement only).

No tolerances were changed and no application fix was attempted. With seven
retained failures this is not a green release validation result.

Logs and results: `codebase/output/performance/review/prerelease-0.9-2026-10-09/`.
The sweep did not include coverage audits, long editing endurance, or broad
timing sweeps. No installer was built; packaged v0.9, other platforms, and
physical HDR display validation remain separate release checks.


## Extreme HDR preview range (October 16, 2026)

The preview's earlier shared half-float stages have a finite range of 65,504
scene units, 18.47 stops above HDR reference white (0.18). Extreme uncompressed
HDR grades can clip colour channels and show wrong colours or white patches;
CPU export and Proof remain the reference. This predates Film Look rebuilding.
A disposable-profile run of pre-rebuild main e4274ae, with Film Look disabled,
Exposure +8 and output highlight compression off, on a linear-sRGB hue ramp
peaking at 1,024, reaches 262,144 source units (20.47 stops above white).
The finished preview clips to 65,504: 297,722 channel samples at the ceiling,
no infinity or NaNs. Against unchanged CPU output the displayed difference is
mean 2.936 eight-bit levels, p99.9 255 (ordinary tolerance 0.1 / 2).
Exposure 0 on that same input passes at mean 0.025, p99.9 1.
The inactive source-peak metadata was bounded to its existing model maximum
of 1,000,000 nits for the CPU request; compression remained off.

The new reproducible Film Look trigger is HDR, Neutral, default paper,
Look Strength 100, Push/Pull +2, Print Exposure -3, Print Contrast +100,
Shadow Contrast +100, Highlight Contrast +100, Lab Levels off, Scan 0,
no grain, halation, lens filter or Detail, output highlight compression off.
On the standard peak-16 hue ramp its CPU film-stage peak is approximately
4,848,818 scene units, 24.68 stops above white. Testing the five controls
individually on the same ramp gives peaks 20.16, 126.93, 40.75, 28.40 and
20.66 respectively: none individually reaches the ceiling. Stacking is the
trigger on this fixture; sufficiently bright input can exceed the preview
range independently of Film Look. The uncompressed stacked case exceeds
preview/export tolerance (added mean 3.201, p99.9 250).

Steve directed that a pre-existing failure be recorded rather than extending
precision into shared stages or reducing the new control ranges. Neither is
changed. The already-limited final Neutral storage/anchor fix remains: after
HDR highlight compression its extreme check passes at added mean 0.040,
p99.9 2; the simpler safe cap failed at mean 61.517, p99.9 182. CPU export,
Proof, tolerances and memory/blur ceilings are unchanged. This is a known
extreme-grade limitation, not an ordinary preview parity guarantee.


## Physical lens filter limits (October 16, 2026)

The fixed preview reach shortens long lens-filter tails. CPU export and Proof
use the same bounded model. Before each Gaussian component is renormalized,
the omitted scattered energy at Size 4 on Super 8 is approximately 27.6% for
Glimmerglass, 48.6-58.8% for Black Pro-Mist, 67.2-70.6% for Pro-Mist and
78.1-81.2% for CineBloom (RGB ranges, 6000x4000 source at Fit). These are
Gaussian-surrogate tail estimates, not measured physical filter transmission.
The Film Look rebuild plan records both formats, Size extremes and native/Fit.
No energy is simply added or discarded by the normalized filter, but the widest
glows are tighter than upstream's uncapped shapes.

Automatic Match copies lens type, Strength and Size unchanged. Its existing
quality gate can reject a coloured lens target: the calibrated HDR-match scene
with Black Pro-Mist 1/2, Size 1, plus its tone/local grade, reaches P95 luma
0.056 and OKLab 0.052. It safely refuses the match rather than returning a recipe
outside its existing colour limit of 0.05. No Match tolerance was relaxed.
Saved projects or presets containing removed Bloom fields must be recreated;
no pre-1.0 migration is supplied. Several historical performance drivers still
contain retired recipes and need updating before their next release sweep.


## v0.9.1 pre-release check (October 16, 2026)

**Not ready.** This was the focused check, not the full sweep. The run began at `61ca972`; version/notes preparation was `69768b6`, and the final tested code/test revision was `006247a`. A separate concurrent commit, `fb93f34` (export warning display), landed during the run: later fast checks include it, earlier export checks precede it. This is not certification of one frozen revision.

Fast checks: 497 Node and 2,204 Python passed (three Python skips). Driver totals: 33 passed, 10 failed, 1 shared helper covered indirectly, 28 unfinished at the 75-minute limit. Remaining direct Library unit drivers are credited from the complete Node fast suite; they were not run twice. All three protected project hashes stayed unchanged. No repeated GPU device loss was observed.

No unresolved failure matches the 0.9.0 known list with the same message. No application failure was cleared as flaky. Failures were retried once; repaired drivers were confirmed separately. The stock retry used its supported single-case option after the full matrix isolated the only failure. New check failures below are not all established application bugs.

- `export-file-browser-interaction.js`: **New:** file-browser export leaves Confirm disabled on the disposable fixture; four-format export flow cannot complete.
- `film-stock-parity.js`: **New to the 0.9.0 list, already documented:** extreme uncompressed HDR Neutral maximum paper gain exceeds preview/export agreement (added mean 3.201, p99.9 250); the earlier Extreme HDR preview range section explains the existing ceiling. Full matrix plus targeted confirmation.
- `tiled-film-parity.js`: **New:** Black & White Direct/Tiled frames differ despite the byte-exact guarantee; other film cases passed.
- `performance/tier-film-consistency.js`: **New:** current Pro-Mist/Black Pro-Mist glow contribution ratio is about 1.292 against the unchanged 1.25 limit. The old Bloom failure is a different recipe/message. **Resolved November 8, 2026:** Steve decided to measure the tier difference relative to each filter's glow strength (1.25 limit kept); it passes (see the Film Look module PRD).
- `webgpu-shader-compilation.js`: **New:** Sharpen Amount continuous/monotonic response assertion fails; likely Detail baseline/response area.
- `photo-library-stage-a.js`: **Driver out of date, unresolved:** folder/grid checks progress, but single-view pixel readback still requests a 2D context from the current GPU canvas. This failure does not establish a rendering bug.
- `photo-library-stage-b.js`: **New check failure:** after fixing asynchronous sidecar reads, tag suggestions time out or show Family (0) rather than Family (2). Tag counts/refresh remain unresolved.
- `photo-library-navigation.js`: **Driver out of date:** both Unpin steps pass (November 6, 2026), but the later re-browse waits for thumbnails of 111-byte sample PNGs, which the Library has skipped since its 1 KB minimum photo size (October 30). Needs sample photos of at least 1 KB.
- `photo-library-slice-2.js`: **New check failure:** after fixing the Details container, confirmed tag merge still reads Holiday instead of Sea from disk; background persistence/test synchronization needs follow-up.
- `library-background-activity.js`: **New check failure:** conflict check observes an undone rating changing on disk; writer completion/test synchronization needs follow-up.

Stale drivers were updated individually for removed Bloom, current Film Look controls, the Library start screen/import action, current logo/button results, background settings writes, and the complete Details container. Numerical tolerances, exact-match guarantees and budgets were unchanged. Corrected writer-status and UI appearance checks passed; UI QA had three unavailable historical reference captures, so those optional comparisons were skipped.

Invocation equivalents: the three Film UI helper modules ran through film-stock-parity UI modes; the parameter-layout helper used gpu-param-layout.test.js; Proof used its supported shared browser branch after native startup stalled. electron-initial-load.js is a launcher helper exercised indirectly. These are not standalone green checks of the native launch path.

Also observed: Grade sends library-worker pause reason `grade-control`, which the backend rejects with HTTP 422. No application fix was made by this validation.

Logs, actual commands, attempts, fixture manifests, partial lens results, and the exact remaining commands are in `codebase/output/performance/review/prerelease-0.9.1-2026-10-16/` (`summary.json`, `results.json`, `unfinished.json`). Coverage audits, endurance runs, broad timing sweeps and Library speed trials were not run. No merge, tag, push or installer build was performed.

Unfinished: lens preview/export matrix (122 of 128 cases passed, none failed), exact lens Direct/Tiled matrix, Film Look interaction, and 25 Library drivers. `unfinished.json` contains every remaining driver and command.

Local preparation/driver commits (excluding the separate concurrent change): `006247a`, `96506de`, `1669484`, `db0820b`, `525f538`, `35042dd`, `5518720`, `cdb8b8d`, `6824292`, `44b9cb9`, `8c44e4e`, `230d1f8`, `a94b68d`, `8c61ec5`, `1ad45bc`, `a9366f8`, `69768b6`. The release-check record is committed separately after these.

Release-fix follow-up (October 16, 2026): lens tier consistency still needs Steve's decision. The 1.292 result compares the size of Pro-Mist's Full/4K disagreement with Black Pro-Mist's disagreement, rather than comparing their glow strengths directly. Pro-Mist deliberately has broader, stronger halo/bloom components; its larger disagreement is consistent with the bounded, downsampled lens model described above. No small repair has been isolated that preserves that model and its pinned reach. A difference could show around bright lights and hard edges when changing tier; visibility has not been established by Steve's review. A limit of 1.30 would cover the recorded mean disagreement, but would accept this difference rather than remove it. The agreed 1.25 limit remains unchanged; a model change or a new limit requires Steve's decision.

Release decision (October 16, 2026): Steve released 0.9.1 (application code as at `34e1930`, plus the build fixes below) without rerunning the focused check; the release-check tooling is being rebuilt for 0.9.2. The failures above were fixed after the check and confirmed by their own drivers and the fast checks (export file browser, Black and White tiling, Sharpen response, Library pause reason and the Library drivers), except: lens tier consistency (1.292 against the unchanged 1.25 limit), the Library cold-folder request peak (8 against the unchanged limit of 4), and the extreme uncompressed HDR preview range already described. These ship as known limitations. The unfinished drivers in `unfinished.json` were not run.

Release-runner core validation (October 16, 2026): at frozen revision `c9a696f`, 12 core checks passed and `tests/performance/preview-export-compare.js` failed on both attempts with `peak: false`; paired pixels, tone and masks passed. This is a new check failure, not an established application diagnosis. The tooling task did not investigate or repair it. The interrupted/resumed run finished in 10.9 minutes, with all three protected project hashes unchanged. Logs and summary: `codebase/output/release-checks/2026-10-16T16-24-55-193Z-29cde84e1a59b2272a4f/`. Fast checks passed (516 Node; 2,204 Python, three skips). No release/full sweep was run.

Release build fixes (October 16, 2026): the first 0.9.1 GitHub build was the first macOS and Linux run of the Library tests and failed before publishing. Library rename, move and delete rely on Windows file locks, so on macOS and Linux they are now refused before any file is touched, and their tests run on Windows only; Show in folder now works on all three. On Apple Silicon, film-stock strips differ from whole-picture processing by up to about one part in a million (largest seen 0.9 ppm), invisible in a photo; Steve accepted a macOS-only allowance of 2 ppm for those strip checks, and Windows stays exact. The macOS RAW read-ahead test now compares the photo's recorded length (macOS rounds shared memory to a page; the app already used the recorded length). On macOS, the test where a requested folder check interrupts a background scan timed out and is marked as an expected failure there until it can be diagnosed on a Mac. The packaged-app smoke test now waits for the shared import input, since the Library owns the start screen.

Library cold-folder follow-up (October 17, 2026): the historical peak of eight
above was a driver counting artifact. Four cancelled fetches remained counted
until late browser failure notifications, overlapping their four replacements;
renderer fetch/body work peaked at four. Stage A now counts live work in the
cold folder and retires cancellation immediately. The limit remains four and
application behavior is unchanged. This corrects the request-peak diagnosis;
the other release limitations above remain open.

## Release 0.9.2 status (November 11, 2026)

GPU delivery is implemented for export and Proof, with CPU fallback.
Full-size Proof shares the export render. The November 8 report of two GPU
exports differing did not reproduce: independent exports under 3 GiB and
2 GiB memory admission were byte-identical, and `tests/gpu-delivery-repeat.js`
now guards it. Retouch interaction is built; its final quality review remains
open.

Focused release check at `3b19986f` (102 drivers, 120-minute cap approved by
Steve for this release): 86 passed, 15 failed, 1 unfinished. Every failure was
resolved and its driver rerun on later `main`, except the two below. Causes:
eleven out-of-date tests (removed interpretation dismissal, component-sheet
row and contrast changes, Film marker tooltip, preset row buttons, Look timing,
Library sort timing, worker fault injection, a stray test-photo sidecar), and
three application bugs fixed before release: the Library helper stalling on
JPEG XL size checks, manual interpretation not clearing the review gate, and
the Library tag field keeping its text after adding a tag.

Shipping with:

- `film-stock-parity.js`: the extreme HDR preview range limit above (known
  failure; Steve, November 11, 2026). With output Highlight Compression off
  and extreme brightness, the preview can show wrong colours in the brightest
  areas; export and Proof are correct.
- `edge-colour-raw.js`: on the release test machine, GPU edge colour produced
  3, 6 and 4 invalid pixels on three runs (non-repeatable; the machine's
  recorded faulty VRAM, see October 24 in import-and-raw). The range guard
  rejects the result and the CPU fallback finishes the photo, as designed.
  The same GPU path passed on Steve's Mac.

macOS only (Steve, November 12, 2026): CPU strip rendering of a perspective
correction may differ from whole-frame rendering by one half-float rounding
step (1.5e-5 measured on Apple silicon); `test_cpu_strips.py` allows 2e-5 on
macOS and keeps 1e-5 elsewhere. Not visible.

Grade speed items carried to the next version are listed in section 5 of
`docs/technical/performance-table.md` (SDR HSL Show selection about 1.5 s,
SDR Match entire about 1.2 s, Film and lens drags 10 to 16 frames per second).
