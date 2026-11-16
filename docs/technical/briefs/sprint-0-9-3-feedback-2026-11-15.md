# Sprint brief: 0.9.3 feedback (November 15, 2026)

**Owner:** Steve. **Coordinator:** Claude (Opus 5.5): keeps this brief
current, checks every report, takes decisions to Steve one at a time.
**Workers:** Codex `gpt-6.1-sol`, one per work package, each in its own
worktree made from `feat/watermark-and-library-polish`.
**Source:** Steve's "HDRF - 0.9.3 notes", six Codex review reports and one
code review of the PC changes made on November 15 (`f7c02993..55e8bb5f`).

`AGENTS.md` applies to every package, especially "How much to test", the
GPU-route rules, "Stop and ask", and asking Steve before any commit or push.
Where this brief and `AGENTS.md` disagree, `AGENTS.md` wins.

## How to use this brief

- Each item has an ID, a status and a definition of done. Workers update
  only the status column of their own items, plus a one-line result.
- "What we know" lists what the reviewers found. It is a starting point,
  not an order: confirm the cause in the code before fixing it, and if the
  code disagrees, say so in your report.
- An item marked **output change** changes rendered pixels on purpose. Say
  so in the commit and run the matching preview/export agreement checks.
  Never loosen a tolerance to get a pass.
- When an item is finished, record the outcome in its module PRD
  (`docs/product/modules/`). When the whole brief is finished it moves to
  `docs/technical/archive/briefs/`.

## Status board

| ID | Item | Package | Status |
| --- | --- | --- | --- |
| M1-SAFE | Link safe Matches, otherwise independent fallback | Implementation | in progress — Steve’s Nov 16 safe-link decision; unchanged acceptance checks, common Film/local prefix, link state/UI, CPU/GPU/delivery and whole-slider timing. Mac timing noise ±10%; renderer mean <1 / P99.9 ≤3. Exact-path local commits, no push. |
| N6-HF | Opt-in high-fidelity JPEG XL | Implementation | in progress — lossless 12-bit HDR/SDR setting, presets/Proof/batch coverage and native-photo qualification on 8 GB Mac; default unchanged; exact-path local commits, no push. |
| M1-LINK | Option B: linked SDR after Match | Implementation | blocked at tail acceptance — no app/recipe/renderer changes. Baseline reproduces 30/49 order and 35/49 white-growth passes; 28,560 simple chart-tail candidates retain bright colour plus all guards only for Velvia 100% in each chart (2/14). Not an impossibility proof; no check relaxed. GPU, link UI/state, delivery, locals and whole-slider timing remain unbuilt/unqualified; report section 9. Local exact-path commits, no push. |
| M1-EQ | Equal-input Film order trial (research only) | Steve-approved trial | complete — no shipping/default/recipe/project change; 49/49 body-safe CPU fits, bright hue/stop P95 max 1.975 ΔE00, RAW highlight max 1.981, exact HDR; only 30/49 order and 35/49 white-growth passes, GPU compile failed/no timing; saved SDR drift DSC00950 10.050 and DSC00264 15.317; recommend ship with changes, first decide linked Tone/Film ownership; [report](../reports/film-look-equal-input-trial-2026-11-16.md) |
| N1 | Fixed cap and final SDR Highlight Compression | Overnight | built and checked — fourth mode added, existing curves/settings/defaults retained; CPU/GPU finishing, all 33 SDR Film cases, Proof/export and isolated Library pass; M1 mixed results/new refusals remain for N3a |
| N2 | Global five-control Tone and aligned wheel ranges | Overnight | built and checked — frozen Y/M guide, photographic-grey anchor, endpoint gates/combined limiter, Whites UI; four HC modes, CPU/GPU, Proof/export, both layouts and isolated Library pass; encoded-HDR diagnostics remain outside report-only caps |
| N3b | Tone clipping and effective-range diagnostics (T1-d) | Overnight | built, preview-only — HDR/SDR/global/local gestures, endpoint-vs-cap-loss channel checks and Library pass; no Auto/new UI tokens; final photo/export qualification recorded in N3b result |
| N6-A | Exact finished/encoded HC ceiling | Follow-up | implemented — **awaiting full Still-strict validation**; final roundoff corrected only above target; 1% encoded allowance kept (zero-allowance change reverted, not approved); scoped CPU/GPU/codec/Proof checks recorded below |
| N6-B | Sharp-highlight delivery failure | Follow-up | investigated, still open — finished floats/quantized inputs pass; JPEG/gain-map processing amplifies differences; no tested codec-only alternative passes the unchanged gate |
| N6-D | Renderer agreement split and encoding fidelity options | Implementation + research | built and checked on Mac — affected delivery gates use actual finished pixels; fidelity/decoded pairs report only. Local HSL, six-format framing, repeat/CPU, picker/four exports, JPEG/AVIF performance and Library viewport pass; fast Node 1,091 / Python 3,850 pass. JXL loss is compression; lossless quantized JXL passes fixture/crops/four reduced photos at larger sizes. JPEG/AVIF options improve but do not fix all tails; no shipping settings/defaults change. Unsupported optional JXL performance mode is recorded, not passed. Exact finished ceiling and 1% encoded allowance unchanged. Report: `../reports/encoding-fidelity-fixes-2026-11-16.md`. |
| N6-B-JPEG | JPEG Ultra HDR codec sensitivity and own-source fidelity | Research | complete — map JPEG first crosses the pair limit; one-renderer one-code perturbations reproduce it, while own-source fidelity also fails. Five approved inputs, full/partial headroom and measured non-shipping options: `docs/technical/reports/encoding-drift-jpeg-ultrahdr-2026-11-16.md`. Recommend separate renderer/fidelity checks for Steve's approval; existing gates/settings unchanged. Fast suites have two unrelated concurrent-edit failures; no Electron run. |
| N6-C | AVIF/JXL encoding drift and safe HC peak minimum | Research + implementation | complete — AVIF and JXL also amplify passing input differences; report: `../reports/encoding-drift-avif-jxl-2026-11-16.md`. Measured all-format Peak floor 225 nits; UI/model clamps implemented. Real-encode/floor 115 pass; focused UI/export/Proof and HC parity pass; fast Node 1091 pass/1 skip. Fast Python has one unrelated RAW-cache failure; quick Library fails memory reserve/8 of 9 pictured. Codec settings, gates and tolerances unchanged; local commits only. |
| H1 | HSL picker, Local hue selection and gizmos | Follow-up | built, scoped — pre-sprint Local save/sample race and late HSL cancellation fixed; HDR/SDR real-RAW picking, wheel/sampling-gizmo gestures and CPU/GPU hue delivery pass; general idle failure not reproduced, Steve's original sequence still needs confirmation |
| R1 | SDR local Detail: CPU clips, GPU keeps headroom | W1 | built — CPU local Detail retains headroom; Portra/Velvia GPU preview against CPU export passes |
| R2 | Startup reconciliation brings back invalidated scenes | W1 | built — reconciliation checks saved epoch and pending deletion; scene/surface regressions pass |
| R3 | Grade import overlaps a running paste import | W1 | built — real Grade import waits for paste release; continuation/cancel regressions pass; broader P3 remains W2 |
| R4 | Built previews keep the pre-fix Detail rendering | W1 | built — finished thumbnail/screen versions advanced, including built previews; source scene reuse verified |
| R5 | Refresh invalidates unrelated photos' work | W1 | built — Refresh cancels only its photo families; unrelated source work completes |
| R6 | Deferred delete can remove a fresh replacement | W1 | built — compare/delete share the publication transaction; concurrent replacement survives |
| R7 | Failed clean-up request hides a successful paste | W1 | built — best-effort cleanup bounded to one second; rejected/hung cleanup preserves successful result |
| R8 | Exact grain test fails on the Mac | W1 | built — exact same-run old/new grain comparison replaces Windows-generated arrays; no tolerance change |
| P1 | Paste Grade shows it has started immediately | W2 | built — final feedback 10–12 ms on Neo; cancel/failure/no-change, virtual-copy redraw and Undo checked |
| P2 | Edited thumbnail appears fast after leaving Grade | W2 | built — ready return 100–224 ms, pixels checked; current-format-first publication; 500 ms whole-handoff qualification remains variable (403/696 ms) |
| P3 | Opening Grade during background work is fast | W2 | built — pause spans first picture, including cached-only windows; Neo whole-wait contention passes without excluding release wait |
| P4 | Library Denoise setup reused when nothing changed | W2 | built — exact-source scratch and control-only pixels checked in Library; timings noisy; existing Grade readback/geometry checks remain limited |
| P5 | Lensfun: measure, then decide | W2 | measured — full RAW stage timings recorded; no-go for strip-fused rewrite for now; no pixel/cache changes |
| C1 | Colour wheels: tiny move changes highlights | W3 | built — CPU/GPU retain headroom; continuity and unchanged-range checks pass |
| C2 | Colour wheels: Balance direction | W3 | built — positive favours Highlights globally/locally; Match translates local wheel hues too |
| C3 | Colour wheels: clicking a puck changes it | W3 | built — shared drawing/input radius and grab offset; stationary 40% stays 40% |
| C4 | HDR/SDR colour-wheel tonal ranges | N2 | built — same photographic-grey anchor globally/locally, CPU/GPU; Match retains primaries translation; existing active wheel looks intentionally change |
| T1 | Blacks/Whites and Shadows/Midtones/Highlights redesign | W4 | global N2 and Local N3a built and checked; clipping/range preview built in N3b, Auto later |
| M1 | HDR to SDR Match colour shifts (blue jeans) | W5 | not fixed across colours; N3a local renderer adaptation built, but approved equal-Film-input/highlight-colour rebuild stopped after failed unchanged-gate probes; all-hue/stock and five-RAW comparisons remain unchanged vs pre-N3a |
| M1a | SDR contrast/Film Look clipping turns saturated colours | W3 | built, scoped clipping fix only — existing calibrated exposure/body guards pass; broader M1 follow-up finds bright green/cyan/indigo errors and DSC00264 highlight regression; no new pixel/gate change; GPU Match fixture still fails before Match |
| X1 | Match SDR button for local adjustments and masks | N4 | built, scoped — per-parent same-change fit, independent SDR global grade, Undo, stale marker and overwrite consent; 16/18 proxy cases accepted, two safely refused; native sharp-highlight delivery qualification remains limited |
| X2 | Reverse workflow: SDR grade applied to HDR automatically | N5 | not exposed — bounded research fitter misses body/family acceptance; no user button or mutation endpoint; report and safe prototype retained, native/action qualification deferred |
| U1 | Export panel padding and single divider | W6 | built — Export strip/results share Destination inset; one boundary; three-theme screenshots pass |
| U2 | No selection borders after mouse use | W6 | built — pointer typing stays ring-free; Tab/F6 retain keyboard rings; Export checked |
| U3 | Module header: dot + Reset left, Presets right | W6 | built — name, dot + Reset, Presets, eye in DOM/visual order; Presets always visible |
| U4 | Full screen shows rating/pick/colour | W6 | built — display-only marks at bottom-right; photo/mark changes checked in Electron |
| U5 | Maximize button shows Restore when maximized | W6 | built — Restore image follows native state; consumer regression passes; Windows OS check pending |
| U6 | Right-click menu text size | W6 | built — 14.5px commands, 12px shortcuts; viewport-bounded scrolling menus |
| U7 | Right-click menu opens without lag | W6 | built — immediate menu, deferred Revert/Details; Neo 2.4–13.8ms; stale response check passes |
| U8 | Frame menu fits the MacBook Neo | W6 | built — both layers open, full-width sliders, viewport clamp; fits 1408x794 and 1100x720 |
| U9 | Hover backgrounds as tokens in every theme | W6 | built — existing neutral plate-up-hover on pinned/menu surfaces; no new tokens |
| U10 | Pinned drag shows an insertion line | W6 | built — before/after insertion lines for pins/sections; pin order/photo-drop regression passes |
| U11 | Unpin control looks odd | W6 | waiting on Steve |
| U12 | Mac Dock/Command-Tab icon | W6 | built — development Dock icon set; packaged PNG runtime resource included; installed app/caches untouched |
| U13 | Less rounding on the logo background | W6 | built — gentler smaller radius in five SVGs and PNG; portable Electron regeneration passes on Mac |
| L1 | Tooltips appear after about 2.5 s | W7 | built and checked — shared 2.5 s hover/focus controller; main/Library iframe/pop-out, rendition, dialog layer and bounds pass; neighbour grace disabled |
| L2 | Tooltip pass: no redundant labels | W7 | built and checked — names only for hidden/clipped labels; explanations retained; shortcut-only switch kept; responsive and metadata checks pass |
| L3 | "Choose what to paste" organised | W7 | built — linked checklist, authored ordered sections and independent disclosures; four Neo layouts and focused paste/Undo pass; full driver stops on untouched live-scene AbortError; visual sign-off open |
| L4 | Open image uses the Library grid browser | W7 | built and checked — shared grid/list single-image mode; JPEG opens into Grade; folder/project/destination modes and preview regression pass; 1408×794 and 1100×720 captures |
| L5 | Purple default accent, orange still offered | W7 | built and checked — purple before first paint; saved orange retained; Settings passes all three themes and startup checks |

