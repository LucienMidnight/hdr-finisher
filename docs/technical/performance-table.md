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
