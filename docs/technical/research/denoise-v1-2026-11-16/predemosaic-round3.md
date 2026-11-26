# Pre-demosaic Denoise, round 3 — November 20, 2026

**Keep Clean Grain.** The best split brings the Canon's grain close to DxO Standard's size without taking on its red skin or darkened shadows. It also cuts broad colour blotches below Clean Grain. But the small brightness grain is still easy to see, especially in the Sony hair and the ISO 10000 holdout. The holdout crop does not show convincing individual hair strands. This is a useful direction for research, not a replacement or a GPU timing candidate.

## What we tried

The same signed Bayer inputs, harsh-speck settings, highlight reconstruction, AHD demosaic and native coordinates as [round two](predemosaic-round2-wavelet-colour.md), using `IMG_0790.CR2` (ISO 3200), `_DSC7970.ARW` (ISO 6400), `DSC05622.ARW` (ISO 10000) and the `DSC01212.ARW` atrium (ISO 800). Off means HDR Finisher development with Denoise off; the RAW harsh-speck setting is the same in all our columns. DxO is the [aligned Canon TIFF comparison](dxo-comparison.md), not a Sony reference. No grain was generated, and no curve or black offset was applied.

1. **First, early brightness and the current late colour repair.** Kept the two green phases separate and used round two's fixed white-balanced opponent split and five local BayesShrink bands. Lightened or skipped the finest band, then ran the compact Clean Grain colour repair on demosaiced RGB. Swept late strength, a centre-preserving correction and the Large repair setting. Best near-target Canon point was 3.23/3.25 px, but the late repair alone left **24.0×/6.5×** Clean Grain's colour mottling in dark/floor. That repair is only the last part of Clean Grain.
2. **Keep the whole Clean Grain colour path, without its full brightness pass.** Reused the adaptive colour wavelets *and* the compact repair from Clean Grain. Used each photo's measured Off model and retuned colour strength on the Canon; the same multipliers went to the other photos. Preserved scene Y when reconstructing the RGB colour correction. At the same 3.23/3.25 px, mottling fell to **0.61×/0.61×** Clean Grain, but brightness noise still measured 91% of Off. A light post-demosaic brightness pass can bring that lower; raising it too far removes the fine grain first and pushes the size back up.
3. **Quiet coarse colour before demosaic and a second structure gate.** Used the packed brightness pilot to stop smoothing across edges. Smoothed only the already low-passed opponent planes with equal-and-opposite changes between each neighbouring pair; the removed variance does not change the sum of those planes before the RAW guard and quantization. A stronger tensor gate on a wider guide protected structure. Subtracted the local mean from the early brightness correction (13 packed cells), and from the two late colour corrections and the optional late brightness correction (65 developed pixels). Centring is not a guarantee that AHD or display mapping preserves any particular region's mean; we checked both separately.

The best compromise (`balance-0.7-L0.2-C0.7`) uses 0.70 internal early brightness strength with relative band weights 0.16/1.35/4.5/7/8, the wider structure gate, 0.70 early coarse colour, 1.20× Clean Grain's adaptive colour strength and its Small repair at 1×. Late brightness is 0.20×, with 42% of that pass's removal retained in its finest band. It was picked from the Canon sweep and checked unchanged on the other photos. Prototype padding is 80 native pixels for the early pass, 12 for demosaic, and 112 for the later stages. It uses bounded filters, but no GPU version, Grade integration or new app control was built. [Runner and receipts][output]

## Grain, mottling and tone

Grain size is the median-power wavelength at native resolution; adjacent correlation tells how much grain still shares a pattern with its next pixel. Mottling is opponent-colour RMS at 8–32 px, divided by Clean Grain's RMS in the same patch. Brightness shift is the signed scene mean against HDR Finisher Off. Off-RMS ratios below measure **how loud** the brightness grain is, not its size. The [DxO benchmark](dxo-comparison.md#spectral-fingerprint-of-dxo-standard) explains why its deep-shadow RMS is not a fair loudness comparison: the TIFF is much darker there. DxO noise values in this table are measured before the crop-view gain.

