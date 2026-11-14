# AGENTS.md

Scope: this repository (`ai`) and everything under it. Applies to every agent
(Codex, Claude or other) and every task, including tasks started from a brief
or PRD.

## Who you are working for

Steve owns this project and is not a coder. Explain status and results in
plain language. Put decisions to him one at a time, each with the trade-off
and what could break.

## How much to test

Adopted October 6, 2026, after a 19-line cleanup was validated with a full
160-driver sweep, three audits and a number-by-number ledger. That cost far
more time and credits than the change deserved. Scale the testing to the size
and risk of the change.

**Where an older PRD, brief or handoff prompt asks for more testing than this
section, this section wins.** A brief written after October 6, 2026 may ask
for more only if it says why. Steve can always ask for more or less.

### Every change

The default real-app Library check is `node tools/quick-library-check.cjs --label=<name>` from `codebase` (90 seconds); add `--single` for ten Single steps. It launches plain Electron itself without run-in-electron.js or DevTools.

Run the fast checks, from `codebase`:

- `node --test tests/*.test.js`
- `.venv/Scripts/python.exe -m pytest tests -q` (use the `.venv` Python;
  `.venv/bin/python` on macOS and Linux)

Then run only the one or two GPU checks that directly cover what you touched.
If none covers it, say so; do not run broad checks as a substitute.

Group related changes and run their GPU checks once for the group, not once
per change. GPU checks run one at a time through `tests/run-in-electron.js`
(or `tests/run-native-electron.js`) with
`HDR_FINISHER_ELECTRON_WINDOW_SIZE` set to the machine's window size (see
"Machines": 2560x1440 on the PC, 1408x794 on the MacBook). Never overlap them.

### Release points only

Before a push to `main`, a merge into it, or an installer build, run the
**focused release check** (Steve, October 16, 2026, after a full sweep was
estimated at nearly five hours). Aim for about an hour of slow tests:

From `codebase`, run `npm run test:release -- --release` (use `--plan`
first to inspect the selection and history estimate). The runner selects:

- the export and Proof checks (see "Still strict"),
- the GPU checks for every area changed since the last reachable `v*` tag,
- a few quick core preview and shader checks.

Add every new driver to `codebase/tests/release/drivers.json`, with an area,
tier and launch method. The fast inventory check rejects missing entries.
See `codebase/tests/release/README.md` for selections, resume and exact-message
known failures. The runner requires committed tracked files, runs one driver
at a time and verifies the three read-only project hashes.

The full driver sweep, the coverage audits, the endurance run and the broad
timing sweeps run only when Steve asks. The 0.9.1 brief,
`docs/technical/archive/briefs/codex-brief-release-0-9-1-validation-2026-10-16.md`, is the
template. The focused check is approved up to about 75 minutes; past that,
use "Stop and ask".

A backup push of a work-in-progress branch (such as `photo-library`) needs
only the fast checks (agreed by Steve, October 11, 2026). Still ask before
pushing.

An unpacked packaged build (`npm run pack:dir`) made only to smoke-test
that the app works when packaged is not an installer build and does not
need the full sweep (agreed by Steve, October 12, 2026). Building the
installer still does.

**GitHub builds before tagging (Steve, November 13, 2026).** Local checks
run only on Windows and on the unpackaged app. The packaged app, macOS and
Linux are tested only by the GitHub "Desktop release" workflow. For 0.9.2
that workflow first ran on the tag and needed 14 rebuilds (about 30 minutes
each) to publish. Before any release:

- Early in the release work, start the workflow on `main` without
  publishing: `gh workflow run "Desktop release" --ref main`. It builds
  Windows, macOS, Linux and Flatpak and runs the packaged smoke tests.
  Builds on different branches or tags run independently, so it can run
  alongside other work.
- Fix what it finds and run it again. Push the `v*` tag only after a full
  run on `main` passes on every platform. A tag push publishes the release.
- If a test on GitHub hangs, `faulthandler_timeout` in `pytest.ini` prints
  where it is stuck.

Do not run them to confirm a small change, to re-confirm a result you already
have, or to chase a number that moved without a visible effect.

### Still strict

Take full care, and run every check that covers the area, when a change
touches:

- export or Proof output (the files Steve delivers and checks),
- a pinned shader, tolerance, limit or budget.

