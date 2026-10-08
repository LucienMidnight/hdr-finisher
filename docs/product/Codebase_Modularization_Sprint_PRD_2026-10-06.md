# Codebase Modularization Sprint

**Date:** October 6, 2026
**Status:** All phases are complete October 8, 2026. Existing validation failures are recorded in 8.2.
**To do before v1.0.** Steve wants this structural work finished before the
1.0 release. After 1.0 there are outside users and saved projects to protect,
and a reorganisation of this size becomes much more expensive to validate.
**Who will do it:** a mix of Codex and Claude threads. Every thread starts by
reading `AGENTS.md`, the [code map](../technical/code-map.md) and section 2
of this document.

## 1. Why

The backend is 52 focused files. The frontend has 29 focused files and two
that are not: `app.js` (19,176 lines, 744 functions sharing one space) and
`webgpu-preview.js` (9,521 lines, mostly one 8,000-line class). Of the last
300 commits, 93 changed `app.js` and 85 changed `webgpu-preview.js`.

For work done by coding agents this costs three things:

- **Context.** Almost every task has to load part of a 19,000-line file, and
  searching it returns far more than the task needs.
- **Safety.** Any function in `app.js` can change any shared value, so a
  change in one feature can break another with nothing to warn of it.
- **Testing.** `app.js` cannot be loaded outside the running page, so 14 unit
  tests cut functions out of it as text, and about 950 other assertions check
  that exact lines of code exist instead of checking what the app does.
  (That was the position on October 6. Phase 1 dealt with it on October 7;
  the real count was 1,708. See 5.1.)

## 2. Status

Update this table in the same commit that finishes a phase.

| Phase | What | State |
|---|---|---|
| 0 | Code map with target layout; dated records archived | Done October 6 |
| 1 | Tests stop depending on where code sits | Done October 7 (see 5.1) |
| 2 | `app.js` divided by feature | Done October 8 (see 6.1) |
| 3 | Standalone helpers moved out of `webgpu-preview.js` | Done October 8 (see 7.1) |
| 4 | The 190 shader settings get names from one list | Done October 8 (see 8.1 and 8.2) |
| 5 | Close-out | Done October 8 (see 10.1) |

Phases run in order. Phase 1 must finish before phase 2 starts, or every move
in phase 2 fails tests for reasons that have nothing to do with behaviour.

## 3. Owner decisions already made

- **October 6: tests should check outputs, not code wording.** Steve agreed
  that checks which only pin the wording of the code are of little use, and
  that they may be retired. Checks that pin numbers, limits or shader maths
  stay. Before retiring a check that is the only guard on some behaviour,
  list it for Steve.

  This is a deliberate, scoped exception to the `AGENTS.md` rule "never
  delete or loosen a check to get a pass". It covers wording-only checks
  retired under phase 1 of this sprint and nothing else. Phase 1 added one
  line to `AGENTS.md` saying so (October 7), so later threads do not have to
  find this document to know it. `AGENTS.md` is not tracked by git: the line
  is on Steve's workstation only, and this section is the record of it.
- **October 8: the seven "only guard" tests stay as they are.** Phase 1
  kept the wording checks of seven tests because nothing else checks those
  features (list in 5.1), and recommended leaving them. Steve accepted the
  phase 1 report with that recommendation. They may be retired later only
  if Steve says so or an output test replaces them.
- **October 8: one full driver sweep, after phase 4.** Steve asked for the
  long tests to be saved for the end. This replaces the sweeps sections 6
  and 12 ask for after phase 2 and after phase 3. Phases 2 and 3 are
  guarded by their per-commit checks and, for phase 3, the exact
  before-and-after comparison of the numbers. The cost: a failure found by
  the one sweep has to be traced back through three phases, which is why
  each commit moves one area only.
- **October 8: phase 4 has Steve's go-ahead.** He asked for phases 2 to 5 to
  be done together.
- **October 6: no new framework, build step or language before 1.0.** The
  frontend stays plain JavaScript loaded by `<script>` tags.
- **October 6: the backend is not part of this sprint.**

## 4. Rules for every phase

**No behaviour change.** This sprint moves and renames. The app must look and
behave the same after every commit. If a move exposes a bug, report it in one
line and leave the behaviour as it was; fixing it is a separate task.

