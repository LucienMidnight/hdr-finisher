Local AI denoising is feasible as an optional, explicitly prepared source correction.
Recommend a RawNIND linear-RGB experiment; do not ship it as the default yet.
Keep Denoise v2 for interactive control, unsupported inputs, and dependable offline operation.
A 24 MP repeated-crop CPU trial took 48.3 seconds; whole-app memory and HDR safety remain unqualified.
RAW Bayer inference is promising, but replacing demosaic is a larger and riskier change.

Evidence status: **measured** means this investigation's runs; **read** means repository or primary-source evidence; **estimated** means a proposal or extrapolation, not validated behaviour. All external links accessed 2026-11-13. This is feasibility research, not permission to add a feature. `docs/product/PRD.md:166` excludes AI selection/generation; denoise is discriminative restoration, but neural modes remain outside the approved v2 scope (`docs/technical/denoising.md`, section 11).

The app's root `LICENSE:1` is GNU GPL version 3. Free distribution does not make research-only or non-commercial model terms acceptable. Code licences below do not automatically license externally hosted checkpoints.

Evidence table

Abbreviations: U = unmeasured/unknown, not zero; R = read; M = measured; E = estimated. Sizes are decimal MB. RAM estimates concern an isolated inference worker, not the whole editor. All U cells mean this investigation found no applicable measurement in the linked candidate source. ORT = ONNX Runtime. Tile choices are proposed inputs including halo, batch one.

| Candidate | Code / weights licence | Download / installed model | RAM / VRAM at 24 MP; tile | PC GPU / PC CPU | Apple silicon estimate / CPU fallback | Runtime | HDR fit / quality versus v2 | Maturity |
|---|---|---|---|---|---|---|---|---|
| RawNIND linear UtNet2 | R GPL-3.0 / dual GPL3 or CC-BY-4.0 [A] | M 57.70 MB combined archive; 31.054 MB linear ONNX [B, runs] | M CPU RSS 1.128 GB; VRAM U; E reserve 1 GB GPU initially, qualify; 512 with 64 each side [C, runs] | GPU U (lock occupied) / M 48.28 s, 176 tiles [runs] | E provisional 25–100 s GPU, 50–200 s CPU; extrapolation only, no matching published Mac benchmark [runs, assumptions below] | R ONNX exists; CPU tested [B,C] | R linear Rec.2020, arbitrary gain; M smoother dark fabric than v2 in one crop, no reference; unrestricted ACEScg not established [B,runs] | R upstream pushed July 4 2026; darktable package June 20 2026 [metadata] |
| RawNIND Bayer UtNet2 | R GPL-3.0 / same dual weights terms [A] | M same archive; 31.056 MB Bayer ONNX [runs] | E 0.6–1.5 GB worker / 0.5–1.5 GB VRAM starting reservation, not bounds; 512 packed -> 1024 RGB [B] | U / E approximately 12–25 s inference from quarter pixel count of linear trial, different output head untested [B,runs] | E approximately quarter linear inference, not total decode time; CPU U [B] | R ONNX [B] | R joint demosaic, camera RGB; strongest architectural fit for sensor noise; no v2 comparison [B] | R same package; academic upstream [A,B] |
| AIM 2025 compact RAW baseline / NAFNet-family | R MIT / separate redistribution grant for selected checkpoint not verified [D] | U; E <=60 MB FP32 if <=15M parameters; training state extra [D] | U / U; E start 256 packed, halo 32, profile before admission [D] | U / U [D] | U; cannot transfer RawNIND timing to another network [D] | R PyTorch; E ONNX export spike required [D] | R sensor-domain challenge, not HDR ACEScg; calibration/generalisation more useful than architecture novelty; v2 U [D] | R challenge code, pushed Oct 15 2025 [metadata] |
| SID original U-Net | R MIT / externally downloaded weights grant not separately verified [E] | U [E] | U / U; E 256 packed, halo 32 [E] | U / U [E] | U / U [E] | R TensorFlow-era reference; E conversion needed [E] | R low-light RAW to developed RGB with exposure ratio, not faithful drop-in scene-linear reconstruction; v2 U [E] | R CVPR 2018 reference; avoid new TensorFlow dependency [E] |
| PNNP | R Apache-2.0 / distinct checkpoint terms not verified [F] | U [F] | U / U; tile depends on downstream denoiser [F] | U / U [F] | U / U [F] | R PyTorch research pipeline [F] | R noise synthesis/calibration, not itself a universal shipping denoiser; two released sensor proxies; v2 U [F] | R April 2026 TPAMI; pushed Sep 25 2026; proxy training omitted [F,metadata] |
| RGB NAFNet SIDD width32 | R MIT plus BasicSR Apache notice / darktable card says MIT, upstream external-weight scope should be confirmed [G,H] | R 108.414 MB darktable archive [metadata]; installed U | U / U; E try 512 with 64 halo after re-export (published package fixed 768) [H] | U / U [G,H] | U / U [G,H] | R existing ONNX package [H] | R SIDD developed RGB, not linear HDR; global pooling makes tile context important; v2 U [G,H] | R established 2022 baseline, upstream pushed July 3 2024 [metadata] |
| Restormer RGB | R MIT / externally hosted weights separate grant unverified [I] | U [I] | U / U; E 256 with 32 halo, attention context changes on tiles [I] | U / U [I] | U / U [I] | R PyTorch; E export/operator check [I] | R Gaussian and real-image variants, neither establishes HDR range; v2 U [I] | R CVPR 2022; pushed Oct 23 2025 [metadata] |
| SCUNet | R Apache-2.0 / distinct external-weight grant unverified [J] | U [J] | U / U; E 256, 32 halo, align Swin windows [J] | U / U [J] | U / U [J] | R PyTorch; E ONNX qualification [J] | R synthetic mixed noise/display restoration, no HDR guarantee; choose PSNR not GAN checkpoint for fidelity; v2 U [J] | R published 2023; upstream pushed Dec 15 2023 [metadata] |
| FFDNet | R no explicit root licence found / unverified; hold redistribution [K] | U [K] | U / U; E 512, 32 halo [K] | U / U [K] | U / U [K] | R Matlab reference, KAIR PyTorch linked; E export [K] | R Gaussian noise-map input useful; requires calibrated per-photo variance, not HDR trained; v2 U [K] | R TIP 2018; original repo pushed Oct 9 2021 [metadata] |
| DnCNN | R no explicit root licence found / unverified; hold redistribution [L] | U [L] | U / U; E 512, 32 halo [L] | U / U [L] | U / U [L] | R Matlab/KAIR; E ONNX [L] | R Gaussian residual model; signal-dependent/correlated photo noise mismatch; v2 U [L] | R TIP 2017; original repo pushed Oct 9 2021 [metadata] |
| AdaIR / BioIR | R MIT code / checkpoint-specific grant unverified [N] | U [N] | U / U; E 256, 32 halo initially [N] | U / U [N] | U / U [N] | R PyTorch; E ONNX export and spectral/operator checks [N] | R multi-degradation restoration; no ACEScg evidence, risk of unwanted corrections; v2 U [N] | R AdaIR ICLR 2025, BioIR release Dec 23 2025 [N] |
| vkdt KPN / OIDN ecosystem | R inspect component and weights separately; no redistribution decision [O] | U [O] | U / U; not selected for prototype [O] | U / U [O] | U / U [O] | R KPN Vulkan cooperative matrices, OIDN-derived shaders [O] | R KPN camera RGB, proof of concept; OIDN module uses LDR render weights, not proof of photo quality; v2 U [O] | R March 2026 KPN docs call it rough and NVIDIA-specific [O] |

