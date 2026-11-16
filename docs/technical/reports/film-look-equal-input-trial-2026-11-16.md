# Film Look equal-input trial — November 16, 2026

**Implementation update:** the safe-link build, two-rule counts and scoped
qualification are in section 10. Sections 1–9 retain the earlier research and
checkpoint history; their unavailable-stage notes describe that earlier work.

## Recommendation: ship with changes, not this trial as-is

**Pursue the common scene-grade/Film architecture; do not enable it as the default yet.**
On the frozen CPU renderer, all 49 chart/RAW cases meet the requested body gates.
Every +1…+3-stop hue/stop group is below 3 ΔE00 P95 (worst **1.975**);
the five RAWs' highlight P95s are **0.015–1.981**. The incumbent accepted
chart fits are roughly 8–16, so the improvement is not limited to blue.
HDR pixels are bitwise unchanged in all 49 matrix cases.

This is evidence for a structural direction, **not 49 certified production Matches**.
Only 30/49 pass the existing highlight-order diagnostic; only 35/49 pass the
one-percentage-point white-growth check after a +0.5 EV output trim. The GPU
attempt failed harness compilation, so no GPU timing/parity or export/Proof
qualification exists. No default, recipe, protected project, renderer, shader,
shipping gate, or tolerance is changed by this work.

**Steve's first decision:** should HDR and SDR share the creative Tone + Film
grade, with SDR-only changes made after Film? It fits “Tone first, then Film,
Highlight Compression last” and removes the demonstrated input mismatch.
The trade-off is loss/redefinition of independent SDR pre-Film control ownership;
existing SDR grades visibly change, including a real saved grade whose HDR Film
is Vision3 200T while its SDR Film is intentionally off. Do not silently reinterpret
those controls. No migration/compatibility renderer is proposed before 1.0.

## 1. Scope, provenance and meaning of the numbers

- Renderer snapshot: **`ab0645be`**, archived read-only from Git before the
  measurements. The shared checkout continued changing in other workers;
  its moving HEAD is not the measurement baseline. `manifest.json` records
  the frozen backend revision and hashes. This predates concurrent Peak-minimum
  and encoder work; there is no claim to certify those changes.
- Seven configurations: Film off; Portra 400, Ektar 100 and Velvia 100 at
  50% and 100%. Short labels below: Off, P50, P100, E50, E100, V50, V100.
- Two existing deterministic chart populations: **176** patches (seven hue
  families × three saturations × eight stops, plus eight greys), and **224**
  patches (adds BT.2020 blue/green × three saturations × eight stops).
  Stops are source Y = 0.18 × 2^stop, -4…+3, not post-Film measured exposure.
- Five canonical N3a RAW proxies, reused from
  `codebase/output/review/m1-all-colours/reduced-sources/`, <=512 pixels on
  the longest edge. No per-run RAW copies. The controlled grade uses exposure
  +0.2, contrast +0.12, saturation +0.10 and the prior research luma curve.
  Grain and halation are off; no local grades; other settings are defaults.
  This is not the full 20-stock/lens/grain/native-resolution population.
- “Residual” means **ΔE00 against the unchanged shipping SDR Match target
  made from settled HDR**, not a direct comparison of two differently scaled
  HDR/SDR arrays. Both target and SDR are display-linear sRGB; CIE Lab uses
  the sRGB/D65 matrix/white. P95 is NumPy's ordinary percentile. This target
  already includes unavoidable/intentional SDR luminance and gamut changes.
  Low residual does not mean every physical HDR highlight colour survives SDR.
- RAW highlights use the same settled-HDR mask for before and after:
  ACEScg Y × `SDR_SCENE_TO_DISPLAY_SCALE` > 0.9. Whole-frame includes all
  pixels. Body uses <=0.9 and the shipping quality helper's target-luma floor
  0.0008; its empty-selection fallback is unchanged. Body OKLab and ΔE00
  are different metrics and must not be interchanged.
- Required body limits remain OKLab P95/median **0.050/0.015**, absolute
  display-linear luma median/P95 **0.010/0.030**. The normal Match colour
  P95 threshold is tighter (0.040); 0.050 is not a newly relaxed normal gate.
  Bright-colour target is about 3 ΔE00 P95. Timing ±10% was recorded in the
  M1-EQ board row before measurement as exploratory noise, not a shipping budget.
- A refused baseline has **no valid rendered Match**, so its residual/drift
  is “—”, never zero or the last rejected optimizer candidate. “Needs review”
  is a returned recipe with the app's warning, not an ordinary matched pass.

### What is actually changed in the isolated harness

Today each lane evaluates its own creative grade and its Film stage on its
lane-local input/boundary. N1 already moved SDR Highlight Compression to the
end; simply moving that call again would not fix M1d.

The trial evaluates **the existing HDR scene grade and HDR-domain Film exactly
once**, before its output Highlight Compression. That same finished scene
array feeds both output tails:

```text
source → shared HDR scene Tone/colour + Film → common scene frame
    HDR → unchanged HDR Highlight Compression → ordinary HDR nonnegative boundary
    SDR → scene-to-display scale + ACEScg→sRGB → one SDR Highlight Compression → gamut boundary
```

There are not two approximately equal Film inputs: there is **one evaluation**,
so their input difference is zero by construction. This also adopts the HDR
Film signed-colour boundary instead of the existing SDR boundary, and shares
HDR creative controls rather than retaining Match's independent SDR pre-Film
fit. The result cannot attribute every gain to print-stage placement alone.
Film-off improves too, showing that shared scene grading/output mapping is
part of the gain. No per-stock warmth/preflash correction is fitted.

The SDR tail search has 19 bounded candidates: soft ceiling, fixed cap and
peak fit at starts 70/80/85/90/95/99%, plus clip; softness 100. It ranks body
gate passes first, then mean display-linear RGB error over the whole frame.
All selected tails are **soft ceiling**, starts 90–99%. Both charts are
fitted independently. This is a replacement research fitter, **not** a hidden
call path or a finished materialization of the existing Match action.

## 2. Bright-colour result and unchanged body limits


| Population | Look | Incumbent Match | Before bright P95 ΔE00 | Equal-input bright P95 ΔE00 | Selected HC start |
| --- | --- | --- | --- | --- | --- |
| chart176 | Off | needs_review | 10.751 | 0.301 | 99% |
| chart176 | P50 | needs_review | 15.150 | 0.471 | 95% |
| chart176 | P100 | needs_review | 8.152 | 1.057 | 99% |
| chart176 | E50 | needs_review | 15.524 | 0.496 | 95% |
| chart176 | E100 | needs_review | 7.777 | 1.118 | 99% |
| chart176 | V50 | needs_review | 13.651 | 0.426 | 95% |
| chart176 | V100 | refused | — | 0.684 | 95% |
| chart224 | Off | needs_review | 10.322 | 0.550 | 99% |
| chart224 | P50 | refused | — | 0.518 | 95% |
| chart224 | P100 | needs_review | 8.930 | 0.908 | 99% |
| chart224 | E50 | refused | — | 0.516 | 95% |
| chart224 | E100 | needs_review | 9.609 | 0.987 | 99% |
| chart224 | V50 | refused | — | 0.515 | 95% |
| chart224 | V100 | refused | — | 0.672 | 95% |


Worst individual hue/stop P95 is **1.975** (Velvia 100%, skin, +1 stop).
All 336 coloured bright hue/stop/configuration groups are below 3 (including the
wide-gamut controls). The full -4…+3-stop breakdown is in Appendix A;
individual saturation samples are retained in `patches.csv`.


| Unchanged body check | Limit | Worst of 49 |
| --- | --- | --- |
| OKLab P95 | 0.050 | 0.019159066 |
| OKLab median | 0.015 | 0.000000069 |
| Luma median | 0.010 | 0.000000006 |
| Luma P95 | 0.030 | 0.006181509 |


All 49 meet all four requested body limits, including the 0.040 normal colour
P95 cap. Near-zero body medians mean most body samples are unchanged against
the target; they are not missing values. This does not supersede the ordering,
editability, gamut, native render, or encoded-output checks.

### RAW whole-frame and highlight P95, before → equal input

“<0.001” means a measured nonzero residual below rounding precision, not zero.
The IMG_0790 Film-off whole-frame P95 is **3.222** even though its highlight P95
is 1.042 and its body limits pass. Do not describe every whole-frame result as <3.


