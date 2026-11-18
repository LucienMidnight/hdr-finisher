# Denoise speck R&D: next-round proposal prompt — November 18, 2026

This is a prompt for a research model, starting with Codex `gpt-6.2-astra`.
Steve wrote the goal; Claude assembled the context from the November 16–17
Denoise v1 work. Your job is to **propose** the next round of R&D, not to
build it. Read everything below before you open the code.

---

## 1. Who you work for and what he wants

Steve owns HDR Finisher, a GPL-3 offline HDR photo editor (Electron + WebGPU
frontend, Python backend). He is not a coder. Write for him in plain language,
put decisions to him one at a time, and give each one its trade-off and what
could break. Read `AGENTS.md` at the Git root first and follow it.

The goal, in his words: *"I want the sensor noise patterns to be removed without
negatively affecting structure and sharpness."*

His November 18 assessment:

- **Pixel cleanup works.** "Pixel cleanup is anecdotally working wonderfully on
  default settings. It evens out the noise very obviously."
- **Denoise is the problem on the hard photo.** On the challenging night photo,
  Denoise loses a lot of detail and many specks still show. Raising Denoise far
  enough to remove the specks sacrifices too much of the photo.
- **What is acceptable.** Fine, consistent grain with little colour noise is
  fine, especially since a very smooth AI Denoise will be the alternative later.
- **What must go.** Splotchy spots and colourful, distracting noise.
- **What he wants.** A more targeted approach: remove the specks and splotches
  specifically, rather than smoothing everything harder.
- **Expect them to be green or magenta.** He sees that the remaining harsh
  noise is "almost all harsh green and magenta where no green or magenta should
  naturally exist in the photo".
- **No pattern safety check for spot removal.** The neighbour-similarity check
  ("similar neighbours mean real detail") **must not be used for spot removal**.
  See §5 for why.

AI Denoise (RawNIND Bayer UtNet2, ONNX, CPU) is deferred until after v1. It
must be built together with highlight reconstruction and may never run on
initial development (§6). Until then, the classical path must keep improving.

## 2. The current pipeline, sensor to screen

Supported Bayer RAW (`docs/technical/image-processing-pipeline.md`, around
line 150):

1. LibRaw read → **signed** per-phase black/white normalisation. Below-black
   samples are kept, as darktable does.
2. **Pixel cleanup** (optional, Bayer only, `raw_pixel_cleanup.py`,
   `raw_speck_cleanup.py`):
   - **Remove hot pixels** (default off): per CFA phase, the centre must exceed
     all 8 same-phase neighbours by 8σ and 0.02. The step:
     - is vetoed if an adjacent other-colour site rises by 2.5σ and 2 DN;
     - preserves samples ≥0.98 and a 4 px border;
     - repairs from the most consistent opposite same-phase pair.
   - **Even out harsh specks (Experimental)** (default off; Threshold ×2–×4,
     default ×2.5). This is Steve's "uniformity" idea. A per-CFA-phase soft
     clamp of each sample toward its 5×5 same-phase median:
     - noise σ = max(sensor model, 1.4826·local MAD);
     - smoothstep ramp from threshold to envelope 1.5σ, strength .75, both
       signs, no replacement;
     - same-sign connected area ≤5;
     - absolute floor 0.005;
     - **the neighbour-similarity veto is always on** (two neighbours within
       ±1σ veto the clamp).

     It adds about 1.2 s at 18 MP and 2.8 s at 42 MP on the minimum Mac.
3. **Opposed color** highlight reconstruction (sensor space).
4. White balance + **native signed AHD** demosaic (`signed_ahd.c` via
   `signed_raw.py`).
5. Camera RGB → ACEScg (the RAW import gamut projection is bypassed; incidental
   clamps are removed).
6. **Edge colour** highlight reconstruction (optional; it re-develops the RAW,
   `highlight_edge_colour.py`).
