# Denoising Technology Watch — August 2026

**Status:** Research synthesis and prototype recommendations; not an implementation commitment.
**Researched:** August 24, 2026
**Decision owner:** HDR Finisher product/engineering
**Companion specification:** [Denoising Research and Implementation Direction](denoising.md)

## Executive conclusion

The quality frontier is learned, but the evidence does **not** point to an inevitably generative or
AI-only denoising future. The most credible product direction for HDR Finisher is a hybrid:

1. keep the deterministic, HDR-safe multiscale engine as the always-available foundation;
2. use physical noise knowledge and better synthetic training data for RAW;
3. add a compact, single-pass discriminative model as an optional local provider when it beats the
   built-in engine on HDR Finisher's own corpus;
4. retain explicit residual, chroma-band, local-mask, and texture-recovery controls around either
   engine; and
5. treat iterative diffusion restoration as a separate, opt-in repair mode if it ever becomes
   useful—not as faithful denoise.

The strongest 2025–2026 result is less about a magic architecture than about **knowing the noise**.
The AIM 2025 real-world RAW challenge was camera-agnostic and compute-constrained; most entries used
NAFNet-family backbones, while the important differentiators were realistic noise synthesis,
training strategy, and generalization. The NTIRE 2025 and 2026 Gaussian-noise challenges show the
opposite failure mode for product selection: excellent headline scores often depend on fixed
synthetic noise, no compute limit, multiple large networks, overlapping patches, and geometric
self-ensembles. Those are useful research results, but poor evidence for a simple interactive tool.

The current architecture therefore remains sound. New evidence strengthens three additions to the
roadmap: a physics-informed RAW training spike, a learned noise/threshold estimator feeding the
classical engine, and an evaluation of compact self-supervised RGB denoisers for baked or unprofiled
images.

## What the current frontier actually shows

### RAW: data and noise modeling are winning the argument

