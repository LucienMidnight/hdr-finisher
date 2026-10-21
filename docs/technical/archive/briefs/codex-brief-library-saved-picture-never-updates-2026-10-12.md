# Codex Bug Fix Brief — Saved-Grade Picture Never Appears
## HDR Finisher

**Date:** October 12, 2026
**Branch:** `photo-library` only.
**Read first:** `AGENTS.md`.

## What's broken

Steve opened a RAW from the Library in Grade, turned it black and white,
and clicked Library with Autosave on. The Library picture never changed to
the edited version. Going to another folder and back did not help.

Photo: `D:\test-photos-delete-later\DSC07062.ARW` (read only; work on a
disposable copy). The grade is in the `.hdrf` beside it.

## What should happen instead

Every saved grade gets its Library picture, whatever the grade is. If
making a picture ever does fail, the Library tries again without Steve
having to edit and save the photo again.

## What is known

From Steve's own log
(`%APPDATA%\hdr-finisher-desktop\logs\backend.log`, the save at
`grade_save_queued` for that photo):

- The save succeeded. The open-photo route produced the source and both
  renders (`kept_source_ready`, `kept_rendered`).
- The picture then failed at the encode:
  `kept_picture_failed ... "received bad value for hdr capacity max
  1.000000, expects to be > hdr capacity min 1.000000"`.

Hypothesis, not confirmed: for this grade the HDR version is no brighter
than the SDR version, so the gain map has no headroom, and the encoder tool
refuses a map whose maximum equals its minimum. Claude has not found which
of the encoder steps raises it, and has not checked whether the old
re-open route fails the same way. Confirm the cause before fixing.

Because the kept picture uses the same writer as JPEG gain-map export, the
same grade may fail to export. **Check this and report it. Do not change
export behaviour in this brief.** If export is affected, stop and put the
options to Steve.

Two further things seen in the same log, for you to confirm:

- After a failure nothing tries again. The log's own action text says the
  default look is kept until the next save.
- 59 earlier `kept_picture_failed` lines have an empty reason. They look
  like jobs replaced by a newer save. If so they are not failures and
  should not be logged as failures.

## What to do

1. Reproduce on a disposable copy with a check that fails today.
2. Find the real cause and fix it so that a grade with no HDR headroom
   gets a correct kept picture in both the HDR and SDR Library views.
3. Make a failed kept picture recoverable: the Library asks again at a
   sensible moment (for example when the photo is next shown), without
   retrying in a tight loop.
4. Log a replaced job as replaced, with its reason.

## Scope

- The fix belongs to how the kept picture is stored and retried. Do not
  change what JPEG or AVIF export writes, Proof, any pinned shader,
  tolerance, limit or budget. If the only correct fix is inside the shared
  writer, stop and report the options and what each could affect in
  export.
- Kept pictures that work today must come out identical.
- No change to the open-photo route's guards or its reference-white
  fallback.

## Confirm before reporting

- The black and white grade on the 42 MP copy shows its edited picture in
  the same Library after an Autosave and after an explicit Save,
  development and packaged.
- A forced encode failure is followed by a later successful picture
  without another edit.
- Fast checks plus the focused saved-picture check, once. No full sweep,
  installer or push.

Report to Steve in plain language: the cause, whether export is affected,
what changed, and what to try.
