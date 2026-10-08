# Phase 3 continuation evidence — October 3, 2026

The subsequent [regional eraser slice](viewport-phase3-regional-erase-evidence-2026-10-03.md)
removes the primary edited brush's CPU native-mask batch without weakening
admission, preserves qualified bitmap resolution on recreation, and records
native comparisons plus three sessions per mode. First-native picture median
is 657.6 ms versus 2347.5 ms with the new method disabled; scopes are 990.5
versus 2681.3 ms. Stroke/feather and phase 3 exit targets remain open.

This continues the [exit audit](viewport-phase3-exit-audit-2026-10-03.md).
The working tree remains uncommitted. Phase 3 is open; phase 4 has not started.
Steve accepted the three displayed rounded trial cases (228, 249, 421) as
visually close enough on October 3. This is acceptance of those exact cases,
not a general increase of the two-level soft-mask limit. The existing trial
and general approval remain distinct. Match, Peak/automatic-anchor redesign and SDR cross-scale
continuity retain Steve's existing decisions.

## Implementation and precise route boundaries

* Outer-boundary paths now have GPU coverage for uniform feather, paired
  inner/outer guides, curves in either guide, unequal guide vertex counts,
  softness and inversion. Paired flattening and perimeter resampling follow
  CPU export. The 2,048 flattened-vertex guard remains. Index geometry is
  supported; resampling geometry remains unsupported by this raster shader.
* Cropped regional expression graphs now qualify their leaves against the
  uncropped index frame while retaining separately checked, integer crop
  placement. A crop no longer rejects a graph solely because its coordinates
  are nonidentity. Graphs containing unsupported leaves still fall back.
* Shift Edge now runs the six-box blur, painted-peak normalization, threshold,
  density restoration and ordered erase/invert operations on a bounded GPU
  bitmap, with Feather after Shift. This does **not** close native Shift Edge:
  the softness classifier rejects shifted masks for stretching and there is
  no exact native regional Shift Edge implementation yet.
* Narrow feathered brushes that fail admission at every size through 3,200
  still require the exact CPU mask. GPU admission reserves raster rounding;
  bend, small painted-core peak deficit, narrow-mark mass error and hard
  eraser bands remain distinct rejection causes. In the edited primary's
  final 0.03 Feather state, the 3,200 bitmap estimate is 3.012 and native
  requests one CPU batch compiling its mask. This is unfinished GPU work,
  not a new deferral or permission to raise the approved tolerance.
* Straighten/perspective use export's resampling geometry, including Pillow
  bicubic perspective sampling. The current GPU shape builder supports
  integer quarter turns, flips and rounded crops; enabling a homography
  without reproducing that resampling would move hard edges. The exact CPU
  fallback remains in place. Resampling graphs containing shape/gradient
  leaves consequently remain unsupported.
* Auxiliary analytic masks no longer require a picture proxy at the exact
  mask edge. Source metadata supplies dimensions and a resident texture
  satisfies the unused shared layout binding. This eliminates a redundant
  1,600-edge CPU path draft when a different picture edge is resident.
* Eligible analytic gradient slider edits no longer set the picture's
  structural-mask hold flag. Their current document is rasterized on the GPU
  during the drag; authoritative overlay drafts remain separate. Content-
  qualified gradients, resampling geometry and child-mask comparisons retain
  their existing hold/fallback contract.

## Accuracy repair

The luminance mask discrepancy was a product fault: GPU feathering used an
ideal truncated Gaussian while export uses six discrete boxes. GPU interior
weights now derive from that discrete impulse response; halos use its full
finite support. At physical frame boundaries, GPU prefix-sum box passes
preserve export's repeated boundary clamping. Inversion follows the blur.
Boundary scratch is released after submitted work; final textures remain
owned by the mask cache. Refinement keys include Feather and inversion so
different locals do not repeatedly overwrite and rebuild one shared entry.

The four-mask native luminance result before this repair was 2.126 levels
(centre, 39 pixels over two) and 2.25 (upper-left, 62 over two). The six-box
native check reduces it to approximately 1.20 / 1.19 / 0.73 levels across the
three regions, with zero pixels over two, in both lanes. The source-backed
authored-SDR graph's lower-right result fell from 4.36 to 0.82 levels after
correct boundary handling. Its final repeat passes picture, mask and Peak
checks in all three native regions.

