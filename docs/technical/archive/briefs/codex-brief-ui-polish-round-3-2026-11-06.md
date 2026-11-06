# Codex Brief — UI polish round 3: joined-plate tabs and titles
## HDR Finisher

**Date:** November 6, 2026
**Follows:** round 1 (archived) and round 2
(`docs/technical/archive/briefs/codex-brief-ui-polish-round-2-2026-11-06.md`).
Start only after round 2 is committed.

## Goal

The tabs inside panels move from round 1's flat underline style to the
app's own joined-plate style, so they match the other buttons. The top bar
gets larger workflow tabs, panel titles move to title case, and two small
alignment bugs are fixed.

## Design reference

Steve chose **option A, "Joined plates"**, from Claude's mockup (November 6).
It uses the same material as the viewer toolbar groups and segmented
controls in `visual-controls.css`:

- one joined group: segments separated by a 1 px plate edge, the outer group
  with the plate edge, rounded outer corners and the plate lift shadow;
- unselected segments are raised plates with body-colour text;
- the selected segment is pressed in (plate down + plate press), with
  accent-strong text and a heavier weight;
- the level shows through size: the top-level set is the tallest and full
  width, sub-sets are a step smaller, and the wheel ranges are the smallest
  and slightly inset.

Approximate sizes from the mockup: 30 px tall at 13.5 px text (Global /
Local / Retouch), 25 px at 12.5 px (HDR / SDR grade), 21 px at 11.5 px
(Shadows / Midtones / Highlights). Adjust to fit the real panel and the
round 1 text-size baseline.

## Outcome spec

### 1. Joined-plate tabs

Apply the style above to every tab set inside a panel: Global / Local /
Retouch, HDR grade / SDR grade, the colour wheel ranges, and any other
in-panel tab set round 1 moved to the underline style (Proof, curve
channels, scopes). List what you changed. The underline under HDR / SDR,
which today differs from the one under Global / Local / Retouch, goes away
with this change.

- The changed dot (HDR grade •, Shadows •) stays, inside the segment.
- Keyboard, focus and ARIA tab behaviour stay as they are.
- Works in all three themes with the existing plate tokens.
- **The workflow tabs in the top bar (01 Library … 04 Export) keep their
  underline style.** Steve approved the top bar.

### 2. Larger workflow tabs

In the top bar, make the step numbers (01–04) much larger and clearly
readable, and the page names larger too. The bar may grow a little in
height if needed, but it should stay compact, and dragging, the menu button
and the window controls must keep working. Show Steve a screenshot of the
bar; he decides the final size.

### 3. Panel titles in title case

Panel titles change from all caps to title case: "Metadata", "Control
Panel", "Preview Window", "Export Presets", "Export Settings", "Folders",
"Albums", "Smart Albums", "Details", "Scopes" and the like. Do this for
every panel title, so they all match. Small field labels inside panels
("FILE NAME", "HUE", "PER RENDITION", "BOTH RENDITIONS") stay as they are
for now. Keep the panel title font and weight; drop the extra letter
spacing that only suits caps.

### 4. Menu button alignment

The ≡ menu button doesn't line up with the HDRF logo: it sits off the
logo's vertical centre. Align it with the logo and wordmark.

### 5. Panel title moves on hover (existing bug)

Hovering over "METADATA" (the left Grade panel title) shifts the text
slightly. It happened before round 1. Find the cause and fix it, and check
the other panel titles for the same shift.

## Constraints

- No change to rendering, export, Proof, project or preset files.
- Reuse the existing plate tokens; don't add colours.
- Update `docs/design/HDR_Finisher_Design_Guidelines.md`: the November 6
  tab rule becomes "in-panel tab sets use joined plates; workflow tabs keep
  the underline", and panel titles become title case.
- Keep each file's line endings. Small commits, one per section. Don't push.

## Testing

Fast checks only (`node --test tests/*.test.js`, the `.venv` pytest).
Review: small crops in `codebase/output/review/ui-polish/round-3/`: the
control panel with all three tab levels in each theme, the top bar, and a
few panel titles. Run `tools/output_size.py` at start and end.

## Questions protocol

Ask before implementing anything here that conflicts with the code or the
guidelines. Steve's decisions here replace older guideline text.

Validation: 816 JavaScript tests pass. Python: 3,077 pass, three skip,
one known unrelated failure in
`test_remembered_failure_does_not_hide_current_grade_cached_scene`, already
recorded in rounds 1 and 2; not investigated or rerun. No GPU/release checks,
installer or push. No changes to processing or saved formats.

The focused Electron review passes three-theme tab heights/material borders,
21 px workflow numbers, title casing and stable hover geometry, menu open /
Escape and narrow (1440 px) Metadata hover. Review: 22 small crops (about
0.17 MB) in `codebase/output/review/ui-polish/round-3/index.html`, including
all three tab levels, toolbar and Library/Export titles. Steve's final visual
sign-off and physical mixed-DPI/native macOS trial remain manual. Nothing in
the five sections was skipped. Round 2 was already archived and recorded.

Scratch output is 29.4 GB at start and finish, below the 100 GB limit.
Review crops remain for Steve and can be deleted after sign-off.