**Move, do not rewrite.** A function arrives in its new file with the same
body it left with. Tidying, renaming and "while I am here" improvements are
out of scope, because they make it impossible to tell a safe move from a
risky edit.

**One area per commit.** Each commit moves one row of the code map's target
table, so any single move can be undone alone.

**Follow the existing pattern.** New frontend files look like the existing
small ones, are listed in `index.html` the same way, and reach the packaged
app the same way. Check how the installer and the Linux package collect
frontend files before assuming a new file is picked up.

**Keep the code map true.** A commit that moves code updates the matching row
of the [code map](../technical/code-map.md).

**One thread at a time in a file.** Do not start a phase while another thread
has uncommitted work in the files it touches. Check `git status` first. If
another thread's edits are there, stop and tell Steve.

**Line endings.** Files have mixed endings and some tests match them. A new
file made from part of an old one keeps the old file's endings. See
`AGENTS.md`.

**Testing follows `AGENTS.md`.** Fast checks on every commit; the one or two
GPU checks that cover the area moved; nothing broader until the end of the
phase. Each phase below says where the stricter rule applies.

**Size is a guide.** Aim for files a reader can hold in mind, roughly 1,500
lines or fewer. Do not break up a function just to meet the number.

**Ask first.** If the code disagrees with this document, or a boundary in the
code map turns out to be wrong, say so and propose the change before
inventing a different structure.

## 5. Phase 1: tests stop depending on where code sits

**Done October 7, 2026.** The plan below is kept as what was asked for; 5.1
records what was done. A thread starting phase 2 needs only 5.1.

### Goal

After this phase, moving a function from one frontend file to another, with
no other change, fails no test.

### What was there on October 6

- `tests/test_frontend_*_contract.py` and
  `tests/test_preview_resolution_contract.py` read frontend files as text and
  assert that exact strings are present. About 950 assertions.
  `tests/test_frontend_inventory_contract.py` pins how many such tests exist
  (106) and which files hold them.
- 14 of the `tests/*.test.js` files read `app.js` as text, cut out a function
  between two markers and run it. These do test behaviour; they are only
  fragile about location.
- Some drivers under `tests/` and `tests/performance/` also read frontend
  source. Find them; do not assume the two lists above are complete.

### Outcome

| Kind of check | What happens to it |
|---|---|
| Asserts wording that carries no number, limit or formula (a function exists, a line is phrased a certain way, one call follows another) | Retired |
| Pins a number, a limit, a budget or shader maths | Kept, and made to pass wherever in the frontend the text lives |
| Checks page structure in `index.html` or a rule in `styles.css` | Kept as is; those files are not moving |
| Is the only thing guarding a behaviour, and is wording-only | Listed for Steve before anything is removed, with a one-line note of what would be unguarded |
| Cuts a function out of `app.js` and runs it | Kept, and made to find the function wherever it lives |

Do not write replacement output tests for everything retired. Where an
existing unit test or GPU check already covers the behaviour, that is enough.
Propose a new output test only for an item on the "only guard" list, and let
Steve choose.

The inventory test is updated on purpose to match what remains.

`AGENTS.md` gains one line under "When a check fails" recording the October 6
exception in section 3.

### Report to Steve

One short note: how many assertions were retired, how many kept, and the
"only guard" list with a recommendation for each.

### Checks

Fast checks only. No GPU checks: this phase changes tests, not the app.

### 5.1 Record (October 7, 2026)

The contract files held 1,708 assertions, not about 950.

| What | Count | Outcome |
|---|---|---|
| Page structure, styles, desktop shell and backend text | 622 | Kept as they were |
| Shader maths | 118 | Kept; read from the whole frontend |
| Numbers and limits in frontend scripts | 117 | Kept; read from the whole frontend |
| Text the user reads (messages, labels) | 17 | Kept; read from the whole frontend |
| Wording only, feature has a behavioural check | 801 | Retired |
| Wording only, no behavioural check found | 33 | Kept for Steve's decision (below) |

25 tests that held nothing else were removed with them (106 to 87 in the
seven inventory files, 10 to 4 in `test_preview_resolution_contract.py`).

How the kept checks find their text:

- `tests/frontend_source.py` gives the Python tests every script
  `index.html` loads as one text, and any function or constant by name.
