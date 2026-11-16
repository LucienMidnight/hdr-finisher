# AVIF / JPEG XL encoding drift and safe HC Peak — November 16, 2026

## Plain-language outcome

The failure is **not confined to JPEG Ultra HDR**. AVIF gain maps also turn
tiny, acceptable renderer differences into larger decoded differences. Direct
HDR JPEG XL passes the original sharp fixture, but fails on two of three
real-photo highlight crops. It has no gain map: lossy encoding itself can
amplify a small input difference. Repeating an identical input gives identical
decoded pixels for both codecs in every case.

The approved safety change sets the minimum Peak to **225 nits**, including
typed values, pasted/preset recipes and backend model validation. All three
formats encode/decode at that minimum, with both project whites and all four
HC modes. CPU/GPU export, full-size Proof byte identity, ordinary Proof, and
the focused two-size UI check pass. No encoder setting, output agreement gate
or tolerance was changed. Export PRD consolidation remains the coordinator's
job; this report does not modify that PRD.

## Scope and measurement contract

- MacBook Neo / A18 Pro / 8 GB; branch `feat/watermark-and-library-polish`;
  local and GitHub release both 0.9.3, branch not behind upstream or main at
  start. Status row committed separately as `c80ece64`.
- The October 18 contract remains HDR ΔE ITP / SDR ΔE00, mean <1 and
  P99.9 ≤3, separately per image/lane. The same numbers are a diagnostic
  screen for own-source fidelity, **not an approved new fidelity gate**.
- Identical finished GPU/CPU arrays from the existing matched sharp capture
  (`sharp-matched-floats.npz`); its mean/P99.9 agrees with commit `850f2e45`.
  Three additional **256×256 native-resolution crops**, not resized photos,
  select the strongest highlight edge above the source's 95th intensity
  percentile. This deliberately stresses small bright edges, not average
  whole-photo quality. It is not native-full-frame qualification.
- The three photographs match the approved SHA-256 manifest. Crop origins
  `(x,y)`: `DSC08883.avif` (3347,1441), `5M071612_finished.avif` (2,678),
  `LR-classic-hdr-source-test-1.avif` (4467,2811). Original dimensions are
  4000×2666, 1433×1920 and 5304×7952; crop peaks 999.29, 788.48 and
  1008.44 nits. They retain native sharp edges. Source AVIF encoding is
  already baked into the photographic input and is common to both renders.
- Crops are loaded once as interpreted ACEScg, with no resizing/sharpening,
  global 1000-nit Fixed cap, SDR exposure −0.15 and otherwise default creative
  controls. The original fixture retains its local-Match recipe. GPU arrays
  are captured at `HDRGpuDeliveryFinishing.read`; CPU arrays use the same
  interpretation, document, reference white and locals. All Electron work
  uses the shared GPU lock and disposable profiles; Steve's app is untouched.
- Research Q95, dithering off; **current format defaults** otherwise: AVIF
  10-bit, 4:2:0 SDR base, 4:4:4 half-resolution gain map at Q95; JPEG XL
  12-bit PQ, distance 0.2. SDR JPEG XL is separately encoded 8-bit sRGB Q95,
  not embedded in the HDR JXL. These defaults differ from the JPEG sibling's
  Q95/4:4:4/full-map sharp test; quality numbers across codecs are not equal.
- Initial encoding and normal ceiling-corrected delivery are measured
  separately. Shipping `ENCODING_ALLOWANCE` is retained, not redefined here.
  AGENTS' zero-encoded-allowance prose conflicts with the corrected Nov 16
  export PRD and the shipping 1% policy; coordinator/Steve must reconcile
  that wording. The implementation changes neither ceiling rule nor code.

## GPU against CPU, before and after delivery encoding

Every cell is **mean / P99.9**. No spatial per-pixel maximum is used.

| Input | Before HDR | Before SDR | AVIF decoded HDR | AVIF decoded SDR | JXL decoded HDR | Separate JXL SDR |
| --- | --- | --- | --- | --- | --- | --- |
| Matched sharp fixture | .0307 / .1133 | .0134 / .0521 | .9342 / 6.0141 | .1078 / 1.0134 | .1414 / 1.7342 | .2142 / 1.7594 |
| DSC08883 highlight crop | .0181 / .1543 | .2801 / 2.5082 | 2.8211 / 16.5936 | .5562 / 2.9685 | .8846 / 23.9777 | .8107 / 5.5673 |
| 5M071612 highlight crop | .0164 / .0551 | .0068 / .0564 | .9920 / 3.7200 | .1587 / 1.2810 | .3274 / 2.9975 | .1884 / 1.7686 |
| LR-classic highlight crop | .0220 / .0615 | .0147 / .1996 | .9111 / 3.9432 | .1567 / 1.1933 | .3184 / 4.3305 | .2644 / 1.7953 |

