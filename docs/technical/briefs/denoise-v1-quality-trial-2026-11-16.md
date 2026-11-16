# Brief: a much better Denoise for v1 (quality trial)

- **Owner:** Steve. **Coordinator:** Claude (this branch). **Workers:** Codex.
- **Started:** November 16, 2026. **Branch:** `feat/denoise-v1` (from
  `feat/watermark-and-library-polish`). Keep all work on this branch; another
  coordinator is working on Grade performance, Film Look and export in the
  main checkout, so do not touch those areas.
- **Status:** Phase 1 (contract, harness, candidate survey).

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
- **Q2.** May the research use a public set of noisy/clean RAW pairs
  (downloaded only to the output folder, never shipped or committed)? It
  gives real ground truth instead of simulated noise.
- **Q3.** Are the speed, memory and size targets in 3.3 acceptable?
- **Q4.** (Still open from before.) A noise-free linear EXR render
  ≥ 540×540 for the existing Denoise render check.

## 8. Log

- 2026-11-16: brief written; PRD records Steve's decision; Phase 1 workers
  started (harness, candidate survey).

- 2026-11-16: Phase 1 CPU harness committed (`da0d5ace`), quick/full
  off/current-Denoise baselines completed; report in
  `../research/denoise-v1-2026-11-16/harness-baseline.md`. Single-frame sensor
  profiles remain provisional; no app integration or replacement approved.
