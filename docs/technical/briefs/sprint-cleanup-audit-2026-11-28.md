# Sprint brief: cleanup, bug review and Grade module performance audit (November 28, 2026)

**Owner:** Steve. **Coordinator:** Claude (Opus 5.5): the only editor of this
brief; assigns packages, checks every report, merges, runs the integration
checks and takes decisions to Steve one at a time.
**Plan reviewer:** Gemini 4 Neon (high). Plan agreed November 28 after one
round of changes (see "Decisions log").
**Workers:** Codex `gpt-6.2-sol` at medium (reviews, tidy-up) or high
(harness, optimisation fixes), one per package.
**Base:** branch `sprint/cleanup-audit-2026-11-28` from `main` at `f45fef90`
(v0.9.4 plus four local Library commits; fetched November 28, 0 behind
`origin/main`, newest tag `v0.9.4`). Shared checkout, disjoint file ownership
per package (see "How workers share the checkout").
**Machine:** MacBook Neo first (window 1408x794). The PC stage (Phase 6) runs
only after the Mac phases are done and Steve agrees.
**Timebox:** November 28, 2026 daytime and overnight. Steve reads the morning
report on November 29.

`AGENTS.md` applies to every package: testing scale, GPU run lock, "Still
strict", "Stop and ask", records, design tokens, disk space. Where this brief
and `AGENTS.md` disagree, `AGENTS.md` wins, except the testing timetable in
"Checks and timing", which this brief sets because several agents share an
8 GB machine.

## Goal and hard limits

Strictly cleanup, tuning, hardening and performance optimisation.

- **No new features.** No new controls, settings, menu items, formats, modes,
  messages, popups or UI. Test drivers and audit tooling are allowed (they are
  not app features). Hardening an empty `catch` means logging or a safe
  fallback, never a new user-facing message.
- **No output changes overnight.** Any fix that would change rendered,
  previewed, exported or Proof pixels, saved project/preset files or what the
  app shows is recorded as `needs-steve` with evidence and a ready patch
  (`docs/technical/audits/2026-11-28-mac/patches/<finding id>.diff`), and is
  not committed. Steve decides in the morning.
- **No relaxed checks.** Never loosen a tolerance, limit, budget or pinned
  value. Never touch the read-only test projects.
- **Export and Proof are Still strict.** Reviewers may report findings there;
  fixes land only with every covering check and are batched for the focused
  release check in Phase 5.
- **No GPU route for small gains** (AGENTS.md, "Speed where it is felt").
  Prefer the cheapest change that removes a large part of the felt wait.
- **No pushing.** Local commits on the sprint branch only. The coordinator asks
  Steve before any push or merge to `main`.

## Phases

| Phase | When | What | Who |
| --- | --- | --- | --- |
| 0 | done | Recon: layout, Grade module inventory, fast-test baseline (Node 1,583 pass, Python 5,194 pass, 0 fail; output 20 GB) | 3 Sol medium |
| 1 | done | Plan reviewed and agreed with Neon | Coordinator + Neon |
| 2a | afternoon (active) | Wave 1: H (harness), T (tidy-up), R1, R2 | 4 workers |
| 2b | evening | Wave 2: R3, R4, R5, M1–M3 (review only) while H3 calibrates alone at the end | ≤ 4 at a time |
| 2c | evening | Wave 3: M4–M6 (review only) | 3 workers |
| 3 | night, quiet machine | Baseline module audit, serial, one runner, `caffeinate -dimsu`, on AC power | One runner; all others idle |
| 4 | night | Triage findings + audit data; optimisation and bug-fix packages (O); re-audit the touched modules (quiet machine again) | Sol high, then runner |
| 5 | early morning | Integration: full fast checks, focused release check plan; run it if ≤ 75 min, else stop and report | Coordinator |
| 6 | later, PC | Re-run the audit and the PC confirmations on Windows | After Steve agrees |

Concurrency limit: at most four Sol workers at once on the 8 GB Mac. No pytest
or other heavy test runs while any Electron check (H3, Phase 3, re-audits) is
running; the coordinator holds the other workers first.

## Work packages

Status values: `todo`, `active`, `done`, `blocked`, `needs-steve`. Only the
coordinator edits this table, from worker reports.

### T · Repository tidy-up (one worker, Sol medium)

