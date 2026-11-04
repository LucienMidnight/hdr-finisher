# HDR Finisher v1 Visual Refinement

Status: round 1 implemented November 4, 2026: three-theme palette, typography, materials, control skins, slider modifier markings and persistent accent picker. Control Panel layout and source rail structure remain deferred, as the round-1 brief directs.

Last updated: 2026-11-04

This spec records the v1 visual decisions: palette, type, materials, and every control's anatomy and states. Where it conflicts with [HDR_Finisher_Design_Guidelines.md](../HDR_Finisher_Design_Guidelines.md), this spec wins for v1, and the guideline sections listed under [Guideline changes](#guideline-changes) should be updated as the work lands.

Files beside this one:

- `tokens.json` — every token, all three themes, with usage notes (the design system's source of truth).
- `tokens.css` — the same tokens compiled to CSS custom properties and text-style classes.
- `components.css` — reference CSS for every component below (`hf-` classes), including the per-theme material gradients. Its `/_blob/…` icon URLs and the `fonts/…` paths in `tokens.css` point at the design system's copies; in the app, point them at `codebase/frontend/assets/`.

Live references (sign-in required):

- Design system: https://claude.ai/artifact/Ge2W6h5okrwYCrL6ynRgpX
- Interactive mockup with the option switcher: https://claude.ai/artifact/37y6f9KFmtnQi66G8Fh2fS

## Direction

A precise finishing instrument, in the spirit of a modern telephoto lens (Sony G Master, Sigma Contemporary): a matte barrel, a few sharp functional markings, one accent badge, controls that feel machined rather than shiny. Each slider is an artist's tool.

Decisions:

| Area | v1 decision | Replaces |
|---|---|---|
| Type | Afacad for all reading text, markings and numbers (tabular figures); IBM Plex Mono only for file names | Source Sans 3, Gabarito, Space Mono |
| Greys | True neutral (no blue or green cast) | Slightly cool/green-tinted greys |
| Accent | Burnt orange `#d0612a`, user-changeable in Settings | Electric ultraviolet `#9b7bff` |
| Buttons and toggles | Soft plate: convex plate, dark 1px edge, lit top edge, pressed-in selection | Metallic gradients with glow |
| Slider thumbs | Rectangular satin bar with cylinder shading, no index line | Five-band chrome bar |
| Fills | Rounded accent bar; square at a mid-rail home, with a zero line | Accent gradient with glow |
| Glows | None anywhere | Accent glows on buttons, fills, switches |
| Arrows | One chevron for every disclosure; triangles only as value markings | Filled triangles + Tabler chevrons + native arrows |
| Hidden modifiers | Ctrl and Shift states drawn; key legend in the status bar | Not shown |
| Control Panel | Sections + a pinned HDR/SDR switch below the shared controls | Nested folder tabs with Match SDR in the tab row |
| Warnings | Yellow `attention`; amber `headroom` is data only | Amber for both |
| Stars | Neutral | Yellow |

## Palette

Values per theme; `↑` means the theme inherits Default Dark. Full usage notes are in `tokens.json`.

### Surfaces

| Token | Dark | Light | Studio Gray | Use |
|---|---|---|---|---|
| `viewer` | `#080808` | `#dcdcdc` | `#383838` | Image surround and deepest window ground (the mat behind pixels). Default for frame-color. |
| `deep` | `#070707` | `#d6d6d6` | `#303030` | Channel floor: slider and segment recess, switch track when off. |
| `app` | `#0c0c0c` | `#eaeaea` | `#2e2e2e` | Ground between regions; page/body background. |
| `panel` | `#121212` | `#f1f1f1` | `#333333` | Rails, panel headers, collapsed group rows, library tiles. |
| `input` | `#151515` | `#f5f5f5` | `#353535` | Neutral interactive beds (list rows, preset rows). |
| `raised` | `#191919` | `#fafafa` | `#3a3a3a` | Open group wells, grouped tiles, selected-control surfaces, tile hover. |
| `border` | `#2a2a2a` | `#d4d4d4` | `#4d4d4d` | Visible raised-surface boundary; 3px external panel edges; card and popover outlines. |
| `hairline` | `rgba(255, 255, 255, 0.07)` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.09)` | Quiet 1px separators and inset rings between dense regions. |
| `tooltip` | `#161616` | `#fbfbfb` | `#3a3a3a` | Tooltip ground, with a 1px border and body ink. |

### Ink

| Token | Dark | Light | Studio Gray | Use |
|---|---|---|---|---|
| `text` | `#f2f2f2` | `#1c1c1c` | `#f2f2f2` | Values and primary titles on viewer, app, panel and raised (15.7:1+ dark, 14.2:1+ light, 10.2:1+ gray). |
| `body` | `#c8c8c8` | `#3c3c3c` | `#cfcfcf` | Control labels and ordinary copy on app, panel and raised (7.3:1 or better in every theme). |
| `muted` | `#949494` | `#6b6b6b` | `#a3a3a3` | Secondary information, inactive tabs, default slider values, section labels on app, panel and raised (5.8:1+ dark; 4.4:1 on light app and 4.5:1 on gray raised, both borderline). |
| `quiet` | `#6b6b6b` | `#8f8f8f` | `#7a7a7a` | Nonessential metadata, idle workflow step numbers, drag grips. FAILS 4.5:1 for text in every theme (about 3:1 to 3.7:1); never use for copy a person must read. |
| `error-text` | `#f2b5ac` | `#9a2f22` | `↑` | Error message copy inside status rows on panel. |
| `inverse` | `#0c0c0c` | `#f7f7f7` | `↑` | Text on bright fills: primary (ultraviolet) buttons and the amber Export run button. |

