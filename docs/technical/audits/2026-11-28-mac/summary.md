# Grade module audit

Times are medians in ms. Deltas are module ON minus OFF. Memory is the sampled app footprint peak in MB.
Drain time is recorded in the JSON and does not trigger a flag.

## DSC00636.ARW at 100%

Stevens-MacBook-Neo.local, 1408x794 at 2×, ac, app 0.9.4 (bb0d1f35ba73cfb13e00f8cbe36accb49e384100).
Baseline spread 0.0% (start, middle). [Run JSON](module-impact-large-100.json)

| Module / lane | Probe | First feedback Δ ms (%) | Settle Δ ms (%) | Peak Δ MB | Flags |
| --- | --- | ---: | ---: | ---: | --- |
| baseline / hdr | No paired probes | — | — | — | — |
| tone / hdr | probe.denoise.toggle_on | 16.0 (20.4%) | 16.1 (20.5%) | -29.7 | — |
| tone / hdr | probe.denoise.toggle_off | -0.3 (-0.5%) | -0.3 (-0.5%) | -0.8 | noise |
| denoise / hdr | No paired probes | — | — | — | — |
| film / hdr | probe.tone.exposure.drag | 6780.4 (1491.8%) | 4687.7 (4062.1%) | -67.2 | impact |
| film / hdr | probe.tone.contrast.drag | 6884.0 (1970.8%) | 2798.0 (7881.7%) | -67.1 | impact |
| film / hdr | probe.denoise.toggle_on | 2802.0 (3615.5%) | 2801.9 (3610.7%) | 206.8 | impact |
| film / hdr | probe.denoise.toggle_off | 1834.5 (2907.3%) | 1834.6 (2907.4%) | 54.2 | impact |
| detail / hdr | error | — | — | — | — |
| local / hdr | probe.tone.exposure.drag | 1.3 (0.3%) | 1.2 (1.0%) | -52.7 | noise |
| local / hdr | probe.tone.contrast.drag | 17.6 (5.3%) | 0.4 (1.1%) | -1.9 | noise |
| local / hdr | probe.denoise.toggle_on | 0.8 (0.9%) | 0.8 (0.9%) | -79.9 | noise |
| local / hdr | probe.denoise.toggle_off | 16.3 (25.0%) | 16.4 (25.2%) | -91.0 | — |
| retouch / hdr | error | — | — | — | — |
| geometry / hdr | probe.tone.exposure.drag | -102.0 (-23.5%) | -82.7 (-70.7%) | -208.0 | — |
| geometry / hdr | probe.tone.contrast.drag | -31.8 (-8.7%) | -3.7 (-9.6%) | -186.0 | noise |
| geometry / hdr | probe.denoise.toggle_on | 0.9 (1.0%) | 1.0 (1.1%) | -92.2 | noise |
| geometry / hdr | probe.denoise.toggle_off | 1.4 (1.7%) | 1.5 (1.9%) | -87.7 | noise |

### Exceptions

- baseline — middle: App memory ceiling exceeded (4000 MB) in probe.tone.exposure.drag/on, probe.tone.contrast.drag/on, probe.denoise.toggle_on/on, probe.denoise.toggle_off/on.
- tone / cold.denoise.toggle_on / on — Preparation already resident before enable.
- tone / cold.denoise.toggle_on / off — Preparation already resident before enable.
- tone / probe.tone.exposure.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.tone.contrast.drag / off — Self-reference: probe belongs to the bypassed module.
- denoise — App memory ceiling exceeded (4000 MB) in own.denoise.micro_grain.toggle_on/on, own.denoise.micro_grain.amount.drag/on, probe.tone.exposure.drag/on, probe.tone.contrast.drag/on, probe.denoise.toggle_on/on, probe.denoise.toggle_off/on, probe.tone.exposure.drag/off, probe.tone.contrast.drag/off.
- denoise / probe.tone.exposure.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_on / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_on / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_on / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_on / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_on / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_off / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_off / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_off / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_off / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_off / on — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.exposure.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.tone.contrast.drag / off — CPU fallback at 1236 px — The app was short of shared memory, so this preview is reduced. Export is full size.
- denoise / probe.denoise.toggle_on / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_off / off — Self-reference: probe belongs to the bypassed module.
- film / cold.denoise.toggle_on / on — Preparation already resident before enable.
- film / cold.denoise.toggle_on / off — Preparation already resident before enable.
- detail — page.waitForFunction: Timeout 120000ms exceeded.
- detail / cold.denoise.toggle_on / on — Preparation already resident before enable.
- detail / cold.denoise.toggle_on / off — Preparation already resident before enable.
- local / cold.denoise.toggle_on / on — Preparation already resident before enable.
- local / cold.denoise.toggle_on / off — Preparation already resident before enable.
- retouch — retouch.seed.heal.2: second click did not save the requested Heal. Repair was not applied. See the edit message; previous picture retained.
- geometry / cold.denoise.toggle_on / on — Preparation already resident before enable.
- geometry / cold.denoise.toggle_on / off — Preparation already resident before enable.

### Flags

- noise — tone / probe.denoise.toggle_off
- impact — film / probe.tone.exposure.drag
- impact — film / probe.tone.contrast.drag
- impact — film / probe.denoise.toggle_on
- impact — film / probe.denoise.toggle_off
- noise — local / probe.tone.exposure.drag
- noise — local / probe.tone.contrast.drag
- noise — local / probe.denoise.toggle_on
- noise — geometry / probe.tone.contrast.drag
- noise — geometry / probe.denoise.toggle_on
- noise — geometry / probe.denoise.toggle_off

## DSC00636.ARW at Fit

Stevens-MacBook-Neo.local, 1408x794 at 2×, ac, app 0.9.4 (29b3f93adb83dcf6353775b0630ddfeebdcf8e7b).
Baseline spread 192.4% (start, middle, end). [Run JSON](module-impact-large-fit.json)

