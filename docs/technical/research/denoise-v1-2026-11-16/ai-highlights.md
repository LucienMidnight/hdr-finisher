# AI Denoise with highlight reconstruction

November 17, 2026. Research only. No editor, product requirement, saved photo,
shipping dependency, shader, budget or delivery guard is changed.

## Steve's summary

**Recommend AI after v1, not AI with reconstruction disabled.** There is a
working, isolated combination adapter, but no combination in this experiment
earns shipping approval for both Opposed color and Edge colour.

- A protected region blend genuinely keeps the selected reconstructed
  highlights. Outside its protection, it retains the complete AI result.
  However, the flame has an obvious change in grain/smoothness, and the
  measured joins fail the provisional colour/texture screen. A wider feather
  helps some pictures but is not a general cure.
- With Edge on the flame, the conservative protection reaches essentially
  the whole picture: it looks right because it is the normal reconstruction,
  **not because AI and reconstruction have been successfully combined**.
- AI first, followed by RGB Edge, changes the flame substantially and omits
  the sensor Opposed repair. It is not a replacement for today's Edge recipe.
- Scaling repaired sensor values into the network's range is worth further
  research: it is much closer than AI without repair in three synthetic
  scenes. It still changes highlight colour, fails the provisional mean
  screen at normal exposure, and is not qualified on real RAWs or with Edge.
- The 18 MP CPU combination adds about **3.0–3.5 seconds for Opposed** or
  **6.1–6.7 seconds for Edge**, on top of **6.9–8.7 seconds of AI** and the
  original signed AHD anchor. At 42 MP, Opposed completes; the subsequent
  Edge stage exceeds the unchanged research memory guard.

Steve's November 17 revisions in `ai-experimental-design.md` override its
older reconstruction-off restriction. Continue classical Denoise first.
This is negative/qualified evidence, not proof that a sound future combination
is impossible. No editor integration, changed product requirement or new
memory allowance is proposed here.

## Look at these crops

Open the local decision page:
`codebase/output/denoise-v1/ai-highlights/review/index.html`.
It needs no server, account, network or model download to view. Each image is
a 384×384 native-pixel crop, shown at 1:1; scroll each comparison sideways.
All photographic views use the existing fixed −0.8 EV RAW calibration.
The second row of a pair is another −3 EV, **not** automatic exposure matching.
Sensor orientation is deliberate; these are not lens-corrected app screenshots.

1. **IMG_0790, Opposed, seam, 0 and −3 EV:** flame core stays reconstructed;
   compare the normal grain against the cleaned dark/orange surroundings.
   The blend's change in texture is more evident than a single hard outline.
2. **IMG_0790, Edge 1%, highlight/seam:** the all-white protection mask and
   identical normal/blend images expose the loss of AI benefit. The last
   RGB-Edge-only column has a different flame colour/brightness, especially
   when pulled down. The two 512px metric selections differ slightly because
   of sampling-grid rounding; neither has a measured blend boundary.
3. **IMG_3129, sunset/sun/reflections:** the worst-join crop is warm glare
   on the ferry wall, not the sun. The separate surveyed highlight selection
   covers the disk and adjacent sky. The 128px Edge variant has
   better numerical joins but leaves only 36.3% of the frame completely AI.
4. **2025_0730_1331_3, neon/lamps:** native 42 MP Opposed evidence is retained
   despite the later guard stop. Edge is unmeasured, not a pass.
5. **IMG_0114, rock/sky:** a near-unclipped control, not strong evidence for
   broad clipped sky. Its boundary can still expose AI/AHD differences.
6. **Synthetic smooth sky and lamp:** the grain-level transition is easier
   to separate from natural texture. **Specular texture** tests a patterned
   highlight; its headroom column is smoother/different, not recovered truth.

The JSON records the top-left of each 512px measurement crop. Displayed crops
start another 64 pixels down/right within it. Both feathers and all supported
Expand probes are measured; the compact primary gallery displays 32px,
Opposed and Edge 1%, plus headroom probes. Steve's visual acceptance remains
necessary; these crops do not constitute his sign-off.

## Measured outcome

