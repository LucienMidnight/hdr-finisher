# HDR Finisher Design Guidelines

Status: living guideline for the shipped application

Last updated: 2026-08-13

This guideline is authoritative for current UI behavior and supersedes persistence language in older product and sprint documents.

## Product character

HDR Finisher should feel like a precise finishing instrument: quiet, dense, predictable, and subordinate to the image. The interface is dark because it surrounds color-critical work, not because decoration is a goal. Controls should communicate their state without competing with the preview.

Use these principles when changing the interface:

1. Start neutral. Opening the app must never imply that an old grade or preference is active.
2. Reveal complexity progressively. Keep the workspace scannable, then expose detail on request.
3. Prefer explicit state over clever shorthand. A label should be understandable without prior knowledge.
4. Preserve the image as the visual priority. Chrome, motion, and accent color stay restrained.
5. Make preview behavior and export behavior distinguishable. Never imply that a display preview proves the exported file.

## Startup and persistence

Every application load begins from the canonical defaults.

- Do not restore adjustments, proof options, comparison layout, preview-quality mode, scope range, rail visibility, rail sizes, dock size, dock tab, or dock visibility from browser storage.
- All grade control groups begin collapsed. This includes HDR, SDR, Curves, and Film Look groups.
- Source Interpretation and Metadata disclosures begin collapsed.
- The source rail begins visible, the analysis dock begins open on Histogram, and the comparison viewer begins in Single view.
- High-res Preview begins off; the scope range begins at 4,000 nits.
- Chromium Proof begins at JPEG Ultra HDR, Auto target, and visible proof watermark.
- User choices remain active for the current page session only. Reloading or restarting returns to defaults.
- Exports and deliberately recorded proof evidence are durable artifacts; transient interface preferences are not.

When adding a new preference, default to session-only behavior. Persistent state requires an explicit product decision and documentation update.

## Information hierarchy

The workspace has four stable regions:

- Source rail: source identity, interpretation, metadata, and preview facts.
- Viewer: the image, comparison modes, zoom, and preview-only overlays.
- Grade rail: HDR and SDR authoring controls.
- Analysis dock: scopes and technical inspection.

Keep source facts separate from grade decisions, grade decisions separate from viewer tools, and viewer tools separate from export confirmation.

## Disclosure groups

- Use a right-pointing caret for collapsed groups and rotate it 90 degrees when expanded.
- Use the shared Fluent disclosure chevron at 18 px with semibold visual weight. Do not substitute a small text caret; the glyph should remain clearly visible without dominating its label inside the 38 px header target.
- Expanded top-level bodies run full bleed across the Control Panel. Use the shared 1 px hairline/ultraviolet open-section cue and internal separators; do not wrap expanded bodies in rounded tiles or heavy neutral bands. Reserve the raised bordered tile for honest parent/sub-control groups.
- The whole labeled header is the disclosure target; Reset and bypass remain separate targets.
- New grade groups start collapsed unless a documented workflow requirement says otherwise.
- A group body opens directly below its header and must not shift unrelated controls horizontally.
- Collapse is organizational only. It never enables, disables, resets, or bypasses processing.
- `aria-expanded` must match the visual state, and the hidden body must not remain keyboard-reachable.

## Modified state

Use the sentence-case abbreviation `Mod` everywhere. Do not introduce synonyms such as `changed`, `edited`, or `custom` for the same state.

- Countable groups display `<number> Mod`, for example `1 Mod` or `4 Mod`.
- Aggregate groups such as Curves and Film Look display `Mod` when a useful item count is unavailable.
- Uppercase presentation may come from CSS, but source copy remains normal case.
- A small ultraviolet dot may reinforce modified state, but color or the dot alone must not carry the meaning.
- Untouched group headers omit status copy. Reset is shown only for a modified group.
- Reset returns only the named scope to canonical defaults and immediately clears its modified state.
- Bypassed and modified are independent states: bypass keeps the authored values.

## Color system

Runtime tokens in `frontend/styles.css` are authoritative. Use semantic tokens rather than new literal colors.