| Module / lane | Probe | First feedback Δ ms (%) | Settle Δ ms (%) | Peak Δ MB | Flags |
| --- | --- | ---: | ---: | ---: | --- |
| baseline / hdr | No paired probes | — | — | — | — |
| raw.cleanup / hdr | probe.tone.exposure.drag | 1.2 (3.5%) | 1.8 (94.7%) | -35.0 | noise |
| raw.cleanup / hdr | probe.tone.contrast.drag | -5.0 (-13.2%) | 1.1 (57.9%) | -30.9 | noise |
| raw.cleanup / hdr | probe.denoise.toggle_on | -13.7 (-22.6%) | -13.6 (-22.4%) | -22.7 | noise |
| raw.cleanup / hdr | probe.denoise.toggle_off | 2.0 (4.4%) | 2.0 (4.4%) | -63.7 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.exposure.drag | -0.3 (-0.9%) | 0.8 (42.1%) | -22.2 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.contrast.drag | 0.5 (1.5%) | -1.3 (-100.0%) | -50.0 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_on | -15.5 (-24.7%) | -15.4 (-24.5%) | -31.7 | — |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_off | -2.0 (-4.2%) | -2.0 (-4.2%) | -8.2 | noise |
| raw.highlights / hdr / IMG_3129.CR2 | probe.tone.exposure.drag | -1.9 (-5.4%) | -1.3 (-41.9%) | -19.0 | noise |
| raw.highlights / hdr / IMG_3129.CR2 | probe.tone.contrast.drag | 1.2 (3.6%) | 0.6 (37.5%) | -10.1 | noise |
| raw.highlights / hdr / IMG_3129.CR2 | probe.denoise.toggle_on | 1.5 (2.5%) | 1.5 (2.5%) | -11.6 | noise |
| raw.highlights / hdr / IMG_3129.CR2 | probe.denoise.toggle_off | -0.1 (-0.2%) | -0.1 (-0.2%) | -4.5 | noise |
| denoise / hdr | probe.tone.exposure.drag | 0.1 (0.3%) | -0.3 (-13.6%) | 33.4 | noise |
| denoise / hdr | probe.tone.contrast.drag | 1.6 (4.7%) | 0.6 (50.0%) | 57.5 | noise |
| tone / hdr | probe.denoise.toggle_on | -0.1 (-0.2%) | -0.2 (-0.3%) | 2.7 | noise |
| tone / hdr | probe.denoise.toggle_off | 0.1 (0.2%) | 0.0 (0.0%) | -1.4 | noise |
| bands / hdr | probe.tone.exposure.drag | 0.7 (2.0%) | 1.3 (65.0%) | 7.6 | noise |
| bands / hdr | probe.tone.contrast.drag | -0.1 (-0.3%) | -0.3 (-15.0%) | -6.9 | noise |
| bands / hdr | probe.denoise.toggle_on | -17.1 (-27.6%) | -17.1 (-27.6%) | 12.3 | — |
| bands / hdr | probe.denoise.toggle_off | 0.2 (0.4%) | 0.2 (0.4%) | 15.9 | noise |
| curves / hdr | probe.tone.exposure.drag | 0.7 (2.1%) | 0.0 (0.0%) | 14.3 | noise |
| curves / hdr | probe.tone.contrast.drag | -1.3 (-3.8%) | -1.9 (-42.2%) | 9.5 | noise |
| curves / hdr | probe.denoise.toggle_on | 1.6 (2.7%) | 1.6 (2.7%) | 5.7 | noise |
| curves / hdr | probe.denoise.toggle_off | -0.3 (-0.6%) | -0.3 (-0.6%) | 3.8 | noise |
| highlight_compression / hdr | probe.tone.exposure.drag | 1.0 (3.0%) | 434.1 (27131.3%) | -59.4 | impact |
| highlight_compression / hdr | probe.tone.contrast.drag | -1.9 (-5.6%) | 431.3 (20538.1%) | -17.2 | impact |
| highlight_compression / hdr | probe.denoise.toggle_on | -0.6 (-1.0%) | -0.6 (-1.0%) | -1.4 | noise |
| highlight_compression / hdr | probe.denoise.toggle_off | 1.3 (2.9%) | 1.3 (2.9%) | -13.0 | noise |
| color / hdr | probe.tone.exposure.drag | -2.8 (-7.8%) | -0.7 (-38.9%) | -24.9 | noise |
| color / hdr | probe.tone.contrast.drag | -1.3 (-3.9%) | -0.2 (-8.3%) | 1.0 | noise |
| color / hdr | probe.denoise.toggle_on | -0.2 (-0.3%) | -0.1 (-0.2%) | 3.3 | noise |
| color / hdr | probe.denoise.toggle_off | 0.8 (1.8%) | 0.8 (1.8%) | 9.9 | noise |
| wheels / hdr | probe.tone.exposure.drag | 1.3 (3.8%) | -0.4 (-16.7%) | 4.6 | noise |
| wheels / hdr | probe.tone.contrast.drag | 2.0 (6.0%) | 0.7 (63.6%) | 15.1 | noise |
| wheels / hdr | probe.denoise.toggle_on | 0.3 (0.5%) | 0.3 (0.5%) | -8.1 | noise |
| wheels / hdr | probe.denoise.toggle_off | -0.9 (-2.0%) | -0.8 (-1.8%) | -9.3 | noise |
| hsl / hdr | probe.tone.exposure.drag | 135.6 (400.0%) | 21.9 (2190.0%) | 14.7 | impact |
| hsl / hdr | probe.tone.contrast.drag | 137.0 (411.4%) | 35.0 (1944.4%) | -1.0 | impact |
| hsl / hdr | probe.denoise.toggle_on | -0.6 (-1.0%) | -0.6 (-1.0%) | -20.3 | noise |
| hsl / hdr | probe.denoise.toggle_off | -1.3 (-2.9%) | -1.2 (-2.7%) | -30.1 | noise |
| bw / hdr | probe.tone.exposure.drag | 1.9 (5.7%) | 0.1 (10.0%) | -17.4 | noise |
| bw / hdr | probe.tone.contrast.drag | 0.8 (2.3%) | -1.7 (-100.0%) | -27.4 | noise |
| bw / hdr | probe.denoise.toggle_on | -1.0 (-1.6%) | -1.0 (-1.6%) | -3.5 | noise |
| bw / hdr | probe.denoise.toggle_off | 0.1 (0.2%) | 0.1 (0.2%) | -11.9 | noise |
| vignette / hdr | probe.tone.exposure.drag | -3.0 (-8.1%) | 0.2 (18.2%) | 9.3 | noise |
| vignette / hdr | probe.tone.contrast.drag | 2.8 (8.4%) | -0.1 (-9.1%) | -11.2 | noise |
| vignette / hdr | probe.denoise.toggle_on | 0.0 (0.0%) | 0.0 (0.0%) | -12.4 | noise |
| vignette / hdr | probe.denoise.toggle_off | -0.4 (-0.9%) | -0.4 (-0.9%) | 6.5 | noise |
| detail / hdr | probe.tone.exposure.drag | 63.7 (185.7%) | 20.1 (670.0%) | 11.6 | impact |
| detail / hdr | probe.tone.contrast.drag | 30.4 (88.6%) | 25.8 | 33.0 | — |
| detail / hdr | probe.denoise.toggle_on | 0.5 (0.8%) | 0.5 (0.8%) | 16.0 | noise |
| detail / hdr | probe.denoise.toggle_off | 0.2 (0.5%) | 0.2 (0.5%) | -1.2 | noise |
| film / hdr | probe.tone.exposure.drag | 1858.6 (5581.4%) | 872.9 (1774.2%) | -24.2 | impact |
| film / hdr | probe.tone.contrast.drag | 1893.1 (5519.2%) | 951.3 (1957.4%) | -39.1 | impact |
| film / hdr | probe.denoise.toggle_on | 838.4 (1388.1%) | 838.4 (1388.1%) | -71.9 | impact |
| film / hdr | probe.denoise.toggle_off | 815.7 (1866.6%) | 815.7 (1866.6%) | -80.2 | impact |
| sdr_match / sdr | probe.tone.exposure.drag | 141.6 (437.0%) | -398.2 (-99.4%) | 7.9 | impact |
| sdr_match / sdr | probe.tone.contrast.drag | 11.0 (33.3%) | -416.0 (-99.5%) | -3.3 | — |
| sdr_match / sdr | probe.denoise.toggle_on | -16.2 (-25.7%) | -16.2 (-25.7%) | -11.7 | — |
| sdr_match / sdr | probe.denoise.toggle_off | -16.2 (-25.3%) | -16.2 (-25.3%) | -55.4 | — |
| local / hdr | probe.tone.exposure.drag | -0.1 (-0.3%) | 0.6 (16.2%) | -12.3 | noise |
| local / hdr | probe.tone.contrast.drag | -1.8 (-5.0%) | 0.1 (3.0%) | 5.2 | noise |
| local / hdr | probe.denoise.toggle_on | -0.3 (-0.5%) | -0.3 (-0.5%) | -27.3 | noise |
| local / hdr | probe.denoise.toggle_off | -0.4 (-0.9%) | -0.4 (-0.9%) | -22.7 | noise |
| retouch / hdr | probe.tone.exposure.drag | 2.6 (7.8%) | -1.0 (-50.0%) | -60.0 | noise |
| retouch / hdr | probe.tone.contrast.drag | 1.3 (3.9%) | -0.9 (-36.0%) | 21.5 | noise |
| retouch / hdr | probe.denoise.toggle_on | -0.8 (-1.3%) | -0.9 (-1.4%) | 24.9 | noise |
| retouch / hdr | probe.denoise.toggle_off | -0.7 (-1.5%) | -0.7 (-1.5%) | -22.5 | noise |
| geometry / hdr | probe.tone.exposure.drag | -2.8 (-7.8%) | 0.1 (5.3%) | -85.5 | noise |
| geometry / hdr | probe.tone.contrast.drag | 0.4 (1.2%) | 1.5 (150.0%) | -64.5 | noise |
| geometry / hdr | probe.denoise.toggle_on | 1.7 (2.8%) | 1.7 (2.8%) | -74.1 | noise |
| geometry / hdr | probe.denoise.toggle_off | 0.1 (0.2%) | 0.1 (0.2%) | -41.3 | noise |

### Exceptions

- baseline / cold.denoise.toggle_on / on — slow (settle 9697.2 ms)
- raw.cleanup / own.raw.cleanup.raw-speck-threshold.drag / on — slow (settle 6677.2 ms)
- raw.cleanup / own.raw.cleanup.specks.click / on — slow (settle 6619.9 ms)
- raw.cleanup / own.raw.cleanup.hot-pixels.click / on — slow (settle 6656.7 ms)
- raw.cleanup / cold.denoise.toggle_on / on — slow (settle 9816.8 ms)
- raw.cleanup / cold.denoise.toggle_on / off — slow (settle 9749.8 ms)
- raw.lens / own.raw.lens.distortion.click / on — slow (settle 5350.2 ms)
- raw.lens / own.raw.lens.mode-off.apply / on — slow (settle 4997.3 ms)
- raw.lens / cold.denoise.toggle_on / on — slow (settle 7749.9 ms)
- raw.lens / cold.denoise.toggle_on / off — slow (settle 7882.6 ms)
- raw.highlights / own.raw.highlights.raw-highlight-threshold.drag / on — slow (settle 2196.7 ms)
- raw.highlights / own.raw.highlights.eye / on — slow (settle 2163.7 ms)
- raw.highlights / cold.denoise.toggle_on / on — slow (settle 3134.7 ms)
- raw.highlights / cold.denoise.toggle_on / off — slow (settle 3129.7 ms)
- denoise / cold.denoise.clean_grain.toggle_on / on — slow (settle 9776.7 ms)
- denoise / cold.denoise.micro_grain.toggle_on / on — slow (settle 35755.4 ms)
- denoise / probe.denoise.toggle_on / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_off / off — Self-reference: probe belongs to the bypassed module.
- tone / cold.denoise.toggle_on / on — Preparation already resident before enable.
- tone / cold.denoise.toggle_on / off — Preparation already resident before enable.
- tone / probe.tone.exposure.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.tone.contrast.drag / off — Self-reference: probe belongs to the bypassed module.
- bands / cold.denoise.toggle_on / on — Preparation already resident before enable.
- bands / cold.denoise.toggle_on / off — Preparation already resident before enable.
- curves / cold.denoise.toggle_on / on — Preparation already resident before enable.
- curves / cold.denoise.toggle_on / off — Preparation already resident before enable.
- highlight_compression / cold.denoise.toggle_on / on — Preparation already resident before enable.
- highlight_compression / cold.denoise.toggle_on / off — Preparation already resident before enable.
- color / cold.denoise.toggle_on / on — Preparation already resident before enable.
- color / cold.denoise.toggle_on / off — Preparation already resident before enable.
- wheels / cold.denoise.toggle_on / on — Preparation already resident before enable.
- wheels / cold.denoise.toggle_on / off — Preparation already resident before enable.
- hsl / cold.denoise.toggle_on / on — Preparation already resident before enable.
- hsl / cold.denoise.toggle_on / off — Preparation already resident before enable.
- bw / cold.denoise.toggle_on / on — Preparation already resident before enable.
- bw / cold.denoise.toggle_on / off — Preparation already resident before enable.
- vignette / cold.denoise.toggle_on / on — Preparation already resident before enable.
- vignette / cold.denoise.toggle_on / off — Preparation already resident before enable.
- detail / cold.denoise.toggle_on / on — Preparation already resident before enable.
- detail / cold.denoise.toggle_on / off — Preparation already resident before enable.
- film / cold.denoise.toggle_on / on — Preparation already resident before enable.
- film / cold.denoise.toggle_on / off — Preparation already resident before enable.
- sdr_match / own.sdr_match.entire.click / on — slow (settle 2316.7 ms)
- sdr_match / cold.denoise.toggle_on / on — slow (settle 9484.6 ms)
- sdr_match / cold.denoise.toggle_on / off — Preparation already resident before enable.
- local / cold.denoise.toggle_on / on — Preparation already resident before enable.
- local / cold.denoise.toggle_on / off — Preparation already resident before enable.
- retouch / cold.denoise.toggle_on / on — slow (settle 13051.0 ms)
- retouch / cold.denoise.toggle_on / off — slow (settle 10483.8 ms)
- geometry / cold.denoise.toggle_on / on — Preparation already resident before enable.
- geometry / cold.denoise.toggle_on / off — Preparation already resident before enable.