Recommendation and pipeline

**Estimated recommendation:** proceed only with a small RawNIND linear provider spike. It is the best concrete next experiment because published linear-domain training, permissive weight redistribution and an existing ONNX export remove three avoidable obstacles [A–C]. This advances the August watch's general recommendation to an actual downloadable candidate and measured CPU route. It does not establish superiority across photos or approve shipment.

**Read:** current implementation is `adaptive-atrous-v1`, not merely the historical compact Haar design (`codebase/backend/hdr_finisher/denoise_adaptive.py:43,177,216,242,529`). Several older paragraphs in the pipeline/v2 docs still describe absent denoise or historical Haar stages. Use current code and dated acceptance notes, not those stale summaries, for baseline comparisons. `AdaptiveControls` at line 104 defines the current live semantics.

**Estimated integration:** linear path runs once, explicitly, before geometry and creative grade: ACEScg -> linear Rec.2020 -> RawNIND -> inverse conversion. Existing matrix functions are `color.py:173,181`. Preserve original pixels and alpha. Cache a native corrected-source artifact, then derive ordinary proxies and permit v2 as a complementary residual cleanup. Do not pretend a blend with one neural residual implements all v2 luminance/chroma/detail controls. Model choice/noise domain/quality changes require explicit preparation; Exposure/Color/Film edits must never rerun it.