Damage here is silent and expensive. Never save over the read-only test
projects.

### Speed where it is felt; the GPU where it pays

Steve's decision, November 2, 2026 (master PRD, philosophy 3). It replaces
"GPU first, including export" of October 18, which moved export and Proof to
the graphics card after a 45-photo batch export was estimated at over an
hour and a half on the CPU.

- Before proposing speed work, measure the whole wait the user feels (action
  to result on screen) and where it goes. Report the expected gain on that
  whole wait, not on one step.
- Choose the cheapest change that removes a large part of the wait. Propose a
  new GPU route only when it should make that wait about 50% faster or more,
  or the CPU cannot do the job acceptably. Stop and report if a GPU route
  turns out to save only a little (for example 6.1 s to 5.9 s).
- Existing GPU routes (preview, Library development and drawing, export and
  Proof delivery) stay, with the CPU as their fallback. The CPU path may be
  made faster when that is the cheaper way to a large gain.
- CPU export is not an exact reference that GPU work must match. GPU and CPU
  results must agree within an agreed tolerance (see "Work within
  tolerances"), not pixel for pixel.
- Proof and export should show the same result as each other, within
  tolerance.
- When a GPU attempt fails: one try, then the CPU fallback (Steve,
  November 6, 2026; master PRD philosophy 3 has the full lists). A second
  GPU try is only for a temporary failure outside the work: preemption,
  memory held by other work, a lost or restarting device, a contention
  timeout. A result that fails a validity or range check, a compile or
  validation error, a job too big for the card, or no GPU goes straight to
  the CPU. If that fallback is too slow, make the CPU faster instead of
  adding retries.

### Old projects and old code

The app is before its 1.0 release and has no outside users. Do not write or
keep migration or compatibility code for old saved projects or old
preferences, and do not keep an old method alive for them. When a feature is
removed, projects that used it may break. Tell Steve in one line which
projects are affected (including any test projects) and carry on. This
changes at 1.0.

### Responsiveness

Whether the app feels fast is judged first by Steve using it. If a timing
number moves outside its tolerance (see "Work within tolerances") and you
cannot explain it, report it in one line and ask him to try the app before
spending a test run on it.

### What tests should check

Steve's preference, October 16, 2026: a test should check what the code
does, not how it is written.

- Prefer tests that run the code and check the result: pixels, numbers,
  saved files, what the app shows, or how the GPU preview compares with
  the CPU export.
- Avoid tests that compare source text against a copied snippet, or that
  pin names, wording or code structure. They break when code is
  reorganised and do not catch real mistakes.
- Exact pins belong on things that must not drift: numerical tolerances,
  limits and budgets, shader parameter layouts the CPU and GPU must share,
  and any exact-match guarantee Steve still asks for.
- When you come across an old wording-only test while doing other work,
  replace it with a check on the result if one is practical; otherwise
  leave it in place.

### Work within tolerances

Steve's preference: agree a tolerance once, then work inside it without
coming back to him.

- When a change has a measurable result without an agreed tolerance
  (timing, memory, size, preview-against-export difference, colour
  difference), propose one before measuring, with a one-line reason, for
  example "within 5% of the current timing, since run-to-run noise is about
  2%". Record it in the brief, plan or PRD, then carry on.
- Image differences are judged by what a person can see (Steve, October 18,
  2026). Use a perceptual colour difference on finished pixels (for example
  ΔE 2000 for SDR, ΔICtCp for HDR): an average below the just-noticeable
  level plus a high-percentile limit. No hard per-pixel maximum; a few stray
  pixels must not fail a check. This covers GPU against CPU, Proof against
  export (Proof on the GPU with export falling back to the CPU is accepted),
  and Library pictures against export.
- **Steve, 2026-11-14: fixed film/lens drift guards.** Only the 60 listed
  lens cases (including the eight quick cases) and the SDR Velvia physical
  chain use the caps in `codebase/tests/helpers/film-parity-limits.cjs`.
  Lens HDR-editing-lane mean ≤ 0.161, p99.9 ≤ 1.155; lens SDR mean
  ≤ 0.248, p99.9 ≤ 1.202; SDR Velvia physical chain mean ≤ 0.125,
  p99.9 ≤ 1.065.
  Both editing lanes are SDR presentations in these drivers: use ΔE 2000.
  Caps are worst of three + 0.005 mean / + 0.020 p99.9, rounded up to 0.001,
  identical on both machines. The 68 strictly passing lens cases keep the
  original byte-mean gate; the two-level byte p99.9 and structural/coverage
  checks remain strict everywhere. No other check, HDR ΔE ITP requirement
  or delivery ceiling is relaxed. Measurements: Film Look module PRD.
- The one exact image requirement: HDR output never exceeds the highlight
  compression target (a 1000-nit target means no finished pixel above 1000
  nits), on every render path and after encoding, allowing only encoder
  rounding.
- A result inside its tolerance is a pass. Do not stop, investigate, re-run
  or report it as a problem. A timing that moves 1% between two runs, against
  an agreed 5%, is normal noise.
- Expect run-to-run variation in anything timed. Judge timings against their
  tolerance, never against a single earlier run.
- Only a result outside its tolerance needs action: fix it if your change
  caused it, otherwise report it in one line and carry on.
- Anything still pinned as identical stays exact. CPU and GPU export are
  not pinned as identical (see "Speed where it is felt; the GPU where it
  pays").

### Changing tests

Tests protect behaviour that Steve wants to keep. When behaviour changes on
purpose, the tests change with it. Use the guidance below to choose, and ask
Steve only when a test change would:

- accept a change in output that the brief or plan did not ask for: rendered
  or exported pixels, saved project or preset files, or what the app shows,
  however small; or
- relax a number Steve has agreed: a tolerance, a limit, a time or memory
  budget, or a value agreed for CPU/GPU or export/Proof agreement.

The choices:

- **Update** a test when its expected result changes because of an intended
  change in the brief or plan (for example, a new processing order). Say in
  the commit what the test now expects and why.
- **Remove** a test when the feature it covers has been removed or replaced
  at Steve's request, including old-project compatibility tests, since
  compatibility code is not kept before 1.0. List the removed tests in the
  commit, and add tests for whatever replaces the feature.
- **Replace** a test that checks code wording with one that checks the
  result, when practical (see "What tests should check").
- **Tighten** a test whenever new work makes a stricter check possible and it
  costs little. This needs no permission.
- **Loosen** a tolerance, limit or budget only with Steve's agreement, and
  only with a reason he can follow (for example, "the new physical order
  makes the glow reach twice as far, so the tile must cover twice the
  distance"). Never loosen a check just to get a pass.

### When a check fails

- If your change caused it, fix the change, not the check. Change the check
  only for one of the reasons in "Changing tests".
- If it was already failing, or is unrelated, name it in one line and carry
  on. Do not investigate it, repair the test or re-run it unless that is the
  task.

### Stop and ask

If validating a change is about to take more than roughly 30 minutes of slow
tests, stop before running it and tell Steve:

- what you want to run and why,
- a rough estimate of the total test time.

## Machines (Steve, November 13, 2026)

Steve develops and tests on two machines and moves between them through
GitHub. This file is tracked in Git so both always have the same rules.

- **Hand-over.** Before Steve switches machines, commit and push the work
  (ask him first, as always). On the other machine, pull and continue. Never
  leave work that only one machine can run: test tooling must work on both
  without per-machine edits.
- **Minimum hardware.** The MacBook Neo is the minimum supported machine
  (master PRD, Scope). Every feature must work on it. A failure that only
  happens there is a real failure, not a slow-machine excuse.
- **Setup/update, including fresh agent worktrees:** from the Git root run
  `./codebase/tools/setup.sh` on macOS/Linux, or
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\codebase\tools\setup.ps1`
  on Windows. Requires Git, Node/npm, Python 3.12 and native compiler tools
  on POSIX. Re-run after pulling; see `docs/technical/development.md`.
- **Machine settings outside every worktree:** `hdr-finisher-machine.json`
  beside the main checkout. Git's common directory finds it from agent
  worktrees too. `HDR_FINISHER_MACHINE_SETTINGS` can select another shared
  JSON file. It holds `windowSize`, `photosRoot`, `testFixturesRoot`,
  `sharedTestPhotos`, `sharedLocalTestMedia`, `lockFolder`, `nativeToolsRoot`.
  Defaults: Mac window 1408x794, other platforms 2560x1440; PC photos
  D:/Photos, POSIX Photos beside the JSON; fixtures beside it. Setup adopts
  existing main-checkout test-photo/media folders and links them into new
  worktrees without moving or duplicating RAWs. Missing media is reported.
  When a driver needs a new photo, name the file Steve must transfer.
- **One GPU lock:** from `codebase`, use the venv Python to run
  `tools/gpu-run-lock.py --label <who-what> -- <command...>`. It reads the
  machine window and locks outside all worktrees; it also takes the existing
  parent `gpu-run.lock` so agents using the parent wrapper cannot overlap.
  Keep using the same wrapper for quick Library and release checks. The
  old `gpu-lock.cjs` is absent; do not create a second independent lock.

| | Windows PC | MacBook Neo |
| --- | --- | --- |
| Hardware | Steve's PC (dedicated GPU) | Apple A18 Pro, 8 GB unified memory, 6 cores |
| Repository | `D:/AI/AI Projects/HDR Finisher Tool/ai` | `~/HDR Finisher Tool/ai` |
| Python | `.venv/Scripts/python.exe` | `.venv/bin/python` (shared tooling resolves it; no shim) |
| GPU check window | 2560x1440 | 1408x794 points (2816x1588 pixels), the largest the built-in screen gives |
| Photos root | `D:/Photos` (originals) | `~/HDR Finisher Tool/Photos` (copies; `HDR_FINISHER_PHOTOS_ROOT` moves it, see `codebase/tests/helpers/photos-root.cjs`) |
| Native encoders | `codebase/bin/*.exe` (committed) | setup builds with `tools/build_native_macos.sh`; build scratch handles spaces automatically and validated encoders are reused |
| Read-only projects | as committed | also `chmod a-w` |

- **Timings.** Write the machine into the conditions of every
  performance-table row. Mac and PC numbers are separate baselines and are
  never compared with each other; judge a change by before and after on
  the same machine.
- **One test-photo folder** (Steve, November 14): all photographic test inputs
  come from `<photosRoot>/HDR Test Images`, identical on PC and Mac. Steve
  approved the curated 50-file set in `docs/technical/test-photos.md`; setup
  checks every name, byte size and SHA-256 against
  `codebase/tests/test-photos.manifest.json` and reports missing, different or
  extra files. Never use Desktop, Downloads, old partial copies or Play_Raw.
  Generated deterministic fixtures remain in Git; disposable derivatives stay
  under output. `library-mixed-v1` and its quick-check defaults stay frozen
  during `fix/library-8gb` measurements; v2 is opt-in until that comparison ends.
  Personal-folder and dropped giant-file measurements are PC-only; see the
  complete exception list and missing specialty coverage in the photo document.
  - **PC-only by Steve's choice:** the `2026/20261017 badminton` folder is
    too large for the Mac, so `library-fullscreen-raw.js`,
    `library-scroll-cache.js`, `library-stored-screen-preview.js` and
    `library-live-picture.js` run on the PC only.
  - The JPEG XL sample is now present. `jxl-source-colour.js` still needs the
    JPEG XL helper, which is Windows-only until Phase 2.

### Waiting on the other machine

Work one machine left for the other. An agent starting on that machine
reminds Steve of its list at the start of the session, then removes each
item here once it is done (and commits that change with the work).

**On the PC, after the first pull of the Mac work (November 14):**

Checked November 14 on the PC; setup and the 50 test photos, lock, file commands, drawing gap, Library
GPU recovery, HDR ceiling and film/lens parity passed and are removed.
Do not rebuild `library-mixed-v1` or switch its defaults until the Library
speed comparison is finished. Still open:

1. Edge colour with real RAWs on the PC GPU: `edge-colour-raw.js` fails twice
   with 55 and 54 invalid GPU pixels in Library development; the safety check
   rejects them and uses the CPU. Matches Steve's November 13 decision 7 (PC
   card suspected); keep until he decides.
2. HSL picker timing on the PC: `tests/performance/hsl-picker-speed.js`
   cannot run because its same-volume hardlinks fail on the exFAT D: drive
   (`EISDIR` on `link`). Needs a tooling fix that still avoids per-run RAW
   copies.

## Disk space and test output

Steve, October 28, 2026, after test and measurement output filled drive D
(about 295 GB in `codebase/output` and `output`, 13,000 run folders, many
holding full-size photo copies).

- **The 100 GB limit.** From `codebase`, run
  `.venv/Scripts/python.exe tools/output_size.py` (`.venv/bin/python` on
  the Mac) at the start and end of
  every task that runs GPU checks, timing runs or review captures.
  - If it reports more than 100 GB (it exits with status 1), tell Steve
    before anything else in your report: say the size, the biggest folders,
    and what is safe to delete.
  - Do not delete his files to get under the limit yourself; he deletes
    them.
- **Clean up after yourself.** When a run finishes, delete what you made
  that nobody will look at: intermediate renders, decoded copies, timing
  scratch, temporary profiles, and temporary folders under the system TEMP
  folder.
  - Keep only what a report or review page points to.
  - A driver that creates a temporary folder removes it when it finishes,
    pass or fail.
- **One copy of each test photo.** Copy a real photo into
  `codebase/output/test-photos/` once and reuse that copy. Never copy a RAW
  or a large file per run or per folder. The originals stay read-only.
- **Review pages are small.** Use screenshots or downscaled crops, not
  full-size exports. Overwrite the same review folder on each rerun instead of
  making a new dated one.
- **When Steve has reviewed a page,** its folder can be deleted. Mention in
  the report which review folders are no longer needed.

## Records

- One short note per commit: what changed, what was run, what failed and why.
- No before/after table of every measurement. Record a number only when it is
  the point of the change or it crossed a limit.
- Do not create a new evidence document per batch. Update the module PRD or
  `docs/known-limitations.md` only when something a future reader needs has
  changed.

## Product documents (Steve, October 18, 2026)

- `docs/product/PRD.md` is the master PRD: scope, philosophy, module map,
  priorities. Each part of the app has one module PRD in
  `docs/product/modules/` (requirements, dated decisions, current state,
  open work).
- Memory and cache sizes for the whole app (RAM ceiling, each cache's share,
  disk allowances) are owned by `docs/product/modules/memory-and-caches.md`.
  Read it before adding a cache or changing a size; size changes are Steve's
  decision.
- When a change alters a requirement, a decision or what is built, update
  that module PRD in the same commit. Mark work built only when the code is
  committed; anything a brief left unfinished stays under Open work.
- No new sprint PRDs. Work is given as a brief in `docs/technical/briefs/`.
  When it is finished, its outcome goes into the module PRD and the brief
  moves to `docs/technical/archive/briefs/`.
- Old PRDs and sprint plans are history in `docs/product/archive/`. Where
  one disagrees with a module PRD, the module PRD wins.
- Timings go in `docs/technical/performance-table.md`. Whenever a change,
  test or log review produces a timing, update that action's row (range,
  date, commit, conditions) in the same commit. Use it to choose performance
  work and to spot regressions.

## Documentation map (Steve, October 30, 2026)

Read this first to find the right context. All paths are from the `ai` Git
root. When you add, move, rename or retire a Markdown file, update this map
in the same change (this file is tracked by Git since November 13, 2026).

**Start here for any task:** `docs/product/PRD.md` (master PRD), then the
module PRD for the area you touch, then `docs/technical/code-map.md`.

### Product (what to build and why)

- `docs/product/PRD.md`: master PRD. Scope, philosophy, module map,
  priorities, open work per module.
- `docs/product/modules/photo-library.md`: the Library. Status at the top,
  then dated decisions, current state and open work. The largest module PRD.
- `docs/product/modules/memory-and-caches.md`: owns the RAM ceiling, cache
  shares, disk allowances and VRAM budgets. Read it before touching any
  cache or size.
- `docs/product/modules/grade.md`: the Grade editor (tools, tone, local
  adjustments, retouch, HSL).
- `docs/product/modules/preview-and-gpu.md`: GPU preview, render planning,
  VRAM budgets, tiles.
- `docs/product/modules/export-and-proof.md`: export formats, metadata,
  Proof, GPU delivery, export speed.
- `docs/product/modules/import-and-raw.md`: decoding sources, camera RAW and
  DNG import settings.
- `docs/product/modules/film-look.md`: Film Look stocks, papers, grain,
  halation.
- `docs/product/modules/desktop-and-release.md`: Electron shell,
  packaging, release process.
- `docs/product/archive/`: 26 old sprint PRDs and handoffs. History only;
  module PRDs win.

### Technical (how it works)

- `docs/technical/code-map.md`: where things live in the code. Read before
  editing.
- `docs/technical/library-grade-resource-map-2026-11-05.md`: Library/Grade
  pixel ownership, copies, repeated loads and measurement questions (research).
- `docs/technical/architecture.md`: processes and data flow (Electron,
  Python backend, helpers).
- `docs/technical/image-processing-pipeline.md`: the processing order
  contract for preview and export.
- `docs/technical/highlight-compression.md`: highlight compression
  reference (the one exact HDR limit).
- `docs/technical/local-adjustments.md`: local adjustment data and edge
  controls.
- `docs/technical/sdr-match.md`: HDR-to-SDR Match.
- `docs/technical/denoising.md`: Denoise v2 implementation contract.
- `docs/technical/denoise-accuracy-review-plan-2026-10-04.md`,
  `denoise-followups-2026-10-04.md`: Denoise review history.
- `docs/technical/denoising-technology-watch-2026.md`: denoise research.
  Not a commitment.
- `docs/technical/photo-library.md`: how the Library stores and protects
  grades, sidecars and caches.
- `docs/technical/library-speed-architecture.md`: October 12 Library speed
  findings (history; the scheduler design supersedes the scheduling parts).
- `docs/technical/gpu-retry-audit-2026-11-06.md`: where each GPU route
  retries or falls back to the CPU, checked against the November 6 GPU
  failure rule (static audit; open work, not yet acted on).
- `docs/technical/performance-table.md`: how long every action takes,
  against its target. Update it with every new timing.
- `docs/technical/development.md`: contributor guide (build, run, test).
- `docs/technical/test-photos.md`: approved shared photo corpus, manifest,
  replacement inventory, PC-only exceptions and v2 fixture hand-over.
- `docs/technical/archive/slice-3-stage-reports-2026-10-11.md`: Library slice 3
  stage reports (history).
- `docs/technical/archive/legacy-sdr-match-removal-next-thread-prompt-2026-10-06.md`:
  old handoff prompt (history).
- `docs/technical/evidence/library-codecs-and-cold-decode-2026-10-26.md`:
  stored screen preview and cold decode measurements.
- `docs/technical/incidents/`: four September 2026 incident reports (OBS
  black screen, crop OOM, geometry audit, preview resolution stall).
- `docs/technical/archive/`: 113 files of old evidence, prompts and briefs
  (`archive/briefs/` holds 54 finished briefs). History only. Includes
  `archive/briefs/library-resource-scheduler-design-2026-10-30.md`, the
  finished Library memory and GPU scheduler design; "scheduler 7.x"
  references in the Library and memory PRDs point there.

Completed thumbnail-memory work: `docs/technical/archive/briefs/library-thumbnail-memory-stall-2026-11-04.md` (November 5: admission and hidden job-buffer release).

Completed GPU-first zoom work: `docs/technical/archive/briefs/codex-brief-library-zoom-gpu-first-2026-11-05.md` (November 5: selected GPU scene, background publication and hand-over; first-round exclusions and validation limits in the Library module PRD).

Completed UI polish (pending visual sign-off): `docs/technical/archive/briefs/codex-brief-ui-polish-unified-title-bar-2026-11-06.md` (November 6: unified toolbar, borders, tabs, accents, text, Library/Export, graph frames, wheel and icon).

Completed UI polish round 2 (pending visual sign-off): `docs/technical/archive/briefs/codex-brief-ui-polish-round-2-2026-11-06.md` (November 6: Developed badge preference, centred bypass eye, thin resize rails, whole-module wheel reset and transparent polar grid; no tab changes).

Completed UI polish round 3 (pending visual sign-off): `docs/technical/archive/briefs/codex-brief-ui-polish-round-3-2026-11-06.md` (November 6: joined-plate in-panel tabs, larger workflow tabs, title-case panel titles, centred menu and stable title hover).

### Briefs (current work)

- `docs/technical/briefs/codex-brief-export-gpu-speed-2026-10-20.md`: GPU
  export speed.
- `docs/technical/briefs/codex-brief-hsl-edge-controls-2026-10-27.md`: HSL
  edge controls.
- `docs/technical/briefs/codex-brief-library-draw-live-2026-10-19.md`:
  Library develops once and draws live.
- `docs/technical/briefs/codex-brief-raw-starting-exposure-zero-2026-10-18.md`:
  RAW starting exposure.
- `docs/technical/briefs/prerelease-remediation-plan-2026-10-24.md`:
  prerelease test remediation plan.
- `docs/technical/briefs/next-version-investigation-sprint-2026-11-13.md`:
  next-version investigation sprint plan (finished; on
  `feat/watermark-and-library-polish`, not yet on `main`).
- `docs/technical/briefs/proposal-next-version-2026-11-13.md`: proposal for
  0.9.3, 0.10 and 1.0 (open 0.9.2 items, local AI feasibility, feature
  parity, phased plan, decisions for Steve). Approved November 13
  (phases 1–3; decision 9 still open).
- `docs/technical/briefs/mac-phases-1-3-2026-11-13.md`: the current work.
  Phases 1–3 built and tested on Steve's MacBook (Mac set-up first; the
  Windows PC becomes the advisory release-point check).
- `docs/technical/research/next-version-2026-11-13/`: the 12 research
  reports behind that proposal (A1–A5, A1b, A1c, B1–B3, C, C2).
Completed 0.9.2 release sprint: `docs/technical/archive/briefs/release-0-9-2-sprint-2026-11-11.md`
(November 11: audit, cleanup, Grade control review, release check outcome in `docs/known-limitations.md`).
Completed component-sheet pass (pending visual sign-off):
`docs/technical/archive/briefs/codex-brief-component-sheet-pass-2026-11-10.md`
(November 10: approved tokens, depth, tabs, fields, lists, titles/dividers and
graph frames/marks; review in `codebase/output/review/component-pass/`).
- `docs/technical/briefs/codex-brief-ui-polish-round-4-2026-11-06.md`:
  UI polish round 4 (Sofia Sans Semi Condensed titles, Export switch,
  empty state and disabled button, menu capitals, small leftovers).
Completed UI polish round 5 (pending visual sign-off):
`docs/technical/archive/briefs/codex-brief-ui-polish-round-5-2026-11-06.md`
(November 6: numbered workflow plate badges and neutral connectors).

### Testing and release

- `codebase/tests/release/README.md`: the focused release check (driver
  selection, resume, known failures).
- `codebase/tests/performance/README.md`: preview performance harness.
- `codebase/tests/fixtures/README.md`: automated test fixtures.
- `docs/testing/Golden_Pipeline_Test_Strategy.md`: golden-image test
  strategy.
- `docs/testing/Exporter_Capability_Table.md`: what each HDR exporter
  supports.
- `docs/testing/HDR_Reference_White_203_Release_Qualification_2026-08-22.md`,
  `Camera_Linear_RAW_Import_Bridge_Validation_2026-09-03.md`: dated
  qualification records.
- `docs/known-limitations.md`: what is validated, expected or planned,
  with recent check results.
- `RELEASE_NOTES.md`: notes for the current release.

### Design

- `docs/design/HDR_Finisher_Design_Guidelines.md`: UI design guidelines
  (living). Read it with the component sheet below.
- `docs/design/component-sheet.html`: the component sheet. Every
  component drawn from the tokens, with its HTML and CSS, in all three themes.
  Match it when building or fixing UI. Items marked Proposed need Steve's
  approval.
- `docs/design/HDR_Finisher_Tooltip_Copy.md`: tooltip text registry. Copy
  from here; don't rewrite.
- `docs/design/Unified_Media_Browser.md`: the add-folder and export-folder
  browser design.
- `docs/design/Import_Pipeline_Architecture.md`: September import pipeline
  design.
- `docs/design/README.md`: what the design folder holds.
- `docs/design/Code_Audit_Stabilization_Sprint_PRD_2026-08-20.md` and the
  five `Repo_Cleanup_*_2026-09-27.md` files: completed audit and cleanup
  records (history).

### User manual (what users read; keep in step with behaviour)

- `docs/README.md`: manual index.
- `docs/getting-started/install-and-run.md`, `quick-start.md`.
- `docs/concepts/hdr-basics.md`, `gain-maps-and-formats.md`,
  `color-pipeline.md` (the colour pipeline as implemented).
- `docs/user-guide/`: one page per area: `library.md`, `import.md`,
  `grade-hdr.md`, `grade-sdr.md`, `grading-controls-reference.md`,
  `typed-values-reference.md`, `local-adjustments.md`, `denoise.md`,
  `film-look.md`, `hdr-reference-white.md`, `viewer-and-analysis.md`,
  `proof.md`, `export.md`, `projects.md`,
  `application-settings-and-shortcuts.md`.
- `docs/setup/windows.md`, `macos.md`, `linux.md`, `monitors.md`:
  platform and display setup.
- `docs/workflows/source-preparation.md`: preparing sources in other apps.
- `docs/troubleshooting.md`: symptom-first troubleshooting.
- `docs/glossary.md`: terms.
- `docs/traceability.md`: maps user-facing areas to code and docs.
- `docs/contributing/documentation.md`: how to write and maintain the
  manual.

### Code-side READMEs

- `codebase/bin/README.md` (bundled encoders) and `codebase/bin/licenses/`.
- `codebase/samples/README.md`: generated HDR reference samples.
- `codebase/tools/session-recorder/README.md`: records app behaviour while
  in use.
- `codebase/tools/gpu_raw_prototype/README.md`,
  `hsl-prototype/README.md`: finished prototypes (history).
- `codebase/tools/avif-rendition-decode/README.md`: AVIF gain-map decoder
  tool.
- `codebase/backend/hdr_finisher/vendor/bordermuse/README.md` and
  `codebase/frontend/assets/icons/tabler/README.md`: vendored code and
  icons.
- `packaging/flatpak/README.md`: Flatpak build.
- `README.md`, `THIRD_PARTY_NOTICES.md`: repository front page and
  licences.

## Standing rules

- **Design tokens always (Steve, November 10, 2026).** Every interface
  colour, font family, font size, weight, line height, letter spacing, corner
  radius, shadow and icon size comes from an existing token in
  `codebase/frontend/visual-tokens.css`, applied as
  `docs/design/HDR_Finisher_Design_Guidelines.md` describes. This covers
  every page, including the desktop splash and other pages outside the
  main app. Do not type in literal values, and do not make new colours by
  mixing or adjusting tokens. Match the tokens and the guideline, not a
  mockup or screenshot; where they disagree, ask Steve. A new token, or any
  exception, needs Steve's explicit approval first: say what it is, why no
  existing token fits, and the value you propose.
- Commit locally in small commits so any one can be undone alone. Ask before
  pushing. Do not rebuild the installer unless asked.
- Speed is judged by the whole wait the user feels. Use the GPU only where
  it makes that wait about 50% faster or more; existing GPU routes keep the
  CPU as their fallback (master PRD, philosophy 3, November 2, 2026).
- Source files have mixed line endings and some tests match `\n` literally.
  Keep each file's existing endings. To compare with a committed version use
  `git cat-file blob`, not `git checkout`, which rewrites endings on this
  machine.

Completed UI polish round 4 (pending visual sign-off): `docs/technical/archive/briefs/codex-brief-ui-polish-round-4-2026-11-06.md` (November 6: Sofia title font, Export switches/empty state/disabled action, sentence-case menus, size label and Library toolbar; workflow tab font only).

- `docs/technical/archive/briefs/codex-brief-ui-polish-round-6-2026-11-06.md`: UI polish round 6 (vertical menu, view sliders, minimum width and Library sidebar).

- `docs/technical/archive/briefs/codex-brief-ui-polish-round-6b-toolbar-fit-2026-11-06.md`: UI polish round 6b (toolbars compact by available space, distinct Tabler icons with tooltips, 1100 px minimum).

Completed UI polish rounds 6 and 6b (pending visual sign-off): vertical menu, neutral view sliders, Library sidebar and toolbar fit by available space; review crops in `codebase/output/review/ui-polish/round-6/`.

Completed Retouch gizmo (pending visual sign-off): `docs/technical/archive/briefs/codex-brief-retouch-gizmo-and-tool-shortcuts-2026-11-08.md` (November 8: two-click Heal/Clone, labelled circles, moving repairs, Retouch keys, Play/Pause removed, status bar tool key hints; review crops in `codebase/output/review/retouch-gizmo/`).

Completed RAW overlays (pending visual sign-off): `docs/technical/archive/briefs/codex-brief-library-overlays-undeveloped-raw-2026-11-07.md` (November 7: Focus and Exposure on undeveloped RAW camera previews, placed by registration; review page in `codebase/output/review/library-raw-overlays/`).