| Fixed Canon patch | Grain px: Off / Clean / DxO / R3 | Adjacent correlation: Off / Clean / DxO / R3 | Colour RMS vs Clean: DxO / R3 | Mean brightness change: Clean / DxO / R3 |
| --- | --- | --- | --- | --- |
| Dark background | 3.51 / 7.95 / 2.91 / **3.30** | .31 / .80 / .04 / **.23** | 0.04× / **0.28×** | −2.13% / −94.51% / **−0.99%** |
| Floor | 3.62 / 8.43 / 3.04 / **3.39** | .33 / .82 / .10 / **.25** | 1.41× / **0.27×** | +0.17% / +0.14% / **−0.04%** |
| Second dark patch | 3.56 / 7.94 / 3.01 / **3.30** | .31 / .80 / .05 / **.23** | 0.05× / **0.23×** | +0.05% / −95.50% / **−0.74%** |

- **Size is close, not a DxO match.** Round 3 improves on round 2's 3.9–4.2 px and .42–.47 correlation, but DxO Standard still has less clumping. Sony portrait and ISO 10000 holdout are 3.36–3.41 and 3.50–3.59 px, respectively.
- **Mottling and tone hold up on the Sony files.** Portrait colour mottling is 0.21–0.68× Clean Grain across its four flats; holdout is 0.69–0.90× across three. Mean brightness changes by at most 0.09% across these seven flats.
- **Brightness grain stays loud.** Canon dark/floor RMS is 72%/74% of Off, versus 32%/35% for Clean Grain. Sony portrait and holdout retain 71–74% and 71–72% of Off; Clean Grain retains about 6% in both sets of flats. The more aggressive coarse-colour/late-brightness trial reached 36%/38% of Off on Canon dark/floor, but darkened the main shadow 2.9% and dropped the shared 3 px hair score from .894 to .675. The finer size is not a like-for-like win in noise strength.

## Colour and recognizable detail

For the rendition check we smoothed signed scene RGB at σ=6 px, applied the same fixed SDR view, trimmed the 18 px filter border, averaged linear display RGB and compared the Lab means with CIEDE2000. The skin sample is the forehead inside the full face crop, at `[2492,1088,2562,1136)` in the unrotated sensor. The DxO columns use the same per-crop two-Off brightness alignment as the TIFF study (the skin sample inherits the face gain). This is a rendition check, not a measure of every pixel's colour.

| Mean ΔE 2000 vs HDR Finisher Off | Face | Skin | Skirt | Flame |
| --- | ---: | ---: | ---: | ---: |
| Clean Grain | 0.054 | 0.035 | 0.049 | 0.258 |
| DxO Standard | 6.885 | 6.948 | 5.736 | 12.271 |
| **Round 3** | **0.023** | **0.251** | **0.109** | **0.063** |

Round 3 kept mean hue within 0.26° and absolute Lab chroma change within 0.31 across the four regions. Averaging *after* mapping the unsmoothed noisy pixels is a different, useful sensitivity check: it gives ΔE 1.15 in the face and 2.12 in the skirt. The display's handling of near-black, textured pixels is nonlinear; those differences are not a shift of the smoothed scene colour. See the [face and skin][face] and [skirt][skirt] at 1:1.

For recognizable Canon structure, the first numbers are the projection onto strong edges shared by both Off developments after smoothing at σ=3/6 px. The two right columns give relative retention on the same probe. Noise can inflate the older fine-band projection against each method's own Off; it is recorded separately in the receipts and does not settle whether a strand is visible.

| Canon | Clean Grain, 3/6 px | DxO Standard, 3/6 px | Round 3, 3/6 px | R3 / Clean, 3/6 px | R3 / DxO, 3/6 px |
| --- | --- | --- | --- | --- | --- |
| Face | .965 / .987 | .881 / .948 | .976 / .985 | 1.01× / 1.00× | 1.11× / 1.04× |
| Hair | .901 / .940 | .734 / .769 | .894 / .918 | .99× / .98× | 1.22× / 1.19× |
| Skirt | .907 / .950 | .861 / .946 | .978 / .984 | 1.08× / 1.04× | 1.14× / 1.04× |