- `tests/frontend-source.js` does the same for the Node tests. The 14 tests
  that cut functions out of `app.js` between two markers now name the
  functions; each old range was checked to rebuild to the same code. The 20
  tests that read `webgpu-preview.js` go through one list of the files the
  renderer is made of (`PARTS`), which phase 3 extends.
- The two helpers were compared on all 1,141 declarations in the frontend
  and return the same text.
- Also converted: the scope checks in `test_histogram_correctness.py` and
  `test_scope_correctness.py`, and the optional source patch in
  `desktop/tests/preview-diagnostic.js` and `preview-restore.js`.

`AGENTS.md` has the line recording the October 6 exception. That file is
not tracked by git, so the line exists on this workstation only.

Checks run: `node --test tests/*.test.js` (419 pass) and
`.venv/Scripts/python.exe -m pytest tests -q` (1,555 pass, 3 skipped; 25
fewer than before, the retired tests). No GPU check: no app code changed.
Commits `7369aa2`, `5349b80` and `8b2c0c7`.

Proof of the goal: in a throwaway copy, six functions were moved out of
`app.js` and one helper out of `webgpu-preview.js` into new files listed in
`index.html`. No unit or contract test failed because of the move. This
proves the tests; it does not prove the app runs with code moved, which is
still phase 2's first job (section 6).

**How "has a behavioural check" was judged.** Per feature, not per
assertion: a test's wording checks were retired when a GPU check or unit
test exercises that feature (curve editor, exposure bands, local
adjustments, masks, geometry tools, Denoise, scopes, SDR Match, export,
media browser, preview tiers, and so on). A retired check may therefore
have been the only trace of one small detail inside a feature that is
otherwise covered. If a regression of that kind turns up, the retired text
is in the diff of commit `5349b80`.

**What later phases need to know.**

- A moved function needs no test change, provided its new file has a
  `<script>` line in `index.html`. Both helpers take their file list from
  there.
- A name must be declared once in the page's shared scope. If a move would
  leave two top-level declarations with the same name, the helpers fail
  with a message naming both files. `buildGpuScopePayload` is already
  declared in both `app.js` and `scope-analysis.js`; no test asks for it
  today.
- Phase 3 adds the new renderer files to `PARTS` in
  `tests/frontend-source.js`.
- Kept checks still pin exact text. Moving code never fails them; editing a
  pinned line does, and that is their job.

Not covered: checks that slice a method out of the renderer class by its
neighbours (`denoise-source-load-ownership`, `tiled-cancellation-cleanup`).
The class is not being divided in this sprint.

**Wording checks kept because nothing else checks the feature.** Each is
location-proof now, so none blocks phase 2. Decision (section 3, October 8):
they stay as they are.

| Test | Feature it is the only automated trace of |
|---|---|
| `test_help_tooltips_are_portaled_and_clamped_to_the_visible_app_bounds` | Help tooltips stay inside the window |
| `test_default_shortcuts_are_conservative_and_warn_about_macos_system_bindings` | The default keyboard shortcut table and the macOS warning |
| `test_tint_controls_follow_darktable_hue_mapping` | Tint slider colours |
| `test_macos_uses_the_native_application_menu_without_renderer_duplicates` | macOS menu handling (cannot be run on the Windows workstation) |
| `test_desktop_source_open_handoffs_surface_failures` | An error message when a file handed over by the desktop shell fails to open |
| `test_project_open_shows_immediate_loading_feedback` | "Opening project" status shown at once |
| `test_left_metadata_panel_renders_complete_camera_and_lens_identity` | Camera and lens rows in the Metadata panel |

## 6. Phase 2: `app.js` divided by feature

### Goal

`app.js` no longer exists as a 19,000-line file. Its contents live in the
files named in the code map's `app.js` target table. An agent asked to change
the curve editor opens `curve-editor.js` and little else.

### Context a thread should know

- `app.js` is an ordinary script, not a module. Its functions, its `state`
  object and its `els` object are visible to each other because they share
  one scope. Scripts loaded by separate `<script>` tags share that scope too,
  so a function can usually move to another file unchanged. This is a known
  property of the language, but it has not been tried on this file: confirm
  it on the first move before relying on it.
- What can go wrong is order. Code that runs as the file loads (not inside a
  function) needs everything it touches to be loaded already. Find that code
  before moving anything near it.
