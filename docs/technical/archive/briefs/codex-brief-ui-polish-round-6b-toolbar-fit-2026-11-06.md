# Codex Brief — UI polish round 6b: toolbars fit by available space
## HDR Finisher

**Date:** November 6, 2026
**Follows:** round 6 (`codex-brief-ui-polish-round-6-2026-11-06.md`), which
stopped on a usage limit before section 4 (minimum width) was finished.
Steve chose this approach after Claude's review.

## Where things stand

- Commit `5eb6fa68` and the **uncommitted** `@media (max-width: 1200px)`
  blocks in `codebase/frontend/visual-controls.css` make toolbars fit at
  1100 px by turning labelled buttons into icons. Treat the uncommitted part
  as a draft: keep, rework or discard it.
- Problems Claude found in the app:
  - Reused icons that already mean something else. Focus uses the eye (the
    bypass icon); Compare and Background share square-half; Overlays and
    Exposure share brightness-half; Frame is a plain square.
  - Switching on window width does not match the real space. At 1201 px
    (just above the breakpoint) the Library and Export toolbars overlap and
    the Grade toolbar wraps onto two rows. With both side panels open, full
    labels need about 1500 px.
- Only 17 Tabler icons are bundled (`codebase/frontend/assets/icons/tabler/`),
  which is why icons were reused.

## Outcome spec

1. **Minimum window width stays 1100 px.** Every page fits on one row at any
   width from 1100 px up, with side panels open or closed: Library (Grid and
   Single), Grade, Proof, Export and the top bar. Labelled buttons never
   overlap, clip or wrap at any width.
2. **Compact by available space, not window width.** A toolbar switches
   buttons to icon-only when the toolbar itself runs out of room (container
   queries, a measured fit, or similar), so opening or closing a side panel
   has the right effect. Switch the least important labels first; prefer
   switching a whole group at once over a mix that changes every few pixels.
3. **Every icon-only button has its own clear icon and a tooltip** with the
   full label (tooltip text from `docs/design/HDR_Finisher_Tooltip_Copy.md`
   where it exists). No icon may repeat one that already means something
   else in the app (for example the eye is bypass/visibility only).
4. **More icons from Tabler, not a new library.** Add the icons you need from
   upstream Tabler Icons (outline set, same 24×24 view box, 2 px stroke,
   `currentColor`), and record each in the icon README's mapping table with
   the upstream commit. Don't add Lucide or another set: mixing sets gives
   uneven strokes and corners. Possible picks (check they read well at the
   toolbar size): Compare `layout-columns`, Focus `focus-2`, Exposure
   `exposure`, Overlays `stack-2`, Frame `frame`, Background `background`,
   Add Library selection `photo-plus`.
5. Keep the workflow connectors from `5eb6fa68` (minimum visible length).

## Constraints

- No change to rendering, export, Proof, project or preset files.
- All three themes. Keep each file's line endings (the CSS files are CRLF).
- Small local commits. Don't push.
- Update `docs/design/HDR_Finisher_Design_Guidelines.md` (compact toolbars,
  icon rule) and the UI module PRD entry. When done, archive this brief and
  the round 6 brief to `docs/technical/archive/briefs/` and update the
  documentation map in `AGENTS.md`.

## Testing

Fast checks only (`node --test tests/*.test.js`, the `.venv` pytest). Review
crops in `codebase/output/review/ui-polish/round-6/` (overwrite): each page
at 1100, 1200, 1300 and 1500 px, with side panels open and closed, plus a
hovered icon showing its tooltip. Use a temporary profile, never Steve's real
projects. Run `tools/output_size.py` at start and end.

## Questions protocol

Ask before anything that conflicts with the code or the guidelines, or if a
page truly can't fit at 1100 px without losing something important.