| Role | Token | Current value | Use |
|---|---|---:|---|
| Viewer / chassis | `--viewer`, `--hf-chassis` | `#07080a` | Image surround and deepest window ground |
| App | `--app` | `#0b0d0f` | Ground between regions |
| Panel | `--panel`, `--hf-panel` | `#101315` | Rails, headers, and collapsed rows |
| Raised | `--raised`, `--hf-raised` | `#171b1e` | Open wells, grouped tiles, and selected-control surfaces |
| Input | `--input` | `#12171a` | Neutral interactive beds |
| Channel | `--deep`, `--hf-channel` | `#06080a` | Slider and segment recess floor |
| Hairline | `--hairline` | `rgba(255, 255, 255, 0.07)` | Quiet separators and inset rings |
| Border | `--border` | `#252a2e` | Visible raised-surface boundary |
| Text | `--text`, `--hf-ink-1` | `#f2f4f3` | Values and primary titles |
| Body | `--body` | `#c3c8cb` | Control labels and ordinary copy |
| Muted | `--muted`, `--hf-ink-2` | `#8d9299` | Secondary information |
| Quiet | `--quiet` | `#5f6870` | Nonessential metadata after contrast validation |
| Accent | `--accent`, `--hf-accent` | `#9b7bff` | Focus, live fill, active tool, and selected state |
| Accent strong / low | `--accent-strong`, `--accent-low` | `#b49cff`, `#6e4bff` | Bright crown and lower edge of small active treatments |
| Accent bed | `--accent-bed` | `#211a3b` | Tinted seat beneath selected tools and rows |
| Bypass icon artwork | `--bypass-icon-shape` | Eyebrow arc over outlined circular eye | Shared, replaceable visibility glyph for global groups and local adjustments |
| Bypass icon size | `--bypass-icon-size` | `20px` | Shared icon dimensions |
| Visible adjustment | `--bypass-icon-visible` | `var(--accent)` | Ultraviolet eye indicates the adjustment is included in the rendition |
| Bypassed adjustment | `--bypass-icon-hidden` | `var(--quiet)` | Neutral gray eye with a diagonal strike indicates the adjustment is bypassed |
| Bypass strike width | `--bypass-icon-strike-width` | `1.5px` | Diagonal eye-off mark weight |
| Ready | `--ready` | `#8cbf9a` | Successful readiness |
| Headroom / attention | `--headroom`, `--attention` | `#ffb020` | HDR headroom and warnings requiring review |
| Blocking | `--blocking` | `#d4796b` | Errors and blocking state |

Electric ultraviolet is the only ordinary active accent and stays spatially small: fills, focus, a selected tool, an index/hairline, or a tinted selected bed. It must not wash broad panels. Reserve saturated RGB colors for channel-specific scopes and curve channels. Do not reuse error red, ready green, HDR amber, or exposure-band colors as decorative accents.

### Panel title component tokens

Metadata, Preview Window, Control Panel, and Scopes use the shared `.panel-title` component. Runtime values remain authoritative in `frontend/styles.css`.

| Role | Token | Current value |
|---|---|---:|
| Font family | `--panel-title-font-family` | `var(--display)` |
| Font size | `--panel-title-font-size` | `13px` |
| Font weight | `--panel-title-font-weight` | `600` |
| Letter spacing | `--panel-title-letter-spacing` | `0.06em` |
| Color | `--panel-title-color` | `var(--text)` |

Panel titles render in uppercase through the component class. Tooltip wording is maintained in `HDR_Finisher_Tooltip_Copy.md`; title-triggered explanatory tooltips use a two-second hover delay and must also open from keyboard focus.

### Group title component tokens

Control Panel group headings and Metadata disclosure headings share one typography contract. This includes titles such as `HIGHLIGHT COMPRESSION`, `SOURCE INTERPRETATION`, and `METADATA`. Runtime values remain authoritative in `frontend/styles.css`.