## Decisions

**Made**

| Date | Decision |
| --- | --- |
| Nov 15 | Purple `#9b7bff` is the default accent. Orange stays a choice in Settings. Saved choices are kept. |
| Nov 15 | Add a Whites slider beside Blacks. Blacks and Whites are simple endpoint controls that feel the same in HDR and SDR and overlap little with Shadows/Highlights. Shadows/Midtones/Highlights cover broader, customisable ranges, closer to lift/gamma/gain. Exact design waits for the T1 research. |
| Nov 15 | Steve opened the slow RAW (over 30 s) in **Grade**, while a paste was running. |
| Nov 15 | T1-a: the Tone block stays **early**, before Film Look (users set tone, then add a look, like a LUT workflow). Highlight Compression stays **last** as the cap that guarantees the delivery peak. The backend may differ internally where that is more intuitive or gives better results, but the user-facing order is tone → look → cap. The research proposal's after-compression placement is rejected; the design is being revised for this order. |
| Nov 15 | Fix the SDR clipping bug (M1a) now, in W3 with the colour wheel fixes. Verify on the shared test RAWs (any saturated blue should show it); the jeans were only a recent example. |

**Steve's answers to the combined question list (Nov 15, evening)**

| Q | Decision |
| --- | --- |
| L1 neighbours | Every tooltip waits 2.5 s (no instant neighbours). |
| L2 shortcut tips | Keep shortcut-only tooltips on labelled controls. |
| M1a | Keep the SDR headroom/clipping fix until the restructure lands. |
| M1 / M1d | Restructure: SDR highlight compression moves to the end, SDR Film Look receives the same exposure as HDR, Match also fits highlight colour. |
| T1-e | **Offer both:** add a fixed cap mode and keep Peak Fit (plus Soft Ceiling and Clip) unchanged, so Steve can test and compare. Existing Highlight Compression behaviour and saved settings must not be lost. |
| T1-f | SDR highlight compression moves after Film Look and finishing. |
| Anchor | Coordinator's choice (Steve deferred it): tone zones are measured from **photographic mid-grey = 18% of the lane's reference white**. In this app scene 0.18 is the reference/diffuse white (203 nits in HDR; 100 of 203 nits in generated SDR), so Center 0 = 36.5 nits in HDR and 0.18 × (100/203) display-linear in SDR. This keeps HDR and SDR zones at the same place relative to Steve's 203-nit white (today they differ by about 1.5 stops), and puts Midtones on mid-grey instead of on white. Exposure runs before the block, so badly exposed RAWs are corrected first; the range display shows where each zone lands. Implementers verify the SDR reference constant in code. |
| T1-b | Narrow Whites. |
| T1-c | Local Tone gets the same curves in the same change. |
| T1-d | Clipping/range preview first; Auto later. |
| C4 | HDR and SDR colour wheel ranges aligned as part of the tone work. |
| X1 | Local Match promises the same *change*; build after the Local Tone/Match work. |
| X2 | Build "Start HDR from SDR" after the tone and colour work. |
| P5 | No Lensfun rewrite for now. |
| Push | Push the branch to GitHub as a backup. |
| U11 | Not answered; still open. |

**Overnight plan (Nov 15–16), in order; Steve tests the app in the morning**

| Step | Work | Depends on |
| --- | --- | --- |
| N1 | Highlight Compression: add the fixed cap mode beside Peak Fit, Soft Ceiling and Clip; move SDR HC after Film Look and finishing. | — |
| N2 | **Built and checked:** global five-control Tone before Film Look, frozen guide, photographic-grey anchor, combined limiter, Whites UI; aligned colour wheel ranges (C4). See result below. | N1 |
| N3a | **Partial:** Local Tone shares N2 curves and local Match proposals use the real renderer; equal-Film-input/highlight-colour rebuild stopped after failed unchanged-gate probes (M1/M1d open). See result below. | N2 |
| N3b | **Built:** clipping and gated neutral-ray range preview (T1-d), Auto deferred. See result below. | N2 (parallel with N3a) |
| N4 | **Built, scoped:** X1 per-parent local Match SDR; acceptance and N4 results below. M1/M1d remain open. | N3a |
| N5 | **Not exposed:** X2 body/family fit misses acceptance; safe research prototype and measurement report only. | N4 |
| N6 | Final review, fixes, brief/PRD updates, push. | all |

### N6-A/B result: exact ceiling and sharp-highlight diagnosis (November 16)

**Awaiting full Still-strict validation.** Steve limited this run to about
30 minutes of slow checks because he is using the 8 GB Mac. No push.
Implementation: `0a524303`; follow-up diagnostics/validation commits follow.
No encoder/gain-map setting, tolerance, perceptual gate or memory limit was
loosened. Other workers' UI changes remain outside these commits.

**A — exact target.** The incumbent float32 target and the ACEScg↔BT.2020
round trip can round up. CPU now rechecks after the complete incumbent final
boundary, including both Clip calls, and lowers only overshooting pixels.
Placing that check inside the first Clip call initially changed the second
call's branch; the 18-array comparison caught it, and the final placement fixes
that before commit. WebGPU rechecks its final round trip, using authored nits
in previously reserved parameter 147 without changing any curve parameter.
SDR's existing final gamut boundary already stays at or below 1.0.

Same-run pre-change/current comparison: 18 arrays (HDR/SDR × Peak Fit/Soft
Ceiling/Clip × three exposure grades), deterministic seed 817 / 24×64 RGB
uniform 0–3, enabled HC, 600-nit target, Softness 60, exposure 0/.3/.6 EV.
**600.000061 → 600.000000 nits**; 71 HDR pixels change by at most
1.192093e-7 scene units (about .00014 nits). Every previously compliant pixel
and all nine SDR arrays are byte-identical. `exact-before-after.json`.
The full shader exercises 256 HDR/SDR/reference/target/mode/colour cases with
float32 readback and no overshoot. CPU covers both reference whites, every
mode/colour trajectory, 203/600/1000/4000 plus a fractional target. Real codec
checks cover 48 mode/target/format combinations: 44 deliver under target;
four AVIF/203-nit cases hit the existing ISO decoder equal-headroom refusal
and deliver no file. Those four are safe-refusal checks, **not** encoded colour
or successful delivery qualification. The decoder limitation is still open.

**Reverted the same day:** the worker also set the encoded allowance from 1%
to zero, because the brief wrongly asked for checks "after encoding". Steve
had only approved fixing the float overshoot, and the 1% encoding allowance is
his November 14 decision, so the allowance is back to 1%. Encoded files
between the target and target + 1% are again accepted unchanged. A zero
allowance remains an option for Steve to decide separately.

**B — the sharp check measures decoded export against decoded export**, not
preview against export. `local-sdr-match.js --headroom --diagnose` captures
the GPU's finished float32 readback and the exact authored document, rebuilds
the CPU result from the same interpreted source, compares both floats and
both decoded Ultra HDR exports, and still enforces the original gate.
HDR is ΔE ITP; SDR is ΔE 2000; mean <1 / P99.9 ≤3 is unchanged.

Matched fixture: finished float HDR **.030745/.113321**, SDR
**.013358/.052095** (mean/P99.9); both float HDR peaks **1000 nits**.
After input quantization, HDR half-float **.033964/.135368**, SDR 8-bit
**.039740/1.022045**: both still pass. 12,291 of 30,720 HDR channels and
774 SDR channels quantize differently. Decoded delivered outputs fail:
HDR **.877670/7.980648**, SDR **.152682/3.370376**. The first pre-change run
was HDR **.878005/7.980648**; the ceiling repair does not fix this failure.
The shared delivery renderer agrees before encoding; the measured failure
enters through JPEG/base and gain-map processing, not HC/Film order or a
post-cap sharpening stage (this fixture requests sharpening off).

One-factor codec probes use those same captured float arrays, before local
ceiling correction; their normal initial HDR P99.9 is **7.882** and its decoded
peak is 1051.57/1052.36 nits (GPU/CPU). Holding SDR identical gives **5.695**;
holding HDR identical **8.849**; holding both identical **0**. Thus the codec
is deterministic, but both small input differences contribute. Bypassing only
the gain-map filter gives **5.957**; quality 100 for base/map **5.956**; map
quality 100 alone **7.292**; fitting against the decoded base alone **8.333**.
None passes. SDR quality 100 still gives P99.9 **3.077**. The initial encoder
probes deliberately bypass final ceiling correction to isolate those factors;
only the normal delivered results above are delivery qualification.

**Decision still needed for B:** retain the strict failure and investigate a
broader codec/gain-map quality change, or choose a common finished renderer
for delivery (identical inputs measure zero, but performance and native/photo
qualification are unmeasured). Simply raising quality or removing filtering
is not a demonstrated fix. No such production change or gate relaxation was
made. Existing edits keep their codec/settings; M1/M1d remain open.

Evidence under `codebase/output/review/n4-local-match/`:
`sharp-matched-stages.json`, `sharp-matched-floats.npz`,
`sharp-codec-bisect-final.json`, and the exact/driver logs. The diagnostic
helper is reproducible without a GPU after capture:

```sh
PYTHONPATH=backend .venv/bin/python tests/helpers/local_delivery_diagnostics.py --codec-bisect output/review/n4-local-match/sharp-matched-floats.npz
```

**Scoped validation (MacBook Neo / A18 Pro / 8 GB / 1408×794):**