| ID | Scope | Status | Result |
| --- | --- | --- | --- |
| T0 | Short "already well organised" summary (what is in good shape and should stay as it is) for the morning report, in `docs/technical/audits/2026-11-28-mac/repo-organisation.md` | done | `repo-organisation.md` written (T-19) |
| T1 | Move `tests/performance/fit-filtering-compare.test.js` under the fast-test glob (or add it to the documented glob) and refresh `tests/inventory.json` | done | fit-filtering tests in fast suite (T-1) |
| T2 | Move the tracked Round 4 reproduction source out of `codebase/output/predemosaic-round4-2026-11-20/` to `codebase/tools/denoise_eval/round4/`; fix links in the research report | done | moved to `tools/denoise_eval/round4/`; rerun still needs untracked Round 3 source (T-21, open) |
| T3 | Repair the `AGENTS.md` documentation map (missing/unindexed files, archive counts, round 4 duplicate), master PRD "current version", code-map navigation (dated notes after the main heading) | done | map, PRD version, code-map order fixed (T-3–T-7) |
| T4 | Archive finished briefs after carrying unresolved items into module PRDs (candidates: next-version investigation, backend startup reliability, RAW starting exposure, Library draw live). Do not archive by age | done | 2 archived (T-8, T-9); RAW starting exposure and draw-live kept open (T-10, T-11) |
| T5 | Label finished prototypes and manual diagnostics in `codebase/tools/` (README note per folder or a `tools/README.md` index). Retire nothing that might be run by hand without listing it for Steve | done | `codebase/tools/README.md` index (T-12–T-17) |
| T6 | Triage the overlapping `check-library-jpeg-*.cjs` / `measure-library-jpeg.cjs` probes: report roles; merge only if clearly duplicate | done | roles documented, no merge (T-18) |

Out of scope: splitting `webgpu-preview.js`, `webgpu-shaders.js`,
`adjustments.py`, `render_cache.py`, `exporters.py`. T may write a seam map for
them in `docs/technical/code-map.md` (documentation only).

### R · Code review for bugs and obvious slowness (five workers, Sol high)

Each reviewer reads its area, confirms each finding against the code (and a
tiny reproduction where cheap), records it in its findings file, and fixes
**only** findings that are: confirmed, non-output-changing, outside export/Proof
code, and checkable with targeted fast tests. Everything else is recorded as
`open` or `needs-steve`.

| ID | Area (owned files) | Leads from recon | Status | Result |
| --- | --- | --- | --- | --- |
| R1 | Electron shell and desktop: `codebase/desktop/**` | Preset listing cap before group filter + sync reads `main.js:193`; sync fs in interactive handlers; 7 empty catches | done | 18 findings: 11 fixed; needs Steve R1-5 (presets hidden by scan cap), R1-6 (packaged Export Grading Presets dialog cannot open), R1-7 (cancelled Quit), R1-12 (engine ready after exit), R1-13 (detached paste pending 5 min); R1-17, R1-18 open |
| R2 | Library frontend: `photo-library.js`, `library-*.js`, `gpu-delivery.js` | 100 ms polling `photo-library.js:447`; RAM report `library-ram.js:38`; permit polling without in-flight guard `gpu-delivery.js:37`; overlay canvas readbacks `library-overlays.js:114` | done | 12 findings: 8 fixed, R2-9 needs Steve (stale rendition on HDR toggle, patch), R2-10–12 open. Needs real-app Library check before the audit |
| R3 | Grade frontend non-renderer: `preview-pipeline.js`, `grade-saving.js`, `mask-overlay.js`, `app-state.js`, UI controllers (not `webgpu-*.js`, not R5 files) | JSON deep clones per submission `preview-pipeline.js:1470`; save check renders unchanged session `grade-saving.js:177`; brush replay lookups `mask-overlay.js:688`; 22 empty catches | done | 12 findings: 8 fixed; needs Steve R3-5 (external reload can erase an edit), R3-6 (Retouch repair overwrites newer slider), R3-7 (fine/snap markings); R3-12 open (5 Hz polling on reduced preview). Real-app: R3-3 paint/erase on perspective-corrected photo |
| R4 | Backend: `codebase/backend/hdr_finisher/**` except `exporters.py` and delivery code (review-only there) | Full-array copies `finishing.py:39`; Bayer plane copies `raw_speck_cleanup.py:89`; `adjustments.py` copies; `library_api.py`, `sessions.py` error paths | active | |
| R5 | Shared preview infrastructure: `webgpu-preview.js` core (device, resources, tile scheduling, caches, allocator), `render-coordinator.js`, `preview-scheduler.js`, `source-transport.js`, `scope-requests.js`. Review first; fixes only with the coordinator, since every module depends on it | Cross-module slowness, cache invalidation, stale work not cancelled, polling `webgpu-preview.js:846` | active | |

