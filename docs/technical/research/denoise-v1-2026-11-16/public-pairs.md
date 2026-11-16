# Public RAW ground-truth pairs — November 16, 2026

RawNIND provides genuinely open camera noisy/clean pairs; an explicit CC0 subset is selected.
The download is 43 RAW files, 12 scenes and five cameras, totalling 1.170 GB.
Five downloaded scenes are documented held-out; four survive screening, alongside seven **seen by RawNIND** scenes.
The scored set is 52 aligned crops, four cameras and ISO 1600/3200/6400; all higher-ISO candidates are excluded, not passed.
Current default improves scene-balanced SDR PSNR from 28.72 to 34.13 dB; tuning adds little overall and trades detail. No shipping change is approved.

## Scope and licence survey

Steve approved Q2 on November 16: CC0, CC-BY or CC-BY-SA data only, with no
non-commercial/research-only restriction. CPU-only, offline **evaluation** of
the explicitly downloaded subset; no Electron, WebGPU, model installation or
automatic test download. Neither GPL app licensing nor an open-source code
licence proves that a separately hosted photographic dataset is open.

| Dataset | Verified licence / exact source | In / out | Reason |
| --- | --- | --- | --- |
| NIND, Wikimedia Commons | [Dataset page](https://commons.wikimedia.org/wiki/Natural_Image_Noise_Dataset); each **file description**, not the site's footer, supplies the image's licence | Out as direct RAW input; provenance for RawNIND | Commons set is developed JPEG/PNG ISO series. Not interchangeable with native sensor pairs. Per-file CC0/BY/SA is usable only after checking each file; no blanket Commons licence inferred. |
| RawNIND v1.0 | [Dataverse version metadata](https://dataverse.uclouvain.be/api/datasets/:persistentId/versions/1.0?persistentId=doi:10.14428/DVN/DEQCIM), `data.license`: CC-BY-SA-4.0; [permissions.txt, file 11614](https://dataverse.uclouvain.be/api/access/datafile/11614): scene-specific CC0 grants **and exceptions** | **In: explicit CC0 scenes only** | Several cameras, real high-/low-ISO RAW captures. The dataset-wide label is insufficient: the permissions file marks some depicted artwork fair-use/research-only (e.g. Anne Bonnet, Mig Quinet, Paul Delvaux and unnamed plaster). None is downloaded. No presumed licence for unlisted artwork. |
| SIDD | [Authors' dataset page, License](https://abdokamel.github.io/sidd/#license): explicitly MIT for **dataset and associated repositories** | Out of this CC-only subset; not NC | Real smartphone pairs, potentially a useful future independent set if Steve broadens Q2 to MIT. Do not falsely report it as non-commercial. No SIDD bytes used. |
| SID / Learning to See in the Dark | [Authors' README, License](https://github.com/cchen156/Learning-to-See-in-the-Dark#license): MIT; [repository licence](https://github.com/cchen156/Learning-to-See-in-the-Dark/blob/master/LICENSE) | Out of this subset | Not a CC0/BY/SA grant as requested. README's general MIT label is not an explicit per-file CC grant for the separately hosted Sony/Fuji RAWs. Mostly fixed high ISO with exposure-ratio pairs, rather than the desired ISO series. Not labelled NC without evidence. |
| ELD | [Authors' repository](https://github.com/Vandermode/ELD#eld-dataset), [MIT code licence](https://github.com/Vandermode/ELD/blob/master/LICENSE) | Out | Real DSLR low-light exposure-ratio pairs; no affirmative CC0/BY/SA data grant found. README says evaluation purposes and separately hosted data; MIT software text is not assumed to licence those RAWs. This is uncertainty, not a fabricated NC clause. |
| DND | [Official licence](https://noise.visinf.tu-darmstadt.de/license/), clauses 3–4 | **Out: non-commercial** | Explicit commercial-use prohibition and no dataset/modified-dataset redistribution; clean references also not provided as ordinary downloadable pairs. |
| LRID | [Author's dataset card](https://huggingface.co/datasets/hansen97/LRID/blob/main/README.md), YAML `license: cc-by-nc-4.0`; linked from [author's PNNP repository](https://github.com/fenghansen/PNNP) | **Out: non-commercial** | Explicit NC. No download. |
| Sony / AIM 2025 RAW denoising challenge | [Sony starter-kit README](https://github.com/SonyResearch/AIM2025_Denoise_Challenge), [MIT software licence](https://github.com/SonyResearch/AIM2025_Denoise_Challenge/blob/main/LICENSE), [official challenge page](https://sonyresearch.github.io/AIM2025_Denoise_Challenge/) | Out | Starter code is MIT, not an affirmative CC photo-data grant. Benchmark includes noisy inputs and hidden challenge ground truth; it is not a locally available openly licensed clean-pair set established by those sources. No challenge data downloaded. |
| MIT–Adobe FiveK | [Official project](https://data.csail.mit.edu/graphics/fivek/), [Adobe/MIT image licence](https://data.csail.mit.edu/graphics/fivek/legal/LicenseAdobeMIT.txt), clause 1 | **Out: research-only; also not pairs** | Retouch variants of single RAWs, not noisy/clean sensor sequences. The actual image RESEARCH LICENSE restricts commercial advantage; “MIT” in the dataset name is not an MIT software licence. |

Sources checked November 16, 2026. Dataset descriptions are evidence, never
instructions to execute downloaded code. Only the selected RAW payloads and
small text metadata were retrieved. No archive/script/model from these
datasets was executed. The chosen subset is research input only, not a new
shipping dependency or a change to the frozen 50-photo corpus.

## Selected subset and contamination

The committed [manifest](../../../../codebase/tools/denoise_eval/datasets/rawnind-manifest.json)
records every filename, numeric Dataverse file URL and individual DOI, byte
size, SHA-256, upstream MD5/SHA-1, exact permission line/URL, photographer,
camera, ISO, shutter, aperture, focal length and split label. Each download
was checked against **both** upstream MD5 and filename SHA-1 before its
SHA-256 was sealed. The downloader thereafter requires that pinned SHA-256.
Source-text hashes pin `permissions.txt`, `dataset.yaml` and the model's
standard test-reserve configuration without committing any photograph.

The [paper, arXiv:2501.08924v1](https://arxiv.org/html/2501.08924v1), sections
III-A/IV, documents static paired capture and the dataset/evaluation design.
The actual scene names come from the authors' [standard test-reserve file at
e80fb7b14dc440bba38c01f312fd3cc02deb566c](https://github.com/trougnouf/rawnind_jddc/blob/e80fb7b14dc440bba38c01f312fd3cc02deb566c/src/rawnind/config/test_reserve_std.yaml).
All five chosen held-out scenes occur there, with `TEST_` filenames and
`test_reserve: true` in [Dataverse dataset.yaml, file 30027](https://dataverse.uclouvain.be/api/access/datafile/30027).
The other seven are conservatively **seen by RawNIND**. The older
`test_reserve.yaml` distributed as Dataverse file 11616 lists a different,
legacy NIND split; it is **not** substituted for the pinned RawNIND model's
standard split. Documentary held-out status is not independent forensic
verification of the unpublished checkpoint training run.

| Scene | Camera | Clean ISO → selected noisy ISOs | RawNIND contamination | Photographer / exact CC0 permission key |
| --- | --- | --- | --- | --- |
| TEST_7D-2 | Canon EOS 7D | 100 → 1600, 6400, 12800 | Documented held-out | Peter Wemmert / `7D-2` |
| TEST_D60-1 | Canon EOS D60 | 100 → 1037.47 | Documented held-out | Peter Wemmert / `D60-1` |
| TEST_MuseeL-Saint-Pierre-C500D | Canon EOS 500D | 100 → 1600, 3200 | Documented held-out | Benoit Brummer / `MuseeL-Saint-Pierre-C500D` |
| TEST_Pen-pile | Panasonic DMC-GH1 | 100 → 1600, 3200 | Documented held-out | Matti Blume / `Pen-pile` |
| TEST_Vaxt-i-trad | Canon EOS 6D | 100 → 1600, 6400, 102400 | Documented held-out | Peter Wemmert / `Vaxt-i-trad` |
| 7D-1 | Canon EOS 7D | 100 → 1600, 6400, 12800 | **Seen by RawNIND** | Peter Wemmert / `7D-1` |
| 7D-3 | Canon EOS 7D | 100 → 1600, 6400, 12800 | **Seen by RawNIND** | Peter Wemmert / `7D-3` |
| Bark | Canon EOS 6D | 100 → 1600, 6400, 102400 | **Seen by RawNIND** | Peter Wemmert / `Bark` |
| Blombukett | Canon EOS 6D | 100 → 1600, 6400, 102400 | **Seen by RawNIND** | Peter Wemmert / `Blombukett` |
| Kortlek | Canon EOS 6D | 100 → 1600, 6400, 102400 | **Seen by RawNIND** | Peter Wemmert / `Kortlek` |
| Spydercheckr | Canon EOS 6D | 100 → 1600, 6400, 102400 | **Seen by RawNIND** | Peter Wemmert / `Spydercheckr` |
| MuseeL-cross-C500D | Canon EOS 500D | 100 → 1600, 3200 | **Seen by RawNIND** | Benoit Brummer / `MuseeL-cross-C500D` |

There are 31 candidate capture pairs and six noisy ISO values. D60 is an
explicit older-camera exception below ISO 1600 and has only one selected
noisy frame; it must not be reported as high-ISO evidence. Its ISO is the
recorded 1037.4716, not an invented ISO 1600. Canon 6D filenames/standard
EXIF ISO saturate at **65535**: their authoritative
`RecommendedExposureIndex=102400`, independently matched by Canon `BaseISO`,
provides the real ISO. Both readings remain in the manifest.

These scenes supply leaves/bark, flowers, fine patterns/cards and text,
coloured pens/edges, a colour target and museum surfaces/shadows. No claim
is made that every deterministic crop contains fabric, skin, hair or a
particular edge target; accepted crop coverage and rejection counts follow
from registration and clipping, not from promising subject coverage first.

## Alignment, exposure and bounded memory

Policy was fixed before measurement, recorded in
`tools/denoise_eval/datasets/prepare.py` and `preparation.json`:

- One noisy/clean RAW pair is open at a time. Only nine 512px sensor windows
  become floats; full frames are neither developed nor copied. Four
  deterministic distinct windows per pair select flat, darkest, most
  textured and strongest-edge positions from the 3×3 grid of clean windows.
- Work in visible, black-subtracted, channel-white-normalised **pre-WB
  Bayer**, preserving both green positions and the camera's CFA. No artistic
  grade, geometry, lens correction or highlight reconstruction is added.
- Blurred green-plane phase correlation initialises translation-only ECC.
  At least three anchors must have ECC ≥.90; one sensor translation is the
  median. At most one anchor may deviate by more than 1 sensor pixel, and
  the shift cannot exceed 16 pixels per axis. This rejects non-rigid scenes
  rather than locally warping noise into alignment.
- Only the **clean** CFA planes are Lanczos4-resampled at half the sensor
  shift; noisy RAW remains untouched. One zero-offset least-squares gain
  per RGB channel uses unclipped anchor samples within .005–.85, with
  a four-MAD residual trim and at least 1024 samples. Both greens share the
  green gain. This single capture-pair gain is held across all four crops;
  no candidate output or per-crop gain fit enters it.
- Reject local structure correlation below .97 or smoothed residual RMS
  above .12 of the reference's P95–P5 span (floor .01); require at least 20%
  usable pixels. These are **input-registration screens**, not relaxed or
  newly approved denoiser pass limits. Record every rejection.
- Exclude zero/white-clipped samples in either capture, gain-induced clean
  clipping, and a 40px support halo plus crop border. All PSNR, SSIM,
  ΔE2000/BT.2124 ΔE ITP, flat/texture/edge/bleed and method-noise measures
  use that shared valid mask. Filter support is excluded so adjacent clipped
  samples cannot silently enter the scoring neighbourhood.
- Develop both mosaics with the same existing in-memory-DNG/LibRaw AHD,
  as-shot WB and camera-to-ACEScg tail. Use the harness's unchanged SDR
  sRGB and HDR 203-nit-white/1000-nit-cap PQ comparison transforms.
  Edge sharpness uses a local gradient-energy ratio against clean,
  **not** MTF50. No real-photo halo/MTF pass is inferred without a slanted edge.

Limits: CPU only, one native thread, shared lock for each heavy command,
2.5 GB peak ceiling, watchdog abort threshold 2.3 GB to leave sampling
headroom, no more than 20 MB review. Camera/reference residual noise,
clean-only interpolation, gain-selection bias near black/clipping, and
reference-frame illumination changes remain limitations. In particular,
excluded deep shadows are missing evidence, not evidence of good denoising.

## Baseline results

### Actual coverage and exclusions

Of 31 candidate capture pairs, 27 pass the initial camera/registration step;
19 retain at least one crop. There are **52 scored 512×512 crops from 11
scenes/four cameras**, with **four held-out scenes / six captures / 19 crops**
and seven seen scenes / 13 captures / 33 crops. The scored noisy ISOs are
1600 (32 crops), 3200 (six), and 6400 (14). All references are ISO 100.

| Scene | Scored noisy ISO: crop count | Split |
| --- | --- | --- |
| TEST_7D-2 | 1600: 4 | Held-out |
| TEST_MuseeL-Saint-Pierre-C500D | 1600: 3; 3200: 1 | Held-out |
| TEST_Pen-pile | 3200: 3 | Held-out |
| TEST_Vaxt-i-trad | 1600: 4; 6400: 4 | Held-out |
| 7D-1 | 1600: 3 | Seen |
| 7D-3 | 1600: 1; 6400: 1 | Seen |
| Bark | 1600: 4; 6400: 4 | Seen |
| Blombukett | 1600: 4; 6400: 2 | Seen |
| Kortlek | 1600: 4; 6400: 2 | Seen |
| Spydercheckr | 1600: 3; 6400: 1 | Seen |
| MuseeL-cross-C500D | 1600: 2; 3200: 2 | Seen |

The D60 pair is rejected by the existing camera bridge's materially different
dual-green WB safeguard, not silently coerced. Pen-pile ISO 1600, Vaxt-i-trad
ISO 102400, and Bark ISO 102400 fail the one-pixel registration-consistency
screen. This can reflect uncertain high-noise registration; it does not prove
the scene moved. Among the remaining 108 proposed crops, 51 fail the
clipping/support-area screen and five fail local structure/illumination
agreement, leaving 52. All ISO 12800 and 102400 candidates consequently have
**no scored support**. No high-band result, deep-shadow performance claim,
five-camera quality claim, or whole-frame conclusion is extrapolated.

For the 27 registered pairs, fitted clean→noisy gains range R 0.696–1.103,
G 0.713–1.132, B 0.720–1.153. Clean-sampling translations range x −5.920…1.131
and y −0.237…8.837 sensor pixels. Retained crop valid fractions are
22.8–71.2%. The contact sheet was inspected at thumbnail scale: the retained
edges/objects align visually, with real foliage, patterns/text, coloured edges
and flat surfaces. It is not a native-pixel registration audit or evidence of
fabric/hair coverage. Machine-readable per-anchor, per-crop gains, masks and
rejection reasons are in `datasets/rawnind/pairs/preparation.json`; retained
crop metadata also travels with `pairs.json`.

### Weighting and interpretation

All methods use **identical crops and masks**. Tables use arithmetic crop
means within a capture, capture means within a scene/ISO band, then equal
scene means. This prevents cameras with more crops/ISOs dominating. The
all-ISO table separately balances captures within each scene; it is not an
average of the band rows. Low = selected ISO 1600/3200, 11 scenes / 13
captures / 38 crops. Mid = selected ISO 6400, six scenes / six captures / 14
crops. High (>12800) = unavailable; ISO 12800 also has no retained crop.

Every displayed measure has the full support count of its band; none is
missing in these retained crops. `summary.json` preserves per-measure counts.
Colour **p99 means the scene-balanced average of crop p99s**, not a pooled
99th percentile over all scene pixels. SDR differences are ΔE2000; HDR
differences are BT.2124 ΔE ITP on the existing fixed PQ presentation. Flat
residual and colour-bleed units are unit-range SDR display values. These are
descriptive baselines, **not passes against the brief's proposed quality
limits** or proof that the low-ISO reference is noiseless.

Tuned PSNR/sharp are the existing synthetic-trained selections, not refitted
on these pairs. Their nearest-ISO policy is unchanged. The “sharp” name means
it met the synthetic selection constraint, not that real-photo edge energy
is necessarily preserved. At the selected low ISOs the two settings coincide.

### SDR fidelity

| Band | Method | PSNR dB ↑ | SSIM ↑ | ΔE2000 mean ↓ | Crop p99 ↓ |
| --- | --- | ---: | ---: | ---: | ---: |
| Low | Off | 30.123 | 0.7163 | 5.440 | 15.302 |
| Low | Current default | 34.538 | 0.8668 | 3.222 | 10.185 |
| Low | Tuned PSNR | 34.540 | 0.8714 | 3.043 | 9.732 |
| Low | Tuned sharp | 34.540 | 0.8714 | 3.043 | 9.732 |
| Mid | Off | 27.666 | 0.5991 | 7.104 | 18.272 |
| Mid | Current default | 35.186 | 0.8884 | 3.186 | 10.095 |
| Mid | Tuned PSNR | 35.583 | 0.8982 | 2.823 | 9.228 |
| Mid | Tuned sharp | 35.868 | 0.9044 | 2.791 | 9.100 |

### HDR presentation fidelity

| Band | Method | PQ PSNR dB ↑ | SSIM ↑ | ΔE ITP mean ↓ | Crop p99 ↓ |
| --- | --- | ---: | ---: | ---: | ---: |
| Low | Off | 36.494 | 0.8695 | 12.577 | 39.964 |
| Low | Current default | 41.321 | 0.9536 | 7.193 | 23.844 |
| Low | Tuned PSNR | 41.223 | 0.9555 | 7.087 | 24.141 |
| Low | Tuned sharp | 41.223 | 0.9555 | 7.087 | 24.141 |
| Mid | Off | 35.220 | 0.8411 | 13.830 | 45.680 |
| Mid | Current default | 42.773 | 0.9687 | 6.149 | 20.793 |
| Mid | Tuned PSNR | 42.797 | 0.9691 | 5.947 | 21.140 |
| Mid | Tuned sharp | 43.161 | 0.9717 | 5.649 | 19.706 |

### Flat residual and removed-noise structure

Standard deviations are against clean; ratios divide by the same noisy
input's residual standard deviation. Lower residual can still hide smoothing.
Correlation is between removed magnitude and smoothed noisy edge strength;
Off's zero residual has correlation zero by definition.

| Band | Method | Luma std | Luma ratio | Chroma std | Chroma ratio | Method-noise edge correlation |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Low | Off | 0.01558 | 1.0000 | 0.03428 | 1.0000 | 0.0000 |
| Low | Current default | 0.00814 | 0.5435 | 0.01789 | 0.5306 | −0.0614 |
| Low | Tuned PSNR | 0.00727 | 0.4990 | 0.01538 | 0.4752 | 0.0147 |
| Low | Tuned sharp | 0.00727 | 0.4990 | 0.01538 | 0.4752 | 0.0147 |
| Mid | Off | 0.01992 | 1.0000 | 0.04187 | 1.0000 | 0.0000 |
| Mid | Current default | 0.00724 | 0.3623 | 0.01492 | 0.3578 | −0.0392 |
| Mid | Tuned PSNR | 0.00599 | 0.2989 | 0.01171 | 0.2848 | 0.0306 |
| Mid | Tuned sharp | 0.00716 | 0.3588 | 0.01179 | 0.2839 | −0.0280 |

### Texture, edge sharpness and colour bleed

Texture columns are band-energy ratios versus clean at Gaussian sigma pairs
(0.5,1), (1,2), (2,4), (4,8). Edge = local gradient-energy ratio versus clean,
not MTF50. Ratios near one are useful only alongside residual fidelity: Off's
noise inflates its fine-band/edge energy. Bleed is SDR chroma residual near
clean chromatic edges, not a fitted colour-edge displacement.

| Band | Method | Texture band ratios (fine → coarse) | Edge energy / clean | Bleed mean | Bleed crop p99 |
| --- | --- | --- | ---: | ---: | ---: |
| Low | Off | 4.311 / 1.755 / 1.221 / 1.062 | 1.345 | 0.04349 | 0.13793 |
| Low | Current default | 0.839 / 0.726 / 0.806 / 0.908 | 0.763 | 0.02696 | 0.09273 |
| Low | Tuned PSNR | 0.467 / 0.565 / 0.686 / 0.831 | 0.650 | 0.02769 | 0.09602 |
| Low | Tuned sharp | 0.467 / 0.565 / 0.686 / 0.831 | 0.650 | 0.02769 | 0.09602 |
| Mid | Off | 14.701 / 6.183 / 1.767 / 1.057 | 2.344 | 0.05163 | 0.16766 |
| Mid | Current default | 0.900 / 0.800 / 0.827 / 0.872 | 0.756 | 0.02412 | 0.08665 |
| Mid | Tuned PSNR | 0.303 / 0.453 / 0.640 / 0.786 | 0.611 | 0.02429 | 0.09406 |
| Mid | Tuned sharp | 0.979 / 0.763 / 0.797 / 0.870 | 0.762 | 0.02281 | 0.08778 |

### Contamination-separated all-ISO headlines

| Population | Method | SDR PSNR / SSIM | HDR PSNR / SSIM | Edge energy / clean |
| --- | --- | --- | --- | ---: |
| All 11 scenes | Off | 28.721 / 0.6594 | 35.289 / 0.8449 | 1.665 |
| All 11 scenes | Current default | 34.133 / 0.8621 | 41.202 / 0.9537 | 0.767 |
| All 11 scenes | Tuned PSNR | 34.411 / 0.8737 | 41.315 / 0.9576 | 0.642 |
| All 11 scenes | Tuned sharp | 34.489 / 0.8754 | 41.415 / 0.9583 | 0.683 |
| Held-out: 4 scenes, 19 crops | Off | 27.682 / 0.5887 | 33.316 / 0.7831 | 1.794 |
| Held-out: 4 scenes, 19 crops | Current default | 33.610 / 0.8356 | 40.466 / 0.9442 | 0.834 |
| Held-out: 4 scenes, 19 crops | Tuned PSNR | 34.830 / 0.8848 | 41.493 / 0.9638 | 0.715 |
| Held-out: 4 scenes, 19 crops | Tuned sharp | 34.779 / 0.8839 | 41.457 / 0.9635 | 0.737 |
| Seen: 7 scenes, 33 crops | Off | 29.315 / 0.6998 | 36.417 / 0.8802 | 1.590 |
| Seen: 7 scenes, 33 crops | Current default | 34.431 / 0.8772 | 41.622 / 0.9592 | 0.728 |
| Seen: 7 scenes, 33 crops | Tuned PSNR | 34.172 / 0.8674 | 41.214 / 0.9540 | 0.600 |
| Seen: 7 scenes, 33 crops | Tuned sharp | 34.323 / 0.8706 | 41.390 / 0.9553 | 0.652 |

Current default removes substantial real capture noise. Across all scenes,
the tuned improvements are only +0.278/+0.356 dB SDR PSNR over default, while
edge energy falls from 0.767 to 0.642/0.683. Held-out tuned PSNR gains
1.220 dB but edge energy falls 0.834→0.715. This is a noise/detail trade-off,
not a winning replacement. Different subjects/ISOs prevent interpreting the
held-out/seen score difference as a model generalisation experiment; no
RawNIND model was scored here at all. The coordinator can now run candidate
comparisons on these same pairs, retaining the split and exclusions.

### Resources, review and checks

MacBook Neo / A18 Pro / 8 GB, one native CPU thread, shared lock, app base
`045f5442`, committed pair tooling `20f2224a`; measurements include research preparation/output, **not** action
to a picture on screen. One descriptive run; ±10% timing noise allowance,
no shipping budget changed. Preparation took 39.44 s (40.18 s guarded wall),
0.367 GB sampled process-tree peak. Four-method baseline took 119.11 s
(120.05 s guarded wall), 0.588 GB OS/process-tree peak, **zero adapter
errors**. Download plus prepared pairs occupy 1.540 GB; the download itself
is 1.170 GB. The comparison review plus contact sheet stays below 10 MB
(20 MB limit). No full-frame derivative RAWs are copied per run.

Evidence under `codebase/output/denoise-v1/`: `datasets/prepare-guard.json`,
`datasets/rawnind/pairs/{pairs,preparation}.json`,
`public-pairs/{results-pairs,summary,baseline-guard}.json` and
`public-pairs/review/{index.html,contact.png}`. These outputs are ignored,
not committed; the sealed manifest and explicit downloader recreate inputs
on the PC. No GPU test applies to this CPU-only research harness.

Candidate compatibility only: the existing darktable-profiled adapter runs
once on one 96×96 retained Bayer-derived RGB crop, producing finite RGB with
**no fallback**, 0.036 s adapter time / 1.29 s guarded wall / 0.117 GB peak.
RawNIND's Bayer model and GALOSH's native binary are absent in this worktree,
so both are explicitly skipped: no download, installation, build or candidate
quality run. `public-pairs/{interface,interface-guard}.json` records this; the
helper is `datasets/smoke.py`. The bundles retain Bayer, WB, camera bridge and
noisy-only sensor fits for the coordinator's later candidate run.

Fast checks: Node **1091 passed, one skipped**; Python **3928 passed, 149
skipped, one xpassed**, no failures, guarded peak 2.062 GB; focused pair/
original-harness checks **20 passed**. Optional SciPy/Matplotlib availability
warnings are not changed. No unrelated failing test was found or repaired.

## Attribution and reproducibility

All 43 selected photographs have an explicit **CC0** scene grant in
[permissions.txt](https://dataverse.uclouvain.be/api/access/datafile/11614).
No CC-BY/CC-BY-SA photograph is used, so no BY/SA attribution list is
required for the selected pixels. Courtesy credits: **Peter Wemmert,
Benoit Brummer, Matti Blume**. Dataset publication: **Benoit Brummer and
Christophe De Vleeschouwer**, *Learning Joint Denoising, Demosaicing, and
Compression from the Raw Natural Image Noise Dataset*, arXiv:2501.08924,
January 15, 2025; dataset DOI **10.14428/DVN/DEQCIM**, v1.0.

Re-download and prepare/evaluate with the explicit isolated-Python,
shared-lock commands in the [harness README](../../../../codebase/tools/denoise_eval/README.md#public-raw-pairs-q2-approved-november-16-2026).
Nothing downloads automatically. RAWs and crop bundles remain ignored in
`codebase/output/denoise-v1/datasets/rawnind/`; measurements/review remain
under `codebase/output/denoise-v1/public-pairs/`. The usual `module:factory`
adapter interface works with the bundle's Bayer/ACEScg inputs; no production
code, noise-control defaults, acceptance tolerances or caches are changed.