7. Straighten / crop.
8. **Denoise** `adaptive-atrous-v1` (`denoise_adaptive.py`, GPU in
   `webgpu-preview.js`, UI in `denoise-ui.js`):
   - It measures the photo's own noise from the quietest 25% of blocks of an
     image sample of at most 1 MP (`denoise_measurement.py`,
     `denoise-measurement.js`). Uninformative clipped/featureless blocks and
     brightness bins are excluded (revision `adaptive-measure-informative-v4`).
   - It builds a **brightness-dependent noise model over 5 à-trous wavelet
     bands**, separately for luminance and opponent colour.
   - Keep factor per band: `max(1 − σ²/local energy, 0)` over a 7×7 area
     (Wiener-like).
   - Live sliders re-mix cached layers.
   - Shipping defaults: Amount .75, Color Noise .75, Detail Recovery .5,
     Luminance .5. "Noise size" per band is Finest 1–2 px, Fine 2–4 px,
     Medium ~8 px and Coarse 16–32 px, all 50%.
9. Exposure and the rest of grading, Film Look, and output.

**Routes that must agree within tolerance:**

- CPU development and export (the fallback);
- Library GPU RAW development (`library-gpu-raw.js`, `library_gpu_raw.py`);
- WebGPU preview;
- GPU Proof/export delivery.

X-Trans, linear DNG and non-RAW sources skip the signed path and Pixel cleanup.

## 3. What has already been tried

All reports are in `docs/technical/research/denoise-v1-2026-11-16/`. Read the
plain-language result at the top of each before proposing anything that
overlaps. The test harness is `codebase/tools/denoise_eval/`; read its
README. Candidate adapters are in `codebase/tools/denoise_eval/candidates/`.

