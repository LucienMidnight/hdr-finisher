# Sprint brief: Denoise on the GPU, faster CPU backup and app-wide logs (November 21, 2026)

**Owner:** Steve. **Coordinator:** Claude (Opus 5.5): keeps this brief
current, checks every report, merges the packages and takes decisions to
Steve one at a time.
**Workers:** Codex `gpt-6.2-sol` at high effort, one per work package, each in
its own worktree made from `feat/denoise-v1`.
**Base:** `feat/denoise-v1` at the commit that adds this brief (parent
`e0257bad`).
**Timebox:** development on November 21–22, 2026. Steve tests by hand after
integration and expects to find bugs then. Round 2 (added the evening of
November 21, after Steve's first MacBook Neo test and an outside review)
front-loads PC work that helps both machines, then moves to MacBook Neo
memory work overnight. See "Round 2 · Review follow-up".

`AGENTS.md` applies to every package, especially "How much to test", the
GPU-route rules, "Stop and ask" and the GPU run lock. Where this brief and
`AGENTS.md` disagree, `AGENTS.md` wins, except for the testing timetable below,
which Steve set for this sprint.

## Why this sprint

On the 8 GB MacBook Neo, Clean Grain on a 42 MP Sony sometimes takes about
26 s instead of about 3.5 s. The noise measurement runs on the graphics card,
then the heavy preparation silently moves to the CPU. The app remembers the
first failure for that photo and never retries. Nothing in the logs says why.
The same photo stayed on the graphics card in every PC test, including at
the Neo's likely 2 GiB graphics setting. The likely triggers are whole-machine
memory pressure in shared memory or a one-off GPU or transport error. The
PC tests could not prove which.
[PC measurements and fallback map](denoise-gpu-fallback-memory-2026-11-21.md)

Three problems follow, and Steve approved all three on November 21:

1. **We can't see what happened.** The app is mostly written by agents.
   Logs must let an agent reconstruct any session quickly and accurately,
   across the whole app, not just Denoise.
2. **The CPU backup is far too slow.** It cleans the whole photo before
   showing anything: about 17.5 s of preparation on the Mac Sony and about
   18 s again after each Grain Evenness release.
   [November 21 Mac waits](../performance-table.md#november-21--denoise-cpu-fallback-waits)
3. **Large photos never use the graphics card.** Fine and Clean Grain refuse
   any photo whose long edge exceeds 8,192 pixels, just above 44.8 MP for a
   3:2 frame. New high-resolution Sony bodies make 50 MP and 61 MP files.

## How to use this brief

- Each package has an ID, a status and a definition of done. Workers update
  only the status column of their own package, with a one-line result, and
  report to the coordinator. The coordinator edits everything else.
- "What we know" is a starting point, not an order. Confirm causes in the
  code; if the code disagrees, say so in the report.
- Mark any change to rendered pixels as an **output change** in the commit
  message. Run the matching agreement checks. Never loosen a tolerance.
- When a package is merged, record its outcome in the module PRDs named in
  the package, in the same commit as the code. When the whole sprint is
  finished, this brief moves to `docs/technical/archive/briefs/`.

## Status board

| ID | Package | Branch | Depends on | Status |
| --- | --- | --- | --- | --- |
| LOG-1 | Logging foundation and GPU Grain route robustness | `sprint/logging-foundation` | — | done, merged Nov 21 (`e4847957`): locked PC replay showed eviction, numbered refusal, CPU preparation, one retry and final GPU picture under one action |
| CPU-1 | Faster CPU Grain backup: visible area first, then root speedups | `sprint/cpu-grain-speed` | — | done, merged Nov 21 (`16de955f`), byte-identical. PC, Sony Clean Small at 110%: first sharp picture 21.94 → 4.25 s, Evenness release 19.62 → 2.63 s, peak RAM 2.39 → 2.33 GB. Whole-photo preparation only ~10% faster: 30% target left as open work (wavelet and colour filters dominate) |
| GPU-1 | Fine, Clean and Micro Grain on the GPU above 8,192 pixels | `sprint/gpu-large-photos` | — | done, merged Nov 21 (`5f8a2946`): 50 MP and 61 MP Fine and Clean Small stay on the GPU at 2 GiB at Fit and 110%; 50 MP Micro at 110% too. CPU agreement and 50 MP Micro at Fit checked at INT |
| LOG-2 | App-wide logging rollout | `sprint/logging-rollout` | LOG-1 merged | done, merged Nov 21 (`b60767b9`): Library, RAW, Grade, Match, Export, Proof, memory, startup/shutdown instrumented; PC session log 84,288 bytes; reason codes folded into `logging.md` |
| INT | Integration, full checks, push and Steve's hand test | `feat/denoise-v1` | all | merged and checked on the PC Nov 21 (see Integration result); pushed Nov 21 (`deb2fc6f`). Mac hand test partial (Micro Grain only; see Round 2) |
| TRI-1 | Mac triage: CPU Micro Grain reuse and reduced-preview wording | `t3/b289892f` | INT | done, merged Nov 21 (`79b10821`), byte-identical. PC: Exposure edit 81.2 → 2.0 s, HDR→SDR 79.2 → 2.4 s; first picture unchanged (~84 s, one core); peak RAM 3.86 → 3.58 GB |
| MG-1 | Micro Grain CPU: all cores and lens correction in strips | `sprint/micro-cpu-speed` | TRI-1 | to do (PC, now) |
| CG-2 | Clean Grain colour stage in C, one noise-model store | `sprint/clean-colour-native` | — | done, merged Nov 21, 859 prepared Canon and Sony tiles byte-identical. Forced-CPU Sony Clean Small: whole photo 15.69 → 14.16 s (18% faster than the original; 30% target missed), first sharp 110% 4.25 → 4.19 s, peak RAM 2.33 → 2.42 GB (one run; INT-2 re-measures paired). Mac check open |
| GPU-2 | Faster GPU Micro Grain and Fit | `sprint/gpu-grain-speed` | — | done, merged Nov 21 (`33063718`). PC Sony, finished frames byte-identical (5 pairs incl. edges and partial tiles): Fit reduction Micro 15.0 → 12.5 s, Clean 2.49 → 2.18 s. Micro slider unchanged (halo trim gave no consistent gain, dropped). AHD pooling and measurement batching not done (no measured gain). Isolated Micro Fit timing and Mac profiling open (INT-2, MEM-1) |
| ROUTE-1 | One Grain route state and clear route messages | `sprint/grain-route-ui` | — | done, merged Nov 21: GPU / CPU backup / Reduced preview label beside Method, plain reason, Retry on GPU and Switch to Clean Grain actions, CPU progress after 2 s; sampled CPU preview bytes unchanged. Look awaits Steve (R2-5); lens-corrected Micro crop not captured |
| MG-2 | Micro Grain CPU: visible area first | `sprint/micro-cpu-visible` | MG-1 merged | to do (PC, after MG-1) |
| MEM-1 | One memory budget on the MacBook Neo | `sprint/mac-memory` | MG-1, GPU-2 merged | to do (overnight; Mac measurements) |
| QUAL-1 | Exposure-independent quality fixes (output changes) | `sprint/grain-quality` | CG-2 merged | to do; needs Steve's visual sign-off before any default changes |
| FOLD-1 | Fine Grain folded into Clean Grain, with a cleaning checkbox | `sprint/fold-fine-grain` | CG-2, GPU-2, ROUTE-1 merged | done locally: colour cleaning checkbox defaults on; Sony HDR and SDR Fit captures byte-identical on each route with it on, and off-mode CPU/GPU mean / p99 0.055 / 0.161 HDR and 0.031 / 0.765 SDR; Canon and Sony crops ready |
| INT-2 | Round 2 integration, full checks, push and hand test | `feat/denoise-v1` | all round 2 | to do |

LOG-1, CPU-1 and GPU-1 run in parallel on November 21. LOG-2 starts once
LOG-1's foundation is merged. INT runs at the end of November 22.

Round 2: MG-1, CG-2, GPU-2 and ROUTE-1 run in parallel on the PC first.
MG-2 follows MG-1. MEM-1 starts overnight once MG-1 and GPU-2 are merged,
with its measurements on the MacBook Neo. QUAL-1 builds review crops but
changes no default until Steve has looked at them.

## Rules shared by every package

### Testing timetable (Steve, November 21)

- **During development:** fast targeted checks only. Run unit tests for the
  modules you touched, a syntax check of changed JavaScript and the focused
  Python tests. Do not run the full Node or Python suites, release drivers or
  sweeps.
- **One short real-app measurement per package** is allowed, and expected
  where the package promises a speed or memory gain. Keep it to five minutes
  of locked machine time, through `codebase/tools/gpu-run-lock.py`.
- **Full suites and release drivers** run once, at integration (INT).
- Steve's PC GPU has intermittent bad VRAM. Rerun a GPU failure once before
  treating it as a code fault, and say so.
- Never write to `D:\Photos`. Copy inputs into the shared test-photo folder
  or scratch first.

### Commits and branches

- Commit locally in small commits on your package branch. Do not push, pull,
  rebase onto other branches or merge. The coordinator merges into
  `feat/denoise-v1` and asks Steve before pushing.
- The Mac may also push to `feat/denoise-v1`. Do not fetch it into your branch;
  the coordinator handles that during merging.
- Keep to the files your package owns where you can (see each package). If
  you must edit a file another package owns, keep the edit small and name it
  in your report.

### Quality, memory and speed limits (unchanged)

- CPU and GPU routes must agree within the existing perceptual limits: HDR
  ΔE ITP and SDR ΔE 2000 mean **<1** and p99 **<3**. Delivery adds p99.9
  **≤3**. The finished HDR peak is exact at the saved target before encoding.
  [Denoise requirements](../../product/modules/denoise.md#4-quality-and-performance-requirements)
- Memory: 4 GB whole-app ceiling, 2 GB system reserve and the graphics budget
  rules in [Memory and caches](../../product/modules/memory-and-caches.md).
  Design for the 8 GB MacBook Neo, where graphics memory is shared with the
  rest of the app. Work in bounded pieces; never hold a whole native photo
  on the graphics card when tiles or strips will do.
- Speed: measure action to settled picture, before and after on the same
  machine. PC and Mac numbers are separate baselines and are never compared.

### The log event contract

LOG-1 builds this. CPU-1 and GPU-1 emit their new decisions in this shape
from the start, through the backend `log()` in Python and through the
LOG-1 API in JavaScript once it is merged. Until then use `recordStage`
with the same event and reason names, and the coordinator converts them
during the merge. LOG-1 may refine the details. Any change goes into
`docs/technical/logging.md` and this section.

- **One event per line, machine-readable.** Each line holds a JSON object,
  written through the existing rotating `backend.log` pipeline. Keep the
  existing `[library] <event> {json}` lines readable by current tools and
  tests.
- **Always-on for decisions, warnings and errors.** These must not depend on
  `instrumentationEnabled`. High-rate detail (per-frame, per-tile) stays
  opt-in or is summarised as counts.
- **Required fields:**
  - `time`, plus a per-process `seq`;
  - `proc`: backend, main, renderer role or delivery worker;
  - `area`: app, library, grade, denoise, gpu, memory, raw, export, proof or
    match;
  - `event`, in snake_case;
  - `level`: info, warn or error;
  - `action`: a correlation id;
  - `photo`: a source identity and file name where relevant.
- **Correlation.** Each user action gets an `action` id that follows its work
  across renderer, main, backend and helpers. For example: open photo, choose
  method, zoom, slider release, export. Pass it on backend requests as a
  header and include it in every event the action causes. Log
  `action_started` and `action_finished` with outcome and duration.
- **Decisions name the route and a stable reason code.** Every route choice,
  fallback, refusal, retry, cancellation and eviction says what was chosen
  (`route`: gpu, cpu, cpu_reduced or refused), why (a `reason` from the
  documented catalogue, such as `gpu_budget_exceeded`,
  `source_too_large`, `gpu_validation_error`, `transport_timeout`,
  `device_lost`, `prior_failure_latched` or `unsupported_lens_correction`),
  and the numbers behind it.
- **Numbers carry units in their names** (`requested_bytes`, `budget_bytes`,
  `resident_bytes`, `app_ram_bytes`, `system_free_bytes`, `duration_ms`).
  Memory decisions log a snapshot: request, budget, resident and allocator
  bytes, sampled app RAM and system free memory.
- **Session header.** At startup, log app version and commit, platform,
  RAM, GPU adapter and limits, graphics budget and how it was chosen, the app
  memory setting and log location.
- **Bounded.** Collapse repeated identical events into one with a count. Never
  log pixel data, secrets or full request bodies. File paths are fine; the
  log is local.

## LOG-1 · Logging foundation and GPU Grain route robustness

**Goal.** Any agent can open the logs from a PC or Mac session and say
exactly what happened, in what order and why. Start with the Grade Grain
route, because it is the open incident.

**What we know.**
- The backend writes `[library] event {json}` lines to stderr. Electron's
  main process collects them into `<userData>/logs/backend.log`, which rotates
  with seven backups (`desktop/main.js` around line 311,
  `desktop/lib/rotating-log.js`, `desktop/lib/backend-log.js`).
- The renderer sends only console warnings and errors there
  (`renderer_console`, `desktop/main.js` around line 1133).
- Renderer route decisions go only to the in-memory `recordStage` buffer, and
  only while instrumentation is on (`webgpu-preview.js` around line 1080).
  That is why the Mac incident left nothing.
- `reserveFineGrain` refuses when
  `max(resident, allocator) + request > 0.9 × budget`. The catch around line
  6905 adds the source to `fineGrainFailedSources` with no retry and no
  expiry. The key covers both Clean sizes and generated HDR and SDR, at every
  zoom. See the fallback map in the PC measurements brief.

**Build.**
1. The logging foundation in the contract above:
   - a small renderer API (`diagnostics.event(...)` or similar);
   - a transport to `backend.log` that does not block rendering and survives
     a crash of the renderer or GPU process;
   - action correlation across processes, including the `X-…` request
     header;
   - backend helpers that keep existing lines compatible;
   - the session header;
   - repeat collapsing and a size bound.
2. **Grade Grain route robustness:**
   - log every Grain route decision and fallback with its reason and memory
     snapshot;
   - before refusing a reservation, release unpinned, rebuildable resources
     from old views and other lanes, keeping the visible picture;
   - classify failures: retry once after a temporary memory or transport
     failure, once budget has recovered or the device has been rebuilt, and
     let the failure key expire; keep size, validation and unsupported-input
     failures sticky but logged;
   - log the CPU preparation the fallback starts, with the same action id.
3. **`docs/technical/logging.md`:**
   - where the logs are on Windows and macOS, and how rotation works;
   - the format and the reason-code catalogue;
   - how to follow one action;
   - investigation recipes, such as "why did Denoise go to the CPU?" or "why
     did export fail?".
4. **`codebase/tools/log_timeline.py`:** filters by action, photo, area or
   time and prints a readable timeline, plus a summary of fallbacks, refusals,
   errors and memory peaks. It accepts rotated files.

**Owns.** The new frontend diagnostics module; `desktop/main.js` and
`desktop/lib/*log*`; backend log helpers; the reservation, fallback and
failed-source code in `webgpu-preview.js`; `docs/technical/logging.md`;
`tools/log_timeline.py`.

**Done when:**
- Fast tests pass, and new unit tests cover the API, transport, collapsing,
  correlation and the retry rules.
- A short real-app run that forces a refusal (for example with a small
  explicit graphics budget) produces a log in which `log_timeline.py` shows
  the action, the refusal reason with its numbers, the eviction, the retry and
  the final route.
- `docs/product/modules/denoise.md`, `preview-and-gpu.md` and
  `memory-and-caches.md` describe the new behaviour.
- The foundation commit is reported to the coordinator as soon as it exists,
  so the other packages can use it.

## CPU-1 · Faster CPU Grain backup

**Goal.** When Grain has to use the CPU, the sharp picture at native zoom
appears in a few seconds instead of about 20, and the whole photo prepares
faster. Target one day for step 1.

**What we know.**
- `POST …/denoise-grain` runs the whole native photo through
  `GrainPreparation` before it returns a token. Region reads come from a
  16-bytes-per-pixel scratch file (`denoise_measurement.py` around lines
  323–443, `denoise_grain.py` `GrainPreparation`).
- The whole-photo grain fit is cheap. One Mac log shows 1.54 s of a 26.36 s
  preparation.
- Tiles are 512 px with a 66 px wavelet margin, plus 40 px (Small) or 76 px
  (Large) for colour. Clean Small processes about 2.2× the pixels it keeps.
- Older per-worker sums put the wavelet at about 70% of the work, colour at
  about 20% and file writes at about 10%. The writer seeks and writes row by
  row under one lock.
- Every CPU preview after an Exposure edit measures noise again. That costs
  0.3–0.6 s per edit on the Mac.
- The GPU route already computes the visible area first and fills the rest as
  you pan. CPU-1 step 1 makes the CPU route do the same.

**Build, in order:**
1. **Visible area first, with an identical picture.**
   - Return the preparation token after the fit.
   - Compute tiles on demand: a region read computes or waits for exactly the
     tiles it needs, at high priority, with no duplicate in-flight work.
   - Background workers fill the remaining tiles at lower priority through
     the existing CPU pool.
   - Fit-size reads wait for the tiles they cover. Keep the existing quick Fit
     picture behaviour.
   - Cancellation, the scratch allowance, Fine-to-Clean reuse and Library
     draws keep working.
   - Release of Grain Evenness and Splotch Size changes benefits the same
     way.
2. **Cache the noise model** for CPU previews by source identity, rendition,
   geometry, processing size and measurement version, not by Exposure or
   finishing revision. Share in-flight work.
3. **Speed up the root**, after profiling with the Sony at native size.
   - Exact changes first: fewer GIL-bound small operations, larger tiles or
     shared margins within a stated memory bound, a fused or native colour
     stage, and contiguous band writes in place of per-row seeks.
   - Changes that alter pixels are allowed only within the CPU/GPU limits
     above. Show Steve crops before making one the default; this is a
     decision for Steve.

**Owns.** `denoise_grain.py`, `denoise_measurement.py`, `denoise_adaptive.py`,
`denoise_filters.*`, the CPU preview noise-model cache in `render_cache.py`
and their tests. Frontend changes only if the region-read protocol needs them.

**Done when:**
- Fast tests pass. Prepared pixels are byte-identical to the old route for
  the exact changes, checked on a Canon and a Sony native tile set.
- One short PC run with forced CPU Grain on Sony `_DSC7970.ARW` Clean Small
  records, before and after:
  - enable at 110% to the first sharp picture;
  - Grain Evenness release;
  - whole-photo preparation time;
  - peak app RAM.
- Targets: the first sharp picture at 110% in under a quarter of the baseline
  wait; the whole-photo preparation at least 30% faster; peak memory no
  higher.
- New decisions follow the log contract.
- `denoise.md` and `performance-table.md` are updated.

## GPU-1 · Grain on the GPU above 8,192 pixels

**Goal.** 50 MP and 61 MP photos keep Fine, Clean and Micro Grain on the
graphics card in Grade, in bounded pieces, within the Neo's 2 GiB graphics
setting.

**What we know.**
- `measureFineGrain` throws when `max(W, H) > 8192` (`webgpu-preview.js`
  around line 6657). The fit reads full-width strips of 582 rows, so a wide
  photo also widens every strip texture.
- The device texture limit (`maxTextureDimension2D`) can be 8,192 on some
  adapters.
- The exact Fit reduction uses full-width source strips. Micro Grain already
  works in bounded regions but has its own band sizes. Source transport
  chunks are 8 MiB.
- Grain statistics are sums, so horizontal chunks with the right halos can
  reproduce the whole-width fit exactly.

**Build.**
- Process the fit in horizontal chunks as well as row strips, with halos,
  combining only the statistics.
- Audit and fix every other width or height assumption in Grade Grain: Fit
  reduction strips, tiled regions, colour halos, Micro bands, transport and
  readback. Respect the device's real texture and buffer limits rather than a
  fixed 8,192.
- Log any refusal that remains with the contract's reason codes.

**Test inputs.**
- **50 MP:** `D:\Photos\Play_Raw\House barges on the Thames - Pberg\DSC00636.ARW`,
  supplied by Steve. It is a Sony at 8660 × 5784 (8672 × 5784 raw), RGGB.
  `D:\Photos` is read only, so copy the ARW into the shared test-photo folder
  first and never copy its sidecars back.
- **61 MP:** there is no real file. Use a synthetic large linear source of
  about 9504 × 6336 for functional and memory checks, and say so in the
  report.

**Owns.** The Fine/Clean fit, the Fit reduction and the strip-upload code in
`webgpu-preview.js`; Grain WGSL in `webgpu-shaders.js`; `micro-grain-gpu.js`;
`source-transport.js` as needed. Avoid the reservation and fallback functions
that LOG-1 owns.

**Done when:**
- Fast tests pass, including a unit test of the chunked fit against the
  unchunked fit on a source that fits both.
- One short PC run at a 2 GiB graphics setting shows 50 MP and 61 MP Fine and
  Clean Small staying on the GPU at Fit and 110%, with the reservation bytes
  and peak memory recorded.
- GPU results agree with the CPU route within the limits above.
- `denoise.md`, `preview-and-gpu.md` and `performance-table.md` are updated.

## LOG-2 · App-wide logging rollout

**Goal.** The same quality of logs everywhere, not just Denoise.

**Build.** Using LOG-1's API and contract, instrument each area's actions,
route decisions, refusals, retries, cancellations and errors:
- Library opening and drawing;
- RAW development;
- Grade preview routes (Direct or Tiled, GPU or CPU, render failures, device
  loss and rebuild);
- Match;
- Export and Proof (GPU or CPU delivery, ceiling retries, encoder helpers);
- memory guardrails and cache trims;
- startup and shutdown.

Convert the important existing ad-hoc stages and logs to the contract. Keep
lines existing tests parse readable. Extend the reason catalogue and the
investigation recipes in `docs/technical/logging.md`.

**Owns.** Instrumentation lines across the app. It starts after CPU-1 and
GPU-1 are merged where it touches their files.

**Done when:**
- Fast tests pass.
- A short scripted session (open a folder, open a photo, Denoise, zoom,
  export) produces a log that `log_timeline.py` turns into a correct story,
  with every route decision explained.
- The log size for that session is recorded.

## INT · Integration and hand test

The coordinator:
1. Merges the packages into `feat/denoise-v1` in the order LOG-1, CPU-1,
   GPU-1, LOG-2, resolving conflicts and converting any interim
   `recordStage` decisions to the contract.
2. Runs the full fast Node and Python suites plus the Denoise, Grade and
   delivery GPU drivers that cover the changes, once, and compares failures
   with the pre-sprint baseline.
3. Asks Steve before pushing.
4. Gives Steve a short hand-test list for the PC and the MacBook Neo,
   including how to send back the log.

### Integration result (November 21)

All four packages and the triage fixes are merged on `feat/denoise-v1`.
Full fast suites: Node 1,157 tests, one failure (tooltip catalogue, also
failing on the pre-sprint base); Python 4,372 passed, 63 failures that also
fail on the base (Denoise research tools and machine tooling), one new
failure fixed. Thirteen GPU drivers plus the Library quick check ran once
on the Windows PC (about 25 minutes locked):

- Passed: export parity, preview/export comparison, GPU delivery repeat and
  ceiling, HDR ceiling delivery, Proof/Grade diagnostic, batch export,
  progressive disclosure, Library quick check.
- Fixed in triage and re-run passing: large-photo Grain parity (a peak
  measurement overwrote a visible tile's parameters while Grade waited for
  CPU Grain), GPU delivery smoke (the quick Fit picture hid a GPU validation
  failure), adaptive parity (driver updated for the Clean Grain default; an
  unlogged-preparation exception fixed).
- Pre-existing, unchanged: `denoise-zoomed-region.js` (fails the same way on
  the base); `gpu-denoise-measurement.js` (missing EXR fixture, AGENTS.md
  item 6).
- Open work: the CPU-1 30% whole-photo preparation target (about 10% reached;
  wavelet and colour filters dominate). Round 2 gives it to CG-2.

### Hand test (Steve, after integration)

Run the app from the sprint branch on each machine. Before you start, note
the time, so the matching part of the log is easy to find. After testing,
choose **Help → Open logs** and send the coordinator the `backend.log` file
from that folder, plus any `backend.log.1` with the same date.

**Windows PC**

1. Grade the 42 MP Sony `_DSC7970.ARW` with Clean Grain Small. At Fit, then
   at 110%, the sharp picture should arrive within a few seconds. Drag Grain
   Evenness and release it: the picture should settle within about 3 s.
2. Forced CPU backup: in Settings, set **Maximum GPU memory for previews** to
   Custom 0.25 GiB (the lowest), then turn Clean Grain off and on again at
   110%. If the app uses the CPU, the sharp picture should still appear in
   about 5 s. If it stays on the graphics card, that is fine too. Set the
   limit back to **Auto**: the next change should use the graphics card.
3. Large photo: copy `D:\Photos\Play_Raw\House barges on the Thames - Pberg\DSC00636.ARW`
   to a working folder first (do not edit it in `D:\Photos`). Grade it with
   Fine, Clean Small and Micro Grain at Fit and 110%. Each should look like
   the 42 MP photo does: no blocks, seams or colour bands.
4. Export the 50 MP photo as JPEG and as AVIF with Clean Grain, then open the
   Proof for one. They should match what Grade showed.
5. Ordinary use for ten minutes: open a folder in the Library, scroll, open
   photos, zoom, export one. Nothing should feel slower than yesterday.

**MacBook Neo**

1. Same as PC steps 1 and 2 on `_DSC7970.ARW`, using the Mac's default
   settings. The CPU backup there works on fewer pieces at once, so note the
   time to the sharp picture at 110%.
2. Repeat the original problem: Clean Grain on the 42 MP Sony, then zoom and
   adjust for a few minutes. If the picture ever takes about 25 s, write down
   the time. The log now records why the CPU was used.
3. If the 50 MP Sony is on the Mac, repeat PC step 3 once.

The hand test on the Mac is also the first chance to catch the original
incident with the new logs.

## Round 2 · Review follow-up (November 21 evening)

### Why

Steve's first MacBook Neo test (18:47 WIB, Micro Grain only, `_DSC7970.ARW`
with lens correction at 78%) found:
- CPU Micro Grain took about 50 s (70 s from the first click);
- app memory reached 4.3–4.9 GB against the 4 GB ceiling;
- it prepared again after view changes;
- the reduced 4,096 px preview read as an error.

TRI-1 fixed the repeats and the wording. Steve then asked for an outside
review of the Denoise module (Gemini 4 Neon, high thinking, read-only)
covering:
1. the methods;
2. the architecture and speed;
3. memory on the MacBook Neo.

Steve accepted its recommendations. The coordinator checked every claim
against the code; the corrections are below. Steve's order: PC work that
helps both machines first, MacBook Neo memory overnight.

### Review findings, as checked in the code

Each line gives the finding, what the code shows and where it went.

**Methods**
- *Fixed linear thresholds make protection depend on exposure.*
  - True for `colour_delta` (`denoise_grain.py`: highlight 0.065–0.125,
    texture background 0.004–0.015, dark 0.006–0.014).
  - Partly true for Micro's `_highlight_guard`: its edge threshold is
    already noise-relative, with a 0.007 floor; only the 0.12 seed is fixed.
  - Partly true for `raw_speck_cleanup.ABSOLUTE_FLOOR`, which is a floor
    beneath a noise envelope.
  - → QUAL-1.
- *The Bayer noise fit is unweighted and skips the deepest blocks.*
  - True: `raw_pixel_cleanup._fit` is an unweighted least squares over
    about 12 binned medians, and drops blocks with mean ≤ 0.0001.
  - Binning reduces, but does not remove, the bright-bin pull.
  - → QUAL-1.
- *Micro re-quantises to `uint16` before AHD and clips signed shadows.*
  - True, but it only clips values more than the black level below black
    (`BayerTile.apply`).
  - → QUAL-1 measures how often this happens before changing anything.
- *The brightness channel weights R, G and B equally, not as ACEScg
  luminance; the noise variance comes from one Y; bands 2–4 are
  extrapolated from bands 0–1.*
  - All true (`OPPONENT`, `_noise_variance`, `estimate_adaptive_model`).
  - The equal-weight opponent transform is orthonormal, which keeps the
    noise per channel predictable. Changing it is research, not a fix.
  - → QUAL-1 research item, with no default change.
- *Half-strength shadow-only guided colour pass* (researched: 11–12% less
  Canon shadow mottling, no regressions on the marks) → QUAL-1 option.
- *Variance-stabilising transforms are not suitable after demosaic for
  signed HDR.* Agreed; no work.

**Architecture**
- *About 37 WGSL shaders mirror the Python and C by hand.*
  - True. The example given, the colour-pair diagonal (`select(8, 20, …)`
    against `round(reach/√2)`), does agree for the only reaches used (12
    and 28).
  - → No rewrite. CG-2 and GPU-2 add a shared-constant check where they
    touch the code.
- *Four separate stores for the same noise model.*
  - True: `denoise_measurement._models` (plus disk), `main._DENOISE_MODEL_CACHE`,
    `render_cache.cpu_denoise_model`, and `pendingByDevice` in the browser.
  - → CG-2 consolidates the backend three; the browser one stays.
- *Three overlapping GPU-fallback state machines.*
  - True: `grain-route.js` `Failures`, `runtime.microCpu` in `denoise-ui.js`,
    and `gpuFailurePolicy` in `preview-pipeline.js`.
  - → ROUTE-1.
- *Fine Grain is Clean Grain with Color Splotches at 0.*
  - True in the code: `clean = method == "clean_grain" and splotches > 0`.
  - Folding it in is a product decision → Decision R2-1 for Steve.
- *The CPU computes 13 fixed calibration constants by Monte Carlo at run
  time, while the browser already hardcodes them.*
  - True (`_quantile_calibration`, `_tail_reference`, and the hardcoded
    constants in `denoise-measurement.js`).
  - → CG-2: use the constants, with a unit test that recomputes them.

**Speed**
- *CPU Micro Grain renders tiles on one core, and its model estimate uses
  `workers=1`.*
  - True (`MicroGrainSource.render`).
  - The native kernels are called through `ctypes`, which releases the
    GIL, so threads can scale.
  - → MG-1.
- *Visible area first for CPU Micro with lens correction* → MG-2.
- *GPU Micro Grain:*
  - Running the Clean Grain passes over the padded area is redundant
    outside what the output reads. The reviewer's re-check proved this:
    `microOutputMain` reads only the tile, so `repair`/`microColourDelta`
    need at most tile + 32 px and `luma`…`guides` tile + 72 px, against a
    736² padded area for a 512² tile. GPU-2 still measures the time saved
    before changing it.
  - `resizeNativeFineGrain` waits for the GPU after every strip. True.
  - AHD buffers are made new for every region (`micro-grain-gpu.js`). True.
  - → GPU-2.
- *Clean Grain's colour stage is half of CPU Clean Grain time.* Matches the
  performance table. → CG-2, which also owns CPU-1's open 30% target.
- *Overlap strip fetches with GPU work in `measureFineGrain` and
  `resizeNativeFineGrain`* → GPU-2, measure first.

**Memory**
- *GPU Grain admission ignores whole-app memory on unified-memory Macs.*
  True: `reserveFineGrain` checks only the graphics budget. → MEM-1.
- *GPU cache reclaim never runs while background work holds a scope.*
  - True (`reclaimGrainResources` returns early).
  - The guard exists because a render can hold an unregistered texture.
  - Deferring alone is not enough. `reserveFineGrain` is itself called
    inside renders and scopes, so it would still refuse and drop to the CPU
    (reviewer's re-check).
  - → MEM-1 keeps the guard. It defers reclaim triggered by background
    pressure, and lets a reservation inside a render reclaim the entries
    that render has not pinned.
- *The Micro source is not counted in `app_memory`.*
  - The CPU copy is now counted (TRI-1).
  - The GPU route's module-level `_recent_source` (sensor plus up to
    256 MiB of Bayer tiles) still is not.
  - → MG-1.
- *Lens correction builds whole-frame coordinates (1,017 MB on 42 MP).*
  - True (`apply_lens_correction`; memory PRD census).
  - `lensfunpy` accepts a region (`xu, yu, width, height`), so strip
    coordinates are possible.
  - → MG-1 for every caller (RAW development, Micro, delivery).
- *Narrower scratch texture formats; keep float32 maths.* → MEM-1, after
  GPU-2. Check storage-format support on both machines.
- *Memory-mapped read-only sources on 8 GB machines.* A large change →
  MEM-1 proposal only, Decision R2-3.
- *Stop whole-photo background CPU tile fill on 8 GB machines.* True:
  `_ensure` queues every remaining tile. → MEM-1, gated on memory pressure.
- *Trim Library cache shares while Grade has a large photo open on 8 GB.*
  A size change → MEM-1 proposal, Decision R2-2.
- *Library pressure ignores retained Grade bytes* (`grade_bytes_provider`).
  This is intended for Library admission. → MEM-1 confirms that Grade's
  own admission counts them.

**Telling the user**
- *"Denoise cache ready." shows even after a CPU fallback.* True
  (`denoise-ui.js`). → ROUTE-1.
- *A route label next to the Method menu (GPU, CPU backup, Reduced preview,
  Paused), with a plain reason and a one-click action.* → ROUTE-1.

**Measure before acting** (reviewer's list, adopted):
- the real cause of the Mac Clean Grain fallback, from the Mac logs;
- the Neo's texture limits and 50 MP behaviour;
- a Metal profile of GPU Micro Grain;
- pixel drift checks for QUAL-1;
- storage-format support.
These are owned by MEM-1, GPU-2 and QUAL-1 as noted.

### Shared rules for round 2

- The round 1 rules apply: the testing timetable, commits and branches, the
  limits and the log contract.
- MG-1, CG-2, GPU-2, ROUTE-1, MG-2 and MEM-1 must be **byte-identical**
  unless a package says otherwise. A pixel change is an output change and
  goes to Steve.
- Workers write short reports. They do not delete files (no `Remove-Item`,
  `rm` or `rmdir`); the coordinator cleans up.
- One short locked measurement per package, as in round 1.

### MG-1 · Micro Grain CPU: all cores and lens correction in strips

**Goal.** CPU Micro Grain (Grade with lens correction or crop, export and
full-size Proof) uses the available cores, and lens correction never holds
whole-frame coordinates. Helps both machines.

**Build.**
1. Run `MicroGrainSource.render` tiles and the model estimate
   (`estimate_adaptive_model_from_windows`) through the existing CPU budget
   (`cpu_budget.CpuWorkLimit`/`CpuExecutor`). Choose worker counts so peak
   memory stays within the `WORKING` allowance on an 8 GB machine.
   Cancellation and TRI-1's shared work must keep working.
2. Compute Lensfun coordinates per output strip (`lensfunpy` region
   arguments) and remap strip by strip. Bilinear maths stays unchanged.
   This applies to every `apply_lens_correction` caller.
3. Count the GPU route's retained Micro source (`_recent_source`) in
   `app_memory` with a trim hook.
4. Inside worker tiles, bound OpenCV's own thread count so six cores are
   not oversubscribed. Size concurrency from the measured bytes per tile
   (about 120–160 MB of working arrays) within `WORKING`.
5. Make the window reads behind the model estimate safe for parallel
   callers. `denoise_adaptive._WindowSource._windows` is an unlocked dict.
   Coordinate this small edit with CG-2, which owns `denoise_adaptive.py`.
6. `MicroGrainSource` estimates its model afresh on every construction.
   Either route it through CG-2's single model store after CG-2 merges, or
   state that it stays separate in round 2.

**Owns.** `denoise_micro_grain.py`, the lens-correction code in
`raw_import.py`, `render_cache.py` `micro_preview_source`,
`_build_micro_preview` and `close_micro_preview`, `cpu_budget.py` if
needed, and their tests. Micro Grain calls `denoise_grain.colour_delta`, so
CG-2's C port also speeds up MG-1; INT-2 re-times Micro after both merge.

**Done when:**
- Output is byte-identical, for Micro and for RAW development with lens
  correction, on a Canon and a Sony with a lens profile.
- One short PC run on `_DSC7970.ARW` records the Grade first picture (TRI-1
  baseline about 84 s), Micro JPEG export time and peak app RAM.
- `denoise.md`, `memory-and-caches.md` (lens census) and
  `performance-table.md` are updated.

### MG-2 · Micro Grain CPU: visible area first

**Goal.** At 100% and above, CPU Micro Grain with lens correction shows the
sharp visible area in a few seconds, like CPU-1 did for Clean Grain. Fit
keeps a quick reduced picture first.

**Build.**
- Map the viewport back through the lens and geometry. Sample every edge,
  not only the corners, and add a stated margin.
- Develop only those Bayer regions, at high priority. Fill the rest through
  a memory-gate function, which defaults to the current `app_memory`
  pressure level. MEM-1 later replaces it with the shared gate.
- If the mapping is unbounded or extreme, fall back to the whole frame and
  log why.

**Owns.** The same files as MG-1, after MG-1 is merged; Micro region reads
in `main.py`.

**Done when:**
- Visible pixels are byte-identical to the whole-frame result.
- One short PC run records the first sharp picture at 110% and a pan into
  an unprepared area.
- Docs are updated.

### CG-2 · Clean Grain colour stage in C, one noise-model store

**Goal.** Finish CPU-1's open 30% whole-photo target and remove duplicate
caches.

**Build.**
1. Move the hot loops of `denoise_grain.colour_delta` and `_colour_pass`
   into `denoise_filters.c`. Rebuild the binaries on both platforms, as the
   existing native filters do; setup builds them on the Mac.
   - Keep the OpenCV primitives (`boxFilter`, `medianBlur`, `dilate`,
     `magnitude`) where replacing them would change rounding.
   - Build the C with strict floating point (no FMA contraction:
     `-ffp-contract=off`, `/fp:precise`) and keep NumPy's operation order.
2. Put the backend noise model in one store, `denoise_measurement.py`, with
   shared in-flight work. Remove `main._DENOISE_MODEL_CACHE` and the separate
   CPU-preview store, keeping their keys' meaning.
3. Replace the run-time Monte Carlo calibration with fixed constants, plus
   a unit test that recomputes them.
4. Add a check that the colour-pair offsets and other shared constants
   agree between Python and WGSL.

**Owns.** `denoise_grain.py`, `denoise_filters.*`, `denoise_measurement.py`,
`denoise_adaptive.py`, `render_cache.py` `cpu_denoise_model` and its model
flights, the model cache in `main.py`, and their tests.

**Done when:**
- Prepared pixels are byte-identical on the Canon and Sony tile sets. If
  the C code can only match within float rounding, stop and report; that
  is Steve's decision.
- One short forced-CPU run on the Sony Clean Small records whole-photo
  preparation against the CPU-1 baseline (target at least 30% faster than
  the original), first sharp picture at 110% and peak RAM.
- Docs are updated.

### GPU-2 · Faster GPU Micro Grain and Fit

**Goal.** Micro Grain slider updates at 110% move towards the 0.30 s
target (now 0.70–0.80 s on the Mac Canon), and the cold Fine/Clean Fit
gets faster.

**Build, measuring first** (GPU timestamps where available, otherwise
stage timings):
- Find where the Micro late passes spend time.
- Reduce the Clean Grain work over the padded area only where the halo is
  provably unused.
- Reuse AHD buffers and textures across regions within the reservation.
- Remove per-strip `onSubmittedWorkDone` waits in `resizeNativeFineGrain`
  and Micro Fit where ordering does not need them. Cap the strips in
  flight (about two), so their transient textures and buffers do not pile
  up in the Neo's shared memory.
- Overlap strip fetches with GPU work in `measureFineGrain` and
  `resizeNativeFineGrain`, and batch submits in `denoise-measurement.js`.
- Drop any item that measures below a visible gain.

**Owns.** The Grain encode, fit and resize code in `webgpu-preview.js`;
`micro-grain-gpu.js`; `denoise-measurement.js`; Grain WGSL. Avoid the
reservation and reclaim functions (MEM-1) and the route and failure code
(ROUTE-1).

**Done when:**
- GPU output is identical to before on the same machine, including tiles at
  the photo's edges and regions that are not a multiple of 512 px, so a
  trimmed halo cannot change border handling.
- One short PC run records the Micro slider at 110%, Micro exact Fit and
  cold Clean Fit on the Sony, before and after.
- A note says which items should also be profiled on the Mac.
- Docs are updated.

### ROUTE-1 · One Grain route state and clear route messages

**Goal.** One place decides GPU or CPU for every Grain method, and the user
always sees which route is in use, why, and what they can do.

**Build.**
1. Move Micro Grain's CPU latch (`runtime.microCpu`, `microFailureKey`)
   and the Grain parts of `gpuFailurePolicy` into `grain-route.js`. Keep
   the AGENTS.md rule: one GPU try, a second only for temporary failures,
   otherwise the CPU.
2. Add a small route label beside the Denoise Method menu: **GPU**, **CPU
   backup**, **Reduced preview** or **Paused**.
3. Add a plain status message with the reason, built from the existing
   reason codes. Examples:
   - "Micro Grain is using the CPU because lens correction is on."
   - "Using the CPU backup because graphics memory was short. Export is
     unchanged."
4. Offer one action where it helps:
   - **Retry on GPU** for temporary and memory failures;
   - **Switch to Clean Grain** when Micro Grain is on the CPU.
5. Replace "Denoise cache ready." when the CPU did the work.
6. Show progress when CPU work runs longer than about 2 s. The backend does
   not report progress, so this is an elapsed-time or indeterminate
   indicator in the frontend, with no backend API change.

**Design.** Use an existing component and tokens from the component sheet
(`docs/design/component-sheet.html`) and the design guidelines. If no
existing component fits, stop and propose one; that is Steve's decision.
Save before/after screenshots for Steve's sign-off.

**Owns.** `grain-route.js`, `denoise-ui.js`, the route parts of
`preview-pipeline.js`, `viewer-status.js`, the Grain route and failure code
in `webgpu-preview.js` (`grainFailures`, `runGrainAttempt`,
`grainFailureCanRun` and their helpers), the Denoise panel markup and
styles, and their tests.

**Done when:**
- Fast tests cover each label, message and action.
- The forced-CPU, lens-correction and memory-refusal cases show the right
  label in a short real-app run, with screenshots.
- `denoise.md` and the user guide `docs/user-guide/denoise.md` are updated.

### MEM-1 · One memory budget on the MacBook Neo (overnight)

**Goal.** On unified-memory machines, graphics and CPU work share one
budget. Grade with Denoise stays under the 4 GB ceiling on the Neo without
silent slowdowns.

**Build.**
1. On unified-memory Macs, limit GPU Grain admission to the whole-app
   headroom as well as the graphics budget. Keep the configured budget as
   the upper bound.
2. Let backend memory pressure (moderate or critical) trigger GPU Grain
   cache reclaim.
   - While a render or background scope is active, defer that reclaim to
     the scope's end instead of skipping it.
   - A reservation made inside a render may reclaim the entries that render
     has not pinned, so it does not refuse and drop to the CPU when memory
     could be freed.
   - Never evict the visible picture.
3. Gate CPU background tile fill (CPU-1 and MG-2) on memory headroom and
   pressure. Under pressure, prepare tiles on demand only.
4. After GPU-2 is merged, use narrower formats for 1–2-channel Grain
   scratch textures where the device supports them as storage. The maths
   stays float32.
5. Trim the Library cache shares while Grade has a large photo open on an
   8 GB machine (Steve approved R2-2). Restore them when Grade closes.
   Record the shares and the trigger in `memory-and-caches.md`. No memory
   mapping (R2-3). If the Mac is still over the ceiling after items 1–5,
   measure the cold buffers (`retouch_original`, Micro's Bayer tile cache)
   and report before changing them.
6. **On the Mac:**
   - capture the Clean Grain fallback cause from the new logs;
   - record `maxTextureDimension2D`, the Auto budget and 50 MP behaviour;
   - profile GPU Micro Grain;
   - re-run Steve's Micro Grain hand test.

**Owns.** The reservation and reclaim code in `webgpu-preview.js`,
`app_memory.py`, the memory gate in `grain_work.py`/`denoise_grain.py`
(after CG-2), `resource_preflight.py` and their tests.

**Done when:**
- Output is byte-identical.
- A Mac run of Steve's hand-test steps (Clean Grain Small and Micro Grain
  on `_DSC7970.ARW`) stays under 4 GB with the route and reasons logged.
- `memory-and-caches.md`, `preview-and-gpu.md` and `performance-table.md`
  are updated.

### QUAL-1 · Exposure-independent quality fixes (output changes)

**Goal.** Protection follows the noise, not fixed brightness levels.

**Build, as switchable candidates beside the current defaults:**
1. Make the fixed linear levels relative to the measured noise. Change CPU
   and WGSL together. The levels:
   - `colour_delta`'s highlight ramp (0.065–0.125), texture background
     (0.004–0.015) and dark gate (0.006–0.014);
   - Micro `_highlight_guard`'s 0.12 seed and 0.007 floor;
   - `raw_pixel_cleanup.MINIMUM_EXCESS` (0.02);
   - `raw_speck_cleanup.ABSOLUTE_FLOOR` and `LIGHT_FLOOR` (0.005).
2. Weight the Bayer fit (`raw_pixel_cleanup._fit`) as
   `_fit_informative_variance` does, and keep usable deep-shadow blocks.
3. Count how often Micro's `uint16` re-quantisation clips signed shadows
   on the test RAWs. Fix it only if it occurs.
4. Optional: the half-strength shadow-only guided colour pass.
5. Research only: measured bands 2–3, a noise-weighted `fit_grain`, and
   luminance-weighted brightness.

**Done when:**
- A review page shows the candidates against the current result on Steve's
  38 Canon and 25 Sony marks, the atrium lights, and ±3 EV exposure
  shifts.
- CPU and GPU agree within the limits.
- **No default changes until Steve approves.**

### Round 2 decisions for Steve

| ID | Question | Recommendation |
| --- | --- | --- |
| R2-1 | Fold Fine Grain into Clean Grain (Clean with Color Splotches at 0)? | **Steve, Nov 21: yes.** Clean Grain stays the default. A checkbox turns off the cleaning part, giving Fine-Grain-like results; they need not match today's Fine Grain exactly. Built by FOLD-1. |
| R2-2 | Trim Library cache shares while Grade has a large photo open on an 8 GB machine? | **Steve, Nov 21: yes.** MEM-1 builds it and records the shares in `memory-and-caches.md`. |
| R2-3 | Memory-map read-only sources on 8 GB machines? | **Coordinator and reviewer agree, Nov 21: not now.**<br>- On macOS, clean mapped pages leave the physical-footprint number the app measures. The meter would drop without freeing real memory, and `safety_total` would subtract the image twice.<br>- It would write about 500 MB to the SSD for every photo opened.<br>- Grain scratch is already disk-backed, so mapping it gains nothing.<br>If MEM-1's Mac measurements still show pressure, look first at cold buffers (`retouch_original`, about 509 MB) and Micro's 256 MiB Bayer tile cache, then revisit with numbers. |
| R2-4 | Which QUAL-1 candidates become defaults? | Decide on the review page. |
| R2-5 | Route label look and wording | Decide on ROUTE-1's screenshots. |

### FOLD-1 · Fine Grain folded into Clean Grain (Steve, R2-1)

**Goal.** One Grain method instead of two. Clean Grain stays the default.
A checkbox in the Clean Grain controls turns off its cleaning part (the
colour-splotch and fringe cleaning), which gives Fine-Grain-like results.
They need not match today's Fine Grain exactly. This is an approved output
change for the checkbox-off case only. Clean Grain with the checkbox on
must stay byte-identical.

**Build.**
- Remove Fine Grain from the Method menu, saved settings, CPU, GPU and
  delivery routes, and the Fine-to-Clean reuse path. Keep one preparation
  path.
- The checkbox is saved per rendition, like the other Denoise controls.
- Follow "Design tokens always".
- No compatibility code: saved Fine Grain grades may open differently.
  Name the affected test projects in one line.
- Update the tooltip catalogue, the user guide and `denoise.md`.

**Starts** after CG-2, GPU-2 and ROUTE-1 are merged, because it touches all
their files.

**Done when:**
- Fast tests pass.
- With the checkbox off, CPU and GPU agree within the limits.
- With it on, output is byte-identical to Clean Grain today.
- Steve sees crops of off against today's Fine Grain on the Canon and Sony
  marks.

### INT-2 · Round 2 integration

The coordinator:
- merges MG-1, CG-2, GPU-2 and ROUTE-1, then MG-2, MEM-1 and any approved
  QUAL-1 item;
- re-times CPU Micro Grain once MG-1 and CG-2 are both in;
- runs the full fast suites and the covering GPU drivers once;
- asks Steve before pushing;
- adds Micro Grain steps to the hand test.

Later, after v1: lens correction as a GPU warp after GPU Micro Grain
(reviewer's suggestion) replaces most of MG-2. It stays out of scope here.

## Out of scope

- Micro Grain on the GPU with lens correction or crop (about 1–2 weeks; ask
  Steve separately).
- Export and Proof Grain on the GPU.
- Library thumbnail Grain changes.
- Encoder or gain-map changes.
- Changes to agreed tolerances or memory limits. Round 2 cache-share and
  memory-mapping ideas are proposals for Steve (R2-2, R2-3), not built.
- Rewriting the WGSL to share code with the Python and C routes; round 2
  adds checks on shared constants only.

## Decisions

| Date | Decision |
| --- | --- |
| 2026-11-21 | Steve: build robust, app-wide logs, so that an agent reading them knows exactly what happened. |
| 2026-11-21 | Steve: make the CPU backup show the visible area first (about one day), and look for root speedups as well. |
| 2026-11-21 | Steve: support photos above 8,192 pixels on the GPU in bounded tiles; new Sony high-resolution bodies exceed 50 MP. |
| 2026-11-21 | Steve: finish development on November 21–22; skip long tests until the end; Steve tests by hand. |
| 2026-11-21 | Workers use Codex `gpt-6.2-sol` at medium or high effort. |
| 2026-11-21 | Steve: the coordinator decides process questions (extra rounds, an extra short locked measurement) and reports them; Steve keeps product decisions. First use: CPU-1 gets a second round and one more 5-minute run, because its first version missed the speed and memory targets before its final change was measured. |
| 2026-11-21 | Steve: push `feat/denoise-v1` after integration (`deb2fc6f`). |
| 2026-11-21 | Steve: adopt the Gemini 4 Neon Denoise review's recommendations into this sprint as round 2, after the coordinator checks them in the code; PC work for both machines first, MacBook Neo memory overnight; the reviewer checks the updated brief. Product choices in it stay with Steve (R2-1 to R2-5). |
