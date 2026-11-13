# Proposal: what to do after 0.9.2 (November 13, 2026)

**Status:** approved by Steve, November 13, 2026: phases 1–3, and
decisions 1–8 as recommended, except that the work moves to his MacBook
(this changes decision 6 and section 3.12). Decision 9 is still open.
The work is given in [mac-phases-1-3-2026-11-13.md](mac-phases-1-3-2026-11-13.md).
Nothing here is built yet.
**Coordinator:** Claude (Opus 5.5). **Research:** 12 Codex researchers
(`gpt-6.1-sol`, medium effort), each in its own worktree from `main`.
**Sprint plan:** [next-version-investigation-sprint-2026-11-13.md](next-version-investigation-sprint-2026-11-13.md).
**Research notes:** `docs/technical/research/next-version-2026-11-13/`
(one file per researcher; cited below as A1, A1b, ... C2).

How to read the evidence:

- **Measured**: a run made in this sprint or an earlier dated run, with
  numbers. **Read**: seen in the code, a log or an official document.
  **Estimated**: a judgment or arithmetic, not checked by a run.
- **Verified** means the coordinator checked that claim personally in the
  code or source. Every claim that decides a recommendation below was
  verified unless it says otherwise (list in Appendix B).
- Effort is in agent-hours (one Codex agent working), excluding Steve's
  reviews and GPU-lock waits.

---

## 1. Summary for Steve

**What I recommend doing next, in order:**

1. **0.9.3, "fix what we already know" (about two weeks of agent work).**
   Small, safe fixes with clear causes, no new features:
   - Saving ratings and flags no longer waits while the Library renames,
     moves or deletes. The cause is found: those commands scan every cached
     picture while holding the lock that marks need (A4, verified).
   - The Library's 1–3 second drawing pauses: a likely cause is found (a GPU
     program built twice at the same moment, A4, verified in code). Confirm
     it with one traced run, then fix it.
   - Film Look and lens filter drags (12–16 frames/s, target 20): measured
     cause is film grain drawn 16 times per pixel. Drawing it once while
     the slider moves, and exactly on release, measured 24–27 frames/s
     (A1b, A1c). Lens Strength also needs its glow reused.
   - HSL "Show selection" in SDR drops from about 1.5 s to about 0.4 s by
     keeping the SDR stage it rebuilds every time (A1, verified).
   - Three small safety fixes in GPU fallbacks (section 3.9–3.10).
   - JPEG XL: stop a stuck colour reader from hanging an import (no time
     limit today, verified).
2. **0.10, "everyday workflow".** Re-editing a crop, rename/move/delete on
   macOS and Linux, editing captions and dates in the Library, automatic
   JPEG XL colour tags on macOS and Linux, and a MacBook check at release
   points. Also two new slow spots found by timing the controls 0.9.2 had
   skipped (A2): Perspective Apply at Fit takes 1.3–2.8 s and a first Heal
   repair up to 2.8 s. They share code with crop re-editing and your
   Retouch list, so they belong together.
3. **1.0, "reliable colour and delivery".** DNG and ProPhoto qualification,
   AVIF metadata, Retouch acceptance and the Match fault (both need your
   input first).
4. **AI tools: not in v1.** All three are technically possible offline,
   but none is ready, and your master PRD rules out AI selection and puts AI
   search at v2. If you want them for v2, each starts as a small throwaway
   test with a stop/go decision, not app work (section 4).

**Why this order:** the 0.9.2 review left a short list of known slow or
fragile spots with causes now found. Fixing them is cheap and protects what
you already ship. The competitor comparison (section 5) shows HDR Finisher
already matches the everyday basics; its real edge is grading the HDR and
SDR versions fully and separately and exporting them as AVIF and JPEG XL as
well as JPEG. Lightroom Classic also exports JPEG gain maps now, so "makes
gain-map photos" alone is no longer unique.

**What I need from you:** the decisions in section 8, one at a time. The
first one is whether the HDR film-preview blotches (seen only with
Highlight Compression off and extreme grades) stay a known limit.

---

## 2. What was done

Twelve researchers ran between about 07:05 and 08:00 (local time) on
November 13: five
on the open 0.9.2 items (A1–A5), three on local AI tools (B1–B3), one on
competitors (C), and three follow-ups sent where a first report was weak:
A1b (A1 measured nothing new), A1c (A1b found the slow step but not why),
C2 (C left many competitor features unconfirmed). All GPU runs went through
one shared lock; a new wrapper, `D:\AI\AI Projects\HDR Finisher Tool\gpu-run-lock.py`,
was added because two older lock methods did not see each other
(`gpu-run.lock` folder and `gpu-check.lock` file).

---

## 3. Workstream A: everything still open from 0.9.2

### 3.1 SDR HSL "Show selection" (~1.5 s, up to 2.0 s)