| Role | Token | Current value |
|---|---|---:|
| Font family | `--group-title-font-family` | `var(--display)` |
| Font size | `--group-title-font-size` | `12px` |
| Font weight | `--group-title-font-weight` | `600` |
| Letter spacing | `--group-title-letter-spacing` | `0.06em` |
| Color | `--group-title-color` | `var(--text)` |
| Text transform | `--group-title-text-transform` | `uppercase` |
| Header height | `--control-group-header-h` | `38px` |
| Gap below Control Panel heading | `--control-panel-header-gap` | `0px` |

Every top-level Control Panel disclosure, including RAW DEVELOPMENT, uses the
same header-height token and horizontal rhythm as the grading groups. Source
rail disclosures may use their denser metadata spacing, but that spacing must
be scoped to `.source-rail` and must never leak into the Control Panel.
The first disclosure sits flush beneath the Control Panel heading divider;
do not add an unowned top margin that makes the first row appear taller.

## Typography and copy

- Bundle all application fonts locally; no interface may depend on a network font service.
- Use Source Sans 3 through `--font-body` / `--sans` for sentence-case control names, body copy, buttons, menus, and explanations.
- Use Gabarito through `--font-display` / `--display` for all-caps panel titles, top-level section titles, and short all-caps group headings only.
- Use Space Mono through `--font-technical` / `--mono` for numbers, signed values, units, symbols, section indices, status chips, dimensions, and other compact technical labels.
- Use tabular numerals for aligned values where supported. Do not set explanatory sentences in Space Mono or ordinary body copy in Gabarito.
- Keep control names short and concrete. Prefer `Target Peak` to a sentence-length label.
- Use sentence case in source markup. CSS may uppercase compact instrument labels.
- Use `HDR` and `SDR` consistently; do not alternate with unexplained substitutes.
- The 26px bundled product mark in the top lockup carries a crisp 1px white perimeter border; preserve the real logo asset inside it.
- Include units in displayed values: `nit`, `EV`, `%`, or `K` as appropriate.
- Tooltips explain consequences and tradeoffs, not merely restate the label.
- Avoid internal implementation terms in user-facing copy.

## Controls and feedback

- Neutral values use neutral styling; modified values use the accent fill and stronger readout color.
- Sliders retain native keyboard semantics and expose a directly editable numeric readout.
- Double-clicking a value enables exact entry; Reset restores the documented default.
- Bypass controls use the shared tokenized eye component and preserve their settings. The unstruck ultraviolet eye means visible/enabled; a neutral gray eye with a diagonal strike means bypassed. Local-adjustment eyes live in each adjustment row immediately before its overflow menu.
- Disabled controls remain legible enough to explain the pipeline but cannot appear active.
- Interactive preview feedback should begin promptly; settled scopes and refinements may follow.
- Preview-only controls must say when they do not affect export quality.
- Global and local adjustments use the shared `.instrument-slider-control` component. The first row holds the sentence-case control name at left and its numerical value at right; the uninterrupted slider occupies the complete second row below it.
- Standard instrument-slider labels use Source Sans 3 and values use Space Mono. Every ordinary slider in a section uses the full available row width.
- Compact side-by-side label / rail / value rows are permitted only inside `.slider-group-tile .compact-subrails` or another explicitly documented dense component. They must never appear as ordinary peer sliders.
- Tracks, fills, labels, values, and bar thumbs must not change shape or weight between global grading, local Light and Color controls, Brush Controls, Gradient Controls, and Adjustment Opacity.
- Rails are borderless recessed channels. A dark-to-light vertical face plus a black upper inset and restrained bright lower lip produces the chamfer and internal depth; these are continuous surface treatments, not tick, home, center, or grid marks. Semantic landing positions remain behavioral metadata and are not drawn inside the channel.
- Color-bearing rails—Kelvin temperature, green/magenta tint, and RGB primary hue/purity—retain their full semantic horizontal spectrum. Kelvin runs cool blue at the left through neutral to warm amber at the right; tint runs magenta at the left through neutral to green at the right. A translucent vertical chamfer layer and the shared inset shadow provide depth without obscuring or replacing that spectrum; ordinary value fills do not cover these rails.
- Slider handles are fully opaque, borderless polished-neutral bars. Pointer hover does not change their dimensions. Keyboard focus and active drag use a restrained neutral handle glow; ultraviolet outlines must not appear on the handle or rail.
- Double-clicking any adjustment slider resets it to its declared default and immediately commits the change. This applies to static and dynamically generated controls; utility sliders such as zoom may opt out explicitly when reset would conflict with their interaction model.
- Brush Mask Controls apply after stroke composition in this order: Shift Edge, Feather, then Opacity. Shift Edge is a signed control (negative contracts, positive expands). Feather performs a float32, aspect-ratio-aware Gaussian smoothing of the shifted mask so both the overlay and the applied grade share a continuous edge at every preview resolution.
- Brush Control Feather uses a monotonic perceptual response curve with fine control at low values and full falloff at 100%. Overlapping samples within one stroke use maximum falloff coverage rather than accumulating alpha, so increasing Feather must never harden the rendered edge.
- The Gradient mask tool uses the bundled Tabler `square-half` asset, and Luma uses the bundled Tabler `brightness-half` asset. These are real local SVG assets from the same licensed icon family as Brush, Erase, and Path; do not replace them with font glyphs, placeholders, improvised SVGs, emoji, or text-only buttons.

