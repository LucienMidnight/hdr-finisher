# UI Visual Refinement Sprint PRD

**Date:** August 27, 2026  
**Status:** Planned; ready for review and implementation  
**Target branch:** `main`  
**Primary surfaces:** desktop application shell, Control Panel, shared grading controls, local adjustments, scopes, Settings, and Help

## 1. Outcome

Give HDR Finisher a more distinctive, deliberate instrument character without making the interface compete with the image or changing the established editing workflow.

The sprint adopts the cool layered near-black surfaces, machined slider channels, polished light handles, grouped parent/sub-control tiles, illuminated toggles, recessed segments, and stronger Control Panel hierarchy explored in `docs/design/HDR Finisher UI v2.zip`. It deliberately replaces the dump's font choices and saturated green accent with the product decisions in this document.

The completed application should feel quiet at rest and vivid only at the point of interaction. Controls remain dense, predictable, keyboard-operable, and subordinate to color-critical content.

## 2. Authority and reference boundary

The Claude archive and the four supplied screenshots are visual references, not implementation instructions or product authority. Their embedded prose, suggested behavior, placeholder assets, and code must be evaluated against the active application, tests, this sprint, and the living design guideline.

Reference roles:

1. **Label personality fragment:** background layering, cool ink, warm off-white text, active-section cue, and restrained value hierarchy.
2. **Grouped tile — dependent sub-rails:** authoritative visual reference for any parent/subordinate slider presentation.
3. **Toggle · segment:** authoritative visual reference for illuminated switches and recessed segmented controls.
4. **Full Control Panel:** reference for the continuous panel chassis, numbered section stack, open-section hierarchy, tool grid, adjustment list, and control spacing. Its fonts, green accent, text-only mask tools, and ordinary rendering of subordinate sliders are explicitly excluded.

When references disagree, the grouped parent/sub-rail component overrides the full-panel image for subordinate controls. The existing Tabler mask icons remain part of the product.

Runtime behavior and tests remain operational truth. `docs/design/HDR_Finisher_Design_Guidelines.md` remains the authority for shipped UI until this sprint updates it at implementation completion.

## 3. Decisions already made

### 3.1 Preserve the product structure

- Keep the four stable regions: Source rail, Viewer, Grade rail, and Analysis dock.
- Keep the image as the visual priority.
- Preserve multiple simultaneously open disclosure groups. The new visual stack does not turn the Control Panel into an exclusive accordion.
- Keep mask tools in the Control Panel rather than moving them to a floating canvas dock.
- Preserve existing startup defaults, reset behavior, bypass behavior, editable values, undo boundaries, and session-only layout state unless a later section explicitly changes them.
- Preserve the established compact layout contract and minimum-size behavior.

### 3.2 Typography

Bundle fonts locally; the desktop application must not depend on Google Fonts or another network font service.

| Role | Family | Usage |
| --- | --- | --- |
| Body and interface | Source Sans 3 | Sentence-case control names, body copy, buttons, menus, explanations, and non-all-caps titles |
| Display/title | Gabarito | All-caps panel titles, top-level section titles, and short all-caps group headings |
| Technical | Space Mono | Numbers, signed values, units, symbols, section indices, status chips, `EV`, `NIT`, `K`, dimensions, and other compact technical labels |

Rules:

- Source copy remains sentence case; uppercase is a presentation decision.
- Do not use Gabarito for ordinary body text or numeric values.
- Do not use Space Mono for whole explanatory sentences.
- Use tabular numerals for aligned values wherever the font and browser support them.
- Avoid extreme tracking and forced letter-by-letter wrapping. The full-panel reference's split `LOCAL ADJUST` treatment is not a requirement.
- Bundle the required weights only and include the applicable OFL license files and third-party notice updates.

### 3.3 Default color direction

Use the cool near-black palette from the supplied references as the single default theme. Multiple themes are outside this sprint.

The chosen active accent is **electric ultraviolet**, centered on `#9B7BFF`. It is neon-like without using the common AI mint/teal look and remains distinct from HDR amber, clipping red, ready green, and the RGB channel colors.