### H · Audit harness (one worker, Sol high, starts first)

| ID | Scope | Status | Result |
| --- | --- | --- | --- |
| H1 | New test driver `codebase/tests/performance/grade-module-impact.js`, registered in `tests/release/drivers.json` (tier `diagnostic`, area `preview`). Writes `module-impact-v1` JSON (see `docs/technical/audits/README.md`) | done | `279707b5`, `3f1fd3eb`; locked smoke passed (baseline + tone, typical, Fit) |
| H2 | `codebase/tools/audit-summary.cjs`: merges `findings-<PKG>.jsonl` into `findings.jsonl`, validates both formats, writes the markdown summary (impact matrix, flags, regressions against an earlier run on the same machine) | done | `46672b15`; validated 59 live findings |
| H3 | Calibration, machine otherwise idle: `baseline` + `tone` on the typical photo and `film` + `denoise` on the large photo, 2 samples. Proves the JSON, the summary, pixel-change detection and resume; projects the Phase 3 duration | todo | |

H1 requirements:

- Copy selectors and setup from `grade-release-sweep.js`, but **do not** force
  its 2560x1440 viewport; use the machine window. Take native pointer input and
  GPU-fenced completion from `stacked-raw-latency.js`.
- Arguments: `--module <id>[,<id>...]` or `--all`, `--photo
  <typical|large|noisy|path>`, `--zoom fit|100`, `--lane hdr|sdr` (per-module
  default), `--samples N` (default 5), `--warmup N` (default 2), `--out
  <folder>`, `--resume`.
- **Timing definitions.**
  - `first_feedback_ms`: from the first `input` event the control fires (not
    `pointerdown`) to the first frame whose GPU-fenced `completedAt` has
    `currentAtCompletion === true`.
  - `settle_ms`: from release to the last current exact on-screen frame.
  - `drained_ms`: from release until background catch-up (scopes, anchors,
    off-screen tiles) is idle. Reported, not flagged.
  - Statistics per step: `min`, `median`, `max`, `iqr`, and the raw samples.
    No p95 below 10 samples.
- **Per module:** seed a fixed, visibly non-neutral recipe (defined once in
  the driver, recorded with its hash). Then:
  1. **Own controls** (isolated): native drag of the module's main slider(s)
     and a click of its eye; module ON, everything else default.
  2. **Impact probes**, module ON and module OFF: `tone.exposure` drag,
     `tone.contrast` drag, `denoise.toggle_on`, `denoise.toggle_off`.
     Alternate ON/OFF order per sample, except RAW modules (below).
  3. **Self-reference:** for `tone` skip the OFF-state Tone probes; for
     `denoise` skip the OFF-state Denoise probes. No delta is recorded for them.
- **Pixel check:** record a canvas/texture signature per step and a
  `pixelsChanged` boolean for module ON versus OFF. A module whose recipe does
  not change pixels is flagged `no_op` and its impact numbers are void.
- **Denoise probe:** method `clean_grain` (the default) on all photos;
  `denoise` itself is audited with `clean_grain`, `standard` and `micro_grain`.
  After every module state change, prime Denoise once (toggle on, wait for
  settle, toggle off) before the timed toggles, and log any preparation
  rebuild seen during a timed toggle as `denoiseRebuilds` (a real cost, not
  noise). `micro_grain` is unavailable with Highlight Reconstruction Edge
  colour or Retouch repairs; record `skipped` with the reason.
- **RAW modules** (`raw.*`): blocked alternation (`alternation: "blocked"`):
  one settled ON block, re-develop, one OFF block, 3 samples each, 1 warm-up.
- **Memory:** sample every 200 ms during each step: per-process footprint
  (renderer, backend, GPU; macOS physical footprint) and the WebGPU allocator
  peak from `gpuSnapshot()`. Record the idle footprint before the step.
- **Conditions:** record `dpr`, power source, `HDR_FINISHER_POWER_MODE`, GPU
  adapter, preview resolution, processed long edge per step, load average at
  the start of each module, driver SHA-256.
