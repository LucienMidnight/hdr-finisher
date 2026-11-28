# Grade module audit

Times are medians in ms. Deltas are module ON minus OFF. Memory is the sampled app footprint peak in MB.
Drain time is recorded in the JSON and does not trigger a flag.

## DSC00636.ARW at 100%

Stevens-MacBook-Neo.local, 1408x794 at 2×, ac, app 0.9.4 (f68540d57bdad3a7f34ba75a1a9792b31ea0d920).
Baseline spread 24.0% (start, middle, end). [Run JSON](module-impact-large-100.json)

| Module / lane | Probe | First feedback Δ ms (%) | Settle Δ ms (%) | Peak Δ MB | Flags |
| --- | --- | ---: | ---: | ---: | --- |
| baseline / hdr | No paired probes | — | — | — | — |
| tone / hdr | probe.denoise.toggle_on | -0.7 (-0.7%) | -0.8 (-0.8%) | 0.8 | noise, regression |
| tone / hdr | probe.denoise.toggle_off | -0.8 (-1.2%) | -0.8 (-1.2%) | 25.2 | noise |
| denoise / hdr | probe.tone.exposure.drag | 33.4 (8.3%) | -61.6 (-59.5%) | 89.7 | — |
| denoise / hdr | probe.tone.contrast.drag | 2.3 (0.7%) | -1.9 (-4.9%) | 93.8 | noise |
| film / hdr | probe.tone.exposure.drag | 4118.5 (884.7%) | 1785.7 (1539.4%) | 25.5 | impact |
| film / hdr | probe.tone.contrast.drag | 4243.4 (1110.3%) | 1777.8 (4993.8%) | 66.6 | impact |
| film / hdr | probe.denoise.toggle_on | 2083.6 (2692.0%) | 2083.7 (2692.1%) | 263.3 | impact |
| film / hdr | probe.denoise.toggle_off | 1148.0 (1777.1%) | 1147.9 (1774.2%) | 139.4 | impact |
| detail / hdr | probe.tone.exposure.drag | 347.9 (83.2%) | 345.7 (394.6%) | 134.0 | impact |
| detail / hdr | probe.tone.contrast.drag | 802.7 (210.5%) | 348.4 (954.5%) | 355.0 | impact, memory |
| detail / hdr | probe.denoise.toggle_on | 2153.5 (2387.5%) | 2153.5 (2387.5%) | 320.7 | impact, memory |
| detail / hdr | probe.denoise.toggle_off | 334.7 (425.3%) | 334.7 (425.3%) | 171.8 | impact |

### Exceptions

- tone / cold.denoise.toggle_on / on — Preparation already resident before enable.
- tone / cold.denoise.toggle_on / off — Preparation already resident before enable.
- tone / probe.tone.exposure.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.tone.contrast.drag / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_on / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_off / off — Self-reference: probe belongs to the bypassed module.
- film / cold.denoise.toggle_on / on — Preparation already resident before enable.
- film / cold.denoise.toggle_on / off — Preparation already resident before enable.
- detail / cold.denoise.toggle_on / on — Preparation already resident before enable.
- detail / cold.denoise.toggle_on / off — Preparation already resident before enable.

### Same-machine regressions

- tone / probe.tone.exposure.drag / on / settle_ms — 72.2 → 89.9 ms
- tone / probe.denoise.toggle_on / off / first_feedback_ms — 78.6 → 94.8 ms
- tone / probe.denoise.toggle_on / off / settle_ms — 78.6 → 94.9 ms
- denoise / own.denoise.clean_grain.toggle_off / on / first_feedback_ms — 64.9 → 81.0 ms
- denoise / own.denoise.clean_grain.toggle_off / on / settle_ms — 64.9 → 81.0 ms
- film / own.film.film-look-strength.drag / on / settle_ms — 1080.5 → 1340.9 ms

### Flags

- noise — tone / probe.denoise.toggle_on
- regression — tone / probe.denoise.toggle_on
- noise — tone / probe.denoise.toggle_off
- noise — denoise / probe.tone.contrast.drag
- impact — film / probe.tone.exposure.drag
- impact — film / probe.tone.contrast.drag
- impact — film / probe.denoise.toggle_on
- impact — film / probe.denoise.toggle_off
- impact — detail / probe.tone.exposure.drag
- impact — detail / probe.tone.contrast.drag
- memory — detail / probe.tone.contrast.drag
- impact — detail / probe.denoise.toggle_on
- memory — detail / probe.denoise.toggle_on
- impact — detail / probe.denoise.toggle_off

## DSC00636.ARW at Fit

Stevens-MacBook-Neo.local, 1408x794 at 2×, ac, app 0.9.4 (a6df006743655793bd852ac6c91b5df617855ed9).
Baseline spread 211.1% (start, middle, end). [Run JSON](module-impact-large-fit.json)