- **Cause (verified):** `backend/hdr_finisher/hsl_sampling.py:56-109`
  calls `apply_adjustments` on a proxy every time, rebuilding the whole SDR
  stage (W11 profile: 0.70 s highlight compression + 0.40 s gamut mapping),
  then makes a PNG. It does not use the existing `_hue_stages` cache
  (`render_cache.py:1114-1139`), whose key also includes every adjustment.
- **Fix:** a bounded CPU cache of the pre-HSL SDR stage, keyed only on what
  comes before HSL (source, lane, proxy size, geometry, pre-HSL settings),
  reused across show/hide, range edits and downstream edits. Local
  selections keep their own route at first. Second step only if needed: a
  GPU overlay drawn from the live HSL stage (no PNG round trip).
- **Gain (estimated):** warm 1.5 s → 0.35–0.6 s. First show after an
  upstream edit is unchanged until step two.
- **Effort / risk:** 4–8 h (step 2: 12–20 h). Risk: stale or wrong-lane
  coverage. Preview-only; export and Proof untouched. Memory: about 20–30 MB
  at the 1600 px sampling size, inside the existing 600 MB Grade array cap.
- **Test:** fast suites; `hsl-selection-engine.js`, `hsl-overlay-review.js`
  (one locked run each).

### 3.2 SDR "Match entire" (~1.2 s, up to 1.4 s)

- **Cause (read, from W11 measurements):** the fit renders 11 GPU
  candidates; exposure refinement is 0.49–0.55 s, neutral fit 0.16–0.22 s,
  CPU certification 0.13 s. The search is already coarse-to-fine
  (`sdr_match.py:165-212`).
- **Fix:** reuse target statistics and candidate inputs between candidates;
  then try an analytic exposure starting point that skips some refinement
  renders, falling back to the full search when unsure.
- **Gain (estimated):** about 20% (1.2 s → about 0.95 s). Removing all
  refinement would save at most 44%, so a new GPU route is not justified.
- **Effort / risk:** 6–12 h reuse; 12–24 h search change. Changing which
  candidate wins changes the Match recipe: **Still strict** for the result.
- **Recommendation:** low priority. It is close to the 1 s bar, behaves
  like an "Auto" button, and the separate **Match fault** (Grade PRD open
  work item 2, waiting on your recorded photo) matters more.

### 3.3 Film Look and lens filter drags (8–16 frames/s, target 20)

- **Measured (A1b, GPU timestamps, SDR Fit, 1613×1075):** the film
  **finish** pass costs 40.4–42.1 ms per frame on every film drag; the lens
  glow's 27 horizontal + 27 vertical blur passes cost 27–28 ms. Everything
  else is under 0.2 ms. All lens frames re-ran the glow although only lens
  Strength changed. Whole-frame intervals (101–129 ms for lens) are 30–60 ms
  longer than GPU time.
- **Cause of the finish cost (measured, A1c, five shader variants, two
  trials each):** film **grain supersampling**. At Fit, `filmGrainStops`
  takes 4×4 = 16 grain samples per pixel, each with three noise layers.
  With grain off the finish pass falls from 40–42 ms to 2–6 ms; with one
  grain sample it is 3–24 ms. Hoisting the per-pixel constants or turning
  halation off made no difference beyond noise. Portra 400's defaults turn
  grain on (Amount 24), so this is the normal case, not a corner case.
- **Measured with one grain sample (diagnostic build):** stock, print and
  grain drags 24–27 frames/s (from 12–16). Lens Strength 14–19 frames/s:
  it still pays the 27 ms glow.
- **The gap outside the GPU** is 20–40 ms here (A1c), mostly queue waiting
  and live scope readbacks contending with the next frame; not shader
  encoding.
- **Recommended fix (estimated):**
  1. **One grain sample while dragging, exact grain on release** (3–6 h).
     Settled, Proof and export pixels unchanged; grain looks slightly
     coarser only while the slider moves. Needs care that a drag frame is
     never taken as the settled frame.
  2. **Reuse the summed lens glow when only Strength changes** (8–16 h,
     about 28 MB VRAM). Exact. With (1), forecast 22–33 frames/s for lens
     Strength (not measured combined).
  3. Only if lens Size or type drags also need 20 frames/s: a coarser glow
     grid while dragging, exact on release (4–8 h).
  4. Defer live scopes during drags (2–4 h); gain not measured.
  Rejected: a blur pyramid for the glow (changes settled and export pixels,
  16–32 h, **Still strict**); hoisting constants (no measured gain).

### 3.4 Exposure after Denoise (0.07 s vs 0.03 s)

- **Cause (read):** Denoise results are already cached
  (`webgpu-preview.js:4270-4308`); the extra ~26 ms appears on the first
  edit after a Denoise change, when the highlight anchor is measured again.
  Repeated Exposure edits return to normal. Not a Denoise re-run.
- **Fix:** measure the new anchor in the background while Denoise settles,
  so the first downstream edit does not wait for it. 3–6 h. Preview only.
- **Recommendation:** low priority; 26 ms is under one display frame
  pair and only on the first edit.

