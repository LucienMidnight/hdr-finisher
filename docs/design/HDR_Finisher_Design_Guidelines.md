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
- Bound every expanded top-level panel at the top and bottom with the 3 px neutral `--panel-border-external` token; leave its left and right edges open. Separate collapsed groups and regions inside an expanded panel with the 1 px blue-grey `--panel-border-internal` token. External and internal boundaries must not share color or weight.
- The whole labeled header is the disclosure target; Reset and bypass remain separate targets.
- New grade groups start collapsed unless a documented workflow requirement says otherwise.
- A group body opens directly below its header and must not shift unrelated controls horizontally.
- Collapse is organizational only. It never enables, disables, resets, or bypasses processing.
- `aria-expanded` must match the visual state, and the hidden body must not remain keyboard-reachable.

## Modified state

Use the word `modified` everywhere. Do not abbreviate it as `mod` and do not introduce synonyms such as `changed`, `edited`, or `custom` for the same state.

- Countable groups display `<number> modified`, for example `1 modified` or `4 modified`.
- Aggregate groups such as Curves and Film Look display `Modified` when a useful item count is unavailable.
- Uppercase presentation may come from CSS, but source copy remains normal case.
- A small teal dot may reinforce modified state, but color or the dot alone must not carry the meaning.
- Untouched group headers omit status copy. Reset is shown only for a modified group.
- Reset returns only the named scope to canonical defaults and immediately clears its modified state.
- Bypassed and modified are independent states: bypass keeps the authored values.

## Color system

Runtime tokens in `frontend/styles.css` are authoritative. Use semantic tokens rather than new literal colors.

| Role | Token | Current value | Use |
|---|---|---:|---|
| Viewer | `--viewer` | `#0b0c0d` | Image surround |
| App | `--app` | `#101214` | Primary chrome |
| Panel | `--panel` | `#171a1c` | Rails and panels |
| Raised | `--raised` | `#1f2325` | Elevated controls |
| Hairline | `--hairline` | `#26292c` | Quiet separators |
| External panel border | `--panel-border-external` | `#566168` | 3 px top and bottom boundaries on an expanded top-level panel; no left/right rule |
| Internal panel border | `--panel-border-internal` | `#344750` | Soft blue-grey 1 px separators inside panels and between collapsed groups |
| Text | `--text` | `#edf0f1` | Primary labels |
| Muted | `--muted` | `#9fa7ac` | Secondary information |
| Accent | `--accent` | `#6e9fb5` | Active and modified state |
| Ready | `--ready` | `#8cbf9a` | Successful readiness |
| Attention | `--attention` | `#d9b672` | Warnings requiring review |
| Blocking | `--blocking` | `#d4796b` | Errors and blocking state |

Reserve saturated RGB colors for channel-specific scopes and curve channels. Do not reuse error red, ready green, or attention amber as decorative accents.

## Typography and copy

- Use IBM Plex Sans, with the Segoe UI fallbacks already defined by `--sans`.
- Use IBM Plex Mono, with the existing fallbacks, for numeric and technical readouts.
- Keep control names short and concrete. Prefer `Target Peak` to a sentence-length label.
- Use sentence case in source markup. CSS may uppercase compact instrument labels.
- Use `HDR` and `SDR` consistently; do not alternate with unexplained substitutes.
- Include units in displayed values: `nit`, `EV`, `%`, or `K` as appropriate.
- Tooltips explain consequences and tradeoffs, not merely restate the label.
- Avoid internal implementation terms in user-facing copy.

## Controls and feedback

- Neutral values use neutral styling; modified values use the accent fill and stronger readout color.
- Sliders retain native keyboard semantics and expose a directly editable numeric readout.
- Double-clicking a value enables exact entry; Reset restores the documented default.
- Bypass controls use a distinct icon/state and preserve their settings.
- Disabled controls remain legible enough to explain the pipeline but cannot appear active.
- Interactive preview feedback should begin promptly; settled scopes and refinements may follow.
- Preview-only controls must say when they do not affect export quality.
- Global and local adjustments use the shared `.instrument-slider-control` component. The first row holds the sentence-case control name at left and its numerical value at right; the marked slider occupies the complete second row below it.
- Instrument-slider labels use medium-weight IBM Plex Sans and values use semibold IBM Plex Mono. Every slider in a section uses the full available row width; local controls must not revert to a side-by-side label / track / value layout.
- Tracks, fills, ticks, labels, values, and bar thumbs must not change shape or weight between global grading, local Light and Color controls, Brush Controls, Gradient Controls, and Adjustment Opacity.
- Double-clicking any adjustment slider resets it to its declared default and immediately commits the change. This applies to static and dynamically generated controls; utility sliders such as zoom may opt out explicitly when reset would conflict with their interaction model.
- Brush Mask Controls apply after stroke composition in this order: Shift Edge, Feather, then Opacity. Shift Edge is a signed control (negative contracts, positive expands). Feather performs a float32, aspect-ratio-aware Gaussian smoothing of the shifted mask so both the overlay and the applied grade share a continuous edge at every preview resolution.
- Brush Control Feather uses a monotonic perceptual response curve with fine control at low values and full falloff at 100%. Overlapping samples within one stroke use maximum falloff coverage rather than accumulating alpha, so increasing Feather must never harden the rendered edge.
- The Gradient mask tool uses the Fluent `GripperBarHorizontal` glyph (`E76F`) so its icon reads as graduated horizontal bands, not stacked windows or duplicated layers.
- The Luma mask tool temporarily uses the Fluent `Equalizer` glyph (`E9E9`) as a placeholder for the four-handle luminance-range illustration. Replace it with the final supplied icon asset when available; do not return to a stopwatch or timer metaphor.