Canon face edges and skirt weave remain, and Sony lashes are visibly distinct. The Sony hair has directional strands, but they compete with dense fine brightness grain. The ISO 10000 hair is still hard to read. Its fine projection is .597 versus Clean Grain's .042 (14.29×), a large number that does **not** show that there are clear strands. Sony lashes and hair projections are 2.27× and 9.73× Clean Grain's; there is no DxO Sony TIFF. [Canon hair][hair] · [Sony hair][sony-hair] · [Sony lashes][lashes] · [ISO 10000 hair][holdout]

## Marks and lights

Use the prior comparison's fixed mark centres and a count of sites whose colour distance or dark pit depth exceeds twice their **own result's** surrounding grain. Count categories separately; a site can be in both. No strict zero-worse rule.

| Fixed marks | Method | Colour / pit | Unique visible sites |
| --- | --- | --- | ---: |
| Canon, 38 | Clean Grain | 14 / 10 | 14 |
| Canon, 38 | DxO Standard | 8 / 2 | 8 |
| Canon, 38 | **Round 3** | **9 / 4** | **10** |
| Sony, 25 | Clean Grain | 2 / 3 | 5 |
| Sony, 25 | **Round 3** | **0 / 2** | **2** |

On the Canon, Round 3 adds three colour and three pit crossings compared with Clean Grain, and four colour and two pit crossings compared with DxO Standard. The `(938,1740)` flame-area pit crosses against Clean Grain and stays visible against DxO. More fine grain can hide marks, so the reduced counts are not evidence of equivalent speck repair. Per-site numbers and coordinates are in the [Canon receipt][canon] and [Sony receipt][sony].

In the [atrium strip][atrium-crop], Round 3 kept all three brightest pixels at their exact Off positions. The light centre is the brightness-weighted position within a 5 px radius; peak contrast is the brightest pixel minus the mean of the surrounding ring.

| Atrium light | Centre movement, Clean / R3 | Peak contrast change, Clean / R3 | Total light above its surround, R3 |
| --- | ---: | ---: | ---: |
| Blue light on pole | 0.042 / **0.015 px** | +2.33% / **−1.49%** | −3.92% |
| Railing lamp | 0.009 / **<0.001 px** | −0.43% / **−0.01%** | <0.01% change |
| Light beside pole | 0.017 / **0.005 px** | +0.11% / **−0.13%** | 0.63% change |

Peak contrast and centres meet the 2% target, but the blue light's broader glow did not. Its core also shifted colour: the largest change in a mean RGB channel relative to Off was 24.75%, versus 23.43% for Clean Grain. A wider highlight guard kept all three lights identical to Off on these measurements. On the Canon it left the flat results unchanged at report precision but raised visible marks from 10 to 12 unique sites (10 colour/4 pits, with overlap). Keep it as a follow-up, not a swap for the tested candidate. [Atrium receipt][atrium] · [Wider guard on atrium][atrium-guard] · [Wider guard on Canon][canon-guard]

## Verification and memory

All full-frame RAW stages and both TIFF reads used the shared lock. One photo at a time: reused prepared Bayer, developed the Off frame in 256-row bands to a temporary float32 file for the exact app fit, saved only padded sensor windows and RGB crops as `.npy`, then released the frame. The TIFF reader mapped a file at a time and saved only aligned windows. The three primary Canon zero-strength crops reproduce Off; Off/Clean flat metrics and mark scores reproduce the earlier harness, and the DxO wavelengths and mark counts reproduce the aligned TIFF receipt. The [final verifier][verified] checked 18 native PNGs, the neutral inverse direction and overlapping tile cores on four photos (maximum absolute channel error `2.2e-08`). Focused Python checks: **23 passed**; no full Python or Node suites.

On the 8 GB MacBook Neo, the **highest recorded Python peak was 1,448.4 MiB (1.52 GB)** in the ISO 10000 staging process. That exceeded the harness's 1,430 MiB stop guard by 18 MiB after the crop data and reference checks had completed. We kept the valid crops, did not redevelop that RAW and changed the fit reader to reopen bounded windows rather than retain the mapped frame. Sony portrait peaked at 1,197.9 MiB; atrium with the bounded reader at 1,185.8 MiB; TIFF at 177.3 MiB; candidate screens at up to 733.2 MiB; focused tests at 620.2 MiB. Canon finished crop staging and the reference checks before a JSON serialization error prevented its RSS log; recovered metadata from the prior receipt and existing crops without another RAW development. Those are measured separately, not a whole-app memory budget or a claimed peak for the unmeasured Canon step. [Staging and tests][output]