- **Robustness:** write the JSON after each module; `--resume` skips modules
  already complete in the output file; restart Electron and continue with the
  next module after a crash, out-of-memory or timeout (record the error).
- Fresh disposable session per photo; no inherited grade; app restarted
  between photos. Never write to read-only projects. Hold the GPU run lock and
  launch through `tests/run-in-electron.js` or `run-native-electron.js` per
  AGENTS.md "Electron test lifecycle".

### M · Grade module reviews and audits (six workers, Sol medium for review, high for fixes)

Each M worker: (a) reviews its modules' code paths (frontend controller,
backend, the module's shader passes and caches) for bugs and obvious slowness,
read-only in Phase 2, findings into `findings-M<n>.jsonl`; (b) names the seed
recipe and photo that make its modules visibly change pixels, for H1 to use;
(c) after Phase 3, reads its modules' audit rows and proposes optimisations
with the expected gain on the felt wait; (d) in Phase 4 implements approved,
non-output-changing ones (an O package) and the runner re-audits.

| ID | Modules (audit `module` ids) | Status | Result |
| --- | --- | --- | --- |
| M1 | RAW development (`raw.cleanup`), Lens correction (`raw.lens`, needs a manifest photo with an exact Lensfun profile), Highlight Reconstruction (`raw.highlights`, needs a photo with clipped channels, e.g. `IMG_3129.CR2` or `DSC00264.ARW`) | todo | |
| M2 | Denoise (`denoise`: `clean_grain`, `standard` "Simple", `micro_grain` "Micro Grain · Experimental"); noisy photo `IMG_0790.CR2` as well | active (review) | |
| M3 | Tone (`tone`), Exposure Bands (`bands`), Curves (`curves`), Highlight Compression (`highlight_compression`, recipe must push peaks over the target, e.g. Exposure +3) | active (review) | |
| M4 | Color sliders (`color`), Color wheels (`wheels`), HSL (`hsl`), Black & White (`bw`), Vignette (`vignette`) | todo | |
| M5 | Detail (`detail`), Film Look (`film`, including Lens Filter, halation, grain) | todo | |
| M6 | Local (`local`: one brush, one gradient), Retouch (`retouch`: two heals), Geometry (`geometry`: crop + rotate + perspective, `offMethod: neutral`), SDR Match (`sdr_match`, **SDR lane**, non-default HDR grade seeded first, matched versus restored). Photo Framing is out of scope (viewer finishing, not a Grade pixel stage); review only | todo | |

### O · Optimisation and bug-fix packages (Phase 4)

Created by the coordinator from findings and audit data. Each gets an ID
(`O1`…), owned files, expected gain on the felt wait, the check that proves
it, and a re-audit of the affected modules.

| ID | Source finding(s) | Scope | Status | Result |
| --- | --- | --- | --- | --- |

## Audit plan (Phase 3)

- **Photos** (from `HDR Test Images`, reusable copies in
  `codebase/output/test-photos/`): typical `IMG_7723.CR3` (24 MP), large
  `DSC00636.ARW` (~50 MP), noisy `IMG_0790.CR2` (18 MP, M2 only). M1 names the
  Lens and clipped-highlight photos before Phase 3.
- **Matrix:** every module × {typical, large} × Fit; plus `tone`, `denoise`,
  `film`, `detail`, `local`, `retouch`, `geometry` × large × 100%. Samples: 5
  per step, 2 warm-ups discarded (RAW modules: 3 and 1).
- **Noise floor and drift:** `baseline` (all defaults) at the start, middle and
  end of each photo's batch. Its spread sets the night's noise.
- **Order:** baseline, M1–M6 modules, baseline (middle after M3).
- **Duration:** H3 projects it. Cap 4 h for the baseline batch. If the
  projection is over, cut in this order: 100% rows for `detail` then
  `geometry`, then samples to 3 on slow steps (RAW, 100%, `sdr_match`, cold
  Denoise). Steve approved an overnight audit in his November 28 request, so
  "Stop and ask" is satisfied up to that cap.
- **Overnight:** AC power, `caffeinate -dimsu` around the runner; the display
  must not sleep (it throttles animation frames).

### Tolerances (proposed before measuring)

- **Noise:** a change is noise if within the larger of 10% or 15 ms of the
  comparison median, or within the baseline's start/middle/end spread. Reason:
  earlier Neo stacked runs varied about 5–10%.
- **Impact flag:** a module **impacts** a probe when the probe's median with
  the module ON exceeds OFF by more than 25% **and** 30 ms (first feedback) or
  100 ms (settle).
