# Slice 3 stage reports - October 11, 2026

**STOPPED AT STAGE C VALIDATION: the cumulative longer checks are roughly 32 minutes, including a stalled Electron revert check. Steve instructed a stop at roughly 30 minutes. Stage C is not complete; Stage D has not started. The checked-out app is back at Stage B.**

**Route: the backend makes reduced kept pictures through the existing corrected source opening and export rendering functions. GPU readback and tiled rendering are unchanged.** This is the single producer for a saved grade, whether or not its photo is open in Grade. Steve's later instruction permits background completion after a save; until it completes, the Library honestly shows the default picture and the not-current mark.

Branch checked before edits: `photo-library`. Repository AGENTS.md and the brief were read again. The required technical, product and design documents were also read. Source photos, existing unrelated files, Grade shaders, export/Proof outputs and pinned budgets/tolerances remain untouched. No push or installer rebuild.

## Approved prerequisite

`5117167` shares the existing JPEG and AVIF writing bodies without changing their encoder arguments, filtering, metadata or export lifecycle. The earlier report-only blocker commit was `59ee23b`. Steve subsequently approved testing the backend alternative; the old tiled-readback blocker is superseded.

Checks for the extraction: 73 focused export/Proof/lifecycle/parity/sidecar tests passed in 1:59; 462 JavaScript checks passed; Python 1,723 passed, 3 skipped in 4:37. Both extracted bodies were AST-identical to their original bodies. Earlier baseline: 462 JavaScript and 1,723 Python passed, 3 skipped in 4:24.

## Stage B - saved pictures

A save queues a separate, low-priority helper job. It reads the original through the existing corrected opening route, reduces it, renders the authored HDR and SDR grades through the existing export functions and writes one gain-map picture in app data. It does not read the open Grade session. There is one helper lane, with native numerical thread pools limited to one thread. It gives way at phase boundaries to Grade, export, visible Library work and folder checks. Active Grade control gestures also pause Library work. In-flight native decode/encode phases finish before the next pause point; they are not interrupted mid-operation.

The picture is published only if both its saved-grade identity and source file still match. Superseded work is cancelled. Unsaved changes never appear in the Library. Missing, evicted or externally outdated pictures show the default look with an edited mark. Grid, strip, single and review use the same file. Edited-photo zoom enlarges it without starting a full source decode. Unedited-photo behavior stays as before. State is a filter and sort; edited photos have a small pencil in the strip.

The Library pictures toolbar button opens one small window containing exactly the storage limit and edited-picture resolution, plus space in use. The default limit stays 2 GiB but is now adjustable. All Library pictures share it; quick pictures go first, then oldest-viewed edited pictures. Changing resolution applies at the next save. Unknown preference fields are preserved; unreadable settings are left untouched.

### Measurements and provisional choice

Read-only camera trial: DSC00950.ARW, 7,362 x 4,920 (36 MP), with rotation, crop, independent HDR/SDR exposure and denoise. Fully corrected source opening: 5,532 ms. Lensfun reported no unique matching profile, so this particular trial did not measure an applied lens correction. The producer uses the same corrected source path when a profile is available.

| Long edge | JPEG bytes | JPEG total make time | AVIF bytes | AVIF total make time |
|---|---:|---:|---:|---:|
| 512 | 14,974 | 9,393 ms | 15,506 | 7,961 ms |
| 1024 | 41,123 | 9,533 ms | 46,509 | 8,245 ms |
| 1920 | 129,306 | 12,932 ms | 140,750 | 13,055 ms |

Totals include source opening, reduction/render and encoding, excluding queue pauses. JPEG encoding alone: 2,361 / 2,487 / 2,623 ms. AVIF encoding: 929 / 1,199 / 2,745 ms. Existing general file reader: JPEG 1,547 / 1,605 / 1,798 ms; AVIF 2,508 / 2,759 / 3,568 ms.

**Provisional choice: JPEG, 512/1024/1920 choices, starting at 1024.** AVIF is larger at every size and fails Steve's 40% saving rule. The typical camera trial at 1024 is roughly ten seconds; 1920 takes about thirteen. A busy Grade/export can delay completion because those have priority. This is a reminder, so reduced-size denoise and fine detail may differ from full-size export, as Steve allowed. Existing export/Proof render functions are called unchanged.

For its own JPEG writer's files, the Library reads the base and embedded scalar gain map directly; it does not start the general-purpose decoder's command-line processes. SDR is identical to that reader. HDR interpolation differs by about 0.39% in mean absolute error relative to the image mean on this trial; this is file reconstruction, not a second grade renderer. Direct file-read costs: SDR 7 / 23 / 79 ms; HDR 24 / 69 / 212 ms. HDR presentation retains the Library's existing 1000-nit comfort cap.

Focused Electron check on disposable small PNGs: explicit save 24 ms, next-photo opening 2,451 ms, kept picture ready 2,837 ms after save. It checked cropped saved output, edited mark, enlarged zoom without native decode, both controls and HDR switching. On the same grid drawing/transport path, first edited draw 11 ms versus unedited 4 ms; repeated draws averaged 7 versus 4 ms. These are small-photo transport/draw measurements, not a claim about a large real-camera folder's scrolling or a controlled next-photo baseline. Steve should judge scrolling on his actual photos.

