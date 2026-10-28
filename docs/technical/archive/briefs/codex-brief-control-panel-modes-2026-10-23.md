# Codex Brief: Control Panel modes (Global, Local, Retouch)
## HDR Finisher

**Date:** October 23, 2026
**Branch:** a new branch from `main` (for example `control-panel-modes`),
started **after the `hsl` branch has merged into `main`**. If HSL has not
merged when you start, ask Steve before branching. Commit locally in small
steps; ask before pushing.
**Module PRD:** `docs/product/modules/grade.md`. Update its decisions,
current state and open work as each part lands; move this brief to
`docs/technical/archive/briefs/` when done.
**Design guidelines:** `docs/design/HDR_Finisher_Design_Guidelines.md`.
Several rules there change with this work (listed under "Documents to
update").

## Goal

The Control Panel is one long scroll that mixes three kinds of work:
settings shared by both renditions, per-rendition grading, and painted
work (masks and retouching). Section numbers run straight through the
HDR/SDR switch, so it is hard to see which controls belong to which
rendition, and Local Adjustments has grown very tall (it also contains a
second HDR/SDR switch and the Inpaint prototype).

When this is done the panel has three modes, **Global**, **Local** and
**Retouch**, each showing only its own controls. The HDR/SDR choice is a
pair of folder tabs that visibly own the settings beneath them, shared
across modes. Local adjustments start with one click on a tool. The
Inpaint prototype becomes a proper Retouch panel. Nothing about image
processing, saved projects or presets changes.

## Design reference

| File | What it is |
|---|---|
| `docs/design/control-panel-wireframes/control-panel-modes.html` | Interactive mock-up (Steve approved, October 22–23). Open it through a local web server rooted at `ai` so fonts load, for example `python -m http.server 8139 --directory ai`, then `http://localhost:8139/docs/design/control-panel-wireframes/control-panel-modes.html`. Light theme by default; the top bar switches to dark. |
| `docs/design/control-panel-wireframes/screenshots/01-global-hdr-light.png` | Global mode, HDR grade, Tone open |
| `.../02-global-sdr-light.png` | Global mode, SDR grade selected |
| `.../03-local-brush-light.png` | Local mode, brush adjustment selected, Brush settings open |
| `.../04-local-new-unused-light.png` | Local mode straight after clicking the Brush tool: a new, still-unused adjustment |
| `.../05-local-gradient-light.png` | Local mode, linear gradient selected: its settings section replaces the brush ones |
| `.../06-retouch-light.png` | Retouch mode with Advanced open and a repair in progress |
| `.../07-global-hdr-dark.png`, `.../08-local-brush-dark.png` | Dark theme check |

The mock-up's URL accepts `?theme=dark&mode=local&lane=sdr&mask=2&tool=brush&open=Brush%20settings`
to reach a state directly. In Local mode, clicking the photo simulates
painting.

Treat the mock-up as a reference for layout, hierarchy and behaviour,
**not as code to copy**. It uses its own simplified CSS and sliders and
copies the app's colour tokens by hand. Build with the app's real
components and tokens (instrument sliders, segmented controls, section
bypass, Preset/Reset, Mod state, tooltips). Where the mock-up and the
app's existing component styling differ in small ways, follow the app;
where they differ in structure or behaviour, follow the mock-up.

Section bodies the mock-up only stubs ("unchanged from the current app")
keep their current controls.

## Decisions already made (Steve, October 22–23, 2026)

| Topic | Decision |
|---|---|
| Modes | A three-way segmented switch at the top of the Control Panel: **Global**, **Local**, **Retouch**. Only the chosen mode's controls show. |
| Shared sections label | The sections that apply to both renditions sit under a small label **HDR + SDR** (not "both renditions"). Retouch uses **HDR + SDR · before crop**. |
| HDR/SDR lanes | Shown as **folder tabs**, **HDR grade** and **SDR grade**, sitting on top of a folder that holds that rendition's settings. Not a switch inside a tile. |
| One lane choice | The lane is a single setting shared by Global and Local, and the preview follows it. Choosing SDR grade in Local also selects it in Global, and the reverse. The separate local HDR/SDR switch goes away. Retouch has no lane tabs. Side-by-side compare keeps working as it does today. |
| Match / Rematch | Moves out of the SDR tab to its own button at the right end of the tab row, so it can be used without switching tabs. |
| Pinned tabs | Try keeping the folder tab row pinned while the panel scrolls. If it costs too much height or looks wrong, drop it and tell Steve. |
| Section numbers | Removed everywhere. |
| Disclosure glyph | Every section and sub-section uses a small twirl-down **triangle** (pointing right when closed, down when open) instead of the chevron. |
| Renames | **Color** → **Color sliders**; **Color Grading** → **Color wheels**. Display names only. |
| Local tools | Clicking a mask tool starts a new adjustment immediately; the **+** button is removed. Full rules below. |
| Erase | Leaves the tool strip. It becomes a **Paint / Erase** switch inside Brush settings. Holding Alt while painting still erases. |
| Settings names | **Brush settings** and **Mask settings** for brush masks; **Gradient settings**, **Luma settings**, **Path settings** for the other types. |
| Retouch | Gets its own mode and proper controls (detailed below). Heal and Clone show as "Soon" until they are built. |

## Outcome spec

### Control Panel header

- "Control Panel" title, then the Global / Local / Retouch segmented
  switch, using the app's existing segmented-control look.
- The app always opens in **Global** (session-only, like other panel
  state; never saved with a project).
- Viewer tools belong to their mode: mask tools and their overlay are
  live only in Local, the retouch brush only in Retouch, crop and
  perspective editing only in Global. Leaving a mode ends any brush or
  placement tool from that mode, so a stray click on the photo can't
  paint into a hidden mode. If something in the current viewer code makes
  this awkward, ask rather than inventing a different rule.

### Global mode

- **HDR + SDR** label, then Raw development, Highlight reconstruction,
  Crop & rotate, Perspective, as today but without numbers.
- **Folder tabs:** HDR grade and SDR grade. The selected tab and the
  folder share a **2 px neutral border** (the theme's border colour), so
  tab and folder read as one shape; the selected tab keeps the small accent
  line along its top. The unselected tab has a **1 px border** and a
  recessed background (the app background tone), so it sits behind. The
  tab row's left edge lines up exactly with the folder's left edge.
- **Match button:** at the right end of the tab row, its right edge flush
  with the folder's right edge. It shows **Rematch SDR** (amber/attention
  colour, refresh icon) whenever the app's existing "Rematch required"
  condition is true, and **Match SDR** (neutral) otherwise. It runs the
  existing "Match entire HDR grade" action, with whatever confirmation and
  status messages that action already has. It does not change the
  selected tab.
- **Inside the folder:** the lane's sections in their current order,
  without numbers, with the renames above, including HSL from the HSL
  work: Denoise, Tone, Exposure bands, Lift, gamma, gain, HSL, Curves,
  Highlight compression, Color sliders, Color wheels, Black & white,
  Detail, Film look, Vignette. Section headers keep Preset, Reset,
  bypass and Mod state. Hairline separators between sections stay 1 px.
- Long section titles truncate with an ellipsis rather than running into
  the header buttons.
- All groups still start collapsed.

### Local mode

Top to bottom (see screenshots 03–05):

1. **New adjustment** label and tool strip: Brush, Linear gradient, Luma
   range, Path. To the right: the mask overlay toggle and a **More** menu
   holding the less frequent actions that are currently large buttons:
   Invert mask, Hide gizmo, Overlay colour, Clear brush, Undo stroke (use
   the app's existing actions; keep any that only apply to some mask types
   disabled or hidden as appropriate).
2. **Masks · HDR + SDR** label with remove, duplicate, move up and move
   down buttons (no +), then the adjustment list. Each row: name, mask
   type ("Brush", "Linear gradient", "Luma range", "Path", the app's
   existing labels), bypass eye, and the existing ⋯ row menu (sub-masks
   with Union / Intersection / Subtract stay exactly as today). The list
   shows about four rows and then scrolls; space for the scrollbar is
   always reserved so the eye icons never shift when it appears.
3. **Settings for the selected mask type**, as fold-outs using the
   Film Look sub-section style (triangle, name, one-line summary on the
   right such as "Paint · 5% · feather 25%" or "Default"):
   - Brush: **Brush settings** (Paint / Erase switch, Size, Feather, Flow,
     Density; applies to new strokes) and **Mask settings** (Opacity,
     Shift edge, Feather; applies to all strokes).
   - Linear gradient: **Gradient settings** (current Gradient Controls).
   - Luma range: **Luma settings** (current Luma Controls).
   - Path: **Path settings** (current Path Controls).
   These start folded. The contents are today's controls; only the
   headings and grouping change.
4. **Folder tabs** for the local grade, the same component and the same
   shared lane as Global (with the Match button), holding the selected
   adjustment's grade for that lane: Light (open by default), Color, HSL,
   Detail as fold-outs, then Adjustment opacity. Fold-out state is
   session-only and never changes processing.

The current "Local Adjustment Controls" heading, the local HDR/SDR switch,
and the full-width Hide gizmo / Invert mask / Clear brush / Undo stroke
buttons go away (their actions move as described above).

#### New-adjustment button behaviour (note for Codex)

This replaces today's two flows ("pick a tool, then press +" and "press +,
then pick a tool" with a pending "Pick a tool" row). One rule each for
tools and rows:

| Action | Result |
|---|---|
| Click a tool (Brush, Linear gradient, Luma range, Path) | Always creates a new adjustment of that type, named the way the app names new adjustments today ("Local Adjustment N"), selects it, and makes that tool live on the image. The user can paint, drag or place points straight away. This holds **even when that tool is already lit**: clicking the lit Brush again starts another brush adjustment. |
| Click a row in the list | Selects that adjustment for editing and lights its tool. Never creates anything. |
| Tool tooltips | Say what a click does: "New brush adjustment", "New linear gradient adjustment", "New luma range adjustment", "New path adjustment". |
| Unused adjustment | An adjustment with no content yet (no brush strokes; gradient or path never placed; luma range never set) is "unused". Show it in the list in a muted style with "· unused" after its type. |
| Clicking another tool while the selected adjustment is unused | Converts that unused adjustment to the new type instead of adding a second row. |
| Selecting any other row, switching mode, or loading another photo while an adjustment is unused | Removes the unused adjustment. |
| Undo | Creating an adjustment and giving it content should not need two undos to remove; whatever the app's history does today for "+ then first stroke" is the baseline. An unused adjustment that gets removed automatically should not leave a history step behind. |
| Empty list text | "Choose a mask tool to start an adjustment." |
| Erase | Not a tool. Paint / Erase switch in Brush settings; Alt while painting erases, as today. |
| Duplicate | Unchanged: copies the selected adjustment's mask and grade. |
| Sub-masks | Unchanged: created through the row's ⋯ menu. |

Check the edge cases against the existing mask code (for example, a luma
range may count as "set" as soon as it is created with defaults). If a
rule above can't be met cleanly, or "unused" is hard to define for a type,
ask before choosing a different rule.

### Retouch mode

Replaces the "Retouch · Inpaint prototype" block (screenshot 06):

- **HDR + SDR · before crop** label.
- **Inpaint / Heal / Clone** segmented switch. Heal and Clone show a small
  "Soon" tag, can't be selected, and say "Not built yet" in their
  tooltip.
- **Size** (1–64 native px, as the prototype's range) and **Hardness**
  as real instrument sliders, not text boxes. The existing size clamping
  stays.
- **Advanced** fold-out (folded by default, summary "Default" or what
  changed): Search, Patch radius and Iterations as sliders with the
  prototype's current ranges, and Seed as a typed number. Helper line:
  "New settings apply to your next stroke. Select a repair and press Retry
  to redo it."
- **No "Apply settings" button.** Settings apply to the next stroke.
- **Repairs · N** list, newest first, using the same list component as
  Local: each completed repair as a row (name such as "Spot 3", its size,
  hide eye). The selected row also shows **Retry** (next seed, as the
  current Retry) and **Remove**. Selecting a row selects that repair as
  the prototype does today.
- While a repair is solving, a status row under the list shows progress
  (or "Repairing spot N…") and **Cancel**. Cancel is only shown then.
  Rejections and errors ("too large", "not enough source") appear in that
  same row.
- Tool behaviour, history, caching, Rematch-required signalling and
  processing are unchanged.

## Constraints

- **No processing changes.** Rendering, export, Proof, Match, mask maths,
  retouch solving and the processing order stay exactly as they are. No
  shader, tolerance, limit or budget changes.
- **No project or preset format changes.** Renames are display names only;
  keep internal keys and saved fields. Projects saved before this change
  open unchanged.
- **Session-only UI state.** Mode, lane, fold-outs and pinned-tab state
  follow the guideline: never restored from storage, never saved with a
  project.
- **Use existing tokens and components.** No new colours; the folder
  border uses the existing border token, the Rematch colour uses the
  attention token. Both light and dark (and Studio Gray) themes must look
  right.
- **Accessibility.** Mode switch and folder tabs are proper tab lists;
  disclosures keep `aria-expanded` and hidden content stays out of tab
  order; icon-only buttons have labels.
- **Out of scope:** Heal, Clone, the hue-selection mask, local-grade
  transfer between lanes, new local grade controls, and any change to
  the Library or the analysis dock.
- No migration or compatibility code (pre-1.0 rule in `AGENTS.md`).

## Documents to update

- `docs/design/HDR_Finisher_Design_Guidelines.md`: three Control Panel
  modes; folder tabs and the shared lane; triangles replacing the chevron
  for top-level groups; no section numbers; the Local new-adjustment
  rules; Retouch layout. Remove or rewrite rules these replace (for
  example the chevron and index rules under "Disclosure groups" and the
  group-index tokens).
- `docs/product/modules/grade.md`: record the decisions in its decision
  table and update the current state when built. Note that the full
  Retouch tool (Heal, Clone) remains open work.
- `docs/design/HDR_Finisher_Tooltip_Copy.md` if any tooltip text changes.

## Testing

Follow `AGENTS.md` ("How much to test"):

- Fast checks from `codebase`: `node --test tests/*.test.js` and
  `.venv/Scripts/python.exe -m pytest tests -q`.
- Several GPU/interaction drivers click controls that move or disappear
  (the + button, the Erase button, the local lane switch, the Inpaint
  text fields and Apply settings, the main lane switch). Update them to
  the new controls; do not keep the old controls alive for their sake.
  Drivers seen touching this area include `local-adjustments-interaction`,
  `local-adjustment-usability`, `local-design-qa`, `local-stack-sizing`,
  `brush-mask-interaction`, `gradient-mask-interaction`,
  `luma-mask-interaction`, `path-mask-interaction`,
  `mask-graph-interaction`, `retouch-interaction` and
  `sdr-match-gpu-interaction`; confirm the real list yourself.
- Run only the GPU drivers that cover what you changed, once per group of
  changes, one at a time with `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`.
- `tests/test_frontend_editor_layout_contract.py` pins CSS and markup
  text. Where an assertion breaks only because wording or structure
  changed on purpose, replace it with a check on the result where
  practical, as `AGENTS.md` "What tests should check" describes.
- Add checks for the new-adjustment rules: tool click creates and
  selects; clicking the lit tool creates another; switching tool while
  unused converts; selecting another row removes the unused one; row
  click never creates; the lane choice is shared between Global and Local.
- This is not a release point; no focused release check is needed.

## Suggested order

Small commits, each usable on its own:

1. Mode switch and moving existing blocks into Global / Local / Retouch.
2. Shared lane with folder tabs, the Match button, and removing the local
   lane switch.
3. Section numbers removed, triangles, renames.
4. Local: tool strip, list, settings fold-outs, new-adjustment rules,
   Erase switch, More menu.
5. Retouch panel.
6. Documents.

## Questions protocol

If anything here conflicts with the existing code (for example, how
history records adjustment creation, how "Rematch required" is exposed,
or how the viewer decides which tool owns a click), ask before
implementing. Don't invent new patterns, tokens or rules to work around a
conflict. When you report back, include a screenshot of each mode in the
real app (light theme, panel about 400 px wide) so Claude can do a design
pass.
