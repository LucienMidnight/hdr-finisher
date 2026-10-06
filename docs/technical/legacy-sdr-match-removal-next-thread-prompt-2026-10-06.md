# Paste into the next thread — remove the legacy SDR Match and the unused shader inputs

## Goal

Two pieces of legacy code are left in HDR Finisher after the October 6 cleanup.
Remove both in one pass and test once at the end.

1. **The legacy "v1" SDR Match.** An older kind of Match that kept the HDR
   recipe hidden inside the project and rendered SDR from it through its own
   renderer. The current Match writes ordinary, editable SDR settings instead.
   Only a project saved with the old kind can still have one.
2. **The unused legacy SDR inputs in the main render shader.** They fed the
   legacy SDR renderer, which is already gone; the app now always sends their
   neutral values.

When you are done Steve has: one kind of SDR Match, no legacy Match code in
the app, a Revert button that works for the current Match, a shader without
the dead inputs, and a short plain-language report.

Steve's reason, in his words: this old code costs him "context bloat and agent
confusion which compounds over time". Favour removing code over keeping it.

## Context

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`. Run and test
directory: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`, with
many unpushed local commits. Check HEAD and status first; do not reset.
`docs/technical/viewport-phase4-cleanup-after-validation-2026-10-06.md` shows
an uncommitted edit that belongs to someone else: leave it out of your commits.

**Read `ai/AGENTS.md` first and follow it.** It sets how much to test, how to
report to Steve (owner, not a coder) and that nothing is kept for old projects
before 1.0.

Then read, in `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`,
the paragraphs in section 15.7 that start "Removed October 6", "Opening older
projects", "Old-preferences code removed" and "Legacy code still present".
They say what was removed that day and how older projects are handled now.

What that day established, so you do not rebuild it:

- **Older projects open by ignoring what the app no longer knows.** Opening a
  project drops any field the app no longer has and any choice it no longer
  offers. So you write no migration and no conversion: delete the legacy
  fields from the saved-project format and old projects still open. The
  running app stays strict.
- **Old projects are not precious.** One of Steve's saved projects
  (`IMG_0790`) has a legacy match active. After this work it will open as a
  plain SDR grade and look different. Steve has said that is fine.
- Commits `4fb9fbd`, `464d978`, `9d49380`, `99fb5aa` and `6255b81` show how
  the earlier removals were done and tested. `99fb5aa` is the closest model:
  it removed the legacy SDR renderer from the same files.

## What to remove

### 1. The legacy SDR Match

Everything that exists only so a legacy match can be active, rendered,
converted or reverted. I have not traced all of it; treat this list as where
to start looking, and trust the code over it.

| Area | What is there today |
|---|---|
| SDR panel | The main button reads "Convert legacy match" while one is active, a "Revert legacy match" button appears, and the status line says "Legacy HDR match active" |
| Rendering and export | A separate path renders SDR from the captured HDR recipe ("matched SDR base"), with its own grain handling. It is reached from the CPU render, the strip renderer, the render cache, the preview and the export |
| GPU preview | While a legacy match is active the SDR lane is drawn from a special source. That is the only user of the source-identity option the preview passes around |
| Session | Commands and rules for activating, converting and reverting a legacy match, including a rule that blocks other edits while one is active |
| Saved project | The match state stores the captured HDR recipe, captured locals, a signature and a revert snapshot |
| Tests | Python and GPU tests for the above |

Keep the current Match exactly as it is: the fit, the settings it writes, its
status ("matched" or "needs review") and its quality numbers.

If removing the legacy source leaves the preview's source-identity plumbing
with a single possible value, remove the plumbing too where that is contained.
If it turns out to be threaded through much of the renderer, stop at the entry
point, leave the rest, and say so in the report.

### 2. Revert for the current Match

Today the only Revert button is the legacy one. The current Match can only be
undone with Undo. Steve wants a Revert button regardless: after a Match, one
click puts SDR back to what it was before that Match.

What "back" means: whatever undoing the Match step restores today (the SDR
grade, SDR Denoise and the SDR side of local adjustments). Revert is itself
one undo step.

**One decision to put to Steve before building it:** should Revert still be
available after the project is saved and reopened? That requires storing the
pre-Match SDR state in the project, which is new saved state; without it,
Revert works only until the project is closed. Ask him in plain language with
that trade-off. If he is not reachable, build the session-only version and say
so.

### 3. The shader inputs

