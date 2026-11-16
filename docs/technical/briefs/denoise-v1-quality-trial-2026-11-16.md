# Brief: a much better Denoise for v1 (quality trial)

- **Owner:** Steve. **Coordinator:** Claude (this branch). **Workers:** Codex.
- **Started:** November 16, 2026. **Branch:** `feat/denoise-v1` (from
  `feat/watermark-and-library-polish`). Keep all work on this branch; another
  coordinator is working on Grade performance, Film Look and export in the
  main checkout, so do not touch those areas.
- **Status:** Phase 3, waiting on Steve's decisions D1 and D2 (section 7).

## 1. Goal (Steve, November 16, 2026)

> "I'd like to try and squeeze AI denoising into v1 if it works out. But I
> don't care if it's AI or not, I only care about the results. I want the
> sensor noise patterns to be removed without negatively affecting structure
> and sharpness."

**Steve's decision, November 16, 2026:** a better Denoise, AI or not, may be
tried for v1. The master PRD's exclusion covers AI selection and generation;
this trial is noise removal (restoration). Nothing ships unless it clearly
beats the current Denoise (`adaptive-atrous-v1`, see
[denoising.md](../denoising.md)) on the contract below and Steve approves it.

What "better" means:

- removes luminance and colour noise, including RAW-specific patterns:
  per-channel (Bayer) noise, shadow read noise, banding/pattern noise where
  present, and the cloudy colour blotches of high-ISO shadows;
- keeps real texture, edges and fine detail;
- no smearing or waxy skin, no halos, no colour bleeding across edges, no
  invented detail (worms, false texture, hallucinated patterns), no tile
  seams, no hue or brightness drift;
- stays an HDR tool: scene-linear, values above reference white and
  negative finite values kept, the highlight compression ceiling untouched.

AI, classical (BM3D/NL-means/wavelet/variance-stabilised, darktable- or
RawTherapee-style profiled, GPL code is allowed because the app is GPL-3) or
a hybrid are all acceptable. Choose by measured quality, speed and fit.

## 2. Hard constraints

- **Offline, bundled.** No downloads at run time, no cloud. Code *and model
  weights* must permit redistribution in a GPL-3 desktop app that may be
  sold. Research-only, non-commercial or unclear weight terms are excluded.
  Record the exact licence text location and file hash of every weight file.
- **Minimum machine:** MacBook Neo (A18 Pro, 8 GB unified memory). Every
  feature must work there. App memory default 4 GB: whole-app peak ≤ 4.4 GB,
  settled < 3.4 GB ([memory-and-caches](../../product/modules/memory-and-caches.md)).
  Windows 11 x64 with a WebGPU GPU; Linux x86_64 with WebGPU.
- **Runtimes** must work on all three platforms, with the CPU as fallback:
  the app's own WebGPU renderer, ONNX Runtime (CPU, CoreML, DirectML), or
  plain CPU code. One GPU try, then CPU (AGENTS.md, November 6 rule).
- **Sources:** 24–61 MP camera RAWs (Bayer; Fuji X-Trans develops on the CPU
  in v1), plus developed HDR files and renders that have no mosaic.
- **Speed is the whole wait** (AGENTS.md). Sliders stay live; preparation
  may be explicit and cached, like today's Denoise analysis.
- **Testing and disk** follow AGENTS.md: GPU/Electron jobs one at a time
  through `tools/gpu-run-lock.py`; heavy CPU/ML runs never overlap; check
  `tools/output_size.py` at start and end; scratch under
  `codebase/output/denoise-v1/` and deleted when no longer pointed to.

## 3. Quality contract (proposed tolerances, Phase 1)

Measured on the same inputs for every candidate, including the current
Denoise at its defaults and an untouched "off" baseline. All numbers are
proposals with a one-line reason; Steve's eye on the review crops is the
final judge.

### 3.1 Inputs

1. **Synthetic noise with known truth.** Clean scenes from low-ISO corpus
   RAWs, binned 2×2 in the raw domain (cuts noise by half) and then
   re-mosaiced, plus generated targets (slanted edges, Siemens star, fine
   text, colour patches, gradients, star field). Add calibrated
   Poisson–Gaussian sensor noise per Bayer channel at about ISO 1600, 6400
   and 25600 equivalents, with an optional row/column banding term. Noise
   parameters come from fitting the real high-ISO corpus RAWs, not guessed.
