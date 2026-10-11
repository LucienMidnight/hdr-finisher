# Slice 3 stage reports - October 11, 2026

**STOPPED AT STAGE B: the proposed shared gain-map writer needs a change in protected export code. Steve's instruction requires stopping before that change. No Stage B, C or D implementation has been made.**

Branch confirmed with `git branch --show-current`: `photo-library`.
Read repository AGENTS.md, the slice 3 brief, the library technical description,
required PRD sections, design guidelines and the relevant wireframe behavior.
Stage A remains the built starting point.

## Stage B - blocker and proposed change

Grade can read finished pixels through its existing GPU picture readback.
The JPEG and AVIF export commands, however, keep their complete gain-map
writing routines inside nested `prepare` / `write` functions. Their public
entry point first renders both grades through the CPU export route. It does
not accept a pair of finished pictures from Grade.

The relevant code is in `codebase/backend/hdr_finisher/exporters.py`:
`AVIFGainMapExportBackend.export` (lines 383-469) and
`JPEGUltraHDRExportBackend.export` (lines 472-558). Both call
`_render_export_branch` before constructing their writer. The lower-level
pixel conversion, JPEG preparation, gain-map command and filtering helpers
are available, but the complete encode-only operation is not.

The proposed small prerequisite is to extract each existing nested writer
into a callable that accepts the finished HDR pixels, finished SDR pixels,
reference white, encoding settings, output path and metadata. Existing export
commands would render exactly as today and call these same writers. Library
picture commands would pass Grade's finished pixels to them. This would keep
one gain-map writing implementation and avoid a second CPU grade render for
Library pictures. Encoder arguments, numerical constants, filtering, validation,
rendering, Proof and shaders would stay as they are. Even this refactor touches
export code, so it has not been made.

Copying the nested writing pipelines into Library code would leave two
implementations to keep in step. Calling the current export entry point would
render the grade again instead of encoding the finished Grade picture. Neither
is the proposed solution to the brief's requirement to reuse existing writing.
No production monkeypatch of the export renderer is proposed.

After permission for that exact extraction, validation should cover the
existing JPEG/AVIF writer tests and project/sidecar Export/Proof identity,
plus the required fast suites and Stage B's focused Electron check. Do not
change or relax a pinned check. Estimate that focused work before running it;
stop again if slow validation would exceed roughly 30 minutes.

### Measurements and provisional choices

No format, size, save-time, grid or scrolling measurements were collected.
No performance or format claim is made. Steve's rule remains: JPEG unless
AVIF is at least 40% smaller and adds no noticeable saving or grid delay.
The pending resolution choices remain 512, 1024 and 1920, initially 1024.
Neither is marked confirmed by measurements.

Proposed location for the two controls: a Library toolbar button labelled
"Library pictures" opening one small window with storage limit, space in use,
and edited-picture resolution. This is a proposal; it is not built.

### What slice 7 will need

Stage B should expose a backend picture request identified by photo path,
item/copy ID and exact saved-grade identity, with a replaceable producer of
finished HDR/SDR pixels. Its interface must not require the photo to be the
one open in Grade. Stage B would supply the foreground producer only.

Slice 7 must add the background producer through the existing fully corrected
photo route, and a durable queue that gives way to Grade/export and visible
Library work. It needs Activity counts and Pause/Resume, recovery after restart
and unplugged drives, latest-grade-only publication, and retention of previous
pictures for Undo and Restore previous grade. A grade change must invalidate
its old picture immediately; a stale result must not be published. Background
production is not built by this slice. These needs remain recorded in PRD
section 8, "Carried forward to slice 7".

### Messages for review

No new application messages were added. Proposed missing-picture tooltip:
"This photo has a saved grade, but its Library picture is not current. Open it
in Grade and save to update the picture."

### Existing data and projects

No source file, settings file, database layout, preference or project was
changed. No existing grade, mark or album was modified or discarded. Unrelated
untracked logo and older brief files were left alone.

## Stage C - pending

Not started: Stage B is stopped and this stage needs its saved pictures for
the session-start and previous-grade states. No stage commit or completion
claim is made.

## Stage D - pending

Not started: it depends on the same picture storage and Stage C's safety net.
The size of adding "Keep both" cannot yet be assessed. It remains pending,
not rejected or silently omitted. No stage commit or completion claim is made.

## What Steve should try first

There is no new app behavior to try. Review the narrow writer-extraction
proposal above first. Stage A remains available for grading, saving and
reopening photos.

## Decisions for Steve - full list

1. Permit the encode-only writer extraction from `exporters.py` described
   above. The trade-off is touching protected export orchestration and needing
   focused identity checks, in exchange for sharing the existing writers with
   Library pictures. The alternatives are duplicated writer orchestration or
   another full export render at picture creation; neither is proposed.
2. The supplied JPEG-versus-AVIF rule and 512/1024/1920 choices still need
   measurements once Stage B can proceed. No contrary choice was made.
3. Review the proposed Library pictures toolbar window and the missing-picture
   tooltip. Claude can refine the appearance after implementation.

## Every new message for Steve's review

Application messages: none added. Proposed tooltip only: "This photo has a
saved grade, but its Library picture is not current. Open it in Grade and save
to update the picture."

## What was run and anything that failed

- Branch check: confirmed `photo-library` before any changes.
- Repository/documentation reads and scoped searches of saving, picture,
  renderer readback and gain-map writing code.
- `node --test tests/*.test.js`: 462 passed, no failures.
- `.venv/Scripts/python.exe -m pytest tests -q`: 1,723 passed, 3 skipped,
  no failures (4 minutes 24 seconds).
- No GPU checks: no visible behavior or rendering code was changed.
- No broad sweep, push or installer rebuild.
- Initial sandboxed shell reads could not reach the requested working folder;
  explicitly selecting it with approved filesystem access resolved that.
  Some scoped searches used PowerShell glob paths that rg did not expand;
  directory-based searches supplied the needed results. These are tool
  invocation failures, not application check failures.

Local report commit: `docs: record slice 3 Stage B protected-export blocker`.
The commit contains this report only; B, C and D are not built.