In the main render shader, the SDR path still contains the legacy base
rendition: a choice of tone mapper, its contrast and skew, a "base enabled"
switch, and a flag that selects the current SDR rendering over the legacy one.
The app now sends fixed values for all of them (`frontend/webgpu-preview.js`,
where the parameters are built, has comments marking them). Remove the
branches and functions that can no longer run, and the parameters that feed
them, so the shader states only the current SDR rendering.

Two cautions:

- The same parameter numbers are used for unrelated things in other shaders in
  the same file. Only the main render shader's SDR base rendition is in scope.
- This shader's text is pinned by a fingerprint in
  `tests/webgpu-shaders.test.js`. Steve has approved this change, so update
  the pin, and say in the commit that the pin changed and why. Do not change
  any other pinned shader, tolerance, limit or budget.

## The picture must not change

For every project that does not have a legacy match active, HDR and SDR must
look exactly as they do now, in the preview and in the export. Prove it this
way (Steve's instruction):

1. **Before changing any code**, take a baseline. Use one of the test
   projects, run "Match entire HDR grade", and export the HDR and SDR
   renditions. Keep the files outside the repository or in the gitignored
   `codebase/output/`.
2. Make both removals.
3. Repeat the same steps and compare the new exports with the baseline, pixel
   for pixel. Any difference is a failure to explain or fix, not to accept.

Test projects, read-only (never save over them):
`codebase/local-test-media/viewport/DSC00264-four-masks.hdrfinisher` and
`DSC00264-fifty-locals.hdrfinisher`.

Then run, once, after all edits:

- the fast checks in `AGENTS.md`;
- the GPU checks that cover what you touched, one at a time. On October 6 the
  useful set for this area was `tests/sdr-match-gpu-interaction.js`,
  `tests/performance/export-parity.js`,
  `tests/gpu-highlight-compression-parity.js`, `tests/tiled-direct-parity.js`,
  `tests/sdr-gamut-gpu-parity.js`, `tests/lane-roundtrip-interaction.js`,
  `tests/denoise-adaptive-parity.js` and `tests/device-loss-fallback.js`;
- a quick open of a test project in the app: both lanes reach a ready GPU
  picture, an edit saves, and Match then Revert works.

This touches CPU export and a pinned shader, which `AGENTS.md` lists as the
two places to take full care. That is why the set above is longer than usual.
It is still well under the 30-minute limit; do not add the full sweep or the
coverage audits.

## Known state of the checks

These fail today for reasons that are not yours. Name them in one line if you
see them; do not investigate.

- `tests/webgpu-shader-compilation.js`: Local Sharpen Threshold (CF-PIX-05).
- `tests/denoise-noise-view.js`: fails about one run in three (CF-PIX-08).
- `tools/run_golden_pipeline.py`: one of nine checks expects project file
  version 3; the app is on 4.

## Practical notes from October 6

- Source files have mixed line endings, sometimes inside one file. Keep each
  line's ending. Never use `git checkout` to compare versions; use
  `git cat-file blob`.
- Use the `.venv` Python for tests.
- If a mistake stops the GPU renderer, GPU checks do not fail; they hang until
  their timeout. After editing the renderer or the shader, first confirm with
  a ten-second throwaway script that a picture renders and read the browser
  console for errors. A removed variable still referenced in one place caused
  exactly this.
- If you have to stop a hung test, stop the whole test instance, including the
  Electron main process. A half-killed one leaves a "The application interface
  stopped unexpectedly" dialog on Steve's screen.
- Keep throwaway scripts in the gitignored `codebase/output/` and delete them
  when done.

## Constraints

- No migration, conversion or compatibility code for old projects or old
  settings.
- The current Match, the current SDR rendering, and CPU export and Proof
  results do not change.
- Small local commits, so any one can be undone alone: at least one for the
  legacy Match removal, one for Revert, one for the shader.
- Ask before pushing. Do not rebuild the installer.

## Questions protocol

Steve owns the project and is not a coder. Put decisions to him one at a time,
in plain language, with the trade-off and what could break. Ask before
anything that changes what the user sees beyond what this prompt describes.
If something here does not match the code, trust the code and tell him.

## Finishing

Update the "Legacy code still present" paragraph in PRD 15.7 to say what was
removed and what, if anything, was left. No new evidence document. End with a
short plain-language summary for Steve: what was removed, how the before and
after exports compared, what Revert now does, anything left behind and why,
and any decision waiting on him.