### Instrument slider and rendition-tab component tokens

These layout tokens are authoritative in `frontend/styles.css` and are shared by global and local adjustment components.

| Role | Token | Current value |
|---|---|---:|
| Control-row minimum height | `--instrument-control-row-min-h` | `36px` |
| Heading minimum height | `--instrument-control-heading-min-h` | `16px` |
| Heading label/value gap | `--instrument-control-heading-gap` | `8px` |
| Heading-to-slider gap | `--instrument-control-stack-gap` | `2px` |
| Slider interaction height | `--instrument-slider-hit-h` | `28px` |
| Track top inset | `--instrument-slider-track-top` | `7.5px` |
| Track height | `--instrument-slider-track-h` | `13px` |
| Neutral / hover thumb width | `--instrument-slider-thumb-w`, `--instrument-slider-thumb-hover-w` | `9px`, `9px` |
| Thumb height | `--instrument-slider-thumb-h` | `21px` |
| Chamfered channel face | `--instrument-slider-channel-background` | Dark-to-light vertical neutral gradient |
| Recessed channel shadow | `--instrument-slider-channel-shadow` | Tokenized inset shadow |
| Neutral handle focus | `--instrument-slider-thumb-focus-shadow` | Tokenized neutral glow |
| Compact interaction height | `--instrument-compact-slider-hit-h` | `28px` |
| Compact track height | `--instrument-compact-slider-track-h` | `7px` |
| Compact thumb | `--instrument-compact-slider-thumb-w`, `--instrument-compact-slider-thumb-h` | `7px`, `15px` |
| Rendition-tab boundary | `--instrument-tab-rule-w`, `--instrument-tab-rule-color` | `1px`, `--hairline` |
| Local-control inset | `--local-control-inset` | `12px` |

The HDR/SDR rendition switch and its content boundary form one tab component. The boundary spans the full content surface, sits directly under the tabs, and is covered by the selected tab's bottom edge. It must not be inset, detached, or duplicated by the first control section.

### Parent and subordinate slider tiles

- One raised tile and inset ring form the grouping boundary. The full-size parent appears first, followed by a divider, an honest relationship label, and compact child rails.
- Use `Targeting` when independently stored Range/Pivot controls define the parent's zone. Use `Tone distribution` for the independent Local Light tone controls. Use `Applies to` only when the parent actually changes or distributes into its children.
- Child rows use aligned fixed label and value columns around the compact rail. Default child values remain muted; modified values use primary ink plus structural modified state.
- Visual hierarchy never invents data coupling. Child edits remain isolated unless the product model explicitly defines a coupled operation. Parent, child, and whole-group reset meanings remain distinct.

### Toggle and segmented controls

