# Codex Brief — 0.9.1 release-check fixes

## HDR Finisher

**Date:** October 16, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first. This follows the focused 0.9.1 check, which stopped
at its 75-minute limit with the verdict **not ready**. Its record is in
`docs/known-limitations.md`, section "v0.9.1 pre-release check (October 16,
2026)", and the logs, commands and remaining work are in
`codebase/output/performance/review/prerelease-0.9.1-2026-10-16/`
(`summary.json`, `results.json`, `unfinished.json`).

Work through the items below in order, one after another, in this one
session. Steve has asked for them together.

## Goal

When you finish, every failure from the 0.9.1 check is either fixed, shown to
be a test problem and the test corrected, or written down as a decision for
Steve. Then the rest of the release check has run, so Steve gets a
clear ready / not ready answer for 0.9.1.

**Do not merge, tag or push.** Small local commits only, one per fix.

## Part 1 — Fix these (application bugs or likely ones)

For each one, confirm the cause before you change anything. My notes on the
cause are guesses from the test record, not a diagnosis.

### 1. Export: Confirm stays disabled

- **What's broken:** In `export-file-browser-interaction.js`, the
  file-browser export leaves the Confirm button disabled, so the four-format
  export flow cannot finish.
- **What should happen:** Once a valid folder and name are chosen, Confirm is
  enabled and all four formats export.
- **Hypothesis:** Commit `fb93f34` ("Keep the export measurement warning when
  the Export tab reopens") landed during the run and touches `export-ui.js`
  and app state. Check whether the export check ran before or after it, and
  whether it, or something earlier, blocks Confirm. It may also be a fixture
  problem, not an app bug. Find out which.
- **Strict area.** This is export. Run the export and Proof checks from the
  release list after the fix.

### 2. Black & White: Direct and Tiled previews differ

- **What's broken:** `tiled-film-parity.js` finds that Black & White frames
  differ between the Direct and Tiled paths. These are promised to match
  byte for byte. Other film cases pass.
- **What should happen:** Byte-exact match, as for the other film cases.
- **Constraint:** This is an exact-match guarantee. Do not add a tolerance.

### 3. Sharpen: response is not smooth

- **What's broken:** In `webgpu-shader-compilation.js`, the check that
  Sharpen Amount increases smoothly and in one direction fails. The likely
  area is the Detail baseline/response.
- **What should happen:** Raising Sharpen Amount never makes the picture
  less sharp and has no jumps.
- Find out whether the shader really misbehaves or whether the check's
  baseline is out of date after recent Detail changes. Fix whichever is
  wrong. If you change the test, say why in the commit.

### 4. Lens glow over the Full/4K consistency limit

- **What's broken:** `performance/tier-film-consistency.js` measures the
  Pro-Mist / Black Pro-Mist glow ratio between Full and 4K at about 1.292,
  against an unchanged limit of 1.25.
- **What should happen:** The glow looks the same at Full and 4K, within
  1.25.
- **Constraint:** Do not raise the 1.25 limit. If you find the gap comes
  from the intended lens model (the lens filters that replaced Bloom), and
  it cannot reasonably be fixed, stop work on this item. Write Steve a
  one-paragraph explanation he can follow: why it differs, whether he would
  see it, and what a new limit would be. He decides.

### 5. Grade sends a pause request the backend rejects

- **What's broken:** Grade sends a library-worker pause with reason
  `grade-control`, and the backend answers HTTP 422.
- **What should happen:** The pause is accepted, so the Library background
  work actually pauses while grading.
- Small fix. Add a fast test that would have caught it.

## Part 2 — Library failures: find out if they are real

Each of these could be a real bug or the test checking too early, before a
background write finishes. Find out which for each one.

- **Real bug:** fix the app.
- **Test timing:** make the test wait for the app's own sign that the work is
  done, not a fixed delay.

Items 7 and 8 involve what is saved to disk, so treat them seriously. Losing
or reverting a tag or rating is data loss.

| # | Driver | What the test sees | Correct result |
|---|---|---|---|
| 6 | `photo-library-stage-b.js` | Tag suggestions time out or show Family (0) | Family (2) |
| 7 | `photo-library-slice-2.js` | After a confirmed tag merge, disk still says Holiday | Disk says Sea |
| 8 | `library-background-activity.js` | An undone rating keeps changing on disk during the conflict check | The rating settles at the undone value and stays |
| 9 | `photo-library-navigation.js` | Unpin folder does not leave an empty folder tree | Unpinning the only folder leaves the tree empty, or the test expects the current intended behaviour (say which) |
| 10 | `photo-library-stage-a.js` | Single-view pixel check asks the GPU canvas for a 2D context | Test reads pixels the way current GPU-canvas tests do. Driver update only, unless it then finds a rendering bug. |

## Part 3 — Not a fix

`film-stock-parity.js`: the extreme uncompressed HDR Neutral case (added mean
3.201, p99.9 250) is a known limit already recorded in
`docs/known-limitations.md`. Leave it. Class it as **known** in the report.

## Part 4 — Finish the release check

After Parts 1–2, run the focused release check again as set out in
`docs/technical/archive/briefs/codex-brief-release-0-9-1-validation-2026-10-16.md`. Use the
same rules, window size and output folder (add a dated sub-folder or suffix,
so the first run's results stay):

- every driver in `unfinished.json` (the lens Direct/Tiled matrix, the rest
  of the lens preview/export matrix, Film Look interaction, and the 25
  Library drivers),
- every driver that failed in the first run,
- the export and Proof checks again, since export code has changed since they
  ran,
- the GPU check for anything else you changed in Parts 1–2.

The drivers that passed in the first run and are unaffected by your fixes do
not need to run again.

Estimate the time before starting. If it is over about 75 minutes, stop and
tell Steve what you want to run and the estimate.

Record the three read-only project hashes before and after. They must not
change.

## Constraints (all parts)

- Do not change any tolerance, limit, budget or pinned shader value. CPU export
  and Proof stay exact.
- No migration or compatibility code (pre-1.0).
- Keep each file's line endings. Compare with `git cat-file blob`, not
  `git checkout`.
- Fast checks after each fix (`node --test tests/*.test.js` and
  `.venv/Scripts/python.exe -m pytest tests -q`, from `codebase`). Run only the
  GPU checks that cover that fix, then do Part 4 once at the end.
- Leave the two untracked October 13 Library briefs in `docs/` alone.
- If a fix turns out to be large (a redesign rather than a repair), stop on
  that item, write up what you found for Steve, and move on to the next.

## Records

Update the "v0.9.1 pre-release check" section of `docs/known-limitations.md`
with the second run. Keep it short: what was fixed, what changed class, what is
still open, where the logs are. No per-measurement tables.

## Report back to Steve

Plain language and short:

1. One-line verdict: ready for 0.9.1, ready with known issues, or not ready.
2. For each of the ten items: fixed, test corrected, known, or needs Steve's
   decision. One line each, saying what it would mean for him using the app.
3. Any decision for Steve (for example the lens limit), one at a time, with
   the trade-off and what could break.
4. Counts from the second run: passed, failed, skipped, unfinished.
5. The local commits, ready for him to review before merge, tag and push.