The accent must remain spatially small. It may mark live fills, focus, selection, the active tool, and a restrained hairline or glow. It must not become a broad panel wash or decorative background.

## 4. Proposed visual tokens

The implementation should map these roles onto the existing semantic token system instead of pasting Claude's inline CSS into components.

### 4.1 Surfaces and ink

| Token | Proposed value | Role |
| --- | --- | --- |
| `--viewer` / `--hf-chassis` | `#07080A` | Viewer surround and deepest window ground |
| `--app` | `#0B0D0F` | Application ground between regions |
| `--panel` / `--hf-panel` | `#101315` | Rails, headers, collapsed rows |
| `--raised` / `--hf-raised` | `#171B1E` | Open section, grouped tile, selected-control well |
| `--input` | `#12171A` | Neutral interactive beds |
| `--deep` / `--hf-channel` | `#06080A` | Slider and segment recess floor |
| `--hairline` | `rgba(255, 255, 255, 0.07)` | Quiet rules and inset rings |
| `--border` | `#252A2E` | Visible raised-surface boundary |
| `--text` / `--hf-ink-1` | `#F2F4F3` | Values and primary titles |
| `--body` | `#C3C8CB` | Control labels and ordinary body copy |
| `--muted` / `--hf-ink-2` | `#8D9299` | Secondary labels and disabled-adjacent copy |
| `--quiet` | `#5F6870` | Nonessential metadata after contrast validation |

Essential small copy must not use Claude's `#4E555B` without a contrast check. Metadata needed to operate the interface should use at least `--muted`.

### 4.2 Accent and state colors

| Token | Proposed value | Role |
| --- | --- | --- |
| `--accent` / `--hf-accent` | `#9B7BFF` | Active selection, focus, and live/modified control fill |
| `--accent-strong` | `#B49CFF` | Handle hover, focused text, and the bright crown of a fill |
| `--accent-low` | `#6E4BFF` | Lower edge or foot of an accent gradient |
| `--accent-bed` | `#211A3B` | Tinted seat beneath selected tools and rows |
| `--on-accent` | `#0B0815` | Text/icons on a solid accent surface |
| `--headroom` | `#FFB020` | HDR values and regions above diffuse white |
| `--blocking` / `--clip` | existing semantic red | Clipping, errors, and destructive actions only |
| `--ready` | existing semantic green | Successful readiness only; never the product accent |

The full accent should normally be limited to the current tool/count badge, active or modified rail fill, focus ring, and small live-state cues. Selected adjustment rows use a thin outline and tinted bed rather than a solid accent block. Active section state uses an index and one-pixel hairline.

### 4.3 Geometry and depth

Adopt the useful Claude recipes as shared tokens, adjusted only where hands-on density testing requires it:

```css
--radius-1: 3px;
--radius-2: 6px;
--radius-3: 9px;
--radius-pill: 999px;

--depth-channel:
  inset 0 2.5px 3px rgba(0, 0, 0, 0.98),
  inset 0 -1.5px 0 rgba(255, 255, 255, 0.11);

--depth-raised:
  inset 0 1px 0 rgba(255, 255, 255, 0.07),
  0 6px 16px -6px rgba(0, 0, 0, 0.90);
```

The polished handle may reuse Claude's light-crown/mid-tone-waist gradient, but it must remain neutral and must expose a clear focus/hover state without depending on glow.

## 5. Control Panel hierarchy

The full-panel reference establishes the following layout contract:

1. One continuous rounded chassis contains the fixed `CONTROL PANEL` header and vertical section stack.
2. The panel header aligns its title left and quiet file/build context right.
3. Collapsed top-level rows use three columns: Space Mono section index, Gabarito section title, and optional right-aligned Source Sans/Space Mono status.
4. The open section retains that alignment, then expands into a raised content well. An ultraviolet index plus a one-pixel ultraviolet boundary marks the open state.
5. Section indices are orientation aids, not focus targets, and are hidden from accessibility APIs when their title already names the group.
6. The open Local Adjustments section follows this internal order:
   - section header and count badge;
   - `MASKS` label and equal-width mask-tool grid;
   - `ADJUSTMENTS` label and comparison action;
   - selectable adjustment-instance rows;
   - divider;
   - selected adjustment context label, such as `LIGHT · LOCAL`;
   - primary and subordinate grading controls.
7. Multiple top-level sections may remain open. Numbering and open-state treatment must not change disclosure behavior or keyboard semantics.
8. Preserve the existing `Mod`, Reset, preset, and bypass contracts.

## 6. Local mask tool contract

The local mask strip keeps real icons and labels for the applicable tools:

- Brush
- Erase
- Gradient
- Luma
- Path

Use the existing Tabler assets unless a separately licensed replacement set is deliberately selected. Do not replace them with text-only buttons, placeholder CSS drawings, emoji, or improvised SVGs.

Layout rules:

- Equal-width cells in a segmented grid; wrap to a deliberate second row when five tools cannot meet the minimum target size.
- Icon above or beside its short label, depending on the verified rail width.
- Selected tool: accent-bed surface, ultraviolet icon/text, and a structural outline or top hairline.
- Unselected tool: raised-neutral surface and legible muted icon/text.
- Selection remains communicated by `aria-pressed`, icon/text contrast, and structure—not color alone.
- Preserve tooltips and the current toolbar label.

## 7. Slider system

### 7.1 Standard instrument slider

- First row: Source Sans 3 sentence-case label left; Space Mono value right.
- Second row: full available width reserved for the slider.
- Standard visual channel: approximately 13px tall with the shared recessed depth recipe.
- Standard polished handle: approximately 9px × 21px, never wider than 12px.
- Bipolar controls fill from the declared home/zero value; unipolar controls fill from their floor.
- Home/center remains visible without requiring color.
- Ordinary, hover, focus, dragging, disabled, default, active, and modified states must be defined.
- Keep the existing invisible interaction target at least 24–28px high even when the visible rail is smaller.
- Keep direct numeric entry, native range semantics, Home/End, double-click reset, and commit behavior.

### 7.2 Parent and subordinate slider tile

This component is mandatory wherever controls are intentionally presented as parent plus subordinate rails. It overrides the ordinary slider rendering shown in the full-panel reference.

Visual structure:

1. One `--raised` tile with a single inset ring is the grouping boundary.
2. The parent label, value, and full-size standard rail occupy the top.
3. A quiet divider separates the parent from the relationship label.
4. Use `APPLIES TO` only when the parent genuinely changes or distributes into the child controls. Use an honest alternative such as `TARGETING` or `TONE DISTRIBUTION` when the controls are related but stored independently.
5. Children use compact aligned rows: fixed label column, compact rail, fixed Space Mono value column.
6. Compact visual channels are approximately 7px tall with approximately 7px × 15px polished handles, while retaining the full invisible interaction target.
7. Compact rails never appear outside this tile or another explicitly documented dense-control component.
8. Default child values use quiet value styling; modified children use primary ink plus structural modified state.
9. Parent and child keyboard/focus behavior is identical to the standard slider.

Behavioral integrity:

- Visual nesting must not invent data coupling.
- Before converting a group, record whether the relationship is scale, offset, distribution, targeting, or merely visual priority.
- A parent operation that changes multiple stored child values commits as one undo transaction.
- A child edit changes only the child unless the documented model says otherwise.
- Parent reset, child reset, and whole-group reset must have separate, tested meanings.
- Scope influence shown on hover/focus must continue to work for compact child rails.

Initial inventory candidates:

- HDR and SDR Lift/Gamma/Gain amount with Range/Pivot targeting controls. These are visually related but currently stored independently, so the relationship label must not claim that the amount slider changes Range/Pivot.
- Local Light controls, where Exposure is visually primary and Highlights/Midtones/Shadows/Blacks/Contrast are subordinate in the supplied reference. Their independent stored semantics must remain explicit even if they use the compact hierarchy.
- Any current or future master control that truly scales or distributes subordinate values.