- Native checkboxes rendered as switches use a 46×24px borderless neutral recessed pill when off and a solid ultraviolet pill when on. Both tracks inherit the slider rail's dark upper inset, light lower chamfer, and recessed channel shadow. One 24px circular handle matches the track's maximum height, uses a soft continuous neutral-gray spherical gradient, and renders as a separate positioned surface above the rail's inset-shadow layer. Its structural position distinguishes state. Stacked rows retain breathing room, and the entire labeled row remains clickable with native semantics.
- HDR/SDR and equivalent mutually exclusive choices use one recessed outer channel with a dark vertical gradient and internal shadow. The selected item is a neutral raised inner plate with its own vertical gradient, lit top edge, soft drop shadow, and ultraviolet text/icon—not a flat solid accent block.
- Primary and neutral secondary actions use matching vertical material gradients and a soft lower drop shadow. Primary actions stay ultraviolet with a true zero-width border and no white inset edge; secondary actions stay neutral.
- Arrow navigation, visible focus, disabled behavior, and `aria-selected` or `aria-pressed` remain appropriate to the semantic role.
- Metadata and Scopes use the shared tokenized 28px `.panel-collapse-button`: a neutral vertical gradient, lit top edge, soft lower shadow, and the real bundled chevron asset. Metadata points left while open and right while collapsed. Scopes points down while open and up while collapsed; accessible names describe the action rather than duplicating visible text.

### Slider and graph modifiers

- Ctrl provides approximately 10× finer movement for slider drags, slider arrows, assigned continuous-control commands, Curves, and Exposure Bands. On macOS this means the Control key, not Command.
- Shift activates semantic snapping for range sliders only. Shift+Arrow chooses the next legal landing position; Shift+drag chooses the nearest one. Ctrl+Shift follows Shift snapping.
- Shift landing positions come from one centralized profile and are intentionally not drawn in the rail. The default has five unique positions including home; explicit EV, percentage, Kelvin, degree, nit, and dynamic/asymmetric profiles include only legal values.
- Bipolar fills originate at the declared home/zero; unipolar fills originate at the floor. Home remains represented by the handle and fill origin rather than a tick.
- Curves and Exposure Bands keep ordinary Shift graph movement. Exposure Bands preserves Ctrl/Command+Left/Right for horizontal band movement while Ctrl+Up/Down and Ctrl-drag provide precision.
- Alt/Option is not a precision alias. Home/End, direct entry, double-click reset, preview scheduling, and commit boundaries retain their existing meanings.

## Control Panel chassis and local hierarchy

- One continuous chassis contains the fixed Control Panel header and numbered disclosure stack. Section indices use Space Mono at 11 px, sit close to the 18 px chevron, and remain outside accessibility naming when the title already names the group. The disclosure button extends beneath the painted index so clicking either the index or chevron activates the same accessible toggle.
- Multiple top-level disclosures may remain open. An open section uses an ultraviolet index/hairline and one raised, full-bleed content surface with square open edges; it must not become an inset rounded card. Disclosure and keyboard semantics remain unchanged.
- Local Adjustments orders its content as Masks, adjustment instances, selected context, then grading controls. Brush, Erase, Gradient, Luma, and Path retain the real bundled Tabler assets, visible labels, accessible names, and `aria-pressed` state.
- Selected tools use the accent bed plus outline/hairline; selected adjustment rows use a tinted bed and thin structural marker instead of a broad solid accent block.

## Curves and graphical editors

- Curves begin neutral with three editable points at 25%, 50%, and 75%, plus fixed black and white endpoints.
- Left-clicking the curve line adds a point at that position.
- Left-clicking an existing point selects it; left-dragging adjusts it.
- Right-clicking an interior point removes it.
- Fixed endpoints cannot be removed.
- Selected points use the selected-point token; channel curves use their channel tokens.
- Canvas instructions must be available through an accessible label and keyboard operation.

### Local path editor