| RAW | Look | Incumbent Match | Whole P95 ΔE00 | Highlights P95 ΔE00 |
| --- | --- | --- | --- | --- |
| A7R00619.ARW | Off | matched | 7.865 → 0.389 | 8.930 → 0.745 |
| A7R00619.ARW | P50 | needs_review | 6.277 → 0.284 | 7.734 → 0.716 |
| A7R00619.ARW | P100 | matched | 3.827 → 0.232 | 6.850 → 0.842 |
| A7R00619.ARW | E50 | needs_review | 6.390 → 0.284 | 7.803 → 0.714 |
| A7R00619.ARW | E100 | matched | 4.072 → 0.228 | 6.881 → 0.815 |
| A7R00619.ARW | V50 | needs_review | 6.222 → 0.263 | 8.108 → 0.722 |
| A7R00619.ARW | V100 | matched | 4.311 → 0.236 | 3.578 → 0.502 |
| DSC00264.ARW | Off | matched | 4.644 → 0.267 | 10.913 → 0.645 |
| DSC00264.ARW | P50 | matched | 4.831 → 0.037 | 13.058 → 0.745 |
| DSC00264.ARW | P100 | matched | 2.711 → 0.053 | 12.896 → 0.939 |
| DSC00264.ARW | E50 | matched | 5.097 → 0.039 | 12.881 → 0.724 |
| DSC00264.ARW | E100 | matched | 2.460 → 0.060 | 13.107 → 0.891 |
| DSC00264.ARW | V50 | matched | 4.151 → 0.048 | 13.373 → 0.765 |
| DSC00264.ARW | V100 | matched | 3.302 → 0.107 | 9.762 → 1.206 |
| IMG_3129.CR2 | Off | matched | 0.282 → <0.001 | 12.150 → 1.206 |
| IMG_3129.CR2 | P50 | matched | 1.815 → <0.001 | 14.772 → 1.433 |
| IMG_3129.CR2 | P100 | needs_review | 1.435 → <0.001 | 11.446 → 1.644 |
| IMG_3129.CR2 | E50 | matched | 2.282 → <0.001 | 15.528 → 1.051 |
| IMG_3129.CR2 | E100 | needs_review | 1.190 → <0.001 | 11.959 → 1.981 |
| IMG_3129.CR2 | V50 | matched | 1.157 → <0.001 | 12.106 → 1.500 |
| IMG_3129.CR2 | V100 | needs_review | 4.658 → <0.001 | 12.270 → 1.705 |
| IMG_0790.CR2 | Off | refused | — → 3.222 | — → 1.042 |
| IMG_0790.CR2 | P50 | matched | 2.862 → <0.001 | 13.383 → 0.116 |
| IMG_0790.CR2 | P100 | matched | 1.796 → <0.001 | 9.015 → 0.217 |
| IMG_0790.CR2 | E50 | matched | 2.955 → <0.001 | 13.614 → 0.111 |
| IMG_0790.CR2 | E100 | matched | 1.682 → <0.001 | 8.435 → 0.206 |
| IMG_0790.CR2 | V50 | needs_review | 5.795 → <0.001 | 9.538 → 0.144 |
| IMG_0790.CR2 | V100 | needs_review | 4.748 → <0.001 | 8.884 → 0.444 |
| IMG_7723.CR3 | Off | matched | 7.063 → 0.271 | 8.314 → 0.815 |
| IMG_7723.CR3 | P50 | refused | — → 0.349 | — → 0.858 |
| IMG_7723.CR3 | P100 | matched | 0.938 → <0.001 | 2.216 → 0.029 |
| IMG_7723.CR3 | E50 | refused | — → 0.347 | — → 0.849 |
| IMG_7723.CR3 | E100 | matched | 0.876 → <0.001 | 2.225 → 0.031 |
| IMG_7723.CR3 | V50 | needs_review | 3.751 → 0.346 | 5.939 → 0.872 |
| IMG_7723.CR3 | V100 | matched | 1.430 → <0.001 | 2.183 → 0.015 |


## 3. SDR output mapping and Film character

**The print curve does not replace an SDR output transform.** Before the
output cap, 24.43–37.50% of the 176-chart samples have Y > SDR white. The
“print only” ablation still applies the required sRGB gamut boundary, but
disables output HC; it therefore tests Film plus a legal gamut boundary,
not an unbounded display. Its bright residual remains 7.789–20.509 on the
176 chart (13.686–21.888 on the 224 chart). The late cap is needed.

Conversely, adding a broad second shoulder is not neutral. Default peak-fit
smooth reduces body contrast/saturation and fails the body gates. Peak-fit
“preserve colour” retains more saturation but still fails the same gates.
Another soft ceiling at 70% **after** the selected tail raises bright P95
above 3.5. This is a deliberate double-mapping ablation, not a claim that
today's app necessarily applies two identical soft ceilings.


| Look (176) | No HC | Selected late HC | Default peak smooth | Peak preserve | Second soft cap 70% |
| --- | --- | --- | --- | --- | --- |
| Off | 20.509 | 0.301 | 23.441 | 21.374 | 3.596 |
| P50 | 19.580 | 0.471 | 21.422 | 21.156 | 3.596 |
| P100 | 12.453 | 1.057 | 12.768 | 19.293 | 3.596 |
| E50 | 20.003 | 0.496 | 21.603 | 21.066 | 3.596 |
| E100 | 14.795 | 1.118 | 13.138 | 18.616 | 3.596 |
| V50 | 17.464 | 0.426 | 20.590 | 20.610 | 3.596 |
| V100 | 7.789 | 0.684 | 11.381 | 13.509 | 3.603 |


Peak smooth body OKLab P95 spans **0.1067–0.1902**; peak preserve spans
**0.0551–0.0909**, still beyond 0.050. No tolerance change is justified.

### Contrast and saturation are measured, not inferred from colour error

Grey body contrast is log2(Y at 0 stops / Y at -2 stops) / 2: a slope of 1
means one output stop per input stop. The selected late HC leaves this body
slope **exactly equal to the common Film/print-only slope** in all 14 chart
cases. It does not leave the incumbent *SDR* contrast unchanged, because
that Film previously saw a different input.

For saturation, normalize each colour to Y=0.18, convert to Lab, and compare
C*ab; exclude reference C* <5. This removes brightness as a proxy for
saturation. Ranges below span hue-family median ratios, body -4…0 or bright
+1…+3. They are not maxima over individual pixels. Full per-hue ratios,
counts and grey highlight slopes for both populations are in `character.json`.


| Look (176) | Old SDR body slope | Common Film = selected SDR body slope | Body chroma new/old | Bright chroma new/old | Bright chroma SDR/common HDR |
| --- | --- | --- | --- | --- | --- |
| Off | 1.220 | 1.222 | 1.000–1.000 | 0.076–0.902 | 0.124 |
| P50 | 1.137 | 1.287 | 0.979–1.008 | 0.001–0.824 | 0.109 |
| P100 | 1.486 | 1.362 | 1.001–1.066 | 0.372–0.875 | 0.131 |
| E50 | 1.146 | 1.315 | 0.972–1.003 | 0.001–0.822 | 0.114 |
| E100 | 1.572 | 1.426 | 0.997–1.079 | 0.312–0.858 | 0.114 |
| V50 | 1.296 | 1.338 | 0.999–1.005 | 0.001–0.838 | 0.099 |
| V100 | — | 1.469 | — | — | 0.195 |


The selected output keeps all seven 176-chart families' body normalized
chroma at 1.000 of common Film for Off/P50/P100/E50/E100/V50. V100 is
0.652–1.000 because the wide/signed colour and SDR gamut boundary still
matter. Bright normalized chroma after the SDR transform is only about
**0.099–0.195** of common HDR in the per-configuration pooled medians.
That substantial reduction is compatible with the unchanged Match target,
not evidence of full HDR saturation preservation. Steve must judge the
near-white bright look visually before any shipping decision.

**Proposed mapping policy:** preserve the scene/print body response, then
one final SDR display cap + gamut mapping, rather than stack a broad creative
tone map on top of Film. The successful starts are 90–99%, not a recommendation
to change shipped defaults to those values. A production output fitter still
has to preserve the unchanged headroom and ordering safeguards.

## 4. Does Match still work? Colour feasibility is not action readiness

The incumbent real `materialize_sdr_match` returns **23 matched, 18 needs
review, 8 refused** out of 49. The five RAWs contribute three refusals:
IMG_0790 Off, IMG_7723 P50 and E50. The remaining five are chart176 V100,
and chart224 P50/E50/V50/V100. The full statuses are in the tables above.

The research output-only fitter returns 49 body-safe colour fits, including
those eight previously refused cases. **Do not report this as “8 → 0
production refusals.”** It does not materialize the new order into editable
shipping recipes or apply every production acceptance/override rule.


| Population | Body pass | Trial order pass | Target itself order pass | +0.5 EV white-growth pass | Largest growth (percentage points) |
| --- | --- | --- | --- | --- | --- |
| chart176 | 7/7 | 1/7 | 1/7 | 2/7 | 3.977 |
| chart224 | 7/7 | 1/7 | 1/7 | 3/7 | 3.125 |
| A7R00619.ARW | 7/7 | 7/7 | 7/7 | 3/7 | 4.391 |
| DSC00264.ARW | 7/7 | 7/7 | 7/7 | 7/7 | 0.686 |
| IMG_3129.CR2 | 7/7 | 0/7 | 0/7 | 7/7 | 0.005 |
| IMG_0790.CR2 | 7/7 | 7/7 | 7/7 | 7/7 | 0.023 |
| IMG_7723.CR3 | 7/7 | 7/7 | 7/7 | 6/7 | 4.463 |


Totals: **30/49 order passes**, **35/49 white-growth passes**, and **23/49
pass both**. The existing HDR-brightness-bin ordering helper also rejects
the target itself in exactly the 19 cases it rejects in the trial; all seven
IMG_3129 configurations are among them. That is a measured target/diagnostic
conflict, not permission to remove the diagnostic. A chroma-dependent gamut
map and an HDR-luma ordering gate need reconciling in the production design.

White growth is the fraction with linear SDR Y >=0.999 after adding +0.5 EV
**after Film**, minus that fraction before, limited to <=1 percentage point.
Worst RAW growth is **4.463 points** (IMG_7723 Off); A7R00619 Off is 4.391.
This is not the old pre-Film Exposure control and does not certify its old
editing semantics. The cap still bounds output, but too many pixels can
congregate at white. Neither this gate nor the order gate is loosened.

HDR array equality is asserted **49/49** using the unchanged final HDR HC
and ordinary nonnegative boundary. This excludes grain/halation/native-size
delivery and is not a Proof/export/encoder ceiling certification. Production
HDR is untouched because no production path is edited.

## 5. Which existing grades change?

Sharing creative scene Tone/Film changes SDR output whenever the old SDR
scene grade or Film choice differs. Even Film off is not a safe “no change”
case. The following controlled grades were actually made by today's Match
and then rendered under the proposed common stage **without re-fitting their
existing SDR HC**. These are research-derived saved recipes, not claims that
all five originals had saved user sidecars. Values are old SDR → new-order
SDR P95 ΔE00 (whole / highlights); a refused Match has no saved fit to test.


| RAW | Off | P50 | P100 | E50 | E100 | V50 | V100 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A7R00619.ARW | 1.140 / 1.241 | 5.048 / 2.413 | 1.102 / 0.730 | 5.028 / 2.284 | 1.033 / 0.565 | 4.385 / 2.075 | 4.258 / 1.197 |
| DSC00264.ARW | 1.366 / 1.922 | 1.782 / 3.545 | 1.058 / 1.024 | 2.150 / 3.812 | 0.963 / 1.003 | 1.783 / 2.843 | 2.867 / 0.252 |
| IMG_3129.CR2 | 0.275 / 2.938 | 1.809 / 7.322 | 1.391 / 2.251 | 2.233 / 8.426 | 1.162 / 2.511 | 1.105 / 3.611 | 4.224 / 1.562 |
| IMG_0790.CR2 | — / — | 2.569 / 8.019 | 1.562 / 1.200 | 2.682 / 8.380 | 1.429 / 1.192 | 5.907 / 8.890 | 4.831 / 6.562 |
| IMG_7723.CR3 | 0.374 / 0.912 | — / — | 0.872 / 0.103 | — / — | 0.820 / 0.102 | 0.845 / 0.917 | 1.278 / 0.117 |