| Module / lane | Probe | First feedback Δ ms (%) | Settle Δ ms (%) | Peak Δ MB | Flags |
| --- | --- | ---: | ---: | ---: | --- |
| baseline / hdr | No paired probes | — | — | — | — |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.exposure.drag | 0.2 (0.6%) | 0.6 (42.9%) | -71.3 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.contrast.drag | 0.0 (0.0%) | 1.0 (100.0%) | -41.6 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_on | 66.3 (1.1%) | 66.3 (1.1%) | -79.6 | noise, slow, regression |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_off | 0.0 (0.0%) | 0.1 (0.2%) | -65.5 | noise |
| denoise / hdr | probe.tone.exposure.drag | -0.4 (-1.1%) | 0.1 (7.7%) | 27.3 | noise |
| denoise / hdr | probe.tone.contrast.drag | 1.8 (5.5%) | -0.9 (-42.9%) | 139.9 | noise |
| tone / hdr | probe.denoise.toggle_on | -436.2 (-5.2%) | -436.1 (-5.2%) | -74.0 | noise, slow, regression |
| tone / hdr | probe.denoise.toggle_off | -1.4 (-2.9%) | -1.4 (-2.9%) | 10.0 | noise |
| bands / hdr | probe.tone.exposure.drag | -2.5 (-6.7%) | 0.2 (18.2%) | -53.6 | noise |
| bands / hdr | probe.tone.contrast.drag | -0.5 (-1.5%) | -0.7 (-28.0%) | 32.8 | noise |
| bands / hdr | probe.denoise.toggle_on | -14.8 (-0.2%) | -14.8 (-0.2%) | 2.1 | noise, slow, regression |
| bands / hdr | probe.denoise.toggle_off | 0.3 (0.6%) | 0.3 (0.6%) | -11.0 | noise |
| highlight_compression / hdr | probe.tone.exposure.drag | -1.3 (-3.5%) | 317.5 (35277.8%) | -55.0 | impact |
| highlight_compression / hdr | probe.tone.contrast.drag | 0.6 (1.8%) | 303.1 (37887.5%) | -54.3 | impact |
| highlight_compression / hdr | probe.denoise.toggle_on | -150.5 (-1.8%) | -150.4 (-1.8%) | 4.4 | noise, slow, regression |
| highlight_compression / hdr | probe.denoise.toggle_off | -0.6 (-1.3%) | -0.6 (-1.3%) | -21.1 | noise |
| color / hdr | probe.tone.exposure.drag | 4.2 (12.1%) | 0.7 | 40.3 | noise |
| color / hdr | probe.tone.contrast.drag | -1.5 (-4.1%) | 0.3 (37.5%) | 56.8 | noise |
| color / hdr | probe.denoise.toggle_on | 32.2 (0.4%) | 32.2 (0.4%) | -0.8 | noise, slow, regression |
| color / hdr | probe.denoise.toggle_off | -0.2 (-0.4%) | -0.2 (-0.4%) | -48.3 | noise |
| wheels / hdr | probe.tone.exposure.drag | -1.3 (-3.1%) | 1.2 | 1.6 | noise |
| wheels / hdr | probe.tone.contrast.drag | -0.8 (-2.3%) | -1.3 (-100.0%) | -32.7 | noise |
| wheels / hdr | probe.denoise.toggle_on | -135.4 (-1.6%) | -135.4 (-1.6%) | -65.2 | noise, slow, regression |
| wheels / hdr | probe.denoise.toggle_off | -0.7 (-1.5%) | -0.7 (-1.5%) | 47.1 | noise |
| hsl / hdr | probe.tone.exposure.drag | 76.3 (190.8%) | 18.2 (2275.0%) | 191.6 | impact |
| hsl / hdr | probe.tone.contrast.drag | 121.0 (354.8%) | 35.6 (1780.0%) | 155.9 | impact |
| hsl / hdr | probe.denoise.toggle_on | 615.9 (7.4%) | 615.8 (7.4%) | 281.0 | noise, slow, regression |
| hsl / hdr | probe.denoise.toggle_off | 16.5 (35.0%) | 16.5 (35.0%) | 184.9 | regression |
| vignette / hdr | probe.tone.exposure.drag | -1.1 (-2.9%) | -0.1 (-11.1%) | 23.7 | noise |
| vignette / hdr | probe.tone.contrast.drag | 2.6 (7.6%) | 1.0 | 16.9 | noise |
| vignette / hdr | probe.denoise.toggle_on | -700.6 (-7.3%) | -700.5 (-7.2%) | 36.2 | noise, slow, regression |
| vignette / hdr | probe.denoise.toggle_off | -0.0 (-0.0%) | -0.0 (-0.0%) | 21.5 | noise |
| film / hdr | probe.tone.exposure.drag | 1407.3 (3250.1%) | 738.5 (1608.9%) | 32.9 | impact |
| film / hdr | probe.tone.contrast.drag | 855.7 (2390.2%) | 737.5 (1514.4%) | 22.2 | impact |
| film / hdr | probe.denoise.toggle_on | 836.9 (9.1%) | 836.8 (9.1%) | 5.1 | noise, slow, regression |
| film / hdr | probe.denoise.toggle_off | 580.2 (1216.4%) | 580.3 (1216.6%) | 61.8 | impact |

### Exceptions

