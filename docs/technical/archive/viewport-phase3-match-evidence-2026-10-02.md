# Phase 3 Match on the GPU — October 2, 2026

Steve directed this slice on October 2 after the commit `bb38137`, approved
the result the same day (a different Match recipe is acceptable; he will
judge matched pictures on screen himself) and authorized committing it,
without a push. Phase 3 remains open; phase 4 has not started. No tolerance,
quality gate, fixture, peak-reduction shader or Denoise shader was changed.
Export and Proof are unchanged.

## What Match was spending

One Match per fixture at the start of the slice, the backend's own timing
(`match-before-*.json`):

| Fixture | Request | Click to page return | Candidate renders |
|---|---|---|---|
| Primary | 4.49 s | 6.20 s | 11, 2.87 s |
| Four-mask | 3.77 s | 4.59 s | 11, 2.34 s |
| Fifty-local | 20.19 s | 23.98 s | 11, 15.96 s |

Match analyses a 768-pixel copy of the picture. It renders the settled HDR
target once, then explores editable SDR recipes by rendering each on the CPU
and measuring it against that target: nine in the Exposure refinement, then
the base candidate and the tone-equalizer merge, and up to seventeen more when
the result needs semantic or curve corrections. A CPU candidate cost about
210-260 ms with four or five locals and 1,450 ms with fifty. The page then
waited a further 0.8-3.8 s for a CPU scope of the SDR lane.

## Design

The fitting logic stays in `sdr_match.py`, with its order and every
dependency between trials intact. Only the rendering of a candidate moves.

- **Bridge.** `sdr_match_remote.py`. The Match request thread offers a
  recipe and waits. The page collects it from
  `GET /api/session/{id}/sdr-match/candidate`, renders it, and returns
  half-float RGB to `POST .../candidate/{job}`. Locals travel once.
- **GPU candidate.** `renderMatchCandidate` in `webgpu-preview.js` grades the
  recipe as SDR from the scene source at the analysis size on its own canvas,
  without grain, and reads back the finished, output-mapped, clipped picture:
  the same display-linear sRGB frame the CPU candidate is. It measures the
  shoulder anchor on its own frame, as the CPU candidate does, through the
  existing SDR prefix reduction; it does not touch the editing anchor cache
  or ask the scheduler for a measurement.
- **The CPU has the last word.** The recipe the fit arrives at is rendered
  once by the export pipeline and measured. That measurement is the reported
  quality, decides matched or needs-review, and applies the rejection gate.