Every accepted controlled RAW recipe changes: whole-frame P95 spans
**0.275–5.907** and highlight P95 **0.102–8.890**. A new Match can greatly
reduce residual against the target, but silently changing rendering order
under a saved recipe is visibly different from re-running Match with consent.

### Actual saved documents, read-only

**Protected DSC00950.hdrfinisher:** the canonical DSC00950.ARW SHA-256
matches the project's recorded source, so the research harness can link it
read-only without saving/relinking the project. Its old schema contains
removed custom Film and Lift/Gamma/Gain fields. Current strict validation
does not accept those unchanged fields; the already-shipping saved-document
reader recovers the current grade and issues `needs_choice`. It recovers
Film off, not the historical custom Film. This is **not a faithful old-Film
render**, and no compatibility code is added.

On that recovered grade (five locals, 328×491 reduced source, 94,556 finished
pixels), SDR new-order drift is **median 1.862 / P95 10.050 ΔE00**. Its HDR
highlight selection is empty, so highlight P95 is **n/a**, not zero. Project
SHA-256 before/after is identical:
`246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56`.
`DSC00950-saved.json` retains the source fingerprint and recovery notice.



**Actual DSC00264.ARW.hdrf:** HDR Film is `kodak_vision3_200t` at 100%,
SDR Film is `none`. Applying the shared HDR creative stage
while keeping its saved SDR HC changes whole-frame SDR by **median
6.244 / P95 15.317 ΔE00**;
highlight P95 is **4.952**. HDR equality passes for this
additional saved-grade case. Grain is deliberately excluded; saved halation,
lens and creative settings otherwise run on a <=512 proxy with the saved RAW
import settings. This is not a native-resolution grain/lens certification.
Source fingerprint and sidecar pre/post hash are verified; no sidecar writes.
Sidecar hash: `5757b930b89a03055232070e82eec88b8c99e95f5ef49f5a2fbcea927d5b7ccf`.

No saved grade sidecars are present for the other four N3a RAWs in the shared
canonical photo set. Their controlled-grade drift is measured above; historical
user-grade impact cannot be quantified from absent documents. DSC00950.ARW.hdrf
contains marks only, so it is not a substitute for the protected old project.

## 6. Cost on this Mac, not a product-speed promise

MacBook Neo / A18 Pro / 8 GB, CPU threads=2, DSC00264 proxy 498×333
(0.166 MP), grain/halation off, three warmed samples. “Standalone” recomputes
the scene Film for SDR; “shared tail” assumes the HDR/common Film frame already
exists. A separate alternating-order benchmark measures both output renditions
together and actually shares that common work. Times exclude source decoding,
Match fitting, UI waits, GPU transfer, export/encoding and file I/O.


| Look | Old SDR ms | Trial standalone SDR ms | Trial shared SDR tail ms | Old HDR+SDR → shared pair ms | Pair time reduction |
| --- | --- | --- | --- | --- | --- |
| Off | 41.9 | 45.1 | 27.4 | 68.0 → 52.0 | 23.5% |
| P50 | 152.4 | 166.6 | 23.3 | 314.5 → 185.1 | 41.1% |
| P100 | 145.0 | 157.9 | 20.8 | 317.8 → 180.7 | 43.1% |
| E50 | 136.2 | 158.4 | 23.1 | 380.9 → 217.8 | 42.8% |
| E100 | 147.5 | 168.8 | 21.8 | 458.1 → 254.6 | 44.4% |
| V50 | 115.6 | 122.3 | 23.5 | 285.6 → 167.8 | 41.3% |
| V100 | 119.6 | 161.9 | 29.9 | 259.2 → 169.5 | 34.6% |


The observed Film-on **pair** reduction is 34.6–44.4%, not 50%+ of the
whole wait Steve feels; it does not justify a new production GPU route or a
product speed claim. Single-lane trial cost can increase. Several three-sample
spreads exceed the predeclared ±10% exploratory band (notably Velvia); do not
treat stock-specific rankings/regressions as stable. `cpu-timing.json` and
`cpu-pair-timing.json` retain each sample. No native-size extrapolation.

The obvious expensive duplication is evaluating the negative/print/scan chain
separately for HDR and SDR. Sharing that work explains the measured pair
opportunity. No profiling-led optimization or cache change is attempted here.

**GPU time: unavailable.** One separate Electron run used the shared lock and
1408×794 window. It failed the research WGSL compilation with
`'common' is a reserved keyword`; this is a harness error, not evidence of a
GPU/driver failure. The variable was renamed, syntax checked, and **not rerun**
under the one-attempt → CPU-fallback rule. The committed opt-in GPU prototype
therefore remains GPU-unvalidated; no GPU parity or speed number is invented.
The run closed only its own browser/profile, never Steve's app. A corrected
future GPU experiment is follow-up work requiring Steve's decision, not an
automatic retry of this run.

## 7. Before shipping, without weakening safeguards

1. Agree common Tone/Film ownership and SDR-only trim semantics. Document
   the saved-grade change plainly; do not silently preserve the old policy in
   migration code or silently replace independent SDR Film choices.
2. Implement a real Match recipe/output materializer for the agreed order.
   Keep colour/luma, normal-vs-review, editability and highlight-order gates.
   Reconcile the 19 target/order conflicts and 14 white-growth failures rather
   than counting these numeric fits as accepted Matches.
3. Have Steve judge the bright, nearly-white colour/contrast trade-off. A low
   target residual alone is not permission to discard more film saturation.
4. Validate the corrected GPU path in a separately approved scoped run, then
   native size, local/mask/detail/lens/grain/halation cases, independent HDR/SDR
   controls and strict export/Proof/decoded ceiling paths. The exact HDR cap,
   pinned parity guards, GPU lock and 100 GB output limit remain unchanged.

This trial stops at that recommendation. The shipping processing order,
default controls, saved recipes and protected projects are untouched.

## 8. Validation, reproduction and retained evidence

- CPU matrix and equality assertions complete: 49 cases; additional real
  DSC00264 saved-grade HDR equality. Character/ablation pass rerun on the
  frozen backend after adding old-SDR contrast/chroma comparisons.
- Full Node fast suite: **1,090 pass, 1 fail, 1 skip**. Unrelated concurrent
  UI work left tooltip catalogue 760/761 entries out of sync. Not regenerated,
  repaired or rerun by this research task.
- Full Python fast suite: **3,833 pass, 1 fail, 144 skip, 1 xpass**. Unrelated
  peak-minimum worker changed the frontend target-bound text expected by
  `test_grade_readouts_support_bounded_direct_numeric_entry`. No test/gate
  changes or rerun to hide it.
- Focused release inventory: **26 pass, 1 skip**; both research drivers are
  diagnostic-only, excluded from ordinary/full release selections.
- CJS syntax check passes; the single locked GPU run fails as described.
  No second Electron/Library run or broad GPU sweep: this is research-only,
  and no production frontend path was changed or certified.
- Output was 13.0 GB at task start and **13.1 GB at finish**, below 100 GB;
  retained trial evidence is about **3.5 MB**. Footprint and cleanup are
  recorded in `validation.json`; only this trial's transient GPU float
  sources/goldens and temporary snapshot/log duplicates are removed. No
  unrelated worker or Steve files are deleted.

Reproduce from the repository root (POSIX example; on Windows use its venv
Python and equivalent Git-archive extraction). The tools use shared machine
photo settings, no machine-specific source edits. Use a new temporary directory
for the snapshot and remove it afterwards; the archive is **not** a worktree:

```sh
snapshot=$(mktemp -d)
git archive ab0645be codebase/backend | tar -x -C "$snapshot"
out=codebase/output/review/film-equal-input-trial-2026-11-16
HDR_CPU_THREADS=2 codebase/.venv/bin/python codebase/tools/film_equal_input_trial.py \
  --backend "$snapshot/codebase/backend" --backend-revision ab0645be --output "$out" --only all
HDR_CPU_THREADS=2 codebase/.venv/bin/python codebase/tools/film_equal_input_trial.py \
  --backend "$snapshot/codebase/backend" --output "$out" --only character
HDR_CPU_THREADS=2 codebase/.venv/bin/python codebase/tools/film_equal_input_trial.py \
  --backend "$snapshot/codebase/backend" --output "$out" --only gpu-prepare
HDR_CPU_THREADS=2 codebase/.venv/bin/python codebase/tools/film_equal_input_trial.py \
  --backend "$snapshot/codebase/backend" --backend-revision ab0645be --output "$out" --only timing
rm -rf "$snapshot"
```

`gpu-prepare` only creates input buffers and recipe JSON for timing; it does
not launch Electron. The GPU driver must not be run again as part of merely
reproducing the accepted CPU findings. Remove its generated `.rgba32f` and
`.rgb32f` transients after use. The prior M1 proxy `.npz` inputs are prerequisites;
their absence is a missing fixture, not permission to duplicate originals.

Evidence root: `codebase/output/review/film-equal-input-trial-2026-11-16/`.
Keep `summary.csv`, `patches.csv`, `hue-stop-summary.csv`, all seven
`*-cases.json`, compact chart `.npz`, recipe JSON, `character.json`, tail
ablations, CPU timing JSON, saved-document summaries/hashes, manifest and
validation/log receipts. They are local ignored research output; the committed
report carries the result tables so numbers do not depend on syncing output.
`bright-tone-comparison.html` is the small comparison shown with this handoff.
No full-size exports or photographic captures are retained. This review
folder can be removed after Steve reviews it; the earlier M1 proxy source
folder remains a shared research dependency and is not this task's cleanup.