### What slice 7 will need

The producer is already backend-only and accepts a photo and saved grade. `/api/library/kept-picture` can request it without opening Grade. Slice 7 must add a durable bulk queue, Activity counts and Pause/Resume, restart/offline recovery, screen-visible priority, deduplication and latest-grade publication. The single low-priority lane and phase gates can be reused. Bulk generation, presets, paste and sync are not built here. History/copy item identity must accompany those future requests so the right grade's picture is retained.

### Data and checks

New optional `.hdrf` field: `grade_default`, used to recognise an edited grade after rebuilding the index. The existing grade document is reused. Existing grades, marks, tags, albums and unknown fields remain. Existing project files are unaffected; older sidecars acquire this field at a save. `photo_grades` indexes grade identity; no existing tables are replaced.

First Stage B full fast run: 462 JavaScript passed; 1,728 Python passed, 3 skipped in 4:47. Final full run after the faster file reader: 462 JavaScript passed; 1,729 Python passed, 3 skipped in 4:40. The focused Electron check passed again. `git diff --check` passed. Focused data checks: 31 passed in 30 seconds. Existing export/Proof checks are included unchanged in the full Python run. Focused Electron checks passed; an expanded run initially counted the dialog before its asynchronous opening, then passed after waiting for the dialog. One early new crop assertion expected 50 rows instead of the actual geometry result of 52; the assertion was corrected, without changing existing checks. Trial setup initially used the wrong crop field names, then was corrected. No application failure remains known from those checks.

## Stage C - draft preserved, not complete

The draft implements one session-start state per app run, previous-grade retention,
four revert choices, counted Library confirmation and one bulk Undo. Existing
whole-file settings writing is reused. It leaves marks/albums and unknown fields
alone. An open photo gets ordinary unsaved work, except last-saved revert drops
unsaved work. History is kept locally immediately and joins the next settings-file
write; autosave off does not write the unsaved grade. Matching old pictures are
identity-keyed files already retained by Stage B.

Six new data checks passed: first-change session retention across restart without
autosaving, restoring a revert, last-saved discard, closed-photo revert and Undo,
marks/unknown fields retained, history rebuilt from a settings file, a new run's
first edit, all-file preflight, refusing Undo after an outside grade change, and
an open session revert. Full fast checks passed: 462 JavaScript; 1,735 Python,
3 skipped in 4:47. The first focused data run had one test-fixture error
(`LibraryMarks` has no `root` attribute); using its database's parent fixed it.
The subsequent six history checks passed in 2.77 seconds.

The visible check is unresolved. Two attempts clicked the revert choice but still
saw the old exposure and an open dialog. The third waited explicitly for the
dialog and finished grade, then stalled for roughly four minutes and was stopped.
That is a failed/incomplete validation, not a successful Stage C. The exact cause
has not been determined; it must be resolved before C is accepted.

Draft commit `d30520a` preserves all C code and checks. Revert commit `52a3557`
returns the current app to B, so Steve is not given unvalidated revert controls.
No draft is discarded. Original line endings were restored after Git's revert
normalised some working files. No real photos, grades or settings files were used
for those UI/data checks.

A one-line B follow-up retains polling for edited photos after their settings file
has been written. Otherwise a background picture finishing later could remain
not-current until revisiting. This correction was found in C, remains in the B
app, and passed the final 462 JavaScript checks. Python was not rerun for this
final frontend-only line after the validation stop; the recent full B and C runs
cover the unchanged backend. Its delayed-publication UI scenario still needs a
focused rerun when the test-time allowance is extended.

## Stage D - pending

Not started because C's visible validation is unresolved and the validation-time
stop has been reached. Virtual copies and Keep both have not been built. Stage A's
existing conflict notice and retention of the unchosen grade remain available.

To resume: resolve C's dialog/UI check, restore its draft, and finish its report
and acceptance commit. Then implement D and run its full fast checks plus one
focused UI check. Allow at least another 6-10 minutes of validation if there are
no further failures (about five minutes for D's Python pass and one or two minutes
per focused UI pass); fixing failures could require more. No further slow checks
were started after this stop.

Stage B acceptance commit: `94b70c8`. C and D have no completion commits.

## What Steve should try first

Save a real cropped photo with separate HDR and SDR grades and a mask. Browse it in the Library while its picture finishes, toggle HDR and enlarge it. Try a folder with many edited photos to judge scrolling. Open Library pictures and try 512 versus 1920 on the next save.

## Decisions for Steve - running full list