### 3.5 RAW Edge colour, Highlight method, lens focal (6–14 s)

- **Measured (A1b, real app, 42 MP Sony DSC00264, two trials):**
  Method 12.6–12.7 s, Expand 13.5–13.7 s, focal 6.6–6.9 s, action to
  settled picture. Stages: decode 1.7–2.0 s (highlight reconstruction 0.7–0.9,
  demosaic 0.8); GPU Edge colour hand-off 6.1 s; **lens correction 2.4–2.5 s
  in every case**; session, mips and first render 0.2–1.1 s.
- **Checkpoints (estimated from those stages):** keeping a pre-lens copy
  would cut focal changes about 30% (to about 4.6–4.8 s); a pre-edge copy
  would cut Expand about 21%. Neither fits the 600 MB Grade array cap at
  42 MP with the current source also held (504 MB and 672 MB on their own).
  Highlight Method cannot use either.
- **Coordinator's observation (read, not measured):** lens correction is
  2.4 s on every RAW opening and redevelopment, not only these controls.
  `apply_lens_correction` (`raw_import.py:1232-1340`) runs Lensfun's
  coordinate generation over the whole frame, then a strip remap. Whether
  the coordinate step uses more than one core is not established.
  Philosophy 3 ("use the whole machine") makes a profile of this the
  cheapest first step: if it parallelises, every RAW open gains, with no
  extra memory.
- **Recommendation:** (1) show real progress stages during RAW rebuilds
  (3–6 h; saves no time but removes the "is it stuck?" doubt); (2) profile
  and parallelise lens correction (4–8 h; estimate only); (3) no checkpoint
  cache unless you decide to give RAW rebuilds more memory (section 8).

### 3.6 HDR film-stock preview ceiling (blotches with compression off)

- **Cause (verified in code):** preview intermediates are 16-bit float
  textures (max 65,504) from the first grading pass onward
  (`webgpu-preview.js:7101-7173`, `webgpu-shaders.js:1231-1240`). Exposure
  +8 alone can exceed it, before Film Look. Changing only the last pass to
  32-bit float was tried in the Film Look rebuild and still failed.
- **Options (A3, estimated):** 32-bit float across the affected stages
  (20–40 h; up to 380 MB more VRAM at 4K, about 1.9 GB at 42 MP Direct);
  a scaled encoding (30–60 h); a preview-only soft clamp (8–16 h, but
  shows a different picture); or keep the known limit.
- **Recommendation:** keep the known limit until a real photo of yours
  shows it. Export and Proof are correct; the default (compression on) is
  correct. This is decision 1 in section 8.

### 3.7 Library drawing gaps (1–3 s against 0.25 s)

- **Read/measured (A4):** gaps go back to at least November 1. In the two
  recorded failures the gap starts within 5–19 ms of a
  `picture_pipeline_demand` event and ends when `picture_pipeline_prepared`
  completes; no long JavaScript task covers the gap.
- **Likely cause (verified in code):** `library-gpu.js:153` creates a GPU
  program synchronously on first use even when the same program is already
  being prepared asynchronously (`:162-175`). The GPU process then compiles
  it twice, which can stall drawing without blocking JavaScript.
- **Not yet proven:** A4's one traced run did not reproduce a gap (max
  150 ms). The fix is a candidate pending reproduction.
- **Fix:** draw with the pending program (await it) instead of building a
  second copy, keeping the current picture on screen meanwhile. 4–8 h to
  reproduce and attribute, 3–6 h to fix. The 0.25 s limit stays.
