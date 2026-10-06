# Phase 3 local curves and colour wheels — October 2, 2026

Local colour wheels, balance, blending and curves no longer cause the
`unsupported-local-adjustment` GPU refusal. Each active local's curve set has
its own section of the GPU LUT buffer; neutral channels skip mapping. Curves
and colour wheels run before local Detail, in export order. LUT samples are
cached per local/lane; buffer growth retires old resources through the
existing active-render lifetime guard. Global curves retain their existing
evaluation path. Peak and Denoise shaders remain byte pinned.

A tiny actual local-pass/export comparison also exposed pre-existing SDR
differences. Local export converts sRGB to ACEScg with CAT02; the GPU local
pass used the shared source transform's different matrix. The local pass now
uses export's matrix. Export's SDR curve stage clips even neutral curves,
and its active grading clips before Detail. These stage clamps now match.
The final no-Detail candidate is clipped before mask/opacity blending.
Export was not changed and no tolerance was widened.

`tests/local-grade-reference.js` tests the production parameter builder and
local shader against `_apply_local_grade`, on zero, signed near-black,
ordinary and bright colours. Neutral grading with nonneutral hue/balance,
active wheels, combined tone/white-balance/saturation, luma curves and RGB
curves are tested in both lanes at opacity 1 and 0.4. Twenty-four cases,
192 pixels, pass; maximum absolute channel error is 0.00000524520874.
The shader result is read as float32, independently of display quantization.
The final regression puts a different curved local before the tested local,
exercising two independent LUT offsets. This does not establish the complete
local Detail matrix or Match agreement.

One fresh as-saved four-mask SDR-centre capture, 1,947,690 paired pixels,
uses the app-selected tiled route at scale 1. Picture, masks and peak pass
`--enforce`. Measured luminance p99/max are 2.014%/3.170%; OKLab p99/max
are 0.00207/0.00595. Every pixel is within one display-encoding level
(maximum 0.86 level), so the existing 8-bit rule judges all inside the
picture limits. The GPU path and gradient masks are exact; the unchanged
SDR CPU luma mask has maximum 1.10 levels and the soft brush 1.00 level.

Twenty-seven focused Node tests pass: mask packing, shader byte contracts,
graph scale and local Detail cache identities. The small GPU checks open no
project. The one fixture comparison opens a disposable session and never
saves it. No long-session suite was repeated.

Raw artifacts are ignored under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`:
`local-color-kernel.json`, `local-color-kernel-fixed.json` (diagnostics),
`local-color-kernel-final.json`, `local-curves-kernel.json`, and
`local-controls-fourmask-sdr.json` with capture/comparison companions.

## Fifty-local route observations

One disposable HDR session made a local luma-curve/colour-wheel edit at Fit,
then zoomed to 100%. All 50 locals stayed enabled and both pictures used
WebGPU. `fifty-local-route-smoke.json` measured 35.8 ms to the Fit picture and
467.4 ms to scopes; native zoom measured 674.6 ms to the picture and 3,971.7 ms
to CPU scopes. This is one sample per operation, not an alternating study.
Source-transport metrics can describe a later measurement patch, so they are
not proof of the display's source rectangle. The subsequent bounded GPU
scope/overview change is in [auxiliary-view evidence](viewport-phase3-auxiliary-evidence-2026-10-02.md).

Phase 3 remains open: brush feather/shift, transformed masks, SDR regional
luma, Match, complete Detail coverage and broader 50-local scaling.
The current stage is uncommitted. Phase 4 and push remain unauthorized.