All finished renderer pairs pass. AVIF decoded HDR fails all four. JPEG XL
decoded HDR fails DSC08883 and LR-classic; DSC08883 separate SDR also fails.
For the sharp fixture, **initial** AVIF is .8412 / 4.0178 HDR and .1078 /
1.0134 SDR; after local ceiling correction HDR becomes .9342 / 6.0141.
The failure already exists before correction; correction can magnify it.
Fixture JPEG XL initial/delivered numbers are identical.

## Direct sensitivity: one renderer, small perturbations

Two definitions avoid calling a float epsilon an encoder LSB:

1. Common fine linear perturbation: add `.18/65535` to CPU ACEScg HDR and
   `1/65535` to CPU display-linear sRGB SDR. This is one uniform 16-bit
   linear-reference step; it is **not** claimed to be one native PQ/YUV code.
2. Native-precision signal perturbation: +1 PQ RGB code at AVIF 10-bit / JXL
   12-bit precision, and +1 sRGB code at AVIF 10-bit / separate JXL 8-bit,
   inverse-transformed to finished pixels before calling unchanged writers.
   AVIF ultimately converts PQ RGB to YUV; this is not an isolated AV1
   transform-coefficient experiment. Both HDR and SDR inputs change together.

| Input | AVIF fine-step decoded HDR | JXL fine-step decoded HDR | AVIF native-step decoded HDR | JXL native-step decoded HDR |
| --- | --- | --- | --- | --- |
| Matched sharp fixture | .8283 / 11.5550 | .1159 / 2.4615 | 1.2781 / 7.2446 | .2545 / 2.1099 |
| DSC08883 | 2.4062 / 15.7495 | 1.0430 / 23.6204 | 2.4909 / 15.2691 | 1.3676 / 28.2677 |
| 5M071612 | 1.0896 / 3.7987 | .4621 / 3.1835 | 1.3082 / 4.2882 | .3892 / 2.3149 |
| LR-classic | .8848 / 4.1338 | .3333 / 4.0836 | 1.2820 / 4.4333 | .3507 / 3.4052 |

Native perturbations themselves remain below the renderer agreement limit:
AVIF HDR approximately .701–.704 / .706–.750; JXL HDR .175–.176 /
.178–.190. The fine-step input and all SDR perturbation metrics are retained
in the per-case JSON evidence. The fine linear step is **not always a
sub-threshold HDR perturbation** near black: DSC08883 input is .2320 / 7.4674,
so its fine-step output cannot by itself establish amplification from a
passing input. The native PQ control does: that crop's JXL input .1752 /
.1904 becomes 1.3676 / 28.2677. On the sharp fixture the fine-step input
.0267 / 1.9397 becomes AVIF .8283 / 11.5550. There is real input
sensitivity, not nondeterministic encoding. Exact amplification ratios and
initial-vs-delivered values can be recomputed from the retained JSON.

## Encoding fidelity: decoded output versus its own finished source

Cells are **GPU source mean/P99.9; CPU source mean/P99.9**. A small
GPU/CPU difference alone cannot establish good encoding fidelity.

| Input | AVIF HDR | AVIF SDR | JXL HDR | Separate JXL SDR |
| --- | --- | --- | --- | --- |
| Sharp fixture | 5.2057/67.6316; 5.1116/67.4916 | .7599/17.9446; .7589/17.8963 | .2696/4.1527; .2712/4.1579 | .3784/2.3061; .3716/2.1390 |
| DSC08883 | 11.8898/130.2653; 12.0579/129.3755 | 1.5595/13.7073; 1.5513/13.7602 | 7.5642/54.9816; 7.5648/55.1817 | 1.1889/7.0323; 1.1801/7.1085 |
| 5M071612 | 2.3366/31.1184; 2.3430/31.3474 | .3872/3.6131; .3856/3.6169 | 1.2650/6.4233; 1.2654/6.4141 | .5408/3.2892; .5409/3.2492 |
| LR-classic | 2.4168/19.2710; 2.4130/19.4250 | .5896/5.9168; .5893/5.9168 | 1.5475/10.7428; 1.5465/10.7984 | .6717/3.9797; .6732/3.9190 |

These intentionally difficult native crops expose substantial delivery error
at the tested settings. The numbers include all current writer operations
(gamut/range preparation, quantization, compression, reconstruction and any
ceiling correction); they are not proof that compression alone accounts for
every own-source error. This task does not locate every fidelity loss, change
settings or declare these errors visually acceptable.