### Flags

- slow — baseline / cold.denoise.toggle_on / on
- noise — raw.cleanup / probe.tone.exposure.drag
- noise — raw.cleanup / probe.tone.contrast.drag
- noise — raw.cleanup / probe.denoise.toggle_on
- noise — raw.cleanup / probe.denoise.toggle_off
- slow — raw.cleanup / own.raw.cleanup.raw-speck-threshold.drag / on
- slow — raw.cleanup / own.raw.cleanup.specks.click / on
- slow — raw.cleanup / own.raw.cleanup.hot-pixels.click / on
- slow — raw.cleanup / cold.denoise.toggle_on / on
- slow — raw.cleanup / cold.denoise.toggle_on / off
- noise — raw.lens / probe.tone.exposure.drag
- noise — raw.lens / probe.tone.contrast.drag
- noise — raw.lens / probe.denoise.toggle_off
- slow — raw.lens / own.raw.lens.distortion.click / on
- slow — raw.lens / own.raw.lens.mode-off.apply / on
- slow — raw.lens / cold.denoise.toggle_on / on
- slow — raw.lens / cold.denoise.toggle_on / off
- noise — raw.highlights / probe.tone.exposure.drag
- noise — raw.highlights / probe.tone.contrast.drag
- noise — raw.highlights / probe.denoise.toggle_on
- noise — raw.highlights / probe.denoise.toggle_off
- slow — raw.highlights / own.raw.highlights.raw-highlight-threshold.drag / on
- slow — raw.highlights / own.raw.highlights.eye / on
- slow — raw.highlights / cold.denoise.toggle_on / on
- slow — raw.highlights / cold.denoise.toggle_on / off
- noise — denoise / probe.tone.exposure.drag
- noise — denoise / probe.tone.contrast.drag
- slow — denoise / cold.denoise.clean_grain.toggle_on / on
- slow — denoise / cold.denoise.micro_grain.toggle_on / on
- noise — tone / probe.denoise.toggle_on
- noise — tone / probe.denoise.toggle_off
- noise — bands / probe.tone.exposure.drag
- noise — bands / probe.tone.contrast.drag
- noise — bands / probe.denoise.toggle_off
- noise — curves / probe.tone.exposure.drag
- noise — curves / probe.tone.contrast.drag
- noise — curves / probe.denoise.toggle_on
- noise — curves / probe.denoise.toggle_off
- impact — highlight_compression / probe.tone.exposure.drag
- impact — highlight_compression / probe.tone.contrast.drag
- noise — highlight_compression / probe.denoise.toggle_on
- noise — highlight_compression / probe.denoise.toggle_off
- noise — color / probe.tone.exposure.drag
- noise — color / probe.tone.contrast.drag
- noise — color / probe.denoise.toggle_on
- noise — color / probe.denoise.toggle_off
- noise — wheels / probe.tone.exposure.drag
- noise — wheels / probe.tone.contrast.drag
- noise — wheels / probe.denoise.toggle_on
- noise — wheels / probe.denoise.toggle_off
- impact — hsl / probe.tone.exposure.drag
- impact — hsl / probe.tone.contrast.drag
- noise — hsl / probe.denoise.toggle_on
- noise — hsl / probe.denoise.toggle_off
- noise — bw / probe.tone.exposure.drag
- noise — bw / probe.tone.contrast.drag
- noise — bw / probe.denoise.toggle_on
- noise — bw / probe.denoise.toggle_off
- noise — vignette / probe.tone.exposure.drag
- noise — vignette / probe.tone.contrast.drag
- noise — vignette / probe.denoise.toggle_on
- noise — vignette / probe.denoise.toggle_off
- impact — detail / probe.tone.exposure.drag
- noise — detail / probe.denoise.toggle_on
- noise — detail / probe.denoise.toggle_off
- impact — film / probe.tone.exposure.drag
- impact — film / probe.tone.contrast.drag
- impact — film / probe.denoise.toggle_on
- impact — film / probe.denoise.toggle_off
- impact — sdr_match / probe.tone.exposure.drag
- slow — sdr_match / own.sdr_match.entire.click / on
- slow — sdr_match / cold.denoise.toggle_on / on
- noise — local / probe.tone.exposure.drag
- noise — local / probe.tone.contrast.drag
- noise — local / probe.denoise.toggle_on
- noise — local / probe.denoise.toggle_off
- noise — retouch / probe.tone.exposure.drag
- noise — retouch / probe.tone.contrast.drag
- noise — retouch / probe.denoise.toggle_on
- noise — retouch / probe.denoise.toggle_off
- slow — retouch / cold.denoise.toggle_on / on
- slow — retouch / cold.denoise.toggle_on / off
- noise — geometry / probe.tone.exposure.drag
- noise — geometry / probe.tone.contrast.drag
- noise — geometry / probe.denoise.toggle_on
- noise — geometry / probe.denoise.toggle_off

## IMG_0790.CR2 at Fit

Stevens-MacBook-Neo.local, 1408x794 at 2×, ac, app 0.9.4 (29b3f93adb83dcf6353775b0630ddfeebdcf8e7b).
Baseline spread 0.0% (not captured). [Run JSON](module-impact-noisy-fit.json)

| Module / lane | Probe | First feedback Δ ms (%) | Settle Δ ms (%) | Peak Δ MB | Flags |
| --- | --- | ---: | ---: | ---: | --- |
| denoise / hdr | probe.tone.exposure.drag | 0.2 (0.6%) | -1.1 (-26.2%) | 16.3 | noise |
| denoise / hdr | probe.tone.contrast.drag | 1.1 (3.2%) | -0.5 (-15.6%) | 39.9 | noise |

### Exceptions

- denoise / cold.denoise.clean_grain.toggle_on / on — slow (settle 3877.5 ms)
- denoise / cold.denoise.micro_grain.toggle_on / on — slow (settle 8082.8 ms)
- denoise / probe.denoise.toggle_on / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_off / off — Self-reference: probe belongs to the bypassed module.

### Flags

- noise — denoise / probe.tone.exposure.drag
- noise — denoise / probe.tone.contrast.drag
- slow — denoise / cold.denoise.clean_grain.toggle_on / on
- slow — denoise / cold.denoise.micro_grain.toggle_on / on

## IMG_7723.CR3 at Fit

Stevens-MacBook-Neo.local, 1408x794 at 2×, ac, app 0.9.4 (29b3f93adb83dcf6353775b0630ddfeebdcf8e7b).
Baseline spread 295.8% (start, middle, end). [Run JSON](module-impact-typical-fit.json)