- Focused CPU/real-codec tests: 266 passed; final read-only decoder consolidation:
  six passed. Node highlight/layout subset: 18 passed. Shader/anchor driver:
  256 exact-ceiling cases pass; an intermediate scheduler interaction was
  superseded, then the final invocation passes without changing any gate.
- `hdr-ceiling-delivery.js`: all three codecs × CPU/GPU × export/reduced/full
  Proof pass. Decoded peaks 971.983–999.880 nits at target 1000; full Proof
  bytes equal export in every codec/renderer pair. `exact-all-codec-proof.log`;
  detailed rows `output/ceiling-followup/delivery.json`.
- `tone-zones-delivery.js`: finished floats pass (HDR .025382/.092793,
  SDR .006448/.027817); both Proof sizes equal export, decoded peak 986.782
  nits. Its report-only decoded-HDR P99.9 remains **10.881**, not a colour
  acceptance pass despite exit zero. `gpu-delivery-smoke.js` also exits zero
  under its Denoise gate, but its stricter HDR P99.9 remains **3.262**, not a
  strict delivery-colour pass. No gate or verdict was changed.
- `local-sdr-match.js` smooth fixture: decoded HDR .360/2.847 and SDR
  .142/2.135 pass; full Proof bytes equal export on both renderers. The
  separate sharp `--headroom --diagnose` run still exits one as required.
- Default 90-second Library viewport check exits zero, no errors; nine of 33
  eligible photos pictured, two GPU developments, five stored pictures readable.
  This is viewport coverage, not a whole-folder pass. CPU fast tests did not
  overlap it. `output/quick-library-check/exact-highlight-ceiling/report.json`.
- Fast Node: **1,071 passed / 12 failed / one skipped**. All failures are in
  `grade-paste.test.js` under concurrently edited UI code (timer/picker state
  assumptions); no ceiling/layout failure and no unrelated repair or rerun.
- Fast Python full run: **3,800 passed / two failed / 144 skipped / one
  xpassed** (266.19 s). Both failures expected the superseded 1010-nit
  allowance in `test_export_parity.py`; expected allowed nits are tightened
  to 1000 under Steve's approved policy. Final focused ceiling/export-parity
  run: **287 passed**. The broad suite was not repeated after that test-only
  expectation change; no unrelated Python failure remained.
- Output size starts/ends at **13.0 GB**, below 100 GB. GPU runs use the shared
  venv lock, one at a time; no unowned Electron process was killed. Generated
  native-codec scratch/profiles are removed; small referenced diagnostics remain.

**Still unrun: exactly 19 of the selected 23 export/Proof drivers.** The four
run are `hdr-ceiling-delivery.js`, `tone-zones-delivery.js`,
`local-sdr-match.js`, and `gpu-delivery-smoke.js`. No full Still-strict or
release claim; Steve approved deferral of the remainder on November 16.
From `codebase`, define the common serial launcher (Mac settings shown):

```sh
gpu() { HDR_FINISHER_ELECTRON_WINDOW_SIZE=1408x794 .venv/bin/python tools/gpu-run-lock.py --label overnight-ceiling -- node tests/run-in-electron.js "$@"; }
```

Then these are the outstanding commands, one driver per line (the HSL driver
also needs its local variant):

```sh
gpu tests/hsl-selection-delivery.js
gpu tests/hsl-selection-delivery.js --local
gpu tests/color-desat-delivery.js
gpu tests/hue-mask-delivery.js
gpu desktop/tests/proof-grade-diagnostic.js
gpu tests/gpu-denoise-measurement.js
gpu tests/local-detail-film-parity.js
gpu tests/export-file-browser-interaction.js
gpu tests/export-presets-interaction.js
gpu tests/performance/export-parity.js --output output/review/n4-local-match/overnight-export-parity.json
gpu tests/performance/preview-export-compare.js --enforce --project "/Users/stevenfuncke/HDR Finisher Tool/Photos/HDR Test Images/Projects/DSC00950.hdrfinisher" --output output/review/n4-local-match/overnight-preview-export.json
gpu tests/proof-size-interaction.js
gpu tests/batch-export-ui.js
gpu tests/library-export-menu.js
gpu tests/gpu-delivery-repeat.js
gpu tests/gpu-delivery-ceiling.js
gpu tests/edge-colour-raw.js
gpu tests/gpu-edge-colour.js
gpu tests/hsl-integration.js
gpu tests/photo-framing-delivery.js
```

The DSC00950 project's saved source is Windows-only; the exact selected
command above is unrun on this Mac. Schedule that driver on the PC with its
shared project path, or first supply a separately approved portable fixture;
do not rewrite the protected project. On the PC use its venv Python/window
size in the launcher. The plan's timing estimate is incomplete (11 minutes
for six drivers, 17 without history), so this list is not a promise that the
remaining overnight selection fits 30 minutes.

### N5 acceptance proposed before measurement (November 16)

X2 compares finished SDR display-linear sRGB with finished HDR converted to
linear sRGB and scaled by `R / (0.18 × 203)`, using the shared project
reference-white context. Thus both pictures are in nits / 203, not two
independently normalised pictures. Capture the SDR target once (including
its authored base). Freeze the body selection from that target: finite,
luma .005–.9 and all channels below .98, at least 64 pixels. Do not change
the selection during fitting. Analysis excludes stochastic grain, not Film
Look; the delivered recipe retains its normal grain controls.

Require median/P95 absolute luma ≤ .010/.030 and OKLab distance ≤ .015/.040
both overall and separately for red, yellow, green, cyan, blue, magenta and
neutral families with at least 16 body samples. Report smaller families as
insufficient coverage, never as passes. These retain Match's normal body
limits, adding family gates so aggregate success cannot hide denim shifts.
No existing forward-Match gate changes. Test Film off and Portra 400 at 50%
on synthetic neutral/coloured ramps and all five named shared RAWs.

For a dense 1/64-stop ramp through body and highlights, require finite
output, nondecreasing luminance (roundoff ≤ 1e-6), and no adjacent output
step above .1 EV; report cap-flattened samples separately. This rejects a
body/highlight splice or highlight reversal without imposing an impossible
positive slope after a hard delivery cap. Check the exact BT.2020 delivery
channel ceiling at the preserved HDR target (only encoder rounding allowed).
Retain an enabled HC mode/settings; if bypassed, use Fixed cap with Start
80% of the retained target: it is scene-peak-independent and its common
RGB gain avoids a new colour trajectory. Explain that cap activation in
the overwrite confirmation. SDR, shared masks and other source state must
remain unchanged; successful application is one revision-guarded Undo.

Qualification is a ship gate, not permission to widen tolerances: if these
cannot be met in this overnight step, retain only an unexposed prototype,
with no user-visible button or public mutation endpoint. Native/encoded
qualification and the two app layouts remain required before enabling it.

### N5 result (November 16, MacBook Neo / A18 Pro / 8 GB)

**X2 is not exposed.** On N4 `bd68ece2`, acceptance was committed before
measurement (`2a136941`). The bounded research fitter preserves SDR/masks,
seeds ordinary HDR creative controls, translates wheel tint vectors directly
SDR→HDR, and fits ten visible tone/colour controls against a fixed physical
body selection. It retains the HDR target and enabled HC mode/settings;
bypassed HC seeds Fixed cap at Start 80% of the retained peak. That choice
avoids dependence on a scene peak and uses a common RGB gain. Film is rendered
normally once, not inverted. No new production rendering stage is added.

**Eleven of twelve body/family cases fail** on synthetic scenes and the five
named shared RAWs, Film off and Portra 400 50%. Synthetic Film-off median/P95
luma is .033791/.103280 and OKLab .056670/.120644, beyond the unchanged
.010/.030 and .015/.040 gates. IMG_7723 Portra passes aggregate metrics but
fails the neutral-family gate. IMG_7723 Film-off alone passes body/family
gates; its cyan ramp has ordering excursions down to -1.430511e-6, beyond
the frozen 1e-6 roundoff allowance. The other eleven dense-ray probes pass.
Thus no case qualifies the complete promise. No tolerance is widened.

All twelve 1000-nit CPU candidate proxy ceilings pass (largest channel peak
571.630 nits). Separate retained-mode probes at 600 nits detect 600.000061
for Soft Ceiling and Clip; the research ceiling detector marks both as
failures, without borrowing encoder allowance. These incumbent renderer
rounding results remain unresolved, not silently corrected or excused.
Four 128px synthetic Ultra HDR deliveries (two stocks/settings × CPU/GPU)
stay below 1000 nits; decoded peaks are 303.824–342.659 nits. Full-size Proof
is byte-identical to export within each renderer. This is delivery safety,
not perceptual CPU/GPU parity or native photographic qualification.

No button, tooltip, source-eligibility flow, overwrite confirmation, public
mutation endpoint, revision guard or X2-specific Undo action was wired. The
prototype is imported only by research tools/tests. Existing document-swap
Undo/Redo and unchanged SDR were checked in a disposable app session; they
do not establish the unbuilt X2 transaction. Existing screens at 1408×794
and 1100×720 have no X2 button or horizontal overflow. No UI tokens change.
All 1,080 forward wheel translations are exactly unchanged against N4.
**M1/M1d remain open.**

Validation: final Node fast suite **1,071 passed / 1 skipped / 0 failed**;
final Python fast suite **3,577 passed / 144 skipped / 1 xpassed**, with one
existing Starlette deprecation warning (240.48 s). Focused Python checks
**62 passed**. The new Electron driver passes after an intermediate repeat
correctly refused an existing export destination; fresh per-run directories
fix the harness repeat without permitting overwrites. Every Electron/GPU
run uses the venv Python GPU lock, one at a time. The 90-second Library check
exits zero with no reported errors, two GPU developments and five readable
stored pictures, but shows only **9/33 eligible pictures**: incomplete
coverage, not an all-photo Library pass. Unrelated concurrent tone-preview
edits were present during the final fast checks and are left untouched.

Not run/built: native/full-resolution photo deliveries, other HDR formats
and stocks, full photo coverage of every HC mode, perceptual CPU/GPU fit
parity, integrated denoise/repairs/captured-match grain, native masks/detail,
photo fits at HDR reference 100, X2 consent/eligibility/Undo, broad release
sweep, installer or push. Failed body gates make further slow qualification
premature. Output usage is **13.0 GB at start and end**, below 100 GB. Safe
prototype commits: `919db5cd`, pivot-unit correction `0314c900`, repeatable
driver destinations `e027a097`.

Detailed measurements/limitations: [N5 report](../reports/n5-start-hdr-2026-11-16.md).
Artifacts: `codebase/output/review/n5-start-hdr/measurements.json`,
`app-check.json`, `unexposed-1408x794.png`, `unexposed-1100x720.png`.

### N4 acceptance agreed before measurement (November 16)

Local Match fits the difference between mapped finished HDR with the parent
on and neutralised, added to finished SDR with that parent neutralised; SDR
globals and other locals stay fixed. Acceptance uses whole-Match body metrics
restricted to effective mask coverage: median/P95 absolute luma ≤ .010/.050,
median/P95 OKLab distance ≤ .015/.040, plus mean/P95 ΔE2000 ≤ 1/3 on that
region, because the promise is a perceptually small error in this local change,
not a new global grade. Empty/disabled/negligible support makes no edit;
failure retains the old SDR local. No existing whole-Match gate changes.
Non-body covered pixels must also pass mean/P95 ΔE2000 ≤ 1/3; highlight
compression is not permission to accept a bad local fit. Synthetic overlap,
Film/cap and two shared RAWs (gradient/brush and hue) qualify the action.