2. **Real noisy RAWs, no truth.** High-ISO and shadow-lifted cases from
   `<photosRoot>/HDR Test Images` (currently only `IMG_0790.CR2` is labelled
   noisy; see open question Q1), each developed with an exposure lift that
   shows the shadows, as a user would grade it.
3. **Optional real pairs** (noisy and clean shots of the same scene from a
   public dataset with a licence that allows this research use), only if
   Steve approves (Q2). Kept under `codebase/output/denoise-v1/`, never in Git.

### 3.2 Measurements and proposed limits

| What | Measure | Proposed pass | Reason |
| --- | --- | --- | --- |
| Overall fidelity (synthetic) | PSNR and SSIM against the clean scene, on display-encoded SDR and on PQ-encoded HDR | better than current Denoise at every ISO level, by ≥ 1 dB PSNR at ISO 6400 and 25600 | "much better" must be visible; 1 dB is roughly the smallest gain people notice on noisy images |
| Colour fidelity (synthetic) | ΔE 2000 (SDR) / ΔICtCp (HDR) against clean, mean and p99 | mean and p99 no worse than current Denoise | colour must not get worse while noise improves |
| Noise left in flat areas (real and synthetic) | standard deviation of luma and chroma in flat patches, after display encoding | luma ≤ 50% and chroma ≤ 30% of the noisy input at default strength | the target is clearly cleaner flats; chroma is usually easy to remove |
| Detail kept (synthetic) | texture energy in textured regions per frequency band, relative to the clean scene | 0.85–1.15 of clean in every band | below 0.85 is smearing; above 1.15 is noise left or invented detail |
| Sharpness (synthetic slanted edge) | MTF50 relative to clean | ≥ 0.90 of clean | a 10% loss is about the limit before edges look soft at 100% |
| Halos | edge overshoot/undershoot relative to clean | ≤ clean + 2% of edge height | visible halos start around a few percent |
| Colour bleed | chroma error within 3 px of strong coloured edges | ≤ current Denoise | aggressive chroma smoothing bleeds colour across edges |
| Structure removed (real) | "method noise" (input minus output) correlated with local edges | lower than current Denoise | removed content should look like noise, not outlines |
| Invented detail | high-band energy in the output that is not in the clean scene (synthetic); visual check of stars, text, fabric, foliage, skin, hair | none visible; synthetic band ratio ≤ 1.15 | no hallucination is acceptable |
| Tile seams | shifted tile grid against unshifted, finished pixels | ΔE mean < 1, p99 < 3 | the existing perceptual contract |
| CPU against GPU | finished pixels | ΔE 2000 / ΔICtCp mean < 1, p99 < 3 | the existing Denoise preview/export contract |
| HDR safety | finite output, negatives and above-white values kept, highlight ceiling exact, bypass and alpha exact | exact | existing hard contracts |
| Exposure range | same scene scaled −6 to +6 stops, result scaled back | ΔE mean < 1, p99 < 3 against the unscaled result | an HDR denoiser must not depend on brightness level |

### 3.3 Speed, memory, size (MacBook Neo first; PC numbers separate)

Proposed, to be confirmed by Steve (Q3):

- **Preview:** Denoise sliders stay live (next frame) once prepared.
- **Preparation of a 24 MP RAW** (action to clean picture on screen):
  ≤ 15 s on the Mac GPU, ≤ 45 s CPU fallback. 61 MP proportionally
  (≤ 40 s GPU). Reason: comparable to today's preparation plus a RAW
  re-development, and run once per photo.
- **Export:** added time per 24 MP photo ≤ 15 s on the Mac GPU when the
  prepared result is not reused.
- **Memory:** whole app within 4.4 GB peak, < 3.4 GB settled, existing VRAM
  admission unchanged.
- **Install size:** ≤ 150 MB added per platform installer (runtime plus
  model).

## 4. Pipeline placement (to be decided by measurement)

Today Denoise runs on the developed scene-linear ACEScg picture, after
geometry and before Exposure ([denoising.md](../denoising.md), section 3).
RAW development has a CPU path (`raw_import.py`, LibRaw AHD) and a GPU path
(`frontend/library-gpu-raw.js`). Options:

- **A. Raw domain, before demosaic** (Bayer, camera RGB, per-channel noise
  model known exactly). Best fit for sensor noise and patterns; must be added
  to both RAW paths; no help for non-RAW sources; X-Trans excluded.