- baseline / cold.denoise.toggle_on / on — slow (settle 9839.7 ms)
- baseline / probe.denoise.toggle_on / on — slow (settle 7779.4 ms)
- raw.lens / own.raw.lens.distortion.click / on — slow (settle 5317.5 ms)
- raw.lens / own.raw.lens.mode-off.apply / on — slow (settle 4969.0 ms)
- raw.lens / cold.denoise.toggle_on / on — slow (settle 8766.8 ms)
- raw.lens / probe.denoise.toggle_on / on — slow (settle 6131.9 ms)
- raw.lens / cold.denoise.toggle_on / off — slow (settle 8200.8 ms)
- raw.lens / probe.denoise.toggle_on / off — slow (settle 6065.6 ms)
- denoise / own.denoise.clean_grain.toggle_on / on — slow (settle 7983.1 ms)
- denoise / own.denoise.clean_grain.amount.drag / on — slow (settle 8584.4 ms)
- denoise / cold.denoise.clean_grain.toggle_on / on — slow (settle 10022.4 ms)
- denoise / cold.denoise.micro_grain.toggle_on / on — slow (settle 35823.7 ms)
- denoise / probe.denoise.toggle_on / on — slow (settle 7914.2 ms)
- denoise / probe.denoise.toggle_on / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_off / off — Self-reference: probe belongs to the bypassed module.
- tone / cold.denoise.toggle_on / on — slow (settle 10132.8 ms)
- tone / cold.denoise.toggle_on / off — slow (settle 7930.3 ms)
- tone / probe.denoise.toggle_on / on — slow (settle 7911.8 ms)
- tone / probe.tone.exposure.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.tone.contrast.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.denoise.toggle_on / off — slow (settle 8347.9 ms)
- bands / cold.denoise.toggle_on / on — slow (settle 8130.0 ms)
- bands / cold.denoise.toggle_on / off — slow (settle 8613.9 ms)
- bands / probe.denoise.toggle_on / on — slow (settle 8080.2 ms)
- bands / probe.denoise.toggle_on / off — slow (settle 8095.0 ms)
- highlight_compression / cold.denoise.toggle_on / on — slow (settle 13836.0 ms)
- highlight_compression / cold.denoise.toggle_on / off — slow (settle 16334.9 ms)
- highlight_compression / probe.denoise.toggle_on / on — slow (settle 8279.3 ms)
- highlight_compression / probe.denoise.toggle_on / off — slow (settle 8429.7 ms)
- color / cold.denoise.toggle_on / on — slow (settle 7546.9 ms)
- color / cold.denoise.toggle_on / off — slow (settle 8493.2 ms)
- color / probe.denoise.toggle_on / on — slow (settle 8378.5 ms)
- color / probe.denoise.toggle_on / off — slow (settle 8346.3 ms)
- wheels / cold.denoise.toggle_on / on — slow (settle 7781.5 ms)
- wheels / cold.denoise.toggle_on / off — slow (settle 8245.8 ms)
- wheels / probe.denoise.toggle_on / on — slow (settle 8311.5 ms)
- wheels / probe.denoise.toggle_on / off — slow (settle 8446.9 ms)
- hsl / cold.denoise.toggle_on / on — slow (settle 9130.6 ms)
- hsl / cold.denoise.toggle_on / off — slow (settle 8483.6 ms)
- hsl / probe.denoise.toggle_on / on — slow (settle 8977.3 ms)
- hsl / probe.denoise.toggle_on / off — slow (settle 8361.5 ms)
- vignette / cold.denoise.toggle_on / on — slow (settle 8834.9 ms)
- vignette / cold.denoise.toggle_on / off — slow (settle 9511.7 ms)
- vignette / probe.denoise.toggle_on / on — slow (settle 8962.9 ms)
- vignette / probe.denoise.toggle_on / off — slow (settle 9663.4 ms)
- film / cold.denoise.toggle_on / on — slow (settle 9897.0 ms)
- film / cold.denoise.toggle_on / off — slow (settle 8394.3 ms)
- film / probe.denoise.toggle_on / on — slow (settle 10048.9 ms)
- film / probe.denoise.toggle_on / off — slow (settle 9212.1 ms)

### Same-machine regressions