- **Fallback.** If the page declines, answers late (6 s for the first
  candidate, 3 s after), returns the wrong size, or the CPU measurement
  rejects the recipe, the bridge closes and the whole fit runs again on the
  CPU exactly as before. No decision from an abandoned attempt survives.
  CPU rendering mode and Convert (which analyses a captured recipe whose
  locals are not the session's) never use the bridge.
- The target's half of the quality metric (luminance, OKLab, selection) is
  computed once per fit instead of once per candidate. Same numbers.
- After Match, the page no longer requests a CPU scope for the SDR lane while
  HDR is on screen; nothing displayed it.

## Three things the first measurements exposed

**1. The preview clipped SDR to white before the locals; export does not.**
The first verify run (below) showed GPU and CPU candidates agreeing in the
body but differing by up to 0.15 in the brightest 5% of pixels, under the
gradient local. With no locals the two agreed to 0.0007. The GPU's SDR base
stage ended with an unconditional clamp to [0, 1]. Export clips to display
white only inside the stages that are active (contrast, primaries, curves,
colour grading). A tone-equalizer lift above white therefore reaches Detail
and the locals unclipped on export, and a darkening local recovers it; the
preview had already thrown it away. This is a preview-versus-export
difference for any SDR recipe of that shape, not only during Match, and
Match's own recipes have that shape. The base stage now clamps only below
zero, and active SDR colour grading clips inside its own stage as export's
does. The four-mask difference fell to 0.002.

**2. Returning pixels to the backend was slow, and only through the desktop
shell.** A 4.7 MB upload took about 220 ms from the page (21 MB/s); a plain
client uploads the same body to the same server in 6 ms. Candidates were no
faster than the CPU. Sending half-float RGB (2.4 MB) as a Blob takes 8-9 ms.
The cause inside the shell was not investigated further.

**3. Reading the picture back through the scope reduction was not exact.**
On the cropped primary, candidates differed along edges by up to 0.17. With
the crop reset they agreed. The dumped pair showed the GPU picture was the
CPU picture with adjacent rows averaged: the settled scope pass, used at one
cell per pixel, computes its cell bounds in float and for a 480-row frame
takes in a neighbouring row. The render was correct; the readback was not.
Candidates are now read through a pass that returns the output picture texel
for texel. The settled scope pass is unchanged; the same arithmetic there
moves a histogram cell boundary by at most one source row.

## How well GPU candidates agree with CPU candidates

`--renderer verify` renders every GPU candidate on the CPU as well and
reports the difference in display-linear luminance (white = 1). One run per
fixture, final code:

| Fixture | Candidates | Worst p99 | Worst pixel | Shoulder anchor GPU / CPU |
|---|---|---|---|---|
| Four-mask (768 x 513) | 11 | 0.0012 | 0.0019 | 8.7268 / 8.7292 |
| Primary, cropped (481 x 480) | 28 | 0.0019 | 0.0043 | 0.8096 / 0.8095 |
| Fifty-local (768 x 513) | 11 | 0.0064 | 0.0101 | 8.7268 / 8.7292 |

The fifty-local run predates the exact readback; it is uncropped, where the
readback was already exact, and was not repeated. Median differences are
0.0001 or less. These are three projects, not a guarantee for every recipe.

## What Match chooses now

Same click, GPU candidates against CPU candidates, CPU-measured quality in
both columns (`match-final-{gpu,cpu}-*.json`):

| Fixture | Mode | Exposure | Curves | P95 luma / OKLab | Status |
|---|---|---|---|---|---|
| Four-mask | CPU | 0.30 | neutral | 0.01725 / 0.00948 | needs review |
| Four-mask | GPU | 0.30 | neutral | 0.01742 / 0.00956 | needs review |
| Fifty-local | CPU | 0.30 | neutral | 0.01951 / 0.01496 | needs review |
| Fifty-local | GPU | 0.30 | neutral | 0.02048 / 0.01581 | needs review |
| Primary | CPU | 0.15 | neutral | 0.02300 / 0.03947 | needs review |
| Primary | GPU | 0.20 | RGB curves authored | 0.02061 / 0.03745 | needs review |

On the two uncropped projects the recipes agree except for tone-equalizer
nodes within 0.01 EV. **On the primary the result is a different recipe.**
The CPU fit ends with OKLab P95 at 0.0395, just inside the 0.04 gate that
decides whether the semantic and curve corrections run; the GPU fit lands
just outside it, runs them (28 candidates instead of 11), and ends with a
slightly lower measured error and authored RGB curves. Both are valid, both
are needs-review, and the quality shown for each is the CPU's. A user who
matched this project before and after would get different SDR controls.

The fifty-local GPU recipe measures 0.001 worse than the CPU one. Status did
not change on any fixture.

## Speed

One Match per fixture and mode, final code, action to page return:

| Fixture | Start of slice | CPU candidates now | GPU candidates now | Goal |
|---|---|---|---|---|
| Four-mask | 4.59 s | 4.49 s | 1.81 s | 2 s |
| Primary | 6.20 s | 6.27 s | 3.17 s | 2 s |
| Fifty-local | 23.98 s | 23.32 s | 5.94 s | 4 s |

The CPU column was measured before the page stopped waiting for the SDR
scope. Each cell is a single run. Four-mask is under the goal in this one
run; the other two are not. A GPU candidate costs about 30 ms on the first
two fixtures and 60 ms with fifty locals (render 4-5 ms, readback 4-9 ms,
upload 8-9 ms, the backend's metric the rest), against 210-1,450 ms.

What remains is CPU work the bridge does not touch (final GPU runs):

| Stage | Four-mask | Primary | Fifty-local |
|---|---|---|---|
| 768-pixel source | 299 ms | 270 ms | 295 ms |
| Settled HDR target | 158 ms | 532 ms | 1,807 ms |
| Semantic and local translation (masks) | 96 ms | 186 ms | 1,048 ms |
| Neutral tonal fit (about 330 small ramp renders) | 220 ms | 455 ms | 219 ms |
| GPU candidates | 328 ms (11) | 703 ms (28) | 635 ms (11) |
| CPU certification | 241 ms | 289 ms | 1,430 ms |

Not built: rendering the HDR target on the GPU (it defines what SDR is
matched to, so it stayed on the export pipeline), and anything for the other
CPU stages.

## Checks

- `tests/test_sdr_match_remote.py` (5): bridge round trip, wrong-size and
  declined answers, timeout, one bridge per session, a page-rendered fit
  whose reported quality equals the export render's, and a page that stops
  answering giving exactly the CPU result. The page is a thread using the
  export pipeline, so these do not test the GPU renderer.
- All 44 Python Match tests pass. The Python suite is 1,636 passed, 2
  failed: `test_frontend_inventory_contract.py` (known), and
  `test_model_declaration_contracts.py` (the Proof request signature gained
  `editing_measurements` in phase 2 and the test was not updated; it fails on
  `bb38137` too and was left alone). Three other failures were fixed here:
  one contract line this slice had reworded, and two contract assertions the
  committed phase 3 work had outdated (GPU scope serial; local curves and
  wheels supported).
- Node: 339 of 340, the same `highlight-anchor.test.js` failure as before.
  Peak and Denoise shader pins pass.
- `tests/sdr-match-gpu-interaction.js` passes in Electron after its check
  that local curves and wheels are refused by the GPU was brought up to date.
- After the SDR clipping change: `neutral-color-grading-reference.js` (8
  cases) and `local-grade-reference.js` (24 cases) pass; one enforced centre
  comparison each, 1,947,690 pixels, passes picture, masks and peak for
  primary HDR (0.854% / 1.947%, unchanged), primary SDR (measured 1.533% /
  3.017%, judged maximum 2.182%) and four-mask SDR (every pixel within one
  display level). As-saved projects do not exceed display white before their
  locals, so these show no regression rather than exercise the fix; the
  verify runs above exercise it at the analysis size on the Direct route.
- All three fixture hashes are unchanged.

`tests/performance/match-candidate-review.js` is the driver for all of the
above; raw reports are under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`
(`match-*.json`).

## Open

- Primary and fifty-local Match are over their goals; the remaining time is
  CPU work listed above.
- The clipping fix was not compared against export at 100% zoom on a project
  that needs it (a matched recipe with a darkening local over lifted
  highlights).
- Whether global SDR Detail behaves as export does on values above display
  white was not checked; export clips there only where Detail changed a pixel.
- Match under CPU rendering mode and Convert are unchanged and as slow as
  before.
- Why the desktop shell uploads an ArrayBuffer body at 21 MB/s.
