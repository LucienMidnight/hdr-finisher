# AI Denoise with highlight reconstruction

November 17, 2026. Research only. No editor, product requirement, saved photo,
shipping dependency, shader, budget or delivery guard is changed.

## Steve's summary

Investigation in progress: a region blend keeps the real reconstructed
highlight result and uses AI away from it. This does not yet establish that
the join is invisible, that signed shadows are preserved, or that AI is ready
for v1. Steve's November 17 revisions in `ai-experimental-design.md` override
its older recommendation to disable reconstruction with AI.

## Experiment contract, fixed before measurement

- AI is an explicit per-photo choice in Denoise, never initial development.
  Only RawNIND Bayer UtNet2 is tested. Current/classical Denoise must not run
  on top of the AI result; Strength blends with the normal reconstruction.
- Use original normalized sensor samples and the pinned model's [0,1]
  convention. The original, signed, unity-WB AHD camera-RGB mean is the one
  frame-global gain anchor. Do not substitute the repaired mean or per-tile
  normalization. Real sources are inferred at full native dimensions.
- Normal reference is actual production signed AHD, actual sensor Opposed
  repair and, when chosen, actual RGB Edge colour at Expand 0%, 1% and 5%.
  Camera WB and conversion to ACEScg happen once. Coordinates stay in sensor
  orientation; no lens correction, spatial reorientation or creative grade.
- Protect 2×2 Bayer cells whose sensor maximum reaches 92% of the existing
  0.987 clipping threshold, plus the reconstruction's measured RGB support
  above 1e-6 linear units. Dilate eight sensor pixels for demosaic context;
  test smooth 32px and 128px feathers. The support epsilon suppresses float
  roundoff; it is not a perceptual tolerance or a proposed app control.
- Provisional screening: mean boundary ΔE2000 below 1 and p99 below 3 on
  finished SDR views with the existing fixed −0.8 EV RAW calibration;
  compare normal and −3 EV. Inspect HDR ΔE ITP too.
  Relative inside/outside highpass ratios of 0.8–1.25 are a warning screen,
  not proof of equal noise: real-picture highpass includes texture. Actual
  adjacent-edge jumps are compared against the same normal-reference jumps,
  rather than falsely calling a natural lamp edge a blend seam. Empty bands
  are unmeasured, never passes. Visual acceptance remains Steve's decision.
- The protected core must retain the normal result exactly and fully AI
  pixels must retain the standalone AI result exactly. These are algorithm
  endpoints, not a new CPU/GPU pixel-equality delivery requirement.
- Safety applies exposure after development, not to sensor samples: −6/0/+6
  EV over every native output pixel for the primary 32px Opposed/Edge-1%
  combinations, through the existing CPU delivery limiter. Crop probes also
  cover −3/+3 EV and the shoulder. The exact 1000-nit cap has no allowance.
  This is not encoded-file, GPU, Proof or whole-editor qualification.
- Timing: one CPU/native thread, MacBook Neo / Apple A18 Pro / 8 GB, shared
  machine lock, 2.5 GB sampled process-tree RSS guard, 30-minute per-command
  timeout. Native 18 MP Canon and 42 MP Sony costs separate AI, sensor repair,
  additional AHD/tail, Edge, support-mask construction and blending. A single
  run is a cost observation, not a speedup claim; ±10% timing noise screen.
- Corpus: clipped flame `IMG_0790.CR2`, sunset `IMG_3129.CR2`, bright-sky rock
  `IMG_0114.CR2`, and native 42 MP `2025_0730_1331_3.arw`, exclusively from
  `<photosRoot>/HDR Test Images`. Deterministic synthetic sky, lamp, specular
  texture and signed-shadow scenes provide limited clean-AHD truth. No
  dataset image, photo, weight or full-size derivative enters Git.

Reproduce with the isolated command in
`codebase/tools/denoise_eval/README.md`. Retained evidence and review:
`codebase/output/denoise-v1/ai-highlights/`. Findings and measured limits will
replace this investigation status after the guarded runs finish.