- **B. Linear RGB after demosaic** (where Denoise is now). Works for every
  source; noise is already correlated by demosaicing.
- **C. Hybrid:** A for Bayer RAWs, B for everything else, current controls on
  top.

The existing controls (Amount, Detail Recovery, Luminance, Color Noise,
four sizes, Show noise, Recalculate) must keep working or be replaced by a
simpler set that Steve approves.

## 5. Candidates (Phase 1 survey fills this in)

Starting list, from the November 13 research
([b1-ai-denoise.md](../research/next-version-2026-11-13/b1-ai-denoise.md)) and
the [technology watch](../denoising-technology-watch-2026.md):

- **AI:** RawNIND UtNet2 linear and Bayer (GPL-3 / CC-BY-4.0 weights,
  ONNX exists); other raw-domain networks with permissive weights;
  NAFNet-family only with a verified weight licence.
- **Classical:** BM3D/BM4D-style with a variance-stabilising transform (check
  patent and package licences), NL-means, profiled wavelet (darktable
  denoise-profiled, GPL), raw-domain variance-stabilised wavelet.
- **Baselines:** off; current Denoise v2 at defaults and at its best tuned
  settings per image.

## 6. Phases

1. **Contract and harness** (this brief, section 3): an offline Python
   harness in `codebase/tools/denoise_eval/` that builds the inputs, runs
   candidate adapters and baselines, computes every measure and writes a
   small review page. **Candidate survey** in
   `docs/technical/research/denoise-v1-2026-11-16/`. In parallel.
2. **Prototypes:** the best 2–4 candidates as harness adapters (no app
   integration), run one at a time. Measure quality on crops and full
   images, and the full-resolution time and memory on the Mac.
3. **Steve's decision:** one short plain-language comparison with review
   crops and a recommendation (what, where in the pipeline, controls,
   preview/export behaviour, speed, memory, install size, licences, risks).
4. **Implementation** of what Steve approves, with the AGENTS.md testing
   tiers, a module PRD update and this brief archived.

## 7. Open questions for Steve (collected; asked together)

- **Q1.** The corpus has one known noisy RAW (`IMG_0790.CR2`). Could you add
  4–6 high-ISO RAWs (different cameras, ISO 3200–25600, deep shadows), plus
  one lens-cap dark frame at high ISO? Without them the real-photo results
  rest on very few pictures.
- **Q2. Answered (Steve, November 16, 2026):** yes, a public noisy/clean
  dataset may be used if it is open and appropriately licensed (CC0, CC-BY or
  CC-BY-SA; non-commercial or research-only terms are excluded). Research
  use only: downloaded under `codebase/output/denoise-v1/datasets/`, never
  committed or shipped, and not part of the approved test-photo corpus. If no
  suitable set exists, Steve will supply or shoot noisy photos.
- **Q3.** Are the speed, memory and size targets in 3.3 acceptable?
- **Q4.** (Still open from before.) A noise-free linear EXR render
  ≥ 540×540 for the existing Denoise render check.

**Phase 3 decisions put to Steve (November 16, 2026)**, with the review page
https://claude.ai/artifact/4ZcqC4Ht2fJ67Nu6F2S4t9 (1:1 crops, blind mode):

- **D1.** Retune the default to Amount 0.75, Color Noise 0.75, Detail Recovery
  0.5 (shipping 0.5/0.5/0.0). Held-out real pairs 34.83 dB / ΔE 3.04 against
  34.42 / 3.39 as shipped; same edge sharpness. Recommended: yes.
- **D2.** Build the RawNIND-Bayer-guided Wiener stage (pilot-wiener
  `bayer_both`) for Bayer camera RAWs, as a Denoise switch on by default;
  other sources keep current Denoise. Held-out pairs 35.52 dB / ΔE 2.83; best
  in lifted shadows; erases tiny detail at ISO 25600. Recommended: yes, with
  Steve's own by-eye trial before release; otherwise ship D1 only.
- **Proposed tolerance change for Steve:** the 0.90 MTF50 limit applies at
  ISO 6400 and below; no method (including shipping Denoise, 0.63) reaches it
  at ISO 25600.
- **Found:** shipping Denoise leaves dark specks with light rims in strongly
  lifted high-ISO shadows (`IMG_0790.CR2`, +4 stops); fix regardless of D2.
- Correction: research `AdaptiveControls` default Detail Recovery 0.5, but the
  app ships 0.0; Phase 2 "current default" columns used 0.5. The decision page
  and D1/D2 numbers use the shipping default.

