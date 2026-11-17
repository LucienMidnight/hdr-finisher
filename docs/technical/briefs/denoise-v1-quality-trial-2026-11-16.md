# Brief: a much better Denoise for v1 (quality trial)

- **Owner:** Steve. **Coordinator:** Claude (this branch). **Workers:** Codex.
- **Started:** November 16, 2026. **Branch:** `feat/denoise-v1` (from
  `feat/watermark-and-library-polish`). Keep all work on this branch; another
  coordinator is working on Grade performance, Film Look and export in the
  main checkout, so do not touch those areas.
- **Status:** D1 built (November 17). D2 replaced by Steve's November 17
  decisions (section 7): classical "Denoise (Experimental)" first; AI Denoise
  (Experimental) deferred until it works together with highlight reconstruction.

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

- **D1. Approved by Steve; implemented November 17, 2026.** Retune the
  default to Amount 0.75, Color Noise 0.75, Detail Recovery 0.5
  (previously shipping 0.5/0.5/0.0). Held-out real pairs 34.83 dB / ΔE 3.04 against
  34.42 / 3.39 as shipped; same edge sharpness. Recommended: yes.
- **D2.** Build the RawNIND-Bayer-guided Wiener stage (pilot-wiener
  `bayer_both`) for Bayer camera RAWs, as a Denoise switch on by default;
  other sources keep current Denoise. Held-out pairs 35.52 dB / ΔE 2.83; best
  in lifted shadows; erases tiny detail at ISO 25600. Recommended: yes, with
  Steve's own by-eye trial before release; otherwise ship D1 only.
