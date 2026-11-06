# Codex Brief — UI polish round 6: menu, sliders, minimum width, Library sidebar
## HDR Finisher

**Date:** November 6, 2026
**Follows:** rounds 1–5 (archived). Steve reviewed round 5 in the app.

## Outcome spec

### 1. Application menu becomes a vertical list

Today the ≡ button opens a horizontal strip (File, Edit, View, Window,
Help), and each opens a dropdown below it. Instead:

- ≡ opens one vertical menu listing File, Edit, View, Window and Help.
  Each opens its items in a submenu to the side, the way "Preview compares ›"
  already does inside View.
- Menu text uses the same font and size as the Control Panel module names
  (Tone, HSL, Color wheels…), for both the top list and the submenus.
- Keyboard access keeps working: Alt and F10 open the menu, the arrow keys
  move through it, and Escape closes it.
- macOS is unchanged (system menu bar, no ≡).

### 2. Menu button size and hover

- Make the ≡ icon slightly larger so its height matches the HDRF logo's
  height. Keep it vertically centred on the logo (Claude's fix `008c029d`
  centres it; keep that working).
- Give it the same hover behaviour as the workflow page names: a little
  dimmer at rest, brightening on hover.

### 3. Neutral zoom slider

The zoom slider in the preview toolbar (Grade, and anywhere else it
appears) has an orange fill. Make it neutral, matching the colour and style
of the thumbnail-size slider in the Library toolbar. The accent rule
("enabled sliders") doesn't apply to view controls like these.

### 4. Everything fits at the minimum window width

At the minimum width (1100 px) the Library toolbar wraps onto two rows
(Focus, Exposure and HDR drop to a second row). Every page should fit on
one row at the minimum width: Library (Grid and Single), Grade, Proof and
Export, including the top bar. Prefer making things fit: compact spacing,
icons, or an overflow (…) menu for less-used controls. If a page truly
can't fit without losing something important, raise the minimum width
instead; say what the new minimum is and why. Also make sure the workflow
step connectors don't shrink to dots: give them a minimum visible length,
or hide them below a width where they can't keep it.

### 5. Library sidebar

- **Section headings** (Folders, Albums, Smart Albums): larger and bold, so
  they clearly read as headings above their items.
- **"+" buttons:** show only on hover (of the section heading or the
  panel), like the drag handles. Make the "+" larger; it's small and hard to
  hit today.
- **Drag handles:** the move icons look different in different sections.
  Use one icon, size and colour for all of them. Check the Grade and Export
  panels too.
- **Diamonds next to Smart Album items:** a ◇ shows at the right of each
  smart album row (A7RIII, test). Find out what it means. If it's only a
  "smart album" marker, drop it, since the section heading already says
  so. If it does something (for example edits the rules), replace it with
  the matching bundled Tabler icon, shown on hover, with a tooltip. Report
  which it was.

## Constraints

- No change to rendering, export, Proof, project or preset files.
- Reuse existing tokens and the bundled Tabler icons. All three themes.
- Update `docs/design/HDR_Finisher_Design_Guidelines.md` (vertical menu,
  neutral view sliders, sidebar headings, hover-only add buttons) and any
  manual page that describes the menu or the sidebar.
- Keep each file's line endings. Small commits, one per section. Don't push.

## Testing

Fast checks only (`node --test tests/*.test.js`, the `.venv` pytest). Review
crops in `codebase/output/review/ui-polish/round-6/`: the open menu with a
submenu, the menu button at rest and on hover, the zoom slider next to the
Library size slider, every page at 1100 px wide, and the Library sidebar at
rest and on hover, in all three themes where it matters. Run
`tools/output_size.py` at start and end.

## Questions protocol

Ask before implementing anything that conflicts with the code or the
guidelines.