- **Slow flag:** median `settle_ms` above 1,000 ms at Fit, or any action whose
  whole wait exceeds Steve's ~10 s target.
- **Regression (re-audit):** median worse than the baseline run's by more than
  the noise tolerance → explained or reverted.
- **Memory:** a footprint rise over 300 MB with a module ON versus OFF is
  flagged `memory` (informational); going over the app memory ceiling in
  `docs/product/modules/memory-and-caches.md` is a bug.
- **Pixels:** optimisations must not change pixels. Where a fix touches a
  shader or CPU maths path, run the module's existing GPU/CPU agreement driver;
  perceptual tolerances per AGENTS.md.

## Data collection (structured, repeatable)

Formats are defined in `docs/technical/audits/README.md`.

- **Findings** (`findings-v1`, JSON Lines): each package writes only
  `docs/technical/audits/2026-11-28-mac/findings-<PKG>.jsonl` (e.g.
  `findings-R2.jsonl`). `audit-summary.cjs` merges them into `findings.jsonl`.
- **Module impact runs** (`module-impact-v1`, JSON): raw files under
  `codebase/output/audits/2026-11-28-mac/` (local); the summarised copy
  committed to
  `docs/technical/audits/2026-11-28-mac/module-impact-<photo>-<zoom>.json`.
- **Summary:** `audit-summary.cjs` writes
  `docs/technical/audits/2026-11-28-mac/summary.md`. A future audit uses the
  same driver and passes this folder as the comparison.
- **Performance table:** the coordinator adds one dated section to
  `docs/technical/performance-table.md` with the headline rows and a link to
  the summary.

## How workers share the checkout

- All work happens in `/Users/stevenfuncke/HDR Finisher Tool/ai` on the sprint
  branch. Each package owns the files listed for it plus its own findings
  file; touching another package's files needs the coordinator first. Workers
  do not edit this brief.
- Commit small, with explicit paths (`git commit -m ... -- <paths>`), never
  `git add -A` or `git commit -a`. If `.git/index.lock` exists, wait a few
  seconds and retry; never delete it. One finding fix per commit where
  practical. Message: package id, finding id(s), what changed, what was run.
- Keep context small (grep and tail, not whole files or logs). Commit each
  verified piece immediately; workers may be cut off mid-task.
- Final message: findings count by category and severity, commits (hash + one
  line), checks run with results, anything `needs-steve`, files left
  uncommitted.

## Checks and timing

- Workers run **targeted** tests only for what they changed (the matching
  `node --test tests/<file>.test.js` or `.venv/bin/python -m pytest
  tests/<file>.py -k ...`). Reason: the full Python suite takes about 6 minutes
  on this 8 GB machine; several agents running it together would stall it.
- The coordinator runs the full fast checks once per wave and at the end.
- GPU checks: only the one or two covering what changed, under
  `tools/gpu-run-lock.py`, and only when the coordinator says no timing run is
  active.
- `tools/output_size.py` at start and end of each package that runs GPU
  checks or audits. Clean up scratch.
- Phase 5 focused release check: `npm run test:release -- --plan` first; run
  only if within the 75-minute approval, else stop and put it to Steve.

## Phase 6 · PC (later)

After Steve agrees: pull the sprint branch on the PC, run setup, re-run the
audit with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440` into
`docs/technical/audits/<date>-pc/`, compared only with other PC runs. Add the
PC follow-ups to AGENTS.md "Waiting on the other machine".

## Decisions log

- 2026-11-28: Steve asked for this sprint: cleanup, tuning, hardening and
  performance only; Sol 6.2 workers; per-module audits with Exposure,
  Contrast and Denoise impact probes; structured, repeatable data; Mac first,
  PC last; plan agreed with Gemini 4 Neon before work starts.
- 2026-11-28: Neon review adopted in full: driver area `preview`; real Denoise
  methods; per-package findings files, coordinator-only brief edits, waves of
  at most four workers; no output-changing commits overnight; GPU-fenced
  timing, settle/drained split, pixel-change check, blocked RAW alternation,
  Denoise priming, resume and crash isolation, caffeinate; schema additions;
  R5 owns shared preview infrastructure; Photo Framing out of scope; T0
  "well organised" summary; 200 ms memory sampling; min/median/max/IQR
  instead of p95 at 5 samples; mid-batch baseline for thermal drift.