- `proofing-ui.js` loads after `app.js` today and uses things from it.
- Since phase 1 the tests do not care which frontend file a function is in
  (5.1). A test that fails after a move is telling you something else: the
  new file has no `<script>` line, a name is now declared twice, or the move
  changed the code.
- The small modules also export themselves for Node so unit tests can load
  them. A moved cluster that touches no page element (`path-geometry.js` is
  the clearest case) can do the same, which lets its tests load it directly
  instead of cutting it out as text. Do that where it is free; do not
  restructure code to make it possible.

### Order

Start with clusters that are self-contained and have their own GPU check, so
the method is proven where a mistake is easy to see: path geometry, curve
editor, tone equalizer, media browser, geometry tools. Leave the centre for
last: state, start-up, viewer status and the preview pipeline.

### Outcome

- Each row of the target table is a file holding that row's functions.
- What remains of `app.js`, if anything, is start-up and event wiring.
- `bindEvents` and `markRefining` (about 600 lines each) move whole. Breaking
  them up is rewriting and belongs to a later task.
- Nothing about how features share `state` changes. This phase gives small
  files, not walls between them. Section 9 covers the walls.

### Checks

Per commit: fast checks, `startup-state.js` (the app still starts), and the
GPU check for the feature moved. Where a feature has no GPU check, say so in
the commit note and do not substitute a broad one.

End of phase: this is a release-point-sized change. Tell Steve the phase is
ready, give the estimated time for the full driver sweep, and ask before
running it. Steve also tries the app himself.

### 6.1 Record (October 8, 2026)

Moved all 34 agreed feature areas into the code-map files in separate local
commits, with the matching map row and script registration in each. `app.js`
now holds only the original startup calls. All 843 original top-level
functions/constants remain exactly once with unchanged bodies and values;
new files retain their source slices and line endings. The first path move
proved unchanged functions work across scripts in the running app.

Packaging checked before the first move: both PyInstaller specifications
collect the entire frontend directory, and Flatpak copies it recursively.
No package was built. No CPU export, Proof, shader arithmetic, limit, budget
or read-only project was changed.

Each commit ran the 419 Node checks, the Python suite, and Electron
`startup-state.js` at 2560 by 1440. The Python suite normally passed 1,555
with 3 skipped. The first move recorded one unrelated decoder-cancellation
timing failure (2.08 seconds against 2 seconds); no test was changed or
loosened. Feature drivers ran serially for paths, curves, exposure bands,
media browsing, perspective, highlights, Denoise, locals, masks, SDR Match,
export, imports/projects, source panels, compare/zoom, overlays/layout,
range controls, Peak/scopes and preview tiers. Areas without a dedicated
short GPU check are noted in their commit messages; no broad substitute
was run. The state move initially loaded before the Curves/Exposure Bands
default factories; startup caught it. Loading state after those two files
restored the original initialization order without editing any function.
No existing app defect was fixed.

The full sweep is held for the agreed phase 4 test block. Steve tried the app October 8 and reported that it was working great. Phase 3 must preserve the shared scope between renderer
helpers and add both new helper files to the tests' `PARTS` list.

## 7. Phase 3: helpers out of `webgpu-preview.js`

### Goal

The standalone functions above and below the `HDRWebGPUPreview` class live in
two files of their own, `gpu-render-plan.js` and `gpu-params.js`, and the
class file holds only the class.

### Context

These functions do not touch the GPU. They decide how a frame will be
rendered and turn the project's adjustments into the numbers the shaders
read. Several unit tests already exercise them; check how those tests reach
them today before choosing how the new files expose them. Since phase 1
they reach `webgpu-preview.js` through `frontendSource` in
`tests/frontend-source.js`; adding the two new files to its `PARTS` list
makes every one of those tests load them.

### Strict testing applies

`buildParams` feeds pinned shaders, so this phase is under the "still strict"
rule in `AGENTS.md` even though it is a move. A cheap and exact proof is
available: for a set of real projects, the numbers `buildParams`,
`buildCurves` and `buildLocalParams` produce, and the plans `buildRenderPlan`
and `buildTiledPlan` produce, should be identical before and after. Capture
them before the move and compare after. Then run the GPU parity checks that
cover direct and tiled rendering.

### Not in this phase