- **D2. Replaced by Steve, November 17, 2026** after the blind review: he
  preferred retuned current Denoise or RawNIND alone over the hybrid in almost
  all crops. Decisions:
  - Keep current Denoise (with D1) unchanged and add a separate classical
    **Denoise (Experimental)** method that finds and tones down leftover
    specks and colour blotches. This is the first priority; Steve focuses his
    testing here.
  - Add **AI Denoise (Experimental)** (RawNIND Bayer alone, labelled as still
    being refined) only when it is done properly:
    - Never on initial development, Library indexing or import. The user
      chooses it inside the Denoise module, which then re-develops the RAW
      (as Edge colour reconstruction's Expand already re-develops).
    - It must work together with highlight reconstruction from the start.
      Requiring reconstruction off was rejected: "I'd rather delay the AI
      denoise and sort that out than ship with this weird compromise."
    - If that is not solved in time, AI Denoise waits until after v1.
  - Design: [ai-experimental-design.md](../research/denoise-v1-2026-11-16/ai-experimental-design.md)
    (section 0 records these revisions; its D3 is superseded).
- **Proposed tolerance change for Steve:** the 0.90 MTF50 limit applies at
  ISO 6400 and below; no method (including shipping Denoise, 0.63) reaches it
  at ISO 25600.
- **Found:** shipping Denoise leaves dark specks with light rims in strongly
  lifted high-ISO shadows (`IMG_0790.CR2`, +4 stops); fix regardless of D2.
- Correction: research `AdaptiveControls` default Detail Recovery 0.5, but the
  app shipped 0.0 before D1; Phase 2 "current default" columns used 0.5. The decision page
  and D1/D2 numbers use the shipping default.

## 8. Log

- 2026-11-17: `observe` timeout investigation from `2db4de36`: reproduced
  the 130-second stop, then localized it to the final animation-frame wait.
  Safari was fullscreen on the active Mac desktop; the Library document
  stayed hidden after 20 frames while backend pictures completed. Native
  `isVisible()` alone missed this. Quick-check profiles, Library/source caches,
  backend ports and singleton locks are separate from Steve's still-running
  app; ordinary launches across worktrees do share the normal user profile.
  Added bounded renderer/native diagnostics retained on timeout and explicit
  hidden/occluded-frame failure, not fake drawing or a longer timeout.
  Focused Node checks: 20 pass; full Node: 1,107 pass / one skip. Full Python
  and final real-app checks follow; no production rendering or limits changed.

- 2026-11-17: focused follow-up from `c3b7a3ed`, same minimum Mac and locked
  1408x794 window. Corrected the earlier attribution: Lensfun CPU vignetting
  discarded negative channels; it was not the sampled lens-coordinate error.
  Preserve signs around its unchanged gain (`94cdece6`), with packed masks/bounded scratch
  and decoder/Library cache invalidation. All five RAW photos now pass; A7
  SDR/HDR P99.9 **4.1014/6.9366 -> 0.1881/0.7090**, limit still 3. Canonical
  photo paths/exact-cell waiting repair Single setup (`9464839e`); all 18
  comparisons run, **14 pass / four fail on both HEAD and pre-signed
  `7e444686`**. Zoom Full borrowing works on a quieter HEAD run; both builds
  then stall at straighten (1,291 processed / 7,968 required). Live Export's
  deterministic 5.332 GB charge against 4 GB predates signed RAW, introduced
  by the November 16 export gate. No accounting or output gate was relaxed.
  The plain-Electron Library smoke times out in `observe`; not a pass.
  Corrected details/crop/receipts: November 17 known-limitations follow-up and
  `codebase/output/denoise-v1-followup/`. Final fast suites: Node **1,103 pass /
  one skip**; Python **4,215 pass / 155 skips / one xpass**, existing warning
  only. About **26 minutes** slow validation; final output **13.3 GB**, below
  100 GB. Owned scratch/profiles removed; all three protected hashes unchanged.
  No push, release or installer.

- 2026-11-17: combined real-app validation from `949c8035`, minimum Mac
  (A18 Pro / 8 GB / 1408x794), shared GPU lock, serial runs. All 23 requested
  driver names matched the inventory: **16 pass, six known/tooling/fixture
  blocks, one new picture-agreement block**. Both 90-second Library checks
  pass after repair (grid 9/9 pictures; Single ten steps); extra DJI CPU/GPU
  DNG comparison plus 59 geometry probes passes. Fixed supported-Bayer checkbox
  metadata (`d0842dc2`), clipped-plateau GPU noise-bin boundaries (`3027c48f`,
  revision v4; all 12 generated-case comparisons pass), and missing-camera-XYZ
  mandatory DNG development (`7f49eb7d`, decoder v7). Test setup repairs are
  `c73b86c5` (stale reusable sidecar) and `f3befddd` (enable the authored cap
  for the brighter delivery fixture); expected outputs and limits stay fixed.
  **Waiting for Steve:** A7R00619 Library RAW colour tails are 4.1014 SDR /
  6.9366 HDR against <=3; v0.9.3 passes. Shared sampled lens coordinates
  agree, implicating the existing approximation against exact Grade mapping.
  No expected result was changed; retain the block for exact bounded mapping
  and picture review. Full measurement corpus needs its noise-free EXR;
  adaptive readback, zoomed reference memory, Single test-cell lookup, protected
  project source linkage and live Export GPU admission remain incomplete.
  Full details and per-driver verdicts: `docs/known-limitations.md`, November 17,
  and `codebase/output/denoise-v1-validation/summary.json`; crop
  `codebase/output/denoise-v1-validation/a7-lens-mismatch.png`. Final fast
  suites: **1,103 Node pass / one skip; 4,213 Python pass / 155 skips / one
  xpass**, existing warning only. One discarded Python run used scratch under
  hidden `.t3`, producing 12 path-listing fixture failures; the exact standard
  command passes in normal TEMP, with no code/test change for those failures.
  Slow checks took **about 26 minutes** including reruns/comparison/probes
  (23m17s individually recorded driver invocations). Output **12.9 -> 13.1 GB**;
  scratch/profiles/comparison checkout removed, three protected project hashes
  and all 38 existing working-copy sidecars unchanged. No push or installer.

- 2026-11-17: AI + highlight reconstruction research merged
  (`ai-highlights.md`): no combination qualifies for both Opposed color and
  Edge colour. Region blends keep repaired highlights but leave visible
  grain/colour transitions; with Edge on the flame the protection covers
  nearly the whole frame (no AI benefit); AI-then-RGB-Edge changes the flame
  and omits the Opposed repair; headroom scaling is promising but
  unqualified. Extra 3–3.5 s (Opposed) / 6.1–6.7 s (Edge) at 18 MP on top of
  AI; 42 MP Edge hit the memory guard. Recommendation, per Steve's rule of
  delaying rather than compromising: AI Denoise after v1.

- 2026-11-17: early outlier taming merged (`early-outlier-taming.md`;
  review https://claude.ai/artifact/Edqv4SaRSdtrNGYEbgkx89). Pre-demosaic soft
  clamp with neighbour support: flat-gallery specks 547 → 141 (2.5σ, up to
  5 samples) or 240 (4σ, one sample); AI 22. Harsh specks become soft dots.
  Costs: small stars (~2 px) dimmed/colour-shifted at 2.5σ (gentle setting
  much closer), thin lettering changes even on clean input, +2.2 s / +5 s at
  18 / 42 MP CPU, no general fidelity gain. Threshold below 2.5σ adds little;
  the less-luma/more-colour grain preset is not a default. Recommendation:
  optional, default-off control in Pixel cleanup. Put to Steve.

- 2026-11-17: Pixel cleanup "Remove hot pixels" merged (`9009cb9c`): off by
  default, CPU and GPU, saved per photo, collapsed section before Highlight
  Reconstruction; +0.32 s / +0.60 s CPU at 18 / 42 MP. Node 1,103 / Python
  4,125 pass. All three builds now await one combined GPU validation
  (proposed to Steve: about 25 targeted drivers, roughly 2 hours; the
  release plan's 119-driver selection is not needed for this branch step).

- 2026-11-17: Steve's further ideas, added to the early-outlier research:
  (1) the outlier threshold (×2/×3/×4 of local noise) as a user "uniformity"
  control before demosaicing; (2) aim for uniform fine luminance grain with
  strong colour-noise removal instead of a perfectly smooth gradient, since the
  clean reference has fine even grain and luminance-only variation looks
  benign, so remaining specks blend in.

- 2026-11-17: faithful RawTherapee LMMSE (A) merged (`lmmse-demosaic.md`):
  better clean fine detail before Denoise, but only +0.25 dB held-out after
  Denoise, does not remove the Canon pits (dark tail rises with crop-local
  calibration), and roughly doubles CPU development + Denoise time. Keep
  signed AHD; no automatic switch. AI + highlight reconstruction research (B)
  started (`ai-highlights.md`).

- 2026-11-17: speck origin trace (coordinator; page
  https://claude.ai/artifact/Kf757RFoVHiriHYtUw8mUN): of 547 specks left by
  signed + calibration-repaired Denoise in flat gallery shadows, 37% sit on
  exactly one sensor sample beyond 4σ of its same-colour neighbours, 21% on
  two or more, 43% on none (random 3×3 spots: 2–10%). Both signs matter; a
  too-dark red/blue sample becomes a green blob. Passed to the early-outlier
  agent with Steve's request to compare size limits 1 vs 2 samples.

- 2026-11-17: noise-measurement fix merged (`e3e72205`, cache revision
  `adaptive-measure-informative-v3`): CPU and GPU exclude uninformative bins
  and blocks together. Node 1,101 / Python 4,105 pass. GPU drivers for the
  combined validation: gpu-denoise-measurement.js, denoise-adaptive-parity.js,
  gpu-delivery-smoke.js. Protected projects have Denoise off: unchanged.
  Hot-pixel checkbox build started.

- 2026-11-17: speck gallery for Steve (14 lifted high-ISO windows with 6×
  zooms; https://claude.ai/artifact/MqmCM9u6KMSJQ5eDd98HKy; script and window
  list in `codebase/output/denoise-v1/speck-gallery/`). Specks are rare up to
  ISO 4000 and common from ISO 6400. Steve's idea, now in research
  (`early-outlier-taming.md`): the future specks are visible before
  denoising as samples/clusters far outside the local noise in value or hue;
  pull them back into the noise range before Denoise (preferably before
  demosaicing), protect detail by a similarity/support test, and accept
  strength/size controls for fabric and stars. LMMSE research (A) running;
  AI + highlight reconstruction (B) follows.

- 2026-11-17: signed RAW development merged (`8e84c12a`): Bayer only (X-Trans
  and unsupported LibRaw fallbacks stay unsigned), CPU native signed AHD helper
  built by setup/CI/PyInstaller/Flatpak, GPU signed path, import projection
  bypassed, incidental clamps removed, identities bumped. Fast checks pass
  (Node 1,091; Python 4,063). +0.16 s / +0.37 s development at 18 / 42 MP.
  No GPU/Electron checks yet: the builder estimates 90–150+ minutes; proposed
  to Steve as one combined validation after the calibration fix and hot-pixel
  checkbox are built. Calibration fix build started.

- 2026-11-17: demosaic research merged (`demosaic-noise.md`): bilinear, an
  own directional MMSE-style demosaic and light pre-demosaic RAW smoothing do
  not remove the Canon pits (RAW smoothing makes them worse after Denoise).
  Side finding: the MMSE-style trial gains +0.58 dB on held-out pairs
  (35.48 vs 34.91, above RawNIND's 35.07) but shows clean fine-detail
  artefacts. Faithful upstream LMMSE was not tested. Next direction put to
  Steve: faithful LMMSE port vs AI + highlight reconstruction research.

- 2026-11-17: Steve approved the Denoise noise-measurement fix (ignore
  clipped, featureless calibration blocks; `dark-noise-strength.md`), CPU and
  GPU measurement together. Build queued after signed RAW development, since
  both change what Denoise receives; then the hot pixel checkbox.

- 2026-11-17: dark-noise research merged (`dark-noise-strength.md`): two
  separate failures. (1) A calibration bug: clipped featureless bright blocks
  are counted as "quiet" noise samples, so beside the flame Denoise believes
  there is almost no noise; the repair (ignore uninformative blocks) cleans
  that area (signed flame tail .146 → .076) at no extra cost. Put to Steve as
  a decision. (2) The signed dark-shadow pits are rare AHD demosaic clumps that
  Denoise keeps as detail; not fixed. Next experiment started: noise-robust
  demosaic and light pre-demosaic noise reduction (`demosaic-noise.md`).

- 2026-11-17: Steve approved the Pixel cleanup **Remove hot pixels**
  checkbox, off by default (single-photo filter from `raw-pixel-cleanup.md`,
  no slider, no cold/dead mode). Build queued after signed RAW development,
  since both change RAW development on CPU and GPU.

- 2026-11-17: Steve approved building signed RAW development: "I think we
  should build it because it's more technically accurate and probably how we
  should be handling the data. But it might also make the rest of our Denoise
  work more critical." Build started on a worker branch; it stays on
  `feat/denoise-v1` and does not reach `main` until Denoise handles the
  more visible specks on signed input. The dark-noise experiment now uses
  signed development as its primary baseline. Hot pixel filter result
  (optional, default off) is the next decision for Steve.

- 2026-11-17: next experiment started: why current Denoise barely reduces
  very dark, very noisy areas next to bright ones (lifted flame edge), and
  the smallest classical fix (`dark-noise-strength.md`).

- 2026-11-17: Steve ruled out camera defect maps/calibration captures for now.
  The requested map-free hot-pixel prototype changes three unconfirmed Canon
  sites, preserves two reviewed airborne sparks, but changes sharp real-light
  models and three suspicious glint/sky-detail sites. Recommend one optional
  **Remove hot pixels** checkbox, default off, cold mode off; no slider or
  app/module PRD change. CPU filter .190/.471 s at 18/42 MP on the Mac;
  public held-out/seen pairs show no meaningful Denoise gain. Twelve focused
  tests and 35 isolated GPU parity cases pass; Node 1,091 passed, Python
  3,999 passed. See the new single-photo section in `raw-pixel-cleanup.md`.
  The older map-based recommendation below is historical, not a request for
  captures. No thresholds/guards relaxed or production integration performed.

- 2026-11-17: signed-shadows research merged (`signed-shadows.md`). Keeping
  below-black samples through a native signed AHD removes the neutral-black
  bias (pure black at +4 stops: SDR ΔE 24.5 today, 0 signed), adds ~0.25 s at
  18 MP / 0.54 s at 42 MP, and gives a small held-out gain (34.91 vs 34.83 dB),
  but does not remove the Canon specks with unchanged Denoise. The report maps
  every downstream clamp. Put to Steve as a build decision with review page
  https://claude.ai/artifact/Hk4W3gZakZez3W5hbPifrQ. Also seen: current
  Denoise barely reduces the lifted flame-edge noise at all.

- 2026-11-17: Steve on the shadow clipping: "we should almost certainly
  preserve the noisy shadow data as darktable does and let the user crush
  shadows to taste in editing." Direction agreed in principle, pending the
  signed-shadows measurements and a downstream-stage plan.

- 2026-11-17: Steve: no camera-specific defect maps or calibration captures
  for now; improve general processing. He asked for a single-photo hot pixel
  filter in Pixel cleanup with a checkbox for edge cases (stars, sparks),
  since a real hot pixel is one photosite while real light spreads to
  neighbouring photosites of other colours. Prototype research started.

- 2026-11-17: Pixel cleanup research: map-based repair of known sensor
  defects before demosaic works and is cheap (~21/75 ms at 18/42 MP), but
  IMG_0790 has no confirmed defects (1,011 unconfirmed suspects, almost all
  below black); single-photo guessing is not recommended by default. It found
  that both RAW paths clip below-black shadow samples to zero before AHD.
  Next experiment started: keep signed shadow values through demosaic
  (`signed-shadows.md`). Defect maps need Steve's lens-cap/flat captures (Q1).

- 2026-11-17: noise-model trial finished: IMG_0790's degenerate fit comes
  from a clipped bright bin, already compensated by later band multipliers;
  a corrected fit predicts less shadow noise, leaves more ringed grain on the
  lifted Canon crops and barely changes public pairs. Not shipped; the
  diagnostic and tests are kept. See `noise-model-and-raw-specks.md`.

- 2026-11-17: Steve decided a separate RAW development step, **Pixel
  cleanup** (named so it can gain features later), that repairs genuine
  sensor defects (hot, stuck and dead pixels, sensor errors) on sensor data
  before demosaicing, like highlight reconstruction. First scope: real
  defects only, then measure the effect on real photos and on Denoise.
  Research started (`raw-pixel-cleanup.md`); the noise-model worker now
  covers only the degenerate per-frame noise fit.

- 2026-11-17: post-demosaic speck/blotch cleanup failed (+0.06 dB held-out,
  Canon specks remain, fine text regresses; 14–16 s extra at 18 MP); not
  shipped. See `speck-cleanup.md`. Next experiment started: fix the degenerate
  per-frame noise fit (IMG_0790) and try outlier repair on the RAW sensor
  data before demosaic, where a speck is still one sample.

- 2026-11-17: Steve replaced D2 (see section 7): classical Denoise
  (Experimental) first; AI Denoise (Experimental) only from the Denoise
  module by re-development, never on initial development, and only once it
  works with highlight reconstruction. Design written
  (`ai-experimental-design.md`); speck/blotch cleanup research started.

- 2026-11-17: implemented Steve's D1 shipping defaults (Amount/Color Noise
  0.75, Detail Recovery 0.5) across CPU/GPU defaults, new documents, reset and
  Default preset paths; saved values retained, no migration or tolerance changes.
  Mac validation: Node 1,091 passed / one skipped; Python 3,941 passed /
  155 skipped / one xpass. `denoise-progressive-disclosure.js` passed new-photo
  defaults, double-click/group reset and Default preset checks plus its existing
  display checks. `denoise-adaptive-parity.js` stopped at the documented
  pre-existing Mac failure, "The GPU result could not be read back"; no rerun
  or tolerance change. Both GPU checks used the shared lock at 1408x794.
  Output stayed 12.9 GB; generated temporary fixtures removed. All three
  protected project hashes stayed unchanged; none changes appearance on open.

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