- raw.lens / probe.denoise.toggle_on / on / first_feedback_ms — 47.3 → 6131.9 ms
- raw.lens / probe.denoise.toggle_on / on / settle_ms — 47.4 → 6131.9 ms
- raw.lens / probe.denoise.toggle_on / off / first_feedback_ms — 62.8 → 6065.6 ms
- raw.lens / probe.denoise.toggle_on / off / settle_ms — 62.8 → 6065.6 ms
- denoise / own.denoise.clean_grain.toggle_on / on / first_feedback_ms — 47.2 → 7983.0 ms
- denoise / own.denoise.clean_grain.toggle_on / on / settle_ms — 47.2 → 7983.1 ms
- denoise / own.denoise.clean_grain.amount.drag / on / first_feedback_ms — 482.6 → 8890.1 ms
- denoise / own.denoise.clean_grain.amount.drag / on / settle_ms — 156.5 → 8584.4 ms
- denoise / own.denoise.standard.toggle_on / on / first_feedback_ms — 47.6 → 198.0 ms
- denoise / own.denoise.standard.toggle_on / on / settle_ms — 47.6 → 198.0 ms
- denoise / probe.denoise.toggle_on / on / first_feedback_ms — 60.1 → 7914.2 ms
- denoise / probe.denoise.toggle_on / on / settle_ms — 60.1 → 7914.2 ms
- tone / probe.denoise.toggle_on / on / first_feedback_ms — 62.0 → 7911.7 ms
- tone / probe.denoise.toggle_on / on / settle_ms — 62.0 → 7911.8 ms
- tone / probe.denoise.toggle_on / off / first_feedback_ms — 62.1 → 8347.9 ms
- tone / probe.denoise.toggle_on / off / settle_ms — 62.2 → 8347.9 ms
- bands / own.bands.tone-equalizer-band-value.drag / on / first_feedback_ms — 57.5 → 314.0 ms
- bands / probe.denoise.toggle_on / on / first_feedback_ms — 44.8 → 8080.2 ms
- bands / probe.denoise.toggle_on / on / settle_ms — 44.8 → 8080.2 ms
- bands / probe.denoise.toggle_on / off / first_feedback_ms — 61.9 → 8095.0 ms
- bands / probe.denoise.toggle_on / off / settle_ms — 61.9 → 8095.0 ms
- highlight_compression / probe.denoise.toggle_on / on / first_feedback_ms — 61.5 → 8279.2 ms
- highlight_compression / probe.denoise.toggle_on / on / settle_ms — 61.5 → 8279.3 ms
- highlight_compression / probe.denoise.toggle_on / off / first_feedback_ms — 62.1 → 8429.7 ms
- highlight_compression / probe.denoise.toggle_on / off / settle_ms — 62.1 → 8429.7 ms
- color / probe.denoise.toggle_on / on / first_feedback_ms — 60.8 → 8378.5 ms
- color / probe.denoise.toggle_on / on / settle_ms — 60.9 → 8378.5 ms
- color / probe.denoise.toggle_on / off / first_feedback_ms — 61.0 → 8346.3 ms
- color / probe.denoise.toggle_on / off / settle_ms — 61.0 → 8346.3 ms
- wheels / own.wheels.shadows-puck.drag / on / settle_ms — 3.4 → 30.8 ms
- wheels / probe.denoise.toggle_on / on / first_feedback_ms — 60.2 → 8311.5 ms
- wheels / probe.denoise.toggle_on / on / settle_ms — 60.2 → 8311.5 ms
- wheels / probe.denoise.toggle_on / off / first_feedback_ms — 59.9 → 8446.9 ms
- wheels / probe.denoise.toggle_on / off / settle_ms — 59.9 → 8446.9 ms
- hsl / probe.denoise.toggle_on / on / first_feedback_ms — 59.6 → 8977.3 ms
- hsl / probe.denoise.toggle_on / on / settle_ms — 59.6 → 8977.3 ms
- hsl / probe.denoise.toggle_off / on / first_feedback_ms — 43.8 → 63.6 ms
- hsl / probe.denoise.toggle_off / on / settle_ms — 43.9 → 63.6 ms
- hsl / probe.denoise.toggle_on / off / first_feedback_ms — 60.2 → 8361.4 ms
- hsl / probe.denoise.toggle_on / off / settle_ms — 60.2 → 8361.5 ms
- vignette / probe.denoise.toggle_on / on / first_feedback_ms — 59.7 → 8962.8 ms
- vignette / probe.denoise.toggle_on / on / settle_ms — 59.7 → 8962.9 ms
- vignette / probe.denoise.toggle_on / off / first_feedback_ms — 59.7 → 9663.4 ms
- vignette / probe.denoise.toggle_on / off / settle_ms — 59.7 → 9663.4 ms
- film / probe.denoise.toggle_on / on / first_feedback_ms — 898.8 → 10048.9 ms
- film / probe.denoise.toggle_on / on / settle_ms — 898.8 → 10048.9 ms
- film / probe.denoise.toggle_on / off / first_feedback_ms — 60.4 → 9212.0 ms
- film / probe.denoise.toggle_on / off / settle_ms — 60.4 → 9212.1 ms

### Flags

