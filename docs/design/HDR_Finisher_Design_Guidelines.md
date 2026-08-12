# HDR Finisher Design Guidelines

Status: living guideline for the shipped application

Last updated: 2026-08-12

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

## Curves and graphical editors

- Curves begin neutral with three editable points at 25%, 50%, and 75%, plus fixed black and white endpoints.
- Clicking the curve line adds a point at that position.
- Clicking an interior point removes it; dragging adjusts it.
- Fixed endpoints cannot be removed.
- Selected points use the selected-point token; channel curves use their channel tokens.
- Canvas instructions must be available through an accessible label and keyboard operation.

Exposure Bands follows the same direct-manipulation principle with distinct mouse buttons:

- Left-click the exposure curve to add a band at that brightness.
- Right-click an interior band to remove it.
- Left-drag an existing band to adjust its input position and exposure effect.
- The darkest and brightest endpoint bands cannot be removed.
- Add Band, Remove Band, and keyboard controls remain available as explicit alternatives.

## Spacing and geometry

Use the runtime tokens and existing component rhythm as the baseline:

- Source rail: 268 px default.
- Grade rail: 320 px default.
- Analysis dock: 252 px default.
- Control row: 38 px.
- Corner radius: 3 px.
- Hairlines separate dense regions; avoid nested heavy borders.
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