## Determinism and metadata

Both repeat encodes give byte-identical HDR output and zero decoded HDR/SDR
difference for each codec/case, initially and after correction. AVIF's parsed
gain-map metadata also matches exactly: min/max boost, gamma, base/alternate
offsets, headrooms and color-space selection. For the delivered sharp CPU
file: log2 min/max gain .00414038 / 3.35793, gamma 1, both offsets 1/64,
base/alternate headrooms 0 / 2.28599, `use_base_color_space=False`.
GPU and CPU inputs can legitimately produce different extrema/metadata;
they are not identical-input repeat tests. All parsed fractions are retained.
JXL is direct PQ/BT.2020: gain-map boost/gamma/offset determinism is **not
applicable**, not missing metadata. Its repeated HDR bytes match.

## Recommendations — no approval implied

| Contract | JPEG Ultra HDR | AVIF gain map | JPEG XL HDR |
| --- | --- | --- | --- |
| GPU vs CPU **before encoding** | Keep mean <1 / P99.9 ≤3 per lane | Same | Same |
| Decoded vs its **own source** | Separate per-quality/per-map fidelity check; recommended visual target <1 / ≤3 | Same visual target for HDR and SDR separately; current Q95/420/half fails badly | Same visual target for direct HDR and separately delivered SDR; Q95/12-bit does not universally pass |
| Decoded GPU vs decoded CPU | Keep current gate until Steve decides | Current gate fails; do not silently remove | Keep current gate; failure is content-dependent |

Do **not** set AVIF's limit to 130 or JXL's to 55 just because those are the
observed P99.9 errors: that would bless an unreviewed picture change and four
small cases cannot establish a safe new population limit. The per-format
fidelity contract should be parameterized by precision, chroma and quality,
not by renderer choice. Keep the proposed same visual target initially;
Steve must choose a fidelity/size trade-off before any weaker quality-specific
numbers become acceptance criteria. No such number is installed here.

Decoded-file comparisons still answer the product question "can fallback
change my delivered picture?" They should continue as regression diagnostics
even if Steve later approves replacing their pass/fail role with **both**
pre-encode renderer agreement and per-file own-source fidelity. Such a
replacement changes October 18 policy and needs Steve. Identical full-size
Proof/export bytes and the independent ceiling checks must remain exact under
either design. A single shared finished renderer avoids GPU/CPU sensitivity
but does not cure poor own-source fidelity; performance is unmeasured here.

The JPEG sibling's completed findings are now available in
`encoding-drift-jpeg-ultrahdr-2026-11-16.md` (read from the shared working
checkout before this handoff). Its established fixture delivered pair is
.877670 / 7.980648 HDR, .152682 / 3.370376 SDR, versus AVIF's .9342 / 6.0141
and JPEG XL's .1414 / 1.7342 HDR on the same captured fixture arrays. All
three encode routes amplify acceptable input differences; JXL happens to
remain within the existing agreement limits on this fixture, not on every
photographic crop.

JPEG's same-renderer control changes sparse SDR channels by one code while
keeping HDR identical: input SDR .037 / 1.034 becomes decoded HDR
1.278 / 8.615. That independently supports the AVIF/JXL sensitivity finding.
JPEG own-source fidelity on the delivered fixture is 4.004 / 29.187 HDR
and .601 / 7.300 SDR for CPU, 4.035 / 29.415 HDR and .611 / 7.313 SDR for
GPU. Like AVIF and JXL, it therefore needs a separate fidelity check rather
than an enlarged renderer-agreement limit. JPEG's ablation attributes its
fixture failure to map compression, base compression and final map processing;
JXL demonstrates that a gain map is not required for this general sensitivity.
The sibling also finds wide-gamut/zero-channel and partial-headroom fidelity
issues that these endpoint AVIF/JXL measurements do not qualify. Its photo
sizes, crops and perturbation definitions differ: do not treat the real-photo
numbers as a controlled three-codec ranking. Both reports recommend the same
split and require Steve's approval before changing the existing gate.

## Minimum Peak: what was measured and implemented

Real exported files, not only mocked metadata, were swept across 1.00000,
1.00001, 1.0001, 1.001, 1.005, 1.01, 1.02, 1.05, 1.1, 1.125 and 1.25
times each project white, then 203,204,205,206,207,208,210,225 nits across
all codecs and Peak Fit / Fixed cap / Soft Ceiling / Clip.

- At 203-nit project white AVIF still refuses at 1.01× (205.03 nits),
  but passes Clip at 1.02× (207.06 nits).
