# Codex Brief: bring the app in line with the component sheet

**Date:** November 10, 2026. **Approved by Steve** (all items below, including
every item the sheet marks Proposed).

## Goal

The app's controls look and behave like the approved component sheet,
`docs/design/component-sheet.html`, in all four themes. Each fix below is a
place Steve found where the app doesn't match it. When done, the sheet's
Proposed tokens live in `codebase/frontend/visual-tokens.css`, the sheet reads
them from there (no Proposed badges or overrides left), and the design
guideline describes the new rules.

## Context

- Read `AGENTS.md` first (testing scale, tokens rule, line endings, commits,
  disk use). The tokens rule applies: every colour, size, font, radius and
  shadow comes from a token. The new tokens below are approved; anything else
  new needs Steve's approval.
- The sheet is the visual reference. Open it in a browser (it loads the real
  tokens) and use its theme switch. Its `#spec` style block shows how each
  component is built there; match the look and behaviour, and choose how to
  build it in the app's own structure. Reuse the app's existing components
  and classes rather than adding the sheet's `hf-` classes, unless a shared
  class is the cleaner way.
- Main styles: `visual-tokens.css`, `visual-controls.css`, `styles.css`,
  `photo-library.css`, `control-panel.css`. Graphs are drawn on canvas in
  `curve-editor.js`, `tone-equalizer.js`, `highlight-controls.js` and the
  scopes code. `appearance.js` sets runtime accent tokens.
- Recent commits a0b8826d..2e9294ed (menu, splash, toolbar spacing, sheet) are
  Claude's and Steve's latest work. Don't undo them.

## Outcome spec

| Area | What should be true |
|---|---|
| Default Dark depth | Default Dark uses the sheet's surface and plate values: app #050505, panel #080808, raised #101010, input #0a0a0a, tooltip #101010; plate up/hover/down, black plate edge, lift and press shadows as in the sheet. Buttons look raised; pushed buttons look sunk in. The photo viewer and graph plot areas stay pure black. Other themes are unchanged. |
| Tabs (all joined tab plates, workflow tabs too) | Each segment carries its own depth: unselected segments raised with the lift shadow; the selected one pushed in with only the pressed shadow, so no drop shadow under it. Labels centred. Segments in a set are equal width and wide enough for the widest label (Luma/Red/Green/Blue: "Green" must not touch its divider). |
| Global / Local / Retouch | Sits `--tab-plate-inset` from the divider below it as well as above; today it touches the divider below. Same for any other tab plate. |
| Crop and Rotate | Icon-only tool plates with hover/focus tooltips naming them, the same size and behaviour as the Local and Retouch tool buttons. No label under the icon. |
| Fields (lens fields, Centre X/Y, Vignette and any other text/number input) | Rounded corners (`--radius-1`), never square. Recessed: plate edge, pressed inner shadow, input fill. Units sit inside the field at the right. Hover/focus brighten the edge. |
| Dropdowns | Respond to hover like buttons: lifted face and the chevron turns to text ink. |
| Switch rows | RAW development toggles (Distortion, Lateral chromatic aberration, Vignetting) are plain rows: no border, box or background. |
| Film Look section switches | The switch sits in the section header with no "Enabled/Disabled" text, no black background and no border. |
| Retouch and Local lists | One solid list surface with thin dividers, no pills, `--list-row-h` rows. No black corners at the top/bottom right. Scrollbar rail always shown, lighter than the list, with a pill thumb. An empty list keeps the same surface and rail with one centred muted line; no black strip. |
| Selection colour | `--accent-bed` is neutral in every theme (the pressed plate); `appearance.js` no longer derives it from the accent. Selected rows, cells and pressed filter buttons look pushed in; the accent stays only as edge or text where it is today. |
| Section titles | One style app-wide: `--section-title-font` (Afacad medium, `--font-size-lg`, sentence case) and `--subsection-title-font` (same, `--font-size-md`). Details ("FILE", "MARKS", "CAMERA") and Pinned ("Folders", "Albums", "Smart Albums") both use it. Small capitals remain only for field labels. |
| Sections and dividers | Every titled section in a panel ends with a full-width hairline divider, including the last one. Details panel: a divider under File (above Marks), one before Tags, and one under Show all. Apply the same rule to the other side panels. |
| Graphs: frame | In Curves, Exposure Bands, Highlight Compression and the histogram, the black plot area is exactly the grid: nothing black spills past the outer grid lines. Axis labels sit outside the plot on the panel surface, with room so end labels ("+6 EV", "10K", "4k") are never cut off. |
| Graphs: marks | Every limit or cut-off (Highlight Compression target, Exposure Bands 10K/PQ boundary) is a dashed line in the new `--graph-limit-line` (yellow), dashes 4×3 px, label in the same yellow. Nothing else is dashed or yellow except selected control points (they stay yellow). The 0 EV line is neutral (`--equalizer-zero` becomes the strong grid grey, not purple). Highlight Compression's curve uses the neutral curve token instead of the typed-in cyan `#68d7ed`; its no-change line is a faint solid identity line. |
| Exposure Bands band | The influence band is orange: `--equalizer-influence-wash: #ff7a1f1f`. |

## New tokens (approved)

`--section-title-font`, `--subsection-title-font`, `--list-row-h` (34px),
`--scrollbar-w` (10px), `--graph-limit-line` (= `--attention`), plus the new
values for `--accent-bed`, `--equalizer-zero`, `--equalizer-influence-wash`
and the Default Dark surface and plate tokens. Exact values are in the sheet's
`#spec` block. Keep `tokens.json` in step if it is the source for
`visual-tokens.css`.

## Constraints

- Keep these existing exceptions as they are: the primary button gradient,
  the changed-slider fill and the On switch knob (they mix colours), and the
  histogram's 55% fill.
- No changes to processing, export, Proof output, saved projects or presets.
- Keep keyboard, ARIA, tooltips, changed dots and current behaviour.
- Keep each file's line endings. Small local commits, one per area. Do not
  push.
- Tests that pin old colours or layout: update them for these intended
  changes and say so in the commit. Don't loosen tolerances.

## Testing (per AGENTS.md)

Fast checks from `codebase`: `node --test tests/*.test.js` and
`.venv/Scripts/python.exe -m pytest tests -q`. Then only the one or two
Electron UI checks that cover what changed, through `tests/run-in-electron.js`
with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`, one at a time. Make one
small review page of screenshots (Default Dark plus one light theme) in
`codebase/output/review/component-pass/`, overwritten on reruns. Run
`tools/output_size.py` at the start and end. Name unrelated failures in one
line; known: `tests/test_library_live.py:616` and the desktop macOS frame
validation test.

## Docs

Update `docs/design/HDR_Finisher_Design_Guidelines.md` with the new rules
(depth, tabs, tools, fields, switches, lists, selection, section titles and
dividers, graph frames and marks), and the sheet so it reads the tokens and
drops its Proposed markers. Move this brief to
`docs/technical/archive/briefs/` when done and update the AGENTS.md
documentation map.

## Questions protocol

If something here conflicts with the code, or a fix needs a token or change
not listed, stop and ask before inventing one. Report at the end in plain
language: what changed, what was run, what failed and why, and the review
page path.
