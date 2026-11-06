# Codex Brief — UI polish: unified title bar, borders, tabs, accents, icon
## HDR Finisher

**Date:** November 6, 2026
**Source:** Steve's UI review of the Library, Grade and Export screens
(Claude critique plus Steve's marked-up screenshot, November 6, 2026).

## Goal

The app chrome should feel like one calm, seamless surface. When this is done:

- one bar at the top replaces the separate menu bar and app header;
- every panel and section divider is the same thin neutral line, with no breaks;
- tabs that sit near each other look and behave the same;
- orange marks only what is selected and the main action;
- small text is easier to read;
- graphs sit cleanly inside their frames;
- the colour wheels become one Resolve-style wheel with a range switch;
- the app icon sits on a near-black tile from the design palette.

This is visual and layout work only. No change to rendering, export, Proof
or saved files.

## Context

- Electron shell: `codebase/desktop/main.js`, `codebase/desktop/lib/window-chrome.js`
  (Windows and Linux are frameless today; macOS uses the native frame). The
  separate Library window currently keeps native chrome "for Windows snap".
  Check whether that window needs the same bar, and ask if unsure.
- Colours and line tokens: `codebase/frontend/visual-tokens.css` (`--hairline`,
  `--border`, `--panel-border-internal`, `--panel-border-external`, `--app`,
  `--panel`). Three themes exist (default dark, light, studio grey). Every
  change must work in all three.
- Read first: `docs/design/HDR_Finisher_Design_Guidelines.md`,
  `docs/technical/code-map.md`. Tooltip text comes from
  `docs/design/HDR_Finisher_Tooltip_Copy.md`.

## Outcome spec

### 1. One unified top bar (Steve's decision)

| Today | After |
|---|---|
| Menu bar row (File, Edit, View, Window, Help) | Removed as a row. Menus open from a menu button in the unified bar. |
| Icon glyph and "HDRF" wordmark at the left | Both stay for now (Steve may remove the wordmark later). The menu button (≡) sits right after the wordmark. |
| Workflow tabs (01 Library … 04 Export) in the centre | Unchanged position, in the unified bar. |
| "Autosave on" and "Recent projects" at top right; window controls in the row above | "Recent projects" moves into the File menu. Window controls (minimise, maximise, close) move down into the unified bar, to the right of Autosave. |

Behaviour that must keep working:

- the whole empty part of the bar drags the window; double-click maximises
  and restores; buttons, tabs and menus inside it stay clickable;
- every menu item and keyboard shortcut still works, including Alt and
  F10 access to the menus on Windows;
- on Windows 11, hovering maximise should still offer snap layouts if
  practical. If you lose snap layouts, say so; don't hide it;
- Autosave reads as a status, not a warning (see section 4).

**macOS.** Keep the native macOS feel, but in one bar:

- the traffic lights sit inside the unified bar at the left (inset), and
  the bar leaves room for them; there are no custom window controls on macOS;
- the menus stay in the macOS system menu bar at the top of the screen, so
  there is no ≡ button on macOS. "Recent projects" goes under File (the
  standard "Open Recent" place);
- in full screen the traffic lights hide; the bar should not leave an empty
  gap where they were;
- Autosave sits at the far right, with nothing after it.

**Linux:** same as Windows (custom controls), unless the existing code shows
a reason not to.

### 2. Borders: thin, neutral, seamless (Steve's decision)

- Every panel edge and section divider uses the one thin neutral line (the
  hairline weight used inside panels today), never the thicker or brighter
  line. The marked areas are the side panel edges, the preview window
  edges, the status-line row, the Scopes header row and the scopes area.
- Where two panels meet there is one line, not two side by side.
- A divider runs as one continuous line from end to end. Today the right
  edge of the preview column breaks into separate segments at the status
  line, the Scopes header and the scopes area, with small steps between
  them (visible when zoomed in). Those breaks should go.
- Buttons, inputs and pop-ups keep their own outlines. Ask before changing
  them.

### 3. One tab style (Steve's decision)

Global / Local / Retouch and HDR grade / SDR grade sit close together in
different styles, which confuses users. Give them one shared design. The
selected tab must be obvious at a glance; the HDR/SDR switch is the most
important control in Grade. Keep where they sit today. Prefer the underline
style already used by the workflow tabs and Global / Local / Retouch, unless
you find a reason not to. Use the same style for any other tab sets in the
app you find, and list them in your report.

### 4. Accents (Steve agreed)

- Orange is only for: the selected tab or item, the main action (such as
  Export), and sliders and toggles that are on.
- The "Mod" chips go. A module that has been changed shows a small dot next
  to its "Reset" control.
- Visibility eyes are neutral grey when the module is on. A module that is
  switched off is the one that stands out.
- Autosave's dot is neutral or green, not orange.
- Toggles that are on are filled with the accent; today "ON" sits next to a
  dark grey knob and reads as off.

### 5. Text size (Steve: keep the fonts, try bigger sizes)

Keep every typeface. Raise the smallest text by about 1–2 px: control-panel
labels, the Reset dot area, the scope stats, the "Updating"/"HDR" badges, and
the hint line ("CTRL FINE · SHIFT SNAP…"). Nothing should be cropped or
overflow at the minimum window size (1100 × 720) or at 2560 × 1440. Show Steve
before and after screenshots; he decides the final size.

### 6. Library and Export fixes (from the critique)

- **"Developed" badge:** today it's on almost every thumbnail. Show the mark
  only on photos that are not developed (or on hover). Propose which in your
  report.
- **Long filenames:** shorten them in the middle, not at the end, so the end
  of the name stays visible (`DSC01204_DxO…-on.ARW`). In Details, the name
  should break at `_` or `-`, never inside the extension.
- **Library toolbar:** group the buttons with small gaps (view | sort and
  filter | compare and focus | display). "Exposure" and "HDR" need tooltips
  saying what they do. "100%" should not look broken when it isn't
  available.
- **Drag handles** (⠿) on folder and album rows show only on hover.
- **Stars:** drop the "0" before the stars in Details.
- **Copy bug in Export:** "1 photos · up to 1 files" should read "1 photo ·
  up to 1 file". Fix the plural for every count. If the two summary lines
  say the same thing, keep one.
- **Cut-off values** ("Original cropped si…", the destination path): show
  the full text on hover at least.

### 7. Graphs and scopes: clean edges (Steve's decision)

This applies to every graph in the app: the scopes (histogram and others),
curves, and any other plotted chart. In the marked histogram today:

- the horizontal gridlines poke out past the left edge of the plot;
- the vertical gridlines stick up past the top edge as small ticks;
- the line ends on the right are uneven;
- the top border is uneven or broken toward the right;
- the baseline runs past the frame at the bottom left.

After the change:

- each graph has one clean frame. Every gridline starts and ends exactly
  on that frame, with no overshoot and no gap;
- the plotted data and the fill reach the frame edges cleanly at both
  ends of the scale;
- frame and gridlines are crisp at 100% and on high-DPI screens (no blurry
  half-pixel lines), and stay clean when the panel is resized;
- the frame uses the same thin neutral line as section 2;
- axis labels (1, 10, 100, RW 203, 1k, 4k) stay where they are and stay
  readable.

What the graphs show must not change: the same data, scale and readings.
This is only how they are drawn.

### 8. Color wheels (Steve's decision; do after 1–7)

- **One wheel**, with buttons for **Shadows / Midtones / Highlights** above
  it in the shared tab style (section 3). The Hue, Saturation and Luminance
  controls below it belong to the selected range. Each range keeps its own
  values; switching only changes which range you see and edit.
- **A more technical look, closer to DaVinci Resolve:** a colourless
  (neutral dark) centre, a narrow colour ring around the outer edge, and
  thin pie-shaped gridlines (spokes) inside. No full colour disc. The
  spokes should be subtle and use the neutral line colour. The puck (the
  dot) must stay clearly visible on the neutral centre.
- Show at a glance which ranges have been changed, for example a small dot
  on the Shadows / Midtones / Highlights button, the same dot as in
  section 4.
- Units in the Hue and Saturation boxes (°, %).
- Double-click the wheel to reset the selected range.
- The grade itself must not change: the same values give the same picture.
  Saved projects keep their per-range values.

### 9. App icon background (Steve's decision)

The blue-grey tile is part of the icon file, not the taskbar. Steve wants a
near-black tile instead.

1. Find every SVG and generated icon used for the app and taskbar icon.
   Start with `codebase/desktop/assets/icon.svg` and `icon.png`,
   `codebase/frontend/assets/brand/hdr-finisher-app-icon.svg`, and the
   packaging config (`.ico`, `.icns`, Flatpak icon). The current background
   is a radial gradient from `#3a3d42` to `#303236`.
2. Replace that background with a near-black from the design palette,
   `--app` (`#0c0c0c`) or `--panel` (`#121212`). A flat fill is fine; a very
   subtle gradient between those two is also fine.
3. **Do not change the glyph's stroke width, shape or size.**
4. Regenerate every derived icon file from the SVG so they all match. Don't
   build the installer; `npm run pack:dir` is enough to see the packaged
   icon if needed.
5. The source files in `docs/design/HDR Finisher Logo/` are design
   history. Leave them unless the build reads from them.

## Constraints

- No change to rendering, the preview image, scopes data, export, Proof or
  project files.
- Don't introduce new colour tokens without asking. Reuse the existing
  ones; if a theme needs a value it lacks, ask.
- Keep the existing fonts.
- Keep each file's line endings (see AGENTS.md).
- Update `docs/design/HDR_Finisher_Design_Guidelines.md` (title bar, the
  one border rule, tab style, accent rule). Update the user manual pages that
  mention the menu bar or Recent projects
  (`docs/user-guide/application-settings-and-shortcuts.md`,
  `docs/user-guide/projects.md`).
- Small commits, roughly one per section above, so any one can be undone.
  Don't push.

## Testing (per `ai/AGENTS.md`)

- Fast checks: `node --test tests/*.test.js` and
  `.venv/Scripts/python.exe -m pytest tests -q`.
- `node tools/quick-library-check.cjs --label=ui-polish` once at the end.
- No GPU or release checks: nothing here touches rendering or export.
  Don't add tests that pin CSS or wording. A test may check the plural
  copy and that menu actions (including Recent projects) still work.
- Review page: small screenshots of Library, Grade and Export before and
  after, in dark, light and studio grey, plus the icon at 16, 24, 32 and
  48 px, a zoomed crop of each graph's corners and edges, and the new
  colour wheel. One folder, `codebase/output/review/ui-polish/`, overwritten on
  rerun. macOS can't be run here; describe what was done for it and what
  needs checking on a Mac.

## Questions protocol

If anything here conflicts with the existing code or the design guidelines,
ask before implementing. Don't invent new patterns or tokens without
checking first. Steve decides the final text size and the "Developed" badge
option from the screenshots, and signs off the new colour wheel from a
screenshot.

## Implementation outcome - November 6, 2026

All nine sections are implemented locally. The separate Library window keeps
native chrome for Windows snap; the main custom maximize button has no native
snap flyout. macOS handling is implemented but untested on a Mac. Physical
mixed-DPI behavior and OS drag/maximize gestures need manual review.

Review defaults: larger labels (14.5 px), small captions/statistics (12 px),
scope badges (11 px), hover/focus-only Developed badges, and one neutral-centre
range-selectable wheel. Steve's visual sign-offs remain open. Review screenshots
and graph corner crops live in `codebase/output/review/ui-polish/index.html`.

816 JavaScript checks pass. Python: 3,077 pass, three skip, one known unrelated
remembered-failure test fails. Plain Library picture/memory checks pass; its
existing drawing-gap limit fails at 843 ms versus 250 ms. No GPU/release sweep,
push or installer build. Final results and platform limits belong to the
Desktop and release module PRD; timings belong to the performance table.