All numerical results below are from the **MacBook Neo, A18 Pro, 8 GB**, on
November 17, 2026, serialized with the shared machine lock. Model and runtime
are the pinned Bayer weights and ONNX Runtime 1.32.0, CPUExecutionProvider.
Survey/native JSON together include source SHA-256, native dimensions, CFA,
original anchor, selected reconstruction diagnostics and code hashes. Initial
real runs used measurement head `5f902bb3`; the ferry's corrected highlight
gallery follow-up uses `f16645d0`. Subsequent changes repair gallery assembly/
filtering and displayed selections/tests, not measured pixel maths. The
retained sun selection uses the survey's largest clipped component, around
sensor row 1618, column 3310. A discarded manual-coordinate selection landed
on the lifeboat rather than the sun; it is not retained as sun evidence.
No exposure or colour adjustment is fitted to those pixels.

### Region blend: repair survives, but the join is not qualified

The protected core equals normal reconstruction exactly, including colour
and brightness. Every fully AI pixel equals the standalone AI image exactly.
These checks cover **every native pixel**, not just crops. Clipped-highlight
crop differences from normal are zero for this blend; that says nothing
about reconstruction's absolute truth, which is unavailable for these RAWs.

At the primary 32px seam, the **AI-side eight-pixel boundary band** differs
from normal by the following SDR ΔE2000 (mean / p99). These are intentionally
adverse selections on each image, not a random sample or whole-photo score.

| Photo / reconstruction | 0 EV | −3 EV | Completely AI frame area |
| --- | --- | --- | --- |
| Flame / Opposed | 3.81 / 14.98 | 1.07 / 3.45 | 92.9% |
| Sunset / Opposed | 1.93 / 8.92 | 0.98 / 4.96 | 97.3% |
| Rock/sky control / Opposed | 2.86 / 17.91 | 1.72 / 10.81 | 99.8% |
| 42 MP lamps / Opposed | 6.01 / 30.93 | 1.70 / 13.38 | 98.4% |
| Flame / Edge 1% | no boundary | no boundary | 0% |
| Sunset / Edge 1% | 1.24 / 4.31 | 0.36 / 2.10 | 63.8% |
| Rock/sky control / Edge 1% | 2.67 / 12.94 | 1.09 / 6.20 | 79.7% |

The screen is mean <1 and p99 <3. A denoiser intentionally changes noisy
pixels, so these differences are **not by themselves proof of a halo**.
The independent adjacent-jump measure also changes: flame Opposed has
0-EV excess-jump mean 1.94 / p99 10.27; lamps 3.23 / 13.94. That comparison
subtracts the same normal picture's natural edge jump, but still includes
the intended change in noise. It is a screening tool, not a seam detector
with known false-positive rate.

The separately retained **sun and adjacent sky** crop (not the worst wall
join) has Opposed outside-band mean / p99 **0.86 / 5.81 at 0 EV** and
**0.49 / 3.29 at −3 EV**. Its clipped core stays exact; the high-percentile
boundary screen still misses. This extra crop does not rescue the overall
combination or turn the nearly unclipped rock/sky control into clipped-sky truth.

The flame's inside/outside highpass step is **2.14× at 0 EV / 1.95× at −3 EV**,
against the provisional 0.8–1.25 warning range. It reflects a cleaned/uncleaned
texture change visible in the crops. Synthetic sky and lamp show 2.45× and
2.39× at 0 EV even though the sky's colour band nearly passes. A smooth blend
weight does not guarantee equal noise or texture on both sides.

Widening to 128px reduces many colour differences but is not a universal
solution: flame Opposed still has band 2.85 / 10.59 at 0 EV; lamps 3.08 / 10.36.
Sunset Edge 1% improves to 0.46 / 1.54 at 0 EV and 0.27 / 0.89 at −3 EV, with
highpass ratio about 1.09. It is a **promising individual result**, not a
combined Opposed/Edge contract for all photos. The flame Edge protection
still covers 100%, with either feather. Expand 0%, 1% and the app's maximum
3% were exercised; no app setting or protection threshold was loosened.

