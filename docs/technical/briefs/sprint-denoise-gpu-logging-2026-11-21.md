# Sprint brief: Denoise on the GPU, faster CPU backup and app-wide logs (November 21, 2026)

**Owner:** Steve. **Coordinator:** Claude (Opus 5.5): keeps this brief
current, checks every report, merges the packages and takes decisions to
Steve one at a time.
**Workers:** Codex `gpt-6.2-sol` at high effort, one per work package, each in
its own worktree made from `feat/denoise-v1`.
**Base:** `feat/denoise-v1` at the commit that adds this brief (parent
`e0257bad`).
**Timebox:** development on November 21–22, 2026. Steve tests by hand after
integration and expects to find bugs then.

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
| LOG-1 | Logging foundation and GPU Grain route robustness | `sprint/logging-foundation` | — | foundation `3558de3a` merged Nov 21; Grain robustness in progress |
| CPU-1 | Faster CPU Grain backup: visible area first, then root speedups | `sprint/cpu-grain-speed` | — | in progress (Codex worker started Nov 21) |
| GPU-1 | Fine, Clean and Micro Grain on the GPU above 8,192 pixels | `sprint/gpu-large-photos` | — | in progress (Codex worker started Nov 21) |
| LOG-2 | App-wide logging rollout | `sprint/logging-rollout` | LOG-1 merged | in progress (started Nov 21 on the merged foundation; Grain paths left for INT) |
| INT | Integration, full checks, push and Steve's hand test | `feat/denoise-v1` | all | not started |

LOG-1, CPU-1 and GPU-1 run in parallel on November 21. LOG-2 starts once
LOG-1's foundation is merged. INT runs at the end of November 22.

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

The hand test on the Mac is also the first chance to catch the original
incident with the new logs.

## Out of scope

- Micro Grain on the GPU with lens correction or crop (about 1–2 weeks; ask
  Steve separately).
- Export and Proof Grain on the GPU.
- Library thumbnail Grain changes.
- Encoder or gain-map changes.
- Changes to agreed tolerances or memory limits.

## Decisions

| Date | Decision |
| --- | --- |
| 2026-11-21 | Steve: build robust, app-wide logs, so that an agent reading them knows exactly what happened. |
| 2026-11-21 | Steve: make the CPU backup show the visible area first (about one day), and look for root speedups as well. |
| 2026-11-21 | Steve: support photos above 8,192 pixels on the GPU in bounded tiles; new Sony high-resolution bodies exceed 50 MP. |
| 2026-11-21 | Steve: finish development on November 21–22; skip long tests until the end; Steve tests by hand. |
| 2026-11-21 | Workers use Codex `gpt-6.2-sol` at medium or high effort. |
| 2026-11-21 | Steve: the coordinator decides process questions (extra rounds, an extra short locked measurement) and reports them; Steve keeps product decisions. First use: CPU-1 gets a second round and one more 5-minute run, because its first version missed the speed and memory targets before its final change was measured. |