Sources/contracts: [M1/M1a/M1d/N3a sprint brief](../briefs/sprint-0-9-3-feedback-2026-11-15.md),
[M1 colour follow-up](m1-colour-follow-up-2026-11-15.md),
[print-stage study](m1-print-stage-2026-11-15.md),
[Film module](../../product/modules/film-look.md),
[SDR Match](../sdr-match.md), [pipeline contract](../image-processing-pipeline.md).
Experimental tools: `codebase/tools/film_equal_input_trial.py` and `.cjs`.

## 9. Option B implementation checkpoint: no shipping change

Steve approved option B after the original trial. The implementation attempt
stopped before application changes because it did not find a general SDR tail
that retains the colour improvement and passes the existing safeguards. This
is an **unsolved implementation**, not a claim of mathematical impossibility
and not a completed linked-SDR feature.

### Reproduction on the current CPU reference

`tools/linked_sdr_tail_probe.py --baseline` re-renders the same seven looks
on both charts and the five cached <=512px RAW sources, with the original
selected tail settings. Grain, halation and locals remain off, reference white
203 nits; all body masks and the target construction remain unchanged. It does
not call Match, save a recipe, open a protected project, or run an encoder.

The result exactly reproduces **49/49 body passes, 30/49 ordering passes,
35/49 white-growth passes, and 49/49 exact HDR common-stage reconstruction**.
The target itself has the same 19 ordering failures. Worst +0.5 EV white growth
is **4.463 percentage points**, IMG_7723 Film off, against the unchanged one
point allowance. The 336 coloured hue/stop P95s over +1/+2/+3 stops still have
maximum **1.975 ΔE00**. `baseline.json` retains every per-hue/stop value, all
four body metrics, both checks and the seven looks for each RAW.

Five-RAW colour remeasurement, ranges across Film off / Portra / Ektar /
Velvia 50% and 100% (these remain the **unqualified original tails**, not new
accepted Matches):

| RAW | Whole-frame P95 ΔE00 range | Highlight P95 ΔE00 range |
| --- | --- | --- |
| A7R00619.ARW | 0.228–0.389 | 0.502–0.842 |
| DSC00264.ARW | 0.037–0.267 | 0.645–1.206 |
| IMG_3129.CR2 | <0.001 | 1.051–1.981 |
| IMG_0790.CR2 | <0.001–3.222 | 0.111–1.042 |
| IMG_7723.CR3 | <0.001–0.349 | 0.015–0.872 |

The near-zero figures above are nonzero measurements, not missing selections.
For a concrete ordering conflict, chart176 Film-off target highlight-bin
medians fall **0.983510 → 0.845706** between the fifth and sixth HDR-brightness
quantile bins: a 0.137804 drop against the existing 0.005 allowance. The bins
contain different colours; this observation does not authorize changing the
diagnostic or the target.

### Bounded tail search, not a new production fitter

For **each** chart/configuration independently, the probe tests 2,040 candidates:

- Soft Ceiling, Fixed cap, Peak Fit with its ordinary Smooth Color Rolloff
  settings, and Clip; start 10/30/50/70/80/85/90/92/95/97/99% where applicable,
  Softness 100.
- Post-Film exposure -0.25/-0.10/0/+0.10/+0.25 EV, and saturation multipliers
  0.50/0.75/0.90/1/1.10/1.25. These are the two simple late creative trims being
  investigated, **not added controls or persisted recipe fields**.
- The incumbent adaptive gamut boundary, or a research boundary that reduces
  chroma toward neutral while preserving legal linear luminance. The latter
  deliberately probes the suspected colour/luminance-order conflict; it is
  never installed in the renderer.

This is **28,560 candidates over 14 chart configurations**, with original body
limits 0.050/0.015 OKLab P95/median and 0.030/0.010 luma P95/median; no normal
matched threshold changes. Ordering calls the existing helper. White growth
is tested after an additional +0.5 EV **before** HC/gamut, never after a cap
or by keeping the output artificially below the white-count threshold.

Only **Velvia 100%** in each population retains the approximately 3 ΔE00
bright hue/stop goal together with all three safeguards: **1/7 + 1/7**.
For the other six chart176 looks, five have body/order/growth-safe candidates
but best bright hue/stop P95 is **14.914–17.844**; Film off has none. On chart224,
only Ektar 100% has an additional safeguard-safe candidate, at **11.347**;
the other five have none. The per-configuration best candidates and their
per-hue/stop measurements are in `chart176.json` and `chart224.json`.

This rules out these tested simple tails as a satisfactory general solution.
It does **not** cover every curve, gamut construction or trim value, and it
does not establish that option B is impossible. No RAW search or GPU port of
the failing designs is presented as qualification. A different output/gamut
design must be demonstrated before adding a live link or changing Match.

### Visible behaviour, saved grades, locals and remaining work

Steve sees **no change in the app** from this work. Both lanes remain
independent; Match does not yet create a live link. No production code or
schema is changed, so saved grades and protected projects have **zero rendering
change from this attempt**. The original counterfactual DSC00950 10.050 and
DSC00264 15.317 P95 drifts above are not applied to those projects.

The proposed local contract, **not implemented**, is to evaluate HDR local
grades and their shared, source-anchored masks once in the common pre-Film
prefix. Do not stack the independent SDR locals on top. An actual SDR local
creative edit would unlink the photo and use today's independent SDR renderer;
a refused/no-op local Match must not unlink it. Whole-picture Match must retain
N4's confirmation before replacing authored SDR locals. This needs explicit
Undo/Redo, bypass, overlapping-mask, HDR-change and local-Match tests; the
no-local trial does not certify any of them.

