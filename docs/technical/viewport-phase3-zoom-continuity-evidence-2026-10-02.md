# Phase 3: cross-scale zoom continuity, October 2, 2026

Phase 3 remains open. Peak issues P3-PEAK-01 and P3-PEAK-02 remain deferred
under Steve's instruction. This record identifies a separate picture issue,
**P3-ZOOM-01**, which Steve subsequently deferred because it is close to the
limit. The requirement remains open and the 2% limit is unchanged.

## Measurement

`codebase/tests/performance/zoom-block-continuity.js` opens the read-only
four-mask fixture in a disposable Electron profile, using a 2560x1440 window.
It selects 100% and 50% zoom through the app, centres the viewport, waits for
queued refinement/panning and settled scopes, and reads at most 1024x768
visible presentation pixels per frame. No CPU export or project save runs.
Both app-selected frames use exact tiled presentations. The checker requires
exact 2:1 processing dimensions; its hardened version also verifies DPR 1 and
one presentation pixel per screen pixel, and waits for pending/inflight
highlight-anchor work. It writes the original fixture hash even on failure.

The common native rectangle is (2160,3616), size 1008x752. After decoding the
presentation encoding to display-linear light, the tool compares 2,961
aligned blocks: 16x16 native pixels against 8x8 pixels at 50%, covering the
same source area. It uses section 4.4's section 4.1 typical limits: luminance
p99 <=2%, OKLab p99 <=0.01. No pixel-wise eight-bit exemption is applied to
these averaged blocks. This compares two GPU scales, not preview to export.

## Results and isolation

| Case | Luminance p99 | OKLab p99 | Continuity |
|---|---:|---:|---|
| HDR, fixture as saved | 0.6838% | 0.001377 | pass |
| SDR, fixture as saved | 3.3494% | 0.003581 | fail |
| SDR, settled manual anchor 100% | 3.3619% | 0.003570 | fail |
| Same manual anchor, every local disabled | 3.3619% | 0.003571 | fail |
| Same isolated case, Black & White enabled | 0.6327% | 0.000640 | pass |

The initial SDR run has luminance maximum 8.3982%, with 8.240459% of blocks
above the typical bound. Its display-encoded difference p99 is 5.1042 levels;
the discrepancy is not just a single pixel's quantization step. Global SDR
Texture, Clarity, Sharpen, softness and microcontrast are zero in the fixture;
grain, halation and bloom amounts are also zero. The manual runs use identical
saved-in-report lane adjustments at both scales.

Changing to a manual anchor and waiting for anchor settlement leaves the
failure. Disabling all locals also leaves it, so the new regional scene-mask
work is not responsible. Black & White passes on the same readback geometry,
which narrows the problem to the colour path and its source-scale interaction.
This does not prove a specific shader function is faulty.

The current backend source pyramid applies Lanczos resizing before the GPU
SDR scene-to-display colour stages. Those include nonlinear gamut mapping.
Processing colour before downsampling is a plausible investigation direction;
the results above alone do not establish a fix. A native-resolution GPU
implementation limited to the visible region could increase work at 50%
(roughly four times the source pixels before halos), so its latency and memory
cost need measurement. No whole-image native CPU work, change to export,
gamut algorithm, Peak/Denoise shader pins, or tolerance change was introduced.

## Status and owner decision

P3-ZOOM-01 remains unmet on the current colour route. The supplied sprint
instructions say: "If an accuracy limit cannot be met, show evidence and stop
for Steve's decision." Unlike the deferred Peak issues, this is a newly
measured picture-continuity failure. Steve then directed: "defer it since it's
close to the limit. continue the other work." That decision authorizes
continuation without reopening this known failure. The requirement and
possible redesign remain open. No sprint-complete claim is made.

## Artifacts

Local ignored artifacts are under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`:

- `four-mask-zoom-block-continuity.json`: initial HDR/SDR result, raw frame
  readbacks and metadata alongside it. The initial harness did not persist
  the final unchanged-fixture field after its failing assertion.
- `four-mask-zoom-manual-anchor.json`: hardened manual-anchor isolation.
- `four-mask-zoom-no-locals.json`: locals disabled in the disposable session.
- `four-mask-zoom-monochrome.json`: monochrome isolation, passing result.

Each isolated run includes an unchanged input hash. The fixture's SHA-256 is
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`.