- Creating a path starts an unsaved draft: click for a sharp node, click-drag for a smooth node, and close through the first node, Enter, or a valid external interaction.
- Path and Feather are explicit edit modes. Both boundaries remain visible, but only the active boundary shows interactive anchors and the selected node's handles.
- Left-clicking a segment inserts a node; right-clicking a node removes it down to the three-node minimum, matching the global graph convention.
- Sharp and smooth modes use icon-and-label buttons. Sharp nodes are square and smooth nodes circular, so type never depends on color alone.
- Boundaries use a dark halo plus a high-contrast foreground stroke. The feather boundary uses marching ants, with static dashes under `prefers-reduced-motion`.
- Selected anchors use the shared warm selection token and a contrasting ring. Visible anchors and handles are enlarged, and hit testing provides at least a 28 px target.
- Handles appear only for the selected node. Path handles plus Feather handles and anchors may be manipulated beyond the image edge anywhere the viewer overlay remains available; a warm hover ring confirms acquisition in the letterbox.
- The shared instrument slider controls the global feather baseline; Reset Feather Shape rebuilds a uniform boundary without changing that baseline.
- Moving a local grade control dismisses the colored mask fill so exposure and color changes remain judgeable; the editable boundary lines stay visible.
- Keyboard parity includes previous/next selection, node/handle target cycling, arrow nudging, segment insertion, removal, and explicit Sharp/Smooth controls.

### Curve graph component tokens

The curve graph is a reusable instrument component. Its runtime values live in `frontend/styles.css`; canvas code must read these tokens rather than introduce literal colors or sizes.

| Element | Token | Current value | Rule |
|---|---|---:|---|
| Graph grid | `--curve-grid` | `#ffffff14` | Quiet one-pixel horizontal grid; use on both HDR and SDR curves |
| Identity line | `--curve-identity` | `#ece9df2e` | Neutral diagonal reference below the authored curve |
| Luma / neutral curve and point | `--curve-neutral` | `#ece9df` | SDR Luma stroke and unselected interior points |
| Red channel curve | `--curve-red` | `#ff8585` | Red-channel stroke only |
| Green channel curve | `--curve-green` | `#7fe6a8` | Green-channel stroke only |
| Blue channel curve | `--curve-blue` | `#7db8ff` | Blue-channel stroke only |
| Fixed endpoint fill | `--curve-endpoint` | `#7f7a6f` | SDR endpoint fill; HDR endpoints use their exposure-band color |
| SDR selected fill | `--curve-selected` | `#efbb55` | Selected SDR point fill; HDR selection retains its exposure-band fill |
| Curve width | `--curve-line-width` | `2.5` | Main curve stroke width in canvas pixels |
| Editable point radius | `--curve-node-radius` | `5` | Default interior control point |
| Endpoint radius | `--curve-endpoint-radius` | `4` | Fixed black and white anchors are intentionally smaller |
| Selected point radius | `--curve-selected-radius` | `6` | Selected control point expands without changing its center |
| Selected ring | `--curve-selected-ring` | `#edf0f1` | High-contrast outline around the selected point |
| Selected ring width | `--curve-selected-ring-width` | `1.5` | Canvas-pixel outline; selection cannot rely on fill color alone |
| Axis label | `--curve-axis-label` | `#e0e8ebad` | Two-row compact nit labels below the HDR plot |
| Reference-white guide | `--curve-reference-line` | `#97e0ec7a` | Stronger vertical guide at the active exposure preset's reference white |
| Exposure-band wash | `--curve-band-opacity` | `0.1` | Background band opacity; preserves curve and grid legibility |

HDR exposure-band colors are shared by the False Color key and the curve graph. The ordered tokens are:

| Band role | Token | Current value |
|---|---|---:|
| Deep shadow | `--exposure-band-deep-shadow` | `#2e006b` |
| Shadow | `--exposure-band-shadow` | `#002ed9` |
| Low midtone | `--exposure-band-low-mid` | `#009eff` |
| Midtone | `--exposure-band-mid` | `#00d959` |
| Reference white | `--exposure-band-white` | `#fae02e` |
| Highlight | `--exposure-band-highlight` | `#ff7a1f` |
| Peak / over-range | `--exposure-band-peak` | `#ff1f1f` |