| Attempt | Report | Outcome |
| --- | --- | --- |
| Retuned current Denoise defaults | `classical-prototypes.md`, brief log | Shipped (Amount .75, Colour .75, Detail .5, Luma .5). Its peak-score version loses edge detail. |
| darktable-style wavelets, GALOSH | `classical-prototypes.md` | Wavelets soften; GALOSH leaves structured artefacts in lifted shadows. Both are slow. |
| Empirical Wiener with self/tuned/RawNIND pilots | `pilot-wiener.md` | Best +2 dB over defaults, barely ahead of the tuned current. ISO 25600 edge sharpness is 0.69 of clean (target 0.90). Not qualified. |
| RawNIND linear and Bayer AI | `rawnind-prototype.md`, `ai-highlights.md` | Visually best on specks (AI left 22 flat-gallery specks against 141 for taming). Not combinable with highlight reconstruction yet; after v1. |
| Post-Denoise residual speck and shadow-colour cleanup | `speck-cleanup.md` | +0.06 dB. Modest colour gain. Real dark detail is mistaken for noise. |
| Noise-model fix (clipped bright bins) | `noise-model-and-raw-specks.md`, `dark-noise-strength.md` | Calibration repair shipped. It fixes the area beside the flame only, not the specks. |
| Sensor defect maps | `raw-pixel-cleanup.md` | Rejected by Steve: no per-camera maps or calibration captures. |
| Single-photo hot pixels | `raw-pixel-cleanup.md` | Shipped as an optional checkbox. |
| Signed shadows | `signed-shadows.md` | Shipped. Better shadow colour, but **more** specks on the Canon. It makes Denoise more critical. |
| Demosaic changes (bilinear, MMSE, light RAW smoothing) | `demosaic-noise.md` | Do not fix the dark pits. Light sensor smoothing makes them worse after Denoise. |
| Faithful RawTherapee LMMSE | `lmmse-demosaic.md` | +0.25 dB held-out. Not dependable. Signed AHD stays. |
| Early outlier taming (Steve's idea) | `early-outlier-taming.md` | **The best classical result.** Flat-gallery specks fell from 547 to 141 at 2.5σ. Damages small stars and thin lettering. Shipped as the optional "Even out harsh specks". |
| "Less luma, more colour" grain preset | `early-outlier-taming.md` | Luma grain was 4.1× the clean reference's; coarse, maze-like. Rejected as a default. Only one preset was tried. |
| Green/magenta colour-only cleanup | `chroma-cleanup.md` | The guarded versions barely help (38 → 35 colour islands). Green balancing gives 38 → 40. An **unguarded** 9×9 colour median after Denoise gives 38 → 15, but real small colour keeps only 41–77% of its strength, at 25 s / 61 s per frame. |

**Where specks come from.** Of 547 flat-window specks after Denoise:

- 37% sit on one sensor sample beyond 4σ;
- 21% sit on two or more;
- **43% have no extreme sensor sample at all.** These come from several mildly
  off samples combining through demosaic, or from Denoise itself.

A too-dark red or blue sample becomes a green blob after demosaic. Specks are
typically 1–25 px islands, and green/magenta dominates what remains after
taming.

**Steve's in-app trial on November 18.** Raising Color Noise and the
Fine/Medium noise sizes on the night photo removes specks only at an
unacceptable loss of detail.

## 4. Steve's own ideas, for you to evaluate

- **Find early outliers and pull them into the surrounding noise range before
  demosaic.** Done; it works.
- **Use spatial or size controls** so fabric and stars survive.
- **A threshold "uniformity" slider (×2/×3/×4).** Built.
- **Aim for uniform fine grain, not a perfect smooth gradient.** The clean
  reference is itself slightly noisy. Moving toward value and hue uniformity
  without forcing smoothness may hide specks and jagged edges.
- **Judge colour against the wider area.** Here, "no green or magenta should
  exist in this region" is the right test. Judge a spot's colour against the
  wider area (tens of pixels) or the scene, not against its immediate
  neighbours.

## 5. Limitations of the previous Codex research — do not repeat them

1. **The references were too local.** Detection compared each spot to a 5×5 or
   9×9 median. In a noisy shadow that neighbourhood is itself full of blobs, so
   a blob looks normal. The local MAD noise estimate is also inflated by the
   blobs, which raises the bar further.
2. **The pattern safety check protects noise clumps.** After demosaic, noise is
   spatially correlated, so specks come in clumps and vouch for each other.
   This is why Steve rules it out for spot removal. It is still active in the
   shipped "Even out harsh specks" control (always on). A variant without it
   deserves testing. Detail protection should come from something noise cannot
   fake, for example:
   - a clear luminance edge or ridge that is consistent across scales;
   - orientation coherence;
   - structure present in more than one channel;
   - consistency between wavelet scales.
3. **Specks were never examined as an artefact of Denoise itself.** A
   Wiener-style keep factor `max(1 − σ²/E, 0)` keeps the rare noise peaks whose
   local energy exceeds the threshold and flattens everything around them.
   Smoothing the surroundings raises a survivor's contrast, so the strongest
   noise peaks may be *turned into* isolated specks. Nobody has measured how
   many post-Denoise specks are survivors of the keep factor. Nor has anyone
   tested shrinkage that does not leave isolated survivors, such as:
   - smoothing the keep map itself;
   - cross-scale or cross-channel consistency;
   - Bayesian or soft shrinkage;
   - patch-based or non-local estimates;
   - re-injecting a small, uniform fraction of the noise (Steve's "uniform
     grain") so survivors do not stand out.
4. **The metrics do not match what Steve sees.**
   - The speck counter counts local-contrast islands (SDR residual against a
     5×5 median, 1–25 px, on a 288 px ROI with a fixed +3–4 stop lift). It
     counts real detail too.
   - It explodes when grain is deliberately kept, so grainy outputs cannot be
     compared with smooth ones.
   - Counts said specks were "gone" where Steve still sees them clearly.

   Define a metric of **conspicuousness** that tolerates even, fine grain but
   penalises sparse, high-contrast, chromatic islands. Validate it against
   Steve's own judgement on a few crops before relying on it.
5. **Clean-detail references were thin.**
   - Stars, lettering and petals were **simulations**.
   - There were few real low-ISO crops and no real night-sky capture.
   - The "held-out" RawNIND label comes from the network's split, not from a
     set untouched by this sequence of classical experiments.
6. **The research setup differed from the app.**
   - The research bridge (identity temporary-DNG Lab matrix) is not exactly
     the production signed path.
   - Candidates were stacked on Denoise at shipping defaults, and Denoise
     re-estimated its model on each candidate.
   - Timings were single-thread.
   - Report clearly which of these results transfer to the app.
7. **Grain was only tried as one preset**, not as a principled target such as
   matching the clean reference's fine-grain amplitude and evenness.

## 6. Constraints

- **Single-photo methods only.** No per-camera profiles, defect maps or
  calibration captures. Each step must work on any photo and have a simple off
  switch where it can harm real detail.
- **No awkward compromises.** Steve would rather delay than ship a workaround.
  Slow work is opt-in and never runs on initial development.
- **The minimum machine is the MacBook Neo** (A18 Pro, 8 GB). Every heavy
  CPU/GPU job goes through `codebase/tools/gpu-run-lock.py`, one at a time.
  Run `tools/output_size.py` at the start and end (100 GB limit).
- **CPU/GPU, preview/export and Proof/export agreement** must hold within the
  existing perceptual tolerances. The HDR highlight-compression ceiling is
  exact. GPU routes keep the CPU as a fallback.
- **Speed is judged by the whole wait the user feels.** Propose a GPU route only
  when it pays (about 50% faster or more).
- **Photo sources.**
  - Use photos only from `<photosRoot>/HDR Test Images`. Steve is adding some
    extra noisy RAWs there; use them once they are in the manifest.
  - The public RawNIND pairs are research-only and are never committed.
  - Never save over the read-only test projects.
- **Licensing.** GPL-3 codebase. Record the licence of any ported technique.
  Read any patent caveats noted in `candidates.md`.

## 7. Code to read

- **Sensor stage:**
  - `codebase/backend/hdr_finisher/raw_import.py` (RAW development order);
  - `signed_raw.py`, `signed_ahd.c`, `raw_pixel_cleanup.py`,
    `raw_speck_cleanup.py`, `highlight_edge_colour.py`.
- **Denoise:**
  - `codebase/backend/hdr_finisher/denoise_adaptive.py`,
    `denoise_measurement.py`;
  - `codebase/frontend/denoise-ui.js`, `denoise-measurement.js`;
  - the Denoise passes in `webgpu-preview.js`.
- **GPU RAW route:** `codebase/frontend/library-gpu-raw.js`,
  `codebase/backend/hdr_finisher/library_gpu_raw.py`.
- **Contracts:**
  - `docs/technical/image-processing-pipeline.md`;
  - `docs/technical/denoising.md`;
  - `docs/product/modules/import-and-raw.md`, `docs/product/modules/grade.md`.
- **Research harness:** `codebase/tools/denoise_eval/` and the existing adapters
  (`early_outlier.py`, `chroma_cleanup.py`, `speck_cleanup.py`,
  `dark_noise.py`, `pilot_wiener.py`, `rawnind.py`).
- **Brief and log:** `docs/technical/briefs/denoise-v1-quality-trial-2026-11-16.md`.

## 8. What to deliver

**A proposal for the next round of R&D**, written to
`docs/technical/research/denoise-v1-2026-11-16/speck-rnd-proposal.md`, with a
pointer in the AGENTS.md docs map and a line in the brief log. Contents:

1. **A whole-workflow map: which stage should host which job.** For each noise
   type, say where in the pipeline it is best detected, where it is best
   corrected, and why. Candidate stages: CFA/sensor, demosaic, post-demosaic
   camera RGB, inside Denoise's wavelet bands, after Denoise, and finishing.
   The noise types:
   - hot or stuck samples;
   - isolated outlier samples;
   - clumps of mildly-off samples;
   - green/magenta chroma blobs;
   - dark luminance pits with coloured rims;
   - coarse colour mottle;
   - fine luminance grain;
   - specks created by Denoise itself.

   Say what each existing step should keep doing, stop doing or hand over.
2. **Your diagnosis of why Denoise loses detail and leaves specks** on the Canon
   night photo (`IMG_0790.CR2`), with evidence. In particular, test the
   "keep-factor survivor" hypothesis in §5.3.
3. **3–5 concrete R&D tracks, ranked.** For each:
   - the hypothesis and method;
   - where it sits in the pipeline;
   - how it protects real detail **without** the neighbour-similarity veto;
   - expected speck reduction;
   - risks to stars, lettering, eyelashes, fabric and foliage;
   - CPU/GPU cost on the minimum Mac;
   - what a shipping version would need (GPU route, saved fields, controls).
4. **A measurement plan.**
   - A conspicuousness metric that tolerates fine even grain.
   - Real clean-detail references, not simulations alone.
   - Steve's new noisy RAWs.
   - A small visual review page format for Steve: noisy | today | candidate,
     with 6× zooms.
5. **Decisions for Steve, one at a time,** each with its trade-off.

**You may run small diagnostics** to ground the proposal, for example
classifying today's post-Denoise specks by origin: sensor outlier, demosaic
combination or keep-factor survivor.

- Keep diagnostics bounded: about 45 minutes of heavy work under the lock.
- Commit scripts under `codebase/tools/denoise_eval/` with receipts.
- Do not change app code, defaults, tolerances or saved formats.
- Commit locally in small commits. **Do not push.**