The flame's Edge changes about 58.3% of pixels above the predeclared 1e-6
linear support threshold. Scattered changed pixels plus eight-pixel
demosaic protection cover the entire frame. This is an over-conservative
**influence-mask design**, not evidence that Edge needs every pixel left
noisy. Reconstructing signed out-of-gamut pixels and full-frame colour
round-trips can also contribute numerical support. An explicit algorithmic
influence mask, separated from numerical/negative-transport changes, is a
better next experiment than quietly raising this threshold until it passes.

### Denoising retained away from highlights

The exact fully-AI endpoint preserves whatever benefit **and defects** the
standalone model has. It is not a new quality endorsement of RawNIND.
On deterministic synthetic scenes, outside the sensor-only 32px protection,
display-domain residual MSE against clean AHD drops by approximately **97.3%
for sky, 99.4% for lamp, 27.6% for specular texture, 99.7% for signed shadows**.
The texture case is a reminder that strong smooth-area cleanup does not imply
fine-detail preservation. Clean AHD is a limited clipped/demosaiced comparator,
not unclipped radiometric highlight truth. These figures use original AI;
the region blend inherits them only where its full support-aware weight is
zero. Edge can protect additional pixels and forfeit that benefit, entirely
in the flame case. Real-photo highpass is only a texture/noise proxy.

### AI first / RGB Edge and repaired-sensor headroom

Full-frame AI-first RGB Edge uses the original sensor clip map, not a
clip map inferred from denoised pixels. On the flame's primary selection,
its difference from normal Edge is SDR **12.21 / 27.58 at 0 EV** and
**5.48 / 10.71 at −3 EV**. The missing sensor Opposed contribution is not
recovered by reusing Edge's name. No RGB Opposed equivalence is demonstrated.

Ordinary re-clipping is destructive: synthetic sky/lamp/specular Opposed
diagnostics report 27,713 / 2,856 / 2,865 reconstructed photosites, but only
233 / 17 / 24 sensor values differ from original after both inputs are
clipped back to [0,1]. Headroom scaling instead needs factors about
**1.60 / 1.58 / 1.60**, keeping repaired values in range without erasing them.
Its highlight ΔE2000 mean / p99 against normal Opposed is:

| Synthetic scene | Headroom AI, 0 EV | Headroom AI, −3 EV |
| --- | --- | --- |
| Smooth sky | 1.95 / 2.68 | 0.94 / 1.59 |
| Lamp | 1.56 / 2.28 | 0.77 / 1.58 |
| Specular texture | 1.18 / 2.68 | 0.80 / 2.08 |

AI without repair has mean highlight errors around 16.5–17.3 at 0 EV in
these scenes. Scaling is therefore worth retaining as a research lead,
**not** claiming impossible, unsupported or successful solely because its
tensor is in range. All three scaled cases miss the mean <1 screen at normal
exposure. The model's nonlinear response/noise distribution changes, and
keeping the scaled original-AHD mean anchor is itself a choice needing
qualification. No full real-frame, Edge, camera-variety, detail, GPU or
shipping safety qualification is claimed for this alternative.

### Gain anchor and signed shadows

The adapter always takes the unrepaired, signed, unity-WB camera-RGB mean
before reconstruction; it never recomputes gain per region or tile. Using
the repaired mean instead would change the flame's gain by **+13.04%** and
the Sony lamps' by **+8.28%**. That is not an acceptable hidden exposure
change caused by selecting reconstruction.

This prevents repair from contaminating the anchor, but does **not** prove
that saturated parts cannot influence the original whole-frame gain.
A diagnostic matching only safely unclipped samples would change the flame
gain by −20.42%, versus −0.14% for sunset and +0.026% for the rock/sky control.
The differences mix model response, signed-shadow handling and highlight
distribution; this experiment cannot attribute them to clipping alone.
Do not silently swap to a masked anchor. It would change output and needs
an independently qualified common gain contract.

The flame has **20.60% below-black sensor samples**; [0,1] input clipping
alone raises its normalized mosaic mean by 0.000555. In signed synthetic
shadows, 42.21% of samples are below black and clipping raises the mosaic
mean by 0.000455. The signed original-AHD anchor makes the synthetic neural
frame's overall mean close to clean (0.000346 vs 0.000348), but selected
shadow differences and the lost signed sensor distribution remain. On the
flame, the sampled neural-minus-signed-AHD shadow mean is +0.003316 ACEScg
channel units. It is not a measured error against clean truth or a claim
that negatives in developed camera/ACEScg data are all gone.