### N4 result (November 16, MacBook Neo / A18 Pro / 8 GB)

Built on N3a `034c55c4`; the acceptance was committed before measurement in
`22c2d0f3`. Local **Match SDR** names the parent, including when a child mask
is selected. It replaces only that parent's SDR grade and match snapshot in
one Undo step, never stacks on rerun, and leaves global SDR, other locals,
HDR flags/settings, masks, geometry, feather/blend/opacity, IDs and order
unchanged. Detail copies without optimisation; fitted local curves stay
identity. A poor fit/no-op retains previous settings and history. Later recipe,
mask or stack edits show **Out of date**, without automatic rematching.
Whole-picture Match still replaces all SDR locals, now with overwrite consent
for individually matched or non-neutral SDR grades. No new design tokens,
render stage, Match gate, delivery tolerance, memory limit or Library dataset.
**M1/M1d are not solved.** X2 was not implemented in N4.

Measurements (`codebase/output/review/n4-local-match/measurements.json`):
18 bounded real-renderer cases, synthetic and shared **DSC00264.ARW** /
**IMG_3129.CR2**, gradient/brush/hue, Film off and Portra 50%, independent SDR
global −0.15 EV and another overlapping local. **16 accepted, two refused.**
Among accepted cases, worst mean/P95 Delta E 2000 = **0.751 / 1.525**;
worst median/P95 luma = **0.003689 / 0.010379**, OKLab =
**0.004579 / 0.009639**. All fit inputs remain unchanged. IMG_3129's brush
refuses with mean/P95 Delta E **1.383 / 4.057** (Film off) and
**1.201 / 3.102** (Portra); previous SDR settings remain. This is safe refusal,
not a claim that every brush can be matched. Both body and non-body Delta E
are gated; the reported values take the worse covered region. Proxy success
is not native-size visual qualification.

Real app: selected child resolves to “Window light”; exact saved-document
comparison proves unchanged globals/mask/HDR; one Undo/Redo, stale marker,
whole-Match Cancel and SDR-only visibility pass. Screenshots are in
`codebase/output/review/n4-local-match/`: `matched-1408x794.png`,
`matched-1100x720.png`, `undo-1100x720.png`, `out-of-date-1100x720.png`,
`whole-match-confirmation.png`; metrics/checks in `interaction.json`.
The app check caught and fixed marker acknowledgements being lost while
optimistic local edits were retained. Derived peak-readback noise is excluded
from snapshot identity; its authored inputs still invalidate the match.

Finished delivery on the bounded smooth fixture passes unchanged mean <1 /
P99.9 ≤3 gates: HDR Delta E ITP **0.360 / 2.847**, SDR Delta E 2000
**0.142 / 2.135**. Native-size (96×64 fixture) full Proof is byte-identical
to export on GPU and forced CPU; decoded HDR peak **595.81 nits** under the
1000-nit cap. `delivery.json`. The direct local GPU/export reference also
passes **48 cases / 384 pixels**, unchanged 0.00002 linear limit.

Additional sharp/headroom fixture delivery **does not qualify** at the same
gates; neutral-SDR baseline HDR mean/P99.9 is **0.656 / 6.179**, matched HDR
**0.878 / 7.981**; baseline SDR **0.063 / 2.987**, matched SDR
**0.153 / 3.370**. Retained `headroom-baseline.json` and
`headroom-matched.json` report the exact results. This is not waived or
fixed here; Proof/export byte identity still passes. The baseline run reports
diagnostics only (exit zero is not colour acceptance). Reproduce with the
same app driver plus `--headroom --baseline` or `--headroom`.

Validation: fast Node **1,069 passed / one skipped / zero failed**; fast
Python **3,560 passed / 144 skipped / one xpassed / zero failed**. Focused
`test_sdr_local_match.py`, `test_sdr_match_materialization.py`,
`test_sdr_match_state.py`, `test_proof_export_identity.py`: **57 passed**.
These include no-op/refusal history, fresh rematch, stale-fit revision conflict,
saved-project roundtrip, mask/global/HDR/other-local/reference staleness and
exact Undo. Six local frontend behavior checks include preserving newer
strokes while merging status, parent targeting, overwrite cancellation and
late-response rejection. UI, local GPU reference and default 90-second Library
viewport check pass. Library covered 9/9 visible pictures (not the unvisited
24), no app/photo/memory failures; longest drawing gap 50 ms, external peak
3.137 GB. Fast suites overlap the Library run's tail, so this is not isolated
timing evidence. Logs are retained beside the review JSON/screenshots; Library
report is `codebase/output/quick-library-check/n4-local-match/report.json`.

**Not run:** full-size shared-RAW Proof/export after an individual local fit;
`hsl-selection-delivery.js --local`, `hue-mask-delivery.js`, the all-codec
`hdr-ceiling-delivery.js` matrix, every Film stock/strength, broad 23-driver
export/Proof selection, full release/endurance/performance sweeps, packaged
builds or Windows/Linux checks. Kept to the directly covering subset under
the overnight slow-test budget: export/Proof plan history already estimates
11 minutes for only six of 23 drivers, with 17 unknown durations; no claim
that its incomplete estimate proves the rest fits inside 30 minutes. Local
grade output reference, smooth CPU/GPU delivery, encoded Proof identity and
the two-RAW finished-proxy measurements ran instead. The sharp/highlight
native failure above remains an explicit qualification limitation, not a pass.

Both protected DSC00264 projects retain their starting SHA-256 hashes. The
Windows-only DSC00950 source-linked project was not opened or overwritten.
Output size starts/ends at **13.0 GB**, below 100 GB; failed-run disposable
profiles and generated export scratch are removed, referenced review evidence
is retained. Work is committed locally on `feat/watermark-and-library-polish`;
no push. Implementation commit: `a167931b` (following acceptance `22c2d0f3`).

### N3a result (November 16, MacBook Neo / A18 Pro / 8 GB)

**Partial: Local Tone built; HDR→SDR colour shifts are not fixed across
colours, with or without Film Look.** The equal-Film-input/highlight-colour
portion stopped after the bounded probe failed unchanged acceptance gates.
No unsafe candidate or hidden Match-only renderer was installed. No gate,
tolerance, memory limit or frozen Library dataset was loosened. N4 must not
assume M1/M1d is resolved.

**Built:** Local Exposure/Contrast freezes each layer's guide, then the same
N2 five-control curves/limiter run before colour/HSL/curves/wheels/detail and
mask × opacity. Local Whites and all three Center/Width pairs reuse global
components/tokens/units; parent D/G/P is passed through CPU/direct GPU/tiled
and delivery paths. Lane-specific defaults/reset work in HDR and SDR. LOCAL
parameter slots grow 23→34 with old slots retained; finished thumbnail/screen
versions advance v7/v6. No persistent full-frame guide or migration renderer.
Code commit `449a71ed` includes the Local UI, layout/reference checks and
shared CPU/WGSL curves. The obsolete `fn toneZones(` source-name assertion
was replaced by actual GPU compile/reference coverage, not a tolerance change.

**Safe Match adaptation:** bounded local proposals call the real shared local
renderer, preserve each HDR grade's own enabled flag and inherit the parent
HDR target/reference. Full recipes still pass through real Film → final HC/cap
→ gamut certification. GPU-explored candidates get at most three conservative
CPU RGB-residual refinement passes rather than one, with the same improvement
predicate and sparse/editable curves. Global neutral/body fitting still uses
pre-Film controls; equal Film input and highlight-colour fitting remain open.

**Measured stop:** the equal-global-exposure / captured-prefix / real-tail
four-mode-plus-print search returns body P95 OKLab .067320 / .062441 / .068645
for Portra / Ektar / Velvia 50%, above the unchanged .050 colour ceiling.
Film-input median/P95 absolute luma gap remains .001325/.118722; this is not
exact equal input, nor proof that no solution exists. Film-off probe .003961
body OKLab was not fully white-area/+.5-EV/editability certified. A separate
production-style tail-only experiment retains those guards but still changes
Film input, worsens Portra body P95 .025318→.025833, and costs more; discarded.
Both mode searches select Soft Ceiling, so retain N1's Match choice; ordinary
SDR default remains Peak Fit. Further visible/editable post-Film colour or
better prefix fitting needs implementation, not a gate waiver.