1. JPEG is provisional: smaller on this camera trial, with faster reading. AVIF was the other choice but failed the 40% saving rule.
2. Keep 512/1024/1920, initially 1024. The trade-off at 1920 is about thirteen seconds per camera picture instead of roughly ten at 1024; selecting 512 saves space and gives a smaller reminder.
3. The two controls live in the Library pictures toolbar window. This is quick to find and can be restyled by Claude; a future full settings page would take more work now.
4. Keep cooperative phase pauses for native decode/encode work. They avoid partial operations and source changes, but a phase already running may take seconds to yield. A separate resumable decoder would require much larger work. Foreground priority and save/next-photo independence are retained.
5. The Library's direct JPEG reconstruction avoids command-line reader delays. It preserves the SDR base exactly and approximates the general reader's gain-map interpolation in HDR. The other choice was its roughly 1.6-second CLI read per picture. Export and Proof continue using that exact general reader.
6. Draft C keeps a session-start state locally immediately, adding it to the next
   settings-file write. This preserves restart recovery without saving an unsaved
   grade. The other choice is writing history metadata beside the photo on its
   first edit even with autosave off. Losing the local database before the next
   settings-file write would lose that unsaved session-start record; the saved
   grade and already-written sidecar history remain intact. This draft decision
   is deferred with C, not active in the checked-out app.
7. Extending validation is required to finish C and D. The other choice is keeping
   the checked-out B app and its report while C's draft remains in local history.

## Every new message for Steve's review

- Library pictures; Storage limit (MiB); Edited-picture resolution; 512 / 1024 / 1920 pixels; Library picture settings saved.
- This photo has a saved grade, but its Library picture is not current. Open it in Grade and save to update the picture.
- Saved Library picture enlarged. Check detail in Grade.
- The saved Library picture is unavailable; open and save in Grade to update it.
- Library picture settings could not be read; nothing was changed.
- Choose 512, 1024 or 1920 pixels.
- Choose a storage limit of at least 1 MiB.
- The source photo changed; its Library picture was left unavailable.
- The kept picture's gain map could not be read.

New log events: `kept_picture_saved`, `kept_picture_failed`. Failure keeps the grade safe and shows the honest fallback. No broad sweep was run.

Draft C messages for review (not in the checked-out app):

- Revert…; Revert grade; Revert to original; Revert to last saved; Revert to last session; Restore previous grade.
- Choose a grade to restore. The current grade is kept as the previous grade.
- Revert <count> photos? Each keeps its previous grade.
- Reverted <count> photos. Each previous grade was kept.
- Undo last change · Ctrl+Z.
- That photo has no grade to restore for this choice.
- Resolve the grade changed elsewhere before reverting.
- The grade changed elsewhere; nothing was reverted.
- A grade changed since the revert; Undo was left available and nothing was overwritten.
- Open this photo once before reverting to its starting grade.
- The grade could not be reverted.

## What was run and anything that failed - complete ledger

- Required branch/document reads: `photo-library`, repository AGENTS.md, brief,
  technical description, required PRD sections, wireframes and design guidelines.
- Initial baseline: JavaScript 462 passed; Python 1,723 passed, 3 skipped, 4:24.
- Writer extraction: focused export/Proof/lifecycle/parity/sidecar checks 73 passed,
  1:59; JavaScript 462 passed; Python 1,723 passed, 3 skipped, 4:37. Writer-body
  AST comparisons matched. Those focused checks remain unchanged and are also in
  every later full Python run.
- B focused data checks: final 31 passed, 30 seconds. An initial new crop expectation
  was wrong (50 versus 52), corrected without changing rendering or existing pins.
- B full passes: JavaScript 462; Python 1,728 passed, 3 skipped, 4:47. After the
  in-process JPEG reader: JavaScript 462; Python 1,729 passed, 3 skipped, 4:40.
- B focused Electron: passed the kept-picture/zoom/HDR/settings/next-photo flow.
  The expanded test first counted dialog controls too early, then passed after
  waiting. Final timings and limits are above. All runs used 2560x1440, serially,
  disposable sources and app profiles. No broad GPU sweep.
- Read-only 36 MP JPEG/AVIF trial at three edges: numbers above. Two setup attempts
  used wrong crop field names; corrected before collecting the reported results.
- Existing-reader versus Library-reader comparison at all three edges: SDR exact
  to 1e-6; HDR mean relative error roughly 0.39%. New fast reader data check passed.
- C focused data: first run 25 passed and one fixture error in 29 seconds; corrected
  history-only run six passed in 2.77 seconds. C full checks: JavaScript 462;
  Python 1,735 passed, 3 skipped, 4:47.
- C Electron: two failed exposure/dialog assertions; third stalled and was stopped.
  C is not accepted. Its draft was preserved then reverted from the current app.
- Final JavaScript after the B polling follow-up: 462 passed, no failures, 3 seconds.
  No extra full Python/GPU pass after reaching the stop threshold.
- `git diff --check`: passed. Git warned that it would normalise some endings;
  each affected working file's previous endings were restored. Unrelated logo
  and older brief files were left untouched.
- One read-only tool call's automatic approval review timed out; a retry succeeded.
  Earlier shell/glob invocation issues were corrected. Nothing remains blocked by
  permission review. No source photo or real app settings were modified.
- Approximately 26 minutes of recorded baseline/extraction/B/C Python checks,
  plus focused UI runs and the stalled run, put the longer validation around
  32 minutes. This triggers Steve's explicit stop rule. No push or installer build.