Cache identity must include source content/recipe, model hash, adapter version, colour transform, gain policy, tile/halo policy and inference precision. Store on disk within managed Library quota, stream tiles, and retain only active proxies/worker buffers. Denoise analysis caches downstream need the corrected-source identity. No inference per local layer. Publish atomically only if photo/revision still current; cancel between tiles.

**Estimated RAW alternative:** hook after LibRaw unpack and sensor black/white calibration, before AHD demosaic (`raw_import.py:226–255`). Packed RGGB inference replaces AHD, not the camera matrix, highlight reconstruction, DNG corrections or lens processing. Its output is camera RGB [B]. Preserve per-channel black levels, CFA orientation, crop and white balance ordering. X-Trans requires a different model or the post-demosaic linear path. RGB TIFF/EXR imports cannot recover a Bayer mosaic. This needs separate RAW acceptance and is not the first implementation.

**Estimated fallback:** one admitted GPU try; invalid output, unsupported graph, allocation/compile/range failure -> release GPU/session resources and run the same model on CPU. Only external transient contention/device restart may justify retry under the repository rule. If CPU exceeds the user's allowed wait, retain original/v2 and offer explicit later preparation; do not silently substitute a different neural model or repeatedly reduce quality.

HDR, tiling and noise

**Read:** RawNIND linear expects linear Rec.2020 and arbitrary output gain [B,C]. The demo permits negative gain matching. Our crop required approximately -3.17e-10; raw graph magnitude/sign cannot be treated as physical scene light. Gain matching fixes a scalar, not hue errors or reconstructed detail. A black image or near-zero signed mean needs a validated bypass, not division by noise.

**Estimated:** do not clamp ACEScg to [0,1], apply sRGB gamma, or normalise each tile independently. Test frame-global exposure scaling/inversion and preserve negative finite channels. Exposure probes at gains 1/64, 64 and 4096 remained finite. After undoing exposure and global gain matching, relative RMS versus gain 1 was 7.96%, 1.02% and 1.08% respectively. Command: `codebase/.venv/Scripts/python.exe scratch/exposure.py`, same crop/session settings as the ledger. These are descriptive domain-sensitivity measurements, not an HDR acceptance pass. Broad-range EXR and negative-channel inputs remain unqualified. Bypass out-of-domain inputs until tested. For sRGB checkpoints, division by peak does not repair training-domain mismatch. A calibrated Poisson-Gaussian variance-stabilising adapter may help FFDNet/DnCNN, but inverse-transform bias, negative samples and demosaic covariance require retraining/validation. Blind SIDD models lack a calibrated ISO/shot-noise control; blend strength is not noise calibration [G–L].

**Read/estimated:** use RawNIND's 512 input, 64-pixel halo and 384 core, one global output-gain match after stitching [C]. At 6000x4000 this needs 16x11=176 tiles; 60 MP roughly 2.5 times the core count. Bayer has half-size packed dimensions. Unlike v2 Haar's old exact tiling claim, CNN/attention seams are not proved absent by choosing overlap. Test shifted tile grids, borders, flat gradients, stars and repeated textures; increase halo only with evidence. Do not average differently gain-matched tiles.

Memory and packaging

**Estimated arithmetic:** float32 RGB source plus result costs 576 MB at 24 MP and 1.44 GB at 60 MP, before padded input, model arenas, decode and UI. One 512-square 32-channel FP32 activation is 33.55 MB; multiple live activations/workspaces dominate weights. Full-frame inference is inappropriate. Worker RSS is not whole-app compliance.

**Read:** `memory-and-caches.md:495` allows default 4 GB planning ceiling, 4.4 GB transient peak, <3.4 GB settled and physical reserve max(2 GB,10% RAM). Lines 766–767 specify Automatic VRAM at half dedicated memory. Steve's RTX 4070 Ti reports 12,282 MiB: about 6 GiB is the shared automatic budget, not all available to inference. The table's provisional reservations must be replaced by profiled provider peaks and admission alongside renderer allocations; otherwise refuse work.

**Read/estimated:** ORT supports CPU, DirectML, CoreML and CUDA [P]. Package exactly one selected platform runtime with the PyInstaller backend, including native provider libraries and notices, outside Electron ASAR. Electron sends job/progress/cancellation IPC; WebGPU grading remains separate. ONNX export existence does not guarantee every operator is GPU-assigned. Profile provider partitioning and count CPU-fallback nodes.