### Accent

| Token | Dark | Light | Studio Gray | Use |
|---|---|---|---|---|
| `accent` | `#d0612a` | `#a9471a` | `#e0763d` | Burnt orange, the default accent: focus ring, modified slider fill, selected tab underline, visible bypass eye, primary and Export buttons, ON switch marking. Keep it spatially small. 4.8:1 on dark panel; on Studio Gray it is 4.1:1, so small text there uses accent-strong. People can change it in Settings (see accent-preset-*). |
| `accent-strong` | `#e8834f` | `#8a3a14` | `#f09a6a` | Lighter accent for text and icons that must read: selected segment and tool ink, Mod tags, the FINE tag, rendition section labels (6.9:1 dark; darker #8a3a14 on light, 6.9:1; 5.7:1 gray). |
| `accent-low` | `#a8481a` | `#c25a26` | `#b85a28` | Lower edge of accent gradients (fills, primary button). |
| `accent-bed` | `#2a170e` | `#f0ddd2` | `#3d2a20` | Tinted seat beneath a selected Library row or tile and behind Mod tags. |
| `on-accent` | `#140904` | `#ffffff` | `#140904` | Ink on a solid accent fill: primary and Export button labels (5.1:1 dark, 5.8:1 light in white, 6.4:1 gray). |

### Accent presets (Settings)

| Token | Dark | Light | Studio Gray | Use |
|---|---|---|---|---|
| `accent-preset-burnt-orange` | `#d0612a` | `↑` | `↑` | Settings swatch: the default accent. |
| `accent-preset-blue-gray` | `#566481` | `↑` | `↑` | Settings swatch: the understated accent. Only 3.2:1 on the dark panel, so text in this mode uses a 28% lighter mix (#8d9ab3, 6.6:1); its on-accent ink is white. |
| `accent-preset-coating-blue` | `#38a3dc` | `↑` | `↑` | Settings swatch: a cooler accent, kept apart from the scope blue channel by its cyan lean. |

### Status

| Token | Dark | Light | Studio Gray | Use |
|---|---|---|---|---|
| `ready` | `#8cbf9a` | `↑` | `↑` | Successful readiness. Pair with a word or icon. Constant across themes: only 1.9:1 on the light panel, so on light use it as a mark, not text. |
| `attention` | `#f0c53a` | `#735600` | `↑` | Warnings that need review: status-bar warning text and rules, Rematch SDR. Yellow, so it reads apart from the burnt-orange accent (11.4:1 on dark panel; Default Light uses a darker #735600, 5.9:1). |
| `blocking` | `#d4796b` | `↑` | `↑` | Errors and blocking state: status-row left rule. Pair with error-text copy. |
| `headroom` | `#ffb020` | `↑` | `↑` | HDR headroom as data (scopes, peak readouts). No longer a UI warning or the Export button colour, so it never sits next to the orange accent as chrome. |
| `success` | `#62b78f` | `↑` | `↑` | Success status-row rule. Used in code only as a fallback value (var(--success, #62b78f)); not declared in :root. |

### Marks

| Token | Dark | Light | Studio Gray | Use |
|---|---|---|---|---|
| `star` | `#e8e8e8` | `#1c1c1c` | `#f2f2f2` | Library star ratings: neutral, so they never compete with the orange accent or the yellow warning. Marks sit beneath a photo, never on it. |
| `label-red` | `#e5484d` | `↑` | `↑` | Red colour label dot (9px) in Library marks and the label picker. |
| `label-orange` | `#f2994a` | `↑` | `↑` | Orange colour label dot. |
| `label-green` | `#3fb96b` | `↑` | `↑` | Green colour label dot. |
| `label-blue` | `#4d9cff` | `↑` | `↑` | Blue colour label dot. |

Data colours (`scope-*`, `curve-*`, `exposure-band-*`, `equalizer-*`) are unchanged from the shipped app apart from the neutral grey surfaces they sit on; see `tokens.json`.

## Typography

Afacad is variable (400 to 700) and has tabular figures (`tnum`). Bundle the full family from github.com/Dicotype/Afacad (OFL); the design system carries only the Latin subsets. IBM Plex Mono Regular and Medium are already in `codebase/frontend/assets/fonts/ibm-plex-mono/`.

| Style | Font | Size | Weight | Tracking | Case | Use |
|---|---|---|---|---|---|---|
| `panel-title` | Afacad | 12px | 600 | 0.11em | Upper | Panel and region titles (CONTROL PANEL, METADATA, PREVIEW). Uppercase, ink text. |
| `section-label` | Afacad | 11px | 600 | 0.11em | Upper | Section kickers inside panels (BOTH RENDITIONS, PER RENDITION, NEW ADJUSTMENT, field labels). Uppercase, ink quiet or muted. |
| `spec-label` | Afacad | 11px | 600 | 0.11em | Upper | Labels in the spec plate (BODY, FOCAL, EXP, ISO) and the key legend. Uppercase, ink muted. |
| `tag` | Afacad | 10px | 600 | 0.12em | Upper | Small boxed state tags (FINE, SNAP) and the ON/OFF marking in a switch. Uppercase. |
| `scale-label` | Afacad | 9px | 500 | 0 | Sentence | Snap-point labels under a slider rail. Tabular numbers, ink muted. |
| `body` | Afacad | 14.5px | 400 | 0 | Sentence | Base UI text, menus, explanations, helper and empty-state copy. |
| `group-name` | Afacad | 14.5px | 500 | 0 | Sentence | Control-group names in sentence case (Tone, Exposure bands). Ink text. |
| `workflow-tab` | Afacad | 14.5px | 500 | 0 | Sentence | Top workflow tabs (Library, Grade, Proof, Export). |
| `tab` | Afacad | 14px | 500 | 0 | Sentence | Global / Local / Retouch text tabs. |
| `button` | Afacad | 14.5px | 600 | 0 | Sentence | Primary and Export button labels; secondary buttons use weight 500. |
| `control-label` | Afacad | 13.5px | 400 | 0 | Sentence | Instrument slider names, left of the value. Ink body. |
| `segment` | Afacad | 13.5px | 500 | 0 | Sentence | HDR grade / SDR grade and other segment items. |
| `caption` | Afacad | 13px / 1.45 | 400 | 0 | Sentence | Status bar, secondary rows, Settings notes, Revert / Copy path. |
| `toolbar` | Afacad | 13px | 400 | 0 | Sentence | Viewer toolbar labels (Fit, 1:1, Overlays). |
| `value` | Afacad | 13px | 500 | 0 | Sentence | Slider values, units and numeric readouts, always with tabular figures (font-variant-numeric: tabular-nums). Ink muted at default, text when modified. |
| `spec-value` | Afacad | 13px | 500 | 0 | Sentence | Spec plate values (NIKON D200, 55 mm, f/8 · 1/320 s). Tabular, ink body. |
| `step-index` | Afacad | 11.5px | 500 | 0 | Sentence | Workflow step numbers (01 to 04). Tabular; accent when active, quiet otherwise. |
| `filename` | IBM Plex Mono | 10.5px / 16px | 400 | 0 | Sentence | Library tile file names and paths only. Ink muted. |
| `status-mono` | IBM Plex Mono | 10.5px | 400 | 0 | Sentence | Character-aligned readouts (hashes, copy suffixes). |

Rules: values are never set in a monospace face; every number that can change uses `font-variant-numeric: tabular-nums`; uppercase is only for markings, never for group names, tabs or buttons.

## Spacing, sizes and radii

| Token | Value | Use |
|---|---|---|
| `rail-w` | 232px | Source (Metadata) rail default width: identity, spec plate, two disclosures, preview facts. |
| `grade-w` | 320px | Control Panel default width. |
| `dock-h` | 252px | Analysis dock (Scopes) default height. |
| `splitter-size` | 7px | Draggable splitter between regions. |
| `top-h` | 44px | Top bar and workflow-tab height. |
| `window-chrome-h` | 30px | Desktop window chrome (menu bar) height. |
| `panel-header-h` | 40px | Panel header row (CONTROL PANEL, METADATA, the viewer toolbar). |
| `status-bar-h` | 28px | Bottom status bar: messages left, key legend right. |
| `tab-row-h` | 34px | Global / Local / Retouch text-tab row. |
| `library-row-h` | 24px | Library sidebar rows (folders, albums). |
| `disclosure-h` | 34px | Source-rail disclosures (Source interpretation, Full metadata). |
| `control-row-h` | 34px | Standard control row. |
| `control-group-header-h` | 34px | Every Control Panel group header. |
| `instrument-control-row-min-h` | 53px | Instrument slider row: 16px heading, 22px rail, 11px scale band, 4px padding. |
| `instrument-scale-h` | 11px | Band under every rail for the home index, snap ticks and fine scale. |
| `instrument-control-heading-min-h` | 16px | Label/value heading row of an instrument slider. |
| `instrument-control-heading-gap` | 8px | Gap between slider label and value. |
| `instrument-control-stack-gap` | 2px | Gap between heading and slider rail. |
| `instrument-slider-hit-h` | 22px | Slider interaction height. |
| `instrument-slider-track-top` | 5px | Track inset from the top of the hit area. |
| `instrument-slider-track-h` | 12px | Slider channel height. The fill sits inset 2px top and bottom (8px tall). |
| `instrument-slider-thumb-w` | 9px | Bar thumb width (hover does not change it). |
| `instrument-slider-thumb-h` | 20px | Bar thumb height. Corners radius-1. |
| `instrument-compact-slider-track-h` | 7px | Compact child-rail channel height (inside slider-group tiles only). |
| `instrument-compact-slider-thumb-w` | 7px | Compact thumb width. |
| `instrument-compact-slider-thumb-h` | 15px | Compact thumb height. |
| `local-control-inset` | 12px | Side inset of Local panel controls. |
| `workspace-leading` | 12px | Leading inset of workspace headers. |
| `chevron-size` | 14px | The one chevron, drawn at a 1.5px stroke; rotated for every direction. |
| `group-disclosure-gap` | 8px | Gap between the chevron and a group name. |
| `panel-collapse-button-size` | 24px | Panel collapse button (26 x 24 in Soft plate). |
| `bypass-icon-size` | 17px | Bypass eye glyph size inside its 26px target. |
| `panel-border-external-width` | 3px | Expanded top-level panel top/bottom boundary. |
| `panel-border-internal-width` | 1px | Internal boundaries and collapsed-group separators. |
| `radius-1` | 3px | Slider thumbs, Mod tags, spec plate, selects, tiles. |
| `radius-plate` | 5px | Soft plate buttons, joined button groups, tool buttons, empty-state wells. |
| `radius-2` | 6px | Popovers (Settings). |
| `radius-pill` | 999px | Slider rails and fills, switch tracks. |

## Shadows

| Token | Dark | Use |
|---|---|---|
| `depth-channel` | `inset 0 2.5px 3px rgba(0, 0, 0, 0.98), inset 0 -1.5px 0 rgba(255, 255, 255, 0.11)` | Recessed channel: segment switch outer well. |
| `depth-raised` | `inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 6px 16px -6px rgba(0, 0, 0, 0.9)` | Raised plate. |
| `instrument-slider-channel-shadow` | `inset 0 2.5px 3px rgba(0, 0, 0, 0.98), inset 0 -1.5px 0 rgba(255, 255, 255, 0.11), 0 1px 0 rgba(255, 255, 255, 0.025)` | Slider and switch rail recess. |
| `instrument-slider-thumb-shadow` | `0 2px 5px rgba(0, 0, 0, 0.6), inset 0 -1px 1px rgba(0, 0, 0, 0.12)` | Slider bar thumb. |
| `instrument-slider-thumb-focus-shadow` | `0 0 0 2px rgba(235, 238, 237, 0.2), 0 0 8px rgba(235, 238, 237, 0.3), 0 1px 2px rgba(0, 0, 0, 0.92)` | Neutral glow on a focused or dragged thumb (never ultraviolet). The light theme's value uses color-mix() of the accent and is declared in bundle.css. |
| `segment-selected-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 2px 5px rgba(0, 0, 0, 0.5)` | Selected inner plate of a segment switch. |
| `panel-collapse-button-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.09), 0 2px 5px rgba(0, 0, 0, 0.38)` | Lit top edge and soft lower shadow of neutral buttons, tool chips and the 28px collapse button. |
| `plate-lift` | `inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 0 rgba(255, 255, 255, 0.035), 0 2px 3px rgba(0, 0, 0, 0.5)` | Soft plate at rest: lit top edge, faint lower lip, short contact shadow. Buttons, tool buttons, switch knob, joined groups. |
| `plate-press` | `inset 0 1px 3px rgba(0, 0, 0, 0.75), inset 0 0 0 1px rgba(0, 0, 0, 0.25), 0 1px 0 rgba(255, 255, 255, 0.04)` | Soft plate pressed in: the selected segment, toolbar choice or tool, and any button while held. |
| `switch-track-shadow` | `inset 0 1px 3px rgba(0, 0, 0, 0.85), 0 1px 0 rgba(255, 255, 255, 0.05)` | Recessed switch track, the same in both states. |
| `thumb-shadow` | `inset 0 1px 0 rgba(255, 255, 255, 0.75), 0 1px 2px rgba(0, 0, 0, 0.7), 0 0 0 0.5px rgba(0, 0, 0, 0.6)` | Satin slider thumb: lit top edge, contact shadow, hairline outline. |
| `popover-shadow` | `0 12px 28px rgba(0, 0, 0, 0.52)` | Library popover menus. |
| `tooltip-shadow` | `0 8px 24px rgba(0, 0, 0, 0.35)` | Tooltips. |

## Materials

Three materials, and nothing glows.

**Soft plate** — everything you press: buttons, button groups, tool buttons, selects, the switch knob, the collapse button.

| Part | Dark | Light | Studio Gray |
|---|---|---|---|
| Face at rest `--plate-up` | `#282828 → #1e1e1e` | `#ffffff → #f0f0f0` | `#484848 → #3c3c3c` |
| Face on hover `--plate-up-hover` | `#2d2d2d → #222222` | `#ffffff → #f6f6f6` | `#4e4e4e → #414141` |
| Face pressed / selected `--plate-down` | `#121212 → #181818` | `#e3e3e3 → #ebebeb` | `#2a2a2a → #313131` |
| Edge `--plate-edge` (1px) | `#050505` | `#c2c2c2` | `#1c1c1c` |
| Shadow at rest | `plate-lift` | `plate-lift` | `plate-lift` |
| Shadow pressed | `plate-press` | `plate-press` | `plate-press` |

Gradients run top to bottom. Corners `radius-plate` (5px). Pressed or selected, the plate sinks in and its ink becomes `accent-strong`.

**Recess** — everything that holds a value: slider rails, the switch track, the spec plate, empty-state wells. Rail face `--rail-face` (dark: `#050505 → #161616`), `--rail-shadow` (dark: `inset 0 1.5px 2px rgba(0,0,0,.85), inset 0 -1px 0 rgba(255,255,255,.07)`).

**Satin** — slider thumbs only. A vertical face (dark theme `#f4f4f4 → #c4c4c4`; light theme `#6b6b6b → #3f3f3f`) under a horizontal cylinder shade (`rgba(0,0,0,.22)` at the left edge, clear at 38%, a `rgba(255,255,255,.18)` highlight at 50%, clear at 62%, `rgba(0,0,0,.26)` at the right edge), plus `thumb-shadow`.

## Controls

### Buttons

| Variant | Size | Face | Ink | Notes |
|---|---|---|---|---|
| Secondary | 30px tall, 14px side padding | Soft plate | `body`, 14.5px 500 | Hover brightens; pressed sinks in |
| Primary | 30px | Accent plate: `accent` mixed 14% toward white at the top to 10% toward black at the bottom; edge `accent` mixed 55% toward black; lit top edge `rgba(255,255,255,.3)` | `on-accent`, 14.5px 600 | One per region. No glow |
| Export | Full width, 34px | Primary | `on-accent` | The Export run button is the primary button, in the accent |
| Small | 24px, 10px padding | Secondary | 13px | In-row actions: Match SDR, Rematch SDR, Pick / Reject / Clear |
| Text | — | None | `muted` → `text` on hover, 13px | Revert, Copy path, Reset |

### Button groups (toolbars)

Related choices join into one plate: a 1px `--plate-edge` border, the edge colour showing through 1px gaps as dividers, 24px items with 8px padding. The selected item is pressed in with `accent-strong` ink. The viewer toolbar has three groups:

1. **Layout**: Single, Side by side, Over and under (14px stroke icons).
2. **Zoom**: −, a small rail with a satin thumb, the zoom value (tabular), +, Fit, 1:1.
3. **View**: Overlays, Frame, Background.

### Segment switch (HDR / SDR)

A full-width button group whose two items flex equally, 28px tall, 13.5px 500. In the Control Panel the items read `HDR grade` and `SDR grade`, each followed by a 5px accent dot when that rendition has edits.

### Tool buttons (mask and repair tools)

Separate 40 × 34px soft plates, 6px apart, with 19px Tabler icons at a 1.6px stroke. The active tool is pressed in with `accent-strong` ink. Local: brush, linear gradient (`square-half`), luma range (`brightness-half`), path (`pencil`). Retouch: inpaint (`brush`), erase (`eraser`).

### Switch

| Part | Spec |
|---|---|
| Track | 50 × 22px pill, 1px `--plate-edge`, `--switch-track` face (dark `#0a0a0a → #141414`), `switch-track-shadow`; identical in both states |
| Knob | 22px disc in the button material (`--knob-face`, dark `#343434 → #232323`; `--knob-lift`), 1px edge; slides 28px in 140ms `cubic-bezier(.2,.75,.3,1)` |
| Marking | `ON` / `OFF` in the `tag` style on the side away from the knob: `OFF` in `muted`, `ON` in `accent-strong` |
| Row | 10 × 12px padding, 1px `border`, `radius-1`, `panel`; the whole row toggles |

State is carried by knob position and the marking, never by filling the track with colour.

### Instrument slider

| Part | Spec |
|---|---|
| Row | 16px heading + 22px rail + 11px scale band (53px with padding) |
| Name | `control-label` (13.5px, `body`), left |
| Value | `value` (13px 500, tabular, with unit), right; `muted` at default, `text` when modified; on hover a hairline `border` box shows it is editable |
| Rail | 12px borderless pill at 5px from the top, `--rail-face`, `--rail-shadow` |
| Fill | Inset 2px (8px tall). At default: translucent neutral. Modified: `accent` mixed 38% toward white at the top, `accent` at 42%, `accent` mixed 22% toward black at the bottom, with `inset 0 1px 0 rgba(255,255,255,.28), inset 0 -1px 0 rgba(0,0,0,.25)` |
| Fill ends | From the rail end: rounded both ends. From a mid-rail home: **square at home, rounded at the thumb** |
| Zero line | Mid-rail-home sliders only: a 1px neutral line inside the rail at home, `rgba(200,200,200,.32)` at rest, `.55` when modified |
| Thumb | 9 × 20px satin bar, `radius-1`; never resizes on hover; no index line |
| Home index | Once moved, a 7 × 5px triangle in `muted` in the scale band at home |
| Colour rails | Temperature (`#526fbd → #8db5df → #e8edf0 → #efc781 → #cf7133`) and Tint (`#b45aa8 → #e4e4e4 → #5aa76a`) keep their spectrum under a chamfer layer and an inset keyline; no fill, no zero line |

**Modifier states.** Both appear while the pointer is over the slider and the key is held, and go away when either ends.

| Key | What appears |
|---|---|
| Ctrl (fine) | A boxed `FINE` tag (accent edge, `accent-strong` text) before the value; one extra decimal (`+0.35 EV` → `+0.352 EV`); a fixed fine scale in the scale band: 41 ticks across the full rail (every 2.5%), 2.5px tall at 55% opacity, every fourth 4.5px at 85%, the home tick 6px in `body`. The scale does not move with the thumb. |
| Shift (snap) | A boxed `SNAP` tag; the legal landing positions as 4px ticks with 9px tabular labels (home 6px in `body`); the thumb lands on them with an 80ms step |

**Key legend.** While any slider is hovered, the status bar shows `CTRL fine · SHIFT snap · DOUBLE-CLICK reset · CLICK VALUE to type` in the marking style (keys in `body`, actions in `muted`); otherwise it dims to 45%.

### Select

A native select on a soft plate, 30px, `appearance: none`, with the shared 14px chevron turned down, 9px from the right, in `muted`. The field label above uses `section-label`.

### Chevrons and triangles

**Arrows move, triangles mark.**

- One chevron (14px, 1.5px stroke, round caps), rotated: right = closed, down = open, left / up = collapse a panel. Used for group headers, source-rail disclosures, the Library tree, collapse buttons and selects. Rotation 120ms.
- The small filled triangle only points at a value: a slider's home, the reference-white point on a graph. It never opens anything.

### Control group

| Part | Spec |
|---|---|
| Header | 34px; chevron (`muted`), name in `group-name` (14.5px 500, sentence case), Mod tag, preset icon, Reset, bypass eye |
| Mod tag | `2 Mod` / `Mod`, 10px tabular, `accent-strong` on `accent-bed`, 2px corners |
| Preset | 15px sliders icon; shown only on header hover, focus, or when the group is open |
| Reset | 13px text button; only when modified |
| Bypass | 26px target, 17px eye in `accent`; bypassed it is `quiet` with a diagonal strike and the body fades to 0.35 |
| Open | 1px `accent` top line, `raised` ground, body padding 4px 14px 12px |

## Layout

### Top bar (44px)

Logo at left (22px tall, inverted on dark themes); the four numbered workflow tabs centred (Afacad 14.5px 500, step numbers 11.5px tabular, accent number and 2px underline on the current step); at right `Autosave on`, `Recent projects`, `Settings`.

### Source rail (232px)

1. Panel header `METADATA` with a collapse button.
2. Identity: the file name **once**, then `All changes saved · Revert · Copy path`.
3. Spec plate: a recessed well with `BODY`, `FOCAL`, `EXP`, `ISO`, `FILE` labels and tabular values.
4. Disclosures: Source interpretation, Full metadata.
5. Preview facts: Peak (preview), P95, Median.

### Viewer

A 40px toolbar (`PREVIEW` plus the current rendition, `HDR` / `SDR` / `HDR + SDR`, in `accent-strong`, then the three button groups), the image, and a 28px status bar. Status messages live in the status bar, never in a band above the image.

### Control Panel (320px)

```
CONTROL PANEL                              3 Mod
Global   Local   Retouch
BOTH RENDITIONS
 › Raw development                           ◉
 › Highlight reconstruction                  ◉
 › Crop & rotate                             ◉
 › Perspective                               ◉
┌ PER RENDITION ─────────────── (pinned) ┐
│ [ HDR grade • ][ SDR grade • ]          │
└─────────────────────────────────────────┘
 (SDR only) Start the SDR grade from your HDR grade.  [Match SDR]
 ⌄ Tone  2 Mod                 ≡  Reset  ◉
   sliders…
 › Exposure bands … › Vignette
```

- The rendition switch sits **below** the controls shared by both renditions and stays pinned at the top of the scroll area once reached. It never goes in the header.
- The match row appears only while SDR grade is selected: a recessed well with one sentence and `Match SDR`. When the SDR grade is older than the HDR grade it takes a 3px `attention` rule and reads `Rematch SDR`.
- **Local:** `NEW ADJUSTMENT` + the four tool buttons; `MASKS` with `HDR + SDR` at right and the list or the empty well ("Choose a mask tool to start an adjustment."); then the same pinned rendition switch over the selected mask's grade.
- **Retouch:** no rendition switch. A note "Repairs apply to both renditions, before crop.", then `REPAIR TOOL` + tool buttons and the `REPAIRS` list.
- No folder tabs and no box around the grade.

### Library sidebar

Section heads 30px (`FOLDERS`, `ALBUMS`, `SMART ALBUMS`, marking style, `+` at right); rows 24px with a 12px chevron, 14px name, tabular count at right (including `0`), and a drag grip only on hover. The current row: `accent-bed` with a 2px inset accent rule. 6px between sections.

## Settings › Appearance: accent colour

A 300px popover from **Settings** in the top bar.

- Label `ACCENT COLOUR`, then four swatches: **Burnt orange** (default, `#d0612a`), **Blue-gray** (`#566481`), **Coating blue** (`#38a3dc`), **Custom** (a hue-wheel chip over a native colour input). The selected swatch has a `text` ring with a `panel` gap.
- Note: "Used for focus, selection and changed values. Warnings, marks and scope colours stay the same."
- From one chosen colour `A`: `accent` = A; `accent-strong` = A mixed 28% toward white; `accent-low` = A mixed 18% toward black; `accent-bed` = A mixed 84% toward the panel colour; `on-accent` = near-black (`#120c08`) when A's relative luminance is above 0.18, otherwise white.
- Text in accent always uses `accent-strong`, because a muted accent (Blue-gray is 3.2:1 on the dark panel) can fall below 4.5:1.
- The accent never changes `attention`, `blocking`, marks, scope, curve or exposure-band colours.
- The choice persists across launches. This is an explicit exception to the session-only rule and needs a product decision recorded in the guidelines.

## Motion

| What | Duration | Easing |
|---|---|---|
| Chevron rotation, preset icon fade | 120ms | ease |
| Switch knob | 140ms | `cubic-bezier(.2, .75, .3, 1)` |
| Slider snap step (Shift) | 80ms | ease-out, no overshoot |
| Key legend dim / show | 120ms | ease |

## Accessibility

- Focus: 2px solid `accent` outline, offset 2px, on every control.
- Ink pairs meet 4.5:1 on their surfaces in every theme, with two exceptions: `quiet` (about 3.5:1, nonessential marks only) and `muted` on the Default Light `app` ground (4.4:1, borderline; prefer `panel` behind muted text there). The light theme uses darker accent (`#a9471a`, strong `#8a3a14`) and warning (`#735600`) shades for this.
- State never relies on colour alone: `Mod` is a word, switches carry `ON` / `OFF`, warnings name their fix, colour labels pair with names.
- Every icon-only button has an accessible name; segments use `role="tab"` + `aria-selected` or `aria-pressed`; disclosures carry `aria-expanded`.

## Guideline changes

When this lands, update these sections of `HDR_Finisher_Design_Guidelines.md`:

- **Color system**: replace the ultraviolet accent rows with the burnt-orange ramp and presets; true-neutral surface values; `attention` becomes yellow `#f0c53a` and `headroom` becomes data only; `star` becomes neutral.
- **Typography and copy**: Afacad replaces Source Sans 3 and Gabarito; IBM Plex Mono replaces Space Mono and is limited to file names; numbers use tabular Afacad.
- **Panel title / group title tokens**: panel titles 12px 600 at 0.11em uppercase; group names become sentence case 14.5px 500 (no longer uppercase).
- **Disclosure groups**: chevrons replace the "small filled triangle"; triangles are reserved for value markings.
- **Controls and feedback**: rails may now carry one mark, the 1px zero line at a mid-rail home; the fill is square at home; Ctrl and Shift states, the home index and the key legend are drawn.
- **Toggle and segmented controls**: switches become a recessed track with a soft plate knob and an ON / OFF marking (no accent-filled track, no rendered knob image); segments and toolbar groups become joined soft plates with pressed-in selection; primary actions lose their glow.
- **Control Panel chassis**: folder tabs are replaced by the section layout and the pinned `HDR grade | SDR grade` switch below the shared controls; Match SDR moves into the SDR grade.
- **Startup and persistence**: the accent colour is the one persistent preference.
- **Spacing and geometry**: source rail 232px, Control Panel 320px, top bar 44px, panel headers 40px, group headers 34px, Library rows 24px.


## Round 1 implementation and tidy-up

The app uses the approved palette/material tokens through `frontend/visual-tokens.css`, with control skins in `visual-controls.css`. All Afacad static and variable normal/italic files and the original OFL are bundled. Theme previews were regenerated from real Electron Grade captures. The accent is a new application preference, not a grade or project property; presets and custom colour survive reload and synchronize to Library. Missing/invalid values fall back to orange, with no old-preference migration.

Steve's November 4 clarification accepts that every theme need not meet WCAG. The literal selected-colour ramp formulas therefore apply in Light as well as Dark/Gray, instead of substituting the spec's separately darker Light accent ramp. Required copy uses muted/body/text. This is a recorded product choice, not a completed contrast certification.

### Tidy-up list for later rounds

| Location | Round-1 result | What the reference leaves unclear / deferred work |
|---|---|---|
| Settings > Appearance | Existing Settings dialog, three theme previews and a 300px four-swatch accent block; Custom opens the native colour chooser | The reference's standalone 300px Settings popover cannot replace the existing multi-page settings flow within an appearance-only pass. |
| Settings other pages; Help/About, Updates and Diagnostics | Neutral theme surfaces, Afacad, shared control materials and ink | No page-specific compositions or spacing examples were supplied. Existing layouts remain. |
| Recent projects and common confirmation/name dialogs | Token colours, shared soft plate actions, existing geometry | No reference for these dialogs or destructive-action hierarchy. |
| Adjustment Presets dialog | Token surfaces and type; group-header Preset becomes a small icon with the same accessible name | Library/search/save/rename rows have no v1 composition. Existing layout retained. |
| Open/save directory browser and standalone media browser | Tokenized frame, checkerboard, text, inputs and actions | Columns, preview sizing, file facts and native dialog integration are outside the mockup. |
| Browser launcher; custom and native window menus | Neutral web launcher and Afacad; web menu styling follows theme | Native Windows title/menu chrome and native colour/file choosers remain OS-controlled. Launcher retains its page layout. |
| Metadata/source rail | 232px starting width and updated typography/materials | Identity block and spec-plate restructure explicitly deferred. Existing source list, interpretation and metadata disclosures retained. |
| Grade Control Panel, HDR/SDR folders and Match SDR | Current section/folder structure restyled; 34px group headers, sentence-case names, Mod, contextual reset/preset, bypass eye and accent open rule | Section layout, pinned rendition switch and Match SDR relocation explicitly deferred. No processing coupling changed. |
| Local tools and mask stack | Shared soft plates and updated ink; existing five tool choices, list and settings | Mockup shows four tools; the current Hue mask is retained. Tool/list/More layouts are unchanged. |
| Retouch | Existing repair tools, sliders and list restyled | Native-image stroke/donor overlays retain semantic colours; no detailed v1 repair-list/solver reference. Heal/Clone remain disabled. |
| Parent/child targeting, Film Look, HSL, color wheels and luma ranges | Shared token skins on their current dense/grouped structures; colour diagrams retain semantic colour | Mockup does not define each specialized editor, nested row or dual-handle range. Existing layout and interactions remain. Spectrum rails retain colour without an opaque neutral face covering it; recessed shadow supplies depth. |
| Viewer overlays, Frame and Background popovers; technical/scopes readouts | Token surfaces/type, joined toolbar plates and existing content | No detailed framing/overlay/readout layout provided. Explicit image surround/frame choices remain separate from application theme. |
| Status bar | 28px lower viewer dock with existing message/actions and hover key legend | Several simultaneous warnings/actions can compete for space; existing message queue/overflow is retained. |
| Library navigation, albums/smart albums, filters, compare/single/fullscreen and details | Token palette, 24px folder rows, 30px headings, neutral stars, existing layouts | Screenshot reference covers the sidebar only. Other Library workflows use nearest existing surfaces and keep their structure. |
| Export batch queue and format/metadata options | Existing queue/sidebar restyled; Export follows selected accent, never warning yellow | Reference supplies the button treatment, not the batch screen. Review captures show the empty queue; no export or delivered Proof was generated. |
| Compact workspace | Existing responsive/collapse rules retained, shared token sizes applied | This pass reviewed the requested 2560×1440 desktop captures; compact arrangements need a later visual pass alongside the structural work. |

### Fixed colours retained deliberately

- Scope RGB/composite traces, curve channels, exposure-band/equalizer colours and neutral curve reference colours retain their tokenized data meanings.
- The cyan highlight-compression transfer trace (`#68d7ed`) is unchanged data; graph ground/grid/label chrome now reads theme ink and surfaces.
- CSS RGB hue/purity rails, Kelvin and magenta/green tint spectra, grading-wheel hue sectors and neutral desaturation centres stay fixed to communicate colour coordinates. They are independent of application accent.
- HSL band colours and luma visualizations, false-colour/zebra overlays, mask/path/retouch stroke, donor, cursor and erase colours retain their semantic image-overlay roles. User-selected mask overlay, viewer surround and photo frame/border colours are content choices, not theme chrome.
- Label colours are the spec's independent mark tokens. Stars are neutral. Warnings and readiness use their own theme status tokens.

### Conflicts and review limits

The existing Settings dialog and current Control Panel/source structures were preserved under the brief's explicit exclusions. Session layout defaults are now 232px source / 320px Grade; Grade's minimum and accessible resize metadata agree at 320px. The preset icon keeps its original accessible name. The old PNG switch knob and old font assets remain in the repository but are no longer loaded by the interface. Select chevron URL generation is asset plumbing, not a new semantic colour token.

Real Electron review at 2560×1440: Library; Global/Local/Retouch; Proof; Export; all three accent presets in Settings; Ctrl FINE (41 ticks) and Shift SNAP (legal labelled ticks), in every theme. Custom accent persistence was checked after reload in main and embedded Library. Captures and `review.json` are in `codebase/output/v1-visual-refinement/`; small generated Library sources are reused from `codebase/output/test-photos/v1-visual-sources/`. Theme previews are derived from these Grade captures. These are visual checks, not processing/output certification.

Checks: 800 Node tests pass; the full Python run had 3,043 passed / 3 skipped, eight obsolete appearance-source failures (updated as intended; all 42 tests in those files subsequently pass), and one unrelated Library cached-scene failure (expected 422, got 200). The default 90-second Library check completed without picture errors or a memory-limit violation, but reported one 1.682-second frame pause (outside its responsiveness target). This unrelated timing warning was recorded without a performance investigation or repeat run. No long numerical GPU drivers or release sweep were run; rendering/encoding code is untouched.