## 8. Log

- 2026-11-16: pilot-guided empirical Wiener CPU adapters implemented, with
  self/tuned/verified Bayer pilots, both-Wiener/direct-pilot-chroma variants,
  cached control sweeps, full/half-resolution scoring and bounded 18/42 MP
  runs. Tuned-both gains 2.04/1.87/1.35 dB over current defaults at ISO
  1600/6400/25600 but only .34/.36/.12 dB over tuned current; high-ISO
  MTF50 remains .693 of clean. No complete quality-contract pass or app change.
  Public-pairs merge `56cff0de` incorporated with all-four-pixels-valid
  half-scale masks; all 11 adapters complete 52 crops with no errors.
  Bayer-both leads four held-out scenes by 1.91 dB SDR over default / .69 dB
  over tuned; seven training-seen scenes stay separate. Six native runs peak
  at 1.871 GB; tuned-both / Bayer-both take 22.36/22.27 s at 18 MP and
  54.60/57.27 s at 42 MP, not UI timings. Still no complete quality pass.
  See [pilot-wiener.md](../research/denoise-v1-2026-11-16/pilot-wiener.md).

- 2026-11-16: brief written; PRD records Steve's decision; Phase 1 workers
  started (harness, candidate survey).

- 2026-11-16: Phase 1 CPU harness committed (`da0d5ace`), quick/full
  off/current-Denoise baselines completed; report in
  `../research/denoise-v1-2026-11-16/harness-baseline.md`. Single-frame sensor
  profiles remain provisional; no app integration or replacement approved.

- 2026-11-16: Phase 2 RawNIND linear/Bayer CPU adapters (`7bce787f`), strengths .5/.75/1,
  full quality set, clean-mosaic separation and guarded 18/42 MP native trials
  completed; [report](../research/denoise-v1-2026-11-16/rawnind-prototype.md).
  Neither meets the proposed quality/HDR limits. Real Bayer quality crops use
  explicit AHD range fallback; native Bayer timing is unclipped experimental
  extrapolation. Current Denoise and app requirements remain unchanged.
- 2026-11-16: Phase 2 classical adapters trialled: 81-setting current-method
  sweep, three strengths of profiled wavelets and calibrated/blind GALOSH,
  full CPU quality set and four native-frame Mac runs. Findings and remaining
  qualification gaps: [classical-prototypes.md](../research/denoise-v1-2026-11-16/classical-prototypes.md).
  No defaults, output limits or shipping pipeline changed; NLM not ported.
  Node checks pass and all ten new Python tests pass; the broad Python suite
  stopped at the unchanged research watchdog (2.524 GB), so remains incomplete.
- 2026-11-16: Steve answered Q2 (open-licensed public pairs allowed for research);
  dataset worker started.
- 2026-11-16: Bayer verification found a sensor-mean/camera-RGB gain mismatch
  and replaced the real-crop range fallback with the requested upstream [0,1]
  sensor convention. Corrected full-strength gains at ISO 6400/25600 are
  +1.34/+4.13 dB SDR; ISO 1600 and detail/halo/colour limits still fail.
  Pinned upstream reproduction also changes clean fabric/text substantially.
  See “Verification, November 16” in the existing RawNIND prototype report;
  previous Bayer numbers/timing qualification are superseded, not deleted.
- 2026-11-16: public-pair licence survey selected 12 explicitly CC0 RawNIND
  scenes (five documented held-out, seven seen by RawNIND), 43 hash-verified
  RAWs / 1.170 GB. Registration/clipping policy is fixed before baseline
  measurement; [public-pairs.md](../research/denoise-v1-2026-11-16/public-pairs.md)
  records evidence, exclusions and the resulting current-method baselines.
- 2026-11-16: public-pair tooling committed as `20f2224a`: 52 scored crops,
  11 scenes / four cameras / ISO 1600–6400; four held-out scenes (19 crops).
  Higher-ISO candidates fail input screens, not denoiser tests. Off/default/
  tuned-PSNR/tuned-sharp baseline has zero adapter errors; darktable's single
  96px interface smoke passes, RawNIND/GALOSH assets are absent here. Node
  1091 passed, Python 3928 passed (149 skipped, one xpassed), focused 20 passed.
  No shipping change, GPU run, limit relaxation or push.
- 2026-11-16: decision crops, shipping-default comparison and review page;
  D1/D2 put to Steve.