Windows: DirectML avoids shipping CUDA/cuDNN; disable memory pattern optimisation and use sequential execution per provider requirements [P]. Optional CUDA needs compatible runtime/cuDNN distribution and substantially more storage; not recommended for first download. macOS arm64: official ORT wheel includes CoreML; static shapes and cached compilation should be evaluated separately from warm inference [P]. Linux: CPU is the portable baseline; CUDA is NVIDIA-specific, DirectML and CoreML are unavailable. Flatpak must bundle pinned offline ORT dependencies and compatible GPU extensions if added; DRI permission alone does not make CUDA work. Existing packaging uses bundled Python 3.12 and offline manifests (`packaging/flatpak/README.md:3,14`).

**Measured:** CPU ORT 1.31.1 wheel 14.9 MB / installed target 47.916 MB; DirectML 1.24.4 wheel 25.1 MB / installed target 74.408 MB (no dependency installs). RawNIND combined archive 57,700,134 bytes / two ONNX files total 62,110,248 bytes. First-provider addition therefore roughly 80–110 MB installed including one model, excluding duplicated dependencies, signing and installer compression. Mac/Linux package sizes and CUDA size are U; do not quote these Windows sizes as cross-platform measurements.

Quality and competitors

**Measured visual observation:** `b1-crop.png` is original / current v2 / RawNIND linear, left to right. It shows a centre 512-square crop of DSC07187.ARW, reduced to 384 high, with identical display conversion: 4x exposure, Reinhard x/(1+x), then sRGB. RawNIND removes more fine dark-shirt noise; v2 retains more fine variation. This is one subject, no clean target, and the rawpy development differs from production import. It cannot prove fabric fidelity, colour accuracy, or a product win. No claim of camera ISO was made because metadata was not extracted.

**Read:** RawNIND's June 20 2025 paper Table III compares Bayer/linear models with developed-image U-Net and BM3D, not HDR Finisher, Lightroom or DxO [Q]. Neither SIDD PSNR nor that MS-SSIM table ranks proprietary applications. No reproducible matched-corpus direct comparison to DeepPRIME/XD or Lightroom was established here. DxO describes joint RAW denoise/demosaic; Adobe documents its own Enhance workflow [R]. Those sources explain workflow, not independent superiority. Do not repeat marketing stop-gain claims as measured quality.

First step, risks, tolerances and open questions

**Estimated first step:** pin RawNIND linear model hash and reproduce two native-photo full-resolution jobs in an isolated worker with end-to-end timing, whole-app memory and locked GPU profiling. Add exposure/gamut synthetic probes before UI work. Stop if corrected-source quality or whole-app budgets fail. Do not start training a new network first.

**Estimated risks:** hue/mean drift despite gain matching; arbitrary HDR/negative domain; lost real texture; tile-dependent pooling; repeated scene detail; provider fragmentation; CPU wait; duplicate source caches; model provenance; source recipe invalidation. Restrict downloaded models to reviewed hashes, deterministic ONNX graphs and removable offline cache. Non-commercial/research-only weights remain excluded even in a free GPL app; unverified terms mean hold redistribution, not assume permission.

Proposed acceptance tolerances for subsequent measurements (these exploratory runs are descriptive, not passes):

- End-to-end GPU route >=2x CPU, with 10% timing tolerance across three alternating runs: honours the whole-wait speed rule and shared-PC variance.
- Default whole app <=4.4 GB peak and <3.4 GB settled; existing VRAM admission and physical reserve unchanged: these are product limits, not worker targets.
- CPU/GPU and tiled/shifted-grid finished SDR Delta E 2000 / HDR Delta E ITP mean <1, p99 <3; no hard colour maximum: align with v2 perceptual contract; inspect seams separately.
- Off/source bypass exact; alpha exact; finite output required; delivery highlight target exact within encoder rounding: preserves established contracts.
- Exposure-normalised output should meet the same perceptual mean/p99 limits over +/-6 stops on controlled ramps and representative photos: global gain matching already forces mean agreement, so a mean-only test would miss changed detail.
- Quality: blind paired review across skin, hair, stars, text, fabric and coloured lighting; no invented detail accepted. A numeric denoise score alone cannot settle fidelity.

Open questions: acceptable 24/60 MP preparation wait on CPU? Which Mac and memory size? Does the global gain adapter preserve saturated/negative images? Can native-image inference plus source caching fit while Library is active? Can Linux acceleration be supported without CUDA distribution? Can model-specific gains and grain recovery be expressed without confusing v2 controls? Weight grants for all non-RawNIND candidates need an artifact-specific provenance check before redistribution.

Run ledger and evidence links