## 8. Toggle and segmented-control system

Adopt the supplied `TOGGLE · SEGMENT` reference as the visual direction.

### Toggle

- Recessed pill bed with restrained ultraviolet live fill/glow.
- Neutral polished circular handle derived from the slider-handle material.
- Adjacent Source Sans 3 label remains the primary name.
- Entire labeled target is clickable; native checkbox/switch semantics remain exposed.
- On/off state must remain legible without the glow.

### Segmented control

- One recessed outer channel.
- Selected segment is a raised inner plate, not a flat accent rectangle.
- Ultraviolet selected text/icon; muted unselected text/icon.
- Arrow-key navigation, `aria-selected`/`aria-pressed`, focus visibility, and disabled state remain correct for the component's semantic role.
- Use for HDR/SDR and similar compact mutually exclusive choices only; do not turn ordinary action buttons into segments.

## 9. Slider interaction contract

### 9.1 Modifier mapping

- **Ctrl:** the current 10× finer Shift behavior for slider pointer drags, slider arrow keys, assignable continuous-control commands, Curves, and Exposure Bands.
- **Shift:** semantic snapping for range sliders only.
- **Ctrl+Shift on a slider:** Shift snapping wins.
- **Alt/Option:** remove the undocumented fine-adjustment alias.
- **Command on macOS:** remains the application shortcut modifier; it does not silently substitute for Control precision.
- Modifier changes take effect during an active drag without jumping the value.

Curves and Exposure Bands are graphical editors rather than ordinary sliders. Ctrl provides fine graph movement; Shift alone retains ordinary graph movement in this sprint. The selected Exposure Band range input still receives ordinary slider snapping.

Exposure Bands currently uses Ctrl/Command plus Left/Right to move a selected band horizontally. Preserve that established exception while using Ctrl+Up/Down and Ctrl-drag for fine adjustment, and document it in Help.

### 9.2 Semantic snap profiles

Remove the hard-coded decorative ticks and keep rails visually empty, following the approved reference direction. Shift snapping still uses the centralized semantic profile below; those behavioral landing positions are intentionally not drawn into the rail.

- Default linear profile: five major landing positions—minimum, 25%, home/center, 75%, maximum.
- The declared default/home must always be included, even for asymmetric controls.
- Bipolar profiles must include zero.
- Use explicit per-control profiles for values where quartiles are not meaningful.
- Shift+Arrow moves to the next legal snap position.
- Shift+pointer drag selects the nearest legal position.
- Snap profiles must recompute or clamp correctly when a control's legal range changes dynamically.

Required semantic profile families:

| Family | Examples |
| --- | --- |
| EV | Whole or authored fractional stops, always including zero/home |
| Percent | Normally 0, 25, 50, 75, 100 |
| Kelvin | Photographically useful anchors including the declared 6500 K home where applicable |
| Degrees | Useful authored increments including zero |
| Nits | Authored targets such as diffuse white and common delivery peaks rather than arithmetic quartiles |
| Dynamic/asymmetric | Filtered legal values plus declared home; never snap outside neighbor or source-derived limits |

Use declarative metadata or a centralized JavaScript profile registry. Do not infer every control solely from `min`, `max`, and `step`.

## 10. Implementation workstreams

### A. Foundation: assets, type, and tokens

- Add locally bundled Source Sans 3, Gabarito, and Space Mono assets and licenses.
- Introduce semantic font tokens and update component typography.
- Replace the default surface and accent values through the existing runtime token system.
- Consolidate contradictory late CSS overrides as each affected component is migrated.
- Update canvas-drawn controls to read the relevant runtime tokens rather than duplicating literals.

### B. Shared control components

- Rebuild the shared standard instrument slider.
- Add data-driven snap/tick profiles.
- Add the compact subordinate slider variant and grouped tile.
- Add the illuminated toggle and recessed segmented-control variants.
- Preserve hit targets, focus, editable values, reset, disabled, and modified states.