The [AIM 2025 Real-World RAW Image Denoising Challenge](https://sonyresearch.github.io/AIM2025_Denoise_Challenge/)
evaluated camera-agnostic low-light RAW denoising across five DSLR cameras. Its rules capped models
at 15 million parameters and 150 GMAC for a four-channel 512×512 input, which makes it unusually
relevant to a local desktop product. The winning and most submitted systems used comparatively
plain NAFNet-style backbones. Better noise synthesis, random masking, augmentation, and training
were more decisive than a radically new network family. The organizers released an
[MIT-licensed baseline](https://github.com/SonyResearch/AIM2025_Denoise_Challenge).

Two adjacent projects make the same point:

- Sony's CVPR 2025 [Noise Modeling in One Hour](https://github.com/SonyResearch/raw_image_denoising)
  removes cumbersome gain and signal-independent-noise calibration steps, reducing preparation
  from days to hours while reporting up to 0.54 dB over the compared synthesis method. The code is
  MIT-licensed. It is a practical template for expanding beyond community profiles without asking
  every user to shoot paired clean/noisy frames.
- The TPAMI 2026 [Physics-guided Noise Neural Proxy (PNNP)](https://github.com/fenghansen/PNNP)
  keeps photon shot noise physical, decomposes dark-frame noise into frame-, band-, and pixel-level
  components, and learns only the difficult pixel component with a lightweight neural proxy. The
  repository is Apache-2.0, but currently omits training code for the proxy and releases weights
  for only Sony A7S2 and IMX686.

The implication is important: AI can produce much of its value in **calibration and training-data
generation**, while shipped inference remains compact, deterministic, and single-pass.

### RGB and baked images: self-supervision is becoming credible, not yet turnkey

The most interesting 2026 work attacks the exact weakness of unprofiled and baked inputs: no clean
reference and unknown, spatially correlated noise.

- CVPR 2026 [Next-Scale Prediction (NSP)](https://openaccess.thecvf.com/content/CVPR2026/html/Shan_Next-Scale_Prediction_A_Self-Supervised_Approach_for_Real-World_Image_Denoising_CVPR_2026_paper.html)
  creates cross-scale training pairs so a blind-spot network can decorrelate real noise without
  discarding as much fine structure. Its [repository](https://github.com/XLearning-SCU/2026-CVPR-NSP)
  includes training and test code but has only a handful of commits and, as researched, no declared
  software license. It is a research reference, not redistributable product code.
- CVPR 2026 [TM-BSN](https://github.com/parkjun210/TM-BSN) uses triangular masking and distills its
  teacher into a roughly 1.02M-parameter student. The small student is attractive for a local
  spike, but the repository does not currently declare a license and is validated on SIDD/DND sRGB,
  not scene-linear HDR.
- CVPR 2026 [Convexity-Aware Noise Calibration](https://openaccess.thecvf.com/content/CVPR2026/html/Wang_Convexity-Aware_Noise_Calibration_A_Self-Supervised_Framework_for_Noise-Level-Unknown_Image_Denoising_CVPR_2026_paper.html)
  first estimates an unknown Gaussian noise level from the image, then synthesizes training pairs.
  The [Apache-2.0 repository](https://github.com/zhanzhanblue/CANC) was only a one-commit placeholder
  when researched, so the idea is more useful than the current code.

Self-supervision is therefore a promising route for **building or adapting a model** to baked noise,
not yet the best default inference path. Blind-spot methods still struggle when the noise is
correlated by demosaic, tone mapping, resampling, or compression—the same conditions that create
large chroma patches.

### General-purpose restoration: frequency-aware models match our product shape

[AdaIR](https://github.com/c-yn/AdaIR) (ICLR 2025, MIT) adapts low- and high-frequency feature bands
inside one model across denoise, deblur, dehaze, derain, and low-light enhancement. NeurIPS 2025
[BioIR](https://proceedings.neurips.cc/paper_files/paper/2025/hash/73ba81c7b25134a559c8a9c39ec1a4c3-Abstract-Conference.html)
continues the all-in-one trend with wide-context and fine-detail pathways; its
[code and models](https://github.com/c-yn/BioIR) are MIT-licensed. These projects are interesting
because their frequency/context split resembles HDR Finisher's proposed universal multiscale
control and coherent-residual recovery.

They are not drop-in answers. Their standard benchmarks mix display-referred restoration tasks and
do not establish ACEScg range safety, wide-gamut color fidelity, negative-channel behavior, or
42-megapixel tiled equivalence. Use them as architecture and training references, not as product
claims.

### Architecture fashions: useful to watch, weaker than the data signal

[MambaIR/MambaIRv2](https://github.com/csguoh/MambaIR) applies state-space models to restoration and
is Apache-2.0. The family promises long-range context with favorable asymptotic scaling. It appears
in recent denoising challenge systems, but the practical submissions often still use large models,
heavy patching, and ensembles. There is not yet evidence that it beats a compact NAFNet-family CNN
for HDR Finisher's latency, tiling, color, and fidelity constraints.

NAFNet remains the sensible neural reference baseline: its official
[MIT-licensed implementation](https://github.com/megvii-research/NAFNet) is simple, efficient, and
continues to anchor 2025–2026 challenge work. A newer backbone should earn adoption on our corpus;
novelty alone is not a reason to add runtime complexity.

### Diffusion: promising restoration research, wrong default contract

Diffusion and bridge models are increasingly used for plug-and-play inverse problems and severe
restoration. They can synthesize plausible detail when the measurement no longer determines a
unique clean image. That is also their problem for a finishing tool: multiple inference steps,
high memory use, instability under domain/range changes, and plausible-but-incorrect texture.

Even research explicitly frames hallucination as a hazard. CVPR Workshops 2026
[Noise2DiffusionEnhanced](https://openaccess.thecvf.com/content/CVPR2026W/PBVS/html/Hazebrouck_Self-supervised_Diffusion-guided_Hallucination-free_Thermal_Infrared_Image_Denoising_CVPRW_2026_paper.html)
uses diffusion to help create training targets, then trains a conventional denoiser to avoid
shipping those hallucinations into a safety-critical result. This is the better pattern for HDR
Finisher: use generative models to improve training data or optional repair, not as the authoritative
pixel-faithful denoise result.

## Renders are not an AI-only problem either

[Open Image Denoise 2.5](https://www.openimagedenoise.org/) remains the mature open neural render
denoiser. Despite the Intel name, it is Apache-2.0 and supports CPU plus Intel, NVIDIA, AMD, and
Apple GPU backends. Its HDR ray-tracing filter accepts beauty plus optional albedo and normal AOVs.
It is still a substantial third-party runtime and remains an optional comparison, but it does not
create an Intel-hardware dependency.

SIGGRAPH Asia 2025 provides the more strategically interesting counterexample. TU Wien's
[Statistical Error Reduction for Monte Carlo Rendering (StatER)](https://users.cg.tuwien.ac.at/~hiroyuki/StatER/)
uses multiple Box–Cox transforms, denoised variance, and explained-variance correction. The authors
report competitive quality on current GPUs, predictable convergence, low bias, and no neural
hallucinations. Its [reproducible code](https://github.com/cg-tuwien/StatER) is research-oriented,
tied to a modified PBRT renderer and CUDA/OpenCV, and explicitly not production-ready.

That distinction defines two render paths:

- **Beauty image only:** treat the render as linear RGB and use the universal multiscale engine.
- **Beauty plus trustworthy AOVs/statistics:** later evaluate OIDN and statistical/variance-guided
  methods as advanced render-aware providers. StatER cannot help a baked PNG or EXR beauty after
  the per-sample statistics have been discarded.

## Open-source discourse: quality is only half the product

darktable 5.6 is the most useful current open-source field test. It ships optional local RawNIND,
NIND, and NAFNet models through an ONNX provider system. The
[neural restore design discussion](https://discuss.pixls.us/t/introducing-neural-restore-module-raw-denoise-denoise-and-upscale/57349)
shows users impressed by difficult high-ISO results, but also exposes the product costs: one-shot
DNG/TIFF generation, model downloads, hardware/provider failures, high memory reports, metadata and
color-pipeline problems, and awkward local masking.

The same discussion says that its RGB denoise strength restores wavelet-filtered source texture
rather than simply adding all original noise back. This independently supports HDR Finisher's
coherent residual and pre-grain Texture Recovery direction. Users also ask to combine hard cleanup
in shadows with reduced cleanup on subjects; blending one denoised result through local masks is a
natural answer.

Color is still a live weakness. In July 2026, a user reported visible color shifts from darktable's
neural result, and the model integrator noted that model reconstruction can move color. This is
anecdotal, not a benchmark, but it reinforces our non-negotiable wide-gamut and removed-color tests.
For large chroma patches, no current paper removes the fundamental single-image ambiguity: a broad
color area can be intentional illumination or correlated noise. HDR Finisher should keep ordinary
Color Noise restricted to fine bands, use joint opponent-chroma covariance shrinkage, and expose
coarser Color Blotch Cleanup only as an opt-in, locally maskable operation with Affected/Removed
Color diagnostics.

## Technique portfolio for HDR Finisher

The scores below are an internal, evidence-coded product assessment—not paper benchmark results.
Five means strong alignment with a single-pass local HDR product; one means research-only or a poor
default contract.

| Direction | Product fit | Readiness | Main reason | Action |
|---|---:|---:|---|---|
| Physics-informed RAW synthesis + compact NAFNet-family model | 5.0 | 4.0 | Strong challenge evidence; compact inference; compatible licenses exist | **Prototype first neural path** |
| Learned noise/covariance/threshold estimator feeding wavelets | 4.8 | 3.5 | Preserves deterministic HDR engine while improving Auto and chroma decisions | **Prototype with Phase 1** |
| Built-in opponent-wavelet engine + coherent residual | 4.7 | 4.5 | No download, direct controls, HDR/range contract, works on every source | **Ship foundation** |
| Compact RGB NAFNet/AdaIR/BioIR provider | 4.1 | 3.5 | Good baked-image reference; useful frequency/context ideas | **Evaluate after foundation** |
| Self-supervised NSP/TM-BSN-style baked denoise | 3.5 | 2.0 | Addresses no-profile inputs; small students possible | **Research spike; wait on licensing/maturity** |
| OIDN with render AOVs | 3.2 | 4.5 | Mature and multi-vendor, but render-only and a large optional dependency | **Keep optional comparison** |
| StatER-style variance/statistics render path | 3.0 | 1.5 | Faithful non-neural alternative; requires renderer statistics | **Watch; borrow ideas if EXR statistics arrive** |
| Mamba/state-space restoration | 2.9 | 2.5 | Promising context scaling; weak product-specific evidence over compact CNNs | **Watch, do not lead with it** |
| Iterative diffusion/generative restoration | 1.7 | 2.5 | Powerful repair prior but slow and may invent detail or color | **Exclude from default denoise** |

## Recommended experiments

### P0 — learned Auto for the classical engine

Train or adapt a very small estimator that predicts a luminance-dependent noise curve, opponent-
chroma covariance, fine/coarse confidence, and possibly per-band thresholds. The shipped pixel
reconstruction stays the deterministic wavelet engine. This is the smallest way to capture current
learned-noise-model progress without surrendering HDR, color, masking, or slider semantics.

Compare it against robust MAD/profile estimates on profiled RAW, unprofiled RAW, baked smartphone
images, smooth gradients, broad colored lighting, and linear renders. A learned estimate is accepted
only if it improves Auto more often than it causes over-cleaning or coarse color loss.

### P1 — compact physics-informed RAW model

Use the AIM 2025 baseline and NAFNet as the reference architecture. Start with the pinned community
profiles, then test Sony's one-hour synthesis recipe on unsupported cameras. Do not attempt a
foundation-scale model. Target one local pass, fewer than roughly 15M parameters, ONNX export,
bounded-overlap tiling, CPU fallback, and a model package small enough to be an optional download.

The first question is not “does it win PSNR?” but “does it beat the built-in profile-conditioned
wavelet path on deeply lifted shadows while preserving color, stars, hair, text, and exposure?”

### P2 — baked/unprofiled model bake-off

Evaluate official MIT/Apache candidates or clean-room reimplementations of NAFNet, AdaIR/BioIR
ideas, and a distilled blind-spot student. Retrain or fine-tune for linear/HDR patches rather than
assuming an sRGB checkpoint can be normalized safely. Include model-free input and output adapters
in the test so range handling cannot be hidden inside a favorable crop.

NSP and TM-BSN are architecture references until their repository licenses permit reuse. CANC is a
noise-estimation research reference until substantive code is released.

### P3 — render-aware A/B test, not a dependency decision

After EXR AOV import exists, compare the built-in engine, OIDN 2.5 beauty-only, and OIDN beauty plus
albedo/normal on low-spp and converged references. Record CPU/GPU portability, install size, memory,
cancellation, negative ACEScg handling, and color/exposure drift. Separately record what variance or
sample-count metadata would be required to borrow StatER-style confidence/adaptive ideas.

### P4 — generative repair sandbox only

If a small open diffusion/bridge model later runs locally in a few deterministic steps, test it
under a different name such as **Repair** or **Reconstruct Detail**. It must default off, declare
that detail may be synthesized, preserve the original result, and never silently back the Denoise
slider.

## Go/no-go gates for an optional AI provider

A model should not ship merely because it looks smoother than the classical path. It must:

- beat or complement the built-in engine on the full HDR Finisher corpus, not only SIDD/DND or
  fixed AWGN;
- preserve scene-linear exposure, wide-gamut color, negative-channel policy, alpha, and HDR peaks;
- show no meaningful change in coarse chroma under ordinary Color Noise;
- tile without seams and remain stable at 24 MP and 42 MP;
- finish in one inference pass apart from bounded tiling and one existing texture-recovery blend;
- run on a deterministic CPU fallback and at least two GPU families before becoming recommended;
- carry a reviewed code, weights, and training-data license/provenance chain;
- be opt-in, local, checksum-verified, removable, and nonessential to opening saved projects; and
- lose to “do not ship” if its principal gain is invented texture that authored grain merely hides.

## Decision log

- **Keep:** one universal source-aware Denoise tool, aggressive useful defaults, fine-band Color
  Noise, opt-in Color Blotch Cleanup, one coherent Texture Recovery stage before authored grain,
  and local masks blending one computed result.
- **Strengthen:** explicitly prototype learned noise/covariance estimation and physics-informed RAW
  synthesis before chasing larger backbones.
- **Clarify:** OIDN is multi-vendor and not Intel-hardware-locked, but it remains an optional
  render-only runtime rather than the product foundation.
- **Watch:** compact self-supervised blind-spot students, BioIR/AdaIR frequency-aware restoration,
  state-space backbones, and statistics/variance-guided render denoising.
- **Reject for core denoise:** unconstrained challenge ensembles, mandatory multi-pass inference,
  and generative detail synthesis presented as faithful cleanup.

## Evidence limits

This report synthesizes papers, challenge reports, official repositories, project documentation,
and open-source user/developer discussion available on August 24, 2026. Paper metrics are not
directly comparable across RAW, SIDD/DND, AWGN, and Monte Carlo rendering. Repository stars and
discussion reports indicate maturity or workflow friction, not image quality. No candidate has yet
been run against HDR Finisher's ACEScg/HDR corpus; all product-fit scores are hypotheses to be
validated by the experiments above.