**Measured:** Ryzen 5 7600 6-core; NVIDIA RTX 4070 Ti 12,282 MiB (`Get-CimInstance Win32_Processor`, `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader`). CPU trial used ORT 1.31.1, six intra-op threads. `codebase/.venv/Scripts/python.exe scratch/tiled.py`: rawpy linear Rec.2020 development; repeat centre crop to 6000x4000; 512 input / 64 halo / batch one; 176 sequential tiles, one frame-global mean correction. Setup/decode/session 1.319 s; tiled inference/stitch/gain 48.282 s; sampled worker RSS 1,128,292,352 bytes at 20 ms. Allocation of the synthetic input preceded the timed loop. This is not a complete import-to-screen timing, not a native 24 MP quality trial, and not a statistically stable benchmark. v2 crop measurement+resolve 1.637 s; do not scale that to full-frame or compare it with neural inference alone. Mac estimates assume 0.5–2x this CPU throughput plus overhead; no applicable published exact-model Mac timing was found, so confidence is low. Other architectures' timing remains unknown rather than invented.

Model archive SHA256 `d71b5f1e727c85a359e6f74dca9e2016c9d8fc3e2f7ac3e9b347d80ceca969af`; linear ONNX SHA256 `df957efadcc152c007d5d3b0917bdff9e41c0d4a0efe56584ef30b36393cd181`. Scratch scripts, downloaded models, runtimes and caches are removed after investigation; no shared dependency installation modified. Only report and 656,561-byte crop retained. Main-checkout test photo was read without modification because this worktree's test-photo directory was absent.

Primary sources (all accessed 2026-11-13):

[A] [RawNIND source and dual weights licence](https://github.com/trougnouf/rawnind_jddc).
[B] [RawNIND export contract](https://github.com/darktable-org/darktable-ai/blob/master/models/rawdenoise-nind/README.md).
[C] [Inference/gain/tiling reference](https://github.com/darktable-org/darktable-ai/blob/master/models/rawdenoise-nind/demo.py).
[D] [AIM 2025 RAW baseline](https://github.com/SonyResearch/AIM2025_Denoise_Challenge).
[E] [SID code and models](https://github.com/cchen156/Learning-to-See-in-the-Dark).
[F] [PNNP current release limitations](https://github.com/fenghansen/PNNP).
[G] [NAFNet](https://github.com/megvii-research/NAFNet), [code licence including BasicSR](https://github.com/megvii-research/NAFNet/blob/main/LICENSE).
[H] [NAFNet ONNX model card](https://github.com/darktable-org/darktable-ai/blob/master/models/denoise-nafnet/model.yaml).
[I] [Restormer](https://github.com/swz30/Restormer), [MIT licence](https://github.com/swz30/Restormer/blob/main/LICENSE.md).
[J] [SCUNet](https://github.com/cszn/SCUNet), [Apache licence](https://github.com/cszn/SCUNet/blob/main/LICENSE).
[K] [FFDNet original implementation](https://github.com/cszn/FFDNet).
[L] [DnCNN original implementation](https://github.com/cszn/DnCNN).
[N] [AdaIR](https://github.com/c-yn/AdaIR), [BioIR release](https://github.com/c-yn/BioIR).
[O] [vkdt KPN limitations](https://jo.dreggn.org/vkdt/src/pipe/modules/kpn/readme.html), [vkdt OIDN LDR weights](https://jo.dreggn.org/vkdt/src/pipe/modules/oidn/readme.html). No maintained turnkey ART/RawTherapee neural checkpoint was verified; absence of verification is not proof none exists.
[P] [ORT providers](https://onnxruntime.ai/docs/execution-providers/), [DirectML constraints](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html), [CoreML packaging](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html).
[Q] [RawNIND paper v2, June 20 2025](https://arxiv.org/html/2501.08924v2).
[R] [DxO DeepPRIME](https://www.dxo.com/en/technology/deepprime/), [Adobe Enhance](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/enhance-details.html).
Metadata: GitHub REST `GET /repos/{owner}/{repo}` provided pushed_at (activity proxy, not release date); [darktable-ai release-5.6.0](https://github.com/darktable-org/darktable-ai/releases/tag/release-5.6.0) supplied asset byte sizes and June 20 2026 publication date. No recent push proves ongoing maintenance or support.

Graphics minutes used: 0. No inference or Electron GPU run occurred. The first lock acquisition failed to spawn a relative Python path (WinError 2); the corrected absolute-path request remained queued behind a2-geometry-diagnostic and was cancelled. Thus no PC GPU timing/VRAM or GPU-to-CPU parity claim is available. Output size before/after: 0.0 GB / 0.0 GB reported by `tools/output_size.py` from codebase. Scratch deleted; retained review crop 656,561 bytes (<2 MB).