### Native CPU cost and minimum-Mac memory

Single runs, one CPU/native thread, cold ONNX session included, no deliberate
cache flush or claimed speedup. Timings include the research disk-backed
working strategy; they are **not action-to-screen app latency**. All rows are
MacBook Neo / A18 Pro / 8 GB, never compared with PC baselines.

| Native source / selected route | Original signed AHD + anchor | AI step | Additional combination work |
| --- | --- | --- | --- |
| 18.02 MP flame / Opposed, 32px | 1.36 s | 8.27 s | 3.43 s |
| 18.02 MP flame / Edge 1%, 32px | same anchor | same AI | 6.61 s |
| Other 18 MP Canons / Opposed, 32px | 1.26–1.68 s | 6.86–8.73 s | 2.96–3.49 s |
| Other 18 MP Canons / Edge 1%, 32px | same anchors | same AI | 6.13–6.68 s |
| 42.39 MP Sony / Opposed, 32px | 3.27 s | 20.79 s | 11.16 s |
| 42.39 MP Sony / Edge | anchor/AI completed | completed | guard stopped; no completed cost |

The flame's 3.43 s comprises sensor repair 0.41 s, second signed AHD/colour
tail 1.23 s, support 0.28 s, mask 0.25 s and blend/endpoint reduction 1.25 s.
Edge adds its real reconstruction; its measured 6.61 s includes 3.14 s of
Edge. Normal-map disk copies, unmapping/allocator relief and some bookkeeping
are outside these summed component timings. The AI-first comparison, crop
scoring and full safety sweep are excluded, because they are not needed for
the proposed selected route. Native frame wall times around 66–68 s include
all research variants/metrics, not one user operation.

Sony Opposed's 32px blend/readback/reduction costs 4.99 s, versus 2.92 s for
the later 128px pass with otherwise the same dimensions; this single pair is
not within the predeclared ±10% timing-noise screen. It likely includes
memory/paging pressure but that was not isolated. **Treat 8.97–11.16 s as
uncertain observations, not a repeatable timing or a feather speed effect.**
The supplemental ferry crop runs also have faster AI steps (6.86–7.17 s
versus 8.68 s originally), outside that screen; machine/cache/thermal effects were
not isolated. The reported ranges include those observations, not a speedup.
Do not spend a broad rerun on this number; Steve should try a real integration
before optimization or a latency promise.

The completed Canon runs sample **2.25–2.39 GB process-tree RSS**. Sony
finishes both Opposed feathers and their retained evidence, then the next
Edge stage trips the unchanged 2.5 GB guard at **2.570 GB**; it is stopped
and scratch is removed. This is a research-process measurement, not a proven
production Edge regression or the complete app's footprint. The 42 MP
combined Edge cost/quality is therefore explicitly **unqualified**. No memory
budget is raised. All experiment compute, including failed probes, remains
well below the user's 90-minute fallback threshold; lock waits are separate.

### Exact ceiling and ±6 EV safety

Every native pixel of the primary 32px Opposed and Edge-1% Canon blends, and
the completed Sony Opposed blend, is finite after the existing CPU final
limiter at −6/0/+6 EV. The largest finished channel is **exactly 1000 nits,
never above it**, with no pre-encoding allowance. Synthetic frames have the
same check; sampled crop shoulder checks also cover −3/+3 EV through the
existing highlight-compression stage. Power-of-two exposure reversal is exact.

This proves the tested CPU combination does not evade the downstream cap;
the limiter is supposed to enforce it. It does **not** qualify exposure
invariance of the nonlinear network, six-stop sensor re-exposure, finished
creative grades, encoded output, GPU delivery or Proof/export agreement.
AI runs once on original sensor data; ±6 EV is applied afterwards. No
automatic second denoiser or second GPU attempt is introduced.

## Verification and retained evidence

