# Phase 3 matched SDR highlights at native zoom — October 2, 2026

After Steve accepted the current Match speeds for now and authorized the
commit, CPU input reuse was committed as `e3a5a7f`. No push was requested or
made. This next slice verifies the outstanding matched-SDR clipping and
global Detail case from section 14.5. Its comparison-tool changes are
uncommitted; no production pixel implementation changed. Phase 3 stays open.

## Native captures

Two serial disposable Electron sessions opened the read-only four-mask
42 MP fixture, ran Match through the app's default GPU route, then set global
SDR Sharpen to 35, radius 1.7 source pixels and threshold 10. Texture and
Clarity remained zero. Each captured one centre region at 100% zoom:
`x=1699, y=3489, width=1938, height=1005` (1,947,690 pixels).

Both used the app-selected tiled route, processing scale 1, native source
edge 7,968 and `bgra8unorm` presentation. Each native export reference used
the captured edit document through the CPU export pipeline before encoding.
Electron ran through `tests/run-in-electron.js`, outside the tool sandbox
at 2560 x 1440, with no other HDR Finisher work running. No project was saved.
The fixture hash remains
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`.

**Original matched locals with Sharpen:** picture and masks pass `--enforce`.
All pixels are within one display level of export (reported maximum 1.00 level).
Measured luminance p99/max are 2.039%/3.361%; OKLab p99/max 0.00210/0.00840.
The existing 8-bit rule judges all inside the limits. Gradient and path masks
are exact; brush maximum is 1.00 level; luminance maximum is 2.13 levels,
with the same 39 pixels above 2 as the accepted trial-mask case.

A CPU-only stage inspection of that saved capture establishes real
above-white input to global Detail, but finds no above-white local input
recovered below 0.98 in this region. Its diagnostic assertion correctly
refuses to call this the darkening-local regression case. Picture/mask
agreement itself passes; this is missing scenario coverage, not an accuracy
failure. That CPU inspection rerendered the saved document once; the page
capture and Match were not repeated for it.

**Controlled darkening local with Sharpen:** a second session disables the
existing locals' SDR grades, then adds an ordinary neutral gradient local at
-1 EV. A zero-length gradient axis gives exact full coverage in both CPU and
GPU implementations. Existing HDR grades and the matched global SDR recipe
remain in the session. This isolates the clipping case rather than relying
on the saved mask locations to overlap the bright region.

Picture and the diagnostic mask pass `--enforce`. Of the 1,947,690 pixels,
1,947,675 are within one display level; the remaining 15 are judged by the
unchanged tone/colour limits. Judged luminance p99/max are 0%/4.445%, and
OKLab p99/max 0/0.01838, within 2%/5% and 0.01/0.03 respectively. Measured
luminance p99 is 2.073%; the maximum channel difference is 13.48 display
levels at an outlier, so this capture is not described as all within one
level. The full-coverage gradient mask is exact.

## This case exercises the fix

The second export reference records CPU stage counts inside the captured
native region, without modifying the pixels returned by either stage:

| Stage observation | Pixels |
|---|---|
| Input to global Detail has at least one channel above display white | 130,061 |
| Detail leaves the above-white sample exactly unchanged | 128,337 |
| Detail changes the above-white sample and clips it to white | 1,724 |
| Above-white input reaching the local stack | 128,337 |
| Those samples recovered below 0.98 by the darkening local | 128,337 |

The largest input channel is 1.167657 (white = 1). The final native preview
comparison passes on the same region. Thus this check exercises the
preservation of above-white values before locals, and global Sharpen's rule
that unchanged pixels retain their input while changed SDR pixels clip.
It does not prove the full local/global Detail matrix, other Sharpen values,
Texture/Clarity, other projects or other regions. HDR peak measurements and
Proof identity were not repeated: no production rendering or measurement
code changed in this verification slice.

## Harness and focused checks

- `preview-export-compare.js --match` runs the app's Match before its usual
  in-session `--set` edits and captures that materialized document.
- `--sdr-darkening-check` requires `--match`, isolates the full-coverage
  darkening local and requires nonzero recovered above-white pixels in a
  captured SDR region. It requests optional CPU stage evidence in the
  reference tool; a comparison with no such coverage fails the driver.
- Optional `inspect_sdr_stages` wraps only the diagnostic CPU export render.
  It retains copies of captured regions rather than an extra native frame,
  returns the original stages' pixels unchanged and restores both functions
  on exit, including failure. Normal comparisons do not install the wrappers.
- All 19 focused comparison-accounting tests pass, including two added checks
  for exact diagnostic pixels, region-only counting and function restoration
  on normal exit and a reference-render exception. Node syntax and Git
  whitespace checks pass. No long session, completed baseline or broad suite
  was rerun.

Raw artifacts are local/ignored under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`:
`matched-sdr-detail-native.json`, `matched-sdr-darkening-detail-native.json`
and their capture/comparison directories. The first directory also contains
`stage-coverage.json` and `comparison-stage-coverage.json` from the CPU-only
inspection; its diagnostic script is `check-sdr-native-stage-coverage.py`.
The second comparison contains `stageEvidence` beside its tone/mask results.

The two specific section 14.5 native-SDR unknowns now have passing evidence
for the case above. Remaining phase 3 work includes brush feather/shift and
transformed masks, regional luminance for authored/legacy matched SDR sources
and expression leaves, the complete Detail matrix and wider 50-local/zoom
continuity coverage. Match's present speed is accepted for now. Phase 4 has
not started.