- HDR graph backgrounds use low-opacity vertical exposure bands derived from the selected exposure preset. Boundary guides, Luma curve segments, and point fills use the same ordered palette.
- Red, Green, and Blue curves retain their channel-token stroke so channel identity remains unambiguous; their HDR background and nodes still expose the input exposure bands.
- HDR point selection uses the exposure-band fill plus the selected ring. SDR point selection uses `--curve-selected`; SDR endpoints use `--curve-endpoint`, and other SDR points use `--curve-neutral`.
- A displaced point carries the shared return-to-home cue on the side facing the identity line: below a point that is above identity, and above a point that is below identity.
- HDR nit labels include the `0` endpoint, every visible exposure-band boundary, and the `10K` PQ endpoint. Labels may use two rows and must be collision-checked; do not hide the low-end labels to solve overlap.
- The HDR horizontal domain must match processing: the active project reference-white anchor (203 nits by default, or the controlled 100-nit workflow) is at 50%, the shadow half uses the production shadow-power mapping, and the upper half is logarithmic through 10,000 nits.

Exposure Bands follows the same direct-manipulation principle with distinct mouse buttons:

- Left-click the exposure curve to add a band at that brightness.
- Right-click an interior band to remove it.
- Left-drag an existing band to adjust its input position and exposure effect.
- The darkest and brightest endpoint bands cannot be removed.
- Add Band, Remove Band, and keyboard controls remain available as explicit alternatives.

### Exposure Bands graph component tokens

Exposure Bands is a stop-based equalizer centered on the active project reference white. Its canvas must use the equalizer tokens in `codebase/frontend/styles.css`.

| Element | Token | Current value | Rule |
|---|---|---:|---|
| Minor grid | `--equalizer-grid` | `#ffffff14` | One-pixel EV grid |
| Zero-adjustment grid | `--equalizer-grid-strong` | `#ece9df42` | Stronger horizontal home line at 0 EV adjustment |
| Reference-white guide | `--equalizer-zero` | `#9b7bff52` | Vertical input guide at 0 EV / active project reference white |
| PQ-limit guide | `--equalizer-pq` | `#d9b672a6` | Dashed vertical guide at 10,000 nits |
| Zero-axis label | `--equalizer-axis` | `#9fbcca` | Emphasizes the 0 EV input label |
| Active curve | `--equalizer-curve` | `#edf0f1` | Enabled equalizer curve stroke |
| Default point | `--equalizer-node` | `#ece9df` | Unselected enabled band point |
| Selected point | `--equalizer-selected` | `#efbb55` | Selected band point and influence emphasis |
| Disabled state | `--equalizer-disabled` | `#7f878d` | Bypassed curve and point treatment |
| Influence wash | `--equalizer-influence-wash` | `#efbb5517` | Selected band's horizontal influence range |
| Curve width | `--equalizer-line-width` | `2.25` | Main curve stroke in canvas pixels |
| Default point radius | `--equalizer-node-radius` | `4` | Unselected band point |
| Selected point radius | `--equalizer-selected-radius` | `5.5` | Selected band point |

- Input brightness is labeled primarily in EV because band spacing, horizontal movement, and influence radius are stop-based. The selected-band readout pairs EV with nits, for example `0 EV · 203 nit` in a default project; the graph also labels the 10K PQ boundary.
- The horizontal input domain runs from -6 EV through the 10,000-nit PQ boundary. The vertical adjustment domain runs from -2 EV to +2 EV with 0 EV as home.
- Positive adjustments place a point above home and show the shared cue beneath it. Negative adjustments place a point below home and show the cue above it. Neutral points show no cue.
- The selected influence wash communicates reach only; it must not obscure the curve, grid, points, or return-to-home cues.

### Shared return-to-home indicator tokens

Curves and Exposure Bands use the same directional cue geometry and color. The cue always sits on the side of the point facing its home line and disappears within the neutral tolerance.