- slow — baseline / cold.denoise.toggle_on / on
- slow — baseline / probe.denoise.toggle_on / on
- noise — raw.lens / probe.tone.exposure.drag
- noise — raw.lens / probe.tone.contrast.drag
- noise — raw.lens / probe.denoise.toggle_on
- slow — raw.lens / probe.denoise.toggle_on
- regression — raw.lens / probe.denoise.toggle_on
- noise — raw.lens / probe.denoise.toggle_off
- slow — raw.lens / own.raw.lens.distortion.click / on
- slow — raw.lens / own.raw.lens.mode-off.apply / on
- slow — raw.lens / cold.denoise.toggle_on / on
- slow — raw.lens / cold.denoise.toggle_on / off
- noise — denoise / probe.tone.exposure.drag
- noise — denoise / probe.tone.contrast.drag
- slow — denoise / own.denoise.clean_grain.toggle_on / on
- slow — denoise / own.denoise.clean_grain.amount.drag / on
- slow — denoise / cold.denoise.clean_grain.toggle_on / on
- slow — denoise / cold.denoise.micro_grain.toggle_on / on
- slow — denoise / probe.denoise.toggle_on / on
- noise — tone / probe.denoise.toggle_on
- slow — tone / probe.denoise.toggle_on
- regression — tone / probe.denoise.toggle_on
- noise — tone / probe.denoise.toggle_off
- slow — tone / cold.denoise.toggle_on / on
- slow — tone / cold.denoise.toggle_on / off
- noise — bands / probe.tone.exposure.drag
- noise — bands / probe.tone.contrast.drag
- noise — bands / probe.denoise.toggle_on
- slow — bands / probe.denoise.toggle_on
- regression — bands / probe.denoise.toggle_on
- noise — bands / probe.denoise.toggle_off
- slow — bands / cold.denoise.toggle_on / on
- slow — bands / cold.denoise.toggle_on / off
- impact — highlight_compression / probe.tone.exposure.drag
- impact — highlight_compression / probe.tone.contrast.drag
- noise — highlight_compression / probe.denoise.toggle_on
- slow — highlight_compression / probe.denoise.toggle_on
- regression — highlight_compression / probe.denoise.toggle_on
- noise — highlight_compression / probe.denoise.toggle_off
- slow — highlight_compression / cold.denoise.toggle_on / on
- slow — highlight_compression / cold.denoise.toggle_on / off
- noise — color / probe.tone.exposure.drag
- noise — color / probe.tone.contrast.drag
- noise — color / probe.denoise.toggle_on
- slow — color / probe.denoise.toggle_on
- regression — color / probe.denoise.toggle_on
- noise — color / probe.denoise.toggle_off
- slow — color / cold.denoise.toggle_on / on
- slow — color / cold.denoise.toggle_on / off
- noise — wheels / probe.tone.exposure.drag
- noise — wheels / probe.tone.contrast.drag
- noise — wheels / probe.denoise.toggle_on
- slow — wheels / probe.denoise.toggle_on
- regression — wheels / probe.denoise.toggle_on
- noise — wheels / probe.denoise.toggle_off
- slow — wheels / cold.denoise.toggle_on / on
- slow — wheels / cold.denoise.toggle_on / off
- impact — hsl / probe.tone.exposure.drag
- impact — hsl / probe.tone.contrast.drag
- noise — hsl / probe.denoise.toggle_on
- slow — hsl / probe.denoise.toggle_on
- regression — hsl / probe.denoise.toggle_on
- regression — hsl / probe.denoise.toggle_off
- slow — hsl / cold.denoise.toggle_on / on
- slow — hsl / cold.denoise.toggle_on / off
- noise — vignette / probe.tone.exposure.drag
- noise — vignette / probe.tone.contrast.drag
- noise — vignette / probe.denoise.toggle_on
- slow — vignette / probe.denoise.toggle_on
- regression — vignette / probe.denoise.toggle_on
- noise — vignette / probe.denoise.toggle_off
- slow — vignette / cold.denoise.toggle_on / on
- slow — vignette / cold.denoise.toggle_on / off
- impact — film / probe.tone.exposure.drag
- impact — film / probe.tone.contrast.drag
- noise — film / probe.denoise.toggle_on
- slow — film / probe.denoise.toggle_on
- regression — film / probe.denoise.toggle_on
- impact — film / probe.denoise.toggle_off
- slow — film / cold.denoise.toggle_on / on
- slow — film / cold.denoise.toggle_on / off

## IMG_7723.CR3 at Fit

Stevens-MacBook-Neo.local, 1408x794 at 2×, ac, app 0.9.4 (a6df006743655793bd852ac6c91b5df617855ed9).
Baseline spread 266.7% (start, middle, end). [Run JSON](module-impact-typical-fit.json)