### C. Interaction remap

- Move current Shift fine adjustment to Ctrl across sliders, Curves, Exposure Bands, and assigned continuous-control commands.
- Add Shift semantic snapping for sliders.
- Resolve live modifier transitions, Ctrl+Shift precedence, dynamic bounds, and the Exposure Bands keyboard exception.
- Replace obsolete tooltip, Help, Settings, and shortcut copy.

### D. Control Panel application

- Apply the chassis, numbered section stack, open-section well, and internal Local Adjustments hierarchy.
- Retain real mask icons in the tool grid.
- Apply adjustment-row selection styling and context labels.
- Apply grouped tiles wherever the inventory identifies primary/subordinate controls.
- Keep disclosures, scrolling, presets, bypass, Reset, comparison, and multiple-open behavior intact.

### E. Remaining application surfaces

- Apply typography and token changes to Source, viewer toolbar, scopes, Proof, Export, Settings, Help, dialogs, and empty/error states.
- Keep scope/channel colors, HDR headroom amber, readiness green, and errors/clipping red semantically separate from ultraviolet.
- Avoid turning the UI pass into a layout rewrite of Proof or Export.

### F. Documentation and validation

- Update the living design guideline after implementation matches the sprint.
- Update the application-settings/shortcuts guide and in-app Help.
- Update tooltip copy and frontend contract expectations.
- Record validated screenshots only after labels, fonts, and spacing have settled.

## 11. Suggested parallel execution lanes

The sprint can use sub-agents safely when each lane owns a bounded surface and integration remains centralized:

1. **Typography/tokens lane:** font assets, licenses, semantic tokens, and documentation deltas.
2. **Interaction lane:** Ctrl fine adjustment, Shift snapping, snap profiles, and focused interaction tests.
3. **Component lane:** standard slider, grouped tile/sub-rails, toggle, segment, and Control Panel styling.
4. **Integration/QA lane:** layout matrices, local mask icon preservation, accessibility, Electron checks, and final visual comparison.

Only one lane should edit a given CSS block or shared function at a time. The primary agent owns integration, cascade cleanup, reference comparisons, and final acceptance.

## 12. Acceptance criteria

### Visual system

1. The default application uses the specified cool near-black hierarchy without broad mid-grey surrounds.
2. Electric ultraviolet is the only ordinary active accent and remains spatially restrained.
3. HDR headroom remains amber; readiness remains green; clipping/errors remain red; RGB channel colors retain their existing meaning.
4. Source Sans 3, Gabarito, and Space Mono render from local assets with correct fallbacks and no network dependency.
5. Essential small labels meet the applicable contrast target; required copy is not rendered in `#4E555B`-class low contrast.

### Components

6. Standard sliders share one channel, fill, handle, tick, label, and value system across global and local grading controls.
7. Every subordinate slider uses the compact aligned sub-rail treatment inside a clear group; no subordinate slider accidentally appears as an ordinary peer row.
8. Relationship labels describe the actual data model and do not imply false coupling.
9. Parent/child reset, modification, undo, preview, and scope-influence behavior remains correct.
10. Toggles and segmented controls match the supplied recessed/illuminated direction while retaining correct semantics.
11. Brush, Erase, Gradient, Luma, and Path keep real icons and text labels wherever the tools are available.

### Interaction

12. Plain pointer and keyboard slider behavior remains unchanged.
13. Ctrl pointer/keyboard movement is approximately 10× finer and can be engaged or released mid-drag without a jump.
14. Shift pointer/keyboard movement lands only on the control's legal semantic snap values.
15. Rails remain visually empty; actual Shift snap values come from one centralized, testable semantic profile.
16. Ctrl+Shift follows Shift snapping; Home/End and double-click reset remain unchanged.
17. Curves and Exposure Bands receive Ctrl precision without unintended Shift snapping.
18. The Exposure Bands Ctrl/Command+Left/Right exception remains functional and documented.
19. Assigned continuous-control shortcuts, Settings copy, Help, and Electron smoke expectations match the new modifier contract.