- Results-based focused tests cover model/clip-map phases, original sensor
  and anchor, production reconstruction, signed/headroom blend endpoints,
  both boundary directions, valid Expand settings, memmap preservation and
  completed-versus-guarded review records. Final counts are recorded below.
- `real-IMG_0790.json`, `real-IMG_3129.json`, `real-IMG_0114.json` and
  `partial-2025_0730_1331_3.json` retain native results. `synthetic-*.json`
  retains deterministic scene outcomes. Guard receipts retain sampled peak
  memory and aborts; no missing/empty measurement is labelled a pass.
  Sony's overwritten partial-provenance field is recovered from the same
  serialized native batch's flame record and explicitly labelled as such;
  its RAW SHA-256 is independently re-read. Future checkpoints retain that
  field. `evidence-audit.json` confirms all eight records' endpoints/crop
  safety and all 45 completed full-frame exposure/cap checks.
- An early 18 MP run exceeded the guard because research mappings were
  retained; completed mappings are now closed/reopened before subsequent
  stages. A later probe requested invalid Expand 5%; it was corrected to
  the existing 3% maximum. Gallery assembly initially included its guard
  receipt as a scene; filtering and a behavioural regression fix it. None
  of those corrections changes production output or relaxes a guard.
- No GPU driver directly covers this isolated CPU model combination.
  No broad GPU sweep, real-app Library run, release build or encoded-output
  qualification is substituted for that missing integration coverage.
- Local generated review crops and measurements stay under
  `codebase/output/denoise-v1/ai-highlights/`, not Git. Only research source,
  tests, reproduction instructions and this report/docs-map entry are committed.

Final validation: **Node 1,101 passed / one skipped / zero failures; Python
4,170 passed / 150 skipped / one xpassed / zero failures**. Python retains
the existing Starlette/httpx deprecation warning; its sampled process-tree
peak is 2.057 GB with no abort. The final focused adapter/gallery run is
**15 passed**, after the display-only sun-selection correction. `git diff
--check` passes. No new production GPU check claims coverage of this CPU tool.

The full local gallery contains **46 comparison rows / 127 distinct crop
images (15.10 MB)**. Including four survey thumbnails, HTML, compact inline
selector and the manifest, the review folder is **15.77 MB**. All linked
images exist. Thirty obsolete crop PNGs (3.53 MB), completed partial-record
duplicates and native scratch maps are removed; no RAW, weight or shared
fixture is deleted. The final output audit is **13.0 GB**, mostly the
existing shared **12.9 GB test-photo store**, below the 100 GB limit.
No push is requested or performed. Local commits carry the requested
co-author trailer. No production, module PRD, brief-log or performance-table
file is changed.

## Experiment contract, fixed before measurement

- AI is an explicit per-photo choice in Denoise, never initial development.
  Only RawNIND Bayer UtNet2 is tested. Current/classical Denoise must not run
  on top of the AI result; Strength blends with the normal reconstruction.
- Use original normalized sensor samples and the pinned model's [0,1]
  convention. The original, signed, unity-WB AHD camera-RGB mean is the one
  frame-global gain anchor. Do not substitute the repaired mean or per-tile
  normalization. Real sources are inferred at full native dimensions.
- Normal reference is actual production signed AHD, actual sensor Opposed
  repair and, when chosen, actual RGB Edge colour at Expand 0%, 1% and 3%.
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
`codebase/output/denoise-v1/ai-highlights/`. The measured outcomes above use
this contract; thresholds are not changed after seeing the results.

## What each proposed combination actually means

**Region blend:** normal means the real, selected reconstruction, not a
relabelled AI-only picture. The sensor repair is performed before signed AHD;
Edge follows camera-to-ACEScg as it does in the editor. A protected core keeps
that normal result and the transition blends to separately prepared AI from
the original sensor. The code explicitly selects the endpoint arrays when a
weight is zero or one, avoiding an arithmetic-rounding difference at endpoints.
Reconstruction support is measured in sensor coordinates before any lens warp
or rotation. A shipping implementation must transform both endpoints and their
weight through identical geometry; a sensor-coordinate mask cannot simply be
used over a corrected, rotated picture.