| Module / lane | Probe | First feedback Δ ms (%) | Settle Δ ms (%) | Peak Δ MB | Flags |
| --- | --- | ---: | ---: | ---: | --- |
| baseline / hdr | No paired probes | — | — | — | — |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.exposure.drag | 1.2 (3.7%) | -1.1 (-40.7%) | -68.3 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.contrast.drag | 5.9 (17.2%) | 0.2 (4.8%) | -32.1 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_on | -35.8 (-0.6%) | -35.8 (-0.6%) | -22.2 | noise, slow, regression |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_off | 0.8 (1.7%) | 0.8 (1.7%) | -35.2 | noise |
| denoise / hdr | probe.tone.exposure.drag | 2.2 (6.3%) | -0.3 (-21.4%) | 83.9 | noise |
| denoise / hdr | probe.tone.contrast.drag | 3.0 (9.3%) | -0.6 (-46.2%) | 119.2 | noise |
| tone / hdr | probe.denoise.toggle_on | -65.4 (-2.0%) | -65.4 (-2.0%) | -4.7 | noise, slow, regression |
| tone / hdr | probe.denoise.toggle_off | 0.0 (0.0%) | 0.1 (0.2%) | -3.2 | noise |
| bands / hdr | probe.tone.exposure.drag | 0.9 (2.7%) | -0.4 (-21.1%) | -14.9 | noise |
| bands / hdr | probe.tone.contrast.drag | 0.3 (0.9%) | 0.4 (28.6%) | -37.5 | noise |
| bands / hdr | probe.denoise.toggle_on | -15.6 (-0.5%) | -15.6 (-0.5%) | -27.1 | noise, slow, regression |
| bands / hdr | probe.denoise.toggle_off | 0.0 (0.0%) | 0.0 (0.0%) | -5.8 | noise |
| highlight_compression / hdr | probe.tone.exposure.drag | -0.7 (-1.9%) | 299.0 (33222.2%) | -46.5 | impact |
| highlight_compression / hdr | probe.tone.contrast.drag | 3.0 (9.0%) | 282.1 (14847.4%) | -37.2 | impact |
| highlight_compression / hdr | probe.denoise.toggle_on | -102.9 (-3.1%) | -102.8 (-3.1%) | -43.3 | noise, slow, regression |
| highlight_compression / hdr | probe.denoise.toggle_off | -0.9 (-1.9%) | -1.0 (-2.1%) | 24.1 | noise |
| color / hdr | probe.tone.exposure.drag | 0.0 (0.0%) | 0.8 | 83.4 | noise |
| color / hdr | probe.tone.contrast.drag | 1.1 (3.3%) | -0.2 (-16.7%) | 51.6 | noise |
| color / hdr | probe.denoise.toggle_on | -1.2 (-0.0%) | -1.2 (-0.0%) | 138.1 | noise, slow, regression |
| color / hdr | probe.denoise.toggle_off | -0.6 (-1.3%) | -0.5 (-1.1%) | -177.4 | noise |
| wheels / hdr | probe.tone.exposure.drag | 1.0 (2.9%) | 0.0 | -57.3 | noise |
| wheels / hdr | probe.tone.contrast.drag | -0.1 (-0.3%) | 0.1 (14.3%) | -2.9 | noise |
| wheels / hdr | probe.denoise.toggle_on | 17.9 (0.6%) | 17.9 (0.6%) | -5.4 | noise, slow, regression |
| wheels / hdr | probe.denoise.toggle_off | -0.4 (-0.8%) | -0.4 (-0.8%) | -96.8 | noise |
| hsl / hdr | probe.tone.exposure.drag | 140.2 (372.9%) | 32.2 (1610.0%) | 7.4 | impact |
| hsl / hdr | probe.tone.contrast.drag | 123.1 (359.9%) | 22.2 | 125.3 | impact |
| hsl / hdr | probe.denoise.toggle_on | 16.8 (0.5%) | 16.7 (0.5%) | 130.4 | noise, slow |
| hsl / hdr | probe.denoise.toggle_off | -0.5 (-1.1%) | -0.4 (-0.8%) | 141.9 | noise |
| vignette / hdr | probe.tone.exposure.drag | -0.4 (-1.1%) | 0.0 (0.0%) | 15.5 | noise |
| vignette / hdr | probe.tone.contrast.drag | -1.1 (-3.2%) | 0.8 | 96.2 | noise |
| vignette / hdr | probe.denoise.toggle_on | -66.5 (-2.0%) | -66.5 (-2.0%) | -48.6 | noise, slow |
| vignette / hdr | probe.denoise.toggle_off | 0.3 (0.6%) | 0.4 (0.8%) | 39.0 | noise |
| film / hdr | probe.tone.exposure.drag | 959.9 (2651.7%) | 711.3 (1516.6%) | 1.6 | impact |
| film / hdr | probe.tone.contrast.drag | 946.4 (2727.4%) | 674.6 (1388.1%) | 16.1 | impact |
| film / hdr | probe.denoise.toggle_on | 675.6 (20.6%) | 675.7 (20.6%) | 37.1 | slow |
| film / hdr | probe.denoise.toggle_off | 584.7 (1233.5%) | 584.7 (1233.5%) | 34.1 | impact |

### Exceptions

- baseline / cold.denoise.toggle_on / on — slow (settle 4103.2 ms)
- baseline / probe.denoise.toggle_on / on — slow (settle 3063.2 ms)
- raw.lens / own.raw.lens.distortion.click / on — slow (settle 5026.2 ms)
- raw.lens / own.raw.lens.mode-off.apply / on — slow (settle 4782.4 ms)
- raw.lens / cold.denoise.toggle_on / on — slow (settle 7499.5 ms)
- raw.lens / probe.denoise.toggle_on / on — slow (settle 5931.3 ms)
- raw.lens / cold.denoise.toggle_on / off — slow (settle 7816.7 ms)
- raw.lens / probe.denoise.toggle_on / off — slow (settle 5967.1 ms)
- denoise / own.denoise.clean_grain.toggle_on / on — slow (settle 3178.9 ms)
- denoise / own.denoise.clean_grain.amount.drag / on — slow (settle 3293.6 ms)
- denoise / cold.denoise.clean_grain.toggle_on / on — slow (settle 4177.3 ms)
- denoise / own.denoise.micro_grain.toggle_on / on — slow (settle 7117.2 ms)
- denoise / own.denoise.micro_grain.amount.drag / on — slow (settle 7594.6 ms)
- denoise / cold.denoise.micro_grain.toggle_on / on — slow (settle 9498.6 ms)
- denoise / probe.denoise.toggle_on / on — slow (settle 3242.7 ms)
- denoise / probe.denoise.toggle_on / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_off / off — Self-reference: probe belongs to the bypassed module.
- tone / cold.denoise.toggle_on / on — slow (settle 4230.4 ms)
- tone / cold.denoise.toggle_on / off — slow (settle 3227.3 ms)
- tone / probe.denoise.toggle_on / on — slow (settle 3212.5 ms)
- tone / probe.tone.exposure.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.tone.contrast.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.denoise.toggle_on / off — slow (settle 3277.9 ms)
- bands / cold.denoise.toggle_on / on — slow (settle 3080.8 ms)
- bands / cold.denoise.toggle_on / off — slow (settle 3146.7 ms)
- bands / probe.denoise.toggle_on / on — slow (settle 3211.3 ms)
- bands / probe.denoise.toggle_on / off — slow (settle 3226.9 ms)
- highlight_compression / cold.denoise.toggle_on / on — slow (settle 3094.7 ms)
- highlight_compression / cold.denoise.toggle_on / off — slow (settle 3211.4 ms)
- highlight_compression / probe.denoise.toggle_on / on — slow (settle 3259.2 ms)
- highlight_compression / probe.denoise.toggle_on / off — slow (settle 3362.0 ms)
- color / cold.denoise.toggle_on / on — slow (settle 3162.4 ms)
- color / cold.denoise.toggle_on / off — slow (settle 3161.1 ms)
- color / probe.denoise.toggle_on / on — slow (settle 3193.5 ms)
- color / probe.denoise.toggle_on / off — slow (settle 3194.7 ms)
- wheels / cold.denoise.toggle_on / on — slow (settle 3328.4 ms)
- wheels / cold.denoise.toggle_on / off — slow (settle 3260.9 ms)
- wheels / probe.denoise.toggle_on / on — slow (settle 3228.3 ms)
- wheels / probe.denoise.toggle_on / off — slow (settle 3210.4 ms)
- hsl / cold.denoise.toggle_on / on — slow (settle 3179.5 ms)
- hsl / cold.denoise.toggle_on / off — slow (settle 3144.1 ms)
- hsl / probe.denoise.toggle_on / on — slow (settle 3243.5 ms)
- hsl / probe.denoise.toggle_on / off — slow (settle 3226.8 ms)
- vignette / cold.denoise.toggle_on / on — slow (settle 3144.5 ms)
- vignette / cold.denoise.toggle_on / off — slow (settle 3159.8 ms)
- vignette / probe.denoise.toggle_on / on — slow (settle 3178.2 ms)
- vignette / probe.denoise.toggle_on / off — slow (settle 3244.7 ms)
- film / cold.denoise.toggle_on / on — slow (settle 3968.3 ms)
- film / cold.denoise.toggle_on / off — slow (settle 3314.2 ms)
- film / probe.denoise.toggle_on / on — slow (settle 3953.6 ms)
- film / probe.denoise.toggle_on / off — slow (settle 3277.9 ms)