- At 100-nit project white **every** AVIF ratio up to 1.25× refuses.
  Its HDR alternate is absolute PQ and the ISO route derives headroom
  relative to 203 nits; making project white configurable does not alter
  that codec convention. A 125-nit floor is therefore not a fix.
- The lowest tested whole-nit candidate passing all codecs/modes/whites is
  205 nits, but 206-nit AVIF Clip at 203 white refuses. Quantization and
  correction make success non-monotonic near zero headroom. A universal
  infinitesimal minimum is not demonstrated.
- Stable tested 207,208,210,225 candidates pass all 24 combinations each.
  The minimum is `ceil(max(project white,203) × 1.02 /25) ×25` = **225 nit**
  at both supported whites: headroom **1.10837×** at R203 or **2.25×** at
  R100. One lower slider step, 200 nits, is inside the failed region.
- A maximum does not create light. Dark images, unusual colors, other codec
  qualities/precisions and stronger asymptotic compression are not proven
  universally encodable by a control floor. Existing safe refusal stays.

The backend normalizes raw HDR recipe values before the start/target range
check; frontend range, manual-value rule, input commits and state sync share
the same minimum. Only an actual below-floor target is raised; its Start is
reduced if necessary. Valid authored recipes, curve code and encoder defaults
are untouched. No project migration or protected-file write is added.

Saved-project audit: **none of the checked projects need clamping**. Both
protected `DSC00264-four-masks.hdrfinisher` / `DSC00264-fifty-locals.hdrfinisher`
and protected `Projects/DSC00950.hdrfinisher` store 1000 nits. Approved saved
grades DSC00264, DSC04375, DSC06615, IMG_0114 (including virtual copy/history)
and pano_192mp likewise store 1000; the DSC00950 / DSC_3931 legacy sidecars
have no explicit HC target. This audits the approved photo set and repository
local-test-media, not every private saved project on Steve's computer. Any
other saved/pasted recipe below 225 will clamp on validation/open; no files
are rewritten merely by auditing them.

## Validation and evidence

- Focused Python HC floor + real-encode ceiling suites: **115 passed**.
- Fast Python suite: **3833 passed, 144 skipped, 1 xpassed, 1 failed**.
  Unrelated `test_library_raw.py::test_one_reader_bounds_foreground_raw_bytes`
  fails expecting a foreground RAW cache entry; no RAW/cache code changed,
  no tolerance relaxed, no rerun/investigation performed.
- Focused UI: slider Home, typed 203, pasted-state normalization, Peak first
  row, dynamic explanation; 1408×794 and 1100×720, both reference whites.
  All-codec CPU/GPU 225-nit exports and full-size Proof byte identity plus
  ordinary Proof pass (12 export cases, 24 Proof requests). The tiny fixture
  is smaller than ordinary Proof's 256px minimum, so that branch does not
  demonstrate a genuinely downscaled image; existing ceiling tests remain.
- Fast Node final: **1091 passed, 1 skipped, 0 failed**; tooltip catalogue
  updated only after confirming no pending catalogue edits.
- Existing GPU Highlight Compression parity driver passes.
- Default 90-second quick Library check fails on **system memory reserve**
  and **8 of 9 expected photos pictured**. No Library/cache behavior is
  changed or repaired here; the fixture mix remains frozen and the check
  is not rerun. These unrelated failures are not waivers.
- All three protected project hashes and all seven other audited sidecar
  hashes remain unchanged. Final scratch output 13.1 GB, below the 100 GB
  limit; this investigation retains about 7 MB, mostly the reproducible
  finished float arrays. No installer, push, or broad release sweep ran.

Reproduction tools: `codebase/tools/encoding-drift.py` (prepare/capture/probe),
`encoding-drift.cjs` (locked hidden-renderer captures),
`encoding-drift-headroom.py` (real-encode sweep);
`tests/highlight-delivery-floor.js` (focused UI/export/Proof).
Retained evidence is under `codebase/output/review/encoding-drift-avif-jxl/`:
`fixture.json`, `sharp-matched-floats.npz` (a retained copy of the original
N4 capture), `photos.json`, each photo's `floats.npz`, `document.json` and
`results.json`, `headroom.json`, `headroom-refined.json`, `project-audit.json`,
`minimum-delivery.json`, `ui.json`, screenshots and compact test logs.
Intermediate decoded files, encoded probes, imported TIFF crops and temporary
profiles are removed; only inspectable/reproducible evidence remains.

### Steve's decision

Keep the decoded GPU/CPU gate and investigate delivery fidelity/settings, or
approve replacing its acceptance role with pre-encode agreement **plus**
own-source per-format fidelity? The second avoids blaming a renderer for
codec amplification, but must not silently permit poor delivered pictures.
No decision is taken on Steve's behalf.