- **Also found:** the smoke check shows 29 of 33 eligible photos; a pass
  does not cover all photos (one-line fix to the check's report).

### 3.8 Marks waiting during rename / move / delete

- **Cause (verified):** `library_file_state.py:88-112` opens every cached
  `.npz` picture to find the ones for the renamed photo, and
  `library_file_commands.py:264-277` does that while holding the marks lock.
  The whole batch also holds the settings writer lane. On a 5,475-file cache
  the command takes about 1 s; marks wait for the rest of it.
- **Fix:** a small index in the (rebuildable) cache ledger from source photo
  to its cache files, kept at publish and eviction time; do the cache work
  outside the marks lock with per-photo fencing. A smaller first step (move
  the scan outside the lock) fixes the waiting but not the scan cost.
- **Effort / risk:** 12–20 h plus 4–8 h slow-storage validation. Risk:
  stale cache rows after a crash. Treated as cache misses and rebuilt in the
  background; marks and grades are never rebuilt from the cache.
- **Proposed tolerance:** an unrelated mark is acknowledged within 250 ms
  and reaches its sidecar within 1 s during a file command.

### 3.9 Random bad GPU Edge-colour pixels on this PC

- **Read (A3, logs):** rejections of 1–65 pixels per run on several days;
  general Library "invalid pixels" on other RAWs too; one log shows the GPU
  reading an input value of 1.09e38, which no RAW produces. That points to
  data damaged on the card or in transfer (hardware or driver), not to the
  Edge colour maths. Not proven: no coordinates are logged.
- **Separate small safety gap (verified):**
  `highlight-edge-colour.js:206` checks the output only when the input scan
  found no bad pixels. If the input is bad, a finite but wrong output can
  pass the browser check; the backend (`highlight_edge_gpu.py:85`) checks
  only for infinity and NaN. Fix: reject immediately when the input scan
  finds bad pixels (2–4 h).
- **Optional diagnosis:** a locked replay that logs the first bad
  coordinates and per-stage hashes (4–8 h). Do it only if you want the
  hardware question settled.

### 3.10 GPU retry rule (November 6) follow-up

- **Read (A3):** the two fixes you approved on November 6 are in place.
  Remaining:
  - **Library device loss (verified):** `library-gpu-raw.js:1017-1019`
    requeues a lost device with no limit; repeated loss can loop. Bound it to
    one recovery (4–8 h).
  - Library's failed-work key is path plus sizes, not the full settings
    (`:931`); different settings can inherit an old rejection.
  - Grade treats every out-of-memory and timeout as temporary (narrow
    follow-up, 6–12 h).
  - Export, Proof, DNG, Edge, Retouch and Denoise: left as you decided.

### 3.11 JPEG XL colour tags on macOS and Linux

- **Read (verified):** without the helper, `jpegxl.py:490-507` falls back
  to the header reader (size and bit depth only), so colour stays manual.
  The helper call has **no time limit**: a hung helper would hang the
  import (the same kind of fault that stalled the Library in 0.9.2).
- **Recommendation (A5):** build the existing helper for macOS and Linux in
  the release workflow (pinned libjxl 0.12.0, static where possible); keep
  the fallback and add a time limit. ICC-only and custom profiles stay
  manual. 10–18 h. Rejected: a pure-Python parser (20–36 h, high risk) and
  pillow-jxl-plugin (GPL-3, no benefit over the helper).
- **Test:** small tagged fixture files; tests on all three GitHub runners
  with the helper present, missing, failing, hung and malformed.

### 3.12 Real Mac coverage

- **Read (verified):** the smoke test skips a layout size only when the
  window cannot reach it (`electron-smoke.js:244-265`); the tier-overlap
  test is skipped on every Mac (`test_library_source_baseline.py:13`).
- **Recommendation (A5):** an advisory MacBook run at release points only,
  through T3 Connect, after the GitHub build: packaged smoke at real sizes,
  tier overlap, GPU Edge colour on a healthy GPU, Library quick check.
  If the Mac is offline, the release is not blocked; the gap is written
  into the release record. One-time setup 6–10 h; 0.5–1 h per release.
- **Changed by Steve (November 13):** phases 1–3 are built and tested on
  the MacBook. The Windows PC takes the advisory release-point role
  instead (see the Mac brief, "Machines").

### 3.13 Grade controls not timed in 0.9.2

**Measured (A2, real app, 24 MP TIFF, 2560×1440, three trials per lane and
view, change to settled picture, limit under 1.0 s):**

| Control | HDR Fit | HDR 100% | SDR Fit | SDR 100% | Verdict |
| --- | --- | --- | --- | --- | --- |
| Perspective Horizontal + Apply | 1.48–2.77 | 0.85–0.99 | 1.26–1.76 | 0.82–1.16 | Fail |
| Perspective Vertical + Apply | 1.68–2.12 | 0.70–0.80 | 1.38–1.40 | 0.86–0.98 | Fail at Fit |
| Perspective Rotate + Apply | 1.29–1.46 | 0.78–0.85 | 1.32–1.50 | 0.80–0.96 | Fail at Fit |
| Vertical guide nudge, solve, Apply | 1.36–1.88 | — | 1.55–2.64 | — | Fail |
| Create Heal repair | 1.08–2.81 | 0.31–1.56 | 0.69–2.25 | 0.34–1.70 | Fail |
| Create Inpaint repair | 0.63–1.17 | 0.38–0.42 | 0.68–0.91 | 0.36–0.51 | Fail once (HDR Fit) |
| Retry Inpaint | 0.77–1.45 | 0.42–0.44 | 0.75–0.89 | 0.40–0.43 | Fail once (HDR Fit) |
| 36 other rows: custom crop, Clone, repair list and moves, brush, gradient, luma, hue and path mask settings, Boolean Subtract/Intersect/Union, preset import/export | all 0.02–0.96 | | | | Pass |

- **Where the time goes (read from request logs, A2):** Perspective
  rebuilds the proxy (0.36–1.05 s requests) after saving the geometry;
  Heal's edit request alone takes 1.4–2.1 s on a cold first repair.
- **Fix directions (estimated):** reuse the unchanged base and avoid the
  duplicate proxy rebuild on Perspective Apply (2–4 days; medium–high risk
  around transformed coordinates and exact final pixels); separate Heal's
  cold preparation from the repair itself and reuse it (2–3 days; risk to
  repair pixels, which reach export: **Still strict**).
- **Still untimed (A2):** gradient luminance-limiter handles, stroke and
  point editing gestures, horizontal guides, pointer guide dragging, repair
  circle drags, drag frame rates and the "slows other actions" check for
  these gestures. About 20–30 more graphics minutes would close them.
- **Environment note:** A2's sandboxed test launch hung before a window
  opened; runs used the existing test-only switch
  `HDR_FINISHER_ELECTRON_DISABLE_GPU_SANDBOX=1` (`run-in-electron.js:124`).
  Cause not investigated.

### 3.14 Other open items found (A5, triage)

Already fixed but still listed as open (update the PRDs; size S each):
PQ/HLG explicit primaries (import PRD), manual-album deletion refresh
(Library PRD), export run-to-run difference (export PRD; 0.9.2 found
byte-identical), hidden GPU delivery renderer (preview PRD), Flatpak 0.9.1
entry (desktop PRD).

Still open, by likely impact: Retouch quality review (yours), crop
re-editing (M), Linux warning shown before a photo is open
(`info-panels.js:263-270`, S), Updates panel Releases link (S), stored
screen-preview first-use speed (M), RAW zero-start preview agreement (M),
macOS interrupted folder scan expected failure (M), Linux physical HDR and
Flathub (L), ProPhoto input (L), full-size export speed (L), JPEG GPU/CPU
agreement (L, deferred), Film grain data estimates (your review).

---

## 4. Workstream B: local AI tools

All three are feasible offline on Windows, macOS and Linux with ONNX
Runtime (CPU everywhere; DirectML on Windows; CoreML on Apple silicon).
None is ready for the app. Each recommendation is a **throwaway test with
a stop/go gate**, and adopting any of them changes your scope (master PRD
section 3 rules out AI selection; AI search is v2 at the earliest).

### 4.1 AI denoise (B1)

- **Recommendation:** a small test of **RawNIND linear UtNet2** as an
  optional, prepared step run once on the developed linear photo, with
  Denoise v2 kept as the live control. Not a replacement. "Not yet" for the
  Bayer (before demosaic) model, which would replace demosaicing.
- **Why this one:** trained on linear data (fits the HDR pipeline better
  than sRGB-trained models), an ONNX export already exists, and the weights
  are dual GPL-3 / CC-BY-4.0 (verified on the project page), compatible with
  the app's GPL-3 licence.
- **Measured:** CPU 48 s for a synthetic 24 MP job (176 tiles, 1.1 GB
  worker memory) on the Ryzen 5 7600. GPU not measured (lock contention and
  a wrapper bug, since fixed). Install about 80–110 MB on Windows. One
  crop: removes more fine noise than Denoise v2; one photo, no reference.
- **Rejected:** Apple/other models with non-commercial terms; SID, DnCNN,
  FFDNet (wrong noise model or unclear licence); vkdt KPN (NVIDIA-only).
- **First step:** time two real 24 MP photos end to end on the GPU and CPU,
  inside the app's memory budgets, plus exposure-range probes. Stop if
  quality or budgets fail.

| Option | Weights licence | Size | Speed (Steve's PC) | HDR fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| RawNIND linear | GPL-3 / CC-BY-4.0 | 31 MB model | CPU 48 s / 24 MP (measured) | linear Rec.2020 | Test first |
| RawNIND Bayer | same | 31 MB | est. 12–25 s | replaces demosaic | Later |
| NAFNet / Restormer / SCUNet | permissive code; weight grants unverified | 100+ MB | unmeasured | sRGB-trained | No |
| EdgeSAM-style non-commercial | — | — | — | — | Excluded |

### 4.2 Library search and tagging (B2)

- **Recommendation:** "not yet". If wanted for v2: one embedding model
  for both text search and tag suggestions (no separate tagger), stored in
  a separate rebuildable `library-ai.sqlite3`, fed from the existing 640 px
  thumbnails so nothing waits on the photo drive. Suggestions are only
  suggestions until you accept them.
- **Measured (OpenAI CLIP B/32 baseline, 107 photos):** CPU median 59–65 ms
  a photo (≈12 min per 10,000, extrapolated); DirectML warm 8.7 ms (≈1.5
  min per 10,000, extrapolated from repeated photos); about 430 MB process
  memory; queries 25–61 ms. **Quality was poor**: "red car at night"
  returned a test pattern, "mountains" a beach.
- **Next model to test:** SigLIP 2 Base (Apache-2.0, verified). Rejected:
  Apple MobileCLIP (weights research-only, verified), Jina CLIP v2
  (non-commercial), RAM++ (3 GB, second runtime).
- **Storage:** about 10 MB per 10,000 photos at 512 dimensions (fp16).
  Exact search is fast enough to 100,000 photos (7 ms measured on synthetic
  data); no vector index needed at first.
- **First step:** 300–500 labelled thumbnails, 30 queries, SigLIP 2 vs CLIP,
  timed end to end; then you decide on a memory and disk allowance.

### 4.3 Sky, subject and click masking (B3)

- **Recommendation:** an optional **click-to-select** test with
  **EfficientSAM-Ti** (code and weights Apache-2.0, verified; weights in the
  repository; we would make our own ONNX file from them). "Not yet" for
  automatic Sky / Subject / People buttons.
- **Measured:** model 1.1–1.5 s on the CPU per click (1024 px input).
  Refining the edge over a whole 48 MP photo in one pass peaked at 3.8 GB,
  too much next to the editor, so refinement must work in tiles. On one
  drone photo the first click also took in water and land: edge smoothing
  cannot fix a wrong selection.
- **Storage:** save the resulting mask as a compressed picture with the
  project (about 5 MB measured for 48 MP), never recomputed silently; record
  the clicks and model version only as history. Export reads the saved
  mask, so a model change can never alter a saved photo.
- **Rejected:** SAM 3 (3.4 GB, custom licence), EdgeSAM (non-commercial),
  Ultralytics YOLO-World (AGPL), RAM-heavy matting models.
- **First step:** split the model into image and click parts, tiled
  refinement, compare with SAM 2.1 tiny on hair, trees and sky; target
  first mask within 3 s, later clicks within 0.2 s.

---

## 5. Workstream C: feature parity

Full matrix (105 rows, every HDR Finisher cell cited):
`research/next-version-2026-11-13/c-feature-parity.md`; competitor cells
resolved by C2: `c2-competitor-cells.md`. Versions (verified):
Lightroom Classic 16.0 (November 2026), Capture One Pro 16.9 (October 29,
2026), DxO PhotoLab 10.3 Elite.

**Where HDR Finisher stands (C, C2):**

- Matches the everyday basics: folders, culling, ratings, labels, tags,
  albums, smart albums, virtual copies, selective paste, RAW development,
  tone and colour, local masks (brush, gradient, luminance, hue, path,
  Boolean), Heal and Clone, presets, batch export with metadata.
- **Leads (with evidence):** full independent HDR and SDR grades (Lightroom
  documents SDR rendition controls, not a second complete grade; Capture One
  and DxO unconfirmed); AVIF and JPEG XL HDR export (Capture One and
  PhotoLab list neither; omission-based); HDR Library grid (Adobe excludes
  the Library grid from HDR display); headroom-aware gain-map Proof;
  open-source and Linux.
- **No longer unique:** Lightroom Classic writes JPEG gain maps.
- **Trails:** AI masks, AI portrait retouch and AI RAW denoise (all three
  competitors), TIFF export, re-editing a crop, Library caption/date editing,
  rename/move/delete on Mac/Linux, chromatic aberration and fringe tools.

**Sorted gaps** (C's classification, reviewed):

| Class | Gaps |
| --- | --- |
| In scope, valuable | Retouch acceptance; Match fault; crop re-editing; Mac/Linux file commands; Library caption/date editing; DNG qualification; ProPhoto input; AVIF metadata; local colour tools; fringe/CA tools (v2 idea); noise-aware sharpening (v2) |
| In scope, low value now | persistent edit history; SDR fallback inside JPEG XL; AI denoise; TIFF export; ICC soft proof; external-editor round trip |
| Out of scope (PRD) | linked photos, portable projects, Library Looks (v2); stacks, faces, maps, cloud, tethering, printing, galleries, AI masks, generative removal, plug-in SDK, MCP (v2) |

**Candidate releases:** 0.9.3 acceptance and trust; 0.10 everyday workflow;
1.0 reliable colour and delivery; post-1.0 selective image quality. These
feed the phased plan below.

---

## 6. Phased implementation plan

Each phase is one brief in `docs/technical/briefs/`, run like the 0.9.2
sprint: one Codex agent per workstream, each in its own worktree from
`main`, the coordinator reviewing and merging one branch at a time. GPU
runs go through `gpu-run-lock.py`. Testing follows `AGENTS.md` (fast checks
plus the one or two covering GPU drivers per change group).

### Phase 1: 0.9.3 "fix what we know" (about 80–120 agent-hours)

| Workstream | Items | Effort | Strict area? |
| --- | --- | --- | --- |
| P1-A Library | 3.7 drawing-gap reproduction and pipeline fix; 3.8 cache index and lock split; smoke-check photo count | 25–40 h | No |
| P1-B Grade speed | 3.1 HSL stage cache; 3.3 one-sample drag grain and lens-Strength glow reuse; 3.4 anchor pre-measure | 20–35 h | Settled pixels must not change; `film-look-interaction.js`, `lens-filter-tiled-parity.js`, `film-stock-parity.js` |
| P1-C GPU safety | 3.9 Edge-colour input rejection; 3.10 Library device-loss bound and failed-work key | 8–14 h | Edge colour reaches export: Still strict checks |
| P1-D Platform | 3.11 JXL helper time limit (helper builds move to Phase 2); A5 stale-PRD cleanup; Linux warning; Releases link | 6–10 h | No |
| P1-E Tooling | Retire `gpu-lock.cjs` or point it at `gpu-run.lock`, so there is one lock | 1–2 h | No |

Release: fast suites, focused release check (`npm run test:release --
--release`), and the GitHub "Desktop release" workflow on `main` started
early in the phase and passing on every platform before the tag.

### Phase 2: 0.10 "everyday workflow"

Crop re-editing (M), Mac/Linux rename/move/delete (L), Library caption and
date editing (M), JPEG XL helper for macOS/Linux (10–18 h), MacBook release
lane (6–10 h setup), RAW progress stages and lens-correction profiling
(7–14 h). Geometry and Retouch speed together with crop re-editing and your
Retouch list, since they touch the same code: Perspective Apply proxy reuse
(2–4 days), Heal cold-start reuse (2–3 days), and the remaining A2 timing
coverage (20–30 graphics minutes).

### Phase 3: 1.0 "reliable colour and delivery"

DNG qualification, ProPhoto input, AVIF metadata, the Match fault (needs
your photo), the decision on the HDR preview ceiling, physical HDR checks on
macOS and Linux, then the 1.0 release process.

### AI track (only if you change the scope)

Three separate throwaway tests (B1 RawNIND, B2 SigLIP 2 search, B3
EfficientSAM click), each about 8–16 h, each ending in a stop/go decision
with you. No app integration before that.

---

## 7. Proposed tolerances (new measurements only)

| Measurement | Proposed pass | Reason |
| --- | --- | --- |
| HSL Show selection, SDR, warm | under 1.0 s at Fit and 100% | The agreed Grade bar (0.9.2) |
| Film / lens drag at Fit | 20 frames/s or better; settled frame unchanged under existing parity checks | Agreed 0.9.2 drag target |
| Drag-only approximations | settled frame exact; drag frames judged by you, no new delivery tolerance | Approximations must never reach export |
| Mark save during file command | acknowledged within 250 ms; in the sidecar within 1 s | Unrelated work should add no visible pause |
| Library drawing gaps | unchanged 250 ms; runs with the window hidden are invalid, not passes | The limit is right; only the measurement may be corrected |
| GPU retry counts | exact: 0 retries for permanent failures, at most 1 for temporary | Policy, not noise |
| Edge-colour diagnostic replay | bit-identical on the same device | Any difference is evidence |
| Timing noise | judge within 10% (Grade) / 15% (AI prototypes on a shared PC) | Observed run-to-run spread |
| AI search pilot | right photo in top 5 for 80% of queries; displayed tag suggestions 90% correct; query under 250 ms at 10,000 photos | Wrong tags cost clean-up; search must feel instant |
| AI mask pilot | first mask within 3 s, later clicks within 0.2 s; saved masks reload byte-identical | Interactive feel; saved photos never change |
| AI denoise pilot | GPU at least 2× CPU; existing perceptual limits (ΔE mean under 1, p99 under 3); whole app within 4.4 GB peak | Existing contracts |

---

## 8. Decisions for Steve (one at a time)

Steve's answers (November 13, 2026): 1–5, 7 and 8 as recommended; 6
changed (the MacBook becomes the main machine, the PC is advisory); 9
still open (asked at the start of Phases 2 and 3).

1. **HDR film-preview blotches: keep as a known limit?** Keep (recommended):
   no cost; the preview stays wrong only with compression off and extreme
   grades; export is right. Fix: 20–40 h and up to 1.9 GB more graphics
   memory at 42 MP; could slow every preview and touches shared renderer
   code.
2. **Library cache index for file commands: go ahead in 0.9.3?** Yes:
   marks save instantly during rename/move/delete; risk is stale cache
   rows after a crash (handled as misses). No: marks keep waiting about 1 s
   on a large cache.
3. **Film drag fix: accept simpler grain while dragging?** Measured: one
   grain sample while the slider moves takes stock, print and grain drags
   from 12–16 to 24–27 frames/s; the exact grain returns on release, and
   export and Proof never change. Trade-off: grain looks slightly coarser
   during the drag. Without it, no measured fix reaches 20 frames/s.
4. **RAW rebuild memory:** keep the 600 MB Grade array cap (recommended;
   rebuilds stay 6–14 s, with progress shown) or raise it for a checkpoint
   (saves 20–30% on focal and Expand changes; less memory for everything
   else, and a 42 MP photo would still not fit).
5. **JPEG XL helper on macOS/Linux:** approve the native helper with
   unusual colour profiles staying manual (10–18 h; adds a native build to
   the release workflow).
6. **MacBook at release points:** approve an advisory check that does not
   block a release when the Mac is offline.
7. **Edge-colour hardware question:** spend 4–8 h to settle hardware vs
   software, or accept "probably this PC's graphics card" and move on.
8. **AI tools:** keep them out of v1 (recommended), or approve any of the
   three throwaway tests for v2 planning. Approving changes the master PRD
   scope.
9. **Retouch and Match:** list what still needs to change in Retouch, and
   record the Match fault photo, so Phase 2/3 can include them.

---

## 9. Open questions and known unknowns (push here)

- **Film drags with both fixes combined** (one grain sample + glow reuse)
  were not measured together; 22–33 frames/s for lens Strength is a
  forecast. The 20–40 ms outside the GPU is attributed to queue waiting and
  scope readbacks by code reading and telemetry, not by ablation.
- **Drag-frame grain** has not been shown to you; you may find the
  coarser grain during a drag distracting.
- **Library drawing gaps:** the pipeline race fits both recorded failures
  but was not reproduced under tracing. It could be GPU-process contention
  from something else.
- **Edge colour:** "hardware" is the best explanation, not a proven one.
  No coordinates have ever been logged.
- **Lens correction 2.4 s:** I have not checked whether Lensfun's
  coordinate step is single-threaded; the parallelisation gain is a guess.
- **Match saving 20%** assumes cost scales with candidate count.
- **AI timings** for GPU and Apple silicon are unmeasured or extrapolated
  from repeated photos; B2's 1.5 min / 10,000 is from 107 photos cycled.
- **Competitor cells** marked "No" by omission (Capture One / PhotoLab
  AVIF and JPEG XL) rely on export pages that blocked my own fetch
  (C2 read them); a trial install would settle them.
- **Trigger frequency** of the HDR preview ceiling in real photos is
  unknown; no outside users.
- **Perspective and Heal causes** are read from request logs; the
  duplicate proxy rebuild has not been profiled step by step.
- **Sandboxed test launch hang** (A2): unexplained. If it also affects the
  real app on some machines it matters; it may be specific to this PC or to
  several test windows opening in a row.
- **A2 timings ran with the GPU sandbox off**, so they are not directly
  comparable with 0.9.2's numbers.

---

## Appendix A: research notes

| ID | Topic | File |
| --- | --- | --- |
| A1 | Grade slow paths (analysis) | `a1-grade-slow.md` |
| A1b | Film pass and RAW stage measurements | `a1b-measure.md` |
| A1c | Film finish pass breakdown | `a1c-finish.md` |
| A2 | Grade controls not timed in 0.9.2 | `a2-grade-coverage.md` |
| A3 | Preview ceiling, Edge colour, retry rule | `a3-preview-gpu.md` |
| A4 | Library drawing gaps, marks during file commands | `a4-library.md` |
| A5 | JPEG XL, Mac coverage, leftovers | `a5-platform.md` |
| B1 | AI denoise | `b1-ai-denoise.md`, `b1-crop.png` |
| B2 | AI search and tagging | `b2-ai-search.md` |
| B3 | AI masking | `b3-ai-masking.md`, `b3-edge-crop.png` |
| C | Feature matrix | `c-feature-parity.md` |
| C2 | Competitor cells resolved | `c2-competitor-cells.md` |

## Appendix B: claims the coordinator verified

- HSL sampling rebuilds the SDR stage and bypasses `_hue_stages`
  (`hsl_sampling.py:56-109`; `render_cache.py:781,1122-1137`).
- Lens glow: 27 horizontal + vertical pass pairs every frame
  (`webgpu-preview.js:6813-6866`).
- Film finish: grain sample count `min(4, ceil(1/scale))²`; `middle` and
  `toneGain` computed per pixel; Neutral print scan bisection
  (`webgpu-shaders.js` `filmGrainStops`, `filmStockStage`, `stockPrintScan`).
- Edge colour skips the output check when the input scan found bad pixels
  (`highlight-edge-colour.js:200-207`); backend checks finiteness only
  (`highlight_edge_gpu.py:85`).
- Library device loss requeues without a limit
  (`library-gpu-raw.js:1017-1019`); failed-work key path+edges (`:931`).
- JPEG XL helper fallback and missing time limit (`jpegxl.py:488-506`).
- Mac skips: `electron-smoke.js:244-265`; `test_library_source_baseline.py:13`.
- Library cache scan opens every `.npz` (`library_file_state.py:88-112`)
  under the marks lock (`library_file_commands.py:264-277`).
- Library pipeline created synchronously while an async build is pending
  (`library-gpu.js:153,162-175`).
- TIFF export absent (`exporters.py`, export guide).
- Licences: RawNIND weights GPL-3 + CC-BY-4.0; EfficientSAM Apache-2.0 with
  weights in the repository; SigLIP 2 Base Apache-2.0; Apple MobileCLIP
  weights research-only (product development excluded).
- Versions: Lightroom Classic 16.0 (Adobe community, NewsShooter,
  PetaPixel, November 10, 2026); PhotoLab 10.3 (DxO "what's new").

Not verified by the coordinator: Capture One's export-format page (HTTP 403
to automated reads; C2's reading is consistent with an open Capture One
user request for JPEG XL export); Adobe help pages (HTTP 403).