| Element | Token | Current value | Rule |
|---|---|---:|---|
| Cue color | `--graph-home-cue-color` | `#edf0f1` | Reuses the existing neutral/selection-ring color; do not add a direction color |
| Cue opacity | `--graph-home-cue-opacity` | `0.62` | Keeps the indicator subordinate to the point |
| Point gap | `--graph-home-cue-gap` | `1.5` | Clear space between point edge and cue |
| Cap length | `--graph-home-cue-length` | `6` | Width of the horizontal directional cap |
| Stroke width | `--graph-home-cue-width` | `1` | Hairline cue stroke in canvas pixels |
| Neutral tolerance | `--graph-home-epsilon` | `0.006` | Suppresses visual noise at home |

### Graph canvas resolution and layout

- Curve and Exposure Bands canvases use the same 16:11 displayed aspect ratio.
- The bitmap backing size must equal the current CSS-pixel size multiplied by `window.devicePixelRatio`; drawing coordinates, line widths, hit testing, and documented point sizes remain in logical CSS pixels.
- A `ResizeObserver` redraws both editors after disclosure, rail resizing, window resizing, or display-scale changes. Do not stretch a fixed 320×220 bitmap to fill the rail.
- Exposure Bands reserves a 34 px logical left gutter and 14 px right gutter. Signed Y-axis labels, including their `+`/`−` prefix and `EV` unit, must remain fully inside the canvas.
- Curve labels and Exposure Bands labels use the same device-scale-aware text rendering path. Preserve whole logical-pixel label positions where practical and never compensate for blur by increasing font weight.

## Spacing and geometry

Use the runtime tokens and existing component rhythm as the baseline:

- Source rail: 268 px default.
- Grade rail: 320 px default.
- Analysis dock: 252 px default.
- Control row: 38 px.
- Control-group and RAW DEVELOPMENT disclosure header: 38 px via `--control-group-header-h`.
- Corner radius: 3 px.
- Hairlines separate dense regions. Expanded top-level panels use the documented 3 px external top and bottom boundaries with open side edges; internal panel boundaries and collapsed-group separators remain 1 px. Avoid nested heavy borders.
- Keep hit targets comfortably larger than their visible glyphs.

Resizable regions may change during the current session, but return to these defaults on reload.

### Compact workspace

- The shared frontend supports a 1100×720 viewport on macOS and Windows. Below 1500 px wide, the workspace enters compact mode.
- Metadata is the only region collapsed automatically. Its 44 px rail remains visible, and reopening it presents a temporary 268 px overlay without reducing the viewer or Control Panel width.
- The Control Panel remains docked at a minimum of 300 px. Scopes remains open by default and retains its explicit Collapse control.
- Comparison layout, zoom, Fit, and 100% stay in the viewer toolbar. Overlays and High-res Preview move into the keyboard-accessible Viewer options popover.
- Compact state and explicit panel choices last only for the current page session. Returning to a wide viewport restores the user's wide Metadata state.
- Responsive decisions use the available viewer width for warnings and viewer chrome; warning actions must never be clipped by a rail.

## Accessibility

- Every interactive control needs an accessible name.
- Disclosure, bypass, pressed, selected, and disabled states must be exposed semantically.
- Never rely on color alone for modified, warning, success, or failure state.
- Keep keyboard behavior equivalent to pointer behavior.
- Preserve visible focus indicators against every panel background.
- Maintain readable contrast for primary text, muted copy, and disabled controls.
- Canvas editors require equivalent keyboard commands and descriptive `aria-label` text.

## Review checklist

Before merging a UI change, confirm:

- A fresh load has no restored interface preferences or adjustments.
- Every grade group and source disclosure starts collapsed.
- `Mod` wording follows this guideline and Reset clears it correctly.
- HDR and SDR lanes remain visually and behaviorally consistent.
- Keyboard, focus, and ARIA states match pointer behavior.
- The interface remains usable at the supported minimum width.
- Preview-only behavior is not presented as export behavior.
- Automated frontend contracts and the relevant browser interaction checks pass.
- Any new pattern or exception is added to this document.