Dividing the class itself. It holds 180 methods that share about 110 fields,
and its two largest methods are the tiled and direct render paths. The code
map lists the natural groups inside it. At the end of this phase, report in a
few lines whether splitting the class looks worthwhile and what it would
risk, and let Steve decide whether it becomes a follow-up.

### 7.1 Record (October 8, 2026)

Moved the standalone helpers above and below the renderer class into
`gpu-render-plan.js` and `gpu-params.js` in two local commits, updating the
code map and page scripts with each. Both files are in the tests' `PARTS`
list. All helper bodies and the complete renderer class are unchanged;
shared scope wiring keeps their existing calls working across the files.

Captured and compared `buildParams`, `buildCurves`, `buildLocalParams`,
`buildRenderPlan` and `buildTiledPlan` for three read-only real projects:
the primary photograph, the four-mask project and the fifty-local project.
All 48 global grade/curve cases, 944 local buffers and 288 direct/tiled plan
pairs are identical before and after each move. Project archive hashes are
unchanged. Both commits ran the Node/Python fast checks and Electron startup
at 2560 by 1440; direct highlight parity and tiled/direct parity ran serially
once for the completed helper group. No new failure was found. The full
sweep remains held for phase 4.

The class still has 180 methods sharing about 110 fields. Its natural groups
could make later work easier to navigate, but dividing it risks GPU resource
ownership, cancellation and presentation of stale frames. Leave that as a
separate follow-up after this move-only sprint.

## 8. Phase 4: names for the 190 shader settings

**Authorized by Steve October 8.** Implementation may proceed. Before the
long validation block, report its contents and estimated time and wait for
Steve's answer. This phase touches every pinned shader and is the most
expensive phase to validate.

### Problem

The renderer passes the shaders one list of 190 numbers. The JavaScript
writes them by position and the shader code reads them by position (`p[10]`),
about 450 times. Only 14 positions have names. Adding a control means
matching positions by hand in two languages, and a mismatch draws a wrong
image without any error. Three positions belong to a feature that was removed
and are still declared.

### Goal

There is one list that gives every setting a name and a position. The
JavaScript and the shader code both take their positions from that list. No
bare position number remains anywhere else. A setting that is written but
never read, or read but never written, is caught by a fast test.

### Constraints

- The images must not change. The numbers sent to the GPU for a given project
  are identical before and after, and the same before-and-after comparison
  used in phase 3 proves it.
- Positions do not move in this phase. Naming and reordering are separate
  risks; this phase only names.
- Local adjustments and masks have their own lists of settings. Report
  whether they have the same problem; do not widen the phase to cover them
  without asking.

### Checks

Strict. Fast checks, shader compilation, every GPU parity check for direct,
tiled, local and scope rendering, and preview-against-export comparison.
Estimate the time and ask Steve before running.

### 8.1 Implementation record (October 8, 2026)

Added `gpu-param-layout.js`: one frozen list of 190 named positions, from
which JavaScript indices and WGSL positions are derived. All positions stay
fixed. The three retired Denoise entries and the existing gap stay reserved;
the Detail-enabled flag is checked against its host-side graph consumer.
Global writers, renderer patches and graph readers now use names. The
shader arithmetic, tolerances, limits and budgets are unchanged.

The phase 3 comparison still matches every captured Float32 buffer and
render plan for the three real projects, and their archive hashes match.
All four generated WGSL sources are byte-identical to the original sources.
The fast Node suite passes 427 checks, including eight new checks for the
layout, load order and actual writer/consumer agreement. Deliberate missing
writers, missing shader readers, unknown names, reserved uses and bare
JavaScript positions are detected. Local writes cannot hide a missing global
writer. Existing source pins resolve names through the production list;
all existing assertions and the seven only-guard tests are unchanged.

Python fast checks and Electron startup passed. The long validation was subsequently authorized and completed; see 8.2.
No installer was built and nothing was pushed.

Local-adjustment prefixes and the analytic, brush and resampling mask lists
have the same positional-maintenance problem. Their separate layouts are
unchanged; naming them requires a separate decision from Steve.

### 8.2 Validation record (October 8, 2026)

Steve tried the development app and reported that it was working great,
then authorized the proposed long validation block. Ran the selected full
sweep once: compilation and all parity/reference/local/scope/preview-export
checks first, then the remaining interaction, routing and desktop checks,
serially at 2560 by 1440. Coverage audits, endurance and broad timing sweeps
were excluded. All three read-only project hashes remained unchanged.