### Same-machine regressions

- baseline / probe.denoise.toggle_on / on / first_feedback_ms — 45.4 → 3063.2 ms
- baseline / probe.denoise.toggle_on / on / settle_ms — 45.5 → 3063.2 ms
- raw.lens / probe.denoise.toggle_on / on / first_feedback_ms — 46.9 → 5931.2 ms
- raw.lens / probe.denoise.toggle_on / on / settle_ms — 46.9 → 5931.3 ms
- raw.lens / probe.denoise.toggle_on / off / first_feedback_ms — 63.4 → 5967.0 ms
- raw.lens / probe.denoise.toggle_on / off / settle_ms — 63.4 → 5967.1 ms
- denoise / own.denoise.clean_grain.toggle_on / on / first_feedback_ms — 46.9 → 3178.9 ms
- denoise / own.denoise.clean_grain.toggle_on / on / settle_ms — 46.9 → 3178.9 ms
- denoise / own.denoise.clean_grain.amount.drag / on / first_feedback_ms — 483.2 → 3602.7 ms
- denoise / own.denoise.clean_grain.amount.drag / on / settle_ms — 158.3 → 3293.6 ms
- denoise / own.denoise.standard.toggle_on / on / first_feedback_ms — 46.4 → 198.2 ms
- denoise / own.denoise.standard.toggle_on / on / settle_ms — 46.4 → 198.2 ms
- denoise / own.denoise.micro_grain.toggle_on / on / first_feedback_ms — 46.4 → 7117.2 ms
- denoise / own.denoise.micro_grain.toggle_on / on / settle_ms — 46.4 → 7117.2 ms
- denoise / own.denoise.micro_grain.amount.drag / on / settle_ms — 60.5 → 7594.6 ms
- denoise / probe.denoise.toggle_on / on / first_feedback_ms — 45.8 → 3242.7 ms
- denoise / probe.denoise.toggle_on / on / settle_ms — 45.8 → 3242.7 ms
- tone / probe.denoise.toggle_on / on / first_feedback_ms — 62.1 → 3212.5 ms
- tone / probe.denoise.toggle_on / on / settle_ms — 62.2 → 3212.5 ms
- tone / probe.denoise.toggle_on / off / first_feedback_ms — 58.9 → 3277.9 ms
- tone / probe.denoise.toggle_on / off / settle_ms — 59.0 → 3277.9 ms
- bands / probe.denoise.toggle_on / on / first_feedback_ms — 60.3 → 3211.3 ms
- bands / probe.denoise.toggle_on / on / settle_ms — 60.3 → 3211.3 ms
- bands / probe.denoise.toggle_on / off / first_feedback_ms — 59.9 → 3226.9 ms
- bands / probe.denoise.toggle_on / off / settle_ms — 60.0 → 3226.9 ms
- highlight_compression / probe.denoise.toggle_on / on / first_feedback_ms — 60.1 → 3259.1 ms
- highlight_compression / probe.denoise.toggle_on / on / settle_ms — 60.1 → 3259.2 ms
- highlight_compression / probe.denoise.toggle_on / off / first_feedback_ms — 60.9 → 3362.0 ms
- highlight_compression / probe.denoise.toggle_on / off / settle_ms — 60.9 → 3362.0 ms
- color / probe.denoise.toggle_on / on / first_feedback_ms — 60.6 → 3193.5 ms
- color / probe.denoise.toggle_on / on / settle_ms — 60.6 → 3193.5 ms
- color / probe.denoise.toggle_on / off / first_feedback_ms — 60.3 → 3194.7 ms
- color / probe.denoise.toggle_on / off / settle_ms — 60.4 → 3194.7 ms
- wheels / own.wheels.shadows-puck.drag / on / settle_ms — 4.4 → 26.5 ms
- wheels / probe.denoise.toggle_on / on / first_feedback_ms — 61.4 → 3228.3 ms
- wheels / probe.denoise.toggle_on / on / settle_ms — 61.4 → 3228.3 ms
- wheels / probe.denoise.toggle_on / off / first_feedback_ms — 60.8 → 3210.4 ms
- wheels / probe.denoise.toggle_on / off / settle_ms — 60.9 → 3210.4 ms