**Comparisons:** all seven hues × 45/75/100% saturation × −4…+3 stops plus grey,
Film off and Portra/Ektar/Velvia 50%; independent 176- and 224-patch fits. Five
shared RAWs A7R00619 / DSC00264 / IMG_3129 / IMG_0790 / IMG_7723 use identical
≤512-edge decoded arrays. Inherent / residual / total whole-image/per-family
results compare `55e8bb5f`, pre-N1 `541dc130`, pre-N3a `5bc997f3`, final.
Final and pre-N3a global-only CSV metrics are byte-for-byte equal: no claimed
colour improvement or regression from the safe local adaptation. Final
176-chart coloured residual median/P95 ΔE00: off .118/8.229; Portra
1.734/13.484; Ektar 1.919/13.579; Velvia .505/11.533. Wide Film charts still
refuse, as do IMG_0790 off and IMG_7723 Portra/Ektar. Failed fits have no
residual/total output. Full tables and failed-probe numbers are in the existing
[M1 report](../reports/m1-colour-follow-up-2026-11-15.md#november-16-n3a-local-tone-built-colourfilm-rebuild-stopped);
reproducible scripts, states, CSVs and hashes are under
`codebase/output/review/n3a-match-2026-11-16/`. Research uses the real CPU
renderer, not native-size/encoded-export colour qualification.

**Validation:** every Electron/GPU run uses the shared GPU lock, sequentially.
Latest N3a Node suite 1,062 pass / one skip / zero fail; Python 3,543 pass /
144 skip / one unexpected pass / one unrelated Starlette/httpx deprecation
warning (272.72 s). `local-grade-reference.js` passes 48 cases / 384 pixels,
including parent reference/target, five controls, floor, opacity, and real
Local HDR/SDR panel bounds at 1408×794 and 1100×720. Existing 2e−5 numerical
limit unchanged. `tone-zones-delivery.js` (Peak Fit), 1,245-vector SDR gamut
parity, delivery/Proof smoke, Proof size interaction, and all 33 SDR Film
stock cases pass their enforced checks. Tone delivery retains the known N2
report-only encoded-HDR mean .538241 / P99.9 10.880558; this is **not** an
encoded-HDR quality pass. Delivery smoke likewise has report-only HDR values.
Actual browser Match fails before Match with `Could not prepare the HDR Match
browser fixture.`; known pre-existing block, not a new Match pass. Quick
Library first run hits the memory reserve during concurrent CPU research;
one permitted isolated retry passes all nine pictures, first picture .3 s,
90 s, no errors. Frozen `library-mixed-v1` and limits unchanged. Evidence:
`codebase/output/n3a-validation/` and
`codebase/output/quick-library-check/n3a-isolated/report.json`.

**Not run:** full release/sweep/endurance/broad timing; all four delivery HC
modes again (N2 already covers these); full-resolution/native five-RAW encoded
colour matrix; successful browser Match (fixture blocked); complete Film-off
probe white-area/+.5-EV/editability certification; Windows/PC GPU/packaged app;
Steve's visual sign-off. Slow checks stayed below the ~30-minute budget.

**Affected stored work:** nonzero local Tone and materialized local Match
recipes now render differently; new Match/Rematch local proposals change.
DSC00950 has three nonzero HDR and five nonzero SDR local Tone grades. Both
DSC00264 four-mask/fifty-local projects have zero local Tone, so no new N3a
Tone-only change. All three protected file hashes remain unchanged. Generated
local-tone/reference probes and calibrated `hdr_match_scene.tiff` render
expectations change; source fixture bytes do not. No conversion/migration.
Output size starts/ends at 13.0 GB (100-GB limit); own backend copies/RAW-array
and solver scratch are removed after retaining the cited compact evidence.
Local commits only, no push. N3b changes are committed separately by its worker.

### N3b result (November 16, MacBook Neo / 8 GB)

**Review fixes (November 16):** accepted-path drag-start snapshots survive direct/tiled and cold preparation; disabled HDR/SDR local grades suppress range diagnostics; grain/order docs corrected. Node: 1,071 passed/one skipped; Python: 3,577 passed/144 skipped/one xpassed; locked overlay checks prove four baseline captures/new-endpoint pixels, identical finished pixels/recipes and byte-identical GPU exports (test startup now establishes delivery before comparison; synthetic gestures no longer enter the real slider handler); locked Library smoke passed. Diagnostics/docs only; no grading/export code changed; local commit, no push.

Built beside N3a in the shared checkout after N2 `5bc997f3`. Preview-only
files are separate from the grading/local/Match shaders and UI. Local Tone
controls are recognized generically, including N3a's new Whites. No Auto,
new UI token, export setting or saved-recipe change. Not pushed.

Hover/drag shows the effective **pre-look neutral-ray** range, actual endpoint
gates and combined limiter. Local range includes opacity but is explicitly
before spatial mask; this is not a saturated-pixel or mask map. Alt/Option-drag
Blacks/Whites shows the **finished post-look/post-cap** result: SDR black/white
backgrounds, existing RGB channel tokens for measurable final-cap loss, pale
endpoint-only marks and dashed new-endpoint marks against drag start. Reaching
an endpoint is not automatically lost detail. HDR adds separate 100-nit SDR
white, reported primary-display overrange and HC-target-guide marks. Unknown
display telemetry is labelled unknown.

The GPU diagnostic uses the existing accepted scope source, with a baseline
and canvas limited to long-edge 640 (maximum 3.125 + 1.563 MiB plus parameter
buffers), registered in the GPU allocator and released on exit. Existing
tiled scope-proxy support is wired, not yet qualified; CPU preview retains
the parameter-only range and reports clipping unavailable. No full-resolution
cache or new CPU image renderer. Sampling can miss isolated clipped pixels;
white contact uses 0.1% of P to accommodate half-float storage. No output
tolerance was relaxed.

Validation/evidence so far:

- `node --test tests/*.test.js`: 1,063 passed, one skipped, zero failed.
  Five dedicated model tests also pass. The initial run's two layout failures
  were N3a's in-flight shared layout changes and disappeared after its update.
- Real Electron/WebGPU, GPU lock, 1408×794 points: both lanes/all five controls
  plus Center/Width; global and local Blacks/Whites; Alt release and workflow
  cleanup pass. Tiny direct GPU fixtures verify contact versus actual cap loss,
  channel identity and dashed new red/green/blue endpoints. Accepted finished
  float pixels and recipe are exactly unchanged on the synthetic ramp.
- Synthetic 512×256 fixture, 12 live inputs/lane on this Neo: HDR median 33.3 ms,
  p95/max 47.3 ms; SDR median 33.1 ms, p95/max 39.5 ms, input to matching accepted
  overlay at an animation frame. This is not a full-resolution speed sweep.
  Existing Grade visible-slider budget remains p95 ≤50 ms.
- Locked 90-second `quick-library-check.cjs --label=n3b-clipping`: exit 0,
  zero errors/failures; viewport sample only (9/33 eligible photos pictured).
- Latest full Python snapshot: 3,540 passed, 144 skipped, one xpassed, three
  failures: two native-upload memory-admission tests while GPU/other validation
  was active, and N3a's in-progress parent-target/reference Match translation.
  Isolated rechecks and the real-photo/export result follow in the completion
  note; no unrelated backend changes made by N3b.
- Small viewer crops and bounded logs:
  `codebase/output/review/n3b-clipping/{hdr,sdr}-{whites,blacks}.png`,
  `result.json`, `gpu.log`, `library.log`, `node-final.log`, `pytest-final.log`.
  Photographic follow-up writes `photo/` and `photo-gpu.log` there.

Not run: broad GPU/driver sweeps, installer/release suite, PC checks, physical
HDR-display telemetry validation, tiled stress, CPU clipping image fallback or
full-source clipping certification. No additional colour approval needed;
existing semantic scope RGB/luma, accent and attention tokens are used.
Black/white are diagnostic data endpoints, not new interface colours.
**Completion:** implementation `b63e09a5`; initial documentation `dd407e67`.
The two native-upload admission failures both pass in isolation (2 passed,
0.45 s); the remaining full-suite failure was N3a's still-changing Match
translation test, outside N3b. Latest Node suite: 1,063 passed, one skipped,
zero failed (1,064 total). No backend/test fix belonging to N3a was staged.

Locked real-photo follow-up passes on shared `DSC_3931_01.jpg` (2000×1168),
with both lanes, all Tone hover/range controls, local endpoint gestures, Alt
release and workflow cleanup. Direct GPU readback also checks HDR's three
different threshold marks. At the **same accepted source serial**, toggling
the overlay preserves finished float pixels and the recipe exactly. Actual
128-pixel Ultra HDR exports made with the overlay off/on are byte-identical
in each lane. No rendered/exported pixels changed. The first photo assertion
incorrectly compared a forced 512-pixel frame with a later normal-resolution
frame; the corrected test requires the same accepted frame, not a relaxed
pixel tolerance. Export test paths are unique and disposable.

Neo real-photo interaction (12 live Whites inputs/lane, 1408×794-point app,
input to matching accepted overlay at the next animation frame): HDR median
32.55 ms, p95/max 46.2 ms; SDR median 33.5 ms, p95/max 36.9 ms. Both are below
the unchanged 50-ms Grade slider p95 budget on this photo. Overlay command
submission is at most 0.2 ms in this run; queue completion includes shared
renderer work and is not an isolated GPU pass time. This does not qualify
large RAW/tiled throughput or physical HDR presentation. Actual diagnostic
baseline 640×374 = 1,914,880 bytes, plus 957,440 canvas bytes and parameters;
no new full-resolution allocation.

Final photo evidence: `codebase/output/review/n3b-clipping/photo/result.json`,
`photo/{hdr,sdr}-{whites,blacks}.png`, `photo-gpu.log`; admission recheck:
`pytest-admission-recheck.log`. Each Electron/GPU run (including Library)
used the single shared GPU lock. Focus stayed on this driver and the quick
Library check; no slow broad sweep was added. Scratch output is **13.0 GB
at start and end**, below 100 GB; evidence is about 1.3 MB. No protected
project or grading output changed. Still not pushed.

### N2 result (November 16, MacBook Neo / 8 GB)

Built locally on `feat/watermark-and-library-polish`, after N1 `5e4186e7`.
Commits: `d41fb79c` (global Tone/UI/C4), `0b56f666` (minimal Match
adaptation), `c943fe2d` (GPU qualification/inventory). Documentation is in the
following N2 documentation commit. **Not pushed.**

One global block now applies Blacks, Shadows, Midtones, Highlights and Whites
to one frozen entry guide: Y in working primaries, M in delivery primaries.
It follows Exposure Bands/foundation, before HSL/curves/wheels/locals/Film Look
in HDR, generated SDR and authored SDR. Early Blacks and the old global zone
pass are removed. Neutral-floor Blacks, top-stop Whites, endpoint-gated broad
zones and a conservative parameter-only combined interval limiter share the
CPU/GPU implementation. Zero is exact identity; negative Blacks may clip.
Whites alone maps P to .775P at −100 or 2P at +100 before the look. Final HC
still owns the delivery ceiling, including all four modes.

**Verified reference units:** HDR diffuse/reference white D=.18 scene-linear,
G=.18D=.0324 (36.54 nits at project reference 203; 18 nits at 100).
Generated SDR places scene .18 at D=100/203=.4926108374 display-linear,
G=.08866995074; authored SDR already uses these display-linear units and gets
no second placement. Checked against `SDR_SCENE_TO_DISPLAY_SCALE`,
`SDR_DISPLAY_REFERENCE_WHITE`, `GRAIN_DEVELOP_HDR_SCALE` and authored-SDR entry.
HDR P=HC Target × .18 / project reference white, even with HC bypassed; SDR
P=1. No monitor setting or photo statistics set these references.

| Default | HDR Center / Width | SDR Center / Width |
| --- | ---: | ---: |
| Shadows | −1.5 / 5 EV | −1.5 / 5 EV |
| Midtones | 0 / 4 EV | 0 / 4 EV |
| Highlights | +2.25 / 4.5 EV | +1.75 / 3.5 EV |

| Endpoint overlap (HDR Target 1000 / reference 203) | HDR | SDR |
| --- | --- | --- |
| Blacks ↔ broad, Y relative to D | 1.125–2.25% D; one stop | same |
| Whites starts, M relative to G | +3.7744 EV | +2.4954 EV |
| Broad ends, M relative to G | +4.2744 EV | +2.9954 EV |
| Broad ↔ Whites | half a stop | half a stop |

The design document includes the full neutral-ray overlap/weight table and
strength calibration. C4 uses log2(Y/G) for global and local wheels in both
renderers; identical Balance/Blending therefore selects the same relative
range. Match keeps its primaries translation. Its minimal adaptation recovers
median luma within the existing six-pass bound, adds two bounded Start
proposals, and allows one existing-style composed RGB residual at CPU
certification. The small remote-render offset fixture originally certified at
P95 OKLab .050473 (correctly rejected); the correction reaches .041832 without
moving any quality, white-growth, editability, normal/review or fallback gate.
This is not the N3a Match rebuild or a claim that M1 is fixed.

**Validation:** all Electron/GPU runs used venv Python `tools/gpu-run-lock.py`
from `codebase`, sequentially at 1408×794. Logs and eight layout captures are
under `codebase/output/n2-validation/`.

- Fast Node: **1058 passed, 1 skipped**, 10.56 s (`node-final.log`).
- Focused Match/Tone: **67 passed**, 3.80 s (`match-tone-final.log`).
- Full Python: **3536 passed, 144 skipped, 1 xpassed**, 217.47 s
  (`python-final.log`); no failures. The unexpected pass is reported, not hidden.
- Final Tone/remote-Match rerun after descriptive interval-operand naming:
  **34 passed**, 1.82 s (`final-focus.log`); no numerical behavior change.
- `tone-zones-delivery.js`: **passes all four HC modes**, strict finished-float
  perceptual agreement, full/reduced Proof matching each renderer's export,
  and decoded HDR ceiling checks. Combined fixture includes active Whites,
  broad zones, wheels and Film Look.
- `gpu-highlight-compression-parity.js`: **pass**, including scope and anchor
  refresh. `neutral-color-grading-reference.js`: **61 cases / 488 pixels pass**
  at unchanged 2e−6 max error, anchored wheel ramps and HDR/SDR Tone ±100/zero;
  exact zero GPU bypass rerun passes (`colour-reference-final.log`).
- `gpu-delivery-smoke.js`: **pass**, native GPU/forced CPU and Proof/export.
- UI: HDR and SDR five-control order/containment/reachability checked at
  **1408×794 and 1100×720**, existing tokens/components only. Full-resolution
  PNGs retained as `tone-{hdr,sdr}-{size}-{blacks,whites}.png`; Steve's visual
  sign-off remains his morning check.
- Isolated 90-second quick Library: **9/9 viewport pictures**, first **0.3 s**,
  no errors/memory violation, independent process-tree peak **2.941 GB**, below
  unchanged 4 GB. This is not a full survey of the 33 eligible photos.

| HC mode | HDR float ΔEITP mean / P99.9 | SDR float ΔE00 mean / P99.9 | Decoded HDR peak (1000-nit target) |
| --- | ---: | ---: | ---: |
| Fixed cap | .030057 / .100160 | .008365 / .044137 | 990.547 nits |
| Peak Fit | .025382 / .092788 | .006448 / .027817 | 986.782 nits |
| Soft Ceiling | .028017 / .099818 | .007803 / .077390 | 983.404 nits |
| Clip | .025477 / .099823 | .007740 / .100410 | 993.781 nits |

**Not all encoded perceptual diagnostics pass.** As in N1, encoded-HDR
report-only diagnostics exceed their percentile caps: Tone P99.9 ΔEITP is
10.8806–10.9097 (mean .5382–.8755); delivery smoke also reports a failure.
Finished-float comparisons, Proof identity and decoded ceilings pass. Those
diagnostics were neither loosened nor relabelled as passes. SDR decoded
perceptual checks pass. Optional SciPy/Matplotlib warnings and two resource
409s did not fail the GPU checks.

**Not run:** full focused-release/all-driver sweep, all-codec/native-size
`hdr-ceiling-delivery.js`, `gpu-delivery-repeat.js`, standalone
`proof-size-interaction.js`, the full 33-Film suite already run in N1, native
GPU Match/research matrix, a full Library photo survey/Single run, Windows or
packaged builds, native-size RAW/Film qualification, authored-SDR encoded
end-to-end delivery. Authored SDR has CPU shared-block coverage and direct
SDR shader references, not a separate encoded import/export qualification.
The covering overnight GPU subset stays within the requested ~30-minute
slow-test budget; no installer or push was requested.

**Intentional output changes / affected fixtures:** any saved/preset grade
with active global Blacks/zones or non-neutral global/local wheels; stored
Match recipes using those controls; newly generated editable Match recipes.
No migration renderer. `hdr_match_scene.tiff`, synthetic Tone `hues.tiff` and
colour-reference ramps have changed expected rendered output, not source
bytes. Protected `DSC00950.hdrfinisher` has active HDR/SDR wheel saturation and
will render differently; its Windows source URI still prevents a normal Mac
round-trip. Both protected DSC00264 projects have neutral affected global
Tone/wheels and are not expected to change from N2 alone. All three SHA256s
were rechecked unchanged against AGENTS.md; no project or source overwritten.
Finished thumbnails v6 and screen previews v5 invalidate only derived output.

Output scratch: **13.0 GB at start and end**, under 100 GB. Task scratch is
cleaned; evidence logs/layout captures remain. N3a still owns Local Tone and
the full colour/Film-exposure Match rebuild; N3b owns clipping/range preview.

### N1 result (November 15–16, MacBook Neo / 8 GB)

Commits: `9c2232d3` (additive Fixed cap and final SDR order), `4bb115f4`
(Match/finishing adaptation and expectation updates). Committed locally;
coordinator pushes. N2's Tone block/Whites/range alignment is not built here.

Fixed cap uses the proposed linear-light exponential: identity below Start,
unit slope at the join, positive non-expanding derivative above it, common
RGB gain driven by positive maximum BT.2020/sRGB channel, no peak reduction.
Peak Fit, Soft Ceiling and Clip retain their curves/settings/defaults. SDR HC
now follows Film Look, grain, resize and output sharpening, before the final
unconditional gamut mapper. Signed/above-white values survive the removed early
boundaries, including neutral/extended Curves. SDR sharpening's guide is
extended above white and a zero limited correction is exact identity. Existing
scaled half-float storage/reduction covers extreme SDR neutral-paper gains;
no memory cap, cache size, tolerance, gate or HDR target is relaxed.

New Match/Rematch recipes use existing Soft Ceiling (ordinary new SDR still
uses Peak Fit). Its final knee avoids Peak Fit's image-dependent body squeeze;
the bounded Start refinement keeps the existing body and +0.5 EV editability
gates. The approximate Local Tone proposal basis remains for N3a; every
candidate is certified through the real final tail. No hidden shoulder or
Match-only render stage is added. See `docs/technical/sdr-match.md`.

Final fast checks: **1,057 Node passed / one skipped; 3,526 Python passed /
144 skipped / one unexpected pass**, 235.80 s. Focused Match materialization,
state, input reuse and remote candidates: **38 passed**. Focused finishing:
**40 passed**. The full Python run passes with the original HSL cache/native
admission tests unchanged; intermediate runs under memory pressure failed
those identity/admission checks. Intentional expectation updates isolate
Curves/grain before the moved cap, compare gamut hue at its post-shoulder input,
expect Soft Ceiling in newly generated Match recipes, and replace obsolete
shader-order wording pins with pixel/device coverage. No numerical tolerance
was edited. One new test proves flat above-white pixels survive sharpening
when other pixels contain detail.

Sequential Electron/GPU checks, all through venv `tools/gpu-run-lock.py` at
1408x794: Highlight Compression/anchor parity; four `tone-zones-delivery.js`
variants (Peak Fit, Fixed cap, Soft Ceiling, Clip) with real resize and standard
sharpening; `gpu-delivery-smoke.js`; all 33 SDR `film-stock-parity.js` cases
(32 passed in the matrix; maximum-paper-gain fixed, then passes separately);
Fixed cap reduced and full-size Proof; and isolated default 90-second Library.
Finished SDR mean/p99.9 Delta E00 across the four modes is **0.00752–0.00891 /
0.03553–0.07618**; HDR Delta ITP **0.02642–0.03003 / 0.10344–0.11656**.
Velvia physical chain is **0.064951 / 1.024302** Delta E00, within its unchanged
0.125 / 1.065 limits. CPU/GPU Proof use the intended renderer; full-size bytes
agree with export. Fixed cap also checks the reduced Proof route. The delivery
fixture decodes to **988.707 nits** at Fixed cap's 1000-nit target. Peak Fit's
1002.616 nits is within the pre-existing 1% encoding allowance; no ceiling rule
changes. Encoded-HDR perceptual diagnostics still exceed their report-only
percentile caps; these remain diagnostics, not redefined passes.

The first Library run pictured all nine requested rows but failed the system
reserve while CPU tests were active. After CPU work released memory, the same
90-second check passes: **9/9 viewport pictures**, no errors or memory violation,
first picture **0.4 s**, independent process-tree peak **3.053 GB**, below the
unchanged 4 GB setting. This is viewport coverage, not a 33-file survey. Driver
startup now waits for the delivery window and its script before instrumenting
it; two cold-start setup attempts failed before rendering while this readiness
wait was being corrected. Product rendering and tolerances are unchanged by
that harness wait.

M1 was remeasured from baseline `2875c6a5`, using copied research scripts in
scratch outside the repo, both 176/224-cell populations and all five retained
<=512px RAWs, Film off and Portra 400 at 50%. **Mixed, not fixed:** 176-cell
Film-off residual P95 **13.577 → 8.229**, Portra **12.741 → 13.484** Delta E00.
224-cell green +2 stops / 75% saturation improves **23.189 → 2.079**, but
A7R00619 Film-off whole-frame P95 worsens **1.610 → 7.865**. New refusals:
224-cell Portra and IMG_0790 Film off; IMG_7723 Portra remains refused. RAW fits
accepted: **9/10 before, 8/10 after**. All gates unchanged. Full methodology,
per-family CSVs and before/after tables are appended to
`docs/technical/reports/m1-colour-follow-up-2026-11-15.md`; this is reduced CPU
research, not native-size or encoded-export colour qualification. N3a must
address the complete highlight-colour/Film-exposure fit.

Output changes: SDR grades with HC enabled; grades with above-white/signed
SDR colour formerly clipped by early gamut/Curves or output sharpening; saved
materialized SDR Match recipes through the new order. Derived fixture outputs
change for `hdr_match_scene.tiff`, `stock_hues.tiff`, the HC test pattern,
Tone delivery `hues.tiff`, and A7R00619 / DSC00264 / IMG_3129 / IMG_0790 /
IMG_7723 reduced sources. Finished Library thumbnail/screen versions advance;
source development and frozen `library-mixed-v1` files do not. No protected
project or source photo was written.

Not run to keep the directly covering overnight slow subset bounded: full
release/all-driver sweep, all-codec/native-size `hdr-ceiling-delivery.js`,
`gpu-delivery-repeat.js`, standalone `proof-size-interaction.js`, full HDR
Film/lens/tiled matrices, performance/endurance sweeps, or PC confirmation.
`sdr-match-gpu-interaction.js` was not rerun (known pre-Match fixture failure).
The actual real-device Match browser interaction remains N3a validation;
remote-candidate/CPU certification is covered by the 38 Python cases.

Evidence: `codebase/output/review/n1-highlight-compression/` (small CSVs,
scripts, manifests and final logs); isolated Library report at
`codebase/output/quick-library-check/n1-isolated/report.json`. Initial/final
output usage **13.0 GB**, below the unchanged 100 GB limit. Disposable baseline
code, reduced-source copies, render arrays and research scratch are removed.

**Recommended defaults, adopted unless Steve overrides**

- Open image gains the grid chooser only; opening a photo keeps today's behaviour (L4).
- Frame and Border both stay expanded in the compact Frame menu (U8).
- The full-screen marks overlay is display-only (U4).
- Right-click menu commands use the design guide's 14.5 px menu size (U6).
- The right-click menu appears at once; Revert items fill in a moment later (U7).
- Linked HDR/SDR paste choices show one checklist; two columns only when choosing separately (L3).
- Development launches on the Mac show the HDR Finisher icon (U12).
- The logo background keeps gentle, but smaller, rounded corners (U13).
- Pinned rows use the shared neutral hover background (U9).
- The insertion line also replaces whole-row highlights when reordering sidebar sections (U10).
- Reset stays hidden when a module has no changes (U3).

**Open, to ask Steve one at a time**

1. U11: which control looked odd: "Unpin folder" in the menu, the confirmation button, or "Remove" beside a saved location?
2. L1: after one tooltip has shown, should neighbouring controls in the same toolbar show theirs instantly for about 0.8 s, or should every tooltip wait 2.5 s?
3. L2: labelled controls: keep a tooltip for the keyboard shortcut alone, or no tooltip at all?
4. C4: should HDR and SDR colour wheels cover the same tonal ranges? This changes existing SDR looks. Ask after C1–C3 land.
5. T1 and M1: decisions from those research reports.

## Packages

Packages that touch the same files run one after the other, not in
parallel: W1 before W2 (shared paste, import and cache code); W1 R1 before
W3, W4 and W5 (shared processing code); W6 and W7 share stylesheets and
should be one worker or run in sequence. Only one GPU or Electron run at a
time on the machine, through `tools/gpu-run-lock.py`.

### W1: Fix problems in the November 15 PC changes (first)

Found by the code review of `f7c02993..55e8bb5f`. The rest of that range
looked sound: the stored-only paste picker, POST callers, cancellation
while waiting, reservation retention, whole-paste Undo, virtual copies and
saved SDR Denoise.

| ID | What's wrong (what we know) | Done when |
| --- | --- | --- |
| R1 | **Output change.** GPU keeps above-white SDR values through local Detail (`webgpu-shaders.js` ~2574); CPU clips local results to 1.0 (`local_adjustments.py` ~1545), and `apply_local_stack` clips the whole SDR frame before Film Look. Bright SDR + local Clarity/Sharpen + Film Look differs between preview and CPU export. | CPU and GPU follow the same headroom rule; an end-to-end local Detail then Film Look comparison passes within existing limits. |
| R2 | `library_cache.py` ~196: reconciliation records an obsolete-generation file against the current generation without checking its epoch, so a scene Refresh invalidated (but Windows could not delete) becomes valid again. | An invalidated or pending-delete file is never promoted; a test covers it. |
| R3 | Grade publishes a priority job and starts its import immediately (`import_jobs.py` ~96); paste notices only at its next checkpoint (`library_paste.py` ~130, `library_scheduler.py` ~514), so two full RAW imports can overlap on 8 GB. | Grade waits for paste to acknowledge release before its large allocation; a test uses a real `ImportJobManager` start while preparation is blocked. Fold into P3. |
| R4 | **Output change (stored pictures).** Detail changed finished pixels but finished-render versions did not advance (`library_screen_previews.py` ~18, ~78), so old built previews keep old highlights. | Stored thumbnails and screen previews built before the Detail fix are rebuilt; source developments are reused, no full RAW rebuild. |
| R5 | `library_refresh.py` ~18: Refresh bumps the global file-command epoch, so unrelated photos' source work is rejected. | Refresh of photo A only invalidates A's family; a test shows B completing. |
| R6 | `library_cache.py` ~410: `cleanup_pending` compares the old file's stamp outside the publication lock, then deletes whatever is at the path. | Compare and delete happen together under the lock; the interleaving test passes. |
| R7 | `grade-paste.js` ~114: awaited `/grade-preparation-end` in `finally` overrides a successful paste, so thumbnails, success message and Undo do not update. | Clean-up is best-effort and time-bounded; a successful paste always reports success. |
| R8 | `tests/test_grain_work.py` ~29 compares a committed reference bit-for-bit; on the Mac 217 of 6,783 values differ by about 1.2e-7. | The test is correct on both machines without loosening what it is meant to prove (for example, compare old and new implementations in the same run). |

### W2: Speed

Measure before and after on the MacBook Neo; record timings in
`docs/technical/performance-table.md` with the machine named.

| ID | Outcome wanted | What we know | Done when |
| --- | --- | --- | --- |
| P1 | The moment Steve confirms a paste, affected thumbnails hide and show "Preparing adjustments"; then "Updating preview"; visible ones redraw first. | The Library is only told after preparation and the transaction finish (`grade-paste.js` ~61/98, `photo-library.js` ~1024). | Old pixels hidden and progress visible within about 100 ms of confirming; cancel, failure, no-change targets, virtual copies and Undo all restore correctly (extend `tests/library-grade-paste.js`). |
| P2 | Leaving Grade shows the edited thumbnail almost at once when the Library was hidden. | A ready 640 px thumbnail waits behind the other rendition and 2560 px screen work (`photo-library.js` ~2237/2275, `library-gpu.js` ~461); a 30 s pending grace hides failures. | Ready thumbnails install without waiting for extra work; extra work deferred; `desktop/library-grade-picture-check.cjs` extended to cover an immediate return. Target the existing 500 ms clean-handoff goal. |
| P3 | Opening a RAW in Grade is not slowed by background work. | Steve's 30+ s open was in Grade during a paste. Paste preparation yields to Grade only at safe points; native RAW decode cannot be interrupted; post-paste Library redraws and Denoise warm-up keep running and compete for memory and GPU. Grade's own full RAW development is already slow (separate open work in the RAW PRD). | While Grade is opening, paste preparation, Library redraws and warm-up pause, and resume once Grade shows a picture. Includes R3. New check: the same cold RAW opened in Grade idle versus during a paste; contention adds no more than 250 ms or 10%, whichever is larger, apart from one reported native-decode segment. Memory gates unchanged. |
| P4 | Denoise does not slow repeat Library draws of an unchanged photo. | Library calls Denoise setup on every draw, replacing scratch and selector (`library-gpu.js` ~426, `webgpu-preview.js` ~5886). | Setup is reused for an identical source/lane/scale/geometry/model; control-only changes update correctly. Checks: `tests/denoise-tile-cache.js`, `tests/denoise-adaptive-parity.js`, a focused Library redraw. |
| P5 | Know where lens-correction time goes before rewriting anything. | Grade Lensfun is CPU, full resolution, after RAW development; remap is already parallel; a lens-only change re-develops the RAW (`raw_import.py` ~1304/1412/1638). Rejected already: another pre-lens cache, the sampled-grid GPU handoff. | Stage timings for decode, coordinates, vignette, remap and presentation (extend `tests/performance/raw-import-baseline.js`). Report to Steve with a go/no-go on exact strip-fused remapping. No rewrite without his yes. |

### W3: Colour wheel bugs

**Output change** for edits that use the wheels. Fix the CPU and GPU
together (`adjustments.py` ~1855, `webgpu-shaders.js` ~837, `gpu-params.js`
~377, `color-wheels.js`), including local wheels and HDR-to-SDR Match
translation (`sdr_match.py` ~513).

| ID | What's wrong | Done when |
| --- | --- | --- |
| C1 | Once any wheel is non-zero, the stage clips the whole frame (SDR to 0–1, HDR negatives to 0), even where that wheel has no weight. A 1% Shadows nudge flattened an above-white SDR highlight. | Moving a wheel from zero changes only the pixels its range weights; the output is continuous at zero strength; limiting is left to the later stages built for it. New checks: continuity at zero, unaffected-range pixels unchanged. |
| C2 | Positive Balance favours shadows; Lightroom's favours highlights. | Balance direction matches Lightroom in global and local wheels, CPU and GPU. |
| C3 | Puck drawn at 0.45 × width but input reads 0.5 × width; clicking a puck at 40 writes 36. | Clicking a puck without dragging leaves it unchanged. |

### W4: Tone controls (T1), research first

Steve's direction is in Decisions. A research report is in progress; it
will propose the Blacks/Whites endpoint behaviour, broad customisable
Shadows/Midtones/Highlights ranges, how Whites and Highlight Compression
share the bright end, overlap tables, processing order, and Local Tone. No
build until Steve approves a design. Current state: Blacks is a deep-shadow
gain (`adjustments.py` ~985), not a black point; Blacks and default Shadows
overlap over two stops and compound because Blacks runs first; there is no
Whites slider.

**Research result (Nov 15), proposal awaiting Steve's decisions:**

- Other apps: Lightroom documents Blacks/Whites as clipping endpoints and
  Shadows/Highlights as broader regions, all image-adaptive and
  interacting; DxO PhotoLab 10 added Whites (users split on it darkening
  too much); Resolve's HDR palette has adjustable zones with a visible range
  display (users praise it, but zones can miss the picture's tones);
  darktable keeps creative tone shaping separate from the display mapping.
  No app publishes its curves.
- Proposed design: one five-control Tone block (Blacks, Shadows, Midtones,
  Highlights, Whites) that reads one frozen pre-tone guide, so no control
  moves another's selection. Blacks is a narrow floor control near black
  (relative to reference white); Whites a narrow control over the top half
  of the output range (relative to the HDR target peak, or SDR white),
  selected by the brightest channel. Broad zones keep Center/Width but are
  gated away from both endpoints. Overlap: about one stop at the black end,
  half a stop at the white end. Whites −100 takes a 1000-nit peak to about
  775 nits; +100 fills toward the ceiling but never raises it.
- Placement: after Highlight Compression's shoulder and before the final
  ceiling, in HDR, generated SDR and authored SDR, so Peak Fit cannot
  cancel Whites. This also moves the zones after Film Look (they no longer
  change film exposure; Exposure still does).
- Local Tone would share the same curves; Match's local fitter must be
  rebuilt. Later: Alt/Option-drag clipping preview, effective-range display,
  then Shift-double-click Auto per endpoint.
- Size **L**. All saved non-zero tone edits and stored Match recipes render
  differently (pre-1.0: no migration renderer).

T1-a decided Nov 15: tone first, then Film Look, Highlight Compression last as
the cap (see Decisions). The revised design is in
`tone-endpoints-design-2026-11-15.md` (size XL with Local Tone and Match).
Open, in order: T1-e fixed cap vs Peak Fit; T1-f SDR shoulder moved last;
HDR Center 0 anchor; T1-b Whites travel; T1-c Local Tone together; T1-d
preview first, Auto later. No build until Steve answers.

### W5: HDR to SDR Match colour (M1), research first

Steve sees denim come out a very different blue in SDR after Match. A data
investigation is in progress: synthetic patches across luminance through
the real CPU pipeline, stage by stage (Match, placement, highlight
compression, gamut mapping, Film Look), measured in a perceptual space, plus
an objective display check so the conclusion does not depend on Steve's
monitor. No fix until the cause is shown with numbers.

**Research result (Nov 15, synthetic patches, CPU renderer at `55e8bb5f`):**

- **Confirmed defect:** SDR contrast clips RGB to 0–1 *before* its
  hue-preserving luminance step (`adjustments.py` ~1093, shader ~1206).
  After Match lowers SDR exposure and Exposure Bands lift blue back above
  white, contrast turns denim about 13° and drops chroma to 70%; the final
  SDR ceiling (`adjustments.py` ~721) adds about 4° more. Film-off denim at
  0 stops: 5.5 ΔE00 from Match's own target (skin, green, cyan under 0.8).
  An in-memory headroom fix cut it to 0.4. Film Look's final 0–1 clip
  (`adjustments.py` ~1852) can add more. Same family as C1 and R1.
- **Steve's hypothesis holds:** stocks shift a fixed blue by tens of degrees
  between −4 and 0 stops, and Match feeds Film Look different exposure in
  SDR (Portra 50%: +16% at −3 stops, −29% at +1). HDR and SDR stock code
  agree within 0.25 ΔE00 at equal input.
- **Match can pass while one colour is off:** its aggregate gates
  (`sdr_match.py` ~366, ~479) allow a 15° denim error.
- **Display:** this Mac reported 1.0× current EDR headroom (2.0× potential).
  With no headroom, the HDR view falls back to a per-channel `RGB/(1+RGB)`
  picture that differs a lot from the SDR target. The app does not show
  which presentation mode is active.
- **Objective check:** export HDR AVIF + sRGB PNG and run
  `measure_exports.py` (kept in the coordinator's scratch folder) on the
  jeans rectangle.

Candidate items: M1a preserve headroom through SDR contrast and coordinate
final clipping with Film Look (M, output change); M1b local-colour
diagnostics in Match (S–M); M1c show presentation mode and EDR headroom
(M, diagnostic); M1d fit Film Look input placement in Match (L). Waiting on
Steve's jeans photo and project before changing output.

**All-colour follow-up (Nov 15, MacBook Neo / A18 Pro / 8 GB):** Steve's
correction is confirmed; the problem is not blue-only. The original patch
population (including the wide-gamut controls that affect the fit) reproduces
the quoted `55e8bb5f` table. It and a separate sRGB-only population were
rematched at `83fb8f8c`, Film off and Portra/Ektar/Velvia at 50%, all hues,
three saturations and -4..+3 stops. [Full tables](../reports/m1-colour-follow-up-2026-11-15.md)
record inherent/residual/total Delta E00, meaningful hue, chroma and Delta L.
Five canonical <=512-pixel shared RAWs also have whole-image/skin-colour/
red/green/cyan/blue/magenta/highlight measurements across those stocks.

- M1a repairs early channel clipping, not full-colour target reproduction.
  Film-off green +2 maximum residual worsens 11.945 ->23.904 Delta E00;
  DSC00264 green P95 worsens 6.542 ->11.928 and highlight P95 8.174 ->16.227.
  Original-population -1-stop maximum improves 3.113 ->1.024; its remaining
  Film-off error is predominantly darkness, not a significant hue rotation.
- Early shoulder/gamut compression still precedes Exposure Bands/contrast.
  Fitted lifts raise these pixels above white, then final gamut mapping
  removes chroma. Body gates do not constrain highlight colour. M1d remains:
  +1-stop median Film input is 22% lower for Portra/Ektar and 32% for Velvia.
- A7R00619 reproduces +11.594 points white-area growth after +0.5 EV. Peak
  Detail 35 cuts growth to 0.154 points but worsens highlight P95
  2.559 ->9.836 Delta E00 and body luma P95 0.011817 ->0.059226, losing the
  current candidate's normal 0.030 gate. No such trade-off is installed.
- No further output, CPU/GPU order, gate or tolerance change. Complete-target
  fitting/colour-versus-brightness/editability and Film placement need Steve.
  All fast checks pass: Node 1,030 plus Python 3,484; sequential locked GPU
  gamut parity passes 1,245 vectors. The known browser Match fixture fails
  before Match; no retry, browser-Match or full-resolution export claim.

**M1d print-stage follow-up (Nov 15; research only):** Steve's observation is
reproduced numerically. Portra 50% denim/0-stop residual improves
0.624 ->0.280 RMS Delta E00 with Warmth/Preflash alone; adding Print Exposure
improves denim/+1 from 6.744 ->0.339. Ektar behaves similarly. A single
whole-chart setting improves only 3.8%/4.5% for Portra/Ektar and worsens body
colour medians beyond the usual matched gate. Velvia is a slide and bypasses
all print controls. Match copies print settings verbatim, while its earlier
SDR stages change the input to the negative; shared print tables/reference
white are not wrong in one lane. Needed settings vary with stop, strength,
HDR exposure and photo, not a universal stock offset. Equal-input complete
modules have a separate lane-primary post-mix lower-bound difference
(expanded control max 9.004 versus signed-kernel max 0.327); changing that
boundary is also a design/output decision. Existing gates refuse all three
100% synthetic charts; their final candidates are labelled diagnostic-only.
No renderer/shader/recipe/gate/tolerance change. Film-input preservation,
guarded print fitting and signed-colour handling remain options for Steve;
[full report and per-hue/stop tables](../reports/m1-print-stage-2026-11-15.md).

### X1/X2: Local Match SDR and SDR → HDR (design Nov 15; X1 built Nov 16)

- **At design time (before N3a):** whole-picture Match already replaced every local's SDR grade.
  Masks are shared (one mask, opacity and bypass; separate `hdr_grade` /
  `sdr_grade`), but hue masks select from each lane's own picture.
  Local tone is fitted on a neutral ramp; temperature/tint/saturation,
  HSL and Detail are copied; wheels are translated; local curves are not
  transferred faithfully (`sdr_match.py` ~681/744, `sessions.py` ~597).
  The local translator does not copy the HDR local's own `enabled` flag.
- **X1 (Steve approved same-change; N4 built above):** a "Match SDR" action per parent adjustment in the local
  grade area (not per sub-mask, no bulk action at first). It fits only the
  selected SDR local through the real renderer so SDR gets the same local
  *change*, keeps the mask and the SDR global grade as they are, one Undo,
  out-of-date marker, never auto-rematches. Size M after the T1 Local Tone
  fitter exists, L standalone. Cheaper alternative: "Transfer HDR settings"
  (S, approximate).
- **X2 approved design, N5 research only:** "Start HDR from SDR", not a true reverse Match (SDR lost
  the highlight and gamut information). Keeps the SDR body's brightness and
  colour, takes HDR highlights from the original scene under the HC cap,
  replaces HDR in one undoable action. Size L; build after T1/M1.
- Steve chose the fitted **same change** promise and X2 after the tone/colour
  work. X1 is built. N5 measured an X2 prototype but did not expose it after
  the fixed body/family gates failed; see the N5 result and research report.

### W6: Small interface fixes

Design rules: `docs/design/HDR_Finisher_Design_Guidelines.md`. Check at the
MacBook window (1408x794) and the 1100x720 minimum. New tokens need Steve's
approval; propose names in the report.

| ID | Outcome wanted | What we know |
| --- | --- | --- |
| U1 | Export progress message, finished-count message and result list line up with the panel's left padding; at most one divider below. | `.batch-run-strip` has no horizontal padding; strip and Destination footer each draw a border; last result row adds another (`styles.css` ~9002/9107, `batch-export.js` ~310). |
| U2 | Clicking a field (including Export fields) and typing never shows a focus ring; Tab navigation still does. | Export ID rules outrank the mouse-focus rule (`styles.css` ~9055/9081); any keypress flips to keyboard mode (`appearance.js` ~41). |
| U3 | Header order: name, dot + Reset, Presets, eye. Presets always visible, close to the eye. Keyboard order follows. | `styles.css` ~6393, `visual-controls.css` ~63/291/378, `group-presets.js` ~36. |
| U4 | Full-screen review shows rating, pick and colour bottom-right, updating as photos change. | Full screen hides the caption and filmstrip (`photo-library.css` ~111); reuse the marks renderer (`library-culling.js` ~69). |
| U5 | The Windows custom maximize button shows a Restore icon when maximized, from any route (button, double-click, OS gesture). | State already arrives (`desktop-chrome.js` ~190); the image never changes (`index.html` ~95). Mac uses native buttons. |
| U6 | Right-click menu text is readable (14.5 px commands, smaller shortcut hints) and long menus stay on screen. | Library menus use 11 px (`styles.css` ~8389, `photo-library.css` ~197) and miss the desktop menu styling. |
| U7 | Right-click menus appear immediately and respond instantly to hover and click. | Photo menus wait for `/api/library/grade-reverts` (`photo-library.js` ~1100); Details rebuild runs first. Measure right-click to visible menu on the Neo, before and after. |
| U8 | The Frame menu fits on the MacBook Neo without scrolling in normal use. | Tall stacked layout, 85vh limit, no edge adjustment (`index.html` ~327, `photo-framing-ui.js` ~33). |
| U9 | Hovering pinned items, menu buttons and menu rows raises contrast with a background change, never a border, in every theme. | `--plate-up-hover` exists in all themes (`visual-tokens.css` ~275) but pinned rows do not use it (`photo-library.css` ~34). |
| U10 | Dragging a pinned item shows a line exactly where it will land. | Whole-row `.drag-target` highlight; before/after decided only on drop (`library-navigation.js` ~19/24). Keep photo-onto-folder moves separate. |
| U11 | Waiting on Steve to say which control. | Candidates: "Unpin folder" menu item and its confirmation (`photo-library.js` ~1871, `library-dialogs.js` ~22), or saved-location "Remove" (`media-browser.js` ~474). |
| U12 | Dock and Command-Tab show the current logo. | Installed `/Applications/HDR Finisher.app` icon already matches the repo; likely stale macOS icon cache or a development launch showing Electron's icon. Set the Dock icon in development; ship the PNG as a runtime resource. |
| U13 | Logo background corners less rounded; all copies agree. | Rounding is drawn in `desktop/assets/icon.svg` and `frontend/assets/brand/hdr-finisher-app-icon.svg`; `tools/regenerate-app-icon.cjs` needs Edge, so make it work on both machines. |

### W7: Larger interface work

| ID | Outcome wanted | What we know |
| --- | --- | --- |
| L1 | Every tooltip in every window appears after about 2.5 s of hover or focus, dismisses at once on click, Escape or leaving, and never doubles up. | Six mechanisms: shared JS tooltip at 600 ms (`workspace-layout.js` ~252), instant CSS toolbar tooltips plus native `title` (`visual-controls.css` ~519), 2 s CSS rules, native titles across Library/Export. The Library page does not load the shared controller. Update `docs/design/HDR_Finisher_Tooltip_Copy.md` timing. |
| L2 | A tooltip names a control only when its label is hidden; explanations and warnings stay; full text only when clipped. | Item list in the tooltip review: Overlays, Frame, Export list buttons, Compare/Focus, Settings/Help, Activity, resize selection, names and metadata. |
| L3 | "Choose what to paste" reads in clear sections in the edit panel's order, with section checkboxes and authored names. | Dialog is in `grade-paste.js` ~138, schema in `library_paste.py` ~57/171; label generator exposes technical names (`library_paste.py` ~36). Keep safe defaults (no crop, lens or masks) and do not widen what is pasteable. |
| L4 | Open image uses the same thumbnail grid/list browser as Open folder, in a single-image mode. | Open image uses the older list browser (`media-browser.js` ~344); Open folder uses `library-folder-picker.js`. |
| L5 | Purple is the default accent everywhere from first paint; orange remains in Settings. | Orange default in `appearance.js` ~3, `application-preferences.js` ~4, `application-shell.js` ~28; old purple `#9b7bff` (commit `bf220721`). Derive strong/low shades with the current formulas. |

## Reporting

Each worker ends with: what changed, what was tested and the result,
any output change, anything left open, and the status lines to update
above. Plain language first, for Steve.

## Steve’s editing passes before v1.0 (open)

- [ ] Steve: tooltip editing pass before v1.0, using docs/product/tooltips.md
- [ ] Steve: font token pass before v1.0 (all font sizes including tooltips; some are too small)

November 16: read-only tooltip extractor, generated workflow catalogue and fast
sync test added. No tooltip wording or frontend source changed by this task.

Tooltip catalogue verification: its two focused Node checks pass. The requested
full fast suites ran in the shared checkout: Node 1,055 passed / 21 failed /
1 skipped; Python 3,558 passed / 19 failed / 144 skipped / 1 unexpected pass.
Failures are outside this documentation/tooling change: Node GPU layout, Grade
paste, Library refresh and mask sampling; Python HDR ceiling/delivery/export
parity and native/RAW Library tests. Other workers were editing these areas;
no unrelated repairs or GPU checks were made for this task. Catalogue regenerated
against the latest shared frontend before the local commit.
