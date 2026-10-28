# Codex Brief: Graceful old, damaged and newer grades
## HDR Finisher

**Date:** October 28, 2026
**Repository:** `D:\AI\AI Projects\HDR Finisher Tool\ai` (code in `codebase`)

Read `D:\AI\AI Projects\HDR Finisher Tool\ai\AGENTS.md` first and follow it: testing scale, line endings (compare with `git cat-file blob`, never `git checkout`), never save over the read-only test projects, and plain-language reporting to Steve, who is not a coder.

## Goal

HDR Finisher must expect breaking changes between versions and handle saved grades gracefully. A photo is never blank because of its grade. The app keeps every part of a grade it can read, tells the user plainly what it could not read, and lets them choose what to do. Grades written by a newer version are never silently overwritten. This is a v1 requirement. The source of truth is the October 28 note at the top of `docs/product/modules/grade.md`.

## What happened

On October 27, Lift/Gamma/Gain and Shadow were removed. Every Library thumbnail then showed "Error", including photos with no grade, because stored grades and stored Library pictures still carried those fields and several Library paths validated them strictly.

Commit 1b71ced fixed the immediate problem:
- All saved data now reads through `projects.validate_saved`, which drops fields and choices this version no longer knows and stays strict for everything else.
- Remembered Library errors (`library_picture_errors.py`) now expire when the readable settings change.

The rest below is new work.

## Context

- **Saved grades** are `EditDocument` (`models.py`, `schema_version` 4). They are stored in projects (`.hdrfinisher`), Library settings files beside photos (`.hdrf`, including virtual copies and grade history), stored Library pictures, presets, batch export and queued GPU deliveries.
- **Leniency** lives in `projects.py`: `validate_saved`, `validate_saved_document` and `_FORGIVEN_ERRORS`. Live edits through `sessions.py` stay strict on purpose.
- **Library error handling already exists:** `library_picture_errors.py` (remember, ignore, retry, revert to "original") and `library_grades.py` (`previous_grade`). Build on it rather than adding a second system.
- **Pre-1.0 rule (AGENTS.md):** no per-feature migration code before 1.0. This brief builds the general mechanism and the notices, not converters for old features.

## Outcome spec

| # | Requirement | What the user sees |
| --- | --- | --- |
| 1 | No blank pictures | If a grade cannot be applied at all, the Library thumbnail, Single view, Grade and Proof show the photo with the default look and a clear warning badge, not an empty "Error" tile. |
| 2 | Keep readable sections | A section that cannot be read (out-of-range value, wrong type, damaged local adjustment or mask) falls back to that section's defaults; all other sections keep their settings. The photo records which sections were not read and why. Sections are the panel modules (Tone, Highlight Compression, Exposure Bands, Color, HSL, Curves, Color Grading, Detail, Black & White, Film Look, Vignette, Denoise, geometry, each Local adjustment, Retouch). Repairs (Retouch) must never silently change to a different fill: if a repair cannot be read, that repair is marked and skipped, not replaced. |
| 3 | User chooses | A plain message names the affected sections and offers **Continue without them** (save the readable remainder), **Revert to original**, or **Leave as is** (keep showing the warning). Nothing on disk changes until the user chooses. The untouched original grade is kept as a backup beside the photo or in the project, so a later version can still read it. Works for a single photo and for a selection in the Library. |
| 4 | Newer grades protected | Every saved grade records the app version and a per-section format version. When the app opens a grade written by a newer version, it shows what it can and says it came from a newer version. It never autosaves over that grade without the user agreeing; the original stays as a backup. |
| 5 | Say when a look changes | When the app drops a setting a photo used (a removed field or choice, such as Lift/Gamma/Gain), the photo says so in plain words, for example "This photo used Lift/Gamma/Gain, which this version replaced. It may look different." The message is shown once per photo and can be dismissed. Dropped defaults (a removed setting at its default value) are not reported, since nothing changes. |

**Where this applies:** everywhere saved grades are read, including projects, Library settings files, virtual copies, history, presets, stored Library pictures, batch export, Paste settings and queued deliveries. Live edits stay strict.

**Messages** are short and plain, in the existing app style. Use the existing Library "needs attention" surface and badges where they fit. Steve owns visual design: no restyling; propose any new UI element in the report.

## Constraints

- Keep `validate_saved` as the single entry point for reading saved data; extend it rather than adding parallel readers.
- Do not change how any picture renders when its grade is fully readable.
- Do not lose data: never delete or overwrite an original grade without the user's choice, and keep a backup when one is replaced.
- Do not save over the read-only test projects. Work on copies.
- Commit locally in small commits. Do not push.

## Checks

- **Fast checks**, plus result-based tests using fixture files for each case:
  - a removed field at default (nothing reported);
  - a removed field in use (look-change notice);
  - an out-of-range value in one section (only that section resets);
  - a damaged local adjustment;
  - an unreadable repair (skipped and marked, never refilled);
  - a grade from a newer version (no autosave over it; original kept);
  - a whole-grade failure (ungraded picture with badge).
- **Each user choice** (Continue, Revert, Leave) checked by what ends up on disk, including the backup.
- **One app-level check** with copies of real photos: the Library grid shows ungraded thumbnails with badges for damaged grades, normal thumbnails for the rest.
- **Steve's real Library and projects:** run a read-only scan with the new reader and report in one line how many photos would show a notice and why. Do not write anything.

## Report

Tell Steve in plain language:
- what he will see for each case;
- the three choices and what each does to his files;
- the scan result;
- anything not finished;
- any design decision he needs to make, one at a time with the trade-off.

Update `docs/product/modules/grade.md` and `docs/product/modules/photo-library.md`, and move this brief to `docs/technical/archive/briefs/` when done.

## Questions protocol

If anything here conflicts with the existing code, or a requirement cannot be met cleanly, stop and ask before inventing a new pattern. For example:
- the boundary of a "section" for Local adjustments;
- where backups live for photos with read-only folders.
