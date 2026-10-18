# Codex Brief — Steve's testing feedback, October 16

## HDR Finisher

**Date:** October 16, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first. **Start this only after the 0.9.1 fixes brief
(`codex-brief-release-0-9-1-fixes-2026-10-16.md`) is finished**, or at a point
in it where no GPU check is running. Do not overlap GPU checks.

## Already done by Claude (do not redo)

Four small local commits landed while your release run was going:

| Commit | Change | GPU check that covers it |
|---|---|---|
| `0619db9` | Header logo: the white box behind the curve is now transparent. Desktop icon (`desktop/assets/icon.svg`, `icon.png`) and the brand app icon now use the v4 artwork; they were still v3. | `ui-refinement-detail-qa.js` |
| `7b4902f` | Film Look header shows only the modified dot, not "Mod". `film-panel-ui-check.js` now checks the group's modified state. | `film-panel-ui-check.js` |
| `835ae25` | Navigation window: press and drag now pans; keyboard still centres. | `view-tools-interaction.js` |
| `e08630a` | Library: "RAW" toggle back in the toolbar beside HDR. Filters to RAW types, combines with rules, survives Clear, is remembered, and is not copied into smart albums. Unit test added. | `library-filter-bar.js` |

Fast checks passed after all four. **No GPU check was run for them**, because
your release run was using the GPU. Add the four drivers above to the Part 4
release run of the fixes brief. If one fails because of these commits, fix it
as part of this brief.

## Items for you

Check the cause before you change anything. My notes on causes are guesses.

### 1. Peak estimate checkbox: "Updating" never clears

- **What's broken:** In the scopes panel, ticking or unticking **Peak
  estimate** shows "Updating…", and the message never goes away.
- **What should happen:** The scope refreshes and the message clears within a
  normal settle time, ticked or unticked.
- **What I saw in the code (unconfirmed):** The checkbox calls
  `refreshScopes(…, { tier: "settled" })`. The GPU scope path seems to measure
  the editing peak on every settled read whatever the checkbox says. The
  checkbox only seems to gate `applyAcceptedCpuScopePeak`. So the toggle may
  do almost nothing on GPU, and the stuck message may be a request that
  returns "stale" without clearing the freshness label, or a measurement that
  never resolves. Confirm in the running app.
- **Also report:** what the checkbox actually changes today, in one line. If
  it does nothing useful on the GPU path, say so. Steve can then decide
  whether to keep it.

### 2. Save As project does not show up in HDR Finisher

- **What's broken:** Steve used File › Save As to save
  `D:\test-photos-delete-later\save-as-test-IMG_1193.hdrfinisher`. Afterwards
  the project "doesn't show up at all" in the app. It holds edits only (no
  pixels); its source is
  `D:\Photos\Play_Raw\Contre-jourin Hawai'i\IMG_1193.CR2`.
- **Find out first:** where Steve would expect to see it, for example the
  Library folder view (it lists photos and `.hdrf` sidecars, not
  `.hdrfinisher` files), Open Recent, or the start screen. Check each place.
  Report which ones list a project saved this way and which do not.
- **What should happen:** A project saved with Save As can be found again
  from the app without browsing for it. If that needs a product decision,
  for example whether Library folders should list `.hdrfinisher` files, stop
  on this item and give Steve the choice with its trade-off. Do not decide it
  yourself.
- **Do not** open-and-save the file as a test. Copy it to a scratch folder
  first, since it is Steve's.

### 3. Opening that project: two error messages

- **What's broken:** Opening the same project shows an Automatic Match error.
  It may be an old message that never clears. It also shows a new error,
  "That photo is no longer open."
- **What should happen:** The project opens with no error. If Automatic Match
  really cannot run, its message belongs to this project only and clears when
  it should.
- **What I saw (unconfirmed):** "That photo is no longer open." is the
  Library grade API's 404, raised on a `KeyError` in
  `backend/hdr_finisher/library_grade_api.py`. A guess: a project opened from
  a `.hdrfinisher` file has a session the Library grade-saving does not know
  about. Grade-saving, or the Library background pause, then asks about it
  anyway. The Match error may be a stale banner from an earlier session that
  is not cleared on project open. Reproduce with a copy of Steve's file.
- **Also confirm:** that opening a project never writes a `.hdrf` sidecar
  beside the source unless the user saves.

### 4. Crop adjustable after it is applied (later)

- **What Steve wants:** After applying a crop, he can go back into Crop and
  adjust the same crop, rather than starting again from the cropped picture.
- **Steve's note:** "maybe skip this until later." **Do not build it in this
  brief.** Look at how crop is applied today and write Steve a short note: how
  big the change is, what could break (export/Proof geometry, masks, saved
  projects), and a rough size (small, medium or large). That is all.

## Constraints

- No change to tolerances, limits, budgets, pinned shader values, or CPU
  export/Proof. Item 1 must not change how the peak is measured for export or
  Proof.
- No migration or compatibility code (pre-1.0).
- Never save over the read-only test projects or Steve's own files. Work on
  copies.
- Keep each file's line endings. Compare with `git cat-file blob`, not
  `git checkout`.
- Fast checks after each fix, then only the GPU checks that cover it. Run GPU
  checks one at a time. If validation will take more than about 30 minutes
  of slow tests, stop and ask.
- Small local commits, one per fix. Do not merge, tag or push.

## Report back to Steve

Plain language, short:

1. For each item: fixed, needs his decision, or note written (crop). One line
   each, saying what he will notice.
2. Any decision, one at a time, with the trade-off and what could break.
3. Results of the four GPU checks for Claude's commits.
4. Your local commits.