The primary as saved was rechecked after the six-box/cache work. Native HDR
and SDR picture, all masks and Peak pass in centre, upper-left and lower-right.
The two feathered brush maxima remain 1.12 and 1.48 levels. No wider trial
is needed for this result.

The compact survey now samples the actual GPU R16 texture, not an ideal R8
bitmap. The rounded implementation has three admitted cases over two levels,
maximum 2.338917. A continuous-feather trial reduces this to two
cases, maximum 2.213013 (case 228, 205 pixels) and 2.010742 (case 421, seven
pixels). R8 classification and its existing allowance are unchanged; 140 of
798 small cases are admitted, with no case over the working three-level trial.
All 804 direct bitmap reference cases remain within one level. The continuous
trial's native primary, four-mask and actual authored-SDR checks pass picture,
mask and Peak in three regions; primary brush maxima reduce to 1.09 and 1.12.
The trial was **not retained**: repeated primary timings showed late extra
generations and substantial final-picture delays. Rounded control repeats
also show late generations, so the delay cannot cleanly be attributed to this
shader change; neither implementation has a complete primary timing exit.
The original rounding is restored rather than accepting an uncertain tradeoff.
This trial does not approve a wider limit. Concrete
CPU/GPU/detail/difference panels are in `mask-review-continuous/mask-trial-228.png`
and `mask-trial-421.png`. Current rounded panels are in `mask-review-rounded`
for cases 228, 249 and 421. The earlier 2.333321 R8-only finding is historical.

Current rounded cases accepted by Steve's October 3 visual review are below. The
manifest beside the panels records each recipe, worst pixel and calculation.
These are compact scale-three qualification trials, not failures of the
saved primary native comparison. Their measured exceedances remain recorded;
Steve accepts these specific images without changing the general limit.

| Case | Maximum levels | Pixels above two | Evidence |
|---|---:|---:|---|
| 228 | 2.338917 | 620 | [CPU/GPU/detail/difference](../../../codebase/output/performance/review/phase3-continuation/mask-review-rounded/mask-trial-228.png) |
| 249 | 2.088867 | 17 | [CPU/GPU/detail/difference](../../../codebase/output/performance/review/phase3-continuation/mask-review-rounded/mask-trial-249.png) |
| 421 | 2.123535 | 92 | [CPU/GPU/detail/difference](../../../codebase/output/performance/review/phase3-continuation/mask-review-rounded/mask-trial-421.png) |

The acceptance applies to these unchanged PNGs (SHA-256), in case order:
`c5f1ea5653c7e253b7a58750ba277fc58586fb1169043990aaa381b6e4e3c03a`,
`8c2845e993497ce15a8888dcfb08e489d7299edda6af974593bbdc5ebd290cd6`,
`89c47692bd33b23557e98a683127b5c39095897fceede7d735eac7ae0b26279f`.
New or changed recipes are not covered by this case-specific decision.

## Repeated performance measurements

Three fresh disposable Electron sessions per fixture, same scripted edit
sequence, actual release-to-presentation and current settled-scope callback.
These are application events, not physical scanout. The first continuation
table is after packing instrumentation and six-box work, before the binary
transport. No speed claim is based on the single earlier audit observation.

| Fixture / operation | Picture median ms | Settled scopes median ms |
|---|---:|---:|
| Primary stroke | 427.4 | 1,880.3 |
| Primary Feather .02 / .05 / .005 / .03 | 276.5 / 799.2 / 405.2 / 348.5 | 772.5 / 1,308.4 / 1,853.7 / 918.1 |
| Primary first 100% / subsequent 200% | 2,350.5 / 158.5 | 2,991.1 / 43.4 |
| Four-mask stroke | 107.5 | 464.8 |
| Four-mask Feather .02 / .05 / .005 / .03 | 92.6 / 84.1 / 108.7 / 83.9 | 453.1 / 441.8 / 472.0 / 447.5 |
| Four-mask first 100% / subsequent 200% | 406.1 / 165.3 | 819.3 / 40.6 |
| Fifty-local stroke, after refinement cache repair | 100.2 | 685.8 |
| Fifty-local Feather .02 / .05 / .005 / .03, after cache repair | 84.3 / 78.6 / 37.4 / 84.3 | 523.6 / 514.8 / 482.6 / 527.2 |
| Fifty-local first 100% / subsequent 200%, after cache repair | 410.7 / 174.5 | 861.4 / 48.8 |

