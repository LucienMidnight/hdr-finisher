# Codex Brief — UI polish round 5: numbered workflow steps
## HDR Finisher

**Date:** November 6, 2026
**Follows:** round 4 (`codex-brief-ui-polish-round-4-2026-11-06.md`).
Start only after round 4 is committed; it changes these tabs' font.

## Goal

The workflow tabs in the top bar (Library, Grade, Proof, Export) become
numbered steps joined by a line, replacing the underline. Steve chose
option 5 from Claude's mockup (November 6), with the number badges in the
app's plate style.

## Outcome spec

- **Each step:** a small round number badge, then the page name. Numbers are
  1–4 (no leading zero).
- **Badges use the plate material:** unselected badges are small raised
  plates (plate up, plate edge, plate lift) with body-colour numbers. The
  current page's badge is accent-filled with on-accent numbers, like the
  primary button.
- **Names:** the current page's name in text colour, the others muted;
  hover brightens them as today. Round 4's title font stays.
- **Connectors:** a short thin neutral line between steps, vertically
  centred on the badges. No underline and no other selected marker.
- **Size:** the bar keeps its height. Badges about 20 px across, numbers
  sized to read clearly in them, the name at its current size; badge and
  name share a vertical centre.
- **Behaviour unchanged:** clicking, keyboard tab behaviour, ARIA selected
  state, dragging the empty bar space, the menu button and the window
  controls all keep working.
- **Narrow windows:** at 1100 px wide nothing overlaps the menu button or
  Autosave. Connectors may shorten first if space runs out.
- **macOS:** works alongside the inset traffic lights.

## Constraints

- No change to rendering, export, Proof, project or preset files.
- Reuse the existing plate and accent tokens. All three themes.
- Update `docs/design/HDR_Finisher_Design_Guidelines.md` (workflow tabs:
  numbered plate badges with connectors) and any manual page that describes
  the tabs. Keep each file's line endings. Small commits. Don't push.

## Testing

Fast checks only (`node --test tests/*.test.js`, the `.venv` pytest).
Review crops of the top bar with each page selected, in all three themes and
at 1100 px wide, in `codebase/output/review/ui-polish/round-5/`. Run
`tools/output_size.py` at start and end.

## Questions protocol

Ask before implementing anything that conflicts with the code or the
guidelines.