| Module / lane | Probe | First feedback Δ ms (%) | Settle Δ ms (%) | Peak Δ MB | Flags |
| --- | --- | ---: | ---: | ---: | --- |
| baseline / hdr | No paired probes | — | — | — | — |
| raw.cleanup / hdr | probe.tone.exposure.drag | -1.2 (-3.3%) | -0.2 (-4.1%) | -7.1 | noise |
| raw.cleanup / hdr | probe.tone.contrast.drag | 1.7 (5.1%) | -0.6 (-13.0%) | -32.1 | noise |
| raw.cleanup / hdr | probe.denoise.toggle_on | -0.1 (-0.2%) | 0.0 (0.0%) | -28.3 | noise |
| raw.cleanup / hdr | probe.denoise.toggle_off | -0.1 (-0.2%) | 0.0 (0.0%) | -34.0 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.exposure.drag | 0.8 (2.3%) | -2.2 (-53.7%) | -47.4 | noise |
| raw.lens / hdr / _DSC7970.ARW | probe.tone.contrast.drag | 66.9 (201.5%) | -0.7 (-46.7%) | -54.9 | impact |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_on | -16.5 (-26.0%) | -16.5 (-26.0%) | -36.3 | — |
| raw.lens / hdr / _DSC7970.ARW | probe.denoise.toggle_off | 0.3 (0.6%) | 0.3 (0.6%) | -33.6 | noise |
| raw.highlights / hdr / IMG_3129.CR2 | probe.tone.exposure.drag | -100.4 (-75.7%) | 0.3 (6.1%) | -21.6 | — |
| raw.highlights / hdr / IMG_3129.CR2 | probe.tone.contrast.drag | 0.3 (0.9%) | 0.3 (13.0%) | -10.1 | noise |
| raw.highlights / hdr / IMG_3129.CR2 | probe.denoise.toggle_on | -0.5 (-1.1%) | -0.5 (-1.1%) | -28.3 | noise |
| raw.highlights / hdr / IMG_3129.CR2 | probe.denoise.toggle_off | -0.2 (-0.4%) | -0.2 (-0.4%) | -28.4 | noise |
| denoise / hdr | probe.tone.exposure.drag | -0.9 (-2.5%) | -1.4 (-37.8%) | -8.1 | noise |
| denoise / hdr | probe.tone.contrast.drag | -264.8 (-88.6%) | -1.1 (-36.7%) | 13.4 | — |
| tone / hdr | probe.denoise.toggle_on | 3.2 (5.4%) | 3.2 (5.4%) | -2.1 | noise |
| tone / hdr | probe.denoise.toggle_off | -0.6 (-1.3%) | -0.6 (-1.3%) | -0.5 | noise |
| bands / hdr | probe.tone.exposure.drag | 1.5 (4.7%) | -0.9 (-40.9%) | 0.8 | noise |
| bands / hdr | probe.tone.contrast.drag | -0.4 (-1.2%) | 0.2 (10.5%) | 14.6 | noise |
| bands / hdr | probe.denoise.toggle_on | 0.4 (0.7%) | 0.3 (0.5%) | 14.6 | noise |
| bands / hdr | probe.denoise.toggle_off | -1.9 (-4.1%) | -1.9 (-4.1%) | 17.0 | noise |
| curves / hdr | probe.tone.exposure.drag | -0.3 (-0.9%) | -2.3 (-59.0%) | -8.1 | noise |
| curves / hdr | probe.tone.contrast.drag | -0.8 (-2.4%) | -0.7 (-25.0%) | -0.7 | noise |
| curves / hdr | probe.denoise.toggle_on | -1.6 (-2.6%) | -1.7 (-2.7%) | -15.5 | noise |
| curves / hdr | probe.denoise.toggle_off | 1.9 (4.2%) | 1.9 (4.2%) | -5.7 | noise |
| highlight_compression / hdr | probe.tone.exposure.drag | 0.0 (0.0%) | 384.3 (24018.8%) | -37.5 | impact |
| highlight_compression / hdr | probe.tone.contrast.drag | 1.0 (3.0%) | 384.1 (34918.2%) | -6.7 | impact |
| highlight_compression / hdr | probe.denoise.toggle_on | -0.8 (-1.3%) | -0.8 (-1.3%) | -1.6 | noise |
| highlight_compression / hdr | probe.denoise.toggle_off | 0.3 (0.7%) | 0.3 (0.7%) | -9.4 | noise |
| color / hdr | probe.tone.exposure.drag | 0.1 (0.3%) | 0.6 (46.2%) | -8.5 | noise |
| color / hdr | probe.tone.contrast.drag | -0.2 (-0.6%) | -0.8 (-50.0%) | -3.5 | noise |
| color / hdr | probe.denoise.toggle_on | 0.3 (0.5%) | 0.2 (0.3%) | -28.6 | noise |
| color / hdr | probe.denoise.toggle_off | -0.5 (-1.1%) | -0.5 (-1.1%) | -16.6 | noise |
| wheels / hdr | probe.tone.exposure.drag | 0.1 (0.3%) | 0.4 (25.0%) | -5.9 | noise |
| wheels / hdr | probe.tone.contrast.drag | -0.1 (-0.3%) | -0.1 (-6.3%) | 3.1 | noise |
| wheels / hdr | probe.denoise.toggle_on | 0.6 (1.0%) | 0.5 (0.8%) | 5.8 | noise |
| wheels / hdr | probe.denoise.toggle_off | -0.6 (-1.3%) | -0.6 (-1.3%) | 2.9 | noise |
| hsl / hdr | probe.tone.exposure.drag | 285.5 (883.9%) | 19.0 (500.0%) | -28.5 | impact |
| hsl / hdr | probe.tone.contrast.drag | 284.8 (855.3%) | 19.7 (437.8%) | 8.9 | impact |
| hsl / hdr | probe.denoise.toggle_on | 15.9 (33.9%) | 16.0 (34.1%) | 34.8 | noise |
| hsl / hdr | probe.denoise.toggle_off | -0.5 (-1.1%) | -0.4 (-0.8%) | 35.6 | noise |
| bw / hdr | probe.tone.exposure.drag | 0.3 (0.9%) | -0.9 (-20.0%) | 9.6 | noise |
| bw / hdr | probe.tone.contrast.drag | -0.9 (-2.6%) | 0.4 (12.9%) | -11.8 | noise |
| bw / hdr | probe.denoise.toggle_on | 0.3 (0.6%) | 0.3 (0.6%) | -1.5 | noise |
| bw / hdr | probe.denoise.toggle_off | 0.3 (0.6%) | 0.3 (0.6%) | 12.6 | noise |
| vignette / hdr | probe.tone.exposure.drag | -99.3 (-74.8%) | -1.0 (-34.5%) | 6.7 | — |
| vignette / hdr | probe.tone.contrast.drag | 1.5 (4.6%) | -1.3 (-34.2%) | -7.3 | noise |
| vignette / hdr | probe.denoise.toggle_on | 1.0 (2.1%) | 1.0 (2.1%) | -9.2 | noise |
| vignette / hdr | probe.denoise.toggle_off | 0.1 (0.2%) | 0.2 (0.4%) | -20.5 | noise |
| detail / hdr | probe.tone.exposure.drag | 1.4 (4.3%) | 19.0 (826.1%) | 2.4 | — |
| detail / hdr | probe.tone.contrast.drag | 1.2 (3.6%) | 25.2 (1482.4%) | -5.0 | — |
| detail / hdr | probe.denoise.toggle_on | 0.9 (1.4%) | 1.0 (1.6%) | 2.4 | noise |
| detail / hdr | probe.denoise.toggle_off | 1.1 (2.4%) | 1.0 (2.2%) | -39.9 | noise |
| film / hdr | probe.tone.exposure.drag | 3051.3 (9135.6%) | 1276.3 (2934.0%) | 2.4 | impact, slow |
| film / hdr | probe.tone.contrast.drag | 2754.8 (8450.3%) | 1322.7 (2656.0%) | -23.3 | impact, slow |
| film / hdr | probe.denoise.toggle_on | 908.7 (1453.9%) | 908.7 (1453.9%) | -46.8 | impact |
| film / hdr | probe.denoise.toggle_off | 898.9 (1967.0%) | 898.9 (1967.0%) | -56.3 | impact |
| sdr_match / sdr | probe.tone.exposure.drag | -20.9 (-15.9%) | -368.2 (-99.4%) | -0.2 | — |
| sdr_match / sdr | probe.tone.contrast.drag | 78.3 (241.7%) | -367.5 (-99.5%) | -3.6 | — |
| sdr_match / sdr | probe.denoise.toggle_on | -2.3 (-3.6%) | -2.3 (-3.6%) | -7.2 | noise |
| sdr_match / sdr | probe.denoise.toggle_off | -16.8 (-26.1%) | -16.8 (-26.1%) | 12.5 | — |
| local / hdr | probe.tone.exposure.drag | 0.1 (0.3%) | -1.9 (-50.0%) | -7.9 | noise |
| local / hdr | probe.tone.contrast.drag | -96.5 (-72.6%) | -0.8 (-21.6%) | 1.2 | noise |
| local / hdr | probe.denoise.toggle_on | -0.2 (-0.3%) | -0.2 (-0.3%) | 0.8 | noise |
| local / hdr | probe.denoise.toggle_off | -0.5 (-1.0%) | -0.5 (-1.0%) | -6.3 | noise |
| retouch / hdr | probe.tone.exposure.drag | 0.5 (1.5%) | -0.8 (-30.8%) | 29.4 | noise |
| retouch / hdr | probe.tone.contrast.drag | -2.0 (-5.6%) | 0.3 (9.4%) | -12.8 | noise |
| retouch / hdr | probe.denoise.toggle_on | 0.7 (1.5%) | 0.7 (1.5%) | 13.0 | noise |
| retouch / hdr | probe.denoise.toggle_off | 0.1 (0.2%) | 0.1 (0.2%) | -0.7 | noise |
| geometry / hdr | probe.tone.exposure.drag | -1.6 (-4.6%) | 0.3 (13.6%) | -46.6 | noise |
| geometry / hdr | probe.tone.contrast.drag | -1.9 (-5.6%) | -0.7 (-43.7%) | -59.2 | noise |
| geometry / hdr | probe.denoise.toggle_on | 0.9 (1.5%) | 0.9 (1.5%) | -45.3 | noise |
| geometry / hdr | probe.denoise.toggle_off | 0.7 (1.5%) | 0.8 (1.8%) | -21.0 | noise |