The intermediate six-box implementation exposed a fifty-local cache fault:
different Feather values shared a mutable key. Three repeats then measured
359.4 / 346.2 / 294.5 / 359.6 ms for the four feathers. Three repeats with
immutable refinement keys reduced them to the values above. This corrects
that continuation regression; it does not establish every original target.

Packing-only A/B alternated formula and lookup order, discarded two warmups
and retained 15 observations per mode. At 1,600 × 1,067, median byte packing
fell from 25.6 to 4.0 ms; at 3,200 × 2,133, from 100.0 to 11.8 ms. All bytes
are identical. This isolates packing and excludes queue wait/classification.

Instrumented primary run 3 distinguishes warm GPU encode (0.3–0.5 ms at
512), GPU readback wait (4–10 ms), byte packing (0.8–1 ms), JSON/base64
transport packing (approximately 2 ms), classification round trip (5–6 ms)
and classification CPU (0.5–0.8 ms). At 3,200, readback wait ranges 20–170 ms,
packing is approximately 15 ms, transport packing 75–82 ms, round trip
78–129 ms and classification CPU 20–22 ms. Cold startup queue wait includes
approximately 1.96 s of first shader work and is not a stroke timing.

Binary classification transport now sends bounded R8 bytes with length-prefixed
UTF-8 metadata, retaining revision, geometry, dimensions, byte-count and
budget validation. It avoids the measured base64 packing and size inflation.
Repeated final timings are tracked separately below; backend classification
still does not prepare picture pixels or compile a mask.

The primary first native CPU batch alone measured 1,725.807 ms total and
1,713.279 ms mask compute, versus 145.7 ms source-region acquisition and
submillisecond ordinary grading. CPU overlay requests are also recorded
separately from renderer fallback. GPU scope routing does not imply that
scope settlement meets its latency target; it waits on current picture/mask
work and scheduled settlement.

## Coverage and test interpretation

The disposable authored fixture was generated from the read-only four-mask
photo using the actual Ultra HDR exporter with an explicitly authored SDR
grade (exposure −0.35, saturation 0.85). The actual decoder confirms a distinct
authored SDR base. It is a real encoded/decoded photo fixture, not a mocked
working-space flag. A common manual anchor excludes the deferred automatic
anchor discrepancy. The fixture and manifest are under `authored-fixture`.

Trusted 500 ms drags, three samples per row, now cover HDR and SDR luminance
reference/refinement rails, Denoise amount, and shared Straighten/Perspective
with Apply. Luma median first paint is approximately 8 ms; settled scopes
385.8–419.4 ms. Denoise first paint is 31.7/32.3 ms, with scopes approximately
298/306 ms. Straighten first paint is 866.5 ms; perspective is 949.4 ms and
scopes 8,559.3 ms. These geometry and scope misses remain open.

The earlier HDR drag sweep covers the global rail list, curves, exposure-band
value/position/smoothing, wheel pad, vignette centre, brush exposure/opacity/
feather and Fan. It stopped at the endpoint-bound luma harness issue. SDR
global rows and fresh-session/native-pan results are recorded below. The
partial HDR sweep alone is not a complete control exit.

Recorded Python inventory/Proof field-order failures and Node anchor identity
failure were stale contracts. Tests now reflect the current inventory/model
and selected original/resolved canonical denoise source, including version
invalidation. Assertions on shader pins and meaningful behavior remain.
The tiled admission fixture now creates actual planner scope pressure instead
of unpinned entries the allocator legitimately evicts; the test retains atomic
presentation and current CPU fallback requirements. A product fault where
auxiliary GPU refusal failed to schedule CPU scopes is repaired and verified.

Brush tests compare authoritative texels across differently sized overlay
canvases, restrict stale GET checks to after release, and sample an erased
point away from the cursor outline. Path tests refresh coordinates, test an
uncached final Feather and retain the delayed-work progress/debounce checks.
An exact cached path frame now clears a progress target whose signature was
updated after that response. Final Electron status is recorded below.

## Retained implementation measurements and completed validation

The original rounded brush shader is retained. `four-restored-perf-1..3`
are three fresh disposable sessions of that implementation. Compared with
the three `four-after` sessions before binary classification transport:

| Operation | Before picture median ms | Retained picture median ms (range) | Retained scope median ms |
|---|---:|---:|---:|
| Fit local curves/wheels | 16.9 | 27.8 (26.8–29.2) | 417.8 |
| Stroke | 107.5 | 70.2 (68.3–73.7) | 433.0 |
| Feather 0.02 | 92.6 | 57.4 (50.0–57.9) | 441.6 |
| Feather 0.05 | 84.1 | 50.8 (49.4–52.9) | 422.5 |
| Feather 0.005 | 108.7 | 75.1 (72.9–80.2) | 434.6 |
| Feather 0.03 | 83.9 | 47.5 (41.8–58.0) | 403.6 |
| First 100% | 406.1 | 389.9 (301.2–394.6) | 789.7 |
| 200% | 165.3 | 167.6 (158.1–169.3) | 47.7 |

Every row has zero CPU mask-tile requests and GPU settled scopes. Stroke
and Feather meet the 100 ms picture goal in these samples; first native
zoom still misses 300 ms and GPU scope routing does not meet settlement
goals. The discarded continuous trial's faster four-mask timings are not
used as the retained result.

Primary `primary-restored-perf-1..3` has picture medians 324.4 ms stroke,
215.8 / 234.1 / 296.4 / 120.2 ms Feather, 3,121.8 ms first native and
154.3 ms at 200%. Stroke samples are 258.0 / 1,313.0 / 324.4 ms; first
native samples 3,545.4 / 2,353.3 / 3,121.8 ms. Some observations include
an automatic-anchor replacement generation and some precede it. These
numbers document variability and misses, not an established primary speed
improvement. The performance driver now waits for pending/exact anchor
work and coordinator work to drain before measuring final settlement,
records the earlier current-picture settlement separately, and retains
first-feedback observations. This changes measurement, not anchor routing.

Three new sessions (`primary-complete-generation-1..3`) use that complete
measurement contract. Their medians and ranges are:

| Operation | Final picture median ms (range) | Settled scope median ms |
|---|---:|---:|
| Fit curves/wheels | 135.9 (22.5–137.7) | 507.0 |
| Stroke | 1,868.5 (1,267.9–1,895.9) | 2,402.0 |
| Feather 0.02 | 1,495.5 (1,449.6–1,524.7) | 1,880.6 |
| Feather 0.05 | 1,247.6 (1,225.5–1,252.2) | 1,793.3 |
| Feather 0.005 | 1,584.2 (1,547.2–1,598.3) | 2,058.7 |
| Feather 0.03 | 1,492.4 (1,356.3–1,584.0) | 1,952.9 |
| First 100% | 2,310.6 (2,246.3–2,399.4) | 2,663.8 |
| 200% | 161.0 (157.1–162.2) | 42.2 |

Every final observation confirms drained anchor work. These are more complete
latency measurements, not an A/B with the earlier incomplete settlement
contract. First native still has one CPU mask-tile batch per session; 200%
reuses it. Early picture feedback remains recorded separately in each row.
The deferred anchor algorithm is preserved; its replacement generation must
still be included when reporting eventual exact-picture latency.

At 3,200, binary metadata packing is below 1 ms; classification round trip
is approximately 32 ms, including approximately 20 ms CPU classification.
GPU readback wait remains variable (approximately 21–79 ms in the captured
examples). Unqualified primary stroke overlay CPU work remains approximately
940–999 ms: 389–402 ms source acquisition, 547–592 ms mask computation,
negligible lock/worker waits. Classification does not include that fallback.
Scope readback examples take approximately 11–25 ms including 8 ms unpack;
the much larger action-to-scope delay includes picture/mask/Peak prerequisites
and scheduled settlement. No deferred Peak/anchor algorithm was changed.

Live Fan drags now provide first feedback at medians 6.8 ms HDR / 6.9 ms SDR,
three trusted 500 ms drags per lane, maximum 7.0 ms. Before the fix the SDR
three-sample first-feedback median was 675.9 ms. Release-to-exact medians are
14.3 / 17.3 ms; settled scopes 397.0 / 348.6 ms. The previous SDR scope
median was 166.9 ms, so this is a feedback improvement with a scope tradeoff,
not a general settlement speedup. `fan-live-drags.json` contains all samples.

The SDR global/control sweep is complete in `sdr-control-drags.json`;
the remaining HDR/SDR luma rails, Denoise and geometry are in
`remaining-control-drags.json`. These complement the HDR partial sweep.
The SDR brush Feather first-feedback median remains 767.8 ms. Geometry
latencies listed above remain target misses, not waived checks.

