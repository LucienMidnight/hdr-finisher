# Slice 3 stage reports - October 11, 2026

**STOPPED AT STAGE B: kept pictures need finished HDR/SDR readback for tiled Grade rendering. That requires a further protected-rendering change, outside the encode-only writer extraction Steve approved. Stage B is not built; C and D remain pending.**

Branch confirmed with `git branch --show-current`: `photo-library`.
Repository AGENTS.md and the brief were read again before continuing. The library
technical description, required PRD sections, design guidelines and wireframes
were read during the initial investigation. Stage A remains the built starting point.

## Approved prerequisite - shared gain-map writers

Steve answered "sure" to the proposed encode-only extraction. It is now built:
the existing JPEG and AVIF writing bodies are callable with finished HDR and SDR
pixels. Export still renders its two branches exactly as before, then calls those
same writing bodies. Encoder arguments, gain-map filtering, metadata policy,
validation and whole-file export lifecycle are unchanged. Grade, Proof, shaders,
decode routes and pinned tolerances, limits and budgets are unchanged.

This removes the first blocker; it does not complete Stage B. The incomplete
Library integration was removed when the next protected boundary was found.
Only the approved writer extraction and this report remain in the change.

## Stage B - new blocker

The existing GPU finished-picture readback works only with a Direct whole-frame
result. It cannot read a complete finished grade from Tiled rendering:

- `webgpu-preview.js`, `renderTo`: admission may select Tiled; an auxiliary
  whole-picture request explicitly refuses that route (`auxiliary render`).
- `renderScopeProxy` explicitly returns a source only for Direct execution.
- `analyzeScope`, including its picture mode, needs the Direct film/spatial
  textures recorded in `scopeSources`.
- Tiled rendering processes tiles and retains their final display-mapped
  presentation. It does not expose a whole-frame pair of finished linear HDR
  and SDR pictures to the existing picture readback.

This matters because the brief requires the complete framed grade, including
local adjustments and denoise, in both lanes. Reading a display-mapped canvas
cannot preserve the authored HDR information. Omitting the readback request or
using the visible viewport cannot supply the required pair either. Forcing Direct
could bypass the existing memory admission and is not an acceptable workaround.
The existing CPU raw-preview response is display-encoded RGBA8, so it is not a
substitute for finished linear HDR pixels. A new CPU production route would also
need separate scrutiny for the brief's requirement to keep the fully corrected
Grade result rather than approximate it.

The proposed next prerequisite is to extend Grade's existing finished-picture
readback to cover a whole framed Tiled result. Temporary readback resources must
be accounted for within the existing memory budget; no pinned budget, tolerance,
rendered grade, export or Proof behavior should change. This requires editing
protected rendering code and direct checks of Tiled readback and resource lifetime.
Steve's approval was for the writer extraction, so this extension has not been made.

### Measurements and provisional choices

No format, size, save-time, grid or scrolling measurements were collected.
No performance or format claim is made. Steve's rule remains: JPEG unless
AVIF is at least 40% smaller and adds no noticeable saving or grid delay.
The pending resolution choices remain 512, 1024 and 1920, initially 1024.
Neither is marked confirmed by measurements.

Proposed location for the two controls: a Library toolbar button labelled
"Library pictures" opening one small window with storage limit, space in use,
and edited-picture resolution. This is not built.

### What slice 7 will need

Stage B must expose a backend picture request identified by photo path,
item/copy ID and exact saved-grade identity, with a replaceable producer of
finished HDR/SDR pixels. Its interface must not require the photo to be the
one open in Grade. Stage B would supply the foreground producer only.

Slice 7 needs a background producer through the existing fully corrected photo
route, with a durable queue that gives way to Grade/export and visible Library
work. It needs Activity counts and Pause/Resume, restart and unplugged-drive
recovery, latest-grade-only publication, and retention of previous pictures for
Undo and Restore previous grade. A grade change must invalidate its old picture
immediately; a stale result must not be published. Background production is not
built. These needs remain recorded in PRD section 8, "Carried forward to slice 7".

### Existing data and projects

No source photo, settings file, database layout, preference or project was
changed. No existing grade, mark or album was modified or discarded. Each edited
file retains its line endings. Unrelated untracked logo and older brief files
were left alone. No push or installer rebuild.

## Stage C - pending

Not started: Stage B is stopped and C needs its kept pictures for session-start
and previous-grade states. No completion claim or Stage C commit is made.

## Stage D - pending

Not started: it depends on the same picture storage and Stage C's safety net.
The size of adding "Keep both" has not yet been assessed. It remains pending.
No completion claim or Stage D commit is made.

## What Steve should try first

Stage A remains available for grading, saving and reopening photos. There is no
new Library behavior to try. Review the additional readback prerequisite above
first; the writer extraction is complete, but Stages B, C and D are not.

## Decisions for Steve - full list

1. Permit the narrow finished-picture readback extension for Tiled rendering.
   The trade-off is touching protected Grade rendering and checking resource
   accounting, in exchange for complete HDR/SDR reminders for all admitted
   grades. Forcing Direct could exceed its budget; using display pixels loses
   HDR information; leaving the picture missing would fail the save outcome.
2. The JPEG-versus-AVIF rule and 512/1024/1920 choices await measurements when
   Stage B can proceed. No contrary choice was made.
3. Review the proposed Library pictures toolbar window and missing-picture
   tooltip below. Claude can refine the appearance after implementation.

Resolved: Steve permitted the encode-only JPEG/AVIF writer extraction. It is
built and is no longer an open decision.

## Every new message for Steve's review

Application messages: none added. Proposed tooltip only: "This photo has a
saved grade, but its Library picture is not current. Open it in Grade and save
to update the picture."

## What was run and anything that failed

- Branch check: confirmed `photo-library` before changes, on both attempts.
- Required document reads and scoped searches of saving, picture readback,
  Tiled rendering, CPU fallback and gain-map writing.
- Focused Python checks: `test_ultrahdr_export.py`, `test_export_lifecycle.py`,
  `test_proof_export_identity.py`, `test_export_parity.py`,
  `test_library_grades.py`: 73 passed (1 minute 59 seconds).
- Required JavaScript fast checks: `node --test tests/*.test.js`: 462 passed,
  no failures (4 seconds).
- Required Python fast checks: `.venv/Scripts/python.exe -m pytest tests -q`:
  1,723 passed, 3 skipped, no failures (4 minutes 37 seconds).
- AST comparison of both extracted writer bodies against HEAD: identical
  after making reference white and metadata explicit arguments.
- `git diff --check`: passed.
- No GPU checks: the only retained code change is encode-only; no renderer,
  shader or visible Library behavior has changed. The existing focused export
  and Proof checks above exercise the protected area actually refactored.
- No broad sweep. Slow validation has not approached the 30-minute stop point.
- Earlier fast baseline before the extraction: 462 JavaScript passed;
  1,723 Python passed, 3 skipped (4 minutes 24 seconds).
- Shell access initially required approved explicit repository access. Some
  `rg` glob paths did not expand in PowerShell; directory-based searches
  supplied the needed results. These were tool invocation failures, not
  application check failures.

Local prerequisite commit: `refactor: share finished gain-map writers`.
The earlier report-only commit was `59ee23b`. B, C and D are not built.