The old plan contained 151 entries, two of which reference Denoise drivers
removed before this sprint (commit `464d978`). Of the 149 current drivers,
138 passed and 11 failed after the two invocation corrections below.
Nine failed drivers had already failed in the previous sweep: Black & White
parity, scope parity, tiled-film parity, editing-peak clarity reference,
local design QA, drag GPU load, luma-feather latency, phase4-preview and
tier-film consistency. `phase4-preview` completed its assertions but its
report references the `migration` variable removed before this sprint in
`6255b81`. These unrelated failures and their assertions were left alone.

Two Denoise checks newly failed relative to the older sweep: Advanced-panel
picture stability and selector-seam binding. Each was run once against an
isolated pre-modularization frontend snapshot from `30d2e51^`, served to the
unchanged driver through a temporary adapter. Both reproduced the same
failure, establishing that they already occur before phases 2 to 4.
No new application regression was identified in this sprint.

The old Electron runner did not invoke the main-script entry point of
perspective-preview-ownership. Its assertions passed once through a temporary
entry-point adapter. Desktop smoke still fetched only `app.js` for two source
assertions, a location dependency missed in phase 1. Updated only that source
loader to read the scripts the page loads; both assertions are unchanged.
The complete desktop smoke then passed once. The fast Node/Python checks and
startup passed after this loader correction. No second full sweep was run.

The exact helper captures and four generated WGSL sources remain identical.
The implementation is complete with the existing failures recorded above;
local-adjustment and mask lists remain a separate decision. Phase 5 updates
the current layout documents and files the closed dated records.

### 8.3 Release follow-up (October 8, 2026)

The two Denoise failures were driver faults. Advanced disclosure used a
locator screenshot of an oversized canvas, including page controls; its
visible HDR sample also clipped the noisy fixture to white. It now captures
only visible image pixels in SDR. Opening/closing Advanced stays pixel-exact,
and editing hidden Luminance changes the image with its stored value intact.
Selector-seam now enables the instrumentation required by its grading-stage
assertion and uses a native-sized source identity. Its report no longer
references the removed exposureSamples collection. All original assertions,
including resolved binding, atomic replacement and resource cleanup, pass.

phase4-preview drops only the stale migration report field. All original
assertions pass, including exact refinement parity, latest-generation
presentation and native backing/CSS size; the report is written successfully.

The five missing documentation links are repaired: three screenshot links
now reach the existing codebase output through the correct relative path;
two links to unavailable historical records are replaced with plain text.
No shader, CPU export, Proof, limit or read-only project changed.

Fast checks: 427 Node tests and 1,555 venv Python tests passed, three skipped.
Targeted Electron drivers ran serially at 2560 by 1440. No full sweep ran.

### 8.4 Local and mask position lists (October 8, 2026)

Part B names the existing local prefix and analytic, brush and resampling
pass records in `gpu-param-layout.js`. The global tail remains shared;
positions and all unused padding stay in place. Path coordinates, outer
widths, stroke headers, segments, feather weights and regional/native tails
have named records and strides. JavaScript writes named entries and WGSL
gets its exact original numeric text from the same definitions. Both test
source resolvers preserve existing numeric/formula assertions.

The read-only primary photograph, four-mask and fifty-local recipes were
replayed against preserved pre-change sources. All 48 global buffers,
48 curve buffers, 944 local buffers, 116 raster buffers, 60 gradient buffers,
60 luma buffers, 133 feather/exact-box buffers, 64 native-brush buffers and
472 resampling buffers matched byte for byte. Archive hashes stayed fixed.
All 13 shader-text comparisons matched: the four main shader sources,
brush source fragments and complete assembled/native modules, resampling/crop
source and inline luma compute source. No shader math, CPU export, Proof, tolerance, limit or budget changed.

Seven fast checks pin every pass position and inspect real writers and
shader readers; missing writers/readers, unknown names, reserved reads and
bare shader/host positions are detected. Node: 434 passed. Venv Python:
1,555 passed, three skipped. An initial Python run failed because its source
resolver expected only the global list; the resolver now reads each list
separately, retaining all original assertions.