Fresh sessions run more than 30 seconds of unique edits followed by 30 seconds
idle in each lane, with periodic native zoom and trusted navigation-thumb pan.
HDR completes 48 operations; SDR 45. Both have three cycles, eight current
settled checkpoints and zero page errors. Every native pan has three trusted
pointer events and zero CPU mask-tile requests. HDR pan samples are
1,212.4 / 362.3 / 471.1 ms; SDR 1,314.3 / 473.9 / 427.5 ms. Whole-image
scopes are unchanged by pan, so pan scope timing is not reported. Pan misses
300 ms, and the first pan exceeds the fresh-session 1,000 ms goal. This is
short fresh-session coverage, not a 30-minute endurance result. Match is
explicitly skipped in these edit runs under the accepted owner decision.

Full Python: **1,644 passed, three skipped** (155.11 s). Full Node:
**362 passed, zero failures**, including unchanged Peak/Denoise shader pins.
Serialized disposable Electron brush, path, admission and device-loss drivers
pass. The device-loss test now waits for actual accepted WebGPU presentation
after each new device, rather than assuming device initialization completes
recovery. It verifies two device replacements, current edits, forced-init-fail
CPU fallback and reload recovery, with zero page errors; product recovery
logic was not weakened. Admission verifies same-generation CPU scopes after
GPU proxy refusal. Brush/path retain meaningful placement, delayed-work and
release assertions after correcting stale coordinates and cached fixtures.

Saved primary, cropped primary graph and outer-path native HDR/SDR checks,
four-mask luminance HDR/SDR, and actual authored-SDR native checks pass picture,
mask and Peak in centre, upper-left and lower-right. All retain the approved
limits. Outer-path validation asserts that the mask actually takes the GPU
route. The current primary saved-state checks use rounded production brush
output; the continuous trial is separately labelled in its artifacts.

All raw artifacts and logs are under
`ai/codebase/output/performance/review/phase3-continuation` or adjacent
`phase3-continuation-*.log` files. Phase 3 remains open for native Shift Edge,
unqualified narrow brush masks, resampling geometry/graphs, and remaining
primary and first-native/scope/pan latency misses. The three visual trial
cases were subsequently accepted by Steve as specifically recorded above.
These are unfinished work, not additional owner-approved deferrals.

## Final saved-state and fixture integrity check

`primary-retained-native.json` completes on the retained rounded shader after
all product changes. Paired-pixel, picture/tone, mask and Peak verdicts are
all true in both lanes and all three regions; no mask exceeds two levels.
The largest saved-primary brush error is 1.481 levels. `projectUnchanged` is
true. Final `git diff --check` passes; the branch remains
`viewport-bounded-preview-phase-2-wip` and changes are uncommitted/unpushed.

The three original read-only fixtures were SHA-256 checked after the final
Electron/CPU comparisons, not only before testing:

| Fixture | Unchanged SHA-256 |
|---|---|
| Primary | `246ba308dcba22c5483c32ed4c31f5c81a2804504cd01dec2482b6d5be307d56` |
| Four-mask | `3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825` |
| Fifty-local | `00913f3d8214a211ff74d0791b5393dddf06c861e57994517354aa1a88e6acee` |

No original fixture was saved over. Authored-SDR construction and all runtime
edits use disposable output fixtures/sessions. Approved picture and mask
limits, shader pins, the editing Peak budget, exact CPU export/Proof, hard-edge
placement, larger-bitmap retries, cancellation/cache ownership/device recovery
and immediate discrete/80 ms continuous zoom scheduling remain in force.

## Integrated pass after owner visual acceptance

The primary fresh-work replay (`primary-integrated-fresh.json`) uses the
fixture's original automatic anchors, skips accepted Match, and completes
25 cycles / 400 operations in 307.759 s active plus 30 s idle. It includes
trusted HDR native-navigation pans, unique strokes/feathers and grade/radius
edits in both lanes. All checkpoints retain WebGPU. The final current
picture, scopes, anchors and background mask requests drain with zero page
or sampler errors. Registered cache use grows from about 57 MiB to 2,188
MiB, under the normal budget with zero evictions; unique edits create new
cache identities. This is not evidence of flat memory or a 30-minute run.
Pan delays remain: 25 values range 341.2–1,166.5 ms, mostly above 300 ms.

