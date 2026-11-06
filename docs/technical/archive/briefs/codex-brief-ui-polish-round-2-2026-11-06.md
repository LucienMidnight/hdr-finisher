# Codex Brief — UI polish round 2
## HDR Finisher

**Date:** November 6, 2026
**Follows:** `docs/technical/archive/briefs/codex-brief-ui-polish-unified-title-bar-2026-11-06.md`
(round 1 is committed). Steve reviewed the result in the app.

## Goal

Fix what Steve marked after round 1. The unified top bar is approved; leave
it alone. **Tab styling is out of scope.** Claude is designing a new tab
style with Steve; don't change any tab appearance (workflow, Global / Local /
Retouch, HDR / SDR, wheel ranges, or others) in this round.

## Outcome spec

### 1. "Developed" badge setting

Round 1 made the badge show only on hover. Add an application setting so the
user can choose **On hover** (default) or **Always**. It's an application
preference (like theme), never saved in projects or presets. Put it with the
other Library or appearance settings, wherever fits the existing Settings
layout. Update the user guide page that covers Library settings.

### 2. Bypass eye: centred strike line

The diagonal line through the bypassed (struck) eye icon isn't centred on
the eye. Centre it, so the struck eye looks deliberate at 100% and on high-DPI
screens, in all three themes.

### 3. Draggable rails become clean thin lines

Where a panel edge is also a drag handle for resizing, a dark rectangle or
strip sits behind the line today, and the gridlines either side don't meet
it. Steve marked:

- the edge between the left Library panel and the photo grid (and every other
  side-panel resize edge);
- the edge between the preview window and the status bar at the bottom of the
  preview (and the scopes dock resize edge).

After the change:

- at rest, each one looks exactly like any other divider: the one thin
  neutral line, continuous, with no dark band, no gap and no step. Lines
  from the neighbouring areas meet it cleanly;
- dragging still works as now, with a comfortably wide (invisible) grab area;
- on hover, the cursor changes to the resize cursor. A subtle line highlight
  on hover or while dragging is fine; a visible band at rest isn't;
- keyboard resizing and any double-click behaviour keep working.

### 4. Color wheels: whole-module reset

The Color wheels module gets the same **Reset** (with the changed dot) that
other modules have. It resets the whole module to defaults: all three
ranges, plus Blending and Balance. Double-clicking the wheel still resets
only the selected range.

### 5. Color wheel drawing

- **Transparent centre:** inside the colour ring, nothing is filled, so the
  panel background shows through. Only the lines are drawn. This replaces
  round 1's black centre in every theme.
- **Thicker lines:** the spokes are too thin and render unevenly. Make them
  thick enough to draw crisply and evenly at 100% and on high-DPI screens.
- **Two inner circles:** add two concentric circles inside the ring (for
  example at one third and two thirds of the radius), in the same line weight
  and colour as the spokes, so spokes and circles form a polar grid.
- The puck must stay clearly visible on the transparent centre in all three
  themes. Use one puck style in every theme (today it's a ring in dark and a
  dot in light).
- The grade must not change: the same position gives the same values.

## Constraints

- No change to rendering, export, Proof, project or preset files.
- No tab appearance changes (see Goal).
- Reuse existing tokens; ask before adding new ones.
- Keep each file's line endings. Small commits, one per section. Don't push.
- Update `docs/design/HDR_Finisher_Design_Guidelines.md` for the rail and
  wheel rules.

## Testing (per `ai/AGENTS.md`)

Fast checks (`node --test tests/*.test.js`, the `.venv` pytest). No GPU or
release checks. If useful, add a check that the setting switches badge
visibility and that module reset clears all three ranges.

Review screenshots: overwrite `codebase/output/review/ui-polish/` (or a
`round-2` subfolder in it) with small crops: the struck eye, each resize
edge at rest and on hover, and the wheel in all three themes. Run
`tools/output_size.py` at start and end.

## Questions protocol

If anything here conflicts with the existing code or the design guidelines,
ask before implementing. Steve's decisions in this brief replace older
guideline text where they conflict.

## Implementation outcome - November 6, 2026

All five sections are built. The whole-module reset already existed; its
header now reserves enough room for Reset and its changed dot. No tabs,
rendering, export, Proof, project or preset formats changed.

816 JavaScript checks and three desktop-preference checks pass. Python:
3,077 pass, three skip, one known unrelated failure in
`test_remembered_failure_does_not_hide_current_grade_cached_scene` (the same
failure recorded for round 1). No GPU or release checks, push or installer.

Focused interaction review passes module/selected reset, badge switching
and reload persistence, eye/strike centre agreement, one-pixel rails,
invisible grab areas, pointer and keyboard resizing and double-click reset.
84 small crops cover all three themes at 1x and 2x in
`codebase/output/review/ui-polish/round-2/index.html` (0.38 MB total).
Application preference transport includes detached Library, but captures
used embedded Library in Chrome. Steve's visual sign-off, native detached
Library trial and physical mixed-DPI monitor review remain manual.

Scratch output is 29.4 GB at both start and finish, below the 100 GB limit.
Review crops are retained for Steve; the run's server and fast-test scratch
logs were removed. Automatic approval review blocked removal of the run's
TEMP folder `C:/Users/Steve/AppData/Local/Temp/pytest-of-Steve/pytest-1291`
with the reason "blocked by policy"; it remains available for manual cleanup.
