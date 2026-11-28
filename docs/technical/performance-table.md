## November 28, 2026 — Grade audit first presented GPU frame

MacBook Neo, A18 Pro, 8 GB, 1408×794 at 2×, mains power, shared GPU lock.
HDR Fit on IMG_7723.CR3, three measured samples after one warmup, app
`a361c44a` with the new audit clock. Values are medians with
sample ranges in parentheses. This is a measurement change, not an app
speedup.

| Action | First GPU-fenced presentation | Still-current feedback |
| --- | ---: | ---: |
| Bands value drag | 30.7 ms (19.7–33.6) | 48.9 ms (45.8–149.5) |
| Exposure drag with Film on | 169.1 ms (167.7–184.3) | 1,179.3 ms (1,067.5–1,603.1) |

The Bands check expected a median within 30 ms of the earlier ~50 ms
animation-frame observation to allow for frame scheduling. The earlier
diagnostic actually recorded fences at 25–35 ms and the following
animation-frame checks at 40–49 ms, consistent with the new clock ending
at the fence.

## November 28, 2026 — Mac Grade module audit, before and after the cleanup sprint

MacBook Neo, A18 Pro, 8 GB, 1408×794, mains power, GPU lock, nothing else running.
Driver `tests/performance/grade-module-impact.js` (five samples, two warmups). Baseline at
`cd664192`. After: Fit at `a6df0067`, Denoise re-check and 100% at `f68540d5`. Typical photo
is IMG_7723.CR3 (24 MP); large is DSC00636.ARW (50 MP). Medians. "First" means the first
picture still current at the next frame (see the measurement note in
`docs/technical/audits/2026-11-28-mac-after/README.md`). Data:
`docs/technical/audits/2026-11-28-mac/` and `docs/technical/audits/2026-11-28-mac-after/`.

| Action | Before | After | Conditions |
| --- | --- | --- | --- |
| Exposure drag with Film on, typical Fit | first 3.09 s, settle 1.32 s | first 1.00 s, settle 0.76 s | Portra 400, Black Pro-Mist, Halation, Grain. Film off: first 0.05 s. Still about 1 s over Steve's 100–200 ms aim; see the Film research in the sprint brief. |
| Exposure drag with Film on, large Fit | first 1.89 s, settle 0.92 s | first 1.45 s, settle 0.78 s | Same recipe |
| Film own sliders, typical Fit | settle 0.63–0.65 s | settle 0.55–0.60 s | Look strength, Lens, Halation, Grain, Print contrast |
| Exposure drag with Highlight Compression (Peak Fit Maximum), typical / large Fit | settle 0.39 / 0.44 s | settle 0.30 / 0.32 s | O4 |
| Denoise back on, typical Fit | 0.05 s | 0.06 s | The O2-1 memory fix made this 3.2 s (Micro Grain 7.1 s) at `a6df0067`; `f68540d5` keeps the bypassed picture |
| Highest memory during the 100% large run | 4.34 GB footprint, 3.14 GB GPU process | 3.63 GB footprint, 1.77 GB GPU process | Denoise, Film, Detail, Local and Geometry at 100%. Before, it exceeded the 4,000 MB Mac ceiling |
| Micro Grain on at 100%, large | settle 7.95 s | settle 1.34 s | |
| Clean Grain Amount drag at 100%, large | settle 0.71 s | settle 0.17 s | |
| Exposure drag with Film on at 100%, large | first 7.24 s, settle 4.80 s | first 4.58 s, settle 1.90 s | |
| Unchanged RAW Apply, Sony _DSC7970.ARW 42 MP | 5.57 s | 0.33 s | O3; changed RAW controls still do the full work |
| Black Pro-Mist GPU time, quick lens fixture 1520 px HDR / SDR | 2.59 / 1.81 s | 0.78 / 0.59 s | O1, pixel-identical |

## November 28, 2026 — Mac Library fallback for a source too large for the GPU

MacBook Neo, A18 Pro, 8 GB, 1408×794, v0.9.4 plus the change in this commit.
Separate fresh plain-Electron profiles under the GPU lock, installed app
closed, existing 4 GB app setting and system reserve. The same verified
DSC04375.ARW and saved grade as in the preceding diagnosis were used, with
only the repairs removed in the disposable control. One diagnostic observation
per route, not a general thumbnail speed comparison.

| Action | Grid request to presented thumbnail | Result |
| --- | --- | --- |
| DSC04375 with the seven saved repairs | 6.35 s, previously not pictured in 27 s | One terminal GPU refusal, no GPU development or retry, then a fresh CPU grant with no admission wait. The source ran for 5.95 s and logged replay of all seven repairs. App tree peaked at 1.83 GB, minimum system availability was 3.61 GB, and the quick check passed. |
| DSC04375 control with no repairs | 1.48 s | GPU development as before, no fallback. The app drew the thumbnail, but independent system availability briefly reached 1.08 GB and the harness failed the unchanged system-reserve check, as in the pre-change control. |

No changes to original RAWs, grades, the 2 GB system reserve, app/GPU budgets,
estimates or repair algorithms. Full fast checks completed with no failures
(Node 1,583 passed, one skipped. Python 5,147 passed in the parallel phase,
47 passed in the serial phase, 126 skipped and one existing expected failure
passed). Evidence is in
`codebase/output/quick-library-check/mac-gpu-capacity-{repair,control}-verify/`
(`backend.log`, `memory.jsonl` and `report.json`) and
`codebase/output/thumb-admission-verification/` (`real-app-summary.json` and
the fast test logs).

## November 28, 2026 — Mac Library thumbnail reservation, paired repair test

MacBook Neo, A18 Pro, 8 GB, 1408×794, v0.9.4 app code at `2bf59b84`
(only documentation since release). One curated DSC04375.ARW in a fresh grid
and disposable profile per run, installed app closed, GPU lock held. The
control kept the same grade apart from emptying the disposable repair list.
Independent physical-footprint census at ~0.25 s measures increments within
each run, not exact allocations or a safe replacement budget.

| Recipe | Grid request to picture | Memory |
| --- | --- | --- |
| Original seven saved repairs | Not shown in 27 s, never admitted; cancelled at 27.09 s | 2.405 GB job estimate plus 2 GB system reserve versus 4.04–4.29 GB available after the folder opened. The census never saw the repair work run. No system-reserve breach. |
| Same grade without repairs | 1.43 s, no queue; admitted source work 1.04 s | 1.724 GB job estimate versus 1.410 GB sampled app-footprint increase (0.692 → 2.102 GB), and GPU job peak 1.211 GB versus its 1.424 GB GPU lease. The picture passed coverage, but the harness observed available RAM below the unchanged 2 GB reserve after admission. |

A saved repair uses the 48-byte/photosite complex GPU reservation, compared
with 32 for this same source without repairs. The 0.681 GB increase comes
entirely from that rule, not file size. Replaying the production scheduler
with the observed grants, 4.29 GB available reproduces `system reserve` for
the repaired job. An idle synthetic 4.50 GB supply clears system admission
but still gives `GPU memory`: the job's 2.110 GB GPU requirement plus 93.3 MB
of draw headroom exceeds the observed 2 GiB GPU budget by 55.8 MB, even with
zero external GPU work. The no-repair request admits with the same settings.
This is a scheduler result, not a measurement of repaired GPU allocations.
No reserve, budget, admission policy, app code or original photo/grade changed.
Focused scheduler tests: 52 passed. Evidence: `codebase/output/quick-library-check/mac-thumb-reservation-{repair,plain}-1128/`
(`backend.log`, `memory.jsonl`, `report.json` and `repair`'s `scheduler-replay.json`).

## November 28, 2026 — Mac Library memory capture with other apps open

MacBook Neo, A18 Pro, 8 GB, 1408×794, 4 GB default app ceiling, v0.9.4 code
with parent `0e9f63c4` (documentation only since the release). Two fresh plain
Electron profiles, each under the shared GPU lock, with the installed app closed.
T3 Code, Safari and Notes left open. Read-only curated RAWs reused by hard link,
with disposable copies of their grades. Independent app census and macOS
pressure/availability sampled every ~0.25 s, other app footprints once a second.

| Action | Screen wait | Admission and memory |
| --- | --- | --- |
| Show `_DSC7970.ARW` alone | 3.15 s grid request to display | No queue, 2.75 s admitted work. macOS was normal at admission (3.95 GB available) and changed to warning near the end of development. |
| Open a cold three-RAW grid | DSC00264: 1.53 s; _DSC7970: 26.24 s; DSC04375 not shown in 45 s | DSC00264 started immediately. _DSC7970 queued 23.51 s and ran for 2.42 s. macOS was at warning for 88 of 93 samples during that wait (median reported availability 2.25 GB). It returned to normal near admission (4.04 GB). DSC04375 stayed behind the system reserve until the scenario stopped its request at 45.03 s. |

The batch began at normal pressure and switched to warning 1.11 s after the
folder opened. HDRF's observed process-tree peak was 2.15 GB, below its 4 GB
ceiling. The other measured footprints stayed steady through the delayed
picture: T3 Code and its non-test children 1.26–1.29 GB, Safari's own processes
0.21 GB, Notes 0.04 GB, and WebKit services 0.89 GB (not attributed to a single
app). The 1.72 GB source estimate needs at least 3.72 GB before other outstanding
reservations. DSC04375's 2.41 GB estimate needs at least 4.41 GB, more than was
observed even at normal pressure. When macOS reports warning, HDRF switches
from normal-pressure pageable headroom to the conservative Mach reading. The
jump between those readings is not a direct change in the number of free bytes.

Both harnesses observed available memory below the 2 GB reserve and failed that
check. Batch coverage was 2/3, with no visibility failure. This reproduces real
system pressure and app-side admission, not a GPU stall or a measured spike in
another app. The batch is not a controlled reproduction of the earlier 42 s
installed wait. No artificial load, code or policy change. Evidence is in
`codebase/output/quick-library-check/mac-thumbnail-stall-{single,batch}-1128/`
(`backend.log`, `memory.jsonl`, `system-memory.jsonl`, `report.json`). The single
run's per-app footprint grouping was not used because it included test children.

## November 28, 2026 — v0.9.4 installed Mac Library log review

One live session of the installed `v0.9.4` (`3d585bee`) on the MacBook Neo,
A18 Pro, 8 GB unified memory, 4 GB app ceiling. Local time 10:17–10:21.
Times are from existing desktop/backend logs, not a controlled benchmark.

| Action | Observed time | Conditions |
| --- | --- | --- |
| Open noisy photos, show a camera preview and then the eight fresh grid thumbnails | First camera preview 0.50 s after folder click; finished thumbnails 19.26–42.35 s from their grid requests | Source queue 16.63–38.89 s, admitted preparation/development and handoff 0.80–2.90 s. For DSC05293 and _DSC7970, the queue took 34.64 of 38.15 s and 38.89 of 42.35 s respectively. Both were held by the existing 2 GB system reserve and finished on the GPU route. |
| Open HDR Test Images and show uncached grid thumbnails | 6.40–16.00 s on initial visit; 1.17–2.66 s for two previously cancelled RAW requests and 18.64 s for DSC01287.exr on return | The EXR queued for 16.78 s on the system reserve and ran for 1.63 s, after startup upkeep had already finished. Two prior slow RAWs (DSC01204 and DSC01244) restored their finished thumbnails in 0.11 s on return. |

All 16 fresh grid thumbnails in this trace completed on the GPU route, with
no CPU fallback. Two float TIFFs had no embedded JPEG stand-in. Finished
thumbnail cache keys changed from v3 to v7 between `v0.9.3` and `v0.9.4`,
requiring regeneration on first use after upgrade. That increases the number
of jobs needing memory, but reopening does not bypass the reserve for pictures
still missing from the cache. The observed limit is admission before source
development, not a stalled GPU. The historical grant records do not identify
what held system memory at admission. No app, cache, or memory policy changed.

## November 28, 2026 — v0.9.4 Mac release rechecks

MacBook Neo, A18 Pro, 8 GB, at 1408×794. Standalone Electron runs under the shared GPU lock.

| Check | Result | Conditions |
| --- | --- | --- |
| Library live tiles, Export closed / open | 17.766 / 17.920 s per photo (+0.87%), within the unchanged 5% allowance | Parent `8dfdeb5f` plus test fixture correction. DSC00264 and DSC04375 use bounded CPU strips at the unchanged 4 GB default, DSC00512 uses GPU. One warmup plus three closed and three open native exports. No progress redraws. `library-export-live-tiles.log`. |
| Overlay backlog | 42.7 s complete | Parent `7472bfba`. Required 30 s drag alone exceeds the old 30 s runner deadline; the existing growth guard and recovery pass. |
| Library precision sources | 57.3 s complete | Parent `7472bfba`. 640/2560 source pairs, preemption/re-admission and Grade pixel comparisons. EXR CPU/GPU median preparation 7.92/3.42 s, float TIFF 0.367/0.109 s. |
| Denoise measurement | 57.6–63.8 s complete | Parent `7472bfba` and final Denoise code `3696dc16`. Remaining corpus without the retired EXR, then 42 MP Grade. 676–696 ms CPU model / 136–140 ms GPU model including transport (66 ms GPU compute). |
| DSC00950 100% preview against pre-encode export | 171.59 s for both lanes and all six viewports | Parent `84fd0991` plus mounted detail capture correction. Native-relinked protected project, unchanged pixel and mask gates, exact GPU editing and offline CPU export reference. |
| Library rendition matrix | 30.30 s after TIFF measurement correction | Parent `231d7369` plus reduced TIFF float32 noise inputs. BT.709 HDR p99.9 3.261 before and 0.170 after, with the 3.0 limit unchanged. |

## November 27: Brighter SDR Match target (PC)

Match click to exact SDR presentation, or to refusal, in disposable Electron at
2560 x 1440 under the shared GPU lock. Prior target at `400eb1e4`; brighter
target at `4b6d2a2a`. One timed attempt per saved grade and target, excluding
project open. Nine photo copies, including the current _DSC7970.ARW grade.

| Action | Prior target | Brighter target | Conditions |
| --- | ---: | ---: | --- |
| Match SDR, click to settled picture | 4.92-10.69 s GPU (8 photos), 27.51 s CPU (one candidate timeout) | 4.56-7.12 s GPU (6 photos) | All successful GPU fits were certified on CPU. |
| Match SDR, click to refusal | None | 37.24-47.47 s (3 photos) | GPU attempt followed by CPU fallback; the unchanged safety gates refused both fits. |

The new target does not meet the nine-photo qualification. The flower
(DSC09738), beach (PC290598) and reported _DSC7970 photo were refused, and
some successful fits exceeded the body colour-error limit. The paired
pictures, brightness, colour errors and settings replace the earlier local
review at `codebase/output/review/sdr-match-tone-fit/index.html`.

## November 27: Windows shared-curves qualification

Single diagnostic runs on Steve's PC with disposable Electron at 2560×1440
under the shared GPU lock. Tested code at `aab6d698`. These are test-case
timings and not an app-wide latency comparison.

| Action | Time | Conditions |
| --- | ---: | --- |
| Whole Match request with copied HDR Red curve | 2.86 s | Synthetic HDR headroom fixture, 170 GPU candidates and CPU certification. The run completed as Needs review at the existing gates. |
| Export request with active HDR Luma and Red curves | 35.59 s GPU / 40.79 s forced CPU | Saved DSC04375 grade, JPEG Ultra HDR at 4,000 pixels, 1,000-nit target. Export, full-size Proof and decoded verification together took 66.22 / 87.05 s. Both decoded at 999.09 nits, and each Proof was byte-identical to its route's export. |
| Mixed Library viewport after picture-cache version bump | 90 s smoke | All 30 eligible viewport photos pictured. First, tenth and twentieth pictures at 1.1, 1.6 and 22.0 s, on the frozen v1 fixture. No release speed comparison. |

## November 27: HSL live selection check (PC)

On Windows PC at 2560x1440, a fresh Electron profile with the GPU lock and a
disposable saved grade of _DSC7970.ARW (Clean Grain and Film Look) showed a
changed selection overlay about 0.93 s after the start of a six-step wheel
drag, before pointer-up. The detailed overlay replaced it on release.
One real-app behaviour check on the Compare/HSL fix checkout, with the fast
Python suite also running. This is not a warm frame-rate benchmark or a new
performance tolerance.

## November 27 ? Windows SDR Match picture fit

Compare button click to the exact SDR presentation (or refusal), with the
saved grade already open, in disposable Electron at 2560?1440 under the shared
GPU lock. Baseline `ff49cb97`, picture fit `2d1251ef`. Use the existing 10%
Grade timing tolerance,
since it leaves room for ordinary PC run-to-run variation. The reference photos
are the eight PC-only copies named in the [brief](briefs/sdr-match-tone-fit-2026-11-27.md).

| Action | Before | Picture fit | Conditions |
| --- | ---: | ---: | --- |
| Match SDR, click to settled picture | 6.70?34.17 s for seven successful matches; flower refused at 55.72 s | 4.60?6.90 s, all eight committed | One timed trial per saved grade and version, PC WebGPU, source already open. All eight new fits used GPU candidates and CPU certification. |

The seven previously successful photos were all faster. The median for those
same seven photos fell from 18.56 s to 5.73 s. The flower and black-and-white
photo now both report matched at the unchanged gates. Per-photo timings,
settings, perceptual measurements and images are in the local review at
`codebase/output/review/sdr-match-tone-fit/index.html`.


## November 27: release-driver speed work blocked on PC

HSL delivery now has a `--all` mode: one neutral case, the global edit, then
reset global HSL and test the local hue mask alone. Release registration uses
`args: ["--all"]` without the old `--local` follow-up. All original
full-resolution renderer, HDR ceiling, Proof-byte and added-difference gates
remain. This removes one duplicate neutral GPU/CPU export+Proof pair and one
app launch; no measured speed claim is available yet.

| Attempt | PC observation | Conditions |
| --- | --- | --- |
| HSL standalone global baseline | 25.70 s, failed before driver start | Electron target closed during initial page load. |
| HSL standalone local baseline / startup retry | 186.71 s, failed before driver start | 180 s startup timeout; no launch process handle. |
| RAW Single baseline | 44.83 s, failed before reference comparison | First RAW GPU development rejected an invalid finite-half-float sample (1.31e21), consistent with this PC's known faulty VRAM. No profile was produced. Driver unchanged. |

Windows PC, 2560x1440, shared GPU run lock; direct release-equivalent Electron
launchers, per Agent01's instruction because other workers were editing the
shared checkout. Baseline HSL invocations retained their original standalone
behavior while `362673ec` added combined mode. Whole launcher times exclude
lock queueing. Evidence: `codebase/output/test-driver-speed/before.json` and
adjacent `*-before.log`. No valid before/after comparison, after GPU run or
next-driver work; stop after the startup retry. Four behavioral HSL driver
tests pass at `8f658a27`, including local gate failure and standalone modes.
Further real-app validation is required before treating combined mode as
qualified. Output remains 36.7 GB (100 GB limit).

## November 27: Neutral extreme scanner saturation qualification (PC)

| Action | Result | Conditions |
| --- | --- | --- |
| Film parity release driver with exposure and UI follow-ups | 408.736 s; STOPPED on final UI Electron startup/shutdown verification. Main matrix and 72 exposures passed; not a complete-driver speed comparison. | Windows PC / NVIDIA Lovelace / 2560x1440, exclusive GPU wrapper, d487a8a9. Startup timeout also reproduced without concurrent Python tests. Evidence: codebase/output/release-checks/2026-11-27T05-44-22-681Z-43634390507ec9a031f1/. Prior attempt: EPERM replacing progress file, then startup timeout. |
| Required Node/Python checks | Node 66.881 s (1,549 passed / 1 skipped); Python 914.41 s (5,245 passed / 56 skipped, including 48 serial checks). | Same Windows PC, d487a8a9 change set. Python wrapper was redirected through PowerShell, which reports native stderr as an error despite both pytest phases passing; no assertions failed. Logs: codebase/output/film-neutral-{node,python}.log. No app-speed claim. |

## November 27: Film stock parity driver transport (PC)

| Action | Observation | Conditions |
| --- | --- | --- |
| Complete Film stock parity release driver, including exposure and UI follow-ups | 212.596 s, completed; 1 known failure, 0 new, 0 unfinished. Earlier d7da33c1 attempt hit its 900 s deadline during exposure; retry/cap left the 1804.206 s selection unfinished. | Windows PC / NVIDIA Lovelace / 2560x1440 machine window, exclusive shared GPU lock, 8ba7be54. The driver's byte comparison remains 1200x800. Exact in-renderer histogram replaces millions of CDP values and sorted copies; no app speed claim or deadline change. Different completion states prevent a full-run speed ratio. Evidence: codebase/output/release-checks/2026-11-27T05-13-07-686Z-90e04d6b10d96bf309ff/. |

## November 27: CPU Library progress and native band sampling (PC)

| Action | Before | After | Conditions |
| --- | --- | --- | --- |
| 50 MP DSC00636.ARW CPU scene preparation, 640 with shared 2560 companion | 56.4 s | 26.1 s (54% less wait) | Windows PC, 12 logical CPUs / 64 GB, curated read-only RAW, fresh disposable Library cache, cProfile, shared GPU lock; open user app retained. Baseline d5a76c0c versus this change. Intermediate native horizontal reduction alone: 51.3 s, including 31.6 s in NumPy planar lens sampling; native sampling removes that bottleneck. No full-resolution, lens, highlight, cleanup or measurement work skipped. Single samples establish the large gain, not a narrow timing guarantee. |
| Frozen mixed Library viewport | 26/30 at 90 s; helper restarted three times, then stopped | 30/30; all viewport photos pictured by 79.1 s, zero helper restarts | Same PC/2560x1440/frozen v1/plain Electron/shared GPU lock, faulty VRAM exercising four real CPU recoveries, user app retained. Own suites finished before final run. First/ten/twenty pictures 0.9/1.4/22.2 s. Final `codebase/output/quick-library-check/cpu-library-partition/report.json`, base 6c734ec0 plus this change. Earlier timeout/native-sampling-only run reached 28/30: queued recovery memory reservations serialized behind one worker; sharing the existing CPU foreground partition cleared them. |
| Library drawing / whole-app peak | Longest reported frame gap 91 ms, main-thread block 106 ms; peak 5.688 GB | No recorded long frame gaps, longest main-thread block 55 ms, peak 5.804 GB (+2.0%) | Same final run and transport-recovery-final baseline. Existing drawing and memory guards pass without relaxed limits; this is faulty-card fallback qualification, not a healthy-GPU performance benchmark. Memory peak includes concurrently active admitted CPU recovery jobs. |


## November 27: GPU transport recovery investigation (PC)

| Action | Observation | Conditions |
| --- | --- | --- |
| Mixed Library viewport, original rejection reproduced | 28/30 in 90 s; same DSC00264.ARW / DSC01226.ARW transport errors as Film qualification. First/ten/twenty: 1.0/1.5/21.2 s. | Windows PC, 2560x1440, frozen v1 verified by hash, shared GPU lock, plain Electron, 8a488025 before this fix. `codebase/output/quick-library-check/transport-investigation/report.json`. |
| Mixed Library viewport, early validation + fair CPU recovery | Still incomplete: 26/30 in 90 s; first/ten/twenty 0.9/1.6/21.5 s; peak 5.67 GB. Existing memory/drawing limits pass. Four corrupt RAW developments reach CPU recovery, then hit the existing decoder deadline and exhaust helper restarts. | Same PC/fixture/lock; own CPU suites finished before launch; commit containing this note. No tolerance or deadline changed. `codebase/output/quick-library-check/transport-recovery-final/report.json` and `backend.log`. Not a speed qualification or a successful Library smoke. |
| RAW decoder before/after TIFF correctness diagnostic | Both full 42 MP RGB arrays byte-identical, finite; DSC00264 peak 1.6372, DSC01226 peak 2.8520. Individual CPU decode events 11.6-17.1 s, not a performance comparison. | Loader from d7443be9 parent versus current loader, identical current dependencies/default RAW settings; reused read-only v1 run photos. Early GPU check/CPU tests overlapped part of this correctness diagnostic. |
| Full Python correctness run | Parallel: 5190 passed, 56 skipped in 860.51 s; serial: 46 passed in 62.76 s; runner wall 933.07 s. | Current PC, four bounded workers; early RAW correctness diagnostic/app run overlapped first part. Do not compare speed against the isolated baseline below. Two added scheduler tests passed separately with the 61-case focused scheduler suite. `codebase/output/transport-investigation-python.log`. |

## November 27: Film Look qualification Library smoke (PC)

| Action | Observation | Date / commit | Conditions |
| --- | --- | --- | --- |
| Mixed Library viewport, Film Look qualification | Incomplete: 28/30 expected viewport photos in 90 s. First/ten/twenty pictures 1.2/1.7/24.0 s; longest picture gap 16.7 s. No speed comparison or improvement claim. | 2026-11-27, commit containing this note | Windows PC, 2560x1440, plain Electron, shared GPU lock, frozen library-mixed-v1. Full Python run completed before launch. DSC00264.ARW and DSC01226.ARW rejected by GPU RAW finite-half-float transport; no Film-stage error. Memory limits pass, external app peak 2.739 GB. Evidence: `codebase/output/quick-library-check/film-library-final/report.json`. |

## November 26-27: bounded parallel Python tests (PC)

| Action | Serial baseline | Parallel runner | Conditions |
| --- | --- | --- | --- |
| Full Python suite, 5,088 collected cases | 949.56 s (15m 50s) | 604.66 / 588.89 s (10m 05s / 9m 49s), 36-38% less wall time | Windows PC, nominal 64 GB RAM, 12 logical CPUs; CPU-only. Four xdist workers followed by 45 serial process/deadline cases. Each full run: 5,032 passed / 56 skipped. `194d01c9` + this tooling change; baseline after token-contract repairs. Whole runner time includes both phases, collection and startup. Original pixel/data fixtures and all deadlines/tolerances retained; no cases removed. [Logs and counters](../../codebase/output/test-speed-2026-11-27/results.json). |

## November 26: HSL resource-retirement correctness diagnostic (PC)

| Action | Observed | Conditions |
| --- | --- | --- |
| Shared HSL oracle range edit / edge edit | 3.7 / 3.6 ms | Windows PC, 2560x1440, isolated Electron profile, exclusive GPU lock; `dd9b8269` + `57439f70`. Single correctness run, not a user-action timing or before/after speed comparison. Existing driver timing guard unchanged. All 35 CPU/GPU cases and zero-seam/reuse checks pass after immediate post-submit buffer retirement. Evidence: `codebase/output/hsl-selection-engine/result.json`. |

## November 26 - Batch progress result lookup

| Action | Before | After | Conditions |
| --- | --- | --- | --- |
| Batch grid progress refresh JavaScript (DOM stand-ins, not compositor time) | 63.45-72.42 ms; median 66.90 ms | 4.11-8.84 ms; median 5.60 ms | Windows PC, Node 24, actual `renderGrid` extracted into the `batch-grid.test.js` harness; 2,000 photos / 4,000 results, rows retained, one warm-up per arm and nine alternating pairs. Before: `a5e46ad3`; after: same base with one result-grouping pass per refresh. 5% noise allowance. Badge precedence, active progress, selected state and row identity unchanged. No claim about end-to-end screen time. |

Local evidence links under `codebase/output/` refer to ignored measurement
artifacts. They may be absent on another device or after scratch cleanup;
the dated results below remain the record, not a promise those files ship.

## November 26 - Library/shell review visibility-limited check

| Action | Result | Conditions and evidence |
| --- | --- | --- |
| Plain-app Library viewport check | Invalid: renderer hidden/occluded, incomplete viewport coverage; timer probe 1161 ms against 250 ms limit. No qualified screen timing or before/after claim. | Windows PC, 2560x1440, shared GPU lock, 90-second default scenario, `f52c06cb` shared checkout including Library cancellation/refresh fixes and desktop close-save fix. Steve's app stayed open. `codebase/output/quick-library-check/library-shell-review/report.json`. Repeat only with the test window visible. |

## November 26 - FIFO GPU-lock fixture timing

The shared wrapper now admits new waiters in registration order. Disposable
subprocess/temporary-lock tests use 50 ms polling; production retains its
5-second wait interval. All 9 applicable tooling tests pass (2 platform skips).
With the same new FIFO coverage, reducing test-only polling took the group
from 27.23 s to 16.60 s and the three-waiter FIFO case from 17.40 s to 6.38 s.
Concurrent load varied (setup 1.57 s versus 5.87 s); these are observations,
not an app/GPU performance claim. Evidence: `codebase/output/test-infra-fifo-tests.txt`
and `codebase/output/test-infra-fifo-tests-after.txt`. No real GPU was used.

## November 26 - Python review timing and profile cleanup

One serial full run with `--durations=50` during concurrent edits: 1,391.36 s,
4,934 passed / 30 failed / 56 skipped. The lead reviewer's clean pre-review
baseline was 1,203 s, 4,962 passed / 56 skipped; this run is not an after-speed
comparison. Failures were in memory polling (1), HSL paste (1), Library paste
(22) and RAW cleanup state (6), forwarded to their reviewers.
The slowest calls were real batch/two-version encoding (37.54 s), the 5,000-file
cache accounting test (28.28 s), full-size Proof identity AVIF/JPEG/JXL
(23.79/22.79/14.31 s), and the 10,000-failure Library flood test (16.21 s).
Those input sizes and all real codec cases remain: reducing them would remove
the behavior or scale being tested. Capability discovery is already cached.
The lock-fixture polling improvement is measured separately above; the final
full-suite time remains for the lead reviewer after all concurrent work ends.
Evidence: `codebase/output/test-infra-durations-baseline.txt`.

That full run also exposed a Windows teardown error: a process-cached SQLite
ledger held the disposable profile open. Pytest now closes handles belonging
only to its own temporary profile before deleting it. A child-pytest regression
checks successful exit and actual directory removal (passed in the focused
run; `codebase/output/test-infra-profile-cleanup.txt`). Production is unchanged.

## November 26 - Test infrastructure (PC review)

Test-only changes on `integrate/pc-tests-review-2026-11-26`; app behavior and
GPU waits are unchanged. Single observations during concurrent review, with
5% treated as timing noise rather than a regression. From `codebase`,
`npm run test:release -- --plan` took 19.81 s before and 5.81 s after lazy
photo-path/project lookup and avoiding irrelevant history-log reads. The
selection grew from 123 to 124 drivers during other reviewers' work, so this
is not a controlled benchmark. The command launches no drivers.
The targeted runner checks took 68.47 s before (28 passing) and 41.56 s after
(30 passing, including the photo-path checks); process/Git tests dominate.
Evidence: `codebase/output/test-infra-release-plan-{before,after}.txt`,
`test-infra-runner-targeted.txt` and `test-infra-runner-after.txt` in the
same output directory. Python full-suite after-time is deferred until all
reviewers finish; no full-suite speedup is claimed here.

## November 26 - Native large export, GPU versus CPU on Windows

Windows 11 PC, Ryzen 5 7600 / RTX 4070 Ti, unpackaged Electron at 2560×1440,
`76f1cf12`, 8 GB diagnostic ceiling, one native HDR JPEG XL Q95/12-bit
Library export per arm. No Grade photo held. Time is batch start to finish,
including RAW development, encode, validation and finished-pixel capture.
Peak is sampled private commit for the test app tree, not dedicated VRAM.

| Source | CPU wait / peak | GPU wait / peak | Finished HDR agreement |
| --- | --- | --- | --- |
| DSC00636.ARW, 50.09 MP, default grade | 155.7 s / 5.857 GB | 177.3 s / 8.174 GB | Fail. Extreme finite samples in the GPU render made ΔE ITP non-finite. |
| DSC04375.ARW, 42.39 MP, saved grade | 157.4 s / 5.740 GB | 131.5 s / 7.536 GB | Pass. ΔE ITP mean 0.02246 / P99.9 0.06071. |

Single observations, not speed baselines. JXL encoding was 103–118 s per
arm. The initial 6 GB DSC00636 Ultra HDR JPEG probe selected bounded CPU
and stopped at the codec's 8192-pixel width limit (65.4 s, 3.921 GB).
[Settings, method and caveats](research/large-export-cpu-default.md).

## November 26 - PC repeated-delivery follow-up

Windows PC, 2560x1440, commit fef365cb (fix/overnight-report-followups), Steve's Electron
app still open on the shared GPU. gpu-delivery-repeat's post-change rounds took
80.2 s then 43.0 s, each including export, full-size Proof and two read-only
ceiling decodes. These are test-round times, not export-only speed measurements
or a before/after performance comparison. Both stayed on GPU and matched exactly.
Evidence: codebase/output/gpu-delivery-repeat/result.json.

## November 16: controlled draft-grain comparison and interactive stage costs

**The earlier slowdown is not reproduced consistently; its cause remains
unestablished. No grain, settled-picture, Proof or export change is made here.**
The one production cleanup removes temporary arrays/callbacks from CPU scope
analysis, preserving its arithmetic and complete numerical output.

### Parent versus `4e84549e`

Neo / A18 Pro / 8 GB / 1408×794 points, saved DSC01287 Ektar/grain/halation/
Tamron grade, Auto processing. Both arms use the same current diagnostic driver,
photo, sidecar, preferences and disposable Electron profile. A serves the exact
three changed production-file blobs from parent `e61a3a88`; B serves those from
`4e84549e`. Asset hashes and successful interceptions are recorded. No scope
cleanup was installed during this comparison. The GPU lock serializes all runs
against the other worker; no existing Electron was closed.

Seven complete pairs: A1 B1 B2 A2 A3 B3 B4 A4 B5 A5 A6 B6 B7 A7. Each arm
has 42 native Fit drags and seven repetitions of each zoom transition. The
diagnostic timing band was ±10% before measuring, not an acceptance waiver.
These medians count only accepted frames still current when GPU completion is
observed, followed by animation-frame callback; they are not submission times
or physical display scanout measurements.

| Measure | Parent A | Draft commit B | Median change |
| --- | ---: | ---: | ---: |
| Native Fit drag | 17.54 fps | 17.46 fps | −0.5% |
| Release to last current exact frame | 1.169 s | 1.192 s | +2.0% |
| Release through all idle/anchor/fence guards | 1.279 s | 1.306 s | +2.1% |
| 100%, first / final exact | .819 / 1.444 s | .819 / 1.437 s | −0.1% / −0.4% |
| Return 50%, first / final exact | 1.102 / 2.464 s | 1.218 / 1.678 s | +10.6% / −31.9% |
| Return Fit, first / final exact | .337 s | .347 s | +3.1% |

The original .718→2.455 s first 100% frame and 1.336→3.206 s final frame
do not recur as a consistent revision effect. Paired first-100% differences
range −33.3% to +67.8%; paired release-to-final differences range −5.9% to
+5.5%. The 50% first-frame median is just outside the diagnostic band: paired
changes range −6.0% to +44.7% (four slower, three faster). Its final-frame
changes range −44.0% to +60.5%. Do not label those mixed results a speedup,
prove grain caused them, or claim memory caused them. There is no justified
grain revert from these data; a smaller 50% first-frame regression remains
unresolved. Steve should try 100%→50% before another timing sweep.

Each report includes one-second available-memory/load/app-process samples and
start/end process CPU/RSS snapshots, with action wall-clock timestamps. RAM
below is sampled **available** RAM in decimal GB, not process RSS or a peak
between samples; the unchanged reserve is 2 GB. Fit-drag samples are mostly
3–4 GB available, but zooms repeatedly fall below reserve. This is not a
clean, unloaded-machine experiment: other open Electron, T3/WebKit and OS work
remain, and the six-core machine's one-minute load reaches 8.82. The lock
prevents another test driver overlapping, not those other applications.

| Pair | A available GB / load-1 range | B available GB / load-1 range |
| --- | --- | --- |
| 1 | .90–4.55 / 3.47–4.92 | 1.07–5.58 / 4.52–5.70 |
| 2 | 1.13–5.41 / 8.07–8.82 | .85–5.67 / 4.96–7.54 |
| 3 | 1.03–5.50 / 6.56–8.27 | .94–5.41 / 5.67–7.63 |
| 4 | .99–5.41 / 5.65–6.93 | .86–5.41 / 4.47–5.86 |
| 5 | 1.06–5.76 / 5.42–6.93 | 1.11–4.64 / 4.56–6.34 |
| 6 | .91–5.15 / 3.31–4.03 | 1.01–5.76 / 5.06–6.29 |
| 7 | 1.04–5.93 / 3.56–4.71 | 1.20–6.01 / 4.56–4.99 |

Two comparison launches failed before opening the photo (`A6-startup-failed`,
then A8): `HDRTonePreviewModel is not defined`, followed by the unchanged
60-second app-ready timeout. A6's one retry succeeded; comparison stopped at
seven complete pairs when A8 failed. They remain in the evidence, not in
successful action statistics. An old-scope stage launch later hit the same
startup failure; no startup code or timeout was changed to get a pass.

### Where the time goes

One pre-cleanup Fit drag and 100%→50%→Fit sequence were profiled with named
GPU pass timestamps and the renderer CPU profiler. GPU pass intervals overlap
on this tile GPU. The following are ordered **completion-path increments**
(each pass's end beyond the greatest previous end), not sums of overlapping
raw pass durations or independently isolated module benchmarks.

| GPU module / pass | Fit drag, per picture (21 live pictures) | 100%, total | Return 50%, total | Return Fit, total |
| --- | ---: | ---: | ---: | ---: |
| Base / tone / lens | .40 ms | 5.83 ms | 6.95 ms | 1.11 ms |
| Film response (two passes) | .15 ms | 2.49 ms | 1.44 ms | .13 ms |
| Halation extract + horizontal/vertical blur | 1.62 ms | 2.95 ms | 13.24 ms | 4.65 ms |
| Film finish (grain / vignette) | **22.08 ms** | **249.82 ms** | **1308.36 ms** | **251.20 ms** |
| Scanner / Detail | .71 ms | 12.98 ms | 6.49 ms | .72 ms |
| Picture compositing | .34 ms | 6.23 ms | 2.82 ms | .33 ms |
| Peak patch reduction | not in live pictures | 21.95 ms | 15.66 ms | — |
| Scope extraction (unnamed probe pipelines) | 2.16 ms over three commands | — | 1.11 ms | .79 ms |
| Placeholder compositing | — | 45.74 ms | 7.80 ms | — |

The live GPU picture takes about 26 ms; grain still dominates even with one
sample. Denoise and local adjustments are not active in this saved grade; this
is not a profile of every possible module. Fit's whole drag-plus-settle action
also does 48 native peak-patch renders; its total GPU increments are 1068 ms,
including 931 ms in Film finish. That is cumulative work, not release latency.

| Other stage | Fit drag + settle | 100% | Return 50% | Return Fit |
| --- | --- | --- | --- | --- |
| Full action, including idle guards | 2.473 s; release at 1.146 s | .997 s | 4.827 s | 1.758 s |
| CPU command encode→submit, median / max | .10 / .40 ms | .20 / .40 ms | .30 / .80 ms | .40 / .70 ms |
| Scheduler queue | median 5.2 ms, max 27.6 ms | no new slider frames | no new slider frames | no new slider frames |
| Source preparation | 96 patch requests, 529 ms cumulative | viewport await 285 ms | region await 3353 ms; first tile 3054 ms | existing source reused |
| Scope map/readback wait | 1.4–248.3 ms | none completes in action | 319.5 / 387.5 ms | 270.9 ms |
| Scope unpack | 2.5–6.7 ms | — | 17.2 / 11.2 ms | 17.1 ms |
| CPU histogram build | 14.5–47.1 ms each, 145.3 ms total | — | 68.6 / 89.2 ms | 66.8 ms |
| CPU histogram draw | 1.1–1.4 ms each | — | 5.4 / 3.2 ms | 3.8 ms |

A whole-frame `/proxy/hdr` request starts during 100%, takes 3.538 s, and
finishes during the return to 50%; its corresponding awaited preparation
stage is 3.546 s. These concurrent/continuing requests must not be added to
each other or to GPU waits. Scope map time includes queued picture rendering,
not just transfer. The first Fit histogram finishes earlier scope work during
the drag, so it is interference, not a newly requested live histogram.

Native Playwright moves arrive roughly every 40–67 ms. A separate three-drag
display-paced check sends inputs every ~16.7 ms yet still completes only
18.80 / 17.47 / 18.90 current pictures per second. The native driver therefore
does not establish a maximum, but removing its round-trip pacing does **not**
make dragging fast. GPU completion and presentation/scheduler pacing remain.

### Three priorities and the one shipped cleanup

1. **Grain / Film finish:** 22.08 ms per live picture, 251 ms for the settled
   Fit return, 1.308 s cumulative at 50%. Proposal: reuse coordinate-only
   hash/noise work across edits with unchanged geometry/seed, retaining the
   exact signal-dependent arithmetic, sample positions and existing memory
   budget. Engineering estimate, not measured: 5–10 ms off a live picture
   (~10–20% of the observed ~55 ms cadence if presentation pacing allows it),
   50–125 ms off a single settled Fit wait when that geometry's cache is warm;
   no cold-cache gain is claimed. Needs byte-exact qualification;
   not implemented and no reduced finished sample count is proposed as a fix.
2. **Source preparation / stale scale work:** the 50% viewport waits 3.353 s
   for source preparation while a preceding whole-frame request continues.
   Proposal: propagate zoom cancellation into stale whole-frame decode/upload
   and prioritize the demanded viewport, reusing only correctly keyed source
   slots within existing budgets. Plausible whole-wait saving 0.3–1.5 s in
   this cold-return case, not a measured promise; source identity and fallback
   make this too risky for this patch.
3. **CPU histogram allocations:** 14.5–89.2 ms per build. Shipped: one
   per-call four-double scratch buffer replaces per-pixel RGB/spread/map
   arrays and channel callbacks; all operation order, sampling, bins, stats
   and output values stay exact. No retained cache, texture or budget grows.

The actual 256×384 settled DSC01287 scope buffer is run through old and new
implementations in the same Electron renderer, warmed three times, then nine
interleaved pairs of two calls. Median CPU build falls **29.85→16.35 ms
(−45.2%, 13.50 ms saved)**; complete payload JSON matches exactly. Another
108 full-object cases and the committed 16-case numerical golden test cover
HDR/SDR, full/cropped histogram/waveform and vectorscope behavior.

For a single build on the critical path, the demonstrated gain is ~14 ms,
about 1% of the ~1.2 s release wait; it does not promise a dragging/zoom
speedup. Profile before/after wall samples are recorded but are not controlled
enough to attribute: 100% .997→.728 s, 50% 4.827→2.972 s, Fit 1.758→.406 s,
while Fit drag release-to-last-exact worsens .283→.723 s. Different background
work and input cadence dominate those samples. The old-scope paired application
profile was blocked by the startup error, so **no whole-app gain is claimed**.

Evidence (local, ignored output): `codebase/output/performance/grain-ab/`:
`summary.json`, A1–A7/B1–B7 JSON/logs, startup-failure records, `stages.json`,
`stage-summary.json`, `scope-before.json` (failed), `scope-after.json` (includes
the exact-output paired benchmark), and `cadence.json`. Reproduction and timing
definitions: `codebase/tests/performance/README.md`. `zoom-comparison.html`
shows all seven first-100% pairs rather than hiding their variation.

### Validation and boundaries

- Final Node: **1108 passed, one skipped**. Initial inventory failure was
  fixed by registering the diagnostic helper, not excluding or weakening the
  inventory check. `fast-node-final.log`.
- Final Python: **3894 passed, 144 skipped, one existing xpass**; one existing
  Starlette deprecation warning. Two initial failures pinned the old function
  signature/array syntax. They now execute the frontend and compare actual
  HDR/SDR histogram bins, normalization, waveform grids, peaks and clipping to
  the CPU. A new exact-double matrix fingerprint retains the coefficient
  guarantee independently of source wording. No tolerance was relaxed.
  `fast-python-final.log`, `scopes-python-focused.log`.
- `grain-sampling.js`: all **36** frozen settled/export fields and existing
  one-sample drafts byte-identical; native bypass exact. `grain-sampling.log`.
- `tiled-film-parity.js`: direct/tiled and cross-tile-size grain/vignette
  comparisons exact, including zero differing bytes in the view-map case;
  bounded batches and one presentation copy pass. `tiled-film-parity.log`.
- `gpu-delivery-smoke.js`: GPU/CPU finished-render agreement passes: HDR
  mean/p99.9 ΔE ITP .0335/.0765; SDR mean/p99.9 ΔE 2000 .0193/.0588. Denoise
  delivery guards and watermarked full-Proof/export file hashes pass on both
  renderers. Each encoding's own-source fidelity passes. The separately
  reported decoded-pair HDR diagnostic has p99.9 3.377; it is not the
  finished-render agreement gate and is not hidden or relaxed.
  `gpu-delivery-smoke.log`.
- Default 90-second plain-Electron Library check: **9/9 requested viewport
  pictures**, no errors or memory violation; independent app peak **3.190 GB**.
  This is not whole-folder qualification (nine of 33 eligible photos are
  pictured). `quick-library.log`.
- Reusable DSC01287 source/sidecar hashes remain exact after all checks; the
  Desktop originals were not modified. Final scratch **14.5 GB**, below
  100 GB; the disposable candidate source was removed. No other worker's
  process was killed, no budget/gate changed, and no push was made.

## November 16: grain sample-count investigation and draft-only routing

**Decision pending Steve's crop review. Settled previews, Proof and export
keep their existing sample placement, count and arithmetic.** The new central
setting is `HDRWebGPUShaders.GRAIN_SAMPLE_COUNTS` (`draft: 1`, `settled: 16`).
These are caps, not forced counts: the existing settled rule is
`min(4, ceil(1 / sourcePixelScale))²`, with the existing single centre sample
at 100%. For these two photos that means 16 at Fit 1024, four at Fit 4096
and 50%, and one at 100%/native export.

### What was measured

MacBook Neo / Apple A18 Pro / 8 GB, Electron window 1408×794, shared GPU
lock, no concurrent own test suite. Two real RAWs: the reusable investigation
copy of DSC01287 and curated DSC00264. Neither RAW nor sidecar was saved.
64 groups cover both photos, both HDR/SDR lanes, Fit 1024/4096, 50%/100%,
and four settings: saved Ektar baseline Amount 19.46 / Size 19.60, strong
Amount 80 / Size 19.60, fine 80 / 0, coarse 80 / 100. Chroma is 40,
colour-negative 35 mm. “Default” in the evidence means that saved baseline,
not factory grain-off defaults (Amount 0 / Size 50).

This is an **isolated production grain-field experiment**, not the whole
Film/export chain: real-photo linear pixels are explicitly tone-mapped to
`linear / (1 + linear)`; HDR uses twice that base in ACEScg. The production
grain function acts on this base. GPU timestamps cover the full Fit frame
or a 1024×1024 zoom viewport; quality covers the central 256×256 display
pixels, without enlarging or rescaling the crops. One warm-up and two timed
draws per group/count; the table pools those timings by median. This is a
bounded diagnostic, not a new acceptance gate or cross-machine benchmark.

Colour differences are after Gaussian blur, sigma 0.75 display pixel:
HDR ΔE ITP and SDR ΔE00, using the app's finished-colour comparison.
RMS is measured per linear channel on grain-on minus grain-off. Power is
the 32-bin radial average of the windowed, mean-removed noise spectrum;
the table reports its relative L1 distance from the reference. Full channel
RMS, spectra and high-frequency ratios remain in `results.json`.
The 16-cap benchmark was byte-equal to the production default in every group.

### Fit 1024: cost and worst quality differences

Colour columns are the worst mean / P99.9 across the two photos and four
settings in each lane. RMS range includes every channel and both lanes.
Power distance 0.369 means 36.9%, not 0.369%.

| Sample cap | GPU ms/frame | HDR ΔE ITP mean / P99.9 | SDR ΔE00 mean / P99.9 | RMS/reference range | Worst power distance |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 19.3 | .829 / 3.055 | .127 / .812 | 1.423–3.921 | 12.004 |
| 2 | 38.5 | .597 / 2.307 | .092 / .623 | 1.244–2.770 | 6.382 |
| 4 | 78.1 | .432 / 1.697 | .066 / .449 | 1.055–1.989 | 2.522 |
| 6 | 121.4 | .352 / 1.381 | .053 / .367 | 1.033–1.639 | 1.340 |
| 8 | 164.2 | .296 / 1.166 | .045 / .293 | 1.025–1.416 | .878 |
| 12 | 246.1 | .193 / .750 | .029 / .194 | 1.006–1.154 | .369 |
| 16, current | 326.1 | 0 / 0 | 0 / 0 | 1–1 | 0 |

### Larger display scales

Counts at or above the existing count produce the same pixels. Differences
among their timings are not extra samples or a speed claim. Full timings
for all seven caps at every scale are in `results.json`.

| Scale / cap | Effective samples | GPU ms/frame | HDR mean / P99.9 | SDR mean / P99.9 | RMS/reference range | Worst power distance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fit 4096 / 1 | 1 | 335.4 | .556 / 2.128 | .079 / .426 | 1.021–1.633 | 1.192 |
| Fit 4096 / 2 | 2 | 626.5 | .337 / 1.357 | .048 / .271 | 1.014–1.273 | .446 |
| Fit 4096 / 4 | 4 | 1254.5 | 0 / 0 | 0 / 0 | 1–1 | 0 |
| Fit 4096 / 6, 8, 12, 16 | 4 | 1259.5, 1303.2, 1283.9, 1304.4 | 0 / 0 | 0 / 0 | 1–1 | 0 |
| 50% / 1 | 1 | 26.9 | .573 / 2.159 | .082 / .485 | 1.029–1.658 | 1.249 |
| 50% / 2 | 2 | 54.3 | .344 / 1.412 | .049 / .305 | 1.015–1.283 | .465 |
| 50% / 4 | 4 | 118.4 | 0 / 0 | 0 / 0 | 1–1 | 0 |
| 50% / 6, 8, 12, 16 | 4 | 121.4, 123.1, 119.2, 118.8 | 0 / 0 | 0 / 0 | 1–1 | 0 |
| 100% / every cap | 1 | 24.5–26.6 | 0 / 0 | 0 / 0 | 1–1 | 0 |

**Recommendation:** one sample for temporary drafts only. Keep the current
scale-dependent rule for settled/Proof/export until Steve decides. If he
wants a cheaper small-Fit final, review 12 first: about 25% less isolated
grain time than 16, versus about 50% for eight, but up to 15.4% more RMS
grain and a 36.9% power-spectrum change. Eight reaches 41.6% more RMS; blur
colour alone wrongly makes it look harmless. There is no universal
“indistinguishable” knee: 12 is the conservative review candidate, not an
approved final count. Keep four at 4K/50%, one native, and the old rule at
other scales until those scales are separately qualified.

A smarter **unshipped CPU prototype** scales the single-sample noise to
match reference variance, calibrated on DSC01287 and tested without refitting
on DSC00264. At Fit 1024 HDR, held-out RMS ratios are .965–1.055; power
distance .204–.315; worst colour mean .470 / P99.9 1.778. The calibrated
gains for baseline/strong/fine/coarse are .326/.321/.260/.677. This preserves
texture energy much better than raw one-sample grain, but changes individual
grain positions. No GPU time was measured for this extra blend, and it is
not production prefiltering. A GPU implementation and full-chain HDR/SDR
qualification remain necessary before using it for finals.

### Draft implementation and whole-wait measurements

Direct interactive sliders already used one sample before this change.
The implementation now also honours existing `coarse` requests, including
tiled drafts, and keeps draft tiles separate from exact tiles. Approximate
peaks cannot become exact scope anchors. Delivery and measurement always
bypass the cheaper route; ordinary settled pan/catch-up stays exact.

Same DSC01287 saved grade/window/preferences before and after, three drags
per slider. FPS counts current GPU-completed frames before release;
settle is release to the final current GPU-completed frame. Timings keep
the existing ±10% noise band, not a newly relaxed gate.

| Whole-wait action | Before | After |
| --- | --- | --- |
| Fit Exposure drag FPS | 19.3, 19.6, 17.8 | 17.7, 18.3, 18.0 |
| Fit Whites drag FPS | 15.2, 16.4, 17.2 | 12.7, 16.8, 18.2 |
| Exposure release settle ms | 270, 1083, 993 | 283, 1165, 1279 |
| Whites release settle ms | 1804, 290, 1112 | 2234, 292, 1287 |
| First 50% zoom: first / final ms | 2552 / 4119 | 3095 / 3095 |
| 100% zoom: first / final ms | 718 / 1336 | 2455 / 3206 |
| Return 50%: first / final ms | 1361 / 2412 | 1549 / 2765 |
| Return Fit: completed ms | 304 | 332 |
| Warm 100%: first / final ms | 522 / 1055 | 697 / 1312 |
| Final Fit: completed ms | 328 | 345 |

**No normal-interaction speed-up demonstrated.** All measured zoom/pan
frames were exact, `coarse=false`; therefore the newly connected coarse
route was not exercised by those gestures. Median drag FPS 17.49→17.87 is
noise, while median settle 1038→1222 ms and some zooms were slower outside
the noise band. No cause is established; Steve should try the app before
another timing investigation. The isolated 16→1 grain reduction is about
94%, but it is not a measured whole-app gain from this patch. In particular,
this does not solve the existing .3–1.9 s settle wait or prove faster zoom.

### Review files and qualification

All review files live under this permitted scratch folder:
`/Users/stevenfuncke/HDR Finisher Tool/ai/codebase/output/performance/grain-samples/`.
`crop-paths.txt` lists all 192 absolute crop paths. Same-region SDR sheets
are left 16, centre 12, right eight. Extra sheets show 16 / raw draft one /
variance-matched prototype one. HDR files are separate 16-bit Rec.2020/PQ
PNG pairs with cICP tags, plus 12-bit 4:4:4 AVIFs (extra 12-bit rounding).
HDR-to-PQ uses the app's scene-linear authoring-white conversion. HDR-lane
SDR sheets are normalized viewing aids, not HDR renditions.

Representative filenames in that folder:

- `DSC01287-fit1024-strong-sdr-16-12-8-sdr.png`
- `DSC00264-fit1024-strong-sdr-16-12-8-sdr.png`
- `DSC01287-fit1024-default-hdr-{16,12,8}-pq.avif` (and `.png`)
- `DSC00264-fit1024-default-hdr-{16,12,8}-pq.avif` (and `.png`)

Reviewed SDR sheets show the extra raw one-sample noise, without obvious
moiré in those regions. The high-frequency spectrum ratios are aliasing
diagnostics, not proof of no moiré. Fine/coarse crops and full-chain HDR
visual sign-off remain open; two photos do not establish every-scene safety.

Library viewport smoke pictured 9/9 requested images, first .6 s, but **failed
the unchanged system-reserve guard**: available RAM 1.737 GB versus the
2.000 GB minimum. Independent app-tree peak was 3.238 GB; no app-ceiling
excess was recorded. The cause is not attributed to this change, and the
check was not rerun or loosened. Evidence:
`codebase/output/quick-library-check/grain-draft/report.json`.

Focused checks: 36 frozen-reference settled/draft shader cases byte-exact;
12 GPU-preview/CPU-export grain agreement cases pass unchanged limits;
tiled Film/grain parity byte-exact. Fast Node: 1103 pass, one skip; Python:
3894 pass, 144 skip, one xpass. Evidence: `results.json`, `measurements.json`,
`shader-regression.json`, `before.json`, `after.json` and test logs in the
same scratch folder. The input planes and half-float captures were removed
after analysis. No quality gate, tolerance, memory budget or protected file
changed. No full release or encoded-delivery matrix is claimed here.
Final scratch check: 14.2 GB total, below the unchanged 100 GB limit.

## November 16: DSC01287 preview scheduling fixes

Same MacBook Neo / A18 Pro / 8 GB, 1408×794 / DPR 2, default 4 GB and
unchanged saved grade as the investigation below. Production baseline
`ad829254`; final scheduling changes in this commit. No shader, pixel maths,
quality setting, cache allowance or memory limit changes. Timing band ±10%.

| Whole action-to-picture wait | Before | After | Conditions / result |
| --- | --- | --- | --- |
| 100% zoom interrupts an already submitted 50% catch-up: first refined viewport | Median 2.174 s; empirical p95 2.592 s | Median .502 s; p95 .768 s | Three controlled pairs; 77% less median wait. Same source, grade, shaders and budgets; before restores only former scheduling methods from `ad829254` in the disposable renderer. Catch-up must have submitted **rendering**, not just a source upload. |
| Same action, final visible viewport | Median 2.639 s; p95 2.707 s; range 1.900–2.714 s | Median .883 s; p95 1.240 s; range .880–1.279 s | **67% less median whole wait.** GPU-completion fence + animation frame, still-current serial. All six 320×200 final screenshots have identical SHA-256 `d7285b3d…356858`. This is visible-crop regression evidence, not full export qualification. |
| Ordinary 100% zooms in the full interaction run | Final 3.482 / 2.878 s | 1.126 / 1.025 s | Same real RAW and native control sequence. 50% is mixed: first 3.144→3.320 s, warm return .746→2.259 s. Previously completed offscreen work can make an old cached return faster; no blanket all-zoom gain. |
| First 4096-tier exposure adjustment after tier preparation | 23.840 s; 26 presentations of the **same** edit generation | 1.666 s, two presentations | One causal before/after observation; watchdog mistook a submitted frame waiting on its device fence for idle/lost work. Does not set a new speed target or prove a common first-tier time. |
| Warm 4096-tier exposure edits | 1.844–1.855 s | 1.718–1.728 s | Two samples each, within 10%; ordinary exact grain cost remains. `tiers-native.json` / `tiers-final.json`; first exploratory `probe-native.json` 4096 captures were not reliably settled and are excluded. |
| Native Fit drag feedback/cadence | Exposure first-input feedback 66–82 ms; Whites 59–100 ms. Median/p95 completed-frame gaps: Exposure 49.7/76.8 ms; Whites 56.1/68.0 ms | No large Fit gain claimed | Three native drags each. Before displayed throughput Exposure 18.6–18.8/s, Whites 14.6–17.1/s. Final exact/Peak Fit can still take roughly .3–1.9 s after release. Scope-only A/B did not reliably improve waits; its obsolete startup CPU scope goes from ~37 s of discarded work to no request. |
| Same grade on quarter-pixel-count image | Native RAW 5320×7968, 42.39 MP: fixed 2048 edge final 1.558–1.600 s | 2660×3984, 10.60 MP EXR derivative: .467–.495 s | Controlled same-photo area downsample, lens/reconstruction baked before reduction, identical creative grade. At the same preview dimensions native grain uses 16 samples, derivative uses 4; this is not a RAW-decode or EXR-import speed comparison. Fit still uses 16 on both, so cost does not simply follow source megapixels. |
| Fixed 1024 edge, full grade versus grain off | Final .405–.571 s; median GPU timestamp 337 ms | Grain off .054–.084 s; GPU 13.5 ms | Three warm changes; halation off GPU 327 ms, neutral Detail off 332 ms. Stock-off bypass also removes Film/grain and does not isolate stock maths. Grain-off is diagnostic only, never a shipped look. |
| Native final grade versus grain-off diagnostic, zoom | 50% 1.850 s; 100% 1.330 s | .300 / .552 s | One observation each, differing cache warmth. Upper-bound evidence for a future preview-quality decision, not promised savings from a particular approximation. |
| RAW import toggles | Lens off re-development 8.28 s; reconstruction off 11.67 s; restore 13.25 s | Interactive exposure still .35–2.10 s across those sessions | Diagnostic individual re-developments, not controlled opening-speed comparisons. Development/remap happen on import/settings changes, not per slider/zoom. RAW and copied sidecar hashes remain exact. |

The whole-frame catch-up formerly queued up to 176 tiles / 73.4 MP including
halos behind the visible region. It now has background priority, yields after
one existing four-tile batch, and is cancelled immediately by a new zoom/pan.
Old-scale timers cannot dispatch into the new scale. Idle catch-up still
finishes the same tiles, preserving exact offscreen coverage. The watchdog now
recognises queued/device-fenced scheduler work; genuinely orphaned work still
re-arms. GPU scopes defer until the first picture and cancel older CPU scopes.

At Fit the active Film grain visits three dye layers and up to 16 subpixel
samples. At 50% it uses four, at native 100% one; zooming out is not necessarily
cheaper. Source proxies are reused during ordinary edits. Zoom requests bounded
regions; halation is quarter-grid/halo work, not a full-native blur redone per
tile. Peak Fit and whole-picture scopes can run additional bounded measurements
and redraws. No new grain cache or budget is proposed here.

Memory: OS charged-tree samples reach 4.23 GB before, 4.36 GB in the scope-only
run, ~4.03 GB in the final full interaction run; one-second sampling is not a
strict peak qualification. macOS pressure remains normal (level 1); existing
swap is ~1.69 GiB before and ~2.08 GiB after intervening suites/fixture work.
This does not establish swap caused by the 4 GB default. No budget was raised.
Steve's real preferences were read-only: Auto resolution/rendering, Faster
dragging off, automatic memory setting, matching the primary reproduction.

Evidence: `codebase/output/performance/stacked-raw/{before-fenced,after,final,
race-before,race-after,tiers-native,tiers-final,probe-native,probe-half,raw,
ablate,profile}.json`, corresponding backend logs and six small race crops.
The source derivative is disposable and removed after qualification. Preliminary
race probes that caught upload instead of rendering were overwritten; a run
whose opening overlapped the Node suite was replaced by the quiet final A/B.
Final qualification on implementation `d26ed3ed` plus the portable zoom-driver
window: grain parity 12/12, byte-exact tiled Film, tiled-admission CPU-scope
fallback, Retina preview-resolution/settings and native zoom-stall recovery all
pass. The old resolution check initially assumed one CSS pixel per source
pixel; it now checks the existing physical-display-pixel contract with the
same one-pixel guard, and passes. No rendering or tolerance change was needed.

| Qualification action | Observation | Conditions / evidence |
| --- | --- | --- |
| Normal zoom/local burst / deliberately orphaned native preview | .509 s, no re-arm / 1.511 s, one re-arm | Same Neo/window/lock, generated 7968×5320 input; watchdog-off control stays stalled for 6.047 s. `output/stacked-raw-zoom-gpu.log`. Recovery is preserved; no output-quality or new timing gate. |
| Default Library viewport smoke | First .4 s; 9/9 requested pictured; independent peak 2.367 GB; harness 92.937 s | Neo / 1408×794 / 4 GB default, frozen v1, plain Electron, no concurrent own fast suite. No errors, reserve or app-memory violations. The 24 unvisited pictures do not count as whole-folder qualification. `output/quick-library-check/stacked-raw/report.json`. |
| Final fast suites | Node 1101 pass / 1 skip, 12.26 s; Python 3894 pass / 144 skips / one existing xpass, 268.50 s | Same Neo, run after all GPU work; `output/stacked-raw-{node,python}-qualified.log`. No failures. Suite duration is not product latency. |

Source/sidecar SHA-256 guards match both the reusable copy and Steve's untouched
originals. Generated half-size EXR/sidecar and the task-created synthetic zoom
TIFF were removed; one reusable RAW/grade copy remains. Scratch is **14.1 GB**
(start 13.7), below 100 GB. Only linked numeric reports/logs and six small race
crops remain. The crops and `output/performance/stacked-raw/summary.html` can
be deleted after review. No release sweep, push or installer build was run.

**Decision left for Steve:** any further grain approximation during zoom/pan
would change draft pixels and needs his approval. The grain-off measurements
bound potential benefit but do not predict a particular new method. Keep
settled preview/export agreement and current budgets; no such change is built.

## November 25, 2026 — Grade shared-memory admission and Scan Sharpening strips

Grade shared-memory admission (`3757b324`), MacBook Neo, 42 MP Sony, Clean
Grain Small at 110%: first sharp picture 4.01 s, wide pan 0.78 s, sampled
app peak 2.485 GB against the 4 GB ceiling. Partial replay only: neither
Electron replay completed (one expected Standard when the app defaulted to
Clean Grain; the other stopped on a separate 640 px Library preparation), so
the full replay peak is unverified.

Scan Sharpening strip halo (`101d532d`), MacBook Neo, 1600 px DSC00264
ceiling fixture: single export requests across three codecs took
1.94–7.63 s on the GPU and 1.98–12.39 s on the CPU. Ceiling and full-size
Proof identity passed. A 42.4 MP RAW exported to CPU JPEG Ultra HDR at
native size and 4000 px with export and Proof byte-identical, peaking at
3.16 GB across backend and encoder helpers (4 GB limit). No speed
comparison.

## November 24, 2026 — Clean Grain zoom and Fit on the Windows PC

DSC09738.ARW, HDR saved grade, Clean Grain Small, both colour passes on,
display-selected resolution, 2560×1440 Electron under the shared GPU lock.
The baseline used the `b3cd5f21` frontend on the same PC. The updated runs
used `perf/clean-grain-zoom`. These are short action-to-settled-view
samples. Treat differences within 10% as timing
variation because source reads and GPU scheduling vary between runs.

| Action | Before | After |
| --- | ---: | ---: |
| Open the saved grade at Fit | 23.76 s | 23.20–23.74 s on focused colour runs, 30.01 s while fast checks ran |
| Re-enable a warm Fit result | 64 ms | 65–72 ms |
| Fit to 60.6%, exact view | 6.21 s | 2.74–2.75 s |
| 60.6% to 100% | 3.48 s | Already sharp inside the previous native region. 0.74–0.80 s including capture and idle wait |
| First pan to an uncovered region at 100% | 1.13 s | 1.46–1.50 s |
| Pan back into a held region | 1.01 s | 4–6 ms through the input handler, without another draw |
| Return to Fit | 2.46 s | 0.13 s |

The earlier Fit calibration in the PC logs was 2.4–3.3 s. A cold spot check
of the new calibration took 1.98 s over 22 chunks, with 1.92 s cumulative
fetch and upload and 78 ms waiting on GPU validation and final readback.
These stages overlap. At zero evenness, the app skipped the fit. Raising
evenness ran it again or reused the matching fit. The first pan into
uncovered territory needs another draw, so it remains slower in this sample.

## November 24, 2026 — Sony Micro Grain Exposure after a memory trim

MacBook Neo (A18 Pro, 8 GB), unpackaged Electron at 1408 × 794 points under
the shared GPU lock. One warm Exposure edit per cell on Sony
`_DSC7970.ARW` in HDR Grade. The second edit followed a requested moderate
CPU and GPU cache trim in the same short session. Times are from committing
Exposure to the first exact picture. The check used a 20% band for
single-run timing noise.

| Lens and zoom | Warm | After trim | Route |
| --- | ---: | ---: | --- |
| Off, Fit | 0.090 s | 0.079 s | GPU Direct |
| Off, 31% | 0.716 s | 0.705 s | GPU Tiled |
| Auto, Fit | 0.277 s | 0.216 s | CPU cache hit for both edits |
| Auto, 31% | 0.817 s | 25.403 s | CPU cache hit, then a 24.628 s Micro rebuild |

The cold Fit enable with Lens Off produced two HDR GPU presentations. Warm
Lens Off Exposure edits produced one or two. Lens Auto used the CPU because
the active lens profile is unsupported by GPU Micro Grain.

The Auto 31% timing exposed a remaining priority error in the checked build.
The histogram used a smaller cached source after the visible preview
finished, so periodic cleanup kept that smaller result in place of the
31% source. The follow-up regression test reproduces that sequence and
passes once foreground reads alone set eviction priority. The timing above
predates that follow-up and covers a short session with a requested trim.

### November 24 re-check after the histogram and comparison cache fixes

MacBook Neo (A18 Pro, 8 GB), unpackaged Electron at 1408 × 794 points under
the shared GPU lock, on the cache follow-up based on `3d90d674`. Sony
`_DSC7970.ARW` in HDR Grade with Micro Grain. Each value is one Exposure
commit to the first exact picture after that edit. Each lens setting used
its own app session, with a warm edit followed by an edit after a requested
moderate CPU and GPU trim. Processing edges were 1285 px at Fit and 2817 px
at 31%. The comparison uses the same 20% single-run timing band.

| Lens and zoom | Warm | After trim | Route |
| --- | ---: | ---: | --- |
| Off, Fit | 0.071 s | 0.097 s | GPU Direct |
| Off, 31% | 0.381 s | 0.085 s | GPU Tiled |
| Auto, Fit | 0.226 s | 0.206 s | CPU cache hit for both edits |
| Auto, 31% | 0.684 s | 0.862 s | CPU cache hit for both edits |

At Auto 31%, the post-trim edit fell from 25.403 s to 0.862 s. The backend
logged a 0.02 ms lookup of the 2817 px Micro source for that edit.

## November 24, 2026 — Grade local masks at 100%

MacBook Neo (A18 Pro, 8 GB), Electron at 1408 × 794 points and 2× under
the shared GPU lock. One run per case, Lens Auto, HDR Grade. Times are to
the first exact current picture and fresh settled Histogram. Memory is a
one-second process-tree physical-footprint sample in decimal GB, not a
hardware peak. The test-only EXIF pause shim let Grade start on a host with
exhausted POSIX semaphores; production memory and processing limits did not change.

| 100% action | Exact picture / Histogram before → after | Sampled peak app memory before → after |
| --- | --- | ---: |
| Sony `_DSC7970.ARW`, 12 locals, enable | Neither by 60.7 s → 16.68 / 18.49 s | 9.11 → 5.41 GB |
| Canon `IMG_3129.CR2`, 12 locals, enable | 17.34 / 19.11 s → 7.84 / 10.08 s | 7.06 → 5.97 GB |
| Canon `IMG_0790.CR2`, 12 locals, edit/release | 10.8–17.6 s picture → 7.55 / 10.39 s | — → 5.77 GB |
| Sony `_DSC7970.ARW`, Hue, enable | — → 0.80 / 1.94 s | — → 1.53 GB |
| Canon `IMG_3129.CR2`, Hue, enable | 1.32 / 2.04 s on fresh launch → 1.07 / 1.84 s | 1.91 → 2.26 GB |

Sony Overlap went from 55 mask-batch and 47 source-stream memory refusals to
zero. Wide Luma feathering still needs the entire 323 MiB source on that
viewport: it arrives via bounded tile requests once, rather than repeated
whole-frame streams. The Hue-only picture source is 41.6 MiB on both photos
(Canon was 138.3 MiB). A previous pressured Canon Hue run recorded 61 source
refusals. There were no 507s in the after sweep, including at Fit and 31%.
Cold Overlap at Fit took 0.26–0.34 s picture / 0.64–2.85 s Histogram; at 31%
it still took 10.36–14.76 s picture / 11.39–15.26 s Histogram. Cold Hue at
Fit and 31% stayed under 0.38 s picture / 0.58 s Histogram.

The Canon native Overlap enable went from 216 logical mask tiles and 12 batch
requests to 144 tiles and 3 requests. Identical local mask definitions share
one result. Bounded batches send one region when the overlapping tile halos
fit, and can reuse it for contained requests with the same mask, source and
geometry. The first version still fetched three batches on a same-viewport
rerender. The review fixes retain the presented tiles under opportunistic
memory reclaim, carry the source epoch through every upload route, and keep
background Histogram masks from cancelling foreground masks.

| 12 locals at 100%, reviewed build | Enable picture | Exposure edit picture | Pan to exact viewport |
| --- | ---: | ---: | ---: |
| Sony `_DSC7970.ARW` | 17.87 s | 15.48 s | 15.26 s |
| Canon `IMG_3129.CR2` | 8.96 s | 8.14 s | 7.43 s |

Both Exposure edits reused 54 of 54 CPU-backed tile placements and sent no
mask POSTs. Each pan reused 30 of 54 and sent three successful batches for
newly visible tiles. These single-run timings overlapped the fast test suites;
the counters exclude separate GPU-only masks. The Sony did not get well under
the original 16.7 s cold reference: 14.78 s of its Exposure render was in the
tiled picture stage despite zero CPU mask misses.
Three Local Clarity layers at 2.75% radius still make every tile pay a 626 px
detail halo on the Canon and 994 px on the Sony. The Canon still processes
about 55 million pixels for an 18 MP frame. Separating those local map
pre-passes, as for Global Clarity, requires preserving the input from preceding
locals.

The earlier nine-patch Overlap check changed the source route, not the mask
route. The new check compared every RGBA sample in the 2054 × 858 far-corner
viewport on `IMG_0790.CR2` (5202 × 3464), including tile joins, the right and
bottom edges, and a sharp path at high coordinates. Four shared mask regions
matched 72 legacy whole-image mask tile responses with zero differing samples
out of 7,049,328. The old endpoint refused with 507 on this host; only the
reference run bypassed its admission gate and serialized the GETs. Mask
arithmetic was unchanged. GPU Luma stayed on the same route on both sides.
At the opposite corner, the Hue and Local Clarity viewport with Black & White
matched both the five-band whole-source and single-band references with the
four-pixel guide active. The far-corner Hue and Local Clarity crop also matched
the whole Hue mask on the same full source, with no differing samples in either
viewport. The right edge is off the four-pixel grid; the bottom edge is on it.
The automated crop test also checks an off-grid bottom edge. These are preview
checks, not whole-image export parity.

With the unused Local Clarity passes pruned, both v4 Sony runs at 100% kept
the same reuse as v3: Exposure reused all 54 placements with no mask requests
(7.51–7.91 s picture vs 8.09 s); pan reused 30 of 54 with three requests
(7.68–8.41 s vs 8.24 s). Panning stopped an intentionally held CPU Histogram
fallback in 2–14 ms and the replacement reached Settled. Clean Grain with
12 locals stayed on GPU and delivered the picture in 22.95–23.87 s.

Masks v6 reuses one offscreen render target for robust Highlight Anchor
measurements. On the same MacBook Neo at 100%, Gradient + Hue, Hue intersected
with unfeathered Luma, and Hue combined with an unfeathered Brush stayed in
the viewport on both Sony and Canon. All six 2054 × 858 viewports matched the
whole-frame GPU route exactly, including the frame edges and tile joins
(42,295,968 RGBA samples; no differences). These are preview checks. Compound
Hue with feathered Luma keeps the whole-source route: the bounded GPU result
did not match it on the 42 MP Sony.

Sony showed the picture in 0.61–0.77 s, compared with 4.59–4.85 s when the
whole frame was forced; Canon took 0.68–0.87 s versus 2.16–2.34 s. Sony
Clean Grain with Gradient + Hue settled at 100% in 9.18 s picture / 10.04 s
Histogram, with no HTTP 507s; v5 timed out after two memory refusals.

[Compound Hue viewport comparison](../../codebase/output/grade-sweep/batch6-masks-v6-parity.json) ·
[Sony Clean Grain reproduction](../../codebase/output/grade-sweep/batch6-masks-v6-grain.json)

[Sony baseline](../../codebase/output/grade-sweep/sony-overlap-alone.json) ·
[Canon baseline](../../codebase/output/grade-sweep/canon3129-native-fill.json) ·
[After sweep](../../codebase/output/grade-sweep/batch6-masks-exact.json) ·
[Reviewed reuse](../../codebase/output/grade-sweep/batch6-masks-v2-reuse-fixed.json) ·
[Full-viewport legacy comparison](../../codebase/output/grade-sweep/batch6-masks-v2-parity.json) ·
[Hue crop and band comparisons](../../codebase/output/grade-sweep/batch6-masks-v2-hue-edges.json)

## November 24, 2026 — Skip unused packed bands for Local Clarity

MacBook Neo (A18 Pro, 8 GB), Electron at 1408 × 794 points and 2×, HDR Grade,
Lens Auto, shared GPU lock. One before/after sample per action. At 100%, the
12-local stack has three Clarity layers at +45 and 2.75% radius, with no local
Texture or Sharpen. Times are seconds to the exact picture / fresh Histogram;
panning keeps the same Histogram, so no fresh Histogram is expected.

| Action | Sony `_DSC7970.ARW` (42 MP) | Canon `IMG_3129.CR2` (18 MP) |
| --- | ---: | ---: |
| Enable 12 locals at 100% | 17.09 / 19.99 → 9.66 / 13.61 | 8.42 / 10.65 → 6.10 / 7.79 |
| Exposure 0 → +0.55 at 100% | 15.51 / 18.59 → 8.67 / 12.08 | 7.57 / 10.09 → 5.31 / 7.14 |
| Pan to exact viewport at 100% | 15.14 → 9.62 | 7.06 → 4.84 |
| Enable a single Clarity local at 100% | 3.12 / 5.89 → 1.30 / 2.06 | 1.98 / 2.68 → 1.17 / 1.83 |
| Exposure edit at Fit, same stack | 0.287 / 2.50 → 0.284 / 2.35 | 0.279 / 3.06 → 0.304 / 2.00 |

The 18 foreground tiles for Exposure skipped 108 packed Texture/Sharpen draws
and 54 tile-cache copies on each RAW. The tiled picture stage fell from 14.81
to 8.01 s on Sony and 7.26 to 5.06 s on Canon; neither the tile apron nor the
Clarity algorithm changed. All six visible RGBA16F buffers matched byte for
byte (centered and lower-right at 100%, entire Fit frame, each RAW), with
identical measured peaks on both 100% Exposure edits. Sony's three tested
actions reached the sub-10-second picture target, so suffix cropping and
shared native Clarity maps were not implemented. The Histogram still takes
12.08 s on Sony after the Exposure edit.

GPU timestamps from five foreground Exposure batches, in seconds, before →
after. Metal overlaps passes, so each row assigns the gap between consecutive
pass completions; these are not isolated shader times. The matched run with
and without pruning used the same app build and produced the same viewport bytes.

| GPU pass | Sony | Canon |
| --- | ---: | ---: |
| Ordinary local | 0.565 → 0.534 | 0.269 → 0.245 |
| Detail candidate | 0.147 → 0.148 | 0.070 → 0.067 |
| Packed horizontal | 3.474 → 0 | 0.995 → 0 |
| Packed vertical | 3.049 → 0 | 0.879 → 0 |
| Clarity reduce | 0.104 → 0.087 | 0.052 → 0.044 |
| Clarity level | 0.050 → 0.046 | 0.013 → 0.011 |
| Clarity horizontal blur | 0.005 → 0.004 | 0.004 → 0.004 |
| Clarity vertical blur | 0.005 → 0.004 | 0.005 → 0.004 |
| Detail composite | 0.936 → 0.853 | 0.444 → 0.395 |
| Final mask mix | 0.098 → 0.092 | 0.040 → 0.038 |
| Foreground batches, all passes | 8.84 → 2.16 | 2.96 → 0.99 |

The [apron analysis](../../codebase/output/local-clarity-apron/report.md) found
112.50 MP of padded tile area on Sony and 56.01 MP on Canon, against unions of
17.83 and 12.06 MP. Shared ordered maps could reduce repeated work across those
tiles, but this area comparison does not predict time savings or guarantee
matching pixels.

[Before](../../codebase/output/grade-sweep/batch8-before.json) ·
[After](../../codebase/output/grade-sweep/batch8-after.json) ·
[Unmodified GPU baseline](../../codebase/output/grade-sweep/batch8-before-profile.json) ·
[Paired GPU timestamps](../../codebase/output/grade-sweep/batch8-profile-pair.json)

## November 24, 2026 — Film Resolution and Detail blur

MacBook Neo (A18 Pro, 8 GB), Electron at 1408 × 794 points and 2× under
the shared GPU lock. One warm HDR Grade edit per case, from the edit to
the first exact picture. Fit used Direct; 31% and 100% used Tiled.
Image Softness was 80 and Microcontrast −50 in both recipes; Film Resolution
was 0 on Super 8 and 10 on 35 mm. Times are milliseconds, before → after.

| RAW / gate | Fit | 31% | 100% |
| --- | ---: | ---: | ---: |
| `IMG_3129.CR2` (18 MP) / Super 8 | 339 → 252 | 487 → 236 | 1,290 → 350 |
| `_DSC7970.ARW` (42 MP) / Super 8 | 406 → 276 | 1,013 → 300 | 1,467 → 330 |
| `IMG_3129.CR2` / 35 mm | 217 → 249 | 251 → 235 | 305 → 231 |
| `_DSC7970.ARW` / 35 mm | 349 → 311 | 304 → 279 | 452 → 273 |

Super 8 at 100% saved 0.94–1.14 s. Small timing shifts are not conclusive:
neutral controls moved by −46 to +45 ms. The GPU filters across rows and
then columns, sharing full-precision sums without another picture-sized
texture. The blur radius and tile borders are unchanged.

For a separate whole-picture Canon comparison at 1201 px with a custom
1 mm gate, Direct and Tiled finished pixels matched exactly. Against the
old shader, each preview route moved by p99.9 ΔE 0.015 SDR / 0.051 HDR.
GPU delivery, resized and sharpened to 900 × 600 before encoding, moved by
0.010 SDR / 0.030 HDR. All were below the 0.5 review threshold.

On a synthetic image with the same 1 mm gate, finished GPU and CPU delivery
matched within the existing caps (mean / p99.9: SDR 0.010 / 0.046; HDR
0.045 / 0.161). Proof matched the exported Ultra HDR JPEG byte for byte on
both renderers, and its decoded peak was under 1,000 nits. The enforced
preview-versus-export check also passed on a separate 675 × 450 synthetic
fixture with the same recipe: HDR p99 luminance difference was 0.241%, and
every SDR pixel was within one 8-bit level.

[Before timings](../../codebase/output/separable-detail/before.json) ·
[After timings](../../codebase/output/separable-detail/after.json) ·
[Finished-pixel comparison](../../codebase/output/separable-detail/parity.json) ·
[Export checks](../../codebase/output/separable-detail/export-proof.json) ·
[Preview versus export](../../codebase/output/separable-detail/preview-export.json)

## November 24, 2026 — Grade Micro Grain Histogram at zoom

MacBook Neo (A18 Pro, 8 GB), Electron at 1408 × 794 points and 2× under
the shared GPU lock. HDR Grade on the 42 MP Sony `_DSC7970.ARW`, Lens Auto
applied, Micro Grain luminance at 55%. Each row measures one Exposure commit
to its exact picture and to the Histogram outcome, from `787754f2` plus the
working fixes. The probe primes the whole-picture cache through a preview
request; forced evictions are test controls, not automatic app actions.

| Zoom and cache state | Exact picture | Histogram outcome |
| --- | ---: | --- |
| 100%, no whole-picture Micro source | 0.914 s | Unavailable at 0.912 s |
| 100%, whole-picture source warmed, first edit at zoom | 3.173 s | Fresh at 3.246 s |
| 100%, whole-picture and viewport caches warm | 0.912 s | Fresh at 1.001 s |
| 31%, whole-picture source warm | 0.816 s | Fresh at 1.533 s |
| 31%, source evicted before edit | 25.059 s | Fresh at 25.263 s |
| 31%, source evicted between picture and Histogram | 0.811 s | Unavailable at 0.816 s |

Fresh results use a 960 px whole-picture Micro preview, not the zoomed patch.
At 31%, a cold picture itself rebuilt the whole-picture source; the Histogram
reused it. When the source is missing at request time, the Histogram clears,
offers Fit view, and does not start a rebuild. Picture timings include two
paint callbacks; the status can change just before that measurement ends.

The previous Grade sweep used drag/release, so picture times are not a matched
speed comparison: 100% pictures took 0.695–0.844 s but the Histogram was still
Updating at 70 s with no scope request; at 31%, pictures took 0.759–0.804 s and
the old undenoised Histogram appeared idle after 1.98–2.02 s.

[Sweep baseline](../../codebase/output/grade-sweep/sony-micro-fill.json) ·
[Sony cache-case trace](../../codebase/output/overnight/micro-scope-app.json)

The follow-up on the same Sony and window size checked Micro slider changes,
Fit recovery, and Denoise toggles, including with GPU Preview disabled.
Times are from the action to the picture and to the Histogram outcome.

| Action | Exact picture | Histogram outcome |
| --- | ---: | --- |
| 100%, Exposure, cold whole-picture source | 1.166 s | Unavailable at 1.161 s |
| 100%, Exposure, warm whole-picture source | 3.724 s | Settled at 3.839 s |
| 100%, new Micro strength | 4.112 s | Unavailable at 4.239 s |
| Return to Fit after Unavailable | 26.884 s | Settled at 27.150 s |
| Fit, new Micro strength | 25.884 s | Settled at 26.162 s |
| Fit, Denoise off / back on | 0.027 / 28.837 s | Settled at 0.480 / 29.080 s |
| Fit, switch to CPU-only preview | 0.269 s | Settled at 0.368 s |
| Fit, CPU-only Denoise off / back on | 0.297 / 0.378 s | Settled at 0.751 / 0.484 s |

Cold Fit runs spent 25–29 s preparing the picture; the Histogram then reused
its whole-picture Micro source. The Fit strength edit changed the bins, and
warm Micro bins matched across the CPU-only switch and off/on round trip.
The ineligible Edge Colour case passed the API pixel-histogram comparison.
After reopening in GPU mode, a Histogram refresh settled in 33 ms. These
are single-run observations, not speed comparisons.

[Sony review follow-up trace](../../codebase/output/overnight/micro-scope-app-v2.json)

## November 24, 2026 — Exact Mist glow reuse

MacBook Neo (A18 Pro, 8 GB), Electron at 1408 × 794 points and 2× under
the shared GPU lock. Warm IMG_3129.CR2 in HDR Grade at 31% zoom,
1841 × 1229 pixels and twelve 512 px tiles. The reconstructed recipe used
Vision3 250D and 2383, grain 23.616, halation 3.571 at radius 0.347,
and Black Pro-Mist 1/8 at size 1. Timing starts at the control input and
ends at the first exact presentation for that edit. The exploratory timing
tolerance is 20% for window and app activity.

| Action | Before (`787754f2`) | With exact glow reuse |
| --- | ---: | ---: |
| Grain amount edit, median of three | 3.19 s | 1.13 s |
| Mist strength edit, median of three | 3.18 s | 1.14 s |
| First Film Look on | 3.17 s | 3.17 s |

[Before](../../codebase/output/mist-speed/render-path-baseline.json)
· [After](../../codebase/output/mist-speed/render-path-mist-final.json)
· [Parity and memory check](../../codebase/output/mist-speed/final-tiled-parity.log)

Final runs ranged from 1.13–1.16 s for Grain and 1.13–1.25 s for Mist
strength. In a separate six-tile parity check at 1520 px, turning Mist off
released 22.6 MiB of tracked GPU glow textures in each lane (HDR and SDR).
Cached and uncached Grain, Mist strength, halation, and stock edits matched
exactly on both render routes; the HDR check kept Standard Denoise on.

Only exact glow reuse remains. The half- and quarter-resolution trial was
removed: strong Pro-Mist and CineBloom showed ringing and tile joins, the
trial still needed the tile halo, and it disabled exact glow reuse. Delivery
and CPU preview are unchanged. The rejected trial's [comparison crops and
measurements](../../codebase/output/mist-speed/) are retained as evidence.

## November 24, 2026 — Grade Edge colour with no clipped seeds

MacBook Neo (A18 Pro, 8 GB), Electron at 1408 × 794 points and 2× under the
shared GPU lock. One matched enable per photo and build, HDR Grade at 31% zoom,
Lens Auto, clipping threshold 0.98, Expand 0.5%, fresh app profile for each run.
Baseline `787754f2`; after is the same HEAD with the uncommitted Edge colour
change. Peak app memory is the one-second process-tree physical-footprint
sample, not logical GPU memory. The clipped control allows up to 10% regression
in timing or sampled peak memory to account for run-to-run variation.

| RAW | Picture before → after | Settled Histogram before → after | Peak app memory before → after | Edge colour stage before → after |
| --- | ---: | ---: | ---: | ---: |
| `_DSC7970.ARW` (42 MP, no seeds) | 12.11 → 5.50 s | 13.02 → 6.19 s | 6.55 → 1.81 GB | 5.11 s → 29 ms |
| `IMG_0790.CR2` (18 MP, 3.04% seeds) | 5.58 → 5.29 s | 6.01 → 5.89 s | 4.29 → 3.76 GB | 2.43 → 2.64 s |

The Sony skipped the Edge colour GPU handoff and kept the original developed
pixels. Its full RAW development fell from 9.27 to 3.48 s. The Canon still
ran Edge colour on the GPU with the same seed fraction and clip luminance. The
earlier full Grade sweep's Sony result (19.04 s picture, 20.69 s Histogram)
came from a longer session and is not the matched baseline.

[Before trace](../../codebase/output/grade-sweep/edge-before.json) ·
[After trace](../../codebase/output/grade-sweep/edge-after.json)

## November 24, 2026 — Grade geometry at 100% on 42 MP Sony

MacBook Neo (A18 Pro, 8 GB), Electron at 1408 × 794 points and 2× under
the shared GPU lock. `_DSC7970.ARW`, 7968 × 5320 source pixels, Lens Auto,
HDR Grade. The picture clock requires an exact frame for the current edit;
it does not count the previous picture moving. Peak app memory is the
one-second process-tree physical-footprint sample in decimal GB. These
are single-run comparisons with a 15% exploratory timing band, not a
matched benchmark for effects other than geometry.

| Action at 100% | Exact picture / fresh Histogram before → after | HTTP 507s before → after | Sampled peak app memory before → after |
| --- | --- | ---: | ---: |
| Crop enable | Neither by 22 s → 1.61 / 1.79 s | 166 → 0 | 2.86 → 1.88 GB |
| Rotate enable | Neither by 22 s → 1.87 / 4.09 s | 164 → 0 | 3.53 → 3.33 GB |
| Rotate edit/release, warm-1 | Neither by 25 s → 1.57 / 4.12 s | 166 → 0 | 2.08 → 3.27 GB |
| Perspective enable | Neither by 22 s → 2.25 / 4.59 s | 160 → 0 | Not sampled → 2.14 GB |

Rotate's pan after the warm edit went from timing out at 25 s with no
accepted frame to presenting the same, now-current edit in 0.69 s. A pan
does not request another Histogram. The first native pixels for all three
tools came from source tiles, not a native whole-image stream; no processing
tier was reduced. Fit and 31% all reached exact pictures and fresh scopes.
At Fit, Perspective's picture took 0.86 → 1.00 s (just outside the 15% band);
the Histogram was within the band (2.89 → 3.21 s).

With the backend's test memory snapshot reporting 3.25 GiB safely available
(below the old 3.41 GiB estimate), all three 100% enables again accepted the
current generation with zero 507s: Crop 0.88 / 1.11 s, Rotate 2.50 / 4.64 s,
Perspective 1.50 / 3.81 s. Sampled peak across geometry actions in that run
was 2.31 GB. No production memory limit changed.

[Sweep baseline](../../codebase/output/grade-sweep/sony.json) ·
[Rotate baseline](../../codebase/output/grade-sweep/sony-rotate-fill.json) ·
[Fit, 31% and 100%](../../codebase/output/grade-sweep/sony-geometry-bounded.json) ·
[Constrained admission](../../codebase/output/grade-sweep/sony-geometry-headroom.json)

**Review follow-up:** The first frame now replaces the old picture before
measuring the post-edit viewport. A repeat cold sweep gave exact picture /
fresh Histogram of Crop 1.20 / 1.45 s, Rotate 2.42 / 5.28 s, and Perspective
3.69 / 6.86 s, with zero 507s. Crop was faster than the first fix, while
Rotate and Perspective were slower in this single repeat.

In a separate combined-edit run on the same Sony at 100%, exact picture times
(Denoise off / Clean Grain on) were Rotate 4.35 / 11.21 s, large Crop
2.38 / 8.03 s, Perspective 3.16 / 7.44 s, and a fully visible small Crop
0.53 / 0.71 s. Opposite-edge pans settled in 0.61 / 0.79 s. Both lane
round trips, the luminance local, 31%, and small-crop Fit passed with no
natural 507s. An injected 507 during an SDR lane switch recovered in 4.32 s
without a whole-frame CPU retry. These timings are not a matched benchmark.

[Repeat cold sweep](../../codebase/output/grade-sweep/sony-geometry-round2.json) ·
[Combined-edit trace and screenshots](../../codebase/output/overnight/geometry-review/)

**Patch-first follow-up (`787754f2` plus working-tree changes):** The current
sharp tiles now replace the old geometry before the viewer changes size.
A fully visible crop does not need a background image. On an edge pan that
needs one, sharp tiles draw first; the optional softer background then uses the
standard 1600 px source level instead of building a custom level. The first
far pan can briefly show a blank area while the new tiles arrive; it does not
show any of the old geometry at the new position.

| Exact picture at 100% | Round 1, Denoise off | Round 2, off / Clean Grain | Patch-first, off / Clean Grain |
| --- | ---: | ---: | ---: |
| Rotate | 1.87 s | 4.35 / 11.21 s | 0.74 / 7.52 s |
| Large Crop | 1.61 s | 2.38 / 8.03 s | 0.67 / 6.32 s |
| Perspective | 2.25 s | 3.16 / 7.44 s | 0.64 / 6.16 s |
| Small Crop | — | 0.53 / 0.71 s | 0.28 / 0.50 s |

The first far pan with Denoise off presented sharp tiles in 0.70 s. The
opposite-edge Clean Grain pan submitted sharp tiles in 0.93 s; no fresh grain
calibration was recorded for that pan. Both HDR/SDR round trips passed, as did
a Rotate while viewing SDR. The 31% step took 1.12 s, and explicit Full at Fit
took 0.12 s on the small crop, using native tiles rather than a full-image
source stream. There were no natural 507s. Two injected 507 responses during
a Denoise-off toggle recovered in 4.21 s with no whole-image CPU retry.

These are single runs, not a matched benchmark; for example, a heavily loaded
run showed 3.16 s for Rotate with Denoise off. This check does not establish a
new memory peak or scope timing. Clean Grain calibration accounted for
6.36 of the 7.52 s Rotate (18 native chunks). A crop changes the samples and
their boundary neighbours; a warp changes both the noise and its correlation
between pixels. Unwarped or visible-only calibration could save time but would
generally produce different pixels, so the fit stays keyed to the geometry.

[Patch-first trace and screenshots](../../codebase/output/overnight/geometry-review-r3-confirmed/) ·
[Immediate edge pan](../../codebase/output/overnight/geometry-review-r3-confirmed/04-off-pan-far-in-flight.png)

**Round 4 (MacBook Neo, not timed):** At 100% with non-neutral geometry, the
sharp patch now draws first after geometry changes, grade edits, lane changes,
and pans. When only part of the photo is visible, a separate 1600 px background
render starts after the patch is shown. It does not hold up foreground renders
or scopes, and new interaction cancels it. An immediate far pan can still show
a blank area if that background is not ready; it must not reuse old geometry.
Electron launched, but its Python backend could not start because macOS had
exhausted POSIX semaphores (`Errno 28` with 137 GiB free). No Round 4 timings or
screenshots were captured; the numbers and images above are from Round 3.

**Round 5 (November 24, 2026):** The sharp patch still draws first. The
1600 px whole-picture fill now waits until the renderer is idle and does not
share GPU working buffers with foreground pictures, scopes or the navigator.
New work cancels it rather than waiting for it to finish. Panning inside the
sharp patch keeps the fill. An immediate far pan can briefly expose blank
space instead of showing the old geometry.

Real Electron at 100% on the 42 MP Sony `_DSC7970.ARW` with Lens Auto,
same MacBook Neo, 1408 × 794 window and shared GPU lock. Because the host
was out of POSIX semaphores, a test-only shim replaced the Library EXIF
pause event. Times from input to first exact HDR picture, in seconds:

| Action | R3 Denoise off | R5 Denoise off | R3 Clean Grain | R5 Clean Grain |
| --- | ---: | ---: | ---: | ---: |
| Rotate | 0.74 | 1.38 | 7.52 | 11.60 |
| Large crop | 0.67 | 0.96 | 6.32 | 7.69 |
| Perspective | 0.64 | 0.64 | 6.16 | 9.02 |

These are individual runs on different worktree snapshots, not a controlled
benchmark. Round 5 was slower in five of six samples. The exact picture after
an immediate far pan or a double pan took 1.55–1.63 s from the last movement.
The later fill arrived 5.36–6.71 s from the first movement with Denoise off.

Histogram bins, peak, normalization and clipping matched with the fill on
and off in HDR (with and without Clean Grain) and SDR (with Clean Grain).
An injected Reset memory refusal kept the previous picture and cleared the
temporary Straighten transform; the automatic retry drew exact at 100%
after 4.00 s. Fit and 31% worked. A separate retry at 99% reached the backend
but hit the host limit for that full-frame route (3.41 GiB needed, 2.96 GiB
available); the viewer was not stuck waiting for geometry.

[Round 5 report and screenshots](../../codebase/output/overnight/geometry-review-r5/report.md) ·
[Main trace](../../codebase/output/overnight/geometry-review-r5/results.json) ·
[Histogram A/B](../../codebase/output/overnight/geometry-review-r5/scope-confirm/results.json) ·
[Reset retry](../../codebase/output/overnight/geometry-review-r5/reset-confirm/results.json)

**Round 6 (November 24, 2026):** With Lens Auto and 1.3° Rotate, 75%, 90%,
and 99% all select the Sony's 7968 px processing step. From Fit, all six
checks (Denoise off and Clean Grain) painted the current visible area at
native resolution with no HTTP 507s. The existing actual-size small-crop
path still paints the sharp picture first. The 65% lower processing step
is unchanged; an exploratory run there still hit a whole-proxy memory refusal.

A settled scope change cancelled a live fill before waiting for its GPU
resources. In a test that held the fill just before painting, the cancellation
took about 0.1 ms and the new scope appeared in about 58 ms. The fill reported
51.7 MB of temporary GPU textures without asking the export worker to yield.

The Sony's full-source export used the CPU even at idle because of its
3.41 GiB memory estimate. A matched pair of GPU exports from a 3000 px JPEG
gave 3.44 s at idle and 3.69 s with the fill held live; the GPU portion was
2.10 s and 2.07 s, respectively. Neither export was asked to yield. This
checks scheduling, not throughput. During a separate export, foreground
Rotate and pan did take priority and the export finished on the CPU.

One cold/warm check per action using the repeated Round 5 timing setup:

| Edit | Off, cold / warm | Clean Grain, cold / warm |
| --- | ---: | ---: |
| Rotate | 0.63 / 0.59 s | 8.90 / 0.73 s |
| Large Crop | 0.30 / 0.29 s | 2.85 / 0.23 s |
| Perspective | 0.59 / 0.57 s | 8.42 / 0.64 s |

No slowdown stood out against the repeated Round 5 measurements; one pair
per action cannot establish a speed change. The first Clean Grain fit still
dominates cold Rotate and Perspective.

[Round 6 app trace](../../codebase/output/overnight/geometry-review-r6/results.json) ·
[Round 6 export trace](../../codebase/output/overnight/geometry-review-r6/export/results.json) ·
[Round 6 timing runs](../../codebase/output/overnight/geometry-timing-r6/) ·
[Round 5 repeated timings](../../codebase/output/overnight/geometry-timing-r5/report.md)

## November 23, 2026 — Grade Film Look edits and exact grain at zoom

MacBook Neo (A18 Pro, 8 GB), real Electron at 1408 × 794 points and 2×,
under the shared GPU lock. Warm IMG_3129.CR2 at 31% zoom, 1841 × 1229
processing pixels, HDR Grade. The recipe was reconstructed with Vision3,
2383, grain 23.6, halation 3.6 and Black Pro-Mist 1/8. The baseline is
`e0acf2a9`. The intermediate column has the discrete-edit and scope fix.
The final column includes slider scheduling and exact grain pruning. The
exploratory timing tolerance is 20% due to window and app activity.
Click timings end at the first exact presentation for the current edit.
Release timings start at pointerup.

| Action | Baseline | Discrete-edit fix | Final |
| --- | ---: | ---: | ---: |
| Film Look on, zoomed | 6.31 s | 3.28 s | 3.17 s across two warm toggles |
| Tone eye, zoomed | 6.41 s | 3.35 s | 3.18 s |
| Halation input, zoomed | 6.30 s | 3.35 s | 3.21 s |
| Film Look on with grain disabled, zoomed | 4.27 s | 2.26 s | 2.24 s with the matched recipe |
| Film Look off, zoomed | 46–49 ms | 163–174 ms | 156–169 ms |
| Film Look on at Fit, feedback then exact | 24 / 141 ms | 23 / 143 ms | 13 / 132 ms |
| Grain drag release at the value already rendering | — | 6.17 s, five foreground attempts and two complete tile passes | 2.88 s, one foreground attempt and one complete tile pass |
| Grain drag release at a new value | — | 6.10 s, five foreground attempts and two complete tile passes | 5.91 s, two foreground attempts and two complete tile passes |

The settled zoomed edits produced one foreground tile pass and one settled
scope request. The whole-frame follow-up reused all 12 tiles. The intermediate
slider run provides the matched release-to-Ready comparison and retains the
old slider behavior. One final Film Look toggle was interrupted by an Electron
display-state update. Its 6.19 s trace was repeated twice once the display
had settled.
[Intermediate trace](../../codebase/output/film-look-grade-diagnostic/render-path-part1-scope.json)
[Final trace](../../codebase/output/film-look-grade-diagnostic/render-path-final.json)
[Warm repeats](../../codebase/output/film-look-grade-diagnostic/render-path-final-warm.json)
[Matched grain-disabled run](../../codebase/output/film-look-grade-diagnostic/render-path-final-warm-grainless.json)

The follow-up check on the same Mac and recipe repeated Film Look on at
3.17 s and the same-value grain release at 2.88 s. With Faster dragging
enabled, continuous slider input presented two softer frames (at 0.92 s
and 1.56 s), cancelled the pending coarse work on release and showed the
exact frame 3.24 s after release.
[Follow-up trace](../../codebase/output/film-look-grade-diagnostic/render-path-final-warm-review.json)

After the brush and release fixes, the same Mac, photo, zoom and Film Look
recipe showed the Film Look On picture in 3.31 s (within the 20% tolerance).
With a painted brush adjustment selected, three `]` presses saved the larger
brush without a GPU draw or scope refresh. Changing adjustment opacity to 60%
showed one exact zoomed picture in 3.29 s and one settled scope at 3.83 s.
The later whole-frame catch-up took 16 ms from draw to presentation.
[Brush and release trace](../../codebase/output/film-look-grade-diagnostic/brush-release-electron.json)

The 512 px tiles used a 104 px halo and processed 4.05 million pixels for a
2.26 million-pixel picture. Warm full-look timing was 3.11–3.18 s. Turning
off grain took 2.20 s. Turning off mist took 0.66–0.68 s and reduced the halo
to 12 px. Turning off halation took 3.10 s with mist still on. Halation with
stock and both mist and grain off took 30 ms versus 28 ms for stock alone and
23 ms with stock bypassed. Each tile with mist runs one extract and 27
horizontal/vertical blur pairs before applying diffusion. The CPU encoded
the 12 tiles in about 3–7 ms. The 32 KiB peak readback spent roughly 3.1 s
waiting for the queued graph to complete. Per-pass timestamp intervals
overlapped or included queued work on this GPU, so feature costs come from
matched wall-clock probes. The GPU processing scale was 0.353 in this
fixture, so exact grain drew nine spatial samples over three colour layers
for every pixel.

Pruning impossible grain candidates in the Grade tile shader kept all
18,100,712 bytes and the measured peak identical in the production
before/after compare. Repeated isolated renders used the exact same grain
samples. Full look render time fell from a 3.18 s median to 2.96 s. With
mist off it fell from 663 to 553 ms. The production pair measured 3.14 to
3.10 s. In two additional byte-exact pairs, a silver grain map at 1000 px
and a 1841 px single-sample native-scale simulation exercised the same
pruning. Native-scale colour grain with scan sharpening took 92 to 62 ms
in that probe. Tile-size probes at 256, 768 and 1024 px took 5.54, 2.60 and
2.36 s. The latter two matched pixels and peak on this photo with tile
scratch of 69 and 109 MB versus 37 MB at 512 px. The shipping tile size
remains 512 px.
[Stage and tile probe](../../codebase/output/film-look-grade-diagnostic/grain-profile.json)
[Matched pixel and timing comparison](../../codebase/output/film-look-grade-diagnostic/grain-profile-compare.json)

The Python grain profile used a deterministic 256 × 256 RGB patch on the
same Mac. CPU native uses one sample and took 48 ms. Most profiled time was
in the band splat (31 ms of 47 ms). CPU proxy scale 0.31 used 16 samples and
took 3.59 s, mostly in cell construction and allocation, hashing and band
splats. CPU export uses the native one-sample kernel.
[CPU grain profile](../../codebase/output/film-look-grade-diagnostic/cpu-grain-profile.json)

## November 23, 2026 — Grade Film Look warm zoom

MacBook Neo (A18 Pro, 8 GB, Electron 1408 × 794 at 2×), uncommitted change
on `a6c626c6`. On IMG_3129.CR2 with the saved Copy 1 Film Look and grain,
three warm zooms at the same processing size (1841 px) completed in
1.1–2.7 ms from input to the zoom handler returning. The same-machine
baseline took 494–505 ms. The histogram starts after 200 ms of quiet and
waits for foreground rendering. It appeared 0.72–3.99 s after the single
zooms and 0.91 s after the last of five rapid steps, with one pass for the
sequence. The settled values matched a separate refresh. An Exposure edit
immediately after zoom produced an updated histogram.
[Timing evidence](../../codebase/output/film-look-grade-diagnostic/zoom-quiet-timing.json)
After the review fixes, a rerun (direct GPU route, so not like-for-like with
the tiled run above) measured 2.6–7.2 ms per warm zoom and one histogram
refresh 259 ms after the last of five rapid steps.
[Final timing evidence](../../codebase/output/film-look-grade-diagnostic/zoom-quiet-review-timing.json)

## November 23, 2026 — MacBook Neo Grade-open sharing & native encoder probe (Steps 5–6)

MacBook Neo (A18 Pro, 8 GB), macOS 27, real unpackaged Electron app
(`1408 × 794`) under the shared GPU lock. Step 5 keeps large (`>= 256 MiB`)
Grade source frames in read-only scratch files and shares Grade's original
decoded pixels and authored SDR reference with the batch worker by hardlink (or
spill copy) when the source file and decode recipe match (ignoring Auto Lensfun
resolved profile/database labels). Continuous 1 Hz whole-app physical-footprint
sampling across every run (resilient to transient macOS exiting-child `EPERM`
races). Decimal GB.

| Source and profile (same photo open in Grade) | Format | Wall time | Whole-app peak | Peak process split | Shared source / outcome |
| --- | --- | ---: | ---: | --- | --- |
| 42 MP Sony A (1920 px + frame, `export-speed-app.js`) | `avif_gain_map` | 135.33 s (was 137.3 s) | **1.655 GB** (was 5.04 GB, -3.39 GB) | Electron 0.77 + worker 0.73 + backend 0.15 GB | File-backed Grade; 0 trims, 0 Grain reclaims; golden SHA-256 exact (`ff3961ee9b4e…`); `maxGapS` 0.27 s |
| 42 MP Sony A-native (34 MP cropped) | `avif_gain_map` | 163.60 s | **3.190 GB** | `avifgainmaputil` 1.81 + Electron 0.98 + worker 0.23 + backend 0.17 GB | `sharedSource: true`; exact SHA-256 (`2ad132186e81…`); `maxGapS` 0.28 s |
| 42 MP Sony Max (34 MP, **all stages on**) | `avif_gain_map` | 345.95 s | **3.951 GB** (was 9.963 GB fail headless) | `avifgainmaputil` 2.10 + Electron 1.45 + worker 0.23 + backend 0.18 GB | `sharedSource: true`; exact SHA-256 (`9be69993101b…`); `maxGapS` 0.26 s |
| 61 MP synthetic EXR A-native | `jpegxl_hdr` | 159.37 s | **3.527 GB** | backend 2.36 + Electron 1.03 + worker 0.14 GB | `sharedSource: true`; `maxGapS` 0.26 s |
| 100 MP synthetic EXR A-native | `jpegxl_hdr` | 348.42 s | 4.910 GB (3.587 GB headless) | backend 2.55 + worker 1.42 + Electron 0.94 GB | `sharedSource: true`; `maxGapS` 0.29 s (batch worker 1.43 GB; Grade interactive 100 MP preview/mask caches held 2.55–2.90 GB in backend) |
| 100 MP synthetic EXR A-native | `sdr_jpeg` | 299.08 s | 5.269 GB (3.577 GB headless) | backend 2.95 + worker 1.42 + Electron 0.90 GB | `sharedSource: true`; `maxGapS` 0.38 s (same Grade 100 MP backend retention; direct EXR `share_grade_source` unit check exact SHA-256) |

**Step 6 — Native encoder memory probe (no code or output-byte changes):**
Bundled `avifgainmaputil 1.4.1 (libaom 3.13.2)`, `avifdec` and `avifenc` measured
directly on 42 MP, 61 MP and 100 MP Y4M pairs (decimal GB):

| Resolution | `avifgainmaputil combine` single → `--grid` | `avifdec` single → `--grid` | `avifgainmaputil tonemap` single → `--grid` | Notes |
| --- | ---: | ---: | ---: | --- |
| 42 MP (`7968 × 5320`) | 2.472 → 2.490 GB (`4×2`) | 3.223 → 0.574 GB | 2.234 → 1.670 GB | Fits under 4 GB with app + Grade |
| 61 MP (`9600 × 6354`) | 3.449 → 3.437 GB (`4×4`) | 4.617 → 0.509 GB | 3.187 → 2.321 GB | Encoder alone 3.45 GB (~4.3–4.5 GB with Electron + Grade); `avifenc -j 1/2/all` flat at 1.31–1.33 GB (`-j 1` 13.47 s vs `-j all` 4.47 s, changes bytes) |
| 100 MP (`12000 × 8334`) | **5.539 → 5.626 GB** (`4×4`) | 7.542 → 0.827 GB | 5.226 → 3.802 GB | Exceeds 4 GB on encoder alone; `ultrahdr_app` also enforces an upstream `8192 × 8192` hard cap |

`avifgainmaputil` has no `--jobs` flag and holds both full Y4M frames plus gain-map
buffers in RAM before grid tiling, so no byte-identical CLI flag reduces `combine`
peak memory. Bringing 61–100 MP native AVIF under 4 GB requires either warning/guiding
8 GB machines toward HDR JPEG XL (already 3.53 GB at 61 MP with Grade open, 3.59 GB
at 100 MP headless) or a Steve-approved custom tiled-grid libavif encoder (changes
AVIF bytes).

## November 23, 2026 — MacBook Neo staged strip pipeline (Step 4)

MacBook Neo (A18 Pro, 8 GB), macOS 27, headless one-worker CPU batch and real
Electron app (`1408 × 794`) under the shared GPU lock. Step 4 on `c080f8f5`
moves channel-by-channel geometry, disk-backed spatial masks, Detail (Texture,
Clarity, Sharpen), Local Adjustments, Lens Filter, Film Resolution, Halation,
fused Film Grain + Stock, Scan Sharpening, Look Strength, Image Structure, and
Vignette onto a 2-file ping-pong disk-backed strip pipeline, and reuses the
pre-compression HDR frame for `linked_to_hdr` SDR. Decimal GB.

| Source and profile | Format | Step 0 → Step 4 wall time | Step 0 → Step 4 peak | Result / SHA-256 |
| --- | --- | ---: | ---: | --- |
| 42 MP Sony A (1920 px + frame, headless) | `avif_gain_map` | 105.71 → 101.90 s | 6.423 → **2.091 GB** (-4.33 GB) | Golden SHA-256 exact (`ff3961ee9b4e…`) |
| 42 MP Sony A (**real app, Grade open**) | `avif_gain_map` | 137.3 → 166.1 s | 5.04 → **2.432 GB** (-2.61 GB) | Golden SHA-256 exact; 0 trims, 0 Grain reclaims; worker 0.62 GB |
| 42 MP Sony A-native (34 MP cropped) | `avif_gain_map` | 117.51 → 121.81 s | 6.783 → **2.703 GB** (-4.08 GB) | Exact SHA-256 (`2ad132186e81…`); worker 0.65 + encoder 1.98 GB |
| 42 MP Sony Max (34 MP, **all stages on**) | `avif_gain_map` | 245.11 s (fail) → 253.68 s | 9.963 → **3.273 GB** (-6.69 GB) | Exact SHA-256 (`9be69993101b…`); worker 0.81 + encoder 2.39 GB |
| 42 MP Sony B (native) | `avif_gain_map` | 28.61 → 30.87 s | 3.662 → **3.187 GB** (-0.48 GB) | Golden SHA-256 exact (`ccfeedf49d0e…`) |
| 61 MP synthetic EXR A-native | `jpegxl_hdr` | — → 122.92 s | — → **2.578 GB** | Exported natively (`56e1385cd4b8…`) |
| 100 MP synthetic EXR A-native | `sdr_jpeg` | — → 171.68 s | — → **3.577 GB** | Exported natively (`16ec18613dac…`; peak in `geometry`) |
| 100 MP synthetic EXR A-native | `jpegxl_hdr` | — → 209.93 s | — → **3.587 GB** | Exported natively (`424f840e375b…`; peak in `geometry`) |

## November 23, 2026 — MacBook Neo bounded B&W, HSL and output finishing (Step 3)

MacBook Neo (A18 Pro, 8 GB), macOS 27, headless one-worker CPU batch under the
shared lock. Step 3 on `95c10725` extends bounded strips to guided Black &
White, Global HSL (`shared_selection` with frame-aligned halo), whole-channel
Lanczos resize, haloed output multiscale sharpening, highlight compression,
streaming photo framing, and in-place watermark patching. Shifted `roll`
windows and Pillow banded `box=` Lanczos both altered pixel bits, so roll stays
whole-frame until Step 4's shared channel-by-channel geometry stage and resize
uses whole-channel Pillow. Decimal GB.

| Source and profile | Format | Wall time | Peak footprint | Result |
| --- | --- | ---: | ---: | --- |
| 42 MP Sony A (1920 px + frame) | `avif_gain_map` | 97.22 s | — | Golden SHA-256 unchanged (`ff3961ee9b4e…`) |
| 42 MP Sony B (native) | `avif_gain_map` | 31 s | — | Golden SHA-256 unchanged (`ccfeedf49d0e…`) |
| 100 MP EXR + Clean Grain + B&W + Global HSL + Sharpen + Frame + Watermark | `sdr_jpeg` | 234.02 s | **2.525 GB** | Exported natively (render 1.75 GB; `develop_raw` 2.52 GB) |
| 100 MP EXR + Clean Grain + B&W + Global HSL + Sharpen + Frame + Watermark | `jpegxl_hdr` | 274.72 s | **2.719 GB** | Exported natively (render < 1.7 GB; encode 2.72 GB) |

## November 23, 2026 — MacBook Neo file-backed export memory (Step 2)

MacBook Neo (A18 Pro, 8 GB), macOS 27, headless one-worker CPU batch under the
shared lock. Step 2 on `420d212b`; same sources, grades and presets as Steps
0–1. Figures are decimal GB. After an initial test with `MallocLargeCache=0`
and per-row unbuffered tile writes regressed wall time by 30–45% (Profile A
123.33 s), Step 2 keeps the normal macOS allocator, uses writable scratch
mappings closed before readback, writes large (>= 256 MiB) EXR/TIFF/RAW loads
directly into file-backed storage, routes HDR/SDR JXL and Ultra HDR through
file-backed delivery, and releases batch sources before the final encode.

| Source and format | Step 0 → Step 2 wall time | Step 0 → Step 2 peak | Result |
| --- | ---: | ---: | --- |
| 42 MP Sony A, AVIF (1920 px + frame) | 105.71 → 96.80 s (-8.4%) | 6.423 → 3.804 GB (-2.62 GB) | Golden SHA-256 unchanged (`ff3961ee9b4e…`) |
| 42 MP Sony B, AVIF (native) | 28.61 → 31.94 s | 3.662 → 3.170 GB (-0.49 GB) | Golden SHA-256 unchanged (`ccfeedf49d0e…`); worker during encode 1.16 → 0.65 GB |
| 42 MP Sony B, Ultra HDR JPEG | 19.95 → 22.38 s | 3.986 → 2.943 GB (-1.04 GB) | Same SHA-256 (`6837353d3464…`); worker during encode 2.02 → 0.98 GB |
| 42 MP Sony B, HDR JPEG XL | 28.79 → 32.02 s | 4.157 → 1.758 GB (-2.40 GB) | Same SHA-256 (`c8f0b6a1e578…`); now uses bounded strips |
| 42 MP Sony B, SDR JPEG | 14.44 → 16.47 s | 2.534 → 1.711 GB (-0.82 GB) | Same SHA-256 (`25dfd32eba69…`) |
| 100 MP synthetic EXR B, HDR JPEG XL | 74.42 → 76.00 s (+2.1%) | 6.951 → 2.521 GB (-4.43 GB) | Same SHA-256 (`15d617854a59…`) |
| 100 MP synthetic EXR B, SDR JPEG | 44.34 → 50.03 s | 4.725 → 2.528 GB (-2.20 GB) | Same SHA-256 (`cd4f347d406f…`); denoise 4.66 → 1.71 GB |
| 192 MP TIFF B, SDR JPEG | 89.77 s (failed) → 95.66 s (exported) | 7.434 → 4.089 GB (-3.35 GB) | Exported and passed Pillow verify (`7e2eaad36b47…`) |

The Mac probe confirmed that file-backed `mmap("w+")` charges only ~0.2 MB to
macOS `phys_footprint`, while macOS `DefaultMallocZone` retains freed large
heap allocations and ignores `malloc_zone_pressure_relief`. Bypassing the heap
for large decoded sources avoids polluting that cache without paying the
~30–38% page-fault penalty of `MallocLargeCache=0`. Evidence: `step2b-*-run.json`
under `codebase/output/export-memory-2026-11-23/`.

In Electron on the same Mac, the saved `DSC04375` 4000 px Ultra HDR export,
full-size Proof and decode took 15.11 s on GPU and 18.60 s on forced CPU.
Proof matched its export byte for byte on each route; both decoded to 1008.58
nits against the 1000-nit target (within the 1% encoded allowance). Evidence:
`codebase/output/gpu-delivery-ceiling/1795399332012/result.json`.

## November 23, 2026 — MacBook Neo whole-frame export memory (Step 1)

MacBook Neo (A18 Pro, 8 GB), macOS 27, headless one-worker batch under the
shared lock; Sony 42 MP `_DSC7970.ARW`, AVIF gain map, same grades and presets
as Step 0. Step 1 is the working tree on `bcd6c16a`. Decimal GB.

| Profile | Wall time, Step 0 → Step 1 | Process tree peak | Worker peak | Worker during `encode/encode` | SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| A — 34 MP cropped, 1920 px + frame | 105.71 → 89.35 s (-15.5%) | 6.423 → 4.390 GB (4.167 GB at 2 workers) | 6.356 → 4.323 GB | 4.763 → 2.591–2.668 GB | unchanged (`ff3961ee9b4e…`) |
| B — native size, bounded strips | 28.61 → 29.10 s | 3.662 → 3.689 GB | 2.301 → 2.425 GB | 1.163 → 1.166 GB | unchanged (`ccfeedf49d0e…`) |
| Max — 34 MP, all creative + finishing stages | 245.11 s (failed) → 193.65 s (exported) | 9.963 → 5.592 GB (-4.37 GB) | 9.896 → 5.526 GB | — → 4.191 GB (+2.40 GB encoder) | exported (`9be69993101b…`) |

After shrinking Film Grain's row band dynamically to keep all six CPU cores
active inside the 192 MiB scratch cap, Profile A dropped from 105.71 s to
89.35 s (fused Film Grain + Stock 52.5 s across both lanes vs 53.9 s separate
before Step 0; Tone & Colour 12.5 → 5.1 s; Vignette 1.9 → 0.54 s) while
keeping the golden SHA-256 identical. Profile Max dropped 4.37 GB (removing
the float64 Global HSL spike) and now completes framing and AVIF encoding.
The remaining Profile A / Max whole-frame buffers (Geometry, Masks, Detail,
Halation, Framing) and worker encode-time retention are addressed in Steps 2–4.

## November 23, 2026 — MacBook Neo export memory baselines (Step 0)

MacBook Neo (A18 Pro, six cores, 8 GB), macOS 27, AC power, `feat/denoise-v1`
after the Step 0 review fixes and single-worker `< 16 GB` batch default.
Headless batch export through `tools/export_speed_profile.py` under the shared
GPU lock, with 4 Hz process-tree sampling and per-stage peak attribution
(decimal GB; no Electron window).

* **2-photo batch (42 MP Sony `_DSC7970.ARW`, Profile B native AVIF)**:
  `parallel=2` (old `< 16 GB` default) 47.26 s, **6.482 GB** peak (two
  `avifgainmaputil` helpers overlapping at 4.79 GB); `parallel=1` (new default)
  57.59 s, **3.687 GB** peak, identical SHA-256 `ccfeedf49d0e...`.

| Source & profile | Format | Wall time | Peak footprint | Dominant stage & process split | Outcome / SHA-256 |
| --- | --- | ---: | ---: | --- | --- |
| Sony 42 MP, Profile A (1920 px + frame) | `avif_gain_map` | 105.71 s | 6.423 GB | `sdr/tone_colour` (worker 6.36 GB; `avifgainmaputil` 0.16 GB) | exported, `ff3961ee9b4e...` (golden) |
| Sony 42 MP, Profile A-native (34 MP cropped) | `avif_gain_map` | 117.51 s | 6.783 GB | `sdr/tone_colour` (worker 6.72 GB; `avifgainmaputil` 1.98 GB) | exported, `2ad132186e81...` |
| Sony 42 MP, Profile Max (34 MP, all stages on) | `avif_gain_map` | 245.11 s | 9.963 GB | `sdr/tone_colour` (worker 9.90 GB, float64 Global HSL) | failed at framing (out of available RAM) |
| Sony 42 MP, Profile B (bounded strips) | `avif_gain_map` | 28.61 s | 3.662 GB | `encode/encode` (worker 1.16 + `avifgainmaputil` 2.46 GB) | exported, `ccfeedf49d0e...` (golden) |
| Sony 42 MP, Profile B | `jpeg_ultrahdr` | 19.95 s | 3.986 GB | `encode/encode` (worker 2.02 + `ultrahdr_app` 1.93 GB) | exported, `6837353d3464...` |
| Sony 42 MP, Profile B | `jpegxl_hdr` | 28.79 s | 4.157 GB | `encode/encode` (worker 4.09 GB; whole-frame path) | exported, `c8f0b6a1e578...` |
| Sony 42 MP, Profile B | `sdr_jpeg` | 14.44 s | 2.534 GB | `sdr/denoise` (worker 2.47 GB) | exported, `25dfd32eba69...` |
| Synthetic 61 MP EXR (`9600×6354`), Profile B | `avif_gain_map` | 49.34 s | 5.094 GB | `encode/encode` (worker 1.34 + `avifgainmaputil` 3.70 GB) | exported, `304f938e8cd4...` |
| Synthetic 61 MP EXR, Profile B | `jpeg_ultrahdr` | 29.61 s | 3.273 GB | `encode/encode` (worker 2.54 + `ultrahdr_app` 0.67 GB) | failed (`ultrahdr_app` hard cap `8192×8192`) |
| Synthetic 61 MP EXR, Profile B | `jpegxl_hdr` | 40.53 s | 4.877 GB | `encode/encode` (worker 4.81 GB; whole-frame path) | exported, `361791288a0a...` |
| Synthetic 61 MP EXR, Profile B | `sdr_jpeg` | 25.51 s | 3.248 GB | `sdr/denoise` (worker 3.18 GB) | exported, `7c493e8c4001...` |
| Synthetic 100 MP EXR (`12000×8334`), Profile B | `avif_gain_map` | 91.85 s | 7.247 GB | `encode/encode` (worker 1.91 + `avifgainmaputil` 5.84 GB) | exported, `8828ab35874b...` |
| Synthetic 100 MP EXR, Profile B | `jpeg_ultrahdr` | 58.46 s | 4.551 GB | `hdr/denoise` (worker 4.49 GB) | failed (`ultrahdr_app` hard cap `8192×8192`) |
| Synthetic 100 MP EXR, Profile B | `jpegxl_hdr` | 74.42 s | 6.951 GB | `hdr/output_finishing` (worker 6.88 GB; whole-frame path) | exported, `15d617854a59...` |
| Synthetic 100 MP EXR, Profile B | `sdr_jpeg` | 44.34 s | 4.725 GB | `sdr/denoise` (worker 4.66 GB; `develop_raw` 3.26 GB) | exported, `cd4f347d406f...` |
| Real 192 MP `pano_192mp.tif` (`16000×12000`), Profile B | `sdr_jpeg` | 89.77 s | 7.434 GB | worker render + Pillow validation | failed (`MAX_IMAGE_PIXELS` bomb guard during JPEG verify) |

## November 22, 2026 — MacBook Neo CPU AVIF export with Clean Grain

MacBook Neo (A18 Pro, six cores, 8 GB), macOS 27, AC power, `feat/denoise-v1`
from `a654d7f9`. Headless batch export through `BatchExports` and its isolated
worker, the same code the app runs, timed by `tools/export_speed_profile.py`
under the shared GPU lock. A disposable copy of the 42 MP Sony `_DSC7970.ARW`.
Peak is the sampled Apple physical footprint of the export process tree
(driver, worker and encoder; no Electron window), in decimal GB.

* **Profile A**: the Santorini recipe from
  `codebase/tests/fixtures/export-speed/` unchanged (its crop gives
  7206 × 4706 on this photo), `play_raw` preset: AVIF gain map, 1920 px long
  edge, frame. Whole-frame CPU path.
* **Profile B**: the photo's own grade with Clean Grain Small in HDR and SDR,
  native-size AVIF gain map, no frame. Bounded strip path.

| Profile | Build | Wall time | Peak footprint | AVIF SHA-256 |
| --- | --- | ---: | ---: | --- |
| A | Baseline `a654d7f9`, three runs | 147.9–156.5 s | 6.12–6.51 GB | `ff3961ee9b4eaccd969ee9844459961474e866a32b6bf8e5be5e0159e67a04a9` |
| A | After `928e7414`, three runs | 99.6–106.3 s | 5.90–6.15 GB | same |
| B | Baseline `a654d7f9`, three runs | 29.8–34.0 s | 3.80–3.81 GB | `ccfeedf49d0e88dd81ad286fd53e2e89a57e2d1e388ff50bb835318002dc5c05` |
| B | After `8b300c10`, three runs | 26.7–28.5 s | 3.67–3.70 GB | same |

Profile A's peak is the worker alone (6.44 GB at about 90 s, the start of the
SDR rendition), so this export already exceeded the 4 GB whole-app ceiling
before any change, and still does (open in the Export and Proof PRD).
Every change kept both files byte-identical. A first Y4M version that
converted six bands ahead raised Profile B's peak to 4.00–4.05 GB and was
replaced by splitting each band's rows.

Stage time from the `export_timing` records, seconds, HDR + SDR (after:
mean of the three runs):

| Stage | Profile A before | Profile A after | Profile B before | Profile B after |
| --- | ---: | ---: | ---: | ---: |
| Film Grain | 31.5 + 32.2 = 63.7 | 15.6 + 15.7 = 31.3 | — | — |
| Film stock | 11.7 + 11.5 = 23.2 | 11.6 + 11.0 = 22.6 | — | — |
| Tone and colour | 6.0 + 7.2 = 13.2 | 5.4 + 7.0 = 12.5 | 0.2 + 0.3 | 0.2 + 0.3 |
| Brush mask | 5.3 + 5.5 = 10.8 | 4.8 (once) | — | — |
| Detail | 4.1 + 5.0 = 9.1 | 3.2 + 3.2 = 6.4 | — | — |
| Geometry | 3.1 + 4.9 = 8.0 | 3.0 (once) | 0 | 0 |
| Halation | 3.2 + 3.8 = 7.0 | 1.9 + 1.9 = 3.8 | — | — |
| Clean Grain (model and Grain) | 5.9 (shared) | 5.7 (shared) | 7.8 (shared) | 6.4 (shared) |
| Local stack | 1.8 + 2.2 = 4.0 | 1.6 + 1.7 = 3.3 | — | — |
| Vignette | 1.0 + 1.5 = 2.5 | 1.0 + 0.9 = 1.9 | — | — |
| Strip render | — | — | 0.7 + 2.5 = 3.3 | 0.6 + 2.2 = 2.8 |
| RAW development | 3.8 | 4.0 | 4.5 | 3.8 |
| Output finishing, compression, framing | 1.4 | 1.4 | 0 | 0 |
| Y4M preparation | 0.3 | 0.2 | 4.2 | 2.0 |
| Encoder | 1.2 | 1.1 | 12.1 | 11.1 |
| Validate and metadata | 0.1 | 0.1 | 0.7 | 0.6 |
| Unattributed | 0.1 (0.09%) | 0.1 (0.09–0.12%) | 0.3 (0.99%) | 0.04–0.14 (0.16–0.51%) |

Film stock and Clean Grain already ran on the CPU pool; tone and colour is a
dozen separate steps, none above 5% of the wait. Steps 4a–4d were Film Grain
on up to six workers in 32-row chunks, the SDR geometry pass and brush mask
done once, no halation map unless shown, and exact parallel box blurs and
Y4M band conversion.

Progress (headless batch, 0.1 s polling of the queue): never backwards in
any run. Profile A longest pause 1.08 s in both runs after the overrun fix
(`d5492b37`; up to 2.12 s before it), 5% at 2.1 s (2% of the wait);
Profile B longest pause 1.1–1.3 s, 5% at 2.0–2.1 s (7–8% of the wait).

**Real app, Profile A with the same photo open in Grade**
(`tests/performance/export-speed-app.js`, unpackaged Electron at
1408 × 794, `02add6cf`): 137.3 s from Export to finished (131.9–137.3 s over
three runs), whole-app peak 5.04 GB (4.97–5.17 GB, sampled once a second),
AVIF SHA-256 equal to the headless file. The Export page and status bar never
went back, longest pause 0.31 s (the page polls every 0.5 s), 5% at 2.8 s
(2% of the wait). Memory: cache trims with 40 MB, 12 MB and 0 MB of
rebuildable cache, then `cache_trim_paused` and silence through the end of
the export and one more cool-down (`budget_pressure`, OS pressure none);
Grade's Grain reclaim twice, then none. Before the guard's second revision
the same run logged 3 trims and 5–6 Grain reclaims spread over the export.

## November 22, 2026 — Windows private commit

Windows PC, Ryzen 5 7600 and GeForce RTX 4070 Ti, unpackaged Electron at
2560 × 1440 under the shared GPU lock. Fixed 6 GB whole-app default
with the private-commit implementation in `2887a469`.
Delivery used the same 42 MP Sony `_DSC7970.ARW`, Clean Grain Small,
Lensfun off, CPU delivery, Q90 AVIF Gain Map and peak guarantee as the
previous Windows run. Memory peaks below are sampled private commit in
decimal GB.

| Action | To result | Whole-app private commit | Memory outcome |
| --- | ---: | ---: | --- |
| Cold launch, no photo open | 5 samples at 15–19 s after the window was ready | 1.714 GB idle | No Grade source or active reservations |
| Full-size AVIF export | 56.81 s | 5.388 GB peak | 0.612 GB below the limit |
| Full-size AVIF Proof | 101.91 s | 5.194 GB peak | 0.806 GB below the limit |
| 90-second Library viewport | 1.20 s to first picture, 60.7 s to the 30th | 5.558 GB in-app peak, 5.391 GB independent peak, 2.512 GB at end | All 30 eligible photos pictured |

The delivery rerun kept the export's native CPU noise measurement for Proof
by holding back the renderer's native GPU measurement publication in the
test. The first unpinned run reproduced the existing R2-7 race: the export
matched, then Proof picked up the GPU measurement that finished during
export and its bytes differed. With the same measurement, export, Proof and
both Proof tiles matched the previous hashes, with tile peaks of 329.3 HDR
and 162.2 SDR nits and 0% clipping. The export and Proof SHA-256 was
`2183cf282d1079f58e1da00b2f4f36a58b1505022888d2c79da167a3e0e941c1`.
Neither delivery action logged a memory refusal, a trim or a ceiling retry.

Library had one moderate cache trim when the in-app sample crossed the
5.4 GB cache target. The 6.83 GB estimate for the line-scan DNG correctly
hit the admission limit. There were no spurious refusals or trim loops.
The app and independent sampler have different sampling clocks.

A real child process committed 128 MiB and touched every page. Allowing
1 MiB for the interpreter and pipe handshake, its charge rose by 128.25 MiB
(6,500,352 to 140,980,224 bytes). `EmptyWorkingSet` reduced the working
set from 147,492,864 to 1,208,320 bytes, with the charge still at
140,980,224 bytes. Mocked headroom tests covered each limiting source and
the 16 GiB budget tests confirmed that default cache shares stayed flat.
[Windows memory policy](../product/modules/memory-and-caches.md#november-22-windows-private-commit-and-6-gb-default)

## November 22, 2026 — Windows PC Grade Micro Grain with Lensfun

Windows PC with a Ryzen 5 7600 and GeForce RTX 4070 Ti, unpackaged Electron
at 2560 × 1440 under the shared GPU lock. Sony `_DSC7970.ARW` (42 MP),
signed AHD, speck cleanup ×2.5, GPU Auto, generated SDR and the default 4 GB
app limit. One `--micro-lens-memory` replay at `4ee831eb` and one at
`3cc51a90`. Peaks are independently sampled proportional resident memory
in decimal GB. Short actions can use the preceding sample.

| Action | Seconds before → after | Whole app GB before → after | Backend GB before → after | GPU helper GB before → after |
| --- | ---: | ---: | ---: | ---: |
| Open at Fit | 18.011 → 19.085 | 2.428 → 2.477 | 1.538 → 1.617 | 0.471 → 0.452 |
| Micro Grain at Fit, lens off | 19.453 → 20.012 | 2.099 → 2.099 | 0.920 → 0.941 | 0.597 → 0.617 |
| Zoom to 78%, lens off | 5.808 → 6.027 | 2.819 → 2.827 | 1.555 → 1.546 | 0.588 → 0.593 |
| Lensfun Auto at 78% | 46.296 → 41.282 | 3.155 → 3.397 | 2.053 → 2.262 | 0.570 → 0.580 |
| Exposure +0.25 EV | 2.035 → 2.014 | 2.618 → 2.495 | 1.056 → 1.077 | 0.568 → 0.563 |
| HDR to generated SDR | 2.546 → 2.484 | 2.435 → 2.445 | 1.227 → 1.252 | 0.564 → 0.555 |
| Generated SDR to HDR | 0.064 → 0.064 | 2.350 → 2.445 | 1.131 → 1.252 | 0.563 → 0.548 |
| Return to Fit | 0.012 → 0.081 | 2.350 → 2.415 | 1.131 → 1.157 | 0.563 → 0.547 |
| Return to 78% | 0.078 → 0.012 | 2.350 → 2.415 | 1.131 → 1.157 | 0.563 → 0.547 |

Both Lensfun runs kept zoom and pan. The current run built only the 4096 px
Micro preview for the lens change and reused the GPU's matching Bayer
preparation in 13 ms. The two lens stages together fell from 6.169 to
0.580 s. Exposure and generated SDR reused the 4096 px source. All four
reduced HDR and generated SDR SHA-256 comparisons matched. Micro scratch
closed in the targeted success and cancellation tests for both coordinate
layouts. The highest sampled current summed Windows working set was
3.953 GB during the full replay.

At 78%, with Micro using the native 7968 px processing step, the
3473 × 1877 finished HDR viewport matched the same region of the
7968 × 5320 whole-photo GPU surface byte for byte. An 800 px horizontal
scroll produced a new sharp region covering the view. The RAW reload
tests also passed pan clamping when the frame became smaller.

## November 22, 2026 — Windows PC native Lensfun

Windows PC, Ryzen 5 7600 (6 cores, 12 threads). Three alternating pairs
of fresh RAW development processes per photo at `4ee831eb` and `3cc51a90`,
using signed AHD and speck cleanup ×2.5. Canon used the manual EF-S
18–135 mm IS profile because Auto found no unique match. Sony used the
automatic Sigma 65 mm F2 profile. Peak is the backend lifetime working
set read immediately after lens correction, before finishing SDR.

| RAW | Lens seconds before, median (range) | Lens seconds after, median (range) | Peak MB before, median (range) | Peak MB after, median (range) |
| --- | ---: | ---: | ---: | ---: |
| Canon `IMG_0790.CR2`, 5202 × 3464 | 1.289 (1.279–1.324) | 0.145 (0.145–0.148) | 588.5 (587.9–589.2) | 590.9 (585.7–591.2) |
| Sony `_DSC7970.ARW`, 7968 × 5320 | 2.694 (2.666–2.743) | 0.254 (0.254–0.255) | 1204.1 (1203.2–1204.5) | 1220.8 (1216.9–1230.5) |

All six runs per photo matched on corrected float32 pixels, SDR float32
pixels and finished 8-bit SDR. The 21 targeted Lensfun tests passed,
including exact comparisons against whole-frame correction for both
coordinate layouts and RAW profile selection. No strip warnings appeared
during normal development. Setup built `lens_correction.dll`. The PyInstaller
backend also loaded the bundled DLL and applied Lensfun Auto to the Sony.

## November 22, 2026 — Windows PC AVIF delivery memory

Windows PC with a Ryzen 5 7600 and GeForce RTX 4070 Ti, unpackaged
Electron at 2560 × 1440 under the shared GPU lock. Full-size
`_DSC7970.ARW` (7968 × 5320), Clean Grain Small, Lensfun off, CPU delivery,
Q90 AVIF Gain Map and peak guarantee on. One run on `1d0b6720` before
file-backed delivery and one on `3cc51a90`. The control used the full-size
CPU noise measurement saved by the current export. Both Proof runs reused
that exact measurement.

| Action | To result before → after | App meter GB before → after | Summed working sets GB before → after |
| --- | ---: | ---: | ---: |
| Full-size AVIF export | 52.65 → 57.87 s | 4.615 → **3.568** | 5.375 → **4.099** |
| Full-size AVIF Proof | 106.50 → 101.79 s | 4.582 → **3.483** | 5.904 → **4.029** |

This run used proportional resident Windows pages for its then-current 4 GB budget. Both
actions stayed below that limit. Summing the ordinary Windows process working
sets counts shared pages in each process that maps them and exceeded 4 GB
by 99 MB for export and 29 MB for Proof.

The delivered AVIF and full-size Proof artifact shared the same SHA-256 in
both revisions (`2183cf282d1079f58e1da00b2f4f36a58b1505022888d2c79da167a3e0e941c1`).
Both Proof tile files and all reported tile statistics matched. HDR and SDR
tile peaks were 329.3 and 162.2 nits, respectively, with 0% clipped for each.
The logs recorded zero ceiling retries. Targeted tests exercised ceiling
retry isolation, banded AVIF tile parity and endpoint eviction. Electron
removed the Proof scratch root on normal quit. After the forced quit of the
full Proof run, a relaunch swept the abandoned artifact, tiles and endpoints
once the test root was aged past the five-minute grace period.

## November 22, 2026 — Weighted Bayer fit checks

MacBook Neo, A18 Pro and 8 GB, unpackaged Electron at 1408 × 794 under the
shared GPU lock. These are individual qualification runs with the weighted
fit from R2-4 at `b5b2ac1c`.

| Action | DSC00264.ARW | IMG_3129.CR2 | Conditions |
| --- | ---: | ---: | --- |
| RAW open to first Grade picture, CPU / GPU | 22.80 / 21.48 s | 9.70 / 7.83 s | Both RAW cleanups on, Edge Colour highlights |
| Library GPU development | 10.72 s | 5.57 s | Saved Grade settings, 2560 px Library scene |
| GPU JPEG Ultra HDR export | 4.94 s | 1.64 s | 1024 px delivery, encoded Proof matched export byte for byte |

Canon `IMG_0790.CR2` full-size CPU Micro Grain JPEG Ultra HDR export took
29.03 s with harsh-speck cleanup on and Lensfun off, after GPU Grade
captures at 110%. The quick Library viewport check showed the first picture
at 0.30 s and all nine visible pictures by 30 s.
[QUAL-1 colour comparisons](briefs/sprint-denoise-gpu-logging-2026-11-21.md#qual-1--exposure-independent-quality-fixes-output-changes)

## November 22, 2026 — MacBook Neo Micro Grain with lens memory

MacBook Neo, A18 Pro and 8 GB unified memory, unpackaged Electron at
1408 × 794 under the GPU lock. Sony `_DSC7970.ARW`, 42 MP, signed AHD,
speck cleanup ×2.5, GPU Auto, generated SDR and the 4 GB app ceiling.
Baseline `a2aca788` already has exact Lensfun coordinate strips. The after
run uses the scratch change in `13f9d673`. One run per version. Time is to
the accepted Grade picture and peaks are sampled
physical footprint in decimal GB. The Lensfun Auto action includes RAW
re-development and restoring 78% zoom after Grade opens the new source
at Fit.

| Action | Seconds before → after | Whole-app GB before → after | Backend GB before → after | Reduced Micro cache before → after |
| --- | ---: | ---: | ---: | --- |
| Open at Fit | 9.75 → 10.76 | 2.156 → 2.133 | 1.555 → 1.516 | — |
| Enable Micro at Fit, lens off | 18.09 → 19.42 | 2.160 → 2.224 | 1.112 → 1.073 | — |
| Zoom to 78%, lens off | 5.05 → 5.16 | 4.084 → 4.110 | 1.461 → 1.463 | — |
| Enable Lensfun Auto and return to 78% | 59.31 → 61.99 | 4.044 → 4.050 | 2.068 → 2.144 | Dropped → kept |
| Exposure +0.25 EV | 37.05 → 38.96 | 3.947 → 4.452 | 2.187 → 2.112 | Kept after rebuilding both times |
| HDR → generated SDR | 2.42 → 2.32 | 3.580 → 3.468 | 1.746 → 1.631 | Reused both times |
| Generated SDR → HDR | 0.10 → 0.11 | 3.036 → 2.992 | 1.160 → 1.216 | Kept both times |
| Return to Fit | 0.01 → 0.01 | 3.036 → 2.898 | 1.160 → 1.019 | Kept both times |
| Return to 78% | 0.01 → 0.01 | 3.036 → 2.898 | 1.160 → 1.019 | Kept both times |

Very short actions can use the immediately preceding census sample. The first
4096 px Micro preparation, isolated from RAW re-development, peaked at
3.854 → 3.452 GB whole-app. The new Exposure run still rebuilt the preview
after a whole-app pressure spike and cache trim. The Lensfun Auto action
peaked during RAW re-development, before that Micro preparation.
The Chromium GPU helper peaked at 1.845 GB during the lens-off zoom and
1.759 GB during Lensfun Auto in the after run. The reduced HDR and generated
SDR preview files matched SHA-256 in both runs.

[Before](../../codebase/output/micro-lens-mem/before.jsonl) ·
[After](../../codebase/output/micro-lens-mem/after.jsonl) ·
[Run details](../../codebase/output/micro-lens-mem/result.txt)

## November 22, 2026 — MacBook Neo Grade memory

MacBook Neo, A18 Pro with 8 GB unified memory, unpackaged Electron at
1408 × 794. Each replay used the shared GPU lock and the default 4 GB app
ceiling. Sony `_DSC7970.ARW` is a 42 MP signed AHD source with speck cleanup
×2.5. The before measurement is the stored Micro lens replay. The after
measurement is the review-fix retry at `44b50d60`. Peak columns are the
independently sampled physical footprint in decimal GB. The three peak
columns can refer to different samples during the same action.

| Action | Seconds before → after | Whole app GB before → after | Backend GB before → after | GPU helper GB before → after |
| --- | ---: | ---: | ---: | ---: |
| Open at Fit | 10.76 → 9.78 | 2.133 → 1.819 | 1.516 → 1.229 | 0.485 → 0.485 |
| Enable Micro at Fit, lens off | 19.42 → 17.16 | 2.224 → 2.207 | 1.073 → 1.047 | 0.675 → 0.684 |
| Zoom to 78%, lens off | 5.16 → 4.59 | 4.110 → 3.270 | 1.463 → 1.590 | 1.845 → 0.902 |
| Enable Lensfun Auto and return to 78% | 61.99 → 74.26 | 4.050 → 3.258 | 2.144 → 1.960 | 1.759 → 0.705 |
| Exposure +0.25 EV | 38.96 → 2.11 | 4.452 → 3.562 | 2.112 → 1.411 | 1.694 → 0.973 |
| HDR → generated SDR | 2.32 → 2.34 | 3.468 → 3.218 | 1.631 → 1.360 | 0.949 → 1.041 |
| Generated SDR → HDR | 0.11 → 0.10 | 2.992 → 3.218 | 1.216 → 1.360 | 0.892 → 0.993 |
| Return to Fit | 0.01 → 0.07 | 2.898 → 3.108 | 1.019 → 1.146 | 0.892 → 0.993 |
| Return to 78% | 0.01 → 0.01 | 2.898 → 3.233 | 1.019 → 1.139 | 0.892 → 1.089 |

All nine actions stayed below 4 GB. The automatic SDR upload is absent in
both review-fix runs; on retry, the SDR switch dropped from the pre-fix
3.740 GB whole-app / 1.461 GB GPU helper to 3.218 / 1.041 GB and reused the
4096 px Micro source. The first run took 34.96 s on an intermittent CPU cache
miss also seen before the fixes. All four preview SHA-256 hashes matched in
both runs. Lensfun zoom handling is unchanged. The shortest actions can
include the preceding census sample.

The isolated lens-off GPU helper snapshot rose from 0.517 GB at Fit to
1.755 GB at 78%. IOSurface rose from 92 to 764 MB and unmapped graphics
from 289 to 715 MB. The app reported a 7968 × 5320 canvas and a 339 MB
retained target at 78%. At the settled capture, source proxies were 74 MB
and all Grade allocations reported by the app were 562 MB. The OS
categories include backing outside the app's allocation counters.
A paired GPU capture held the same 2631 × 1097 finished pixels in the
339 MB whole-photo surface and the new 43 MB viewport surface. The
captured pixels matched byte for byte, and panning filled the new view.
The picture also matched in a screen crop sampled before and during
RAW re-development. The preset ROI pan-cache driver hit the same
retained-frame assertion on the baseline and this branch.

[Before replay](../../codebase/output/micro-lens-mem/after.jsonl) ·
[Pre-fix replay](../../codebase/output/grade-mem/after.jsonl) ·
[After-fix retry](../../codebase/output/grade-mem/after-fixes.jsonl) ·
[After-fix first run](../../codebase/output/grade-mem/after-fixes-first.jsonl) ·
[Run details](../../codebase/output/grade-mem/result.txt)

Scope-eviction follow-up (this commit, same MacBook Neo, photo and locked window): HDR → generated SDR reused the 4096 px Micro source in 2.622 s (3.366 GB whole app / 1.430 GB backend / 1.113 GB GPU helper), versus the earlier 34.960 s cache miss and 2.336 s cache hit. All nine action peaks stayed below 4 GB (max 3.557 GB), and all four SHA-256 hashes matched. [Replay and per-action peaks](../../codebase/output/grade-mem/scope-evict.jsonl)

## November 22, 2026 — Native Lensfun correction

MacBook Neo, A18 Pro and 8 GB unified memory. The isolated check ran three
alternating pairs of fresh development processes per RAW, using the previous
strip path at `4ee831eb` and the native path at `95cbb930`. The peak is
the backend's lifetime physical footprint at the end of correction, before
SDR finishing, in decimal MB.

| RAW and profile | Lens seconds before, median (range) | Lens seconds after, median (range) | Peak MB before, median (range) | Peak MB after, median (range) |
| --- | ---: | ---: | ---: | ---: |
| Canon `IMG_0790.CR2`, 5202 × 3464, EF-S 18–135 mm IS | 0.857 (0.817–0.873) | 0.127 (0.125–0.130) | 892.2 (883.9–896.1) | 853.4 (853.2–853.5) |
| Sony `_DSC7970.ARW`, 7968 × 5320, Sigma 65 mm F2 | 1.930 (1.923–1.959) | 0.262 (0.256–0.263) | 1,771.0 (1,767.0–1,773.3) | 1,705.6 (1,705.5–1,705.7) |

The corrected float32 image and the float and 8-bit sRGB SDR finish
matched on both RAWs. The six Sony TCA workers use at most 73.4 MB for
coordinate strips, plus 3.5 MB for the reference prefix and row seeds.
The Canon uses 50.2 MB in total at its width. The output image and
calibrated signed vignetting scratch are separate and do not overlap the
coordinate generation on the same photo.

The Grade replay used unpackaged Electron at 1408 × 794 under the GPU lock
with Sony `_DSC7970.ARW`, signed AHD, speck cleanup ×2.5, GPU Auto and
the 4 GB ceiling. The comparison is the kept-zoom run from the
[preceding check](#november-22-2026--lens-correction-speed) against one
replay at `c779c36c`. The three peaks are sampled independently in decimal GB.

| Action | Seconds before → after | Whole app GB before → after | Backend GB before → after | GPU helper GB before → after |
| --- | ---: | ---: | ---: | ---: |
| Open at Fit | 9.925 → 9.759 | 1.933 → 2.090 | 1.322 → 1.466 | 0.365 → 0.492 |
| Micro Grain at Fit, lens off | 20.556 → 18.456 | 2.224 → 2.243 | 1.112 → 1.151 | 0.669 → 0.712 |
| Zoom to 78%, lens off | 7.711 → 4.923 | 2.698 → 3.620 | 0.997 → 1.915 | 0.895 → 0.927 |
| Lensfun Auto at 78% | **55.381 → 40.307** | 3.221 → 3.354 | 1.985 → 1.996 | 0.580 → 0.608 |
| Exposure +0.25 EV | 2.181 → 2.172 | 3.136 → 3.118 | 1.043 → 1.063 | 0.876 → 0.873 |
| HDR to generated SDR | 2.518 → 2.502 | 3.108 → 3.104 | 1.211 → 1.203 | 1.045 → 1.049 |
| Generated SDR to HDR | 0.112 → 0.131 | 3.108 → 3.066 | 1.211 → 1.122 | 1.013 → 1.012 |
| Return to Fit | 0.008 → 0.007 | 3.056 → 3.183 | 1.126 → 1.132 | 1.013 → 1.073 |
| Return to 78% | 0.087 → 0.084 | 3.164 → 3.183 | 1.237 → 1.132 | 1.088 → 1.073 |

| Lensfun Auto stage | Before, s | After, s |
| --- | ---: | ---: |
| RAW read, decode and development before Lensfun | 17.867 | 10.534 |
| Lensfun on developed RAW | 3.394 | 0.618 |
| Bayer read, cleanup, reconstruction and noise fit | 0.014 (reused) | 0.012 (reused) |
| Micro Grain full-resolution render | 25.115 | 23.296 |
| Lensfun on the Micro Grain RGB | 3.425 | 0.361 |
| Micro source gain and scratch flush | 0.301 | 0.296 |
| Resize to preview size | 2.012 | 1.978 |
| Preview encode | 1.623 | 1.730 |
| Request handoff, Grade finishing and frontend wait | 1.620 | 1.482 |

The two lens stages saved 5.84 seconds in this replay. The non-lens
RAW development stage varied between runs. The full-resolution Micro
render is still the largest part of the wait. Exposure and generated SDR
reused the 4096 px source, and all four preview hashes matched the Grade
memory baseline. The highest sampled action was 3.620 GB during the
lens-off zoom. The memory sampler dropped one reading when a short-lived
`ps` process exited. Each action had a peak sample or used the immediately
preceding sample for the shortest actions.

The paired Library RAW driver passed. Canon and Sony GPU thumbnails
appeared in 0.712 and 0.864 seconds. The Sony CPU reference with Lensfun
took 5.14 seconds, versus 6.81 seconds previously. Its Lensfun stage took
0.417 seconds. Both cameras had the same reported perceptual differences
as the previous run. Canon Micro Grain Grade at 110% versus CPU delivery
passed with Lensfun off. HDR ΔE ITP mean 0.150 and p99 2.277, SDR ΔE 2000
mean 0.174 and p99 0.519, delivery peak 1000 nits. Full-size JPEG Ultra HDR
delivery took 30.55 seconds.

[Paired RAW measurements](../../codebase/output/native-lens/real-photo.jsonl)
· [Grade replay](../../codebase/output/native-lens/after.jsonl)
· [Backend stages](../../codebase/output/native-lens/after-backend.log)

## November 22, 2026 — Lens correction speed

MacBook Neo, A18 Pro with 8 GB unified memory, unpackaged Electron at
1408 × 794, Sony `_DSC7970.ARW` (42 MP), signed AHD, speck cleanup ×2.5,
Micro Grain on GPU Auto and the default 4 GB ceiling. Locked timing from
the action to the accepted Grade picture. The instrumented baseline uses
`39e66bf1`; the kept-zoom run uses the Bayer reuse in `4a3e1d4d`. The
three physical-footprint peaks are sampled independently in decimal GB.

| Action | Seconds before → after | Whole app GB before → after | Backend GB before → after | GPU helper GB before → after |
| --- | ---: | ---: | ---: | ---: |
| Open at Fit | 9.758 → 9.925 | 2.235 → 1.933 | 1.634 → 1.322 | 0.291 → 0.365 |
| Micro Grain at Fit, lens off | 18.575 → 20.556 | 2.221 → 2.224 | 1.100 → 1.112 | 0.683 → 0.669 |
| Zoom to 78%, lens off | 4.942 → 7.711 | 3.426 → 2.698 | 1.740 → 0.997 | 0.903 → 0.895 |
| Lensfun Auto at 78% | **81.141 → 55.381** | 3.578 → 3.221 | 2.119 → 1.985 | 0.710 → 0.580 |
| Exposure +0.25 EV | 2.412 → 2.181 | 3.584 → 3.136 | 1.405 → 1.043 | 0.953 → 0.876 |
| HDR to generated SDR | 2.515 → 2.518 | 3.309 → 3.108 | 1.439 → 1.211 | 1.038 → 1.045 |
| Generated SDR to HDR | 0.109 → 0.112 | 3.212 → 3.108 | 1.220 → 1.211 | 0.993 → 1.013 |
| Return to Fit | 0.086 → 0.008 | 3.212 → 3.056 | 1.220 → 1.126 | 0.993 → 1.013 |
| Return to 78% | 0.007 → 0.087 | 3.347 → 3.164 | 1.237 → 1.136 | 1.072 → 1.088 |

| Lensfun Auto stage | Before, s | After, s |
| --- | ---: | ---: |
| RAW read, decode and development before Lensfun | 8.774 | 17.867 |
| Lensfun on developed RAW | 3.127 | 3.394 |
| Bayer read, cleanup, reconstruction and noise fit | 6.577 | 0.014 (reused) |
| Micro Grain full-resolution render | 47.512 | 25.115 |
| Lensfun on the Micro Grain RGB | 6.845 | 3.425 |
| Micro source gain and scratch flush | 0.606 | 0.301 |
| Resize to preview size | 3.302 | 2.012 |
| Preview encode | 1.894 | 1.623 |
| Request handoff, Grade finishing and frontend wait | 2.478 | 1.620 |

The original flow completed a 1600 px Fit build, then returned to 78% and
built the requested 4096 px preview. The Fit build used 34.416 seconds in
the Micro source stage. It was where the 6.577-second sensor preparation
ran, so the second request could already reuse it. The two requests each
rendered the native image and remapped different copies of the same Micro
result. The kept-zoom run issued only the 4096 px request and reused the
GPU's matching Bayer preparation. The two remaining Lensfun passes correct
different images, the default developed RAW and the reconstructed Micro
RGB. Final encode to renderer completion took about 13 ms before and
25 ms after (the before value uses the zoom-completion event).

The old `scope-evict` replay finished in 54.019 seconds when it cancelled
1285 and 1600 px work. The new replay removes the extra request in either
case. A second observation with overlapping focused Python tests reached
53.289 seconds at 78% (11.748 seconds in RAW development, including 3.015
seconds in Lensfun). Use the unshared run above for the other action
timings. The 21.261-second RAW development and 7.711-second lens-off zoom
were slower in that run. The cause is unconfirmed. Both versions use the
same RAW decode and lens-off GPU zoom paths.

All actions stayed under 4 GB. All four reduced-preview SHA-256 hashes
matched the Grade memory baseline, including the generated SDR view.
Exposure and generated SDR reused the reduced source. Canon Micro
Grade at 110% versus CPU delivery passed (HDR ΔE ITP mean 0.150 / p99 2.282,
SDR ΔE 2000 mean 0.174 / p99 0.519; delivery peaked at 1000 nits). Canon CPU
JPEG Ultra HDR delivery took 30.44 seconds. The Library RAW check passed
on Canon and Sony, with Lensfun applied on the Sony. The GPU-backed
thumbnail took 0.72 / 0.84 seconds respectively, compared with 2.17 / 6.81
seconds for the CPU reference development in that driver.

[Profile summary](../../codebase/output/lens-speed/result.txt) ·
[Baseline](../../codebase/output/lens-speed/before.jsonl) ·
[Kept zoom](../../codebase/output/lens-speed/after.jsonl) ·
[Canon parity](../../codebase/output/lens-speed/parity.log) ·
[Library RAW](../../codebase/output/lens-speed/library-gpu-raw.log)

## November 22, 2026 — MacBook Neo Proof memory

MacBook Neo, A18 Pro, 8 GB, unpackaged Electron at 1408 × 794 under the shared
GPU lock. The same 42 MP Sony `_DSC7970.ARW` Clean Small test ran Q90 full-size
CPU delivery with Lensfun off, export first and Proof second. The baseline
is the November 21 MEM-1 run at `113a1c92`. The follow-up adds banded Proof
reconstruction on `a4debeb4`. Peaks are sampled macOS physical footprint.

| Action | To result before → after | Whole-app peak (B) before → after | Backend peak (B) before → after |
| --- | ---: | ---: | ---: |
| AVIF Gain Map export | 72.82 → 72.52 s | 6,688,700,888 → 6,940,474,176 | 5,842,867,576 → 6,066,001,536 |
| AVIF Gain Map Proof | 124.44 → 120.73 s | 11,014,604,392 → 6,746,209,040 | 10,193,674,712 → 5,948,184,072 |

Proof's whole-app peak fell 39%. The AVIF artifact and export SHA-256 matched
each other and the baseline. Both tile IDs and statistics also matched.
Synthetic AVIF and JPEG XL tile checks matched the whole-frame tile bytes,
unrounded peak nits and clipped percentage.

The new Proof peak is in the Python backend during full-frame HDR PQ/Y4M
preparation for the AVIF artifact, before the combine helper starts. The
backend accounts for 5.948 GB of the 6.746 GB peak. Later, the ceiling
check sampled `avifdec` at 4.039 GB within a 6.487 GB whole-app sample.
Once the artifact was ready, the largest logged tile sample was 5.044 GB,
including one `avifgainmaputil` at 2.585 GB and Python at 1.646 GB.
Meeting the 4 GB ceiling will require bounded AVIF preparation and ceiling
decoding, plus reducing the overlap between the retained Proof endpoints
and the tile helper's memory. [Driver log](../../codebase/output/proof-mem/avif-proof.jsonl) · [Run details](../../codebase/output/proof-mem/result.txt)

### Banded AVIF encoder inputs and ceiling check

Same MacBook Neo and 42 MP Sony delivery settings. The earlier Proof memory
run predates Steve's weighted Bayer fit, which the driver uses for RAW cleanup.
A second locked run with the delivery code from `0b9c6877` isolates the memory
change on the current fit. Each row is one run, with macOS physical footprint
sampled across the whole app.

| Action and revision | To result | Whole-app peak (B) | Backend peak (B) |
| --- | ---: | ---: | ---: |
| Export, earlier Proof memory run | 72.52 s | 6,940,474,176 | 6,066,001,536 |
| Export, same-revision control | 67.43 s | 7,025,867,752 | 6,178,952,904 |
| Export, banded preparation and ceiling check | 59.24 s | **5,541,590,864** | **4,682,568,264** |
| Proof, earlier Proof memory run | 120.73 s | 6,746,209,040 | 5,948,184,072 |
| Proof, same-revision control | 116.34 s | 6,949,927,888 | 6,150,116,992 |
| Proof, banded preparation and ceiling check | 105.50 s | **5,355,190,528** | **3,905,065,400** |

Export's whole-app and backend peaks both occurred during CPU rendition
rendering. Proof's whole-app peak occurred during tile tone-mapping, with
`avifgainmaputil` at 2.902 GB and Python at 1.650 GB. Its largest Python
sample occurred earlier while rendering the authored Proof endpoints.
The largest logged sample during the new ceiling check was 4.279 GB for
export and 4.232 GB for Proof, with `avifgainmaputil` reconstructing HDR.
In the same-revision control, `avifdec` alone reached 4.039 GB in a 6.480 GB
Proof ceiling-check sample.

The banded run and same-revision control produced identical export, artifact
and tile bytes, tile measurements and zero ceiling retries. They share a new
hash after the Bayer fit change. Both whole-app peaks remain above 4 GB.
Further reductions need less CPU render scratch and less overlap between the
retained Proof endpoints and the native tile helper.
[Driver log](../../codebase/output/proof-mem-2/avif-proof.jsonl) ·
[Run details](../../codebase/output/proof-mem-2/result.txt)

### File-backed frames and split Proof tile encoding

Same 42 MP Sony, full-size CPU Q90 AVIF Gain Map, Clean Small, Lensfun off
and peak guarantee on. The MacBook Neo used the 4 GB setting and a disposable
profile seeded with the CPU noise measurement from the whole-frame control.

| Action | To result before → after | Whole-app peak (B) before → after | Backend peak (B) before → after | Peak scratch with profile (B) |
| --- | ---: | ---: | ---: | ---: |
| AVIF Gain Map export | 59.24 → 55.10 s | 5,541,590,864 → **3,594,121,984** | 4,682,568,264 → 1,181,517,840 | 1,529,548,800 |
| Full-size AVIF Proof | 105.50 → 95.58 s | 5,355,190,528 → **3,564,122,976** | 3,905,065,400 → 1,170,639,416 | 1,564,164,096 |

The native helper led both whole-app peaks. It used 2.106 GB during export’s
ceiling reconstruction and 2.102 GB while tone-mapping the first Proof tile
to Y4M. The Python backend used 0.658 GB and 0.673 GB at those samples. Its
separate peaks were early in rendition preparation. Scratch peaks include
the disposable profile. Earlier runs did not sample scratch disk use.

Export and the Proof artifact matched SHA-256
`ff42ef7d45b291da5251ca354b7908845cb37ea68318d18a205c054a6a4bc431`.
Both Proof tiles, the retained endpoints and the displayed statistics
matched. The encoder accepted the first attempt in both actions.
[Driver log](../../codebase/output/proof-mem-3/avif-proof.jsonl) ·
[Run details](../../codebase/output/proof-mem-3/result.txt)

### November 22 — PROOF-MEM-3 review check

MacBook Neo, review fixes through `bd29d74f`. The locked Electron run used
the same Sony RAW, Clean Small, seeded CPU noise measurement, Q90 gain map,
1408 × 794 window and 4 GB app limit.

| Action | To result | Whole-app peak (B) |
| --- | ---: | ---: |
| AVIF Gain Map export | 58.82 s | 3,635,475,296 |
| Full-size AVIF Proof | 98.23 s | 3,764,139,112 |

Export, the Proof artifact, both tiles and both retained endpoints matched
the earlier hashes. The tile statistics also matched and neither action
retried its encode. The native tone-map helper accounted for 197 MB of the
200 MB increase in the sampled Proof peak. The temporary driver's teardown
failed after both results had been recorded. The production sweep removed
the abandoned test root when aged. [Driver log](../../codebase/output/proof-mem-3b/avif-proof.jsonl)

## November 21 — Byte-exact Lensfun strips on MacBook Neo

MacBook Neo, A18 Pro and 8 GB unified memory. Isolated CPU RAW development
with Lensfun 0.3.4 via lensfunpy 1.18.0 and the `2ac61a8f` whole-frame
path as reference. Three fresh processes for each method and photo.
The kernel's peak physical footprint is read at the end
of lens correction, before finishing. Both methods use the same float32
RAW input, profile and bilinear remap. Values are decimal MB.

| RAW | Whole-frame coordinates, median (range) | Exact strips, median (range) | Median peak RAM saved |
| --- | ---: | ---: | ---: |
| Canon `IMG_0790.CR2`, 5202 × 3464, manual EF-S 18–135 mm IS | 1,349.3 (1,348.9–1,353.6) | 887.5 (887.3–888.8) | 461.8 MB |
| Sony `_DSC7970.ARW`, 7968 × 5320, Auto Sigma 65 mm F2 | 2,826.1 (2,824.1–2,838.7) | 1,768.3 (1,764.3–1,768.4) | 1,057.9 MB |

Both RAWs matched every coordinate in both layouts, the corrected float32
image, the finished float SDR image and its 8-bit sRGB encoding. These
peaks cover the backend process through lens correction. Windows
confirmation is open.
[R2-6](briefs/sprint-denoise-gpu-logging-2026-11-21.md#mem-1--one-memory-budget-on-the-macbook-neo-overnight)
· [Mac measurements and hashes](../../codebase/output/r2-6-lens/)

## November 21, 2026 — MacBook Neo MEM-1

MacBook Neo, A18 Pro and 8 GB unified memory, app `0.9.3` at `113a1c92`.
Unpackaged Electron at 1408 × 794 points under the shared GPU lock, disposable
profiles, default 4,000,000,000-byte app ceiling and the unmodified 7968 × 5320
Sony `_DSC7970.ARW` with harsh-speck cleanup ×2.5. GPU Auto selected 2 GiB
except in the Custom run. Grade times end at the accepted sharp frame, or
the accepted reduced frame for lens-on Micro. Slider times start at release.
Memory is sampled macOS physical footprint, in decimal GB unless given in bytes.
The frame time and peak sample can fall at different points within an action.
A dash means the action finished between memory samples. [Run logs](../../codebase/output/mem-1-mac/)

### Grade

| Method and action | To picture | Accepted Grain route | Peak app RAM |
| --- | ---: | --- | ---: |
| Clean Small, Auto, enable at HDR Fit | 8.94–9.08 s | GPU, exact 1285 px | 2.34–2.37 GB |
| Clean Small, Auto, zoom to 110% | 0.71–0.73 s | GPU, exact native region | 2.09–2.10 GB |
| Clean Small, Auto, pan at 110% | 0.68–0.69 s | GPU, exact native region | 2.68–3.16 GB |
| Clean Small, Auto, release Grain Evenness | 1.18 s | GPU, exact native region | 2.40 GB |
| Clean Small, Custom 0.25 GiB, enable at HDR Fit | 18.75 s | CPU preparation, WebGPU draw, exact 1285 px | 2.00 GB |
| Clean Small, Custom 0.25 GiB, zoom to 110% | 0.51 s | CPU preparation, WebGPU draw, exact native region | 1.73 GB |
| Clean Small, Custom 0.25 GiB, pan at 110% | 1.02 s | CPU preparation, WebGPU draw, exact native region | 2.92 GB |
| Clean Small, Custom 0.25 GiB, release Grain Evenness | 2.42 s | CPU preparation, WebGPU draw, exact native region | 2.00 GB |
| Micro, Auto, lens off, cold enable at HDR Fit | 20.90 s | GPU, exact 1285 px | 2.19 GB |
| Micro, Auto, lens off, zoom to 110% | 1.78 s | GPU, exact native region | 2.55 GB |
| Micro, Auto, lens off, pan to second region | 1.63 s | GPU, exact native region | 3.06 GB |
| Micro, Auto, lens off, release Luminance | 1.38 s | GPU, exact native region | 2.90 GB |
| Micro, Auto, lens off, release Color | 0.81 s | GPU, exact native region | 2.83 GB |
| Micro, Auto, lens off, release Detail | 0.78 s | GPU, exact native region | 2.71 GB |
| Micro, Auto, lens off, return to Fit | 15.49 s | GPU, exact 1285 px | 2.64 GB |
| Micro, Auto, lens off, Fit HDR → generated SDR | 0.054 s | GPU, exact 1285 px, reused Fit | — |
| Micro, Auto, lens off, Fit generated SDR → HDR | 0.045 s | GPU, exact 1285 px, reused Fit | — |
| Micro, Auto, Lensfun Auto, enable at 78% | 46.95 s | CPU, reduced 4096 px | **5.465 GB** |
| Micro, Auto, Lensfun Auto, Exposure +0.25 EV at 78% | 46.99 s | CPU, reduced 4096 px, fresh preparation | **4.794 GB** |
| Micro, Auto, Lensfun Auto, HDR → generated SDR at 78% | 45.90 s | CPU, reduced 4096 px, fresh preparation | **4.455 GB** |
| Micro, Auto, Lensfun Auto, generated SDR → HDR at 78% | 0.034 s | CPU, reduced 4096 px, returned to prepared picture | 2.72 GB |
| Micro, Auto, Lensfun Auto, return to Fit | 0.010 s | CPU, existing reduced 4096 px picture | — |
| Micro, Auto, Lensfun Auto, return to 78% | 0.010 s | CPU, existing reduced 4096 px picture | — |

At 110%, Micro held the same crop through all three sliders. At 78% it held
the crop through Exposure and both lane changes and returned to the same
position after Fit. No blocks or colour bands were visible in the sampled
GPU pan, GPU SDR Fit, or lens-on HDR and SDR views. The CPU run described
the 4096 px picture as limited and said export was full size. The backend
logged 44.58 s of initial preparation, 44.72 s of fresh preparation on the
Exposure action, and 43.58 s on the first SDR switch. The largest process
at the initial 78% peak was Python, 2,710,195,296 bytes, followed by the
Chromium GPU helper at 2,228,798,976 bytes. The retained source and
original shared 508,677,120 bytes, and the reported working cache was empty
at that sample. The same sample has 2,201,518,176 backend bytes beyond the
retained source.

An allocation replay of the first lens-on action found **1,017,354,240 B**
in full-frame Lensfun coordinates, **508,677,120 B** each in its input
and output, **508,677,120 B** in the retained Grade source, and
**84,779,520 B** in the prepared Bayer sensor. The trace did not identify
a separate Bayer tile cache allocation. At the sample's 2,741,521,672 B
backend footprint, those named arrays leave **113,356,552 B** unassigned.
The GPU helper reached **2,561,476,120 B** at the replay's
**5,843,088,176 B** whole-app peak. Its internal allocations were beyond
the scope of the backend trace.
[Micro lens allocation trace](../../codebase/output/mem-1-mac/micro-lens-allocation.jsonl)

On cold GPU Micro Fit, the source preparation request lasted 7.73 s and
the exact reduction stage lasted 12.96 s. The 66 Bayer region responses
occupied 11.25 s of wall time across this action and transferred 228.2 MB.
The final submission reached the presentation callback in 6.7 ms. The
first 110% pan took 1.63 s, including nine Bayer responses spanning 0.75 s
and 15.6 MB of data. The measured region work totalled 0.79 s, includes
fetches, and overlaps the measured proxy work. Submission to presentation
took 8.1 ms. The app timings cannot split GPU upload, demosaic, Grain
resolve and reduction into separate hardware times. The Metal trace was
unavailable. [Micro Grade log](../../codebase/output/mem-1-mac/grade-micro-off-1.jsonl)

### Native AVIF Gain Map export and Proof

Clean Small on both generated renditions, Lensfun off, Q90, original
size, no metadata, peak guarantee on and CPU delivery selected as in the
checklist. Proof followed export in the same profile with a 1000-nit target.
Both completed and the encoded Proof and export hashes matched.
The separate Windows PC observation was about 6.2 GB for the standalone
backend working set. Mac physical footprint is a different measure and
includes memory charged to the process after macOS compresses it.
[Mac driver results](../../codebase/output/mem-1-mac/avif-proof.jsonl)

| Action and accepted route | To result | Whole-app peak | Backend peak | Largest process and stage at both peaks |
| --- | ---: | ---: | ---: | --- |
| Full-size AVIF Gain Map export, CPU | 72.82 s | **6,688,700,888 B** | **5,842,867,576 B** | Python backend, HDR Y4M preparation before the combine helper |
| Full-size AVIF Gain Map Proof, CPU | 124.44 s | **11,014,604,392 B** | **10,193,674,712 B** | Python backend, full-size Proof reconstruction after the encoded artifact was ready |

At each peak Grade retained **508,677,120 B**. The source and Retouch
original shared those bytes and the Library cache census reported 0 B.
Each finished float32 RGB rendition is **508,677,120 B**. The one shared
Grain result has the same byte size during render. It is released before
the export writes Y4M and Proof's file-backed copy is unmapped before AVIF
encoding and final reconstruction. Proof retains two endpoint planes of
**508,677,120 B** each, the authored HDR and the SDR converted to the
matrix working space. The SDR conversion runs in bands and precedes the
final Proof peak. The two Proof reconstruction requests can overlap.

After deducting the source and two known full-frame planes, the baseline
backend samples leave **4,316,836,216 B** in export and **8,667,643,352 B**
in Proof without individual allocation attribution. The process census
assigns the remaining **845,833,312 B** and **820,929,680 B**, respectively,
to the other app processes in those samples.

The allocation replay put **6,121,287,044 B** of live traced allocations
at the sampled **5,833,348,568 B** export backend footprint. Its stack
was converting the finished HDR rendition to BT.2020 PQ for Y4M.
A nearby allocation snapshot includes the retained source and both finished
renditions at **508,677,120 B** each, a full-frame BT.2020 intermediate
of the same size, and four PQ transfer arrays totalling **2,034,708,480 B**.

During Proof reconstruction, both target requests were in the gain-map
formula simultaneously. One stack sample identifies **5,086,771,200 B**
in ten distinct named arrays. Two are the shared endpoints. Each request
holds its own clipped endpoints, log-gain and normalized gain planes.
A nearby allocation snapshot attributes **9,156,188,160 B** to
reconstruction temporaries from gain and RGB math and array clipping,
in addition to **1,526,031,360 B** for the retained source and endpoints.
At the replay's **10,804,945,872 B** backend footprint peak, the live
allocation census read **10,445,206,055 B**. Traced allocation sizes and
charged footprint measure different things. The original peaks above use
the uninstrumented run. [Backend allocation trace](../../codebase/output/mem-1-mac/avif-proof-allocation.jsonl)

The AVIF combine helper was recorded at **1,968,604,960 B** during export
and **1,928,627,976 B** during Proof. Export's `avifdec` reached
**3,948,924,096 B** in a separate peak-check sample. During Proof tile
encoding, one `avifgainmaputil` process was sampled at **2,779,089,392 B**
and an earlier sample had two helpers at **2,028,717,904 B** and
**1,531,905,488 B** concurrently. The largest whole-app samples in the table
had no AVIF helper. [Delivery log](../../codebase/output/mem-1-mac/avif-proof-backend.log)

## November 21 — Windows PC Denoise follow-up (INT-2)

Unpackaged Electron at 2560 × 1440 under the shared GPU lock. Sony
`_DSC7970.ARW` (7968 × 5320), harsh-speck cleanup ×2.5, fresh app per
condition. Tests used the existing 10% timing allowance and required peak
RAM not to rise. RAM is sampled across the whole app in decimal GB.

| Grade action at `0e1563d4` | OpenCV one thread | OpenCV default (12) | Conditions |
| --- | ---: | ---: | --- |
| CPU Micro Grain, first sharp at 110% | 11.13 s / 2.12 GB | 9.92 s / 2.20 GB | Lensfun Auto, verified CPU region and exact native presentation |
| CPU Micro Grain, settled Fit | 31.24 s / 3.61 GB | 27.28 s / 3.74 GB | From the first 110% frame to exact 1610 px Fit |
| Forced-CPU Clean Small, first sharp at 110% | 4.13–4.14 s | 4.15–4.16 s | Lens off, Evenness 0.65, native model warmed in Grade |
| Forced-CPU Clean Small, peak and all native tiles | 2.12–2.34 GB / 11.89–12.20 s | 2.37–2.47 GB / 11.77–12.05 s | Two fresh apps per setting in one-thread, default, default, one-thread order |

Both Clean Small settings used five workers, with 29 foreground and 218
background tiles in every run. Tile completion time was similar. The earlier
one-thread RAM increase at `35a6b9ce` did not repeat at the integrated tip.
Per-process samples showed transient peaks in Python and Chromium at
different times, leaving the cause of the earlier increase unresolved.
The default was faster for Micro Grain but raised its RAM at both views.
The shipping setting stays at one thread.

For AVIF Gain Map delivery, both revisions exported the same Sony Clean Small
grade at native size, Q90, dithering off, with CPU delivery forced. Each run
used a fresh profile. The cold session never opened Grade. The warm session
waited for its finished Grade preview and native GPU noise measurement.

| CPU AVIF export | Cold | After Grade |
| --- | ---: | ---: |
| Round-one base `deb2fc6f` | 80.79 s | 79.50 s |
| Integrated tip `0e1563d4` | 64.89 s | 64.04 s |

Both revisions produced cold SHA-256
`42b82f61a4c7f818b339cd3026937683b846641fc5d4a304dbb5b2f050351fdb`
and warm SHA-256
`845c9495f9a6146ee857872072287379df8179d18e925d3d1bf724ba5ec3adbb`.
Across all decoded pixels, the cold-to-warm difference was HDR ΔE ITP
0.669 mean / 2.075 p99 and SDR ΔE 2000 0.136 mean / 0.663 p99.
Cold delivery measured the native source on the CPU. Warm delivery reused
the GPU noise model under the same native cache key, a behavior already
present in round one. Export behavior remains open for Steve's decision.

## November 21 — Windows PC Denoise triage (INT-2)

Unpackaged Electron at 2560 × 1440, Sony `_DSC7970.ARW` (7968 × 5320),
lens off and harsh-speck cleanup ×2.5. Each sample used a fresh app under
the GPU lock. RAM is sampled whole-app use in decimal GB. The existing 10%
timing allowance applies.

| Action | First sharp at 110% | All 247 native tiles | Peak RAM | Revision or condition |
| --- | ---: | ---: | ---: | --- |
| Forced CPU Clean Small | 4.01 s | 14.73 s | 2.21 GB | Round one, `411f0cc6`. INT-2a had sampled 2.38 GB here. |
| Forced CPU Clean Small | 4.02 → 3.81 s | 14.76 → 12.29 s | 2.42 → 2.19 GB | Immediately before and after CG-2, `386c05d0` → `ad5e7554`. |
| Forced CPU Clean Small | 3.76 → 3.68 → 3.59 s | 12.36 → 12.27 → 12.25 s | 2.42 → 2.47 → 2.42 GB | After MG-1 (`665c06b5`), pre-MEM-1 (`35a6b9ce`), and integrated triage (`6bb48eee`). |
| Forced CPU Clean Small | 3.53–3.55 → 3.54–3.59 s | 12.08–12.10 → 12.15–12.22 s | 2.05–2.15 → 2.38–2.65 GB | Same `35a6b9ce` code, alternated OpenCV default (12 threads) and MG-1's one-thread setting across four fresh apps. |

The same-revision comparison isolates MG-1's startup OpenCV setting as a
contributor to the peak increase first seen in INT-2a (2.38 → 2.61 GB).
The largest resident process varied between runs. Changing OpenCV's
process-wide setting during a request is unsafe, and reverting it at
startup would also change threading for Micro Grain's tile workers. The
startup setting remains as shipped.

For MEM-1, SHA-256 matched on the finished GPU Clean Small HDR and SDR
Grade frames at Fit and 110%. The comparison used `35a6b9ce`, the first
parent of the MEM-1 merge, and the integrated `6bb48eee`.

With matching GPU Grade warm-up, full-size CPU AVIF Gain Map export was
62.03 → 67.71 s (peak whole app 7.15 → 7.21 GB) from `35a6b9ce` to
`6bb48eee`. Export SHA-256 matched: `25eb92e41746dcb64694de5291384026ca447fa0548440da223f96ffa9d2a2d2`.
Proof produced the same file hash on both revisions. The exploratory
pre-MEM-1 cold export differed from its Proof before the Grade warm-up was
matched. Proof took 103.82 s after the warm-up on `6bb48eee`; the cold
pre-MEM-1 observation was 108.94 s, with different starting caches.

## November 21 — Windows PC interim Denoise integration (INT-2a)

Unpackaged Electron at 2560 × 1440, Sony `_DSC7970.ARW` (7968 × 5320)
from the shared staged copy, harsh-speck cleanup ×2.5, one observation per
condition under the same GPU lock. Times start at the user action. RAM is
sampled whole-app use in decimal GB. Use the existing 10% timing allowance
for shared-machine variation.

| Action | Comparison | Conditions |
| --- | --- | --- |
| Lens-corrected CPU Micro Grain, first sharp at 110% | 10.07 s, 2.11 GB | `35a6b9ce`, Lensfun Auto, native AVIF viewport. Earlier MG-2 RGBA8 sample was 10.38 s, 2.05 GB. |
| Lens-corrected CPU Micro Grain, settled Fit | 29.30 s, 3.43 GB | `35a6b9ce`, straight from the initial 110% picture, exact 1610 px AVIF. Earlier MG-2 sample after panning was 27.30 s, 3.43 GB. |
| Forced CPU Clean Small, first sharp at 110% | 3.48 → 3.50 s | Same `35a6b9ce` code, OpenCV default (12 threads) → shipping one thread. Lens off, CPU preparation and WebGPU presentation. A temporary launch hook restored the OpenCV default at the startup call, then was removed. |
| Forced CPU original-size Q90 SDR JPEG export with Clean Small | 19.13 → 18.01 s | Same OpenCV pair. Timed from Export to the completed file and status. JPEG bytes were identical. |
| Forced CPU Clean Small, first sharp / all native tiles / peak RAM | 3.85 → 3.50 s / 14.01 → 11.84 s / 2.38 → 2.61 GB | `411f0cc6` → `35a6b9ce`, isolated apps in the same locked run, lens off. Current tip also measured 2.48 GB with OpenCV at its default. The revision comparison includes the other round-two changes. |

## November 21 ? Windows PC CPU Micro Grain visible area

Windows PC, Ryzen 5 7600, unpackaged Electron at 2560 ? 1440, Sony
`_DSC7970.ARW` (7968 ? 5320), HDR Grade, Lensfun Auto applied and harsh-speck
cleanup ?2.5. MG-2 uses the region renderer in `2fbd9672`, based on `52c94217`. Use the existing 10% timing
allowance for shared-machine variation. RAM is sampled whole-app use in
decimal GB. The locked runs used RGBA8 for native detail. Separate targeted
checks cover the final HDR AVIF response, whose viewer latency remains open.

| Action | Earlier observation | MG-2 verification | Conditions |
| --- | ---: | ---: | --- |
| First CPU Micro Grain picture | 58.04 s / 3.07 GB | 10.38 s / 2.05 GB | Earlier MG-1 was a reduced 4096 px picture at 78% with the withdrawn Lensfun strip trial. MG-2 is sharp native detail at 110%. |
| Pan to the far corner | No native detail | 3.81 s / 1.95 GB | At 110%, outside the initial tile region. The first MG-2 run sampled 2.68 GB during the pan. |
| Fit immediately after panning | ? | 0.012 s | Approximate 960 px underlayer at Fit layout. |
| Settled CPU Micro Grain Fit | 29.93 s / 4.10 GB | 27.30 s / 3.43 GB | 1610 px. The final Fit follow-up releases cached tiles as their pixels are copied into the whole frame. |

Both native Sony regions (centre and lower right, about 43 MB of float32
pixels together) matched independent whole-frame CPU development and Grade
byte for byte. Canon Lensfun coverage used signed inputs with distortion,
TCA, vignette and indexed crop/rotation. The cold Sony first picture is
still about ten seconds. MacBook Neo memory has yet to be measured.
## November 21 — AVIF Gain Map and full-size Proof Grain sharing

Windows PC, standalone production CPU export and Proof on Sony
`_DSC7970.ARW` at 7968 × 5320, with Clean Grain Small in both renditions.
Default encoding settings and developed RAW, from invocation to encoded
result or ready Proof artifact. One sample per action and revision.
Before was `52c94217`. After was DLV-1 on `sprint/delivery-grain-share`.
The initial five-minute GPU lock expired during the last arm, so only the
after Proof sample was completed in a second locked run. Export before
included a cold noise-model measurement of about one second. The other
arms reused that model. Peak RAM is the standalone backend working set
sampled every 20 ms, with a 5% allowance for sampling variation.

| Action | Wait before → after | Peak RAM before → after | Grain renders |
| --- | ---: | ---: | ---: |
| AVIF Gain Map export | 54.51 → 44.88 s | 6.211 → 6.206 GB | 2 → 1 |
| Full-size AVIF Proof | 94.56 → 60.08 s | 6.212 → 6.205 GB | 4 → 1 |

All four encoded files had SHA-256
`dc36fa40678dfe5070ad831d3d4e99b0c1894a6677cd544ea282db124634ef8c`.
Both rendered Proof endpoints matched their own before hashes as well.
The one shared RGB Grain frame is 508,677,120 bytes at this resolution.
The native AVIF path already exceeded the 4 GB app ceiling in this CPU test.

## November 21 — Windows PC GPU Grain Fit scheduling trial

Windows PC, unpackaged Electron at 2560 × 1440 and a 2 GiB graphics
setting. Sony `_DSC7970.ARW` (7968 × 5320), HDR Grade, lens correction
off, harsh-speck cleanup ×2.5. One locked Electron run on base
`411f0cc6`, first with the original renderer and then with the trial
renderer. The second arm reused the backend process. In particular,
the full cold Clean and Micro enable waits include startup and source
preparation, and their differences cannot be attributed to the shaders
or queue changes alone.

| Action | Original renderer | Trial renderer | Timed stage |
| --- | ---: | ---: | --- |
| Micro Color at 110% (62%, 43%, 71%) | 1.94 / 1.68 / 1.65 s | 1.61 / 1.81 / 1.73 s | The three settled waits showed no consistent gain. |
| Micro enable to exact Fit | 24.15 s | 12.67 s | Exact native reduction 15.02 → 12.47 s. |
| Cold Clean Small enable to exact Fit | 8.79 s | 4.18 s | Native fit 1.79 → 1.86 s, native reduction 2.49 → 2.18 s. |

The GPU produced matching full-frame SHA-256 hashes in all five pairs.
The two Fit captures were 1610 × 1075 and included all four photo edges
after the native strip reduction. The three native captures were 2462 ×
1333 and included partial tiles. All five pairs stayed on the GPU. The run
used wall-clock stage timing. It did not collect per-pass GPU timestamps.

`bef10902` keeps the Fit scheduling change: two cores sharing one Bayer
band submit together, and at most two Fit reduction rectangles are queued.
Clean did not use the experimental halo trim, so its reduction stage
isolates the scheduling change. The Micro trial also trimmed late colour
work. That trim did not consistently improve the slider and was dropped.
The timing of Micro Fit with the final scheduling-only patch still needs an
isolated pair. AHD resource pooling, calibration fetch overlap and
measurement-submit batching remain open without measured user-visible gains.
On the MacBook Neo, profile the AHD, wavelet and colour passes separately,
and check Fit queue overlap and peak app memory on both the Canon and Sony.

## November 21 — Adaptive Denoise parity check

Unpackaged Electron on the Windows PC at 2560 × 1440, with a 1500 × 1000
synthetic noisy TIFF. The driver selects Standard explicitly and uses CPU
preparation with WebGPU reconstruction for Fine and Clean Grain. These
single observations include diagnostic readback.

| Action | Pre-sprint `f424bbdd` | Sprint `629d8898` with updated driver |
| --- | ---: | ---: |
| Fine Grain preparation and readback | 1.33 s | 1.28 s |
| Clean Grain preparation and readback | 1.20 s | 1.28 s |
| Clean Grain live blend and readback | 0.68 s | 0.67 s |

## November 21 — Grade Grain forced-budget recovery replay

Windows PC, RTX 4070 Ti, unpackaged Electron at 2560 × 1440, working changes
based on `0ab656bb`. Clean Grain Small at Fit on the approved 7968 × 5320
`_DSC7970.ARW`, lens off and harsh-speck cleanup ×2.5. This single
forced-budget replay verifies routing and gives no same-condition speed comparison.

| Action | Total wait | Conditions |
| --- | ---: | --- |
| Enable under forced Grain budget | 23.11 s to return with CPU Grain ready | 128 MiB test budget. The backend spent 16.65 s preparing Grain. |
| Restore Auto and retry | 5.81 s to accepted GPU picture | Same action ID, prior noise measurement reused. The entire two-phase action took 28.92 s. |

## November 21 — Windows PC CPU Grain sprint

Windows PC, isolated Electron at 2560 × 1440, Sony `_DSC7970.ARW`
(7968 × 5320), Clean Grain Small, lens correction off and harsh speck
cleanup at ×2.5. Grain preparation was forced to the CPU with normal GPU
presentation. The baseline `f424bbdd` and the first implementation ran in
one GPU-lock session. Rounds two and three each used one more locked session
under the same conditions, building on `dbe4a215` and `68944ed0` respectively.

| Action | Baseline | First implementation | Round two | Round three | Conditions |
| --- | ---: | ---: | ---: | ---: | --- |
| Enable at 110% to the first sharp picture | 21.94 s | 17.34 s | 4.74 s | 4.25 s | Windows PC, cold Grade preparation, HDR |
| Release Grain Evenness at 110% to the matching sharp picture | 19.62 s | 15.80 s | 3.11 s | 2.63 s | Windows PC, HDR, whole-photo grain fit reused |
| Whole-photo preparation, enable / release | 17.28 / 15.63 s | 17.49 / 15.83 s | 15.07 / 13.30 s | 15.69 / 13.98 s | Windows PC, from preparation start to all native tiles ready |
| Sampled peak whole-app RAM, enable / release | 2.21 / 2.39 GB | 2.34 / 2.57 GB | 2.54 / 2.74 GB | 2.33 / 2.24 GB | Windows PC, through native fill, decimal GB |
| Backend RAM at the whole-app peak, enable / release | — / 1.22 GB | — | 1.23 / 1.41 GB | 0.96 / 0.85 GB | Windows PC, charged bytes at each action's whole-app peak |

Round two met the quarter-wait target of 5.49 s. Whole-photo preparation
improved by 13% on enable and 15% on release. On enable the cached noise-model
request took 7 ms, grain fit 1.16 s, scratch setup 4 ms and the visible-tile
batch 1.49 s. The renderer
loaded reduced and native source proxies, then drew 12 GPU tiles for the
visible picture. The quick underlayer issued no prepared Fit read.
The native queue logged 29 foreground and 218 background CPU tiles across
the enable. Summed worker times were about 74 s each for wavelet and colour,
and 0.69 s for writes. The 2.74 GB release peak included 1.41 GB charged to
the backend and 1.08 GB across the two largest Electron processes.

Round three capped simultaneous native Grain workspaces across Grade and
Library at five on the 12-logical-CPU PC. The isolated Sony backend peaked
at 0.92 GB working set, down from 1.31 GB with round two's twelve workers.
Both returned to about 0.61 GB at fill completion. The same source, scratch
reservation and cache produced byte-identical native pixels and sampled Fit
reads on both Sony and Canon. The locked run met the first-picture and RAM
targets. The 30% whole-photo speed target remains open.

The Windows PC offline comparison against `f424bbdd` matched the bytes of
the entire native image and sampled Fit reads for Sony `_DSC7970.ARW` and
Canon `IMG_0790.CR2`. On the Sony, the contiguous layout reduced summed
worker time writing scratch from 12.45 s to about 0.70 s. Round two matched
the bytes again after switching to append-on-write scratch, batching scratch
reads and reusing wavelet and colour arrays. The 768-pixel trial with six
workers finished the Sony in 10.73 s and peaked at 1.53 GB in the offline
backend. The same trial series measured 1.33 GB for the baseline backend.
Twelve workers with 768-pixel tiles raised that peak to 2.32 GB for 10.64 s.
The app keeps the existing 512-pixel tile size.
## November 21 — Windows PC native Clean Grain colour

One locked run on the CG-2 build in unpackaged Electron at 2560 × 1440.
Sony `_DSC7970.ARW` (7968 × 5320), Clean Grain Small, lens correction off,
harsh speck cleanup ×2.5 and a cached noise model. Grain ran on the CPU
with GPU presentation. The CPU-1 values are its round-three enable sample.

| Action | CPU-1 | CG-2 |
| --- | ---: | ---: |
| Enable at 110% to the first sharp picture | 4.25 s | 4.19 s |
| Whole-photo preparation through all native tiles | 15.69 s | 14.16 s |
| Sampled peak whole-app RAM through native fill | 2.33 GB | 2.42 GB |

Whole-photo preparation was 18% faster than the original 17.28 s enable
baseline. The 30% target remains open, and the sampled RAM rose by 0.09 GB
against CPU-1. All 859 native Canon and Sony tiles matched the bytes of the
original preparation across both splotch sizes. An earlier Sony corner probe
showed two differing float32 values before packing. The original OpenCV
magnitude stage reproduced that variation when compared with itself, and
the complete repeat matched even before packing.

## November 21 — Large-photo Grain in Grade

Windows PC, unpackaged Electron at 2560 × 1440, 2 GiB graphics setting,
device texture edge 16,384, HDR Grade and lens correction off. Measured
once on the GPU-1 implementation based on `f424bbdd`, from action start
through the settled picture. Fine Fit includes the first calibration.
Clean Small Fit reused the calibration. The 110% rows are warm zoom
transitions using a 2462 × 1332 native viewport. App peak is sampled
whole-app memory. GPU peak is the larger of the renderer's logical estimate
and the recorded resident-plus-reservation total, in bytes.

| Input | Method | View | GPU wait (s) | Fit / reduction reservations (B) | GPU peak (B) | App peak (B) |
| --- | --- | --- | ---: | --- | ---: | ---: |
| DSC00636.ARW, 8660 × 5784 | Fine | Fit | 15.28 | 85,599,904 / 108,601,968 | 232,531,688 | 1,969,376,105 |
| DSC00636.ARW | Fine | 110% | 1.80 | Reused | 284,674,512 | 2,117,039,245 |
| DSC00636.ARW | Clean Small | Fit | 6.12 | Reused / 158,722,864 | 389,847,792 | 3,179,560,955 |
| DSC00636.ARW | Clean Small | 110% | 1.30 | Reused | 406,139,312 | 2,202,131,890 |
| Synthetic linear TIFF, 9504 × 6336 | Fine | Fit | 7.94 | 85,599,904 / 106,361,336 | 231,337,560 | 2,722,068,767 |
| Synthetic linear TIFF | Fine | 110% | 2.02 | Reused | 323,593,752 | 3,219,134,752 |
| Synthetic linear TIFF | Clean Small | Fit | 6.14 | Reused / 156,157,368 | 406,279,304 | 3,646,434,739 |
| Synthetic linear TIFF | Clean Small | 110% | 1.32 | Reused | 483,514,248 | 2,529,585,441 |

The prior calibration refused both sizes at either zoom before reserving
GPU Grain memory. CPU fallback wait and memory were not measured in this
run. In a separate locked Windows PC merge check at the same graphics setting,
the Sony stayed on the GPU in Clean Small at Fit and 110%, and in Bayer Micro
Grain at 110%. The correlated log recorded 85,599,904 B for calibration,
158,722,864 B for Clean Fit reduction and 77,083,920 B per admitted Micro
Bayer region. Finished-pixel CPU agreement and the large Bayer Micro Fit
check remain open.

## November 21 — CPU Micro Grain tile workers

Windows PC, Ryzen 5 7600, unpackaged Electron at 2560 × 1440 under the shared
GPU lock. Sony `_DSC7970.ARW` (7968 × 5320), Lensfun Auto, harsh-speck
cleanup ×2.5, 78% zoom. The GPU refused Micro Grain with lens correction on.
Use the existing 10% timing allowance for these single observations and
for the separate CPU export comparison. Grade RAM is the sampled whole-app
peak in decimal GB.

| Action | Before | With tile workers and trial lens strips | Conditions |
| --- | ---: | ---: | --- |
| First CPU Micro Grain picture | 84.07 s | 58.04 s | Windows PC, HDR, reduced 4096 px picture. Before is the TRI-1 Full-tier measurement. |
| Peak app RAM during first picture | 3.58 GB | 3.07 GB | Windows PC, same Grade observations. |

The replay on `411f0cc6` logged 82.88 s for the CPU preview request and showed
the reduced picture. The driver initially waited for a full-resolution picture
and skipped baseline export. It accepted the reduced picture on the changed
run. The five-minute lock expired while the app was exporting. The Lensfun
strip trial later failed byte parity and was withdrawn. The 58.04 s and
3.07 GB observations include the trial and need a repeat on the final code.

A separate paired Windows PC run called the production CPU exporter directly,
after opening the same RAW. Original-size Q90 Ultra HDR JPEG, both renditions
on Micro Grain, the HDR peak guarantee enabled and metadata off. Export time
was 100.46 s on `411f0cc6` and 59.71 s on `2309417c`. The encoder wrote the
same SHA-256 on both: `8d5256cf05dacbc6c540e4075e22c5b832714eaaaa438993be4d61802a858706`.
Lens-corrected RAW development and native Micro Grain output also matched
byte for byte on Canon `IMG_0790.CR2` (manual EF-S 18–135 profile) and the
Sony (Auto). The paired JPEG exports used the Sony.

## November 21 — CPU Micro Grain source reuse

Windows PC, Ryzen 5 7600, unpackaged Electron at 2560 × 1440 under the shared
GPU lock. Sony `_DSC7970.ARW` (7968 × 5320), Lensfun Auto applied, speck cleanup
at ×2.5, 78% zoom, Full tier. The GPU refused Micro Grain because lens
correction was on, so Grade presented the 4096 px CPU picture. Timing starts
at the action and ends after the updated picture appears. Repeated timings
use a 10% noise allowance. Peak app RAM is sampled across the app's processes
against the existing 4 GB Denoise ceiling. Fast tests were running during
parts of the measurements.

| Action | Before (`deb2fc6f`) | With source reuse | Peak app RAM before / after | Conditions |
| --- | ---: | ---: | ---: | --- |
| First Micro Grain picture | 83.79 s | 84.07 s | 3.63 / 3.58 GB | Windows PC, cold CPU Micro preparation at 78%, HDR. |
| Exposure +0.25 | 81.17 s | 2.04 s | 3.71 / 2.57 GB | Windows PC, same HDR view and Micro controls. |
| Switch to generated SDR | 79.25 s | 2.42 s | 3.86 / 2.33 GB | Windows PC, same zoom and Micro controls, no inactive-lane prefetch. |

The new run computed the Micro source once (81.92 s); the two later actions
each logged a source cache hit. The first lens-corrected preview still needs
a cold check on the MacBook Neo.

## November 21 — Denoise CPU fallback waits

MacBook Neo, A18 Pro and 8 GB, working changes based on `ed7e4a83`.
The 7968 × 5320 Sony `_DSC7970.ARW` used Clean Grain Small and harsh speck
cleanup at ×2.5. Allow 10% variation when comparing repeated runs under the
same conditions. These measurements describe the remaining work.

| Action | Total wait | Denoise work | Conditions |
| --- | ---: | ---: | --- |
| Enable at 110% with cold CPU preparation, HDR and generated SDR | 20.54 / 20.62 s | 17.54 / 17.53 s to prepare the whole photo | Isolated Electron at 1408 × 794, forced CPU Grain preparation with normal GPU presentation. From enable to the matching exact picture. |
| Release Grain Evenness at 110% | 18.08 s | 15.11 s to build new prepared pixels | Same Electron check, HDR. The brightness-grain fit was reused. |
| Enable at Fit with CPU preparation already available, HDR and generated SDR | 2.58 / 2.41 s | Existing preparation read at Fit size | Same Electron check, matching exact picture. |
| CPU preview after two Exposure edits, 1600 px | 1.50 / 0.72 s | 0.66 / 0.29 s to measure noise again | Isolated backend only, lens off. First request included the cold source resize. Repeating the same Exposure took 0.16 s with no measurement. |
| CPU preview after two Exposure edits, 4096 px | 4.86 / 3.85 s | 0.57 / 0.58 s to measure noise again | Same backend check. Repeating the same Exposure took 0.96 s with no measurement. |

The CPU preview timings include response encoding. Browser display is outside
that measurement. Whole-photo CPU preparation and CPU preview noise
measurement still use their existing algorithms.

The 90-second Library smoke drew all nine visible photos, first in 0.4 s.
The test app peaked at 2.87 GB. The system reserve check failed when available
memory fell to 1.25 GB against the 2 GB floor. Steve's Electron window was
open throughout. [Library run](../../codebase/output/quick-library-check/denoise-fixes/report.json)

## November 20 — Streamed GPU JPEG export trial

MacBook Neo, 8 GB; original size, Q90, 1,000-nit Ultra HDR target, and the
faster November 20 CPU route. Timing is Export click to saved file and success
status. Peaks are sampled whole-app physical footprint in decimal GB. The
asterisk marks the final uncompressed strip connection; other readings are
from the first streamed implementation and its rechecks. A pressure stop
is not a completed export.

| RAW and Denoise | Format | CPU (s) | GPU (s) | GPU peak (GB) |
| --- | --- | ---: | ---: | ---: |
| Canon, off | Ultra HDR | 20.04 | 17.75 | 3.012 |
| Canon, Fine Grain | Ultra HDR | 21.33 | 24.48 | 2.951 |
| Canon, Clean Grain Small | Ultra HDR | 28.57 | 20.52 | 3.122 |
| Canon, Clean Grain Large | Ultra HDR | 33.68 | 24.73 | 3.117 |
| Canon, off | SDR JPEG | 3.85 | 2.64 | 1.967 |
| Canon, Fine Grain | SDR JPEG | 6.27 | 16.61–38.22 | 2.74 or less |
| Canon, Clean Grain Small | SDR JPEG | 9.26 | 4.94–39.28 | 2.71 or less |
| Canon, Clean Grain Large | SDR JPEG | 13.45 | 4.89* (5.05–5.44 earlier) | 1.986* |
| Sony, off | Ultra HDR | Pressure stop | Pressure stop* | No completed peak (last sample: 2.941*) |
| Sony, Fine Grain | Ultra HDR | 25.38 | 26.49* | 3.771* |
| Sony, Clean Grain Small | Ultra HDR | 32.60 | 31.19* | 3.761* |
| Sony, off | SDR JPEG | 6.45 | 5.41 | 3.024 |
| Sony, Fine Grain | SDR JPEG | 11.64 | 8.42 | 3.023 |
| Sony, Clean Grain Small | SDR JPEG | 19.84 | 10.20–12.64 | 2.986 |

Before this work, Canon Fine Grain/Small Clean Grain GPU Ultra HDR peaked at
3.54/3.70 GB; Canon Large stopped. Sony was refused before upload at a **5.332 GB
estimate**, not a measured peak. Only the Canon-size Clean Grain Large SDR
case qualified for the new default: 60–64% shorter wait and passing colour
checks. [Memory, parity and default decision](briefs/gpu-export-memory-2026-11-20.md)

## November 20 — Micro Grain in Grade and delivery

MacBook Neo, A18 Pro, 8 GB, macOS 27.0.1. Unpackaged Electron, 1408 × 794 window, lens correction off, signed AHD, harsh-speck cleanup ×2.5. One action-to-presented-picture observation per cell. The Canon Grade measurements are from the same session; the Sony run stopped on system memory pressure after Micro Grain, before the other methods. Peak is sampled whole-app physical footprint, in decimal GB.

| RAW / method | Enable at 110% (s) | Slider at 110% (s) | 800 px pan (s) | Fit quick / exact (s) | Grade peak (GB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Canon IMG_0790.CR2 / Standard | 0.60 | 0.46 | 0.45 | — / 0.11 | 2.55 |
| Canon / Clean Grain, Small | 1.58 | 0.05 | 0.27 | — / 2.52 | 2.20 |
| Canon / Micro Grain | 5.52 | 1.26 | 0.82 | 0.08 / 6.07 | 2.09 |
| Sony _DSC7970.ARW / Micro Grain | 7.27 | 1.24 | 1.20 | 0.10 / 16.00 | 2.81 |

The dash means no separate quick presentation was observed. The single slider action changed Standard Luminance or Clean/Micro Color from its current value to 62%. Micro Grain keeps the previous picture until the new viewport is ready. Grouping adjacent Bayer tiles shortened the Canon slider wait from 1.76 s to 1.26 s, still above the isolated 0.25–0.30 s feasibility estimate.

Original-size Ultra HDR JPEG delivery, Q90 and a 1,000-nit target. The three Sony export observations are from the same session and use the CPU. Canon Micro Grain delivery ran separately before the Grade Bayer band change, which does not affect delivery.

| RAW / method | Export wait / peak | Full-size Proof wait / peak |
| --- | ---: | ---: |
| Canon / Micro Grain | 31.50 s / 2.68 GB | 46.11 s / 2.62 GB |
| Sony / Standard | 22.72 s / 3.47 GB | — |
| Sony / Clean Grain, Small | 29.24 s / 3.46 GB | — |
| Sony / Micro Grain | 67.10 s / 3.49 GB | 95.57 s / 3.48 GB |

Micro Grain Proof and export JPEGs are byte-identical on each RAW. [Design and validation](briefs/denoise-micro-grain-app-2026-11-20.md)

## November 20 — Denoise from the Library with real clicks

MacBook Neo, A18 Pro, 8 GB, 1408 × 794. Normal `npm start` Electron with an isolated profile; Canon `IMG_0790.CR2` copied from HDR Test Images into scratch. Clicks use the real switch and menu. Times are milliseconds from the trusted click/selection to the matching exact WebGPU picture, not to the end of saving or Library thumbnail work. One sample per entry. Each step checked the visible centre pixels, the menu on successive frames, the acknowledged edit, and the sidecar on disk. The photo started without a grade, then reopened into a new session with its saved enabled Standard grade; it reopened again with enabled Micro. No source originals were modified.

| Denoise method | Fit Off / warm On | 110% Off / warm On |
| --- | ---: | ---: |
| Standard | 36 / 31 | 131 / 484 |
| Fine Grain | 22 / 34 | 212 / 333 |
| Clean Grain | 24 / 32 | 111 / 332 |
| Micro Grain | 162 / 31 | 136 / 99 |

| From ↔ to, enabled | Fit forward / back | 110% forward / back |
| --- | ---: | ---: |
| Standard ↔ Fine | 46 / 88 | 614 / 598 |
| Standard ↔ Clean | 47 / 100 | 919 / 577 |
| Standard ↔ Micro | 49 / 81 | 849 / 580 |
| Fine ↔ Clean | 45 / 47 | 990 / 499 |
| Fine ↔ Micro | 46 / 47 | 835 / 449 |
| Clean ↔ Micro | 48 / 50 | 850 / 598 |

Fresh Standard On: 314 ms. First selection at Fit: Fine 3.00 s, Clean 2.82 s, Micro 7.98 s. First Micro selection at 110%: 1.57 s. Rapid Micro → Clean settled on Clean in 47 ms at Fit and 877 ms at 110%. Before the fix, the pointer could not make the second pick while the menu disabled itself, and at 110% the screenshot still showed the preceding method even when Micro's exact GPU frame was ready. After the fix, the pixels changed on all toggles and method pairs, and every pick kept its label through settlement. The measured app footprint peaked at 2.60 GB; exact native detail still needs more work than a cached Fit switch.

Steve's November 20 Desktop session (started 19:01:50 local) saved `358187…` = Clean Off, `7ec8fc…` = Clean On, `99be63…` = Micro On, `eb04d4…` = Micro Off. The independent SDR grade stayed Fine On. Neither these identities nor the click tests showed a stale Standard save or undo. The source hand-off rejected his current grade because the Desktop photo had a saved grade in the Library database but no indexed file row. Current grades now qualify independently of that file row; genuinely stale hand-offs are still refused. This changes background Library work, not which method Grade loads. At 110% the Library can still finish its own whole-photo redraw because Grade only has a visible region.

The 1.61 s CPU event in Steve's session was Bayer noise measurement, not CPU rendering of the Grade picture. His session logged 83 Micro region requests, 478 HDR source-tile requests and a 1.93 GB sample. The Micro region requests feed Bayer data to WebGPU; the HDR tile requests deliver developed source pixels. In the click run, first Fit Micro used 28 distinct Bayer requests; prepared Fit Micro switches needed none. At 110%, the measured Micro pair switches used 12–19 distinct Bayer regions, and other native switches commonly requested 36 distinct HDR tiles. The counts are not 36 retries of one tile, but returning to methods at 110% can still transfer source tiles again. The test passed 62 measured transitions. The separate plain Electron Library quick check pictured the scratch Canon. Receipts: `codebase/output/denoise-clicks-{rapid-before,trace,final,final-backend}.log`.

## November 20 — Denoise transitions and Micro Grain throughput

MacBook Neo, A18 Pro, 8 GB, 1408 × 794. Normal `npm start` Electron with an isolated profile. Canon `IMG_0790.CR2`, 110%, signed AHD, lens off and speck cleanup ×2.5. Times are seconds to a matching exact Grade presentation, not completion of background scopes. A dash means no new picture during the observation. The transition comparison is pre-Micro `12a945bf`, `ccad5c92` before the fixes, and the transition fix with the initial speed patch, from `normal-prebuild-retry.log`, `normal-before.log` and `normal-canon-final.log`. Repeated observations are shown as ranges; cold numbers include initial preparation.

| Method | Pre-Micro off / warm on | Off, before → after | Warm on, before → after |
| --- | ---: | ---: | ---: |
| Standard | 0.07 (another redraw at 1.41) / 0.45 | 0.09 (another redraw at 1.52) → 0.16 | 0.49 → 0.47 |
| Fine Grain | no redraw / 0.27 | — → 0.11 | 0.33 → 0.29 |
| Clean Grain | no redraw / 0.33 | — → 0.11 (another redraw at 0.25) | 0.37 → 0.33 |
| Micro Grain | unavailable | 0.14 → 0.11 | 0.06 → 0.06 |

| From → to, while enabled | Pre-Micro | Before | After transition fix |
| --- | ---: | ---: | ---: |
| Standard → Fine | 0.51 warm / 1.37 cold | 0.57 warm / 1.47 cold | 0.58–0.61 warm |
| Fine → Standard | 0.44 | 0.50 | 0.51 |
| Standard → Clean | 0.74 | 0.77 | 0.78 |
| Clean → Standard | 0.45 | 0.50 | 0.49 |
| Standard → Micro | unavailable | 5.47 cold | 5.58 cold |
| Micro → Standard | unavailable | 0.50 | 0.55 |
| Fine → Clean | 0.33–0.72 | 0.34–0.78 | 0.38–0.79 |
| Clean → Fine | 0.29 | 0.30–0.34 | 0.33 |
| Fine → Micro | unavailable | 1.36–1.37 | 1.33 |
| Micro → Fine | unavailable | 0.32–0.36 | 0.31 |
| Clean → Micro | unavailable | 1.34–1.37 | 1.33–1.35 |
| Micro → Clean | unavailable | 0.35–0.37 | 0.49 |

Cold Standard enable was 1.11 → 1.17 s. A same-turn Micro bypass-to-Clean selection then drew Clean at Fit in 0.06 s. The 12 settled directions all landed on the selected menu and source. No settled menu rollback or silent CPU fallback was observed in either matrix. The method race reproduced in a regression test and in the normal pre-Micro app: with a 0.25 s save delay, bypassing Clean then immediately enabling and selecting Fine left the menu and saved edit on Fine, but the Grade source on Clean/original, with no exact replacement in 40 s.

| Micro Grain wait | Earlier integrated | Normal-app before | Normal-app optimized |
| --- | ---: | ---: | ---: |
| Canon Color at 110% (62%, 74%) | 1.26 | 1.35 / 1.55 | 0.80 / 0.70 |
| Canon 800 px pan at 110% | 0.82 | 0.95 | 0.97 |
| Canon quick / exact Fit | 0.08 / 6.07 | 0.10 / 6.82 | 0.11 / 4.45 |
| Sony Color at 110% (62%, 74%) | 1.24 | — | 0.75 / 0.72 |
| Sony 800 px pan at 110% | 1.20 | — | 1.31 |
| Sony quick / exact Fit | 0.10 / 16.00 | — | 0.11 / 12.07 |

| Canon Color profile at 110%, seconds | Before | Optimized |
| --- | ---: | ---: |
| Action to exact presentation, with profiling | 1.28–1.29 | 0.67–0.68 |
| Three Bayer requests to headers (CPU correction plus request wait) | 0.81–0.82 | 0.17–0.18 |
| Bayer response bodies | 0.021–0.022 | 0.022–0.023 |
| AHD GPU pass intervals | 0.033–0.037 | 0.027 |
| Late wavelet and repair GPU pass intervals | 0.495–0.497 | 0.476–0.480 |
| Tiled Grade and other GPU pass intervals | 0.397–0.408 | 0.353–0.355 |
| Small readbacks, wall time per map | 0.015–0.023 | 0.016–0.020; late map 0.432–0.438 |

GPU rows combine overlapping Metal timestamp intervals within each category for work submitted before the exact presentation. The categories overlap one another and cannot be added or subtracted from elapsed time to estimate CPU idle, and the Grade group includes other renderer work. The three Bayer headers cost 0.86–1.06 s before and 0.17–0.24 s warm in separate runs. There is no full-pixel readback in the normal presentation; the small readback can wait behind queued GPU work, so the late map is not a transfer cost. For comparison, isolated 512-pixel tile probes measured AHD at 0.007–0.009 s and the late wavelet and repair at 0.255–0.260 s. The 0.30 s slider target and faster pans remain open. Receipts: `codebase/output/micro-grain-app/normal-{profile-before,canon-throughput,sony-throughput,profile-timing-after,profile-parity-before,profile-parity-after}.log`.

| Fresh profile with finished-pixel capture | Before | Optimized |
| --- | ---: | ---: |
| Canon Color at 110% (62%, 74%) | 1.20 / 1.23 | 1.26 / 0.70 |
| Canon quick / rebuilt exact Fit | 0.09 / 5.86 | 0.09 / 4.45 |
| Sony Color at 110% (62%, 74%) | 1.40 / 1.25 | 0.99 / 0.79 |
| Sony quick / rebuilt exact Fit | 0.09 / 15.90 | 0.12 / 12.86 |

At 74% Color, all eight finished-pixel pairs matched byte for byte: Canon and Sony, HDR and SDR, at 110% and exact Fit. The reduced-source cache was dropped before Fit, and the HDR timings include a confirmed native reduction. The 110% captures were 2542 × 1068; Fit was 1294 × 862 on Canon and 1291 × 862 on Sony. This checks Grade parity, not a new encoded export ceiling measurement. Native delivery and its highlight limiter were not changed. The Canon throughput runs sampled up to 2.37 GB of total app memory; the logged samples are not a continuous peak measurement. Receipts: `codebase/output/micro-grain-app/cold-{IMG_0790.CR2,_DSC7970.ARW}-{before,after}.log`.

## November 20 — Integrated byte-identical CPU JPEG export changes

MacBook Neo, A18 Pro, six cores, 8 GB, macOS 27.0.1 on AC. Unpackaged
Electron at 1408 × 794. Before `12a945bf`, after `d3836494`. Both used
the same Denoise code, CPU delivery, original dimensions, 0 EV, signed AHD,
speck cleanup 2.5 and lens correction off. SDR used Q90. Ultra HDR used
Q90, a full Q90 gain map, 4:2:0, automatic dither, a 1,000-nit target and
matching generated SDR. Metadata and sharpening were off.

One observation per completed case after Grade settled. Time starts with the
Export click and ends when the saved file and success status are available.
Whole-app peaks are sampled physical footprints in decimal GB. Interrupted
rows show the last observed maximum through the stop. Each run used the shared
GPU lock and stopped on system pressure, swap growth or the 4 GB app limit.

| RAW and Denoise | Format | Before (s) | After (s) | Peak before → after (GB) | Byte comparison |
| --- | --- | ---: | ---: | ---: | --- |
| Canon, Denoise off | Ultra HDR | 30.65 | 20.55 | 2.62 → 2.50 | Identical |
| Canon, Denoise off | SDR | 8.12 | 3.47 | 2.35 → 1.46 | Identical |
| Canon, Fine Grain | Ultra HDR | 33.40 | 23.56 | 2.30 → 2.26 | Identical |
| Canon, Fine Grain | SDR | 4 GB stop | 6.21 | 4.18 → 1.64 | No completed pair |
| Canon, Clean Grain Small | Ultra HDR | 44.48 | 30.67 | 2.40 → 2.24 | Identical |
| Canon, Clean Grain Small | SDR | 4 GB stop | 9.37 | 4.00 → 1.65 | No completed pair |
| Canon, Clean Grain Large | Ultra HDR | 48.03 | 32.70 | 2.40 → 2.39 | Identical |
| Canon, Clean Grain Large | SDR | Pressure stop | 14.05 | 3.58 → 1.65 | No completed pair |
| Sony, Denoise off | Ultra HDR | Pressure stop | Pressure stop | 2.63 → 2.65 | No completed pair |
| Sony, Denoise off | SDR | 16.81 | 6.05 | 3.40 → 2.12 | Identical |
| Sony, Fine Grain | Ultra HDR | 33.32 | 26.73 | 3.34 → 3.38 | Identical |
| Sony, Fine Grain | SDR | Pressure stop | 11.92 | 2.12 → 2.14 | No completed pair |
| Sony, Clean Grain Small | Ultra HDR | 41.15 | 35.50 | 3.34 → 2.86 | Identical |
| Sony, Clean Grain Small | SDR | Pressure stop | 21.35 | 3.92 → 2.37 | No completed pair |

Canon is `IMG_0790.CR2` at 5202 × 3464 and Sony is `_DSC7970.ARW` at
7968 × 5320. The six completed Ultra HDR pairs and both Denoise-off SDR
pairs matched byte for byte. The five traced Ultra HDR pairs had identical
decoded peak sequences and retry counts. The highest sampled peak for a
completed after run was 3.382 GB.

Canon Clean Grain Large saved 15.33 s (32%) and landed at 32.70 s, ahead of
the plan's 39–41 s forecast from its earlier 46.9 s wait. Sony Clean Grain
Small saved 5.65 s (14%) and landed at 35.50 s against the same forecast
from its earlier 43.3 s wait.

All five bounded stand-alone SDR Denoise runs completed at 1.64–2.37 GB.
The legacy runs stopped before publication, leaving native byte parity open
for those five cases. Sony Denoise-off Ultra HDR stopped on system pressure
on both versions. The matching cases above use full-size exports from the
two actual app versions.

[Implementation and measured stages](briefs/export-speed-plan-2026-11-20.md#integrated-result) ·
[Local timings, peaks and JPEG hashes](../../codebase/output/export-speed-app-2026-11-20/receipt.json)

## November 20 — CPU export speed prototypes

MacBook Neo, Apple A18 Pro, six cores, 8 GB, macOS 27.0.1, AC power.
App checkout `a217b2db`, shared GPU lock and macOS pressure/swap watcher.
Native signed AHD RAWs with speck cleanup 2.5 and lens off. HDR JPEG Ultra
HDR Q90, full-size map Q90, 4:2:0, auto dither, 1,000-nit Highlights and
generated SDR. No sharpening or metadata. The timings below are backend
stages with the RAW already open, except the two earlier app waits used
for the forecast. Peak figures are sampled process-tree physical footprint.

| Photo and action | Current | Prototype | Conditions and result |
| --- | ---: | ---: | --- |
| Canon `IMG_0790.CR2`, 5202 × 3464, Clean Grain Large, native HDR JPEG codec | 16.07–18.61 s | 12.00–12.13 s | Reused SDR inputs across retries, exact filter and compact decoded check. 4 passes in both, finished 1,000.00 nits, final decoded 999.00 nits, same JPEG bytes as app. Sampled 1.88 GB current and 1.65–1.74 GB exact bundle. |
| Sony `_DSC7970.ARW`, 7968 × 5320, Clean Grain Small, native HDR JPEG filter/repack and ceiling decode | 5.60 s | 3.41 s | Exact filter and compact check from the same native unfiltered encode. One pass, same JPEG bytes as app. Finished peak 388.65 nits, decoded 397.76 nits. Separate preparation with finished peak scan 5.30 s, unchanged native helper 1.26 s and 1.92 GB. First helper run stopped on OS pressure. |
| Canon native SDR finishing within Ultra HDR | 4.83 s | 2.12 s | Same denoised input, shared CPU pool, identical finished float bytes. HDR strip baseline 2.50 s. |
| Sony native SDR finishing within Ultra HDR | 3.80 s | 3.30 s | Same denoised input, shared CPU pool, identical finished float bytes. More aggressive two-worker test reached 2.41 s, while threading the HDR strips moved 2.97 → 3.38 s. |
| Canon native stand-alone SDR JPEG, Denoise off | 5.70 s | — | Completed current CPU export, Q90, 1.82 GB. Two attempts with native Fine Grain stopped on memory pressure and swap growth. |
| Canon native stand-alone SDR JPEG, Fine Grain Small | Pressure stops | 7.95 s | Bounded strip rendering and quantization, Q90. Completed prototype at 1.24 GB. |
| Canon 2601 × 1732 stand-alone SDR JPEG, Fine Grain Small | 3.61 s / 1.94 GB | 2.80 s / 0.67 GB | Same half-width and half-height input passed to both backends. Exact JPEG bytes. |
| Canon HDR, stronger local ceiling correction | 12.00 s exact bundle, 4 passes | 9.47 s, 3 passes | Rejected. Decoded 994.44 nits, SDR exact, HDR ΔE ITP mean 0.321 and P99.9 10.754. |
| Canon HDR, smoothing removed | 16.07–18.61 s, 4 passes | 9.93 s, 3 passes | Rejected. Initial peak rose from 1,224.88 to 1,561.60 nits. Final 993.67 nits. SDR exact, HDR ΔE ITP mean 11.26 and P99.9 48.97. File grew 12.05 → 22.25 MB. |
| Sony HDR, smoothing removed, filter/repack | 3.61 s | 0.62 s | Rejected. First decoded peak stayed 397.76 nits. SDR exact, HDR ΔE ITP mean 0.505 and P99.9 3.187. |
| Projected full Canon / Sony HDR export with exact changes | 46.91 / 43.33 s earlier real-app waits | About 39–41 s each | Forecast from same-Mac stage savings. Integrated app results are above. |

[Recommendations and evidence](briefs/export-speed-plan-2026-11-20.md)

## November 20 — Micro Grain Grade feasibility

MacBook Neo, A18 Pro, 8 GB unified memory, macOS 27.0.1, AC power.
Branch checkout at `e30b7c0d`. Electron 1408 × 794 under the shared
GPU lock, with the full suites idle. Canon `IMG_0790.CR2` and Sony
`_DSC7970.ARW`, Bayer highlights reconstructed, harsh-speck cleanup ×2.5,
lens correction off. Probe times use a native core of about 2430 × 1024
plus the round 3 haloes. Each GPU run fences submitted work. The figures
exclude UI and are warm medians unless a range is shown.

| Stage or action | Canon | Sony | Conditions |
| --- | ---: | ---: | --- |
| Signed AHD, CPU | 120 ms | 182 ms | Already prepared Bayer input. |
| Signed AHD, WebGPU | 8.9 ms | 7.1 ms | Resident input, four passes with shared Lab votes, about 116 MB logical allocation. |
| Round 3 late passes, 512 px tiles | 260 ms | 256 ms | Resident demosaiced viewport, default Color, about 144 MB logical allocation. |
| Round 3 late passes, 1280 px tiles | 202 ms | 203 ms | Same viewport and default Color, about 364 MB logical allocation. |
| Round 3 late passes, 1024 px tiles, Color 0% | 120 ms | 117 ms | No Small repair, about 274 MB logical allocation. |
| Round 3 late passes, simulated Fit | 1.78 s | 4.42 s | Repeated 512-pixel-tiled viewport over the approximate frame area. Bayer, transfer, reduction and Grade are additional. |
| Round 3 complete CPU viewport update | 0.94–1.22 s | 1.04–1.27 s | Three Luminance edits, one CPU thread, includes exact demosaic and filtering after 123 / 105 ms initial Bayer setup. |

The two isolated GPU stages passed finished HDR ΔE ITP and SDR ΔE 2000
at +3 EV. The higher mean / p99 for the late comparisons was 0.038 /
0.084 HDR and 0.010 / 0.028 SDR. The fixed comparison finish kept HDR
at or below 1000 nits. The allocations above are GPU resources in the
probe. The 4 GB whole-app gate for Micro Grain remains unverified.

The exact viewport probe was above the 150 ms warm first-picture
target before upstream Bayer work and the Grade draw. A live blend of
closely spaced exact samples also missed the colour gates. This stopped
the app integration. [Design and quality results](briefs/denoise-micro-grain-app-2026-11-20.md)

Both attempts to time Standard and Clean Grain in the same Grade session
were stopped by macOS memory pressure during app startup. In the earlier
MacBook Neo Grade trial, Clean Grain colour drags at 110% settled in
123–137 ms. Those are historical app waits and the values above cover
only the isolated GPU or CPU work.

## November 20 — Denoise export and full-size Proof attribution

MacBook Neo, A18 Pro, 6 cores, 8 GB unified memory, macOS 27.0.1, AC
power. Unpackaged Electron at 1408 × 794 under the shared GPU lock.
App code from `35b28d99`, measured in the `2aafece6` to `e8226aea`
checkout. Default delivery selection unless marked trial. Original
dimensions, JPEG Ultra HDR Q90, full gain map, 1,000-nit Highlights and
Proof target, generated SDR with the same Grain controls, metadata and
sharpening off. Native Bayer RAW with harsh-speck cleanup at 2.5 and lens
correction off. Durations start at the UI action except where indicated.
Memory is sampled whole-app physical footprint in decimal GB.

| Photo and action | Wait (s) | Peak (GB) | Conditions and result |
| --- | ---: | ---: | --- |
| Canon opening RAW to a sharp Grade view | 4.41–5.55 | 1.22 highest sampled | Fresh profiles. About 1.7 s harsh-speck cleanup and 0.7 s signed AHD. Outside delivery wait. |
| Sony opening RAW to a sharp Grade view | 9.17–10.30 | 1.32 sampled in trial open | Fresh profiles. Trial RAW development 7.79 s including 4.24 s cleanup and 2.58 s AHD. Outside delivery wait. |
| Canon Fine Grain, full-size Proof, automatic CPU, 0 EV | 46.65–47.49 | 2.41 across warm-up and two repeats | Warm-up 45.01 s. Three JPEG encode/check passes per action. Three matching Proof JPEG hashes. |
| Canon Fine Grain, full-size Proof, automatic CPU, +0.015 EV | 52.00 | 2.52 | Separate fresh artifact in continuous attempt, four JPEG codec passes. |
| Canon Clean Grain Small, full-size Proof, automatic CPU, 0 EV | 51.45–54.34 | 2.48 | Two observations, four JPEG codec passes per action and identical Proof JPEG bytes. Spread just above 5%. |
| Sony Clean Grain Small, trial HDR export, CPU fallback | Stopped after 25.6 from admission | 2.14 before stop | GPU refused before upload. Noise model 1.98 s, fit 0.96 s, remaining Grain 15.16 s and HDR strip render 6.17 s. System memory pressure stopped the SDR pass. |
| Sony Fine and Clean Small, full-size Proof, automatic CPU | Stops during first build | — | Three startup attempts stopped on macOS system pressure, once with observed swap growth. Earlier completed Sony runs are below. |
| Canon Fine Grain, full-size Proof memory review, automatic CPU | 610.01 monitoring, 47.49 first sharp | 1.958 | One fresh build and six HDR/SDR/delivered view changes. Highest after the first minute 1.529 GB, final 1.328 GB. Normal OS pressure and no swap growth throughout. |
| Canon Fine and Clean Small, successive full-size Proof builds, automatic CPU | Stopped at about 3 min 20 s and 7 min in separate runs | 2.52 maximum on completed actions | Three and two builds completed, respectively. OS pressure stopped the next build in each. The 10-minute review above uses a single build. |
| Canon Clean Grain Large, HDR export, automatic CPU | 46.91 | 2.402 | Four JPEG codec passes. CPU Grain plus whole-photo fit 8.17 s, native noise model 1.43 s. |
| Canon Clean Grain Large, full-size Proof after export, automatic CPU | 59.95 | 2.378 | Four new JPEG codec passes. Identical bytes to export. |
| Canon Clean Grain Large, HDR export, GPU trial | Two pressure stops | — | First stopped during GPU work, after one temporary yield to Grade. Retry also stopped before a finished result. |
| Canon Clean Grain Large, HDR export, automatic CPU repeat | OS pressure stop | — | OS pressure stopped the second attempt. One completed run is listed above. |
| Canon Fine and Clean Small, HDR export, GPU trial repeats | OS pressure stops | — | No new completed file. Earlier trial rows below include successful GPU exports and Proofs. |
| Canon Fine Grain, stand-alone SDR JPEG export, automatic CPU | OS pressure stop | — | Swap grew during the attempt. No completed file. |
| Sony Clean Grain, CPU backend-only RAW open | 7.41 | 1.28 process tree | Diagnostic without Electron. OS pressure stopped before export finished. |

[Detailed breakdown, method and evidence](briefs/denoise-export-proof-breakdown-2026-11-20.md)

## November 20 — Fine and Clean Grain GPU delivery trial

Export and full-size Proof can share the graphics-card reconstruction used
in Grade. The admitted trial skips CPU Grain preparation and its disk
scratch. It passes the finished HDR and SDR pixels to the encoder in
32-row strips. If the job cannot use the GPU, both outputs use the CPU.
The trial stays off by default: no measured case qualified on both the
whole wait and the 4 GB memory cap. Standard and Fine Grain with zero Grain
Evenness keep their existing delivery selection.

MacBook Neo, A18 Pro, 8 GB unified memory, macOS 27.0.1, AC power.
Unpackaged Electron at 1408 × 794 under the shared GPU lock, with the
fast suites idle. Native JPEG Ultra HDR at quality 90, 1,000-nit Proof,
HDR Highlight enabled, original dimensions, no metadata. Each entry is
one action-to-result wait / sampled whole-app physical footprint. Proof
was requested immediately after export, not measured from a cold start.

| Photo and method | CPU export (s / GB) | Trial export (s / GB) | CPU full Proof (s / GB) | Trial full Proof (s / GB) |
| --- | ---: | ---: | ---: | ---: |
| Canon `IMG_0790.CR2`, Fine | 42.282 / 2.226 | 33.797 / 3.542 GPU | 52.453 / 1.914 | 39.895 / 3.062 GPU |
| Canon, Clean | 47.313 / 2.396 | 27.156 / 3.702 GPU | 57.764 / 1.922 | 34.047 / 3.393 GPU |
| Sony `_DSC7970.ARW`, Fine | 34.627 / 3.365 | 51.729 / 3.387 CPU fallback | 66.496 / 3.338 | 76.940 / 3.389 CPU fallback |
| Sony, Clean | 43.329 / 3.360 | 64.429 / 3.355 CPU fallback | 72.844 / 3.319 | 87.213 / 3.392 CPU fallback |

The Sony was refused before the GPU allocated its full-size working set.
Those trial numbers show the CPU fallback stayed under the cap. The separate
Grade preview could still start work in those earlier Sony trial sessions,
so their times do not measure a GPU speedup or a fallback penalty. The
isolated Canon pairs shortened export / Proof waits by 20% / 24% (Fine)
and 43% / 41% (Clean); neither cut the wait approximately in half. The
Canon's successful GPU turns took 5.173 s and 6.542 s, including about
1.45 s each for readback and handoff, with no CPU Grain scratch. Fine
yielded once to the shared GPU budget before completing. Focus next on
full-image finishing, codec work and Proof display rather than just the
Grain computation. The earlier Clean Grain baselines used different Grade
or run conditions and are not the denominators for these speedups.

On the delivery calibration fixture, Fine Grain and both Clean Grain
sizes passed finished GPU-versus-CPU colour checks. Worst mean / p99:
0.025 / 0.0563 ΔE ITP in HDR, below 1 / 3, and 0.0104 / 0.0332
ΔE 2000 in SDR. Both routes stayed at or below 1,000 nits before encoding.
The separate saved-RAW JPEG check reached 1,008.578 nits after encoding;
the JPEG Ultra HDR, AVIF and JPEG XL ceiling checks peaked at 1,009.607 nits
across both renderers, below the 1,010-nit allowance. Full-size Proof and
export matched byte for byte within each tested renderer. Those byte checks
do not compare the GPU's encoded bytes to the CPU's.

Delivery smoke, Proof size, both fast suites and the quick Library check
passed. The protected-project Proof identity driver could not open its
Windows source path on this Mac; the fixture was not modified and all
three protected SHA-256 hashes passed. Native Canon and Sony checks verify
Proof/export identity independently. Receipts:
`codebase/output/denoise-grain-delivery/`.

## November 20 — Clean Grain Large pan and Grade rollout

MacBook Neo, A18 Pro, 8 GB unified memory, macOS 27.0.1, AC power.
Unpackaged Electron at 1408 × 794 under the shared GPU lock, with the
fast suites idle. Canon `IMG_0790.CR2` and Sony `_DSC7970.ARW`; signed RAW
development, harsh-speck cleanup ×2.5, both routes set to Large. Times
are action-to-finished-picture; memory is the whole app's sampled
physical footprint in decimal GB. Each row is one observation per route.

| HDR wait or peak | Canon CPU → GPU | Sony CPU → GPU |
| --- | ---: | ---: |
| First sharp at 110% (s) | 12.509 → 2.049 | 35.989 → 3.698 |
| Fit (s) | 12.101 → 3.815 | 30.068 → 8.900 |
| Evenness drag (s) | 11.511 → 1.534 | 29.773 → 1.547 |
| Small pan (s) | 0.200 → 0.033 | 0.418 → 0.028 |
| Wide pan, with capture (s / GB) | 0.459 / 1.863 → 0.315 / 2.059 | 0.464 / 2.175 → 0.470 / 2.504 |
| Wide pan, independent repeat without capture (s / GB) | — | 1.278 / 2.207 → 0.831 / 3.287 |
| Peak across paired Grade checks (GB) | 2.751 → 2.501 | 4.231 → 3.034 |

The original failing Sony result was 0.573 s on GPU versus 0.459 s on
CPU. Large was running colour passes over halo pixels it did not need,
and the pan fetched and uploaded pixels the graphics card already held.
The current code keeps the same reach, filters only the pixels subsequent
passes read, and fetches just the missing strip when a horizontal pan can
reuse a source region from the same revision. The Sony transfer fell from
48.92 MB to 22.36 MB. The captured pair was within 1.4% and the repeat was
35% faster; the no-capture repeat spent more time drawing the underlying
picture on both routes. Clean Grain is now enabled in Grade alongside Fine.
With the GPU setting left at its default, wide pans took 0.339 s on
Canon and 0.438 s on Sony. The highest sampled waits were 2.457 GB and
2.976 GB, respectively. On Canon, Show original and bypass both restored
the exact finished pixels of the undenoised picture, even after GPU Grain
had been cached.

Across finished Grade pixels and tile joins, the worst mean / p99 was
0.012 / 0.143 ΔE ITP in HDR and 0.116 / 0.625 ΔE 2000 in SDR. Both
GPU pan overlaps and the injected Canon SDR CPU fallback matched their
reference pixels exactly. At +3 EV, the four Clean Large HDR ceiling
captures (Fit and 110% on both photos) had zero pixels above 600 nits;
the highest was 599.99994 nits. Receipts:
`codebase/output/denoise-grain-delivery/`.

## November 20 — Fine Grain enabled in Grade

MacBook Neo with A18 Pro, 8 GB unified memory and macOS 27.0.1 on AC.
Unpackaged Electron at 1408 × 794 points under the shared GPU lock.
Canon `IMG_0790.CR2` and Sony `_DSC7970.ARW`, signed RAW development,
lens correction off and harsh-speck cleanup at ×2.5. The CPU figures are
the same-machine baseline in `b675f81a`. The GPU figures come from a fresh
default-on run after the memory incident, with the fast suites idle.
Times run from the action to the finished picture. Peak memory is sampled
for the whole app, in decimal GB.

| Wait or peak | Canon CPU → default GPU | Sony CPU → default GPU |
| --- | ---: | ---: |
| HDR first sharp at 110% (s) | 5.564 → 1.612 | 13.307 → 4.411 |
| HDR Fit (s) | 4.594 → 2.214 | 9.483 → 4.593 |
| HDR Evenness drag settled (s) | 5.303 → 0.128 | 11.495 → 0.133 |
| HDR small pan (s) | 0.203 → 0.030 | 0.407 → 0.026 |
| HDR wide pan (s) | 0.439 → 0.350 | 0.642 → 0.526 |
| Generated SDR at 110% (s) | 2.434 → 0.314 | 4.182 → 0.348 |
| Generated SDR Fit (s) | 1.083 → 0.110 | 2.181 → 0.106 |
| Peak whole app (GB) | 2.807 → 1.964 | 4.356 → 3.015 |

Fine Grain is on by default in Grade when selected and enabled. The
original picture stays bounded at native zoom, with the Grain preparation
and final colour processing skipped when bypassed. The Canon Show original
and bypass captures matched the undenoised Grade pixels byte for byte.
One injected Canon failure called the CPU preparation once and showed the
CPU picture in 4.654 seconds. The repeated quick Library check showed all
9 viewport pictures, with a first picture in 0.4 seconds and a 2.781 GB
whole-app peak. The pre-repeat Library run and incomplete Fine Grain
runs were discarded as rollout evidence.

The paired finished-colour results from `b675f81a` still apply to the
same Fine Grain reconstruction. The worst mean / p99 was 0.059 / 0.187
ΔE ITP in HDR and 0.121 / 0.766 ΔE 2000 in SDR. The default-on ceiling
recheck found zero finished pixels above 600 nits on both photos, at Fit
and 110%. The exact counts are in the Clean Grain trial section below.

## November 20 — Clean Grain GPU trial in Grade

MacBook Neo with A18 Pro, 8 GB unified memory and macOS 27.0.1 on AC.
Unpackaged Electron at 1408 × 794 points under the shared GPU lock, with
the fast suites idle. Canon `IMG_0790.CR2` and Sony `_DSC7970.ARW`, signed
RAW development, lens correction off and harsh-speck cleanup ×2.5. Each
figure is one action-to-picture observation. Both routes capture finished
pixels. The physical footprint includes Electron, the GPU process, Python
and helpers, and the preceding 500 ms of each timed wait. The Fine-to-Clean
switch uses a fresh Evenness value at 92% on both routes so there is no
matching Clean tile. Small and wide pans move 180 and 550 screen pixels.

| Wait or peak | Small Canon CPU → GPU | Small Sony CPU → GPU | Large Canon CPU → GPU | Large Sony CPU → GPU |
| --- | ---: | ---: | ---: | ---: |
| HDR first sharp at 110% (s) | 8.620 → 1.880 | 23.045 → 3.480 | 12.929 → 2.169 | 30.082 → 3.733 |
| HDR Fit (s) | 7.985 → 3.013 | 18.702 → 7.510 | 12.077 → 4.017 | 32.059 → 9.983 |
| HDR Evenness drag settled (s) | 8.231 → 1.419 | 18.787 → 1.349 | 11.794 → 1.819 | 28.651 → 1.825 |
| HDR small pan (s) | 0.200 → 0.024 | 0.427 → 0.036 | 0.204 → 0.027 | 0.391 → 0.028 |
| HDR wide pan (s) | 0.459 → 0.375 | 0.479 → 0.494 | 0.452 → 0.455 | 0.459 → 0.573 |
| Color Splotches drag at 110% (s) | 2.872 → 0.137 | 5.544 → 0.127 | 2.916 → 0.123 | 5.466 → 0.134 |
| Color Splotches drag at Fit (s) | 0.120 → 0.116 | 0.130 → 0.118 | 0.146 → 0.112 | 0.164 → 0.116 |
| Splotch Size change at 110% (s) | 11.357 → 0.881 | 27.904 → 1.192 | 7.381 → 0.749 | 17.059 → 0.865 |
| Fine Grain to Clean Grain at 110% (s) | 3.933 → 0.881 | 7.651 → 0.883 | 6.399 → 1.065 | 15.818 → 1.084 |
| Generated SDR at 110% (s) | 8.666 → 0.569 | 20.704 → 0.634 | 12.752 → 0.589 | 30.611 → 0.820 |
| Generated SDR Fit (s) | 1.116 → 0.127 | 2.035 → 0.105 | 0.991 → 0.120 | 2.269 → 0.109 |
| Peak whole app (GB) | 2.606 → 2.553 | 4.259 → 2.938 | 2.693 → 2.539 | 4.782 → 3.002 |

**Off by default.** The Sony Large wide pan took 25% longer than the CPU.
That misses the agreed 5% timing band. The GPU finished the two first
sharp pictures 78–88% sooner across the two sizes and stayed under 4 GB.
The largest GPU peak in the separate +3 EV ceiling checks was 3.244 GB
(Sony Large Fit).

Both reaches reuse the Fine Grain whole-photo fit. The GPU computes
visible padded tiles at native zoom and filters bounded strips at Fit.
Fit reduces the base picture and signed colour delta separately, so
the viewer can blend the delta live at any strength. The GPU checks
recorded no CPU Grain preparation requests on a successful draw.
Small and Large share the same measurement, and generated SDR reuses
matching results from HDR. In the focused Canon Fit size check,
Small to Large showed the first update in 0.170 s and settled in 4.160 s.
The whole-photo fit was reused throughout that change.

All 16 Clean Grain finished-picture comparisons passed. The worst mean /
p99 was 0.012 / 0.143 ΔE ITP in HDR and 0.116 / 0.624 ΔE 2000 in SDR,
against limits of <1 / <3. Samples around tile and strip joins also
passed (worst p99 0.136 HDR and 0.630 SDR). The overlapping HDR pan pixels
were identical on both photos with each reach. An injected Canon fault
made one GPU attempt and one CPU preparation for each reach. Both
fallback pictures were byte-identical to their normal CPU SDR Fit capture.

The HDR ceiling checks ran at +3 EV with a 600-nit target. For each of
Fine Grain, Clean Grain Small and Clean Grain Large, **0 of 7,609,384**
finished HDR pixels exceeded 600 nits on Canon and Sony at Fit and 110%.
The highest was 599.999939 nits in every capture, measured before the
display transform or encoding.

The full suites ran separately under the lock. JavaScript passed 1,126
with one skipped. Python passed 4,316 with 150 skipped and one unexpected
pass. The repeated Library and Fine Grain results and the paired Clean
Grain runs replace the measurements taken during the memory incident.

Reproduce from `codebase` with `--phase2=cpu` and `--phase2=gpu` and the
same capture folder for both runs. Use `--clean-grade=small` or
`--clean-grade=large`, and use `--ceiling-only` with the GPU route for
the exact HDR check. [Latency driver](../../codebase/tests/performance/denoise-grain-latency.js) ·
[Finished-pixel comparator](../../codebase/tests/helpers/denoise_grade_comparison.py)

## November 20 — Fine Grain GPU reuse in Grade

MacBook Neo, A18 Pro, 8 GB, macOS 27.0.1, on AC. Unpackaged Electron at
1408×794 under the shared GPU lock, using `IMG_0790.CR2` (Canon) and
`_DSC7970.ARW` (Sony). The same Grade settings ran with the CPU and GPU
Fine Grain routes. Each timing is one real-app observation including the
finished-pixel capture; pan waits end when the visible area is fully sharp.
The pans move 180 and 550 screen pixels respectively. Memory is the sampled
whole-app physical footprint, in decimal GB, including the preceding 500 ms
and the settle after the picture. The HDR capability override is test-only.

| Wait or peak | Canon CPU → GPU | Sony CPU → GPU |
| --- | ---: | ---: |
| HDR first sharp at 110% (s) | 5.564 → 2.127 | 13.307 → 5.444 |
| HDR Fit (s) | 4.594 → 2.706 | 9.483 → 6.412 |
| HDR Evenness drag, settled (s) | 5.303 → 0.133 | 11.495 → 0.136 |
| HDR small pan (s) | 0.203 → 0.016 | 0.407 → 0.033 |
| HDR wide pan (s) | 0.439 → 0.395 | 0.642 → 0.490 |
| Generated SDR at 110% (s) | 2.434 → 0.735 | 4.182 → 0.866 |
| Generated SDR Fit (s) | 1.083 → 0.113 | 2.181 → 0.128 |
| Peak whole app (GB) | 2.807 → 2.086 | 4.356 → 2.568 |

The whole-photo measurement survived zoom, Fit, a matching HDR/SDR switch
and Evenness changes. HDR Fit still filters and reduces the native photo on
its first visit; generated SDR at the same settings reuses that reduced
picture. The SDR rows are warm from HDR, not the cold SDR 110% comparison
in Phase 1. First Evenness feedback took 121 ms Canon and 71 ms Sony in the
final run (77/129 ms in the preceding bounded run). Small pans stayed
inside the existing sharp patch. Wide pans retained the whole-photo picture
while filling the newly visible area. In the first bounded run the Canon
wide pan was 0.460 s; with the trial's wait after scrolling shortened from
140 to 70 ms, the final run beat CPU on both photos.

Phase 1 reached 4.74 GB on Sony; its repeat reached 4.216 GB. The first
strip-bounded run still hit 4.216 GB during calibration: about 1.914 GB in
the GPU helper, 1.520 GB in the Python backend and 0.496 GB in the main
renderer, with 0.286 GB in other processes. The full-size source and render
targets from the bypassed zoom view could overlap calibration. The
trial now keeps that view bounded and retires unused targets before
measurement. Sony calibration reserves 103.43 MB: 37.10 MB for the source
strip, 32.52 MB for scratch, 33.55 MB for upload staging and responses,
and 0.25 MB for statistics and readback. HDR Fit reserves 155.78 MB for its
source, filtered strip, resize scratch, output and uploads. These logical
reservations do not include the driver or backend footprint. Both photos
passed 4 GB on both bounded passes (highest: Canon 2.167 GB, Sony 2.598 GB).
In the final Sony pass the largest sample was during first measurement,
including 1.184 GB in Python, 0.563 GB in the GPU helper and 0.536 GB in
the main renderer.

All eight finished-picture comparisons passed (worst HDR mean/p99:
0.059/0.187 ΔE ITP; SDR: 0.121/0.766 ΔE 2000). The shared areas of both
pans were pixel-identical on each photo. At +3 EV, the first exact check
found a float rounding overshoot of 600.000061 nits. A trial-only rounding
guard corrected it: **0 of 7,609,384 finished HDR pixels** exceeded 600 nits
across Fit and the sharp 110% patch on both photos; the maximum was
599.999939 nits in all four captures, measured before display or encoding.
An injected Canon GPU failure used one CPU preparation and showed its
picture in 6.471 s. Proof and export did not change.

**Off by default.** The final GPU run beat the paired CPU run on each timed
wait, but the first sharp HDR picture was slower than the previous GPU
trial (1.78/4.56 s in Phase 1 vs 2.127/5.444 s). Keep the bounded route
available for development without trading away that first-picture gain.
Next: Clean Grain in Grade.

Reproduce from `codebase` with the commands below, replacing `ROUTE` with
`cpu` and `gpu` for the first command. Fast checks: 1,125 JavaScript passed
(one skipped); 4,316 Python passed (150 skipped, one unexpected pass); quick
Library check passed.

```sh
HDR_FINISHER_ELECTRON_WINDOW_SIZE=1408x794 .venv/bin/python tools/gpu-run-lock.py --label fine-grain-ROUTE --minutes 10 -- node tests/run-in-electron.js tests/performance/denoise-grain-latency.js --phase2=ROUTE
.venv/bin/python tests/helpers/denoise_grade_comparison.py output/denoise-grain-phase2
HDR_FINISHER_ELECTRON_WINDOW_SIZE=1408x794 .venv/bin/python tools/gpu-run-lock.py --label fine-grain-ceiling --minutes 10 -- node tests/run-in-electron.js tests/performance/denoise-grain-latency.js --phase2=gpu --ceiling-only
.venv/bin/python tests/helpers/denoise_grade_comparison.py output/denoise-grain-phase2 --ceiling
```

## November 20 — Phase 1 Fine Grain on the GPU in Grade

MacBook Neo, A18 Pro, 8 GB, macOS 27.0.1 on AC. Unpackaged Electron at
1408×794 under the shared GPU lock. Canon `IMG_0790.CR2` (fire-dancer) and
Sony `_DSC7970.ARW` (portrait), with the same Grade controls on both routes.
These are single real-app observations, including finished-pixel capture,
not isolated filter timings. The HDR display capability override is test-only.
Memory is the sampled whole-app physical footprint, in decimal GB, including
the GPU process and backend. The sample window includes the preceding 500 ms.

| Photo | Lane | First sharp 110%, CPU → GPU (s) | Settled Fit, CPU → GPU (s) | Evenness drag settled (first GPU response), CPU → GPU (s) | Pan, CPU → GPU (s) | Peak whole app, CPU → GPU (GB) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Canon | HDR | 5.61 → 1.78 | 4.41 → 3.01 | 4.81 → 0.130 (0.079) | 0.207 → 0.601 | 2.62 → 2.57 |
| Sony | HDR | 12.50 → 4.56 | 13.94 → 7.02 | 12.02 → 0.132 (0.066) | 0.412 → 0.684 | 3.91 → **4.74** |
| Canon | SDR | 6.08 → 2.05 | 0.95 with CPU reuse → 3.14 without GPU reuse | — | — | 2.47 → 2.43 |
| Sony | SDR | 12.44 → 3.51 | 1.99 with CPU reuse → 7.04 without GPU reuse | — | — | 2.74 → 3.04 |

The measured CPU waits replace the design's 8.32 s / 15.87 s estimates
for this comparison. HDR 110% was 68% faster for Canon and 64% for Sony.
HDR Fit was 32% faster for Canon and about 50% for Sony. SDR Fit is not a
cold-to-cold comparison: the CPU already had matching preparation from
110%; the GPU still had to filter at native resolution and reduce. Both
HDR pans regressed. A separate repeated Sony HDR 110% run also exceeded
4 GB (4.72 GB). **The trial remains disabled by default.**

| Photo | Lane and metric | Fit mean / p99 | 110% mean / p99 |
| --- | --- | ---: | ---: |
| Canon | HDR, ΔE ITP | 0.041 / 0.171 | 0.049 / 0.187 |
| Sony | HDR, ΔE ITP | 0.055 / 0.161 | 0.059 / 0.185 |
| Canon | SDR, ΔE 2000 | 0.008 / 0.370 | 0.121 / 0.624 |
| Sony | SDR, ΔE 2000 | 0.031 / 0.766 | 0.029 / 0.687 |

All eight finished-pixel comparisons met mean <1 and p99 <3. The shared
area before and after each HDR pan was pixel-identical, and the sharp
area covered the viewport. This checks for seams across tiles in those
views, not every pan direction or an independent visual sign-off. The
existing HDR limiter was unchanged; the exact pre-encode ceiling was not
independently qualified. Successful GPU draws used no CPU Fine Grain
preparation. An injected GPU failure at Canon SDR Fit made one attempt,
then one successful CPU Grain preparation and presented the CPU picture
in 4.42 s.

Reproduce from `codebase`: run the
[real-app driver](../../codebase/tests/performance/denoise-grain-latency.js)
once per route by substituting `cpu` and `gpu` for `ROUTE`, then compare
the captures. The GPU driver records both photos before returning failure
when it observes a memory overage.

```sh
HDR_FINISHER_ELECTRON_WINDOW_SIZE=1408x794 .venv/bin/python tools/gpu-run-lock.py --label fine-grain-ROUTE --minutes 10 -- node tests/run-in-electron.js tests/performance/denoise-grain-latency.js --phase1=ROUTE
.venv/bin/python tests/helpers/denoise_grade_comparison.py output/denoise-grain-phase1
```

## November 20 — Native JPEG Ultra HDR Proof on the 8 GB MacBook Neo

Baseline `8632bfa2` versus the bounded JPEG Proof change. MacBook Neo A18 Pro
(6 cores, 8 GB unified memory), macOS 27.0.1, AC power, 1408 × 794 Electron
window, fresh profiles and the shared GPU lock. Full-size Q90 JPEG Ultra HDR
with Denoise enabled for both renditions. CPU delivery was selected to use the
same renderer and metadata was disabled for the source-file comparison. Each
pair uses the same developed RAW, grade and measured Denoise model. Sony and
Canon Standard had the 1,000-nit HDR limit enabled. Canon Fine Grain and
Clean Grain used the RAW's default Highlights setting and the optional JPEG
codec-limit check. All Proof views used the 1,000-nit display target.

| Photo | Method | Proof peak before → after (GB) | Build Proof to painted picture (s) | Separate export before → after (s / GB) |
| --- | --- | ---: | ---: | ---: |
| Canon IMG_0790.CR2 | Standard | 5.84 → 2.57 | 92.57 → 73.08 | 51.28 / 2.69 → 50.33 / 2.55 |
| Canon IMG_0790.CR2 | Fine Grain | 5.92 → 2.28 | 59.53 → 31.70 | 31.94 / 2.30 → 24.28 / 2.08 |
| Canon IMG_0790.CR2 | Clean Grain | 6.19 → 2.11 | 62.33 → 37.14 | 31.55 / 2.23 → 32.33 / 2.09 |
| Sony _DSC7970.ARW | Standard | 13.53 → 3.53 | 105.18 → 68.36 | 40.06 / 3.55 → 35.04 / 3.53 |
| Sony _DSC7970.ARW | Fine Grain | 13.36 → 3.46 | 149.05 → 111.87 | 59.68 / 3.49 → 71.18 / 3.42 |
| Sony _DSC7970.ARW | Clean Grain | 12.50 → 3.45 | 129.57 → 73.29 | 67.16 / 3.42 → 61.31 / 3.42 |

One sample per cell, with the separate export before the Proof click. The app
memory reading sums the Apple physical footprint of the Electron process tree,
including codec helpers. The time includes encoding, reconstruction, decoding
and presentation. Input and finished-pixel hashing added about 1–2 seconds to
the measured delivery work in both builds. The Sony Fine Grain export varied
with the time spent in native Denoise preparation (9.72 → 28.08 s). These
single export samples give no export speed estimate.

The export JPEG, Proof JPEG and both AVIF comparison images have identical
SHA-256 hashes before and after in every row. The Canon Standard finished
render reached 1,000 nits exactly. Its decoded retries matched at 1196.294,
1065.454, 1002.068 and 999.965 nits, with only the final file delivered. The
existing 4 GB cap and finished and encoded peak rules apply throughout.
Evidence is in `codebase/output/full-proof-memory/comparison.json`.

## November 20 — Byte-identical CPU speedups for Denoise Grain

| Action | Canon IMG_0790.CR2 | Sony _DSC7970.ARW | Conditions |
| --- | ---: | ---: | --- |
| First Fine Grain switch at 110%, estimated whole wait | 11.52 → 8.32 s (28% less wait) | 25.69 → 15.87 s (38% less wait) | MacBook Neo, A18 Pro / 6 cores / 8 GB, macOS 27.0.1, plugged in. CPU fit plus preparation and scratch writes: 5.53 → 2.33 s Canon, 15.24 → 5.42 s Sony, medians of three alternating A/B runs per RAW against `c96d6e7e`. Same verified RAW per photo, already developed, same model and controls, six tile workers, OpenCV configured for six threads, OMP/BLAS limited to one. Shared machine, 1-minute load 1.66–6.61; allow 5% timing noise. |

The estimate subtracts the measured CPU time saved from the November 19
110% action-to-picture readings, holding the rest of the wait fixed. It is
not a new whole-app median. The Clean Grain CPU export-source step went from
6.46 to 2.96 s (Canon) and 17.30 to 7.54 s (Sony); this excludes rendering
and encoding the export.

The locked Electron spot check (1408 × 794, one run on the shared checkout)
reached the exact Fine Grain picture in 4.42 s Canon / 9.65 s Sony. Clean
Grain reused Fine Grain RGB, with no wavelet work, at 3.92 / 7.12 s. These
are unpaired observations with other edits in the checkout; they do not
replace the estimates or establish a Clean Grain switch speedup. Fine Grain
peaked at 2.13 / 2.56 GB; the Sony Standard enable sampled 4.17 GB, above
the unchanged 4 GB gate. The separate locked CPU/GPU JPEG Ultra HDR
delivery and full-size Proof identity smoke passed for all three methods.

Both approved RAWs had identical stored fit bytes, packed Fine and Clean
preview hashes (whole frame, native region, reduced image), and full-resolution
Clean CPU export-source hashes at each step. Large-splotch direct Clean
preparation also matched before and after. All five existing Grain tests
passed on both versions with identical captured outputs. The one-channel
matrix shortcut was excluded because it changed Sony's stored fit.
[Local A/B receipts and exact-check scripts](../../codebase/output/denoise-exact-speed-2026-11-20).

## November 20 — Grade Grain reuse between HDR and SDR

MacBook Neo A18 Pro, 8 GB, 1408 × 794 points. Separate Electron profiles
under the shared GPU lock. Canon IMG_0790.CR2 at Fit. Same Fine Grain
preparation controls on both renditions, with SDR generated from the same
source. Each wait ends at the exact WebGPU picture. These are single runs.

| Grade action | Before | After | Result |
| --- | ---: | ---: | --- |
| Enable Fine Grain in SDR after HDR is ready | 0.92 s | 0.91 s | Both reuse the existing preparation. |
| Switch to SDR after Recalculate in HDR | 13.34 s | 0.33 s | SDR reuses the refreshed result. Previously it spent 12.07 s preparing the same source again. |
| Maximum sampled whole-app memory across the sequence | 1.63 GB | 1.55 GB | Both below the 4 GB ceiling. |

Before is the `3411e81e` app. After is the implementation in this commit.
Different preparation settings and an authored SDR base each need their
own preparation. The locked Denoise delivery smoke returned the same
perceptual metrics before and after.

## November 20 — Canon zoom, Library and Match on the minimum Mac

MacBook Neo A18 Pro, 8 GB, 1408 × 794 points and the shared GPU lock.
Canon IMG_0790.CR2 unless named otherwise. These are observations from
the November 20 checks on the `3411e81e` app with the driver fixes, plus
the confirmed Match case after the Grade reuse change. PC timings have
their own baseline.

| Action | Mac time | Conditions |
| --- | ---: | --- |
| Canon SDR at Fit, with Denoise off / Standard / Fine / Clean | 0.06 / 0.25 / 13.04 / 5.22 s | First settled view for each state, starting with an already open RAW. Fine-to-Clean uses the existing preparation. |
| Canon SDR Fit → 100%, off / Standard / Fine / Clean | 2.34 / 2.89 / 3.13 / 1.31 s | Maximum whole-app footprint 2.03 GB across the SDR check, below the 4 GB ceiling. |
| Canon HDR Fit → 100%, Standard / Fine / Clean | 0.51 / 0.80 / 0.62 s | Exact viewport presentation, after Fit has prepared the method. All pan stops and the cropped and rotated SDR run passed. |
| 640-pixel HDR Library Grain, Fine / Clean | 0.48 / 0.35 s to error | Live draw never received the completed correction region. Existing CPU fallback graph took 3.36 / 2.82 s including decode and missed the colour gate. |
| 640-pixel HDR Library trials, Fine / Clean | 0.59 / 0.73 s for warm Grade result; 0.67 / 0.55 s at 1280; 4.41 / 7.17 s exact | CPU probes start with a decoded RAW. Warm Grade reading also excludes the original preparation. Only the exact export route agrees with export. No Library rendering change shipped. |
| Match to the exact SDR picture | Canon linked 4.09 s; hibiscus independent 3.71 s; separately edited Canon independent 5.47 s | Photographs already open, one run each. The 5.47 s case uses the Canon at +1 EV with a 120/450-nit HDR compression range. |
| Match refusal, Canon +1 EV and 120/300 nits | 9.27 s | Prior SDR grade preserved. P95 colour 0.077 against the 0.050 safety limit. |

[November 20 Mac report](briefs/denoise-mac-open-items-2026-11-20.md)

## November 19 ? Windows Automatic Match certification

Windows PC, separate Electron profiles at 2560?1440 under the shared GPU lock.
Median of three trials on each side, from button click to the exact SDR picture
on screen. Import was complete before timing. The update changes the tests only.

| Photo | Before ? after | Route and exact P95 OKLab |
| --- | ---: | --- |
| IMG_0790.CR2, HDR exposure +0.2 EV | 3.16 ? 3.41 s | Linked SDR, 0.00170 |
| DSC04375.ARW, HDR exposure +2 EV | 4.09 ? 4.24 s | Independent fit, 12 GPU candidates, 0.00618 |

Both routes passed their existing checks in every timed run and stayed within
the existing 10% Grade timing tolerance. The independent fit never fell back.
The baseline is `0ce4eaec`. Evidence in `codebase/output`:
`sdr-match-baseline.log`, `sdr-match-parity.log` and `sdr-match-final-timing.log`.
The Canon's independent route remains unqualified. A separate +1 EV HDR
grade with 120/300-nit highlight compression was refused after CPU fitting
gave 0.061 exact P95 OKLab against the 0.050 gate.

In the calibrated TIFF diagnostic, linking was bypassed to match the Python
bridge fixture. All 25 real GPU candidates were compared to their exact CPU
renders. For CPU-black pixels, the GPU's worst per-candidate 99th percentile
was zero. Worst per-candidate P95 GPU-to-CPU OKLab was 0.00053. Exact Match
certification was 0.02561 OKLab against 0.050, with median luma error 0.01614
(the CPU-only fixture fit measures 0.01593). The mock's artificial 0.002
black lift instead gave 0.05454 exact OKLab and correctly triggered fallback.

## November 19 — Denoise zoom and JPEG Ultra HDR on the minimum Mac

MacBook Neo, A18 Pro, 8 GB, Electron at 1408×794 under the shared GPU lock.
Same approved RAWs, Grade defaults and RAW cleanup as the baseline below.
The figures are single elapsed observations. Memory is the maximum sampled
whole-app physical footprint in decimal GB. The sample window includes the
preceding 500 ms. Compare timing movements against the existing 5% band.

| Photo | Method | 110% wait before → after (s) | 110% memory before → after (GB) | 110% → Fit (s) | Fit → 100% (s) | 100% → 110% (s) | Warm zoom peak (GB) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Canon | Standard | 1.54 → 0.41 | 2.43 → 2.10 | 0.26 | 0.40 | 0.37 | 1.87 |
| Canon | Fine Grain | 14.40 → 11.52 | 2.73 → 2.01 | 1.25 | 0.68 | 0.25 | 1.78 |
| Canon | Clean Grain | 13.54 → 2.63 | 2.68 → 1.81 | 0.97 | 0.60 | 0.21 | 1.79 |
| Sony | Standard | 2.85 → 0.46 | 4.45 → 3.78 | 0.28 | 0.42 | 0.35 | 3.78 |
| Sony | Fine Grain | 34.06 → 25.69 | 4.69 → 2.28 | 2.21 | 0.63 | 0.21 | 2.14 |
| Sony | Clean Grain | 32.96 → 5.05 | 4.52 → 2.14 | 1.87 | 0.56 | 0.24 | 2.14 |

On both photos, the final native drawing surfaced the visible region at each
zoom and passed the viewer coverage check. The display buffer at 110% was
about 2430 × 1015, about 20 MB per HDR surface. The 42 MP full drawing buffer
would use 339 MB per HDR surface. Standard's shorter last-picture wait
includes the removal of a whole-image catch-up render after the viewport was
already drawn. Cold Fine Grain timing varies with preparation and I/O.

The Clean Grain switch reused the whole-photo fit and native Fine Grain RGB
and ran zero wavelet tiles. It was faster than the projected 6–8 s Canon
and 13–17 s Sony.

The intermediate two-photo run repeated cold Fit and 100%, one Detail
Recovery drag and 100% → Fit and back for each method. Its native surface was
still full size. These are timing observations from that intermediate build.

| Photo | Method | Fit first (s) | 100% first (s) | Detail Recovery drag (s) | 100% → Fit (s) |
| --- | --- | ---: | ---: | ---: | ---: |
| Canon | Standard | 0.31 | 0.26 | 0.12 | 0.10 |
| Canon | Fine Grain | 12.37 | 13.45 | 0.17 | 0.85 |
| Canon | Clean Grain | 16.24 | 16.43 | 0.12 | 0.98 |
| Sony | Standard | 1.16 | 0.40 | 0.12 | 0.24 |
| Sony | Fine Grain | 31.78 | 34.72 | 0.20 | 1.89 |
| Sony | Clean Grain | 40.54 | 41.81 | 0.16 | 1.86 |

### JPEG Ultra HDR delivery

Full-size quality 90 exports with Denoise enabled for both renditions.
Reduced Proof uses a 1200 px artifact at a 1000-nit display target. Time and
whole-app peak appear together below. A dash marks a missing baseline.

| Photo | Method | Export before (s / GB) | Export after (s / GB) | Reduced Proof before → after (s) | Reduced Proof after (GB) |
| --- | --- | ---: | ---: | ---: | ---: |
| Canon | Standard | 20.45 / 4.76 | 12.57 / 4.23 | 5.73 → 2.72 | 3.25 |
| Canon | Fine Grain | — | 27.76 / 3.14 | — → 3.10 | 2.88 |
| Canon | Clean Grain | — | 34.10 / 3.50 | — → 2.89 | 2.98 |
| Sony | Standard | 69.32 / 6.82 | 38.67 / 3.75 | 3.83 → 2.60 | 3.77 |
| Sony | Fine Grain | 90.22 / 6.57 | 45.56 / 5.91 | 3.75 → 4.67 | 4.77 |
| Sony | Clean Grain | 111.39 / 6.63 | 52.84 / 5.96 | 3.85 → 3.48 | 4.39 |

Canon Standard ran on the GPU before the last change to account for overlapping
readback and upload arrays in admission. The final Canon Standard delivery
route still needs a measured check. Canon Fine and Clean used file-backed CPU
strips. Sony Standard reduced Proof was measured in the earlier bounded-zoom
run. The last Sony run reached **119.12 s / 13.50 GB** for Standard full-size
Proof. The spike came from decoded Proof reconstruction after encoding. The
subsequent Sony Fine and Clean export and reduced Proof peaks include memory
left by full-size Proof. The earlier Sony measurements also exceeded 4 GB for
those modes, before the file-backed export destination was built. The final
fresh-profile memory qualification for those combinations remains open.

[Real-app timing driver](../../codebase/tests/performance/denoise-grain-latency.js)

## November 19 — Windows Grade Grain preparation race

The live log from `4479f494` shows two Fine Grain preparations for the same
Canon 5202 × 3464 HDR source. They took 18.12 s and 15.69 s. The first draw
measured noise at the 1611 px Fit size and the backend fitted the native
source separately. Publishing the native noise measurement led to a second
preparation and expired the token the viewer was still using. Scratch
reservation succeeded both times. These are observations from Steve's
Windows session at 2560 × 1440.

The fix was checked on the same Canon RAW in HDR on Windows, Electron at
2560 × 1440 under the shared GPU lock. The disposable grade used default
Grade settings and Even out harsh specks at ×2.5. These are single
input-to-picture observations.

| Action | Wait |
| --- | ---: |
| Enable Fine Grain at Fit | 17.57 s |
| Fine Grain Fit → 100% | 1.80 s |
| Fine → Clean Grain at 100% | 4.20 s |
| Clean Grain 100% → Fit | 1.09 s |

The Clean switch reused the Fine Grain RGB. The pan and Navigate checks kept
the whole picture mounted, including 112 Fine and 124 Clean frames that
needed the softer layer. Across 3,400 samples there were no blank viewers or
error statuses.

## November 19 — Windows Grade Denoise picture stability

Windows PC, Electron at 2560 × 1440 under the shared GPU lock, Canon
`IMG_0790.CR2` in Grade HDR with Highlight Compression Peak Fit (Maximum)
and Even out harsh specks at ×2.5. Baseline: `91406215`. The holds ran for
31 seconds at each zoom. The baseline samples started five seconds after
the first exact picture. The fixed samples also waited for initial highlight
and scope work to finish. Soft swaps after one +0.25 EV exposure change
were counted over the next ten seconds at 100%.

| Method | Fit requests before → after (source / Grain / proxy) | 100% requests before → after (source / Grain / proxy) | Soft swaps while still at 100% | Soft swaps after exposure change |
| --- | --- | --- | ---: | ---: |
| Standard | 35 / 0 / 0 → 0 / 0 / 0 | 0 / 0 / 0 → 0 / 0 / 0 | 0 → 0 | 3 → 0 |
| Fine Grain | 0 / 0 / 0 → 0 / 0 / 0 | 662 / 329 / 19 → 0 / 0 / 0 | 9 → 0 | 4 → 0 |
| Clean Grain | 0 / 0 / 0 → 0 / 0 / 0 | 892 / 471 / 27 → 0 / 0 / 0 | 14 → 0 | 4 → 0 |

The app requested zero new Grain preparations during the holds in both
builds. The fixed run had no 507 responses and peaked at 1.96 GB whole-app
memory. Scroll and Navigate tests kept the whole photo visible in 1,315
sampled pan frames and reached sharp coverage at each stop. The soft layer
covered newly exposed areas in 100 Standard, 148 Fine and 145 Clean frames.

Single waits with the fix were 0.52 s to enable Standard at Fit and 14.14 s
to switch from Standard to Fine at 100%. Fine to Clean at 100% took 4.04 s
and finished without an error. Fit to 100% took 0.67 s for Standard, 1.73 s
for Fine and 1.76 s for Clean. Fine and Clean returned from 100% to Fit in
1.19 s and 1.13 s.

## November 19 — Denoise after the railing-light fix

MacBook Neo, A18 Pro, 8 GB, Electron at 1408×794 under the shared GPU lock.
The decoded-pixel baseline is commit `5d04daa0`. The runs add timing diagnostics
around the existing rendering paths. The input RAWs are the 18.02 MP Canon
`IMG_0790.CR2`, 42.39 MP Sony `_DSC7970.ARW` and 42.39 MP atrium
`DSC01212.ARW`, with lens correction Off and Even out harsh specks at ×2.5.
Fit drew 1288×858 on the Canon and 1285×858 on the Sony. The marked portrait
`DSC05622.ARW` is part of the image reference.

Each value is one observation. Times are seconds from the action to the last
accepted picture, or to completion shown in Export. Export uses full-size
quality 90 JPEG Ultra HDR, with the method applied to both renditions. Proof
builds and visibly presents a reduced 1200 px JPEG Ultra HDR at a 1000-nit
display target. Memory is the app's sampled physical footprint in decimal GB,
with the usual 500 ms census. A sub-sample peak can be higher.

| Photo | Method | Fit first | 100% first | 110% enable / switch | Recalculate at Fit | 100% → Fit | Fit → 100% | Pan at 100% | Full export | Reduced Proof | Peak GB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Atrium | Standard | — | — | 2.77 | — | — | — | — | — | — | 4.11 |
| Atrium | Fine Grain | — | — | 32.85 | — | — | — | — | — | — | 4.31 |
| Atrium | Clean Grain | — | — | 32.72 | — | — | — | — | — | — | 4.23 |
| Canon | Standard | 0.28 | 1.55 | 1.54 | 0.08 | 0.10 | 1.05 | 0.91 | 20.45 | 5.73 | 4.76 |
| Canon | Fine Grain | 11.22 | 13.81 | 14.40 | 12.99 | 1.16 | 0.50 | 0.41 | — | — | 2.73 |
| Canon | Clean Grain | — | — | 13.54 | — | — | — | — | — | — | 2.68 |
| Sony | Standard | 0.36 | 2.67 | 2.85 | 0.09 | 0.10 | 1.87 | 0.89 | 69.32 | 3.83 | 6.82 |
| Sony | Fine Grain | 31.13 | 31.49 | 34.06 | 30.97 | 3.19 | 0.64 | 1.00 | 90.22 | 3.75 | 6.57 |
| Sony | Clean Grain | 38.76 | 38.88 | 32.96 | 38.02 | 2.64 | 0.16 | 0.58 | 111.39 | 3.85 | 6.63 |

### First preparation breakdown

Model requests are time spent in network requests for the noise model. Setup
includes the noise model and, for experimental methods, native backend setup.
Grain fit and filter plus writes are elapsed backend stages inside setup. The
four worker values are cumulative time across parallel tiles and overlap.
File-write time measures submitting bytes to the scratch file. Region reads
cover the request intervals without double-counting overlapping requests.
Upload is time spent submitting texture writes. Tile rendering can include
some of those reads and uploads. Paint delay is the time after the final
submit to the observed frame.

| Photo | Method | First action | Rendering route | Whole wait | Model requests | Setup | Grain fit | Filter + writes | Worker wavelet / colour / pack / write | Region reads | Upload | GPU resolve | Render / submit | Paint delay |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Atrium | Standard | 110% | Tiled (streamed) | 2.77 | 0.12 | 0.13 | — | — | — | — | — | — | 1.662 | 0.017 |
| Atrium | Fine Grain | 110% | Tiled (streamed) | 32.85 | 0.01 | 31.94 | 8.28 | 23.60 | 117.57 / 0.00 / 0.94 / 15.17 | 0.94 | 0.047 | — | 0.841 | 0.013 |
| Atrium | Clean Grain | 110% | Tiled (streamed) | 32.72 | 0.61 | 31.84 | 0.00 | 31.17 | 114.41 / 34.77 / 1.37 / 20.28 | 1.36 | 0.042 | — | 0.816 | 0.005 |
| Canon | Standard | Fit | direct | 0.28 | 0.09 | 0.18 | — | — | — | — | — | 0.05 | 0.000 | 0.008 |
| Canon | Standard | 100% | Tiled (streamed) | 1.55 | 0.00 | 0.00 | — | — | — | — | — | — | 0.568 | 0.016 |
| Canon | Standard | 110% | Tiled (streamed) | 1.54 | 0.00 | 0.01 | — | — | — | — | — | — | 0.546 | 0.030 |
| Canon | Fine Grain | Fit | direct | 11.22 | 0.00 | 10.35 | 2.22 | 8.12 | 39.95 / 0.00 / 0.29 / 5.18 | 0.80 | 0.007 | 0.82 | 0.000 | 0.026 |
| Canon | Fine Grain | 100% | Tiled (region) | 13.81 | 0.00 | 13.04 | 3.10 | 9.93 | 43.10 / 0.00 / 0.34 / 6.84 | 0.48 | 0.042 | — | 0.524 | 0.013 |
| Canon | Fine Grain | 110% | Tiled (streamed) | 14.40 | 0.01 | 13.84 | 3.96 | 9.87 | 47.82 / 0.00 / 0.38 / 6.17 | 0.40 | 0.040 | — | 0.486 | 0.025 |
| Canon | Clean Grain | 110% | Tiled (streamed) | 13.54 | 0.00 | 12.99 | 0.00 | 12.98 | 48.69 / 14.89 / 0.61 / 7.46 | 0.40 | 0.038 | — | 0.490 | 0.027 |
| Sony | Standard | Fit | direct | 0.36 | 0.16 | 0.27 | — | — | — | — | — | 0.06 | 0.000 | 0.003 |
| Sony | Standard | 100% | Tiled (streamed) | 2.67 | 0.01 | 0.01 | — | — | — | — | — | — | 1.664 | 0.019 |
| Sony | Standard | 110% | Tiled (streamed) | 2.85 | 0.12 | 0.13 | — | — | — | — | — | — | 1.722 | 0.010 |
| Sony | Fine Grain | Fit | direct | 31.13 | 0.00 | 29.09 | 6.71 | 22.37 | 107.14 / 0.00 / 0.89 / 16.50 | 1.96 | 0.010 | 1.98 | 0.000 | 0.025 |
| Sony | Fine Grain | 100% | Tiled (region) | 31.49 | 0.01 | 30.41 | 7.72 | 22.67 | 111.97 / 0.00 / 0.83 / 14.03 | 0.47 | 0.046 | — | 0.741 | 0.023 |
| Sony | Fine Grain | 110% | Tiled (streamed) | 34.06 | 0.02 | 33.30 | 8.03 | 25.23 | 120.41 / 0.00 / 0.99 / 19.47 | 0.50 | 0.045 | — | 0.689 | 0.008 |
| Sony | Clean Grain | Fit | direct | 38.76 | 0.00 | 35.82 | 6.96 | 28.85 | 109.02 / 35.87 / 1.33 / 19.16 | 2.44 | 0.423 | 2.88 | 0.000 | 0.015 |
| Sony | Clean Grain | 100% | Tiled (region) | 38.88 | 0.00 | 37.65 | 7.60 | 30.04 | 117.14 / 36.33 / 1.39 / 17.61 | 0.53 | 0.044 | — | 0.850 | 0.025 |
| Sony | Clean Grain | 110% | Tiled (streamed) | 32.96 | 0.09 | 32.06 | 0.00 | 31.97 | 119.45 / 36.55 / 1.42 / 18.99 | 0.63 | 0.042 | — | 0.843 | 0.008 |

### Each slider at Fit

The three input samples span about 80 ms. Standard and Color Splotches are
timed through release. The common sliders in Fine Grain and Clean Grain show
their last live feedback while held. Grain Evenness draws its first changed
picture after release. Recalculate above shows a complete experimental rebuild
with the selected method.

| Slider at Fit | Canon Standard | Canon Fine | Canon Clean | Sony Standard | Sony Fine | Sony Clean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Amount | 0.13 | 0.19 | — | 0.17 | 0.24 | 0.13 |
| Detail Recovery | 0.12 | 0.15 | — | 0.17 | 0.14 | 0.15 |
| Luminance | 0.23 | 0.15 | — | 0.15 | 0.15 | 0.14 |
| Color Noise | 0.20 | 0.14 | — | 0.12 | 0.14 | 0.19 |
| Finest | 0.18 | 0.14 | — | 0.13 | 0.15 | 0.14 |
| Fine | 0.12 | 0.13 | — | 0.22 | 0.14 | 0.13 |
| Medium | 0.17 | 0.13 | — | 0.17 | 0.14 | 0.15 |
| Coarse | 0.25 | 0.14 | — | 0.12 | 0.18 | 0.14 |
| Grain Evenness | — | 12.59 | — | — | 26.78 | 33.16 |
| Color Splotches | — | — | — | — | — | 0.15 |

### Memory at 110%, zoom-out and export

The gate is 4.00 GB. The 4.55 GB Sony Clean Grain zoom-out from the earlier
native-preparation run remains a failure. The fresh measurements below include
the earlier Denoise action in the 500 ms sampling window at very short actions.

| Measured memory | Standard | Fine Grain | Clean Grain |
| --- | ---: | ---: | ---: |
| Canon 110% | 2.43 | 2.73 | 2.68 |
| Sony 110% | 4.45 | 4.69 | 4.52 |
| Atrium 110% | 4.11 | 4.31 | 4.23 |
| Canon 100% → Fit | 2.66 | 2.67 | — |
| Sony 100% → Fit | 4.38 | 4.87 | 4.34 |
| Canon full export | 4.76 | — | — |
| Sony full export | 6.82 | 6.57 | 6.63 |

At 110% each action started one client preparation, with zero cancellations,
stale preparations or restarts in the trace. Standard showed Preparing then
Ready. Both method switches showed Recalculating then Ready, with the previous
picture available while work ran. Fine Grain and Clean Grain each issued one
successful native preparation request. Clean Grain reused the whole-photo
grain fit from Fine Grain.

Both 100% and 110% requested the native processing edge. The 110% sequence
used tiled streaming from Standard through both switches. The fresh 100%
experimental activations used tiled visible-region transport. Fit used the
direct renderer with downsampled reads from the same type of native
preparation. The sequence and the percentage both differ between the
samples. On the Sony, Fine Grain spent 33.25 of 34.06 s inside setup at 110%,
and the last tiled render used 0.69 s. A repeated preparation did not account
for the long wait in the observed run.

All three Sony full exports completed on CPU after GPU memory admission.
They reached 6.57–6.82 GB. The Sony Fine Grain zoom-out reached 4.87 GB,
and the Sony Clean Grain zoom-out reached 4.34 GB on this run. Both cross
the 4 GB gate. Canon Standard export completed on GPU and reached 4.76 GB.

The timed extension stopped at the agreed cutoff. Open cases are Canon
Fine Grain full export and Proof, and Canon Clean Grain at Fit and 100%,
including Recalculate, zoom, pan, slider drags, full export and Proof.
The atrium was timed at 110%. The portrait was used for image comparison.

[Timing driver](../../codebase/tests/performance/denoise-grain-latency.js) ·
[Reference review](../../codebase/output/review/denoise-speed-baseline/index.html) ·
[Local timing receipts](../../codebase/output/denoise-validation)

## November 19 — Experimental Denoise in the app

MacBook Neo, A18 Pro, 8 GB, Electron at 1408×794, shared GPU lock. Native
18.02 MP Canon IMG_0790.CR2 and 42.39 MP Sony _DSC7970.ARW, with Even out
harsh specks at ×2.5. Fit used 1288×858 and 1285×858, respectively. Preparation
runs from the control action to the exact picture at the requested zoom.
The first preview can be a different picture that appears while work runs.
These are single action-to-screen measurements, with the photo already open.

### Original build (ea6aaaef)

The earlier 1.68 s Clean Grain preparation readings were measured at Fit.
The updated driver reproduced Steve's 30-second wait at 100%.

| Action | 18 MP Canon | 42 MP Sony |
| --- | ---: | ---: |
| Fine Grain, first preparation at Fit | 1.17 s | 0.46 s |
| Fine Grain, first preparation at 100% | 3.83 s | 9.95 s |
| Fine Grain, Recalculate at Fit | 0.46 s | 0.29 s |
| Fine Grain, 100% to Fit | 0.28 s | 0.44 s |
| Fine Grain, Fit to 100% | 3.92 s | 9.77 s |
| Clean Grain, first preparation at Fit | 2.03 s | 2.41 s |
| Clean Grain, first preparation at 100% | 33.86 s | 74.83 s |
| Clean Grain, Recalculate at Fit | 1.70 s | 1.63 s |
| Clean Grain, 100% to Fit | 35.99 s | 100.10 s |
| Clean Grain, Fit to 100% | 31.43 s | 82.16 s |

At 100%, backend Clean Grain preparation took 32.32 s of the Canon's
33.86 s and 72.91 s of the Sony's 74.83 s. On the Canon, the 18 correction
requests transferred 72 MiB and took 0.92 s in total. The zoom-out runs
each rebuilt the Fit result, repeated native preparation, and then rebuilt
Fit again. The sampled pans reused their preparation. The Sony pan drew
in 0.53 s. One Canon pan stalled for 88.78 s during reported system memory
pressure, with two correction reads totaling 0.12 s and no preparation.

The earlier drag and native export trials used this build. The drag clock
ran to the next accepted frame. Native JPEG Ultra HDR export used the GPU,
quality 90, with the 1000-nit target.

| Action | 18 MP Canon | 42 MP Sony |
| --- | ---: | ---: |
| Fine Grain, Amount drag | 98–102 ms | 98–348 ms |
| Clean Grain, Color Splotches drag | 100–117 ms | 100–115 ms |
| Clean Grain, Dark Specks drag | 100–110 ms | 97–102 ms |
| Fine Grain, native export | 16.56 s | 45.21 s |
| Clean Grain, native export | 43.18 s | 124.81 s |

### Native grain preparation

Same MacBook Neo, RAWs, settings, window and lock. These action-to-screen
samples cover the disk-backed implementation in this branch. Canon samples
precede the visible-region-only follow-up. Sony Clean Grain's 100% and
navigation samples use the follow-up. The Sony Fine Grain run precedes it.
The cases that moved by more than 10% are shown with the zoom and pan waits.

| Action | 18 MP Canon | 42 MP Sony |
| --- | ---: | ---: |
| Fine Grain, first preparation at Fit | 13.25 s | 26.70 s |
| Fine Grain, first preparation at 100% | 14.27 s | 38.19 s |
| Fine Grain, Recalculate at Fit | 12.32 s | 27.90 s |
| Fine Grain, 100% to Fit | 0.92 s | 2.02 s |
| Fine Grain, Fit to 100% | 1.07 s | 5.15 s |
| Fine Grain, pan at 100% | 0.90 s | 0.90 s |
| Clean Grain, first preparation at Fit | 15.50 s | 35.61 s |
| Clean Grain, first preparation at 100% | 18.22 s | 31.86 s |
| Clean Grain, Recalculate at Fit | 15.57 s | 33.30 s |
| Clean Grain, 100% to Fit | 1.24 s | 2.79 s |
| Clean Grain, Fit to 100% | 1.04 s | 0.13 s |
| Clean Grain, pan at 100% | 0.90 s | 0.45 s |

Every sampled experimental pan and zoom reused the same native result.
A Fit photo fills the viewer and does not take a pan. Canon Clean Grain
at Fit spent 3.00 s fitting the grain and 11.53 s filtering and writing
the temporary result. At 100% those stages took 3.07 s and 12.47 s.
The shortest candidate for further CPU savings is to render each wavelet
tile once and reuse its neighbouring finished pixels for the colour pass,
cutting repeated work in tile overlaps. This is a proposed optimization.

The Sony result occupies 678,236,160 bytes on disk. Its native source is
508,677,120 bytes. In the visible-region follow-up, the whole-app physical
footprint still reached 4,547,194,712 bytes during 100%-to-Fit. The disk
allowance passed. The 4 GB whole-app memory limit remains a failing gate.
Native RAW export timings for this revision are unmeasured.

[Timing driver](../../codebase/tests/performance/denoise-grain-latency.js)

## November 18 — Relative colour and patch repair (Denoise research)

MacBook Neo, A18 Pro, 8 GB, research code `c2364570`. Native 18.02 MP Canon
IMG_0790.CR2 and 42.39 MP Sony _DSC7970.ARW. Three full-frame CPU runs per
photo through the shared lock with the app CPU pool and one thread per
OpenCV/BLAS operation. Seconds are medians and observed ranges. Signed RAW
development and the noise model are ready before these clocks start.
Even keep includes its whole-photo grain fit. Added times after Even keep
include reading and writing the complete result. The order of those passes
reverses on the middle run.

| Action | Canon 18.02 MP | Sony 42.39 MP | Conditions |
| --- | ---: | ---: | --- |
| Today, full CPU Denoise resolve | 3.29 (2.85–3.66) | 9.11 (7.54–9.12) | MacBook Neo, shipping Denoise, tamed RAW ready |
| Even keep brightness 18 px | 6.13 (4.90–6.46) | 14.43 (13.49–15.04) | MacBook Neo, grain fit + resolve |
| Green/magenta channel balance (strong) | +0.82 (0.77–0.89) | +2.06 (2.01–2.16) | MacBook Neo, after Even keep |
| Relative colour cleanup (gentle) | +0.57 (0.48–0.59) | +1.34 (1.30–1.38) | MacBook Neo, after Even keep |
| Relative colour cleanup (strong) | +0.59 (0.47–0.65) | +1.32 (1.32–1.45) | MacBook Neo, after Even keep |
| Relative colour cleanup (large splotches) | +1.07 (0.89–1.20) | +2.50 (2.47–2.54) | MacBook Neo, after Even keep |
| Nearby patch healing | +3.19 (2.20–3.21) | +5.83 (5.78–5.98) | MacBook Neo, after Even keep |
| Whole-area patch averaging | +6.68 (5.65–8.17) | +15.97 (15.26–16.04) | MacBook Neo, after Even keep |
| Large-splotch colour cleanup + nearby healing | +3.63 (3.12–3.93) | +8.32 (8.23–9.42) | MacBook Neo, both passes after Even keep |
| Even keep 18 px + large-splotch colour cleanup + nearby healing | 9.76 (8.01–10.39) | 22.75 (21.72–24.47) | MacBook Neo, sum per run, tamed RAW and model ready |
| AI Denoise reference | 11.16 | 29.88 | MacBook Neo, one guarded Bayer AI render each, including RAW preparation and highlight blending, Canon reused from round 4 and Sony disk-backed |

Noisy is the developed source with Denoise off. This is an offline study and
the clocks exclude app interaction, display conversion and writing review
images. [Round 5 results](research/denoise-v1-2026-11-16/round5-relative-colour-and-patch.md)

## November 18 — Even keep brightness and targeted specks (research)

MacBook Neo, A18 Pro, 8 GB, base `f2e57fef` with the research tools in this
commit. Three paired native runs with the shared CPU pool and the shared lock.
The same signed, tamed frame and Denoise noise model are already available at
each size. Canon IMG_0790.CR2 and Sony DSC04375.ARW. Numbers are medians with
observed ranges in seconds. Small differences inside the timing spread describe
the sample. These are CPU resolve and post-pass times.

| Action | 18.02 MP | 42.39 MP | Conditions |
| --- | ---: | ---: | --- |
| Today, full CPU resolve | 3.59 (2.97–3.86) | 9.46 (8.30–9.52) | MacBook Neo, production baseline |
| Even keep 18 px, local average only | +0.09 (0.04–0.32) | +0.08 (0.06–0.95) | MacBook Neo, paired against Today |
| Even keep 18 px, local grain-weighted | +0.16 (0.02–0.58) | +0.60 (0.51–1.37) | MacBook Neo, paired against Today |
| Even keep 18 px, grain-matched, including fit | +2.92 (2.69–3.55) | +6.31 (6.16–7.33) | MacBook Neo, paired against Today |
| Grain fit only | 2.57 (2.30–2.62) | 6.08 (6.02–6.08) | MacBook Neo, per-photo grain adjustment |
| Hue unify, strong | +3.66 (3.34–3.68) | +8.75 (8.71–8.83) | MacBook Neo, direct extra pass |
| Green/magenta cleanup, strong | +0.88 (0.81–0.95) | +2.14 (2.11–2.47) | MacBook Neo, direct extra pass |
| Green/magenta channel balance, strong | +0.88 (0.80–0.98) | +2.16 (2.13–2.40) | MacBook Neo, direct extra pass |
| Dark clump breakup, strong | +0.43 (0.41–0.45) | +1.29 (0.98–1.30) | MacBook Neo, direct extra pass |
| Dark clump breakup, Medium only, strong | +0.62 (0.55–0.62) | +1.48 (1.45–1.50) | MacBook Neo, direct extra pass |
| Grain-matched 18 px + strong channel balance + strong clump breakup | +4.13 (4.02–4.96) | +9.78 (9.54–10.74) | MacBook Neo, summed incremental costs against Today |

[Round 4 results](research/denoise-v1-2026-11-16/even-keep-round4.md)

## November 18 — Canon speck strength ladders (research)

MacBook Neo, A18 Pro, 8 GB. Two opposite-order single-worker CPU sweeps under
the shared lock on the same 18.02 MP `IMG_0790.CR2` frame, started from
`a20dd944` with the research scripts in this commit. The observed baseline
spread exceeds the earlier ±10% descriptive allowance. Ranges describe these
runs. The timings measure native filtering with the developed frame and model
already available, except for AI’s separate original-RAW route.

| Action | Observed seconds | Conditions |
| --- | ---: | --- |
| Signed AHD with Even out ×2.5, and shared noise measurement | 3.23 and 1.65 | One preparation before both sweeps |
| Shipping Denoise | 4.86–5.80 | Native baseline resolve |
| Even keep, energy-matched / band removal | 13.30–19.78 / 3.74–4.30 | Energy-matched timing includes 9.66–10.40 s of whole-frame calibration |
| Stronger Denoise | 3.92–5.84 | Fine and Medium resolve, all tested targets and strengths |
| Fill pits inside / after Denoise | 6.47–8.22 / 7.14–8.58 | Native resolve plus fill. Brightness-only post-pass takes 2.26–2.55 s |
| Whole-image smoothing | 4.90–6.00 | Shipping resolve plus smoothing. Combined 8-pixel step adds 0.14 s |
| RawNIND Bayer with protected Opposed reconstruction | 14.40 | One cold original-RAW run. Model stage 9.69 s, child sampled peak 1.53 GB |

[Canon speck strength ladders](research/denoise-v1-2026-11-16/canon-speck-ladder.md)

## November 18 — Marked colour speck trials (research)

Paired native CPU resolve timings use the existing ±10% descriptive allowance
because timings vary between runs on the same machine. The trial goal is about
1 second added at 18 MP. The scope starts with the developed image and a shared
noise model and ends at the reconstructed colour-only result. App slider latency
is a separate gate.

| Action | 18.02 MP, seconds | 42.39 MP, seconds | Conditions |
| --- | ---: | ---: | --- |
| Today + Even out source, Denoise resolve | 3.51 (3.05–3.62) | 8.66 (8.59–8.96) | November 18, MacBook Neo A18 Pro/8 GB, `f0bb2405` with research scripts in this commit. IMG_0790.CR2 and DSC04375.ARW, same tamed source and noise model, shared CPU pool, three alternated runs under the shared lock. |
| A, wide colour after Denoise | +1.16 (+1.06–1.29) | +3.05 (+2.34–3.33) | Same Mac, median and range of paired differences against today. |
| A, wide colour before Denoise | +4.86 (+4.79–5.37) | +12.21 (+11.40–12.68) | Same Mac and pairing. Includes the second resolve needed to hold baseline luminance. |
| B, brightness-guided colour inside Denoise | +0.58 (+0.23–0.85) | +0.67 (+0.36–0.68) | Same Mac and pairing. One wavelet solve. |

[Trial and review](research/denoise-v1-2026-11-16/colour-speck-trials.md)

## November 18 — Denoise keep-factor diagnostic

| Action | Observed wall time | Conditions |
| --- | ---: | --- |
| Produce the six-photo same-site attribution receipt | 18.83 s | MacBook Neo, A18 Pro, 8 GB, `c91546bc`, shared lock, single-worker CPU, one complete receipt run. Native-size noise sample windows plus 512 px test crops, seven whole-photo noise fits, exact CPU reconstruction check. Research command to JSON only. Peak process-tree RSS 0.814 GB. [Receipt](research/denoise-v1-2026-11-16/keep-survivors-receipt.json). |

## November 17: optional harsh-speck sensor clamp (minimum Mac)

MacBook Neo / A18 Pro / 8 GB, shared GPU lock, window setting 1408×794,
OpenMP3/BLAS1, approved originals read-only. Implementation based on `b1d0e63e`,
recorded in this implementation commit. Three observations per setting,
alternating Off/On/On/Off/Off/On on the same unpacked source; the ±10%
descriptive allowance was proposed in the trial log before measurement.
No existing tolerance, limit or budget changes. Hot pixels off, speck threshold
2.5, included absolute floor .005. Source open/unpack, EXIF, lens, WB/matrix,
Denoise, UI and delivery are excluded: this is sensor cleanup + Opposed + signed
AHD to camera RGB, not action-to-screen latency or a claimed speedup.

| Action, same Mac | Off → On (median; observed range) | Added development / cleanup step |
| --- | --- | --- |
| 18.02 MP Canon IMG_0790.CR2 | .929 s (.913–.935) →2.134 s (2.103–2.196) | +1.205 s; cleanup 1.213 s (1.191–1.254), including noise fit |
| 42.39 MP Sony DSC04375.ARW | 2.485 s (2.472–2.636) →5.238 s (5.235–5.248) | +2.753 s; cleanup 2.751 s (2.699–2.771), including noise fit |

Off invokes neither noise fitting nor clamping (exact sample and developed-pixel
result tests); only the pre-existing development work remains. All timing
spreads are inside the declared allowance. Receipt:
`codebase/output/raw-speck-cleanup/measurement.json`; reusable read-only tool
`codebase/tools/measure_raw_specks.py` also records the no-floor/.001/.002/.005
comparison. .005 reduces clean changed readings by 95.2% and total correction
by 81.3%; noisy changed readings and total correction are exactly unchanged.

Focused real-app timings for this control (`bb8c9b1e` plus qualification drivers
in this commit; same Mac/date/window, disposable profiles, existing 4GB setting,
serial shared lock):

| Action | Observed range | Conditions |
| --- | --- | --- |
| Two-photo Edge Grade import →first picture, both cleanup options enabled | CPU 10.491–25.811 s; GPU 7.866–23.915 s | DSC00264.ARW and IMG_3129.CR2; complete request/display path, threshold2.5; Library saved-GPU scene 5.965–11.539 s |
| Same two-photo Edge check, both options off | CPU 8.004–19.544 s; GPU 5.487–18.066 s | Separate regression invocation, same sources; Library 3.607–6.246 s. These are validation observations, not alternating whole-wait performance pairs or a new budget |
| Five-photo default Library GPU RAW thumbnail request | .678–1.023 s, GPU development .158–.475 s | Existing five-source corpus, Off; CPU comparison development 2.66–9.88 s; different routes, no speedup claim |
| Plain 90-second Library viewport check | First picture .6 s; total runner 93.93 s; 9/9 visited photos pass | Frozen library-mixed-v1, visible plain Electron, both cleanup options off; unvisited photos are outside this default check |
| Ten-step plain-Electron Single check | Open .382 s; steps .099–10.518 s (median1.597); sequence32.826 s, total runner94.20 s; pass | Same frozen fixture, visible window, default cold/source routes; descriptive validation timings, no new responsiveness gate |


Receipts: `codebase/output/raw-speck-cleanup/{gpu-delivery,edge-colour-raw,library-gpu-raw}.log`
and `codebase/output/edge-colour-raw/1794927668959/comparison.json` (enabled),
plus `codebase/output/quick-library-check/speck-{plain,single}/report.json`.

Fast qualification on this same Mac: Node 15.56 s (1,108 pass / one skip),
Python 319.30 s (4,236 pass / 155 skips / one xpass), focused sensor/state 2.44 s
(53 pass). These are validation durations, not application-response timings.

## November 17: green–magenta colour cleanup (research only)

MacBook Neo / Apple A18 Pro / 8 GB / one CPU-native thread, November 17, 2026;
adapter `cc48b535`, exact source/inventory hashes in each receipt. Shared machine
lock, no overlapping heavy job, unchanged 2.5 GB research tree-RSS guard.
Complete RAW open/normalization/signed research AHD, global corrected model,
default Denoise and colour cleanup; every native pixel consumed. 768px cores,
64px sensor-development and 66px Denoise context; larger context than earlier
32px readers. Single observations, inherited ±10% descriptive allowance.
**These are CPU research-pipeline costs, not action-to-screen or GPU timings.**
No app code/default/budget changes and no shipping recommendation.

| Same-Mac action | Canon 18.02 MP, s | Sony 42.39 MP, s |
| --- | ---: | ---: |
| Signed current Denoise, no taming | 9.56 | 19.11 |
| Approved 2.5σ taming | 12.01 | 25.37 |
| Taming + green balancing | 12.06 | 25.48 |
| Taming + camera-G median1 | 14.03 | 27.15 |
| Taming + camera-G median3 | 13.57 | 28.40 |
| Taming + median1 preserving Y | 12.99 | 27.65 |
| Taming + targeted GM2/area25 | 16.21 | 33.38 |
| Taming + green + targeted GM | 15.41 | 33.13 |
| Taming + GM + orange–blue | 18.73 | 40.20 |
| Taming + local-MAD post5×5 | 13.77 | 30.67 |
| Taming + guarded pre9×9 | 89.80 | 193.82 |
| Taming + guarded post9×9 | 47.71 | 115.04 |
| Taming + unguarded post9×9 | 25.01 | 61.39 |

Retained measurement guards total 37.8 minutes excluding lock waits, withdrawn
preliminaries and standard suites; maximum sampled tree RSS 2.244 GB. Strong
post9×9 adds 13.0/36.0 seconds over taming and suppresses 61% of counted GM
islands, but removes about 59% of real simulated-star GM signal. Protected
pre9×9 has little extra cleanup for its much larger cost. No new GPU route or
speed claim is justified; an accepted operation would need bounded CPU work
and the existing GPU route, with end-to-end qualification.

Evidence: `codebase/output/denoise-v1/chroma-cleanup/` native/phase JSON and
logs; [research result](research/denoise-v1-2026-11-16/chroma-cleanup.md).

Standard validation, same Mac: Node TAP body **14.88 s** (1,107 pass / one
skip), Python pytest body **260.40 s** (4,227 pass / 155 skips / one xpass).
Python guard including startup/shutdown 262.16s / 2.124 GB.
Corrected normal-system-temp invocations; the initial output-tree/temp-name
fixtures produced false failures, with no test/app changes. Standard Library
90-second observation takes **93.86s** including launch/shutdown,
no picture errors, 9/33 pictured in viewport scope, five valid stored pictures;
first-picture observation .4s, longest gap 7s. This is not a full-collection or
new responsiveness pass. The initial attempt mistakenly used the research
2.5 GB CPU supervisor and stopped after 16.56s; standard app limits are unchanged.
No broad GPU sweep, installer or push. Final output **13.3 GB**; review 16.215 MB.


## November 17: signed RAW validation follow-up (minimum Mac)

MacBook Neo / A18 Pro / 8 GB, November 17, unpackaged 1408x794, baseline
`7e444686`, current signed build `c3b7a3ed` plus the signed-vignetting correction
in this record's commit. Shared GPU lock, one app check at a time, no heavy
concurrent workload. These are observed validation durations, not a speed
claim, changed budget or new performance gate. All picture gates stay fixed.

| Action, same Mac | Observed duration / outcome | Conditions |
| --- | --- | --- |
| Five-photo Library GPU RAW qualification | 31.7 s final driver; all five pass | Includes CPU finished-picture oracle. A7 whole thumbnail request .872 s, GPU step .430 s; separate Grade CPU decode 7.89 s. Different paths, not a whole-user-wait comparison or speedup claim |
| RAW Single comparisons | 141–151 s including launch/oracle/shutdown; 14/18 pass on both builds | Four older failures exposed before later UI/detail waits; no completed Single/native UI timing |
| Zoomed Denoise | Initial refusal 23.8 s; quiet HEAD stopped at 103.6 s, baseline at 242.5 s | Both reach Full reference and the same straighten stall; stopped waits are not completion timings |
| Live Export tile check | 43.6–49.6 s to required-GPU assertion failure | CPU export completes on both builds; 5.332 GB fixed charge exceeds 4 GB, so no seven-export timing comparison |
| Plain-Electron 90-second Library check | Hard timeout in observe; 188.6 s including shutdown | 130-second deadline; no pictured-coverage or responsiveness pass claimed |

Retained real-app invocation windows total **23m22s**, conservatively including
launcher/shutdown and the earlier selector attempt; CPU isolation trials bring
slow validation to **about 26 minutes**. Ledger/logs:
`codebase/output/denoise-v1-followup/check-times.json`. This does not include
setup, code inspection/editing or final fast suites. No timings are compared
with PC baselines. The existing 5% live-tile allowance remains unchanged and
was not reached in these failing runs.
Final fast suites on the same Mac: Node **12.28 s**, 1,103 pass / one skip;
Python **263.53 s**, 4,215 pass / 155 skips / one xpass, existing deprecation
warning only. These are test durations, not application-response measurements.

## November 17: production Pixel cleanup CPU step

MacBook Neo / A18 Pro / 8 GB, November 17, 2026, sensor implementation
`63196460`. Shared machine lock, NumPy/BLAS one thread, one observation per source;
inherited ±10% descriptive allowance. Production `configuration` plus `apply`,
using the approved original RAWs after unpack, signed per-phase normalization,
256-row repair strips and no saved camera profile. No full-size photo copies or
retained timing scratch. Off skips both operations. These are **step costs**,
not action-to-screen waits, speed improvements or GPU timings; source
open/unpack, AHD, highlight reconstruction, rendering and delivery are excluded.

| Action, same Mac | Noise estimate + filter = total added CPU step | Conditions |
| --- | --- | --- |
| Canon 18.02 MP, cleanup on | .110 + .209 = .319 s | IMG_0790.CR2, visible 5202×3464; three candidates repaired |
| Sony 42.39 MP, cleanup on | .112 + .483 = .595 s | 2025_0730_1331_3.arw, visible 7968×5320; no candidates repaired |

Integration fast-check clocks on the same Mac: complete Node suite 14.79 s
(1,103 passed / one skipped), complete Python suite 270.46 s (4,125 passed /
155 skipped / one xpassed). These are validation durations, not app waits.
Final focused filter/state checks take 1.08/1.49 s (20/4 passed) after the added
fixture cases and mechanical test-file split, on the same Mac.

## November 17: signed Bayer production-helper development cost

MacBook Neo / A18 Pro / 8 GB, signed Bayer integration, same source and machine
for both routes. Shared machine lock; LibRaw OpenMP team 3, BLAS 1, serial
Grade row bands, signed native AHD one C thread/256-row strips. One observation
per condition, inherited ±10% descriptive timing allowance (not a correctness
gate or speed claim). Source open/unpack, demosaic/orientation and existing
normalise/WB/ACEScg tail are included. EXIF, highlight reconstruction, lens,
Denoise, rendering and action-to-screen waits are excluded.

| Action, same Mac | Unsigned control → signed production helper | Conditions |
| --- | --- | --- |
| Canon 18.02 MP development | .895 → 1.054 s; added .158 s | IMG_0790.CR2; AHD .417 → .607 s; finite output, unchanged maximum 3.05624 |
| Sony 42.39 MP development | 2.129 → 2.495 s; added .366 s | 2025_0730_1331_3.arw; AHD 1.225 → 1.879 s; finite output, unchanged maximum 2.91165 |

The added whole development subclock is about 17–18%; faster float transport
normalisation partly offsets the extra signed AHD work. This is an explained
correctness cost, not an unexplained timing drift. No GPU cost, memory pass,
parallel Library throughput or complete user-wait result is inferred. Production
code and conditions are pinned by this entry's signed RAW integration commit;
the unsigned comparison is the explicitly frozen research control, not a shipping
compatibility path. No extra timing scratch is retained.

## November 17: single-photo hot pixel filter (research only)

Research implementation `227dcaf6` / `b486999d`; no production integration.
MacBook Neo A18 Pro / 8 GB, CPU one thread, shared machine lock and unchanged
2.5 GB process-tree guard. Native RAW → normalisation → optional hot filter →
bounded AHD/global adaptive model/shipping-default Denoise; no UI, geometry,
lens or Opposed color. One observation per condition, inherited ±10%
descriptive allowance. Whole-pipeline differences are noise, not speedups.

| Research action, same Mac | Result | Conditions / evidence |
| --- | --- | --- |
| 18.02 MP Canon: filter disabled → enabled | Whole wait 8.361 → 8.144 s; added filter .190 s; process peak .720 → .811 GB | `output/denoise-v1/hot-pixel/native-IMG_0790.json`; 768px cores, 86px Denoise + 16px AHD halos, no RGB frame cache |
| 42.39 MP Sony: filter disabled → enabled | Whole wait 17.045 → 16.933 s; added filter .471 s; process peak .892 → 1.098 GB | `native-2025_0730_1331_3.json`; identical native protocol |
| Quick / full / supplementary point decisions | 7.831 / 62.489 / 5.844 s; peak process .549 / .753 / .554 GB | `quick.json`, `full.json`, `point-decisions.json`; fresh four-method runs, not app wait |
| Frozen optics / corpus / public splits | Optics 29.450 s; corpus guard 15.040 s; held-out 43.357 s / seen 75.251 s | 3,456 point trials; 18 RAW entries / 15 supported; 19 held-out / 33 seen crops; descriptive harness throughput, not app wait |
| Added-step GPU parity and expanded optics group | Guard 46.490 s / 1.538 GB tree RSS | `gpu-optics-guard.json`; 35 kernel cases pass, common CPU downstream; no native GPU speed claim |
| Required fast checks | Node 12.912 s; Python 266.69 s | 1,091 passed / one skipped; 3,999 passed / 155 skipped / one xpassed; no failures; `node.log`, `python.log` |

Decision and limitations: `research/denoise-v1-2026-11-16/raw-pixel-cleanup.md`,
“Single-photo hot pixel filter (November 17)”. Earlier map-backed timings
below describe a different historical algorithm and are not comparisons.

## November 17: signed RAW shadows (research only)

MacBook Neo / A18 Pro / 8 GB, one CPU/native thread, signed AHD prototype
`e44d75b3`; extra RawNIND decision baseline `0fcca1b1`. Shared machine lock,
unchanged 2.5 GB sampled process-tree guard. Single runs, existing ±10%
descriptive allowance; **no action-to-screen performance claim**. Native
development sums include shared unpack, AHD and normalise/ACEScg subclocks,
not Denoise, highlights, lens, final rendering or all harness overhead.
Current rawpy also orients; signed native strips stay sensor-oriented.

| Research action, same Mac | Time / sampled peak tree RSS | Conditions |
| --- | --- | --- |
| Canon 18.02 MP current / signed development | .840 / 1.088 s; .819 GB combined command | IMG_0790.CR2, ISO3200. Added .248 s. AHD .537 / .651 s; tail .288 / .393 s; signed sensor subtract .029 s. |
| Sony 42.39 MP current / signed development | 1.976 / 2.518 s; 1.332 GB combined command | 2025_0730_1331_3.arw, ISO4000. Added .542 s. AHD 1.299 / 1.539 s; tail .661 / .919 s; signed sensor subtract .044 s. |
| Quick / full quality | 14.04 / 80.34 s; .634 / .754 GB guard peaks | 23 / 35 cases; signed and clipped-control fresh, frozen Off/current/RawNIND scores reused with hashes; no errors. |
| Public held-out / seen quality | 47.60 / 93.84 s; .583 / .579 GB | 19 / 33 crops, four / seven scenes, reported separately; equal-scene weighting. |
| Final decision crops / neutral and exposure safety | 31.03 / 4.14 s guarded commands; 1.092 / .468 GB | Twelve decision rows, seven new columns plus fresh RawNIND baseline. Four neutral levels × eight seeds; 12 CPU-compression ±6 EV cases. |
| Required Node / final ORT-enabled Python checks | 12.04 / 254.20 s | Node 1091 passed, one skipped; Python 4010 passed, 150 skipped, one xpassed. Final Python guard 255.73 s / 2.005 GB; no failures. |

Signed development improves synthetic/neutral bias, not the real Canon speck
problem; native costs are **development-only**, not whole-app changes. No
GPU port, budget change or shipping integration. Full audit, limitations and
receipt links: [signed-shadows.md](research/denoise-v1-2026-11-16/signed-shadows.md).
Initial Python without ORT was 275.88 s (4005 passed / 155 skipped / one
xpassed), not a controlled regression comparison. Optional ORT 1.32.0 was
installed from the local package cache, enabling five additional tests.

## November 17: RAW Pixel cleanup (research only)

MacBook Neo / A18 Pro / 8 GB, one CPU thread, prototype `78f93157`.
Shared machine lock, unchanged 2.5 GB process-tree guard, single runs with
±10% descriptive allowance. No app integration or whole-screen speed claim.
The sparse-map probe is a hypothetical timing grid, not detected real faults;
its values are discarded. Native whole waits include normalisation, global
adaptive-model analysis, AHD and shipping `.75/.5/.75/.5` Denoise, plus the
separately timed empty/sparse-map probes. No full-frame float cache or spool.

| Research action, same Mac | Whole wait / peak process RSS | Pixel cleanup split / conditions |
| --- | --- | --- |
| 18.02 MP native RAW → AHD → Denoise | 7.186 s / .675 GB | Empty map .0054 s; sparse map .0207 s (260 coordinates), accumulated over all reads. IMG_0790.CR2; 768px cores, 86px Denoise + 16px AHD context. |
| 42.39 MP native RAW → AHD → Denoise | 16.026 s / .718 GB | Empty map .0138 s; sparse map .0752 s (651 coordinates). 2025_0730_1331_3.arw; same bounded native sweep. |
| Optional native per-CFA diagnostic scan, 18.02 / 42.39 MP | 2.237 / 4.537 s to sensor-audit result | Scan subclock 1.925 / 4.349 s; not required for map repair. Process peak .326 GB on Sony, then .364 GB after Canon in the same process (cumulative). 256-row strips with conservative border gaps. |
| Quick / full quality | 5.171 / 41.498 s; .546 / .749 GB process RSS | 23 / 35 cases; two fresh adapters plus exact current-pixel control. Unchanged Off/current/RawNIND quality scores reused with hashes. |
| Public held-out / seen quality | 24.396 / 45.732 s; .577 / .578 GB process RSS | 19 / 33 paired cases, kept separate; same fresh/reused policy. |
| Known-defect positive controls / decision crops | 4.524 / 33.938 s guarded command wall | .444 / 1.108 GB tree RSS; seven generated charts / twelve native 288px decision rows. |
| Required fast checks | Node 11.86 s; Python 265.20 s | Node 1091 passed, one skipped. Python 3980 passed, 150 skipped, one xpassed; guard succeeded. |

Map repair is cheap, but no independent calibration is supplied for the real
photos, so all no-map pixels stay exactly Off/current Denoise. No demonstrated
Canon-speck quality gain or new GPU route is claimed. Algorithm, clipping and
CPU/GPU placement qualifications: [raw-pixel-cleanup.md](research/denoise-v1-2026-11-16/raw-pixel-cleanup.md).
Receipts: `codebase/output/denoise-v1/raw-pixel-cleanup/`; decision PNGs are
regenerated in place, 11.69 MB. Original photographs are neither copied nor
modified by these runs.

## November 17: residual speck/chroma cleanup (research only)

MacBook Neo / A18 Pro / 8 GB, one CPU thread, prototype `994152ca` /
`f8f6e22b`, final surrounding-brightness variant. Shared lock, unchanged 2.5 GB
process-tree guard, ±10% descriptive timing allowance. CPU standalone waits
end at resolved linear pixels, not presentation; no controlled speedup or
shipping GPU claim. App Denoise and memory allowances stay unchanged.

| Research action | Whole wait / peak OS RSS | Relevant split | Conditions |
| --- | --- | --- | --- |
| 18.02 MP residual cleanup, cold native | 25.51 s / 1.174 GB | cleanup 14.15 s; bands 4.03 s; default resolve 1.13 s; cached resolve 1.14 s | Mac; IMG_0790.CR2; bounded 768px cores, 86px halo, original RAW read only. AHD/cache disk I/O included. |
| 42.39 MP residual cleanup, cold native | 59.68 s / 1.221 GB | cleanup 34.94 s; bands 9.88 s; default resolve 2.85 s; cached resolve 2.75 s | Mac; 2025_0730_1331_3.arw; bounded 768px cores, 86px halo, original RAW read only. AHD/cache disk I/O included. |
| quick research set | 38.43 s / 1.111 GB tree RSS | Not a product wait | Mac; seven adapters for quality sets, twelve rows/seven method columns for decision; no adapter errors. |
| heldout research set | 91.14 s / 0.993 GB tree RSS | Not a product wait | Mac; seven adapters for quality sets, twelve rows/seven method columns for decision; no adapter errors. |
| full research set | 166.23 s / 1.259 GB tree RSS | Not a product wait | Mac; seven adapters for quality sets, twelve rows/seven method columns for decision; no adapter errors. |
| seen research set | 162.52 s / 1.050 GB tree RSS | Not a product wait | Mac; seven adapters for quality sets, twelve rows/seven method columns for decision; no adapter errors. |
| decision research set | 30.20 s / 1.103 GB tree RSS | Not a product wait | Mac; seven adapters for quality sets, twelve rows/seven method columns for decision; no adapter errors. |
| Cached 512² control resolve | median 13.82 ms; p95 15.02 ms; max 16.04 ms | zero Amount 0.12 ms | Mac; eight live controls × 0/.5/1; no analysis repeated. Full controls command 2.58 s / .630 GB tree RSS. |

Same-kernel shipping estimate from measured cleanup/default subclocks: added
CPU preparation 14–16 s at 18 MP / 35–38 s at 42 MP (roughly 19–22 s at
24 MP), excluding source loading, existing wavelet work and presentation.
Quality does not justify this cost or a GPU port. Report and receipts:
[speck-cleanup.md](research/denoise-v1-2026-11-16/speck-cleanup.md),
`codebase/output/denoise-v1/speck-cleanup/`.

Final fast checks on Mac, `7690bb0e`: Node 11.94 s (1091 passed, one skipped);
Python 246.77 s / 1.935 GB guarded tree RSS (3958 passed, 150 skipped, one
xpassed). Focused 23 checks pass in 2.04 s after the live colour projection
fix; the full Python suite was then rerun. Logs are in the same output folder.

## November 16: pilot-guided empirical Wiener (research only)

MacBook Neo / Apple A18 Pro / 8 GB, one CPU thread, tooling `e35fc744`,
adapters `e8335fd9`, masked public-pair merge `1951c081`; ORT 1.32.0 only
in the worktree venv. Shared machine lock and unchanged 2.5 GB process-tree
RSS guard. Single-run measurements; descriptive ±10% allowance, no regression
comparison. Native whole waits end at resolved ACEScg, **not on screen**.
Temporary full-frame/cache disk I/O is included and scratch is removed.
No Electron, GPU, production cache/budget change or shipping speedup claim.

| Research action | Whole wait / peak RSS | Pilot / bands+gains / resolve | Conditions / evidence |
| --- | --- | --- | --- |
| Canon 18.02 MP, tuned-both | 22.36 s / 0.943 GB | 5.05 / 10.56 / 2.82 s | Mac; IMG_0790.CR2, ISO3200, read-only approved corpus. Decode+AHD 1.97 s, noise fit 1.77 s. |
| Canon 18.02 MP, Bayer-both | 22.27 s / 1.380 GB | 7.44 / 9.22 / 2.32 s | Same Mac/photo, later run after public-pair ranking; not a controlled speed comparison. Decode+AHD 1.62 s, fit 1.46 s. |
| Canon 18.02 MP, Bayer-luma | 29.57 s / 1.380 GB | 9.92 / 11.72 / 3.93 s | Same Mac/photo; corrected full-strength neural pilot, precomputed unity-WB AHD exposure anchor. |
| Sony 42.39 MP, tuned-both | 54.60 s / 1.536 GB | 12.31 / 28.86 / 7.40 s | Mac; 2025_0730_1331_3.arw, ISO4000, read-only corpus. Decode+AHD 3.97 s, noise fit 1.85 s. |
| Sony 42.39 MP, Bayer-both | 57.27 s / 1.871 GB | 18.28 / 26.86 / 6.62 s | Same Mac/photo, later single run; 77 neural tiles. Decode+AHD 3.71 s, fit 1.62 s. |
| Sony 42.39 MP, Bayer-luma | 66.13 s / 1.658 GB | 21.71 / 29.08 / 9.34 s | Same Mac/photo; native sensor orientation, 77 neural tiles. |
| Full quality set, 11 adapters | 299.34 s / 1.609 GB | Not a UI action | Mac; 27 synthetic + eight real cases, full/half scores, zero adapter errors. |
| Public pairs, 11 adapters | 402.03 s / 1.228 GB | Not a UI action | Mac; reused verified CC0 subset, 52 crops / 11 scenes / four cameras. Four held-out and seven seen-by-RawNIND scenes reported separately, full/half valid-mask scores, zero errors. |
| Live controls, cached 512² | 15.38–63.15 ms, median 28.06 ms, p95 37.41 ms; bypass 0.08–0.42 ms | No pilot/decomposition | Mac; six variants × three ISOs × Amount/Color Noise 0/.5/1 on two scenes. Entire sweep 129.47 s / 1.200 GB guarded. |
| Independent grids / detail review | 37.76 / 26.86 s | Not a UI action | Mac; worst sampled peaks 1.151 / 1.234 GB. |
| Final merged fast checks | Python 275.96 s / 2.124 GB; Node 21.27 s | Not product performance | Mac; Python 3944 passed, 151 skipped, 1 xpassed; Node 1091 passed, 1 skipped. No failures. |

Evidence: `codebase/output/denoise-v1/pilot-wiener/` JSON/guard receipts and
`review/index.html`; scope, half-scale fairness, control/quality failures and
explicitly **estimated** GPU traffic costs are in
[pilot-wiener.md](research/denoise-v1-2026-11-16/pilot-wiener.md).
The FP32 native cache used 3.24/7.63 GB of temporary disk, not retained RAM.
No variant satisfies the complete quality contract; shipping Denoise is unchanged.

## November 16: RawNIND Bayer verification (research only)

MacBook Neo / Apple A18 Pro / 8 GB; tooling `6fe14d32`, verified Bayer
sensor-domain/gain correction, ORT 1.32.0 CPUExecutionProvider, one native
thread, shared machine lock and 2.5 GB sampled process-RSS abort guard.
Standalone research-tool durations, **not action-to-screen waits**. No GPU,
timing repeat, native-photo benchmark or speedup claim. The existing ±10%
descriptive timing allowance is unchanged; five-adapter and eight-adapter
quality durations are not comparable performance baselines.

| Research action | Duration / sampled peak process RSS | Conditions / evidence |
| --- | --- | --- |
| Corrected full quality set | 103.0 s / 1.377 GB | 27 synthetic + eight real crops; off/current/Bayer .5/.75/1; zero adapter errors. `output/denoise-v1/rawnind/results-full.json`, quality guard. |
| Pinned reference and bias probe | 54.8 s / 1.406 GB | Nine clean scenes, two unbinned low-ISO crops, canonical/literal demo colour paths and actual TIFF readback, eight real shadow-bias cases, developed exposure −6…+6. `output/denoise-v1/verify/reference.json`, verify guard. |
| Final Python fast suite | 265.3 s / 2.062 GB | 3,917 passed, 147 skipped, one xpassed; system TEMP under the research guard, optional local verified models present. `output/denoise-v1/verify/python-tests.log`. |
| Final Node fast suite | 15.3 s | 1,091 passed, one skipped, zero failures. `output/denoise-v1/verify/node-tests.log`. |

Earlier Bayer native timings below are retained history, **not timings of the
corrected adapter**: it now needs an extra AHD pass to anchor exposure in
camera RGB and uses upstream [0,1] sensor clipping. A new native speed/memory
qualification has not been run. The unchanged linear rows remain historical
measurements of that variant. Full quality, provenance and limits are in
[Verification, November 16](research/denoise-v1-2026-11-16/rawnind-prototype.md#verification-november-16).

## November 16: public noisy/clean RAW pairs (research only)

MacBook Neo / Apple A18 Pro / 8 GB; base `045f5442`, pair tooling `20f2224a`,
one native CPU thread, serial shared machine lock, no Electron/GPU. One
descriptive run per action; ±10% timing noise allowance, no accepted budget
changed. These end at research arrays/results, **not** a picture on screen.

| Action | Measured time | Peak RSS | Conditions / evidence |
| --- | ---: | ---: | --- |
| Verify/register/brightness-match public RAW pairs | 39.44 s (40.18 s guarded wall) | 0.367 GB | 43 verified RAWs, 31 candidate pairs; 52 retained 512px crops / 11 scenes / four cameras. Rejections are preserved, not retried with looser screens. |
| Off/default/tuned-PSNR/tuned-sharp pair baselines | 119.11 s (120.05 s guarded wall) | 0.588 GB | 208 crop-method evaluations; masked SDR/HDR metrics, small review, zero adapter errors; ISO 1600/3200/6400 only. |
| Darktable-profiled pair interface smoke | 0.036 s adapter / 1.29 s guarded wall | 0.117 GB | Exactly one 96px crop, finite output, no fallback; no quality score. RawNIND model and GALOSH binary absent, skipped. |
| Python fast suite with pair tooling | 280.73 s (282.99 s guarded wall) | 2.062 GB | 3928 passed / 149 skipped / one xpassed; no failures, no guard abort. |

Peak is the larger available OS/process-tree measurement; watchdog threshold
2.3 GB leaves room below the 2.5 GB research cap. The downloaded RAWs total
1.170 GB; download plus prepared bundles 1.540 GB; review/contact sheet
9.975 MB. Evidence: `codebase/output/denoise-v1/datasets/prepare-guard.json`,
`public-pairs/{results-pairs,summary,baseline-guard,interface,interface-guard}.json`,
and `public-pairs-pytest-guard.json` under the same `denoise-v1` folder.
See [public-pairs.md](research/denoise-v1-2026-11-16/public-pairs.md) for licence,
held-out contamination, exclusions, quality tables and limits. No shipping
performance/quality pass or full-frame cost extrapolation is claimed.

## November 16: RawNIND full-frame CPU prototype (research only)

MacBook Neo / Apple A18 Pro / 8 GB; ONNX Runtime 1.32.0 CPUExecutionProvider,
tooling `7bce787f`, one thread, fixed 512 input tiles, mirror edges, frame-global gain, native
WB/camera colour tail. One run per row, under the shared machine lock, 2.5 GB
process-RSS abort guard; no Electron/GPU or app integration. These waits end at
a prepared ACEScg array, not a picture on screen. Source/result arrays are
temporary disk-backed files. No timing regression or accelerator-gain claim;
the harness's proposed ±10% descriptive allowance is unchanged.

| Measured native action | Decode/prep / session / inference / stitch-colour s | Total wait / peak process RSS | Conditions / evidence |
| --- | --- | --- | --- |
| 18.02 MP Canon / RawNIND linear | 1.033 / 0.060 / 27.596 / 1.297 | 30.010 s / 1.371 GB | IMG_0790.CR2, ISO 3200, 140 retained-core tiles; app-native AHD normalisation. |
| 18.02 MP Canon / RawNIND Bayer | 0.366 / 0.068 / 6.986 / 0.432 | 7.858 s / 1.064 GB | Same sensor, 35 tiles, phase-correct RGGB packing; explicit unclipped experimental extrapolation. |
| 42.39 MP Sony / RawNIND linear | 2.133 / 0.155 / 59.628 / 2.863 | 64.842 s / 2.243 GB | 2025_0730_1331_3.arw, ISO 4000, 294 retained-core tiles, app-native AHD normalisation and portrait orientation. |
| 42.39 MP Sony / RawNIND Bayer | 0.235 / 0.047 / 15.828 / 0.975 | 17.101 s / 1.519 GB | Same sensor, 77 tiles; explicit unclipped experimental extrapolation outside [0,1], not default fallback or qualified quality. |

Native pixel-proportional 24 MP totals are **estimates**, 36.71–39.97 s linear /
9.68–10.47 s Bayer, not measured actions or preparation-budget passes. Whole-app
peak/settled memory, display, GPU/ANE, export reuse and 61 MP are unmeasured.
Quality rejects both variants and all measured strengths; no shipping change.
Evidence: `codebase/output/denoise-v1/rawnind/full-*.json`, guard receipts,
`results-full.json`, `probes.json` and `review/index.html`; contracts and
coverage limits are in [the prototype report](research/denoise-v1-2026-11-16/rawnind-prototype.md).

## November 16: classical Denoise CPU prototypes (minimum Mac, research only)

MacBook Neo / A18 Pro / 8 GB; one native CPU thread, shared cross-worktree
run lock, no Electron/GPU. Measurement base `01992e9c`, prototype code
`f032d924` (later build-only clock/Windows conventions do not alter filtering). Descriptive one-run
timings with ±10% noise allowance; no accepted speed budget changed.
These include all-corpus calibration and crop writing, not screen presentation
or a packaged/whole-app memory measurement. The stages exclude that overhead.

| Action | Prep / filter / develop | Research wall | Peak RSS | Conditions / evidence |
| --- | --- | --- | --- | --- |
| NumPy profiled wavelets, IMG_0790.CR2, 18.02 MP | 2.28 / 132.46 / 2.01 s | 143.47 s | 1.787 GB | Native sensor, ISO 3200; 1024px core +254 halo, bounded mapped scratch. |
| NumPy profiled wavelets, 2025_0730_1331_3.arw, 42.39 MP | 2.18 / 314.93 / 4.91 s | 328.85 s | 1.638 GB | Native sensor, ISO 4000; same reference. |
| Serial FP32 C GALOSH calibrated, IMG_0790.CR2, 18.02 MP | .49 / 30.52 / 1.68 s | 39.42 s | .995 GB | Native sensor, ISO 3200; 768px core +160 halo, global fit/anchor. |
| Serial FP32 C GALOSH calibrated, 2025_0730_1331_3.arw, 42.39 MP | .51 / 65.21 / 3.95 s | 76.16 s | 1.244 GB | Native sensor, ISO 4000; same reference. |
| Current Denoise tuning | — | 119.91 s | 1.070 GB | 81 settings ×27 full-set synthetic scenes, in-sample PSNR and MTF-constrained choices. |
| Full thirteen-variant quality comparison | — | 665.97 s | 1.150 GB | 27 synthetic +8 real crops, all §3.2 harness metrics; zero adapter errors, 17.31 MB review including native crops. |

Peak is the greater of OS parent high-water and 0.2s sampled process-tree RSS;
all runs stay below the 2.5 GB research cap. Full quality-run totals and
conditional native-C cost estimates are in
[classical-prototypes.md](research/denoise-v1-2026-11-16/classical-prototypes.md).
Evidence: `codebase/output/denoise-v1/full-*.json`, matching guard receipts,
`classical-tuning.json` and `review/index.html`. No C wavelet or WGSL speed
estimate is a measured pass; no current-app speed-up is claimed.

## November 16: Denoise candidate CPU load smoke (research only)

MacBook Neo / A18 Pro / 8 GB, ORT 1.32.0 CPUExecutionProvider, one thread,
batch one, CPU arena/memory pattern disabled; one synthetic 512-square tensor
per model, sequential cold invocation. Other-worker CPU activity possible.
These are descriptive load checks, not production action-to-picture waits or
an accepted speed comparison; no performance tolerance is changed.

| Candidate / action | Measured time | Conditions / evidence |
| --- | ---: | --- |
| RawNIND linear: session / one 512×512 RGB tile | 0.033 / 0.358 s | 576 MB OS peak RSS, finite output; same ONNX hash as November 13 B1. |
| RawNIND Bayer: session / one 512×512 packed tile → 1024×1024 RGB | 0.026 / 0.328 s | 606 MB OS peak RSS, finite output; no RAW decode, demosaic/color tail or presentation included. |

Evidence: `codebase/output/denoise-v1/candidates/{cpu-smoke.json,smoke_cpu.py}`.
Source, model hashes, licence checks, uncertain 24/61 MP extrapolations and
adapter instructions: [candidate survey](research/denoise-v1-2026-11-16/candidates.md).
No GPU/Electron run. Commit containing this note; no shipping code changed.

## November 16: offline Denoise quality harness (minimum Mac)

MacBook Neo / A18 Pro / 8 GB; CPU only, one native thread, no Electron/GPU.
Harness `da0d5ace`; app reference `0ba5593f` (exact app base is recorded in
`docs/technical/research/denoise-v1-2026-11-16/harness-baseline.md`). Timings
cover corpus ISO inventory and calibration, crop development, both off/current
Denoise adapters, every metric/probe and review writing. Proposed timing noise
band ±10%; these shared-machine full runs vary beyond it (38.6–48.5 s), so this
is a descriptive range, not an app speed or regression claim. No budget changed.

| Action | Observed wait | Conditions / retained evidence |
| --- | --- | --- |
| Quick quality set | 11.4–13.9 s; latest 13.9 s, peak process RSS 0.82 GB | 21 generated cases + two real 512 px crops; <120 s budget. `codebase/output/denoise-v1/results-quick.json`. |
| Full quality set | 38.6–48.5 s; latest 38.6 s, peak process RSS 1.14 GB | 27 synthetic cases (including two binned low-ISO photos) + eight real 640 px crops. Latest review 15.2 MB; `results-full.json` and `review/index.html` beside the quick JSON. Both sets below the 2.5 GB process limit. |

Quality conclusions and provisional sensor-fit limits are in the harness baseline.
No GPU, production export/Proof or whole-photo preparation speed was measured.

## November 16: DSC01287 saved-grade lag investigation (minimum Mac)

MacBook Neo / A18 Pro / 8 GB, actual 1408×794 / DPR 2, default 4 GB,
shared GPU lock, disposable unpackaged Electron profile. Reusable copy of
Steve’s DSC01287.ARW and unchanged Nov 16 sidecar (Ektar 100%, grain 19.46,
size 19.60, halation 3.57/.451, automatic Tamron lens correction, RAW highlight
reconstruction; no locals/Denoise). Baseline `5d1e9c01`. Timing noise band
±10%; any optimisation must retain exact final pixels. No speed target changed.

| Action | Baseline wait | Conditions / evidence |
| --- | --- | --- |
| Open to first GPU-completed picture / final anchor settlement | 8.04 / 9.82 s | Lens remap 2.21 s, coordinate build .293 s, RAW development 2.04 s in initial diagnostic; Steve’s original first-frame event was 7.07 s. Different clocks: presentation events precede GPU completion. |
| Native Fit Exposure drag | First feedback .090–.128 s; final visible frame .282–1.076 s after release | Three drags, 20 moves each; exact grain restored after release. |
| Native Fit Whites drag | First feedback .114–.149 s; final visible frame .303–1.939 s after release | Three drags, same input method; automatic Peak Fit measurement can redraw the settled picture. |
| Zoom in to 50–100% | First refined tiles .746–2.612 s; final .746–3.482 s | Four zooms including cached return. Held lower-resolution picture changes scale first. |
| Pan at 50–100% | New tile completion .184–2.603 s, or held tiles reused without rendering | Compositor moves the held picture first. Initial no-wait diagnostic undercounted pan refinement; excluded. |
| Return to Fit | .315–.338 s GPU-completed frame | Two observations. |
| Switch HDR/SDR at Fit | .277–.330 s GPU-completed frame | Six switches; first SDR additionally waits for source/anchor preparation (final observation 1.26 s). |
| Grain ablation at fixed 1024 processing edge | Full grade .405–.571 s → grain off .054–.084 s | Three warmed exposure changes; disabled-grain picture is diagnostic only, never shipped. Both early labels 1600/2400 normalized to 1024; they are not 1600/2400 measurements. |
| Halation / neutral Detail ablation at that same edge | .397–.470 / .399–.526 s | Little gain versus full grade. Stock off also bypasses Film/grain; not an isolated stock-maths cost. |
| Renderer CPU profile, exposure then zoom | 1.325 / .562 s total actions | CPU samples chiefly idle (1.538 s), program .330 s, scope payload .060 s; no full RAW development/lens remap per interactive frame. Separate profiled run, not subtracted from unprofiled baselines. |

Evidence under `codebase/output/performance/stacked-raw/`: `before-fenced.json`,
`ablate.json`, `profile.json` and corresponding backend logs. Completed-frame
clock is GPU fence plus animation frame, retaining only still-current serials;
it bounds device completion/presentation opportunity, not physical scanout.
Initial `before.json` retains submission-only evidence and the pan-timing flaw,
not a second screen baseline. The startup CPU scope runs for ~37 s behind
already visible GPU previews and is a candidate for cancellation/deferment.

## November 16: bounded native high-fidelity JPEG XL (minimum Mac)

MacBook Neo / A18 Pro / 8 GiB, 1408×794, one run at a time under the shared
GPU lock. Final native Electron runs use Steve's 4 GB minimum/default; 1000-nit
Fixed cap, native dimensions, neutral creative grade, no resize/sharpen/frame/
metadata. Times include production render, encode, exact quantized-source
verification, validation and the diagnostic finished-input capture. Import /
manual interpretation and separate perceptual analysis are excluded from export
waits. These are descriptive timings (paired noise tolerance ±10%), not an
across-machine speed claim. GPU-request means the existing renderer chooses
GPU or its bounded CPU fallback; it is not a forced/waived GPU pass.

| Native input | Whole-app peak | CPU HDR / SDR export | GPU-request HDR / SDR | Full Proof | Result |
| --- | ---: | --- | --- | --- | --- |
| PQ AVIF · 4000×2666 · 10.7 MP | 2.813 GB | 8.15 / 8.05 s | **GPU** 6.99 / 3.88 s | CPU 16.35 s / GPU 5.97 s; exact file bytes | Pass; minimum available RAM 4.724 GB |
| `_DSC6328.jpg` · 3833×7778 · 29.8 MP | 2.782 GB | 19.08 / 13.58 s | Bounded **CPU** 18.78 / 12.72 s | CPU 24.54 s; both exports match its bytes | Pass; minimum available RAM 3.608 GB |
| LR AVIF · 5304×7952 · 42.2 MP | 3.591 GB | 26.57 / 19.87 s | Later request safely refused | CPU 35.15 s; exact file bytes | **Scoped:** HDR, SDR and Proof succeed, but system availability reaches 1.212 GB; sustained-session reserve check fails |
| Panorama · 16000×12000 · 192 MP | No native run | — | — | — | Native source preflight refuses; no successful ordinary/native export claimed |

Evidence: `codebase/output/review/jpegxl-high-fidelity/app-native-4000000000-*.json`.
The 42.2 MP peaks by stage are HDR 2.544 GB, full Proof 3.144 GB, SDR 3.570 GB;
import owns the 3.591 GB maximum. A 6 GB cap does not create system headroom.
The separate header-only 6 GB refusal and cache/swap conditions are in the
memory/default section below. No tested photo is shown to require only 6 GB.

The standalone CPU helper uses the loader's decoded source; Electron resolves
the explicit interpretation gate via Rec.2020/PQ for AVIF or sRGB for JPEG.
For the LR AVIF those routes produce different HDR sources: helper lossless
HDR is 110.17 MB, Electron HDR 72.01 MB. **Size ratios below use the same helper
source/render for each pair; they never mix the two interpretations.** This is
not an assertion of source interpretation agreement. SDR LR is 64.30 MB in both.

| Same-source native CPU input / lane | Lossless effort-3 size | Ordinary Q95 size | Ratio | Own-source mean / P99.9 |
| --- | ---: | ---: | ---: | --- |
| 10.7 MP · HDR | 18,779,678 B | 4,704,145 B | 3.99× | HDR ΔE ITP 0.0841 / 0.1837 |
| 10.7 MP · SDR | 9,544,640 B | 4,690,221 B | 2.04× | SDR ΔE00 0.2095 / 0.7751 |
| 29.8 MP · HDR | 57,406,105 B | 12,248,349 B | 4.69× | 0.0778 / 0.1793 |
| 29.8 MP · SDR | 38,822,620 B | 14,078,481 B | 2.76× | 0.000004 / 0.000018 |
| 42.2 MP · HDR | 110,173,101 B | 25,095,468 B | 4.39× | 0.0916 / 0.2141 |
| 42.2 MP · SDR | 64,296,622 B | 28,325,669 B | 2.27× | 0.2051 / 0.7273 |

All six high-fidelity helper cases pass the unchanged mean <1 / P99.9 ≤3,
exact finished ceiling and encoded +1% allowance. Ordinary codec fidelity is
report-only, not a new gate. At 10.7 MP, effort 3 costs **11.0% HDR / 7.8% SDR**
versus the old effort-7 lossless files; quantized samples are unchanged.
Standalone high-fidelity waits are HDR/SDR 5.27/6.77 s, 16.38/12.61 s,
23.76/21.36 s for these three sizes. Native encode alone is 1.40/1.19 s,
4.34/3.51 s and 6.30/6.54 s; validation/render/capture account for the rest.
The ordinary 42.2 MP Q95 helper takes HDR 62.40 s / SDR 19.47 s after bounded
preparation and ceiling decoding; its own-source analysis is not timed in those
waits. Compressed payloads remain byte buffers in the existing API.

Where RAM went: whole-frame CPU intermediates dominated generated SDR. The
existing exact CPU strip renderer removes them for eligible native grades;
spatial/unsupported graphs keep conservative admission. Chunked libjxl input
removes the full quantized frame for integer lossless, and 128-row preparation
bounds conversion scratch for ordinary JXL too. Scanline sample/ceiling checks
avoid full decoded float images; Proof converts its unique CPU SDR output in
place. 10.7 MP high-fidelity worker render/encode peaks fall from HDR 1.913 /
SDR 4.435 GB to 0.432 / 0.382 GB. At 42.2 MP, ordinary Q95 HDR worker peak
falls from the interrupted 4.949 GB run to 2.344 GB; final SDR worker peak,
including high-fidelity and Q95, is 2.040 GB. Worker peaks exclude Electron.

Evidence in the same folder: `native-bounded.json` (includes the interrupted
pre-fix ordinary comparison), `native-sdr-bounded-final.json`, and
`native-q95-hdr-42.json`. Eight focused export/Proof drivers pass in the bounded
JXL follow-up, followed by the native 4 GB checks above; the final 4 GB Library
and Settings checks pass below. The file-picker locator still exists: baseline
passes alone, and waiting for initial browse completion closes a typed-path
initialization race; patched driver passes all four outputs. This is not a
concurrent-GPU experiment. Broader unrun matrices are listed in Export/Proof.
Windows/packaged, 60 MP, native spatial graphs and sustained 42.2 MP acceptance
remain open. No tolerance, encoded allowance or physical reserve changed.

## November 16: approved 4 GB minimum/default (MacBook Neo)

Steve's November 16 decision makes 4 GB the minimum/default on macOS, Windows
and Linux, explicitly including 8 GB machines. The adjustable maximum and
physical reserve stay unchanged. MacBook Neo / A18 Pro / 8 GiB, 1408×794,
plain Electron, shared GPU lock; frozen v1 fixture and default 90-second viewport
check. Revision `95a2a8f5`; this is not a whole-folder survey or a speed claim.

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Default Library viewport | Pass: 9/9 requested pictured, first at 0.8 s | `codebase/output/quick-library-check/memory-4gb-minimum/report.json`; 24 unvisited photos excluded from scope |
| Whole-app memory | 3.220 GB peak; 0.799 GB settled | No app violation; minimum system availability 4.209 GB, no reserve breach; independent 250 ms census |
| Responsiveness | Longest redraw gap 50 ms; main-thread delay 76 ms | Zero redraw gaps >100 ms; existing 250 ms limit unchanged |
| Settings | Lower saved preference clamps to 4 GB; API rejects below 4 GB; Use default and 4.0 GB minimum/default display pass | Locked `tests/theme-settings.js`, all three themes |
| 6 GB setting, headroom analysis only | Leaves 2.59 GB of this Mac's 8.59 GB for macOS/other apps, versus 4.59 GB at 4 GB; variable cache shares become 2.279× the 4 GB sizes | No 6 GB workload/swap experiment. End-of-session pressure normal (1); existing swap about 1.54 GiB. `codebase/output/review/jpegxl-high-fidelity/memory-setting-headroom.json` |
| 192 MP at a 6 GB setting | Header-only refusal: import work 4.950 GB, safely available 3.780 GB after unchanged 2 GiB native reserve | `panorama-6gb-preflight.json` in the same evidence folder. No native pixels allocated, no successful export claimed |

The larger minimum restores existing 4 GB retained-cache shares; derived RAW
lanes on this Mac rise 1→2 and retained GPU pictures 2→10. Foreground priority,
12-RAW-file count, scheduler concurrency policy and GPU budget are unchanged.
Full cache numbers and platform defaults (16/32/64 GB: 4 GB) are in the memory
module. Fast Node 1,091 pass / one skip; desktop preferences 4 pass; memory/RAW/
reduced group 75 pass. Final full Python: 3,893 pass / 144 skip / one xpass; two old-minimum
expectations were updated as intended. Subsequent refusal-message/guard
follow-up: 169 affected tests pass / 16 skip.

## November 16: safe-link Film slider baseline on MacBook Neo

| Action | Existing guard | Observation | Conditions / evidence |
| --- | --- | --- | --- |
| Independent SDR Exposure with Film on, control input to exact current SDR picture | Exploratory ±10% timing noise; no new budget | Median 104.9→82.7 ms; samples 86.5–138.9→58.4–129.8. Wide overlap; no stable general speedup established. | Neo A18 Pro / 8 GB, actual viewport 1408×794 / DPR 2, same generated 24.064 MP repeated HDR scene, warmed Fit processing 1290px, Portra 400 50%, grain/halation off, four normal input/change actions plus two animation frames. Before restores only the former eager WGSL pre-Film branch; after selects only the active branch. Shared GPU lock, no concurrent own CPU suite. Revision `7a3f28c1` plus the measured branch/UI work; `codebase/output/performance/safe-link/controlled-{before,after}.json`. |
| Linked HDR Exposure change to exact current SDR picture, Film on | Same ±10% noise; link stays active | Median 66.6→65.3 ms; samples 63.7–81.8→64.3–85.7. Normal timing noise; linked speed essentially unchanged. | Same Neo/source/window/Film/Fit and controlled before/after; HDR Exposure handler while viewing SDR. Full action-to-current-picture clock, no per-stage subtraction. This does not reproduce Steve's original slow real photo or native 100% editing. |
| Earlier Print Exposure diagnostic | Required Mac window | Excluded from comparison: old sweep forced viewport 2560×796 despite the 1408×794 launch setting. HDR 139–548 / SDR 680–2560 ms are diagnostic-only. | Same Neo, existing 24 MP TIFF, frozen independent baseline `80cf7ccc`; `before.json`. Replaced by the machine-sized controlled comparison above; no gain claim from this run. |
| Fast qualification, complete suites | Existing expectations; no speed target | Node 1,091 pass / one skip, 14.66 s; Python 3,875 pass / 144 skips / one xpass, 235.24 s | Neo / 8 GB, shared checkout while JPEG XL worker continued separately; no own GPU overlap. Final numerical/history changes covered; `output/safe-link-node-last.log`, `output/safe-link-python-last.log`. Suite runtime, not product latency. |
| Default Library viewport quick check | 90s, unchanged memory/reserve/coverage guards | 9/9 requested pictured, no errors; tree peak 3.03 GB; harness 93.62 s | Neo / 1408×794 / shared GPU lock, frozen v1, fresh plain Electron; `output/quick-library-check/safe-linked-sdr/report.json`. Viewport-only check; no full-library speed claim. |

## November 16: equal-input Film research on MacBook Neo

| Action | Existing guard | Observation | Conditions / evidence |
| --- | --- | --- | --- |
| Option-B Film-on slider, input to current picture on screen | Must measure the whole wait on this Mac; no new speed budget set | **Not measured before/after.** Implementation stopped at tail acceptance; no linked renderer or speed improvement is shipped. The paired CPU timings below are not whole-slider latency. | November 16, linked-SDR tail checkpoint (`60239f7a`); no app/GPU performance run or new optimisation. Tail results: `reports/film-look-equal-input-trial-2026-11-16.md`, section 9. |
| Paired CPU HDR + SDR renders, existing separate Film vs shared scene Film | Exploratory ±10% timing noise; not a shipping speed budget | Film on: median 259.2–458.1 ms before, 167.8–254.6 ms shared; paired reduction 34.6–44.4%. Film off 68.0→52.0 ms. Some three-sample spreads exceed ±10%; not a stable per-stock ranking or whole-wait claim. | Neo A18 Pro / 8 GB, threads=2, DSC00264 498×333 proxy, 3 warmed alternating-order samples, frozen backend `ab0645be`; grain/halation off. `output/review/film-equal-input-trial-2026-11-16/cpu-pair-timing.json`. Source decode, Match fit, UI and encode excluded. |
| CPU SDR alone and shared output tail | Same exploratory conditions; no new GPU route justified | Film-on standalone medians 115.6–152.4 ms old, 122.3–168.8 ms trial; already-shared output tail 20.8–29.9 ms. Different sweeps have different thermal/noise conditions; do not subtract these from the separate paired run. | Same Neo/proxy/backend/threads, 3 warmed samples. `cpu-timing.json` and the full per-stock table in `reports/film-look-equal-input-trial-2026-11-16.md`. No native-size extrapolation. |
| GPU equal-input prototype | One locked GPU attempt, then CPU fallback | No timing/parity: research WGSL compilation failed (`common` reserved). Variable corrected, syntax checked, not rerun. No driver-fault or GPU speed claim. | Neo / 1408×794; own Electron through shared lock, Steve's app left open. `output/review/film-equal-input-trial-2026-11-16/gpu.log`. |

## November 16: exact-ceiling scoped validation on MacBook Neo

| Action | Existing guard | Observation | Conditions / evidence |
| --- | --- | --- | --- |
| 1600px real-photo HDR export request to completed response | Exact decoded ceiling; no new timing gate | GPU 5.785–7.708 s; CPU 5.256–9.445 s across Ultra HDR/AVIF/JXL; all export/reduced/full Proof targets pass. No before/after speed claim. | Neo A18 Pro / 8 GB / 1408×794, shared lock, default bounded DSC00264 fixture, sharpening off; `0a524303` during shared-checkout work. `output/ceiling-followup/delivery.json`. Encoder correction/validation included, source setup and Proof time excluded from these export waits. |
| Library viewport quick check | Default 90 s, existing memory/reserve/drawing guards | First picture .5 s; run 93.115 s including harness; nine of 33 eligible pictured, no errors; independent peak 2.973 GB. Viewport only. | Same Neo/window/lock, frozen v1, fresh plain Electron; no concurrent own fast suite. `output/quick-library-check/exact-highlight-ceiling/report.json`, shared-checkout HEAD `cdb30ac5`. |
| Full Python fast validation | Existing test expectations; no new timing gate | 266.19 s; 3,800 pass, two obsolete 1% allowance pins fail; final focused 287 pass after tightening pins to exact 1000 nits | Same Neo, no overlapping own Electron run; `850f2e45` plus concurrent UI edits. Not a product speed measurement. `output/review/n4-local-match/exact-python-fast.log`; final focused 9.88 s. |

## November 16: picker, help and select UI smoke (MacBook Neo)

| Action | Existing guard | Observation | Conditions / evidence |
| --- | --- | --- | --- |
| Library viewport quick check | Default 90 s; unchanged whole-machine 2 GB reserve | All 9 requested pictures drawn, first 0.5 s, no photo errors or drawing-gap failure; **failed system reserve** (available 1.48 GB at external tree peak 3.10 GB). | Neo A18 Pro / 8 GB / 1408×794, plain Electron through the shared GPU lock, frozen v1, Steve's app kept open; `850f2e45`. Diagnostic smoke only, no speed comparison or limit change. `codebase/output/quick-library-check/picker-help-selects/report.json`. No repeat to chase this unrelated memory guard. |

## November 16: menu/shortcut validation on MacBook Neo

| Action | Existing guard | Observation | Conditions / evidence |
| --- | --- | --- | --- |
| Library viewport quick check | Default 90 s, 250 ms drawing-gap ceiling, existing app memory ceiling/reserve | All 9 expected pictures; first 0.5 s; no coverage or memory errors; peak 2.976 GB; run 93.183 s. **Failed drawing-gap guard:** one 367 ms frame gap; longest main-thread block 140 ms. Needs Steve's responsiveness check before a repeat; no relaxed guard. | Neo A18 Pro / 8 GB / 1408×794, fresh plain Electron, frozen v1, shared GPU lock; `11d8675f` during concurrent shared-checkout work. `output/quick-library-check/menu-shortcuts/report.json`. Not a speed comparison. |

## November 16: N3a validation on MacBook Neo

| Action | Existing guard | Observation | Conditions / evidence |
| --- | --- | --- | --- |
| Library viewport, first picture / coverage | Default 90 s, system reserve and existing app memory ceiling | Isolated pass: first .3 s; all 9 requested pictures; no errors. Initial concurrent fast/research CPU run hit reserve and pictured 7/9; repeated once after that load ended. | Neo A18 Pro / 8 GB / 1408×794; plain Electron under shared GPU lock; frozen v1 unchanged. `output/quick-library-check/n3a-isolated/report.json`; viewport check only, not whole-folder survey. |
| CPU Match materialization, decoded research RAWs | Existing body/colour, exposure-room and editable-recipe gates; no new timing gate | Accepted-case ranges: pre-N3a .688–3.262 s, final .656–3.057 s; discarded tail-search prototype 1.626–14.028 s. No speed claim. | Same Neo, identical <=512-edge arrays of five requested RAWs, four Film cases, variable CPU validation load; decode/UI wait excluded so not whole-wait speed qualification. `output/review/n3a-match-2026-11-16/{5bc997f3,final,n3a}/raw_states.json`. The prototype is not installed. |

## November 15–16: N1 validation on MacBook Neo

| Action | Existing guard | Observation | Conditions / evidence |
| --- | --- | --- | --- |
| Library viewport quick check, first picture / run | Default 90 s, existing 4 GB setting and system reserve; viewport coverage | Isolated pass: first 0.4 s, 9/9 requested pictures, external tree peak 3.053 GB, 92.513 s including launch. Initial concurrent-CPU run first 0.5 s / 9/9 but system-reserve failure. | Neo A18 Pro / 8 GB / 1408x794, fresh plain Electron, frozen v1, venv shared GPU lock; `9c2232d3` + N1 follow-up. Not a speed comparison or whole-folder survey. `output/quick-library-check/n1-isolated/report.json` and `n1-final/report.json`. |
| CPU Match materialization, reduced research RAWs | Existing Match colour/luma/editability gates; no new timing gate | Accepted-case range before 1.249–5.980 s, after 1.019–6.043 s; refusals excluded from this range | Same Neo; five retained <=512px source arrays, Film off / Portra 400 50%, 2875c6a5 before vs N1 follow-up after. Research CPU work, source already decoded, under varying validation load; not UI whole-wait timing or a speedup claim. `output/review/n1-highlight-compression/raw-{before,after}/raw_states.json`; raw logs include refusals. |
| Four-mode delivery correctness driver | Existing perceptual/ceiling/Proof gates; no new time limit | Final invocations 5.671–6.284 s including launch, one at a time | Same Neo/window/lock, 192px synthetic hue input →128px with standard sharpening; Fixed cap / Peak Fit / Soft Ceiling / Clip, GPU and CPU export/Proof. Driver runtime, not user export latency. `output/review/n1-highlight-compression/gpu-finishing-final.json`. |

## November 15: H1 HSL investigation diagnostic (MacBook Neo)

| Action | Existing rule | Observed before H1 fixes | Conditions / evidence |
| --- | --- | --- | --- |
| Global HSL Show selection, request to decoded/drawn overlay | Existing warm <1 s goal; no tolerance changed | HDR Fit 0.380–1.659 s, 100% 0.048–0.128 s; SDR Fit 1.090–1.289 s, 100% 0.781–1.223 s. SDR does not consistently meet the existing warm goal. | November 15, Neo A18 Pro / 8 GB / 1408×794 / DPR 2, exclusive shared GPU lock, fresh Electron profile, shared DSC00264.ARW, plain grade; `40c939b2` checkout with concurrent W2 work. Five toggles per lane/zoom, including initial preparation and final Feather edit. Correctness diagnostic, not a paired performance comparison or a new speed qualification. `codebase/output/performance/hsl-h1/before.json`; picker/control scoping passed all four combinations. H1 changes request ordering/cancellation only; no speedup claim. |

## November 15: W2 ready Grade thumbnail return (MacBook Neo)

| Action | Target | Before → after / latest | Conditions / evidence |
| --- | --- | --- | --- |
| Return as soon as current edited 640px thumbnail is ready, action to shown picture | Existing 500ms clean-handoff goal; do not wait for other lane/screens | Committed-frontend diagnostic before 153–295 ms; after 161–404 ms (no isolated speedup). Native after 101–137 ms, current-revision confirmation 102–103 ms, final format-first 100–224 ms | Neo A18 Pro / 8 GB / 1408×794, shared lock, reusable DSC04375/DSC00264 copies, existing 4 GB setting, tiled Grade Fit, both photos. Native `desktop/library-grade-picture-check.cjs` checks changed Grid/filmstrip/stored-screen pixels; last mode explicitly flushes/saves and matches the new revision before immediate return. Committed `97078dba` frontend comparison served without altering checkout, through more intrusive Electron/Playwright instrumentation. Do not compare its absolute whole waits with plain native results. `codebase/output/quick-library-check/w2-p2-{final,current,format-first}/report.json`, `output/w2-p2-{before-ready,after-ready}/result.json`. |
| Saved-grade availability to edited picture, including capture and publication | ≤500 ms, unchanged; **not consistently qualified** | Intrusive before 6.12–8.06 s / after 1.41–4.70 s, noise-dominated. Native initial after 396–444 ms; explicit current save before format-first 542/603 ms; final 403/696 ms. Final capture 93/124 ms, store 219/324 ms | Same native conditions. Concurrent agents; native initial load 3.76–5.81, explicit-current 3.26–4.52, final 2.33–4.36. No further rerun to chase the spread. Generic quick drawing-gap qualification is invalid because this special diagnostic returns no animation probe; it does not show the app hid. One initial after run fails the unchanged physical reserve gate (peak 3.76 GB); later current/final memory gates pass at 3.45/3.72 GB. No memory waiver or relaxed timing. Commit containing this note. |

## November 15: W2 Library Denoise redraw (MacBook Neo)

| Action | Rule | Before → after | Conditions / evidence |
| --- | --- | --- | --- |
| Warm unchanged 640px Library Denoise draw, whole request to completed GPU draw | Exact setup identity and identical repeat pixels; existing 5% timing noise rule, no speed gate | Before setup replacement 28.8 / 37.2 ms; reuse 12.4 / 50.2 ms. Control-only draw 69.3 / 71.5 ms | Neo A18 Pro / 8 GB / 1408×794, shared GPU lock, published generated noisy 1500×1000 TIFF, same-process warm comparison by toggling the production reuse flag. Both runs prove same selector/scratch, exact unchanged pixels and changed control output; final also resets through another finishing transport key, retaining scratch but retiring resolved pixels. Concurrent agents; final fast Python suite overlaps the short draw. Timing spread is noise-dominated and not a felt-speedup claim. `codebase/output/w2-denoise/library-redraw.json`, `w2-p4-{library-final,exact-source}.log`. Existing Grade parity readback fails; tile-cache stalls at 2° geometry and is stopped after about nine minutes (`w2-p4-tile-state.json`). All limits unchanged. Commit containing this note. |

## November 15: W2 Grade opening priority (MacBook Neo)

| Action | Existing target | Before → after | Conditions / evidence |
| --- | --- | --- | --- |
| Same full RAW to first Grade picture, idle / while real paste prepares another RAW | Paste contention ≤max(250 ms, 10% of idle); full wait measured, no segment excluded | Before 8.170 / 7.932 s; initial busier after 8.810 / 8.971 s (+161 ms); final subscribed-window after 8.433 / 7.323 s (no added wait). Pass | Neo A18 Pro / 8 GB / 1408×794, shared lock, fresh Electron/backend per pair, existing 4 GB test setting and unchanged gates. DSC04375.ARW 7952×5304 redeveloped on every import; real IMG_0790.CR2 paste starts 150 ms before Grade. OS cache not flushed; later GPU pipelines warm. Before load 3.95–4.67; busier after 2.89–4.07 with fast Python/concurrent agents; final 3.30–4.14. Not a RAW speedup comparison. Final channel observation starts pause 22–24 ms after request and resumes 16–20 ms after first presentation; cached-only window receives both. Native/safe-point release wait before 194 ms, busier after 286 ms, final 227 ms; these are release waits, not isolated native-decode timings, and none is subtracted. `codebase/output/w2-p3-{before-qualified,after,qualified-final}.json`. Commit containing this note. |

## November 15: W2 RAW/Lensfun stages (MacBook Neo)

| Action / stage | Comparison rule | Measured result | Conditions / evidence |
| --- | --- | --- | --- |
| Full RAW open, action to first picture / exact picture plus scopes | Existing 5% ordinary timing noise; diagnostic, no RAW speedup claimed | Before first 7.93–8.17 s / exact 8.28–8.75 s; final first 7.32–8.43 s / exact 7.64–9.00 s | November 15, MacBook Neo A18 Pro / 8 GB, 1408×794, shared GPU lock, fresh Electron/backend per pair, unchanged selected 4 GB app ceiling and memory gates. Each import re-develops full DSC04375.ARW (7952×5304); second row is a new full import during real IMG_0790.CR2 paste preparation. OS caches are not flushed; second-row GPU pipelines are warm. Concurrent agents: before load 3.95–4.67; final load 3.30–4.14. Conditions differ; variation is noise-dominated for RAW speed comparison. `codebase/output/w2-p3-before-qualified.json`, `w2-p3-qualified-final.json`. Instrumentation unchanged between comparisons. |
| Full RAW decode/development; Lensfun coordinates; vignette call; remap; profile/modifier; first/exact presentation after backend ready | Measure and report only; no rewrite | Final 2.61–2.78 s; 0.449–0.518 s; <0.001 s; 2.27–2.34 s; 0–0.080 s; first 0.110–0.964 s / exact+scopes 0.426–1.531 s | Same final pair, auto unique Sony ILCE-7RM3 / Tamron E 35mm F2.8 F053. This profile has no calibrated vignetting: the near-zero call is not a calibrated-vignette benchmark. Before decode 2.66–2.73 s, coordinates 0.426–0.467 s, remap 2.42–2.71 s; unchanged math. **No-go for now**: coordinates plus remap are only about 32–36% of the whole final wait even if removed entirely; exact strip fusion can save less. Memory benefit and other calibrated lenses remain unmeasured. No pre-lens cache, sampled GPU handoff or implementation rewrite. Commit containing this note. |

## November 15: W7 tooltip wait (MacBook Neo)

| Action | Target / tolerance | Result | Conditions / revision |
| --- | --- | --- | --- |
| Hover to shared tooltip | About 2.5 s; 2.4–2.9 s allows timer/frame scheduling; hidden at 2.2 s | 2.502–2.504 s; passes | November 15, MacBook Neo A18 Pro / 8 GB, real Electron through shared GPU lock. Main 1408×794; iframe 1408×750; native Library pop-out 1408×796; Settings dialog top layer. Keyboard focus also waits; click/Escape dismiss immediately. `codebase/output/review/w7-interface/checks.json`; code in `66d744cf`, `68e0882f` and the commit containing this note. Every neighbour waits; no speed comparison is claimed. |

## November 15: W2 paste feedback (MacBook Neo)

| Action | Target | Before → after | Conditions / evidence |
| --- | --- | --- | --- |
| Confirm Paste to old pixels hidden and preparation feedback painted | About 100 ms | Old pixels 214–410 ms, no preparation message → both 10–12 ms (final rerun) | MacBook Neo A18 Pro / 8 GB, 1408×794 points, shared GPU lock, real Electron, deterministic PNG targets including a virtual copy. Same driver serves `97078dba` frontend for before without altering checkout; query-suffixed asset interception was corrected before the retained baseline. Confirmation-event to next qualifying animation frame; full preparation/transaction/redraw/Undo still checked. Concurrent agents; before one-minute load 4.21, after 2.65. Load differs, so no precise speedup ratio is claimed. `codebase/output/library-grade-paste/{before,after}.json`, `output/w2-p1-{before,final}.log`. Commit containing this note. |

## November 15: W6 photo context menu (MacBook Neo)

| Action | Target / comparison tolerance | Result | Conditions / revision |
| --- | --- | --- | --- |
| Right-click photo to first visible menu frame | ≤100 ms; differences within 20 ms or 20% (whichever is larger) are ordinary event/frame scheduling noise | Before 15.9–40.9 ms (median 26.6); after 2.4–13.8 ms (median 8.6); passes | November 15, MacBook Neo A18 Pro / 8 GB, 1408×794 points, shared GPU lock, disposable real Electron, six curated SDR photos, five actual right-clicks per version. Before serves frontend files from `7d745d28` without altering the checkout; after is the commit containing this note. Concurrent W1 backend edits are shared, so this is a diagnostic frontend comparison, not an isolated backend benchmark. Browser-clock contextmenu event to next menu-visible animation frame; excludes Playwright polling. `codebase/output/review/w6-interface/{before,after}.json`. A held-response check independently proves ordinary commands open while Revert waits and a late answer cannot reopen a closed menu. |

November 15, collapse-button alignment (commit containing this note): Windows PC, 2560x1440, frozen mixed-v1 fixture, shared GPU lock, plain Electron; Python fast checks running concurrently. First/ten pictures 2.3/2.9 s; all 30 visited viewport pictures drawn, no errors or memory violation. Diagnostic smoke only, not an isolated speed comparison. Report: `codebase/output/quick-library-check/collapse-buttons/report.json`.

## November 15: Detail highlight fix validation (Windows PC)

The default frozen-v1 Library viewport smoke did not finish observation before
its unchanged 130-second harness deadline. Windows PC, 2560x1440, shared GPU
lock, this commit (parent `620ad023`), disposable plain-Electron profile;
`codebase/output/quick-library-check/detail-highlights/report.json`. This is a
failed smoke check, not an action-latency baseline. No timing budget changed.

## November 15: Pin-folder command feedback (Windows PC)

| Action | Target | Result | Conditions / revision |
| --- | --- | --- | --- |
| Pin folder / Unpin folder, through list feedback | <1 s | Pin 0.015 s; Unpin 0.076 s | November 15, Windows PC, 2560x1440, isolated Electron folder-controls check under shared GPU lock; this commit, parent `6b92f6da`. Disposable one-photo folder, startup/background work enabled. Pin starts at API request, ends at next folder-list animation frame using returned pins; Unpin starts before confirmation click, ends after list removal and status. Steve's running app untouched. |
| Pin / Unpin / unpin impact, request response with upkeep blocked | <1 s | 0.037 / 0.003 / 0.123 s | November 15, Windows PC, same revision; FastAPI TestClient, synthetic 140,000-file SQLite Library, background worker held at upkeep gate, no picture decode. Confirms requests do not wait for reconciliation; not a large-Library on-screen measurement. Earlier diagnosed real-app Pin wait was about 68 s while full reconciliation ran inside the request. |

## November 26: zoomed Denoise after a straighten

MacBook Neo, A18 Pro, 8 GB, 1408x794-point lock setting. Unpackaged Electron
under the shared GPU lock on the November 26 geometry-map fix. Times include
launch and shutdown. These are driver checks, not Grade response benchmarks.

| Check | Result | Conditions |
| --- | --- | --- |
| Normal zoomed Denoise | 4/5 passed in 23.26–33.66 s | One run stopped in 19.35 s because the deliberately requested whole-frame parity reference was refused at 0.00 GiB of safe headroom, before the straighten. |
| Whole-frame reference admission recheck | 5/5 passed in 21.42-25.02 s | Unchanged driver and limits, with a temporary admission trace. Normal macOS pressure, 0.64-2.80 GiB safely available across 7968px native-stream requests; 288 MiB required. Every reference matched the region to zero levels. |
| Zoom after straighten, with memory contention | Passed in 36.88 s | 900 MiB competing allocation. The 7968px map returned 200 while a full preview required 3.41 GiB and only 3.12 GiB was safely available. |
| Zoom after straighten, display asleep | Passed in 29.63 s | Display asleep before launch and at exit. The map returned 200 with 2.64 GiB safely available versus 3.41 GiB required by a full preview. The full source stream still refused with 507, and the tiled picture succeeded. |

All passes kept bypass exact and the visible patch matched the whole-frame
reference exactly. A forced settle timeout named the blocked zoom refinement
timer and exited without waiting for the release runner.

Earlier failures occurred at the forced whole-frame reference, not the
region render. At three refusals macOS reported warning pressure and the
Mach reader measured 0.98-1.29 GiB available. Adjacent `vm_stat` samples
independently gave 0.76-1.21 GiB. This leaves zero above the unchanged 2 GiB
reserve. The native stream borrows the resident pixels and charges only the
existing fixed overhead and two encoding strip copies. The check does not
subtract app reservations or charge the resident image again. No memory
accounting or limit changed.

Proposed driver change if the reference keeps flaking: capture the regional
result and finish its bypass and straighten checks in the first Electron
session. Replay the same source, grade and viewport in a fresh session for
the whole-frame reference, before warming the region caches. Keep the
same-size capture and one-level comparison, and still prove that the tiled
pass never fetched the whole source.

## November 26: CPU DNG correction on the minimum Mac

MacBook Neo, A18 Pro, 8 GB, 1408×794 points. Shared GPU lock for every run.
Before uses the November 25 app baseline at `0f64b37f` and the identical
November 25 opcode implementation (`367b37d1`) for the standalone phase probe.
After is this change on the November 26 checkout. Each successful app pair
uses a fresh unpackaged Electron profile and the unchanged
`library-dng-warp.js --sample` driver with the two original RAWs linked into
disposable folders. One observation per photo per route, not a percentile or
a guarantee under memory pressure. The existing 10% diagnostic timing band
is not an extension of Steve's 15 s target.

| Library folder open → developed DNG thumbnail | CPU before → after | GPU before → after | CPU after, first decode |
| --- | ---: | ---: | ---: |
| DJI_0071-2, 48 MP | 59.06 → 13.87 s | 4.68 → 4.57 s | 11.90 s |
| Leica X2, 16 MP | 48.81 → 3.93 s | 2.00 → 1.62 s | 2.92 s |

The after times above are when the DNG is visible alongside the small PNG,
not when the unrelated PNG first appears. DJI's first app CPU decode spent
2.22 s in LibRaw development and float buffer preparation, 0.50 s in GainMap,
8.73 s in warp and 0.34 s in DNG colour. Leica spent 0.91 s developing,
1.72 s in warp and 0.13 s in DNG colour, with no GainMap. The remaining wait
includes analysis, session setup, reduction and drawing. An earlier DJI
attempt was refused before decoding (1.63 GiB estimated, 1.60 GiB safely
available). The fresh retry passed without changing admission or the RAM cap.

Standalone full-image CPU preparation on the same Mac, one observation per
condition. This isolates decode and corrections, without Electron or the
Library scheduler. Columns are seconds, before → after.

| Photo | LibRaw read and development | GainMap | Warp | DNG colour and crop | ACEScg normalization | Analysis | Loader total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DJI_0071-2 | 1.91 → 2.01 | 6.17 → 0.44 | 30.21 → 8.94 | 0.36 → 0.40 | 0.74 → 0.74 | 0.75 → 0.75 | 40.42 → 13.70 |
| Leica X2 | 0.89 → 0.81 | — | 8.96 → 1.53 | 0.10 → 0.15 | 0.33 → 0.48 | 0.30 → 0.44 | 10.76 → 3.57 |

DJI's final warp used 37.5 process-CPU seconds in 8.94 s of wall time.
Standalone Python peak RSS was 1,743 → 1,516 MiB for DJI and 895 → 927 MiB
for Leica. Both full-resolution after outputs had the same SHA-256 as the
previous CPU outputs. All eight real-photo HDR/SDR whole-picture and border
comparisons against GPU passed at the existing limits. The 59 synthetic
GPU cases passed with worst absolute error 0.00000510, plus the existing
cancellation, budget and allocation-failure checks.

## November 26: Library DNG Activity during development

MacBook Neo, A18 Pro, 8 GB, 1408×794 points. Two full
`library-dng-warp.js` runs in disposable unpackaged Electron profiles under
the shared GPU lock, on the commit containing this note. These are driver
observations, including any waits, not a new app speed comparison or limit.

| DNG | Browse to both grid tiles (CPU / GPU, s) | Explicit 640 px request (CPU / GPU, s) |
| --- | --- | --- |
| DJI_0071-2 | 16.23–16.46 / 4.89–4.95 | 0.041–0.046 / 0.018–0.024 |
| DxO optical correction only | 0.220–0.248 / 0.194–0.195 | 10.55–13.15 / 3.93–11.46 |
| Leica X2 | 4.14–4.33 / 1.88 | 0.033–0.039 / 0.020–0.021 |

The November 25 release run at `0f64b37f` already showed the DxO separation:
the grid filled in 0.216–0.266 s, but the CPU decode took 8.37 s and GPU input
preparation took 2.55 s. In the November 26 failing run the DxO CPU grid
filled in 0.190 s and its decode took 5.77 s. The corrected driver observed
zero DxO source-running samples at grid fill and 176–992 named samples
during the explicit 640 and 2560 px requests in each route/run. The photo
was named while the matching source actually ran in all six route cases
per run. No app behavior or output tolerance changed.

## November 26: Linear DNG Library memory admission

MacBook Neo, A18 Pro, 8 GB, 1408×794 points, unpackaged Electron under the
shared GPU lock. Default 4.0 GB app ceiling and unchanged OS/GPU reserves.
These are observed waits, not a new time limit.

| DxO optical-correction DNG (42.2 MP) | CPU + GPU reservation on unified memory | Source grant result |
| --- | ---: | --- |
| Merged `2fc09428`, GPU Library preview | 1.181 + 2.092 = 3.273 GB | 664.9 s waiting before refusal, in a roughly 750 s driver run |
| Denoise alone at `3067a98e`, GPU-only sample | 1.181 + 2.092 = 3.273 GB | Stalled after 60.5 s, still waiting when stopped after over four minutes |
| RGB-pass calculation (`2c7cf1e3`) | 1.181 + 1.105 = 2.286 GB | Four grants waited 0–0.518 s. Both full drivers passed in 116.52 and 116.89 s |

The old grant waited on whole-app memory, GPU room and the OS reserve, then
collected and reclaimed memory. When it refused, 1.129 GB already in use plus
the 3.273 GB reservation exceeded the protected turn's 4.4 GB allowance by
2.1 MB. No GPU source decode ran in either failing comparison. Denoise
added 4 bytes per pixel for signed Bayer candidates to a shared estimate,
including this already-demosaiced RGB file. The CPU GainMap/Warp work did
not run on it. The corrected estimate covers the full RGB input, three
planes, the compact highlight mask and one-plane reduction. Its embedded
SDR frame runs after the first frame frees its GPU buffers, not alongside it.

DxO's explicit 640 px GPU development took 3.67–3.78 s. The GPU allocation
peak was 1.035 GB on each grant. The largest measured whole-app increase
during a grant was 1.402 GB. Both runs passed all three DNGs on both routes,
all 59 synthetic geometry cases, and the existing finished-pixel and border
checks. No tolerance, admission limit or output changed.

## November 26: Library signed Bayer detail and Edge colour admission

MacBook Neo, A18 Pro, 8 GB, 1408×794 points, unpackaged Electron under the
shared GPU lock. Default 4.0 GB app ceiling, 2 GiB shared GPU budget and
93.3 MB reserved for drawing.

| 42.56 MP Bayer source | GPU reservation before | Corrected GPU reservation |
| --- | ---: | ---: |
| Ordinary native detail | 2.110 GB | 1.429 GB |
| Edge colour without saved repairs | 2.110 GB | 1.940 GB |

At merged `74286a54`, the old estimate plus draw room exceeded the shared
GPU cap by 55.8 MB before any other GPU work. The whole-app estimate was
2.405 GB including the CPU decode. Stage C, GPU RAW Single and Live Native
timed out at their 90, 120 and 180-second waits respectively. Temporary
Recovery reached its 300-second runner deadline before the forced invalid
pixels could exercise the CPU fallback.

Denoise alone at `3067a98e` reproduced the Stage C and Live Native
timeouts. Temporary Recovery had the same ungranted GPU reservation after
60.3 s and was stopped once diagnosed. GPU RAW Single on that branch
stopped earlier, at a separate native crop parity assertion before Single
zoom. The merged reference run passed those pixel comparisons.

The first two native checks were rerun after `c3de03d6` and `ab71e60f`, on
the same Mac with a fresh Electron profile each time. Elapsed times cover
Electron launch to driver completion and exclude waiting for the GPU lock.

| Driver | Passes | Elapsed | What finished |
| --- | ---: | ---: | --- |
| Stage C | 2/2 | 51.0–71.3 s | 100% RAW zoom and pan, then both DNG variants. The source files were unchanged. |
| Live Native | 2/2 | 40.1–46.1 s | Fit remained visible until native detail arrived, and later zooms reused the scene. PNG and RAW drawing used 217 MB and 410 MB, below their working budgets. |

### CPU recovery after GPU Edge colour rejection

Once GPU admission was restored, Temporary Recovery exposed a separate CPU
deadline on the 42.56 MP Sony RAW. Under concurrent test load the ordinary
decoder used 8.1–8.6 s in RAW development alone against an 8.79 s allowance
for work outside reconstruction. The helper restarted after the ordinary
deadline, even though reconstruction itself finished in 13.9–14.5 s, under
its separate 66 s allowance. That run failed after 112.9 s.

RAW transport diagnostics now reduce each channel directly and skip the
exact-65535 count pass when that channel's maximum is below 65535. The same
statistics and pixels are retained. With fresh profiles, Temporary Recovery
passed both faults in both runs (32.0–32.1 s total), leaving no durable error
or outstanding grant. RAW development took 5.4–5.5 s and CPU Edge colour
8.9 s. These observations were under different host load, so they are not a
controlled speed comparison. No decoder, reconstruction or memory limit changed.

### GPU RAW Single memory and pixel comparison

An early recheck got through native zoom and passed all 18 pixel comparisons
but recorded 1.62 GB of OS headroom just after starting the full-size CPU
Grade reference alongside Electron. A separate loaded run also fell below
the reserve before the comparison could start. Neither run counted as a pass.
The driver now checks navigation and memory with Electron open, then closes
it before running the same pixel comparison on the saved pictures.

Both final runs passed all 18 HDR/SDR pixel comparisons and the unchanged
memory and navigation checks. Whole-app peak was 3.18–3.25 GB, settling to
2.06–2.13 GB with no OS reserve violation. Native preparation plus crop took
5.0–5.7 s, prepared-neighbour navigation took 67 ms in each run, and the
complete driver took 158.3–158.6 s. No pixel or memory tolerance changed.

## November 26: Grade Retouch spot removal

MacBook Neo A18 Pro, 8 GB, 1408x794 points, unpackaged Electron under the
shared GPU lock. Warm 6000x4000 synthetic photo with twelve saved Inpaint
spots (one 12 px dust repair, eleven 100 px Donor Texture spots). Times
are from clicking Remove to the accepted picture.

| Action | Target | Before, instrumented | After this change |
| --- | --- | --- | --- |
| Delete a saved Inpaint spot at 100% | ≤ 1 s | 0.832–0.975 s | 0.201–0.511 s |
| Delete a saved Inpaint spot at Fit | ≤ 1 s | 0.920–1.419 s | 0.192–0.489 s |

Three removals per view in the pre-fix trace and in each of two final runs.
The old driver also ran a separate retry experiment during setup. The final
driver prepares the same spots in a single transaction at Fit and times only
deletion, requiring the new exact picture. A repeat using the old code and the
final protocol completed the first two 100% removals (0.628 and 0.746 s),
then timed out before reaching Fit.

The pre-fix trace showed zero solves on deletion, 27–119 ms for the native
snapshot copy/composite, 450–815 ms to install it, and a fresh 8.6 MiB Fit
texture upload. The new Fit path transfers 24.5–25 KiB of changed Fit pixels per
removal, in addition to the existing native patch. The earlier partial fix
without retained Fit textures still hit 1.106 s once. The final runs kept all
twelve deletions under budget. No timing, pixel or memory guard was loosened.
Evidence: `output/retouch-nov26-original/trace-summary.json`,
`output/retouch-nov26-isolated/result.json` and
`output/retouch-nov26-isolated-repeat/result.json`.

## November 25: overnight focused release check on the minimum Mac

MacBook Neo A18 Pro, 8 GB, 1408x794 points, unpackaged Electron under the
shared GPU lock, nothing else running. Release check at `0f64b37f`
(`output/release-checks/2026-11-25T15-01-15-425Z-aba82431f3ce8c9999c5`),
re-checks at `321dac3c`. Observations from the drivers' own logs.

| Action | Target | Mac result | Conditions / evidence |
| --- | --- | --- | --- |
| Remove a Retouch spot, action to accepted picture | <= 1 second | Failed: 100% 0.89–1.22 s, Fit 0.97–2.42 s (three runs); best run 100% 0.89–0.90 s, Fit 1.22–1.24 s | `retouch-latency.js`, release run and runner re-check at `321dac3c`. Still over target at Fit. |
| DSC00264.ARW (42 MP Sony) Grade first frame, CPU / GPU | ~10 s whole wait (Steve) | 15.6 / 13.4 s | `edge-colour-raw.js`, one observation each; Library scene 4.7 s. Over Steve's 10-second wish. |
| IMG_3129.CR2 Grade first frame, CPU / GPU | ~10 s | 6.7 / 4.4 s | Same driver; Library scene 3.2 s. |
| DNG on the CPU route, first to finished | — | DJI_0071-2 59.1 s (decode 56.5 s); Leica X2 48.8 s (decode 15.4 s) | `library-dng-warp.js` CPU comparison. GPU route for the same files: 4.7 s and 2.0 s. Only reached when the GPU route falls back. |
| Ultra HDR JPEG export, GPU / CPU | — | 12.0–36.4 / 15.6–45.2 s | `hsl-selection-delivery.js`, eight exports. |
| Library RAW development (grid / native 100%) | — | cold 1.36–1.72 s, reuse 4.5–7.5 ms, native 2.53–2.85 s | `library-gpu-raw-single.js` at `65da0dd0` (Lensfun row fix adds about 9 ms to preparation). Per-RAW app time 0.61–0.91 s in `library-gpu-raw.js`. |
| Library export of 42 MP RAW at the 4 GB default | — | CPU strips (GPU working set 4.03 GB + 1.3 GB start > 4.00 GB ceiling); attempt under ~44 s including launch | `library-export-live-tiles.js`; deliberate since `005c3610`. Native exports above about 27 MP use CPU strips at the default. Awaiting Steve's decision. |

## November 14: focused 0.9.3 release on the minimum Mac

| Action | Existing guard | Mac result | Conditions / evidence |
| --- | --- | --- | --- |
| Remove a Retouch spot, action to accepted picture | <= 1 second | Failed: 1.513–1.773 s at Fit in the fresh release retry | MacBook Neo A18 Pro, 8 GB, 1408x794 points; `1a8e1605`; `output/release-checks/2026-11-14T09-20-34-322Z-2955fd5c575d41a6432e`. Same driver also exceeds 1 second on v0.9.2 on this Mac. PC timings are a separate baseline. |
| Film/Lens 4K to exact Full | Driver's existing 15-minute attempt deadline | Release check: two timeouts; tag: 55.9 s. Memory follow-up: pre-fix quieter run passes in about 55.1 s, fixed run passes in about 55.6 s | November 14, MacBook Neo A18 Pro / 8 GB / 1408x794, A7R00619.exr, parent `6c68faa1` plus this commit. Follow-up times are Electron process creation to driver shutdown, not isolated tier-switch latency. Whole matrix passes unchanged; live same-snapshot diagnostics show old Full admission would refuse some uploads. Load-dependent admission, not a speedup; no deadline or budget changed. `output/mac-memory-regression/{trace,after}-film.log`. |
| Repeated independent GPU export plus full-size Proof | Original 3 / 2 GiB test caps, exact repeats and Proof identity, existing encoded ceiling | Both GPU; 14.975 / 15.039 s per export/Proof/decode pair | November 14, same Mac/window, parent `6c68faa1` plus native-source-stream correction; DSC04375 saved 1000-nit grade, 4000px JPEG. Before: Full host refusal, CPU fallback. `output/gpu-delivery-repeat/result.json`; no CPU timing comparison. |
| Library export, Export page closed / open | Open-page average <= closed + 5% | 35.339 / 33.614 s per photo; passes | November 14, same Mac/window, shared GPU lock, parent `6c68faa1` plus this commit; DSC00264/DSC04375/DSC06615, unchanged full GPU JPEG export settings, one warmup then three closed and three open exports. All GPU, including Sony; live tiles draw. `output/mac-memory-regression/live-tiles.log`. |

The final 90-second default Library viewport smoke at `257c17ae` passes:
first picture 0.3 s, all six requested rows drawn, independent process-tree
peak 2.725 GB, no memory violation or frame-gap failure. Conditions: same
MacBook Neo A18 Pro / 8 GB, 1408x794 points, frozen v1 normal-filter fixture,
plain Electron, no DevTools, shared GPU lock. This is six of 33 folder rows,
not a whole-folder survey and not a speedup comparison. Evidence:
`codebase/output/quick-library-check/release093-final-memory/report.json`.

The memory-admission follow-up in this commit also passes the 90-second
viewport smoke: six of six requested pictures, both DJI DNGs developed,
first picture 0.9 s, peak app footprint 3.063 GB, minimum available 5.068 GB,
longest drawing gap 50 ms. The separate frozen-v1 `--survey --all-files`
run pictures 47/50 (not the earlier 48/50): first/ten/forty 0.4/1.5/39.9 s,
app peak 2.582 GB, minimum available 4.724 GB, no memory violation or
photo-work error. DSC01287.exr, LR-classic-hdr-source-test-1.avif and
pano_192mp.jpg remain unpictured; no full-folder pass is claimed. Same MacBook
Neo / 8 GB / 1408x794, fresh default 4 GB profiles, unchanged reserve,
shared lock, plain Electron. CPU/load: viewport 33.8% / 2.91–3.67; survey
42.1% / 2.40–3.48. External load differs from the allocator comparison;
these are regression/coverage checks, not a new speed comparison. Retained
allocator memory improvement is supported; exact 48-photo coverage is not
reconfirmed. Evidence: `output/quick-library-check/mac-memory-regression/`
and `mac-memory-regression-survey/`.

Other measurements in release logs are diagnostic, not new performance targets.
The release failure inventory and limits on comparison evidence are in
`docs/known-limitations.md` under the focused 0.9.3 Mac release record.

# Performance table

## November 16: renderer-split validation conditions

| Action | Observed time | Conditions |
| --- | --- | --- |
| HSL neutral full-size JPEG export | GPU 12.465 s; CPU 19.873 s | MacBook Neo / A18 Pro / 8 GB / 1408×794; shared GPU lock, IMG_0114.CR2, local-HSL driver, actual finished-pixel capture enabled. CPU codec research overlapped; diagnostic times only, not a speed comparison or baseline. `codebase/output/review/encoding-fidelity-fixes/hsl-selection-delivery.log`; `7089958c`. |

## November 16: N4 local Match SDR (MacBook Neo)

| Action / stage | Observation | Conditions / evidence |
| --- | --- | --- |
| Bounded local fitting only | 0.164–3.111 s across 18 cases; RAW-derived proxies 1.204–3.111 s. Diagnostic, not a whole-action latency acceptance or speedup claim | Neo A18 Pro / 8 GB; CPU real renderer, 256px edge, synthetic plus DSC00264.ARW / IMG_3129.CR2; gradient/brush/hue, Film off/Portra 50%, overlap. Source decode, mask preparation, request and presentation are excluded; some fast validation concurrent. `codebase/output/review/n4-local-match/measurements.json`. |
| Default Library viewport smoke | 90 s passed; 9/9 viewport pictures, no photo/app errors, 50 ms longest drawing gap (250 ms guard), external peak 3.137 GB | Plain Electron 1408×794, shared GPU lock, frozen library-mixed-v1, no new memory setting. Not a whole-folder/Single check or speed comparison; fast suites overlap the tail. `codebase/output/quick-library-check/n4-local-match/report.json`. |

November 15 live hang investigation: **Windows PC**, installed **0.9.3**,
2560x1440 machine setting; normal use of `20261114 Lucas 8 bday`, with bulk
paste preparation and Grade work overlapping. Read-only inspection of
`%APPDATA%/hdr-finisher-desktop/logs/backend.log`; no controlled timing run
or before/after comparison. Checkout inspected: `89e6371a`; installed build
commit not established.

| Action | Observed | Conditions / result |
| --- | --- | --- |
| Open DSC07571.ARW in Grade during bulk paste | First frame 47.7 s; controls 49.1 s | Click 09:05:16 local; CPU paste preparation active. App memory reached 11.67 GB at 09:06:15 against the selected 4 GB ceiling, with no active Library grants reported. Paste preparation was still advancing at 09:12:39; this is overload evidence, not proof of a deadlock. |

November 15 scheduled paste app check, **Windows PC**, unpackaged checkout
working tree leading to `10559a2c` (November 15 preparation plan),
2560x1440, shared GPU lock, disposable profile; Python suite running concurrently.
`library-gpu-raw-paste.js`, DSC06615.ARW: cold full-import preparation **16.822 s**,
three concurrent stored-start reuse requests **0.056 s**; unchanged paste wrote
no sidecar. This is a functional smoke observation, not a speed comparison or a
new timing limit. Result: `codebase/output/library-gpu-raw-paste/1794709619156/result.json`.
The observed incident above has not been remeasured in normal use.

## November 14: native allocator release on the minimum Mac

Code: requested merge `82758935` plus this commit's backend allocator policy.
MacBook Neo, Apple A18 Pro, 8 GB unified memory, six cores, 1408x794 points;
shared GPU lock, same v1 fixture, fresh **4 GB app profiles**, unchanged **2 GB
system reserve**, all original budgets/rates/accuracy gates. Electron's allocator
was held at mode 0 in both captures; only backend/helpers changed from mode 0
to `MallocSpaceEfficient=1`. Other agents remained active. CPU is whole-machine
busy percentage; load is the one-minute range. Existing 5% timing tolerance and
250 ms frame-gap limit apply. Coverage, rather than an isolated speed ratio,
is the result: different external load prevents a precise speedup claim.

| Capture | Pictures | First / ten / forty | Peak app / minimum available RAM | Frame gap | Conditions: MacBook Neo CPU / load |
| --- | --- | --- | --- | --- | --- |
| Before allocator, viewport | 6/6 requested, 6/33 folder | 0.4 s / — / — | 4.219 / 1.216 GB | 66 ms | 18.7% / 2.00–3.13; reserve fails |
| After allocator, viewport | 6/6 requested, 6/33 folder | 0.4 s / — / — | 2.674 / 4.209 GB | 67 ms | 20.4% / 1.94–3.44; all smoke gates pass |
| Before allocator, scrolling | 35/50 | 0.5 / 1.0 / absent | 4.772 / 1.013 GB | 51 ms | 35.4% / 2.32–3.58; reserve/settling/coverage fail |
| After allocator, scrolling | 48/50 | 0.5 / 1.0 / 46.6 s | 3.214 / 3.350 GB | <50 ms | 32.3% / 2.78–4.76; all memory gates pass, coverage fails |
| After repeat, busier scrolling | 48/50 | 0.7 / 1.4 / 54.0 s | 3.026 / 1.371 GB | <50 ms | 55.1% / 5.43–7.45; reserve/coverage fail under competing workload |

The unchanged default viewport asks for only six photos at this window and
thumbnail size; the other 27 normal-filter rows are unvisited. Scrolling with
`--survey --all-files` separately requests all 50 physical v1 photos. Times
below are browse/scroll action to each first picture, among pictures produced.
Unpictured jobs remain in denominators. Grant totals include retries and later
work, not just first pictures. UnGranted includes cancelled/waiting/refused
requests; it does not mean decode failure. No per-photo decode failures were
reported in these two captures.

| Type | Before: pictured; seconds | After: pictured; seconds | Grants granted/ungranted; longest wait seconds, before → after |
| --- | --- | --- | --- |
| ARW | 9/12; 0.71–85.67 | 12/12; 0.68–23.05 | 9/6; 49.09 → 12/0; 18.40 |
| AVIF | 2/3; 7.63–38.84 | 2/3; 6.82–7.53 | 2/1; 51.09 → 2/1; 2.95 |
| CR2 | 2/2; 0.59–30.73 | 2/2; 0.35–0.58 | 2/1; 0.71 → 2/0; 0.00 |
| CR3 | 1/1; 30.83–30.83 | 1/1; 0.36–0.36 | 1/1; 0.65 → 1/0; 0.00 |
| DNG | 4/6; 0.97–38.70 | 6/6; 0.95–17.85 | 9/6; 52.32 → 9/1; 10.50 |
| EXR | 0/2; — | 1/2; 24.98–24.98 | 0/3; 51.09 → 1/1; 26.72 |
| HDR | 0/1; — | 1/1; 23.71–23.71 | 0/1; 51.09 → 1/0; 17.48 |
| HEIC | 1/2; 87.38–87.38 | 2/2; 7.37–19.41 | 1/1; 52.31 → 2/0; 13.33 |
| JPEG | 4/5; 0.54–36.58 | 5/5; 0.55–34.92 | 6/2; 52.30 → 6/0; 31.05 |
| JXL | 2/2; 13.26–43.50 | 2/2; 19.93–27.39 | 6/1; 7.30 → 6/0; 3.72 |
| NEF | 2/2; 30.82–31.16 | 2/2; 0.45–0.55 | 2/2; 0.56 → 2/0; 0.00 |
| ORF | 2/2; 30.95–30.96 | 2/2; 0.45–0.51 | 2/2; 0.53 → 2/0; 0.00 |
| PFM | 0/1; — | 1/1; 26.53–26.53 | 0/1; 51.09 → 1/0; 20.29 |
| PNG | 2/3; 6.06–31.56 | 3/3; 0.67–30.52 | 2/3; 51.09 → 3/1; 22.71 |
| RAF | 1/1; 30.52–30.52 | 1/1; 0.28–0.28 | 1/1; 0.75 → 1/0; 0.00 |
| RW2 | 1/1; 31.03–31.03 | 1/1; 0.48–0.48 | 1/1; 0.49 → 1/0; 0.00 |
| TIFF | 2/4; 33.40–33.89 | 4/4; 1.83–22.17 | 2/6; 51.09 → 4/1; 16.89 |

Routes before → after: embedded JPEG **19 → 19**, developed RAW **2 → 4**,
saved grade **1 → 5**, decoded HDR **6 → 13**, decoded SDR **7 → 7**.
Per-photo type, route, action time, full grant lifecycle/bytes/waits/refusals,
and failures are in each capture's `photos.json`; `memory.jsonl` records
machine load and process memory, `report.json` records every failed gate.

Native summaries previously found empty large-allocation regions of about
1.4 GiB backend and 604 MiB helper, partly swapped. In the bounded allocator
probe, mode 0 retained 588 MB after freeing 579 MB; mode 1 returned to 7.5 MB.
Public malloc pressure relief released zero in both cases. MacBook Neo load
endpoints 2.83/2.83; 0.034/0.036 s diagnostic subprocesses, not app timings.
The backend launch now sets Apple's space-efficient allocation mode; child
helpers inherit it. No cache or app memory number changes. Late live backend/
helper charge after the successful survey is approximately 127/71 MB.

Remaining missing photos are `DSC01287.exr` and
`LR-classic-hdr-source-test-1.avif`. EXR's unified source/GPU grant is
2.947 GB (1.336 GB GPU); it waits 26.7 s before scrolling cancels it.
AVIF asks for 3.439 GB (1.330 GB GPU). One AVIF wait snapshot has 4.381 GB
physical headroom before the protected reserve, hence 2.381 GB available
for admission: short **1.058 GB**. A 0.5 GB reserve cut buys at most 0.5 GB
and would not admit it there. Existing CPU estimates are about 1.06 GB EXR /
2.11 GB AVIF, suggesting route work before changing reserve; no CPU-route
qualification is claimed. The attempted admission-triggered CPU fallback was
removed after its 90-second survey produced only 40/50 and breached reserve
(4.216 GB sampled peak; CPU 61.8%, load 5.92–11.19). The heavy external load
prevents attributing that regression solely to the experiment.

Final allocator-only pixel check: `library-rgb-source.js --precision
--picture-only`, MacBook Neo, shared lock, disposable 4 GB profile, 1920-long-
edge photographic input: **14/14 pass**, unchanged mean <1 / p99.9 <=3;
worst mean 0.081594, worst p99.9 0.393557. Harness 24.13 s including fixture
generation; sampled CPU 73.9%, load 4.01–4.90; preparation 0.267–0.889 s is a
diagnostic, not browse latency. Full native/preemption qualification remains
open; its assertions were not relaxed. Final retained code's fast suites:
Node 985 pass/1 skip; Python 3,411 pass/144 skip/one existing xpass.
The rejected CPU fallback was removed byte-for-byte to the tested version.

PC note (no extra run): the 85bba832 first/ten 5.6/7.6 s versus earlier isolated
0.8–1.2 s can plausibly involve the stale visibility snapshot and camera work
waiting behind heavy admission. Both existed in that code and both have fixes
on this branch. The larger PC viewport requests more concurrent pictures.
The supplied PC aggregate log lacks per-photo admission/visibility evidence;
this is a plausible explanation, not a confirmed cause or measured PC fix.
The allocator change applies only on macOS.

Evidence: `codebase/output/quick-library-check/8gb-allocator-{before,after}-survey/`,
`8gb-allocator-{before,after}-viewport/`, `8gb-allocator-repeat-survey/`,
`8gb-allocator-cpu-survey/`; `codebase/output/8gb-allocator-policy.log`,
`8gb-allocator-accuracy.log`, `8gb-allocator-accuracy-load.json`,
`8gb-allocator-{node,python}-tests.log`. Approximately 11 of Steve's additional
15 locked minutes used; no further slow checks started. Six GB usable RAM
supports 48/50 here, but complete mixed-folder acceptance remains open.


## November 14: earlier Library measurements before allocator release

Code: baseline `2a0c70e7`; final production `126a93b1`; focused pixel mode
`f1bd02f1`. **Every row below uses the MacBook Neo, A18 Pro, 8 GB unified RAM,
six cores, 1408x794 points, plain Electron, shared GPU lock, unchanged v1
photos and fresh profiles.** The unchanged smoke selects the existing **4 GB
app setting**, rather than the 2.5 GB startup default; the physical reserve
remains 2 GB. Four other agents were active; no own fast suite overlapped the
qualified captures. CPU is whole-machine busy percentage; load is the OS
one-minute range. Timing tolerance 5%; frame-gap limit 250 ms. No budget,
rate, cache share, processing arithmetic or image tolerance changed.

The ordinary 300-point grid requests six of 33 normal-filter rows. Whole-folder
coverage is measured separately by `--survey --all-files`, using the normal
minimum thumbnail control and scrolling through the same 50 physical photos.
Unvisited rows are recorded separately from missing requested pictures.

| Capture/action | Pictures | Whole action-to-picture timing | Frame gap | Conditions: machine, CPU mean / load range |
| --- | --- | --- | --- | --- |
| Loaded before viewport | 6/6 visited; 6/33 folder | first 2.5 s | 67 ms | MacBook Neo; 54.8% / 13.77–15.79; census stopped after 17.3 s |
| Loaded before survey | 40/50 | first 0.5 s; 40th 79.2 s | 434 ms | MacBook Neo; 34.5% / 3.78–6.82; census stopped after 62.1 s |
| Quieter before viewport | 5/6 visited; 5/33 folder | first 0.8 s; sixth absent at 90 s | 83 ms | MacBook Neo; 33.9% / 4.02–8.11; complete 94.0 s census |
| Quieter before survey | 40/50 | first 0.5 s; 40th 73.3 s | 50 ms | MacBook Neo; 32.8% / 3.52–5.74; complete 92.5 s census |
| Final viewport | 6/6 visited; 6/33 folder | first 0.4 s; all six by 15 s | 200 ms | MacBook Neo; 25.4% / 1.93–2.89; complete 92.4 s census |
| Final survey | 40/50 | first 0.5 s; ten 0.9 s; 40th 55.5 s | 50 ms | MacBook Neo; 33.4% / 2.25–3.40; complete 92.6 s census |
| Large linear DNG alone | 1/1 | 9.5 s to first picture | none >=50 ms | MacBook Neo; 29.7% / 2.42–3.05; 30 s scenario, 33.2 s census; hard link to unchanged v1 source |

The early two censuses ended prematurely and cannot qualify a full run. The
observer now retries a disappearing-child census once, continues observing,
and reports early termination. The quieter repeats are the before comparison;
changing external load prevents an isolated percentage-speed claim.

The final two mixed runs still fail the physical reserve (minimum available
1.057/1.089 GB). Their peaks are 4.229/4.430 GB; the survey also exceeds the
unchanged 4.4 GB absolute allowance by about 30 MB. The loaded before survey
already reached 4.679 GB. These are failures, not minimum-Mac acceptance.
The isolated DNG passes all smoke gates, peaks at 1.445 GB and has at least
5.068 GB available: its mixed-folder failure is admission/retention, not an
inherent inability to display it.

### By type: quieter before → final survey

Times below are browse/scroll action to each first picture, among pictures
that appeared; absent pictures remain in the counts. The grant wait includes
unfinished and cancelled work, not just successful decodes. No broken-photo
decode failures were reported in either survey. Per-photo production paths,
all grants/waits/refusals and failures are in each capture's `photos.json`.

| Type | Pictured before → after | Action to first picture, seconds: before → after | Longest after grant wait |
| --- | --- | --- | --- |
| ARW | 11/12 → 12/12 | 1.00–43.33 → 0.59–26.69 | 22.5 s |
| AVIF | 2/3 → 2/3 | 3.51–10.79 → 7.57–9.12 | 4.3 s |
| CR2 | 2/2 → 2/2 | 0.52–0.72 → 0.39–0.52 | 0.0 s |
| CR3 | 1/1 → 1/1 | 4.07 → 0.43 | 0.0 s |
| DNG | 5/6 → 5/6 | 1.41–25.29 → 0.85–23.92 | 52.0 s |
| EXR | 0/2 → 0/2 | — → — | 26.9 s |
| HDR | 1/1 → 0/1 | 39.70 → — | 21.0 s |
| HEIC | 1/2 → 1/2 | 19.86 → 25.52 | 48.1 s |
| JPEG | 4/5 → 4/5 | 0.48–1.51 → 0.47–2.50 | 55.0 s |
| JXL | 2/2 → 2/2 | 4.51–11.77 → 11.49–13.30 | 5.7 s |
| NEF | 2/2 → 2/2 | 0.81–1.22 → 0.47–0.61 | 0.0 s |
| ORF | 2/2 → 2/2 | 2.35–2.60 → 0.49–0.54 | 0.0 s |
| PFM | 0/1 → 0/1 | — → — | 21.0 s |
| PNG | 2/3 → 2/3 | 2.18–6.96 → 0.78–6.18 | 21.0 s |
| RAF | 1/1 → 1/1 | 2.03 → 0.29 | 0.0 s |
| RW2 | 1/1 → 1/1 | 2.90 → 0.51 | 0.0 s |
| TIFF | 3/4 → 3/4 | 3.14–32.18 → 1.86–29.95 | 25.4 s |

All 19 ungraded camera pictures use embedded JPEGs: 0.523–4.065 s before,
0.286–1.114 s after. RAF/CR3/ORF/RW2 now request their approved 64 MB instead
of 0.37–0.59 GB derived from sensor dimensions; those five final previews have
zero grant wait. Saved grades pictured increase from three to four, with
8.283–43.326 s before and 5.491–26.693 s after. Developed RAWs remain three;
finished HDR files fall from eight to seven within this 90-second visit.
The Radiance HDR file is the lost case; overall folder completion has not
improved beyond 40/50. Slow saved-grade/decode work and later heavy admission
remain open, even though the camera lane is prompt.

At the final survey's end, charged app memory is still 2.601 GB, including
backend 1.357 GB and helper 0.655 GB. A waiting reduced linear-DNG request is
2.110 GB including GPU, making 4.711 GB together, above 4.4 GB. The large JPEG
request is 2.654 GB, making 5.255 GB together. Lowering the system reserve by
0.5 GB buys at most 0.5 GB of physical headroom; it changes neither app-side
shortfall, and would not cover the observed approximately 0.94 GB physical
reserve shortfall. No reserve change is proposed or made.

Two focused diagnostics are excluded from the timing comparison:

- Allocation tracing: MacBook Neo, CPU 32.3%, load 2.19–3.31, 93.9 s harness.
  Backend charged memory 1.688 GB with 26.9 MB of traced live Python/NumPy
  allocations (tracking begins when the memory module imports); reported caches total about 85 MB across the app.
- Native memory summary: MacBook Neo, CPU 27.1%, load 2.03–3.05, 93.1 s
  harness, `vmmap -summary` sampled at about 65 s. The backend has a 1.4 GiB
  **empty** large-allocation region (368.8 MiB resident, about 1.0 GiB swapped),
  plus fragmented small zones; the helper has 604.2 MiB of empty large regions
  (488.9 MiB resident). These are retained freed allocator regions, not live
  Python photos. Swapped sizes are not additional physical RAM. A shortage-only
  Python collection/native pressure-relief experiment did not materially
  unblock the folder and was removed; further native-release work is open.

Focused finished-picture qualification: `library-rgb-source.js --precision
--picture-only`, MacBook Neo, shared lock, 4 GB disposable profile, photographic
input bounded to 1920 long edge; CPU 41.1%, load endpoints 1.94/2.55, 15.6 s
including fixture generation. Seven cases/14 HDR-SDR comparisons pass the
unchanged perceptual mean <1 / p99.9 <=3 gates; worst mean 0.0816, worst p99.9
0.3936. Paired picture preparation is 0.176–0.579 s in this diagnostic driver,
not a Library browsing benchmark. The full native/preemption driver remains
separate: earlier attempts stopped on native memory refusal or a missing
stored native scene, before finished-pixel comparison. Its assertions stay
intact; no native qualification is claimed here.

Evidence under `codebase/output/quick-library-check/`: `8gb-before`,
`8gb-survey-before`, `8gb-before-quieter`, `8gb-survey-before-quieter`,
`8gb-reader-final`, `8gb-survey-reader-final`, `8gb-line-scan-reader-final`,
`8gb-allocation-diagnostic`, `8gb-native-memory-diagnostic`. Each normal capture
retains `report.json`, `photos.json`, `host.json`, `memory.jsonl` and backend
logs. Native summaries are in the last diagnostic directory. Pixel evidence:
`codebase/output/8gb-picture-accuracy.log` and `8gb-accuracy-host.json`.

November 14 PC check after the Mac Phase 1 work (`85bba832`; **Windows PC**,
dedicated GPU; 2560x1440 unpackaged Electron; shared GPU lock, checks run one
at a time, no concurrent suites). First PC run of the Phase 1 drivers, so the
Grade rows are a new PC baseline, not a comparison.

| Action | Observed | Conditions / result |
| --- | --- | --- |
| Mixed Library 90-second smoke | First/ten pictures 5.6/7.6 s; 29/33 pictured; longest frame gap 236 ms | Drawing gap inside the 250 ms limit (earlier PC runs 649–1,758 ms). First picture well above the earlier isolated PC 0.8–1.2 s, unexplained; Steve to try Library. Same four photos not pictured as before. Peak 1.65 GB |
| SDR Show selection, Fit cold / warm / range edit | 2.432 s / 0.370–0.388 s / 0.559 s | `grade-speed.js`, grade-24mp.tiff; warm passes <1 s |
| SDR Show selection, 100% cold / warm / range edit | 0.086 s / 0.072–0.073 s / 0.071 s | Same driver |
| Film Stock Color / Print Contrast / Grain Amount / lens Strength drag | 33.2 / 15.0 / 35.0 / 35.1 frames/s | SDR Fit; Print Contrast below the 20 frames/s target |
| First Exposure after idle Denoise | 13.7–14.5 ms | Same driver, three observations |
| GPU delivery ceiling, DSC04375 full export GPU / forced CPU | 29.1 / 103.7 s | `gpu-delivery-ceiling.js`; decoded peaks 1003.9 / 1009.3 nits, inside the 1% encoding allowance |
| Library CPU fallback after GPU loss | 0.240 s | `library-gpu-recovery.js`; one recovery, then CPU |

Evidence: `codebase/output/quick-library-check/pc-waiting-list/report.json`,
`codebase/output/performance/p1b/pc.json`.
November 14 UI-polish round 2 mandatory Library smoke (commit containing this
record): **MacBook Neo**, Apple A18 Pro, 8 GB unified RAM, 1408×794-point
unpackaged Electron, plain quick-check launcher through the shared GPU lock,
frozen mixed v1 fixture, 90 seconds. First picture 0.5 s; six of 33 eligible
photos pictured; ten never reached. It repeats the documented incomplete
coverage and additionally reports the existing system-reserve guard (available
memory below 2 GB). Fast suites had finished. No throughput acceptance claim,
limit change, rerun or Library investigation for this presentation-only work.
Evidence: `codebase/output/quick-library-check/ui-polish-r2/report.json`.

November 14 UI-polish mandatory Library smoke (commit containing this record):
**MacBook Neo**, Apple A18 Pro, 8 GB unified RAM, 1408×794-point unpackaged
Electron, plain quick-check launcher under the shared GPU lock, frozen mixed
v1 fixture, 90 seconds. First picture 0.4 s; six of 33 eligible photos pictured
by the end; ten never reached. This repeats the existing incomplete-coverage
failure, not a UI speed comparison or a new throughput qualification. No
memory/responsiveness acceptance error was reported. No rerun or scheduler
investigation for this presentation-only change. Evidence:
`codebase/output/quick-library-check/ui-polish-1114/report.json`.

November 14 mandatory HDR check, paired GPU cost (commit containing this
record): **MacBook Neo**, Apple A18 Pro, 8 GB unified RAM, 6 cores,
1408×794-point unpackaged Electron; shared GPU lock. IMG_0114.CR2 and
DSC00264.ARW are prepared as 1600px linear-ACEScg EXRs before import. JPEG
Ultra HDR quality 90/default 4:2:0 and gain-map settings, no output sharpening,
Highlight Compression enabled at 1000 nits. Measure export request to response
(render/cache lookup, encode, check/correction, validation and publication);
source preparation/import and file-dialog time are excluded. The diagnostic
bypasses only the post-encode check for its baseline; that unchecked switch
is not available to users with Highlight Compression on. One warm-up, then
two measured exports per policy; policy order alternates. Other agents may
use CPU/RAM, but GPU/Electron checks never overlap.

| Case | Unchecked diagnostic mean | Checked delivery mean | Added whole wait |
| --- | --- | --- | --- |
| IMG_0114 dim control (−6 EV), no correction | 0.409 s | 0.891 s | about 0.482 s; one encode/decode, decoded peak 14.147 nits |
| IMG_0114 (+3 EV), correction needed | 0.706 s | 2.796 s | 2.090 s; three encodes/decodes, 1400.631 → 1028.661 → 993.623 nits |
| DSC00264 (+3 EV), correction needed | 0.686 s | 4.216 s | 3.530 s; four encodes/decodes, 1302.686 → 1008.395 → 1008.395 → 999.368 nits |

The decode itself takes 0.373–0.378 s for the clean control. The agreed
5% timing-noise allowance applies to whole waits. The dim unchecked control
varies 6.1% around its mean (0.384–0.434 s), beyond it; its added cost is
therefore approximate, 0.44–0.53 s. Other pairs stay within 5% of their mean.
No additional run was made; Steve should try exports before further timing
work. These are bounded warm-photo measurements, not native RAW throughput
or costs at larger export sizes. Evidence: `codebase/output/ceiling-followup/cost.json`.

Other observations from the same Mac checks (no renderer speed comparison):

| Action | Observed | Conditions / qualification |
| --- | --- | --- |
| Real-photo all-codec export/Proof matrix | GPU export requests 1.37–16.41 s; CPU 1.96–12.21 s | 1600px DSC00264-derived EXR, quality 90, +3 EV, 1000-nit target; different codecs, one request each. All six pairs and 800px/1600px Proof pass; full Proof equals export. |
| Native 42MP GPU request falling back to CPU | 69.35 s backend export total | DSC00264.ARW 7968×5320, output JPEG 1600px; GPU host estimate 3.41 GiB with safely available 0.00 GiB. One attempt then accepted CPU export; native GPU route not qualified. |
| Library 90-second smoke | First picture 1.2 s; six of 33 pictured | Same Mac/window, shared lock, mixed private fixture folder; fails system reserve and coverage. Not investigated or rerun here. |

The six-case encoded Proof check also passes the new 1% ceiling rule, with
977.461–994.067-nit peaks. Logs/results: `codebase/output/ceiling-followup/`,
Library report `codebase/output/quick-library-check/ceiling-followup/report.json`.

November 14 encoding-allowance follow-up (commit containing this record),
**MacBook Neo**, Apple A18 Pro, 8 GB unified RAM, 6 cores. Preliminary CPU
codec/correction diagnostic: IMG_0114.CR2 and DSC00264.ARW loaded once and
reduced to 1600 px **before** creating the session, +3 EV, 1000-nit target,
quality 90/default codec settings. One warm-up pair then one measured pair
per photo, alternating policy order. Whole in-process CPU exports include
rendering, encode, checking/correction and ordinary validation; import and
independent audit decodes are outside the wait. Other CPU tests and Steve's
app overlapped: these observations are **not** an isolated before/after
qualification, nor native-RAW export timings. Agreed timing noise allowance
for the isolated follow-up is 5%.

| Codec | Check bypassed (diagnostic only) | Check and correction enabled |
| --- | --- | --- |
| jpeg_ultrahdr | 0.91–1.27 s | 2.65–3.49 s |
| avif_gain_map | 2.73–2.92 s | 13.93–15.83 s |
| jpegxl_hdr | 1.23–1.59 s | 1.70–1.86 s |

A separate native-source probe (DSC00264.ARW, 7968×5320, ordinary CPU render
then JPEG resize to 1600 px, same grade, concurrent Python suite/manual app)
took 42.45 s for one export. No native-source CPU before/after claim follows
from that single observation. The isolated bounded GPU request timing is recorded above.
Compact preliminary evidence:
`codebase/output/ceiling-followup/cpu-small-matrix.json`.

November 14 Mac export-ceiling fix (`9bfea9e5`; MacBook Neo, Apple A18
Pro, 8 GB, 6 cores; 1408x794 points; unpackaged Electron, shared GPU lock;
other agents active, uncontrolled available memory). These are observations,
not a before/after speed comparison or timing qualification:

| Action | Observed | Conditions / result |
| --- | --- | --- |
| Balanced Rock full-size Ultra HDR export, neutral / Global HSL / local hue-mask grades | GPU 11.5–25.0 s; forced CPU 19.6–50.6 s | `IMG_0114.CR2`, 1000-nit target, quality 95, 4:4:4, full gain map, no sharpening; already-open photo; request-to-export response, excluding import/Proof. Global and local drivers pass their existing relative perceptual checks, exact decoded ceiling and full-size Proof identity. |
| Synthetic GPU/forced-CPU export smoke | GPU 1.052 s; forced CPU 0.041 s | Tiny fixture, first GPU submission includes startup; backend-reported total, not user action-to-screen. GPU and CPU full-size Proof identity and watermark checks pass; not representative speed evidence. |
| Synthetic Edge-colour GPU kernel, 400x400 | 0.121–0.406 s | Expand 0, 0.5, 3; existing parity and rejected-invalid-result CPU fallback pass. Kernel time only, not action-to-screen; no optimisation or controlled before/after comparison. |
| Mixed Library 90-second smoke | First picture 0.5 s; 6/33 pictured; longest frame gap 399 ms | Incomplete coverage and gap above the unchanged 250 ms limit; no sustained memory violation. App peak 3.891 GB; independent charged-process peak 4.123 GB settles within the existing grace period. Not Library acceptance; ask Steve to try it before another timing run. |

Evidence: `codebase/output/mac-export/final/` and
`codebase/output/quick-library-check/mac-export-ceiling/report.json`.
No new speed claim, tolerance or budget is introduced.
November 14 fixed preview-parity drift guards (`fix/gpu-parity-limit`, commit
containing this record; base `3f232e0b`): **MacBook Neo**, Apple A18 Pro,
8 GB unified RAM, 6 cores, native Apple Metal, 1408x794-point window,
unpackaged Electron; shared GPU lock for every Electron run. Steve approved
three measurements and worst + 0.005 mean / + 0.020 p99.9 ΔE, rounded upward
to 0.001. All 63 affected cases have zero observed spread across three
measurements each: independent processes for lens, repeated complete captures
in one process for Velvia (plus a fresh-process final check). The driver presents SDR in both editing lanes, so
these are full finished-pixel ΔE 2000 measurements, not HDR ΔE ITP or peak
qualification. No production rendering or performance improvement is claimed.

| Calibration / check | Driver duration | Result / conditions |
| --- | --- | --- |
| Full lens baseline, 128 cases | 835.3 s | MacBook Neo; 68 strict passes / 60 mean-gate misses. Duration includes six unused partial-repeat cases before intentionally yielding to critical 100% checks; only the complete first matrix is retained. |
| Two further lens measurements, 60 affected cases each | 447.5–494.6 s each | MacBook Neo; identical per-case metrics across all three runs. Third run overlaps low-priority Python tests; diagnostic duration, not a controlled speed baseline. |
| Velvia physical chain, three repeats in both lanes | 117.0 s total | MacBook Neo; HDR added-byte mean 0.073473 stays strict; SDR 0.104330 misses 0.1. SDR finished mean/p99.9 0.119114/1.044660, identical across three runs. |
| Final gates applied to saved measurements | Not a render timing | MacBook Neo data; 254/254 pass: 248 lens comparisons plus six film comparisons. Explicit replay, not a fresh full-matrix render. |
| Lens caps, HDR editing lane / SDR editing lane | Accuracy result | MacBook Neo calibration; worst mean/p99.9 0.155865/1.134869 and 0.242057/1.181764; caps 0.161/1.155 and 0.248/1.202. Byte p99.9 remains ≤ 2 levels; the 68 strictly passing lens cases retain mean ≤ 0.1 levels. |
| 1520-pixel GPU render / CPU reference stages | 0.291–5.054 s / 0.338–2.470 s | MacBook Neo; pooled full baseline and affected repeats, differing lens reaches and cold/warm work; not action-to-screen or a speed comparison. |
| 2400-pixel GPU render / CPU reference stages | 0.217–3.873 s / 1.172–8.798 s | MacBook Neo; pooled full baseline and affected repeats, differing lens reaches and cold/warm work; not action-to-screen or a speed comparison. |
| SDR Velvia caps | Accuracy result | MacBook Neo calibration; mean ≤ 0.125 / p99.9 ≤ 1.065. Same fixed caps on PC and Mac; PC confirmed November 14 (Velvia mean 0.074 / p99.9 0.989; all 128 full lens and 8 quick cases pass). |
| Final live quick lens set | 40.2 s | MacBook Neo; 8/8 pass the fixed caps with native Apple Metal, requested dimensions and opaque coverage; same eight cases also measured three times in calibration. |
| Final live Velvia case | 51.8 s | MacBook Neo; 2/2 pass: HDR remains on its byte gate; SDR uses the fixed full-pixel caps. Native Apple Metal, no software fallback. |
| Default Library first picture / coverage at 90 s | 0.6 s / 6 of 33 | MacBook Neo; same current branch, plain Electron, shared lock; system-reserve warning and incomplete coverage. Separate existing Library limitation, not parity acceptance; no investigation or rerun. |
| Final Node fast suite | 13.5 s | MacBook Neo; 957 passed, one skipped, no failures; includes full-pixel comparator, exact case selection and numeric caps. |
| Final Python fast suite, quiet full rerun | 219.4 s | MacBook Neo; 3,313 passed, 145 skipped, one xpassed; GPU lock excludes competing GPU memory. |

The first two lens measurements were followed by a hold for the priority
Exposure/Denoise and HSL checks; long repeats do not hold one lock across
multiple drivers. The first concurrent Python run hit 11 native-Library
memory-admission failures under GPU pressure; no test or memory budget was
changed. The quiet full rerun, protected from concurrent GPU work with the same shared lock, passes all 3,313 tests (145 skipped, one xpassed) in 219.4 s; the initial contention run took 362.7 s.
Evidence: `codebase/output/parity-limits/` (`lens-three.json`, `film-three.json`,
`gate-replay.json`, per-run logs and final validation reports). Scratch output ends at 6.2 GB (100 GB limit). All generated
pixel scratch is removed; the reports are small. Initial preparation checks
also passed (Node 955/one skipped, Python 3,305/153 skipped/one xpassed,
13.6 s and 298.1 s respectively, before private-media links were ready).
November 14 curated-photo input verification (`tests/one-photo-folder`, commit
containing this record): **MacBook Neo**, A18 Pro, 8 GB unified memory,
1408x794-point window, unpackaged Electron, shared GPU lock. The retargeted
`library-gpu-raw-paste.js` uses `DSC06615.ARW` instead of `DSC07072.ARW`.
Cold CPU preparation was **7.405 s**, GPU-prepared source reuse **0.027 s**
(three concurrent requests; unchanged paste wrote no sidecar). This is a
single diagnostic run with a different photo, not a new controlled speed
baseline or a comparison with PC timings. No performance change is claimed.
Result: `codebase/output/library-gpu-raw-paste/1794632531948/result.json`.

## November 14: stacked RAW 100% edit investigation

Machine: **MacBook Neo**, Apple A18 Pro, 8 GB unified RAM, 6 cores,
1408x794-point unpackaged Electron, shared GPU lock. Source is the reusable
42 MP Sony `DSC00264.ARW` test copy, with Steve's saved stacked Film grade
from the 10:11 sidecar. Final baseline is plain base `9d1ac847` (only a
test-photo document added since `3cee977b`, no production change). Fixed code
is P1-B `bbd6978d` plus the picker-only fix `18f826e8`; neither this fix nor
the driver changes image processing. Existing proposed Grade timing
variation is 10%. These are diagnostic observations, not a claimed speed
improvement or a new timing allowance. No rerun was made to chase a number.

| Action | Observed wait | Conditions / result |
| --- | --- | --- |
| Base Exposure at Fit | 0.032–0.985 s | MacBook Neo; two programmed input/change edits to exact frame acceptance; first exploratory driver, not native input or a compositor stopwatch |
| Base Exposure at 100% | 1.849–2.175 s | MacBook Neo; same edits, exact current-generation Tiled/WebGPU acceptance; no hang; moderate Chromium pressure notification during run |

The final registered driver includes native input, a visible-photo pixel
check and two animation frames before ending each wait. Both final runs
retain the exact copied Film settings. Times include the programmed native
drag itself, not just its release. They must not be compared with the
exploratory acceptance-only clock above as a speedup.

| Action | Plain base | Fixed P1-B | Conditions / result |
| --- | --- | --- | --- |
| Native Exposure, Fit, Pick armed | 0.988 s | 0.454 s | MacBook Neo; six-step native pointer drag; actual Exposure and visible photo change; subsequent programmed Fit edit 0.054 / 0.066 s |
| Native Exposure, 100%, Pick armed | Input swallowed; no edit or photo change | 3.709 s | MacBook Neo; control is inside oversized canvas/pane bounds but outside dropzone clip; base's 0.274 s failure observation is not a render completion |
| Programmed Exposure, 100%, fixed code | Not repeated in final base run | 2.031 s | MacBook Neo; bypasses native input interception; earlier base programmed edits above already complete |
| Denoise enabled at 100%, then three newer Exposure edits | 3.351 s | 2.885 s | MacBook Neo; latest value 0.75, Ready, 135 reconstructed tiles, current exact frame, no CPU preview fallback |
| Self-contained release fixture: native Fit / native 100% / programmed 100% / Denoise plus newer edits | Not a paired baseline | 0.418 / 2.846 / 1.938 / 2.515 s | MacBook Neo; same representative Film settings, default RAW import rather than the copied saved grade; programmed Fit 0.055 s; all checks pass |

Native failures are attributed to the inherited picker trap, not to the GPU
or a memory wait. Film-heavy 100% rendering still takes seconds and Steve
should judge that remaining wait before more speed work. No own fast suite
overlapped the final native runs; other agents were active on the machine.
The default 90-second Library smoke remains unrelated and failing: first
picture 0.5 s, six of 33 pictures and system-reserve refusal (not a new timing
baseline).

Evidence: `codebase/output/denoise-100-repro/{base,base-final,p1b,default}.json` and
their backend/run logs; original log/grade excerpts in that folder;
`codebase/output/quick-library-check/denoise-100/report.json`.

November 14 Mac GPU parity diagnostics (`fix/mac-gpu-parity`, commit containing
this record, base `87b91385`): **MacBook Neo**, Apple A18 Pro, 8 GB unified RAM,
6 cores, 1408x794-point window setting, unpackaged Electron, shared GPU lock. Test-only changes;
no performance improvement is claimed. Fast suites and other agents' CPU work
overlapped portions of the captures, so these are not controlled baselines and
are not compared with PC numbers or judged against the 5% timing tolerance.

| Diagnostic action | Observed range | Conditions / result |
| --- | --- | --- |
| Lens matrix, 1520-pixel explicit GPU render / CPU reference | 0.292–4.991 s / 0.481–1.863 s | 64 cases, full matrix; stages only, not action-to-screen; includes different lens reaches and cold pipeline work |
| Lens matrix, 2400-pixel explicit GPU render / CPU reference | 0.219–3.336 s / 1.730–4.158 s | 64 cases, full matrix; same caveats; 68/128 strict parity passes overall, unchanged from supplied base |
| Strongest-glow quick matrix, 1520-pixel GPU render / CPU reference | 2.172–3.464 s / 0.400–1.693 s | Eight cases; 0/8 strict byte gates; not a speed comparison with full-matrix cases |
| Tiled admission fixture, explicit GPU render | 0.033 s | Six tiles, four per batch, three submissions; correct complete generation and CPU scope; renderer stage only, scope wait not timed |
| Default Library, first picture / coverage after 90 s | 0.5 s / six of 33 | Same Mac and final test-only change; ten pictures never reached; no memory or responsiveness-limit violation; existing incomplete-coverage failure, not a controlled speed comparison |

Evidence: `codebase/output/macparity-final-full.log`,
`macparity-final-quick.log`, `macparity-final-scope.log`, and
`codebase/output/quick-library-check/macparity/report.json`. Whole action-to-screen
timings were not measured in the parity diagnostics; the Library first-picture
time is the separate plain-Electron smoke observation.
## November 14: Mac HSL picker and visible-area selection

MacBook Neo, Apple A18 Pro, 8 GB; built-in Retina display, 1408x794-point
unpackaged Electron, measured devicePixelRatio 2, exclusive shared GPU lock.
CPU suites run separately from these measurements. Same cached DSC00264.ARW
and machine before/after; plain grade and Steve's exact saved stacked grade
(Film and Denoise equality guards; saved Denoise is off in both renditions).
Ordinary source opening uses temporary same-volume hardlinks and copied
settings, never per-run RAW copies or writes to Steve's files.

Base is `bbd6978d` plus the isolated picker fix `e7b5fae9`. The Before run
re-registers the old `bbd6978d` picker and disables viewport cropping; its
backend still uses the full-frame P1-B CPU selection/PNG route. After is the
visible-area implementation in this commit, including lossless fast PNG
compression and avoiding a redundant Global proxy lookup. All 40 selection
recipes match between runs. Existing 10% timing band and <1 s warm target
are unchanged. Each value below is the median of three warm toggles,
including request, image decode and two animation frames, not GPU kernel time.

| Grade / rendition / zoom | Before | After | Result |
| --- | --- | --- | --- |
| Plain / HDR / Fit | 0.372 s | 0.271 s | <1 s passes |
| Plain / HDR / 100% | 0.470 s | 0.071 s | 85% faster; <1 s passes |
| Plain / SDR / Fit | 0.936 s | 0.731 s | <1 s passes |
| Plain / SDR / 100% | 1.006 s | 0.549 s | 45% faster; <1 s passes |
| Steve stacked / HDR / Fit | 0.512 s | 0.289 s | <1 s passes |
| Steve stacked / HDR / 100% | 0.636 s | 0.056 s | 91% faster; <1 s passes |
| Steve stacked / SDR / Fit | 1.024 s | 0.786 s | <1 s passes |
| Steve stacked / SDR / 100% | 1.201 s | 0.568 s | 53% faster; <1 s passes |

Every warm After toggle is below 1 s, not just its median. Warm 100% mask
preparation + selection + PNG drops from 0.363–0.575 s to 0.009–0.024 s.
The old path worked on all 1068x1600 proxy pixels even at 100%; the new
overlay is about 330x176 pixels plus the full working halo. No GPU readback
or full-native-size HSL mask is involved. Remaining SDR stage-input work is
about 0.48–0.61 s; it is not removed or replaced with approximate pixels.
The separate range edit at 100% drops from 0.468–0.665 s to 0.049 s in HDR,
and 0.984–1.062 s to 0.501–0.614 s in SDR (plain/stacked cases).

First shows are not the warm acceptance test: plain HDR Fit still takes
1.615 s; first SDR 100% shows take 1.076–1.187 s. These are first toggles
in the driver, not cold-OS or cold-disk measurements. No instant-first-show
claim is made. All native on-photo picks apply the returned hue and their
requests match the actual pointer's normalized CSS coordinates at 2x. The
old picker traps native control presses at 100% in both grades/renditions;
the fixed picker traps none. Evidence:
`codebase/output/performance/hsl-mac/{before,after}.json`, produced by
`codebase/tests/performance/hsl-picker-speed.js`.

Required Library smoke, same MacBook Neo, November 14, working tree on
`e7b5fae9`, 1408x794 points, plain Electron without CDP, exclusive GPU lock,
33-file mixed fixture, 90 s: first picture 0.5 s; 6/33 eligible pictures
shown. Failure retained: incomplete coverage and the system-reserve memory
flag (app-sampled peak 3.507 GB). This is not a Library speed-gain or complete
minimum-machine qualification claim; no unrelated rerun or memory-limit
change. Evidence: `codebase/output/quick-library-check/hsl-mac/report.json`.

## November 14: P1-B Grade, paired MacBook checks

MacBook Neo, Apple A18 Pro, 8 GB unified RAM; 1408x794-point unpackaged
Electron under the shared GPU lock; no overlapping suites. Baseline
`87b91385`, production `f542c0a8`; November 14 strict follow-up has test-only
launcher/capture repairs and no production edits. Reusable synthetic
`codebase/output/test-photos/grade-24mp.tiff`, not a real RAW. Grade timing
tolerance: 10% (proposal); PC results remain separate. Show selection includes
request, overlay decode and two animation frames. Evidence:
`codebase/output/performance/p1b/{before,after}.json`; final clean pass
`codebase/output/performance/p1bv/final-timing.json`. Diagnostic trace is
separate from paired timings; the After column now records final code.

| Action | Before | After | Conditions / result |
| --- | --- | --- | --- |
| SDR Show selection, warm Fit | 0.684–0.700 s | 0.783–0.798 s | MacBook; three warm show/hide cycles; <1 s passes, outside prior 10% band; Steve to try |
| SDR Show selection, warm 100% | 0.766–0.799 s | 0.899–1.079 s | MacBook; same bounded 1600-pixel CPU overlay; one of three misses <1 s; outside prior 10% band |
| SDR selection range edit, Fit / 100% | 0.746 / 0.765 s | 0.863 / 0.934 s | MacBook; edge feather edit, pre-HSL pixels reused; outside prior 10% band |
| SDR first show, Fit / 100% | 1.235 / 1.049 s | 1.455 / 1.465 s | MacBook; first call at each zoom, not the warm acceptance; outside prior 10% band |
| Film Stock Color drag | 1.80 frames/s | 16.96 frames/s | MacBook; SDR Fit; displayed frames during 150 programmed input events; exact release; below 20 frames/s |
| Film Print Contrast drag | 0.25 frames/s | 7.41 frames/s | MacBook; SDR Fit; exact release; below 20 frames/s; >10% below earlier 8.35, unexplained; Steve to try |
| Film Grain Amount drag | 1.80 frames/s | 16.85 frames/s | MacBook; SDR Fit; same driver; exact release; below 20 frames/s |
| Film lens Strength drag | 0.86 frames/s | 12.42 frames/s | MacBook; SDR Fit; same driver; exact release; below 20 frames/s |
| First Exposure after idle Denoise | 27.7–36.1 ms | 35.5–44.6 ms | MacBook; synthetic scene, three observations after anchor work finishes; does not exercise an edit racing the anchor; unexplained change exceeds 10%, Steve to try before another run |

Film rows measure the whole event-to-presentation throughput, not GPU kernel
time or native pointer input. Earlier paired implementation rates were 17.28 /
8.35 / 17.40 / 13.12 frames/s; diagnostic-only trace rates were 17.55 / 8.42 /
17.05 / 13.66. Final Stock, Grain and lens are within the agreed 10% of their
paired implementation values, so no investigation is warranted. Final Print
and HSL are outside it, unexplained; no repeat timing run was made, per the
responsiveness rule. The final pass follows the conservative withdrawal of
tiled approximation and preview-glow lifetime fixes. Denoise was explicitly
excluded (`--skip-denoise`) to avoid chasing its already-recorded unexplained
movement before Steve tries the app. No Denoise scheduler change was made.
P1-B stays partial: no 20 fps or final HSL speed acceptance. The Grade and Film
Look PRDs hold the validation ledger and Decisions for Steve.

November 16 solid Tone clipping-view validation: default 90 s quick Library
check, MacBook Neo / A18 Pro / 8 GB, 1408x794-point plain Electron through the
shared GPU lock, default mixed 33-photo fixture, Steve's app left open and
parallel workers active. Head before the implementation commit: `ab0645be`
plus the solid-view changes. First picture 0.5 s; 9/33 by 90 s, ten never.
Failed with `Whole-app memory: system reserve`; not a speed acceptance or an
isolated comparison. No repeat timing run or Library changes. Evidence:
`codebase/output/quick-library-check/clipping-view/report.json`.

November 14 P1-B validation's default 90 s quick Library check: **MacBook**
Neo / A18 Pro / 8 GB, 1408x794-point plain unpackaged Electron, GPU lock,
default mixed 33-photo fixture, no overlapping tests. Branch `f542c0a8` plus
test-only validation repairs: first picture 2.0 s, 6/33 by 90 s, ten never.
Base `87b91385`: first 2.8 s, same 6/33 by 90 s, ten never. Both exit for
incomplete coverage; neither reports a memory violation. This is an existing
minimum-machine Library qualification gap, not a P1-B speed or complete
Library pass. Evidence: `codebase/output/performance/p1bv/quick-library.json`
and `quick-library-base.json`; no speed-gain claim from these single observations.

November 14 macOS file-command smoke (working tree based on `696a3fd6`,
`p1/mac-file-commands`; MacBook Neo, A18 Pro, 8 GB, 6 cores; 1408x794 points;
unpackaged plain Electron under the shared GPU lock; disposable synthetic
96x128 scene-linear Rec.2020 EXR, not a real-photo workload): first picture
0.7 s; 1/1 eligible pictures shown; 5,400 frames over 90 s, no recorded frame
gap or timer block above the harness thresholds, no memory violation. Independent
app peak 0.731 GB. Observation only, not a speed comparison or whole-folder RAW
qualification; existing tolerances unchanged. The initial SDR-PNG fixture was
ineligible under normal Library filters and was replaced, not treated as a pass.
Evidence: `codebase/output/quick-library-check/filecmd-mac/report.json`.

November 13–14 P1-C safety validation (Edge safety `1d64ab23`; Library safety
committed with this follow-up; MacBook Neo, A18 Pro, 8 GB unified RAM, 6 cores; 1408x794 points;
unpackaged Electron under the shared GPU lock; other agents' fast suites
running, uncontrolled headroom). Observations only, not a speed comparison:

| Action | Observed | Conditions / result |
| --- | --- | --- |
| Synthetic Edge-colour GPU kernel, 400x400 | 0.147–0.508 s | Expand 0, 0.5, 3; existing parity passes; kernel time only, not action-to-screen |
| DSC00264.ARW Grade first frame, CPU / GPU | 21.300 / 24.567 s | One observation each; GPU Edge reconstruction clean; concurrent work, no speed claim |
| DSC00264.ARW Library GPU scene | 9.667 s | Clean Edge-colour result; existing source development route |
| IMG_3129.CR2 Grade first frame, CPU / GPU | 11.173 / 9.337 s | One observation each; GPU Edge reconstruction clean; concurrent work, no speed claim |
| IMG_3129.CR2 Library GPU scene | 22.117 s | Clean Edge-colour result; existing source development route |
| Both RAWs, export / Proof | Pass, not timed separately | GPU full-source admission refuses 3.41 / 1.60 GiB with 0.00 GiB safely available; CPU fallback finishes; existing perceptual, byte-identity and decoded-ceiling checks pass |
| Synthetic unsupported Library source, CPU fallback | 0.180 s | `library-gpu-recovery.js`; one CPU development; cached reopening reuses its result |
| Default mixed Library, first / ten pictures | 0.500 s / never by 90 s | 2/33 shown; no completed scene development, app error or memory-limit violation; existing admission stall, not a progress acceptance pass; no own fast suite running during this capture |
| Additional real-app Edge input-rejection fallback check | No completed scenario; stopped at about 7 min | `library-temporary-recovery.js --invalid-input`; deliberate renderer shutdown to end stalled check and run cleanup; not a completed action time or performance baseline |

Evidence: `codebase/output/p1c-edge-kernel.log`,
`codebase/output/p1c-edge-delivery.log`,
`codebase/output/p1c-edge-cpu-fallback.log`,
`codebase/output/quick-library-check/p1c-gpu-safety/report.json`. PC values elsewhere remain separate
baselines; these runs do not judge a timing regression.
November 14 guarded macOS available-memory correction (working tree on
`fix/macos-available-memory`, parent `10eb390d`; app code unchanged after
capture): **MacBook** Neo, Apple A18 Pro, 8 GB unified memory, 6 cores;
1408x794-point plain Electron; shared 33-photo mixed fixture; **other agents
running**, with this task's full Python suite also running throughout the
90-second observation. The existing quick-check scenario selects a 4 GB
app ceiling after launching at the default 2.5 GB; no setting or budget
changed in this fix. First picture **0.6 s**, ten never, **6/33 shown by
90 s**; both DJI 8000x6000 DNGs now develop without photo-work errors.
The check still **fails system reserve**: 22/386 independent samples have
1.192–1.770 GB available against the unchanged 2 GB reserve, through the
conservative fallback rather than the normal-pressure percentage. App peak
3.618 GB; longest frame gap 167 ms passes the 250 ms limit. This is not a
default-ceiling acceptance or a controlled speed comparison: the existing
5% whole-wait tolerance cannot turn differing load/ceiling conditions into
a speedup claim. Steve should try Library before another timing run.
Evidence: `codebase/output/quick-library-check/fixmem/report.json`,
`backend.log`, `memory.jsonl`; full fast suites and the exact-pixel Retouch
interaction check pass (logs in the same folder).

November 14 P1-A unrelated-mark acceptance (`p1a/library`, same MacBook
conditions as the quick-check observation below; other agents running):
deterministic backend tests hold rename hashing or cache work behind an event
while the actual settings writer runs. In both cases the unrelated rating is
acknowledged within 250 ms and its sidecar contains the new rating within
1 s, before the blocked file work is released. These are threshold assertions,
not a native macOS or physical slow-storage timing baseline. Real Mac
rename/move/delete were refused in that P1-A observation; the November 14 native
Mac file-command port supersedes the refusal, not the timing baseline. Their
whole-command completion time is still unqualified. PC native/recovery and
slow-storage qualification remains required. No tolerance was relaxed.

November 14 P1-A drawing/cache work (working tree based on `10eb390d`,
`p1a/library`; MacBook, Apple A18 Pro, 8 GB; other agents running;
1408x794 points; locked plain Electron; existing reserve and allowances):
the initial 90-second quick check showed 2/33 photos, first picture 0.8 s,
maximum recorded frame gap 117 ms, no timer block, app peak 0.818 GB and no
memory violation. That old harness exited successfully despite incomplete
coverage and had no explicit visibility evidence: not gap qualification.
After the changes, the two 90-second observations gave first picture
0.3–0.5 s, still only 2/33 photos; 5,400 animation frames, no recorded frame
gap of 50 ms or more, no timer block, app peak 0.779–0.792 GB and no memory
violation. The latest run (`3c6033e1` plus native visibility instrumentation)
confirms both document visibility and no native hide/minimise events throughout;
the corrected harness exits unsuccessfully for incomplete coverage. In the
earlier observation both 48 MP DJI DNGs reported insufficient safely available
memory; the latest leaves developments waiting without a photo-error result.
No admission limits were changed. No controlled speed comparison is claimed;
the PC's 1–3 s gap was not reproduced on the Mac; confirm on the PC at the
release point. The unchanged drawing-gap tolerance is 250 ms; incomplete
coverage prevents whole-folder acceptance. Local evidence retained:
`codebase/output/quick-library-check/p1a-before/report.json` and
`codebase/output/quick-library-check/p1a-after/report.json`.


November 13 P1-E fresh-worktree tooling smoke (`98a88b2a`; MacBook Neo,
Apple A18 Pro, 8 GB, 6 cores; 1408x794 points; setup-only worktree with spaces
in its path; plain Electron through the in-repo lock; fast suites finished):
first picture 3.2 s; 7 of 33 shown by 90 s; ten never. Longest frame gap 216 ms
is inside the unchanged 250 ms limit; no memory-limit violation. The two
8000x6000 DJI DNGs were refused because available system memory could not be
measured, the existing Step 0 Mac gap; most other developments waited. This
checks tooling, not a controlled speed comparison or completed Library
acceptance. Evidence: `codebase/output/p1e-tooling/library-report.json`.

November 13 minimum-hardware fix (`2202eddd`, app code identical during capture):
MacBook, Apple A18 Pro, 8 GB unified memory, 6 cores; 1408x794-point plain
Electron window; default 2.5 GB app ceiling; shared main-checkout 33-photo mixed
fixture via `--folder=library-mixed-v1-run`; no concurrent fast suite from this
task during the Library run, other system work not controlled. First picture
1.7 s, ten never, 2/33 shown by 90 s. No unknown-memory refusals or repeated
DNG failures; heavy work stays queued at system reserve (1.982–2.504 GB
available, unchanged 2 GB reserve), so development/decode/GPU times are not
measurable in this run. Independent app peak 0.833 GB, sparse app-log peak
0.625 GB; five reserve-breach samples make this a failed memory check.
Not a speed comparison with the older Mac or PC observations. Proposal before
measurement: 5% tolerance for Mac whole waits; changed headroom prevents a
speedup claim. Evidence: `codebase/output/quick-library-check/minimum-hardware/`.
The initial default command failed fixture discovery from the worktree;
protected tooling was not edited.

November 13 review of the earlier MacBook `ef29f60e` step-0 log: the 32 refused
DNG grants hold work for a summed 4.078 s (overlapping, not a whole-screen
wait). The completed TIFF source records 0.992 s decode and 0.730 s GPU;
those are stage observations, not a screen-time benchmark. Remaining waits
are admission, so no slow-decoder conclusion or estimate change follows.
Evidence: main checkout `codebase/output/quick-library-check/mac-step0/backend.log`.


November 13 first MacBook quick Library check (MacBook, Apple A18 Pro, 8 GB unified memory, 6 cores; `ef29f60e` plus Mac set-up fixes; 1408x794-point window, the largest the built-in screen gives; default mixed Library): first picture 0.5 s, ten never; 7 of 33 shown by 90 s; peak 0.989 GB; no memory violation. New Mac baseline, not compared with PC rows. Developments wait for room under the 8 GB memory ceiling (estimates 1.2–1.5 GB each), and both DJI 8000x6000 DNGs are refused because macOS available memory cannot be measured (no psutil; `SC_AVPHYS_PAGES` is missing on macOS). Evidence: `codebase/output/quick-library-check/mac-step0/report.json`.

November 13 page-hints UI smoke (working tree, parent `3f298547`, plain Electron, default mixed Library, Python finished): first/ten/twenty pictures 1.0/2.5/6.7 s; 29 of 33 shown by 90 s. No application errors or memory violations; responsiveness failed with one 1758 ms frame gap (250 ms limit). Cause unexplained; Steve should try Library before another timing run. Evidence: `codebase/output/quick-library-check/status-hints/report.json`.

November 13 status-bar UI smoke (working tree, parent `8d5706ec`, 2560x1440 plain Electron, default mixed Library, sequential validation): first/ten/twenty pictures 1.2/4.2/8.0 s; 29 of 33 shown by 90 s. No application errors, memory violations or responsiveness-limit failures. This UI smoke is not a controlled speed comparison. Evidence: `codebase/output/quick-library-check/status-bar/report.json`.


November 12 watermark/Library polish smoke (parent `b2ce850d`, branch
`feat/watermark-and-library-polish`, 2560x1440 plain Electron, default mixed
Library, concurrent full Python suite): first/ten/twenty pictures 4.4/5.0/25.8 s;
29 of 33 shown by 90 s; sampled peak 3.035 GB. No application errors or memory
violations; existing responsiveness limits fail at 649 ms drawing gap and
670 ms main-thread block. This is a smoke observation under concurrent load,
not an isolated comparison. Evidence:
`codebase/output/quick-library-check/watermark-library-polish/report.json`.
The GPU delivery smoke's original 72px Denoise fixture export took 7.10 s;
this tiny fixture/encoding check is not a photo export speed benchmark.


How long each action in HDR Finisher takes, against its target. Use it to
choose performance work, and to spot regressions: a new measurement well
outside its recorded range needs a one-line note, even when it is still
inside the target.

Started October 30, 2026 by Claude from the module PRDs and the October 30
logs. Keep it current: whenever a change, test or log review produces a
timing, update its row (range, date, commit, conditions) in the same commit.

November 12 integer SDR ICC detection smoke (parent `1eae2dcb`, plain
Electron, default mixed Library, concurrent full Python suite): first/ten/
twenty pictures 6.1/8.1/12.2 s; 29 of 33 shown by 90 s, sampled peak 2.872 GB.
No reported errors or failed photos. Concurrent test load makes this a smoke
observation, not an isolated performance comparison.
Evidence: `codebase/output/quick-library-check/icc-integer-srgb-transfer/report.json`.

November 11 W7 delivery-yield smoke check (parent `53f7ec2e`, delivery-yield change;
2560x1440 plain Electron, default mixed Library, default memory allowance):
first/ten/twenty pictures 0.8/1.6/6.3 s, 29 shown by 90 s; sampled peak
3.015 GB. The check failed its existing 250 ms drawing-gap limit (1,128 ms);
no application errors were reported. No investigation or rerun of that
unrelated responsiveness failure. This is a smoke check, not a paired speed
measurement. Evidence: `codebase/output/quick-library-check/w7-delivery-yield/report.json`.

November 11 W7 delivery checks (parent `53f7ec2e`, delivery-yield change;
2560x1440 Electron, saved DSC07060, 4000 px, JPEG 95/4:4:4/full gain map,
sharpening off): export plus full-size Proof and peak decoding took 42.862 s
on the GPU and 314.084 s forced CPU. Both pairs are byte-identical and below
800 nits. These are single validation turns, not a paired speed comparison;
the CPU turn is slower than the earlier recorded 120-second class run and
needs an ordinary user trial before any new performance investigation.
Evidence: `codebase/output/w7-gpu-delivery-ceiling.log`.
Independent GPU export/Proof/decoding turns at 3/2 GiB admission caps took
44.238-45.236 s; both pairs and both independent exports are byte-identical.
Evidence: `codebase/output/gpu-delivery-repeat/result.json`.

November 11 W15 unsupported-source recovery check (driver repair on parent
`7650661b`, 2560x1440 Electron, disposable profile and synthetic PNG): CPU
fallback preparation took 224 ms, with exactly one CPU development and no
additional development on cached reopen. This is one source-stage observation,
not a whole-screen timing or a speedup comparison. Existing 30-second test
deadline is unchanged. Evidence: `codebase/output/w15-gpu-recovery/driver.log`.

November 11 W16 JXL control-path fix (release/library-jxl-helper, rebased on
`7650661b`; 2560x1440 Electron, shared graphics lock):
`library-codec-source.js` completed all three CPU/GPU cold-source repetitions.
CPU/GPU median source waits were JXL 0.883/0.429 s, AVIF 0.625/0.327 s,
HEIC 0.641/0.335 s. These are validation observations, with the fast Python
suite also running, not a paired performance claim. JXL no longer exhausts
the helper restart limit. The driver later failed in the existing stored-source
pixel comparator (`library_rgb_compare.py:53`, missing `.npz`, StopIteration);
finished pixel parity from that driver is therefore unqualified. The Python
helper regression independently checks decoded JXL scene pixels.
Evidence: `codebase/output/w16-codec.log`.

The standard 90-second Library smoke check passed on `ecb6dd05` under the
same lock: first/ten/twenty pictures 1.2/2.0/9.4 s, 29 shown by 90 seconds,
2.885 GB sampled peak, no reported errors or failed photos. This mixed-folder
smoke observation is not a JXL speed baseline. Report:
`codebase/output/quick-library-check/w16-jxl-helper/report.json`.

## How to read and update it

November 11 W14 scroll-cache driver repair (parent `790b4a4d`, Electron,
2560x1440, disposable profile, Steve's badminton folder read-only): returning
four screens to the top reused 20 visible tiles in 12.4 ms, with zero backend
picture requests, zero redevelopment and exact displayed pixels. This is one
bounded cache check, not a speed comparison. Earlier diagnostic returns were
11.3 and 178.5 ms while capture-time metadata was still changing grid order;
the reproduced failure moved the original first photo to index 44. The driver
now waits for the complete list and uses filename order. No app timing or
cache allowance changed. Evidence: `codebase/output/w14-scroll-cache/`.

* **Target:** an agreed target (with who agreed it and when) or
  "proposed". Only Steve agrees targets.
* **Measured:** a range (p50 to max, or min to max), never a single best
  run. Timings vary run to run; judge them against the target and the range
  (AGENTS.md, "Work within tolerances").
* **Conditions:** what was measured. Cold means never prepared. Warm means
  stored pictures existed. It also gives the folder, the commit, and
  Steve's machine or a disposable copy. Steve's photos are on D:, a
  removable exFAT drive, so file reads are slower than an internal SSD.
* **Status:** Met, Not met, Unknown (no target or no recent measurement),
  or Baseline (a regression reference with no target).
* **Sources:** Steve's runs, read from
  `%APPDATA%\hdr-finisher-desktop\logs\backend.log` with
  `codebase/tools/summarize_library_log.py --since "YYYY-MM-DD HH:MM"`;
  scripted runs (for example `codebase/tools/measure-library-cold-mixed.cjs`);
  the dated PRD entries named in each row.
* Stage names in the logs (`page_picture_*`, `picture_*`, `startup_phase`)
  are given so the next measurement can be found quickly.

November 11 W8 backend audit smoke (`6a932355`; 2560x1440 plain
Electron, reused mixed Library fixture, default 90-second check): no photo
errors, unreadable stored pictures, zeroed channels or memory violations.
Drawing cadence fails: largest frame gap 1,425 ms against the unchanged
250 ms limit; largest timer block 81 ms. The existing drawing-gap failure
category is unchanged; this is a smoke check, not a paired speed baseline.
Evidence: `codebase/output/quick-library-check/w8-backend-deep/report.json`.

November 11 W2 Grade audit smoke check (`1b3ca447`; 2560x1440 plain
Electron, default mixed Library, concurrent fast Python suites): first/ten/
twenty pictures at 2.8/3.5/11.8 s, 29 shown by 90 s; peak RAM 2.823 GB.
No photo errors or zeroed channels. Existing drawing-gap failure repeated:
1,684 ms against the unchanged 250 ms limit. This smoke run is not a
comparable speed baseline. Evidence:
`codebase/output/quick-library-check/w2-audit-grade/report.json`.

November 10 dark-theme/Settings smoke check (parent aa9b6128, working tree;
2560x1440 plain Electron, default mixed Library, concurrent Python suite):
first/ten/twenty pictures 9.1/15.0/18.2 s, 29 shown by 90 s. No reported
check errors. This is a UI smoke check, not a comparable speed baseline.
Evidence: `codebase/output/quick-library-check/theme-settings/report.json`.

November 10 softer-button/text follow-up (parent 3b24e344, working tree;
2560x1440 plain Electron, default mixed Library, concurrent Python suite):
first/ten/twenty pictures 14.9/15.5/21.9 s, 29 shown by 90 s.
No reported check errors. UI smoke check, not a comparable speed baseline.
Evidence: `codebase/output/quick-library-check/theme-soften/report.json`.

## November 11: Smart Album timeout investigation

Latest real session (10:33:58-10:44:04 Bangkok, after `1782b749`) has seven
memory-controller timeouts during Smart Album candidate rebuilds. Associated
marks-lock holds are 8.094-9.328 s; recorded backend loop lag reaches 2.773 s.
The completed sample before the first timeout is 2.743 GB, no OS pressure.
This is log correlation, not a whole-action speed measurement. The follow-up
moves preparation outside the marks lock and bounds JSON encoding; no speedup
claim or changed timing/memory tolerance. Validation results follow below.

Follow-up validation (working tree based on `1782b749`, 2560x1440 Electron,
concurrent full Python suite): 155,000-row editor opens in 8.8 ms / 1.9 ms warm,
rule recount 180.7 ms and page timer gap 11 ms. A same-server HTTP heartbeat
runs throughout the large-index workflow with the existing 2 s abort deadline;
none times out. This validates backend responsiveness during candidate work,
not real-library click-to-grid speed. Normal 90-second mixed Library smoke:
first/ten/twenty pictures 4.1/5.9/11.5 s, 29 shown, no reported errors or
memory breach; largest frame gap 140 ms passes the existing 250 ms limit.
Whole-app memory settles under the existing target. No speedup claim from
these non-isolated smoke timings. Evidence: `codebase/output/memory-controller-smart-electron.log`
and `codebase/output/quick-library-check/memory-controller/report.json`.

Steve's real-app log at `%APPDATA%/hdr-finisher-desktop/logs/backend.log`
(November 11, Bangkok time; running commit not identified) records candidate
marks-lock holds of 9.031-11.657 s at 09:04:42 and 09:05:07, and backend
heartbeat lag of 9.930-10.663 s immediately afterwards. Ten memory-controller
HTTP requests time out during these two intervals against their existing
2 s deadline. Nearby completed memory samples show 2.95-3.41 GB, no pressure
and no waiting admission. This establishes stalled backend service, not a
memory-budget shortage; the exact executing stack during the later loop lag
was not captured. Click-to-grid time is not recorded, so the candidate lock
timing must not be presented as the whole opening wait. Regression tolerance
for comparable whole waits remains the existing 5%; no memory or timing
limits are changed by this investigation.

November 11 Smart Album checks (working tree based on `74f2f29c`,
2560x1440 Electron; concurrent full Python suite): real 155,000-row editor
opens in 26.7 ms cold / 2 ms warm, rule recount 190.9 ms and largest page
timer gap 11 ms. These measure editor responsiveness, not album click-to-grid.
Smart Album workflow passes, including marks joining/leaving and Undo.
Default 90-second mixed Library smoke: first/ten/twenty pictures 1.7/4.3/10.2 s,
29 pictured by the end; no photo errors or memory breach, independent process
peak 3.419 GB. One 1.558 s frame gap fails the unchanged 250 ms limit (timer
block 59 ms, no recorded long tasks). No rerun or responsiveness repair;
Steve's normal-use check remains the next step. Evidence:
`codebase/output/smart-album-electron.log` and
`codebase/output/quick-library-check/smart-album/report.json`.

Final Smart Album persisted-grid check (same working-tree base and concurrent
Python suite): 155,000-row editor opens in 8.9-10.6 ms / 1.7-1.8 ms warm, recount
170.8-180.5 ms, timer gap 10.7-11.1 ms. Fresh controller restores 15,500 saved matches
with worker construction forbidden; this validates indexed-first behavior,
not a real-library click-to-grid timing. Original stress harness was updated
to route the new grid API and expect matched saved rows instead of shared
all-library array identity. Evidence:
`codebase/output/smart-album-final-electron.log`.

## 1. Startup

| Action (from → to) | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Launch → window visible | Proposed: under 0.5 s | 0.33 s | Oct 30 18:18, Steve's machine, 1c0d45a | Met |
| Launch → backend ready | — | 1.93 s (backend imports 1.40 s) | same | Baseline |
| Launch → page ready | — | 2.83 s | same | Baseline |
| Launch → helper ready | — | 3.54 s | same | Baseline |
| Launch → first folder listed | — | 3.06 s | same | Baseline |
| Launch → first finished thumbnail | — | 8.19 s | same, first folder had no stored pictures | Baseline |
| Startup cache reconciliation (background) | Proposed: must never delay visible work | 31.4 s | same (`startup_phase cache_reconciliation`) | Unknown |
| All startup upkeep (background) | as above | 75.6 s | same (`startup_upkeep_finished`) | Unknown |
| Large-library launch (155,879 indexed): backend / page / thumbnails | Open | 2.45 / 3.99 / 12.14 s | Oct 26, disposable launch (photo-library.md, App startup) | Baseline |

## 2. Opening folders and the grid

November 10 sidebar/JXL integration smoke (working tree based on `9d281d14`,
2560x1440 plain Electron, disposable profile, default 50-photo mixed fixture,
no concurrent tests): first picture 0.9 s, ten 2.5 s, twenty 7.3 s. One
1.237-second frame gap fails the unchanged 250 ms responsiveness limit;
longest timer block 107 ms, no photo errors or memory breach, peak 2.870 GB.
Single observation, no speedup claim or new budget; Steve judges normal use
before more timing work. `codebase/output/quick-library-check/jxl-fixes/report.json`.

November 10 log review supersedes the foreground-freeze interpretation of the
Pro Max smoke below: its 10,396 ms gap occurred 11:02:07-11:02:17 in idle
observation, roughly 44 s after detail. Regular one-second timer cadence,
no long tasks and continuing backend/memory samples suggest background-window
throttling. Visibility telemetry is absent, so leave the raw failure and
threshold intact; Steve reports normal responsiveness and no rerun is needed.

Actual user JXL log at 12:42:23: GPU unsupported-source rejection then one
CPU fallback (helper work 213 ms, source preparation 167 ms). Grade first frame
622 ms; Library grid navigation to picture 5.567 s included 4.489 s in the
thumbnail-cache scheduling interval. These are single descriptive log
observations from Steve's existing app, not a new timing run or speedup claim;
the logs do not prove chosen interpretation or correct colour. Conditions:
ordinary user session, hardware/window/visibility not instrumented.
Evidence: `codebase/output/review/apple-investigation/responsiveness-logs.json`.

November 10 Lee Zavitz Pro Max app check (`8eacf8ee`, 2560x1440,
90-second disposable Electron profile, concurrent CPU-only delegated checks):
all five camera pictures appear by 0.6 s. Single first open 410 ms, forward
steps 266-327 ms, return steps 74-88 ms. These are camera-picture navigation,
not five new full RAW developments. One 100% detail request draws in 4.909 s.
The run fails with a 10,396 ms drawing gap and 1,005 ms main-thread block
(limit 250 ms); no picture errors or zeroed channels, peak app 1.700 GB.
No repeat or timing investigation before Steve tries the app. Evidence:
`codebase/output/quick-library-check/apple-validation/report.json`.

November 10 ProRAW CPU recovery smoke (working tree based on `9d7d9e6a`,
2560x1440 Electron, disposable profile, concurrent Python suite): IMG_0284
source preparation was 2.208 s, then cache reopen required no CPU decode.
This is one descriptive source-stage observation, not a whole-screen timing,
new timing budget, or speedup claim. Evidence:
`codebase/output/iphone-proraw-electron.log`. Whole-screen iPhone-copy smoke: Single open/arrow to the matching screen
canvas 4.103-4.619 s across IMG_0284, IMG_0431 and IMG_1047; 100% detail
click to draw 4.516 s (one observation). All three pictures draw with no
photo errors or zeroed channels. A 2,461 ms drawing gap fails the existing
250 ms limit, while the largest timer block is 66 ms; no repeat or timing
investigation before Steve tries the app. Peak counted app 1.608 GB.
Evidence: `codebase/output/quick-library-check/iphone-proraw-detail/report.json`.

The default mixed 90-second check passes: no photo errors, no over-limit
frame gaps or main-thread blocks, peak 2.770 GB. Its first/ten/twenty-picture
observations are 5.7/8.9/14.9 s (concurrent Python suite). Evidence:
`codebase/output/quick-library-check/iphone-proraw/report.json`.

November 8 unsupported-DNG incident (pre-fix live app log, working tree
on `3b1fd4ff`): the 2021-folder log showed repeated GPU-memory
waits of roughly 30-41 s for iPhone DNGs, with 5,032,650,480 bytes requested
per job. Header-only route selection now sends known unsupported DNGs to CPU
before GPU admission. These Apple samples still reject LinearizationTable
metadata; this is a routing repair, not a faster Apple decoder.

Final-code Samsung DNG smoke (November 8, working tree on `3b1fd4ff`,
2560x1440, disposable cold profile, concurrent Python suite): CPU preparation
1.24-1.41 s across thumbnail/screen/native requests. User waits: Single input
to matching canvas 1.663 s; 100% click to detail drawn 2.307 s. These are
descriptive observations, not a new budget or a measured speedup. The check
flags a 1,265 ms drawing gap against the unchanged 250 ms limit; no timer
block or picture error, peak app 1.082 GB. The default mixed 90-second check
also timed out in observe at its 130-second deadline; not rerun.
Evidence: `codebase/output/quick-library-check/dng-cpu-detail/report.json`
and `codebase/output/quick-library-check/dng-cpu-fallback/report.json`;
CPU stage events: `codebase/output/quick-library-check/dng-cpu-detail/scenario.json`.

November 8 movable Navigate window smoke check (working tree on `034d07c0`,
default 90-second mixed grid, concurrent Python suite): drawing gap 1,576 ms
exceeds the unchanged 250 ms limit; no picture errors or memory breach
(peak 2.822 GB). This repeats the existing Library drawing-pause failure;
not investigated or rerun for this viewer interaction change.
Evidence: `codebase/output/quick-library-check/navigator-drag/report.json`.

November 8 Retouch selection / Local brush keys smoke check (working tree on
`6c6ceb34`, default 90-second mixed grid, concurrent Python suite): drawing
gap 1,922 ms exceeds the unchanged 250 ms limit; timer block 114 ms, no
picture errors or memory breach (peak 3.252 GB). This repeats the existing
Library drawing-pause failure; no repeat or investigation for this UI fix.
Evidence: `codebase/output/quick-library-check/retouch-local-brackets/report.json`.

November 6 unified-toolbar UI smoke check (`c05e6f0f`, 2560x1440,
90-second mixed grid, no concurrent fast suites): drawing gap 843 ms exceeds
the unchanged 250 ms limit; timer block 86 ms. No picture errors or memory
breach (peak 2.911 GB). The existing drawing-pause issue was not investigated
or rerun for this visual task; Steve should try browsing before more timing
work. Evidence: `codebase/output/quick-library-check/ui-polish/report.json`.

November 6 header-alignment check (parent `220e99b`, CSS working tree;
2560x1440, default 90-second mixed grid): frame gaps up to 61 ms and timer
blocks up to 53 ms, within the existing 250 ms limit; no picture errors or
memory violation. First picture 32.9 s, 25 shown by 90 s. The Python fast
suite was running concurrently, so this is a UI smoke check rather than a
comparable throughput baseline. Evidence:
`codebase/output/quick-library-check/header-alignment/report.json`.

November 4 focus/title/Export polish (parent 98ac764; 2560×1440, default
90-second mixed-grid check): maximum frame gap 1,594 ms against the 250 ms
limit, maximum timer block 142 ms. No picture errors or memory violation.
The existing frame-pause limitation remains; no repeat or investigation was
run for this visual change. Evidence:
`codebase/output/quick-library-check/focus-titles-export/report.json`.


November 4 Control Panel follow-up (parent bf22072; same 2560×1440 default
90-second mixed-grid check): maximum frame gap 1,491 ms against the 250 ms
limit; timer block 132 ms. Picture and memory checks pass. This repeats the
existing responsiveness limitation from the preceding visual pass; no repeat
or performance investigation was run. Steve should judge responsiveness when
trying the app. Evidence:
`codebase/output/quick-library-check/control-panel-fixes/report.json`.


November 4 visual-refinement check (working tree; 2560×1440, default 90-second
mixed-grid scenario): frame gaps ranged to 1,682 ms (one over 250 ms), timer
blocks to 117 ms, 29 pictures shown by 30 seconds, no picture failures and no
memory-limit violation. The frame pause is outside the responsiveness target;
no causal performance investigation or repeat run belongs to this visual pass.
Evidence: `codebase/output/quick-library-check/v1-visual-refinement/report.json`.
Steve should judge responsiveness when trying the new appearance.

Nov 2 memory fixes (`library-avif-gainmap-gpu`, `87bcb28`), cold 90 s quick
checks, default 4 GB and two developments. Play_Raw AVIF copy (22 files):
shown by 30/60 s 12/15 -> 17/22, needs-memory 7 -> 0, external peak 4.0 ->
2.63 GB, settled (never before). HDR Test Images copy: 24 by 90 s, peak
3.54 GB, settled, 0 refusals, 0 memory-check timeouts; longest frame gap
3.0-3.6 s (pre-existing). Library EXR read: longest backend stall 0.90 ->
0.04 s, decode 1.04 -> 1.06 s (`DSC01287.exr`).

Nov 1 Fuji X-Trans repair (`library-xtrans-thumbnails`, local): final guarded
Lanczos CPU scene development 640/2560 is 3.009-3.204 s warm, 3.193-3.325 s
first-use; incremental private peak 587.7 MB, approved reservation 740.413 MB.
Earlier bilinear route, cold plain 90 s grid: camera preview 1.811 s after RAF
tile request; developed presentation 37.021 s including queue. Grid 22/27 by
30/60 s, external peak 3.585 GB, longest frame gap 70 ms. Same-day ae1396a
production baseline: 22/26, 3.763 GB, 96 ms. Ten Single steps: open 2335 ms,
preview 30 ms, median 2363 ms, maximum 6184 ms; no frame gap >=50 ms.
Final filter/estimate cold grid check (`xtrans-final`): RAF preview 0.807 s,
developed 37.545 s including queue; grid 23/27 by 30/60 s, external peak
3.543 GB, longest frame gap 61 ms. No ceiling/reserve violation, settled
below target. See scheduler 7.20; Steve requested no further sweeps.

Nov 1 PNG round-trip removal (`8e5396a`), Library RGB decode edge 2560,
warm filesystem, median of three: `_DSC6510-1.png` 4176.0 -> 2875.0 ms;
`IMG_6717.PNG` 153.1 -> 27.0 ms; `pano_192mp.png` 2324.4 -> 1961.4 ms.
Decoded bytes identical in every repeat. `output/png-roundtrip-comparison.json`.


Nov 1, detached-check/freeze commits (parent `4d07bd4`), cold name-sort, 4 GB,
2560x1440, 90 s: grid frame gap 418 -> 97 ms, Single 133 -> 61 ms; timer
blocks 424 -> 105 / 150 -> 81 ms. Single open 2401 ms (preview 26), ten steps
median 2243, max 8185, prepared 12 ms. Peaks 3.941/3.391 GB. Reports:
`output/quick-library-check/{strict-before-grid,strict-before-single,transfer-final-grid,transfer-final-single}/report.json`.
Older Playwright wall times below are historical instrument-dependent values;
section 7.19 records the corrected ordering and reconciliation.


| Action (from → to) | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Library live-grid / GPU recovery | Required focused release drivers pass | Both pass: 73.899 / 7.469 s; no flaky or known-failure classification; protected hashes unchanged | Nov 1 `5f400db`; separate focused release-runner selections | Met |
| Library picture preservation | Deterministic pairs identical; otherwise mean dE2000 <1, p99.9 <=3 | 176 SDR/HDR lane pairs exact, max difference 0, all finite; 44 files x 640/2560 | `4d07bd4` picture code vs final; `output/library-freeze-pixels/comparison.json` | Pass for renderable fixtures; six existing source gates unverified |
| Grade coexistence: fresh phase0 folder | Pause <1000 ms; ordinary <5000; resume <2000; edit saved | Pause 4110/3251 ms; ordinary 4114/3256; resume 346/1408; exposure 0.125 saved twice; protected hashes unchanged | Nov 1 `8e5396a` production code; `output/grade-final-{a,b}/report.json`; unchanged Grade driver | **Pause fails both runs**; other required checks pass |
| Component-sheet mixed Library grid smoke | Existing frame-gap limit 250 ms; memory ceiling unchanged | First/ten/twenty pictures 1.2/1.9/8.9 s; frame gap 1,680 ms; peak 3.432 GB | Nov 10 `3afcdc2b`, default 90 s, concurrent Python suite; `quick-library-check/component-pass/report.json` | Frame-gap failure; GPU-invalid-pixels for DSC01226.ARW; not a speed baseline |
| Locked mixed 50: detached window responsiveness | No frame/timer interval >250 ms; diagnose frame gaps >100 ms | Grid frame gap 418 -> 91-97 ms; Single 133 -> 55-61 ms. Latest timer blocks 109/70 ms; peaks 4.108/3.476 GB, settled | Nov 1 PNG fix `8e5396a`; 90 s cold name-sort, 4 GB, 2560x1440; `quick-library-check/{strict-before-grid,strict-before-single,transfer-final-grid,transfer-final-single,png-final-grid,png-final-single}` | Met, no frame gaps above 100 ms in final runs |
| Library PNG decode: `_DSC6510-1.png` | Remove redundant round trip; unchanged pixels | Median 4176 -> 2875 ms (range after 2874-2908) | Nov 1 PNG fix `8e5396a`; edge 2560, warm filesystem, three repeats; `output/png-roundtrip-comparison.json` | 31% faster; exact bytes |
| Library PNG decode: `IMG_6717.PNG` | same | 153 -> 27 ms (27.0-27.4) | same | 82% faster; exact bytes |
| Library PNG decode: `pano_192mp.png` | same | 2324 -> 1961 ms (1953-1977) | same | 16% faster; exact bytes |
| Locked mixed 50: whole-pass GPU submission | >=16 / >=28 at 30 / 60 s; <=4.4 GB; zero ordinary reclaims | 20 shown at 30 s, 31 by 60 s (before) -> 26-27 at 30 s, 31 by 41-50 s (after); mean development GPU 1364 -> 820 ms; independent peak 4.263 GB, no reclaim | Nov 1, `b5f9bfb`, isolated cold 2560x1440, 4 GB; `output/quick-library-check/{claude-verify-c663354,passfix-b,passfix-e}/report.json`; grid pictures match at mean dE2000 0.040, p99.9 2.55 | Speed improved; 28 by 30 s not met |
| Locked mixed 50: Single input to full picture (`--single`) | Prepared <300 ms; app trace agreement about 50 ms (Nov 1 brief) | Open 2225 ms (preview 29); ten steps median 2151, max 5621; prepared 12 ms | Nov 1 PNG fix `8e5396a`; cold name-sort, 4 GB, 2560x1440; `output/quick-library-check/png-final-single/report.json`; longest frame gap 55 ms | Met for prepared steps and timing agreement; cold preparation still takes seconds |
| Locked mixed 50: memory diagnosis | >=16 shown by 30 s; >=28 by 60 s; <=4.4 GB; zero ordinary reclaims | Baseline 17–18 / 31 shown at 30 / 60 s; backend peak 4.308 GB; independent peak **4.420309 GB**; one EXR reclaim | Nov 1, unchanged `94f996d`, isolated cold 2560x1440, default 4 GB; `output/quick-library-check/memory-before{,250}/report.json`; independent median cadence 339 ms, settled <3.4 GB; scheduler 7.16 | Historical baseline: memory/reclaim failed; DNG correction since approved |
| Locked mixed 50: DNG route + EXR header gate | >=16 / >=28 at 30 / 60 s; <=4.4 GB; zero ordinary reclaims | Final repeats 20–22 / 31; independent peak 3.982–4.000 GB; settled 2.749–2.757 GB; zero reclaims | Nov 1, `b6754a2`, isolated cold 2560x1440, 4 GB; `output/quick-library-check/memory-final-{a,b}/report.json`; 250 ms observer, medians 250 / 253 ms | Met; final phase0 / Grade / release also pass |
| HDR Test Images: ordinary-wait incident | Ordinary jobs must not cause blanket reclamation | 14 developments in 75 s; visible waits up to 30 s; four reclaims | Nov 1, `9da80c9`, real session 1793504808 only; 43/111 thumbnail cache hits; corrected-driver acceptance pending in scheduler 7.15 | Regression confirmed; fix not yet qualified |
| HDR Test Images: guard follow-up cold first screen | Smooth ordinary-folder filling, no cache reclamation | **Failed**: 5 pictures by stop at 32.002 s; first screen incomplete; longest completion gap 6.981 s | Nov 1, `c9507e3`, disposable full-tree copy, isolated cold profile, 2560x1440, default 4 GB; peak 4.490 GB exceeded 4.4; zero reclaims/collections before stop, zero queued-idle interval in grant trace; no controller/probe timeouts. Warm and other slow checks deferred by Steve. Scheduler 7.15. |
| Default mixed phase0, 27: memory correction | 22 finish; <=4.4 GB, settle <3.4 GB | 22 finished; all outcomes 68.586 s; peak 4.024668 GB; settled 2.566558 GB; only permitted AVIF reclaim | Nov 1, `b6754a2`, 4 GB, 2560x1440, 250 ms observer; `output/cold-mixed/memory-final-phase0/report.json` | Met |
| Grade line scan: memory correction pause / ordinary / resume | Pause <1 s; ordinary <5 s; resume <2 s | 0.919 / 0.926 / 0.748 s; close/save 0.244 s | Nov 1, `b6754a2`, `output/phase3a-grade/report.json`; exposure 0.125 saved; protected projects unchanged | Met |
| Default mixed phase0, 27: Decision 21 | 22 finish; four interpretation/X-Trans reasons; AVIF memory notice | 22 finished; all 27 outcomes by 49.131 s; last thumbnail 48.424 s | Nov 1, `f780e3b`, default 4 GB, 2560×1440; `decision21-final-phase0/report.json`; peak 3.754 GB, settled <3.4 GB, reserve intact | Met |
| Cold Aceh 48: Decision 21 first / second screen | First within 5% of 13.8 / 14.1 s respectively | First 14.383 / 13.601 s; second 21.762 / 20.661 s | Nov 1, `f780e3b`, cold 2560×1440, 48/48 twice, peaks 2.236 / 2.333 GB; `decision21-aceh-{one,two}/report.json` | Met |
| Grade line scan: Decision 21 pause / ordinary / resume | Pause <1 s; ordinary <5 s; resume <2 s; close/save near 0.4 s | 0.509 / 0.518 / 0.319 s; close/save 0.354 s | Nov 1, `f780e3b`, final `output/phase3a-grade/report.json`; exposure 0.125 saved | Met; earlier slow-run cause unresolved |
| Default mixed phase0, 27: Decision 20 final outcomes | 23 finish; four existing interpretation/X-Trans reasons | 20 finished; three source memory notices; four existing refusals; all outcomes checked at 34.6 s | Nov 1, `42a0ede`, default 4 GB, 2560×1440; `decision20-final-phase0/report.json`; AVIF notice at 29.018 s; peak 3.592 GB, settled <3.4 GB, reserve untouched | Queue stall fixed; 23-finished target not met |
| Cold Aceh 48: Decision 20 first / second screen | First within 5% of 13.2 / 13.5 s respectively | First 13.783 / 14.062 s; second 20.585 / 21.157 s | Nov 1, `42a0ede`, two cold 2560×1440 runs; all 48 finish twice; RAM 2.265–2.348 GB; `decision20-aceh-{one,two}/report.json` | Met |
| Grade line scan: Decision 20 pause / ordinary picture / resume | Pause <1 s; ordinary <5 s; resume <2 s | 2.705 / 3.001 / 0.729 s; close/save 2.591 s; folder click 170 ms | Nov 1, `42a0ede`, `output/decision20-grade-report.json`; exposure 0.125 saved, protected projects unchanged | Pause target not met; save/resume met; no extra rerun |
| Scroll back to three recently finished screens | Each screen under 0.5 s, no blanks or redevelopment (Oct 31 brief) | 12.4–22.7 ms, 96 cells | Nov 1, scroll diagnosis commit; 200 mixed disposable photos, 2560×1440, 367 MB retained within 512 MiB; `scroll-verified/report.json` | Met for this bounded case; pressure/beyond-capacity loss not reproduced |
| Isolated previously unfinished phase0 files → finished thumbnail | Default 4 GB / 4.4 GB transient limit | 5.56–19.65 s for the 13 supported files; four explicit source-route refusals in 0.98–1.64 s | Nov 1 big-file fix commit; isolated copies, TIFF saved interpretation retained; AVIF transport peak 3.786 GB | Met individually; mixed default remains 10/27 at 106 s, idle queue blocked |
| Cold Aceh 48: first / second screen, final scroll/big-file checks | First screen within 5% of Part C (12.98 / 14.26 s) | First 13.195–13.547 s; second 19.635–20.928 s | Nov 1, `3cf7a9e`, two cold 2560×1440 runs; RAM 2.304–2.367 GB, whole-card GPU 4.058–4.093 GB | Met |
| Cold Aceh: folder open → all 30 visible camera previews | Regression reference | 1.725–1.807 s | Same final pair, `3cf7a9e` | Baseline |
| Folder open → rows usable | 0.5 s end to end (photo-library.md) | 31–164 ms | Oct 30 18:18; 10–453-photo folders | Met |
| Very large folder → first 256 rows / first picture / 25th picture | Regression baseline (Steve, Oct 27) | 3.81 / 4.20 / 5.40 s | Oct 27, 155,877 rows, 015baf7 | Baseline |
| Folder open → first camera preview (RAW) | Under 0.2 s (tier 0, Steve Oct 12) | 0.14–0.29 s | Oct 30 18:18 | Met |
| Camera preview extraction (backend only) | — | p50 56 ms, max 143 ms | Oct 30 18:18 (`picture_camera_preview_ready`) | Baseline |
| Camera preview request → on screen in the grid, while photos develop | p95 under 0.5 s (phase 3a brief) | p50 1.507–1.551 s / p95 2.410–2.783 s / max 2.630–2.847 s | Oct 31 phase 3a.2, two quiet cold Aceh repeats, 48 previews each, 2560×1440 isolated profiles | Not met |
| Visible cell shows any picture | 1 s p90 (Oct 18) | — | needs a fresh measurement | Unknown |
| Visible cell shows its real picture | about 2 s p90 (Oct 18) | — | needs a fresh measurement | Unknown |
| Second launch: visible thumbnails | 90% within 100 ms (Oct 18) | Folder-reopen proxy: 0/27 within 100 ms, all in 181–211 ms; before 242–1,928 ms. Scroll-back 27/27 within 100 ms before/after | Nov 1, `589d39d` working tree against `72f75fb`; 65 s cold fill, fixture copies on removable exFAT D:, disposable cache on C:, 2560×1440. App relaunch not separately timed | 100 ms target not met; Steve accepted measured speed Nov 1 |
| Folder open → first finished thumbnail, stored pictures | — | 0.52 s (25th 2.06 s) | Oct 30 18:18, badminton | Baseline |
| Folder open → first finished thumbnail, cold RAW | — | 4.4–8.8 s | Oct 30 18:18, Kiddos Batik, 20241117 | Baseline |
| Cold JPEG grid: first screen of 24 / second screen | ≤26.51 / 51.59 s (24.1 / 46.9 s +10%) | 29.442–32.111 / 56.064–57.203 s | Oct 31 phase 3a.2, Aceh repeats 6/7, peaks 3.598/3.712 GB, all 48 finished, zero failures/timeouts | Not met |
| Thumbnail cache check per cell | No photo-drive check before stored redisplay (Nov 1) | Per-cell probe removed for finished hits: 8.8 ms first identity snapshot / 46.6 ms complete local read+checks for all 27; stored lookup-through-GPU-copy 182–202 ms per cell. Before: live-plan 104–1,334 ms per reopened cell | Nov 1, `589d39d` working tree vs `72f75fb`; same fixture/cache conditions as above; grouped times are not per-cell probe times | Source-free path built; overall 100 ms target not met |
| Folder disk check | — | 33 ms–5.3 s | Oct 30 18:18, 10–453 photos | Baseline |
| Large scroll disk check | Regression baseline (Oct 27) | 64 s | photo-library.md, Start here | Baseline |
| Back to grid after Single or fullscreen | — | 0.4–4.2 s, some over 5 s | Oct 26 (photo-library.md) | Unknown |

Phase 3a.2 Grade coexistence, October 31 (this change, disposable
phase0 photos, 2560×1440; `output/phase3a-grade/report.json`):

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Grade line scan + ordinary folder → first small photo | <5 s | 1.978 s | Oct 31 phase 3a.2, Grade retains 3.563 GB | Met |
| Folder with large photo → Grade pause message | <1 s from cell shown | 1.573 s from folder opening | Cell-visible timestamp not captured; older harness folder-to-pause assertion fails | Not qualified |
| Folder click while cells wait | <0.5 s | 23 ms | Oct 31 phase 3a.2, selected listed folder | Met for measured case |
| Close photo in Grade → empty Grade / Library resume | Save first; resume <2 s after close | Close including save 1.926 s; resume 0.696 s later | Oct 31 phase 3a.2, saved exposure 0.125 verified on disk | Met |

Phase 3a.2 mixed-format qualification stopped at **4.022 GB** during AVIF:
ten of 27 files finished; 226 memory requests had no timeout. Admission at
2.271 GB measured + 1.603 GB estimate fit the ceiling; decoder charge then
reached 1.765 GB. No oversized-alone exception applied at stop. Per-file status
and timings: `codebase/output/cold-mixed/phase0-3a2/per-file-results.csv`.
Unfinished files are not declared failures. Bounded large-picture routes remain
unfinished, and no approved estimate is changed. Grade's timing run has no
independent memory observer and does not qualify the 4 GB limit.

Additional phase 3a.2 observations (same quiet Aceh repeats, this change):

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Folder click → all initially visible quick previews, including partial rows | Reported measure, approved by Steve; formal p95 target unchanged | 30/30 by 5.008–5.884 s; visible request p95 2.473–2.791 s | First viewport, repeats 6/7 | Unknown |
| Longest Library request spanning trim or starting within 1 s after | <1 s (fix brief) | 0.822–1.066 s | One moderate trim each; live-developed request | Not met in run 7 |
| Development places maximum / time-weighted mean | Maximum two (Steve) | 2 / 1.413–1.430 | GPU completion releases place; saving still holds memory | Met |
| Active saving places | Provisional maximum two, approved by Steve | 2 in both repeats | Permanent limit awaiting decision | Met |

Reports/logs/screens: `codebase/output/cold-mixed/aceh-3a2-{6,7}/`.
Production corrections: local commit `f4dc71d`. The measurement-tools follow-up
records request/grant events and visible previews, writes per-file results even
on an early stop, and captures native-memory dumps on request. The focused RAW
driver reuses permanent copies and expects the existing unsupported PNG route
to refuse explicitly. Run 7 includes the final cached-only HTTP census refinement. Native memory
ownership evidence is in design 7.6 and the memory module; it does not enlarge
any share. RAW pixel-check stdout: `codebase/output/phase3a2-raw3.txt`.

Phase 3c, October 31 (after `2b37557`, this change), one disposable cold run
per condition, 2560x1440. No Aceh repeat pairs. Decimal GB; independent
whole-app census, zero observer timeouts. Evidence under
`codebase/output/cold-mixed/phase3c-*`, per-file CSV and JSON; source-boundary
probes in `codebase/output/phase3c/route-peaks.jsonl`.

| Action | Target | Latest measured | Conditions | Status |
|---|---|---|---|---|
| Cold Aceh 48: first / second viewport | <=26.51 / 51.59 s historical target | 24.910 / 41.252 s | Partial rows included (30 initial cells); 48 finished; 3.618 GB peak | Within target in one run; no repeat-pair qualification |
| Quick preview request -> screen | p95 <0.5 s | p50 1.4751 / p95 2.2861 / max 2.3655 s | 48 ordinary photos | Not met |
| Folder click -> all initially visible quick previews | Report, no pass/fail target (decision 15) | 30/30 by 2.9996 s; slowest IMG_3212.JPG, 2.9996 s from folder / 2.3655 s from request | Includes partial rows | Reported |
| Live setting 4 -> 8 -> 4 GB | No setting-change stall >1 s or failure | 62 / 22 ms; frame gap <=89.7 ms during changes | Same browsing run; earlier folder-load gap 2.7925 s | Met for settings; broader browsing stall remains |
| Line scan, active / from folder | <=27 s active | 12.4656 s alone; 12.667 s active / 47.161 s from open mixed | 16 GB, approved rates; source 10.7978-11.268 s | Time met |
| Line scan whole-app incremental peak | <=1 GB | 1.225794703 GB (baseline 0.984061070, peak 2.209855773 GB) | Cold app, line alone; isolated source increment 389.565 MB | Not met |
| Default mixed phase0, 27 | All finish or needs-memory, <=4 GB | Strict stop at 4.002060571 GB during AVIF | Approved rates | Not met |
| Raised mixed phase0, 27 | Line + 192 MP finish | 57.3 s overall; line 47.161 s; 192 JPEG/PNG/TIFF 38.07/42.13/44.16 s | 16 GB, 5.402632183 GB peak; 22 finish / 5 refusals | Giant requirement met; all-file acceptance open |
| 100 MP JPEG/PNG/TIFF beside other work | Measured; proposed rates awaiting Steve | 7.886/7.953/7.983 s; all source grants overlap, none alone; peak 2.478308200 GB | One 4 GB test-only comparison at proposed 6/8/6 MB per MP; override removed | Measured, approval pending |
| 192 MP needs-memory -> raise setting -> finish | Same folder, no broken-photo receipt | 8.200/9.767/10.508 s from open, notices cleared | 4 -> 16 GB, approved rates, peak 3.057958322 GB | Met |
| Reduced JPEG source, 100/192 MP | Report | 0.137/0.261 s; +322.154/791.076 MB | Fresh process, source-boundary only | Reported |
| Reduced PNG source, 100/192 MP | Report | 0.792/2.369 s; +568.809/1101.330 MB | Same | Reported |
| Reduced TIFF source, 100/192 MP | Report | 0.562/0.458 s; +400.610/258.233 MB | Same | Reported |
| Reduced linear DNG source, 297 MP | Report | 10.834 s; +389.565 MB | 10240-edge source, full line read | Reported |
| LR-classic AVIF source, 42.177 MP | Approved 38 bytes/pixel estimate | 16.262 s; +1.883587143 GB including external decoder | Full gain reconstruction; propose 56 MB/MP, awaiting Steve | Estimate insufficient |

Phase 3c.2 Part A, October 31, based on ad1402d, one default 4 GB cold mixed
run: **stopped at 4.011418177 GB** with the sole active development grant for
the Lightroom AVIF at the approved 56 bytes/pixel (2.361934848 GB).
Memory acceptance failed; no complete-folder, first/second-screen or complete
quick-preview time is claimed. No repeat was run. Evidence:
codebase/output/cold-mixed/phase3c2-default/report.json and memory.jsonl.
Parts B/C and the remaining acceptance runs stopped under the brief's explicit
AVIF condition; previous timing rows remain the last complete measurements.

Phase 3c.2 Part B, October 31 (branch `library-gpu-scheduling`, commit
5282827), one disposable cold run per condition, 2560x1440, default 4 GB.
Evidence: `codebase/output/cold-mixed/aceh-3c2-partb-{one,two}/report.json`,
`codebase/output/cold-mixed/phase3c2-partb-default/report.json`,
`codebase/output/library-gpu-recovery/`, `codebase/output/phase3a-grade/`.

| Action | Target | Latest measured | Conditions | Status |
|---|---|---|---|---|
| Cold Aceh 48, two GPU developments: first / second viewport | <=26.51 / 51.59 s historical target | 27.424 / 43.451 s | All 48 finished; peak 3.741 GB; developments overlapped; 0 duplicate asks, 0 timeouts | Second viewport within target; first 3.4% over, one run |
| Cold Aceh 48, one GPU development: first / second viewport | Same historical target, comparison run | 28.622 / 47.721 s; peak 3.420 GB | Same folder, `HDR_FINISHER_LIBRARY_GPU_DEVELOPMENTS=1` | Two is faster (4% / 9%); two stays |
| Folder click -> all initially visible quick previews | Report, no pass/fail target (decision 15) | 30/30 by 1.965 s; slowest IMG_3212.JPG, 1.264 s request | Two-development run; includes partial rows | Reported |
| Grid of 3 RAW + 1 PNG, cold | Grid completes | 6.722 s to four drawn cells; each reuse 18-22 ms | 2560x1440, isolated profile; release runner PASS | Met |
| Default mixed phase0, 27, 4 GB | Peak within ceiling +10% briefly, settle below ceiling - 600 MB | Peak 3.420 GB (no excursion); settled immediately | Completion unchanged from Part A: 10 finish, 3 need-memory, 14 still developing at stop | Memory met; completion open |
| Line-scan DNG open in Grade, Library browsing | Pause <1 s; first ordinary <5 s; resume <2 s | Pause 543 ms; first ordinary 551 ms; resume 212 ms | 4 GB ceiling; small edit saved | Met |
| Forced Library GPU OOM and device loss | Photos finish; no broken records | OOM: 2 attempts then visible CPU route; loss twice: 2 attempts then visible CPU route | `tests/library-gpu-recovery.js`, release runner PASS | Met |

## Part C: requested scene tiers (October 31, 2026)

Code `9a746fa` / final navigation check `28240ef`, branch
`library-gpu-scheduling`; cold isolated profiles at 2560x1440, default 4 GB,
two GPU developments, unchanged approved estimates and Auto half-card budget.
Times for second screens are cumulative from folder opening. Decimal GB.
Evidence: `codebase/output/cold-mixed/aceh-partc-{one,two}/report.json`,
`phase0-partc-default/report.json`, `output/library-live-grid/result.json`,
`output/phase3a-grade/report.json`. GPU memory samples cover the whole card,
including the desktop and other apps, not app-only allocation.

| Action | Target | Latest measured | Conditions | Status |
|---|---|---|---|---|
| Cold Aceh 48, first / second viewport, run one | First roughly 2–3x faster than Part B's 27.424 s | 12.978 / 20.380 s | All 48 finished; peak RAM 2.109 GB, whole-card GPU 3.793 GB (initial 2.404 GB) | First 2.11x faster |
| Cold Aceh 48, first / second viewport, run two | Same | 14.257 / 21.991 s | All 48 finished; peak RAM 2.236 GB, whole-card GPU 3.885 GB (initial 2.393 GB) | First 1.92x faster |
| Folder click to all initially visible camera previews | Report (decision 15) | 30/30 by 1.848 / 1.924 s | Slowest IMG_3212.JPG both runs, request 1.159 / 1.229 s; p95 request 1.135 / 1.200 s | Reported; old <0.5 s request target still unmet |
| Cold grid, 3 RAW + 1 PNG | All finish, only 640 developments | 6.207 s | Release runner PASS; GPU loss/restore, M20 included | Met |
| Cold-grid photo opened in Single | 2560 now | 1.761 s | DSC07061.ARW; next/previous soon priority 50 | Met |
| Prepared Single neighbour step | Fast | 17 ms | DSC07072.ARW; no unfinished screen work after leaving Single | Met; active abort covered by focused test |
| Default mixed 27, 4 GB | Ceiling +10%, settle below 3.4 GB, reserve hard | Peak 3.173 GB, no excursion; settled | 10 finish, 6 quick-only, 3 need-memory, 8 unfinished at 131.947 s; same completion as Part B | Memory met; all-target-outcomes assertion fails, completion open |
| Line-scan in Grade with Library browsing | Pause <1 s; first ordinary <5 s; resume <2 s | Pause 464 ms, ordinary 471 ms, resume 122 ms; close/save 324 ms | Small edit saved, protected projects unchanged; driver log-path fix `9fb6b25` | Met |

An initial narrower reservation refused IMG_1150.tiff (9/27 finished). Restored
the approved reservation without changing rates/formulas and repeated the affected
measurements above. Initial Single timing was 1.830 s / neighbour 13 ms; final
values above supersede it. The final grid/recovery release runs pass without
retry. Initial grid-driver failures exposed cache-retention and race assumptions;
these were corrected to exercise the intended tiered behavior.

## 3. Developing a photo (per photo)

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Cold RAW development, whole | — | p50 2.48 s, p90 3.37 s, max 6.58 s | Oct 30 18:18, 54 developments | Baseline |
| RAW: sensor read | — | p50 0.54 s, max 4.13 s | same (`sensor_ms`) | Baseline |
| RAW: GPU work | — | p50 1.29 s, max 2.71 s | same (`gpu_ms`) | Baseline |
| RAW GPU stages: demosaic / highlights / lens / reduce / upload / readback | — | p50 266 / 421 / 316 / 72 / 38 / 29 ms | same | Baseline |
| RAW: hand-off to the backend | — | p50 0.52 s, max 1.30 s | same (`handoff_ms`) | Baseline |
| JPEG development, whole | — | median 1.76 s (was 5.18 s before 1c0d45a) | Oct 30, Aceh copies | Baseline |
| JPEG: GPU / readback / hand-off | — | median 0.61 s / 138 ms / 0.92 s | same | Baseline |
| Hand-off request, 2560 / 640 picture | — | median 672 ms / 80 ms | same | Baseline |
| Half-float conversion, 2560 picture | — | 60–80 ms (was about 1.4 s) | Oct 30, 1c0d45a | Baseline |
| Highlight reconstruction, 42 MP, GPU | 1 s | about 3.2 s | Oct 24 | Not met |
| EXR decode to GPU | — | 2.92 s (one file) | Oct 30 18:18 | Baseline |
| Very large picture: 297 MP line-scan DNG, first grid thumbnail / stored thumbnail | — | 12.3 s / 0.37–0.70 s | Oct 30 logs, HDR Test Images | Baseline |
| Very large picture: line-scan DNG backend preparation | — | about 25 s (colour 4.9 s, conversion 7.7 s, analysis 7.6 s, indexing 4.9 s) | Oct 22 log | Baseline |
| Ultra HDR first picture / large gain-map AVIF | 1 s (cold non-RAW sharp draw, Steve Oct 26) | 1.87 s / 12.70 s | Oct 26, local copies | Not met |
| CPU fallback RAW development | — | 8–10 s | photo-library.md | Baseline |
| Backend source decode (GPU route), warm: RAW sensor / JPEG 42 MP / PNG 42 MP / TIFF 48 MP / HEIC 24 MP / EXR 42 MP / gain-map AVIF 42 MP | — | 0.10–0.45 s / 0.29 s / 2.98 s / 0.64 s / 1.74 s / 1.52 s / 16.0 s | Oct 30 phase 0, copies in `output/test-photos/phase0` | Baseline |
| CPU route: X-Trans RAF / JPEG XL / EXR without colour tags | — | 3.3 s / 1.0–1.1 s / 3.1 s | same | Baseline |
| Quick preview, today vs reduced decode: Nikon NEF, Canon CR3/CR2, 30 MP JPEG, 42 MP JPEG | — | 125 / 100 / 107 / 338 / 217 ms → 40 / 37 / 35 / 251 / 95 ms | same; reduced decode not built | Baseline |
| Direct Library RAW GPU pixel check, DSC07060.ARW | Existing perceptual limits | 3.004 s app / 1.164 s GPU; SDR mean/p99.9 ΔE2000 0.0182/0.0590; HDR 0.0266/0.0769 | Oct 31 phase 3a.2, fresh profile, 2560×1440; permanent photo copy; one focused GPU driver | Met |
| Library Denoise measurement (reused) | — | p50 6.6 ms, max 58 ms | Oct 30 18:18 | Baseline |

## 4. Single, fullscreen and Compare

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Full-size zoom click to detail drawn (native frame held, 32 MB pieces) | No timing target yet | 42 MP ARW 6.54 s (hand-off 3.88 s); 48 MP TIFF 11.81 s (hand-off 6.64 s) | Nov 5, uncommitted on ff9aeac; same photos and settings as the row below; one run each | From 9.24 s and 16.33 s; frame built once instead of four times |
| Full-size zoom click to detail drawn (streamed hand-off) | No timing target yet | 42 MP ARW 9.24 s (hand-off 4.42 s); 48 MP TIFF 16.33 s (hand-off 7.15 s) | Nov 5, uncommitted streamed hand-off on 08a82ab; DSC00264.ARW and DSC04375_DxO_clipped_target.tif copies, 4 GB, 2560 x 1440, idle, --single --steps=0 --fullscreen --detail; one run each | 42 MP was 8.93 s (hand-off 3.81 s) before; 48 MP was refused. Speed follow-up open |
| 42 MP fullscreen zoom input to full-size detail drawn | No timing target; must admit with room | 12.23 s (one functional check) | Nov 5, zoom admission fix on bdde83e; existing DSC00264.ARW fixture copy, 7952 x 5304, 4 GB, 2560 x 1440; --single --steps=0 --fullscreen --detail --seconds=6; output/quick-library-check/zoom-detail-focused | Detail delivered; zero refusal, no speed claim |
| Same check: Single open / window responsiveness | No frame/timer interval >250 ms | Open 4.442 s; maximum frame gap 165 ms, timer block 174 ms | Same Nov 5 functional check; cold selected-photo preparation, Python fast suite running outside app tree | Responsiveness passed; timing is diagnostic only |
| Unedited-RAW SDR policy smoke check: Single open / ten steps | Existing responsiveness limit: no frame/timer interval >250 ms | Open 1.838 s; steps 0.081-11.034 s; max frame gap 176 ms, timer block 199 ms | Nov 6, parent `d05c673` with SDR policy changes; plain Electron 2560x1440, mixed fixture, HDR enabled, Python suite concurrent; `codebase/output/quick-library-check/raw-sdr/report.json` | Responsiveness passed; mixed cold/prepared navigation timings are diagnostic, not a speed comparison |
| Unedited RAW camera picture, Single input to presentation | — | 78–599 ms (seven RAWs, includes first open) | Nov 3, Batch 4a implementation `75f1de9` (run before commit, final small fixes covered by fast tests); mixed fixture copy, 90 s `--single`, default RAW/mezzanine filter; `codebase/output/quick-library-check/batch4a/report.json` | Baseline; no development for those camera-picture files |
| Required development, Single input to presentation | — | Edited ARWs 1.768–1.899 s; two DNGs without usable camera pictures 11.278–11.409 s | Same run; no ahead development | Baseline; required cold development still takes seconds |
| Batch 4a window responsiveness | No frame/timer interval >250 ms | Frame gap 4438 ms; timer block 62 ms; external peak 3.773 GB, settled 1.526 GB | Same run, 31 eligible files, ten Single steps; memory ceiling/target unchanged | Not met for frame gap; retained for Batch 4c |
| Stored screen preview: first / next SDR / HDR draw | about 100 ms | 226 / 115 / 162 ms | Oct 26, disposable restart | Not met |
| Cold non-RAW sharp draw (JPEG) | within 1 s (Steve, Oct 26) | 0.85–0.9 s | Oct 26, 8b64302 | Met |
| Fullscreen sharp draw, cold RAW (CR2) | — | 2.52 s | Oct 30 18:18, 2L1B8631.CR2 | Baseline |
| Fullscreen sharp draw stages: lease wait / pixel fetch / render / draw | — | 132 / 110 / 32 / 291 ms | same, n = 2 | Baseline |
| Stored scene pixel fetch (2560) | — | 65–150 ms | photo-library.md | Baseline |
| Graded Denoise sharp draw | 0.5 s (PRD open work) | about 0.57 s combined | Oct 26 | Not met |

## 5. Grade (editing)

<!-- grade-sweep-start -->
### 0.9.2 Grade control review (November 11, 2026)

**233 controls timed three times; 229 demonstrated the intended response and restoration in at least one view. 57 separate gesture checks were also timed. 92 satisfied all measured rendition/view/input checks.** This is response coverage, not picture-quality or release sign-off.

**Slowest:** raw edge colour expand: 13.64 s; raw highlight method: 13.26 s; lens focal: 6.33 s. Heavy RAW rebuilds are permitted exceptions. Ordinary editing (W11 post-W9): SDR HSL Show selection median 1.48 s (up to 1.96 s); SDR Match entire median 1.19 s (up to 1.44 s); denoise color: 0.98 s. Three-trial medians; older W1 timings include background drain and are upper bounds.

**Problems:** W9 fixed the roughly 200 ms anchor poll (`0dc12ce8`): Retouch reference medians now meet the combined allowance; Denoise retains a 26 ms excess. Film/lens drags remain below 20/s. W9's targeted detail is preserved below. Before that merge, W10 found smaller reference increases at SDR Vignette Centre Y (25 to 46 ms after reset) and native HDR Bias (34 to 56/59 ms); other pre-fix crossings are flagged below; these were not rerun after W9. W11 confirmed both misses after W9: SDR Show selection still rebuilds its CPU stage; Match spends its time in colour fitting. No product speed change was retained; see W11 findings below. **Fixed:** `38821253` percentage entry passed the app rerun (44% stored correctly); Push/Pull's real buttons passed both renditions/views.

**Untested:** remaining mode/profile fields, brush/gradient/Hue-mask parameters, complete Boolean authoring, perspective/custom geometry, repair move/list actions and preset I/O were not qualified within the bounded review. Missing view/input checks and the remaining actions in each gesture family are explicit below. Unchanged sampled crops are fixture exceptions where the other view demonstrated change/reset.

**W11 investigation, November 11, 2026 (`5359ea80`, after W9):** three trials
per rendition/view, 2560x1440 Electron, shared lock acquired with
`run_grade_batch.py`'s atomic acquisition/ownership helpers. Original comparison
and Match ran serially under one acquisition; a focused visible-selection
check used a second completed acquisition. No application code, pixels, cache
sizes or budgets changed. Raw reports/profiles and runner logs are in the main
checkout's `codebase/output/performance/grade-0-9-2/w11/`: `w11-match-before.json`,
`w11-hsl-profile.json`, `w11-profile.log`; an interrupted accidental duplicate
authoring launch is labelled superseded in `w11-hsl-before.json`.

The final HSL check selects built-in Red, rather than the authoring driver's
empty Custom recipe. HDR show: Fit 0.390-0.756 s, native 0.475-0.508 s; SDR
show: Fit 1.470-1.961 s, native 1.452-1.661 s. Hide: 0.019-0.033 s, with no
HSL sampling request. SDR sampling requests account for 1.426-1.729 s of
the whole wait; the cold Fit trial also includes about 0.23 s of UI/settlement
overhead. A standalone CPU profile of the same chart's Red selection explains
the repeated cost: about 1.14 s rebuilding the SDR stage (0.70 s highlight
compression, 0.40 s gamut mapping), plus roughly 0.33 s preparing/selecting
coverage and PNG/response overhead. This is CPU reconstruction, not a full
preview re-upload/recompile caused by visibility. Proposed follow-up: expose
the existing GPU HSL stage/coverage for the overlay, with independent overlay
pixel checks and budget accounting; that is larger than a safe release patch.
Reusing another cached overlay would add retained memory and needs an explicit
design within the existing allowance.

Match backend request time is 1.012-1.123 s warm, 1.300 s cold; the cold
source proxy costs 0.234 s. The fit renders 11 GPU candidates, including nine
exposure-refinement candidates. Exposure refinement costs 0.489-0.551 s,
neutral tonal fitting 0.164-0.215 s, and CPU certification 0.131-0.137 s;
the remaining stages build/score the target and merge the fit. GPU candidate
wait (included in those stages) is 0.226-0.283 s. Request completion to settled
picture adds about 0.06-0.14 s. This is genuinely colour-fit time; removing
preview scheduling cannot bring it below one second. Proposed follow-up:
profile repeated fit statistics/candidate scoring for reuse while preserving
the selected recipe and certification; do not reduce candidates or relax the
quality gate as a release shortcut. No small safe product fix was found.

Limits: under 1 s; pointwise Fit drags at least 20 presentations/s. A reference slowdown counts only above **25% and 20 ms together**. Met = measured checks passed; Not met (real problem) = measured limit crossed; Exception = stated reason; Untested = missing evidence.

| Control | Range | Fit (s) | 100% (s) | Fit drag (presentations/s) | Status / open check | Photo / commit |
| --- | --- | --- | --- | --- | --- | --- |
| commands / undo redo | Discrete / see inventory | 0.044-0.089 | 0.056-0.076 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| crop grid density | 2 to 16 | 0.014-0.014 | Not measured | Not measured / N/A | Untested: Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `ab3d8f55` |
| crop guide | Discrete / see inventory | 0.014-0.014 | Not measured | Not measured / N/A | Untested: Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `ab3d8f55` |
| black and white / aquas | -100 to 100 | 0.031-0.039 | 0.057-0.057 | 33.0-34.1 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active; Missing rendition | grade-24mp.tiff / `85950a7f` |
| black and white / blues | -100 to 100 | 0.026-0.035 | 0.052-0.062 | 32.1-32.8 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| black and white / greens | -100 to 100 | 0.026-0.043 | 0.050-0.050 | 32.3-34.6 | Untested: Missing rendition | grade-24mp.tiff / `85950a7f` |
| black and white / magentas | -100 to 100 | 0.026-0.026 | 0.050-0.050 | 31.5-31.5 | Untested: Missing rendition | grade-24mp.tiff / `85950a7f` |
| black and white / oranges | -100 to 100 | 0.033-0.033 | 0.051-0.051 | 31.8-32.2 | Untested: Missing rendition | grade-24mp.tiff / `85950a7f` |
| black and white / purples | -100 to 100 | 0.038-0.041 | 0.047-0.054 | 33.7-33.9 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| black and white / reds | -100 to 100 | 0.040-0.042 | 0.064-0.064 | 32.0-33.5 | Untested: Missing rendition | grade-24mp.tiff / `85950a7f` |
| black and white / yellows | -100 to 100 | 0.033-0.040 | 0.050-0.050 | 32.9-32.9 | Untested: Missing rendition | grade-24mp.tiff / `85950a7f` |
| black and white section enabled | Discrete / see inventory | 0.026-0.027 | 0.037-0.037 | Not measured / N/A | Untested: Missing rendition | grade-24mp.tiff / `85950a7f` |
| color grading / balance | -100 to 100 | 0.028-0.041 | 0.038-0.063 | 33.1-35.2 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / blending | 0 to 100 | 0.034-0.038 | 0.033-0.054 | 32.8-34.3 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / highlights / hue | 0 to 360 | 0.029-0.029 | 0.045-0.048 | Not measured / N/A | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / highlights / luminance ev | -1 to 1 | 0.026-0.028 | 0.052-0.052 | 32.7-33.1 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / highlights / saturation | 0 to 100 | 0.027-0.034 | 0.051-0.061 | Not measured / N/A | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / midtones / hue | 0 to 360 | 0.034-0.041 | 0.049-0.057 | Not measured / N/A | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / midtones / luminance ev | -1 to 1 | 0.027-0.029 | 0.036-0.049 | 33.9-34.9 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / midtones / saturation | 0 to 100 | 0.025-0.027 | 0.051-0.058 | Not measured / N/A | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / shadows / hue | 0 to 360 | 0.028-0.031 | 0.046-0.052 | Not measured / N/A | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / shadows / luminance ev | -1 to 1 | 0.029-0.040 | 0.047-0.064 | 32.5-32.9 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading / shadows / saturation | 0 to 100 | 0.027-0.029 | 0.047-0.062 | Not measured / N/A | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| color grading section enabled | Discrete / see inventory | 0.024-0.032 | 0.043-0.047 | Not measured / N/A | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| detail / clarity amount | -100 to 100 | 0.031-0.036 | 0.062-0.065 | 31.6-34.9 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `4f5a5e14` |
| detail / clarity radius percent | 0.2 to 3 | 0.026-0.034 | 0.052-0.060 | 31.9-33.3 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset | grade-24mp.tiff / `4f5a5e14` |
| detail / microcontrast | -100 to 100 | 0.030-0.033 | 0.060-0.064 | 31.8-32.8 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| detail / sharpen amount | 0 to 200 | 0.034-0.039 | 0.045-0.054 | 30.9-33.7 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Exception: native Detail judgement demonstrated change/reset; reduction at Fit hides fine sharpening. | grade-colour-chart.tiff / `05e34f85` |
| detail / sharpen radius px | 0.3 to 3 | 0.027-0.028 | 0.048-0.054 | 31.8-33.0 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active | grade-colour-chart.tiff / `05e34f85`; grade-colour-chart.tiff / `8cfdb24a` |
| detail / sharpen threshold | 0 to 100 | 0.028-0.028 | 0.050-0.052 | 31.9-32.5 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Exception: native Detail judgement demonstrated change/reset; reduction at Fit hides fine sharpening. | grade-colour-chart.tiff / `05e34f85` |
| detail / softness | 0 to 100 | 0.033-0.046 | 0.057-0.059 | 32.0-34.2 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| detail / texture amount | -100 to 100 | 0.030-0.037 | 0.051-0.052 | 30.4-31.3 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `4f5a5e14` |
| detail section enabled | Discrete / see inventory | 0.137-0.146 | 0.143-0.149 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset | grade-24mp.tiff / `4f5a5e14` |
| film look / film resolution | 0 to 100 | 0.035-0.040 | 0.060-0.065 | 15.5-16.0 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / film stock | Discrete / see inventory | 0.046-0.057 | 0.060-0.063 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain amount | 0 to 100 | 0.041-0.047 | 0.061-0.066 | 15.2-15.8 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `4881e885` |
| film look / grain capture geometry | Discrete / see inventory | 0.035-0.035 | 0.054-0.065 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `8cfdb24a` |
| film look / grain chroma | 0 to 100 | 0.036-0.042 | 0.065-0.069 | 15.0-15.7 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain custom height mm | 1 to 500 | 0.041-0.046 | 0.065-0.067 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `4881e885` |
| film look / grain custom width mm | 1 to 500 | 0.038-0.044 | 0.054-0.064 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain enabled | Discrete / see inventory | 0.034-0.051 | 0.050-0.065 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain film format | Discrete / see inventory | 0.033-0.035 | 0.061-0.064 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain film type | Discrete / see inventory | 0.036-0.042 | 0.057-0.066 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain highlight response | 0 to 150 | 0.035-0.042 | 0.060-0.065 | 15.0-15.8 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain midtone response | 0 to 150 | 0.036-0.037 | 0.064-0.066 | 15.4-15.9 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain shadow response | 0 to 150 | 0.036-0.036 | 0.065-0.067 | 15.8-15.9 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain size | 0 to 100 | 0.034-0.036 | 0.064-0.067 | 15.7-16.0 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain softness | 0 to 100 | 0.038-0.040 | 0.065-0.065 | 15.7-16.3 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / grain view map | Discrete / see inventory | 0.042-0.046 | 0.065-0.069 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / halation amount | 0 to 100 | 0.033-0.042 | 0.065-0.071 | 15.0-15.8 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / halation enabled | Discrete / see inventory | 0.030-0.035 | 0.060-0.063 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / halation hue offset | -100 to 100 | 0.036-0.037 | 0.065-0.065 | 15.3-16.5 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / halation radius | 0 to 2 | 0.036-0.041 | 0.064-0.069 | 15.5-16.6 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / halation saturation | 0 to 100 | 0.031-0.048 | 0.062-0.066 | 15.2-16.1 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / halation view map | Discrete / see inventory | 0.048-0.054 | 0.055-0.059 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / highlight contrast | -100 to 100 | 0.041-0.060 | 0.065-0.065 | 0.0-0.0 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / lab levels | Discrete / see inventory | 0.042-0.075 | 0.065-0.065 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `8cfdb24a` |
| film look / lens filter | Discrete / see inventory | 0.036-0.042 | 0.277-0.281 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / lens size | 0.25 to 4 | 0.060-0.066 | 0.295-0.295 | 9.7-11.5 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / lens strength | 0.125 to 2 | 0.059-0.060 | 0.272-0.281 | 10.8-11.2 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / look strength | 0 to 100 | 0.035-0.035 | 0.063-0.069 | 0.0-16.0 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / print contrast | -100 to 100 | 0.042-0.047 | 0.059-0.060 | 0.0-0.0 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / print exposure | -3 to 3 | 0.046-0.046 | 0.063-0.075 | 16.0-16.3 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `4881e885` |
| film look / print paper | Discrete / see inventory | 0.036-0.036 | 0.065-0.070 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / push pull | -2 to 2 | 0.046-0.047 | 0.060-0.065 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `4881e885` |
| film look / scan sharpening | 0 to 100 | 0.036-0.037 | 0.065-0.065 | 15.4-15.6 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `8cfdb24a` |
| film look / shadow contrast | -100 to 100 | 0.036-0.042 | 0.065-0.069 | 0.0-0.0 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active; drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / stock color | 0 to 100 | 0.035-0.035 | 0.065-0.071 | 15.4-15.6 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / stock exposure | -3 to 3 | 0.041-0.042 | 0.065-0.065 | 15.2-16.5 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / stock preflash | 0 to 100 | 0.036-0.036 | 0.061-0.065 | 15.0-15.8 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / stock print tint | -100 to 100 | 0.035-0.039 | 0.059-0.064 | 15.8-16.2 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / stock print warmth | -100 to 100 | 0.035-0.036 | 0.059-0.068 | 14.7-16.0 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / stock separation | -100 to 100 | 0.034-0.036 | 0.065-0.066 | 15.5-16.1 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look / stock tone | 0 to 100 | 0.029-0.035 | 0.060-0.066 | 15.7-15.7 | Not met (real problem): drag below 20 presentations/s; review whether pointwise | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| film look section enabled | Discrete / see inventory | 0.036-0.042 | 0.035-0.046 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `3507d48e`; grade-24mp.tiff / `4881e885` |
| hsl section enabled | Discrete / see inventory | 0.033-0.041 | 0.045-0.048 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| vignette / amount | -100 to 100 | 0.033-0.035 | 0.050-0.051 | 32.2-34.4 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| vignette / feather | 0 to 100 | 0.026-0.033 | 0.043-0.068 | 31.2-33.1 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| vignette / highlight protection | 0 to 100 | 0.026-0.032 | 0.047-0.052 | 31.9-33.9 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| vignette / midpoint | 0 to 100 | 0.034-0.047 | 0.047-0.051 | 32.9-33.8 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| vignette / roundness | -100 to 100 | 0.030-0.042 | 0.051-0.053 | 31.4-32.5 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| vignette / scale x | 25 to 300 | 0.026-0.032 | 0.048-0.052 | 31.5-33.9 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| vignette / scale y | 25 to 300 | 0.031-0.039 | 0.039-0.059 | 32.4-32.8 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| vignette section enabled | Discrete / see inventory | 0.025-0.031 | 0.043-0.051 | Not measured / N/A | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified. | grade-24mp.tiff / `dbf9912e` |
| curves / blue / add | Discrete / see inventory | 0.037-0.069 | 0.805-0.812 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / blue / drag | Discrete / see inventory | 0.019-0.031 | 0.764-0.769 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / blue / remove | Discrete / see inventory | 0.036-0.049 | 0.781-0.784 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / green / add | Discrete / see inventory | 0.040-0.047 | 0.789-0.794 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / green / drag | Discrete / see inventory | 0.031-0.038 | 0.759-0.770 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / green / remove | Discrete / see inventory | 0.037-0.046 | 0.778-0.785 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / luma / add | Discrete / see inventory | 0.038-0.040 | 0.790-0.793 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / luma / drag | Discrete / see inventory | 0.020-0.032 | 0.758-0.762 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / luma / remove | Discrete / see inventory | 0.039-0.068 | 0.776-0.780 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / red / add | Discrete / see inventory | 0.041-0.045 | 0.805-0.805 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / red / drag | Discrete / see inventory | 0.019-0.040 | 0.767-0.769 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| curves / red / remove | Discrete / see inventory | 0.035-0.057 | 0.778-0.781 | Not measured / N/A | Untested: Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions | grade-24mp.tiff / `4881e885` |
| denoise amount | 0 to 1 | 0.100-0.320 | 0.909-0.927 | 41.1-42.1 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `38cb95a1` |
| denoise bypass | Discrete / see inventory | 0.027-0.041 | 0.799-0.812 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `38cb95a1` |
| denoise coarse | 0 to 1 | 0.088-0.290 | 0.945-0.945 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value; Missing rendition | grade-24mp.tiff / `38cb95a1` |
| denoise color | 0 to 1 | 0.082-0.280 | 0.951-0.976 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `38cb95a1` |
| denoise detail | 0 to 1 | 0.083-0.319 | 0.938-0.951 | 36.5-41.3 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `38cb95a1` |
| denoise fine | 0 to 1 | 0.054-0.281 | 0.940-0.945 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `38cb95a1` |
| denoise finest | 0 to 1 | 0.051-0.284 | 0.906-0.963 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `38cb95a1` |
| denoise luminance | 0 to 1 | 0.070-0.308 | 0.945-0.957 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `38cb95a1` |
| denoise medium | 0 to 1 | 0.053-0.283 | 0.951-0.951 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value; Missing rendition | grade-24mp.tiff / `38cb95a1` |
| frame custom hex | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| frame custom swatch | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| geometry / crop handle apply | Discrete / see inventory | 0.338-0.338 | 0.197-0.197 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Needs investigation: gesture picture mismatch; Missing rendition; Driver: a full-frame crop corner is offscreen at 100%; unpanned pointer drag did not reach a handle. Fit drag and native ratio Apply passed. | grade-24mp.tiff / `8cfdb24a` |
| geometry / crop ratio apply | Discrete / see inventory | 0.293-0.293 | 0.401-0.401 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| geometry / flip horizontal | Discrete / see inventory | 0.271-0.271 | 0.422-0.422 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| geometry / flip vertical | Discrete / see inventory | 0.294-0.294 | 0.431-0.431 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| geometry / rotate left | Discrete / see inventory | 0.212-0.212 | 0.416-0.416 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| geometry / rotate right | Discrete / see inventory | 0.226-0.226 | 0.371-0.371 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| geometry / straighten apply | Discrete / see inventory | 0.791-0.791 | 0.597-0.597 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| hdr / bands / add remove | Discrete / see inventory | 0.039-0.039 | 0.052-0.052 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| hdr / bands / drag | Discrete / see inventory | 0.180-0.180 | 0.160-0.160 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| hdr / bands / keyboard vertical | Discrete / see inventory | 0.073-0.073 | 0.069-0.069 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| hdr / blacks | -100 to 100 | 0.032-0.032 | 0.816-0.816 | 35.0-35.0 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / blue hue | -30 to 30 | 0.040-0.040 | 0.806-0.806 | 30.1-30.1 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / blue purity | -95 to 95 | 0.030-0.030 | 0.815-0.815 | 32.9-32.9 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / commands / tone bypass | Discrete / see inventory | 0.077-0.077 | 0.071-0.071 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| hdr / commands / tone reset undo | Discrete / see inventory | 0.073-0.073 | 0.074-0.074 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| hdr / contrast | -1 to 1 | 0.038-0.038 | 0.855-0.855 | 32.5-32.5 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / contrast pivot | 0.02 to 1 | 0.035-0.035 | 0.766-0.766 | 34.0-34.0 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / exposure | -4 to 4 | 0.038-0.038 | 0.806-0.806 | 33.3-33.3 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / green hue | -30 to 30 | 0.054-0.054 | 0.815-0.815 | 31.7-31.7 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / green purity | -95 to 95 | 0.047-0.047 | 0.830-0.830 | 31.6-31.6 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / highlight compression attenuation | 0 to 90 | 0.051-0.051 | 0.054-0.054 | 33.0-33.0 | Met (measured observations only) | grade-24mp.tiff / `8cfdb24a` |
| hdr / highlight compression bias | -100 to 100 | 0.038-0.038 | 0.046-0.046 | 32.5-32.5 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `b5966e15` |
| hdr / highlight compression color handling | Discrete / see inventory | 0.049-0.049 | 0.058-0.058 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| hdr / highlight compression manual peak nits | 100 to 100000 | 0.031-0.031 | 0.056-0.056 | 32.3-32.3 | Met (measured observations only) | grade-24mp.tiff / `8cfdb24a` |
| hdr / highlight compression mode | Discrete / see inventory | 0.030-0.030 | 0.049-0.049 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| hdr / highlight compression peak detail | 0 to 100 | 0.035-0.035 | 0.053-0.053 | 31.3-31.3 | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| hdr / highlight compression peak measurement | Discrete / see inventory | 0.042-0.042 | 0.040-0.040 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| hdr / highlight compression softness | 0 to 100 | 0.033-0.033 | 0.044-0.044 | 31.3-31.3 | Met (measured observations only) | grade-24mp.tiff / `8cfdb24a` |
| hdr / highlight compression start nits | 100 to 4000 | 0.029-0.029 | 0.053-0.053 | 29.5-29.5 | Untested: Reset unverified | grade-24mp.tiff / `b5966e15` |
| hdr / highlight compression target nits | 200 to 10000 | 0.031-0.031 | 0.050-0.050 | 30.7-30.7 | Untested: Reset unverified | grade-24mp.tiff / `b5966e15` |
| hdr / highlight desaturation | 0 to 100 | 0.037-0.037 | 0.817-0.817 | 32.1-32.1 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / highlight desaturation start | 0.01 to 16 | 0.032-0.032 | 0.048-0.048 | 31.7-31.7 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| hdr / highlight section enabled | Discrete / see inventory | 0.029-0.029 | 0.045-0.045 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| hdr / highlights | -100 to 100 | 0.028-0.028 | 0.044-0.044 | 32.3-32.3 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| hdr / highlights center | -8 to 8 | 0.027-0.027 | 0.050-0.050 | 35.6-35.6 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| hdr / highlights width | 0.5 to 12 | 0.029-0.029 | 0.052-0.052 | 33.7-33.7 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| hdr / midtones | -100 to 100 | 0.045-0.045 | 0.839-0.839 | 33.4-33.4 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / midtones center | -8 to 8 | 0.027-0.027 | 0.038-0.038 | 31.5-31.5 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| hdr / midtones width | 0.5 to 12 | 0.035-0.035 | 0.849-0.849 | 35.0-35.0 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / red hue | -30 to 30 | 0.035-0.035 | 0.820-0.820 | 31.9-31.9 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / red purity | -95 to 95 | 0.034-0.034 | 0.815-0.815 | 30.8-30.8 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / saturation | -1 to 1 | 0.034-0.034 | 0.810-0.810 | 32.3-32.3 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / shadow desaturation | 0 to 100 | 0.039-0.039 | 0.844-0.844 | 35.0-35.0 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / shadow desaturation start | 0.001 to 1 | 0.030-0.030 | 0.041-0.041 | 31.8-31.8 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| hdr / shadows | -100 to 100 | 0.037-0.037 | 0.898-0.898 | 33.8-33.8 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / shadows center | -8 to 8 | 0.032-0.032 | 0.860-0.860 | 34.7-34.7 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / shadows width | 0.5 to 12 | 0.045-0.045 | 0.806-0.806 | 32.4-32.4 | Untested: Typed input unverified | grade-24mp.tiff / `596419d9` |
| hdr / tint | -1 to 1 | 0.037-0.037 | 0.808-0.808 | 34.0-34.0 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / tint hue | -180 to 180 | 0.038-0.038 | 0.048-0.048 | 31.9-31.9 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| hdr / tint purity | 0 to 20 | 0.041-0.041 | 0.830-0.830 | 31.7-31.7 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / tone equalizer section enabled | Discrete / see inventory | 0.028-0.028 | 0.047-0.047 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `6a95bff6` |
| hdr / tone equalizer smoothing | 0 to 1 | 0.028-0.028 | 0.057-0.057 | 33.1-33.1 | Met (measured observations only) | grade-24mp.tiff / `6a95bff6` |
| hdr / vibrance | -1 to 1 | 0.038-0.038 | 0.825-0.825 | 32.5-32.5 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hdr / white balance kelvin | 2000 to 12000 | 0.035-0.035 | 0.803-0.803 | 30.0-30.0 | Untested: Typed input unverified | grade-24mp.tiff / `89af21fb` |
| hsl / add | Discrete / see inventory | 0.101-0.501 | 0.115-0.524 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-colour-chart.tiff / `8cfdb24a` |
| hsl / custom add delete | Discrete / see inventory | 0.048-0.060 | 0.079-0.081 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-colour-chart.tiff / `8cfdb24a` |
| hsl / edge | -8 to 8 | 0.034-0.035 | 0.074-0.078 | 30.2-31.9 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| hsl / edge detail | 0 to 100 | 0.032-0.040 | 0.071-0.073 | 29.7-31.1 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| hsl / edge feather | 0 to 16 | 0.041-0.041 | 0.075-0.076 | 30.7-31.9 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `4f5a5e14` |
| hsl / feather | 1 to 90 | 0.032-0.040 | 0.069-0.070 | 27.7-31.4 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `4f5a5e14` |
| hsl / hue | -180 to 180 | 0.053-0.053 | 0.069-0.071 | 29.4-30.2 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| hsl / luminance | -2 to 2 | 0.037-0.056 | 0.071-0.073 | 29.8-31.0 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| hsl / opacity | 0 to 1 | 0.032-0.041 | 0.069-0.070 | 30.0-31.4 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `4f5a5e14` |
| hsl / pick | Discrete / see inventory | 0.103-0.515 | 0.113-0.532 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-colour-chart.tiff / `8cfdb24a` |
| hsl / saturation | -100 to 100 | 0.041-0.044 | 0.073-0.074 | 29.7-31.0 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| hsl / selection toggle | Discrete / built-in Red channel | 0.390-1.961 | 0.475-1.661 | Not measured / N/A | Not met: SDR show exceeds 1 s; HDR show meets; hide 0.019-0.033 s. Decoded overlay/state and photograph restoration verified; surrounding Exposure references not measured | grade-colour-chart.tiff / `5359ea80`, November 11 W11 |
| hsl / subtract | Discrete / see inventory | 0.091-0.512 | 0.111-0.519 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-colour-chart.tiff / `8cfdb24a` |
| hsl / uniformity | 0 to 100 | 0.034-0.046 | 0.072-0.075 | 30.4-30.9 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| hsl / width | 1 to 180 | 0.038-0.046 | 0.071-0.074 | 28.7-29.3 | Met (measured observations only) | grade-24mp.tiff / `4f5a5e14` |
| lens aperture | 0.1 to 128 | 6.024-6.024 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): Gesture only; surrounding Exposure references are in value-control rows; settled preview at or over 1 second; Typed input unverified; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| lens ca | Discrete / see inventory | 5.867-5.867 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): Gesture only; surrounding Exposure references are in value-control rows; settled preview at or over 1 second; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| lens distance | 0.01 to 1000000 | 6.110-6.110 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): Gesture only; surrounding Exposure references are in value-control rows; settled preview at or over 1 second; Typed input unverified; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| lens distortion | Discrete / see inventory | 6.174-6.174 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): Gesture only; surrounding Exposure references are in value-control rows; settled preview at or over 1 second; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| lens focal | 0.1 to 2000 | 6.334-6.334 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): Gesture only; surrounding Exposure references are in value-control rows; settled preview at or over 1 second; Typed input unverified; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| lens mode | Discrete / see inventory | 4.153-4.153 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): Gesture only; surrounding Exposure references are in value-control rows; settled preview at or over 1 second; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| lens profile | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| lens profile search | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| lens vignetting | Discrete / see inventory | 6.036-6.036 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): Gesture only; surrounding Exposure references are in value-control rows; settled preview at or over 1 second; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| local adjustments /  | 0 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| local exposure | -8 to 8 | 0.034-0.040 | 0.048-0.060 | 35.8-44.7 | Untested: Reset unverified; Driver compared mask preview before the first grade edit with the photograph after it; editing intentionally hides the mask. Photo-to-photo native rerun restores exactly. | grade-24mp.tiff / `5f7250c4`; grade-24mp.tiff / `8cfdb24a` |
| local opacity | 0 to 1 | 0.029-0.036 | 0.051-0.053 | 32.7-34.6 | Untested: Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local overlay color | Discrete / see inventory | 0.028-0.030 | 0.040-0.043 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / author brush | Discrete / see inventory | 0.221-0.239 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| local / author linear gradient | Discrete / see inventory | 0.166-0.167 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| local / author luminance range | Discrete / see inventory | 0.123-0.132 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| local / author path | Discrete / see inventory | 0.159-0.174 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Reset unverified; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| local / blacks | -2 to 2 | 0.040-0.048 | 0.047-0.052 | 33.2-40.7 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / contrast | -2 to 2 | 0.030-0.042 | 0.057-0.059 | 34.5-36.2 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / detail / clarity amount | -100 to 100 | 0.033-0.036 | 0.063-0.068 | 34.1-36.1 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / detail / clarity radius percent | 0.2 to 3 | 0.059-0.064 | 0.077-0.084 | 36.9-40.3 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / detail / sharpen amount | 0 to 200 | 0.031-0.037 | 0.077-0.085 | 34.5-42.3 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Driver error (see JSON); Exception: native Detail judgement demonstrated change/reset; reduction at Fit hides fine sharpening. | grade-24mp.tiff / `5f7250c4`; grade-24mp.tiff / `8cfdb24a` |
| local / detail / sharpen radius px | 0.3 to 3 | 0.059-0.061 | 0.073-0.082 | 32.6-34.9 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Reset unverified | grade-24mp.tiff / `5f7250c4`; grade-colour-chart.tiff / `8cfdb24a` |
| local / detail / sharpen threshold | 0 to 100 | 0.057-0.060 | 0.075-0.086 | 32.2-33.8 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Exception: native Detail judgement demonstrated change/reset; reduction at Fit hides fine sharpening. | grade-24mp.tiff / `5f7250c4`; grade-colour-chart.tiff / `8cfdb24a` |
| local / detail / texture amount | -100 to 100 | 0.027-0.037 | 0.047-0.062 | 33.6-50.3 | Not met (real problem): Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / duplicate delete | Discrete / see inventory | 0.027-0.032 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| local / highlights | -2 to 2 | 0.030-0.036 | 0.038-0.054 | 35.5-35.6 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / hsl / feather | 1 to 90 | 0.041-0.042 | 0.068-0.072 | 29.0-29.3 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / hsl / hue | -180 to 180 | 0.046-0.053 | 0.070-0.076 | 29.3-29.6 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / hsl / luminance | -2 to 2 | 0.041-0.047 | 0.065-0.072 | 30.1-30.3 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / hsl / opacity | 0 to 1 | 0.046-0.048 | 0.072-0.073 | 28.9-29.9 | Untested: Typed input unverified; typed value differs from entered value | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / hsl / saturation | -100 to 100 | 0.039-0.042 | 0.069-0.074 | 29.5-30.5 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / hsl / uniformity | 0 to 100 | 0.041-0.044 | 0.074-0.077 | 29.3-30.2 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / hsl / width | 1 to 180 | 0.042-0.047 | 0.065-0.082 | 28.9-29.2 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / invert | Discrete / see inventory | 0.053-0.054 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `8cfdb24a` |
| local / midtones | -2 to 2 | 0.034-0.034 | 0.056-0.066 | 33.5-35.9 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / saturation | -1 to 3 | 0.027-0.035 | 0.056-0.056 | 35.8-35.8 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / shadows | -2 to 2 | 0.033-0.033 | 0.055-0.057 | 34.7-35.0 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / tint | -2 to 2 | 0.038-0.038 | 0.052-0.055 | 35.4-37.5 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / vibrance | -1 to 3 | 0.032-0.035 | 0.037-0.058 | 33.5-41.4 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| local / white balance kelvin | 1000 to 25000 | 0.033-0.036 | 0.052-0.060 | 32.8-34.9 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| mask / brush flow | 1 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / brush hardness | 0 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / brush opacity | 1 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / brush radius | 0.002 to 0.2 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / edge | -8 to 8 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / edge detail | 0 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / edge feather | 0 to 16 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / feather softness | 0 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / gradient fan | -100 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / hue center | 0 to 360 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / hue smoothness | 1 to 90 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / hue width | 1 to 180 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / mask feather | 0 to 100 | 0.035-0.047 | 0.063-0.077 | 35.0-37.5 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| mask / mask opacity | 0 to 100 | 0.027-0.033 | 0.051-0.059 | 38.3-41.7 | Met (measured observations only) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| mask / mask shift edge | -100 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / range / Dark fade / 0 | -24 to 24 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / range / Dark full / 1 | -24 to 24 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / range / Light fade / 3 | -24 to 24 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / range / Light full / 2 | -24 to 24 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| mask / range / Lower reference nit edge / 0 | -10.987264012072538 to 5.622376462364273 | 0.029-0.053 | 0.067-0.075 | 0.0-0.0 | Not met (real problem): Driver could not finish; drag below 20 presentations/s; review whether pointwise; Driver error (see JSON) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| mask / range / Lower refined edge / 0 | 0 to 1 | 0.041-0.042 | 0.071-0.071 | 0.0-0.0 | Not met (real problem): Driver could not finish; drag below 20 presentations/s; review whether pointwise; Driver error (see JSON) | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| mask / range / Upper reference nit edge / 1 | -10.987264012072538 to 5.622376462364273 | 0.043-0.053 | 0.065-0.097 | 0.0-0.0 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; drag below 20 presentations/s; review whether pointwise; Driver error (see JSON) | grade-24mp.tiff / `5f7250c4`; grade-colour-chart.tiff / `8cfdb24a` |
| mask / range / Upper refined edge / 1 | 0 to 1 | 0.027-0.045 | 0.078-0.080 | 0.0-0.0 | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Driver could not finish; drag below 20 presentations/s; review whether pointwise; Driver error (see JSON); Fixture/prerequisite inconclusive: no sampled difference is not a demonstrated app defect; consult W10 chart rerun. | grade-24mp.tiff / `5f7250c4`; grade-colour-chart.tiff / `8cfdb24a` |
| mask / saturation floor | 0 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| perspective horizontal | -100 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| perspective rotate | -45 to 45 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| perspective vertical | -100 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo border color | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo border enabled | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo border slider | 0 to 50 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo border unit | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo border value | 0 to  | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo frame color | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo frame enabled | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo frame slider | 0 to 50 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo frame unit | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo frame value | 0 to  | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| photo framing enabled | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| raw edge colour expand | 0 to 3 | 13.642-13.642 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): settled preview at or over 1 second; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| raw highlight method | Discrete / see inventory | 13.257-13.257 | Not measured | Not measured / N/A | Exception (heavy RAW; remaining gaps listed): settled preview at or over 1 second; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| raw highlight threshold | 0.5 to 1.5 | 6.127-6.127 | Not measured | 0.0-0.0 | Exception (heavy RAW; remaining gaps listed): settled preview at or over 1 second; Missing Fit/100% check; Missing rendition; Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open. | grade-review-raw.ARW / `4881e885` |
| retouch feather | 0 to 100 | 0.314-0.624 | 0.278-0.617 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Fixture: method pairs can coincide on uniform donors. Marked, separate repairs and Standard versus Original Texture are the qualifying rerun; no disconnected control is established. Fixture: native defect/edge probes changed and reset; Fit downsampling hides the small repair-setting difference. | grade-24mp.tiff / `a8d1b318`; grade-retouch-defects.tiff / `8cfdb24a` |
| retouch hardness | 0 to 100 | 0.331-0.709 | 0.270-0.600 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Driver could not finish; Driver error (see JSON); Typed input unverified; typed value differs from entered value; Fixture: method pairs can coincide on uniform donors. Marked, separate repairs and Standard versus Original Texture are the qualifying rerun; no disconnected control is established. Fixture: native defect/edge probes changed and reset; Fit downsampling hides the small repair-setting difference. | grade-24mp.tiff / `a8d1b318`; grade-retouch-defects.tiff / `8cfdb24a` |
| retouch method | Discrete / see inventory | 0.324-0.600 | 0.274-0.628 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Fixture: method pairs can coincide on uniform donors. Marked, separate repairs and Standard versus Original Texture are the qualifying rerun; no disconnected control is established. Fixture: native defect/edge probes changed and reset; Fit downsampling hides the small repair-setting difference. | grade-24mp.tiff / `a8d1b318`; grade-retouch-defects.tiff / `8cfdb24a` |
| retouch opacity | 0 to 100 | 0.333-0.617 | 0.265-0.624 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `a8d1b318` |
| retouch size | 1 to 1024 | 0.332-0.653 | 0.307-0.690 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active | grade-24mp.tiff / `a8d1b318` |
| retouch texture | 0 to 100 | 0.349-0.603 | 0.265-0.624 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Exposure reference over both 25% and 20 ms slower with effect active; Fixture: sampled picture unchanged; Fixture: method pairs can coincide on uniform donors. Marked, separate repairs and Standard versus Original Texture are the qualifying rerun; no disconnected control is established. Fixture: native defect/edge probes changed and reset; Fit downsampling hides the small repair-setting difference. | grade-24mp.tiff / `a8d1b318`; grade-retouch-defects.tiff / `8cfdb24a` |
| retouch / create remove / clone | Discrete / see inventory | 0.606-0.606 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-retouch-defects.tiff / `8cfdb24a` |
| retouch / create remove / heal | Discrete / see inventory | 0.604-0.604 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-retouch-defects.tiff / `8cfdb24a` |
| retouch / create remove / inpaint | Discrete / see inventory | 0.620-0.620 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Missing Fit/100% check; Missing rendition | grade-retouch-defects.tiff / `8cfdb24a` |
| retouch / repair bypass | Discrete / see inventory | 0.318-0.318 | Not measured | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows; Reset unverified; Missing Fit/100% check; Missing rendition; Driver baseline included the active Retouch cursor; clicking the list moves the pointer off the photo. Repair enabled-state returned, but clean-picture reset was not captured. | grade-retouch-defects.tiff / `8cfdb24a` |
| sdr tone equalizer band value | -2 to 2 | 0.031-0.031 | 0.056-0.056 | 31.4-31.4 | Untested: Missing rendition | grade-24mp.tiff / `6a95bff6` |
| sdr / bands / add remove | Discrete / see inventory | 0.039-0.039 | 0.048-0.048 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `6a95bff6` |
| sdr / bands / drag | Discrete / see inventory | 0.178-0.178 | 0.189-0.189 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `6a95bff6` |
| sdr / bands / keyboard vertical | Discrete / see inventory | 0.050-0.050 | 0.067-0.067 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `6a95bff6` |
| sdr / bands / match hdr | Discrete / see inventory | 0.059-0.059 | 0.061-0.061 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `6a95bff6` |
| sdr / blacks | -100 to 100 | 0.029-0.029 | 0.073-0.073 | 34.5-34.5 | Untested: Latest rerun incomplete: sdr-tone-settled.json; early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / blue hue | -30 to 30 | 0.051-0.051 | 0.850-0.850 | 33.2-33.2 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / blue purity | -95 to 95 | 0.049-0.049 | 0.811-0.811 | 31.5-31.5 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / commands / tone bypass | Discrete / see inventory | 0.043-0.043 | 0.066-0.066 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| sdr / commands / tone reset undo | Discrete / see inventory | 0.075-0.075 | 0.069-0.069 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| sdr / contrast | -1 to 1 | 0.051-0.051 | 0.073-0.073 | 34.9-34.9 | Untested: Latest rerun incomplete: sdr-tone-settled.json; early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / contrast pivot | 0.02 to 0.98 | 0.047-0.047 | 0.082-0.082 | 34.2-34.2 | Untested: Latest rerun incomplete: sdr-tone-settled.json; early first-exact observation; complete-settlement rerun required; Reset unverified; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / exposure | -4 to 4 | 0.039-0.039 | 0.072-0.072 | 31.0-31.0 | Untested: Latest rerun incomplete: sdr-tone-settled.json; early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / green hue | -30 to 30 | 0.050-0.050 | 0.852-0.852 | 29.0-29.0 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / green purity | -95 to 95 | 0.040-0.040 | 0.890-0.890 | 33.8-33.8 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / highlight compression attenuation | 0 to 90 | 0.034-0.034 | 0.035-0.035 | 32.9-32.9 | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression bias | -100 to 100 | 0.028-0.028 | 0.059-0.059 | 30.6-30.6 | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression color handling | Discrete / see inventory | 0.040-0.040 | 0.041-0.041 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression manual peak percent | 100 to 10000 | 0.031-0.031 | 0.051-0.051 | 32.2-32.2 | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression mode | Discrete / see inventory | 0.035-0.035 | 0.059-0.059 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression peak detail | 0 to 100 | 0.032-0.032 | 0.052-0.052 | 32.8-32.8 | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression peak measurement | Discrete / see inventory | 0.041-0.041 | 0.055-0.055 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression softness | 0 to 100 | 0.029-0.029 | 0.051-0.051 | 30.1-30.1 | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlight compression start percent | 1 to 99 | 0.039-0.039 | 0.046-0.046 | 31.5-31.5 | Exception (fixture; other view passed): Fixture: sampled picture unchanged; Fixture/prerequisite: prepared HDR Fit with manual headroom and Start 2% demonstrated change/reset. Original sampled conditions stayed unchanged; this does not qualify their native visual effect. | grade-hdr-pattern.tiff / `8cfdb24a` |
| sdr / highlight desaturation | 0 to 100 | 0.040-0.040 | 0.895-0.895 | 34.2-34.2 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / highlight desaturation start | 0.01 to 0.99 | 0.035-0.035 | 0.056-0.056 | 31.9-31.9 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| sdr / highlight section enabled | Discrete / see inventory | 0.029-0.029 | 0.050-0.050 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `b5966e15` |
| sdr / highlights | -100 to 100 | 0.032-0.032 | 0.062-0.062 | 32.8-32.8 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| sdr / highlights center | -8 to 8 | 0.027-0.027 | 0.062-0.062 | 36.5-36.5 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| sdr / highlights width | 0.5 to 12 | 0.029-0.029 | 0.053-0.053 | 33.5-33.5 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| sdr / match entire | Discrete / HDR exposure +0.15, saturation 0 | 1.117-1.442 | 1.103-1.146 | Not measured / N/A | Not met: colour fit itself exceeds 1 s; changed picture and revert verified in both views | grade-24mp.tiff / `5359ea80`, November 11 W11 |
| sdr / midtones | -100 to 100 | 0.052-0.052 | 0.082-0.082 | 32.0-32.0 | Untested: early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / midtones center | -8 to 8 | 0.027-0.027 | 0.053-0.053 | 31.0-31.0 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| sdr / midtones width | 0.5 to 12 | 0.055-0.055 | 0.071-0.071 | 31.1-31.1 | Untested: early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / red hue | -30 to 30 | 0.054-0.054 | 0.890-0.890 | 30.3-30.3 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / red purity | -95 to 95 | 0.053-0.053 | 0.902-0.902 | 32.7-32.7 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / saturation | -1 to 1 | 0.044-0.044 | 0.896-0.896 | 32.5-32.5 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / shadow desaturation | 0 to 100 | 0.036-0.036 | 0.816-0.816 | 33.5-33.5 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / shadow desaturation start | 0.001 to 1 | 0.039-0.039 | 0.052-0.052 | 32.0-32.0 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| sdr / shadows | -100 to 100 | 0.034-0.034 | 0.074-0.074 | 30.1-30.1 | Untested: Latest rerun incomplete: sdr-tone-settled.json; early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / shadows center | -8 to 8 | 0.043-0.043 | 0.064-0.064 | 32.5-32.5 | Untested: Latest rerun incomplete: sdr-tone-settled.json; early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / shadows width | 0.5 to 12 | 0.030-0.030 | 0.072-0.072 | 32.0-32.0 | Untested: early first-exact observation; complete-settlement rerun required; Typed input unverified | grade-24mp.tiff / `d5bd061e` |
| sdr / tint | -1 to 1 | 0.038-0.038 | 0.886-0.886 | 32.8-32.8 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / tint hue | -180 to 180 | 0.034-0.034 | 0.053-0.053 | 31.5-31.5 | Met (measured observations only) | grade-colour-chart.tiff / `05e34f85` |
| sdr / tint purity | 0 to 20 | 0.051-0.051 | 0.854-0.854 | 34.4-34.4 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / tone equalizer section enabled | Discrete / see inventory | 0.030-0.030 | 0.036-0.036 | Not measured / N/A | Met (measured observations only) | grade-24mp.tiff / `6a95bff6` |
| sdr / tone section enabled | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: Invalid: overlapping GPU drivers after non-atomic PowerShell directory creation on November 11; excluded from timing acceptance; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `c3b5a65e` |
| sdr / vibrance | -1 to 1 | 0.032-0.032 | 0.847-0.847 | 34.8-34.8 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| sdr / white balance kelvin | 2000 to 12000 | 0.035-0.035 | 0.873-0.873 | 30.6-30.6 | Untested: Typed input unverified | grade-24mp.tiff / `888364f4` |
| shared / false color band anchor | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| shared / false color ceiling nits | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| shared / geometry / custom ratio / height | 0.01 to  | 0.013-0.013 | Not measured | Not measured / N/A | Untested: Fixture: sampled picture unchanged; Typed input unverified; Missing Fit/100% check; Missing rendition; Fixture: ratio constraints do not change committed pixels until a crop is authored and Apply is pressed; use the committed crop gesture row. | grade-24mp.tiff / `ab3d8f55` |
| shared / geometry / custom ratio / width | 0.01 to  | 0.011-0.011 | Not measured | Not measured / N/A | Untested: Fixture: sampled picture unchanged; Typed input unverified; Missing Fit/100% check; Missing rendition; Fixture: ratio constraints do not change committed pixels until a crop is authored and Apply is pressed; use the committed crop gesture row. | grade-24mp.tiff / `ab3d8f55` |
| shared / geometry / ratio mode | Discrete / see inventory | 0.014-0.014 | Not measured | Not measured / N/A | Untested: Fixture: sampled picture unchanged; Missing Fit/100% check; Missing rendition; Fixture: ratio constraints do not change committed pixels until a crop is authored and Apply is pressed; use the committed crop gesture row. | grade-24mp.tiff / `ab3d8f55` |
| shared / geometry / straighten angle | -45 to 45 | Not measured | Not measured | Not measured / N/A | Untested: Driver could not finish; Driver error (see JSON); Needs three trials; Reset unverified; Typed input unverified; Missing Fit/100% check; Missing rendition | grade-24mp.tiff / `ab3d8f55` |
| shared / local adjustments enabled | Discrete / see inventory | 0.023-0.047 | 0.041-0.048 | Not measured / N/A | Untested: Reset unverified | grade-24mp.tiff / `4881e885`; grade-24mp.tiff / `5f7250c4` |
| shared / overlay mode | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| shared / overlay opacity | 0.1 to 1 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| shared / overlay threshold | 10 to 4000 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| tone equalizer band value | -2 to 2 | 0.034-0.034 | 0.054-0.054 | 31.5-31.5 | Untested: Typed input unverified; Missing rendition | grade-24mp.tiff / `6a95bff6` |
| vignette center x | 0 to 100 | 0.026-0.052 | 0.039-0.048 | Not measured / N/A | Untested: Typed input unverified | grade-24mp.tiff / `dbf9912e` |
| vignette center y | 0 to 100 | 0.025-0.027 | 0.033-0.035 | Not measured / N/A | Not met (real problem): Exposure reference over both 25% and 20 ms slower after reset; Typed input unverified | grade-24mp.tiff / `dbf9912e` |
| vignette / centre handle | Discrete / see inventory | 0.122-0.139 | 0.120-0.164 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-24mp.tiff / `8cfdb24a` |
| wheels / highlights / pad reset | Discrete / see inventory | 0.143-0.174 | 0.167-0.175 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-colour-chart.tiff / `05e34f85` |
| wheels / midtones / pad reset | Discrete / see inventory | 0.165-0.175 | 0.167-0.174 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-colour-chart.tiff / `05e34f85` |
| wheels / shadows / pad reset | Discrete / see inventory | 0.164-0.174 | 0.156-0.162 | Not measured / N/A | Untested: Gesture only; surrounding Exposure references are in value-control rows | grade-colour-chart.tiff / `05e34f85` |
| zoom readout | Discrete / see inventory | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| zoom slider | 0 to 100 | Not measured | Not measured | Not measured / N/A | Untested: no run | - |
| Curves remaining actions | keyboard point movement | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/curve-editor.js` |
| Exposure Bands remaining actions | horizontal movement and influence wheel/bracket gestures | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/tone-equalizer.js` |
| Color wheels remaining actions | range keyboard navigation, module reset and pad throughput | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/color-wheels.js` |
| HSL remaining actions | wheel/range handles, range removal and Local picker | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/hsl-panel.js` |
| Local masks remaining actions | Hue sampling, Boolean combinations, Bezier/edge modes, fan, native authoring and list rename/reorder | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/mask-controls.js; frontend/mask-gestures.js; frontend/local-adjustments-ui.js` |
| Retouch remaining actions | source/destination moves, list/retry/cancel and native paint creation | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/retouch-ui.js` |
| Geometry remaining actions | perspective guides and crop-guide variants | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/geometry-tools.js` |
| Vignette remaining actions | Pick centre, overlay toggle and handle keyboard movement | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/color-wheels.js` |
| Film Look remaining actions | stage shortcuts, per-stock reset dots and SDR copy | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/group-presets.js; frontend/adjustment-controls.js` |
| Grade commands remaining actions | preset save/import/export and remaining group-copy actions | Not measured | Not measured | Not measured | Untested: bounded review; measured actions are listed individually above | `frontend/sdr-match-ui.js; frontend/group-presets.js; frontend/adjustment-controls.js` |

**Conditions and evidence:** fresh W10 24 MP TIFF resized from the same RAW (W1 original TIFF was not retained; not an identical baseline), repeated colour/detail chart, marked-photo Retouch fixture and a disposable 42 MP Sony RAW with 714,405 clipped sensels. Windows/Electron, NVIDIA GPU, 2560x1440, DPR 1. Atomic shared lock, batches under about 15 minutes. No preview/export colour agreement or HDR ceiling sign-off is claimed by these signatures.

All evidence is in the main checkout's `codebase/output/performance/grade-0-9-2/`: `summary.json`, `timings.csv`, `w10-triage.json`, `w10-fixtures.json` and the named batch reports. They retain exact samples, commit/hash, prerequisites and errors. W1's archive and failed attempts remain intact; later incomplete attempts never erase earlier timings.

**Error triage:** captured source-tile 409 bodies confirm superseded edit revisions; Denoise/peak 409s are recoverable obsolete-work refusals. W1 did not capture bodies, so its exact refusal reason remains unconfirmed. Current-preview settlement is required. Fractional Push/Pull and Match saturation 30 instead of 0.3 were driver mistakes, as were hidden/detached-field waits and waiting for a rotation draft before Apply. The stronger Match recipe was correctly refused by the existing quality gate (OKLab P95 0.066 exceeds 0.05); a modest exposure-only fit passed. Unknown errors stay open; expected cancellation/refusal is retained and classified rather than suppressed.

<!-- grade-sweep-end -->
### W9 targeted slowdown follow-up (November 11, 2026)

Implementation: `0dc12ce8` (rebased onto local `main` `8d55516f`). Same-day
partial improvement, **not whole-Grade release acceptance**. No pixel formula,
export/Proof path, memory allowance or acceptance tolerance changed.

Windows / RTX 4070 Ti / Electron, 2560x1440, SDR Fit for tool/reference probes;
6000x4000 TIFF regenerated once from the shared DSC00264.ARW because W1's
scratch TIFF was absent. Original W1 TIFF byte identity is not established.
Three trials per condition, atomic shared GPU lock; final timings without
W9 fast suites; other workspace activity uncontrolled. Endpoint: exact current-generation presentation,
including pending automatic anchors, plus two animation frames, not physical
scan-out. Native background catch-up is measured separately. The combined HDR/SDR
control rows pool three change samples per lane; the reference rows contain
three samples per listed condition.

The confirmed post-tool cost is a cold highlight-anchor measurement following
a changed source, plus an avoidable 200 ms polling delay. Denoise's reconstruction
version changes and Retouch's source refresh invalidate the old measurement.
Restoring Amount/Opacity is another source change, not disabling the tool.
Repeated Exposure without another tool edit is fast even before this fix.
The fixture enables/prepares Denoise before Amount and creates three repairs
before Opacity; the baseline is before that parameter edit, not a blank grade.
The measurement was requested about 9-10 ms after input but dispatched about
210 ms after input. Presentation can arrive before the scheduler's GPU fence
retires; waking both at presentation and after that fence removes the idle poll
while retaining every foreground/interaction/generation/session guard.

| Exposure reference at SDR Fit | Before parameter edit (current final run) | Effect active | Amount/Opacity restored | Tool actually off |
| --- | --- | --- | --- | --- |
| denoise-amount | 40-69 ms (median 41) | 60-67 ms (median 67) | 62-77 ms (median 67) | 27-47 ms (median 32) |
| retouch-opacity | 28-95 ms (median 55) | 54-83 ms (median 65) | 60-80 ms (median 74) | 28-108 ms (median 35) |

Before the scheduling fix, W9 Retouch active/reset medians were 235/231 ms,
with subsequent unchanged-source probes 22-34 ms. W1 recorded Denoise
235/245 ms and Retouch 235/233 ms, versus 31-36 ms before the tool edit.
W9's pre-fix Denoise trace also shows the 200 ms delay, but overlapped the
Python suite and is trace evidence, not an isolated speed-ratio baseline.

**Remaining:** Denoise active/reset medians 67/67 ms versus 41 ms before
still exceed both 25% and 20 ms (about 26 ms). This is not waived. Retouch's
65/74 ms medians versus 55 ms before are within the combined allowance in
this run. Both tool-off medians and repeated unchanged-source medians return
to normal; individual cold probes vary, including 108 ms on Retouch disable.
Further removal of the cold measurement cost needs profiling/coordination of
shared anchor/readout GPU work, estimated 1-2 hours plus focused parity; not
attempted as another release-day scheduler change.

| Targeted control / condition | Change to settled picture (range and median) | Other observation |
| --- | --- | --- |
| `denoise-amount`, SDR Fit | 113-125 ms (median 117) | Reset sampled pixels restored; not a preview/export parity claim |
| `retouch-opacity`, SDR Fit | 377-996 ms (median 389) | Reset sampled pixels restored; not a preview/export parity claim |
| `current.color_grading.shadows.saturation`, HDR/SDR 100% | 33-54 ms (median 41) | Background completion remains about 0.75-0.84 s |
| `current.color_grading.shadows.luminance_ev`, HDR/SDR 100% | 32-85 ms (median 49) | Background completion remains about 0.75-0.84 s |
| `current.color_grading.blending`, HDR/SDR 100% | 32-67 ms (median 51) | Background completion remains about 0.75-0.84 s |
| `current.film_look.lens_strength`, SDR Fit | 37-82 ms (median 82) | Drag 10.5-11.5 presentations/s; below 20 |
| `current.film_look.stock_color`, SDR Fit | 39-50 ms (median 41) | Drag 15.8-16.0 presentations/s; below 20 |
| `current.film_look.grain_amount`, SDR Fit | 30-51 ms (median 44) | Drag 14.9-16.5 presentations/s; below 20 |
| `current.film_look.print_exposure`, SDR Fit | 33-45 ms (median 44) | Drag 15.6-16.5 presentations/s; below 20 |

**Color Grading:** the old 0.76-0.83 s observations included the coordinator's
700 ms offscreen whole-frame catch-up. The selected pointwise controls above
settle in 32-85 ms at 100%; no render-path fix is needed or claimed. This is
sampling of saturation, luminance and blending in both lanes, not requalification
of every wheel gesture.

**Film Look:** no fix retained. In the selected drags, scheduler frame durations
including GPU completion are about 47-66 ms for stock controls and 76-117 ms
for lens strength. Proxy/mask awaits and CPU encode/submit are under about
1 ms on the inspected warm frames; stock-colour drags have no new GPU refusal.
The current exact Film Look graph/device completion is the dominant wait,
not repeated source upload or compilation. These observations do not isolate
individual shader passes. Reusing/specializing unchanged stages within existing
resources needs a multi-hour render-graph/shader change and film/lens parity;
there is no demonstrated cheap safe release-day fix. No budget or resolution
policy changed to raise the frame-rate number.

Evidence retained locally: `codebase/output/performance/w9-profile/{denoise,retouch}.json`
(pre-fix traces), `w9-after/{denoise,retouch}.json` (presentation-only trial,
not final), `w9-final/{denoise,retouch}.json` (final wake including GPU fence),
and `w9-after/{color-grading,film-look}.json`. Reports name their base commit;
uncommitted scheduling edits in the timing runs are the implementation now in
`0dc12ce8`. Retouch final was run after that rebase. All sampled controls
changed and restored their sampled picture. Superseded source-tile HTTP 409
errors remain recorded; these diagnostics alone are not pixel acceptance.
Final post-rebase fast checks: Node 921 passed; Python 3,244 passed, 55 skipped.
Serial locked GPU checks passed: adaptive Denoise against export Python (no
samples outside its half-float allowance), Retouch GPU/forced-CPU delivery
(six Proof/export identity cases), and highlight-compression/anchor scheduling
parity. Logs: `codebase/output/w9-{denoise-adaptive-parity,retouch-delivery,gpu-highlight-compression-parity}.log`.

Standard 90-second Library smoke at `0dc12ce8`, plain Electron 2560x1440,
shared mixed photo copies, no W9 fast suite concurrently: first/ten/twenty
pictures 1.2/2.7/6.7 s; 29 of 33 shown by 90 s, four not shown. No photo
errors or memory violation; independent peak 3,034,693,042 bytes under 4 GB.
The existing drawing-gap failure category repeats: 1,134 ms versus the
unchanged 250 ms gate. No rerun or unrelated investigation. This is a
functional smoke, not a Grade speed comparison. Report:
`codebase/output/quick-library-check/w9-slowdowns/report.json`.
End scratch census: 35.0 GB, overwhelmingly the shared test-photo junction,
below the unchanged 100 GB limit. Failed launch scratch removed; reports and
check logs retained, with no output files committed.

The W1/W10 control ledger above includes pre-W9 timings; W9 supersedes only the
named conditions above. Other lanes, zooms and controls were not rerun.

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Local tool enable, 24 MP, Fit / 100% | about 0.3 s | 0.041 / 0.045 s | grade.md | Met |
| Local range change, 24 MP, Fit / 100% | about 0.3 s | 0.042–0.054 / 0.129–0.141 s | grade.md | Met |
| Local Exposure drag | — | about 31 frames/s | grade.md | Baseline |
| Retouch, warm small spot | 1 s | 0.70–1.04 s | grade.md, Oct 23 | Met (borderline) |
| Local brush erase release to settled mask (synthetic) | No agreed timing target | 206 ms (one observation) | Nov 8, working tree on 6c6ceb34; brush-mask-interaction.js during bracket-key check, Electron with concurrent Python suite; not a throughput comparison | Unknown |
| Open the 297 MP line-scan DNG in Grade → first frame | — | import 19–30 s; first frame 34 s | Oct 30, Steve's app and disposable copies; backend holds 3.7 GB, spikes to 9.7 GB | Baseline |
| Open a 50 MP ARW (DSC00636) in Grade → import | — | 7.8–9.6 s | Oct 30, disposable copy, headless Edge | Baseline |
| Rating save (background) | — | about 110 ms | photo-library.md | Baseline |
| Grade import, Sony 42 MP DSC07187.ARW, CPU / GPU trial | First frame <2.5 s proposed; about 2x faster opening | CPU 6.090 s; GPU trials 5.610-5.929 s (final 5.929 s); backend peak 3.728 / 1.525 GB | Nov 2, `grade-gpu-raw`, draft based on `3abfd5b`; shared AHD correction in this commit; disposable Electron profile, 2560x1440, test-photo copy, independent 0.1 s process census; import-job totals, not first frame | Speed target not met; Sony HDR fails; Grade GPU route disconnected |
| Grade import, Canon IMG_7723.CR3, CPU / GPU trial | Report import total and backend peak | 1.826 / 3.453 s; backend 1.405 / 1.370 GB | Nov 2, same baseline draft, before shared AHD correction; one paired run; same isolated conditions | GPU slower; finished SDR/HDR passed before correction; not rerun afterward |
| Grade import, Olympus P1010004.ORF, CPU / GPU trial | Report import total and backend peak | CPU 1.652 s; GPU 2.793-3.287 s; final corrected run 2.973 s, backend 1.117 / 0.672 GB | Nov 2, same branch and isolated conditions; CPU baseline plus GPU investigations; corrected full-size SDR/HDR checks pass | GPU slower; shared correction retained, Grade handoff stopped |

November 2 stop decision: the final Sony trial's full readback cost 3.318 s.
The 3.7/1.5 GB figures above are backend working sets, including Python
helpers, not the whole app. Sony whole-app peaks were 5.116/4.190 GB, so the
whole-app ceiling is not qualified. The final Sony trial included a denser
four-pixel lens grid and larger transfer bands, both removed after the HDR
failure (mean 1.06388, p99.9 7.58581). The mismatch was traced to sampled
lens coordinates losing Lensfun's fine-scale full-size variation. No agreed
number changed. Steve chose to stop; the uncommitted Grade GPU draft stays
on this branch only. Results: `codebase/output/test-grade-gpu-raw/paused-results.json`.

## 6. Export and Proof

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Batch export pace | 5 s per photo | about 5.2 s per photo (GPU turn 2.7 s) | export-and-proof.md, Oct 20 | Not met (close) |
| Full-size single export | under 15 s | 24 s | same | Not met |
| Full-size Ultra HDR export, CPU | — | about 33 s | Oct 19 | Baseline |
| GPU export then full-size Proof of the same grade | — | 57 s (was 133 s: Proof rendered again) | Nov 8, `gpu-delivery-ceiling`, DSC07060, 4000 px long edge, includes app start-up work; Proof now reuses the export's render | Baseline |
| Independent export plus full-size Proof, W5 repeatability probe | — | GPU 56.3–80.3 s per pair; forced CPU 411.7 s | Nov 11, parent `40c633c9`, DSC07060 saved 800-nit grade, 4000 px, 2560x1440 Electron, fast suites running concurrently; includes two peak decodes; diagnostic, not a speed comparison | No timing qualification |
| Ultra HDR JPEG file write, 42 MP, by step | Part of the single-export target | 13.1 s total: HDR half-float prepare and raw write 1.95 s; SDR to 8-bit sRGB with dither 2.33 s; SDR JPEG 0.23 s; raw SDR write 0.27 s; ultrahdr_app encode 2.56 s; gain-map clean-up pass 5.43 s (its tool runs 0.21 s, the rest is Python filtering) | Nov 2, main `120a394`, synthetic 7968×5304 picture, quality 95, 4:4:4, full-size gain map, 12-core machine; pixel steps single-threaded, filter 2–3 threads | Ceiling check (philosophy 3): per-pixel steps are about 9.4 s, about 39% of a 24 s export, so not a GPU case; using all cores is the cheaper route |

Ceiling checks, November 2 (philosophy 3; no code built). AVIF gain-map
decode per step, fresh process, Steve's machine, nothing else running
(`decode_avif`; the Library skips the colour-conversion step, so its wait is
inspect + HDR rebuild + SDR rendition):

| File (MP) | Helper AV1 decode | Helper HDR rebuild | Rest of rebuild step | SDR rendition | Colour conversion (Grade only) | Peak memory above baseline: rebuild step / other steps |
| --- | --- | --- | --- | --- | --- | --- |
| DSC01848_finished.avif (13.7) | 1.58 s | 2.95 s | 0.13 s | 0.33 s | 4.41 s | 1.75 / ≤0.42 GB |
| DSC00264_finished.avif (18.0) | 1.81 s | 3.69 s | 0.15 s | 0.37 s | 5.73 s | 2.31 / ≤0.58 GB |
| LR-classic-hdr-source-test-1.avif (42.2) | 3.90 s | 9.18 s | 0.23 s | 1.07 s | 13.92 s | 1.89 / ≤1.16 GB |

The HDR rebuild is 57–61% of the Library's AVIF wait and the step that sets
its memory peak (the helper already uses all 12 cores), so a GPU rebuild
passes the bar and could also let two AVIFs develop at once. Grade's AVIF
colour conversion (4.4–13.9 s) is a CPU-cores case, not a GPU one.

November 2 integrated AVIF baseline (`fe2c3c0`, unchanged main code),
`node tools/quick-library-check.cjs --folder=avif-gainmap --label=avif-gainmap-before`,
isolated test profile, default 2560x1440, cold picture caches, two reusable
copies (DSC01848 and DSC00264 only; the 42 MP comparison was not run):

| File | RGB decode | Native AV1 / HDR rebuild | Request to completed development | Folder open to shown |
| --- | --- | --- | --- | --- |
| DSC01848_finished.avif | 6.609 s | 2.259 / 3.552 s | 8.178 s | 8.775 s |
| DSC00264_finished.avif | 7.835 s | 2.745 / 4.201 s | 9.060 s | 9.632 s |

Both native helpers already overlapped. 2/2 pictures shown at 30 and 60 s;
fill 9.632 s. Independent process-tree charge peaked at **5,912,424,444 bytes**,
above 4.4 GB; the >4 GB episode lasted 5.293 s and settled below target.
Backend-reported app-memory peak was 5.412 GB (not backend-only process RAM).
No failed pictures or zeroed stored channels (2 audited); no frame/timer
interval above the harness thresholds. Evidence:
`codebase/output/quick-library-check/avif-gainmap-before/{report.json,backend.log,memory.jsonl}`.
The earlier 57-61% claim describes the decoder boundary, not the measured
whole screen wait: native reconstruction here is 43-46% of request-to-developed
time. Avoiding the second SDR decode could add savings, but no GPU speed or
memory improvement has been measured. Stopped before implementation under
the brief's code-contradiction protocol for Steve's admission-order decision.
No estimates, budgets, picture identities or processing code changed.

## 7. Background work and plumbing

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Memory check (`/api/library/memory`) | under its 2 s timeout | Longest 110.5–339.7 ms; 0 timeouts in 112 + 121 requests | Oct 31 phase 3a.2, Aceh repeats 6/7, independent observer | Met |
| Memory pressure: Chromium signals and cache trims, cold Aceh run | None below target; at most one per level rise plus one per 10 s | One moderate trim/relay in each repeat; zero memory-refusal signals | Oct 31 phase 3a.2, target 3.40 GB; moderate relay collects page garbage | Met |
| Longest marks-lock hold | 250 ms | 375 ms (reconcile) | Oct 29 | Not met |
| Index metadata read, 12 files | — | 9.7 ms warm in parallel | photo-library.md | Baseline |
| Recovery work | — | 2,044 pieces in one session, longest 14.8 s | Oct 30 18:18 | Unknown |
| Helper folder scan | — | p50 13 ms, max 47 ms | Oct 30 18:18 | Baseline |

## 8. Gaps to fill

No recent number for:

* Grade: opening a photo, slider latency at Fit and 100% for each tool,
  HDR/SDR switch.
* Library: HDR/SDR switch in the grid, paste to many photos, rename, move
  and Delete.
* A cold-launch measurement of each startup target.
* One timing per supported file type (scheduler design, phase 0).

October 31 acceptance clarification: the stopped phase 3c.2 AVIF sample
(4.011418177 GB) passes the new ceiling +10% peak rule. Completion, duration
and settling were not observed; no new timing is claimed. The default mixed
folder will be rerun after Parts B/C. See scheduler design decision 16.


November 1 Grade regression rerun on unchanged `b3d5eed`: pause 469 ms,
first ordinary 477 ms, close/save 402 ms, resume 261 ms. Exposure saved;
all existing limits pass. Earlier 2.705 s pause not reproduced; cause unresolved.
Evidence: `codebase/output/grade-regression-baseline.json`.



November 1, Single priority and core-shared decoding (commits `2cca525`,
`469af11`, `3b60ebc`, `a951a4b`). Library `--single`, 2560x1440, 4 GB, cold
profile. App time is the photo's own key-press (or click) to the 2560
picture; wall is the harness including its own polling.

| Measure | Before (`84cad99`) | After |
| --- | --- | --- |
| Single open, app time | not recorded | 1270 ms |
| Single open, harness wall | 5551 ms | 5384 ms |
| Step median, app time | not recorded | about 300 ms |
| Step median, harness wall | 15298 ms | 158-9903 ms (varies) |
| Prepared neighbour, app time | not recorded | 9-49 ms |
| Unprepared RAW, app time | not recorded | 302 ms |
| Unprepared HEIC, app time | not recorded | 3133 ms |
| Cold 90 s grid, shown at 30 s / 60 s | 26-27 / 31 | 25 / 31 |
| Cold 90 s grid peak, backend | 4.253 GB | 3.749 GB |
| Phase0 presented | 22/27 | 22/27 |
| Phase0 peak | 4.025 GB | 3.912 GB |
| Aceh first screen | 13.8 s | 12.8 s, 14.6 s |
| Aceh second screen | 14.1 s | 18.4 s, 23.6 s (not reproduced) |
| Grade pause / first ordinary / close / resume | 919 / 926 / 244 / 748 ms | 987 / 994 / 333 / 678 ms (one run 1324 ms pause) |
| Longest single GPU submission | 42 ms (highlights mean) | 195 ms (PNG reduce), 121 ms ARW upload |

Decode, Single edge 2560, median of three:

| File | Before | After |
| --- | --- | --- |
| `_DSC6510-1.png`, 223 MB, 16-bit | 5084 ms | 4956 ms |
| `iphone_16_pro_IMG_3324.HEIC` | 2474 ms | 1666 ms |
| `IMG_6705.HEIC` | 1428 ms | 1013 ms |
| `DSC08883.avif` | 6167 ms | 4744 ms |
| `-4_stops...DSC08883_03.avif` | 6906 ms | 5597 ms |
| `LR-classic-hdr-source-test-1.avif` | 30326 ms | 24574 ms |

Handoff per photo: request 9-86 ms, accept 86-310 ms, describe 6-27 ms.

November 2 AVIF memory correction (after `d54a2c1`, Steve's approved
measured-peak-plus-25% method; GPU reconstruction dropped): the uncommitted
3 GB gain-map floor admitted neither AVIF at default 4 GB (1.989 GB peak,
no picture after 90 s). It is discarded. Decoder-only GPU feasibility measured
a combined 3.092 GB for the two helpers before reconstruction/handoff;
with the roughly 1.85 GB app baseline this already exceeds 4.4 GB before a
margin. Removing reconstruction at zero cost projected only 40.5/43.6%
whole-wait savings; Steve explicitly rejected that GPU route.

AOM 3.13.2's row-threaded path allocated full-frame superblock coefficient/
palette buffers in the base and map, about 1.03/1.37 GB at 13.7/18.0 MP.
Unchanged helper: one thread peaked 0.699/0.916 GB but AV1 decode took
6.150/6.351 s; two threads already peaked 1.729/2.292 GB; 12 threads
1.742/2.305 GB. Reconstruction added 0.41/0.54 GB in full base RGBA,
rescaled map YUV/RGBA and output RGBA while decoder scratch remained alive.
The fix opts only the helper into tile-only AOM decoding, copies exact
base/map planes and metadata, then destroys the decoder before reconstruction.
The existing reconstruction patch needed its loop index declared before the
OpenMP loop for MSVC C; arithmetic is unchanged.

Complete decode-tree peaks (Python, helper, console hosts) are now
**539,377,662 / 686,570,347 / 1,580,237,384 bytes** at 13.7/18.0/42.2 MP,
versus 1.807/2.369/1.944 GB. Decode boundary 2.150/2.485/5.090 s; whole offline
calls 2.249/2.609/5.401 s. CPU-normalized fallback peaks 0.532/0.682 GB for
the smaller files, whole calls 6.782/8.705 s (existing bounded/in-place colour
conversion). Native RGB16 SHA256 matches the old helper on all three real
files, and the existing exact native transport/fallback test passes.
Largest measured peak-per-pixel plus 25% is 49.12, rounded up to **50 bytes/
pixel** for header-confirmed gain-map AVIF source/CPU jobs, 64 MB minimum.
Plain AVIF source remains 56; quick previews, budgets and picture identities
are unchanged. Estimates at 14/18/42 MP: 0.70/0.90/2.10 GB. These measurements
cover the specified files; other encodings still rely on estimation/overrun
records. See the native helper README for the buffer sizes and build recipe.

`avif-memory-after`: cold isolated profile, 2560x1440, unchanged default 4 GB,
same two reusable AVIFs. Both grants overlap with zero admission wait.
Independent peak **2,823,742,605 bytes**, no memory violation, settles below
target; 2/2 shown, clean stored-channel audit, no cadence/errors failures.
Folder-open-to-shown **8.680/9.347 s**, versus 8.775/9.632 baseline: within
agreed 5% timing noise, no substantial whole-wait speed claim. Native AV1/
reconstruction stages: 0.307/1.005 and 0.536/1.378 s. Memory is the goal.

`avif-memory-mixed`: three existing reusable RAW copies temporarily moved
into the folder then restored. Peak **2,561,039,210 bytes**, no violation,
settles below target; all five pictures shown by 9.260 s, clean channels.
Camera previews decoded in 0.521-0.582 s, 0 ms admission wait, before native
AVIF work began. Full camera jobs waited 0 / 6.609 / 6.906 s for development/
saving places while AVIF jobs occupied them. A **4,704 ms drawing gap** failed
cadence acceptance; main-thread lateness stayed below 100 ms.

`avif-camera-overlap`: measurement-only wrapper delayed camera preview
requests by 1.2 s and was restored byte for byte. Preview grants at
1.941-1.951 s from folder open had **0 ms admission wait** during AVIF work.
Canon extraction finished in 37/50 ms. IMG_3129 preview presented at 2.035 s
while DSC01848 native work ran about 1.876-3.281 s. IMG_0114 decoded at
2.031 s but presented at 6.990 s: a **4,953 ms drawing gap** delayed it.
Backend fast-lane delivery is confirmed; continuous on-screen preview flow
is not fully qualified. Peak 2,566,915,214 bytes, no violation, settles below
target; 5/5 shown, clean channels. Full camera jobs waited 0 / 6.532 / 6.828 s.
The earlier pre-correction mixed check also failed cadence (1,958 ms); no
cause or UI repair is claimed. Steve should try the folder before further UI
investigation. Do not compare the staggered run's fill timing with normal runs.

Evidence: `codebase/output/test-avif-admission/{thread-memory,native-memory-after,full-memory-after,cpu-memory-before,exact-baselines,decode-pair}.json`;
`codebase/output/quick-library-check/{avif-admission-after,avif-memory-after,avif-memory-mixed,avif-camera-overlap}/`.

Validation for this correction: exact native transport/fallback 1 passed;
focused gain-map/admission checks 64 passed. Full Node checks: 723 passed,
5 existing failures (camera/cached loading shape, repeat coalescing,
screen-neighbour demand, Single finished canvas). Full Python checks:
2964 passed, 3 skipped, 9 existing failures (preset header scope, neutral
scene identity, reduced giant fast lane, simultaneous CPU tiers, RGB
publication guard, source baseline instrumentation, decoder error wrapping,
cache budget, retouch cache signature). Logs:
`codebase/output/test-avif-admission/{node-tests-memory,pytest-memory}.log`.
No GPU driver directly covers native AOM decoding; the real-app checks
exercise the existing GPU development route. Output remains about 26.9 GB
under the 100 GB limit; native build intermediates and decoded RGB copies
were removed, reusable photo copies retained.

### November 2, 2026 — Batch 2 Library validation

One isolated 90-second quick Library run at 2560x1440 with the existing mixed
fixture folder and unchanged memory settings. These observations are not a
controlled speed comparison; OS file cache was not flushed.

| Action | Observed | Acceptance / result |
| --- | --- | --- |
| Folder open to first / 10 / 20 pictures shown | 8.6 / 16.5 / 29.0 s | One run; 28 visible pictures shown by 60 s |
| Longest drawing gap | 2,934 ms | Failed unchanged 250 ms limit; main-thread lateness 95 ms |
| DSC00264.ARW Grade first frame, CPU / GPU | 37.953 / 13.571 s | One observation each in edge-colour driver; later Library GPU development stopped on three invalid pixels |

Quick-run memory acceptance and stored-colour checks passed. The existing JXL
source-colour gate remained unsupported. The edge-colour driver did not reach
Export/Proof, so no output-agreement claim follows from these timings. Later
failures were left for the relevant batches; no limits or budgets changed.
Evidence: `codebase/output/quick-library-check/batch2/{report.json,backend.log,scenario.json}`,
`codebase/output/edge-colour-raw/1793630579320/results.json`, and
`codebase/output/batch2-edge-colour.log`. See the Library module PRD's Batch 2
validation note for the fast suites, other drivers and cleanup.


### November 3, 2026 — Batch 3 DNG / shared RGB validation

Current Batch 3 DNG correction, isolated Electron at 2560x1440, unchanged
settings and uncontrolled OS cache. These are validation observations, not
a speed comparison. The focused DNG driver's first CPU mixed folder did not
finish within its existing 240-second wait, after synthetic geometry passed;
photographic DNG CPU/GPU completion was not measured. The shared RGB precision
check passed, with preparation waits of 0.30–2.34 s across seven mixed-size
JPEG/PNG/TIFF/EXR cases. Ultra HDR and the combined codec case closed their
Electron windows before reporting a comparison or usable preparation wait.
Evidence: `codebase/output/batch3/{dng,rgb-precision,rgb-ultrahdr,rgb-ultrahdr-codecs}.log`.


**Batch 3 native / Single validation, November 3, 2026.** Current Batch 3
native handoff correction; isolated Electron at 2560x1440, unchanged limits.
The focused RAW Single driver completes full-size GPU development but does
not finish its native save handoff; stopped after roughly five minutes.
A brief whole-app memory peak was 8.25 GB against the unchanged 4 GB ceiling;
this run does not qualify native detail. No CPU/GPU speed claim follows.
The 90-second quick check completed ten Single steps: open 1.36 s; steps
0.019–7.05 s, median 2.09 s. Longest drawing gap 4,088 ms fails the existing
250 ms limit; main-thread lateness was 83 ms. Memory and stored-colour checks
pass (3.56 GB peak, no breach). One observation, not a controlled comparison;
no additional timing runs pursued these existing Library responsiveness issues.
Evidence: `codebase/output/batch3/native-handoff.log` and
`codebase/output/quick-library-check/batch3/{report,scenario}.json`.


### November 3, 2026 — Batch 3b native RAW handoff

Three 7968 x 5320 ARWs, one reusable copy under `output/test-photos/library-live-grid`,
isolated Electron at 2560x1440, unchanged limits. Native GPU development through
retained-source crop completes in **3.85–4.08 s**; cold grid/screen preparation
**1.08–1.81 s**, screen cache reuse **14–21 ms**. These are action timings,
not a proposed new timing target. Bounded handoff/packing and request-scoped native
scene sharing replace the previous incomplete five-minute handoff. Final driver
and whole-app acceptance are recorded in photo-library's Batch 3b entry.
Evidence: `codebase/output/library-gpu-raw-single/1793665307761/result.json`.

The same native Single interaction steps to its prepared neighbour in 302 ms.
The plain 90-second mixed-folder quick check completes ten Single steps:
16-6,875 ms, median 2,289 ms; a 4,781 ms drawing gap fails the existing 250 ms
limit. This already-open drawing pause is outside Batch 3b. Python fast checks
were running during these measurements, so no timing regression/speedup claim
is inferred. `codebase/output/quick-library-check/batch3b/report.json`.

Full Python suite, one invocation on the final Batch 3b code: 463.22 s
(2,994 passed, three skipped). Earlier diagnostic full invocations completed
in 409.49-504.96 s as regressions were added; the old 15-minute stall did not
recur. Final JavaScript suite: 741 passes in 9.89 s. No fast-check timing target
changed. `codebase/output/batch3b/{pytest-acceptance,node-final}.log`.

### November 3, 2026 — Batch 3c retention ownership and acceptance

Source fix `6f4275e`, isolated 2560x1440 plain Electron, default 4 GB, reusable
HDR Test Images copy, 60 seconds of grid followed by six 30-second settling
windows. Whole scenario 267.44 s, harness 275.38 s. First/ten/twenty pictures
7.6/20.4/49.9 s. This mixed retention workload is not a cadence qualification:
its longest picture gap is 41.7 s. Exact `2896f3e` production source with the
same stronger checker takes 263 s and fails at 4.922 GB with unfinished jobs
after Grade return, close and scrolling. Fixed source clears Grade-return jobs,
settling at 2.710 GB (close 1.525), Single exit 1.860 and Compare exit 2.352 GB.
It still fails at a separate Grade-import peak of 4.870 GB and eight unfinished
foreground jobs 30 s after same-folder scrolling (3.259 GB). Steve kept the
import peak out of scope; full retention acceptance remains open.
Evidence: `codebase/output/quick-library-check/{batch3c-retention-baseline,batch3c-retention}/report.json`.

Native RAW source preparation, three 7968 x 5320 reusable ARWs: cold screen
1.032–1.514 s, screen reuse 12.7–15.8 ms, native development through crop
3.526–3.926 s. No new timing target or speed claim; limits and resolution
unchanged. Evidence: `codebase/output/library-gpu-raw-single/1793668211849/result.json`.

The native RAW driver passes all 18 finished-pixel comparisons; prepared neighbour
13 ms, whole-app peak 4.315 GB, final 1.961 GB, within unchanged acceptance.
`codebase/output/library-gpu-raw-single/1793668211849/{comparison,memory-summary}.json`.

Default 90-second quick check with ten Single steps, serial after the RAW check:
98.36 s harness, Single open 1457 ms (first preview 31 ms), ten steps 10–5407 ms,
median 2116 ms. Peak 2.978 GB, final 1.478 GB, memory passes. Drawing gap 4492 ms
fails the unchanged 250 ms limit, consistent with the already-open 3b drawing
pause; no extra timing investigation. `codebase/output/quick-library-check/batch3c/report.json`.
Full JavaScript suite: 745 passes, zero failures, 9.71 s. Full Python suite, one
invocation: 2994 passed, three skipped, zero failures, 502.47 s. Fast-check logs:
`codebase/output/quick-library-check/batch3c-{node,pytest}.log`. No timing target changed.


### November 3, 2026 — Batch 3d Grade pause release

Focused plain-Electron `--grade-return --folder=library-live-grid --seconds=15`,
2560x1440, isolated profile, reusable ARWs: the exact starting Grade script from
`9587a8c` leaves the save queued through the existing 10-second disk-save gate;
helper 6 pauses / 5 resumes, writer 1 / 0. The harness injects a consumed release
with the same propagation behavior as HSL/Retouch, then edits HDR Exposure.
Steve's log does not identify his exact gesture. No exception around the pause
or save appears in backend.log; desktop.log has no exception in that session.

With the capture fix (`6836fd9`, finalized as `841c3bc` with ordinary window blur
kept separate), all observed pauses resume, three queued saves reach sidecars
in 0.115–0.132 s, full screen and Compare finish, and the 30-second post-close
checkpoint has no foreground jobs and settles at 1.290 GB; peak 3.097 GB. This
qualifies the focused save/return sequence, not the separate large-corpus peak
or scrolling failures left open in 3c. No timing or memory target changed.
Evidence: `codebase/output/quick-library-check/{batch3d-before,batch3d-grade-return}/report.json`.


Native RAW preparation in this batch: cold screen 1.048–1.572 s; screen reuse
13.2–14.5 ms; native crop/handoff 4.086–4.389 s across the same three 42 MP ARWs.
All 18 pixel checks pass. The default mixed 90-second quick check opens Single
in 3.746 s; ten steps have median 3.157 s and maximum 6.905 s. Drawing gap
4.019 s still fails the existing 250 ms rule (3c: 4.492 s); no new timing
investigation or relaxed limit. Memory passes, peak 3.044 GB, final 1.570 GB.
Evidence: `codebase/output/quick-library-check/batch3d/report.json` and
`codebase/output/library-gpu-raw-single/1793679786582/comparison.json`.


### November 3 — Batch 3d2 Grade pause follow-up

The exact `68c3a1f` app source fails the revised UI-event workload after the
Library tab click: helper 3 pauses / 2 resumes, writer 1 / 0, no completed
save. A logging-only reproduction (`68f1145`) identifies three CPU scopes
requests as outstanding owners. The prior small ungraded-RAW fixture passed
and saved in 110–126 ms; it did not exercise the expensive saved DSC06615
grade. Reports: `codebase/output/quick-library-check/batch3d2-{baseline,exact-photo,reproduce}/report.json`.
Fixed code `4306c34` saves in 461 ms with the Grade hold released. Final UI
acceptance fails: full screen does not finish within 60 seconds, Compare and
settle are not reached, and peak memory is 5.807 GB. Source/development logs
show memory admission delays, not a retained Grade pause. An earlier fixed
iteration finished full screen/Compare and saved in 627–691 ms but failed
memory/unfinished work; it is not an acceptance pass. No budget changed.
Evidence: `codebase/output/quick-library-check/batch3d2-grade-return/report.json`.

Native RAW passes 18 pixel comparisons and memory acceptance: cold screen
1.111–1.696 s, reuse 12.3–13.4 ms, native crop/handoff 3.695–7.075 s, resident
neighbour 11 ms. Peak 4.368 GB is a 1.62-second bounded episode accepted by the
existing memory rule; final 1.992 GB. The standard mixed 90-second check opens
Single in 1.462 s; ten steps median 1.968 s, maximum 5.580 s. Drawing gap
3.942 s fails the unchanged 250 ms limit; memory passes, peak 3.607 GB, final
1.521 GB. No repeat or separate performance investigation.
Evidence: `codebase/output/library-gpu-raw-single/1793682039136/{comparison,memory-summary}.json`
and `codebase/output/quick-library-check/batch3d2/report.json`.


## November 3 — Batch 3f recovery investigation (not accepted)

Native receiving-buffer refusal used to hold the producer and poll until the
unchanged 45 s timeout; it now releases the attempt before fresh admission.
Historical failures occurred under memory pressure but contain no chunk-level
record proving the memory-controller timeout shares the same cause.

Steve's decision, November 3, 2026: CPU edge-colour reconstruction after GPU
invalid-pixel rejection alone gets 66 s, approximately twice the slower measured
32.70 s, with a fixed 120 s upper cap. Actual 42 MP ARW reconstruction: 29.47 s;
48 MP DJI developed pixels with a controlled brightest-one-percent clipping mask:
32.70 s (the usual DJI opcode route does not run this reconstruction). Full ARW
decode plus reconstruction measured 36.56 s. Existing helper and decoder deadlines
outside this reconstruction stage stay unchanged. Work is cancellable and has
its own background lane; it yields to Grade and foreground memory demand.
Evidence: `codebase/output/batch3f/cpu-measurements.json`.

The scoped stage completes in the app in 28.2-28.8 s, but ordinary preparation
outside it still exceeds the unchanged approximately 8.8 s ARW deadline. Final
buffer-lifetime cleanup and lazy Grade peak scanning still fail acceptance:
reconstruction completes in 28.22-28.33 s, ordinary preparation times out during
reduction, and peak app memory reaches 6.91 GB against the unchanged 4 GB ceiling.
Slow testing stopped after this one additional run, as Steve requested.
Baseline 2e0d7bf fails both forced faults; fixed save-timeout recovery passes;
fixed invalid-output CPU recovery has not passed. No other budget was relaxed.
Evidence: `codebase/output/batch3f/{baseline,fixed}-faults.json`.


Batch 3f native RAW acceptance passes all 18 perceptual pixel checks and the
unchanged memory rule. Cold screen 1.127–1.830 s; reused screen 14.6–15.9 ms;
native crop/handoff 3.711–4.152 s. Peak 4.303 GB has a 1.501 s bounded episode;
settled memory 1.971 GB, no memory violation. These are diagnostic ranges,
not a controlled speed comparison. Evidence:
`codebase/output/batch3f/raw-{timings,comparison,memory-summary}.json`.

Batch 3f final fast checks: 765 JavaScript tests passed; 3,019 Python tests
passed, 3 skipped, zero failures. The initial Python run exposed 46 failures
from widening a shared source-context tuple; a48a803 fixes that common cause.
The final forced save-timeout check passes; invalid-GPU CPU display fails.
Evidence: `codebase/output/batch3f/{fixed-faults,final-app-evidence}.json`.

## November 3 - Batch 3g focused recovery/native checks

Diagnostic observations on 2560x1440 Electron, local test-photo copies, starting
from ab5023b. No timing threshold changes or controlled speed claim:

| Action | Observed | Conditions/result |
| --- | --- | --- |
| DSC00264 invalid GPU reconstruction | Clean on GPU attempt 2; four scans | One forced first-output rejection; no CPU route, remembered failure or stranded grant |
| DSC00264 forced two-output rejections, CPU reconstruction | 28.05-28.78 s | The existing 66 s reconstruction allowance is enough, but later preparation exceeds its unchanged deadline; helper recovery stopped after evidence; logged app peak 6.138 GB |
| Three 42 MP RAW cold screens | 1.135-1.651 s | RAW Single regression passes all 18 existing HDR/SDR screen/crop comparisons |
| Reused screen | 13.8-15.8 ms | Same run; native handoff 3.715-4.196 s; prepared neighbour 14 ms |
| Native RAW whole-app memory | Peak 4.332 GB; settled 1.940 GB | Existing bounded-episode rule passes, no violation; OS reserve untouched |
| Grade-return diagnostic full screen, DSC07060.ARW | Quick thumbnail 4.1 ms; sharp draw published 2.724 s | November 3, Batch 3g diagnostic; foreground selected-photo source request confirmed; navigated away before final physical-presentation event, so no complete visible-sharp timing |
| Grade-return diagnostic session | 209.336 s total | Three RAW test copies, one tracing-enabled session including edit, Library, F, Compare, 60 s idle, trim and explicit Grade close; no scenario errors |
| Backend working-set trim, idle after Grade | 711 MB before, 10 MB immediate, 62 MB after 500 ms | Private commit unchanged at 1,462 MB; live Grade source 509 MB; one-off diagnostic only |

Evidence: `codebase/output/batch3g/{retry,both-invalid,raw-single}.log`,
`both-invalid-observed.json` and `monitor-events.json` in that folder, plus
`codebase/output/library-gpu-raw-single/1793698355066/` JSON records.
The stopped baseline real-app injection was rejected by CSP before recovery ran;
the fast behavioral loop regression instead fails against ab5023b (one attempt)
and passes against the fixed implementation (two). No slow reruns.


Diagnostic evidence: codebase/output/batch3g/diagnostic-summary.json and
codebase/output/quick-library-check/batch3g-diagnostic/{report,scenario,trim}.json.
The memory module records the interpretation and renderer roles. All four app
checks recorded no slow-memory-endpoint or event-loop-lag events. Final fast
checks: 768 JavaScript passed; 3,023 Python passed, 3 skipped; zero failures.
The final worker-framing follow-up passed 44 affected Python checks separately.

## November 4 — Batch 4b Grade picture hand-off (completion, parent 51ba95c)

Plain Electron, 2560x1440, three reusable `library-live-grid` test copies,
4 GB ceiling. Saving policy and autosave wait unchanged. Docked timings measure
picture readiness in the retained hidden Library pool, not hidden-window
scanout. Detached check uses visible windows side by side.

| Action | Target | Observed | Conditions/result |
| --- | --- | --- | --- |
| Saved grade available → Library picture ready | 500 ms | Autosave 435 ms; manual Save 422 ms; detached 249 ms | HDR Grade capture; screen and thumbnail stored before publication. Earlier checkpoint 374–519 ms. Concurrent full Python sweep: autosave 734 ms, manual 488 ms; that autosave run missed target |
| Slider release → Library picture ready | Log separately; autosave wait unchanged | Autosave 1.575 s; manual Save 1.945 s; detached 1.498 s | Manual case deliberately waits 1.5 s with autosave off; Library keeps its saved grade during that wait |
| Return from Grade → retained grid | No blank tiles or redraw | Zero blank tiles in 30 frames; two untouched thumbnails reused exactly | Three-photo acceptance; no edited-picture redraw on return. Detached update also had zero blank tiles |

Evidence: `codebase/output/quick-library-check/batch4b/{report,scenario}.json`
and `backend.log`. Final acceptance has no scenario errors. No broad speed or
responsiveness claim; Batch 4c/4d work remains separate.


## November 4 — Batch 4b follow-up (incomplete checkpoint, parent 41d20c8)

Plain Electron, 2560x1440, reusable DSC03819/DSC00264 42 MP copies, HDR
Library rendition, +1 EV, Fit forced tiled. Separate full Python suite finished
before the final app run. These results supersede the earlier event-only
sign-off; the target remains unchanged.

| Action | Target | Observed | Conditions/result |
| --- | --- | --- | --- |
| Saved grade available → installed Library picture | 500 ms | First docked 539 ms; second docked 567 ms; popped-out 450 ms | All three route `Grade picture`, all three install times confirmed; docked cases still miss target |
| Grade capture / storage | Diagnostic | First 104 / 403 ms; second 102 / 414 ms; popped-out 26 / 387 ms | Reused or bounded Grade full-frame picture; storage remains a substantial wait |
| Slider release → installed picture | Log separately | First 1.836 s; second 1.837 s; popped-out 1.820 s | Existing save rules unchanged |
| Visible tile pixels after exposure | Must differ | 100%, 97%, 59% of interior crop changed | First/second docked and popped-out; real Electron screenshots, not publication events; screen/filmstrip pixels not separately verified |

Evidence: `codebase/output/quick-library-check/batch4b-followup/{pixels,report,scenario}.json`
and six before/after PNGs. The focused run peaked at 5.14 GB and settled at
2.16 GB. The memory ceiling-plus-10% check also fails; no allowances changed. This is an incomplete checkpoint, not release acceptance.

## November 4, 2026 — batch 5a partial checkpoint

Measured on parent `8d2d442` and the batch 5a working tree, isolated Electron
2560×1440, reused real-photo copies; no photo originals written. Indicative
Library load-to-two-frames harness timings, not a controlled normal-navigation
benchmark. Initial renderer setup excluded; original first-run costs included;
new pixel readback overhead excluded; Python tests overlapped part of the run.

| Action | Target | Before → after | Conditions / result |
| --- | --- | --- | --- |
| Edited 42 MP DSC07060.ARW first sharp | about 2 s | 7.857 → 2.026 s | +0.7 exposure; exact baseline HDR pixels; source/transfer 751 ms, GPU 527 ms, quantiles 34 ms, metadata handoff 204 ms, direct upload 90 ms; remaining setup/draw/presentation about 420 ms |
| Edited Nikon D7500 NEF first sharp | faster | 4.446 → 1.645 s | Same temporary global grade; exact HDR pixels; source/transfer 825 ms, GPU 300 ms, quantiles 38 ms, metadata 174 ms; remaining draw/presentation about 307 ms |
| DxO 16-bit TIFF first sharp | about 3 s | 5.564 → 2.332 s | Corrected RGB half precision, exact HDR pixels; source/transfer 1016 ms, GPU 805 ms, quantiles 31 ms, metadata 210 ms; remaining draw/presentation 269 ms |
| TIFF source band reduction | RAW-like | 2.554 → 0.573 s | 5304×7952 → 3416×5120 uint16; old standalone profile vs app observation, OS cache differs; new reads 122 ms; pipeline default workers 12, bounded in-flight 4 |
| Compressed float TIFF source reduction (48 MP Deflate, float predictor) | RAW-like | 1.533 → 0.724–0.864 s | DJI_0072-2.tif 8000×6000 → 5120×3840 float32, alone, warm OS cache; strip bands on 12 workers replace libvips sequential reading; luminance difference mean 0, max 0.7%; numpy peak 440 MB (result 236 MB). Nov 4 |
| Stop an unwanted TIFF read | prompt | 10–16 s kept running → 94 ms | Same file, told to stop 0.15 s in; plain, compressed and tiled routes checked in tests. Nov 4 |
| Stored-screen miss check | tens of ms | 13–39 ms | Local indexed stamp/grade only; offline source unit check passes |
| First same-session stored sharp | <0.5 s | 0.899–1.093 s | Not met: decode/pack 68–75 ms, body fetch 862–1017 ms, setup/upload/draw 37–76 ms |
| Restart stored ARW / NEF sharp | <0.5 s | 0.243 / 0.259 s | Met in API harness; next loads 0.136 / 0.183 s; no scan call; corrected TIFF restart remains open |
| Mixed Library Single smoke | ten steps, frame gap ≤250 ms | stops at step 1; frame gap 3680 ms | Not qualified: expired grants; app peak 2.696 GB |

Whole-app focused peaks: 3.406 GB (three-photo run), 2.734 GB (corrected TIFF).
No paired original peak: the proposed +5% comparison is unproven. No allowance
changes. Heavy local/geometry/denoise grades retain the fallback handoff; 5a
remains partial. Evidence retained in `codebase/output/batch5a/results.json`,
`restart.json` and `stages.json`, plus `output/quick-library-check/batch5a/report.json`.

## November 4, 2026 — batch 5a follow-up (heavy grades)

Real navigation, plain Electron 2560×1440, `quick-library-check --single --back`
on copies of Steve's edited photos (`output/test-photos/batch5-edited`, real
sidecars): before = `1f0a959`, after = this commit; fresh profile each, then a
restart with the same profile (`--keep-profile`, `--warm`). Navigation to the
presented sharp picture (app clock). Run-to-run spread about ±15%.

| Action | Target | Before → after | Conditions / result |
| --- | --- | --- | --- |
| Edited 42 MP ARW, perspective + crop + brush mask, first sharp | about 2 s | 3.36 → 2.27–2.52 s | 20250412_0039.ARW. Hand-off 0.78 → 0.47 s (no description round trip, half-float planes, no base64 copy); warp 354 → 164 ms (channels on 3 cores); one scene rebuild instead of two (−130 ms). Left: pixel fetch with CPU warp about 370 ms, brush mask about 350 ms (CPU mask compile) |
| Edited NEF, denoise on, first sharp | faster | 4.79 → 1.82–2.20 s | DSC_3931.NEF. GPU noise measurement 2.1 s CPU fallback → 0.12–0.17 s: the draw lease now includes the measurement's buffers |
| Edited film-scan TIFF, crop only, first sharp | faster | 3.50 → 1.94–2.24 s | 2026-03-30-0072.tif. Plain crops draw from the page's developed planes (no hand-off before the draw) |
| 16-bit DxO TIFF first sharp | about 3 s | 2.10 → 1.89–2.27 s | DSC04375_DxO_clipped_-1.5EV.tif, direct draw |
| Same-session reopen (Single, back) | <0.5 s | 0.14–0.17 → 0.14–0.22 s | Stored screen pictures; the 0.9–1.1 s above was the API harness reopening 4 s after a save |
| Reopen after restart | <0.5 s | — → 0.15–0.26 s | All four from stored screen pictures, no development |
| 48 MP float TIFF in mixed folder, first sharp | about 3 s | not shown → 19.8 s | DJI_0071-2.tif, newly visible (first-browse mezzanine fix). 15.4 s queued behind grid developments, 4.2 s TIFF reduction under contention. Not met |

Finished pixels (stored screen pictures, SDR and HDR): ARW and both TIFFs
identical to the before build; NEF within the denoise GPU/CPU tolerance
(HDR ΔE ITP mean 0.15, p99 1.75; SDR ΔE2000 mean 0.18, p99 1.20). Maximum
HDR 758 nits (1000-nit ceiling). Peaks: 1.95–2.45 GB (four-photo runs) against
1.72–2.16 GB before; mixed quick check 3.28 GB (33 photos now shown) against
2.86 GB (31).

## November 4, 2026 — batch 5b partial checkpoint

Plain Electron, 2560×1440, test-photo copies only. Before = local `66bb77b`;
after = batch 5b working tree. Navigation is input to matching sharp canvas plus
next animation frame, not physical display scanout. Existing ±15% timing spread
and mean <1 / p99.9 ≤3 perceptual limits are unchanged. Cold busy opens intentionally
enter fullscreen before the grid's first picture; idle opens wait for grid work
to finish and therefore have already paid initial renderer startup. The difference
is real for that user action, but does not isolate contention from startup cost.

| Case | Before → after | Result / remaining cost |
| --- | --- | --- |
| Film-scan TIFF first open, four edited photos, SDR | 32.646 → 2.056 s | Abandoned atomic-reservation/source-claim wait removed |
| Forced missing GPU grant on same TIFF | Intermediate broken retry 27.458 → 2.796 s | One retry logged; retained transfer resumes about 0.137 s after retry, no 202 source-claim wait |
| Heavy ARW first sharp, SDR | Paired 2.988 → 2.551 s; brief 5a 2.3–2.5 s | Still above about 2 s; HDR 2.482 s |
| Denoised NEF first sharp, SDR | 1.858 → 1.909 s | Within timing spread; HDR 2.753 s, above the earlier 1.82–2.20 s range |
| DxO 16-bit TIFF first sharp, SDR | 2.112 → 2.273 s | Within timing spread; HDR 2.424 s |
| Film-scan TIFF first sharp, HDR | Warm 5a baseline used for pixels, not cold timing → 2.172 s | Fresh changed-profile run |
| Busy fullscreen 48 MP float TIFF | Brief 19.8 → 7.195 s; idle 2.225 s | Target +about 1 s NOT met. Source-claim polling 0; draw queue 0.6 ms; first sharp render 3.889 s vs idle 0.120 s |
| Busy fullscreen heavy ARW | 7.011 s; idle 1.978 s | Target +about 1 s NOT met. Source-claim polling 0; draw queue 0.4 ms; first sharp render 4.983 s vs idle 0.379 s; source admission about 0.36 s |
| Float TIFF read/prepare | Brief 4.2 s under contention → 1.291 s busy / 0.993 s idle | HTTP source readiness about 1.618 / 1.204 s. Contains TIFF decode, shrink and preparation; individual file-read/decode/shrink subdivisions are not instrumented. No further TIFF algorithm change in 5b |
| Same-session back, SDR/HDR | 5a 0.14–0.26 → 0.007–0.240 s | Preserved |
| Restart reopen, HDR | 5a 0.15–0.26 → first 0.343 s; next 0.202 / 0.149 s | First over 0.3 s; remaining back opens 0.002–0.220 s; no development for measured sharp stored pictures |
| Screen perspective diagnostic | Serial/channels 214 → row bands 105 ms | Synthetic 1708×2560 RGB, same perspective, CPU-only; not a whole-open claim. ARW brush mask request still about 277–308 ms |
| Standard quick, same 31 photos | Saved batch4a median 0.415 → 0.485 s | +17%, slightly outside ±15%; versus brief's approximate 0.55 s, −12%. The 1.7 s/33-photo comparison was not like-for-like |

Same-set steps (seconds, saved batch4a → final): DJI DNGs 11.409→8.482 and
11.278→11.325; DSC00264 1.899→1.931; DSC01204 .176→.297; DSC01212 .092→.084;
DSC01226 1.768→1.690; DxO DNG .415→.485; DSC01244 .078→.077;
DSC01286 .099→.092; DSC01287 .114→.089. Median is selected by the DxO DNG step;
DSC01204 and DxO DNG are slower beyond ±15%. Their Single cache lookups rose 83→155 ms and 77→123 ms respectively; the cause
of that extra lookup/display latency was not isolated, and no source-decode
regression was established. Total Single
sequence 35.496→32.596 s. One DSC00264 trace starts 1.666 s after input, so the
1.931 s whole wait above is used rather than its misleading .267 s inner timer.
DNG thumbnail speed remains out of scope. A separate initial 31-photo diagnostic
exposed a 40.916 s DNG step from a completed thumbnail retaining its claim until
the 30-second deferred save; publishing it for late sharp demand removes that wait.

Pixels: all eight stored screen pictures (four photos × SDR/HDR) have perceptual
mean and p99.9 = 0 against 5a, with no pixel exclusion. Decode uses the same
redisplay clamp as the app. HDR peaks: ARW 758.21, NEF 227.70, film TIFF 148.33,
DxO TIFF 195.39 nits; compression-enabled samples stay below 1000 nits. Native
and export resampling paths are unchanged; this is screen-picture verification.

Memory: do not mix the app-log estimate with the independent whole-process census.
Paired four-photo SDR log peak 2.098→2.073 GB, census 2.670→2.763 GB; final
forced-recovery census 2.522 GB; fresh HDR census 2.597 GB. Restart census 1.471 GB.
5a's latest reduced frame is held for five seconds with float32 pixels/proxies/masks;
page direct-scene buffers and temporary decoder allocations also overlap. That
ownership explains expected transient growth, but the historic 1.72–2.16→1.95–2.45 GB
rise was not isolated allocation by allocation. Final 31-photo census 4.074 GB,
204 ms above 4 GB, settled 1.608 GB, no existing memory-check violation. No budget
or retention allowance was changed. Memory reduction remains open where it would
preserve speed.

Some fresh profiles show a 3.565–4.122 s window drawing gap despite main-thread
blocks under 0.14 s. Cold busy first sharp rendering takes 3.9–5.0 s. Startup or
shader compilation is a hypothesis, not a proved cause; these checks fail the
frame-gap acceptance. Steve should try the busy-folder action in his real library
before spending another slow run. Compare priority is covered behaviorally; no
new real-app Compare run was made.

Evidence (ignored local output): `output/quick-library-check/batch5b-*` report,
scenario and backend logs; `output/batch5b/comparison.json` and `output/batch5b-cpu.log`.
Total real-app checks 524.85 s (8 min 45 s), below the requested about ten minutes.
Fast checks: JavaScript 786 passed; Python 3049 passed, 3 skipped, 1 failed
(`test_library_live.py::test_remembered_failure_does_not_hide_current_grade_cached_scene`,
expected 422, got 200). That same focused test fails on unmodified committed 5a
backend code; it is pre-existing and was left unchanged. Logs: `output/batch5b-node.log`,
`output/batch5b-pytest.log`, `output/batch5b-baseline-python.log`. Output
remains 29.1 GB, below 100 GB; temporary profiles removed and fixture TIFF names
restored. No release sweep, installer or push.

## November 4, 2026 - batch 5c partial checkpoint

Copied photos, isolated plain Electron profiles, actual screen crops and
independent whole-app process census. Budget and tolerances unchanged. Stand-in
pixels below are screen captures, not presentation-event assertions.

| Check | Result | Acceptance |
| --- | --- | --- |
| TIFF busy / idle, docked SDR | 6.486 / 2.050 s (baseline 6.827 / 1.851 s) | Busy gap still fails +about 1 s; no worthwhile speed gain claimed |
| TIFF busy, docked HDR / popped SDR / popped HDR | 6.486 / 7.178 / 7.368 s | Cold cost remains; popped HDR idle 2.382 s |
| Heavy edited 20250412_0039.ARW busy / idle | 6.665 / 2.421 s | Busy gap still fails; same recipe and copied folder |
| TIFF first reopen after 2.1 s | Dock SDR .212 s; dock HDR .232 s; pop SDR .376 s; pop HDR .467 s; idle pop HDR .340 s | Stored screen fetch, no source development for reopen; initial alleged cache miss was two distinct source paths |
| Actual waiting stand-in pixels | Dock SDR TIFF 17 samples, pop HDR TIFF 21, edited ARW 22; Compare 3 TIFF / 12 ARW | None black. Other cold matrix cases lacked stand-ins, so full original-incident acceptance remains open |
| Explicit TIFF zoom too large to save | One 1,012,323,328-byte refusal; zero source/GPU starts and zero preparation retries during 5 s | Pass; header-only admission before work. Fit starts zero detail jobs |
| Final focused memory | 2.34-3.59 GB peak; 1.60-2.64 GB final | Below 4 GB and existing +10% elastic allowance; settles below 3.4 GB |
| Standard Single check | Step 9 timeout at scan DNG needing about 6.8 GB | Incomplete; out-of-scope large DNG admission, no budget change |

The original black screen did not reproduce in the baseline idle capture.
The change fixes the empty native surface covering the stored Fit picture,
explicit Fit/zoom demand, and stand-in visibility/ownership in Single/Compare.
It does not establish that these hazards explain Steve's observed incident.
No finishing/shader/export/Proof path changed; batch 5b's numerical output
qualification was not repeated. A rejected pipeline-preparation experiment was
removed because the whole wait changed only 6.827 to 6.298 s.

Evidence (ignored local output): output/quick-library-check/batch5c-before,
batch5c-before-idle, batch5c-final-*, batch5c-arw-busy, batch5c-arw-idle,
batch5c-refusal and batch5c-detail-final (report/scenario/backend logs;
wait-check.json and small PNG crops). batch5c-smoke records the DNG timeout.
The opt-in `--batch5c` quick-check helper now records pixels, Compare, and the
explicit zoom event/refusal. Initial helper runs needed navigation/Compare
corrections; those runs are not counted as acceptance passes. Total slow
validation reached roughly ten minutes including those corrections; stopped
here without another sweep. PRD 5c remains partial.

Fast checks: JavaScript 794 passed. Python 3051 passed, 3 skipped, 1 pre-existing failure
(`test_library_live.py::test_remembered_failure_does_not_hide_current_grade_cached_scene`,
expected 422, got 200; same failure recorded in 5b). Full fast-suite logs:
`output/batch5c-node.log`, `output/batch5c-pytest.log`. Output remains
29.1 GB (start/end), below 100 GB; rejected-experiment scratch removed. No push, installer or release sweep.


### November 4, 2026 - Batch 5c timed follow-up

Busy-grid cold opening is improved but remains open against the approximately
2-second idle result. First-use pipeline compilation accounted for 4.14 seconds
in the isolated probe (finish 1.43 seconds, HSL fields 0.45 seconds). Prior GPU
queue work took only 0.4 ms. Library now creates pipelines on demand and prepares
core pipelines sequentially while the requested source loads. Descriptors and
processing math are unchanged. TIFF first draw improved from 6.49 to 3.54 seconds;
heavy ARW from 6.67 to 4.65 seconds. TIFF encoding/completion: 82/109 ms;
ARW: 1047/819 ms, including 281 ms mask preparation. These stages overlap source
preparation and are not an additive decomposition of the whole wait. Parallel
compilation was rejected after RAW regressed to 9.37 seconds.

Evidence: codebase/output/quick-library-check/batch5c-cold-probe,
batch5c-compile-probe, batch5c-overlap-tiff and batch5c-overlap-arw.
Popped-out SDR visibility coverage reproduced one black frame on reopen while
a thumbnail stand-in existed (batch5c-visible-sdr-pop); this remains open.
Docked HDR visibility passed (batch5c-visible-hdr-dock). Python: 3051 passed,
3 skipped, one previously known library-live failure (expected 422, got 200).
The 15-minute follow-up ended without further app checks.


## November 4, 2026 - Batch 5d startup preparation (parent caa8218)

Plain Electron, no DevTools, 2560 x 1440, existing copied photos. Busy timing
runs explicitly wait for an active grid source/draw, not just listed rows.
Whole wait is fullscreen action to first sharp presentation. Values are single
observations; the brief's approximately +1 s idle allowance is the target.

| Photo | 5c busy | 5d immediate, nothing ready | 5d prepared, grid busy | 5c idle | Prepared minus idle | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 16-bit TIFF | 3.544 s | 3.234 s | 2.123 s | 2.050 s | +0.073 s | Met |
| Heavy ARW | 4.651 s | 4.499 s | 3.023 s (second launch) | 2.421 s | +0.602 s | Met |

App start to first grid thumbnail: preparation enabled 4.507 s, suppressed
4.555 s (-1.0%); folder-to-thumbnail 896/941 ms (-4.7%). Meets <=10% regression.
Preparation starts after that first thumbnail; it reads/develops no photo.
A second launch reuses Dawn cache: main preparation 5.059 -> 1.562 s; quick
0.343 -> 0.384 s. Cache holds 134 entries / 7,570,202 bytes both launches;
external shader blobs retain identical hashes. The normal desktop profile's
Dawn cache was valid (7,655,408 bytes, recorded corruption zero). Historical
"Invalid cache (current) size" was not reproduced and cannot be assigned to a
particular cache from that text alone. Chromium emits it from generic
[blockfile cache validation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/disk_cache/blockfile/backend_impl.cc).

| Visibility, captured pixels through entry and reopen | Reopen sharp | Minimum lit fraction | Result |
| --- | --- | --- | --- |
| Docked SDR | 233 ms | 0.9363 | Pass |
| Docked HDR | 456 ms | 0.9356 | Pass |
| Popped-out SDR | 404 ms | 0.3390 | Pass |
| Popped-out HDR | 362 ms | 0.3390 | Pass |

Popped-out crops include surrounding black during window transitions. No black
sample after the first visible stand-in in any combination. Real display
changes still invalidate pictures; fullscreen bounds notifications no longer do.

Preparation held approximately 17.5-22.9 MB extra dedicated GPU memory and
557-845 MB shared GPU-addressed memory (WDDM process counters include driver
and renderer overhead; no exact per-pipeline allocation API). Independent
whole-app visibility peaks 3.12-3.40 GB remain within existing limits. No budget
or processing/output-math changes, including the exact HDR peak limit.

Evidence: `codebase/output/quick-library-check/batch5d-busy-{immediate,ready}-{tiff,arw}`,
`batch5d-visible-{dock,pop}-{sdr,hdr}`, `batch5d-grid-control`, `batch5d-ready-arw`,
`batch5d-restart-tiff`. The last pair supplies cache inventories and preparation
timings; its earlier timing helper did not require an active grid and those
first-sharp times are not used in the busy table above. Pixel PNG crops and
`wait-check.json` accompany the visibility reports. Slow checks: 8.2 minutes
total. Node 797 passed; Python 3051 passed, 3 skipped, the same known library-live
422/200 failure as 5b/5c. Fast logs: `codebase/output/batch5d-{node,pytest}.log`.
Output 29.1 -> 29.2 GB; temporary profiles and rejected-run scratch removed, test photos retained.


November 4 thumbnail-stall fix (parent `e34dfea`, this change; 2560 x 1440,
isolated plain Electron): after Grade handoff, the ten visible DxO optical
DNG camera pictures in original `HDR Test Images/DXO_PL_exported` appear
0.464-0.829 s after browse, no measured-memory waits; JPEG extraction alone
89-171 ms. Grade fallback handoff remains 1.973 s from availability / 3.408 s
from release (not the clean-picture <=500 ms route). This run is a memory
diagnostic, not a clean-handoff speed acceptance. Forced delivery collection
after that handoff took 105 ms including a 100 ms measurement delay, but
left 1.187 GB of live buffers. Standard 90-second grid: 29 pictures, no
acceptance errors, external peak 3.202 GB. Evidence:
`codebase/output/quick-library-check/thumbnail-memory/{scenario,report}.json`
and `thumbnail-memory-standard/report.json`. Prompt delivery-buffer release
and Grade peak memory remain open; see the thumbnail-stall brief.


November 5 hidden delivery lifetime (parent `be9f70b`; this change; isolated
Electron, 2560 x 1440): DSC07060.ARW 4000 x 2671 GPU delivery turns are
6.547 -> 6.705 s for export (+2.42%) and 2.768 -> 2.697 s for Proof (-2.58%);
both meet the 5% allowance. Complete export 28.370 -> 28.619 s (+0.88%).
Before/after export and Proof have the same encoded hash and 798.184-nit peak
against 800 nits. The DSC07061 edge-colour job pair is 5.138 -> 4.305 s;
this is one cold-profile pair, not a repeatable speed improvement claim.
Private bytes fall from 1.745 GB peak to 42.6 MB at two seconds (42.1 MB
pre-job), within 200 MB; the idle collector's ~415 ms observation is already
within tolerance. The previous loop held 1.230 GB at two seconds. No large
photo backing stores remain in the post-job heap. Keep existing idle GC.
DxO grid after Grade: ten pictures in 0.275-0.671 s, zero measured-memory
waits. Standard 90-second grid: 33 pictures, 3.290 GB external peak, passes.
Focused Grade peak remains 5.234 GB, outside the existing allowance; separate
Grade peak work remains. Evidence and exact conditions: archived
`library-thumbnail-memory-stall-2026-11-04.md`,
`codebase/output/delivery-lifetime/export-proof.json` and
`codebase/output/quick-library-check/delivery-lifetime-{before,after,standard}/`.


## November 5 - Batch 4c fault recheck (parent 9b3ca14)

Plain Electron 2560x1440, edited TIFF, SDR docked, default allowances.
Baseline entry/reopen/arrow return: 1.701 / 0.225 / 0 s; extended input runs
1.840-1.887 / 0.215-0.223 / 0 s. These are diagnostic observations, not
cold-speed qualification: the extended input probe had already entered the
photo. The committed harness moves that probe after timing. No speed claim.
Before/after errors: held F, deselected fullscreen lead and stream anchor
all reproduce before and pass after. No black frame or automatic zoom in
either. Fixed run external memory peaks at 3.685 GB and settles at 2.504 GB.
Evidence: `codebase/output/quick-library-check/batches45-{fault-baseline,scroll-before,fixed}`.

### November 5: Library/Grade native-owner follow-up

Paired Grade opening in the same Windows app/source: 5.674/5.706 s, within
5%, after warm-up (6.787 s). This is a live-scene diagnostic, not retained
backend-native qualification: native retained counters stayed zero. Peak
4.834 GB fails the unchanged 4.4 GB allowance; 60-second idle 1.986 GB.
Explicit retained-native attempts were refused before pairing. Conditions:
November 5, parent f37514b plus native gate changes; reusable hdr-test copies,
plain Electron, 2560x1440, no overlapping GPU run. Evidence:
`codebase/output/quick-library-check/batches45-grade-native-sampled/` and
`codebase/output/batches45-grade-native-{owner,smaller}.log`.

### November 5: Grade picture publication follow-up

Saved-grade availability to Library picture, plain Electron 2560x1440,
reusable two Sony RAW copies, tiled Fit, separate docked/popped-out launches:
SDR docked 380-387 ms (met 500 ms); HDR docked 442 ms/6.585 s (second misses;
6.239 s capture, 263 ms store). Popped-out SDR/HDR 0.992/3.376 s (not met).
Whole-app peaks 4.779-5.177 GB fail the unchanged 4.4 GB allowance. November 5,
parent 3ceb233 plus deferred screen encoding; no overlapping GPU runs.
Grid/filmstrip crops change in all four modes; separate stored-screen crops
change for docked HDR/SDR only. Evidence:
`codebase/output/quick-library-check/batches45-handoff-{dock,pop}-{hdr,sdr}/`.

### November 5: rapid fullscreen functional probe

Plain Electron, 2560x1440, reusable library-mixed-v1-run, default cold app,
parent f17239c plus rapid-navigation harness: first/reopen/back sharp waits
3.346/0.273/0 s. These are diagnostic conditions, not the prepared-pipeline
latency acceptance. Eight rapid arrow samples stay at Fit with visible
finished/stand-in pixels; scenario and independent memory checks pass
(peak 3.418 GB). Evidence:
`codebase/output/quick-library-check/batches45-rapid/`.

### November 5: Grade transient memory reduction (parent 3eea538)

Plain Electron, 2560x1440, default 4 GB, existing Sony 42 MP test-photo
copies, one app check at a time. Earlier checks in this task used parent
2a75f50; final checks include the separate fullscreen-selection commit
3eea538. No allowance, output arithmetic or delivery code changed. Proposed
hand-off timing tolerance recorded before measuring: 5% against previous
whole waits; existing 500 ms goal and paired-Grade 5% remain unchanged.

| Action | Final measurement | Acceptance |
| --- | --- | --- |
| Docked HDR saved-grade availability to picture | 474 ms / 6.061 s | First within 500 ms, second misses. First versus earlier 442 ms exceeds proposed 5%; Steve should try responsiveness before more timing investigation. Second improved from 6.585 s; no speed follow-up in this task. |
| Docked SDR availability to picture | 388-390 ms | Meets 500 ms and within 5% of earlier 380-387 ms |
| Popped-out HDR / SDR availability to picture | 3.259 / 0.914 s | Still miss 500 ms; earlier 3.376 / 0.992 s |
| Grade opening before / after retained native detail | 5.488 / 5.549 s (warm-up 6.673 s) | Paired result within existing 5% |
| Whole-app peaks, docked HDR / SDR; popped-out HDR / SDR | 4.199 / 4.185; 4.327 / 4.286 GB | All pass unchanged 4.4 GB; final samples 2.281-2.650 GB |
| Retained-native contention / full-screen native zoom peak | 4.005 / 3.373 GB | Pass; final samples 1.701 / 1.551 GB |

Full-screen native-detail development-to-draw log span is 3.803 s (draw
3763.5 ms); six-second observation, not a new speed acceptance. Native
contention establishes 508.7 MB retained bytes and observes zero retained/
upload bytes after Grade. Grid/filmstrip pixel changes pass all four hand-off
modes; stored-screen crops pass both docked modes. No other app errors.

Intermediate 128-row bands already reduced docked HDR/SDR peaks to
4.254/4.308 GB and retained-native peak to 3.784 GB, but popped-out HDR still
peaked at 4.561 GB (SDR 4.289 GB). That led to final 32-row bands. Intermediate
hand-offs: docked HDR 481 ms/6.193 s, SDR 365-414 ms; popped-out HDR/SDR
3.169/0.949 s. Intermediate paired Grade 6.426/6.747 s passes existing 5%
(warm-up 7.356 s). The first native attempt stopped on its folder-idle
precondition before Grade measurement; the selected-photo scenario then
passed. Do not treat these diagnostics as another speed baseline.

Evidence: `codebase/output/quick-library-check/memory-peak-handoff-{dock,pop}-{hdr,sdr}/`,
`memory-peak-native-selected/`, `memory-peak-zoom/`; isolated allocation/hash
census in `codebase/output/memory-peak-{diagnostic,after-final}.log`. The memory
PRD owns the peak breakdown. Two real decoded RAW arrays are byte-identical
before/after. No broad driver sweep was run.

## November 5: Library GPU-first native zoom

Parent `0860be2` plus this implementation; plain Electron, 2560 x 1440,
default 4 GB, idle, existing mixed-folder copies on D:. Single observed runs,
not a distribution. The harness now measures zoom-button click to native canvas
drawn. The supplied before figures were measured on `08ef96e`.

| Action | Target | Before -> after | Peak whole-app memory | Result |
| --- | --- | --- | --- | --- |
| 42 MP DSC00264.ARW click to detail | 2.5 s +10% | 6.54 -> 1.788 s | 2.092 GB | Met for the eligible grade; saved HDR Denoise temporarily disabled and exact sidecar restored |
| 48 MP DSC04375_DxO_clipped_target.tif click to detail | 3.5 s +10% | 11.81 -> 3.037 s | 2.264 GB | Met |
| Busy batch5c memory acceptance | <=4.4 GB | Existing busy scenario | 3.276 GB | Passed, no app errors |

Evidence: `codebase/output/quick-library-check/zoom-gpu-{raw-neutral,tiff-final,busy}/`.
The first-round RAW check with its saved Denoise enabled correctly kept the
backend route (2.628 GB peak). A preliminary TIFF run exposed a shader compile
error, fixed before acceptance; a subsequent draw revealed a full-size source
texture retry, replaced with reuse of the already packed regional proxy.
No timing target, numerical allowance or pinned finishing shader changed.

The final RAW run includes the pre-presentation empty-channel GPU guard; the
existing 99% exact-zero rejection rule is unchanged. The earlier eligible RAW
run before that guard measured 2.051 s / 1.863 GB. Both meet the agreed target.
Grade's unchanged source/viewport transport diagnostic completed its regional
source in 55.7 ms (first tile 44.3 ms), Fit source in 168.9 ms, with exact visible
ROI agreement. These are transport diagnostics, not end-to-end Grade timings.
Its app census peaked at 1.229 GB; the focused native GPU driver census peaked
at 1.916 GB (neither is the independent sampler used for the zoom rows).

## November 6: edited DSC00264.ARW opening in Grade (edge colour)

Steve's app log (one opening, Library running): click to first frame 48.7 s,
of which Edge colour 33.7 s on the CPU after the GPU result had one invalid
pixel; rest of RAW development 7.8 s; retouch reapply 6.4 s.

| Action | Before → after | Conditions / result |
| --- | --- | --- |
| CPU Edge colour, 42 MP synthetic clip, standalone | 26.8–27.2 → 8.6–9.0 s | 12 logical CPUs; strips on the shared CPU pool; output bit-identical; standalone peak 6.2 → 5.07 GB |
| DSC00264.ARW Grade first frame, CPU forced (edge colour) | 37.953 s (Nov 2) → 16.6–16.8 s (edge colour 9.0 s) | `edge-colour-raw.js`, Electron 2560x1440, two runs |
| DSC00264.ARW Grade first frame, GPU route | 13.571 s (Nov 2, GPU accepted) → 26.0–26.3 s | Both GPU attempts rejected on this machine's faulty graphics memory in both runs, then CPU (edge colour 19.5–19.8 s); driver's GPU assertion fails for that reason |

### November 6: CPU Edge colour memory

| Action | Before → after | Conditions / result |
| --- | --- | --- |
| CPU Edge colour working memory, 42 MP | 28.3–29.2 → 10.5 full-size planes (about 4.8 → 1.8 GB) | tracemalloc above inputs, synthetic clip; output bit-identical; 9.6–10.5 s |
| Library CPU route after rejected GPU result, DSC00264, whole-app peak | 5.11 / 4.60 GB over ceiling → no over-ceiling event; largest sample 3.46 GB | `library-temporary-recovery.js`, Electron 2560x1440, isolated cache; CPU reconstruction 9.3–10.0 s |

### November 6: virtual-copy refresh

Parent a5f9db6 plus the virtual-copy refresh fix; plain Electron at 2560x1440,
4 GB setting, existing library-live-grid unedited RAW, disposable profile restored
by the harness. Proposed timing variation allowance: 5%; no existing target changed.
Confirmation to selected copy with a visible picture: before, not reached within
60 s; after, 214 ms (54.5 ms create request). The listing was being reused and
compact rows misread virtual IDs as extensions. Evidence:
`codebase/output/quick-library-check/v1-copy-{before,after}/`.
The ordinary camera-preview probe (hdr-test unedited _DSC0956.ARW) reached its
first visible picture at 199 ms and 2560 surface at 250 ms; it does not qualify
heavy-grade cold drawing. Evidence: `quick-library-check/v1-cold-heavy/`.

### November 6: Grade-to-Library idle scope wait

Parent 2ea6408, publication wait fix, plain Electron 2560x1440/default 4 GB,
hdr-test reusable copies, two tiled-Fit photos. Existing 500 ms target and 5%
variation allowance unchanged. Docked HDR first/second 429/974 ms after,
438 ms/6.796 s before. Second capture waiting: 5.917 s to below 1 ms;
post-fix capture 215 ms, storage 585 ms. Pixel-change checks pass for grid,
filmstrip and stored screen; second photo still misses 500 ms.
The first diagnostic and the 5.438 s heavy-ARW cold probe overlapped the fast
Python suite, so that heavy-probe timing is diagnostic under CPU contention,
not acceptance. The 1.394 s library-live-grid probe used a neutral grade and
camera preview; it does not qualify heavy grades or GPU cold drawing.
Evidence: `codebase/output/quick-library-check/v1-handoff-{diagnostic,wait,after}/`
and `v1-heavy-{cold,real}/`. One intermediate app run failed because of an
editing error; the file was restored and syntax checked before the final run.

### November 6: embedded TIFF stand-in and four-mode hand-off follow-up

Parent 1d92c83 plus shared mezzanine admission/embedded-preview work. Plain
Electron 2560x1440, default 4 GB, isolated profiles. Reusable synthetic float TIFF
3000x2000 with 64x32 embedded JPEG: first captured stand-in sample 122 ms,
nonblack through sharp replacement at 2.768 s. This is preview visibility, not a
new sharp speed target. Evidence: `quick-library-check/v1-mezzanine-standin/`.

Final hand-off modes using hdr-test copies: docked SDR 347-385 ms (passes 500 ms),
popped-out HDR 716 ms and SDR 827 ms (still fail). Grid, filmstrip and separate
stored-screen crop-change checks pass in all modes. No output tolerance changed.
Evidence: `quick-library-check/v1-handoff-{dock-sdr,pop-hdr,pop-sdr}/`.

### November 6: true heavy-grade immediate entry

Parent 1d92c83 plus mezzanine fixes, fresh plain Electron at 2560x1440/default
4 GB, preserved batch5-edited/20250412_0039.ARW with perspective/crop/brush,
no competing suite: 4.18-4.21 s selection to sharp. The 5% timing-variation
proposal is unchanged; the ordinary-first-open goal is still unmet. A redundant
header-query experiment stayed within that variation and was removed; no speed
gain is claimed. The old 5d prepared-busy result remains accepted, but does not
qualify true immediate entry. Evidence: `quick-library-check/v1-heavy-cold-final/`
and `v1-heavy-header-after/`.

### November 6: heavy-grade virtual-copy indexing

Parent 1d92c83 plus the mezzanine/copy-index fixes (mezzanine committed as
618beb0), fresh plain Electron 2560x1440/default 4 GB, preserved batch5-edited
20250412_0039.ARW with perspective/crop/brush. Existing proposed 5% timing
variation unchanged. Confirmation to selected copy with picture: before,
16.17-16.34 s; after, 1.797 s. The original create request was 136 ms; an old
observed-document expansion removed the new copy until the next folder check.
The copy grade is now indexed in its creation transaction and observed-document
expansion honors a newer acknowledged baseline. No source redevelopment or
pixel change is needed for this fix. Evidence:
`quick-library-check/v1-copy-heavy/`, `v1-copy-heavy-trace/`, `v1-copy-heavy-after/`.

The heavy-copy benchmark exits nonzero on its existing 250 ms frame-gap check:
startup gap 1.734 s before / 1.934 s after, with a later 352 ms gap in the final
run. The copy picture wait improved, but cold-folder responsiveness remains
open under 5b. No frame-gap limit or timing target was relaxed.

Final normal-TEMP fast validation: 813 Node; Python 3,077 passed/three skipped,
with only the known remembered-failure check failing. The final 90-second
standard Library run (v1-copy-index-final) has no picture/memory error but fails
its unchanged 250 ms frame-gap limit at 1.855 s. Earlier v1-loose-final passed.
No repeat was used to seek a lower number; cold responsiveness stays open in 5b.
Output ended at 29.5 GB (started 29.3 GB).

### November 7: Focus and Exposure on undeveloped RAW photos

Tolerance (brief, November 7): the first grid overlay on a camera preview
within 1.5× a developed photo of the same file. Driver
`tests/library-raw-overlays.js`, 2560×1440, fresh profile, cold maps
(hard-linked copies under new names), parent 3874f17, commits fd9298d and
40048320, two runs.

| Action | Target | Latest measured | Conditions | Status |
|---|---|---|---|---|
| Grid, E key to first Exposure overlay, undeveloped RAW (camera preview) | ≤ 1.5× developed | 1.331 to 2.372 s | 3 RAWs (DSC07060.ARW, IMG_0114.CR2, IMG_3129.CR2) | Met (about 1.0×) |
| Grid, S key to first Focus overlay, undeveloped RAW | Report | 1.853 to 2.876 s | Same folder, Exposure already on | Baseline |
| Grid, E key to first Exposure overlay, developed RAW | Reference | 1.341 to 2.359 s | 2 RAWs (DSC07060, IMG_3129 under new names), after Develop | Baseline |
| Single, S key to first Focus overlay (half / full), undeveloped RAW | Report | 3.40 s / 10.85 to 11.89 s | DSC07060.ARW; full map is the native RAW decode | Baseline |
| Camera-preview registration added to each RAW map | Report | about 0.1 to 0.4 s | ECC at 640 px; DSC07060 0.40 s, IMG_3129 0.12 s (script) | Baseline |


November 8 grid-rail follow-up (uncommitted on `3e207088`, 2560x1440,
90-second default mixed-folder check, concurrent Python suite): first picture
2.8 s, ten 7.4 s, twenty 10.8 s; no picture errors. Functional layout check,
not a speed comparison. Report: `codebase/output/quick-library-check/grid-rails/report.json`.

| Saved grade available ? Library picture ready (Nov 8 fullscreen/thumbnail check) | 500 ms | 288?358 ms | Uncommitted on 2a65d14b; 90 s quick check, library-live-grid disposable copies, autosave + manual save, SDR Library, concurrent Python suite; zero blank tiles, two untouched thumbnails reused; output/quick-library-check/fullscreen-return/report.json |
| Return from Grade ? edited thumbnail (Steve's 8807 log review) | No blank tiles | 48.5 ms (one observation) | Nov 8, running app; saved Portra 400 on PA168807.ORF; thumbnail loaded and shown on return, PA168806.ORF stayed ungraded. Diagnostic, no performance comparison |
| Library Stage A cold-folder diagnostic | No speed qualification | 41.579 s (one observation, not a range) | November 7, 2026; 4b8a549a + driver repair; 2560x1440, D:/Photos/HDR Test Images, concurrent CPU suite; first metadata 40.503 s, first pixel request 40.396 s; peak three probes | Diagnostic only |

## November 26: Library Stage A asset-policy recheck

| Action | Target | Result | Conditions |
| --- | --- | --- | --- |
| Open the cold HDR Test Images folder to its first picture | Diagnostic only, no speed qualification | First metadata 385–395 ms, first pixel request 392–402 ms, first completed picture 815–816 ms. Peak two concurrent picture requests. | MacBook Neo, A18 Pro, 8 GB, 1408x794, two locked Electron Stage A passes on `3cd32a5e` plus the asset-policy test fix. No before/after speed comparison. |

### November 8, 2026 ? focused release-check repair

Measured on main `50822a19` plus this grouped repair, serial shared-lock Electron,
2560 x 1440; warm processes and uncontrolled OS disk cache. Driver setup now
explicitly develops ungraded fixtures and publishes retained scenes before a
route switch. These are diagnostic preparations, not a new whole-folder target.

| Action | Observed | Conditions / result |
| --- | --- | --- |
| RGB scene preparation, paired 640/2560 requests | JPEG median CPU 3.27 s / GPU 0.38 s; PNG 1.28 s / 0.49 s | Three fresh paths per route, alternating order; HDR/SDR pixel limits unchanged. Native disk planes use the stored diagnostic route; viewer retention is checked separately. |
| RAW paste preparation | Cold CPU 6.60 s; reused GPU-prepared source 0.039 s | DSC07072.ARW, three concurrent reuse requests; unchanged paste wrote no sidecar. |
| Denoise 42 MP measurement | CPU 0.795 s / GPU 0.181 s, compute 0.111 s | Single Grade measurement; corpus finished-pixel comparisons passed. |
| Export with live tiles, Export closed / open | 26.010 / 25.941 s per photo; warm-up 28.931 s | Same three reusable ARWs, GPU Ultra HDR JPEG, maximum fidelity; within the existing 5% allowance, no progress-driven tile redraws. |

Additional codec-source three-repeat medians in the same repair: CPU/GPU JXL
0.868/0.337 s, direct AVIF 1.435/1.061 s, HEIC 0.574/0.290 s. These are source
preparations, not displayed-picture timings. The large precision-source timing
run remains incomplete at measured-memory admission; no speed claim follows.

### November 8: precision-source memory-ownership repair

`d4b2b401`, shared-lock Electron 2560x1440, default 4 GB, disposable test
profile; three fresh paths per route, alternating order, warm processes and
uncontrolled OS cache. CPU suite overlapped this diagnostic. These are scene
preparations, not timings to a displayed picture; no new speed qualification.

| Action | Observed | Conditions / result |
| --- | --- | --- |
| EXR paired 640/2560 scene preparation | Median CPU 8.887 s / GPU 4.013 s | All repeats complete, including formerly blocked gpu-2.exr |
| Float TIFF paired 640/2560 scene preparation | Median CPU 5.782 s / GPU 3.773 s | All repeats complete |

The driver then fails its unchanged starting HDR source-peak assertion
(1188.2466 versus 1180.0155 nits); finished-pixel comparison is not reached.
No image tolerance or budget was changed. Log: `codebase/output/precision-fix-source.log`.

Precision-rendition in the same locked validation: seven fixture scene
preparations 0.425-1.202 s (JPEG/PNG, edited PNG/16-bit TIFF, signed layered
EXR, BT.709 TIFF, 100-nit-reference-white EXR); all HDR/SDR finished-pixel
comparisons pass. Log: `codebase/output/precision-fix-rendition.log`.

### November 8: precision-source peak diagnosis

`e22f4f20` plus diagnostic-only assertion context; shared-lock Electron,
2560x1440, disposable test profile, default memory, concurrent final Python
suite, warm processes and uncontrolled OS cache. Three alternating fresh paths
per route. These are preparation times, not action-to-displayed-picture timings;
no speed qualification or budget change follows.

| Action | Observed | Conditions / result |
| --- | --- | --- |
| EXR paired 640/2560 preparation | Median CPU 8.454 s / GPU 3.324 s | All repeats complete |
| Float TIFF paired 640/2560 preparation | Median CPU 4.342 s / GPU 3.353 s | All repeats complete; then unchanged starting-source-peak assertion fails |
| CPU input preparation probes | TIFF reduced 0.881 s / native 0.370 s; EXR native 1.616 s | Single read-only probes isolating the peak difference; decoder plus metadata only, not whole Library wait |

Log: `codebase/output/precision-peak-source.log`. The TIFF peak changes before
GPU processing, from full-source 1180.0155 nits to reduced-source 1188.2466 nits.
Historical October 31 reduction reproduces it. See the Library module PRD's
November 8 peak diagnosis; no assertion or numerical tolerance was relaxed.

## November 8 — Grade picture installed on return to the Library (uncommitted on ae64cbb2)

| Action | Target | Observed | Conditions/result |
| --- | --- | --- | --- |
| Saved grade available → Library picture ready (Library hidden) | 500 ms | Autosave 358 ms; manual Save 255 ms | `quick-library-check.cjs --grade-handoff --grade-handoff-sdr`, plain Electron 2560x1440, library-live-grid copies; picture now installed on return, so this is ready time |
| Return to Library → edited tile replaced | Log separately | 41 ms | Old tile shown until then; 0 blank frames over 30 frames |


### November 10: Exposure overlay investigation (no app changes)

Baseline commit `50c8597c`. Diagnostic comparison band proposed before runs:
10% for normal variation, not a change to an acceptance target. Fresh-profile
Electron at 2560 x 1440, existing shared
`output/test-photos/gpu-denoise-measurement/DSC07060.ARW` (42 MP Sony RAW),
no photo copies or development, uncontrolled OS disk cache. One app run;
these observations are not ranges or a general performance qualification.
The endpoint is a populated visible overlay canvas, excluding display scan-out.

| Action | Measured | Conditions |
|---|---|---|
| E to first Exposure, cold map | 1.827 s | Map request 1.606 s; reported map construction 1.533 s; PNG response 8.5 ms. Remaining time includes input, decoding/drawing and automation observation. |
| E to Exposure, map retained in memory | Grid 11 ms; Single 16 ms | Same photo/session; validation still requests the stored map. |
| CPU map stages, process/OS warm | 0.995-1.050 s | Two standalone diagnostics: exposure source 0.865-0.910 s (includes mask math 0.521-0.535 s and luminance preparation 47-95 ms); pooling 82-84 ms; preview extraction 8-19 ms; registration 37-39 ms. Nested stages must not be added together. |
| Isolated RAW threshold/mask calculation | Existing 0.733-0.741 s; scratch candidate 0.337-0.365 s | Three paired in-memory runs, same RAW. Candidate uses scalar black/white levels on repeating sensor-pattern slices instead of full-frame level arrays; both full-resolution Boolean warning masks compare exactly. No production code changed; not a whole-wait result. |

The candidate saves about 0.37-0.40 s in this isolated calculation. Against
the observed 1.827 s app wait this suggests roughly 20% less waiting, provided
the saving carries through. It does not establish an end-to-end improvement.
Other RAW patterns, channel levels, orientations and formats remain untested
for the candidate. The first failed harness attempt could not create a hard
link on D:; the successful run reused an existing test-photo folder instead.
Log: `codebase/output/exposure-investigation.log`. Scratch scripts removed.


### November 10: Exposure CPU implementation

Baseline `3c257e43` records the earlier app observation on `50c8597c`.
Implementation on that baseline, same existing 42 MP Sony
`output/test-photos/gpu-denoise-measurement/DSC07060.ARW`, fresh disposable
profile, Electron 2560 x 1440, one photo, no concurrent parent test suite;
OS disk cache uncontrolled. Same E-key to populated visible canvas endpoint
and proposed 10% diagnostic comparison band. These are single observations,
not a speed qualification across photos or a new acceptance target.

| Action | Earlier observation | After implementation | Status |
|---|---|---|---|
| Cold map, E key to visible Exposure | 1.827 s | 1.337 s | About 27% less waiting; synthetic mask equality and RAW app behavior pass |
| Retained map, E key to visible Exposure | 11 ms | 8 ms | Immediate; no regression claim based on millisecond variation |

Log: `codebase/output/exposure-implementation-check.log`. Repeating sensor
slices avoid full-frame black/white level arrays. The check also verifies
Focus full refinement survives Exposure toggles without developing the RAW.


November 10 grouped-fix Library smoke (`13d56cf0` plus deletion changes,
2560 x 1440, default 90-second mixed-folder run, concurrent Python suite):
first picture 1.1 s, ten 1.8 s, twenty 10.3 s; no picture/memory errors.
Functional smoke, not a speed comparison. Report:
`codebase/output/quick-library-check/exposure-delete-fixes/report.json`.
The Delete UI check initially exceeded its unchanged 30-second wait while
fresh deletion searched the existing Recycle Bin. Fresh-present files now
skip that recovery search; the full mixed-delete and neighbour-navigation
driver passes within its original timeouts. No deletion speed target or
numeric end-to-end improvement is claimed.


### November 10: Focus first-result work

Baseline `7194e20f`, then the Focus changes on it. Proposed comparison band
before measurement: 10%, diagnostic only; existing acceptance limits unchanged.
Fresh disposable profile, Electron 2560 x 1440, Single with filmstrip on the
same existing 42 MP `output/test-photos/gpu-denoise-measurement/DSC07060.ARW`;
no photo copies/development, no concurrent parent test suite during timing,
OS disk cache uncontrolled. One app observation per version, not a camera
benchmark or a statistical range. Endpoint is populated overlay canvas,
excluding display scan-out.

| Action | Before | After | Assessment |
|---|---|---|---|
| S to first half Focus overlay | 2.366 s | 1.861 s | About 21% less waiting |
| S to full Focus refinement | 10.299 s | 9.311 s | Within 10% band; no clear improvement claimed |
| Retained map, S to Focus | 18 ms | 17 ms | Immediate; ordinary variation |

Before/after logs: `codebase/output/focus-investigation.log` and
`codebase/output/focus-after.log`. Before has two simultaneous half metadata
requests, one failing; after has one half and one full, both successful.
A separate warm-process CPU diagnostic of the old calculation found native
source decode/preparation 3.466 s and Focus analysis 3.058 s; the latter
included two identical fine smoothing passes of about 0.56 s each. Quick
source decode was 0.629 s and analysis 0.774 s. Those isolated stages exclude
app scheduling and cannot be added to the app observations; they explain
why source preparation and full analysis remain the next full-quality costs.
Stage log: `codebase/output/focus-stages.log`. Only duplicate requests and
identical fine smoothing were removed; output quality and budgets unchanged.


Focus grouped-check Library smoke (November 10, `7194e20f` plus Focus changes,
2560 x 1440, 90-second mixed-folder check, concurrent Python suite, Focus off):
first picture 0.9 s, ten 2.0 s, twenty 7.4 s, peak 2.982 GB; no picture/memory
errors. Existing 250 ms frame-gap gate failed at 1,952 ms. This is the already
recorded general Library drawing-gap class, outside Focus work; no rerun,
limit change or investigation. Report:
`codebase/output/quick-library-check/focus-shared-maps/report.json`.


### November 10: next overlay wins, read-only CPU prototypes

No app implementation change after `c38609b2`. Same shared 42 MP Sony RAW,
warm/uncontrolled OS cache, standalone CPU processes, no concurrent parent
check or new photo copies. Existing 10% diagnostic app band and exact Focus
map/noise checks are unchanged. These are isolated paired experiments,
not action-to-overlay measurements, and cannot be added as an app speed claim.

| Experiment | Current stage | Prototype stage | Agreement / limitation |
|---|---|---|---|
| Focus analysis, existing OpenCV separable filters, same weights and axis/edge order | 2.521 s | 1.210 s | Finished small map byte-identical on this RAW; noise differs by -2.21e-8. Noisy and sharp-edge controls were also tried. Not accepted as an exact replacement. |
| Focus analysis, native coarse filter only, original fine/noise path | 2.916 s | 1.775 s | Noise exact; one of 165,834 map cells differs. Not accepted as an exact replacement. |
| Full source loading without constructing a Grade session | 3.764 s | 3.231 s | All source pixels exactly equal on this RAW. Still includes 0.717 s of HDR classification, which Focus does not consume. |

Logs: `codebase/output/focus-native-prototype.log`,
`focus-coarse-native-prototype.log`, `focus-source-only-prototype.log`.
Different experiment baselines are not cross-run comparisons. No test,
threshold, precision guarantee or agreement tolerance was weakened. OpenCV
is already an installed dependency. Production adoption needs whole-wait
measurement and output checks; no whole-wait gain is measured here.


### November 10: source-only Focus and full-map reuse acceptance

Based on `9d7d9e6a`; native filters rejected, existing math unchanged.
2560 x 1440 Electron, fresh disposable profiles, existing 42 MP Sony RAW
`output/test-photos/gpu-denoise-measurement/DSC07060.ARW`, Single+filmstrip,
no parent suite during timing; OS cache and other workspace activity not
controlled. Existing 10% diagnostic band, no acceptance limit changed.
Two cold observations, including timing phases completed before a later
renderer-reload harness error; the corrected complete check also tests disk
reuse. The whole-wait endpoint is populated overlay canvas, not scan-out.

| Action | Observed | Assessment |
|---|---|---|
| S to initial Focus | 1.851-1.877 s | Same as prior 1.861 s within timing band |
| S to full Focus | 8.295-9.852 s | Prior 9.311 s lies in the range; no firm cold gain claimed |
| Retained full validation/show | 36-43 ms | Immediate; validates full without half work |
| Disk-only full, half map absent, fresh Library renderer | 35 ms (one observation) | No half construction requested; actual full cache reused |

Evidence: `codebase/output/focus-options-app.log`,
`focus-options-observations.json` (both cold observations),
`focus-options-parity.log` (exact Sony/Canon source arrays),
`focus-options-interface.log`, `focus-options-unit.log`.
No extra image copies or new cache allowances. Source-only loading is kept
for removing unused setup with identical pixels; its cold whole-wait benefit
is not established by these observations.

Grouped 90-second Library smoke, Focus off, concurrent Python and unrelated
DNG work: first picture 3.5 s, ten 4.9 s, twenty 12.4 s; peak 3.196 GB and no
picture/memory errors. Existing frame-gap gate fails at 2,007 ms. Functional
smoke, not an overlay performance comparison; no rerun or tolerance change.
Report: `codebase/output/quick-library-check/focus-source-and-reuse/report.json`.


### November 10: camera-first cold RAW Focus culling

Based on `1ee69b99`, camera-first implementation in this commit. Steve's
new goal is roughly one second to a useful provisional overlay per photo;
precise RAW detail may follow. Existing 10% diagnostic comparison band stays
unchanged. The quick map intentionally measures the camera JPEG, so it is
not a precision-equivalent comparison with the previous RAW half map.

2560 x 1440 Electron, fresh disposable profiles with no pre-existing overlay
maps, shared `output/test-photos/badminton-42mp` (forty 42 MP Sony RAWs),
Single+filmstrip then fullscreen. Embedded picture is visible before S;
folder-open latency is excluded. No parent suites during these timings.
OS cache/other workspace activity uncontrolled. Endpoint: populated current
picture's overlay canvas, not physical display scan-out. Two final runs:
after listing settled and pressing S as soon as a camera picture appears
while the folder is still filling in. Each navigates nine new photos;
subsequent maps can be prefetched during that same cold folder visit.

| Action | Current observations | Conditions / limit |
|---|---|---|
| S to first camera Focus | 0.815 s settled listing; 1.184 s early scan | Approximately one second; early condition is 184 ms over 1.0 s, not a universal under-one-second guarantee |
| Next photo to picture + camera Focus, Single/filmstrip | 109-263 ms | Six subsequent photos in each run, maps may already be prepared by filmstrip |
| Next photo in fullscreen to picture + camera Focus | 80-94 ms | Three further photos in each run |
| Camera-map construction inside helper | 422-578 ms | Includes extraction, conversion and analysis; excludes admission/transport/presentation |

Both complete runs confirm no native full build during rapid navigation,
then a full map after dwelling; Focus does not publish development. Earlier
background-priority exploratory runs gave 1.237-1.960 s first presentation
and prompted the selected-picture admission/ordering fix; they are not the
current result. The initial driver misread `cache_hit` (the API validates
published cache after every build); final coldness is checked before S by
asserting no `.map.npz` files exist in the disposable profile. An intermediate
priority trial exposed the old API priority restriction; fixed before final
runs. These driver issues did not require changing an acceptance tolerance.

Evidence: `codebase/output/focus-camera-cold-priority.log` (settled),
`focus-camera-cold-early.log` (early scan; ten distinct photos),
`focus-camera-cold.log` (earlier background-priority exploration).
Standalone diagnostic `focus-camera-stages.log`: source extraction/conversion
0.227 s, analysis 0.089 s on DSC07187, outside app contention; not additive
to an app saving claim. No GPU route, RAW copies or new cache allowance.

The grouped 90-second Library Single smoke passes: no errors, ten Single
steps, peak 2.419 GB, longest drawing gap 212 ms (250 ms gate). First picture
1.1 s, ten pictures 5.3 s; Focus off with concurrent Python tests, so these
are functional smoke figures, not Focus performance measurements. Report:
`codebase/output/quick-library-check/focus-camera-culling/report.json`.


### November 10: Exposure one-second target, temporary CPU/scheduling trial

Based on 8eacf8ee; no production edits retained. Existing 10% diagnostic band
unchanged. 2560 x 1440 Electron, fresh disposable profiles, shared forty-photo
badminton-42mp Sony RAW folder. First camera picture visible before E, early
folder scan; OS cache/other workspace activity uncontrolled. No concurrent
parent suite. Endpoint: current-picture overlay canvas, not physical scan-out.
Each case is one observation plus three immediate ArrowRight steps; later
results may be prefetched. Focus-on cases press S, wait for camera map, then E.

| Case | Current first E | Selected priority + exact mask trial | Remaining next-photo tail |
|---|---|---|---|
| Exposure alone | 1.440 s | 0.996 s | Current 3.170 s; trial 2.100 s |
| Exposure with Focus on | 3.056 s | 1.314 s | Current 3.378 s; trial 1.959 s |

Current first helper work is 0.979/0.938 s, with little helper yield; alone
has about 0.345 s dispatch-to-helper admission, Focus adds much more waiting.
The trial keeps approved memory estimates and allowances unchanged; selected
Exposure uses priority 30 and existing main lane, filmstrip 85/kept. It
preserves sensor masks and registration. It is not consistent one-second
culling yet. A further reserved-browser-slot trial gives first E 1.033 s
alone / 0.774 s with Focus, but tails 1.770/1.763 s; not kept. The alone
change is within the diagnostic band, not an improvement claim. Full individual
navigation observations are in the diagnostic JSON/logs below.

Isolated candidate mask stages: Sony DSC07187 358 to 169 ms, Canon portrait
IMG_0114 164 to 73 ms, Canon landscape IMG_3129 154 to 76 ms, masks exactly
equal. Synthetic phase/tiny/odd/channel/float cases also match. In-app trial
retains full colour-map verification and fallback; pooled masks stay exact.
An initial incomplete-CFA tiny-frame error was fixed before passing parity.
The old priority test is intentionally inapplicable during foreground trial,
not loosened; it passes again with all 40 focused checks after restoration.

Isolated Sony build: make 0.641 s, total 0.664 s; raw mask 353 ms, pooling
about 40 ms twice, registration luminance 67 ms, embedded JPEG extraction
19 ms, ECC 35 ms. Cache cleanup hit a Windows-held SQLite ledger after that
first result and stopped a second sample. Later three-RAW mask diagnostic
completed: sensor access 49 ms Sony, 248-286 ms Canon. Separate diagnostic
costs are not additive app savings. A GPU transfer/filter would leave RAW
reading/admission intact and has no evidenced 50% whole-wait benefit.

Reserved-slot next-photo trace, alone: browser queue under 1 ms; filmstrip
request waits about 1.035 s before a cancelled helper, replacement selected
request waits 0.757 s before 0.881 s work. With Focus, selected helper queue
0.445 s and work 0.791 s. Prioritize admission/cancellation/source readiness
rather than browser concurrency or dropping verified placement.

Evidence in codebase/output: exposure-cold-{alone,focus}.log,
exposure-prototype-{alone,focus}.{log,json}, exposure-reserved-{alone,focus}.
{log,json}, exposure-stages.log, exposure-mask-prototype.log,
exposure-prototype-parity.log, exposure-restored-checks.log.


November 10 implementation experiment 1, based on 91b374c7: mask-only change,
original priority/admission untouched, same Sony burst/early scan/fresh
profile/2560x1440 conditions and existing 10% diagnostic band. First E alone
1.199 s; next 3.199/0.108/0.100 s. Focus-on first 2.983 s; next
2.459/0.084/0.088 s. One observation each, later maps may be prefetched. Alone
first improves versus 1.440 s; Focus-on first remains within band of 3.056 s.
Do not attribute the larger scheduling-prototype gains to mask changes.
Evidence: codebase/output/exposure-mask-only{,-focus}.json and matching app
logs; exposure-mask-only-unit.log. No concurrent parent suites.


November 10 implementation experiment 2, mask simplification plus selected
Exposure priority/main lane. Same conditions/band as experiment 1. First E
0.880 s alone, next 3.481/0.097/0.114 s; with Focus first 1.654 s, next
1.462/1.158/2.144 s. First presentation improves, consistent one-second
navigation not achieved. No memory rate/allowance change. Evidence:
codebase/output/exposure-selected{,-focus}.json and matching app logs.


November 10 implementation experiment 3, pending-job sharing added to
experiment 2 with unchanged memory rates: alone E 1.073 s, next
3.014/0.098/0.091 s; Focus E 1.631 s, next 1.445/0.947/2.504 s. Same
conditions/10% band. No reliable overall benefit; the extra source/epoch
job table, promotion callbacks and 150 ms handoff grace were removed.
Evidence codebase/output/exposure-shared{,-focus}.json and app logs;
exposure-shared-unit.log. No repeated runs to chase a number.

Separate standalone Windows RSS measurement of the retained mask path,
2 ms sampling after native-library initialization, one fresh process per
photo; concurrent Python checks, so no speed claim from these runs. Source
masking/pooling/alignment only; no retained cache or picture copies. Candidate
sizing uses the existing measured-peak-plus-25% method, no approved rate
changed. Sony DSC07187: 385.6 MB increase, 9.10 bytes/visible sensor pixel;
Canon IMG_0114 167.0 MB, 9.27; Canon IMG_3129 167.3 MB, 9.24. Including
25% headroom gives 11.37-11.59 bytes/pixel in these cases, versus the current
CPU-development reservation rate 25. This supports a limited rate-12 trial
on tested ARW/CR2 flat RAWs, not a universal rate or whole-app memory proof.
Unknown/other formats must retain the existing estimate. Keeping a changed
estimate remains Steve's decision. Evidence exposure-memory-{sony,canon-
portrait,canon-landscape}.log; script tools/exposure-memory-diagnostic.py.


November 10 final memory-reservation experiment, after fast suites completed:
retained mask/selected priority plus temporary Exposure-only 12 bytes/raw
sensor pixel for flat ARW/CR2; CPU lane/count/limits unchanged, other formats
keep CPU estimate. Same fresh-profile Sony/early-scan/band conditions. Alone
E 1.332 s, next 2.652/0.100/0.096 s; Focus E 1.921 s, next
1.110/1.764/0.095 s. No dependable overall improvement; estimate restored,
not proposed for adoption from this trial. Evidence exposure-memory-trial
{,-focus}.json and app logs. No production rate change retained.

Final retained implementation remains experiment 2 (0.880/1.654 s first E,
not a claim that all cold navigation meets one second). Full fast suites run
once after removing shared-job prototype; the memory trial afterward was
restored byte-for-byte. Functional 90-second Single smoke, Focus off and
concurrent Python tests: first picture 1.0 s, ten 7.4 s, peak 2.545 GB,
longest drawing gap 194 ms, no errors. Smoke report is authoritative for its
exact figures: codebase/output/quick-library-check/exposure-mask-priority/
report.json. These are not Exposure performance comparisons.


Follow-up temporary combined reservation/classification trial: Exposure
uses its own diagnostic job kind (not a full-development slot) plus the
same measured rate-12 eligibility/fallback. Alone E 1.322 s, next
1.487/0.100/0.101 s; Focus E 1.640 s, next 1.805/1.481/0.087 s.
Source files restored byte-for-byte afterwards. Next-photo tails improve
versus retained experiment 2, while first activation alone regresses;
not a universal one-second result. Keeping a lowered approved reservation
was pending Steve's decision at that point. It is superseded by the approved,
header-only production implementation below. Evidence exposure-kind-trial{,-focus}.json and app logs. All trials
are single observations under the earlier recorded conditions, not a timing
range or a repeated paired confidence estimate.


### November 10: approved Exposure reservation, header-only implementation

Based on f5997117; Steve approved rate 12 for verified flat ARW/CR2.
Production eligibility uses TIFF/JPEG headers; the earlier raw_type probe
silently unpacked RAW pixels before admission and is not retained. This
corrects both admission safety and unnecessary first-request work. The new
job kind does not spend full-development slots; conservative fallback keeps
both old CPU bytes and CPU kind for unsupported/uncertain input.

Same shared forty-photo Sony burst, fresh disposable profiles, 2560x1440,
first picture ready before E, OS cache/workspace activity uncontrolled,
existing 10% diagnostic band. No concurrent parent suite for speed samples.
Rapid alone: E 1.173 s; next 0.210/2.172/0.102 s. Rapid with Focus: E
1.400 s; next 1.011/1.629/0.110 s. Paced with Focus (one second after each
shown map before next): E 1.078 s; next 1.387/0.109/0.098 s. Sampled whole-app
maximum from grant logs 2,436,798,165 bytes; ceiling 4,000,000,000. The three
navigation observations may include same-visit prefetch. Endpoint is current
picture's populated overlay canvas, not physical scan-out. One observation
per condition; no claim all cold photos appear in one second.

Evidence: codebase/output/exposure-approved{,-focus}.json and app logs;
exposure-approved-paced-memory.json and app log; actual real ARW/CR2 grant
kind/bytes in exposure-approved-real-reservations.log. Functional concurrent-
Python Canon/combined-overlay run: E 6.020 s, next 4.511/1.603/2.621 s,
sampled peak 2,714,490,580 bytes; both Canon maps aligned and PNGs served.
These CPU-contention timings are not comparisons to isolated samples.
Evidence exposure-approved-canon-functional.json and app log. Source photos
were reused read-only; no RAW copies or changed cached-map allowance.


Additional cancellation acceptance, Focus on, eight ArrowRight events at
100 ms intervals without waiting for maps: first E 1.444 s; the entire
keypress burst plus current-map recovery took 2.344 s. Sampled whole-app
peak 2,657,284,091 bytes against 4 GB ceiling, within unchanged protected
peak rule; no source development or page errors. This is recovery evidence,
not eight individual overlay latencies. Evidence exposure-approved-cancel-
memory.json and app log. No concurrent parent suite in this run.

Grouped functional Single smoke: 90 seconds, concurrent Python checks,
Focus off; no errors, sampled peak 3.464 GB, longest drawing gap 124 ms.
Report codebase/output/quick-library-check/exposure-reservation/report.json
owns its picture-load timings; they are not Exposure speed comparisons.


## November 10: component-sheet appearance smoke

At 3afcdc2b, the standard 90-second mixed Library check (concurrent Python
suite, no speed comparison) showed first/ten/twenty pictures in 1.2/1.9/8.9 s.
Its longest drawing gap was 1,680 ms, outside the existing 250 ms limit;
main-thread block 143 ms, sampled peak 3.432 GB and no memory violation.
DSC01226.ARW reported invalid GPU development pixels; five files were not
shown by the end. No unrelated processing investigation, rerun or budget
change. Report: codebase/output/quick-library-check/component-pass/report.json.

## November 11: W3 original-file command audit

Target (Steve, release task): single-photo action under 1 s, with marks and
settings not blocked. **Not met / screen completion unverified.** Working
change based on 40c633c9; cache bookkeeping commit in this branch.

| Backend plan + execute | Before | After |
| --- | --- | --- |
| Rename | 4.329-11.543 s | 1.001-1.074 s |
| Move | 4.266-4.294 s | 0.789-0.803 s |
| Delete | 4.172-4.316 s | 0.968-1.398 s |

Two trials per action on November 11, same machine, disposable NTFS profile
and tiny original with marks/grade/copies; disposable Bin adapter (no real
Recycle Bin). A private copy of Steve's library-pictures directory started
with 5,475 files / 966 MB; explicit initial usage reconciles retired entries
before each timed action. No live cache, original or protected project is
written. Whole backend command includes planning, durable checkpoints,
sidecar/index changes and completion, but excludes dialog time, UI refresh,
real RAW hashing and Windows recycling. First before Rename is colder;
subsequent runs are OS-cache warm. Do not claim those cold/warm numbers as a
like-for-like speed ratio. A separate first-copy Rename probe took 20.813 s.

Before, size reconciliation alone takes 3.313-3.482 s on every action;
after, changed files update the existing ledger directly. Remaining archive
metadata scanning still holds marks/settings-writer locks. A source-keyed
cache-file index is proposed, requiring publication/eviction/recovery tests;
not attempted as a same-day design change. Under-one-second screen completion
on Steve's cache remains unqualified. No tolerance or budget changed.

### November 25: Library Delete, two originals on the MacBook Neo

| Backend action | Before | After |
| --- | ---: | ---: |
| Delete two originals without sidecars, preview + confirm | 140–148 ms | 114–121 ms |
| Delete two originals with unchanged sidecars, preview + confirm | 151–153 ms | 123–138 ms |

MacBook Neo, local APFS, seven warm trials per case with two disposable 32 MiB
files in the same folder. Compared with `9ed134f2`. The system Trash call was
substituted with a local no-replace move into a disposable folder. The native
bookmark and content checks still ran. These times exclude the confirmation
dialog, UI repaint and background membership upkeep. A 10% difference is
treated as timing noise on this short test because filesystem flushes vary.
The separate native Electron check passed actual Trash and Undo. Steve's
large Library and click-to-screen time were not measured.

| Phase median, ms | No sidecars before → after | Unchanged sidecars before → after |
| --- | ---: | ---: |
| Preview | 30.86 → 30.10 | 35.95 → 36.25 |
| Confirm to backend result | 110.57 → 86.40 | 116.10 → 87.27 |
| Uncontended command lane and writer wait | <0.01 → <0.01 | <0.01 → <0.01 |
| Conflict scan / marks read | 0.15 / 2.54 → 0.04 / 1.96 | 0.16 / 8.05 → 0.05 / 7.55 |
| SHA-256 across phases | 126.98 → 102.78 | 127.86 → 102.62 |
| Prepare settings | 0.70 → 0.50 | 4.28 → 0.52 |
| Durable command checkpoints | 4.03 → 3.90 | 6.92 → 5.17 |
| Recovery bookmark / substitute Trash move | 0.92 / 0.20 → 0.89 / 0.19 | 1.57 / 0.37 → 1.53 / 0.36 |
| Receipt verification | 24.94 → 25.24 | 25.20 → 25.27 |
| Index updates / picture cleanup | 0.16 / 0.44 → 0.15 / 0.45 | 0.15 / 0.46 → 0.14 / 0.46 |

Phase timings overlap. Receipt verification includes its SHA-256 and settings
preparation includes its own checkpoints. The hashing reduction is one
full read per original on a fresh command with stable file identities.

Local evidence: codebase/output/w3-audit/timings-before.json,
timings-after.json and measurement harness/logs in the same folder.

W3 standard smoke after rebasing onto fdba7f9a (tested cd978c83): plain
Electron, 2560x1440, disposable profile and shared mixed run-photo copies,
concurrent Python suite. First/ten/twenty pictures: 1.1/1.5/9.2 s; 29 shown
by 90 s. No photo errors or memory breach (external peak 3.189 GB), but
3,149 ms drawing gap against the unchanged 250 ms limit. No rerun or timing
investigation before Steve's normal-use trial. This is a smoke observation,
not original-file action speed acceptance. Evidence:
codebase/output/quick-library-check/w3-audit/report.json.


## November 11: W20 framing interpretation smoke

At `cf1f499f` (rebased onto `de8b5b25`), the standard 90-second mixed Library
check passed: no application/photo errors, no memory violation, 85 ms longest
drawing gap within the unchanged 250 ms limit. First/ten/twenty pictures:
1.0/1.4/5.9 s; 29 shown at 90 s; external peak 3.277 GB. Plain Electron,
2560x1440, disposable profile, shared run-photo copies, shared GPU lock;
Python and Node suites had finished. This is a smoke observation, not a speed
comparison. Evidence: codebase/output/quick-library-check/w20-framing/report.json.


### November 15, 2026: Refresh thumbnail correctness check (Windows PC)

| Action | Observation | Date / commit | Conditions |
| --- | --- | --- | --- |
| Refresh thumbnail, Grid / filmstrip / Single | Refreshed canvases confirmed in all three views; no new latency baseline or speedup claim | 2026-11-15, commit containing this note | Windows PC, 2560x1440, plain Electron `--refresh --folder=library-live-grid`, existing 4 GB harness setting. First attempt recorded a 370 ms frame gap (250 ms guard); its Single transition was a test error. Corrected attempt passes; full Python suite and other project work were active. Evidence: `codebase/output/quick-library-check/refresh-pictures/`. |

### November 15: button tier Library smoke (Windows PC)

| Action | Observation | Date / commit | Conditions |
| --- | --- | --- | --- |
| Mixed Library viewport | 90-second smoke passed; first/ten/twenty pictures 1.0/1.7/9.6 s; no speed comparison | 2026-11-15, commit containing this note | Windows PC, 2560x1440, shared GPU lock, plain Electron, frozen library-mixed-v1; fast Node/Python suites active concurrently. Viewport scope only (30/33 eligible pictured), no app errors or memory violation. Evidence: `codebase/output/quick-library-check/button-tiers/report.json`. |

## November 16: opt-in high-fidelity JPEG XL qualification (minimum Mac)

Native-photo timings are descriptive, not a speedup claim. Any paired timing
comparison uses the existing 5% noise tolerance; no new speed or size gate is
set. Machine: MacBook Neo, A18 Pro / 8 GB, fresh CPU worker per photo, one at a
time under `gpu-run-lock.py`, default 2.5 GB app ceiling and existing physical
reserve. Sources are SHA-256-approved originals read in place. Native export
uses default creative settings, a 1000-nit Fixed cap, original dimensions,
no output sharpening/frame/metadata; Web Default comparison is Q90, 12-bit
HDR/no dither or 8-bit SDR/Auto dither. Instrumentation captures the actual
finished input; the export wait includes that test-only capture, validation
and HDR ceiling decoding. Decode timing is a separate pixel-only import,
without histogram analysis. Source loading and colour-difference measurement
are excluded from export time. Values and final per-stage memory samples:
`codebase/output/review/jpegxl-high-fidelity/native-final.json`; revision
`779382d9` plus the memory-admission follow-up containing this record.

| Native input / lane | High-fidelity bytes (Q90 bytes; ratio) | Native encode / separate decode (s) | Instrumented export (s) | Mean / P99.9 |
| --- | --- | --- | --- | --- |
| 5M071612_finished.avif · 1433×1920 · HDR | 3,905,845 (748,411; 5.22×) | 2.748 / 0.352 | 3.583 | 0.0899 / 0.1966 |
| 5M071612_finished.avif · 1433×1920 · SDR | 1,813,596 (724,866; 2.50×) | 1.805 / 0.310 | 2.091 | 0.2606 / 0.8642 |
| DSC_3931_01.jpg · 2000×1168 · HDR | 815,192 (469,989; 1.73×) | 0.780 / 0.241 | 1.396 | 0.0438 / 0.1886 |
| DSC_3931_01.jpg · 2000×1168 · SDR | 807,855 (497,634; 1.62×) | 0.747 / 0.201 | 1.303 | 0.0210 / 0.1146 |
| IMG_6717.PNG · 1170×2532 · HDR | 1,625,325 (314,620; 5.17×) | 1.802 / 0.353 | 2.654 | 0.0756 / 0.1941 |
| IMG_6717.PNG · 1170×2532 · SDR | 738,164 (388,995; 1.90×) | 1.296 / 0.306 | 2.073 | 0.0315 / 0.5250 |

All three native inputs pass both lanes; HDR is ΔE ITP and SDR is ΔE00.
Every high-fidelity encode is one round; no correction re-encode is needed.
Exact finished/decoded HDR peaks: Urban 757.499/757.659 nits, JPEG
203.018/203.038, PNG 203.018/203.038 (see JSON for final exact values).
Sampled full worker-tree charged peaks (including diagnostics and ordinary
comparisons) are 0.925 / 0.917 / 1.165 GB, respectively, below the 2.5 GB
default; physical reserve stays above its minimum. This standalone CPU census
does not certify a complete Electron native-photo session.

The 10.7 MP PQ AVIF is refused by the new high-fidelity app memory admission
before either lane renders. The 42.2 MP LR source and largest 16000×12000
panorama fail the diagnostic native working-set preflight; no full-source
decode/encode is attempted for them. Largest-photo delivery remains open,
not a pass or a memory-budget waiver. Before admission, the 10.7 MP standalone
diagnostic reached HDR 1.913 GB and generated SDR 4.435 GB charged; the latter
also breached the physical reserve. `memory-stages.json` records the stages;
`oversized-preflight.json` retains the 42.2 MP refusal.
No comparison speedup or cross-machine inference is claimed.


| Check | Result | Conditions |
| --- | --- | --- |
| Library viewport smoke | 90 s; first picture 0.4 s; all 9 requested pictures, no errors; independent app peak 2.458 GB | Neo / 8 GB / 1408×794, plain Electron, shared lock, frozen v1 unchanged. `output/quick-library-check/jxl-high-fidelity/report.json`; not whole-folder qualification. |

## November 26: Library live grid and GPU loss

MacBook Neo, A18 Pro, 8 GB, 1408×794. Two `library-live-grid.js` passes
under the shared GPU lock with disposable Electron profiles and caches, three
Sony RAWs and one PNG. Measured in the commit containing this note. Browse
starts after fixture preparation. The roughly 10 s user-wait target is not a
new test timeout. The existing 120 s grid checks are unchanged.

| Action | Before | After (two passes) |
| --- | --- | --- |
| Browse to all expected tiles shown | The seven actual folder entries drew in 0.33–0.40 s from the first picture request. Three extra RAWs were on disk, so the four-cell recovery assertion timed out. | 0.76–1.34 s from Browse, all four isolated fixtures shown |
| Forced device loss to CPU pictures shown | At `367b37d1`, the first CPU jobs queued for 27.6–28.4 s, until a finished GPU scene's deferred save cleared the hold. From first CPU job submission to last helper job completion was 28.3–29.1 s in the two Nov 25 release attempts and Nov 26 reproduction. No equivalent on-screen assertion passed. | 1.18–2.09 s |
| GPU made available again to all four live tiles | Not reached by the old driver | 2.11 s, or 3.30–4.20 s total from loss through restored live drawing |
| Prepared scene reuse (per photo) | — | 23–33 ms |
| Open Single / step to the next photo (2560 edge) | — | 0.27–0.66 s / 0.29–0.44 s |

### Noise-model research — November 17, 2026

Research revision `8b818d38`, not a shipping speed change. Every measurement
uses the MacBook Neo A18 Pro / 8 GB, CPU one native thread, shared GPU lock
and unchanged 2.5 GB research process-tree guard. Native clocks cover RAW
open through all resolved pixels in bounded AHD/filter tiles; they exclude
UI, live-control cache and disk persistence. Model-analysis subclocks overlap
AHD and must not be summed. One observation per condition; existing ±10%
descriptive allowance, no cross-machine comparison or speedup claim.

| Action / input | Current → corrected | Conditions / evidence |
| --- | --- | --- |
| Native 18.02 MP Canon RAW to Denoise result | 6.878 → 7.564 s; model analysis 1.737 → 2.002 s; filtering 3.496 → 3.770 s; peak RSS .662 → .666 GB | Neo A18 Pro / 8 GB / CPU one thread; `output/denoise-v1/noise-model-raw-specks/native-{current,corrected}-IMG_0790.json` |
| Native 42.39 MP Sony RAW to Denoise result | 15.266 → 15.819 s; model analysis 1.994 → 2.022 s; filtering 9.434 → 9.877 s; peak RSS .715 → .714 GB | Neo A18 Pro / 8 GB / CPU one thread; same folder, `native-{current,corrected}-2025_0730_1331_3.json` |
| Corpus audit / synthetic quick / synthetic full | Guard walls 45.125 / 37.553 / 165.868 s; full peak tree RSS 1.569 GB | Neo A18 Pro / 8 GB / CPU one thread; `audit-guard.json`, `quick-guard.json`, `full-guard.json`; all adapters including historical RAW handoff |
| Public held-out / seen matrices | Guard walls 94.621 / 165.609 s; peak tree RSS 1.135 / 1.102 GB | Neo A18 Pro / 8 GB / CPU one thread; `heldout-guard.json`, `seen-guard.json`; separate groups, not speed benchmarks |
| Historical RAW-stage prototype, stopped for separate agent | Canon total 8.249 s / repair .434 s; Sony total 17.028 s / repair .961 s; clean probes 51.105 s guard wall | Neo A18 Pro / 8 GB / CPU one thread; `native-raw-*.json`, `clean-guard.json`; completed before scope change, no further RAW work or shipping recommendation |
| Final model-only decision crops | 36.238 s guard wall; 1.117 GB peak tree RSS; 8.916 MB retained | Neo A18 Pro / 8 GB / CPU one thread; `decision-model-only-guard.json`, `output/denoise-v1/decision/manifest.json`; 12 fixed 256-pixel rows, historical RAW columns removed |

The stable fit does not clean the lifted Canon shadows and is not proposed for
shipping. Quality findings, final crop evidence and integration limits:
`research/denoise-v1-2026-11-16/noise-model-and-raw-specks.md`.

### November 21 — Lensfun coordinate-strip trial

| Action | Observation | Conditions / evidence |
| --- | --- | --- |
| Lens coordinate and remap peak, Canon 18 MP | 1,098 → 585 MB process working set | Windows PC, `35a6b9ce`, `IMG_0790.CR2`, manual EF-S 18–135 mm IS, full-height versus 128-row coordinate requests in fresh processes |
| Lens coordinate and remap peak, Sony 42 MP | 2,323 → 1,198 MB process working set | Windows PC, `35a6b9ce`, `_DSC7970.ARW`, Lensfun Auto, same trial |

Both cameras changed finished SDR pixels. The [MEM-1 trial](briefs/sprint-denoise-gpu-logging-2026-11-21.md#mem-1--one-memory-budget-on-the-macbook-neo-overnight)
records the perceptual comparison. The coordinate strips stay out of the app.

### Library check environment investigation — November 17, 2026

| Action | Observation | Conditions / evidence |
| --- | --- | --- |
| Plain Library observation at `2db4de36` | Outer 130 s deadline; diagnostic reproduction reaches the final animation-frame wait, but its last frame is over 110 s old | MacBook Neo A18 Pro / 8 GB / 1408×794, shared GPU lock, fresh isolated profiles, frozen v1. Safari fullscreen on the active desktop; Library document hidden after 20 frames, native window visible/non-minimized but unfocused. This is an invalid drawing measurement, not a Library speed regression or speed comparison. `output/quick-library-check/observe-diagnostic-progress/{report.json,quick-diagnostic.json,backend.log}`. |
| Final plain / Single checks at `f65abf62` | Harness exits with explicit hidden/occluded-window failures in 95.746 / 6.979 s, not timeouts; plain scenario 90.895 s, Single stops at step 1 | Same Neo / 8 GB / 1408×794, shared lock, fresh isolated profiles, frozen v1, fast suites finished before app runs. Not valid performance baselines or passing checks. Plain additionally fails the existing system reserve and settled-memory guards (peak 3.546 GB); attribution not investigated. `output/quick-library-check/observe-final-{plain,single}/report.json` and `quick-diagnostic.json`. |

## November 24, 2026 — Grade RAW pixel cleanup

MacBook Neo (A18 Pro, 8 GB). Each RAW control change reopens the source and
develops the whole sensor, even at Fit. In the baseline with cleanup off,
Sony `_DSC7970.ARW` (42 MP) spent 3.41 s in demosaic, 0.23 s in highlight
reconstruction and 0.48 s in Lensfun (6.43 s total RAW development); Canon
`IMG_3129.CR2` (18 MP) spent 1.66 s, 0.40 s and under 0.01 s respectively
(3.30 s total, no matching automatic lens correction).

In the separate cold sensor-only runs, ×2.5 Harsh Specks cleanup (including
noise estimation) went from 5.19 to 2.73 s on Sony and 2.83 to 1.26 s on
Canon. Hot Pixels alone took about 0.9–1.0 s on Sony and went from 0.97 to
0.63 s on Canon; Sony had no hot repairs and Canon had 13. With both on, a
previously unseen ×2.9 still runs the speck scan; the backend sample went
from 6.39 to 2.56 s of cleanup on Sony and 3.10 to 0.87 s on Canon. The
before software checked all 24 neighbours across each whole plane. It now
checks them only at candidate sites, after the same component and level
rules. Hot-pixel candidate vetting and repair are batched, with the same
directional ties. Both still read unchanged strip context.

When a downstream lens edit or toggle back to the same settings needs a new
development, it reuses the noise fit and the exact changed sensor samples,
not a copy of the sensor or an RGB frame. The cache is limited to 24 MiB and
16 entries per process and uses the source file identity and Bayer metadata.
On the matching ×2.5 lens and toggle-back rows, cleanup dropped to 11 ms on
Sony and about 1 ms on Canon; demosaic still ran. A Grade exposure edit does
not reopen or reclean the RAW at all.

All 30 whole-sensor and 22 fully developed image comparisons against the
previous code matched SHA-256 byte for byte, with identical cleanup counts.
This includes Hot Pixels alone, Harsh Specks alone, both together at ×2.5
and ×2.9, and both together at ×2 and ×4; the sensor comparison covered all
four thresholds for each speck mode. Fujifilm `DSCF6495.RAF` is X-Trans 6×6;
the Bayer cleanup remained unsupported and left its sensor and developed
pixels unchanged. The new cache test passes with this patch and fails on
the previous code, which reruns all three cleanup operations on an identical
sensor during a lens edit and an off/on toggle.

**Time to the exact picture in Grade, in seconds (before → after).**
Electron used the app's staged RAW replacement path under the GPU lock.
All 76 timed actions per version presented the final generation at the
requested zoom without a cutoff. Canon 100% uses the completed baseline
rerun. These are one-sample waits under different shared machine loads:
even the cleanup-off control moved, so the whole wait difference is not
all due to this change. In particular, Sony Hot Pixels alone did not show a
reliable enable improvement. Exposure edits were 0.05–0.23 s across both
runs and made no RAW-import requests.

| RAW | Zoom | Cleanup | Enable ×2.5 | New ×2.9 | Back to ×2.5 | Lens off | Toggle off | Toggle on |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sony | Fit | Hot | 6.45 → 7.28 | — | — | 6.14 → 5.45 | 5.16 → 5.41 | 5.81 → 5.10 |
| Sony | Fit | Specks | 14.11 → 7.98 | 12.63 → 7.72 | 12.47 → 5.25 | 12.65 → 5.11 | 6.33 → 4.79 | 13.24 → 4.73 |
| Sony | Fit | Both | 13.45 → 8.25 | 13.39 → 7.47 | 13.06 → 4.99 | 15.02 → 5.17 | 6.33 → 5.07 | 12.98 → 5.00 |
| Sony | 100% | Hot | 7.55 → 6.00 | — | — | 7.39 → 5.16 | 6.27 → 5.01 | 10.00 → 5.18 |
| Sony | 100% | Specks | 14.80 → 7.46 | 15.59 → 7.50 | 20.38 → 5.81 | 18.10 → 4.96 | 9.48 → 11.71 | 17.19 → 8.61 |
| Sony | 100% | Both | 20.14 → 8.59 | 23.91 → 7.74 | 24.41 → 5.50 | 22.06 → 5.20 | 15.85 → 5.20 | 20.40 → 5.20 |
| Canon | Fit | Hot | 6.32 → 2.90 | — | — | 6.00 → 2.62 | 4.39 → 2.61 | 5.41 → 2.46 |
| Canon | Fit | Specks | 9.60 → 3.43 | 8.42 → 3.40 | 7.70 → 2.44 | 8.96 → 2.62 | 4.04 → 2.43 | 7.98 → 2.49 |
| Canon | Fit | Both | 8.84 → 3.65 | 8.27 → 3.38 | 7.89 → 2.41 | 7.68 → 2.65 | 3.50 → 2.42 | 6.59 → 2.41 |
| Canon | 100% | Hot | 3.32 → 3.08 | — | — | 3.32 → 2.83 | 2.79 → 2.85 | 3.12 → 2.61 |
| Canon | 100% | Specks | 4.84 → 3.80 | 4.87 → 3.61 | 4.65 → 2.63 | 4.81 → 2.82 | 2.63 → 2.65 | 4.65 → 2.87 |
| Canon | 100% | Both | 5.10 → 4.08 | 5.36 → 3.59 | 5.16 → 2.58 | 5.35 → 2.80 | 2.65 → 2.59 | 4.94 → 2.60 |

[Grade baseline](../../codebase/output/grade-sweep/batch7-pixel-before.jsonl) ·
[Canon 100% baseline rerun](../../codebase/output/grade-sweep/batch7-pixel-before-canon100.jsonl) ·
[Grade after](../../codebase/output/grade-sweep/batch7-pixel-after.jsonl)

Faster options that would change what the app shows, not implemented:

- A reduced first picture at Fit could hide some of Sony's 3–5 s full
  demosaic wait. It would not speed up the final exact picture or help at
  100%.
- A simpler speck model could save part of the remaining 1–3 s cold scan
  on these files. It could also change which stars, fine texture and bright
  edges are protected. An exact alternative for repeats would be to reuse a
  developed result, subject to the app's existing memory limit.

[Sensor byte hashes before](../../codebase/output/overnight/batch7-sensor-before.jsonl) ·
[after](../../codebase/output/overnight/batch7-sensor-after.jsonl) ·
[Developed hashes and stages before](../../codebase/output/overnight/batch7-stages-before.jsonl) ·
[after](../../codebase/output/overnight/batch7-stages-after.jsonl) ·
[Developed endpoint hashes before](../../codebase/output/overnight/batch7-develop-ends-before.jsonl) ·
[after](../../codebase/output/overnight/batch7-develop-ends-after.jsonl)
## November 24, 2026 — Saved Retouch replay on the Windows PC

Cold Library grid before from the owning app log on `b3cd5f21`. After uses
disposable copies of the same two photos and sidecars, requested together
at 640 px in locked, unpackaged Electron at 2560 × 1440. The harness measures
from request through draw and two animation frames. The older operation was
real navigation with other Library activity, so the whole waits are indicative.
The comparison uses 5% as the timing noise band for repeated conditions.

| Photo | Retouch before | Retouch after | Whole wait before / after |
| --- | ---: | ---: | ---: |
| P7080774.ORF, 84 Heal repairs, GPU-developed source | 28.422 s | 0.747 s in Library | 38.32 / 11.72 s |
| IMG_0432.CR2, four Heal repairs, CPU-developed source | 3.6–3.9 s | 0.125–0.134 s in a standalone run of the same replay function | 52.11 / 11.49 s |

The ORF used one batch. Gather and readback took 21 ms, recipe read,
validation and planning took 68 ms, the backend batch took 642 ms wall
time with a 181 ms slowest solve, and upload and scatter took 8.5 ms.
The browser request took 673 ms including the backend batch. The CR2
CPU replay took 9–10 ms to copy the source, 116–124 ms to solve and
0.25–0.27 ms to composite. Its slowest solve took 115–124 ms. The
single-core reference solve alone measured 296–329 ms on the ORF
and 179–182 ms on the CR2, before replay, transport and copying.

Inside the saved repair masks, mean and maximum absolute scene-linear RGB
differences against the old GPU kernels were 2.11e-9 and 2.38e-7 for the
ORF, and 1.53e-9 and 1.49e-8 for the CR2. Both comparisons used the same
native scene pixels per photo. ORF finished mean and p99.9 were
0.00000936 and 0.000188 ΔE ITP for HDR, and 0.00000347 and 0.0000930
ΔE 2000 for SDR. The CR2 straightens before finishing, so the raw repair
mask was used only for scene-linear figures. The review shows both saved
grades with Denoise bypassed to isolate Retouch. Its HDR AVIFs and SDR PNGs
are in `codebase/output/review/retouch-cpu-heal/`.

## November 26: HSL delivery after leaving Grade

MacBook Neo, A18 Pro, 8 GB, 1408×794, shared GPU lock. Two runs of
`hsl-selection-delivery.js` on the shared checkout based on `74286a54`.
The driver now leaves Grade before delivery, as the app does. These are
export-request-to-result times, excluding Proof and comparison, with fast
checks overlapping the first run. No new speed comparison is inferred.

| Photo and edit | GPU export | Forced-CPU export | Existing checks |
| --- | ---: | ---: | --- |
| Balanced Rock, neutral | 8.84–12.44 s | 9.93–13.71 s | Renderer agreement, HDR ceiling and byte-identical Proof pass both runs |
| Balanced Rock, Global HSL | 14.60–21.05 s | 45.67–62.59 s | Same checks pass. HDR ΔE ITP mean/p99 0.0267/0.0761 vs neutral 0.0237/0.0523 |

## November 26: native CPU Retouch preview after repair edits

MacBook Neo, A18 Pro, 8 GB, 1408×794, shared GPU lock. Two fresh-profile
runs on the generated 24 MP photo in `retouch-cpu-fallback.js`. Values are
click to visible Raw RGBA8 for the four warm samples per row. The backend
recorded 19 native strip requests per run and no preview memory refusals.
The 3 s native target is informational in this driver. One inpaint sample
took 3.10 s.

| Repair | Fit | Native |
| --- | ---: | ---: |
| Inpaint | 0.71–1.19 s | 2.33–3.10 s |
| Clone | 0.51–0.74 s | 2.11–2.20 s |
| Heal | 0.51–0.63 s | 2.11–2.30 s |

## November 26: GPU delivery after clicking Export in Grade

MacBook Neo, A18 Pro, 8 GB, 1408×794, shared GPU lock. Two fresh-profile runs
per HSL variant with the Grade preview recovery timer kept idle in Export.
Times are export request to result, excluding Proof and comparison. These
are verification runs, not a speed comparison.

| Balanced Rock edit | GPU export | Forced-CPU export | HDR ΔE ITP mean / p99 |
| --- | ---: | ---: | ---: |
| Neutral | 6.94–7.71 s | 9.05–9.58 s | 0.0237 / 0.0523 |
| Global HSL | 14.10–14.39 s | 42.91–43.11 s | 0.0267 / 0.0761 |
| Local hue mask | 15.48–15.62 s | 28.06–28.98 s | 0.0358 / 0.1479 |

All four runs pass the existing HDR and SDR renderer agreement, encoded HDR
ceiling and byte-identical full-size Proof checks.


## November 26: CPU HSL obsolete protection-plane cleanup (PC)

The old bright-spot protection plane was uniformly one. Removing it preserves
selection pixels exactly (nine signed/HDR, scale and edge-control comparisons)
and avoids one retained float32 plane. At 2048 x 1536, prepared-selection arrays
fall from 26,738,688 to 14,155,776 bytes: 12 MiB saved.

CPU `prepare` plus `select`, including all preparation and mask processing,
measured median 451.31 ms before and 469.40 ms after over five paired samples
(one warmup omitted, same deterministic 3 MP RGB array). The 4.0% change is
inside the existing 5% comparison band; no speedup or whole-app latency claim.
Other reviewers and Steve's app were running on the PC. This is an allocation
cleanup and CPU diagnostic, not a new timing baseline or GPU qualification.