### Two genuine pressure faults and repairs

`fifty-integrated-pressure.json` reduces only the disposable GPU budget to
0.75 GiB. The original run times out at the first native zoom after 12
operations: a destroyed 3,188×2,164 R16Float texture is used in a submit.
GPU initialization remains available but the current viewer is unavailable;
CPU strip execution also refuses the graph. This is a product fault, not a
stale assertion or performance timeout that can be waived.

Mask/detail cache allocator eviction, local trimming, replacement and
session release now use the existing active-render/scope destruction queue.
Cache entries disappear immediately, but their textures remain usable by
encoders holding references until the active lifetimes end. The first fixed
replay completes six cycles / 90 operations, demonstrating recovery across
the previously failing native zoom. New tests cover overlapping renders,
active scopes, idle immediate destruction, replacement and local trimming.

That replay also reveals a second fault: local-mask residency reports
493,822,358 bytes while its allocator registers only 256,986,434. Luminance
refinement grows the cache value after initial registration. The allocator
now resizes existing registrations when refinement/scratch grows or releases
and when masks are retained, protecting the value being refined while
enforcing pressure on other cache entries. Actual allocation-ledger tests
check scratch growth/release and pressure eviction without self-eviction.

`fifty-integrated-pressure-accounted.json` repeats the same recipe after
both repairs: five cycles / 75 operations, 62.59 s active plus 30 s idle,
zero page/sampler errors, current ready picture, no pending scopes/anchors,
and zero registered budget debt. At idle, local-mask registry and residency
both report 174,071,126 bytes; all registered cache/working-set entries total
563,294,116 bytes, with 1,484 evictions. The selected budget applies to
registered cache/working-set allocations; this is not a claim that physical
GPU/process memory never exceeds 0.75 GiB. Full Node passes **366 tests**
after these changes, including the unchanged shader pins. Python remains
the previous **1,644 pass / three skips**; no backend change followed it.

### Shift Edge control coverage

`shift-fit-drags.json` and `shift-native-drags.json` add three trusted Shift
Edge slider drags per lane at Fit and 100%, respectively. Manual anchors
isolate the control; zoom preparation is outside the clock. Both complete
without page errors, and each observes current picture/scope settlement.

| Retained control result, median of three | HDR | SDR |
|---|---:|---:|
| Fit input to first frame | 705.7 ms | 687.4 ms |
| Fit release to exact | 54.4 ms | 55.3 ms |
| Fit release to scopes | 504.1 ms | 498.5 ms |
| Native input to first frame | 4,300.1 ms | 5,361.6 ms |
| Native release to exact | 3,624.6 ms | 4,719.9 ms |
| Native release to scopes | 4,005.4 ms | 5,090.0 ms |

The two uncached native CPU mask compiles in each lane take
3,256.228 / 4,915.513 ms HDR and 4,343.860 / 4,654.693 ms SDR; the other
sample reuses its native bitmap. An example 4,943 ms tile request reports
4,915.513 ms mask computation, 0.017 ms source, 0.003 ms lock wait and
0.202 ms worker queue. Native Shift is still rejected for soft stretching;
these are exact CPU mask costs, not GPU readback/classification or a claimed
speed improvement. The broad pass exposes this residual precisely rather
than silently marking native Shift complete.

The remaining surgical work is native Shift/brush normalization and narrow
mask admission, GPU mask resampling under straighten/perspective, and the
primary/native-zoom/scope/pan target misses. The accepted three images need
no further owner review unless changed. No other requirement is deferred.

### Final preservation after the cache repairs

`primary-cache-final-native.json` completes with zero page errors and
`projectUnchanged: true`. Its paired-pixel, picture/tone, mask and Peak
verdicts all pass both lanes and all three native regions. The largest saved
primary mask error remains about 1.48 levels; no soft mask exceeds two.
The final idle allocation-agreement assertion also passes when evaluated
against the accounted pressure artifact. The endurance driver now includes
that assertion for future runs. Both successful integrated active sequences
contain zero whole-picture CPU preview requests; local-mask overlay preview
requests are counted separately. This does not extend the claim to known
unsupported geometry/native Shift cases.

All three read-only fixture hashes were checked again after the last GPU/CPU
comparison and match the values in the integrity table above. Node syntax
checks and `git diff --check` pass. The branch and uncommitted/unpushed state
are preserved. No fixture was saved over and no phase 4 work was started.