Still required: an accepted tail and visible late-trim semantics; CPU and
WebGPU integration with a single Film evaluation; live linked/unlinked state,
Match/unlink/edit transactions and saved format; authored-SDR/source handling;
GPU/CPU pre-encode agreement (mean <1, P99.9 <=3 in the lane's required metric);
native Film/lens/grain/halation/local coverage; export/Proof qualification; and
real slider action-to-current-picture timing before/after on this Mac. The
existing paired CPU microbenchmark is not substituted for that whole wait.
The prior research GPU compile failure is not claimed repaired or qualified.
No shipping tooltips are regenerated and unapplied catalogue edits are left
alone. User guides are not rewritten to describe an unavailable feature.

Reproduce from `codebase`, after producing the original chart fixtures and
shared RAW derivatives using section 8:

```sh
.venv/bin/python tools/linked_sdr_tail_probe.py --baseline --output output/review/linked-sdr-tail
.venv/bin/python tools/linked_sdr_tail_probe.py --population chart176 --output output/review/linked-sdr-tail
.venv/bin/python tools/linked_sdr_tail_probe.py --population chart224 --output output/review/linked-sdr-tail
.venv/bin/python -m pytest tests/test_linked_sdr_tail_probe.py -q
```

Each result retains code/backend hashes; the baseline also fingerprints its
reused inputs, and the searches fingerprint each original chart fixture.
Only compact JSON and validation logs are retained under
`codebase/output/review/linked-sdr-tail/`. Validation of this research change:

- New focused tool checks: **8 passed** (neutral incumbent-tail identity,
  legal/luminance-preserving research gamut output, unchanged inclusive body
  limits, chart grouping, geometry rejection and JSON-safe results).
- Full Node suite: **1,091 passed / one skipped**. Full Python suite:
  **3,837 passed / nine failed / 144 skipped / one xpassed**. The failures are
  two HSL upstream-cache reuse assertions, three Library GPU native
  admission/ownership cases and four Library native retention/decode/admission
  cases. Exact names and traces are in `python-fast.log`. No production/cache
  code changes here; these failures are outside the changed research paths and
  were not repaired or rerun. This is **not a green fast-suite claim**.
- The default **90-second Library smoke passes**, nine photos pictured,
  no memory violation, through `tools/gpu-run-lock.py`, window 1408×794.
  Its report is `codebase/output/quick-library-check/m1-linked-sdr-tail/report.json`;
  launch log is `library-smoke.log`. This is the only Electron run for this
  attempt, not a Film/Match/rendering qualification. No overlapping GPU runs.
- Film/Match/SDR GPU drivers and Still-strict delivery checks are **not run**:
  there is no accepted tail or production path to qualify. Once implemented,
  the selection must cover `film-stock-parity.js`, `tiled-film-parity.js`,
  `sdr-match-gpu-interaction.js`, `sdr-gamut-gpu-parity.js`, local linked/unlink
  interaction, and the SDR-carrying delivery/Proof paths, including
  `gpu-delivery-smoke.js`, `gpu-delivery-repeat.js`, `proof-size-interaction.js`
  and `hdr-ceiling-delivery.js`. Use the release inventory to select all
  affected output checks and estimate before running; stop/ask if the slow
  selection exceeds roughly 30 minutes. No release or strict-output pass is
  claimed from the research result or the Library smoke.
- Scratch output is **13.6 GB**, below the 100 GB limit (13.6 GB at start).
  The owned pytest temporary tree and superseded probe logs are removed;
  the compact research evidence and Library smoke report remain. Other
  workers' changes and test output are not deleted or included in these commits.

No push, protected-file writes, test relaxation,
migration, cache/budget change or encoder/export/Proof tooling edits.

## 10. Safe-link implementation and final scoped qualification (November 16)

Steve replaced the always-link plan with **try linking, otherwise use the
existing independent fit**. He then approved target-relative ordering for
linked SDR only: use the same HDR-brightness bins and .005 allowance, judge
SDR's negative adjacent median steps beyond the target's own negative steps.
Independent ordering is unchanged. All other gates remain unchanged.

The shipping CPU and WebGPU paths now evaluate HDR creatives, source-anchored
HDR locals and Film once per render, with an SDR-specific output tail. Match
also reuses its one common Film array to derive settled HDR and search the
19 tails. It chooses the body/colour-best tail **before** acceptance; it does
not select a broader/darker tail just to obtain a link. Linked SDR preserves
HDR's body response, then gently compresses the bright end. The print curve
alone still does not replace SDR HC/gamut mapping.

The panel visibly says **Linked to HDR**, offers **Unlink** and a post-Film
**SDR output exposure** trim. HDR changes flow live. Editing SDR's own creative
controls or actual SDR local grade unlinks in the same Undo transaction;
shared mask/opacity/bypass and refused/equal Local Match keep the link without
adding a history step. A pending HDR global save cannot capture the optimistic
SDR-local unlink: its local transaction owns that unlink and inverse. A changed
Local Match explains that it fits independent SDR and unlinks. N4 overwrite
confirmation is retained. HDR Denoise feeds the common scene and is mirrored
through the existing source routes; an unpreparable Denoise source safely
falls back. HDR Denoise Undo/Redo retains the link. Live pacing and native peak/Clarity
measurement select the HDR creative/local recipe while linked. Library paste excludes
link/output metadata and unlinks actual SDR creative pastes.

### Counts under both ordering rules

Same original 176/224 charts and five <=512px RAW derivatives, seven looks
(Film off, Portra/Ektar/Velvia at 50/100%), current CPU renderer, grain/halation
and locals off. This is a bounded corpus, not an all-photo acceptance rate.
The following is **linked / fallback**, not matched / refused:

| Population | Old absolute ordering | Approved target-relative ordering |
| --- | --- | --- |
| chart176 | 0 / 7 | 2 / 5 |
| chart224 | 0 / 7 | 3 / 4 |
| A7R00619.ARW | 3 / 4 | 3 / 4 |
| DSC00264.ARW | 7 / 0 | 7 / 0 |
| IMG_3129.CR2 | 1 / 6 | 7 / 0 |
| IMG_0790.CR2 | 6 / 1 | 6 / 1 |
| IMG_7723.CR3 | 6 / 1 | 6 / 1 |
| **All 49** | **23 / 26** | **34 / 15** |
| **Five RAWs × seven looks** | **23 / 12** | **29 / 6** |

Under the approved rule, twelve proposals fail white growth, two fail excess
ordering (chart224 Portra 100% and Ektar 100%), one fails calibrated exposure
editability (IMG_0790 Velvia 100%). The selected linked tail otherwise passes
the normal .010/.030 luma and .015/.040 OKLab median/P95 limits. Worst linked
body P95 is .006182 luma and .019160 OKLab; maximum white growth .893 points,
within the original one-point limit. No check is redefined beyond Steve's
explicit ordering decision.

The 15 fallbacks retain the incumbent fit: **2 matched, 10 needs review,
3 refused**. Refused: chart176 Velvia 100%, chart224 Velvia 50%/100%. All 35
RAW/look cases return a usable linked or independent fit. With the old rule,
the 26 fallbacks contained 6 matched / 15 review / 5 refused. Neither policy
counts a rejected candidate as a rendered Match.

### Colour: linked and independent fallback

All numbers below are residual Delta E 2000 against the unchanged SDR Match
target built from settled HDR. RAW highlights use the original >.9 HDR-normalized
luma mask. Values <.001 are measured nonzero results. The linked chart bright
hue/stop maximum over +1/+2/+3 is **.519** (176) and **.660** (224); the accepted
fallback chart maxima remain **17.991** and **14.244**. Refused charts are excluded.

| RAW | Linked whole-frame P95 range | Linked highlight P95 range | Fallback whole-frame / highlight P95 range |
| --- | --- | --- | --- |
| A7R00619 | .228–.236 | .502–.842 | 6.222–7.865 / 7.734–8.930 |
| DSC00264 | .037–.267 | .645–1.206 | none |
| IMG_3129 | <.001 | .918–1.705 | none |
| IMG_0790 | <.001–3.222 | .111–1.002 | 4.748 / 8.884 |
| IMG_7723 | <.001–.349 | .015–.872 | 7.063 / 8.314 |

The 3.222 whole-frame result remains an explicit limit to any “all <3” claim.
Independent fallback still has the older larger highlight-colour errors.
Under the old ordering rule, linked RAW highlight P95 was .015–1.539;
accepted fallback highlights spanned 7.734–15.528. Every returned recipe keeps
HDR arrays bitwise unchanged. [Full two-rule cases, quality, per-hue/stop colour
and input/backend fingerprints](../../../codebase/output/review/safe-link/corpus.json).

### GPU, delivery, history, speed and saved grades

The common Film is implemented in the production shader, with appended linked
output fields and unchanged prior positions. Shader compilation and 24 actual
preview/direct/tiled finished-float comparisons pass: Film off, Portra, Ektar,
Velvia, all four SDR HC modes and a late exposure trim, plus grain, lens,
halation, Detail and overlapping/hue HDR locals.
Worst mean **.054**, P99.9 **.168 Delta E00**, inside <1 / <=3. Direct and tiled
delivery results agree. Preview is compared to the CPU preview; delivery is
compared to CPU resize/sharpen/nonnegative finishing followed by HC/gamut,
all before encoding. An initial expanded harness compared delivery to the
pre-finishing preview reference; that reference-stage error was corrected,
with no tolerance or production-finishing change. [GPU results](../../../codebase/output/review/safe-link/gpu.json).

Real UI/history and linked JPEG Ultra HDR delivery pass. Finished GPU/CPU
agreement is HDR **0.077/0.200 Delta E ITP**, SDR **0.031/0.118 Delta E00**
(mean/P99.9). HDR finished maxima are 999.999878 GPU / 1000 CPU nits.
GPU and CPU full/reduced Proof bytes equal their matching exports on this
bounded same-size fixture. Encoded own-source and decoded-pair colour numbers
remain separately reported diagnostics; the pre-existing lossy JPEG tails are
not claimed fixed. [Interaction and delivery results](../../../codebase/output/review/safe-link/interaction.json).

The visible link block was checked at 1408×794 and 1100×720 using existing
font/colour/radius tokens. The old whole-Match status was visually clipped;
that clipping is removed. A real visibility check now protects the link label.
Local Match also explains its changed-result unlink semantics. Tooltip catalogue
regeneration first compared its owning source revision: **zero unapplied text
edits**, so no Steve wording was overwritten.

Whole-slider measurements use the Neo A18 Pro / 8 GB, 1408×794, DPR 2, a
24.064 MP deterministic source, Portra 400 at 50%, grain/halation off, warmed
Fit processing at 1290px. Normal control handlers run to the exact current SDR
picture plus two animation frames. The controlled before uses the former eager
WGSL prefix evaluation; after evaluates only the active lane. Independent SDR
Exposure median **104.9→82.7 ms**, range **86.5–138.9→58.4–129.8**; wide overlap
does not prove a stable general gain. Linked HDR-Exposure-to-SDR median
**66.6→65.3 ms**, range **63.7–81.8→64.3–85.7**, normal variation within the
recorded ±10% exploratory noise. This is not a native 100% or Steve's original
slow-photo benchmark. The older diagnostic forced a 2560px viewport and is
excluded. Conditions and records: [performance table](../performance-table.md),
`codebase/output/performance/safe-link/controlled-{before,after}.json`.

New recipe fields are `sdr.linked_to_hdr` (default false), `sdr.output_exposure`
and a diagnostic fallback reason. No migration/old-renderer path. **Only photos
that Steve newly Matches and that link change SDR rendering.** Existing
independent grades and the saved DSC00264 HDR-Vision3/SDR-Film-off grade keep
independent processing. Protected DSC00950, DSC00264-four-masks and
DSC00264-fifty-locals projects are unchanged; their hashes are checked.

### Validation and remaining selection

- Full Node: **1,091 passed / one skipped**. Full Python: **3,875 passed /
  144 skipped / one xpassed**. Focused final history/Match/paste tests: **103 passed**;
  HSL/hue integration: **58 passed**; final frontend contracts **33 passed**,
  tooltip/layout sanity **10 passed**. No failing fast test is hidden by the
  initial helper-layout/paste catalogue failures; those owned causes are fixed.
- Pass: full **33-case SDR Film stock** matrix, tiled Film/grain, SDR gamut,
  local Detail/Film, GPU delivery smoke, repeat plus CPU comparison, Proof
  sizes, and all-codec HDR ceiling across CPU/GPU export and both Proof sizes.
  The initial stock supervisor killed its wrapper before the child completed;
  the sole GPU child finished the matrix under the retained lock, and only
  that verified dead owned lock was cleared. Later runs use wrapper deadlines.
- The old `sdr-match-gpu-interaction.js` still fails **before Match**, “Could not
  prepare the HDR Match browser fixture”; unchanged known limitation. The new
  linked real-app driver passes the actual Match, live edits and history flow.
- Default 90s Library viewport smoke passes, **9/9 requested pictured**, no
  errors or reserve violation; external tree peak 3.03 GB. Viewport-only scope.
- All Electron checks use the shared lock, one at a time. Own slow validation
  stays within the requested roughly 30-minute allowance; there is no release
  or full sweep claim. [Driver ledger](../../../codebase/output/review/safe-link/slow-checks.json)
  and [final checks](../../../codebase/output/review/safe-link/final-checks.json).
- Not run in this worker's remaining export/Proof selection: high-fidelity JXL
  (owned by the other worker), HSL selection/global/local delivery, Tone-zone,
  desaturation, hue-mask delivery, proof-grade diagnostic, GPU Denoise
  measurement, file-browser/preset export, Local Match native delivery,
  highlight-delivery floor, performance export parity / protected-project
  preview-export comparison, batch export, Library export menu, GPU delivery
  ceiling, RAW edge-colour, GPU edge-colour, HSL integration and photo framing.
  Exact commands are in `codebase/output/safe-link-release-plan.log`; the
  explicitly run ceiling/Film/SDR checks above are not silently waived.
- Still open: visual sign-off, the older Match fixture, full-native five RAWs
  across all Film/lens/grain settings, and Steve's slow Film-on photo at native
  zoom. The 49-case proxies do not certify those populations.

Scratch output finishes at **13.7 GB** (13.6 GB at start), below the 100 GB
limit. The generated 289 MB benchmark derivative and owned temporary profiles/
float references are removed; compact JSON, logs and panel crops remain. Other
workers’ output is left in place.

No push, installer, protected-project save, tolerance relaxation, cache/budget
increase, or exporter/codec/export-preset change belongs to this work.

## Appendix A. Every hue family and stop, before → after P95 ΔE00

Each coloured cell is the P95 of its **three saturation patches**; grey has
one patch. These tiny deterministic groups are descriptive, not population
confidence intervals. Refused configurations remain “—” before; after is a
research fit even when another safeguard fails. Stops -4…0 show body detail;
the goal's bright stops are +1…+3. P50/P100, E50/E100 and V50/V100 mean the
stocks/strengths listed above. Rounded values below do not replace the full
precision CSV or the separate unchanged body-gate metrics.



### chart176


| Hue | Stop | Off | P50 | P100 | E50 | E100 | V50 | V100 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cyan | -4 | 0.04 → <0.001 | 0.73 → <0.001 | 2.21 → <0.001 | 0.63 → <0.001 | 1.10 → <0.001 | 0.34 → <0.001 | — → <0.001 |
| cyan | -3 | 0.07 → <0.001 | 1.96 → <0.001 | 4.38 → <0.001 | 2.36 → <0.001 | 4.17 → <0.001 | 1.74 → <0.001 | — → <0.001 |
| cyan | -2 | 0.11 → <0.001 | 2.56 → <0.001 | 5.54 → <0.001 | 2.93 → <0.001 | 6.00 → <0.001 | 1.99 → <0.001 | — → <0.001 |
| cyan | -1 | 0.14 → <0.001 | 1.53 → <0.001 | 3.45 → <0.001 | 1.84 → <0.001 | 4.69 → <0.001 | 1.48 → <0.001 | — → <0.001 |
| cyan | +0 | 0.09 → <0.001 | 1.03 → <0.001 | 1.45 → <0.001 | 1.10 → <0.001 | 2.36 → <0.001 | 0.46 → <0.001 | — → <0.001 |
| cyan | +1 | 12.63 → 0.26 | 14.55 → 0.52 | 2.54 → 0.97 | 14.59 → 0.52 | 3.45 → 1.02 | 14.71 → 0.55 | — → 0.28 |
| cyan | +2 | 6.13 → 0.34 | 8.52 → 0.51 | 8.15 → 0.39 | 8.36 → 0.51 | 7.68 → 0.39 | 8.04 → 0.51 | — → 0.65 |
| cyan | +3 | 3.07 → 0.33 | 4.24 → 0.40 | 3.96 → 0.38 | 4.14 → 0.39 | 3.70 → 0.39 | 3.95 → 0.39 | — → 0.42 |
| denim | -4 | 0.05 → <0.001 | 0.69 → <0.001 | 1.44 → <0.001 | 0.76 → <0.001 | 1.33 → <0.001 | 0.07 → <0.001 | — → <0.001 |
| denim | -3 | 0.09 → <0.001 | 2.16 → <0.001 | 6.45 → <0.001 | 2.62 → <0.001 | 5.82 → <0.001 | 0.25 → <0.001 | — → <0.001 |
| denim | -2 | 0.14 → <0.001 | 2.62 → <0.001 | 6.50 → <0.001 | 3.00 → <0.001 | 7.67 → <0.001 | 0.58 → <0.001 | — → <0.001 |
| denim | -1 | 0.12 → <0.001 | 1.48 → <0.001 | 1.37 → <0.001 | 1.78 → <0.001 | 2.78 → <0.001 | 0.39 → <0.001 | — → <0.001 |
| denim | +0 | 0.07 → <0.001 | 1.04 → <0.001 | 1.41 → <0.001 | 1.04 → <0.001 | 1.47 → <0.001 | 0.43 → <0.001 | — → <0.001 |
| denim | +1 | 10.96 → 0.22 | 11.87 → 0.48 | 5.47 → 1.18 | 11.99 → 0.49 | 6.00 → 1.26 | 10.85 → 0.38 | — → 0.74 |
| denim | +2 | 4.78 → 0.25 | 5.89 → 0.36 | 6.93 → 0.27 | 5.88 → 0.36 | 6.70 → 0.26 | 4.49 → 0.32 | — → 0.33 |
| denim | +3 | 1.51 → 0.25 | 2.63 → 0.31 | 3.31 → 0.26 | 2.61 → 0.31 | 3.20 → 0.25 | 1.80 → 0.28 | — → 0.18 |
| green | -4 | 0.04 → <0.001 | 0.77 → <0.001 | 2.21 → <0.001 | 0.72 → <0.001 | 1.33 → <0.001 | 0.18 → <0.001 | — → <0.001 |
| green | -3 | 0.06 → <0.001 | 1.73 → <0.001 | 1.63 → <0.001 | 2.02 → <0.001 | 1.75 → <0.001 | 2.06 → <0.001 | — → 0.00 |
| green | -2 | 0.10 → <0.001 | 2.52 → <0.001 | 3.06 → <0.001 | 2.88 → <0.001 | 3.51 → <0.001 | 2.69 → <0.001 | — → <0.001 |
| green | -1 | 0.16 → <0.001 | 1.56 → <0.001 | 0.46 → <0.001 | 1.90 → <0.001 | 2.57 → <0.001 | 1.37 → <0.001 | — → <0.001 |
| green | +0 | 0.07 → <0.001 | 1.15 → <0.001 | 1.41 → <0.001 | 1.21 → <0.001 | 1.44 → <0.001 | 0.50 → <0.001 | — → <0.001 |
| green | +1 | 10.98 → 0.26 | 13.34 → 0.39 | 2.17 → 0.14 | 13.34 → 0.49 | 2.15 → 0.13 | 12.97 → 0.35 | — → 0.27 |
| green | +2 | 5.40 → 0.18 | 9.85 → 0.09 | 10.71 → 0.23 | 9.90 → 0.09 | 10.49 → 0.26 | 9.41 → 0.10 | — → 0.39 |
| green | +3 | 2.55 → 0.18 | 4.81 → 0.12 | 5.34 → 0.25 | 4.83 → 0.12 | 5.22 → 0.27 | 4.52 → 0.12 | — → 0.07 |
| grey | -4 | 0.03 → <0.001 | 0.41 → <0.001 | 0.47 → <0.001 | 0.39 → <0.001 | 0.25 → <0.001 | 0.05 → <0.001 | — → 0.00 |
| grey | -3 | 0.06 → 0.00 | 1.62 → <0.001 | 1.19 → 0.00 | 1.65 → 0.00 | 0.99 → 0.00 | 0.18 → <0.001 | — → <0.001 |
| grey | -2 | 0.10 → <0.001 | 2.52 → <0.001 | 1.62 → <0.001 | 2.90 → 0.00 | 2.01 → <0.001 | 0.57 → <0.001 | — → <0.001 |
| grey | -1 | 0.14 → 0.00 | 1.47 → 0.00 | 0.01 → <0.001 | 1.79 → <0.001 | 0.16 → <0.001 | 0.32 → <0.001 | — → 0.00 |
| grey | +0 | 0.08 → 0.00 | 1.05 → <0.001 | 1.16 → 0.00 | 1.03 → <0.001 | 1.04 → <0.001 | 0.44 → 0.00 | — → <0.001 |
| grey | +1 | 2.58 → 0.01 | 4.02 → 0.06 | 2.51 → 0.53 | 4.10 → 0.07 | 2.53 → 0.54 | 3.61 → 0.07 | — → 0.31 |
| grey | +2 | 0.98 → 0.01 | 1.45 → 0.34 | 1.47 → 0.02 | 1.49 → 0.12 | 1.60 → 0.02 | 1.35 → 0.43 | — → 0.57 |
| grey | +3 | 0.43 → 0.00 | 0.69 → 0.15 | 0.94 → 0.01 | 0.75 → 0.05 | 1.14 → 0.01 | 0.70 → 0.16 | — → 0.19 |
| indigo | -4 | 0.06 → <0.001 | 0.69 → <0.001 | 1.27 → <0.001 | 0.80 → <0.001 | 1.18 → <0.001 | 0.07 → <0.001 | — → <0.001 |
| indigo | -3 | 0.10 → <0.001 | 1.97 → <0.001 | 3.49 → <0.001 | 2.13 → <0.001 | 2.45 → <0.001 | 0.22 → 0.00 | — → <0.001 |
| indigo | -2 | 0.16 → <0.001 | 2.67 → <0.001 | 1.71 → <0.001 | 3.00 → <0.001 | 2.47 → <0.001 | 0.61 → <0.001 | — → <0.001 |
| indigo | -1 | 0.11 → <0.001 | 1.50 → <0.001 | 0.09 → <0.001 | 1.80 → <0.001 | 0.12 → <0.001 | 0.43 → <0.001 | — → <0.001 |
| indigo | +0 | 0.06 → <0.001 | 0.94 → 0.00 | 1.73 → <0.001 | 0.87 → <0.001 | 1.65 → <0.001 | 0.42 → <0.001 | — → <0.001 |
| indigo | +1 | 10.75 → 0.24 | 14.43 → 0.37 | 5.19 → 1.35 | 14.54 → 0.39 | 5.42 → 1.35 | 13.48 → 0.29 | — → 0.42 |
| indigo | +2 | 2.25 → 0.25 | 5.02 → 0.25 | 4.90 → 0.12 | 5.05 → 0.25 | 4.44 → 0.10 | 3.75 → 0.26 | — → 0.13 |
| indigo | +3 | 0.88 → 0.25 | 1.49 → 0.23 | 2.28 → 0.11 | 1.53 → 0.23 | 2.06 → 0.10 | 1.13 → 0.23 | — → 0.06 |
| magenta | -4 | 0.05 → <0.001 | 0.74 → <0.001 | 1.92 → <0.001 | 0.78 → <0.001 | 1.70 → <0.001 | 0.09 → <0.001 | — → <0.001 |
| magenta | -3 | 0.08 → <0.001 | 1.91 → <0.001 | 1.67 → <0.001 | 2.13 → <0.001 | 1.80 → <0.001 | 0.18 → <0.001 | — → <0.001 |
| magenta | -2 | 0.12 → <0.001 | 2.50 → <0.001 | 1.50 → <0.001 | 2.74 → <0.001 | 1.61 → <0.001 | 0.60 → <0.001 | — → <0.001 |
| magenta | -1 | 0.14 → <0.001 | 1.36 → <0.001 | 0.03 → <0.001 | 1.71 → <0.001 | 0.14 → <0.001 | 0.34 → <0.001 | — → <0.001 |
| magenta | +0 | 0.06 → <0.001 | 1.07 → <0.001 | 1.36 → <0.001 | 1.14 → <0.001 | 1.58 → <0.001 | 0.53 → <0.001 | — → <0.001 |
| magenta | +1 | 7.84 → 0.07 | 15.61 → 0.16 | 5.05 → 0.00 | 15.83 → 0.19 | 5.28 → <0.001 | 15.09 → 0.31 | — → 0.48 |
| magenta | +2 | 1.38 → 0.08 | 4.70 → 0.18 | 7.71 → 0.09 | 4.78 → 0.19 | 7.64 → 0.07 | 5.22 → 0.24 | — → 0.00 |
| magenta | +3 | 0.63 → 0.08 | 1.97 → 0.12 | 2.44 → 0.09 | 1.99 → 0.13 | 2.01 → 0.08 | 2.34 → 0.16 | — → 0.00 |
| red | -4 | 0.03 → <0.001 | 0.75 → <0.001 | 1.84 → <0.001 | 0.81 → <0.001 | 1.46 → <0.001 | 0.13 → <0.001 | — → <0.001 |
| red | -3 | 0.05 → <0.001 | 1.73 → <0.001 | 1.50 → <0.001 | 2.01 → <0.001 | 1.50 → <0.001 | 0.16 → <0.001 | — → <0.001 |
| red | -2 | 0.08 → <0.001 | 2.30 → <0.001 | 1.47 → <0.001 | 2.43 → <0.001 | 1.49 → <0.001 | 0.54 → <0.001 | — → <0.001 |
| red | -1 | 0.20 → <0.001 | 1.37 → <0.001 | 0.02 → <0.001 | 1.70 → <0.001 | 0.19 → <0.001 | 0.28 → <0.001 | — → <0.001 |
| red | +0 | 0.04 → <0.001 | 0.97 → <0.001 | 1.49 → <0.001 | 1.02 → <0.001 | 1.72 → <0.001 | 0.49 → <0.001 | — → <0.001 |
| red | +1 | 7.72 → 0.17 | 17.99 → 0.34 | 1.24 → <0.001 | 17.75 → 0.35 | 1.40 → <0.001 | 14.75 → 0.22 | — → 0.62 |
| red | +2 | 1.21 → 0.17 | 3.86 → 0.11 | 13.89 → 0.71 | 3.93 → 0.12 | 14.55 → 0.18 | 2.78 → 0.11 | — → 0.03 |
| red | +3 | 0.46 → 0.17 | 1.39 → 0.14 | 2.16 → 0.14 | 1.41 → 0.15 | 1.97 → 0.16 | 0.55 → 0.13 | — → 0.22 |
| skin | -4 | 0.03 → <0.001 | 0.63 → <0.001 | 1.68 → <0.001 | 0.57 → <0.001 | 1.06 → <0.001 | 0.11 → <0.001 | — → <0.001 |
| skin | -3 | 0.06 → <0.001 | 1.81 → <0.001 | 1.73 → <0.001 | 1.93 → <0.001 | 1.70 → <0.001 | 0.18 → <0.001 | — → <0.001 |
| skin | -2 | 0.09 → <0.001 | 2.56 → <0.001 | 1.75 → <0.001 | 2.86 → <0.001 | 2.17 → <0.001 | 0.57 → <0.001 | — → <0.001 |
| skin | -1 | 0.17 → <0.001 | 1.47 → <0.001 | 0.01 → <0.001 | 1.81 → <0.001 | 0.20 → <0.001 | 0.33 → <0.001 | — → <0.001 |
| skin | +0 | 0.07 → <0.001 | 1.17 → <0.001 | 1.72 → <0.001 | 1.19 → <0.001 | 1.78 → <0.001 | 0.48 → <0.001 | — → <0.001 |
| skin | +1 | 7.85 → 0.24 | 12.59 → 0.00 | 5.50 → 0.83 | 12.98 → 0.00 | 5.64 → 0.90 | 10.73 → 0.10 | — → 1.98 |
| skin | +2 | 2.48 → 0.21 | 3.95 → 0.00 | 4.43 → 0.00 | 4.08 → 0.00 | 4.71 → 0.00 | 3.64 → 0.00 | — → 0.24 |
| skin | +3 | 0.89 → 0.22 | 1.34 → 0.00 | 1.57 → 0.00 | 1.37 → 0.00 | 1.66 → 0.00 | 1.27 → 0.00 | — → 0.09 |


### chart224


| Hue | Stop | Off | P50 | P100 | E50 | E100 | V50 | V100 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bt2020_blue | -4 | 0.14 → 0.00 | — → <0.001 | 8.77 → 0.00 | — → <0.001 | 6.12 → <0.001 | — → <0.001 | — → <0.001 |
| bt2020_blue | -3 | 0.19 → <0.001 | — → 0.00 | 9.27 → 0.00 | — → <0.001 | 10.95 → <0.001 | — → <0.001 | — → 0.00 |
| bt2020_blue | -2 | 0.20 → <0.001 | — → <0.001 | 9.30 → 0.00 | — → 0.00 | 8.91 → <0.001 | — → <0.001 | — → <0.001 |
| bt2020_blue | -1 | 0.07 → <0.001 | — → <0.001 | 7.65 → <0.001 | — → <0.001 | 7.63 → <0.001 | — → <0.001 | — → <0.001 |
| bt2020_blue | +0 | 0.09 → 0.00 | — → <0.001 | 7.39 → <0.001 | — → <0.001 | 7.05 → <0.001 | — → 0.00 | — → <0.001 |
| bt2020_blue | +1 | 8.61 → 0.65 | — → 0.21 | 8.91 → <0.001 | — → 0.23 | 7.59 → <0.001 | — → 0.25 | — → <0.001 |
| bt2020_blue | +2 | 1.23 → 0.66 | — → 0.62 | 7.36 → 0.32 | — → 0.61 | 7.10 → 0.31 | — → 0.63 | — → 0.34 |
| bt2020_blue | +3 | 0.91 → 0.66 | — → 0.60 | 6.26 → 0.47 | — → 0.59 | 5.91 → 0.46 | — → 0.61 | — → 0.66 |
| bt2020_green | -4 | 0.14 → 0.10 | — → <0.001 | 2.20 → <0.001 | — → <0.001 | 0.36 → <0.001 | — → <0.001 | — → 0.00 |
| bt2020_green | -3 | 0.16 → 0.12 | — → <0.001 | 2.93 → <0.001 | — → <0.001 | 1.23 → 0.00 | — → <0.001 | — → <0.001 |
| bt2020_green | -2 | 0.15 → 0.12 | — → <0.001 | 6.09 → 0.00 | — → <0.001 | 5.34 → <0.001 | — → <0.001 | — → <0.001 |
| bt2020_green | -1 | 0.25 → 0.11 | — → 0.00 | 7.07 → <0.001 | — → 0.00 | 6.22 → <0.001 | — → 0.00 | — → 0.00 |
| bt2020_green | +0 | 0.12 → 0.12 | — → <0.001 | 6.96 → <0.001 | — → <0.001 | 6.07 → <0.001 | — → <0.001 | — → <0.001 |
| bt2020_green | +1 | 4.02 → 0.10 | — → 0.20 | 6.92 → <0.001 | — → 0.24 | 6.24 → <0.001 | — → 0.18 | — → <0.001 |
| bt2020_green | +2 | 1.75 → 0.10 | — → 0.09 | 9.05 → 0.15 | — → 0.09 | 8.20 → 0.18 | — → 0.10 | — → 0.58 |
| bt2020_green | +3 | 0.84 → 0.10 | — → 0.03 | 6.69 → 0.16 | — → 0.03 | 5.71 → 0.18 | — → 0.03 | — → 0.33 |
| cyan | -4 | 0.04 → <0.001 | — → <0.001 | 2.71 → <0.001 | — → <0.001 | 0.27 → <0.001 | — → <0.001 | — → <0.001 |
| cyan | -3 | 0.07 → <0.001 | — → <0.001 | 5.19 → <0.001 | — → <0.001 | 2.27 → <0.001 | — → <0.001 | — → <0.001 |
| cyan | -2 | 0.06 → <0.001 | — → <0.001 | 4.13 → <0.001 | — → <0.001 | 5.69 → <0.001 | — → <0.001 | — → <0.001 |
| cyan | -1 | 0.23 → <0.001 | — → <0.001 | 3.66 → <0.001 | — → <0.001 | 3.55 → <0.001 | — → <0.001 | — → <0.001 |
| cyan | +0 | 0.08 → <0.001 | — → <0.001 | 1.41 → <0.001 | — → <0.001 | 2.52 → <0.001 | — → <0.001 | — → <0.001 |
| cyan | +1 | 12.63 → 0.26 | — → 0.52 | 3.00 → 0.97 | — → 0.52 | 3.51 → 1.02 | — → 0.55 | — → 0.28 |
| cyan | +2 | 6.13 → 0.34 | — → 0.51 | 7.67 → 0.39 | — → 0.51 | 9.45 → 0.39 | — → 0.51 | — → 0.65 |
| cyan | +3 | 3.07 → 0.33 | — → 0.40 | 3.49 → 0.38 | — → 0.39 | 5.31 → 0.39 | — → 0.39 | — → 0.42 |
| denim | -4 | 0.05 → <0.001 | — → <0.001 | 3.83 → <0.001 | — → <0.001 | 0.10 → <0.001 | — → <0.001 | — → <0.001 |
| denim | -3 | 0.08 → <0.001 | — → <0.001 | 5.58 → <0.001 | — → <0.001 | 4.25 → <0.001 | — → <0.001 | — → <0.001 |
| denim | -2 | 0.09 → <0.001 | — → <0.001 | 5.01 → <0.001 | — → <0.001 | 6.32 → <0.001 | — → <0.001 | — → <0.001 |
| denim | -1 | 0.22 → <0.001 | — → <0.001 | 1.09 → <0.001 | — → <0.001 | 2.73 → <0.001 | — → <0.001 | — → <0.001 |
| denim | +0 | 0.07 → <0.001 | — → <0.001 | 0.73 → <0.001 | — → <0.001 | 1.61 → <0.001 | — → <0.001 | — → <0.001 |
| denim | +1 | 10.96 → 0.22 | — → 0.48 | 6.15 → 1.18 | — → 0.49 | 5.88 → 1.26 | — → 0.38 | — → 0.74 |
| denim | +2 | 4.78 → 0.25 | — → 0.36 | 6.87 → 0.27 | — → 0.36 | 6.51 → 0.26 | — → 0.32 | — → 0.33 |
| denim | +3 | 1.51 → 0.25 | — → 0.31 | 3.11 → 0.26 | — → 0.31 | 3.16 → 0.25 | — → 0.28 | — → 0.18 |
| green | -4 | 0.04 → <0.001 | — → <0.001 | 2.38 → <0.001 | — → <0.001 | 0.28 → <0.001 | — → <0.001 | — → <0.001 |
| green | -3 | 0.06 → <0.001 | — → <0.001 | 3.56 → <0.001 | — → <0.001 | 0.52 → <0.001 | — → <0.001 | — → 0.00 |
| green | -2 | 0.05 → <0.001 | — → <0.001 | 3.08 → <0.001 | — → <0.001 | 3.22 → <0.001 | — → <0.001 | — → <0.001 |
| green | -1 | 0.26 → <0.001 | — → <0.001 | 0.84 → <0.001 | — → <0.001 | 2.46 → <0.001 | — → <0.001 | — → <0.001 |
| green | +0 | 0.06 → <0.001 | — → <0.001 | 1.64 → <0.001 | — → <0.001 | 2.14 → <0.001 | — → <0.001 | — → <0.001 |
| green | +1 | 10.98 → 0.26 | — → 0.39 | 2.21 → 0.14 | — → 0.49 | 2.96 → 0.13 | — → 0.35 | — → 0.27 |
| green | +2 | 5.40 → 0.18 | — → 0.09 | 10.66 → 0.23 | — → 0.09 | 11.08 → 0.26 | — → 0.10 | — → 0.39 |
| green | +3 | 2.55 → 0.18 | — → 0.12 | 4.97 → 0.25 | — → 0.12 | 6.71 → 0.27 | — → 0.12 | — → 0.07 |
| grey | -4 | 0.04 → <0.001 | — → <0.001 | 2.32 → <0.001 | — → <0.001 | 0.18 → <0.001 | — → <0.001 | — → 0.00 |
| grey | -3 | 0.06 → 0.00 | — → <0.001 | 7.59 → 0.00 | — → 0.00 | 1.25 → 0.00 | — → <0.001 | — → <0.001 |
| grey | -2 | 0.05 → <0.001 | — → <0.001 | 7.14 → <0.001 | — → 0.00 | 0.95 → <0.001 | — → <0.001 | — → <0.001 |
| grey | -1 | 0.24 → 0.00 | — → 0.00 | 0.97 → <0.001 | — → <0.001 | 3.24 → <0.001 | — → <0.001 | — → 0.00 |
| grey | +0 | 0.07 → 0.00 | — → <0.001 | 1.53 → 0.00 | — → <0.001 | 3.51 → <0.001 | — → 0.00 | — → <0.001 |
| grey | +1 | 2.58 → 0.01 | — → 0.06 | 2.57 → 0.53 | — → 0.07 | 2.61 → 0.54 | — → 0.07 | — → 0.31 |
| grey | +2 | 0.98 → 0.01 | — → 0.34 | 1.55 → 0.02 | — → 0.12 | 2.86 → 0.02 | — → 0.43 | — → 0.57 |
| grey | +3 | 0.43 → 0.00 | — → 0.15 | 1.48 → 0.01 | — → 0.05 | 3.35 → 0.01 | — → 0.16 | — → 0.19 |
| indigo | -4 | 0.06 → <0.001 | — → <0.001 | 3.27 → <0.001 | — → <0.001 | 0.15 → <0.001 | — → <0.001 | — → <0.001 |
| indigo | -3 | 0.10 → <0.001 | — → <0.001 | 5.56 → <0.001 | — → <0.001 | 1.43 → <0.001 | — → 0.00 | — → <0.001 |
| indigo | -2 | 0.11 → <0.001 | — → <0.001 | 4.25 → <0.001 | — → <0.001 | 0.84 → <0.001 | — → <0.001 | — → <0.001 |
| indigo | -1 | 0.21 → <0.001 | — → <0.001 | 0.88 → <0.001 | — → <0.001 | 2.37 → <0.001 | — → <0.001 | — → <0.001 |
| indigo | +0 | 0.06 → <0.001 | — → 0.00 | 1.41 → <0.001 | — → <0.001 | 1.73 → <0.001 | — → <0.001 | — → <0.001 |
| indigo | +1 | 10.75 → 0.24 | — → 0.37 | 5.55 → 1.35 | — → 0.39 | 4.97 → 1.35 | — → 0.29 | — → 0.42 |
| indigo | +2 | 2.25 → 0.25 | — → 0.25 | 4.54 → 0.12 | — → 0.25 | 4.23 → 0.10 | — → 0.26 | — → 0.13 |
| indigo | +3 | 0.88 → 0.25 | — → 0.23 | 1.95 → 0.11 | — → 0.23 | 1.96 → 0.10 | — → 0.23 | — → 0.06 |
| magenta | -4 | 0.05 → <0.001 | — → <0.001 | 3.09 → <0.001 | — → <0.001 | 1.08 → <0.001 | — → <0.001 | — → <0.001 |
| magenta | -3 | 0.07 → <0.001 | — → <0.001 | 3.16 → <0.001 | — → <0.001 | 0.77 → <0.001 | — → <0.001 | — → <0.001 |
| magenta | -2 | 0.07 → <0.001 | — → <0.001 | 2.32 → <0.001 | — → <0.001 | 1.68 → <0.001 | — → <0.001 | — → <0.001 |
| magenta | -1 | 0.23 → <0.001 | — → <0.001 | 1.48 → <0.001 | — → <0.001 | 1.64 → <0.001 | — → <0.001 | — → <0.001 |
| magenta | +0 | 0.06 → <0.001 | — → <0.001 | 1.86 → <0.001 | — → <0.001 | 1.90 → <0.001 | — → <0.001 | — → <0.001 |
| magenta | +1 | 7.84 → 0.07 | — → 0.16 | 4.55 → 0.00 | — → 0.19 | 4.93 → <0.001 | — → 0.31 | — → 0.48 |
| magenta | +2 | 1.38 → 0.08 | — → 0.18 | 8.48 → 0.09 | — → 0.19 | 9.68 → 0.07 | — → 0.24 | — → 0.00 |
| magenta | +3 | 0.63 → 0.08 | — → 0.12 | 3.42 → 0.09 | — → 0.13 | 3.26 → 0.08 | — → 0.16 | — → 0.00 |
| red | -4 | 0.03 → <0.001 | — → <0.001 | 3.41 → <0.001 | — → <0.001 | 1.11 → <0.001 | — → <0.001 | — → <0.001 |
| red | -3 | 0.05 → <0.001 | — → <0.001 | 2.03 → <0.001 | — → <0.001 | 0.70 → <0.001 | — → <0.001 | — → <0.001 |
| red | -2 | 0.03 → <0.001 | — → <0.001 | 2.88 → <0.001 | — → <0.001 | 0.50 → <0.001 | — → <0.001 | — → <0.001 |
| red | -1 | 0.29 → <0.001 | — → <0.001 | 2.52 → <0.001 | — → <0.001 | 1.41 → <0.001 | — → <0.001 | — → <0.001 |
| red | +0 | 0.03 → <0.001 | — → <0.001 | 1.79 → <0.001 | — → <0.001 | 2.76 → <0.001 | — → <0.001 | — → <0.001 |
| red | +1 | 7.72 → 0.17 | — → 0.34 | 2.34 → <0.001 | — → 0.35 | 1.90 → <0.001 | — → 0.22 | — → 0.62 |
| red | +2 | 1.21 → 0.17 | — → 0.11 | 13.78 → 0.71 | — → 0.12 | 14.24 → 0.18 | — → 0.11 | — → 0.03 |
| red | +3 | 0.46 → 0.17 | — → 0.14 | 3.27 → 0.14 | — → 0.15 | 1.93 → 0.16 | — → 0.13 | — → 0.22 |
| skin | -4 | 0.03 → <0.001 | — → <0.001 | 3.58 → <0.001 | — → <0.001 | 0.87 → <0.001 | — → <0.001 | — → <0.001 |
| skin | -3 | 0.05 → <0.001 | — → <0.001 | 8.14 → <0.001 | — → <0.001 | 1.24 → <0.001 | — → <0.001 | — → <0.001 |
| skin | -2 | 0.04 → <0.001 | — → <0.001 | 5.36 → <0.001 | — → <0.001 | 0.92 → <0.001 | — → <0.001 | — → <0.001 |
| skin | -1 | 0.26 → <0.001 | — → <0.001 | 2.44 → <0.001 | — → <0.001 | 2.47 → <0.001 | — → <0.001 | — → <0.001 |
| skin | +0 | 0.06 → <0.001 | — → <0.001 | 2.98 → <0.001 | — → <0.001 | 2.41 → <0.001 | — → <0.001 | — → <0.001 |
| skin | +1 | 7.85 → 0.24 | — → 0.00 | 5.35 → 0.83 | — → 0.00 | 5.07 → 0.90 | — → 0.10 | — → 1.98 |
| skin | +2 | 2.48 → 0.21 | — → 0.00 | 3.97 → 0.00 | — → 0.00 | 4.77 → 0.00 | — → 0.00 | — → 0.24 |
| skin | +3 | 0.89 → 0.22 | — → 0.00 | 1.32 → 0.00 | — → 0.00 | 1.96 → 0.00 | — → 0.00 | — → 0.09 |
