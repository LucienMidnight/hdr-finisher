# Codebase Modularization Sprint

**Date:** October 6, 2026
**Status:** Phases 0 and 1 are done. Phase 2 has not started.
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

## 2. Status

Update this table in the same commit that finishes a phase.

| Phase | What | State |
|---|---|---|
| 0 | Code map with target layout; dated records archived | Done October 6 |
| 1 | Tests stop depending on where code sits | Done October 7 (see 5.1) |
| 2 | `app.js` divided by feature | Not started |
| 3 | Standalone helpers moved out of `webgpu-preview.js` | Not started |
| 4 | The 190 shader settings get names from one list | Not started; needs Steve's go-ahead (section 8) |
| 5 | Close-out | Not started |

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
  retired under phase 1 of this sprint and nothing else. Phase 1 adds one
  line to `AGENTS.md` saying so, so later threads do not have to find this
  document to know it.
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

### Goal

After this phase, moving a function from one frontend file to another, with
no other change, fails no test.

### What is there now

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

Not covered: checks that slice a method out of the renderer class by its
neighbours (`denoise-source-load-ownership`, `tiled-cancellation-cleanup`).
The class is not being divided in this sprint.

**Wording checks kept because nothing else checks the feature.** Each is
location-proof now, so none blocks phase 2. Steve decides whether to retire
them, keep them, or have an output test written.

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

## 7. Phase 3: helpers out of `webgpu-preview.js`

### Goal

The standalone functions above and below the `HDRWebGPUPreview` class live in
two files of their own, `gpu-render-plan.js` and `gpu-params.js`, and the
class file holds only the class.

### Context

These functions do not touch the GPU. They decide how a frame will be
rendered and turn the project's adjustments into the numbers the shaders
read. Several unit tests already exercise them; check how those tests reach
them today before choosing how the new files expose them.

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

## 8. Phase 4: names for the 190 shader settings

**Needs Steve's go-ahead before starting.** It touches every pinned shader,
so it is the most expensive phase to validate. It can be done before 1.0 or
left until after; nothing else in this sprint depends on it.

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

## 11. What could go wrong

| Risk | What it would look like | Guard |
|---|---|---|
| A moved piece loads before something it needs | The app fails to start, or one panel is dead | `startup-state.js` after every commit; self-contained clusters first |
| Two threads edit the same big file | Lost work or a tangled commit | One thread at a time; check `git status` before starting |
| A retired check was the only guard on something | A later regression goes unnoticed | The "only guard" list goes to Steve before removal |
| A new file is missing from the packaged app | Works in development, broken in the installer | Confirm how packaging collects frontend files in the first commit of phase 2; installer check at the next release point |
| A move is mixed with an edit | A behaviour change hides inside a large diff | Move-only rule; one area per commit |
| A shader setting lands in the wrong position | Wrong image, no error | Before-and-after comparison of the numbers in phases 3 and 4 |

## 12. Done means

- No frontend JavaScript file other than the shader text and the renderer
  class is much over 1,500 lines.
- Moving a function between frontend files fails no test.
- The code map describes the layout as it is.
- The full driver sweep at the end of phase 2, and again after phase 3 (and
  phase 4 if run), shows nothing new failing.
- Steve has used the app and found nothing changed.
