# Faithful RawTherapee LMMSE on signed Bayer — November 17, 2026

## Plain-language summary

Evaluation in progress. This is a research-only candidate, not a shipping change.

## Pre-measurement contract

Use the frozen preceding signed-full inventory, seeds, capture gains, masks and
12 decision rows. Primary Off and AHD use the installed production signed AHD
core on the harness's common normalized sensor/identity temporary-DNG Lab bridge.
Both noisy and clean Bayer develop signed. Keep the earlier research signed-AHD
support for lifted-shadow tails so the dark-pit comparison cannot move its mask.

Every classical candidate uses the `dark_noise` informative-calibration repair
and current shipping controls: Amount .75, Luminance .5, Color Noise .75,
Detail Recovery .5 and all frequency sizes .5. RawNIND Bayer runs alone; its
existing negative-input clipping and model-training splits remain explicit.
No fitting to clean ground truth or new camera calibration is allowed.

Fix upstream `iterations=3`: gamma 2.4/slope 17 and two differential-colour
median passes. This is a declared upstream option, not a claim about a current
RawTherapee application preference. The prior own MMSE-style adapter remains a
separate reference. Include upstream linear iterations=0 as clean-input
sensitivity only. IGV is optional; do not delay the priority measurements for it.

Use inherited ±10% descriptive CPU timing allowance on the same minimum Mac,
because these are single-run bounded research costs with run-to-run variation,
not live action-to-screen targets. Keep all existing quality guards; diagnostic
PSNR/artifact/tail numbers do not establish new acceptance thresholds. A shipping
CPU/GPU implementation must agree on finished pixels: SDR ΔE2000 and HDR ΔE ITP
mean <1, p99 <3. Finished HDR must never exceed the chosen cap before encoding;
the encoder's 1% rounding allowance does not apply to these floats.

Prioritize quick synthetic, pristine clean charts/low-noise inputs, Canon crops
and held-out pairs; then full/seen/safety/native if the actual heavy work remains
well below approximately 90 minutes. Every heavy process uses the shared machine
lock and the existing 2.5 GB process-tree guard. Retain small PNGs/receipts only.

## Upstream and signed adaptation

RawTherapee GPL-3.0-or-later, commit
`64c2d90a3248c7ad41842d9162368858b61aac6a`, file
`rtengine/lmmse_demosaic.cc`; vendored SHA-256
`d1064f21cbae0c4a97580698f577b5d63fe919e907d77483b30f1be3ac4a11ba`.
The complete source is byte-for-byte upstream. It attributes Zhang and Wu's
2005 directional LMMSE paper, Jacques Desmis's 2013 RawTherapee adaptation and
Ingo Weyrich's 2015 speed/memory work. `vendor/rawtherapee/NOTICE` and root
`THIRD_PARTY_NOTICES.md` record the licence and the same-commit gamma/LUT helpers.

The build substitutes a small scalar host interface, not a rewritten MMSE
formula. It retains the original directional estimates, 9-tap Gaussian-like
low-pass, nine-observation variance/error estimators with `1e-7` stabilizers,
variance-weighted fusion, colour-difference interpolation and median passes.
The stock control preserves the upstream range gates and final positivity floor;
a separately compiled unmodified upstream body checks that adaptation.

Literal upstream LMMSE is unsigned: its gamma input, candidate estimates,
colour differences and final output clip ranges. Signed mode explicitly removes
those gates/floors, continues the gamma toe linearly below zero, and uses the
same analytic gamma pair above white. A first LUT-end extrapolation attempt
introduced a neutral above-white round-trip error; a new constant-field test
caught it and the implementation was fixed, not the tolerance. This signed
domain extension is not an assertion that stock RawTherapee accepts negative
samples. SIMD/OpenMP/GUI integration is not copied or qualified.

Optional upstream edge reinforcement (iterations 5–8) is retained and stock-
oracle tested, but requires whole-image mode because its updates are in-place.
The measured candidate uses iterations 3 and exact tested 32px-context strips.
No non-commercial code, dataset image, photograph or model weight enters Git.