### Accessibility and layout

20. Focus is visible on standard and compact controls without relying on glow alone.
21. Compact rails retain at least a 24–28px pointer target and full keyboard operation.
22. Active, modified, selected, default, disabled, and bypassed states never rely on ultraviolet alone.
23. Mask tools retain accessible names and correct pressed state.
24. Reduced motion and Windows high-contrast behavior remain usable.
25. Typography, tracked caps, values, and controls remain legible at Windows 100%, 125%, and 150% scaling.
26. No horizontal overflow, clipped values, or unusable rails occur at 1100×720, 1280×720, 1366×768, 1406×756, 1440×1000, 1600×900, or 2560×1440.

## 13. Required validation matrix

### Automated

- Replace or rename `tests/fine-adjustment-interaction.js` to cover plain, Ctrl fine, Shift snap, live modifier changes, and Ctrl+Shift precedence.
- Expand Curve tests for Ctrl pointer and keyboard precision plus Shift ordinary behavior.
- Expand Exposure Bands tests for Ctrl precision, dynamic native/ARIA bounds, snap filtering, monotonic limits, and the Left/Right exception.
- Add grouped-tile assertions for standard versus compact rails, correct nesting, local/global parity, and sibling-value isolation.
- Update Electron smoke assertions for shortcut help text.
- Run frontend contract, local design, layout, accessibility, and desktop unit suites affected by the changes.

### Hands-on

- Compare reference and implementation at the same Control Panel width and state.
- Review with dark, bright, highly saturated, and neutral photographic content to confirm the accent does not bias judgement.
- Exercise every local mask tool and selected-adjustment state.
- Drag parent and compact child rails normally, with Ctrl, and with Shift.
- Test exact numeric entry, reset, bypass, presets, undo/redo, and rapid preview settlement.
- Inspect fonts and compact labels at Windows 100%, 125%, and 150% scaling.
- Check keyboard-only operation, visible focus, high contrast, and reduced motion.

## 14. Non-goals

- Multiple selectable themes or a Studio Grey default.
- Neon green or AI-mint branding.
- A floating mask-tool dock.
- An exclusive one-open-section accordion.
- New grading math or invented parent/child coupling.
- Replacing the current mask icon set with placeholders.
- Rebuilding Proof, Export, or the media browser beyond applying shared tokens and typography.
- Marketing, wordmark, onboarding, editorial-serif, or CJK font expansion.

## 15. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Ultraviolet becomes distracting around saturated images | Limit it to small live/selected surfaces, cap glow, and test against varied content |
| Small meta text loses contrast | Raise essential copy to `--muted`; measure rendered contrast at final size |
| Compact rails become hard to acquire | Keep 24–28px invisible hit targets, focus rings, and keyboard parity |
| Visual hierarchy falsely implies data coupling | Inventory and name every relationship before component conversion |
| CSS final-cascade layers fight new tokens | Consolidate migrated blocks rather than stacking another override layer |
| Modifier remap conflicts with graph shortcuts | Preserve and document the Exposure Bands horizontal-motion exception |
| Font metrics cause wrapping or rail shrinkage | Validate every minimum viewport and Windows scale before acceptance |
| Too many simultaneous accent cues create noise | Follow the accent hierarchy: solid for current tool/badge, outline/bed for selected row, hairline/index for section, fill for live/modified rail |

## 16. Definition of done

The sprint is complete when the shared tokens and components are implemented across the agreed surfaces, the parent/sub-control distinction is structurally correct, real mask icons are preserved, the modifier contract is consistent and documented, automated and hands-on gates pass, and the living design guideline accurately describes the shipped result.

Implementation is not complete when only the full Control Panel screenshot looks close. The same components must remain coherent in global grading, local adjustments, masks, scopes, Settings, Help, Proof, Export, compact layouts, and keyboard-only use.
