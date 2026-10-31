# Performance table

How long each action in HDR Finisher takes, against its target. Use it to
choose performance work, and to spot regressions: a new measurement well
outside its recorded range needs a one-line note, even when it is still
inside the target.

Started October 30, 2026 by Claude from the module PRDs and the October 30
logs. Keep it current: whenever a change, test or log review produces a
timing, update its row (range, date, commit, conditions) in the same commit.

## How to read and update it

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

| Action (from → to) | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Folder open → rows usable | 0.5 s end to end (photo-library.md) | 31–164 ms | Oct 30 18:18; 10–453-photo folders | Met |
| Very large folder → first 256 rows / first picture / 25th picture | Regression baseline (Steve, Oct 27) | 3.81 / 4.20 / 5.40 s | Oct 27, 155,877 rows, 015baf7 | Baseline |
| Folder open → first camera preview (RAW) | Under 0.2 s (tier 0, Steve Oct 12) | 0.14–0.29 s | Oct 30 18:18 | Met |
| Camera preview extraction (backend only) | — | p50 56 ms, max 143 ms | Oct 30 18:18 (`picture_camera_preview_ready`) | Baseline |
| Camera preview request → on screen in the grid, while photos develop | p95 under 0.5 s (phase 3a brief) | p50 1.507–1.551 s / p95 2.410–2.783 s / max 2.630–2.847 s | Oct 31 phase 3a.2, two quiet cold Aceh repeats, 48 previews each, 2560×1440 isolated profiles | Not met |
| Visible cell shows any picture | 1 s p90 (Oct 18) | — | needs a fresh measurement | Unknown |
| Visible cell shows its real picture | about 2 s p90 (Oct 18) | — | needs a fresh measurement | Unknown |
| Second launch: visible thumbnails | 90% within 100 ms (Oct 18) | — | needs a fresh measurement | Unknown |
| Folder open → first finished thumbnail, stored pictures | — | 0.52 s (25th 2.06 s) | Oct 30 18:18, badminton | Baseline |
| Folder open → first finished thumbnail, cold RAW | — | 4.4–8.8 s | Oct 30 18:18, Kiddos Batik, 20241117 | Baseline |
| Cold JPEG grid: first screen of 24 / second screen | ≤26.51 / 51.59 s (24.1 / 46.9 s +10%) | 29.442–32.111 / 56.064–57.203 s | Oct 31 phase 3a.2, Aceh repeats 6/7, peaks 3.598/3.712 GB, all 48 finished, zero failures/timeouts | Not met |
| Thumbnail cache check per cell | — | 13–930 ms seen | Oct 30 18:18 (`page_picture_cache_check`) | Baseline |
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
| Stored screen preview: first / next SDR / HDR draw | about 100 ms | 226 / 115 / 162 ms | Oct 26, disposable restart | Not met |
| Cold non-RAW sharp draw (JPEG) | within 1 s (Steve, Oct 26) | 0.85–0.9 s | Oct 26, 8b64302 | Met |
| Fullscreen sharp draw, cold RAW (CR2) | — | 2.52 s | Oct 30 18:18, 2L1B8631.CR2 | Baseline |
| Fullscreen sharp draw stages: lease wait / pixel fetch / render / draw | — | 132 / 110 / 32 / 291 ms | same, n = 2 | Baseline |
| Stored scene pixel fetch (2560) | — | 65–150 ms | photo-library.md | Baseline |
| Graded Denoise sharp draw | 0.5 s (PRD open work) | about 0.57 s combined | Oct 26 | Not met |

## 5. Grade (editing)

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Local tool enable, 24 MP, Fit / 100% | about 0.3 s | 0.041 / 0.045 s | grade.md | Met |
| Local range change, 24 MP, Fit / 100% | about 0.3 s | 0.042–0.054 / 0.129–0.141 s | grade.md | Met |
| Local Exposure drag | — | about 31 frames/s | grade.md | Baseline |
| Retouch, warm small spot | 1 s | 0.70–1.04 s | grade.md, Oct 23 | Met (borderline) |
| Open the 297 MP line-scan DNG in Grade → first frame | — | import 19–30 s; first frame 34 s | Oct 30, Steve's app and disposable copies; backend holds 3.7 GB, spikes to 9.7 GB | Baseline |
| Open a 50 MP ARW (DSC00636) in Grade → import | — | 7.8–9.6 s | Oct 30, disposable copy, headless Edge | Baseline |
| Rating save (background) | — | about 110 ms | photo-library.md | Baseline |

## 6. Export and Proof

| Action | Target | Measured | Conditions | Status |
| --- | --- | --- | --- | --- |
| Batch export pace | 5 s per photo | about 5.2 s per photo (GPU turn 2.7 s) | export-and-proof.md, Oct 20 | Not met (close) |
| Full-size single export | under 15 s | 24 s | same | Not met |
| Full-size Ultra HDR export, CPU | — | about 33 s | Oct 19 | Baseline |

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