### Instrument slider and rendition-tab component tokens

These layout tokens are authoritative in `frontend/styles.css` and are shared by global and local adjustment components.

| Role | Token | Current value |
|---|---|---:|
| Control-row minimum height | `--instrument-control-row-min-h` | `36px` |
| Heading minimum height | `--instrument-control-heading-min-h` | `16px` |
| Heading label/value gap | `--instrument-control-heading-gap` | `8px` |
| Heading-to-slider gap | `--instrument-control-stack-gap` | `2px` |
| Slider interaction height | `--instrument-slider-hit-h` | `20px` |
| Track top inset | `--instrument-slider-track-top` | `8px` |
| Track height | `--instrument-slider-track-h` | `2px` |
| Neutral / hover thumb width | `--instrument-slider-thumb-w`, `--instrument-slider-thumb-hover-w` | `2px`, `3px` |
| Thumb height | `--instrument-slider-thumb-h` | `14px` |
| Tick top inset | `--instrument-slider-tick-top` | `7px` |
| Rendition-tab boundary | `--instrument-tab-rule-w`, `--instrument-tab-rule-color` | `1px`, `--hairline` |
| Local-control inset | `--local-control-inset` | `12px` |

The HDR/SDR rendition switch and its content boundary form one tab component. The boundary spans the full content surface, sits directly under the tabs, and is covered by the selected tab's bottom edge. It must not be inset, detached, or duplicated by the first control section.

## Curves and graphical editors

- Curves begin neutral with three editable points at 25%, 50%, and 75%, plus fixed black and white endpoints.
- Left-clicking the curve line adds a point at that position.
- Left-clicking an existing point selects it; left-dragging adjusts it.
- Right-clicking an interior point removes it.
- Fixed endpoints cannot be removed.
- Selected points use the selected-point token; channel curves use their channel tokens.
- Canvas instructions must be available through an accessible label and keyboard operation.

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
- The HDR horizontal domain must match processing: the 100-nit diffuse-white anchor is at 50%, the shadow half uses the production shadow-power mapping, and the upper half is logarithmic through 10,000 nits.

Exposure Bands follows the same direct-manipulation principle with distinct mouse buttons:

- Left-click the exposure curve to add a band at that brightness.
- Right-click an interior band to remove it.
- Left-drag an existing band to adjust its input position and exposure effect.
- The darkest and brightest endpoint bands cannot be removed.
- Add Band, Remove Band, and keyboard controls remain available as explicit alternatives.

### Exposure Bands graph component tokens

Exposure Bands is a stop-based equalizer centered on the 100-nit diffuse-white reference. Its canvas must use the equalizer tokens in `codebase/frontend/styles.css`.

| Element | Token | Current value | Rule |
|---|---|---:|---|
| Minor grid | `--equalizer-grid` | `#ffffff14` | One-pixel EV grid |
| Zero-adjustment grid | `--equalizer-grid-strong` | `#ece9df42` | Stronger horizontal home line at 0 EV adjustment |
| Diffuse-white guide | `--equalizer-zero` | `#6e9fb552` | Vertical input guide at 0 EV / 100 nit |
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

- Input brightness is labeled primarily in EV because band spacing, horizontal movement, and influence radius are stop-based. The selected-band readout pairs EV with nits, for example `0 EV · 100 nit`; the graph also labels the 10K PQ boundary.
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
- Corner radius: 3 px.
- Hairlines separate dense regions. Expanded top-level panels use the documented 3 px external top and bottom boundaries with open side edges; internal panel boundaries and collapsed-group separators remain 1 px. Avoid nested heavy borders.
- Keep hit targets comfortably larger than their visible glyphs.

Resizable regions may change during the current session, but return to these defaults on reload.

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
- Modified wording follows this guideline and Reset clears it correctly.
- HDR and SDR lanes remain visually and behaviorally consistent.
- Keyboard, focus, and ARIA states match pointer behavior.
- The interface remains usable at the supported minimum width.
- Preview-only behavior is not presented as export behavior.
- Automated frontend contracts and the relevant browser interaction checks pass.
- Any new pattern or exception is added to this document.