### Exceptions

- baseline / cold.denoise.toggle_on / on — slow (settle 4195.0 ms)
- raw.cleanup / own.raw.cleanup.raw-speck-threshold.drag / on — slow (settle 2998.2 ms)
- raw.cleanup / own.raw.cleanup.specks.click / on — slow (settle 2940.4 ms)
- raw.cleanup / own.raw.cleanup.hot-pixels.click / on — slow (settle 2948.6 ms)
- raw.cleanup / cold.denoise.toggle_on / on — slow (settle 4164.9 ms)
- raw.cleanup / cold.denoise.toggle_on / off — slow (settle 4181.0 ms)
- raw.lens / own.raw.lens.distortion.click / on — slow (settle 5038.4 ms)
- raw.lens / own.raw.lens.mode-off.apply / on — slow (settle 4768.8 ms)
- raw.lens / cold.denoise.toggle_on / on — slow (settle 7598.3 ms)
- raw.lens / cold.denoise.toggle_on / off — slow (settle 7715.7 ms)
- raw.highlights / own.raw.highlights.raw-highlight-threshold.drag / on — slow (settle 2187.6 ms)
- raw.highlights / own.raw.highlights.eye / on — slow (settle 2166.1 ms)
- raw.highlights / cold.denoise.toggle_on / on — slow (settle 3164.1 ms)
- raw.highlights / cold.denoise.toggle_on / off — slow (settle 3114.1 ms)
- denoise / cold.denoise.clean_grain.toggle_on / on — slow (settle 4344.7 ms)
- denoise / cold.denoise.micro_grain.toggle_on / on — slow (settle 9381.9 ms)
- denoise / probe.denoise.toggle_on / off — Self-reference: probe belongs to the bypassed module.
- denoise / probe.denoise.toggle_off / off — Self-reference: probe belongs to the bypassed module.
- tone / cold.denoise.toggle_on / on — Preparation already resident before enable.
- tone / cold.denoise.toggle_on / off — Preparation already resident before enable.
- tone / probe.tone.exposure.drag / off — Self-reference: probe belongs to the bypassed module.
- tone / probe.tone.contrast.drag / off — Self-reference: probe belongs to the bypassed module.
- bands / cold.denoise.toggle_on / on — Preparation already resident before enable.
- bands / cold.denoise.toggle_on / off — Preparation already resident before enable.
- curves / cold.denoise.toggle_on / on — Preparation already resident before enable.
- curves / cold.denoise.toggle_on / off — Preparation already resident before enable.
- highlight_compression / cold.denoise.toggle_on / on — Preparation already resident before enable.
- highlight_compression / cold.denoise.toggle_on / off — Preparation already resident before enable.
- color / cold.denoise.toggle_on / on — Preparation already resident before enable.
- color / cold.denoise.toggle_on / off — Preparation already resident before enable.
- wheels / cold.denoise.toggle_on / on — Preparation already resident before enable.
- wheels / cold.denoise.toggle_on / off — Preparation already resident before enable.
- hsl / cold.denoise.toggle_on / on — slow (settle 4314.1 ms)
- hsl / cold.denoise.toggle_on / off — Preparation already resident before enable.
- bw / cold.denoise.toggle_on / on — Preparation already resident before enable.
- bw / cold.denoise.toggle_on / off — Preparation already resident before enable.
- vignette / cold.denoise.toggle_on / on — Preparation already resident before enable.
- vignette / cold.denoise.toggle_on / off — Preparation already resident before enable.
- detail / cold.denoise.toggle_on / on — Preparation already resident before enable.
- detail / cold.denoise.toggle_on / off — Preparation already resident before enable.
- film / cold.denoise.toggle_on / on — Preparation already resident before enable.
- film / cold.denoise.toggle_on / off — Preparation already resident before enable.
- film / probe.tone.exposure.drag / on — slow (settle 1319.8 ms)
- film / probe.tone.contrast.drag / on — slow (settle 1372.5 ms)
- sdr_match / own.sdr_match.entire.click / on — slow (settle 2297.4 ms)
- sdr_match / cold.denoise.toggle_on / on — slow (settle 4181.4 ms)
- sdr_match / cold.denoise.toggle_on / off — Preparation already resident before enable.
- local / cold.denoise.toggle_on / on — Preparation already resident before enable.
- local / cold.denoise.toggle_on / off — Preparation already resident before enable.
- retouch / cold.denoise.toggle_on / on — slow (settle 4198.0 ms)
- retouch / cold.denoise.toggle_on / off — slow (settle 4432.4 ms)
- geometry / cold.denoise.toggle_on / on — Preparation already resident before enable.
- geometry / cold.denoise.toggle_on / off — Preparation already resident before enable.

### Flags

- slow — baseline / cold.denoise.toggle_on / on
- noise — raw.cleanup / probe.tone.exposure.drag
- noise — raw.cleanup / probe.tone.contrast.drag
- noise — raw.cleanup / probe.denoise.toggle_on
- noise — raw.cleanup / probe.denoise.toggle_off
- slow — raw.cleanup / own.raw.cleanup.raw-speck-threshold.drag / on
- slow — raw.cleanup / own.raw.cleanup.specks.click / on
- slow — raw.cleanup / own.raw.cleanup.hot-pixels.click / on
- slow — raw.cleanup / cold.denoise.toggle_on / on
- slow — raw.cleanup / cold.denoise.toggle_on / off
- noise — raw.lens / probe.tone.exposure.drag
- impact — raw.lens / probe.tone.contrast.drag
- noise — raw.lens / probe.denoise.toggle_off
- slow — raw.lens / own.raw.lens.distortion.click / on
- slow — raw.lens / own.raw.lens.mode-off.apply / on
- slow — raw.lens / cold.denoise.toggle_on / on
- slow — raw.lens / cold.denoise.toggle_on / off
- noise — raw.highlights / probe.tone.contrast.drag
- noise — raw.highlights / probe.denoise.toggle_on
- noise — raw.highlights / probe.denoise.toggle_off
- slow — raw.highlights / own.raw.highlights.raw-highlight-threshold.drag / on
- slow — raw.highlights / own.raw.highlights.eye / on
- slow — raw.highlights / cold.denoise.toggle_on / on
- slow — raw.highlights / cold.denoise.toggle_on / off
- noise — denoise / probe.tone.exposure.drag
- slow — denoise / cold.denoise.clean_grain.toggle_on / on
- slow — denoise / cold.denoise.micro_grain.toggle_on / on
- noise — tone / probe.denoise.toggle_on
- noise — tone / probe.denoise.toggle_off
- noise — bands / probe.tone.exposure.drag
- noise — bands / probe.tone.contrast.drag
- noise — bands / probe.denoise.toggle_on
- noise — bands / probe.denoise.toggle_off
- noise — curves / probe.tone.exposure.drag
- noise — curves / probe.tone.contrast.drag
- noise — curves / probe.denoise.toggle_on
- noise — curves / probe.denoise.toggle_off
- impact — highlight_compression / probe.tone.exposure.drag
- impact — highlight_compression / probe.tone.contrast.drag
- noise — highlight_compression / probe.denoise.toggle_on
- noise — highlight_compression / probe.denoise.toggle_off
- noise — color / probe.tone.exposure.drag
- noise — color / probe.tone.contrast.drag
- noise — color / probe.denoise.toggle_on
- noise — color / probe.denoise.toggle_off
- noise — wheels / probe.tone.exposure.drag
- noise — wheels / probe.tone.contrast.drag
- noise — wheels / probe.denoise.toggle_on
- noise — wheels / probe.denoise.toggle_off
- impact — hsl / probe.tone.exposure.drag
- impact — hsl / probe.tone.contrast.drag
- noise — hsl / probe.denoise.toggle_on
- noise — hsl / probe.denoise.toggle_off
- slow — hsl / cold.denoise.toggle_on / on
- noise — bw / probe.tone.exposure.drag
- noise — bw / probe.tone.contrast.drag
- noise — bw / probe.denoise.toggle_on
- noise — bw / probe.denoise.toggle_off
- noise — vignette / probe.tone.contrast.drag
- noise — vignette / probe.denoise.toggle_on
- noise — vignette / probe.denoise.toggle_off
- noise — detail / probe.denoise.toggle_on
- noise — detail / probe.denoise.toggle_off
- impact — film / probe.tone.exposure.drag
- slow — film / probe.tone.exposure.drag
- impact — film / probe.tone.contrast.drag
- slow — film / probe.tone.contrast.drag
- impact — film / probe.denoise.toggle_on
- impact — film / probe.denoise.toggle_off
- noise — sdr_match / probe.denoise.toggle_on
- slow — sdr_match / own.sdr_match.entire.click / on
- slow — sdr_match / cold.denoise.toggle_on / on
- noise — local / probe.tone.exposure.drag
- noise — local / probe.tone.contrast.drag
- noise — local / probe.denoise.toggle_on
- noise — local / probe.denoise.toggle_off
- noise — retouch / probe.tone.exposure.drag
- noise — retouch / probe.tone.contrast.drag
- noise — retouch / probe.denoise.toggle_on
- noise — retouch / probe.denoise.toggle_off
- slow — retouch / cold.denoise.toggle_on / on
- slow — retouch / cold.denoise.toggle_on / off
- noise — geometry / probe.tone.exposure.drag
- noise — geometry / probe.tone.contrast.drag
- noise — geometry / probe.denoise.toggle_on
- noise — geometry / probe.denoise.toggle_off