The claim that clipped areas contain no removable noise is too broad. One
clipped CFA channel can sit beside noisy, unsaturated channels; near-clipped
pixels are especially not noise-free. The blend intentionally gives up AI
inside its protection region. The question is whether a noisy/clean texture
change or an AI-vs-AHD colour/brightness difference becomes visible as the
weight changes—not merely whether the blend is mathematically smooth.

**AI first, RGB Edge afterwards:** the experiment applies the existing Edge
math to the full native AI image, with the original sensor clip map, at all
three Expand values. This is a real alternative test, but it omits sensor
Opposed repair and therefore is not today's complete Edge recipe. Edge carries
neighbour colour and smooths a brightness band; it does not establish that
the network retained the missing channel brightness that Opposed would repair.

**Opposed after AI is not a drop-in equivalent.** The current Opposed code
uses the observed CFA channel at each sensor site, three-by-three neighbourhood
channel counts, cube-root means of the opposing channels and a global residual
estimated from nearby unsaturated sensor observations. Learned RGB channels
are interpolated/denoised estimates, not those original independent samples.
Reusing the name for RGB algebra would be a new reconstruction algorithm and
needs a separate truth/colour evaluation. No unvalidated RGB Opposed is added.

**Repaired sensor plus headroom scaling:** the synthetic probe scales repaired
sensor values down until the model receives [0,1], then restores the scale,
using the correspondingly scaled original-AHD anchor. This is mathematically
different from passing values above one and clipping them back to one. It also
changes the signal/noise distribution presented to a nonlinear trained network;
being numerically within [0,1] does not prove model validity. The experiment
records both the amount of sensor repair erased by ordinary re-clipping and
the scaled model's highlight differences from normal Opposed reconstruction.

## Signed shadows and one-method-at-a-time operation

Normal reconstruction uses the new production signed native AHD helper,
including real per-phase black levels and the camera's actual AHD Lab matrix.
It does not use the older clipped temporary-DNG research development helper.
The neural branch still clips its original normalized sensor tensor to [0,1]
as the pinned Bayer model expects. The experiment retains and measures the
negative original samples before that boundary. A frame-global scalar gain
cannot restore their lost signed distribution or remove spatial/colour bias.
Negative ACEScg channels created by the camera matrix are a different matter:
they are not blanket-clipped by this combination adapter.

AI selection is a common RAW-source change, shared by HDR and SDR, not another
filter added after today's Denoise. A shipping version must bypass both current
or classical Denoise lanes while AI is selected, preserve their saved settings
for switching back, and rebuild from the original RAW when method, highlights,
Expand or source recipe changes. Strength zero/bypass means the selected normal
reconstruction, not reconstruction-off. None of these UI/cache/job behaviours
is implemented or qualified by this offline research.

## CPU/GPU shipping shape and gates

The CPU prototype can reuse the existing pinned CPU ONNX adapter. It must retain
the original unrepaired AHD anchor and normal reconstructed endpoint separately;
the repaired endpoint is not a valid substitute for that anchor. Disk-backed
arrays here are disposable measurement scratch, not approval of a permanent
cache or extra app memory. The full editor must account for its backend,
renderer, GPU resources and retained grade/source images within existing budgets.

The existing Bayer adapter explicitly rejects GPU providers. No GPU inference
or speedup is measured. A future qualified route would need local packaged
runtime/weights, the same CFA packing, original global reduction, normal
reconstruction and geometry, a small blend kernel, cancellation and CPU fallback.
Use existing AHD/Edge GPU routes where already supported, without relabelling
this CPU model as GPU-ready. There is no evidence here for a new GPU route's
required whole-wait gain, and no new GPU route is recommended from kernel cost
alone. A failed validity/compile/range test falls back once to CPU; no retry
loop or relaxed image/ceiling guard is proposed.

Before shipping: agree the combined source contract; qualify preview, Library,
Proof and export identity/reuse; test lens warps, all CFA phases, orientation,
camera metadata, full-frame signed shadows, cancellation and memory in the real
app; and run the applicable exact finished/encoded HDR delivery checks. A local
CPU limiter pass cannot stand in for GPU or encoded delivery qualification.
