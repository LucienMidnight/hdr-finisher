# Performance table

How long each action in HDR Finisher takes, against its target. Use it to
choose performance work, and to spot regressions: a new measurement well
outside its recorded range needs a one-line note, even when it is still
inside the target.

Started October 30, 2026 by Claude from the module PRDs and the October 30
logs. Keep it current: whenever a change, test or log review produces a
timing, update its row (range, date, commit, conditions) in the same commit.

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
sequence 35.496→32.596 s. One DSC00264 trace starts 1.664 s after input, so the
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