## Code findings

185 findings. [Merged evidence](findings.jsonl)

| Group | Value | Count |
| --- | --- | ---: |
| package | C | 7 |
| package | H | 1 |
| package | M1 | 18 |
| package | M2 | 12 |
| package | M3 | 14 |
| package | M4 | 16 |
| package | M5 | 15 |
| package | M6 | 14 |
| package | R1 | 18 |
| package | R2 | 12 |
| package | R3 | 12 |
| package | R4 | 14 |
| package | R5 | 11 |
| package | T | 21 |
| category | bug | 54 |
| category | docs | 10 |
| category | hardening | 11 |
| category | perf | 77 |
| category | test | 23 |
| category | tidy | 10 |
| severity | high | 32 |
| severity | low | 61 |
| severity | medium | 92 |
| status | duplicate | 1 |
| status | fixed | 53 |
| status | needs-steve | 33 |
| status | open | 98 |

| ID | Status | Severity | Category | Area | Summary |
| --- | --- | --- | --- | --- | --- |
| C-1 | open | high | perf | film | With Film Look on, Exposure and Contrast drags take 1.9-3.1 s to first feedback (vs ~35 ms off) and a warm Denoise toggle takes ~0.9 s (vs ~50 ms) at Fit. |
| C-2 | open | high | bug | denoise | At 100% on the 50 MP Sony, GPU process memory grows across module switches (1.0 -> 3.1 GB) while the WebGPU allocator reports 90-430 MB; the app exceeds its 4,000 MB Mac ceiling after Micro Grain and falls back to cpu-reduced preview, and stays there for the next module. |
| C-3 | open | high | perf | film | Film Look at 100% on the 50 MP Sony is extremely slow: in a fresh app, Exposure/Contrast drags take ~7.2 s with Film on (0.35-0.45 s off), a Denoise toggle 2.9 s, Film's own drags 3.0-3.5 s. After the Denoise module (memory near ceiling) it produced no frame within 120 s, and Detail then timed out the same way. |
| C-4 | open | medium | perf | raw.cleanup | RAW setting changes cost 3-7 s each: cleanup click 2.9 s (24 MP) / 6.6 s (50 MP), lens toggle ~5 s, highlight threshold drag ~2.5 s. |
| C-5 | open | medium | perf | highlight_compression | With Highlight Compression on, Exposure and Contrast drags settle ~0.4 s later at Fit. |
| C-6 | open | low | perf | hsl | With HSL on, Exposure and Contrast drags take +140-290 ms to first feedback at Fit. |
| C-7 | open | medium | bug | retouch | At 100% on the 50 MP Sony, the second Heal of the audit seed was refused ("Repair was not applied"), while the same two Heals work at Fit on both photos. |
| H-1 | open | medium | bug | local | Turning on Denoise silently re-enables bypassed Local Adjustments. |
| M1-1 | open | low | test | raw.cleanup | Both baseline RAWs are eligible for cleanup but the typical photo does not exercise hot-pixel repair. |
| M1-2 | open | medium | test | raw.lens | Auto lens coverage requires a known matching photo and an active distortion operation. |
| M1-3 | open | medium | test | raw.highlights | Highlight reconstruction needs a verified clipped-channel input rather than the default photo aliases. |
| M1-4 | needs-steve | medium | bug | raw.highlights | A RAW change made while editing SDR unexpectedly returns the viewer to HDR. |
| M1-5 | open | medium | perf | raw.lens | Every lens-only re-development repeats the unchanged RAW decode, cleanup, highlight reconstruction and colour conversion. |
| M1-6 | needs-steve | high | bug | raw.cleanup | Undoing an earlier cleanup edit can silently roll back a later Lens or Highlight Reconstruction change. |
| M1-7 | needs-steve | high | bug | raw.highlights | The Highlight Reconstruction method, threshold and Expand controls can stay stale after same-session RAW replacement and overwrite the restored settings on the next edit. |
| M1-8 | needs-steve | high | bug | raw.lens | Switching from one manual Lensfun photo to another can leave the former photo's profile selected and apply it to the latter. |
| M1-9 | open | medium | perf | raw.lens | A lens-only change can repeat full-resolution Micro Grain rendering even when the earlier Bayer preparation is reusable. |
| M1-10 | open | medium | perf | raw.lens | Lensfun remap repeats the same coordinate math per channel for the no-TCA layout. |
| M1-11 | open | medium | perf | raw.lens | Grade writes a second full-size source after developing large RAWs into scratch memory. |
| M1-12 | open | medium | perf | raw.highlights | Opposed reconstruction materializes a float mosaic and clipping mask even on entirely unclipped photos. |
| M1-13 | open | medium | perf | raw.highlights | CPU Edge fallback has several full-size planes live together while the old Grade source is retained. |
| M1-14 | open | medium | test | raw.lens | Blocked RAW probe rows settle correctly but priming hides cold Denoise preparation caused by re-development. |
| M1-15 | open | medium | perf | raw.lens | Apply with no changes still tears down preview and Denoise preparation and starts an entire RAW replacement. |
| M1-16 | open | low | perf | raw.cleanup | Warm cleanup repair hits still hash the full visible sensor and repack strided strips. |
| M1-17 | needs-steve | high | bug | raw.highlights | RAW replacement can carry the old source's Highlight Compression peak numbers into a new image. |
| M1-18 | needs-steve | medium | bug | raw.highlights | Repeated transient GPU preemption can retry Edge colour more than once before falling back to CPU. |
| M2-1 | open | medium | test | denoise | The driver times all three Denoise methods, but does not apply a recipe per method or establish that each actually changed the picture. |
| M2-2 | needs-steve | high | bug | denoise | At native zoom, a cached GPU Micro Grain tile can keep showing the previous slider settings. |
| M2-3 | needs-steve | high | bug | denoise | At native zoom, GPU Clean Grain can reuse an old colour correction after settings change, even across a packed-colour to brightness-only layout change. |
| M2-4 | open | medium | perf | denoise | Lens-corrected Micro Grain can turn a native-zoom toggle into a whole-photo CPU job. |
| M2-5 | open | medium | perf | denoise | Warm Clean Grain can lose its expensive exact Fit picture during the Off half of an A/B toggle. |
| M2-6 | open | medium | perf | denoise | A downstream Grade edit can restart preparation already in flight even though it does not invalidate settled preparation. |
| M2-7 | open | medium | perf | denoise | A hit on exact Clean Grain at Fit still allocates and computes a full blend texture on every draw, including unrelated Grade updates. |
| M2-8 | open | medium | perf | denoise | The first settled native render of a Simple or CPU-backed Denoise state deliberately leaves nothing in the resolved tile cache. |
| M2-9 | open | low | perf | denoise | Cold GPU noise measurement keeps a full input buffer after its only dispatch and uses a separate command submission for each pass. |
| M2-10 | needs-steve | medium | bug | denoise | Micro Grain stays latched to the CPU after undoing the geometry that made the GPU route unsupported. |
| M2-11 | open | medium | test | denoise | The audit can mislabel warm Denoise rebuilds and can time out on an accepted reduced CPU fallback. |
| M2-12 | open | low | perf | denoise | Warm toggle-on waits for the settings save before it looks for a ready GPU result. |
| M3-1 | open | low | test | tone | Keep the visibly non-neutral Tone recipe and its existing self-reference rule. |
| M3-2 | open | low | test | bands | Keep an explicitly authored 0 EV Exposure Band and select it before the own probe. |
| M3-3 | open | medium | test | curves | The luma seed bends the curve, but the own probe guesses the handle location without using the plot insets. |
| M3-4 | open | medium | test | highlight_compression | The Highlight Compression seed raises peak levels but the harness does not check that the cap was exercised. |
| M3-5 | open | medium | perf | tone | Every native Tone input redraws both highlight graphs and runs unrelated global panel bookkeeping before scheduling a frame. |
| M3-6 | open | medium | perf | highlight_compression | Direct SDR Peak Fit brackets a GPU-to-CPU peak readback around each eligible frame, including live draws when liveMode is set. |
| M3-7 | open | medium | perf | tone | A warm reduced Clean Grain delta can still be blended up front on every Tone frame. |
| M3-8 | needs-steve | high | bug | curves | Moving an already-active global curve can reuse Detail's sharpen bands from the previous curve on the tiled route. |
| M3-9 | open | medium | perf | highlight_compression | A Highlight Compression Start drag reruns the upstream picture graph and invalidates Peak Fit measurements even though Start is applied at the output. |
| M3-10 | open | medium | perf | bands | Exposure Bands reconstructs the same interpolation data up to 180 times per slider input and refreshes unrelated controls. |
| M3-11 | open | low | perf | curves | Unchanged global samples are already cached, but any authored local curve forces fresh packed allocation and LUT upload on every render. |
| M3-12 | open | high | test | highlight_compression | The default Peak Fit preset schedules an own-control drag on the hidden Softness slider, which can stop the module before its impact probes. |
| M3-13 | open | medium | bug | highlight_compression | The normal HDR Maximum anchor path can grow its peak cache without the 32-entry limit used by the compute path. |
| M3-14 | needs-steve | medium | bug | highlight_compression | CPU and WGSL take different color paths for signed HDR pixels in a frame whose delivery channels are already below target. |
| M4-1 | needs-steve | high | bug | hsl | The direct Global HSL mask cache can keep old coverage after an upstream Whites edit. |
| M4-2 | open | low | perf | hsl | The picker synchronizes the same global edit state twice before sending one post-release sampling request. |
| M4-3 | open | medium | perf | hsl | Tiled HSL rebuilds selection from scratch for every tile even during HSL slider edits that do not change coverage. |
| M4-4 | open | medium | perf | hsl | Show selection repeats CPU guide preparation and PNG transfer after range changes and even after edits that leave coverage unchanged. |
| M4-5 | needs-steve | high | bug | hsl | Global HSL picking and Show selection sample the un-denoised picture even when the rendered HSL selects the denoised one. |
| M4-6 | open | medium | perf | hsl | Turning HSL off does not release its large, grow-only GPU work textures. |
| M4-7 | open | medium | perf | bw | A nonzero Black & White mix adds 25 neighbouring texture reads per pixel before the normal grade, even when only Exposure or Contrast is being dragged. |
| M4-8 | open | medium | perf | hsl | The shared-mask shader still evaluates each pixel's analytical hue-range coverage even when only the shared mask is used. |
| M4-9 | open | medium | perf | wheels | Dragging a wheel puck updates every grade control on every pointer move and bypasses the normal gesture pacing. |
| M4-10 | open | low | perf | vignette | The Vignette outline does layout reads when hidden and rebuilds both paths even when Amount does not change the shape. |
| M4-11 | open | low | perf | color | Active Color recomputes the same primaries matrix even when the changed control cannot affect the matrix. |
| M4-12 | open | high | test | color | The Color seed is rejected because tint 8 exceeds the backend maximum of 2. |
| M4-13 | open | medium | test | wheels | The current tint-only Wheels seed produces a weak signature on both photos, and Blending misses the actual wheel gesture. |
| M4-14 | open | high | test | hsl | The HSL recipe uses an invalid hue_shift property and the legal part of the red-only seed is too narrow for these photos. |
| M4-15 | open | low | test | bw | The installed B&W seed is suitable, but its ON/OFF pixel change alone cannot prove the guided mix was applied. |
| M4-16 | open | low | test | vignette | The existing Vignette seed is visibly non-neutral on both photos and its percent units must be kept. |
| M5-1 | duplicate | high | bug | detail | Tiled Clarity and packed Detail can reuse analysis of the wrong input after editing an already-enabled curve or changing Denoise. |
| M5-2 | open | medium | perf | film | Post-lens Film controls can reuse the exact lens sum, but upstream Exposure or Contrast invalidates it and schedules 55 optical passes per rendered region. |
| M5-3 | open | medium | perf | film | Halation extract and both broad blur passes run again even when only a downstream Film control changes. |
| M5-4 | open | medium | perf | detail | Direct preview reruns both packed Detail blur passes even for a Clarity-only edit, and still does them when Clarity is the only enabled control. |
| M5-5 | open | medium | perf | film | Exact Fit Film recomputes its deterministic physical grain for every redrawn pixel, including on downstream-only edits. |
| M5-6 | needs-steve | high | bug | detail | At native zoom the tiled global Clarity prepass can fill too little source for later spatial effects, and can reduce wrongly clamped base-grade samples at chunk edges. |
| M5-7 | needs-steve | high | bug | film | Halation’s tile halo omits bilinear sampling support when no Lens Filter is active. |
| M5-8 | open | medium | perf | detail | Detail scratch remains resident after bypass and its packed tile cache can compete with the native zoom working set. |
| M5-9 | open | medium | perf | film | The Film chain schedules two full-size identity draws even on a simple no-structure frame. |
| M5-10 | open | low | perf | film | Film Stock picker focus is a real Grade preview, and focusing or closing on an unchanged option still retires and reschedules a frame. |
| M5-11 | open | medium | bug | detail | Clarity’s retained GPU map allocations are missing from the resident memory ledger. |
| M5-12 | open | medium | perf | film | Print Contrast sends megabytes of unchanged film tables for each newly sampled slider value, before the preview can draw. |
| M5-13 | needs-steve | high | bug | film | A single transient stock-table request failure can keep a selected Film stock visually missing for the rest of the frontend session. |
| M5-14 | open | low | test | detail | The current Detail audit changes pixels on both RAWs but is subtle at Fit and does not directly drag the radius cache path. |
| M5-15 | open | low | test | film | The Portra audit recipe makes a clear change on both RAWs, but current own drags miss the print-table path and the scan stage. |
| M6-1 | open | medium | test | local | Local measures an implicit Fit-only gesture recipe and can click outside the viewport at 100%. |
| M6-2 | open | medium | test | retouch | The two Heal donors change source position between Fit and 100%. |
| M6-3 | open | medium | test | geometry | The Geometry audit seed never exercises the perspective warp. |
| M6-4 | open | medium | test | sdr_match | SDR Match OFF restores the defaults captured before seeding HDR, so it does not isolate the Match from its HDR setup. |
| M6-5 | open | medium | perf | retouch | A second small repair copies the full native RGB frame even though repair solving and changed output rectangles are bounded. |
| M6-6 | open | medium | perf | geometry | Repeated whole-proxy requests can rewarp the same already-developed mip. |
| M6-7 | open | medium | perf | local | The pre-pin pass uses an obsolete luminance-mask key, so one local can evict another mask still needed by the same frame. |
| M6-8 | needs-steve | medium | bug | sdr_match | Whole SDR Match computes its target without enabled HDR Denoise and only copies those settings after fitting. |
| M6-9 | open | medium | perf | sdr_match | An explicit repeat of the same Match still runs the picture fit and CPU certification from scratch. |
| M6-10 | open | medium | perf | sdr_match | A superseded Match can wait for a GPU candidate and then run an entire CPU fit that cannot be applied. |
| M6-11 | needs-steve | medium | bug | retouch | Grade announces ordinary Heal and Clone work as a GPU failure. |
| M6-12 | open | medium | perf | retouch | Renaming an enabled repair dirties the renderer's source, local masks and both Denoise preparations without changing pixels. |
| M6-13 | open | low | hardening | local | Mask preparation diagnostics can grow for a whole renderer lifetime even with instrumentation disabled. |
| M6-14 | open | low | hardening | retouch | Retouch keeps a full serialized recipe as the route diagnostic key for each superseded edit until the session closes. |
| R1-1 | fixed | high | bug | desktop | Failure to initialize the diagnostic log aborts startup before its error handler and can block shutdown. |
| R1-2 | fixed | medium | perf | desktop | The portable grading-preset dialogs do selected file I/O synchronously on Electron's main thread, and export parses the same JSON three times. |
| R1-3 | fixed | high | hardening | desktop | Malformed progress and diagnostic event fields can throw uncaught in Electron's fire-and-forget listeners. |
| R1-4 | fixed | low | hardening | desktop | A failed startup splash load is silently discarded while the rest of startup continues. |
| R1-5 | needs-steve | medium | bug | desktop | Saved grading presets can be hidden when presets from other groups fill the directory scan limit. |
| R1-6 | needs-steve | medium | bug | desktop | Export Grading Presets fails before opening the Save dialog in packaged builds. |
| R1-7 | needs-steve | medium | bug | desktop | Cancelling Quit leaves it armed, so a later ordinary editor close can close the detached Library and quit the app. |
| R1-8 | fixed | low | perf | desktop | Library cache-folder discovery and reveal can block the main process on a filesystem probe or mkdir. |
| R1-9 | fixed | low | perf | desktop | A startup or manual update check blocks the main thread when loading or writing its disk cache. |
| R1-10 | fixed | low | hardening | desktop | Settings and window bounds silently fall back to defaults when their stored JSON cannot be read. |
| R1-11 | fixed | low | perf | desktop | Opening or remembering a Recent project makes synchronous disk calls on the main process. |
| R1-12 | needs-steve | high | bug | desktop | A backend exit during its final health check can leave the editor connected to a dead process. |
| R1-13 | needs-steve | medium | bug | desktop | A detached Library paste can stay pending after the editor closes or its renderer crashes. |
| R1-14 | fixed | low | perf | desktop | Open and Save As check the selected project path synchronously in the main process. |
| R1-15 | fixed | medium | perf | desktop | Opening or editing a grading preset can block the desktop main thread on repeated filesystem calls. |
| R1-16 | fixed | low | hardening | desktop | A rejected backend-exit dialog or Windows session-end warning leaves no diagnostic. |
| R1-17 | open | low | perf | desktop | Changing application settings or rendering mode still performs a synchronous preferences write on the main thread. |
| R1-18 | open | low | hardening | desktop | Desktop shutdown discards both delivery shutdown request failures and non-success responses. |
| R2-1 | fixed | low | perf | library | Library renderers keep running a 100 ms Grade activity timer that cannot report any activity. |
| R2-2 | fixed | medium | bug | library | Overlay map decoding leaves the bitmap open if the canvas draw fails and relies on GC for the full temporary canvas backing even after successful readback. |
| R2-3 | fixed | medium | bug | library | The periodic RAM report and explicit reclaim report can post out of order from the same Library window. |
| R2-4 | fixed | medium | bug | library | A stored thumbnail format mismatch leaves the discarded WebGPU canvas configured. |
| R2-5 | fixed | low | bug | library | Cancelling a native Library upload leaves its abort listener on the owner and can start a fresh worker solely to cancel a dead stream. |
| R2-6 | fixed | medium | bug | library | Releasing a ready picture underreports retained thumbnail GPU memory. |
| R2-7 | fixed | medium | bug | library | A delayed native-detail heartbeat can recreate a released GPU reservation. |
| R2-8 | fixed | medium | perf | library | A thumbnail plan invalidated while waiting for navigation can still start source admission and CPU fallback. |
| R2-9 | needs-steve | high | bug | library | An unfinished stored thumbnail can publish the previous HDR/SDR rendition after an HDR toggle. |
| R2-10 | open | low | perf | library | The hidden delivery renderer starts more permit requests while a previous heartbeat is unresolved. |
| R2-11 | open | low | perf | library | A ready-surface poll can issue two broker requests every 100 ms while a GPU-backed ready picture is retained. |
| R2-12 | open | medium | bug | library | The Desktop pressure relay and Library HTTP reports can overwrite each other with stale cache caps. |
| R3-1 | fixed | low | perf | grade-frontend | The JPEG CPU preview serializes and parses the local draft immediately before serializing it again in the HTTP body. |
| R3-2 | fixed | low | perf | grade-frontend | The geometry-map path clones the full adjustment tree even when it joins an existing request or is in backoff. |
| R3-3 | fixed | medium | perf | grade-frontend | Brush overlay frames project every committed point even with a hidden, authoritative or cached mask, and fallback replay repeatedly reacquires the erase context. |
| R3-4 | fixed | low | hardening | grade-frontend | A failed Retouch cancel notification leaves an unhandled fetch rejection. |
| R3-5 | needs-steve | high | bug | grade-frontend | A clean sidecar check can replace a newer local edit with an external grade. |
| R3-6 | needs-steve | high | bug | grade-frontend | Finishing a Retouch repair can discard a global slider edit made while the repair is in flight. |
| R3-7 | needs-steve | medium | perf | grade-frontend | Hovered modifier sliders rebuild their tick markup per input, and queued work can reapply fine mode after pointer leave. |
| R3-8 | fixed | low | perf | grade-frontend | The save status chrome replaces unchanged text nodes on every global edit and twice per successful idle poll. |
| R3-9 | fixed | low | hardening | grade-frontend | A truncated candidate response rejects the detached SDR Match worker. |
| R3-10 | fixed | low | perf | grade-frontend | Every ordinary Grade input recreates the Film stock fact chips even when the stock facts have not changed. |
| R3-11 | fixed | medium | perf | grade-frontend | Editing one global slider rewrites the text and accessible value for all non-editing Grade readouts. |
| R3-12 | open | low | perf | grade-frontend | A queued exact highlight anchor keeps waking every 200 ms after Grade settles on a reduced picture. |
| R4-1 | fixed | medium | perf | backend | A browser upload blocks the shared API loop while writing and decoding the photo. |
| R4-2 | fixed | medium | bug | backend | A failed encode leaves partial scratch files in the RAW thumbnail and overlay caches. |
| R4-3 | needs-steve | high | bug | backend | RAW re-development can reuse the previous source's Denoise model under the same session ID. |
| R4-4 | fixed | medium | perf | backend | Reduced Library PNG loading allocates a second full float32 sample frame for a scalar multiply. |
| R4-5 | fixed | medium | hardening | backend | The Library detail upload limit is checked only after buffering the entire body when no length is declared. |
| R4-6 | fixed | low | bug | backend | Failed Library settings or file-command journal flushes leave temp files behind. |
| R4-7 | needs-steve | high | bug | backend | RAW re-development can install pixels decoded with obsolete source interpretation or reference white. |
| R4-8 | fixed | medium | bug | backend | A session opened during the first source-mip initialization can permanently miss the shared store. |
| R4-9 | needs-steve | high | bug | backend | Replacing a file during opening can attach its new fingerprint to pixels from the old file. |
| R4-10 | fixed | medium | bug | backend | The startup cleanup can delete a source mip that another request is actively writing. |
| R4-11 | open | medium | perf | backend | Quarter-turns and flips each materialize another full picture before any resampling or crop. |
| R4-12 | open | low | perf | backend | RAW speck cleanup copies each phase into a separate result despite already owning a copied output strip. |
| R4-13 | open | high | hardening | backend | Direct Library developed-source uploads can allocate memory from a length declared before source ownership is validated. |
| R4-14 | open | medium | perf | backend | A request for one Grade source lane can build an unused decoded mip for the other lane. |
| R5-1 | fixed | medium | bug | grade-frontend | A cancelled pan-source upload can capture a replacement request or publish after a photo reset. |
| R5-2 | fixed | medium | bug | grade-frontend | A detached CPU scope can start queued analysis that belongs to its replacement. |
| R5-3 | open | medium | bug | grade-frontend | Photo or job reset omits explicit destruction of the Direct renderer's finished texture. |
| R5-4 | open | medium | perf | grade-frontend | Every foreground Grade render waits on delivery-accounting IPC even when no GPU reservation is held. |
| R5-5 | open | medium | perf | grade-frontend | Tiled drag frames run an exact peak reduction and wait for its readback even when the draft peak is not published. |
| R5-6 | needs-steve | high | bug | grade-frontend | Packed Detail bands and the tiled Clarity map do not fully identify the input picture they were built from. |
| R5-7 | needs-steve | high | bug | grade-frontend | A cancelled or failed tile encoder can leave an unwritten Detail band cached as a hit. |
| R5-8 | needs-steve | high | bug | grade-frontend | Grade device rebuild keeps GPU peak resources from the lost device. |
| R5-9 | open | medium | perf | grade-frontend | Output-stage controls invalidate earlier Detail caches that never read those controls. |
| R5-10 | open | medium | perf | grade-frontend | A live scope can get ahead of the next already pending drag frame on the GPU. |
| R5-11 | open | medium | bug | grade-frontend | Staging cleanup can fence the wrong device or miss destruction during a rebuild. |
| T-1 | fixed | low | test | repo | The ordinary fast Node run misses the fit-filtering unit tests. |
| T-2 | fixed | low | tidy | repo | Four tracked Round 4 research scripts are stored under disposable output. |
| T-3 | fixed | low | docs | repo | The documentation map links to a missing active UI polish round 4 brief and repeats the archived entry out of section. |
| T-4 | fixed | low | docs | repo | Eleven briefs, reports, reviews and test reference documents are missing from the documentation map. |
| T-5 | fixed | low | docs | repo | The technical archive totals in the map are stale. |
| T-6 | fixed | low | docs | repo | The master PRD still calls v0.9.1 the current release. |
| T-7 | fixed | low | docs | repo | Dated change notes appear before the main heading and push the code navigation down. |
| T-8 | fixed | low | docs | repo | The completed next-version investigation is listed with active briefs. |
| T-9 | fixed | low | docs | repo | The completed Windows startup hardening record is stored with active work. |
| T-10 | open | low | docs | repo | The RAW starting Exposure brief is not ready to archive. |
| T-11 | open | low | docs | repo | The original Library draw-live brief has no clear closure for its full scope. |
| T-12 | fixed | low | tidy | repo | The finished GPU RAW prototype is not distinguished from current tools in the tools directory. |
| T-13 | fixed | low | tidy | repo | The standalone HSL prototype lacks a history label in the tools directory. |
| T-14 | fixed | low | tidy | repo | The legacy Windows package builder can be mistaken for the current release workflow. |
| T-15 | fixed | low | tidy | repo | The hand-run Library scroll analyser lacks a discoverable purpose and status. |
| T-16 | fixed | low | tidy | repo | The hand-run local media probe lacks a discoverable purpose and status. |
| T-17 | fixed | low | tidy | repo | The hand-run scope profiler lacks a discoverable purpose and status. |
| T-18 | fixed | low | tidy | repo | The three similarly named Library JPEG probes have no shared guide to their distinct roles. |
| T-19 | fixed | low | docs | repo | The audit lacks a short account of the useful repository structure and what the tidy-up leaves unchanged. |
| T-20 | open | low | tidy | repo | Several large rendering and backend files still span multiple responsibilities. |
| T-21 | open | low | tidy | repo | Round 4 reproduction still needs untracked Round 3 source and staged data. |