## Native crops and reproduction

Every image column is at 1:1: HDR Finisher Off, Clean Grain, DxO Standard where available, and Round 3. Same per-crop display transforms as the prior study, including the recorded DxO gain. Open the [review gallery][review], or go straight to [dark background][dark], [floor][floor], [face and skin][face], [forehead patch][skin], [flame][flame], [skirt][skirt], [Canon hair][hair], [Sony hair][sony-hair], [Sony lashes][lashes], [holdout hair][holdout] and [atrium lights][atrium-crop].

Run `sh output/predemosaic-round3-2026-11-20/reproduce.sh` from `codebase`. It uses the existing round-one, round-two and TIFF harnesses, serializes RAW/TIFF staging with `tools/gpu-run-lock.py`, and deletes the temporary arrays it creates. It writes the `*-final.json` receipts and native strips; use `--reuse-crops` if the staging cache already exists. The five sweeps (`first`, `adaptive`, `coarse`, `refine`, `balance`) are available in `trial.py` and are saved as `sweep-*.json`; they require the staged crops. [All local evidence][output]

## For Steve

- **Grain:** 3.30 px in the dark and 3.39 px on the floor, down from Clean Grain's 7.95/8.43 and near DxO's 2.91/3.04. Clumping fell from .80/.82 to .23/.25, but brightness grain is more than twice as loud as Clean Grain on those Canon patches.
- **Colour:** face/skin/skirt/flame are 0.02/0.25/0.11/0.06 ΔE from our Off on smoothed colour, all below 1. [Look at the face][face] and [forehead][skin].
- **Colour blotches:** 28% of Clean Grain in the Canon dark and 27% on the floor; still below Clean Grain in the Sony and high-ISO test flats.
- **Detail:** the Canon hair's recognizable structure is 19–22% above DxO Standard and within 1–2% of Clean Grain. [Sony lashes][lashes] are clear, but [Sony hair][sony-hair] has lots of fine grain and [ISO 10000 hair][holdout] is hard to see.
- **Tone:** dark and floor brightness changed by −0.99% and −0.04%. No automatic darkening or curve.
- **Marks and lights:** 9 colour marks and 4 pits stand out on Canon, versus 14/10 for Clean Grain and 8/2 for DxO Standard. Sony is 0/2 versus Clean Grain's 2/3. All three [atrium lights][atrium-crop] stayed in place, with peak contrast changing by at most 1.49%. The blue glow still lost 3.92% overall.
- **Recommendation:** keep Clean Grain. Next try reducing brightness grain only in reliably quiet areas without disturbing its fine size or flattening hair. No GPU timing this round: the photos did not qualify at 1:1.

[output]: ../../../../codebase/output/predemosaic-round3-2026-11-20/
[review]: ../../../../codebase/output/predemosaic-round3-2026-11-20/review.html
[canon]: ../../../../codebase/output/predemosaic-round3-2026-11-20/canon-final.json
[sony]: ../../../../codebase/output/predemosaic-round3-2026-11-20/sony-final.json
[atrium]: ../../../../codebase/output/predemosaic-round3-2026-11-20/atrium-final.json
[atrium-guard]: ../../../../codebase/output/predemosaic-round3-2026-11-20/atrium-guard.json
[canon-guard]: ../../../../codebase/output/predemosaic-round3-2026-11-20/canon-guard.json
[verified]: ../../../../codebase/output/predemosaic-round3-2026-11-20/verify-final.log
[dark]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/canon-dark-flat.png
[floor]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/canon-floor.png
[face]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/canon-face.png
[skin]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/canon-skin-patch.png
[flame]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/canon-flame.png
[skirt]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/canon-skirt.png
[hair]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/canon-hair.png
[sony-hair]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/sony-hair.png
[lashes]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/sony-lashes.png
[holdout]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/ordinary-hair.png
[atrium-crop]: ../../../../codebase/output/predemosaic-round3-2026-11-20/crops/atrium-blue-pole-light.png