Targeted Electron checks ran serially at 2560 by 1440: shader compilation
and local Detail, local-grade GPU/export (24 cases), native raster masks
(93 cases), resampled masks (112 regions under existing guards), and native
brush Feather (114 regions) passed. The direct/tiled driver passed standard
256/512 and maximum-radius 256 with zero differences, then refused its
maximum-radius 512 capture because two Direct screenshots changed within
one renderer generation. That capture-stability failure remains recorded;
no guard was loosened, no rerun or unrelated repair was made. Full sweep,
installer, push and part C remain held for Steve's decision.

## 9. Not in this sprint

| Item | Why not |
|---|---|
| Walls between features (each file declaring what it reads and changes, instead of everything sharing `state`) | The real fix for "a change here breaks something there", but it is redesign, not moving. It is far safer once the files are small. Worth proposing as the next sprint after this one. |
| Splitting the `HDRWebGPUPreview` class | Decided after phase 3. |
| `styles.css` (9,111 lines) and `index.html` (1,825) | Large, but changes to them rarely break behaviour silently. |
| `adjustments.py` and `main.py` in the backend | The largest backend files, but each has one job and the backend is not where agents lose time. |
| A build step, modules, TypeScript or a framework | Decided against before 1.0. |
| Reorganising the 227 files in `tests/` | Naming already makes checks findable. |

## 10. Phase 5: close-out

- Final pass on the code map: the "today" sections describe the new layout
  and the "target layout" section is removed.
- `docs/technical/architecture.md` "Frontend components" and
  `docs/technical/development.md` "Repository layout" match the new layout.
- Dated records for the Viewport-Bounded GPU Preview sprint that were left in
  `docs/technical/` on October 6 because that work was still open (those
  dated October 4 or later) move to `docs/technical/archive/`, if that sprint
  has closed. Links are updated in the same commit.
- Two notes live in `codebase/docs/technical/`, outside the documentation
  tree. `tests/test_docs_root.py` records the trouble that folder once
  caused. Move them beside the other technical documents and update the links
  to them.
- No release note: nothing a user can see has changed.

### 10.1 Close-out record (October 8, 2026)

Updated the code map to describe the current feature files, renderer helpers,
script order and global setting list; removed the obsolete target-layout and
monolith descriptions. Architecture's frontend components and development's
repository layout describe the same files and shared scope.

The Viewport-Bounded GPU Preview sprint was closed October 6 with known
issues, as recorded in its final validation note. Moved the seven remaining
October 4-or-later records into `docs/technical/archive/`. Moved the two
Denoise notes from `codebase/docs/technical/` beside the other technical notes.
Updated links and explicit paths in the relocated records and referring
documents. All relocated targets and their updated links resolve; no new
missing relative-link target was introduced. Five existing missing targets
elsewhere in the documentation were left unchanged.

Fast checks passed: 427 Node tests and 1,555 venv Python tests, with three
skips, including the documentation-root checks. No GPU check covers these
documentation-only changes; no broad substitute was run. The approved
single sweep is recorded in 8.2 and was not repeated. No release note,
installer or push. Steve's successful app check is recorded in 8.2.

## 11. What could go wrong

| Risk | What it would look like | Guard |
|---|---|---|
| A moved piece loads before something it needs | The app fails to start, or one panel is dead | `startup-state.js` after every commit; self-contained clusters first |
| Two threads edit the same big file | Lost work or a tangled commit | One thread at a time; check `git status` before starting |
| A retired check was the only guard on something | A later regression goes unnoticed | Phase 1 kept seven tests' wording checks for this reason (5.1). Coverage was judged per feature, so a small detail may be unguarded; the retired text is in commit `5349b80` |
| A new file is missing from the packaged app | Works in development, broken in the installer | Confirm how packaging collects frontend files in the first commit of phase 2; installer check at the next release point |
| A move is mixed with an edit | A behaviour change hides inside a large diff | Move-only rule; one area per commit |
| A shader setting lands in the wrong position | Wrong image, no error | Before-and-after comparison of the numbers in phases 3 and 4 |

## 12. Done means

- No frontend JavaScript file other than the shader text and the renderer
  class is much over 1,500 lines.
- Moving a function between frontend files fails no test. (Met October 7;
  see 5.1.)
- The code map describes the layout as it is.
- The one full driver sweep after phase 4, as agreed October 8, identifies
  no new application regression caused by the sprint; existing failures are
  recorded in 8.2.
- Steve has used the app and found nothing changed.