### Flags

- slow — baseline / cold.denoise.toggle_on / on
- slow — baseline / probe.denoise.toggle_on / on
- noise — raw.lens / probe.tone.exposure.drag
- noise — raw.lens / probe.tone.contrast.drag
- noise — raw.lens / probe.denoise.toggle_on
- slow — raw.lens / probe.denoise.toggle_on
- regression — raw.lens / probe.denoise.toggle_on
- noise — raw.lens / probe.denoise.toggle_off
- slow — raw.lens / own.raw.lens.distortion.click / on
- slow — raw.lens / own.raw.lens.mode-off.apply / on
- slow — raw.lens / cold.denoise.toggle_on / on
- slow — raw.lens / cold.denoise.toggle_on / off
- noise — denoise / probe.tone.exposure.drag
- noise — denoise / probe.tone.contrast.drag
- slow — denoise / own.denoise.clean_grain.toggle_on / on
- slow — denoise / own.denoise.clean_grain.amount.drag / on
- slow — denoise / cold.denoise.clean_grain.toggle_on / on
- slow — denoise / own.denoise.micro_grain.toggle_on / on
- slow — denoise / own.denoise.micro_grain.amount.drag / on
- slow — denoise / cold.denoise.micro_grain.toggle_on / on
- slow — denoise / probe.denoise.toggle_on / on
- noise — tone / probe.denoise.toggle_on
- slow — tone / probe.denoise.toggle_on
- regression — tone / probe.denoise.toggle_on
- noise — tone / probe.denoise.toggle_off
- slow — tone / cold.denoise.toggle_on / on
- slow — tone / cold.denoise.toggle_on / off
- noise — bands / probe.tone.exposure.drag
- noise — bands / probe.tone.contrast.drag
- noise — bands / probe.denoise.toggle_on
- slow — bands / probe.denoise.toggle_on
- regression — bands / probe.denoise.toggle_on
- noise — bands / probe.denoise.toggle_off
- slow — bands / cold.denoise.toggle_on / on
- slow — bands / cold.denoise.toggle_on / off
- impact — highlight_compression / probe.tone.exposure.drag
- impact — highlight_compression / probe.tone.contrast.drag
- noise — highlight_compression / probe.denoise.toggle_on
- slow — highlight_compression / probe.denoise.toggle_on
- regression — highlight_compression / probe.denoise.toggle_on
- noise — highlight_compression / probe.denoise.toggle_off
- slow — highlight_compression / cold.denoise.toggle_on / on
- slow — highlight_compression / cold.denoise.toggle_on / off
- noise — color / probe.tone.exposure.drag
- noise — color / probe.tone.contrast.drag
- noise — color / probe.denoise.toggle_on
- slow — color / probe.denoise.toggle_on
- regression — color / probe.denoise.toggle_on
- noise — color / probe.denoise.toggle_off
- slow — color / cold.denoise.toggle_on / on
- slow — color / cold.denoise.toggle_on / off
- noise — wheels / probe.tone.exposure.drag
- noise — wheels / probe.tone.contrast.drag
- noise — wheels / probe.denoise.toggle_on
- slow — wheels / probe.denoise.toggle_on
- regression — wheels / probe.denoise.toggle_on
- noise — wheels / probe.denoise.toggle_off
- slow — wheels / cold.denoise.toggle_on / on
- slow — wheels / cold.denoise.toggle_on / off
- impact — hsl / probe.tone.exposure.drag
- impact — hsl / probe.tone.contrast.drag
- noise — hsl / probe.denoise.toggle_on
- slow — hsl / probe.denoise.toggle_on
- noise — hsl / probe.denoise.toggle_off
- slow — hsl / cold.denoise.toggle_on / on
- slow — hsl / cold.denoise.toggle_on / off
- noise — vignette / probe.tone.exposure.drag
- noise — vignette / probe.tone.contrast.drag
- noise — vignette / probe.denoise.toggle_on
- slow — vignette / probe.denoise.toggle_on
- noise — vignette / probe.denoise.toggle_off
- slow — vignette / cold.denoise.toggle_on / on
- slow — vignette / cold.denoise.toggle_on / off
- impact — film / probe.tone.exposure.drag
- impact — film / probe.tone.contrast.drag
- slow — film / probe.denoise.toggle_on
- impact — film / probe.denoise.toggle_off
- slow — film / cold.denoise.toggle_on / on
- slow — film / cold.denoise.toggle_on / off

## Code findings

No findings supplied.
