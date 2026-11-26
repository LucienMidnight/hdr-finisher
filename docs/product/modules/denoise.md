### November 26 - Reference corpus and calibration checks

Steve retired the lab's noise-free render reference and its render-only noise
case: a real render is not a noise-free reference. The lab keeps photographic
references with processed and RAW noise; it no longer stops for an absent EXR.
The calibration recomputation test allows 0.002% relative numerical rounding,
not a change to shipping constants or pixels. Explicit float32 scalar dots on
PC versus NumPy matmul move the seeded quantiles by up to 0.00114%; the Mac
reported about 6e-7 absolute. Browser/CPU constants remain pinned exactly.

### November 26 - Micro Grain response cleanup

Superseded, conflicting and failed Bayer responses cancel their unread bodies
before returning the existing error. This releases transport buffers and
connections without changing successful samples or the GPU pipeline.
Transport regression tests cover all three refusal paths, cancellation failure
and successful body reads.

# Module PRD: Denoise

**November 24, 2026 Clean Grain navigation and colour.** Intermediate zooms use native regions, and recent sharp regions stay available under the existing memory allowance. Separate per-rendition switches control colour splotches and edge fringes. Both default on. The splotch pass protects coherent colour boundaries. MacBook Neo real-app confirmation remains open.

The petal-edge comparison on `DSC09738.ARW` isolated the halo to the
splotch pass. Opposing samples could span the petal and background, and
the resulting correction changed the transition between them. The new
edge check reduces that correction. On Canon `IMG_0790.CR2`, the previous
and revised Small passes both cleared 11 of the 32 marked locations with
colour contrast above twice the surrounding grain. [PC timings](../../technical/performance-table.md#november-24-2026--clean-grain-zoom-and-fit-on-the-windows-pc)

The retired combined setting is ignored when a grade opens. The five
sidecars found with it were `_DSC7970.ARW.hdrf`, `DSC00786.ARW.hdrf`,
`DSC02059.ARW.hdrf`, `DSC09738.ARW.hdrf` and `Santorini2026_0068.CR3.hdrf`.
Only the saved HDR grade of `DSC09738.ARW` had the old switch off.

**November 21, 2026 working changes.** New lanes start with Clean Grain selected and Denoise off. Saved enabled grades with no method still use Simple. Micro Grain is experimental. Grade defaults to the GPU for the Grain methods. Micro Grain uses signed Bayer samples. Its export and full-size Proof use the CPU source stage.

**November 23, 2026 export speed.** CPU AVIF Gain Map export with Clean Grain is faster and shows real progress; Clean Grain itself was under 10% of that wait, so GPU Grain delivery stays deferred. [Export and Proof](export-and-proof.md#november-23--faster-cpu-clean-grain-avif-export-real-progress-quiet-trims)

## 1. Purpose and goals

Remove sensor noise without harming structure or sharpness. Clean up brightness grain, colour specks and broad shadow blotches while keeping real texture, small lights, edges and highlight detail. The result must hold up in SDR and HDR, including lifted shadows. Steve judges the photos at normal viewing size and at 100%. [November 16 quality trial](../../technical/briefs/denoise-v1-quality-trial-2026-11-16.md#1-goal-steve-november-16-2026)

On November 20 Steve asked for every method to feel like Standard on the GPU: smooth, fast and responsive while dragging sliders. He finds other apps, including DxO, cleaner and faster. GPU processing is the likely route. The aligned Canon quality comparison confirms that DxO Standard leaves finer grain. A matched speed comparison is still open. [DxO comparison](../../technical/research/denoise-v1-2026-11-16/dxo-comparison.md) · [GPU design study](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md)

## 2. Current behaviour

Denoise works on developed camera RAWs, HDR files and renders. It measures noise from the open source and uses that measurement to treat flat areas more strongly than textured areas. In the rendering pipeline it runs before exposure, colour, Detail, Black & White, Film Look and local grades. Film Look Grain is added later. JPEG Ultra HDR can also clean up its generated gain map as part of encoding. [Denoise guide](../../user-guide/denoise.md) · [Processing order](../../technical/image-processing-pipeline.md)

### Methods and controls

| Control | Default | What it does |
| --- | --- | --- |
| Denoise switch | Off in HDR and SDR | Off shows the original source through the current grade without rebuilding Denoise. On reuses compatible preparation. The previous picture stays visible until the selected result is ready. |
| Method | Clean Grain | Evens out brightness grain and reduces colour splotches. Simple uses the original adaptive wavelet method (`adaptive-atrous-v1`). Micro Grain · Experimental is also available for supported Bayer RAWs. |
| Amount | 75% | Overall cleaning. At 50% it uses the measured amount. At 0% it leaves the input alone. |
| Detail Recovery | 50% | Returns fine detail that would otherwise be removed with noise. |
| Luminance | 50% | Brightness noise removal. Sits directly under Amount, which scales it and Color Noise by the same factor (Steve, November 25). |
| Color Noise | 75% | Colour noise removal at every size, before splotch cleanup. Shown in the main panel (not Advanced) since November 25, because it is the strongest control for colour blotches. |
| Finest · 1–2 px | 50% | Pixel speckle. |
| Fine · 2–4 px | 50% | Small grain. |
| Medium · ~8 px | 50% | Soft blotches. |
| Coarse · 16–32 px | 50% | Broad cloudy patches. Each size slider uses the measured amount at 50% and leaves that band alone at 0%. |
| Grain Evenness | 100% | Evens out retained brightness grain using the fitted 18-pixel setting. With colour cleaning off, 0% follows Simple. |
| Clean edge fringes | On | Toggles the narrow bright-edge fringe correction for this rendition. |
| Protect color edges | Off (Steve, November 25) | Keeps splotch cleanup from blending the two colours of a sharp colour boundary that continues at least 15 pixels each way. Other hues on the edge and splotches in flat areas are still cleaned (November 25 retune; the first version protected splotch rims across flat backgrounds). Off restores the November 24 pre-tuning splotch cleanup. Unavailable while Color Splotches is 0%. Temporary tuning switch (November 25). |
| Color Splotches | 100% | Pulls outlying colour toward nearby colour while protecting coherent colour edges and preserving scene luminance. Blends live once prepared. At 0% splotch cleanup has no effect; this replaced the Clean color splotches checkbox on November 25. Older grades saved with that checkbox off show 0%, and raising the slider prepares the splotch pass again. |
| Splotch Size | Small | Clean Grain. Small has a 12-pixel reach. Large adds a 28-pixel pass. Changing reach can require new preparation. |
| Micro Grain: Luminance, Color, Detail | 50% each | Sets brightness cleaning, colour cleaning and texture protection in the round 3 recipe. These replace the common controls for this method. |
| Advanced | Collapsed initially | Reveals the four noise sizes. |
| Show noise | Off | Displays what Denoise removed. Scopes keep the normal picture and update when the noise view closes. |
| Recalculate Denoise | On request | Refreshes the measurement and preparation. The last good picture stays visible while work runs. A failed attempt offers a retry. |
| Reset and Default preset | Clean Grain and the values above | Restore the starting settings. Saved grades and presets carry the method and controls. |

Simple and Clean Grain share the eight common sliders. Simple resolves them live. Clean Grain adds the brightness-grain fit and optional colour protection for bright edges and colour boundaries, plus a narrow fringe pass. Micro Grain has three live sliders and works on eligible Bayer RAWs. The status line shows Off, Preparing, Ready, Dirty, Recalculating or Error. A view change can mark the measurement Dirty while the last good result stays visible. The sliders and Splotch Size stay editable while Denoise prepares and after a failure. Rapid committed edits prepare the latest settings together. Leaving Grade or changing the source discards obsolete work and clears its busy status. [Denoise guide](../../user-guide/denoise.md) · [Technical contract](../../technical/denoising.md#november-19-2026-experimental-grain-methods) · [Grade controls](../../../codebase/frontend/denoise-ui.js)

### HDR, SDR and rendering routes

HDR and generated SDR share four methods and preparation code. Each rendition saves its own settings. Match entire HDR grade copies the HDR settings into SDR. Linked SDR follows HDR. An independent SDR grade can change its copy. Grade shares Grain preparation when the source pixels and preparation settings match. Authored SDR uses its own source and preparation, and cannot use Micro Grain. [Grade decisions](grade.md#3-decisions) · [November 20 Mac checks](../../technical/briefs/denoise-mac-open-items-2026-11-20.md#3-shared-hdr-and-sdr-denoise-methods--done)

| Where | Work done |
| --- | --- |
| Grade, Standard | WebGPU measures bounded windows when available. Large frames use up to sixteen 256 × 256 windows, with a small fit on the host. CPU measurement is the fallback. The model is reused while sliders move. At Fit it draws the reduced picture. At native zoom it filters the padded visible region, then fills sharp tiles as you pan. The whole-photo underlayer stays visible. |
| Grade, GPU Clean Grain | On by default when Clean Grain is selected and Denoise is active. Measures a whole-photo brightness fit in strips and applies Small or Large colour correction with the checkbox on. Fit downsamples the base picture and signed colour correction independently. The viewer blends the retained correction live as Color Splotches changes. At native zoom, Splotch Size computes the visible tiles with the selected reach and keeps the previous picture until they are ready. A horizontal pan can reuse overlapping source pixels. At Fit a quick view can appear while the exact native-strip result finishes. Denoise off, bypass and Show original skip GPU Grain. |
| Grade, GPU Micro Grain | Reconstructs visible native tiles from corrected Bayer samples using signed WebGPU AHD, then applies the round 3 late filter. Slider moves reuse bounded Bayer measurements from a weighted noise fit that includes deep shadows. At Fit a reduced scene-wavelet preview precedes the exact result. Neighbouring native tiles share Bayer preparation and demosaic, and preparing the next band overlaps the GPU work. GPU failure selects the CPU route. |
| Delivery, CPU Micro Grain | Export and full-size Proof use the same bounded round 3 source before grade and finishing. |
| Grade, CPU Grain | The CPU returns a preparation token after the fit and scratch reservation. The first sharp native draw queues the visible tiles together. Once the picture is sharp, pan requests use the usual padding. Overlapping requests share work already in flight, and other tiles fill at lower priority on the same CPU pool. Fit can show a quick wavelet preview while its exact read waits for and reduces native tiles. The cache reserves 16 bytes per pixel up front. The temporary file grows one contiguous tile at a time. A matching Fine-to-Clean switch reuses the fit and neighbouring RGB before adding colour correction. |
| Grade fallback | A permanent GPU failure gets one attempt, then a CPU denoised picture. A Full request that needs the bounded whole-preview fallback can be reduced to the existing 4096-pixel edge and is labelled reduced. Show noise uses the GPU. |
| Library | A saved developed grade can supply its Denoise settings and cached noise model. Quick GPU draws can read Grain corrections and hold them through presentation. Small Micro Grain pictures use reduced scene-wavelet Denoise on GPU and CPU rather than reading native Bayer strips. Expiry on a current draw falls back to the CPU once. Cancelled draws stop. HDR draws use the saved highlight target. The small-picture colour mismatch is open. |
| Export and Proof | Both use the saved rendition settings, including an authored SDR base. Native export and full-size Proof process the full delivery image. Standard keeps its shared GPU route, with CPU fallback. Clean Grain normally uses CPU delivery. Supported SDR JPEG jobs with Large colour cleaning can stream from the GPU, and opt-in trials cover other eligible jobs. GPU Proof and export share the reconstruction and avoid temporary CPU Grain preparation files. It sends finished pixels in bands, but some finishing and encoder inputs still need full-size images. Eligible JPEG Ultra HDR CPU jobs render in strips with file-backed output. Reduced Proof has its own size and source identity. Full-size Proof follows the same delivery settings, including watermark, and is checked for byte identity with export on the same route. |

CPU filtering uses the app's worker pool. Standard and the experimental filters share ordered float32 native filters with a NumPy fallback. The GPU queue serializes measurement per device. Downstream Grade edits can reuse prepared Denoise pixels. Keep the picture in place through zoom, pan and preparation changes. [Technical contract](../../technical/denoising.md) · [CPU worker policy](../../../codebase/backend/hdr_finisher/cpu_budget.py) · [Export and Proof](export-and-proof.md) · [November 20 audit](../../technical/briefs/denoise-mac-open-items-2026-11-20.md#5-overnight-bug-fix-report--november-20-2026)

### November 21: Grade Grain fallback and retry

Grade records the Grain GPU decision, refusal, retry and final route with
the same action ID as any CPU Grain preparation it starts. Temporary GPU
memory, transport and device failures can get one retry after recovery.
Temporary source keys expire after 30 seconds. Size, shader validation and
unsupported inputs stay recorded for that source key. The existing CPU
correction and GPU draw paths still render the same pixels.
[Diagnostic log and reason codes](../../technical/logging.md)

An unclassified Grain GPU failure can retry once after the renderer acquires
a replacement GPU device. The failure stays recorded on the original device.

Normal GPU Grain work adds no route message. The Denoise status line explains
CPU preparation, reduced preview size or an unavailable method when those
conditions apply. It reports CPU preparation even when the GPU draws the
picture. It shows progress when CPU work takes more than two seconds.
**Retry on GPU** uses the one-retry policy for eligible temporary failures.
Micro Grain on the CPU offers **Switch to Clean Grain** when a GPU retry is
unavailable.

### November 21: CPU Micro Grain reuse in Grade

Grade reuses the same reduced Micro Grain pixels across Exposure and other
downstream edits and views that use the same preview size. A replacement
request can join work already running for that photo, Micro controls, lens
state and preview size. Changing the controls or size computes a new result
using the prepared Bayer sensor and noise model. Both are evictable under
the existing Grade cache allowance and are released on source change or
Grade close. The reduced CPU preview is labelled with its processing size
in the status bar.

### November 24: Grade Histogram on the CPU Micro Grain route

After the current picture arrives, the Histogram reuses a cached whole-picture
Micro Grain preview with matching source, lens settings and Denoise controls.
It applies the current grade for the visible rendition. If the matching source
is missing, the Histogram clears, shows Unavailable and suggests Fit view.
It does not measure just the visible patch, use undenoised pixels or start its
own Micro Grain rebuild. [Sony timings](../../technical/performance-table.md#november-24-2026--grade-micro-grain-histogram-at-zoom)

### November 21: CPU Micro Grain tile workers

The first CPU Grade picture, export and full-size Proof use the same
native tiles and filtering. Independent tiles and noise-measurement windows
use the shared CPU pool. At most three full tile workspaces fit in the
existing 600 MB allowance. OpenCV runs one thread inside each worker. The
prepared model remains in the Micro source for this round. Full-frame CPU
lens correction produces coordinates in strips using Lensfun's original
whole-frame row positions. Mac and Windows tests matched the original
corrected and finished bytes. The Windows development app and packaged
backend both used the native Lensfun library.
[Windows Lensfun confirmation](../../technical/performance-table.md#november-22-2026--windows-pc-native-lensfun)
· [Windows PC measurements](../../technical/performance-table.md#november-21--cpu-micro-grain-tile-workers)
· [Mac lens measurements](../../technical/performance-table.md#november-21--byte-exact-lensfun-strips-on-macbook-neo)

### November 21: CPU Micro Grain visible area first

At 100% or above, Grade can prepare just the native Bayer tiles needed for
a visible CPU Micro Grain picture. Crop, quarter turns and flips map directly
to indexed pixels. Lens correction checks all remap samples and channels on
the viewport, including the edges, with eight output pixels of scroll padding
and a two-pixel margin beyond the bilinear input footprint. Native tile
dimensions and filter halos are the same as for the full photo.

The viewer keeps a reduced original behind the native detail while panning
and when returning to Fit. A lower-priority worker develops one offscreen tile at a
time when app memory pressure allows it. Settled Fit consumes the retained
tiles as it builds the whole frame and prepares any missing ones on demand.
Grade operations that need full-frame statistics or spatial reconstruction,
resampled geometry and extreme or non-finite lens maps fall back to the
whole-photo route. HDR displays use the same AVIF preview encoder as the
whole-photo CPU route. [Windows PC measurements](../../technical/performance-table.md#november-21--windows-pc-cpu-micro-grain-visible-area)

### November 21: Faster CPU Grain backup

CPU previews reuse a compact noise model across Exposure and other finishing edits. The model depends on the source pixels, rendition, geometry, processing size and measurement version. Concurrent previews share a measurement. The CPU Grain scratch reservation and the existing tile dimensions still apply. [Windows PC measurements](../../technical/performance-table.md#november-21--windows-pc-cpu-grain-sprint)

Native CPU Grain limits simultaneous wavelet and colour workspaces across Grade and Library. Visible tiles still enter the pool before queued background tiles. On the Windows PC, five workspaces brought peak app memory down from 2.74 GB to 2.33 GB, below the 2.39 GB baseline. The Sony reached its first sharp picture at 110% in 4.25 s against the 5.49 s target. The 30% whole-photo speed target remains open. [Windows PC measurements](../../technical/performance-table.md#november-21--windows-pc-cpu-grain-sprint)

Clean Grain now runs the colour arithmetic in native C and keeps the
OpenCV neighbourhood filters and magnitude operations. Backend noise model
storage and in-flight measurements live in one module, with each route's
source identity preserved. The CPU uses the same fixed white-noise
calibration values as the browser. The Windows tile comparison matched
prepared bytes for both splotch sizes on Canon and Sony. The Mac build and
checks are pending. [Windows PC CG-2 measurement](../../technical/performance-table.md#november-21--windows-pc-native-clean-grain-colour)

### November 21 — Grade Grain on large photos

Fine and Clean Grain calibrate at native resolution in rectangles with the
existing overlaps. The GPU sums only the non-overlapping core pixels, keeping
the same block and tile order as the whole-width calibration. Grade's exact
Fit picture reconstructs bounded native rectangles and resizes with the
original full-frame sampling grid. Micro Grain retains its Bayer region
requirements and uses smaller Fit bands when two cores cannot share a Bayer
request. At 110%, Grade draws the native viewport and its reconstruction halos.

Windows PC with a 2 GiB graphics setting, the 50 MP Sony and a synthetic
61 MP linear TIFF each presented Fine and Clean Grain Small on the GPU at
Fit and 110%. The merged Clean Small route passed again on the Sony and
logged correlated reservations. Bayer Micro Grain also stayed on the GPU on
that Sony at 110%.

The integration check found a wrong tile in generated SDR at 110% while
Grain was prepared on the CPU. Background peak measurements could overwrite
the drawing settings for a visible tile. Peak measurements now keep their own
GPU settings. Both the 50 MP and 42 MP Sony photos passed finished HDR and SDR
agreement at Fit and 110% for Fine and Clean Grain Small. Micro Grain drew on
the GPU at Fit on the 50 MP photo.
The 61 MP TIFF still needs finished parity and the minimum Mac needs
validation. [Large-photo measurements](../../technical/performance-table.md#november-21--large-photo-grain-in-grade)

### November 21 — GPU Grain Fit scheduling

Grade can start preparing the next native Fit rectangle while the previous
one reduces on the GPU. It queues at most two reduction rectangles and
waits for them before releasing their shared textures. Micro Grain batches
the cores from a single developed Bayer band. The GPU still uses the same
tile boundaries, source halos and resize arithmetic. The minimum Mac still
needs timing and whole-app memory checks. [Windows PC timings and parity trial](../../technical/performance-table.md#november-21--windows-pc-gpu-grain-fit-scheduling-trial)

### RAW Pixel cleanup

Pixel cleanup belongs to the RAW source recipe, so changing it redevelops the source for Library, Grade, export and Proof. It runs before Bayer demosaicing and highlight reconstruction. **Remove hot pixels** is off by default and has no strength control. It targets isolated bright sensor readings. **Even out harsh specks (Experimental)** is also off by default. Its **Threshold** runs from ×2 to ×4, starts at **×2.5**, and applies on release. Lower values generally act more strongly. Both require eligible Bayer data. X-Trans, linear DNG and non-RAW inputs are ineligible.

With both enabled, hot-pixel removal runs first, followed by the signed clamp for unusually bright or dark readings. The hot-only GPU RAW route remains available. Both use the same weighted Bayer noise estimate as Micro Grain. The fit keeps deep-shadow blocks with measurable variation, and below-black averages contribute to the read-noise estimate at zero shot signal. Missing sensor noise estimates leave the source untouched. The November 19 protection keeps small lights where red, green and blue agree, including the atrium railing light. Fine stars and thin lettering can still soften. The user's guide recommends trying ×2.5 before Fine or Clean Grain on noisy RAWs. All three methods receive the resulting developed pixels. [Import and RAW](import-and-raw.md) · [Denoise guide](../../user-guide/denoise.md#choose-a-method)

## 3. Steve's decisions

| Date | Decision | Source |
| --- | --- | --- |
| 2026-11-16 | Try a better Denoise for v1. Choose by visible noise removal, sharpness and structure. Steve approves any shipping replacement after seeing it. | [Quality trial](../../technical/briefs/denoise-v1-quality-trial-2026-11-16.md#1-goal-steve-november-16-2026) |
| 2026-11-17 | D1. Start at Amount and Color Noise 75%, Detail Recovery, Luminance and every size 50%. Leave Denoise off by default. Saved grades keep their set values. | [Grade D1](grade.md#november-17-2026-denoise-shipping-defaults-steves-decision-d1) · [076b1501](https://github.com/LucienMidnight/hdr-finisher/commit/076b1501) |
| 2026-11-17 | Replace D2 after the blind review. Keep retuned Standard and try a separate classical method for leftover specks and blotches. Any standalone RawNIND Bayer option must be chosen by the user in Denoise and work with highlight reconstruction. Defer it beyond v1 if required. | [Quality-trial decisions](../../technical/briefs/denoise-v1-quality-trial-2026-11-16.md#7-open-questions-for-steve-collected-asked-together) · [AI design revisions](../../technical/research/denoise-v1-2026-11-16/ai-experimental-design.md#0-steves-revisions-november-17-2026-override-the-sections-below) |
| 2026-11-17 | Exclude featureless clipped brightness bins and quiet blocks together when measuring noise. Fall back to the previous estimator if too little evidence remains. | [Grade measurement decision](grade.md#november-17-2026-informative-denoise-measurement-steves-decision) · [e3e72205](https://github.com/LucienMidnight/hdr-finisher/commit/e3e72205) |
| 2026-11-17 | Preserve below-black Bayer readings through development and editing so the user decides where to crush shadows. Add Remove hot pixels and optional Even out harsh specks. Both start off. | [Import and RAW](import-and-raw.md) · [Hot-pixel decision](https://github.com/LucienMidnight/hdr-finisher/commit/a3adf819) · [Harsh-speck build](https://github.com/LucienMidnight/hdr-finisher/commit/bb8c9b1e) |
| 2026-11-19 | Add Fine Grain and Clean Grain as experimental choices beside Standard. Allow whole-photo setup with visible status. After the app trial, default to Small, protect bright edges and remove Dark Specks after its detail and spot checks fell short. AI waits for v2. | [Experimental modes brief](../../technical/archive/briefs/denoise-experimental-grain-modes-2026-11-19.md) · [Clean Grain follow-up](../../technical/briefs/denoise-clean-grain-fixes-2026-11-19.md) · [Grade follow-up](grade.md#november-19-2026-clean-grain-app-test-follow-up) |
| 2026-11-19 | Fix the railing-light colour shift first, retain the two-similar-neighbours rule, then capture the reference. Approve bounded zoom/delivery, Fine-to-Clean reuse and a GPU preparation estimate before a port. | [Railing-light brief](../../technical/archive/briefs/denoise-harsh-specks-baseline-speed-2026-11-19.md) · [Speed brief](../../technical/briefs/denoise-speed-memory-gpu-prep-2026-11-19.md) |
| 2026-11-20 | Share methods and preparation between HDR and SDR for now. Reuse identical prepared pixels but keep the saved settings per rendition. | [Grade decisions](grade.md#3-decisions) · [User guide](../../user-guide/denoise.md#hdr-and-sdr) · [Mac report, commit `50945dfa`](../../technical/briefs/denoise-mac-open-items-2026-11-20.md#commits-and-checks) |
| 2026-11-20 | Move the current Grain methods to the graphics card. Enable Fine Grain in Grade. Enable Clean Grain there only after its colour, HDR ceiling, memory, speed and fallback checks pass. Export and Proof follow in the next phase. | Steve’s November 20 decision · [GPU study](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md) |
| 2026-11-20 | Targets for pre-demosaic Denoise research, after comparing DxO PhotoLab on the Canon fire-dancer. **Grain size:** aim for DxO Standard's fine grain (about 3 px). **Colour rendition:** keep ours. Clean Grain's skin tones are the best by far; DxO pushed skin towards an unnatural red, and Denoise must not shift hue or saturation. **Colour smoothing:** at least as smooth as Clean Grain. **Detail:** keep more than DxO Standard's default, which gives up too much; do not use DxO's detail retention as the target. **Tone:** no automatic shadow darkening or strong default curve. DxO darkened the shadows a lot even with corrections off; in HDR Finisher, users set tone themselves, so Denoise must keep shadow brightness. | Steve, November 20 · [DxO comparison](../../technical/research/denoise-v1-2026-11-16/dxo-comparison.md) |
| 2026-11-20 | Put round 3 pre-demosaic Denoise (`balance-0.7-L0.2-C0.7`) into the app as a fourth experimental method beside Standard, Fine Grain and Clean Grain, with **Luminance, Color and Detail** sliders. Keep Fine Grain for now so all four can be compared in the app; keep Clean Grain as an option because its larger, softer grain can suit some photos. **Reject round 4's approach:** cleaning flat areas much harder than edges left the edges noisy and mottled, and the very clean flat areas made them stand out more. Don't separate flat and edge strength strongly. After this method is in the app, pause pre-demosaic research. | Steve, November 20 · [Round 3](../../technical/research/denoise-v1-2026-11-16/predemosaic-round3.md) · [Round 4](../../technical/research/denoise-v1-2026-11-16/predemosaic-round4.md) |
| 2026-11-20 | Build Micro Grain on the graphics card in Grade now, even though each slider update takes about 0.25–0.3 s at native zoom, about twice Clean Grain's wait. Keep the previous picture visible while updates arrive. At Fit, show a quick approximate picture first, then the exact one. Speed up the later passes afterwards. Sliders that only apply on release are not wanted. | Steve, November 20 · [Feasibility](../../technical/briefs/denoise-micro-grain-app-2026-11-20.md) |
| 2026-11-22 | Adopt the weighted Bayer noise fit for RAW Pixel cleanup and Micro Grain after reviewing the QUAL-1 crops. | Steve, November 22 · [R2-4](../../technical/briefs/sprint-denoise-gpu-logging-2026-11-21.md#round-2-decisions-for-steve) |

## 4. Quality and performance requirements

- **Finished images.** Compare HDR with ΔE ITP and SDR with ΔE 2000. Denoise parity requires mean <1 and p99 <3. Delivery also requires p99.9 ≤3 where the delivery driver applies that gate. The same perceptual limits apply when comparing different CPU/GPU routes. Scene comparisons for the experimental methods use absolute tolerance 0.000002 and relative tolerance 0.00001. [Denoising contract](../../technical/denoising.md) · [Delivery requirements](export-and-proof.md) · [Mac qualification](../../technical/briefs/denoise-mac-open-items-2026-11-20.md)
- **HDR range.** Keep signed finite scene values and values above reference white through Denoise. The finished HDR image must stay at or below its saved highlight target before encoding, with zero allowance. Encoded rounding allows up to 1% over the target. For a 1000-nit target, these are 1000 and 1010 nits. The November 20 all-codec check measured a decoded high of 1009.61 nits. [Highlight compression](../../technical/highlight-compression.md) · [Mac qualification](../../technical/briefs/denoise-mac-open-items-2026-11-20.md)
- **Candidate quality.** The trial proposes at least 90% of clean-edge sharpness, 85–115% of clean texture energy per band, and flat-patch brightness and colour noise at or below 50% and 30% of the noisy input. Check seams, halos, colour bleed, invented detail and exposure consistency from −6 to +6 EV. These are research targets. The proposed sharpness exception at ISO 25600 is unconfirmed. [Quality-trial contract](../../technical/briefs/denoise-v1-quality-trial-2026-11-16.md#3-quality-contract-proposed-tolerances-phase-1)
- **Clean Grain detail trial.** Compare the 3–20 px rings around 20 bright lights per photo, and the marked detail areas, against Fine Grain. The trial uses SDR ΔE 2000 mean <1 and p95 <3. At default Small, aim for 20/28 Canon and 22/24 Sony colour marks at grain level. [Clean Grain follow-up brief](../../technical/briefs/denoise-clean-grain-fixes-2026-11-19.md)
- **Memory.** Use the 8 GB MacBook Neo as the minimum. The Mac acceptance ceiling for these runs is **4 GB whole-app** (4,000,000,000 bytes), including Electron, GPU-process host memory, Python and helpers. The separate system headroom check also applies. The app-wide memory policy permits a brief elastic peak up to 4.4 GB and calls for settling below 3.4 GB at the default. The November 19–20 Denoise checks use the stricter 4 GB gate. On Windows the app uses a 6 GB private-commit limit on the 16 GB minimum specification. Grain scratch shares the existing 10 GB full-size disk allowance. The 42 MP Sony uses about 678 MB on disk per native preparation. [Windows memory policy](memory-and-caches.md#november-22-windows-private-commit-and-6-gb-default) · [Older quality trial](../../technical/briefs/denoise-v1-quality-trial-2026-11-16.md) · [November 20 Mac checks](../../technical/briefs/denoise-mac-open-items-2026-11-20.md)
- **Speed.** Measure from the action to the settled picture. Record first enable, warm zoom and pan, slider response and release, Recalculate, export and Proof separately. Compare before and after on the same machine within the existing 5% timing band for the Grain measurements. A new GPU route should roughly halve the wait it targets. Existing GPU paths keep a CPU fallback. [Repository rules](../../../AGENTS.md) · [GPU study](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md)

### Measured waits

All rows are from the 8 GB MacBook Neo. The November 20 app figures are individual observations on already developed photos. The performance table owns the full history and run conditions.

| Date and action | Canon IMG_0790.CR2 | Sony _DSC7970.ARW |
| --- | ---: | ---: |
| Nov 20 · Micro Grain slider at 110% / quick Fit / exact Fit | 1.26 / 0.08 / 6.07 s | 1.24 / 0.10 / 16.00 s |
| Nov 20 · 110% to exact picture, Standard / Fine / switch Fine to Clean | 0.61 / 4.42 / 3.92 s | 0.68 / 9.65 / 7.12 s |
| Nov 20 · Fine Grain CPU fit, prep and disk writes, paired medians before → after | 5.53 → 2.33 s | 15.24 → 5.42 s |
| Nov 20 · SDR Fit, Off / Standard / Fine / switch Fine to Clean | 0.06 / 0.25 / 13.04 / 5.22 s | Unconfirmed |
| Nov 20 · Switch to generated SDR after HDR Recalculate, with matching Fine Grain | 13.34 → 0.33 s | Unconfirmed |
| Nov 19 · Warm Fit → 100%, Standard / Fine / Clean | 0.40 / 0.68 / 0.60 s | 0.42 / 0.63 / 0.56 s |
| Nov 19 · Native JPEG Ultra HDR export at quality 90, Standard / Fine / Clean | 12.57 / 27.76 / 34.10 s | 38.67 / 45.56 / 52.84 s |
| Nov 19 · Reduced Proof at 1200 px, Standard / Fine / Clean | 2.72 / 3.10 / 2.89 s | 2.60 / 4.67 / 3.48 s |
| Nov 19 · Standard full-size Proof | Unconfirmed | 119.12 s at 13.50 GB |

The November 20 A/B preparation savings imply a whole-wait estimate of **8.32 s Canon / 15.87 s Sony** at 110% when subtracted from the November 19 app baseline. The separate 4.42 / 9.65 s observations have no paired app baseline. Some earlier Sony delivery peaks followed the full-size Proof spike. The matched fresh-profile CPU Proofs now peak at 2.11–3.53 GB. [Performance table](../../technical/performance-table.md) · [GPU study baselines](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md#recommendation-for-steve)

### Test coverage

Use the locked [release driver inventory](../../../codebase/tests/release/drivers.json) and the [repository test rules](../../../AGENTS.md#how-much-to-test). Key checks cover model measurement and reconstruction, real Grade drags and viewport coverage, Library reuse, RAW cleanup, CPU/GPU delivery, Proof identity and the HDR ceiling. The November 20 report records which ran, including 36 synthetic measurement comparisons and real Denoise delivery with authored SDR. The blocked corpus and protected-project checks are below. The [document map](#8-document-map) links the drivers by task. [November 20 tests and limits](../../technical/briefs/denoise-mac-open-items-2026-11-20.md#tests-and-limits)

## 5. Methods tried

Round 3 is implemented as **Micro Grain · Experimental**. The round 4 flat-area-only treatment is not included. [App design and evidence](../../technical/briefs/denoise-micro-grain-app-2026-11-20.md)

| Date | What was tried | Result and disposition |
| --- | --- | --- |
| 2026-08-25 | First interactive prototype, then an isolated Haar wavelet cache | The first integration caused lag even at 1K and unstable zoom and was rolled back. The next build separated preparation from slider changes. It gained aligned tiles in September and was removed from the app on October 6 after adaptive Denoise took over. [Technical history](../../technical/denoising.md) · [September tile evidence](../../technical/archive/phase-6-tiled-denoise-evidence-2026-09-20.md) · [4fb9fbd3](https://github.com/LucienMidnight/hdr-finisher/commit/4fb9fbd3) |
| 2026-09-26 to 10-26 | Adaptive wavelets, viewport work and GPU noise measurement | Kept the measured noise model and live size controls. The October review found native outliers and intermediate-zoom problems. Forcing native at every zoom was slower and left outliers. Kept stepped source sizes and bounded native work. GPU measurement later replaced the large CPU step on the common path. [Adaptive build](https://github.com/LucienMidnight/hdr-finisher/commit/0dff45b1) · [Review](../../technical/denoise-accuracy-review-plan-2026-10-04.md) · [Follow-ups](../../technical/denoise-followups-2026-10-04.md) · [GPU measurement](../../technical/denoising.md#october-26-2026-gpu-noise-measurement) |
| 2026-11-16 | Candidate survey, fixed harness and public noisy/clean pairs | Shortlisted RawNIND linear/Bayer, darktable wavelets and GALOSH. Public evidence covered 52 crops from 11 scenes, with four held-out scenes after screening. Kept the harness and pairs for comparisons. Camera fits from single noisy frames are provisional. [Survey](../../technical/research/denoise-v1-2026-11-16/candidates.md) · [Harness](../../technical/research/denoise-v1-2026-11-16/harness-baseline.md) · [Public pairs](../../technical/research/denoise-v1-2026-11-16/public-pairs.md) |
| 2026-11-16 | Standalone RawNIND linear RGB and Bayer AI | Stronger high-ISO cleanup. Linear RGB failed low-ISO fidelity, edges and HDR/exposure screens. Bayer with upstream-style clipping and an AHD gain reference improved high ISO but still altered clean fabric/text, colour and fine structure. Kept Bayer as a research reference. [RawNIND prototypes](../../technical/research/denoise-v1-2026-11-16/rawnind-prototype.md) |
| 2026-11-16 | Tuned Standard, darktable profiled wavelets, GALOSH RAW, and self/neural-pilot Wiener | Darktable softened detail. GALOSH left structured shadow artefacts. Self-pilot Wiener barely improved on tuned Standard. Bayer-guided Wiener led held-out pairs, but no hybrid passed the full contract and Steve preferred tuned Standard or standalone AI in the blind review. Kept tuned defaults as D1. [Classical trials](../../technical/research/denoise-v1-2026-11-16/classical-prototypes.md) · [Wiener trial](../../technical/research/denoise-v1-2026-11-16/pilot-wiener.md) · [D1/D2](../../technical/briefs/denoise-v1-quality-trial-2026-11-16.md#7-open-questions-for-steve-collected-asked-together) |
| 2026-11-17 | RawNIND Bayer with Opposed/Edge highlights | Blending protected reconstructed highlights left visible grain changes at joins. Other routes changed the flame or lost necessary highlight repair. Standalone AI remains deferred to v2. [AI design](../../technical/research/denoise-v1-2026-11-16/ai-experimental-design.md) · [Highlight trials](../../technical/research/denoise-v1-2026-11-16/ai-highlights.md) |
| 2026-11-17 | Residual speck filters, robust fit and informative blocks | Median and guided colour filters gave modest improvements and lost fine text. A solver change alone left ringed specks. The informative block and brightness-bin repair restored useful calibration next to clipped lights and was kept. The Canon pits remain. [Residual cleanup](../../technical/research/denoise-v1-2026-11-16/speck-cleanup.md) · [Noise-model diagnosis](../../technical/research/denoise-v1-2026-11-16/noise-model-and-raw-specks.md) · [Dark-noise trial](../../technical/research/denoise-v1-2026-11-16/dark-noise-strength.md) |
| 2026-11-17 | Signed AHD, directional demosaic, Bayer-plane smoothing and faithful RawTherapee LMMSE | Signed AHD reduced artificial shadow bias and was kept. Alternative demosaics and smoothing failed to remove the Canon pits reliably. Faithful LMMSE also took about twice as long as signed AHD plus Denoise on the Neo. [Signed shadows](../../technical/research/denoise-v1-2026-11-16/signed-shadows.md) · [Demosaic trials](../../technical/research/denoise-v1-2026-11-16/demosaic-noise.md) · [LMMSE](../../technical/research/denoise-v1-2026-11-16/lmmse-demosaic.md) |
| 2026-11-17 | Hot-pixel filter, early soft outlier clamp and green–magenta cleanup | Kept single-photo hot-pixel removal and harsh-speck clamping as optional RAW controls. The early ×2.5 clamp reduced conspicuous islands from 547 to 141 across 11 flat review areas, with risks to stars and lettering. Strong colour-only cleanup damaged fine coloured detail and stayed in research. [Hot pixels](../../technical/research/denoise-v1-2026-11-16/raw-pixel-cleanup.md) · [Early taming](../../technical/research/denoise-v1-2026-11-16/early-outlier-taming.md) · [Chroma trials](../../technical/research/denoise-v1-2026-11-16/chroma-cleanup.md) |
| 2026-11-18 | Fixed speck areas, marked colour trials and Canon strength ladders | Steve marked 238 spots. The trial checked all 54 review areas. Brightness-guided colour cleanup faded many but bled across real detail. Fine/Medium-only cleanup and stronger local noise left pits. Whole-image smoothing cleared obvious specks at the cost of hair, faces and flame edges. Kept the marks and crop ladders as evidence. [Trial plan](../../technical/research/denoise-v1-2026-11-16/speck-rnd-proposal.md) · [Colour marks](../../technical/research/denoise-v1-2026-11-16/colour-speck-trials.md) · [Canon ladder](../../technical/research/denoise-v1-2026-11-16/canon-speck-ladder.md) |
| 2026-11-18 | Even keep, local hue limits and dark clump breakup | Kept the 18 px brightness-grain match as the Fine Grain basis. Two faster local averages changed the texture. Adding strong colour balance and dark breakup helped selected marks but changed stars, lettering and fabric. [Round 4](../../technical/research/denoise-v1-2026-11-16/even-keep-round4.md) |
| 2026-11-18 | Relative colour, nearby patch healing and whole-area patch averaging | The combined pass cleared 22/28 colour marks and 12/12 pits on Canon, and 24/24 colour marks and 5/5 pits on Sony. Relative colour informed Clean Grain. Nearby healing softened lashes and hair and changed the flame edge. Whole-area averaging left many pits. [Round 5](../../technical/research/denoise-v1-2026-11-16/round5-relative-colour-and-patch.md) |
| 2026-11-19 | Fine Grain and Clean Grain in the app, followed by native setup and light protection | Kept the experimental choices. Switched from preview-sized Grain preparation to native preparation to keep the look stable through zoom. Changed Clean Grain to Small by default and removed Dark Specks after the isolation trial reached 7/12 Canon pits against a target of 10, and 4/5 Sony pits. Fixed the RAW railing-light shift and recorded crops and waits. [Experimental build](../../technical/archive/briefs/denoise-experimental-grain-modes-2026-11-19.md) · [Clean follow-up](../../technical/briefs/denoise-clean-grain-fixes-2026-11-19.md) · [Railing baseline](../../technical/archive/briefs/denoise-harsh-specks-baseline-speed-2026-11-19.md) |
| 2026-11-19 | Bounded zoom and JPEG delivery, Fine-to-Clean reuse, GPU preparation estimate | Kept viewport-sized draw surfaces, bounded eligible JPEG CPU delivery and Fine-to-Clean RGB reuse. The full-photo GPU plan still had to read back and write the file. At 7.5–9 s Canon / 22–26 s Sony it missed the speed gate and stopped at the estimate. [Speed round 1](../../technical/briefs/denoise-speed-memory-gpu-prep-2026-11-19.md) |
| 2026-11-20 | Shared HDR/SDR refresh; faster CPU filters, brightness-only grain fit and smaller Fine Grain tile margins | Kept all three speed changes. CPU filter and preparation outputs were byte-identical on both reference RAWs. A one-channel shortcut changed the Sony fit and was dropped. Commits `50945dfa`, `a9ce4b18` and `764af1c0`. [Measurements](../../technical/performance-table.md) |
| 2026-11-20 | Bounded Fine Grain WebGPU prototype with the CPU fit supplied | Warm visible-region compute was 134 ms Canon / 123 ms Sony at 110%. Six finished-pixel comparisons passed. A smaller Fit image and fixed grids for the grain fit missed the visual tolerance. Kept the prototype as the basis for the next design. [GPU study, commit `61bc91f6`](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md) |
| 2026-11-20 | Phase 1 Fine Grain GPU trial in Grade | Whole-photo strip measurement, visible tiles, live Evenness and native-strip Fit reduction ran in the app. All eight finished-pixel comparisons passed; the HDR pan overlap was identical on both photos. One injected failure used one CPU preparation and produced the CPU Fine Grain picture. Not enabled by default: Canon HDR Fit improved by only 32%, pans took longer, and Sony reached 4.74 GB. [Phase 1 measurements](../../technical/performance-table.md#november-20--phase-1-fine-grain-on-the-gpu-in-grade) |
| 2026-11-20 | Fine Grain GPU reuse and memory follow-up in Grade | Reused whole-photo measurements, reduced Fit results and filtered tiles. Kept the whole-photo picture in place on pans and bounded strip uploads and measurement scratch. Matching SDR Fit reused the HDR result; both photos stayed under 4 GB. Finished colour and both pan overlaps passed. A rounding guard for this trial fixed the initial one-step overshoot: no finished HDR pixels exceeded 600 nits in the recheck. [Follow-up measurements](../../technical/performance-table.md#november-20--fine-grain-gpu-reuse-in-grade) |
| 2026-11-20 | Native JPEG Proof reconstruction and HDR ceiling correction in bands | Kept the scoped change. Both photos and all three Denoise methods passed the 4 GB check with identical export and Proof files in fresh CPU delivery profiles. [Measurements](../../technical/performance-table.md#november-20--native-jpeg-ultra-hdr-proof-on-the-8-gb-macbook-neo) |
| 2026-11-20 | Linear Bayer Denoise before demosaic; no grain add-back | Tried packed wavelets, guided filtering and guided filtering with separate brightness and colour strength after harsh-speck cleanup. The last was best: at matched brightness noise, Canon shadow grain fell from 8.0 to 4.4 px and Sony from 14.8 to 3.1 px, but colour mottling and detail failed. Three atrium light cores survived exactly. Standalone MacBook Neo GPU work took 7.5 ms warm at 110%; not an app wait. Research only. [Pre-demosaic study](../../technical/research/denoise-v1-2026-11-16/predemosaic-denoise.md) |
| 2026-11-20 | Pre-demosaic round two: independent brightness and colour wavelets | Tried per-phase, simple opponent and noise-whitened splits with five wavelet scales; compared three shrink rules, colour edge guidance, detail protection, green-direction gating and a lighter later Standard pass. Simple opponent plus local BayesShrink led the matched Canon and Sony comparison: grain fell from 8.0 to 4.0 px and 14.8 to 3.9 px, but 21/63 marks worsened and neither photo matched Clean Grain's shadow colour. No passing point at 0–150% Color; no new GPU timing or app changes. [Round two, scores and crops](../../technical/research/denoise-v1-2026-11-16/predemosaic-round2-wavelet-colour.md) |
| 2026-11-20 | DxO PhotoLab reference on the Canon fire-dancer | DxO Standard left 2.9–3.0 px brightness grain versus 7.9–8.4 px in Clean Grain. Both Off developments started at 3.5–4.7 px. On the floor DxO Standard kept 48% of its Off brightness noise and 15% of the 8–32 px colour noise. It darkened the deepest patches substantially while keeping strong flame colour boundaries. It failed the existing zero-worse marks and .90 texture screens, yet fewer of Steve's marks stood out from their own surrounding grain. The report proposes Canon research targets for grain size, colour, verified structure, marks and lights. [Measurements and 1:1 crops](../../technical/research/denoise-v1-2026-11-16/dxo-comparison.md) |
| 2026-11-20 | Pre-demosaic round three: two-stage colour and brightness cleanup | The best split brought Canon shadow and floor grain to 3.30/3.39 px, reduced broad colour blotches to 28%/27% of Clean Grain, and kept smoothed face, skin, skirt and flame colours within 0.26 ΔE of Denoise Off. But fine brightness grain stayed too visible in Sony hair, and the ISO 10000 crop did not show convincing individual strands. Kept Clean Grain. No app change or GPU timing. [Round three, measurements and 1:1 crops](../../technical/research/denoise-v1-2026-11-16/predemosaic-round3.md) |
| 2026-11-20 | Structure protection and brightness tail trimming in pre-demosaic round four | The two-band brightness pass after round three's Bayer and colour stages left Canon dark and floor noise at 28% and 40% of Off with 3 px grain. Skin colour held and Sony portrait hair read more clearly. The ISO 10000 strands still did not read, and a few Canon marks stood out more as surrounding grain fell. Keep Clean Grain. Favour stronger mid-band cleanup in confirmed flats and assess mark contrast separately. [Round four, strength sweep and 1:1 crops](../../technical/research/denoise-v1-2026-11-16/predemosaic-round4.md) |
| 2026-11-20 | Micro Grain, round 3 | GPU Grade, CPU delivery. The three live controls take the place of the common sliders. Fit uses a reduced scene-wavelet preview then exact native strips. Slider-sample interpolation missed colour limits and was not used. [Design and measurements](../../technical/briefs/denoise-micro-grain-app-2026-11-20.md) |

## 6. Problems encountered and known limitations

- **Micro Grain eligibility:** Needs an ordinary signed Bayer RAW with complete Bayer cells at the sensor edges. DNG, authored SDR, retouch repairs and Edge Colour highlight reconstruction are not eligible. Grade uses the CPU for applied lens correction and non-neutral crop or geometry.
- **Micro Grain source reference:** The Canon face and one Sony flat crop still have a few scene-channel differences against round 3. Finished CPU crop colours passed, and the native Grade viewport versus CPU delivery met the finished HDR and SDR limits on both RAWs.
- **Denoise toggle and method switching:** Off now draws the original without waiting for the save and retries if the revision changes underneath it. The menu stays usable during preparation and a new pick takes priority over older work. At 110%, the old whole-photo layer hid Micro Grain's finished detail layer; the detail now draws on top. At Fit, all three prepared Grain results can stay cached within the existing memory allowance. Micro Grain gives a first-picture wait notice while it prepares. The saved Standard and Micro grades restored correctly in a fresh Grade session, and the menu, visible pixels and saved grade agreed across all four methods at both zooms. Steve's reported literal menu rollback was not reproduced; his saves show Clean and Micro being toggled, not an old Standard grade being restored. [Real-click timings and session findings](../../technical/performance-table.md#november-20--denoise-from-the-library-with-real-clicks)

| Problem | Status on November 20 |
| --- | --- |
| Micro Grain live controls | **Improved; speed remains open.** The Canon slider takes about 0.70–0.80 s at 110%, still above the 0.30 s target and slower than the earlier 0.05 s Clean Grain result. Pan did not improve. Exact Fit is about 4.45 s on Canon and 12.07 s on Sony, compared with the earlier 6.07 s and 16.00 s. [Performance table](../../technical/performance-table.md#november-20--denoise-transitions-and-micro-grain-throughput) |
| 640-pixel HDR Library Grain mismatch | **Open.** The Canon draws now complete. Fine was 18.42 / 77.59 / 198.65 and Clean 18.56 / 79.32 / 192.57 ΔE ITP (mean / p99 / p99.9) against the resized native export. Limits are <1 / <3 / ≤3. Off also missed. Neither reading prepared Grain at 640 nor finishing at 1280 then reducing passed. Exact native finish then resize took 4.41 s Fine / 7.17 s Clean after decode. [Mac Library trials and audit](../../technical/briefs/denoise-mac-open-items-2026-11-20.md) |
| Full-size JPEG Proof memory | **Fixed on the measured CPU route.** Decoded views and peak correction run in bands. All six native Sony and Canon cases passed the 4 GB app cap and matched their baselines byte for byte. The Canon Standard retry preserved the exact 1,000-nit finished cap and delivered 999.965 nits. [Memory and timings](../../technical/performance-table.md#november-20--native-jpeg-ultra-hdr-proof-on-the-8-gb-macbook-neo) |
| Sony Standard at 110% | **Open.** The November 20 spot check sampled 4.17 GB against the 4 GB Denoise gate. Canon holds and pans stayed within budget. [Performance table](../../technical/performance-table.md) |
| Fine Grain GPU rollout | **On by default in Grade.** The fresh run beat the CPU waits and stayed under 4 GB on the MacBook Neo. Canon Show original and bypass restored the same finished pixels as Denoise off. [Rollout measurements](../../technical/performance-table.md#november-20--fine-grain-enabled-in-grade) |
| Clean Grain GPU rollout | **On by default in Grade.** Less halo work and reuse of overlapping source pixels closed the Large wide-pan gap on the Sony. The paired run was within 1.4% of the CPU and a repeat was 35% faster. Finished colour, tile joins and fallback stayed within the limits. [Clean Grain measurements](../../technical/performance-table.md#november-20--clean-grain-large-pan-and-grade-rollout) |
| Match at 300 nits | **Safe refusal.** On Canon at +1 EV and a 120/300-nit compression range, Mac p95 colour was 0.077 and PC 0.061 against 0.050. Mac kept the prior independent SDR grade and revision. At 120/450 nits Mac completed in 5.47 s and marked it Needs review. [Match check](../../technical/briefs/denoise-mac-open-items-2026-11-20.md#4-match-with-the-canons-separate-sdr-grade--done-with-one-refusal) |
| Fixture follow-up | **November 26:** the noise-free EXR requirement and lab render case are retired at Steve's request. DSC00950 review drivers explicitly relink their disposable session to the curated RAW with the matching saved source hash; the protected project is unchanged. DSC07060.ARW.hdrf remains a separate missing fixture. Full GPU measurement is not newly certified by this fixture cleanup. |
| Coarse brightness grain | **Confirmed on the Canon.** Off grain sizes are similar in the shadows and slightly larger in DxO on the floor. DxO Standard keeps more of the 2–4 px brightness pattern relative to the 8–32 px pattern. Clean Grain favours larger sizes. The TIFFs show the difference between the complete developments and cannot identify DxO's internal filter. [DxO spectrum](../../technical/research/denoise-v1-2026-11-16/dxo-comparison.md#spectral-fingerprint-of-dxo-standard) |
| Cleaning the mosaic before demosaic | **Open; no shipping candidate.** Separate early wavelets made the grain finer but did not clear colour, marks, detail or the full small-light check. The ISO 10000 holdout lost most hair texture; the atrium's light centres matched unfiltered development but one light's surrounding contrast changed by 11%. Separate RAW controls still interacted after demosaic. A lighter, retuned Standard pass was not a rescue. Keep current methods and no grain add-back. For the next trial, aim for 3–4 px Canon grain with less neighbour correlation at preserved shadow brightness. Try a separate, edge-aware colour pass and compare it with the earlier shadow-only later treatment. Score real texture, mark visibility and light surroundings before GPU or app work. [DxO-based research targets](../../technical/research/denoise-v1-2026-11-16/dxo-comparison.md#proposed-targets-for-the-next-early-bayer-trial) Grade still needs a Bayer-to-viewport route if a candidate passes. [Round two](../../technical/research/denoise-v1-2026-11-16/predemosaic-round2-wavelet-colour.md) |
| Colour mottling and fine detail | **Open.** Lifted shadows can retain broad colour patches. Clean Grain's Small correction brought 11/28 Canon and 22/24 Sony colour marks to grain level in the app-test follow-up. Canon's target was 20. Six marked Canon centres rendered black from negative scene luminance, so a colour-only correction cannot lift them. Wider correction can pull colour near lights or soften detail. The Fine Grain planter rim looked more saturated after display mapping. The actual planter's after-fix appearance is unconfirmed. [Grade follow-up](grade.md#november-19-2026-clean-grain-app-test-follow-up) · [Marked areas](../../technical/research/denoise-v1-2026-11-16/round5-relative-colour-and-patch.md) |

### November 20 overnight audit

All nine fixes below are committed on the branch in `de20bf58` and `5105a4cc`. The audit report records the fixtures and full checks. [Overnight audit](../../technical/briefs/denoise-mac-open-items-2026-11-20.md#5-overnight-bug-fix-report--november-20-2026)

| Finding | Fix and evidence |
| --- | --- |
| 1. Authored SDR delivery ignored Denoise | Export and Proof now denoise the authored SDR. Real Grade vs CPU export was 0.198 / 0.622 / 0.730 ΔE 2000 (mean / p99 / p99.9). CPU full-size Proof and export bytes matched. |
| 2. Match and Undo could take the wrong SDR source | Separate GPU cache keys keep generated ACEScg and authored linear sRGB apart. Match switched to the generated source and Undo restored the authored source and Denoise selection in the app check. |
| 3. Library Grain expired before the first read | The preparation lives through the draw. Both Canon Grain draws completed. A current draw can fall back once on expiry, while a cancelled draw stops. |
| 4. Grade fallback could drop Denoise | A forced failure made one GPU attempt and then showed denoised CPU pixels. A bounded Full fallback above 4096 pixels explains the reduced size. |
| 5. Recalculate could stay busy forever | Failed saves, unavailable GPU and expired preparation now end in a retryable error. |
| 6. Cancelled Grain work kept running | Stale reads and uploads stop. Stale fits cannot launch tile work. A fit already inside a numerical operation can finish, and its result is discarded. |
| 7. Library replaced the saved highlight target | Both routes use the saved target. The CPU test that previously reached 832 nits now stays at or below its saved 400 nits before encoding. |
| 8. Panorama Fit failed | The 18,001-pixel case requests a supported Fit measurement within the existing API limit. |
| 9. HDR thumbnails survived RAW decoder changes | Finished HDR thumbnails are invalidated when the source-development or decoder identity changes. The test verifies a cache miss after the decoder changes. |

## 7. Open work and next steps

| Work | Status and next check |
| --- | --- |
| Grain on the GPU | **Fine Grain and Clean Grain are enabled in Grade.** The delivery trial stays opt-in: the Canon did not save enough of the total wait, and the full-size Sony was refused under the 4 GB cap. Investigate full-image finishing and encoding costs before trying another delivery rollout. [Measured waits, memory and checks](../../technical/performance-table.md#november-20--fine-and-clean-grain-gpu-delivery-trial) · [November 20 GPU study](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md) |
| GPU fallback, CPU backup speed and logs | **Sprint started November 21.** The Mac's silent switch of Clean Grain to the CPU is unexplained: PC tests at the Neo's likely 2 GiB graphics setting stayed on the GPU. The sprint adds app-wide logs with reason codes, releases old graphics memory and retries once before falling back, prepares the visible CPU area first, and keeps photos above 8,192 pixels on the GPU in bounded pieces. [Sprint brief](../../technical/briefs/sprint-denoise-gpu-logging-2026-11-21.md) · [PC fallback measurements](../../technical/briefs/denoise-gpu-fallback-memory-2026-11-21.md) |
| CPU Micro Grain with lens correction | **Partly built.** Grade goes straight to the retained zoom. The CPU fallback can take over the GPU’s Bayer preparation when the RAW and all sensor settings match. On the MacBook Neo at 78%, Lensfun Auto completed in 53–55 s with matching preview bytes and peaks below 4 GB. Full-size CPU Micro rendering still dominates the wait. The Windows replay matched all four preview hashes, with Lensfun Auto in 41.28 s and a 3.397 GB app peak. Further speed work remains open. [Windows PC replay](../../technical/performance-table.md#november-22-2026--windows-pc-grade-micro-grain-with-lensfun) · [MacBook Neo measurements](../../technical/performance-table.md#november-22-2026--lens-correction-speed) |
| Micro Grain for v1 | **Waiting on Steve (noted November 22).** Two decisions, after other testing, smaller bug fixes and feature tweaks: (1) whether Micro Grain needs quality changes before it goes into v1, since it currently looks less good than Clean Grain; (2) whether to run Micro Grain with lens correction on the GPU (about 1–2 weeks). Lens correction is on by default and the GPU Micro route refuses it, so Micro Grain with lens correction renders the full photo on the CPU (about 25 s of a 55 s wait on the MacBook Neo at 78%). Also listed in [PRD §7](../PRD.md#7-waiting-on-steve). |
| Grain size and colour | **Canon benchmark measured.** The next trial should preserve signed shadow brightness while reducing broad colour separately from fine brightness grain. Keep the fixed marks and visually check recognizable detail. Repeat the Sony and atrium checks before adopting the Canon targets. [Grain and colour tests](../../technical/research/denoise-v1-2026-11-16/grain-size-and-colour.md) · [DxO benchmark](../../technical/research/denoise-v1-2026-11-16/dxo-comparison.md) |
| Export reuse | **On hold.** Export and Proof can share their GPU delivery result when admitted. Matching HDR and generated SDR share the Grain fit; an authored SDR base is measured separately. The CPU still has its existing Fine-to-Clean and identical-rendition reuse. Keep the trial off by default until a shorter whole delivery wait is measured under 4 GB. [GPU delivery design](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md) |
| Library colour and experimental acceptance | **Open.** Isolate the mismatch with Off as a control. Compare exact saved thumbnails when a native render already exists. Review the fixed crop set and Steve's marks before accepting either Grain method for release. [Library trials](../../technical/briefs/denoise-mac-open-items-2026-11-20.md) · [Clean Grain acceptance](../../technical/briefs/denoise-clean-grain-fixes-2026-11-19.md) |
| Exposure-independent grain and RAW cleanup | **Weighted Bayer fit adopted November 22.** Colour protection, Micro light guard and RAW cleanup floors remain off by default while their noise references are redesigned and checked with exposure-matched crops. [QUAL-1 results and switches](../../technical/briefs/sprint-denoise-gpu-logging-2026-11-21.md#qual-1--exposure-independent-quality-fixes-output-changes) · [Local review page](../../../codebase/output/review/grain-quality/index.html) |
| Noise measurement: CPU and GPU agreement | **Later, after v1 (Steve, November 21).** A CPU export of a photo not opened in Grade on this machine measures noise on the CPU (up to 64 windows, full tail scan). After Grade, export reuses Grade's GPU measurement (4×4 windows, 16,384-sample tail). The Sony Clean Grain AVIF differs by HDR ΔE ITP 0.669 / 2.075 (mean / p99), within limits. On one machine, Grade, Proof and export already share one measurement. Fix by measuring the same windows on both. That is an output change for one of the two paths. Do not store models in grades. [Sprint brief R2-7](../../technical/briefs/sprint-denoise-gpu-logging-2026-11-21.md) |

## 8. Document map

### Product, guide and technical references

- Product requirements and related modules. [Master PRD](../PRD.md) · [Grade](grade.md) · [Import and RAW](import-and-raw.md) · [Photo Library](photo-library.md) · [Export and Proof](export-and-proof.md) · [Preview and GPU](preview-and-gpu.md) · [Memory and caches](memory-and-caches.md) · [Film Look](film-look.md)
- Help for people using the app. [Denoise](../../user-guide/denoise.md) · [Grading controls](../../user-guide/grading-controls-reference.md) · [Typed values](../../user-guide/typed-values-reference.md) · [Import](../../user-guide/import.md) · [Proof](../../user-guide/proof.md) · [Export](../../user-guide/export.md)
- Implementation and measurements. [Denoising contract and Haar history](../../technical/denoising.md) · [Code map](../../technical/code-map.md) · [Processing order](../../technical/image-processing-pipeline.md) · [Photo Library](../../technical/photo-library.md) · [SDR Match](../../technical/sdr-match.md) · [Highlight compression](../../technical/highlight-compression.md) · [Performance table](../../technical/performance-table.md) · [Known limitations](../../known-limitations.md) · [Test photos](../../technical/test-photos.md)
- Earlier investigations. [Technology watch](../../technical/denoising-technology-watch-2026.md) · [AI feasibility](../../technical/research/next-version-2026-11-13/b1-ai-denoise.md) · [September tiling](../../technical/archive/phase-6-tiled-denoise-evidence-2026-09-20.md) · [October review plan](../../technical/denoise-accuracy-review-plan-2026-10-04.md) · [October follow-ups](../../technical/denoise-followups-2026-10-04.md)

### Briefs and research

- Current briefs. [v1 quality trial](../../technical/briefs/denoise-v1-quality-trial-2026-11-16.md) · [Speck R&D brief](../../technical/briefs/denoise-speck-rnd-prompt-2026-11-18.md) · [Clean Grain fixes](../../technical/briefs/denoise-clean-grain-fixes-2026-11-19.md) · [Speed, memory and GPU preparation](../../technical/briefs/denoise-speed-memory-gpu-prep-2026-11-19.md) · [Mac open items and overnight audit](../../technical/briefs/denoise-mac-open-items-2026-11-20.md) · [WebGPU Grain design](../../technical/briefs/denoise-grain-gpu-design-2026-11-20.md)
- Archived briefs. [Experimental Fine and Clean Grain](../../technical/archive/briefs/denoise-experimental-grain-modes-2026-11-19.md) · [Harsh specks, baseline and speed](../../technical/archive/briefs/denoise-harsh-specks-baseline-speed-2026-11-19.md)
- All notes in the [November v1 research folder](../../technical/research/denoise-v1-2026-11-16/) are linked from [Methods tried](#5-methods-tried). The in-progress grain-size note is tracked under [Open work](#7-open-work-and-next-steps). Review inputs and tools. [Steve's areas](../../../codebase/tools/denoise_eval/steve-areas-2026-11-18.json) · [Steve's marks](../../../codebase/tools/denoise_eval/steve-marks-2026-11-18.json) · [Quality harness](../../../codebase/tools/denoise_eval/README.md) · [Fixed crop and speed baseline](../../../codebase/tools/denoise_eval/speed_baseline.py)

### Test drivers

- Noise model and parity. [GPU measurement](../../../codebase/tests/gpu-denoise-measurement.js) · [Adaptive GPU/CPU reconstruction](../../../codebase/tests/denoise-adaptive-parity.js) · [CPU model windows](../../../codebase/tests/test_denoise_model_windows.py) · [Native model](../../../codebase/tests/test_denoise_native_model.py) · [Informative calibration](../../../codebase/tests/test_denoise_informative.py) · [Measurement and preparation](../../../codebase/tests/test_denoise_measurement.py) · [Adaptive filter](../../../codebase/tests/test_denoise_adaptive.py) · [Grain filters](../../../codebase/tests/test_denoise_grain.py) · [Document settings](../../../codebase/tests/test_denoise_document.py)
- Grade and Library. [Full tier](../../../codebase/tests/full-tier-denoise.js) · [Zoomed region](../../../codebase/tests/denoise-zoomed-region.js) · [Pan, enable, drag](../../../codebase/tests/denoise-pan-enable-drag.js) · [Noise only](../../../codebase/tests/denoise-noise-view.js) · [Progressive disclosure](../../../codebase/tests/denoise-progressive-disclosure.js) · [Tile cache](../../../codebase/tests/denoise-tile-cache.js) · [Library reuse](../../../codebase/tests/library-denoise-reuse.js) · [Library setup](../../../codebase/tests/library-denoise-setup.test.js)
- Interactive ownership. [One active analysis](../../../codebase/tests/denoise-analysis-singleflight.test.js) · [Host fit](../../../codebase/tests/denoise-measurement-fit.test.js) · [Edit ownership](../../../codebase/tests/denoise-ownership.test.js) · [Picture presentation](../../../codebase/tests/denoise-preview-presentation.test.js) · [Source load ownership](../../../codebase/tests/denoise-source-load-ownership.test.js)
- Timings and diagnostics. [Grain latency](../../../codebase/tests/performance/denoise-grain-latency.js) · [Drag region](../../../codebase/tests/performance/denoise-drag-region.js) · [Input coalescing](../../../codebase/tests/performance/denoise-input-coalescing.js) · [Native/intermediate probe](../../../codebase/tests/performance/denoise-native-intermediate-probe.js) · [Scale identity](../../../codebase/tests/performance/denoise-scale-identity.js) · [Selector seam](../../../codebase/tests/performance/denoise-selector-seam.js) · [Stale source](../../../codebase/tests/performance/denoise-stale-source.js) · [Accuracy stages](../../../codebase/tests/performance/denoise-accuracy-stages.py) · [Intermediate parity](../../../codebase/tests/performance/denoise-intermediate-parity.py) · [Source-aligned continuity](../../../codebase/tests/performance/denoise-source-aligned-continuity.py) · [Proxy fixture generator](../../../codebase/tests/performance/generate-denoise-proxy-fixtures.py)
- RAW and delivery. [RAW Pixel cleanup](../../../codebase/tests/raw-pixel-cleanup.js) · [RAW cleanup delivery](../../../codebase/tests/raw-pixel-cleanup-delivery.js) · [Hot-pixel filter](../../../codebase/tests/test_raw_pixel_cleanup.py) · [Harsh-speck filter](../../../codebase/tests/test_raw_speck_cleanup.py) · [GPU delivery smoke, including Denoise and authored SDR](../../../codebase/tests/gpu-delivery-smoke.js) · [CPU Denoise export](../../../codebase/tests/test_export_denoise_parity.py) · [Delivery ceiling](../../../codebase/tests/gpu-delivery-ceiling.js) · [Repeat delivery](../../../codebase/tests/gpu-delivery-repeat.js) · [Proof size](../../../codebase/tests/proof-size-interaction.js) · [Proof/export identity](../../../codebase/tests/performance/proof_export_identity.py) · [Proof/Grade diagnostic](../../../codebase/desktop/tests/proof-grade-diagnostic.js) · [Preview/export comparator](../../../codebase/tests/performance/preview-export-compare.js)
- CPU quality research. [Harness](../../../codebase/tests/test_denoise_eval.py) · [Public pairs](../../../codebase/tests/test_denoise_public_pairs.py) · [RawNIND](../../../codebase/tests/test_denoise_rawnind.py) · [Classical](../../../codebase/tests/test_denoise_classical.py) · [Pilot Wiener](../../../codebase/tests/test_denoise_pilot_wiener.py) · [Dark noise](../../../codebase/tests/test_denoise_dark_noise.py) · [Demosaic](../../../codebase/tests/test_denoise_demosaic_noise.py) · [LMMSE](../../../codebase/tests/test_denoise_lmmse.py) · [Noise model and specks](../../../codebase/tests/test_denoise_noise_model_specks.py) · [Residual specks](../../../codebase/tests/test_denoise_speck_cleanup.py) · [Early outliers](../../../codebase/tests/test_denoise_early_outlier.py) · [Chroma cleanup](../../../codebase/tests/test_denoise_chroma_cleanup.py) · [Hot pixels](../../../codebase/tests/test_denoise_hot_pixel.py)
- Release registration and run rules. [Driver inventory](../../../codebase/tests/release/drivers.json) · [Release checks](../../../codebase/tests/release/README.md) · [GPU run lock](../../../codebase/tools/gpu-run-lock.py)

### Key source files

- Grade, measurement and GPU. [Denoise controls](../../../codebase/frontend/denoise-ui.js) · [Noise measurement](../../../codebase/frontend/denoise-measurement.js) · [Preview routing](../../../codebase/frontend/preview-pipeline.js) · [WebGPU renderer](../../../codebase/frontend/webgpu-preview.js) · [Compute shaders](../../../codebase/frontend/webgpu-shaders.js) · [Project documents](../../../codebase/frontend/project-documents.js) · [Saved defaults and controls](../../../codebase/backend/hdr_finisher/models.py) · [SDR Match](../../../codebase/frontend/sdr-match-ui.js)
- CPU and RAW source. [Measurement and scratch ownership](../../../codebase/backend/hdr_finisher/denoise_measurement.py) · [Adaptive Denoise](../../../codebase/backend/hdr_finisher/denoise_adaptive.py) · [Native Grain](../../../codebase/backend/hdr_finisher/denoise_grain.py) · [Filter wrapper](../../../codebase/backend/hdr_finisher/denoise_filters.py) · [Native C filters](../../../codebase/backend/hdr_finisher/denoise_filters.c) · [CPU worker policy](../../../codebase/backend/hdr_finisher/cpu_budget.py) · [Hot pixels](../../../codebase/backend/hdr_finisher/raw_pixel_cleanup.py) · [Harsh specks](../../../codebase/backend/hdr_finisher/raw_speck_cleanup.py)
- Library and delivery. [Library GPU](../../../codebase/frontend/library-gpu.js) · [Library RAW GPU](../../../codebase/frontend/library-gpu-raw.js) · [Library live](../../../codebase/backend/hdr_finisher/library_live.py) · [Stored screen previews](../../../codebase/backend/hdr_finisher/library_screen_previews.py) · [CPU preview](../../../codebase/backend/hdr_finisher/preview.py) · [GPU delivery](../../../codebase/frontend/gpu-delivery.js) · [Exporters](../../../codebase/backend/hdr_finisher/exporters.py) · [Proof](../../../codebase/backend/hdr_finisher/proofing.py) · [HDR ceiling](../../../codebase/backend/hdr_finisher/hdr_ceiling.py)
