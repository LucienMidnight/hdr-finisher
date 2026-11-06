# Codex Brief — UI polish round 4: title font and Export fixes
## HDR Finisher

**Date:** November 6, 2026
**Follows:** rounds 1–3 (archived) and Claude's fixes `41aa4531` (colour
wheel ring angle) and `008c029d` (menu icon centring, workflow number size).

## Goal

A calmer font for titles, and the remaining small fixes Steve approved.
**The top-bar workflow tabs keep their current style, numbers included.**
Steve is still deciding on them, so don't restyle them in this round
(section 1 changes their font only).

## Outcome spec

### 1. Title font: Sofia Sans Semi Condensed (Steve's decision)

- Bundle **Sofia Sans Semi Condensed** (Google Fonts, SIL Open Font
  Licence) locally, like Afacad under `frontend/assets/fonts/`: the app works
  offline, so no web font loading. Take the files from the official
  `google/fonts` repository, include the licence file, and add it to
  `THIRD_PARTY_NOTICES.md` and any packaging font list.
- Use it for **titles and tab names**: panel titles (Control Panel, Preview
  Window, Folders, Details…), the workflow tab names and numbers, and the
  in-panel joined-plate tab labels. Choose weights so titles look calm, not
  heavy.
- Everything else stays Afacad: group names (Highlight compression…), body
  text, values, labels and buttons.
- Check that nothing is cut off at 1100 × 720 or at 2560 × 1440, in all
  three themes.

### 2. Export switches read as on

When a switch is on, its track is orange but the knob is dark grey, which
reads as off. The knob should read clearly in both states, for example a
light knob when on. The guideline's switch spec (recessed track,
accent-filled when on, soft plate knob) still applies; adjust only the knob.
"Export with frame" and "Prevent enlargement" are also the only rows in
Export Settings inside their own bordered boxes. Make them plain rows like
their neighbours.

### 3. Export empty-state message

"Add a Library selection, or open a photo in Grade to add it here." sits at
the very bottom of the Export screen. Centre it in the empty batch area, the
way Grade centres "Drop a RAW or image anywhere on Grade".

### 4. Disabled Export button

With nothing to export, "Export 0 files" shows in a muddy brown. A disabled
primary button should be a neutral grey that reads as "not available yet",
then turn to the accent once something can be exported.

### 5. Menu capitalisation

The File menu mixes styles ("Open Image…", "Save Project As…" next to
"Recent projects…", "Save project"). Use one style across all menus. The
guideline uses sentence case for headings (only proper names capitalised),
so use sentence case: "Open image…", "Save project as…". Keep shortcuts and
commands working. Update any manual pages that quote menu items.

### 6. Leftovers

- **Export size dropdown:** "Original cropped si…" is cut off. Show the whole
  value (a shorter label such as "Original (cropped)" is fine if the meaning
  stays the same).
- **Library "100%" button:** when it can't be used, it's greyed out and
  looks broken. Make it clear: either hide it until it can be used or show a
  normal disabled look with a tooltip saying when it works. Pick whichever
  fits the toolbar and say which you chose.
- **Library toolbar groups:** the gaps between the groups (view | sort and
  filter | compare and focus | display) are too small to notice. Make the
  grouping visible without adding lines.

## Constraints

- No change to rendering, export output, Proof, project or preset files.
- Workflow tab layout and style unchanged (font only).
- Reuse existing tokens. Keep each file's line endings. Small commits, one
  per section. Don't push.
- Update `docs/design/HDR_Finisher_Design_Guidelines.md` (title font,
  switch knob, disabled primary button).

## Testing

Fast checks only (`node --test tests/*.test.js`, the `.venv` pytest).
Review crops in `codebase/output/review/ui-polish/round-4/`: the top bar,
a few panel titles, Export Settings with switches on and off, the Export
empty state, the disabled and enabled Export button, the File menu, and the
Library toolbar, in all three themes where it matters. Run
`tools/output_size.py` at start and end.

## Questions protocol

Ask before implementing anything that conflicts with the code or the
guidelines. Steve's decisions here replace older guideline text.
